// Champs d'acteur des creatures (lecture et controle) : type, variante, bebe, taille, charge, selle, armureCheval, colle, coffre, tondu,
// gonfle, agressif, anim, regarde, parties, monture, etiquette, cris. Un acteur sans `type` (ou "joueur") n'est pas touche.
import { ESPECES, VEHICULES, TEINTURES, MONTURES, lireVariante } from './especes.js';
import { voulaisTu } from '../moteur/util.js';

export const TYPES = Object.keys(ESPECES).filter((t) => t !== 'mannequin');
const ARMURES_CHEVAL = ['leather', 'iron', 'golden', 'diamond', 'netherite', 'copper'];
// noms speciaux de `anim` (en plus des animations a images cles du type) : coup de bras / attaque, tete qui dit non, degats
export const ANIMS_SPECIALES = ['attaque', 'non', 'blesse', 'stop'];
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
    for (const k of ['variante', 'bebe', 'taille', 'charge', 'selle', 'armureCheval', 'colle', 'coffre', 'tondu', 'gonfle', 'anim', 'parties', 'agressif']) if (a[k] !== undefined) err(`${ch}.${k}`, 'champ des creatures : il faut aussi "type" (par exemple "type": "zombie")');
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
  return [...ev].sort();
}
