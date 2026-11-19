// Famille "projectiles" : regles des objets en main et des projectiles (mecaniques dans moteur/{projectiles,utilisation}.js). Evenements du monde :
// `projectile.touche` (ev.type, ev.cible, ev.proprietaire ; ev.annuler() : le projectile ne touche pas), `projectile.bloc`, `perle.teleporte` (ev.acteur, ev.pos, ev.de), `acteur.mange` (ev.objet, ev.nutrition, ev.faim).
// FireworkRocketItem.useOn : la fusee part du point vise, 0,15 bloc devant la face
const FACE = { up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };

export function installer(mc, regles) {
  mc.monde.sur('objet.utilise', (ev, monde) => {
    if (ev.objet !== 'firework_rocket') return;
    const n = FACE[ev.face] ?? FACE.up, h = ev.hit ?? [0.5, 1, 0.5];
    const pos = [ev.pos[0] + h[0] + n[0] * 0.15, ev.pos[1] + h[1] + n[1] * 0.15, ev.pos[2] + h[2] + n[2] * 0.15];
    try { if (monde.fusee(pos, ev.fusee, { proprietaire: ev.acteur }) !== null) ev.fait = true; } catch (err) { ev.raison = err.message; }
  });
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
  regles.declarer('perle.disparaitMort', { def: true, doc: 'la perle d\'ender d\'un joueur mort disparait (regle du jeu enderPearlsVanishOnDeath : oui) ; false : elle reste et se brise sans teleporter' });
  regles.declarer('perle.endermite', { def: true, doc: 'une perle qui teleporte un joueur fait naitre un endermite la ou il etait, 1 fois sur 20 (jeu : oui, si les monstres apparaissent et hors difficulte paisible)' });
  regles.declarer('arcs.puissanceMin', { def: 0.1, min: 0, max: 1, doc: 'puissance minimale pour qu\'un arc tire (jeu : 0,1 : un arc a peine tendu ne tire pas)' });
  regles.declarer('arcs.arbaleteCharge', { def: 25, min: 1, max: 400, entier: true, doc: 'ticks de chargement de l\'arbalete (jeu : 25 ; Charge rapide I : 20)' });
  regles.declarer('arcs.arbaleteVitesse', { def: 3.15, min: 0, max: 20, doc: 'vitesse de la fleche d\'arbalete en blocs par tick (jeu : 3,15)' });
  regles.declarer('objets.mangerTicks', { def: 0, min: 0, max: 600, entier: true, doc: 'duree imposee pour manger ou boire, en ticks (0 : celle du jeu, 32 ; varech sec 16, miel 40)' });
  regles.declarer('objets.delaiJet', { def: 40, min: 0, max: 400, entier: true, doc: 'ticks avant qu\'un objet jete par un acteur puisse etre ramasse (jeu : 40)' });
  regles.declarer('faim.actif', { def: true, doc: 'manger remplit la faim et la saturation de l\'acteur (valeurs du jeu : pain 5 / 6,0)' });
  regles.declarer('faim.mangerPlein', { def: false, doc: 'on peut manger avec la faim pleine (jeu : non, sauf les aliments can_always_eat : pomme en or, fiole de miel... ; vrai : une scene montre le repas quand meme)' });
  regles.declarer('faim.regeneration', { def: true, doc: 'regeneration naturelle (FoodData.tick : saturation et faim 20 : 1 pv par min(sat, 6) / 6 toutes les 10 ticks ; faim >= 18 : 1 pv toutes les 80 ticks ; jeu : oui)' });
  regles.declarer('faim.difficulte', { def: 'normal', choix: ['paisible', 'facile', 'normal', 'difficile'], doc: 'difficulte pour la faim (paisible : la faim ne baisse pas ; famine : jusqu a 10 pv en facile, 1 en normal, la mort en difficile)' });
  regles.declarer('alambic.temps', { def: 400, min: 1, max: 24000, entier: true, doc: 'ticks d une infusion de l alambic a la vitesse 1 (jeu : 400 = 20 s) ; plus court pour une scene en accelere' });
  regles.declarer('objets.usure', { def: true, doc: 'les outils, armes et armures s usent et cassent (acteurs en survie : champ sac ou mode survie)' });
  regles.declarer('four.actif', { def: true, doc: 'les fours cuisent (entree, combustible, sortie ; 200 ticks par objet, combustibles du jeu)' });
  regles.declarer('four.vitesse', { def: 1, min: 0.01, max: 100, doc: 'multiplicateur de la vitesse de cuisson (jeu : 1 ; 200 ticks par objet)' });
  regles.declarer('four.combustible', { def: 1, min: 0.01, max: 100, doc: 'multiplicateur de la duree de combustion des combustibles (jeu : 1 ; charbon 1600 ticks)' });
  regles.declarer('effets.actif', { def: true, doc: 'les effets de potion (tous ceux du jeu : moteur/effets.js) s\'appliquent aux acteurs' });
  regles.declarer('effets.vitesse', { def: 1, min: 0, max: 10, doc: 'multiplicateur de la vitesse de marche de tous les acteurs (jeu : 1 ; Vitesse I = x1,2, Lenteur I = x0,85)' });
}
