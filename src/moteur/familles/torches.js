// Famille "torches" : une torche (au sol, au mur, de redstone) tombe quand son appui disparait. Ecrite avec la MEME API que les
// mods : tout est remplacable (un mod peut faire mc.bloc('torch').sur('forme', ...) pour qu'elle tienne dans le vide).
// Port de BaseTorchBlock.updateShape / canSurvive et WallTorchBlock (Horizon world/level/survive.rs, shapes.rs : MIT).
const OPPOSEE = { bas: 'haut', haut: 'bas', nord: 'sud', sud: 'nord', ouest: 'est', est: 'ouest' };
const DELTA = { bas: [0, -1, 0], haut: [0, 1, 0], nord: [0, 0, -1], sud: [0, 0, 1], ouest: [-1, 0, 0], est: [1, 0, 0] };
const FACE_JEU = { north: 'nord', south: 'sud', west: 'ouest', east: 'est' };

export function installer(mc, regles) {
  regles.declarer('torches.survie', { def: true, doc: 'une torche tombe (devient de l\'air) quand son appui disparait' });
  const propsDe = (chaine) => { const i = chaine.indexOf('['); const o = {}; if (i >= 0) for (const kv of chaine.slice(i + 1, -1).split(',')) { const [k, v] = kv.split('='); o[k] = v; } return o; };

  // torche au sol : il faut le centre de la face haute du bloc du dessous
  mc.bloc('BaseTorchBlock').sur('survit', (ev, monde) => {
    const [x, y, z] = ev.pos;
    return monde.appui(x, y - 1, z, 'haut', 'centre');
  });
  mc.bloc('BaseTorchBlock').sur('forme', (ev, monde) => {
    if (!monde.regle('torches.survie', true)) return undefined;
    if (ev.direction === 'bas' && !monde.survit(...ev.pos)) return 'minecraft:air';
    return ev.etat;
  });
  // torche au mur : il faut une face pleine du bloc derriere
  for (const wall of ['WallTorchBlock', 'RedstoneWallTorchBlock']) {
    mc.bloc(wall).sur('survit', (ev, monde) => {
      const face = FACE_JEU[propsDe(ev.etat).facing];
      const [dx, dy, dz] = DELTA[OPPOSEE[face]];
      const [x, y, z] = ev.pos;
      return monde.appui(x + dx, y + dy, z + dz, face, 'plein');
    });
    mc.bloc(wall).sur('forme', (ev, monde) => {
      if (!monde.regle('torches.survie', true)) return undefined;
      const face = FACE_JEU[propsDe(ev.etat).facing];
      if (ev.direction === OPPOSEE[face] && !monde.survit(...ev.pos)) return 'minecraft:air';
      return ev.etat;
    });
  }
}
