// Famille "boutons" : boutons, leviers, plaques de pression. Port de ButtonBlock, LeverBlock, PressurePlateBlock, WeightedPressurePlateBlock
// (Horizon world/level/{interact,tick,redstone}.rs : MIT, voir ATTRIBUTIONS.md). Chaque duree vient des donnees du jeu
// (ticksToStayPressed : 20 pierre, 30 bois ; plaque : 20 ticks, plaque pesante : 10) et peut etre changee par une regle.
//   - Bouton : appui -> powered=true, tick planifie dans `ticksToStayPressed`, puis relache (son off). Un bouton deja enfonce ne repond plus.
//   - Levier : bascule, son block.lever.click (volume 0,3, hauteur 0,6 en marche et 0,5 a l'arret).
//   - Plaque : active des qu'une entite touche la zone (1..15, 0..4 px de haut) ; se relache au tick planifie suivant si plus personne (20 ticks).
import { avec, court, parseEtat } from './_aide.js';

export const DUREE_PLAQUE = 20, DUREE_PLAQUE_PESANTE = 10;
const ZONE_TOUCHE = [0.0625, 0, 0.0625, 0.9375, 0.25, 0.9375];   // PressurePlate TOUCH_AABB

export function installer(mc, regles) {
  regles.declarer('boutons.dureeBois', { def: 30, min: 1, max: 1200, entier: true, doc: 'ticks pendant lesquels un bouton de bois reste enfonce (jeu : 30)' });
  regles.declarer('boutons.dureePierre', { def: 20, min: 1, max: 1200, entier: true, doc: 'ticks pendant lesquels un bouton de pierre reste enfonce (jeu : 20)' });
  regles.declarer('plaques.delai', { def: 20, min: 1, max: 1200, entier: true, doc: 'ticks entre deux controles d\'une plaque de pression active, donc delai de relachement (jeu : 20 ; plaque pesante : 10)' });
  regles.declarer('plaques.delaiPesante', { def: 10, min: 1, max: 1200, entier: true, doc: 'idem pour les plaques pesantes (or, fer) (jeu : 10)' });
  regles.declarer('leviers.actif', { def: true, doc: 'les leviers repondent au clic (jeu : oui)' });

  // ButtonBlock/LeverBlock.updateNeighbours : le bloc lui-meme et le bloc sur lequel il est colle apprennent le changement de signal
  const devantAttache = (b) => {
    const face = b.etat.face, facing = b.etat.facing;
    return face === 'ceiling' ? [0, 1, 0] : face === 'floor' ? [0, -1, 0] : { north: [0, 0, 1], south: [0, 0, -1], west: [1, 0, 0], east: [-1, 0, 0] }[facing];
  };
  const notifierAttache = (monde, pos, b) => {
    const d = devantAttache(b), nom = court(b.nom);
    monde.notifierVoisins(pos[0], pos[1], pos[2], nom);
    monde.notifierVoisins(pos[0] + d[0], pos[1] + d[1], pos[2] + d[2], nom);
  };
  const notifierPlaque = (monde, pos, b) => {
    const nom = court(b.nom);
    monde.notifierVoisins(pos[0], pos[1], pos[2], nom);
    monde.notifierVoisins(pos[0], pos[1] - 1, pos[2], nom);
  };
  const typeDe = (monde, b) => monde.champs(court(b.nom))?.type ?? null;

  // ---------------------------------------------------------------- boutons
  const dureeBouton = (monde, b) => {
    const base = monde.champs(court(b.nom))?.ticksToStayPressed ?? 20;
    return base >= 30 ? monde.regle('boutons.dureeBois', base) : monde.regle('boutons.dureePierre', base);
  };
  const sonBouton = (monde, pos, b, on) => {
    const t = typeDe(monde, b), s = on ? t?.buttonClickOn : t?.buttonClickOff;
    if (s) monde.son(s, pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5, 1, 1);
  };
  mc.bloc('ButtonBlock').sur('utilise', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z);
    if (b.etat.powered === 'true') return 'passe';        // CONSUME : rien ne se passe, mais le clic est mange
    monde.poser(x, y, z, avec(b, { powered: 'true' }), 3);
    notifierAttache(monde, ev.pos, b);
    monde.planifier(x, y, z, dureeBouton(monde, b));
    sonBouton(monde, ev.pos, b, true);
    return 'fait';
  });
  mc.bloc('ButtonBlock').sur('tick', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z);
    if (b.etat.powered !== 'true') return;
    monde.poser(x, y, z, avec(b, { powered: 'false' }), 3);
    notifierAttache(monde, ev.pos, b);
    sonBouton(monde, ev.pos, b, false);
  });
  mc.bloc('ButtonBlock').sur('retire', (ev, monde) => {      // un bouton enfonce qu'on casse : le signal retombe (affectNeighborsAfterRemoval)
    if (ev.nouveau.startsWith('minecraft:' + ev.bloc) || ev.deplace || !(ev.drapeaux & 1)) return;
    const b = parseEtat(ev.etat);
    if (b.etat.powered === 'true') notifierAttache(monde, ev.pos, b);
  });
  mc.bloc('LeverBlock').sur('retire', (ev, monde) => {
    if (ev.nouveau.startsWith('minecraft:lever') || ev.deplace || !(ev.drapeaux & 1)) return;
    const b = parseEtat(ev.etat);
    if (b.etat.powered === 'true') notifierAttache(monde, ev.pos, b);
  });
  mc.bloc('ButtonBlock').sur('alimente', (ev, monde) => {   // signal direct : meme effet qu'un clic (appui) ou un relachement
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z), vrai = !!ev.alimente;
    if ((b.etat.powered === 'true') === vrai) return;
    monde.poser(x, y, z, avec(b, { powered: vrai ? 'true' : 'false' }), 3);
    notifierAttache(monde, ev.pos, b);
    if (vrai) monde.planifier(x, y, z, dureeBouton(monde, b));
    sonBouton(monde, ev.pos, b, vrai);
  });

  // ---------------------------------------------------------------- levier
  mc.bloc('LeverBlock').sur('utilise', (ev, monde) => {
    if (!monde.regle('leviers.actif', true)) return 'passe';
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z);
    const vrai = b.etat.powered !== 'true';
    monde.poser(x, y, z, avec(b, { powered: vrai ? 'true' : 'false' }), 3);
    notifierAttache(monde, ev.pos, b);
    monde.son('block.lever.click', x + 0.5, y + 0.5, z + 0.5, 0.3, vrai ? 0.6 : 0.5);
    return 'fait';
  });
  mc.bloc('LeverBlock').sur('alimente', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z), vrai = !!ev.alimente;
    if ((b.etat.powered === 'true') === vrai) return;
    monde.poser(x, y, z, avec(b, { powered: vrai ? 'true' : 'false' }), 3);
    notifierAttache(monde, ev.pos, b);
    monde.son('block.lever.click', x + 0.5, y + 0.5, z + 0.5, 0.3, vrai ? 0.6 : 0.5);
  });

  // ---------------------------------------------------------------- plaques de pression
  const signalDe = (b) => (b.etat.power !== undefined ? Number(b.etat.power) : b.etat.powered === 'true' ? 15 : 0);
  const avecSignal = (b, s) => (b.etat.power !== undefined ? avec(b, { power: String(s) }) : avec(b, { powered: s > 0 ? 'true' : 'false' }));
  const sonPlaque = (monde, pos, b, on) => {
    const t = typeDe(monde, b), s = on ? t?.pressurePlateClickOn : t?.pressurePlateClickOff;
    if (s) monde.son(s, pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5, 1, 1);
  };
  // getSignalStrength : entites qui touchent la zone de contact ; la plaque de pierre ne sent que les etres vivants (MOBS), la plaque de bois toute entite
  const compter = (monde, pos) => {
    const [x, y, z] = pos, boite = [x + ZONE_TOUCHE[0], y + ZONE_TOUCHE[1], z + ZONE_TOUCHE[2], x + ZONE_TOUCHE[3], y + ZONE_TOUCHE[4], z + ZONE_TOUCHE[5]];
    // BlockSetType.pressurePlateSensitivity : pierre et pierre noire polie = MOBS (vivants seulement) ; bois et plaques pesantes = EVERYTHING
    // (objets au sol, wagonnets, fleches comptent : partie 27)
    if (!/^(stone|polished_blackstone)_pressure_plate$/.test(monde.nom(x, y, z)) && monde.entitesDans) return monde.entitesDans(boite);
    return monde.entites({ boite }).filter((e) => !/minecart$|boat$/.test(e.typeCreature ?? '')).length;
  };
  const force = (monde, b, n) => {
    if (b.etat.power !== undefined) {                     // plaque pesante : ceil(min(n, maxWeight) / maxWeight * 15)
      const max = monde.champs(court(b.nom))?.maxWeight ?? 15;
      const m = Math.min(n, max);
      return m > 0 ? Math.ceil((m / max) * 15) : 0;
    }
    return n > 0 ? 15 : 0;
  };
  const delai = (monde, b) => (b.etat.power !== undefined ? monde.regle('plaques.delaiPesante', DUREE_PLAQUE_PESANTE) : monde.regle('plaques.delai', DUREE_PLAQUE));
  // BasePressurePlateBlock.checkPressed
  const verifier = (monde, pos) => {
    const [x, y, z] = pos, b = monde.bloc(x, y, z);
    const ancien = signalDe(b), nouveau = force(monde, b, compter(monde, pos));
    if (ancien !== nouveau) { monde.poser(x, y, z, avecSignal(b, nouveau), 2); notifierPlaque(monde, pos, b); }
    if (nouveau === 0 && ancien > 0) sonPlaque(monde, pos, b, false);
    else if (nouveau > 0 && ancien === 0) sonPlaque(monde, pos, b, true);
    if (nouveau > 0) monde.planifier(x, y, z, delai(monde, b));
  };
  for (const classe of ['PressurePlateBlock', 'WeightedPressurePlateBlock']) {
    mc.bloc(classe).sur('entre', (ev, monde) => { const b = monde.bloc(...ev.pos); if (signalDe(b) === 0) verifier(monde, ev.pos); });
    mc.bloc(classe).sur('tick', (ev, monde) => { const b = monde.bloc(...ev.pos); if (signalDe(b) > 0) verifier(monde, ev.pos); });
  }
  mc.bloc('BasePressurePlateBlock').sur('retire', (ev, monde) => {
    if (ev.nouveau.startsWith('minecraft:' + ev.bloc) || ev.deplace || !(ev.drapeaux & 1)) return;
    const b = parseEtat(ev.etat);
    if (signalDe(b) > 0) notifierPlaque(monde, ev.pos, b);
  });
  // une plaque survit sur une face rigide ou pleine du dessous (BasePressurePlateBlock.canSurvive : canSupportRigidBlock ou canSupportCenter)
  mc.bloc('BasePressurePlateBlock').sur('survit', (ev, monde) => monde.appui(ev.pos[0], ev.pos[1] - 1, ev.pos[2], 'haut', 'rigide') || monde.appui(ev.pos[0], ev.pos[1] - 1, ev.pos[2], 'haut', 'centre'));
  mc.bloc('BasePressurePlateBlock').sur('forme', (ev, monde) => (ev.direction === 'bas' && !monde.survit(...ev.pos) ? 'minecraft:air' : undefined));
  // bouton et levier : tombent quand leur appui disparait (FaceAttachedHorizontalDirectionalBlock.updateShape)
  mc.bloc('FaceAttachedHorizontalDirectionalBlock').sur('forme', (ev, monde) => {
    const b = monde.bloc(...ev.pos);
    const face = b.etat.face, facing = b.etat.facing;
    const vers = face === 'ceiling' ? 'haut' : face === 'floor' ? 'bas' : { north: 'sud', south: 'nord', west: 'est', east: 'ouest' }[facing];   // direction du bloc d'appui
    if (ev.direction === vers && !monde.survit(...ev.pos)) return 'minecraft:air';
    return undefined;
  });
  mc.bloc('FaceAttachedHorizontalDirectionalBlock').sur('survit', (ev, monde) => {
    const b = parseEtat(ev.etat), [x, y, z] = ev.pos;
    const face = b.etat.face, facing = b.etat.facing;
    // l'appui est derriere (mur), dessous (sol) ou dessus (plafond) ; la face du bloc d'appui qui regarde vers nous doit etre pleine
    const d = face === 'ceiling' ? [0, 1, 0, 'bas'] : face === 'floor' ? [0, -1, 0, 'haut'] : { north: [0, 0, 1, 'nord'], south: [0, 0, -1, 'sud'], west: [1, 0, 0, 'ouest'], east: [-1, 0, 0, 'est'] }[facing];
    return monde.appui(x + d[0], y + d[1], z + d[2], d[3], 'plein');
  });
}
