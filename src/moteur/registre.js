// Registre des comportements : la SEULE porte d'entree pour les mecaniques, qu'elles viennent du moteur ou d'un mod.
//   mc.bloc('torch').sur('voisin', (ev, monde) => {...})        un bloc (nom), une classe du jeu ('DoorBlock', toute la famille) ou un tag ('#minecraft:doors')
//   mc.bloc('DoorBlock').entoure('tick', (suivant, ev, monde) => { ... suivant(ev, monde); ... })   envelopper le comportement existant
//   mc.monde.sur('debutTick', (ev, monde) => {...})             evenements du monde
// Ordre d'appel (comme la chaine de classes de Java, Horizon world/level/classes.rs) : du plus specifique (nom) au plus general
// (classe parente), les gestionnaires du moteur d'abord, ceux des mods ensuite. Pour les evenements qui RENDENT une valeur
// (forme, survit...), le premier gestionnaire du moteur qui rend une valeur l'emporte (comme un `return` sans appel a `super`) ;
// les gestionnaires des mods voient cette valeur dans `ev.resultat` et peuvent la remplacer en rendant la leur.
import { ErreurMonde } from './erreurs.js';
import { voulaisTu } from './util.js';

export const EVENEMENTS_BLOC = ['tick', 'tickAleatoire', 'voisin', 'forme', 'survit', 'pose', 'retire', 'utilise', 'casse', 'butin', 'entre', 'marcheSur', 'tombeSur', 'signal', 'collision', 'explosion', 'allume', 'alimente', 'etatPose', 'declenche'];
export const EVENEMENTS_ENTITE = ['cree', 'tick', 'degats', 'meurt', 'butin', 'cible', 'attaque', 'utilise', 'meche'];
export const EVENEMENTS_MONDE = ['debutTick', 'finTick', 'avantExplosion', 'apresExplosion', 'fluide', 'tickBlocsEntites'];
export const EVENEMENTS_VALEUR = new Set(['forme', 'survit', 'signal', 'collision', 'utilise', 'cible', 'etatPose', 'declenche']);   // rendent une valeur
const NOM_PERSO = /^[a-z][A-Za-z0-9_]*\.[A-Za-z0-9_.]+$/;   // evenement du mod : "famille.nom"

class Cible {
  constructor(reg, genre, sel) { this.reg = reg; this.genre = genre; this.sel = sel; }
  sur(evt, fn) { this.reg._ajouter(this.genre, this.sel, evt, fn, 'sur'); return this; }
  entoure(evt, fn) { this.reg._ajouter(this.genre, this.sel, evt, fn, 'entoure'); return this; }
}

export class Registre {
  constructor(donnees, regles) {
    this.d = donnees; this.regles = regles;
    this.source = 'moteur';            // etiquette des enregistrements en cours ('moteur' ou 'mod:fichier.js')
    this.entrees = [];                 // enregistrements
    this.cache = new Map();
    this.figee = false;
    this.parClasse = null;             // classe -> Map(bloc -> rang)
  }
  bloc(sel) { return new Cible(this, 'bloc', sel); }
  entite(sel) { return new Cible(this, 'entite', sel); }
  get monde() { return new Cible(this, 'monde', null); }

  _classes() {
    if (this.parClasse) return this.parClasse;
    const m = new Map(), d = this.d;
    for (let b = 0; b < d.noms.length; b++) d.classes(b).forEach((c, i) => { if (!m.has(c)) m.set(c, new Map()); m.get(c).set(b, i); });
    return (this.parClasse = m);
  }
  // selecteur -> Map(bloc -> rang) ; rang : 0 nom, 1 tag, 2+ classe (indice dans la chaine)
  _resoudre(sel) {
    const d = this.d;
    if (typeof sel !== 'string' || !sel) throw new ErreurMonde('mc.bloc(...) : un nom de bloc, de classe ou de tag est attendu');
    if (sel.startsWith('#')) {
      const s = d.etiquette(sel);
      if (!s.size) throw new ErreurMonde(`mc.bloc('${sel}') : tag inconnu${voulaisTu(sel.replace(/^#(minecraft:)?/, ''), Object.keys(d.j.etiquettes))}`);
      return new Map([...s].map((b) => [b, 1]));
    }
    const b = d.idBloc(sel);
    if (b >= 0) return new Map([[b, 0]]);
    const c = this._classes().get(sel);
    if (c) return new Map([...c].map(([bl, i]) => [bl, 2 + i]));
    throw new ErreurMonde(`mc.bloc('${sel}') : bloc ou classe inconnu${voulaisTu(sel, [...d.noms, ...this._classes().keys()])}`);
  }

  _ajouter(genre, sel, evt, fn, mode) {
    if (this.figee) throw new ErreurMonde(`mc.${genre}(...).${mode}('${evt}') : les gestionnaires s'enregistrent au chargement, pas pendant la simulation`);
    if (typeof fn !== 'function') throw new ErreurMonde(`mc.${genre}(...).${mode}('${evt}', fonction) : une fonction est attendue`);
    const connus = genre === 'bloc' ? EVENEMENTS_BLOC : genre === 'entite' ? EVENEMENTS_ENTITE : EVENEMENTS_MONDE;
    if (!connus.includes(evt) && !(genre === 'monde' && NOM_PERSO.test(evt))) {
      throw new ErreurMonde(`mc.${genre}(${sel === null ? '' : `'${sel}'`}).${mode}('${evt}') : evenement inconnu${voulaisTu(evt, connus)}${genre === 'monde' ? ' (les evenements du mod sont de la forme "famille.nom")' : ''}`);
    }
    const blocs = genre === 'bloc' ? this._resoudre(sel) : null;
    this.entrees.push({ genre, sel, evt, fn, mode, source: this.source, blocs, seq: this.entrees.length });
    this.cache.clear();
  }
  figer() { this.figee = true; }

  // Chaine d'appel pour (genre, evenement, bloc) : fonction (ev, monde) -> valeur, ou false s'il n'y a rien
  _chaine(genre, evt, bloc) {
    const cle = `${genre}:${evt}:${bloc}`;
    let g = this.cache.get(cle);
    if (g !== undefined) return g;
    const valeur = EVENEMENTS_VALEUR.has(evt);
    const e = this.entrees.filter((x) => x.genre === genre && x.evt === evt && (genre !== 'bloc' || x.blocs.has(bloc)));
    const cle2 = (x) => [x.source === 'moteur' ? 0 : 1, genre === 'bloc' ? x.blocs.get(bloc) : 0, x.seq];
    e.sort((a, b) => { const p = cle2(a), q = cle2(b); return p[0] - q[0] || p[1] - q[1] || p[2] - q[2]; });
    g = null;
    for (const x of e) {
      const prev = g;
      const fn = this._proteger(x);
      if (x.mode === 'entoure') g = (ev, m) => fn((e2 = ev, m2 = m) => (prev ? prev(e2, m2) : undefined), ev, m);
      else if (x.source === 'moteur' && valeur) g = prev ? (ev, m) => { const r = prev(ev, m); return r !== undefined ? r : fn(ev, m); } : fn;
      else if (valeur) g = (ev, m) => { const r = prev ? prev(ev, m) : undefined; ev.resultat = r; const r2 = fn(ev, m); return r2 !== undefined ? r2 : r; };
      else g = prev ? (ev, m) => { prev(ev, m); fn(ev, m); } : fn;
    }
    this.cache.set(cle, g || false);
    return g || false;
  }
  _proteger(x) {
    return (...a) => {
      try { return x.fn(...a); } catch (e) {
        if (e instanceof ErreurMonde) throw e;
        throw new ErreurMonde(`${x.source === 'moteur' ? 'moteur' : x.source.replace(/^mod:/, '')} : en ${x.evt} : ${e.message}`);
      }
    };
  }

  // Y a-t-il un gestionnaire pour ce bloc et cet evenement ?
  a(evt, bloc) { return !!this._chaine('bloc', evt, bloc); }
  // Lance un evenement de bloc ; `ev` est modifie sur place ; rend la valeur du gestionnaire (undefined s'il n'y en a pas)
  lancerBloc(evt, bloc, ev, monde) {
    const g = this._chaine('bloc', evt, bloc);
    return g ? g(ev, monde) : undefined;
  }
  lancerMonde(evt, ev, monde) {
    const g = this._chaine('monde', evt, 0);
    return g ? g(ev, monde) : undefined;
  }
  aMonde(evt) { return !!this._chaine('monde', evt, 0); }
}

// Objet evenement : donnees + annuler()
export function evenement(donnees) {
  const ev = { ...donnees, annule: false };
  Object.defineProperty(ev, 'annuler', { value() { this.annule = true; }, enumerable: false });
  return ev;
}
