// `mcanim shader --extraire pack.zip` : defait un pack de shaders Iris/OptiFine (lecture seule, fichiers texte) et en tire un RESUME COURT
// des REGLAGES (profils, options `#define`, `const`, ecrans) pour que l'assistant n'ait pas a lire des megaoctets de GLSL.
// On ne lit que des reglages : aucun code GLSL n'est recopie dans la sortie (les fichiers extraits restent dans le dossier de travail, jamais dans le depot).
// Les packs varient beaucoup : chaque lecture est tolerante (une ligne illisible est sautee, rien ne leve d'erreur).
import fs from 'node:fs';
import path from 'node:path';
import { FileSource, readCentralDirectory, extractWanted } from '../zip.js';

const EXT_TEXTE = new Set(['.properties', '.fsh', '.vsh', '.gsh', '.csh', '.glsl', '.inc', '.h', '.lang', '.json', '.txt', '.md', '.mcmeta']);
const MAX_FICHIER = 3 << 20;        // un fichier texte plus gros que ca n'est pas un reglage
const MAX_TOTAL = 64 << 20;
const BUDGET = 3700;                // octets de texte du resume (hors en-tete de l'avertissement final)
const MOTS_CLES = /SUN|MOON|SKY|FOG|CLOUD|WATER|SHADOW|BLOOM|GOD|VOL|LIGHT|AMBIENT|EXPO|SAT|CONTRAST|VIGN|WAV|STAR|AURORA|COLOR|COL_|TONE|TM_|GAMMA|AO\b|SSAO|BRIGHT|REFLECT|NIGHT|MORNING|NOON|EVENING|SUNSET|DAWN/i;
const CONST_CONNUS = new Set(['sunPathRotation', 'shadowDistance', 'shadowMapResolution', 'shadowDistanceRenderMul', 'shadowIntervalSize', 'ambientOcclusionLevel',
  'wetnessHalflife', 'drynessHalflife', 'eyeBrightnessHalflife', 'centerDepthHalflife', 'shadowHardwareFiltering', 'shadowtex0Nearest', 'shadowMapFov']);

// ---------------------------------------------------------------- extraction du zip
export async function defaire(zipChemin, dossier) {
  const src = new FileSource(zipChemin);
  const cd = await readCentralDirectory(src);
  const garde = [];
  let total = 0;
  for (const en of cd.entries) {
    if (en.name.endsWith('/')) continue;
    if (!EXT_TEXTE.has(path.extname(en.name).toLowerCase())) continue;
    if (en.usize > MAX_FICHIER || total + en.usize > MAX_TOTAL) continue;
    const rel = en.name.replace(/\\/g, '/');
    if (rel.split('/').some((p) => p === '..' || p === '') || /^[a-zA-Z]:/.test(rel)) continue;   // jamais hors du dossier
    total += en.usize;
    garde.push(en);
  }
  fs.mkdirSync(dossier, { recursive: true });
  const base = path.resolve(dossier);
  await extractWanted(src, cd, garde, (nom, data) => {
    const f = path.resolve(base, ...nom.replace(/\\/g, '/').split('/'));
    if (!f.startsWith(base + path.sep)) return;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  });
  return { fichiers: garde.length, ignores: cd.entries.filter((e) => !e.name.endsWith('/')).length - garde.length, octets: total };
}

// ---------------------------------------------------------------- outils de lecture
const lire = (f) => { try { return fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); } catch { return ''; } };

function lister(dossier, rel = '', sortie = []) {
  let liste = [];
  try { liste = fs.readdirSync(path.join(dossier, rel), { withFileTypes: true }); } catch { return sortie; }
  for (const e of liste.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) lister(dossier, r, sortie); else sortie.push(r);
  }
  return sortie;
}

// Racine du pack : le dossier qui contient `shaders/` (le zip peut avoir un dossier de plus). Retourne le chemin relatif ('' si a la racine) ou null.
export function trouverRacine(fichiers) {
  let meilleur = null;
  for (const f of fichiers) {
    const i = f.indexOf('shaders/');
    if (i < 0 || (i > 0 && f[i - 1] !== '/')) continue;
    const pre = f.slice(0, i);
    if (meilleur === null || pre.length < meilleur.length) meilleur = pre;
  }
  return meilleur === null ? null : meilleur.replace(/\/$/, '');
}

// .properties : `cle = valeur`, commentaires `#`, suite de ligne avec `\`. Retourne un Map (la derniere valeur gagne) et les commentaires de tete.
export function lireProperties(texte) {
  const m = new Map(), tete = [];
  const lignes = texte.split(/\r?\n/);
  let vuCle = false;
  for (let i = 0; i < lignes.length; i++) {
    let l = lignes[i];
    if (/^\s*[#!]/.test(l)) { if (!vuCle && tete.length < 6) tete.push(l.replace(/^\s*[#!]+\s*/, '').trim()); continue; }
    while (/\\\s*$/.test(l) && i + 1 < lignes.length) l = l.replace(/\s*\\\s*$/, ' ') +lignes[++i].trim();
    const k = l.match(/^\s*([^=\s:][^=]*?)\s*[=:]\s*(.*)$/);
    if (!k) continue;
    vuCle = true;
    m.set(k[1], k[2].trim());
  }
  return { m, tete: tete.filter(Boolean) };
}

// Options : `#define NOM [valeur] [// [choix...]]`, `//#define NOM` (eteinte), `const type NOM = valeur; // [choix]`.
export function lireOptions(texte, fichier, vus = new Map()) {
  const lignes = texte.split(/\r?\n/);
  for (const brut of lignes) {
    let l = brut.trim();
    if (!l || l.length > 400) continue;
    let choix = null;
    const c = l.match(/\/\/\s*\[([^\]]*)\]\s*$/);
    if (c) { choix = c[1].trim().split(/[\s,]+/).filter(Boolean); l = l.slice(0, c.index).trim(); }
    let m = l.match(/^(\/\/\s*)?#\s*define\s+([A-Za-z_]\w*)(\(|\s+(.*?))?\s*(\/\/.*)?$/);
    if (m) {
      const eteinte = !!m[1], nom = m[2];
      if (m[3] === '(') continue;                                  // macro de fonction : pas un reglage
      if (nom.startsWith('_') || /_(H|GLSL|INC|INCLUDED)$/.test(nom)) continue;   // garde d'inclusion
      if (eteinte && !/^[A-Z][A-Z0-9_]{2,}$/.test(nom)) continue;   // un commentaire qui parle de define, pas un reglage
      let valeur = (m[4] || '').trim();
      if (valeur.length > 70 || /[{};]/.test(valeur)) continue;     // du code, pas une valeur
      if (!eteinte && !valeur && !choix && /^(MC_|IS_|FRAGMENT|VERTEX|COMPUTE)/.test(nom)) continue;
      if (!vus.has(nom)) vus.set(nom, { nom, type: 'define', actif: !eteinte, valeur, choix, fichier });
      else if (choix && !vus.get(nom).choix) vus.get(nom).choix = choix;
      continue;
    }
    m = l.match(/^(?:uniform\s+)?const\s+(?:in\s+)?(\w+)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/);
    if (m) {
      const nom = m[2];
      if (!(choix || CONST_CONNUS.has(nom) || MOTS_CLES.test(nom))) continue;
      const valeur = m[3].trim();
      if (valeur.length > 70) continue;
      if (!vus.has(nom)) vus.set(nom, { nom, type: 'const', actif: true, valeur, choix, fichier });
    }
  }
  return vus;
}

// Texte de langue : `option.NOM=Libelle`, `screen.NOM=Libelle`, `profile.NOM=Libelle`.
function lireLang(dossierShaders) {
  const f = ['lang/en_US.lang', 'lang/en_us.lang', 'lang/en_US.properties', 'lang/en_us.properties'].map((x) => path.join(dossierShaders, x)).find((x) => fs.existsSync(x));
  return f ? lireProperties(lire(f)).m : new Map();
}

// ---------------------------------------------------------------- profils
// `profile.NOM = profile.AUTRE OPT:val OPT !OPT` : on applique dans l'ordre. Retourne { OPT: valeur|true|false }.
export function resoudreProfil(nom, profils, vu = new Set()) {
  const etat = {};
  if (vu.has(nom) || !profils.has(nom)) return etat;
  vu.add(nom);
  for (const t of profils.get(nom)) {
    let p;
    if ((p = t.match(/^profile\.(.+)$/))) Object.assign(etat, resoudreProfil(p[1], profils, vu));
    else if ((p = t.match(/^!(.+)$/))) etat[p[1]] = false;
    else if ((p = t.match(/^([^:]+):(.+)$/))) etat[p[1]] = p[2];
    else etat[t] = true;
  }
  return etat;
}
const memeValeur = (a, b) => { const x = Number(a), y = Number(b); return Number.isFinite(x) && Number.isFinite(y) ? x === y : String(a) === String(b); };

// Profil dont les reglages collent le mieux a ce que le pack livre (options telles que declarees). Retourne { nom, exact, diff[] } ou null.
export function profilParDefaut(profils, options) {
  let meilleur = null;
  for (const nom of profils.keys()) {
    const etat = resoudreProfil(nom, profils);
    let bon = 0, total = 0;
    const diff = [];
    for (const [k, v] of Object.entries(etat)) {
      const o = options.get(k);
      if (!o) continue;                                             // option que l'on ne connait pas : on ne juge pas
      total++;
      const ok = typeof v === 'boolean' ? o.actif === v : o.actif && memeValeur(o.valeur, v);
      if (ok) bon++; else if (diff.length < 8) diff.push(`${k}=${v === true ? 'on' : v === false ? 'off' : v} (livre : ${o.actif ? o.valeur || 'on' : 'off'})`);
    }
    const score = total ? bon / total : 0;
    if (!meilleur || score > meilleur.score || (score === meilleur.score && total > meilleur.total)) meilleur = { nom, exact: total > 0 && bon === total, diff, score, total };
  }
  return meilleur;
}

// ---------------------------------------------------------------- resume
function decrire(o) {
  const ch = o.choix && o.choix.length ? ' [' + (o.choix.length > 8 ? o.choix.slice(0, 8).join(' ') + ' ...' : o.choix.join(' ')) + ']' : '';
  if (o.type === 'define' && !o.valeur) return `${o.actif ? '+' : '-'}${o.nom}${ch}`;
  return `${o.nom}=${o.valeur}${o.actif ? '' : '(off)'}${ch}${o.type === 'const' ? ' (const)' : ''}`;
}

// Nom et version : pack.mcmeta, puis premier texte d'un readme, puis commentaire de tete de shaders.properties, puis nom du zip.
function identite(dossier, racine, nomZip, tete) {
  const R = (...p) => path.join(dossier, racine, ...p);
  let nom = '';
  try { nom = String(JSON.parse(lire(R('pack.mcmeta'))).pack.description || '').replace(/§./g, '').replace(/\s+/g, ' ').trim(); } catch { /* pas de mcmeta lisible */ }
  let tex = '';
  for (const f of lister(path.join(dossier, racine)).filter((x) => !x.includes('/') || /^shaders\/[^/]+$/.test(x))) if (/^(shaders\/)?(readme|read_me|lisezmoi|changelog)[^/]*$/i.test(f)) { tex = lire(R(f)).split(/\r?\n/).filter((l) => l.trim()).slice(0, 8).join(' '); break; }
  const teteTxt = (tete || []).join(' ');
  if (!nom || nom.length > 80) nom = (tex.slice(0, 60) || teteTxt.slice(0, 60) || nomZip).trim();
  const v = (nomZip + ' ' + tex + ' ' + teteTxt + ' ' + nom).match(/\bv?(\d+(?:\.\d+){1,3}[a-z]?\d*)\b/i);
  return { nom: nom.slice(0, 80), version: v ? v[1] : '' };
}

// Retourne { texte, ... } : texte = le resume a afficher. `dossier` : ou defaire. Lance defaire() lui-meme.
export async function extraire(zipChemin, dossier) {
  const nomZip = path.basename(zipChemin).replace(/\.zip$/i, '');
  const d = await defaire(zipChemin, dossier);
  const tous = lister(dossier);
  const racine = trouverRacine(tous);
  if (racine === null) throw new Error('ce zip ne contient pas de dossier "shaders/" : ce n\'est pas un pack de shaders Iris/OptiFine');
  const pre = racine ? racine + '/' : '';
  const sh = tous.filter((f) => f.startsWith(pre + 'shaders/')).map((f) => f.slice(pre.length));   // relatif a la racine du pack
  const dossierShaders = path.join(dossier, racine, 'shaders');

  const props = lireProperties(lire(path.join(dossier, racine, 'shaders', 'shaders.properties')));
  const profils = new Map();
  for (const [k, v] of props.m) { const p = k.match(/^profile\.(.+)$/); if (p && p[1] !== 'comment') profils.set(p[1], v.split(/\s+/).filter(Boolean)); }

  // options : tous les fichiers de code et de reglages du pack (le premier qui declare une option gagne ; world0 passe avant les autres)
  const codes = sh.filter((f) => /\.(fsh|vsh|gsh|csh|glsl|inc|h)$/i.test(f)).sort((a, b) => (/^shaders\/(lib|common|settings)|shaders\/[^/]+$/i.test(a) ? 0 : 1) - (/^shaders\/(lib|common|settings)|shaders\/[^/]+$/i.test(b) ? 0 : 1) || (a < b ? -1 : 1));
  const options = new Map(), parFichier = new Map();
  for (const f of codes) {
    const avant = options.size;
    lireOptions(lire(path.join(dossier, racine, f)), f, options);
    if (options.size > avant) parFichier.set(f, options.size - avant);
  }
  const lang = lireLang(dossierShaders);
  const id = identite(dossier, racine, nomZip, props.tete);
  const prof = profils.size ? profilParDefaut(profils, options) : null;

  // ecrans : screen = [A] [B] option ... ; screen.A = ...
  const ecrans = [];
  const vus = new Set();
  const ajouterEcran = (cle, nom) => {
    const jetons = (props.m.get(cle) || '').split(/\s+/).filter(Boolean);
    const opts = [];
    for (const t of jetons) { const o = options.get(t); if (o && !vus.has(t)) { opts.push(o); vus.add(t); } }
    if (opts.length) ecrans.push({ nom: (lang.get('screen.' + nom) || nom).slice(0, 30), opts });
  };
  for (const k of props.m.keys()) { const s = k.match(/^screen\.(.+)$/); if (s && !/\.columns$/.test(k)) ajouterEcran(k, s[1]); }
  ajouterEcran('screen', '(principal)');
  const reste = [...options.values()].filter((o) => !vus.has(o.nom));
  const note = (o) => (MOTS_CLES.test(o.nom) ? 0 : 1) + (o.choix ? 0 : 0.5) + (o.type === 'const' ? -0.25 : 0);
  reste.sort((a, b) => note(a) - note(b));
  if (reste.length) ecrans.push({ nom: ecrans.length ? 'hors ecran' : 'options', opts: reste });

  const L = [];
  L.push(`pack : ${id.nom || nomZip}${id.version ? ' (v' + id.version + ')' : ''} | ${d.fichiers} fichiers texte extraits (${(d.octets / 1024).toFixed(0)} Ko), ${d.ignores} autres ignores (images...)`);
  if (profils.size) {
    L.push(`profils (${profils.size}) : ${[...profils.keys()].slice(0, 12).join(', ')}${profils.size > 12 ? ', ...' : ''}`);
    if (prof) L.push(prof.exact ? `profil par defaut : ${prof.nom} (ses reglages = ceux livres dans les #define)` : prof.total ? `profil par defaut : aucun ne colle exactement ; le plus proche : ${prof.nom}${prof.diff.length ? ' ; differences : ' + prof.diff.join(', ') : ''}` : 'profil par defaut : indetermine (les options des profils sont introuvables) ; prends les #define tels que livres');
  } else L.push('profils : aucun ; prends les #define tels que livres');
  const dims = [...new Set(sh.map((f) => f.split('/')[1]).filter((n) => /^world-?\d+$|^dim/i.test(n) || /^dimension/.test(n)))];
  const scal = ['clouds', 'sun', 'moon', 'vignette', 'underwaterOverlay', 'oldLighting', 'shadow.culling'].filter((k) => props.m.has(k)).map((k) => `${k}=${props.m.get(k)}`);
  L.push(`dossiers : ${dims.length ? dims.join(' ') : '(pas de world*, un seul jeu de fichiers)'}${sh.some((f) => /\/block\.properties$/.test(f)) ? ' ; block.properties' : ''}${scal.length ? ' ; ' + scal.join(' ') : ''}`);
  const bp = lire(path.join(dossier, racine, 'shaders', 'block.properties'));
  if (bp) {
    const mots = ['leaves', 'grass', 'plant', 'crop', 'flower', 'lava', 'torch', 'glass', 'water'].filter((w) => new RegExp(w, 'i').test(bp));
    if (mots.length) L.push(`block.properties parle de : ${mots.join(', ')}`);
  }
  L.push('legende : +NOM = #define actif, -NOM = //#define eteint, NOM=valeur [choix]');

  let taille = L.join('\n').length, omis = 0, ecrit = 0;
  const total = options.size;
  for (const e of ecrans) {
    const morceaux = [];
    let ligne = `[${e.nom}] `;
    for (const o of e.opts) {
      const t = decrire(o);
      if (taille + ligne.length + t.length + 2 > BUDGET) { omis++; continue; }
      ligne += t + ' ';
      ecrit++;
      morceaux.push(t);
    }
    if (morceaux.length) { L.push(ligne.trim()); taille += ligne.length + 1; }
  }
  const fichiersOpts = [...parFichier].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([f, n]) => `${f} (${n})`);
  L.push(`${ecrit} options sur ${total}${omis ? ` ; ${omis} omises (ouvre le fichier au besoin)` : ''}. Fichiers de reglages : ${fichiersOpts.join(', ') || 'aucun trouve'}. Dossier complet : ${path.resolve(dossier, racine)}`);
  return { texte: L.join('\n'), nbOptions: total, ecrites: ecrit, omises: omis, profils: [...profils.keys()], defaut: prof ? prof.nom : null, exact: prof ? prof.exact : false, nom: id.nom, version: id.version, racine };
}
