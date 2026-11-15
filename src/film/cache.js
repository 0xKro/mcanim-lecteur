// Dossier de cache du lecteur, zones, kit de base, pack de ressources.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Net } from '../net.js';
import { ensureKit } from '../index.js';
import { FileSource, readCentralDirectory, extractWanted } from '../zip.js';
import { sha256Base64url } from './empreinte.js';
import { dossierKit } from '../rendu/scene.js';

export const BASE_ZONES = 'https://raw.githubusercontent.com/0xKro/mcanim-zones/main';

export function dossierCache(env = process.env) {
  const d = env.MCANIM_CACHE || path.join(os.homedir(), '.cache', 'mcanim');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// ---------------------------------------------------------------- kit
// Retourne le dossier du kit (<cache>/kit/26.3). MCANIM_KIT : dossier de kit deja pret (essais).
export async function trouverKit({ env = process.env, log = () => {} } = {}) {
  if (env.MCANIM_KIT) return dossierKit(env.MCANIM_KIT);
  const { dir, report } = await ensureKit({ cacheDir: path.join(dossierCache(env), 'kit'), route: 'auto', log });
  if (!report.complete) throw new Error(`kit de base incomplet (manque : ${(report.missing || []).slice(0, 3).join(', ')}...)`);
  return dir;
}

// ---------------------------------------------------------------- zone
export function adresseZone(id, base = BASE_ZONES) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(id)) throw new Error(`identifiant de zone incorrect : "${id}" (22 caracteres attendus)`);
  return `${base.replace(/\/+$/, '')}/z/${id.slice(0, 2)}/${id}.mcz`;
}

const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

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
  const url = adresseZone(id, base);
  let octets;
  if (!/^https?:/i.test(base)) {            // dossier local (essais) : <dossier>/z/xx/id.mcz
    octets = fs.readFileSync(url);
  } else {
    let derniere;
    for (let i = 0; i < essais; i++) {
      const net = new Net();
      try { octets = (await net.buffer(url, { retries: 1 })).body; break; } catch (e) {
        derniere = e;
        // GitHub peut mettre quelques secondes a servir un fichier tout juste depose (404 passager)
        if (e.status && e.status !== 404 && e.status < 500) break;
      } finally { net.close(); }
      if (i < essais - 1) await dormir(attente * (i + 1));
    }
    if (!octets) throw new Error(`zone ${id} introuvable (${derniere?.message ?? 'erreur reseau'})`);
  }
  const tmp = chemin + '.part';
  fs.writeFileSync(tmp, octets);
  fs.renameSync(tmp, chemin);
  return { chemin, octets, sha256: sha256Base64url(octets), telechargee: true };
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
  const cible = path.join(dossierCache(env), 'kits-pack', `${path.basename(path.dirname(kitDir))}-${path.basename(kitDir)}-${empreinte}`);
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
