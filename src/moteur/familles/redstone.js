// Famille "redstone" : poudre, torche, repeteur, comparateur, observateur, lampe, cible, detecteur de lumiere du jour, bloc de cuivre a ampoule.
// Ecrite avec la MEME API que les mods (tout est remplacable ou enveloppable : mc.bloc('RedstoneTorchBlock').entoure('tick', ...)).
// Port de Horizon world/level/{redstone,hooks,shapes}.rs (RedStoneWireBlock, RedstoneTorchBlock, DiodeBlock, RepeaterBlock, ComparatorBlock,
// ObserverBlock, RedstoneLampBlock, TargetBlock, DaylightDetectorBlock : MIT, voir ATTRIBUTIONS.md).
// Le modele de signal (getSignal, getDirectSignal, conduit ou non) et la poudre sont dans moteur/redstone.js (API : monde.signal, monde.fil...).
//
// Chiffres du jeu : poudre -1 par bloc ; torche : inverse, 2 ticks ; grille apres 8 changements en 60 ticks (puis 160 ticks de pause) ;
// repeteur : 1 a 4 crans = 2, 4, 6, 8 ticks ; comparateur : 2 ticks ; observateur : impulsion de 2 ticks apres un delai de 2 ; lampe : s'allume
// tout de suite, s'eteint 4 ticks apres ; cible : 8 ticks (20 pour une fleche).
import { FR, JEU, OPPOSE, horaire, antihoraire, avec, parseEtat } from './_aide.js';

const PRIO = { extremementHaute: -3, tresHaute: -2, haute: -1, normale: 0 };

export function installer(mc, regles) {
  regles.declarer('redstone.actif', { def: true, doc: 'la redstone fonctionne (faux : les blocs de redstone ne reagissent plus aux voisins)' });
  regles.declarer('redstone.amorcage', { def: true, doc: 'au tick 0, chaque composant de redstone present dans la zone (ou un decor) apprend que ses voisins ont change : les circuits poses sans etre calcules se stabilisent' });
  regles.declarer('redstone.portee', { def: 15, min: 1, max: 15, entier: true, doc: 'puissance maximale de la poudre (jeu : 15 ; la poudre perd 1 par bloc)' });
  regles.declarer('redstone.delaiTorche', { def: 2, min: 1, max: 200, entier: true, doc: 'ticks de retard d\'une torche de redstone (jeu : 2)' });
  regles.declarer('redstone.torcheGrille', { def: 8, min: 2, max: 1000, entier: true, doc: 'nombre de changements en `redstone.torcheFenetre` ticks apres lesquels une torche grille (jeu : 8)' });
  regles.declarer('redstone.torcheFenetre', { def: 60, min: 2, max: 1200, entier: true, doc: 'fenetre en ticks du compteur de grille des torches (jeu : 60)' });
  regles.declarer('redstone.torchePause', { def: 160, min: 1, max: 12000, entier: true, doc: 'ticks pendant lesquels une torche grillee reste eteinte (jeu : 160)' });
  regles.declarer('redstone.delaiRepeteur', { def: 2, min: 1, max: 100, entier: true, doc: 'ticks par cran d\'un repeteur : 1 cran = 1 fois cette valeur... (jeu : 2, soit 2, 4, 6, 8 ticks)' });
  regles.declarer('redstone.delaiComparateur', { def: 2, min: 1, max: 100, entier: true, doc: 'ticks de retard d\'un comparateur (jeu : 2)' });
  regles.declarer('redstone.impulsionObservateur', { def: 2, min: 1, max: 100, entier: true, doc: 'ticks entre le changement vu et l\'impulsion, et duree de l\'impulsion d\'un observateur (jeu : 2)' });
  regles.declarer('redstone.delaiLampe', { def: 4, min: 1, max: 200, entier: true, doc: 'ticks avant qu\'une lampe de redstone sans signal s\'eteigne (jeu : 4)' });
  regles.declarer('redstone.delaiCible', { def: 8, min: 1, max: 200, entier: true, doc: 'ticks avant qu\'une cible touchee retombe a 0 (jeu : 8 ; fleche : 20)' });

  // ---------------------------------------------------------------- aides
  const dirDe = (monde, x, y, z) => FR[monde.prop(x, y, z, 'facing')];                 // 'nord'...
  const vec = { bas: [0, -1, 0], haut: [0, 1, 0], nord: [0, 0, -1], sud: [0, 0, 1], ouest: [-1, 0, 0], est: [1, 0, 0] };
  const rel = (x, y, z, f, n = 1) => [x + vec[f][0] * n, y + vec[f][1] * n, z + vec[f][2] * n];
  const oppose = { bas: 'haut', haut: 'bas', nord: 'sud', sud: 'nord', ouest: 'est', est: 'ouest' };
  const horaireFr = (f) => FR[horaire(JEU[f])], antihoraireFr = (f) => FR[antihoraire(JEU[f])];
  const set = (monde, x, y, z, modifs, flags) => monde.poser(x, y, z, monde.etatAvec(x, y, z, modifs), flags);
  const tousLesCotes = ['bas', 'haut', 'nord', 'sud', 'ouest', 'est'];
  const bloc = (ev) => ev.bloc;   // nom court du bloc de l'evenement

  // ---------------------------------------------------------------- poudre de redstone
  const FIL = 'RedstoneWireBlock';
  mc.bloc(FIL).sur('etatPose', (ev, monde) => monde.texteEtat(monde.fil.etatPose(...ev.pos)));
  mc.bloc(FIL).sur('forme', (ev, monde) => (monde.regle('redstone.actif', true) ? monde.fil.forme(...ev.pos, ev.direction) : undefined));
  mc.bloc(FIL).sur('survit', (ev, monde) => monde.fil.survit(...ev.pos));
  mc.bloc(FIL).sur('voisin', (ev, monde) => {
    if (!monde.regle('redstone.actif', true)) return;
    const [x, y, z] = ev.pos;
    if (monde.fil.survit(x, y, z)) monde.fil.majPuissanceDe(x, y, z, ev.etat);
    else { monde.casser(x, y, z); }     // dropResources + removeBlock
  });
  mc.bloc(FIL).sur('pose', (ev, monde) => {
    if (ev.memeBloc || !monde.regle('redstone.actif', true)) return;
    const [x, y, z] = ev.pos;
    monde.fil.majPuissanceDe(x, y, z, ev.etat);
    monde.notifierVoisins(x, y + 1, z, 'redstone_wire');
    monde.notifierVoisins(x, y - 1, z, 'redstone_wire');
    monde.fil.voisinsDesFils(x, y, z);
  });
  mc.bloc(FIL).sur('retire', (ev, monde) => {
    if (ev.deplace || !(ev.drapeaux & 1) || !monde.regle('redstone.actif', true)) return;
    const [x, y, z] = ev.pos;
    for (const f of tousLesCotes) { const [a, b, c] = rel(x, y, z, f); monde.notifierVoisins(a, b, c, 'redstone_wire'); }
    monde.fil.majPuissanceDe(x, y, z, ev.etat);
    monde.fil.voisinsDesFils(x, y, z);
  });

  // ---------------------------------------------------------------- torche de redstone (RedstoneTorchBlock, mur compris)
  const TORCHE = 'RedstoneTorchBlock';
  const bascules = [];                       // [x, y, z, tick] : changements recents (Ticks.torch_toggles)
  const torcheVoitSignal = (monde, x, y, z) => {
    if (monde.nom(x, y, z) === 'redstone_wall_torch') { const o = oppose[dirDe(monde, x, y, z)]; const [a, b, c] = rel(x, y, z, o); return monde.signal(a, b, c, o) > 0; }
    return monde.signal(x, y - 1, z, 'bas') > 0;
  };
  const tropBascule = (monde, x, y, z, ajoute) => {
    if (ajoute) bascules.push([x, y, z, monde.tick()]);
    let n = 0;
    for (const b of bascules) if (b[0] === x && b[1] === y && b[2] === z && n < 8) n++;
    return bascules.filter((b) => b[0] === x && b[1] === y && b[2] === z).length >= monde.regle('redstone.torcheGrille', 8);
  };
  const torcheNotifie = (monde, x, y, z) => { for (const f of tousLesCotes) { const [a, b, c] = rel(x, y, z, f); monde.notifierVoisins(a, b, c, 'redstone_torch'); } };
  mc.bloc(TORCHE).sur('pose', (ev, monde) => { if (monde.regle('redstone.actif', true)) torcheNotifie(monde, ...ev.pos); });
  mc.bloc(TORCHE).sur('retire', (ev, monde) => { if (!ev.deplace && (ev.drapeaux & 1)) torcheNotifie(monde, ...ev.pos); });
  mc.bloc(TORCHE).sur('voisin', (ev, monde) => {
    if (!monde.regle('redstone.actif', true)) return;
    const [x, y, z] = ev.pos;
    if ((monde.prop(x, y, z, 'lit') === 'true') === torcheVoitSignal(monde, x, y, z) && !monde.tickCeTick(x, y, z)) monde.planifier(x, y, z, monde.regle('redstone.delaiTorche', 2));
  });
  mc.bloc(TORCHE).sur('tick', (ev, monde) => {
    const [x, y, z] = ev.pos, signal = torcheVoitSignal(monde, x, y, z), temps = monde.tick();
    const fenetre = monde.regle('redstone.torcheFenetre', 60);
    while (bascules.length && temps - bascules[0][3] > fenetre) bascules.shift();
    if (monde.prop(x, y, z, 'lit') === 'true') {
      if (signal) {
        set(monde, x, y, z, { lit: 'false' }, 3);
        if (tropBascule(monde, x, y, z, true)) {            // grillee : fumee, bruit, et pause avant de pouvoir se rallumer
          const ev2 = { pos: [x, y, z], annule: false };
          monde.evenement('redstone.torcheGrille', ev2);
          monde.son('block.redstone_torch.burnout', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.6 + (monde.hasard.flottant() - monde.hasard.flottant()) * 0.8);
          monde.particule('smoke', x + 0.5, y + 0.7, z + 0.5, 0, 0, 0, 5);
          monde.planifier(x, y, z, monde.regle('redstone.torchePause', 160));
        }
      }
    } else if (!signal && !tropBascule(monde, x, y, z, false)) set(monde, x, y, z, { lit: 'true' }, 3);
  });

  // ---------------------------------------------------------------- repeteur et comparateur (DiodeBlock)
  const DIODE = 'DiodeBlock';
  const estRepeteur = (monde, x, y, z) => monde.nom(x, y, z) === 'repeater';
  const retard = (monde, x, y, z) => (estRepeteur(monde, x, y, z) ? Number(monde.prop(x, y, z, 'delay')) * monde.regle('redstone.delaiRepeteur', 2) : monde.regle('redstone.delaiComparateur', 2));
  const signalLateral = (monde, x, y, z) => {
    const f = dirDe(monde, x, y, z), seulementDiodes = estRepeteur(monde, x, y, z);
    const cw = horaireFr(f), ccw = antihoraireFr(f);
    const [a, b, c] = rel(x, y, z, cw), [d, e, g] = rel(x, y, z, ccw);
    return Math.max(monde.signalControle(a, b, c, cw, seulementDiodes), monde.signalControle(d, e, g, ccw, seulementDiodes));
  };
  const verrouille = (monde, x, y, z) => estRepeteur(monde, x, y, z) && signalLateral(monde, x, y, z) > 0;
  const entree = (monde, x, y, z) => {                          // DiodeBlock.getInputSignal / ComparatorBlock.getInputSignal
    const f = dirDe(monde, x, y, z), [tx, ty, tz] = rel(x, y, z, f);
    const entrant = monde.signal(tx, ty, tz, f);
    let r = entrant >= 15 ? entrant : Math.max(entrant, monde.nom(tx, ty, tz) === 'redstone_wire' ? Number(monde.prop(tx, ty, tz, 'power')) : 0);
    if (!estRepeteur(monde, x, y, z)) {
      const analogue = monde.sortieAnalogique(tx, ty, tz, oppose[f]);
      if (analogue >= 0) r = analogue;
      else if (r < 15 && monde.conducteur(tx, ty, tz)) {
        const [ux, uy, uz] = rel(tx, ty, tz, f), a2 = monde.sortieAnalogique(ux, uy, uz, oppose[f]);
        if (a2 >= 0) r = a2;
      }
    }
    return r;
  };
  const doitAllumer = (monde, x, y, z) => {
    if (estRepeteur(monde, x, y, z)) return entree(monde, x, y, z) > 0;
    const e = entree(monde, x, y, z);
    if (e === 0) return false;
    const lateral = signalLateral(monde, x, y, z);
    return e > lateral || (e === lateral && monde.prop(x, y, z, 'mode') === 'compare');
  };
  const sortieComparateur = (monde, x, y, z) => {
    const e = entree(monde, x, y, z);
    if (e === 0) return 0;
    const l = signalLateral(monde, x, y, z);
    if (l > e) return 0;
    return monde.prop(x, y, z, 'mode') === 'subtract' ? e - l : e;
  };
  const priorite = (monde, x, y, z) => {                         // shouldPrioritize : une diode d'une autre direction juste derriere
    const f = oppose[dirDe(monde, x, y, z)], [a, b, c] = rel(x, y, z, f);
    const n = monde.nom(a, b, c);
    return (n === 'repeater' || n === 'comparator') && FR[monde.prop(a, b, c, 'facing')] !== f;
  };
  const diodeNotifieDevant = (monde, x, y, z, f, nom) => {        // updateNeighborsInFront
    const [a, b, c] = rel(x, y, z, oppose[f]);
    monde.voisinChange(a, b, c, nom);
    monde.notifierVoisins(a, b, c, nom, f);
  };
  mc.bloc(DIODE).sur('survit', (ev, monde) => monde.appui(ev.pos[0], ev.pos[1] - 1, ev.pos[2], 'haut', 'rigide'));
  mc.bloc(DIODE).sur('forme', (ev, monde) => {
    const [x, y, z] = ev.pos;
    if (ev.direction === 'bas' && !monde.survit(x, y, z)) return 'minecraft:air';
    if (estRepeteur(monde, x, y, z)) {
      const f = dirDe(monde, x, y, z), axe = (d) => (d === 'nord' || d === 'sud' ? 'z' : d === 'est' || d === 'ouest' ? 'x' : 'y');
      if (axe(ev.direction) !== axe(f)) return monde.etatAvec(x, y, z, { locked: String(verrouille(monde, x, y, z)) });
    }
    return undefined;
  });
  mc.bloc(DIODE).sur('pose', (ev, monde) => { if (monde.regle('redstone.actif', true)) diodeNotifieDevant(monde, ev.pos[0], ev.pos[1], ev.pos[2], dirDe(monde, ...ev.pos), ev.bloc); });
  mc.bloc(DIODE).sur('retire', (ev, monde) => {
    const [x, y, z] = ev.pos;
    if (ev.nouveau.startsWith('minecraft:' + ev.bloc)) return;                 // meme bloc : pas retire
    monde.oublierSortieComparateur(x, y, z);
    if (!ev.deplace && (ev.drapeaux & 1)) diodeNotifieDevant(monde, x, y, z, FR[parseEtat(ev.etat).etat.facing], ev.bloc);
  });
  mc.bloc(DIODE).sur('voisin', (ev, monde) => {
    if (!monde.regle('redstone.actif', true)) return;
    const [x, y, z] = ev.pos;
    if (!monde.survit(x, y, z)) {
      monde.casser(x, y, z);
      for (const f of tousLesCotes) { const [a, b, c] = rel(x, y, z, f); monde.notifierVoisins(a, b, c, ev.bloc); }
      return;
    }
    // checkTickOnNeighbor
    if (!estRepeteur(monde, x, y, z)) {
      if (!monde.tickCeTick(x, y, z)) {
        const sortie = sortieComparateur(monde, x, y, z), ancienne = monde.sortieComparateur(x, y, z);
        if (sortie !== ancienne || (monde.prop(x, y, z, 'powered') === 'true') !== doitAllumer(monde, x, y, z)) monde.planifier(x, y, z, 2, priorite(monde, x, y, z) ? PRIO.haute : PRIO.normale);
      }
      return;
    }
    if (verrouille(monde, x, y, z)) return;
    const allume = monde.prop(x, y, z, 'powered') === 'true', doit = doitAllumer(monde, x, y, z);
    if (allume !== doit && !monde.tickCeTick(x, y, z)) monde.planifier(x, y, z, retard(monde, x, y, z), priorite(monde, x, y, z) ? PRIO.extremementHaute : allume ? PRIO.tresHaute : PRIO.haute);
  });
  mc.bloc(DIODE).sur('tick', (ev, monde) => {
    const [x, y, z] = ev.pos;
    if (!estRepeteur(monde, x, y, z)) {                           // ComparatorBlock.refreshOutputState
      const sortie = sortieComparateur(monde, x, y, z), ancienne = monde.fixerSortieComparateur(x, y, z, sortie);
      if (ancienne !== sortie || monde.prop(x, y, z, 'mode') === 'compare') {
        const doit = doitAllumer(monde, x, y, z), allume = monde.prop(x, y, z, 'powered') === 'true';
        if (allume && !doit) set(monde, x, y, z, { powered: 'false' }, 2);
        else if (!allume && doit) set(monde, x, y, z, { powered: 'true' }, 2);
        diodeNotifieDevant(monde, x, y, z, dirDe(monde, x, y, z), ev.bloc);
      }
      return;
    }
    if (verrouille(monde, x, y, z)) return;
    const allume = monde.prop(x, y, z, 'powered') === 'true', doit = doitAllumer(monde, x, y, z);
    if (allume && !doit) set(monde, x, y, z, { powered: 'false' }, 2);
    else if (!allume) {
      set(monde, x, y, z, { powered: 'true' }, 2);
      if (!doit) monde.planifier(x, y, z, retard(monde, x, y, z), PRIO.tresHaute);
    }
  });
  // un repeteur se regle d'un clic droit (+1 cran, 4 -> 1) ; un comparateur change de mode (clic) avec son bruit
  mc.bloc('RepeaterBlock').sur('utilise', (ev, monde) => {
    const [x, y, z] = ev.pos, n = Number(monde.prop(x, y, z, 'delay')) % 4 + 1;
    set(monde, x, y, z, { delay: String(n) }, 3);
    return 'fait';
  });
  mc.bloc('ComparatorBlock').sur('utilise', (ev, monde) => {
    const [x, y, z] = ev.pos, m = monde.prop(x, y, z, 'mode') === 'compare' ? 'subtract' : 'compare';
    monde.son('block.comparator.click', x + 0.5, y + 0.5, z + 0.5, 0.3, m === 'subtract' ? 0.55 : 0.5);
    set(monde, x, y, z, { mode: m }, 2);
    const sortie = sortieComparateur(monde, x, y, z), ancienne = monde.fixerSortieComparateur(x, y, z, sortie);   // refreshOutputState
    void ancienne;
    const doit = doitAllumer(monde, x, y, z), allume = monde.prop(x, y, z, 'powered') === 'true';
    if (allume !== doit) set(monde, x, y, z, { powered: String(doit) }, 2);
    diodeNotifieDevant(monde, x, y, z, dirDe(monde, x, y, z), 'comparator');
    return 'fait';
  });

  // ---------------------------------------------------------------- observateur
  const observateurNotifie = (monde, x, y, z, f, nom) => {
    const [a, b, c] = rel(x, y, z, oppose[f]);
    monde.voisinChange(a, b, c, nom);
    monde.notifierVoisins(a, b, c, nom, f);
  };
  mc.bloc('ObserverBlock').sur('forme', (ev, monde) => {
    const [x, y, z] = ev.pos;
    if (dirDe(monde, x, y, z) === ev.direction && monde.prop(x, y, z, 'powered') !== 'true' && !monde.aTickPlanifie(x, y, z)) monde.planifier(x, y, z, monde.regle('redstone.impulsionObservateur', 2));
    return undefined;
  });
  mc.bloc('ObserverBlock').sur('tick', (ev, monde) => {
    const [x, y, z] = ev.pos, d = monde.regle('redstone.impulsionObservateur', 2);
    if (monde.prop(x, y, z, 'powered') === 'true') set(monde, x, y, z, { powered: 'false' }, 2);
    else { set(monde, x, y, z, { powered: 'true' }, 2); monde.planifier(x, y, z, d); }
    observateurNotifie(monde, x, y, z, dirDe(monde, x, y, z), 'observer');
  });
  mc.bloc('ObserverBlock').sur('pose', (ev, monde) => {
    const [x, y, z] = ev.pos;
    if (!ev.memeBloc && monde.prop(x, y, z, 'powered') === 'true' && !monde.aTickPlanifie(x, y, z)) {
      set(monde, x, y, z, { powered: 'false' }, 18);
      observateurNotifie(monde, x, y, z, dirDe(monde, x, y, z), 'observer');
    }
  });
  mc.bloc('ObserverBlock').sur('retire', (ev, monde) => {
    const [x, y, z] = ev.pos;
    if (ev.nouveau.startsWith('minecraft:observer')) return;
    const p = parseEtat(ev.etat).etat;
    if (p.powered === 'true' && monde.aTickPlanifie(x, y, z)) observateurNotifie(monde, x, y, z, FR[p.facing], 'observer');
  });

  // ---------------------------------------------------------------- lampe de redstone
  mc.bloc('RedstoneLampBlock').sur('etatPose', (ev, monde) => {
    const [x, y, z] = ev.pos;
    return avec(parseEtat(ev.etat), { lit: String(monde.aSignalVoisin(x, y, z)) });
  });
  mc.bloc('RedstoneLampBlock').sur('voisin', (ev, monde) => {
    if (!monde.regle('redstone.actif', true)) return;
    const [x, y, z] = ev.pos, allumee = monde.prop(x, y, z, 'lit') === 'true';
    if (allumee !== monde.aSignalVoisin(x, y, z)) {
      if (allumee) monde.planifier(x, y, z, monde.regle('redstone.delaiLampe', 4));
      else set(monde, x, y, z, { lit: 'true' }, 2);
    }
  });
  mc.bloc('RedstoneLampBlock').sur('tick', (ev, monde) => {
    const [x, y, z] = ev.pos;
    if (monde.prop(x, y, z, 'lit') === 'true' && !monde.aSignalVoisin(x, y, z)) set(monde, x, y, z, { lit: 'false' }, 2);
  });

  // ---------------------------------------------------------------- ampoule de cuivre (CopperBulbBlock.checkAndFlip)
  const ampoule = (monde, x, y, z) => {
    const signal = monde.aSignalVoisin(x, y, z), alimente = monde.prop(x, y, z, 'powered') === 'true';
    if (signal === alimente) return;
    const modifs = { powered: String(signal) };
    if (!alimente) {
      modifs.lit = monde.prop(x, y, z, 'lit') === 'true' ? 'false' : 'true';
      monde.son(modifs.lit === 'true' ? 'block.copper_bulb.turn_on' : 'block.copper_bulb.turn_off', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    }
    set(monde, x, y, z, modifs, 3);
  };
  mc.bloc('CopperBulbBlock').sur('voisin', (ev, monde) => ampoule(monde, ...ev.pos));
  mc.bloc('CopperBulbBlock').sur('pose', (ev, monde) => { if (!ev.memeBloc) ampoule(monde, ...ev.pos); });

  // ---------------------------------------------------------------- cible (TargetBlock) : touchee par un projectile (evenement du monde redstone.cible)
  mc.bloc('TargetBlock').sur('tick', (ev, monde) => { const [x, y, z] = ev.pos; if (Number(monde.prop(x, y, z, 'power')) !== 0) set(monde, x, y, z, { power: '0' }, 3); });
  mc.bloc('TargetBlock').sur('pose', (ev, monde) => {
    const [x, y, z] = ev.pos;
    if (!ev.memeBloc && Number(monde.prop(x, y, z, 'power')) > 0 && !monde.aTickPlanifie(x, y, z)) set(monde, x, y, z, { power: '0' }, 18);
  });
  // une cible touchee : force 1 a 15 (distance au centre de la face), retombe apres 8 ticks (20 pour une fleche)
  mc.monde.sur('redstone.cible', (ev, monde) => {
    const [x, y, z] = ev.pos;
    if (monde.nom(x, y, z) !== 'target') return;
    const force = Math.max(1, Math.min(15, ev.force | 0 || 15));
    if (!monde.aTickPlanifie(x, y, z)) { set(monde, x, y, z, { power: String(force) }, 3); monde.planifier(x, y, z, ev.fleche ? 20 : monde.regle('redstone.delaiCible', 8)); }
    ev.force = force;
  });

  // ---------------------------------------------------------------- detecteur de lumiere du jour (utilise `ciel.heure` de la scene)
  const detecteurs = new Set();
  mc.bloc('DaylightDetectorBlock').sur('pose', (ev, monde) => { detecteurs.add(ev.pos.join(',')); majDetecteur(monde, ...ev.pos); });
  mc.bloc('DaylightDetectorBlock').sur('retire', (ev) => { if (!ev.nouveau.startsWith('minecraft:daylight_detector')) detecteurs.delete(ev.pos.join(',')); });
  mc.bloc('DaylightDetectorBlock').sur('utilise', (ev, monde) => {
    const [x, y, z] = ev.pos;
    set(monde, x, y, z, { inverted: monde.prop(x, y, z, 'inverted') === 'true' ? 'false' : 'true' }, 2);
    majDetecteur(monde, x, y, z);
    return 'fait';
  });
  function majDetecteur(monde, x, y, z) {
    const h = monde.heure();
    const g = Math.max(0, Math.min(1, Math.cos(((h - 12) / 24) * 2 * Math.PI) * 2 + 0.5));
    const sombre = Math.floor((1 - g) * 11);                                    // skyDarken
    let cible = Math.max(0, monde.lumiere(x, y, z).ciel - sombre);
    if (monde.prop(x, y, z, 'inverted') === 'true') cible = 15 - cible;
    else if (cible > 0) {
      // angle du soleil du jeu : cycle non lineaire (Dimension.getTimeOfDay), puis cos, arrondi comme Math.round
      const ticks = ((h - 6) * 1000) % 24000, d0 = ((ticks / 24000 - 0.25) % 1 + 1) % 1;
      const angle = (d0 * 2 + (0.5 - Math.cos(d0 * Math.PI) / 2)) / 3 * 2 * Math.PI;
      const dec = angle < Math.PI ? 0 : 2 * Math.PI;
      const a2 = angle + (dec - angle) * 0.2;
      cible = Math.floor(cible * Math.cos(a2) + 0.5);
    }
    cible = Math.max(0, Math.min(15, cible));
    if (Number(monde.prop(x, y, z, 'power')) !== cible) set(monde, x, y, z, { power: String(cible) }, 3);
  }
  mc.monde.sur('tickBlocsEntites', (ev, monde) => {                             // le bloc a entite se met a jour toutes les 20 ticks
    if (!detecteurs.size || monde.tick() % 20 !== 0) return;
    for (const k of [...detecteurs]) { const [x, y, z] = k.split(',').map(Number); if (monde.nom(x, y, z) === 'daylight_detector') majDetecteur(monde, x, y, z); else detecteurs.delete(k); }
  });
  void OPPOSE; void bloc;
}
