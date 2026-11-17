// Entites nees pendant la simulation (moteur/acteurs.js naitre : bebes, conversions, golems, allays dupliques) et changements d'apparence en
// cours de route (bebe devenu adulte, creeper charge par la foudre, champimeuh qui change de couleur) : apres la simulation, la scene recoit un
// acteur de plus par entite nee, et un par changement. Ils lisent la trace du replay sous le nom du moteur (`_trace`) et ne sont pas dessines
// hors de leur fenetre de ticks (`_absentAvant`, `_absentApres`). Le reste du film (personnages, animation, sons des creatures) les traite
// comme les autres acteurs. Rien sans naissance ni changement : la scene reste la meme.

// scene : lue (film/scene.js) ; replay : moteur/replay.js. Modifie scene.acteurs (les acteurs ajoutes avant sont d'abord retires).
export function ajouterNaissances(scene, replay) {
  scene.acteurs = scene.acteurs.filter((a) => !a._synthetique);
  const N = replay.naissances ?? [], C = replay.croissances ?? [];
  if (!N.length && !C.length) return 0;
  const parTrace = new Map();   // nom du moteur -> acteur de la scene qui le dessine maintenant
  for (const a of scene.acteurs) parTrace.set(a.nom, a);
  let n = 0;
  const base = (modele) => parTrace.get(modele) ?? scene.acteurs.find((a) => a.creature) ?? scene.acteurs[0];
  const nouveau = (m, nom, trace, creature, x, y, z) => ({
    nom, skin: m.skin ?? 'steve', modele: m.modele ?? null, pos: { cles: [{ t: 0, l: undefined, x, y, z }] }, objet: null, boucles: [],
    reactions: false, souple: true, appui: true, jeu: { actif: false, intensite: 1, regard: true }, gestes: [], creature, _synthetique: true, _trace: trace,
  });
  // evenements dans l'ordre des ticks
  const ev = [...N.map((x) => ({ ...x, genre: 'nait' })), ...C.map((x) => ({ ...x, genre: 'change' }))].sort((p, q) => p.tick - q.tick || (p.genre === 'nait' ? -1 : 1));
  for (const e of ev) {
    if (e.genre === 'nait') {
      const m = base(e.modele);
      const c = { type: e.type, ia: true, ...(e.variante ? { variante: e.variante } : {}), ...(e.bebe ? { bebe: true } : {}), ...(e.colle ? { colle: e.colle } : {}), ...(m.creature?.cris === false ? { cris: false } : {}) };
      const a = nouveau(m, e.nom, e.nom, c, e.pos[0], e.pos[1], e.pos[2]);
      a._absentAvant = e.tick;
      scene.acteurs.push(a); parTrace.set(e.nom, a); n++;
    } else {
      const cur = parTrace.get(e.nom);
      if (!cur?.creature) continue;
      const c = { ...cur.creature, ...e.change };
      if (e.change.bebe === false) delete c.bebe;
      const nom = `${e.nom}~${e.tick}`;
      const k0 = cur.pos.cles[0], a = nouveau(cur, nom, cur._trace ?? cur.nom, c, k0.x, k0.y, k0.z);
      if (cur.etiquette) a.etiquette = cur.etiquette;
      a._absentAvant = e.tick; cur._absentApres = e.tick;
      scene.acteurs.push(a); parTrace.set(e.nom, a); n++;
    }
  }
  return n;
}

// position de depart d'un acteur ajoute (sa premiere ligne de trace) : utile aux outils ; le film lit la trace
export function absentA(a, tick) { return (a._absentAvant !== undefined && tick < a._absentAvant) || (a._absentApres !== undefined && tick >= a._absentApres); }
