// Mth du jeu : table de sinus de 65 536 flottants simples (Mth.sin / Mth.cos), DEG_TO_RAD en flottant simple, vecteur de regard
// (Entity.calculateViewVector) et mouvement du vol plane aux elytres (LivingEntity.updateFallFlyingMovement).
// Port de Horizon horizon-core/src/geometry/trig.rs, horizon-world/src/view_direction.rs et horizon-client/src/motion.rs
// `fall_flying_movement` (MIT, voir ATTRIBUTIONS.md). Les nombres (10430.378350470453, 0x3c8efa35, 0,75, 0,1, 0,04, 3,2, 0,99F / 0,98F)
// sont ceux de ces fichiers ; le test `test/elytres.test.js` compare le resultat aux bits releves sur la JVM du jeu 26.3 (Horizon les garde).
const f = Math.fround;
const ECHELLE = 10430.378350470453;
const SINUS = (() => { const t = new Float32Array(65536); for (let i = 0; i < 65536; i++) t[i] = Math.sin(i / ECHELLE); return t; })();
// (long)(a * ECHELLE) & 65535 : la troncature vers zero de Java, puis le masque (les negatifs passent par le complement a deux)
const indice = (v) => { const n = Math.trunc(v); return Number(BigInt.asUintN(16, BigInt(n))); };
export const sinMth = (a) => SINUS[indice(a * ECHELLE)];
export const cosMth = (a) => SINUS[indice(a * ECHELLE + 16384)];
export const DEG_RAD = (() => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, 0x3c8efa35); return b.getFloat32(0); })();   // Mth.DEG_TO_RAD (flottant simple)

// Entity.calculateViewVector(xRot, yRot) : tangage > 0 = vers le bas ; lacet 0 = +Z
export function vecteurRegard(tangage, lacet) {
  const p = f(f(tangage) * DEG_RAD), y = f(-f(lacet) * DEG_RAD);
  const cy = cosMth(y), sy = sinMth(y), cp = cosMth(p), sp = sinMth(p);
  return [f(sy * cp), -sp, f(cy * cp)];
}

// LivingEntity.updateFallFlyingMovement : vitesse du tick suivant (sans collision ni hasard) ; v = [vx, vy, vz], gravite 0,08 (0,01 sous Chute lente)
export function mouvementPlane(v, tangage, lacet, gravite) {
  const look = vecteurRegard(tangage, lacet);
  const lean = f(f(tangage) * DEG_RAD);
  const lookH = Math.sqrt(look[0] * look[0] + look[2] * look[2]);
  const moveH = Math.sqrt(v[0] * v[0] + v[2] * v[2]);
  const c = Math.cos(lean), lift = c * c;
  let mx = v[0], my = v[1] + gravite * (-1 + lift * 0.75), mz = v[2];
  if (my < 0 && lookH > 0) {
    const conv = my * -0.1 * lift;
    mx += look[0] * conv / lookH; my += conv; mz += look[2] * conv / lookH;
  }
  if (lean < 0 && lookH > 0) {
    const conv = moveH * -sinMth(lean) * 0.04;
    mx -= look[0] * conv / lookH; my += conv * 3.2; mz -= look[2] * conv / lookH;
  }
  if (lookH > 0) {
    mx += (look[0] / lookH * moveH - mx) * 0.1;
    mz += (look[2] / lookH * moveH - mz) * 0.1;
  }
  return [mx * f(0.99), my * f(0.98), mz * f(0.99)];
}

// LivingEntity.handleFallFlyingCollisions : degats (flottant simple) d'un choc de cote, rien si <= 0
export const degatsMur = (avant, apres) => f((avant - apres) * 10 - 3);
