// Montage : controle des champs facultatifs de la scene (plans, textes, sousTitres, incrustations, effets de camera).
// Tout est facultatif : une scene sans ces champs n'est pas touchee. Les erreurs donnent le chemin du champ (comme scene.js).
// `D` = { err(chemin, message), lirePiste, borner, lireTable, lireCamera, noms:Set } fournis par scene.js (evite un import circulaire).
import { lireCouleur } from '../incrust/toile.js';
import { casses } from '../incrust/texte.js';
import { decouperSousTitres } from './sous-titres.js';
import { pileMax } from '../moteur/contenus.js';
import { ENTREES, SORTIES, EMPHASES, NOMS_COURBES, ALIAS_TYPE } from './mouvement.js';

const estNombre = (x) => typeof x === 'number' && Number.isFinite(x);
const estObjet = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export const MAX_PLANS = 400, MAX_TEXTES = 1200, MAX_INCRUSTATIONS = 400;
export const TRANSITIONS = ['coupe', 'fondu', 'flash', 'file'];
export const DUREE_TRANSITION = { coupe: 0, fondu: 0.4, flash: 4 / 30, file: 5 / 30 };

// Mot le plus proche (distance d'edition <= 2) : "voulais-tu ...".
function proche(mot, liste) {
  let meilleur = null, md = 3;
  for (const l of liste) {
    const a = mot.toLowerCase(), b = l.toLowerCase();
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (d[a.length][b.length] < md) { md = d[a.length][b.length]; meilleur = l; }
  }
  return meilleur;
}
function champsConnus(D, o, permis, chemin) {
  for (const k of Object.keys(o)) if (!permis.includes(k)) { const p = proche(k, permis); D.err(`${chemin}.${k}`, `champ inconnu${p ? ` (voulais-tu "${p}" ?)` : ''} ; permis : ${permis.join(', ')}`); }
}
const nombreEntre = (D, v, ch, lo, hi, def) => {
  if (v === undefined) return def;
  if (!estNombre(v) || v < lo || v > hi) D.err(ch, `nombre entre ${lo} et ${hi} attendu, pas ${JSON.stringify(v)}`);
  return v;
};
const couleurDe = (D, v, ch, def = null) => {
  if (v === undefined) return def;
  const c = lireCouleur(v);
  if (!c) D.err(ch, `couleur attendue : nom du jeu (red, gold, yellow...), "#rrggbb" ou [r,g,b], pas ${JSON.stringify(v)}`);
  return c;
};

// ---------------------------------------------------------------- effets de camera (dans un objet `camera`, a la racine ou dans un plan)
export const CLES_EFFETS_CAMERA = ['roulis', 'secousse', 'coupZoom', 'flouFile', 'flouAuto', 'flouRadial', 'profondeurChamp'];
export function lireEffetsCamera(D, c, chemin) {
  const e = {};
  if (c.roulis !== undefined) e.roulis = D.borner(D.lirePiste(c.roulis, `${chemin}.roulis`, { minArite: 1, maxArite: 1 }), `${chemin}.roulis`, -60, 60);
  if (c.secousse !== undefined) e.secousse = lireEvenements(D, c.secousse, `${chemin}.secousse`, [{ nom: 'amplitude', lo: 0, hi: 20 }, { nom: 'frequence', lo: 0.5, hi: 60, def: 14 }, { nom: 'decay', lo: 0.02, hi: 10, def: 0.4 }], 'amplitude en degres');
  if (c.coupZoom !== undefined) e.coupZoom = lireEvenements(D, c.coupZoom, `${chemin}.coupZoom`, [{ nom: 'amplitude', lo: 0, hi: 0.8 }, { nom: 'duree', lo: 0.03, hi: 3, def: 0.15 }, { nom: 'flou', lo: 0, hi: 0.3, def: 0 }], 'amplitude : part de champ de vue en moins');
  if (c.flouFile !== undefined) e.flouFile = D.borner(D.lirePiste(c.flouFile, `${chemin}.flouFile`, { minArite: 1, maxArite: 2 }), `${chemin}.flouFile`, [0, -360], [0.3, 360]);
  if (c.flouAuto !== undefined) e.flouAuto = nombreEntre(D, c.flouAuto, `${chemin}.flouAuto`, 0, 1);
  if (c.flouRadial !== undefined) e.flouRadial = D.borner(D.lirePiste(c.flouRadial, `${chemin}.flouRadial`, { minArite: 1, maxArite: 1 }), `${chemin}.flouRadial`, 0, 0.3);
  if (c.profondeurChamp !== undefined) {
    const p = c.profondeurChamp, ch = `${chemin}.profondeurChamp`;
    if (!estObjet(p)) D.err(ch, 'objet attendu, par exemple {"mise": "heros", "force": 0.6}');
    champsConnus(D, p, ['mise', 'force', 'zone'], ch);
    const o = { force: [[0, 0.5]], zone: null };
    if (typeof p.mise === 'string') { if (!D.noms.has(p.mise)) D.err(`${ch}.mise`, `acteur inconnu : ${JSON.stringify(p.mise)}`); o.acteur = p.mise; }
    else if (estNombre(p.mise)) { if (p.mise <= 0 || p.mise > 500) D.err(`${ch}.mise`, 'distance de mise au point entre 0 et 500 blocs'); o.distance = D.lirePiste([[0, p.mise]], `${ch}.mise`, { minArite: 1, maxArite: 1 }); }
    else if (Array.isArray(p.mise)) o.distance = D.borner(D.lirePiste(p.mise, `${ch}.mise`, { minArite: 1, maxArite: 1 }), `${ch}.mise`, 0.1, 500);
    else D.err(`${ch}.mise`, 'nom d\'un acteur, distance en blocs ou piste [[t, distance]] attendus');
    if (p.force !== undefined) o.force = D.borner(D.lirePiste(typeof p.force === 'number' ? [[0, p.force]] : p.force, `${ch}.force`, { minArite: 1, maxArite: 1 }), `${ch}.force`, 0, 1);
    else o.force = D.lirePiste([[0, 0.5]], ch, { minArite: 1, maxArite: 1 });
    if (p.zone !== undefined) o.zone = nombreEntre(D, p.zone, `${ch}.zone`, 0, 200);
    e.champ = o;
  }
  return Object.keys(e).length ? e : null;
}
// Evenements [[t, v1, v2...]] : suite d'objets { t, valeurs }.
function lireEvenements(D, brut, ch, champs, aide) {
  if (!Array.isArray(brut) || brut.length === 0) D.err(ch, `liste d'evenements attendue, par exemple [[2.5, ${champs[0].hi / 4}]] (${aide})`);
  if (brut.length > 32) D.err(ch, '32 evenements au maximum');
  return brut.map((k, i) => {
    const c = `${ch}[${i}]`;
    if (!Array.isArray(k) || !estNombre(k[0]) || k[0] < 0) D.err(c, `forme attendue : [temps, ${champs.map((x) => x.nom).join(', ')}]`);
    if (k.length - 1 > champs.length || k.length < 2) D.err(c, `entre 1 et ${champs.length} valeur(s) apres le temps : ${champs.map((x) => x.nom).join(', ')}`);
    const v = champs.map((f, j) => (k[j + 1] === undefined ? f.def : (estNombre(k[j + 1]) && k[j + 1] >= f.lo && k[j + 1] <= f.hi ? k[j + 1] : D.err(`${c}[${j + 1}]`, `${f.nom} : nombre entre ${f.lo} et ${f.hi} attendu`))));
    return { t: k[0], v };
  });
}

// ---------------------------------------------------------------- plans
// Plan : { de, a, camera, transition?, duree?, couleur?, direction?, force?, pan?, vitesse?, arret?, image? }. Les temps des pistes DANS un plan
// (camera, vitesse, arret, image) sont relatifs au debut du plan (0 = debut du plan).
export function lirePlans(D, brut, duree, images) {
  const ch = 'plans';
  if (!Array.isArray(brut) || !brut.length) D.err(ch, 'liste de plans attendue, par exemple [{"de":0,"a":2,"camera":{...}}]');
  if (brut.length > MAX_PLANS) D.err(ch, `${MAX_PLANS} plans au maximum`);
  let fin = 0;
  return brut.map((p, i) => {
    const c = `${ch}[${i}]`;
    if (!estObjet(p)) D.err(c, 'un objet est attendu');
    champsConnus(D, p, ['de', 'a', 'camera', 'transition', 'duree', 'couleur', 'direction', 'force', 'pan', 'vitesse', 'arret', 'image'], c);
    if (!estNombre(p.de) || p.de < 0) D.err(`${c}.de`, 'debut en secondes attendu (>= 0)');
    if (!estNombre(p.a) || p.a <= p.de) D.err(`${c}.a`, 'fin en secondes attendue, apres "de"');
    if (p.a > duree + 1e-9) D.err(`${c}.a`, `la fin (${p.a}) depasse la duree de la scene (${duree})`);
    if (p.de < fin - 1e-9) D.err(`${c}.de`, 'les plans doivent etre classes et ne pas se chevaucher');
    fin = p.a;
    if (!estObjet(p.camera)) D.err(`${c}.camera`, 'camera attendue (comme le champ camera de la scene : "suit"+"decalage" ou "pos"+"cible"/"regarde")');
    const o = { de: p.de, a: p.a, i0: Math.min(images, Math.round(p.de * 30)), i1: Math.min(images, Math.round(p.a * 30)), camera: D.lireCamera(p.camera, D.noms, `${c}.camera`), transition: 'coupe', duree: 0 };
    if (p.transition !== undefined) {
      if (!TRANSITIONS.includes(p.transition)) D.err(`${c}.transition`, `une de : ${TRANSITIONS.join(', ')}`);
      o.transition = p.transition;
    }
    o.duree = nombreEntre(D, p.duree, `${c}.duree`, 0.03, 3, DUREE_TRANSITION[o.transition]);
    if (o.transition !== 'coupe') {
      o.couleur = couleurDe(D, p.couleur, `${c}.couleur`, o.transition === 'flash' ? [255, 255, 255, 255] : [0, 0, 0, 255]);
      if (i === 0 && o.transition !== 'flash') D.err(`${c}.transition`, 'le premier plan n\'a pas de plan avant lui : seule la transition "flash" y a un sens');
    }
    if (o.transition === 'file') { o.direction = nombreEntre(D, p.direction, `${c}.direction`, -360, 360, 0); o.force = nombreEntre(D, p.force, `${c}.force`, 0, 0.3, 0.12); o.pan = nombreEntre(D, p.pan, `${c}.pan`, 0, 120, 35); }
    if (p.vitesse !== undefined) {
      const piste = typeof p.vitesse === 'number' ? [[0, p.vitesse]] : p.vitesse;
      o.vitesse = D.borner(D.lirePiste(piste, `${c}.vitesse`, { minArite: 1, maxArite: 1 }), `${c}.vitesse`, 0, 8);
    }
    if (p.arret !== undefined) {
      if (!Array.isArray(p.arret) || p.arret.length > 8) D.err(`${c}.arret`, 'liste d\'intervalles [[debut, fin]] attendue (temps du plan, 8 au plus)');
      let f = 0;
      o.arret = p.arret.map((g, j) => {
        if (!Array.isArray(g) || g.length !== 2 || !estNombre(g[0]) || !estNombre(g[1]) || g[0] < 0 || g[1] <= g[0]) D.err(`${c}.arret[${j}]`, 'forme attendue : [debut, fin] avec 0 <= debut < fin');
        if (g[0] < f) D.err(`${c}.arret[${j}][0]`, 'intervalles classes et sans chevauchement');
        f = g[1]; return [g[0], g[1]];
      });
    }
    if (p.image !== undefined) o.image = D.lireTable(p.image, `${c}.image`);
    return o;
  });
}

// ---------------------------------------------------------------- styles de texte (communs aux legendes et aux incrustations)
export const CLES_STYLE = ['couleur', 'couleurs', 'accent', 'couleurAccent', 'gras', 'italique', 'contour', 'ombre', 'casse', 'largeurMax', 'interligne', 'fond', 'marge', 'alignement', 'taille', 'police'];
function lireStyle(D, o, ch, def = {}) {
  const s = { ...def };
  if (o.couleur !== undefined) s.couleur = couleurDe(D, o.couleur, `${ch}.couleur`);
  if (o.couleurs !== undefined) {
    if (!estObjet(o.couleurs)) D.err(`${ch}.couleurs`, 'objet {"mot": "couleur"} attendu');
    s.couleurs = {};
    for (const [k, v] of Object.entries(o.couleurs)) s.couleurs[k] = couleurDe(D, v, `${ch}.couleurs.${k}`);
  }
  if (o.couleurAccent !== undefined) s.couleurAccent = couleurDe(D, o.couleurAccent, `${ch}.couleurAccent`);
  if (o.accent !== undefined) {
    if (!Array.isArray(o.accent) || o.accent.some((x) => !Number.isInteger(x) || x < 0)) D.err(`${ch}.accent`, 'liste de numeros de mots (0 = premier mot) attendue');
    s.accent = o.accent;
  }
  for (const k of ['gras', 'italique']) if (o[k] !== undefined) { if (typeof o[k] !== 'boolean') D.err(`${ch}.${k}`, 'true ou false attendu'); s[k] = o[k]; }
  if (o.contour !== undefined) {
    if (o.contour === false || o.contour === null) s.contour = null;
    else if (o.contour === true) s.contour = { couleur: [10, 10, 10, 255], ep: 0.06 };
    else if (estObjet(o.contour)) { champsConnus(D, o.contour, ['couleur', 'epaisseur'], `${ch}.contour`); s.contour = { couleur: couleurDe(D, o.contour.couleur, `${ch}.contour.couleur`, [10, 10, 10, 255]), ep: nombreEntre(D, o.contour.epaisseur, `${ch}.contour.epaisseur`, 0, 0.5, 0.06) }; }
    else D.err(`${ch}.contour`, 'true, false ou {"couleur":"#000","epaisseur":0.06} (epaisseur : part de la taille du texte)');
  }
  if (o.police !== undefined) { if (o.police !== 'sans' && o.police !== 'jeu') D.err(`${ch}.police`, '"jeu" (police du jeu ou du texture pack joint, defaut) ou "sans" (gras rond lisible)'); s.police = o.police; }
  if (o.ombre !== undefined) { if (typeof o.ombre !== 'boolean') D.err(`${ch}.ombre`, 'true ou false attendu'); s.ombre = o.ombre; }
  if (o.casse !== undefined) { if (!casses.includes(o.casse)) D.err(`${ch}.casse`, `une de : ${casses.join(', ')}`); s.casse = o.casse; }
  s.largeurMax = nombreEntre(D, o.largeurMax, `${ch}.largeurMax`, 0.05, 1.5, s.largeurMax);
  s.interligne = nombreEntre(D, o.interligne, `${ch}.interligne`, 6, 20, s.interligne);
  if (o.fond !== undefined) s.fond = o.fond === false || o.fond === null ? null : couleurDe(D, o.fond, `${ch}.fond`);
  s.marge = nombreEntre(D, o.marge, `${ch}.marge`, 0, 6, s.marge);
  if (o.alignement !== undefined) { if (!['gauche', 'centre', 'droite'].includes(o.alignement)) D.err(`${ch}.alignement`, '"gauche", "centre" ou "droite"'); s.alignement = o.alignement; }
  s.taille = nombreEntre(D, o.taille, `${ch}.taille`, 0.01, 0.4, s.taille);
  return s;
}
// Defauts des legendes : mesures sur les 4 videos de reference (analyse/10-videos-reference.md) : ligne de 0,065 du petit cote (70 px sur 1080),
// blanc, contour sombre epais, centree, a 68 % de la hauteur, 1 a 3 mots.
// Police par defaut des legendes : "sans" (gras rond lisible, comme les 4 videos : capitales tres grasses, ombre douce, contour fin) ; "jeu" = police pixel du jeu
// (contour epais, taille 0,06). Hauteur de capitale mesuree sur V1 et V3 : 2,45 % de la hauteur de l'image = taille 0,055 de cette police ; releve a 0,06 (capitale 2,9 % mesuree en pixels blancs, comme la police du jeu) : les legendes d'un telephone se lisent a bout de bras.
export const STYLE_LEGENDE = { taille: 0.06, couleur: [255, 255, 255, 255], gras: true, police: 'sans', contour: { couleur: [8, 8, 8, 255], ep: 0.05 }, ombre: true, alignement: 'centre', largeurMax: 1, interligne: 9, marge: 0 };
export const STYLE_LEGENDE_JEU = { taille: 0.06, couleur: [255, 255, 255, 255], gras: true, police: 'jeu', contour: { couleur: [8, 8, 8, 255], ep: 0.16 }, ombre: true, alignement: 'centre', largeurMax: 1, interligne: 9, marge: 0 };
// Decision du proprietaire (16/11/2026) : la police par defaut est celle du jeu (ou celle du texture pack joint) ; "sans" seulement sur demande.
const styleLegende = (opt) => ({ ...(opt.police === 'sans' ? STYLE_LEGENDE : STYLE_LEGENDE_JEU) });
// Positions nommees : fractions de la ZONE SURE (docs/MONTAGE.md), pas de l'image : "bas" = le bas de la zone sure. "legende" (defaut des sous-titres) :
// la bande ou les createurs posent leurs sous-titres, 64 % de la hauteur de l'image (references : 62 a 68 %), ramenee dans la zone sure si besoin.
export const POSITIONS = { haut: { ecran: [0.5, 0.04] }, centre: { ecran: [0.5, 0.5] }, bas: { ecran: [0.5, 1] }, bas_bord: { ecran: [0.5, 1] }, legende: { ecranAbs: [0.5, 0.64] }, auto: { ecranAbs: [0.5, 0.64], evite: true } };   // auto (defaut) : 64 % de la hauteur, deplacee hors des visages et des torses (montage/evitement.js) ; legende : toujours a 64 %

function lirePosition(D, v, ch) {
  if (v === undefined) return POSITIONS.auto;
  if (typeof v === 'string') { if (!POSITIONS[v]) D.err(ch, `position : une de ${Object.keys(POSITIONS).join(', ')} ou [x, y] (0..1)`); return POSITIONS[v]; }
  if (Array.isArray(v) && v.length === 2 && v.every((x) => estNombre(x) && x >= -0.5 && x <= 1.5)) return { ecran: v };
  return D.err(ch, `position : une de ${Object.keys(POSITIONS).join(', ')} ou [x, y] (fractions de la zone sure, y vers le bas)`);
}
function lirePop(D, v, ch) {
  if (v === undefined) return undefined;   // defaut : voir incrust/elements.js (specMouvement)
  if (v === false) return null;
  if (!Array.isArray(v) || v.length !== 2 || !estNombre(v[0]) || !estNombre(v[1]) || v[0] < 0.3 || v[0] > 3 || v[1] < 0.02 || v[1] > 2) D.err(ch, 'pop : [echelle de depart (0,3 a 3), duree en s (0,02 a 2)] ou false');
  return v;
}

// ---------------------------------------------------------------- mouvement (entree, emphase, sortie) : champs communs aux textes, sous-titres et incrustations
//   entree / sortie : type (pop, rebond, glisse, fondu, zoom, machine, vague, tombe, dessin, compte, aucune ; "trace" = "dessin")
//   anim : duree de l'entree en s (0,02 a 3) ou "aucune" (RIEN ne bouge : ni entree, ni emphase, ni sortie) ; animSortie : duree de la sortie
//   courbe / courbeSortie : lineaire, cubique, retour, elastique, sinus, ressort ; retard : attente avant l'entree (s) ; depuis : cote d'ou glisse
//   emphase : "pulse" | "secousse" | "clignote" | "rebond" | "flotte" | "aucune", ou { type, t (une fois, a cet instant du film), duree, periode, intensite }
export const CLES_MOUVEMENT = ['entree', 'sortie', 'anim', 'animSortie', 'courbe', 'courbeSortie', 'retard', 'depuis', 'emphase'];
function lireMouvement(D, e, ch) {
  const o = {};
  for (const k of ['entree', 'sortie']) if (e[k] !== undefined) {
    const v = ALIAS_TYPE[e[k]] ?? e[k], liste = k === 'entree' ? ENTREES : SORTIES;
    if (!liste.includes(v)) D.err(`${ch}.${k}`, `une de : ${liste.join(', ')}`);
    o[k] = v;
  }
  if (e.anim !== undefined) {
    if (e.anim === 'aucune' || e.anim === false) o.anim = 'aucune';
    else o.anim = nombreEntre(D, e.anim, `${ch}.anim`, 0.02, 3, undefined);
  }
  if (e.animSortie !== undefined) o.animSortie = nombreEntre(D, e.animSortie, `${ch}.animSortie`, 0.02, 3, undefined);
  for (const k of ['courbe', 'courbeSortie']) if (e[k] !== undefined) { if (!NOMS_COURBES.includes(e[k])) D.err(`${ch}.${k}`, `une de : ${NOMS_COURBES.join(', ')}`); o[k] = e[k]; }
  if (e.retard !== undefined) o.retard = nombreEntre(D, e.retard, `${ch}.retard`, 0, 30, undefined);
  if (e.depuis !== undefined) { if (!['gauche', 'droite', 'haut', 'bas'].includes(e.depuis)) D.err(`${ch}.depuis`, '"gauche", "droite", "haut" ou "bas"'); o.depuis = e.depuis; }
  if (e.emphase !== undefined) {
    const v = e.emphase;
    if (typeof v === 'string') { if (!EMPHASES.includes(v)) D.err(`${ch}.emphase`, `une de : ${EMPHASES.join(', ')}, ou un objet { type, t, duree, periode, intensite }`); o.emphase = v; }
    else if (estObjet(v)) {
      champsConnus(D, v, ['type', 't', 'duree', 'periode', 'intensite'], `${ch}.emphase`);
      if (!EMPHASES.includes(v.type)) D.err(`${ch}.emphase.type`, `une de : ${EMPHASES.join(', ')}`);
      o.emphase = { type: v.type };
      if (v.t !== undefined) o.emphase.t = nombreEntre(D, v.t, `${ch}.emphase.t`, 0, 1000, undefined);
      if (v.duree !== undefined) o.emphase.duree = nombreEntre(D, v.duree, `${ch}.emphase.duree`, 0.05, 10, undefined);
      if (v.periode !== undefined) o.emphase.periode = nombreEntre(D, v.periode, `${ch}.emphase.periode`, 0.1, 10, undefined);
      if (v.intensite !== undefined) o.emphase.intensite = nombreEntre(D, v.intensite, `${ch}.emphase.intensite`, 0, 4, undefined);
    } else D.err(`${ch}.emphase`, `un nom (${EMPHASES.join(', ')}) ou un objet { type, t, duree, periode, intensite }`);
  }
  return o;
}

// ---------------------------------------------------------------- textes : [[debut, fin, "texte", options?], ...]
export function lireTextes(D, brut, duree) {
  const ch = 'textes';
  if (!Array.isArray(brut)) D.err(ch, 'liste [[debut, fin, "texte", options?], ...] attendue');
  if (brut.length > MAX_TEXTES) D.err(ch, `${MAX_TEXTES} textes au maximum`);
  return brut.map((e, i) => {
    const c = `${ch}[${i}]`;
    if (!Array.isArray(e) || e.length < 3 || e.length > 4 || !estNombre(e[0]) || !estNombre(e[1]) || typeof e[2] !== 'string') D.err(c, 'forme attendue : [debut, fin, "texte", options?]');
    if (e[0] < 0 || e[1] <= e[0] || e[1] > duree + 1e-9) D.err(c, `il faut 0 <= debut < fin <= ${duree}`);
    if (e[2].length > 400) D.err(`${c}[2]`, 'texte de 400 caracteres au plus');
    const opt = e[3] ?? {};
    if (!estObjet(opt)) D.err(`${c}[3]`, 'options : un objet attendu');
    champsConnus(D, opt, [...CLES_STYLE, ...CLES_MOUVEMENT, 'position', 'pop', 'calque', 'opacite'], `${c}[3]`);
    return elementLegende(D, [e[0], e[1]], e[2], opt, `${c}[3]`, i);
  });
}
function elementLegende(D, t, texte, opt, ch, ordre) {
  const style = lireStyle(D, opt, ch, styleLegende(opt));
  const pos = lirePosition(D, opt.position, `${ch}.position`);
  return { type: 'texte', legende: true, t, texte, ...style, ...pos, pop: lirePop(D, opt.pop, `${ch}.pop`), ...lireMouvement(D, opt, ch), calque: nombreEntre(D, opt.calque, `${ch}.calque`, -100, 100, 50), opacite: nombreEntre(D, opt.opacite, `${ch}.opacite`, 0, 1, 1), ordre };
}

// ---------------------------------------------------------------- sousTitres : legendes mot a mot decoupees en puces de 1 a 3 mots
// { texte, debut, fin | mots:[[t,"mot"],...], par, couleurs, accent, position, taille, style, pop }
export function lireSousTitres(D, brut, duree) {
  const ch = 'sousTitres';
  const liste = Array.isArray(brut) ? brut : [brut];
  if (liste.length > 20) D.err(ch, '20 blocs de sous-titres au maximum');
  const sortie = [];
  liste.forEach((b, i) => {
    const c = Array.isArray(brut) ? `${ch}[${i}]` : ch;
    if (!estObjet(b)) D.err(c, 'un objet est attendu, par exemple {"texte":"I know you stole it","debut":1,"fin":3.5}');
    champsConnus(D, b, ['texte', 'debut', 'fin', 'mots', 'par', 'style', 'position', 'pop', 'calque', 'opacite', 'qui', ...CLES_STYLE, ...CLES_MOUVEMENT], c);
    // qui : l'acteur qui dit ce bloc (facultatif) : il joue la parole (tete, avant-bras sur les mots en accent), l'autre l'ecoute (montage/jeu.js)
    if (b.qui !== undefined && (typeof b.qui !== 'string' || !D.noms.has(b.qui))) D.err(`${c}.qui`, `nom de l'acteur qui parle attendu (acteurs : ${[...D.noms].join(', ')})`);
    if (typeof b.texte !== 'string' && !Array.isArray(b.mots)) D.err(c, 'il faut "texte" (avec "debut" et "fin") ou "mots": [[t, "mot"], ...]');
    const par = b.par === undefined ? 2 : b.par;
    if (!Number.isInteger(par) || par < 1 || par > 3) D.err(`${c}.par`, 'nombre de mots par puce : 1, 2 ou 3');
    let mots;
    if (Array.isArray(b.mots)) {
      if (b.mots.length > 1500) D.err(`${c}.mots`, '1500 mots au maximum');
      let prec = -1;
      mots = b.mots.map((m, j) => {
        if (!Array.isArray(m) || m.length < 2 || !estNombre(m[0]) || typeof m[1] !== 'string' || !m[1].trim()) D.err(`${c}.mots[${j}]`, 'forme attendue : [temps, "mot"] ou [temps, "mot", true] (fin de puce)');
        if (m[0] < 0 || m[0] > duree) D.err(`${c}.mots[${j}][0]`, `temps entre 0 et ${duree}`);
        if (m[0] < prec) D.err(`${c}.mots[${j}][0]`, 'les mots doivent etre classes par temps croissant');
        prec = m[0]; return { t: m[0], mot: m[1].trim(), coupe: m[2] === true };   // [t, "mot", true] : la puce se termine apres ce mot
      });
    } else {
      if (!estNombre(b.debut) || b.debut < 0) D.err(`${c}.debut`, 'debut en secondes attendu');
      if (!estNombre(b.fin) || b.fin <= b.debut || b.fin > duree + 1e-9) D.err(`${c}.fin`, `fin en secondes attendue (apres debut, au plus ${duree})`);
      // la ponctuation isolee (francais : « Steve ! », « non ? », « : ») reste avec le mot d'avant : jamais de puce faite d'un seul « ! »
      const ws = b.texte.split(/\s+/).filter(Boolean).reduce((l, w) => { if (l.length && !/[\p{L}\p{N}]/u.test(w)) l[l.length - 1] += ' ' + w; else l.push(w); return l; }, []);
      if (!ws.length) D.err(`${c}.texte`, 'texte vide');
      // sans temps par mot : repartis selon le nombre de lettres (+ une pause apres la ponctuation)
      const poids = ws.map((w) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 2 + (/[.!?]$/.test(w) ? 2 : /[,;:]$/.test(w) ? 1 : 0));
      const total = poids.reduce((a, x) => a + x, 0);
      let t = b.debut; mots = ws.map((w, j) => { const m = { t, mot: w }; t += (b.fin - b.debut) * poids[j] / total; return m; });
    }
    if (!mots.length) D.err(c, 'aucun mot');
    const accents = new Set(Array.isArray(b.accent) ? b.accent : Array.isArray(b.style?.accent) ? b.style.accent : []);
    // pour les gestes "@mot" et la parole de `qui` (montage/jeu.js) : bloc, fin du bloc, mot en accent
    D.mots?.push(...mots.map((m, j) => ({ t: m.t, mot: m.mot, ...(b.qui ? { qui: b.qui, bloc: i, accent: accents.has(j), fin: estNombre(b.fin) ? b.fin : mots[mots.length - 1].t + 0.5 } : {}) })));
    const fin = estNombre(b.fin) ? b.fin : null;
    if (fin !== null && (fin <= mots[0].t || fin > duree + 1e-9)) D.err(`${c}.fin`, `fin apres le premier mot et au plus ${duree}`);
    const st = b.style !== undefined ? (estObjet(b.style) ? b.style : D.err(`${c}.style`, 'objet de style attendu')) : {};
    if (b.style !== undefined) champsConnus(D, st, [...CLES_STYLE, ...CLES_MOUVEMENT, 'position', 'pop'], `${c}.style`);
    const opt = { ...b, ...st };
    const style = lireStyle(D, opt, c, { ...styleLegende(opt), casse: 'majuscules' });   // sous-titres : CAPITALES par defaut (references) ; "casse": "aucune" garde le texte tel quel
    const pos = lirePosition(D, opt.position, `${c}.position`), pop = lirePop(D, opt.pop, `${c}.pop`), mouv = lireMouvement(D, opt, c);
    const calque = nombreEntre(D, b.calque, `${c}.calque`, -100, 100, 50), opacite = nombreEntre(D, b.opacite, `${c}.opacite`, 0, 1, 1);
    const puces = decouperSousTitres(mots, { par, fin: fin ?? Math.min(duree, mots[mots.length - 1].t + 0.6), accent: style.accent ?? null });
    puces.forEach((p, k) => sortie.push({ type: 'texte', legende: true, t: [p.debut, p.fin], texte: p.texte, ...style, accent: p.accent, ...pos, pop, ...mouv, calque, opacite, ordre: i * 10000 + k }));
  });
  return sortie;
}

// ---------------------------------------------------------------- incrustations
const ANCRES = ['ecran', 'monde', 'acteur'];
const COMMUNS = ['type', 't', 'calque', ...CLES_MOUVEMENT, 'pop', 'opacite', 'ecran', 'monde', 'acteur', 'decalage', 'decalageEcran', 'echelle', 'ref', 'occlusion', 'pivot', 'depuis', 'taille', 'eviteActeurs'];
const PAR_TYPE = {
  texte: ['texte', 'segments', ...CLES_STYLE],
  compteur: ['valeurs', 'duree', 'decimales', 'separateur', 'decimal', 'prefixe', 'suffixe', 'mode', 'delai', ...CLES_STYLE],
  fleche: ['de', 'a', 'double', 'couleur', 'epaisseur', 'pointe', 'texte', 'etiquette', 'decalageEtiquette', ...CLES_STYLE],
  ligne: ['points', 'pointille', 'couleur', 'epaisseur', 'tracer', 'tete', 'plein'],
  icone: ['objet', 'nombre', 'barre', 'fichier'],
  equation: ['elements', 'espacement', 'taille', ...CLES_STYLE],
  coeurs: ['valeur', 'max', 'variante', 'dur'],
  faim: ['valeur', 'max', 'variante'],
  horloge: ['etiquette', 'progression', ...CLES_STYLE],
  minuteur: ['etiquette', 'progression', 'duree', ...CLES_STYLE],
  nom: ['texte', 'traverse', 'aTraversMurs', ...CLES_STYLE],
  bulle: ['lignes', ...CLES_STYLE],
  chat: ['lignes', 'vie', 'fondu', ...CLES_STYLE],
  succes: ['titre', 'texte', 'objet'],
  inventaire: ['cases', 'colonnes', 'surligner', 'selection', 'style'],
  coffre: ['titre', 'cases', 'contenu', 'rangees', 'joueur'],
  marchand: ['titre', 'offres', 'selection'],
  hud: ['coeurs', 'faim', 'xp', 'niveau', 'cases', 'selection', 'viseur'],
  image: ['fichier'],
  carte: ['fond', 'acteurs', 'vue', 'incrustations', 'lumiere'],
};
export const TYPES_INCRUSTATION = Object.keys(PAR_TYPE);

function lirePoint(D, v, ch, { permisActeur = true } = {}) {
  if (Array.isArray(v) && v.length === 3 && v.every(estNombre)) return { monde: v };
  if (!estObjet(v)) D.err(ch, 'point attendu : [x,y,z] du monde, {"monde":[x,y,z]}, {"ecran":[x,y]} ou {"acteur":"nom","decalage":[dx,dy,dz]}');
  if (v.monde !== undefined) { if (!Array.isArray(v.monde) || v.monde.length !== 3 || !v.monde.every(estNombre)) D.err(`${ch}.monde`, '[x, y, z] attendu'); return { monde: v.monde }; }
  if (v.ecran !== undefined) { if (!Array.isArray(v.ecran) || v.ecran.length !== 2 || !v.ecran.every(estNombre)) D.err(`${ch}.ecran`, '[x, y] (0..1) attendu'); return { ecran: v.ecran }; }
  if (v.acteur !== undefined && permisActeur) {
    if (typeof v.acteur !== 'string' || !D.noms.has(v.acteur)) D.err(`${ch}.acteur`, `acteur inconnu : ${JSON.stringify(v.acteur)}`);
    const dec = v.decalage ?? [0, 1, 0];
    if (!Array.isArray(dec) || dec.length !== 3 || !dec.every(estNombre)) D.err(`${ch}.decalage`, '[dx, dy, dz] attendu');
    return { acteur: v.acteur, decalage: dec };
  }
  return D.err(ch, 'point attendu : [x,y,z], {"monde":[..]}, {"ecran":[..]} ou {"acteur":"nom"}');
}

export function lireIncrustations(D, brut, duree, chemin = 'incrustations', { dansCarte = false } = {}) {
  if (!Array.isArray(brut)) D.err(chemin, 'liste d\'incrustations attendue');
  if (brut.length > MAX_INCRUSTATIONS) D.err(chemin, `${MAX_INCRUSTATIONS} incrustations au maximum`);
  return brut.map((e, i) => {
    const ch = `${chemin}[${i}]`;
    if (!estObjet(e)) D.err(ch, 'un objet est attendu');
    if (typeof e.type !== 'string' || !PAR_TYPE[e.type]) D.err(`${ch}.type`, `type : un de ${TYPES_INCRUSTATION.join(', ')}`);
    if (dansCarte && e.type === 'carte') D.err(`${ch}.type`, 'une carte ne contient pas d\'autre carte');
    champsConnus(D, e, [...COMMUNS, ...PAR_TYPE[e.type]], ch);
    if (!Array.isArray(e.t) || e.t.length !== 2 || !estNombre(e.t[0]) || !estNombre(e.t[1]) || e.t[0] < 0 || e.t[1] <= e.t[0] || e.t[1] > duree + 1e-9) D.err(`${ch}.t`, `[debut, fin] en secondes attendu, 0 <= debut < fin <= ${duree}`);
    const o = { type: e.type, t: [e.t[0], e.t[1]], ordre: i, calque: nombreEntre(D, e.calque, `${ch}.calque`, -100, 100, e.type === 'carte' ? -50 : 0), opacite: nombreEntre(D, e.opacite, `${ch}.opacite`, 0, 1, 1) };
    // mouvement : entree, emphase, sortie (montage/mouvement.js ; defauts par type dans incrust/elements.js)
    Object.assign(o, lireMouvement(D, e, ch));
    if (e.pop !== undefined) o.pop = lirePop(D, e.pop, `${ch}.pop`);
    // ancrage
    const nAnc = ANCRES.filter((k) => e[k] !== undefined && !(k === 'monde' && e.type === 'ligne')).length;
    if (nAnc > 1) D.err(ch, `un seul ancrage : ${ANCRES.join(' ou ')}`);
    if (e.ecran !== undefined) { if (!Array.isArray(e.ecran) || e.ecran.length !== 2 || !e.ecran.every((x) => estNombre(x) && x >= -1 && x <= 2)) D.err(`${ch}.ecran`, '[x, y] en fractions de l\'image (y vers le bas) attendu'); o.ecran = e.ecran; }
    if (e.monde !== undefined) { if (!Array.isArray(e.monde) || e.monde.length !== 3 || !e.monde.every(estNombre)) D.err(`${ch}.monde`, '[x, y, z] attendu'); o.monde = e.monde; }
    if (e.acteur !== undefined) { if (typeof e.acteur !== 'string' || !D.noms.has(e.acteur)) D.err(`${ch}.acteur`, `acteur inconnu : ${JSON.stringify(e.acteur)}`); o.acteur = e.acteur; }
    if (e.decalage !== undefined) { if (!Array.isArray(e.decalage) || e.decalage.length !== 3 || !e.decalage.every(estNombre)) D.err(`${ch}.decalage`, '[dx, dy, dz] en blocs attendu'); o.decalage = e.decalage; }
    if (e.decalageEcran !== undefined) { if (!Array.isArray(e.decalageEcran) || e.decalageEcran.length !== 2 || !e.decalageEcran.every(estNombre)) D.err(`${ch}.decalageEcran`, '[dx, dy] (fractions du petit cote) attendu'); o.decalageEcran = e.decalageEcran; }
    if (e.echelle !== undefined) { if (e.echelle !== 'ecran' && e.echelle !== 'distance' && !(estNombre(e.echelle) && e.echelle > 0.05 && e.echelle <= 20)) D.err(`${ch}.echelle`, '"ecran" (taille fixe), "distance" (rapetisse en s\'eloignant) ou un facteur'); o.echelle = e.echelle; }
    o.ref = nombreEntre(D, e.ref, `${ch}.ref`, 0.5, 200, 8);
    if (e.occlusion !== undefined) { if (typeof e.occlusion !== 'boolean') D.err(`${ch}.occlusion`, 'true (cache par le decor) ou false (toujours dessus)'); o.occlusion = e.occlusion; }
    if (e.pivot !== undefined) { if (!Array.isArray(e.pivot) || e.pivot.length !== 2 || !e.pivot.every(estNombre)) D.err(`${ch}.pivot`, '[x, y] (0..1) attendu : point de l\'image place sur l\'ancre'); o.pivot = e.pivot; }
    if (e.taille !== undefined) o.taille = nombreEntre(D, e.taille, `${ch}.taille`, 0.003, 2, undefined);
    if (e.eviteActeurs !== undefined) { if (typeof e.eviteActeurs !== 'boolean') D.err(`${ch}.eviteActeurs`, 'false : l\'incrustation ne s\'ecarte pas des visages (par defaut true)'); o.eviteActeurs = e.eviteActeurs; }
    lireContenu(D, e, o, ch, duree);
    return o;
  });
}

function lireContenu(D, e, o, ch, duree) {
  const style = () => Object.assign(o, lireStyle(D, e, ch, { }), { taille: o.taille });
  const texte = (k = 'texte', obligatoire = true) => {
    if (e[k] === undefined) { if (obligatoire) D.err(`${ch}.${k}`, 'texte attendu'); return; }
    if (typeof e[k] !== 'string' || e[k].length > 400) D.err(`${ch}.${k}`, 'texte de 400 caracteres au plus attendu');
    o[k] = e[k];
  };
  switch (e.type) {
    case 'texte':
      if (e.segments !== undefined) {
        if (!Array.isArray(e.segments) || e.segments.some((s) => !Array.isArray(s) || typeof s[0] !== 'string')) D.err(`${ch}.segments`, 'liste [["texte","couleur"], ...] attendue');
        o.segments = e.segments.map((s, j) => [s[0], s[1] === undefined ? null : couleurDe(D, s[1], `${ch}.segments[${j}][1]`)]);
      } else texte();
      style(); break;
    case 'compteur':
      if (!Array.isArray(e.valeurs) || e.valeurs.length !== 2 || !e.valeurs.every(estNombre)) D.err(`${ch}.valeurs`, '[de, a] attendu, par exemple [0, 300]');
      o.valeurs = e.valeurs;
      o.duree = nombreEntre(D, e.duree, `${ch}.duree`, 0.05, 30, Math.min(1, e.t[1] - e.t[0]));
      o.delai = nombreEntre(D, e.delai, `${ch}.delai`, 0, 30, 0);
      o.decimales = e.decimales === undefined ? 0 : (Number.isInteger(e.decimales) && e.decimales >= 0 && e.decimales <= 6 ? e.decimales : D.err(`${ch}.decimales`, 'entier de 0 a 6'));
      for (const k of ['separateur', 'decimal', 'prefixe', 'suffixe']) if (e[k] !== undefined) { if (typeof e[k] !== 'string' || e[k].length > 20) D.err(`${ch}.${k}`, 'texte court attendu'); o[k] = e[k]; }
      if (e.mode !== undefined) { if (!['compte', 'saisie', 'roulette'].includes(e.mode)) D.err(`${ch}.mode`, '"compte", "saisie" (chiffre par chiffre) ou "roulette"'); o.mode = e.mode; }
      style(); break;
    case 'fleche':
      o.de = lirePoint(D, e.de, `${ch}.de`); o.a = lirePoint(D, e.a, `${ch}.a`);
      o.double = e.double === true;
      o.couleur = couleurDe(D, e.couleur, `${ch}.couleur`, [60, 255, 60, 255]);
      o.epaisseur = nombreEntre(D, e.epaisseur, `${ch}.epaisseur`, 0.001, 0.1, 0.012);
      o.pointe = nombreEntre(D, e.pointe, `${ch}.pointe`, 0.005, 0.2, 0.045);
      if (e.texte !== undefined || e.etiquette !== undefined) { if (typeof (e.texte ?? e.etiquette) !== 'string') D.err(`${ch}.texte`, 'texte attendu'); o.texte = e.texte ?? e.etiquette; }
      if (e.decalageEtiquette !== undefined) { if (!Array.isArray(e.decalageEtiquette) || e.decalageEtiquette.length !== 2 || !e.decalageEtiquette.every(estNombre)) D.err(`${ch}.decalageEtiquette`, '[dx, dy] attendu'); o.decalageEtiquette = e.decalageEtiquette; }
      Object.assign(o, lireStyle(D, e, ch, { couleur: o.couleur }), { taille: e.taille ?? 0.05 }); o.entree ??= 'dessin'; break;
    case 'ligne':
      if (!Array.isArray(e.points) || e.points.length < 2 || e.points.length > 64) D.err(`${ch}.points`, 'liste de 2 a 64 points [x,y,z] attendue');
      o.points = e.points.map((p, j) => (Array.isArray(p) && p.length === 3 && p.every(estNombre) ? p : D.err(`${ch}.points[${j}]`, '[x, y, z] attendu')));
      o.pointille = e.pointille !== false && e.plein !== true;
      o.couleur = couleurDe(D, e.couleur, `${ch}.couleur`, [255, 255, 255, 255]);
      o.epaisseur = nombreEntre(D, e.epaisseur, `${ch}.epaisseur`, 0.001, 0.1, 0.008);
      o.tracer = nombreEntre(D, e.tracer, `${ch}.tracer`, 0, 60, 0);
      o.tete = e.tete !== false; break;
    case 'icone': {
      if (e.objet === undefined && e.fichier === undefined) D.err(ch, 'il faut "objet" (identifiant du jeu, mcanim objets --cherche mot) ou "fichier" (PNG local)');
      if (e.objet !== undefined) { if (typeof e.objet !== 'string' || !/^[a-z0-9_.:/-]{1,80}$/.test(e.objet)) D.err(`${ch}.objet`, 'identifiant d\'objet attendu, par exemple "iron_pickaxe"'); o.objet = e.objet.replace(/^minecraft:/, ''); }
      if (e.fichier !== undefined) { if (typeof e.fichier !== 'string' || !/\.png$/i.test(e.fichier) || e.fichier.length > 200) D.err(`${ch}.fichier`, 'chemin d\'un fichier .png attendu'); o.fichier = e.fichier; }
      if (e.nombre !== undefined) { if (!(Number.isInteger(e.nombre) && e.nombre >= 0 && e.nombre <= 99999)) D.err(`${ch}.nombre`, 'entier >= 0 attendu'); o.nombre = e.nombre; }
      if (e.barre !== undefined) o.barre = nombreEntre(D, e.barre, `${ch}.barre`, 0, 1);
      break;
    }
    case 'image':
      if (typeof e.fichier !== 'string' || !/\.png$/i.test(e.fichier) || e.fichier.length > 200) D.err(`${ch}.fichier`, 'chemin d\'un fichier .png attendu (relatif a la scene)');
      o.fichier = e.fichier; break;
    case 'equation':
      if (!Array.isArray(e.elements) || !e.elements.length || e.elements.length > 16) D.err(`${ch}.elements`, 'liste de 1 a 16 elements attendue, par exemple [{"objet":"carrot","nombre":22},"->",{"objet":"emerald","nombre":1}]');
      o.elements = e.elements.map((x, j) => {
        const c = `${ch}.elements[${j}]`;
        if (typeof x === 'string') return { texte: x };
        if (!estObjet(x)) return D.err(c, 'texte ("->", "=", "+", "x16") ou objet {"objet","nombre"} attendu');
        champsConnus(D, x, ['objet', 'nombre', 'texte', 'couleur', 'barre'], c);
        if (x.objet === undefined && x.texte === undefined) D.err(c, '"objet" ou "texte" attendu');
        return { ...x, couleur: x.couleur !== undefined ? couleurDe(D, x.couleur, `${c}.couleur`) : undefined };
      });
      o.espacement = nombreEntre(D, e.espacement, `${ch}.espacement`, 0, 1, 0.3);
      style(); break;
    case 'coeurs': case 'faim':
      o.valeur = nombreEntre(D, e.valeur, `${ch}.valeur`, 0, 40, 20);
      o.max = nombreEntre(D, e.max, `${ch}.max`, 2, 40, 20);
      if (e.variante !== undefined) { if (!['normal', 'poison', 'wither', 'gel', 'absorption', 'faim'].includes(e.variante)) D.err(`${ch}.variante`, '"normal", "poison", "wither", "gel", "absorption" (coeurs) ou "faim"'); o.variante = e.variante; }
      if (e.dur !== undefined) o.dur = e.dur === true;
      break;
    case 'horloge': case 'minuteur':
      texte('etiquette', false);
      o.progression = e.progression === undefined ? [0, 1] : (Array.isArray(e.progression) && e.progression.length === 2 && e.progression.every((x) => estNombre(x) && x >= 0 && x <= 4) ? e.progression : D.err(`${ch}.progression`, '[de, a] (tours de 0 a 4) attendu, par exemple [0, 1]'));
      if (e.type === 'minuteur') o.duree = nombreEntre(D, e.duree, `${ch}.duree`, 1, 86400, undefined);
      style(); break;
    case 'nom':
      if (e.acteur === undefined) D.err(`${ch}.acteur`, 'acteur attendu');
      texte('texte', false); o.traverse = e.traverse === true || e.aTraversMurs === true;   // aTraversMurs : meme chose (nom donne par les cartes)
      Object.assign(o, lireStyle(D, e, ch, {}), { taille: e.taille }); break;
    case 'bulle': case 'chat': {
      if (!Array.isArray(e.lignes) || !e.lignes.length || e.lignes.length > 16) D.err(`${ch}.lignes`, 'liste de 1 a 16 lignes attendue (texte avec codes de couleur du jeu : §6 or, §b cyan, §7 gris, §l gras)');
      o.lignes = e.lignes.map((l, j) => {
        if (typeof l === 'string') return { texte: l, t: null };
        if (Array.isArray(l) && estNombre(l[0]) && typeof l[1] === 'string') return { texte: l[1], t: l[0] };
        return D.err(`${ch}.lignes[${j}]`, 'texte ou [temps d\'apparition, texte] attendu');
      });
      if (e.type === 'chat') { o.vie = nombreEntre(D, e.vie, `${ch}.vie`, 0.2, 600, Infinity); o.fondu = nombreEntre(D, e.fondu, `${ch}.fondu`, 0, 10, 0.5); }
      style(); break;
    }
    case 'succes':
      texte('titre', false); texte('texte', false);
      if (e.objet !== undefined) { if (typeof e.objet !== 'string') D.err(`${ch}.objet`, 'identifiant d\'objet attendu'); o.objet = e.objet.replace(/^minecraft:/, ''); }
      break;
    case 'inventaire':
      if (!Array.isArray(e.cases) || !e.cases.length || e.cases.length > 54) D.err(`${ch}.cases`, 'liste de 1 a 54 cases attendue : ["carrot", ["emerald", 64], null, ["iron_pickaxe", 1, 0.3]] (objet, nombre, barre de durabilite)');
      o.cases = e.cases.map((c, j) => (c === null ? null : typeof c === 'string' ? { objet: c } : Array.isArray(c) && typeof c[0] === 'string' ? { objet: c[0], nombre: c[1], barre: c[2] } : D.err(`${ch}.cases[${j}]`, 'null, "objet" ou ["objet", nombre, barre]')));
      o.colonnes = e.colonnes === undefined ? (e.cases.length <= 9 ? e.cases.length : 9) : (Number.isInteger(e.colonnes) && e.colonnes >= 1 && e.colonnes <= 9 ? e.colonnes : D.err(`${ch}.colonnes`, 'entier de 1 a 9'));
      if (e.surligner !== undefined) o.surligner = Array.isArray(e.surligner) ? e.surligner : [e.surligner];
      if (e.selection !== undefined) o.selection = e.selection;
      if (e.style !== undefined) { if (!['barre', 'grille'].includes(e.style)) D.err(`${ch}.style`, '"barre" ou "grille"'); o.style = e.style; }
      break;
    case 'coffre': {   // ecran d'un conteneur ouvert (le jeu ne montre pas le contenu d'un coffre ouvert dans le monde) : cases d'une liste, ou lues dans monde.contenus
      if ((e.cases === undefined) === (e.contenu === undefined)) D.err(ch, 'il faut "contenu": [x, y, z] (un conteneur de monde.contenus) OU "cases": ["diamond", ["iron_pickaxe", 1, 0.3], null, ...] (liste), pas les deux');
      let lignes;
      if (e.contenu !== undefined) {
        if (!Array.isArray(e.contenu) || e.contenu.length !== 3 || !e.contenu.every(Number.isInteger)) D.err(`${ch}.contenu`, '[x, y, z] entiers attendus : la position du coffre dans monde.contenus');
        const dans = (D.monde?.contenus ?? []).filter((k) => Array.isArray(k) && k[0] === e.contenu[0] && k[1] === e.contenu[1] && k[2] === e.contenu[2]);
        if (!dans.length) D.err(`${ch}.contenu`, `aucune ligne de monde.contenus pour [${e.contenu.join(', ')}] : ajoute-la, par exemple "monde": {"contenus": [[${e.contenu.join(', ')}, "diamond", 12]]}, ou donne "cases" a la place`);
        // meme remplissage que le jeu (moteur/contenus.js, ajouter) : d'abord les piles du meme objet, puis la premiere case vide
        const cases = [];
        for (const k of dans) {
          let n = k[4]; const objet = String(k[3]).replace(/^minecraft:/, ''), max = pileMax(objet);
          for (const c of cases) if (c && c.objet === objet && c.nombre < max && n > 0) { const q = Math.min(n, max - c.nombre); c.nombre += q; n -= q; }
          while (n > 0) { const q = Math.min(n, max); cases.push({ objet, nombre: q }); n -= q; }
        }
        lignes = cases;
      } else {
        if (!Array.isArray(e.cases) || !e.cases.length || e.cases.length > 54) D.err(`${ch}.cases`, 'liste de 1 a 54 cases attendue : ["diamond", ["emerald", 64], null, ["iron_pickaxe", 1, 0.3]] (objet, nombre, barre de durabilite)');
        lignes = e.cases.map((c, j) => (c === null ? null : typeof c === 'string' ? { objet: c.replace(/^minecraft:/, '') } : Array.isArray(c) && typeof c[0] === 'string' ? { objet: c[0].replace(/^minecraft:/, ''), nombre: c[1], barre: c[2] } : D.err(`${ch}.cases[${j}]`, 'null, "objet" ou ["objet", nombre, barre]')));
      }
      if (lignes.length > 54) D.err(ch, `le conteneur a ${lignes.length} piles : 54 cases au plus (6 rangees)`);
      const rangees = e.rangees === undefined ? (lignes.length <= 27 ? 3 : 6) : (Number.isInteger(e.rangees) && e.rangees >= 1 && e.rangees <= 6 ? e.rangees : D.err(`${ch}.rangees`, 'entier de 1 a 6 (coffre : 3, grand coffre : 6)'));
      if (lignes.length > rangees * 9) D.err(`${ch}.rangees`, `${lignes.length} piles ne tiennent pas dans ${rangees} rangee(s) de 9`);
      o.cases = Array.from({ length: rangees * 9 }, (_, k) => lignes[k] ?? null);
      o.rangees = rangees;
      texte('titre', false); o.titre ??= 'Coffre';
      o.joueur = e.joueur === true;   // true : montre aussi l'inventaire du joueur sous le coffre (comme l'ecran du jeu)
      break;
    }
    case 'marchand': {   // ecran du marchand (MerchantScreen) : offres [prix, prix2 | null, resultat], chacune ["objet", nombre] ou "objet"
      const obj = (c, k) => (c === null || c === undefined ? null : typeof c === 'string' ? { objet: c.replace(/^minecraft:/, ''), nombre: 1 } : Array.isArray(c) && typeof c[0] === 'string' ? { objet: c[0].replace(/^minecraft:/, ''), nombre: c[1] ?? 1 } : D.err(k, '"objet" ou ["objet", nombre]'));
      if (!Array.isArray(e.offres) || !e.offres.length || e.offres.length > 10) D.err(`${ch}.offres`, 'liste de 1 a 10 offres attendue : [["emerald", 1], null, ["bread", 6]] (prix, deuxieme prix ou null, resultat)');
      o.offres = e.offres.map((f, j) => { if (!Array.isArray(f) || f.length !== 3) D.err(`${ch}.offres[${j}]`, '[prix, deuxieme prix ou null, resultat] attendu'); return { a: obj(f[0], `${ch}.offres[${j}][0]`), b: obj(f[1], `${ch}.offres[${j}][1]`), r: obj(f[2], `${ch}.offres[${j}][2]`) }; });
      o.selection = e.selection === undefined ? 0 : (Number.isInteger(e.selection) && e.selection >= 0 && e.selection < o.offres.length ? e.selection : D.err(`${ch}.selection`, `entier de 0 a ${o.offres.length - 1}`));
      texte('titre', false); o.titre ??= 'Villageois';
      break;
    }
    case 'hud':
      o.coeurs = nombreEntre(D, e.coeurs, `${ch}.coeurs`, 0, 40, 20); o.faim = nombreEntre(D, e.faim, `${ch}.faim`, 0, 40, 20);
      o.xp = nombreEntre(D, e.xp, `${ch}.xp`, 0, 1, 0); o.niveau = e.niveau === undefined ? null : (Number.isInteger(e.niveau) && e.niveau >= 0 && e.niveau <= 999 ? e.niveau : D.err(`${ch}.niveau`, 'entier de 0 a 999'));
      o.selection = e.selection === undefined ? 0 : (Number.isInteger(e.selection) && e.selection >= 0 && e.selection <= 8 ? e.selection : D.err(`${ch}.selection`, 'entier de 0 a 8'));
      o.viseur = e.viseur !== false;
      if (e.cases !== undefined) { if (!Array.isArray(e.cases) || e.cases.length > 9) D.err(`${ch}.cases`, '9 cases au plus'); o.cases = e.cases.map((c) => (c === null ? null : typeof c === 'string' ? { objet: c } : { objet: c[0], nombre: c[1], barre: c[2] })); }
      break;
    case 'carte':
      o.fond = couleurDe(D, e.fond, `${ch}.fond`, [0, 0, 0, 255]);
      o.acteurs = [];
      if (e.acteurs !== undefined) {
        if (!Array.isArray(e.acteurs) || e.acteurs.length > 3) D.err(`${ch}.acteurs`, 'liste de 3 noms d\'acteurs au plus');
        e.acteurs.forEach((n, j) => { if (typeof n !== 'string' || !D.noms.has(n)) D.err(`${ch}.acteurs[${j}]`, `acteur inconnu : ${JSON.stringify(n)}`); });
        o.acteurs = e.acteurs;
      }
      if (e.vue !== undefined) {
        if (!estObjet(e.vue)) D.err(`${ch}.vue`, 'objet {"distance","hauteur","lacet","fov","decalage"} attendu');
        champsConnus(D, e.vue, ['distance', 'hauteur', 'lacet', 'fov', 'decalage'], `${ch}.vue`);
        o.vue = { distance: nombreEntre(D, e.vue.distance, `${ch}.vue.distance`, 0.8, 30, 3.2), hauteur: nombreEntre(D, e.vue.hauteur, `${ch}.vue.hauteur`, -2, 5, 1), lacet: nombreEntre(D, e.vue.lacet, `${ch}.vue.lacet`, -360, 360, 0), fov: nombreEntre(D, e.vue.fov, `${ch}.vue.fov`, 15, 120, 50), decalage: e.vue.decalage === undefined ? 0 : nombreEntre(D, e.vue.decalage, `${ch}.vue.decalage`, -5, 5, 0) };
      } else o.vue = { distance: 3.2, hauteur: 1, lacet: 0, fov: 50, decalage: 0 };
      o.lumiere = nombreEntre(D, e.lumiere, `${ch}.lumiere`, 0.2, 2, 1);
      o.incrustations = e.incrustations === undefined ? [] : lireIncrustations(D, e.incrustations, duree, `${ch}.incrustations`, { dansCarte: true });
      break;
    default: break;
  }
}

// ---------------------------------------------------------------- ensemble
// Retourne { plans, elements } : elements = legendes (textes + sousTitres) puis incrustations, tous avec la forme interne ci-dessus.
export function lireMontage(D, s, duree, images) {
  const sortie = { plans: null, textes: [], incrustations: [] };
  if (s.plans !== undefined) sortie.plans = lirePlans(D, s.plans, duree, images);
  if (s.textes !== undefined) sortie.textes.push(...lireTextes(D, s.textes, duree));
  if (s.sousTitres !== undefined) sortie.textes.push(...lireSousTitres(D, s.sousTitres, duree));
  if (s.incrustations !== undefined) sortie.incrustations = lireIncrustations(D, s.incrustations, duree);
  return sortie;
}
