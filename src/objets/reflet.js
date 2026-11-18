// Reflet des objets enchantes (glint ; docs/SIMULATION.md partie 26). Le jeu dessine la texture enchanted_glint_item (objets) ou
// enchanted_glint_armor (armure) PAR-DESSUS l'objet, en ajout : couleur + (0,75 x reflet)^2 (RenderPipelines.GLINT, glintStrength 0,75 par
// defaut), aux coordonnees de texture de l'objet transformees chaque image (TextureTransform.setupGlintTexturing) : horloge = millisecondes x
// glintSpeed (0,5) x 8 ; decalage (-(horloge % 110000) / 110000, (horloge % 30000) / 30000), rotation de 10 degres, echelle 8 sur les
// coordonnees de l'atlas des objets (1024 x 512 dans le jeu 26.3 : un objet de 16 px y couvre 16/1024 x 16/512) ou 0,16 sur celles du modele
// d'armure. Chiffres relus dans Horizon horizon-client-render/src/{entity.wgsl,hud/cit_glint.rs,options_file.rs} et item_render/glint_tests.rs
// (MIT, voir ATTRIBUTIONS.md). Ici le reflet est cuit dans une copie de la texture a chaque image (la place de l'objet dans l'atlas du jeu
// n'est pas reproduite : seul le depart du motif en depend).
import { texture } from './fichiers.js';

const VITESSE = 0.5, FORCE = 0.75, ROT = 0.17453292;
const COS = Math.cos(ROT), SIN = Math.sin(ROT);

// identifiant a dessiner d'une pile : l'objet sans ses composants, sauf le contenu d'une potion (la teinte `minecraft:potion` du modele en depend)
// et du materiau d'un galon (select `trim_material` des modeles d'objets)
export function idRendu(pile) {
  if (!pile) return pile;
  const s = String(pile).replace(/^minecraft:/, ''), p = /[[,]potion=([a-z0-9_]+)/.exec(s), g = /[[,]garniture=([a-z0-9_]+)/.exec(s);
  return s.replace(/\[.*$/, '').replace(/#.*$/, '') + (p ? `[potion=${p[1]}]` : g ? `[garniture=${g[1]}]` : '');
}
// galon d'une pile d'armure : { motif, garniture } ou null (moteur/pile.js : `iron_chestplate[motif=coast,garniture=gold]`)
export function galonDe(pile) {
  if (!pile) return null;
  const s = String(pile), m = /[[,]motif=([a-z0-9_]+)/.exec(s), g = /[[,]garniture=([a-z0-9_]+)/.exec(s);
  return m && g ? { motif: m[1], garniture: g[1] } : null;
}
// les identifiants qui brillent : une pile avec enchantements, ou un objet a enchantment_glint_override (liste du replay, tiree des donnees)
export function aReflet(pile, forces = null) {
  if (!pile) return false;
  const s = String(pile), i = s.indexOf('[');
  if (i >= 0 && s.slice(i + 1, -1).split(',').some((kv) => { const k = kv.split('=')[0]; return k && !['potion', 'usure', 'travail', 'garniture', 'motif'].includes(k); })) return true;
  return !!forces && forces.includes(s.replace(/^minecraft:/, '').replace(/\[.*$/, ''));
}

// icone d'interface (image { w, h, px } de `w` pixels pour 16 texels) : le meme reflet (GLINT_TEXTURING sur les coordonnees de l'atlas)
export function refletIcone(kit, img, ms) {
  const t = cuireReflet(kit, { largeur: img.w, hauteur: img.h, rgba: img.px }, ms, false, 16 / img.w);
  img.px.set(t.rgba);
  return img;
}

// texture `t` avec le reflet cuit au temps `ms` (millisecondes du film) ; armure : coordonnees du modele x 0,16
export function cuireReflet(kit, t, ms, armure = false, texelParPixel = 1) {
  const g = texture(kit, armure ? 'misc/enchanted_glint_armor' : 'misc/enchanted_glint_item');
  if (!g) return t;
  const horloge = ms * VITESSE * 8, dx = (horloge % 110000) / 110000, dy = (horloge % 30000) / 30000;
  const W = t.largeur, H = t.hauteur, out = new Uint8Array(t.rgba);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4;
    if (out[k + 3] === 0) continue;
    // objet : coordonnees de l'atlas (un texel = 1/1024 x 1/512) x 8 ; armure : coordonnees du modele (0..1) x 0,16
    const mu = armure ? (x + 0.5) / W * 0.16 : (x + 0.5) * texelParPixel / 1024 * 8, mv = armure ? (y + 0.5) / H * 0.16 : (y + 0.5) * texelParPixel / 512 * 8;
    let u = mu * COS - mv * SIN - dx, v = mu * SIN + mv * COS + dy;
    u -= Math.floor(u); v -= Math.floor(v);
    const gx = Math.min(g.largeur - 1, Math.floor(u * g.largeur)), gy = Math.min(g.hauteur - 1, Math.floor(v * g.hauteur)), gk = (gy * g.largeur + gx) * 4;
    for (let c = 0; c < 3; c++) { const a = FORCE * g.rgba[gk + c] / 255; out[k + c] = Math.min(255, out[k + c] + Math.round(a * a * 255)); }
  }
  return { largeur: W, hauteur: H, rgba: out };
}
