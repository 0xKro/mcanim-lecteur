// Les types de creatures : modele (couche du jeu dans creatures-1.json.gz), texture du kit (groupe `entites`), famille d'animation,
// sons (evenements du jeu), dimensions de bebe ; puis les variantes de chaque type, les vitesses et les sieges des montures.
// Table et regles reprises de Horizon (client/mobs/species.rs, render.rs, equine.rs, llama.rs, tame.rs, riders.rs ; MIT), voir
// ATTRIBUTIONS.md. Aucun fichier du jeu ici : seulement des NOMS de fichiers et des nombres.

// type: [modele, texture (sous textures/entity/), famille, [cri, blessure, mort] (sans "entity."), pas, bebe ([l, h, yeux] ou [echelle])]
export const ESPECES = {
  pig: ["pig","pig/pig_temperate","Quadruped",["pig.ambient","pig.hurt","pig.death"],"pig.step",[0.45,0.45,0.40625]],
  cow: ["cow","cow/cow_temperate","Quadruped",["cow.ambient","cow.hurt","cow.death"],"cow.step",[0.45,0.7,0.69]],
  mooshroom: ["mooshroom","cow/mooshroom_red","Quadruped",["cow.ambient","cow.hurt","cow.death"],"cow.step",[0.45,0.7,0.69]],
  sheep: ["sheep","sheep/sheep","Sheep",["sheep.ambient","sheep.hurt","sheep.death"],"sheep.step",[0.45,0.65,0.65625]],
  chicken: ["chicken","chicken/chicken_temperate","Chicken",["chicken.ambient","chicken.hurt","chicken.death"],"chicken.step",[0.3,0.4,0.28125]],
  rabbit: ["rabbit","rabbit/rabbit_brown","Rabbit",["rabbit.ambient","rabbit.hurt","rabbit.death"],null,[0.24,0.4,0.39]],
  zombie_horse: ["zombie_horse","horse/horse_zombie","Horse",["zombie_horse.ambient","zombie_horse.hurt","zombie_horse.death"],"horse.step",[0.7]],
  skeleton_horse: ["skeleton_horse","horse/horse_skeleton","Horse",["skeleton_horse.ambient","skeleton_horse.hurt","skeleton_horse.death"],"horse.step",[0.7]],
  giant: ["giant","zombie/zombie","Humanoid",["","generic.hurt","generic.death"],null,null],
  horse: ["horse","horse/horse_brown","Horse",["horse.ambient","horse.hurt","horse.death"],"horse.step",[0.7]],
  donkey: ["donkey","horse/donkey","Horse",["donkey.ambient","donkey.hurt","donkey.death"],"horse.step",[0.5]],
  mule: ["mule","horse/mule","Horse",["mule.ambient","mule.hurt","mule.death"],"horse.step",[0.5]],
  llama: ["llama","llama/llama_creamy","Llama",["llama.ambient","llama.hurt","llama.death"],"llama.step",[0.5]],
  trader_llama: ["trader_llama","llama/llama_creamy","Llama",["llama.ambient","llama.hurt","llama.death"],"llama.step",[0.5]],
  goat: ["goat","goat/goat","Goat",["goat.ambient","goat.hurt","goat.death"],"goat.step",[0.45,0.65,0.59375]],
  panda: ["panda","panda/panda","Panda",["panda.ambient","panda.hurt","panda.death"],"panda.step",[0.5]],
  polar_bear: ["polar_bear","bear/polarbear","PolarBear",["polar_bear.ambient","polar_bear.hurt","polar_bear.death"],"polar_bear.step",[0.7,0.7,0.34375]],
  fox: ["fox","fox/fox","Fox",["fox.ambient","fox.hurt","fox.death"],null,[0.6]],
  wolf: ["wolf","wolf/wolf","Wolf",["wolf.ambient","wolf.hurt","wolf.death"],"wolf.step",[0.3,0.425,0.34375]],
  cat: ["cat","cat/cat_tabby","Feline",["cat.ambient","cat.hurt","cat.death"],null,[0.3,0.35,0.34375]],
  ocelot: ["ocelot","cat/ocelot","Feline",["ocelot.ambient","ocelot.hurt","ocelot.death"],null,[0.3,0.35,0.34375]],
  parrot: ["parrot","parrot/parrot_red_blue","Parrot",["parrot.ambient","parrot.hurt","parrot.death"],"parrot.step",null],
  bee: ["bee","bee/bee","Bee",["","bee.hurt","bee.death"],null,[0.5]],
  turtle: ["turtle","turtle/turtle","Turtle",["turtle.ambient_land","turtle.hurt","turtle.death"],"turtle.shamble",[0.3]],
  armadillo: ["armadillo","armadillo/armadillo","Armadillo",["armadillo.ambient","armadillo.hurt","armadillo.death"],"armadillo.step",[0.6]],
  frog: ["frog","frog/frog_temperate","Frog",["frog.ambient","frog.hurt","frog.death"],"frog.step",null],
  axolotl: ["axolotl","axolotl/axolotl_lucy","Axolotl",["axolotl.idle_water","axolotl.hurt","axolotl.death"],null,[0.375,0.21,0.09375]],
  squid: ["squid","squid/squid","Squid",["squid.ambient","squid.hurt","squid.death"],null,[0.5,0.5,0.37]],
  glow_squid: ["glow_squid","squid/glow_squid","Squid",["glow_squid.ambient","glow_squid.hurt","glow_squid.death"],null,[0.5,0.5,0.37]],
  tadpole: ["tadpole","tadpole/tadpole","Fish",["","tadpole.hurt","tadpole.death"],null,null],
  cod: ["cod","fish/cod","Fish",["cod.ambient","cod.hurt","cod.death"],null,null],
  salmon: ["salmon","fish/salmon","Fish",["salmon.ambient","salmon.hurt","salmon.death"],null,null],
  tropical_fish: ["tropical_fish_small","fish/tropical_a","Fish",["tropical_fish.ambient","tropical_fish.hurt","tropical_fish.death"],null,null],
  pufferfish: ["pufferfish_big","fish/pufferfish","Pufferfish",["","puffer_fish.hurt","puffer_fish.death"],null,null],
  dolphin: ["dolphin","dolphin/dolphin","Dolphin",["dolphin.ambient_water","dolphin.hurt","dolphin.death"],null,[0.65]],
  bat: ["bat","bat/bat","Bat",["bat.ambient","bat.hurt","bat.death"],null,null],
  villager: ["villager","villager/villager","Villager",["villager.ambient","villager.hurt","villager.death"],null,[0.49,0.98,0.63]],
  wandering_trader: ["wandering_trader","wandering_trader/wandering_trader","Villager",["wandering_trader.ambient","wandering_trader.hurt","wandering_trader.death"],null,null],
  iron_golem: ["iron_golem","iron_golem/iron_golem","IronGolem",["","iron_golem.hurt","iron_golem.death"],"iron_golem.step",null],
  snow_golem: ["snow_golem","snow_golem/snow_golem","SnowGolem",["snow_golem.ambient","snow_golem.hurt","snow_golem.death"],null,null],
  copper_golem: ["copper_golem","copper_golem/copper_golem","CopperGolem",["","copper_golem.hurt","copper_golem.death"],"copper_golem.step",null],
  zombie: ["zombie","zombie/zombie","Zombie",["zombie.ambient","zombie.hurt","zombie.death"],"zombie.step",[0.49,0.98,0.775]],
  husk: ["husk","zombie/husk","Zombie",["husk.ambient","husk.hurt","husk.death"],"husk.step",[0.49,0.98,0.825]],
  drowned: ["drowned","zombie/drowned","Drowned",["drowned.ambient","drowned.hurt","drowned.death"],"drowned.step",[0.49,0.98,0.775]],
  zombie_villager: ["zombie_villager","zombie_villager/zombie_villager","ZombieVillager",["zombie_villager.ambient","zombie_villager.hurt","zombie_villager.death"],"zombie_villager.step",[0.49,0.98,0.67]],
  skeleton: ["skeleton","skeleton/skeleton","Skeleton",["skeleton.ambient","skeleton.hurt","skeleton.death"],"skeleton.step",null],
  stray: ["stray","skeleton/stray","Skeleton",["stray.ambient","stray.hurt","stray.death"],"stray.step",null],
  parched: ["parched","skeleton/parched","Skeleton",["parched.ambient","parched.hurt","parched.death"],"parched.step",null],
  bogged: ["bogged","skeleton/bogged","Skeleton",["bogged.ambient","bogged.hurt","bogged.death"],"bogged.step",null],
  wither_skeleton: ["wither_skeleton","skeleton/wither_skeleton","Skeleton",["wither_skeleton.ambient","wither_skeleton.hurt","wither_skeleton.death"],"wither_skeleton.step",null],
  creeper: ["creeper","creeper/creeper","Creeper",["","creeper.hurt","creeper.death"],null,null],
  spider: ["spider","spider/spider","Spider",["spider.ambient","spider.hurt","spider.death"],"spider.step",null],
  cave_spider: ["cave_spider","spider/cave_spider","Spider",["spider.ambient","spider.hurt","spider.death"],"spider.step",null],
  enderman: ["enderman","enderman/enderman","Enderman",["enderman.ambient","enderman.hurt","enderman.death"],null,null],
  endermite: ["endermite","endermite/endermite","Silverfish",["endermite.ambient","endermite.hurt","endermite.death"],"endermite.step",null],
  silverfish: ["silverfish","silverfish/silverfish","Silverfish",["silverfish.ambient","silverfish.hurt","silverfish.death"],"silverfish.step",null],
  slime: ["slime","slime/slime","Slime",["","slime.hurt","slime.death"],null,null],
  magma_cube: ["magma_cube","slime/magmacube","MagmaCube",["","magma_cube.hurt","magma_cube.death"],null,null],
  witch: ["witch","witch/witch","Witch",["witch.ambient","witch.hurt","witch.death"],null,null],
  phantom: ["phantom","phantom/phantom","Phantom",["phantom.ambient","phantom.hurt","phantom.death"],null,null],
  evoker: ["evoker","illager/evoker","Illager",["evoker.ambient","evoker.hurt","evoker.death"],null,null],
  illusioner: ["illusioner","illager/illusioner","Illager",["illusioner.ambient","illusioner.hurt","illusioner.death"],null,null],
  allay: ["allay","allay/allay","Allay",["allay.ambient_without_item","allay.hurt","allay.death"],null,null],
  creaking: ["creaking","creaking/creaking","Creaking",["creaking.ambient","generic.hurt","creaking.death"],"creaking.step",null],
  camel: ["camel","camel/camel","Camel",["camel.ambient","camel.hurt","camel.death"],"camel.step",[0.95,1.4,1.38]],
  happy_ghast: ["happy_ghast","ghast/happy_ghast","HappyGhast",["happy_ghast.ambient","happy_ghast.hurt","happy_ghast.death"],null,[0.2375]],
  sniffer: ["sniffer","sniffer/sniffer","Sniffer",["sniffer.idle","sniffer.hurt","sniffer.death"],"sniffer.step",[0.5]],
  breeze: ["breeze","breeze/breeze","Breeze",["breeze.idle_ground","breeze.hurt","breeze.death"],null,null],
  wither: ["wither","wither/wither","Wither",["wither.ambient","wither.hurt","wither.death"],null,null],
  ravager: ["ravager","illager/ravager","Ravager",["ravager.ambient","ravager.hurt","ravager.death"],"ravager.step",null],
  vex: ["vex","illager/vex","Vex",["vex.ambient","vex.hurt","vex.death"],null,null],
  shulker: ["shulker","shulker/shulker","Shulker",["shulker.ambient","shulker.hurt","shulker.death"],null,null],
  guardian: ["guardian","guardian/guardian","Guardian",["guardian.ambient","guardian.hurt","guardian.death"],null,null],
  elder_guardian: ["elder_guardian","guardian/guardian_elder","Guardian",["elder_guardian.ambient","elder_guardian.hurt","elder_guardian.death"],null,null],
  pillager: ["pillager","illager/pillager","Illager",["pillager.ambient","pillager.hurt","pillager.death"],null,null],
  vindicator: ["vindicator","illager/vindicator","Illager",["vindicator.ambient","vindicator.hurt","vindicator.death"],null,null],
  piglin: ["piglin","piglin/piglin","Piglin",["piglin.ambient","piglin.hurt","piglin.death"],"piglin.step",[0.49,0.98,0.78]],
  piglin_brute: ["piglin_brute","piglin/piglin_brute","Piglin",["piglin_brute.ambient","piglin_brute.hurt","piglin_brute.death"],"piglin_brute.step",null],
  zombified_piglin: ["zombified_piglin","piglin/zombified_piglin","ZombifiedPiglin",["zombified_piglin.ambient","zombified_piglin.hurt","zombified_piglin.death"],null,[0.49,0.98,0.78]],
  hoglin: ["hoglin","hoglin/hoglin","Hoglin",["hoglin.ambient","hoglin.hurt","hoglin.death"],"hoglin.step",[0.75,0.85,0.625]],
  zoglin: ["zoglin","hoglin/zoglin","Hoglin",["zoglin.ambient","zoglin.hurt","zoglin.death"],"zoglin.step",[0.75,0.85,0.625]],
  ghast: ["ghast","ghast/ghast","Ghast",["ghast.ambient","ghast.hurt","ghast.death"],null,null],
  blaze: ["blaze","blaze/blaze","Blaze",["blaze.ambient","blaze.hurt","blaze.death"],null,null],
  strider: ["strider","strider/strider","Strider",["strider.ambient","strider.hurt","strider.death"],"strider.step",[0.45,0.85,0.4375]],
  warden: ["warden","warden/warden","Warden",["warden.ambient","warden.hurt","warden.death"],null,null],
  camel_husk: ["camel","camel/camel_husk","Camel",["camel_husk.ambient","camel_husk.hurt","camel_husk.death"],"camel_husk.step",null],
  nautilus: ["nautilus","nautilus/nautilus","Nautilus",["nautilus.ambient","nautilus.hurt","nautilus.death"],null,[0.5]],
  zombie_nautilus: ["zombie_nautilus","nautilus/zombie_nautilus","Nautilus",["zombie_nautilus.ambient","zombie_nautilus.hurt","zombie_nautilus.death"],null,null],
  sulfur_cube: ["sulfur_cube","sulfur_cube/sulfur_cube_outer","Slime",["","sulfur_cube.hurt","sulfur_cube.death"],null,null],

};
// Vehicules et objets poses : bateaux, wagonnets, porte-armure, dragon.
export const BOIS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'cherry', 'dark_oak', 'pale_oak', 'mangrove', 'bamboo', 'poplar'];
export const WAGONNETS = ['minecart', 'chest_minecart', 'furnace_minecart', 'hopper_minecart', 'tnt_minecart', 'spawner_minecart', 'command_block_minecart'];
export const VEHICULES = new Set(['boat', 'chest_boat', ...WAGONNETS]);
for (const w of WAGONNETS) ESPECES[w] = [w, 'minecart/minecart', 'Vehicule', ['', '', ''], null, null];
ESPECES.boat = ['boat/oak', 'boat/oak', 'Vehicule', ['', '', ''], null, null];
ESPECES.chest_boat = ['chest_boat/oak', 'chest_boat/oak', 'Vehicule', ['', '', ''], null, null];
ESPECES.armor_stand = ['armor_stand', 'armorstand/armorstand', 'Statue', ['', 'armor_stand.hit', 'armor_stand.break'], null, null];
ESPECES.ender_dragon = ['ender_dragon', 'enderdragon/dragon', 'Dragon', ['ender_dragon.ambient', 'ender_dragon.hurt', 'ender_dragon.death'], null, null];
ESPECES.end_crystal = ['end_crystal', 'end_crystal/end_crystal', 'Statue', ['', '', ''], null, null];   // cristal de l'End (soigne le dragon, explose)

// Sons de toutes les creatures (groupe de kit a la demande `sons_creatures`) : cri, blessure, mort, pas, et quelques sons d'action.
export const SONS_EN_PLUS = ['entity.creeper.primed', 'entity.boat.paddle_water', 'entity.boat.paddle_land', 'entity.minecart.riding', 'entity.horse.gallop', 'entity.horse.saddle',
  'entity.iron_golem.attack', 'entity.villager.no', 'entity.villager.yes', 'entity.skeleton.shoot', 'entity.slime.jump', 'entity.slime.squish',
  'entity.wolf.growl', 'entity.cat.purr', 'entity.camel.dash', 'entity.warden.roar', 'entity.warden.sonic_boom', 'entity.breeze.shoot', 'entity.creaking.attack'];
export const SOUND_EVENTS_CREATURES = [...new Set([...Object.values(ESPECES).flatMap((e) => [...e[3], e[4]].filter(Boolean).map((s) => 'entity.' + s)), ...SONS_EN_PLUS])].sort();

// Parrot.MOB_SOUND_MAP : les mobs que le perroquet imite (entity.parrot.imitate.<type>)
export const IMITES = new Set(['blaze', 'bogged', 'breeze', 'cave_spider', 'creaking', 'creeper', 'drowned', 'elder_guardian', 'ender_dragon', 'endermite', 'evoker', 'ghast', 'guardian', 'hoglin', 'husk', 'illusioner', 'magma_cube', 'phantom', 'piglin', 'piglin_brute', 'pillager', 'ravager', 'shulker', 'silverfish', 'skeleton', 'slime', 'spider', 'stray', 'vex', 'vindicator', 'warden', 'witch', 'wither', 'wither_skeleton', 'zoglin', 'zombie', 'zombie_villager']);

// ---------------------------------------------------------------- couleurs (DyeColor) et variantes
export const TEINTURES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const DIFFUS = [0xF9FFFE, 0xF9801D, 0xC74EBD, 0x3AB3DA, 0xFED83D, 0x80C71F, 0xF38BAA, 0x474F52, 0x9D9D97, 0x169C9C, 0x8932B8, 0x3C44AA, 0x835432, 0x5E7C16, 0xB02E26, 0x1D1D21];
export const rgb = (c) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
export const couleurTeinture = (i) => rgb(DIFFUS[i]);
// laine du mouton : blanc E6E6E6, sinon la couleur de la teinture x 0,75 (pack_palette::sheep_wool)
export const couleurLaine = (i) => (i === 0 ? rgb(0xE6E6E6) : rgb(DIFFUS[i]).map((v) => Math.floor(v * 255 * 0.75) / 255));
export const TYPES_VILLAGEOIS = ['plains', 'desert', 'jungle', 'savanna', 'snow', 'swamp', 'taiga'];
export const METIERS = ['none', 'armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher', 'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith'];
export const NIVEAUX = ['stone', 'iron', 'gold', 'emerald', 'diamond'];
const CLIMATS = ['temperate', 'warm', 'cold'];
const CHATS = ['tabby', 'black', 'red', 'siamese', 'british_shorthair', 'calico', 'persian', 'ragdoll', 'white', 'jellie', 'all_black'];
const LOUPS = ['pale', 'ashen', 'black', 'chestnut', 'rusty', 'snowy', 'spotted', 'striped', 'woods'];
const CHEVAUX = ['brown', 'white', 'creamy', 'chestnut', 'black', 'gray', 'darkbrown'];
const MARQUES = ['markings_white', 'markings_whitefield', 'markings_whitedots', 'markings_blackdots'];
const LAPINS = ['brown', 'white', 'black', 'white_splotched', 'gold', 'salt', 'toast', 'caerbannog'];
const LAMAS = ['creamy', 'white', 'brown', 'gray'];
const AXOLOTLS = ['lucy', 'wild', 'gold', 'cyan', 'blue'];
const PERROQUETS = ['red_blue', 'blue', 'green', 'yellow_blue', 'grey'];
const PANDAS = ['normal', 'lazy', 'worried', 'playful', 'brown', 'weak', 'aggressive'];
const OXYDATION = ['unaffected', 'exposed', 'weathered', 'oxidized'];
const FISSURES = ['cracked_low', 'cracked_medium', 'cracked_high'];
const SANS = (l) => ['sans', ...l];

// Variantes permises par type (mots de `variante`, separes par des espaces ; le premier mot de chaque liste est le defaut).
export const VARIANTES = {
  villager: [TYPES_VILLAGEOIS, METIERS, ['1', '2', '3', '4', '5']], zombie_villager: [TYPES_VILLAGEOIS, METIERS, ['1', '2', '3', '4', '5']],
  sheep: [TEINTURES], cow: [CLIMATS], pig: [CLIMATS], chicken: [CLIMATS], frog: [CLIMATS], mooshroom: [['red', 'brown']],
  cat: [CHATS], wolf: [LOUPS, ['calme', 'angry']], horse: [CHEVAUX, SANS(MARQUES)], rabbit: [LAPINS], fox: [['red', 'snow'], ['eveille', 'sleep']],
  llama: [LAMAS, SANS(TEINTURES)], trader_llama: [LAMAS], axolotl: [AXOLOTLS], parrot: [PERROQUETS], panda: [PANDAS],
  salmon: [['medium', 'small', 'large']], pufferfish: [['big', 'medium', 'small']], tropical_fish: [['a', 'b'], ['1', '2', '3', '4', '5', '6'], TEINTURES, SANS(TEINTURES)],
  copper_golem: [OXYDATION], strider: [['normal', 'cold']], bee: [['calme', 'angry'], ['sans', 'nectar']], iron_golem: [['intact', ...FISSURES]],
  ghast: [['calme', 'shooting']], vex: [['calme', 'charging']], wither: [['normal', 'invulnerable']], boat: [BOIS], chest_boat: [BOIS],
};
// variante (texte) -> { choix: [mot par liste] } ou { erreur }. Un mot present dans deux listes va dans la premiere encore au defaut.
export function lireVariante(type, texte) {
  const listes = VARIANTES[type] ?? [];
  const choix = listes.map((l) => l[0]), pris = listes.map(() => false);
  if (texte === undefined || texte === null || texte === '') return { choix };
  for (const m of String(texte).toLowerCase().trim().split(/[\s,]+/)) {
    let i = listes.findIndex((l, k) => l.includes(m) && !pris[k]);
    if (i < 0) i = listes.findIndex((l) => l.includes(m));
    if (i < 0) return { erreur: listes.length ? `variante "${m}" inconnue pour ${type} (permis : ${listes.map((l) => l.join('|')).join(' ; ')})` : `${type} n'a pas de variante` };
    choix[i] = m; pris[i] = true;
  }
  return { choix };
}

// Vitesse de marche du jeu (blocs/s) : acceleration = (movement_speed x modificateur de la flanerie)^2 sur un sol de friction 0,6,
// regime permanent a / (1 - 0,546) par tick (LivingEntity.travel ; Mob.setSpeed met zza = vitesse). court : modificateur x 1,25.
export const MODIF_FLANERIE = { villager: 0.5, wandering_trader: 0.35, pillager: 0.6, vindicator: 0.6, evoker: 0.6, illusioner: 0.6, piglin: 0.6, piglin_brute: 0.6, hoglin: 0.4, zoglin: 0.4, iron_golem: 0.6, horse: 0.7, donkey: 0.7, mule: 0.7, llama: 0.7, trader_llama: 0.7, skeleton_horse: 0.7, zombie_horse: 0.7, creeper: 0.8, cat: 0.8, ocelot: 0.8, camel: 2, warden: 0.5 };
// types qui ne marchent pas (vol, nage, sauts, immobiles) : pas de vitesse de marche annoncee
const SANS_MARCHE = new Set(['Fish', 'Squid', 'Dolphin', 'Pufferfish', 'Axolotl', 'Frog', 'Bat', 'Parrot', 'Bee', 'Ghast', 'HappyGhast', 'Phantom', 'Vex', 'Allay', 'Blaze', 'Slime', 'MagmaCube', 'Shulker', 'Guardian', 'Wither', 'Breeze', 'Nautilus', 'Vehicule', 'Statue', 'Dragon']);
export function vitesseMarche(type, stats, court = false) {
  const v = stats?.v; if (!v || SANS_MARCHE.has(ESPECES[type]?.[2]) || type === 'tadpole') return 0;
  const m = v * (MODIF_FLANERIE[type] ?? 1) * (court ? 1.25 : 1);
  return Math.round(20 * m * m / (1 - 0.546) * 100) / 100;
}

// Siege du passager (Entity.getPassengerAttachmentPoint, blocs depuis les pieds de la monture : [droite, haut, avant]) et
// decalage du cavalier sous ce point (Avatar.DEFAULT_VEHICLE_ATTACHMENT : 0,6). Sans entree : le haut de la boite de la monture.
export const SIEGES = { horse: [0, 1.44375, 0], donkey: [0, 1.1125, 0], mule: [0, 1.2125, 0], skeleton_horse: [0, 1.31875, 0], zombie_horse: [0, 1.31875, 0], pig: [0, 0.86875, 0],
  camel: [0, 1.875, 0.5], llama: [0, 1.37, -0.3], trader_llama: [0, 1.37, -0.3], chicken: [0, 0.7, -0.1], spider: [0, 0.765, 0], cow: [0, 1.36875, 0],
  sheep: [0, 1.2375, 0], ravager: [0, 2.2625, -0.0625], hoglin: [0, 1.49375, 0], nautilus: [0, 1.1375, 0], happy_ghast: [0, 4, 1.7],
  boat: [0, 0.1875, 0], chest_boat: [0, 0.1875, 0.15] };
for (const w of WAGONNETS) SIEGES[w] = [0, 0.1875, 0];
export const DECALAGE_CAVALIER = 0.6;
export const MONTURES = ['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'pig', 'camel', 'strider', 'llama', 'trader_llama', 'boat', 'chest_boat', ...WAGONNETS];
