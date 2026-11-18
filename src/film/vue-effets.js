// Ce que Cecite et Nausee font a la vue de l'acteur que la camera suit (docs/SIMULATION.md partie 26 ; liste `visions` du replay, ecrite par
// moteur/effets.js). Valeurs de FogRenderer.BlindnessFogFunction, LocalPlayer.handleConfusionTransitionEffect et GameRenderer (jeu 26.3, relues
// dans le code de Minecraft que Horizon porte ; MIT, voir ATTRIBUTIONS.md) :
//   - Cecite : la brume se ferme : fin = lerp(min(1, duree restante / 20), distance de vue, 5), debut = fin x 0,25 ; ciel et brume noirs ;
//   - Nausee : intensite +0,006667 par tick tant que l'effet a plus de 60 ticks, -0,05 sinon ; image deformee : rotation d'angle
//     (tick + partiel) x 7 degres autour de l'axe (0 ; 0,7071 ; 0,7071) de la vue, etirement de 1 / f2 en x, rotation inverse, avec
//     f2 = (5 / (i^2 + 5) - i x 0,04)^2 (echelle des effets d'ecran 1). La transformation est lineaire en vue : l'image se refait sans profondeur.
export function creerVueEffets({ scene, replay }) {
  const L = (replay?.visions ?? []).filter((v) => v.effet === 'blindness' || v.effet === 'nausea');
  if (!L.length) return null;
  const suit = typeof scene.camera?.suit === 'string' ? scene.camera.suit : scene.acteurs.find((a) => !a.creature)?.nom ?? null;
  const ral = replay.ralenti || 1;
  const fin = Math.max(...L.map((v) => v.fin)) + 40;
  // intensite de la nausee tick par tick
  const nau = new Float32Array(fin + 2);
  let i = 0;
  for (let k = 0; k <= fin; k++) {
    const e = L.find((v) => v.effet === 'nausea' && v.acteur === suit && k >= v.debut && k < v.fin);
    i = e && e.fin - k > 60 ? Math.min(1, i + 0.006666667) : Math.max(0, i - 0.05);
    nau[k] = i;
  }
  return (tm) => {
    const u = tm * 20 * ral, k = Math.max(0, Math.floor(u)), p = u - k;
    const b = L.find((v) => v.effet === 'blindness' && v.acteur === suit && u >= v.debut && u < v.fin);
    const ni = k < nau.length - 1 ? nau[k] + (nau[k + 1] - nau[k]) * p : 0;
    if (!b && ni <= 0) return null;
    const r = {};
    if (b) { const reste = (b.fin - u) / 20; const finBrume = 5 + (128 - 5) * (1 - Math.min(1, reste)); r.brume = { debut: finBrume * 0.25, fin: finBrume, couleur: [0, 0, 0] }; r.ciel = { zenith: [0, 0, 0], horizon: [0, 0, 0], bas: [0, 0, 0] }; r.soleil = false; r.cielFixe = true; }
    if (ni > 0) r.nausee = { intensite: ni, angle: (u) * 7 * Math.PI / 180 };
    return r;
  };
}

// Deformation de la Nausee sur l'image rendue (RGBA), fovY en degres : chaque pixel de sortie relit l'image d'origine le long du rayon M^-1 d
export function deformerNausee(rgba, w, h, fovY, { intensite, angle }) {
  let f2 = 5 / (intensite * intensite + 5) - intensite * 0.04; f2 *= f2;
  const ax = [0, Math.SQRT1_2, Math.SQRT1_2];
  const rot = (t) => { const c = Math.cos(t), s = Math.sin(t), C = 1 - c, [x, y, z] = ax; return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]]; };
  const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  // M = R(a) . S(1/f2, 1, 1) . R(-a) ; inverse : R(a) . S(f2, 1, 1) . R(-a)
  const Minv = mul(mul(rot(angle), [[f2, 0, 0], [0, 1, 0], [0, 0, 1]]), rot(-angle));
  const ty = Math.tan(fovY * Math.PI / 360), tx = ty * w / h;
  const src = rgba.slice();
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const d = [((px + 0.5) / w * 2 - 1) * tx, (1 - (py + 0.5) / h * 2) * ty, -1];
    const o = [0, 1, 2].map((r) => Minv[r][0] * d[0] + Minv[r][1] * d[1] + Minv[r][2] * d[2]);
    if (o[2] >= -1e-6) continue;
    const sx = Math.floor(((o[0] / -o[2]) / tx + 1) / 2 * w), sy = Math.floor((1 - (o[1] / -o[2]) / ty) / 2 * h);
    const k = (py * w + px) * 4;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) { rgba[k] = 0; rgba[k + 1] = 0; rgba[k + 2] = 0; continue; }
    const s = (sy * w + sx) * 4;
    rgba[k] = src[s]; rgba[k + 1] = src[s + 1]; rgba[k + 2] = src[s + 2]; rgba[k + 3] = src[s + 3];
  }
}
