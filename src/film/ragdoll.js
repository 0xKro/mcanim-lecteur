// Pantin des explosions (« ragdoll ») : le SEUL ajout de film voulu par le proprietaire (docs/SIMULATION.md partie 21). La trajectoire reste
// celle du jeu (position du replay : poussee, gravite 0,08, trainee 0,98, friction) ; seul le DESSIN du corps change pendant qu'un acteur
// (joueur ou creature) vole apres un souffle :
//   - le corps entier tourne autour de son centre a la vitesse angulaire donnee par le souffle (moment du souffle sur les points vus de la
//     boite, moteur/explosion.js, et bascule par les pieds retenus au sol) ;
//   - chaque membre (bras, jambes, tete, queue... : parties nommees du modele) est un ressort amorti vers une pose lache, mene par
//     l'acceleration du corps (gravite moins acceleration du centre, forces d'inertie de la rotation) : ils trainent au depart, battent en l'air ;
//   - a l'atterrissage : petit rebond, le corps se couche (ou se redresse s'il est presque droit), puis il se releve (vivant) ou reste couche
//     pendant la chute de la mort du jeu (rougeur, puis nuage au tick 20).
// Deterministe : tout vient du replay (memes octets = memes images). Regle `explosion.ragdoll: false` : aucun souffle n'est ecrit, rien ici.
import { ESPECES } from '../creatures/especes.js';
import { couchesDe, matricePartie, mul, T, S, basCreature } from '../creatures/rendu.js';
import { Personnage, matriceMembre } from '../perso/modele.js';
let JOUEUR_GEO = null;   // corps du joueur (modele large) quand le film n'a pas ses personnages : geometrie seulement

const DT = 1 / 20, G = 32;                              // seconde par tick ; gravite du jeu 0,08 bloc/tick^2 = 32 blocs/s^2
const SEUIL = 0.2;                                      // poussee (blocs/tick) en dessous de laquelle le corps ne part pas en pantin
const N_POSE = 8, N_COUCHE = 10, N_LEVE = 12;           // ticks : rebond et couchage, temps couche, relevement
const RAD = Math.PI / 180, DEG = 180 / Math.PI;

// ---------------------------------------------------------------- quaternions [w, x, y, z]
const qmul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
const qnorm = (q) => { const l = Math.hypot(...q) || 1; return q.map((v) => v / l); };
const qaxe = (v, dt) => { const a = Math.hypot(...v) * dt; if (a < 1e-9) return [1, 0, 0, 0]; const s = Math.sin(a / 2) / (a / dt); return [Math.cos(a / 2), v[0] * s, v[1] * s, v[2] * s]; };
function qslerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((v) => -v); d = -d; }
  if (d > 0.9995) return qnorm(a.map((v, i) => v + (b[i] - v) * t));
  const th = Math.acos(d), s = Math.sin(th);
  return a.map((v, i) => (v * Math.sin((1 - t) * th) + b[i] * Math.sin(t * th)) / s);
}
// matrice 3x3 (ligne par ligne) d'un quaternion
export function matriceQ([w, x, y, z]) {
  return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
}
const app = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
const appT = (M, v) => [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]];
const croix = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lisse = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
// quaternion qui amene le vecteur unitaire a sur b
function qVers(a, b) {
  const c = croix(a, b), d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.9999) return [0, 1, 0, 0];
  return qnorm([1 + d, c[0], c[1], c[2]]);
}
// rotation (vecteur de rotation phi) appliquee a v : Rodrigues
function tourner(phi, v) {
  const a = Math.hypot(...phi); if (a < 1e-9) return v;
  const k = phi.map((x) => x / a), c = Math.cos(a), s = Math.sin(a), kv = croix(k, v), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * d * (1 - c));
}

// ---------------------------------------------------------------- rotations exactes des membres (repere du modele)
// Rodrigues : matrice 3x3 (ligne par ligne) de la rotation de vecteur phi
export function matPhi(phi) {
  const a = Math.hypot(...phi);
  if (a < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const [x, y, z] = phi.map((v) => v / a), c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}
const m3 = (A, B) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]));
const tr3 = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const rx = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const ry = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rz = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
const borne = (v) => Math.max(-1, Math.min(1, v));
// angles (x, y, z) tels que M = Rz(z) . Ry(y) . Rx(x) (ModelPart : zRot, yRot, xRot)
export const eulerZYX = (M) => [Math.atan2(M[7], M[8]), Math.asin(borne(-M[6])), Math.atan2(M[3], M[0])];
// angles (x, y, z) tels que M = Rz(z) . Rx(x) . Ry(y) (bras et jambes du joueur : perso/modele.js rotationMembre)
export const eulerZXY = (M) => [Math.asin(borne(M[7])), Math.atan2(-M[6], M[8]), Math.atan2(-M[1], M[4])];
// angles (x, y, z) tels que M = Ry(y) . Rx(x) . Rz(z) (tete du joueur : lacet, tangage, roulis)
export const eulerYXZ = (M) => [Math.asin(borne(-M[5])), Math.atan2(M[2], M[8]), Math.atan2(M[3], M[4])];
const ecart = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Membre du joueur (repere du modele = celui des parties de perso/modele.js) : la pose v = [avant, cote, torsion] (degres) suivie de la
// rotation phi autour de la hanche ou de l'epaule, rendue comme une pose du meme modele : R = Rz(lat x cote) . Rx(-avant) . Ry(-lat x torsion)
export function poseMembreJoueur(nom, v, phi) {
  const lat = nom.endsWith('D') ? 1 : -1, M = m3(matPhi(phi), matriceMembre(nom, v ?? [0, 0]));
  const [x, y, z] = eulerZXY(M);
  return [-x * DEG, lat * z * DEG, -lat * y * DEG];
}
// Tete du joueur : R = Ry(lacet) . Rx(tangage) . Rz(-roulis)
export function poseTeteJoueur(t, phi) {
  const M = m3(matPhi(phi), m3(m3(ry((t?.[0] ?? 0) * RAD), rx((t?.[1] ?? 0) * RAD)), rz(-(t?.[2] ?? 0) * RAD)));
  const [x, y, z] = eulerYXZ(M);
  return [y * DEG, x * DEG, -z * DEG];
}
// Partie d'une creature : nouvelle rotation locale L = Rp^T . R(phi) . Rp . L0 (Rp : rotation du parent au repos, L0 : la partie au repos) ;
// rend l'ecart d'angles (degres) a ajouter aux angles de la partie (rendu : pistes `parties`)
export function ecartPartie(m, phi) {
  const L0 = m3(m3(rz(m.q0[2]), ry(m.q0[1])), rx(m.q0[0]));
  const e = eulerZYX(m3(m3(m3(tr3(m.Rp), matPhi(phi)), m.Rp), L0));
  return [0, 1, 2].map((i) => ecart(e[i] - m.q0[i]) * DEG);
}

// ---------------------------------------------------------------- membres
// Repere du MODELE (celui des parties du jeu : Y vers le bas, pixels / 16) ; le monde = Q . Ry(180 - lacet) . diag(-1, -1, 1) . modele.
// Membre : { nom, r0 (direction de repos, unitaire), piv (pivot, blocs, repere du modele, par rapport au centre du corps), L (longueur),
// k, c (ressort, amortissement), lim (angle maximal, rad), lache (pose lache, vecteur de rotation) }
export const JOUEUR = {
  membres: [
    // z : borne de l'ecart lateral (rad) : un bras ou une jambe ne traverse pas le tronc
    { nom: 'brasD', r0: [0, 1, 0], piv: [-5, 2, 0], L: 0.75, k: 40, c: 5, lim: 2.6, lache: [0, 0, 0.55], z: [-0.25, 2.6] },
    { nom: 'brasG', r0: [0, 1, 0], piv: [5, 2, 0], L: 0.75, k: 40, c: 5, lim: 2.6, lache: [0, 0, -0.55], z: [-2.6, 0.25] },
    { nom: 'jambeD', r0: [0, 1, 0], piv: [-1.9, 12, 0], L: 0.75, k: 70, c: 8, lim: 0.9, lache: [0, 0, 0.15], z: [-0.1, 0.9] },
    { nom: 'jambeG', r0: [0, 1, 0], piv: [1.9, 12, 0], L: 0.75, k: 70, c: 8, lim: 0.9, lache: [0, 0, -0.15], z: [-0.9, 0.1] },
    { nom: 'tete', r0: [0, -1, 0], piv: [0, 0, 0], L: 0.5, k: 45, c: 6, lim: 0.8, lache: [0, 0, 0] },
  ].map((m) => ({ ...m, piv: [m.piv[0] / 16, (m.piv[1] - 9.6) / 16, m.piv[2] / 16] })),   // centre du corps : 0,9 bloc au-dessus des pieds (y modele 9,6 px)
  centre: 0.9,
  boite: [[-0.47, 0, -0.16], [0.47, 1.875, 0.16]],     // boite du modele (bras compris), repere du corps avant le lacet, pieds a 0
};
const LIMBE = /(^|_)(arm|arms|leg|head|tail|wing|ear|fin|tentacle|jaw|neck|beak|snout|horn)s?(_\d+)?$|^(tail|head)/;
const cacheModeles = new Map();
// Membres d'une creature lus dans la geometrie de son modele (pose de repos) : direction de repos = centre des cubes de la partie depuis son pivot
function modeleCreature(c, modeles) {
  const cle = `${c.type}|${c.variante ?? ''}|${c.bebe ? 1 : 0}`;
  if (cacheModeles.has(cle)) return cacheModeles.get(cle);
  let res = null;
  try {
    const nom = couchesDe({ type: c.type, variante: c.variante, bebe: !!c.bebe }, modeles, null).couches[0].modele;
    const racine = modeles[nom]?.main?.r;
    if (racine) res = lireModele(racine);
  } catch { res = null; }
  cacheModeles.set(cle, res);
  return res;
}
function lireModele(racine) {
  const membres = [], mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], vus = new Set();
  const base = mul(S(-1, -1, 1), T(0, -1.501, 0));   // modele -> corps (avant le lacet), comme Creature.base
  const marche = (p, nom, M, dansMembre) => {
    const q = [0, 0, 0, 0, 0, 0, 1, 1, 1]; (p.p ?? []).forEach((v, i) => { q[i] = v; });
    const Mp = matricePartie(M, q);
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (let k = 0; k < (p.q?.length ?? 0); k += 5) {
      const X = p.q[k] / 16, Y = p.q[k + 1] / 16, Z = p.q[k + 2] / 16;
      cx += X; cy += Y; cz += Z; n++;
      const w = [Mp[0] * X + Mp[1] * Y + Mp[2] * Z + Mp[3], Mp[4] * X + Mp[5] * Y + Mp[6] * Z + Mp[7], Mp[8] * X + Mp[9] * Y + Mp[10] * Z + Mp[11]];
      const b = [base[0] * w[0] + base[3], base[5] * w[1] + base[7], base[10] * w[2] + base[11]];
      for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], b[i]); mx[i] = Math.max(mx[i], b[i]); }
    }
    const membre = !dansMembre && nom && !vus.has(nom) && LIMBE.test(nom) && !/body|root/.test(nom);
    if (membre && n) {
      const c = [cx / n, cy / n, cz / n], l = Math.hypot(...c);
      if (l > 0.03) {
        const r = [Mp[0] * c[0] + Mp[1] * c[1] + Mp[2] * c[2], Mp[4] * c[0] + Mp[5] * c[1] + Mp[6] * c[2], Mp[8] * c[0] + Mp[9] * c[1] + Mp[10] * c[2]], lr = Math.hypot(...r);
        const tete = /head|neck|jaw|beak|snout|horn|ear/.test(nom);
        const cote = /right/.test(nom) ? 1 : /left/.test(nom) ? -1 : 0;
        membres.push({ nom, Rp: [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]], q0: [q[3], q[4], q[5]], r0: r.map((v) => v / lr), piv: [Mp[3], Mp[7], Mp[11]], L: Math.max(0.15, 2 * l), k: tete ? 45 : 50, c: tete ? 6 : 6, lim: tete ? 0.7 : /tail/.test(nom) ? 1.2 : /arm/.test(nom) ? 2.4 : 1.1, lache: /arm/.test(nom) ? [0, 0, 0.5 * cote] : [0, 0, 0] });
      }
    }
    if (nom) vus.add(nom);
    for (const k of Object.keys(p.c ?? {}).sort()) marche(p.c[k], k, Mp, dansMembre || membre);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  marche(racine, racine.c && racine.c.root ? '' : 'root', I, false);
  if (!Number.isFinite(mn[0])) return null;
  const centre = (mn[1] + mx[1]) / 2;   // hauteur du centre au-dessus des pieds
  // pivots : repere du modele, par rapport au centre du corps (corps -> modele : x -> -x, y -> 1,501 - y)
  const cm = [-(mn[0] + mx[0]) / 2, 1.501 - centre, (mn[2] + mx[2]) / 2];
  for (const m of membres) m.piv = [m.piv[0] - cm[0], m.piv[1] - cm[1], m.piv[2] - cm[2]];
  return { membres, centre, boite: [mn, mx] };
}

// ---------------------------------------------------------------- simulation d'un acteur, tick par tick
// trace(j) : etat du replay au tick j ({ x, y, z, auSol, eau, lacet, mort, mortT }) ou null ; souffles : [{ tick, v, m, sol }]
export function simulerPantin(trace, souffles, modele, nTicks) {
  const parTick = new Map();
  for (const s of souffles) { const l = parTick.get(s.tick) ?? []; l.push(s); parTick.set(s.tick, l); }
  const t0 = Math.min(...souffles.map((s) => s.tick));
  const etats = new Map();
  let q = [1, 0, 0, 0], w = [0, 0, 0], phase = 'fini', n = 0, qA = null, qB = null, rebond = 0, air = 0, poids = 0;
  const L = modele.membres.map(() => ({ phi: [0, 0, 0], dphi: [0, 0, 0] }));
  let qPrec = q, wPrec = [0, 0, 0];
  const pos = (j) => { const s = trace(j); return s ? [s.x, s.y, s.z] : null; };
  for (let j = t0; j <= nTicks; j++) {
    const s = trace(j);
    if (!s) break;
    // souffles de ce tick : vitesse angulaire (moment du souffle + bascule par les pieds retenus au sol)
    for (const so of parTick.get(j) ?? []) {
      const vh = Math.hypot(so.v[0], so.v[2]), vt = Math.hypot(...so.v);
      if (vt < SEUIL) continue;
      let om = so.m.map((x) => x * 25);
      if (so.sol && vh > 1e-6) { const b = croix([0, 1, 0], [so.v[0] / vh, 0, so.v[2] / vh]); om = om.map((x, i) => x + b[i] * vh * 9); }
      let mo = Math.hypot(...om);
      // rotation minimale d'un corps projete (2,5 rad/s) : dans le sens du moment s'il y en a un, sinon la bascule vers l'arriere du souffle
      if (mo < 2.5) { const ax = mo > 0.1 ? om.map((x) => x / mo) : vh > 1e-6 ? croix([0, 1, 0], [so.v[0] / vh, 0, so.v[2] / vh]) : [1, 0, 0]; om = ax.map((x) => x * 2.5); mo = 2.5; }
      if (mo > 12) om = om.map((x) => x * 12 / mo);
      w = phase === 'air' ? w.map((x, i) => x + om[i]) : om;
      phase = 'air'; n = 0; air = 0; poids = 1;
    }
    if (phase === 'air') {
      q = qnorm(qmul(qaxe(w, DT), q)); w = w.map((x) => x * 0.99); air++;
      if ((s.auSol || s.eau) && air > 1) {
        // atterrissage : se coucher (axe du corps ramene a l'horizontale) ou se redresser s'il est presque droit
        const haut = app(matriceQ(q), [0, 1, 0]), incl = Math.acos(Math.max(-1, Math.min(1, haut[1])));
        let cible;
        if (incl < 35 * RAD && s.mort > 0) {
          // mort et presque droit : la chute de la mort du jeu (LivingEntityRenderer.setupRotations : 90 degres autour de l'axe avant du corps)
          const th = (180 - (s.lacet ?? 0)) * RAD, ax = [Math.sin(th), 0, Math.cos(th)];
          cible = [Math.cos(Math.PI / 4), ...ax.map((v) => v * Math.sin(Math.PI / 4))];
        } else if (incl < 35 * RAD) cible = [1, 0, 0, 0];
        else {
          let h = [haut[0], 0, haut[2]], lh = Math.hypot(...h);
          if (lh < 0.2) { const p0 = pos(j - 3) ?? [s.x, s.y, s.z]; h = [s.x - p0[0], 0, s.z - p0[2]]; lh = Math.hypot(...h); if (lh < 1e-6) { h = [1, 0, 0]; lh = 1; } h = h.map((v) => v * (haut[1] > 0 ? 1 : -1)); }
          cible = qnorm(qmul(qVers(haut, h.map((v) => v / lh)), q));
        }
        const p1 = pos(j - 1); rebond = p1 ? Math.max(0.05, Math.min(0.3, Math.abs(p1[1] - s.y) * 2.2)) : 0.1;
        if (incl < 35 * RAD) rebond *= 0.4;
        phase = 'pose'; n = 0; qA = q; qB = cible; w = [0, 0, 0];
      }
    } else if (phase === 'pose') {
      n++; q = qslerp(qA, qB, lisse(n / N_POSE));
      if (n >= N_POSE) { phase = qB[0] > 0.999 ? 'leve' : 'couche'; n = 0; qA = q; if (phase === 'leve') n = N_LEVE; }
    } else if (phase === 'couche') {
      n++;
      if (n >= N_COUCHE && !(s.mort > 0)) { phase = 'leve'; n = 0; qA = q; }
    } else if (phase === 'leve') {
      n++; q = qslerp(qA, [1, 0, 0, 0], lisse(n / N_LEVE)); poids = 1 - lisse(n / N_LEVE);
      if (n >= N_LEVE) { phase = 'fini'; q = [1, 0, 0, 0]; poids = 0; }
    }
    // rebond : un saut a l'atterrissage puis un petit
    const dyB = phase === 'pose' ? (n < 5 ? rebond * Math.sin(Math.PI * n / 5) : rebond * 0.3 * Math.sin(Math.PI * (n - 5) / 3)) : 0;
    // membres : ressorts amortis menes par l'acceleration du corps (repere du modele)
    const pa = pos(j - 2), pb = pos(j - 1), pc = [s.x, s.y, s.z];   // difference arriere : le coup du souffle arrive au tick ou le corps part
    let acc = pa && pb ? [0, 1, 2].map((i) => (pc[i] - 2 * pb[i] + pa[i]) / (DT * DT)) : [0, -G, 0];
    const la = Math.hypot(...acc); if (la > 400) acc = acc.map((v) => v * 400 / la);
    // vitesse et acceleration angulaires (differences des orientations : toutes les phases pareil)
    const dq = qmul(q, [qPrec[0], -qPrec[1], -qPrec[2], -qPrec[3]]), sg = dq[0] < 0 ? -1 : 1;
    const om = [dq[1], dq[2], dq[3]].map((v) => 2 * v * sg / DT), al = om.map((v, i) => (v - wPrec[i]) / DT);
    qPrec = q; wPrec = om;
    const th = (180 - (s.lacet ?? 0)) * RAD, ct = Math.cos(th), st = Math.sin(th);
    const RQ = matriceQ(q);
    const versModele = (v) => { const a = appT(RQ, v), b = [a[0] * ct - a[2] * st, a[1], a[0] * st + a[2] * ct]; return [-b[0], -b[1], b[2]]; };   // (Q . Ry . D)^T
    const vol = phase === 'air' ? 1 : 0.15;
    const F0 = versModele([-acc[0] * vol, (-G - acc[1]) * vol, -acc[2] * vol]), Om = versModele(om), Al = versModele(al);
    const sol = phase !== 'air';
    modele.membres.forEach((m, k) => {
      const E = L[k], kk = sol ? m.k * 2 : m.k, lache = sol ? [0, 0, 0] : m.lache;
      for (let sub = 0; sub < 4; sub++) {
        const h = DT / 4, d = tourner(E.phi, m.r0), r = m.piv.map((v, i) => v + d[i] * m.L / 2);
        const inert = croix(Al, r).map((v, i) => v + croix(Om, croix(Om, r))[i]);
        const F = F0.map((v, i) => v - inert[i]);
        const tq = croix(d, F).map((v) => v * 1.0 / m.L);
        for (let i = 0; i < 3; i++) {
          E.dphi[i] += (tq[i] - kk * (E.phi[i] - lache[i]) - m.c * E.dphi[i]) * h;
          E.dphi[i] = Math.max(-15, Math.min(15, E.dphi[i]));
          E.phi[i] += E.dphi[i] * h;
        }
        const a = Math.hypot(...E.phi);
        if (a > m.lim) { E.phi = E.phi.map((v) => v * m.lim / a); E.dphi = E.dphi.map((v) => v * 0.5); }
        if (m.z && (E.phi[2] < m.z[0] || E.phi[2] > m.z[1])) { E.phi[2] = Math.max(m.z[0], Math.min(m.z[1], E.phi[2])); E.dphi[2] = 0; }
      }
    });
    etats.set(j, { q, dyB, poids, phase, membres: L.map((E) => E.phi.slice()) });
    if (phase === 'fini' && !parTick.size) break;
    if (phase === 'fini' && ![...parTick.keys()].some((t) => t > j)) break;
  }
  return etats;
}

// ---------------------------------------------------------------- application aux poses du film
// parImage[i][k] : poses ; vivants[k] : traces (acteurs-vivants.js) ; tm[i] : temps du monde de l'image ; modeles : table des creatures
// personnages (facultatif) : les Personnage / Creature du rendu (film/video.js) ; creatures : table des creatures (modeles, animations)
export function appliquerPantins(scene, parImage, { replay, vivants, tm, modeles = null, creatures = null, personnages = null }) {
  if (!replay?.souffles?.length) return;
  modeles ??= creatures?.modeles ?? null;
  // hauteur monde du point le plus bas du corps dessine dans la pose p de l'acteur k
  const basDe = (k, p) => {
    const P = personnages?.[k];
    if (P?.basMaillage) return P.basMaillage(p);
    const c = scene.acteurs[k].creature;
    if (!c) return (JOUEUR_GEO ??= new Personnage({ rgba: new Uint8Array(64 * 64 * 4) })).basMaillage(p);
    return modeles ? basCreature(c, creatures ?? { modeles }, p) : null;
  };
  const parId = new Map();
  for (const s of replay.souffles) { const l = parId.get(s.i) ?? []; l.push(s); parId.set(s.i, l); }
  const R = replay.ralenti;
  scene.acteurs.forEach((a, k) => {
    const V = vivants[k];
    if (!V || !parId.has(V.id)) return;
    const c = a.creature;
    const modele = c ? (modeles ? modeleCreature(c, modeles) : null) : JOUEUR;
    if (!modele) return;
    const trace = (j) => { if (j < 0) return null; const e = V.en(j / (20 * R)); return e; };
    const etats = simulerPantin(trace, parId.get(V.id), modele, replay.ticks);
    for (let i = 0; i < parImage.length; i++) {
      const p = parImage[i][k];
      if (p.absent) continue;
      const u = Math.max(0, tm[i] * 20 * R), j = Math.floor(u), f = u - j;
      const A = etats.get(j);
      if (!A) continue;
      const B = etats.get(j + 1) ?? A;
      const q = qslerp(A.q, B.q, f), poids = A.poids + (B.poids - A.poids) * f, dyB = A.dyB + (B.dyB - A.dyB) * f;
      if (poids <= 0 && q[0] > 0.99999) continue;
      const RQ = matriceQ(q);
      // mort pendant le vol : le corps est deja projete, la bascule de la mort du film (anim.js) est remplacee par le couchage du pantin
      if (p.roulis && p._dyMort !== undefined) { p.roulis = 0; p.dy = (p.dy ?? 0) - p._dyMort; }
      p.ragdoll = { R: RQ, centre: modele.centre };
      // membres
      modele.membres.forEach((m, n) => {
        const phi = A.membres[n].map((v, ii) => (v + (B.membres[n][ii] - v) * f) * poids);
        // rotation exacte : phi (repere du modele) composee avec la pose du membre, rendue dans les angles du rendu
        if (!c) {
          if (m.nom === 'tete') { p.tete = poseTeteJoueur(p.tete, phi); return; }
          p[m.nom] = poseMembreJoueur(m.nom, p[m.nom], phi);
        } else if (p.creature) {
          const pa = (p.creature.parties ??= {}), x = (pa[m.nom] ??= [0, 0, 0]), d = m.Rp ? ecartPartie(m, phi) : phi.map((v) => v * DEG);
          x[0] += d[0]; x[1] += d[1]; x[2] += d[2];
        }
      });
      // sol : le point le plus bas du corps DESSINE (le vrai maillage : corps tourne, membres pendants, bebe, echelle ; Personnage.basMaillage,
      // Creature.basMaillage) touche le sol pres du sol (couche, en train de se relever : les pieds restent poses) et ne passe jamais dessous en l'air
      const bas = basDe(k, p);
      if (Number.isFinite(bas)) {
        const haut = Math.max(0, p.y - (p.sol ?? p.y)), proche = Math.max(0, Math.min(1, 1 - haut / 0.8)), ecart = (p.sol ?? p.y) - bas;
        p.dy = (p.dy ?? 0) + proche * ecart + (1 - proche) * Math.max(0, ecart);
      }
      p.dy = (p.dy ?? 0) + dyB;
    }
  });
}
