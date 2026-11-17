// Meteo de la scene : piste `ciel.meteo` = liste d'ordres [t, "clair" | "pluie" | "orage" [, secondes de transition]] et de coups de foudre [t, "foudre" [, x, y, z]].
// Ce fichier ne fait que LIRE la piste et calculer les niveaux de pluie et d'orage a un instant (pas de moteur) : il sert a la simulation, au ciel, au dessin de la pluie,
// aux sons et au chemin du vrai pack de shaders (rainStrength, thunderStrength, wetness).
//   Niveaux du jeu (Level.getRainLevel / getThunderLevel) : pluie 0..1, orage 0..1 ; le jeu les fait varier de 0,01 par tick : 5 secondes de 0 a 1 (transition par defaut).
//   Assombrissement du ciel du jeu : lumiere du ciel x (1 - pluie x 5/16) x (1 - orage x 5/16) ; ciel et brume ternes (voir cielMeteo).
import { voulaisTu } from '../moteur/util.js';

export const ETATS_METEO = ['clair', 'pluie', 'orage'];
const CIBLES = { clair: [0, 0], pluie: [1, 0], orage: [1, 1] };
export const MAX_ORDRES_METEO = 100;
export const TRANSITION_DEFAUT = 5;      // secondes (le jeu : 0,01 par tick)

// brut : la valeur de `ciel.meteo` ; erreur(chemin, message) leve ; duree : secondes de la scene. Rend { etats: [{ t, etat, trans }], foudres: [{ t, x?, y?, z? }] }
export function lireMeteo(brut, ch, erreur, duree) {
  if (!Array.isArray(brut) || brut.length === 0) erreur(ch, 'liste d\'ordres attendue, par exemple [[0, "clair"], [2, "pluie"], [8, "orage"], [10, "foudre", 120, 300]]');
  if (brut.length > MAX_ORDRES_METEO) erreur(ch, `${MAX_ORDRES_METEO} ordres au maximum`);
  const etats = [], foudres = [];
  let prec = -1;
  brut.forEach((k, i) => {
    const c = `${ch}[${i}]`;
    if (!Array.isArray(k) || k.length < 2) erreur(c, 'forme attendue : [temps, "pluie"] ou [temps, "orage", secondes de transition] ou [temps, "foudre", x, y, z]');
    const [t, mot, ...args] = k;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > duree) erreur(`${c}[0]`, `temps entre 0 et ${duree} secondes attendu`);
    if (t < prec) erreur(`${c}[0]`, 'les ordres doivent etre classes par temps croissant');
    prec = t;
    if (mot === 'foudre') {
      if (args.length !== 0 && args.length !== 2 && args.length !== 3) erreur(c, 'foudre : sans point (au hasard), avec x, z (au sol) ou avec x, y, z, par exemple [10, "foudre", 120, 300]');
      if (args.length >= 2 && !args.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 30000000)) erreur(c, 'foudre : x, y, z sont des nombres');
      foudres.push(args.length === 3 ? { t, x: args[0], y: args[1], z: args[2] } : args.length === 2 ? { t, x: args[0], z: args[1] } : { t });
      return;
    }
    if (!ETATS_METEO.includes(mot)) erreur(`${c}[1]`, `etat inconnu ${JSON.stringify(mot)}${voulaisTu(String(mot), [...ETATS_METEO, 'foudre'])} (permis : ${ETATS_METEO.join(', ')}, foudre)`);
    if (args.length > 1 || (args.length === 1 && !(typeof args[0] === 'number' && args[0] >= 0 && args[0] <= 600))) erreur(c, 'transition : un nombre de secondes entre 0 et 600 attendu apres l\'etat');
    etats.push({ t, etat: mot, trans: args.length ? args[0] : TRANSITION_DEFAUT });
  });
  return { etats, foudres };
}

// Niveaux { pluie, orage } a l'instant t (secondes de film) : de l'etat precedent vers la cible, lineaire pendant `trans`
export function niveauxMeteo(meteo, t) {
  if (!meteo || !meteo.etats.length) return { pluie: 0, orage: 0 };
  let v = [0, 0];
  const E = meteo.etats;
  for (let i = 0; i < E.length; i++) {
    const e = E[i];
    if (t < e.t) break;
    const cible = CIBLES[e.etat], u = e.trans > 0 ? Math.min(1, (t - e.t) / e.trans) : 1;
    const fin = [v[0] + (cible[0] - v[0]) * u, v[1] + (cible[1] - v[1]) * u];
    if (i + 1 < E.length && t >= E[i + 1].t) { const u2 = e.trans > 0 ? Math.min(1, (E[i + 1].t - e.t) / e.trans) : 1; v = [v[0] + (cible[0] - v[0]) * u2, v[1] + (cible[1] - v[1]) * u2]; continue; }
    return { pluie: fin[0], orage: fin[1] };
  }
  return { pluie: v[0], orage: v[1] };
}

// Facteur de lumiere du ciel du jeu pour ces niveaux : (1 - pluie x 5/16) x (1 - orage x 5/16)
export const facteurCielMeteo = ({ pluie, orage }) => (1 - pluie * 5 / 16) * (1 - orage * 5 / 16);

// Couleur de ciel ou de brume (RGB 0..255) ternie par la meteo (Level.getSkyColor : melange vers un gris x 0,6 puis x 0,2 par temps d'orage ; FogRenderer pour la brume)
export function ternir(rgb, { pluie, orage }, brume = false) {
  let [r, g, b] = rgb;
  if (pluie > 0) {
    if (brume) { const f = 1 - pluie * 0.5, f1 = 1 - pluie * 0.4; r *= f; g *= f; b *= f1; } else {
      const f = pluie * 0.75, gris = (r * 0.3 + g * 0.59 + b * 0.11) * 0.6;
      r = r * (1 - f) + gris * f; g = g * (1 - f) + gris * f; b = b * (1 - f) + gris * f;
    }
  }
  if (orage > 0) {
    if (brume) { const f = 1 - orage * 0.5; r *= f; g *= f; b *= f; } else {
      const f = orage * 0.75, gris = (r * 0.3 + g * 0.59 + b * 0.11) * 0.2;
      r = r * (1 - f) + gris * f; g = g * (1 - f) + gris * f; b = b * (1 - f) + gris * f;
    }
  }
  return [r, g, b];
}
