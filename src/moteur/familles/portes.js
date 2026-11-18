// Famille "portes" : portes, trappes et portillons. Ecrite avec la MEME API que les mods (tout est remplacable ou enveloppable) :
// mc.bloc('DoorBlock').sur('utilise', ...). Port de DoorBlock / TrapDoorBlock / FenceGateBlock (Horizon world/level/{interact,hooks,survive,place}.rs
// et BlockSetType des donnees : MIT, voir ATTRIBUTIONS.md).
//   - Une porte s'ouvre par un changement d'etat INSTANTANE (open=true), pas par une animation : le modele ouvert est un autre modele.
//   - Les deux moities se synchronisent par la mise a jour de forme (DoorBlock.updateShape), comme dans le jeu.
//   - Porte en fer : `canOpenByHand` faux dans les donnees -> pas a la main ; seulement par signal (monde.alimenter) ou par la regle portes.fer.
import { FR, JEU, HORIZ, OPPOSE, VEC, horaire, antihoraire, avec, court, parseEtat } from './_aide.js';

export function installer(mc, regles) {
  regles.declarer('portes.fer', { def: false, doc: 'les portes et trappes en fer s\'ouvrent a la main (jeu : non, il faut un signal)' });
  regles.declarer('portes.mainLibre', { def: true, doc: 'les portes en bois, trappes et portillons s\'ouvrent a la main (jeu : oui)' });

  const typeDe = (monde, b) => monde.champs(court(b.nom))?.type ?? null;
  const parse = (txt) => { const i = txt.indexOf('['); const o = { nom: i < 0 ? txt : txt.slice(0, i), etat: {} }; if (i >= 0) for (const kv of txt.slice(i + 1, -1).split(',')) { const [k, v] = kv.split('='); o.etat[k] = v; } return o; };
  const ouvrableMain = (monde, b) => { const t = typeDe(monde, b); if (!monde.regle('portes.mainLibre', true)) return false; return !!t?.canOpenByHand || monde.regle('portes.fer', false); };
  const hauteurSon = (monde) => monde.hasard.flottant() * 0.1 + 0.9;

  // ---------------------------------------------------------------- portes
  // DoorBlock.useWithoutItem : cycle(OPEN), setBlock(..., 10), son, game event
  const sonPorte = (monde, pos, b, ouvre) => {
    const t = typeDe(monde, b);
    const s = ouvre ? t?.doorOpen : t?.doorClose;
    if (s) monde.son(s, pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5, 1, hauteurSon(monde));
  };
  const basculerPorte = (monde, pos, b, ouvre) => {
    monde.poser(pos[0], pos[1], pos[2], avec(b, { open: ouvre ? 'true' : 'false' }), 10);
    sonPorte(monde, pos, b, ouvre);
  };
  mc.bloc('DoorBlock').sur('utilise', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z);
    if (!ouvrableMain(monde, b)) return 'passe';
    basculerPorte(monde, ev.pos, b, b.etat.open !== 'true');
    return 'fait';
  });
  // signal direct (DoorBlock.neighborChanged) : powered et open suivent le signal ; son seulement si l'etat ouvert change
  mc.bloc('DoorBlock').sur('alimente', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z);
    const vrai = !!ev.alimente;
    if (vrai !== (b.etat.powered === 'true')) {
      if (vrai !== (b.etat.open === 'true')) sonPorte(monde, ev.pos, b, vrai);
      monde.poser(x, y, z, avec(b, { powered: vrai ? 'true' : 'false', open: vrai ? 'true' : 'false' }), 2);
    }
  });
  // DoorBlock.neighborChanged : un signal sur l'une des deux moities ouvre la porte ; seul le bloc qui n'est pas la porte elle-meme change (changed != this)
  mc.bloc('DoorBlock').sur('voisin', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z);
    const autre = b.etat.half === 'lower' ? 1 : -1;
    const signal = monde.aSignalVoisin(x, y, z) || monde.aSignalVoisin(x, y + autre, z);
    if (ev.blocSource !== court(b.nom) && signal !== (b.etat.powered === 'true')) {
      if (signal !== (b.etat.open === 'true')) sonPorte(monde, ev.pos, b, signal);
      monde.poser(x, y, z, avec(b, { powered: String(signal), open: String(signal) }), 2);
    }
  });
  // DoorBlock.updateShape : la moitie voisine recopie l'etat ; sans moitie, la porte disparait
  mc.bloc('DoorBlock').sur('forme', (ev, monde) => {
    const b = monde.bloc(...ev.pos), half = b.etat.half, dir = ev.direction;
    if ((dir === 'haut' || dir === 'bas') && ((half === 'lower') === (dir === 'haut'))) {
      const n = parse(ev.voisin);
      if (n.nom === b.nom && n.etat.half !== half) return avec(n, { half });
      return 'minecraft:air';
    }
    if (half === 'lower' && dir === 'bas' && !monde.survit(...ev.pos)) return 'minecraft:air';
    return undefined;
  });
  mc.bloc('DoorBlock').sur('survit', (ev, monde) => {
    const [x, y, z] = ev.pos, b = parseEtat(ev.etat);
    if (b.etat.half === 'upper') { const bas = monde.bloc(x, y - 1, z); return bas.nom === b.nom && bas.etat.half === 'lower'; }
    return monde.appui(x, y - 1, z, 'haut', 'plein');
  });

  // ---------------------------------------------------------------- trappes (TrapDoorBlock)
  const sonTrappe = (monde, pos, b, ouvre) => {
    const t = typeDe(monde, b);
    const s = ouvre ? t?.trapdoorOpen : t?.trapdoorClose;
    if (s) monde.son(s, pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5, 1, hauteurSon(monde));
  };
  mc.bloc('TrapDoorBlock').sur('utilise', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z);
    if (!ouvrableMain(monde, b)) return 'passe';
    const ouvre = b.etat.open !== 'true';
    monde.poser(x, y, z, avec(b, { open: ouvre ? 'true' : 'false' }), 2);
    sonTrappe(monde, ev.pos, b, ouvre);
    return 'fait';
  });
  mc.bloc('TrapDoorBlock').sur('alimente', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z);
    const vrai = !!ev.alimente;
    if (vrai !== (b.etat.powered === 'true')) {
      if (vrai !== (b.etat.open === 'true')) sonTrappe(monde, ev.pos, b, vrai);
      monde.poser(x, y, z, avec(b, { powered: vrai ? 'true' : 'false', open: vrai ? 'true' : 'false' }), 2);
    }
  });

  mc.bloc('TrapDoorBlock').sur('voisin', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z), signal = monde.aSignalVoisin(x, y, z);
    if (signal === (b.etat.powered === 'true')) return;
    const modifs = { powered: String(signal) };
    if ((b.etat.open === 'true') !== signal) { modifs.open = String(signal); sonTrappe(monde, ev.pos, b, signal); }
    monde.poser(x, y, z, avec(b, modifs), 2);
    if (b.etat.waterlogged === 'true') monde.planifierFluide(x, y, z, 5);
  });

  // ---------------------------------------------------------------- portillons (FenceGateBlock)
  mc.bloc('FenceGateBlock').sur('utilise', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z);
    if (!monde.regle('portes.mainLibre', true) && !ev.vent) return 'passe';
    let suivant;
    if (b.etat.open === 'true') suivant = avec(b, { open: 'false' });
    else if (ev.vent) suivant = avec(b, { open: 'true' });   // rafale d'une charge de vent (FenceGateBlock.onExplosionHit) : il s'ouvre sans se retourner
    else {
      // si le joueur est de l'autre cote, le portillon se retourne vers lui (il s'ouvre en s'eloignant de lui)
      const dir = dirDeLacetLocal(ev.lacet);
      let facing = b.etat.facing;
      if (facing === OPPOSE[dir]) facing = dir;
      suivant = avec(b, { facing, open: 'true' });
    }
    monde.poser(x, y, z, suivant, 10);
    const ouvre = parse(suivant).etat.open === 'true';
    const t = typeDe(monde, b);
    const s = ouvre ? t?.fenceGateOpen : t?.fenceGateClose;
    if (s) monde.son(s, x + 0.5, y + 0.5, z + 0.5, 1, hauteurSon(monde));
    return 'fait';
  });
  mc.bloc('FenceGateBlock').sur('alimente', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z);
    const vrai = !!ev.alimente;
    if (vrai !== (b.etat.powered === 'true')) {
      if (vrai !== (b.etat.open === 'true')) { const t = typeDe(monde, b); const s = vrai ? t?.fenceGateOpen : t?.fenceGateClose; if (s) monde.son(s, x + 0.5, y + 0.5, z + 0.5, 1, hauteurSon(monde)); }
      monde.poser(x, y, z, avec(b, { powered: vrai ? 'true' : 'false', open: vrai ? 'true' : 'false' }), 2);
    }
  });
  mc.bloc('FenceGateBlock').sur('voisin', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z), signal = monde.aSignalVoisin(x, y, z);
    if (signal === (b.etat.powered === 'true')) return;
    monde.poser(x, y, z, avec(b, { powered: String(signal), open: String(signal) }), 2);
    if ((b.etat.open === 'true') !== signal) { const t = typeDe(monde, b); const s2 = signal ? t?.fenceGateOpen : t?.fenceGateClose; if (s2) monde.son(s2, x + 0.5, y + 0.5, z + 0.5, 1, hauteurSon(monde)); }
  });
  // FenceGateBlock.updateShape : in_wall suit les murs voisins sur les cotes du portillon
  mc.bloc('FenceGateBlock').sur('forme', (ev, monde) => {
    const b = monde.bloc(...ev.pos), facing = b.etat.facing, dir = JEU[ev.direction];
    if (dir === 'up' || dir === 'down') return undefined;
    if ((facing === 'north' || facing === 'south') === (dir === 'north' || dir === 'south')) return undefined;   // meme axe : pas de changement
    const estMur = (txt) => /^minecraft:[a-z_]*_wall(\[|$)/.test(txt);
    const autre = monde.bloc(ev.pos[0] + VEC[OPPOSE[dir]][0], ev.pos[1], ev.pos[2] + VEC[OPPOSE[dir]][2]);
    const dedans = estMur(ev.voisin) || estMur(autre.chaine);
    return b.etat.in_wall === String(dedans) ? undefined : avec(b, { in_wall: String(dedans) });
  });
}

// Direction horizontale du lacet (le meme calcul que _aide.dirDeLacet, ecrit ici pour ne pas melanger les imports)
function dirDeLacetLocal(lacet) { return ['south', 'west', 'north', 'east'][Math.floor((lacet ?? 0) / 90 + 0.5) & 3]; }
void FR; void HORIZ; void horaire; void antihoraire;
