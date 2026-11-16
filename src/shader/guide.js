// Guide pour l'assistant (LLM) qui traduit un pack de shaders en `shader.json` : `mcanim shader --guide`, `--cles <famille>`.
// Le texte des cles est GENERE depuis la table du code (format.js : chemin, type, plage, defaut, palier) : il ne peut pas deriver.
// Seule la phrase de sens (SENS) est ecrite ici ; un test verifie qu'il y en a une pour chaque cle prise en charge, et pas une de trop.
// Tout est en ASCII : 1 caractere = 1 octet (budget : 6000 octets pour --guide, il coute des jetons au client).
import { TABLE, PROMUES, lireShader } from './format.js';

// Cle prise en charge = palier 1 (ou palier 2 promu). Les cles "meta" (palier 0 : version, nom...) sont decrites dans la methode.
export const prisEnCharge = (e) => e[5] === 1 || PROMUES.has(e[0]);
export const CLES = TABLE.filter(prisEnCharge);

// Phrase de sens (mot courant des packs entre parentheses quand il aide a chercher). `T` = peut dependre de l'heure (marque par le code).
export const SENS = {
  'performance.echellePost': 'resolution des effets, petit = rapide',
  'performance.cuisson': 'finesse des ombres, 2 = net',
  'qualite': 'reglage global',
  'lumiere.soleil': 'couleur du soleil (sunlight)',
  'lumiere.ambiante': 'couleur de la lumiere douce (ambient)',
  'lumiere.intensiteSoleil': 'force du soleil',
  'lumiere.intensiteAmbiante': 'force de la lumiere douce',
  'lumiere.partDirecte': 'part du soleil',
  'lumiere.minimum': 'lumiere minimale (min light)',
  'ombres.actif': 'ombres du soleil (shadows)',
  'ombres.distance': 'portee (shadowDistance)',
  'ombres.intensite': 'noirceur',
  'ombres.feuillage': 'ombre des feuilles',
  'ombres.acteurs': 'ombre des personnages',
  'ombres.acteursOpacite': 'noirceur de cette ombre',
  'ombres.pasHeure': "pas d'heures, 0 = continu",
  'ombres.couleur': 'teinte des ombres',
  'ombres.verre': 'ombre du verre',
  'ombres.eau': "ombre de l'eau",
  'occlusion.force': 'coins sombres (ambient occlusion, AO)',
  'ciel.zenith': 'haut du ciel (zenith)',
  'ciel.horizon': "ciel a l'horizon",
  'ciel.bas': "sous l'horizon",
  'ciel.teinte': 'filtre de couleur du ciel',
  'ciel.intensite': 'luminosite du ciel',
  'ciel.lueurCrepuscule': 'lueur du coucher',
  'ciel.inclinaisonTrajet': 'inclinaison du soleil, deg',
  'ciel.soleil.visible': 'montrer le soleil',
  'ciel.soleil.taille': '',
  'ciel.soleil.forme': 'carre (jeu) ou rond',
  'ciel.soleil.couleur': 'couleur du disque',
  'ciel.soleil.halo': 'lueur autour (sun glow)',
  'ciel.soleil.haloRayon': 'taille de la lueur',
  'ciel.lune.visible': 'montrer la lune',
  'ciel.lune.taille': '',
  'ciel.lune.couleur': '',
  'ciel.lune.halo': 'lueur autour',
  'ciel.lune.phases': 'phases de la lune',
  'ciel.etoiles.densite': "nombre d'etoiles (stars)",
  'ciel.etoiles.luminosite': 'eclat',
  'ciel.etoiles.couleur': '',
  'nuages.style': 'aucun, plats, epais (clouds)',
  'nuages.altitude': 'hauteur (CLOUD_ALT)',
  'nuages.vitesse': '',
  'nuages.couleur': '',
  'nuages.opacite': '',
  'brume.densite': 'brouillard (fog), 1 = jeu',
  'brume.courbe': 'fondu avec la distance',
  'brume.couleur': 'couleur du brouillard',
  'brume.hauteur.densite': 'brume basse (low fog)',
  'brume.hauteur.niveau': 'altitude',
  'brume.hauteur.epaisseur': 'epaisseur de la couche',
  'rayons.intensite': 'rayons de lumiere (god rays, volumetric)',
  'rayons.echantillons': 'finesse',
  'rayons.decroissance': 'fondu',
  'rayons.longueur': '',
  'rayons.couleur': '',
  'lueur.intensite': 'halo des zones claires (bloom)',
  'lueur.seuil': 'clarte minimale',
  'lueur.rayon': 'etendue, pixels',
  'lueur.couleur': 'teinte',
  'tonalite.exposition': 'luminosite globale (exposure)',
  'tonalite.courbe': 'courbe de tons (tone mapping)',
  'tonalite.blancMax': 'blanc maximal (white point)',
  'tonalite.gamma': 'gamma de sortie',
  'etalonnage.saturation': '',
  'etalonnage.vibrance': 'saturation des teintes ternes (vibrance)',
  'etalonnage.contraste': '',
  'etalonnage.temperature': '-1 froid a 1 chaud',
  'etalonnage.teinte': 'filtre global (colour grading)',
  'etalonnage.teinteOmbres': 'teinte des ombres',
  'etalonnage.teinteHautesLumieres': 'teinte des clairs',
  'etalonnage.desaturationSombre': 'gris dans le noir',
  'eau.couleur': "couleur de l'eau (water colour)",
  'eau.opacite': '',
  'eau.vagues.hauteur': 'hauteur (waving water)',
  'eau.vagues.vitesse': '',
  'eau.vagues.echelle': '',
  'eau.reflet.ciel': 'reflet du ciel (reflections)',
  'eau.reflet.fresnel': 'reflet fort en rasant (fresnel)',
  'eau.sousEau.couleur': "couleur sous l'eau (underwater)",
  'eau.sousEau.distance': 'visibilite, 0 = jeu',
  'eau.sousEau.luminosite': 'clarte',
  'vegetation.feuilles.amplitude': 'feuilles qui bougent, blocs (waving)',
  'vegetation.feuilles.vitesse': '',
  'vegetation.herbe.amplitude': 'herbe qui bouge, blocs',
  'vegetation.herbe.vitesse': '',
  'vegetation.echelle': 'taille du mouvement',
  'vegetation.vent.direction': 'sens du vent, degres',
  'vegetation.vent.rafales': '',
  'vegetation.distance': 'portee, blocs',
  'ecran.vignette': 'bords sombres (vignette)',
  'acteurs.lumiereMonde': 'personnages eclaires comme le monde',
  'acteurs.respecterExemptions': 'garder lueur/masque',
};

const nb = (x) => String(Math.round(x * 1000) / 1000);
const defaut = (e) => {
  const d = e[2];
  if (e[1] === 'cn') return 'jeu';
  if (e[1] === 'c') return d.map(nb).join(',');
  if (e[1] === 'b' || typeof d === 'string') return String(d);
  return nb(d);
};
// type et plage : n/i "a..b" (i : entier), b "b", e "a|b|c", c "c" (0..1) ou "c0-M".
function typePlage(e) {
  switch (e[1]) {
    case 'n': return `${nb(e[3])}..${nb(e[4])}`;
    case 'i': return `int ${nb(e[3])}..${nb(e[4])}`;
    case 'b': return 'b';
    case 'e': return e[3].join('|');
    case 'c': case 'cn': return e[4] > 1 ? `rvb0-${e[4]}` : 'rvb';
    default: return e[1];
  }
}

// Une ligne par cle : `chemin~ type =defaut sens`. `nom` : partie du chemin a afficher (le reste est dans l'en-tete du groupe).
const ligne = (e, nom) => `${nom}${e[6] ? '~' : ''} ${typePlage(e)} =${defaut(e)} ${SENS[e[0]] || ''}`.trimEnd();

// Groupes d'affichage : prefixe commun le plus long jusqu'au dernier point (ex. "ciel.soleil." pour ciel.soleil.taille).
function groupes(liste) {
  const g = new Map();
  for (const e of liste) {
    const i = e[0].indexOf('.');
    const pre = i < 0 ? '' : e[0].slice(0, i);
    if (!g.has(pre)) g.set(pre, []);
    g.get(pre).push(e);
  }
  return g;
}

const METHODE = `METHODE (pack Iris/OptiFine .zip)
1. mcanim shader --extraire pack.zip : profils, options, const. Ouvre un fichier du dossier seulement pour un detail. Famille en detail : shader --cles ciel.
2. Depart : choix du client > profil par defaut du pack > profil du milieu (dis-le dans "profil") > #define livres (//#define = eteint). Un profil s'applique par-dessus : OPT:valeur fixe, OPT active, !OPT eteint.
3. Cherche par mot : SHADOW BLOOM FOG CLOUD WAV WATER SUN SAT EXPO VIGN GOD AO. sunPathRotation -> ciel.inclinaisonTrajet ; shadowDistance -> ombres.distance ; shadowMapResolution -> cuisson (<=1024:0, 2048:1, >=4096:2).
4. Couleurs par heure : constantes vec3 (sun, zenith, horizon, fog, water) a minuit "0", lever "6", midi "12", coucher "18". lumiere.* = multiplicateurs : divise par la couleur de midi, mais la nuit du jeu est deja bleu lisible : multiplicateurs de nuit >= 0.75, exposition de nuit <= 1.3. Pourcent : /100. pow(c,2.2) a l'entree : copie ; sinon c^(1/2.2).
5. block.properties : feuilles/herbe qui bougent -> vegetation.* (herbe 0.12, feuilles 0.06).
6. Ecris SEULEMENT les cles qui different du defaut ; au doute, l'effet le plus faible. Remplis nom, origine, profil, notes. God rays 0.3 (leger) a 0.6 ; bloom = coefficient du pack.
7. Ignore : buffers, debug, compatibilite, textures.
8. Sans equivalent (relief POM, reflets des blocs, lumiere en main, flou, aurore) : laisse de cote, mets-le dans notes, dis-le en UNE ligne. Dis "dans l'esprit du pack", jamais "identique".
9. shader --verifier shader.json ; apercu scene.json --t 3 --shader shader.json (regarde l'image) ; rendre --shader. Surcout : leger +25%, complet +55%.
`;

export function texteGuide() {
  const ent = `MCANIM shader.json : nombres seulement, "version":1 obligatoire, cle absente = neutre, {} = rendu normal, hors plage = refuse.
cle~ : nombre ou table par heure {"0":x,"6":x,"12":x,"18":x}. rvb = [r,g,b] 0..1 (rvb0-3 : multiplicateur, 1 = inchange). =defaut ("jeu" = couleur du jeu).
`;
  const g = groupes(CLES);
  const corps = [];
  for (const [pre, liste] of [...g].sort((p, q) => (p[0] === '' ? -1 : q[0] === '' ? 1 : 0))) {
    const n = pre.length ? pre.length + 1 : 0;
    if (pre) corps.push(`[${pre}]`);
    for (const e of liste) corps.push(ligne(e, e[0].slice(n)));
  }
  return ent + corps.join('\n') + '\n' + METHODE;
}

// `--cles <famille>` : une famille en detail (toutes ses cles, y compris celles que le lecteur ne gere pas encore).
export function texteFamille(nom) {
  const f = String(nom || '').replace(/\.$/, '');
  const toutes = TABLE.filter((e) => e[5] > 0 && (e[0] === f || e[0].startsWith(f + '.')));
  if (!toutes.length) {
    const familles = [...new Set(TABLE.filter((e) => e[5] > 0).map((e) => e[0].split('.')[0]))];
    return { ok: false, texte: `famille inconnue : "${f}". Familles : ${familles.join(', ')}` };
  }
  const sortie = [`famille ${f} (${toutes.length} cles ; ~ = table par heure permise)`];
  for (const e of toutes) {
    const gere = prisEnCharge(e);
    const t = e[1] === 'e' ? `un de ${e[3].map((x) => JSON.stringify(x)).join(', ')}` : e[1] === 'b' ? 'true ou false' : e[1] === 'c' || e[1] === 'cn' ? `[r,g,b], chaque canal 0..${e[4]}` : e[1] === 'i' ? `entier ${e[3]}..${e[4]}` : e[1] === 'n' ? `nombre ${e[3]}..${e[4]}` : e[1];
    sortie.push(`${e[0]}${e[6] ? '~' : ''} : ${t} ; defaut ${defaut(e)}${gere ? '' : ` ; palier ${e[5]} : NON pris en charge, ignore`}${SENS[e[0]] ? ' ; ' + SENS[e[0]] : ''}`);
  }
  return { ok: true, texte: sortie.join('\n') };
}

// `--verifier shader.json` : controle complet (erreur = chemin de la cle) puis liste des cles posees mais ignorees (palier 2/3 ou inconnues).
// Retourne { ok, texte }. Rien n'est execute : lireShader ne fait que lire des nombres.
export function verifierTexte(contenu) {
  let r;
  try { r = lireShader(contenu); } catch (e) { return { ok: false, texte: 'invalide : ' + String(e.message).replace(/^shader\.json : /, '') }; }
  const o = JSON.parse(contenu);
  const connus = new Map(TABLE.map((e) => [e[0], e]));
  const posees = [], ignorees = [];
  const marche = (x, pre) => {
    for (const [k, v] of Object.entries(x)) {
      const ch = pre ? pre + '.' + k : k, e = connus.get(ch);
      if (e) { if (e[5] === 0) continue; (prisEnCharge(e) ? posees : ignorees).push(ch + (prisEnCharge(e) ? '' : ` (palier ${e[5]})`)); continue; }
      if (v && typeof v === 'object' && !Array.isArray(v) && TABLE.some((t) => t[0].startsWith(ch + '.'))) marche(v, ch);
      else ignorees.push(ch + ' (inconnue)');
    }
  };
  marche(o, '');
  const actives = Object.entries(r.actif).filter(([k, v]) => v && !['post', 'rien', 'eauSurface'].includes(k)).map(([k]) => k);
  const t = [`OK : ${posees.length} cle(s) prises en charge ; familles actives : ${actives.join(', ') || 'aucune (rendu normal)'}`];
  if (ignorees.length) t.push(`ignorees (${ignorees.length}) : ${ignorees.join(', ')}`);
  else t.push('aucune cle ignoree');
  return { ok: true, texte: t.join(String.fromCharCode(10)), posees, ignorees };
}
