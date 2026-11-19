// NBT (format binaire du jeu : fichiers .nbt, .schem, .litematic) : lecture et ecriture, sans dependance (zlib de Node pour le gzip).
// Gros-boutiste. Types : 0 End, 1 Byte, 2 Short, 3 Int, 4 Long, 5 Float, 6 Double, 7 ByteArray, 8 String, 9 List, 10 Compound,
// 11 IntArray, 12 LongArray. Les textes sont lus en UTF-8 (le jeu ecrit de l'UTF-8 "modifie" : identique pour tout sauf le caractere nul
// et les caracteres hors du plan de base, absents des noms de blocs).
// Lecture : Byte/Short/Int/Float/Double -> nombre, Long -> BigInt, tableaux -> Int8Array / Int32Array / BigInt64Array, liste -> tableau,
// compose -> objet sans prototype. Ecriture : valeurs typees fabriquees avec `N` (N.int(3), N.compose({...})...).
import zlib from 'node:zlib';

const PROF_MAX = 512;
export const DECOMPRESSE_MAX = 256 * 1024 * 1024;

export class ErreurNbt extends Error { constructor(m) { super(m); this.name = 'ErreurNbt'; } }

// octets (gzip, zlib ou bruts) -> { nom, valeur } de la racine
export function lireNbt(buf) {
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  try {
    if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b, { maxOutputLength: DECOMPRESSE_MAX });
    else if (b[0] === 0x78) b = zlib.inflateSync(b, { maxOutputLength: DECOMPRESSE_MAX });
  } catch (e) { throw new ErreurNbt(`fichier compresse illisible (${e.code === 'ERR_BUFFER_TOO_LARGE' ? 'plus de 256 Mo une fois decompresse' : e.message})`); }
  let p = 0;
  const reste = (n) => { if (p + n > b.length || n < 0) throw new ErreurNbt('fichier NBT tronque'); };
  const u8 = () => { reste(1); return b[p++]; };
  const i8 = () => { reste(1); return b.readInt8(p++); };
  const i16 = () => { reste(2); const v = b.readInt16BE(p); p += 2; return v; };
  const u16 = () => { reste(2); const v = b.readUInt16BE(p); p += 2; return v; };
  const i32 = () => { reste(4); const v = b.readInt32BE(p); p += 4; return v; };
  const i64 = () => { reste(8); const v = b.readBigInt64BE(p); p += 8; return v; };
  const f32 = () => { reste(4); const v = b.readFloatBE(p); p += 4; return v; };
  const f64 = () => { reste(8); const v = b.readDoubleBE(p); p += 8; return v; };
  const texte = () => { const n = u16(); reste(n); const s = b.toString('utf8', p, p + n); p += n; return s; };
  const charge = (t, prof) => {
    if (prof > PROF_MAX) throw new ErreurNbt('NBT trop imbrique');
    switch (t) {
      case 1: return i8();
      case 2: return i16();
      case 3: return i32();
      case 4: return i64();
      case 5: return f32();
      case 6: return f64();
      case 7: { const n = i32(); reste(n); const a = new Int8Array(n); for (let i = 0; i < n; i++) a[i] = b.readInt8(p + i); p += n; return a; }
      case 8: return texte();
      case 9: {
        const tt = u8(), n = i32();
        if (n > 0 && tt === 0) throw new ErreurNbt('liste NBT de type End non vide');
        if (n < 0 || n > b.length - p) throw new ErreurNbt('liste NBT trop longue');   // chaque element occupe au moins un octet
        const a = new Array(Math.max(0, n));
        for (let i = 0; i < n; i++) a[i] = charge(tt, prof + 1);
        return a;
      }
      case 10: {
        const o = Object.create(null);
        for (;;) {
          const tt = u8();
          if (tt === 0) return o;
          const nom = texte();
          o[nom] = charge(tt, prof + 1);
        }
      }
      case 11: { const n = i32(); reste(n * 4); const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = b.readInt32BE(p + 4 * i); p += 4 * n; return a; }
      case 12: { const n = i32(); reste(n * 8); const a = new BigInt64Array(n); for (let i = 0; i < n; i++) a[i] = b.readBigInt64BE(p + 8 * i); p += 8 * n; return a; }
      default: throw new ErreurNbt(`type NBT inconnu ${t} (octet ${p - 1})`);
    }
  };
  const t = u8();
  if (t !== 10) throw new ErreurNbt(t === 0x50 ? 'ce n\'est pas un fichier NBT (archive ZIP ?)' : 'ce n\'est pas un fichier NBT (la racine doit etre un compose)');
  const nom = texte();
  return { nom, valeur: charge(10, 0) };
}

// ---- ecriture : valeurs typees
const typee = (t, v, tt) => ({ __t: t, v, tt });
export const N = {
  byte: (v) => typee(1, v), short: (v) => typee(2, v), int: (v) => typee(3, v), long: (v) => typee(4, BigInt(v)),
  float: (v) => typee(5, v), double: (v) => typee(6, v), bytes: (a) => typee(7, a), texte: (s) => typee(8, String(s)),
  liste: (tt, a) => typee(9, a, tt), compose: (o) => typee(10, o), ints: (a) => typee(11, a), longs: (a) => typee(12, a),
};
const TYPES = { 1: 'byte', 2: 'short', 3: 'int', 4: 'long', 5: 'float', 6: 'double', 7: 'bytes', 8: 'texte', 9: 'liste', 10: 'compose', 11: 'ints', 12: 'longs' };
// une valeur non typee : texte -> String, nombre entier -> Int, objet -> Compound
function typer(v) {
  if (v && v.__t) return v;
  if (typeof v === 'string') return N.texte(v);
  if (typeof v === 'number') return Number.isInteger(v) ? N.int(v) : N.double(v);
  if (typeof v === 'bigint') return N.long(v);
  if (v && typeof v === 'object' && !Array.isArray(v)) return N.compose(v);
  throw new ErreurNbt(`valeur NBT non typee : ${JSON.stringify(v)}`);
}

export function ecrireNbt(racine, { nom = '', gzip = true } = {}) {
  const morceaux = [];
  let taille = 0;
  const pousser = (buf) => { morceaux.push(buf); taille += buf.length; };
  const ent = (n, f) => { const x = Buffer.alloc(n); f(x); pousser(x); };
  const texte = (s) => { const t = Buffer.from(s, 'utf8'); ent(2, (x) => x.writeUInt16BE(t.length)); pousser(t); };
  const charge = (val) => {
    const { __t: t, v, tt } = val;
    switch (t) {
      case 1: return ent(1, (x) => x.writeInt8(v));
      case 2: return ent(2, (x) => x.writeInt16BE(v));
      case 3: return ent(4, (x) => x.writeInt32BE(v));
      case 4: return ent(8, (x) => x.writeBigInt64BE(v));
      case 5: return ent(4, (x) => x.writeFloatBE(v));
      case 6: return ent(8, (x) => x.writeDoubleBE(v));
      case 7: { ent(4, (x) => x.writeInt32BE(v.length)); return pousser(Buffer.from(Int8Array.from(v).buffer)); }
      case 8: return texte(v);
      case 9: { ent(1, (x) => x.writeUInt8(v.length ? tt : 0)); ent(4, (x) => x.writeInt32BE(v.length)); for (const e of v) charge(e.__t ? e : typer(e)); return undefined; }
      case 10: {
        for (const [k, e] of Object.entries(v)) { const te = typer(e); ent(1, (x) => x.writeUInt8(te.__t)); texte(k); charge(te); }
        return ent(1, (x) => x.writeUInt8(0));
      }
      case 11: { ent(4, (x) => x.writeInt32BE(v.length)); return ent(4 * v.length, (x) => v.forEach((n, i) => x.writeInt32BE(n, 4 * i))); }
      case 12: { ent(4, (x) => x.writeInt32BE(v.length)); return ent(8 * v.length, (x) => v.forEach((n, i) => x.writeBigInt64BE(BigInt.asIntN(64, BigInt(n)), 8 * i))); }
      default: throw new ErreurNbt(`type ${TYPES[t] || t} inconnu`);
    }
  };
  ent(1, (x) => x.writeUInt8(10)); texte(nom); charge(typer(racine));
  const brut = Buffer.concat(morceaux, taille);
  return gzip ? zlib.gzipSync(brut) : brut;
}
