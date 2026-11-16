// Passes d'image du shader : lueur (bloom), rayons de lumiere (god rays), exposition + courbe de tons + etalonnage + vignette, en UNE passe.
//
// Ordre (voir docs/FORMAT-SHADER.md, 2.9 a 2.11) :
//   A. (workers, apres le dessin de leurs bandes) reduction de l'image par F (F = 1/echellePost x ssaa) : source de la lueur (pixels clairs) et masque
//      de lumiere du ciel (pixels de ciel pres du soleil, d'apres le tampon de profondeur ; une trouee dans les feuilles laisse passer la lumiere) ;
//   B. (thread principal, petite image) flou de la lueur, flou radial du masque vers le soleil -> tampon "glow" (lumiere a ajouter) ;
//   C. (workers, par bandes) pour chaque pixel : + glow, x exposition/teinte, courbe de tons, gamma, contraste (tables), puis saturation, vibrance,
//      teintes des ombres/hautes lumieres, vignette ; les pixels exemptes retrouvent leur couleur d'avant (acteurs.respecterExemptions).
//   D. l'etalonnage `image` de la scene s'applique APRES (dans post.js du rendu) : une scene peut donc encore tout passer en noir et blanc.
// Pas d'allocation par pixel ; reductions et flous travaillent sur des tampons Float32 partages.

const borne = (x, a, b) => (x < a ? a : x > b ? b : x);
const lisse = (a, b, x) => { const t = borne((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const LUT_N = 4096, LUT_ECHELLE = 1024;   // la table couvre 0..4 (apres exposition)

// ------------------------------------------------------------------ tampons
export function tailleBas(W, H, F) { return [Math.ceil(W / F), Math.ceil(H / F)]; }

export function creerTampons(W, H, F) {
  const [lw, lh] = tailleBas(W, H, F);
  const sab = (n) => new Float32Array(new SharedArrayBuffer(n * 4));
  const tp = { W, H, F, lw, lh, src: sab(lw * lh * 3), masque: sab(lw * lh), glow: sab(lw * lh * 3), rays: sab(lw * lh) };
  // tampons de travail du thread principal : non enumerables, donc jamais copies dans les messages aux workers
  Object.defineProperty(tp, 'tmp', { value: new Float32Array(lw * lh * 3) });
  Object.defineProperty(tp, 'tmp2', { value: new Float32Array(lw * lh * 3) });
  return tp;
}

// ------------------------------------------------------------------ tables de l'etalonnage (une fois par image, dans le thread principal)
// Courbes de tons. L'entree est une valeur d'ecran (apres exposition) ; on la passe en lumiere lineaire (x^2,2), on applique la courbe, puis on
// revient a l'ecran. 'filmique' (Hejl-Burgess) rend deja une valeur d'ecran. Pour les courbes 'lineaire' rien n'est change.
function courbe(x, type, blanc) {
  if (type === 'lineaire') return x;
  const l = Math.pow(x, 2.2);
  let y;
  switch (type) {
    case 'reinhard': y = (l * (1 + l / (blanc * blanc))) / (1 + l); break;
    case 'filmique': { const q = Math.max(0, l - 0.004); return (q * (6.2 * q + 0.5)) / (q * (6.2 * q + 1.7) + 0.06); }
    case 'aces': y = (l * (2.51 * l + 0.03)) / (l * (2.43 * l + 0.59) + 0.14); break;
    case 'uncharted': { const h = (v) => ((v * (0.15 * v + 0.05) + 0.004) / (v * (0.15 * v + 0.5) + 0.06)) - 0.02 / 0.3; y = h(2 * l) / h(2 * Math.max(1, blanc)); break; }
    default: return x;
  }
  return Math.pow(borne(y, 0, 1), 1 / 2.2);
}

// r : valeurs a l'heure (evaluerShader). Retourne les parametres (objets simples + tables) pour analyser/composer.
export function preparerPasses(r, actif, { sol = null, sunDir = null, cam = null, W, H, F, ssaa = 1, qualite = 'normale' } = {}) {
  const expo = r['tonalite.exposition'], temp = r['etalonnage.temperature'], tint = r['etalonnage.teinte'];
  const par = { F, ssaa };
  // ---- lueur et rayons
  const bI = r['lueur.intensite'], rI0 = r['rayons.intensite'];
  par.bloom = bI > 0 ? { i: bI, seuil: r['lueur.seuil'], rayon: r['lueur.rayon'], couleur: r['lueur.couleur'] } : null;
  let rI = rI0;
  if (sol && sunDir) rI *= lisse(0.0, 0.25, sunDir[1]);   // la lumiere des rayons suit la hauteur du soleil
  const nEch = qualite === 'basse' ? Math.max(4, r['rayons.echantillons'] >> 1) : qualite === 'haute' ? Math.min(48, Math.round(r['rayons.echantillons'] * 1.5)) : r['rayons.echantillons'];
  par.rayons = rI > 0.001 && sunDir ? { i: rI, n: nEch, decr: r['rayons.decroissance'], longueur: r['rayons.longueur'], couleur: r['rayons.couleur'] ?? sol ?? [1, 0.95, 0.8], sun: sunDir } : null;
  // ---- table par canal : exposition -> courbe -> gamma -> contraste
  const mul = [expo * tint[0] * (1 + 0.14 * temp), expo * tint[1] * (1 + 0.02 * temp), expo * tint[2] * (1 - 0.14 * temp)];
  par.mul = mul;
  const type = r['tonalite.courbe'], blanc = r['tonalite.blancMax'], gam = 1 / r['tonalite.gamma'], ctr = r['etalonnage.contraste'];
  const lut = new Float32Array(LUT_N);
  for (let i = 0; i < LUT_N; i++) {
    let v = courbe(i / LUT_ECHELLE, type, blanc);
    v = borne(v, 0, 1);
    if (gam !== 1) v = Math.pow(v, gam);
    if (ctr !== 1) v = borne((v - 0.5) * ctr + 0.5, 0, 1);
    lut[i] = v;
  }
  par.lut = lut;
  // table par canal : entree 0..1023 (octet de l'image + lueur, 1023 = 4,0), sortie octet ; l'exposition et la teinte y sont deja
  par.lutC = new Uint8Array(3 * 1024);
  for (let c = 0; c < 3; c++) for (let v = 0; v < 1024; v++) { let i = Math.round((v / 255) * mul[c] * LUT_ECHELLE); i = i > LUT_N - 1 ? LUT_N - 1 : i; par.lutC[c * 1024 + v] = Math.round(lut[i] * 255); }
  // ---- etalonnage croise (saturation, vibrance, teintes des ombres / hautes lumieres, desaturation des ombres)
  const sat = r['etalonnage.saturation'], vib = r['etalonnage.vibrance'], tS = r['etalonnage.teinteOmbres'], tH = r['etalonnage.teinteHautesLumieres'], dd = r['etalonnage.desaturationSombre'];
  const croise = sat !== 1 || vib !== 1 || dd > 0 || tS.some((x) => x !== 1) || tH.some((x) => x !== 1);
  if (croise) {   // tout en entiers (8.8 : 256 = 1,0)
    const satI = new Int16Array(256), tinI = new Int16Array(768), vibT = new Int16Array(256);
    for (let i = 0; i < 256; i++) {
      const L = i / 255;
      satI[i] = Math.round(256 * sat * (1 - dd * (1 - lisse(0, 0.25, L))));
      const a = 1 - lisse(0, 0.5, L), b = lisse(0.5, 1, L);
      for (let c = 0; c < 3; c++) tinI[i * 3 + c] = Math.round(256 * (1 + (tS[c] - 1) * a + (tH[c] - 1) * b));
      vibT[i] = Math.round(256 * (1 + (vib - 1) * (1 - i / 255)));   // i = ecart max - min
    }
    par.croise = { satI, tinI, vibT, vibOn: vib !== 1 };
  } else par.croise = null;
  par.vig = r['ecran.vignette'] > 0 ? r['ecran.vignette'] : 0;
  par.vigT = new Uint16Array(512);
  if (par.vig > 0) for (let i = 0; i < 512; i++) { const q = i / 255 - 0.12; const t = q <= 0 ? 0 : q > 0.88 ? 1 : q / 0.88; par.vigT[i] = Math.round(256 * (1 - par.vig * t * t)); }
  par.respecter = r['acteurs.respecterExemptions'] !== false;
  par.cam = cam;   // base de la camera + f (pour le masque de ciel)
  par.W = W; par.H = H;
  void actif;
  return par;
}

// ------------------------------------------------------------------ A : reduction par bandes
// pixels (Uint32 ABGR), zb (profondeur 1/w, 0 = rien dessine = ciel) de la ligne du rasteriseur.
export function analyser(pixels, zb, W, H, tp, par, rangeeDe, nW) {
  const { F, lw, lh, src, masque } = tp;
  const bloom = par.bloom, ray = par.rayons;
  if (!bloom && !ray) return;
  const seuil = bloom ? bloom.seuil : 1, ik = 1 / (1 - seuil + 1e-3), inv = 1 / (F * F * 255);
  const cam = par.cam;
  const st = F >= 4 ? 2 : 1;   // un pixel sur deux dans chaque sens quand le bloc est grand (ce sont des moyennes floues : l'ecart est invisible)
  let fx = 0, fy = 0, fz = 0, rx = 0, rz = 0, ux = 0, uy = 0, uz = 0, f = 1, sx = 0, sy = 0, sz = 0;
  if (ray) { ({ fx, fy, fz, rx, rz, ux, uy, uz, f } = cam); [sx, sy, sz] = ray.sun; }
  for (let ly = 0; ly < lh; ly++) {
    const yA = ly * F;
    if (((yA >> 4) % nW) !== rangeeDe) continue;
    const yB = Math.min(H, yA + F);
    const b = (H / 2 - (yA + F / 2)) / f;
    for (let lx = 0; lx < lw; lx++) {
      const xA = lx * F, xB = Math.min(W, xA + F);
      let sr = 0, sg = 0, sb = 0, ciel = 0, n = 0;
      for (let y = yA; y < yB; y += st) {
        const o = y * W;
        for (let x = xA; x < xB; x += st) {
          const p = pixels[o + x];
          sr += p & 255; sg += (p >> 8) & 255; sb += (p >> 16) & 255;
          if (zb[o + x] === 0) ciel++;
          n++;
        }
      }
      const k = lw * ly + lx;
      if (bloom) {
        const m = 1 / (n * 255), r = sr * m, g = sg * m, bl = sb * m;
        const L = 0.3 * r + 0.59 * g + 0.11 * bl;
        let q = (L - seuil) * ik; q = q < 0 ? 0 : q > 1 ? 1 : q;
        src[k * 3] = r * q; src[k * 3 + 1] = g * q; src[k * 3 + 2] = bl * q;
      }
      if (ray) {
        let gl = 0;
        if (ciel > 0) {
          const a = (xA + F / 2 - W / 2) / f;
          let dx = fx + a * rx + b * ux, dy = fy + b * uy, dz = fz + a * rz + b * uz;
          const il = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
          let d = (dx * sx + dy * sy + dz * sz) * il;
          if (d > 0) { d *= d; d *= d; const d8 = d * d; gl = d8 * d8 * d8 * (ciel / n); }
        }
        masque[k] = gl;
      }
    }
  }
  void inv;
}

// ------------------------------------------------------------------ B : flou de la lueur, flou radial des rayons -> glow
function flouBoite(src, dst, w, h, r, passeH) {
  const ch = 3, inv = 1 / (2 * r + 1);
  if (passeH) {
    for (let y = 0; y < h; y++) {
      const base = y * w * ch;
      for (let c = 0; c < ch; c++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += src[base + (k < 0 ? 0 : k >= w ? w - 1 : k) * ch + c];
        for (let x = 0; x < w; x++) {
          dst[base + x * ch + c] = s * inv;
          const a = x + r + 1, b = x - r;
          s += src[base + (a >= w ? w - 1 : a) * ch + c] - src[base + (b < 0 ? 0 : b) * ch + c];
        }
      }
    }
  } else {
    const pas = w * ch;
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < ch; c++) {
        const base = x * ch + c;
        let s = 0;
        for (let k = -r; k <= r; k++) s += src[base + (k < 0 ? 0 : k >= h ? h - 1 : k) * pas];
        for (let y = 0; y < h; y++) {
          dst[base + y * pas] = s * inv;
          const a = y + r + 1, b = y - r;
          s += src[base + (a >= h ? h - 1 : a) * pas] - src[base + (b < 0 ? 0 : b) * pas];
        }
      }
    }
  }
}

export function calculerBloom(tp, par) {
  const { lw, lh, F, src, glow, tmp, tmp2 } = tp;
  const bloom = par.bloom;
  if (!bloom) return;
  const r = Math.max(1, Math.round((bloom.rayon * (par.H / par.ssaa / 1080)) / (F / par.ssaa) * 0.6));
  flouBoite(src, tmp, lw, lh, r, true); flouBoite(tmp, tmp2, lw, lh, r, false);
  flouBoite(tmp2, tmp, lw, lh, r, true); flouBoite(tmp, tmp2, lw, lh, r, false);
  const [cr, cg, cb] = bloom.couleur, k = bloom.i * 1.6, n = lw * lh;
  for (let i = 0; i < n; i++) { glow[i * 3] = tmp2[i * 3] * cr * k; glow[i * 3 + 1] = tmp2[i * 3 + 1] * cg * k; glow[i * 3 + 2] = tmp2[i * 3 + 2] * cb * k; }
}

// Rayons : flou radial du masque vers le soleil, pour les rangees basses (ly % nW === rangeeDe) ; le resultat (lumiere deja multipliee
// par l'intensite) va dans tp.rays.
export function calculerRayons(tp, par, rangeeDe, nW) {
  const { lw, lh, F, masque, rays } = tp;
  const ray = par.rayons;
  if (!ray) return;
  const B = par.cam, [sx, sy, sz] = ray.sun;
  const zv = sx * B.fx + sy * B.fy + sz * B.fz;
  if (zv <= 0.02) { for (let y = rangeeDe; y < lh; y += nW) rays.fill(0, y * lw, y * lw + lw); return; }
  const xv = sx * B.rx + sy * B.ry + sz * B.rz, yv = sx * B.ux + sy * B.uy + sz * B.uz;
  const Sx = (par.W / 2 + (xv * B.f) / zv) / F, Sy = (par.H / 2 - (yv * B.f) / zv) / F;
  const N = ray.n, decr = ray.decr, diag = Math.hypot(lw, lh) * ray.longueur;
  const kk = ((ray.i * 1.3 * 2.2) / N) * lisse(0.02, 0.35, zv);
  for (let y = rangeeDe; y < lh; y += nW) {
    for (let x = 0; x < lw; x++) {
      let dx = Sx - (x + 0.5), dy = Sy - (y + 0.5);
      const dist = Math.hypot(dx, dy);
      let s = 0;
      if (dist > 1e-3) {
        const len = Math.min(dist * ray.longueur, diag), step = len / N / dist;
        dx *= step; dy *= step;
        const jit = (((x * 73856093) ^ (y * 19349663)) & 255) / 256;
        let px = x + 0.5 + dx * jit, py = y + 0.5 + dy * jit, w = 1;
        for (let i = 0; i < N; i++) {
          px += dx; py += dy;
          if (px < 0 || py < 0 || px >= lw || py >= lh) break;
          s += masque[(py | 0) * lw + (px | 0)] * w;
          w *= decr;
        }
      }
      rays[y * lw + x] = s * kk;
    }
  }
}

// ------------------------------------------------------------------ C : composition finale par bandes (workers ou thread principal)
// pixels : image rendue (Uint32 ABGR, W x H) ; tp : tampons (glow, rays) ; force : tampon d'exemption ou null
export function composer(pixels, W, H, tp, par, force, rangeeDe, nW) {
  const F = tp.F / (par.ssaa || 1), { lw, lh, glow, rays } = tp;
  const lut = par.lutC, cr = par.croise, vig = par.vig > 0;
  const glowOn = !!par.bloom, raysOn = !!par.rayons;
  const ex = par.respecter && force ? force : null;
  const simple = !glowOn && !raysOn && cr === null && !vig;
  // vignette : indice = terme de colonne + terme de rangee (0 au centre, 255 au coin), en entiers
  let colI = null, vigT = null;
  if (vig) { vigT = par.vigT; colI = new Int16Array(W); const c = W / 2; for (let x = 0; x < W; x++) { const d = (x + 0.5 - c) / c; colI[x] = Math.round(d * d * 0.5 * 255); } }
  // interpolation bilinear de l'image reduite : colonnes (une fois), rangees (mises en cache, deja etalees sur toute la largeur)
  let cx0 = null, cx1 = null, cfx = null, gA = null, gB = null, rA = null, rB = null, jA = -1, jB = -1;
  if (glowOn || raysOn) {
    cx0 = new Int32Array(W); cx1 = new Int32Array(W); cfx = new Float32Array(W);
    for (let x = 0; x < W; x++) { let u = (x + 0.5) / F - 0.5; if (u < 0) u = 0; let i = Math.floor(u); if (i > lw - 1) i = lw - 1; cx0[x] = i; cx1[x] = Math.min(lw - 1, i + 1); cfx[x] = Math.min(1, u - i); }
    if (glowOn) { gA = new Int16Array(W * 3); gB = new Int16Array(W * 3); }
    if (raysOn) { rA = new Int16Array(W); rB = new Int16Array(W); }
  }
  const upRow = (j, g3, r1) => {
    if (g3) { const base = j * lw * 3; for (let x = 0; x < W; x++) { const a = base + cx0[x] * 3, b = base + cx1[x] * 3, t = cfx[x]; for (let c = 0; c < 3; c++) g3[x * 3 + c] = (glow[a + c] + (glow[b + c] - glow[a + c]) * t) * 255; } }
    if (r1) { const base = j * lw; for (let x = 0; x < W; x++) { const a = rays[base + cx0[x]], b = rays[base + cx1[x]]; r1[x] = (a + (b - a) * cfx[x]) * 255; } }
  };
  const [rc0, rc1, rc2] = raysOn ? par.rayons.couleur.map((v) => Math.round(v * 256)) : [0, 0, 0];
  const satI = cr ? cr.satI : null, tinI = cr ? cr.tinI : null, vibT = cr ? cr.vibT : null, vibOn = cr ? cr.vibOn : false;
  for (let y = 0; y < H; y++) {
    if (((y >> 4) % nW) !== rangeeDe) continue;
    let rowI = 0;
    if (vig) { const c = H / 2, d = (y + 0.5 - c) / c; rowI = Math.round(d * d * 0.5 * 255); }
    let fy = 0, fy8 = 0;
    if (glowOn || raysOn) {
      let v = (y + 0.5) / F - 0.5; if (v < 0) v = 0; let j = Math.floor(v); if (j > lh - 1) j = lh - 1;
      const j1 = Math.min(lh - 1, j + 1);
      fy = Math.min(1, v - j); fy8 = (fy * 256) | 0;
      if (j !== jA || j1 !== jB) {
        if (j === jB && j !== j1) { const t3 = gA; gA = gB; gB = t3; const t1 = rA; rA = rB; rB = t1; upRow(j1, gB, rB); } else { upRow(j, gA, rA); upRow(j1, gB, rB); }
        jA = j; jB = j1;
      }
    }
    const o0 = y * W;
    for (let x = 0; x < W; x++) {
      const o = o0 + x, p = pixels[o];
      let r = p & 255, g = (p >> 8) & 255, b = (p >> 16) & 255;
      if (!simple) {
        if (glowOn) { const x3 = x * 3; r += gA[x3] + (((gB[x3] - gA[x3]) * fy8) >> 8); g += gA[x3 + 1] + (((gB[x3 + 1] - gA[x3 + 1]) * fy8) >> 8); b += gA[x3 + 2] + (((gB[x3 + 2] - gA[x3 + 2]) * fy8) >> 8); }
        if (raysOn) { const q = rA[x] + (((rB[x] - rA[x]) * fy8) >> 8); r += (q * rc0) >> 8; g += (q * rc1) >> 8; b += (q * rc2) >> 8; }
        if (r > 1023) r = 1023; if (g > 1023) g = 1023; if (b > 1023) b = 1023;
      }
      let R = lut[r], G = lut[1024 + g], B = lut[2048 + b];
      if (cr !== null) {
        const L = (77 * R + 150 * G + 29 * B) >> 8;
        let s = satI[L];
        if (vibOn) { const mx = R > G ? (R > B ? R : B) : (G > B ? G : B), mn = R < G ? (R < B ? R : B) : (G < B ? G : B); s = (s * vibT[mx - mn]) >> 8; }
        const t3 = L * 3;
        R = ((L + (((R - L) * s) >> 8)) * tinI[t3]) >> 8; G = ((L + (((G - L) * s) >> 8)) * tinI[t3 + 1]) >> 8; B = ((L + (((B - L) * s) >> 8)) * tinI[t3 + 2]) >> 8;
        R = R < 0 ? 0 : R > 255 ? 255 : R; G = G < 0 ? 0 : G > 255 ? 255 : G; B = B < 0 ? 0 : B > 255 ? 255 : B;
      }
      if (vig) { const ix = colI[x] + rowI; if (ix > 28) { const m = vigT[ix]; R = (R * m) >> 8; G = (G * m) >> 8; B = (B * m) >> 8; } }
      if (ex !== null) {
        const fo = ex[o];
        if (fo !== 0) { R += ((((p & 255) - R) * fo) / 255) | 0; G += (((((p >> 8) & 255) - G) * fo) / 255) | 0; B += (((((p >> 16) & 255) - B) * fo) / 255) | 0; }
      }
      pixels[o] = (0xff000000 | (B << 16) | (G << 8) | R) >>> 0;
    }
  }
}
