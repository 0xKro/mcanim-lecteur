// Champs d'acteur des creatures (lecture et controle) : type, variante, bebe, taille, charge, selle, armureCheval, colle, coffre, tondu,
// gonfle, agressif, anim, regarde, parties, monture, etiquette, cris. Un acteur sans `type` (ou "joueur") n'est pas touche.
import { ESPECES, VEHICULES, TEINTURES, MONTURES, lireVariante } from './especes.js';
import { voulaisTu } from '../moteur/util.js';

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
    for (const k of ['variante', 'bebe', 'taille', 'charge', 'selle', 'armureCheval', 'colle', 'coffre', 'tondu', 'gonfle', 'anim', 'parties', 'agressif', 'porte', 'contenu', 'echange', 'sautille', 'ia', 'comportement', 'garde', 'maison', 'travail']) if (a[k] !== undefined) err(`${ch}.${k}`, 'champ des creatures : il faut aussi "type" (par exemple "type": "zombie")');
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
  if (!types.length) return null;
  const ev = new Set();
  for (const t of types) {
    const e = ESPECES[t];
    for (const s of [...e[3], e[4]]) if (s) ev.add('entity.' + s);
    if (t === 'creeper') ev.add('entity.creeper.primed');
    if (t.includes('boat')) ev.add('entity.boat.paddle_water');
    if (t.includes('minecart')) ev.add('entity.minecart.riding');
    if (t === 'iron_golem') ev.add('entity.iron_golem.attack');
    if (t === 'villager') ev.add('entity.villager.no');
  }
  // IA et combat : tirs, portes des zombies, coups du joueur
  if (scene.acteurs.some((a) => a.creature?.ia) || scene.acteurs.some((a) => a.actes?.some((x) => x.verbe === 'frappe'))) {
    for (const s2 of ['entity.skeleton.shoot', 'entity.snow_golem.shoot', 'entity.zombie.attack_wooden_door', 'entity.zombie.break_wooden_door', 'entity.player.attack.strong', 'entity.player.attack.weak', 'entity.player.attack.crit', 'entity.player.hurt', 'entity.player.death', 'entity.arrow.hit', 'entity.arrow.hit_player', 'entity.generic.explode']) ev.add(s2);
  }
  return [...ev].sort();
}
