// Etats de blocs pour les decors : mots de direction, classes de blocs (clotures, murets, escaliers...), lecture d'un texte de bloc
// `oak_stairs[facing=nord,half=top]`, orientation selon le type du bloc (facing, axis, rotation).
// Tout vient des tables de donnees du jeu (moteur/donnees.js : proprietes, valeurs, valeurs par defaut, classes, etiquettes) : on ne recopie rien a la main.
import { normaliserNom, voulaisTu } from './noms.js';

// ---- directions
export const MOTS = { nord: 'north', sud: 'south', est: 'east', ouest: 'west', haut: 'up', bas: 'down', north: 'north', south: 'south', east: 'east', west: 'west', up: 'up', down: 'down' };
export const VECT = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
export const OPPOSE = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
export const HORIZ = ['north', 'east', 'south', 'west'];                           // sens des aiguilles d'une montre vu d'en haut
export const GAUCHE = { north: 'west', west: 'south', south: 'east', east: 'north' };   // Direction.getCounterClockWise
export const DROITE = { north: 'east', east: 'south', south: 'west', west: 'north' };
const ROTATION_ETAT = { south: 0, west: 4, north: 8, east: 12 };                    // panneaux, bannieres, tetes : 0 = sud, 4 = ouest, 8 = nord, 12 = est
export const NOM_FR = { north: 'nord', south: 'sud', east: 'est', west: 'ouest', up: 'haut', down: 'bas' };

// tourne un mot de direction de `quarts` quarts de tour dans le sens des aiguilles d'une montre (vu d'en haut)
export function tourner(dir, quarts) {
  const i = HORIZ.indexOf(dir);
  return i < 0 ? dir : HORIZ[(i + (quarts % 4 + 4)) % 4];
}

const VALEURS_FR = {
  axis: { nord: 'z', sud: 'z', est: 'x', ouest: 'x', haut: 'y', bas: 'y' },
  half: { haut: 'top', bas: 'bottom', haute: 'upper', basse: 'lower' },
  type: { haut: 'top', bas: 'bottom', simple: 'single', gauche: 'left', droite: 'right' },
  hinge: { gauche: 'left', droite: 'right' },
  part: { tete: 'head', pied: 'foot' },
  face: { sol: 'floor', mur: 'wall', plafond: 'ceiling' },
};
const BOOLEENS = { vrai: 'true', faux: 'false', oui: 'true', non: 'false', true: 'true', false: 'false' };
const MURETS = { aucun: 'none', bas: 'low', haut: 'tall', non: 'none' };

// valeur ecrite par le modele -> valeur du jeu (mots francais acceptes ; le reste passe tel quel)
export function traduireValeur(prop, v, valeursPermises) {
  let s = String(v).trim().toLowerCase();
  if (valeursPermises.includes(s)) return s;
  if (prop === 'facing' && MOTS[s]) return MOTS[s];
  if (prop === 'axis' || prop === 'half' || prop === 'type' || prop === 'hinge' || prop === 'part' || prop === 'face') { const t = VALEURS_FR[prop][s]; if (t) return t; }
  if (valeursPermises.includes('true') && BOOLEENS[s]) return BOOLEENS[s];
  if (valeursPermises.includes('tall') && MURETS[s]) return MURETS[s];
  return s;
}

// ---- classes de blocs (memoisees) : ce que le decor doit savoir pour recalculer les liaisons
export class Classes {
  constructor(d) {
    this.d = d; this.memo = new Map();
    this.t = (n) => d.etiquette(n);
    this.tags = { fences: this.t('fences'), woodenFences: this.t('wooden_fences'), walls: this.t('walls'), gates: this.t('fence_gates'), leaves: this.t('leaves'), logs: this.t('logs'), stairs: this.t('stairs'), doors: this.t('doors'), beds: this.t('beds'), chains: this.t('chains'), bars: this.t('bars') };
  }
  info(b) {
    let i = this.memo.get(b);
    if (i) return i;
    const d = this.d, cl = new Set(d.classes(b)), nom = d.noms[b];
    const sch = d.schema(b), props = new Map(sch.map(([n, v]) => [n, v]));
    const T = this.tags;
    i = {
      bloc: b, nom, props, classes: cl,
      cloture: cl.has('FenceBlock'), muret: cl.has('WallBlock'), vitre: cl.has('IronBarsBlock'), escalier: cl.has('StairBlock'), coffre: cl.has('ChestBlock'),
      torcheMur: cl.has('WallTorchBlock'), lanterne: cl.has('LanternBlock'), neigeux: cl.has('SnowyBlock'), echelle: cl.has('LadderBlock'),
      panneauMur: cl.has('WallSignBlock'), banniereMur: cl.has('WallBannerBlock'), porte: cl.has('DoorBlock'), portillon: cl.has('FenceGateBlock'),
      lit: cl.has('BedBlock'), plante2: cl.has('DoublePlantBlock'), dalle: cl.has('SlabBlock'),
      feuilles: T.leaves.has(b), tronc: T.logs.has(b), clotureBois: T.woodenFences.has(b), chaine: T.chains.has(b),
      eau: nom === 'water', air: nom === 'air' || nom === 'cave_air' || nom === 'void_air',
      plante: cl.has('VegetationBlock') || cl.has('VineBlock') || cl.has('SnowLayerBlock') || cl.has('SugarCaneBlock') || cl.has('KelpBlock') || cl.has('GrowingPlantBlock'),
      plaque: cl.has('PressurePlateBlock') || cl.has('BasePressurePlateBlock'), tapis: cl.has('CarpetBlock'), torche: cl.has('TorchBlock') && !cl.has('WallTorchBlock'),
      bougie: cl.has('CandleBlock'), rail: cl.has('BaseRailBlock'),
    };
    this.memo.set(b, i);
    return i;
  }
  infoEtat(id) { return this.info(this.d.blocDe(id)); }
}

// ---- lecture d'un texte de bloc : `oak_stairs[facing=nord,half=top]`
// Rend { nom, bloc, props: {nom: valeur du jeu}, } ou pousse une erreur (message sans prefixe) et rend null.
export function lireBloc(texte, d, erreur) {
  if (typeof texte !== 'string' || !texte.trim()) { erreur('un nom de bloc est attendu (ex. "oak_planks" ou "oak_log[axis=x]")'); return null; }
  const m = /^([^[\]]+?)(?:\[([^\]]*)\])?$/.exec(texte.trim());
  if (!m) { erreur(`texte de bloc incorrect : "${texte}" (forme : nom ou nom[propriete=valeur,...])`); return null; }
  const nom = normaliserNom(m[1]);
  const bloc = d.idBloc(nom);
  if (bloc < 0) { erreur(`bloc inconnu "${nom}"${voulaisTu(nom, d.noms)}`); return null; }
  const props = {};
  if (m[2] !== undefined && m[2].trim() !== '') {
    const sch = new Map(d.schema(bloc).map(([n, v]) => [n, v]));
    for (const kv of m[2].split(',')) {
      const e = kv.indexOf('=');
      if (e < 1) { erreur(`${nom} : "${kv.trim()}" : forme attendue propriete=valeur`); return null; }
      const k = kv.slice(0, e).trim().toLowerCase(), v = kv.slice(e + 1).trim();
      const permis = sch.get(k);
      if (!permis) { erreur(`${nom} : propriete inconnue "${k}"${sch.size ? ` (permis : ${[...sch.keys()].join(', ')})` : ' (ce bloc n\'a aucune propriete)'}`); return null; }
      const val = traduireValeur(k, v, permis);
      if (!permis.includes(val)) { erreur(`${nom}[${k}] : valeur "${v}" inconnue (permis : ${permis.join(', ')})`); return null; }
      props[k] = val;
    }
  }
  return { nom, bloc, props };
}

// ---- orientation selon le type de bloc : `mot` est un mot du jeu ('north'...'down'). Rend { props } a ajouter (sans ecraser l'explicite) ou une chaine d'erreur.
// Convention (FORMAT-DECOR.md, B2.3) : `facing` = le cote ou regarde la FACADE du bloc ; pour un escalier : le cote ou il MONTE ; pour un lit : de pied vers tete.
export function orienter(info, mot) {
  const p = info.props, o = {};
  if (p.has('facing')) {
    if (!p.get('facing').includes(mot)) return `${info.nom} ne s'oriente pas vers "${NOM_FR[mot]}" (permis : ${p.get('facing').map((v) => NOM_FR[v] || v).join(', ')})`;
    o.facing = mot;
    if (p.has('face')) o.face = mot === 'up' || mot === 'down' ? (mot === 'up' ? 'floor' : 'ceiling') : 'wall';   // boutons, leviers : au mur par defaut
    if (p.has('face') && (mot === 'up' || mot === 'down')) delete o.facing;
    return o;
  }
  if (p.has('axis')) { o.axis = mot === 'north' || mot === 'south' ? 'z' : mot === 'east' || mot === 'west' ? 'x' : 'y'; return p.get('axis').includes(o.axis) ? o : `${info.nom} : axe ${o.axis} impossible`; }
  if (p.has('rotation')) { if (mot === 'up' || mot === 'down') return `${info.nom} ne s'oriente que vers nord, sud, est, ouest`; o.rotation = String(ROTATION_ETAT[mot]); return o; }
  return `${info.nom} n'a pas d'orientation (pas de facing, axis ni rotation)`;
}

// Etat (numero) d'un bloc : par defaut + proprietes donnees. `props` : valeurs du jeu deja validees.
export function etatDe(d, bloc, props) {
  let id = d.etatParDefaut(bloc);
  for (const [k, v] of Object.entries(props || {})) id = d.avec(id, k, v);
  return id;
}

// Le bloc plein qui correspond a un escalier ou une dalle (oak_stairs -> oak_planks, stone_brick_stairs -> stone_bricks) ; null si inconnu
export function blocPleinDe(d, nom) {
  const base = nom.replace(/_(stairs|slab)$/, '');
  for (const c of [base + '_planks', base, base + 's', base + '_block']) if (d.idBloc(c) >= 0 && !/_(stairs|slab|wall|fence)$/.test(c)) return c;
  return null;
}
export function dalleDe(d, nom) {
  const c = nom.replace(/_stairs$/, '_slab');
  return c !== nom && d.idBloc(c) >= 0 ? c : null;
}
