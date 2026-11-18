// Les corps vivants se poussent (LivingEntity.pushEntities -> Entity.push(Entity)), joueurs et creatures, chaque tick apres les mouvements.
// Port d'apres Horizon (MIT, voir ATTRIBUTIONS.md) : horizon-client/src/mobs/ai.rs push_entities et Mob::pushable.
// Pour chaque acteur A (dans l'ordre des acteurs), chaque acteur B dont la boite touche la sienne : dx = A.x - B.x, dz = A.z - B.z,
// d = max(|dx|, |dz|) ; rien sous 0,01 ; d = racine(d) ; (dx, dz) / d x min(1, 1 / d) x 0,05 ; A recoit +(dx, dz), B recoit -(dx, dz)
// (une paire est donc poussee deux fois par tick, une fois par chacun, comme dans le jeu). Un dormeur ne pousse pas et n'est pas pousse.
// Jamais poussees : chauve-souris, shulker (LivingEntity.isPushable), vex (noPhysics), cristal de l'End et dragon (pas de boite de corps
// unique ici). Le jeu blesse aussi les entites entassees (maxEntityCramming 24) : non porte (aucune scene n'entasse 24 corps).
const JAMAIS = new Set(['bat', 'shulker', 'vex', 'end_crystal', 'ender_dragon']);
const K = Math.fround(0.05), MIN = Math.fround(0.01);

export function declarerReglesPoussee(regles) {
  regles.declarer('acteurs.poussee', { def: true, doc: 'les corps vivants qui se touchent se poussent (Entity.push : 0,05 par tick vers l exterieur), joueurs et creatures' });
}

// perroquet sur l'epaule : dans le jeu ce n'est plus une entite (il est range dans les donnees du joueur)
function poussable(a) { return a.mort < 0 && !JAMAIS.has(a.typeCreature) && !a.ia?.sommeil && !a.ia?.dansRuche && !a.ia?.surEpaule; }

export function pousserActeurs(sim, liste) {
  if (!sim.regles.valeur('acteurs.poussee', true) || liste.length < 2) return;
  const B = liste.map((a) => (poussable(a) ? a.boite() : null));
  for (let i = 0; i < liste.length; i++) {
    const b = B[i]; if (!b) continue;
    const a = liste[i];
    for (let j = 0; j < liste.length; j++) {
      const c = B[j]; if (j === i || !c) continue;
      if (c[0] >= b[3] || c[3] <= b[0] || c[1] >= b[4] || c[4] <= b[1] || c[2] >= b[5] || c[5] <= b[2]) continue;
      const o = liste[j];
      let xa = a.x - o.x, za = a.z - o.z, dd = Math.max(Math.abs(xa), Math.abs(za));
      if (dd < MIN) continue;
      dd = Math.sqrt(dd); xa /= dd; za /= dd;
      const p = Math.min(1, 1 / dd) * K;
      xa *= p; za *= p;
      o.vx -= xa; o.vz -= za;
      a.vx += xa; a.vz += za;
    }
  }
}
