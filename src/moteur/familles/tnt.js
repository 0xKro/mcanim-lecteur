// Famille "tnt" : le bloc TNT s'amorce (briquet, charge de feu, commande `allume`, signal, explosion voisine) et devient une entite a meche ;
// a la fin de la meche elle explose (moteur/explosion.js). Les regles permettent a une scene de changer le mecanisme. Port de TntBlock / PrimedTnt
// (Horizon client/game/tnt.rs : MIT, voir ATTRIBUTIONS.md).
export function installer(mc, regles) {
  regles.declarer('tnt.meche', { def: 80, min: 1, max: 1200, entier: true, doc: 'ticks entre l\'amorcage et l\'explosion (jeu : 80)' });
  regles.declarer('tnt.puissance', { def: 4, min: 0, max: 64, doc: 'rayon du souffle (jeu : 4 ; creeper 3, creeper charge 6)' });
  regles.declarer('tnt.casseBlocs', { def: true, doc: 'l\'explosion detruit des blocs' });
  regles.declarer('tnt.feu', { def: false, doc: 'l\'explosion met le feu (1 bloc detruit sur 3 devient du feu)' });
  regles.declarer('tnt.pousse', { def: true, doc: 'l\'explosion pousse les acteurs (recul et degats)' });
  regles.declarer('tnt.gravite', { def: 0.04, min: 0, max: 1, doc: 'chute du TNT amorce, par tick (jeu : 0,04)' });
  regles.declarer('tnt.chaineMin', { def: -1, min: -1, max: 1200, entier: true, doc: 'meche minimale des TNT amorces par une explosion (-1 : formule du jeu, meche/8 a meche/8 + meche/4 - 1 = 10 a 29)' });
  regles.declarer('tnt.chaineMax', { def: -1, min: -1, max: 1200, entier: true, doc: 'meche maximale des TNT amorces par une explosion (-1 : formule du jeu)' });
  regles.declarer('explosion.resistanceBlocs', { def: 1, min: 0, max: 1000, doc: 'facteur sur la resistance des blocs aux explosions (0 : tout part ; 1 : jeu)' });

  mc.bloc('TntBlock').sur('utilise', (ev, monde) => {
    const o = String(ev.objet || '').replace(/^minecraft:/, '');
    if (o !== 'flint_and_steel' && o !== 'fire_charge') return 'passe';
    const [x, y, z] = ev.pos;
    monde.son(o === 'flint_and_steel' ? 'item.flintandsteel.use' : 'item.firecharge.use', x + 0.5, y + 0.5, z + 0.5, 1, monde.hasard.flottant() * 0.4 + 0.8);
    monde.allumer(x, y, z, { acteur: ev.acteur });
    return 'fait';
  });
  mc.bloc('TntBlock').sur('alimente', (ev, monde) => { if (ev.alimente) monde.allumer(ev.pos[0], ev.pos[1], ev.pos[2], {}); });
  // TntBlock.neighborChanged / onPlace : un signal (poudre, torche, levier...) amorce le TNT
  const verifier = (ev, monde) => { const [x, y, z] = ev.pos; if (monde.aSignalVoisin(x, y, z)) monde.allumer(x, y, z, {}); };
  mc.bloc('TntBlock').sur('voisin', verifier);
  mc.bloc('TntBlock').sur('pose', (ev, monde) => { if (!ev.memeBloc) verifier(ev, monde); });
}
