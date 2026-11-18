// Armure portee : couches de modele separees (casque, plastron, jambieres, bottes) autour du corps, avec les textures d'equipement du jeu.
//
// GEOMETRIE : table PROPRE a ce projet (PIECES ci-dessous), faite avec les NOMBRES de la couche d'armure du joueur releves dans les donnees
// de modeles preparees du jeu (entity-models.json du client Horizon, `minecraft:player#helmet|chestplate|leggings|boots`, lecture seule ; le
// proprietaire a autorise l'usage de la geometrie du jeu) : boites, gonflements, decalages de texture. Voir ATTRIBUTIONS.md.
//   - casque : tete gonflee de 1,0 et chapeau de 1,5 (texture en (0,0) et (32,0)) ; plastron : tronc 1,0 et deux bras 1,0 ;
//     jambieres : tronc 0,5 et deux jambes 0,4 ; bottes : deux jambes 0,9 ; textures de 64x32 (tronc en (16,16), bras en (40,16), jambes en (0,16)) ;
//   - le bras gauche et la jambe gauche reprennent la texture du droit, en miroir (le modele est le droit, retourne en x) ;
//   - l'armure utilise TOUJOURS le bras large (4 px + gonflement), meme sur un skin a bras fins : verifie dans `player_slim#chestplate`.
// Les membres sont coupes au coude et au genou comme le corps (perso/modele.js, ajouterMembreScinde), donc l'armure plie avec eux.
// NOMS DE MATERIAUX et teinte du cuir : Horizon, horizon-client/src/mobs/render.rs `humanoid_armor` (lignes 1007-1064).
import fs from 'node:fs';
import path from 'node:path';
import * as M from '../perso/modele.js';
import { lireJson, texture, recolorer } from './fichiers.js';
import { TEINTURES, couleurTeinture } from '../creatures/especes.js';

// part (ip) : 0 tete, 1 corps, 2 brasD, 3 brasG, 4 jambeD, 5 jambeG (perso/modele.js). j : index de membre articule (0 brasD, 1 brasG, 2 jambeD, 3 jambeG).
const BRAS = { orig: [-3, -2, -2], taille: [4, 12, 4], uv: [40, 16] };
const JAMBE = { orig: [-2, 0, -2], taille: [4, 12, 4], uv: [0, 16] };
const TRONC = { orig: [-4, 0, -2], taille: [8, 12, 4], uv: [16, 16] };
const TETE = { orig: [-4, -8, -4], taille: [8, 8, 8] };
export const PIECES = {
  tete: { couche: 'humanoid', parties: [{ ip: 0, ...TETE, uv: [0, 0], g: 1.0 }, { ip: 0, ...TETE, uv: [32, 0], g: 1.5 }] },
  torse: { couche: 'humanoid', parties: [{ ip: 1, ...TRONC, g: 1.0 }, { ip: 2, j: 0, ...BRAS, g: 1.0 }, { ip: 3, j: 1, ...BRAS, g: 1.0, miroir: true }] },
  jambes: { couche: 'humanoid_leggings', parties: [{ ip: 1, ...TRONC, g: 0.5 }, { ip: 4, j: 2, ...JAMBE, g: 0.4 }, { ip: 5, j: 3, ...JAMBE, g: 0.4, miroir: true }] },
  pieds: { couche: 'humanoid', parties: [{ ip: 4, j: 2, ...JAMBE, g: 0.9 }, { ip: 5, j: 3, ...JAMBE, g: 0.9, miroir: true }] },
};
export const EMPLACEMENTS = Object.keys(PIECES);   // tete torse jambes pieds

// ---------------------------------------------------------------- geometrie (cache par emplacement et par membres plies)
const geoms = new Map();
export function geometrie(emplacement, bitsFlexion) {
  const bits = PIECES[emplacement].parties.reduce((b, p) => (p.j !== undefined ? b | (bitsFlexion & (1 << p.j)) : b), 0);
  const cle = `${emplacement}|${bits}`;
  if (geoms.has(cle)) return geoms.get(cle);
  const R = new M.Reservoir();
  for (const p of PIECES[emplacement].parties) {
    const v0 = R.part.length, i0 = R.idx.length;
    if (p.j !== undefined && (bits >> p.j) & 1) M.ajouterMembreScinde(R, p.j, { orig: p.orig, taille: p.taille, ext: { uv: p.uv, g: p.g } }, 1);
    else {
      const min = p.orig.map((c) => c - p.g), max = p.orig.map((c, i) => c + p.taille[i] + p.g);
      for (const f of M.facesBoite(p.uv, p.taille, min, max)) M.ajouterFace(R, p.ip, f, min, max);
    }
    if (p.miroir) {   // le membre gauche : le droit retourne en x (la texture reste celle du droit, donc elle apparait en miroir)
      for (let v = v0; v < R.part.length; v++) { R.local[v * 3] = -R.local[v * 3]; R.norm[v * 3] = -R.norm[v * 3]; }
      for (let k = i0; k < R.idx.length; k += 3) { const t = R.idx[k + 1]; R.idx[k + 1] = R.idx[k + 2]; R.idx[k + 2] = t; }
    }
  }
  const g = { local: Float32Array.from(R.local), normales: Float32Array.from(R.norm), partie: Uint8Array.from(R.part), uvs: Float32Array.from(R.uv), indices: Uint32Array.from(R.idx) };
  geoms.set(cle, g);
  return g;
}

// ---------------------------------------------------------------- elytres (WingsLayer + ElytraModel)
// Geometrie relevee dans entity-models.json du jeu 26.3 (`minecraft:elytra#main`, lecture seule ; test/elytres.test.js la compare au fichier
// quand il est sur le poste) : aile gauche texOffs(22, 0), boite (-10, 0, 0) de 10 x 20 x 2 gonflee de 1, pivot (5, 0, 0), repos
// (pi/12, 0, -pi/12) ; aile droite : la gauche en miroir (pivot -5). Texture entity/equipment/wings/elytra (64 x 32, equipment/elytra.json).
// Les deux ailes sont dans le repere du MODELE (pas du tronc) : WingsLayer les decale de 0,125 bloc vers l'arriere ; accroupi : y = 3.
export const AILE = { orig: [-10, 0, 0], taille: [10, 20, 2], uv: [22, 0], g: 1.0, pivot: 5 };
let geomAiles = null;
// partie 0 : aile gauche, 1 : aile droite (indices a recaler sur les matrices ajoutees)
export function geometrieAiles() {
  if (geomAiles) return geomAiles;
  const R = new M.Reservoir();
  for (const cote of [0, 1]) {
    const v0 = R.part.length, i0 = R.idx.length, p = AILE;
    const min = p.orig.map((c) => c - p.g), max = p.orig.map((c, i) => c + p.taille[i] + p.g);
    for (const f of M.facesBoite(p.uv, p.taille, min, max)) M.ajouterFace(R, cote, f, min, max);
    if (cote === 1) {   // mirror() : la gauche retournee en x
      for (let v = v0; v < R.part.length; v++) { R.local[v * 3] = -R.local[v * 3]; R.norm[v * 3] = -R.norm[v * 3]; }
      for (let k = i0; k < R.idx.length; k += 3) { const t = R.idx[k + 1]; R.idx[k + 1] = R.idx[k + 2]; R.idx[k + 2] = t; }
    }
  }
  geomAiles = { local: Float32Array.from(R.local), normales: Float32Array.from(R.norm), partie: Uint8Array.from(R.part), uvs: Float32Array.from(R.uv), indices: Uint32Array.from(R.idx) };
  return geomAiles;
}
// Matrices des deux ailes (repere du modele : R, t en blocs) pour les angles [xRot, yRot, zRot] (ModelPart : Rz . Ry . Rx)
export function matricesAiles(ang, accroupi = false) {
  const y = accroupi ? 3 : 0;
  return [1, -1].map((s) => ({ R: M.rotZYX(ang[0], s * ang[1], s * ang[2]), t: [s * AILE.pivot / 16, y / 16, 0.125] }));
}
export const estElytresArmure = (texte) => nomMateriau(texte) === 'elytra';

// ---------------------------------------------------------------- materiaux et textures
// "diamond", "golden" (ou "gold"), "turtle", "minecraft:iron_helmet", "diamond_boots"... -> nom de l'equipement du kit (equipment/<nom>.json).
const ALIAS = { golden: 'gold', turtle: 'turtle_scute' };
// Cuir teint (composant dyed_color) : "leather_chestplate#3A6FD8" (couleur) ou "leather_chestplate#red" (une teinture : DyedItemColor.applyDyes
// d'une seule teinture sur un cuir neuf donne la couleur diffuse de la teinture, DyeColor.textureDiffuseColor). Rend 0xRRGGBB ou null.
export function couleurArmure(texte) {
  const m = /#([0-9a-fA-F]{6}|[a-z_]+)\s*$/.exec(String(texte ?? ''));
  if (!m) return null;
  if (/^[0-9a-fA-F]{6}$/.test(m[1])) return parseInt(m[1], 16);
  const i = TEINTURES.indexOf(m[1]);
  if (i < 0) return null;
  const c = couleurTeinture(i);
  return (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
}
export const couleurArmureValide = (texte) => !/#/.test(String(texte ?? '')) || couleurArmure(texte) !== null;
export function nomMateriau(texte) {
  let n = String(texte ?? '').trim().toLowerCase().replace(/^minecraft:/, '').replace(/#.*$/, '');
  n = n.replace(/_(helmet|chestplate|leggings|boots)$/, '');
  if (!/^[a-z0-9_]{1,30}$/.test(n)) return null;
  return ALIAS[n] ?? n;
}

// Materiaux d'armure humanoide du kit : { nom: { couches: Set } } (equipment/*.json qui ont une couche `humanoid`).
export function materiauxDuKit(kit) {
  let l = [];
  try { l = fs.readdirSync(path.join(kit, 'assets', 'minecraft', 'equipment')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch { /* groupe absent */ }
  return l.filter((n) => lireJson(kit, `equipment/${n}.json`)?.layers?.humanoid).sort();
}

// Galon d'armure (composant minecraft:trim ; docs/SIMULATION.md partie 29) : texture du motif (trims/entity/<couche>/<asset_id du
// trim_pattern>) recoloree de la palette cle (le `base_palette` de son .mcmeta : palettes/trim_base) vers la palette du materiau (palette_id du
// trim_material, ou celle de `trim_overrides` de l'equipement quand le galon est du meme materiau : or sur or -> gold_darker). Rend la
// texture (meme taille que la couche d'armure) ou null. Tout est lu dans le kit (EquipmentLayerRenderer, TrimTextureKey).
const lireData = (kit, rel) => { try { return JSON.parse(fs.readFileSync(path.join(kit, 'data', 'minecraft', ...rel.split('/')), 'utf8')); } catch { return null; } };
const court = (s) => String(s ?? '').replace(/^minecraft:/, '');
export function textureGalon(kit, materiau, emplacement, motif, garniture) {
  if (!motif || !garniture) return null;
  const pat = lireData(kit, `trim_pattern/${motif}.json`), mat = lireData(kit, `trim_material/${garniture}.json`);
  const asset = court(pat?.asset_id ?? motif);
  let palette = court(mat?.palette_id ?? `trim/${garniture}`);
  for (const o of lireJson(kit, `equipment/${materiau}.json`)?.trim_overrides ?? []) if (court(o?.when?.material) === garniture && o.palette) palette = court(o.palette);
  const nom = `trims/entity/${PIECES[emplacement].couche}/${asset}`;
  const base = lireJson(kit, `textures/${nom}.png.mcmeta`)?.palette?.base_palette ?? 'trim_base';
  return recolorer(texture(kit, nom), texture(kit, 'palettes/' + court(base)), texture(kit, 'palettes/' + palette));
}

// Couches de texture d'un materiau pour un emplacement : [{ nom ('entity/equipment/humanoid/iron'), teinte (ARGB ou null) }] ou null (inconnu).
// Defini par assets/minecraft/equipment/<nom>.json ; le cuir est teinte par sa couleur sans teinture (-6265536 = 0xA06540) et a un calque `overlay` non teinte.
export function couchesTexture(kit, materiau, emplacement) {
  const def = lireJson(kit, `equipment/${materiau}.json`);
  const liste = def?.layers?.[PIECES[emplacement].couche];
  if (!Array.isArray(liste) || !liste.length) return null;
  const sortie = [];
  for (const c of liste) {
    if (typeof c?.texture !== 'string') continue;
    const nom = `entity/equipment/${PIECES[emplacement].couche}/${c.texture.replace(/^minecraft:/, '')}`;
    if (!texture(kit, nom)) continue;
    sortie.push({ nom, teinte: c.dyeable && Number.isInteger(c.dyeable.color_when_undyed) ? c.dyeable.color_when_undyed | 0 : null });
  }
  return sortie.length ? sortie : null;
}
