// Famille "joueur" : parametres des acteurs simules (moteur/acteurs.js) et du minage (moteur/cassage.js). Rien d'autre ici : la logique est dans
// les acteurs ; ce fichier declare les regles pour `mcanim regles --liste joueur` et pour monde.regles.
import { declarerRegles as reglesIA } from '../ia.js';
export function installer(mc, regles) {
  reglesIA(regles);   // monde.difficulte, ia.*, combat.* (moteur/ia.js)
  void mc;
  regles.declarer('joueur.portee', { def: 4.5, min: 1, max: 100, doc: 'portee des mains en blocs, de l\'oeil au bloc (jeu : 4,5 en survie, 5 en creatif) ; utilise, pose et casse' });
  regles.declarer('casser.vitesse', { def: 1, min: 0, max: 1000, doc: 'multiplicateur de la vitesse de minage (1 = jeu ; 0 = on ne casse rien ; 1000 = instantane)' });
  regles.declarer('elytres.auto', { def: true, doc: 'un acteur qui porte des elytres et tombe de plus de elytres.autoChute blocs les ouvre seul (comme un joueur qui appuie sur saut en l air) ; false : seulement le verbe plane ou saute en l air' });
  regles.declarer('elytres.autoChute', { def: 2, min: 0, max: 100, doc: 'hauteur de chute (blocs) apres laquelle elytres.auto ouvre les elytres (notre choix de mise en scene : un saut ordinaire ne les ouvre pas)' });
  regles.declarer('elytres.usure', { def: true, doc: 'les elytres s usent comme dans le jeu : 1 point toutes les 20 ticks de vol, plus de vol a 431 sur 432 (champ d acteur usureElytres : usure de depart)' });
  regles.declarer('casser.delai', { def: 5, min: 0, max: 100, entier: true, doc: 'ticks d\'attente apres un bloc casse avant de commencer le suivant (jeu : 5)' });
}
