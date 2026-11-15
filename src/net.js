// Client HTTPS sans dependance. Respecte HTTPS_PROXY / https_proxy / NO_PROXY
// avec un tunnel CONNECT (node:http + node:tls), sans besoin de NODE_USE_ENV_PROXY.
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { Transform } from 'node:stream';

export class NetError extends Error {
  constructor(message, { fatal = false, status = 0, url = '' } = {}) {
    super(message);
    this.name = 'NetError';
    this.fatal = fatal; // true = inutile de reessayer (refus du proxy, 403, 404...)
    this.status = status;
    this.url = url;
  }
}
const isFatal = (e) => e.fatal || ['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN'].includes(e.code);
export class RangeRefused extends NetError {}

function proxyFromEnv(url, env) {
  const u = new URL(url);
  const np = (env.NO_PROXY || env.no_proxy || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const host = u.hostname.toLowerCase();
  for (const p of np) {
    if (p === '*') return null;
    const q = p.replace(/^\*?\./, '').replace(/:\d+$/, '');
    if (host === q || host.endsWith('.' + q)) return null;
  }
  const raw = env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy;
  if (!raw) return null;
  return new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'http://' + raw);
}

class TunnelAgent extends https.Agent {
  constructor(proxy, connectTimeout) {
    super({ keepAlive: true, maxSockets: 8 });
    this.proxy = proxy;
    this.connectTimeout = connectTimeout;
  }
  createConnection(options, cb) {
    let done = false;
    const finish = (err, sock) => { if (!done) { done = true; cb(err, sock); } };
    const host = options.host || options.hostname;
    const port = options.port || 443;
    const headers = { Host: `${host}:${port}` };
    if (this.proxy.username) {
      const cred = `${decodeURIComponent(this.proxy.username)}:${decodeURIComponent(this.proxy.password)}`;
      headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(cred).toString('base64');
    }
    const mod = this.proxy.protocol === 'https:' ? https : http;
    const req = mod.request({
      host: this.proxy.hostname,
      port: this.proxy.port || (this.proxy.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT', path: `${host}:${port}`, headers, agent: false,
    });
    const timer = setTimeout(() => req.destroy(new NetError(`delai depasse (${this.connectTimeout} ms) pour joindre ${host} via le proxy`, { fatal: true })), this.connectTimeout);
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        socket.destroy();
        return finish(new NetError(`le proxy refuse ${host} (HTTP ${res.statusCode})`, { fatal: true, status: res.statusCode }));
      }
      const t = tls.connect({ socket, servername: options.servername || host });
      t.once('secureConnect', () => { clearTimeout(timer); finish(null, t); });
      t.once('error', (e) => { clearTimeout(timer); finish(e); });
    });
    req.once('error', (e) => { clearTimeout(timer); finish(e); });
    req.end();
  }
}

export class Net {
  constructor({ env = process.env, connectTimeout = 4000, idleTimeout = 20000, userAgent = 'mcanim-lecteur/0.1.0' } = {}) {
    this.env = env;
    this.connectTimeout = connectTimeout;
    this.idleTimeout = idleTimeout;
    this.userAgent = userAgent;
    this.bytes = 0;      // octets de corps recus sur le fil (apres compression eventuelle)
    this.requests = 0;   // requetes HTTP envoyees (redirections comprises)
    this.agents = new Map();
    this.direct = new https.Agent({ keepAlive: true, maxSockets: 8 });
  }
  resetStats() { this.bytes = 0; this.requests = 0; }
  proxyInfo(url) { const p = proxyFromEnv(url, this.env); return p ? `${p.protocol}//${p.host}` : null; }
  agentFor(url) {
    const p = proxyFromEnv(url, this.env);
    if (!p) return this.direct;
    const k = p.href;
    if (!this.agents.has(k)) this.agents.set(k, new TunnelAgent(p, this.connectTimeout));
    return this.agents.get(k);
  }
  close() { this.direct.destroy(); for (const a of this.agents.values()) a.destroy(); }

  // Reponse brute: { status, headers, stream } (stream = corps decode, octets comptes dans this.bytes)
  open(url, { headers = {}, method = 'GET', gzip = false, redirects = 5 } = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      if (u.protocol !== 'https:') return reject(new NetError('seul https est accepte: ' + url, { fatal: true, url }));
      this.requests++;
      const req = https.request(u, {
        method, agent: this.agentFor(url),
        headers: { 'User-Agent': this.userAgent, 'Accept-Encoding': gzip ? 'gzip' : 'identity', ...headers },
      });
      const timer = setTimeout(() => req.destroy(new NetError(`delai depasse (${this.connectTimeout + 4000} ms) en attendant ${u.hostname}`, { url, fatal: true })), this.connectTimeout + 4000);
      req.once('error', (e) => { clearTimeout(timer); if (e instanceof NetError) e.url ||= url; reject(e); });
      req.once('response', (res) => {
        clearTimeout(timer);
        res.setTimeout(this.idleTimeout, () => res.destroy(new NetError(`plus de donnees depuis ${this.idleTimeout} ms: ${u.hostname}`, { url })));
        const loc = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && loc) {
          res.resume();
          if (redirects <= 0) return reject(new NetError('trop de redirections', { fatal: true, url }));
          return this.open(new URL(loc, u).href, { headers, method, gzip, redirects: redirects - 1 }).then(resolve, reject);
        }
        const count = new Transform({ transform: (c, _e, cb) => { this.bytes += c.length; cb(null, c); } });
        let stream = res.pipe(count);
        res.on('error', (e) => count.destroy(e));
        if (res.headers['content-encoding'] === 'gzip') {
          const gz = zlib.createGunzip();
          count.on('error', (e) => gz.destroy(e));
          stream = count.pipe(gz);
        }
        resolve({ status: res.statusCode, headers: res.headers, stream, res });
      });
      req.end();
    });
  }

  async buffer(url, { retries = 2, expect = [200], ...opts } = {}) {
    let last;
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await this.open(url, opts);
        if (!expect.includes(r.status)) {
          r.stream.resume();
          throw new NetError(`HTTP ${r.status} pour ${url}`, { fatal: r.status < 500 && r.status !== 429, status: r.status, url });
        }
        const parts = [];
        for await (const c of r.stream) parts.push(c);
        return { body: Buffer.concat(parts), status: r.status, headers: r.headers };
      } catch (e) {
        last = e;
        if (isFatal(e) || i === retries) break;
        await new Promise((ok) => setTimeout(ok, 300 * (i + 1)));
      }
    }
    throw last;
  }
  async json(url, opts) { return JSON.parse((await this.buffer(url, { gzip: true, ...opts })).body.toString('utf8')); }

  // Lecture d'une plage [start, end] (inclus). Leve RangeRefused si le serveur renvoie 200 (plage ignoree).
  async range(url, start, end) {
    const want = end - start + 1;
    let last;
    for (let i = 0; i <= 2; i++) {
      try {
        const r = await this.open(url, { headers: { Range: `bytes=${start}-${end}` } });
        if (r.status === 200) { r.res.destroy(); throw new RangeRefused('le serveur ignore Range (HTTP 200)', { fatal: true, status: 200, url }); }
        if (r.status !== 206) { r.stream.resume(); throw new NetError(`HTTP ${r.status} pour ${url}`, { fatal: r.status < 500 && r.status !== 429, status: r.status, url }); }
        const parts = [];
        for await (const c of r.stream) parts.push(c);
        const b = Buffer.concat(parts);
        if (b.length !== want) throw new NetError(`plage incomplete: ${b.length}/${want}`, { url });
        return b;
      } catch (e) {
        last = e;
        if (isFatal(e) || i === 2) break;
        await new Promise((ok) => setTimeout(ok, 300 * (i + 1)));
      }
    }
    throw last;
  }
}
