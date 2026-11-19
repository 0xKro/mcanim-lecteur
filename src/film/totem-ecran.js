// Le totem d'immortalite a l'ecran du joueur sauve (evenement 35 : ClientPacketListener.findTotem -> LocalPlayer.displayItemActivation ->
// ItemActivation, compte a rebours dans GameRenderer.tick ; dessin : ScreenEffectRenderer.renderItemActivationAnimation). Port de Horizon
// horizon-client/src/item_activation.rs et game/totem.rs (MIT, voir ATTRIBUTIONS.md) :
//   - 40 ticks ; t = (40 - ticks restants + partiel) / 40 ; courbe = 10,25 t^5 - 24,95 t^4 + 25,5 t^3 - 13,8 t^2 + 4 t ; angle = courbe x pi ;
//   - pose en vue : translation (x |sin 2a|, y |sin 2a|, -10 + 9 sin a) avec x = decX x 0,3 x largeur / hauteur, y = decY x 0,3 (decalages tires
//     dans [-1, 1[ a l'activation), echelle 0,8, rotation Y de 900 |sin a| degres, X et Z de 6 cos(8 t) degres, puis l'affichage FIXED du modele
//     (item/generated : rotation Y 180) ; projection de la main : 70 degres verticaux (GameRenderer.render3dHud), pleine lumiere, lumieres
//     de l'objet plat (ITEMS_FLAT : voir plus bas) ; dessine apres le monde, avant l'interface.
//   - modele : celui de item/generated (ItemModelGenerator) : faces avant et arriere de la texture et un cote d'un pixel au bord de chaque
//     pixel opaque, epaisseur 1/16.
// Qui le voit : l'acteur que la camera suit (camera "suit", plan par plan), et l'acteur d'une incrustation hud reliee avec "totem": true.
import { texture } from '../objets/fichiers.js';
import { Aleatoire } from '../moteur/aleatoire.js';

export const DUREE_ACTIVATION = 40;
const RAD = Math.PI / 180;

// ---------------------------------------------------------------- matrices 4 x 4 (lignes), points [x, y, z]
const mul = (A, B) => A.map((r) => [0, 1, 2, 3].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j] + r[3] * B[3][j]));
const T = (x, y, z) => [[1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, z], [0, 0, 0, 1]];
const S = (k) => [[k, 0, 0, 0], [0, k, 0, 0], [0, 0, k, 0], [0, 0, 0, 1]];
const RX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1]]; };
const RY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]]; };
const RZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]; };
const point = (M, p) => [0, 1, 2].map((i) => M[i][0] * p[0] + M[i][1] * p[1] + M[i][2] * p[2] + M[i][3]);
const vecteur = (M, v) => [0, 1, 2].map((i) => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);
const norme = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };

// Lumieres de l'objet (Horizon item_render/gui.rs) : DIFFUSE_LIGHT_0 / 1 du jeu tournes en espace de vue. Le modele item/generated a
// "gui_light": "front" (uses_block_light faux) : Lighting.Entry.ITEMS_FLAT, rotationY(-pi/8).rotateX(3 pi/4), comme Horizon le choisit pour les
// objets plats ; face avant pleine lumiere, comme sur les images du jeu (wiki : Totem_of_Undying_activating). ITEMS_3D reste pour un bloc.
const yxz = (y, x, z) => mul(mul(RY(y), RX(x)), RZ(z));
const DIFFUS = [norme([0.2, 1, -0.7]), norme([-0.2, 1, 0.7])];
const LUM_PLAT = DIFFUS.map((v) => norme(vecteur(mul(RY(-Math.PI / 8), RX(Math.PI * 3 / 4)), v)));
const LUM_3D = DIFFUS.map((v) => norme(vecteur(mul(mul([[1, 0, 0, 0], [0, -1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], yxz(1.0821041, 3.2375858, 0)), yxz(-Math.PI / 8, Math.PI * 3 / 4, 0)), v)));
// melange du shader du jeu : min(1, (max(0, n . l0) + max(0, n . l1)) x 0,6 + 0,4)
const melange = (L, n) => Math.min(1, (Math.max(0, n[0] * L[0][0] + n[1] * L[0][1] + n[2] * L[0][2]) + Math.max(0, n[0] * L[1][0] + n[1] * L[1][1] + n[2] * L[1][2])) * 0.6 + 0.4);
export const ombreItemsPlat = (n) => melange(LUM_PLAT, n);
export const ombreItems3d = (n) => melange(LUM_3D, n);

// pose de l'objet (espace du modele : [0, 1]^3, centre a 0,5) -> espace de vue, `ticks` restants (40 -> 1), partiel 0..1
export function poseActivation(ticks, partiel, decX, decY, aspect) {
  const t = (DUREE_ACTIVATION - ticks + partiel) / DUREE_ACTIVATION, t2 = t * t, t3 = t * t2;
  const courbe = 10.25 * t3 * t2 - 24.95 * t2 * t2 + 25.5 * t3 - 13.8 * t2 + 4.0 * t, a = courbe * Math.PI;
  const balance = Math.abs(Math.sin(a * 2)), r6 = 6 * Math.cos(t * 8) * RAD;
  let M = T(decX * 0.3 * aspect * balance, decY * 0.3 * balance, -10 + 9 * Math.sin(a));
  M = mul(M, S(0.8)); M = mul(M, RY(900 * Math.abs(Math.sin(a)) * RAD)); M = mul(M, RX(r6)); M = mul(M, RZ(r6));
  M = mul(M, RY(Math.PI));             // display.fixed de item/generated : rotation [0, 180, 0], echelle 1
  return mul(M, T(-0.5, -0.5, -0.5));  // ItemRenderer : le modele [0, 16] centre
}

// ---------------------------------------------------------------- geometrie de item/generated (ItemModelGenerator) : quads [4 sommets, normale, uv | couleur]
function geometrieObjet(tex) {
  const W = tex.largeur, H = tex.hauteur, z0 = 7.5 / 16, z1 = 8.5 / 16, quads = [];
  const opaque = (i, j) => i >= 0 && j >= 0 && i < W && j < H && tex.rgba[(j * W + i) * 4 + 3] > 0;
  // faces avant (sud, +z) et arriere (nord, -z, texture en miroir) : uv par sommet
  quads.push({ p: [[0, 1, z1], [1, 1, z1], [1, 0, z1], [0, 0, z1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], n: [0, 0, 1] });
  quads.push({ p: [[1, 1, z0], [0, 1, z0], [0, 0, z0], [1, 0, z0]], uv: [[1, 0], [0, 0], [0, 1], [1, 1]], n: [0, 0, -1] });
  // cotes d'un pixel : couleur du pixel bordier
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!opaque(i, j)) continue;
    const k = (j * W + i) * 4, c = [tex.rgba[k] / 255, tex.rgba[k + 1] / 255, tex.rgba[k + 2] / 255];
    const x0 = i / W, x1 = (i + 1) / W, y1 = 1 - j / H, y0 = 1 - (j + 1) / H;
    if (!opaque(i, j - 1)) quads.push({ p: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], c, n: [0, 1, 0] });
    if (!opaque(i, j + 1)) quads.push({ p: [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], c, n: [0, -1, 0] });
    if (!opaque(i - 1, j)) quads.push({ p: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]], c, n: [-1, 0, 0] });
    if (!opaque(i + 1, j)) quads.push({ p: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]], c, n: [1, 0, 0] });
  }
  return quads;
}

// ---------------------------------------------------------------- rasterisation (tampon de profondeur propre : l'objet passe devant le monde)
function dessinerObjet(rgba, W, H, tex, quads, M, fovY = 70) {
  const f = 1 / Math.tan(fovY * RAD / 2), aspect = W / H;
  const proj = (v) => [(v[0] * f / aspect / -v[2] * 0.5 + 0.5) * W, (0.5 - v[1] * f / -v[2] * 0.5) * H, -v[2]];
  const prof = new Float32Array(W * H).fill(Infinity), R = [M[0].slice(0, 3), M[1].slice(0, 3), M[2].slice(0, 3)];
  for (const q of quads) {
    const nv = norme([0, 1, 2].map((i) => R[i][0] * q.n[0] + R[i][1] * q.n[1] + R[i][2] * q.n[2]));
    const v = q.p.map((p) => point(M, p));
    const centre = v.reduce((s, x) => [s[0] + x[0] / 4, s[1] + x[1] / 4, s[2] + x[2] / 4], [0, 0, 0]);
    if (nv[0] * centre[0] + nv[1] * centre[1] + nv[2] * centre[2] >= 0) continue;   // face de dos (le jeu les ecarte)
    if (v.some((x) => x[2] > -0.05)) continue;                                        // derriere le plan proche
    const ombre = ombreItemsPlat(nv), s = v.map(proj);
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) triangle(rgba, W, H, prof, tex, q, ombre, [s[a], s[b], s[c]], q.uv ? [q.uv[a], q.uv[b], q.uv[c]] : null);
  }
}
function triangle(rgba, W, H, prof, tex, q, ombre, s, uv) {
  const xmin = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), xmax = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
  const ymin = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), ymax = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
  const aire = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
  if (Math.abs(aire) < 1e-9) return;
  const iz = s.map((p) => 1 / p[2]);
  for (let y = ymin; y <= ymax; y++) for (let x = xmin; x <= xmax; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((s[1][0] - px) * (s[2][1] - py) - (s[2][0] - px) * (s[1][1] - py)) / aire;
    const w1 = ((s[2][0] - px) * (s[0][1] - py) - (s[0][0] - px) * (s[2][1] - py)) / aire;
    const w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const izp = w0 * iz[0] + w1 * iz[1] + w2 * iz[2], z = 1 / izp, k = y * W + x;
    if (z >= prof[k]) continue;
    let r, g, b;
    if (uv) {   // texture, correcte en perspective, au plus proche ; decoupe a l'alpha 0,1
      const u = (w0 * uv[0][0] * iz[0] + w1 * uv[1][0] * iz[1] + w2 * uv[2][0] * iz[2]) * z, v = (w0 * uv[0][1] * iz[0] + w1 * uv[1][1] * iz[1] + w2 * uv[2][1] * iz[2]) * z;
      const tx = Math.min(tex.largeur - 1, Math.max(0, Math.floor(u * tex.largeur))), ty = Math.min(tex.hauteur - 1, Math.max(0, Math.floor(v * tex.hauteur))), t = (ty * tex.largeur + tx) * 4;
      if (tex.rgba[t + 3] < 26) continue;
      r = tex.rgba[t] / 255; g = tex.rgba[t + 1] / 255; b = tex.rgba[t + 2] / 255;
    } else [r, g, b] = q.c;
    prof[k] = z;
    rgba[k * 4] = Math.round(r * ombre * 255); rgba[k * 4 + 1] = Math.round(g * ombre * 255); rgba[k * 4 + 2] = Math.round(b * ombre * 255);
  }
}

// ---------------------------------------------------------------- pour le film : (rgba, W, H, im) dessine l'animation si l'acteur de l'ecran en a une
// totems : replay.totems [{ tick, acteur, objet }] ; ecrans : [{ joueur, t: [debut, fin] }] (incrustations hud reliees avec "totem": true)
export function creerTotemEcran({ scene, replay, kit }) {
  const L = replay?.totems ?? [];
  if (!L.length) return null;
  const ral = replay.ralenti || 1;
  const ecrans = [];
  const marche = (liste) => { for (const e of liste ?? []) { if (e.type === 'hud' && e.joueur && e.totem) ecrans.push({ joueur: e.joueur, t: e.t ?? [0, Infinity] }); marche(e.incrustations); } };
  marche(scene.incrustations);
  const geo = new Map();
  const objet = (id) => {
    if (!geo.has(id)) { const t = texture(kit, 'item/' + id); geo.set(id, t ? { tex: t, quads: geometrieObjet(t) } : null); }
    return geo.get(id);
  };
  // ItemActivation.activate : deux decalages nextFloat() x 2 - 1 du hasard du joueur (ici : nom de l'acteur et tick, deterministe)
  const decalages = L.map((e) => { let h = 0; for (const ch of String(e.acteur)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; const r = new Aleatoire((h ^ (e.tick * 2654435761)) >>> 0); return [r.flottant() * 2 - 1, r.flottant() * 2 - 1]; });
  return (rgba, W, H, im) => {
    const u = (im.tm ?? im.t) * 20 * ral, t = im.t;
    const voient = new Set(ecrans.filter((e) => t >= e.t[0] && t <= e.t[1]).map((e) => e.joueur));
    if (im.camera?.suit) voient.add(im.camera.suit);
    if (!voient.size) return false;
    // la derniere activation en cours de chaque acteur (une nouvelle remplace l'ancienne : ItemActivation.activate)
    let dessine = false;
    for (const nom of voient) {
      let k = -1;
      for (let i = 0; i < L.length; i++) if (L[i].acteur === nom && L[i].tick <= u && u < L[i].tick + DUREE_ACTIVATION) k = i;
      if (k < 0) continue;
      const g = objet(L[k].objet);
      if (!g) continue;
      const ecoule = u - L[k].tick, ticks = DUREE_ACTIVATION - Math.floor(ecoule), partiel = ecoule - Math.floor(ecoule);
      dessinerObjet(rgba, W, H, g.tex, g.quads, poseActivation(ticks, partiel, decalages[k][0], decalages[k][1], W / H));
      dessine = true;
    }
    return dessine;
  };
}
