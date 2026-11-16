// Route "npm": paquet communautaire minecraft-assets (PrismarineJS, MIT). Ne contient PAS les versions recentes
// (dossiers jusqu'a 26.1 seulement) ni aucun son. On lit le tarball du registre en flux et on ne garde que
// data/<version proche>/ ; les blockstates et modeles sont des gros JSON fusionnes qu'on redecoupe en fichiers.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { Transform } from 'node:stream';
import { readTar } from '../tar.js';

const KNOWN = ['26.1', '1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.7', '1.21.6', '1.21.5', '1.21.4', '1.21.1', '1.20.2', '1.19.1'];
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };

async function pickVersion(ctx) {
  let list = KNOWN;
  try {
    const dirs = await ctx.net.json('https://api.github.com/repos/PrismarineJS/minecraft-assets/contents/data', { retries: 0 });
    list = dirs.filter((d) => d.type === 'dir' && /^\d+(\.\d+)+$/.test(d.name)).map((d) => d.name);
  } catch { /* liste integree */ }
  if (list.includes(ctx.version)) return { dataVersion: ctx.version, exact: true };
  const below = list.filter((v) => cmp(v, ctx.version) <= 0).sort(cmp);
  const best = below.pop() || list.sort(cmp).pop();
  return { dataVersion: best, exact: false };
}

export async function run(ctx) {
  const { net, groups, version } = ctx;
  if (groups.has('worldgen') && groups.size === 1) throw new Error('le paquet npm ne contient pas worldgen');
  const meta = await net.json('https://registry.npmjs.org/minecraft-assets/latest');
  const { dataVersion, exact } = await pickVersion(ctx);
  const r = await net.open(meta.dist.tarball);
  if (r.status !== 200) { r.stream.resume(); throw new Error(`registre npm: HTTP ${r.status}`); }
  const h = crypto.createHash('sha1');
  const tee = new Transform({ transform(c, _e, cb) { h.update(c); cb(null, c); } });
  const base = `package/minecraft-assets/data/${dataVersion}/`;
  const J = {};
  const rel = (name) => name.slice(base.length);
  const want = (name) => {
    if (!name.startsWith(base)) return false;
    const p = rel(name);
    if (['blocks_states.json', 'blocks_models.json'].includes(p)) return groups.has(p === 'blocks_states.json' ? 'blockstates' : 'models');
    if (p.startsWith('blocks/')) return groups.has('textures');
    if (p.startsWith('colormap/')) return groups.has('colormap');
    if (p.startsWith('entity/player/')) return groups.has('skins');
    return false;
  };
  const counts = {};
  await readTar(r.stream.pipe(tee).pipe(zlib.createGunzip()), want, (name, data) => {
    const p = rel(name);
    if (p === 'blocks_states.json' || p === 'blocks_models.json') { J[p] = JSON.parse(data.toString('utf8')); return; }
    const dest = p.startsWith('blocks/') ? 'assets/minecraft/textures/block/' + p.slice(7)
      : p.startsWith('colormap/') ? 'assets/minecraft/textures/colormap/' + p.slice(9)
        : 'assets/minecraft/textures/entity/player/' + p.slice(14);
    ctx.put(dest, data);
  });
  // le flux peut s'arreter avant la fin du tarball (le lecteur de tar consomme tout): verification d'integrite npm
  const sum = h.digest('hex');
  if (meta.dist.shasum && sum !== meta.dist.shasum) throw new Error(`tarball npm: sha1 ${sum} au lieu de ${meta.dist.shasum}`);
  if (J['blocks_states.json']) for (const [k, v] of Object.entries(J['blocks_states.json'])) ctx.put(`assets/minecraft/blockstates/${k}.json`, Buffer.from(JSON.stringify(v)));
  if (J['blocks_models.json']) for (const [k, v] of Object.entries(J['blocks_models.json'])) ctx.put(`assets/minecraft/models/block/${k}.json`, Buffer.from(JSON.stringify(v)));
  const missing = ['sons', 'biomes', 'environnement'].filter((g) => groups.has(g));
  if (groups.has('worldgen')) missing.push('worldgen');
  return {
    missing,
    court: `partiel (donnees ${dataVersion}${exact ? '' : ` au lieu de ${version}`}, sans ${missing.join('+')})`,
    notes: {
      npmPackage: `minecraft-assets@${meta.version}`, tarballBytes: Number(r.headers['content-length']) || undefined,
      dataVersion, versionDemandee: version, versionExacte: exact, tarballSha1Ok: true,
      avertissement: exact ? undefined : `donnees de ${dataVersion}, pas de ${version}: blocs et textures manquants ou differents; aucun son`,
    },
  };
}
