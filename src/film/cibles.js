// Cibles : on dit OU va une main ou un pied, le lecteur trouve les angles (cinematique inverse, film/ik.js).
//   mainD mainG piedD piedG : [[t, cible], [t, cible, poids], [t, cible, poids, "d"], [t, null]]
//   cible : nom d'un point du corps de l'acteur (menton, poitrine...), point [droite, haut, avant] en blocs depuis les pieds dans le repere
//           de l'acteur (il tourne avec le lacet), ou {"monde":[x, y, z]} ; null ou "libre" = relache.
//   poids 0..1 (defaut 1) : melange avec les angles des pistes et des boucles ; l'IK les remplace quand le poids vaut 1.
//   coudeVers, genouVers : [t, dehors, haut, avant] direction vers laquelle part le coude (ou le genou), repere de l'acteur ; dehors > 0 =
//   a l'exterieur du membre (le meme chiffre pour les deux cotes). Defauts : coude vers le bas et un peu dehors, genou vers l'avant.
import { lissages } from './scene.js';
import { NOMS_ANCRES, geometrieMembre, repereParent, matricesPose, pointAncre, versModele, matriceMembre } from '../perso/modele.js';
import { resoudreMembre, eulerZXY, melangerRotations, RAD } from './ik.js';
import { penaliteMembre } from './limites.js';

export const MEMBRES_CIBLES = ['mainD', 'mainG', 'piedD', 'piedG'];
const MEMBRE_DE = { mainD: 'brasD', mainG: 'brasG', piedD: 'jambeD', piedG: 'jambeG' };
const LISSAGES = new Set(['d', 's', 'x', 'l']);
const estNombre = (x) => typeof x === 'number' && Number.isFinite(x);

// Lecture d'une piste de cibles : { cles: [{ t, cible: null | {ancre} | {local:[3]} | {monde:[3]}, poids, l }] }.
export function lireCibles(brut, ch, err) {
  if (!Array.isArray(brut) || brut.length === 0) err(ch, 'liste de cles attendue, par exemple [[1, null], [1.5, "menton", 1, "d"], [4, null, 0, "d"]]');
  let prec = -Infinity;
  const cles = brut.map((k, i) => {
    const c = `${ch}[${i}]`;
    if (!Array.isArray(k) || k.length < 2 || !estNombre(k[0]) || k[0] < 0) err(c, 'forme attendue : [temps, cible] ou [temps, cible, poids] ou [temps, cible, poids, "d"] (temps >= 0)');
    if (k[0] < prec) err(`${c}[0]`, 'les cles doivent etre classees par temps croissant');
    prec = k[0];
    let reste = k.slice(2), l = null;
    if (typeof reste[reste.length - 1] === 'string') { l = reste.pop(); if (!LISSAGES.has(l)) err(`${c}[${k.length - 1}]`, `lissage "${l}" inconnu (permis : "d", "s", "x", "l")`); }
    if (reste.length > 1 || (reste.length === 1 && (!estNombre(reste[0]) || reste[0] < 0 || reste[0] > 1))) err(c, 'le poids est un nombre de 0 a 1 (apres la cible)');
    const v = k[1];
    let cible;
    if (v === null || v === 'libre') cible = null;
    else if (typeof v === 'string') {
      if (!NOMS_ANCRES.includes(v)) err(`${c}[1]`, `point du corps inconnu : "${v}" (permis : ${NOMS_ANCRES.join(', ')}, "libre")`);
      cible = { ancre: v };
    } else if (Array.isArray(v)) {
      if (v.length !== 3 || !v.every(estNombre)) err(`${c}[1]`, 'point local attendu : [droite, haut, avant] en blocs depuis les pieds (3 nombres)');
      cible = { local: v.slice() };
    } else if (v && typeof v === 'object' && Array.isArray(v.monde)) {
      if (v.monde.length !== 3 || !v.monde.every(estNombre)) err(`${c}[1]`, '{"monde": [x, y, z]} : 3 nombres');
      cible = { monde: v.monde.slice() };
    } else err(`${c}[1]`, 'cible attendue : nom d\'un point du corps, [droite, haut, avant], {"monde": [x, y, z]} ou null / "libre"');
    return { t: k[0], cible, poids: cible ? (reste.length ? reste[0] : 1) : 0, l };
  });
  return { cles };
}

export const aCibles = (a) => MEMBRES_CIBLES.some((m) => a[m]);

// Etat d'une piste de cibles au temps t : { cible: [a, b, u], poids } ou null (relache). Comme les autres pistes : valeur de la cle la plus
// proche hors des cles, lissage de la cle d'arrivee ; une cle relachee est une cible de poids 0 (le poids monte ou descend pendant le trajet).
function segment(piste, t) {
  const c = piste.cles, n = c.length;
  if (t <= c[0].t) return { a: c[0], b: c[0], u: 0 };
  if (t >= c[n - 1].t) return { a: c[n - 1], b: c[n - 1], u: 0 };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid].t <= t) lo = mid; else hi = mid; }
  const a = c[lo], b = c[lo + 1];
  if (b.l === 'x') return { a, b, u: 0 };
  let u = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
  if (b.l && lissages[b.l]) u = lissages[b.l](u);
  return { a, b, u };
}

// Point (px, repere du modele) d'une cible a cet instant : les points du corps suivent la tete et le tronc.
function pointDe(cible, pose, mats) {
  if (cible.ancre) return pointAncre(cible.ancre, mats);
  if (cible.local) { const [d, h, f] = cible.local; return versModele({ ...pose, lacet: 0 }, [-d, h, f]); }
  const [x, y, z] = cible.monde;
  return versModele(pose, [x - pose.x, y - pose.y, z - pose.z]);
}

// Direction du coude par defaut, repere de l'acteur [dehors, haut, avant] : vers le bas, un tout petit peu dehors et en arriere. Le pivot du coude
// est indefini quand la main est exactement dans la direction du coude (ou a l'opposee) : ici vers le bas et un peu dehors (bras tendu qui
// pend : le pivot ne se voit pas) et vers le haut et un peu en dedans (au-dessus de la tete : hors de portee). Les cibles du visage, de la
// poitrine et de la hanche en sont a 25 degres au moins.
const INDICE_BRAS = [0.25, -1, -0.1], INDICE_JAMBE = [0.15, 0.1, 1];
const norme = (v) => { const n = Math.hypot(...v) || 1; return v.map((c) => c / n); };

// Applique les cibles d'une famille de membres ('bras' ou 'jambes') a la pose (modifie pose). Retourne le nombre de membres tenus.
//   a : acteur valide ; t : temps ; evalPiste(piste, t) : valeurs d'une piste numerique (coudeVers...).
// tDe (facultatif) : nomCible -> temps de lecture de cette cible (acteur fige seul, fige.js) ; t reste le temps de l'image.
export function appliquerCibles(a, pose, t, evalPiste, famille, fk = {}, etat = {}, tDe = null) {
  const slim = a.modele === 'slim';
  let n = 0;
  for (const [nomCible, nom] of Object.entries(MEMBRE_DE)) {
    if (!a[nomCible] || (famille === 'bras') !== nom.startsWith('bras')) continue;
    const tt = tDe ? tDe(nomCible) : t;
    const { a: ka, b: kb, u } = segment(a[nomCible], tt);
    if (!ka.cible && !kb.cible) continue;
    const wa = ka.poids, wb = kb.poids;
    const poids = wa + (wb - wa) * u;
    if (poids < 1e-4) { delete etat[nom]; continue; }
    const mats = matricesPose(pose, slim);
    // le point suivi : une cle relachee ne tire pas la cible (on garde celle de l'autre cle) ; deux cibles : melange des deux points
    const pa = ka.cible ? pointDe(ka.cible, pose, mats) : null, pb = kb.cible ? pointDe(kb.cible, pose, mats) : null;
    const T = pa && pb ? pa.map((c, i) => c + (pb[i] - c) * u) : (pa ?? pb);
    const g = geometrieMembre(nom, slim), genre = nom.startsWith('bras') ? 'bras' : 'jambe';
    const { R: Rp, S } = repereParent(pose, nom, slim);
    // direction du coude / du genou : repere de l'acteur [dehors, haut, avant] -> repere du modele
    const piste = a[genre === 'bras' ? 'coudeVers' : 'genouVers'];
    const enModele = (h) => norme(versModele({ ...pose, lacet: 0 }, [-g.lat * h[0], h[1], h[2]], true));
    const indice = enModele(piste ? evalPiste(piste, tt) : genre === 'jambe' ? INDICE_JAMBE : INDICE_BRAS);
    const pAmp = penaliteMembre(genre, g.lat), Rt = mats[1].R, Tt = mats[1].t;
    // le coude (le centre de l'articulation) ne doit pas entrer dans le tronc : boite du tronc elargie du rayon du bras (2 px)
    const penTronc = (E) => {
      const d = [0, 1, 2].map((i) => E[i] - Tt[i] * 16), l = [Rt[0] * d[0] + Rt[3] * d[1] + Rt[6] * d[2], Rt[1] * d[0] + Rt[4] * d[1] + Rt[7] * d[2], Rt[2] * d[0] + Rt[5] * d[1] + Rt[8] * d[2]];
      const p = Math.min(6.5 - Math.abs(l[0]), l[1] + 2, 14 - l[1], 4.25 - Math.abs(l[2]));   // profondeur dans la boite elargie (px) : > 0 = dedans
      return p > 0 ? (p / 10) ** 2 : 0;
    };
    // rotation de l'image d'avant (continuite du pivot du coude) ; une seconde passe dans la meme image repart de la meme
    const e = etat[nom] ??= { t: -1, prec: null, cur: null };
    if (e.t !== t) { e.prec = e.t >= 0 && t - e.t < 0.1 ? e.cur : null; e.t = t; }
    const r = resoudreMembre({ S, Rp, T, g, indice, prec: e.prec, penalite: genre === 'bras' ? (R, E) => pAmp(R) + penTronc(E) : (R) => pAmp(R) });
    // melange avec les angles des pistes (rotation par rotation, par le plus court chemin) ; fk garde ces angles d'origine (le membre peut etre repris)
    const nomFlex = genre === 'bras' ? (nom === 'brasD' ? 'coudeD' : 'coudeG') : (nom === 'jambeD' ? 'genouD' : 'genouG');
    fk[nom] ??= { v: pose[nom] ?? [0, 0, 0], flex: pose[nomFlex] ?? 0 };
    const Rfk = matriceMembre(nom, fk[nom].v), flexFk = fk[nom].flex;
    const R = melangerRotations(Rfk, r.Rloc, poids), flex = flexFk + (r.flex - flexFk) * poids;
    e.cur = r.Rw;
    const [rz, rx, ry] = eulerZXY(R);
    pose[nom] = [-rx / RAD, g.lat * rz / RAD, -g.lat * ry / RAD];
    pose[nomFlex] = flex;
    if (genre === 'bras') pose[nom === 'brasD' ? 'balD' : 'balG'] = 1 - poids;   // le balancement de repos s'efface sous la cible
    n++;
  }
  return n;
}
