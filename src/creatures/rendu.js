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
import { objetPourNotes } from '../objets/habillage.js';
import { matriceAffichage } from '../objets/placement.js';

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
    case 'spider': case 'cave_spider': ajoute(modele, 'main', 'spider/spider_eyes', blanc, { emissif: true }); break;
    case 'enderman': ajoute('enderman', 'main', 'enderman/enderman_eyes', blanc, { emissif: true }); break;
    case 'phantom': ajoute('phantom', 'main', 'phantom/phantom_eyes', blanc, { emissif: true }); break;
    case 'copper_golem': ajoute('copper_golem', 'main', `copper_golem/copper_golem_eyes${ch[0] === 'unaffected' ? '' : '_' + ch[0]}`, blanc, { emissif: true }); break;
    case 'drowned': ajoute(bebe ? 'drowned_baby' : 'drowned', 'outer', `zombie/drowned_outer_layer${bebe ? '_baby' : ''}`); break;
    case 'stray': ajoute('stray', 'outer', 'skeleton/stray_overlay'); break;
    case 'bogged': if (!o.tondu) ajoute('bogged', 'outer', 'skeleton/bogged_overlay'); break;
    case 'breeze': ajoute('breeze', 'wind', 'breeze/breeze_wind', blanc, { mode: 'melange', defile: 0.02 }); ajoute('breeze', 'eyes', 'breeze/breeze_eyes', blanc, { emissif: true }); break;
    case 'warden': ajoute('warden', 'bioluminescent', 'warden/warden_bioluminescent_layer', blanc, { emissif: true }); break;
    case 'creeper': if (o.charge) ajoute('creeper', 'armor', 'creeper/creeper_armor', [0.5, 0.5, 0.5], { emissif: true, defile: 0.01, gonfle: 2 }); break;
    case 'wither': if (o.charge) ajoute('wither', 'armor', 'wither/wither_armor', [0.5, 0.5, 0.5], { emissif: true, defile: 0.01 }); break;
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
    const lacet = pose.lacet ?? 0, et = pose.creature ?? {};
    const y = pose.y + (pose.dy ?? 0) + (pose.hauteur ?? 0);
    if (this.vehicule) {
      let B = mul(T(pose.x, y + 0.375, pose.z), RY((180 - lacet) * RAD));
      if (pose.bascule) B = mul(B, RX(-pose.bascule * RAD));
      return mul(mul(B, S(-1, -1, 1)), RY(Math.PI / 2));
    }
    let B = mul(T(pose.x, y, pose.z), RY((180 - lacet) * RAD));
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
      const teinte = c.teinte;
      const emissif = !!c.emissif;
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
          let o = emissif ? 1 : ombre(mx, my, mz) * lumiere;
          for (let s = 0; s < 4; s++) {
            const b = k + s * 5, X = n.q[b] / 16, Y = n.q[b + 1] / 16, Z = n.q[b + 2] / 16, v = q * 4 + s;
            positions[v * 3] = M[0] * X + M[1] * Y + M[2] * Z + M[3];
            positions[v * 3 + 1] = M[4] * X + M[5] * Y + M[6] * Z + M[7];
            positions[v * 3 + 2] = M[8] * X + M[9] * Y + M[10] * Z + M[11];
            uvs[v * 2] = n.q[b + 3] / c.W; uvs[v * 2 + 1] = n.q[b + 4] / c.H;
            if (brut) { couleurs[v * 3] = teinte[0]; couleurs[v * 3 + 1] = teinte[1]; couleurs[v * 3 + 2] = teinte[2]; normales[v * 3] = mx; normales[v * 3 + 1] = my; normales[v * 3 + 2] = mz; continue; }
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
      const texture = c.defile ? textureDecalee(c.t, (age * c.defile) % 1) : c.t;
      const m = { positions, uvs, couleurs, indices, texture, mode: emissif ? 'melange' : c.mode, deuxFaces: c.mode !== 'melange' || emissif, genre: 'creature', entite: this.entite };
      if (emissif) { m.additif = true; m.emissif = true; }
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
    return sorties;
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
