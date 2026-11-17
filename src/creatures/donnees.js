// Table des creatures (modeles par couche, animations a images cles, statistiques) : fichier `creatures-1.json.gz`, fait par
// outils/extraire-creatures.mjs. Meme mecanisme que les donnees du jeu (moteur/chargeur.js) :
//   1. MCANIM_CREATURES (fichier local, essais) ; 2. cache <cache>/creatures/ (verifie par SHA-256) ;
//   3. copie du depot (lecteur/relais/d/) ; 4. telechargement depuis le depot de relais.
// Les textures ne sont pas dedans : elles viennent du kit (groupe `entites`).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Net } from '../net.js';
import { dossierCache, BASE_ZONES } from '../film/cache.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
export const EMPREINTE = () => JSON.parse(fs.readFileSync(path.join(ICI, 'donnees-empreinte.json'), 'utf8'));
export const COPIE_DEPOT = path.join(ICI, '..', '..', 'relais', 'd', 'creatures-1.json.gz');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('base64url');

export class ErreurCreatures extends Error { constructor(m) { super(m); this.name = 'ErreurCreatures'; } }

// Table lue : { v, categories, modeles: { type: { couche: { t:[l,h], r: partie } } }, animations: { famille: { nom: anim } }, types: { id: stats } }
export function depuisOctets(octets) {
  const j = JSON.parse(zlib.gunzipSync(octets).toString('utf8'));
  if (j.v !== 1) throw new ErreurCreatures(`creatures : version ${j.v} non geree (le lecteur attend 1)`);
  return j;
}

let MEMO = null;
export async function donneesCreatures({ env = process.env, log = () => {} } = {}) {
  if (MEMO) return MEMO;
  if (env.MCANIM_CREATURES) return (MEMO = depuisOctets(fs.readFileSync(path.resolve(env.MCANIM_CREATURES))));
  const e = EMPREINTE();
  const dossier = path.join(dossierCache(env), 'creatures');
  const cache = path.join(dossier, path.basename(e.fichier));
  const verifie = (b) => sha256(b) === e.sha256;
  if (fs.existsSync(cache)) { const b = fs.readFileSync(cache); if (verifie(b)) return (MEMO = depuisOctets(b)); }
  if (fs.existsSync(COPIE_DEPOT)) {
    const b = fs.readFileSync(COPIE_DEPOT);
    if (!verifie(b)) throw new ErreurCreatures(`creatures : ${COPIE_DEPOT} ne correspond pas a l'empreinte du paquet ; relance node outils/extraire-creatures.mjs`);
    return (MEMO = depuisOctets(b));
  }
  const base = env.MCANIM_ZONES || BASE_ZONES;
  log('creatures : telechargement...');
  let octets;
  if (!/^https?:/i.test(base)) octets = fs.readFileSync(path.join(base, e.fichier));
  else {
    const net = new Net();
    try { octets = (await net.buffer(`${base.replace(/\/+$/, '')}/${e.fichier}`, { retries: 2 })).body; } catch (err) {
      throw new ErreurCreatures(`table des creatures introuvable sur le relais (${err.message}) ; elle doit etre deposee dans le depot de relais (voir docs/SIMULATION.md, "Creatures")`);
    } finally { net.close(); }
  }
  if (!verifie(octets)) throw new ErreurCreatures('table des creatures telechargee : empreinte SHA-256 differente de celle du paquet (fichier abime ou perime)');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(cache + '.part', octets); fs.renameSync(cache + '.part', cache);
  return (MEMO = depuisOctets(octets));
}
// Version synchrone : seulement si la table est deja chargee (le rendu l'attend avant d'appeler).
export function creaturesChargees() { return MEMO; }
export function oublierCreatures() { MEMO = null; }
