// Lecture des fichiers du jeu dont les objets et l'armure ont besoin, dans le kit (groupes a la demande `objets` et `armures`).
// Rien n'est ecrit : le kit est en lecture seule. Les PNG decodes sont gardes (par kit et par nom).
import fs from 'node:fs';
import path from 'node:path';
import { decoderPNG } from '../rendu/png.js';

const RACINE = (kit) => path.join(kit, 'assets', 'minecraft');
const nettoyer = (nom) => String(nom).replace(/^minecraft:/, '');

export function lireJson(kit, rel) {
  try { return JSON.parse(fs.readFileSync(path.join(RACINE(kit), ...rel.split('/')), 'utf8')); } catch { return null; }
}

// Les groupes sont-ils dans ce kit ? (dossier items/ pour `objets`, equipment/ pour `armures`)
export const groupePresent = (kit, groupe) => fs.existsSync(path.join(RACINE(kit), groupe === 'objets' ? 'items' : 'equipment'));

// Identifiants d'objets du kit (noms de items/*.json), tries.
const listes = new Map();
export function listeObjets(kit) {
  if (!listes.has(kit)) {
    let l = [];
    try { l = fs.readdirSync(path.join(RACINE(kit), 'items')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort(); } catch { /* groupe absent */ }
    listes.set(kit, l);
  }
  return listes.get(kit);
}

// Texture du jeu : nom 'item/cod', 'block/torch', 'entity/equipment/humanoid/iron' (avec ou sans 'minecraft:').
// Retourne { largeur, hauteur, rgba } ou null. Une texture animee (.mcmeta) : la premiere image seulement.
const textures = new Map();
export function texture(kit, nom) {
  nom = nettoyer(nom);
  const cle = kit + '|' + nom;
  if (textures.has(cle)) return textures.get(cle);
  let t = null;
  const f = path.join(RACINE(kit), 'textures', ...nom.split('/')) + '.png';
  try {
    const im = decoderPNG(fs.readFileSync(f));
    t = { largeur: im.largeur, hauteur: im.hauteur, rgba: new Uint8Array(im.rgba) };
    try {
      const a = JSON.parse(fs.readFileSync(f + '.mcmeta', 'utf8')).animation;
      if (a) {
        const fh = a.height || a.width || im.largeur;
        if (fh < im.hauteur) t = { largeur: im.largeur, hauteur: fh, rgba: t.rgba.slice(0, im.largeur * fh * 4) };
      }
    } catch { /* pas de mcmeta ou illisible : pas anime */ }
  } catch { /* absente ou illisible */ }
  if (!t) t = permutation(kit, nom);
  textures.set(cle, t);
  return t;
}

// Texture produite par l'atlas des objets (atlases/items.json, source `paletted_permutations`) : `trims/items/chestplate_trim_gold` = la
// texture `trims/items/chestplate_trim` dont chaque couleur de la palette cle (palettes/trim_base) est remplacee par la couleur de meme rang
// de la palette de la permutation (palettes/trim/gold). Lu dans le kit, rien n'est recopie (docs/SIMULATION.md partie 29).
function permutation(kit, nom) {
  const atlas = lireJson(kit, 'atlases/items.json');
  for (const s of atlas?.sources ?? []) {
    if (nettoyer(s.type ?? '') !== 'paletted_permutations') continue;
    for (const base of (s.textures ?? []).map(nettoyer)) {
      if (!nom.startsWith(base + '_')) continue;
      const cleP = nom.slice(base.length + 1), pal = s.permutations?.[cleP];
      if (!pal) continue;
      return recolorer(texture(kit, base), texture(kit, 'palettes/' + nettoyer(s.palette_key)), texture(kit, 'palettes/' + nettoyer(pal)));
    }
  }
  return null;
}
// PalettedPermutations : couleur de la palette cle -> couleur de meme rang (l'alpha de la texture est garde ; une couleur absente reste)
export function recolorer(t, cle, pal) {
  if (!t || !cle || !pal) return null;
  const table = new Map();
  for (let i = 0; i < Math.min(cle.rgba.length, pal.rgba.length); i += 4) table.set((cle.rgba[i] << 16) | (cle.rgba[i + 1] << 8) | cle.rgba[i + 2], i);
  const rgba = new Uint8Array(t.rgba);
  for (let i = 0; i < rgba.length; i += 4) {
    if (!rgba[i + 3]) continue;
    const k = table.get((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
    if (k === undefined) continue;
    rgba[i] = pal.rgba[k]; rgba[i + 1] = pal.rgba[k + 1]; rgba[i + 2] = pal.rgba[k + 2];
    rgba[i + 3] = Math.round(rgba[i + 3] * pal.rgba[k + 3] / 255);
  }
  return { largeur: t.largeur, hauteur: t.hauteur, rgba };
}

// Copie de `t` multipliee par la couleur ARGB entiere `argb` (comme les teintes du jeu) ; null : `t` telle quelle.
export function teinter(t, argb) {
  if (argb === null || argb === undefined) return t;
  const r = (argb >> 16) & 255, g = (argb >> 8) & 255, b = argb & 255;
  if (r === 255 && g === 255 && b === 255) return t;
  const rgba = new Uint8Array(t.rgba);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = Math.round(rgba[i] * r / 255); rgba[i + 1] = Math.round(rgba[i + 1] * g / 255); rgba[i + 2] = Math.round(rgba[i + 2] * b / 255); }
  return { largeur: t.largeur, hauteur: t.hauteur, rgba };
}

// Texture de remplacement quand un fichier manque : damier violet et noir du jeu (16x16).
export function textureManquante() {
  const rgba = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = ((x >> 3) + (y >> 3)) & 1, o = (y * 16 + x) * 4;
    rgba[o] = v ? 248 : 0; rgba[o + 1] = 0; rgba[o + 2] = v ? 248 : 0; rgba[o + 3] = 255;
  }
  return { largeur: 16, hauteur: 16, rgba };
}
