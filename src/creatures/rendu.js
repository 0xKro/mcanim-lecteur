// Rendu d'une creature (champ d'acteur `type`) : couches du modele du jeu (creatures-1.json.gz) avec leurs textures (kit, groupe `entites`),
// pose de chaque partie par l'animation (anim.js), chaine de matrices du jeu -> maillages dynamiques du rendu (un par couche).
// Chaine (LivingEntityRenderer.submit + setupRotations, ModelPart.translateAndRotate) portee de Horizon (client/mobs/render.rs, MIT),
// voir ATTRIBUTIONS.md :
//   monde = T(pos) . Ry(180 - lacet) . [mort, golem] . S(-1, -1, 1) . echelle du type . T(0, -1,501, 0) . partie...
//   partie = parent . T(p.xyz / 16) . Rz . Ry . Rx . S(p.echelle) ; sommets (px) / 16.
// Bateaux et wagonnets (AbstractBoatRenderer, AbstractMinecartRenderer) : T(pos + 0,375 y) . Ry(180 - lacet) . S(-1, -1, 1) . Ry(90).
import fs from 'node:fs';
import path from 'node:path';
import { decoderPNG } from '../rendu/png.js';
import { ombre } from '../perso/modele.js';
import { ESPECES, VEHICULES, TEINTURES, TYPES_VILLAGEOIS, METIERS, NIVEAUX, couleurTeinture, couleurLaine, lireVariante, rgb } from './especes.js';
import { Poses } from './poses.js';
import { poser, animerNommee } from './anim.js';
import { maillageCorde, maillageNoeud } from './laisse.js';
import { objetPourNotes } from '../objets/habillage.js';
import { matriceAffichage } from '../objets/placement.js';
import { cuire as cuireBloc, afficheDe } from '../objets/modele-objet.js';
import { texture as textureObjet, teinter } from '../objets/fichiers.js';
import { resoudreObjet } from '../objets/definition.js';

const RAD = Math.PI / 180;
// ---------------------------------------------------------------- matrices 4x4 (ligne par ligne)
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function mul(A, B) {
  const M = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) M[i * 4 + j] = A[i * 4] * B[j] + A[i * 4 + 1] * B[4 + j] + A[i * 4 + 2] * B[8 + j] + A[i * 4 + 3] * B[12 + j];
  return M;
}
export const T = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
export const S = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
export const RX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; };
export const RY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]; };
export const RZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
// ModelPart.translateAndRotate puis l'echelle : p = [x, y, z, rx, ry, rz, sx, sy, sz]
export function matricePartie(parent, p) {
  let M = mul(parent, T(p[0] / 16, p[1] / 16, p[2] / 16));
  M = mul(M, mul(RZ(p[5]), mul(RY(p[4]), RX(p[3]))));
  return (p[6] === 1 && p[7] === 1 && p[8] === 1) ? M : mul(M, S(p[6], p[7], p[8]));
}

// ---------------------------------------------------------------- arbre de parties a plat (ordre en profondeur) : nom, parent, quads
const POSE0 = [0, 0, 0, 0, 0, 0, 1, 1, 1];
function aplatir(racine) {
  const noeuds = [];
  const marche = (p, nom, parent) => {
    const i = noeuds.length;
    const base = POSE0.slice(); (p.p ?? []).forEach((v, k) => { base[k] = v; });
    noeuds.push({ nom, parent, base, q: p.q ?? null });
    for (const k of Object.keys(p.c ?? {}).sort()) marche(p.c[k], k, i);
  };
  // une racine qui contient une partie "root" lui laisse son nom (model.rs, Part::parse)
  marche(racine, racine.c && racine.c.root ? '' : 'root', -1);
  return noeuds;
}

// ---------------------------------------------------------------- textures du kit (cache par chemin)
const cacheTex = new Map();
export function textureEntite(kitDir, chemin) {
  const f = path.join(kitDir, 'assets', 'minecraft', 'textures', 'entity', ...chemin.split('/')) + '.png';
  const cle = f;
  if (cacheTex.has(cle)) return cacheTex.get(cle);
  let t = null;
  if (fs.existsSync(f)) { const im = decoderPNG(fs.readFileSync(f)); t = { largeur: im.largeur, hauteur: im.hauteur, rgba: im.rgba }; }
  cacheTex.set(cle, t);
  return t;
}
const existe = (kitDir, chemin) => !!kitDir && fs.existsSync(path.join(kitDir, 'assets', 'minecraft', 'textures', 'entity', ...chemin.split('/')) + '.png');
// texture decalee en u (couche qui defile : charge du creeper, vent du breeze) ; le rendu clampe les UV, on decale donc les pixels
function textureDecalee(t, du) {
  const k = ((Math.round(du * t.largeur) % t.largeur) + t.largeur) % t.largeur;
  t._dec ??= new Map();
  if (t._dec.has(k)) return t._dec.get(k);
  const rgba = new Uint8Array(t.rgba.length), L = t.largeur;
  for (let y = 0; y < t.hauteur; y++) for (let x = 0; x < L; x++) { const s = (y * L + ((x + k) % L)) * 4, d = (y * L + x) * 4; rgba[d] = t.rgba[s]; rgba[d + 1] = t.rgba[s + 1]; rgba[d + 2] = t.rgba[s + 2]; rgba[d + 3] = t.rgba[s + 3]; }
  const r = { largeur: L, hauteur: t.hauteur, rgba };
  t._dec.set(k, r);
  return r;
}

// ---------------------------------------------------------------- couches d'un type (render.rs body + layers)
// o : { type, bebe, variante (texte), taille, charge, selle, armureCheval, colle (teinture), coffre, tondu, armure: {tete, torse, jambes, pieds} }
// Retourne { couches: [{ modele, couche, texture, teinte, mode, emissif, defile, cacher: [noms] }], notes, echelleBebe }
const MATERIAU_ARMURE = { golden: 'gold', turtle: 'turtle_scute' };
export function couchesDe(o, modeles, kitDir) {
  const type = o.type, e = ESPECES[type];
  if (!e) throw new Error(`type de creature inconnu : ${type}`);
  const v = lireVariante(type, o.variante);
  if (v.erreur) throw new Error(v.erreur);
  const ch = v.choix, bebe = !!o.bebe, notes = [];
  const blanc = [1, 1, 1];
  const nomModele = (base) => (bebe && modeles[base + '_baby'] ? base + '_baby' : base);
  let echelleBebe = 1;
  const b = (t) => (bebe && existe(kitDir, t + '_baby') ? t + '_baby' : t);
  let modele = e[0], tex = e[1];
  const couches = [];
  const ajoute = (m, couche, texture, teinte = blanc, x = {}) => couches.push({ modele: m, couche, texture, teinte, mode: 'decoupe', ...x });
  const corps = (m, t, x = {}) => { modele = m; tex = t; Object.assign(corpsEnPlus, x); };
  const corpsEnPlus = {};
  const climat = ch[0];
  switch (type) {
    case 'cow': corps(bebe ? (climat === 'temperate' ? 'cow_baby' : `${climat}_cow_baby`) : (climat === 'temperate' ? 'cow' : `${climat}_cow`), b(`cow/cow_${climat}`)); break;
    case 'pig': corps(bebe ? 'pig_baby' : climat === 'cold' ? 'cold_pig' : 'pig', b(`pig/pig_${climat}`)); break;
    case 'chicken': corps(bebe ? 'chicken_baby' : climat === 'cold' ? 'cold_chicken' : 'chicken', b(`chicken/chicken_${climat}`)); break;
    case 'mooshroom': corps(nomModele('mooshroom'), b(`cow/mooshroom_${ch[0]}`)); break;
    case 'frog': corps('frog', `frog/frog_${ch[0]}`); break;
    case 'cat': corps(nomModele('cat'), b(`cat/cat_${ch[0]}`)); break;
    case 'wolf': {
      const etat = o.colle !== undefined && o.colle !== null ? '_tame' : ch[1] === 'angry' ? '_angry' : '';
      corps(nomModele('wolf'), `wolf/${ch[0] === 'pale' ? 'wolf' : 'wolf_' + ch[0]}${etat}${bebe ? '_baby' : ''}`); break;
    }
    case 'horse': corps(nomModele('horse'), b(`horse/horse_${ch[0]}`)); break;
    case 'donkey': case 'mule': corps(nomModele(type), b(`horse/${type}`)); break;
    case 'skeleton_horse': corps(nomModele(type), b('horse/horse_skeleton')); break;
    case 'zombie_horse': corps(nomModele(type), b('horse/horse_zombie')); break;
    case 'camel': corps(nomModele('camel'), b('camel/camel')); break;
    case 'llama': case 'trader_llama': corps(nomModele(type), b(`llama/llama_${ch[0]}`)); break;
    case 'rabbit': corps(nomModele('rabbit'), b(`rabbit/rabbit_${ch[0]}`)); break;
    case 'fox': corps(nomModele('fox'), `fox/fox${ch[0] === 'snow' ? '_snow' : ''}${ch[1] === 'sleep' ? '_sleep' : ''}${bebe ? '_baby' : ''}`); break;
    case 'axolotl': corps(nomModele('axolotl'), b(`axolotl/axolotl_${ch[0]}`)); break;
    case 'parrot': corps('parrot', `parrot/parrot_${ch[0]}`); break;
    case 'panda': corps(nomModele('panda'), bebe ? (ch[0] === 'normal' ? 'panda/panda_baby' : `panda/${ch[0]}_panda_baby`) : (ch[0] === 'normal' ? 'panda/panda' : `panda/panda_${ch[0]}`)); break;
    case 'salmon': corps(ch[0] === 'medium' ? 'salmon' : `salmon_${ch[0]}`, 'fish/salmon'); break;
    case 'pufferfish': corps(`pufferfish_${ch[0]}`, 'fish/pufferfish'); break;
    case 'tropical_fish': {
      const l = ch[0] === 'a' ? 'small' : 'large';
      corps(`tropical_fish_${l}`, `fish/tropical_${ch[0]}`, { teinte: couleurTeinture(TEINTURES.indexOf(ch[2])) });
      ajoute(`tropical_fish_${l}`, 'pattern', `fish/tropical_${ch[0]}_pattern_${ch[1]}`, couleurTeinture(TEINTURES.indexOf(ch[3] === 'sans' ? 'white' : ch[3])));
      break;
    }
    case 'copper_golem': corps('copper_golem', `copper_golem/copper_golem${ch[0] === 'unaffected' ? '' : '_' + ch[0]}`); break;
    case 'strider': corps(nomModele('strider'), b(`strider/strider${ch[0] === 'cold' ? '_cold' : ''}`)); break;
    case 'bee': corps(nomModele('bee'), b(`bee/bee${ch[0] === 'angry' ? '_angry' : ''}${ch[1] === 'nectar' ? '_nectar' : ''}`)); break;
    case 'ghast': corps('ghast', ch[0] === 'shooting' ? 'ghast/ghast_shooting' : 'ghast/ghast'); break;
    case 'vex': corps('vex', ch[0] === 'charging' ? 'illager/vex_charging' : 'illager/vex'); break;
    case 'wither': corps('wither', ch[0] === 'invulnerable' ? 'wither/wither_invulnerable' : 'wither/wither'); break;
    case 'sniffer': corps(nomModele('sniffer'), bebe ? 'sniffer/snifflet' : 'sniffer/sniffer'); break;
    case 'boat': case 'chest_boat': corps(`${type}/${ch[0]}`, `${type}/${ch[0]}`); break;
    case 'happy_ghast': corps(nomModele('happy_ghast'), bebe ? 'ghast/happy_ghast_baby' : 'ghast/happy_ghast'); break;
    default:
      corps(nomModele(e[0]), b(e[1]));
  }
  if (bebe && e[5] && !modele.endsWith('_baby') && !modeles[modele + '_baby'] && !/baby/.test(modele)) echelleBebe = 0.5;   // pas de modele de bebe : l'ancienne regle (moitie)
  if (bebe && !e[5]) notes.push(`${type} n'a pas de bebe dans le jeu : bebe ignore`);
  couches.unshift({ modele, couche: 'main', texture: tex, teinte: corpsEnPlus.teinte ?? blanc, mode: ['allay', 'piglin', 'piglin_brute', 'zombified_piglin', 'breeze', 'vex'].includes(type) ? 'melange' : 'decoupe', corps: true });
  // couches en plus (render.rs layers)
  const adulte = !bebe;
  switch (type) {
    case 'villager': case 'zombie_villager': {
      const dossier = type, t = ch[0], metier = ch[1], niveau = Number(ch[2]);
      const chapeau = (groupe, nom) => { try { return JSON.parse(fs.readFileSync(path.join(kitDir, 'assets', 'minecraft', 'textures', 'entity', dossier, groupe, nom + '.png.mcmeta'), 'utf8')).villager?.hat ?? 'none'; } catch { return 'none'; } };
      const hm = chapeau('profession', metier), ht = chapeau('type', t);
      const visible = hm === 'none' ? true : hm === 'partial' ? ht !== 'full' : false;
      const sansChapeau = bebe ? `${type}_baby_no_hat` : `${type}_no_hat`;
      ajoute(visible || !modeles[sansChapeau] ? modele : sansChapeau, 'main', `${dossier}/${bebe ? 'baby' : 'type'}/${t}`);
      if (adulte && metier !== 'none') {
        ajoute(modele, 'main', `${dossier}/profession/${metier}`);
        if (metier !== 'nitwit') ajoute(modele, 'main', `${dossier}/profession_level/${NIVEAUX[Math.min(4, Math.max(0, niveau - 1))]}`);
      }
      void TYPES_VILLAGEOIS; void METIERS;
      break;
    }
    case 'sheep': {
      const c = Math.max(0, TEINTURES.indexOf(ch[0])), teinte = couleurLaine(c);
      if (adulte && c !== 0) ajoute('sheep', 'wool_undercoat', 'sheep/sheep_wool_undercoat', teinte);
      if (!o.tondu) ajoute(bebe ? 'sheep_baby' : 'sheep', 'wool', bebe ? 'sheep/sheep_wool_baby' : 'sheep/sheep_wool', teinte);
      break;
    }
    case 'wolf': if (o.colle !== undefined && o.colle !== null) ajoute(modele, 'main', bebe ? 'wolf/wolf_collar_baby' : 'wolf/wolf_collar', couleurTeinture(TEINTURES.indexOf(o.colle))); break;
    case 'cat': if (o.colle !== undefined && o.colle !== null) ajoute(bebe ? 'cat_baby' : 'cat', 'collar', bebe ? 'cat/cat_collar_baby' : 'cat/cat_collar', couleurTeinture(TEINTURES.indexOf(o.colle))); break;
    case 'horse': case 'donkey': case 'mule': case 'skeleton_horse': case 'zombie_horse': case 'camel': {
      if (type === 'horse' && ch[1] !== 'sans') ajoute(modele, 'main', b(`horse/horse_${ch[1].replace('markings_', 'markings_')}`));
      if (o.selle && adulte) ajoute(type, 'saddle', `equipment/${type === 'horse' ? 'horse' : type}_saddle/saddle`);
      if (o.armureCheval && type !== 'camel') {
        const mat = MATERIAU_ARMURE[o.armureCheval] ?? o.armureCheval;
        ajoute(['zombie_horse', 'skeleton_horse'].includes(type) ? 'undead_horse_armor' : 'horse_armor', 'main', `equipment/horse_body/${mat}`, mat === 'leather' ? rgb(0xA06540) : blanc);
      }
      break;
    }
    case 'llama': case 'trader_llama':
      if (type === 'trader_llama') ajoute(bebe ? 'llama_baby' : 'llama', 'decor', `equipment/llama_body/trader_llama${bebe ? '_baby' : ''}`);
      else if (ch[1] && ch[1] !== 'sans' && adulte) ajoute('llama', 'decor', `equipment/llama_body/${ch[1]}`);
      break;
    case 'pig': if (o.selle && adulte) ajoute('pig', 'saddle', 'equipment/pig_saddle/saddle'); break;
    case 'strider': if (o.selle && adulte) ajoute('strider', 'saddle', 'equipment/strider_saddle/saddle'); break;
    case 'iron_golem': if (ch[0] !== 'intact') ajoute(modele, 'main', `iron_golem/iron_golem_crackiness_${ch[0].replace('cracked_', '')}`); break;
    case 'slime': ajoute('slime', 'outer', 'slime/slime', blanc, { mode: 'melange' }); break;
    case 'spider': case 'cave_spider': ajoute(modele, 'main', 'spider/spider_eyes', blanc, { emissif: true, yeux: true }); break;
    case 'enderman': ajoute('enderman', 'main', 'enderman/enderman_eyes', blanc, { emissif: true, yeux: true }); break;
    case 'phantom': ajoute('phantom', 'main', 'phantom/phantom_eyes', blanc, { emissif: true, yeux: true }); break;
    case 'copper_golem': ajoute('copper_golem', 'main', `copper_golem/copper_golem_eyes${ch[0] === 'unaffected' ? '' : '_' + ch[0]}`, blanc, { emissif: true }); break;
    case 'drowned': ajoute(bebe ? 'drowned_baby' : 'drowned', 'outer', `zombie/drowned_outer_layer${bebe ? '_baby' : ''}`); break;
    case 'stray': ajoute('stray', 'outer', 'skeleton/stray_overlay'); break;
    case 'bogged': if (!o.tondu) ajoute('bogged', 'outer', 'skeleton/bogged_overlay'); break;
    case 'breeze': ajoute('breeze', 'wind', 'breeze/breeze_wind', blanc, { mode: 'melange', defile: 0.02 }); ajoute('breeze', 'eyes', 'breeze/breeze_eyes', blanc, { emissif: true }); break;
    case 'warden':   // WardenRenderer : bioluminescence, deux jeux de taches qui pulsent (cos(age x 0,045) x 0,25), coeur qui bat
      ajoute('warden', 'bioluminescent', 'warden/warden_bioluminescent_layer', blanc, { emissif: true });
      ajoute('warden', 'pulsating_spots', 'warden/warden_pulsating_spots_1', blanc, { emissif: true, pulse: 'taches1' });
      ajoute('warden', 'pulsating_spots', 'warden/warden_pulsating_spots_2', blanc, { emissif: true, pulse: 'taches2' });
      ajoute('warden', 'heart', 'warden/warden_heart', blanc, { emissif: true, pulse: 'coeur' });
      ajoute('warden', 'main', 'warden/warden_tendrils', blanc, { emissif: true, pulse: 'vrilles' });   // getTendrilAnimation : les vrilles s'allument quand il entend une vibration
      break;
    case 'creaking': if (o.yeux !== false) ajoute('creaking', 'eyes', 'creaking/creaking_eyes', blanc, { emissif: true }); break;   // CreakingRenderer : yeux allumes (actif)
    case 'creeper': if (o.charge) ajoute('creeper', 'armor', 'creeper/creeper_armor', [0.5, 0.5, 0.5], { emissif: true, defile: 0.01, gonfle: 2 }); break;
    case 'wither': ajoute('wither', 'armor', 'wither/wither_armor', [0.5, 0.5, 0.5], { emissif: true, defile: 0.01, gonfle: 0.5, cond: o.charge ? null : 'armure' }); break;   // WitherArmorLayer : sous la moitie de la vie (IA) ou `charge`
    case 'ender_dragon': ajoute('ender_dragon', 'main', 'enderdragon/dragon_eyes', blanc, { emissif: true, yeux: true, cond: 'vivant' }); break;   // EnderDragonRenderer : yeux (pas pendant la mort)
    default: break;
  }
  // armure des humanoides (HumanoidArmorLayer) : les couches helmet/chestplate/leggings/boots du modele, textures entity/equipment
  const base = modele;
  const EMPL = { tete: 'helmet', torse: 'chestplate', jambes: 'leggings', pieds: 'boots' };
  for (const [emp, couche] of Object.entries(EMPL)) {
    const id = o.armure?.[emp];
    if (!id) continue;
    if (!modeles[base]?.[couche]) { notes.push(`${type} ne porte pas d'armure (${emp}) dans le jeu : ignoree`); continue; }
    const mat0 = String(id).replace(/^minecraft:/, '').replace(/_(helmet|chestplate|leggings|boots)$/, '');
    const mat = MATERIAU_ARMURE[mat0] ?? mat0;
    const dossier = bebe ? 'humanoid_baby' : couche === 'leggings' ? 'humanoid_leggings' : 'humanoid';
    ajoute(base, couche, `equipment/${dossier}/${mat}`, mat === 'leather' ? rgb(0xA06540) : blanc, { armure: true });
    if (mat === 'leather') ajoute(base, couche, `equipment/${dossier}/leather_overlay`, blanc, { armure: true });
  }
  return { couches, notes, echelleBebe };
}

// intensite d'une couche qui pulse : taches du warden max(0, cos(age x 0,045) x 0,25) (et cos(... + pi)), coeur getHeartAnimation (v[1] / 10)
function pulsation(nom, pose, et) {
  const age = et?.s?.age ?? pose.age ?? 0;
  if (nom === 'taches1') return Math.max(0, Math.cos(age * 0.045) * 0.25);
  if (nom === 'taches2') return Math.max(0, Math.cos(age * 0.045 + Math.PI) * 0.25);
  if (nom === 'coeur') { const m = et?.m; if (!m) return 0; const a = et.s?.partial ?? 0; return Math.max(0, (m.anim.vo[1] + (m.anim.v[1] - m.anim.vo[1]) * a) / 10); }
  if (nom === 'vrilles') { const m = et?.m; if (!m) return 0; const a = et.s?.partial ?? 0; return Math.max(0, (m.anim.vo[0] + (m.anim.v[0] - m.anim.vo[0]) * a) / 10); }
  return 1;
}

// ---------------------------------------------------------------- la creature
export class Creature {
  // donnees : table des creatures (donnees.js) ; o : voir couchesDe ; kitDir : kit (textures)
  constructor(o, donnees, kitDir) {
    this.o = o; this.type = o.type; this.kitDir = kitDir; this.donnees = donnees;
    this.espece = ESPECES[o.type];
    this.vehicule = VEHICULES.has(o.type);
    this.entite = 'minecraft:' + entiteDuType(o.type, lireVariante(o.type, o.variante).choix);
    const { couches, notes, echelleBebe } = couchesDe(o, donnees.modeles, kitDir);
    this.notes = notes; this.echelleBebe = echelleBebe;
    this.couches = [];
    for (const c of couches) {
      const m = donnees.modeles[c.modele]?.[c.couche];
      if (!m) { notes.push(`modele absent : ${c.modele}#${c.couche}`); continue; }
      const t = textureEntite(kitDir, c.texture);
      if (!t) { notes.push(`texture absente du kit : entity/${c.texture}`); continue; }
      this.couches.push({ ...c, W: m.t[0] || t.largeur, H: m.t[1] || t.hauteur, racine: m.r, noeuds: aplatir(m.r), t });
    }
    if (!this.couches.length) throw new Error(`creature ${o.type} : rien a dessiner (${notes.join(' ; ')})`);
    this.nbQuads = this.couches.reduce((s, c) => s + c.noeuds.reduce((a, n) => a + (n.q ? n.q.length / 20 : 0), 0), 0);
    this.texture = this.couches[0].t;
    // texture d'etat choisie image par image par l'IA (GhastRenderer : shooting ; VexRenderer : charging ; BeeRenderer : angry)
    const ALT = { ghast: 'ghast/ghast_shooting', vex: 'illager/vex_charging', bee: o.bebe ? null : `bee/bee_angry${lireVariante(o.type, o.variante).choix?.[1] === 'nectar' ? '_nectar' : ''}` };
    this.texAlt = ALT[o.type] ? textureEntite(kitDir, ALT[o.type]) : null;
  }

  // RenderType.dragonExplosionAlpha : un pixel reste si l'alpha de enderdragon/dragon_exploding >= mort / 200 (pas de 1/100, en cache)
  dissoudre(t, f) {
    const q = Math.round(f * 100), cle = 'dis' + q, C = (this.dissous ??= new Map());
    if (C.has(cle)) return C.get(cle);
    const ex = (this.texExplosion ??= textureEntite(this.kitDir, 'enderdragon/dragon_exploding'));
    let out = t;
    if (ex && ex.largeur === t.largeur && ex.hauteur === t.hauteur) {
      const rgba = new Uint8Array(t.rgba), seuil = q / 100 * 255;
      for (let i = 3; i < rgba.length; i += 4) if (ex.rgba[i] < seuil) rgba[i] = 0;
      out = { largeur: t.largeur, hauteur: t.hauteur, rgba };
    }
    C.set(cle, out);
    return out;
  }

  // Poses de toutes les parties d'une couche (animation du type + pistes de l'acteur) ; `etat` : pose.creature (film/creatures.js)
  poses(couche, etat) {
    const P = new Poses(couche.racine);
    if (etat) {
      if (!this.vehicule) poser(this.type, P, etat.s, etat.m, this.donnees.animations);
      for (const n of etat.nommees ?? []) animerNommee(this.type, n.nom, n.ms, P, this.donnees.animations);
      if (etat.pagaies) for (const [nom, t, cote] of [['left_paddle', etat.pagaies[0], 0], ['right_paddle', etat.pagaies[1], 1]]) {
        if (!P.has(nom)) continue;
        const l = (f, lo, hi) => lo + Math.min(1, Math.max(0, f)) * (hi - lo), q = P.get(nom);   // AbstractBoatModel.animatePaddle
        q[3] = l((Math.sin(-t) + 1) / 2, -Math.PI / 3, -Math.PI / 12);
        q[4] = l((Math.sin(-t + 1) + 1) / 2, -Math.PI / 4, Math.PI / 4);
        if (cote === 1) q[4] = Math.PI - q[4];
      }
      for (const [nom, r] of Object.entries(etat.parties ?? {})) if (P.has(nom)) { const q = P.get(nom); q[3] += r[0] * RAD; q[4] += r[1] * RAD; q[5] += r[2] * RAD; }
      if (etat.cacher) for (const nom of etat.cacher) P.visible(nom, false);
    }
    return P;
  }

  // Matrice de base (monde) : voir l'en-tete.
  base(pose) {
    if (pose.matrice) return pose.matrice;   // matrice imposee (fantome du gardien ancien : ElderGuardianParticle, film/effets-monde.js)
    const lacet = pose.lacet ?? 0, et = pose.creature ?? {};
    const y = pose.y + (pose.dy ?? 0) + (pose.hauteur ?? 0);
    if (this.vehicule) {
      let B = mul(T(pose.x, y + 0.375, pose.z), RY((180 - lacet) * RAD));
      if (pose.bascule) B = mul(B, RX(-pose.bascule * RAD));
      return mul(mul(B, S(-1, -1, 1)), RY(Math.PI / 2));
    }
    const tremble = et.tremble ? Math.cos(Math.floor(pose.age ?? 0) * 3.25) * Math.PI * 0.4 : 0;   // LivingEntityRenderer.setupRotations : isShaking (conversion)
    let B = mul(T(pose.x, y, pose.z), RY((180 - lacet - tremble) * RAD));
    if (et.couche) {   // couche dans un lit (LivingEntityRenderer : recul de (oeil - 0,1) vers le pied, Y(direction du lit), Z(90), Y(270))
      const r = et.couche.lacet, pas = { 90: [0, 1], 0: [-1, 0], 270: [0, -1], 180: [1, 0] }[Math.round(r)] ?? [0, 0], f = et.couche.oeil - 0.1;
      B = mul(mul(mul(T(pose.x - pas[0] * f, y, pose.z - pas[1] * f), RY(r * RAD)), RZ(Math.PI / 2)), RY(270 * RAD));
    }
    if (et.tangage) B = mul(B, RX(et.tangage * RAD));   // PhantomRenderer.setupRotations : le corps suit son tangage
    if (et.poisson) {   // poisson : ondulation, hors de l'eau couche sur le flanc
      const q = et.poisson;
      B = mul(mul(B, RY(q.lacet * RAD)), T(q.avant[0], q.avant[1], q.avant[2]));
      if (q.hors) B = mul(mul(B, T(q.decal[0], q.decal[1], q.decal[2])), RZ(Math.PI / 2));
    }
    if (et.echelle && et.echelle !== 1) B = mul(B, S(et.echelle, et.echelle, et.echelle));
    if (pose.roulis) B = mul(B, RZ(pose.roulis * RAD * (et.retourne ? 2 : 1)));   // mort : le corps tombe sur le cote (180 pour les araignees)
    if (pose.bascule) B = mul(B, RX(-pose.bascule * RAD));
    if (et.inclinaison) B = mul(B, RZ(et.inclinaison * RAD));                 // IronGolemRenderer.setupRotations
    B = mul(B, S(-1, -1, 1));
    if (et.echelleType) B = mul(B, S(et.echelleType[0], et.echelleType[1], et.echelleType[2]));
    if (this.echelleBebe !== 1) B = mul(B, S(this.echelleBebe, this.echelleBebe, this.echelleBebe));
    return mul(B, T(0, -1.501, 0));
  }

  // pose -> [maillages] (un par couche). lumiere 0..1 ; brut : couleurs a 1 et normales (vrai pack de shaders).
  maillage(pose, lumiere = 1, brut = false) {
    if (pose.absent) return [];
    const B = this.base(pose), et = pose.creature ?? null;
    const age = (pose.age ?? 0);
    const teinteCorps = pose.teinte ?? null;          // rougeur des degats
    const blanc = et?.blanc ?? 0;                     // eclair blanc du creeper qui gonfle
    const sorties = [];
    const cachePoses = new Map();
    for (const c of this.couches) {
      // couches d'un meme modele : memes poses (une seule animation par modele)
      const cleP = c.racine;
      let P = cachePoses.get(cleP);
      if (!P) { P = this.poses(c, et); cachePoses.set(cleP, P); }
      const nQ = c.noeuds.reduce((a, n) => a + (n.q && !P.cache(n.nom) ? n.q.length / 20 : 0), 0);
      const positions = new Float32Array(nQ * 12), uvs = new Float32Array(nQ * 8), couleurs = new Float32Array(nQ * 12), indices = new Uint32Array(nQ * 6);
      const normales = brut ? new Float32Array(nQ * 12) : null;
      const mats = new Array(c.noeuds.length), cachee = new Array(c.noeuds.length);
      let q = 0;
      const teinte = et?.teinteLaine && (c.couche === 'wool' || c.couche === 'wool_undercoat') ? et.teinteLaine : c.teinte;   // jeb_ : laine arc-en-ciel
      const emissif = !!c.emissif;
      const pulse = c.pulse ? pulsation(c.pulse, pose, et) : 1;   // couches du warden qui pulsent (WardenRenderer)
      if (pulse <= 0.002) continue;
      if ((c.cond === 'armure' && !et?.armure) || (c.cond === 'vivant' && et?.dissolution)) continue;   // armure du wither ; yeux du dragon (pas pendant sa mort)
      for (let i = 0; i < c.noeuds.length; i++) {
        const n = c.noeuds[i];
        const p = (n.nom && P.pose(n.nom)) || n.base;
        cachee[i] = (n.parent >= 0 && cachee[n.parent]) || P.cache(n.nom) || (p[6] === 0 && p[7] === 0 && p[8] === 0);
        mats[i] = matricePartie(n.parent >= 0 ? mats[n.parent] : B, p);
        if (!n.q || cachee[i] || P.saute?.(n.nom)) continue;
        const M = mats[i];
        for (let k = 0; k < n.q.length; k += 20, q++) {
          // normale de la face (repere de la partie) : (b - a) x (c - a), sortante
          const ax = n.q[k], ay = n.q[k + 1], az = n.q[k + 2];
          const ux = n.q[k + 5] - ax, uy = n.q[k + 6] - ay, uz = n.q[k + 7] - az, wx = n.q[k + 10] - ax, wy = n.q[k + 11] - ay, wz = n.q[k + 12] - az;
          let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
          let mx = M[0] * nx + M[1] * ny + M[2] * nz, my = M[4] * nx + M[5] * ny + M[6] * nz, mz = M[8] * nx + M[9] * ny + M[10] * nz;
          const l = Math.hypot(mx, my, mz) || 1; mx /= l; my /= l; mz /= l;
          let o = emissif ? pulse : ombre(mx, my, mz) * lumiere;
          for (let s = 0; s < 4; s++) {
            const b = k + s * 5, X = n.q[b] / 16, Y = n.q[b + 1] / 16, Z = n.q[b + 2] / 16, v = q * 4 + s;
            positions[v * 3] = M[0] * X + M[1] * Y + M[2] * Z + M[3];
            positions[v * 3 + 1] = M[4] * X + M[5] * Y + M[6] * Z + M[7];
            positions[v * 3 + 2] = M[8] * X + M[9] * Y + M[10] * Z + M[11];
            uvs[v * 2] = n.q[b + 3] / c.W; uvs[v * 2 + 1] = n.q[b + 4] / c.H;
            if (brut) { const kp = emissif ? pulse : 1; couleurs[v * 3] = teinte[0] * kp; couleurs[v * 3 + 1] = teinte[1] * kp; couleurs[v * 3 + 2] = teinte[2] * kp; normales[v * 3] = mx; normales[v * 3 + 1] = my; normales[v * 3 + 2] = mz; continue; }
            let r = o * teinte[0], g = o * teinte[1], bl = o * teinte[2];
            if (!emissif) {
              if (teinteCorps) { r *= teinteCorps[0]; g *= teinteCorps[1]; bl *= teinteCorps[2]; }
              if (blanc) { const f = 1 + 1.6 * blanc; r *= f; g *= f; bl *= f; }
            }
            couleurs[v * 3] = r; couleurs[v * 3 + 1] = g; couleurs[v * 3 + 2] = bl;
          }
          const v0 = q * 4;
          indices.set([v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3], q * 6);
        }
      }
      if (!q) continue;
      const texEtat = et?.texEtat && c.corps ? ((this.texEtats ??= {})[et.texEtat] ??= textureEntite(this.kitDir, et.texEtat) ?? null) : null;   // abeille : en colere et/ou avec du nectar
      let texture = c.defile ? textureDecalee(c.t, (age * c.defile) % 1) : texEtat ?? (et?.alt && c.corps && this.texAlt ? this.texAlt : c.t);   // ghast qui tire, vex qui charge, abeille en colere
      if (et?.dissolution && c.corps) texture = this.dissoudre(texture, et.dissolution);   // dragon qui meurt : seuls restent les pixels ou dragon_exploding est assez opaque
      const m = { positions, uvs, couleurs, indices, texture, mode: emissif ? 'melange' : c.mode, deuxFaces: c.mode !== 'melange' || emissif, genre: 'creature', entite: this.entite };
      if (emissif) { m.additif = true; m.emissif = true; if (c.yeux) m.yeux = true; if (!c.yeux && !c.defile && !c.pulse) m.lueur = true; }   // lueur : RenderType.entityTranslucentEmissive (warden, breeze, creaking, golem de cuivre) : un vrai pack la melange (pas d'ajout), pleine lumiere   // yeux (RenderType.eyes) : programme gbuffers_spidereyes d'un vrai pack
      if (brut && blanc > 0 && !emissif) m.blanc = blanc;   // eclair blanc du creeper : entityColor blanc d'un vrai pack (le rendu de base l'a deja dans les couleurs)
      if (normales) m.normales = normales;
      if (pose.horsImage) m.exempt = true;
      sorties.push(m);
    }
    // objets tenus (bipedes : bras right_arm / left_arm) : ItemInHandLayer, meme chaine que le joueur (objets/placement.js)
    for (const [champ, bras, gauche] of [['objetD', 'right_arm', false], ['objetG', 'left_arm', true]]) {
      const id = pose[champ];
      if (!id || !this.kitDir) continue;
      const Mb = this.matrice(pose, bras, cachePoses.get(this.couches[0].racine));
      if (!Mb) continue;
      const o = objetPourNotes(this.kitDir, id, gauche);
      for (const c of o.couches) {
        let M = mul(Mb, mul(RX(-Math.PI / 2), RY(Math.PI)));
        M = mul(M, T((gauche ? -1 : 1) / 16, 2 / 16, -10 / 16));
        const A = matriceAffichage(c.affiche, gauche);
        M = mul(M, [A[0], A[1], A[2], A[3], A[4], A[5], A[6], A[7], A[8], A[9], A[10], A[11], 0, 0, 0, 1]);
        for (const mo of c.morceaux) sorties.push(maillageObjet(mo, M, lumiere, brut, pose, this.entite));
      }
    }
    if (this.kitDir) sorties.push(...this.blocs(pose, lumiere, brut, cachePoses.get(this.couches[0].racine)));
    // laisse (film/creatures.js : pose.laisse = { de, vers, noeud }) : corde du jeu jusqu'a la main ou au noeud de barriere
    if (pose.laisse) {
      const avecN = (m) => { if (m && brut) { m.normales = new Float32Array(m.positions.length); for (let i = 1; i < m.normales.length; i += 3) m.normales[i] = 1; } return m; };
      sorties.push(avecN(maillageCorde(pose.laisse.de, pose.laisse.vers, lumiere, pose.laisse.lumVers ?? lumiere)));
      if (pose.laisse.noeud) { const k = avecN(maillageNoeud(this.kitDir, pose.laisse.noeud, pose.laisse.lumVers ?? lumiere)); if (k) sorties.push(k); }
    }
    return sorties;
  }

  // Bloc d'un wagonnet (AbstractMinecartRenderer : echelle 0,75, decalage d'affichage), bloc porte par l'enderman (CarriedBlockLayer),
  // objet des bras croises du villageois (CrossedArmsItemLayer, affichage "ground").
  blocs(pose, lumiere, brut, P) {
    const out = [], et = pose.creature ?? {};
    if (this.type.includes('minecart')) {
      const id = et.contenu ?? this.o.contenu ?? CONTENU_WAGONNET[this.type];
      if (!id) return out;
      const y = pose.y + (pose.dy ?? 0) + (pose.hauteur ?? 0);
      let B = mul(T(pose.x, y + 0.375, pose.z), RY((180 - (pose.lacet ?? 0)) * RAD));
      if (pose.bascule) B = mul(B, RX(-pose.bascule * RAD));
      const dec = DECALAGE_WAGONNET[id] ?? 6;
      const M = mul(mul(mul(B, S(0.75, 0.75, 0.75)), T(-0.5, (dec - 8) / 16, 0.5)), RY(Math.PI / 2));
      for (const mo of morceauxBloc(this.kitDir, id)) out.push(maillageObjet(mo, M, lumiere, brut, pose, this.entite));
      return out;
    }
    const porte = et.porte !== undefined ? et.porte : this.o.porte;   // bloc pris en cours de route (ia-vie.js) ou champ porte
    if (this.type === 'enderman' && porte) {
      let M = mul(this.base(pose), T(0, 0.6875, -0.75));
      M = mul(mul(M, RX(20 * RAD)), RY(45 * RAD));
      M = mul(mul(mul(M, T(0.25, 0.1875, 0.25)), S(-0.5, -0.5, 0.5)), RY(Math.PI / 2));
      for (const mo of morceauxBloc(this.kitDir, porte)) out.push(maillageObjet(mo, M, lumiere, brut, pose, this.entite));
    }
    if (['villager', 'wandering_trader'].includes(this.type) && this.o.echange) {
      const Ma = this.matrice(pose, 'arms', P);
      if (!Ma) return out;
      let M = mul(mul(Ma, RX(0.75)), S(1.07, 1.07, 1.07));
      M = mul(mul(M, T(0, 0.13, -0.34)), RX(Math.PI));
      const o = objetPourNotes(this.kitDir, this.o.echange, false);
      for (const c of o.couches) {
        const aff = afficheSol(this.kitDir, this.o.echange) ?? c.affiche;
        const A = matriceAffichage(aff, false);
        const Mc = mul(M, [A[0], A[1], A[2], A[3], A[4], A[5], A[6], A[7], A[8], A[9], A[10], A[11], 0, 0, 0, 1]);
        for (const mo of c.morceaux) out.push(maillageObjet(mo, Mc, lumiere, brut, pose, this.entite));
      }
    }
    return out;
  }

  // Matrice (monde) d'une partie nommee de la couche principale pour une pose (main d'un biped : objet tenu ; tete : etiquette)
  matrice(pose, nom, P0 = null) {
    const c = this.couches[0], P = P0 ?? this.poses(c, pose.creature ?? null), B = this.base(pose);
    const mats = [];
    for (let i = 0; i < c.noeuds.length; i++) {
      const n = c.noeuds[i];
      mats[i] = matricePartie(n.parent >= 0 ? mats[n.parent] : B, (n.nom && P.pose(n.nom)) || n.base);
      if (n.nom === nom) return mats[i];
    }
    return null;
  }
}
// morceau d'objet tenu (local en px, normales, uvs, indices ; texture t) sous la matrice M (monde)
function maillageObjet(mo, M, lumiere, brut, pose, entite) {
  const n = mo.local.length / 3, positions = new Float32Array(n * 3), couleurs = new Float32Array(n * 3), normales = brut ? new Float32Array(n * 3) : null;
  for (let s = 0; s < n; s++) {
    const X = mo.local[s * 3] / 16, Y = mo.local[s * 3 + 1] / 16, Z = mo.local[s * 3 + 2] / 16;
    positions[s * 3] = M[0] * X + M[1] * Y + M[2] * Z + M[3]; positions[s * 3 + 1] = M[4] * X + M[5] * Y + M[6] * Z + M[7]; positions[s * 3 + 2] = M[8] * X + M[9] * Y + M[10] * Z + M[11];
    const nx = mo.normales[s * 3], ny = mo.normales[s * 3 + 1], nz = mo.normales[s * 3 + 2];
    let mx = M[0] * nx + M[1] * ny + M[2] * nz, my = M[4] * nx + M[5] * ny + M[6] * nz, mz = M[8] * nx + M[9] * ny + M[10] * nz;
    const l = Math.hypot(mx, my, mz) || 1; mx /= l; my /= l; mz /= l;
    if (brut) { couleurs.fill(1, s * 3, s * 3 + 3); normales.set([mx, my, mz], s * 3); continue; }
    const o = ombre(mx, my, mz) * lumiere, tn = pose.teinte ?? [1, 1, 1];
    couleurs[s * 3] = o * tn[0]; couleurs[s * 3 + 1] = o * tn[1]; couleurs[s * 3 + 2] = o * tn[2];
  }
  const m = { positions, uvs: mo.uvs, couleurs, indices: mo.indices, texture: mo.t, mode: 'decoupe', deuxFaces: true, genre: 'creature', entite };
  if (normales) m.normales = normales;
  if (pose.horsImage) m.exempt = true;
  return m;
}
// nom d'entite du jeu (entity.properties des packs de shaders) : bateau de chene -> oak_boat
export function entiteDuType(type, choix = []) { return type === 'boat' || type === 'chest_boat' ? `${choix[0] ?? 'oak'}_${type}` : type; }

// ---------------------------------------------------------------- blocs portes ou transportes (enderman, wagonnets) et objet des bras croises
// Boite du jeu (ModelPart.Cube) : 6 faces, UV deplies a partir de texOffs (u0, v0) ; patron releve sur une boite 2x4x1 du jeu.
const PATRON_BOITE = [[2,0,1,3,0],[0,0,1,1,0],[0,0,0,1,1],[2,0,0,3,1],[2,4,0,5,1],[0,4,0,3,1],[0,4,1,3,0],[2,4,1,5,0],[0,0,0,1,1],[0,0,1,0,1],[0,4,1,0,5],[0,4,0,1,5],[2,0,0,3,1],[0,0,0,1,1],[0,4,0,1,5],[2,4,0,3,5],[2,0,1,4,1],[2,0,0,3,1],[2,4,0,3,5],[2,4,1,4,5],[0,0,1,6,1],[2,0,1,4,1],[2,4,1,4,5],[0,4,1,6,5]];
export function quadsBoite(x0, y0, z0, w, h, d, u0, v0) {
  const U = { 0: 0, 1: d, 3: d + w, 4: 2 * d + w, 5: d + 2 * w, 6: 2 * d + 2 * w }, V = { 0: 0, 1: d, 5: d + h };
  return PATRON_BOITE.flatMap(([x, y, z, u, v]) => [x0 + x / 2 * w, y0 + y / 4 * h, z0 + z * d, u0 + U[u], v0 + V[v]]);
}
// morceau { local (px), normales, uvs, indices, t } a partir de quads plats (20 nombres par quad, UV en px de la texture t)
function morceauQuads(q, t) {
  const nQ = q.length / 20, local = new Float32Array(nQ * 12), normales = new Float32Array(nQ * 12), uvs = new Float32Array(nQ * 8), indices = new Uint32Array(nQ * 6);
  for (let i = 0; i < nQ; i++) {
    const k = i * 20, ax = q[k], ay = q[k + 1], az = q[k + 2];
    const ux = q[k + 5] - ax, uy = q[k + 6] - ay, uz = q[k + 7] - az, wx = q[k + 10] - ax, wy = q[k + 11] - ay, wz = q[k + 12] - az;
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz) || 1;
    for (let s = 0; s < 4; s++) { const b = k + s * 5, v = i * 4 + s; local.set([q[b], q[b + 1], q[b + 2]], v * 3); normales.set([nx / l, ny / l, nz / l], v * 3); uvs.set([q[b + 3] / t.largeur, q[b + 4] / t.hauteur], v * 2); }
    indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  return { local, normales, uvs, indices, t };
}
const COFFRES = { chest: 'chest/normal', trapped_chest: 'chest/trapped', ender_chest: 'chest/ender' };
const TEINTES_BLOC = { grass_block: 0x91BD59, oak_leaves: 0x48B518, birch_leaves: 0x80A755, spruce_leaves: 0x619961, jungle_leaves: 0x48B518, acacia_leaves: 0x48B518, dark_oak_leaves: 0x48B518, mangrove_leaves: 0x92C648, vine: 0x48B518, fern: 0x91BD59, short_grass: 0x91BD59, tall_grass: 0x91BD59 };
const cacheBlocs = new Map();
// Morceaux d'un bloc (repere du bloc 0..1, y vers le haut, en px) : coffre = ChestModel (fond 14x10x14, couvercle, serrure ; devant vers +z),
// autre bloc = son modele block/<id> du kit (rendu d'un bloc seul : BlockRenderDispatcher.renderSingleBlock)
export function morceauxBloc(kitDir, id) {
  const cle = kitDir + '|' + id;
  if (cacheBlocs.has(cle)) return cacheBlocs.get(cle);
  let r = [];
  if (COFFRES[id]) {
    const t = textureEntite(kitDir, COFFRES[id]);
    if (t) r = [morceauQuads([...quadsBoite(1, 0, 1, 14, 10, 14, 0, 19), ...quadsBoite(1, 9, 1, 14, 5, 14, 0, 0), ...quadsBoite(7, 7, 15, 2, 4, 1, 0, 0)], t)];
  } else {
    const c = cuireBloc(kitDir, { model: 'minecraft:block/' + id, tints: [TEINTES_BLOC[id] ?? null] });
    const groupes = new Map();
    for (const q of c.quads) { if (!groupes.has(q.tex + '|' + (q.tint ?? ''))) groupes.set(q.tex + '|' + (q.tint ?? ''), []); groupes.get(q.tex + '|' + (q.tint ?? '')).push(q); }
    for (const [k, qs] of groupes) {
      let t = textureObjet(kitDir, k.split('|')[0]);
      if (!t) continue;
      const tint = qs[0].tint; if (tint !== null && tint !== undefined) t = teinter(t, tint);
      const flat = [];
      for (const q of qs) for (let s = 0; s < 4; s++) flat.push(q.p[s][0] * 16, q.p[s][1] * 16, q.p[s][2] * 16, q.uv[s][0] * t.largeur, q.uv[s][1] * t.hauteur);
      r.push(morceauQuads(flat, t));
    }
  }
  cacheBlocs.set(cle, r);
  return r;
}
// bloc de chaque wagonnet (getDefaultDisplayBlockState) et decalage d'affichage (getDefaultDisplayOffset : 6 ; coffre 8 ; entonnoir 1)
export const CONTENU_WAGONNET = { chest_minecart: 'chest', furnace_minecart: 'furnace', tnt_minecart: 'tnt', hopper_minecart: 'hopper', spawner_minecart: 'spawner', command_block_minecart: 'command_block' };
const DECALAGE_WAGONNET = { chest: 8, trapped_chest: 8, ender_chest: 8, hopper: 1 };
// affichage "ground" du modele d'un objet (ItemDisplayContext.GROUND)
function afficheSol(kitDir, id) {
  const d = resoudreObjet(kitDir, id, {});
  const e = d.entrees?.[0];
  return e?.model ? afficheDe(kitDir, e.model, false, 'ground') : null;
}
