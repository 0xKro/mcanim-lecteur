// Chargement des tables de donnees du jeu (groupe `donnees-jeu`, voir kit.js : GROUPES_RELAIS).
// Ordre : 1. MCANIM_DONNEES_JEU (fichier local, essais) ; 2. cache <cache>/donnees-jeu/ (verifie par SHA-256) ;
//         3. copie du depot (lecteur/relais/d/, developpement) ; 4. telechargement depuis le depot de relais (comme les zones).
// L'empreinte attendue est inscrite dans le paquet (donnees-empreinte.json) : une table qui ne correspond pas est refusee.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Net } from '../net.js';
import { dossierCache, BASE_ZONES } from '../film/cache.js';
import { depuisOctets, chargerDonneesFichier, sha256Octets } from './donnees.js';
import { ErreurMonde } from './erreurs.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
export const EMPREINTE = () => JSON.parse(fs.readFileSync(path.join(ICI, 'donnees-empreinte.json'), 'utf8'));
export const COPIE_DEPOT = path.join(ICI, '..', '..', 'relais', 'd', 'donnees-jeu-1.json.gz');

let MEMO = null;

// Rend l'objet Donnees (tables). `env` / `base` : pour les essais.
export async function donneesDuJeu({ env = process.env, log = () => {} } = {}) {
  if (MEMO) return MEMO;
  if (env.MCANIM_DONNEES_JEU) return (MEMO = chargerDonneesFichier(path.resolve(env.MCANIM_DONNEES_JEU)));
  const e = EMPREINTE();
  const dossier = path.join(dossierCache(env), 'donnees-jeu');
  const cache = path.join(dossier, path.basename(e.fichier));
  const verifie = (b) => sha256Octets(b) === e.sha256;
  if (fs.existsSync(cache)) { const b = fs.readFileSync(cache); if (verifie(b)) return (MEMO = depuisOctets(b)); }
  // copie du depot (poste de developpement)
  if (fs.existsSync(COPIE_DEPOT)) {
    const b = fs.readFileSync(COPIE_DEPOT);
    if (!verifie(b)) throw new ErreurMonde(`donnees-jeu : ${COPIE_DEPOT} ne correspond pas a l'empreinte du paquet ; relance node outils/extraire-donnees-jeu.mjs`);
    return (MEMO = depuisOctets(b));
  }
  const base = env.MCANIM_ZONES || BASE_ZONES;
  log('donnees du jeu : telechargement...');
  let octets;
  if (!/^https?:/i.test(base)) octets = fs.readFileSync(path.join(base, e.fichier));
  else {
    const net = new Net();
    try { octets = (await net.buffer(`${base.replace(/\/+$/, '')}/${e.fichier}`, { retries: 2 })).body; } catch (err) {
      throw new ErreurMonde(`donnees du jeu introuvables sur le relais (${err.message}) ; elles doivent etre deposees dans le depot de relais (voir docs/SIMULATION.md, "Donnees du jeu")`);
    } finally { net.close(); }
  }
  if (!verifie(octets)) throw new ErreurMonde('donnees du jeu telechargees : empreinte SHA-256 differente de celle du paquet (fichier abime ou perime)');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(cache + '.part', octets); fs.renameSync(cache + '.part', cache);
  return (MEMO = depuisOctets(octets));
}
export function oublierDonnees() { MEMO = null; }
