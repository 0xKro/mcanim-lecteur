// Formes rondes : sphere, ellipsoide, cyl (cylindre, axe x, y ou z), cone. Pleines, ou creuses avec une epaisseur ; bloc ou melange pondere
// (hasard fixe par la graine et la position, comme les autres operations).
//   ["sphere", cx,cy,cz, r, B, {epaisseur, dedans, moitie}]          ["ellipsoide", cx,cy,cz, rx,ry,rz, B, {epaisseur, dedans, moitie}]
//   ["cyl", x,y,z, r, h, B, {axe, epaisseur, dedans}]                 ["cone", x,y,z, r, h, B, {axe, epaisseur, dedans}]
// Centre : entier ou demi-entier (x.5 : diametre pair). Une cellule est dans le disque de rayon r si dx^2 + dz^2 <= (r + 0.5)^2 + 0.25
// (comme //cyl et //sphere de WorldEdit pour un centre entier). cyl et cone : base centree en (x, y, z), h couches le long de l'axe
// (h negatif : vers le bas / l'ouest / le nord) ; le cone se termine en pointe a la derniere couche.
// Creux : la coque est ce qui reste quand on retire `epaisseur` couches vers l'interieur (6 voisins) ; les bouts d'un cylindre, la base
// d'un cone et la coupe d'une demi-sphere restent OUVERTS. `dedans` : bloc (ou "air") pose dans le creux ; sans `dedans` le creux n'est pas touche.
import { ErreurDecor, LIMITES } from './grille.js';

const seuil = (r) => (r + 0.5) * (r + 0.5) + 0.25;

// forme generique : boite locale [x0, y0, z0, x1, y1, z1], dedans(x, y, z) -> bool, ouvert[6] (bas, haut, nord, sud, ouest, est) : un voisin hors
// de la boite de ce cote compte comme "dans la forme" pour le calcul de la coque
function remplir(ex, op, boite, estDans, ouvert) {
  const [x0, y0, z0, x1, y1, z1] = boite;
  const W = x1 - x0 + 1, H = y1 - y0 + 1, L = z1 - z0 + 1, n = W * H * L;
  if (!(W > 0 && H > 0 && L > 0)) return;
  if (n > LIMITES.volume) throw new ErreurDecor(`${op.chemin} : ${op.nom} : boite de ${W} x ${H} x ${L} (${n} cellules ; maximum ${LIMITES.volume} par operation)`);
  const m = new Uint8Array(n);
  let i = 0;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++, i++) m[i] = estDans(x, y, z) ? 1 : 0;
  // erosion : interieur = cellules dont les 6 voisins sont dans la forme (repete `epaisseur` fois)
  let int = null;
  const ep = op.opt.epaisseur ?? 0;
  if (ep > 0) {
    int = m;
    for (let k = 0; k < ep; k++) {
      const s = new Uint8Array(n);
      for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) {
        const j = (y * L + z) * W + x;
        if (!int[j]) continue;
        const v = (dx, dy, dz, cote) => { const xx = x + dx, yy = y + dy, zz = z + dz; if (xx < 0 || yy < 0 || zz < 0 || xx >= W || yy >= H || zz >= L) return ouvert[cote]; return int[(yy * L + zz) * W + xx] === 1; };
        s[j] = v(0, -1, 0, 0) && v(0, 1, 0, 1) && v(0, 0, -1, 2) && v(0, 0, 1, 3) && v(-1, 0, 0, 4) && v(1, 0, 0, 5) ? 1 : 0;
      }
      int = s;
    }
  }
  const dedansB = op.opt.dedans ?? null;
  i = 0;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++, i++) {
    if (!m[i]) continue;
    const interieur = int && int[i];
    if (interieur && !dedansB) continue;
    const [X, Y, Z] = ex.pt(op, [x, y, z]);
    if (interieur && dedansB === 'air') { ex.poserAir(X, Y, Z); continue; }
    ex.poserChoix(op, X, Y, Z, interieur ? dedansB : op.B);
  }
}

function ellipsoide(ex, op) {
  const [cx, cy, cz] = op.c, [rx, ry, rz] = op.r;
  const ax = rx + 0.5, ay = ry + 0.5, az = rz + 0.5;
  const y0 = Math.ceil(cy - ry - 0.5), y1 = Math.floor(cy + ry + 0.5);
  const haut = op.opt.moitie === 'haut', bas = op.opt.moitie === 'bas';
  const boite = [Math.ceil(cx - rx - 0.5), haut ? Math.ceil(cy) : y0, Math.ceil(cz - rz - 0.5), Math.floor(cx + rx + 0.5), bas ? Math.floor(cy) : y1, Math.floor(cz + rz + 0.5)];
  const s = 1 + 0.25 / Math.max(1, Math.min(ax, ay, az) ** 2);
  remplir(ex, op, boite, (x, y, z) => ((x - cx) / ax) ** 2 + ((y - cy) / ay) ** 2 + ((z - cz) / az) ** 2 <= s, [haut, bas, false, false, false, false]);
}

// cylindre et cone : coordonnees (u, v) du disque et t le long de l'axe
function colonne(ex, op, cone) {
  const [x, y, z] = op.p, r = op.r, h = op.h, axe = op.opt.axe ?? 'y', sg = Math.sign(h), n = Math.abs(h);
  const rayon = (t) => (cone ? (n === 1 ? r : r * (1 - t / (n - 1))) : r);
  const R = Math.ceil(r + 0.5);
  // coordonnees locales (x, y, z) -> (u, v, t)
  const uvt = axe === 'y' ? (a, b, c) => [a - x, c - z, (b - y) * sg] : axe === 'x' ? (a, b, c) => [b - y, c - z, (a - x) * sg] : (a, b, c) => [a - x, b - y, (c - z) * sg];
  const dedans = (a, b, c) => {
    const [u, v, t] = uvt(a, b, c);
    if (t < 0 || t > n - 1) return false;
    return u * u + v * v <= seuil(rayon(t));
  };
  const ext = (c, k) => [Math.ceil(c - R), Math.floor(c + R)][k];
  const lo = (c) => (sg > 0 ? c : c - n + 1), hi = (c) => (sg > 0 ? c + n - 1 : c);
  const boite = axe === 'y' ? [ext(x, 0), lo(y), ext(z, 0), ext(x, 1), hi(y), ext(z, 1)]
    : axe === 'x' ? [lo(x), ext(y, 0), ext(z, 0), hi(x), ext(y, 1), ext(z, 1)]
      : [ext(x, 0), ext(y, 0), lo(z), ext(x, 1), ext(y, 1), hi(z)];
  // bouts ouverts : un cylindre aux deux bouts ; un cone seulement a sa base
  const debut = sg > 0 ? 0 : 1, fin = sg > 0 ? 1 : 0;   // indice du cote (0 = moins, 1 = plus) de la base et du bout
  const ouv = [false, false, false, false, false, false];
  const coteAxe = axe === 'y' ? [0, 1] : axe === 'z' ? [2, 3] : [4, 5];
  ouv[coteAxe[debut]] = true;
  if (!cone) ouv[coteAxe[fin]] = true;
  remplir(ex, op, boite, dedans, ouv);
}

export const OPS_FORMES = {
  sphere: ellipsoide,
  ellipsoide,
  cyl: (ex, op) => colonne(ex, op, false),
  cone: (ex, op) => colonne(ex, op, true),
};
