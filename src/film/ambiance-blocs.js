// Particules d'ambiance des blocs : ClientLevel.animateTick du jeu (tous les ticks, 667 cellules au hasard a 16 blocs de la camera et 667 a
// 32) -> Block.animateTick de chaque bloc tire (torches, bougies, feux de camp, fours, feu, poudre et torches de redstone allumees, levier et
// repeteur alimentes, minerai de redstone allume, portail du Nether, tige de l'End, coffre de l'Ender, table d'enchantement, alambic,
// feuilles qui tombent et gouttent sous la pluie, fleur de spores, obsidienne pleureuse, mycelium, sable et gravier qui s'effritent,
// ruche pleine de miel, eponge mouillee, stalactites qui gouttent, ancre de reapparition, colonnes de bulles, buisson a lucioles, rose du
// wither, portail et passage de l'End, paratonnerre sous l'orage, capteur de sculk actif...), FluidState.animateTick (eau, lave), gouttes sous
// les fluides (trySpawnDripParticles), particules d'ambiance des biomes (Nether : cendres, spores), et les fumees des feux de camp
// (CampfireBlockEntity.particleTick). Puis le moteur de particules du jeu (Particle.tick et chaque comportement) et leur dessin face a la
// camera (taille selon l'age, lumiere du monde ou emission, rotation des feuilles et de la poussiere).
// Port de Horizon (MIT, voir ATTRIBUTIONS.md) : horizon-client/src/animate_tick.rs et horizon-client-render/src/particles.rs.
// Le hasard est le Random du jeu, graine fixee par la scene : memes particules a chaque rendu des memes images dans le meme ordre.
import fs from 'node:fs';
import path from 'node:path';
import { Aleatoire } from '../moteur/aleatoire.js';
import { deplacerBoite } from '../moteur/collision.js';

const RAD = Math.PI / 180;
const f32 = Math.fround;
const gen = (a, b) => { const o = []; if (a <= b) for (let i = a; i <= b; i++) o.push('generic_' + i); else for (let i = a; i >= b; i--) o.push('generic_' + i); return o; };
const serie = (p, a, b) => Array.from({ length: b - a + 1 }, (_, i) => p + (a + i));
// ensembles de sprites (assets/minecraft/particles/<type>.json du jeu 26.3 : noms des textures de textures/particle/)
export const ENSEMBLES = {
  smoke: gen(7, 0), large_smoke: gen(7, 0), white_smoke: gen(7, 0), dust: gen(7, 0), falling_dust: gen(7, 0), dust_color_transition: gen(7, 0), ash: ['generic_0'], white_ash: ['generic_0'],
  flame: ['flame'], small_flame: ['flame'], soul_fire_flame: ['soul_fire_flame'], copper_fire_flame: ['copper_fire_flame'], lava: ['lava'],
  dripping_water: ['drip_hang'], falling_water: ['drip_fall'], dripping_lava: ['drip_hang'], falling_lava: ['drip_fall'], landing_lava: ['drip_land'],
  dripping_honey: ['drip_hang'], falling_honey: ['drip_fall'], landing_honey: ['drip_land'], dripping_obsidian_tear: ['drip_hang'], falling_obsidian_tear: ['drip_fall'], landing_obsidian_tear: ['drip_land'],
  dripping_dripstone_water: ['drip_hang'], falling_dripstone_water: ['drip_fall'], dripping_dripstone_lava: ['drip_hang'], falling_dripstone_lava: ['drip_fall'], falling_spore_blossom: ['drip_fall'], spore_blossom_air: ['drip_fall'],
  splash: serie('splash_', 0, 3), underwater: ['generic_0'], crimson_spore: ['generic_0'], warped_spore: ['generic_0'], mycelium: ['generic_0'], happy_villager: ['glint'],
  portal: gen(0, 7), reverse_portal: gen(0, 7), enchant: 'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => 'sga_' + c), end_rod: serie('glitter_', 0, 7).reverse(),
  cherry_leaves: serie('cherry_', 0, 11), pale_oak_leaves: serie('pale_oak_', 0, 11), tinted_leaves: serie('leaf_', 0, 11),
  red_poplar_leaves: serie('red_poplar_', 1, 4), orange_poplar_leaves: serie('orange_poplar_', 1, 4), yellow_poplar_leaves: serie('yellow_poplar_', 1, 4),
  electric_spark: ['glow'], firefly: ['firefly'], current_down: ['bubble'], bubble_column_up: ['bubble'], bubble: ['bubble'], sulfur_bubbles: ['bubble_white'],
  campfire_cosy_smoke: serie('big_smoke_', 0, 11), campfire_signal_smoke: serie('big_smoke_', 0, 11),
};
// rendu translucide (ParticleRenderType.PARTICLE_SHEET_TRANSLUCENT) : sinon decoupe
const TRANSLUCIDES = new Set(['campfire_cosy_smoke', 'campfire_signal_smoke', 'end_rod', 'firefly', 'falling_dust']);

// ---------------------------------------------------------------- classement des blocs (Horizon animate_tick.rs `classify`)
const PAS = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const pas = (f) => PAS[f] ?? [0, -1, 0];
const POUDRE_BETON = { white: 0xFFFFFF, orange: 0xD87F33, magenta: 0xB24CD8, light_blue: 0x6699D8, yellow: 0xE5E533, lime: 0x7FCC19, pink: 0xF27FA5, gray: 0x4C4C4C, light_gray: 0x999999, cyan: 0x4C7F99, purple: 0x7F3FB2, blue: 0x334CB2, brown: 0x664C33, green: 0x667F33, red: 0x993333 };
export function classer(nom, p) {
  nom = nom.replace(/^minecraft:/, '');
  const lit = p.lit === 'true', powered = p.powered === 'true', fa = () => pas(p.facing);
  switch (nom) {
    case 'torch': return { k: 'torche', flamme: 'flame' };
    case 'soul_torch': return { k: 'torche', flamme: 'soul_fire_flame' };
    case 'copper_torch': return { k: 'torche', flamme: 'copper_fire_flame' };
    case 'wall_torch': return { k: 'torcheMur', flamme: 'flame', f: fa() };
    case 'soul_wall_torch': return { k: 'torcheMur', flamme: 'soul_fire_flame', f: fa() };
    case 'copper_wall_torch': return { k: 'torcheMur', flamme: 'copper_fire_flame', f: fa() };
    case 'redstone_torch': return lit ? { k: 'torcheRS' } : null;
    case 'redstone_wall_torch': return lit ? { k: 'torcheRSMur', f: fa() } : null;
    case 'furnace': return lit ? { k: 'four', f: fa(), haut: false } : null;
    case 'blast_furnace': return lit ? { k: 'four', f: fa(), haut: true } : null;
    case 'smoker': return lit ? { k: 'fumoir' } : null;
    case 'campfire': return lit ? { k: 'feuCamp', part: true } : null;
    case 'soul_campfire': return lit ? { k: 'feuCamp', part: false } : null;
    case 'oak_leaves': case 'birch_leaves': case 'jungle_leaves': case 'acacia_leaves': case 'dark_oak_leaves': case 'mangrove_leaves': return { k: 'feuilles', chute: ['tinted_leaves', 0.01] };
    case 'cherry_leaves': return { k: 'feuilles', chute: ['cherry_leaves', 0.1] };
    case 'pale_oak_leaves': return { k: 'feuilles', chute: ['pale_oak_leaves', 0.02] };
    case 'red_poplar_leaves': return { k: 'feuilles', chute: ['red_poplar_leaves', 0.01] };
    case 'orange_poplar_leaves': return { k: 'feuilles', chute: ['orange_poplar_leaves', 0.01] };
    case 'yellow_poplar_leaves': return { k: 'feuilles', chute: ['yellow_poplar_leaves', 0.01] };
    case 'azalea_leaves': case 'flowering_azalea_leaves': return { k: 'feuilles', chute: ['tinted_leaves', 0.01], teinte: 0x70922D };
    case 'spruce_leaves': return { k: 'feuilles', chute: null };
    case 'nether_portal': return { k: 'portail' };
    case 'enchanting_table': return { k: 'enchant' };
    case 'end_rod': return { k: 'tigeEnd', f: fa() };
    case 'spore_blossom': return { k: 'spores' };
    case 'crying_obsidian': return { k: 'pleure' };
    case 'mycelium': return { k: 'mycelium' };
    case 'brewing_stand': return { k: 'alambic' };
    case 'ender_chest': return { k: 'coffreEnder' };
    case 'sand': return { k: 'chute', c: 0xDBD3A0 };
    case 'red_sand': return { k: 'chute', c: 0xA95821 };
    case 'gravel': return { k: 'chute', c: 0x807C7B };
    case 'anvil': case 'chipped_anvil': case 'damaged_anvil': return { k: 'chute', c: 0xA7A7A7 };
    case 'dragon_egg': return { k: 'chute', c: 0 };
    case 'suspicious_sand': return { k: 'chute', c: 0xF7E9A3 };
    case 'suspicious_gravel': return { k: 'chute', c: 0x707070 };
    case 'beehive': case 'bee_nest': return p.honey_level === '5' ? { k: 'ruche' } : null;
    case 'redstone_ore': case 'deepslate_redstone_ore': return lit ? { k: 'minerai' } : null;
    case 'redstone_wire': {
      const pw = +p.power || 0; if (!pw) return null;
      const s = (d) => (p[d] === 'up' ? 2 : p[d] === 'side' ? 1 : 0);
      return { k: 'poudre', pw, cotes: [s('north'), s('east'), s('south'), s('west')] };
    }
    case 'respawn_anchor': return p.charges && p.charges !== '0' ? { k: 'ancre' } : null;
    case 'bubble_column': return { k: 'bulles', bas: p.drag === 'true' };
    case 'fire': return { k: 'feu', ame: false };
    case 'soul_fire': return { k: 'feu', ame: true };
    case 'end_portal': return { k: 'portailEnd' };
    case 'end_gateway': return { k: 'passageEnd' };
    case 'lever': return powered ? { k: 'levier', f: fa(), lie: p.face === 'ceiling' ? [0, -1, 0] : p.face === 'floor' ? [0, 1, 0] : fa() } : null;
    case 'repeater': return powered ? { k: 'repeteur', f: fa(), delai: +p.delay || 1 } : null;
    case 'pointed_dripstone': return p.vertical_direction === 'down' && p.thickness === 'tip' && p.waterlogged !== 'true' ? { k: 'stalactite' } : null;
    case 'wither_rose': return { k: 'roseWither' };
    case 'wet_sponge': return { k: 'eponge' };
    case 'firefly_bush': return { k: 'lucioles' };
    case 'sculk_sensor': case 'calibrated_sculk_sensor': return p.sculk_sensor_phase === 'active' ? { k: 'sculk' } : null;
    case 'dried_ghast': return { k: 'ghastSec', eau: p.waterlogged === 'true' };
    default:
      if (nom.endsWith('_concrete_powder')) return { k: 'chute', c: POUDRE_BETON[nom.slice(0, -16)] ?? 0x191919 };
      if ((nom === 'lightning_rod' || nom.endsWith('_lightning_rod'))) { const [dx, dy] = fa(); return { k: 'paratonnerre', axe: dx ? 0 : dy ? 1 : 2 }; }
      if (nom.endsWith('candle_cake') && lit) return { k: 'gateauBougie' };
      if ((nom === 'candle' || nom.endsWith('_candle')) && lit) return { k: 'bougies', n: +p.candles || 1 };
      return null;
  }
}
const BOUGIES = { 1: [[8, 8, 8]], 2: [[6, 7, 8], [10, 8, 7]], 3: [[8, 5, 10], [6, 7, 8], [9, 8, 7]], 4: [[7, 5, 9], [10, 7, 9], [6, 7, 6], [9, 8, 6]] };
// RedStoneWireBlock.COLORS (DustParticleOptions garde l'entier : quantifie a 1/255)
function couleurPoudre(pw) {
  const f = pw / 15, r = f * 0.6 + (f > 0 ? 0.4 : 0.3), g = Math.min(1, Math.max(0, f * f * 0.7 - 0.5)), b = Math.min(1, Math.max(0, f * f * 0.6 - 0.7));
  const q = (c) => Math.floor(f32(c) * 255) / 255;
  return [q(r), q(g), q(b)];
}

// ---------------------------------------------------------------- le moteur
// monde : { etat(x,y,z) -> { nom, props, id } | null (cellule chargee ?), boites(id) -> [[x0..]], fluide(id) -> {type:'water'|'lava'|null, niveau, chute},
//           plein(id) (collision pleine), opaque(id), remplacable(id), air(id), solideBas(id) (face du dessus pleine), brulable(nom), lecteur (collisions) }
// options : { graine, biomeEn(x,z) -> nom, feuillage(x,z) -> 0xRRGGBB, ambiance(nomBiome) -> [[type, proba]], pluieEn(x,y,z) -> bool, orage -> bool,
//             lumiere(x,y,z,mode,t) -> 0..1, texOf(rel) -> {largeur,hauteur,rgba}, fluideHauteur(x,y,z,type) -> hauteur 0..1 ou -1 }
export function creerMoteurAmbiance(monde, o) {
  const rnd = new Aleatoire(((o.graine ?? 1) * 0x5DEECE66 + 11) | 0);   // ParticleEngine.random (le hasard des blocs et des fournisseurs)
  const liste = [];
  const MAX = 16384;
  let suivant = [];

  const nouvelle = (type, p, v) => {
    const r = new Aleatoire(rnd.entier());
    return { type, x: p[0], y: p[1], z: p[2], px: p[0], py: p[1], pz: p[2], vx: 0, vy: 0, vz: 0, l: 0.2, h: 0.2, sol: false, physique: true, libre: false, arret: false, mort: false,
      age: 0, vie: 0, gravite: 0, frottement: 0.98, accel: false, taille: 0, rgba: [1, 1, 1, 1], roll: 0, oRoll: 0, ens: ENSEMBLES[type] ?? ['generic_0'], sprite: 0, auto: false,
      courbe: 'fixe', lum: 'monde', comp: 'base', r, extra: null, vInit: v };
  };
  const at = (q) => { q.vie = Math.trunc(4 / (q.r.flottant() * 0.9 + 0.1)); q.taille = 0.1 * (q.r.flottant() * 0.5 + 0.5) * 2; return q; };
  const moving = (q, v) => {
    const r = q.r;
    q.vie = Math.trunc(4 / (r.flottant() * 0.9 + 0.1));
    let d = [v[0] + f32((r.flottant() * 2 - 1) * 0.4), v[1] + f32((r.flottant() * 2 - 1) * 0.4), v[2] + f32((r.flottant() * 2 - 1) * 0.4)];
    const sp = f32((r.flottant() + r.flottant() + 1) * 0.15), L = Math.hypot(d[0], d[1], d[2]) || 1;
    d = d.map((c, i) => c / L * sp * f32(0.4) + (i === 1 ? f32(0.1) : 0));
    q.vx = d[0]; q.vy = d[1]; q.vz = d[2];
    q.taille = 0.1 * (r.flottant() * 0.5 + 0.5) * 2;
    return q;
  };
  const taillerBoite = (q, w, h) => { q.l = w; q.h = h; };
  const echelle = (q, s) => { q.taille *= s; taillerBoite(q, 0.2 * s, 0.2 * s); };
  const couleur = (q, r, g, b) => { q.rgba[0] = r; q.rgba[1] = g; q.rgba[2] = b; };
  const hasardSprite = (q) => { q.sprite = q.ens.length > 1 ? rnd.entierBorne(q.ens.length) : 0; };

  // ParticleProvider.createParticle (Horizon particles.rs `make`)
  function creer(type, p, v, opt = {}) {
    const q = nouvelle(type, p, v);
    const r = q.r;
    switch (type) {
      case 'smoke': case 'large_smoke': case 'white_smoke': case 'ash': case 'white_ash': {   // BaseAshSmokeParticle
        let dir = [0.1, 0.1, 0.1], ech = 1, alea = 0.3, maxV = 8, grav = -0.1, phys = true, vel = v;
        if (type === 'large_smoke') ech = 2.5;
        if (type === 'ash') { dir = [0.1, -0.1, 0.1]; alea = 0.5; maxV = 20; grav = 0.1; phys = false; vel = [0, 0, 0]; }
        if (type === 'white_ash') { dir = [0.1, -0.1, 0.1]; alea = 0; maxV = 20; grav = 0.0125; phys = false; vel = [rnd.flottant() * -1.9 * rnd.flottant() * 0.1, rnd.flottant() * -0.5 * rnd.flottant() * 0.1 * 5, rnd.flottant() * -1.9 * rnd.flottant() * 0.1]; }
        moving(q, [0, 0, 0]);
        q.frottement = 0.96; q.gravite = grav; q.accel = true;
        q.vx = q.vx * dir[0] + vel[0]; q.vy = q.vy * dir[1] + vel[1]; q.vz = q.vz * dir[2] + vel[2];
        const c = r.flottant() * alea; couleur(q, c, c, c);
        q.taille *= 0.75 * ech;
        q.vie = Math.max(1, Math.trunc(maxV / (r.flottant() * 0.8 + 0.2) * ech));
        q.physique = phys;
        if (type === 'white_smoke' || type === 'white_ash') couleur(q, 186 / 255, 177 / 255, 194 / 255);
        q.courbe = 'croit'; q.comp = 'anime'; q.auto = true;
        return q;
      }
      case 'flame': case 'soul_fire_flame': case 'copper_fire_flame': case 'small_flame': {   // RisingParticle (FlameParticle)
        moving(q, v);
        q.frottement = 0.96;
        q.vx = q.vx * f32(0.01) + v[0]; q.vy = q.vy * f32(0.01) + v[1]; q.vz = q.vz * f32(0.01) + v[2];
        q.x += f32((r.flottant() - r.flottant()) * 0.05); q.y += f32((r.flottant() - r.flottant()) * 0.05); q.z += f32((r.flottant() - r.flottant()) * 0.05);
        q.px = p[0]; q.py = p[1]; q.pz = p[2];
        q.vie = Math.trunc(8 / (r.flottant() * 0.8 + 0.2)) + 4;
        q.libre = true; q.courbe = 'flamme'; q.lum = 'emission';
        if (type === 'small_flame') echelle(q, 0.5);
        hasardSprite(q);
        return q;
      }
      case 'lava': {
        moving(q, [0, 0, 0]);
        q.gravite = 0.75; q.frottement = 0.999;
        q.vx *= f32(0.8); q.vy *= f32(0.8); q.vz *= f32(0.8);
        q.vy = r.flottant() * 0.4 + 0.05;
        q.taille *= r.flottant() * 2 + 0.2;
        q.vie = Math.trunc(16 / (r.flottant() * 0.8 + 0.2));
        q.courbe = 'lave'; q.lum = 'bloc15'; q.comp = 'lave';
        return q;
      }
      case 'dripping_water': case 'falling_water': case 'dripping_lava': case 'falling_lava': case 'landing_lava': case 'dripping_honey': case 'falling_honey': case 'landing_honey':
      case 'falling_nectar': case 'falling_spore_blossom': case 'dripping_obsidian_tear': case 'falling_obsidian_tear': case 'landing_obsidian_tear':
      case 'dripping_dripstone_water': case 'falling_dripstone_water': case 'dripping_dripstone_lava': case 'falling_dripstone_lava': {   // DripParticle
        at(q); taillerBoite(q, 0.01, 0.01); q.gravite = 0.06;
        const eau = [0.2, 0.3, 1.0], lave = [1.0, 0.2857143, 0.083333336], larme = [0.51171875, 0.03125, 0.890625];
        const T = {
          dripping_water: ['water', 'pend', 'falling_water', eau], falling_water: ['water', 'tombePose', 'splash', eau], dripping_lava: ['lava', 'pendChaud', 'falling_lava', null], falling_lava: ['lava', 'tombePose', 'landing_lava', lave],
          landing_lava: ['lava', 'pose', null, lave], dripping_honey: [null, 'pend', 'falling_honey', [0.622, 0.508, 0.082]], falling_honey: [null, 'tombePose', 'landing_honey', [0.582, 0.448, 0.082], 'block.beehive.drip'],
          landing_honey: [null, 'pose', null, [0.522, 0.408, 0.082]], falling_nectar: [null, 'tombe', null, [0.92, 0.782, 0.72]], falling_spore_blossom: [null, 'tombe', null, [0.32, 0.5, 0.22]],
          dripping_obsidian_tear: [null, 'pend', 'falling_obsidian_tear', larme], falling_obsidian_tear: [null, 'tombePose', 'landing_obsidian_tear', larme], landing_obsidian_tear: [null, 'pose', null, larme],
          dripping_dripstone_water: ['water', 'pend', 'falling_dripstone_water', eau], falling_dripstone_water: ['water', 'tombePose', 'splash', eau, 'block.pointed_dripstone.drip_water'],
          dripping_dripstone_lava: ['lava', 'pendChaud', 'falling_dripstone_lava', null], falling_dripstone_lava: ['lava', 'tombePose', 'landing_lava', lave, 'block.pointed_dripstone.drip_lava'],
        }[type];
        const [fluide, etape, suite, c, son] = T;
        if (etape === 'pend' || etape === 'pendChaud') { q.gravite *= 0.02; q.vie = 40; } else if (etape === 'tombePose') q.vie = Math.trunc(64 / (r.flottant() * 0.8 + 0.2)); else if (etape === 'pose') q.vie = Math.trunc(16 / (r.flottant() * 0.8 + 0.2));
        if (type === 'falling_honey' || type === 'falling_obsidian_tear') q.gravite = 0.01;
        if (type === 'dripping_honey' || type === 'dripping_obsidian_tear') { q.gravite *= 0.01; q.vie = 100; }
        if (type === 'landing_honey') q.vie = Math.trunc(128 / (rnd.flottant() * 0.8 + 0.2));
        if (type === 'landing_obsidian_tear') q.vie = Math.trunc(28 / (rnd.flottant() * 0.8 + 0.2));
        if (type === 'falling_nectar') { q.vie = Math.trunc(16 / (rnd.flottant() * 0.8 + 0.2)); q.gravite = 0.007; }
        if (type === 'falling_spore_blossom') { q.vie = Math.trunc(64 / (r.flottant() * 0.8 + 0.1)); q.gravite = 0.005; }
        if (/obsidian_tear/.test(type)) q.lum = 'bloc15';
        if (c) couleur(q, c[0], c[1], c[2]);
        q.comp = 'goutte'; q.extra = { fluide, etape, suite, son };
        return q;
      }
      case 'splash': {   // WaterDropParticle
        moving(q, [0, 0, 0]);
        q.vx *= f32(0.3); q.vy = r.flottant() * 0.2 + 0.1; q.vz *= f32(0.3);
        taillerBoite(q, 0.01, 0.01); q.gravite = 0.04; q.vie = Math.trunc(8 / (r.flottant() * 0.8 + 0.2));
        if (v[1] === 0 && (v[0] !== 0 || v[2] !== 0)) { q.vx = v[0]; q.vy = 0.1; q.vz = v[2]; }
        q.comp = 'gouttelette'; hasardSprite(q);
        return q;
      }
      case 'bubble_column_up': {
        at(q); taillerBoite(q, 0.02, 0.02); q.taille *= r.flottant() * 0.6 + 0.2;
        q.vx = v[0] * f32(0.2) + f32((r.flottant() * 2 - 1) * 0.02); q.vy = v[1] * f32(0.2) + f32((r.flottant() * 2 - 1) * 0.02); q.vz = v[2] * f32(0.2) + f32((r.flottant() * 2 - 1) * 0.02);
        q.gravite = -0.125; q.frottement = 0.85; q.vie = Math.trunc(40 / (r.flottant() * 0.8 + 0.2)); q.comp = 'colonne';
        return q;
      }
      case 'current_down': {
        at(q); q.vie = Math.trunc(r.flottant() * 60) + 30; q.physique = false; q.vx = 0; q.vy = -0.05; q.vz = 0;
        taillerBoite(q, 0.02, 0.02); q.taille *= r.flottant() * 0.6 + 0.2; q.gravite = 0.002; q.comp = 'courant'; q.extra = { angle: 0 };
        return q;
      }
      case 'sulfur_bubbles': {
        at(q); q.gravite = -0.04; q.frottement = 0.85; taillerBoite(q, 0.02, 0.02);
        q.vx = v[0] * f32(0.2) + f32((r.flottant() * 2 - 1) * 0.02); q.vz = v[1] * f32(0.2) + f32((r.flottant() * 2 - 1) * 0.02);
        const t0 = 0.02 + 0.02 * r.flottant(); q.taille = t0; q.vie = 1e9; q.comp = 'soufre'; q.extra = { y0: p[1], y1: p[1] + 3, t0, yp: p[1] };
        return q;
      }
      case 'underwater': case 'crimson_spore': case 'warped_spore': case 'spore_blossom_air': {   // SuspendedParticle
        const bas = [p[0], p[1] - 0.125, p[2]];
        const vel = type === 'crimson_spore' ? [rnd.gaussien() * f32(1e-6), rnd.gaussien() * f32(1e-4), rnd.gaussien() * f32(1e-6)] : type === 'warped_spore' ? [0, rnd.flottant() * -1.9 * rnd.flottant() * 0.1, 0] : [0, f32(-0.8), 0];
        hasardSprite(q);
        q.x = bas[0]; q.y = bas[1]; q.z = bas[2]; q.px = q.x; q.py = q.y; q.pz = q.z;
        if (type === 'underwater') { at(q); taillerBoite(q, 0.01, 0.01); q.taille *= r.flottant() * 0.6 + 0.2; } else { moving(q, vel); taillerBoite(q, 0.01, 0.01); q.taille *= r.flottant() * 0.6 + 0.6; }
        q.vie = Math.trunc(16 / (r.flottant() * 0.8 + 0.2)); q.physique = false; q.frottement = 1; q.gravite = 0;
        if (type === 'underwater') couleur(q, 0.4, 0.4, 0.7); else if (type === 'crimson_spore') couleur(q, 0.9, 0.4, 0.5); else if (type === 'warped_spore') { couleur(q, 0.1, 0.1, 0.3); taillerBoite(q, 0.001, 0.001); } else { q.vie = rnd.entierBorne(501) + 500; q.gravite = 0.01; couleur(q, 0.32, 0.5, 0.22); }
        return q;
      }
      case 'portal': case 'reverse_portal': {
        at(q); q.vx = v[0]; q.vy = v[1]; q.vz = v[2];
        q.taille = 0.1 * (r.flottant() * 0.2 + 0.5);
        const br = r.flottant() * 0.6 + 0.4; couleur(q, br * 0.9, br * 0.3, br);
        q.vie = Math.trunc(r.flottant() * 10) + 40; q.libre = true; q.lum = 'emission4';
        if (type === 'portal') { q.courbe = 'portail'; q.comp = 'portail'; q.extra = { depart: p.slice() }; } else { q.taille *= 1.5; q.vie = Math.trunc(r.flottant() * 2) + 60; q.courbe = 'portailInverse'; q.comp = 'portailInverse'; }
        hasardSprite(q);
        return q;
      }
      case 'enchant': {   // FlyTowardsPositionParticle
        at(q); q.vx = v[0]; q.vy = v[1]; q.vz = v[2];
        q.x = p[0] + v[0]; q.y = p[1] + v[1]; q.z = p[2] + v[2]; q.px = q.x; q.py = q.y; q.pz = q.z;
        q.taille = 0.1 * (r.flottant() * 0.5 + 0.2);
        const br = r.flottant() * 0.6 + 0.4; couleur(q, 0.9 * br, 0.9 * br, br);
        q.physique = false; q.vie = Math.trunc(r.flottant() * 10) + 30; q.libre = true; q.lum = 'emission4'; q.comp = 'vole'; q.extra = { depart: p.slice() };
        hasardSprite(q);
        return q;
      }
      case 'happy_villager': case 'mycelium': {   // SuspendedTownParticle
        hasardSprite(q); moving(q, v);
        const br = r.flottant() * 0.1 + 0.2; couleur(q, br, br, br);
        taillerBoite(q, 0.02, 0.02); q.taille *= r.flottant() * 0.6 + 0.5;
        q.vx *= f32(0.02); q.vy *= f32(0.02); q.vz *= f32(0.02);
        q.vie = Math.trunc(20 / (r.flottant() * 0.8 + 0.2)); q.libre = true; q.comp = 'suspendu';
        if (type === 'happy_villager') couleur(q, 1, 1, 1);
        return q;
      }
      case 'campfire_cosy_smoke': case 'campfire_signal_smoke': {
        at(q); echelle(q, 3); taillerBoite(q, 0.25, 0.25);
        q.vie = r.entierBorne(50) + (type === 'campfire_signal_smoke' ? 280 : 80);
        q.gravite = 3e-6; q.vx = v[0]; q.vy = v[1] + r.flottant() / 500; q.vz = v[2];
        q.rgba[3] = type === 'campfire_signal_smoke' ? 0.95 : 0.9; q.comp = 'feuCamp';
        hasardSprite(q);
        return q;
      }
      case 'dust': case 'dust_color_transition': {
        moving(q, v); q.frottement = 0.96; q.accel = true;
        q.vx *= f32(0.1); q.vy *= f32(0.1); q.vz *= f32(0.1);
        const ech = opt.echelle ?? 1;
        q.taille *= 0.75 * ech;
        q.vie = Math.max(1, Math.trunc(Math.trunc(8 / (r.reel() * 0.8 + 0.2)) * ech));
        const k = r.flottant() * 0.4 + 0.6, al = (c) => (r.flottant() * 0.2 + 0.8) * c * k;
        const c = opt.couleur ?? [1, 0, 0];
        const de = [al(c[0]), al(c[1]), al(c[2])];
        couleur(q, de[0], de[1], de[2]);
        if (type === 'dust_color_transition') { const vers = opt.vers ?? c; q.extra = { de, vers: [al(vers[0]), al(vers[1]), al(vers[2])] }; q.comp = 'transition'; } else q.comp = 'anime';
        q.courbe = 'croit'; q.auto = true;
        return q;
      }
      case 'end_rod': {   // SimpleAnimatedParticle
        at(q); q.frottement = 0.91; q.gravite = 0.0125; q.vx = v[0]; q.vy = v[1]; q.vz = v[2]; q.taille *= 0.75;
        q.vie = 60 + r.entierBorne(12); q.libre = true; q.lum = 'plein'; q.comp = 'animeSimple'; q.extra = { fondu: [0xF2 / 255, 0xDE / 255, 0xC9 / 255] }; q.auto = true;
        return q;
      }
      case 'cherry_leaves': case 'pale_oak_leaves': case 'tinted_leaves': case 'red_poplar_leaves': case 'orange_poplar_leaves': case 'yellow_poplar_leaves': {   // FallingLeavesParticle
        const cerisier = type === 'cherry_leaves';
        const [chute, cote, tourb, flux, ech, depart] = cerisier ? [0.25, 2, false, true, 1, 0] : [0.07, 10, true, false, 2, 0.021];
        at(q);
        hasardSprite(q);
        const vrot = (r.booleen() ? -30 : 30) * RAD, spin = (r.booleen() ? -5 : 5) * RAD;
        q.vie = 300; q.gravite = chute * 1.2 * 0.0025;
        const s = ech * (r.booleen() ? 0.05 : 0.075); q.taille = s; taillerBoite(q, s, s);
        q.frottement = 1; q.vy = -depart;
        const pr = r.flottant();
        q.extra = { vrot, spin, vent: cote, tourb, flux, fluxE: [Math.cos(pr * 60 * RAD) * cote, Math.sin(pr * 60 * RAD) * cote], periode: (1000 + pr * 3000) * RAD };
        if (type === 'tinted_leaves' && opt.couleur) couleur(q, opt.couleur[0], opt.couleur[1], opt.couleur[2]);
        q.comp = 'feuille';
        return q;
      }
      case 'falling_dust': {
        at(q); const c = opt.couleur ?? [1, 1, 1]; couleur(q, c[0], c[1], c[2]);
        q.taille *= 0.67499995;
        const base = Math.trunc(32 / (r.flottant() * 0.8 + 0.2)); q.vie = Math.max(1, Math.trunc(base * 0.9));
        q.extra = { vrot: (r.flottant() - 0.5) * 0.1 }; q.roll = r.flottant() * Math.PI * 2; q.oRoll = q.roll;
        q.courbe = 'croit'; q.comp = 'poussiere'; q.auto = true;
        return q;
      }
      case 'electric_spark': {
        moving(q, [0, 0, 0]); q.frottement = 0.96; q.accel = true; q.taille *= 0.75; q.physique = false; q.lum = 'emission';
        couleur(q, 1, 0.9, 1); q.vx = v[0] * 0.25; q.vy = v[1] * 0.25; q.vz = v[2] * 0.25; q.vie = rnd.entierBorne(2) + 2; q.comp = 'anime'; q.auto = true;
        return q;
      }
      case 'firefly': {
        const xa = 0.5 - rnd.reel(), ya = rnd.booleen() ? v[1] : -v[1], za = 0.5 - rnd.reel();
        hasardSprite(q); moving(q, [xa, ya, za]);
        q.accel = true; q.frottement = 0.96; q.taille *= 0.75; q.vx *= f32(0.8); q.vy *= f32(0.8); q.vz *= f32(0.8);
        q.vie = rnd.entreInclus(200, 300); echelle(q, 1.5); q.rgba[3] = 0; q.lum = 'luciole'; q.comp = 'luciole';
        return q;
      }
      default: return null;
    }
  }

  // Particle.move : collisions contre les boites des blocs (Entity.collideBoundingBox)
  function bouger(q, dx, dy, dz) {
    if (q.libre) { q.x += dx; q.y += dy; q.z += dz; return; }
    if (q.arret) return;
    const ox = dx, oy = dy, oz = dz, L2 = dx * dx + dy * dy + dz * dz;
    if (q.physique && L2 !== 0 && L2 < 1e4 && monde.lecteur) {
      const b = [q.x - q.l / 2, q.y, q.z - q.l / 2, q.x + q.l / 2, q.y + q.h, q.z + q.l / 2];
      const r = deplacerBoite(monde.lecteur, b, [dx, dy, dz], false, 0);
      dx = r.dx; dy = r.dy; dz = r.dz;
    }
    q.x += dx; q.y += dy; q.z += dz;
    if (Math.abs(oy) >= f32(1e-5) && Math.abs(dy) < f32(1e-5)) q.arret = true;
    q.sol = oy !== dy && oy < 0;
    if (ox !== dx) q.vx = 0;
    if (oz !== dz) q.vz = 0;
  }
  function baseTick(q) {
    q.px = q.x; q.py = q.y; q.pz = q.z;
    if (q.age++ >= q.vie) { q.mort = true; return; }
    q.vy -= 0.04 * q.gravite;
    const y0 = q.y;
    bouger(q, q.vx, q.vy, q.vz);
    if (q.accel && q.y === y0) { q.vx *= 1.1; q.vz *= 1.1; }
    q.vx *= q.frottement; q.vy *= q.frottement; q.vz *= q.frottement;
    if (q.sol) { q.vx *= f32(0.7); q.vz *= f32(0.7); }
  }
  const spriteAge = (q) => { if (!q.mort && q.auto) q.sprite = Math.max(0, Math.min(q.ens.length - 1, Math.floor(q.age * (q.ens.length - 1) / Math.max(1, q.vie)))); };
  const fluideIci = (q) => monde.fluideEn(Math.floor(q.x), Math.floor(q.y), Math.floor(q.z));

  function tick(q) {
    switch (q.comp) {
      case 'base': baseTick(q); break;
      case 'anime': baseTick(q); spriteAge(q); break;
      case 'transition': baseTick(q); spriteAge(q); break;
      case 'lave': baseTick(q); if (!q.mort && q.r.flottant() > q.age / q.vie) ajouter('smoke', [q.x, q.y, q.z], [q.vx, q.vy, q.vz]); break;
      case 'goutte': {
        const E = q.extra;
        q.px = q.x; q.py = q.y; q.pz = q.z;
        if (E.etape === 'pendChaud') { q.rgba[0] = 1; q.rgba[1] = 16 / (40 - q.vie + 16); q.rgba[2] = 4 / (40 - q.vie + 8); }
        if (q.vie-- <= 0) { q.mort = true; if ((E.etape === 'pend' || E.etape === 'pendChaud') && E.suite) ajouter(E.suite, [q.x, q.y, q.z], [q.vx, q.vy, q.vz]); }
        if (q.mort) return;
        q.vy -= q.gravite;
        bouger(q, q.vx, q.vy, q.vz);
        if (E.etape === 'pend' || E.etape === 'pendChaud') { q.vx *= 0.02; q.vy *= 0.02; q.vz *= 0.02; }
        else if (E.etape === 'tombe' && q.sol) q.mort = true;
        else if (E.etape === 'tombePose' && q.sol) { q.mort = true; if (E.suite) ajouter(E.suite, [q.x, q.y, q.z], [0, 0, 0]); if (E.son) o.son?.(E.son, [q.x, q.y, q.z], q.r.flottant() * 0.7 + 0.3, 1); }
        if (q.mort) return;
        q.vx *= f32(0.98); q.vy *= f32(0.98); q.vz *= f32(0.98);
        if (E.fluide) { const f = fluideIci(q); if (f && f.type === E.fluide && q.y < Math.floor(q.y) + f.hauteur) q.mort = true; }
        break;
      }
      case 'gouttelette': {
        q.px = q.x; q.py = q.y; q.pz = q.z;
        if (q.vie-- <= 0) { q.mort = true; return; }
        q.vy -= q.gravite; bouger(q, q.vx, q.vy, q.vz);
        q.vx *= f32(0.98); q.vy *= f32(0.98); q.vz *= f32(0.98);
        if (q.sol) { if (q.r.flottant() < 0.5) q.mort = true; q.vx *= f32(0.7); q.vz *= f32(0.7); }
        const f = fluideIci(q), bx = Math.floor(q.x), by = Math.floor(q.y), bz = Math.floor(q.z);
        const haut = Math.max(monde.hautCollision(bx, by, bz, q.x - bx, q.z - bz), f ? f.hauteur : 0);
        if (haut > 0 && q.y < by + haut) q.mort = true;
        break;
      }
      case 'colonne': baseTick(q); if (!q.mort && fluideIci(q)?.type !== 'water') q.mort = true; break;
      case 'courant': {
        q.px = q.x; q.py = q.y; q.pz = q.z;
        if (q.age++ >= q.vie) { q.mort = true; return; }
        const a = q.extra.angle;
        q.vx += f32(0.6 * Math.cos(a)); q.vz += f32(0.6 * Math.sin(a)); q.vx *= 0.07; q.vz *= 0.07;
        bouger(q, q.vx, q.vy, q.vz);
        if (fluideIci(q)?.type !== 'water' || q.sol) q.mort = true;
        q.extra.angle = a + 0.08;
        break;
      }
      case 'soufre': {
        baseTick(q);
        const E = q.extra, f = fluideIci(q);
        if (!(f && f.type === 'water' && f.source) || q.y >= E.y1 || q.y <= E.yp) q.mort = true;
        const ondule = () => { const v = q.r.flottant() * 0.003; return (q.r.booleen() ? v : -v) * 0.5; };
        q.vx += ondule(); q.vz += ondule();
        bouger(q, q.vx, 0, q.vz);
        q.taille = E.t0 + ((q.y - E.y0) / (E.y1 - E.y0)) * (0.15 - E.t0);
        E.yp = q.y;
        break;
      }
      case 'suspendu': q.px = q.x; q.py = q.y; q.pz = q.z; if (q.vie-- <= 0) { q.mort = true; return; } bouger(q, q.vx, q.vy, q.vz); q.vx *= 0.99; q.vy *= 0.99; q.vz *= 0.99; break;
      case 'portail': {
        q.px = q.x; q.py = q.y; q.pz = q.z;
        if (q.age++ >= q.vie) { q.mort = true; return; }
        const a = q.age / q.vie, pos = 1 - (-a + a * a * 2), d = q.extra.depart;
        q.x = d[0] + q.vx * pos; q.y = d[1] + q.vy * pos + (1 - a); q.z = d[2] + q.vz * pos;
        break;
      }
      case 'portailInverse': {
        q.px = q.x; q.py = q.y; q.pz = q.z;
        if (q.age++ >= q.vie) { q.mort = true; return; }
        const m = q.age / q.vie; q.x += q.vx * m; q.y += q.vy * m; q.z += q.vz * m;
        break;
      }
      case 'vole': {
        q.px = q.x; q.py = q.y; q.pz = q.z;
        if (q.age++ >= q.vie) { q.mort = true; return; }
        const pos = 1 - q.age / q.vie; let pp = 1 - pos; pp *= pp; pp *= pp;
        const d = q.extra.depart;
        q.x = d[0] + q.vx * pos; q.y = d[1] + q.vy * pos - pp * 1.2; q.z = d[2] + q.vz * pos;
        break;
      }
      case 'feuCamp': {
        q.px = q.x; q.py = q.y; q.pz = q.z;
        if (q.age++ < q.vie && q.rgba[3] > 0) {
          const r = q.r;
          q.vx += r.flottant() / 5000 * (r.booleen() ? 1 : -1);
          q.vz += r.flottant() / 5000 * (r.booleen() ? 1 : -1);
          q.vy -= q.gravite;
          bouger(q, q.vx, q.vy, q.vz);
          if (q.age >= q.vie - 60 && q.rgba[3] > 0.01) q.rgba[3] -= 0.015;
        } else q.mort = true;
        break;
      }
      case 'animeSimple': {
        baseTick(q); spriteAge(q);
        if (q.age > Math.floor(q.vie / 2)) {
          q.rgba[3] = 1 - (q.age - Math.floor(q.vie / 2)) / q.vie;
          const f = q.extra.fondu; for (let i = 0; i < 3; i++) q.rgba[i] += (f[i] - q.rgba[i]) * 0.2;
        }
        break;
      }
      case 'feuille': {
        const E = q.extra;
        q.px = q.x; q.py = q.y; q.pz = q.z;
        if (q.vie-- <= 0) q.mort = true;
        if (!q.mort) {
          const rel = Math.min(1, (300 - q.vie) / 300);
          let xa = 0, za = 0;
          if (E.flux) { xa += E.fluxE[0] * Math.pow(rel, 1.25); za += E.fluxE[1] * Math.pow(rel, 1.25); }
          if (E.tourb) { xa += rel * Math.cos(rel * E.periode) * E.vent; za += rel * Math.sin(rel * E.periode) * E.vent; }
          q.vx += xa * f32(0.0025); q.vz += za * f32(0.0025); q.vy -= q.gravite;
          E.vrot += E.spin / 20; q.oRoll = q.roll; q.roll += E.vrot / 20;
          bouger(q, q.vx, q.vy, q.vz);
          if (q.sol || (q.vie < 299 && (q.vx === 0 || q.vz === 0))) q.mort = true;
          if (!q.mort) { q.vx *= q.frottement; q.vy *= q.frottement; q.vz *= q.frottement; }
        }
        break;
      }
      case 'poussiere': {
        q.px = q.x; q.py = q.y; q.pz = q.z;
        if (q.age++ >= q.vie) { q.mort = true; return; }
        spriteAge(q);
        q.oRoll = q.roll; q.roll += Math.PI * q.extra.vrot * 2;
        if (q.sol) { q.oRoll = 0; q.roll = 0; }
        bouger(q, q.vx, q.vy, q.vz);
        q.vy -= f32(0.003); q.vy = Math.max(q.vy, f32(-0.14));
        break;
      }
      case 'luciole': {
        baseTick(q);
        if (!monde.estAir(Math.floor(q.x), Math.floor(q.y), Math.floor(q.z))) q.mort = true;
        else {
          q.rgba[3] = fondu(Math.min(1, Math.max(0, q.age / q.vie)), 0.3, 0.5);
          if (q.r.flottant() > 0.95 || q.age === 1) { const s = () => f32(-0.05 + 0.1 * q.r.flottant()); q.vx = s(); q.vy = s(); q.vz = s(); }
        }
        break;
      }
      default: baseTick(q);
    }
  }
  const fondu = (p, fi, fo) => (p >= 1 - fi ? (1 - p) / fi : p <= fo ? p / fo : 1);

  function ajouter(type, p, v, opt) {
    const q = creer(type, p, v, opt);
    if (!q) return;
    if (q.auto) spriteAge(q);
    suivant.push(q);
  }

  // ---------------------------------------------------------------- Block.animateTick (Horizon `block_animate_tick`)
  const E = (x, y, z) => monde.etat(x, y, z);
  const ent = (n) => rnd.entierBorne(n);
  const poudreRS = (p, ech = 1) => ajouter('dust', p, [0, 0, 0], { couleur: [1, 0, 0], echelle: ech });
  function animerBloc(c, b, x, y, z, centre) {
    const fx = x, fy = y, fz = z;
    switch (c.k) {
      case 'torche': { const p = [fx + 0.5, fy + 0.7, fz + 0.5]; ajouter('smoke', p, [0, 0, 0]); ajouter(c.flamme, p, [0, 0, 0]); break; }
      case 'torcheMur': { const p = [fx + 0.5 - 0.27 * c.f[0], fy + 0.7 + 0.22, fz + 0.5 - 0.27 * c.f[2]]; ajouter('smoke', p, [0, 0, 0]); ajouter(c.flamme, p, [0, 0, 0]); break; }
      case 'torcheRS': poudreRS([fx + 0.5 + (rnd.reel() - 0.5) * 0.2, fy + 0.7 + (rnd.reel() - 0.5) * 0.2, fz + 0.5 + (rnd.reel() - 0.5) * 0.2]); break;
      case 'torcheRSMur': poudreRS([fx + 0.5 + (rnd.reel() - 0.5) * 0.2 - 0.27 * c.f[0], fy + 0.7 + (rnd.reel() - 0.5) * 0.2 + 0.22, fz + 0.5 + (rnd.reel() - 0.5) * 0.2 - 0.27 * c.f[2]]); break;
      case 'four': {
        if (rnd.reel() < 0.1) o.son?.(c.haut ? 'block.blastfurnace.fire_crackle' : 'block.furnace.fire_crackle', [fx + 0.5, fy, fz + 0.5], 1, 1);
        const ss = rnd.reel() * 0.6 - 0.3, dx = c.f[0] ? c.f[0] * 0.52 : ss, dy = rnd.reel() * (c.haut ? 9 : 6) / 16, dz = c.f[2] ? c.f[2] * 0.52 : ss;
        const p = [fx + 0.5 + dx, fy + dy, fz + 0.5 + dz];
        ajouter('smoke', p, [0, 0, 0]); if (!c.haut) ajouter('flame', p, [0, 0, 0]);
        break;
      }
      case 'fumoir': if (rnd.reel() < 0.1) o.son?.('block.smoker.smoke', [fx + 0.5, fy, fz + 0.5], 1, 1); ajouter('smoke', [fx + 0.5, fy + 1.1, fz + 0.5], [0, 0, 0]); break;
      case 'feuCamp': {
        if (ent(10) === 0) { const v = 0.5 + rnd.flottant(), h = rnd.flottant() * 0.7 + 0.6; o.son?.('block.campfire.crackle', [fx + 0.5, fy + 0.5, fz + 0.5], v, h); }
        if (c.part && ent(5) === 0) { for (let i = 0; i < ent(1) + 1; i++) ajouter('lava', [fx + 0.5, fy + 0.5, fz + 0.5], [rnd.flottant() / 2, 5e-5, rnd.flottant() / 2]); }
        break;
      }
      case 'feuilles': {
        const bas = E(x, y - 1, z);
        if (o.pluieEn?.(x, y + 1, z) && ent(15) === 1) { if (!bas || !bas.peutOcclure || !bas.plein) ajouter('dripping_water', [fx + rnd.reel(), fy - 0.05, fz + rnd.reel()], [0, 0, 0]); }
        if (c.chute && rnd.flottant() < c.chute[1] && !(bas && bas.plein)) {
          const p = [fx + rnd.reel(), fy - 0.05, fz + rnd.reel()];
          let opt;
          if (c.chute[0] === 'tinted_leaves') { const col = c.teinte ?? o.feuillage?.(x, z) ?? 0x48B518; opt = { couleur: [((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255] }; }
          ajouter(c.chute[0], p, [0, 0, 0], opt);
        }
        break;
      }
      case 'portail': {
        if (ent(100) === 0) o.son?.('block.portal.ambient', [fx + 0.5, fy + 0.5, fz + 0.5], 0.5, rnd.flottant() * 0.4 + 0.8);
        const ici = b.id, enZ = E(x - 1, y, z)?.id === ici || E(x + 1, y, z)?.id === ici;
        for (let i = 0; i < 4; i++) {
          const p = [fx + rnd.reel(), fy + rnd.reel(), fz + rnd.reel()], v = [(rnd.flottant() - 0.5) * 0.5, (rnd.flottant() - 0.5) * 0.5, (rnd.flottant() - 0.5) * 0.5];
          const k = ent(2) * 2 - 1;
          if (enZ) { p[2] = fz + 0.5 + 0.25 * k; v[2] = rnd.flottant() * 2 * k; } else { p[0] = fx + 0.5 + 0.25 * k; v[0] = rnd.flottant() * 2 * k; }
          ajouter('portal', p, v);
        }
        break;
      }
      case 'enchant': {
        for (let ox = -2; ox <= 2; ox++) for (let oy = 0; oy <= 1; oy++) for (let oz = -2; oz <= 2; oz++) {
          if (Math.abs(ox) !== 2 && Math.abs(oz) !== 2) continue;
          if (ent(16) !== 0) continue;
          const pr = E(x + ox, y + oy, z + oz), entre = E(x + Math.trunc(ox / 2), y + oy, z + Math.trunc(oz / 2));
          if (pr?.fournit && entre?.transmet) ajouter('enchant', [fx + 0.5, fy + 2, fz + 0.5], [ox + rnd.flottant() - 0.5, oy - rnd.flottant() - 1, oz + rnd.flottant() - 0.5]);
        }
        break;
      }
      case 'tigeEnd': {
        const px = fx + 0.55 - rnd.flottant() * 0.1, py = fy + 0.55 - rnd.flottant() * 0.1, pz = fz + 0.55 - rnd.flottant() * 0.1, d = 0.4 - (rnd.flottant() + rnd.flottant()) * 0.4;
        if (ent(5) === 0) ajouter('end_rod', [px + c.f[0] * d, py + c.f[1] * d, pz + c.f[2] * d], [rnd.gaussien() * 0.005, rnd.gaussien() * 0.005, rnd.gaussien() * 0.005]);
        break;
      }
      case 'spores': {
        ajouter('falling_spore_blossom', [fx + rnd.reel(), fy + 0.7, fz + rnd.reel()], [0, 0, 0]);
        for (let i = 0; i < 14; i++) {
          const a = [x + ent(21) - 10, y - ent(10), z + ent(21) - 10];
          if (!E(a[0], a[1], a[2])?.plein) ajouter('spore_blossom_air', [a[0] + rnd.reel(), a[1] + rnd.reel(), a[2] + rnd.reel()], [0, 0, 0]);
        }
        break;
      }
      case 'pleure': {
        if (ent(5) === 0) {
          const d = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][ent(6)];
          if (d[1] !== 1 && !E(x + d[0], y + d[1], z + d[2])?.plein) {
            const off = (s) => (s === 0 ? rnd.reel() : 0.5 + s * 0.6);
            ajouter('dripping_obsidian_tear', [fx + off(d[0]), fy + off(d[1]), fz + off(d[2])], [0, 0, 0]);
          }
        }
        break;
      }
      case 'eponge': {
        const d = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][ent(6)];
        if (d[1] !== 1 && !E(x + d[0], y + d[1], z + d[2])?.plein) {
          let p;
          if (d[1] === -1) p = [fx + rnd.reel(), fy - 0.05, fz + rnd.reel()];
          else if (d[0] !== 0) { const yy = fy + rnd.reel() * 0.8, zz = fz + rnd.reel(); p = [fx + (d[0] > 0 ? 1.1 : 0.05), yy, zz]; }
          else { const yy = fy + rnd.reel() * 0.8, xx = fx + rnd.reel(); p = [xx, yy, fz + (d[2] > 0 ? 1.1 : 0.05)]; }
          ajouter('dripping_water', p, [0, 0, 0]);
        }
        break;
      }
      case 'mycelium': if (ent(10) === 0) ajouter('mycelium', [fx + rnd.reel(), fy + 1.1, fz + rnd.reel()], [0, 0, 0]); break;
      case 'bougies': for (const q of BOUGIES[Math.min(4, c.n)]) bougie([fx + q[0] / 16, fy + q[1] / 16, fz + q[2] / 16]); break;
      case 'gateauBougie': bougie([fx + 0.5, fy + 1, fz + 0.5]); break;
      case 'alambic': ajouter('smoke', [fx + 0.4 + rnd.flottant() * 0.2, fy + 0.7 + rnd.flottant() * 0.3, fz + 0.4 + rnd.flottant() * 0.2], [0, 0, 0]); break;
      case 'ghastSec': {
        const ce = [fx + 0.5, fy + 0.5, fz + 0.5];
        if (c.eau) { if (ent(40) === 0) o.son?.('block.dried_ghast.ambient_water', ce, 1, 1); if (ent(6) === 0) ajouter('happy_villager', [ce[0] + (rnd.flottant() * 2 - 1) / 3, ce[1] + 0.4, ce[2] + (rnd.flottant() * 2 - 1) / 3], [0, rnd.flottant(), 0]); }
        else { if (ent(40) === 0 && /^soul_(sand|soil)$/.test(E(x, y - 1, z)?.nom ?? '')) o.son?.('block.dried_ghast.ambient', ce, 1, 1); if (ent(6) === 0) ajouter('white_smoke', ce, [0, 0.02, 0]); }
        break;
      }
      case 'lucioles': {
        if (ent(30) === 0 && o.lucioleSon?.(x, y, z)) o.son?.('block.firefly_bush.idle', [fx, fy, fz], 1, 1);
        if ((o.lumiereBrute?.(x, y, z) ?? 15) <= 13 && rnd.reel() <= 0.7) ajouter('firefly', [fx + rnd.reel() * 10 - 5, fy + rnd.reel() * 5, fz + rnd.reel() * 10 - 5], [0, 0, 0]);
        break;
      }
      case 'portailEnd': ajouter('smoke', [fx + rnd.reel(), fy + 0.8, fz + rnd.reel()], [0, 0, 0]); break;
      case 'levier': if (rnd.flottant() < 0.25) { const a = (base, i) => base + 0.5 + 0.1 * -c.f[i] + 0.2 * -c.lie[i]; poudreRS([a(fx, 0), a(fy, 1), a(fz, 2)], 0.5); } break;
      case 'repeteur': {
        const px = fx + 0.5 + (rnd.reel() - 0.5) * 0.2, py = fy + 0.4 + (rnd.reel() - 0.5) * 0.2, pz = fz + 0.5 + (rnd.reel() - 0.5) * 0.2;
        let off = -5; if (rnd.booleen()) off = c.delai * 2 - 1; off /= 16;
        poudreRS([px + off * c.f[0], py, pz + off * c.f[2]]);
        break;
      }
      case 'stalactite': stalactite(x, y, z); break;
      case 'roseWither': { const off = monde.decalage?.(x, z) ?? [0, 0]; const cx = fx + 0.5 + off[0], cz = fz + 0.5 + off[1]; for (let i = 0; i < 3; i++) if (rnd.booleen()) ajouter('smoke', [cx + rnd.reel() / 5, fy + (0.5 - rnd.reel()), cz + rnd.reel() / 5], [0, 0, 0]); break; }
      case 'passageEnd': {
        const nb = [[0, 1, 0], [0, -1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]].filter((d) => !E(x + d[0], y + d[1], z + d[2])?.opaque).length;   // une particule par face visible
        for (let i = 0; i < nb; i++) {
          const p = [fx + rnd.reel(), fy + rnd.reel(), fz + rnd.reel()], v = [(rnd.reel() - 0.5) * 0.5, (rnd.reel() - 0.5) * 0.5, (rnd.reel() - 0.5) * 0.5];
          const k = ent(2) * 2 - 1;
          if (rnd.booleen()) { p[2] = fz + 0.5 + 0.25 * k; v[2] = rnd.flottant() * 2 * k; } else { p[0] = fx + 0.5 + 0.25 * k; v[0] = rnd.flottant() * 2 * k; }
          ajouter('portal', p, v);
        }
        break;
      }
      case 'paratonnerre': {
        if (o.orage?.() && ent(200) <= (o.temps?.() ?? 0) % 200 && y === (monde.surface?.(x, z) ?? y + 1) - 1) {
          const n = ent(2) + 1;   // ParticleUtils.spawnParticlesAlongAxis(axe, ..., UniformInt(1, 2))
          for (let i = 0; i < n; i++) {
            const t = (rnd.reel() - 0.5) * 1.1, p = [fx + 0.5, fy + 0.5, fz + 0.5], v = [0, 0, 0];
            for (let k = 0; k < 3; k++) { if (k === c.axe) p[k] += t; else { const dd = rnd.reel() * 2 - 1; p[k] += dd * 0.55; } v[k] = (rnd.reel() * 2 - 1) * 0.3; }
            ajouter('electric_spark', p, v);
          }
        }
        break;
      }
      case 'coffreEnder': {
        for (let i = 0; i < 3; i++) {
          const kx = ent(2) * 2 - 1, kz = ent(2) * 2 - 1;
          ajouter('portal', [fx + 0.5 + 0.25 * kx, f32(y + rnd.flottant()), fz + 0.5 + 0.25 * kz], [rnd.flottant() * kx, (rnd.flottant() - 0.5) * 0.125, rnd.flottant() * kz]);
        }
        break;
      }
      case 'chute': {
        if (ent(16) === 0) {
          const bas = E(x, y - 1, z);
          if (!bas || bas.remplacable || bas.fluide || bas.air) {
            const col = c.c;
            ajouter('falling_dust', [fx + rnd.reel(), fy - 0.05, fz + rnd.reel()], [0, 0, 0], { couleur: [((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255] });
          }
        }
        break;
      }
      case 'ruche': { for (let i = 0; i < ent(1) + 1; i++) gouttesRuche(x, y, z, b); break; }
      case 'minerai': {
        for (const d of [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]]) {
          if (E(x + d[0], y + d[1], z + d[2])?.opaque) continue;
          const cc = (s) => (s !== 0 ? 0.5 + 0.5625 * s : rnd.flottant());
          poudreRS([fx + cc(d[0]), fy + cc(d[1]), fz + cc(d[2])]);
        }
        break;
      }
      case 'poudre': {
        const col = couleurPoudre(c.pw), H = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
        const ligne = (cote, le, de, a) => {
          const span = a - de;
          if (rnd.flottant() < 0.2 * span) {
            const on = de + span * rnd.flottant(), cc = (i) => 0.5 + 0.4375 * cote[i] + on * le[i];
            ajouter('dust', [fx + cc(0), fy + cc(1), fz + cc(2)], [0, 0, 0], { couleur: col, echelle: 1 });
          }
        };
        H.forEach((h, i) => { const s = c.cotes[i]; if (s === 2) { ligne(h, [0, 1, 0], -0.5, 0.5); ligne([0, -1, 0], h, 0, 0.5); } else if (s === 1) ligne([0, -1, 0], h, 0, 0.5); else ligne([0, -1, 0], h, 0, 0.3); });
        break;
      }
      case 'sculk': {
        const d = rnd.entierBorne(6);
        if (d >= 2) {
          const st = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][d - 2];
          const px = fx + 0.5 + (st[0] === 0 ? 0.5 - rnd.reel() : st[0] * 0.6), pz = fz + 0.5 + (st[2] === 0 ? 0.5 - rnd.reel() : st[2] * 0.6);
          ajouter('dust_color_transition', [px, fy + 0.25, pz], [0, rnd.flottant() * 0.04, 0], { couleur: [0x3C / 255, 0xA4 / 255, 0xA4 / 255], vers: [1, 0, 0], echelle: 1 });   // SculkSensorBlock : DustColorTransitionOptions.SCULK_TO_REDSTONE
        }
        break;
      }
      case 'ancre': {
        if (ent(100) === 0) o.son?.('block.respawn_anchor.ambient', [fx + 0.5, fy + 0.5, fz + 0.5], 1, 1);
        ajouter('reverse_portal', [fx + 0.5 + (0.5 - rnd.reel()), fy + 1, fz + 0.5 + (0.5 - rnd.reel())], [0, rnd.flottant() * 0.04, 0]);
        break;
      }
      case 'bulles': {
        if (c.bas) { ajouter('current_down', [fx + 0.5, fy + 0.8, fz], [0, 0, 0]); if (ent(200) === 0) o.son?.('block.bubble_column.whirlpool_ambient', [fx, fy, fz], 0.2 + rnd.flottant() * 0.2, 0.9 + rnd.flottant() * 0.15); }
        else {
          ajouter('bubble_column_up', [fx + 0.5, fy, fz + 0.5], [0, 0.04, 0]);
          ajouter('bubble_column_up', [fx + rnd.flottant(), fy + rnd.flottant(), fz + rnd.flottant()], [0, 0.04, 0]);
          if (ent(200) === 0) o.son?.('block.bubble_column.upwards_ambient', [fx, fy, fz], 0.2 + rnd.flottant() * 0.2, 0.9 + rnd.flottant() * 0.15);
        }
        break;
      }
      case 'feu': {
        if (ent(24) === 0) o.son?.('block.fire.ambient', [fx + 0.5, fy + 0.5, fz + 0.5], 1 + rnd.flottant(), rnd.flottant() * 0.7 + 0.3);
        const brule = (xx, yy, zz) => c.ame || !!E(xx, yy, zz)?.brulable;
        const bas = E(x, y - 1, z);
        if (!brule(x, y - 1, z) && !(bas && bas.solideHaut)) {
          for (const [at, axe, haut] of [[[x - 1, y, z], 0, false], [[x + 1, y, z], 0, true], [[x, y, z - 1], 2, false], [[x, y, z + 1], 2, true], [[x, y + 1, z], 1, true]]) {
            if (!brule(at[0], at[1], at[2])) continue;
            for (let i = 0; i < 2; i++) {
              const d = [rnd.reel(), rnd.reel(), rnd.reel()], p = [fx + d[0], fy + d[1], fz + d[2]];
              p[axe] = haut ? [x, y, z][axe] + 1 - d[axe] * f32(0.1) : [x, y, z][axe] + d[axe] * f32(0.1);
              ajouter('large_smoke', p, [0, 0, 0]);
            }
          }
        } else for (let i = 0; i < 3; i++) ajouter('large_smoke', [fx + rnd.reel(), fy + rnd.reel() * 0.5 + 0.5, fz + rnd.reel()], [0, 0, 0]);
        break;
      }
      default: break;
    }
  }
  function bougie(p) {
    const ch = rnd.flottant();
    if (ch < 0.3) { ajouter('smoke', p, [0, 0, 0]); if (ch < 0.17) o.son?.('block.candle.ambient', [p[0] + 0.5, p[1] + 0.5, p[2] + 0.5], 1 + rnd.flottant(), rnd.flottant() * 0.7 + 0.3); }
    ajouter('small_flame', p, [0, 0, 0]);
  }
  function gouttesRuche(x, y, z, b) {
    if (b.fluide || rnd.flottant() < 0.3) return;
    const f = monde.formeY(x, y, z);
    if (!f || f.haut < 1 || b.impermeable) return;
    let yy;
    if (f.bas > 0) yy = y + f.bas - 0.05;
    else { const fb = monde.formeY(x, y - 1, z), bas = E(x, y - 1, z); if (((fb ? fb.haut : 1) < 1 || !(bas && bas.plein)) && !(bas && bas.fluide)) yy = y - 0.05; else return; }
    const a = rnd.reel(), c2 = rnd.reel();
    ajouter('dripping_honey', [x + f.b[0] + (f.b[1] - f.b[0]) * a, yy, z + f.b[2] + (f.b[3] - f.b[2]) * c2], [0, 0, 0]);
  }
  function stalactite(x, y, z) {
    const roll = rnd.flottant();
    if (roll > 0.12) return;
    let racine = null;
    for (let s = 1; s < 11; s++) {
      const e = E(x, y + s, z), n = e?.nom;
      if (n !== 'pointed_dripstone') { racine = [x, y + s, z]; break; }
      if (e.props.vertical_direction !== 'down') return;
    }
    if (!racine) return;
    const dessus = E(racine[0], racine[1] + 1, racine[2]);
    const fl = dessus?.nom === 'mud' && !o.ultrachaud ? 'water' : dessus?.fluide ?? null;
    if (roll >= 0.02 && !fl) return;
    const lave = fl === 'lava' || (!fl && o.ultrachaud);
    const off = monde.decalage?.(x, z) ?? [0, 0];
    ajouter(lave ? 'dripping_dripstone_lava' : 'dripping_dripstone_water', [x + 0.5 + off[0], y + 0.3125 - 0.0625, z + 0.5 + off[1]], [0, 0, 0]);
  }
  // ClientLevel.trySpawnDripParticles : sous un fluide
  function goutteFluide(x, y, z, type, hautPlein) {
    const b = E(x, y, z);
    if (!b || b.fluide) return;
    const f = monde.formeY(x, y, z);
    if (!f) return;
    const pose = (x1, x2, z1, z2, yy) => { const a = rnd.reel(), c2 = rnd.reel(); ajouter(type, [x1 + (x2 - x1) * a, yy, z1 + (z2 - z1) * c2], [0, 0, 0]); };
    if (f.haut < 1) { if (hautPlein) pose(x, x + 1, z, z + 1, y + 1 - 0.05); }
    else if (!b.impermeable) {
      if (f.bas > 0) pose(x + f.b[0], x + f.b[1], z + f.b[2], z + f.b[3], y + f.bas - 0.05);
      else { const fb = monde.formeY(x, y - 1, z), bas = E(x, y - 1, z); if ((fb ? fb.haut : 1) < 1 && !(bas && bas.fluide)) pose(x + f.b[0], x + f.b[1], z + f.b[2], z + f.b[3], y - 0.05); }
    }
  }
  // FluidState.animateTick
  function animerFluide(b, x, y, z) {
    const fl = b.fluide;
    if (fl === 'water') {
      if (!b.source && !b.chute) { if (ent(64) === 0) o.son?.('block.water.ambient', [x + 0.5, y + 0.5, z + 0.5], rnd.flottant() * 0.25 + 0.75, rnd.flottant() + 0.5); }
      else if (ent(10) === 0) ajouter('underwater', [x + rnd.reel(), y + rnd.reel(), z + rnd.reel()], [0, 0, 0]);
      return;
    }
    if (E(x, y + 1, z)?.air) {
      if (ent(100) === 0) { const p = [x + rnd.reel(), y + 1, z + rnd.reel()]; ajouter('lava', p, [0, 0, 0]); o.son?.('block.lava.pop', p, 0.2 + rnd.flottant() * 0.2, 0.9 + rnd.flottant() * 0.15); }
      if (ent(200) === 0) o.son?.('block.lava.ambient', [x, y, z], 0.2 + rnd.flottant() * 0.2, 0.9 + rnd.flottant() * 0.15);
    }
  }
  function unCoup(centre, R) {
    const x = centre[0] + ent(R) - ent(R), y = centre[1] + ent(R) - ent(R), z = centre[2] + ent(R) - ent(R);
    const b = E(x, y, z);
    if (!b) return;
    const c = b.classe;
    if (c) animerBloc(c, b, x, y, z, centre);
    if (b.fluide) {
      animerFluide(b, x, y, z);
      if (ent(10) === 0) goutteFluide(x, y - 1, z, b.fluide === 'water' ? 'dripping_water' : 'dripping_lava', b.basPlein);
    }
    if (!b.plein) {
      for (const [type, proba] of o.ambiance?.(o.biomeEn?.(x, z)) ?? []) if (rnd.flottant() <= proba) ajouter(type, [x + rnd.reel(), y + rnd.reel(), z + rnd.reel()], [0, 0, 0]);
    }
  }
  // CampfireBlockEntity.particleTick (tous les feux de camp allumes connus)
  function feuxDeCamp() {
    for (const [x, y, z, signal] of monde.feuxDeCamp?.() ?? []) {
      if (rnd.flottant() < 0.11) {
        for (let fait = 0; ; fait++) {
          if (fait >= ent(2) + 2) break;
          const sg = () => (rnd.booleen() ? 1 : -1);
          const dx = rnd.reel() / 3, px = x + 0.5 + dx * sg(), py = y + rnd.reel() + rnd.reel(), dz = rnd.reel() / 3, pz = z + 0.5 + dz * sg();
          ajouter(signal ? 'campfire_signal_smoke' : 'campfire_cosy_smoke', [px, py, pz], [0, 0.07, 0]);
        }
      }
    }
  }

  return {
    liste,
    ajouter,
    // un tick du client : particules qui vivent (ParticleEngine.tick), puis animateTick autour de `centre` (cellule de la camera)
    tick(centre) {
      suivant = [];   // particules nees pendant ce tick (goutte qui tombe, fumee de la lave...) : ajoutees a la fin, comme ParticleEngine
      for (const q of liste) tick(q);
      for (let i = liste.length - 1; i >= 0; i--) if (liste[i].mort) liste.splice(i, 1);
      feuxDeCamp();
      for (let i = 0; i < 667; i++) { unCoup(centre, 16); unCoup(centre, 32); }
      for (const q of suivant) if (liste.length < MAX) liste.push(q);
      suivant = [];
    },
  };
}

// ---------------------------------------------------------------- dessin
// Quad face a la camera (SingleQuadParticle.render : rotation `roll` autour de l'axe de vue), taille selon la courbe, couleur x lumiere.
export function tailleQuad(q, a) {
  const t = (q.age + a) / q.vie;
  switch (q.courbe) {
    case 'croit': return q.taille * Math.min(1, Math.max(0, t * 32));
    case 'flamme': return q.taille * (1 - t * t * 0.5);
    case 'lave': return q.taille * (1 - t * t);
    case 'portail': { const s = 1 - t; return q.taille * (1 - s * s); }
    case 'portailInverse': return q.taille * (1 - (q.age + a) / (q.vie * 1.5));
    default: return q.taille;
  }
}

const CHAUFFE = 200;
// Ambiance d'une scene : le monde lu (monde vivant ou zone), la graine, la meteo ; rend { maillages(u, camera, meteo) }.
// `lireMonde(tick)` : fixe le monde au tick (terrain vivant) ; `monde` : voir creerMoteurAmbiance.
export function creerAmbiance({ monde, lireMonde = null, graine = 1, kit, lumiere, feuillage, biomeEn, ambianceBiome, pluieEn, orage, temps, son = null, ultrachaud = false, lumiereBrute = null, lucioleSon = null }) {
  const dirTex = path.join(kit, 'assets', 'minecraft', 'textures', 'particle');
  const pngs = new Map();
  const tex = (nom, a = 1) => {
    const cle = nom + '@' + a;
    if (pngs.has(cle)) return pngs.get(cle);
    let t = null;
    try {
      const im = decoderPNGsync(path.join(dirTex, nom + '.png'));
      t = { largeur: im.largeur, hauteur: im.hauteur, rgba: im.rgba };
      if (a < 1) { const rgba = new Uint8Array(t.rgba); for (let i = 3; i < rgba.length; i += 4) rgba[i] = Math.round(rgba[i] * a); t = { ...t, rgba }; }
    } catch { t = null; }
    pngs.set(cle, t);
    return t;
  };
  let moteur = null, tickCourant = -1, meteoCourante = null;
  const neuf = () => {
    moteur = creerMoteurAmbiance(monde, { graine, feuillage, biomeEn, ambiance: ambianceBiome, pluieEn: (x, y, z) => pluieEn?.(x, y, z, meteoCourante) ?? false, orage: () => orage?.(meteoCourante) ?? false, temps: () => tickCourant, son, ultrachaud, lumiereBrute, lucioleSon });
    tickCourant = -1;
  };
  neuf();
  return {
    moteur: () => moteur,
    maillages(u, camera, meteo = null) {
      const tick = Math.floor(u);
      if (tick < tickCourant) neuf();
      meteoCourante = meteo;
      const centre = [Math.floor(camera.x), Math.floor(camera.y), Math.floor(camera.z)];
      // le monde du jeu tourne deja quand le film commence : CHAUFFE ticks avant le premier, pour que la fumee des feux de camp (80 a 330 ticks
      // de vie), les feuilles qui tombent et les gouttes soient deja la, en regime, a la premiere image
      if (tickCourant === -1) { lireMonde?.(0); for (let i = 0; i < CHAUFFE; i++) moteur.tick(centre); }
      while (tickCourant < tick) { tickCourant++; lireMonde?.(tickCourant); moteur.tick(centre); }
      const L = moteur.liste;
      if (!L.length) return [];
      const ya = camera.lacet * RAD, pa = camera.tangage * RAD;
      const f = [-Math.sin(ya) * Math.cos(pa), -Math.sin(pa), Math.cos(ya) * Math.cos(pa)], r = [-Math.cos(ya), 0, -Math.sin(ya)];
      const h = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      const frac = u - tick, groupes = new Map();
      for (const q of L) {
        if (q.mort) continue;
        const s = tailleQuad(q, frac);
        const a = Math.max(0, Math.min(1, q.rgba[3]));
        if (s <= 0 || a <= 0.004) continue;
        const sprite = q.ens[q.sprite] ?? q.ens[0];
        const trans = TRANSLUCIDES.has(q.type) || a < 0.999;
        const qa = trans ? Math.max(1, Math.round(a * 16)) : 16;
        const cle = sprite + '@' + qa + (trans ? 'm' : 'd');
        let g = groupes.get(cle); if (!g) { g = { sprite, a: qa / 16, mode: trans ? 'melange' : 'decoupe', pos: [], uv: [], col: [], idx: [] }; groupes.set(cle, g); }
        const x = q.px + (q.x - q.px) * frac, y = q.py + (q.y - q.py) * frac, z = q.pz + (q.z - q.pz) * frac;
        const roll = q.oRoll + (q.roll - q.oRoll) * frac, cr = Math.cos(roll), sr = Math.sin(roll);
        const ux = (r[0] * cr + h[0] * sr) * s, uy = (r[1] * cr + h[1] * sr) * s, uz = (r[2] * cr + h[2] * sr) * s;
        const vx = (h[0] * cr - r[0] * sr) * s, vy = (h[1] * cr - r[1] * sr) * s, vz = (h[2] * cr - r[2] * sr) * s;
        const t01 = Math.min(1, Math.max(0, (q.age + frac) / q.vie));
        const L0 = lumiere(x, y, z, q.lum, t01, q);
        let c = q.rgba;
        if (q.comp === 'transition') { const E = q.extra, k = (q.age + frac) / (q.vie + 1); c = [E.de[0] + (E.vers[0] - E.de[0]) * k, E.de[1] + (E.vers[1] - E.de[1]) * k, E.de[2] + (E.vers[2] - E.de[2]) * k]; }
        const b0 = g.pos.length / 3;
        g.pos.push(x - ux + vx, y - uy + vy, z - uz + vz, x + ux + vx, y + uy + vy, z + uz + vz, x + ux - vx, y + uy - vy, z + uz - vz, x - ux - vx, y - uy - vy, z - uz - vz);
        g.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        for (let i = 0; i < 4; i++) g.col.push(c[0] * L0, c[1] * L0, c[2] * L0);
        g.idx.push(b0, b0 + 3, b0 + 2, b0, b0 + 2, b0 + 1);
      }
      const out = [];
      for (const g of groupes.values()) {
        const t = tex(g.sprite, g.mode === 'melange' ? g.a : 1);
        if (!t) continue;
        out.push({ positions: Float32Array.from(g.pos), uvs: Float32Array.from(g.uv), couleurs: Float32Array.from(g.col), indices: Uint32Array.from(g.idx), texture: t, mode: g.mode, deuxFaces: true, genre: 'particule' });
      }
      return out;
    },
  };
}

import { decoderPNG } from '../rendu/png.js';
function decoderPNGsync(f) { return decoderPNG(fs.readFileSync(f)); }

// ---------------------------------------------------------------- une scene : le monde (vivant ou la zone), la lumiere, les biomes, la pluie
// rs : rendu/scene.js ; terrain : film/terrain-vivant.js (scene avec monde) ou null ; donnees : tables du jeu ; replay : celui de la simulation (ou null)
import { D } from '../moteur/donnees.js';
import { CouleursBiomes } from '../rendu/teinte.js';
export function creerAmbianceScene({ rs, scene, kit, terrain = null, donnees, replay = null, son = null }) {
  const d = donnees, zone = rs.zone;
  let etatEn;
  if (terrain?.lec) etatEn = (x, y, z) => terrain.lec.etatEn(x, y, z);
  else {
    const parPal = new Int32Array(zone.palette.length).fill(-2);
    etatEn = (x, y, z) => {
      const i = zone.paletteEn(x, y, z);
      if (parPal[i] === -2) { const s = zone.palette[i]; parPal[i] = s === '#hidden' ? d.pierre : d.etatId(s); }
      return parPal[i];
    };
  }
  const lecteur = terrain?.lec ?? { d, etatEn };
  const etiq = (n) => d.etiquette(n);
  const imperm = etiq('impermeable'), transmet = etiq('enchantment_power_transmitter'), fournit = etiq('enchantment_power_provider');
  const cache = new Map();
  const decrit = (id) => {
    let e = cache.get(id);
    if (e) return e;
    const nom = d.nomBloc(id), props = d.props(id), b = d.blocDe(id), fl = d.fluide(id);
    const fluide = fl === 1 || fl === 2 ? 'water' : fl === 3 || fl === 4 ? 'lava' : null;
    const niveau = +(props.level ?? 0);
    const source = fluide ? (nom === 'water' || nom === 'lava' ? niveau === 0 : true) : false, chute = fluide && (nom === 'water' || nom === 'lava') && niveau >= 8;
    const quantite = !fluide ? 0 : source || chute ? 8 : 8 - niveau;
    const [allume] = d.feu(b);
    e = { id, nom, props, classe: classer(nom, props), fluide, source, chute, hauteurFl: fluide ? (chute ? 1 : quantite / 9) : 0,
      plein: d.a(id, D.COLLISION_PLEINE), opaque: d.a(id, D.RENDU_PLEIN), remplacable: d.a(id, D.REMPLACABLE), air: d.esAir(id), peutOcclure: d.a(id, D.PEUT_OCCLURE),
      solideHaut: d.solideFace(id, 1, 0), basPlein: d.solideFace(id, 0, 0), brulable: allume > 0 && props.waterlogged !== 'true', impermeable: imperm.has(b), transmet: transmet.has(b), fournit: fournit.has(b), boites: d.boites(id) };
    cache.set(id, e);
    return e;
  };
  const etat = (x, y, z) => { const id = etatEn(x, y, z); return id >= 0 ? decrit(id) : null; };
  const formeY = (x, y, z) => {
    const e = etat(x, y, z); if (!e) return null;
    if (!e.boites.length) return { bas: 0, haut: 0, b: [0, 0, 0, 0] };
    let y0 = 1, y1 = 0, x0 = 1, x1 = 0, z0 = 1, z1 = 0;
    for (const q of e.boites) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[4]); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[3]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[5]); }
    return { bas: y0, haut: y1, b: [x0, x1, z0, z1] };
  };
  // biomes : couleur du feuillage (melangee comme les blocs), precipitation, particules d'ambiance (attribut visual/ambient_particles)
  let couleurs = null; try { couleurs = new CouleursBiomes(kit).tableaux(zone, 2); } catch { couleurs = null; }
  const col = (x, z) => Math.min(zone.sz - 1, Math.max(0, z - zone.z0)) * zone.sx + Math.min(zone.sx - 1, Math.max(0, x - zone.x0));
  const jsonBiome = new Map();
  const biome = (nom) => {
    const id = String(nom || 'plains').replace(/^minecraft:/, '');
    if (!jsonBiome.has(id)) { let j = null; try { j = JSON.parse(fs.readFileSync(path.join(kit, 'data', 'minecraft', 'worldgen', 'biome', id + '.json'), 'utf8')); } catch { j = null; } jsonBiome.set(id, j); }
    return jsonBiome.get(id);
  };
  const ambianceBiome = (nom) => {
    const j = biome(nom); if (!j) return [];
    const l = j.attributes?.['minecraft:visual/ambient_particles'], e = Array.isArray(l) ? l : Array.isArray(l?.argument) ? l.argument : [];
    return e.map((x) => [String(x?.particle?.type ?? '').replace(/^minecraft:/, ''), Number(x?.probability ?? 0)]).filter(([t]) => ENSEMBLES[t]);
  };
  const pluieBiome = (x, z) => { const j = biome(zone.biome(x, z)); return !!j && j.has_precipitation !== false && (j.temperature ?? 0.8) >= 0.15; };
  const surface = (x, z) => zone.hauteur(x, z) + 1;
  // lumiere d'une particule (Particle.getLightCoords : monde, plein, bloc 15, emission selon l'age, luciole)
  const lumiere = (x, y, z, mode, t) => {
    if (mode === 'plein') return 1;
    const n = rs.niveauxEn?.(x, y, z);
    const viaTable = (c, b) => rs.luminositeNiveaux?.(c, b) ?? null;
    const brut = () => (typeof rs.luminositeEn === 'function' ? rs.luminositeEn(x, y, z) : 1);
    if (mode === 'monde') return brut();
    if (mode === 'luciole') { const f = t >= 0.9 ? (1 - t) / 0.1 : t <= 0.3 ? t / 0.3 : 1; return n ? viaTable(0, 15 * f) ?? f : f; }
    const k = mode === 'bloc15' ? 1 : mode === 'emission4' ? t * t * t * t : t;
    if (n) { const v = viaTable(n.ciel, mode === 'bloc15' ? 15 : Math.min(15, n.bloc + k * 15)); if (v !== null) return v; }
    const l = brut(); return l + (1 - l) * k;
  };
  // feux de camp allumes : relus toutes les 20 ticks autour de la camera (CampfireBlockEntity.particleTick de chaque feu charge)
  const palette = [...zone.palette, ...(replay?.palAjouts ?? [])];
  const aDesFeux = palette.some((s) => /^minecraft:(soul_)?campfire\[.*lit=true/.test(s));
  let feux = [], derniereLecture = -1e9, centreF = null;
  const monde = {
    lecteur, etat, formeY,
    fluideEn: (x, y, z) => { const e = etat(x, y, z); return e && e.fluide ? { type: e.fluide, hauteur: e.hauteurFl, source: e.source } : null; },
    hautCollision: (x, y, z) => { const f = formeY(x, y, z); return f ? f.haut : 0; },
    estAir: (x, y, z) => { const e = etat(x, y, z); return !e || e.air; },
    surface,
    feuxDeCamp: () => feux,
  };
  let tickCourant = 0;
  const amb = creerAmbiance({
    monde, graine: (scene.monde?.graine ?? 1) * 31 + 7, kit, lumiere, son,
    lireMonde: (tick) => {
      tickCourant = tick; terrain?.regle?.(tick);
      if (aDesFeux && centreF && tick - derniereLecture >= 20) {
        derniereLecture = tick; feux = [];
        const [X, Y, Z] = centreF;
        for (let y = Y - 24; y <= Y + 24; y++) for (let z = Z - 48; z <= Z + 48; z++) for (let x = X - 48; x <= X + 48; x++) { const e = etat(x, y, z); if (e?.classe?.k === 'feuCamp') feux.push([x, y, z, e.props.signal_fire === 'true']); }
      }
    },
    feuillage: (x, z) => (couleurs ? couleurs.feuillage[col(x, z)] : 0x48B518), biomeEn: (x, z) => zone.biome(x, z), ambianceBiome,
    pluieEn: (x, y, z, meteo) => !!meteo && meteo.pluie > 0 && y >= surface(x, z) && pluieBiome(x, z), orage: (meteo) => !!meteo && meteo.orage > 0,
    ultrachaud: scene.monde?.dimension === 'nether', lumiereBrute: (x, y, z) => { const n = rs.niveauxEn?.(x, y, z); return n ? Math.max(n.bloc, n.ciel) : 15; },
  });
  void tickCourant;
  return {
    maillages(u, camera, meteo) { centreF = [Math.floor(camera.x), Math.floor(camera.y), Math.floor(camera.z)]; return amb.maillages(u, camera, meteo); },
    moteur: amb.moteur,
  };
}