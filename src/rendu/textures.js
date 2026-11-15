// Textures de blocs : lecture des PNG du kit, classement en couches (opaque / decoupe / melange),
// animations (.mcmeta) et fabrication d'un atlas avec petits niveaux de mip.
//
// Format des pixels : Uint32 petit-boutiste = octets R,G,B,A en memoire (ABGR dans l'entier).
import fs from 'node:fs';
import path from 'node:path';
import { decoderPNG } from './png.js';

export const COUCHE_OPAQUE = 0;
export const COUCHE_DECOUPE = 1;
export const COUCHE_MELANGE = 2;

export const NIVEAUX_MIP = 4; // niveaux 0..3 (1x, 1/2, 1/4, 1/8)

// Reduit une image (Uint32 ABGR) de moitie : moyenne ponderee par l'alpha.
export function reduireMoitie(src, w, h, strategie = 'mean') {
  const w2 = Math.max(1, w >> 1), h2 = Math.max(1, h >> 1);
  const dst = new Uint32Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < 4; k++) {
        const sx = Math.min(w - 1, x * 2 + (k & 1)), sy = Math.min(h - 1, y * 2 + (k >> 1));
        const p = src[sy * w + sx];
        const pa = p >>> 24;
        r += (p & 255) * pa; g += ((p >> 8) & 255) * pa; b += ((p >> 16) & 255) * pa; a += pa;
      }
      if (a === 0) { dst[y * w2 + x] = 0; continue; }
      const alpha = strategie === 'mean' ? Math.round(a / 4) : (a / 4 >= 128 ? 255 : 0);
      dst[y * w2 + x] = ((alpha << 24) | (Math.round(b / a) << 16) | (Math.round(g / a) << 8) | Math.round(r / a)) >>> 0;
    }
  }
  return { data: dst, w: w2, h: h2 };
}

// Texture violette de secours (damier violet/noir 16x16)
function textureManquante() {
  const d = new Uint32Array(256);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) d[y * 16 + x] = ((x >> 3) ^ (y >> 3)) ? 0xff000000 : 0xffff00ff;
  return d;
}

function classer(px) {
  let transp = false;
  for (let i = 0; i < px.length; i++) {
    const a = px[i] >>> 24;
    if (a === 0) transp = true;
    else if (a !== 255) return COUCHE_MELANGE;
  }
  return transp ? COUCHE_DECOUPE : COUCHE_OPAQUE;
}

export class BibliothequeTextures {
  constructor(kitDir) {
    this.dir = path.join(kitDir, 'assets', 'minecraft', 'textures');
    this.sprites = []; // { id, nom, w, h, frames: Uint32Array[], animation, couche, manquante }
    this.parNom = new Map();
    this.manquantes = new Set();
    this.atlas = null;
  }

  // nom : 'block/stone' ou 'minecraft:block/stone'. Retourne un sprite (cree si besoin).
  sprite(nom) {
    nom = nom.replace(/^minecraft:/, '');
    let s = this.parNom.get(nom);
    if (s) return s;
    s = this._charger(nom);
    s.id = this.sprites.length;
    this.sprites.push(s);
    this.parNom.set(nom, s);
    return s;
  }

  _charger(nom) {
    const fichier = path.join(this.dir, ...nom.split('/')) + '.png';
    let img = null;
    try { img = decoderPNG(fs.readFileSync(fichier)); } catch { /* absent ou illisible */ }
    if (!img) {
      this.manquantes.add(nom);
      return { nom, w: 16, h: 16, frames: [textureManquante()], animation: null, couche: COUCHE_OPAQUE, manquante: true };
    }
    const px = new Uint32Array(img.rgba.buffer, img.rgba.byteOffset, img.largeur * img.hauteur);
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(fichier + '.mcmeta', 'utf8')); } catch { /* pas de mcmeta */ }
    const anim = meta?.animation;
    let fw = img.largeur, fh = img.hauteur, frames, animation = null;
    if (anim) {
      fw = anim.width || img.largeur;
      fh = anim.height || (anim.width ? anim.width : img.largeur);
      const n = Math.max(1, Math.floor(img.hauteur / fh));
      frames = [];
      for (let i = 0; i < n; i++) frames.push(px.slice(i * fw * fh, (i + 1) * fw * fh));
      const ft = anim.frametime || 1;
      const liste = (anim.frames || frames.map((_, i) => i)).map((f) => (typeof f === 'number' ? { index: f, temps: ft } : { index: f.index, temps: f.time || ft }));
      const total = liste.reduce((a, f) => a + f.temps, 0);
      if (n > 1 && total > 0) animation = { liste, total };
    } else {
      frames = [px.slice()];
    }
    // couche : sur toutes les images utilisees
    let couche = COUCHE_OPAQUE;
    for (const f of frames) couche = Math.max(couche, classer(f));
    return { nom, w: fw, h: fh, frames, animation, couche, manquante: false, mip: meta?.texture?.mipmap_strategy || 'mean' };
  }

  couche(nom) { return this.sprite(nom).couche; }

  // Fabrique l'atlas avec tous les sprites connus. Les tableaux sont dans des SharedArrayBuffer.
  // Positions alignees sur 16 pour que les niveaux de mip tombent juste.
  construireAtlas({ largeur = 1024 } = {}) {
    const ordre = this.sprites.slice().sort((a, b) => b.h - a.h || b.w - a.w);
    let x = 0, y = 0, ligneH = 0;
    const al = (v) => Math.ceil(v / 16) * 16;
    for (const s of ordre) {
      const sw = al(s.w), sh = al(s.h);
      if (x + sw > largeur) { x = 0; y += ligneH; ligneH = 0; }
      s.ax = x; s.ay = y; x += sw; ligneH = Math.max(ligneH, sh);
    }
    const hauteur = al(y + ligneH) || 16;
    const niveaux = [];
    for (let l = 0; l < NIVEAUX_MIP; l++) {
      const w = largeur >> l, h = hauteur >> l;
      niveaux.push({ w, h, data: new Uint32Array(new SharedArrayBuffer(w * h * 4)) });
    }
    this.atlas = { largeur, hauteur, niveaux };
    for (const s of this.sprites) this._ecrireSprite(s, 0);
    this.derniereImage = new Map();
    return this.atlas;
  }

  // Ecrit le cadre `k` du sprite dans tous les niveaux de l'atlas.
  _ecrireSprite(s, k) {
    let data = s.frames[k], w = s.w, h = s.h;
    for (let l = 0; l < NIVEAUX_MIP; l++) {
      const niv = this.atlas.niveaux[l];
      const ox = s.ax >> l, oy = s.ay >> l;
      for (let yy = 0; yy < h; yy++) {
        const o = (oy + yy) * niv.w + ox;
        for (let xx = 0; xx < w; xx++) niv.data[o + xx] = data[yy * w + xx];
      }
      if (l < NIVEAUX_MIP - 1) { const r = reduireMoitie(data, w, h, s.couche === COUCHE_DECOUPE ? (s.mip === 'mean' ? 'strict_cutout' : s.mip) : 'mean'); data = r.data; w = r.w; h = r.h; }
    }
  }

  // Cadre courant d'un sprite anime a l'instant `temps` (secondes ; 20 ticks par seconde).
  indiceCadre(s, temps) {
    if (!s.animation) return 0;
    const ticks = Math.floor(temps * 20) % s.animation.total;
    let acc = 0;
    for (const f of s.animation.liste) { acc += f.temps; if (ticks < acc) return f.index; }
    return 0;
  }

  // Met a jour les cadres des sprites animes. Retourne le nombre de sprites ecrits.
  mettreAJour(temps) {
    if (!this.atlas) return 0;
    let n = 0;
    for (const s of this.sprites) {
      if (!s.animation) continue;
      const k = this.indiceCadre(s, temps);
      if (this.derniereImage.get(s.id) === k) continue;
      this.derniereImage.set(s.id, k);
      this._ecrireSprite(s, Math.min(k, s.frames.length - 1));
      n++;
    }
    return n;
  }

  // Rectangle UV (normalise 0..1 sur l'atlas) d'un sprite
  rect(s) {
    const A = this.atlas;
    return { u0: s.ax / A.largeur, v0: s.ay / A.hauteur, du: s.w / A.largeur, dv: s.h / A.hauteur };
  }
}

// Lit une colormap 256x256 -> Uint32 (0xRRGGBB)
export function lireColormap(kitDir, nom) {
  const f = path.join(kitDir, 'assets', 'minecraft', 'textures', 'colormap', nom + '.png');
  const img = decoderPNG(fs.readFileSync(f));
  const out = new Uint32Array(img.largeur * img.hauteur);
  for (let i = 0; i < out.length; i++) out[i] = (img.rgba[i * 4] << 16) | (img.rgba[i * 4 + 1] << 8) | img.rgba[i * 4 + 2];
  return { w: img.largeur, h: img.hauteur, data: out };
}
