// Temperature d'un biome a une position, comme le jeu 26.3 (Biome.getHeightAdjustedTemperature, TemperatureModifier.FROZEN) avec ses bruits
// fixes : TEMPERATURE_NOISE (graine 1234, une octave), FROZEN_TEMPERATURE_NOISE (graine 3456, octaves -2, -1, 0), BIOME_INFO_NOISE (graine 2345).
// Port d'apres Horizon horizon-world/src/worldgen/biome_temperature.rs et horizon-core/src/noise/{mod,simplex,stack}.rs (MIT, voir ATTRIBUTIONS.md) :
//   - SimplexNoise 26.3 : table de 256 permutations tiree par java.util.Random, decalages tires puis mis a 0 (`with_skipped_offsets`) ;
//     valeur 2D = 70 x somme des trois coins (rayon 0,5), rendue en flottant simple ;
//   - au-dessus de seaLevel + 17 (80) : t - (bruit(x/8, z/8) x 8 + y - 80) x 0,05 / 40 (flottants simples) ;
//   - FROZEN : bruit gele (x 0,05) x 7 + info (x 0,2) < 0,3 et info (x 0,09) < 0,8 -> 0,2.
// Neige si la temperature est < 0,15 (Biome.coldEnoughToSnow), pluie sinon ; sans `has_precipitation` : rien.
import { Aleatoire } from './aleatoire.js';
const f32 = Math.fround;
const GRAD = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
const R3 = Math.sqrt(3), SKEW = 0.5 * (R3 - 1), UNSKEW = (3 - R3) / 6;

export class Simplex {
  constructor(h, decalages = false) {
    this.o = [0, 1, 2].map(() => h.reel() * (decalages ? 256 : 0));
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 0; i < 256; i++) { const j = i + h.entierBorne(256 - i); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.p = p;
  }
  perm(i) { return this.p[i & 255]; }
  static coin(g, x, y) { const a = 0.5 - x * x - y * y; if (a < 0) return 0; const s = a * a; return s * s * (GRAD[g][0] * x + GRAD[g][1] * y); }
  get2(x, y) {
    x += this.o[0]; y += this.o[1];
    const s = (x + y) * SKEW, i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * UNSKEW, dx = x - (i - t), dy = y - (j - t);
    const [a, b] = dx > dy ? [1, 0] : [0, 1];
    const ii = i & 255, jj = j & 255, g = (u, v) => this.perm(ii + u + this.perm(jj + v)) % 12;
    return f32(70 * (Simplex.coin(g(0, 0), dx, dy) + Simplex.coin(g(a, b), dx - a + UNSKEW, dy - b + UNSKEW) + Simplex.coin(g(1, 1), dx - 1 + 2 * UNSKEW, dy - 1 + 2 * UNSKEW)));
  }
}

let BRUITS = null;
function bruits() {
  if (BRUITS) return BRUITS;
  const h = new Aleatoire(3456);
  const gele = [[1, f32(1 / 7)], [0.5, f32(2 / 7)], [0.25, f32(4 / 7)]].map(([fr, am]) => ({ n: new Simplex(h), fr, am }));
  BRUITS = { hauteur: new Simplex(new Aleatoire(1234)), gele, info: new Simplex(new Aleatoire(2345)) };
  return BRUITS;
}
const geleVal = (x, z) => { let v = 0; for (const c of bruits().gele) v = f32(v + f32(c.am * c.n.get2(x * c.fr, z * c.fr))); return v; };

// b : [temperature de base, precipitation (1/0), modificateur (1 = frozen)] (donnees `biomes`) ; mer : niveau de la mer (63)
export function temperatureBiome(b, x, y, z, mer = 63) {
  let base = f32(b[0]);
  if (b[2]) {
    const gele = f32(geleVal(x * 0.05, z * 0.05) * 7), info = bruits().info.get2(x * 0.2, z * 0.2);
    if (gele + info < 0.3 && bruits().info.get2(x * 0.09, z * 0.09) < 0.8) base = f32(0.2);
  }
  const debut = mer + 17;
  if (y > debut) {
    const v = f32(bruits().hauteur.get2(f32(x / 8), f32(z / 8)) * 8);
    return f32(base - f32(f32(f32(f32(v + y) - debut) * f32(0.05)) / 40));
  }
  return base;
}
// 'pluie' | 'neige' | null (Biome.getPrecipitationAt)
export function precipitationBiome(b, x, y, z, mer = 63) {
  if (!b || !b[1]) return null;
  return temperatureBiome(b, x, y, z, mer) < 0.15 ? 'neige' : 'pluie';
}
