// Reglages d'un VRAI pack de shaders pour `--pack-shader` : lecture des options et des profils, controle de `--option NOM=VALEUR` et `--profil NOM`
// (memes noms que `mcanim shader --extraire`), et la liste des choses du pack que notre rendu ne sait pas faire encore.
// Rien n'est copie : on lit des reglages ; les fichiers extraits d'un zip vont dans un dossier temporaire, effaces ensuite.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaire, trouverRacine, lireProperties, lireOptions, resoudreProfil } from './extraire.js';

export class ErreurPack extends Error {}

function lister(dossier, rel = '', sortie = []) {
  let liste = [];
  try { liste = fs.readdirSync(path.join(dossier, rel), { withFileTypes: true }); } catch { return sortie; }
  for (const e of liste) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) lister(dossier, r, sortie); else sortie.push(r);
  }
  return sortie;
}
const lire = (f) => { try { return fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); } catch { return ''; } };

// Retourne { options: Map, profils: Map, props: Map, fichiers: [chemins relatifs a la racine], nettoyer() }.
export async function lireReglages(chemin) {
  if (!fs.existsSync(chemin)) throw new ErreurPack(`pack de shaders introuvable : ${chemin}`);
  let dossier = chemin, temporaire = null;
  if (fs.statSync(chemin).isFile()) {
    if (!/\.zip$/i.test(chemin)) throw new ErreurPack(`pack de shaders : un .zip (ou un dossier) est attendu, pas ${path.basename(chemin)}`);
    temporaire = fs.mkdtempSync(path.join(os.tmpdir(), 'mcanim-reglages-'));
    try { await defaire(chemin, temporaire); } catch (e) { fs.rmSync(temporaire, { recursive: true, force: true }); throw new ErreurPack(`pack de shaders illisible (${e.message})`); }
    dossier = temporaire;
  }
  const nettoyer = () => { if (temporaire) fs.rmSync(temporaire, { recursive: true, force: true }); };
  try {
    const tous = lister(dossier);
    const racine = trouverRacine(tous);
    if (racine === null) throw new ErreurPack('ce n\'est pas un pack de shaders : pas de dossier "shaders/"');
    const pre = racine ? racine + '/' : '';
    const sh = tous.filter((f) => f.startsWith(pre + 'shaders/')).map((f) => f.slice(pre.length));
    const props = lireProperties(lire(path.join(dossier, racine, 'shaders', 'shaders.properties'))).m;
    const profils = new Map();
    for (const [k, v] of props) { const p = k.match(/^profile\.(.+)$/); if (p && p[1] !== 'comment') profils.set(p[1], v.split(/\s+/).filter(Boolean)); }
    const options = new Map();
    for (const f of sh.filter((x) => /\.(fsh|vsh|gsh|csh|glsl|inc|h)$/i.test(x)).sort()) lireOptions(lire(path.join(dossier, racine, f)), f, options);
    return { options, profils, props, fichiers: sh, nettoyer };
  } catch (e) { nettoyer(); throw e; }
}

// Distance de Levenshtein (petite) pour proposer le nom voisin d'une option mal ecrite
function distance(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
  return d[m][n];
}
export function proches(nom, noms, n = 3) {
  return [...noms].map((x) => [x, distance(nom, x) - (x.toLowerCase().includes(nom.toLowerCase()) ? 3 : 0)]).sort((a, b) => a[1] - b[1]).slice(0, n).filter((x) => x[1] <= Math.max(3, nom.length / 2)).map((x) => x[0]);
}

const VRAI = /^(1|on|true|oui|yes)$/i, FAUX = /^(0|off|false|non|no)$/i;

// Controle `--profil` et `--option` ; retourne { surcharges: { NOM: true|false|'valeur' }, profil, resume[] }. Leve ErreurPack avec UNE phrase claire.
//   valeurs : ['NOM=VALEUR', ...] (VALEUR on/off pour un interrupteur)
export function preparerOptions(reglages, { profil, valeurs = [] } = {}) {
  const { options, profils } = reglages;
  const surcharges = {}, resume = [];
  if (profil !== undefined) {
    if (!profils.has(profil)) {
      const liste = [...profils.keys()];
      throw new ErreurPack(`profil inconnu : "${profil}"${liste.length ? ` (profils du pack : ${liste.slice(0, 12).join(', ')})` : ' (ce pack n\'a aucun profil)'}`);
    }
    for (const [k, v] of Object.entries(resoudreProfil(profil, profils))) if (options.has(k)) { surcharges[k] = v === true ? true : v === false ? false : String(v); }
    resume.push(`profil ${profil}`);
  }
  for (const brut of valeurs) {
    const i = brut.indexOf('=');
    if (i < 1) throw new ErreurPack(`--option attend NOM=VALEUR (recu : ${brut})`);
    const nom = brut.slice(0, i).trim(), val = brut.slice(i + 1).trim();
    const o = options.get(nom);
    if (!o) {
      const p = proches(nom, options.keys());
      throw new ErreurPack(`option inconnue : "${nom}"${p.length ? ` (proches : ${p.join(', ')})` : ''} ; la liste : mcanim shader --extraire pack.zip`);
    }
    if (o.type === 'define' && !o.valeur && !o.choix) {           // interrupteur
      if (VRAI.test(val)) surcharges[nom] = true;
      else if (FAUX.test(val)) surcharges[nom] = false;
      else throw new ErreurPack(`option ${nom} : "${val}" refuse, c'est un interrupteur (on ou off)`);
    } else {
      if (FAUX.test(val) && o.type === 'define' && o.choix === null) surcharges[nom] = false;
      else {
        if (o.choix && o.choix.length && !o.choix.includes(val)) throw new ErreurPack(`option ${nom} : "${val}" refuse (valeurs permises : ${o.choix.length > 12 ? o.choix.slice(0, 12).join(' ') + ' ...' : o.choix.join(' ')})`);
        if (/^[-+]?[\d.]+$/.test(String(o.valeur ?? '')) && !/^[-+]?[\d.]+$/.test(val)) throw new ErreurPack(`option ${nom} : un nombre est attendu, pas "${val}"`);
        surcharges[nom] = val;
      }
    }
    resume.push(`${nom}=${val}`);
  }
  return { surcharges, resume };
}

// Ce que ce pack utilise et que notre rendu ne fait pas (encore) : UNE ligne de texte pour que l'assistant le dise a l'utilisateur.
export function nonGere(reglages) {
  const f = reglages.fichiers, tout = (re) => f.some((x) => re.test(x));
  const manque = [];
  if (tout(/\.csh$/i)) manque.push('shaders de calcul (.csh)');
  if (tout(/\.gsh$/i)) manque.push('shaders de geometrie (.gsh)');
  if ([...reglages.props.keys()].some((k) => /^image\.|^bufferObject\./.test(k))) manque.push('images/SSBO du pack (ex. eclairage par propagation LPV)');
  if (tout(/(^|\/)dh_[a-z_]+\.(fsh|vsh)$/i)) manque.push('Distant Horizons');
  if (tout(/gbuffers_weather\.(fsh|vsh)$/i)) manque.push('pluie et neige');
  if (tout(/gbuffers_(hand|hand_water)\.(fsh|vsh)$/i)) manque.push('main du joueur');
  if (tout(/gbuffers_(beaconbeam|damagedblock|armor_glint|spidereyes)\.(fsh|vsh)$/i)) manque.push('faisceaux, casse de bloc, brillance d\'armure, yeux');
  manque.push('relief et reflets labPBR (normales et speculaire plates)', 'biomes (un seul biome fixe)', 'meteo (toujours beau temps)');
  return manque;
}
