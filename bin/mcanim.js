#!/usr/bin/env node
// mcanim : lecteur d'animations Minecraft. Commandes (voir docs/CONCEPTION.md, partie 7) :
//   mcanim terrain <zone> [--pas N] [--chemin x1,z1,x2,z2]
//   mcanim empreinte <scene.json>
//   mcanim rendre <scene.json> --jeton <jeton> [--sortie f.mp4] [--pack pack.zip] [--skin nom=fichier.png]
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
import { obtenirZone, trouverKit, appliquerPack } from '../src/film/cache.js';
import { verifierFichiers } from '../src/film/fichiers.js';
import { textZonesSkin } from '../src/perso/zones.js';
import { encoderPNG, decoderPNG } from '../src/rendu/png.js';
import { lireShader, ErreurShader } from '../src/shader/format.js';
import { texteGuide, texteFamille, verifierTexte } from '../src/shader/guide.js';

const AIDE = `mcanim : de la scene au MP4 (personnages Minecraft dans un vrai terrain)
  mcanim terrain <zone> [--pas 8]     telecharge la zone et le kit, resume du terrain (chemins, clairieres, eau)
  mcanim terrain <zone> --chemin x1,z1,x2,z2   verifie un trajet droit : libre, ou premier obstacle
  mcanim empreinte <scene.json>       controle la scene, affiche empreinte et duree
  mcanim rendre <scene.json> --jeton <jeton> [--sortie f.mp4] [--pack pack.zip] [--skin nom=fichier.png] [--shader shader.json]
  mcanim apercu <scene.json> --t 3.5 [--sortie a.png] [--taille 640x360] [--shader shader.json]   UNE image de la scene, petite, filigranee, SANS jeton
                                      (verifie couleurs, masques, cadrage avant de payer ; le rendu complet exige le jeton)
  mcanim skin <ref> [--sortie skin.png] [--zones]   exporte le skin 64x64 (a retoucher) et affiche ou sont visage, cheveux, corps
  mcanim texture <jeu/chemin> [--sortie f.png]      exporte une texture du jeu (ex. block/oak_leaves) a retoucher
  mcanim shader --guide               reference courte pour traduire un pack de shaders en shader.json (cles, methode)
  mcanim shader --cles <famille>      une famille de cles en detail (ex. ciel, lumiere, eau)
  mcanim shader --verifier f.json     controle un shader.json : erreur avec le chemin de la cle, cles ignorees
  mcanim shader --extraire pack.zip [--sortie dossier]   resume court des reglages d'un pack .zip (profils, options, const)
  mcanim shader --exemples            ou sont shader-leger.json et shader-tout.json
  mcanim kit                          recupere le kit de base
  (options de rendre : --ssaa 2 pour un rendu plus lisse, 3 fois plus lent)
  --shader shader.json : ombres du soleil, ciel, brume, rayons de lumiere, bloom, eau, feuilles qui bougent... (format : docs/FORMAT-SHADER.md ;
                         exemples : exemples/shader-leger.json, shader-tout.json ; ou le champ de scene "shader": "shader.json", chemin relatif a la scene ; l'option l'emporte)
  champs de scene facultatifs : image, ciel, gel, textures, shader ; acteur : skins, masque, lueur, horsImage, coudeD coudeG genouD genouG appui (fiches du site)`;

class Usage extends Error {}

// Shader : fichier de l'option --shader (relatif au dossier courant) ou champ `shader` de la scene (relatif a la scene). Controle complet avant tout
// telechargement ; retourne le chemin a donner au rendu (ou null).
function controlerShader(scene, baseDir, option) {
  const f = option ? path.resolve(option) : scene.shader ? path.resolve(baseDir, scene.shader) : null;
  if (!f) return null;
  try { lireShader(lireTexte(f)); } catch (e) { if (e instanceof ErreurShader) throw new Usage(e.message); throw e; }
  return f;
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
    if (seg) dire(rs.verifierChemin(...seg));
    else {
      dire(JSON.stringify(rs.resumeTerrain(pas ? { pas } : undefined)));
      dire("Fais marcher l'acteur le long d'un des chemins ; hors chemin, il traversera des arbres.");
    }
    dire(`(${sec(Date.now() - t0)} s)`);
  } finally { await rs.fermer(); }
}

async function commandeEmpreinte(argv) {
  const { pos } = lireArgs(argv);
  if (pos.length !== 1) throw new Usage('usage : mcanim empreinte <scene.json>');
  const { brut, scene } = lireScene(lireTexte(pos[0]));
  dire(`empreinte ${empreinte(brut)} | duree ${scene.duree} s | ${scene.format} | ${scene.acteurs.length} acteur(s) | ${scene.images} images`);
}

async function commandeRendre(argv) {
  const { pos, opt } = lireArgs(argv, { valeurs: ['jeton', 'sortie', 'pack', 'ssaa', 'shader'], multiples: ['skin'] });
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
  const r = await rendreVideo({ scene, zonePath: zone.chemin, kitDir: kit, sortie, surcharges, baseDir, log: dire, ssaa, shader });

  const repli = r.skins.filter((s) => s.repli);
  const notes = [...r.notes];
  if (repli.length) notes.push(noteSkinsDeRepli(repli));
  if (notes.length) dire('notes : ' + notes.join(' ; '));
  dire(`OK ${sortie} | ${r.duree} s | ${r.images} images | ${sec(r.secondes * 1000)} s de calcul | ${resumeCamera(r.camera, r.images) ?? 'camera sans correction'} | skins de repli : ${repli.length} | ${(r.taille / 1048576).toFixed(1)} Mo | memoire max ${r.memoireMaxMo} Mo`);
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
  const { pos, opt } = lireArgs(argv, { valeurs: ['t', 'sortie', 'taille', 'pack', 'skin', 'shader'] });
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
  const zone = await obtenirZone(scene.zone);
  let kit = await trouverKit({});
  if (opt.pack) kit = await appliquerPack(kit, path.resolve(opt.pack));
  const sortie = path.resolve(opt.sortie || 'apercu.png');
  const { apercuImage } = await import('../src/film/video.js');
  const r = await apercuImage({ scene, zonePath: zone.chemin, kitDir: kit, t, sortie, taille: opt.taille, surcharges, baseDir, shader }).catch((e) => { if (/^--(t|taille)/.test(e.message)) throw new Usage(e.message); throw e; });
  const repli = r.skins.filter((s) => s.repli);
  dire(`apercu ${r.sortie} | t=${r.t.toFixed(2)} s (image ${r.image}) | ${r.taille.join('x')} | ${sec(Date.now() - t0)} s | filigrane : ce n'est PAS le rendu final, mcanim rendre demande un jeton`);
  const notesA = (r.notes || []).filter((n) => /^options non prises/.test(n));
  if (repli.length) notesA.push(noteSkinsDeRepli(repli));
  if (notesA.length) dire('notes : ' + notesA.join(' ; '));
}

// Aide au traducteur de packs de shaders : tout est du texte court, rien n'est telecharge.
async function commandeShader(argv) {
  const { opt } = lireArgs(argv, { valeurs: ['cles', 'verifier', 'extraire', 'sortie'], drapeaux: ['guide', 'exemples'] });
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
    return dire(r.texte);
  }
  if (opt.exemples) {
    const d = path.resolve(fileURLToPath(new URL('../exemples/', import.meta.url)));
    return dire(`exemples (a copier puis modifier) :
${path.join(d, 'shader-leger.json')}   ombres, bloom, vignette, feuilles : ~ +25 % de temps de rendu
${path.join(d, 'shader-tout.json')}   toutes les familles du palier 1 : ~ +55 %`);
  }
  throw new Usage('usage : mcanim shader --guide | --cles <famille> | --verifier shader.json | --extraire pack.zip [--sortie dossier] | --exemples');
}

async function main() {
  const [cmd, ...reste] = process.argv.slice(2);
  switch (cmd) {
    case 'terrain': return commandeTerrain(reste);
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
