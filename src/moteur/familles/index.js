// Familles de mecaniques integrees. Chacune exporte `installer(mc, regles)` et s'enregistre par la meme API que les mods.
import * as torches from './torches.js';
import * as herbe from './herbe.js';
import * as portes from './portes.js';
import * as boutons from './boutons.js';
import * as conteneurs from './conteneurs.js';
import * as pose from './pose.js';
import * as joueur from './joueur.js';
import * as chute from './chute.js';
import * as tnt from './tnt.js';
import * as feu from './feu.js';
import * as fluides from './fluides.js';
import * as objets from './objets.js';
import * as redstone from './redstone.js';
import * as pistons from './pistons.js';
import * as contenus from './contenus.js';

export const FAMILLES = { torches, herbe, portes, boutons, conteneurs, pose, joueur, chute, tnt, feu, fluides, objets, redstone, pistons, contenus };

export function installerFamilles(reg, regles) {
  const mc = { bloc: (s) => reg.bloc(s), entite: (s) => reg.entite(s), get monde() { return reg.monde; }, donnees: reg.d };
  reg.source = 'moteur';
  for (const f of Object.values(FAMILLES)) f.installer(mc, regles);
}
