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
  regles.declarer('meteo.chaudrons', { def: true, doc: "la pluie remplit les chaudrons d'eau, la neige de neige poudreuse (jeu : 1 chance sur 20, 1 sur 10 sous la neige, par tirage de la colonne)" });
  // IceBlock.randomTick (Horizon level/tick.rs) : la glace fond (eau ; air dans le Nether) quand la lumiere de bloc depasse 11 - son opacite
  mc.bloc('ice').sur('tickAleatoire', (ev, monde) => {
    if (!monde.regle('meteo.fonte', true)) return;
    const [x, y, z] = ev.pos;
    if (monde.lumiere(x, y, z).bloc > 11 - monde.opacite(x, y, z)) { monde.poser(x, y, z, 'minecraft:water', 3); monde.dire(`glace fondue en ${x},${y},${z}`); }
  });
  // piege du cheval squelette (ServerLevel.tickThunder) et difficulte locale (DifficultyInstance) : moteur/meteo.js
  if (!regles.decl?.has('monde.apparitions')) regles.declarer('monde.apparitions', { def: true, doc: 'regle de jeu doMobSpawning : l orage peut faire apparaitre le piege du cheval squelette (jeu : oui)' });
  regles.declarer('monde.ageTicks', { def: 0, min: 0, max: 1e12, entier: true, doc: 'temps de jeu total du monde au debut de la scene (ticks ; difficulte locale : +0,25 au plus apres 72 000 + 1 440 000 ticks ; jeu : un monde neuf = 0)' });
  regles.declarer('monde.habite', { def: 0, min: 0, max: 1e12, entier: true, doc: 'temps habite du troncon au debut de la scene (ticks ; difficulte locale : +0,75 au plus apres 3 600 000 ticks, +1 en difficile ; jeu : 0 au depart)' });
  regles.declarer('meteo.fonte', { def: true, doc: 'la glace fond pres d une source de lumiere de bloc (jeu : lumiere de bloc > 11 - opacite de la glace, au tick aleatoire)' });
}
