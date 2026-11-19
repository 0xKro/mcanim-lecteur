// Empreinte COMPLETE d'une scene (CONCEPTION.md, partie 4) : le JSON canonique + le CONTENU des fichiers locaux qui changent
// l'image ou le son (skin, masque, textures, shader, pack de shaders...) + les options de rendu qui changent l'image.
// But : le jeton est lie au contenu exact de ce qui sera rendu. Changer un octet d'un PNG change l'empreinte.
//
// Regle : sans AUCUN fichier ni option couverts, l'empreinte est exactement celle d'avant (empreinte(brut)) : les jetons deja emis
// restent valables. Sinon : SHA-256 du texte
//     <JSON canonique>\n<ligne>\n<ligne>...
// ou chaque ligne est JSON.stringify([role, chemin, sha256 base64url des octets du fichier]) (sha = null pour une option qui n'est pas un
// fichier), les lignes classees par role puis par chemin (ordre des unites UTF-16) et sans doublon.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonique, empreinte } from './empreinte.js';
import { verifierFichiers } from './fichiers.js';
import { fichiersImportes } from '../decor/lire.js';

const normaliserMod = (t) => t.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');   // identique a moteur/mods.js (sans l'importer : le moteur ne se charge qu'a la demande)

// Un skin est un FICHIER s'il se termine par .png ou contient un separateur (comme fichiers.js) ; "@id", pseudo et nom par defaut non.
const estFichier = (s) => typeof s === 'string' && (/\.png$/i.test(s) || /[\\/]/.test(s));

// REGISTRE : chaque champ de scene qui cite un fichier local s'inscrit ici (role + fonction qui liste les chemins d'une scene lue).
// Un futur champ (decor, mod...) s'ajoute ICI et nulle part ailleurs : il entre alors tout seul dans l'empreinte.
// `brut` = JSON lu ; `surcharges` = { nomActeur: fichier } de --skin (leur skin de scene est remplace, donc non lu).
export const REGISTRE = [
  { role: 'skin', lister: (brut, surcharges) => (brut.acteurs ?? []).flatMap((a) => [...(!surcharges[a?.nom] && estFichier(a?.skin) ? [a.skin] : []), ...((Array.isArray(a?.skins) ? a.skins : []).map((k) => k?.[1]).filter(estFichier))]) },
  { role: 'masque', lister: (brut) => (brut.acteurs ?? []).map((a) => a?.masque).filter((m) => typeof m === 'string') },
  { role: 'texture', lister: (brut) => (brut.textures && typeof brut.textures === 'object' ? Object.values(brut.textures).filter((m) => typeof m === 'string') : []) },
  { role: 'shader', lister: (brut) => (typeof brut.shader === 'string' ? [brut.shader] : []) },
  { role: 'packShader', lister: (brut) => (typeof brut.packShader === 'string' ? [brut.packShader] : []) },
  // decors (docs/FORMAT-DECOR.md) : un decor change le monde, donc l'image ; les decors en ligne sont deja dans le JSON de la scene. Octets normalises (retours a la ligne, sans BOM) comme les mods.
  { role: 'decor', normaliser: true, lister: (brut) => (Array.isArray(brut.decor) ? brut.decor.filter((m) => typeof m === 'string') : []) },
  // mods de comportement (monde.mods) : le fichier change le jeu, donc l'image. Octets normalises (\n, sans BOM) : voir moteur/mods.js
  { role: 'mod', normaliser: true, lister: (brut) => (Array.isArray(brut.monde?.mods) ? brut.monde.mods.filter((m) => typeof m === 'string') : []) },
  // montage : fichiers audio (voix, musique, effets) et images PNG des incrustations (icone / image avec `fichier`, y compris dans les cartes) : leur CONTENU est dans l'empreinte
  { role: 'audio', lister: (brut) => (Array.isArray(brut.sons?.fichiers) ? brut.sons.fichiers.map((e) => e?.[1]).filter((f) => typeof f === 'string') : []) },
  { role: 'incrust-image', lister: (brut) => fichiersIncrustations(brut.incrustations) },
];
function fichiersIncrustations(liste) {
  const sortie = [];
  for (const e of Array.isArray(liste) ? liste : []) {
    if (typeof e?.fichier === 'string') sortie.push(e.fichier);
    if (Array.isArray(e?.incrustations)) sortie.push(...fichiersIncrustations(e.incrustations));
  }
  return sortie;
}

// Fichiers de la scene cites par les mods (modeles et textures de mc.definirBloc / mc.definirEntite, moteur/perso.js) : chaque texte
// entre guillemets du code des mods qui nomme un .png ou un .json present a cote de la scene. Ils entrent dans l'empreinte (role
// `mod-fichier`) ; au rendu, un fichier utilise par une definition qui n'est PAS dans cette liste (chemin fabrique par le code) est refuse.
export function fichiersDeMods(mods, baseDir) {
  const vus = new Set();
  for (const m of Array.isArray(mods) ? mods : []) {
    if (typeof m !== 'string') continue;
    let src = '';
    try { src = fs.readFileSync(path.resolve(baseDir, m), 'utf8'); } catch { continue; }
    for (const x of src.matchAll(/['"`]([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:png|json))['"`]/g)) {
      const rel = x[1];
      if (rel.includes('..')) continue;
      const f = path.resolve(baseDir, rel);
      if (fs.existsSync(f) && fs.statSync(f).isFile()) vus.add(rel);
    }
  }
  return [...vus].sort();
}

// Constructions importees par les decors (operation `importer` : .schem, .nbt, .litematic a cote du decor) : leur CONTENU change le monde,
// donc l'image. Chemins rendus relatifs au fichier de scene (avec des "/"). Un decor illisible est ignore ici (il est refuse a la lecture).
export function fichiersDeDecors(decors, baseDir) {
  const vus = new Set();
  for (const e of Array.isArray(decors) ? decors : []) {
    let brut = e, dir = baseDir;
    if (typeof e === 'string') {
      const f = path.resolve(baseDir, e);
      try { brut = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { continue; }
      dir = path.dirname(f);
    }
    for (const rel of fichiersImportes(brut)) {
      if (typeof rel !== 'string' || rel.split(/[\\/]/).includes('..') || path.isAbsolute(rel)) continue;
      vus.add(path.relative(baseDir, path.resolve(dir, rel)).split(path.sep).join('/'));
    }
  }
  return [...vus].sort();
}

// Lignes VIRTUELLES (rien a lire sur le disque) : ce qui change l'image sans etre dans le fichier de scene. Une scene avec `monde` depend des
// tables de donnees du jeu (moteur/donnees-empreinte.json : SHA-256 du fichier) et de la version du moteur ; un changement de donnees
// invalide donc les jetons deja emis (comme un mod modifie).
export function lignesVirtuelles(brut) {
  // creatures (champ d'acteur `type`) : la table des modeles et animations (creatures/donnees-empreinte.json) change l'image
  const creatures = Array.isArray(brut?.acteurs) && brut.acteurs.some((a) => typeof a?.type === 'string' && a.type !== 'joueur');
  const lc = creatures ? (() => { const c = JSON.parse(fs.readFileSync(new URL('../creatures/donnees-empreinte.json', import.meta.url), 'utf8')); return [{ role: 'creatures', chemin: `creatures v${c.v}`, sha: c.sha256 }]; })() : [];
  if (brut?.monde === undefined && brut?.decor === undefined) return lc;   // un decor depend aussi des tables de blocs du jeu (etats, formes)
  const d = JSON.parse(fs.readFileSync(new URL('../moteur/donnees-empreinte.json', import.meta.url), 'utf8'));
  const lignes = [{ role: 'moteur', chemin: `donnees-jeu v${d.v}`, sha: d.sha256 }, ...lc];
  if (brut?.decor !== undefined) lignes.push({ role: 'decor-version', chemin: 'decor v1', sha: null });   // version du langage de decor : un changement de regle change l'image
  return lignes;
}

// { role, chemin } des fichiers cites par une scene lue (chemins comme ecrits dans la scene, relatifs au fichier de scene).
export function fichiersReferences(brut, surcharges = {}) {
  const liste = [];
  for (const { role, lister } of REGISTRE) for (const chemin of lister(brut ?? {}, surcharges)) liste.push({ role, chemin });
  return liste;
}

// SHA-256 (base64url) d'un fichier ou d'un dossier (dossier : chemins relatifs et empreintes des fichiers, classes).
export function sha256Chemin(chemin, { normaliser = false } = {}) {
  if (normaliser) return crypto.createHash('sha256').update(normaliserMod(fs.readFileSync(chemin, 'utf8')), 'utf8').digest('base64url');
  const h = crypto.createHash('sha256');
  if (fs.statSync(chemin).isDirectory()) {
    const fichiers = [];
    const marche = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) marche(path.join(d, e.name), r); else fichiers.push(r); } };
    marche(chemin, '');
    for (const r of fichiers.sort()) h.update(r + '\0' + sha256Chemin(path.join(chemin, ...r.split('/'))) + '\n');
    return h.digest('base64url');
  }
  const fd = fs.openSync(chemin, 'r');
  try {
    const tampon = Buffer.allocUnsafe(1 << 20);
    for (let n; (n = fs.readSync(fd, tampon, 0, tampon.length, null)) > 0;) h.update(tampon.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('base64url');
}

// Chemin ecrit dans l'empreinte pour un fichier de la ligne de commande : relatif au dossier courant, avec des "/".
const relatifCli = (f, cwd) => path.relative(cwd, path.resolve(cwd, f)).split(path.sep).join('/');

// Options de la ligne de commande qui changent l'image : { skin: ["nom=f.png"], pack, shader, 'pack-shader', profil, echelle, option: [..] }
// (la forme que lireArgs de bin/mcanim.js produit). Retourne les lignes { role, chemin, sha }.
function lignesOptions(opt, cwd) {
  const L = [];
  const sha = (quoi, f) => { const p = path.resolve(cwd, f); if (!fs.existsSync(p)) throw new Error(`${quoi} : fichier introuvable : ${f}`); return sha256Chemin(p); };
  const fichier = (role, quoi, f) => L.push({ role, chemin: relatifCli(f, cwd), sha: sha(quoi, f) });
  for (const s of opt.skin ?? []) {
    const i = String(s).indexOf('=');
    if (i < 1) continue;   // erreur de forme : signalee ailleurs
    L.push({ role: 'cli-skin', chemin: `${s.slice(0, i)}=${relatifCli(s.slice(i + 1), cwd)}`, sha: sha('--skin', s.slice(i + 1)) });
  }
  if (opt.pack) fichier('cli-pack', '--pack', opt.pack);
  if (opt.shader) fichier('cli-shader', '--shader', opt.shader);
  if (opt['pack-shader']) fichier('cli-pack-shader', '--pack-shader', opt['pack-shader']);
  if (opt.profil !== undefined) L.push({ role: 'cli-profil', chemin: String(opt.profil), sha: null });
  if (opt.echelle !== undefined && Number(opt.echelle) !== 1) L.push({ role: 'cli-echelle', chemin: String(Number(opt.echelle)), sha: null });
  for (const o of opt.option ?? []) L.push({ role: 'cli-option', chemin: String(o), sha: null });
  return L;
}

// Empreinte complete. brut : JSON lu ; scene : scene validee (sert a controler que les fichiers existent, message d'une ligne) ;
// baseDir : dossier du fichier de scene ; opt : options de la ligne de commande (voir lignesOptions) ; cwd : dossier courant.
// Retourne { empreinte, fichiers: [{ role, chemin, sha }], texte (resume court) }.
export function empreinteComplete(brut, { scene = null, baseDir = process.cwd(), opt = {}, cwd = process.cwd() } = {}) {
  const surcharges = {};
  for (const s of opt.skin ?? []) { const i = String(s).indexOf('='); if (i > 0) surcharges[s.slice(0, i)] = path.resolve(cwd, s.slice(i + 1)); }
  if (scene) verifierFichiers(scene, baseDir, surcharges);
  const normalise = new Set(REGISTRE.filter((r) => r.normaliser).map((r) => r.role));
  const lignes = fichiersReferences(brut, surcharges).map(({ role, chemin }) => {
    const f = path.resolve(baseDir, chemin);
    if (!fs.existsSync(f)) throw new Error(`${role} : fichier introuvable : ${chemin} (chemin relatif au fichier de scene)`);
    return { role, chemin, sha: sha256Chemin(f, { normaliser: normalise.has(role) }) };
  });
  for (const chemin of fichiersDeMods(brut?.monde?.mods, baseDir)) lignes.push({ role: 'mod-fichier', chemin, sha: sha256Chemin(path.resolve(baseDir, chemin)) });
  for (const chemin of fichiersDeDecors(brut?.decor, baseDir)) {
    const f = path.resolve(baseDir, chemin);
    if (!fs.existsSync(f)) throw new Error(`decor-import : fichier introuvable : ${chemin} (cite par une operation importer ; chemin relatif au fichier de decor)`);
    lignes.push({ role: 'decor-import', chemin, sha: sha256Chemin(f) });
  }
  lignes.push(...lignesVirtuelles(brut));
  lignes.push(...lignesOptions(opt, cwd));
  const cle = (l) => l.role + '\u0000' + l.chemin;
  lignes.sort((a, b) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0));
  const uniques = lignes.filter((l, i) => i === 0 || cle(l) !== cle(lignes[i - 1]));
  const decompte = {};
  for (const l of uniques) decompte[l.role.replace(/^cli-/, '--')] = (decompte[l.role.replace(/^cli-/, '--')] ?? 0) + 1;
  const texte = uniques.length ? `fichiers et options couverts par l'empreinte : ${uniques.length} (${Object.entries(decompte).map(([r, n]) => `${r} ${n}`).join(', ')})` : 'fichiers et options couverts par l\'empreinte : 0';
  if (!uniques.length) return { empreinte: empreinte(brut), fichiers: [], texte };
  const donnees = canonique(brut) + '\n' + uniques.map((l) => JSON.stringify([l.role, l.chemin, l.sha])).join('\n');
  return { empreinte: crypto.createHash('sha256').update(donnees, 'utf8').digest('base64url'), fichiers: uniques, texte };
}
