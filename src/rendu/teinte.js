// Couleurs de biome (herbe, feuillage, feuillage sec, eau) pour chaque colonne de la zone,
// comme le jeu : colormaps indexees par temperature / humidite, surcharges du biome,
// modificateurs (foret sombre, marais), puis flou de melange entre biomes voisins.
import fs from 'node:fs';
import path from 'node:path';
import { lireColormap } from './textures.js';

function couleurJson(v) {
  if (typeof v === 'string') return parseInt(v.replace('#', ''), 16) & 0xffffff;
  if (typeof v === 'number') return v & 0xffffff;
  return null;
}
function echantillon(carte, temp, pluie, defaut) {
  const t = Math.min(1, Math.max(0, temp));
  const p = Math.min(1, Math.max(0, pluie)) * t;
  const x = ((1 - t) * 255) | 0, y = ((1 - p) * 255) | 0;
  const v = carte.data[(y << 8) | x];
  return v === undefined ? defaut : v;
}
// bruit simple et stable pour le marais
function bruit(x, z) {
  let h = Math.imul(x * 73856093 ^ z * 19349663, 0x45d9f3b); h = (h ^ (h >>> 15)) >>> 0;
  return (h % 1000) / 1000;
}
function bruitLisse(x, z) {
  const fx = x * 0.0225 * 8, fz = z * 0.0225 * 8;
  const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
  const a = bruit(x0, z0), b = bruit(x0 + 1, z0), c = bruit(x0, z0 + 1), d = bruit(x0 + 1, z0 + 1);
  return ((a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz) * 2 - 1;
}

export class CouleursBiomes {
  constructor(kitDir) {
    this.kitDir = kitDir;
    this.grass = lireColormap(kitDir, 'grass');
    this.foliage = lireColormap(kitDir, 'foliage');
    let sec = null;
    try { sec = lireColormap(kitDir, 'dry_foliage'); } catch { /* absent */ }
    this.dry = sec;
    this.cache = new Map();
    this.dirBiomes = path.join(kitDir, 'data', 'minecraft', 'worldgen', 'biome');
    this.biomesAbsents = new Set();
  }

  // { herbe, feuillage, sec, eau, modificateur } pour un id de biome
  biome(id) {
    id = id.replace(/^minecraft:/, '');
    let b = this.cache.get(id);
    if (b) return b;
    let j = null;
    try { j = JSON.parse(fs.readFileSync(path.join(this.dirBiomes, id + '.json'), 'utf8')); } catch { /* absent */ }
    if (!j) { this.biomesAbsents.add(id); j = { temperature: 0.8, downfall: 0.4, effects: {} }; }
    const e = j.effects || {};
    const t = j.temperature ?? 0.5, d = j.downfall ?? 0.5;
    b = {
      id, temperature: t, downfall: d,
      herbe: couleurJson(e.grass_color) ?? echantillon(this.grass, t, d, 0x91bd59),
      feuillage: couleurJson(e.foliage_color) ?? echantillon(this.foliage, t, d, 0x48b518),
      sec: couleurJson(e.dry_foliage_color) ?? (this.dry ? echantillon(this.dry, t, d, 0x5d4930) : 0x5d4930),
      eau: couleurJson(e.water_color) ?? 0x3f76e4,
      modificateur: e.grass_color_modifier || 'none',
    };
    this.cache.set(id, b);
    return b;
  }

  // Calcule, pour chaque colonne de la zone, les 4 couleurs (Uint32 0xRRGGBB), avec flou de rayon `rayon`.
  tableaux(zone, rayon = 2) {
    const { sx, sz } = zone;
    const nb = zone.biomesNoms.map((n) => this.biome(n));
    const cols = { herbe: new Uint32Array(sx * sz), feuillage: new Uint32Array(sx * sz), sec: new Uint32Array(sx * sz), eau: new Uint32Array(sx * sz) };
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const b = nb[zone.biomes[z * sx + x]];
        let herbe = b.herbe;
        const wx = zone.x0 + x, wz = zone.z0 + z;
        if (b.modificateur === 'dark_forest') herbe = (((herbe & 0xfefefe) + 0x28340a) >> 1);
        else if (b.modificateur === 'swamp') herbe = bruitLisse(wx, wz) < -0.1 ? 0x4c763c : 0x6a7039;
        const i = z * sx + x;
        cols.herbe[i] = herbe; cols.feuillage[i] = b.feuillage; cols.sec[i] = b.sec; cols.eau[i] = b.eau;
      }
    }
    const out = {};
    for (const k of Object.keys(cols)) out[k] = flouter(cols[k], sx, sz, rayon);
    return out;
  }
}

// Moyenne en boite (separable) des canaux R,G,B d'une carte 0xRRGGBB, bords : on prolonge
function flouter(src, sx, sz, r) {
  if (r <= 0) return src;
  const tmp = new Float32Array(sx * sz * 3), out = new Uint32Array(sx * sz);
  const n = 2 * r + 1;
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      let a = 0, b = 0, c = 0;
      for (let k = -r; k <= r; k++) {
        const v = src[z * sx + Math.min(sx - 1, Math.max(0, x + k))];
        a += (v >> 16) & 255; b += (v >> 8) & 255; c += v & 255;
      }
      const o = (z * sx + x) * 3; tmp[o] = a / n; tmp[o + 1] = b / n; tmp[o + 2] = c / n;
    }
  }
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      let a = 0, b = 0, c = 0;
      for (let k = -r; k <= r; k++) {
        const o = (Math.min(sz - 1, Math.max(0, z + k)) * sx + x) * 3;
        a += tmp[o]; b += tmp[o + 1]; c += tmp[o + 2];
      }
      out[z * sx + x] = (Math.round(a / n) << 16) | (Math.round(b / n) << 8) | Math.round(c / n);
    }
  }
  return out;
}

// Teinte d'un bloc : retourne [source par tintindex]. Sources : 'herbe','feuillage','sec','eau' ou un nombre fixe.
export function sourcesTeinte(nom, props) {
  switch (nom) {
    case 'large_fern': case 'tall_grass': return ['herbe', 'herbe'];
    case 'fern': case 'short_grass': case 'potted_fern': case 'bush': return ['herbe', 'herbe'];
    case 'grass_block': case 'sugar_cane': return ['herbe', 'herbe'];
    case 'pink_petals': case 'wildflowers': return [null, 'herbe'];
    case 'spruce_leaves': return [0x619961, 0x619961];
    case 'birch_leaves': return [0x80a755, 0x80a755];
    case 'oak_leaves': case 'jungle_leaves': case 'acacia_leaves': case 'dark_oak_leaves': case 'vine': case 'mangrove_leaves': return ['feuillage', 'feuillage'];
    case 'leaf_litter': return ['sec', 'sec'];
    case 'water_cauldron': return ['eau', 'eau'];
    case 'lily_pad': return [0x208030, 0x208030];
    case 'attached_melon_stem': case 'attached_pumpkin_stem': return [0xe0c71c, 0xe0c71c];
    case 'melon_stem': case 'pumpkin_stem': {
      const age = +props.age || 0;
      const c = (((age * 32) << 16) | ((255 - age * 8) << 8) | (age * 4));
      return [c, c];
    }
    case 'redstone_wire': {
      const p = +props.power || 0, f = p / 15;
      const r = Math.round(f * 0.6 * 255 + (p > 0 ? 0.4 * 255 : 0.3 * 255) * 1), g = Math.round(Math.max(0, f * f * 0.7 - 0.5) * 255), b = Math.round(Math.max(0, f * f * 0.6 - 0.7) * 255);
      const c = (Math.min(255, r) << 16) | (g << 8) | b;
      return [c, c];
    }
    default: return null;
  }
}
