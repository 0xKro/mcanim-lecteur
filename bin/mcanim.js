#!/usr/bin/env node
// mcanim : lecteur d'animations Minecraft. Commandes (voir docs/CONCEPTION.md, partie 7) :
//   mcanim terrain <zone> [--pas N] [--chemin x1,z1,x2,z2]
//   mcanim trajet <scene.json>
//   mcanim empreinte <scene.json>
//   mcanim rendre <scene.json> --jeton <jeton> [--sortie f.mp4] [--pack pack.zip] [--skin nom=fichier.png]
//        [--pack-shader pack.zip [--echelle 1|0.5] [--profil NOM] [--option NOM=VALEUR ...] [--repli]]   (vrai pack de shaders, plus lent)
//   mcanim skin <ref> [--sortie skin.png] [--zones] [--modele wide|slim]
//   mcanim texture <jeu/chemin> [--sortie f.png] [--pack pack.zip]
//   mcanim apercu <scene.json> --t 3.5 [--sortie a.png] [--taille 640x360] [--pack pack.zip]
//   mcanim shader --guide | --cles <famille> | --verifier f.json | --extraire pack.zip [--sortie dossier] | --exemples
//   mcanim kit
// Les sorties sont COURTES (elles coutent des tokens au client) ; en cas d'echec : message sur stderr, code non nul.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lireScene } from '../src/film/scene.js';
import { empreinte } from '../src/film/empreinte.js';
import { verifierJeton } from '../src/film/jeton.js';
import { noteSkinsDeRepli } from '../src/perso/skin.js';
import { resumeCamera } from '../src/film/camera.js';
import { obtenirZone, trouverKit, appliquerPack, dossierCache } from '../src/film/cache.js';
import { verifierFichiers } from '../src/film/fichiers.js';
import { textZonesSkin } from '../src/perso/zones.js';
import { encoderPNG, decoderPNG } from '../src/rendu/png.js';
import { lireShader, ErreurShader } from '../src/shader/format.js';
import { texteGuide, texteFamille, verifierTexte } from '../src/shader/guide.js';
import { texteTrajets, trajetsDeScene, compterEvenements, profilSegment } from '../src/film/trajet.js';
import { terrainDepuis } from '../src/film/physique.js';
import { lireReglages, preparerOptions, nonGere, ErreurPack } from '../src/shader/reglages.js';
import { noteAmplitudes } from '../src/film/limites.js';   // articulations libres : amplitudes hors plausible (une ligne)
import { animer } from '../src/film/scene.js';

const AIDE = `mcanim : de la scene au MP4 (personnages Minecraft dans un vrai terrain)
  mcanim terrain <zone> [--pas 8]     telecharge la zone et le kit, resume du terrain (chemins, clairieres, eau)
  mcanim terrain <zone> --chemin x1,z1,x2,z2   verifie un trajet droit : libre, ou premier obstacle
  mcanim trajet <scene.json>          ce qui arrive aux acteurs sur leur chemin : saut, chute, eau, echelle, marches, mur, vitesses ; gratuit, court
  mcanim empreinte <scene.json>       controle la scene, affiche empreinte et duree
  mcanim rendre <scene.json> --jeton <jeton> [--sortie f.mp4] [--pack pack.zip] [--skin nom=fichier.png] [--shader shader.json]
  mcanim rendre ... --pack-shader pack.zip [--echelle 1|0.5] [--profil NOM] [--option NOM=VALEUR ...] [--repli]   VRAI pack de shaders (le code du pack tourne sur
                                      un OpenGL logiciel ; lent : quelques secondes par image ; 0.5 = le pack tourne a mi-taille puis l'image est agrandie)
  mcanim apercu <scene.json> --t 3.5 [--sortie a.png] [--taille 640x360] [--shader shader.json | --pack-shader pack.zip ...]   UNE image de la scene, petite, filigranee, SANS jeton
                                      (verifie couleurs, masques, cadrage avant de payer ; le rendu complet exige le jeton)
  mcanim skin <ref> [--sortie skin.png] [--zones]   exporte le skin 64x64 (a retoucher) et affiche ou sont visage, cheveux, corps
  mcanim texture <jeu/chemin> [--sortie f.png]      exporte une texture du jeu (ex. block/oak_leaves) a retoucher
  mcanim shader --guide               reference courte pour traduire un pack de shaders en shader.json (cles, methode)
  mcanim shader --cles <famille>      une famille de cles en detail (ex. ciel, lumiere, eau)
  mcanim shader --verifier f.json     controle un shader.json : erreur avec le chemin de la cle, cles ignorees
  mcanim shader --extraire pack.zip [--sortie dossier]   resume court des reglages d'un pack .zip (profils, options, const) ; memes noms pour --profil / --option
  mcanim shader --diagnostic          peut-on rendre avec un VRAI pack de shaders ici ? (moteur OpenGL logiciel, version, limites ; 4 lignes)
  mcanim shader --exemples            ou sont shader-leger.json et shader-tout.json
  mcanim kit                          recupere le kit de base
  (options de rendre : --ssaa 2 pour un rendu plus lisse, 3 fois plus lent)
  --shader shader.json : ombres du soleil, ciel, brume, rayons de lumiere, bloom, eau, feuilles qui bougent... (format : docs/FORMAT-SHADER.md ;
                         exemples : exemples/shader-leger.json, shader-tout.json ; ou le champ de scene "shader": "shader.json", chemin relatif a la scene ; l'option l'emporte)
  champs de scene facultatifs : image, ciel, gel, textures, shader, packShader (pack .zip, chemin relatif a la scene) ; acteur : skins, masque, lueur, horsImage, coudeD coudeG genouD genouG appui (fiches du site)
  hauteur automatique (physique du jeu : saut 0.42, gravite 0.08, pas de 0.6, chute, eau, echelle) a partir de pos [t,x,z] ; acteur : bascule [t,deg] roulis [t,deg]
  (corps entier autour des hanches, 90 = a plat) hauteur [t,blocs] (decalage vertical) reactions:false (coupe les reactions automatiques du corps)
  membres libres : brasD brasG jambeD jambeG [t,avant,cote,torsion] (cote < 0 : croise le corps ; torsion > 0 : rotation interne), tete [t,lacet,tangage,roulis],
  corps [t,penche,cote,torsion] (haut du corps autour des hanches), mainD mainG piedD piedG [t,cible,poids] (cible : point du corps, [droite,haut,avant] ou {"monde":[x,y,z]} ;
  null = relache), coudeVers genouVers [t,dehors,haut,avant], souple:true (pas de note d'amplitude) ; fiches articulations et mains ; mcanim empreinte / trajet signalent les amplitudes hors plausible`;

class Usage extends Error {}

// Shader : fichier de l'option --shader (relatif au dossier courant) ou champ `shader` de la scene (relatif a la scene). Controle complet avant tout
// telechargement ; retourne le chemin a donner au rendu (ou null).
function controlerShader(scene, baseDir, option) {
  const f = option ? path.resolve(option) : scene.shader ? path.resolve(baseDir, scene.shader) : null;
  if (!f) return null;
  try { lireShader(lireTexte(f)); } catch (e) { if (e instanceof ErreurShader) throw new Usage(e.message); throw e; }
  return f;
}

// Vrai pack de shaders (--pack-shader, ou champ `packShader` de la scene) : controle complet AVANT tout telechargement. Retourne null (pas de pack reel)
// ou { chemin, echelle, optionsPack, resume[], nonGere[] }. Si le rendu reel est impossible ici : erreur d'une ligne, ou (avec --repli) null apres l'avoir dit.
async function controlerPackShader(scene, baseDir, opt, dire) {
  const chemin = opt['pack-shader'] ? path.resolve(opt['pack-shader']) : scene.packShader ? path.resolve(baseDir, scene.packShader) : null;
  if (!chemin) {
    if (opt.profil !== undefined || opt.option || opt.echelle !== undefined) throw new Usage('--profil, --option et --echelle demandent --pack-shader pack.zip (ou le champ "packShader" de la scene)');
    return null;
  }
  let echelle = 1;
  if (opt.echelle !== undefined) { echelle = Number(opt.echelle); if (![1, 0.5].includes(echelle)) throw new Usage('--echelle : 1 (pleine taille, defaut) ou 0.5 (le pack tourne a mi-taille puis l\'image est agrandie)'); }
  let reglages;
  try { reglages = await lireReglages(chemin); } catch (e) { if (e instanceof ErreurPack) throw new Usage(e.message); throw e; }
  let r;
  try { r = preparerOptions(reglages, { profil: opt.profil, valeurs: opt.option || [] }); } catch (e) { if (e instanceof ErreurPack) throw new Usage(e.message); throw e; } finally { reglages.nettoyer(); }
  const manque = nonGere(reglages);
  const { diagnostic } = await import('../src/pack/hote.js');
  const d = diagnostic();
  if (!d.ok) {
    if (opt.repli) { dire(`rendu avec un vrai pack impossible ici (${d.raison}) ; --repli : je continue avec le rendu de base`); return null; }
    throw new Usage(`rendu avec un vrai pack impossible ici : ${d.raison}. Rien n'est rendu ; pour continuer avec notre rendu approximatif, relance avec --repli (ou avec --shader shader.json)`);
  }
  return { chemin, echelle, optionsPack: { surcharges: r.surcharges }, resume: r.resume, nonGere: manque };
}

// Lecture d'un fichier de scene avec un message clair s'il manque.
function lireTexte(chemin) {
  try { return fs.readFileSync(chemin, 'utf8'); } catch (e) { throw new Usage(`fichier illisible : ${chemin} (${e.code === 'ENOENT' ? 'introuvable' : e.message})`); }
}

function lireArgs(argv, { valeurs = [], multiples = [], drapeaux = [] } = {}) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const nom = a.slice(2);
      if (drapeaux.includes(nom)) { opt[nom] = true; continue; }
      if (![...valeurs, ...multiples].includes(nom)) throw new Usage(`option inconnue : ${a}`);
      if (i + 1 >= argv.length) throw new Usage(`l'option ${a} attend une valeur`);
      const v = argv[++i];
      if (multiples.includes(nom)) (opt[nom] ||= []).push(v); else opt[nom] = v;
    } else pos.push(a);
  }
  return { pos, opt };
}

const dire = (m) => console.log(m);
const sec = (ms) => (ms / 1000).toFixed(1);

async function commandeKit() {
  const t = Date.now();
  const dir = await trouverKit({});
  dire(`kit pret : ${dir} (${sec(Date.now() - t)} s)`);
}

async function commandeTerrain(argv) {
  const { pos, opt } = lireArgs(argv, { valeurs: ['pas', 'chemin'] });
  if (pos.length !== 1) throw new Usage('usage : mcanim terrain <zone> [--pas N] [--chemin x1,z1,x2,z2]');
  let seg = null;
  if (opt.chemin !== undefined) {
    seg = opt.chemin.split(',').map(Number);
    if (seg.length !== 4 || seg.some((v) => !Number.isFinite(v))) throw new Usage('--chemin : quatre nombres x1,z1,x2,z2 (ex. --chemin -262,-656,-218,-656)');
  }
  const t0 = Date.now();
  const pas = opt.pas ? Number(opt.pas) : undefined;
  if (pas !== undefined && !(pas >= 1 && pas <= 64)) throw new Usage('--pas : nombre entre 1 et 64');
  let chemin;
  if (/\.mcz$/i.test(pos[0]) && fs.existsSync(pos[0])) chemin = path.resolve(pos[0]);
  else chemin = (await obtenirZone(pos[0])).chemin;
  const kit = await trouverKit({});
  const { chargerScene } = await import('../src/rendu/scene.js');
  const rs = await chargerScene({ zonePath: chemin, kitDir: kit, travailleurs: 0 });
  try {
    if (seg) { dire(rs.verifierChemin(...seg)); const profil = profilSegment(terrainDepuis(rs), ...seg); if (profil) dire(profil); }
    else {
      dire(JSON.stringify(rs.resumeTerrain(pas ? { pas } : undefined)));
      dire("Fais marcher l'acteur le long d'un des chemins ; hors chemin, il traversera des arbres.");
    }
    dire(`(${sec(Date.now() - t0)} s)`);
  } finally { await rs.fermer(); }
}

// Le terrain de la zone de la scene, pour la simulation du trajet. `telecharger` faux : seulement le cache local (sinon null).
async function terrainDeScene(scene, { telecharger }) {
  const cache = path.join(dossierCache(), 'zones', `${scene.zone}.mcz`);
  if (!telecharger && !fs.existsSync(cache)) return null;
  const zone = await obtenirZone(scene.zone);
  const kit = await trouverKit({});
  const { chargerScene } = await import('../src/rendu/scene.js');
  const rs = await chargerScene({ zonePath: zone.chemin, kitDir: kit, travailleurs: 0 });
  return { rs, terrain: terrainDepuis(rs) };
}

// Ce qui arrive aux acteurs sur leur chemin (gratuit, comme terrain et empreinte).
async function commandeTrajet(argv) {
  const { pos } = lireArgs(argv);
  if (pos.length !== 1) throw new Usage('usage : mcanim trajet <scene.json>');
  const { scene } = lireScene(lireTexte(pos[0]));
  const t = await terrainDeScene(scene, { telecharger: true });
  try { dire(texteTrajets(scene, t.terrain)); } finally { await t.rs.fermer(); }
}

async function commandeEmpreinte(argv) {
  const { pos } = lireArgs(argv);
  if (pos.length !== 1) throw new Usage('usage : mcanim empreinte <scene.json>');
  const { brut, scene } = lireScene(lireTexte(pos[0]));
  dire(`empreinte ${empreinte(brut)} | duree ${scene.duree} s | ${scene.format} | ${scene.acteurs.length} acteur(s) | ${scene.images} images`);
  try { const n = noteAmplitudes(scene, animer(scene)); if (n) dire(n); } catch { /* la note d'amplitudes est facultative */ }
  // meme simulation que le rendu : combien d'evenements de trajet (zone deja dans le cache seulement ; jamais d'erreur ici)
  try {
    const t = await terrainDeScene(scene, { telecharger: false });
    if (t) {
      try {
        const c = compterEvenements(trajetsDeScene(scene, t.terrain));
        dire(`trajet : ${c.evenements} evenement(s)${c.vitesses ? `, ${c.vitesses} vitesse(s) a revoir` : ''} (saut, chute, eau, echelle, mur) -> mcanim trajet ${path.basename(pos[0])}`);
      } finally { await t.rs.fermer(); }
    }
  } catch { /* la ligne de trajet est facultative */ }
}

async function commandeRendre(argv) {
  const { pos, opt } = lireArgs(argv, { valeurs: ['jeton', 'sortie', 'pack', 'ssaa', 'shader', 'pack-shader', 'echelle', 'profil'], multiples: ['skin', 'option'], drapeaux: ['repli'] });
  if (pos.length !== 1) throw new Usage('usage : mcanim rendre <scene.json> --jeton <jeton> [--sortie f.mp4] [--pack pack.zip] [--skin nom=fichier.png]');
  if (!opt.jeton) throw new Usage('il faut un jeton : --jeton <jeton> (obtenu avec autoriser_scene)');
  const surcharges = {};
  for (const s of opt.skin || []) {
    const i = s.indexOf('=');
    if (i < 1) throw new Usage(`--skin attend nom=fichier.png (recu : ${s})`);
    surcharges[s.slice(0, i)] = path.resolve(s.slice(i + 1));    // relatif au dossier courant (pas a la scene)
  }
  const ssaa = opt.ssaa ? Number(opt.ssaa) : 1;
  if (![1, 2].includes(ssaa)) throw new Usage('--ssaa : 1 ou 2');
  const t0 = Date.now();

  // 1. scene et jeton : rien n'est telecharge ni calcule si l'un des deux est mauvais
  const { brut, scene } = lireScene(lireTexte(pos[0]));
  for (const nom of Object.keys(surcharges)) if (!scene.acteurs.some((a) => a.nom === nom)) throw new Usage(`--skin : aucun acteur nomme "${nom}"`);
  const e = empreinte(brut);
  const charge = verifierJeton(opt.jeton, { empreinte: e, duree: scene.duree, zone: scene.zone });
  const baseDir = path.dirname(path.resolve(pos[0]));
  verifierFichiers(scene, baseDir, surcharges);   // PNG cites par la scene (masque, textures, skins) : avant tout telechargement
  const shader = controlerShader(scene, baseDir, opt.shader);
  const reel = await controlerPackShader(scene, baseDir, opt, dire);

  // 2. zone, kit, pack
  const zone = await obtenirZone(scene.zone, { zh: charge.zh });
  verifierJeton(opt.jeton, { empreinte: e, duree: scene.duree, zone: scene.zone, zoneSha256: zone.sha256 });
  let kit = await trouverKit({});
  if (opt.pack) kit = await appliquerPack(kit, path.resolve(opt.pack));
  dire(`jeton ok, zone prete${opt.pack ? ', pack applique' : ''} (${sec(Date.now() - t0)} s)`);

  // 3. rendu
  const sortie = path.resolve(opt.sortie || path.basename(pos[0]).replace(/\.json$/i, '') + '.mp4');
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  const { rendreVideo } = await import('../src/film/video.js');
  if (reel) dire(`vrai pack de shaders : ${path.basename(reel.chemin)}, echelle ${reel.echelle}${reel.resume.length ? ', ' + reel.resume.join(' ') : ''} ; non gere : ${reel.nonGere.join(' ; ')}`);
  const r = await rendreVideo({ scene, zonePath: zone.chemin, kitDir: kit, sortie, surcharges, baseDir, log: dire, ssaa, shader: reel ? null : shader, ...(reel ? { packShader: reel.chemin, echelle: reel.echelle, optionsPack: reel.optionsPack } : {}) });

  const repli = r.skins.filter((s) => s.repli);
  const notes = [...r.notes];
  if (repli.length) notes.push(noteSkinsDeRepli(repli));
  if (notes.length) dire('notes : ' + notes.join(' ; '));
  dire(`OK ${sortie} | ${r.duree} s | ${r.images} images | ${sec(r.secondes * 1000)} s de calcul | ${resumeCamera(r.camera, r.images) ?? 'camera sans correction'} | skins de repli : ${repli.length} | ${(r.taille / 1048576).toFixed(1)} Mo | memoire max ${r.memoireMaxMo} Mo${reel ? ` | pack : ${r.secondesParImage.toFixed(2)} s par image, hote ${r.memoireHoteMo ?? '?'} Mo, chauffe ${r.chauffe} images${r.tempsParImage ? `, par image : hote ${r.tempsParImage.hoteMs} ms + transfert ${r.tempsParImage.transfertMs} ms + Node ${r.tempsParImage.nodeMs} ms` : ''}` : ''}`);
}

// Skin d'un acteur exporte en PNG 64x64 (ancien format 64x32 deja converti) + disposition des parties : pour le retoucher.
async function commandeSkin(argv) {
  const { pos, opt } = lireArgs(argv, { valeurs: ['sortie', 'modele', 'pack'], drapeaux: ['zones'] });
  if (opt.modele !== undefined && !['wide', 'slim'].includes(opt.modele)) throw new Usage('--modele : "wide" ou "slim"');
  if (opt.zones) { dire(textZonesSkin(opt.modele ?? 'wide')); return; }
  if (pos.length !== 1) throw new Usage('usage : mcanim skin <skin> [--sortie skin.png] [--zones]   (skin : pseudo, "steve", "@identifiant" ou fichier.png)');
  let kit = await trouverKit({});
  if (opt.pack) kit = await appliquerPack(kit, path.resolve(opt.pack));
  const { resoudreSkin } = await import('../src/perso/skin.js');
  const r = await resoudreSkin({ description: pos[0], modele: opt.modele ?? null, kitDir: kit, baseDir: process.cwd() });
  const sortie = path.resolve(opt.sortie || 'skin.png');
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  fs.writeFileSync(sortie, encoderPNG({ largeur: 64, hauteur: 64, rgba: r.rgba }));
  dire(`skin ecrit : ${sortie} (64x64, modele ${r.modele}, ${r.origine}${r.repli ? ' de repli' : ''} : ${r.detail})`);
  dire(textZonesSkin(r.modele));
}

// Une texture du jeu exportee en PNG, pour la retoucher puis la declarer dans le champ `textures` de la scene.
async function commandeTexture(argv) {
  const { pos, opt } = lireArgs(argv, { valeurs: ['sortie', 'pack'] });
  if (pos.length !== 1) throw new Usage('usage : mcanim texture <chemin du jeu> [--sortie f.png]   (ex. block/oak_leaves, entity/player/wide/steve)');
  const nom = pos[0].replace(/^minecraft:/, '').replace(/\.png$/i, '');
  if (!/^[a-z0-9_-]+(\/[a-z0-9_-]+)+$/.test(nom)) throw new Usage('nom de texture attendu : dossier/nom, par exemple block/oak_leaves');
  let kit = await trouverKit({});
  if (opt.pack) kit = await appliquerPack(kit, path.resolve(opt.pack));
  const racine = path.join(kit, 'assets', 'minecraft', 'textures');
  const f = path.join(racine, ...nom.split('/')) + '.png';
  if (!fs.existsSync(f)) {
    const fin = nom.split('/').pop(), proches = [];
    const marche = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) marche(path.join(d, e.name), r); else if (e.name.endsWith('.png') && e.name.includes(fin) && proches.length < 8) proches.push(r.slice(0, -4)); } };
    marche(racine, '');
    throw new Usage(`texture inconnue : ${nom}${proches.length ? ' ; noms proches : ' + proches.join(', ') : ''}`);
  }
  const octets = fs.readFileSync(f);
  const im = decoderPNG(octets);
  let anim = '';
  try { const m = JSON.parse(fs.readFileSync(f + '.mcmeta', 'utf8')); if (m.animation) anim = ` ; animee : ${Math.floor(im.hauteur / (m.animation.height || m.animation.width || im.largeur))} images empilees (garde la meme hauteur)`; } catch { /* pas anime */ }
  const sortie = path.resolve(opt.sortie || nom.split('/').pop() + '.png');
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  fs.writeFileSync(sortie, octets);
  dire(`texture ecrite : ${sortie} (${im.largeur}x${im.hauteur}${anim})`);
  dire(`pour la remplacer : "textures": {"${nom}": "${path.basename(sortie)}"} dans la scene (PNG de meme taille, multiple ou puissance de 2, 1024 au plus)`);
}

// Une image de la scene a l'instant t, sans jeton : petite, avec un filigrane. Le rendu complet (mcanim rendre) exige toujours un jeton.
async function commandeApercu(argv) {
  const { pos, opt } = lireArgs(argv, { valeurs: ['t', 'sortie', 'taille', 'pack', 'skin', 'shader', 'pack-shader', 'echelle', 'profil'], multiples: ['option'], drapeaux: ['repli'] });
  if (pos.length !== 1) throw new Usage('usage : mcanim apercu <scene.json> --t 3.5 [--sortie a.png] [--taille 640x360]');
  const t = opt.t === undefined ? 0 : Number(opt.t);
  if (!Number.isFinite(t) || t < 0) throw new Usage('--t : un nombre de secondes >= 0, par exemple --t 3.5');
  const t0 = Date.now();
  const { scene } = lireScene(lireTexte(pos[0]));
  const baseDir = path.dirname(path.resolve(pos[0]));
  const surcharges = {};
  if (opt.skin) { const i = opt.skin.indexOf('='); if (i < 1) throw new Usage('--skin attend nom=fichier.png'); surcharges[opt.skin.slice(0, i)] = path.resolve(opt.skin.slice(i + 1)); }
  verifierFichiers(scene, baseDir, surcharges);
  const shader = controlerShader(scene, baseDir, opt.shader);
  const reel = await controlerPackShader(scene, baseDir, opt, dire);
  if (reel) dire(`apercu avec un vrai pack de shaders : ${path.basename(reel.chemin)}${reel.resume.length ? ', ' + reel.resume.join(' ') : ''} ; non gere : ${reel.nonGere.join(' ; ')}`);
  const zone = await obtenirZone(scene.zone);
  let kit = await trouverKit({});
  if (opt.pack) kit = await appliquerPack(kit, path.resolve(opt.pack));
  const sortie = path.resolve(opt.sortie || 'apercu.png');
  const { apercuImage } = await import('../src/film/video.js');
  const r = await apercuImage({ scene, zonePath: zone.chemin, kitDir: kit, t, sortie, taille: opt.taille, surcharges, baseDir, shader: reel ? null : shader, ...(reel ? { packShader: reel.chemin, optionsPack: reel.optionsPack, echelle: reel.echelle, log: dire } : {}) }).catch((e) => { if (/^--(t|taille)/.test(e.message)) throw new Usage(e.message); throw e; });
  const repli = r.skins.filter((s) => s.repli);
  dire(`apercu ${r.sortie} | t=${r.t.toFixed(2)} s (image ${r.image}) | ${r.taille.join('x')} | ${sec(Date.now() - t0)} s | filigrane : ce n'est PAS le rendu final, mcanim rendre demande un jeton`);
  const notesA = (r.notes || []).filter((n) => /^options non prises/.test(n));
  if (repli.length) notesA.push(noteSkinsDeRepli(repli));
  if (notesA.length) dire('notes : ' + notesA.join(' ; '));
}

// Aide au traducteur de packs de shaders : tout est du texte court, rien n'est telecharge.
async function commandeShader(argv) {
  const { opt } = lireArgs(argv, { valeurs: ['cles', 'verifier', 'extraire', 'sortie'], drapeaux: ['guide', 'exemples', 'diagnostic'] });
  if (opt.diagnostic) {
    const { diagnostic } = await import('../src/pack/hote.js');
    const d = diagnostic();
    if (!d.ok) throw new Usage(`rendu avec un vrai pack : NON (${d.raison}). Le rendu de base reste disponible.`);
    return dire(d.lignes.join('\n'));
  }
  if (opt.guide) return dire(texteGuide());
  if (opt.cles !== undefined) {
    const r = texteFamille(opt.cles);
    if (!r.ok) throw new Usage(r.texte);
    return dire(r.texte);
  }
  if (opt.verifier !== undefined) {
    const r = verifierTexte(lireTexte(path.resolve(opt.verifier)));
    if (!r.ok) throw new Usage(r.texte);
    return dire(r.texte);
  }
  if (opt.extraire !== undefined) {
    const zip = path.resolve(opt.extraire);
    if (!fs.existsSync(zip)) throw new Usage(`pack introuvable : ${zip}`);
    const sortie = path.resolve(opt.sortie || path.basename(zip).replace(/\.zip$/i, '') + '-extrait');
    const { extraire } = await import('../src/shader/extraire.js');
    let r;
    try { r = await extraire(zip, sortie); } catch (e) { throw new Usage(`pack illisible : ${e.message}`); }
    let note = '';
    try { const rg = await lireReglages(zip); rg.nettoyer(); note = `\nrendu reel (rendre --pack-shader ${path.basename(zip)} [--profil NOM] [--option NOM=VALEUR]) : non gere encore : ${nonGere(rg).join(' ; ')}`; } catch { /* le resume reste valable */ }
    return dire(r.texte + note);
  }
  if (opt.exemples) {
    const d = path.resolve(fileURLToPath(new URL('../exemples/', import.meta.url)));
    return dire(`exemples (a copier puis modifier) :
${path.join(d, 'shader-leger.json')}   ombres, bloom, vignette, feuilles : ~ +25 % de temps de rendu
${path.join(d, 'shader-tout.json')}   toutes les familles du palier 1 : ~ +55 %`);
  }
  throw new Usage('usage : mcanim shader --diagnostic | --guide | --cles <famille> | --verifier shader.json | --extraire pack.zip [--sortie dossier] | --exemples');
}

async function main() {
  const [cmd, ...reste] = process.argv.slice(2);
  switch (cmd) {
    case 'terrain': return commandeTerrain(reste);
    case 'trajet': return commandeTrajet(reste);
    case 'empreinte': return commandeEmpreinte(reste);
    case 'rendre': return commandeRendre(reste);
    case 'skin': return commandeSkin(reste);
    case 'texture': return commandeTexture(reste);
    case 'apercu': return commandeApercu(reste);
    case 'shader': return commandeShader(reste);
    case 'kit': return commandeKit();
    case '--version': case '-v': return dire(JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version);
    case undefined: case 'aide': case '--help': case '-h': return dire(AIDE);
    default: throw new Usage(`commande inconnue : ${cmd}\n${AIDE}`);
  }
}

// On attend que la sortie soit ecrite avant de quitter (tuyaux asynchrones sous Windows).
const quitter = (code) => process.stdout.write('', () => process.exit(code));
main().then(() => quitter(0), (e) => {
  console.error(`erreur : ${e.message}`);
  if (process.env.MCANIM_DEBUG) console.error(e.stack);
  quitter(e instanceof Usage ? 2 : 1);
});
