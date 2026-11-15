#!/usr/bin/env node
// Image fixe d'une zone .mcz.
// Usage : node bin/image.js --zone f.mcz [--kit DIR] [--cam x,y,z,lacet,tangage] [--fov 70] [--taille 1920x1080]
//                           --out image.png [--stats] [--resume [--pas N]] [--temps S] [--travailleurs N] [--sans-mip] [--ssaa 2]
// --kit : dossier du kit (ex. .kit-cache/26.3) ou racine du cache. Par defaut : .kit-cache a cote du depot ou du dossier courant.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chargerScene } from '../src/rendu/scene.js';
import { encoderPNG } from '../src/rendu/png.js';

const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
const flag = (n) => a.includes('--' + n);
if (flag('aide') || flag('help') || !opt('zone')) {
  console.error('Usage : node bin/image.js --zone f.mcz [--kit DIR] [--cam x,y,z,lacet,tangage] [--fov 70] [--taille 1920x1080] --out image.png [--stats] [--resume] [--pas N] [--temps S] [--travailleurs N] [--sans-mip] [--ssaa 2]');
  process.exit(opt('zone') ? 0 : 2);
}
const ici = path.dirname(fileURLToPath(import.meta.url));
let kit = opt('kit');
if (!kit) {
  for (const c of [path.resolve('.kit-cache'), path.resolve(ici, '..', '..', '.kit-cache'), path.resolve(ici, '..', '.kit-cache')]) if (fs.existsSync(c)) { kit = c; break; }
}
try {
  const t0 = performance.now();
  const scene = await chargerScene({ zonePath: opt('zone'), kitDir: kit, travailleurs: opt('travailleurs') !== undefined ? +opt('travailleurs') : undefined });
  const tCharge = performance.now() - t0;
  if (flag('resume')) {
    console.log(JSON.stringify(scene.resumeTerrain({ pas: opt('pas') ? +opt('pas') : undefined })));
    await scene.fermer();
    process.exit(0);
  }
  let camera;
  if (opt('cam')) {
    const [x, y, z, lacet, tangage] = opt('cam').split(',').map(Number);
    camera = { x, y, z, lacet: lacet ?? 0, tangage: tangage ?? 0 };
  } else camera = scene.vueParDefaut();
  camera.fov = opt('fov') ? +opt('fov') : camera.fov ?? 70;
  const [largeur, hauteur] = (opt('taille') || '1920x1080').split('x').map(Number);
  const t1 = performance.now();
  const rgba = await scene.rendre({ camera, largeur, hauteur, temps: +(opt('temps') || 0), mip: !flag('sans-mip'), ssaa: +(opt('ssaa') || 1), copie: false });
  const tRendu = performance.now() - t1;
  const out = opt('out');
  const t2 = performance.now();
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, encoderPNG({ largeur, hauteur, rgba })); }
  const tPng = performance.now() - t2;
  if (flag('stats')) {
    const m = scene.maillage.stats;
    console.log(JSON.stringify({
      camera: { x: +camera.x.toFixed(2), y: +camera.y.toFixed(2), z: +camera.z.toFixed(2), lacet: +camera.lacet.toFixed(1), tangage: +camera.tangage, fov: camera.fov },
      taille: [largeur, hauteur],
      chargementMs: Math.round(tCharge), detail: Object.fromEntries(Object.entries(scene.temps).map(([k, v]) => [k, Math.round(v)])),
      renduMs: Math.round(tRendu), pngMs: Math.round(tPng),
      maillage: { quads: m.quads, quadsParCouche: m.quadsParCouche, cellules: m.cellules, cullees: m.cullees },
      sprites: scene.textures.sprites.length,
      etatsSansModele: Object.fromEntries(scene.modeles.manquants),
      etatsApproximes: Object.fromEntries(scene.modeles.speciaux),
      texturesAbsentes: [...scene.textures.manquantes],
      biomesSansFichier: [...new Set([...scene.maillage.couleurs?.biomesAbsents || []])],
      memoireMo: Math.round(process.memoryUsage().rss / 1e6),
    }, null, 1));
  }
  await scene.fermer();
  process.exit(0);
} catch (e) {
  console.error('Erreur : ' + e.message);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
}
