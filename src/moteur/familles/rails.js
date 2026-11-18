// Famille "rails" : rails, rails de propulsion, detecteurs, rails declencheurs, fil piege et crochets. Ecrite avec la MEME API que les mods.
// Port de BaseRailBlock, RailState, RailBlock, PoweredRailBlock, DetectorRailBlock, TripWireBlock, TripWireHookBlock (Horizon
// horizon-world/src/level/{rails,hooks,place,shapes,survive,tick}.rs : MIT, voir ATTRIBUTIONS.md).
//   - Pose : la forme suit la direction du joueur (nord_sud / est_ouest), puis RailState.place relie les rails voisins (virages pour le rail
//     simple, pentes vers un rail plus haut) et les voisins se relient a lui ; un rail sans appui rigide dessous (ou une pente sans appui du
//     cote haut) se casse et lache son objet.
//   - Rail de propulsion et declencheur : alimentes par un signal voisin ou par un rail du meme type alimente, a 8 rails au plus le long de la voie.
//   - Detecteur : un wagonnet dans [x+0,2 ; y ; z+0,2]..[x+0,8 ; y+0,8 ; z+0,8] l'alimente (signal 15, fort vers le bas) ; verification toutes les
//     20 ticks tant qu'il est presse ; le comparateur lit le contenu du wagonnet (coffre, entonnoir) ou 0.
//   - Fil piege : une entite dans [x ; y+1/16 ; z]..[x+1 ; y+2,5/16 (accroche) ou 8/16 ; z+1] l'alimente ; nouvelle verification 10 ticks plus
//     tard ; le crochet (calculateState) cherche jusqu'a 41 cases devant lui un crochet en face, s'accroche (attached) et donne 15 (fort vers son
//     support) quand un fil arme de la ligne est presse ; sons click_on (0,4 ; 0,6), click_off (0,4 ; 0,5), attach (0,4 ; 0,7), detach.
//     Cisailles : `casse` en tenant `shears` desarme le fil (disarmed) avant de le casser, comme TripWireBlock.playerWillDestroy.
import { JEU, FR, horaire, antihoraire, dirDeLacet } from './_aide.js';

const V = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };
const add = (p, d, k = 1) => [p[0] + V[d][0] * k, p[1], p[2] + V[d][2] * k];
const haut = (p) => [p[0], p[1] + 1, p[2]];
const bas = (p) => [p[0], p[1] - 1, p[2]];
const PENTES = { ascending_east: 'east', ascending_west: 'west', ascending_north: 'north', ascending_south: 'south' };
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };

export function installer(mc, regles) {
  regles.declarer('rails.actif', { def: true, doc: 'les rails se relient a la pose et les rails alimentes suivent le signal (jeu : oui)' });
  regles.declarer('rails.portee', { def: 8, min: 1, max: 64, entier: true, doc: 'rails de propulsion ou declencheurs alimentes en chaine par un rail alimente (jeu : 8)' });
  regles.declarer('filPiege.portee', { def: 41, min: 2, max: 200, entier: true, doc: 'cases de fil au plus entre deux crochets (jeu : 41 ; la boucle du jeu va de 1 a 41)' });

  const etatDe = (monde, p) => monde.bloc(p[0], p[1], p[2]);
  const estRail = (monde, p) => { const n = monde.nom(p[0], p[1], p[2]); return n === 'rail' || n === 'powered_rail' || n === 'detector_rail' || n === 'activator_rail'; };
  const forme = (b) => b.etat.shape;
  const avecProps = (b, m) => { const e = { ...b.etat, ...m }; return `${b.nom}[${Object.entries(e).map(([k, v]) => `${k}=${v}`).join(',')}]`; };
  const set = (monde, p, etat) => monde.poser(p[0], p[1], p[2], etat, 3);
  const rigide = (monde, p) => monde.appui(p[0], p[1], p[2], 'haut', 'rigide');
  const connexions = (p, shape) => {
    const [n, s, w, e] = [add(p, 'north'), add(p, 'south'), add(p, 'west'), add(p, 'east')];
    switch (shape) {
      case 'north_south': return [n, s];
      case 'east_west': return [w, e];
      case 'ascending_east': return [w, haut(e)];
      case 'ascending_west': return [haut(w), e];
      case 'ascending_north': return [haut(n), s];
      case 'ascending_south': return [n, haut(s)];
      case 'south_east': return [e, s];
      case 'south_west': return [w, s];
      case 'north_west': return [w, n];
      case 'north_east': return [e, n];
      default: return [n, s];
    }
  };
  // RailState
  const railNouveau = (monde, p, b) => ({ pos: p, b, droit: b.nom !== 'minecraft:rail', con: connexions(p, forme(b)) });
  const railEn = (monde, p) => { for (const q of [p, haut(p), bas(p)]) if (estRail(monde, q)) return railNouveau(monde, q, etatDe(monde, q)); return null; };
  const aConnexion = (r, q) => r.con.some((c) => c[0] === q[0] && c[2] === q[2]);
  const retirerMolles = (monde, r) => {
    for (let i = 0; i < r.con.length;) { const o = railEn(monde, r.con[i]); if (o && aConnexion(o, r.pos)) { r.con[i] = o.pos; i++; } else r.con.splice(i, 1); }
  };
  const peutRelier = (r, o) => aConnexion(r, o.pos) || r.con.length !== 2;
  const voisinRail = (monde, r, q) => { const o = railEn(monde, q); if (!o) return false; retirerMolles(monde, o); return peutRelier(o, r); };
  const pentes = (monde, p, shape) => {
    if (shape === 'north_south') { if (estRail(monde, haut(add(p, 'north')))) shape = 'ascending_north'; if (estRail(monde, haut(add(p, 'south')))) shape = 'ascending_south'; }
    if (shape === 'east_west') { if (estRail(monde, haut(add(p, 'east')))) shape = 'ascending_east'; if (estRail(monde, haut(add(p, 'west')))) shape = 'ascending_west'; }
    return shape;
  };
  const relier = (monde, r, autre) => {
    r.con.push(autre);
    const p = r.pos, n = aConnexion(r, add(p, 'north')), s = aConnexion(r, add(p, 'south')), w = aConnexion(r, add(p, 'west')), e = aConnexion(r, add(p, 'east'));
    let shape = null;
    if (n || s) shape = 'north_south';
    if (w || e) shape = 'east_west';
    if (!r.droit) {
      if (s && e && !n && !w) shape = 'south_east';
      if (s && w && !n && !e) shape = 'south_west';
      if (n && w && !s && !e) shape = 'north_west';
      if (n && e && !s && !w) shape = 'north_east';
    }
    shape = pentes(monde, p, shape) ?? 'north_south';
    r.b = { ...r.b, etat: { ...r.b.etat, shape } };
    set(monde, p, avecProps(r.b, {}));
  };
  // RailState.place : rend l'etat obtenu
  const placer = (monde, p, b, signal, premier, defaut) => {
    const r = railNouveau(monde, p, b);
    const n = voisinRail(monde, r, add(p, 'north')), s = voisinRail(monde, r, add(p, 'south')), w = voisinRail(monde, r, add(p, 'west')), e = voisinRail(monde, r, add(p, 'east'));
    let shape = null;
    const ns = n || s, we = w || e;
    if (ns && !we) shape = 'north_south';
    if (we && !ns) shape = 'east_west';
    const se = s && e, sw = s && w, ne = n && e, nw = n && w;
    if (!r.droit) {
      if (se && !n && !w) shape = 'south_east';
      if (sw && !n && !e) shape = 'south_west';
      if (nw && !s && !e) shape = 'north_west';
      if (ne && !s && !w) shape = 'north_east';
    }
    if (shape === null) {
      if (ns && we) shape = defaut; else if (ns) shape = 'north_south'; else if (we) shape = 'east_west';
      if (!r.droit) {
        const ordre = signal ? [[se, 'south_east'], [sw, 'south_west'], [ne, 'north_east'], [nw, 'north_west']] : [[nw, 'north_west'], [ne, 'north_east'], [sw, 'south_west'], [se, 'south_east']];
        for (const [c, f] of ordre) if (c) shape = f;
      }
    }
    shape = pentes(monde, p, shape) ?? defaut;
    r.con = connexions(p, shape);
    const etat = avecProps(b, { shape });
    const actuel = etatDe(monde, p);
    if (premier || actuel.etat.shape !== shape || actuel.nom !== b.nom) {
      set(monde, p, etat);
      r.b = etatDe(monde, p);
      for (let i = 0; i < r.con.length; i++) {
        const o = railEn(monde, r.con[i]);
        if (!o) continue;
        retirerMolles(monde, o);
        if (peutRelier(o, r)) relier(monde, o, r.pos);
      }
    }
    return etat;
  };
  const majDirection = (monde, p, premier) => { const b = etatDe(monde, p); return placer(monde, p, b, monde.aSignalVoisin(...p), premier, forme(b)); };

  // ------------------------------------------------------------ pose (getStateForPlacement : forme selon la direction du joueur)
  mc.bloc('BaseRailBlock').sur('etatPose', (ev) => {
    const d = dirDeLacet(ev.lacet), eo = d === 'east' || d === 'west';
    const eau = ev.existant && /^minecraft:water$/.test(ev.existant.nom) && ev.existant.etat.level === '0';
    return ev.etat.replace(/shape=[a-z_]+/, `shape=${eo ? 'east_west' : 'north_south'}`).replace(/waterlogged=\w+/, `waterlogged=${eau}`);
  });
  mc.bloc('BaseRailBlock').sur('survit', (ev, monde) => rigide(monde, bas(ev.pos)));
  // onPlace : updateState (si le bloc change), puis le detecteur verifie s'il est presse
  mc.bloc('BaseRailBlock').sur('pose', (ev, monde) => {
    if (ev.memeBloc || !monde.regle('rails.actif', true)) return;
    const p = ev.pos;
    majDirection(monde, p, true);
    if (monde.nom(...p) !== ev.bloc) return;
    const b = etatDe(monde, p);
    if (b.nom !== 'minecraft:rail') voisinChange(monde, p, b, false);
    if (b.nom === 'minecraft:detector_rail') verifierDetecteur(monde, p);
  });
  // affectNeighborsAfterRemoval
  mc.bloc('BaseRailBlock').sur('retire', (ev, monde) => {
    if (ev.deplace || ev.nouveau.startsWith('minecraft:' + ev.bloc + '[')) return;
    const p = ev.pos, s = /shape=([a-z_]+)/.exec(ev.etat)?.[1] ?? '';
    if (s.startsWith('ascending')) monde.notifierVoisins(p[0], p[1] + 1, p[2], ev.bloc);
    if (ev.bloc !== 'rail') { monde.notifierVoisins(p[0], p[1], p[2], ev.bloc); monde.notifierVoisins(p[0], p[1] - 1, p[2], ev.bloc); }
  });
  // neighborChanged
  function voisinChange(monde, p, b, deplace, source = null) {
    const shape = forme(b);
    const casse = !rigide(monde, bas(p)) || (PENTES[shape] && !rigide(monde, add(p, PENTES[shape])));
    if (casse) { monde.casser(p[0], p[1], p[2], { deplace }); return; }
    if (b.nom === 'minecraft:powered_rail' || b.nom === 'minecraft:activator_rail') majPropulsion(monde, p, b);
    else if (b.nom === 'minecraft:rail' && source && monde.estSourceSignal(source) && compterVoisinsRails(monde, p) === 3) majDirection(monde, p, false);
  }
  mc.bloc('BaseRailBlock').sur('voisin', (ev, monde) => { if (monde.regle('rails.actif', true)) voisinChange(monde, ev.pos, etatDe(monde, ev.pos), false, ev.blocSource); });
  const compterVoisinsRails = (monde, p) => ['north', 'east', 'south', 'west'].filter((d) => { const q = add(p, d); return estRail(monde, q) || estRail(monde, haut(q)) || estRail(monde, bas(q)); }).length;

  // ------------------------------------------------------------ rails de propulsion et declencheurs (PoweredRailBlock)
  function majPropulsion(monde, p, b) {
    const allume = b.etat.powered === 'true';
    const doit = monde.aSignalVoisin(...p) || chercher(monde, p, b, true, 0) || chercher(monde, p, b, false, 0);
    if (doit === allume) return;
    set(monde, p, avecProps(b, { powered: String(doit) }));
    monde.notifierVoisins(p[0], p[1] - 1, p[2], b.nom);
    if (PENTES[forme(b)]) monde.notifierVoisins(p[0], p[1] + 1, p[2], b.nom);
  }
  function chercher(monde, p, b, avant, prof) {
    if (prof >= monde.regle('rails.portee', 8)) return false;
    let [x, y, z] = p, dessous = true, shape = forme(b);
    switch (shape) {
      case 'north_south': z += avant ? 1 : -1; break;
      case 'east_west': x += avant ? -1 : 1; break;
      case 'ascending_east': if (avant) x -= 1; else { x += 1; y += 1; dessous = false; } shape = 'east_west'; break;
      case 'ascending_west': if (avant) { x -= 1; y += 1; dessous = false; } else x += 1; shape = 'east_west'; break;
      case 'ascending_north': if (avant) z += 1; else { z -= 1; y += 1; dessous = false; } shape = 'north_south'; break;
      case 'ascending_south': if (avant) { z += 1; y += 1; dessous = false; } else z -= 1; shape = 'north_south'; break;
      default: break;
    }
    return memeAlimente(monde, [x, y, z], b.nom, avant, prof, shape) || (dessous && memeAlimente(monde, [x, y - 1, z], b.nom, avant, prof, shape));
  }
  function memeAlimente(monde, q, nom, avant, prof, dir) {
    const b = etatDe(monde, q);
    if (b.nom !== nom) return false;
    const s = forme(b);
    if (dir === 'east_west' && (s === 'north_south' || s === 'ascending_north' || s === 'ascending_south')) return false;
    if (dir === 'north_south' && (s === 'east_west' || s === 'ascending_east' || s === 'ascending_west')) return false;
    if (b.etat.powered !== 'true') return false;
    return monde.aSignalVoisin(...q) || chercher(monde, q, b, avant, prof + 1);
  }

  // ------------------------------------------------------------ detecteur (DetectorRailBlock)
  function verifierDetecteur(monde, p) {
    const b = etatDe(monde, p);
    if (b.nom !== 'minecraft:detector_rail' || !monde.survit(...p)) return;
    const etait = b.etat.powered === 'true';
    const presse = monde.wagonnetsDans([p[0] + 0.2, p[1], p[2] + 0.2, p[0] + 0.8, p[1] + 0.8, p[2] + 0.8]).length > 0;
    if (presse !== etait) {
      set(monde, p, avecProps(b, { powered: String(presse) }));
      const n = etatDe(monde, p);
      for (const c of connexions(p, forme(n))) { const o = etatDe(monde, c); if (o.id >= 0) monde.voisinChange(c[0], c[1], c[2], o.nom.replace(/^minecraft:/, '')); }
      monde.notifierVoisins(p[0], p[1], p[2], 'detector_rail');
      monde.notifierVoisins(p[0], p[1] - 1, p[2], 'detector_rail');
    }
    if (presse) monde.planifier(p[0], p[1], p[2], 20);
    monde.contenuNotifie(p[0], p[1], p[2]);
  }
  mc.bloc('DetectorRailBlock').sur('tick', (ev, monde) => verifierDetecteur(monde, ev.pos));
  mc.bloc('DetectorRailBlock').sur('entre', (ev, monde) => {
    if (ev.entite?.type !== 'wagonnet' || etatDe(monde, ev.pos).etat.powered === 'true') return;
    verifierDetecteur(monde, ev.pos);
  });

  // DetectorRailBlock.getAnalogOutputSignal : alimente, le contenu du wagonnet a conteneur (coffre, entonnoir) sur le rail ; sinon 0
  mc.monde.sur('redstone.analogique', (ev, monde) => {
    if (ev.bloc !== 'minecraft:detector_rail') return;
    const p = ev.pos;
    if (monde.prop(...p, 'powered') !== 'true') { ev.valeur = 0; return; }
    const w = monde.wagonnetsDans([p[0] + 0.2, p[1], p[2] + 0.2, p[0] + 0.8, p[1] + 0.8, p[2] + 0.8]).filter((x) => x.conteneur);
    ev.valeur = w.length ? w[0].niveau : 0;
  });
  // ------------------------------------------------------------ declencheur : rien de plus dans le bloc (le wagonnet lit `powered` : moteur/wagonnets.js)

  // ------------------------------------------------------------ fil piege (TripWireBlock)
  const connecte = (monde, q, d) => { const b = etatDe(monde, q); if (b.nom === 'minecraft:tripwire_hook') return b.etat.facing === OPP[d]; return b.nom === 'minecraft:tripwire'; };
  mc.bloc('TripWireBlock').sur('etatPose', (ev, monde) => {
    let s = ev.etat;
    for (const d of ['north', 'east', 'south', 'west']) s = s.replace(new RegExp(`${d}=\\w+`), `${d}=${connecte(monde, add(ev.pos, d), d)}`);
    return s;
  });
  mc.bloc('TripWireBlock').sur('forme', (ev, monde) => {
    const d = JEU[ev.direction];
    if (!V[d]) return undefined;
    return ev.etat.replace(new RegExp(`${d}=\\w+`), `${d}=${connecte(monde, ev.voisinPos, d)}`);
  });
  function sourceFil(monde, p, etatFil) {
    for (const d of ['south', 'west']) {
      for (let i = 1; i < 42; i++) {
        const q = add(p, d, i), b = etatDe(monde, q);
        if (b.nom === 'minecraft:tripwire_hook') { if (b.etat.facing === OPP[d]) calculerCrochet(monde, q, b, false, true, i, etatFil); break; }
        if (b.nom !== 'minecraft:tripwire') break;
      }
    }
  }
  mc.bloc('TripWireBlock').sur('pose', (ev, monde) => { if (!ev.memeBloc) sourceFil(monde, ev.pos, etatDe(monde, ev.pos)); });
  mc.bloc('TripWireBlock').sur('retire', (ev, monde) => {
    if (ev.deplace || ev.nouveau.startsWith('minecraft:tripwire[')) return;
    const b = { nom: 'minecraft:tripwire', etat: Object.fromEntries(/\[(.*)\]/.exec(ev.etat)[1].split(',').map((kv) => kv.split('='))) };
    sourceFil(monde, ev.pos, { ...b, etat: { ...b.etat, powered: 'true' } });
  });
  function filPresse(monde, p) {
    const b = etatDe(monde, p);
    const etait = b.etat.powered === 'true', top = b.etat.attached === 'true' ? 2.5 / 16 : 8 / 16;
    const presse = monde.entitesDans([p[0], p[1] + 1 / 16, p[2], p[0] + 1, p[1] + top, p[2] + 1]) > 0;
    if (presse !== etait) {
      set(monde, p, avecProps(b, { powered: String(presse) }));
      sourceFil(monde, p, etatDe(monde, p));
    }
    if (presse) monde.planifier(p[0], p[1], p[2], 10);
    else if (etait) monde.planifier(p[0], p[1], p[2], 1);
  }
  mc.bloc('TripWireBlock').sur('tick', (ev, monde) => { if (etatDe(monde, ev.pos).etat.powered === 'true') filPresse(monde, ev.pos); });
  mc.bloc('TripWireBlock').sur('entre', (ev, monde) => {
    const b = etatDe(monde, ev.pos);
    if (b.etat.powered === 'true' || monde.aTickPlanifie(...ev.pos)) return;
    filPresse(monde, ev.pos);
  });
  // TripWireBlock.playerWillDestroy : des cisailles desarment le fil avant qu'il soit casse
  mc.bloc('TripWireBlock').sur('casse', (ev, monde) => {
    if (!/^(minecraft:)?shears$/.test(ev.outil ?? '')) return;
    monde.poser(ev.pos[0], ev.pos[1], ev.pos[2], avecProps(etatDe(monde, ev.pos), { disarmed: 'true' }), 4);   // UPDATE_NONE (4) comme le jeu
  });

  // ------------------------------------------------------------ crochets (TripWireHookBlock)
  mc.bloc('TripWireHookBlock').sur('etatPose', (ev, monde) => {
    // getStateForPlacement : la direction du regard la plus proche (horizontale), le crochet tourne le dos a son support
    const ordre = [dirDeLacet(ev.lacet), horaire(dirDeLacet(ev.lacet)), antihoraire(dirDeLacet(ev.lacet)), OPP[dirDeLacet(ev.lacet)]];
    if (ev.face && V[ev.face]) ordre.unshift(OPP[ev.face]);
    for (const d of ordre) {
      const f = OPP[d], s = add(ev.pos, d);
      if (monde.appui(s[0], s[1], s[2], FR[f], 'plein')) return `minecraft:tripwire_hook[attached=false,facing=${f},powered=false]`;
    }
    return false;
  });
  mc.bloc('TripWireHookBlock').sur('survit', (ev, monde) => {
    const f = /facing=(\w+)/.exec(ev.etat)[1], s = add(ev.pos, OPP[f]);
    return !!V[f] && monde.appui(s[0], s[1], s[2], FR[f], 'plein');
  });
  mc.bloc('TripWireHookBlock').sur('forme', (ev, monde) => {
    const f = /facing=(\w+)/.exec(ev.etat)[1];
    if (JEU[ev.direction] === OPP[f] && !monde.survitEtat(ev.pos[0], ev.pos[1], ev.pos[2], ev.etat)) return 'minecraft:air';
    return undefined;
  });
  mc.bloc('TripWireHookBlock').sur('pose', (ev, monde) => { if (!ev.memeBloc) calculerCrochet(monde, ev.pos, etatDe(monde, ev.pos), false, false, -1, null); });
  mc.bloc('TripWireHookBlock').sur('tick', (ev, monde) => calculerCrochet(monde, ev.pos, etatDe(monde, ev.pos), false, true, -1, null));
  mc.bloc('TripWireHookBlock').sur('retire', (ev, monde) => {
    if (ev.deplace || ev.nouveau.startsWith('minecraft:tripwire_hook[')) return;
    const props = Object.fromEntries(/\[(.*)\]/.exec(ev.etat)[1].split(',').map((kv) => kv.split('=')));
    const b = { nom: 'minecraft:tripwire_hook', etat: props, id: -1 };
    if (props.attached === 'true' || props.powered === 'true') calculerCrochet(monde, ev.pos, b, true, false, -1, null);
    if (props.powered === 'true') notifierCrochet(monde, ev.pos, props.facing);
  });
  function notifierCrochet(monde, p, facing) {
    const devant = OPP[facing];
    monde.notifierVoisins(p[0], p[1], p[2], 'tripwire_hook');
    const q = add(p, devant);
    monde.notifierVoisins(q[0], q[1], q[2], 'tripwire_hook');
  }
  function sonCrochet(monde, p, attache, alim, etaitA, etaitP) {
    const c = [p[0] + 0.5, p[1] + 0.5, p[2] + 0.5];
    if (alim && !etaitP) monde.son('block.tripwire.click_on', ...c, 0.4, 0.6);
    else if (!alim && etaitP) monde.son('block.tripwire.click_off', ...c, 0.4, 0.5);
    else if (attache && !etaitA) monde.son('block.tripwire.attach', ...c, 0.4, 0.7);
    else if (!attache && etaitA) monde.son('block.tripwire.detach', ...c, 0.4, 1.2 / (monde.hasard.flottant() * 0.2 + 0.9));
  }
  function calculerCrochet(monde, p, b, detruit, peutMaj, source, etatSource) {
    const dir = b.etat.facing;
    if (!V[dir]) return;
    const etaitA = b.etat.attached === 'true', etaitP = b.etat.powered === 'true';
    let attache = !detruit, alim = false, recepteur = 0;
    const fils = new Array(42).fill(null), max = monde.regle('filPiege.portee', 41);
    for (let i = 1; i < max + 1; i++) {
      const q = add(p, dir, i);
      let f = etatDe(monde, q);
      if (f.nom === 'minecraft:tripwire_hook') { if (f.etat.facing === OPP[dir]) recepteur = i; break; }
      if (f.nom !== 'minecraft:tripwire' && i !== source) { fils[i] = null; attache = false; } else {
        if (i === source) f = etatSource ?? f;
        const arme = f.etat.disarmed !== 'true';
        alim ||= arme && f.etat.powered === 'true';
        fils[i] = f;
        if (i === source) { monde.planifier(p[0], p[1], p[2], 10); attache &&= arme; }
      }
    }
    attache &&= recepteur > 1;
    alim &&= attache;
    const etat = (f) => `minecraft:tripwire_hook[attached=${attache},facing=${f},powered=${alim}]`;
    if (recepteur > 0) {
      const q = add(p, dir, recepteur);
      set(monde, q, etat(OPP[dir]));
      notifierCrochet(monde, q, OPP[dir]);
      sonCrochet(monde, q, attache, alim, etaitA, etaitP);
    }
    sonCrochet(monde, p, attache, alim, etaitA, etaitP);
    if (!detruit) {
      set(monde, p, etat(dir));
      if (peutMaj) notifierCrochet(monde, p, dir);
    }
    if (etaitA !== attache) {
      for (let i = 1; i < recepteur; i++) {
        const q = add(p, dir, i), f = fils[i];
        if (!f) continue;
        const ici = etatDe(monde, q);
        if (ici.nom === 'minecraft:tripwire' || ici.nom === 'minecraft:tripwire_hook') set(monde, q, avecProps(f, { attached: String(attache) }));
      }
    }
  }
  void antihoraire;
}
