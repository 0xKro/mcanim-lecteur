// mcanim creatures --liste [mot] : aide gratuite (30 lignes au plus). Sans mot : les types par famille avec leur vitesse de marche ;
// avec un type : variantes, bebe, animations nommees, parties du modele, boite, siege de monture ; sinon les types qui contiennent le mot.
import { ESPECES, VARIANTES, MONTURES, SIEGES, vitesseMarche } from './especes.js';
import { TYPES, ANIMS_SPECIALES } from './scene.js';
import { nomsAnimations } from './anim.js';
import { nomsParties } from './poses.js';
import { donneesCreatures } from './donnees.js';
import { boiteDe, statsDe } from '../film/creatures.js';

const FR = { vache: 'cow', cochon: 'pig', mouton: 'sheep', poule: 'chicken', poulet: 'chicken', cheval: 'horse', ane: 'donkey', loup: 'wolf', chien: 'wolf', chat: 'cat', renard: 'fox',
  lapin: 'rabbit', chevre: 'goat', abeille: 'bee', perroquet: 'parrot', chauve: 'bat', grenouille: 'frog', tortue: 'turtle', dauphin: 'dolphin', poisson: 'cod', saumon: 'salmon',
  calamar: 'squid', chameau: 'camel', villageois: 'villager', marchand: 'wandering_trader', golem: 'iron_golem', araignee: 'spider', squelette: 'skeleton', sorciere: 'witch',
  bateau: 'boat', wagonnet: 'minecart', lama: 'llama', panda: 'panda', ours: 'polar_bear', gardien: 'warden', dragon: 'ender_dragon' };
const GROUPES = [
  ['monstres', ['zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'bogged', 'parched', 'wither_skeleton', 'creeper', 'spider', 'cave_spider', 'enderman', 'slime', 'magma_cube', 'witch', 'silverfish', 'endermite', 'phantom', 'blaze', 'ghast', 'guardian', 'elder_guardian', 'shulker', 'vex', 'ravager', 'warden', 'breeze', 'creaking', 'giant']],
  ['illageois, piglins', ['pillager', 'vindicator', 'evoker', 'illusioner', 'piglin', 'piglin_brute', 'zombified_piglin', 'hoglin', 'zoglin', 'strider']],
  ['villages', ['villager', 'wandering_trader', 'iron_golem', 'snow_golem', 'copper_golem', 'allay', 'cat']],
  ['ferme', ['cow', 'mooshroom', 'pig', 'sheep', 'chicken', 'goat', 'rabbit', 'llama', 'trader_llama']],
  ['chevaux', ['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'camel', 'camel_husk']],
  ['sauvages', ['wolf', 'fox', 'ocelot', 'panda', 'polar_bear', 'armadillo', 'turtle', 'frog', 'tadpole', 'bee', 'parrot', 'bat', 'sniffer']],
  ['eau', ['axolotl', 'dolphin', 'cod', 'salmon', 'tropical_fish', 'pufferfish', 'squid', 'glow_squid', 'nautilus', 'zombie_nautilus']],
  ['grands', ['ender_dragon', 'wither', 'happy_ghast']],
  ['vehicules, objets', ['boat', 'chest_boat', 'minecart', 'chest_minecart', 'furnace_minecart', 'hopper_minecart', 'tnt_minecart', 'armor_stand']],
];

export async function commandeCreatures(argv, { lireArgs, dire, Usage }) {
  const { opt, pos } = lireArgs(argv, { drapeaux: ['liste'], valeurs: [] });
  if (!opt.liste) throw new Usage('usage : mcanim creatures --liste [mot]   (sans mot : tous les types ; un type : ses variantes, animations, parties)');
  const d = await donneesCreatures({});
  const lignes = liste(d, pos.join(' ').trim().toLowerCase());
  dire(lignes.slice(0, 30).join('\n'));
}

export function liste(d, mot = '') {
  const L = [];
  if (!mot) {
    L.push(`${TYPES.length} types (champ "type") ; vitesse de marche du jeu en blocs/s entre parentheses ; mcanim creatures --liste <type> pour le detail`);
    for (const [g, ts] of GROUPES) L.push(`${g} : ${ts.filter((t) => ESPECES[t]).map((t) => { const v = vitesseMarche(t, statsDe({ type: t }, d.types)); return v ? `${t} (${v})` : t; }).join(', ')}`);
    L.push(`montures (champ "monture" du cavalier) : ${MONTURES.filter((m) => !m.includes('_minecart')).join(', ')}, wagonnets`);
    L.push(`anim speciales : ${ANIMS_SPECIALES.join(', ')} ; champs : variante bebe taille charge selle armureCheval colle coffre tondu gonfle agressif anim regarde parties etiquette cris`);
    return L;
  }
  const type = TYPES.includes(mot) ? mot : FR[mot];
  if (!type) {
    const t = TYPES.filter((x) => x.includes(mot));
    return [t.length ? `types contenant "${mot}" : ${t.join(', ')}` : `aucun type ne contient "${mot}" (mcanim creatures --liste)`];
  }
  const e = ESPECES[type], c = { type };
  const b = boiteDe(c, d.types), st = statsDe(c, d.types);
  const modele = d.modeles[e[0]];
  L.push(`${type} : modele ${e[0]} (couches ${Object.keys(modele ?? {}).join(', ')}), texture entity/${e[1]}, animation ${e[2]}`);
  L.push(`boite ${b.l} x ${b.h}, yeux ${b.y}, marche ${vitesseMarche(type, st)} blocs/s (course ${vitesseMarche(type, st, true)}), pas de ${b.pas}${st?.pv ? `, vie ${st.pv}` : ''}`);
  if (e[5]) L.push(`bebe : oui (${d.modeles[e[0] + '_baby'] ? 'modele bebe du jeu' : 'modele adulte a moitie'})`); else L.push('bebe : non');
  for (const [i, l] of (VARIANTES[type] ?? []).entries()) L.push(`variante ${i + 1} : ${l.join(' ')}${i === 0 ? ' (defaut : le premier mot)' : ''}`);
  const an = nomsAnimations(type, d.animations);
  L.push(`anim : ${[...ANIMS_SPECIALES, ...an].join(', ')}`);
  if (modele?.main) L.push(`parties (piste "parties" : [[t, x, y, z]] degres) : ${nomsParties(modele.main.r).join(' ')}`.slice(0, 400));
  if (SIEGES[type] || MONTURES.includes(type)) L.push(`monture : siege a ${(SIEGES[type] ?? [0, b.h, 0])[1]} bloc(s) au-dessus des pieds`);
  return L;
}
