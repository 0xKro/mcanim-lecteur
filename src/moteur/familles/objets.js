// Famille "objets" : butin des blocs, objets au sol, sante des acteurs. Les mecaniques sont dans moteur/{butin,entites,acteurs}.js ; ici les REGLES
// (une scene ou un mod les change) et les crochets ecrits avec l'API des mods. Port de Block.dropResources, ItemEntity, LivingEntity.hurt
// (Horizon world/loot.rs, client/game/item_entities.rs : MIT, voir ATTRIBUTIONS.md).
//   evenements de bloc : `butin` (ev.butin = [[objet, n], ...] modifiable, ev.annuler()) ; du monde : `objets.lache` (un bloc part sans etre casse : l'eau
//   qui emporte une plante, un bloc qui tombe perdu), `acteur.degats` (ev.quantite modifiable, ev.annuler()), `acteur.meurt`, `acteur.ramasse`
export function installer(mc, regles) {
  regles.declarer('butin.actif', { def: true, doc: 'les blocs casses ou detruits lachent leurs objets (tables du jeu : pierre -> cobblestone, herbe -> terre, verre -> rien)' });
  regles.declarer('explosion.butin', { def: true, doc: 'les blocs detruits par une explosion lachent leurs objets, avec la chance 1 / puissance par objet (jeu : oui)' });
  regles.declarer('objets.delai', { def: 10, min: 0, max: 200, entier: true, doc: 'ticks avant qu\'un objet lache puisse etre ramasse (jeu : 10)' });
  regles.declarer('objets.gravite', { def: 0.04, min: 0, max: 1, doc: 'chute des objets au sol, par tick (jeu : 0,04)' });
  regles.declarer('objets.fusion', { def: true, doc: 'les piles identiques voisines se fusionnent (jeu : oui)' });
  regles.declarer('objets.vie', { def: 6000, min: 20, max: 1000000, entier: true, doc: 'ticks avant qu\'un objet au sol disparaisse (jeu : 6000 = 5 minutes)' });
  regles.declarer('vie.actif', { def: true, doc: 'les acteurs perdent de la vie (explosions, chutes, lave, noyade) et peuvent mourir ; `invulnerable: true` sur un acteur le protege' });
  regles.declarer('vie.chute', { def: 1, min: 0, max: 100, doc: 'facteur sur les degats de chute (jeu : 1 ; 0 coupe les chutes)' });
  regles.declarer('vie.chuteSeuil', { def: 3, min: 0, max: 100, doc: 'distance de chute sans degats, en blocs (jeu : 3)' });
  regles.declarer('vie.explosions', { def: true, doc: 'les explosions font des degats aux acteurs (jeu : oui) ; le recul est la regle tnt.pousse' });

  // un bloc part sans etre casse par un acteur (l'eau emporte une plante) : ses objets tombent
  mc.monde.sur('objets.lache', (ev, monde) => { monde.butin(ev.pos[0], ev.pos[1], ev.pos[2], { source: ev.raison || 'lache' }); });
}
