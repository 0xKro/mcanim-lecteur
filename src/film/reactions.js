// Reactions automatiques du corps (additives, petites) aux evenements de la physique : decollage, vol, atterrissage.
// Elles s'ajoutent aux pistes et boucles de l'acteur ; `reactions: false` les coupe. Valeurs : NOS choix d'animation, tires de la
// vitesse et de la hauteur du jeu (physique.js), voir DERIVATION.md "Reactions automatiques".
import { lisser01 } from './physique.js';

export const AVANT_DECOLLAGE = 0.14;   // s : genoux qui plient avant de pousser
export const DUREE_EXTENSION = 0.10;   // s : la poussee (genoux qui se tendent) apres le decollage
export const DUREE_BRAS = 0.35;        // s : les bras se levent apres le decollage
export const ATTAQUE = 0.07;           // s : le genou plie jusqu'a la profondeur voulue a l'atterrissage
const PROF_MIN = 12, PROF_MAX = 95;    // degres de flexion de genou a l'atterrissage

// Profondeur (degres de genou) selon la vitesse d'arrivee (blocs par tick) : saut plat 0,34 -> 30 ; chute de 1 bloc 0,30 -> 25 ; 3 blocs 0,65 -> 70 ; 5 blocs 0,87 -> 95.
export const profondeurAtterrissage = (impact) => Math.min(PROF_MAX, Math.max(PROF_MIN, 18 + 130 * (impact - 0.25)));
// Duree de la remontee : 0,18 s pour un petit choc, 0,30 s pour un choc profond.
export const dureeRemontee = (profondeur) => 0.18 + 0.12 * Math.min(1, profondeur / 80);

// Forme de l'atterrissage au temps tau apres le contact : 0 -> 1 en ATTAQUE, puis 1 -> 0 en dureeRemontee.
export function formeAtterrissage(tau, profondeur) {
  if (tau < 0) return 0;
  if (tau < ATTAQUE) return lisser01(tau / ATTAQUE);
  const rec = dureeRemontee(profondeur);
  return tau < ATTAQUE + rec ? 1 - lisser01((tau - ATTAQUE) / rec) : 0;
}

// Reactions au temps du monde tm : null si rien n'est a ajouter.
// { genou, jambe (avant), bras (avant), coude, corps (penche), air (0..1), amortiJambes, amortiBras, descente (blocs : marge de l'appui) }
export function reactionsA(sim, tm) {
  const st = sim.etatA(tm);
  const air = st.eau || st.echelle || st.imp ? 0 : st.air;
  let prep = 0, bras = 0;
  for (const d of sim.decollages) {
    const tau = tm - d.tw;
    if (tau >= -AVANT_DECOLLAGE && tau < 0) prep = Math.max(prep, lisser01((tau + AVANT_DECOLLAGE) / AVANT_DECOLLAGE));
    else if (tau >= 0 && tau < DUREE_EXTENSION) prep = Math.max(prep, 1 - lisser01(tau / DUREE_EXTENSION));
    if (tau >= 0 && tau < DUREE_BRAS) bras = Math.max(bras, Math.sin(Math.PI * tau / DUREE_BRAS));
  }
  let flex = 0;            // profondeur de genou de l'atterrissage (degres)
  for (const a of sim.atterrissages) {
    if (a.impact < 0.15) continue;
    const tau = tm - a.tw;
    if (tau < 0 || tau > ATTAQUE + dureeRemontee(PROF_MAX)) continue;
    const D = profondeurAtterrissage(a.impact);
    flex = Math.max(flex, D * formeAtterrissage(tau, D));
  }
  if (air < 1e-3 && prep < 1e-3 && bras < 1e-3 && flex < 0.05) return null;
  return {
    genou: 22 * air + 32 * prep + flex,
    jambe: -8 * air + 10 * prep + 0.45 * flex,
    bras: 10 * air + 28 * bras + 0.3 * flex,
    coude: 18 * air + 0.25 * flex,
    corps: 3 * prep + 0.2 * flex,
    air, amortiJambes: 1 - 0.75 * air, amortiBras: 1 - 0.4 * air,
    descente: flex / PROF_MAX * 0.30,
  };
}
