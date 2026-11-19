// Point d'entree du moteur de simulation. Charge UNIQUEMENT quand une scene a un champ `monde` (import() dynamique) : une scene
// sans `monde` ne paie rien et ne change pas d'un bit.
//
//   const { replay, sim, rapport } = await simuler({ zone, donnees, monde, duree, baseDir })
//   monde : le champ `monde` de la scene (graine, regles, mods, blocs) ; zone : rendu/zone.js ; donnees : moteur/donnees.js
import fs from 'node:fs';
import path from 'node:path';
import { Simulation, MOTEUR } from './simulation.js';
import { HoteMods, normaliserMod, collecterDefinitions } from './mods.js';
import { donneesAvecPerso, appliquerEntitesPerso } from './perso.js';
import { installerFamilles } from './familles/index.js';
import { Regles } from './regles.js';
import { ErreurMonde } from './erreurs.js';
import { voulaisTu } from './util.js';
import { texteRapport, texteSonde } from './rapport.js';
import { Acteurs } from './acteurs.js';
import { solSous } from './collision.js';
import { Enchanteur } from './enchantements.js';
import { chargerObjetsJeu, racineObjetsLocale } from './objets-jeu.js';
import { Alambics } from './alambic.js';
import { Nuages } from './nuage.js';
import { Aleatoire } from './aleatoire.js';
import { allumerActeur } from './projectiles.js';
import { rafale, RAFALE } from './vent.js';

// Objets du jeu dans la simulation (docs/SIMULATION.md partie 26) : donnees du kit (recettes, enchantements ; null sans le groupe `recettes`),
// enchanteur, alambics, nuages ; crochets que les enchantements et les effets appellent (feu, foudre, rafale, hasard d'une graine)
// Donnees d'objets du kit de la scene (groupe `recettes`), sinon une copie locale du jeu (MCANIM_OBJETS_JEU, dossier prepare) ; null sinon
// racine : dossier deja trouve par le processus du lecteur (le fils des mods ne lit que ce qu'on lui permet : moteur/isolement.js)
export function objetsDuKit(kitDir, racine = null) {
  try { if (kitDir) return chargerObjetsJeu(kitDir); } catch { /* kit sans le groupe recettes */ }
  try { if (racine) return chargerObjetsJeu(racine); } catch { /* dossier illisible */ }
  try { const r = racineObjetsLocale(); return r ? chargerObjetsJeu(r) : null; } catch { return null; }   // processus fils : lecture refusee hors du kit
}
export function installerObjetsJeu(sim, objetsJeu) {
  sim.objetsJeu = objetsJeu;
  // objets qui brillent sans enchantement (composant enchantment_glint_override : pomme en or enchantee, livre enchante...) : lus par le film
  const forces = Object.entries(sim.d.j.objets ?? {}).filter(([, o]) => o[12] === 1).map(([k]) => k);
  if (forces.length) sim.replay.refletsForces = forces;
  sim.enchant = new Enchanteur(sim);
  sim.alambics = new Alambics(sim);
  sim.nuages = new Nuages(sim);
  sim.nouvelAleatoire = (g) => new Aleatoire(g);
  sim.allumerEntite = (a, ticks) => { if (a && typeof a === 'object' && a.mort < 0) allumerActeur(a, ticks); };
  sim.foudreEn = (x, y, z) => { if (sim.meteo) sim.meteo.foudre(Math.floor(x), Math.floor(z), Math.floor(y), {}); else sim.avertir('foudre (Canalisation) sans meteo : ajoute ciel.meteo a la scene'); };
  sim.rafale = (x, y, z, { rayon, recul }) => { RAFALE.__enchant = { rayon, recul }; rafale(sim, [x, y, z], '__enchant'); };
}

export { MOTEUR, Simulation, ErreurMonde };
export const LIMITES_MODS = { fichiers: 8, octets: 64 * 1024 };

// Regles de la famille `monde` (declarees ici ; chaque famille declare les siennes dans son module)
export function declarerReglesMonde(regles) {
  regles.declarer('monde.ticksAleatoires', { def: 3, min: 0, max: 64, entier: true, doc: 'positions tirees par section de 16x16x16 et par tick (jeu : 3) ; 0 coupe les ticks aleatoires' });
  regles.declarer('monde.ralenti', { def: 1, min: 0.05, max: 1, doc: 'le monde avance a cette fraction du temps du film (ralenti d\'explosion)' });
  regles.declarer('monde.plafondVoisins', { def: 200000, min: 1000, max: 1000000, entier: true, doc: 'mises a jour de voisins enchainees par pose avant coupure (jeu : 1000000)' });
  // Rendu SEULEMENT (lu par rendu/scene.js -> rendu/ciel-vanille.js tableLumiere) : la simulation n'en tient aucun compte, les niveaux de lumiere
  // du jeu (apparition des monstres, pousse des cultures, neige qui fond, capteur de lumiere) restent exacts.
  regles.declarer('lumiere.blocs', { def: 1, min: 0, max: 3, doc: 'RENDU seulement : multiplie l\'eclat de la lumiere des blocs dans l\'image (1 = le jeu ; 2 ou 3 pour une grande salle de chateau) ; les niveaux de lumiere du jeu (monstres, cultures) ne changent pas' });
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
  // blocs et entites definis par les mods (moteur/perso.js) : premiere lecture des mods, puis tables du jeu de la scene
  const definitions = mods.length ? collecterDefinitions(mods.slice(0, LIMITES_MODS.fichiers), donnees, options.typesCreatures ?? null, options.hote) : { blocs: [], entites: [] };
  donnees = donneesAvecPerso(donnees, definitions.blocs);
  const config = {
    graine: monde.graine ?? 1, blocs: monde.blocs || [], cmd: monde.cmd || [], regles: monde.regles, plafondMs: options.plafondMs, heure: options.heure, contenus: monde.contenus, meteo: options.meteo, creatures: options.creatures ?? null,
    fontaine: monde.fontaine ?? null,   // fontaine de l'End [x, y, z] : centre des cercles du dragon (ia-boss.js)
    dimension: monde.dimension ?? 'overworld',   // monde de l'End : pas d'assombrissement du ciel, ni pluie, ni foudre (environnement.js)
    pupitres: monde.pupitres ?? [], balises: monde.balises ?? [], cadres: monde.cadres ?? [],   // pupitres, balises, cadres (docs/SIMULATION.md partie 27)
    kitDir: options.kitDir ?? null,      // kit de l'utilisateur : caracteristiques du jeu (arbres, champignons geants : caracteristiques.js)
  };
  const sim = new Simulation({ zone, donnees, config, monde: options.monde });
  installerObjetsJeu(sim, options.objetsJeu !== undefined ? options.objetsJeu : objetsDuKit(options.kitDir, options.racineObjets ?? null));   // recettes, enchantements, alambics, nuages de potion (partie 26)
  sim.persoEntites = definitions.entites; sim.definitions = definitions;
  const tr = options.diagnostic?.trace;   // mcanim simuler --trace x,y,z
  if (Array.isArray(tr) && tr.length === 3 && tr.every(Number.isInteger)) sim.suivre(tr[0], tr[1], tr[2]);
  if (definitions.blocs.length || definitions.entites.length) sim.replay.perso = definitions;   // le rendu en a besoin (modeles, textures, echelle)
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
  if (acteurs.length) sim.acteurs = creerActeurs(sim, appliquerEntitesPerso(acteurs, definitions.entites));
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
// options.diagnostic (docs/SIMULATION.md partie 33) : { tout } (rapport complet, sans plafond), { trace: [x, y, z] } (changements de la cellule
// tick a tick, avec leur cause), { sonde: { t, pos: [x, y, z] } } (la simulation s'arrete a l'instant t ; le rapport est l'etat de la cellule :
// mcanim etat --bloc).
export function simuler({ zone, donnees, monde = {}, mods, acteurs = [], baseDir, duree, options = {} }) {
  const sources = mods || lireFichiersMods(monde.mods, baseDir);
  const sim = preparer({ zone, donnees, monde, mods: sources, acteurs, options });
  const ralenti = sim.regles.valeur('monde.ralenti', 1);
  const dg = options.diagnostic ?? {};
  if (dg.sonde) {
    const tick = Math.floor(Math.min(dg.sonde.t, duree) * 20 * ralenti + 1e-9);
    const replay = sim.executer({ duree, ralenti, jusqua: tick });
    return { replay, sim, rapport: texteSonde(sim, dg.sonde.pos, tick) };
  }
  const replay = sim.executer({ duree, ralenti });
  return { replay, sim, rapport: texteRapport({ sim, replay, duree, tout: !!dg.tout }) };
}

// Blocs d'une zone (deja decoree) que le jeu casserait faute d'appui (canSurvive faux) : `mcanim decor verifier`. `avant` : la zone d'avant le decor
// (seules les cellules changees par le decor sont regardees). Rend [{ nom, x, y, z }] (`max` au plus) et le nombre total.
export function blocsSansAppui({ zone, avant = null, donnees, max = 200 }) {
  const sim = preparer({ zone, donnees, monde: {}, options: { objetsJeu: null } });
  const d = sim.d, pal = zone.palette, cand = new Map();
  const candidat = (p) => {
    let c = cand.get(p);
    if (c === undefined) { const e = d.etatId(pal[p]); c = e >= 0 && sim.reg.a('survit', d.blocDe(e)) && d.prop(e, 'half') !== 'upper'; cand.set(p, c); }
    return c;
  };
  const liste = [];
  let n = 0;
  for (let ly = 0; ly < zone.sy; ly++) for (let lz = 0; lz < zone.sz; lz++) for (let lx = 0; lx < zone.sx; lx++) {
    const p = zone.cellules[(ly * zone.sz + lz) * zone.sx + lx];
    if (!candidat(p)) continue;
    const x = zone.x0 + lx, y = zone.y0 + ly, z = zone.z0 + lz;
    if (avant && avant.bloc(x, y, z) === pal[p]) continue;   // pas pose par le decor
    if (sim.survit(x, y, z)) continue;
    n++;
    if (liste.length < max) liste.push({ nom: pal[p].replace(/^minecraft:/, '').replace(/\[.*$/, ''), x, y, z });
  }
  return { liste, total: n };
}

// Acteurs simules (scene.acteurs avec `actes`) : descripteurs { nom, pos: [x, z] | [x, y, z], lacet, objet, actes: [{ t, verbe, ... }] }.
// Les temps sont en secondes de film ; le tick du monde vaut floor(t x 20 x ralenti).
export function creerActeurs(sim, descs) {
  const ralenti = sim.regles.valeur('monde.ralenti', 1);
  const liste = descs.map((d) => {
    const p = d.pos;
    const x = p[0], z = p.length === 3 ? p[2] : p[1];
    return { nom: d.nom, x, z, y: p.length === 3 ? p[1] : null, lacet: d.lacet ?? 0, objet: d.objet ?? null, vie: d.vie, invulnerable: d.invulnerable, ramasse: d.ramasse, faim: d.faim, sac: d.sac, mode: d.mode, niveaux: d.niveaux, saturation: d.saturation, gauche: d.gauche, gabarit: d.gabarit, typeCreature: d.typeCreature, ia: d.ia, armure: d.armure, protectionExplosion: d.protectionExplosion, persoDef: d.persoDef, monture: d.monture ?? null, wagon: d.wagon ?? null, actes: (d.actes || []).map((a) => ({ ...a, tick: Math.floor(a.t * 20 * ralenti + 1e-9) })) };
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
