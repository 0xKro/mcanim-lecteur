// Lecture et controle d'un decor (JSON) : champs, palette (alias, melanges ponderes), operations.
// Rien n'est applique ici : on verifie TOUT et on liste TOUTES les erreurs (au plus 10 lignes sont montrees) ; un decor avec une erreur
// n'est jamais applique a moitie (docs/FORMAT-DECOR.md, B3.4). Les `rep` sont developpes ici (le compte des ops est celui de apres developpement).
import { lireBloc, MOTS } from './etats.js';
import { normaliserNom, voulaisTu, proposer } from './noms.js';
import { LIMITES, ErreurDecor } from './grille.js';

export const CHAMPS = ['v', 'zone', 'ancre', 'niveau', 'rot', 'graine', 'pal', 'ops', 'note'];
export const NOMS_OPS = ['plein', 'creux', 'mur', 'coins', 'ligne', 'bloc', 'pts', 'remplacer', 'effacer', 'fond', 'aplanir', 'rep', 'porte', 'toit'];
export const PAS_ENCORE = ['sphere', 'cyl', 'escalier', 'lit', 'copier', 'gab', 'pose', 'grille', 'importer'];

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
  constructor(d, erreurs, fichier) {
    this.d = d; this.erreurs = erreurs; this.fichier = fichier;
    this.alias = new Map();
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
};

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
      for (let k = 0; k < n; k++) for (const s of sous) sortie.push({ ...s, dec: [s.dec[0] + k * dx, s.dec[1] + k * dy, s.dec[2] + k * dz] });
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
export function lireDecor(brut, d, fichier = 'decor') {
  const erreurs = [];
  const ctx = new Contexte(d, erreurs, fichier);
  const E = (ch, m) => erreurs.push(`${ch} : ${m}`);
  if (!estObjet(brut)) throw new ErreurDecor([`${fichier} : un objet JSON {"ancre":[x,z],"ops":[...]} est attendu`], fichier);
  for (const k of Object.keys(brut)) if (!CHAMPS.includes(k)) E(k, k === 'miroir' ? 'miroir : pas encore disponible (phase 2) ; rot (0, 90, 180, 270) existe' : `champ inconnu${voulaisTu(k, CHAMPS)} (permis : ${CHAMPS.join(', ')})`);
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
export function lireDecorTexte(texte, d, fichier = 'decor') {
  const octets = Buffer.byteLength(texte, 'utf8');
  if (octets > LIMITES.octets) throw new ErreurDecor([`${fichier} : fichier trop gros (${octets} octets, maximum ${LIMITES.octets} : coupe en plusieurs decors)`], fichier);
  let brut;
  try { brut = JSON.parse(texte.replace(/^﻿/, '')); } catch (e) { throw new ErreurDecor([`${fichier} : JSON invalide (${e.message})`], fichier); }
  return lireDecor(brut, d, fichier);
}

export { proposer, normaliserNom };
