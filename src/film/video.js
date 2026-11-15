// Film : anime la scene, dessine les images (terrain + personnages), envoie tout a ffmpeg (H.264 + AAC).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chargerScene } from '../rendu/scene.js';
import { animer } from './anim.js';
import { Personnage } from '../perso/modele.js';
import { resoudreSkin } from '../perso/skin.js';
import { Sons, planifierSons, mixer, FREQUENCE } from './sons.js';
import { trouverFfmpeg } from './ffmpeg.js';

// Prepare les skins de tous les acteurs. `surcharges` : { nomActeur: "fichier.png" } (option --skin).
export async function preparerPersonnages(scene, { kitDir, surcharges = {}, baseDir, resoudre = resoudreSkin }) {
  const personnages = [], infos = [];
  for (const a of scene.acteurs) {
    const r = await resoudre({ description: a.skin, modele: a.modele, kitDir, surcharge: surcharges[a.nom], baseDir });
    personnages.push(new Personnage({ rgba: r.rgba, modele: r.modele }));
    infos.push({ acteur: a.nom, modele: r.modele, origine: r.origine, detail: r.detail, repli: r.repli });
  }
  return { personnages, infos };
}

// Rend la scene en MP4. Retourne un compte rendu { sortie, images, secondes, corrections, notes, ... }.
//   scene : sortie de validerScene. zonePath : fichier .mcz. kitDir : kit (eventuellement fusionne avec un pack).
export async function rendreVideo({ scene, zonePath, kitDir, sortie, surcharges = {}, baseDir = process.cwd(), env = process.env, log = () => {}, ssaa = 1, travailleurs }) {
  const t0 = Date.now();
  const ffmpeg = trouverFfmpeg(env);
  const rs = await chargerScene({ zonePath, kitDir, travailleurs });
  let tmpAudio = null;
  try {
    const { personnages, infos } = await preparerPersonnages(scene, { kitDir, surcharges, baseDir });
    const terrain = { solEn: (x, z) => rs.solEn(x, z), estLibre: (x, y, z) => rs.estLibre(x, y, z), solide: (x, y, z) => rs.estSolidePourCamera(x, y, z) };
    const anim = animer(scene, terrain);
    const images = anim.images;

    // --- son
    const sons = new Sons(kitDir, ffmpeg);
    const plan = planifierSons({ scene, images, zone: rs.zone, sons });
    const pcm = mixer({ evenements: plan.evenements, duree: scene.duree, sons });
    tmpAudio = path.join(os.tmpdir(), `mcanim-audio-${process.pid}-${Date.now()}.raw`);
    fs.writeFileSync(tmpAudio, pcm);

    // --- ffmpeg
    const { largeur, hauteur } = scene;
    const args = ['-v', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${largeur}x${hauteur}`, '-r', '30', '-i', '-',
      '-f', 's16le', '-ar', String(FREQUENCE), '-ac', '2', '-i', tmpAudio,
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '24', '-maxrate', '8M', '-bufsize', '16M',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', sortie];
    const ff = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let erreurFf = '';
    ff.stderr.on('data', (d) => { erreurFf = (erreurFf + d).slice(-2000); });
    const fini = new Promise((ok, ko) => {
      ff.on('error', ko);
      ff.on('close', (code) => (code === 0 ? ok() : ko(new Error(`ffmpeg a echoue (code ${code}) : ${erreurFf.trim().split('\n').slice(-3).join(' | ')}`))));
    });
    let erreurPipe = null;
    ff.stdin.on('error', (e) => { erreurPipe = e; });
    fini.catch(() => {});

    // --- images
    const n = images.length;
    const lumiere = personnages.map(() => null);
    const jalons = new Set([Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75)]);
    const tRendu = Date.now();
    for (let i = 0; i < n; i++) {
      const im = images[i];
      const maillages = im.acteurs.map((p, k) => {
        let l = 1;
        if (typeof rs.luminositeEn === 'function') {
          const brut = rs.luminositeEn(p.x, p.y + 0.9, p.z);
          l = lumiere[k] === null ? brut : lumiere[k] + (brut - lumiere[k]) * 0.25;
          lumiere[k] = l;
        }
        return personnages[k].maillage({ ...p, age: im.t * 20 }, l);
      });
      const rgba = await rs.rendre({ camera: im.camera, largeur, hauteur, temps: im.t, maillagesDynamiques: maillages, ssaa });
      if (erreurPipe) break;
      if (!ff.stdin.write(rgba)) await new Promise((ok) => ff.stdin.once('drain', ok));
      if (jalons.has(i)) log(`rendu ${Math.round(((i + 1) / n) * 100)} % (${((Date.now() - tRendu) / 1000).toFixed(0)} s)`);
    }
    ff.stdin.end();
    await fini;
    return {
      sortie, images: n, duree: scene.duree, secondes: (Date.now() - t0) / 1000, secondesRendu: (Date.now() - tRendu) / 1000,
      corrections: anim.corrections, camera: anim.camera, skins: infos, notes: [...anim.notes, ...plan.notes], pas: plan.nbPas, evenementsSon: plan.evenements.length,
      memoireMaxMo: Math.round(process.resourceUsage().maxRSS / 1024), taille: fs.statSync(sortie).size,
    };
  } finally {
    await rs.fermer();
    if (tmpAudio) fs.rmSync(tmpAudio, { force: true });
  }
}
