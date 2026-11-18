// Le joueur dans l'ecran d'inventaire (InventoryScreen : extractEntityInInventoryFollowsMouse, docs/SIMULATION.md partie 26) : la boite
// [26, 75) x [8, 78) de l'ecran, 30 pixels de GUI par bloc, decalage 0,0625 ; le curseur est pris au centre de la boite (angles nuls :
// corps a 180 degres, face a l'ecran, tete droite). Transformation : centre de la boite, echelle (30, 30, -30), translation
// (0, hauteur / 2 + 0,0625, 0), rotation Z de pi ; tampon de profondeur ; lumieres ENTITY_IN_UI (0,2, -1, 1) et (-0,2, -1, 0) en repere
// d'ecran, diffuse x 0,6 + 0,4. Chiffres relus dans Horizon game/perspective.rs (draw_player_preview, draw_inventory_player,
// entity_in_ui_shade ; MIT, voir ATTRIBUTIONS.md).
const BOITE = [26, 8, 75, 78], TAILLE = 30, DECALAGE = 0.0625;
const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
const L0 = norm([0.2, -1, 1]), L1 = norm([-0.2, -1, 0]);

// pose du monde de l'acteur -> pose de l'apercu (meme membres, objets et armure ; place a l'origine, tourne vers l'ecran)
export function poseApercu(p) {
  return { ...p, x: 0, y: 0, z: 0, lacet: 180, tete: [0, 0], penche: 0, dy: 0, hauteur: 0, bascule: 0, roulis: 0, ragdoll: null, plane: false, vrille: false, rouge: false };
}

// dessine le maillage `m` (ou une liste) de Personnage.maillage(pose, 1, true) dans l'image `o` (un pixel de GUI = E pixels)
export function dessinerApercu(o, E, maillages, accroupi = false) {
  const [bx0, by0, bx1, by1] = BOITE, cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, h = accroupi ? 1.5 : 1.8;
  const X0 = Math.round(bx0 * E), Y0 = Math.round(by0 * E), X1 = Math.min(o.w, Math.round(bx1 * E)), Y1 = Math.min(o.h, Math.round(by1 * E));
  const W = X1 - X0, prof = new Float64Array(W * (Y1 - Y0)).fill(-Infinity);
  // monde (relatif aux pieds) -> ecran : Rz(pi) (x, y) -> (-x, -y), + (0, h/2 + 0,0625), x 30 (z x -30), + centre
  const ecran = (x, y, z) => [(cx - TAILLE * x) * E, (cy + TAILLE * (h / 2 + DECALAGE - y)) * E, -TAILLE * z];
  for (const m of [maillages].flat()) {
    if (!m?.positions) continue;
    const t = m.texture, P = m.positions, U = m.uvs, N = m.normales, I = m.indices;
    for (let q = 0; q + 2 < I.length; q += 3) {
      const a = I[q], b = I[q + 1], c = I[q + 2];
      const A = ecran(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]), B = ecran(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]), C = ecran(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
      // normale en repere d'ecran : (-x, -y, -z) ; diffuse
      let lum = 1;
      if (N) { const n = [-N[a * 3], -N[a * 3 + 1], -N[a * 3 + 2]]; lum = Math.min(1, (Math.max(0, L0[0] * n[0] + L0[1] * n[1] + L0[2] * n[2]) + Math.max(0, L1[0] * n[0] + L1[1] * n[1] + L1[2] * n[2])) * 0.6 + 0.4); }
      const aire = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (Math.abs(aire) < 1e-9) continue;
      const mx = Math.max(X0, Math.floor(Math.min(A[0], B[0], C[0]))), Mx = Math.min(X1 - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
      const my = Math.max(Y0, Math.floor(Math.min(A[1], B[1], C[1]))), My = Math.min(Y1 - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
      for (let y = my; y <= My; y++) for (let x = mx; x <= Mx; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((B[0] - px) * (C[1] - py) - (B[1] - py) * (C[0] - px)) / aire, w1 = ((C[0] - px) * (A[1] - py) - (C[1] - py) * (A[0] - px)) / aire, w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * A[2] + w1 * B[2] + w2 * C[2], zi = (y - Y0) * W + (x - X0);
        if (z <= prof[zi]) continue;   // le plus grand z est devant
        const u = w0 * U[a * 2] + w1 * U[b * 2] + w2 * U[c * 2], v = w0 * U[a * 2 + 1] + w1 * U[b * 2 + 1] + w2 * U[c * 2 + 1];
        const tx = Math.min(t.largeur - 1, Math.max(0, Math.floor(u * t.largeur))), ty = Math.min(t.hauteur - 1, Math.max(0, Math.floor(v * t.hauteur))), tk = (ty * t.largeur + tx) * 4;
        if (t.rgba[tk + 3] < 26) continue;   // decoupe : alpha < 0,1 ecarte
        prof[zi] = z;
        const k = (y * o.w + x) * 4;
        o.px[k] = Math.floor(t.rgba[tk] * lum); o.px[k + 1] = Math.floor(t.rgba[tk + 1] * lum); o.px[k + 2] = Math.floor(t.rgba[tk + 2] * lum); o.px[k + 3] = 255;
      }
    }
  }
}
