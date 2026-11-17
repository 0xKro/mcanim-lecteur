// Famille "pistons" : pistons, pistons collants, tete de piston, bloc en mouvement (moving_piston). Ecrite avec la MEME API que les mods.
// Port de PistonBaseBlock, PistonStructureResolver, PistonHeadBlock, MovingPistonBlock et PistonMovingBlockEntity
// (Horizon world/level/pistons.rs : MIT, voir ATTRIBUTIONS.md).
//
// Comment le jeu fait :
//   - un piston qui recoit du signal (de n'importe quel voisin SAUF devant lui, de lui-meme, ou d'un bloc 1 plus haut : la "quasi-connexion")
//     lance un EVENEMENT DE BLOC (phase 4 du tick). L'evenement 0 pousse, 1 et 2 tirent.
//   - pousser : le piston devient `extended`, chaque bloc deplace devient un bloc `moving_piston` (bloc a entite) dans sa cellule de DESTINATION,
//     la tete est un `moving_piston` qui porte `piston_head`. Le mouvement dure 2 ticks (progres 0 -> 0,5 -> 1 ; le bloc est pose au 3e tick).
//   - limite de 12 blocs ; obsidienne, bedrock, pistons sortis, blocs a entite : ne bougent pas ; les blocs "fragiles" (torche, herbe...) sont casses ;
//     les blocs de slime et de miel entrainent leurs voisins (mais slime et miel ne s'accrochent pas l'un a l'autre).
//   - tirer (piston collant) : il tire le bloc devant la tete (si le bloc se laisse tirer).
// Rendu : le bloc en mouvement est ecrit dans le replay (entite `chute`-like, type `piston`) avec sa position interpolee par tick.
import { FR, JEU } from './_aide.js';

const V = { bas: [0, -1, 0], haut: [0, 1, 0], nord: [0, 0, -1], sud: [0, 0, 1], ouest: [-1, 0, 0], est: [1, 0, 0] };
const TOUS = ['bas', 'haut', 'nord', 'sud', 'ouest', 'est'];
const OPP = { bas: 'haut', haut: 'bas', nord: 'sud', sud: 'nord', ouest: 'est', est: 'ouest' };
const AXE = { bas: 'y', haut: 'y', nord: 'z', sud: 'z', ouest: 'x', est: 'x' };
const INDICE = { bas: 0, haut: 1, nord: 2, sud: 3, ouest: 4, est: 5 };
const rel = (p, f, n = 1) => [p[0] + V[f][0] * n, p[1] + V[f][1] * n, p[2] + V[f][2] * n];
const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const cle = (p) => `${p[0]},${p[1]},${p[2]}`;
const Y_MIN = -64, Y_MAX = 319;

// ordre d'iteration d'un java.util.HashMap<BlockPos, ...> de moins de 13 entrees (capacite 16) : case (hash etale) puis ordre d'insertion
function ordreHashMap(pos) {
  const hash = (p) => (Math.imul((p[1] + Math.imul(p[2], 31)) | 0, 31) + p[0]) | 0;
  const casier = (p) => { const h = hash(p); return (h ^ (h >>> 16)) & 15; };
  return pos.map((p, i) => [casier(p), i, p]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
}

export function installer(mc, regles) {
  regles.declarer('pistons.actif', { def: true, doc: 'les pistons reagissent au signal' });
  regles.declarer('pistons.limite', { def: 12, min: 1, max: 64, entier: true, doc: 'blocs qu\'un piston pousse au plus (jeu : 12 ; le 13e bloque tout)' });
  regles.declarer('pistons.collants', { def: true, doc: 'un piston collant tire le bloc devant lui en se retractant (jeu : oui)' });
  regles.declarer('pistons.slime', { def: true, doc: 'les blocs de slime et de miel entrainent leurs voisins (jeu : oui)' });
  regles.declarer('pistons.vitesse', { def: 0.5, min: 0.05, max: 1, doc: 'progres d\'un bloc en mouvement par tick (jeu : 0,5 : le mouvement dure 2 ticks)' });
  regles.declarer('pistons.pousseActeurs', { def: true, doc: 'les blocs en mouvement poussent les acteurs (jeu : oui)' });

  const mobiles = new Map();                  // 'x,y,z' -> bloc en mouvement (PistonMovingBlockEntity)
  const set = (monde, p, etat, flags) => monde.poser(p[0], p[1], p[2], etat, flags);
  const facing = (monde, p) => FR[monde.prop(p[0], p[1], p[2], 'facing')];
  const estPiston = (nom) => nom === 'piston' || nom === 'sticky_piston';
  const collant = (monde, f) => monde.regle('pistons.slime', true) && (f.nom === 'slime_block' || f.nom === 'honey_block');
  const sePeutColler = (monde, a, b) => {                                    // canStick : slime et miel ne s'accrochent pas entre eux
    if ((a.nom === 'honey_block' && b.nom === 'slime_block') || (a.nom === 'slime_block' && b.nom === 'honey_block')) return false;
    return collant(monde, a) || collant(monde, b);
  };
  const etatMobile = (dir, sticky) => `minecraft:moving_piston[facing=${JEU[dir]},type=${sticky ? 'sticky' : 'normal'}]`;

  // ------------------------------------------------------------ PistonBaseBlock.isPushable
  function pousse(monde, f, p, dir, detruit, connexion) {
    if (p[1] < Y_MIN || p[1] > Y_MAX) return false;
    if (f.air) return true;
    if (dir === 'bas' && p[1] === Y_MIN) return false;
    if (dir === 'haut' && p[1] === Y_MAX) return false;
    if (!estPiston(f.nom)) {
      if (f.durete === -1) return false;
      if (f.poussee === 'IMMOVEABLE') return false;
      if (f.poussee === 'POPPED') return detruit;
      if (f.poussee === 'PUSH') return dir === connexion;
    } else if (monde.prop(p[0], p[1], p[2], 'extended') === 'true') return false;
    return !f.blocEntite;
  }

  // ------------------------------------------------------------ PistonStructureResolver
  function resoudre(monde, pPos, dir, ext) {
    const r = { pPos, ext, depart: ext ? rel(pPos, dir) : rel(pPos, dir, 2), push: ext ? dir : OPP[dir], pDir: dir, aPousser: [], aDetruire: [] };
    const lim = monde.regle('pistons.limite', 12);
    const f0 = monde.fiche(...r.depart);
    if (!pousse(monde, f0, r.depart, r.push, false, r.pDir)) {
      if (ext && f0.poussee === 'POPPED') { r.aDetruire.push(r.depart); return r; }
      return null;
    }
    if (!ligne(monde, r, r.depart, r.push, lim)) return null;
    for (let i = 0; i < r.aPousser.length; i++) {
      const p = r.aPousser[i];
      if (collant(monde, monde.fiche(...p)) && !ramifier(monde, r, p, lim)) return null;
    }
    return r;
  }
  function ligne(monde, r, depart, direction, lim) {
    let f = monde.fiche(...depart);
    if (f.air) return true;
    if (!pousse(monde, f, depart, r.push, false, direction) || eq(depart, r.pPos) || r.aPousser.some((q) => eq(q, depart))) return true;
    let compte = 1;
    if (compte + r.aPousser.length > lim) return false;
    while (collant(monde, f)) {
      const p = rel(depart, OPP[r.push], compte), avant = f;
      f = monde.fiche(...p);
      if (f.air || !sePeutColler(monde, avant, f) || !pousse(monde, f, p, r.push, false, OPP[r.push]) || eq(p, r.pPos)) break;
      compte++;
      if (compte + r.aPousser.length > lim) return false;
    }
    let ajoutes = 0;
    for (let i = compte - 1; i >= 0; i--) { r.aPousser.push(rel(depart, OPP[r.push], i)); ajoutes++; }
    for (let i = 1; ; i++) {
      const p = rel(depart, r.push, i);
      const col = r.aPousser.findIndex((q) => eq(q, p));
      if (col >= 0) {
        // reordonnancement : la ligne ajoutee passe avant le reste a partir du point de rencontre
        const n = r.aPousser.length, tete = r.aPousser.slice(0, col), derniere = r.aPousser.slice(n - ajoutes), milieu = r.aPousser.slice(col, n - ajoutes);
        r.aPousser = [...tete, ...derniere, ...milieu];
        for (let j = 0; j <= col + ajoutes; j++) {
          const q = r.aPousser[j];
          if (collant(monde, monde.fiche(...q)) && !ramifier(monde, r, q, lim)) return false;
        }
        return true;
      }
      const g = monde.fiche(...p);
      if (g.air) return true;
      if (!pousse(monde, g, p, r.push, true, r.push) || eq(p, r.pPos)) return false;
      if (g.poussee === 'POPPED') { r.aDetruire.push(p); return true; }
      if (r.aPousser.length >= lim) return false;
      r.aPousser.push(p); ajoutes++;
    }
  }
  function ramifier(monde, r, depuis, lim) {
    const fd = monde.fiche(...depuis);
    for (const d of TOUS) {
      if (AXE[d] === AXE[r.push]) continue;
      const n = rel(depuis, d), fn = monde.fiche(...n);
      if (sePeutColler(monde, fn, fd) && !ligne(monde, r, n, d, lim)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ signal du piston (getNeighborSignal, avec la quasi-connexion)
  function signalPiston(monde, p, push) {
    for (const d of TOUS) { if (d !== push) { const n = rel(p, d); if (monde.signal(n[0], n[1], n[2], d) > 0) return true; } }
    if (monde.signal(p[0], p[1], p[2], 'bas') > 0) return true;                       // le piston lui-meme (quasi-connexion)
    const haut = rel(p, 'haut');
    for (const d of TOUS) { if (d !== 'bas') { const n = rel(haut, d); if (monde.signal(n[0], n[1], n[2], d) > 0) return true; } }
    return false;
  }
  function verifierExtension(ev, monde) {
    if (!monde.regle('pistons.actif', true)) return;
    const p = ev.pos, dir = facing(monde, p);
    const veut = signalPiston(monde, p, dir), sorti = monde.prop(p[0], p[1], p[2], 'extended') === 'true';
    if (veut && !sorti) {
      if (resoudre(monde, p, dir, true)) monde.evenementBloc(p[0], p[1], p[2], 0, INDICE[dir]);
    } else if (!veut && sorti) {
      const deux = rel(p, dir, 2);
      let e = 1;
      if (monde.nom(deux[0], deux[1], deux[2]) === 'moving_piston' && facing(monde, deux) === dir) {
        const m = mobiles.get(cle(deux));
        if (m && m.ext && (m.progresO < 0.5 || m.dernier === monde.tick() || monde.dansTick())) e = 2;
      }
      monde.evenementBloc(p[0], p[1], p[2], e, INDICE[dir]);
    }
  }
  mc.bloc('PistonBaseBlock').sur('voisin', verifierExtension);
  mc.bloc('PistonBaseBlock').sur('pose', (ev, monde) => { if (!ev.memeBloc && !mobiles.has(cle(ev.pos))) verifierExtension(ev, monde); });

  // ------------------------------------------------------------ PistonBaseBlock.moveBlocks
  // rend true (deplace), false (rien a deplacer) ou null (un mod a refuse)
  function deplacer(monde, pPos, dir, ext, collantP) {
    const bras = rel(pPos, dir);
    if (!ext && monde.nom(bras[0], bras[1], bras[2]) === 'piston_head') set(monde, bras, 'minecraft:air', 276);
    const r = resoudre(monde, pPos, dir, ext);
    if (!r) return false;
    const ev = monde.evenement('piston.pousse', { pos: pPos, direction: dir, extension: ext, collant: collantP, blocs: r.aPousser.map((q) => [...q]), detruits: r.aDetruire.map((q) => [...q]) });
    if (ev.annule) return null;
    const dirMouv = ext ? dir : OPP[dir];
    const fiches = r.aPousser.map((q) => monde.fiche(...q));
    const supprimer = new Map();                           // delete_after : un HashMap (ordre de Java)
    r.aPousser.forEach((q, i) => supprimer.set(cle(q), { p: q, etat: fiches[i].id }));
    const aMajEtats = [];
    for (let i = r.aDetruire.length - 1; i >= 0; i--) {
      const q = r.aDetruire[i], f = monde.fiche(...q);
      monde.butin(q[0], q[1], q[2], { source: 'piston' });                 // dropResources
      set(monde, q, 'minecraft:air', 18);
      aMajEtats.push(f.id);
    }
    for (let i = r.aPousser.length - 1; i >= 0; i--) {
      const q = r.aPousser[i], cible = rel(q, dirMouv);
      supprimer.delete(cle(cible));
      set(monde, cible, etatMobile(dir, false), 324);
      nouveauMobile(monde, cible, fiches[i].id, dir, ext, false);
      aMajEtats.push(fiches[i].id);
    }
    if (ext) {
      const tete = `minecraft:piston_head[facing=${JEU[dir]},type=${collantP ? 'sticky' : 'normal'}]`;
      supprimer.delete(cle(bras));
      set(monde, bras, etatMobile(dir, collantP), 324);
      nouveauMobile(monde, bras, monde.etatId(tete), dir, true, true);
    }
    const lignes = ordreHashMap([...supprimer.values()].map((x) => x.p)).map((p) => supprimer.get(cle(p)));
    for (const x of lignes) set(monde, x.p, 'minecraft:air', 82);
    for (const x of lignes) {
      monde.formesIndirectes(x.p[0], x.p[1], x.p[2], x.etat, 2, 512);
      monde.formesVoisines(x.p[0], x.p[1], x.p[2], 2, 512);
      monde.formesIndirectes(x.p[0], x.p[1], x.p[2], 'minecraft:air', 2, 512);
    }
    let index = 0;
    for (let i = r.aDetruire.length - 1; i >= 0; i--) {
      const q = r.aDetruire[i], e = aMajEtats[index++];
      monde.retirerEtat(q[0], q[1], q[2], e);
      monde.formesIndirectes(q[0], q[1], q[2], e, 2, 512);
      monde.notifierVoisins(q[0], q[1], q[2], monde.texteEtat(e).replace(/^minecraft:/, '').replace(/\[.*$/, ''));
    }
    for (let i = r.aPousser.length - 1; i >= 0; i--) {
      const q = r.aPousser[i], e = aMajEtats[index++];
      monde.notifierVoisins(q[0], q[1], q[2], monde.texteEtat(e).replace(/^minecraft:/, '').replace(/\[.*$/, ''));
    }
    if (ext) monde.notifierVoisins(bras[0], bras[1], bras[2], 'piston_head');
    return true;
  }

  // ------------------------------------------------------------ PistonBaseBlock.triggerEvent (evenement de bloc : 0 pousse, 1 et 2 tirent)
  mc.bloc('PistonBaseBlock').sur('declenche', (ev, monde) => {
    const p = ev.pos, dir = facing(monde, p), nom = monde.nom(...p), collantP = nom === 'sticky_piston';
    const sorti = monde.etatAvec(p[0], p[1], p[2], { extended: 'true' });
    const a = ev.a;
    const veut = signalPiston(monde, p, dir);
    if (veut && (a === 1 || a === 2)) { set(monde, p, sorti, 2); return false; }
    if (!veut && a === 0) return false;
    if (a === 0) {
      if (deplacer(monde, p, dir, true, collantP) !== true) return false;
      set(monde, p, sorti, 67);
      monde.son('block.piston.extend', p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 0.5, monde.hasard.flottant() * 0.25 + 0.6);
      return true;
    }
    if (a === 1 || a === 2) {
      finTick(monde, rel(p, dir));
      set(monde, p, etatMobile(dir, collantP), 276);
      const base = monde.etatId(`minecraft:${nom}[facing=${JEU[TOUS[ev.b & 7] || dir]}]`);
      nouveauMobile(monde, p, base, dir, false, true);
      monde.notifierVoisins(p[0], p[1], p[2], 'moving_piston');
      monde.formesVoisines(p[0], p[1], p[2], 2, 512);
      const tireur = collantP && monde.regle('pistons.collants', true);
      if (tireur) {
        const deux = rel(p, dir, 2), f = monde.fiche(...deux);
        let piece = false;
        if (f.nom === 'moving_piston') {
          const m = mobiles.get(cle(deux));
          if (m && m.dir === dir && m.ext) { finTick(monde, deux); piece = true; }
        }
        if (!piece) {
          if (a !== 1 || f.air || !pousse(monde, f, deux, OPP[dir], false, dir) || (f.poussee !== 'PUSH_PULL' && !estPiston(f.nom))) {
            const b = rel(p, dir); monde.poser(b[0], b[1], b[2], 'minecraft:air', 3);
          } else if (deplacer(monde, p, dir, false, collantP) === null) return false;
        }
      } else { const b = rel(p, dir); monde.poser(b[0], b[1], b[2], 'minecraft:air', 3); }
      monde.son('block.piston.contract', p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 0.5, monde.hasard.flottant() * 0.15 + 0.6);
      return true;
    }
    return false;
  });

  // ------------------------------------------------------------ tete de piston
  const teteSurvit = (monde, p, etatTexte) => {
    const m = /facing=(\w+)/.exec(etatTexte), type = /type=(\w+)/.exec(etatTexte);
    const dir = FR[m[1]], b = rel(p, OPP[dir]), nom = monde.nom(...b);
    if (nom === (type[1] === 'sticky' ? 'sticky_piston' : 'piston') && monde.prop(b[0], b[1], b[2], 'extended') === 'true' && facing(monde, b) === dir) return true;
    return nom === 'moving_piston' && facing(monde, b) === dir;
  };
  mc.bloc('PistonHeadBlock').sur('survit', (ev, monde) => teteSurvit(monde, ev.pos, ev.etat));
  mc.bloc('PistonHeadBlock').sur('forme', (ev, monde) => {
    const dir = FR[/facing=(\w+)/.exec(ev.etat)[1]];
    if (OPP[ev.direction] === dir && !teteSurvit(monde, ev.pos, ev.etat)) return 'minecraft:air';
    return undefined;
  });
  mc.bloc('PistonHeadBlock').sur('voisin', (ev, monde) => {
    if (!teteSurvit(monde, ev.pos, ev.etat)) return;
    const dir = FR[/facing=(\w+)/.exec(ev.etat)[1]], b = rel(ev.pos, OPP[dir]);
    monde.voisinChange(b[0], b[1], b[2], ev.blocSource);
  });
  mc.bloc('PistonHeadBlock').sur('retire', (ev, monde) => {
    if (!((ev.drapeaux & 1) || ev.deplace) || ev.nouveau.startsWith('minecraft:piston_head')) return;
    const dir = FR[/facing=(\w+)/.exec(ev.etat)[1]], b = rel(ev.pos, OPP[dir]), nom = monde.nom(...b);
    const type = /type=(\w+)/.exec(ev.etat)[1];
    if (nom === (type === 'sticky' ? 'sticky_piston' : 'piston') && monde.prop(b[0], b[1], b[2], 'extended') === 'true' && facing(monde, b) === dir) monde.casser(b[0], b[1], b[2]);
  });

  // ------------------------------------------------------------ blocs en mouvement (PistonMovingBlockEntity)
  function nouveauMobile(monde, p, etat, dir, ext, source) {
    const m = { p: [...p], etat, dir, ext, source, progres: 0, progresO: 0, dernier: 0, id1: monde.idEntite(), id2: source && !ext ? monde.idEntite() : -1 };
    mobiles.set(cle(p), m);
    return m;
  }
  mc.bloc('MovingPistonBlock').sur('retire', (ev) => { if (!ev.nouveau.startsWith('minecraft:moving_piston')) mobiles.delete(cle(ev.pos)); });
  mc.bloc('MovingPistonBlock').sur('voisin', (ev, monde) => { if (!mobiles.has(cle(ev.pos))) monde.poser(ev.pos[0], ev.pos[1], ev.pos[2], 'minecraft:air', 3); });
  mc.bloc('MovingPistonBlock').sur('survit', () => true);

  function finTick(monde, p) {                             // finalTick : le bloc est pose tout de suite
    const m = mobiles.get(cle(p));
    if (!m || m.progresO >= 1) return;
    mobiles.delete(cle(p));
    if (monde.nom(...p) !== 'moving_piston') return;
    const nouveau = m.source ? 'minecraft:air' : monde.formeDepuisVoisins(p[0], p[1], p[2], monde.texteEtat(m.etat));
    set(monde, p, nouveau, 3);
    monde.voisinChange(p[0], p[1], p[2], nouveau.replace(/^minecraft:/, '').replace(/\[.*$/, ''));
  }
  const decalage = (m, progres) => (m.ext ? progres - 1 : 1 - progres);

  // ecrit dans le replay ce qu'il faut dessiner pour ce tick (position au DEBUT du tick ; le rendu interpole)
  function ecrire(monde, m, progres) {
    const off = decalage(m, progres), v = V[m.dir];
    const place = (id, etat, o) => monde.ecrireEntite(id, 'piston', m.p[0] + 0.5 + v[0] * o, m.p[1] + v[1] * o, m.p[2] + 0.5 + v[2] * o, progres, etat);
    const txt = monde.texteEtat(m.etat);
    if (/^minecraft:piston_head/.test(txt)) {
      const type = /type=(\w+)/.exec(txt)[1];
      place(m.id1, `minecraft:piston_head[facing=${JEU[m.dir]},short=${progres <= 0.5},type=${type}]`, off);
    } else if (m.source && !m.ext) {                          // base qui se retracte : la tete rentre, la base reste en place (extended=true)
      const type = /^minecraft:sticky/.test(txt) ? 'sticky' : 'normal';
      place(m.id1, `minecraft:piston_head[facing=${JEU[m.dir]},short=${progres >= 0.5},type=${type}]`, off);
      place(m.id2, txt.replace(/\[.*$/, '') + `[extended=true,facing=${JEU[m.dir]}]`, 0);
    } else place(m.id1, txt, off);
  }
  // moveCollidedEntities : les acteurs touches par le bloc qui bouge sont pousses avec lui
  function pousserActeurs(monde, m, p0, p1) {
    if (!monde.regle('pistons.pousseActeurs', true)) return;
    const acteurs = monde.acteursListe();
    if (!acteurs.length) return;
    const dm = m.ext ? m.dir : OPP[m.dir], ax = { x: 0, y: 1, z: 2 }[AXE[dm]], s = V[dm][ax];
    const boites = monde.boitesEtat(monde.texteEtat(m.etat));
    const o0 = decalage(m, p0), o1 = decalage(m, p1), v = V[m.dir];
    for (const a of acteurs) {
      let meilleur = 0;
      for (const b of boites) {
        const n = [0, 1, 2].map((i) => [m.p[i] + v[i] * o1 + b[i], m.p[i] + v[i] * o1 + b[i + 3]]);
        const anc = [0, 1, 2].map((i) => [m.p[i] + v[i] * o0 + b[i], m.p[i] + v[i] * o0 + b[i + 3]]);
        let ok = true;
        for (let i = 0; i < 3; i++) {
          if (i === ax) continue;
          if (!(a.boite[i + 3] > n[i][0] + 1e-4 && a.boite[i] < n[i][1] - 1e-4)) { ok = false; break; }
        }
        if (!ok) continue;
        const lo = Math.min(n[ax][0], anc[ax][0]), hi = Math.max(n[ax][1], anc[ax][1]);
        if (!(a.boite[ax + 3] > lo && a.boite[ax] < hi)) continue;
        const decal = s > 0 ? n[ax][1] - a.boite[ax] : a.boite[ax + 3] - n[ax][0];
        if (decal > meilleur) meilleur = decal;
      }
      if (meilleur > 0) {
        const d = Math.min(meilleur, Math.abs(p1 - p0) + 0.01) * s, dd = [0, 0, 0]; dd[ax] = d;
        monde.deplacerActeur(a.nom, dd[0], dd[1], dd[2]);
      }
    }
  }
  function tickMobile(monde, m) {
    ecrire(monde, m, m.progres);
    m.dernier = monde.tick();
    m.progresO = m.progres;
    const p = m.p;
    if (m.progresO >= 1) {
      mobiles.delete(cle(p));
      if (monde.nom(...p) === 'moving_piston') {
        const nouveau = monde.formeDepuisVoisins(p[0], p[1], p[2], monde.texteEtat(m.etat));
        if (nouveau === 'minecraft:air') { set(monde, p, monde.texteEtat(m.etat), 340); monde.casser(p[0], p[1], p[2]); } else {
          set(monde, p, nouveau.replace(/waterlogged=true/, 'waterlogged=false'), 67);
          monde.voisinChange(p[0], p[1], p[2], nouveau.replace(/^minecraft:/, '').replace(/\[.*$/, ''));
        }
      }
    } else {
      const neuf = Math.min(m.progres + monde.regle('pistons.vitesse', 0.5), 1);
      pousserActeurs(monde, m, m.progres, neuf);
      m.progres = neuf;
    }
  }
  // collision d'un bloc en mouvement : la forme du bloc porte, decalee par le progres (elle peut deborder de la cellule) (PistonMovingBlockEntity.getCollisionShape)
  mc.monde.sur('debutTick', (ev, monde) => {
    if (ev.tick !== 0 && ev.fait) return;
    monde.collisionDyn((x, y, z) => {
      const m = mobiles.get(`${x},${y},${z}`);
      if (!m) return [];
      const v = V[m.dir], off = decalage(m, m.progres), txt = monde.texteEtat(m.etat);
      const decaler = (boites, o) => boites.map((b) => [0, 1, 2].flatMap((i) => [b[i] + v[i] * o])).length ? boites.map((b) => [b[0] + v[0] * o, b[1] + v[1] * o, b[2] + v[2] * o, b[3] + v[0] * o, b[4] + v[1] * o, b[5] + v[2] * o]) : [];
      const couper = (boites) => boites.filter((b) => b[3] - b[0] > 1e-6 && b[4] - b[1] > 1e-6 && b[5] - b[2] > 1e-6);   // la forme peut deborder de la cellule (comme le jeu)
      if (m.source && !m.ext) {                    // base qui se retracte : la base (extended=true) ne bouge pas, la tete rentre
        const type = /^minecraft:sticky/.test(txt) ? 'sticky' : 'normal';
        return couper([...monde.boitesEtat(txt.replace(/\[.*$/, '') + `[extended=true,facing=${JEU[m.dir]}]`), ...decaler(monde.boitesEtat(`minecraft:piston_head[facing=${JEU[m.dir]},short=false,type=${type}]`), off)]);
      }
      return couper(decaler(monde.boitesEtat(txt), off));
    });
    ev.fait = true;
  });
  mc.monde.sur('tickBlocsEntites', (ev, monde) => {
    for (const m of [...mobiles.values()]) if (mobiles.get(cle(m.p)) === m) tickMobile(monde, m);
  });
}
