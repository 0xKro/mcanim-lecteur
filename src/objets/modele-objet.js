// Modele d'objet -> quads (en blocs, 0..1, Y vers le haut, comme un modele de bloc) + transformation d'affichage a la main.
//  - "plat" : modele `builtin/generated` (item/generated, item/handheld) : l'image est extrudee, 1/16 d'epaisseur, face avant, face arriere et
//    une petite face par arete entre un pixel opaque et un pixel transparent (ItemModelGenerator du jeu, via Horizon : item_bake.rs).
//  - "bloc" : un modele a elements (blocs, torche, certains objets) : le resolveur de modeles de blocs du rendu (rendu/modeles.js) est reutilise.
//  - "plaque" : modele sans geometrie (bouclier, banniere, coffre, tete... dessines par du code dans le jeu) : on prend sa texture `particle`
//    et on la dessine en plaque plate. Repli simple, signale dans la note des objets.
import { BibliothequeModeles } from '../rendu/modeles.js';
import { lireJson, texture } from './fichiers.js';

const net = (s) => String(s).replace(/^minecraft:/, '');
// Le resolveur de blocs veut un objet "textures" : on ne lui donne que des noms (les pixels sont lus ici, apres).
const NOMS = { sprite: (nom) => ({ nom: net(nom), couche: 0, manquante: false }) };
const biblios = new Map();
const biblio = (kit) => { if (!biblios.has(kit)) biblios.set(kit, new BibliothequeModeles(kit, NOMS)); return biblios.get(kit); };

const EPAISSEUR_Z0 = 7.5 / 16, EPAISSEUR_Z1 = 8.5 / 16;

// ---------------------------------------------------------------- affichage (display) : rotation (degres), translation (blocs), echelle
// Comme le jeu (Horizon, horizon-assets/src/model.rs ItemTransform::decode et ItemTransforms::decode) : translation en 16emes bornee a +-5 blocs,
// echelle bornee a +-4 ; chaque contexte vient du premier modele de la chaine des parents qui le donne ; la main gauche reprend la
// droite DU MEME MODELE quand elle n'est pas donnee. Retourne null (aucune transformation) ou { rotation, translation, scale }.
function lireTransform(t) {
  if (!t || typeof t !== 'object') return null;
  const v = (x, d) => (Array.isArray(x) && x.length === 3 && x.every(Number.isFinite) ? x : d);
  return {
    rotation: v(t.rotation, [0, 0, 0]),
    translation: v(t.translation, [0, 0, 0]).map((c) => Math.max(-5, Math.min(5, c * 0.0625))),
    scale: v(t.scale, [1, 1, 1]).map((c) => Math.max(-4, Math.min(4, c))),
  };
}
export function afficheDe(kit, modeleId, gauche, contexte = null) {   // contexte : 'ground' (objet au sol), 'gui'... ; null : la main (thirdperson)
  let cur = net(modeleId);
  for (let i = 0; i < 16 && cur && !cur.startsWith('builtin/'); i++) {
    const j = lireJson(kit, `models/${cur}.json`);
    if (!j) return null;
    const d = j.display;
    if (d && typeof d === 'object') {
      const t = contexte ? d[contexte] : gauche ? (d.thirdperson_lefthand !== undefined ? d.thirdperson_lefthand : d.thirdperson_righthand) : d.thirdperson_righthand;
      if (t !== undefined) return lireTransform(t);
    }
    cur = j.parent ? net(j.parent) : null;
  }
  return null;
}

// ---------------------------------------------------------------- extrusion d'une image (objets "plats")
const sous = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const croix = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// Un quad dont les sommets tournent dans le sens direct vu de l'exterieur (normale voulue `n`).
function quad(p, uv, n, tex, tint) {
  const c = croix(sous(p[1], p[0]), sous(p[2], p[0]));
  if (c[0] * n[0] + c[1] * n[1] + c[2] * n[2] < 0) return { p: [p[0], p[3], p[2], p[1]], uv: [uv[0], uv[3], uv[2], uv[1]], tex, tint };
  return { p, uv, tex, tint };
}

// nom : nom de la texture (cle du kit) ; t : { largeur, hauteur, rgba } ; couche : 0.. (decale un peu les couches pour qu'elles ne se melangent pas)
export function extruder(nom, t, couche = 0, tint = null) {
  const { largeur: w, hauteur: h, rgba } = t;
  const e = 0.0004 * couche, z0 = EPAISSEUR_Z0 - e, z1 = EPAISSEUR_Z1 + e;
  // Comme ItemModelGenerator du jeu : face sud (avant) uv [0,0,16,16], face nord (arriere) uv [16,0,0,16]. Sur les deux faces u = x et
  // v = 1 - y : l'avant montre l'image de l'inventaire, l'arriere la montre EN MIROIR (on voit l'objet "par transparence"), et les
  // petites faces des aretes (pixel du bord, meme u = x) tombent juste sous les deux. Avant : l'arriere avait u = 1 - x (image non
  // inversee vue de derriere), donc decalee par rapport a sa propre silhouette et a ses aretes.
  const quads = [
    quad([[0, 1, z1], [0, 0, z1], [1, 0, z1], [1, 1, z1]], [[0, 0], [0, 1], [1, 1], [1, 0]], [0, 0, 1], nom, tint),   // avant (sud)
    quad([[1, 1, z0], [1, 0, z0], [0, 0, z0], [0, 1, z0]], [[1, 0], [1, 1], [0, 1], [0, 0]], [0, 0, -1], nom, tint),  // arriere (nord) : u = x, miroir vu de derriere
  ];
  const opaque = (i, j) => i >= 0 && j >= 0 && i < w && j < h && rgba[(j * w + i) * 4 + 3] !== 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!opaque(i, j)) continue;
    const x0 = i / w, x1 = (i + 1) / w, yh = 1 - j / h, yb = 1 - (j + 1) / h;
    const u = (i + 0.5) / w, v = (j + 0.5) / h, uv = [[u, v], [u, v], [u, v], [u, v]];
    if (!opaque(i, j - 1)) quads.push(quad([[x0, yh, z1], [x1, yh, z1], [x1, yh, z0], [x0, yh, z0]], uv, [0, 1, 0], nom, tint));
    if (!opaque(i, j + 1)) quads.push(quad([[x0, yb, z1], [x1, yb, z1], [x1, yb, z0], [x0, yb, z0]], uv, [0, -1, 0], nom, tint));
    if (!opaque(i - 1, j)) quads.push(quad([[x0, yh, z1], [x0, yb, z1], [x0, yb, z0], [x0, yh, z0]], uv, [-1, 0, 0], nom, tint));
    if (!opaque(i + 1, j)) quads.push(quad([[x1, yh, z1], [x1, yb, z1], [x1, yb, z0], [x1, yh, z0]], uv, [1, 0, 0], nom, tint));
  }
  return quads;
}

// ---------------------------------------------------------------- un modele -> { quads, affiche, nature }
// entree : { model, tints } (definition.js) ; gauche : main gauche (affichage). Les pixels ne sont lus que pour les modeles plats.
// `signaler(texte)` recoit les anomalies (texture absente...).
export function cuire(kit, entree, { gauche = false, signaler = () => {} } = {}) {
  const b = biblio(kit);
  const id = entree.model;
  const m = b.modele(id);
  if (m.introuvable && !m.elements) { signaler(`modele ${id} absent du kit`); return { quads: [], affiche: null, nature: 'vide' }; }
  const teinte = (i) => (entree.tints?.[i] ?? null);
  // modele plat : item/generated et ses enfants
  if (m.special === 'builtin/generated') {
    const quads = [];
    for (let i = 0; i < 5; i++) {
      const ref = b._resoudreTexture(m, `#layer${i}`);
      if (!ref) break;
      const t = texture(kit, ref);
      if (!t) { signaler(`texture absente : ${ref}`); continue; }
      quads.push(...extruder(ref, t, i, teinte(i)));
    }
    return { quads, affiche: afficheDe(kit, id, gauche), nature: 'plat' };
  }
  if (m.elements) {
    const brut = b.quadsModele(id, 0, 0, false);
    const quads = brut.map((q) => ({ p: q.p, uv: q.uv, tex: q.sprite.nom, tint: q.tint >= 0 ? teinte(q.tint) : null }));
    return { quads, affiche: afficheDe(kit, id, gauche), nature: 'bloc' };
  }
  return plaque(kit, id, m, b, { gauche, signaler });
}

// Repli : la texture `particle` du modele en plaque plate (bouclier : planches ; trident : son image...). Affichage d'objet plat
// (`item/handheld` pour une image d'objet, `item/generated` pour une texture de bloc).
function plaque(kit, id, m, b, { gauche, signaler }) {
  const ref = b._resoudreTexture(m, '#particle');
  const t = ref ? texture(kit, ref) : null;
  if (!t) { signaler(`${id} : rien a dessiner`); return { quads: [], affiche: null, nature: 'vide' }; }
  return { quads: extruder(ref, t, 0, null), affiche: afficheDe(kit, ref.startsWith('item/') ? 'item/handheld' : 'item/generated', gauche), nature: 'plaque', texture: ref };
}

// Repli pour un `special` : le modele de base s'il a une geometrie, sinon la plaque.
export function cuireSpecial(kit, entree, opts = {}) {
  const base = entree.base;
  if (!base) return { quads: [], affiche: null, nature: 'vide' };
  return cuire(kit, { model: base, tints: [] }, opts);
}
