// Effets d'image du montage, sur l'image finale (RGBA W*H*4, alpha 255), apres le rendu et avant les incrustations :
//   roulis (rotation de l'image + agrandissement qui remplit le cadre), flou directionnel (balayage), flou radial (coup de zoom),
//   profondeur de champ (flou selon la distance, avec le tampon de profondeur du rasteriseur), fondu / flash vers une couleur.
// Aucun cout quand l'effet n'est pas demande : rien n'est appele. Les tampons de travail sont gardes d'une image a l'autre.
const RAD = Math.PI / 180;
const tampons = new Map();
function tampon(nom, taille, Type = Uint8Array) {
  let t = tampons.get(nom);
  if (!t || t.length < taille || t.constructor !== Type) { t = new Type(taille); tampons.set(nom, t); }
  return t;
}

// ---------------------------------------------------------------- roulis
// Meme transformation que ancrage.js (transformRoulis) : p' = c + k R(theta) (p - c), echantillonnage bilineaire.
export function appliquerRoulis(rgba, W, H, deg) {
  const a = deg * RAD, c = Math.cos(a), s = Math.sin(a);
  const k = Math.abs(c) + Math.max(W / H, H / W) * Math.abs(s);
  const src = tampon('roulis-src', rgba.length); src.set(rgba);
  const ic = c / k, is = s / k, cx = W / 2, cy = H / 2;
  let o = 0;
  for (let y = 0; y < H; y++) {
    const ey = y + 0.5 - cy;
    for (let x = 0; x < W; x++, o += 4) {
      const ex = x + 0.5 - cx;
      // inverse : p = c + R(-theta) (p' - c) / k
      const u = cx + ex * ic + ey * is - 0.5, v = cy - ex * is + ey * ic - 0.5;
      let x0 = Math.floor(u), y0 = Math.floor(v);
      const fu = u - x0, fv = v - y0;
      let x1 = x0 + 1, y1 = y0 + 1;
      x0 = x0 < 0 ? 0 : x0 >= W ? W - 1 : x0; x1 = x1 < 0 ? 0 : x1 >= W ? W - 1 : x1;
      y0 = y0 < 0 ? 0 : y0 >= H ? H - 1 : y0; y1 = y1 < 0 ? 0 : y1 >= H ? H - 1 : y1;
      const p00 = (y0 * W + x0) * 4, p10 = (y0 * W + x1) * 4, p01 = (y1 * W + x0) * 4, p11 = (y1 * W + x1) * 4;
      const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv;
      rgba[o] = src[p00] * w00 + src[p10] * w10 + src[p01] * w01 + src[p11] * w11;
      rgba[o + 1] = src[p00 + 1] * w00 + src[p10 + 1] * w10 + src[p01 + 1] * w01 + src[p11 + 1] * w11;
      rgba[o + 2] = src[p00 + 2] * w00 + src[p10 + 2] * w10 + src[p01 + 2] * w01 + src[p11 + 2] * w11;
    }
  }
}

// ---------------------------------------------------------------- flous de mouvement
// Flou directionnel : moyenne de `n` points le long d'une droite de `longueur` pixels (centree), d'angle `angle` degres (0 = horizontal, 90 = vertical
// vers le bas). `force` : fraction du petit cote (ou de la hauteur pour flouAuto : `hauteur`).
export function flouDirectionnel(rgba, W, H, longueur, angle) {
  const n = Math.max(3, Math.min(25, Math.round(longueur / 2) | 1));
  const src = tampon('flou-src', rgba.length); src.set(rgba);
  const dx = Math.cos(angle * RAD) * longueur / (n - 1), dy = Math.sin(angle * RAD) * longueur / (n - 1);
  const x0 = -dx * (n - 1) / 2, y0 = -dy * (n - 1) / 2;
  let o = 0;
  const inv = 1 / n;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++, o += 4) {
    let r = 0, g = 0, b = 0;
    let px = x + x0, py = y + y0;
    for (let i = 0; i < n; i++, px += dx, py += dy) {
      let X = px | 0, Y = py | 0;
      X = X < 0 ? 0 : X >= W ? W - 1 : X; Y = Y < 0 ? 0 : Y >= H ? H - 1 : Y;
      const q = (Y * W + X) * 4; r += src[q]; g += src[q + 1]; b += src[q + 2];
    }
    rgba[o] = r * inv; rgba[o + 1] = g * inv; rgba[o + 2] = b * inv;
  }
}

// Flou radial (centre de l'image) : moyenne le long du rayon, de plus en plus forte vers les bords. `force` : part du rayon (0..0.3).
export function flouRadial(rgba, W, H, force) {
  const n = 11;
  const src = tampon('flou-src', rgba.length); src.set(rgba);
  const cx = W / 2, cy = H / 2, inv = 1 / n;
  let o = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++, o += 4) {
    const rx = x - cx, ry = y - cy;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < n; i++) {
      const f = 1 - force * (i / (n - 1));
      let X = (cx + rx * f) | 0, Y = (cy + ry * f) | 0;
      X = X < 0 ? 0 : X >= W ? W - 1 : X; Y = Y < 0 ? 0 : Y >= H ? H - 1 : Y;
      const q = (Y * W + X) * 4; r += src[q]; g += src[q + 1]; b += src[q + 2];
    }
    rgba[o] = r * inv; rgba[o + 1] = g * inv; rgba[o + 2] = b * inv;
  }
}

// ---------------------------------------------------------------- profondeur de champ
// prof : { donnees: Float32Array (1/w par pixel du rendu, 0 = ciel), W, H, ssaa }. dist : distance de mise au point (blocs), force : 0..1
// (rayon de flou maximal = force x 3 % du petit cote), zone : demi-largeur de la zone nette en blocs (defaut 25 % de dist).
// Calcul a mi-resolution : carte de flou, deux passes de flou en boite a rayon variable (sommes cumulees), puis melange avec l'image nette.
export function profondeurDeChamp(rgba, W, H, prof, { dist, force, zone = null }) {
  const U = Math.min(W, H), maxR = force * 0.03 * U;
  if (maxR < 1) return false;
  const w2 = W >> 1, h2 = H >> 1, q = prof.ssaa ?? 1;
  const zn = zone ?? dist * 0.25;
  // rayon de flou (pixels pleine resolution) par pixel a mi-resolution
  const coc = tampon('dof-coc', w2 * h2, Float32Array);
  let flou = false;
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const iw = prof.donnees[Math.min(prof.H - 1, (2 * y) * q) * prof.W + Math.min(prof.W - 1, (2 * x) * q)];
    let c;
    if (iw === 0) c = maxR;   // ciel : infiniment loin
    else { const z = 1 / iw, e = Math.abs(z - dist) - zn; c = e <= 0 ? 0 : maxR * Math.min(1, e / (dist * 0.9 + 1)); }
    coc[y * w2 + x] = c * 0.5;   // rayon a mi-resolution
    if (c >= 1) flou = true;
  }
  if (!flou) return false;
  const sr = tampon('dof-r', w2 * h2, Float32Array), sg = tampon('dof-g', w2 * h2, Float32Array), sb = tampon('dof-b', w2 * h2, Float32Array);
  // reduction 2x2 (moyenne)
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const a = ((2 * y) * W + 2 * x) * 4, b = a + 4, c = a + W * 4, d = c + 4;
    const i = y * w2 + x;
    sr[i] = (rgba[a] + rgba[b] + rgba[c] + rgba[d]) * 0.25; sg[i] = (rgba[a + 1] + rgba[b + 1] + rgba[c + 1] + rgba[d + 1]) * 0.25; sb[i] = (rgba[a + 2] + rgba[b + 2] + rgba[c + 2] + rgba[d + 2]) * 0.25;
  }
  const tr = tampon('dof-tr', w2 * h2, Float32Array), tg = tampon('dof-tg', w2 * h2, Float32Array), tb = tampon('dof-tb', w2 * h2, Float32Array);
  const cum = tampon('dof-cum', (Math.max(w2, h2) + 1) * 3, Float64Array);
  // passe horizontale : source (sr..) -> temporaire (tr..), rayon variable par pixel
  const passe = (ar, ag, ab, br, bg, bb, horiz) => {
    const L = horiz ? w2 : h2, M = horiz ? h2 : w2;
    for (let m = 0; m < M; m++) {
      let s0 = 0, s1 = 0, s2 = 0; cum[0] = 0; cum[1] = 0; cum[2] = 0;
      for (let l = 0; l < L; l++) { const i = horiz ? m * w2 + l : l * w2 + m; s0 += ar[i]; s1 += ag[i]; s2 += ab[i]; cum[(l + 1) * 3] = s0; cum[(l + 1) * 3 + 1] = s1; cum[(l + 1) * 3 + 2] = s2; }
      for (let l = 0; l < L; l++) {
        const i = horiz ? m * w2 + l : l * w2 + m, r = Math.round(coc[i]);
        if (r < 1) { br[i] = ar[i]; bg[i] = ag[i]; bb[i] = ab[i]; continue; }
        const a = l - r < 0 ? 0 : l - r, b = l + r + 1 > L ? L : l + r + 1, k = 1 / (b - a);
        br[i] = (cum[b * 3] - cum[a * 3]) * k; bg[i] = (cum[b * 3 + 1] - cum[a * 3 + 1]) * k; bb[i] = (cum[b * 3 + 2] - cum[a * 3 + 2]) * k;
      }
    }
  };
  passe(sr, sg, sb, tr, tg, tb, true);
  passe(tr, tg, tb, sr, sg, sb, false);
  passe(sr, sg, sb, tr, tg, tb, true);   // deuxieme tour : bords plus doux (proche d'une gaussienne)
  passe(tr, tg, tb, sr, sg, sb, false);
  // melange : pixel pleine resolution = net * (1 - m) + flou (bilineaire depuis mi-resolution) * m
  const full = maxR;
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / 2 - 0.5, y0 = Math.max(0, Math.min(h2 - 1, Math.floor(v))), y1 = Math.min(h2 - 1, y0 + 1), fv = Math.max(0, Math.min(1, v - y0));
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / 2 - 0.5, x0 = Math.max(0, Math.min(w2 - 1, Math.floor(u))), x1 = Math.min(w2 - 1, x0 + 1), fu = Math.max(0, Math.min(1, u - x0));
      const i00 = y0 * w2 + x0, i10 = y0 * w2 + x1, i01 = y1 * w2 + x0, i11 = y1 * w2 + x1;
      const c = (coc[i00] * (1 - fu) + coc[i10] * fu) * (1 - fv) + (coc[i01] * (1 - fu) + coc[i11] * fu) * fv;   // rayon a mi-resolution
      if (c < 0.3) continue;
      const m = Math.min(1, c * 2 / Math.max(2, full * 0.5)) ;
      const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv, o = (y * W + x) * 4;
      rgba[o] += (sr[i00] * w00 + sr[i10] * w10 + sr[i01] * w01 + sr[i11] * w11 - rgba[o]) * m;
      rgba[o + 1] += (sg[i00] * w00 + sg[i10] * w10 + sg[i01] * w01 + sg[i11] * w11 - rgba[o + 1]) * m;
      rgba[o + 2] += (sb[i00] * w00 + sb[i10] * w10 + sb[i01] * w01 + sb[i11] * w11 - rgba[o + 2]) * m;
    }
  }
  return true;
}

// ---------------------------------------------------------------- fondu / flash
export function melangerCouleur(rgba, couleur, alpha) {
  if (alpha <= 0) return;
  const [r, g, b] = couleur, a = Math.min(1, alpha);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] += (r - rgba[i]) * a; rgba[i + 1] += (g - rgba[i + 1]) * a; rgba[i + 2] += (b - rgba[i + 2]) * a; }
}

// Applique, dans l'ordre : profondeur de champ, flous, roulis. `im` : image d'animation (champ, flou, roulis). Retourne la liste des effets appliques.
export function appliquerEffetsImage(rgba, W, H, im, prof = null) {
  const faits = [];
  if (im.champ && prof) { if (profondeurDeChamp(rgba, W, H, prof, im.champ)) faits.push('champ'); }
  else if (im.champ) faits.push('champ-sans-profondeur');
  if (im.flou) {
    const U = Math.min(W, H);
    if (im.flou.force > 0) { flouDirectionnel(rgba, W, H, im.flou.force * (im.flou.hauteur ? H : U), im.flou.angle); faits.push('flou'); }
    if (im.flou.radial > 0) { flouRadial(rgba, W, H, im.flou.radial); faits.push('radial'); }
  }
  if (im.roulis) { appliquerRoulis(rgba, W, H, im.roulis); faits.push('roulis'); }
  return faits;
}
