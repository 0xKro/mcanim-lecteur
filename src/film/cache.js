// Dossier de cache du lecteur, zones, kit de base, pack de ressources.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Net } from '../net.js';
import { ensureKit } from '../index.js';
import { DEFAULT_GROUPS, GROUPES_A_LA_DEMANDE, readInfo } from '../kit.js';
import { FileSource, readCentralDirectory, extractWanted } from '../zip.js';
import { sha256Base64url } from './empreinte.js';
import { dossierKit } from '../rendu/scene.js';
import { decoderPNG } from '../rendu/png.js';

export const BASE_ZONES = 'https://raw.githubusercontent.com/0xKro/mcanim-zones/main';

let AVERTI = false;
function inscriptible(d) {
  try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return true; } catch { return false; }
}
// Dossier de cache : MCANIM_CACHE, sinon ~/.cache/mcanim. S'il n'est pas inscriptible (installation d'un autre utilisateur, disque
// en lecture seule...), on prend un dossier temporaire et on le dit en UNE ligne (sur stderr) avec la marche a suivre.
export function dossierCache(env = process.env) {
  const d = env.MCANIM_CACHE || path.join(os.homedir(), '.cache', 'mcanim');
  if (inscriptible(d)) return d;
  const secours = path.join(os.tmpdir(), 'mcanim-cache');
  if (!inscriptible(secours)) throw new Error(`dossier de cache non inscriptible : ${d} ; choisis-en un avec MCANIM_CACHE=/un/dossier`);
  if (!AVERTI) { AVERTI = true; console.error(`mcanim : cache ${d} non inscriptible, j'utilise ${secours} (pour choisir : MCANIM_CACHE=/un/dossier)`); }
  return secours;
}

// ---------------------------------------------------------------- kit
// Retourne le dossier du kit (<cache>/kit/26.3). MCANIM_KIT : dossier de kit deja pret (essais).
// `groupes` : groupes A LA DEMANDE en plus de ceux de base (kit.js, GROUPES_A_LA_DEMANDE : 'objets', 'armures') ; seuls les manquants
// sont telecharges, une fois, dans le meme cache.
export async function trouverKit({ env = process.env, log = () => {}, groupes = [], evenementsCreatures = null } = {}) {   // evenementsCreatures : sons des creatures de la scene
  if (env.MCANIM_KIT) return dossierKit(env.MCANIM_KIT);
  const { dir, report } = await ensureKit({ cacheDir: path.join(dossierCache(env), 'kit'), route: 'auto', log, ...(groupes.length ? { groups: [...DEFAULT_GROUPS, ...groupes] } : {}), ...(evenementsCreatures ? { evenementsCreatures: [...evenementsCreatures] } : {}) });
  if (!report.complete) throw new Error(`kit de base incomplet (manque : ${(report.missing || []).slice(0, 3).join(', ')}...)`);
  return dir;
}

// ---------------------------------------------------------------- zone
export function adresseZone(id, base = BASE_ZONES) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(id)) throw new Error(`identifiant de zone incorrect : "${id}" (22 caracteres attendus)`);
  return `${base.replace(/\/+$/, '')}/z/${id.slice(0, 2)}/${id}.mcz`;
}

const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Telecharge `url` depuis le relais (ou lit un dossier local si `base` n'est pas une adresse http). Reessaie : GitHub peut
// mettre quelques secondes a servir un fichier tout juste depose (404 passager). Utilise pour les zones et les skins.
async function telechargerRelais(url, base, { essais, attente, quoi }) {
  if (!/^https?:/i.test(base)) return fs.readFileSync(url);      // dossier local (essais) : <dossier>/z/xx/id.mcz
  let derniere;
  for (let i = 0; i < essais; i++) {
    const net = new Net();
    try { return (await net.buffer(url, { retries: 1 })).body; } catch (e) {
      derniere = e;
      if (e.status && e.status !== 404 && e.status < 500) break;
    } finally { net.close(); }
    if (i < essais - 1) await dormir(attente * (i + 1));
  }
  throw new Error(`${quoi} introuvable (${derniere?.message ?? 'erreur reseau'})`);
}

// Telecharge la zone si elle n'est pas deja dans le cache. `zh` (facultatif) : empreinte attendue ; une copie du cache
// qui ne correspond pas est retelechargee une fois. Retourne { chemin, octets, sha256, telechargee }.
export async function obtenirZone(id, { zh, env = process.env, essais = 6, attente = 1500, log = () => {} } = {}) {
  const dossier = path.join(dossierCache(env), 'zones');
  fs.mkdirSync(dossier, { recursive: true });
  const chemin = path.join(dossier, `${id}.mcz`);
  if (fs.existsSync(chemin)) {
    const b = fs.readFileSync(chemin);
    const h = sha256Base64url(b);
    if (!zh || h === zh) return { chemin, octets: b, sha256: h, telechargee: false };
    log('zone en cache differente de celle du jeton : nouveau telechargement');
  }
  const base = env.MCANIM_ZONES || BASE_ZONES;
  const octets = await telechargerRelais(adresseZone(id, base), base, { essais, attente, quoi: `zone ${id}` });
  const tmp = chemin + '.part';
  fs.writeFileSync(tmp, octets);
  fs.renameSync(tmp, chemin);
  return { chemin, octets, sha256: sha256Base64url(octets), telechargee: true };
}

// ---------------------------------------------------------------- skins du relais ("@<id>")
export const ID_SKIN = /^[A-Za-z0-9_-]{22}$/;
export function adresseSkin(id, base = BASE_ZONES) {
  if (!ID_SKIN.test(id)) throw new Error(`identifiant de skin incorrect : "@${id}" (22 caracteres attendus apres @)`);
  return `${base.replace(/\/+$/, '')}/s/${id.slice(0, 2)}/${id}.png`;
}

// Telecharge le PNG du skin "@id" (meme relais, meme cache et memes reessais que les zones : MCANIM_ZONES change la base).
// Retourne { chemin, octets, telechargee }. La taille (64x64 ou 64x32) est controlee par resoudreSkin.
export async function obtenirSkinRelais(id, { env = process.env, essais = 6, attente = 1500 } = {}) {
  const dossier = path.join(dossierCache(env), 'skins');
  fs.mkdirSync(dossier, { recursive: true });
  const chemin = path.join(dossier, `${id}.png`);
  if (fs.existsSync(chemin)) return { chemin, octets: fs.readFileSync(chemin), telechargee: false };
  const base = env.MCANIM_ZONES || BASE_ZONES;
  const octets = await telechargerRelais(adresseSkin(id, base), base, { essais, attente, quoi: `skin @${id}` });
  const tmp = chemin + '.part';
  fs.writeFileSync(tmp, octets);
  fs.renameSync(tmp, chemin);
  return { chemin, octets, telechargee: true };
}

// Un kit fusionne est une copie du kit de base : s'il manquait un groupe a la demande quand on l'a fait (objets, armures), il serait
// perime des qu'on le telecharge. Le nom du kit fusionne dit donc quels groupes a la demande il contient ('' sans eux : noms d'avant).
function suffixeGroupes(kitDir) {
  const g = readInfo(kitDir)?.groups ?? {};
  const l = GROUPES_A_LA_DEMANDE.filter((x) => g[x]);
  return l.length ? '-g' + l.map((x) => x[0]).join('') : '';
}

// ---------------------------------------------------------------- pack de ressources
// Fabrique (ou reutilise) un kit "fusionne" : le kit de base + les fichiers assets/minecraft/ du pack par-dessus.
// Le rendu lit donc le pack sans rien savoir de lui. Retourne le dossier du kit fusionne.
export async function appliquerPack(kitDir, packChemin, { env = process.env } = {}) {
  if (!fs.existsSync(packChemin)) throw new Error(`pack introuvable : ${packChemin}`);
  const estDossier = fs.statSync(packChemin).isDirectory();
  const fichiers = [];   // { rel, lire() }
  let empreinte;
  if (estDossier) {
    const racine = path.join(packChemin, 'assets', 'minecraft');
    const marche = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel + '/' + e.name; if (e.isDirectory()) marche(path.join(d, e.name), r); else fichiers.push({ rel: r, data: () => fs.readFileSync(path.join(d, e.name)) }); } };
    if (fs.existsSync(racine)) marche(racine, 'assets/minecraft');
    const h = crypto.createHash('sha256');
    for (const f of fichiers.sort((a, b) => (a.rel < b.rel ? -1 : 1))) h.update(f.rel).update(f.data());
    empreinte = h.digest('base64url').slice(0, 16);
  } else {
    empreinte = sha256Base64url(fs.readFileSync(packChemin)).slice(0, 16);
  }
  const cible = path.join(dossierCache(env), 'kits-pack', `${path.basename(path.dirname(kitDir))}-${path.basename(kitDir)}-${empreinte}${suffixeGroupes(kitDir)}`);
  if (fs.existsSync(path.join(cible, '.pret'))) return cible;
  fs.rmSync(cible, { recursive: true, force: true });
  // copie du kit de base (liens durs quand c'est possible : presque pas de place prise)
  const copier = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name), d = path.join(dst, e.name);
      if (e.isDirectory()) copier(s, d);
      else { try { fs.linkSync(s, d); } catch { fs.copyFileSync(s, d); } }
    }
  };
  copier(kitDir, cible);
  // un fichier du pack REMPLACE (on supprime d'abord le lien dur : ne jamais ecrire dans le kit de base)
  const poser = (rel, data) => {
    if (!/^assets\/minecraft\//.test(rel) || rel.includes('..') || rel.includes('\\')) return;
    const f = path.join(cible, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.rmSync(f, { force: true });
    fs.writeFileSync(f, data);
  };
  if (estDossier) for (const f of fichiers) poser(f.rel, f.data());
  else {
    const src = new FileSource(packChemin);
    const cd = await readCentralDirectory(src);
    // certains packs sont zippes avec un dossier racine : on cherche "assets/minecraft/" dans le chemin
    const veut = cd.entries.filter((en) => !en.name.endsWith('/') && /(^|\/)assets\/minecraft\//.test(en.name));
    await extractWanted(src, cd, veut, (nom, data) => poser(nom.slice(nom.indexOf('assets/minecraft/')), data));
  }
  fs.writeFileSync(path.join(cible, '.pret'), '');
  return cible;
}

// ---------------------------------------------------------------- textures de la scene (champ `textures`)
export const TEXTURE_MAX_COTE = 1024;
const estPuissance2 = (n) => n > 0 && (n & (n - 1)) === 0;

// Verifie un PNG de remplacement par rapport a la texture d'origine du kit : taille multiple de l'originale, ou puissance de 2.
export function verifierTailleTexture(nom, l, h, lo, ho) {
  if (l > TEXTURE_MAX_COTE || h > TEXTURE_MAX_COTE) throw new Error(`texture "${nom}" : ${l}x${h} est trop grand (maximum ${TEXTURE_MAX_COTE}x${TEXTURE_MAX_COTE})`);
  const multiple = l % lo === 0 && h % ho === 0;
  if (!multiple && !(estPuissance2(l) && estPuissance2(h))) throw new Error(`texture "${nom}" : ${l}x${h} refuse ; l'original fait ${lo}x${ho} : prends la meme taille, un multiple (${lo * 2}x${ho * 2}...) ou une puissance de 2`);
}

// Fabrique (ou reutilise) un kit "fusionne" ou les textures de `textures` ({ "block/oak_leaves": "feuilles.png" }) remplacent celles
// de `kitDir` (qui peut deja etre un kit fusionne avec un pack : les textures de la scene passent par-dessus). Les chemins des PNG
// sont relatifs a `baseDir` (le dossier de la scene). Retourne le dossier du kit fusionne ; le kit de base n'est jamais modifie.
export function appliquerTextures(kitDir, textures, baseDir, { env = process.env } = {}) {
  const noms = Object.keys(textures).sort();
  const h = crypto.createHash('sha256');
  const prets = noms.map((nom) => {
    const fichier = path.resolve(baseDir, textures[nom]);
    if (!fs.existsSync(fichier)) throw new Error(`textures["${nom}"] : fichier introuvable : ${textures[nom]}`);
    const octets = fs.readFileSync(fichier);
    const original = path.join(kitDir, 'assets', 'minecraft', 'textures', ...nom.split('/')) + '.png';
    if (!fs.existsSync(original)) throw new Error(`textures["${nom}"] : texture inconnue du jeu (mcanim texture ${nom} dit si elle existe)`);
    let im, io;
    try { im = decoderPNG(octets); } catch (e) { throw new Error(`textures["${nom}"] : PNG illisible (${e.message})`); }
    io = decoderPNG(fs.readFileSync(original));
    verifierTailleTexture(nom, im.largeur, im.hauteur, io.largeur, io.hauteur);
    h.update(nom).update(octets);
    return { nom, octets };
  });
  const cible = path.join(dossierCache(env), 'kits-pack', `${path.basename(path.dirname(kitDir))}-${path.basename(kitDir)}-tex-${h.digest('base64url').slice(0, 16)}${suffixeGroupes(kitDir)}`);
  if (fs.existsSync(path.join(cible, '.pret'))) return cible;
  fs.rmSync(cible, { recursive: true, force: true });
  copierKit(kitDir, cible);
  for (const { nom, octets } of prets) {
    const f = path.join(cible, 'assets', 'minecraft', 'textures', ...nom.split('/')) + '.png';
    fs.rmSync(f, { force: true });          // d'abord le lien dur : ne jamais ecrire dans le kit de base
    fs.writeFileSync(f, octets);
  }
  fs.writeFileSync(path.join(cible, '.pret'), '');
  return cible;
}

// Copie d'un kit (liens durs quand c'est possible : presque pas de place prise)
function copierKit(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copierKit(s, d);
    else { try { fs.linkSync(s, d); } catch { fs.copyFileSync(s, d); } }
  }
}
