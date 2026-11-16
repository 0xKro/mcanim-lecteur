// Lumiere et ciel du shader a une heure donnee. Le ciel de base (couleurs, astres, etoiles, nuages) est celui du jeu (rendu/ciel-vanille.js) :
// ici on calcule (1) la direction de la lumiere du monde, qui suit le soleil du jeu (ou sa lune la nuit), (2) la lumiere du monde sans ombres,
// (3) les MODIFICATIONS du ciel demandees par le fichier (couleurs, taille des astres, etoiles, nuages...).
import { angleSoleil, reperes, ticksDepuisHeure } from '../rendu/ciel-vanille.js';

const borne = (x, a, b) => (x < a ? a : x > b ? b : x);
const lisse = (a, b, x) => { const t = borne((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// r : valeurs a l'heure (evaluerShader) ; heure : ciel.heure de la scene (undefined = midi)
// Retourne { heure, soleilDir, lumDir (direction de la lumiere directe : soleil le jour, lune la nuit, ou null), directe (0..1), sunC, ambC, part, minimum, mult }.
export function etatCiel(r, actif, heure) {
  const h = heure ?? 12;
  const ticks = ticksDepuisHeure(h), incl = r['ciel.inclinaisonTrajet'];
  const sol = reperes(angleSoleil(ticks), incl).n;
  const out = { heure: h, soleilDir: sol };
  const lune = sol.map((x) => -x);
  const jour = lisse(0.0, 0.2, sol[1]), nuit = lisse(0.0, 0.2, lune[1]) * (1 - jour);
  if (jour > 0.001) { out.lumDir = sol; out.directe = jour; } else if (nuit > 0.001) { out.lumDir = lune; out.directe = nuit * 0.3; } else { out.lumDir = null; out.directe = 0; }
  const IS = r['lumiere.intensiteSoleil'], IA = r['lumiere.intensiteAmbiante'], p = borne(r['lumiere.partDirecte'], 0, 1) * out.directe;
  out.sunC = r['lumiere.soleil'].map((v) => v * IS); out.ambC = r['lumiere.ambiante'].map((v) => v * IA);
  out.part = p; out.minimum = r['lumiere.minimum'];
  // lumiere sans ombres : ambiante pour (1-p), soleil pour p (p = 0 sans lumiere directe : toute la lumiere est l'ambiante)
  out.mult = [0, 1, 2].map((i) => (1 - p) * out.ambC[i] + p * out.sunC[i]);
  void actif;
  return out;
}

// Modifications du ciel du jeu (voir ciel-vanille.js, construireParams). Les valeurs "null" gardent celles du jeu.
export function modsCiel(r) {
  const c255 = (c) => (c ? c.map((v) => v * 255) : null);
  const corps = (n) => ({ visible: r[`ciel.${n}.visible`], taille: r[`ciel.${n}.taille`], rond: n === 'lune' ? false : r['ciel.soleil.forme'] === 'rond', couleur: r[`ciel.${n}.couleur`], halo: r[`ciel.${n}.halo`], haloRayon: n === 'lune' ? 6 : r['ciel.soleil.haloRayon'] });
  return {
    zenith: c255(r['ciel.zenith']), horizon: c255(r['ciel.horizon']), bas: c255(r['ciel.bas']),
    teinte: r['ciel.teinte'], intensite: r['ciel.intensite'], lueur: r['ciel.lueurCrepuscule'], incl: r['ciel.inclinaisonTrajet'],
    soleil: corps('soleil'), lune: corps('lune'), phases: r['ciel.lune.phases'],
    etoiles: { dens: r['ciel.etoiles.densite'], lum: r['ciel.etoiles.luminosite'], couleur: r['ciel.etoiles.couleur'] },
    nuages: { style: r['nuages.style'], altitude: r['nuages.altitude'], vitesse: r['nuages.vitesse'], couleur: r['nuages.couleur'], opacite: r['nuages.opacite'] },
  };
}
