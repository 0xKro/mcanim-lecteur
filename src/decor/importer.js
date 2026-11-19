// Constructions enregistrees par le jeu ou par les outils des joueurs : lecture vers une forme commune, et ecriture (essais, exemples).
//   .schem    Sponge Schematic v1/v2/v3 (WorldEdit, FAWE) : Palette {etat: indice}, donnees en varint, index x + z*Largeur + y*Largeur*Longueur
//   .nbt      structure du jeu (bloc de structure, /place template) : palette [{Name, Properties}] (26.x : [{id, properties}]), blocks [{state, pos, nbt}] ;
//             une position absente de `blocks` = "structure_void" = la cellule n'est pas touchee
//   .litematic Litematica : Regions {nom: {Position, Size (peut etre negatif), BlockStatePalette, BlockStates (longs empaquetes en flux continu,
//             max(2, log2 palette) bits par cellule, index (y*Lz + z)*Lx + x), TileEntities}} ; les regions sont fusionnees dans une boite.
// Forme commune : { format, dataVersion, taille: [sx, sy, sz], palette: [texte | null], indices (x le plus rapide, puis z, puis y),
//   entites: [{ x, y, z, id, donnees }] } ; palette[i] = null : cellule laissee telle quelle.
// Aucune construction de tiers n'est livree : les essais fabriquent leurs fichiers avec les fonctions d'ecriture ci-dessous.
import os from 'node:os';
import { lireNbt, ecrireNbt, N, ErreurNbt } from './nbt.js';

export const DATA_VERSION = 4440;   // valeur ecrite dans nos fichiers d'essai (la lecture accepte toutes les versions)
const VIDE = new Set(['minecraft:structure_void']);

const txtEtat = (nom, props) => {
  const n = String(nom).includes(':') ? String(nom) : 'minecraft:' + nom;
  const p = props ? Object.entries(props).map(([k, v]) => `${k}=${v}`) : [];
  return p.length ? `${n}[${p.join(',')}]` : n;
};
const entier = (v) => (typeof v === 'bigint' ? Number(v) : Number(v));
const u16 = (v) => entier(v) & 0xffff;   // Width/Height/Length : Short NON signe (jusqu'a 65535)

function varints(octets, n) {
  const out = new Uint32Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    let v = 0, dec = 0, b;
    do {
      if (p >= octets.length) throw new ErreurNbt(`donnees de blocs trop courtes (${i} cellules lues sur ${n})`);
      b = octets[p++] & 0xff; v |= (b & 0x7f) << dec; dec += 7;
      if (dec > 28) throw new ErreurNbt('varint trop long dans les donnees de blocs');
    } while (b & 0x80);
    out[i] = v >>> 0;
  }
  return out;
}
export function versVarints(indices) {
  const out = [];
  for (const v0 of indices) { let v = v0 >>> 0; while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; } out.push(v); }
  return Int8Array.from(Uint8Array.from(out));
}

// ---- lecture
export function lireConstruction(buf, nomFichier = 'fichier') {
  const ext = (/\.([a-z]+)$/i.exec(nomFichier)?.[1] || '').toLowerCase();
  const { valeur } = lireNbt(buf);
  if (ext === 'schem' || ext === 'schematic' || (ext !== 'nbt' && ext !== 'litematic' && (valeur.Schematic || valeur.Palette || valeur.Blocks))) {
    if (valeur.Materials !== undefined && valeur.Palette === undefined && !valeur.Schematic) throw new ErreurNbt('ancien .schematic (ids numeriques d\'avant 1.13) : enregistre-le en .schem avec WorldEdit (//schem save)');
    return lireSponge(valeur);
  }
  if (ext === 'litematic' || valeur.Regions) return lireLitematic(valeur);
  if (ext === 'nbt' || valeur.blocks) return lireStructure(valeur);
  throw new ErreurNbt('format inconnu : .schem (Sponge), .nbt (structure du jeu) ou .litematic attendu');
}

function lireSponge(racine) {
  const s = racine.Schematic && typeof racine.Schematic === 'object' && !Array.isArray(racine.Schematic) ? racine.Schematic : racine;
  const version = entier(s.Version ?? 1);
  const sx = u16(s.Width), sy = u16(s.Height), sz = u16(s.Length);
  if (!(sx > 0 && sy > 0 && sz > 0)) throw new ErreurNbt('Width/Height/Length absents ou nuls');
  const bl = version >= 3 ? s.Blocks : s;
  if (!bl || !bl.Palette) throw new ErreurNbt(`Sponge v${version} : palette absente`);
  const pal = Object.entries(bl.Palette);
  const n = pal.reduce((m, [, i]) => Math.max(m, entier(i)), -1) + 1;
  const palette = new Array(n).fill('minecraft:air');
  for (const [txt, i] of pal) palette[entier(i)] = VIDE.has(txt.replace(/\[.*$/, '')) ? null : txt;
  const donnees = version >= 3 ? bl.Data : (s.BlockData ?? s.Blocks);
  if (!(donnees instanceof Int8Array)) throw new ErreurNbt(`Sponge v${version} : ${version >= 3 ? 'Blocks.Data' : 'BlockData'} absent`);
  const indices = varints(donnees, sx * sy * sz);
  for (let i = 0; i < indices.length; i++) if (indices[i] >= n) throw new ErreurNbt(`indice de palette ${indices[i]} hors de la palette (${n})`);
  const ents = (version >= 3 ? bl.BlockEntities : (s.BlockEntities ?? s.TileEntities)) || [];
  const entites = ents.map((e) => {
    const p = e.Pos ?? [0, 0, 0];
    const donneesE = version >= 3 ? (e.Data ?? {}) : e;
    return { x: entier(p[0]), y: entier(p[1]), z: entier(p[2]), id: String(e.Id ?? e.id ?? donneesE.id ?? ''), donnees: donneesE };
  });
  // entites (cadres...) : Pos = 3 doubles relatifs a la boite ; v3 : donnees dans Data, v2 : a plat
  const entitesMonde = (Array.isArray(s.Entities) ? s.Entities : []).map((e) => { const p = e.Pos ?? [0, 0, 0], dE = version >= 3 ? (e.Data ?? {}) : e; return { x: Number(p[0]), y: Number(p[1]), z: Number(p[2]), id: String(e.Id ?? dE.id ?? ''), donnees: dE }; });
  return { format: `schem v${version}`, dataVersion: entier(s.DataVersion ?? 0), taille: [sx, sy, sz], palette, indices, entites, entitesMonde };
}

function lireStructure(r) {
  const t = r.size;
  if (!Array.isArray(t) || t.length !== 3) throw new ErreurNbt('structure .nbt : champ size [x, y, z] absent');
  const [sx, sy, sz] = t.map(entier);
  if (!(sx > 0 && sy > 0 && sz > 0)) throw new ErreurNbt('structure .nbt : taille nulle');
  const pals = Array.isArray(r.palette) ? r.palette : Array.isArray(r.palettes) && Array.isArray(r.palettes[0]) ? r.palettes[0] : null;
  if (!pals) throw new ErreurNbt('structure .nbt : palette absente');
  const palette = [null, ...pals.map((e) => { const txt = txtEtat(e.Name ?? e.id, e.Properties ?? e.properties); return VIDE.has(txt) ? null : txt; })];
  const indices = new Uint32Array(sx * sy * sz);   // 0 = non liste : laisse tel quel
  const entites = [];
  for (const b of Array.isArray(r.blocks) ? r.blocks : []) {
    const [x, y, z] = (b.pos ?? []).map(entier);
    const st = entier(b.state);
    if (!(x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz) || !(st >= 0 && st < pals.length)) throw new ErreurNbt(`structure .nbt : bloc hors de la boite ou etat inconnu (pos ${b.pos}, state ${b.state})`);
    indices[(y * sz + z) * sx + x] = st + 1;
    if (b.nbt) entites.push({ x, y, z, id: String(b.nbt.id ?? ''), donnees: b.nbt });
  }
  // entites : { pos (doubles), blockPos (cellule), nbt }
  const entitesMonde = (Array.isArray(r.entities) ? r.entities : []).map((e) => { const p = e.pos ?? e.blockPos ?? [0, 0, 0], b = e.blockPos; return { x: Number(p[0]), y: Number(p[1]), z: Number(p[2]), bloc: Array.isArray(b) ? b.map(entier) : null, id: String(e.nbt?.id ?? ''), donnees: e.nbt ?? {} }; });
  return { format: 'structure nbt', dataVersion: entier(r.DataVersion ?? 0), taille: [sx, sy, sz], palette, indices, entites, entitesMonde };
}

// lecture de `n` valeurs de `bits` bits dans un flux continu de longs (Litematica LitematicaBitArray)
function depaqueter(longs, bits, n) {
  const out = new Uint32Array(n), masque = bits >= 32 ? 0xffffffff : (2 ** bits) - 1;
  if (longs.length * 64 < n * bits) throw new ErreurNbt(`BlockStates trop court (${longs.length} longs pour ${n} cellules de ${bits} bits)`);
  if (os.endianness() === 'LE') {
    const w = new Uint32Array(longs.buffer, longs.byteOffset, longs.length * 2);   // [bas, haut, bas, haut...] : le meme flux de bits
    for (let i = 0; i < n; i++) {
      const bit = i * bits, k = bit >>> 5, dec = bit & 31;
      let v = w[k] >>> dec;
      if (dec + bits > 32) v |= w[k + 1] << (32 - dec);
      out[i] = (v & masque) >>> 0;
    }
    return out;
  }
  const M = BigInt(masque);
  for (let i = 0; i < n; i++) {
    const bit = BigInt(i * bits), k = Number(bit >> 6n), dec = bit & 63n;
    let v = BigInt.asUintN(64, longs[k]) >> dec;
    if (Number(dec) + bits > 64) v |= BigInt.asUintN(64, longs[k + 1]) << (64n - dec);
    out[i] = Number(v & M);
  }
  return out;
}
export const bitsLitematic = (n) => Math.max(2, 32 - Math.clz32(Math.max(1, n - 1)));

function lireLitematic(r) {
  const regs = r.Regions && typeof r.Regions === 'object' ? Object.entries(r.Regions) : [];
  if (!regs.length) throw new ErreurNbt('.litematic : aucune region');
  const boites = regs.map(([nom, g]) => {
    const P = g.Position ?? {}, S = g.Size ?? {};
    const pos = ['x', 'y', 'z'].map((k) => entier(P[k] ?? 0)), t = ['x', 'y', 'z'].map((k) => entier(S[k] ?? 0));
    if (t.some((v) => v === 0)) throw new ErreurNbt(`.litematic : region "${nom}" de taille nulle`);
    return { nom, g, min: pos.map((p, i) => (t[i] < 0 ? p + t[i] + 1 : p)), dim: t.map(Math.abs) };
  });
  const min = [0, 1, 2].map((i) => Math.min(...boites.map((b) => b.min[i])));
  const max = [0, 1, 2].map((i) => Math.max(...boites.map((b) => b.min[i] + b.dim[i])));
  const [sx, sy, sz] = [0, 1, 2].map((i) => max[i] - min[i]);
  if (sx * sy * sz > 64_000_000) throw new ErreurNbt(`.litematic : boite de ${sx} x ${sy} x ${sz} trop grande`);
  const palette = [null], cles = new Map();
  const indices = new Uint32Array(sx * sy * sz);
  const entites = [], entitesMonde = [];
  for (const b of boites) {
    const pl = Array.isArray(b.g.BlockStatePalette) ? b.g.BlockStatePalette : [];
    if (!pl.length) throw new ErreurNbt(`.litematic : region "${b.nom}" sans palette`);
    const vers = pl.map((e) => {
      const txt = txtEtat(e.Name ?? e.id, e.Properties ?? e.properties);
      if (VIDE.has(txt)) return 0;
      let i = cles.get(txt);
      if (i === undefined) { i = palette.length; palette.push(txt); cles.set(txt, i); }
      return i;
    });
    const [lx, ly, lz] = b.dim, n = lx * ly * lz;
    const longs = b.g.BlockStates instanceof BigInt64Array ? b.g.BlockStates : new BigInt64Array(0);
    const v = depaqueter(longs, bitsLitematic(pl.length), n);
    const [ox, oy, oz] = [0, 1, 2].map((i) => b.min[i] - min[i]);
    for (let y = 0; y < ly; y++) for (let z = 0; z < lz; z++) for (let x = 0; x < lx; x++) {
      const k = v[(y * lz + z) * lx + x];
      if (k >= pl.length) throw new ErreurNbt(`.litematic : indice ${k} hors de la palette (${pl.length})`);
      indices[((y + oy) * sz + (z + oz)) * sx + (x + ox)] = vers[k];
    }
    for (const e of Array.isArray(b.g.TileEntities) ? b.g.TileEntities : []) entites.push({ x: entier(e.x) + ox, y: entier(e.y) + oy, z: entier(e.z) + oz, id: String(e.id ?? e.Id ?? ''), donnees: e });
    for (const e of Array.isArray(b.g.Entities) ? b.g.Entities : []) { const p = e.Pos ?? [0, 0, 0]; entitesMonde.push({ x: Number(p[0]) + ox, y: Number(p[1]) + oy, z: Number(p[2]) + oz, id: String(e.id ?? e.Id ?? ''), donnees: e }); }
  }
  return { format: 'litematic', dataVersion: entier(r.MinecraftDataVersion ?? 0), taille: [sx, sy, sz], palette, indices, entites, entitesMonde };
}

// ---- bannieres d'une entite de bloc : [["motif", "couleur"], ...] (format 1.20.5+ `patterns`, ou ancien `Patterns` a codes courts)
const CODES = { b: 'base', bs: 'stripe_bottom', ts: 'stripe_top', ls: 'stripe_left', rs: 'stripe_right', cs: 'stripe_center', ms: 'stripe_middle', drs: 'stripe_downright', dls: 'stripe_downleft', ss: 'small_stripes', cr: 'cross', sc: 'straight_cross', bl: 'square_bottom_left', br: 'square_bottom_right', tl: 'square_top_left', tr: 'square_top_right', bt: 'triangle_bottom', tt: 'triangle_top', bts: 'triangles_bottom', tts: 'triangles_top', ld: 'diagonal_left', rd: 'diagonal_up_right', lud: 'diagonal_up_left', rud: 'diagonal_right', mc: 'circle', mr: 'rhombus', vh: 'half_vertical', hh: 'half_horizontal', vhr: 'half_vertical_right', hhb: 'half_horizontal_bottom', bo: 'border', cbo: 'curly_border', gra: 'gradient', gru: 'gradient_up', bri: 'bricks', glb: 'globe', cre: 'creeper', sku: 'skull', flo: 'flower', moj: 'mojang', pig: 'piglin', flw: 'flow', gus: 'guster' };
export function motifsBanniere(donnees, teintures) {
  const out = [];
  for (const p of Array.isArray(donnees?.patterns) ? donnees.patterns : []) {
    const m = typeof p.pattern === 'string' ? p.pattern.replace(/^minecraft:/, '') : String(p.pattern?.asset_id ?? '').replace(/^minecraft:(banner\/)?/, '');
    out.push([m, String(p.color ?? 'white')]);
  }
  for (const p of Array.isArray(donnees?.Patterns) ? donnees.Patterns : []) out.push([CODES[p.Pattern] ?? String(p.Pattern), teintures[entier(p.Color)] ?? 'white']);
  return out;
}

// ---- ecriture (fichiers d'essai et exemples : jamais de construction de tiers)
// s : { taille, palette: [texte | null], indices, entites?: [{ x, y, z, id, donnees }] }
const parse = (txt) => { const m = /^([^[]+)(?:\[(.*)\])?$/.exec(txt); return { Name: m[1].includes(':') ? m[1] : 'minecraft:' + m[1], Properties: m[2] ? Object.fromEntries(m[2].split(',').map((kv) => kv.split('='))) : null }; };
const palNbt = (txt) => { const p = parse(txt); return p.Properties ? { Name: p.Name, Properties: p.Properties } : { Name: p.Name }; };

export function ecrireSchem(s, { version = 3 } = {}) {
  const [sx, sy, sz] = s.taille;
  const textes = s.palette.map((t) => t ?? 'minecraft:structure_void');
  const Palette = {}; textes.forEach((t, i) => { if (Palette[t] === undefined) Palette[t] = N.int(i); });
  const remap = textes.map((t) => Palette[t].v);
  const Data = N.bytes(versVarints(Array.from(s.indices, (i) => remap[i])));
  const ents = (s.entites ?? []).map((e) => (version >= 3 ? { Pos: N.ints(Int32Array.of(e.x, e.y, e.z)), Id: e.id, Data: N.compose(e.donnees ?? {}) } : { ...(e.donnees ?? {}), Pos: N.ints(Int32Array.of(e.x, e.y, e.z)), Id: e.id }));
  const corps = { Version: N.int(version), DataVersion: N.int(DATA_VERSION), Width: N.short(sx), Height: N.short(sy), Length: N.short(sz), Offset: N.ints(Int32Array.of(0, 0, 0)) };
  const posD = (e) => N.liste(6, [N.double(e.x), N.double(e.y), N.double(e.z)]);
  const em = (s.entitesMonde ?? []).map((e) => N.compose(version >= 3 ? { Pos: posD(e), Id: e.id, Data: N.compose(e.donnees ?? {}) } : { ...(e.donnees ?? {}), Pos: posD(e), Id: e.id }));
  if (version >= 3) return ecrireNbt({ Schematic: N.compose({ ...corps, Blocks: N.compose({ Palette: N.compose(Palette), Data, BlockEntities: N.liste(10, ents.map(N.compose)) }), Entities: N.liste(10, em) }) });
  return ecrireNbt({ ...corps, PaletteMax: N.int(Object.keys(Palette).length), Palette: N.compose(Palette), BlockData: Data, BlockEntities: N.liste(10, ents.map(N.compose)), Entities: N.liste(10, em) }, { nom: 'Schematic' });
}

export function ecrireStructure(s) {
  const [sx, sy, sz] = s.taille;
  const pal = [], vers = s.palette.map((t) => { if (t === null) return -1; pal.push(palNbt(t)); return pal.length - 1; });
  const ent = new Map((s.entites ?? []).map((e) => [`${e.x},${e.y},${e.z}`, e]));
  const blocks = [];
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const st = vers[s.indices[(y * sz + z) * sx + x]];
    if (st < 0) continue;
    const b = { state: N.int(st), pos: N.liste(3, [N.int(x), N.int(y), N.int(z)]) };
    const e = ent.get(`${x},${y},${z}`);
    if (e) b.nbt = N.compose({ ...(e.donnees ?? {}), id: e.id });
    blocks.push(N.compose(b));
  }
  return ecrireNbt({ DataVersion: N.int(DATA_VERSION), size: N.liste(3, [N.int(sx), N.int(sy), N.int(sz)]), palette: N.liste(10, pal.map((p) => N.compose(p.Properties ? { Name: p.Name, Properties: N.compose(p.Properties) } : { Name: p.Name }))), blocks: N.liste(10, blocks),
    entities: N.liste(10, (s.entitesMonde ?? []).map((e) => N.compose({ pos: N.liste(6, [N.double(e.x), N.double(e.y), N.double(e.z)]), blockPos: N.liste(3, [N.int(Math.floor(e.x)), N.int(Math.floor(e.y)), N.int(Math.floor(e.z))]), nbt: N.compose({ ...(e.donnees ?? {}), id: e.id }) }))) });
}

// regions : [{ nom, position: [x, y, z], taille: [sx, sy, sz] (negatif permis : la boite s'etend vers les coordonnees decroissantes), s }]
// ou s est la forme commune de la region (taille = valeurs absolues). Sans `regions` : une seule region a l'origine.
export function ecrireLitematic(s, { regions = null } = {}) {
  const liste = regions ?? [{ nom: 'principale', position: [0, 0, 0], taille: s.taille, s }];
  const R = {};
  let vol = 0, blocs = 0;
  for (const r of liste) {
    const [lx, ly, lz] = r.s.taille, n = lx * ly * lz;
    const textes = r.s.palette.map((t) => t ?? 'minecraft:air');
    const pal = [...new Set(['minecraft:air', ...textes])], ix = textes.map((t) => pal.indexOf(t));
    const bits = bitsLitematic(pal.length), longs = new BigInt64Array(Math.ceil(n * bits / 64));
    for (let i = 0; i < n; i++) {
      const v = BigInt(ix[r.s.indices[i]]), bit = BigInt(i * bits), k = Number(bit >> 6n), dec = bit & 63n;
      longs[k] = BigInt.asIntN(64, BigInt.asUintN(64, longs[k]) | ((v << dec) & 0xffffffffffffffffn));
      if (Number(dec) + bits > 64) longs[k + 1] = BigInt.asIntN(64, BigInt.asUintN(64, longs[k + 1]) | (v >> (64n - dec)));
      if (pal[ix[r.s.indices[i]]] !== 'minecraft:air') blocs++;
    }
    vol += n;
    R[r.nom] = N.compose({
      Position: N.compose({ x: N.int(r.position[0]), y: N.int(r.position[1]), z: N.int(r.position[2]) }),
      Size: N.compose({ x: N.int(r.taille[0]), y: N.int(r.taille[1]), z: N.int(r.taille[2]) }),
      BlockStatePalette: N.liste(10, pal.map((t) => { const p = parse(t); return N.compose(p.Properties ? { Name: p.Name, Properties: N.compose(p.Properties) } : { Name: p.Name }); })),
      BlockStates: N.longs(longs),
      TileEntities: N.liste(10, (r.s.entites ?? []).map((e) => N.compose({ ...(e.donnees ?? {}), id: e.id, x: N.int(e.x), y: N.int(e.y), z: N.int(e.z) }))),
      Entities: N.liste(10, (r.s.entitesMonde ?? []).map((e) => N.compose({ ...(e.donnees ?? {}), id: e.id, Pos: N.liste(6, [N.double(e.x), N.double(e.y), N.double(e.z)]) }))), PendingBlockTicks: N.liste(10, []), PendingFluidTicks: N.liste(10, []),
    });
  }
  const t = s.taille;
  return ecrireNbt({ MinecraftDataVersion: N.int(DATA_VERSION), Version: N.int(6), Metadata: N.compose({ Name: 'essai', Author: 'mcanim', RegionCount: N.int(liste.length), TotalVolume: N.int(vol), TotalBlocks: N.int(blocs), EnclosingSize: N.compose({ x: N.int(t[0]), y: N.int(t[1]), z: N.int(t[2]) }) }), Regions: N.compose(R) });
}
