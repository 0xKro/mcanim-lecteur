// Famille "meteo" : regles de la pluie, de la neige, du gel et de la foudre (mecaniques dans moteur/meteo.js). La piste de la scene est `ciel.meteo` (docs/SIMULATION.md partie 13).
// Evenement du monde : `meteo.foudre` (ev.pos). API : monde.pleut(x, y, z) (Level.isRainingAt), monde.foudre(x, y, z), monde.niveauxMeteo() -> { pluie, orage }.
export function installer(mc, regles) {
  void mc;
  regles.declarer('meteo.actif', { def: true, doc: "la meteo agit sur le monde : le feu s'eteint sous la pluie, la terre labouree s'humidifie, la neige se pose, l'eau gele, la foudre tombe" });
  regles.declarer('meteo.foudre', { def: 1, min: 0, max: 100000, doc: "multiplicateur de la frequence des coups de foudre au hasard par temps d'orage (jeu : 1 = 1 chance sur 100 000 par colonne et par tick ; 20000 : environ un coup par seconde)" });
  regles.declarer('meteo.foudreFeu', { def: true, doc: 'un coup de foudre allume du feu (jeu : oui en difficulte normale ou difficile)' });
  regles.declarer('meteo.foudreDegats', { def: 5, min: 0, max: 1000, doc: "degats d'un coup de foudre aux acteurs a moins de 3 blocs (jeu : 5)" });
  regles.declarer('meteo.neigeMax', { def: 1, min: 0, max: 8, entier: true, doc: "couches de neige que la chute de neige empile (jeu : regle snowAccumulationHeight = 1)" });
  regles.declarer('meteo.gel', { def: true, doc: "l'eau gele dans les biomes froids quand la meteo est active (jeu : oui)" });
}
