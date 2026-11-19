// Lecture et controle d'un decor (JSON) : champs, palette (alias, melanges ponderes), operations.
// Rien n'est applique ici : on verifie TOUT et on liste TOUTES les erreurs (au plus 10 lignes sont montrees) ; un decor avec une erreur
// n'est jamais applique a moitie (docs/FORMAT-DECOR.md, B3.4). Les `rep` sont developpes ici (le compte des ops est celui de apres developpement).
// Les gabarits (`gab` puis `pose`) sont developpes ici aussi : chaque operation du gabarit recoit `tf` (matrice de la pose, position).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { lireBloc, MOTS } from './etats.js';
import { normaliserNom, voulaisTu, proposer } from './noms.js';
import { LIMITES, ErreurDecor } from './grille.js';
import { transfo } from './transfo.js';
import { lireConstruction } from './importer.js';

export const CHAMPS = ['v', 'zone', 'ancre', 'niveau', 'rot', 'graine', 'pal', 'ops', 'note'];
export const NOMS_OPS = ['plein', 'creux', 'mur', 'coins', 'ligne', 'bloc', 'pts', 'remplacer', 'effacer', 'fond', 'aplanir', 'rep', 'porte', 'toit',
  'sphere', 'ellipsoide', 'cyl', 'cone', 'grille', 'importer', 'copier', 'miroir', 'rotation', 'gab', 'pose'];
export const PAS_ENCORE = ['escalier', 'lit'];

const estNombre = (x) => typeof x === 'number' && Number.isFinite(x);
const estEntier = (x) => Number.isInteger(x);
const estObjet = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// ---- choix de bloc (alias, nom, melange pondere) ----
// Un Choix : { entrees: [{ spec, poids }], total } ; `choisir` tire une entree selon la graine et la position (meme decor = meme resultat).
export function choisir(choix, graine, x, y, z) {
  if (choix.entrees.length === 1) return choix.entrees[0].spec;
  let h = Math.imul(graine ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  const u = ((h >>> 0) / 4294967296) * choix.total;
  let s = 0;
  for (const e of choix.entrees) { s += e.poids; if (u < s) return e.spec; }
  return choix.entrees[choix.entrees.length - 1].spec;
}

// coupe sur les virgules qui ne sont pas dans des crochets
function couper(s) {
  const out = []; let niv = 0, cur = '';
  for (const c of s) {
    if (c === '[') niv++; else if (c === ']') niv--;
    if (c === ',' && niv === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((t) => t.trim()).filter((t) => t !== '');
}

class Contexte {
  constructor(d, erreurs, fichier, baseDir = null) {
    this.d = d; this.erreurs = erreurs; this.fichier = fichier; this.baseDir = baseDir ?? process.cwd();
    this.alias = new Map();
    this.gabarits = new Map();
    this.nbOps = 0;
  }
  err(chemin, msg) { this.erreurs.push(`${chemin} : ${msg}`); }

  // texte de bloc ou de melange -> Choix (ou null). `profond` : on est dans la definition d'un alias (pas d'alias dans un melange d'alias)
  choix(texte, chemin, profond = false) {
    if (typeof texte !== 'string') { this.err(chemin, 'un nom de bloc ou un alias (texte) est attendu'); return null; }
    const t = texte.trim();
    if (this.alias.has(t)) return this.alias.get(t);
    const parts = couper(t);
    if (!parts.length) { this.err(chemin, 'texte vide'); return null; }
    if (parts.length > LIMITES.melange) { this.err(chemin, `melange de ${parts.length} entrees (maximum ${LIMITES.melange})`); return null; }
    const entrees = []; let ok = true;
    for (const p of parts) {
      const m = /^(.*?):(\d+(?:\.\d+)?)$/.exec(p);
      const nom = m ? m[1].trim() : p, poids = m ? Number(m[2]) : 1;
      if (!(poids > 0)) { this.err(chemin, `poids ${poids} : un nombre > 0 est attendu`); ok = false; continue; }
      let sub = null;
      if (this.alias.has(nom)) sub = this.alias.get(nom);
      if (sub) { for (const e of sub.entrees) entrees.push({ spec: e.spec, poids: poids * e.poids / sub.total }); continue; }
      let msg = null;
      const spec = lireBloc(nom, this.d, (e) => { msg = e; });
      if (!spec) { this.err(chemin, (msg || 'bloc incorrect') + (/^[a-z_]{1,3}$/.test(nom) ? ` (alias "${nom}" non defini dans pal ?)` : '')); ok = false; continue; }
      entrees.push({ spec, poids });
    }
    if (!ok) return null;
    return { entrees, total: entrees.reduce((s, e) => s + e.poids, 0) };
  }
}

// ---- lecteur d'arguments d'une operation ----
class Args {
  constructor(ctx, op, args, chemin) { this.ctx = ctx; this.op = op; this.a = args; this.chemin = chemin; this.i = 0; this.ok = true; }
  err(msg) { this.ok = false; this.ctx.err(`${this.chemin}[${this.i}]`, `${this.op} : ${msg}`); }
  restant() { return this.a.length - this.i; }
  entier(nom) {
    const v = this.a[this.i];
    if (!estNombre(v)) { this.err(`${nom} : un nombre est attendu (recu ${JSON.stringify(v)})`); this.i++; return 0; }
    if (!estEntier(v)) { this.err(`${nom} : un nombre ENTIER est attendu (recu ${v}) ; les blocs sont a des positions entieres`); this.i++; return 0; }
    if (Math.abs(v) > 100000) { this.err(`${nom} : ${v} est trop grand`); this.i++; return 0; }
    this.i++; return v;
  }
  // centre d'une forme ronde : entier ou demi-entier (x.5 : diametre pair)
  demi(nom) {
    const v = this.a[this.i];
    if (!estNombre(v) || !Number.isInteger(v * 2) || Math.abs(v) > 100000) { this.err(`${nom} : un nombre entier ou demi-entier (ex. 4 ou 4.5) est attendu (recu ${JSON.stringify(v)})`); this.i++; return 0; }
    this.i++; return v;
  }
  // rayon : nombre >= 0 (fractions permises)
  rayon(nom, max = 512) {
    const v = this.a[this.i];
    if (!estNombre(v) || v < 0 || v > max) { this.err(`${nom} : un nombre entre 0 et ${max} est attendu (recu ${JSON.stringify(v)})`); this.i++; return 0; }
    this.i++; return v;
  }
  boite() { const v = []; for (const n of ['x1', 'y1', 'z1', 'x2', 'y2', 'z2']) v.push(this.entier(n)); return v; }
  bloc(nom = 'bloc') { const c = this.ctx.choix(this.a[this.i], `${this.chemin}[${this.i}]`); if (!c) this.ok = false; this.i++; return c; }
  // direction facultative : mot, ["vers", x, z], ou rien. Rend { mot } | { vers: [x, z] } | null
  direction(obligatoire = false) {
    const v = this.a[this.i];
    if (v === undefined || v === null || (estObjet(v) && !obligatoire)) { if (obligatoire) this.err('une direction est attendue : nord, sud, est, ouest, haut, bas ou ["vers", x, z]'); return null; }
    this.i++;
    if (typeof v === 'string') {
      const m = MOTS[v.trim().toLowerCase()];
      if (!m) { this.i--; this.err(`direction "${v}" inconnue (permis : nord, sud, est, ouest, haut, bas)${voulaisTu(v.toLowerCase(), Object.keys(MOTS).filter((k) => /^[a-z]{3,5}$/.test(k)))}`); this.i++; return null; }
      return { mot: m };
    }
    if (Array.isArray(v) && v[0] === 'vers' && estEntier(v[1]) && estEntier(v[2]) && v.length === 3) return { vers: [v[1], v[2]] };
    this.i--; this.err('direction : un mot (nord, sud, est, ouest, haut, bas) ou ["vers", x, z] est attendu'); this.i++;
    return null;
  }
  // options facultatives : objet dont les cles sont dans `permises`
  options(permises) {
    const v = this.a[this.i];
    if (v === undefined) return {};
    if (!estObjet(v)) { this.err(`options : un objet est attendu, par exemple {"${permises[0]}": ...}`); this.i++; return {}; }
    for (const k of Object.keys(v)) if (!permises.includes(k)) { this.err(`option "${k}" inconnue${permises.length ? ` (permis : ${permises.join(', ')})` : ' (cette operation n\'a pas d\'option)'}`); }
    this.i++;
    return v;
  }
  fin() { if (this.restant() > 0 && this.ok) { this.err(`${this.restant()} argument(s) en trop`); } }
}

function boiteOrdonnee(b) { return [Math.min(b[0], b[3]), Math.min(b[1], b[4]), Math.min(b[2], b[5]), Math.max(b[0], b[3]), Math.max(b[1], b[4]), Math.max(b[2], b[5])]; }

// motif d'un `remplacer` : "*", nom, #etiquette, alias, ou liste de ces textes -> { tout } | { cibles: [{ bloc, props }], etiquettes: [Set] }
function lireMotif(ctx, v, chemin) {
  const liste = Array.isArray(v) ? v : [v];
  const m = { tout: false, cibles: [], etiquettes: [] };
  let ok = true;
  for (const t of liste) {
    if (t === '*') { m.tout = true; continue; }
    if (typeof t === 'string' && t.startsWith('#')) {
      const s = ctx.d.etiquette(t);
      if (!s.size) { ctx.err(chemin, `etiquette "${t}" inconnue ou vide`); ok = false; } else m.etiquettes.push(s);
      continue;
    }
    const c = ctx.choix(t, chemin);
    if (!c) { ok = false; continue; }
    for (const e of c.entrees) m.cibles.push({ bloc: e.spec.bloc, props: e.spec.props });
  }
  return ok ? m : null;
}

// ---- les operations ----
const PARSEURS = {
  plein: (A) => ({ b: boiteOrdonnee(A.boite()), B: A.bloc() }),
  creux: (A) => ({ b: boiteOrdonnee(A.boite()), B: A.bloc() }),
  mur: (A) => ({ b: boiteOrdonnee(A.boite()), B: A.bloc() }),
  coins: (A) => { const x1 = A.entier('x1'), z1 = A.entier('z1'), x2 = A.entier('x2'), z2 = A.entier('z2'), y1 = A.entier('y1'), y2 = A.entier('y2'); return { x1: Math.min(x1, x2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), z2: Math.max(z1, z2), y1: Math.min(y1, y2), y2: Math.max(y1, y2), B: A.bloc() }; },
  ligne: (A) => { const b = A.boite(); return { a: [b[0], b[1], b[2]], c: [b[3], b[4], b[5]], B: A.bloc() }; },
  bloc: (A) => {
    const p = [A.entier('x'), A.entier('y'), A.entier('z')], B = A.bloc();
    let dir = null, props = null;
    if (A.restant() > 0 && estObjet(A.a[A.i])) { props = A.a[A.i]; A.i++; } else dir = A.direction(false);
    if (A.restant() > 0 && estObjet(A.a[A.i]) && !props) { props = A.a[A.i]; A.i++; }
    return { p, B, dir, props };
  },
  pts: (A) => {
    const B = A.bloc(); const pts = [];
    while (A.restant() > 0) {
      const v = A.a[A.i];
      if (!Array.isArray(v) || v.length < 3 || v.length > 4 || !v.slice(0, 3).every(estEntier)) { A.err('un point [x,y,z] (ou [x,y,z,"direction"]) est attendu'); A.i++; continue; }
      let dir = null;
      if (v.length === 4) { const B2 = new Args(A.ctx, A.op, [v[3]], `${A.chemin}[${A.i}]`); dir = B2.direction(true); if (!B2.ok) A.ok = false; }
      pts.push({ p: [v[0], v[1], v[2]], dir }); A.i++;
    }
    if (!pts.length) A.err('au moins un point est attendu');
    return { B, pts };
  },
  remplacer: (A) => { const b = boiteOrdonnee(A.boite()); const m = lireMotif(A.ctx, A.a[A.i], `${A.chemin}[${A.i}]`); if (!m) A.ok = false; A.i++; return { b, A: m, B: A.bloc() }; },
  effacer: (A) => ({ b: boiteOrdonnee(A.boite()) }),
  fond: (A) => { const x1 = A.entier('x1'), z1 = A.entier('z1'), x2 = A.entier('x2'), z2 = A.entier('z2'); const B = A.bloc(); const opt = A.options(['profondeur', 'de']); return { x1: Math.min(x1, x2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), z2: Math.max(z1, z2), B, opt: optNombres(A, opt, { profondeur: [1, 64, 12], de: [-64, 64, -1] }) }; },
  aplanir: (A) => {
    const x1 = A.entier('x1'), z1 = A.entier('z1'), x2 = A.entier('x2'), z2 = A.entier('z2'), y = A.entier('y');
    const opt = A.options(['dessus', 'dessous', 'marge']);
    const o = optNombres(A, { marge: opt.marge }, { marge: [0, 32, 0] });
    for (const k of ['dessus', 'dessous']) if (opt[k] !== undefined) { const c = A.ctx.choix(opt[k], `${A.chemin}[${A.i - 1}].${k}`); if (!c) A.ok = false; o[k] = c; }
    return { x1: Math.min(x1, x2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), z2: Math.max(z1, z2), y, opt: o };
  },
  porte: (A) => { const p = [A.entier('x'), A.entier('y'), A.entier('z')], B = A.bloc(); const dir = A.direction(true); const opt = A.options(['ouverte', 'charniere']); return { p, B, dir, opt: optPorte(A, opt) }; },
  toit: (A) => {
    const x1 = A.entier('x1'), z1 = A.entier('z1'), x2 = A.entier('x2'), z2 = A.entier('z2'), y = A.entier('y'); const B = A.bloc();
    let axe = A.a[A.i]; if (axe !== 'x' && axe !== 'z') { A.err('axe : "x" ou "z" attendu (sens du faite : x = le faite court vers l\'est)'); axe = 'x'; } A.i++;
    const opt = A.options(['faite', 'pignon', 'debord', 'forme']);
    const o = optNombres(A, { debord: opt.debord }, { debord: [0, 8, 1] });
    if (opt.forme !== undefined && opt.forme !== 'pignon' && opt.forme !== 'croupe') A.err('forme : "pignon" (deux pans, defaut) ou "croupe" (quatre pans)');
    o.forme = opt.forme === 'croupe' ? 'croupe' : 'pignon';
    for (const k of ['faite', 'pignon']) {
      if (opt[k] === undefined) continue;
      if (opt[k] === false || opt[k] === 'aucun') { o[k] = false; continue; }
      if (k === 'faite' && opt[k] === 'dalle') { o[k] = 'dalle'; continue; }
      const c = A.ctx.choix(opt[k], `${A.chemin}[${A.i - 1}].${k}`); if (!c) A.ok = false; o[k] = c;
    }
    return { x1: Math.min(x1, x2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), z2: Math.max(z1, z2), y, B, axe, opt: o };
  },

  // ---- formes rondes (formes.js)
  sphere: (A) => { const c = [A.demi('cx'), A.demi('cy'), A.demi('cz')], r = A.rayon('r'); const B = A.bloc(); return { c, r: [r, r, r], B, opt: optForme(A, A.options(['epaisseur', 'dedans', 'moitie']), true) }; },
  ellipsoide: (A) => { const c = [A.demi('cx'), A.demi('cy'), A.demi('cz')], r = [A.rayon('rx'), A.rayon('ry'), A.rayon('rz')]; const B = A.bloc(); return { c, r, B, opt: optForme(A, A.options(['epaisseur', 'dedans', 'moitie']), true) }; },
  cyl: (A) => colonneArgs(A),
  cone: (A) => colonneArgs(A),

  // ---- volumes (volumes.js)
  grille: (A) => {
    const p = [A.entier('x'), A.entier('y'), A.entier('z')];
    const taille = [A.entier('sx'), A.entier('sy'), A.entier('sz')];
    if (A.ok && (taille.some((v) => v < 1) || taille[0] > LIMITES.largeur || taille[2] > LIMITES.largeur || taille[1] > LIMITES.hauteur)) A.err(`taille : sx et sz entre 1 et ${LIMITES.largeur}, sy entre 1 et ${LIMITES.hauteur}`);
    const vp = A.a[A.i], chP = `${A.chemin}[${A.i}]`; A.i++;
    let palette = null;
    if (!Array.isArray(vp) || !vp.length || vp.length > LIMITES.palette) A.err(`palette : liste de 1 a ${LIMITES.palette} blocs ("air", "stone_bricks", "oak_stairs[facing=nord]", alias, melange) ou null (= laisser la cellule telle quelle)`);
    else palette = vp.map((t, k) => { if (t === null) return null; const c = A.ctx.choix(t, `${chP}[${k}]`); if (!c) A.ok = false; return c; });
    const donnees = A.a[A.i]; A.i++;
    const opt = optTransfo(A, A.options(['rot', 'miroir', 'air']), ['x', 'z']);
    let indices = null;
    if (A.ok) {
      const n = taille[0] * taille[1] * taille[2];
      if (n > LIMITES.volume) A.err(`${n} cellules (maximum ${LIMITES.volume} par grille)`);
      else { const r = decoderGrille(donnees, n, palette.length); if (typeof r === 'string') A.err(`donnees : ${r}`); else indices = r; }
    }
    return { p, taille, palette, indices, opt };
  },
  importer: (A) => {
    const f = A.a[A.i]; A.i++;
    const p = [A.entier('x'), A.entier('y'), A.entier('z')];
    const opt = optTransfo(A, A.options(['rot', 'miroir', 'air', 'inconnu', 'etats']), ['x', 'z']);
    if (opt.inconnu !== undefined && !['air', 'garder', 'erreur'].includes(opt.inconnu)) A.err('option inconnu : "air" (defaut), "garder" (cellule laissee telle quelle) ou "erreur"');
    if (opt.etats !== undefined && !['garder', 'recalculer'].includes(opt.etats)) A.err('option etats : "garder" (defaut : etats du fichier tels quels) ou "recalculer" (liaisons et formes refaites par le lecteur)');
    let imp = null;
    if (typeof f !== 'string' || !/\.(schem|nbt|litematic)$/i.test(f) || path.isAbsolute(f) || f.split(/[\\/]/).includes('..') || f.length > 200) A.err('fichier : chemin relatif d\'un .schem, .nbt ou .litematic a cote du decor (sans ..), par exemple "tour.schem"');
    else if (A.ok) { const r = lireImport(A.ctx, f, opt); if (typeof r === 'string') A.err(r); else imp = r; }
    return { fichier: f, p, opt, imp };
  },
  copier: (A) => { const b = boiteOrdonnee(A.boite()); const dd = [A.entier('dx'), A.entier('dy'), A.entier('dz')]; return { b, d: dd, opt: optTransfo(A, A.options(['rot', 'miroir', 'air']), ['x', 'y', 'z']) }; },
  miroir: (A) => {
    const b = boiteOrdonnee(A.boite());
    const axe = A.a[A.i]; if (!['x', 'y', 'z'].includes(axe)) A.err('axe : "x" (est <-> ouest), "y" (haut <-> bas) ou "z" (nord <-> sud)'); A.i++;
    const opt = A.options(['decalage', 'air']);
    if (opt.decalage !== undefined && !(Array.isArray(opt.decalage) && opt.decalage.length === 3 && opt.decalage.every((v) => estEntier(v) && Math.abs(v) <= 100000))) A.err('option decalage : [dx, dy, dz] entiers (sans decalage : miroir sur place)');
    if (opt.air !== undefined && typeof opt.air !== 'boolean') A.err('option air : true (defaut, l\'air est copie) ou false');
    return { b, axe, opt };
  },
  rotation: (A) => {
    const b = boiteOrdonnee(A.boite());
    const angle = A.a[A.i]; if (![90, 180, 270].includes(angle)) A.err('angle : 90, 180 ou 270 (sens des aiguilles d\'une montre vu d\'en haut)'); A.i++;
    return { b, angle, opt: optTransfo(A, A.options(['miroir', 'air']), ['x', 'z']) };
  },
};

function colonneArgs(A) {
  const p = [A.demi('x'), A.demi('y'), A.demi('z')], r = A.rayon('r'), h = A.entier('h');
  if (A.ok && (h === 0 || Math.abs(h) > LIMITES.largeur)) A.err(`h : nombre de couches, non nul, entre -${LIMITES.largeur} et ${LIMITES.largeur} (negatif : vers le bas)`);
  const B = A.bloc();
  const opt = optForme(A, A.options(['axe', 'epaisseur', 'dedans']), false);
  if (opt.axe !== undefined && !['x', 'y', 'z'].includes(opt.axe)) A.err('option axe : "y" (defaut, vertical), "x" ou "z"');
  const ax = { x: 0, y: 1, z: 2 }[opt.axe ?? 'y'];
  if (A.ok && !Number.isInteger(p[ax])) A.err(`${['x', 'y', 'z'][ax]} : entier attendu (c'est la base sur l'axe ${opt.axe ?? 'y'} ; seules les deux autres coordonnees peuvent etre en .5)`);
  return { p, r, h, B, opt };
}
function optForme(A, opt, rond) {
  const o = { ...opt };
  if (opt.epaisseur !== undefined && !(estEntier(opt.epaisseur) && opt.epaisseur >= 0 && opt.epaisseur <= 32)) A.err('option epaisseur : entier de 0 (plein, defaut) a 32 (forme creuse : epaisseur de la paroi)');
  if (opt.dedans !== undefined) {
    if (opt.dedans === 'air') o.dedans = 'air';
    else { const c = A.ctx.choix(opt.dedans, `${A.chemin}.dedans`); if (!c) A.ok = false; o.dedans = c; }
    if (!opt.epaisseur) A.err('option dedans : seulement avec epaisseur (forme creuse)');
  }
  if (rond && opt.moitie !== undefined && !['haut', 'bas'].includes(opt.moitie)) A.err('option moitie : "haut" (dome) ou "bas" (bol)');
  return o;
}
function optTransfo(A, opt, miroirs) {
  if (opt.rot !== undefined && ![0, 90, 180, 270].includes(opt.rot)) A.err('option rot : 0, 90, 180 ou 270 (sens des aiguilles d\'une montre vu d\'en haut)');
  if (opt.miroir !== undefined && !miroirs.includes(opt.miroir)) A.err(`option miroir : ${miroirs.map((m) => `"${m}"`).join(', ')} (x : est <-> ouest, z : nord <-> sud${miroirs.includes('y') ? ', y : haut <-> bas' : ''})`);
  if (opt.air !== undefined && typeof opt.air !== 'boolean') A.err('option air : true (defaut) ou false (les cellules d\'air du contenu laissent la place telle quelle)');
  return opt;
}

// ---- donnees d'une grille : "rle:..." (texte) ou base64 d'un gzip de varints (comme Sponge : 1 octet par cellule jusqu'a 127 entrees).
// Ordre des cellules : x le plus rapide, puis z, puis y (index = x + z*sx + y*sx*sz). Rend un Uint16Array ou un message d'erreur.
export function decoderGrille(texte, n, nPal) {
  if (typeof texte !== 'string') return 'texte attendu : "rle:N*i i ..." ou le base64 d\'un gzip (prefixe facultatif "gz:")';
  const out = new Uint16Array(n);
  if (texte.startsWith('rle:')) {
    let k = 0;
    for (const tok of texte.slice(4).split(/[\s,/|]+/)) {
      if (!tok) continue;
      const m = /^(?:(\d+)\*)?(\d+)$/.exec(tok);
      if (!m) return `rle : "${tok.slice(0, 20)}" incorrect (forme : "N*i" = N fois l'indice i, ou "i")`;
      const fois = m[1] === undefined ? 1 : Number(m[1]), v = Number(m[2]);
      if (v >= nPal) return `rle : indice ${v} hors de la palette (${nPal} entrees, de 0 a ${nPal - 1})`;
      if (k + fois > n) return `rle : plus de ${n} cellules (sx*sy*sz)`;
      out.fill(v, k, k + fois); k += fois;
    }
    if (k !== n) return `rle : ${k} cellules pour ${n} attendues (sx*sy*sz)`;
    return out;
  }
  const b64 = texte.replace(/^gz:/, '');
  if (!/^[A-Za-z0-9+/=_-]*$/.test(b64)) return 'base64 incorrect (ou commence par "rle:" pour le texte)';
  let brut;
  try { brut = zlib.gunzipSync(Buffer.from(b64, 'base64'), { maxOutputLength: n * 3 + 16 }); } catch (e) { return `gzip illisible (${e.code === 'ERR_BUFFER_TOO_LARGE' ? 'trop de donnees' : e.message})`; }
  let p = 0;
  for (let i = 0; i < n; i++) {
    let v = 0, dec = 0, b;
    do {
      if (p >= brut.length) return `${i} cellules lues pour ${n} attendues (sx*sy*sz)`;
      b = brut[p++]; v |= (b & 0x7f) << dec; dec += 7;
    } while (b & 0x80 && dec < 21);
    if (v >= nPal) return `indice ${v} (cellule ${i}) hors de la palette (${nPal} entrees)`;
    out[i] = v;
  }
  if (p !== brut.length) return `${brut.length - p} octets de trop apres ${n} cellules (sx*sy*sz)`;
  return out;
}
// encodeur (essais, outils) : indices -> "gz:" + base64(gzip(varints))
export function encoderGrille(indices) {
  const o = [];
  for (const v0 of indices) { let v = v0; while (v >= 0x80) { o.push((v & 0x7f) | 0x80); v >>>= 7; } o.push(v); }
  return 'gz:' + zlib.gzipSync(Buffer.from(o), { level: 9 }).toString('base64');
}

// ---- importer : lecture du fichier (memo par chemin, taille et date) et noms de blocs du fichier -> etats du jeu
const RENOMMES = { grass: 'short_grass', grass_path: 'dirt_path', sign: 'oak_sign', wall_sign: 'oak_wall_sign', chain: 'iron_chain', 'minecraft:chain': 'iron_chain' };
const memoImport = new Map();
function lireImport(ctx, f, opt) {
  const plein = path.resolve(ctx.baseDir, f);
  let st;
  try { st = fs.statSync(plein); } catch { return `fichier introuvable : ${f} (chemin relatif au fichier de decor, ou a la scene pour un decor en ligne)`; }
  if (st.size > LIMITES.importOctets) return `${f} : ${st.size} octets (maximum ${LIMITES.importOctets})`;
  const cle = `${plein}|${st.size}|${st.mtimeMs}`;
  let s = memoImport.get(cle);
  if (!s) {
    try { s = lireConstruction(fs.readFileSync(plein), f); } catch (e) { return `${f} : ${e.message}`; }
    if (memoImport.size > 16) memoImport.clear();
    memoImport.set(cle, s);
  }
  const [sx, sy, sz] = s.taille;
  if (sx > LIMITES.largeur || sz > LIMITES.largeur || sy > LIMITES.hauteur) return `${f} : ${sx} x ${sy} x ${sz} (maximum ${LIMITES.largeur} x ${LIMITES.hauteur} x ${LIMITES.largeur})`;
  if (sx * sy * sz > LIMITES.volume) return `${f} : ${sx * sy * sz} cellules (maximum ${LIMITES.volume})`;
  const d = ctx.d, notes = [], renommes = new Map(), inconnus = new Map();
  let propsRetirees = 0;
  const air = d.etatParDefaut(d.idBloc('air'));
  const resolus = s.palette.map((t) => {
    if (t === null) return { garder: true };
    const m = /^([^[\]]+?)(?:\[([^\]]*)\])?$/.exec(t.trim());
    let nom = normaliserNom(m ? m[1] : t);
    let bloc = d.idBloc(nom);
    if (bloc < 0 && RENOMMES[nom] && d.idBloc(RENOMMES[nom]) >= 0) { renommes.set(nom, RENOMMES[nom]); nom = RENOMMES[nom]; bloc = d.idBloc(nom); }
    if (bloc < 0) {
      inconnus.set(nom, (inconnus.get(nom) || 0) + 1);
      return opt.inconnu === 'garder' ? { garder: true } : { id: air, air: true, inconnu: true };
    }
    let id = d.etatParDefaut(bloc);
    const sch = new Map(d.schema(bloc));
    for (const kv of (m && m[2] ? m[2].split(',') : [])) {
      const e = kv.indexOf('='), k = kv.slice(0, e).trim(), v = kv.slice(e + 1).trim();
      if (e < 1 || !sch.has(k) || !sch.get(k).includes(v)) { propsRetirees++; continue; }
      id = d.avec(id, k, v);
    }
    const n = d.nomBloc(id);
    return { id, air: n === 'air' || n === 'cave_air' || n === 'void_air' };
  });
  if (inconnus.size && opt.inconnu === 'erreur') return `${f} : bloc(s) inconnu(s) du jeu 26.3 : ${[...inconnus.keys()].slice(0, 5).join(', ')} (option inconnu : "air" ou "garder")`;
  if (renommes.size) notes.push(`renommes : ${[...renommes].map(([a, b]) => `${a} -> ${b}`).join(', ')}`);
  if (inconnus.size) notes.push(`${[...inconnus.values()].reduce((a, b) => a + b, 0)} etat(s) de bloc inconnu(s) -> ${opt.inconnu === 'garder' ? 'cellule gardee' : 'air'} (${[...inconnus.keys()].slice(0, 4).join(', ')})`);
  if (propsRetirees) notes.push(`${propsRetirees} propriete(s) inconnue(s) retiree(s) (valeur par defaut)`);
  return { format: s.format, taille: s.taille, indices: s.indices, entites: s.entites, entitesMonde: s.entitesMonde ?? [], resolus, notes };
}

function optNombres(A, opt, def) {
  const o = {};
  for (const [k, [mn, mx, dv]] of Object.entries(def)) {
    const v = opt[k];
    if (v === undefined) { o[k] = dv; continue; }
    if (!estEntier(v) || v < mn || v > mx) { A.err(`option ${k} : un entier entre ${mn} et ${mx} est attendu`); o[k] = dv; } else o[k] = v;
  }
  return o;
}
function optPorte(A, opt) {
  const o = { ouverte: false, charniere: 'left' };
  if (opt.ouverte !== undefined) { if (typeof opt.ouverte !== 'boolean') A.err('option ouverte : true ou false'); else o.ouverte = opt.ouverte; }
  if (opt.charniere !== undefined) { const c = { gauche: 'left', droite: 'right', left: 'left', right: 'right' }[opt.charniere]; if (!c) A.err('option charniere : "gauche" ou "droite"'); else o.charniere = c; }
  return o;
}

// Lit une liste d'operations (profondeur d'imbrication de `rep` limitee a 3). Rend la liste developpee [{ nom, ...params, dec: [dx,dy,dz], chemin }].
function lireOps(ctx, ops, chemin, prof = 0) {
  const sortie = [];
  if (!Array.isArray(ops)) { ctx.err(chemin, 'une liste d\'operations est attendue, par exemple [["plein",0,0,0,2,2,2,"stone"]]'); return sortie; }
  ops.forEach((o, i) => {
    const ch = `${chemin}[${i}]`;
    if (!Array.isArray(o) || typeof o[0] !== 'string') { ctx.err(ch, 'une operation est une liste ["nom", arguments...]'); return; }
    const nom = o[0].trim().toLowerCase();
    if (nom === 'rep') {
      if (prof >= 3) { ctx.err(ch, 'rep imbriques sur plus de 3 niveaux'); return; }
      const A = new Args(ctx, 'rep', o.slice(1), ch);
      A.i = 0;
      const n = A.entier('n'), dx = A.entier('dx'), dy = A.entier('dy'), dz = A.entier('dz');
      if (A.ok && (n < 1 || n > 1000)) A.err('n : entre 1 et 1000');
      const sous = lireOps(ctx, o[5], `${ch}[5]`, prof + 1);
      if (o.length !== 6) ctx.err(ch, 'forme : ["rep", n, dx, dy, dz, [operations]]');
      if (!A.ok) return;
      if (sous.length * n + sortie.length + ctx.nbOps > LIMITES.ops * 4) { ctx.err(ch, `trop d'operations apres developpement (maximum ${LIMITES.ops})`); return; }
      // une operation venue d'un gabarit pose : le decalage s'ajoute a la position de la pose (le repere du gabarit peut etre tourne)
      for (let k = 0; k < n; k++) for (const s of sous) sortie.push(s.tf ? { ...s, tf: { M: s.tf.M, o: [s.tf.o[0] + k * dx, s.tf.o[1] + k * dy, s.tf.o[2] + k * dz] } } : { ...s, dec: [s.dec[0] + k * dx, s.dec[1] + k * dy, s.dec[2] + k * dz] });
      return;
    }
    if (nom === 'gab') {
      // ["gab", "nom", [operations]] : un gabarit (rien n'est pose ici) ; ["pose", "nom", x, y, z, {rot, miroir}] le pose
      if (prof > 0 || ctx.dansGab) { ctx.err(ch, 'gab : au premier niveau des ops seulement (pas dans rep ni dans un autre gab)'); return; }
      const nomG = o[1];
      if (typeof nomG !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(nomG) || !Array.isArray(o[2]) || o.length !== 3) { ctx.err(ch, 'forme : ["gab", "nom", [operations]] (nom : lettres, chiffres, _)'); return; }
      if (ctx.gabarits.has(nomG)) { ctx.err(ch, `gab : "${nomG}" deja defini`); return; }
      ctx.dansGab = true;
      const sous = lireOps(ctx, o[2], `${ch}[2]`, prof + 1);
      ctx.dansGab = false;
      ctx.gabarits.set(nomG, sous);
      return;
    }
    if (nom === 'pose') {
      if (ctx.dansGab) { ctx.err(ch, 'pose : un gabarit ne pose pas d\'autre gabarit'); return; }
      const A = new Args(ctx, 'pose', o.slice(1), ch);
      const nomG = A.a[0]; A.i = 1;
      const p = [A.entier('x'), A.entier('y'), A.entier('z')];
      const opt = optTransfo(A, A.options(['rot', 'miroir']), ['x', 'z']);
      A.fin();
      const gab = typeof nomG === 'string' ? ctx.gabarits.get(nomG) : undefined;
      if (!gab) { ctx.err(ch, `pose : gabarit "${nomG}" inconnu (a definir PLUS HAUT par ["gab", "${nomG}", [...]])${voulaisTu(String(nomG), [...ctx.gabarits.keys()])}`); return; }
      if (!A.ok) return;
      if (gab.length + sortie.length > LIMITES.ops * 4) { ctx.err(ch, `trop d'operations apres developpement (maximum ${LIMITES.ops})`); return; }
      const M = transfo((opt.rot ?? 0) / 90, opt.miroir ?? null).M;
      for (const s of gab) sortie.push({ ...s, tf: { M, o: [...p] }, chemin: `${ch} (gab ${nomG}) ${s.chemin}` });
      return;
    }
    const f = PARSEURS[nom];
    if (!f) {
      const bientot = PAS_ENCORE.includes(nom);
      ctx.err(ch, bientot ? `operation "${nom}" pas encore disponible (phase 2) ; operations : ${NOMS_OPS.join(', ')}` : `operation "${nom}" inconnue${voulaisTu(nom, NOMS_OPS)} (operations : ${NOMS_OPS.join(', ')})`);
      return;
    }
    const A = new Args(ctx, nom, o.slice(1), ch);
    A.i = 0;
    const p = f(A);
    A.fin();
    if (A.ok) sortie.push({ nom, ...p, dec: [0, 0, 0], chemin: ch });
  });
  return sortie;
}

// ---- le decor entier ----
// brut : objet JSON ; d : donnees du jeu ; fichier : nom pour les messages. Rend { decor } ou leve ErreurDecor (toutes les erreurs).
// baseDir : dossier ou chercher les fichiers cites par `importer` (dossier du fichier de decor ; pour un decor en ligne : celui de la scene)
export function lireDecor(brut, d, fichier = 'decor', { baseDir = null } = {}) {
  const erreurs = [];
  const ctx = new Contexte(d, erreurs, fichier, baseDir);
  const E = (ch, m) => erreurs.push(`${ch} : ${m}`);
  if (!estObjet(brut)) throw new ErreurDecor([`${fichier} : un objet JSON {"ancre":[x,z],"ops":[...]} est attendu`], fichier);
  for (const k of Object.keys(brut)) if (!CHAMPS.includes(k)) E(k, k === 'miroir' ? 'miroir du decor entier : non ; rot (0, 90, 180, 270) existe, et l\'operation ["miroir", boite, "x"|"z"] (ou "pose" d\'un gabarit avec {miroir})' : `champ inconnu${voulaisTu(k, CHAMPS)} (permis : ${CHAMPS.join(', ')})`);
  if (brut.v !== undefined && brut.v !== 1) E('v', `version ${JSON.stringify(brut.v)} non geree (ce lecteur lit v:1)`);
  if (brut.zone !== undefined && typeof brut.zone !== 'string') E('zone', 'identifiant de zone (texte) attendu');
  const decor = { v: 1, zone: brut.zone ?? null, note: typeof brut.note === 'string' ? brut.note : null };
  if (!Array.isArray(brut.ancre) || brut.ancre.length !== 2 || !brut.ancre.every(estEntier)) E('ancre', 'deux entiers [x, z] (colonne du monde, origine du decor) attendus, par exemple [-250, -640]');
  else decor.ancre = brut.ancre;
  if (brut.niveau !== undefined && brut.niveau !== 'sol' && !estEntier(brut.niveau)) E('niveau', '"sol" (defaut : y local 0 = sol de l\'ancre) ou un entier (Y du monde de y local 0)');
  decor.niveau = brut.niveau ?? 'sol';
  if (brut.rot !== undefined && ![0, 90, 180, 270].includes(brut.rot)) E('rot', '0, 90, 180 ou 270');
  decor.rot = brut.rot ?? 0;
  if (brut.graine !== undefined && !(estEntier(brut.graine) && brut.graine >= 0 && brut.graine <= 2147483647)) E('graine', 'entier entre 0 et 2147483647');
  decor.graine = brut.graine ?? 0;
  // palette
  if (brut.pal !== undefined) {
    if (!estObjet(brut.pal)) E('pal', 'un objet {"alias": "bloc"} est attendu');
    else {
      const noms = Object.keys(brut.pal);
      if (noms.length > LIMITES.alias) E('pal', `${noms.length} alias (maximum ${LIMITES.alias})`);
      for (const nom of noms) {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,15}$/.test(nom)) { E(`pal.${nom}`, 'nom d\'alias : lettres, chiffres et _ (16 au plus), sans espace'); continue; }
        const c = ctx.choix(brut.pal[nom], `pal.${nom}`, true);
        if (c) ctx.alias.set(nom, c);
      }
    }
  }
  decor.alias = ctx.alias;
  decor.ops = lireOps(ctx, brut.ops, 'ops');
  if (brut.ops === undefined) E('ops', 'liste d\'operations manquante');
  if (decor.ops.length > LIMITES.ops) E('ops', `${decor.ops.length} operations apres developpement (maximum ${LIMITES.ops})`);
  if (erreurs.length) throw new ErreurDecor(erreurs.map((e) => `${fichier} : ${e}`), fichier);
  return decor;
}

// Texte JSON -> decor (limite de taille, JSON invalide)
export function lireDecorTexte(texte, d, fichier = 'decor', { baseDir = null } = {}) {
  const octets = Buffer.byteLength(texte, 'utf8');
  if (octets > LIMITES.octets) throw new ErreurDecor([`${fichier} : fichier trop gros (${octets} octets, maximum ${LIMITES.octets} : coupe en plusieurs decors)`], fichier);
  let brut;
  try { brut = JSON.parse(texte.replace(/^﻿/, '')); } catch (e) { throw new ErreurDecor([`${fichier} : JSON invalide (${e.message})`], fichier); }
  return lireDecor(brut, d, fichier, { baseDir });
}

// Fichiers cites par les operations `importer` d'un decor (JSON lu), y compris dans rep et gab : chemins tels qu'ecrits (relatifs au decor)
export function fichiersImportes(brut) {
  const out = new Set();
  const marche = (ops, prof) => {
    if (!Array.isArray(ops) || prof > 8) return;
    for (const o of ops) {
      if (!Array.isArray(o)) continue;
      if (o[0] === 'importer' && typeof o[1] === 'string') out.add(o[1]);
      else if (o[0] === 'rep') marche(o[5], prof + 1);
      else if (o[0] === 'gab') marche(o[2], prof + 1);
    }
  };
  marche(brut?.ops, 0);
  return [...out];
}

export { proposer, normaliserNom };
