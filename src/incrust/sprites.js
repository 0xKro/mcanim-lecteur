// Sprites de l'interface du jeu (coeurs, barre d'objets, infobulle, succes...) lus dans le KIT (groupe `interface`) :
// assets/minecraft/textures/gui/sprites/<nom>.png (+ .mcmeta : decoupe en neuf morceaux). Un pack de ressources les remplace par le kit fusionne.
import fs from 'node:fs';
import path from 'node:path';
import { decoderPNG } from '../rendu/png.js';
import { poserImage, redimensionner } from './toile.js';

const cache = new Map();
const racine = (kit) => path.join(kit, 'assets', 'minecraft', 'textures', 'gui');

function lireImage(f) {
  try { const d = decoderPNG(fs.readFileSync(f)); return { w: d.largeur, h: d.hauteur, px: new Uint8Array(d.rgba) }; } catch { return null; }
}

// Sprite "hud/heart/full" -> { w, h, px, decoupe: {gauche, haut, droite, bas} | null } ou null s'il manque. Animation : premiere image.
export function sprite(kit, nom) {
  const cle = kit + '|' + nom;
  if (cache.has(cle)) return cache.get(cle);
  const f = path.join(racine(kit), 'sprites', ...nom.split('/')) + '.png';
  let s = lireImage(f);
  if (s) {
    let decoupe = null;
    try {
      const m = JSON.parse(fs.readFileSync(f + '.mcmeta', 'utf8'));
      const sc = m.gui?.scaling;
      if (sc?.type === 'nine_slice') {
        const b = sc.border;
        decoupe = typeof b === 'number' ? { gauche: b, haut: b, droite: b, bas: b } : { gauche: b?.left ?? 0, haut: b?.top ?? 0, droite: b?.right ?? 0, bas: b?.bottom ?? 0 };
        s = { ...s, largeurBase: sc.width ?? s.w, hauteurBase: sc.height ?? s.h };
      }
      const a = m.animation;
      if (a) { const fh = a.height || a.width || s.w; if (fh < s.h) s = { ...s, h: fh, px: s.px.slice(0, s.w * fh * 4) }; }
    } catch { /* pas de mcmeta */ }
    s = { ...s, decoupe };
  }
  cache.set(cle, s);
  return s;
}

// Texture de fond d'un conteneur (container/inventory.png ...) : image entiere ou null.
export function textureGui(kit, nom) {
  const cle = kit + '|gui|' + nom;
  if (cache.has(cle)) return cache.get(cle);
  const s = lireImage(path.join(racine(kit), ...nom.split('/')) + '.png');
  cache.set(cle, s);
  return s;
}

// Sous-image d'une image (copie).
export function decouper(img, x, y, w, h) {
  const o = { w, h, px: new Uint8Array(w * h * 4) };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const sx = x + i, sy = y + j; if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
    o.px.set(img.px.subarray((sy * img.w + sx) * 4, (sy * img.w + sx) * 4 + 4), (j * w + i) * 4);
  }
  return o;
}

// Dessine un sprite redimensionne a (w, h) pixels d'image. Avec une decoupe en neuf morceaux, les coins gardent leur taille (x echelle E).
// `E` : pixels d'image par pixel de sprite (les coins).
export function poserSprite(film, W, H, spr, x, y, w, h, { E = 1, alpha = 1, filtre = 'proche', teinte = null } = {}) {
  if (!spr) return;
  const d = spr.decoupe;
  if (!d) return poserImage(film, W, H, spr, x, y, w, h, { alpha, filtre, teinte });
  const g = d.gauche * E, hh = d.haut * E, dr = d.droite * E, b = d.bas * E;
  const xs = [0, d.gauche, spr.w - d.droite, spr.w], ys = [0, d.haut, spr.h - d.bas, spr.h];
  const xd = [x, x + g, x + w - dr, x + w], yd = [y, y + hh, y + h - b, y + h];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const sw = xs[i + 1] - xs[i], sh = ys[j + 1] - ys[j], dw = xd[i + 1] - xd[i], dh = yd[j + 1] - yd[j];
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
    poserImage(film, W, H, decouper(spr, xs[i], ys[j], sw, sh), xd[i], yd[j], dw, dh, { alpha, filtre, teinte });
  }
}

export { redimensionner };
