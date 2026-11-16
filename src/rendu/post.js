// Post-traitement d'une image finale ("image" de la scene) : flou, saturation, teinte, contraste, luminosite, vignette, fondu.
// Calcul entier + tables (LUT), sans allocation par pixel ; les tampons sont gardes d'une image a l'autre.
//
// ORDRE FIXE des operations (le meme pour tout le monde, voir docs/CONCEPTION.md, partie "Image") :
//   1. flou (sur tout) -> 2. saturation -> 3. teinte (multiplication) -> 4. contraste -> 5. luminosite   [ces 4 = "etalonnage"]
//   -> melange avec la couleur d'origine selon la force d'exemption du pixel (couleur selective)
//   -> 6. vignette -> 7. fondu (vers une couleur).
// L'exemption ne protege que l'etalonnage (2 a 5) : flou, vignette et fondu touchent toujours tous les pixels.
// Pixels : Uint32 ABGR (octets R,G,B,A en memoire), alpha laisse a 255.
//
// Le flou a besoin des voisins : il se fait sur l'image entiere (thread principal). Tout le reste est pixel par pixel : il peut se
// faire par bandes de 16 rangees (les memes que celles des workers de rendu) : `bandes = { rangeeDe, nW }`.

export const NEUTRE = Object.freeze({ saturation: 1, contraste: 1, luminosite: 1, teinte: [1, 1, 1], vignette: 0, flou: 0, fondu: [0, 0, 0, 0] });
export const RAYON_FLOU_MAX = 32;

const bornes = (x, a, b) => (x < a ? a : x > b ? b : x);

// Valeurs par defaut + bornes. `p` peut etre partiel (tout est facultatif).
export function normaliserImage(p = {}) {
  const t = p.teinte ?? NEUTRE.teinte, f = p.fondu ?? NEUTRE.fondu;
  return {
    saturation: bornes(p.saturation ?? 1, 0, 2), contraste: bornes(p.contraste ?? 1, 0, 3), luminosite: bornes(p.luminosite ?? 1, 0, 3),
    teinte: [bornes(t[0], 0, 2), bornes(t[1], 0, 2), bornes(t[2], 0, 2)],
    vignette: bornes(p.vignette ?? 0, 0, 1), flou: bornes(p.flou ?? 0, 0, RAYON_FLOU_MAX),
    fondu: [bornes(f[0], 0, 1), bornes(f[1], 0, 1), bornes(f[2], 0, 1), bornes(f[3], 0, 1)],
  };
}

// Vrai si au moins un levier n'est pas a sa valeur neutre (sinon, on ne fait rien du tout : cout nul).
export function imageActive(p) {
  if (!p) return false;
  const n = normaliserImage(p);
  return n.saturation !== 1 || n.contraste !== 1 || n.luminosite !== 1 || n.teinte.some((v) => v !== 1) || n.vignette > 0 || Math.round(n.flou) >= 1 || n.fondu[0] > 0;
}

// Vrai si le flou est demande (il oblige a tout faire dans le thread principal).
export const aFlou = (p) => !!p && Math.round(normaliserImage(p).flou) >= 1;

export class PostTraitement {
  constructor() {
    this.tmp = null; this.sommes = null; this.lut = new Uint8Array(768);
    this.vx = null; this.vy = null;
    this.exIdx = new Int32Array(1 << 14); this.exOrig = new Uint32Array(1 << 14);
  }

  // Applique `p` (voir normaliserImage) sur `pixels` (Uint32Array W*H) en place.
  // `force` : Uint8Array W*H (force d'exemption 0..255 par pixel) ou null.
  // `bandes` : { rangeeDe, nW } pour ne traiter que ses bandes de 16 rangees (le flou est alors ignore : a faire avant, partout).
  appliquer(pixels, W, H, p, force = null, bandes = null) {
    const n = normaliserImage(p);
    if (!bandes) {
      const R = Math.min(Math.round(n.flou), RAYON_FLOU_MAX, (Math.min(W, H) - 1) >> 1);
      if (R >= 1) this._flou(pixels, W, H, R);
    }
    const sat = Math.round(n.saturation * 256);
    const satOn = sat !== 256;
    const lutOn = n.teinte.some((v) => v !== 1) || n.contraste !== 1 || n.luminosite !== 1;
    if (lutOn) this._faireLut(n);
    const vig = n.vignette;
    const fa = Math.round(n.fondu[0] * 256);
    const finOn = vig > 0 || fa > 0;
    if (finOn) this._faireVignette(W, H, vig);
    if (!satOn && !lutOn && !finOn) return;
    // plages de rangees [y0, y1[ : toute l'image, ou mes bandes
    const plages = [];
    if (!bandes) plages.push([0, H]);
    else for (let b = bandes.rangeeDe; b * 16 < H; b += bandes.nW) plages.push([b * 16, Math.min(H, b * 16 + 16)]);
    for (const [y0, y1] of plages) {
      const i0 = y0 * W, i1 = y1 * W;
      if (satOn || lutOn) {
        // pixels exempts : on garde leur couleur d'avant l'etalonnage, puis on melange (peu de pixels : cout faible)
        const nEx = force !== null ? this._sauver(pixels, force, i0, i1) : 0;
        this._etalonner(pixels, i0, i1, sat, satOn, lutOn);
        if (nEx > 0) this._rendreExempts(pixels, force, nEx);
      }
      if (finOn) this._finitions(pixels, W, y0, y1, vig, fa, n.fondu);
    }
  }

  // Repere les pixels de force > 0 dans [i0, i1[ (lecture par mots de 4 octets : presque gratuit s'il n'y en a pas). Retourne leur nombre.
  _sauver(pixels, force, i0, i1) {
    let c = 0;
    const pousser = (i) => {
      if (c >= this.exIdx.length) {
        const a = new Int32Array(c * 2); a.set(this.exIdx); this.exIdx = a;
        const o = new Uint32Array(c * 2); o.set(this.exOrig); this.exOrig = o;
      }
      this.exIdx[c] = i; this.exOrig[c] = pixels[i]; c++;
    };
    const m0 = (i0 + 3) >> 2, m1 = i1 >> 2;
    const f32 = new Uint32Array(force.buffer, force.byteOffset, (force.length) >> 2);
    for (let i = i0; i < m0 * 4 && i < i1; i++) if (force[i] !== 0) pousser(i);
    for (let j = m0; j < m1; j++) if (f32[j] !== 0) for (let k = 0; k < 4; k++) if (force[j * 4 + k] !== 0) pousser(j * 4 + k);
    for (let i = Math.max(m1 * 4, m0 * 4); i < i1; i++) if (force[i] !== 0) pousser(i);
    return c;
  }

  _rendreExempts(pixels, force, nEx) {
    const idx = this.exIdx, orig = this.exOrig;
    for (let e = 0; e < nEx; e++) {
      const i = idx[e], o = orig[e], g = pixels[i], k = force[i] / 255;
      const r0 = o & 255, g0 = (o >> 8) & 255, b0 = (o >> 16) & 255, r1 = g & 255, g1 = (g >> 8) & 255, b1 = (g >> 16) & 255;
      const r = (r1 + (r0 - r1) * k + 0.5) | 0, gg = (g1 + (g0 - g1) * k + 0.5) | 0, b = (b1 + (b0 - b1) * k + 0.5) | 0;
      pixels[i] = (0xff000000 | (b << 16) | (gg << 8) | r) >>> 0;
    }
  }

  // Etalonnage : saturation, puis tables teinte/contraste/luminosite. Une boucle courte par cas (pas de test dans la boucle).
  _etalonner(pixels, i0, i1, sat, satOn, lutOn) {
    const lut = this.lut;
    if (satOn && !lutOn && sat < 256) {          // sous 1, le resultat reste entre la couleur et le gris : pas de rognage
      for (let i = i0; i < i1; i++) {
        const px = pixels[i];
        const r = px & 255, g = (px >> 8) & 255, b = (px >> 16) & 255;
        const Y = (r * 77 + g * 150 + b * 29) >> 8;
        pixels[i] = (0xff000000 | ((Y + (((b - Y) * sat) >> 8)) << 16) | ((Y + (((g - Y) * sat) >> 8)) << 8) | (Y + (((r - Y) * sat) >> 8))) >>> 0;
      }
    } else if (!satOn) {
      for (let i = i0; i < i1; i++) {
        const px = pixels[i];
        pixels[i] = (0xff000000 | (lut[512 + ((px >> 16) & 255)] << 16) | (lut[256 + ((px >> 8) & 255)] << 8) | lut[px & 255]) >>> 0;
      }
    } else {
      for (let i = i0; i < i1; i++) {
        const px = pixels[i];
        const r0 = px & 255, g0 = (px >> 8) & 255, b0 = (px >> 16) & 255;
        const Y = (r0 * 77 + g0 * 150 + b0 * 29) >> 8;
        let r = Y + (((r0 - Y) * sat) >> 8), g = Y + (((g0 - Y) * sat) >> 8), b = Y + (((b0 - Y) * sat) >> 8);
        if (r < 0) r = 0; else if (r > 255) r = 255;
        if (g < 0) g = 0; else if (g > 255) g = 255;
        if (b < 0) b = 0; else if (b > 255) b = 255;
        if (lutOn) { r = lut[r]; g = lut[256 + g]; b = lut[512 + b]; }
        pixels[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
      }
    }
  }

  // Vignette puis fondu : multiplicateur M (8.8) par pixel et couleur de fondu pre-multipliee K.
  _finitions(pixels, W, y0, y1, vig, fa, fondu) {
    const vx = this.vx, vy = this.vy;
    const aN = 256 - fa;
    const KR = Math.round(fondu[1] * 255) * fa, KG = Math.round(fondu[2] * 255) * fa, KB = Math.round(fondu[3] * 255) * fa;
    for (let y = y0; y < y1; y++) {
      const vyy = vy[y];
      let i = y * W;
      for (let x = 0; x < W; x++, i++) {
        const px = pixels[i];
        const M = ((256 - vx[x] - vyy) * aN) >> 8;
        const r = ((px & 255) * M + KR) >> 8, g = (((px >> 8) & 255) * M + KG) >> 8, b = (((px >> 16) & 255) * M + KB) >> 8;
        pixels[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
      }
    }
  }

  // Tables 3 x 256 : teinte, contraste, luminosite regroupes (fonctions canal par canal).
  _faireLut(n) {
    const lut = this.lut;
    for (let c = 0; c < 3; c++) {
      const t = n.teinte[c];
      for (let v = 0; v < 256; v++) {
        let o = v * t;
        o = (o - 127.5) * n.contraste + 127.5;
        o *= n.luminosite;
        lut[c * 256 + v] = o < 0 ? 0 : o > 255 ? 255 : Math.round(o);
      }
    }
  }

  // Vignette separable : multiplicateur (8.8) = 256 - vx[x] - vy[y], ou vx = 128*v*nx^2 et vy = 128*v*ny^2 (nx, ny entre -1 et 1).
  // Au centre : 256 (rien) ; au milieu d'un bord : 256*(1 - v/2) ; dans un coin : 256*(1 - v).
  _faireVignette(W, H, v) {
    if (!this.vx || this.vx.length < W) this.vx = new Int32Array(W);
    if (!this.vy || this.vy.length < H) this.vy = new Int32Array(H);
    if (!(v > 0)) { this.vx.fill(0, 0, W); this.vy.fill(0, 0, H); return; }
    for (let x = 0; x < W; x++) { const nx = ((x + 0.5) / W) * 2 - 1; this.vx[x] = Math.round(128 * v * nx * nx); }
    for (let y = 0; y < H; y++) { const ny = ((y + 0.5) / H) * 2 - 1; this.vy[y] = Math.round(128 * v * ny * ny); }
  }

  // Flou en boite de rayon R (fenetre 2R+1, bords repetes), en deux passes (horizontale puis verticale).
  _flou(pixels, W, H, R) {
    if (!this.tmp || this.tmp.length < W * H) this.tmp = new Uint32Array(W * H);
    if (!this.sommes || this.sommes.length < W * 3) this.sommes = new Int32Array(W * 3);
    const tmp = this.tmp, n = 2 * R + 1, inv = 1 / n;
    // passe horizontale : pixels -> tmp
    for (let y = 0; y < H; y++) {
      const base = y * W;
      let sr = 0, sg = 0, sb = 0;
      for (let k = -R; k <= R; k++) {
        const p = pixels[base + (k < 0 ? 0 : k >= W ? W - 1 : k)];
        sr += p & 255; sg += (p >> 8) & 255; sb += (p >> 16) & 255;
      }
      for (let x = 0; x < W; x++) {
        tmp[base + x] = (0xff000000 | (((sb * inv + 0.5) | 0) << 16) | (((sg * inv + 0.5) | 0) << 8) | ((sr * inv + 0.5) | 0)) >>> 0;
        const pa = pixels[base + (x + R + 1 >= W ? W - 1 : x + R + 1)], ps = pixels[base + (x - R < 0 ? 0 : x - R)];
        sr += (pa & 255) - (ps & 255); sg += ((pa >> 8) & 255) - ((ps >> 8) & 255); sb += ((pa >> 16) & 255) - ((ps >> 16) & 255);
      }
    }
    // passe verticale : tmp -> pixels (une somme par colonne, on avance ligne par ligne)
    const S = this.sommes;
    S.fill(0, 0, W * 3);
    for (let k = -R; k <= R; k++) {
      const o = (k < 0 ? 0 : k >= H ? H - 1 : k) * W;
      for (let x = 0; x < W; x++) { const p = tmp[o + x]; S[x * 3] += p & 255; S[x * 3 + 1] += (p >> 8) & 255; S[x * 3 + 2] += (p >> 16) & 255; }
    }
    for (let y = 0; y < H; y++) {
      const o = y * W;
      const oa = (y + R + 1 >= H ? H - 1 : y + R + 1) * W, os = (y - R < 0 ? 0 : y - R) * W;
      for (let x = 0; x < W; x++) {
        const j = x * 3;
        pixels[o + x] = (0xff000000 | (((S[j + 2] * inv + 0.5) | 0) << 16) | (((S[j + 1] * inv + 0.5) | 0) << 8) | ((S[j] * inv + 0.5) | 0)) >>> 0;
        const pa = tmp[oa + x], ps = tmp[os + x];
        S[j] += (pa & 255) - (ps & 255); S[j + 1] += ((pa >> 8) & 255) - ((ps >> 8) & 255); S[j + 2] += ((pa >> 16) & 255) - ((ps >> 16) & 255);
      }
    }
  }
}
