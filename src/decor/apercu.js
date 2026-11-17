// `mcanim decor apercu` : petite image (512 x 384 par defaut) du decor, presque en projection orthographique (camera loin, champ etroit),
// seul (fond uni, 6 blocs de terrain autour) ou dans son contexte (28 blocs de terrain autour). Gratuit, avec le filigrane APERCU.
// Meme rendu que `mcanim apercu` : on decoupe une fenetre de la zone (avec decor) et on la dessine ; le rendu complet exige toujours un jeton.
import fs from 'node:fs';
import path from 'node:path';
import { Zone } from '../rendu/zone.js';
import { chargerScene } from '../rendu/scene.js';
import { encoderPNG } from '../rendu/png.js';
import { Classes } from './etats.js';

// Petit filigrane en coin (le mot APERCU, police 5x7) : l'image est trop petite et trop grossiere pour remplacer un rendu
const LETTRES = { A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'], E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'], C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'], U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'] };
export function coinApercu(rgba, W, H) {
  const mot = 'APERCU', k = Math.max(2, Math.round(W / 170)), w = (mot.length * 6 - 1) * k, h = 7 * k, x0 = W - w - 8 * k, y0 = H - h - 6 * k;
  for (let y = y0 - 2 * k; y < y0 + h + 2 * k; y++) for (let x = x0 - 3 * k; x < x0 + w + 3 * k; x++) { const o = (y * W + x) * 4; for (let c = 0; c < 3; c++) rgba[o + c] = Math.round(rgba[o + c] * 0.35); }
  [...mot].forEach((c, i) => { for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (LETTRES[c][y][x] === '1') for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) { const o = ((y0 + y * k + a) * W + x0 + (i * 6 + x) * k + b) * 4; rgba[o] = rgba[o + 1] = rgba[o + 2] = 245; } });
}

export const VUES = ['iso', 'dessus', 'face'];
// lacet du regard (degres) : 0 = vers le sud, 90 = vers l'ouest, 180 = vers le nord, -90 = vers l'est. `cote` = d'ou l'on regarde.
const COTES_FACE = { sud: 180, nord: 0, est: 90, ouest: -90 };
const COTES_ISO = { 'sud-est': 135, 'sud-ouest': 225, 'nord-est': 45, 'nord-ouest': -45 };

// Fenetre de la zone : [x0,z0,x1,z1] horizontalement, [y0,y1] verticalement. Rend une Zone plus petite (meme palette).
export function fenetreZone(zone, [x0, z0, x1, z1], [ya, yb]) {
  x0 = Math.max(zone.x0, x0); z0 = Math.max(zone.z0, z0); x1 = Math.min(zone.x0 + zone.sx - 1, x1); z1 = Math.min(zone.z0 + zone.sz - 1, z1);
  ya = Math.max(zone.y0, ya); yb = Math.min(zone.y0 + zone.sy - 1, yb);
  const sx = x1 - x0 + 1, sz = z1 - z0 + 1, sy = yb - ya + 1;
  const cellules = new Uint32Array(sx * sy * sz), biomes = new Uint8Array(sx * sz), hauteurs = new Int16Array(sx * sz);
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
    const src = ((y + ya - zone.y0) * zone.sz + (z + z0 - zone.z0)) * zone.sx + (x0 - zone.x0);
    cellules.set(zone.cellules.subarray(src, src + sx), (y * sz + z) * sx);
  }
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const s = (z + z0 - zone.z0) * zone.sx + (x + x0 - zone.x0);
    biomes[z * sx + x] = zone.biomes[s]; hauteurs[z * sx + x] = zone.hauteurs[s];
  }
  const hdr = { ...zone.hdr, origine: [x0, ya, z0], taille: [sx, sy, sz] };
  return new Zone(hdr, cellules, biomes, hauteurs);
}

// emprise : { x0,x1,y0,y1,z0,z1 } (du rapport) ; zone : zone AVEC decor. Rend { rgba, largeur, hauteur, png }.
export async function apercuDecor({ zone, zoneAvant = null, donnees = null, emprise, solMin = null, kitDir, vue = 'iso', cote = null, contexte = false, taille = [512, 384], filigraner = true }) {
  if (!VUES.includes(vue)) throw new Error(`--vue : ${VUES.join(', ')}`);
  const m = contexte ? 28 : 6;
  const E = emprise;
  const fen = fenetreZone(zone, [E.x0 - m, E.z0 - m, E.x1 + m, E.z1 + m], [Math.min(E.y0, solMin ?? E.y0) - (contexte ? 6 : 2), E.y1 + 4]);
  if (!contexte && zoneAvant && donnees) deboiser(fen, zoneAvant, donnees);
  if (donnees && zoneAvant) remplirSousSol(fen, zoneAvant, donnees);
  // meme lumiere que le rendu d'une scene avec decor (monde : lumiere du ciel et des blocs du jeu) quand les donnees sont la
  const rs = await chargerScene({ zone: fen, kitDir, travailleurs: 0, options: donnees ? { monde: { donnees, replay: null } } : {} });
  try {
    const cx = (E.x0 + E.x1 + 1) / 2, cz = (E.z0 + E.z1 + 1) / 2, cy = (E.y0 + E.y1 + 1) / 2;
    const w = E.x1 - E.x0 + 1 + 2 * (m > 6 ? 8 : 2), h = E.y1 - E.y0 + 1 + 4, l = E.z1 - E.z0 + 1 + 2 * (m > 6 ? 8 : 2);
    const R = 0.5 * Math.sqrt(w * w + h * h + l * l);
    let lacet, tangage;
    if (vue === 'dessus') { lacet = 180; tangage = 90; }
    else if (vue === 'face') { lacet = COTES_FACE[cote || 'sud'] ?? 180; tangage = 8; }
    else { lacet = COTES_ISO[cote || 'sud-est'] ?? 135; tangage = 32; }
    const rad = Math.PI / 180, ct = Math.cos(tangage * rad);
    const dir = [-Math.sin(lacet * rad) * ct, -Math.sin(tangage * rad), Math.cos(lacet * rad) * ct];
    const aspect = taille[0] / taille[1];
    const D = Math.max(60, 7 * R);
    const fov = Math.min(60, 2 * Math.atan((1.04 * R) / D / Math.min(1, aspect)) / rad);
    const camera = { x: cx - dir[0] * D, y: cy - dir[1] * D, z: cz - dir[2] * D, lacet, tangage, fov };
    const rgba = await rs.rendre({ camera, largeur: taille[0], hauteur: taille[1], temps: 0, ciel: { zenith: [196, 214, 236], horizon: [196, 214, 236], bas: [196, 214, 236] }, brume: { debut: 1e5, fin: 1e5 + 8 }, loin: 1e5, soleil: [0.35, 0.8, -0.45], copie: true });
    if (filigraner) coinApercu(rgba, taille[0], taille[1]);
    return { rgba, largeur: taille[0], hauteur: taille[1], png: encoderPNG({ largeur: taille[0], hauteur: taille[1], rgba }), camera };
  } finally { await rs.fermer(); }
}

export function ecrirePng(fichier, png) { fs.mkdirSync(path.dirname(path.resolve(fichier)), { recursive: true }); fs.writeFileSync(fichier, png); }

// Decor seul : on retire les arbres et les plantes qui n'ont pas ete changes par le decor (ils cachent la construction)
function deboiser(fen, avant, donnees) {
  const cls = new Classes(donnees);
  const coupe = new Map();
  let sol = fen.palette.indexOf('minecraft:grass_block[snowy=false]');
  if (sol < 0) { sol = fen.palette.length; fen.palette.push('minecraft:grass_block[snowy=false]'); }
  for (let y = 0; y < fen.sy; y++) for (let z = 0; z < fen.sz; z++) for (let x = 0; x < fen.sx; x++) {
    const i = (y * fen.sz + z) * fen.sx + x, p = fen.cellules[i];
    if (p < 2) continue;
    if (avant.paletteEn(x + fen.x0, y + fen.y0, z + fen.z0) !== avant.palette.indexOf(fen.palette[p]) && avant.palette[avant.paletteEn(x + fen.x0, y + fen.y0, z + fen.z0)] !== fen.palette[p]) continue;   // changee par le decor
    let c = coupe.get(p);
    if (c === undefined) { const e = donnees.etatId(fen.palette[p]); const info = e >= 0 ? cls.infoEtat(e) : null; c = info && (info.feuilles || info.tronc || info.plante) ? 1 : 0; coupe.set(p, c); }
    if (c) {
      fen.cellules[i] = 0;
      if (y > 0 && fen.cellules[i - fen.sx * fen.sz] === 1) fen.cellules[i - fen.sx * fen.sz] = sol;   // le sol cache sous un tronc retire devient visible
    }
  }
}

// Sous le sol de chaque colonne (d'avant le decor) tout est de la terre : le sol "creux" de la zone (cellules cachees, grottes) devient un bloc plein,
// ce qui donne une maquette propre ; les cellules changees par le decor (fondations, piles) restent telles quelles.
function remplirSousSol(fen, avant, donnees) {
  const cls = new Classes(donnees);
  let terre = fen.palette.indexOf('minecraft:dirt');
  if (terre < 0) { terre = fen.palette.length; fen.palette.push('minecraft:dirt'); }
  const memo = new Map();
  const solide = (p) => { let v = memo.get(p); if (v === undefined) { const e = p === 1 ? -1 : donnees.etatId(avant.palette[p]); v = p === 1 || (e >= 0 && donnees.boites(e).length > 0 && !cls.infoEtat(e).feuilles) ? 1 : 0; memo.set(p, v); } return v; };
  for (let z = 0; z < fen.sz; z++) for (let x = 0; x < fen.sx; x++) {
    const xw = x + fen.x0, zw = z + fen.z0;
    let g = fen.y0 - 1;
    for (let y = avant.y0 + avant.sy - 1; y >= avant.y0; y--) if (solide(avant.paletteEn(xw, y, zw))) { g = y; break; }
    for (let y = fen.y0; y < g; y++) {
      const i = ((y - fen.y0) * fen.sz + z) * fen.sx + x;
      const pa = avant.paletteEn(xw, y, zw);
      if (avant.palette[pa] === fen.palette[fen.cellules[i]]) fen.cellules[i] = terre;
    }
  }
}
