// Famille "chute" : sable, gravier, enclume, poudre de beton (classe FallingBlock). Un bloc pose ou dont un voisin change reserve un tick dans 2 ticks ;
// s'il n'a plus d'appui (air, fluide, feu, bloc remplacable dessous) il devient une entite qui tombe (moteur/entites.js). Port de FallingBlock
// (Horizon world/level/falling.rs, block_landing.rs : MIT, voir ATTRIBUTIONS.md). Ecrite avec l'API des mods : un mod peut l'envelopper.
export function installer(mc, regles) {
  regles.declarer('chute.actif', { def: true, doc: 'les blocs sans appui (sable, gravier, enclume, poudre de beton) tombent (jeu : oui)' });
  regles.declarer('chute.gravite', { def: 0.04, min: 0, max: 1, doc: 'acceleration de chute des blocs qui tombent, par tick (jeu : 0,04)' });
  const reserve = (ev, monde) => { if (monde.regle('chute.actif', true)) monde.planifier(ev.pos[0], ev.pos[1], ev.pos[2], 2); };
  mc.bloc('FallingBlock').sur('pose', reserve);
  mc.bloc('FallingBlock').sur('forme', (ev, monde) => { reserve(ev, monde); return undefined; });
  mc.bloc('FallingBlock').sur('tick', (ev, monde) => {
    const [x, y, z] = ev.pos;
    if (!monde.regle('chute.actif', true) || y <= -64) return;
    if (monde.remplacable(x, y - 1, z)) monde.chuter(x, y, z);
  });
}
