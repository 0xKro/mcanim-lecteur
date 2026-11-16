// Ombres du soleil CUITES : une marche de rayon dans la grille de blocs de la zone, de chaque coin de face vers le soleil.
// Le resultat (un octet par sommet : 255 = plein soleil, 0 = ombre) est range dans un tableau partage ; le rasteriseur le lit
// a chaque image (voir raster.js, "sv"). Les feuilles, le verre et l'eau n'arretent qu'une partie de la lumiere : un rayon qui
// traverse une epaisseur de feuillage perd (1 - opacite)^longueur, ce qui donne des ombres douces et tachetees sous les arbres.
// Les acteurs recoivent l'ombre (meme marche, par sommet) et en projettent une (un ecran flou pose sur le sol).

const borne = (x, a, b) => (x < a ? a : x > b ? b : x);
const VERRE = /(glass|^ice$|^packed_ice$|^blue_ice$)/;

// Grille d'absorption : un logarithme de transmission par entree de palette (0 = laisse tout passer, -Infinity = bloque).
export function construireGrille(rs, { feuillage = 1, verre = 0.25, eau = 0.2 } = {}) {
  const { pal, PX, PY, PZ, etats } = rs.maillage.interne;
  const NP = etats.length;
  const lg = new Float32Array(NP);
  for (let i = 0; i < NP; i++) {
    let a = 0;
    const e = etats[i];
    if (i === 1) a = 1;
    else if (e) {
      if (e.feuilles) a = feuillage;
      else if (e.opaque) a = 1;
      else if (e.eau) a = eau;
      else if (e.type === 1 && VERRE.test(e.nom)) a = verre;
      else if (rs.collision[i]) a = 0.85;   // dalles, escaliers, clotures... : ombre forte mais pas totale
    }
    lg[i] = a >= 0.999 ? -Infinity : a <= 0 ? 0 : Math.log(1 - a);
  }
  // hauteur (couche paddee) au-dessus de laquelle plus rien n'arrete la lumiere
  let haut = 0;
  const couche = PX * PZ;
  for (let y = 0; y < PY; y++) {
    let trouve = false;
    for (let i = y * couche, fin = i + couche; i < fin; i++) if (lg[pal[i]] !== 0) { trouve = true; break; }
    if (trouve) haut = y;
  }
  return { pal, lg, PX, PY, PZ, x0: rs.zone.x0, y0: rs.zone.y0, z0: rs.zone.z0, haut: haut + 1 };
}

// Transmission de la lumiere (0..1) du point (x,y,z) monde vers la direction (dx,dy,dz) UNITAIRE (dy > 0).
export function transmission(g, x, y, z, dx, dy, dz) {
  const { pal, lg, PX, PY, PZ } = g;
  const px = x - g.x0 + 1, py = y - g.y0 + 1, pz = z - g.z0 + 1;
  let ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  if (ix < 0 || iz < 0 || ix >= PX || iz >= PZ || iy < 0) return 1;
  if (iy >= g.haut) return 1;
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = Math.abs(1 / dy), tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tx = dx > 0 ? (ix + 1 - px) * tdx : dx < 0 ? (px - ix) * tdx : Infinity;
  let ty = (iy + 1 - py) * tdy;
  let tz = dz > 0 ? (iz + 1 - pz) * tdz : dz < 0 ? (pz - iz) * tdz : Infinity;
  const OY = PX * PZ;
  let idx = iy * OY + iz * PX + ix;
  let T = 1, t0 = 0;
  for (;;) {
    const l = lg[pal[idx]];
    const t1 = tx < ty ? (tx < tz ? tx : tz) : (ty < tz ? ty : tz);
    if (l !== 0) {
      if (l === -Infinity) { if (t1 - t0 > 0.04) return 0; } else T *= Math.exp(l * (t1 - t0));
      if (T < 0.01) return 0;
    }
    t0 = t1;
    if (tx < ty && tx < tz) { ix += sx; if (ix < 0 || ix >= PX) return T; idx += sx; tx += tdx; }
    else if (ty < tz) { iy++; if (iy >= g.haut) return T; idx += OY; ty += tdy; }
    else { iz += sz; if (iz < 0 || iz >= PZ) return T; idx += sz * PX; tz += tdz; }
  }
}

const lisse = (a, b, x) => { const t = borne((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Cuit les ombres de tous les dessins statiques pour la direction `dir`. `sorties` : un Uint8Array partage par dessin (ou null : cree).
// distance : blocs autour du CENTRE de la zone ; cuisson : 0 un echantillon par face, 1 un par coin, 2 un par coin + centre.
// Retourne { ms, echantillons }.
export function cuire(rs, g, dir, { distance = 128, cuisson = 1 } = {}) {
  const t0 = performance.now();
  const Z = rs.zone, cx = Z.x0 + Z.sx / 2, cz = Z.z0 + Z.sz / 2, D2 = distance * distance;
  const [lx, ly, lz] = dir;
  let nEch = 0;
  rs.draws.forEach((d, k) => {
    const n = d.positions.length / 12;
    if (!d.ombre) d.ombre = new Uint8Array(new SharedArrayBuffer(Math.max(1, n * 4)));
    const out = d.ombre, pos = d.positions, eti = d.etiq;
    const q = new Float32Array(4);
    for (let i = 0; i < n; i++) {
      const o = i * 12, b = i * 4;
      const mx = (pos[o] + pos[o + 3] + pos[o + 6] + pos[o + 9]) * 0.25, my = (pos[o + 1] + pos[o + 4] + pos[o + 7] + pos[o + 10]) * 0.25, mz = (pos[o + 2] + pos[o + 5] + pos[o + 8] + pos[o + 11]) * 0.25;
      const ddx = mx - cx, ddz = mz - cz;
      if (ddx * ddx + ddz * ddz > D2) { out[b] = out[b + 1] = out[b + 2] = out[b + 3] = 255; continue; }
      // normale de la face
      const ax = pos[o + 3] - pos[o], ay = pos[o + 4] - pos[o + 1], az = pos[o + 5] - pos[o + 2];
      const bx = pos[o + 6] - pos[o], by = pos[o + 7] - pos[o + 1], bz = pos[o + 8] - pos[o + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz);
      let facteur = 1;
      const plante = (eti[b] & 7) === 3;
      if (nl > 1e-6 && !plante) {
        nx /= nl; ny /= nl; nz /= nl;
        facteur = lisse(-0.15, 0.4, nx * lx + ny * ly + nz * lz);
      } else { nx = 0; ny = 0; nz = 0; }
      if (facteur <= 0.001) { out[b] = out[b + 1] = out[b + 2] = out[b + 3] = 0; continue; }
      const echant = (x, y, z) => { nEch++; return transmission(g, x + nx * 0.03 + lx * 0.02, y + ny * 0.03 + ly * 0.02, z + nz * 0.03 + lz * 0.02, lx, ly, lz); };
      if (cuisson === 0) {
        const v = echant(mx, my, mz) * facteur * 255 + 0.5;
        out[b] = out[b + 1] = out[b + 2] = out[b + 3] = v;
        continue;
      }
      for (let c = 0; c < 4; c++) {
        const px = mx + (pos[o + c * 3] - mx) * 0.7, py = my + (pos[o + c * 3 + 1] - my) * 0.7, pz = mz + (pos[o + c * 3 + 2] - mz) * 0.7;
        q[c] = echant(px, py, pz);
      }
      if (cuisson >= 2) { const m = echant(mx, my, mz); for (let c = 0; c < 4; c++) q[c] = (q[c] * 2 + m) / 3; }
      for (let c = 0; c < 4; c++) out[b + c] = q[c] * facteur * 255 + 0.5;
    }
    void k;
  });
  return { ms: performance.now() - t0, echantillons: nEch };
}

// Lumiere par sommet pour un maillage dynamique : tableau de transmissions 0..1 (une par sommet).
export function ombreSommets(g, positions, dir) {
  const n = positions.length / 3, r = new Float32Array(n);
  const [lx, ly, lz] = dir;
  for (let i = 0; i < n; i++) r[i] = transmission(g, positions[i * 3] + lx * 0.12, positions[i * 3 + 1] + ly * 0.12, positions[i * 3 + 2] + lz * 0.12, lx, ly, lz);
  return r;
}

// Ombre portee d'un acteur : un ecran (maillage "melange" noir, alpha doux) pose sur le sol, selon la direction de la lumiere.
// mesh : maillage dynamique (positions, indices, mode) ; retourne un maillage a ajouter, ou null.
// La silhouette est la projection des triangles sur le plan des pieds, floutee ; chaque case du sol suit la hauteur du terrain
// (solEn) et son opacite est reduite quand le sol est deja a l'ombre des arbres.
const TEXELS = 10;   // texels par bloc
export function ombreProjetee(rs, g, mesh, dir, opacite) {
  if (mesh.mode === 'melange' || !mesh.indices.length) return null;
  const P = mesh.positions, nv = P.length / 3;
  let ymin = Infinity, mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity, ymax = -Infinity;
  for (let i = 0; i < nv; i++) { const y = P[i * 3 + 1]; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  let [lx, ly, lz] = dir;
  const ky = Math.max(ly, 0.3), sc = 1 / ky;   // lumiere trop rasante : ombre plafonnee (longueur 3,3 fois la hauteur)
  void lx; void lz;
  const qx = new Float32Array(nv), qz = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    const h = P[i * 3 + 1] - ymin;
    qx[i] = P[i * 3] - lx * h * sc; qz[i] = P[i * 3 + 2] - lz * h * sc;
    if (qx[i] < mnx) mnx = qx[i]; if (qx[i] > mxx) mxx = qx[i]; if (qz[i] < mnz) mnz = qz[i]; if (qz[i] > mxz) mxz = qz[i];
  }
  const x0 = Math.floor(mnx - 0.6), z0 = Math.floor(mnz - 0.6), x1 = Math.ceil(mxx + 0.6), z1 = Math.ceil(mxz + 0.6);
  const bw = x1 - x0, bh = z1 - z0;
  if (bw > 24 || bh > 24 || bw < 1 || bh < 1) return null;
  const TW = bw * TEXELS, TH = bh * TEXELS;
  const cov = new Float32Array(TW * TH);
  const I = mesh.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ax = (qx[a] - x0) * TEXELS, az = (qz[a] - z0) * TEXELS, bx = (qx[b] - x0) * TEXELS, bz = (qz[b] - z0) * TEXELS, cx = (qx[c] - x0) * TEXELS, cz = (qz[c] - z0) * TEXELS;
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-6) continue;
    const ya = Math.max(0, Math.floor(Math.min(az, bz, cz))), yb = Math.min(TH - 1, Math.ceil(Math.max(az, bz, cz)));
    const xa = Math.max(0, Math.floor(Math.min(ax, bx, cx))), xb = Math.min(TW - 1, Math.ceil(Math.max(ax, bx, cx)));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const px = x + 0.5, pz = y + 0.5;
      const w1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, w2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den, w3 = 1 - w1 - w2;
      if (w1 >= -0.02 && w2 >= -0.02 && w3 >= -0.02) cov[y * TW + x] = 1;
    }
  }
  // flou en boite (deux passes de rayon 2 puis une de rayon 1) = bord doux
  const tmp = new Float32Array(TW * TH);
  const flou = (src, dst, r, horiz) => {
    const L = horiz ? TW : TH, M = horiz ? TH : TW, pas = horiz ? 1 : TW, ligne = horiz ? TW : 1;
    for (let m = 0; m < M; m++) {
      const base = m * ligne;
      let s = 0;
      for (let k = -r; k <= r; k++) if (k >= 0 && k < L) s += src[base + k * pas];
      for (let k = 0; k < L; k++) {
        dst[base + k * pas] = s / (2 * r + 1);
        const add = k + r + 1, sub = k - r;
        if (add < L) s += src[base + add * pas];
        if (sub >= 0) s -= src[base + sub * pas];
      }
    }
  };
  flou(cov, tmp, 2, true); flou(tmp, cov, 2, false); flou(cov, tmp, 1, true); flou(tmp, cov, 1, false);
  // cases du sol
  const pos = [], uv = [], ind = [];
  const alpha = new Uint8Array(TW * TH * 4);
  let visCases = new Map();
  for (let zz = z0; zz < z1; zz++) for (let xx = x0; xx < x1; xx++) {
    const sol = rs.solEn(xx, zz);
    if (sol === null || rs.eauEn(xx, zz) !== null) continue;
    let somme = 0;
    for (let j = 0; j < TEXELS; j++) for (let i = 0; i < TEXELS; i++) somme += cov[((zz - z0) * TEXELS + j) * TW + (xx - x0) * TEXELS + i];
    if (somme < 0.5) continue;
    const vis = transmission(g, xx + 0.5, sol + 0.05, zz + 0.5, dir[0], dir[1], dir[2]);
    visCases.set((zz - z0) * bw + (xx - x0), vis);
    const y = sol + 0.025, nbase = pos.length / 3;
    pos.push(xx, y, zz, xx, y, zz + 1, xx + 1, y, zz + 1, xx + 1, y, zz);
    for (const [px, pz] of [[0, 0], [0, 1], [1, 1], [1, 0]]) uv.push((xx - x0 + px) / bw, (zz - z0 + pz) / bh);
    ind.push(nbase, nbase + 1, nbase + 2, nbase, nbase + 2, nbase + 3);
  }
  if (!ind.length) return null;
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const v = visCases.get(Math.floor(y / TEXELS) * bw + Math.floor(x / TEXELS));
    const a = v === undefined ? 0 : cov[y * TW + x] * opacite * (0.15 + 0.85 * v);
    alpha[(y * TW + x) * 4 + 3] = Math.round(borne(a, 0, 1) * 255);
  }
  const nvm = pos.length / 3;
  return { positions: Float32Array.from(pos), uvs: Float32Array.from(uv), couleurs: new Float32Array(nvm * 3).fill(1), indices: Uint32Array.from(ind), texture: { largeur: TW, hauteur: TH, rgba: alpha }, mode: 'melange', deuxFaces: false, ombre: true };
}
