// Caracteristiques du jeu (ConfiguredFeature) lues dans le kit au moment de la simulation : arbres (minecraft:tree, tous les troncs, feuillages,
// racines, decorations, taille minimale), champignons geants. Port d'apres Horizon horizon-world/src/worldgen/tree.rs, tree/{trunk,foliage,decorator}.rs,
// tree_blocks.rs, state_provider.rs, value_provider.rs, vegetation.rs (HugeMushroomFeature) : MIT, voir ATTRIBUTIONS.md.
// Les configurations (hauteurs, rayons, blocs, probabilites) viennent des fichiers du jeu `data/minecraft/worldgen/feature/*.json` et
// `worldgen/block_state_provider/*.json` du kit de l'utilisateur (groupe `worldgen`) : rien du jeu n'est copie dans le lecteur.
// Ordre des tirages : celui du jeu (Horizon le reproduit), avec le hasard du niveau ; ordre d'iteration des HashSet<BlockPos> du jeu (ordre-java.js)
// la ou il nourrit des tirages (listes des decorations).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { D } from './donnees.js';
import { ordreHashSet, melangerJeu } from './ordre-java.js';
import { cosMth, sinMth } from './mth.js';
import { FACE_DX, FACE_DY, FACE_DZ, FACE_OPPOSEE, Y_MIN, Y_MAX } from './monde.js';

// directions du jeu : 0 bas, 1 haut, 2 nord, 3 sud, 4 ouest, 5 est
const BAS = 0, HAUT = 1, NORD = 2, SUD = 3, OUEST = 4, EST = 5;
export const HORIZ = [NORD, EST, SUD, OUEST];                    // Direction.Plane.HORIZONTAL
export const NOMS_DIR = ['down', 'up', 'north', 'south', 'west', 'east'];
const HORAIRE = { [NORD]: EST, [EST]: SUD, [SUD]: OUEST, [OUEST]: NORD };
const off = (p, dx, dy, dz) => [p[0] + dx, p[1] + dy, p[2] + dz];
const rel = (p, d, n = 1) => [p[0] + FACE_DX[d] * n, p[1] + FACE_DY[d] * n, p[2] + FACE_DZ[d] * n];
const axeDe = (d) => (d === OUEST || d === EST ? 'x' : d === BAS || d === HAUT ? 'y' : 'z');
const f32 = Math.fround;
const cle = (p) => `${p[0]},${p[1]},${p[2]}`;
// Vec3i.distManhattan (somme en flottants simples)
const manhattan = (a, b) => Math.trunc(f32(f32(Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1])) + Math.abs(b[2] - a[2])));

// Dossier `data/minecraft/worldgen` du kit : config.kitDir, MCANIM_KIT, puis le kit en cache de mcanim ; null s'il n'a pas les caracteristiques
export function dossierCaracteristiques(kitDir, env = process.env) {
  const cands = [kitDir, env.MCANIM_KIT, env.MCANIM_CACHE && path.join(env.MCANIM_CACHE, 'kit', '26.3'), path.join(os.homedir(), '.cache', 'mcanim', 'kit', '26.3')].filter(Boolean);
  for (const c of cands) for (const d of [c, path.join(c, '26.3')]) {
    const w = path.join(d, 'data', 'minecraft', 'worldgen');
    if (fs.existsSync(path.join(w, 'feature', 'oak.json'))) return w;
  }
  return null;
}

// Ensemble de positions avec l'ordre d'iteration d'un HashSet<BlockPos> du jeu
class Ensemble {
  constructor() { this.m = new Map(); }
  ajouter(p) { const k = cle(p); if (!this.m.has(k)) this.m.set(k, p); }
  a(p) { return this.m.has(cle(p)); }
  get taille() { return this.m.size; }
  liste() { return ordreHashSet([...this.m.values()]); }
}

export class Caracteristiques {
  constructor(sim, dossier) {
    this.sim = sim; this.d = sim.d; this.dossier = dossier;
    this.cache = new Map(); this.fournisseurs = new Map();
    const d = this.d, e = (t) => d.etiquette(t);
    this.t = { feuilles: e('leaves'), parArbres: e('replaceable_by_trees'), bois: e('logs'), garde: e('prevents_nearby_leaf_decay'), champi: e('replaceable_by_mushrooms') };
    this.b = { vine: d.idBloc('vine'), water: d.idBloc('water'), shelf: d.idBloc('shelf_mushroom') };
  }
  // configuration d'une caracteristique (fichier du jeu dans le kit) ; null si absente
  json(nom) {
    const n = String(nom).replace(/^minecraft:/, '');
    if (!this.cache.has(n)) {
      let j = null;
      try { j = JSON.parse(fs.readFileSync(path.join(this.dossier, 'feature', ...n.split('/')) + '.json', 'utf8')); } catch { j = null; }
      this.cache.set(n, j);
    }
    return this.cache.get(n);
  }
  existe(nom) { return !!this.json(nom); }

  // ---------------------------------------------------------------- lecture du monde
  etat(p) { return this.sim.monde.etatEn(p[0], p[1], p[2]); }
  bloc(e) { return e < 0 ? -1 : this.d.blocDe(e); }
  air(e) { return e >= 0 && this.d.esAir(e); }
  dans(e, t) { return e >= 0 && t.has(this.d.blocDe(e)); }
  arbreValide(e) { return this.air(e) || this.dans(e, this.t.parArbres); }   // TreeFeature.validTreePos
  distanceFeuille(e) {                                                          // LeavesBlock.getOptionalDistanceAt
    if (e < 0) return null;
    if (this.t.garde.has(this.d.blocDe(e))) return 0;
    const v = this.d.prop(e, 'distance');
    return v !== undefined && this.d.schema(this.d.blocDe(e)).find(([n]) => n === 'distance')?.[1].length === 7 ? Number(v) : null;
  }
  aProp(e, nom) { return e >= 0 && this.d.prop(e, nom) !== undefined; }
  avec(e, nom, val) { return this.aProp(e, nom) ? this.d.avec(e, nom, String(val)) : e; }
  // BlockState.trySetValue(AXIS) : seulement pour une propriete d'axe a trois valeurs
  axe(e, a) { const s = this.d.schema(this.d.blocDe(e)).find(([n]) => n === 'axis'); return s && s[1].length === 3 ? this.d.avec(e, 'axis', a) : e; }
  mouille(e, v) { return this.aProp(e, 'waterlogged') ? this.d.avec(e, 'waterlogged', v ? 'true' : 'false') : e; }
  eauSource(e) { return e >= 0 && this.d.fluide(e) === 2; }
  eauFluide(e) { return e >= 0 && (this.d.fluide(e) === 1 || this.d.fluide(e) === 2); }
  ecrire(p, e, drapeaux) { return this.sim.poser(p[0], p[1], p[2], e, drapeaux); }

  // ---------------------------------------------------------------- etats, fournisseurs, valeurs (state_provider.rs, value_provider.rs)
  etatJson(v) {
    if (typeof v === 'string') { const id = this.d.etatId(v); if (id < 0) throw new Error(`caracteristique : bloc inconnu ${v}`); return id; }
    const nom = v.id ?? v.Name, pr = v.properties ?? v.Properties ?? {};
    const txt = `${nom}${Object.keys(pr).length ? `[${Object.entries(pr).map(([k, x]) => `${k}=${x}`).join(',')}]` : ''}`;
    const id = this.d.etatId(txt);
    if (id < 0) throw new Error(`caracteristique : etat inconnu ${txt}`);
    return id;
  }
  fournisseur(v) {
    if (typeof v === 'string') {                    // reference au registre worldgen/block_state_provider, sinon un bloc
      if (!this.fournisseurs.has(v)) {
        let j = null;
        try { j = JSON.parse(fs.readFileSync(path.join(this.dossier, 'block_state_provider', v.replace(/^minecraft:/, '') + '.json'), 'utf8')); } catch { j = null; }
        this.fournisseurs.set(v, j ? this.fournisseur(j) : { k: 'simple', e: this.etatJson(v) });
      }
      return this.fournisseurs.get(v);
    }
    if (!v.type) return { k: 'simple', e: this.etatJson(v) };
    const t = v.type.replace(/^minecraft:/, '');
    if (t === 'simple' || t === 'simple_state_provider') return { k: 'simple', e: this.etatJson(v.state) };
    if (t === 'rule_based') return { k: 'regles', regles: v.rules.map((r) => ({ si: r.if_true, alors: this.fournisseur(r.then) })), repli: v.fallback ? this.fournisseur(v.fallback) : null };
    if (t === 'weighted' || t === 'weighted_state_provider') return { k: 'pondere', l: (v.entries ?? v.distribution).map((x) => ({ p: x.weight, v: this.etatJson(x.data) })) };
    if (t === 'randomized_int' || t === 'randomized_int_state_provider') return { k: 'entier', src: this.fournisseur(v.source), prop: v.property, val: v.values };
    if (t === 'rotated' || t === 'rotated_block_provider') return { k: 'tourne', src: this.fournisseur(v.state), dir: v.direction ?? null };
    if (t === 'random_block') return { k: 'auhasard', l: [].concat(v.blocks).map((b) => this.etatJson(b)) };
    throw new Error(`caracteristique : fournisseur d'etat "${t}" non gere`);
  }
  // BlockStateProvider.getOptionalState : rend un etat ou null
  etatFourni(f, p, h) {
    switch (f.k) {
      case 'simple': return f.e;
      case 'regles':
        for (const r of f.regles) { if (this.predicat(r.si, p)) { const e = this.etatFourni(r.alors, p, h); if (e !== null) return e; } }
        return f.repli ? this.etatFourni(f.repli, p, h) : null;
      case 'pondere': return pondere(f.l, h);
      case 'auhasard': return f.l.length ? f.l[h.entierBorne(f.l.length)] : null;
      case 'entier': {
        const e = this.etatFourni(f.src, p, h) ?? this.etat(p);
        return this.aProp(e, f.prop) ? this.d.avec(e, f.prop, String(this.entier(f.val, h))) : e;
      }
      case 'tourne': {
        const dir = f.dir ? NOMS_DIR.indexOf(f.dir) : h.entierBorne(6);
        const e = this.etatFourni(f.src, p, h) ?? this.etat(p);
        if (this.aProp(e, 'axis')) return this.axe(e, axeDe(dir));
        if (this.aProp(e, 'facing')) { const r = this.d.avec(e, 'facing', NOMS_DIR[dir]); return r; }
        return e;
      }
      default: return null;
    }
  }
  etatFourniOuIci(f, p, h) { const e = this.etatFourni(f, p, h); return e === null ? this.etat(p) : e; }
  // IntProvider.sample
  entier(v, h) {
    if (typeof v === 'number') return v;
    const t = String(v.type || '').replace(/^minecraft:/, '');
    if (t === 'constant') return v.value;
    if (t === 'uniform' || (!t && v.min_inclusive !== undefined)) return h.entreInclus(v.min_inclusive, v.max_inclusive);
    if (t === 'biased_to_bottom' || t === 'very_biased_to_bottom') {
      let x = h.entierBorne(v.max_inclusive - v.min_inclusive + 1);
      x = h.entierBorne(x + 1);
      if (t === 'very_biased_to_bottom') x = h.entierBorne(x + 1);
      return v.min_inclusive + x;
    }
    if (t === 'weighted_list') return this.entier(pondere(v.distribution.map((x) => ({ p: x.weight, v: x.data })), h), h);
    if (t === 'clamped') return Math.min(v.max_inclusive, Math.max(v.min_inclusive, this.entier(v.source, h)));
    if (t === 'clamped_normal') return Math.trunc(Math.min(v.max, Math.max(v.min, f32(v.mean + f32(h.gaussien()) * v.deviation))));
    if (t === 'trapezoid') {
      const { min, max, plateau } = v, range = max - min;
      if (plateau >= range) return h.entreInclus(min, max);
      const middle = (range - plateau) / 2 | 0, slope = range - middle;
      return min + h.entreInclus(0, slope) + h.entreInclus(0, middle);
    }
    throw new Error(`caracteristique : valeur entiere "${t}" non geree`);
  }
  bornes(v) { if (typeof v === 'number') return [v, v]; if (v.type?.endsWith('constant')) return [v.value, v.value]; return [v.min_inclusive ?? 0, v.max_inclusive ?? 0]; }

  // BlockPredicate.test
  predicat(pr, p) {
    const t = String(pr.type).replace(/^minecraft:/, ''), o = pr.offset ? off(p, ...pr.offset) : p;
    const e = this.etat(o);
    switch (t) {
      case 'true': return true;
      case 'not': return !this.predicat(pr.predicate, p);
      case 'all_of': return pr.predicates.every((q) => this.predicat(q, p));
      case 'any_of': return pr.predicates.some((q) => this.predicat(q, p));
      case 'matching_block_tag': return this.dans(e, this.d.etiquette(pr.tag));
      case 'matching_blocks': return e >= 0 && [].concat(pr.blocks).some((b) => (b.startsWith('#') ? this.d.etiquette(b).has(this.d.blocDe(e)) : this.d.idBloc(b) === this.d.blocDe(e)));
      case 'matching_fluids': { const f = e < 0 ? 0 : this.d.fluide(e); return [].concat(pr.fluids).some((n) => (/flowing_water$/.test(n) ? f === 1 : /water$/.test(n) ? f === 2 : /flowing_lava$/.test(n) ? f === 3 : /lava$/.test(n) ? f === 4 : false)); }
      case 'replaceable': return e >= 0 && this.d.a(e, D.REMPLACABLE);
      case 'solid': return e >= 0 && this.d.estSolide(e);
      case 'inside_world_bounds': return o[1] >= Y_MIN && o[1] < Y_MAX;
      case 'has_sturdy_face': return e >= 0 && this.d.solideFace(e, NOMS_DIR.indexOf(pr.direction), 0);
      case 'would_survive': { const id = this.etatJson(pr.state); return this.sim.survitEtat(o[0], o[1], o[2], this.d.chaine(id)); }
      case 'unobstructed': return true;
      default: throw new Error(`caracteristique : predicat de bloc "${t}" non gere`);
    }
  }

  // ---------------------------------------------------------------- placer une caracteristique configuree (ConfiguredFeature.place)
  placer(nom, x, y, z) {
    const j = this.json(nom);
    if (!j) return false;
    return this.placerDef(j, [x, y, z], nom);
  }
  placerDef(j, p, nom = '?', h = this.sim.hasard) {
    if (typeof j === 'string') { nom = j; j = this.json(j); if (!j) { this.sim.avertir(`caracteristique ${nom} absente du kit`); return false; } }
    const t = String(j.type).replace(/^minecraft:/, '');
    const c = j.config ?? j;
    if (t === 'tree') return new Arbre(this, c).placer(p);
    if (t === 'huge_red_mushroom' || t === 'huge_brown_mushroom') return this.champignonGeant(c, t === 'huge_red_mushroom', p);
    if (t === 'vegetation_patch') return this.tapis(c, p, h);
    if (t === 'simple_block') return this.blocSimple(c, p, h);
    this.sim.avertir(`caracteristique ${nom} de type ${t} : non geree`);
    return false;
  }
  // PlacedFeature sans regle de placement (liste vide) : la caracteristique a la position
  placerPlacee(v, p, h) {
    if (typeof v === 'string' || !v.placement) return this.placerDef(v, p, '?', h);
    if (v.placement.length) { this.sim.avertir('caracteristique placee avec regles de placement : non geree'); return false; }
    return this.placerDef(v.feature, p, '?', h);
  }

  // VegetationPatchFeature (sol seulement : surface "floor" ; le tapis mouille n'est pas utilise par les arbres)
  tapis(c, o, h) {
    const d = this.d, bas = c.surface === 'ceiling' ? HAUT : BAS, haut = bas === BAS ? HAUT : BAS;
    const rempl = String(c.replaceable).startsWith('#') ? d.etiquette(String(c.replaceable).slice(1).replace(/^minecraft:/, '')) : new Set([].concat(c.replaceable).map((b) => d.idBloc(b)));
    const sol = this.fournisseur(c.ground_state);
    const rx = this.entier(c.xz_radius, h) + 1, rz = this.entier(c.xz_radius, h) + 1;
    const surface = new Ensemble(), ext = f32(c.extra_edge_column_chance ?? 0), bonus = f32(c.extra_bottom_block_chance ?? 0), vr = c.vertical_range;
    for (let dx = -rx; dx <= rx; dx++) {
      const bx = dx === -rx || dx === rx;
      for (let dz = -rz; dz <= rz; dz++) {
        const bz = dz === -rz || dz === rz, bord = bx || bz, coin = bx && bz;
        if (coin || (bord && !(ext !== 0 && h.flottant() <= ext))) continue;
        let p = off(o, dx, 0, dz);
        for (let k = 0; this.air(this.etat(p)) && k < vr; k++) p = rel(p, bas);
        for (let k = 0; !this.air(this.etat(p)) && k < vr; k++) p = rel(p, haut);
        const dessous = rel(p, bas), ed = this.etat(dessous);
        if (!this.air(this.etat(p)) || !(ed >= 0 && d.solideFace(ed, haut, 0))) continue;
        const prof = this.entier(c.depth, h) + (bonus > 0 && h.flottant() < bonus ? 1 : 0);
        let q = dessous, ok = true;
        for (let i = 0; i < prof; i++) {                                  // placeGround
          const e = this.etatFourni(sol, q, h), ex = this.etat(q);
          if (this.bloc(e) !== this.bloc(ex)) {
            if (!this.dans(ex, rempl)) { ok = i !== 0; break; }
            this.ecrire(q, e, 2); q = rel(q, bas);
          }
        }
        if (ok) surface.ajouter(dessous);
      }
    }
    const veg = f32(c.vegetation_chance ?? 0);
    for (const p of surface.liste()) if (veg > 0 && h.flottant() < veg) this.placerPlacee(c.vegetation_feature, rel(p, haut), h);
    return surface.taille > 0;
  }
  // SimpleBlockFeature : etat fourni, survie, puis pose (plante double : les deux moities ; tapis de mousse : MossyCarpetBlock.placeAt)
  blocSimple(c, p, h) {
    const e = this.etatFourni(this.fournisseur(c.to_place), p, h);
    if (e === null || e < 0) return false;
    if (!this.sim.survitEtat(p[0], p[1], p[2], this.d.chaine(e))) return false;
    const d = this.d;
    if (d.prop(e, 'half') === 'lower' && this.d.schema(d.blocDe(e)).find(([n]) => n === 'half')?.[1].includes('upper')) {
      const a = off(p, 0, 1, 0), ea = this.etat(a);
      if (!this.air(ea) && (d.fluide(e) !== d.fluide(ea) || !(ea >= 0 && d.a(ea, D.REMPLACABLE)))) return false;
      for (const [q, moitie] of [[p, 'lower'], [a, 'upper']]) {
        let s = d.avec(e, 'half', moitie);
        if (this.aProp(s, 'waterlogged')) s = this.mouille(s, this.eauSource(this.etat(q)));
        this.ecrire(q, s, 2);
      }
    } else if (d.nomBloc(d.blocDe(e)).endsWith('pale_moss_carpet')) this.tapisMousse(p);
    else this.ecrire(p, e, 2);
    if (c.schedule_tick) this.sim.planifier?.(p[0], p[1], p[2], 1);
    return true;
  }
  // MossyCarpetBlock.placeAt / getUpdatedState / createTopperWithSideChance (hasard du niveau, comme le jeu)
  tapisMousse(p) {
    const d = this.d, base = d.idBloc('pale_moss_carpet'), defaut = this.etatJson('minecraft:pale_moss_carpet');
    const COTES = [NORD, EST, SUD, OUEST], NOMS = ['none', 'low', 'tall'];
    const lire = (e) => (e >= 0 && d.blocDe(e) === base ? { bas: d.prop(e, 'bottom') === 'true', cotes: COTES.map((f) => NOMS.indexOf(d.prop(e, NOMS_DIR[f]))) } : null);
    const etatDe = (m) => { let e = d.avec(defaut, 'bottom', m.bas ? 'true' : 'false'); COTES.forEach((f, i) => { e = d.avec(e, NOMS_DIR[f], NOMS[m.cotes[i]]); }); return e; };
    const accroche = (q, f) => { const v = this.etat(rel(q, f)); return v >= 0 && d.solideFace(v, FACE_OPPOSEE[f], 0); };
    const maj = (m, q, force) => {
      force = force || m.bas; const r = { bas: m.bas, cotes: m.cotes.slice() };
      COTES.forEach((f, i) => {
        let s = accroche(q, f) ? (force ? 1 : m.cotes[i]) : 0;
        if (s === 1) {
          const dessus = lire(this.etat(off(q, 0, 1, 0)));
          if (dessus && !dessus.bas && dessus.cotes[i] !== 0) s = 2;
          if (!m.bas) { const dessous = lire(this.etat(off(q, 0, -1, 0))); if (dessous && dessous.cotes[i] === 0) s = 0; }
        }
        r.cotes[i] = s;
      });
      return r;
    };
    let bas = maj(lire(defaut), p, true);
    this.ecrire(p, etatDe(bas), 2);
    const a = off(p, 0, 1, 0), ea = this.etat(a), ma = lire(ea);
    if ((ma && ma.bas) || (!ma && !(ea >= 0 && d.a(ea, D.REMPLACABLE)))) return;
    let t = maj({ bas: false, cotes: lire(defaut).cotes }, a, true);
    t.cotes = t.cotes.map((s) => (s !== 0 && !this.sim.hasard.booleen() ? 0 : s));
    const et = etatDe(t);
    if (!(t.bas || t.cotes.some((s) => s !== 0)) || et === ea) return;
    this.ecrire(a, et, 2);
    bas = maj(bas, p, true);
    this.ecrire(p, etatDe(bas), 2);
  }

  // HugeMushroomFeature (rouge / brun)
  champignonGeant(c, rouge, o) {
    const h = this.sim.hasard, chapeau = this.fournisseur(c.cap_provider), pied = this.fournisseur(c.stem_provider), r = c.foliage_radius ?? 2;
    let haut = h.entierBorne(3) + 4;
    if (h.entierBorne(12) === 0) haut *= 2;
    if (o[1] < Y_MIN + 1 || o[1] + haut + 1 > Y_MAX - 1) return false;
    if (!this.predicat(c.can_place_on, off(o, 0, -1, 0))) return false;
    const rayon = (yo) => (rouge ? ((yo < -1 && yo >= -4) || yo === -1 ? r : 0) : yo <= 3 ? 0 : r);   // getTreeRadiusForHeight(-1, r, yo)
    for (let dy = 0; dy <= haut; dy++) {
      const R = rayon(dy);
      for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) { const e = this.etat(off(o, dx, dy, dz)); if (!(this.air(e) || this.dans(e, this.t.feuilles))) return false; }
    }
    const poserChampi = (p, e) => { const ici = this.etat(p); if (this.air(ici) || this.dans(ici, this.t.champi)) this.ecrire(p, e, 3); };
    const faces = (e, l) => (l.every(([n]) => this.aProp(e, n)) ? l.reduce((s, [n, v]) => this.d.avec(s, n, v ? 'true' : 'false'), e) : e);
    if (rouge) {
      for (let dy = haut - 3; dy <= haut; dy++) {
        const R = dy < haut ? r : r - 1, centre = r - 2;
        for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
          const bx = dx === -R || dx === R, bz = dz === -R || dz === R;
          if (dy >= haut || bx !== bz) {
            const e = faces(this.etatFourniOuIci(chapeau, o, h), [['west', dx < -centre], ['east', dx > centre], ['north', dz < -centre], ['south', dz > centre], ['up', dy >= haut - 1]]);
            poserChampi(off(o, dx, dy, dz), e);
          }
        }
      }
    } else {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const mnx = dx === -r, mxx = dx === r, mnz = dz === -r, mxz = dz === r, bx = mnx || mxx, bz = mnz || mxz;
        if (bx && bz) continue;
        const e = faces(this.etatFourniOuIci(chapeau, o, h), [['west', mnx || (bz && dx === 1 - r)], ['east', mxx || (bz && dx === r - 1)], ['north', mnz || (bx && dz === 1 - r)], ['south', mxz || (bx && dz === r - 1)]]);
        poserChampi(off(o, dx, haut, dz), e);
      }
    }
    for (let dy = 0; dy < haut; dy++) poserChampi(off(o, 0, dy, 0), this.etatFourniOuIci(pied, o, h));
    this.sim.dire(`champignon geant ${rouge ? 'rouge' : 'brun'} en ${o.join(',')} : hauteur ${haut}`);
    return true;
  }
}

// WeightedList.getRandom
function pondere(l, h) {
  const total = l.reduce((s, x) => s + x.p, 0);
  if (!total) return null;
  let k = h.entierBorne(total);
  for (const x of l) { if (k < x.p) return x.v; k -= x.p; }
  return null;
}

// ---------------------------------------------------------------- TreeFeature
class Arbre {
  constructor(C, c) {
    this.C = C; this.c = c; this.h = C.sim.hasard;
    this.tronc = C.fournisseur(c.trunk_provider); this.feuillage = C.fournisseur(c.foliage_provider);
    this.sousTronc = C.fournisseur(c.below_trunk_provider ?? { type: 'minecraft:rule_based', rules: [] });
    this.tp = c.trunk_placer; this.tt = this.tp.type.replace(/^minecraft:/, '');
    this.fp = c.foliage_placer; this.ft = this.fp.type.replace(/^minecraft:/, '');
    const ms = c.minimum_size;
    this.taille = ms.type.endsWith('three_layers_feature_size')
      ? { trois: true, limit: ms.limit ?? 1, upperLimit: ms.upper_limit ?? 1, lower: ms.lower_size ?? 0, middle: ms.middle_size ?? 1, upper: ms.upper_size ?? 1, clip: ms.min_clipped_height ?? null }
      : { trois: false, limit: ms.limit ?? 1, lower: ms.lower_size ?? 0, upper: ms.upper_size ?? 1, clip: ms.min_clipped_height ?? null };
    this.ignoreLianes = !!c.ignore_vines;
    this.passeTronc = this.tt === 'upwards_branching_trunk_placer' ? C.d.etiquette(this.tp.can_grow_through) : null;
    this.racines = c.root_placer ?? null;
    this.ens = { racines: new Ensemble(), troncs: new Ensemble(), feuilles: new Ensemble(), deco: new Ensemble() };
  }
  ecrire(couche, p, e) { this.ens[couche].ajouter(p); this.C.ecrire(p, e, 19); }
  tailleA(hArbre, yo) { const s = this.taille; return s.trois ? (yo < s.limit ? s.lower : yo >= hArbre - s.upperLimit ? s.upper : s.middle) : (yo < s.limit ? s.lower : s.upper); }
  // TrunkPlacer.validTreePos / isFree
  valide(e) { return this.C.arbreValide(e) || (this.passeTronc && this.C.dans(e, this.passeTronc)); }
  libre(e) { return this.valide(e) || this.C.dans(e, this.C.t.bois); }

  placer(o) {
    const C = this.C, h = this.h;
    const ok = this.faire(o);
    const { troncs, feuilles, racines, deco } = this.ens;
    if (!ok || (!troncs.taille && !feuilles.taille)) return false;
    const deco_ = this.c.decorators || [];
    if (deco_.length) {
      const parY = (l) => l.slice().sort((a, b) => a[1] - b[1]);
      const L = { bois: parY(troncs.liste()), feuilles: parY(feuilles.liste()), racines: parY(racines.liste()) };
      for (const d of deco_) this.decorer(d, L);
    }
    // boite de l'arbre, distances des feuilles (TreeFeature.updateLeaves), puis formes aux faces exterieures (updateShapeAtEdge)
    const tous = [...racines.m.values(), ...troncs.m.values(), ...feuilles.m.values(), ...deco.m.values()];
    if (!tous.length) return false;
    const lo = [0, 1, 2].map((i) => Math.min(...tous.map((p) => p[i]))), hi = [0, 1, 2].map((i) => Math.max(...tous.map((p) => p[i])));
    const forme = this.majFeuilles(lo, hi);
    this.formesAuxBords(forme, lo, hi);
    void h; void C;
    return true;
  }

  faire(o) {
    const C = this.C, h = this.h, tp = this.tp;
    const hArbre = tp.base_height + h.entierBorne((tp.height_rand_a ?? 0) + 1) + h.entierBorne((tp.height_rand_b ?? 0) + 1);
    const hFeuil = this.hauteurFeuillage(hArbre);
    const rayonF = this.rayonFeuillage(hArbre - hFeuil);
    const oTronc = this.racines ? off(o, 0, C.entier(this.racines.trunk_offset_y, h), 0) : o;
    const minY = Math.min(o[1], oTronc[1]), maxY = Math.max(o[1], oTronc[1]) + hArbre + 1;
    if (minY < Y_MIN + 1 || maxY > Y_MAX) return false;   // world.max_y() = 319 : maxY > 319 + 1
    const coupe = this.hauteurLibre(hArbre, oTronc);
    if (coupe < hArbre && (this.taille.clip === null || coupe < this.taille.clip)) { this.raison = `pas la place (hauteur libre ${coupe} < ${hArbre})`; return false; }
    if (this.racines && !this.placerRacines(o, oTronc)) { this.raison = 'racines impossibles'; return false; }
    const attaches = this.placerTronc(coupe, oTronc);
    for (const a of attaches) this.creerFeuillage(a, hFeuil, rayonF);
    this.hauteur = hArbre;
    return true;
  }
  hauteurLibre(hMax, p) {
    for (let y = 0; y <= hMax + 1; y++) {
      const r = this.tailleA(hMax, y);
      for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
        const e = this.C.etat(off(p, x, y, z));
        if (!this.libre(e) || (!this.ignoreLianes && this.C.bloc(e) === this.C.b.vine)) return y - 2;
      }
    }
    return hMax;
  }

  // ---------------------------------------------------------------- racines de paletuvier (MangroveRootPlacer)
  peutRacine(p) { const e = this.C.etat(p); return this.C.arbreValide(e) || this.C.dans(e, this.C.d.etiquette(this.racines.mangrove_root_placement.can_grow_through)); }
  dansBoue(e) { const d = this.C.d; return e >= 0 && [].concat(this.racines.mangrove_root_placement.muddy_roots_in).some((b) => (b.startsWith('#') ? d.etiquette(b).has(d.blocDe(e)) : d.idBloc(b) === d.blocDe(e))); }
  poserRacine(p) {
    const C = this.C, h = this.h, R = this.racines, M = R.mangrove_root_placement;
    const ici = C.etat(p);
    const mouiller = (q, e) => (C.aProp(e, 'waterlogged') ? C.mouille(e, C.eauFluide(C.etat(q))) : e);
    if (this.dansBoue(ici)) { this.ecrire('racines', p, mouiller(p, C.etatFourniOuIci(C.fournisseur(M.muddy_roots_provider), p, h))); return; }
    if (!this.peutRacine(p)) return;
    this.ecrire('racines', p, mouiller(p, C.etatFourniOuIci(C.fournisseur(R.root_provider), p, h)));
    if (R.above_root_placement) {
      const q = off(p, 0, 1, 0);
      if (h.flottant() < R.above_root_placement.above_root_placement_chance && C.air(C.etat(q))) this.ecrire('racines', q, mouiller(q, C.etatFourniOuIci(C.fournisseur(R.above_root_placement.above_root_provider), q, h)));
    }
  }
  placerRacines(o, oTronc) {
    for (let c = o.slice(); c[1] < oTronc[1]; c = off(c, 0, 1, 0)) if (!this.peutRacine(c)) return false;
    const liste = [off(oTronc, 0, -1, 0)];
    for (const d of HORIZ) {
      const dep = rel(oTronc, d), pos = [];
      if (!this.simulerRacine(dep, d, oTronc, pos, 0)) return false;
      liste.push(...pos, dep);
    }
    for (const p of liste) this.poserRacine(p);
    return true;
  }
  simulerRacine(p, d, o, pos, couche) {
    const max = this.racines.mangrove_root_placement.max_root_length;
    if (couche === max || pos.length > max) return false;
    for (const q of this.potentielles(p, d, o)) if (this.peutRacine(q)) { pos.push(q); if (!this.simulerRacine(q, d, o, pos, couche + 1)) return false; }
    return true;
  }
  potentielles(p, d, o) {
    const h = this.h, M = this.racines.mangrove_root_placement, dessous = off(p, 0, -1, 0), cote = rel(p, d), l = manhattan(p, o), max = M.max_root_width, k = M.random_skew_chance;
    if (l > max - 3 && l <= max) return h.flottant() < k ? [dessous, off(cote, 0, -1, 0)] : [dessous];
    if (l > max) return [dessous];
    if (h.flottant() < k) return [dessous];
    return h.booleen() ? [cote] : [dessous];
  }

  // ---------------------------------------------------------------- troncs (TrunkPlacer)
  poserBuche(p, axe = null) {
    const C = this.C;
    if (!this.valide(C.etat(p))) return false;
    let e = C.etatFourniOuIci(this.tronc, p, this.h);
    if (axe) e = C.axe(e, axe);
    this.ecrire('troncs', p, e);
    return true;
  }
  poserBucheSiLibre(p) { if (this.libre(this.C.etat(p))) this.poserBuche(p); }
  sousLeTronc(p) { const e = this.C.etatFourni(this.sousTronc, p, this.h); if (e !== null) this.ecrire('troncs', p, e); }
  placerTronc(hArbre, o) {
    const h = this.h, C = this.C, tp = this.tp, A = (p, r = 0, double = false) => ({ p, r, double });
    const dessous = off(o, 0, -1, 0);
    switch (this.tt) {
      case 'straight_trunk_placer': {
        this.sousLeTronc(dessous);
        for (let y = 0; y < hArbre; y++) this.poserBuche(off(o, 0, y, 0));
        return [A(off(o, 0, hArbre, 0))];
      }
      case 'forking_trunk_placer': {
        this.sousLeTronc(dessous);
        const att = [], penche = HORIZ[h.entierBorne(4)], hPenche = hArbre - h.entierBorne(4) - 1;
        let pas = 3 - h.entierBorne(3), tx = o[0], tz = o[2], ey = null;
        for (let yo = 0; yo < hArbre; yo++) {
          const yy = o[1] + yo;
          if (yo >= hPenche && pas > 0) { tx += FACE_DX[penche]; tz += FACE_DZ[penche]; pas--; }
          if (this.poserBuche([tx, yy, tz])) ey = yy + 1;
        }
        if (ey !== null) att.push(A([tx, ey, tz], 1));
        tx = o[0]; tz = o[2];
        const branche = HORIZ[h.entierBorne(4)];
        if (branche !== penche) {
          const pos = hPenche - h.entierBorne(2) - 1;
          let n = 1 + h.entierBorne(3), ey2 = null;
          for (let yo = pos; yo < hArbre && n > 0; yo++, n--) {
            if (yo >= 1) { const yy = o[1] + yo; tx += FACE_DX[branche]; tz += FACE_DZ[branche]; if (this.poserBuche([tx, yy, tz])) ey2 = yy + 1; }
          }
          if (ey2 !== null) att.push(A([tx, ey2, tz], 0));
        }
        return att;
      }
      case 'giant_trunk_placer': return this.geant(hArbre, o);
      case 'mega_jungle_trunk_placer': {
        const att = this.geant(hArbre, o);
        let hb = hArbre - 2 - h.entierBorne(4);
        while (hb > Math.trunc(hArbre / 2)) {
          const angle = f32(h.flottant() * f32(Math.PI * 2));
          let bx = 0, bz = 0;
          for (let b = 0; b < 5; b++) {
            bx = Math.trunc(f32(1.5 + f32(cosMth(angle) * b)));
            bz = Math.trunc(f32(1.5 + f32(sinMth(angle) * b)));
            this.poserBuche(off(o, bx, hb - 3 + Math.trunc(b / 2), bz));
          }
          att.push(A(off(o, bx, hb, bz), -2));
          hb -= 2 + h.entierBorne(4);
        }
        return att;
      }
      case 'dark_oak_trunk_placer': {
        const att = [];
        this.sousLeTronc(dessous); this.sousLeTronc(off(dessous, 1, 0, 0)); this.sousLeTronc(off(dessous, 0, 0, 1)); this.sousLeTronc(off(dessous, 1, 0, 1));
        const penche = HORIZ[h.entierBorne(4)], hPenche = hArbre - h.entierBorne(4);
        let pas = 2 - h.entierBorne(3);
        const [x, y, z] = o; let tx = x, tz = z;
        const ey = y + hArbre - 1;
        for (let dy = 0; dy < hArbre; dy++) {
          if (dy >= hPenche && pas > 0) { tx += FACE_DX[penche]; tz += FACE_DZ[penche]; pas--; }
          const p = [tx, y + dy, tz], e = C.etat(p);
          if (C.air(e) || C.dans(e, C.t.feuilles)) { this.poserBuche(p); this.poserBuche(off(p, 1, 0, 0)); this.poserBuche(off(p, 0, 0, 1)); this.poserBuche(off(p, 1, 0, 1)); }
        }
        att.push(A([tx, ey, tz], 0, true));
        for (let ox = -1; ox <= 2; ox++) for (let oz = -1; oz <= 2; oz++) {
          if ((ox < 0 || ox > 1 || oz < 0 || oz > 1) && h.entierBorne(3) <= 0) {
            const l = h.entierBorne(3) + 2;
            for (let by = 0; by < l; by++) this.poserBuche([x + ox, ey - by - 1, z + oz]);
            att.push(A([x + ox, ey, z + oz], 0));
          }
        }
        return att;
      }
      case 'fancy_trunk_placer': return this.majestueux(hArbre, o);
      case 'bending_trunk_placer': {
        const dir = HORIZ[h.entierBorne(4)], hb = hArbre - 1, minF = tp.min_height_for_leaves ?? 1;
        let p = o.slice();
        this.sousLeTronc(dessous);
        const pts = [];
        for (let i = 0; i <= hb; i++) {
          if (i + 1 >= hb + h.entierBorne(2)) p = rel(p, dir);
          if (C.arbreValide(C.etat(p))) this.poserBuche(p);
          if (i >= minF) pts.push(A(p.slice()));
          p = off(p, 0, 1, 0);
        }
        const l = C.entier(tp.bend_length, h);
        for (let i = 0; i <= l; i++) {
          if (C.arbreValide(C.etat(p))) this.poserBuche(p);
          pts.push(A(p.slice()));
          p = rel(p, dir);
        }
        return pts;
      }
      case 'upwards_branching_trunk_placer': {
        const att = [];
        for (let hh = 0; hh < hArbre; hh++) {
          const cur = o[1] + hh, log = [o[0], cur, o[2]];
          if (this.poserBuche(log) && hh < hArbre - 1 && h.flottant() < tp.place_branch_per_log_probability) {
            const dir = HORIZ[h.entierBorne(4)];
            const l = C.entier(tp.extra_branch_length, h);
            const posB = Math.max(0, l - C.entier(tp.extra_branch_length, h) - 1);
            const pas = C.entier(tp.extra_branch_steps, h);
            this.brancheMontante(hArbre, att, log, cur, dir, posB, pas);
          }
          if (hh === hArbre - 1) att.push(A([o[0], cur + 1, o[2]]));
        }
        return att;
      }
      case 'cherry_trunk_placer': return this.cerisier(hArbre, o);
      case 'poplar_trunk_placer': {
        this.sousLeTronc(dessous);
        const jusque = hArbre - C.entier(tp.trunk_height_above_branches, h);
        for (let y = 0; y < hArbre; y++) {
          const log = off(o, 0, y, 0);
          this.poserBuche(log);
          const tous = melangerJeu([0, 1, 2, 3, 4, 5], h).filter((d) => d !== HAUT && d !== BAS);
          if (jusque - 1 === y) {
            const n = C.entier(tp.branch_amount, h);
            for (const d of tous.slice(0, Math.max(0, n))) this.poserBuche(rel(log, d), axeDe(d));
          }
        }
        return [A(off(o, 0, jusque, 0))];
      }
      default: throw new Error(`arbre : tronc "${this.tt}" non gere`);
    }
  }
  geant(hArbre, o) {
    const dessous = off(o, 0, -1, 0);
    this.sousLeTronc(dessous); this.sousLeTronc(off(dessous, 1, 0, 0)); this.sousLeTronc(off(dessous, 0, 0, 1)); this.sousLeTronc(off(dessous, 1, 0, 1));
    for (let hh = 0; hh < hArbre; hh++) {
      this.poserBucheSiLibre(off(o, 0, hh, 0));
      if (hh < hArbre - 1) { this.poserBucheSiLibre(off(o, 1, hh, 0)); this.poserBucheSiLibre(off(o, 1, hh, 1)); this.poserBucheSiLibre(off(o, 0, hh, 1)); }
    }
    return [{ p: off(o, 0, hArbre, 0), r: 0, double: true }];
  }
  brancheMontante(hArbre, att, log, cur, dir, posB, pas) {
    let hLong = cur + posB, lx = log[0], lz = log[2], i = posB;
    while (i < hArbre && pas > 0) {
      if (i >= 1) {
        const y = cur + i;
        lx += FACE_DX[dir]; lz += FACE_DZ[dir]; hLong = y;
        const l = [lx, y, lz];
        if (this.poserBuche(l)) hLong += 1;
        att.push({ p: l, r: 0, double: false });
      }
      i++; pas--;
    }
    if (hLong - cur > 1) { const f = [lx, hLong, lz]; att.push({ p: f, r: 0, double: false }); att.push({ p: off(f, 0, -2, 0), r: 0, double: false }); }
  }
  cerisier(hArbre, o) {
    const h = this.h, C = this.C, tp = this.tp, bs = tp.branch_start_offset_from_top;
    this.sousLeTronc(off(o, 0, -1, 0));
    const premier = Math.max(0, hArbre - 1 + h.entreInclus(bs.min_inclusive, bs.max_inclusive));
    let second = Math.max(0, hArbre - 1 + h.entreInclus(bs.min_inclusive, bs.max_inclusive - 1));
    if (second >= premier) second++;
    const n = C.entier(tp.branch_count, h), milieu = n === 3, deux = n >= 2;
    const hTronc = milieu ? hArbre : deux ? Math.max(premier, second) + 1 : premier + 1;
    for (let y = 0; y < hTronc; y++) this.poserBuche(off(o, 0, y, 0));
    const att = [];
    if (milieu) att.push({ p: off(o, 0, hTronc, 0), r: 0, double: false });
    const dir = HORIZ[h.entierBorne(4)], cote = axeDe(dir);
    const branche = (d, decal, continue_) => {
      let log = off(o, 0, decal, 0);
      const finY = hArbre - 1 + C.entier(tp.branch_end_offset_from_top, h);
      const etend = continue_ || finY < decal;
      const dist = C.entier(tp.branch_horizontal_length, h) + (etend ? 1 : 0);
      const fin = off(rel(o, d, dist), 0, finY, 0);
      for (let k = 0; k < (etend ? 2 : 1); k++) { log = rel(log, d); this.poserBuche(log, cote); }
      const vert = fin[1] > log[1] ? HAUT : BAS;
      for (;;) {
        const dm = manhattan(log, fin);
        if (dm === 0) return { p: off(fin, 0, 1, 0), r: 0, double: false };
        const chance = f32(Math.abs(fin[1] - log[1]) / dm);
        const v = h.flottant() < chance;
        log = rel(log, v ? vert : d);
        this.poserBuche(log, v ? null : cote);
      }
    };
    att.push(branche(dir, premier, premier < hTronc - 1));
    if (deux) att.push(branche(FACE_OPPOSEE[dir], second, second < hTronc - 1));
    return att;
  }
  majestueux(hArbre, o) {
    const h = this.h;
    const haut = hArbre + 2, hTronc = Math.floor(haut * 0.618);
    this.sousLeTronc(off(o, 0, -1, 0));
    const parY = Math.min(1, Math.floor(1.382 + Math.pow(haut / 13, 2)));
    const sommet = o[1] + hTronc;
    let ry = haut - 5;
    const coords = [[off(o, 0, ry, 0), sommet]];
    for (; ry >= 0; ry--) {
      const forme = formeArbre(haut, ry);
      if (forme < 0) continue;
      for (let k = 0; k < parY; k++) {
        const rayon = 1 * forme * (h.flottant() + 0.328);
        const angle = f32(h.flottant() * 2) * Math.PI;
        const x = rayon * Math.sin(angle) + 0.5, z = rayon * Math.cos(angle) + 0.5;
        const dep = off(o, Math.floor(x), ry - 1, Math.floor(z)), fin = off(dep, 0, 5, 0);
        if (this.membre(dep, fin, false)) {
          const dx = o[0] - dep[0], dz = o[2] - dep[2];
          const hb = dep[1] - Math.sqrt(dx * dx + dz * dz) * 0.381;
          const hautB = hb > sommet ? sommet : Math.trunc(hb);
          const base = [o[0], hautB, o[2]];
          if (this.membre(base, dep, false)) coords.push([dep, base[1]]);
        }
      }
    }
    this.membre(o, off(o, 0, hTronc, 0), true);
    const garde = (by) => by - o[1] >= haut * 0.2;
    for (const [fin, by] of coords) { const base = [o[0], by, o[2]]; if (cle(base) !== cle(fin) && garde(by)) this.membre(base, fin, true); }
    return coords.filter(([, by]) => garde(by)).map(([p]) => ({ p, r: 0, double: false }));
  }
  membre(a, b, poser) {
    if (!poser && cle(a) === cle(b)) return true;
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], n = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
    const pas = d.map((v) => f32(v / n));
    for (let i = 0; i <= n; i++) {
      const p = [0, 1, 2].map((k) => a[k] + Math.floor(f32(0.5 + f32(i * pas[k]))));
      if (poser) {
        const xd = Math.abs(p[0] - a[0]), zd = Math.abs(p[2] - a[2]), m = Math.max(xd, zd);
        this.poserBuche(p, m > 0 ? (xd === m ? 'x' : 'z') : 'y');
      } else if (!this.libre(this.C.etat(p))) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- feuillages (FoliagePlacer)
  hauteurFeuillage(hArbre) {
    const fp = this.fp, h = this.h, C = this.C;
    switch (this.ft) {
      case 'blob_foliage_placer': case 'fancy_foliage_placer': case 'bush_foliage_placer': case 'jungle_foliage_placer': return fp.height;
      case 'acacia_foliage_placer': return 0;
      case 'dark_oak_foliage_placer': return 4;
      case 'spruce_foliage_placer': return Math.max(4, hArbre - C.entier(fp.trunk_height, h));
      case 'pine_foliage_placer': return C.entier(fp.height, h);
      case 'mega_pine_foliage_placer': return C.entier(fp.crown_height, h);
      case 'random_spread_foliage_placer': return C.entier(fp.foliage_height, h);
      case 'cherry_foliage_placer': case 'poplar_foliage_placer': return C.entier(fp.height, h);
      default: throw new Error(`arbre : feuillage "${this.ft}" non gere`);
    }
  }
  rayonFeuillage(hTronc) {
    const r = this.C.entier(this.fp.radius, this.h);
    if (this.ft === 'pine_foliage_placer') return r + this.h.entierBorne(Math.max(hTronc + 1, 1));
    return r;
  }
  essaiFeuille(p) {                                          // FoliagePlacer.tryPlaceLeaf
    const C = this.C, ici = C.etat(p);
    if ((ici >= 0 && C.d.prop(ici, 'persistent') === 'true') || !C.arbreValide(ici)) return false;
    let e = C.etatFourniOuIci(this.feuillage, p, this.h);
    if (C.aProp(e, 'waterlogged')) e = C.mouille(e, C.eauSource(C.etat(p)));
    this.ecrire('feuilles', p, e);
    return true;
  }
  sauter(dx, y, dz, r, double) {                              // shouldSkipLocation (decalages deja positifs)
    const h = this.h, fp = this.fp;
    switch (this.ft) {
      case 'blob_foliage_placer': return dx === r && dz === r && (h.entierBorne(2) === 0 || y === 0);
      case 'bush_foliage_placer': return dx === r && dz === r && h.entierBorne(2) === 0;
      case 'fancy_foliage_placer': { const a = f32(dx + 0.5), b = f32(dz + 0.5); return f32(f32(a * a) + f32(b * b)) > r * r; }
      case 'acacia_foliage_placer': return y === 0 ? (dx > 1 || dz > 1) && dx !== 0 && dz !== 0 : dx === r && dz === r && r > 0;
      case 'spruce_foliage_placer': case 'pine_foliage_placer': return dx === r && dz === r && r > 0;
      case 'mega_pine_foliage_placer': case 'jungle_foliage_placer': return dx + dz >= 7 || dx * dx + dz * dz > r * r;
      case 'dark_oak_foliage_placer': return y === -1 && !double ? dx === r && dz === r : y === 1 ? dx + dz > r * 2 - 2 : false;
      case 'random_spread_foliage_placer': return false;
      case 'cherry_foliage_placer': {
        if (y === -1 && (dx === r || dz === r) && h.flottant() < fp.wide_bottom_layer_hole_chance) return true;
        const coin = dx === r && dz === r;
        return r > 2 ? coin || (dx + dz > r * 2 - 2 && h.flottant() < fp.corner_hole_chance) : coin && h.flottant() < fp.corner_hole_chance;
      }
      default: return false;
    }
  }
  sauterSigne(dx, y, dz, r, double) {
    if (this.ft === 'dark_oak_foliage_placer') {
      const differe = y !== 0 || !double || (dx !== -r && dx < r) || (dz !== -r && dz < r);
      if (!differe) return true;
    }
    const mx = double ? Math.min(Math.abs(dx), Math.abs(dx - 1)) : Math.abs(dx), mz = double ? Math.min(Math.abs(dz), Math.abs(dz - 1)) : Math.abs(dz);
    return this.sauter(mx, y, mz, r, double);
  }
  rangee(o, r, y, double) {
    const k = double ? 1 : 0;
    for (let dx = -r; dx <= r + k; dx++) for (let dz = -r; dz <= r + k; dz++) if (!this.sauterSigne(dx, y, dz, r, double)) this.essaiFeuille(off(o, dx, y, dz));
  }
  rangeePendante(o, r, y, double, chance, ext) {
    this.rangee(o, r, y, double);
    const k = double ? 1 : 0, log = off(o, 0, -1, 0);
    for (const le of HORIZ) {
      const bord = HORAIRE[le], pos0 = bord === EST || bord === SUD ? r + k : r;
      let p = rel(rel(off(o, 0, y - 1, 0), bord, pos0), le, -r);
      for (let a = -r; a < r + k; a++) {
        if (this.ens.feuilles.a(off(p, 0, 1, 0)) && this.extension(chance, log, p)) this.extension(ext, log, off(p, 0, -1, 0));
        p = rel(p, le);
      }
    }
  }
  extension(chance, log, p) { if (manhattan(p, log) >= 7) return false; if (this.h.flottant() > chance) return false; return this.essaiFeuille(p); }
  creerFeuillage(a, hFeuil, rayonF) {
    const h = this.h, C = this.C, fp = this.fp;
    const decal = C.entier(fp.offset, h), double = a.double, p = a.p, avecD = hFeuil;   // heightOffset = 0
    switch (this.ft) {
      case 'blob_foliage_placer': for (let yo = decal; yo >= decal - avecD; yo--) this.rangee(p, Math.max(0, rayonF + a.r - 1 - Math.trunc(yo / 2)), yo, double); break;
      case 'fancy_foliage_placer': for (let yo = decal; yo >= decal - hFeuil; yo--) this.rangee(p, rayonF + (yo !== decal && yo !== decal - hFeuil ? 1 : 0), yo, double); break;
      case 'bush_foliage_placer': for (let yo = decal; yo >= decal - avecD; yo--) this.rangee(p, rayonF + a.r - 1 - yo, yo, double); break;
      case 'acacia_foliage_placer': { const q = off(p, 0, decal, 0); this.rangee(q, rayonF + a.r, -1 - avecD, double); this.rangee(q, rayonF - 1, -avecD, double); this.rangee(q, rayonF + a.r - 1, 0, double); break; }
      case 'spruce_foliage_placer': {
        let r = h.entierBorne(2), mx = 1, mn = 0;
        for (let yo = decal; yo >= -avecD; yo--) { this.rangee(p, r, yo, double); if (r >= mx) { r = mn; mn = 1; mx = Math.min(mx + 1, rayonF + a.r); } else r++; }
        break;
      }
      case 'pine_foliage_placer': {
        let r = 0;
        for (let yo = decal; yo >= decal - avecD; yo--) { this.rangee(p, r, yo, double); if (r >= 1 && yo === decal - avecD + 1) r--; else if (r < rayonF + a.r) r++; }
        break;
      }
      case 'mega_pine_foliage_placer': {
        let prec = 0;
        for (let yy = p[1] - avecD + decal; yy <= p[1] + decal; yy++) {
          const yo = p[1] - yy, lisse = rayonF + a.r + Math.floor(f32(f32(yo / avecD) * 3.5));
          const dent = yo > 0 && lisse === prec && (yy & 1) === 0 ? lisse + 1 : lisse;
          this.rangee([p[0], yy, p[2]], dent, 0, double);
          prec = lisse;
        }
        break;
      }
      case 'jungle_foliage_placer': {
        const hF = double ? hFeuil : 1 + h.entierBorne(2);
        for (let yo = decal; yo >= decal - hF; yo--) this.rangee(p, rayonF + a.r + 1 - yo, yo, double);
        break;
      }
      case 'dark_oak_foliage_placer': {
        const q = off(p, 0, decal, 0);
        if (double) { this.rangee(q, rayonF + 2, -1, double); this.rangee(q, rayonF + 3, 0, double); this.rangee(q, rayonF + 2, 1, double); if (h.booleen()) this.rangee(q, rayonF, 2, double); } else { this.rangee(q, rayonF + 2, -1, double); this.rangee(q, rayonF + 1, 0, double); }
        break;
      }
      case 'random_spread_foliage_placer':
        for (let i = 0; i < fp.leaf_placement_attempts; i++) {
          const dx = h.entierBorne(rayonF) - h.entierBorne(rayonF), dy = h.entierBorne(hFeuil) - h.entierBorne(hFeuil), dz = h.entierBorne(rayonF) - h.entierBorne(rayonF);
          this.essaiFeuille(off(p, dx, dy, dz));
        }
        break;
      case 'cherry_foliage_placer': {
        const q = off(p, 0, decal, 0), r = rayonF + a.r - 1;
        this.rangee(q, r - 2, avecD - 3, double); this.rangee(q, r - 1, avecD - 4, double);
        for (let y = avecD - 5; y >= 0; y--) this.rangee(q, r, y, double);
        this.rangeePendante(q, r, -1, double, fp.hanging_leaves_chance, fp.hanging_leaves_extension_chance);
        this.rangeePendante(q, r - 1, -2, double, fp.hanging_leaves_chance, fp.hanging_leaves_extension_chance);
        break;
      }
      case 'poplar_foliage_placer': this.peuplier(p, decal, avecD, rayonF + a.r - 1, double); break;
      default: throw new Error(`arbre : feuillage "${this.ft}" non gere`);
    }
  }
  peuplier(p, decal, haut, r, double) {
    const h = this.h, C = this.C, trou = this.fp.side_hole_chance, inv = h.booleen(), k = double ? 1 : 0;
    const partielle = (y) => haut - 1 === y || haut - 2 === y;
    const coin = (dx, dz, r, part) => ((inv ? (dx > 0 && dz > 0) || (dz < 0 && dx < 0) : (dx > 0 && dz < 0) || (dz > 0 && dx < 0)) ? r - 1 : part ? r + 1 : r);
    const dedans = (r, ax, az, c, x) => ax + az <= r * 2 - (c + x);
    const rangee = (o, r, y) => {
      for (let dx = -r; dx <= r + k; dx++) for (let dz = -r; dz <= r + k; dz++) {
        const part = partielle(y), c = coin(dx, dz, r, part), ax = Math.abs(dx), az = Math.abs(dz);
        let saute;
        if (part && (ax === r || az === r)) saute = true; else saute = !dedans(r, ax, az, c, h.flottant() <= trou ? 1 : 0);
        if (!saute) this.essaiFeuille(off(o, dx, y, dz));
      }
    };
    const q = off(p, 0, decal, 0);
    rangee(q, r - 2, haut - 1); rangee(q, r - 1, haut - 2); rangee(q, r - 1, haut - 3);
    for (let y = haut - 4; y >= 1; y--) rangee(q, r, y);
    const y0 = haut - 4;
    for (let dx = -r; dx <= r + k; dx++) for (let dz = -r; dz <= r + k; dz++) {
      const ax = Math.abs(dx), az = Math.abs(dz), c = coin(dx, dz, r, partielle(y0));
      if (dedans(r, ax, az, c, 2) && ((az === 0 && r - ax >= 4) || (ax === 0 && r - az >= 4))) {
        const pos = off(q, dx, y0, dz), ici = C.etat(pos), f = C.etatFourniOuIci(this.feuillage, pos, h);
        if (ici === f) this.ecrire('feuilles', pos, C.axe(C.etatFourniOuIci(this.tronc, pos, h), az === 0 ? 'x' : 'z'));
      }
    }
    rangee(q, r - 1, 0); rangee(q, Math.min(2, Math.max(1, r - 2)), -1);
  }

  // ---------------------------------------------------------------- decorations (TreeDecorator)
  decorer(dc, L) {
    const C = this.C, h = this.h, t = dc.type.replace(/^minecraft:/, '');
    const air = (p) => C.air(C.etat(p));
    const poser = (p, e) => this.ecrire('deco', p, e);
    const liane = (p, face) => poser(p, C.d.avec(C.d.etatParDefaut(C.b.vine), face, 'true'));
    const COTES = [[OUEST, 'east'], [EST, 'west'], [NORD, 'south'], [SUD, 'north']];
    switch (t) {
      case 'trunk_vine':
        for (const p of L.bois) for (const [d, f] of COTES) if (h.entierBorne(3) > 0) { const q = rel(p, d); if (air(q)) liane(q, f); }
        break;
      case 'leave_vine':
        for (const p of L.feuilles) for (const [d, f] of COTES) if (h.flottant() < dc.probability) {
          const q = rel(p, d);
          if (air(q)) { liane(q, f); let b = off(q, 0, -1, 0), n = 4; while (air(b) && n > 0) { liane(b, f); b = off(b, 0, -1, 0); n--; } }
        }
        break;
      case 'cocoa': {
        if (h.flottant() >= dc.probability || !L.bois.length) break;
        const y0 = L.bois[0][1];
        for (const p of L.bois.filter((q) => q[1] - y0 <= 2)) for (const d of HORIZ) if (h.flottant() <= 0.25) {
          const q = rel(p, FACE_OPPOSEE[d]);
          if (air(q)) { const age = h.entierBorne(3); poser(q, C.d.etatId(`minecraft:cocoa[age=${age},facing=${NOMS_DIR[d]}]`)); }
        }
        break;
      }
      case 'beehive': this.ruche(L, dc.probability); break;
      case 'alter_ground': {
        const f = C.fournisseur(dc.provider), pos = this.plusBas(L);
        if (!pos.length) break;
        const minY = pos[0][1];
        for (const p of pos.filter((q) => q[1] === minY)) {
          for (const c of [[-1, -1], [2, -1], [-1, 2], [2, 2]]) this.cercle(f, off(p, c[0], 0, c[1]));
          for (let i = 0; i < 5; i++) { const k = h.entierBorne(64), xx = k % 8, zz = Math.trunc(k / 8); if (xx === 0 || xx === 7 || zz === 0 || zz === 7) this.cercle(f, off(p, -3 + xx, 0, -3 + zz)); }
        }
        break;
      }
      case 'attached_to_leaves': {
        const noir = new Set(), feuilles = melangerJeu(L.feuilles.slice(), h), dirs = dc.directions.map((n) => NOMS_DIR.indexOf(n)), f = C.fournisseur(dc.block_provider);
        for (const l of feuilles) {
          const d = dirs[h.entierBorne(dirs.length)], p = rel(l, d);
          if (noir.has(cle(p)) || h.flottant() >= dc.probability) continue;
          let vide = true;
          for (let i = 1; i <= dc.required_empty_blocks; i++) if (!air(rel(l, d, i))) { vide = false; break; }
          if (!vide) continue;
          for (let dx = -dc.exclusion_radius_xz; dx <= dc.exclusion_radius_xz; dx++) for (let dy = -dc.exclusion_radius_y; dy <= dc.exclusion_radius_y; dy++) for (let dz = -dc.exclusion_radius_xz; dz <= dc.exclusion_radius_xz; dz++) noir.add(cle(off(p, dx, dy, dz)));
          poser(p, C.etatFourniOuIci(f, p, h));
        }
        break;
      }
      case 'attached_to_logs': {
        const bois = melangerJeu(L.bois.slice(), h), dirs = dc.directions.map((n) => NOMS_DIR.indexOf(n)), f = C.fournisseur(dc.block_provider);
        for (const l of bois) { const d = dirs[h.entierBorne(dirs.length)], p = rel(l, d); if (h.flottant() <= dc.probability && air(p)) poser(p, C.etatFourniOuIci(f, p, h)); }
        break;
      }
      case 'creaking_heart': {
        if (!L.bois.length || h.flottant() >= dc.probability) break;
        for (const p of melangerJeu(L.bois.slice(), h)) {
          if ([0, 1, 2, 3, 4, 5].every((d) => C.dans(C.etat(rel(p, d)), C.t.bois))) { poser(p, C.d.etatId('minecraft:creaking_heart[creaking_heart_state=dormant,natural=true]')); break; }
        }
        break;
      }
      case 'pale_moss': {
        const bois = melangerJeu(L.bois.slice(), h);
        if (!bois.length) break;
        const o = bois.reduce((m, p) => (p[1] < m[1] ? p : m));
        // PaleMossDecorator : le tapis VegetationFeatures.PALE_MOSS_PATCH au-dessus de la buche la plus basse, avec le hasard de la decoration
        if (h.flottant() < dc.ground_probability) C.placerDef('pale_moss_patch', off(o, 0, 1, 0), 'pale_moss_patch', h);
        for (const [l, ch] of [[L.bois, dc.trunk_probability], [L.feuilles, dc.leaves_probability]]) for (const p of l) if (h.flottant() < ch) { const b = off(p, 0, -1, 0); if (air(b)) this.mousse(b); }
        break;
      }
      case 'place_on_ground': {
        const pos = this.plusBas(L);
        if (!pos.length) break;
        const o = pos[0], minY = o[1];
        let [x0, x1, z0, z1] = [o[0], o[0], o[2], o[2]];
        for (const p of pos.filter((q) => q[1] === minY)) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
        const R = dc.radius ?? 2, H = dc.height ?? 1, f = C.fournisseur(dc.block_state_provider);
        for (let i = 0; i < (dc.tries ?? 128); i++) {
          const p = [h.entreInclus(x0 - R, x1 + R), h.entreInclus(minY - H, minY + H), h.entreInclus(z0 - R, z1 + R)], dessus = off(p, 0, 1, 0), ed = C.etat(dessus);
          if (!(C.air(ed) || C.bloc(ed) === C.b.vine)) continue;
          const e = C.etat(p);
          if (!(e >= 0 && C.d.a(e, D.RENDU_PLEIN))) continue;
          if (this.surface(p[0], p[2]) <= dessus[1]) poser(dessus, C.etatFourniOuIci(f, dessus, h));
        }
        break;
      }
      case 'shelf_mushroom': this.champiEtagere(L, dc.probability); break;
      default: C.sim.avertir(`arbre : decoration "${t}" non geree`);
    }
  }
  plusBas(L) { if (!L.racines.length) return L.bois.slice(); if (L.bois.length && L.racines[0][1] === L.bois[0][1]) return [...L.bois, ...L.racines]; return L.racines.slice(); }
  // hauteur MOTION_BLOCKING_NO_LEAVES : premier bloc au-dessus qui bloque le mouvement (hors feuilles) ou contient un fluide, + 1
  surface(x, z) {
    const C = this.C, m = C.sim.monde;
    for (let y = m.y0 + m.sy - 1; y >= m.y0; y--) { const e = m.etatEn(x, y, z); if (e < 0) continue; if ((C.d.boites(e).length || C.d.fluide(e)) && !C.dans(e, C.t.feuilles)) return y + 1; }
    return m.y0;
  }
  cercle(f, c) {
    const C = this.C, h = this.h;
    for (let xx = -2; xx <= 2; xx++) for (let zz = -2; zz <= 2; zz++) {
      if (Math.abs(xx) === 2 && Math.abs(zz) === 2) continue;
      const col = off(c, xx, 0, zz);
      for (let dy = 2; dy >= -3; dy--) {
        const q = off(col, 0, dy, 0), e = C.etatFourni(f, q, h);
        if (e !== null) { this.ecrire('deco', q, e); break; }
        if (!C.air(C.etat(q)) && dy < 0) break;
      }
    }
  }
  mousse(p) {
    const C = this.C, h = this.h, mi = C.d.etatId('minecraft:pale_hanging_moss[tip=false]'), bout = C.d.etatId('minecraft:pale_hanging_moss[tip=true]');
    while (C.air(C.etat(off(p, 0, -1, 0))) && h.flottant() >= 0.5) { this.ecrire('deco', p, mi); p = off(p, 0, -1, 0); }
    this.ecrire('deco', p, bout);
  }
  ruche(L, prob) {
    const C = this.C, h = this.h;
    if (!L.bois.length) return;
    if (h.flottant() >= prob) return;
    const y = L.feuilles.length ? Math.max(L.feuilles[0][1] - 1, L.bois[0][1] + 1) : Math.min(L.bois[0][1] + 1 + h.entierBorne(3), L.bois[L.bois.length - 1][1]);
    const places = [];
    for (const p of L.bois.filter((q) => q[1] === y)) for (const d of [EST, SUD, OUEST]) places.push(rel(p, d));
    if (!places.length) return;
    melangerJeu(places, h);
    for (const p of places) {
      if (C.air(C.etat(p)) && C.air(C.etat(rel(p, SUD)))) {
        const nid = C.d.etatId('minecraft:bee_nest[facing=south,honey_level=0]');
        this.ecrire('deco', p, nid);
        if (C.etat(p) === nid) {
          const n = 2 + h.entierBorne(2), ticks = [];
          for (let i = 0; i < n; i++) ticks.push(h.entierBorne(599));
          this.abeilles(p, ticks);
        }
        break;
      }
    }
  }
  // BeehiveDecorator : 2 ou 3 abeilles dans le nid (Occupant.create : ticks_in_hive tire, 600 au moins) ; creatures nees si la scene a des acteurs
  abeilles(p, ticks) {
    const sim = this.C.sim;
    sim.dire(`nid d'abeilles en ${p.join(',')} : ${ticks.length} abeilles`);
    if (!sim.acteurs?.naitre || !sim.creatures) return;
    for (const t of ticks) {
      const a = sim.acteurs.naitre({ type: 'bee', x: p[0] + 0.5, y: p[1], z: p[2] + 0.5, lacet: 0, raison: 'nid', ia: { ruche: p.slice() } });
      if (a?.ia) a.ia.dansRuche = { pos: p.slice(), ticks: t, min: 600, nectar: false };
    }
  }
  champiEtagere(L, prob) {
    const C = this.C, h = this.h;
    if (h.flottant() >= prob || !L.bois.length) return;
    const premier = L.bois[0], dernier = L.bois[L.bois.length - 1];
    const remplacable = (p) => { const e = C.etat(p); if (!(e >= 0 && C.d.a(e, D.REMPLACABLE))) return false; return ![p, off(p, 1, 0, 0), off(p, -1, 0, 0), off(p, 0, 0, -1), off(p, 0, 0, 1)].some((q) => C.bloc(C.etat(q)) === C.b.water); };
    const voisinChampi = (p) => HORIZ.some((d) => C.bloc(C.etat(rel(p, d))) === C.b.shelf);
    const poser = (p, d) => { const age = h.entierBorne(2); this.ecrire('deco', p, C.d.etatId(`minecraft:shelf_mushroom[age=${age},facing=${NOMS_DIR[d]}]`)); };
    if (premier[1] === dernier[1]) {
      const faces = premier[0] !== dernier[0] ? [NORD, SUD] : [EST, OUEST];
      for (const l of L.bois) for (const f of faces) if (h.flottant() <= 0.25) { const p = rel(l, f); if (remplacable(p) && !voisinChampi(p) && !voisinChampi(l)) poser(p, f); }
    } else {
      const a = HORIZ[h.entierBorne(4)], faces = [a, HORAIRE[a]], base = premier[1];
      for (const l of L.bois) {
        const dy = l[1] - base;
        if (dy < 1 || dy > 4) continue;
        for (const f of faces) if (h.flottant() <= 0.25) { const p = rel(l, f); if (remplacable(p) && C.bloc(C.etat(off(p, 0, -1, 0))) !== C.b.shelf) { poser(p, f); break; } }
      }
    }
  }

  // TreeFeature.updateLeaves : distances des feuilles par seaux 0..6 (le jeu : HashSet par seau ; le resultat ne depend pas de l'ordre)
  majFeuilles(lo, hi) {
    const C = this.C, sx = hi[0] - lo[0] + 1, sy = hi[1] - lo[1] + 1, sz = hi[2] - lo[2] + 1;
    const plein = new Uint8Array(sx * sy * sz), ix = (p) => ((p[0] - lo[0]) * sy + (p[1] - lo[1])) * sz + (p[2] - lo[2]);
    const dedans = (p) => p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1] && p[2] >= lo[2] && p[2] <= hi[2];
    for (const p of [...this.ens.deco.m.values(), ...this.ens.racines.m.values()]) if (dedans(p)) plein[ix(p)] = 1;
    const seaux = Array.from({ length: 7 }, () => new Map());
    for (const p of this.ens.troncs.m.values()) seaux[0].set(cle(p), p);
    let s = 0;
    while (s < 7) {
      if (!seaux[s].size) { s++; continue; }
      const [k, p] = seaux[s].entries().next().value; seaux[s].delete(k);
      if (!dedans(p)) continue;
      if (s !== 0) { const e = C.etat(p); if (C.aProp(e, 'distance')) C.ecrire(p, C.d.avec(e, 'distance', String(s)), 19); }
      plein[ix(p)] = 1;
      const s0 = s;
      for (let d = 0; d < 6; d++) {
        const q = rel(p, d);
        if (!dedans(q) || plein[ix(q)]) continue;
        const dist = C.distanceFeuille(C.etat(q));
        if (dist === null) continue;
        const n = Math.min(dist, s0 + 1);
        if (n < 7) { seaux[n].set(cle(q), q); if (n < s) s = n; }
      }
    }
    return { plein, sx, sy, sz, ix };
  }
  // StructureTemplate.updateShapeAtEdge : chaque face de la forme pleine de l'arbre previent son voisin exterieur (et l'inverse)
  formesAuxBords(F, lo) {
    const sim = this.C.sim, { plein, sx, sy, sz } = F;
    const plein_ = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && plein[(x * sy + y) * sz + z] === 1;
    const face = (lx, ly, lz, d) => {
      const p = [lo[0] + lx, lo[1] + ly, lo[2] + lz], q = rel(p, d);
      sim.formeVoisinEn(d, p[0], p[1], p[2], q[0], q[1], q[2], 2, 512);
      sim.formeVoisinEn(FACE_OPPOSEE[d], q[0], q[1], q[2], p[0], p[1], p[2], 2, 512);
    };
    const passes = [[NORD, SUD, sx, sy, sz, (a, b, c) => [a, b, c]], [BAS, HAUT, sz, sx, sy, (a, b, c) => [b, c, a]], [OUEST, EST, sy, sz, sx, (a, b, c) => [c, a, b]]];
    for (const [neg, pos, na, nb, nc, map] of passes) for (let a = 0; a < na; a++) for (let b = 0; b < nb; b++) {
      let avant = false;
      for (let c = 0; c <= nc; c++) {
        const p = c < nc ? map(a, b, c) : null, ici = c !== nc && plein_(...p);
        if (!avant && ici) face(...p, neg); else if (avant && !ici) face(...map(a, b, c - 1), pos);
        avant = ici;
      }
    }
  }
}

// FancyTrunkPlacer.treeShape (flottants simples)
function formeArbre(haut, y) {
  if (f32(y) < f32(haut * f32(0.3))) return -1;
  const r = f32(haut / 2), adj = f32(r - y);
  let dist = f32(Math.sqrt(f32(f32(r * r) - f32(adj * adj))));
  if (adj === 0) dist = r; else if (Math.abs(adj) >= r) return 0;
  return f32(dist * 0.5);
}
