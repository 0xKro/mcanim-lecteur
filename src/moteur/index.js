// Point d'entree du moteur de simulation. Charge UNIQUEMENT quand une scene a un champ `monde` (import() dynamique) : une scene
// sans `monde` ne paie rien et ne change pas d'un bit.
//
//   const { replay, sim, rapport } = await simuler({ zone, donnees, monde, duree, baseDir })
//   monde : le champ `monde` de la scene (graine, regles, mods, blocs) ; zone : rendu/zone.js ; donnees : moteur/donnees.js
import fs from 'node:fs';
import path from 'node:path';
import { Simulation, MOTEUR } from './simulation.js';
import { HoteMods, normaliserMod } from './mods.js';
import { installerFamilles } from './familles/index.js';
import { Regles } from './regles.js';
import { ErreurMonde } from './erreurs.js';
import { voulaisTu } from './util.js';
import { texteRapport } from './rapport.js';

export { MOTEUR, Simulation, ErreurMonde };
export const LIMITES_MODS = { fichiers: 8, octets: 64 * 1024 };

// Regles de la famille `monde` (declarees ici ; chaque famille declare les siennes dans son module)
export function declarerReglesMonde(regles) {
  regles.declarer('monde.ticksAleatoires', { def: 3, min: 0, max: 64, entier: true, doc: 'positions tirees par section de 16x16x16 et par tick (jeu : 3) ; 0 coupe les ticks aleatoires' });
  regles.declarer('monde.ralenti', { def: 1, min: 0.05, max: 1, doc: 'le monde avance a cette fraction du temps du film (ralenti d\'explosion)' });
  regles.declarer('monde.plafondVoisins', { def: 200000, min: 1000, max: 1000000, entier: true, doc: 'mises a jour de voisins enchainees par pose avant coupure (jeu : 1000000)' });
}

// Registre de regles complet (moteur + familles), sans monde : pour `mcanim regles --liste`
export function reglesPubliques(donnees) {
  const regles = new Regles();
  declarerReglesMonde(regles);
  installerFamilles({ bloc: () => ({ sur() { return this; }, entoure() { return this; } }), entite: () => ({ sur() { return this; }, entoure() { return this; } }), monde: { sur() { return this; } }, source: 'moteur' }, regles);
  void donnees;
  return regles;
}

// Lit les fichiers de mods cites par la scene (chemins relatifs au fichier de scene). Rend [{ nom, source }].
export function lireFichiersMods(liste, baseDir) {
  const out = [];
  (liste || []).forEach((f, i) => {
    const chemin = path.resolve(baseDir || process.cwd(), f);
    let octets;
    try { octets = fs.readFileSync(chemin); } catch { throw new ErreurMonde(`scene.monde.mods[${i}] : fichier introuvable : ${f} (chemin relatif au fichier de scene)`); }
    if (octets.length > LIMITES_MODS.octets) throw new ErreurMonde(`scene.monde.mods[${i}] : ${f} fait ${octets.length} octets (maximum ${LIMITES_MODS.octets})`);
    out.push({ nom: path.basename(f), source: normaliserMod(octets.toString('utf8')) });
  });
  return out;
}

// Prepare la simulation (familles, mods, regles, commandes) sans la lancer. Utile aux tests et a `mcanim mods verifier`.
export function preparer({ zone, donnees, monde = {}, mods = [], options = {} } = {}) {
  const config = {
    graine: monde.graine ?? 1, blocs: monde.blocs || [], regles: monde.regles, plafondMs: options.plafondMs,
  };
  const sim = new Simulation({ zone, donnees, config, monde: options.monde });
  declarerReglesMonde(sim.regles);
  installerFamilles(sim.reg, sim.regles);
  if (mods.length > LIMITES_MODS.fichiers) throw new ErreurMonde(`scene.monde.mods : ${LIMITES_MODS.fichiers} fichiers au maximum`);
  let hote = null;
  if (mods.length) {
    hote = new HoteMods(sim, options.hote);
    for (const m of mods) hote.charger(m.nom, m.source);
    sim.mods = hote;
    sim.replay.mods = mods.map((m) => m.nom);
  }
  sim.regles.appliquer(monde.regles);
  // commandes datees : verification des blocs (messages avec le chemin du champ)
  const noms = [...donnees.noms];
  config.blocs = (monde.blocs || []).map((b, i) => {
    const [t, x, y, z, bloc] = b;
    const id = donnees.etatId(bloc);
    if (id < 0) {
      const nom = String(bloc).replace(/^minecraft:/, '').replace(/\[.*$/, '');
      throw new ErreurMonde(`scene.monde.blocs[${i}][4] : bloc inconnu "${bloc}"${donnees.idBloc(nom) >= 0 ? ' (propriete ou valeur inconnue : ' + donnees.schema(donnees.idBloc(nom)).map(([n, v]) => `${n}=${v.join('|')}`).join(', ') + ')' : voulaisTu(nom, noms)}`);
    }
    return [t, x, y, z, bloc];
  });
  return sim;
}

// Simulation complete. `duree` : secondes de la scene. Rend { replay, sim, rapport }.
export function simuler({ zone, donnees, monde = {}, mods, baseDir, duree, options = {} }) {
  const sources = mods || lireFichiersMods(monde.mods, baseDir);
  const sim = preparer({ zone, donnees, monde, mods: sources, options });
  const ralenti = sim.regles.valeur('monde.ralenti', 1);
  const replay = sim.executer({ duree, ralenti });
  return { replay, sim, rapport: texteRapport({ sim, replay, duree }) };
}
