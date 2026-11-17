// Famille "pose" : l'etat qu'un bloc prend quand un joueur le pose (BlockItem.place -> Block.getStateForPlacement) et les mises a jour de forme
// qui relient les blocs voisins (clotures, vitres, escaliers, coffres doubles). Evenement `etatPose` ; il rend :
//   - un texte d'etat ('minecraft:oak_door[...]'), ou { etat, aussi: [[x, y, z, 'etat'], ...] } (porte : moitie haute ; lit : tete),
//   - false : on ne peut pas poser, ou undefined : etat par defaut du bloc (avec les regles generales plus bas).
// ev : { pos, etat (etat par defaut), bloc, face (face cliquee : 'up'...), hit [fx, fy, fz], lacet, tangage, accroupi, existant (bloc deja la) }.
// Port de getStateForPlacement de DoorBlock, TrapDoorBlock, FenceGateBlock, StairBlock, SlabBlock, ChestBlock, BedBlock, CrossCollisionBlock,
// RotatedPillarBlock, DirectionalBlock, HorizontalDirectionalBlock (Horizon world/level/place.rs : MIT, voir ATTRIBUTIONS.md).
import { JEU, FR, VEC, OPPOSE, HORIZ, horaire, antihoraire, avec, parseEtat, dirDeLacet, dirRegard, decale, axe } from './_aide.js';

const estEscalier = (b) => /_stairs$/.test(b.nom);
const estCoffre = (b) => /^minecraft:(chest|trapped_chest)$/.test(b.nom);
const plein = (monde, p, face) => monde.appui(p[0], p[1], p[2], FR[face], 'plein');

export function installer(mc, regles) {

  const waterlogged = (monde, ev, props) => {   // pose dans l'eau : le bloc devient "waterlogged" s'il peut l'etre
    const e = ev.existant;
    return e && /^minecraft:water$/.test(e.nom) && e.etat.level === '0' ? { ...props, waterlogged: 'true' } : props;
  };
  const defaut = (ev) => parseEtat(ev.etat);

  // ---------------------------------------------------------------- portes (DoorBlock.getStateForPlacement)
  mc.bloc('DoorBlock').sur('etatPose', (ev, monde) => {
    const [x, y, z] = ev.pos;
    if (y >= 319 || !monde.remplacable(x, y + 1, z)) return false;
    const dir = dirDeLacet(ev.lacet), cc = antihoraire(dir), cw = horaire(dir);
    const pleinCol = (p) => { const b = monde.bloc(...p); return b.id >= 0 && monde.appui(p[0], p[1], p[2], 'haut', 'plein') && monde.appui(p[0], p[1], p[2], 'bas', 'plein') && monde.appui(p[0], p[1], p[2], 'nord', 'plein') && monde.appui(p[0], p[1], p[2], 'sud', 'plein') && monde.appui(p[0], p[1], p[2], 'est', 'plein') && monde.appui(p[0], p[1], p[2], 'ouest', 'plein'); };
    const p1 = decale(ev.pos, cc), p2 = decale([x, y + 1, z], cc), p3 = decale(ev.pos, cw), p4 = decale([x, y + 1, z], cw);
    const n = (pleinCol(p1) ? -1 : 0) + (pleinCol(p2) ? -1 : 0) + (pleinCol(p3) ? 1 : 0) + (pleinCol(p4) ? 1 : 0);
    const b1 = monde.bloc(...p1), b3 = monde.bloc(...p3);
    const porteBasse = (b) => b.nom === ev.bloc && b.etat.half === 'lower';
    const g = porteBasse(b1), d = porteBasse(b3);
    let charniere;
    if ((!g || d) && n <= 0) {
      if ((!d || g) && n >= 0) {
        const vx = VEC[dir][0], vz = VEC[dir][2], fx = ev.hit[0], fz = ev.hit[2];
        charniere = (vx >= 0 || !(fz < 0.5)) && (vx <= 0 || !(fz > 0.5)) && (vz >= 0 || !(fx > 0.5)) && (vz <= 0 || !(fx < 0.5)) ? 'left' : 'right';
      } else charniere = 'left';
    } else charniere = 'right';
    const base = defaut(ev);
    const bas = { ...base.etat, facing: dir, hinge: charniere, powered: 'false', open: 'false', half: 'lower' };
    return { etat: avec(base, bas), aussi: [[x, y + 1, z, avec(base, { ...bas, half: 'upper' })]] };
  });

  // ---------------------------------------------------------------- trappes
  mc.bloc('TrapDoorBlock').sur('etatPose', (ev, monde) => {
    const base = defaut(ev), face = ev.face, y = ev.pos[1];
    let p;
    if (face !== 'up' && face !== 'down') p = { facing: face, half: ev.hit[1] > 0.5 ? 'top' : 'bottom' };
    else p = { facing: OPPOSE[dirDeLacet(ev.lacet)], half: face === 'up' ? 'bottom' : 'top' };
    void y; void monde;
    return avec(base, waterlogged(monde, ev, { ...base.etat, ...p }));
  });

  // ---------------------------------------------------------------- portillons
  mc.bloc('FenceGateBlock').sur('etatPose', (ev, monde) => {
    const base = defaut(ev), dir = dirDeLacet(ev.lacet);
    const estMur = (b) => /_wall$/.test(b.nom);
    const dedans = estMur(monde.bloc(...decale(ev.pos, horaire(dir)))) || estMur(monde.bloc(...decale(ev.pos, antihoraire(dir))));
    return avec(base, { ...base.etat, facing: dir, in_wall: String(dedans), open: 'false', powered: 'false' });
  });

  // ---------------------------------------------------------------- escaliers (StairBlock)
  const formeEscalier = (monde, pos, facing, half) => {
    const arriere = monde.bloc(...decale(pos, facing)), avant = monde.bloc(...decale(pos, OPPOSE[facing]));
    const prendForme = (face) => { const s = monde.bloc(...decale(pos, face)); return !estEscalier(s) || s.etat.facing !== facing || s.etat.half !== half; };
    if (estEscalier(arriere) && arriere.etat.half === half) {
      const af = arriere.etat.facing;
      if (axe(af) !== axe(facing) && prendForme(OPPOSE[af])) return af === antihoraire(facing) ? 'outer_left' : 'outer_right';
    }
    if (estEscalier(avant) && avant.etat.half === half) {
      const ff = avant.etat.facing;
      if (axe(ff) !== axe(facing) && prendForme(ff)) return ff === antihoraire(facing) ? 'inner_left' : 'inner_right';
    }
    return 'straight';
  };
  mc.bloc('StairBlock').sur('etatPose', (ev, monde) => {
    const base = defaut(ev), facing = dirDeLacet(ev.lacet);
    const half = ev.face !== 'down' && (ev.face === 'up' || !(ev.hit[1] > 0.5)) ? 'bottom' : 'top';
    const shape = formeEscalier(monde, ev.pos, facing, half);
    return avec(base, waterlogged(monde, ev, { ...base.etat, facing, half, shape }));
  });
  mc.bloc('StairBlock').sur('forme', (ev, monde) => {
    const dir = JEU[ev.direction];
    if (dir === 'up' || dir === 'down') return undefined;
    const b = parseEtat(ev.etat);
    const shape = formeEscalier(monde, ev.pos, b.etat.facing, b.etat.half);
    return shape === b.etat.shape ? undefined : avec(b, { shape });
  });

  // ---------------------------------------------------------------- dalles (SlabBlock) : deux dalles font un bloc double
  mc.bloc('SlabBlock').sur('etatPose', (ev, monde) => {
    const base = defaut(ev), e = ev.existant;
    if (e && e.nom === base.nom && e.etat.type !== 'double') {
      const haut = e.etat.type === 'top';
      // SlabBlock.canBeReplaced : par le dessus d'une dalle basse, ou par le dessous d'une dalle haute (ou par le cote, selon le point clique)
      const ok = ev.face === (haut ? 'down' : 'up') || (ev.face !== 'up' && ev.face !== 'down' && (haut ? ev.hit[1] < 0.5 : ev.hit[1] > 0.5)) ;
      if (ok) { ev.fusion = true; return avec(e, { type: 'double', waterlogged: 'false' }); }   // fusion : la cellule n'est pas libre mais le bloc la complete
      return false;
    }
    const type = ev.face !== 'down' && (ev.face === 'up' || !(ev.hit[1] > 0.5)) ? 'bottom' : 'top';
    return avec(base, waterlogged(monde, ev, { ...base.etat, type }));
  });

  // ---------------------------------------------------------------- blocs orientes
  mc.bloc('RotatedPillarBlock').sur('etatPose', (ev) => { const b = defaut(ev); return avec(b, { ...b.etat, axis: axe(ev.face) }); });
  mc.bloc('HorizontalDirectionalBlock').sur('etatPose', (ev) => {   // face au joueur (four, etc.)
    const b = defaut(ev);
    if (!('facing' in b.etat)) return undefined;
    return avec(b, { ...b.etat, facing: OPPOSE[dirDeLacet(ev.lacet)] });
  });
  mc.bloc('DirectionalBlock').sur('etatPose', (ev) => {   // piston, distributeur, observateur : face opposee a la ou on regarde
    const b = defaut(ev);
    return avec(b, { ...b.etat, facing: OPPOSE[dirRegard(ev.lacet, ev.tangage)] });
  });
  mc.bloc('BarrelBlock').sur('etatPose', (ev) => { const b = defaut(ev); return avec(b, { ...b.etat, facing: OPPOSE[dirRegard(ev.lacet, ev.tangage)] }); });
  mc.bloc('LadderBlock').sur('etatPose', (ev, monde) => {
    const b = defaut(ev);
    const faces = ev.face === 'up' || ev.face === 'down' ? [dirDeLacet(ev.lacet)] : [ev.face];
    for (const f of [...faces, ...HORIZ]) if (plein(monde, decale(ev.pos, OPPOSE[f]), f)) return avec(b, waterlogged(monde, ev, { ...b.etat, facing: f }));
    return false;
  });
  // torches : au mur si on clique sur le cote d'un bloc
  for (const [nom, mur] of [['torch', 'wall_torch'], ['soul_torch', 'soul_wall_torch'], ['redstone_torch', 'redstone_wall_torch'], ['copper_torch', 'copper_wall_torch']]) {
    mc.bloc(nom).sur('etatPose', (ev, monde) => {
      if (ev.face === 'up') return undefined;
      if (ev.face === 'down') return false;
      const nomMur = 'minecraft:' + mur;
      void monde;
      return `${nomMur}[facing=${ev.face}${nom === 'redstone_torch' ? ',lit=true' : ''}]`;
    });
  }
  // boutons, leviers, meules : poses sur le sol, un mur ou un plafond selon la face cliquee
  mc.bloc('FaceAttachedHorizontalDirectionalBlock').sur('etatPose', (ev) => {
    const b = defaut(ev), f = ev.face;
    const face = f === 'up' ? 'floor' : f === 'down' ? 'ceiling' : 'wall';
    const facing = f === 'up' || f === 'down' ? dirDeLacet(ev.lacet) : f;
    return avec(b, { ...b.etat, face, facing });
  });
  mc.bloc('SnowLayerBlock').sur('etatPose', (ev) => {   // la neige s'empile jusqu'a 8 couches
    const e = ev.existant, b = defaut(ev);
    if (e && e.nom === b.nom) { const n = Number(e.etat.layers); if (n >= 8) return false; ev.fusion = true; return avec(e, { layers: String(n + 1) }); }
    return undefined;
  });
  mc.bloc('NoteBlock').sur('etatPose', (ev, monde) => {
    const b = defaut(ev);
    const bas = monde.bloc(ev.pos[0], ev.pos[1] - 1, ev.pos[2]).instrument ?? 'harp', haut = monde.bloc(ev.pos[0], ev.pos[1] + 1, ev.pos[2]).instrument ?? 'harp';
    const tete = new Set(['zombie', 'skeleton', 'creeper', 'dragon', 'wither_skeleton', 'piglin', 'custom_head']);
    const inst = tete.has(haut) ? haut : tete.has(bas) ? 'harp' : bas;
    return avec(b, { ...b.etat, instrument: inst });
  });

  // ---------------------------------------------------------------- lits : le pied ici, la tete devant
  mc.bloc('BedBlock').sur('etatPose', (ev, monde) => {
    const b = defaut(ev), dir = dirDeLacet(ev.lacet), [x, y, z] = ev.pos;
    const t = decale([x, y, z], dir);
    if (!monde.remplacable(t[0], t[1], t[2])) return false;
    return { etat: avec(b, { ...b.etat, facing: dir, part: 'foot' }), aussi: [[t[0], t[1], t[2], avec(b, { ...b.etat, facing: dir, part: 'head' })]] };
  });

  // ---------------------------------------------------------------- coffres (ChestBlock.getStateForPlacement) : pairage en coffre double
  const partenaire = (monde, pos, dir) => { const s = monde.bloc(...decale(pos, dir)); return estCoffre(s) && s.etat.type === 'single' ? s.etat.facing : null; };
  mc.bloc('ChestBlock').sur('etatPose', (ev, monde) => {
    const b = defaut(ev);
    let type = 'single', dir = OPPOSE[dirDeLacet(ev.lacet)];
    const est = ev.accroupi, clique = ev.face;
    if (clique !== 'up' && clique !== 'down' && est) {
      const d2 = partenaire(monde, ev.pos, OPPOSE[clique]);
      if (d2 && axe(d2) !== axe(clique)) { dir = d2; type = antihoraire(d2) === OPPOSE[clique] ? 'right' : 'left'; }
    }
    if (type === 'single' && !est) {
      if (dir === partenaire(monde, ev.pos, horaire(dir))) type = 'left';
      else if (dir === partenaire(monde, ev.pos, antihoraire(dir))) type = 'right';
    }
    return avec(b, waterlogged(monde, ev, { ...b.etat, facing: dir, type }));
  });
  mc.bloc('ChestBlock').sur('forme', (ev, monde) => {
    const d = JEU[ev.direction];
    if (d === 'up' || d === 'down') return undefined;
    const b = parseEtat(ev.etat), n = parseEtat(ev.voisin);
    const connecte = (s) => (s.etat.type === 'left' ? horaire(s.etat.facing) : antihoraire(s.etat.facing));
    if (n.nom === b.nom) {
      const nt = n.etat.type;
      if (b.etat.type === 'single' && nt !== 'single' && b.etat.facing === n.etat.facing && connecte(n) === OPPOSE[d]) return avec(b, { type: nt === 'left' ? 'right' : 'left' });
    } else if (b.etat.type !== 'single' && connecte(b) === d) return avec(b, { type: 'single' });
    return undefined;
  });

  // ---------------------------------------------------------------- clotures et vitres : les liens vers les voisins (CrossCollisionBlock)
  const exception = (monde, b) => /(_leaves$|^minecraft:(barrier|carved_pumpkin|jack_o_lantern|melon|pumpkin)$|shulker_box$)/.test(b.nom);
  const memeCloture = (b, moi) => /_fence$/.test(b.nom) && (/^minecraft:nether_brick_fence$/.test(b.nom) === /^minecraft:nether_brick_fence$/.test(moi));
  const connecteCloture = (monde, b, pos, dir, moi) => {   // FenceBlock.connectsTo
    const solide = plein(monde, pos, OPPOSE[dir]);
    const portillon = /_fence_gate$/.test(b.nom) && axe(b.etat.facing) === axe(horaire(OPPOSE[dir]));
    return (!exception(monde, b) && solide) || memeCloture(b, moi) || portillon;
  };
  const connecteVitre = (monde, b, pos, dir) => {   // IronBarsBlock.attachsTo
    const solide = plein(monde, pos, OPPOSE[dir]);
    return (!exception(monde, b) && solide) || /(_pane|iron_bars)$/.test(b.nom) || /_wall$/.test(b.nom);
  };
  const liens = (monde, pos, moi, fn) => {
    const o = {};
    for (const d of HORIZ) { const p = decale(pos, d); o[d] = String(fn(monde, monde.bloc(...p), p, d, moi)); }
    return o;
  };
  for (const [classe, fn] of [['FenceBlock', connecteCloture], ['IronBarsBlock', connecteVitre]]) {
    mc.bloc(classe).sur('etatPose', (ev, monde) => { const b = defaut(ev); return avec(b, waterlogged(monde, ev, { ...b.etat, ...liens(monde, ev.pos, b.nom, fn) })); });
    mc.bloc(classe).sur('forme', (ev, monde) => {
      const d = JEU[ev.direction];
      if (d === 'up' || d === 'down') return undefined;
      const b = parseEtat(ev.etat), p = decale(ev.pos, d);
      const lien = String(fn(monde, parseEtat(ev.voisin), p, d, b.nom));
      return b.etat[d] === lien ? undefined : avec(b, { [d]: lien });
    });
  }
}
