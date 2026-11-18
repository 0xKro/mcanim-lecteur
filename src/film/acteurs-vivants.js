// Acteurs COMMANDES PAR LA SIMULATION (champ `actes`) : relecture de leur trace dans le replay (moteur/acteurs.js ecrit un enregistrement par tick)
// et conversion en pose. Les pistes explicites de la scene (lacet, tete, accroupi, brasD...) s'ajoutent ou l'emportent (docs/SIMULATION.md, partie 9).
//   position, direction du corps : la simulation  | tete : la simulation sauf piste `tete`  | accroupi : la simulation sauf piste `accroupi`
//   jambes et bras : balancement automatique du jeu (cos(phase x 0,6662), jambes 1,4 x amplitude, bras 1,0 x amplitude) + coup de bras
//   (LivingEntity.swing, 6 ticks) + objet tenu ; les pistes brasD / jambeD / boucles de la scene s'ajoutent par-dessus.
import { aReflet, idRendu } from '../objets/reflet.js';   // objet enchante : reflet (docs/SIMULATION.md partie 26)
const DEG = 180 / Math.PI;
const norm180 = (a) => { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; };
const arc = (a, b, u) => a + norm180(b - a) * u;
const PLANE = 1 << 23;   // moteur/acteurs.js DRAPEAUX.PLANE
const PI = Math.PI;

// ---------------------------------------------------------------- elytres (Horizon horizon-client/src/mobs.rs ElytraAnimation, render.rs, anim.rs ; MIT)
// ElytraAnimationState : cible en vol plane [pi/12 + (pi/9 - pi/12) r, 0, -pi/12 + (-pi/2 + pi/12) r] avec r = 1 - (-vy / |v|)^1,5 si vy < 0
// (sinon 1) ; accroupi [2 pi/9, 0,08726646, -pi/4] ; au repos [pi/12, 0, -pi/12] ; chaque tick l'angle avance de 0,3 x l'ecart.
export const AILES_REPOS = [PI / 12, 0, -PI / 12];
export function pasAiles(ang, vitesse, accroupi) {
  let cible;
  if (vitesse) {
    const L = Math.hypot(...vitesse), r = vitesse[1] < 0 && L > 0 ? Math.fround(1 - Math.pow(-vitesse[1] / L, 1.5)) : 1;
    cible = [PI / 12 + (PI / 9 - PI / 12) * r, 0, -PI / 12 + (-PI / 2 + PI / 12) * r];
  } else cible = accroupi ? [PI * 2 / 9, 0.08726646, -PI / 4] : AILES_REPOS;
  return ang.map((a, i) => a + (cible[i] - a) * 0.3);
}
// AvatarRenderer.setupRotations en vol plane : le corps tourne de min(1, t^2 / 100) x (-90 - tangage) degres autour de X (pivot : les pieds),
// puis de l'angle entre la vitesse horizontale et le regard autour de Y (flyingYRot). Rend la matrice monde R (3 x 3, apres le lacet du corps)
// pour `pose.ragdoll` de perso/modele.js : R = Ry(th) . Rx(a) . Ry(phi) . Ry(th)^T, th = 180 - lacet du corps.
export function rotationVol(lacetCorps, lacetTete, tangage, ticksVol, v) {
  const s = Math.min(1, ticksVol * ticksVol / 100), ax = s * (-90 - tangage) * PI / 180;
  const lx0 = -Math.sin(lacetTete * PI / 180), lz0 = Math.cos(lacetTete * PI / 180), vs = Math.cos(tangage * PI / 180);
  const lx = lx0 * vs, lz = lz0 * vs, vl = lx * lx + lz * lz, sp = v[0] * v[0] + v[2] * v[2];
  let phi = 0;
  if (sp > Math.fround(1e-5) && vl > Math.fround(1e-5)) {
    const dot = (v[0] * lx + v[2] * lz) / Math.sqrt(sp * vl), sg = Math.sign(v[0] * lz - v[2] * lx);
    phi = sg * Math.acos(Math.min(1, Math.abs(dot)));
  }
  const th = (180 - lacetCorps) * PI / 180;
  const Ry = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
  const Rx = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const mul = (A, B) => { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C; };
  return mul(mul(mul(Ry(th), Rx(ax)), Ry(phi)), Ry(-th));
}
// Impulsion (Riptide) : AvatarRenderer.setupRotations en pose SPIN_ATTACK : couche dans le sens du regard (xRot -90 - tangage) et tourne de
// -75 degres par tick autour de son axe (Horizon horizon-client/src/mobs/render.rs, MIT)
export function rotationVrille(lacetCorps, tangage, age) {
  const th = (180 - lacetCorps) * PI / 180, ax = (-90 - tangage) * PI / 180, sp = age * -75 * PI / 180;
  const Ry = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
  const Rx = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const mul = (A, B) => { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C; };
  return mul(mul(mul(Ry(th), Rx(ax)), Ry(sp)), Ry(-th));
}
// HumanoidModel en vol plane : balancement des membres divise par max(1, (|v|^2 / 0,2)^3)
export const freinMembres = (v) => Math.max(1, Math.pow(Math.fround((v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) / 0.2), 3));

export function creerVivant(replay, nom) {
  const id = replay.acteurs.indexOf(nom);
  if (id < 0) return null;
  const R = replay.acteursVue, n = replay.acteursVue.length / 16;
  const lignes = [];
  for (let i = 0; i < n; i++) if (R[i * 16 + 1] === id) lignes.push(i * 16);
  if (!lignes.length) return null;
  const K = lignes.length, t0 = R[lignes[0]];   // t0 : premier tick de la trace (une entite nee en cours de route commence plus tard)
  const ligne = (k) => lignes[Math.max(0, Math.min(K - 1, k - t0))];
  const noms = replay.noms;
  // vol plane aux elytres (replay.vols : vitesse et ticks de vol par tick) ; ailes : etat ElytraAnimationState tick par tick (x 0,3 vers la cible)
  const vols = new Map();
  for (const v of replay.vols ?? []) if (v[1] === id) vols.set(v[0], v);
  const ailes = [];   // [xRot, yRot, zRot] a la fin de chaque tick (indices de la trace)
  {
    let ang = [...AILES_REPOS];
    for (let k = 0; k < K; k++) {
      const d = R[lignes[k] + 8], v = vols.get(t0 + k);
      ang = pasAiles(ang, (d & PLANE) !== 0 && v ? [v[2], v[3], v[4]] : null, (d & 1) !== 0);
      ailes.push(ang);
    }
  }
  // vol plane au temps (k + f) : l'etat du tick courant (k + 1, comme le rendu du jeu : fallFlyTicks + partialTick), vitesse interpolee
  // (deltaMovementOnPreviousTick -> deltaMovement)
  const vol = (k, f, drB) => {
    if (!vols.size || !(drB & PLANE)) return { plane: false };
    const vb = vols.get(k + 1) ?? vols.get(k), va = vols.get(k) ?? vb;
    if (!vb) return { plane: false };
    return { plane: true, ticksVol: vb[5] + f, vitesse: [0, 1, 2].map((i) => va[2 + i] + (vb[2 + i] - va[2 + i]) * f) };
  };
  // vehicule simule (moteur/vehicules.js, replay.vehicules) : pose du rendu du jeu par tick, interpolee ; un lacet qui saute de plus de 90 degres
  // est pris a 180 pres (tangage oppose) : le modele du wagonnet est symetrique, le jeu le redessine sur la voie a chaque image
  const vehs = new Map();
  for (const r of replay.vehicules ?? []) if (r[1] === id) vehs.set(r[0], r);
  const vehicule = (k, f) => {
    if (!vehs.size) return null;
    const a = vehs.get(k) ?? vehs.get(k + 1), b = vehs.get(k + 1) ?? a;
    if (!a) return null;
    let yb = b[2], pb = b[3];
    if (Math.abs(norm180(yb - a[2])) > 90) { yb += 180; pb = -pb; }
    const L = (i) => a[i] + (b[i] - a[i]) * f;
    return { yaw: arc(a[2], yb, f), pitch: a[3] + (pb - a[3]) * f, secousse: Math.max(0, a[4] - f), degats: a[5], meche: a[6] >= 0 ? a[6] - f + 1 : -1, bulle: L(7), dx: L(8), dy: L(9), dz: L(10) };
  };
  // armure changee par la simulation (piece cassee, mise, enchantee : replay.armures [tick, acteur, emplacement, pile|null]) : l'etat au tick u
  const chgArmure = (replay.armures ?? []).filter((x) => x[1] === id);
  const armuresA = (u) => { if (!chgArmure.length) return null; const o = {}; for (const [t, , e, p] of chgArmure) if (t <= u) o[e] = p; return o; };
  return {
    id, ticks: K,
    vehicule(tm) { const u = Math.max(0, tm * 20 * replay.ralenti), k = Math.floor(u); return vehicule(k, Math.min(1, u - k)); },
    // angles des ailes au temps tm (interpoles entre deux ticks, comme ElytraAnimation.angles(partial))
    ailes(tm) {
      const u = Math.max(0, tm * 20 * replay.ralenti), k = Math.floor(u), f = Math.min(1, u - k);
      const a = ailes[Math.max(0, Math.min(K - 1, k - t0))] ?? AILES_REPOS, b = ailes[Math.max(0, Math.min(K - 1, k + 1 - t0))] ?? AILES_REPOS;
      return a.map((x, i) => x + (b[i] - x) * f);
    },
    // etat interpole au temps du monde tm (secondes de film) : comme le partialTick du jeu
    en(tm) {
      const u = Math.max(0, tm * 20 * replay.ralenti), k = Math.floor(u), f = Math.min(1, u - k);
      const a = ligne(k), b = ligne(k + 1);
      const lerp = (j) => R[a + j] + (R[b + j] - R[a + j]) * f;
      const dr = R[(f < 0.5 ? a : b) + 8];
      const objet = R[(f < 0.5 ? a : b) + 11];
      return {
        x: lerp(2), y: lerp(3), z: lerp(4), lacet: arc(R[a + 5], R[b + 5], f), lacetTete: arc(R[a + 6], R[b + 6], f), tangage: lerp(7),
        accroupi: (dr & 1) !== 0, auSol: (dr & 2) !== 0, course: (dr & 4) !== 0, balance: (dr & 8) !== 0, balancement: lerp(9), cassage: R[(f < 0.5 ? a : b) + 10],
        objet: objet >= 0 ? idRendu(noms[objet]) : null, reflet: objet >= 0 && aReflet(noms[objet], replay.refletsForces), phase: lerp(12), amplitude: lerp(13),   // objet tenu sans ses composants ; enchante : reflet (objets/reflet.js)
        armures: armuresA(u),
        usage: (dr >> 6) & 7, usageTicks: (dr >> 9) & 4095, invisible: (dr & (1 << 21)) !== 0, lueur: (dr & (1 << 22)) !== 0,   // pose d'utilisation (1 manger, 2 boire, 3 arc, 4 arbalete en charge, 5 arbalete chargee), effets visibles
        eau: (dr & 32) !== 0, blessure: R[(f < 0.5 ? a : b) + 14], mort: R[(f < 0.5 ? a : b) + 15], mortT: R[a + 15] > 0 ? R[a + 15] - 1 + f : -1,   // vie : rougeur 10 ticks, mort 1..21 (20 = disparait)
        ...vol(k, f, R[b + 8]),
      };
    },
    // etat au format de physique.etatA (pour le reste de anim.js)
    etat(vs) { return { x: vs.x, z: vs.z, y: vs.y, vy: 0, auSol: vs.auSol, eau: vs.eau, echelle: false, imp: false, air: 0 }; },
    // ajoute le balancement automatique du jeu aux membres de `pose` (degres, "avant > 0" = vers l'avant)
    membres(vs, pose) {
      const ph = vs.phase * 0.6662, A = vs.amplitude / (vs.plane ? freinMembres(vs.vitesse) : 1);
      const jambe = Math.cos(ph) * 1.4 * A * DEG, bras = Math.cos(ph) * A * DEG;
      pose.jambeD[0] += -jambe; pose.jambeG[0] += jambe;
      pose.brasD[0] += bras; pose.brasG[0] += -bras;
      if (vs.objet) pose.brasD[0] = pose.brasD[0] * 0.5 + 18;                 // ArmPose.ITEM : le bras tenant un objet est a moitie leve
      if (vs.balance || vs.balancement > 0) {                                 // HumanoidModel.setupAttackAnim : coup du bras droit
        const s = vs.balancement, eased = 1 - Math.pow(1 - s, 4), aa = Math.sin(eased * Math.PI);
        const bb = Math.sin(s * Math.PI) * -((vs.tangage / DEG) - 0.7) * 0.75;
        pose.brasD[0] += (1.2 * aa + bb) * DEG;
      }
      const u = vs.usage;
      pose.usageObjet = u ? { type: u, ticks: vs.usageTicks } : null;   // objet tenu : arc tendu (bow_pulling_0..2), arbalete (crossbow_pulling, chargee) : objets/etat-objet.js
      if (u === 1 || u === 2) {                                               // manger, boire : le bras monte a la bouche (3e personne), petit va-et-vient toutes les 4 ticks
        pose.brasD[0] = 84 + Math.sin(vs.usageTicks * Math.PI / 2) * 6; pose.brasD[1] = 0;
      } else if (u === 6) {                                                   // ArmPose.THROW_SPEAR (trident tendu) : le bras droit leve au-dessus de la tete (xRot x 0,5 - pi)
        pose.brasD[0] = pose.brasD[0] * 0.5 + 180; pose.brasD[1] = 0;
      } else if (u >= 3 && u <= 5) {                                                  // ArmPose.BOW_AND_ARROW / CROSSBOW_CHARGE / CROSSBOW_HOLD : les deux bras en avant, a la hauteur de la tete (xRot = -90 + tangage)
        const a = (u === 4 ? 70 : 90) - vs.tangage;
        pose.brasD[0] = a; pose.brasG[0] = a;
      }
    },
  };
}
