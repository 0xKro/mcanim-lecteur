#!/usr/bin/env node
// mcanim : lecteur d'animations Minecraft. Commandes (voir docs/CONCEPTION.md, partie 7) :
//   mcanim terrain <zone> [--pas N] [--chemin x1,z1,x2,z2]
//   mcanim empreinte <scene.json>
//   mcanim rendre <scene.json> --jeton <jeton> [--sortie f.mp4] [--pack pack.zip] [--skin nom=fichier.png]
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

const AIDE = `mcanim : de la scene au MP4 (personnages Minecraft dans un vrai terrain)
  mcanim terrain <zone> [--pas 8]     telecharge la zone et le kit, resume du terrain (chemins, clairieres, eau)
  mcanim terrain <zone> --chemin x1,z1,x2,z2   verifie un trajet droit : libre, ou premier obstacle
  mcanim empreinte <scene.json>       controle la scene, affiche empreinte et duree
  mcanim rendre <scene.json> --jeton <jeton> [--sortie f.mp4] [--pack pack.zip] [--skin nom=fichier.png]
  mcanim kit                          recupere le kit de base
  (options de rendre : --ssaa 2 pour un rendu plus lisse, 3 fois plus lent)`;

class Usage extends Error {}

// Lecture d'un fichier de scene avec un message clair s'il manque.
function lireTexte(chemin) {
  try { return fs.readFileSync(chemin, 'utf8'); } catch (e) { throw new Usage(`fichier illisible : ${chemin} (${e.code === 'ENOENT' ? 'introuvable' : e.message})`); }
}

function lireArgs(argv, { valeurs = [], multiples = [] } = {}) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const nom = a.slice(2);
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
  const { pos, opt } = lireArgs(argv, { valeurs: ['jeton', 'sortie', 'pack', 'ssaa'], multiples: ['skin'] });
  if (pos.length !== 1) throw new Usage('usage : mcanim rendre <scene.json> --jeton <jeton> [--sortie f.mp4] [--pack pack.zip] [--skin nom=fichier.png]');
  if (!opt.jeton) throw new Usage('il faut un jeton : --jeton <jeton> (obtenu avec autoriser_scene)');
  const surcharges = {};
  for (const s of opt.skin || []) {
    const i = s.indexOf('=');
    if (i < 1) throw new Usage(`--skin attend nom=fichier.png (recu : ${s})`);
    surcharges[s.slice(0, i)] = s.slice(i + 1);
  }
  const ssaa = opt.ssaa ? Number(opt.ssaa) : 1;
  if (![1, 2].includes(ssaa)) throw new Usage('--ssaa : 1 ou 2');
  const t0 = Date.now();

  // 1. scene et jeton : rien n'est telecharge ni calcule si l'un des deux est mauvais
  const { brut, scene } = lireScene(lireTexte(pos[0]));
  for (const nom of Object.keys(surcharges)) if (!scene.acteurs.some((a) => a.nom === nom)) throw new Usage(`--skin : aucun acteur nomme "${nom}"`);
  const e = empreinte(brut);
  const charge = verifierJeton(opt.jeton, { empreinte: e, duree: scene.duree, zone: scene.zone });

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
  const r = await rendreVideo({ scene, zonePath: zone.chemin, kitDir: kit, sortie, surcharges, log: dire, ssaa });

  const repli = r.skins.filter((s) => s.repli);
  const notes = [...r.notes];
  if (repli.length) notes.push(noteSkinsDeRepli(repli));
  if (notes.length) dire('notes : ' + notes.join(' ; '));
  dire(`OK ${sortie} | ${r.duree} s | ${r.images} images | ${sec(r.secondes * 1000)} s de calcul | ${resumeCamera(r.camera, r.images) ?? 'camera sans correction'} | skins de repli : ${repli.length} | ${(r.taille / 1048576).toFixed(1)} Mo | memoire max ${r.memoireMaxMo} Mo`);
}

async function main() {
  const [cmd, ...reste] = process.argv.slice(2);
  switch (cmd) {
    case 'terrain': return commandeTerrain(reste);
    case 'empreinte': return commandeEmpreinte(reste);
    case 'rendre': return commandeRendre(reste);
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
