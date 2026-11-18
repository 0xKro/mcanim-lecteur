// Niveau 2 de modification du jeu : des petits modules JavaScript (`monde.mods: ["fichier.js"]`), executes dans un contexte `node:vm`
// durci et isole. Un mod est un CORPS DE FONCTION qui recoit `mc` (l'API) et enregistre des gestionnaires ; il ne voit ni `process`,
// ni `require`, ni le reseau, ni les fichiers, ni l'heure, ni `Math.random` : il est deterministe (hasard : monde.hasard).
//
// Isolation (docs/SIMULATION.md 3.5, couche 1) :
//  - contexte vm avec `codeGeneration: { strings: false, wasm: false }` (ni eval, ni new Function) ; globaux retires : Date, Promise,
//    WebAssembly, SharedArrayBuffer, Atomics, Intl, WeakRef, FinalizationRegistry ; Math.random lance une erreur ;
//  - les objets qui traversent la frontiere sont des TEXTES JSON : jamais un objet du monde hote dans le contexte (un objet hote
//    laisse remonter `.constructor.constructor` vers le `Function` de l'hote). Le pont ne renvoie jamais d'erreur hote : les erreurs
//    sont des textes que le contexte relance avec SES erreurs ;
//  - chaque appel est borne en temps (1 s de mur par appel, 10 s au total, 2 millions d'appels) ; un depassement est une ERREUR de scene, pas un comportement.
// `vm` n'est pas une frontiere de securite en soi (la documentation de Node le dit) : la couche 2 (processus fils a permissions) est
// prevue en P1 ; ici on avertit.
import vm from 'node:vm';
import { ErreurMonde } from './erreurs.js';
import { verifierDefBloc, verifierDefEntite, MAX_BLOCS_PERSO, MAX_ENTITES_PERSO } from './perso.js';

// Premiere lecture des mods d'une scene : les blocs et entites qu'ils definissent (mc.definirBloc / mc.definirEntite), avant de construire
// la simulation (les tables du jeu de la scene en dependent). `types` : types de creatures connus (ou null). Rend { blocs, entites }.
export function collecterDefinitions(mods, donnees, types = null, options = {}) {
  if (!mods.length || !mods.some((m) => /definir(Bloc|Entite)/.test(m.source))) return { blocs: [], entites: [] };
  const h = new HoteMods(null, { ...options, collecte: { donnees, types } });
  for (const m of mods) h.charger(m.nom, m.source);
  return h.defs;
}

const API_PONT = ['bloc', 'poser', 'casser', 'planifier', 'voisins', 'survit', 'survitEtat', 'remplacable', 'appui', 'lumiere', 'evenement', 'son', 'particule', 'entites', 'champs', 'utiliser', 'alimenter', 'allumer', 'chuter', 'exploser', 'feu', 'blocEntite', 'regle', 'tick', 'dire', 'projectile', 'fusee', 'orienterProjectile'];

const AMORCE = `(function (pont) {
  'use strict';
  const appeler = (op, ...args) => {
    const r = JSON.parse(pont(op, JSON.stringify(args)));
    if (r !== null && typeof r === 'object' && typeof r.__erreur === 'string') throw new Error(r.__erreur);
    return r === null ? undefined : r.v;
  };
  const gestionnaires = [];
  const monde = {};
  for (const nom of ${JSON.stringify(API_PONT)}) monde[nom] = (...a) => appeler(nom, ...a);
  monde.hasard = { entier: (n) => appeler('hasard.entier', n), reel: () => appeler('hasard.reel'), booleen: () => appeler('hasard.booleen'), flottant: () => appeler('hasard.flottant') };
  Object.freeze(monde.hasard); Object.freeze(monde);
  const nouvelEv = (donnees) => { const ev = donnees; Object.defineProperty(ev, 'annuler', { value() { this.annule = true; }, enumerable: false }); return ev; };
  const cible = (genre, sel) => {
    const c = {
      sur(evt, fn) { if (typeof fn !== 'function') throw new Error("mc." + genre + "(...).sur('" + evt + "', fonction) : une fonction est attendue"); gestionnaires.push(fn); appeler('enregistrer', genre, sel, evt, 'sur', gestionnaires.length - 1); return c; },
      entoure(evt, fn) { if (typeof fn !== 'function') throw new Error("mc." + genre + "(...).entoure('" + evt + "', fonction) : une fonction est attendue"); gestionnaires.push(fn); appeler('enregistrer', genre, sel, evt, 'entoure', gestionnaires.length - 1); return c; },
    };
    return Object.freeze(c);
  };
  const mc = Object.freeze({
    bloc: (sel) => cible('bloc', sel), entite: (sel) => cible('entite', sel), monde: cible('monde', null),
    regle: (nom, repli) => appeler('regle', nom, repli),
    definirRegle: (nom, d) => appeler('definirRegle', nom, d),
    // blocs et entites du mod (moteur/perso.js) : les donnees passent en JSON, les gestionnaires de "sur" s'enregistrent sur le nouvel identifiant
    definirBloc: (id, def) => { const d = Object.assign({}, def); const sur = d.sur; delete d.sur; appeler('definirBloc', id, d); if (sur) for (const evt of Object.keys(sur)) cible('bloc', id).sur(evt, sur[evt]); },
    definirEntite: (id, def) => { const d = Object.assign({}, def); const sur = d.sur; delete d.sur; appeler('definirEntite', id, d); if (sur) for (const evt of Object.keys(sur)) cible('entite', id).sur(evt, sur[evt]); },
  });
  globalThis.__mc = mc;
  // appel d'un gestionnaire : { i, mode, niveau, ev } -> texte JSON { ev, ret }
  globalThis.__appel = (texte) => {
    const { i, mode, niveau, ev: donnees } = JSON.parse(texte);
    const ev = nouvelEv(donnees);
    let ret;
    if (mode === 'entoure') {
      const suivant = (e2) => {
        const cible2 = e2 === undefined ? ev : e2;
        const r = JSON.parse(pont('suivant', JSON.stringify([niveau, cible2])));
        if (r !== null && typeof r === 'object' && typeof r.__erreur === 'string') throw new Error(r.__erreur);
        for (const k of Object.keys(r.ev)) ev[k] = r.ev[k];
        return r.ret;
      };
      ret = gestionnaires[i](suivant, ev, monde);
    } else ret = gestionnaires[i](ev, monde);
    return JSON.stringify({ ev, ret: ret === undefined ? null : ret });
  };
})`;

const DURCIR = `
  for (const n of ['Date', 'Promise', 'WebAssembly', 'SharedArrayBuffer', 'Atomics', 'Intl', 'WeakRef', 'FinalizationRegistry']) { try { delete globalThis[n]; } catch (e) {} }
  Math.random = function random() { throw new Error('Math.random est interdit dans un mod (le jeu doit etre rejouable) : utilise monde.hasard.reel()'); };
  for (const c of [Object, Array, Function, String, Number, Boolean, Symbol, Map, Set, Error, JSON, Math, RegExp]) { try { Object.freeze(c.prototype); } catch (e) {} }
  Object.freeze(Math); Object.freeze(JSON);
`;

// normalisation d'un fichier de mod : fins de ligne \n, sans BOM (meme texte que celui de l'empreinte)
export const normaliserMod = (txt) => txt.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

export class HoteMods {
  // sim : Simulation ; options : { budgetAppelMs, budgetTotalMs }
  // Le plafond d'un appel est LARGE (1 s de mur : un appel normal prend quelques microsecondes) : un depassement est une ERREUR de scene, jamais un
  // comportement, et le temps mur n'est pas deterministe (machine chargee). Le garde-fou deterministe est le nombre d'appels.
  // collecte : { donnees, types } pour la PREMIERE lecture (collecterDefinitions) : seuls definirBloc / definirEntite comptent, le reste ne fait rien
  constructor(sim, { budgetAppelMs = 1000, budgetTotalMs = 10000, maxAppels = 2000000, collecte = null } = {}) {
    this.maxAppels = maxAppels;
    this.collecte = collecte; this.defs = { blocs: [], entites: [] };
    this.sim = sim; this.budgetAppelMs = budgetAppelMs; this.budgetTotalMs = budgetTotalMs;
    this.ms = 0; this.appels = 0; this.fichiers = [];
    this.ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
    vm.runInContext(DURCIR, this.ctx, { filename: 'durcir.js', timeout: 1000 });
    this.fichierCourant = null;
    this.suivants = [];                         // pile des "suivant" des enveloppes en cours
    this.handlers = new Map();                  // fichier -> (indice du gestionnaire) ; les indices sont globaux au contexte
    const amorce = vm.runInContext(AMORCE, this.ctx, { filename: 'amorce.js', timeout: 1000 });
    this._pont = (op, json) => this._pontHote(op, json);
    amorce(this._pont);                         // la fonction d'amorce vit dans le contexte ; `pont` reste dans sa fermeture
    this.script = new vm.Script('__appel(__arg)', { filename: 'appel.js' });
  }

  // texte JSON -> texte JSON ; ne lance JAMAIS : les erreurs sont des textes
  _pontHote(op, json) {
    try {
      const a = JSON.parse(json), sim = this.sim;
      if (this.collecte) return JSON.stringify({ v: this._collecter(op, a) });
      if (op === 'definirBloc' || op === 'definirEntite') {   // deja lus par la premiere lecture (collecterDefinitions) : on verifie seulement
        const liste = op === 'definirBloc' ? sim.d.perso?.blocs : sim.persoEntites;
        if (!liste?.some((d) => d.id === a[0])) throw new ErreurMonde(`mc.${op}('${a[0]}') : a appeler au chargement du mod (pas dans un gestionnaire)`);
        return JSON.stringify({ v: null });
      }
      if (op === 'enregistrer') {
        const [genre, sel, evt, mode, idx] = a;
        const f = this.fichierCourant;
        if (f === null) throw new ErreurMonde('mc.' + genre + '(...).' + mode + ' : les gestionnaires s\'enregistrent au chargement du mod');
        const fichier = f, reg = sim.reg;
        reg.source = 'mod:' + fichier;
        const cible = genre === 'monde' ? reg.monde : genre === 'bloc' ? reg.bloc(sel) : reg.entite(sel);
        if (mode === 'sur') cible.sur(evt, (ev, m) => this._appelerGest(fichier, idx, 'sur', evt, ev, null));
        else cible.entoure(evt, (suivant, ev, m) => this._appelerGest(fichier, idx, 'entoure', evt, ev, suivant, m));
        return JSON.stringify({ v: null });
      }
      if (op === 'suivant') {
        const [niveau, evJ] = a;
        const f = this.suivants[niveau];
        if (!f) throw new ErreurMonde('suivant() appele hors de son enveloppe');
        const ev = evJ;
        const ret = f.suivant(ev, sim.api);
        return JSON.stringify({ ev, ret: ret === undefined ? null : ret });
      }
      if (op === 'definirRegle') { const d = a[1] || {}; sim.regles.declarer(a[0], { def: d.def, min: d.min, max: d.max, entier: d.entier, choix: d.choix, doc: d.doc }); return JSON.stringify({ v: null }); }
      if (op === 'hasard.entier') return JSON.stringify({ v: sim.api.hasard.entier(a[0]) });
      if (op === 'hasard.reel') return JSON.stringify({ v: sim.api.hasard.reel() });
      if (op === 'hasard.booleen') return JSON.stringify({ v: sim.api.hasard.booleen() });
      if (op === 'hasard.flottant') return JSON.stringify({ v: sim.api.hasard.flottant() });
      if (!API_PONT.includes(op)) throw new ErreurMonde(`monde.${op} : appel inconnu`);
      const v = sim.api[op](...a);
      return JSON.stringify({ v: v === undefined ? null : v });
    } catch (e) { return JSON.stringify({ __erreur: String(e && e.message ? e.message : e) }); }
  }

  _collecter(op, a) {
    const { donnees, types } = this.collecte, D = this.defs;
    if (op === 'definirBloc' || op === 'definirEntite') {
      if (this.fichierCourant === null) throw new ErreurMonde(`mc.${op}('${a[0]}') : a appeler au chargement du mod (pas dans un gestionnaire)`);
      const bloc = op === 'definirBloc', liste = bloc ? D.blocs : D.entites;
      if (D.blocs.some((d) => d.id === a[0]) || D.entites.some((d) => d.id === a[0])) throw new ErreurMonde(`mc.${op}('${a[0]}') : identifiant deja defini`);
      if (liste.length >= (bloc ? MAX_BLOCS_PERSO : MAX_ENTITES_PERSO)) throw new ErreurMonde(`mc.${op} : ${bloc ? MAX_BLOCS_PERSO : MAX_ENTITES_PERSO} au plus par scene`);
      liste.push(bloc ? verifierDefBloc(a[0], a[1], donnees) : verifierDefEntite(a[0], a[1], types));
      return null;
    }
    if (op === 'regle') return a[1] === undefined ? null : a[1];
    if (op === 'hasard.entier' || op === 'hasard.reel' || op === 'hasard.flottant') return 0;
    if (op === 'hasard.booleen') return false;
    return null;   // enregistrer, definirRegle, monde.* : rien a la premiere lecture
  }

  // Appelle un gestionnaire du contexte ; `ev` (objet hote) est mis a jour avec les modifications du mod ; rend la valeur renvoyee
  _appelerGest(fichier, idx, mode, evt, ev, suivant, m) {
    if (this.appels >= this.maxAppels) throw new ErreurMonde(`${fichier} : plus de ${this.maxAppels} appels de gestionnaires dans la scene ; simplifie le mod`);
    if (this.ms > this.budgetTotalMs) throw new ErreurMonde(`${fichier} : le total des appels de mods depasse ${this.budgetTotalMs / 1000} s de calcul ; simplifie le mod`);
    const t0 = performance.now();
    let niveau = -1;
    if (mode === 'entoure') { niveau = this.suivants.length; this.suivants.push({ suivant }); }
    this.ctx.__arg = JSON.stringify({ i: idx, mode, niveau, ev });
    let sortie;
    try {
      sortie = this.script.runInContext(this.ctx, { timeout: this.budgetAppelMs });
    } catch (e) {
      throw this._erreur(fichier, evt, e);
    } finally {
      if (niveau >= 0) this.suivants.length = niveau;
      this.ms += performance.now() - t0; this.appels++;
    }
    const r = JSON.parse(sortie);
    for (const k of Object.keys(r.ev)) ev[k] = r.ev[k];
    return r.ret === null ? undefined : r.ret;
  }

  // Erreur du contexte -> erreur d'une ligne : "fichier.js:LIGNE : en evenement : message"
  _erreur(fichier, evt, e) {
    if (e instanceof ErreurMonde) return e;
    const msg = String(e && e.message !== undefined ? e.message : e);
    if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return new ErreurMonde(`${fichier} : ${evt ? 'en ' + evt + ' : ' : ''}appel arrete apres ${this.budgetAppelMs} ms (boucle sans fin ?)`);
    const pile = String((e && e.stack) || '');
    const m = new RegExp(fichier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(\\d+)').exec(pile);
    return new ErreurMonde(`${fichier}${m ? ':' + m[1] : ''} : ${evt ? 'en ' + evt + ' : ' : ''}${msg}`);
  }

  // Charge un mod : `source` = texte du fichier (corps de fonction recevant `mc`). Rend le nombre de gestionnaires enregistres.
  charger(fichier, source) {
    if (this.collecte) {   // premiere lecture : execute le corps du mod, rien n'est enregistre
      this.fichierCourant = fichier;
      try {
        let script;
        try { script = new vm.Script('(function(mc){"use strict";' + normaliserMod(source) + '\n})(__mc)', { filename: fichier }); } catch (e) { const m = /:(\d+)/.exec(String(e.stack || '')); throw new ErreurMonde(`${fichier}${m ? ':' + m[1] : ''} : ${e.message}`); }
        try { script.runInContext(this.ctx, { timeout: this.budgetAppelMs * 4 }); } catch (e) { throw this._erreur(fichier, null, e); }
      } finally { this.fichierCourant = null; }
      return 0;
    }
    const avant = this.sim.reg.entrees.length;
    this.fichierCourant = fichier;
    try {
      const texte = normaliserMod(source);
      let script;
      try { script = new vm.Script('(function(mc){"use strict";' + texte + '\n})(__mc)', { filename: fichier }); } catch (e) {
        const m = /:(\d+)/.exec(String(e.stack || ''));
        throw new ErreurMonde(`${fichier}${m ? ':' + m[1] : ''} : ${e.message}`);
      }
      try { script.runInContext(this.ctx, { timeout: this.budgetAppelMs * 4 }); } catch (e) { throw this._erreur(fichier, null, e); }
    } finally { this.fichierCourant = null; this.sim.reg.source = 'moteur'; }
    this.fichiers.push(fichier);
    return this.sim.reg.entrees.length - avant;
  }
}
