// Carte vue de dessus d'une zone, gratuite : `mcanim terrain <zone> --carte [fichier.png] [--echelle N]`.
// Couleur d'un bloc = moyenne de sa vraie texture du kit (face du dessus), relief par ombrage de la pente. Grille tous les 16 blocs avec
// l'etiquette des coordonnees du MONDE (x en haut et en bas, z a gauche et a droite), puis le village : rues (trait magenta), portes
// (carre rouge, trait vers la sortie), cloche (jaune), puits (cyan), maisons (cadre blanc). Image petite (moins de 300 Ko).
// N'utilise pas le rasteriseur : un seul passage sur les colonnes de la zone.
import fs from 'node:fs';
import path from 'node:path';
import { decoderPNG, encoderPNG } from './png.js';

const SANS_ETAT = (n) => String(n).replace(/^minecraft:/, '').replace(/\[.*$/, '');
// blocs qu'on ne dessine pas (le sol dessous se voit) : air, plantes, fleurs, torches, rails...
const PASSE = /^((cave_|void_)?air|short_grass|tall_grass|fern|large_fern|dead_bush|bush|[a-z_]*flower|dandelion|poppy|[a-z_]*tulip|allium|azure_bluet|cornflower|lilac|rose_bush|peony|torch|wall_torch|lantern|rail|leaf_litter|wildflowers|vine|[a-z_]*sapling|[a-z_]*button|[a-z_]*sign|glow_lichen|sculk_vein|cobweb|firefly_bush|[a-z_]*mushroom|ladder|iron_chain|light|barrier|#hidden|lever|tripwire|string|bubble_column|kelp|seagrass|tall_seagrass|kelp_plant|[a-z_]*pressure_plate|wheat|carrots|potatoes|beetroots|sweet_berry_bush|[a-z_]*carpet)$/;
const TEINTE = { grass_block: [0x79, 0xc0, 0x5a], leaves: [0x59, 0xae, 0x30], water: [0x3f, 0x76, 0xe4] };
// bloc derive -> bloc dont on prend la texture
const DERIVE = [[/_(stairs|slab|fence|fence_gate|wall|button|pressure_plate)$/, ''], [/^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|bamboo|crimson|warped)$/, '_planks']];

function moyenne(png) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < png.rgba.length; i += 4) { const a = png.rgba[i + 3]; if (a < 40) continue; r += png.rgba[i]; g += png.rgba[i + 1]; b += png.rgba[i + 2]; n++; }
  return n ? [r / n, g / n, b / n] : null;
}

export function creerPalette(kitDir) {
  const dossier = path.join(kitDir, 'assets', 'minecraft', 'textures', 'block');
  const cache = new Map();
  const lire = (nom) => { const f = path.join(dossier, nom + '.png'); try { return moyenne(decoderPNG(fs.readFileSync(f))); } catch { return null; } };
  return (nom) => {
    if (cache.has(nom)) return cache.get(nom);
    let c = null, base = nom;
    for (const [re, suff] of DERIVE) if (re.test(base)) { base = base.replace(re, suff); break; }
    if (base.endsWith('_leaves')) c = (lire(base) && TEINTE.leaves) || null;
    else if (base === 'grass_block') c = lire('grass_block_top')?.map((v, i) => (v * TEINTE.grass_block[i]) / 255) ?? TEINTE.grass_block;
    else if (base === 'water') c = TEINTE.water;
    if (!c) c = lire(base + '_top') ?? lire(base) ?? lire(base.replace(/_block$/, '')) ?? lire(base + '_side') ?? lire(base + '_still') ?? [128, 128, 128];
    if (base.endsWith('_leaves') && c === TEINTE.leaves) c = [60, 120, 45];
    cache.set(nom, c);
    return c;
  };
}

// ---------------------------------------------------------------- petit texte : chiffres, signe moins et quelques lettres (3 x 5 pixels)
const POLICE = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001', '5': '111100111001111', '6': '111100111101111',
  '7': '111001010010010', '8': '111101111101111', '9': '111101111001111', '-': '000000111000000', X: '101101010101101', Z: '111001010100111', N: '111101101101101', E: '111100110100111', S: '111100111001111', O: '111101101101101',
};

export function dessinerCarte({ zone: Z, village = null, kitDir, echelle, ruesBrutes = null }) {
  const E = echelle ?? Math.max(1, Math.min(4, Math.floor(800 / Math.max(Z.sx, Z.sz))));
  const MX = 46, MY = 22;
  const W = Z.sx * E + 2 * MX, H = Z.sz * E + 2 * MY;
  const img = new Uint8Array(W * H * 4);
  for (let i = 0; i < img.length; i += 4) { img[i] = 24; img[i + 1] = 24; img[i + 2] = 28; img[i + 3] = 255; }
  const couleur = creerPalette(kitDir);
  const pal = Z.palette.map(SANS_ETAT);
  const passe = pal.map((n) => PASSE.test(n));
  const cpal = pal.map((n, i) => (passe[i] ? null : couleur(n)));
  const aEau = pal.map((n) => n === 'water');
  // colonnes : bloc du dessus et sa hauteur
  const haut = new Int16Array(Z.sx * Z.sz), col = new Array(Z.sx * Z.sz);
  for (let lz = 0; lz < Z.sz; lz++) for (let lx = 0; lx < Z.sx; lx++) {
    const k = lz * Z.sx + lx;
    let y = Math.min(Z.y0 + Z.sy - 1, Z.hauteurs[k] + 1), p = 0;
    for (; y >= Z.y0; y--) { p = Z.cellules[((y - Z.y0) * Z.sz + lz) * Z.sx + lx]; if (!passe[p]) break; }
    if (y < Z.y0) { haut[k] = Z.y0; col[k] = [40, 40, 44]; continue; }
    haut[k] = y;
    let c = cpal[p] ?? [128, 128, 128];
    if (aEau[p]) { let prof = 0; for (let yy = y - 1; yy >= Z.y0 && aEau[Z.cellules[((yy - Z.y0) * Z.sz + lz) * Z.sx + lx]] && prof < 10; yy--) prof++; c = c.map((v) => v * (1 - 0.045 * prof)); }
    col[k] = c;
  }
  const px = (x, y, c, a = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    img[i] = img[i] * (1 - a) + c[0] * a; img[i + 1] = img[i + 1] * (1 - a) + c[1] * a; img[i + 2] = img[i + 2] * (1 - a) + c[2] * a;
  };
  const rect = (x, y, w, h, c, a = 1) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c, a); };
  for (let lz = 0; lz < Z.sz; lz++) for (let lx = 0; lx < Z.sx; lx++) {
    const k = lz * Z.sx + lx;
    const nw = lx > 0 && lz > 0 ? haut[k - Z.sx - 1] : haut[k];
    const f = Math.max(0.72, Math.min(1.28, 1 + (haut[k] - nw) * 0.09));
    const c = col[k].map((v) => Math.max(0, Math.min(255, v * f)));
    rect(MX + lx * E, MY + lz * E, E, E, c);
  }
  const X = (x) => MX + Math.round((x - Z.x0) * E), Y = (z) => MY + Math.round((z - Z.z0) * E);
  // grille tous les 16 blocs (les multiples de 64 plus marques) et etiquettes
  const texte = (s, x, y, taille, c) => {
    let cx = x;
    for (const ch of String(s)) {
      const g = POLICE[ch];
      if (g) for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j * 3 + i] === '1') {
        rect(cx + i * taille + 1, y + j * taille + 1, taille, taille, [0, 0, 0], 0.9);
      }
      if (g) for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j * 3 + i] === '1') rect(cx + i * taille, y + j * taille, taille, taille, c);
      cx += 4 * taille;
    }
  };
  const largeurTexte = (s, t) => String(s).length * 4 * t - t;
  const T = 2;
  for (let x = Math.ceil(Z.x0 / 16) * 16; x < Z.x0 + Z.sx; x += 16) {
    const fort = x % 64 === 0;
    for (let y = MY; y < MY + Z.sz * E; y++) px(X(x), y, [255, 255, 255], fort ? 0.55 : 0.28);
    const l = largeurTexte(x, T);
    texte(x, X(x) - (l >> 1), 6, T, fort ? [255, 230, 120] : [235, 235, 235]);
    texte(x, X(x) - (l >> 1), H - MY + 6, T, fort ? [255, 230, 120] : [235, 235, 235]);
  }
  for (let z = Math.ceil(Z.z0 / 16) * 16; z < Z.z0 + Z.sz; z += 16) {
    const fort = z % 64 === 0;
    for (let x = MX; x < MX + Z.sx * E; x++) px(x, Y(z), [255, 255, 255], fort ? 0.55 : 0.28);
    texte(z, MX - 4 - largeurTexte(z, T), Y(z) - 5, T, fort ? [255, 230, 120] : [235, 235, 235]);
    texte(z, W - MX + 5, Y(z) - 5, T, fort ? [255, 230, 120] : [235, 235, 235]);
  }
  texte('X', 4, 6, T, [255, 120, 120]); texte('Z', 4, MY + 2, T, [120, 255, 120]);
  // village : maisons, rues, portes, cloche, puits
  const ligne = (x0, y0, x1, y1, c, ep = 1) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) { const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n); rect(x - (ep >> 1), y - (ep >> 1), ep, ep, c); }
  };
  if (village) {
    for (const m of village.maisons) {
      const [a, b, c, d] = [X(m.b[0]), Y(m.b[1]), X(m.b[2]), Y(m.b[3])];
      ligne(a, b, c, b, [255, 255, 255]); ligne(c, b, c, d, [255, 255, 255]); ligne(c, d, a, d, [255, 255, 255]); ligne(a, d, a, b, [255, 255, 255]);
    }
    for (const r of village.rues) for (let i = 1; i < r.p.length; i++) ligne(X(r.p[i - 1][0]), Y(r.p[i - 1][1]), X(r.p[i][0]), Y(r.p[i][1]), [255, 0, 255], 2);
    const D = { N: [0, -1], S: [0, 1], E: [1, 0], O: [-1, 0] };
    for (const m of village.maisons) for (const p of m.portes) {
      const cx = X(p[0]), cy = Y(p[1]), d = D[p[2]] ?? [0, 0];
      ligne(cx, cy, cx + d[0] * 9, cy + d[1] * 9, [255, 40, 40], 2);
      rect(cx - 2, cy - 2, 5, 5, [255, 40, 40]);
    }
    if (village.cloche) { rect(X(village.cloche[0]) - 3, Y(village.cloche[1]) - 3, 7, 7, [255, 215, 0]); }
    for (const p of village.puits) rect(X(p[0]) - 3, Y(p[1]) - 3, 7, 7, [0, 230, 255]);
  }
  void ruesBrutes;
  const png = encoderPNG({ largeur: W, hauteur: H, rgba: img }, { niveau: 9 });
  return { png, largeur: W, hauteur: H, echelle: E };
}
