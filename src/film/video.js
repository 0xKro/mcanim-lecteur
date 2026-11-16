// Film : anime la scene, dessine les images (terrain + personnages), envoie tout a ffmpeg (H.264 + AAC).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chargerScene } from '../rendu/scene.js';
import { encoderPNG } from '../rendu/png.js';
import { animer } from './anim.js';
import { terrainDepuis } from './physique.js';
import { imageEn, cielEn } from './look.js';
import { Personnage } from '../perso/modele.js';
import { resoudreSkin } from '../perso/skin.js';
import { lireMasque } from '../perso/masque.js';
import { Sons, planifierSons, mixer, FREQUENCE, VOLUME_MIXAGE } from './sons.js';
import { trouverFfmpeg } from './ffmpeg.js';
import { appliquerTextures } from './cache.js';
import { filigrane, tailleApercu } from './apercu.js';
import { lireShader } from '../shader/format.js';

// Fichier de shader a utiliser : l'option (chemin deja resolu) l'emporte sur le champ `shader` de la scene (relatif au fichier de scene).
export function fichierShader(scene, baseDir, option) {
  if (option) return path.resolve(option);
  return scene.shader ? path.resolve(baseDir, scene.shader) : null;
}

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

// Simulation du jeu d'une scene avec un champ `monde` : { zone, donnees, replay, rapport, notes, secondes }. Gratuit (pas de jeton) : meme calcul pour
// `mcanim simuler`, `apercu` et `rendre` (graine fixee : memes blocs a chaque fois).
export async function simulerScene({ scene, zonePath, baseDir, env = process.env }) {
  const t0 = performance.now();
  const { lireZone } = await import('../rendu/zone.js');
  const { simuler } = await import('../moteur/index.js');
  const { donneesDuJeu } = await import('../moteur/chargeur.js');
  const zone = lireZone(zonePath);
  const donnees = await donneesDuJeu({ env });
  const r = simuler({ zone, donnees, monde: scene.monde, baseDir, duree: scene.duree });
  return { zone, donnees, replay: r.replay, rapport: r.rapport, notes: r.replay.avertissements.map((a) => 'monde : ' + a), secondes: (performance.now() - t0) / 1000 };
}

// Prepare tout ce qui sert a dessiner des images de la scene : kit (avec les textures de la scene), terrain, personnages, animation.
// Retourne { rs, anim, infos, dessiner(i, { largeur, hauteur, ssaa, copie }) -> RGBA, fermer() }.
export async function preparerFilm({ scene, zonePath, kitDir, surcharges = {}, baseDir = process.cwd(), env = process.env, travailleurs, shader }) {
  const kit = Object.keys(scene.textures ?? {}).length ? appliquerTextures(kitDir, scene.textures, baseDir, { env }) : kitDir;
  // scene avec un champ `monde` : la simulation tourne AVANT le premier rendu (elle produit le replay des changements de blocs) ; le moteur
  // n'est charge que dans ce cas (une scene sans `monde` ne change pas d'un bit et ne paie rien)
  const sim = scene.monde ? await simulerScene({ scene, zonePath, baseDir, env }) : null;
  const rs = await chargerScene({ zonePath, zone: sim?.zone, kitDir: kit, travailleurs, options: sim ? { monde: { donnees: sim.donnees, replay: sim.replay, lumiere: scene.monde.lumiere } } : {} });
  try {
    // shader (facultatif) : lu et controle ici ; sans fichier, ou avec {}, le rendu est celui d'avant au pixel pres
    const fs0 = fichierShader(scene, baseDir, shader);
    const sh = fs0 ? lireShader(fs.readFileSync(fs0, 'utf8')) : null;
    rs.definirShader(sh);
    const notes = sh ? [...sh.notes] : [];
    if (sim) notes.push(...sim.notes);
    const { personnages, parRef, infos } = await preparerPersonnages(scene, { kitDir: kit, surcharges, baseDir });
    const terrain = terrainDepuis(rs);
    const anim = animer(scene, terrain);
    const lumiere = personnages.map(() => null);
    // une image : personnages (skin du moment, lumiere du lieu), ciel, lumiere globale, puis post-traitement `image`
    const dessiner = async (i, { largeur, hauteur, ssaa = 1, copie = true }) => {
      const im = anim.images[i];
      if (sim) await rs.appliquerReplay(sim.replay.tickDe(im.tm));   // les blocs changes jusqu'a cet instant du monde (refait les sections touchees)
      const cielM = sim ? cielEn(scene, im.t, { lightmap: rs.maillage.lightmap }) : null;
      if (cielM && rs.maillage.lightmap) rs.tableLumiere(cielM.heure ?? 12, cielM.gamma);   // la lumiere des acteurs suit la meme table que le terrain
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
      const ciel = sim ? cielM : cielEn(scene, im.t);
      return rs.rendre({
        camera: im.camera, largeur, hauteur, temps: im.tm, maillagesDynamiques: maillages, ssaa, copie,
        image: imageEn(scene, im.t), heure: ciel?.heure, jour: ciel?.jour, cielFixe: ciel?.fixe, lumiere: ciel?.lumiere, gamma: ciel?.gamma,
        // le ciel est celui du jeu ; couleurs de ciel et de brume imposees seulement par couleurCiel
        ciel: ciel?.fixe ? ciel.ciel : undefined, soleil: ciel?.fixe ? ciel.soleil : undefined,
        brume: ciel?.fixe ? ciel.brume : (ciel?.brume?.debut !== undefined ? { debut: ciel.brume.debut } : undefined),
      });
    };
    return { rs, anim, infos, kit, notes, dessiner, sim, fermer: () => rs.fermer() };
  } catch (e) { await rs.fermer(); throw e; }
}

// Film avec un vrai pack : prepare l'hote GL puis fixe le nombre d'images de chauffe (mesure une fois par pack, gardee dans le cache).
export async function preparerFilmReel({ scene, zonePath, kitDir, surcharges, baseDir, env, packShader, echelle, optionsPack, log, chauffe }) {
  const pf = await import('../pack/film.js');
  const chemin = path.resolve(packShader);
  const film = await pf.preparerFilmPack({ scene, zonePath, kitDir, surcharges, baseDir, env, packShader: chemin, echelle, options: optionsPack ?? {}, log, chauffe });
  try {
    if (chauffe === undefined) {
      const cle = pf.cleChauffe(chemin, optionsPack?.surcharges);
      let n = pf.lireCacheChauffe(cle);
      if (!n) { log('premiere utilisation de ce pack : mesure des images de chauffe...'); n = await pf.mesurerChauffe(film); pf.ecrireCacheChauffe(cle, n); }
      film.reglerChauffe(n);
      log(`chauffe : ${n} images avant la premiere image du film`);
    }
  } catch (e) { await film.fermer(); throw e; }
  return film;
}

// Rend la scene en MP4. Retourne un compte rendu { sortie, images, secondes, corrections, notes, ... }.
//   scene : sortie de validerScene. zonePath : fichier .mcz. kitDir : kit (eventuellement fusionne avec un pack).
//   baseDir : dossier de la scene (les PNG du skin, du masque et des textures y sont cherches).
//   packShader (chemin d'un pack .zip ou dossier) : les images viennent d'un VRAI pack de shaders (hote OpenGL logiciel, src/pack/film.js) ;
//   echelle : 1 = pleine taille, 0.5 = le pack tourne a mi-taille puis l'image est agrandie ; optionsPack : { surcharges, reglages } deja controles.
export async function rendreVideo({ scene, zonePath, kitDir, sortie, surcharges = {}, baseDir = process.cwd(), env = process.env, log = () => {}, ssaa = 1, travailleurs, shader, packShader, echelle = 1, optionsPack }) {
  const t0 = Date.now();
  const ffmpeg = trouverFfmpeg(env);
  const film = packShader ? await preparerFilmReel({ scene, zonePath, kitDir, surcharges, baseDir, env, packShader, echelle, optionsPack, log }) : await preparerFilm({ scene, zonePath, kitDir, surcharges, baseDir, env, travailleurs, shader });
  const { rs, anim, infos } = film;
  let tmpAudio = null;
  try {
    const images = anim.images;

    // --- son
    const sons = new Sons(film.kit, ffmpeg);
    const plan = planifierSons({ scene, images, zone: rs.zone, sons, sims: anim.sims });
    const pcm = mixer({ evenements: plan.evenements, duree: scene.duree, sons, volume: VOLUME_MIXAGE * (scene.sons.volume ?? 1) });
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
    // rendu normal : 25, 50, 75 % ; vrai pack (long) : une ligne tous les 10 % avec le temps restant estime
    const jalons = new Set(packShader ? [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => Math.floor(n * k / 10)) : [Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75)]);
    const tRendu = Date.now();
    for (let i = 0; i < n; i++) {
      const rgba = await film.dessiner(i, { largeur, hauteur, ssaa });
      if (erreurPipe) break;
      if (!ff.stdin.write(rgba)) await new Promise((ok) => ff.stdin.once('drain', ok));
      if (jalons.has(i)) {
        const ecoule = (Date.now() - tRendu) / 1000, fait = i + 1;
        log(`rendu ${Math.round((fait / n) * 100)} % (${ecoule.toFixed(0)} s${packShader ? `, reste environ ${Math.round(ecoule / fait * (n - fait) / 60 * 10) / 10} min` : ''})`);
      }
    }
    ff.stdin.end();
    await fini;
    return {
      sortie, images: n, duree: scene.duree, secondes: (Date.now() - t0) / 1000, secondesRendu: (Date.now() - tRendu) / 1000,
      corrections: anim.corrections, camera: anim.camera, skins: infos, notes: [...anim.notes, ...plan.notes, ...film.notes], pas: plan.nbPas, evenementsSon: plan.evenements.length,
      memoireMaxMo: Math.round(process.resourceUsage().maxRSS / 1024), taille: fs.statSync(sortie).size,
      ...(packShader ? { echelle, secondesParImage: (Date.now() - tRendu) / 1000 / n, memoireHoteMo: film.memoireHoteMo?.() ?? null, chauffe: film.chauffe?.() ?? null, tempsParImage: film.stats && film.stats.images ? { hoteMs: Math.round(film.stats.hoteMs / film.stats.images), transfertMs: Math.round(film.stats.transfertMs / film.stats.images * 10) / 10, nodeMs: Math.round(film.stats.nodeMs / film.stats.images) } : null } : {}),
    };
  } finally {
    await film.fermer();
    if (tmpAudio) fs.rmSync(tmpAudio, { force: true });
  }
}

// Une seule image de la scene, petite et filigranee, SANS jeton (mcanim apercu). Ecrit un PNG ; retourne { sortie, image, t, taille, secondes }.
//   t : secondes (0 a la duree). taille : "WxH" (640 de large au plus). Le rendu complet, lui, demande toujours un jeton.
export async function apercuImage({ scene, zonePath, kitDir, t, sortie, taille, surcharges = {}, baseDir = process.cwd(), env = process.env, shader, packShader, optionsPack, echelle = 1, log = () => {} }) {
  const t0 = Date.now();
  if (!(t >= 0 && t <= scene.duree)) throw new Error(`--t : entre 0 et ${scene.duree} secondes (duree de la scene)`);
  const [largeur, hauteur] = tailleApercu(taille, scene);
  // vrai pack : l'image est calculee directement a la taille de l'apercu (avec la chauffe en cache, ou 16 images si le pack est nouveau)
  const film = packShader
    ? await (async () => {
      const pf = await import('../pack/film.js');
      const chemin = path.resolve(packShader);
      const n = pf.lireCacheChauffe(pf.cleChauffe(chemin, optionsPack?.surcharges)) ?? 16;
      return preparerFilmReel({ scene: { ...scene, largeur, hauteur }, zonePath, kitDir, surcharges, baseDir, env, packShader, echelle, optionsPack, log, chauffe: n });
    })()
    : await preparerFilm({ scene, zonePath, kitDir, surcharges, baseDir, env, travailleurs: 0, shader });
  try {
    const i = Math.min(film.anim.images.length - 1, Math.round(t * 30));
    const rgba = await film.dessiner(i, { largeur, hauteur, copie: true });
    filigrane(rgba, largeur, hauteur);
    fs.mkdirSync(path.dirname(sortie), { recursive: true });
    fs.writeFileSync(sortie, encoderPNG({ largeur, hauteur, rgba }));
    return { sortie, image: i, t: film.anim.images[i].t, taille: [largeur, hauteur], secondes: (Date.now() - t0) / 1000, skins: film.infos, notes: [...film.anim.notes, ...film.notes] };
  } finally { await film.fermer(); }
}
