// Donnees du jeu pour les objets (docs/SIMULATION.md partie 26) : recettes, enchantements, etiquettes, butin de la peche, predicats, carburant de
// l'alambic. Ce sont les FICHIERS DU JEU, lus au lancement dans le kit (groupe `recettes` de kit.js, recupere dans le jar du jeu comme les autres groupes) :
// rien n'est recopie dans le depot. Les composants des objets (usure maximale, enchantabilite, attaque...) viennent de nos tables (`objets` de
// donnees-jeu, outils/extraire-donnees-jeu.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const court = (s) => String(s).replace(/^minecraft:/, '');
function lireJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
// tous les fichiers .json d'un dossier (sous-dossiers compris) : { 'brewing/potion_awkward_gunpowder': {...} } ; ordre trie (deterministe)
function lireDossier(dir) {
  const out = new Map();
  const marche = (d, rel) => {
    let l; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    l.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of l) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) marche(path.join(d, e.name), r);
      else if (e.name.endsWith('.json')) { const j = lireJson(path.join(d, e.name)); if (j) out.set(r.slice(0, -5), j); }
    }
  };
  marche(dir, '');
  return out;
}

export class ObjetsJeu {
  // racine : dossier qui contient data/minecraft (un kit, ou le dossier prepare du jeu)
  constructor(racine) {
    this.racine = racine;
    const D = path.join(racine, 'data', 'minecraft');
    if (!fs.existsSync(path.join(D, 'recipe')) || !fs.existsSync(path.join(D, 'enchantment'))) throw new Error(`donnees d'objets du jeu absentes de ${racine} (groupe de kit "recettes")`);
    this.D = D;
    this.recettes = lireDossier(path.join(D, 'recipe'));
    this.enchantements = new Map([...lireDossier(path.join(D, 'enchantment'))].map(([k, v]) => [k, { id: k, ...v }]));
    this._etiq = { item: new Map(), enchantment: new Map(), entity_type: new Map(), damage_type: new Map() };
    this._butins = new Map();
    this.usagesCarburant = (() => { const v = lireJson(path.join(D, 'context_int_provider', 'brewing', 'uses_default.json')); return typeof v === 'number' ? v : null; })();
  }
  // etiquette resolue (Set de noms sans 'minecraft:') ; genre : item | enchantment | entity_type | damage_type
  etiquette(genre, nom) {
    const n = court(String(nom).replace(/^#/, ''));
    const m = this._etiq[genre];
    let s = m.get(n);
    if (s) return s;
    s = new Set(); m.set(n, s);
    const j = lireJson(path.join(this.D, 'tags', genre, n + '.json'));
    for (const v of j?.values ?? []) {
      const id = typeof v === 'string' ? v : v.id;
      if (id.startsWith('#')) for (const x of this.etiquette(genre, id.slice(1))) s.add(x); else s.add(court(id));
    }
    return s;
  }
  // un objet est-il designe par une liste ou une chaine (`#etiquette`, `objet`, `a,b`) des fichiers du jeu ?
  objetDans(spec, id) {
    if (spec === undefined || spec === null) return true;
    const l = Array.isArray(spec) ? spec : String(spec).split(',');
    return l.some((x) => (x.startsWith('#') ? this.etiquette('item', x.slice(1)).has(id) : court(x) === id));
  }
  enchantement(id) { return this.enchantements.get(court(id)) ?? null; }
  // table de butin du jeu : 'gameplay/fishing' -> json (ou null)
  butin(nom) {
    const n = court(nom);
    if (!this._butins.has(n)) this._butins.set(n, lireJson(path.join(this.D, 'loot_table', n + '.json')));
    return this._butins.get(n);
  }
  predicat(nom) { return lireJson(path.join(this.D, 'predicate', court(nom) + '.json')); }
  // type de degats du jeu (data/minecraft/damage_type/<id>.json) : { exhaustion, scaling, message_id... }
  typeDegats(id) { const n = court(id); this._types ??= new Map(); if (!this._types.has(n)) this._types.set(n, lireJson(path.join(this.D, 'damage_type', n + '.json'))); return this._types.get(n); }
}

const CACHE = new Map();
export function chargerObjetsJeu(racine) {
  if (!CACHE.has(racine)) CACHE.set(racine, new ObjetsJeu(racine));
  return CACHE.get(racine);
}
// Racine des donnees d'objets pour les essais et `mcanim simuler` : MCANIM_OBJETS_JEU, puis le kit du cache (s'il a le groupe), puis le dossier
// prepare du jeu sur ce poste (horizon-launcher). Rend null si aucune n'existe.
export function racineObjetsLocale(env = process.env) {
  const essais = [env.MCANIM_OBJETS_JEU, env.MCANIM_KIT, path.join(env.MCANIM_CACHE || path.join(os.homedir(), '.cache', 'mcanim'), 'kit', '26.3')];
  const h = path.join(os.homedir(), 'AppData', 'Roaming', 'horizon-launcher', 'versions');
  try { for (const v of fs.readdirSync(h).sort().reverse()) essais.push(path.join(h, v, '.local', 'horizon-client', '26.3')); } catch { /* pas de lanceur */ }
  for (const r of essais) if (r && fs.existsSync(path.join(r, 'data', 'minecraft', 'recipe')) && fs.existsSync(path.join(r, 'data', 'minecraft', 'enchantment'))) return r;
  return null;
}
