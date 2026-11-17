// Collisions du jeu : boites de collision des blocs (tables de donnees), mouvement d'une boite (Entity.collide), rayon de bloc.
// Port de Entity.collide / Shapes.collide du jeu (Horizon world/{entity_move,collision,block_collision_scan}.rs : MIT, voir ATTRIBUTIONS.md).
// Les boites sont [x1,y1,z1,x2,y2,z2] en blocs ; une cellule inconnue (`#hidden`) est un cube plein.
import { D } from './donnees.js';

export const EPS = 1e-7;
const CUBE = [[0, 0, 0, 1, 1, 1]];

// Lecteur de monde : { etatEn(x,y,z) -> numero d'etat | -1 (cache), d: Donnees }.
export function boitesLocales(lec, x, y, z) {
  const e = lec.etatEn(x, y, z);
  if (e < 0) return CUBE;
  return lec.d.boites(e);
}

// Toutes les boites de collision (absolues) qui touchent la boite `b` [x1,y1,z1,x2,y2,z2]. Rend une liste a plat.
export function boitesDans(lec, b, sortie = []) {
  // une cellule plus bas : une cloture ou un portillon (1,5) deborde dans la cellule du dessus
  const x0 = Math.floor(b[0] - EPS), x1 = Math.floor(b[3] + EPS), y0 = Math.floor(b[1] - EPS) - 1, y1 = Math.floor(b[4] + EPS), z0 = Math.floor(b[2] - EPS), z1 = Math.floor(b[5] + EPS);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const L = boitesLocales(lec, x, y, z);
    for (let i = 0; i < L.length; i++) { const k = L[i]; sortie.push([k[0] + x, k[1] + y, k[2] + z, k[3] + x, k[4] + y, k[5] + z]); }
  }
  return sortie;
}

// La boite `b` coupe-t-elle une boite de collision ? (recouvrement strict)
export function coupe(lec, b) {
  const x0 = Math.floor(b[0] + EPS), x1 = Math.floor(b[3] - EPS), y0 = Math.floor(b[1] + EPS) - 1, y1 = Math.floor(b[4] - EPS), z0 = Math.floor(b[2] + EPS), z1 = Math.floor(b[5] - EPS);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const L = boitesLocales(lec, x, y, z);
    for (let i = 0; i < L.length; i++) {
      const k = L[i];
      if (b[3] - EPS > k[0] + x && b[0] + EPS < k[3] + x && b[4] - EPS > k[1] + y && b[1] + EPS < k[4] + y && b[5] - EPS > k[2] + z && b[2] + EPS < k[5] + z) return true;
    }
  }
  return false;
}

// Reduit un deplacement `m` le long de l'axe `a` (0 x, 1 y, 2 z) pour que la boite `b` ne penetre pas les boites `liste` (Shapes.collide).
function reduireAxe(liste, b, a, m) {
  if (Math.abs(m) < EPS) return 0;
  const o1 = a === 0 ? 1 : 0, o2 = a === 2 ? 1 : 2;
  for (let i = 0; i < liste.length; i++) {
    const k = liste[i];
    if (!(b[3 + o1] > k[o1] + EPS && b[o1] < k[3 + o1] - EPS && b[3 + o2] > k[o2] + EPS && b[o2] < k[3 + o2] - EPS)) continue;
    if (m > 0 && b[3 + a] <= k[a] + EPS) { const d = k[a] - b[3 + a]; if (d < m) m = d; }
    else if (m < 0 && b[a] >= k[3 + a] - EPS) { const d = k[3 + a] - b[a]; if (d > m) m = d; }
    if (Math.abs(m) < EPS) return 0;
  }
  return m;
}

const decale = (b, x, y, z) => [b[0] + x, b[1] + y, b[2] + z, b[3] + x, b[4] + y, b[5] + z];

// Entity.collideBoundingBox : Y d'abord, puis l'axe horizontal le plus court en premier (X si |x| >= |z|... : Z puis X si |x| < |z|)
function collideBoite(liste, b, mx, my, mz) {
  const dy = reduireAxe(liste, b, 1, my);
  let bb = dy !== 0 ? decale(b, 0, dy, 0) : b;
  const zEnPremier = Math.abs(mx) < Math.abs(mz);
  let dx, dz;
  if (zEnPremier) {
    dz = reduireAxe(liste, bb, 2, mz); if (dz !== 0) bb = decale(bb, 0, 0, dz);
    dx = reduireAxe(liste, bb, 0, mx);
  } else {
    dx = reduireAxe(liste, bb, 0, mx); if (dx !== 0) bb = decale(bb, dx, 0, 0);
    dz = reduireAxe(liste, bb, 2, mz);
  }
  return [dx, dy, dz];
}

// Deplacement d'une boite avec collisions et marche (Entity.collide). `b` : boite, `mv` : [dx,dy,dz] voulu, `auSol` : l'entite etait-elle au sol,
// `pas` : hauteur de marche (0,6). Rend { dx, dy, dz, bloqueX, bloqueY, bloqueZ, auSol (apres) }.
export function deplacerBoite(lec, b, mv, auSol, pas = 0.6) {
  const [mx, my, mz] = mv;
  const zone = [Math.min(b[0], b[0] + mx), Math.min(b[1], b[1] + my) - EPS, Math.min(b[2], b[2] + mz), Math.max(b[3], b[3] + mx), Math.max(b[4], b[4] + my + Math.max(pas, 0)), Math.max(b[5], b[5] + mz)];
  const liste = boitesDans(lec, zone);
  let [dx, dy, dz] = collideBoite(liste, b, mx, my, mz);
  const bx = Math.abs(dx - mx) > EPS, by = Math.abs(dy - my) > EPS, bz = Math.abs(dz - mz) > EPS;
  const posee = by && my < 0;
  if (pas > 0 && (posee || auSol) && (bx || bz)) {
    let v2 = collideBoite(liste, b, mx, pas, mz);
    const v3 = collideBoite(liste, b, 0, pas, 0).slice();
    // la boite etendue vers le mouvement horizontal : on monte d'abord de ce que permet le plafond
    const elargie = [Math.min(b[0], b[0] + mx), b[1], Math.min(b[2], b[2] + mz), Math.max(b[3], b[3] + mx), b[4], Math.max(b[5], b[5] + mz)];
    const v3b = collideBoite(liste, elargie, 0, pas, 0);
    if (v3b[1] < pas) {
      const hb = decale(b, 0, v3b[1], 0);
      const v4 = collideBoite(liste, hb, mx, 0, mz);
      v4[1] += v3b[1];
      if (v4[0] * v4[0] + v4[2] * v4[2] > v2[0] * v2[0] + v2[2] * v2[2]) v2 = v4;
    }
    void v3;
    if (v2[0] * v2[0] + v2[2] * v2[2] > dx * dx + dz * dz) {
      const haut = decale(b, v2[0], v2[1], v2[2]);
      const redescente = collideBoite(liste, haut, 0, -v2[1] + my, 0);
      dx = v2[0]; dy = v2[1] + redescente[1]; dz = v2[2];
    }
  }
  const nx = Math.abs(dx - mx) > EPS, nz = Math.abs(dz - mz) > EPS, ny = Math.abs(dy - my) > EPS;
  return { dx, dy, dz, bloqueX: nx, bloqueY: ny, bloqueZ: nz, auSol: ny && my < 0 };
}

// Dessus du sol sous le point (x,z) : hauteur du plus haut dessus de boite (a moins de `maxHaut` au-dessus de yRef) au point ; null s'il n'y en a pas
// jusqu'a `maxBas` sous yRef. Sert aux acteurs a pistes de cles (film/physique.js) : plein pied, escaliers, dalles, tapis, neige, portes.
export function solSous(lec, x, z, yRef, maxHaut = 0.6, maxBas = 64) {
  const bx = Math.floor(x), bz = Math.floor(z);
  const haut = yRef + maxHaut;
  for (let y = Math.floor(haut); y >= Math.floor(yRef - maxBas); y--) {
    const L = boitesLocales(lec, bx, y, bz);
    let m = null;
    for (let i = 0; i < L.length; i++) {
      const k = L[i];
      if (x + EPS >= k[0] + bx && x - EPS <= k[3] + bx && z + EPS >= k[2] + bz && z - EPS <= k[5] + bz) {
        const t = k[4] + y;
        if (t <= haut + EPS && (m === null || t > m)) m = t;
      }
    }
    if (m !== null) return m;
  }
  return null;
}

// Rayon d'une cellule a l'autre (pas de 0,05) : renvoie la premiere cellule dont une boite de collision est touchee, ou null.
// `cible` : cellule [x,y,z] qui compte comme touchee meme sans boite (bouton, levier : forme de contour non stockee).
export function rayonBloc(lec, de, vers, cible = null) {
  const dx = vers[0] - de[0], dy = vers[1] - de[1], dz = vers[2] - de[2];
  const L = Math.hypot(dx, dy, dz);
  if (L < 1e-9) return cible;
  const n = Math.ceil(L / 0.05);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * L / L, px = de[0] + dx * t, py = de[1] + dy * t, pz = de[2] + dz * t;
    const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
    if (cible && bx === cible[0] && by === cible[1] && bz === cible[2]) return cible;
    const Lb = boitesLocales(lec, bx, by, bz);
    for (let j = 0; j < Lb.length; j++) {
      const k = Lb[j];
      if (px >= k[0] + bx && px <= k[3] + bx && py >= k[1] + by && py <= k[4] + by && pz >= k[2] + bz && pz <= k[5] + bz) return [bx, by, bz];
    }
  }
  return null;
}

// Distance de l'oeil (ex, ey, ez) au point le plus proche de la cellule (bloc plein) : portee d'interaction
export function distanceCellule(ex, ey, ez, x, y, z) {
  const cx = Math.max(x, Math.min(ex, x + 1)), cy = Math.max(y, Math.min(ey, y + 1)), cz = Math.max(z, Math.min(ez, z + 1));
  return Math.hypot(ex - cx, ey - cy, ez - cz);
}

export { D };
