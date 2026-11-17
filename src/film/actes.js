// Champ d'acteur `actes` : des INTENTIONS datees `[t, "verbe", ...arguments]` que le moteur de simulation (moteur/acteurs.js) execute comme un joueur.
// Ce fichier ne fait que LIRE et CONTROLER la syntaxe (pas de moteur, pas de donnees du jeu) ; les messages donnent le chemin du champ.
//   va x z [x y z] ["marche"|"court"|"accroupi"] [{ouvrePortes, max, rayon}]      marche (A* sur le monde vivant) ; sans chemin : tout droit, et dit ce qui bloque
//   regarde x y z | "acteur" | null                                              regard (tete, puis corps au dela de 50 degres) jusqu'a nouvel ordre
//   saute | accroupi 0|1 | tient "objet"|null [{eff}] | attends secondes
//   utilise x y z [{va, ouvrePortes, duree, face}]                                clic droit : porte, trappe, portillon, levier, bouton, coffre, tonneau, cloche, bloc musical ;
//                                                                                 avec un objet : seau (eau, lave, reprise), briquet et charge de feu ; face impose la face cliquee
//   pose x y z "bloc" ["face"] [{va, face}]                                       pose un bloc dans la cellule (regles de pose du jeu), contre un bloc voisin
//   casse x y z [{va, max}]                                                       casse un bloc : duree selon l'outil tenu ; fissures, son, particules
import { voulaisTu } from '../moteur/util.js';

export const VERBES = ['va', 'regarde', 'saute', 'accroupi', 'tient', 'attends', 'utilise', 'pose', 'casse'];
export const MAX_ACTES = 200;
const VITESSES = ['marche', 'court', 'accroupi'];
const FACES = ['haut', 'bas', 'nord', 'sud', 'est', 'ouest', 'up', 'down', 'north', 'south', 'east', 'west'];
const OPTIONS = {
  va: ['ouvrePortes', 'max', 'rayon'],
  utilise: ['va', 'ouvrePortes', 'duree', 'max', 'face'],
  pose: ['va', 'ouvrePortes', 'face', 'max'],
  casse: ['va', 'ouvrePortes', 'max'],
  tient: ['eff'],
};
const estNombre = (x) => typeof x === 'number' && Number.isFinite(x);
const estObjet = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const ID_OBJET = /^(minecraft:)?[a-z0-9_./-]{1,80}$/;

// brut : liste [[t, "verbe", ...]] ; ch : "acteurs[0].actes" ; erreur(chemin, message) leve ; noms : noms d'acteurs ; duree : secondes de la scene
export function lireActes(brut, ch, erreur, { noms, duree }) {
  if (!Array.isArray(brut) || brut.length === 0) erreur(ch, 'liste d\'intentions attendue, par exemple [[1, "va", 12, 40], [3, "utilise", 14, 64, 40]]');
  if (brut.length > MAX_ACTES) erreur(ch, `${MAX_ACTES} intentions au maximum`);
  let prec = 0;
  return brut.map((k, i) => {
    const c = `${ch}[${i}]`;
    if (!Array.isArray(k) || k.length < 2) erreur(c, 'forme attendue : [temps, "verbe", arguments...] (verbes : ' + VERBES.join(', ') + ')');
    const [t, verbe, ...args] = k;
    if (!estNombre(t) || t < 0 || t > duree) erreur(`${c}[0]`, `temps entre 0 et ${duree} secondes attendu`);
    if (t < prec) erreur(`${c}[0]`, 'les intentions doivent etre classees par temps croissant');
    prec = t;
    if (typeof verbe !== 'string' || !VERBES.includes(verbe)) erreur(`${c}[1]`, `verbe inconnu ${JSON.stringify(verbe)}${voulaisTu(String(verbe), VERBES)} (permis : ${VERBES.join(', ')})`);
    // options : un objet a la fin
    let opts = {};
    if (args.length && estObjet(args[args.length - 1])) opts = args.pop();
    for (const o of Object.keys(opts)) if (!(OPTIONS[verbe] || []).includes(o)) erreur(`${c}`, `option "${o}" inconnue pour ${verbe}${voulaisTu(o, OPTIONS[verbe] || [])}${OPTIONS[verbe] ? ' (permis : ' + OPTIONS[verbe].join(', ') + ')' : ' (ce verbe n\'a pas d\'option)'}`);
    for (const [o, v] of Object.entries(opts)) {
      if (['ouvrePortes', 'va'].includes(o) && typeof v !== 'boolean') erreur(`${c}.${o}`, 'true ou false attendu');
      if (['max', 'rayon', 'duree'].includes(o) && !(estNombre(v) && v > 0 && v <= 600)) erreur(`${c}.${o}`, 'nombre de secondes ou de blocs entre 0 et 600 attendu');
      if (o === 'eff' && !(Number.isInteger(v) && v >= 0 && v <= 10)) erreur(`${c}.${o}`, 'niveau d\'efficacite entier de 0 a 10 attendu');
    }
    const nombres = (n, noms2) => {
      if (args.length < n || !args.slice(0, n).every(estNombre)) erreur(c, `${verbe} : ${noms2} attendus (nombres), par exemple ${exemples[verbe]}`);
      return args.slice(0, n);
    };
    const entiers = (n) => {
      const v = nombres(n, 'x, y, z (coordonnees entieres du bloc)');
      v.forEach((x, j) => { if (!Number.isInteger(x) || Math.abs(x) > 30000000) erreur(`${c}[${j + 2}]`, 'entier attendu (coordonnee de bloc)'); });
      return v;
    };
    const exemples = { va: '[1, "va", 12, 40]', utilise: '[3, "utilise", 14, 64, 40]', casse: '[2, "casse", 14, 63, 40]', pose: '[2, "pose", 14, 64, 40, "oak_fence"]' };
    const a = { t, verbe, opts };
    switch (verbe) {
      case 'va': {
        const nums = args.filter(estNombre), mots = args.filter((x) => typeof x === 'string');
        if (nums.length !== 2 && nums.length !== 3) erreur(c, 'va : "x, z" ou "x, y, z" attendu, par exemple [1, "va", 12, 40, "court"]');
        if (args.length !== nums.length + mots.length) erreur(c, 'va : arguments inattendus (nombres puis mot de vitesse, puis options)');
        if (mots.length > 1 || (mots[0] !== undefined && !VITESSES.includes(mots[0]))) erreur(c, `va : vitesse ${JSON.stringify(mots[0])} inconnue${voulaisTu(String(mots[0]), VITESSES)} (permis : ${VITESSES.join(', ')})`);
        if (nums.length === 2) { a.x = nums[0]; a.z = nums[1]; } else { a.x = nums[0]; a.y = nums[1]; a.z = nums[2]; }
        a.vitesse = mots[0] ?? 'marche';
        a.resume = `va ${a.x},${a.z}${a.vitesse !== 'marche' ? ' ' + a.vitesse : ''}`;
        break;
      }
      case 'regarde': {
        if (args.length === 1 && args[0] === null) a.cible = null;
        else if (args.length === 1 && typeof args[0] === 'string') {
          if (!noms.has(args[0])) erreur(`${c}[2]`, `acteur inconnu ${JSON.stringify(args[0])} (acteurs : ${[...noms].join(', ')})`);
          a.cible = { acteur: args[0] };
        } else { const [x, y, z] = nombres(3, 'x, y, z'); a.cible = { x, y, z }; }
        a.resume = a.cible === null ? 'regarde -' : a.cible.acteur ? `regarde ${a.cible.acteur}` : `regarde ${a.cible.x},${a.cible.y},${a.cible.z}`;
        break;
      }
      case 'saute': a.resume = 'saute'; break;
      case 'accroupi': {
        if (!(args.length === 1 && (args[0] === 0 || args[0] === 1 || typeof args[0] === 'boolean'))) erreur(c, 'accroupi : 0 ou 1 attendu, par exemple [2, "accroupi", 1]');
        a.valeur = args[0] === true || args[0] === 1; a.resume = `accroupi ${a.valeur ? 1 : 0}`; break;
      }
      case 'tient': {
        if (!(args.length === 1 && (args[0] === null || (typeof args[0] === 'string' && ID_OBJET.test(args[0]))))) erreur(c, 'tient : identifiant d\'objet du jeu ou null attendu, par exemple [0, "tient", "iron_pickaxe"]');
        a.objet = args[0] === null ? null : args[0].replace(/^minecraft:/, ''); a.resume = `tient ${a.objet ?? '-'}`; break;
      }
      case 'attends': {
        if (!(args.length === 1 && estNombre(args[0]) && args[0] >= 0 && args[0] <= 600)) erreur(c, 'attends : nombre de secondes attendu, par exemple [2, "attends", 1.5]');
        a.secondes = args[0]; a.resume = `attends ${a.secondes}`; break;
      }
      case 'utilise': case 'casse': {
        [a.x, a.y, a.z] = entiers(3);
        if (args.length > 3) erreur(c, `${verbe} : x, y, z puis des options {...} seulement`);
        if (verbe === 'utilise' && a.opts.face !== undefined && !FACES.includes(a.opts.face)) erreur(`${c}.face`, `face inconnue (permis : haut, bas, nord, sud, est, ouest) ; "haut" : le dessus du bloc (briquet, seau)`);
        a.resume = `${verbe} ${a.x},${a.y},${a.z}`; break;
      }
      case 'pose': {
        [a.x, a.y, a.z] = entiers(3);
        if (typeof args[3] !== 'string' || !ID_OBJET.test(args[3])) erreur(`${c}[5]`, 'pose : nom du bloc du jeu attendu apres x, y, z, par exemple "oak_fence" (mcanim objets --cherche mot)');
        a.bloc = args[3].replace(/^minecraft:/, '');
        if (args.length > 5 || (args.length === 5 && typeof args[4] !== 'string')) erreur(c, 'pose : x, y, z, "bloc" [, "face"] [, options]');
        if (args[4] !== undefined) { if (!FACES.includes(args[4])) erreur(`${c}[6]`, `face inconnue ${JSON.stringify(args[4])} (permis : haut, bas, nord, sud, est, ouest)`); a.opts = { ...opts, face: args[4] }; }
        if (a.opts.face !== undefined && !FACES.includes(a.opts.face)) erreur(`${c}.face`, `face inconnue (permis : haut, bas, nord, sud, est, ouest)`);
        a.resume = `pose ${a.x},${a.y},${a.z} ${a.bloc}`; break;
      }
      default: break;
    }
    return a;
  });
}

// Acteurs commandes par la simulation (champ `actes`) : nom, depart, direction, objet en main, intentions
export function descripteursActeurs(scene) {
  return scene.acteurs.filter((a) => a.actes).map((a) => {
    const k = a.pos.cles[0];
    const premier = a.actes.find((x) => x.verbe === 'va' || x.verbe === 'regarde' && x.cible && x.cible.x !== undefined);
    const but = premier ? (premier.verbe === 'va' ? [premier.x, premier.z] : [premier.cible.x, premier.cible.z]) : null;
    const lacet = a.lacet ? a.lacet.cles[0].v[0] : but && Math.hypot(but[0] - k.x, but[1] - k.z) > 0.5 ? Math.atan2(-(but[0] - k.x), but[1] - k.z) * 180 / Math.PI : 0;
    return { nom: a.nom, pos: Number.isFinite(k.y) ? [k.x, k.y, k.z] : [k.x, k.z], lacet, objet: a.objetD?.cles?.[0]?.id ?? null, actes: a.actes, vie: a.vie, invulnerable: a.invulnerable, ramasse: a.ramasse };
  });
}

