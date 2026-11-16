// Format `shader.json` (voir docs/FORMAT-SHADER.md) : lecture, controle, valeurs par defaut, tables par heure.
// Une seule table decrit TOUTES les cles (type, plage, defaut, palier) : elle sert au controle, aux valeurs par defaut,
// a la detection des cles non prises en charge et a la documentation. Aucun code n'est jamais execute : que des nombres.
//
// Resultat de `lireShader` : { v, actif, notes, avertissements } ou
//   v      = objet PLAT { "ombres.actif": false, "lueur.intensite": 0, ... } (une entree par cle de la table, defaut compris) ;
//            une cle qui peut dependre de l'heure garde sa table { h:[...], v:[...] } (voir `evaluerShader`).
//   actif  = { ombres, lumiere, ciel, brume, rayons, lueur, tonalite, etalonnage, vignette, vegetation, eau } : famille demandee ou non ;
//            un fichier vide donne tout a faux (rendu vanilla, au pixel pres).
//   notes  = phrases courtes a redire a l'utilisateur (options non prises en charge...).

const PALIER_FAIT = 1;   // le lecteur gere les cles de palier 1 (et quelques-unes du palier 2 promues, voir FORMAT-SHADER.md)

// [chemin, type, defaut, min, max, palier, T?]   types : n nombre, i entier, b booleen, e liste ("min" = liste), c couleur (max = multiplicateur),
// cn couleur ou null, t texte, L liste de textes, o objet libre, m matrice 9, f focale, cc deux couleurs
const N = (c, d, a, b, p = 1, T = false) => [c, 'n', d, a, b, p, T];
const C = (c, d, mx, p = 1, T = false) => [c, 'c', d, 0, mx, p, T];
const CN = (c, mx, p = 1, T = true) => [c, 'cn', null, 0, mx, p, T];
const B = (c, d, p = 1) => [c, 'b', d, 0, 0, p, false];
const E = (c, d, liste, p = 1) => [c, 'e', d, liste, 0, p, false];

export const TABLE = [
  ['version', 'i', 1, 1, 1, 0, false], ['nom', 't', '', 0, 0, 0, false], ['origine', 't', '', 0, 0, 0, false], ['profil', 't', '', 0, 0, 0, false], ['notes', 'L', [], 0, 0, 0, false],
  E('performance.echellePost', 0.25, [0.125, 0.25, 0.5, 1]), ['performance.cuisson', 'i', 1, 0, 2, 1, false], E('qualite', 'normale', ['basse', 'normale', 'haute']),
  C('lumiere.soleil', [1, 1, 1], 3, 1, true), C('lumiere.ambiante', [1, 1, 1], 3, 1, true),
  N('lumiere.intensiteSoleil', 1, 0, 3, 1, true), N('lumiere.intensiteAmbiante', 1, 0, 3, 1, true), N('lumiere.partDirecte', 0.6, 0, 1, 1, true), N('lumiere.minimum', 0, 0, 1, 1, true),
  CN('lumiere.blocs.couleur', 1, 2, false), N('lumiere.blocs.intensite', 1, 0, 3, 2), N('lumiere.blocs.courbe', 1, 0.2, 3, 2), N('lumiere.blocs.scintillement', 0, 0, 1, 2),
  ['lumiere.blocs.parBloc', 'o', {}, 0, 0, 2, false], N('lumiere.emissifs.intensite', 1, 0, 3, 2),
  B('ombres.actif', false), N('ombres.distance', 128, 32, 512), N('ombres.intensite', 1, 0, 1), N('ombres.douceur', 0, 0, 4, 2), B('ombres.couleurs', false, 2),
  N('ombres.feuillage', 1, 0, 1), B('ombres.acteurs', false), N('ombres.acteursOpacite', 0.4, 0, 1), N('ombres.pasHeure', 0, 0, 6), C('ombres.couleur', [1, 1, 1], 2, 1, true), N('ombres.verre', 0.25, 0, 1), N('ombres.eau', 0.2, 0, 1),
  N('occlusion.force', 1, 0, 2), ['occlusion.rayon', 'i', 0, 0, 3, 2, false], B('occlusion.ecran.actif', false, 3), N('occlusion.ecran.force', 1, 0, 2, 3), N('occlusion.ecran.rayon', 0.5, 0.1, 3, 3),
  CN('ciel.zenith', 1), CN('ciel.horizon', 1), CN('ciel.bas', 1), C('ciel.teinte', [1, 1, 1], 2, 1, true), N('ciel.intensite', 1, 0, 3, 1, true), N('ciel.lueurCrepuscule', 1, 0, 3, 1, true),
  N('ciel.inclinaisonTrajet', 0, -90, 90),
  B('ciel.soleil.visible', true), N('ciel.soleil.taille', 1, 0.2, 5), E('ciel.soleil.forme', 'carre', ['carre', 'rond']), CN('ciel.soleil.couleur', 1), N('ciel.soleil.halo', 0, 0, 2, 1, true), N('ciel.soleil.haloRayon', 8, 1, 40),
  B('ciel.lune.visible', true), N('ciel.lune.taille', 1, 0.2, 5), CN('ciel.lune.couleur', 1), N('ciel.lune.halo', 0, 0, 2, 1, true), B('ciel.lune.phases', true),
  N('ciel.etoiles.densite', 1, 0, 1), N('ciel.etoiles.luminosite', 1, 0, 2), C('ciel.etoiles.couleur', [1, 1, 1], 1), B('ciel.etoiles.scintillement', false, 2),
  N('ciel.aurore.intensite', 0, 0, 1, 3, true), ['ciel.aurore.couleurs', 'cc', [[0.2, 1, 0.5], [0.5, 0.3, 1]], 0, 1, 3, false], N('ciel.aurore.vitesse', 1, 0, 5, 3),
  E('nuages.style', 'epais', ['aucun', 'plats', 'epais']), N('nuages.altitude', 192.33, -64, 512), N('nuages.vitesse', 1, 0, 10), N('nuages.direction', 90, 0, 360, 2), N('nuages.couverture', 0.5, 0, 1, 2),
  N('nuages.epaisseur', 4, 1, 16, 2), N('nuages.echelle', 1, 0.25, 4, 2), CN('nuages.couleur', 1), N('nuages.opacite', 1, 0, 1, 1, true),
  N('brume.densite', 1, 0, 5, 1, true), E('brume.courbe', 'lineaire', ['lineaire', 'exp', 'exp2']), CN('brume.couleur', 1),
  N('brume.hauteur.densite', 0, 0, 3, 1, true), N('brume.hauteur.niveau', 63, -64, 320), N('brume.hauteur.epaisseur', 24, 4, 128), ['brume.parBiome', 'o', {}, 0, 0, 2, false],
  N('rayons.intensite', 0, 0, 2, 1, true), ['rayons.echantillons', 'i', 12, 4, 32, 1, false], N('rayons.decroissance', 0.95, 0.8, 0.99), N('rayons.longueur', 0.6, 0.1, 1), CN('rayons.couleur', 1), B('rayons.sousEau', false, 2),
  N('lueur.intensite', 0, 0, 1.5, 1, true), N('lueur.seuil', 0.7, 0, 1), N('lueur.rayon', 16, 2, 64), C('lueur.couleur', [1, 1, 1], 1),
  N('lentille.intensite', 0, 0, 1, 2, true), ['lentille.fantomes', 'i', 3, 0, 6, 2, false], N('lentille.taille', 1, 0.3, 3, 2),
  N('profondeurChamp.intensite', 0, 0, 1, 3, true), ['profondeurChamp.focale', 'f', 'auto', 1, 200, 3, false], N('profondeurChamp.zoneNette', 6, 0, 100, 3), N('profondeurChamp.rayonMax', 12, 1, 32, 3),
  N('flouMouvement.intensite', 0, 0, 1, 3, true), N('flouMouvement.longueurMax', 24, 2, 64, 3),
  N('tonalite.exposition', 1, 0.1, 4, 1, true), E('tonalite.courbe', 'lineaire', ['lineaire', 'reinhard', 'filmique', 'aces', 'uncharted']), N('tonalite.blancMax', 1, 0.5, 8), N('tonalite.gamma', 1, 0.5, 2.5),
  B('tonalite.autoExposition.actif', false, 2), N('tonalite.autoExposition.vitesse', 1, 0.1, 5, 2), N('tonalite.autoExposition.min', 0.5, 0.2, 1, 2), N('tonalite.autoExposition.max', 2, 1, 4, 2),
  N('etalonnage.saturation', 1, 0, 2, 1, true), N('etalonnage.vibrance', 1, 0, 2, 1, true), N('etalonnage.contraste', 1, 0, 3, 1, true), N('etalonnage.temperature', 0, -1, 1, 1, true),
  C('etalonnage.teinte', [1, 1, 1], 2, 1, true), C('etalonnage.teinteOmbres', [1, 1, 1], 2, 1, true), C('etalonnage.teinteHautesLumieres', [1, 1, 1], 2, 1, true),
  N('etalonnage.desaturationSombre', 0, 0, 1), ['etalonnage.matrice', 'm', [1, 0, 0, 0, 1, 0, 0, 0, 1], -2, 2, 2, false],
  CN('eau.couleur', 1), N('eau.opacite', 1, 0, 3, 1, true), N('eau.absorption', 0, 0, 2, 2),
  N('eau.vagues.hauteur', 0, 0, 0.5), N('eau.vagues.vitesse', 1, 0, 5), N('eau.vagues.echelle', 1, 0.25, 4),
  N('eau.reflet.ciel', 0, 0, 1, 1, true), N('eau.reflet.fresnel', 4, 1, 8), N('eau.reflet.soleil', 0, 0, 2, 2, true), B('eau.reflet.plan', false, 3), N('eau.reflet.planForce', 0.6, 0, 1, 3),
  N('eau.refraction', 0, 0, 3, 3), N('eau.ecume', 0, 0, 1.5, 2), CN('eau.sousEau.couleur', 1), N('eau.sousEau.distance', 0, 0, 60), N('eau.sousEau.luminosite', 1, 0, 2), N('eau.sousEau.distorsion', 0, 0, 1, 2),
  N('vegetation.feuilles.amplitude', 0, 0, 0.3), N('vegetation.feuilles.vitesse', 1, 0, 5), N('vegetation.herbe.amplitude', 0, 0, 0.4), N('vegetation.herbe.vitesse', 1, 0, 5),
  N('vegetation.echelle', 1, 0.25, 4), N('vegetation.vent.direction', 45, 0, 360), N('vegetation.vent.rafales', 0.3, 0, 1), N('vegetation.distance', 24, 4, 64),
  N('vegetation.pluieMul', 1, 1, 4, 2), N('vegetation.lave.amplitude', 0, 0, 0.1, 2), N('vegetation.nenuphars.amplitude', 0, 0, 0.1, 2),
  N('meteo.pluie', 0, 0, 1, 2, true), N('meteo.assombrissement', 0, 0, 1, 2), N('meteo.desaturation', 0, 0, 1, 2), N('meteo.brumeMul', 1, 1, 5, 2), N('meteo.attenuationOmbres', 1, 0, 1, 2),
  B('lissage.fxaa', false, 2), N('lissage.fxaaForce', 0.75, 0, 1, 2), N('lissage.accentuation', 0, 0, 2, 2, true),
  N('ecran.vignette', 0, 0, 1, 1, true), N('ecran.grain', 0, 0, 1, 2), N('ecran.aberration', 0, 0, 8, 2),
  B('contours.actif', false, 2), ['contours.epaisseur', 'i', 1, 1, 4, 2, false], C('contours.couleur', [0, 0, 0], 1, 2), N('contours.sensibilite', 0.5, 0.1, 2, 2), E('contours.cible', 'tout', ['tout', 'acteurs'], 2), ['contours.paliers', 'i', 0, 0, 12, 2, false],
  B('acteurs.lumiereMonde', true), B('acteurs.respecterExemptions', true),
  ['dimensions', 'o', {}, 0, 0, 3, false],
];

const PAR_CHEMIN = new Map(TABLE.map((e) => [e[0], e]));
const estObjet = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const estNombre = (x) => typeof x === 'number' && Number.isFinite(x);

export class ErreurShader extends Error {}
const err = (chemin, msg) => { throw new ErreurShader(`shader.json : "${chemin}" : ${msg}`); };
const plage = (a, b) => `entre ${a} et ${b}`;

// Controle une valeur simple (hors table par heure) ; retourne la valeur normalisee.
function valeur(e, v, ch) {
  const [, type, def, a, b] = e;
  switch (type) {
    case 'n': if (!estNombre(v)) err(ch, 'un nombre est attendu'); if (v < a || v > b) err(ch, `${v} est hors plage (${plage(a, b)})`); return v;
    case 'i': if (!Number.isInteger(v)) err(ch, 'un nombre entier est attendu'); if (v < a || v > b) err(ch, `${v} est hors plage (${plage(a, b)})`); return v;
    case 'b': if (typeof v !== 'boolean') err(ch, 'true ou false est attendu'); return v;
    case 't': if (typeof v !== 'string') err(ch, 'un texte est attendu'); return v;
    case 'L': if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) err(ch, 'une liste de textes est attendue'); return v;
    case 'o': if (!estObjet(v)) err(ch, 'un objet est attendu'); return v;
    case 'e': if (!a.includes(v)) err(ch, `"${v}" n'est pas permis ; valeurs possibles : ${a.map((x) => JSON.stringify(x)).join(', ')}`); return v;
    case 'c': case 'cn': {
      if (!Array.isArray(v) || v.length !== 3 || v.some((x) => !estNombre(x))) err(ch, 'une couleur [r,g,b] est attendue (3 nombres)');
      if (v.some((x) => x < 0 || x > b)) err(ch, `les canaux de la couleur doivent etre ${plage(0, b)} (recu [${v}])`);
      return v;
    }
    case 'm': if (!Array.isArray(v) || v.length !== 9 || v.some((x) => !estNombre(x) || x < a || x > b)) err(ch, `9 nombres ${plage(a, b)} sont attendus`); return v;
    case 'f': if (v === 'auto' || v === 'acteur') return v; if (!estNombre(v) || v < a || v > b) err(ch, `"auto", "acteur" ou un nombre ${plage(a, b)} est attendu`); return v;
    case 'cc': if (!Array.isArray(v) || v.length !== 2) err(ch, 'deux couleurs [[r,g,b],[r,g,b]] sont attendues'); v.forEach((c, i) => valeur(['', 'c', 0, 0, b], c, `${ch}[${i}]`)); return v;
    default: return def;
  }
}

// Valeur ou table par heure { "6": X, "12": X } -> { h:[...tries], v:[...] } ; ou la valeur seule.
function valeurT(e, v, ch) {
  if (v === null && e[1] === 'cn') return null;
  if (!e[6]) return valeur(e, v, ch);
  const estTable = estObjet(v);
  if (!estTable) return valeur(e, v, ch);
  const cles = Object.keys(v);
  if (!cles.length) err(ch, 'une table par heure doit avoir au moins une cle (ex. {"6": ..., "12": ...})');
  const paires = cles.map((k) => {
    const h = Number(k);
    if (!/^\d+(\.\d+)?$/.test(k) || h < 0 || h > 24) err(`${ch}.${k}`, 'la cle d\'une table par heure est une heure de 0 a 24 (ex. "6", "17.5")');
    return [h === 24 ? 0 : h, valeur(e, v[k], `${ch}.${k}`)];
  }).sort((p, q) => p[0] - q[0]);
  return paires.length === 1 ? paires[0][1] : { h: paires.map((p) => p[0]), v: paires.map((p) => p[1]) };
}

// Evalue une valeur eventuellement "par heure" a l'heure donnee (interpolation lineaire circulaire, canal par canal pour une couleur).
export function evaluerT(x, heure) {
  if (!x || typeof x !== 'object' || !x.h) return x;
  const { h, v } = x, n = h.length;
  let H = ((heure % 24) + 24) % 24;
  let i = n - 1;   // dernier h <= H (ou le dernier de la veille)
  for (let k = 0; k < n; k++) if (h[k] <= H) i = k; else break;
  const j = (i + 1) % n;
  let h0 = h[i], h1 = h[j];
  if (h1 <= h0) h1 += 24;
  if (H < h0) H += 24;
  const u = h1 === h0 ? 0 : (H - h0) / (h1 - h0);
  const a = v[i], b = v[j];
  return Array.isArray(a) ? a.map((q, k) => q + (b[k] - q) * u) : a + (b - a) * u;
}

// Toutes les valeurs a l'heure donnee : objet plat { cle: valeur }. Appele une fois par image.
export function evaluerShader(shader, heure) {
  const r = {};
  for (const e of TABLE) { const x = shader.v[e[0]]; r[e[0]] = evaluerT(x, heure); }
  return r;
}

const memes = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Lit un shader.json (texte ou objet). Voir l'entete. Erreur claire (ErreurShader) si une valeur est fausse.
export function lireShader(brut) {
  let o = brut;
  if (typeof brut === 'string') { try { o = JSON.parse(brut); } catch (e) { throw new ErreurShader(`shader.json : JSON invalide (${e.message})`); } }
  if (!estObjet(o)) throw new ErreurShader('shader.json : un objet JSON est attendu (par exemple {} ou {"version": 1, ...})');
  const v = {};
  for (const e of TABLE) v[e[0]] = Array.isArray(e[2]) ? e[2].slice() : e[2];
  const donnees = new Set(), inconnues = [];
  // marche recursive : "a.b.c" est une feuille si la table la connait ; "dimensions", "parBiome", "parBloc" prennent tout l'objet
  const marche = (obj, prefixe) => {
    for (const [k, x] of Object.entries(obj)) {
      const ch = prefixe ? `${prefixe}.${k}` : k;
      const e = PAR_CHEMIN.get(ch);
      if (e) { v[ch] = valeurT(e, x, ch); donnees.add(ch); continue; }
      const estGroupe = TABLE.some((t) => t[0].startsWith(ch + '.'));
      if (estGroupe) {
        if (!estObjet(x)) err(ch, 'un objet est attendu');
        marche(x, ch);
      } else inconnues.push(ch);
    }
  };
  marche(o, '');
  if (Object.keys(o).length && o.version === undefined) err('version', 'obligatoire des qu\'on ecrit autre chose que {} (mettre 1)');
  // options connues mais pas gerees (palier 2 ou 3, ou non faites) : seulement si elles different du defaut
  const nonGerees = [];
  for (const ch of donnees) {
    const e = PAR_CHEMIN.get(ch);
    if (e[5] >= 2 && !PROMUES.has(ch) && !memes(v[ch], e[2])) nonGerees.push(ch);
  }
  const notes = [];
  const liste = [...nonGerees, ...inconnues.map((c) => c + ' (inconnue)')];
  if (liste.length) notes.push('options non prises en charge : ' + (liste.length > 8 ? liste.slice(0, 8).join(', ') + ` et ${liste.length - 8} autres` : liste.join(', ')));
  const diff = (ch) => donnees.has(ch) && !memes(v[ch], PAR_CHEMIN.get(ch)[2]);
  const un = (prefixes) => [...donnees].some((c) => prefixes.some((p) => c === p || c.startsWith(p + '.')) && diff(c) && !(PAR_CHEMIN.get(c)[5] >= 2 && !PROMUES.has(c)));
  const actif = {
    ombres: v['ombres.actif'] === true,
    lumiere: un(['lumiere']),
    ciel: un(['ciel', 'nuages']),
    brume: un(['brume']),
    rayons: un(['rayons']) && !!maxT(v['rayons.intensite']),
    lueur: !!maxT(v['lueur.intensite']),
    tonalite: un(['tonalite']),
    etalonnage: un(['etalonnage']),
    vignette: !!maxT(v['ecran.vignette']),
    vegetation: v['vegetation.feuilles.amplitude'] > 0 || v['vegetation.herbe.amplitude'] > 0,
    eau: un(['eau']),
    occlusion: v['occlusion.force'] !== 1,
  };
  actif.eauSurface = v['eau.vagues.hauteur'] > 0 || !!maxT(v['eau.reflet.ciel']) || v['eau.opacite'] !== 1 || !!v['eau.couleur'];
  actif.post = actif.rayons || actif.lueur || actif.tonalite || actif.etalonnage || actif.vignette;
  actif.rien = !Object.values(actif).some(Boolean);
  return { v, actif, notes, avertissements: [], nom: v.nom };
}

// Les cles de palier 2 que le lecteur sait faire (voir FORMAT-SHADER.md : elles sont "faites" en plus du palier 1).
export const PROMUES = new Set(['ombres.acteurs', 'ombres.acteursOpacite']);

function maxT(x) { if (x && x.h) return Math.max(...x.v); return x; }
export { PALIER_FAIT };
