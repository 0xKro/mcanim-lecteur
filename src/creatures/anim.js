// Port de Horizon (client/mobs/anim.rs, body_anim.rs, villager.rs, golem.rs, illager.rs, piglin.rs, witch.rs, tame.rs,
// equine.rs, cube.rs, enderman.rs, nether.rs, aquatic.rs, camel.rs, breeze.rs, sniffer.rs, warden.rs, creaking.rs, allay.rs,
// phantom.rs, guardian.rs, vex.rs, ravager.rs, shulker.rs, wither.rs, copper_golem.rs, happy_ghast.rs, nautilus.rs, farm.rs,
// parrot.rs, bat.rs, rabbit.rs, frog.rs, fox.rs, panda.rs, polar_bear.rs, bee.rs, axolotl.rs, armadillo.rs, MIT),
// voir ATTRIBUTIONS.md
// Animations "par le code" des creatures (EntityModel.setupAnim) et leurs horloges par tick.
//   poser(type, P, s, m, anims)  : pose le modele `type` (Poses P) ; s = etat de rendu (State de Horizon) :
//       { pos, speed, age (ticks + partiel), yRot (deg, tete/corps), xRot (deg), swing (0..1), baby, partial }
//   tick(type, m)               : avance d'UN tick de jeu (20/s) les horloges de m (m.anim) a partir des entrees de m.
//   animerNommee(type, nom, millis, P, anims) : joue une animation a images cles nommee.
// Champs de m (etatInitial) : voir le bloc ETAT plus bas.
import { appliquer, appliquerMarche } from './images-cles.js';

const PI = Math.PI, sin = Math.sin, cos = Math.cos;
const rad = (d) => d * PI / 180;
const borne = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, p, q) => p + a * (q - p);
function rotLerpRad(a, de, vers) {
  let d = vers - de;
  while (d < -PI) d += PI * 2;
  while (d >= PI) d -= PI * 2;
  return de + a * d;
}
function enrouler(a) { a %= 360; if (a >= 180) a -= 360; if (a < -180) a += 360; return a; }
const rotLerp = (t, de, vers) => de + t * enrouler(vers - de); // Mth.rotLerp (felins)

// ---- familles (enum Anim de anim.rs, table species.rs) ------------------------------------------------------------
const T = (fam, ...types) => types.map((t) => [t, fam]);
export const FAMILLES = Object.fromEntries([
  ...T('Allay', 'allay'), ...T('Armadillo', 'armadillo', 'armadillo_baby'), ...T('Axolotl', 'axolotl', 'axolotl_baby'),
  ...T('Bat', 'bat'), ...T('Bee', 'bee', 'bee_baby'), ...T('Blaze', 'blaze'), ...T('Breeze', 'breeze'),
  ...T('Feline', 'cat', 'cat_baby', 'ocelot', 'ocelot_baby'), ...T('Camel', 'camel', 'camel_baby', 'camel_husk'),
  ...T('Spider', 'spider', 'cave_spider'), ...T('Chicken', 'chicken', 'chicken_baby', 'cold_chicken'),
  ...T('Quadruped', 'cow', 'cow_baby', 'cold_cow', 'cold_cow_baby', 'warm_cow', 'warm_cow_baby', 'mooshroom', 'mooshroom_baby',
    'pig', 'pig_baby', 'cold_pig'),
  ...T('CopperGolem', 'copper_golem', 'copper_golem_running', 'copper_golem_sitting', 'copper_golem_star'),
  ...T('Creaking', 'creaking'), ...T('Creeper', 'creeper'), ...T('Dolphin', 'dolphin', 'dolphin_baby'),
  ...T('Horse', 'horse', 'horse_baby', 'horse_armor', 'donkey', 'donkey_baby', 'mule', 'mule_baby', 'skeleton_horse',
    'skeleton_horse_baby', 'zombie_horse', 'zombie_horse_baby', 'undead_horse_armor'),
  ...T('Drowned', 'drowned', 'drowned_baby'), ...T('Guardian', 'guardian', 'elder_guardian'), ...T('Enderman', 'enderman'),
  ...T('Silverfish', 'silverfish', 'endermite'), ...T('Defaut', 'ender_dragon'),
  ...T('Illager', 'evoker', 'illusioner', 'pillager', 'vindicator'), ...T('Fox', 'fox', 'fox_baby'), ...T('Frog', 'frog'),
  ...T('Ghast', 'ghast'), ...T('HumanoidZombie', 'giant'), ...T('Squid', 'squid', 'squid_baby', 'glow_squid', 'glow_squid_baby'),
  ...T('Goat', 'goat', 'goat_baby'),
  ...T('HappyGhast', 'happy_ghast', 'happy_ghast_baby', 'happy_ghast_harness', 'happy_ghast_baby_harness', 'happy_ghast_ropes',
    'happy_ghast_baby_ropes'),
  ...T('Hoglin', 'hoglin', 'hoglin_baby', 'zoglin', 'zoglin_baby'), ...T('Zombie', 'zombie', 'zombie_baby', 'husk', 'husk_baby'),
  ...T('IronGolem', 'iron_golem'), ...T('Llama', 'llama', 'llama_baby', 'trader_llama', 'trader_llama_baby'),
  ...T('MagmaCube', 'magma_cube'),
  ...T('Nautilus', 'nautilus', 'nautilus_baby', 'nautilus_armor', 'zombie_nautilus', 'zombie_nautilus_coral'),
  ...T('Panda', 'panda', 'panda_baby'), ...T('Skeleton', 'skeleton', 'stray', 'parched', 'bogged', 'wither_skeleton'),
  ...T('Parrot', 'parrot'), ...T('Phantom', 'phantom'), ...T('Piglin', 'piglin', 'piglin_brute', 'piglin_baby'),
  ...T('Humanoid', 'player', 'player_slim'), ...T('PolarBear', 'polar_bear', 'polar_bear_baby'),
  ...T('Pufferfish', 'pufferfish_big', 'pufferfish_medium', 'pufferfish_small'), ...T('Rabbit', 'rabbit', 'rabbit_baby'),
  ...T('Ravager', 'ravager'),
  ...T('Fish', 'cod', 'salmon', 'salmon_small', 'salmon_large', 'tadpole', 'tropical_fish_large', 'tropical_fish_small'),
  ...T('Sheep', 'sheep', 'sheep_baby'), ...T('Shulker', 'shulker'), ...T('Slime', 'slime', 'sulfur_cube', 'sulfur_cube_small'),
  ...T('Sniffer', 'sniffer', 'sniffer_baby'), ...T('SnowGolem', 'snow_golem'), ...T('Strider', 'strider', 'strider_baby'),
  ...T('Turtle', 'turtle', 'turtle_baby'), ...T('Vex', 'vex'),
  ...T('Villager', 'villager', 'villager_no_hat', 'villager_baby', 'villager_baby_no_hat', 'wandering_trader'),
  ...T('Warden', 'warden'), ...T('Witch', 'witch'), ...T('Wither', 'wither'), ...T('Wolf', 'wolf', 'wolf_baby', 'wolf_armor'),
  ...T('ZombieVillager', 'zombie_villager', 'zombie_villager_no_hat', 'zombie_villager_baby', 'zombie_villager_baby_no_hat'),
  ...T('ZombifiedPiglin', 'zombified_piglin', 'zombified_piglin_baby'),
]);
const famille = (type) => FAMILLES[type] ?? 'Defaut';
const estBebe = (type) => /_baby/.test(type);

// Famille d'animations a images cles (cles de `animations` du fichier) pour un type.
const ALIAS_ANIM = {
  camel_husk: 'camel', sniffer_baby: 'sniffer', nautilus_baby: 'nautilus', nautilus_armor: 'nautilus',
  zombie_nautilus: 'nautilus', zombie_nautilus_coral: 'nautilus', copper_golem_running: 'copper_golem',
  copper_golem_sitting: 'copper_golem', copper_golem_star: 'copper_golem',
};
const NOMS_ANIM = {
  armadillo: ['roll_up', 'walk', 'peek', 'roll_out'], armadillo_baby: ['roll_up', 'walk', 'roll_out', 'peek'],
  axolotl_baby: ['idle_floor', 'idle_floor_underwater', 'idle_underwater', 'swim', 'dash', 'walk_floor', 'walk_floor_underwater', 'play_dead'],
  rabbit: ['hop', 'idle_head_tilt'], rabbit_baby: ['hop', 'idle_head_tilt'], bat: ['resting', 'flying'],
  breeze: ['idle', 'shoot', 'jump', 'inhale', 'slide', 'slide_back'], camel: ['walk', 'sit', 'sit_pose', 'standup', 'dash', 'idle'],
  camel_baby: ['walk', 'standup', 'dash', 'idle', 'sit', 'sit_pose'],
  copper_golem: ['walk', 'idle', 'walk_item', 'chest_interaction_item_drop', 'chest_interaction_item_nodrop', 'chest_interaction_noitem_get', 'chest_interaction_noitem_noget'],
  creaking: ['walk', 'attack', 'invulnerable', 'death'], fox_baby: ['walk'],
  frog: ['croak', 'walk', 'jump', 'tongue', 'swim', 'idle_water'], nautilus: ['swimming'],
  sniffer: ['transform', 'sniffsniff', 'longsniff', 'walk', 'sniff_search', 'dig', 'stand_up', 'fall', 'happy'],
  warden: ['emerge', 'dig', 'roar', 'sniff', 'attack', 'sonic_boom'],
};
export function familleAnim(type, anims) {
  if (anims ? anims[type] : NOMS_ANIM[type]) return type;
  const a = ALIAS_ANIM[type];
  if (a) return a;
  const b = type.replace(/_baby$/, '');
  return (anims ? anims[b] : NOMS_ANIM[b]) ? b : null;
}
export function nomsAnimations(type, anims) {
  const f = familleAnim(type, anims);
  if (!f) return [];
  return anims ? Object.keys(anims[f]) : NOMS_ANIM[f].slice();
}
export function animerNommee(type, nom, millis, P, anims) {
  const f = familleAnim(type, anims), a = f && anims[f] && anims[f][nom];
  if (!a) return false;
  appliquer(a, millis, 1, P);
  return true;
}

// Etats d'animation a images cles (AnimationState) par famille, dans l'ordre des emplacements de Horizon.
const ETATS = {
  Bat: ['flying', 'resting'], Breeze: ['idle', 'shoot', 'slide', 'slide_back', 'inhale', 'jump'],
  Camel: ['sit', 'sit_pose', 'standup', 'idle', 'dash'], Creaking: ['attack', 'invulnerable', 'death'],
  CopperGolem: ['idle', 'chest_interaction_noitem_get', 'chest_interaction_noitem_noget', 'chest_interaction_item_drop', 'chest_interaction_item_nodrop'],
  Frog: ['jump', 'croak', 'tongue', 'idle_water'], Rabbit: ['hop', 'idle_head_tilt'],
  Sniffer: ['happy', 'sniffsniff', 'longsniff', 'dig', 'stand_up'], Warden: ['roar', 'sniff', 'emerge', 'dig', 'attack', 'sonic_boom'],
  Armadillo: ['roll_out', 'roll_up', 'peek'],
  Axolotl: ['walk_floor', 'swim', 'walk_floor_underwater', 'idle_floor', 'idle_underwater', 'idle_floor_underwater', 'play_dead'],
};
// Demarre / arrete a la main l'etat nomme (ex. warden 'attack', 'sonic_boom') au tick m.age.
export function demarrer(type, m, nom) { const i = (ETATS[famille(type)] ?? []).indexOf(nom); if (i < 0) return false; m.anim.states[i] = m.age; return true; }
export function arreter(type, m, nom) { const i = (ETATS[famille(type)] ?? []).indexOf(nom); if (i < 0) return false; m.anim.states[i] = null; return true; }
const millis = (debut, age) => (debut == null ? null : Math.trunc((age - debut) * 50));
function jouer(P, anims, fam, nom, debut, age) {
  const ms = millis(debut, age), a = anims && anims[fam] && anims[fam][nom];
  if (ms != null && a) appliquer(a, ms, 1, P);
}
function marcher(P, anims, fam, nom, s, facteur, echelle) {
  const a = anims && anims[fam] && anims[fam][nom];
  if (a) appliquerMarche(a, s.pos, s.speed, facteur, echelle, P);
}

/* ---- ETAT : champs de m (etatInitial) -------------------------------------------------------------------------------
 age        ticks de vie (avance de 1 par tick()) ; s.age devrait valoir m.age + partiel
 id         numero d'entite (phase du nez de sorciere, battement du phantom), defaut 0
 bebe       bebe ; agressif : agressif / en colere (zombie bras leves, squelette arc, loup, abeille, illageois...)
 mainD      objet en main principale ("bow", "crossbow", "trident", "iron_sword"... sans "minecraft:"), null = vide
 mainG      objet en main secondaire ; gaucher : bras principal gauche
 passager   monte sur quelque chose (pose assise) ; monte : porte un cavalier (renes, lunettes du happy ghast, strider)
 nage       quantite de nage 0..1 (noye, humanoides) ; dansEau, auSol : booleens
 vy         vitesse verticale (blocs/tick) ; vh : vitesse horizontale (blocs/tick)
 coffre     ane/mule/lama avec coffres ; tondu : mouton/bogged tondu (champignons)
 assis      chat/loup/renard/perroquet/panda assis ; accroupi : chat/renard/humanoide accroupi ; sprint : felin qui sprinte
 couche     chat couche ; detente : chat detendu (relax_one) ; dort : villageois/renard endormi
 gonfle     gonflement du creeper 0..1 (echelleRendu) ; taille : taille slime/magma (1, 2, 4)
 attaque    ticks restants de l'animation d'attaque (golem de fer 10, ravageur 10, hoglin 10, creaking) ; decompte auto
 mecontent  ticks restants de la tete secouee (villageois 40, panda) ; fleur : ticks du golem de fer qui tend une fleur (400)
 etourdi    ravageur etourdi (40 ticks ; a 0 il rugit) ; rugit : ticks du rugissement (20)
 broute     ticks restants du mouton qui broute (40)
 apprivoise loup apprivoise ; vie : sante/sante max 0..1 (queue du loup) ; mendie : loup/renard qui penche la tete
 secoue     mettre a true : le loup s'ebroue (remis a false)
 mange      cheval/panda qui mange ; cabre : cheval cabre ; debout : ours polaire debout ; belier : ticks tete baissee de la chevre 0..20
 cornes     [gauche, droite] cornes de chevre presentes ; pond, oeuf : tortue qui pond / porte un oeuf
 fete       perroquet qui danse / illageois qui celebre ; dard : abeille a encore son dard ; roule : abeille/panda qui roule
 danse      allay / piglin qui danse ; admire : piglin qui admire un objet ; charge : arbalete en charge (pillard, piglin), vex qui charge
 chargee    arbalete chargee (humanoide joueur) ; utilise : ticks d'utilisation de l'objet ; dureeCharge : ticks de charge (25)
 sort       illageois qui lance un sort ; bloc : enderman porte un bloc ; cri : enderman qui hurle
 fige       creaking fige (regarde) ; invulnerable : ticks creaking invulnerable ; demolit : creaking qui se defait
 harnais    happy ghast harnache ; armure : nautilus zombie arme (coraux caches)
 ouverture  ouverture voulue du shulker 0..100 ; bouge : gardien/axolotl en mouvement ; mortFeinte : axolotl
 interesse  renard tete penchee ; bondit : renard qui bondit ; nezSol : renard nez dans la neige ; eternue : compteur d'eternuement panda ; effraye, dos : panda
 posture    grenouille 'long_jumping'|'croaking'|'using_tongue' ; warden 'emerging'|'digging'|'roaring'|'sniffing' ;
            breeze 'shooting'|'inhaling'|'sliding'|'long_jumping' ; sniffer 'feeling_happy'|'scenting'|'sniffing'|'searching'|'digging'|'rising'
 perche     chauve-souris accrochee ; etatTatou : tatou 0 normal, 1 se roule, 2 effraye, 3 se deroule ; etatCuivre : golem de cuivre 0..4
 colere     colere du warden 0..150 (battement du coeur) ; vibration : true = vrilles du warden (remis a false)
 fonce      dromadaire qui fonce (dash) ; brasSwing : bras du coup (true droit, false gauche, null = principal)
 anim       horloges : { flap, flapO, flapSpeed, flapSpeedO, flapping, v:[8], vo:[8], states:[8] (tick de debut ou null) }
            v/vo par famille : Slime 0 squish 1 cible ; Squid 0 mouvement 1 angle tentacules 2 rotX corps (deg) 3 rotZ 4 vit. 5 rot ;
            Wolf 0 interet 1 ebrouement ; Feline 0 couche 1 queue 2 detente ; Horse 0 mange 1 cabre 2 bouche 3 queue ;
            Guardian 0 queue 1 vit. 2 piques 3 oeilX 4 oeilY ; Warden 0 vrilles 1 coeur ; Allay 0 tient 1 tourne ;
            Shulker 0 ouverture ; PolarBear 0 debout ; Fox 0 tete 1 accroupi ; Bee 0 roule ; Panda 0 assis 1 dos 2 roule ;
            Wither 0/1 lacet tetes droite/gauche (deg, relatif au corps) 2/3 tangage ; Axolotl : m.anim.axo
-------------------------------------------------------------------------------------------------------------------- */
export function etatInitial(type) {
  const fam = famille(type);
  const m = {
    age: 0, id: 0, bebe: estBebe(type), agressif: false, mainD: null, mainG: null, gaucher: false,
    passager: false, monte: false, nage: 0, dansEau: false, auSol: true, vy: 0, vh: 0,
    coffre: false, tondu: false, assis: false, accroupi: false, sprint: false, couche: false, detente: false, dort: false,
    gonfle: 0, taille: 1, attaque: 0, mecontent: 0, fleur: 0, etourdi: 0, rugit: 0, broute: 0,
    apprivoise: false, vie: 1, mendie: false, secoue: false, mange: false, cabre: false, debout: false, belier: 0,
    cornes: [true, true], pond: false, oeuf: false, fete: false, dard: true, roule: false, danse: false, admire: false,
    charge: false, chargee: false, utilise: 0, dureeCharge: 25, sort: false, bloc: false, cri: false,
    fige: false, invulnerable: 0, demolit: false, harnais: false, armure: false, ouverture: 0, bouge: false, mortFeinte: false,
    interesse: false, bondit: false, nezSol: false, eternue: 0, effraye: false, dos: false,
    posture: null, perche: false, etatTatou: 0, etatCuivre: 0, colere: 0, vibration: false, fonce: false, brasSwing: null,
    anim: { flap: 0, flapO: 0, flapSpeed: 0, flapSpeedO: 0, flapping: 1, v: new Array(8).fill(0), vo: new Array(8).fill(0),
      states: new Array(8).fill(null), axo: { old: [0, 0, 0, 0], val: [0, 0, 0, 0] } },
    _alea: 0, _sol: true, _posture: null, _poseTick: -1e9, _assis: false, _recharge: 0, _fonce: false, _compteur: 0, _tatou: 0, _tatouTicks: 0,
    _secoue: 0, _danse: 0, _cuivre: 0,
  };
  if (fam === 'Squid') m.anim.v[4] = 1 / 1.5 * 0.2;
  return m;
}

// Hasard deterministe (LCG) propre a la creature.
function alea(m) {
  m._alea = (Math.imul(m._alea ^ 0, 1664525) + 1013904223 + (m.id | 0)) >>> 0;
  return m._alea / 4294967296;
}
const lerpV = (m, i, partial) => m.anim.vo[i] + (m.anim.v[i] - m.anim.vo[i]) * partial;

// ---- humanoides (HumanoidModel) -------------------------------------------------------------------------------------
function tete(P, s) { P.xrot('head', rad(s.xRot)); P.yrot('head', rad(s.yRot)); }
function quadrupede(P, s) {
  tete(P, s);
  const { pos, speed: sp } = s;
  P.xrot('right_hind_leg', cos(pos * 0.6662) * 1.4 * sp);
  P.xrot('left_hind_leg', cos(pos * 0.6662 + PI) * 1.4 * sp);
  P.xrot('right_front_leg', cos(pos * 0.6662 + PI) * 1.4 * sp);
  P.xrot('left_front_leg', cos(pos * 0.6662) * 1.4 * sp);
}
// AnimationUtils.bobModelPart
function bob(P, n, age, k) {
  const q = P.get(n);
  q[5] += k * (cos(age * 0.09) * 0.05 + 0.05);
  q[3] += k * (sin(age * 0.067) * 0.05);
}
function coupArmeBas(P, swing, age, gaucheP) { // AnimationUtils.swingWeaponDown
  const a2 = sin(swing * PI), a = sin((1 - (1 - swing) * (1 - swing)) * PI);
  const [pr, se] = gaucheP ? ['left_arm', 'right_arm'] : ['right_arm', 'left_arm'];
  P.zrot('right_arm', 0); P.zrot('left_arm', 0);
  P.yrot('right_arm', PI / 20); P.yrot('left_arm', -PI / 20);
  P.xrot(pr, -1.8849558 + cos(age * 0.09) * 0.15);
  P.xrot(se, -0 + cos(age * 0.19) * 0.5);
  P.get(pr)[3] += a2 * 2.2 - a * 0.4;
  P.get(se)[3] += a2 * 1.2 - a * 0.4;
  bob(P, 'right_arm', age, 1); bob(P, 'left_arm', age, -1);
}
const deuxMains = (p) => p === 'arc' || p === 'arbTenue' || p === 'arbCharge';
const touteMain = (p) => deuxMains(p) || p === 'trident';
function arbaleteTenue(P, hx, hy, droite) { // AnimationUtils.animateCrossbowHold
  const [tient, tire] = droite ? ['right_arm', 'left_arm'] : ['left_arm', 'right_arm'];
  P.yrot(tient, (droite ? -0.3 : 0.3) + hy);
  P.yrot(tire, (droite ? 0.6 : -0.6) + hy);
  P.xrot(tient, -PI / 2 + hx + 0.1);
  P.xrot(tire, -1.5 + hx);
}
function arbaleteCharge(P, max, ticks, droite) { // AnimationUtils.animateCrossbowCharge
  const [tient, tire] = droite ? ['right_arm', 'left_arm'] : ['left_arm', 'right_arm'];
  P.yrot(tient, droite ? -0.8 : 0.8);
  P.xrot(tient, -0.97079635);
  P.xrot(tire, -0.97079635);
  const a = borne(ticks, 0, max) / max;
  P.yrot(tire, lerp(a, 0.4, 0.85) * (droite ? 1 : -1));
  P.xrot(tire, lerp(a, P.get(tire)[3], -PI / 2));
}
function poserBras(P, pose, droite, h) { // HumanoidModel.poseRightArm / poseLeftArm
  const bras = droite ? 'right_arm' : 'left_arm';
  const hx = P.get('head')[3], hy = P.get('head')[4];
  switch (pose) {
    case 'objet': P.xrot(bras, P.get(bras)[3] * 0.5 - PI / 10); P.yrot(bras, 0); break;
    case 'bloc':
      P.xrot(bras, P.get(bras)[3] * 0.5 - 0.9424779 + borne(hx, -1.3962634, 0.43633232));
      P.yrot(bras, (droite ? -PI / 6 : PI / 6) + borne(hy, -PI / 6, PI / 6)); break;
    case 'arc':
      P.yrot('right_arm', -0.1 + hy - (droite ? 0 : 0.4));
      P.yrot('left_arm', 0.1 + hy + (droite ? 0.4 : 0));
      P.xrot('right_arm', -PI / 2 + hx); P.xrot('left_arm', -PI / 2 + hx); break;
    case 'trident': P.xrot(bras, P.get(bras)[3] * 0.5 - PI); P.yrot(bras, 0); break;
    case 'arbTenue': arbaleteTenue(P, hx, hy, droite); break;
    case 'arbCharge': arbaleteCharge(P, h.charge[0], h.charge[1], droite); break;
    default: P.yrot(bras, 0);
  }
}
const hum = (droit = 'vide', gauche = 'vide') => ({ droit, gauche, accroupi: false, passager: false, zombie: null, tient: false,
  charge: [25, 0], coupArme: false, nage: 0, utilise: false, brasSwing: null, gaucher: false });
function nager(P, pos, h) { // HumanoidModel.setupSwimAnimation
  const q = h.nage;
  P.xrot('head', rotLerpRad(q, P.get('head')[3], -PI / 4));
  const sp = pos % 26;
  const qd = h.brasSwing === true ? 0 : q, qg = h.brasSwing === false ? 0 : q;
  const quad = (x) => -65 * x + x * x;
  if (!h.utilise) {
    let c = null;
    if (sp < 14) { const k = 1.8707964 * quad(sp) / quad(14); c = [[0, PI, PI + k], [0, PI, PI - k]]; }
    else if (sp < 22) { const t = (sp - 14) / 8, x = PI / 2 * t; c = [[x, PI, 5.012389 - 1.8707964 * t], [x, PI, 1.2707963 + 1.8707964 * t]]; }
    else if (sp < 26) { const t = (sp - 22) / 4, x = PI / 2 - PI / 2 * t; c = [[x, PI, PI], [x, PI, PI]]; }
    if (c) {
      const g = P.get('left_arm'), d = P.get('right_arm');
      for (let i = 0; i < 3; i++) { g[3 + i] = rotLerpRad(qg, g[3 + i], c[0][i]); d[3 + i] = lerp(qd, d[3 + i], c[1][i]); }
    }
  }
  P.xrot('left_leg', lerp(q, P.get('left_leg')[3], 0.3 * cos(pos * 0.33333334 + PI)));
  P.xrot('right_leg', lerp(q, P.get('right_leg')[3], 0.3 * cos(pos * 0.33333334)));
}
function humanoide(P, s, h) { // HumanoidModel.setupAnim (+ ZombieModel)
  tete(P, s);
  const { pos, speed: sp } = s;
  P.xrot('right_arm', cos(pos * 0.6662 + PI) * 2 * sp * 0.5);
  P.xrot('left_arm', cos(pos * 0.6662) * 2 * sp * 0.5);
  P.xrot('right_leg', cos(pos * 0.6662) * 1.4 * sp);
  P.xrot('left_leg', cos(pos * 0.6662 + PI) * 1.4 * sp);
  P.yrot('right_leg', 0.005); P.yrot('left_leg', -0.005); P.zrot('right_leg', 0.005); P.zrot('left_leg', -0.005);
  if (h.passager) {
    P.get('right_arm')[3] += -PI / 5; P.get('left_arm')[3] += -PI / 5;
    P.xrot('right_leg', -1.4137167); P.yrot('right_leg', PI / 10); P.zrot('right_leg', 0.07853982);
    P.xrot('left_leg', -1.4137167); P.yrot('left_leg', -PI / 10); P.zrot('left_leg', -0.07853982);
  }
  if (deuxMains(h.gauche)) { poserBras(P, h.droit, true, h); if (!touteMain(h.droit)) poserBras(P, h.gauche, false, h); }
  else { poserBras(P, h.gauche, false, h); if (!touteMain(h.gauche)) poserBras(P, h.droit, true, h); }
  const hx = P.get('head')[3], swing = s.swing;
  const swingG = h.brasSwing == null ? h.gaucher : !h.brasSwing;
  if (swing > 0 && h.coupArme) coupArmeBas(P, swing, s.age, h.gaucher);
  else if (swing > 0) {
    let by = sin(Math.sqrt(swing) * PI * 2) * 0.2;
    if (swingG) by = -by;
    P.yrot('body', by);
    const k = s.baby ? 0.5 : 1;
    const r = P.get('right_arm'); r[2] = sin(by) * 5 * k; r[0] = -cos(by) * 5 * k;
    const l = P.get('left_arm'); l[2] = -sin(by) * 5 * k; l[0] = cos(by) * 5 * k;
    P.get('right_arm')[4] += by; P.get('left_arm')[4] += by; P.get('left_arm')[3] += by;
    const aa = sin((1 - Math.pow(1 - swing, 4)) * PI), bb = sin(swing * PI) * -(hx - 0.7) * 0.75;
    const b = P.get(swingG ? 'left_arm' : 'right_arm');
    b[3] -= aa * 1.2 + bb; b[4] += by * 2; b[5] += sin(swing * PI) * -0.4;
  }
  if (h.zombie != null) { // AnimationUtils.animateZombieArms
    const leve = !s.baby || !h.tient;
    const chute = leve ? -PI / (h.zombie ? 1.5 : 2.25) : 0;
    const ym = (leve ? 1 : -1) * sin(swing * PI), xm = sin((1 - (1 - swing) * (1 - swing)) * PI);
    const x = chute + ym * 1.2 - xm * 0.4, y = 0.1 - ym * 0.6;
    if (h.droit !== 'trident') { P.xrot('right_arm', x); P.yrot('right_arm', leve ? -y : y); P.zrot('right_arm', 0); }
    if (h.gauche !== 'trident') { P.xrot('left_arm', x); P.yrot('left_arm', leve ? y : -y); P.zrot('left_arm', 0); }
  }
  if (h.accroupi) {
    P.xrot('body', 0.5);
    P.get('right_arm')[3] += 0.4; P.get('left_arm')[3] += 0.4;
    P.get('right_leg')[2] += 4; P.get('left_leg')[2] += 4;
    P.get('head')[1] += 4.2; P.get('body')[1] += 3.2; P.get('left_arm')[1] += 3.2; P.get('right_arm')[1] += 3.2;
  }
  bob(P, 'right_arm', s.age, 1); bob(P, 'left_arm', s.age, -1);
  if (h.nage > 0) nager(P, s.pos, h);
}
function nageNoye(P, s, q) { // DrownedModel.setupSwimAnimation
  if (q <= 0) return;
  const bal = q * 0.35 * sin(0.1 * s.age), pied = q * 0.55 * sin(0.1 * s.age), haut = -PI * 4 / 5;
  const d = P.get('right_arm'), g = P.get('left_arm');
  const [dx, gx, dz, gz] = [d[3], g[3], d[5], g[5]];
  P.xrot('right_arm', rotLerpRad(q, dx, haut) + bal); P.xrot('left_arm', rotLerpRad(q, gx, haut) - bal);
  P.zrot('right_arm', rotLerpRad(q, dz, -0.15)); P.zrot('left_arm', rotLerpRad(q, gz, 0.15));
  const [gl, dl] = [P.get('left_leg')[3], P.get('right_leg')[3]];
  P.xrot('left_leg', gl - pied); P.xrot('right_leg', dl + pied);
  P.xrot('head', 0);
}
function oreillesPiglin(P, s) { // AbstractPiglinModel.setupAnim
  const def = rad(s.baby ? 5 : 30), f = s.age * 0.1 + s.pos * 0.5, amp = 0.08 + s.speed * 0.4;
  P.zrot('left_ear', -def - cos(f * 1.2) * amp);
  P.zrot('right_ear', def + cos(f) * amp);
}
const vagueTriangle = (x, p) => Math.abs((x % p) - p * 0.5) / (p * 0.5) * 2 - 1; // golem.rs triangle_wave

// ---- poser : vanilla_setup ------------------------------------------------------------------------------------------
export function poser(type, P, s, m, anims) {
  const fam = famille(type);
  const age = s.age, partial = s.partial ?? 0, bebe = s.baby ?? m.bebe;
  if (s.baby == null) s = { ...s, baby: bebe };
  const st = m.anim.states;
  const { pos, speed } = s;
  switch (fam) {
    // -- body_anim.rs --
    case 'Goat': {
      quadrupede(P, s);
      P.visible('left_horn', m.cornes[0]); P.visible('right_horn', m.cornes[1]);
      const ram = m.belier / 20 * (bebe ? 52.5 : 30) * (PI / 180);
      if (ram !== 0) P.xrot('head', ram);
      if (bebe && ram === 0) P.xrot('head', PI / 8);
      break;
    }
    case 'PolarBear': {
      quadrupede(P, s);
      const k = lerpV(m, 0, partial) / 6, d = k * k, a = bebe ? 0.5 : 1;
      P.get('body')[3] += -(d * PI * 0.35); P.get('body')[1] += d * a * 2;
      const r = P.get('right_front_leg');
      r[1] += -(d * a * 20); r[2] += d * a * 4; r[3] += -(d * PI * 0.45);
      const l = P.get('left_front_leg'); l[1] = r[1]; l[2] = r[2]; l[3] -= d * PI * 0.45;
      const h = P.get('head'); h[1] += -(d * 24); h[2] += d * 13; h[3] += d * PI * 0.15;
      break;
    }
    case 'Panda': poserPanda(P, s, m, bebe, partial); break;
    case 'Llama':
      quadrupede(P, s);
      P.visible('right_chest', m.coffre && !bebe); P.visible('left_chest', m.coffre && !bebe);
      break;
    case 'Turtle': {
      quadrupede(P, s);
      if (!m.dansEau && m.auSol) {
        const pondre = m.pond ? 4 : 1, amp = m.pond ? 2 : 1, sw = pos * 5, av = cos(pondre * sw), ar = cos(sw);
        P.yrot('right_front_leg', -av * 8 * speed * amp); P.yrot('left_front_leg', av * 8 * speed * amp);
        P.yrot('right_hind_leg', -ar * 3 * speed); P.yrot('left_hind_leg', ar * 3 * speed);
      } else {
        const sw = cos(pos * 0.6662 * 0.6) * 0.5 * speed;
        P.xrot('right_hind_leg', sw); P.xrot('left_hind_leg', -sw); P.zrot('right_front_leg', -sw); P.zrot('left_front_leg', sw);
      }
      if (!bebe) { P.visible('egg_belly', m.oeuf); if (m.oeuf) P.get('root')[1] += -1; }
      break;
    }
    case 'Strider': poserStrider(P, s, m.monte, bebe); break;
    case 'SnowGolem': {
      P.yrot('head', rad(s.yRot)); P.xrot('head', rad(s.xRot));
      const y = rad(s.yRot) * 0.25;
      P.yrot('upper_body', y); P.yrot('left_arm', y); P.yrot('right_arm', y + PI);
      const g = P.get('left_arm'), d = P.get('right_arm');
      g[0] = cos(y) * 5; g[2] = -sin(y) * 5; d[0] = -cos(y) * 5; d[2] = sin(y) * 5;
      break;
    }
    case 'Silverfish':
      if (type === 'endermite') {
        for (let i = 0; i < 4; i++) {
          const d = Math.abs(i - 2), ph = age * 0.9 + i * 0.15 * PI, n = 'segment' + i;
          P.yrot(n, cos(ph) * PI * 0.01 * (1 + d)); P.get(n)[0] = sin(ph) * PI * 0.1 * d;
        }
      } else {
        const ys = [], xs = [];
        for (let i = 0; i < 7; i++) {
          const d = Math.abs(i - 2), ph = age * 0.9 + i * 0.15 * PI, n = 'segment' + i;
          ys[i] = cos(ph) * PI * 0.05 * (1 + d); xs[i] = sin(ph) * PI * 0.2 * d;
          P.yrot(n, ys[i]); P.get(n)[0] = xs[i];
        }
        P.yrot('layer0', ys[2]); P.yrot('layer1', ys[4]); P.get('layer1')[0] = xs[4]; P.yrot('layer2', ys[1]); P.get('layer2')[0] = xs[1];
      }
      break;
    case 'Parrot': {
      const a = m.anim, flap = a.flapO + (a.flap - a.flapO) * partial, fs = a.flapSpeedO + (a.flapSpeed - a.flapSpeedO) * partial;
      const pose = m.fete ? 'fete' : m.assis ? 'assis' : !m.auSol ? 'vol' : 'debout';
      poserPerroquet(P, s, pose, (sin(flap) + 1) * fs);
      break;
    }
    case 'Bee': {
      P.visible('stinger', m.dard);
      const sol = m.auSol && m.vh * m.vh + m.vy * m.vy < 1e-7;
      if (!sol) {
        const v = age * 120.32113 * (PI / 180);
        P.yrot('right_wing', 0); P.zrot('right_wing', cos(v) * PI * 0.15);
        const r = P.get('right_wing');
        P.xrot('left_wing', r[3]); P.yrot('left_wing', r[4]); P.zrot('left_wing', -r[5]);
        P.xrot('front_legs', PI / 4); P.xrot('middle_legs', PI / 4); P.xrot('back_legs', PI / 4);
      }
      if (!m.agressif && !sol) {
        const v = cos(age * 0.18);
        P.xrot('bone', 0.1 + v * PI * 0.025); P.get('bone')[1] += -(cos(age * 0.18) * 0.9);
        P.xrot('front_legs', -v * PI * 0.1 + PI / 8); P.xrot('back_legs', -v * PI * 0.05 + PI / 4);
        if (!bebe) { P.xrot('left_antenna', v * PI * 0.03); P.xrot('right_antenna', v * PI * 0.03); }
      }
      const roule = lerpV(m, 0, partial);
      if (roule > 0) P.xrot('bone', rotLerpRad(roule, P.get('bone')[3], 3.0915928));
      break;
    }
    case 'Bat':
      if (m.perche) P.yrot('head', s.yRot * (PI / 180));
      jouer(P, anims, 'bat', 'flying', st[0], age);
      jouer(P, anims, 'bat', 'resting', st[1], age);
      break;
    case 'Armadillo': {
      const f = bebe ? 'armadillo_baby' : 'armadillo';
      if (cacheTatou(m)) {
        P.sauter('body'); P.visible('left_hind_leg', false); P.visible('right_hind_leg', false); P.visible('tail', false);
      } else {
        P.visible('cube', false);
        P.xrot('head', borne(s.xRot, -22.5, 25) * (PI / 180)); P.yrot('head', borne(s.yRot, -32.5, 32.5) * (PI / 180));
        marcher(P, anims, f, 'walk', s, 16.5, 2.5);
      }
      jouer(P, anims, f, 'roll_out', st[0], age); jouer(P, anims, f, 'roll_up', st[1], age); jouer(P, anims, f, 'peek', st[2], age);
      break;
    }
    case 'Axolotl': poserAxolotl(P, s, m, bebe, partial, anims); break;
    case 'Frog':
      jouer(P, anims, 'frog', 'jump', st[0], age); jouer(P, anims, 'frog', 'croak', st[1], age); jouer(P, anims, 'frog', 'tongue', st[2], age);
      if (m.dansEau) marcher(P, anims, 'frog', 'swim', s, 1, 2.5); else marcher(P, anims, 'frog', 'walk', s, 1.5, 2.5);
      jouer(P, anims, 'frog', 'idle_water', st[3], age);
      P.visible('croaking_body', st[1] != null);
      break;
    case 'Rabbit': {
      if (st[1] == null) { P.yrot('head', s.yRot * (PI / 180)); P.xrot('head', s.xRot * (PI / 180)); }
      const f = bebe ? 'rabbit_baby' : 'rabbit';
      jouer(P, anims, f, 'hop', st[0], age); jouer(P, anims, f, 'idle_head_tilt', st[1], age);
      break;
    }
    case 'Fox': poserRenard(P, s, m, bebe, partial, anims); break;
    // -- anim.rs vanilla_setup --
    case 'Camel': {
      let y = borne(s.yRot, -30, 30), x = borne(s.xRot, -25, 45);
      const rec = Math.max(m._recharge - partial, 0);
      if (rec > 0) x = borne(x + 45 * rec / 55, -25, 70);
      P.yrot('head', rad(y)); P.xrot('head', rad(x));
      const f = bebe ? 'camel_baby' : 'camel';
      marcher(P, anims, f, 'walk', s, 2, 2.5);
      ['sit', 'sit_pose', 'standup', 'idle', 'dash'].forEach((n, i) => jouer(P, anims, f, n, st[i], age));
      break;
    }
    case 'Breeze': ETATS.Breeze.forEach((n, i) => jouer(P, anims, 'breeze', n, st[i], age)); break;
    case 'Sniffer':
      tete(P, s);
      marcher(P, anims, 'sniffer', m.posture === 'searching' ? 'sniff_search' : 'walk', s, 9, 100);
      for (const i of [3, 2, 4, 0, 1]) jouer(P, anims, 'sniffer', ETATS.Sniffer[i], st[i], age);
      break;
    case 'CopperGolem': {
      tete(P, s);
      if (m.mainD != null || m.mainG != null) {
        marcher(P, anims, 'copper_golem', 'walk_item', s, 2, 2.5);
        const r = P.get('right_arm'); r[3] = Math.min(r[3], -0.8726646); r[4] = Math.min(r[4], -0.1134464); r[5] = Math.min(r[5], -0.064577185);
        const l = P.get('left_arm'); l[3] = Math.min(l[3], -0.8726646); l[4] = Math.max(l[4], 0.1134464); l[5] = Math.max(l[5], 0.064577185);
      } else marcher(P, anims, 'copper_golem', 'walk', s, 2, 2.5);
      ETATS.CopperGolem.forEach((n, i) => jouer(P, anims, 'copper_golem', n, st[i], age));
      break;
    }
    case 'HappyGhast':
      if (P.has('goggles')) { const g = P.get('goggles'); if (m.monte) { g[3] = 0; g[1] = 14; } else { g[3] = -0.7854; g[1] = 9; } }
      if (m.harnais) { const b = P.get('body'); b[6] = b[7] = b[8] = 0.9375; }
      tentacules(P, s);
      break;
    case 'Nautilus': {
      P.yrot('body', borne(s.yRot, -10, 10) * (PI / 180)); P.xrot('body', borne(s.xRot, -10, 10) * (PI / 180));
      const a = anims && anims.nautilus && anims.nautilus.swimming;
      if (a) appliquerMarche(a, pos + age / 5, speed + 0.2, 2, 3, P);
      if (m.armure) P.visible('corals', false);
      break;
    }
    case 'Warden': poserWarden(P, s, m, anims); break;
    case 'Allay': poserAllay(P, s, m, partial); break;
    case 'Creaking':
      tete(P, s);
      if (!m.fige) marcher(P, anims, 'creaking', 'walk', s, 1, 1);
      ['attack', 'invulnerable', 'death'].forEach((n, i) => jouer(P, anims, 'creaking', n, st[i], age));
      break;
    case 'Squid': {
      const a = lerpV(m, 1, partial);
      for (let i = 0; i < 8; i++) P.xrot('tentacle' + i, a);
      break;
    }
    case 'Fish': {
      const eau = m.dansEau, amp = eau ? 1 : 1.5;
      if (type === 'cod') P.yrot('tail_fin', -amp * 0.45 * sin(0.6 * age));
      else if (type === 'tadpole') P.yrot('tail', -(eau ? 1 : 1.5) * 0.25 * sin(0.3 * age));
      else if (type.startsWith('tropical_fish')) P.yrot('tail', -amp * 0.45 * sin(0.6 * age));
      else if (type.startsWith('salmon')) { const [a, k] = eau ? [1, 1] : [1.3, 1.7]; P.yrot('body_back', -a * 0.25 * sin(k * 0.6 * age)); }
      break;
    }
    case 'Pufferfish': {
      const f = 0.2 - 0.4 * sin(age * 0.2);
      if (P.has('right_blue_fin')) { P.zrot('right_blue_fin', -f); P.zrot('left_blue_fin', f); }
      else { P.zrot('right_fin', -f); P.zrot('left_fin', f); }
      break;
    }
    case 'Dolphin':
      P.xrot('body', rad(s.xRot)); P.yrot('body', rad(s.yRot));
      if (m.vh * m.vh > 1e-7) {
        P.get('body')[3] += -0.05 - 0.05 * cos(age * 0.3);
        P.xrot('tail', -0.1 * cos(age * 0.3)); P.xrot('tail_fin', -0.2 * cos(age * 0.3));
      }
      break;
    case 'Quadruped': quadrupede(P, s); break;
    case 'Sheep': {
      quadrupede(P, s);
      const t = m.broute;
      const k = t <= 0 ? 0 : t >= 4 && t <= 36 ? 1 : t < 4 ? (t - partial) / 4 : -((t - 40) - partial) / 4;
      const ang = t > 4 && t <= 36 ? PI / 5 + 0.21991149 * sin(((t - 4) - partial) / 32 * 28.7) : t > 0 ? PI / 5 : rad(s.xRot);
      P.get('head')[1] += k * 9 * (bebe ? 0.5 : 1);
      P.xrot('head', ang);
      break;
    }
    case 'Chicken': {
      const a = m.anim, flap = a.flapO + (a.flap - a.flapO) * partial, fs = a.flapSpeedO + (a.flapSpeed - a.flapSpeedO) * partial;
      const ang = (sin(flap) + 1) * fs;
      P.xrot('right_leg', cos(pos * 0.6662) * 1.4 * speed); P.xrot('left_leg', cos(pos * 0.6662 + PI) * 1.4 * speed);
      P.zrot('right_wing', ang); P.zrot('left_wing', -ang);
      if (!bebe) tete(P, s);
      break;
    }
    case 'Zombie': case 'Drowned': case 'ZombieVillager': case 'ZombifiedPiglin': case 'HumanoidZombie': {
      const lance = fam === 'Drowned' && m.agressif && m.mainD === 'trident';
      const pr = lance ? 'trident' : 'vide';
      const h = m.gaucher ? hum('vide', pr) : hum(pr, 'vide');
      h.gaucher = m.gaucher; h.zombie = !!m.agressif; h.tient = m.mainD != null; h.accroupi = m.accroupi; h.passager = m.passager;
      humanoide(P, s, h);
      if (fam === 'Drowned') nageNoye(P, s, m.nage);
      if (fam === 'ZombifiedPiglin') oreillesPiglin(P, s);
      break;
    }
    case 'Skeleton': case 'Humanoid': {
      const arc = m.mainD === 'bow', joueur = fam === 'Humanoid', u = m.utilise > 0;
      let pose = arc && m.agressif ? 'arc' : 'vide';
      if (joueur) {
        const o = m.mainD;
        pose = o == null ? 'vide' : o === 'bow' && u ? 'arc' : o === 'trident' && u ? 'trident'
          : o === 'crossbow' && u && !m.chargee ? 'arbCharge' : o === 'crossbow' && m.chargee && s.swing === 0 ? 'arbTenue' : 'objet';
      }
      const sec = joueur && m.mainG != null && !touteMain(pose) ? 'objet' : 'vide';
      const h = m.gaucher ? hum(sec, pose) : hum(pose, sec);
      h.charge = [m.dureeCharge, m.utilise]; h.accroupi = m.accroupi; h.passager = m.passager; h.nage = m.nage;
      h.utilise = u; h.brasSwing = m.brasSwing; h.gaucher = m.gaucher;
      humanoide(P, s, h);
      if (m.agressif && !arc) { // SkeletonModel : pose de melee
        const sw = s.swing, s2 = sin(sw * PI), s1 = sin((1 - (1 - sw) * (1 - sw)) * PI);
        P.zrot('right_arm', 0); P.zrot('left_arm', 0);
        P.yrot('right_arm', -(0.1 - s2 * 0.6)); P.yrot('left_arm', 0.1 - s2 * 0.6);
        P.xrot('right_arm', -PI / 2 - (s2 * 1.2 - s1 * 0.4)); P.xrot('left_arm', -PI / 2 - (s2 * 1.2 - s1 * 0.4));
        bob(P, 'right_arm', age, 1); bob(P, 'left_arm', age, -1);
      }
      if (type === 'bogged') P.visible('mushrooms', !m.tondu);
      break;
    }
    case 'Witch': {
      P.yrot('head', rad(s.yRot)); P.xrot('head', rad(s.xRot));
      P.xrot('right_leg', cos(pos * 0.6662) * 1.4 * speed * 0.5); P.xrot('left_leg', cos(pos * 0.6662 + PI) * 1.4 * speed * 0.5);
      const v = 0.01 * ((m.id | 0) % 10);
      P.xrot('nose', sin(age * v) * 4.5 * (PI / 180)); P.zrot('nose', cos(age * v) * 2.5 * (PI / 180));
      if (m.mainD != null) { const n = P.get('nose'); n[0] = 0; n[1] = 1; n[2] = -1.5; n[3] = -0.9; }
      break;
    }
    case 'Villager': {
      const eveille = !m.dort;
      P.yrot('head', eveille ? rad(s.yRot) : 0); P.xrot('head', eveille ? rad(s.xRot) : 0);
      if (m.mecontent > 0) { P.zrot('head', 0.3 * sin(0.45 * age)); P.xrot('head', 0.4); } else P.zrot('head', 0);
      P.xrot('right_leg', cos(pos * 0.6662) * 1.4 * speed * 0.5); P.xrot('left_leg', cos(pos * 0.6662 + PI) * 1.4 * speed * 0.5);
      P.yrot('right_leg', 0); P.yrot('left_leg', 0);
      break;
    }
    case 'Wolf': poserLoup(P, s, m, bebe, partial); break;
    case 'IronGolem': {
      const att = m.attaque > 0 ? m.attaque - partial : 0;
      if (att > 0) { P.xrot('right_arm', -2 + 1.5 * vagueTriangle(att, 10)); P.xrot('left_arm', -2 + 1.5 * vagueTriangle(att, 10)); }
      else if (m.fleur > 0) { P.xrot('right_arm', -0.8 + 0.025 * vagueTriangle(m.fleur, 70)); P.xrot('left_arm', 0); }
      else { P.xrot('right_arm', (-0.2 + 1.5 * vagueTriangle(pos, 13)) * speed); P.xrot('left_arm', (-0.2 - 1.5 * vagueTriangle(pos, 13)) * speed); }
      P.yrot('head', rad(s.yRot)); P.xrot('head', rad(s.xRot));
      P.xrot('right_leg', -1.5 * vagueTriangle(pos, 13) * speed); P.xrot('left_leg', 1.5 * vagueTriangle(pos, 13) * speed);
      P.yrot('right_leg', 0); P.yrot('left_leg', 0);
      break;
    }
    case 'Illager': poserIllageois(P, s, m, type, partial); break;
    case 'Piglin': poserPiglin(P, s, m, partial); break;
    case 'Phantom': {
      const f = ((m.id | 0) * 3 + age) * rad(7.448451), w = cos(f) * rad(16);
      P.zrot('left_wing_base', w); P.zrot('left_wing_tip', w); P.zrot('right_wing_base', -w); P.zrot('right_wing_tip', -w);
      const q = -rad(5 + cos(f * 2) * 5);
      P.xrot('tail_base', q); P.xrot('tail_tip', q);
      break;
    }
    case 'Guardian': {
      P.yrot('head', rad(s.yRot)); P.xrot('head', rad(s.xRot));
      const retrait = (1 - lerpV(m, 2, partial)) * 0.55;
      const X = [0, 0, 8, -8, -8, 8, 8, -8, 0, 0, 8, -8], Y = [-8, -8, -8, -8, 0, 0, 0, 0, 8, 8, 8, 8], Z = [8, -8, 0, 0, -8, -8, 8, 8, 8, -8, 0, 0];
      for (let i = 0; i < 12; i++) {
        const o = 1 + cos(age * 1.5 + i) * 0.01 - retrait, p = P.get('spike' + i);
        p[0] = X[i] * o; p[1] = 16 + Y[i] * o; p[2] = Z[i] * o;
      }
      const e = P.get('eye'); e[0] = m.anim.v[3]; e[1] = m.anim.v[4];
      const q = lerpV(m, 0, partial);
      P.yrot('tail0', sin(q) * PI * 0.05); P.yrot('tail1', sin(q) * PI * 0.1); P.yrot('tail2', sin(q) * PI * 0.15);
      break;
    }
    case 'Vex': {
      P.yrot('head', rad(s.yRot)); P.xrot('head', rad(s.xRot));
      const b = cos(age * 5.5 * (PI / 180)) * 0.1;
      P.zrot('right_arm', PI / 5 + b); P.zrot('left_arm', -(PI / 5 + b));
      if (m.charge) {
        P.xrot('body', 0);
        const d = m.mainD != null, g = m.mainG != null;
        if (!d && !g) {
          P.xrot('right_arm', -1.2217305); P.yrot('right_arm', PI / 12); P.zrot('right_arm', -0.47123888 - b);
          P.xrot('left_arm', -1.2217305); P.yrot('left_arm', -PI / 12); P.zrot('left_arm', 0.47123888 + b);
        } else {
          const ep = PI * 7 / 6;
          if (d) { P.xrot('right_arm', ep); P.yrot('right_arm', PI / 12); P.zrot('right_arm', -0.47123888 - b); }
          if (g) { P.xrot('left_arm', ep); P.yrot('left_arm', -PI / 12); P.zrot('left_arm', 0.47123888 + b); }
        }
      } else P.xrot('body', PI / 20);
      const w = 1.0995574 + cos(age * 45.836624 * (PI / 180)) * (PI / 180) * 16.2;
      P.yrot('left_wing', w); P.yrot('right_wing', -w);
      P.xrot('left_wing', 0.47123888); P.zrot('left_wing', -0.47123888); P.xrot('right_wing', 0.47123888); P.zrot('right_wing', 0.47123888);
      break;
    }
    case 'Wither': {
      ['right_head', 'left_head'].forEach((h, i) => { P.yrot(h, rad(lerpV(m, i, partial))); P.xrot(h, rad(lerpV(m, 2 + i, partial))); });
      const a = cos(age * 0.1), cote = (0.065 + 0.05 * a) * PI;
      P.xrot('ribcage', cote);
      const q = P.get('tail'); q[0] = -2; q[1] = 6.9 + cos(cote) * 10; q[2] = -0.5 + sin(cote) * 10;
      P.xrot('tail', (0.265 + 0.1 * a) * PI);
      P.yrot('center_head', rad(s.yRot)); P.xrot('center_head', rad(s.xRot));
      break;
    }
    case 'Ravager': poserRavageur(P, s, m, partial); break;
    case 'Shulker': {
      const pk = lerpV(m, 0, partial), bs = (0.5 + pk) * PI, q = -1 + sin(bs);
      const ex = bs > PI ? sin(age * 0.1) * 0.7 : 0;
      const l = P.get('lid'); l[1] = 16 + sin(bs) * 8 + ex; l[4] = pk > 0.3 ? q * q * q * q * PI * 0.125 : 0;
      P.xrot('head', rad(s.xRot)); P.yrot('head', rad(s.yRot - 180));
      break;
    }
    case 'Horse':
      poserEquide(P, s, m, type, bebe, partial);
      if (!m.coffre) { P.visible('left_chest', false); P.visible('right_chest', false); }
      for (const n of ['left_saddle_line', 'right_saddle_line']) P.visible(n, !!m.monte);
      break;
    case 'Hoglin': {
      P.zrot('right_ear', -PI * 2 / 9 - speed * sin(pos)); P.zrot('left_ear', PI * 2 / 9 + speed * sin(pos));
      P.yrot('head', rad(s.yRot));
      const f = 1 - Math.abs(10 - 2 * m.attaque) / 10;
      P.xrot('head', 0.87266463 + (-PI / 9 - 0.87266463) * f);
      if (bebe) P.get('head')[1] += f * 2.5;
      P.xrot('right_front_leg', cos(pos) * 1.2 * speed); P.xrot('left_front_leg', cos(pos + PI) * 1.2 * speed);
      P.xrot('right_hind_leg', cos(pos + PI) * 1.2 * speed); P.xrot('left_hind_leg', cos(pos) * 1.2 * speed);
      break;
    }
    case 'Blaze': {
      let a = age * PI * -0.1;
      for (let i = 0; i < 4; i++) { const p = P.get('part' + i); p[1] = -2 + cos((i * 2 + age) * 0.25); p[0] = cos(a) * 9; p[2] = sin(a) * 9; a += PI / 2; }
      a = PI / 4 + age * PI * 0.03;
      for (let i = 4; i < 8; i++) { const p = P.get('part' + i); p[1] = 2 + cos((i * 2 + age) * 0.25); p[0] = cos(a) * 7; p[2] = sin(a) * 7; a += PI / 2; }
      a = 0.47123894 + age * PI * -0.05;
      for (let i = 8; i < 12; i++) { const p = P.get('part' + i); p[1] = 11 + cos((i * 1.5 + age) * 0.5); p[0] = cos(a) * 5; p[2] = sin(a) * 5; a += PI / 2; }
      P.yrot('head', rad(s.yRot)); P.xrot('head', rad(s.xRot));
      break;
    }
    case 'Ghast': tentacules(P, s); break;
    case 'Feline': poserFelin(P, s, m, bebe, partial); break;
    case 'Enderman': {
      const h = hum(); h.passager = m.passager;
      humanoide(P, s, h);
      for (const n of ['right_arm', 'left_arm', 'right_leg', 'left_leg']) P.xrot(n, borne(P.get(n)[3] * 0.5, -0.4, 0.4));
      if (m.bloc) { P.xrot('right_arm', -0.5); P.xrot('left_arm', -0.5); P.zrot('right_arm', 0.05); P.zrot('left_arm', -0.05); }
      if (m.cri) { P.get('head')[1] -= 5; P.get('hat')[1] += 5; }
      break;
    }
    case 'Slime': break; // pas d'animation de modele (l'ecrasement est une echelle : echelleRendu)
    case 'MagmaCube': {
      const sq = Math.max(lerpV(m, 0, partial), 0);
      for (let i = 0; i < 8; i++) P.get('cube' + i)[1] = -(4 - i) * sq * 1.7;
      break;
    }
    case 'Creeper': // CreeperModel lie ses champs aux parties du cote oppose
      tete(P, s);
      P.xrot('left_hind_leg', cos(pos * 0.6662) * 1.4 * speed);
      P.xrot('right_hind_leg', cos(pos * 0.6662 + PI) * 1.4 * speed);
      P.xrot('left_front_leg', cos(pos * 0.6662 + PI) * 1.4 * speed);
      P.xrot('right_front_leg', cos(pos * 0.6662) * 1.4 * speed);
      break;
    case 'Spider': {
      tete(P, s);
      const p = pos * 0.6662;
      const sw = (o) => -(cos(p * 2 + o) * 0.4) * speed, pas = (o) => Math.abs(sin(p + o) * 0.4) * speed;
      for (const [d, g, o] of [['right_hind_leg', 'left_hind_leg', 0], ['right_middle_hind_leg', 'left_middle_hind_leg', PI],
        ['right_middle_front_leg', 'left_middle_front_leg', PI / 2], ['right_front_leg', 'left_front_leg', PI * 3 / 2]]) {
        const a = sw(o), b = pas(o);
        P.get(d)[4] += a; P.get(g)[4] -= a; P.get(d)[5] += b; P.get(g)[5] -= b;
      }
      break;
    }
    default:
      if (P.has('head')) tete(P, s);
      if (P.has('right_hind_leg')) quadrupede(P, s);
  }
}

function tentacules(P, s) { // GhastModel.animateTentacles
  for (let i = 0; i < 9; i++) { const n = 'tentacle' + i; if (P.has(n)) P.xrot(n, 0.2 * sin(s.age * 0.3 + i) + 0.4); }
}
function poserPanda(P, s, m, bebe, partial) {
  quadrupede(P, s);
  const age = s.age, sit = lerpV(m, 0, partial), dos = lerpV(m, 1, partial), roule = bebe ? 0 : lerpV(m, 2, partial);
  if (m.mecontent > 0) {
    P.yrot('head', 0.35 * sin(0.6 * age)); P.zrot('head', 0.35 * sin(0.6 * age));
    P.xrot('right_front_leg', -0.75 * sin(0.3 * age)); P.xrot('left_front_leg', 0.75 * sin(0.3 * age));
  } else P.zrot('head', 0);
  if (m.eternue > 0) {
    const t = m.eternue;
    if (t < 15) P.xrot('head', -PI / 4 * t / 14);
    else if (t < 20) P.xrot('head', -PI / 4 + PI / 4 * Math.trunc((t - 15) / 5));
  }
  if (sit > 0) {
    if (bebe) {
      P.xrot('body', rotLerpRad(sit, P.get('body')[3], PI / 18));
      P.get('body')[2] = lerp(sit, P.get('body')[2], -1.5);
      P.get('head')[2] = lerp(sit, P.get('head')[2], -11.5);
      P.get('head')[1] = lerp(sit, P.get('head')[1], 17.5);
      for (const [n, z] of [['right_front_leg', -5], ['left_front_leg', -5], ['right_hind_leg', 3], ['left_hind_leg', 3]]) P.get(n)[2] = lerp(sit, P.get(n)[2], z);
    } else {
      P.xrot('body', rotLerpRad(sit, P.get('body')[3], 1.7407963));
      P.xrot('head', rotLerpRad(sit, P.get('head')[3], PI / 2));
    }
    P.zrot('right_front_leg', -0.27079642); P.zrot('left_front_leg', 0.27079642);
    P.zrot('right_hind_leg', 0.5707964); P.zrot('left_hind_leg', -0.5707964);
    if (m.mange) {
      P.xrot('head', PI / 2 + 0.2 * sin(age * 0.6));
      P.xrot('right_front_leg', -0.4 - 0.2 * sin(age * 0.6)); P.xrot('left_front_leg', -0.4 - 0.2 * sin(age * 0.6));
    }
    if (m.effraye) { P.xrot('head', 2.1707964); P.xrot('right_front_leg', -0.9); P.xrot('left_front_leg', -0.9); }
  } else for (const n of ['right_hind_leg', 'left_hind_leg', 'right_front_leg', 'left_front_leg']) P.zrot(n, 0);
  if (dos > 0) {
    P.xrot('right_hind_leg', -0.6 * sin(age * 0.15)); P.xrot('left_hind_leg', 0.6 * sin(age * 0.15));
    P.xrot('right_front_leg', 0.3 * sin(age * 0.25)); P.xrot('left_front_leg', -0.3 * sin(age * 0.25));
    P.xrot('head', rotLerpRad(dos, P.get('head')[3], PI / 2));
  }
  if (roule > 0) {
    P.xrot('head', rotLerpRad(roule, P.get('head')[3], 2.0561945));
    P.xrot('right_hind_leg', -0.5 * sin(age * 0.5)); P.xrot('left_hind_leg', 0.5 * sin(age * 0.5));
    P.xrot('right_front_leg', 0.5 * sin(age * 0.5)); P.xrot('left_front_leg', -0.5 * sin(age * 0.5));
  }
}
function soies(P, age, flux, n, axe) { // StriderModel.animateBristle
  P.get(n[0])[axe] += flux * 0.6; P.get(n[1])[axe] += flux * 1.2; P.get(n[2])[axe] += flux * 1.3;
  P.get(n[0])[axe] += 0.1 * sin(age * 0.4); P.get(n[1])[axe] += 0.1 * sin(age * 0.2); P.get(n[2])[axe] += 0.05 * sin(age * -0.4);
}
function poserStrider(P, s, monte, bebe) {
  const pos = s.pos, sp = Math.min(s.speed, 0.25);
  if (!monte) { P.xrot('body', rad(s.xRot)); P.yrot('body', rad(s.yRot)); } else { P.xrot('body', 0); P.yrot('body', 0); }
  P.zrot('body', 0.1 * sin(pos * 1.5) * 4 * sp);
  P.xrot('left_leg', sin(pos * 1.5 * 0.5) * 2 * sp); P.xrot('right_leg', sin(pos * 1.5 * 0.5 + PI) * 2 * sp);
  P.zrot('left_leg', PI / 18 * cos(pos * 1.5 * 0.5) * sp); P.zrot('right_leg', PI / 18 * cos(pos * 1.5 * 0.5 + PI) * sp);
  const flux = cos(pos * 1.5 + PI) * sp;
  if (!bebe) {
    P.zrot('right_bottom_bristle', -1.2217305); P.zrot('right_middle_bristle', -1.134464); P.zrot('right_top_bristle', -0.87266463);
    P.zrot('left_top_bristle', 0.87266463); P.zrot('left_middle_bristle', 1.134464); P.zrot('left_bottom_bristle', 1.2217305);
    soies(P, s.age, flux, ['right_top_bristle', 'right_middle_bristle', 'right_bottom_bristle'], 5);
    soies(P, s.age, flux, ['left_top_bristle', 'left_middle_bristle', 'left_bottom_bristle'], 5);
    P.get('body')[1] = 2; P.get('body')[1] -= 2 * cos(pos * 1.5) * 2 * sp;
    P.get('left_leg')[1] = 8 + 2 * sin(pos * 1.5 * 0.5 + PI) * 2 * sp;
    P.get('right_leg')[1] = 8 + 2 * sin(pos * 1.5 * 0.5) * 2 * sp;
  } else {
    P.get('body')[1] = 17.25; P.get('body')[1] -= 1 * cos(pos * 1.5) * 2 * sp;
    P.get('left_leg')[1] = 20 + 2 * sin(pos * 1.5 * 0.5 + PI) * 2 * sp;
    P.get('right_leg')[1] = 20 + 2 * sin(pos * 1.5 * 0.5) * 2 * sp;
    soies(P, s.age, flux, ['bristle2', 'bristle1', 'bristle0'], 3);
  }
}
function poserPerroquet(P, s, pose, flap) { // ParrotModel.setupAnim
  const add = (n, i, v) => { P.get(n)[i] += v; };
  if (pose === 'vol') { add('left_leg', 3, PI * 2 / 9); add('right_leg', 3, PI * 2 / 9); }
  else if (pose === 'assis') {
    add('head', 1, 1.9); add('tail', 3, PI / 6); add('tail', 1, 1.9); add('body', 1, 1.9);
    P.zrot('left_wing', -0.0873); add('left_wing', 1, 1.9); P.zrot('right_wing', 0.0873); add('right_wing', 1, 1.9);
    add('left_leg', 1, 1.9); add('right_leg', 1, 1.9); add('left_leg', 3, PI / 2); add('right_leg', 3, PI / 2);
  } else if (pose === 'fete') { P.zrot('left_leg', -PI / 9); P.zrot('right_leg', PI / 9); }
  tete(P, s);
  const flotte = () => {
    const b = flap * 0.3;
    add('head', 1, b); add('tail', 3, cos(s.pos * 0.6662) * 0.3 * s.speed); add('tail', 1, b); add('body', 1, b);
    P.zrot('left_wing', -0.0873 - flap); add('left_wing', 1, b); P.zrot('right_wing', 0.0873 + flap); add('right_wing', 1, b);
    add('left_leg', 1, b); add('right_leg', 1, b);
  };
  if (pose === 'debout') {
    add('left_leg', 3, cos(s.pos * 0.6662) * 1.4 * s.speed); add('right_leg', 3, cos(s.pos * 0.6662 + PI) * 1.4 * s.speed);
    flotte();
  } else if (pose === 'vol') flotte();
  else if (pose === 'fete') {
    const x = cos(s.age), y = sin(s.age);
    add('head', 0, x); add('head', 1, y); P.xrot('head', 0); P.yrot('head', 0); P.zrot('head', sin(s.age) * 0.4);
    add('body', 0, x); add('body', 1, y);
    P.zrot('left_wing', -0.0873 - flap); add('left_wing', 0, x); add('left_wing', 1, y);
    P.zrot('right_wing', 0.0873 + flap); add('right_wing', 0, x); add('right_wing', 1, y);
    add('tail', 0, x); add('tail', 1, y);
  }
}
function cacheTatou(m) { // ArmadilloState.shouldHideInShell
  const t = m._tatouTicks;
  return m.etatTatou === 1 ? t > 5 : m.etatTatou === 2 ? true : m.etatTatou === 3 ? t < 26 : false;
}
function facteurAxo(m, i, partial) {
  const a = m.anim.axo, x = (a.old[i] + (a.val[i] - a.old[i]) * partial) / 10;
  return (1 - cos(x * PI)) / 2;
}
function poserAxolotl(P, s, m, bebe, partial, anims) {
  const st = m.anim.states, age = s.age, add = (n, i, v) => { P.get(n)[i] += v; };
  if (bebe) {
    const f = 'axolotl_baby';
    if (st[0] != null) marcher(P, anims, f, 'walk_floor', s, 15, 30);
    jouer(P, anims, f, 'swim', st[1], age);
    jouer(P, anims, f, 'walk_floor_underwater', st[0], age); // le modele relit walkAnimationState
    jouer(P, anims, f, 'idle_floor', st[3], age);
    jouer(P, anims, f, 'idle_underwater', st[4], age);
    jouer(P, anims, f, 'idle_floor_underwater', st[5], age);
    jouer(P, anims, f, 'play_dead', st[6], age);
    return;
  }
  const mort = facteurAxo(m, 0, partial), eau = facteurAxo(m, 1, partial), sol = facteurAxo(m, 2, partial), bouge = facteurAxo(m, 3, partial);
  const immobile = 1 - bouge, miroir = 1 - Math.min(sol, bouge);
  add('body', 4, s.yRot * (PI / 180));
  let k = Math.min(bouge, eau);
  if (k > 1e-5) { // swim
    const w = age * 0.33, si = sin(w), co = cos(w), bs = 0.13 * si;
    add('body', 3, (s.xRot * (PI / 180) + bs) * k); add('head', 3, -(bs * 1.8 * k)); add('body', 1, -(0.45 * co * k));
    add('top_gills', 3, (-0.5 * si - 0.8) * k);
    const gy = (0.3 * si + 0.9) * k; add('left_gills', 4, gy); add('right_gills', 4, -gy);
    P.yrot('tail', P.get('tail')[4] + 0.3 * cos(w * 0.9) * k);
    add('left_hind_leg', 3, 1.8849558 * k); add('left_hind_leg', 4, -0.4 * si * k); add('left_hind_leg', 5, PI / 2 * k);
    add('left_front_leg', 3, 1.8849558 * k); add('left_front_leg', 4, (-0.2 * co - 0.1) * k); add('left_front_leg', 5, PI / 2 * k);
  }
  k = Math.min(immobile, eau);
  if (k > 1e-5) { // hover
    const w = age * 0.075, co = cos(w), si = sin(w) * 0.15, bx = (-0.15 + 0.075 * co) * k;
    add('body', 3, bx); add('body', 1, -(si * k)); add('head', 3, -bx); add('top_gills', 3, 0.2 * co * k);
    const gy = (-0.3 * co - 0.19) * k; add('left_gills', 4, gy); add('right_gills', 4, -gy);
    add('left_hind_leg', 3, (PI * 3 / 4 - co * 0.11) * k); add('left_hind_leg', 4, 0.47123894 * k); add('left_hind_leg', 5, 1.7278761 * k);
    add('left_front_leg', 3, (PI / 4 - co * 0.2) * k); add('left_front_leg', 4, 2.042035 * k); add('tail', 4, 0.5 * co * k);
  }
  k = Math.min(bouge, sol);
  if (k > 1e-5) { // crawl
    const w = age * 0.11, co = cos(w), hy = (co * co - 2 * co) / 5, fy = 0.7 * co, ht = 0.09 * co * k;
    add('head', 4, ht); add('tail', 4, ht);
    const g = (0.6 - 0.08 * (co * co + 2 * sin(w))) * k;
    add('top_gills', 3, g); add('left_gills', 4, -g); add('right_gills', 4, g);
    const hx = 0.9424779 * k, fx = 1.0995574 * k;
    add('left_hind_leg', 3, hx); add('left_hind_leg', 4, (1.5 - hy) * k); add('left_hind_leg', 5, -0.1 * k);
    add('left_front_leg', 3, fx); add('left_front_leg', 4, (PI / 2 - fy) * k);
    add('right_hind_leg', 3, hx); add('right_hind_leg', 4, (-1 - hy) * k);
    add('right_front_leg', 3, fx); add('right_front_leg', 4, (-PI / 2 - fy) * k);
  }
  k = Math.min(immobile, sol);
  if (k > 1e-5) { // lay
    const w = age * 0.09, si = sin(w), co = cos(w), mv = si * si - 2 * si, mv2 = co * co - 3 * si;
    add('head', 3, -0.09 * mv * k); add('head', 5, -0.2 * k); add('tail', 4, (-0.1 + 0.1 * mv) * k);
    const g = (0.6 + 0.05 * mv2) * k;
    add('top_gills', 3, g); add('left_gills', 4, -g); add('right_gills', 4, g);
    add('left_hind_leg', 3, 1.1 * k); add('left_hind_leg', 4, 1 * k);
    add('left_front_leg', 3, 0.8 * k); add('left_front_leg', 4, 2.3 * k); add('left_front_leg', 5, -0.5 * k);
  }
  if (mort > 1e-5) {
    add('left_hind_leg', 3, 1.4137167 * mort); add('left_hind_leg', 4, 1.0995574 * mort); add('left_hind_leg', 5, PI / 4 * mort);
    add('left_front_leg', 3, PI / 4 * mort); add('left_front_leg', 4, 2.042035 * mort);
    add('body', 3, -0.15 * mort); add('body', 5, 0.35 * mort);
  }
  if (miroir > 1e-5) {
    const lh = P.get('left_hind_leg').slice(3, 6), lf = P.get('left_front_leg').slice(3, 6);
    for (const [n, l] of [['right_hind_leg', lh], ['right_front_leg', lf]]) {
      const r = P.get(n); r[3] += l[0] * miroir; r[4] += -l[1] * miroir; r[5] += -l[2] * miroir;
    }
  }
}
function poserRenard(P, s, m, bebe, partial, anims) { // FoxModel.setupAnim
  const k = bebe ? 0.5 : 1, add = (n, i, v) => { P.get(n)[i] += v; };
  const roll = lerpV(m, 0, partial) * 0.11 * PI, acc = lerpV(m, 1, partial), jambe = (m.age + partial) * 0.67 * 3;
  P.zrot('head', roll);
  if (bebe) marcher(P, anims, 'fox_baby', 'walk', s, 1, 2.5);
  else {
    const { pos, speed: sp } = s;
    P.xrot('right_hind_leg', cos(pos * 0.6662) * 1.4 * sp); P.xrot('left_hind_leg', cos(pos * 0.6662 + PI) * 1.4 * sp);
    P.xrot('right_front_leg', cos(pos * 0.6662 + PI) * 1.4 * sp); P.xrot('left_front_leg', cos(pos * 0.6662) * 1.4 * sp);
  }
  if (m.accroupi) {
    add('body', 3, 0.10471976); add('head', 1, acc * k);
    const w = cos(s.age) * 0.05;
    P.yrot('body', w); P.zrot('right_hind_leg', w); P.zrot('left_hind_leg', w); P.zrot('right_front_leg', w / 2); P.zrot('left_front_leg', w / 2);
    add('body', 1, bebe ? acc / 6 : acc);
  } else if (m.dort) {
    for (const n of ['right_hind_leg', 'left_hind_leg', 'right_front_leg', 'left_front_leg']) P.visible(n, false);
    if (bebe) {
      P.zrot('body', -PI / 2); P.xrot('body', -PI / 18); add('body', 1, 1.5); add('body', 2, -1.5); add('body', 0, -1.5);
      P.xrot('tail', -PI * 5 / 6); P.xrot('tail', -2.1816616); add('tail', 0, -0.7); add('tail', 2, 0.6); add('tail', 1, 0.9);
      add('head', 0, -2); add('head', 1, 2.8); add('head', 2, -4); P.yrot('head', -PI * 2 / 3); P.zrot('head', 0);
    } else {
      P.zrot('body', -PI / 2); add('body', 1, 5); P.xrot('tail', -PI * 5 / 6);
      add('head', 0, 2); add('head', 1, 2.99); P.yrot('head', -PI * 2 / 3); P.zrot('head', 0);
    }
  } else if (m.assis) {
    P.xrot('head', 0); P.yrot('head', 0);
    if (bebe) {
      P.xrot('body', -0.959931); add('body', 2, -(4.5 * k)); add('body', 1, 3 * k); add('tail', 1, -0.6); add('tail', 2, -(2 * k));
      P.xrot('tail', 0.95993114); add('head', 1, -0.75); add('head', 2, 0);
      P.xrot('right_front_leg', -PI / 12); P.xrot('left_front_leg', -PI / 12);
      add('right_front_leg', 2, -1.5); add('left_front_leg', 2, -1.5); add('right_front_leg', 0, 0.01); add('left_front_leg', 0, -0.01);
      add('right_hind_leg', 2, -3.75); add('left_hind_leg', 2, -3.75); add('right_hind_leg', 0, 0.01); add('left_hind_leg', 0, -0.01);
    } else {
      P.xrot('body', PI / 6); add('body', 1, -7); add('body', 2, 3); P.xrot('tail', PI / 4); add('head', 1, -6.5); add('head', 2, 2.75);
      P.xrot('right_front_leg', -PI / 12); P.xrot('left_front_leg', -PI / 12);
      P.xrot('right_hind_leg', -PI * 5 / 12); add('right_hind_leg', 1, 4); add('right_hind_leg', 2, -0.25);
      P.xrot('left_hind_leg', -PI * 5 / 12); add('left_hind_leg', 1, 4); add('left_hind_leg', 2, -0.25); add('tail', 2, -1);
    }
  }
  if (m.bondit && !bebe) { add('body', 1, -acc / 2); add('head', 1, -acc / 2); }
  if (!m.dort && !m.nezSol && !m.accroupi) { P.xrot('head', s.xRot * (PI / 180)); P.yrot('head', s.yRot * (PI / 180)); }
  if (m.dort) { P.xrot('head', 0); P.yrot('head', -PI * 2 / 3); P.zrot('head', cos(s.age * 0.027) / 22); }
  if (m.nezSol) {
    P.xrot('right_hind_leg', cos(jambe * 0.4662) * 0.1); P.xrot('left_hind_leg', cos(jambe * 0.4662 + PI) * 0.1);
    P.xrot('right_front_leg', cos(jambe * 0.4662 + PI) * 0.1); P.xrot('left_front_leg', cos(jambe * 0.4662) * 0.1);
  }
}
function poserWarden(P, s, m, anims) {
  tete(P, s);
  const vm = Math.min(3 * s.speed, 0.5), aj = s.pos * 0.8662, c = cos(aj), si = sin(aj), vmin = Math.min(vm, 0.35);
  P.zrot('head', P.get('head')[5] + 0.3 * si * vm);
  P.xrot('head', P.get('head')[3] + 1.2 * cos(aj + PI / 2) * vmin);
  P.zrot('body', 0.1 * si * vm); P.xrot('body', c * vmin);
  P.xrot('left_leg', c * vm); P.xrot('right_leg', cos(aj + PI) * vm);
  P.xrot('left_arm', -(0.8 * c * vm)); P.zrot('left_arm', 0); P.xrot('right_arm', -(0.8 * si * vm)); P.zrot('right_arm', 0);
  for (const [n, x] of [['left_arm', 13], ['right_arm', -13]]) { const a = P.get(n); a[4] = 0; a[2] = 1; a[0] = x; a[1] = -13; }
  const sc = s.age * 0.1, wc = cos(sc), ws = sin(sc);
  P.zrot('head', P.get('head')[5] + 0.06 * wc); P.xrot('head', P.get('head')[3] + 0.06 * ws);
  P.zrot('body', P.get('body')[5] + 0.025 * ws); P.xrot('body', P.get('body')[3] + 0.025 * wc);
  const vr = lerpV(m, 0, s.partial ?? 0) / 10 * (cos(s.age * 2.25) * PI * 0.1);
  P.xrot('left_tendril', vr); P.xrot('right_tendril', -vr);
  const st = m.anim.states;
  for (const i of [4, 5, 3, 2, 0, 1]) jouer(P, anims, 'warden', ETATS.Warden[i], st[i], s.age);
}
function poserAllay(P, s, m, partial) { // AllayModel.setupAnim
  const { speed: sp, pos, age } = s;
  const fv = rad(age * 20) + pos, flap = cos(fv) * PI * 0.15 + sp, bobRepos = rad(age * 9);
  const vol = Math.min(sp / 0.3, 1), repos = 1 - vol, tient = lerpV(m, 0, partial) / 5;
  if (m.danse) {
    const d = rad(age * 8) + sp, fr = cos(d) * rad(16), tour = lerpV(m, 1, partial) / 15;
    if ((m._danse % 55) < 15) P.yrot('root', PI * 4 * tour);
    P.zrot('root', fr * (1 - tour));
    P.yrot('head', cos(d) * rad(30) * (1 - tour)); P.zrot('head', cos(d) * rad(14) * (1 - tour));
  } else tete(P, s);
  P.xrot('right_wing', 0.43633232 * (1 - vol)); P.yrot('right_wing', -PI / 4 + flap);
  P.xrot('left_wing', 0.43633232 * (1 - vol)); P.yrot('left_wing', PI / 4 - flap);
  P.xrot('body', vol * PI / 4);
  const ax = tient * (-PI / 3 + (-1.134464 + PI / 3) * vol);
  P.get('root')[1] += cos(bobRepos) * 0.25 * repos;
  P.xrot('right_arm', ax); P.xrot('left_arm', ax);
  const q = 0.43633232 - cos(bobRepos + PI * 1.5) * PI * 0.075 * (repos * (1 - tient));
  P.zrot('left_arm', -q); P.zrot('right_arm', q);
  P.yrot('right_arm', 0.27925268 * tient); P.yrot('left_arm', -0.27925268 * tient);
}
function poserLoup(P, s, m, bebe, partial) { // WolfModel.setupAnim
  const { pos, speed: sp } = s;
  P.yrot('tail', m.agressif ? 0 : cos(pos * 0.6662) * 1.4 * sp);
  const add = (n, x, y, z) => { const v = P.get(n); v[0] += x; v[1] += y; v[2] += z; };
  if (m.assis) {
    const k = bebe ? 0.5 : 1;
    add('body', 0, 4 * k, -2 * k); P.xrot('body', PI / 4);
    add('tail', 0, 9 * k, -2 * k);
    add('right_hind_leg', 0, 6.7 * k, -5 * k); P.xrot('right_hind_leg', PI * 3 / 2);
    add('left_hind_leg', 0, 6.7 * k, -5 * k); P.xrot('left_hind_leg', PI * 3 / 2);
    P.xrot('right_front_leg', 5.811947); add('right_front_leg', 0.01 * k, 1 * k, 0);
    P.xrot('left_front_leg', 5.811947); add('left_front_leg', -0.01 * k, 1 * k, 0);
    if (bebe) P.xrot('body', P.get('body')[3] - PI / 2);
    else if (P.has('upper_body')) { P.get('upper_body')[1] += 2; P.xrot('upper_body', PI * 2 / 5); P.yrot('upper_body', 0); }
  } else {
    P.xrot('right_hind_leg', cos(pos * 0.6662) * 1.4 * sp); P.xrot('left_hind_leg', cos(pos * 0.6662 + PI) * 1.4 * sp);
    P.xrot('right_front_leg', cos(pos * 0.6662 + PI) * 1.4 * sp); P.xrot('left_front_leg', cos(pos * 0.6662) * 1.4 * sp);
  }
  const sec = lerpV(m, 1, partial), roll = lerpV(m, 0, partial) * 0.15 * PI;
  const rc = (o) => { const p = borne((sec + o) / 1.8, 0, 1); return sin(p * PI) * sin(p * PI * 11) * 0.15 * PI; };
  P.zrot('body', rc(-0.16));
  if (bebe) { P.zrot('head', roll + rc(0)); P.zrot('tail', rc(-0.2)); }
  else {
    if (P.has('real_head')) P.zrot('real_head', roll + rc(0));
    if (P.has('upper_body')) P.zrot('upper_body', rc(-0.08));
    if (P.has('real_tail')) P.zrot('real_tail', rc(-0.2));
  }
  P.xrot('head', rad(s.xRot)); P.yrot('head', rad(s.yRot));
  P.xrot('tail', m.agressif ? 1.5393804 : m.apprivoise ? (0.55 - (1 - m.vie) * 0.4) * PI : PI / 5);
}
function poserFelin(P, s, m, bebe, partial) { // AdultFelineModel / BabyFelineModel
  const k = bebe ? 0.5 : 1, acc = m.accroupi, spr = m.sprint, assis = m.assis;
  const add = (n, x, y, z) => { const v = P.get(n); v[0] += x; v[1] += y; v[2] += z; };
  if (acc) {
    add('body', 0, k, 0); add('head', 0, 2 * k, 0); add('tail1', 0, k, 0); add('tail2', 0, -4 * k, 2 * k);
    P.xrot('tail1', PI / 2); P.xrot('tail2', PI / 2);
  } else if (spr) {
    P.get('tail2')[1] = P.get('tail1')[1]; add('tail2', 0, 0, 2 * k); P.xrot('tail1', PI / 2); P.xrot('tail2', PI / 2);
  }
  tete(P, s);
  const { pos, speed: sp } = s;
  if (!assis) {
    if (!bebe) P.xrot('body', PI / 2);
    if (spr) {
      P.xrot('left_hind_leg', cos(pos * 0.6662) * sp); P.xrot('right_hind_leg', cos(pos * 0.6662 + 0.3) * sp);
      P.xrot('left_front_leg', cos(pos * 0.6662 + PI + 0.3) * sp); P.xrot('right_front_leg', cos(pos * 0.6662 + PI) * sp);
      P.xrot('tail2', 1.7278761 + PI / 10 * cos(pos) * sp);
    } else {
      P.xrot('left_hind_leg', cos(pos * 0.6662) * sp); P.xrot('right_hind_leg', cos(pos * 0.6662 + PI) * sp);
      P.xrot('left_front_leg', cos(pos * 0.6662 + PI) * sp); P.xrot('right_front_leg', cos(pos * 0.6662) * sp);
      P.xrot('tail2', 1.7278761 + (acc ? 0.47123894 : PI / 4) * cos(pos) * sp);
    }
  } else if (bebe) {
    P.xrot('body', P.get('body')[3] - 0.43633232); add('body', 0, 1.25, 0); add('head', 0, 0, 0.75);
    P.xrot('tail1', P.get('tail1')[3] + 0.5454154); add('tail1', 0, 4, -0.9);
    add('left_hind_leg', 0, 0, -0.9); add('right_hind_leg', 0, 0, -0.9);
  } else {
    P.xrot('body', PI / 4); add('body', 0, -4 * k, 5 * k); add('head', 0, -3.3 * k, k);
    add('tail1', 0, 8 * k, -2 * k); add('tail2', 0, 2 * k, -0.8 * k); P.xrot('tail1', 1.7278761); P.xrot('tail2', 2.670354);
    P.xrot('left_front_leg', -PI / 20); add('left_front_leg', 0, 2 * k, -2 * k);
    P.xrot('right_front_leg', -PI / 20); add('right_front_leg', 0, 2 * k, -2 * k);
    P.xrot('left_hind_leg', -PI / 2); add('left_hind_leg', 0, 3 * k, -4 * k);
    P.xrot('right_hind_leg', -PI / 2); add('right_hind_leg', 0, 3 * k, -4 * k);
  }
  const lie = lerpV(m, 0, partial), lieQ = lerpV(m, 1, partial), rel = lerpV(m, 2, partial);
  if (lie > 0 && bebe) {
    add('body', 1, 0, 0);
    P.xrot('head', rotLerp(lie, P.get('head')[3], PI / 18)); P.zrot('head', rotLerp(lie, P.get('head')[5], -PI * 5 / 12));
    add('head', 1.5, 0.75, -0.5);
    P.xrot('right_front_leg', -PI / 4); add('right_front_leg', 3.5, -0.5, 0);
    P.xrot('left_front_leg', -PI / 2); add('left_front_leg', 1.5, -1, -2);
    P.xrot('right_hind_leg', PI * 2 / 9); P.yrot('right_hind_leg', PI / 9); P.zrot('right_hind_leg', -PI / 9);
    add('right_hind_leg', 2.5, -0.25, 0.5); add('left_hind_leg', 1.5, 0, -1);
    const t = P.get('tail1'), [tx, ty, tz] = [t[3], t[4], t[5]];
    P.xrot('tail1', tx + rotLerp(lieQ, tx, -PI / 6)); P.yrot('tail1', ty + rotLerp(lieQ, ty, 0)); P.zrot('tail1', tz + rotLerp(lieQ, tz, -PI / 18));
    add('tail1', 1, 0.5, -0.25);
  } else if (lie > 0) {
    const [hz, hy] = [P.get('head')[5], P.get('head')[4]];
    P.zrot('head', rotLerp(lie, hz, -1.2707963)); P.yrot('head', rotLerp(lie, hy, 1.2707963));
    P.xrot('left_front_leg', -1.2707963); P.xrot('right_front_leg', -0.47079635); P.zrot('right_front_leg', -0.2);
    add('right_front_leg', k, 0, 0);
    P.xrot('left_hind_leg', -0.4); P.xrot('right_hind_leg', 0.5); P.zrot('right_hind_leg', -0.5);
    add('right_hind_leg', 0.8 * k, 2 * k, 0);
    const [t1, t2] = [P.get('tail1')[3], P.get('tail2')[3]];
    P.xrot('tail1', rotLerp(lieQ, t1, 0.8)); P.xrot('tail2', rotLerp(lieQ, t2, -0.4));
  }
  if (rel > 0) P.xrot('head', rotLerp(rel, P.get('head')[3], -0.58177644));
}
function poserIllageois(P, s, m, type, partial) { // IllagerModel.setupAnim
  let pose;
  if (type === 'pillager') pose = m.charge ? 'arbCharge' : m.mainD === 'crossbow' ? 'arbTenue' : m.agressif ? 'attaque' : 'neutre';
  else if (type === 'illusioner') pose = m.sort ? 'sort' : m.agressif ? 'arc' : 'croise';
  else if (type === 'evoker') pose = m.sort ? 'sort' : m.fete ? 'fete' : 'croise';
  else pose = m.agressif ? 'attaque' : m.fete ? 'fete' : 'croise';
  if (type !== 'illusioner') P.visible('hat', false);
  const hy = rad(s.yRot), hx = rad(s.xRot), { pos, speed: sp, age } = s;
  P.yrot('head', hy); P.xrot('head', hx);
  if (m.passager) {
    for (const b of ['right_arm', 'left_arm']) { P.xrot(b, -PI / 5); P.yrot(b, 0); P.zrot(b, 0); }
    P.xrot('right_leg', -1.4137167); P.yrot('right_leg', PI / 10); P.zrot('right_leg', 0.07853982);
    P.xrot('left_leg', -1.4137167); P.yrot('left_leg', -PI / 10); P.zrot('left_leg', -0.07853982);
  } else {
    P.xrot('right_arm', cos(pos * 0.6662 + PI) * 2 * sp * 0.5); P.yrot('right_arm', 0); P.zrot('right_arm', 0);
    P.xrot('left_arm', cos(pos * 0.6662) * 2 * sp * 0.5); P.yrot('left_arm', 0); P.zrot('left_arm', 0);
    P.xrot('right_leg', cos(pos * 0.6662) * 1.4 * sp * 0.5); P.yrot('right_leg', 0); P.zrot('right_leg', 0);
    P.xrot('left_leg', cos(pos * 0.6662 + PI) * 1.4 * sp * 0.5); P.yrot('left_leg', 0); P.zrot('left_leg', 0);
  }
  switch (pose) {
    case 'attaque': {
      const sw = s.swing;
      if (m.mainD == null) {
        const a = sin(sw * PI), b = sin((1 - (1 - sw) * (1 - sw)) * PI);
        P.zrot('right_arm', 0); P.zrot('left_arm', 0);
        P.yrot('right_arm', -(0.1 - a * 0.6)); P.yrot('left_arm', 0.1 - a * 0.6);
        P.xrot('right_arm', -PI / 1.5 + a * 1.2 - b * 0.4); P.xrot('left_arm', -PI / 1.5 + a * 1.2 - b * 0.4);
      } else {
        const [pr, se] = m.gaucher ? ['left_arm', 'right_arm'] : ['right_arm', 'left_arm'];
        const a2 = sin(sw * PI), a = sin((1 - (1 - sw) * (1 - sw)) * PI);
        P.zrot('right_arm', 0); P.zrot('left_arm', 0); P.yrot('right_arm', PI / 20); P.yrot('left_arm', -PI / 20);
        P.xrot(pr, -1.8849558 + cos(age * 0.09) * 0.15 + (a2 * 2.2 - a * 0.4));
        P.xrot(se, -0 + cos(age * 0.19) * 0.5 + (a2 * 1.2 - a * 0.4));
      }
      bob(P, 'right_arm', age, 1); bob(P, 'left_arm', age, -1);
      break;
    }
    case 'arc':
      P.yrot('right_arm', -0.1 + hy); P.xrot('right_arm', -PI / 2 + hx);
      P.xrot('left_arm', -0.9424779 + hx); P.yrot('left_arm', hy - 0.4); P.zrot('left_arm', PI / 2);
      break;
    case 'arbTenue':
      P.yrot('right_arm', -0.3 + hy); P.yrot('left_arm', 0.6 + hy); P.xrot('right_arm', -PI / 2 + hx + 0.1); P.xrot('left_arm', -1.5 + hx);
      break;
    case 'arbCharge': {
      P.yrot('right_arm', -0.8); P.xrot('right_arm', -0.97079635);
      const c = m.dureeCharge, a = borne(m.utilise + partial, 0, c) / c;
      P.yrot('left_arm', 0.4 + (0.85 - 0.4) * a); P.xrot('left_arm', -0.97079635 + (-PI / 2 + 0.97079635) * a);
      break;
    }
    case 'sort': case 'fete':
      for (const [b, x, z] of [['right_arm', -5, pose === 'sort' ? PI * 0.75 : 2.670354], ['left_arm', 5, -PI * 0.75]]) {
        const v = P.get(b); v[2] = 0; v[0] = x; v[3] = cos(age * 0.6662) * (pose === 'sort' ? 0.25 : 0.05); v[4] = 0; v[5] = z;
      }
      break;
  }
  if (pose === 'croise') { P.visible('left_arm', false); P.visible('right_arm', false); } else P.visible('arms', false);
}
function poserPiglin(P, s, m, partial) { // Piglin.getArmPose + PiglinModel
  const pose = m.danse ? 'danse' : m.admire ? 'admire' : m.charge ? 'arbCharge' : m.mainD === 'crossbow' && m.agressif ? 'arbTenue'
    : m.agressif && m.mainD != null ? 'melee' : 'defaut';
  const g = m.gaucher, h = hum();
  h.coupArme = pose === 'melee'; h.gaucher = g; h.passager = m.passager; h.charge = [25, m.utilise];
  humanoide(P, s, h);
  oreillesPiglin(P, s);
  const hy = rad(s.yRot), hx = rad(s.xRot);
  switch (pose) {
    case 'danse': {
      const d = s.age / 60;
      P.zrot('right_ear', PI / 6 + rad(1) * sin(d * 30) * 10); P.zrot('left_ear', -PI / 6 - rad(1) * cos(d * 30) * 10);
      P.get('head')[0] += sin(d * 10); P.get('head')[1] += sin(d * 40) + 0.4;
      const z = rad(70 + cos(d * 40) * 10);
      P.zrot('right_arm', z); P.zrot('left_arm', -z);
      P.get('right_arm')[1] += sin(d * 40) * 0.5 - 0.5; P.get('left_arm')[1] += sin(d * 40) * 0.5 + 0.5;
      P.get('body')[1] += sin(d * 40) * 0.35;
      break;
    }
    case 'melee': if (s.swing === 0) P.xrot(g ? 'left_arm' : 'right_arm', -1.8); break;
    case 'arbTenue': arbaleteTenue(P, hx, hy, !g); break;
    case 'arbCharge': arbaleteCharge(P, 25, m.utilise, !g); break;
    case 'admire':
      P.xrot('head', 0.5); P.yrot('head', 0);
      if (g) { P.yrot('right_arm', -0.5); P.xrot('right_arm', -0.9); } else { P.yrot('left_arm', 0.5); P.xrot('left_arm', -0.9); }
      break;
  }
}
function poserRavageur(P, s, m, partial) { // RavagerModel.setupAnim
  const et = m.etourdi > 0 ? m.etourdi - partial : 0, att = m.attaque > 0 ? m.attaque - partial : 0;
  if (att > 0) {
    const w = (Math.abs(att % 10 - 5) - 2.5) / 2.5, sc = (1 + w) * 0.5, t = sc * sc * sc * 12;
    const nx = P.get('neck')[3], n = P.get('neck');
    n[2] = -6.5 + t; n[1] = -7 - t * sin(nx);
    P.xrot('mouth', att > 5 ? sin((-4 + att) / 4) * PI * 0.4 : PI / 20 * sin(PI * att / 10));
  } else {
    const etourdi = et > 0, n = P.get('neck'), yo = -sin(n[3]);
    n[0] = 0; n[1] = -7 - yo; n[2] = 5.5; n[3] = etourdi ? 0.21991149 : 0;
    P.xrot('mouth', PI * (etourdi ? 0.05 : 0.01));
    if (etourdi) P.get('neck')[0] = sin(et / 40 * 10) * 3;
    else if (m.rugit > 0) P.xrot('mouth', PI / 2 * sin((20 - m.rugit + partial) / 20 * PI * 0.25));
  }
  P.xrot('head', rad(s.xRot)); P.yrot('head', rad(s.yRot));
  const { pos } = s, l = 0.4 * s.speed;
  P.xrot('right_hind_leg', cos(pos * 0.6662) * l); P.xrot('left_hind_leg', cos(pos * 0.6662 + PI) * l);
  P.xrot('right_front_leg', cos(pos * 0.6662 + PI) * l); P.xrot('left_front_leg', cos(pos * 0.6662) * l);
}
function poserEquide(P, s, m, type, bebe, partial) { // AbstractEquineModel.setupAnim
  const ane = /^(donkey|mule)/.test(type);
  const [aDebout, yDebout, zDebout, xDebout, queue] = !bebe ? [PI / 12, 12, 4, -PI / 3, 0]
    : !ane ? [PI / 12, 4, 0, -PI / 3, -PI / 2] : [PI / 3, 1, 0.5, 0, -PI / 4];
  const borneY = borne(s.yRot, -20, 20);
  let hx = rad(s.xRot);
  const { speed: sp, pos } = s;
  if (sp > 0.2) hx += cos(pos * 0.8) * 0.15 * sp;
  const mg = lerpV(m, 0, partial), db = lerpV(m, 1, partial), idb = 1 - db, bouche = lerpV(m, 2, partial);
  const eau = m.dansEau ? 0.2 : 1, j1 = cos(eau * pos * 0.6662 + PI), jx = j1 * 0.8 * sp;
  const base = (1 - Math.max(db, mg)) * (PI / 6 + hx + bouche * sin(s.age) * 0.05);
  P.xrot('head_parts', db * (PI / 12 + hx) + mg * (2.1816616 + sin(s.age) * 0.05) + base);
  P.yrot('head_parts', db * rad(borneY) + (1 - Math.max(db, mg)) * rad(borneY));
  const hp = P.get('head_parts');
  if (bebe && ane) { hp[1] = lerp(mg, hp[1], -1.2); hp[2] = lerp(db, hp[2], -3.6); }
  else if (bebe) { hp[1] += lerp(mg, lerp(db, 0, -2), 2); hp[2] = lerp(db, hp[2], -4); }
  else { hp[1] += lerp(mg, lerp(db, 0, -8), 7); hp[2] = lerp(db, hp[2], -4); }
  P.xrot('body', db * (-PI / 4) + idb * P.get('body')[3]);
  const lf = P.get('left_front_leg'); lf[1] -= yDebout * db; lf[2] += zDebout * db;
  const rf = P.get('right_front_leg'); rf[1] = lf[1]; rf[2] = lf[2];
  const dt = aDebout * db, b = cos(s.age * 0.6 + PI);
  P.xrot('left_hind_leg', dt - j1 * 0.5 * sp * idb); P.xrot('right_hind_leg', dt + j1 * 0.5 * sp * idb);
  P.xrot('left_front_leg', (xDebout + b) * db + jx * idb); P.xrot('right_front_leg', (xDebout - b) * db - jx * idb);
  if (bebe && ane) {
    const y = lerp(db, P.get('left_hind_leg')[1], -0.3);
    P.get('left_hind_leg')[1] = y; P.get('right_hind_leg')[1] = lerp(db, y, -0.3);
  }
  const k = bebe ? 0.5 : 1;
  P.xrot('tail', queue + PI / 6 + sp * 0.75);
  const t = P.get('tail'); t[1] += sp * k; t[2] += sp * 2 * k;
  P.yrot('tail', m.anim.v[3] > 0 ? cos(s.age * 0.7) : 0);
  if (bebe && ane) {
    const h2 = -30 * (PI / 180), b2 = (1 - Math.max(db, mg)) * (PI / 6 + h2 + bouche * sin(s.age) * 0.05);
    P.xrot('head_parts', db * (PI / 12 + h2) + mg * (PI / 2 + sin(s.age) * 0.05) + b2);
  }
}

// Echelle de rendu (renderer.scale) : creeper (gonflement), slime / magma (ecrasement) ; [1, 1, 1] sinon.
export function echelleRendu(type, m, partial = 0) {
  const fam = famille(type);
  if (fam === 'Creeper') {
    const g = m.gonfle, w = 1 + sin(g * 100) * g * 0.01, q = borne(g, 0, 1), q4 = q * q * q * q;
    const xz = (1 + q4 * 0.4) * w;
    return [xz, (1 + q4 * 0.1) / w, xz];
  }
  if (fam === 'Slime' || fam === 'MagmaCube') {
    const t = Math.max(m.taille | 0, 1), sq = lerpV(m, 0, partial) / (t * 0.5 + 1), w = 1 / (sq + 1);
    const k = fam === 'Slime' ? 0.999 : 1;
    return [w * t * k, 1 / w * t * k, w * t * k];
  }
  return [1, 1, 1];
}

// ---- tick : horloges par tick de jeu ----------------------------------------------------------------------------------
const demarrerSiArrete = (st, i, age) => { if (st[i] == null) st[i] = age; };
const selon = (st, i, c, age) => { if (c) demarrerSiArrete(st, i, age); else st[i] = null; };

export function tick(type, m) {
  const fam = famille(type), a = m.anim, v = a.v, st = a.states;
  m.age++;
  const age = m.age;
  a.vo = v.slice(); // begin_tick
  // decomptes generiques (golem de fer, ravageur, hoglin, villageois, mouton...)
  if (m.rugit > 0) m.rugit--;
  if (m.attaque > 0) m.attaque--;
  if (m.etourdi > 0) { m.etourdi--; if (m.etourdi === 0 && fam === 'Ravager') m.rugit = 20; }
  if (m.mecontent > 0) m.mecontent--;
  if (m.fleur > 0) m.fleur--;
  if (m.broute > 0) m.broute--;
  if (m.invulnerable > 0) m.invulnerable--;
  const sol = m.auSol, etaitSol = m._sol;
  switch (fam) {
    case 'Chicken': case 'Parrot': { // Chicken.aiStep / Parrot.calculateFlapping
      const pose = fam === 'Parrot' ? sol || m.passager : sol;
      a.flapO = a.flap; a.flapSpeedO = a.flapSpeed;
      a.flapSpeed = borne(a.flapSpeed + (pose ? -1 : 4) * 0.3, 0, 1);
      if (!sol && a.flapping < 1) a.flapping = 1;
      a.flapping *= 0.9;
      a.flap += a.flapping * 2;
      break;
    }
    case 'Slime': case 'MagmaCube': // AbstractCubeMob.tick
      v[0] += (v[1] - v[0]) * 0.5;
      if (sol && !etaitSol) v[1] = -0.5; else if (!sol && etaitSol) v[1] = 1;
      v[1] *= fam === 'MagmaCube' ? 0.9 : 0.6;
      break;
    case 'Squid': { // Squid.aiStep (tentacules, rotations du corps)
      v[0] += v[4];
      if (v[0] > PI * 2) { v[0] -= PI * 2; if (Math.floor(alea(m) * 10) === 0) v[4] = 1 / (alea(m) + 1) * 0.2; }
      if (m.dansEau) {
        if (v[0] < PI) { const k = v[0] / PI; v[1] = sin(k * k * PI) * PI * 0.25; if (k > 0.75) v[5] = 1; else v[5] *= 0.8; }
        else { v[1] = 0; v[5] *= 0.99; }
        v[3] += PI * v[5] * 1.5;
        v[2] += (-Math.atan2(m.vh, m.vy) * 57.295776 - v[2]) * 0.1;
      } else {
        v[1] = Math.abs(sin(v[0])) * PI * 0.25;
        v[2] += (-90 - v[2]) * 0.02;
      }
      break;
    }
    case 'Wolf': { // interest_tick, shake_tick
      v[0] += ((m.mendie ? 1 : 0) - v[0]) * 0.4;
      if (m.secoue) { m.secoue = false; m._secoue = 1; v[1] = 0; a.vo[1] = 0; }
      if (m.dansEau) { if (m._secoue) { m._secoue = 0; v[1] = 0; a.vo[1] = 0; } }
      else if (m._secoue) {
        a.vo[1] = v[1]; v[1] += 0.05;
        if (a.vo[1] >= 2) { m._secoue = 0; v[1] = 0; a.vo[1] = 0; }
      }
      break;
    }
    case 'Feline': // Cat.tick (cat_amounts)
      if (m.couche) { v[0] = Math.min(v[0] + 0.15, 1); v[1] = Math.min(v[1] + 0.08, 1); }
      else { v[0] = Math.max(v[0] - 0.22, 0); v[1] = Math.max(v[1] - 0.13, 0); }
      v[2] = m.detente ? Math.min(v[2] + 0.1, 1) : Math.max(v[2] - 0.13, 0);
      break;
    case 'Horse': { // tail_tick, animate
      if (Math.floor(alea(m) * 200) === 0) v[3] = 1;
      if (v[3] > 0) { v[3] += 1; if (v[3] > 8) v[3] = 0; }
      if (m.cabre) { v[0] = 0; a.vo[0] = 0; v[1] = Math.min(v[1] + (1 - v[1]) * 0.4 + 0.05, 1); }
      else {
        v[0] = m.mange ? Math.min(v[0] + (1 - v[0]) * 0.4 + 0.05, 1) : Math.max(v[0] - v[0] * 0.4 - 0.05, 0);
        const q = v[1]; v[1] = Math.max(q + (0.8 * q * q * q - q) * 0.6 - 0.05, 0);
      }
      v[2] = Math.max(v[2] - v[2] * 0.7 - 0.05, 0);
      break;
    }
    case 'PolarBear': v[0] = borne(v[0] + (m.debout ? 1 : -1), 0, 6); break;
    case 'Panda': {
      const pas = (i, on) => { v[i] = on ? Math.min(v[i] + 0.15, 1) : Math.max(v[i] - 0.19, 0); };
      pas(0, m.assis); pas(1, m.dos); pas(2, m.roule);
      if (m.eternue > 0) { m.eternue++; if (m.eternue > 29) m.eternue = 0; }
      break;
    }
    case 'Fox':
      v[0] += ((m.interesse ? 1 : 0) - v[0]) * 0.4;
      v[1] = m.accroupi ? Math.min(v[1] + 0.2, 5) : 0;
      break;
    case 'Bee': v[0] = m.roule ? Math.min(v[0] + 0.2, 1) : Math.max(v[0] - 0.24, 0); break;
    case 'Allay':
      v[0] = borne(v[0] + (m.mainD != null ? 1 : -1), 0, 5);
      if (m.danse) { m._danse++; v[1] = borne(v[1] + ((m._danse % 55) < 15 ? 1 : -1), 0, 15); }
      else { m._danse = 0; v[1] = 0; a.vo[1] = 0; }
      break;
    case 'Guardian': { // tail_and_spikes
      if (!m.dansEau) v[1] = 2;
      else if (m.bouge) v[1] = v[1] < 0.5 ? 4 : v[1] + (0.5 - v[1]) * 0.1;
      else v[1] += (0.125 - v[1]) * 0.2;
      v[0] += v[1];
      if (!m.dansEau) v[2] = alea(m); else if (m.bouge) v[2] += (0 - v[2]) * 0.25; else v[2] += (1 - v[2]) * 0.06;
      break;
    }
    case 'Shulker': { // ease_peek
      const cible = m.ouverture * 0.01, q = v[0];
      v[0] = q > cible ? Math.min(Math.max(q - 0.05, cible), 1) : Math.min(Math.max(q + 0.05, 0), cible);
      break;
    }
    case 'Warden': {
      const delai = 40 - Math.floor(borne(m.colere / 80, 0, 1) * 30);
      if (age % delai === 0) v[1] = 10;
      if (m.vibration) { m.vibration = false; v[0] = 10; }
      for (const i of [0, 1]) if (v[i] > 0) v[i] -= 1;
      const p = m.posture ?? 'standing';
      if (p !== m._posture) {
        const i = { roaring: 0, sniffing: 1, emerging: 2, digging: 3 }[p];
        if (i != null) st[i] = age;
        m._posture = p;
      }
      if (p !== 'roaring') st[0] = null;
      if (p !== 'sniffing') st[1] = null;
      if (p !== 'emerging') st[2] = null;
      if (p !== 'digging') st[3] = null;
      if (st[4] != null && millis(st[4], age) > 1000) st[4] = null;
      if (st[5] != null && millis(st[5], age) > 3500) st[5] = null;
      break;
    }
    case 'Bat': if (m.perche) { st[0] = null; demarrerSiArrete(st, 1, age); } else { st[1] = null; demarrerSiArrete(st, 0, age); } break;
    case 'Breeze': { // Breeze.ai_step
      const p = m.posture ?? 'idle';
      if (p !== m._posture) {
        st[1] = st[0] = st[4] = st[5] = null;
        if (p === 'shooting') demarrerSiArrete(st, 1, age); else if (p === 'inhaling') demarrerSiArrete(st, 4, age);
        else if (p === 'sliding') demarrerSiArrete(st, 2, age);
        m._posture = p;
      }
      if (p === 'long_jumping') demarrerSiArrete(st, 5, age);
      demarrerSiArrete(st, 0, age);
      if (p !== 'sliding' && st[2] != null) { st[3] = age; st[2] = null; }
      break;
    }
    case 'Camel': { // Camel.tick (cooldown) + setupAnimationStates
      if (m._recharge > 0) m._recharge--;
      if (m.fonce && !m._fonce && m._recharge === 0) m._recharge = 55;
      m._fonce = m.fonce;
      if (m.assis !== m._assis) { m._assis = m.assis; m._poseTick = age; }
      const pt = age - m._poseTick;
      if (m._compteur <= 0) { m._compteur = Math.floor(alea(m) * 40) + 80; st[3] = age; } else m._compteur--;
      const assis = m.assis, assied = assis && pt >= 0 && pt < 40, trans = pt >= 0 && pt < (assis ? 40 : 52);
      if ((pt < 0) !== assis) {
        st[2] = st[4] = null;
        if (assied) { demarrerSiArrete(st, 0, age); st[1] = null; } else { st[0] = null; demarrerSiArrete(st, 1, age); }
      } else { st[0] = st[1] = null; selon(st, 4, m.fonce, age); selon(st, 2, trans, age); }
      break;
    }
    case 'Frog': {
      const p = m.posture;
      if (p !== m._posture) {
        [['long_jumping', 0], ['croaking', 1], ['using_tongue', 2]].forEach(([n, i]) => { st[i] = p === n ? age : null; });
        m._posture = p;
      }
      selon(st, 3, m.dansEau && m.vh <= 1e-5, age);
      break;
    }
    case 'Rabbit': // Rabbit.baseTick (le saut : tant qu'il n'est pas au sol)
      if (m._compteur <= 0) { m._compteur = Math.floor(alea(m) * 40) + 180; st[1] = age; }
      else if (!sol) { demarrerSiArrete(st, 0, age); st[1] = null; }
      else { m._compteur--; st[0] = null; }
      break;
    case 'Sniffer': {
      const p = m.posture ?? 'idling';
      if (p !== m._posture) {
        for (let i = 0; i < 5; i++) st[i] = null;
        const i = { feeling_happy: 0, scenting: 1, sniffing: 2, digging: 3, rising: 4 }[p];
        if (i != null) st[i] = age;
        m._posture = p;
      }
      break;
    }
    case 'Armadillo': {
      if (m.etatTatou !== m._tatou) { m._tatou = m.etatTatou; m._tatouTicks = 0; }
      const e = m.etatTatou, t = m._tatouTicks;
      if (e === 1) { st[0] = null; demarrerSiArrete(st, 1, age); st[2] = null; }
      else if (e === 2) { st[0] = st[1] = null; if (t === 0) st[2] = age - 50; else demarrerSiArrete(st, 2, age); }
      else if (e === 3) { demarrerSiArrete(st, 0, age); st[1] = st[2] = null; }
      else st[0] = st[1] = st[2] = null;
      m._tatouTicks++;
      break;
    }
    case 'Axolotl': { // BinaryAnimator(10) et etats du bebe
      const x = a.axo, eau = m.dansEau, bouge = m.bouge || m.vh > 1e-5, mort = m.mortFeinte;
      x.old = x.val.slice();
      [mort, !mort && eau, !mort && !eau && sol, bouge].forEach((on, i) => { x.val[i] = on ? Math.min(x.val[i] + 1, 10) : Math.max(x.val[i] - 1, 0); });
      if (estBebe(type) || m.bebe) {
        const choix = mort ? 6 : bouge ? (eau && !sol ? 1 : !eau && sol ? 0 : 2) : eau && !sol ? 4 : eau && sol ? 5 : 3;
        for (let i = 0; i < 7; i++) if (i === choix) demarrerSiArrete(st, i, age); else st[i] = null;
      }
      break;
    }
    case 'Creaking':
      selon(st, 0, m.attaque > 0, age); selon(st, 1, m.invulnerable > 0, age); selon(st, 2, m.demolit, age);
      break;
    case 'CopperGolem': { // CopperGolem.setupAnimationStates
      const e = m.etatCuivre | 0;
      if (e === 0) {
        for (let i = 1; i < 5; i++) st[i] = null;
        if (m._cuivre === age) st[0] = age;
        else if (m._cuivre === 0) m._cuivre = age + 200 + Math.floor(alea(m) * 40);
        if (age === m._cuivre + 10) m._cuivre = 0;
      } else if (e >= 1 && e <= 4) {
        st[0] = null; m._cuivre = 0;
        for (let i = 1; i < 5; i++) if (i !== e) st[i] = null;
        demarrerSiArrete(st, e, age);
      }
      break;
    }
  }
  m._sol = sol;
}
