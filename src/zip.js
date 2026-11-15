// Lecture de zip par plages (fichier local ou HTTP Range), ZIP64, CRC32. Ecriture de zip simple.
import fs from 'node:fs';
import zlib from 'node:zlib';

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export class FileSource {
  constructor(path) { this.path = path; this.size = fs.statSync(path).size; this.requests = 0; }
  async read(off, len) {
    this.requests++;
    const fd = await fs.promises.open(this.path, 'r');
    try {
      const b = Buffer.alloc(len);
      const { bytesRead } = await fd.read(b, 0, len, off);
      return bytesRead === len ? b : b.subarray(0, bytesRead);
    } finally { await fd.close(); }
  }
}
export class HttpSource {
  constructor(net, url, size) { this.net = net; this.url = url; this.size = size; }
  read(off, len) { return this.net.range(this.url, off, off + len - 1); }
}

// Lit le repertoire central. Retourne { entries, cdOffset }.
export async function readCentralDirectory(src) {
  const tailLen = Math.min(src.size, 65536 + 22 + 20 + 56);
  const tailStart = src.size - tailLen;
  const tail = await src.read(tailStart, tailLen);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('zip: fin de repertoire central introuvable');
  let total = tail.readUInt16LE(e + 10);
  let cdSize = tail.readUInt32LE(e + 12);
  let cdOff = tail.readUInt32LE(e + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    // ZIP64: localisateur juste avant la fin
    const l = e - 20;
    if (l < 0 || tail.readUInt32LE(l) !== 0x07064b50) throw new Error('zip64: localisateur introuvable');
    const off64 = Number(tail.readBigUInt64LE(l + 8));
    let rec;
    if (off64 >= tailStart) rec = tail.subarray(off64 - tailStart);
    else rec = await src.read(off64, 56);
    if (rec.readUInt32LE(0) !== 0x06064b50) throw new Error('zip64: fin de repertoire invalide');
    total = Number(rec.readBigUInt64LE(32));
    cdSize = Number(rec.readBigUInt64LE(40));
    cdOff = Number(rec.readBigUInt64LE(48));
  }
  const cdBuf = tailStart <= cdOff ? tail.subarray(cdOff - tailStart, cdOff - tailStart + cdSize) : await src.read(cdOff, cdSize);
  const entries = [];
  let p = 0;
  while (p + 46 <= cdBuf.length && entries.length < total) {
    if (cdBuf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: entree de repertoire invalide');
    const flags = cdBuf.readUInt16LE(p + 8);
    const method = cdBuf.readUInt16LE(p + 10);
    const crc = cdBuf.readUInt32LE(p + 16);
    let csize = cdBuf.readUInt32LE(p + 20);
    let usize = cdBuf.readUInt32LE(p + 24);
    const nlen = cdBuf.readUInt16LE(p + 28), elen = cdBuf.readUInt16LE(p + 30), clen = cdBuf.readUInt16LE(p + 32);
    let offset = cdBuf.readUInt32LE(p + 42);
    const name = cdBuf.toString('utf8', p + 46, p + 46 + nlen);
    if (usize === 0xffffffff || csize === 0xffffffff || offset === 0xffffffff) {
      let q = p + 46 + nlen; const end = q + elen;
      while (q + 4 <= end) {
        const id = cdBuf.readUInt16LE(q), sz = cdBuf.readUInt16LE(q + 2);
        if (id === 1) {
          let r = q + 4;
          if (usize === 0xffffffff) { usize = Number(cdBuf.readBigUInt64LE(r)); r += 8; }
          if (csize === 0xffffffff) { csize = Number(cdBuf.readBigUInt64LE(r)); r += 8; }
          if (offset === 0xffffffff) { offset = Number(cdBuf.readBigUInt64LE(r)); r += 8; }
        }
        q += 4 + sz;
      }
    }
    entries.push({ name, method, crc, csize, usize, offset, flags, nlen });
    p += 46 + nlen + elen + clen;
  }
  if (entries.length !== total) throw new Error(`zip: ${entries.length} entrees lues sur ${total}`);
  return { entries, cdOffset: cdOff };
}

// Regroupe les entrees voulues en plages. Chaque entree occupe [offset, offset suivant).
export function planRanges(allEntries, cdOffset, wanted, { maxGap = 128 * 1024, maxSpan = 8 * 1024 * 1024 } = {}) {
  const sorted = [...allEntries].sort((a, b) => a.offset - b.offset);
  const endOf = new Map();
  for (let i = 0; i < sorted.length; i++) endOf.set(sorted[i], i + 1 < sorted.length ? sorted[i + 1].offset : cdOffset);
  const w = wanted.filter((x) => x.usize > 0 || true).sort((a, b) => a.offset - b.offset);
  const ranges = [];
  let cur = null;
  for (const en of w) {
    const s = en.offset, e = endOf.get(en);
    if (cur && s - cur.end <= maxGap && e - cur.start <= maxSpan) { cur.end = Math.max(cur.end, e); cur.entries.push(en); }
    else { cur = { start: s, end: e, entries: [en] }; ranges.push(cur); }
  }
  return ranges;
}

export function extractEntry(buf, base, en) {
  const p = en.offset - base;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`zip: en-tete local invalide pour ${en.name}`);
  const nlen = buf.readUInt16LE(p + 26), elen = buf.readUInt16LE(p + 28);
  const ds = p + 30 + nlen + elen;
  const raw = buf.subarray(ds, ds + en.csize);
  if (raw.length !== en.csize) throw new Error(`zip: donnees tronquees pour ${en.name}`);
  let data;
  if (en.method === 0) data = raw;
  else if (en.method === 8) data = zlib.inflateRawSync(raw);
  else throw new Error(`zip: methode ${en.method} non geree (${en.name})`);
  if (data.length !== en.usize) throw new Error(`zip: taille differente pour ${en.name}`);
  if (crc32(data) !== en.crc) throw new Error(`zip: CRC32 faux pour ${en.name}`);
  return data;
}

// Lit les entrees voulues (peu de plages), verifie le CRC32, appelle onFile(name, data).
export async function extractWanted(src, cd, wanted, onFile, { concurrency = 4, ...planOpts } = {}) {
  const ranges = planRanges(cd.entries, cd.cdOffset, wanted, planOpts);
  let i = 0;
  const worker = async () => {
    while (i < ranges.length) {
      const r = ranges[i++];
      const buf = await src.read(r.start, r.end - r.start);
      for (const en of r.entries) onFile(en.name, extractEntry(buf, r.start, en));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ranges.length) }, worker));
  return { ranges: ranges.length, rangeBytes: ranges.reduce((a, r) => a + r.end - r.start, 0) };
}

// ---- ecriture ----
export function buildZip(files) { // files: [{ name, data(Buffer) }]
  const parts = []; const cds = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const stored = f.data;
    const comp = zlib.deflateRawSync(stored, { level: 9 });
    const useDeflate = comp.length < stored.length;
    const body = useDeflate ? comp : stored;
    const crc = crc32(stored);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(useDeflate ? 8 : 0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); // 1980-01-01
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(stored.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(useDeflate ? 8 : 0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(stored.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    cds.push(ch, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(cds);
  if (off + cd.length > 0xfffffff0 || files.length > 0xfff0) throw new Error('kit trop gros pour ce zip simple (ZIP64 non gere en ecriture)');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
