// Montage audio : mixage des fichiers donnes par l'utilisateur (voix off, musique, effets) PAR-DESSUS
// le tampon PCM de la scene (bruits de pas, sons du jeu), avec ducking et normalisation en LUFS.
//
// Choix : mixerFichiers() est SYNCHRONE (ffmpeg est lance avec spawnSync, comme dans film/sons.js).
// mesurerSon() est asynchrone (spawn). Tout le calcul se fait en Float32, stereo entrelace, 44100 Hz.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { FREQUENCE } from '../film/sons.js';

export const MAX_ENTREES = 24;
const EXT_AUDIO = /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i;
const CRETE_NORMALISE = -1;            // dBFS : la normalisation ne depasse jamais cette crete
const GENOU_LIMITEUR = 0.95;           // en dessous, le limiteur final ne touche a rien
const SOUS_VOIX_DEFAUT = { gain: 0.3, attaque: 0.05, relache: 0.4, seuil: -45 };

const nombre = (v) => typeof v === 'number' && Number.isFinite(v);
const db = (lineaire) => (lineaire > 0 ? 20 * Math.log10(lineaire) : -Infinity);
const fini = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const sec = (v) => Math.round(v * 100) / 100;

// ================================================================ validation
// brutListe : valeur de sons.fichiers. erreur(chemin, message) est fournie par l'appelant et doit lever.
export function lireEntreesFichiers(brutListe, { duree, erreur }) {
  const err = (chemin, message) => {
    if (typeof erreur === 'function') erreur(chemin, message);
    throw new Error(`${chemin} : ${message}`);
  };
  if (brutListe === undefined || brutListe === null) return [];
  if (!Array.isArray(brutListe)) err('sons.fichiers', 'doit etre une liste [[t, "fichier.mp3", volume?, options?], ...]');
  if (brutListe.length > MAX_ENTREES) err('sons.fichiers', `${brutListe.length} entrees : le maximum est ${MAX_ENTREES}`);
  return brutListe.map((b, i) => lireEntree(b, `sons.fichiers[${i}]`, duree, err));
}

function lireEntree(b, c, duree, err) {
  if (!Array.isArray(b) || b.length < 2 || b.length > 4) err(c, 'doit etre [t, "fichier", volume?, options?]');
  const [t, nom, vol, opt] = b;
  if (!nombre(t) || t < 0 || t > duree) err(`${c}[0]`, `le temps doit etre un nombre entre 0 et ${duree} s (recu : ${JSON.stringify(t)})`);
  if (typeof nom !== 'string' || !nom.trim()) err(`${c}[1]`, 'le nom du fichier doit etre un texte non vide');
  if (nom.length > 200) err(`${c}[1]`, 'le nom du fichier est trop long (200 caracteres au maximum)');
  if (nom.includes('..')) err(`${c}[1]`, 'le nom du fichier ne doit pas contenir ".."');
  if (path.isAbsolute(nom) || /^[a-zA-Z]:/.test(nom)) err(`${c}[1]`, 'le chemin doit etre relatif au dossier de la scene');
  if (!EXT_AUDIO.test(nom)) err(`${c}[1]`, 'extension inconnue : attendu mp3, wav, ogg, m4a, aac, flac ou opus');

  // volume : nombre 0..4 ou piste [[t, vol], ...]
  let volume = 1, piste = null;
  if (vol === undefined || vol === null) { /* defaut */ }
  else if (nombre(vol)) {
    if (vol < 0 || vol > 4) err(`${c}[2]`, `le volume doit etre entre 0 et 4 (recu : ${vol})`);
    volume = vol;
  } else if (Array.isArray(vol)) {
    if (!vol.length || vol.length > 200) err(`${c}[2]`, 'la piste de volume doit avoir entre 1 et 200 points [[t, vol], ...]');
    piste = vol.map((p, k) => {
      if (!Array.isArray(p) || p.length !== 2) err(`${c}[2][${k}]`, 'un point de volume doit etre [t, vol]');
      if (!nombre(p[0]) || p[0] < 0 || p[0] > duree) err(`${c}[2][${k}][0]`, `le temps doit etre entre 0 et ${duree} s`);
      if (!nombre(p[1]) || p[1] < 0 || p[1] > 4) err(`${c}[2][${k}][1]`, 'le volume doit etre entre 0 et 4');
      return [p[0], p[1]];
    }).sort((a, b2) => a[0] - b2[0]);
  } else err(`${c}[2]`, 'le volume doit etre un nombre (0 a 4) ou une piste [[t, vol], ...]');

  // options
  let o = {};
  if (opt !== undefined && opt !== null) {
    if (typeof opt !== 'object' || Array.isArray(opt)) err(`${c}[3]`, 'les options doivent etre un objet { debut, duree, fondu, boucle, voix, sousVoix, pan }');
    o = opt;
  }
  const connues = ['debut', 'duree', 'fondu', 'boucle', 'voix', 'sousVoix', 'pan'];
  for (const k of Object.keys(o)) if (!connues.includes(k)) err(`${c}[3].${k}`, `option inconnue (options : ${connues.join(', ')})`);
  const cheminO = (k) => `${c}[3].${k}`;

  let debut = 0, dureeUtile = null;
  if (o.debut !== undefined) {
    if (!nombre(o.debut) || o.debut < 0 || o.debut > 36000) err(cheminO('debut'), 'doit etre un nombre de secondes >= 0');
    debut = o.debut;
  }
  if (o.duree !== undefined) {
    if (!nombre(o.duree) || o.duree <= 0 || o.duree > 36000) err(cheminO('duree'), 'doit etre un nombre de secondes > 0');
    dureeUtile = o.duree;
  }
  let fonduEntree = 0, fonduSortie = 0;
  if (o.fondu !== undefined) {
    const f = o.fondu;
    if (nombre(f)) {
      if (f < 0 || f > 600) err(cheminO('fondu'), 'doit etre >= 0 (secondes)');
      fonduEntree = fonduSortie = f;
    } else if (Array.isArray(f) && f.length === 2 && f.every((x) => nombre(x) && x >= 0 && x <= 600)) {
      [fonduEntree, fonduSortie] = f;
    } else err(cheminO('fondu'), 'doit etre un nombre (secondes) ou [entree, sortie]');
  }
  const booleen = (k) => {
    if (o[k] === undefined) return false;
    if (typeof o[k] !== 'boolean') err(cheminO(k), 'doit etre true ou false');
    return o[k];
  };
  const boucle = booleen('boucle'), voix = booleen('voix');
  let sousVoix = null;
  if (o.sousVoix !== undefined && o.sousVoix !== false) {
    const s = o.sousVoix;
    if (nombre(s)) {
      if (s < 0 || s > 1) err(cheminO('sousVoix'), 'le gain doit etre entre 0 et 1');
      sousVoix = { ...SOUS_VOIX_DEFAUT, gain: s };
    } else if (s && typeof s === 'object' && !Array.isArray(s)) {
      for (const k of Object.keys(s)) if (!(k in SOUS_VOIX_DEFAUT)) err(cheminO(`sousVoix.${k}`), 'cle inconnue (gain, attaque, relache, seuil)');
      sousVoix = { ...SOUS_VOIX_DEFAUT, ...s };
      const verifie = (k, mini, maxi, texte) => {
        if (!nombre(sousVoix[k]) || sousVoix[k] < mini || sousVoix[k] > maxi) err(cheminO(`sousVoix.${k}`), texte);
      };
      verifie('gain', 0, 1, 'doit etre entre 0 et 1');
      verifie('attaque', 0, 10, 'doit etre entre 0 et 10 secondes');
      verifie('relache', 0, 10, 'doit etre entre 0 et 10 secondes');
      verifie('seuil', -120, 0, 'doit etre entre -120 et 0 dBFS');
    } else err(cheminO('sousVoix'), 'doit etre un nombre (gain 0..1) ou un objet { gain, attaque, relache, seuil }');
  }
  if (voix && sousVoix) err(cheminO('sousVoix'), 'une piste "voix" ne peut pas baisser sous une autre voix');
  let pan = 0;
  if (o.pan !== undefined) {
    if (!nombre(o.pan) || o.pan < -1 || o.pan > 1) err(cheminO('pan'), 'doit etre entre -1 (gauche) et 1 (droite)');
    pan = o.pan;
  }
  return { t, fichier: nom, volume, piste, debut, duree: dureeUtile, fonduEntree, fonduSortie, boucle, voix, sousVoix, pan };
}

// ================================================================ ffmpeg
// Un fichier mono est duplique tel quel sur les 2 canaux (le mixage automatique de ffmpeg baisserait de 3 dB).
const argsDecodage = (f, canaux = 2) => ['-v', 'error', '-nostdin', '-i', f, ...(canaux === 1 ? ['-af', 'pan=stereo|c0=c0|c1=c0'] : ['-ac', '2']), '-f', 'f32le', '-ar', String(FREQUENCE), '-'];

// Lit canaux et frequence d'origine dans le texte que ffmpeg ecrit sur stderr.
function lireInfo(stderr) {
  const flux = /Audio:[^\n]*?,\s*(\d+) Hz,\s*([^,\n]+)/.exec(stderr);
  let frequence = FREQUENCE, canaux = 2;
  if (flux) {
    frequence = Number(flux[1]);
    const mise = flux[2].trim();
    if (/^mono/.test(mise)) canaux = 1;
    else if (/^stereo/.test(mise)) canaux = 2;
    else {
      const m = /^(\d+) channels/.exec(mise) || /^(\d+)\.(\d+)/.exec(mise);
      canaux = m ? Number(m[1]) + (m[2] ? Number(m[2]) : 0) : 2;
    }
  }
  return { frequence, canaux };
}

function versFloat32(buf) {
  const n = buf.length >> 2;
  const out = new Float32Array(n);
  new Uint8Array(out.buffer).set(buf.subarray(0, n * 4));   // copie : le Buffer n'est pas toujours aligne sur 4 octets
  return out;
}

function decoderSync(ffmpeg, chemin, nomAffiche) {
  if (!fs.existsSync(chemin)) throw new Error(`fichier audio introuvable : ${nomAffiche}`);
  const sonde = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-i', chemin], { encoding: 'utf8' });
  const r = spawnSync(ffmpeg, argsDecodage(chemin, lireInfo(String(sonde.stderr)).canaux), { maxBuffer: 1 << 30 });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg n'a pas pu lire ${nomAffiche} : ${String(r.error?.message || r.stderr).slice(0, 200)}`);
  const d = versFloat32(r.stdout);
  return d.length & 1 ? d.subarray(0, d.length - 1) : d;
}

function lancer(ffmpeg, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const sortie = [], erreurs = [];
    p.stdout.on('data', (c) => sortie.push(c));
    p.stderr.on('data', (c) => erreurs.push(c));
    p.on('error', (e) => reject(new Error(`ffmpeg ne se lance pas : ${e.message}`)));
    p.on('close', (status) => resolve({ status, stdout: Buffer.concat(sortie), stderr: Buffer.concat(erreurs).toString('utf8') }));
  });
}

// ================================================================ sonie (ITU-R BS.1770-4)
// Filtre K-weighting : etage 1 (haute etagere) puis etage 2 (passe-haut RLB), coefficients recalcules pour la frequence.
function filtresK(fs) {
  const f1 = 1681.974450955533, G = 3.999843853973347, Q1 = 0.7071752369554196;
  let K = Math.tan(Math.PI * f1 / fs);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q1 + K * K;
  const e1 = {
    b0: (Vh + Vb * K / Q1 + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q1 + K * K) / a0,
    a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q1 + K * K) / a0,
  };
  const f2 = 38.13547087602444, Q2 = 0.5003270373238773;
  K = Math.tan(Math.PI * f2 / fs);
  a0 = 1 + K / Q2 + K * K;
  const e2 = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q2 + K * K) / a0 };
  return [e1, e2];
}

// Sonie integree en LUFS. x : Float32Array entrelace (`canaux` canaux : 1 ou 2). -Infinity si trop court ou silencieux.
export function lufsIntegre(x, frequence = FREQUENCE, canaux = 2) {
  const frames = Math.floor(x.length / canaux);
  const pas = Math.round(0.1 * frequence), bloc = 4 * pas;     // blocs de 400 ms par pas de 100 ms
  if (frames < bloc) return -Infinity;
  const nPas = Math.floor(frames / pas);
  const sommes = new Float64Array(nPas);                         // somme des carres (tous canaux) par pas de 100 ms
  const [e1, e2] = filtresK(frequence);
  const fin = nPas * pas;
  for (let c = 0; c < canaux; c++) {
    let u1 = 0, u2 = 0, v1 = 0, v2 = 0;
    let k = 0, cpt = 0, acc = 0;
    for (let i = 0; i < fin; i++) {
      const s = x[i * canaux + c];
      let y = e1.b0 * s + u1; u1 = e1.b1 * s - e1.a1 * y + u2; u2 = e1.b2 * s - e1.a2 * y;
      const z = y;
      y = e2.b0 * z + v1; v1 = e2.b1 * z - e2.a1 * y + v2; v2 = e2.b2 * z - e2.a2 * y;
      acc += y * y;
      if (++cpt === pas) { sommes[k++] += acc; cpt = 0; acc = 0; }
    }
  }
  const nBlocs = nPas - 3;
  const energie = new Float64Array(nBlocs);
  for (let j = 0; j < nBlocs; j++) energie[j] = (sommes[j] + sommes[j + 1] + sommes[j + 2] + sommes[j + 3]) / bloc;
  const niveau = (z) => -0.691 + 10 * Math.log10(z);
  let somme = 0, cnt = 0;
  for (let j = 0; j < nBlocs; j++) if (energie[j] > 0 && niveau(energie[j]) > -70) { somme += energie[j]; cnt++; }
  if (!cnt) return -Infinity;
  const relatif = niveau(somme / cnt) - 10;
  somme = 0; cnt = 0;
  for (let j = 0; j < nBlocs; j++) if (energie[j] > 0 && niveau(energie[j]) > -70 && niveau(energie[j]) > relatif) { somme += energie[j]; cnt++; }
  return cnt ? niveau(somme / cnt) : -Infinity;
}

// ================================================================ voix et ducking
// Enveloppe 0..1 par echantillon (stereo entrelace en entree) : 1 quand la voix parle (RMS sur 20 ms > seuil dBFS), lissee.
export function enveloppeVoix(x, { frequence = FREQUENCE, seuil = -45, attaque = 0.05, relache = 0.4 } = {}) {
  const frames = x.length >> 1, w = Math.max(1, Math.round(0.02 * frequence));
  const env = new Float32Array(frames);
  const ca = attaque > 0 ? Math.exp(-1 / (attaque * frequence)) : 0;
  const cr = relache > 0 ? Math.exp(-1 / (relache * frequence)) : 0;
  let e = 0;
  for (let d = 0; d < frames; d += w) {
    const f = Math.min(frames, d + w);
    let s = 0;
    for (let i = d; i < f; i++) s += x[2 * i] * x[2 * i] + x[2 * i + 1] * x[2 * i + 1];
    const parle = s > 0 && 10 * Math.log10(s / (2 * (f - d))) > seuil;
    const cible = parle ? 1 : 0, c = parle ? ca : cr;
    for (let i = d; i < f; i++) { e = cible + (e - cible) * c; env[i] = e; }
  }
  return env;
}

// ================================================================ rendu d'une entree
// Retourne { debut (image de depart), data (Float32Array stereo) } ou null. Tout est applique sauf le ducking.
function rendre(e, src, n, notes) {
  const F = FREQUENCE, N = src.length >> 1;
  const debutScene = Math.round(e.t * F), restant = n - debutScene;
  if (restant <= 0) { notes.push(`${e.fichier} : commence a la fin de la scene, ignore`); return null; }
  const debutFichier = Math.round(e.debut * F);
  if (debutFichier >= N) { notes.push(`${e.fichier} : "debut" (${e.debut} s) depasse la fin du fichier (${sec(N / F)} s), ignore`); return null; }
  const dispo = N - debutFichier;
  const voulu = e.duree != null ? Math.round(e.duree * F) : null;
  let len;
  if (e.boucle) len = Math.min(voulu ?? restant, restant);
  else {
    len = voulu ?? dispo;
    if (voulu != null && voulu > dispo) notes.push(`${e.fichier} : fichier plus court que prevu (${sec(dispo / F)} s au lieu de ${e.duree} s)`);
    len = Math.min(len, dispo);
    if (len > restant) { notes.push(`${e.fichier} : fichier trop long, rogne a la fin de la scene (${sec(len / F)} s -> ${sec(restant / F)} s)`); len = restant; }
  }
  if (len <= 0) return null;
  const fi = Math.min(len, Math.round(e.fonduEntree * F)), fo = Math.min(len, Math.round(e.fonduSortie * F));
  const angle = ((e.pan + 1) * Math.PI) / 4;                   // puissance constante, centre = gain 1
  const gl = Math.cos(angle) * Math.SQRT2, gd = Math.sin(angle) * Math.SQRT2;
  const P = e.piste;
  let k = 0;
  const data = new Float32Array(len * 2);
  for (let i = 0; i < len; i++) {
    const si = 2 * (debutFichier + (e.boucle ? i % dispo : i));
    let g = e.volume;
    if (P) {
      const temps = (debutScene + i) / F;
      while (k + 1 < P.length && P[k + 1][0] <= temps) k++;
      if (temps <= P[0][0]) g = P[0][1];
      else if (k >= P.length - 1) g = P[k][1];
      else g = P[k][1] + (P[k + 1][1] - P[k][1]) * ((temps - P[k][0]) / (P[k + 1][0] - P[k][0]));
    }
    if (i < fi) g *= i / fi;
    const reste = len - 1 - i;
    if (reste < fo) g *= reste / fo;
    data[2 * i] = src[si] * g * gl;
    data[2 * i + 1] = src[si + 1] * g * gd;
  }
  return { debut: debutScene, data };
}

function ajouter(mix, debut, data, facteur = null) {
  const len = data.length >> 1;
  for (let i = 0; i < len; i++) {
    const f = facteur ? facteur(debut + i) : 1;
    mix[2 * (debut + i)] += data[2 * i] * f;
    mix[2 * (debut + i) + 1] += data[2 * i + 1] * f;
  }
}

// ================================================================ mixage (SYNCHRONE)
// pcm : Buffer s16le stereo 44100 de la scene (laisse intact s'il n'y a aucune entree). entrees : sortie de lireEntreesFichiers.
// normalise : nombre (cible LUFS), false (aucune), absent : -16 LUFS. Retourne { pcm, notes, mesures }.
export function mixerFichiers({ pcm, entrees, duree, baseDir, ffmpeg, normalise }) {
  const notes = [];
  if (!entrees || !entrees.length) return { pcm, notes, mesures: {} };
  const F = FREQUENCE;
  if (!pcm) pcm = Buffer.alloc(Math.ceil(duree * F) * 4);
  const n = pcm.length >> 2;
  const mix = new Float32Array(n * 2);
  for (let i = 0; i < n * 2; i++) mix[i] = pcm.readInt16LE(i * 2) / 32768;

  // decodage, un seul par fichier
  const cache = new Map();
  const source = (e) => {
    const chemin = path.resolve(baseDir || '.', e.fichier);
    if (!cache.has(chemin)) cache.set(chemin, decoderSync(ffmpeg, chemin, e.fichier));
    return cache.get(chemin);
  };

  // 1) les voix d'abord : elles servent de declencheur
  const voixSomme = entrees.some((e) => e.voix) ? new Float32Array(n * 2) : null;
  for (const e of entrees) {
    if (!e.voix) continue;
    const r = rendre(e, source(e), n, notes);
    if (!r) continue;
    ajouter(mix, r.debut, r.data);
    ajouter(voixSomme, r.debut, r.data);
  }
  // 2) les autres pistes, avec ducking si demande
  const enveloppes = new Map();
  let ducking = false;
  for (const e of entrees) {
    if (e.voix) continue;
    const r = rendre(e, source(e), n, notes);
    if (!r) continue;
    let facteur = null;
    if (e.sousVoix) {
      if (!voixSomme) notes.push(`${e.fichier} : "sousVoix" sans piste "voix" dans la scene, ignore`);
      else {
        const s = e.sousVoix, cle = `${s.seuil}|${s.attaque}|${s.relache}`;
        if (!enveloppes.has(cle)) enveloppes.set(cle, enveloppeVoix(voixSomme, { frequence: F, ...s }));
        const env = enveloppes.get(cle), baisse = 1 - s.gain;
        facteur = (i) => 1 - baisse * env[i];
        let actif = false;
        for (let i = 0; i < env.length; i += 441) if (env[i] > 0.5) { actif = true; break; }
        if (actif) { ducking = true; notes.push(`ducking actif : ${e.fichier} baisse a ${Math.round(s.gain * 100)} % pendant la voix`); }
        else notes.push(`${e.fichier} : aucune parole detectee au-dessus de ${s.seuil} dBFS, pas de ducking`);
      }
    }
    ajouter(mix, r.debut, r.data, facteur);
  }

  // 3) normalisation : UN gain, plafonne pour que la crete reste <= -1 dBFS
  const cible = normalise === false ? null : (normalise === undefined || normalise === true ? -16 : normalise);
  if (cible !== null && !nombre(cible)) throw new Error('normalise doit etre un nombre (LUFS), false ou absent');
  const crete = (x) => { let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } return m; };
  const lufsAvant = lufsIntegre(mix, F, 2);
  let gainDb = 0;
  if (cible !== null) {
    if (n < Math.round(0.4 * F)) notes.push('melange trop court (moins de 0,4 s) : pas de normalisation');
    else if (!(lufsAvant > -70)) notes.push('melange presque silencieux (sous -70 LUFS) : pas de normalisation');
    else {
      gainDb = cible - lufsAvant;
      const plafond = CRETE_NORMALISE - db(crete(mix));       // gain maximal pour garder la crete a -1 dBFS (un peu de marge)
      if (gainDb > plafond - 0.02) {
        gainDb = plafond - 0.02;
        notes.push(`gain de normalisation limite par la crete (-1 dBFS) : ${fini(gainDb)} dB, sonie finale sous la cible de ${cible} LUFS`);
      } else notes.push(`normalisation a ${cible} LUFS : gain de ${fini(gainDb)} dB`);
      const g = 10 ** (gainDb / 20);
      for (let i = 0; i < mix.length; i++) mix[i] *= g;
    }
  }

  // 4) limiteur final doux (rien en dessous du genou) puis s16le
  const k = GENOU_LIMITEUR, marge = 1 - k;
  const out = new Int16Array(n * 2);
  let max16 = 0;
  for (let i = 0; i < n * 2; i++) {
    let v = mix[i];
    const a = Math.abs(v);
    if (a > k) { v = Math.sign(v) * (k + marge * Math.tanh((a - k) / marge)); mix[i] = v; }
    const q = Math.max(-32768, Math.min(32767, Math.round(v * 32768)));
    out[i] = q;
    if (Math.abs(q) > max16) max16 = Math.abs(q);
  }
  const lufs = gainDb !== 0 || max16 / 32768 > k ? lufsIntegre(mix, F, 2) : lufsAvant;
  return {
    pcm: Buffer.from(out.buffer, out.byteOffset, out.byteLength),
    notes,
    mesures: { lufs: fini(lufs), lufsAvant: fini(lufsAvant), cretedB: fini(db(max16 / 32768)), gainDb: fini(gainDb), ducking, pistes: entrees.length },
  };
}

// ================================================================ mesure d'un fichier (commande `mcanim son duree`)
function silencesDe(data, F, seuil = -45, minDuree = 0.3, max = 8) {
  const frames = data.length >> 1, w = Math.max(1, Math.round(0.02 * F));
  const liste = [];
  let debut = null;
  const fermer = (fin) => {
    if (debut !== null && fin - debut > minDuree && liste.length < max) liste.push([Math.round(debut * 1000) / 1000, Math.round(fin * 1000) / 1000]);
    debut = null;
  };
  for (let d = 0; d < frames; d += w) {
    const f = Math.min(frames, d + w);
    let s = 0;
    for (let i = d; i < f; i++) s += data[2 * i] * data[2 * i] + data[2 * i + 1] * data[2 * i + 1];
    const silence = s === 0 || 10 * Math.log10(s / (2 * (f - d))) < seuil;
    if (silence) { if (debut === null) debut = d / F; } else fermer(d / F);
  }
  fermer(frames / F);
  return liste;
}

// -> { duree (s), lufs, creteDb, canaux, frequence, silences: [[debut, fin], ...] }
export async function mesurerSon(fichier, ffmpeg) {
  if (!fs.existsSync(fichier)) throw new Error(`fichier audio introuvable : ${fichier}`);
  // informations d'origine (canaux, frequence) : ffmpeg les ecrit sur stderr
  const info = await lancer(ffmpeg, ['-hide_banner', '-nostdin', '-i', fichier]);
  const { frequence, canaux } = lireInfo(info.stderr);
  const r = await lancer(ffmpeg, argsDecodage(fichier, canaux));
  if (r.status !== 0) throw new Error(`ffmpeg n'a pas pu lire ${fichier} : ${r.stderr.slice(0, 200)}`);
  let data = versFloat32(r.stdout);
  if (data.length & 1) data = data.subarray(0, data.length - 1);
  const frames = data.length >> 1;
  let mono = data;
  if (canaux === 1) { mono = new Float32Array(frames); for (let i = 0; i < frames; i++) mono[i] = data[2 * i]; }
  const lufs = lufsIntegre(mono, FREQUENCE, canaux === 1 ? 1 : 2);
  let pic = 0;
  for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > pic) pic = a; }
  return {
    duree: Math.round((frames / FREQUENCE) * 1000) / 1000,
    lufs: fini(lufs),
    creteDb: fini(db(pic)),
    canaux,
    frequence,
    silences: silencesDe(data, FREQUENCE),
  };
}
