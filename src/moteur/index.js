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
import { Acteurs } from './acteurs.js';
import { solSous } from './collision.js';

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
export function preparer({ zone, donnees, monde = {}, mods = [], acteurs = [], options = {} } = {}) {
  const config = {
    graine: monde.graine ?? 1, blocs: monde.blocs || [], cmd: monde.cmd || [], regles: monde.regles, plafondMs: options.plafondMs, heure: options.heure, contenus: monde.contenus, meteo: options.meteo, creatures: options.creatures ?? null,
    fontaine: monde.fontaine ?? null,   // fontaine de l'End [x, y, z] : centre des cercles du dragon (ia-boss.js)
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
  if (acteurs.length) sim.acteurs = creerActeurs(sim, acteurs);
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
export function simuler({ zone, donnees, monde = {}, mods, acteurs = [], baseDir, duree, options = {} }) {
  const sources = mods || lireFichiersMods(monde.mods, baseDir);
  const sim = preparer({ zone, donnees, monde, mods: sources, acteurs, options });
  const ralenti = sim.regles.valeur('monde.ralenti', 1);
  const replay = sim.executer({ duree, ralenti });
  return { replay, sim, rapport: texteRapport({ sim, replay, duree }) };
}

// Acteurs simules (scene.acteurs avec `actes`) : descripteurs { nom, pos: [x, z] | [x, y, z], lacet, objet, actes: [{ t, verbe, ... }] }.
// Les temps sont en secondes de film ; le tick du monde vaut floor(t x 20 x ralenti).
export function creerActeurs(sim, descs) {
  const ralenti = sim.regles.valeur('monde.ralenti', 1);
  const liste = descs.map((d) => {
    const p = d.pos;
    const x = p[0], z = p.length === 3 ? p[2] : p[1];
    return { nom: d.nom, x, z, y: p.length === 3 ? p[1] : null, lacet: d.lacet ?? 0, objet: d.objet ?? null, vie: d.vie, invulnerable: d.invulnerable, ramasse: d.ramasse, faim: d.faim, sac: d.sac, gabarit: d.gabarit, typeCreature: d.typeCreature, ia: d.ia, actes: (d.actes || []).map((a) => ({ ...a, tick: Math.floor(a.t * 20 * ralenti + 1e-9) })) };
  });
  const lec = { etatEn: (x, y, z) => sim.monde.etatEn(x, y, z), d: sim.d };
  for (const a of liste) {
    if (a.y === null) {
      const h = sim.zone.hauteur(Math.floor(a.x), Math.floor(a.z));
      a.y = solSous(lec, a.x, a.z, h + 3, 0.5, 80) ?? h + 1;
    }
  }
  return new Acteurs(sim, liste);
}
