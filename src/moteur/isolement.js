// Simulation d'une scene AVEC mods dans un processus fils a permissions (docs/SIMULATION.md 3.5 couche 2, partie 26) : le code des mods
// (ecrit par le Claude du client, ou injecte) ne tourne jamais dans le processus du lecteur. Le fils (moteur/fils.js) ne lit que le code du
// lecteur, n'ecrit rien, ne lance rien, n'a pas de reseau ; la scene, la zone et les donnees du jeu lui sont donnees par le canal IPC ; il
// rend le replay (memes octets qu'une simulation dans le processus : test/mods-isoles.test.js). Sans mods : simulation dans le processus.
// Plafonds : 1 s par appel de gestionnaire et 10 s de mods par scene (moteur/mods.js), plafond de calcul de la simulation (60 s), memoire
// du fils (2 Go), et un chien de garde ici qui tue le fils au-dela du plafond + 30 s. Les messages d'erreur ne dependent pas de l'horloge.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { simuler, lireFichiersMods, preparer, ErreurMonde } from './index.js';
import { replayDepuisObjet } from './replay.js';
import { donneesAvecPerso } from './perso.js';
import { optionsAvecContexte } from './contexte.js';
import { racineObjetsLocale } from './objets-jeu.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(ICI, '..');
export const FICHIER_FILS = path.join(ICI, 'fils.js');
export const MEMOIRE_FILS_MO = 2048;

// Arguments de Node du fils (exportes pour les tests de securite)
export function argumentsFils(lectures = []) {
  return ['--permission', `--allow-fs-read=${SRC}`, ...lectures.map((d) => `--allow-fs-read=${d}`), `--max-old-space-size=${MEMOIRE_FILS_MO}`, '--disallow-code-generation-from-strings', '--no-addons', '--no-warnings'];
}

// Lance le fils, lui donne `message`, rend sa reponse. `garde` : millisecondes avant de le tuer.
// lectures : dossiers en lecture seule en plus du code (caracteristiques du jeu du kit : moteur/caracteristiques.js).
export function dansLeFils(message, { garde = 90000, lectures = [] } = {}) {
  return new Promise((resoudre, rejeter) => {
    const env = { SYSTEMROOT: process.env.SYSTEMROOT ?? '', PATH: '' };   // aucun secret de l'environnement ne passe
    // chien de garde : l'option `timeout` de spawn tue le fils (SIGKILL) au bout de `garde` ms (pas de minuterie dans le code du moteur)
    const fils = spawn(process.execPath, [...argumentsFils(lectures), FICHIER_FILS], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced', env, windowsHide: true, cwd: SRC, timeout: garde, killSignal: 'SIGKILL' });
    let fini = false, err = '';
    fils.stderr.on('data', (b) => { err = (err + b.toString()).slice(-2000); });
    const fin = (f) => { if (fini) return; fini = true; f(); };
    fils.on('message', (r) => fin(() => {
      if (r && r.ok) resoudre(r);
      else rejeter(r && r.monde ? new ErreurMonde(r.message) : new Error('simulation des mods : ' + (r?.message ?? 'reponse vide')));
    }));
    fils.on('error', (e) => fin(() => rejeter(new Error('simulation des mods : le processus fils ne demarre pas (' + e.message + ')'))));
    fils.on('exit', (code, signal) => fin(() => rejeter(signal === 'SIGKILL' && fils.killed !== false ? new ErreurMonde(`simulation des mods arretee : plus de ${Math.round(garde / 1000)} s (boucle sans fin dans un mod ?)`) : /heap|memory/i.test(err) ? new ErreurMonde(`simulation des mods arretee : plus de ${MEMOIRE_FILS_MO} Mo de memoire`) : new Error(`simulation des mods : le processus fils s'est arrete (code ${code ?? signal})${err ? ' : ' + err.trim().split('\n').pop() : ''}`))));
    fils.send(message);
  });
}

const zoneBrute = (zone) => ({ hdr: zone.hdr, cellules: zone.cellules, biomes: zone.biomes, hauteurs: zone.hauteurs });

// Comme moteur/index.js simuler(), mais les mods tournent dans le fils. `contexte` : ce qui ne passe pas comme une fonction
// ({ heurePiste, typesC }) ; `options` : le reste (meteo, plafondMs...). Rend { replay, rapport, donnees } : `donnees` = tables du jeu de la
// scene (avec les blocs des mods : le rendu en a besoin pour les dessiner).
export async function simulerIsole({ zone, donnees, monde = {}, acteurs = [], baseDir, duree, options = {}, contexte = {} }) {
  const mods = lireFichiersMods(monde.mods, baseDir);
  if (!mods.length) {
    const r = simuler({ zone, donnees, monde, mods, acteurs, baseDir, duree, options: await optionsAvecContexte(options, contexte) });
    return { replay: r.replay, rapport: r.rapport, donnees: r.sim.d };
  }
  if (!donnees.octets) throw new Error('simulation des mods : donnees du jeu sans leurs octets');
  // donnees d'objets du jeu (recettes, enchantements : objets-jeu.js) : celles du kit, sinon la copie locale trouvee ICI (le fils ne peut pas
  // chercher : sans elles, une epee enchantee faisait echouer `mcanim simuler` d'une scene avec mods)
  const racine = options.kitDir ? null : racineObjetsLocale();
  const DOSSIERS = ['recipe', 'enchantment', 'tags', 'damage_type', 'loot_table', 'predicate', 'context_int_provider', 'context_float_provider'];
  const lectures = [...(options.kitDir ? [path.join(options.kitDir, 'data', 'minecraft', 'worldgen'), ...DOSSIERS.map((d) => path.join(options.kitDir, 'data', 'minecraft', d))] : []), ...(racine ? DOSSIERS.map((d) => path.join(racine, 'data', 'minecraft', d)) : [])];
  const r = await dansLeFils({ op: 'simuler', zone: zoneBrute(zone), donnees: donnees.octets, monde, acteurs, duree, mods, options: { ...options, racineObjets: racine }, contexte }, { garde: (options.plafondMs ?? 60000) + 30000, lectures });
  const replay = replayDepuisObjet(r.replay);
  return { replay, rapport: r.rapport, donnees: donneesAvecPerso(donnees, replay.perso?.blocs) };
}

// `mcanim mods verifier` : chargement d'un mod dans le fils. Rend { n, definitions }.
export async function verifierModIsole({ mod, donnees, zone }) {
  if (!donnees.octets) { const sim = preparer({ zone, donnees, monde: {}, mods: [mod] }); return { n: sim.reg.entrees.filter((e) => e.source !== 'moteur').length, definitions: sim.definitions }; }
  return dansLeFils({ op: 'verifier', zone: zoneBrute(zone), donnees: donnees.octets, mods: [mod] }, { garde: 30000 });
}
