// Film : anime la scene, dessine les images (terrain + personnages), envoie tout a ffmpeg (H.264 + AAC).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chargerScene } from '../rendu/scene.js';
import { encoderPNG } from '../rendu/png.js';
import { animer } from './anim.js';
import { imageEn, cielEn } from './look.js';
import { Personnage } from '../perso/modele.js';
import { resoudreSkin } from '../perso/skin.js';
import { lireMasque } from '../perso/masque.js';
import { Sons, planifierSons, mixer, FREQUENCE } from './sons.js';
import { trouverFfmpeg } from './ffmpeg.js';
import { appliquerTextures } from './cache.js';
import { filigrane, tailleApercu } from './apercu.js';

// Prepare les skins de tous les acteurs. `surcharges` : { nomActeur: "fichier.png" } (option --skin).
// Retourne { personnages (le skin de base de chaque acteur), parRef (par acteur : Map "reference de skin" -> Personnage, pour la
// piste `skins`), infos }. Le masque de couleur selective (champ `masque`) est lu une fois par acteur et partage par tous ses skins.
export async function preparerPersonnages(scene, { kitDir, surcharges = {}, baseDir, resoudre = resoudreSkin }) {
  const personnages = [], parRef = [], infos = [];
  for (const a of scene.acteurs) {
    const masque = a.masque ? lireMasque(a.masque, baseDir) : null;
    const r = await resoudre({ description: a.skin, modele: a.modele, kitDir, surcharge: surcharges[a.nom], baseDir });
    personnages.push(new Personnage({ rgba: r.rgba, modele: r.modele, masque }));
    infos.push({ acteur: a.nom, modele: r.modele, origine: r.origine, detail: r.detail, repli: r.repli });
    // autres skins : meme modele de corps que le skin de base (le corps ne change pas de forme en cours de scene)
    const refs = new Map();
    for (const k of a.skins?.cles ?? []) {
      if (refs.has(k.ref)) continue;
      const s = await resoudre({ description: k.ref, modele: a.modele ?? r.modele, kitDir, baseDir });
      refs.set(k.ref, new Personnage({ rgba: s.rgba, modele: r.modele, masque }));
      infos.push({ acteur: a.nom, modele: r.modele, origine: s.origine, detail: s.detail, repli: s.repli });
    }
    parRef.push(refs);
  }
  return { personnages, parRef, infos };
}

// Prepare tout ce qui sert a dessiner des images de la scene : kit (avec les textures de la scene), terrain, personnages, animation.
// Retourne { rs, anim, infos, dessiner(i, { largeur, hauteur, ssaa, copie }) -> RGBA, fermer() }.
export async function preparerFilm({ scene, zonePath, kitDir, surcharges = {}, baseDir = process.cwd(), env = process.env, travailleurs }) {
  const kit = Object.keys(scene.textures ?? {}).length ? appliquerTextures(kitDir, scene.textures, baseDir, { env }) : kitDir;
  const rs = await chargerScene({ zonePath, kitDir: kit, travailleurs });
  try {
    const { personnages, parRef, infos } = await preparerPersonnages(scene, { kitDir: kit, surcharges, baseDir });
    const terrain = { solEn: (x, z) => rs.solEn(x, z), estLibre: (x, y, z) => rs.estLibre(x, y, z), solide: (x, y, z) => rs.estSolidePourCamera(x, y, z) };
    const anim = animer(scene, terrain);
    const lumiere = personnages.map(() => null);
    // une image : personnages (skin du moment, lumiere du lieu), ciel, lumiere globale, puis post-traitement `image`
    const dessiner = async (i, { largeur, hauteur, ssaa = 1, copie = true }) => {
      const im = anim.images[i];
      const maillages = im.acteurs.map((p, k) => {
        let l = 1;
        if (typeof rs.luminositeEn === 'function') {
          const brut = rs.luminositeEn(p.x, p.y + 0.9, p.z);
          l = lumiere[k] === null ? brut : lumiere[k] + (brut - lumiere[k]) * 0.25;
          lumiere[k] = l;
        }
        const perso = p.skin ? parRef[k].get(p.skin) : personnages[k];
        return perso.maillage({ ...p, age: im.tm * 20 }, l);
      });
      const ciel = cielEn(scene, im.t);
      return rs.rendre({
        camera: im.camera, largeur, hauteur, temps: im.tm, maillagesDynamiques: maillages, ssaa, copie,
        image: imageEn(scene, im.t), lumiere: ciel?.lumiere, ciel: ciel?.ciel, brume: ciel?.brume, soleil: ciel?.soleil,
      });
    };
    return { rs, anim, infos, kit, dessiner, fermer: () => rs.fermer() };
  } catch (e) { await rs.fermer(); throw e; }
}

// Rend la scene en MP4. Retourne un compte rendu { sortie, images, secondes, corrections, notes, ... }.
//   scene : sortie de validerScene. zonePath : fichier .mcz. kitDir : kit (eventuellement fusionne avec un pack).
//   baseDir : dossier de la scene (les PNG du skin, du masque et des textures y sont cherches).
export async function rendreVideo({ scene, zonePath, kitDir, sortie, surcharges = {}, baseDir = process.cwd(), env = process.env, log = () => {}, ssaa = 1, travailleurs }) {
  const t0 = Date.now();
  const ffmpeg = trouverFfmpeg(env);
  const film = await preparerFilm({ scene, zonePath, kitDir, surcharges, baseDir, env, travailleurs });
  const { rs, anim, infos } = film;
  let tmpAudio = null;
  try {
    const images = anim.images;

    // --- son
    const sons = new Sons(film.kit, ffmpeg);
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
    const jalons = new Set([Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75)]);
    const tRendu = Date.now();
    for (let i = 0; i < n; i++) {
      const rgba = await film.dessiner(i, { largeur, hauteur, ssaa });
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
    await film.fermer();
    if (tmpAudio) fs.rmSync(tmpAudio, { force: true });
  }
}

// Une seule image de la scene, petite et filigranee, SANS jeton (mcanim apercu). Ecrit un PNG ; retourne { sortie, image, t, taille, secondes }.
//   t : secondes (0 a la duree). taille : "WxH" (640 de large au plus). Le rendu complet, lui, demande toujours un jeton.
export async function apercuImage({ scene, zonePath, kitDir, t, sortie, taille, surcharges = {}, baseDir = process.cwd(), env = process.env }) {
  const t0 = Date.now();
  if (!(t >= 0 && t <= scene.duree)) throw new Error(`--t : entre 0 et ${scene.duree} secondes (duree de la scene)`);
  const [largeur, hauteur] = tailleApercu(taille, scene);
  const film = await preparerFilm({ scene, zonePath, kitDir, surcharges, baseDir, env, travailleurs: 0 });
  try {
    const i = Math.min(film.anim.images.length - 1, Math.round(t * 30));
    const rgba = await film.dessiner(i, { largeur, hauteur, copie: true });
    filigrane(rgba, largeur, hauteur);
    fs.mkdirSync(path.dirname(sortie), { recursive: true });
    fs.writeFileSync(sortie, encoderPNG({ largeur, hauteur, rgba }));
    return { sortie, image: i, t: film.anim.images[i].t, taille: [largeur, hauteur], secondes: (Date.now() - t0) / 1000, skins: film.infos, notes: film.anim.notes };
  } finally { await film.fermer(); }
}
