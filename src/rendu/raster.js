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
        const dist = this.visibilite(bb, ctx);
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
  visibilite(bb, c) {
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
    if (dx * dx + dz * dz > c.loin * c.loin) return -1;
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
    this.mode = mode; this.c = c; this.tex = tex;
    // masque de couleur selective (maillages dynamiques seulement) : voir rendu/LISEZMOI.md
    this.msk = d.masque ?? null; this.kM = d.kM ?? 256; this.kE = d.kE ?? 0; this.exFlag = d.exempt ? 255 : 0;
    const fin = sec.debut + sec.nb;
    let nTri = 0;
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
        const dx = pos[g3] - cx, dy = pos[g3 + 1] - cy, dz = pos[g3 + 2] - cz;
        const xv = dx * rx + dy * ry + dz * rz, yv = dx * ux + dy * uy + dz * uz, zv = dx * fx + dy * fy + dz * fz;
        XV[j] = xv; YV[j] = yv; ZV[j] = zv;
        const u = uvs[g * 2], v = uvs[g * 2 + 1];
        U[j] = u; V[j] = v;
        const cl = col[g];
        R[j] = (cl & 255) * k256; G[j] = ((cl >> 8) & 255) * k256; Bc[j] = ((cl >> 16) & 255) * k256;
        if (zv > near) {
          const iw = 1 / zv;
          IW[j] = iw; SX[j] = hw + xv * f * iw; SY[j] = hh - yv * f * iw;
          UW[j] = u * iw; VW[j] = v * iw;
        }
      }
      const za = ZV[a], zb2 = ZV[b], zc = ZV[cc];
      if (za > near && zb2 > near && zc > near) this.tri(a, b, cc);
      else if (za <= near && zb2 <= near && zc <= near) continue;
      else this.triDecoupe(a, b, cc);
    }
    this.stats.trisVus += nTri;
    this.stats.tris += (fin - sec.debut) / 3;
    void W; void H; void mips;
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
    const LP = cx.params.lumiere;
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
    const fogDeb = params.brumeDebut, ifog = 1 / Math.max(1e-6, params.brumeFin - params.brumeDebut);
    let fogR = params.brume[0], fogG = params.brume[1], fogB = params.brume[2];
    // brouillard : distance HORIZONTALE (cylindre autour de la camera, comme le jeu), pas la profondeur d'ecran. Pour un pixel,
    // la distance horizontale = profondeur x longueur de la partie horizontale du rayon (calculee par rangee et par colonne).
    // En dessous de fogMin (profondeur) aucun pixel ne peut etre dans la brume : pas de racine carree.
    const fogCiel = params.brumeCiel === true;
    const Bc2 = cx.B, iF = 1 / cx.f, hwF = cx.hw, hhF = cx.hh;
    const fogMin = fogDeb * cx.gmaxInv;
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
        const bF = (hhF - yc) * iF, hxr = Bc2.fx + bF * Bc2.ux, hzr = Bc2.fz + bF * Bc2.uz;
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
              const aF = (o - rowO + 0.5 - hwF) * iF, hx = hxr + aF * Bc2.rx, hz = hzr + aF * Bc2.rz;
              const ff = (w * Math.sqrt(hx * hx + hz * hz) - fogDeb) * ifog;
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
              const aF = (o - rowO + 0.5 - hwF) * iF, hx = hxr + aF * Bc2.rx, hz = hzr + aF * Bc2.rz;
              const ff = (w * Math.sqrt(hx * hx + hz * hz) - fogDeb) * ifog;
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
              const aF = (o - rowO + 0.5 - hwF) * iF, hx = hxr + aF * Bc2.rx, hz = hzr + aF * Bc2.rz;
              const ff = (w * Math.sqrt(hx * hx + hz * hz) - fogDeb) * ifog;
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
