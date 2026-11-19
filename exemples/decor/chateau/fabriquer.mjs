// Exemple : un chateau detaille (docs/FORMAT-DECOR.md, partie D). Fabrique, avec NOTRE code (aucune construction de tiers) :
//   donjon.schem       le donjon (Sponge v3) : murs, contreforts, trois etages, fenetres a linteau, porte, creneaux, bannieres a motifs
//   porte.schem        le chatelet (Sponge v2 ; le format .nbt est lu aussi, mais aucun .nbt n'entre dans le depot : controle) : passage voute, herse, deux tourelles, bannieres
//   fontaine.litematic la fontaine de la cour (Litematica)
//   chateau.decor.json le decor : aplanir, remparts, creneaux (gabarit + grille), quatre tours (gabarit tourne : cyl creux + cone),
//                      imports, chapelle a dome (sphere), casernes (miroir), mosaique (grille gzip), arbres (ellipsoide), charrette (rotation)
// Usage : node exemples/decor/chateau/fabriquer.mjs   puis   mcanim decor verifier exemples/decor/chateau/scene-chateau.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ecrireSchem, ecrireLitematic } from '../../../src/decor/importer.js';
import { encoderGrille } from '../../../src/decor/lire.js';
import { N } from '../../../src/decor/nbt.js';

const ici = path.dirname(fileURLToPath(import.meta.url));
const mc = (t) => (t === null || t.includes(':') ? t : 'minecraft:' + t);
const hache = (x, y, z) => ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0);

// volume de blocs (null = rien : la cellule du monde reste telle quelle)
class Vol {
  constructor(sx, sy, sz) { this.t = [sx, sy, sz]; this.pal = [null]; this.ix = new Map([[null, 0]]); this.c = new Uint32Array(sx * sy * sz); this.ent = []; }
  set(x, y, z, b) {
    const [sx, sy, sz] = this.t;
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return;
    const k = mc(b);
    let i = this.ix.get(k);
    if (i === undefined) { i = this.pal.length; this.pal.push(k); this.ix.set(k, i); }
    this.c[(y * sz + z) * sx + x] = i;
  }
  boite(x1, y1, z1, x2, y2, z2, b) { for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) this.set(x, y, z, typeof b === 'function' ? b(x, y, z) : b); }
  banniere(x, y, z, couleur, facing, motifs) {
    this.set(x, y, z, `${couleur}_wall_banner[facing=${facing}]`);
    this.ent.push({ x, y, z, id: 'minecraft:banner', donnees: { patterns: N.liste(10, motifs.map(([m, c]) => N.compose({ pattern: 'minecraft:' + m, color: c }))) } });
  }
  struct() { return { taille: this.t, palette: this.pal, indices: this.c, entites: this.ent }; }
}
const pierre = (x, y, z) => { const h = hache(x, y, z) % 10; return h < 6 ? 'stone_bricks' : h < 8 ? 'mossy_stone_bricks' : h < 9 ? 'cracked_stone_bricks' : 'andesite'; };

// ---------------------------------------------------------------- donjon : 15 x 22 x 16 (z = 15 : couche des bannieres, devant la facade sud)
function donjon() {
  const v = new Vol(15, 22, 16);
  v.boite(0, 0, 0, 14, 0, 14, 'polished_andesite');
  for (let y = 1; y <= 17; y++) for (let z = 0; z <= 14; z++) for (let x = 0; x <= 14; x++) {
    const bord = x === 0 || x === 14 || z === 0 || z === 14;
    v.set(x, y, z, bord ? pierre(x, y, z) : 'air');
  }
  // contreforts d'angle et bandeaux
  for (let y = 1; y <= 17; y++) for (const [x, z] of [[0, 0], [14, 0], [0, 14], [14, 14]]) v.set(x, y, z, 'chiseled_stone_bricks');
  for (const y of [6, 12]) { for (let i = 0; i <= 14; i++) { v.set(i, y, 0, 'polished_andesite'); v.set(i, y, 14, 'polished_andesite'); v.set(0, y, i, 'polished_andesite'); v.set(14, y, i, 'polished_andesite'); } }
  // planchers (trappe pour l'echelle en (2, y, 2))
  for (const y of [6, 12, 17]) { v.boite(1, y, 1, 13, y, 13, y === 17 ? 'stone_bricks' : 'dark_oak_planks'); if (y < 17) v.set(2, y, 2, 'air'); }
  for (let y = 1; y <= 16; y++) v.set(2, y, 1, 'ladder[facing=south]');
  // fenetres : deux de haut, linteau en escaliers renverses, appui en dalle
  const faces = [['north', (i, y) => [i, y, 0]], ['south', (i, y) => [i, y, 14]], ['west', (i, y) => [0, y, i]], ['east', (i, y) => [14, y, i]]];
  for (const [f, P] of faces) for (const i of [4, 10]) for (const y0 of [2, 8, 14]) {
    if (f === 'south' && i === 4 && y0 === 2) continue;
    v.set(...P(i, y0), 'glass_pane'); v.set(...P(i, y0 + 1), 'glass_pane');
    v.set(...P(i - 1, y0 + 2), `stone_brick_stairs[facing=${f === 'north' || f === 'south' ? 'east' : 'south'},half=top]`);
    v.set(...P(i + 1, y0 + 2), `stone_brick_stairs[facing=${f === 'north' || f === 'south' ? 'west' : 'north'},half=top]`);
  }
  // porte au sud (x 7) et marches
  v.set(7, 1, 14, 'spruce_door[facing=north,half=lower,hinge=left,open=false]'); v.set(7, 2, 14, 'spruce_door[facing=north,half=upper,hinge=left,open=false]');
  v.set(7, 3, 14, 'chiseled_stone_bricks');
  // creneaux : parapet a y 18, merlons un sur deux a y 19, tourelle de guet
  for (let i = 0; i <= 14; i++) for (const [x, z] of [[i, 0], [i, 14], [0, i], [14, i]]) { v.set(x, 18, z, pierre(x, 18, z)); if (i % 2 === 0) v.set(x, 19, z, pierre(x, 19, z)); }
  v.boite(5, 18, 5, 9, 20, 9, (x, y, z) => (x === 5 || x === 9 || z === 5 || z === 9 ? pierre(x, y, z) : 'air'));
  v.boite(5, 21, 5, 9, 21, 9, 'deepslate_tile_slab[type=bottom]');
  // interieur : lanternes, table, tapis
  for (const y of [5, 11, 16]) v.set(7, y, 7, 'lantern[hanging=true]');
  v.boite(5, 7, 5, 9, 7, 9, 'red_carpet'); v.set(7, 1, 7, 'crafting_table');
  // bannieres de la facade sud (motifs : entites de bloc)
  v.banniere(3, 10, 15, 'blue', 'south', [['stripe_top', 'yellow'], ['border', 'yellow'], ['cross', 'white']]);
  v.banniere(11, 10, 15, 'blue', 'south', [['stripe_top', 'yellow'], ['border', 'yellow'], ['cross', 'white']]);
  v.ent.push({ x: 7, y: 1, z: 7, id: 'minecraft:chest', donnees: {} });   // un coffre fictif : compte comme entite ignoree
  return v.struct();
}

// ---------------------------------------------------------------- chatelet : 13 x 15 x 8 (z = 7 : couche des bannieres, cote exterieur sud)
function chatelet() {
  const v = new Vol(13, 15, 8);
  v.boite(0, 0, 0, 12, 10, 6, pierre);
  v.boite(4, 0, 0, 8, 5, 6, 'air');                       // passage
  for (let z = 0; z <= 6; z++) { v.set(4, 5, z, 'stone_brick_stairs[facing=east,half=top]'); v.set(8, 5, z, 'stone_brick_stairs[facing=west,half=top]'); }
  for (let x = 4; x <= 8; x++) for (let y = 3; y <= 5; y++) v.set(x, y, 5, 'iron_bars');   // herse a demi levee
  v.boite(0, 11, 0, 12, 11, 6, 'stone_bricks');
  for (let i = 0; i <= 12; i += 2) { v.set(i, 12, 0, pierre(i, 12, 0)); v.set(i, 12, 6, pierre(i, 12, 6)); }
  for (const x0 of [0, 10]) { v.boite(x0, 12, 2, x0 + 2, 13, 4, pierre); v.boite(x0, 14, 2, x0 + 2, 14, 4, 'dark_oak_slab[type=bottom]'); }
  for (const x of [2, 10]) for (const y of [3, 4, 8]) v.set(x, y, 6, 'glass_pane');
  v.banniere(2, 7, 7, 'red', 'south', [['creeper', 'black'], ['border', 'black']]);
  v.banniere(10, 7, 7, 'red', 'south', [['creeper', 'black'], ['border', 'black']]);
  return v.struct();
}

// ---------------------------------------------------------------- fontaine : 7 x 5 x 7
function fontaine() {
  const v = new Vol(7, 5, 7);
  v.boite(0, 0, 0, 6, 0, 6, 'polished_andesite');
  for (let i = 0; i <= 6; i++) for (const [x, z] of [[i, 0], [i, 6], [0, i], [6, i]]) v.set(x, 1, z, 'stone_brick_wall');
  v.boite(1, 1, 1, 5, 1, 5, 'water');
  v.boite(3, 1, 3, 3, 3, 3, 'chiseled_stone_bricks');
  v.set(3, 4, 3, 'lantern');
  return v.struct();
}

// ---------------------------------------------------------------- le decor
const W = 'stone_bricks:6,mossy_stone_bricks:2,cracked_stone_bricks:1,andesite:1';
function decor() {
  // mosaique 11 x 1 x 11 autour de la fontaine (grille gzip) : losanges de granit poli, diorite et andesite
  const mos = [], P = 11;
  for (let z = 0; z < P; z++) for (let x = 0; x < P; x++) { const d = Math.abs(x - 5) + Math.abs(z - 5); mos.push(d % 4 === 0 ? 1 : d % 4 === 2 ? 2 : 3); }
  return {
    v: 1, zone: '2xJIf06JksIKHlYTzEiCPw', ancre: [444, 318], niveau: 72, graine: 11,
    note: 'chateau : remparts, 4 tours (gabarit), donjon, chatelet et fontaine importes, chapelle a dome, casernes en miroir',
    pal: { W, T: 'stone_bricks:5,mossy_stone_bricks:2,polished_andesite:1', toit: 'deepslate_tiles:4,deepslate_bricks:1', b: 'spruce_planks', c: 'spruce_stairs' },
    ops: [
      ['aplanir', -8, -8, 59, 59, 0, { marge: 6 }],
      ['plein', 23, -1, 20, 27, -1, 51, 'gravel:3,cobblestone:1'],
      // remparts (2 d'epaisseur) et creneaux : gabarit "creneau" (grille 2 x 2 x 1) pose tout le long, tourne de 90 sur les murs est et ouest
      ['mur', 0, 0, 0, 51, 9, 51, 'W'], ['mur', 1, 0, 1, 50, 9, 50, 'W'],
      ['gab', 'creneau', [['grille', 0, 10, 0, 2, 2, 1, ['W', null], 'rle:0 1 0 1']]],
      ['rep', 26, 2, 0, 0, [['pose', 'creneau', 0, 0, 0], ['pose', 'creneau', 0, 0, 51]]],
      ['rep', 26, 0, 0, 2, [['pose', 'creneau', 0, 0, 0, { rot: 90 }], ['pose', 'creneau', 51, 0, 0, { rot: 90 }]]],
      // tours : gabarit pose aux quatre coins (cylindre creux qui vide l'interieur, planchers, couronne, fleche conique)
      ['gab', 'tour', [
        ['fond', -6, -6, 6, 6, 'T', { de: -2, profondeur: 24 }],
        ['cyl', 0, -1, 0, 5, 16, 'T', { epaisseur: 1, dedans: 'air' }],
        ['cyl', 0, -1, 0, 4, 1, 'b'], ['cyl', 0, 6, 0, 4, 1, 'b'], ['cyl', 0, 12, 0, 4, 1, 'b'],
        ['cyl', 0, 15, 0, 6, 1, 'T'],
        ['pts', 'T', [6, 16, 0], [-6, 16, 0], [0, 16, 6], [0, 16, -6], [4, 16, 4], [-4, 16, 4], [4, 16, -4], [-4, 16, -4]],
        ['cone', 0, 16, 0, 5, 11, 'toit'], ['bloc', 0, 27, 0, 'lightning_rod'],
        ['pts', 'glass_pane', [5, 3, 0], [5, 4, 0], [-5, 3, 0], [-5, 4, 0], [0, 3, 5], [0, 4, 5], [0, 9, -5], [0, 10, -5], [5, 9, 0], [5, 10, 0], [0, 9, 5], [0, 10, 5]],
        ['bloc', 0, 11, 0, 'lantern'], ['bloc', 0, 5, 0, 'lantern'],
      ]],
      ['pose', 'tour', 0, 0, 0], ['pose', 'tour', 51, 0, 0, { rot: 90 }], ['pose', 'tour', 51, 0, 51, { rot: 180 }], ['pose', 'tour', 0, 0, 51, { rot: 270 }],
      // donjon (.schem v3), chatelet (.schem v2, perce le rempart sud), fontaine (.litematic)
      ['importer', 'donjon.schem', 18, 0, 4],
      ['importer', 'porte.schem', 19, 0, 45],
      ['grille', 20, -1, 26, P, 1, P, [null, 'polished_granite', 'polished_diorite', 'polished_andesite'], encoderGrille(mos)],
      ['importer', 'fontaine.litematic', 22, 0, 28],
      // chapelle a dome (demi-sphere creuse de cuivre)
      ['creux', 6, -1, 7, 14, 6, 15, 'smooth_stone'],
      ['sphere', 10, 7, 11, 4, 'oxidized_copper', { epaisseur: 1, moitie: 'haut' }],
      ['porte', 14, 0, 11, 'spruce_door', 'est', { ouverte: true }],
      ['pts', 'purple_stained_glass_pane', [10, 2, 7], [10, 3, 7], [10, 2, 15], [10, 3, 15], [6, 2, 11], [6, 3, 11]],
      ['bloc', 10, 5, 11, 'lantern'],
      // caserne ouest (pans de bois) puis son miroir a l'est
      ['creux', 4, -1, 22, 12, 4, 40, 'b'], ['coins', 4, 22, 12, 40, 0, 3, 'stripped_spruce_log'],
      ['rep', 3, 0, 0, 6, [['pts', 'glass_pane', [4, 1, 25], [4, 2, 25], [12, 1, 25], [12, 2, 25]]]],
      ['porte', 12, 0, 31, 'spruce_door', 'est'],
      ['toit', 4, 22, 12, 40, 5, 'c', 'z', { pignon: 'b' }],
      ['miroir', 3, -1, 21, 13, 10, 41, 'x', { decalage: [35, 0, 0], air: false }],
      // cour : arbres (ellipsoides), lanternes sur poteaux, charrette de foin tournee
      ['ligne', 18, 0, 38, 18, 4, 38, 'oak_log'], ['ellipsoide', 18, 6, 38, 3, 2, 3, 'oak_leaves[persistent=true]'],
      ['ligne', 33, 0, 23, 33, 4, 23, 'oak_log'], ['ellipsoide', 33, 6, 23, 3, 2, 3, 'oak_leaves[persistent=true]'],
      ['pts', 'oak_fence', [21, 0, 22], [29, 0, 22], [21, 0, 42], [29, 0, 42]], ['pts', 'lantern', [21, 1, 22], [29, 1, 22], [21, 1, 42], [29, 1, 42]],
      ['plein', 32, 0, 40, 35, 0, 41, 'hay_block'], ['bloc', 32, 1, 40, 'hay_block'], ['bloc', 35, 0, 42, 'oak_fence'],
      ['rotation', 32, 0, 40, 35, 1, 42, 90],
    ],
  };
}

fs.writeFileSync(path.join(ici, 'donjon.schem'), ecrireSchem(donjon(), { version: 3 }));
fs.writeFileSync(path.join(ici, 'porte.schem'), ecrireSchem(chatelet(), { version: 2 }));
fs.writeFileSync(path.join(ici, 'fontaine.litematic'), ecrireLitematic(fontaine()));
fs.writeFileSync(path.join(ici, 'chateau.decor.json'), JSON.stringify(decor()));
for (const f of ['donjon.schem', 'porte.schem', 'fontaine.litematic', 'chateau.decor.json']) console.log(f, fs.statSync(path.join(ici, f)).size, 'octets');
