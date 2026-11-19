// Definition du kit de base : groupes, chemins, ecriture dans le cache, empreinte.
// Rien ici n'est un fichier du jeu : ce sont seulement des noms de dossiers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SOUND_MATERIALS = ['grass', 'stone', 'wood', 'sand', 'gravel', 'snow'];
export const SOUND_EVENTS_PAS = SOUND_MATERIALS.map((m) => `block.${m}.step`);
// Sons du MONDE SIMULE (docs/SIMULATION.md, partie 9) : pose, casse et coups de blocs des principaux materiaux, portes, trappes, portillons,
// boutons, plaques, levier, coffres, cloche, bloc musical, TNT et explosions. Les noms sont ceux de sounds.json.
export const MATERIAUX_MONDE = ['grass', 'stone', 'wood', 'sand', 'gravel', 'snow', 'wool', 'glass', 'metal', 'deepslate'];
export const SOUND_EVENTS_MONDE = [
  ...MATERIAUX_MONDE.flatMap((m) => ['break', 'place', 'hit', 'step'].map((k) => `block.${m}.${k}`)),
  'block.wooden_door.open', 'block.wooden_door.close', 'block.iron_door.open', 'block.iron_door.close',
  'block.wooden_trapdoor.open', 'block.wooden_trapdoor.close', 'block.iron_trapdoor.open', 'block.iron_trapdoor.close', 'block.fence_gate.open', 'block.fence_gate.close',
  'block.wooden_button.click_on', 'block.wooden_button.click_off', 'block.stone_button.click_on', 'block.stone_button.click_off',
  'block.wooden_pressure_plate.click_on', 'block.wooden_pressure_plate.click_off', 'block.stone_pressure_plate.click_on', 'block.stone_pressure_plate.click_off',
  'block.metal_pressure_plate.click_on', 'block.metal_pressure_plate.click_off', 'block.lever.click', 'block.chest.open', 'block.chest.close',
  'block.barrel.open', 'block.barrel.close', 'block.bell.use', 'block.bell.resonate',
  ...['harp', 'basedrum', 'snare', 'hat', 'bass', 'flute', 'bell', 'guitar', 'chime', 'xylophone', 'iron_xylophone', 'cow_bell', 'didgeridoo', 'bit', 'banjo', 'pling'].map((i) => `block.note_block.${i}`),
  'block.anvil.land', 'entity.tnt.primed', 'entity.generic.explode', 'item.flintandsteel.use', 'block.fire.ambient', 'block.fire.extinguish', 'entity.item.pickup',
  // fluides, vie et feu a la main (phase 4) : seaux, lave, eclaboussure, degats, mort, chutes, charge de feu
  'item.bucket.empty', 'item.bucket.fill', 'item.bucket.empty_lava', 'item.bucket.fill_lava', 'block.lava.extinguish', 'block.lava.pop', 'block.lava.ambient',
  'entity.player.splash', 'entity.player.splash.high_speed', 'entity.player.hurt', 'entity.player.death', 'entity.player.big_fall', 'entity.player.small_fall',
  'item.firecharge.use', 'entity.generic.extinguish_fire', 'block.candle.extinguish',
  // objets, projectiles, croissance, meteo (phase 7)
  'entity.arrow.shoot', 'entity.arrow.hit', 'entity.arrow.hit_player', 'entity.snowball.throw', 'entity.egg.throw', 'entity.ender_pearl.throw', 'entity.player.teleport',
  'entity.splash_potion.throw', 'entity.splash_potion.break', 'item.trident.throw', 'item.trident.hit_ground', 'item.crossbow.loading_start', 'item.crossbow.loading_middle', 'item.crossbow.loading_end', 'item.crossbow.shoot',
  'entity.generic.eat', 'entity.generic.drink', 'entity.player.burp', 'item.hoe.till', 'item.bone_meal.use', 'item.crop.plant', 'item.bottle.fill', 'entity.item.break',
  'weather.rain', 'weather.rain.above', 'entity.lightning_bolt.thunder', 'entity.lightning_bolt.impact', 'block.furnace.fire_crackle', 'item.bucket.fill_powder_snow',
  // feux d'artifice, charges de vent, breeze (moteur/fusees.js, vent.js, ia-breeze.js)
  ...['launch', 'shoot', 'blast', 'blast_far', 'large_blast', 'large_blast_far', 'twinkle', 'twinkle_far'].map((k) => `entity.firework_rocket.${k}`),
  'entity.wind_charge.throw', 'entity.wind_charge.wind_burst',
  ...['wind_burst', 'deflect', 'shoot', 'jump', 'land', 'charge', 'inhale', 'slide', 'whirl', 'idle_air'].map((k) => `entity.breeze.${k}`),
  // elytres et fiole d'experience (docs/SIMULATION.md partie 25)
  'item.elytra.flying', 'entity.experience_bottle.throw', 'entity.experience_orb.pickup', 'entity.player.levelup',
  // objets et inventaire (docs/SIMULATION.md partie 26) : peche, trident, alambic, table d'enchantement, enclume, forge, tailleur, masse
  'entity.fishing_bobber.throw', 'entity.fishing_bobber.retrieve', 'entity.fishing_bobber.splash', 'item.trident.return', 'item.trident.riptide_1', 'item.trident.riptide_2',
  'item.trident.riptide_3', 'item.trident.thunder', 'item.trident.hit', 'block.brewing_stand.brew', 'block.enchantment_table.use', 'block.anvil.use', 'block.anvil.destroy',
  'block.smithing_table.use', 'ui.stonecutter.take_result', 'item.mace.smash_air', 'item.mace.smash_ground', 'item.mace.smash_ground_heavy', 'enchant.thorns.hit',
  'entity.player.attack.strong', 'entity.player.attack.weak', 'entity.player.attack.crit', 'entity.player.attack.knockback', 'entity.player.attack.sweep', 'entity.player.hurt_on_fire',
  'block.crafter.craft', 'entity.villager.work_toolsmith',
  // blocs et machines (docs/SIMULATION.md partie 27) : fil piege, balise, pupitre, cadres, colonnes de bulles, fours rapides, wagonnets, bateaux
  'block.tripwire.click_on', 'block.tripwire.click_off', 'block.tripwire.attach', 'block.tripwire.detach', 'block.beacon.activate', 'block.beacon.ambient', 'block.beacon.deactivate',
  'item.book.put', 'item.book.page_turn', ...['add_item', 'rotate_item', 'remove_item', 'break', 'place'].flatMap((k) => [`entity.item_frame.${k}`, `entity.glow_item_frame.${k}`]),
  'block.bubble_column.upwards_ambient', 'block.bubble_column.whirlpool_ambient', 'block.bubble_column.upwards_inside', 'block.bubble_column.whirlpool_inside', 'block.bubble_column.bubble_pop',
  'block.blastfurnace.fire_crackle', 'block.smoker.smoke', 'entity.minecart.riding', 'entity.minecart.inside', 'entity.minecart.inside.underwater', 'entity.generic.splash', 'entity.generic.burn',
];
export const SOUND_EVENTS = [...new Set([...SOUND_EVENTS_PAS, ...SOUND_EVENTS_MONDE])];
// Sons des creatures (groupe a la demande `sons_creatures`) : cris, blessure, mort, pas de chaque type (src/creatures/especes.js)
export { SOUND_EVENTS_CREATURES } from './creatures/especes.js';
// Version de chaque groupe du kit : un cache plus ancien (kit.json) est complete la prochaine fois (sons du monde, textures de coffre et de cloche, particules)
export const GROUP_VERSIONS = { sons: 8, textures: 2, objets: 4, projectiles: 2, recettes: 2, entites: 2 };   // entites 2 : textures des tableaux (textures/painting)   // sons 8 : blocs et machines (partie 27) ; objets 3 : reflet d'enchantement (textures/misc/enchanted_glint_*.png), 4 : galons (textures/trims, palettes, atlases/items.json) ; recettes 2 : trim_material, trim_pattern ; projectiles 2 : bouchon de la canne a peche

// groupe -> prefixes de chemin dans le jar (et dans le cache, qui reprend les memes chemins)
export const GROUPS = {
  blockstates: ['assets/minecraft/blockstates/'],
  models: ['assets/minecraft/models/block/'],
  textures: ['assets/minecraft/textures/block/', 'assets/minecraft/textures/entity/chest/', 'assets/minecraft/textures/entity/bell/', 'assets/minecraft/textures/particle/'],   // + coffres, cloche et particules (monde simule)
  colormap: ['assets/minecraft/textures/colormap/'],
  skins: ['assets/minecraft/textures/entity/player/'],
  sons: ['assets/minecraft/sounds.json', 'assets/minecraft/sounds/'],
  environnement: ['assets/minecraft/textures/environment/'], // ciel : soleil, lune (8 phases), nuages (voir src/rendu/ciel-vanille.js)
  biomes: ['data/minecraft/worldgen/biome/'], // temperature, humidite, couleurs (teintes herbe/feuilles/eau)
  worldgen: ['data/minecraft/worldgen/'], // facultatif (le reste de worldgen)
  // groupes A LA DEMANDE (recuperes seulement quand une scene en a besoin : voir GROUPES_A_LA_DEMANDE) :
  objets: ['assets/minecraft/items/', 'assets/minecraft/models/item/', 'assets/minecraft/textures/item/', 'assets/minecraft/textures/misc/enchanted_glint_item.png', 'assets/minecraft/textures/misc/enchanted_glint_armor.png',
    'assets/minecraft/textures/trims/', 'assets/minecraft/textures/palettes/', 'assets/minecraft/atlases/items.json'],   // objets tenus en main (champs `objet` et `objetG`) ; reflet des objets enchantes ; galons d'armure
  armures: ['assets/minecraft/equipment/', 'assets/minecraft/textures/entity/equipment/'],                    // armure portee (champ `armure`)
  projectiles: ['assets/minecraft/textures/entity/projectiles/', 'assets/minecraft/textures/entity/fishing/', 'assets/minecraft/textures/entity/trident/', 'assets/minecraft/textures/entity/enchantment/'],   // fleche, trident, fleche spectrale, charge de vent, bouchon de peche... (monde simule)
  // donnees du jeu pour les objets (docs/SIMULATION.md partie 26) : recettes (etabli, tailleur, forge, alambic), enchantements et leurs etiquettes, butin de la peche,
  // etiquettes d'objets, de creatures et de degats (conditions des enchantements), predicats d'outils, carburant de l'alambic. Lues au lancement, jamais recopiees.
  recettes: ['data/minecraft/recipe/', 'data/minecraft/enchantment/', 'data/minecraft/tags/item/', 'data/minecraft/tags/enchantment/', 'data/minecraft/tags/entity_type/',
    'data/minecraft/tags/damage_type/', 'data/minecraft/damage_type/', 'data/minecraft/loot_table/gameplay/', 'data/minecraft/predicate/', 'data/minecraft/context_int_provider/brewing/', 'data/minecraft/context_float_provider/brewing/', 'data/minecraft/trim_material/', 'data/minecraft/trim_pattern/'],
  // interface (montage : textes, incrustations) : police du jeu (fournisseurs + textures), sprites de l'interface (coeurs, barre d'objets, infobulle, succes...), fonds de conteneurs
  // creatures (champ d'acteur `type`) : textures des entites (0,4 Mo) et sons des creatures (evenements de SOUND_EVENTS_CREATURES seulement)
  entites: ['assets/minecraft/textures/entity/', 'assets/minecraft/textures/painting/'],   // + tableaux (entites `painting` des constructions importees)
  sons_creatures: ['assets/minecraft/sounds/mob/', 'assets/minecraft/sounds/entity/'],
  interface: ['assets/minecraft/font/', 'assets/minecraft/textures/font/', 'assets/minecraft/textures/gui/sprites/', 'assets/minecraft/textures/gui/container/'],
};
// Hors de DEFAULT_GROUPS : le premier lancement reste leger. `trouverKit({ groupes })` (film/cache.js) les ajoute quand la scene en a besoin.
export const GROUPES_A_LA_DEMANDE = ['objets', 'armures', 'interface', 'projectiles', 'entites', 'sons_creatures', 'recettes'];
export const DEFAULT_GROUPS = ['blockstates', 'models', 'textures', 'colormap', 'skins', 'biomes', 'environnement', 'sons'];
export const JAR_GROUPS = ['blockstates', 'models', 'textures', 'colormap', 'skins', 'biomes', 'environnement', 'worldgen', 'objets', 'armures', 'interface', 'projectiles', 'entites', 'recettes'];

// Groupe d'un chemin : le prefixe le plus LONG l'emporte (textures/entity/player/ = skins, le reste de textures/entity/ = entites ;
// sounds/mob/ = sons_creatures, le reste de sounds/ = sons).
export function groupOf(rel) {
  let best = null, n = -1;
  for (const [g, prefixes] of Object.entries(GROUPS)) {
    for (const p of prefixes) if ((p.endsWith('/') ? rel.startsWith(p) : rel === p) && p.length > n) { best = g; n = p.length; }
  }
  return best;
}
// Pour les groupes du jar (hors sons): le chemin est-il voulu ?
export function jarWanted(name, groups) {
  if (name.endsWith('/')) return false;
  const g = groupOf(name);
  return !!g && g !== 'sons' && g !== 'sons_creatures' && groups.has(g);
}

export function normGroups(groups) {
  const g = new Set(groups?.length ? groups : DEFAULT_GROUPS);
  for (const x of g) if (!GROUPS[x]) throw new Error(`groupe inconnu: ${x} (connus: ${Object.keys(GROUPS).join(', ')})`);
  return g;
}

export function safeRel(rel) {
  if (!rel || rel.includes('\\') || rel.startsWith('/') || rel.split('/').some((s) => s === '..' || s === '' || s.includes(':'))) {
    throw new Error(`chemin refuse: ${rel}`);
  }
  return rel;
}

// sounds.json -> liste des noms de sons (ex. "step/grass1") pour des evenements donnes
export function resolveSoundNames(soundsJson, events = SOUND_EVENTS, tolerant = false) {   // tolerant : un evenement absent est ignore (sons des creatures)
  const out = new Set(); const seen = new Set();
  const visit = (ev) => {
    if (seen.has(ev)) return; seen.add(ev);
    const e = soundsJson[ev];
    if (!e) { if (tolerant) return; if (SOUND_EVENTS_MONDE.includes(ev) && !SOUND_EVENTS_PAS.includes(ev)) return; throw new Error(`evenement de son absent de sounds.json: ${ev}`); }   // un son du monde simule absent est ignore (kit de test, version du jeu)
    for (const s of e.sounds || []) {
      const o = typeof s === 'string' ? { name: s } : s;
      const name = o.name.replace(/^minecraft:/, '');
      if (o.type === 'event') visit(name); else out.add(name);
    }
  };
  events.forEach(visit);
  return [...out].sort();
}

export const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');

export async function pool(items, n, fn) {
  let i = 0;
  const w = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, w));
}

// Ecrit dans le cache en comptant par groupe. Ecriture atomique (.partial puis rename).
export class KitWriter {
  constructor(kitDir) { this.kitDir = kitDir; this.written = []; this.byGroup = {}; }
  put(rel, data) {
    safeRel(rel);
    const g = groupOf(rel);
    if (!g) throw new Error(`fichier hors kit: ${rel}`);
    const dest = path.join(this.kitDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.partial';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dest);
    this.written.push(rel);
    const s = (this.byGroup[g] ||= { files: 0, bytes: 0 });
    s.files++; s.bytes += data.length;
  }
  rollback() {
    for (const rel of this.written) { try { fs.unlinkSync(path.join(this.kitDir, ...rel.split('/'))); } catch { /* deja absent */ } }
    this.written = []; this.byGroup = {};
  }
}

export function listKitFiles(kitDir, groups) {
  const out = [];
  const walk = (dir, rel) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(path.join(dir, d.name), r);
      else if (d.isFile() && !d.name.endsWith('.partial')) { const g = groupOf(r); if (g && (!groups || groups.has(g))) out.push({ rel: r, group: g }); }
    }
  };
  for (const top of ['assets', 'data']) if (fs.existsSync(path.join(kitDir, top))) walk(path.join(kitDir, top), top);
  return out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

// Empreinte: sha1 de la liste triee "chemin sha1" (globale et par groupe) + comptes.
export function kitFingerprint(kitDir, groups) {
  const per = {}; const all = crypto.createHash('sha1');
  const lines = {};
  for (const f of listKitFiles(kitDir, groups)) {
    const data = fs.readFileSync(path.join(kitDir, ...f.rel.split('/')));
    const line = `${f.rel} ${sha1(data)}\n`;
    all.update(line);
    (lines[f.group] ||= crypto.createHash('sha1')).update(line);
    const s = (per[f.group] ||= { files: 0, bytes: 0 });
    s.files++; s.bytes += data.length;
  }
  for (const g of Object.keys(per)) per[g].hash = lines[g].digest('hex').slice(0, 12);
  return { hash: all.digest('hex'), groups: per };
}

export function readInfo(kitDir) {
  try { return JSON.parse(fs.readFileSync(path.join(kitDir, 'kit.json'), 'utf8')); } catch { return null; }
}
export function writeInfo(kitDir, info) {
  fs.mkdirSync(kitDir, { recursive: true });
  fs.writeFileSync(path.join(kitDir, 'kit.json'), JSON.stringify(info, null, 1));
}

// Groupes servis par le depot de RELAIS (et non par le jar ni le miroir) : nos tables a nous, telechargees a la demande, verifiees par
// SHA-256 (src/moteur/donnees-empreinte.json). `donnees-jeu` : proprietes des blocs (lumiere, opacite, collisions, classes...) ; ne
// servent qu'aux scenes qui ont un champ `monde` (src/moteur/chargeur.js). Depot : <relais>/d/donnees-jeu-1.json.gz.
export const GROUPES_RELAIS = { 'donnees-jeu': 'd/donnees-jeu-1.json.gz' };
