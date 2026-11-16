// "Look" d'une image : valeurs des pistes `image` et `ciel` au temps t, converties en reglages pour le rendu.
// Voir docs/CONCEPTION.md ("Image", "Ciel et lumiere"). Aucune ambiance preparee : seulement des leviers numeriques.
import { evaluer } from './scene.js';
import { normaliserImage, imageActive } from '../rendu/post.js';
import { lumiereMonde, ticksDepuisHeure } from '../rendu/ciel-vanille.js';

const lerp = (a, b, u) => a + (b - a) * u;
const melange3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const borne = (x, a, b) => (x < a ? a : x > b ? b : x);

// ---------------------------------------------------------------- image (post-traitement)
// Retourne les reglages normalises au temps t, ou null si tout est neutre (alors le rendu ne fait rien du tout).
export function imageEn(scene, t) {
  const im = scene.image;
  if (!im) return null;
  const v = (nom) => (im[nom] ? evaluer(im[nom], t) : undefined);
  const p = normaliserImage({
    saturation: v('saturation')?.[0], contraste: v('contraste')?.[0], luminosite: v('luminosite')?.[0],
    teinte: v('teinte'), vignette: v('vignette')?.[0], flou: v('flou')?.[0], fondu: v('fondu'),
  });
  return imageActive(p) ? p : null;
}

// ---------------------------------------------------------------- ciel et lumiere
// Courbe jour/nuit. L'analyse (analyse/1-monde-lumiere.md, 6.4) ne donne que le NOM `sky_darken` (environment.rs:1025), pas ses
// valeurs : on prend la courbe du jeu de base `getSunBrightness` telle qu'on la connait (a verifier) :
//   angle = (heure - 12) / 24 tours ; g = borne(cos(angle) * 2 + 0.5, 0, 1)
// g vaut 1 de 7 h a 17 h environ, 0.5 a 6 h et 18 h (lever, coucher), 0 de 19 h a 5 h environ.
export function luminositeCiel(heure) {
  const g = borne(Math.cos(((heure - 12) / 24) * 2 * Math.PI) * 2 + 0.5, 0, 1);
  return { g, crepuscule: 1 - Math.abs(2 * g - 1) };
}

const JOUR = { zenith: [120, 167, 255], horizon: [192, 216, 255], bas: [170, 195, 235] };   // valeurs par defaut du rendu (midi)
const NUIT = { zenith: [6, 9, 28], horizon: [16, 22, 48], bas: [10, 14, 32] };
const CREPUSCULE = { zenith: [70, 80, 150], horizon: [255, 150, 95], bas: [120, 100, 110] };
const TEINTE_NUIT = [0.55, 0.65, 1], TEINTE_CREPUSCULE = [1, 0.78, 0.6];
const FACTEUR_NUIT = 0.12;   // part de la lumiere du jour qui reste a minuit

// Heure (0..24) -> { ciel: {zenith, horizon, bas} (0..255), brume: couleur, lumiere: [r,g,b] (facteur terrain), soleil: direction | false }
// 12 h = les valeurs par defaut du rendu, exactement.
// Options (shader.json) : lueur = multiplicateur du rouge/orange du crepuscule, inclinaison = degres (rotation de la course du soleil autour de l'axe est-ouest,
// positif = le soleil de midi bascule vers le sud, +z). Sans options le resultat est celui d'avant, exactement.
export function cielDepuisHeure(heure, { lueur = 1, inclinaison = 0 } = {}) {
  const { g, crepuscule: tw0 } = luminositeCiel(heure);
  const tw = lueur === 1 ? tw0 : Math.min(1, tw0 * lueur);
  const ciel = {};
  for (const c of ['zenith', 'horizon', 'bas']) {
    const base = melange3(NUIT[c], JOUR[c], g);
    ciel[c] = melange3(base, CREPUSCULE[c], tw * (c === 'horizon' ? 0.85 : 0.5));
  }
  const f = FACTEUR_NUIT + (1 - FACTEUR_NUIT) * g;
  const teinte = melange3(melange3(TEINTE_NUIT, [1, 1, 1], g), TEINTE_CREPUSCULE, tw * 0.6);
  // soleil : se leve a l'est (+x) a 6 h, au zenith a midi ; a midi on retrouve la direction par defaut du rendu
  const a = ((heure - 12) / 24) * 2 * Math.PI;
  const d = [0.35 * Math.cos(a) - 0.9 * Math.sin(a), 0.8 * Math.cos(a), -0.45 * Math.cos(a)];
  const n = Math.hypot(...d);
  let dir = d.map((x) => x / n);
  if (inclinaison) { const c = Math.cos((inclinaison * Math.PI) / 180), si = Math.sin((inclinaison * Math.PI) / 180); dir = [dir[0], dir[1] * c - dir[2] * si, dir[1] * si + dir[2] * c]; }
  const soleil = dir[1] > -0.02 ? dir : false;
  void f; void teinte;
  // lumiere du monde : pistes sky_light_factor et sky_light_color du jeu (1 le jour, 0,24 bleute la nuit)
  return { ciel, brume: ciel.horizon, lumiere: lumiereMonde(ticksDepuisHeure(heure)), soleil, soleilDir: dir, g, crepuscule: tw0 };
}

// Reglages de rendu au temps t, ou null si la scene n'a pas de `ciel` : { lumiere, ciel, brume, soleil } (chaque champ peut manquer).
export function cielEn(scene, t) {
  const c = scene.ciel;
  if (!c) return null;
  const v = (nom) => (c[nom] ? evaluer(c[nom], t) : undefined);
  const sortie = {};
  const heure = v('heure')?.[0];
  if (heure !== undefined) sortie.heure = heure;
  const jour = v('jour')?.[0];   // numero du jour : phase de la lune (0 = pleine lune)
  if (jour !== undefined) sortie.jour = jour;
  let lumiere = [1, 1, 1];
  if (heure !== undefined) {
    const d = cielDepuisHeure(heure);
    sortie.ciel = d.ciel; sortie.brume = { couleur: d.brume }; sortie.soleil = d.soleil; lumiere = d.lumiere;
  }
  const col = v('couleurCiel');
  if (col) {
    const rgb = col.map((x) => x * 255);
    sortie.ciel = { zenith: rgb, horizon: rgb, bas: rgb };
    sortie.brume = { ...(sortie.brume || {}), couleur: rgb };
    sortie.soleil = false; sortie.fixe = true;
  }
  const dist = v('brume')?.[0];
  if (dist !== undefined) sortie.brume = { ...(sortie.brume || {}), debut: dist };
  const fac = v('lumiere')?.[0];
  if (fac !== undefined) lumiere = lumiere.map((x) => x * fac);
  sortie.lumiere = lumiere;
  return sortie;
}
