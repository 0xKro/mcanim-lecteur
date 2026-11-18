// Redstone, partie du moteur : le MODELE DE SIGNAL du jeu et la poudre (forme, puissance). Les comportements des blocs (torche, repeteur,
// comparateur, observateur, lampe, portes...) sont dans familles/redstone.js, ecrits avec l'API publique qui expose ces fonctions.
// Port de Horizon world/level/redstone.rs (SignalGetter, RedStoneWireBlock, DefaultRedstoneWireEvaluator) et de BlockStateBase.getSignal /
// getDirectSignal (MIT, voir ATTRIBUTIONS.md).
//
// Vocabulaire du jeu, en francais :
//   signal(pos, dir)        getSignal : puissance que le bloc de `pos` donne dans la direction `dir` (faible) ; un bloc qui conduit la redstone
//                           y ajoute la puissance FORTE que lui donnent ses voisins (getDirectSignalTo)
//   signalDirect(pos, dir)  getDirectSignal : seulement la puissance forte (levier, bouton, torche en dessous, repeteur, comparateur)
//   conducteur              `isRedstoneConductor` : bloc plein qui laisse passer la puissance forte (pierre, terre...) ; pas le verre, pas le bloc de redstone
// Les faces sont des indices 0..5 : bas, haut, nord, sud, ouest, est (ordre de Direction).
import { FACE_DX, FACE_DY, FACE_DZ, FACE_OPPOSEE } from './monde.js';
import { FACES } from './donnees.js';

export const JEU_DIR = ['down', 'up', 'north', 'south', 'west', 'east'];
const ORDRE_SIGNAL = [0, 1, 2, 3, 4, 5];            // SIGNAL_ORDER : bas, haut, nord, sud, ouest, est
export const HORIZONTAL = [2, 5, 3, 4];               // nord, est, sud, ouest (update::HORIZONTAL)
const BAS = 0, HAUT = 1;
const C_FIL = 1, C_COMPARATEUR = 2, C_REPETEUR = 4, C_OBSERVATEUR = 8, C_DIODE = 16, C_TRAPPE = 32;

const faceDe = (f) => (typeof f === 'number' ? f : FACES.indexOf(f));

// java.util.HashSet<BlockPos> de 7 positions, capacite 16 : ordre = case (hash etale) puis ordre d'insertion
function ordreHashSet(pos) {
  const hash = (p) => (Math.imul((p[1] + Math.imul(p[2], 31)) | 0, 31) + p[0]) | 0;
  const case_ = (p) => { const h = hash(p); return (h ^ (h >>> 16)) & 15; };
  return pos.map((p, i) => [case_(p), i, p]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
}

export class Redstone {
  constructor(sim) {
    this.sim = sim; this.d = sim.d;
    const d = this.d;
    this.bFil = d.idBloc('redstone_wire'); this.bBlocRedstone = d.idBloc('redstone_block');
    this.classe = new Uint8Array(d.noms.length);
    for (let b = 0; b < d.noms.length; b++) {
      const c = d.classes(b);
      let k = 0;
      if (c.includes('RedstoneWireBlock')) k |= C_FIL;
      if (c.includes('ComparatorBlock')) k |= C_COMPARATEUR;
      if (c.includes('RepeaterBlock')) k |= C_REPETEUR;
      if (c.includes('ObserverBlock')) k |= C_OBSERVATEUR;
      if (c.includes('DiodeBlock')) k |= C_DIODE;
      if (c.includes('TrapDoorBlock')) k |= C_TRAPPE;
      this.classe[b] = k;
    }
    this.filDef = d.etatParDefaut(this.bFil);
    this.sorties = new Map();               // sortie des comparateurs : 'x,y,z' -> 0..15 (le bloc a entite du comparateur)
    this.filCache = new Map();
    this.signalCoupe = false;               // wire_signal_off : pendant le calcul du signal des blocs, la poudre ne donne rien
    this.hookSignal = null;
  }

  // ------------------------------------------------------------ lecture
  etat(x, y, z) { const sc = this.sim.surcharge; return sc && sc.x === x && sc.y === y && sc.z === z ? sc.e : this.sim.monde.etatEn(x, y, z); }
  estFil(e) { return e >= 0 && this.d.blocDe(e) === this.bFil; }
  _c(e, bit) { return e >= 0 && (this.classe[this.d.blocDe(e)] & bit) !== 0; }
  conduit(e) { return e >= 0 && this.d.conducteur(e); }
  conducteur(x, y, z) { return this.conduit(this.etat(x, y, z)); }
  facing(e) { return JEU_DIR.indexOf(this.d.prop(e, 'facing')); }
  puissanceFil(e) { return this.estFil(e) ? Number(this.d.prop(e, 'power')) : 0; }
  portee() { return this.sim.regles.valeur('redstone.portee', 15); }

  // ------------------------------------------------------------ signal (SignalGetter)
  _nib(mot, f) { return (mot >>> (4 * f)) & 15; }
  // BlockState.getSignal
  signalEtat(e, x, y, z, f) {
    let v = 0;
    if (e >= 0 && this.d.sourceSignal(e)) {
      const k = this.classe[this.d.blocDe(e)];
      if (k & C_FIL) v = this._signalFil(e, x, y, z, f);
      else if (k & C_COMPARATEUR) v = (this.facing(e) === f && this.d.prop(e, 'powered') === 'true') ? (this.sorties.get(`${x},${y},${z}`) ?? 0) : 0;
      else v = this._nib(this.d.signalFaible(e), f);
    }
    return this.hookSignal ? this._ajuster(x, y, z, f, false, v) : v;
  }
  // BlockState.getDirectSignal
  directEtat(e, x, y, z, f) {
    let v = 0;
    if (e >= 0 && this.d.sourceSignal(e)) {
      const k = this.classe[this.d.blocDe(e)];
      if (k & C_FIL) v = this.signalCoupe ? 0 : this._signalFil(e, x, y, z, f);
      else if (k & C_COMPARATEUR) v = this.signalEtat(e, x, y, z, f);
      else v = this._nib(this.d.signalFort(e), f);
    }
    return this.hookSignal ? this._ajuster(x, y, z, f, true, v) : v;
  }
  // evenement du monde `redstone.signal` : un mod change la valeur (ev.valeur) ; actif seulement si quelqu'un l'ecoute
  _ajuster(x, y, z, f, direct, v) {
    const ev = { pos: [x, y, z], direction: FACES[f], direct, valeur: v, annule: false };
    this.sim.reg.lancerMonde('redstone.signal', ev, this.sim.api);
    return Math.max(0, Math.min(15, ev.valeur | 0));
  }
  _signalFil(e, x, y, z, f) {
    if (this.signalCoupe || f === BAS) return 0;
    const p = Number(this.d.prop(e, 'power'));
    if (p === 0) return 0;
    if (f !== HAUT) {
      const c = this.etatConnexion(e, x, y, z);
      if (this.d.prop(c, JEU_DIR[FACE_OPPOSEE[f]]) === 'none') return 0;
    }
    return p;
  }
  directeVers(x, y, z) {                                  // getDirectSignalTo
    let r = 0;
    for (const f of ORDRE_SIGNAL) {
      const nx = x + FACE_DX[f], ny = y + FACE_DY[f], nz = z + FACE_DZ[f];
      r = Math.max(r, this.directEtat(this.etat(nx, ny, nz), nx, ny, nz, f));
      if (r >= 15) return r;
    }
    return r;
  }
  signal(x, y, z, f) {                                     // getSignal(pos, direction)
    const e = this.etat(x, y, z), s = this.signalEtat(e, x, y, z, f);
    return this.conduit(e) ? Math.max(s, this.directeVers(x, y, z)) : s;
  }
  aSignalVoisin(x, y, z) {                                 // hasNeighborSignal
    for (const f of ORDRE_SIGNAL) if (this.signal(x + FACE_DX[f], y + FACE_DY[f], z + FACE_DZ[f], f) > 0) return true;
    return false;
  }
  meilleurSignalVoisin(x, y, z) {                          // getBestNeighborSignal
    let best = 0;
    for (const f of ORDRE_SIGNAL) {
      const s = this.signal(x + FACE_DX[f], y + FACE_DY[f], z + FACE_DZ[f], f);
      if (s >= 15) return 15;
      best = Math.max(best, s);
    }
    return best;
  }
  // getControlInputSignal : entree laterale d'un repeteur (seulement les diodes) ou d'un comparateur (toute source)
  signalControle(x, y, z, f, seulementDiodes) {
    const e = this.etat(x, y, z);
    if (seulementDiodes) return this._c(e, C_DIODE) ? this.directEtat(e, x, y, z, f) : 0;
    if (e >= 0 && this.d.blocDe(e) === this.bBlocRedstone) return 15;
    if (this.estFil(e)) return Number(this.d.prop(e, 'power'));
    if (e >= 0 && this.d.sourceSignal(e)) return this.directEtat(e, x, y, z, f);
    return 0;
  }

  // ------------------------------------------------------------ sortie analogique (comparateur)
  // BlockState.getAnalogOutputSignal : etats seulement ; les conteneurs viennent de sim.contenus (si la scene en declare)
  sortieAnalogique(e, x, y, z, direction) {
    const d = this.d, nom = d.nomBloc(e);
    let v = 0;
    if (nom === 'cake') v = (7 - Number(d.prop(e, 'bites'))) * 2;
    else if (nom.endsWith('candle_cake')) v = 14;
    else if (nom === 'composter' || nom === 'water_cauldron' || nom === 'powder_snow_cauldron') v = Number(d.prop(e, 'level') ?? 0);
    else if (nom === 'lava_cauldron') v = 3;
    else if (nom === 'bee_nest' || nom === 'beehive') v = Number(d.prop(e, 'honey_level'));
    else if (nom === 'end_portal_frame') v = d.prop(e, 'eye') === 'true' ? 15 : 0;
    else if (/copper_bulb$/.test(nom)) v = d.prop(e, 'lit') === 'true' ? 15 : 0;
    else if (nom === 'respawn_anchor') v = Math.floor(Number(d.prop(e, 'charges')) / 4 * 15);
    else if (this.sim.contenus) v = this.sim.contenus.niveau(x, y, z);
    if (this.sim.reg.aMonde('redstone.analogique')) {
      const ev = { pos: [x, y, z], direction: FACES[direction], bloc: 'minecraft:' + nom, valeur: v };
      this.sim.reg.lancerMonde('redstone.analogique', ev, this.sim.api);
      v = ev.valeur | 0;
    }
    return Math.max(0, Math.min(15, v));
  }
  // Level.updateNeighbourForOutputSignal : les comparateurs a cote (ou derriere un bloc conducteur) apprennent que le contenu a change
  majSortieAnalogique(x, y, z, blocSource) {
    const sim = this.sim;
    for (const f of HORIZONTAL) {
      let rx = x + FACE_DX[f], ry = y + FACE_DY[f], rz = z + FACE_DZ[f];
      let e = this.etat(rx, ry, rz);
      if (e < 0) continue;
      if (this._c(e, C_COMPARATEUR)) sim.voisinChangeEn(rx, ry, rz, blocSource);
      else if (this.conduit(e)) {
        rx += FACE_DX[f]; ry += FACE_DY[f]; rz += FACE_DZ[f];
        e = this.etat(rx, ry, rz);
        if (this._c(e, C_COMPARATEUR)) sim.voisinChangeEn(rx, ry, rz, blocSource);
      }
    }
  }

  // ------------------------------------------------------------ poudre de redstone : forme
  _filId(p, n, e, s, w) {
    const cle = `${p}${n}${e}${s}${w}`;
    let id = this.filCache.get(cle);
    if (id === undefined) {
      const d = this.d;
      id = this.filDef;
      id = d.avec(id, 'power', p); id = d.avec(id, 'north', n); id = d.avec(id, 'east', e); id = d.avec(id, 'south', s); id = d.avec(id, 'west', w);
      this.filCache.set(cle, id);
    }
    return id;
  }
  _lire(e) { const d = this.d; return { p: d.prop(e, 'power'), n: d.prop(e, 'north'), e: d.prop(e, 'east'), s: d.prop(e, 'south'), w: d.prop(e, 'west') }; }
  _cree(o) { return this._filId(o.p, o.n, o.e, o.s, o.w); }
  _connecte(o, f) { return o[{ 2: 'n', 3: 's', 4: 'w', 5: 'e' }[f]] !== 'none'; }
  _croix(o) { return HORIZONTAL.every((f) => this._connecte(o, f)); }
  _point(o) { return !HORIZONTAL.some((f) => this._connecte(o, f)); }
  _met(o, f, v) { o[{ 2: 'n', 3: 's', 4: 'w', 5: 'e' }[f]] = v; }

  // shouldConnectTo : `f` = direction de la poudre vers le voisin (null : au-dessus ou en dessous)
  _seConnecte(e, f) {
    if (e < 0) return false;
    const k = this.classe[this.d.blocDe(e)];
    if (k & C_FIL) return true;
    if (k & C_OBSERVATEUR) return f !== null && f === this.facing(e);
    if (k & C_REPETEUR) { const fa = this.facing(e); return f !== null && (f === fa || f === FACE_OPPOSEE[fa]); }
    return this.d.sourceSignal(e) && f !== null;
  }
  // RedStoneWireBlock.canSurviveOn : face haute pleine ou entonnoir
  _filSurvitSur(x, y, z) {
    const e = this.etat(x, y, z);
    return e >= 0 && (this.d.solideFace(e, HAUT, 0) || this.d.nomBloc(e) === 'hopper');
  }
  _cote(x, y, z, f, peutMonter) {                          // getConnectingSide
    const rx = x + FACE_DX[f], ry = y + FACE_DY[f], rz = z + FACE_DZ[f];
    const r = this.etat(rx, ry, rz);
    if (peutMonter) {
      const posable = this._c(r, C_TRAPPE) || this._filSurvitSur(rx, ry, rz);
      if (posable && this._seConnecte(this.etat(rx, ry + 1, rz), null)) return (r >= 0 && this.d.solideFace(r, FACE_OPPOSEE[f], 0)) ? 'up' : 'side';
    }
    if (!this._seConnecte(r, f) && (this.conduit(r) || !this._seConnecte(this.etat(rx, ry - 1, rz), null))) return 'none';
    return 'side';
  }
  // RedStoneWireBlock.getConnectionState : l'etat avec ses 4 connexions recalculees (la puissance est gardee)
  etatConnexion(e, x, y, z) {
    const o0 = this._lire(e), etaitPoint = this._point(o0);
    const o = { p: o0.p, n: 'none', e: 'none', s: 'none', w: 'none' };
    const peutMonter = !this.conducteur(x, y + 1, z);
    for (const f of HORIZONTAL) if (!this._connecte(o, f)) this._met(o, f, this._cote(x, y, z, f, peutMonter));
    if (etaitPoint && this._point(o)) return this._cree(o);
    const n = this._connecte(o, 2), s = this._connecte(o, 3), est = this._connecte(o, 5), w = this._connecte(o, 4);
    const nsVide = !n && !s, ewVide = !est && !w;
    if (!w && nsVide) o.w = 'side';
    if (!est && nsVide) o.e = 'side';
    if (!n && ewVide) o.n = 'side';
    if (!s && ewVide) o.s = 'side';
    return this._cree(o);
  }
  // RedStoneWireBlock.updateShape : nouvel etat (numero) ou air (-2 : la poudre disparait)
  formeFil(e, x, y, z, f) {
    if (f === BAS) return this._filSurvitSur(x, y - 1, z) ? e : -2;
    if (f === HAUT) return this.etatConnexion(e, x, y, z);
    const cote = this._cote(x, y, z, f, !this.conducteur(x, y + 1, z));
    const o = this._lire(e);
    if ((cote !== 'none') === this._connecte(o, f) && !this._croix(o)) { this._met(o, f, cote); return this._cree(o); }
    const c = { p: o.p, n: 'side', e: 'side', s: 'side', w: 'side' };
    this._met(c, f, cote);
    return this.etatConnexion(this._cree(c), x, y, z);
  }
  filSurvit(x, y, z) { return this._filSurvitSur(x, y - 1, z); }
  // pose de la poudre : etat de connexion de l'etat par defaut
  etatPoseFil(x, y, z) { return this.etatConnexion(this.filDef, x, y, z); }

  // RedStoneWireBlock.updateIndirectNeighbourShapes (appele par setBlock) : formes des poudres en diagonale (une marche plus haut ou plus bas)
  formesIndirectes(x, y, z, e, drapeaux, limite) {
    if (!this.estFil(e)) return;
    const sim = this.sim;
    for (const f of HORIZONTAL) {
      if (this.d.prop(e, JEU_DIR[f]) === 'none') continue;
      const rx = x + FACE_DX[f], rz = z + FACE_DZ[f];
      if (this.estFil(this.etat(rx, y, rz))) continue;
      const o = FACE_OPPOSEE[f];
      if (this.estFil(this.etat(rx, y - 1, rz))) sim.formeVoisinEn(o, rx, y - 1, rz, rx + FACE_DX[o], y - 1, rz + FACE_DZ[o], drapeaux, limite);
      if (this.estFil(this.etat(rx, y + 1, rz))) sim.formeVoisinEn(o, rx, y + 1, rz, rx + FACE_DX[o], y + 1, rz + FACE_DZ[o], drapeaux, limite);
    }
  }

  // ------------------------------------------------------------ poudre de redstone : puissance (DefaultRedstoneWireEvaluator)
  _signalBlocs(x, y, z) {
    this.signalCoupe = true;
    try { return this.meilleurSignalVoisin(x, y, z); } finally { this.signalCoupe = false; }
  }
  _entrant(x, y, z) {
    let s = 0;
    const hautCond = this.conducteur(x, y + 1, z);
    for (const f of HORIZONTAL) {
      const nx = x + FACE_DX[f], nz = z + FACE_DZ[f], n = this.etat(nx, y, nz), nc = this.conduit(n);
      s = Math.max(s, this.puissanceFil(n));
      if (nc && !hautCond) s = Math.max(s, this.puissanceFil(this.etat(nx, y + 1, nz)));
      else if (!nc) s = Math.max(s, this.puissanceFil(this.etat(nx, y - 1, nz)));
    }
    return Math.max(0, s - 1);
  }
  // updatePowerStrength : recalcule la puissance de la poudre ; si elle change, ecrit (drapeau 2) et previent la poudre et ses 6 voisins
  majPuissanceFil(x, y, z, e) {
    const sim = this.sim;
    const bloc = this._signalBlocs(x, y, z);
    let cible = bloc === 15 ? 15 : Math.max(bloc, this._entrant(x, y, z));
    cible = Math.min(cible, this.portee());
    if (Number(this.d.prop(e, 'power')) === cible) return;
    if (this.etat(x, y, z) === e) sim.poser(x, y, z, this.d.avec(e, 'power', String(cible)), 2);
    const cibles = [[x, y, z], ...[0, 1, 2, 3, 4, 5].map((f) => [x + FACE_DX[f], y + FACE_DY[f], z + FACE_DZ[f]])];
    for (const p of ordreHashSet(cibles)) sim._majVoisins(p[0], p[1], p[2], this.bFil);
  }
  _coin(x, y, z) {
    if (!this.estFil(this.etat(x, y, z))) return;
    this.sim._majVoisins(x, y, z, this.bFil);
    for (let f = 0; f < 6; f++) this.sim._majVoisins(x + FACE_DX[f], y + FACE_DY[f], z + FACE_DZ[f], this.bFil);
  }
  majVoisinsDesFils(x, y, z) {                              // updateNeighborsOfNeighboringWires
    for (const f of HORIZONTAL) this._coin(x + FACE_DX[f], y, z + FACE_DZ[f]);
    for (const f of HORIZONTAL) {
      const nx = x + FACE_DX[f], nz = z + FACE_DZ[f];
      if (this.conducteur(nx, y, nz)) this._coin(nx, y + 1, nz); else this._coin(nx, y - 1, nz);
    }
  }

  // Amorcage : une zone ou un decor peut contenir des circuits dont l'etat n'a jamais ete calcule (poudre a 0 a cote d'un levier tire, lampe eteinte contre un bloc
  // de redstone). Le jeu enregistre un monde deja stable ; ici on fait comme si chaque composant venait d'apprendre qu'un voisin a change (une fois, au tick 0).
  // Regle redstone.amorcage ; ne coute rien si la zone n'a aucun composant.
  amorcer() {
    const sim = this.sim, d = this.d, m = sim.monde;
    if (!sim.regles.valeur('redstone.amorcage', true)) return;
    const noms = new Set(['redstone_wire', 'redstone_torch', 'redstone_wall_torch', 'repeater', 'comparator', 'observer', 'redstone_lamp', 'redstone_block', 'piston', 'sticky_piston', 'target', 'daylight_detector']);   // detecteur : un bloc a entite qui tourne toujours (DaylightDetectorBlockEntity), enregistre ici
    const marque = new Uint8Array(m.palette.length + 1);
    let n = 0;
    for (let p = 2; p < m.palette.length; p++) {
      const e = m.tEtat[p];
      if (e < 0) continue;
      const nom = d.nomBloc(e);
      if (noms.has(nom) || ((nom.endsWith('_button') || nom === 'lever' || nom.endsWith('pressure_plate')) && (d.prop(e, 'powered') === 'true' || Number(d.prop(e, 'power') ?? 0) > 0))) { marque[p] = 1; n++; }
    }
    if (!n) return;
    let faits = 0;
    for (let y = m.y0; y < m.y0 + m.sy; y++) for (let z = m.z0; z < m.z0 + m.sz; z++) for (let x = m.x0; x < m.x0 + m.sx; x++) {
      const p = m.indiceEn(x, y, z);
      if (p < marque.length && marque[p]) {
        if (d.nomBloc(m.tEtat[p]) === 'daylight_detector') { sim.api.evenement('redstone.detecteurJour', { pos: [x, y, z] }); continue; }
        sim._majVoisins(x, y, z, d.blocDe(m.tEtat[p])); faits++;
      }
    }
    sim.stats.amorces = faits;
  }

  // ------------------------------------------------------------ ticks planifies : questions de la file
  aTickPlanifie(x, y, z) { const b = this.sim.blocIdx(x, y, z); return b >= 0 && this.sim.file.estPlanifie(b, x, y, z); }
  tickCeTick(x, y, z) { const b = this.sim.blocIdx(x, y, z); return b >= 0 && this.sim.enAttente.has(this.sim.file.cle(b, x, y, z)); }

  // ------------------------------------------------------------ API publique (la meme pour le moteur et les mods)
  api() {
    const R = this, sim = this.sim, d = this.d;
    const blocId = (nom) => (nom === null || nom === undefined ? -1 : typeof nom === 'number' ? nom : d.idBloc(String(nom)));
    const dir = (f) => { const i = faceDe(f); if (i < 0) throw new Error(`direction inconnue : ${f} (bas, haut, nord, sud, ouest, est)`); return i; };
    return {
      signal: (x, y, z, f) => R.signal(x | 0, y | 0, z | 0, dir(f)),
      signalDirect: (x, y, z, f) => { const e = R.etat(x | 0, y | 0, z | 0); return R.directEtat(e, x | 0, y | 0, z | 0, dir(f)); },
      signalDirectVers: (x, y, z) => R.directeVers(x | 0, y | 0, z | 0),
      aSignalVoisin: (x, y, z) => R.aSignalVoisin(x | 0, y | 0, z | 0),
      meilleurSignalVoisin: (x, y, z) => R.meilleurSignalVoisin(x | 0, y | 0, z | 0),
      signalControle: (x, y, z, f, seulementDiodes) => R.signalControle(x | 0, y | 0, z | 0, dir(f), !!seulementDiodes),
      conducteur: (x, y, z) => R.conducteur(x | 0, y | 0, z | 0),
      sortieAnalogique: (x, y, z, f) => { const e = R.etat(x | 0, y | 0, z | 0); return e >= 0 && d.sortieAnalogique(e) ? R.sortieAnalogique(e, x | 0, y | 0, z | 0, dir(f ?? 'haut')) : -1; },
      // sortie memorisee du comparateur (bloc a entite)
      sortieComparateur: (x, y, z) => R.sorties.get(`${x},${y},${z}`) ?? 0,
      fixerSortieComparateur: (x, y, z, v) => { const k = `${x},${y},${z}`, a = R.sorties.get(k) ?? 0; R.sorties.set(k, v | 0); return a; },
      oublierSortieComparateur: (x, y, z) => { R.sorties.delete(`${x},${y},${z}`); },
      // notifications de voisins (Level.updateNeighborsAt, ...AtExceptFromFacing, neighborChanged)
      notifierVoisins: (x, y, z, bloc, sauf) => { const b = blocId(bloc); if (sauf === undefined || sauf === null) sim._majVoisins(x | 0, y | 0, z | 0, b); else sim.majVoisinsSauf(x | 0, y | 0, z | 0, b, dir(sauf)); },
      voisinChange: (x, y, z, bloc) => sim.voisinChangeEn(x | 0, y | 0, z | 0, blocId(bloc)),
      formeVoisin: (f, x, y, z, nx, ny, nz, drapeaux, limite) => sim.formeVoisinEn(dir(f), x | 0, y | 0, z | 0, nx | 0, ny | 0, nz | 0, drapeaux ?? 2, limite ?? 512),
      formesVoisines: (x, y, z, drapeaux, limite) => sim._majFormesVoisines(x | 0, y | 0, z | 0, drapeaux ?? 2, limite ?? 512),
      aTickPlanifie: (x, y, z) => R.aTickPlanifie(x | 0, y | 0, z | 0),
      tickCeTick: (x, y, z) => R.tickCeTick(x | 0, y | 0, z | 0),
      // acces rapides aux etats (sans fabriquer d'objet)
      fiche: (x, y, z) => {
        const e = R.etat(x | 0, y | 0, z | 0);
        if (e < 0) return { id: -1, nom: '#hidden', air: false, durete: 0, poussee: 'PUSH_PULL', blocEntite: false };
        return { id: e, nom: d.nomBloc(e), air: d.esAir(e), durete: d.durete(e), poussee: d.poussee(e), blocEntite: d.a(e, 16) };
      },
      nom: (x, y, z) => { const e = R.etat(x | 0, y | 0, z | 0); return e < 0 ? '#hidden' : d.nomBloc(e); },
      texteEtat: (id) => (typeof id === 'number' ? d.chaine(id) : id),
      heure: () => sim.heureMonde(),
      prop: (x, y, z, nom) => { const e = R.etat(x | 0, y | 0, z | 0); return e < 0 ? undefined : d.prop(e, nom); },
      etatAvec: (x, y, z, modifs) => { let e = R.etat(x | 0, y | 0, z | 0); for (const [k, v] of Object.entries(modifs)) e = d.avec(e, k, v); return e; },
      // poudre de redstone
      fil: {
        majPuissance: (x, y, z) => { const e = R.etat(x | 0, y | 0, z | 0); if (R.estFil(e)) R.majPuissanceFil(x | 0, y | 0, z | 0, e); },
        majPuissanceDe: (x, y, z, etat) => R.majPuissanceFil(x | 0, y | 0, z | 0, d.etatId(String(etat))),
        voisinsDesFils: (x, y, z) => R.majVoisinsDesFils(x | 0, y | 0, z | 0),
        forme: (x, y, z, f) => { const e = R.etat(x | 0, y | 0, z | 0); const r = R.formeFil(e, x | 0, y | 0, z | 0, dir(f)); return r === -2 ? 'minecraft:air' : r; },
        survit: (x, y, z) => R.filSurvit(x | 0, y | 0, z | 0),
        etatPose: (x, y, z) => R.etatPoseFil(x | 0, y | 0, z | 0),
        connexions: (x, y, z) => { const e = R.etat(x | 0, y | 0, z | 0); return R.estFil(e) ? d.props(R.etatConnexion(e, x | 0, y | 0, z | 0)) : null; },
        indirectes: (x, y, z, drapeaux, limite) => R.formesIndirectes(x | 0, y | 0, z | 0, R.etat(x | 0, y | 0, z | 0), drapeaux ?? 2, limite ?? 512),
      },
    };
  }
}
