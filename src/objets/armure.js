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
import { lireJson, texture } from './fichiers.js';

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

// ---------------------------------------------------------------- materiaux et textures
// "diamond", "golden" (ou "gold"), "turtle", "minecraft:iron_helmet", "diamond_boots"... -> nom de l'equipement du kit (equipment/<nom>.json).
const ALIAS = { golden: 'gold', turtle: 'turtle_scute' };
export function nomMateriau(texte) {
  let n = String(texte ?? '').trim().toLowerCase().replace(/^minecraft:/, '');
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
