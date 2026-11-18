// Les corps vivants se poussent (LivingEntity.pushEntities -> doPush -> Entity.push(Entity)), joueurs et creatures, chaque tick apres les
// mouvements, et ceux qui s'entassent s'etouffent (degats `cramming`). Port d'apres Horizon (MIT, voir ATTRIBUTIONS.md) : horizon-client/src/
// mobs/ai.rs push_entities et Mob::pushable.
// Pour chaque acteur A (dans l'ordre des acteurs) : la liste des acteurs B poussables dont la boite touche la sienne (getPushableEntities) ;
//   - entassement : si la liste compte au moins `maxEntityCramming` - 1 + 1 corps (plus de max - 1) et qu'un tirage sur 4 tombe sur 0, et
//     qu'autant d'entre eux ne sont pas des passagers, A prend 6 de degats `cramming` (regle acteurs.entassementMax, celle du jeu : 24 ; 0 coupe) ;
//   - puis pour chaque B : dx = A.x - B.x, dz = A.z - B.z, d = max(|dx|, |dz|) ; rien sous 0,01 ; d = racine(d) ;
//     (dx, dz) / d x min(1, 1 / d) x 0,05 ; B recoit -(dx, dz), A recoit +(dx, dz) s'il est lui-meme poussable (une paire est donc poussee deux
//     fois par tick, une fois par chacun, comme dans le jeu).
// Qui est poussable (LivingEntity.isPushable) : vivant, pas accroche a un bloc #minecraft:climbable (echelle, lianes, echafaudage... ou une
// trappe ouverte posee sur une echelle de meme direction : LivingEntity.onClimbable) ; jamais une chauve-souris ni un shulker (qui pousse
// pourtant les autres) ; pas un dormeur (Player/LivingEntity.push : un dormeur n'est jamais pousse, et celui qui le touche non plus).
// Qui pousse : tout vivant sauf la chauve-souris (Bat.pushEntities et doPush vides) et le dragon (EnderDragon.aiStep n'appelle pas
// pushEntities) ; le support d'armure ne pousse que les wagonnets (aucun dans le moteur) et n'est pas poussable.
// noPhysics (Entity.push ne fait rien si l'un des deux l'a) : le vex le garde pendant son propre tick (Vex.tick ; Horizon mobs/ai.rs l'ecrit
// pour isInWall) : il ne pousse donc personne, mais les autres le poussent (et sont repousses) ; le dragon l'a toujours : compte dans
// l'entassement des autres, jamais pousse. Le cristal de l'End n'est pas un vivant (Entity.isPushable faux) : ni pousse, ni compte.
// Bateaux et wagonnets : le moteur ne les simule pas (ils sont dessines par le film, film/creatures.js) ; un vehicule donne a la simulation
// est poussable (Entity.isPushable des vehicules) et ne pousse pas.
const K = Math.fround(0.05), MIN = Math.fround(0.01);
const JAMAIS_POUSSES = new Set(['bat', 'shulker', 'end_crystal', 'armor_stand']);
const NE_POUSSENT_PAS = new Set(['bat', 'ender_dragon', 'end_crystal', 'armor_stand']);
const VEHICULE = /^(boat|chest_boat|(\w+_)?minecart)$/;

export function declarerReglesPoussee(regles) {
  regles.declarer('acteurs.poussee', { def: true, doc: 'les corps vivants qui se touchent se poussent (Entity.push : 0,05 par tick vers l exterieur), joueurs et creatures' });
  regles.declarer('acteurs.entassementMax', { def: 24, min: 0, max: 1000, entier: true, doc: 'regle maxEntityCramming du jeu : un vivant qui touche au moins ce nombre de corps poussables prend 6 de degats une fois sur 4 par tick ; 0 : jamais' });
}

// LivingEntity.onClimbable : le bloc des pieds est #minecraft:climbable, ou une trappe ouverte au-dessus d'une echelle tournee pareil
export function surGrimpable(sim, a) {
  const d = sim.d, x = Math.floor(a.x), y = Math.floor(a.y), z = Math.floor(a.z), e = sim.monde.etatEn(x, y, z);
  if (e < 0) return false;
  const grimp = (sim._grimpables ??= d.etiquette('#minecraft:climbable'));
  if (grimp.has(d.blocDe(e))) return true;
  if (!/_trapdoor$/.test(d.nomBloc(e))) return false;
  const p = d.props(e);
  if (p.open !== 'true') return false;
  const s = sim.monde.etatEn(x, y - 1, z);
  return s >= 0 && d.nomBloc(s) === 'ladder' && d.props(s).facing === p.facing;
}

// perroquet sur l'epaule, abeille dans sa ruche : dans le jeu ce ne sont plus des entites
const present = (a) => a.mort < 0 && !a.ia?.dansRuche && !a.ia?.surEpaule;
const dort = (a) => !!a.ia?.sommeil;

export function pousserActeurs(sim, liste) {
  if (!sim.regles.valeur('acteurs.poussee', true) || liste.length < 2) return;
  const n = liste.length, B = new Array(n), poussable = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = liste[i];
    B[i] = present(a) ? a.boite() : null;
    poussable[i] = !!B[i] && !JAMAIS_POUSSES.has(a.typeCreature) && !surGrimpable(sim, a);
  }
  const max = sim.regles.valeur('acteurs.entassementMax', 24);
  for (let i = 0; i < n; i++) {
    const b = B[i], a = liste[i];
    if (!b || NE_POUSSENT_PAS.has(a.typeCreature) || VEHICULE.test(a.typeCreature ?? '')) continue;
    const cibles = [];
    for (let j = 0; j < n; j++) {
      const c = B[j];
      if (j === i || !c || !poussable[j]) continue;
      if (c[0] >= b[3] || c[3] <= b[0] || c[1] >= b[4] || c[4] <= b[1] || c[2] >= b[5] || c[5] <= b[2]) continue;
      cibles.push(liste[j]);
    }
    if (!cibles.length) continue;
    // entassement (LivingEntity.pushEntities) : avant les poussees ; aucun passager dans le moteur
    if (max > 0 && cibles.length > max - 1 && sim.hasard.entierBorne(4) === 0) {
      sim.stats.entassement = (sim.stats.entassement || 0) + 1;
      a.degats(6, 'cramming');
    }
    if (a.typeCreature === 'vex') continue;   // noPhysics pendant son tick : ses poussees ne font rien
    const aPoussable = poussable[i] && !VEHICULE.test(a.typeCreature ?? '');
    for (const o of cibles) {
      if (dort(o) || o.typeCreature === 'ender_dragon') continue;   // dormeur : rien des deux cotes ; dragon : noPhysics
      let xa = a.x - o.x, za = a.z - o.z, dd = Math.max(Math.abs(xa), Math.abs(za));
      if (dd < MIN) continue;
      dd = Math.sqrt(dd); xa /= dd; za /= dd;
      const p = Math.min(1, 1 / dd) * K;
      xa *= p; za *= p;
      o.vx -= xa; o.vz -= za;
      if (aPoussable) { a.vx += xa; a.vz += za; }
    }
  }
}
