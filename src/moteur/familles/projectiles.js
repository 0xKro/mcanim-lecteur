// Famille "projectiles" : regles des objets en main et des projectiles (mecaniques dans moteur/{projectiles,utilisation}.js). Evenements du monde :
// `projectile.touche` (ev.type, ev.cible, ev.proprietaire ; ev.annuler() : le projectile ne touche pas), `projectile.bloc`, `acteur.mange` (ev.objet, ev.nutrition, ev.faim).
export function installer(mc, regles) {
  // four et etabli : le clic droit ouvre un ecran (rien a dessiner) ; `utilise` reussit sans animation, `depose` et `prend` font les transferts
  mc.bloc('AbstractFurnaceBlock').sur('utilise', () => 'fait');
  mc.bloc('CraftingTableBlock').sur('utilise', () => 'fait');
  regles.declarer('projectiles.actif', { def: true, doc: 'les projectiles (fleches, boules de neige, perles, potions jetees, trident) existent ; false : le tir ne produit rien' });
  regles.declarer('projectiles.gravite', { def: 1, min: 0, max: 20, doc: 'multiplicateur de la gravite des projectiles (jeu : 1 ; fleche 0,05 par tick, boule 0,03 ; 0 : ligne droite)' });
  regles.declarer('projectiles.vitesse', { def: 1, min: 0, max: 20, doc: 'multiplicateur de la vitesse de depart (jeu : 1 ; fleche pleine puissance = 3,0 blocs par tick)' });
  regles.declarer('projectiles.imprecision', { def: 1, min: 0, max: 20, doc: 'multiplicateur de la dispersion des tirs (jeu : 1 ; 0 : tir parfait)' });
  regles.declarer('projectiles.degats', { def: 1, min: 0, max: 100, doc: 'multiplicateur des degats des fleches et du trident (jeu : 1 ; fleche pleine puissance : 6 + 0 a 4 si critique)' });
  regles.declarer('projectiles.recul', { def: 1, min: 0, max: 20, doc: 'multiplicateur du recul d\'un projectile qui touche un acteur (jeu : 1 = 0,4)' });
  regles.declarer('projectiles.vieFleche', { def: 1200, min: 20, max: 1000000, entier: true, doc: 'ticks pendant lesquels une fleche reste plantee (jeu : 1200 = 1 minute)' });
  regles.declarer('perle.degats', { def: 5, min: 0, max: 1000, doc: 'degats de chute de la perle d\'ender au lanceur qui se teleporte (jeu : 5)' });
  regles.declarer('arcs.puissanceMin', { def: 0.1, min: 0, max: 1, doc: 'puissance minimale pour qu\'un arc tire (jeu : 0,1 : un arc a peine tendu ne tire pas)' });
  regles.declarer('arcs.arbaleteCharge', { def: 25, min: 1, max: 400, entier: true, doc: 'ticks de chargement de l\'arbalete (jeu : 25 ; Charge rapide I : 20)' });
  regles.declarer('arcs.arbaleteVitesse', { def: 3.15, min: 0, max: 20, doc: 'vitesse de la fleche d\'arbalete en blocs par tick (jeu : 3,15)' });
  regles.declarer('objets.mangerTicks', { def: 0, min: 0, max: 600, entier: true, doc: 'duree imposee pour manger ou boire, en ticks (0 : celle du jeu, 32 ; varech sec 16, miel 40)' });
  regles.declarer('objets.delaiJet', { def: 40, min: 0, max: 400, entier: true, doc: 'ticks avant qu\'un objet jete par un acteur puisse etre ramasse (jeu : 40)' });
  regles.declarer('faim.actif', { def: true, doc: 'manger remplit la faim et la saturation de l\'acteur (valeurs du jeu : pain 5 / 6,0)' });
  regles.declarer('faim.mangerPlein', { def: true, doc: 'on peut manger avec la faim pleine (jeu : non, sauf pomme en or ; vrai ici pour qu\'une scene puisse montrer le repas)' });
  regles.declarer('faim.regeneration', { def: false, doc: 'la vie remonte seule quand la faim est a 18 ou plus (jeu : oui ; coupe par defaut pour garder les degats des phases precedentes)' });
  regles.declarer('four.actif', { def: true, doc: 'les fours cuisent (entree, combustible, sortie ; 200 ticks par objet, combustibles du jeu)' });
  regles.declarer('four.vitesse', { def: 1, min: 0.01, max: 100, doc: 'multiplicateur de la vitesse de cuisson (jeu : 1 ; 200 ticks par objet)' });
  regles.declarer('four.combustible', { def: 1, min: 0.01, max: 100, doc: 'multiplicateur de la duree de combustion des combustibles (jeu : 1 ; charbon 1600 ticks)' });
  regles.declarer('effets.actif', { def: true, doc: 'les effets de potion (vitesse, lenteur, saut, invisibilite, lueur, regeneration, poison) s\'appliquent aux acteurs' });
  regles.declarer('effets.vitesse', { def: 1, min: 0, max: 10, doc: 'multiplicateur de la vitesse de marche de tous les acteurs (jeu : 1 ; Vitesse I = x1,2, Lenteur I = x0,85)' });
}
