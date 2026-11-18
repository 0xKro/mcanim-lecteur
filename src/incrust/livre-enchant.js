// Le livre de la table d'enchantement dans son ecran (EnchantmentScreen, docs/SIMULATION.md partie 26) : le modele du livre (BookModel) dessine
// dans la boite de 38 x 31 pixels de GUI a (14, 14) de l'ecran, ouvert de `open` (0 a 1) et feuilletant ses pages selon `flip`.
// Repris de Horizon (MIT, voir ATTRIBUTIONS.md) : item_render/gui.rs (enchanting_book_pose, enchanting_book_pages, lumieres ENTITY_IN_UI,
// diffuse), item_render/special.rs (submit_book, book_pose, part_matrix), game/stations.rs (EnchantBook : tickBook). Geometrie relevee dans
// entity-models.json du jeu 26.3 (`minecraft:book#main`, lecture seule ; test/objets-inventaire.test.js la compare au fichier s'il est la).
import { texture } from '../objets/fichiers.js';
import { Aleatoire } from '../moteur/aleatoire.js';

// boites [x0, y0, z0, x1, y1, z1] en pixels de modele, pose de base [x, y, z, xRot, yRot, zRot] et origine uv (texture 64 x 32)
export const LIVRE = {
  left_lid: { pose: [0, 0, -1, 0, 0, 0], boite: [-6, -5, -0.005, 0, 5, 0], uv: [0, 0] },
  right_lid: { pose: [0, 0, 1, 0, 0, 0], boite: [0, -5, -0.005, 6, 5, 0], uv: [16, 0] },
  seam: { pose: [0, 0, 0, 0, Math.PI / 2, 0], boite: [-1, -5, 0, 1, 5, 0.005], uv: [12, 0] },
  left_pages: { pose: [0, 0, 0, 0, 0, 0], boite: [0, -4, -0.99, 5, 4, 0.01], uv: [0, 10] },
  right_pages: { pose: [0, 0, 0, 0, 0, 0], boite: [0, -4, -0.01, 5, 4, 0.99], uv: [12, 10] },
  flip_page1: { pose: [0, 0, 0, 0, 0, 0], boite: [0, -4, 0, 5, 4, 0.005], uv: [24, 10] },
  flip_page2: { pose: [0, 0, 0, 0, 0, 0], boite: [0, -4, 0, 5, 4, 0.005], uv: [24, 10] },
};

// ---------------------------------------------------------------- etat du livre (EnchantmentScreen.tickBook) tick par tick
// objetPresent : un objet dans la case ; couts : y a-t-il une offre (le livre s'ouvre) ; renvoie { open, flip } apres `ticks` ticks (+ partiel)
export function etatLivre(ticks, graine, offres = true) {
  const R = new Aleatoire(graine ?? 0);
  let flip = 0, oFlip = 0, flipT = 0, flipA = 0, open = 0, oOpen = 0;
  // l'objet est pose au premier tick : une nouvelle page a atteindre (au moins 1 page plus loin)
  do { flipT += R.entierBorne(4) - R.entierBorne(4); } while (flip <= flipT + 1 && flip >= flipT - 1);
  const n = Math.floor(ticks), f = ticks - n;
  for (let i = 0; i <= n; i++) {
    oFlip = flip; oOpen = open;
    open = Math.max(0, Math.min(1, open + (offres ? 0.2 : -0.2)));
    const d = Math.max(-0.2, Math.min(0.2, (flipT - flip) * 0.4));
    flipA += (d - flipA) * 0.9;
    flip += flipA;
  }
  return { open: oOpen + (open - oOpen) * f, flip: oFlip + (flip - oFlip) * f };
}

// ---------------------------------------------------------------- matrices 4 x 4 (colonnes comme glam : M[c * 4 + r])
const mul = (A, B) => { const C = new Float64Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += A[k * 4 + r] * B[c * 4 + k]; C[c * 4 + r] = s; } return C; };
const T = (x, y, z) => Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
const S = (x, y, z) => Float64Array.from([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
const RX = (a) => { const c = Math.cos(a), s = Math.sin(a); return Float64Array.from([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
const RY = (a) => { const c = Math.cos(a), s = Math.sin(a); return Float64Array.from([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
const RZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return Float64Array.from([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); };
const app = (M, p) => [0, 1, 2].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r]);

// enchanting_book_pose : boite de 38 x 31 a (x0, y0) (pixels de GUI)
export function poseLivre(x0, y0, open) {
  const f = 1 - open;
  let M = T(x0 + 19, y0 + 17, 0);
  for (const m of [S(40, 40, -40), RY(Math.PI), RX(25 * Math.PI / 180), T(f * 0.2, f * 0.1, f * 0.25), RY((-f * 90 - 90) * Math.PI / 180), RX(Math.PI)]) M = mul(M, m);
  return M;
}
// enchanting_book_pages : chaque page clamp(frac(flip + decalage) x 1,6 - 0,3, 0, 1)
export function pagesLivre(flip) {
  const p = (o) => { const x = flip + o; return Math.max(0, Math.min(1, (x - Math.floor(x)) * 1.6 - 0.3)); };
  return [p(0.25), p(0.75)];
}

// faces d'un cube de ModelPart (uv : u, v en texels ; taille dx, dy, dz) : [4 sommets, 4 uv] dans l'ordre de entity-models.json
export function facesBoite([x0, y0, z0, x1, y1, z1], [u, v]) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  return [
    [[[x1, y0, z1], [x0, y0, z1], [x0, y0, z0], [x1, y0, z0]], [[u + dz + dx, v], [u + dz, v], [u + dz, v + dz], [u + dz + dx, v + dz]]],
    [[[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], [[u + dz + 2 * dx, v + dz], [u + dz + dx, v + dz], [u + dz + dx, v], [u + dz + 2 * dx, v]]],
    [[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [[u + dz, v + dz], [u, v + dz], [u, v + dz + dy], [u + dz, v + dz + dy]]],
    [[[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [[u + dz + dx, v + dz], [u + dz, v + dz], [u + dz, v + dz + dy], [u + dz + dx, v + dz + dy]]],
    [[[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [[u + 2 * dz + dx, v + dz], [u + dz + dx, v + dz], [u + dz + dx, v + dz + dy], [u + 2 * dz + dx, v + dz + dy]]],
    [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[u + 2 * dz + 2 * dx, v + dz], [u + 2 * dz + dx, v + dz], [u + 2 * dz + dx, v + dz + dy], [u + 2 * dz + 2 * dx, v + dz + dy]]],
  ];
}

// quads du livre en pixels de GUI : [{ p: [[x, y, z] x 4], uv: [[u, v] x 4] (0..1), n: normale }]
export function quadsLivre(x0, y0, open, flip) {
  const ouv = 1.25 * open, [f1, f2] = pagesLivre(flip);   // forAnimation au temps 0 : (sin(0) x 0,1 + 1,25) x open
  const P = poseLivre(x0, y0, open), out = [];
  for (const [nom, part] of Object.entries(LIVRE)) {
    const p = [...part.pose];
    if (nom === 'left_lid') p[4] = Math.PI + ouv;
    else if (nom === 'right_lid') p[4] = -ouv;
    else if (nom === 'left_pages') { p[4] = ouv; p[0] = Math.sin(ouv); }
    else if (nom === 'right_pages') { p[4] = -ouv; p[0] = Math.sin(ouv); }
    else if (nom === 'flip_page1') { p[4] = ouv - ouv * 2 * f1; p[0] = Math.sin(ouv); }
    else if (nom === 'flip_page2') { p[4] = ouv - ouv * 2 * f2; p[0] = Math.sin(ouv); }
    // part_matrix : translation / 16, rotation ZYX (z, y, x), puis les sommets / 16
    const M = mul(mul(mul(mul(P, T(p[0] / 16, p[1] / 16, p[2] / 16)), RZ(p[5])), RY(p[4])), RX(p[3]));
    for (const [pts, uv] of facesBoite(part.boite, part.uv)) {
      const q = pts.map((v) => app(M, [v[0] / 16, v[1] / 16, v[2] / 16]));
      const a = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]], b = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
      let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      let l = Math.hypot(...n);
      if (l < 1e-9) { const c = [q[2][0] - q[1][0], q[2][1] - q[1][1], q[2][2] - q[1][2]], d = [q[3][0] - q[1][0], q[3][1] - q[1][1], q[3][2] - q[1][2]]; n = [c[1] * d[2] - c[2] * d[1], c[2] * d[0] - c[0] * d[2], c[0] * d[1] - c[1] * d[0]]; l = Math.hypot(...n) || 1; }
      n = n.map((c) => c / l);
      out.push({ p: q, uv: uv.map(([u, v]) => [u / 64, v / 32]), n: det3(M) < 0 ? n.map((c) => -c) : n });
    }
  }
  return out;
}
const det3 = (M) => M[0] * (M[5] * M[10] - M[9] * M[6]) - M[4] * (M[1] * M[10] - M[9] * M[2]) + M[8] * (M[1] * M[6] - M[5] * M[2]);

// lumieres ENTITY_IN_UI et diffuse : min(1, (max(0, l0.n) + max(0, l1.n)) x 0,6 + 0,4)
const L0 = (() => { const v = [0.2, -1, -1], l = Math.hypot(...v); return v.map((c) => c / l); })();
const L1 = (() => { const v = [-0.2, -1, 0], l = Math.hypot(...v); return v.map((c) => c / l); })();
const diffuse = (n) => Math.min(1, (Math.max(0, L0[0] * n[0] + L0[1] * n[1] + L0[2] * n[2]) + Math.max(0, L1[0] * n[0] + L1[1] * n[1] + L1[2] * n[2])) * 0.6 + 0.4);

// dessine le livre dans l'image `o` (ecran a l'echelle E : un pixel de GUI = E pixels), coupe a la boite de 38 x 31 a (x0, y0)
export function dessinerLivre(kit, o, E, x0, y0, open, flip) {
  const t = texture(kit, 'entity/enchantment/enchanting_table_book');
  if (!t) return false;
  const quads = quadsLivre(x0, y0, open, flip);
  const X0 = Math.round(x0 * E), Y0 = Math.round(y0 * E), X1 = Math.min(o.w, Math.round((x0 + 38) * E)), Y1 = Math.min(o.h, Math.round((y0 + 31) * E));
  const prof = new Float64Array((X1 - X0) * (Y1 - Y0)).fill(-Infinity);
  for (const q of quads) {
    const lum = diffuse(q.n);
    for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) {
      const A = q.p[i], B = q.p[j], C = q.p[k], ua = q.uv[i], ub = q.uv[j], uc = q.uv[k];
      const ax = A[0] * E, ay = A[1] * E, bx = B[0] * E, by = B[1] * E, cx = C[0] * E, cy = C[1] * E;
      const aire = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(aire) < 1e-9) continue;
      const mx = Math.max(X0, Math.floor(Math.min(ax, bx, cx))), Mx = Math.min(X1 - 1, Math.ceil(Math.max(ax, bx, cx)));
      const my = Math.max(Y0, Math.floor(Math.min(ay, by, cy))), My = Math.min(Y1 - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = my; y <= My; y++) for (let x = mx; x <= Mx; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / aire, w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / aire, w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * A[2] + w1 * B[2] + w2 * C[2], zi = (y - Y0) * (X1 - X0) + (x - X0);
        if (z <= prof[zi]) continue;   // le plus grand z est devant (GUI : z vers l'ecran)
        const u = w0 * ua[0] + w1 * ub[0] + w2 * uc[0], v = w0 * ua[1] + w1 * ub[1] + w2 * uc[1];
        const tx = Math.min(t.largeur - 1, Math.max(0, Math.floor(u * t.largeur))), ty = Math.min(t.hauteur - 1, Math.max(0, Math.floor(v * t.hauteur))), tk = (ty * t.largeur + tx) * 4;
        if (t.rgba[tk + 3] < 26) continue;   // entityCutout : alpha < 0,1 ecarte
        prof[zi] = z;
        const k = (y * o.w + x) * 4;
        o.px[k] = Math.floor(t.rgba[tk] * lum); o.px[k + 1] = Math.floor(t.rgba[tk + 1] * lum); o.px[k + 2] = Math.floor(t.rgba[tk + 2] * lum); o.px[k + 3] = 255;
      }
    }
  }
  return true;
}
