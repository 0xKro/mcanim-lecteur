// Champs d'acteur des creatures (lecture et controle) : type, variante, bebe, taille, charge, selle, armureCheval, colle, coffre, tondu,
// gonfle, agressif, anim, regarde, parties, monture, etiquette, cris. Un acteur sans `type` (ou "joueur") n'est pas touche.
import { ESPECES, VEHICULES, TEINTURES, MONTURES, lireVariante, IMITES } from './especes.js';
import { voulaisTu } from '../moteur/util.js';
import { SOUND_EVENTS } from '../kit.js';

// sons d'ambiance du monde (animateTick des blocs) : eau qui coule, lave, feu ; la pluie (weather.rain) est dans le kit de base
export const AMBIANCE = ['block.water.ambient', 'block.lava.pop', 'block.lava.ambient', 'block.fire.ambient'];

export const TYPES = Object.keys(ESPECES).filter((t) => t !== 'mannequin');
const ARMURES_CHEVAL = ['leather', 'iron', 'golden', 'diamond', 'netherite', 'copper'];
// noms speciaux de `anim` (en plus des animations a images cles du type) : coup de bras / attaque, tete qui dit non, degats
export const COMPORTEMENTS_IA = ['passif', 'agressif', 'fuit', 'garde'];
export const ANIMS_SPECIALES = ['attaque', 'non', 'blesse', 'broute', 'stop'];
const estNombre = (x) => typeof x === 'number' && Number.isFinite(x);
const estObjet = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// piste [[t, valeur], ...] triee ; valeur controlee par `ok`
function pisteValeurs(v, ch, err, ok, attendu, duree) {
  if (!Array.isArray(v) || !v.length || v.some((k) => !Array.isArray(k) || k.length !== 2 || !estNombre(k[0]))) err(ch, `liste [[t, ${attendu}], ...] attendue`);
  let p = -1;
  return v.map((k, i) => {
    if (k[0] < p || k[0] < 0 || k[0] > duree) err(`${ch}[${i}][0]`, `temps entre 0 et ${duree}, croissant, attendu`);
    p = k[0];
    if (!ok(k[1])) err(`${ch}[${i}][1]`, `${attendu} attendu, pas ${JSON.stringify(k[1])}`);
    return { t: k[0], v: k[1] };
  });
}

// a : acteur brut ; o : acteur lu (complete ici) ; noms : noms des acteurs de la scene
export function lireCreature(a, o, ch, err, { duree, noms, typesActeurs }) {
  const type = a.type === undefined || a.type === 'joueur' ? null : a.type;
  if (a.type !== undefined && typeof a.type !== 'string') err(`${ch}.type`, 'nom de type attendu ("zombie", "cow"... ; "joueur" par defaut)');
  if (type !== null && !TYPES.includes(type)) err(`${ch}.type`, `type inconnu "${type}"${voulaisTu(type, TYPES)} (mcanim creatures --liste)`);
  // monture : valable pour tout acteur (joueur ou creature)
  if (a.monture !== undefined) {
    const brut = typeof a.monture === 'string' || a.monture === null ? [[0, a.monture]] : a.monture;
    o.monture = pisteValeurs(brut, `${ch}.monture`, err, (v) => v === null || (typeof v === 'string' && noms.has(v)), 'nom d\'un autre acteur ou null', duree);
    for (const k of o.monture) {
      if (k.v === a.nom) err(`${ch}.monture`, 'un acteur ne se monte pas lui-meme');
      const tv = k.v && typesActeurs.get(k.v);
      if (k.v && !MONTURES.includes(tv)) err(`${ch}.monture`, `"${k.v}" (${tv ?? 'joueur'}) ne se monte pas (montures : ${MONTURES.filter((m) => !m.includes('minecart') || m === 'minecart').join(', ')}, wagonnets)`);
    }
  }
  if (a.etiquette !== undefined) { if (typeof a.etiquette !== 'string' || a.etiquette.length > 40) err(`${ch}.etiquette`, 'texte de 40 caracteres au plus attendu (nom affiche au-dessus de la tete)'); o.etiquette = a.etiquette; }
  if (type === null) {
    for (const k of ['variante', 'bebe', 'taille', 'charge', 'selle', 'armureCheval', 'colle', 'coffre', 'tondu', 'gonfle', 'anim', 'parties', 'agressif', 'porte', 'contenu', 'echange', 'sautille', 'ia', 'comportement', 'garde', 'maison', 'travail', 'lit', 'rassemblement', 'epaule', 'ami', 'laisse', 'apprivoise', 'ruche', 'nourriture', 'age', 'centre', 'perchoir', 'emerge', 'genes', 'confiance', 'aOeuf', 'enceinte']) if (a[k] !== undefined) err(`${ch}.${k}`, 'champ des creatures : il faut aussi "type" (par exemple "type": "zombie")');
    return;
  }
  const c = { type };
  if (a.variante !== undefined) {
    if (typeof a.variante !== 'string') err(`${ch}.variante`, 'texte attendu, par exemple "farmer desert 3"');
    const v = lireVariante(type, a.variante);
    if (v.erreur) err(`${ch}.variante`, v.erreur);
    c.variante = a.variante;
  }
  for (const k of ['bebe', 'charge', 'selle', 'coffre', 'tondu', 'cris']) if (a[k] !== undefined) { if (typeof a[k] !== 'boolean') err(`${ch}.${k}`, 'true ou false attendu'); c[k] = a[k]; }
  if (c.bebe && !ESPECES[type][5]) err(`${ch}.bebe`, `${type} n'a pas de bebe dans le jeu`);
  if (a.taille !== undefined) { if (!['slime', 'magma_cube'].includes(type) || !Number.isInteger(a.taille) || a.taille < 1 || a.taille > 8) err(`${ch}.taille`, 'entier de 1 a 8 (slime et magma_cube seulement ; le jeu : 1, 2, 4)'); c.taille = a.taille; }
  if (a.charge && !['creeper', 'wither'].includes(type)) err(`${ch}.charge`, 'creeper (ou wither) seulement');
  if (a.selle && !['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'camel', 'pig', 'strider'].includes(type)) err(`${ch}.selle`, 'cheval, ane, mule, chameau, cochon ou arpenteur seulement');
  if (a.armureCheval !== undefined && a.armureCheval !== null) { if (!['horse', 'zombie_horse', 'skeleton_horse'].includes(type) || !ARMURES_CHEVAL.includes(a.armureCheval)) err(`${ch}.armureCheval`, `cheval seulement, materiau parmi ${ARMURES_CHEVAL.join(', ')}`); c.armureCheval = a.armureCheval; }
  if (a.colle !== undefined && a.colle !== null) { if (!['wolf', 'cat'].includes(type) || !TEINTURES.includes(a.colle)) err(`${ch}.colle`, `loup ou chat seulement, couleur parmi ${TEINTURES.join(', ')} (le collier rend l'animal apprivoise)`); c.colle = a.colle; }
  if (a.coffre && !['donkey', 'mule', 'llama', 'trader_llama'].includes(type)) err(`${ch}.coffre`, 'ane, mule ou lama seulement');
  if (a.tondu && !['sheep', 'bogged', 'snow_golem'].includes(type)) err(`${ch}.tondu`, 'mouton (ou bogged, golem de neige) seulement');
  if (a.gonfle !== undefined) c.gonfle = pisteValeurs(a.gonfle, `${ch}.gonfle`, err, (v) => estNombre(v) && v >= 0 && v <= 1, 'nombre de 0 a 1', duree);
  if (a.agressif !== undefined) c.agressif = pisteValeurs(a.agressif, `${ch}.agressif`, err, (v) => v === 0 || v === 1 || typeof v === 'boolean', '0 ou 1', duree);
  if (a.anim !== undefined) c.anim = pisteValeurs(a.anim, `${ch}.anim`, err, (v) => v === null || typeof v === 'string', 'nom d\'animation ou null', duree);
  if (a.regarde !== undefined) {
    const brut = typeof a.regarde === 'string' || a.regarde === null ? [[0, a.regarde]] : a.regarde;
    c.regarde = pisteValeurs(brut, `${ch}.regarde`, err, (v) => v === null || (typeof v === 'string' && noms.has(v)) || (Array.isArray(v) && v.length === 3 && v.every(estNombre)), 'nom d\'acteur, [x, y, z] ou null', duree);
  }
  if (a.parties !== undefined) {
    if (!estObjet(a.parties) || Object.keys(a.parties).length > 16) err(`${ch}.parties`, '{ "nom_de_partie": [[t, x, y, z], ...] } attendu (degres ; 16 parties au plus ; mcanim creatures --liste type)');
    c.parties = {};
    for (const [nom, p] of Object.entries(a.parties)) {
      if (!/^[a-z0-9_]{1,40}$/.test(nom)) err(`${ch}.parties.${nom}`, 'nom de partie du modele attendu');
      if (!Array.isArray(p) || p.some((k) => !Array.isArray(k) || k.length < 4 || !k.slice(0, 4).every(estNombre))) err(`${ch}.parties.${nom}`, '[[t, x, y, z], ...] attendu (rotations en degres ajoutees a celles de l\'animation)');
      c.parties[nom] = { arite: 3, cles: p.map((k) => ({ t: k[0], v: [k[1], k[2], k[3]], l: typeof k[4] === 'string' ? k[4] : undefined })) };
    }
  }
  // bloc porte par l'enderman, bloc dans un wagonnet (displayBlockState), objet dans les bras croises d'un villageois (echange)
  const idBloc = (v) => typeof v === 'string' && /^(minecraft:)?[a-z0-9_]{1,60}$/.test(v);
  if (a.porte !== undefined && a.porte !== null) { if (type !== 'enderman' || !idBloc(a.porte)) err(`${ch}.porte`, 'enderman seulement : id de bloc attendu, par exemple "minecraft:grass_block"'); c.porte = a.porte.replace(/^minecraft:/, ''); }
  if (a.contenu !== undefined && a.contenu !== null) { if (!type.includes('minecart') || !idBloc(a.contenu)) err(`${ch}.contenu`, 'wagonnet seulement : id de bloc attendu, par exemple "minecraft:chest"'); c.contenu = a.contenu.replace(/^minecraft:/, ''); }
  if (a.echange !== undefined && a.echange !== null) { if (!['villager', 'wandering_trader'].includes(type) || !idBloc(a.echange)) err(`${ch}.echange`, 'villageois seulement : id d\'objet montre dans les bras croises (echange), par exemple "minecraft:emerald"'); c.echange = a.echange.replace(/^minecraft:/, ''); }
  if (a.sautille !== undefined) { if (type !== 'rabbit' || typeof a.sautille !== 'boolean') err(`${ch}.sautille`, 'lapin seulement : true (defaut, il avance en sautant comme dans le jeu) ou false'); c.sautille = a.sautille; }
  // IA (moteur/ia.js) : ia true|false, cible forcee, comportement, points garde / maison / travail
  if (a.ia !== undefined) { if (typeof a.ia !== 'boolean') err(`${ch}.ia`, 'true (la creature agit seule, comme dans le jeu) ou false (tout aux pistes, defaut)'); if (a.ia && VEHICULES.has(type)) err(`${ch}.ia`, 'un vehicule n a pas d IA'); if (a.ia) c.ia = true; }
  const avecIa = (k) => { if (a[k] !== undefined && !a.ia) err(`${ch}.${k}`, 'champ de l IA : il faut aussi "ia": true'); };
  if (a.cible !== undefined && a.cible !== null) { avecIa('cible'); if (typeof a.cible !== 'string' || !noms.has(a.cible) || a.cible === a.nom) err(`${ch}.cible`, 'nom d un autre acteur attendu (la creature le prend pour cible)'); c.cible = a.cible; }
  if (a.comportement !== undefined && a.comportement !== null) { avecIa('comportement'); if (!COMPORTEMENTS_IA.includes(a.comportement)) err(`${ch}.comportement`, `"${a.comportement}" inconnu${voulaisTu(String(a.comportement), COMPORTEMENTS_IA)} (permis : ${COMPORTEMENTS_IA.join(', ')})`); c.comportement = a.comportement; }
  for (const k of ['garde', 'maison', 'travail']) if (a[k] !== undefined && a[k] !== null) { avecIa(k); if (!Array.isArray(a[k]) || a[k].length !== 3 || !a[k].every(estNombre)) err(`${ch}.${k}`, 'point [x, y, z] attendu (pieds)'); c[k] = a[k]; }
  // villageois : lit (bloc du lit, ou il dort la nuit) et point de rassemblement (cloche, 15 h a 17 h) ; perroquet : epaule d'un joueur ; allay : joueur aime
  for (const k of ['lit', 'rassemblement']) if (a[k] !== undefined && a[k] !== null) { avecIa(k); if (!['villager', 'wandering_trader'].includes(type)) err(`${ch}.${k}`, 'villageois seulement'); if (!Array.isArray(a[k]) || a[k].length !== 3 || !a[k].every(Number.isInteger)) err(`${ch}.${k}`, k === 'lit' ? 'cellule [x, y, z] du lit (entiers ; la moitie pied ou tete)' : 'cellule [x, y, z] de la cloche (entiers)'); c[k] = a[k]; }
  for (const [k, t] of [['epaule', 'parrot'], ['ami', 'allay']]) if (a[k] !== undefined && a[k] !== null) {
    avecIa(k);
    if (type !== t || typeof a[k] !== 'string' || !noms.has(a[k]) || typesActeurs.get(a[k])) err(`${ch}.${k}`, `${t === 'parrot' ? 'perroquet' : 'allay'} seulement : nom d un joueur de la scene attendu`);
    c[k] = a[k];
  }
  // reproduction et vie (moteur/ia-vie.js) : animal apprivoise (equides, lama, loup, chat : condition de reproduction), ruche d'une abeille,
  // nourriture d'un villageois (pain, pommes de terre, carottes, betteraves : 12 points pour faire un bebe)
  if (a.apprivoise !== undefined) { if (typeof a.apprivoise !== 'boolean' || !['horse', 'donkey', 'mule', 'llama', 'trader_llama', 'wolf', 'cat', 'parrot', 'camel'].includes(type)) err(`${ch}.apprivoise`, 'true ou false (cheval, ane, mule, lama, loup, chat, perroquet, chameau)'); c.apprivoise = a.apprivoise; }
  if (a.ruche !== undefined && a.ruche !== null) { avecIa('ruche'); if (type !== 'bee' || !Array.isArray(a.ruche) || a.ruche.length !== 3 || !a.ruche.every(Number.isInteger)) err(`${ch}.ruche`, 'abeille seulement : cellule [x, y, z] de sa ruche ou de son nid (entiers ; sans : elle en cherche une a 20 blocs)'); c.ruche = a.ruche; }
  if (a.nourriture !== undefined && a.nourriture !== null) {
    avecIa('nourriture');
    if (type !== 'villager' || !estObjet(a.nourriture) || Object.entries(a.nourriture).some(([k, v]) => !['bread', 'potato', 'carrot', 'beetroot', 'wheat', 'wheat_seeds', 'beetroot_seeds'].includes(k) || !Number.isInteger(v) || v < 1 || v > 64)) err(`${ch}.nourriture`, 'villageois seulement : { "bread": 3 } (bread 4 points, potato, carrot, beetroot 1 ; 12 points pour un bebe)');
    c.nourriture = a.nourriture;
  }
  // age d'un bebe en ticks (AgeableMob : -24000 a la naissance, adulte a 0 ; x croissance.vitesse)
  if (a.age !== undefined && a.age !== null) { avecIa('age'); if (!a.bebe || !Number.isInteger(a.age) || a.age < -48000 || a.age > -1) err(`${ch}.age`, 'bebe seulement : ticks avant l age adulte, entier negatif (le jeu : -24000 a la naissance)'); c.age = a.age; }
  // dernieres creatures (moteur/ia-boss.js, ia-warden.js, ia-oeufs.js) : centre et perchoir du dragon, warden qui sort de terre, genes du panda,
  // ocelot confiant, tortue qui porte un oeuf, grenouille enceinte
  if (a.centre !== undefined && a.centre !== null) { avecIa('centre'); if (type !== 'ender_dragon' || !Array.isArray(a.centre) || a.centre.length !== 2 || !a.centre.every(estNombre)) err(`${ch}.centre`, 'dragon seulement : [x, z] du centre de ses cercles (defaut : monde.fontaine, sinon son depart)'); c.centre = a.centre; }
  if (a.perchoir !== undefined && a.perchoir !== null) { avecIa('perchoir'); if (type !== 'ender_dragon' || !Array.isArray(a.perchoir) || a.perchoir.length !== 3 || !a.perchoir.every(Number.isInteger)) err(`${ch}.perchoir`, 'dragon seulement : cellule [x, y, z] ou il se pose (defaut : le sol sous le centre)'); c.perchoir = a.perchoir; }
  if (a.emerge !== undefined) { avecIa('emerge'); if (type !== 'warden' || typeof a.emerge !== 'boolean') err(`${ch}.emerge`, 'warden seulement : true = il sort de terre (134 ticks)'); c.emerge = a.emerge; }
  const GENES = ['normal', 'lazy', 'worried', 'playful', 'brown', 'weak', 'aggressive'];
  if (a.genes !== undefined && a.genes !== null) { avecIa('genes'); if (type !== 'panda' || !Array.isArray(a.genes) || a.genes.length !== 2 || !a.genes.every((g) => GENES.includes(g))) err(`${ch}.genes`, `panda seulement : [gene principal, gene cache] parmi ${GENES.join(', ')} (brown et weak : recessifs)`); c.genes = a.genes; }
  for (const [k, t] of [['confiance', 'ocelot'], ['aOeuf', 'turtle'], ['enceinte', 'frog']]) if (a[k] !== undefined) { avecIa(k); if (type !== t || typeof a[k] !== 'boolean') err(`${ch}.${k}`, `${t} seulement : true ou false`); c[k] = a[k]; }
  // laisse : tenue par un acteur ("nom"), attachee a une barriere ([x, y, z], noeud), ou piste [[t, "nom" | [x, y, z] | null], ...]
  if (a.laisse !== undefined && a.laisse !== null) {
    const pointOk = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isInteger);
    const brut = typeof a.laisse === 'string' || pointOk(a.laisse) ? [[0, a.laisse]] : a.laisse;
    c.laisse = pisteValeurs(brut, `${ch}.laisse`, err, (v) => v === null || pointOk(v) || (typeof v === 'string' && noms.has(v) && v !== a.nom), 'nom d\'un autre acteur (qui tient la laisse), [x, y, z] d\'une barriere ou null', duree);
  }
  if (VEHICULES.has(type) && (a.actes !== undefined)) err(`${ch}.actes`, 'un vehicule ne marche pas : donner sa piste pos (ou le faire monter)');
  o.creature = c;
  o.reactions = false;   // les reactions du joueur (genoux, bras) ne vont pas aux creatures
}

// Champs lus en plus dans les ACTES pour une creature : seuls va, regarde, saute, attends ont un sens.
export const VERBES_CREATURES = ['va', 'regarde', 'saute', 'attends'];

// Sons des creatures dont la scene a besoin (groupe de kit `sons_creatures`) : ceux des types presents (cri, blessure, mort, pas) et
// des vehicules (pagaie, wagonnet) ; null sans creature.
export function evenementsDeScene(scene) {
  const types = [...new Set(scene.acteurs.filter((a) => a.creature).map((a) => a.creature.type))];
  const ev = new Set();
  // sons du monde a la demande (meme mecanisme : evenements de sounds.json, .ogg par l index des fichiers du jeu ou le miroir) :
  // ambiance (sons.ambiance) et sons nommes dans sons.liste qui ne sont pas dans le kit de base
  if (scene.sons?.ambiance) for (const e of AMBIANCE) ev.add(e);
  for (const s of scene.sons?.liste ?? []) if (typeof s.nom === 'string' && !SOUND_EVENTS.includes(s.nom)) ev.add(s.nom);
  // juke-box : la musique des disques utilises par les acteurs (music_disc.<nom>, a la demande)
  for (const a of scene.acteurs) for (const x of a.actes ?? []) { const o = String(x.objet ?? x.opts?.objet ?? ''); const m = /^music_disc_(.+)$/.exec(o); if (m) ev.add('music_disc.' + m[1]); }
  // creatures qui naissent d'un bloc ou d'un objet sans etre dans la scene : wither invoque (crane de wither squelette), bebes tortues
  // (oeuf de tortue), tetards (frai), renifleur (oeuf), poussin (oeuf lance) : leurs sons
  const texte = JSON.stringify([scene.decor ?? null, scene.acteurs.map((a) => a.actes ?? null), scene.monde?.blocs ?? null]);
  for (const [motif, t, sons] of [[/wither_skeleton_skull/, 'wither', ['entity.wither.spawn', 'entity.wither.shoot', 'entity.wither.break_block']], [/turtle_egg/, 'turtle', ['entity.turtle.egg_crack', 'entity.turtle.egg_hatch']],
    [/frogspawn/, 'tadpole', ['block.frogspawn.hatch']], [/sniffer_egg/, 'sniffer', ['block.sniffer_egg.crack', 'block.sniffer_egg.hatch']], [/"egg"/, 'chicken', ['entity.egg.throw']]]) {
    if (!motif.test(texte)) continue;
    for (const s of sons) ev.add(s);
    if (!types.includes(t)) types.push(t);
  }
  if (!types.length) return ev.size ? [...ev].sort() : null;
  // vie des creatures (moteur/ia-vie.js) : especes qui peuvent naitre d'une conversion ou d'un appel (leurs cris), sons de la vie
  const avecIa = new Set(scene.acteurs.filter((a) => a.creature?.ia).map((a) => a.creature.type));
  const CONV = { villager: ['zombie_villager', 'witch', 'iron_golem'], zombie: ['drowned'], husk: ['zombie'], zombie_villager: ['drowned', 'villager'], pig: ['zombified_piglin'], frog: ['tadpole'], tadpole: ['frog'] };
  for (const t of [...avecIa]) for (const u of CONV[t] ?? []) if (!types.includes(u)) types.push(u);
  const SONS_VIE = {
    bee: ['entity.bee.pollinate', 'block.beehive.enter', 'block.beehive.exit', 'block.beehive.work'], pig: ['entity.pig.eat'], cat: ['entity.cat.eat'], fox: ['entity.fox.eat'], goat: ['entity.goat.eat'], armadillo: ['entity.armadillo.eat'],
    strider: ['entity.strider.eat'], horse: ['entity.horse.eat'], donkey: ['entity.donkey.eat'], llama: ['entity.llama.eat'], camel: ['entity.camel.eat'], allay: ['block.amethyst_block.chime'],
    // dernieres creatures (moteur/ia-boss.js, ia-eau.js, ia-warden.js, ia-oeufs.js, vibrations.js)
    wither: ['entity.wither.spawn', 'entity.wither.shoot', 'entity.wither.break_block', 'entity.generic.explode'],
    ender_dragon: ['entity.ender_dragon.flap', 'entity.ender_dragon.growl', 'entity.ender_dragon.shoot', 'entity.dragon_fireball.explode', 'entity.generic.explode', 'entity.experience_orb.pickup'],
    warden: ['entity.warden.tendril_clicks', 'entity.warden.listening', 'entity.warden.listening_angry', 'entity.warden.sniff', 'entity.warden.emerge', 'entity.warden.dig', 'entity.warden.roar', 'entity.warden.sonic_charge', 'entity.warden.sonic_boom', 'entity.warden.attack_impact', 'block.sculk_sensor.clicking', 'block.sculk_sensor.clicking_stop'],
    guardian: ['entity.guardian.attack', 'entity.guardian.flop'], elder_guardian: ['entity.guardian.attack', 'entity.elder_guardian.curse', 'entity.elder_guardian.flop'],
    turtle: ['entity.turtle.lay_egg', 'entity.turtle.egg_crack', 'entity.turtle.egg_hatch', 'entity.experience_orb.pickup'], frog: ['entity.frog.lay_spawn', 'block.frogspawn.hatch', 'entity.tadpole.grow_up'],
    sniffer: ['block.sniffer_egg.plop', 'block.sniffer_egg.crack', 'block.sniffer_egg.hatch', 'entity.experience_orb.pickup'], chicken: ['entity.chicken.egg', 'entity.egg.throw'], dolphin: ['entity.dolphin.jump'],
    squid: ['entity.squid.squirt'], glow_squid: ['entity.glow_squid.squirt'], pufferfish: ['entity.puffer_fish.blow_up', 'entity.puffer_fish.blow_out', 'entity.puffer_fish.sting'],
    cod: ['entity.cod.flop'], salmon: ['entity.salmon.flop'], tropical_fish: ['entity.tropical_fish.flop'], tadpole: ['entity.tadpole.flop', 'entity.tadpole.grow_up'],
    villager: ['entity.zombie.infect', 'entity.item.pickup'], zombie: ['entity.zombie.converted_to_drowned'], husk: ['entity.husk.converted_to_zombie'], zombie_villager: ['entity.zombie_villager.cure', 'entity.zombie_villager.converted', 'entity.zombie.converted_to_drowned'], mooshroom: ['entity.mooshroom.convert'],
  };
  for (const t of avecIa) for (const s of SONS_VIE[t] ?? []) ev.add(s);
  if (avecIa.size) ev.add('entity.experience_orb.pickup');   // orbes d'une reproduction (toute espece), d'une mort du dragon...
  if (avecIa.has('parrot')) for (const t of types) if (IMITES.has(t)) ev.add('entity.parrot.imitate.' + t);
  for (const t of types) {
    const e = ESPECES[t];
    for (const s of [...e[3], e[4]]) if (s) ev.add('entity.' + s);
    if (t === 'creeper') ev.add('entity.creeper.primed');
    if (t.includes('boat')) ev.add('entity.boat.paddle_water');
    if (t.includes('minecart')) ev.add('entity.minecart.riding');
    if (t === 'iron_golem') ev.add('entity.iron_golem.attack');
    if (t === 'villager') ev.add('entity.villager.no');
  }
  // especes a IA (moteur/ia-especes.js) : sons de leurs comportements
  const SONS_IA = {
    ghast: ['entity.ghast.warn', 'entity.ghast.shoot', 'entity.generic.explode'], blaze: ['entity.blaze.shoot'], witch: ['entity.witch.drink', 'entity.witch.throw', 'entity.splash_potion.break'],
    enderman: ['entity.enderman.teleport', 'entity.enderman.scream', 'entity.enderman.stare'], bat: ['entity.bat.takeoff'], bee: ['entity.bee.loop', 'entity.bee.loop_aggressive', 'entity.bee.sting'],
    phantom: ['entity.phantom.swoop'], vex: ['entity.vex.charge'], parrot: ['entity.parrot.step'],
    villager: ['entity.villager.trade', 'entity.villager.yes', 'entity.villager.no', ...['armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher', 'leatherworker', 'librarian', 'mason', 'shepherd', 'toolsmith', 'weaponsmith'].map((m) => 'entity.villager.work_' + m)],
  };
  for (const a of scene.acteurs) if (a.creature?.ia) for (const s of SONS_IA[a.creature.type] ?? []) ev.add(s);
  if (scene.acteurs.some((a) => a.creature?.laisse)) { ev.add('item.lead.break'); ev.add('item.lead.tied'); }
  // IA et combat : tirs, portes des zombies, coups du joueur
  if (scene.acteurs.some((a) => a.creature?.ia) || scene.acteurs.some((a) => a.actes?.some((x) => x.verbe === 'frappe'))) {
    for (const s2 of ['entity.skeleton.shoot', 'entity.snow_golem.shoot', 'entity.zombie.attack_wooden_door', 'entity.zombie.break_wooden_door', 'entity.player.attack.strong', 'entity.player.attack.weak', 'entity.player.attack.crit', 'entity.player.hurt', 'entity.player.death', 'entity.arrow.hit', 'entity.arrow.hit_player', 'entity.generic.explode']) ev.add(s2);
  }
  return [...ev].sort();
}
