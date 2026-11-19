// La grille de travail d'un decor : une COPIE modifiable de la zone (cellules, biomes, hauteurs), qui peut grandir vers le haut et les cotes
// (comme le monde du moteur : par pas de 16, ancree sur l'origine de la zone). La zone d'origine n'est jamais modifiee.
// Tout se passe AVANT le premier tick et le maillage : la zone rendue par `versZone()` est ensuite lue par le moteur et le rendu comme une zone ordinaire.
import { Zone } from '../rendu/zone.js';

export class ErreurDecor extends Error {
  constructor(lignes, fichier = null) {
    const l = Array.isArray(lignes) ? lignes : [lignes];
    super(l.slice(0, 10).join('\n') + (l.length > 10 ? `\n... et ${l.length - 10} autre(s) erreur(s)` : ''));
    this.name = 'ErreurDecor'; this.lignes = l; this.fichier = fichier;
  }
}

export const Y_MIN = -64, Y_MAX = 320;
// Boite de travail : 1536 de cote au plus ; cellules : une zone de 1025 x 1025 (rayon 512, la plus grande) agrandie de 16 de chaque cote, sur toute la
// hauteur du monde (1057 x 1057 x 386 = 431 M ; 2 octets par cellule, comme moteur/monde.js)
const COTES_MAX = 1536, CELLULES_MAX = 432_000_000;
// Limites (docs/FORMAT-DECOR.md B2.3 et partie D) : un chateau detaille tient dans un decor. Emprise : le cote de la plus grande zone
// (rayon 512 : 1025 ; 768 au moins), 384 de haut (tout le monde, y -64..319). `volume` : boite parcourue par une seule operation (plein,
// grille, importer, copier...) ; `palette` : entrees d'une grille ; `importOctets` : fichier .schem/.nbt/.litematic cite par `importer`.
const ZONE_COTE_MAX = 2 * 512 + 1;
export const LIMITES = {
  ops: 50000, cellules: 8_000_000, largeur: Math.max(768, ZONE_COTE_MAX), hauteur: Y_MAX - Y_MIN, decors: 32, alias: 256, melange: 16,
  octets: 4 * 1024 * 1024, octetsTotal: 64 * 1024 * 1024, ligne: 2000, volume: 16_000_000, palette: 4096, importOctets: 32 * 1024 * 1024,
};
// "toutes les proprietes sont figees" (blocs importes : etats gardes tels que le fichier les donne)
export const TOUT = Object.freeze({ tout: true, has: () => true });

export class Grille {
  constructor(zone, d) {
    this.d = d;
    this.hdr = zone.hdr; this.biomesNoms = zone.biomesNoms;
    this.palette = zone.palette.slice(); this.pidx = new Map(this.palette.map((p, i) => [p, i]));
    this.x0 = zone.x0; this.y0 = zone.y0; this.z0 = zone.z0; this.sx = zone.sx; this.sy = zone.sy; this.sz = zone.sz;
    this.cells = new Uint16Array(zone.cellules);this.biomes = zone.biomes.slice(); this.hauteurs = zone.hauteurs.slice();
    this.ancre = [zone.x0, zone.y0, zone.z0];
    this.etatPal = [];                 // indice de palette -> numero d'etat du jeu (-1 : #hidden)
    this.palEtat = new Map();          // numero d'etat du jeu -> indice de palette (memo de poserEtat)
    this.forces = new Map();           // cle de cellule -> Set de proprietes ecrites par le modele (le calcul automatique ne les touche pas)
    this.agrandissements = 0;
    this.debut();
  }

  // ---- un decor : journal des cellules ecrites depuis le debut
  debut() {
    this.orig = this.cells.slice();    // etat au debut du decor (pour compter les differences)
    this.marque = new Uint8Array(this.cells.length);
    this.journal = [];                 // indices lineaires des cellules ecrites au moins une fois
    this.forces.clear();
    this.fige = null;                  // proprietes figees EN MASSE (grille, importer, copier) : numero de jeu de cles par cellule, 0 = aucun (cree a la demande)
    this.jeux = [null]; this.jeuxIdx = new Map();
    this.colonnes = new Set();         // colonnes touchees (hauteurs a recalculer)
    this.cachees = 0;                  // cellules cachees comblees
  }

  idx(x, y, z) { return ((y - this.y0) * this.sz + (z - this.z0)) * this.sx + (x - this.x0); }
  dans(x, y, z) { const lx = x - this.x0, ly = y - this.y0, lz = z - this.z0; return lx >= 0 && ly >= 0 && lz >= 0 && lx < this.sx && ly < this.sy && lz < this.sz; }
  dansXZ(x, z) { const lx = x - this.x0, lz = z - this.z0; return lx >= 0 && lz >= 0 && lx < this.sx && lz < this.sz; }
  xyz(i) { const sxz = this.sx * this.sz, ly = Math.floor(i / sxz), r = i - ly * sxz, lz = Math.floor(r / this.sx); return [r - lz * this.sx + this.x0, ly + this.y0, lz + this.z0]; }
  cle(x, y, z) { return ((y + 64) * 1048576 + (x + 524288)) * 1048576 + (z + 524288); }
  hautColonne(x, z) {   // hauteur de la colonne la plus proche (comme Zone.hauteur)
    const lx = Math.min(this.sx - 1, Math.max(0, x - this.x0)), lz = Math.min(this.sz - 1, Math.max(0, z - this.z0));
    return this.hauteurs[lz * this.sx + lx];
  }

  // ---- lecture
  // indice de palette (cellule virtuelle hors de la boite : #hidden sous la surface de la colonne la plus proche, air au-dessus)
  pal(x, y, z) {
    if (this.dans(x, y, z)) return this.cells[this.idx(x, y, z)];
    if (y < this.y0) return 1;
    if (y >= this.y0 + this.sy) return 0;
    return y <= this.hautColonne(x, z) ? 1 : 0;
  }
  // numero d'etat du jeu (-1 : #hidden)
  etat(x, y, z) { return this.etatDePal(this.pal(x, y, z)); }
  etatDePal(i) {
    let e = this.etatPal[i];
    if (e === undefined) {
      const t = this.palette[i];
      e = t === '#hidden' ? -1 : this.d.etatId(t);
      if (e === -2 || (e < 0 && t !== '#hidden')) e = this.d.pierre;   // etat que les donnees ne connaissent pas : cube plein
      this.etatPal[i] = e;
    }
    return e;
  }
  bloc(x, y, z) { const e = this.etat(x, y, z); return e < 0 ? -1 : this.d.blocDe(e); }
  texte(x, y, z) { return this.palette[this.pal(x, y, z)]; }

  // ---- ecriture
  palIdx(texte) {
    let i = this.pidx.get(texte);
    if (i !== undefined) return i;
    if (this.palette.length >= 65535) throw new ErreurDecor('palette pleine (65535 etats de blocs differents)');
    i = this.palette.length; this.palette.push(texte); this.pidx.set(texte, i);
    return i;
  }
  poserEtat(x, y, z, id) {
    let p = this.palEtat.get(id);
    if (p === undefined) { p = this.palIdx(this.d.chaine(id)); this.palEtat.set(id, p); }
    return this.poserPal(x, y, z, p);
  }
  poserCache(x, y, z) { return this.poserPal(x, y, z, 1); }
  // Rend vrai si la cellule a change. Leve ErreurDecor si la cellule est hors des limites du monde.
  poserPal(x, y, z, p) {
    if (!this.dans(x, y, z)) {
      if (y < this.y0) throw new ErreurDecor(`le decor descend sous le bas de la zone : bloc (${x},${y},${z}) ; le bas de la zone est y=${this.y0} (sous-sol cache, jamais agrandi vers le bas)`);
      if (y >= Y_MAX) throw new ErreurDecor(`le decor monte trop haut : bloc (${x},${y},${z}) ; le monde s'arrete a y=${Y_MAX - 1}`);
      this.agrandir(x, y, z);
    }
    const i = this.idx(x, y, z);
    if (this.cells[i] === p) return false;
    this.cells[i] = p;
    if (!this.marque[i]) {
      this.marque[i] = 1; this.journal.push(i);
      if (this.journal.length > LIMITES.cellules) throw new ErreurDecor(`plus de ${LIMITES.cellules} cellules changees par decor (limite) : reduis la taille ou coupe en deux decors`);
    }
    this.colonnes.add((z - this.z0) * this.sx + (x - this.x0));
    return true;
  }

  // ---- croissance de la boite (vers le haut et les cotes) : meme regle que moteur/monde.js
  agrandir(x, y, z) {
    const a = this.ancre;
    const nx0 = Math.min(this.x0, Math.floor((x - a[0]) / 16) * 16 + a[0]), nz0 = Math.min(this.z0, Math.floor((z - a[2]) / 16) * 16 + a[2]);
    const nx1 = Math.max(this.x0 + this.sx, (Math.floor((x - a[0]) / 16) + 1) * 16 + a[0]), nz1 = Math.max(this.z0 + this.sz, (Math.floor((z - a[2]) / 16) + 1) * 16 + a[2]);
    const ny1 = Math.max(this.y0 + this.sy, (Math.floor((y - a[1]) / 16) + 1) * 16 + a[1]);
    const sx = nx1 - nx0, sy = ny1 - this.y0, sz = nz1 - nz0;
    if (sx > COTES_MAX || sz > COTES_MAX || (sx + 2) * (sy + 2) * (sz + 2) > CELLULES_MAX) throw new ErreurDecor(`le decor sort de la zone trop loin : bloc (${x},${y},${z}) ; la boite ne peut pas depasser ${COTES_MAX} de cote`);
    const vieux = { x0: this.x0, z0: this.z0, sx: this.sx, sy: this.sy, sz: this.sz, cells: this.cells, orig: this.orig, marque: this.marque, fige: this.fige, biomes: this.biomes, hauteurs: this.hauteurs, cols: [...this.colonnes].map((c) => [c % this.sx + this.x0, Math.floor(c / this.sx) + this.z0]) };
    const hv = (xx, zz) => { const lx = Math.min(vieux.sx - 1, Math.max(0, xx - vieux.x0)), lz = Math.min(vieux.sz - 1, Math.max(0, zz - vieux.z0)); return lz * vieux.sx + lx; };
    this.x0 = nx0; this.z0 = nz0; this.sx = sx; this.sy = sy; this.sz = sz;
    const N = sx * sy * sz;
    this.cells = new Uint16Array(N); this.orig = new Uint16Array(N); this.marque = new Uint8Array(N); this.fige = vieux.fige ? new Uint16Array(N) : null;
    this.biomes = new Uint8Array(sx * sz); this.hauteurs = new Int16Array(sx * sz);
    for (let zz = 0; zz < sz; zz++) for (let xx = 0; xx < sx; xx++) {   // colonnes : celles de la colonne la plus proche de l'ancienne boite
      const k = hv(xx + nx0, zz + nz0);
      this.biomes[zz * sx + xx] = vieux.biomes[k]; this.hauteurs[zz * sx + xx] = vieux.hauteurs[k];
    }
    for (let yy = 0; yy < sy; yy++) for (let zz = 0; zz < sz; zz++) for (let xx = 0; xx < sx; xx++) {   // cellules virtuelles : cache sous la surface, air au-dessus
      const v = (yy + this.y0) <= this.hauteurs[zz * sx + xx] ? 1 : 0;
      if (v) { const i = (yy * sz + zz) * sx + xx; this.cells[i] = 1; this.orig[i] = 1; }
    }
    for (let yy = 0; yy < vieux.sy; yy++) for (let zz = 0; zz < vieux.sz; zz++) {   // anciennes cellules
      const src = (yy * vieux.sz + zz) * vieux.sx, dst = this.idx(vieux.x0, yy + this.y0, zz + vieux.z0);
      this.cells.set(vieux.cells.subarray(src, src + vieux.sx), dst);
      this.orig.set(vieux.orig.subarray(src, src + vieux.sx), dst);
      this.marque.set(vieux.marque.subarray(src, src + vieux.sx), dst);
      if (this.fige) this.fige.set(vieux.fige.subarray(src, src + vieux.sx), dst);
    }
    for (let zz = 0; zz < vieux.sz; zz++) for (let xx = 0; xx < vieux.sx; xx++) {   // hauteurs et biomes d'origine
      const k = (zz + vieux.z0 - nz0) * sx + (xx + vieux.x0 - nx0);
      this.biomes[k] = vieux.biomes[zz * vieux.sx + xx]; this.hauteurs[k] = vieux.hauteurs[zz * vieux.sx + xx];
    }
    // journal : indices recalcules sur place (des millions d'entrees pour un grand decor : pas de tableau intermediaire)
    const osxz = vieux.sx * vieux.sz, dx = vieux.x0 - nx0, dz = vieux.z0 - nz0, J = this.journal;
    for (let k = 0; k < J.length; k++) {
      const i = J[k], ly = Math.floor(i / osxz), r = i - ly * osxz, lz = Math.floor(r / vieux.sx), lx = r - lz * vieux.sx;
      J[k] = (ly * sz + lz + dz) * sx + lx + dx;
    }
    this.colonnes = new Set(vieux.cols.map(([xx, zz]) => (zz - this.z0) * this.sx + (xx - this.x0)));
    const forces = new Map(this.forces); this.forces = forces;   // cles absolues : inchangees
    this.agrandissements++;
  }

  // ---- proprietes d'un bloc ecrit par le modele
  forcer(x, y, z, cles) { if (cles.length) this.forces.set(this.cle(x, y, z), new Set(cles)); else this.forces.delete(this.cle(x, y, z)); this.defiger(x, y, z); }
  forces_(x, y, z) {
    const f = this.forces.get(this.cle(x, y, z));
    if (f) return f;
    if (this.fige && this.dans(x, y, z)) { const j = this.fige[this.idx(x, y, z)]; if (j) return this.jeux[j]; }
    return null;
  }
  // jeu de cles figees (Set ou TOUT) -> numero (memoise ; 65535 jeux differents au plus)
  numeroJeu(jeu) {
    if (!jeu || (jeu !== TOUT && !jeu.size)) return 0;
    const k = jeu === TOUT ? '*' : [...jeu].sort().join(',');
    let n = this.jeuxIdx.get(k);
    if (n === undefined) {
      if (this.jeux.length >= 65535) throw new ErreurDecor('trop de jeux de proprietes figees differents (65535)');
      n = this.jeux.length; this.jeux.push(jeu === TOUT ? TOUT : new Set(jeu)); this.jeuxIdx.set(k, n);
    }
    return n;
  }
  // fige les proprietes de la cellule (n : numero de jeu ; 0 : rien). La cellule doit etre dans la boite (apres une ecriture).
  figer(x, y, z, n) {
    if (this.forces.size) this.forces.delete(this.cle(x, y, z));
    if (!n) { this.defiger(x, y, z); return; }
    if (!this.fige) this.fige = new Uint16Array(this.cells.length);
    this.fige[this.idx(x, y, z)] = n;
  }
  defiger(x, y, z) { if (this.fige && this.dans(x, y, z)) this.fige[this.idx(x, y, z)] = 0; }

  // ---- hauteurs (carte MOTION_BLOCKING du jeu : bloc qui arrete le mouvement ou fluide) des colonnes touchees
  recalculerHauteurs() {
    const d = this.d, memo = new Map();
    const bloque = (p) => {
      let v = memo.get(p);
      if (v === undefined) {
        const e = this.etatDePal(p);
        v = e >= 0 && e !== d.air && (d.boites(e).length > 0 || d.fluide(e) !== 0 || d.a(e, 8)) ? 1 : 0;
        memo.set(p, v);
      }
      return v;
    };
    for (const c of this.colonnes) {
      const lx = c % this.sx, lz = Math.floor(c / this.sx);
      let h = this.y0 - 1;
      for (let ly = this.sy - 1; ly >= 0; ly--) { if (bloque(this.cells[(ly * this.sz + lz) * this.sx + lx])) { h = ly + this.y0; break; } }
      this.hauteurs[c] = h;
    }
  }

  // la zone resultat (la zone d'origine n'est pas touchee). Les tables de la grille sont CEDEES a la zone (pas de copie : une grande zone
  // pese des centaines de Mo) : la grille ne doit plus servir ensuite.
  versZone() {
    const hdr = { ...this.hdr, origine: [this.x0, this.y0, this.z0], taille: [this.sx, this.sy, this.sz], palette: this.palette.slice() };
    const z = new Zone(hdr, this.cells, this.biomes, this.hauteurs);
    this.cells = null; this.orig = null; this.marque = null; this.fige = null;
    return z;
  }

  // cellules dont la valeur finale differe de celle du debut du decor : [indice lineaire, ...]
  differences() { return this.journal.filter((i) => this.cells[i] !== this.orig[i]); }
}
