// Cinematique inverse d'un bras ou d'une jambe : epaule (ou hanche) a 3 rotations + charniere (coude, genou), resolue a la main (sans boucle
// d'iteration). Maths seules : matrices 3x3 (tableaux de 9, ligne par ligne), vecteurs de 3 nombres. Voir film/cibles.js pour l'usage.
export const RAD = Math.PI / 180;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norme = (a) => Math.hypot(a[0], a[1], a[2]);
const unite = (a) => { const n = norme(a); return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 1, 0]; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const mulMV = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
export function mulMM(A, B) {
  const M = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return M;
}
export const transposee = (R) => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];

// Rotation d'angle `ang` autour de l'axe unitaire u (Rodrigues).
export function rotAxe(u, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), k = 1 - c;
  return [c + u[0] * u[0] * k, u[0] * u[1] * k - u[2] * s, u[0] * u[2] * k + u[1] * s,
    u[1] * u[0] * k + u[2] * s, c + u[1] * u[1] * k, u[1] * u[2] * k - u[0] * s,
    u[2] * u[0] * k - u[1] * s, u[2] * u[1] * k + u[0] * s, c + u[2] * u[2] * k];
}

// Plus petite rotation qui amene le vecteur unitaire a sur le vecteur unitaire b.
export function aligner(a, b) {
  const c = dot(a, b);
  if (c < -1 + 1e-9) {   // opposes : demi-tour autour d'un axe perpendiculaire a a
    const p = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return rotAxe(unite(cross(a, p)), Math.PI);
  }
  const v = cross(a, b), k = 1 / (1 + c);
  return [1 - k * (v[1] * v[1] + v[2] * v[2]), -v[2] + k * v[0] * v[1], v[1] + k * v[0] * v[2],
    v[2] + k * v[0] * v[1], 1 - k * (v[0] * v[0] + v[2] * v[2]), -v[0] + k * v[1] * v[2],
    -v[1] + k * v[0] * v[2], v[0] + k * v[1] * v[2], 1 - k * (v[0] * v[0] + v[1] * v[1])];
}

// ---------------------------------------------------------------- angles d'Euler de l'ordre du modele : R = Rz(rz) . Rx(rx) . Ry(ry)
// Deux triplets donnent la meme rotation : (rz, rx, ry) et (rz + 180, 180 - rx, ry + 180). On garde celui dont rz et ry sont les plus petits
// (un bras leve au-dessus de la tete s'ecrit avant 170, pas cote 180 + torsion 180). Retourne des radians.
const enroule = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
export function eulerZXY(R) {
  const sx = clamp(R[7], -1, 1), cx = Math.hypot(R[1], R[4]);
  let rx = Math.asin(sx), rz, ry;
  if (cx > 1e-7) { rz = Math.atan2(-R[1], R[4]); ry = Math.atan2(-R[6], R[8]); }
  else { ry = 0; rz = Math.atan2(R[3], R[0]); }   // bras exactement a l'horizontale vers l'avant ou l'arriere : rz et ry se confondent
  const B = [enroule(rz + Math.PI), enroule(Math.PI - rx), enroule(ry + Math.PI)];
  if (Math.abs(B[0]) + Math.abs(B[2]) < Math.abs(rz) + Math.abs(ry) - 1e-9) return B;
  return [rz, rx, ry];
}
export const matriceZXY = (rz, rx, ry) => {
  const [cz, sz, cx, sx, cy, sy] = [Math.cos(rz), Math.sin(rz), Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry)];
  return [cz * cy - sz * sx * sy, -sz * cx, cz * sy + sz * sx * cy, sz * cy + cz * sx * sy, cz * cx, sz * sy - cz * sx * cy, -cx * sy, sx, cx * cy];
};

// ---------------------------------------------------------------- quaternions (melange de deux rotations)
function enQuat(R) {
  const t = R[0] + R[4] + R[8];
  let w, x, y, z;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (R[7] - R[5]) / s; y = (R[2] - R[6]) / s; z = (R[3] - R[1]) / s; }
  else if (R[0] > R[4] && R[0] > R[8]) { const s = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2; w = (R[7] - R[5]) / s; x = s / 4; y = (R[1] + R[3]) / s; z = (R[2] + R[6]) / s; }
  else if (R[4] > R[8]) { const s = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2; w = (R[2] - R[6]) / s; x = (R[1] + R[3]) / s; y = s / 4; z = (R[5] + R[7]) / s; }
  else { const s = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2; w = (R[3] - R[1]) / s; x = (R[2] + R[6]) / s; y = (R[5] + R[7]) / s; z = s / 4; }
  return [w, x, y, z];
}
function deQuat([w, x, y, z]) {
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
// Melange A -> B, poids w de 0 (A) a 1 (B), par le plus court chemin.
export function melangerRotations(A, B, w) {
  if (w <= 0) return A;
  if (w >= 1) return B;
  const qa = enQuat(A);
  let qb = enQuat(B), c = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
  if (c < 0) { qb = qb.map((v) => -v); c = -c; }
  let ka, kb;
  if (c > 0.9995) { ka = 1 - w; kb = w; }
  else { const om = Math.acos(c), so = Math.sin(om); ka = Math.sin((1 - w) * om) / so; kb = Math.sin(w * om) / so; }
  const q = qa.map((v, i) => ka * v + kb * qb[i]);
  const n = Math.hypot(...q);
  return deQuat(q.map((v) => v / n));
}
// Angle (radians) de la rotation qui passe de A a B : sert a mesurer les sauts d'une image a l'autre.
export function ecartRotation(A, B) {
  const M = mulMM(transposee(A), B);
  return Math.acos(clamp((M[0] + M[4] + M[8] - 1) / 2, -1, 1));
}

// ---------------------------------------------------------------- le solveur
// Membre a deux segments : pivot S (epaule ou hanche) dans le repere du monde, parent Rp (rotation du repere de l'epaule), charniere K = (0, ym, 0)
// dans le repere du membre, extremite (centre de la face du bout) a (hOff, long, 0) dans le repere du segment bas ; le segment bas tourne autour
// de l'axe X de la charniere de signe * flexion (signe -1 : l'avant-bras part vers l'avant ; +1 : le bas de jambe part vers l'arriere).
//   position de l'extremite = S + R . (K + Rx(signe * flexion) . (hOff, long, 0))
// La distance S-extremite fixe la flexion (loi des cosinus, bornee a 0..flexMax) ; l'orientation de l'epaule est alors fixee a une rotation
// pres autour de la droite S-cible (le pivot du coude) : on choisit ce pivot pour que le coude parte du cote de `indice` (direction unitaire, ou
// fonction de la direction de la cible vh).
// Hors de portee (trop loin) : membre tendu, dirige vers la cible ; trop pres : flexion maximale, dirige vers la cible.
// `penalite(Rloc, E)` (facultative ; E = position du coude) : > 0 quand l'orientation sort des amplitudes plausibles ou que le coude entre dans le tronc ; on tourne alors le coude autour de la droite
// (au plus 90 degres) vers l'orientation la plus proche de la premiere qui reste plausible (continu : le minimum bouge doucement).
export function resoudreMembre({ S, Rp, T, g, indice, penalite = null, flexMax = 150, prec = null, pasMax = 12 * RAD }) {
  const { ym, hOff, long, signe } = g;
  const v = sub(T, S), d = norme(v), vh = d > 1e-9 ? [v[0] / d, v[1] / d, v[2] / d] : [0, 1, 0];
  const portee = Math.hypot(hOff, ym + long);
  const c = (d * d - hOff * hOff - ym * ym - long * long) / (2 * ym * long);
  const cth = clamp(c, Math.cos(flexMax * RAD), 1), th = Math.acos(cth);
  // hors de portee : le decalage lateral de l'axe du bras (hOff) s'efface peu a peu pour que le bras pointe VRAIMENT vers la cible lointaine
  const u = d > portee ? Math.min(1, (d - portee) / portee) : 0, s = 1 - u * u * (3 - 2 * u);
  const q = [hOff * s, ym + long * cth, signe * long * Math.sin(th)];
  const R0 = aligner(unite(q), vh);
  const E0 = mulMV(R0, [0, ym, 0]);
  const ind = typeof indice === 'function' ? indice(vh) : indice;
  const a = sub(E0, vh.map((x) => x * dot(E0, vh))), b = sub(ind, vh.map((x) => x * dot(ind, vh)));
  const phi = norme(a) > 1e-9 && norme(b) > 1e-9 ? Math.atan2(dot(vh, cross(a, b)), dot(a, b)) : 0;
  const Rw = mulMM(rotAxe(vh, phi), R0);
  const Rpt = transposee(Rp);
  const monde = (delta) => (delta ? mulMM(rotAxe(vh, delta), Rw) : Rw);
  const loc = (delta) => mulMM(Rpt, monde(delta));
  const pen = (delta) => { const M = monde(delta), e = mulMV(M, [0, ym, 0]); return penalite(mulMM(Rpt, M), [S[0] + e[0], S[1] + e[1], S[2] + e[2]]); };
  let delta = 0;
  if (penalite && pen(0) > 0) {
    const J = (dl) => dl * dl + 400 * pen(dl);
    let meilleur = Infinity;
    for (let dl = -Math.PI / 2; dl <= Math.PI / 2 + 1e-9; dl += 3 * RAD) { const j = J(dl); if (j < meilleur) { meilleur = j; delta = dl; } }
    const centre = delta;
    for (let dl = centre - 3 * RAD; dl <= centre + 3 * RAD + 1e-9; dl += 0.25 * RAD) { const j = J(dl); if (j < meilleur) { meilleur = j; delta = dl; } }
  }
  let Rcible = monde(delta);
  // Continuite : le pivot du coude ne peut pas faire n'importe quoi d'une image a l'autre (il n'existe pas de choix du coude continu pour toutes les
  // directions de la main : la ou l'indice est de face, le pivot voulu bascule d'un coup). On part de la rotation de l'image d'avant, amenee
  // sur la nouvelle direction par la plus petite rotation (la main reste exactement sur la cible), puis on tourne le coude autour de la
  // droite epaule-cible vers le pivot voulu, d'au plus pasMax par image.
  if (prec) {
    const qh = unite(q), B = mulMM(aligner(unite(mulMV(prec, qh)), vh), prec);
    const e = unite(cross(qh, Math.abs(qh[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const x1 = mulMV(B, e), x2 = mulMV(Rcible, e);
    const eps = Math.atan2(dot(vh, cross(x1, x2)), dot(x1, x2));
    Rcible = mulMM(rotAxe(vh, clamp(eps, -pasMax, pasMax)), B);
  }
  return { Rloc: mulMM(Rpt, Rcible), Rw: Rcible, flex: th / RAD, portee: c <= 1 && c >= Math.cos(flexMax * RAD) };
}
