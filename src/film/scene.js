// Fichier de scene : lecture, controle, pistes d'images cles, boucles.
// Le format est decrit dans docs/CONCEPTION.md (partie 3). Les messages d'erreur donnent le chemin du champ fautif.

export const LIMITE_OCTETS = 20 * 1024;
export const IMAGES_PAR_SECONDE = 30;
export const FORMATS = { '1920x1080': [1920, 1080], '1080x1920': [1080, 1920] };
const LISSAGES = new Set(['d', 's', 'x']);
const MEMBRES = ['brasD', 'brasG', 'jambeD', 'jambeG'];
const PISTES_BOUCLE = [...MEMBRES, 'tete', 'corps', 'lacet'];

export class ErreurScene extends Error {
  constructor(chemin, message) {
    super(chemin ? `scene.${chemin} : ${message}` : `scene : ${message}`);
    this.name = 'ErreurScene';
    this.chemin = chemin;
  }
}
const err = (chemin, msg) => { throw new ErreurScene(chemin, msg); };
const estNombre = (x) => typeof x === 'number' && Number.isFinite(x);
const estObjet = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// ---------------------------------------------------------------- lecture
// Texte -> objet. Refuse un fichier de plus de 20 Ko ou qui n'est pas du JSON.
export function lireJson(texte) {
  const octets = Buffer.byteLength(texte, 'utf8');
  if (octets > LIMITE_OCTETS) err('', `fichier trop gros (${octets} octets, maximum ${LIMITE_OCTETS})`);
  try { return JSON.parse(texte); } catch (e) { return err('', `JSON invalide (${e.message})`); }
}

// ---------------------------------------------------------------- pistes
// Une piste : { arite, cles: [{ t, v: [..arite nombres], l: 'd'|'s'|'x'|null }] }.
// `arite` : nombre de valeurs par cle (sans le temps). `minArite`/`maxArite` : tailles permises ; les cles
// plus courtes sont completees par 0 (ex. [t, avant] sans `cote`).
function lirePiste(brut, chemin, { minArite, maxArite, temps = [0, Infinity], completer = 0 }) {
  if (!Array.isArray(brut)) err(chemin, 'liste de cles attendue, par exemple [[0, 10], [1, 20]]');
  if (brut.length === 0) err(chemin, 'la piste est vide');
  const cles = [];
  let arite = minArite;
  brut.forEach((k, i) => {
    const ch = `${chemin}[${i}]`;
    if (!Array.isArray(k)) err(ch, 'une cle est une liste [temps, valeurs...]');
    let l = null;
    let n = k.length;
    if (typeof k[n - 1] === 'string') {
      l = k[n - 1];
      if (!LISSAGES.has(l)) err(ch, `lissage "${l}" inconnu (permis : "d", "s", "x")`);
      n--;
    }
    if (n < 1 || !estNombre(k[0])) err(ch, 'le premier element doit etre le temps (nombre)');
    const nv = n - 1;
    if (nv < minArite || nv > maxArite) {
      err(ch, minArite === maxArite ? `${minArite} valeur(s) apres le temps attendue(s), ${nv} trouvee(s)` : `entre ${minArite} et ${maxArite} valeurs apres le temps attendues, ${nv} trouvees`);
    }
    for (let j = 1; j < n; j++) if (!estNombre(k[j])) err(`${ch}[${j}]`, 'nombre attendu');
    const t = k[0];
    if (t < temps[0] || t > temps[1]) err(`${ch}[0]`, temps[1] === Infinity ? `le temps doit etre >= ${temps[0]}` : `le temps (une phase) doit etre entre ${temps[0]} et ${temps[1]}`);
    if (i > 0 && t < cles[i - 1].t) err(`${ch}[0]`, 'les cles doivent etre classees par temps croissant');
    arite = Math.max(arite, nv);
    cles.push({ t, v: k.slice(1, n), l });
  });
  for (const c of cles) while (c.v.length < arite) c.v.push(completer);
  return { arite, cles };
}

// Formes de lissage. u dans [0,1].
export const lissages = {
  d: (u) => u * u * (3 - 2 * u),               // doux : depart et arrivee ralentis
  s: (u) => (1 - Math.cos(Math.PI * u)) / 2,   // sinus
};

function melange(a, b, u, sortie) {
  for (let i = 0; i < sortie.length; i++) sortie[i] = a.v[i] + (b.v[i] - a.v[i]) * u;
  return sortie;
}

// Valeur d'une piste au temps t (secondes). Avant la premiere cle / apres la derniere : valeur de la cle la plus proche.
// Le lissage d'une cle s'applique au trajet qui ARRIVE a cette cle. Retourne un tableau de `arite` nombres.
export function evaluer(piste, t, sortie = new Array(piste.arite)) {
  const c = piste.cles;
  const n = c.length;
  if (t <= c[0].t) { for (let i = 0; i < piste.arite; i++) sortie[i] = c[0].v[i]; return sortie; }
  if (t >= c[n - 1].t) { for (let i = 0; i < piste.arite; i++) sortie[i] = c[n - 1].v[i]; return sortie; }
  let lo = 0, hi = n - 1; // plus grand lo tel que c[lo].t <= t
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid].t <= t) lo = mid; else hi = mid; }
  const a = c[lo], b = c[lo + 1];
  if (b.l === 'x') return melange(a, b, 0, sortie);          // saut : la valeur change d'un coup a b.t
  if (b.t === a.t) return melange(a, b, 1, sortie);
  let u = (t - a.t) / (b.t - a.t);
  if (b.l && lissages[b.l]) u = lissages[b.l](u);
  return melange(a, b, u, sortie);
}

// Piste de BOUCLE : le temps des cles est une phase 0..1 et la phase 1 rejoint la phase 0 (cycle ferme).
// Lissage par defaut : sinus. Une lettre sur une cle ("d", "x") change le trajet qui arrive a cette cle.
export function evaluerPhase(piste, phase, sortie = new Array(piste.arite)) {
  const c = piste.cles;
  const n = c.length;
  phase = phase - Math.floor(phase);
  // cles etendues : derniere cle decalee de -1, premiere cle decalee de +1 (fermeture du cycle)
  let a, b, ta, tb;
  if (phase < c[0].t) { a = c[n - 1]; ta = a.t - 1; b = c[0]; tb = b.t; }
  else if (phase >= c[n - 1].t) { a = c[n - 1]; ta = a.t; b = c[0]; tb = b.t + 1; }
  else {
    let lo = 0;
    while (lo < n - 1 && c[lo + 1].t <= phase) lo++;
    a = c[lo]; b = c[lo + 1]; ta = a.t; tb = b.t;
  }
  if (b.l === 'x') return melange(a, b, 0, sortie);
  let u = tb > ta ? (phase - ta) / (tb - ta) : 1;
  const f = b.l ? lissages[b.l] : lissages.s;
  u = f(Math.min(1, Math.max(0, u)));
  return melange(a, b, u, sortie);
}

// Poids d'une boucle au temps t : montee et descente douces de `fondu` secondes ; 0 hors de [de, a].
export function poidsBoucle(b, t) {
  if (t < b.de || t > b.a) return 0;
  if (!(b.fondu > 0)) return 1;
  const f = b.fondu;
  const entree = Math.min(1, (t - b.de) / f), sortie = Math.min(1, (b.a - t) / f);
  return lissages.d(Math.max(0, Math.min(entree, sortie)));
}

// ---------------------------------------------------------------- scene
// Controle et normalise un objet de scene. Retourne la scene prete a animer (pistes lues).
export function validerScene(s) {
  if (!estObjet(s)) err('', 'un objet JSON est attendu');
  if (s.v !== undefined && s.v !== 1) err('v', `version ${JSON.stringify(s.v)} non geree (seule la version 1 existe)`);
  if (typeof s.format !== 'string' || !FORMATS[s.format]) err('format', `"1920x1080" ou "1080x1920" attendu, pas ${JSON.stringify(s.format)}`);
  if (!estNombre(s.duree) || s.duree < 1 || s.duree > 30) err('duree', `entre 1 et 30 secondes attendu, pas ${JSON.stringify(s.duree)}`);
  if (typeof s.zone !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(s.zone)) err('zone', 'identifiant de zone attendu (22 caracteres : lettres, chiffres, - et _)');
  if (!Array.isArray(s.acteurs) || s.acteurs.length < 1) err('acteurs', 'au moins un acteur est attendu');
  if (s.acteurs.length > 10) err('acteurs', 'dix acteurs au maximum');

  const noms = new Set();
  const acteurs = s.acteurs.map((a, i) => {
    const ch = `acteurs[${i}]`;
    if (!estObjet(a)) err(ch, 'un objet est attendu');
    if (typeof a.nom !== 'string' || !a.nom) err(`${ch}.nom`, 'nom attendu (texte non vide)');
    if (noms.has(a.nom)) err(`${ch}.nom`, `le nom "${a.nom}" est deja pris`);
    noms.add(a.nom);
    if (a.skin !== undefined && (typeof a.skin !== 'string' || !a.skin)) err(`${ch}.skin`, 'texte attendu (pseudo, skin par defaut, "@identifiant" ou fichier PNG)');
    if (typeof a.skin === 'string' && a.skin.startsWith('@') && !/^@[A-Za-z0-9_-]{22}$/.test(a.skin)) err(`${ch}.skin`, '"@" doit etre suivi de l\'identifiant de 22 caracteres (lettres, chiffres, - et _) donne par lister_avatars');
    if (a.modele !== undefined && a.modele !== 'wide' && a.modele !== 'slim') err(`${ch}.modele`, '"wide" ou "slim" attendu');
    if (a.pos === undefined) err(`${ch}.pos`, 'piste de position obligatoire : [[t, x, z], ...] ou [[t, x, y, z], ...]');
    const pos = lirePiste(a.pos, `${ch}.pos`, { minArite: 2, maxArite: 3 });
    // melange de cles a 2 et 3 valeurs : permis ; y vaut NaN sur les cles a 2 valeurs (sol automatique)
    const cles = a.pos.map((k, j) => {
      const sansLettre = typeof k[k.length - 1] === 'string' ? k.slice(0, -1) : k;
      return { t: pos.cles[j].t, l: pos.cles[j].l, x: sansLettre[1], y: sansLettre.length === 4 ? sansLettre[2] : NaN, z: sansLettre[sansLettre.length - 1] };
    });
    const o = {
      nom: a.nom, skin: a.skin ?? 'steve', modele: a.modele ?? null,
      pos: { cles }, objet: typeof a.objet === 'string' ? a.objet : null, boucles: [],
    };
    if (a.lacet !== undefined) o.lacet = lirePiste(a.lacet, `${ch}.lacet`, { minArite: 1, maxArite: 1 });
    if (a.tete !== undefined) o.tete = lirePiste(a.tete, `${ch}.tete`, { minArite: 2, maxArite: 2 });
    if (a.corps !== undefined) o.corps = lirePiste(a.corps, `${ch}.corps`, { minArite: 1, maxArite: 1 });
    if (a.accroupi !== undefined) o.accroupi = lirePiste(a.accroupi, `${ch}.accroupi`, { minArite: 1, maxArite: 1 });
    for (const m of MEMBRES) if (a[m] !== undefined) o[m] = lirePiste(a[m], `${ch}.${m}`, { minArite: 1, maxArite: 2 });
    if (a.boucles !== undefined) {
      if (!Array.isArray(a.boucles)) err(`${ch}.boucles`, 'liste de boucles attendue');
      o.boucles = a.boucles.map((b, j) => lireBoucle(b, `${ch}.boucles[${j}]`, s.duree));
    }
    return o;
  });

  const camera = lireCamera(s.camera, noms);
  const sons = { pas: false, liste: [] };
  if (s.sons !== undefined) {
    if (!estObjet(s.sons)) err('sons', 'un objet est attendu, par exemple {"pas": true}');
    if (s.sons.pas !== undefined) { if (typeof s.sons.pas !== 'boolean') err('sons.pas', 'true ou false attendu'); sons.pas = s.sons.pas; }
    if (s.sons.liste !== undefined) {
      if (!Array.isArray(s.sons.liste)) err('sons.liste', 'liste [[t, "nom.du.son"], ...] attendue');
      sons.liste = s.sons.liste.map((e, i) => {
        if (!Array.isArray(e) || !estNombre(e[0]) || typeof e[1] !== 'string') err(`sons.liste[${i}]`, 'forme attendue : [temps, "nom.du.son"]');
        return { t: e[0], nom: e[1] };
      });
    }
  }
  const [largeur, hauteur] = FORMATS[s.format];
  return {
    v: 1, format: s.format, largeur, hauteur, duree: s.duree, zone: s.zone,
    images: Math.round(s.duree * IMAGES_PAR_SECONDE), acteurs, camera, sons,
  };
}

function lireBoucle(b, ch, duree) {
  if (!estObjet(b)) err(ch, 'un objet est attendu');
  if (!estNombre(b.de) || b.de < 0) err(`${ch}.de`, 'debut en secondes attendu (>= 0)');
  if (!estNombre(b.a) || b.a <= b.de) err(`${ch}.a`, 'fin en secondes attendue, apres "de"');
  if (!estNombre(b.periode) || b.periode <= 0) err(`${ch}.periode`, 'duree d\'un cycle attendue (> 0, en secondes)');
  if (b.fondu !== undefined && (!estNombre(b.fondu) || b.fondu < 0)) err(`${ch}.fondu`, 'nombre >= 0 attendu');
  void duree;
  const o = { de: b.de, a: b.a, periode: b.periode, fondu: b.fondu ?? 0.2, pistes: {} };
  for (const nom of PISTES_BOUCLE) {
    if (b[nom] === undefined) continue;
    const a = nom === 'tete' ? { minArite: 2, maxArite: 2 } : nom === 'corps' || nom === 'lacet' ? { minArite: 1, maxArite: 1 } : { minArite: 1, maxArite: 2 };
    o.pistes[nom] = lirePiste(b[nom], `${ch}.${nom}`, { ...a, temps: [0, 1] });
  }
  return o;
}

function lireCamera(c, noms) {
  if (!estObjet(c)) err('camera', 'un objet est attendu, par exemple {"suit": "heros", "decalage": [[0, 0, 2, 4]]}');
  const o = { fov: [[0, 70]] };
  o.fov = c.fov !== undefined ? lirePiste(c.fov, 'camera.fov', { minArite: 1, maxArite: 1 }) : { arite: 1, cles: [{ t: 0, v: [70], l: null }] };
  for (const k of o.fov.cles) if (k.v[0] < 10 || k.v[0] > 150) err('camera.fov', `angle de vue entre 10 et 150 degres attendu, pas ${k.v[0]}`);
  if (c.suit !== undefined) {
    if (typeof c.suit !== 'string' || !noms.has(c.suit)) err('camera.suit', `acteur inconnu : ${JSON.stringify(c.suit)} (acteurs : ${[...noms].join(', ')})`);
    if (c.pos !== undefined) err('camera.pos', '"suit" et "pos" ensemble : choisissez l\'un ou l\'autre');
    o.mode = 'suit'; o.suit = c.suit;
    o.decalage = c.decalage !== undefined ? lirePiste(c.decalage, 'camera.decalage', { minArite: 3, maxArite: 3 }) : { arite: 3, cles: [{ t: 0, v: [0, 2, 4], l: null }] };
  } else if (c.pos !== undefined) {
    o.mode = 'libre';
    o.pos = lirePiste(c.pos, 'camera.pos', { minArite: 3, maxArite: 3 });
    if (c.regarde !== undefined) {
      if (typeof c.regarde !== 'string' || !noms.has(c.regarde)) err('camera.regarde', `acteur inconnu : ${JSON.stringify(c.regarde)}`);
      o.regarde = c.regarde;
    } else if (c.cible !== undefined) o.cible = lirePiste(c.cible, 'camera.cible', { minArite: 3, maxArite: 3 });
    else err('camera', '"pos" demande aussi "cible" (points a regarder) ou "regarde" (nom d\'un acteur)');
  } else err('camera', 'il faut "suit" (avec "decalage") ou "pos" (avec "cible" ou "regarde")');
  if (c.suit !== undefined && c.regarde !== undefined) { /* "suit" vise deja la tete : "regarde" ignore */ }
  return o;
}

// Lit un texte de scene : retourne { brut, scene }. `brut` sert a l'empreinte.
export function lireScene(texte) {
  const brut = lireJson(texte);
  return { brut, scene: validerScene(brut) };
}

export { animer } from './anim.js';
