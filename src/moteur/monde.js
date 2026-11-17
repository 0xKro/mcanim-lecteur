// Monde de simulation : la boite de blocs de la zone, modifiable. Une seule structure sert a la simulation ET au rendu
// (le rendu en garde sa propre copie et lui rejoue les changements du replay).
//
// Disposition : tableau `pal` "rembourre" d'une cellule de chaque cote (indice ((ly+1)*PZ+(lz+1))*PX+(lx+1), coordonnees locales
// = monde - origine), exactement comme le mailleur (rendu/maillage.js) : le mailleur lit ces tableaux sur place.
// Les valeurs sont des indices de PALETTE (celle de la zone, qui s'allonge quand un nouveau bloc est pose) ; des tables par
// indice (etat du jeu, opacite, emission...) viennent des donnees du jeu.
//
// Cellules inconnues : la zone est une boite serree autour du terrain ; sous la surface elle ne garde que les blocs visibles,
// le reste est `#hidden` (indice 1) = bloc plein inconnu. Regle (voir docs/SIMULATION.md, "P0 livre") :
//   - tant qu'il reste enterre, `#hidden` est un cube opaque (lumiere 15, rien n'est dessine) ;
//   - quand un voisin devient transparent ou vide, il est DEVOILE : remplace par un bloc de remplissage plausible, selon la
//     profondeur sous la surface de la colonne et le biome (sable ou terre pres de la surface, pierre, schiste des profondeurs sous y=0).
//   - hors de la boite : sous la surface de la colonne la plus proche = `#hidden`, au-dessus = air (comme avant dans le mailleur).
// La boite grandit (vers le haut et les cotes, par pas de 16) quand on pose un bloc dehors, dans des limites.
import { D } from './donnees.js';

export const FACE_DX = [0, 0, 0, 0, -1, 1], FACE_DY = [-1, 1, 0, 0, 0, 0], FACE_DZ = [0, 0, -1, 1, 0, 0];   // bas, haut, nord, sud, ouest, est
export const FACE_OPPOSEE = [1, 0, 3, 2, 5, 4];
// Ordres du jeu (NeighborUpdater.UPDATE_ORDER et BlockBehaviour.UPDATE_SHAPE_ORDER), en indices de face ci-dessus
export const ORDRE_VOISINS = [4, 5, 0, 1, 2, 3];     // ouest, est, bas, haut, nord, sud
export const ORDRE_FORMES = [4, 5, 2, 3, 0, 1];      // ouest, est, nord, sud, bas, haut
export const Y_MIN = -64, Y_MAX = 320;               // hauteur du monde (Y_MAX exclu)
export const LIMITES = { cotes: 512, cellules: 60_000_000 };

const NIVEAU_MAX = 15;

export class Monde {
  // zone : rendu/zone.js ; donnees : moteur/donnees.js ; options : { lumiere: true|false (calcul de la lumiere), suivi: true (liste des cellules salies pour le rendu) }
  constructor({ zone, donnees, suivi = false }) {
    this.zone = zone; this.d = donnees;
    this.ancre = [zone.x0, zone.y0, zone.z0];
    this.haut0 = zone.y0 + zone.sy;           // sommet de la boite d'origine
    this.palette = zone.palette.slice();
    this.indexPalette = new Map(this.palette.map((p, i) => [p, i]));
    const CAP = 65536;
    this.tEtat = new Int32Array(CAP).fill(-1); this.tOpac = new Uint8Array(CAP); this.tEmis = new Uint8Array(CAP);
    this.tOcc = new Uint8Array(CAP); this.tDrap = new Uint16Array(CAP);
    for (let i = 0; i < this.palette.length; i++) this._remplirTable(i);
    this._poserGeometrie(zone.x0, zone.y0, zone.z0, zone.sx, zone.sy, zone.sz);
    this.pal = new Uint16Array(this.PX * this.PY * this.PZ);
    this._copierZone();
    this.ciel = null; this.bloc = null; this.lumiere = null;
    this.version = 0;                         // +1 a chaque ecriture
    this.changes = [];                        // journal en cours : [x, y, z, ancienIndice, nouveauIndice, ...] mis a plat
    this.suivi = suivi; this.sales = [];      // cellules (indice rembourre) changees depuis le dernier `viderSales` (rendu)
    this.agrandissements = 0;
  }

  _poserGeometrie(x0, y0, z0, sx, sy, sz) {
    this.x0 = x0; this.y0 = y0; this.z0 = z0; this.sx = sx; this.sy = sy; this.sz = sz;
    this.PX = sx + 2; this.PY = sy + 2; this.PZ = sz + 2;
    this.OY = this.PX * this.PZ; this.OZ = this.PX;
  }
  // indice rembourre d'une cellule en coordonnees locales
  idx(lx, ly, lz) { return ((ly + 1) * this.PZ + (lz + 1)) * this.PX + (lx + 1); }
  idxMonde(x, y, z) { return this.idx(x - this.x0, y - this.y0, z - this.z0); }
  dansBoite(x, y, z) { const lx = x - this.x0, ly = y - this.y0, lz = z - this.z0; return lx >= 0 && ly >= 0 && lz >= 0 && lx < this.sx && ly < this.sy && lz < this.sz; }
  dansRembourre(x, y, z) { const lx = x - this.x0, ly = y - this.y0, lz = z - this.z0; return lx >= -1 && ly >= -1 && lz >= -1 && lx <= this.sx && ly <= this.sy && lz <= this.sz; }

  // cellule virtuelle (hors boite) : indice de palette 0 (air) ou 1 (#hidden)
  virtuel(x, y, z) {
    if (y < this.ancre[1]) return 1;
    if (y >= this.haut0) return 0;
    return y <= this.zone.hauteur(x, z) ? 1 : 0;
  }
  _copierZone() {
    const z = this.zone, { pal } = this;
    for (let y = 0; y < z.sy; y++) for (let zz = 0; zz < z.sz; zz++) {
      const src = (y * z.sz + zz) * z.sx, dst = this.idx(0, y, zz);
      for (let x = 0; x < z.sx; x++) pal[dst + x] = z.cellules[src + x];
    }
    this._remplirBordure();
  }
  _remplirBordure() {
    const { sx, sy, sz, pal } = this;
    for (let y = -1; y <= sy; y++) for (let z = -1; z <= sz; z++) for (let x = -1; x <= sx; x++) {
      if (x >= 0 && x < sx && z >= 0 && z < sz && y >= 0 && y < sy) continue;
      pal[this.idx(x, y, z)] = this.virtuel(this.x0 + x, this.y0 + y, this.z0 + z);
    }
  }

  // ---- palette
  _remplirTable(i) {
    const d = this.d, s = this.palette[i];
    if (i === 1 || s === '#hidden') { this.tEtat[i] = -1; this.tOpac[i] = 15; this.tEmis[i] = 0; this.tOcc[i] = 63; this.tDrap[i] = D.RENDU_PLEIN | D.PEUT_OCCLURE | D.COLLISION_PLEINE; return; }
    let id = d.etatId(s);
    if (id < 0) id = d.pierre;      // etat inconnu des donnees : cube plein (le mailleur dira qu'il ne sait pas le dessiner)
    this.tEtat[i] = id; this.tOpac[i] = d.opacite(id); this.tEmis[i] = d.emission(id); this.tDrap[i] = d.drapeaux(id);
    let occ = 0;
    if (d.a(id, D.OCCLUSION_FORME)) for (let f = 0; f < 6; f++) if (d.solideFace(id, f)) occ |= 1 << f;
    this.tOcc[i] = occ;
  }
  // indice de palette d'un texte d'etat ('minecraft:torch', 'torch[...]', '#hidden') ; ajoute l'entree si besoin
  indicePalette(txt) {
    let i = this.indexPalette.get(txt);
    if (i !== undefined) return i;
    if (txt !== '#hidden') {
      const id = this.d.etatId(txt);
      if (id < 0) throw new Error(`bloc inconnu : "${txt}"`);
      const canon = this.d.chaine(id);
      i = this.indexPalette.get(canon);
      if (i !== undefined) { this.indexPalette.set(txt, i); return i; }
      txt = canon;
    }
    if (this.palette.length >= 65535) throw new Error('palette pleine (65535 etats differents)');
    i = this.palette.length;
    this.palette.push(txt); this.indexPalette.set(txt, i);
    this._remplirTable(i);
    return i;
  }
  indicePaletteEtat(id) { return this.indicePalette(this.d.chaine(id)); }
  etatDe(i) { return this.tEtat[i]; }

  // ---- lecture
  indiceEn(x, y, z) {
    const lx = x - this.x0, ly = y - this.y0, lz = z - this.z0;
    if (lx < -1 || ly < -1 || lz < -1 || lx > this.sx || ly > this.sy || lz > this.sz) return this.virtuel(x, y, z);
    return this.pal[((ly + 1) * this.PZ + (lz + 1)) * this.PX + (lx + 1)];
  }
  // numero d'etat du jeu en (x,y,z) (-1 : cellule cachee inconnue)
  etatEn(x, y, z) { return this.tEtat[this.indiceEn(x, y, z)]; }

  // ---- ecriture brute : indice de palette. Rend l'ancien indice, ou -1 si rien n'a change / hors limites.
  ecrire(x, y, z, indice) {
    if (y < Y_MIN || y >= Y_MAX) return -1;
    if (!this.dansBoite(x, y, z) && !this.agrandir(x, y, z)) return -1;
    const i = this.idxMonde(x, y, z), ancien = this.pal[i];
    if (ancien === indice) return -1;
    this.pal[i] = indice;
    this.version++;
    this.changes.push(x, y, z, ancien, indice);
    // les cellules de la bordure copient leur voisin de la boite (cache sous la surface) : on ne les touche pas
    if (this.suivi && this.sales) this.sales.push(i);
    if (this.lumiere) this.lumiere.changer(x, y, z, ancien, indice);
    return ancien;
  }

  // Devoile les cellules `#hidden` voisines si (x,y,z) vient de devenir non opaque. Rend le nombre de cellules devoilees.
  devoiler(x, y, z) {
    const i = this.indiceEn(x, y, z);
    if (this.tOpac[i] >= 15 && this.tOcc[i] === 63) return 0;
    let n = 0;
    for (let f = 0; f < 6; f++) {
      const nx = x + FACE_DX[f], ny = y + FACE_DY[f], nz = z + FACE_DZ[f];
      if (!this.dansBoite(nx, ny, nz) || this.pal[this.idxMonde(nx, ny, nz)] !== 1) continue;
      this.ecrire(nx, ny, nz, this.indicePalette(this.remplissage(nx, ny, nz)));
      n++;
    }
    return n;
  }
  // Bloc de remplissage plausible d'une cellule cachee (deterministe : ne depend que de la position et de la zone)
  remplissage(x, y, z) {
    const h = ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0) % 8;
    if (y < 0) return 'minecraft:deepslate[axis=y]';
    if (y < 8 && h > y) return 'minecraft:deepslate[axis=y]';
    const prof = this.zone.hauteur(x, z) - y;
    if (prof >= 1 && prof <= 3) {
      const b = this.zone.biome(x, z) || '';
      if (/desert|beach|badlands/.test(b)) return /badlands/.test(b) ? 'minecraft:terracotta' : 'minecraft:sand';
      return 'minecraft:dirt';
    }
    return 'minecraft:stone';
  }

  // ---- croissance de la boite (vers le haut et les cotes, par pas de 16 cellules, ancree sur l'origine de la zone)
  // Rend faux si la limite est atteinte (la pose est alors refusee).
  agrandir(x, y, z) {
    if (y < this.y0 || y >= Y_MAX) return false;                            // pas de croissance vers le bas : le sous-sol reste cache
    const a = this.ancre;
    const nx0 = Math.min(this.x0, Math.floor((x - a[0]) / 16) * 16 + a[0]), nz0 = Math.min(this.z0, Math.floor((z - a[2]) / 16) * 16 + a[2]);
    const nx1 = Math.max(this.x0 + this.sx, (Math.floor((x - a[0]) / 16) + 1) * 16 + a[0]), nz1 = Math.max(this.z0 + this.sz, (Math.floor((z - a[2]) / 16) + 1) * 16 + a[2]);
    const ny1 = Math.max(this.y0 + this.sy, (Math.floor((y - a[1]) / 16) + 1) * 16 + a[1]);
    const sx = nx1 - nx0, sy = ny1 - this.y0, sz = nz1 - nz0;
    if (sx > LIMITES.cotes || sz > LIMITES.cotes || (sx + 2) * (sy + 2) * (sz + 2) > LIMITES.cellules) return false;
    const vieux = { x0: this.x0, y0: this.y0, z0: this.z0, sx: this.sx, sy: this.sy, sz: this.sz, PX: this.PX, PZ: this.PZ, pal: this.pal };
    this._poserGeometrie(nx0, this.y0, nz0, sx, sy, sz);
    this.pal = new Uint16Array(this.PX * this.PY * this.PZ);
    for (let ly = -1; ly <= sy; ly++) for (let lz = -1; lz <= sz; lz++) {      // tout le volume : cellules virtuelles
      const base = this.idx(-1, ly, lz);
      for (let lx = -1; lx <= sx; lx++) this.pal[base + lx + 1] = this.virtuel(nx0 + lx, this.y0 + ly, nz0 + lz);
    }
    for (let y2 = 0; y2 < vieux.sy; y2++) for (let z2 = 0; z2 < vieux.sz; z2++) {   // anciennes cellules de la boite
      const src = ((y2 + 1) * vieux.PZ + (z2 + 1)) * vieux.PX + 1;
      this.pal.set(vieux.pal.subarray(src, src + vieux.sx), this.idxMonde(vieux.x0, vieux.y0 + y2, vieux.z0 + z2));
    }
    this.agrandissements++;
    this.version++;
    if (this.suivi) this.sales = null;     // tout est a refaire : le mailleur du rendu repart de zero
    if (this.lumiere) this.lumiere.recommencer();
    return true;
  }
}
