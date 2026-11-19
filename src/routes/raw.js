// Route "raw" : miroir communautaire misode/mcmeta, lu FICHIER PAR FICHIER sur raw.githubusercontent.com seul (ni git, ni api.github.com, ni
// codeload.github.com : passe quand le proxy ne laisse que raw.githubusercontent.com, ou quand git est absent ou refuse).
// La liste des fichiers (chemins + debut de l'empreinte git de chaque fichier) est fabriquee par scripts/fabriquer-liste-raw.js depuis l'arbre
// git des etiquettes <version>-assets-tiny et <version>-data-json, et livree avec le lecteur (src/routes/liste-raw-<version>.json.gz) : ce ne
// sont que des NOMS et des empreintes, aucun fichier du jeu. Chaque fichier recu est controle contre son empreinte git (memes octets que la route git).
// Sons : sounds.json puis les .ogg voulus, comme la route git (etiquette <version>-assets).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { groupOf, SOUND_EVENTS, SOUND_EVENTS_CREATURES } from '../kit.js';
import { sonsParRaw } from './git.js';

export const RAW = 'https://raw.githubusercontent.com/misode/mcmeta';
export const LONGUEUR_EMPREINTE = 10;                 // caracteres hexadecimaux gardes de l'empreinte git (sha1 du blob)
export const fichierListe = (version) => `liste-raw-${version}.json.gz`;
export const etiquettesRaw = (version) => ({ assets: `${version}-assets-tiny`, donnees: `${version}-data-json` });
const ici = path.dirname(fileURLToPath(import.meta.url));
const erreur = (message, court) => Object.assign(new Error(message), { court });

// Liste livree pour `version` : { version, etiquettes: { assets, donnees }, fichiers: ["chemin\tempreinte", ...] }, ou null
export function lireListe(version, dossier = ici) {
  const f = path.join(dossier, fichierListe(version));
  if (!fs.existsSync(f)) return null;
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));
}
// empreinte git d'un fichier : sha1("blob <taille>\0" + octets)
export const empreinteGit = (b) => crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');

// pool qui s'arrete a la premiere erreur (aucune ecriture apres un echec : ensureKit annule ce qui a ete ecrit)
async function enParallele(items, n, fn) {
  let i = 0, arret = null;
  const w = async () => { while (!arret && i < items.length) { const k = i++; try { await fn(items[k]); } catch (e) { arret ??= e; } } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, w));
  if (arret) throw arret;
}

export async function run(ctx) {
  const { net, version, groups } = ctx;
  const notes = {};
  const groupesFichiers = [...groups].filter((g) => g !== 'sons' && g !== 'sons_creatures');
  const taches = [];
  if (groupesFichiers.length) {
    const liste = ctx.opts.listeRaw ?? lireListe(version);
    if (!liste) throw erreur(`route raw : pas de liste de fichiers pour la version ${version} (scripts/fabriquer-liste-raw.js)`, `liste ${version} absente`);
    const voulus = liste.fichiers.map((l) => l.split('\t')).filter(([p]) => groups.has(groupOf(p)));
    const vides = groupesFichiers.filter((g) => !voulus.some(([p]) => groupOf(p) === g));
    if (vides.length) throw erreur(`route raw : aucun fichier pour ${vides.join(', ')} dans la liste ${version}`, `liste sans ${vides.join('+')}`);
    const base = ctx.opts.rawUrl || RAW;
    taches.push(enParallele(voulus, ctx.opts.rawParallele ?? 16, async ([p, h]) => {
      const tag = p.startsWith('data/') ? liste.etiquettes.donnees : liste.etiquettes.assets;
      const b = (await net.buffer(`${base}/${tag}/${p.split('/').map(encodeURIComponent).join('/')}`, { retries: 3 })).body;
      if (!empreinteGit(b).startsWith(h)) throw erreur(`route raw : ${p} ne correspond pas a la liste (empreinte git ${empreinteGit(b).slice(0, LONGUEUR_EMPREINTE)} au lieu de ${h})`, 'empreinte fausse');
      ctx.put(p, b);
    }).then(() => { notes.fichiers = voulus.length; }));
  }
  for (const [g, evs, tol] of [['sons', ctx.opts.soundEvents || SOUND_EVENTS, false], ['sons_creatures', ctx.opts.evenementsCreatures || SOUND_EVENTS_CREATURES, true]]) {
    if (groups.has(g)) taches.push(sonsParRaw(ctx, version, evs, tol).then((n) => { notes[g === 'sons' ? 'sons' : 'sonsCreatures'] = n; }));
  }
  const res = await Promise.allSettled(taches);
  const echec = res.find((r) => r.status === 'rejected');
  if (echec) throw echec.reason;
  notes.avertissement = 'miroir communautaire sans licence ni sha1 officiel: contenu non verifie contre Mojang (controle contre l\'arbre git du miroir)';
  return { notes };
}
