// Icone d'un objet du jeu, comme dans l'inventaire : image 2D de l'objet (textures/item/) ou, pour un bloc, son rendu "inventaire"
// (cube vu de 3/4 : la transformation `display.gui` du modele, par defaut rotation [30, 225, 0] et echelle 0,625).
// Lit le KIT (groupes `objets` pour items/ et models/item/, et `models` + `textures` pour les blocs). Retourne { w, h, px } ou null.
import fs from 'node:fs';
import path from 'node:path';
import { resoudreObjet } from '../objets/definition.js';
import { texture, teinter, lireJson } from '../objets/fichiers.js';
import { couleurTeinte } from '../objets/definition.js';
import { creerImage } from './toile.js';

const net = (s) => String(s).replace(/^minecraft:/, '');
const cache = new Map();
const TAILLE_BLOC = 64;   // pixels du rendu isometrique (reduit ou agrandi ensuite)

// Modele fusionne : chaine des parents (textures du fils prioritaires, elements du premier modele qui en a, display.gui).
function fusionModele(kit, id) {
  let cur = net(id), textures = {}, elements = null, gui = null, generated = false;
  for (let i = 0; i < 16 && cur; i++) {
    if (cur === 'builtin/generated' || cur === 'item/generated' || cur === 'item/handheld' || cur === 'item/handheld_rod' || cur === 'item/handheld_mace') generated = true;
    if (/^builtin\//.test(cur)) break;
    const j = lireJson(kit, `models/${cur}.json`);
    if (!j) break;
    textures = { ...(j.textures ?? {}), ...textures };
    if (!elements && Array.isArray(j.elements)) elements = j.elements;
    if (!gui && j.display?.gui) gui = j.display.gui;
    cur = j.parent ? net(j.parent) : null;
  }
  const resoudre = (v) => { let n = 0; while (typeof v === 'string' && v.startsWith('#') && n++ < 8) v = textures[v.slice(1)]; return typeof v === 'string' ? net(v) : null; };
  return { textures, elements, gui, generated, resoudre };
}

// Image plate : calque(s) layer0..layerN de l'objet, teintes par defaut appliquees.
function imagePlate(kit, m, teintes) {
  const calques = [];
  for (let k = 0; k < 6; k++) { const n = m.resoudre(m.textures['layer' + k]); if (!n) break; calques.push(n); }
  if (!calques.length) return null;
  let sortie = null;
  calques.forEach((n, k) => {
    let t = texture(kit, n); if (!t) return;
    t = teinter(t, teintes?.[k] ?? null);
    if (!sortie) sortie = creerImage(t.largeur, t.hauteur);
    if (t.largeur !== sortie.w || t.hauteur !== sortie.h) return;
    for (let i = 0; i < t.rgba.length; i += 4) { const a = t.rgba[i + 3]; if (!a) continue; sortie.px[i] = t.rgba[i]; sortie.px[i + 1] = t.rgba[i + 1]; sortie.px[i + 2] = t.rgba[i + 2]; sortie.px[i + 3] = a; }
  });
  return sortie;
}

// Teinte de biome "moyenne" quand l'objet n'en donne pas (herbe, feuilles) : le jeu les prend dans la table de couleurs du biome.
const teinteParDefaut = (nom) => (/grass|fern|sugar_cane|lily/.test(nom) ? 0xFF91BD59 : /leaves|vine/.test(nom) ? 0xFF59AE30 : null);

// ---------------------------------------------------------------- bloc en perspective "inventaire"
const DIRS = {
  up: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], ombre: 1.0 },
  down: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1], ombre: 0.5 },
  north: { n: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0], ombre: 0.8 },
  south: { n: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0], ombre: 0.8 },
  west: { n: [-1, 0, 0], u: [0, 0, 1], v: [0, -1, 0], ombre: 0.6 },
  east: { n: [1, 0, 0], u: [0, 0, -1], v: [0, -1, 0], ombre: 0.6 },
};
const FACES_PAR_DEFAUT = { up: (f, t) => [f[0], f[2], t[0], t[2]], down: (f, t) => [f[0], 16 - t[2], t[0], 16 - f[2]], north: (f, t) => [16 - t[0], 16 - t[1], 16 - f[0], 16 - f[1]], south: (f, t) => [f[0], 16 - t[1], t[0], 16 - f[1]], west: (f, t) => [f[2], 16 - t[1], t[2], 16 - f[1]], east: (f, t) => [16 - t[2], 16 - t[1], 16 - f[2], 16 - f[1]] };

const RAD = Math.PI / 180;
function rot(v, [rx, ry, rz]) {   // rotation X, puis Y, puis Z (degres)
  let [x, y, z] = v;
  let c = Math.cos(rx * RAD), s = Math.sin(rx * RAD); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry * RAD); s = Math.sin(ry * RAD); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz * RAD); s = Math.sin(rz * RAD); [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

function imageBloc(kit, m, teintes) {
  const gui = m.gui ?? { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] };
  const rotation = gui.rotation ?? [30, 225, 0], sc = gui.scale ?? [0.625, 0.625, 0.625], tr = gui.translation ?? [0, 0, 0];
  const faces = [];
  for (const el of m.elements) {
    if (!Array.isArray(el.from) || !Array.isArray(el.to)) continue;
    for (const [nom, f] of Object.entries(el.faces ?? {})) {
      const d = DIRS[nom]; if (!d) continue;
      const tex = m.resoudre(f.texture); const t = tex ? texture(kit, tex) : null;
      if (!t) continue;
      const uv = f.uv ?? FACES_PAR_DEFAUT[nom](el.from, el.to);
      // coins de la face dans le repere du modele (0..16) : centre (u0,v0), axes u et v
      const o = [(nom === 'east' ? el.to[0] : nom === 'west' ? el.from[0] : 0), (nom === 'up' ? el.to[1] : nom === 'down' ? el.from[1] : 0), (nom === 'south' ? el.to[2] : nom === 'north' ? el.from[2] : 0)];
      // etendue de la face sur ses deux axes : u sur l'axe de d.u, v sur l'axe de d.v
      const etendue = (axe, signe) => { const k = axe.findIndex((c) => c !== 0); return { k, de: signe > 0 ? el.from[k] : el.to[k], vers: signe > 0 ? el.to[k] : el.from[k] }; };
      const au = d.u, av = d.v, ku = au.findIndex((c) => c !== 0), kv = av.findIndex((c) => c !== 0);
      const eu = etendue(au, au[ku]), ev = etendue(av, av[kv]);
      const pt = (su, sv) => { const p = [o[0], o[1], o[2]]; p[ku] = su; p[kv] = sv; return p; };
      let coins = [pt(eu.de, ev.de), pt(eu.vers, ev.de), pt(eu.vers, ev.vers), pt(eu.de, ev.vers)];   // (u0,v0) (u1,v0) (u1,v1) (u0,v1)
      let uvs = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
      const r = ((f.rotation ?? 0) / 90 | 0) & 3; for (let q = 0; q < r; q++) uvs = [uvs[3], uvs[0], uvs[1], uvs[2]];
      if (el.rotation && Number.isFinite(el.rotation.angle)) {
        const ax = el.rotation.axis, a = el.rotation.angle, og = el.rotation.origin ?? [8, 8, 8];
        coins = coins.map((p) => { const q = [p[0] - og[0], p[1] - og[1], p[2] - og[2]]; const e = [ax === 'x' ? a : 0, ax === 'y' ? a : 0, ax === 'z' ? a : 0]; const rr = rot(q, e); return [rr[0] + og[0], rr[1] + og[1], rr[2] + og[2]]; });
      }
      const centres = coins.map((p) => { const q = [(p[0] - 8) / 16 * sc[0] + tr[0] / 16, (p[1] - 8) / 16 * sc[1] + tr[1] / 16, (p[2] - 8) / 16 * sc[2] + tr[2] / 16]; return rot(q, rotation); });
      const nrm = rot(d.n, rotation);
      if (nrm[2] <= 0.001) continue;   // face tournee vers l'arriere
      const prof = centres.reduce((a, c) => a + c[2], 0) / 4;
      const tint = f.tintindex !== undefined && f.tintindex >= 0 ? teintes?.[f.tintindex] ?? teintes?.[0] ?? teinteParDefaut(tex) : null;
      faces.push({ centres, uvs, t: teinter(t, tint), ombre: d.ombre, prof });
    }
  }
  faces.sort((a, b) => a.prof - b.prof);
  const N = TAILLE_BLOC, img = creerImage(N, N);
  const px = (p) => [N / 2 + p[0] * N * 0.98, N / 2 - p[1] * N * 0.98];   // x droite, y haut
  for (const f of faces) {
    const P = f.centres.map(px);
    // face = parallelogramme : P0 + s (P1 - P0) + t (P3 - P0)
    const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1]], e2 = [P[3][0] - P[0][0], P[3][1] - P[0][1]];
    const det = e1[0] * e2[1] - e1[1] * e2[0]; if (Math.abs(det) < 1e-9) continue;
    const xa = Math.max(0, Math.floor(Math.min(...P.map((p) => p[0])))), xb = Math.min(N - 1, Math.ceil(Math.max(...P.map((p) => p[0]))));
    const ya = Math.max(0, Math.floor(Math.min(...P.map((p) => p[1])))), yb = Math.min(N - 1, Math.ceil(Math.max(...P.map((p) => p[1]))));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const dx = x + 0.5 - P[0][0], dy = y + 0.5 - P[0][1];
      const s = (dx * e2[1] - dy * e2[0]) / det, t = (e1[0] * dy - e1[1] * dx) / det;
      if (s < 0 || s > 1 || t < 0 || t > 1) continue;
      const u = f.uvs[0][0] + (f.uvs[1][0] - f.uvs[0][0]) * s + (f.uvs[3][0] - f.uvs[0][0]) * t, v = f.uvs[0][1] + (f.uvs[1][1] - f.uvs[0][1]) * s + (f.uvs[3][1] - f.uvs[0][1]) * t;
      const tu = Math.min(f.t.largeur - 1, Math.max(0, Math.floor(u / 16 * f.t.largeur))), tv = Math.min(f.t.hauteur - 1, Math.max(0, Math.floor(v / 16 * f.t.hauteur)));
      const o = (tv * f.t.largeur + tu) * 4, a = f.t.rgba[o + 3]; if (!a) continue;
      const d = (y * N + x) * 4;
      img.px[d] = f.t.rgba[o] * f.ombre; img.px[d + 1] = f.t.rgba[o + 1] * f.ombre; img.px[d + 2] = f.t.rgba[o + 2] * f.ombre; img.px[d + 3] = 255;
    }
  }
  return img;
}

// Icone de l'objet `id` ("iron_pickaxe", "minecraft:stone"...). null si l'objet est inconnu.
export function iconeObjet(kit, id) {
  const cle = kit + '|' + id;
  if (cache.has(cle)) return cache.get(cle);
  let r = null;
  try { r = construire(kit, id); } catch { r = null; }
  cache.set(cle, r);
  return r;
}

function construire(kit, id) {
  const def = resoudreObjet(kit, id);
  if (!def.existe) {   // pas d'objet de ce nom : essai direct d'une texture d'objet ou de bloc (ex. "clock_00")
    const t = texture(kit, 'item/' + net(id)) ?? texture(kit, 'block/' + net(id));
    return t ? { w: t.largeur, h: t.hauteur, px: new Uint8Array(t.rgba) } : null;
  }
  for (const e of def.entrees) {
    if (!e.model) continue;
    const teintes = (e.tints ?? []).map((t) => couleurTeinte(t));
    const m = fusionModele(kit, e.model);
    if (m.elements && !m.generated) { const im = imageBloc(kit, m, teintes); if (im) return im; }
    const plate = imagePlate(kit, m, teintes);
    if (plate) return plate;
    if (m.elements) { const im = imageBloc(kit, m, teintes); if (im) return im; }
  }
  return null;
}

export function iconeExiste(kit, id) { return !!iconeObjet(kit, id); }
void fs; void path;
