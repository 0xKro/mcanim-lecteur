// Lecteur de tar en flux (ustar + pax + noms longs GNU). Ne garde en memoire que les fichiers voulus.
const str = (b, o, l) => { let e = o; const m = o + l; while (e < m && b[e] !== 0) e++; return b.toString('utf8', o, e); };
function num(b, o, l) {
  if (b[o] & 0x80) { let v = 0; for (let i = o + 1; i < o + l; i++) v = v * 256 + b[i]; return v; }
  return parseInt(str(b, o, l).trim() || '0', 8);
}

// want(name) -> bool ; handle(name, Buffer) appelee pour chaque fichier regulier voulu
export async function readTar(stream, want, handle) {
  let pend = Buffer.alloc(0);
  let cur = null, pax = null, longName = null;
  for await (const chunk of stream) {
    pend = pend.length ? Buffer.concat([pend, chunk]) : chunk;
    for (;;) {
      if (!cur) {
        if (pend.length < 512) break;
        const h = pend.subarray(0, 512);
        pend = pend.subarray(512);
        if (h.every((x) => x === 0)) continue;
        let name = str(h, 0, 100);
        const size = num(h, 124, 12);
        const type = h[156] === 0 ? '0' : String.fromCharCode(h[156]);
        if (str(h, 257, 5) === 'ustar') { const pre = str(h, 345, 155); if (pre) name = pre + '/' + name; }
        if (pax?.path) name = pax.path;
        else if (longName) name = longName;
        const meta = type === 'x' || type === 'g' || type === 'L';
        const keep = meta || ((type === '0' || type === '7') && want(name));
        cur = { name, size, type, padded: Math.ceil(size / 512) * 512, got: 0, parts: [], keep, meta };
        if (!meta) { pax = null; longName = null; }
      }
      if (cur.padded === 0 && cur.size === 0) {
        if (cur.keep && !cur.meta) await handle(cur.name, Buffer.alloc(0));
        cur = null; continue;
      }
      if (pend.length === 0) break;
      const take = Math.min(cur.padded - cur.got, pend.length);
      const dataTake = Math.max(0, Math.min(take, cur.size - cur.got));
      if (cur.keep && dataTake) cur.parts.push(pend.subarray(0, dataTake));
      cur.got += take;
      pend = pend.subarray(take);
      if (cur.got < cur.padded) break;
      const data = cur.keep ? Buffer.concat(cur.parts) : null;
      if (cur.type === 'x') {
        pax = pax || {};
        let s = data.toString('utf8');
        while (s.length) { const sp = s.indexOf(' '); const len = parseInt(s.slice(0, sp), 10); if (!len) break; const rec = s.slice(sp + 1, len - 1); const eq = rec.indexOf('='); pax[rec.slice(0, eq)] = rec.slice(eq + 1); s = Buffer.from(s).subarray(len).toString('utf8'); }
      } else if (cur.type === 'L') longName = str(data, 0, data.length);
      else if (cur.type === 'g') { /* en-tete global: ignore */ }
      else if (cur.keep) await handle(cur.name, data);
      cur = null;
    }
  }
}
