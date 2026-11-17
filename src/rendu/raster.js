// Rasteriseur logiciel (CPU). Coeur utilise par le thread principal ET par les workers.
// Convention de camera (comme le jeu) : lacet 0 = regarde vers le sud (+z), 90 = ouest (-x) ;
// tangage positif = regarde vers le bas. Coordonnees monde : x est, y haut, z sud.
//
// Dessin : pour chaque "draw" = { positions, uvs, couleurs(Uint32 ABGR), indices, sections, tex, mode, deuxFaces }.
//   mode 0 opaque, 1 decoupe (test alpha), 2 melange (alpha, trie de l'arriere vers l'avant, sans ecriture de profondeur)
// Pixels : Uint32 ABGR (octets R,G,B,A en memoire).

export const MODE_OPAQUE = 0, MODE_DECOUPE = 1, MODE_MELANGE = 2;

// Sommets en espace camera. On les calcule a la demande (tampon d'estampille) et par section.
export class Rasteriseur {
  constructor() {
    this.cap = 0;
    this.stamp = 0;
    this.ensure(4096);
    this.zbuf = null; this.zW = 0; this.zH = 0;
    this.stats = { tris: 0, trisVus: 0, pixels: 0, sections: 0, ms: 0 };
  }

  ensure(n) {
    if (n <= this.cap) return;
    const c = Math.max(n, this.cap * 2) + 8; // +8 : sommets de decoupe au plan proche
    this.cap = c;
    this.SX = new Float32Array(c); this.SY = new Float32Array(c); this.IW = new Float32Array(c);
    this.UW = new Float32Array(c); this.VW = new Float32Array(c);
    this.U = new Float32Array(c); this.V = new Float32Array(c);
    this.R = new Float32Array(c); this.G = new Float32Array(c); this.B = new Float32Array(c);
    this.XV = new Float32Array(c); this.YV = new Float32Array(c); this.ZV = new Float32Array(c);
    this.ST = new Uint32Array(c);
    this.stamp = 0;
  }

  // ---- ciel : degrade vertical ----
  ciel(pixels, W, H, cam, rangeeDe, nW, p) {
    if (p.vanille) { this._cielVanille(pixels, W, H, cam, rangeeDe, nW, p.vanille); return; }
    const f = (H / 2) / Math.tan((cam.fov * Math.PI) / 360);
    const pitch = (cam.tangage * Math.PI) / 180;
    const [zr, zg, zb] = p.cielZenith, [hr, hg, hb] = p.cielHorizon;
    const sol = p.cielBas;
    if (this.skyH !== H) { this.skyR = new Float32Array(H); this.skyG = new Float32Array(H); this.skyB = new Float32Array(H); this.skyH = H; }
    for (let y = 0; y < H; y++) {
      // elevation du rayon passant par le centre de la rangee (en tenant compte du tangage)
      const elev = Math.atan((H / 2 - (y + 0.5)) / f) - pitch;
      let t = Math.sin(elev);
      let r, g, b;
      if (t >= 0) { t = Math.pow(t, 0.55); r = hr + (zr - hr) * t; g = hg + (zg - hg) * t; b = hb + (zb - hb) * t; }
      else { t = Math.min(1, -t * 3); r = hr + (sol[0] - hr) * t; g = hg + (sol[1] - hg) * t; b = hb + (sol[2] - hb) * t; }
      // couleur du ciel de cette rangee (entiere) : le brouillard totalement epais prend exactement cette couleur
      this.skyR[y] = r | 0; this.skyG[y] = g | 0; this.skyB[y] = b | 0;
      if (((y >> 4) % nW) !== rangeeDe) continue;
      const c = (255 << 24) | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
      pixels.fill(c >>> 0, y * W, y * W + W);
    }
    // disque de soleil (facultatif)
    if (p.soleil) this._soleil(pixels, W, H, cam, f, rangeeDe, nW, p.soleil);
  }

  // ---- ciel du jeu (voir ciel-vanille.js) : degrade ciel -> brume, lueur du lever/coucher, etoiles, soleil et lune (textures), halos.
  // v = { sky, fog, bas|null, fin (blocs), sunrise: { rgb, a, sgn }|null, etoiles, astres: [...] } ; couleurs 0..255.
  _cielVanille(pixels, W, H, cam, rangeeDe, nW, v) {
    const f = (H / 2) / Math.tan((cam.fov * Math.PI) / 360);
    const pitch = (cam.tangage * Math.PI) / 180;
    const B = this.base(cam);
    if (this.skyH !== H) { this.skyR = new Float32Array(H); this.skyG = new Float32Array(H); this.skyB = new Float32Array(H); this.skyH = H; }
    const sky = v.sky, fog = v.fog, bas = v.bas || fog, fin = v.fin;
    const fan = v.sunrise && v.sunrise.a > 0.001 ? v.sunrise : null;
    for (let y = 0; y < H; y++) {
      const b = (H / 2 - (y + 0.5)) / f;
      const elev = Math.atan(b) - pitch;
      const dy = Math.sin(elev);
      let r, g, bl;
      if (dy <= 0) { r = bas[0]; g = bas[1]; bl = bas[2]; }
      else { const k = Math.min(1, 16 / dy / fin); r = sky[0] + (fog[0] - sky[0]) * k; g = sky[1] + (fog[1] - sky[1]) * k; bl = sky[2] + (fog[2] - sky[2]) * k; }
      // couleur de brume de cette rangee (entiere, sans la lueur) : la brume epaisse prend exactement cette couleur
      this.skyR[y] = r | 0; this.skyG[y] = g | 0; this.skyB[y] = bl | 0;
      if (((y >> 4) % nW) !== rangeeDe) continue;
      const c0 = ((255 << 24) | ((bl | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
      if (fan === null || dy <= 0 || dy > 0.3) { pixels.fill(c0, y * W, y * W + W); continue; }
      // rangee proche de l'horizon, lueur du lever/coucher : poids de l'eventail a chaque pixel
      for (let x = 0; x < W; x++) {
        const a = (x + 0.5 - W / 2) / f;
        const dx = B.fx + a * B.rx + b * B.ux, ddy = B.fy + b * B.uy, dz = B.fz + a * B.rz + b * B.uz;
        const w = this._eventail(dx, ddy, dz, fan);
        if (w <= 0) { pixels[y * W + x] = c0; continue; }
        const k = w * fan.a;
        pixels[y * W + x] = (0xff000000 | (((bl + (fan.rgb[2] - bl) * k) | 0) << 16) | (((g + (fan.rgb[1] - g) * k) | 0) << 8) | ((r + (fan.rgb[0] - r) * k) | 0)) >>> 0;
      }
    }
    if (v.etoiles) this._etoiles(pixels, W, H, f, B, rangeeDe, nW, v.etoiles);
    for (const a of v.astres) this._corps(pixels, W, H, f, B, rangeeDe, nW, a);
  }

  // Poids (0..1) de l'eventail de lueur (SkyRenderer.renderSunriseAndSunset) sur le rayon (dx, dy, dz), dy > 0 : une rangee de 16 triangles
  // dont le sommet est a l'horizon, du cote du soleil (x = -100 sgn), et dont le bord est un cercle de rayon 120 autour de la camera, penche
  // de 40 x alpha. La camera est sous la nappe : le rayon la croise a la distance horizontale lam (entre 60 et 125), trouvee par dichotomie.
  _eventail(dx, dy, dz, fan) {
    const dh = Math.sqrt(dx * dx + dz * dz);
    if (dh < 1e-9) return 0;
    const ux = dx / dh, uz = dz / dh, tanE = dy / dh;
    if (this._surface(125, ux, uz, tanE, fan) > 0) return 0;   // au-dessus du bord de la nappe : pas de lueur
    let lo = 60, hi = 125;
    for (let it = 0; it < 8; it++) { const m = (lo + hi) / 2; if (this._surface(m, ux, uz, tanE, fan) > 0) lo = m; else hi = m; }
    this._surface(hi, ux, uz, tanE, fan);
    return this.fw > 0 ? this.fw : 0;
  }

  // Ecart (hauteur du rayon - hauteur de la nappe) a la distance horizontale lam ; le poids du sommet du triangle va dans this.fw.
  _surface(lam, ux, uz, tanE, fan) {
    const Ax = -100 * fan.sgn, vx = lam * ux - Ax, vz = lam * uz, rho = Math.sqrt(vx * vx + vz * vz);
    let ys = 0; this.fw = 1;
    if (rho > 1e-6) {
      const nx = vx / rho, nz = vz / rho, bb = Ax * nx, t = -bb + Math.sqrt(Math.max(0, bb * bb - Ax * Ax + 14400));
      ys = 40 * fan.a * (-fan.sgn * (Ax + t * nx) / 120) * (rho / t); this.fw = 1 - rho / t;
    }
    return lam * tanE - ys;
  }

  // Etoiles : carres blancs de quelques pixels, ajoutes au ciel. e = { n, dirs (monde), tailles, lum, couleur }
  _etoiles(pixels, W, H, f, B, rangeeDe, nW, e) {
    const d = e.dirs, cr = e.couleur[0] * e.lum, cg = e.couleur[1] * e.lum, cb = e.couleur[2] * e.lum;
    for (let i = 0; i < e.n; i++) {
      const x = d[i * 3], y = d[i * 3 + 1], z = d[i * 3 + 2];
      if (y < -0.05) continue;
      const zv = x * B.fx + y * B.fy + z * B.fz;
      if (zv <= 0.05) continue;
      const sx = W / 2 + ((x * B.rx + y * B.ry + z * B.rz) * f) / zv, sy = H / 2 - ((x * B.ux + y * B.uy + z * B.uz) * f) / zv;
      const half = Math.max(0.5, (e.tailles[i] / 100) * f / zv);
      const x0 = Math.floor(sx - half), x1 = Math.floor(sx + half), y0 = Math.floor(sy - half), y1 = Math.floor(sy + half);
      for (let py = y0; py <= y1; py++) {
        if (py < 0 || py >= H || ((py >> 4) % nW) !== rangeeDe) continue;
        const cy = Math.min(py + 1, sy + half) - Math.max(py, sy - half);
        if (cy <= 0) continue;
        for (let px = x0; px <= x1; px++) {
          if (px < 0 || px >= W) continue;
          const cx = Math.min(px + 1, sx + half) - Math.max(px, sx - half);
          if (cx <= 0) continue;
          const k = cx * cy, o = py * W + px, q = pixels[o];
          const r = Math.min(255, (q & 255) + cr * k), g = Math.min(255, ((q >> 8) & 255) + cg * k), b = Math.min(255, ((q >> 16) & 255) + cb * k);
          pixels[o] = (0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
        }
      }
    }
  }

  // Soleil ou lune : carre texture de demi-cote taille a 100 blocs (additif), ou disque rond, avec un halo facultatif.
  // a = { n, ex, ez (repere du carre), taille, lune, tex: {w,h,data}|null, mult (0..1 par canal), rond, rayonRond, couleur (0..255), halo, haloRayon (degres) }
  _corps(pixels, W, H, f, B, rangeeDe, nW, a) {
    const { n, ex, ez, taille } = a;
    const zc = n[0] * B.fx + n[1] * B.fy + n[2] * B.fz;
    const halo = a.halo > 0;
    const Rh = halo ? Math.max(f * 0.05, f * ((a.haloRayon * Math.PI) / 180)) : 0;
    // boite d'ecran : projection des 4 coins ; si un coin est derriere la camera on balaie toute l'image
    let x0 = 0, x1 = W - 1, y0 = 0, y1 = H - 1;
    let tous = true, mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    const S = taille;
    for (const [px, pz] of [[-S, -S], [S, -S], [S, S], [-S, S]]) {
      const wx = n[0] * 100 + ex[0] * px + ez[0] * pz, wy = n[1] * 100 + ex[1] * px + ez[1] * pz, wz = n[2] * 100 + ex[2] * px + ez[2] * pz;
      const zv = wx * B.fx + wy * B.fy + wz * B.fz;
      if (zv <= 1) { tous = false; break; }
      const sx = W / 2 + ((wx * B.rx + wy * B.ry + wz * B.rz) * f) / zv, sy = H / 2 - ((wx * B.ux + wy * B.uy + wz * B.uz) * f) / zv;
      if (sx < mnx) mnx = sx; if (sx > mxx) mxx = sx; if (sy < mny) mny = sy; if (sy > mxy) mxy = sy;
    }
    if (tous) { x0 = Math.max(0, Math.floor(mnx)); x1 = Math.min(W - 1, Math.ceil(mxx)); y0 = Math.max(0, Math.floor(mny)); y1 = Math.min(H - 1, Math.ceil(mxy)); }
    else if (zc < -0.2 && !halo) return;
    const dxh = n[0] * B.rx + n[1] * B.ry + n[2] * B.rz, dyh = n[0] * B.ux + n[1] * B.uy + n[2] * B.uz;
    let cxs = 0, cys = 0;
    if (halo && zc > 0.02) { cxs = W / 2 + (dxh * f) / zc; cys = H / 2 - (dyh * f) / zc; const R = Rh; x0 = Math.min(x0, Math.max(0, Math.floor(cxs - R))); x1 = Math.max(x1, Math.min(W - 1, Math.ceil(cxs + R))); y0 = Math.min(y0, Math.max(0, Math.floor(cys - R))); y1 = Math.max(y1, Math.min(H - 1, Math.ceil(cys + R))); }
    const [mr, mg, mb] = a.mult, tex = a.tex, lune = a.lune, iR2 = halo ? 1 / (Rh * Rh) : 0;
    const Rr = a.rayonRond, hOn = halo && zc > 0.02;
    for (let y = y0; y <= y1; y++) {
      if (((y >> 4) % nW) !== rangeeDe) continue;
      const b = (H / 2 - (y + 0.5)) / f;
      for (let x = x0; x <= x1; x++) {
        const aa = (x + 0.5 - W / 2) / f;
        const dx = B.fx + aa * B.rx + b * B.ux, dy = B.fy + b * B.uy, dz = B.fz + aa * B.rz + b * B.uz;
        let ar = 0, ag = 0, ab = 0;
        const den = dx * n[0] + dy * n[1] + dz * n[2];
        if (den > 1e-6) {
          const lam = 100 / den;
          const lx = lam * (dx * ex[0] + dy * ex[1] + dz * ex[2]), lz = lam * (dx * ez[0] + dy * ez[1] + dz * ez[2]);
          if (a.rond) {
            const r = Math.sqrt(lx * lx + lz * lz), cov = Math.min(1, Math.max(0, (Rr - r) / (Rr * 0.03 + 1e-6) + 0.5));
            if (cov > 0) { ar = a.couleur[0] * cov; ag = a.couleur[1] * cov; ab = a.couleur[2] * cov; }
          } else if (tex !== null && lx >= -S && lx < S && lz >= -S && lz < S) {
            let u = (lx + S) / (2 * S), vv = (lz + S) / (2 * S);
            if (lune) { u = 1 - u; vv = 1 - vv; }
            const t = tex.data[Math.min(tex.h - 1, (vv * tex.h) | 0) * tex.w + Math.min(tex.w - 1, (u * tex.w) | 0)];
            const al = (t >>> 24) / 255;
            if (al > 0) { ar = (t & 255) * al * mr; ag = ((t >> 8) & 255) * al * mg; ab = ((t >> 16) & 255) * al * mb; }
          }
        }
        if (hOn) {
          const ddx = x + 0.5 - cxs, ddy = y + 0.5 - cys, u2 = (ddx * ddx + ddy * ddy) * iR2;
          if (u2 < 1) { const w = 1 - u2, k = a.halo * w * w * w * 0.7; ar += a.couleur[0] * k; ag += a.couleur[1] * k; ab += a.couleur[2] * k; }
        }
        if (ar <= 0 && ag <= 0 && ab <= 0) continue;
        const o = y * W + x, q = pixels[o];
        const r = Math.min(255, (q & 255) + ar), g = Math.min(255, ((q >> 8) & 255) + ag), bl = Math.min(255, ((q >> 16) & 255) + ab);
        pixels[o] = (0xff000000 | ((bl | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
      }
    }
  }

  _soleil(pixels, W, H, cam, f, rangeeDe, nW, dirSoleil) {
    const { rx, ry, rz, ux, uy, uz, fx, fy, fz } = this.base(cam);
    const [sx, sy, sz] = dirSoleil;
    const zv = sx * fx + sy * fy + sz * fz;
    if (zv <= 0.05) return;
    const xv = sx * rx + sy * ry + sz * rz, yv = sx * ux + sy * uy + sz * uz;
    const cx = W / 2 + (xv * f) / zv, cy = H / 2 - (yv * f) / zv;
    const rayon = f * 0.035; // un peu plus grand que dans le jeu pour etre visible
    const y0 = Math.max(0, Math.floor(cy - rayon)), y1 = Math.min(H - 1, Math.ceil(cy + rayon));
    for (let y = y0; y <= y1; y++) {
      if (((y >> 4) % nW) !== rangeeDe) continue;
      const dy = y + 0.5 - cy;
      const w = Math.sqrt(Math.max(0, rayon * rayon - dy * dy));
      const xa = Math.max(0, Math.ceil(cx - w)), xb = Math.min(W - 1, Math.floor(cx + w));
      for (let x = xa; x <= xb; x++) pixels[y * W + x] = 0xffd8f4ff;
    }
  }

  base(cam) {
    const yaw = (cam.lacet * Math.PI) / 180, pit = (cam.tangage * Math.PI) / 180;
    const cp = Math.cos(pit);
    const fx = -Math.sin(yaw) * cp, fy = -Math.sin(pit), fz = Math.cos(yaw) * cp;
    let rx = -fz, rz = fx; const n = Math.hypot(rx, rz) || 1; rx /= n; rz /= n;
    const ry = 0;
    // up = right x forward
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    return { fx, fy, fz, rx, ry, rz, ux, uy, uz };
  }

  // ---- une image : dessine uniquement les rangees (bloc de 16) dont (bloc % nW) === rangeeDe ----
  // scene : { draws: [...] }, dyn : draws dynamiques de cette image
  // `force` (facultatif) : Uint8Array W*H partage. Le rasteriseur y ecrit, pour chaque pixel dessine, la force d'exemption
  // (0 = pixel normal, 255 = exempte de l'etalonnage de `image`). Effacee a 0 sur mes rangees au debut de l'image.
  rendre({ pixels, W, H, cam, draws, rangeeDe = 0, nW = 1, params, force = null }) {
    const t0 = performance.now();
    if (!this.zbuf || this.zW !== W || this.zH !== H) { this.zbuf = new Float32Array(W * H); this.zW = W; this.zH = H; }
    const zb = this.zbuf;
    // effacement de la profondeur + ciel pour mes rangees
    for (let y = 0; y < H; y++) {
      if (((y >> 4) % nW) !== rangeeDe) continue;
      zb.fill(0, y * W, y * W + W);
      if (force) force.fill(0, y * W, y * W + W);
    }
    this.ciel(pixels, W, H, cam, rangeeDe, nW, params);
    const cadre = { pixels, W, H, zb, rangeeDe, nW, params, fb: force };
    // camera
    const B = this.base(cam);
    const f = (H / 2) / Math.tan((cam.fov * Math.PI) / 360);
    const near = params.proche ?? 0.05;
    const hw = W / 2, hh = H / 2;
    // plans du frustum (normales dirigees vers l'interieur) : gauche, droite, haut, bas, proche
    const tx = (W / 2) / f, ty = (H / 2) / f;
    const plans = [
      [B.rx + tx * B.fx, B.ry + tx * B.fy, B.rz + tx * B.fz], // gauche : x_v > -tx*z_v  =>  (r + tx f).d > 0
      [-B.rx + tx * B.fx, -B.ry + tx * B.fy, -B.rz + tx * B.fz],
      [B.ux + ty * B.fx, B.uy + ty * B.fy, B.uz + ty * B.fz],
      [-B.ux + ty * B.fx, -B.uy + ty * B.fy, -B.uz + ty * B.fz],
      [B.fx, B.fy, B.fz],
    ];
    for (const p of plans) { const n = Math.hypot(p[0], p[1], p[2]); p[0] /= n; p[1] /= n; p[2] /= n; }
    const loin = params.loin ?? 1e9;
    const gmaxInv = 1 / Math.sqrt(1 + tx * tx + ty * ty);   // borne : longueur horizontale du rayon <= sqrt(1 + a^2 + b^2)
    const ctx = { ...cadre, cam, B, f, near, hw, hh, plans, loin, gmaxInv };

    // listes de sections visibles par mode, triees
    // listes : 0 opaque, 1 decoupe, 2 melange, 3 decoupe "interne" (faces de feuilles entre feuilles : apres les autres decoupes)
    const listes = [[], [], [], []];
    for (const d of draws) {
      const secs = d.sections;
      const liste = d.interne ? listes[3] : listes[d.mode];
      const dm2 = d.distMax !== undefined && d.distMax < 1e8 ? d.distMax * d.distMax : 0;
      for (let i = 0; i < secs.length; i++) {
        const bb = secs[i].bbox;
        if (dm2) { const ex = Math.max(bb[0] - cam.x, 0, cam.x - bb[3]), ez = Math.max(bb[2] - cam.z, 0, cam.z - bb[5]); if (ex * ex + ez * ez > dm2) continue; }
        const dist = this.visibilite(bb, ctx, d.nuage ? 1e9 : ctx.loin);
        if (dist < 0) continue;
        liste.push({ d, s: secs[i], dist, partiel: !d.partage && this.depasseLoin(bb, ctx) });
      }
    }
    this.stats.sections = listes[0].length + listes[1].length + listes[2].length + listes[3].length;
    listes[0].sort((a, b) => a.dist - b.dist);
    listes[1].sort((a, b) => a.dist - b.dist);
    listes[3].sort((a, b) => a.dist - b.dist);
    listes[2].sort((a, b) => b.dist - a.dist);
    this.stats.tris = 0; this.stats.trisVus = 0;
    for (const m of [0, 1, 3, 2]) for (const e of listes[m]) this.dessinerSection(e.d, e.s, e.d.mode, ctx, e.partiel);
    this.stats.ms = performance.now() - t0;
    return this.stats;
  }

  // distance au centre si visible, -1 sinon
  visibilite(bb, c, loin = c.loin) {
    const { plans, cam } = c;
    const cx = cam.x, cy = cam.y, cz = cam.z;
    for (let k = 0; k < 5; k++) {
      const p = plans[k];
      // sommet de la boite le plus loin dans le sens de la normale
      const x = p[0] >= 0 ? bb[3] : bb[0], y = p[1] >= 0 ? bb[4] : bb[1], z = p[2] >= 0 ? bb[5] : bb[2];
      const d = (x - cx) * p[0] + (y - cy) * p[1] + (z - cz) * p[2];
      if (k === 4 ? d < c.near : d < 0) return -1;
    }
    // distance (la plus proche de la boite)
    // distance HORIZONTALE (comme le brouillard) : au-dela de `loin` la section est entierement dans la brume, on ne la dessine pas
    const dx = Math.max(bb[0] - cx, 0, cx - bb[3]), dz = Math.max(bb[2] - cz, 0, cz - bb[5]);
    if (dx * dx + dz * dz > loin * loin) return -1;
    return Math.hypot((bb[0] + bb[3]) / 2 - cx, (bb[1] + bb[4]) / 2 - cy, (bb[2] + bb[5]) / 2 - cz);
  }

  // vrai si une partie de la boite est au-dela de `loin` (distance horizontale) : on testera ses triangles un par un
  depasseLoin(bb, c) {
    const { cam, loin } = c;
    const dx = Math.max(Math.abs(bb[0] - cam.x), Math.abs(bb[3] - cam.x)), dz = Math.max(Math.abs(bb[2] - cam.z), Math.abs(bb[5] - cam.z));
    return dx * dx + dz * dz > loin * loin;
  }

  dessinerSection(d, sec, mode, c, partiel = false) {
    const { cam, B, f, near, hw, hh, W, H } = c;
    const pos = d.positions, uvs = d.uvs, col = d.couleurs, ind = d.indices;
    const vbase = d.partage ? 0 : (sec.debut / 6) * 4;
    const vcount = d.partage ? pos.length / 3 : (sec.nb / 6) * 4;
    this.ensure(vcount + 8);
    const { SX, SY, IW, UW, VW, U, V, R, G, B: Bc, XV, YV, ZV, ST } = this;
    const stamp = ++this.stamp;
    const cx = cam.x, cy = cam.y, cz = cam.z;
    const { rx, ry, rz, ux, uy, uz, fx, fy, fz } = B;
    const k256 = 256 / 255;
    const cull = !d.deuxFaces;
    const tex = d.tex;
    const mips = tex.niveaux;
    // etat du dessin pour tri()
    this.mode = mode; this.c = c; this.tex = tex; this.nuageTri = d.nuage === true; this.addF = d.additif === true;
    // masque de couleur selective (maillages dynamiques seulement) : voir rendu/LISEZMOI.md
    this.msk = d.masque ?? null; this.kM = d.kM ?? 256; this.kE = d.kE ?? 0; this.exFlag = d.exempt ? 255 : 0;
    // options du shader (voir src/shader) : ombres cuites, AO reglable, balancement, surface d'eau. Toutes nulles sans shader.
    const P = c.params, sv = d.partage ? null : P.sv || null, ven = P.ven || null;
    // lumiere du jeu par sommet (scenes avec monde) : niveaux (ciel, bloc) 0..255 -> couleur de la table de lumiere, interpolee entre les cases
    const lmT = !d.partage && d.niv && P.lm ? P.lm : null, niv = lmT ? d.niv : null;
    const ombre = sv !== null && d.ombre ? d.ombre : null, aoA = sv !== null && sv.aoLut && d.ao ? d.ao : null;
    const etiq = d.etiq && !d.partage && (ven !== null || P.eau) ? d.etiq : null;
    let vent = false;
    if (ven !== null && etiq !== null) {
      const bb = sec.bbox, ex = Math.max(bb[0] - cx, 0, cx - bb[3]), ez = Math.max(bb[2] - cz, 0, cz - bb[5]);
      vent = ex * ex + ez * ez < ven.D2e;
    }
    const eauOn = etiq !== null && !!P.eau;
    const minV = sv !== null ? sv.min : 0;
    const fin = sec.debut + sec.nb;
    let nTri = 0;
    this.eauTri = false;
    for (let t = sec.debut; t < fin; t += 3) {
      const i0 = ind[t], i1 = ind[t + 1], i2 = ind[t + 2];
      const a3 = i0 * 3, b3 = i1 * 3, c3 = i2 * 3;
      const ax = pos[a3], ay = pos[a3 + 1], az = pos[a3 + 2];
      if (partiel) {   // triangle entierement au-dela de la brume (distance horizontale) : invisible, on le saute
        const l2 = c.loin * c.loin;
        let ddx = ax - cx, ddz = az - cz;
        if (ddx * ddx + ddz * ddz > l2) {
          ddx = pos[b3] - cx; ddz = pos[b3 + 2] - cz;
          if (ddx * ddx + ddz * ddz > l2) {
            ddx = pos[c3] - cx; ddz = pos[c3 + 2] - cz;
            if (ddx * ddx + ddz * ddz > l2) continue;
          }
        }
      }
      if (cull) {
        const e1x = pos[b3] - ax, e1y = pos[b3 + 1] - ay, e1z = pos[b3 + 2] - az;
        const e2x = pos[c3] - ax, e2y = pos[c3 + 1] - ay, e2z = pos[c3 + 2] - az;
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        if (nx * (cx - ax) + ny * (cy - ay) + nz * (cz - az) <= 0) continue;
      }
      nTri++;
      // transformation paresseuse des 3 sommets
      let a = i0 - vbase, b = i1 - vbase, cc = i2 - vbase;
      for (let k = 0; k < 3; k++) {
        const j = k === 0 ? a : k === 1 ? b : cc;
        if (ST[j] === stamp) continue;
        ST[j] = stamp;
        const g = j + vbase, g3 = g * 3;
        let dx = pos[g3] - cx, dy = pos[g3 + 1] - cy, dz = pos[g3 + 2] - cz;
        if (vent) { const e = etiq[g]; if (e !== 0) { this.onde(e, pos[g3], pos[g3 + 1], pos[g3 + 2], dx, dz, ven); dx += this.ox; dy += this.oy; dz += this.oz; } }
        const xv = dx * rx + dy * ry + dz * rz, yv = dx * ux + dy * uy + dz * uz, zv = dx * fx + dy * fy + dz * fz;
        XV[j] = xv; YV[j] = yv; ZV[j] = zv;
        const u = uvs[g * 2], v = uvs[g * 2 + 1];
        U[j] = u; V[j] = v;
        const cl = col[g];
        let rr = (cl & 255) * k256, gg = ((cl >> 8) & 255) * k256, bb = ((cl >> 16) & 255) * k256;
        if (sv !== null) {
          if (ombre !== null) { const s = ombre[g]; rr *= sv.R[s]; gg *= sv.G[s]; bb *= sv.B[s]; }
          if (aoA !== null) { const m = sv.aoLut[aoA[g]]; rr *= m; gg *= m; bb *= m; }
          if (minV > 0) { if (rr < minV) rr = minV; if (gg < minV) gg = minV; if (bb < minV) bb = minV; }
        }
        if (lmT !== null) {
          const s = niv[g * 2] * 0.0588235294117647, bq = niv[g * 2 + 1] * 0.0588235294117647;   // x 15 / 255
          const s0 = s | 0, b0 = bq | 0, fs = s - s0, fb = bq - b0, s1 = s0 < 15 ? s0 + 1 : 15, b1 = b0 < 15 ? b0 + 1 : 15;
          const i00 = s0 * 16 + b0, i01 = s0 * 16 + b1, i10 = s1 * 16 + b0, i11 = s1 * 16 + b1;
          const w00 = (1 - fs) * (1 - fb), w01 = (1 - fs) * fb, w10 = fs * (1 - fb), w11 = fs * fb;
          rr *= lmT.R[i00] * w00 + lmT.R[i01] * w01 + lmT.R[i10] * w10 + lmT.R[i11] * w11;
          gg *= lmT.G[i00] * w00 + lmT.G[i01] * w01 + lmT.G[i10] * w10 + lmT.G[i11] * w11;
          bb *= lmT.B[i00] * w00 + lmT.B[i01] * w01 + lmT.B[i10] * w10 + lmT.B[i11] * w11;
        }
        R[j] = rr; G[j] = gg; Bc[j] = bb;
        if (zv > near) {
          const iw = 1 / zv;
          IW[j] = iw; SX[j] = hw + xv * f * iw; SY[j] = hh - yv * f * iw;
          UW[j] = u * iw; VW[j] = v * iw;
        }
      }
      if (eauOn) this.eauTri = (etiq[i0] & 7) === 1;
      const za = ZV[a], zb2 = ZV[b], zc = ZV[cc];
      if (za > near && zb2 > near && zc > near) this.tri(a, b, cc);
      else if (za <= near && zb2 <= near && zc <= near) continue;
      else this.triDecoupe(a, b, cc);
    }
    this.stats.trisVus += nTri;
    this.stats.tris += (fin - sec.debut) / 3;
    void W; void H; void mips;
  }

  // Balancement d'un sommet (feuilles, plantes) ou ondulation de l'eau : decalage ecrit dans this.ox/oy/oz. Ne depend que du temps et de la position
  // MONDE du sommet (pas de la section) : les sommets partages entre deux faces ou deux sections bougent pareil, aucune fissure. Le fondu avec la
  // distance (horizontale, a la camera) est lui aussi une fonction du sommet seul.
  onde(e, x, y, z, dxc, dzc, v) {
    this.ox = 0; this.oy = 0; this.oz = 0;
    const d2 = dxc * dxc + dzc * dzc, g = e & 7;
    if (g === 1) {   // eau
      if (v.eh === 0 || d2 > v.D2e) return;
      const f = d2 < v.D2en ? 1 : 1 - (Math.sqrt(d2) / v.De - 0.7) / 0.3;
      this.oy = v.eh * f * (0.6 * Math.sin(x * 0.9 * v.ke + v.t * 1.7 * v.ev) + 0.4 * Math.sin((z * 1.1 + x * 0.5) * v.ke + v.t * 2.3 * v.ev));
      return;
    }
    if (d2 > v.D2) return;
    let amp, sp, w = 1;
    if (g === 2) { amp = v.fa; sp = v.fs; } else if (g === 3) { amp = v.ha; sp = v.hs; const q = (e >> 3) / 31; w = q * q; } else return;
    if (amp === 0) return;
    const f = d2 < v.D2n ? 1 : 1 - (Math.sqrt(d2) / v.D - 0.7) / 0.3;
    const al = x * v.wx + z * v.wz, tr = z * v.wx - x * v.wz, K = v.k;
    const s1 = Math.sin(al * 0.6 * K + v.t * 1.8 * sp), s2 = Math.sin(tr * 0.9 * K + al * 0.3 * K + v.t * 2.7 * sp + y * 0.8);
    const gust = 1 + v.raf * 0.8 * Math.sin(al * 0.08 * K - v.t * 0.5);
    const off = amp * w * f * gust * (0.65 * s1 + 0.35 * s2);
    this.ox = v.wx * off; this.oz = v.wz * off;
    if (g === 2) this.oy = amp * f * 0.3 * s2;
  }

  // Decoupe un triangle au plan proche puis dessine 1 ou 2 triangles
  triDecoupe(a, b, c) {
    const near = this.c.near, { XV, YV, ZV, U, V, R, G, B: Bc } = this;
    const idx = [a, b, c];
    const sortie = []; // sommets (tableaux de valeurs)
    const val = (j) => [XV[j], YV[j], ZV[j], U[j], V[j], R[j], G[j], Bc[j]];
    for (let k = 0; k < 3; k++) {
      const p = idx[k], q = idx[(k + 1) % 3];
      const zp = ZV[p], zq = ZV[q];
      const pin = zp > near, qin = zq > near;
      if (pin) sortie.push(val(p));
      if (pin !== qin) {
        const t = (near - zp) / (zq - zp);
        const vp = val(p), vq = val(q);
        sortie.push(vp.map((x, i) => x + (vq[i] - x) * t));
      }
    }
    if (sortie.length < 3) return;
    const base = this.cap - 8;
    const { SX, SY, IW, UW, VW } = this;
    const { f, hw, hh } = this.c;
    for (let k = 0; k < sortie.length; k++) {
      const s = sortie[k], j = base + k;
      const zv = Math.max(s[2], near);
      const iw = 1 / zv;
      XV[j] = s[0]; YV[j] = s[1]; ZV[j] = zv; U[j] = s[3]; V[j] = s[4]; R[j] = s[5]; G[j] = s[6]; Bc[j] = s[7];
      IW[j] = iw; SX[j] = hw + s[0] * f * iw; SY[j] = hh - s[1] * f * iw; UW[j] = s[3] * iw; VW[j] = s[4] * iw;
    }
    this.tri(base, base + 1, base + 2);
    if (sortie.length === 4) this.tri(base, base + 2, base + 3);
  }

  // Dessine un triangle (indices dans les tampons de sommets deja projetes)
  tri(a, b, c) {
    const { SX, SY, IW, UW, VW, U, V, R, G, B } = this;
    const cx = this.c;
    const W = cx.W, H = cx.H, pixels = cx.pixels, zb = cx.zb, rangeeDe = cx.rangeeDe, nW = cx.nW;
    const x0 = SX[a], y0 = SY[a], x1 = SX[b], y1 = SY[b], x2 = SX[c], y2 = SY[c];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (!(area !== 0)) return;
    // rangees couvertes
    let ymin = y0, ymax = y0, xmin = x0, xmax = x0;
    if (y1 < ymin) ymin = y1; else if (y1 > ymax) ymax = y1;
    if (y2 < ymin) ymin = y2; else if (y2 > ymax) ymax = y2;
    if (x1 < xmin) xmin = x1; else if (x1 > xmax) xmax = x1;
    if (x2 < xmin) xmin = x2; else if (x2 > xmax) xmax = x2;
    let ya = Math.ceil(ymin - 0.5), yb = Math.ceil(ymax - 0.5) - 1;
    if (ya < 0) ya = 0;
    if (yb >= H) yb = H - 1;
    if (ya > yb || xmax < 0 || xmin >= W) return;
    // les rangees que je possede dans [ya, yb] ?
    if (nW > 1 && ya >> 4 === yb >> 4 && ((ya >> 4) % nW) !== rangeeDe) return;

    // niveau de mip d'apres le rapport texels / pixels du triangle
    const mips = this.tex.niveaux;
    let lvl = 0;
    if (mips.length > 1 && cx.params.mip !== false) {
      const T0 = mips[0];
      const ta = Math.abs((U[b] - U[a]) * (V[c] - V[a]) - (U[c] - U[a]) * (V[b] - V[a])) * T0.w * T0.h;
      const ratio = ta / Math.abs(area);
      if (ratio > 2.3) lvl = ratio > 9.2 ? (ratio > 36.8 ? 3 : 2) : 1;
      if (lvl >= mips.length) lvl = mips.length - 1;
    }
    const tl = mips[lvl];
    const TW = tl.w, TH = tl.h, texd = tl.data;

    // gradients (plan passant par le sommet a)
    const inv = 1 / area;
    const dx1 = x1 - x0, dy1 = y1 - y0, dx2 = x2 - x0, dy2 = y2 - y0;
    const iw0 = IW[a], iw1 = IW[b] - iw0, iw2 = IW[c] - iw0;
    const diwx = (iw1 * dy2 - iw2 * dy1) * inv, diwy = (iw2 * dx1 - iw1 * dx2) * inv;
    const uw0 = UW[a] * TW, uw1 = UW[b] * TW - uw0, uw2 = UW[c] * TW - uw0;
    const duwx = (uw1 * dy2 - uw2 * dy1) * inv, duwy = (uw2 * dx1 - uw1 * dx2) * inv;
    const vw0 = VW[a] * TH, vw1 = VW[b] * TH - vw0, vw2 = VW[c] * TH - vw0;
    const dvwx = (vw1 * dy2 - vw2 * dy1) * inv, dvwy = (vw2 * dx1 - vw1 * dx2) * inv;
    // lumiere globale (facteur par canal, 1 = inchange) : multiplie la couleur de sommet, donc tout le terrain et les acteurs
    const LP = this.nuageTri === true || this.addF === true ? null : cx.params.lumiere;   // les nuages ont leur propre couleur : pas de lumiere du terrain
    const LR = LP ? LP[0] : 1, LG = LP ? LP[1] : 1, LB = LP ? LP[2] : 1;
    const sat = LR > 1 || LG > 1 || LB > 1;     // la couleur peut depasser 255 : on la rabat
    const r0 = R[a] * LR, r1 = R[b] * LR - r0, r2 = R[c] * LR - r0;
    const drx = (r1 * dy2 - r2 * dy1) * inv, dry = (r2 * dx1 - r1 * dx2) * inv;
    const g0 = G[a] * LG, g1 = G[b] * LG - g0, g2 = G[c] * LG - g0;
    const dgx = (g1 * dy2 - g2 * dy1) * inv, dgy = (g2 * dx1 - g1 * dx2) * inv;
    const b0 = B[a] * LB, b1 = B[b] * LB - b0, b2 = B[c] * LB - b0;
    const dbx = (b1 * dy2 - b2 * dy1) * inv, dby = (b2 * dx1 - b1 * dx2) * inv;

    // sommets tries par y : t (haut), m (milieu), l (bas)
    let tx = x0, ty = y0, mx = x1, my = y1, lx = x2, ly = y2, tmp;
    if (ty > my) { tmp = tx; tx = mx; mx = tmp; tmp = ty; ty = my; my = tmp; }
    if (my > ly) { tmp = mx; mx = lx; lx = tmp; tmp = my; my = ly; ly = tmp; }
    if (ty > my) { tmp = tx; tx = mx; mx = tmp; tmp = ty; ty = my; my = tmp; }
    const dTL = ly - ty;
    if (!(dTL > 0)) return;
    const sLong = (lx - tx) / dTL;
    const dTM = my - ty, dML = ly - my;
    const sTM = dTM > 0 ? (mx - tx) / dTM : 0, sML = dML > 0 ? (lx - mx) / dML : 0;

    const mode = this.mode;
    const params = cx.params;
    const fb = cx.fb ?? null, msk = this.msk, kM = this.kM, kE = this.kE, exFlag = this.exFlag;
    const nuT = this.nuageTri === true && params.nuageFin !== undefined;   // maillage des nuages : sa propre brume
    const fogDeb = nuT ? params.nuageDebut : params.brumeDebut, ifog = 1 / Math.max(1e-6, (nuT ? params.nuageFin : params.brumeFin) - fogDeb);
    let fogR = params.brume[0], fogG = params.brume[1], fogB = params.brume[2];
    // brouillard : distance HORIZONTALE (cylindre autour de la camera, comme le jeu), pas la profondeur d'ecran. Pour un pixel,
    // la distance horizontale = profondeur x longueur de la partie horizontale du rayon (calculee par rangee et par colonne).
    // En dessous de fogMin (profondeur) aucun pixel ne peut etre dans la brume : pas de racine carree.
    const fogCiel = params.brumeCiel === true;
    const Bc2 = cx.B, iF = 1 / cx.f, hwF = cx.hw, hhF = cx.hh;
    // brume du shader : courbe (table) et brume basse (couche d'altitude) ; nulles sans shader
    const fogL = params.fogLut || null, fogH = params.fogH || null;
    const fogMin0 = fogDeb * cx.gmaxInv;
    const fogMin = fogH !== null ? 0 : fogMin0;
    const camY = cx.cam.y, fogHaut = fogH !== null ? fogH.haut : 0, fogInv = fogH !== null ? fogH.inv : 0, fogK = fogH !== null ? fogH.k : 0;
    const WT = this.eauTri && mode === 2 ? params.eau : null;   // triangle de surface d'eau : reflet du ciel, ondulations
    let nPix = 0;

    let y = ya;
    while (y <= yb) {
      const blk = y >> 4;
      if (nW > 1 && (blk % nW) !== rangeeDe) { y = (blk + 1) << 4; continue; }
      let yEnd = nW > 1 ? ((blk + 1) << 4) - 1 : yb;
      if (yEnd > yb) yEnd = yb;
      for (; y <= yEnd; y++) {
        const yc = y + 0.5;
        if (fogCiel) { fogR = this.skyR[y]; fogG = this.skyG[y]; fogB = this.skyB[y]; }
        const bF = (hhF - yc) * iF, hxr = Bc2.fx + bF * Bc2.ux, hzr = Bc2.fz + bF * Bc2.uz, hyRow = Bc2.fy + bF * Bc2.uy;
        const xl0 = tx + (yc - ty) * sLong;
        const xs0 = yc < my ? tx + (yc - ty) * sTM : mx + (yc - my) * sML;
        let xa, xb2;
        if (xl0 < xs0) { xa = xl0; xb2 = xs0; } else { xa = xs0; xb2 = xl0; }
        let xs = Math.ceil(xa - 0.5), xe = Math.ceil(xb2 - 0.5);
        if (xs < 0) xs = 0;
        if (xe > W) xe = W;
        if (xs >= xe) continue;
        const px = xs + 0.5 - x0, py = yc - y0;
        let iw = iw0 + diwx * px + diwy * py;
        let uw = uw0 + duwx * px + duwy * py;
        let vw = vw0 + dvwx * px + dvwy * py;
        let r = r0 + drx * px + dry * py, g = g0 + dgx * px + dgy * py, bl = b0 + dbx * px + dby * py;
        const rowO = y * W;
        let o = rowO + xs;
        const oe = y * W + xe;
        nPix += xe - xs;
        if (mode === 2) {
          if (WT !== null) {   // surface d'eau : teinte, opacite, reflet du ciel selon l'angle de vue (Fresnel) et ondulations (normale)
            const cam2 = cx.cam, camx = cam2.x, camz = cam2.z, T = WT.t, ond = WT.ond, refl = WT.refl, frLut = WT.fres, skyL = WT.sky, tint = WT.tint, kLum = WT.kLum, opa = WT.opacite, pente = WT.pente;
            for (; o < oe; o++, iw += diwx, uw += duwx, vw += dvwx, r += drx, g += dgx, bl += dbx) {
              if (iw <= zb[o]) continue;
              const w = 1 / iw;
              let tu = (uw * w) | 0, tv = (vw * w) | 0;
              if (tu < 0) tu = 0; else if (tu >= TW) tu = TW - 1;
              if (tv < 0) tv = 0; else if (tv >= TH) tv = TH - 1;
              const t = texd[tv * TW + tu];
              let al = t >>> 24;
              if (al < 4) continue;
              let sr = ((t & 255) * r) >> 8, sg = (((t >> 8) & 255) * g) >> 8, sb = (((t >> 16) & 255) * bl) >> 8;
              if (sr > 255) sr = 255; if (sg > 255) sg = 255; if (sb > 255) sb = 255;
              const aF = (o - rowO + 0.5 - hwF) * iF, hx = hxr + aF * Bc2.rx, hz = hzr + aF * Bc2.rz;
              if (tint !== null) { const lum = (sr * 0.3 + sg * 0.59 + sb * 0.11) * kLum; sr = tint[0] * lum; sg = tint[1] * lum; sb = tint[2] * lum; if (sr > 255) sr = 255; if (sg > 255) sg = 255; if (sb > 255) sb = 255; }
              al *= opa;
              if (refl) {
                const wx = camx + w * hx, wz = camz + w * hz;
                let sxw = 0, szw = 0;
                for (let q = 0; q < 12; q += 4) { const ph = ond[q] * wx + ond[q + 1] * wz + ond[q + 2] * T, cs = Math.cos(ph) * ond[q + 3]; sxw += cs * ond[q]; szw += cs * ond[q + 1]; }
                sxw *= pente; szw *= pente;
                const nl = 1 / Math.sqrt(1 + sxw * sxw + szw * szw), dl = 1 / Math.sqrt(hx * hx + hyRow * hyRow + hz * hz);
                let cosT = (sxw * hx - hyRow + szw * hz) * nl * dl;
                cosT = cosT < 0 ? 0 : cosT > 1 ? 1 : cosT;
                const fr = frLut[(cosT * 255) | 0];
                let ry = hyRow * dl + 2 * cosT * nl;
                ry = ry < 0 ? 0 : ry > 1 ? 1 : ry;
                const si = ((ry * 63) | 0) * 3;
                sr += (skyL[si] - sr) * fr; sg += (skyL[si + 1] - sg) * fr; sb += (skyL[si + 2] - sb) * fr;
                al += (255 - al) * fr * 0.7;
              }
              if (al > 255) al = 255;
              if (w > fogMin) {
                let ff = 0;
                if (w > fogMin0) { ff = (w * Math.sqrt(hx * hx + hz * hz) - fogDeb) * ifog; if (fogL !== null && ff > 0) ff = ff >= 1 ? 1 : fogL[(ff * 256) | 0]; }
                if (fogH !== null) { let hv = (fogHaut - (camY + w * hyRow)) * fogInv; if (hv > 0) { if (hv > 1) hv = 1; const xx = w * hv * fogK, fh = xx / (1 + xx); if (fh > ff) ff = fh; } }
                if (ff >= 1) { sr = fogR; sg = fogG; sb = fogB; } else if (ff > 0) { sr += (fogR - sr) * ff; sg += (fogG - sg) * ff; sb += (fogB - sb) * ff; }
              }
              const dst = pixels[o];
              const a = al * (1 / 255);
              const dr = dst & 255, dg = (dst >> 8) & 255, db = (dst >> 16) & 255;
              pixels[o] = (0xff000000 | (((db + (sb - db) * a) | 0) << 16) | (((dg + (sg - dg) * a) | 0) << 8) | ((dr + (sr - dr) * a) | 0)) >>> 0;
            }
            continue;
          }
          if (this.addF === true) {   // additif (foudre) : destination + couleur x opacite, sans brume ni ecriture de profondeur
            for (; o < oe; o++, iw += diwx, uw += duwx, vw += dvwx, r += drx, g += dgx, bl += dbx) {
              if (iw <= zb[o]) continue;
              const w = 1 / iw;
              let tu = (uw * w) | 0, tv = (vw * w) | 0;
              if (tu < 0) tu = 0; else if (tu >= TW) tu = TW - 1;
              if (tv < 0) tv = 0; else if (tv >= TH) tv = TH - 1;
              const t = texd[tv * TW + tu];
              const a = (t >>> 24) * (1 / 255);
              if (a < 0.015) continue;
              const dst = pixels[o];
              let nr = (dst & 255) + (((t & 255) * r) >> 8) * a, ng = ((dst >> 8) & 255) + ((((t >> 8) & 255) * g) >> 8) * a, nb = ((dst >> 16) & 255) + ((((t >> 16) & 255) * bl) >> 8) * a;
              if (nr > 255) nr = 255; if (ng > 255) ng = 255; if (nb > 255) nb = 255;
              pixels[o] = (0xff000000 | ((nb | 0) << 16) | ((ng | 0) << 8) | (nr | 0)) >>> 0;
            }
            continue;
          }
          for (; o < oe; o++, iw += diwx, uw += duwx, vw += dvwx, r += drx, g += dgx, bl += dbx) {
            if (iw <= zb[o]) continue;
            const w = 1 / iw;
            let tu = (uw * w) | 0, tv = (vw * w) | 0;
            if (tu < 0) tu = 0; else if (tu >= TW) tu = TW - 1;
            if (tv < 0) tv = 0; else if (tv >= TH) tv = TH - 1;
            const t = texd[tv * TW + tu];
            const al = t >>> 24;
            if (al < 4) continue;
            let sr = ((t & 255) * r) >> 8, sg = (((t >> 8) & 255) * g) >> 8, sb = (((t >> 16) & 255) * bl) >> 8;
            if (sat) { if (sr > 255) sr = 255; if (sg > 255) sg = 255; if (sb > 255) sb = 255; }
            if (w > fogMin) {
              let ff = 0;
              if (w > fogMin0) {
                const aF = (o - rowO + 0.5 - hwF) * iF, hx = hxr + aF * Bc2.rx, hz = hzr + aF * Bc2.rz;
                ff = (w * Math.sqrt(hx * hx + hz * hz) - fogDeb) * ifog;
                if (fogL !== null && ff > 0) ff = ff >= 1 ? 1 : fogL[(ff * 256) | 0];
              }
              if (fogH !== null) { let hv = (fogHaut - (camY + w * hyRow)) * fogInv; if (hv > 0) { if (hv > 1) hv = 1; const xx = w * hv * fogK, fh = xx / (1 + xx); if (fh > ff) ff = fh; } }
              if (ff >= 1) { sr = fogR; sg = fogG; sb = fogB; } else if (ff > 0) { sr += (fogR - sr) * ff; sg += (fogG - sg) * ff; sb += (fogB - sb) * ff; }
            }
            const dst = pixels[o];
            const a = al * (1 / 255);
            const dr = dst & 255, dg = (dst >> 8) & 255, db = (dst >> 16) & 255;
            pixels[o] = (0xff000000 | (((db + (sb - db) * a) | 0) << 16) | (((dg + (sg - dg) * a) | 0) << 8) | ((dr + (sr - dr) * a) | 0)) >>> 0;
          }
        } else if (mode === 1) {
          for (; o < oe; o++, iw += diwx, uw += duwx, vw += dvwx, r += drx, g += dgx, bl += dbx) {
            if (iw <= zb[o]) continue;
            const w = 1 / iw;
            let tu = (uw * w) | 0, tv = (vw * w) | 0;
            if (tu < 0) tu = 0; else if (tu >= TW) tu = TW - 1;
            if (tv < 0) tv = 0; else if (tv >= TH) tv = TH - 1;
            const ti = tv * TW + tu;
            const t = texd[ti];
            if ((t >>> 24) < 96) continue;
            let rr = r, gg = g, bb = bl, fo = exFlag;
            if (msk !== null) {   // couleur selective : force d'exemption et lueur (pas d'ombrage) de ce texel
              const mm = msk[ti];
              if (mm !== 0) {
                const f2 = ((mm * kM) / 255) | 0; if (f2 > fo) fo = f2 > 255 ? 255 : f2;
                const e = ((mm * kE) / 255) | 0;
                if (e !== 0) { const k = e * (1 / 256); rr += (256 - rr) * k; gg += (256 - gg) * k; bb += (256 - bb) * k; }
              }
            }
            let sr = ((t & 255) * rr) >> 8, sg = (((t >> 8) & 255) * gg) >> 8, sb = (((t >> 16) & 255) * bb) >> 8;
            if (sat) { if (sr > 255) sr = 255; if (sg > 255) sg = 255; if (sb > 255) sb = 255; }
            if (w > fogMin) {
              let ff = 0;
              if (w > fogMin0) {
                const aF = (o - rowO + 0.5 - hwF) * iF, hx = hxr + aF * Bc2.rx, hz = hzr + aF * Bc2.rz;
                ff = (w * Math.sqrt(hx * hx + hz * hz) - fogDeb) * ifog;
                if (fogL !== null && ff > 0) ff = ff >= 1 ? 1 : fogL[(ff * 256) | 0];
              }
              if (fogH !== null) { let hv = (fogHaut - (camY + w * hyRow)) * fogInv; if (hv > 0) { if (hv > 1) hv = 1; const xx = w * hv * fogK, fh = xx / (1 + xx); if (fh > ff) ff = fh; } }
              if (ff >= 1) { sr = fogR; sg = fogG; sb = fogB; } else if (ff > 0) { sr += (fogR - sr) * ff; sg += (fogG - sg) * ff; sb += (fogB - sb) * ff; }
            }
            zb[o] = iw;
            pixels[o] = (0xff000000 | ((sb | 0) << 16) | ((sg | 0) << 8) | (sr | 0)) >>> 0;
            if (fb !== null) fb[o] = fo;
          }
        } else {
          for (; o < oe; o++, iw += diwx, uw += duwx, vw += dvwx, r += drx, g += dgx, bl += dbx) {
            if (iw <= zb[o]) continue;
            const w = 1 / iw;
            let tu = (uw * w) | 0, tv = (vw * w) | 0;
            if (tu < 0) tu = 0; else if (tu >= TW) tu = TW - 1;
            if (tv < 0) tv = 0; else if (tv >= TH) tv = TH - 1;
            const ti = tv * TW + tu;
            const t = texd[ti];
            let rr = r, gg = g, bb = bl, fo = exFlag;
            if (msk !== null) {
              const mm = msk[ti];
              if (mm !== 0) {
                const f2 = ((mm * kM) / 255) | 0; if (f2 > fo) fo = f2 > 255 ? 255 : f2;
                const e = ((mm * kE) / 255) | 0;
                if (e !== 0) { const k = e * (1 / 256); rr += (256 - rr) * k; gg += (256 - gg) * k; bb += (256 - bb) * k; }
              }
            }
            let sr = ((t & 255) * rr) >> 8, sg = (((t >> 8) & 255) * gg) >> 8, sb = (((t >> 16) & 255) * bb) >> 8;
            if (sat) { if (sr > 255) sr = 255; if (sg > 255) sg = 255; if (sb > 255) sb = 255; }
            if (w > fogMin) {
              let ff = 0;
              if (w > fogMin0) {
                const aF = (o - rowO + 0.5 - hwF) * iF, hx = hxr + aF * Bc2.rx, hz = hzr + aF * Bc2.rz;
                ff = (w * Math.sqrt(hx * hx + hz * hz) - fogDeb) * ifog;
                if (fogL !== null && ff > 0) ff = ff >= 1 ? 1 : fogL[(ff * 256) | 0];
              }
              if (fogH !== null) { let hv = (fogHaut - (camY + w * hyRow)) * fogInv; if (hv > 0) { if (hv > 1) hv = 1; const xx = w * hv * fogK, fh = xx / (1 + xx); if (fh > ff) ff = fh; } }
              if (ff >= 1) { sr = fogR; sg = fogG; sb = fogB; } else if (ff > 0) { sr += (fogR - sr) * ff; sg += (fogG - sg) * ff; sb += (fogB - sb) * ff; }
            }
            zb[o] = iw;
            pixels[o] = (0xff000000 | ((sb | 0) << 16) | ((sg | 0) << 8) | (sr | 0)) >>> 0;
            if (fb !== null) fb[o] = fo;
          }
        }
      }
    }
    this.stats.pixels += nPix;
  }
}
