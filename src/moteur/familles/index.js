// Familles de mecaniques integrees. Chacune exporte `installer(mc, regles)` et s'enregistre par la meme API que les mods.
import * as torches from './torches.js';
import * as herbe from './herbe.js';

export const FAMILLES = { torches, herbe };

export function installerFamilles(reg, regles) {
  const mc = { bloc: (s) => reg.bloc(s), entite: (s) => reg.entite(s), get monde() { return reg.monde; } };
  reg.source = 'moteur';
  for (const f of Object.values(FAMILLES)) f.installer(mc, regles);
}
