// Laisse (lead) : la corde du jeu entre la main de celui qui tient et le point d'attache de la creature, et le noeud sur une barriere.
// Port de LeashRenderer.renderLeash / addVertexPair (jeu) via Horizon (MIT, voir ATTRIBUTIONS.md) : 24 segments, chute en parabole
// (y = dy x f^2 si le bout est plus haut, sinon dy - dy x (1 - f)^2), deux rubans de 0,025 (l'un a plat, l'autre debout), brins de deux
// tons qui alternent (couleur 0,5 / 0,4 / 0,3 x 1 ou x 0,7 : la corde du jeu n'a pas de texture), lumiere interpolee d'un bout a l'autre.
// Points d'attache : Entity.getLeashOffset (0, yeux, largeur x 0,4 tourne du corps), Player.getRopeHoldPosition (main : -0,22 a droite,
// hauteur de la boite - 1, 0,07 devant), Entity.getRopeHoldPosition (yeux x 0,7), noeud de barriere (bloc + 0,5 / 0,375 / 0,5, corde a +0,2).
import { textureEntite } from './rendu.js';

const RAD = Math.PI / 180;
// Vec3.yRot(a) : x cos a + z sin a, z cos a - x sin a
const yRot = (v, a) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], v[2] * Math.cos(a) - v[0] * Math.sin(a)];
// Mob.getLeashOffset et ses surcharges (Horizon mobs/leash.rs leash_offset) : [part des yeux, part de la largeur devant]
const OFFSETS = { llama: [0.75, 0.5], trader_llama: [0.75, 0.5], wolf: [0.6, 0.4], allay: [0.6, 0.1], bee: [0.5, 0.2], iron_golem: [0.875, 0.4], snow_golem: [0.75, 0.4], copper_golem: [0.75, 0], fox: [0.55, 0.4], pig: [0.6, 0.4], rabbit: [0.6, 0.4], strider: [0.6, 0.4], parrot: [0.5, 0.4], ocelot: [0.5, 0.4], happy_ghast: [0, 0] };
export const attacheCreature = (p, oeil, largeur, type = null) => { const [ky, kz] = OFFSETS[type] ?? [1, 0.4]; const o = yRot([0, oeil * ky, largeur * kz], -(p.lacet ?? 0) * RAD); return [p.x + o[0], p.y + (p.dy ?? 0) + o[1], p.z + o[2]]; };
export const mainJoueur = (p, gaucher = false) => { const o = yRot([0.22 * (gaucher ? 1 : -1), (p.accroupi ? 1.5 : 1.8) - 1, p.accroupi ? -0.2 : 0.07], -(p.lacet ?? 0) * RAD); return [p.x + o[0], p.y + (p.dy ?? 0) + o[1], p.z + o[2]]; };
export const tenueCreature = (p, oeil) => [p.x, p.y + (p.dy ?? 0) + oeil * 0.7, p.z];
export const noeudBarriere = (b) => [b[0] + 0.5, b[1] + 0.375 + 0.2, b[2] + 0.5];

const BLANC = { largeur: 1, hauteur: 1, rgba: new Uint8Array([255, 255, 255, 255]) };
// corde de `de` (creature tenue) a `vers` (main, noeud) ; lumDe / lumVers : lumiere 0..1 des deux bouts
export function maillageCorde(de, vers, lumDe = 1, lumVers = 1) {
  const dx = vers[0] - de[0], dy = vers[1] - de[1], dz = vers[2] - de[2], N = 24;
  const k = (1 / Math.max(1e-6, Math.hypot(dx, dz))) * 0.025 / 2, ox = dz * k, oz = dx * k;
  const pts = [];   // deux rubans : [hauteur du premier sommet, hauteur du second] (largeur 0,025)
  for (const [larg, decY] of [[0.025, 0.025], [0.025, 0]]) {
    const ruban = [];
    for (let i = 0; i <= N; i++) {
      const f = i / N, y = dy > 0 ? dy * f * f : dy - dy * (1 - f) * (1 - f);
      const x = dx * f, z = dz * f, ton = i % 2 === (decY === 0 ? 1 : 0) ? 0.7 : 1.0, L = lumDe + (lumVers - lumDe) * f;
      ruban.push({ a: [de[0] + x - ox, de[1] + y + decY, de[2] + z + oz], b: [de[0] + x + ox, de[1] + y + larg - decY, de[2] + z - oz], c: [0.5 * ton * L, 0.4 * ton * L, 0.3 * ton * L] });
    }
    pts.push(ruban);
  }
  const nQ = N * 2, positions = new Float32Array(nQ * 12), uvs = new Float32Array(nQ * 8), couleurs = new Float32Array(nQ * 12), indices = new Uint32Array(nQ * 6);
  let q = 0;
  for (const r of pts) for (let i = 0; i < N; i++) {
    const s = [r[i].a, r[i].b, r[i + 1].b, r[i + 1].a], cs = [r[i].c, r[i].c, r[i].c, r[i].c];   // le brin garde la couleur de son debut (bandes du jeu)
    for (let v = 0; v < 4; v++) { positions.set(s[v], (q * 4 + v) * 3); couleurs.set(cs[v], (q * 4 + v) * 3); uvs.set([0.5, 0.5], (q * 4 + v) * 2); }
    const v0 = q * 4; indices.set([v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3], q * 6); q++;
  }
  return { positions, uvs, couleurs, indices, texture: BLANC, mode: 'decoupe', deuxFaces: true, genre: 'creature' };
}

// noeud de laisse sur une barriere (LeashKnotModel : cube 6 x 8 x 6, texture entity/lead_knot 32 x 32, de y + 0,375 a y + 0,875)
export function maillageNoeud(kitDir, b, lum = 1) {
  const t = kitDir ? textureEntite(kitDir, 'lead_knot') : null;
  if (!t) return null;
  const x0 = b[0] + 0.5 - 3 / 16, x1 = b[0] + 0.5 + 3 / 16, y0 = b[1] + 0.375, y1 = b[1] + 0.875, z0 = b[2] + 0.5 - 3 / 16, z1 = b[2] + 0.5 + 3 / 16;
  const W = 32, U = (u) => u / W;
  // depliage du cube du jeu (texOffs 0,0, d = 6, w = 6, h = 8) : dessus, dessous, puis cote est, nord, ouest, sud
  const faces = [
    [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [6, 0, 12, 6], 1],
    [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], [12, 0, 18, 6], 0.5],
    [[x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [0, 6, 6, 14], 0.6],
    [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [6, 6, 12, 14], 0.8],
    [[x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [12, 6, 18, 14], 0.6],
    [[x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [18, 6, 24, 14], 0.8],
  ];
  const positions = new Float32Array(72), uvs = new Float32Array(48), couleurs = new Float32Array(72), indices = new Uint32Array(36);
  faces.forEach(([a, bb, c, d, [u0, v0, u1, v1], o], q) => {
    [a, bb, c, d].forEach((p, v) => { positions.set(p, (q * 4 + v) * 3); couleurs.set([o * lum, o * lum, o * lum], (q * 4 + v) * 3); });
    uvs.set([U(u0), U(v0), U(u1), U(v0), U(u1), U(v1), U(u0), U(v1)], q * 8);
    indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
  });
  return { positions, uvs, couleurs, indices, texture: t, mode: 'decoupe', deuxFaces: true, genre: 'creature' };
}
