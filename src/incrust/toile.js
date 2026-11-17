// Toile : petites images RGBA et dessin simple dessus (texte, icones, fleches...). Zero dependance.
// Une "image" est { w, h, px: Uint8Array RGBA non premultiplie }. Une "image de film" est un Uint8Array RGBA W*H*4 (alpha 255).
// Les couleurs sont des tableaux [r, g, b] ou [r, g, b, a] (0..255).

export const creerImage = (w, h) => ({ w, h, px: new Uint8Array(Math.max(0, w) * Math.max(0, h) * 4) });

// ---------------------------------------------------------------- couleurs
// Les 16 couleurs nommees du jeu (codes § 0 a f) ; noms francais en plus.
export const COULEURS_JEU = {
  black: [0, 0, 0], dark_blue: [0, 0, 170], dark_green: [0, 170, 0], dark_aqua: [0, 170, 170], dark_red: [170, 0, 0], dark_purple: [170, 0, 170],
  gold: [255, 170, 0], gray: [170, 170, 170], dark_gray: [85, 85, 85], blue: [85, 85, 255], green: [85, 255, 85], aqua: [85, 255, 255],
  red: [255, 85, 85], light_purple: [255, 85, 255], yellow: [255, 255, 85], white: [255, 255, 255],
};
const ALIAS = { noir: 'black', blanc: 'white', rouge: 'red', vert: 'green', bleu: 'blue', jaune: 'yellow', gris: 'gray', orange: 'gold', rose: 'light_purple', violet: 'dark_purple', cyan: 'aqua', or: 'gold', grey: 'gray', dark_grey: 'dark_gray' };
export const CODES_JEU = '0123456789abcdef';
export const NOMS_PAR_CODE = ['black', 'dark_blue', 'dark_green', 'dark_aqua', 'dark_red', 'dark_purple', 'gold', 'gray', 'dark_gray', 'blue', 'green', 'aqua', 'red', 'light_purple', 'yellow', 'white'];

// "red", "#ff3030", "#f33", "rouge" ou [r,g,b(,a)] -> [r, g, b, a] ; null si on ne comprend pas.
export function lireCouleur(v) {
  if (Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) return [v[0], v[1], v[2], v[3] ?? 255].map((x) => Math.max(0, Math.min(255, Math.round(x))));
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase().replace(/^minecraft:/, '');
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255]; }
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return [parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16), parseInt(m[3] + m[3], 16), 255];
  const nom = COULEURS_JEU[s] ? s : ALIAS[s];
  return nom ? [...COULEURS_JEU[nom], 255] : null;
}

// ---------------------------------------------------------------- melange
// Pose un pixel (r,g,b) d'alpha a (0..255) sur l'image de film `dst` a l'indice d (en octets).
export function melangerPixel(dst, d, r, g, b, a) {
  if (a >= 255) { dst[d] = r; dst[d + 1] = g; dst[d + 2] = b; return; }
  if (a <= 0) return;
  const k = a / 255;
  dst[d] += (r - dst[d]) * k; dst[d + 1] += (g - dst[d + 1]) * k; dst[d + 2] += (b - dst[d + 2]) * k;
}

// Rectangle plein (coordonnees reelles, bords arrondis a l'entier) sur une image de film.
export function rectPlein(film, W, H, x0, y0, x1, y1, [r, g, b, a = 255], alpha = 1) {
  const xa = Math.max(0, Math.round(x0)), xb = Math.min(W, Math.round(x1)), ya = Math.max(0, Math.round(y0)), yb = Math.min(H, Math.round(y1));
  const aa = a * alpha;
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) melangerPixel(film, (y * W + x) * 4, r, g, b, aa);
}

// Pose `img` (une image) dans un rectangle [x, y, x+larg, y+haut] (reels) de l'image de film. Echantillonnage "plus proche" (pixels nets)
// ou "lineaire" (reduction/agrandissement doux). opts : alpha 0..1, teinte [r,g,b] (multiplie), flou (rayon en px, reserve aux glissements).
export function poserImage(film, W, H, img, x, y, larg, haut, { alpha = 1, filtre = 'proche', teinte = null } = {}) {
  if (!(larg > 0 && haut > 0) || alpha <= 0) return;
  const xa = Math.max(0, Math.floor(x)), xb = Math.min(W, Math.ceil(x + larg)), ya = Math.max(0, Math.floor(y)), yb = Math.min(H, Math.ceil(y + haut));
  const sx = img.w / larg, sy = img.h / haut;
  const lin = filtre === 'lineaire';
  const px = img.px;
  for (let j = ya; j < yb; j++) {
    const v = (j + 0.5 - y) * sy;
    if (v < 0 || v >= img.h) continue;
    for (let i = xa; i < xb; i++) {
      const u = (i + 0.5 - x) * sx;
      if (u < 0 || u >= img.w) continue;
      let r, g, b, a;
      if (lin) {
        const uu = u - 0.5, vv = v - 0.5;
        const u0 = Math.floor(uu), v0 = Math.floor(vv), fu = uu - u0, fv = vv - v0;
        let ar = 0, ag = 0, ab = 0, aa = 0;
        for (let q = 0; q < 4; q++) {
          const cu = Math.min(img.w - 1, Math.max(0, u0 + (q & 1))), cv = Math.min(img.h - 1, Math.max(0, v0 + (q >> 1)));
          const w = ((q & 1) ? fu : 1 - fu) * ((q >> 1) ? fv : 1 - fv);
          const o = (cv * img.w + cu) * 4, pa = px[o + 3] * w;   // moyenne ponderee par l'alpha (pas de liseré sombre)
          ar += px[o] * pa; ag += px[o + 1] * pa; ab += px[o + 2] * pa; aa += pa;
        }
        if (aa <= 0) continue;
        r = ar / aa; g = ag / aa; b = ab / aa; a = aa;
      } else {
        const o = ((v | 0) * img.w + (u | 0)) * 4;
        a = px[o + 3]; if (!a) continue;
        r = px[o]; g = px[o + 1]; b = px[o + 2];
      }
      if (teinte) { r = r * teinte[0] / 255; g = g * teinte[1] / 255; b = b * teinte[2] / 255; }
      melangerPixel(film, (j * W + i) * 4, r, g, b, a * alpha);
    }
  }
}

// Pose une image avec une transformation : le point (ox, oy) de l'image (son pivot) est pose en (px, py) de l'image de film, puis agrandi (kx, ky) et tourne
// de `rot` radians autour de ce point. alpha 0..1 ; blanc 0..1 (melange vers le blanc : flash) ; lineaire : adouci (sinon pixels nets).
export function poserAffine(film, W, H, img, ox, oy, px, py, kx, ky, rot = 0, { alpha = 1, blanc = 0, lineaire = true } = {}) {
  if (!(kx > 0 && ky > 0) || alpha <= 0) return;
  const c = Math.cos(rot), s = Math.sin(rot);
  const ex = [0, img.w, 0, img.w].map((u, i) => (u - ox) * kx * (i < 2 ? 1 : 1)), ey = [0, 0, img.h, img.h].map((v) => (v - oy) * ky);
  const xs = [], ys = [];
  for (let i = 0; i < 4; i++) { xs.push(px + ex[i] * c - ey[i] * s); ys.push(py + ex[i] * s + ey[i] * c); }
  const xa = Math.max(0, Math.floor(Math.min(...xs))), xb = Math.min(W, Math.ceil(Math.max(...xs))), ya = Math.max(0, Math.floor(Math.min(...ys))), yb = Math.min(H, Math.ceil(Math.max(...ys)));
  const data = img.px;
  for (let j = ya; j < yb; j++) for (let i = xa; i < xb; i++) {
    const dx = i + 0.5 - px, dy = j + 0.5 - py;
    const u = ((dx * c + dy * s) / kx) + ox, v = ((-dx * s + dy * c) / ky) + oy;
    if (u < 0 || v < 0 || u >= img.w || v >= img.h) continue;
    let r, g, b, a;
    if (lineaire) {
      const uu = u - 0.5, vv = v - 0.5, u0 = Math.floor(uu), v0 = Math.floor(vv), fu = uu - u0, fv = vv - v0;
      let ar = 0, ag = 0, ab = 0, aa = 0;
      for (let q = 0; q < 4; q++) {
        const cu = Math.min(img.w - 1, Math.max(0, u0 + (q & 1))), cv = Math.min(img.h - 1, Math.max(0, v0 + (q >> 1)));
        const w = ((q & 1) ? fu : 1 - fu) * ((q >> 1) ? fv : 1 - fv), o = (cv * img.w + cu) * 4, pa = data[o + 3] * w;
        ar += data[o] * pa; ag += data[o + 1] * pa; ab += data[o + 2] * pa; aa += pa;
      }
      if (aa <= 0) continue;
      r = ar / aa; g = ag / aa; b = ab / aa; a = aa;
    } else {
      const o = ((v | 0) * img.w + (u | 0)) * 4; a = data[o + 3]; if (!a) continue;
      r = data[o]; g = data[o + 1]; b = data[o + 2];
    }
    if (blanc > 0) { r += (255 - r) * blanc; g += (255 - g) * blanc; b += (255 - b) * blanc; }
    melangerPixel(film, (j * W + i) * 4, r, g, b, a * alpha);
  }
}

// Copie d'une image avec la couleur multipliee (teinte) ; alpha multiplie par `alpha`.
export function teinterImage(img, [tr, tg, tb], alpha = 1) {
  const o = creerImage(img.w, img.h);
  for (let i = 0; i < img.px.length; i += 4) { o.px[i] = img.px[i] * tr / 255; o.px[i + 1] = img.px[i + 1] * tg / 255; o.px[i + 2] = img.px[i + 2] * tb / 255; o.px[i + 3] = img.px[i + 3] * alpha; }
  return o;
}

// Pose `src` sur `dst` (deux images avec alpha) a (x, y) entiers, couleur multipliee par `teinte`. "Over" non premultiplie.
export function composer(dst, src, x, y, { teinte = null, alpha = 1 } = {}) {
  for (let j = 0; j < src.h; j++) {
    const dy = y + j; if (dy < 0 || dy >= dst.h) continue;
    for (let i = 0; i < src.w; i++) {
      const dx = x + i; if (dx < 0 || dx >= dst.w) continue;
      const s = (j * src.w + i) * 4, d = (dy * dst.w + dx) * 4;
      const sa = src.px[s + 3] / 255 * alpha; if (sa <= 0) continue;
      let r = src.px[s], g = src.px[s + 1], b = src.px[s + 2];
      if (teinte) { r = r * teinte[0] / 255; g = g * teinte[1] / 255; b = b * teinte[2] / 255; }
      const da = dst.px[d + 3] / 255, oa = sa + da * (1 - sa);
      if (oa <= 0) continue;
      dst.px[d] = (r * sa + dst.px[d] * da * (1 - sa)) / oa; dst.px[d + 1] = (g * sa + dst.px[d + 1] * da * (1 - sa)) / oa; dst.px[d + 2] = (b * sa + dst.px[d + 2] * da * (1 - sa)) / oa;
      dst.px[d + 3] = oa * 255;
    }
  }
}

// Agrandit (ou reduit) une image par un facteur reel, "plus proche" : pixels nets.
export function redimensionner(img, w, h, filtre = 'proche') {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  if (w === img.w && h === img.h) return img;
  const o = creerImage(w, h);
  if (filtre === 'proche') {
    for (let j = 0; j < h; j++) { const v = Math.min(img.h - 1, Math.floor((j + 0.5) * img.h / h)); for (let i = 0; i < w; i++) { const u = Math.min(img.w - 1, Math.floor((i + 0.5) * img.w / w)); o.px.set(img.px.subarray((v * img.w + u) * 4, (v * img.w + u) * 4 + 4), (j * w + i) * 4); } }
    return o;
  }
  // lineaire (moyenne ponderee par l'alpha)
  const sx = img.w / w, sy = img.h / h;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const uu = (i + 0.5) * sx - 0.5, vv = (j + 0.5) * sy - 0.5, u0 = Math.floor(uu), v0 = Math.floor(vv), fu = uu - u0, fv = vv - v0;
    let ar = 0, ag = 0, ab = 0, aa = 0;
    for (let q = 0; q < 4; q++) {
      const cu = Math.min(img.w - 1, Math.max(0, u0 + (q & 1))), cv = Math.min(img.h - 1, Math.max(0, v0 + (q >> 1)));
      const wq = ((q & 1) ? fu : 1 - fu) * ((q >> 1) ? fv : 1 - fv), p = (cv * img.w + cu) * 4, pa = img.px[p + 3] * wq;
      ar += img.px[p] * pa; ag += img.px[p + 1] * pa; ab += img.px[p + 2] * pa; aa += pa;
    }
    const d = (j * w + i) * 4;
    if (aa > 0) { o.px[d] = ar / aa; o.px[d + 1] = ag / aa; o.px[d + 2] = ab / aa; o.px[d + 3] = aa; }
  }
  return o;
}

// Flou horizontal d'une image (boite de rayon r, sur les 4 canaux, alpha ponderant la couleur) : glissement rapide des libelles.
export function flouHorizontal(img, r) {
  r = Math.round(r); if (r < 1) return img;
  const o = creerImage(img.w + 2 * r, img.h), n = 2 * r + 1;
  for (let j = 0; j < img.h; j++) for (let i = 0; i < o.w; i++) {
    let sr = 0, sg = 0, sb = 0, sa = 0;
    for (let k = -r; k <= r; k++) { const u = i - r + k; if (u < 0 || u >= img.w) continue; const p = (j * img.w + u) * 4, a = img.px[p + 3]; sr += img.px[p] * a; sg += img.px[p + 1] * a; sb += img.px[p + 2] * a; sa += a; }
    const d = (j * o.w + i) * 4;
    if (sa > 0) { o.px[d] = sr / sa; o.px[d + 1] = sg / sa; o.px[d + 2] = sb / sa; o.px[d + 3] = sa / n; }
  }
  return o;
}

// Disque ou segment epais avec bord adouci (couverture par la distance), sur une image de film.
export function segmentEpais(film, W, H, x0, y0, x1, y1, ep, [r, g, b, a = 255], alpha = 1) {
  const R = ep / 2 + 1, xa = Math.max(0, Math.floor(Math.min(x0, x1) - R)), xb = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + R));
  const ya = Math.max(0, Math.floor(Math.min(y0, y1) - R)), yb = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + R));
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
    const px = x + 0.5 - x0, py = y + 0.5 - y0;
    const u = L2 > 1e-9 ? Math.max(0, Math.min(1, (px * dx + py * dy) / L2)) : 0;
    const d = Math.hypot(px - u * dx, py - u * dy);
    const c = Math.max(0, Math.min(1, ep / 2 + 0.5 - d));
    if (c > 0) melangerPixel(film, (y * W + x) * 4, r, g, b, a * alpha * c);
  }
}

// Triangle plein (sommets reels), couverture binaire au centre du pixel.
export function trianglePlein(film, W, H, p0, p1, p2, [r, g, b, a = 255], alpha = 1) {
  const xa = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0]))), xb = Math.min(W - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
  const ya = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1]))), yb = Math.min(H - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
  const den = (p1[1] - p2[1]) * (p0[0] - p2[0]) + (p2[0] - p1[0]) * (p0[1] - p2[1]);
  if (Math.abs(den) < 1e-9) return;
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
    const px = x + 0.5, py = y + 0.5;
    const l0 = ((p1[1] - p2[1]) * (px - p2[0]) + (p2[0] - p1[0]) * (py - p2[1])) / den, l1 = ((p2[1] - p0[1]) * (px - p2[0]) + (p0[0] - p2[0]) * (py - p2[1])) / den, l2 = 1 - l0 - l1;
    const e = -0.02;
    if (l0 >= e && l1 >= e && l2 >= e) melangerPixel(film, (y * W + x) * 4, r, g, b, a * alpha);
  }
}
