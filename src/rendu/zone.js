// Lecture d'un fichier .mcz (voir zonegen/FORMAT.md) : tableaux typés + palette.
// Coordonnées MONDE partout dans l'API (x vers l'est, y vers le haut, z vers le sud).
import fs from 'node:fs';
import zlib from 'node:zlib';

export class Zone {
  // En-tete JSON, indices de palette par cellule, biome par colonne, hauteur par colonne.
  constructor(hdr, cellules, biomes, hauteurs) {
    this.hdr = hdr;
    this.palette = hdr.palette;
    this.biomesNoms = hdr.biomes;
    [this.x0, this.y0, this.z0] = hdr.origine;
    [this.sx, this.sy, this.sz] = hdr.taille;
    this.cellules = cellules; // Uint16Array (Uint32Array si la palette depasse 65536 entrees), indice (y*sz+z)*sx+x en coordonnees locales
    this.biomes = biomes; // Uint8Array sx*sz
    this.hauteurs = hauteurs; // Int16Array sx*sz (Y monde)
  }

  // Indice de palette en coordonnees monde, ou 0 (air) hors de la zone.
  paletteEn(x, y, z) {
    const lx = x - this.x0, ly = y - this.y0, lz = z - this.z0;
    if (lx < 0 || ly < 0 || lz < 0 || lx >= this.sx || ly >= this.sy || lz >= this.sz) return 0;
    return this.cellules[(ly * this.sz + lz) * this.sx + lx];
  }

  // Etat de bloc (texte) en coordonnees monde. Hors zone : 'minecraft:air'.
  bloc(x, y, z) { return this.palette[this.paletteEn(x, y, z)]; }

  dansZone(x, z) { const lx = x - this.x0, lz = z - this.z0; return lx >= 0 && lz >= 0 && lx < this.sx && lz < this.sz; }

  // Hauteur MOTION_BLOCKING (Y monde) de la colonne, bornee à la colonne la plus proche si hors zone.
  hauteur(x, z) {
    const lx = Math.min(this.sx - 1, Math.max(0, x - this.x0)), lz = Math.min(this.sz - 1, Math.max(0, z - this.z0));
    return this.hauteurs[lz * this.sx + lx];
  }

  // Nom du biome (ex. 'minecraft:forest') de la colonne.
  biome(x, z) {
    const lx = Math.min(this.sx - 1, Math.max(0, x - this.x0)), lz = Math.min(this.sz - 1, Math.max(0, z - this.z0));
    return this.biomesNoms[this.biomes[lz * this.sx + lx]];
  }
}

// Lit un fichier .mcz (chemin) ou un Buffer deja lu. Refuse un fichier incorrect.
export function lireZone(source) {
  const brut = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
  const buf = zlib.gunzipSync(brut);
  if (buf.toString('latin1', 0, 4) !== 'MCZ1') throw new Error("pas un fichier .mcz (signature MCZ1 absente)");
  const H = buf.readUInt32LE(4);
  const hdr = JSON.parse(buf.toString('utf8', 8, 8 + H));
  if (hdr.v !== 1) throw new Error('version de .mcz non gérée : ' + hdr.v);
  const [sx, sy, sz] = hdr.taille;
  const N = sx * sy * sz;
  let p = 8 + H;
  const leb = () => {
    let v = 0, m = 1, b;
    do {
      if (p >= buf.length) throw new Error('.mcz tronqué');
      b = buf[p++]; v += (b & 0x7f) * m; m *= 128;
    } while (b & 0x80);
    return v;
  };
  // 2 octets par cellule (palette de 65536 entrees au plus, comme le moteur) : une zone de 1025 x 1025 x 384 tient en 0,8 Go
  const cellules = hdr.palette.length <= 65536 ? new Uint16Array(N) : new Uint32Array(N);
  for (let i = 0; i < N;) {
    const run = leb(), id = leb();
    if (run < 1 || i + run > N) throw new Error('.mcz : séquence hors limites');
    if (id >= hdr.palette.length) throw new Error('.mcz : indice de palette hors limites');
    cellules.fill(id, i, i + run); i += run;
  }
  const nc = sx * sz;
  if (p + nc * 3 !== buf.length) throw new Error(`.mcz : taille inattendue (${buf.length - p - nc * 3} octets en trop ou en moins)`);
  const biomes = new Uint8Array(buf.subarray(p, p + nc)); p += nc;
  const hauteurs = new Int16Array(nc);
  for (let i = 0; i < nc; i++, p += 2) hauteurs[i] = buf.readInt16LE(p);
  return new Zone(hdr, cellules, biomes, hauteurs);
}

// Écrit un .mcz (utilisé par les tests pour fabriquer des zones synthétiques).
// zone = { hdr (sans v/jeu obligatoires), cellules: Uint32Array, biomes: Uint8Array, hauteurs: Int16Array }
export function ecrireZone({ hdr, cellules, biomes, hauteurs }) {
  const h = Buffer.from(JSON.stringify({ v: 1, jeu: '26.3', dimension: 'overworld', ...hdr }), 'utf8');
  const parts = [Buffer.from('MCZ1', 'latin1'), Buffer.alloc(4), h];
  parts[1].writeUInt32LE(h.length, 0);
  const octets = [];
  const leb = (v) => { while (v >= 128) { octets.push((v % 128) | 128); v = Math.floor(v / 128); } octets.push(v); };
  for (let i = 0; i < cellules.length;) {
    let j = i + 1;
    while (j < cellules.length && cellules[j] === cellules[i]) j++;
    leb(j - i); leb(cellules[i]); i = j;
  }
  parts.push(Buffer.from(octets), Buffer.from(biomes));
  const hb = Buffer.alloc(hauteurs.length * 2);
  for (let i = 0; i < hauteurs.length; i++) hb.writeInt16LE(hauteurs[i], i * 2);
  parts.push(hb);
  return zlib.gzipSync(Buffer.concat(parts));
}
