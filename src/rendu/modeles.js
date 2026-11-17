// Etats de blocs -> geometrie, a partir des vrais fichiers du jeu (blockstates + modeles).
// Directions (ordre du jeu) : 0 bas, 1 haut, 2 nord, 3 sud, 4 ouest, 5 est.
import fs from 'node:fs';
import path from 'node:path';
import { COUCHE_OPAQUE, COUCHE_DECOUPE, COUCHE_MELANGE } from './textures.js';

// axe de la normale par direction : 0 x, 1 y, 2 z
export const AXE_DIR = [1, 1, 2, 2, 0, 0];
export const NORMALES = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
const NOMS_DIR = ['down', 'up', 'north', 'south', 'west', 'east'];
const DIR_PAR_NOM = Object.fromEntries(NOMS_DIR.map((n, i) => [n, i]));

// Sommets d'une face, dans l'ordre du jeu (FaceInfo). Chaque entree : [x,y,z] avec 0=min 1=max.
const SOMMETS = [
  [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]], // bas
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], // haut
  [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]], // nord
  [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]], // sud
  [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]], // ouest
  [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]], // est
];

// UV par defaut d'une face (en 16emes) selon les bornes de l'element
function uvParDefaut(d, f, t) {
  switch (d) {
    case 0: return [f[0], 16 - t[2], t[0], 16 - f[2]];
    case 1: return [f[0], f[2], t[0], t[2]];
    case 2: return [16 - t[0], 16 - t[1], 16 - f[0], 16 - f[1]];
    case 3: return [f[0], 16 - t[1], t[0], 16 - f[1]];
    case 4: return [f[2], 16 - t[1], t[2], 16 - f[1]];
    default: return [16 - t[2], 16 - t[1], 16 - f[2], 16 - f[1]];
  }
}
// UV "verrouillees sur le monde" (uvlock) d'un point (x,y,z en 16emes) pour une direction finale
function uvMonde(d, p) {
  switch (d) {
    case 0: return [p[0], 16 - p[2]];
    case 1: return [p[0], p[2]];
    case 2: return [16 - p[0], 16 - p[1]];
    case 3: return [p[0], 16 - p[1]];
    case 4: return [p[2], 16 - p[1]];
    default: return [16 - p[2], 16 - p[1]];
  }
}

const rad = (deg) => (deg * Math.PI) / 180;
function tourner(p, axe, angle) { // rotation droite autour d'un axe, sur place (p = [x,y,z])
  const c = Math.cos(angle), s = Math.sin(angle);
  const [x, y, z] = p;
  if (axe === 'x') { p[1] = y * c - z * s; p[2] = y * s + z * c; }
  else if (axe === 'y') { p[0] = x * c + z * s; p[2] = -x * s + z * c; }
  else { p[0] = x * c - y * s; p[1] = x * s + y * c; }
}
// Rotation du blockstate : x puis y, sens du jeu (y=90 : est -> sud ; x=90 : haut -> nord)
function tournerBloc(p, rx, ry) {
  p[0] -= 8; p[1] -= 8; p[2] -= 8;
  if (rx) tourner(p, 'x', -rad(rx));
  if (ry) tourner(p, 'y', -rad(ry));
  p[0] += 8; p[1] += 8; p[2] += 8;
}
function tournerDir(d, rx, ry) {
  const n = NORMALES[d].slice();
  if (rx) tourner(n, 'x', -rad(rx));
  if (ry) tourner(n, 'y', -rad(ry));
  return dirDe(n);
}
// direction la plus proche d'un vecteur
function dirDe(n) {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return n[1] >= 0 ? 1 : 0;
  if (az >= ax) return n[2] >= 0 ? 3 : 2;
  return n[0] >= 0 ? 5 : 4;
}

// Parse "ns:nom[a=b,c=d]" -> { nom, props }
export function analyserEtat(s) {
  const i = s.indexOf('[');
  const nomComplet = i < 0 ? s : s.slice(0, i);
  const props = {};
  if (i >= 0) for (const kv of s.slice(i + 1, -1).split(',')) { const e = kv.indexOf('='); if (e > 0) props[kv.slice(0, e)] = kv.slice(e + 1); }
  return { nom: nomComplet.replace(/^minecraft:/, ''), props };
}

// Blocs dessines par le jeu avec du code (pas de JSON) : boite simple de remplacement.
const BOITES_SPECIALES = [
  [/(^|_)chest$|shulker_box$|decorated_pot$|^conduit$|^ender_chest$/, [1, 0, 1, 15, 14, 15]],
  [/_bed$/, [0, 3, 0, 16, 9, 16]],
];

function melangeHash(h) { h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return (h ^ (h >>> 16)) >>> 0; }
export { melangeHash };

export class BibliothequeModeles {
  constructor(kitDir, textures) {
    this.dir = path.join(kitDir, 'assets', 'minecraft');
    this.tex = textures;
    this.blockstates = new Map();
    this.modeles = new Map();
    this.cacheQuads = new Map();
    this.etats = new Map();
    // blocs sans fichier ou sans texture : pour le rapport (--stats)
    this.manquants = new Map(); // etat -> raison
    this.speciaux = new Map(); // blocs dessines par code dans le jeu (coffres...) : approximation
  }

  // Nom de la texture de particule ('block/dirt') d'un etat de bloc ('minecraft:dirt', 'oak_stairs[facing=north]') : celle des particules de casse. null si inconnue.
  texParticule(chaine) {
    const { nom, props } = analyserEtat(chaine);
    const emp = this._emplacements(nom, props);
    const v = emp && emp[0] && emp[0][0];
    const m = v && v.model ? this.modele(v.model) : null;
    if (!m || m.introuvable) return null;
    return this._resoudreTexture(m, '#particle') || null;
  }

  _json(rel) {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, ...rel.split('/')), 'utf8')); } catch { return null; }
  }
  _blockstate(nom) {
    if (!this.blockstates.has(nom)) this.blockstates.set(nom, this._json(`blockstates/${nom}.json`));
    return this.blockstates.get(nom);
  }

  // Modele fusionne avec ses parents : { textures, elements, ao, special }
  modele(id) {
    id = id.replace(/^minecraft:/, '');
    if (this.modeles.has(id)) return this.modeles.get(id);
    const chaine = [];
    let cur = id, special = null;
    for (let i = 0; i < 16 && cur; i++) {
      if (cur.startsWith('builtin/')) { special = cur; break; }
      const j = this._json(`models/${cur}.json`);
      if (!j) { chaine.push(null); break; }
      chaine.push(j);
      cur = j.parent ? j.parent.replace(/^minecraft:/, '') : null;
    }
    const m = { textures: {}, elements: null, ao: true, special, introuvable: chaine.includes(null) };
    for (let i = chaine.length - 1; i >= 0; i--) {
      const j = chaine[i]; if (!j) continue;
      Object.assign(m.textures, j.textures || {});
      if (j.elements) m.elements = j.elements;
      if (j.ambientocclusion !== undefined) m.ao = !!j.ambientocclusion;
    }
    this.modeles.set(id, m);
    return m;
  }

  // Retourne le nom de la texture ; `force` si l'entree est { sprite, force_translucent: true } (format 26.x).
  _resoudreTexture(m, v, info) {
    for (let i = 0; i < 16 && typeof v === 'string' && v.startsWith('#'); i++) v = m.textures[v.slice(1)];
    if (v && typeof v === 'object') { if (info && v.force_translucent) info.force = true; v = v.sprite; }
    return typeof v === 'string' && !v.startsWith('#') ? v.replace(/^minecraft:/, '') : null;
  }

  // Quads d'un modele, tourne par (rx, ry), avec uvlock eventuel. Mis en cache.
  quadsModele(id, rx, ry, uvlock) {
    const cle = `${id}|${rx}|${ry}|${uvlock ? 1 : 0}`;
    let q = this.cacheQuads.get(cle);
    if (q) return q;
    q = [];
    const m = this.modele(id);
    if (m.elements) {
      for (const el of m.elements) this._element(m, el, rx, ry, uvlock, q);
    }
    q.special = m.special; q.introuvable = m.introuvable; q.vide = !m.elements;
    this.cacheQuads.set(cle, q);
    return q;
  }

  _element(m, el, rx, ry, uvlock, sortie) {
    const f = el.from, t = el.to;
    const emission = (el.light_emission || 0) > 0;
    const override = el.shade_direction_override ? DIR_PAR_NOM[el.shade_direction_override] : undefined;
    for (const nomDir of Object.keys(el.faces || {})) {
      const d = DIR_PAR_NOM[nomDir];
      if (d === undefined) continue;
      const face = el.faces[nomDir];
      const infoTex = {};
      const texNom = this._resoudreTexture(m, face.texture, infoTex);
      const sprite = this.tex.sprite(texNom || 'block/missing_texture_introuvable');
      const uv = face.uv || uvParDefaut(d, f, t);
      const rotUV = (((face.rotation || 0) / 90) | 0) & 3;
      const pos = [], uvs = [];
      for (let k = 0; k < 4; k++) {
        const s = SOMMETS[d][k];
        const p = [s[0] ? t[0] : f[0], s[1] ? t[1] : f[1], s[2] ? t[2] : f[2]];
        pos.push(p);
        const i = (k + rotUV) & 3;
        uvs.push([uv[i !== 0 && i !== 1 ? 2 : 0], uv[i !== 0 && i !== 3 ? 3 : 1]]);
      }
      // rotation de l'element
      const r = el.rotation;
      if (r) {
        const o = r.origin || [8, 8, 8];
        const axes = r.axis ? [[r.axis, r.angle || 0]] : [['x', r.x || 0], ['y', r.y || 0], ['z', r.z || 0]];
        for (const p of pos) {
          p[0] -= o[0]; p[1] -= o[1]; p[2] -= o[2];
          for (const [ax, an] of axes) if (an) tourner(p, ax, rad(an));
          if (r.rescale && r.axis && r.angle) {
            const k = 1 / Math.cos(rad(r.angle));
            if (r.axis !== 'x') p[0] *= k; if (r.axis !== 'y') p[1] *= k; if (r.axis !== 'z') p[2] *= k;
          }
          p[0] += o[0]; p[1] += o[1]; p[2] += o[2];
        }
      }
      // direction de la normale APRES rotation de l'element (pour l'ombrage)
      let dirOmbre = d;
      if (r) {
        const a = pos[0], b = pos[1], c = pos[2];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
        dirOmbre = dirDe([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
        // le produit vectoriel donne la normale vers l'interieur ou l'exterieur selon l'ordre ; on corrige avec la normale d'origine
        const nd = NORMALES[d];
        const n2 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        if (n2[0] * nd[0] + n2[1] * nd[1] + n2[2] * nd[2] < 0) dirOmbre = dirDe([-n2[0], -n2[1], -n2[2]]);
      }
      // rotation du bloc
      let dFinale = dirOmbre, cull = face.cullface !== undefined ? DIR_PAR_NOM[face.cullface] : -1;
      if (rx || ry) {
        for (const p of pos) tournerBloc(p, rx, ry);
        dFinale = tournerDir(dirOmbre, rx, ry);
        if (cull >= 0) cull = tournerDir(cull, rx, ry);
      }
      if (uvlock && (rx || ry)) {
        // texture fixee sur le monde : l'UV vient de la position finale des sommets
        const dd = r ? dFinale : tournerDir(d, rx, ry);
        for (let k = 0; k < 4; k++) uvs[k] = uvMonde(dd, pos[k]);
      }
      const dOmbre = override !== undefined ? override : dFinale;
      sortie.push({
        p: pos.map((p) => [p[0] / 16, p[1] / 16, p[2] / 16]),
        uv: uvs.map((x) => [x[0] / 16, x[1] / 16]),
        sprite, cull, tint: face.tintindex ?? -1, dirOmbre: dOmbre, dirFace: dFinale,
        ao: m.ao, emission, couche: infoTex.force ? COUCHE_MELANGE : sprite.couche,
      });
    }
  }

  // Quand l'etat est choisi par le hasard (variantes pondérees) : retourne l'indice
  _choisir(liste, hash) {
    if (!Array.isArray(liste)) return liste;
    if (liste.length === 1) return liste[0];
    let total = 0;
    for (const v of liste) total += v.weight || 1;
    let r = hash % total;
    for (const v of liste) { r -= v.weight || 1; if (r < 0) return v; }
    return liste[0];
  }

  _correspond(cond, props) {
    if (!cond) return true;
    if (cond.OR) return cond.OR.some((c) => this._correspond(c, props));
    if (cond.AND) return cond.AND.every((c) => this._correspond(c, props));
    for (const [k, v] of Object.entries(cond)) {
      const voulu = String(v).split('|');
      const neg = voulu.length === 1 && voulu[0].startsWith('!');
      const val = props[k];
      if (neg ? val === voulu[0].slice(1) : !voulu.includes(val)) return false;
    }
    return true;
  }

  // Liste des "emplacements" de l'etat : chaque emplacement = liste de variantes ponderees.
  _emplacements(nom, props) {
    const bs = this._blockstate(nom);
    if (!bs) return null;
    const out = [];
    if (bs.variants) {
      let trouve = null;
      for (const [cle, v] of Object.entries(bs.variants)) {
        if (cle === '' || cle === 'normal') { trouve = v; break; }
        const ok = cle.split(',').every((kv) => { const e = kv.indexOf('='); return props[kv.slice(0, e)] === kv.slice(e + 1); });
        if (ok) { trouve = v; break; }
      }
      if (!trouve) return null;
      out.push(Array.isArray(trouve) ? trouve : [trouve]);
    } else if (bs.multipart) {
      for (const part of bs.multipart) if (this._correspond(part.when, props)) out.push(Array.isArray(part.apply) ? part.apply : [part.apply]);
    }
    return out;
  }

  // Description d'un etat (texte) : drapeaux + geometrie. `hash` choisit les variantes aleatoires.
  etat(chaine) {
    let e = this.etats.get(chaine);
    if (e) return e;
    e = this._construireEtat(chaine);
    this.etats.set(chaine, e);
    return e;
  }

  geometrie(etat, hash) {
    if (!etat.aleatoire) return etat.geo;
    const choix = etat.emplacements.map((l, i) => {
      if (l.length === 1) return 0;
      let total = 0; for (const v of l) total += v.weight || 1;
      let r = melangeHash(hash + i * 977) % total;
      for (let k = 0; k < l.length; k++) { r -= l[k].weight || 1; if (r < 0) return k; }
      return 0;
    });
    const cle = choix.join(',');
    let g = etat.geoParChoix.get(cle);
    if (!g) { g = this._geoDe(etat.emplacements, choix); etat.geoParChoix.set(cle, g); }
    return g;
  }

  _geoDe(emplacements, choix) {
    const quads = [];
    for (let i = 0; i < emplacements.length; i++) {
      const v = emplacements[i][choix[i]];
      if (!v || !v.model) continue;
      quads.push(...this.quadsModele(v.model, v.x || 0, v.y || 0, !!v.uvlock));
    }
    return quads;
  }

  _construireEtat(chaine) {
    const { nom, props } = analyserEtat(chaine);
    const e = {
      chaine, nom, props, geo: [], aleatoire: false, emplacements: [], geoParChoix: new Map(),
      type: 0, // 0 rien, 1 modele, 2 eau, 3 lave
      opaque: false, aoSolide: false, permeable: true, opaciteLumiere: 0, feuilles: false, emission: false, memeCulling: false,
      eau: false, // contient de l'eau (waterlogged, herbes marines...)
    };
    if (nom === 'air' || nom === 'cave_air' || nom === 'void_air') return e;
    if (nom === 'water') { e.type = 2; e.eau = true; e.opaciteLumiere = 1; return e; }
    if (nom === 'lava') { e.type = 3; e.emission = true; return e; }
    if (props.waterlogged === 'true' || /^(seagrass|tall_seagrass|kelp|kelp_plant|bubble_column)$/.test(nom)) { e.eau = true; e.opaciteLumiere = 1; }
    const emp = this._emplacements(nom, props);
    if (!emp) {
      this.manquants.set(chaine, this._blockstate(nom) ? 'aucune variante ne correspond' : 'blockstate absent');
      return e;
    }
    e.emplacements = emp;
    e.aleatoire = emp.some((l) => l.length > 1);
    e.geo = this._geoDe(emp, emp.map(() => 0));
    e.type = 1;
    // modeles sans elements (coffres, lits, panneaux...)
    if (e.geo.length === 0 && emp.length) {
      const v = emp[0][0];
      const m = v && v.model ? this.modele(v.model) : null;
      if (!m || m.introuvable) this.manquants.set(chaine, 'modele absent : ' + (v && v.model));
      else if (!m.elements) {
        const boite = BOITES_SPECIALES.find(([re]) => re.test(nom));
        const part = this._resoudreTexture(m, '#particle');
        this.speciaux.set(chaine, boite ? 'boite de remplacement' : 'non dessine (dessine par code dans le jeu)');
        if (boite && part && !(this.coffresDynamiques && /(^|_)chest$/.test(nom))) e.geo = this._boite(boite[1], part, v.y || 0);   // coffres : dessines par film/effets-monde.js (couvercle anime) dans une scene avec monde
        else e.type = 0;
      }
    }
    for (const q of e.geo) if (q.sprite.manquante) this.manquants.set(chaine, 'texture absente : ' + q.sprite.nom);
    this._drapeaux(e);
    return e;
  }

  _boite(b, tex, ry) {
    const sprite = this.tex.sprite(tex);
    const m = { textures: { t: tex }, ao: true };
    const q = [];
    const el = { from: [b[0], b[1], b[2]], to: [b[3], b[4], b[5]], faces: Object.fromEntries(NOMS_DIR.map((n) => [n, { texture: '#t' }])) };
    void sprite;
    this._element(m, el, 0, ry, false, q);
    return q;
  }

  _drapeaux(e) {
    const { nom } = e;
    // cube plein opaque : un element 0..16 avec les 6 faces en couche opaque
    // detection simple sur les quads : 6 faces alignees sur les bords, couvrant tout le bloc
    const couverts = new Array(6).fill(false), solides = new Array(6).fill(false);
    for (const q of e.geo) {
      const d = q.dirFace;
      let mn = [1, 1, 1], mx = [0, 0, 0];
      for (const p of q.p) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[a]); mx[a] = Math.max(mx[a], p[a]); }
      const ax = AXE_DIR[d];
      const plan = NORMALES[d][ax] > 0 ? 1 : 0;
      if (Math.abs(mn[ax] - plan) > 1e-4 || Math.abs(mx[ax] - plan) > 1e-4) continue;
      let ok = true;
      for (let a = 0; a < 3; a++) if (a !== ax && (mn[a] > 1e-4 || mx[a] < 1 - 1e-4)) ok = false;
      if (!ok) continue;
      couverts[d] = true;
      if (q.couche === COUCHE_OPAQUE) solides[d] = true;
    }
    const cube = couverts.every(Boolean);
    e.opaque = cube && solides.every(Boolean);
    e.feuilles = /_leaves$/.test(nom);
    const verre = /glass|^ice$|slime_block|honey_block|frosted_ice/.test(nom);
    e.aoSolide = cube && !verre && !/^(light|barrier|structure_void)$/.test(nom);
    // graphismes "fancy" du jeu : les feuilles montrent leurs faces interieures (on voit les feuilles derriere les trous) ;
    // seules les surfaces translucides identiques (verre, glace, miel, slime) s'effacent entre elles
    e.memeCulling = verre;
    e.permeable = !e.opaque;
    if (e.opaque) e.opaciteLumiere = 15;
    else if (e.feuilles || /^(ice|frosted_ice|cobweb|honey_block|slime_block)$/.test(nom)) e.opaciteLumiere = Math.max(e.opaciteLumiere, 1);
    e.emission = e.geo.some((q) => q.emission) || (EMISSIFS.test(nom) && e.props.lit !== 'false');
  }
}

const EMISSIFS = /^(glowstone|sea_lantern|shroomlight|magma_block|jack_o_lantern|lantern|soul_lantern|torch|wall_torch|soul_torch|soul_wall_torch|redstone_torch|redstone_wall_torch|lava|fire|soul_fire|beacon|end_rod|ochre_froglight|verdant_froglight|pearlescent_froglight|crying_obsidian|respawn_anchor|redstone_lamp|furnace|blast_furnace|smoker|campfire|soul_campfire|conduit|end_portal|nether_portal)$/;
