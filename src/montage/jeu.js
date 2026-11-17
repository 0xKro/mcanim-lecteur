// Jeu d'acteur : ce qui fait vivre un personnage qui ne marche pas. Deux couches, ajoutees a la pose calculee (anim.js), jamais a la place des pistes de la scene.
//   1. VIE (au repos) : respiration (le buste et les bras bougent d'un rien), la tete vit (bruit lent, micro-mouvements), le regard va vers l'autre personnage
//      (la tete tourne de 85 % de l'angle, jusqu'a 50 degres). Un acteur qui marche, saute ou nage n'en a pas besoin : la marche suffit.
//   2. GESTES sur mots cles : `gestes` d'un acteur = [[t | "@mot", "geste", options?], ...] ; "@creative" = l'instant ou ce mot des sous-titres est dit.
//      Gestes : hocher, nier, pointer, montrer, lever, saluer, regarder, recul.
// La vie est ACTIVE par defaut seulement si la scene a des champs de montage (plans, textes, sousTitres, incrustations) : les scenes d'avant gardent leurs images
// au bit pres. Champ de scene `jeu` (true / false) ou d'acteur `jeu` (false, ou { intensite 0..2, regard true/false }) pour decider.
import { bruit } from './effets-camera.js';

const RAD = Math.PI / 180;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lisse = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const normaliser180 = (a) => { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; };
const estNombre = (x) => typeof x === 'number' && Number.isFinite(x);
const estObjet = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Signe : tete[0] > 0 tourne la tete vers la GAUCHE de l'acteur (verifie sur une image, test/montage-jeu.test.js).
export const SIGNE_TETE = 1;
export const GESTES = {
  hocher: { duree: 0.8 }, nier: { duree: 0.9 }, pointer: { duree: 1.2 }, montrer: { duree: 1.4 }, lever: { duree: 1.4 }, saluer: { duree: 1.2 }, regarder: { duree: 1.2 }, recul: { duree: 0.9 },
};
export const NOMS_GESTES = Object.keys(GESTES);

// La scene joue-t-elle la vie par defaut ? (champ `jeu` de la scene, sinon : elle a des champs de montage)
export const jeuDeScene = (s, aMontage) => (s.jeu !== undefined ? s.jeu === true : aMontage);

// Controle de `jeu` et `gestes` d'un acteur. D = { err, noms }. Retourne { jeu, gestes } a ajouter a l'acteur.
export function lireJeuActeur(D, a, ch) {
  const o = { jeu: { actif: true, intensite: 1, regard: true }, gestes: [] };
  if (a.jeu !== undefined) {
    if (a.jeu === false) o.jeu.actif = false;
    else if (a.jeu === true) o.jeu.actif = true;
    else if (estObjet(a.jeu)) {
      for (const k of Object.keys(a.jeu)) if (!['intensite', 'regard'].includes(k)) D.err(`${ch}.jeu.${k}`, 'champ inconnu ; permis : intensite, regard');
      if (a.jeu.intensite !== undefined) { if (!estNombre(a.jeu.intensite) || a.jeu.intensite < 0 || a.jeu.intensite > 2) D.err(`${ch}.jeu.intensite`, 'nombre entre 0 et 2 attendu (1 = normal)'); o.jeu.intensite = a.jeu.intensite; }
      if (a.jeu.regard !== undefined) { if (typeof a.jeu.regard !== 'boolean') D.err(`${ch}.jeu.regard`, 'true ou false attendu'); o.jeu.regard = a.jeu.regard; }
    } else D.err(`${ch}.jeu`, 'false (pas de vie), true, ou { "intensite": 0..2, "regard": true|false } attendu');
  }
  if (a.gestes !== undefined) {
    if (!Array.isArray(a.gestes) || a.gestes.length > 40) D.err(`${ch}.gestes`, 'liste de 40 gestes au plus : [[2.5, "pointer", {"vers":"kira"}], ["@creative", "montrer"]]');
    o.gestes = a.gestes.map((g, i) => {
      const c = `${ch}.gestes[${i}]`;
      if (!Array.isArray(g) || g.length < 2 || g.length > 3) D.err(c, 'forme attendue : [temps | "@mot", "geste", options?]');
      const [quand, nom, opt = {}] = g;
      if (!NOMS_GESTES.includes(nom)) D.err(`${c}[1]`, `geste : un de ${NOMS_GESTES.join(', ')}`);
      if (!estObjet(opt)) D.err(`${c}[2]`, 'options : un objet attendu');
      for (const k of Object.keys(opt)) if (!['duree', 'vers', 'bras', 'force', 'retard'].includes(k)) D.err(`${c}[2].${k}`, 'champ inconnu ; permis : duree, vers, bras, force, retard');
      let mot = null, n = 0;
      if (typeof quand === 'string') {
        const m = /^@(.+?)(?:#(\d+))?$/.exec(quand.trim());
        if (!m) D.err(`${c}[0]`, 'temps en secondes ou "@mot" (ou "@mot#2" : la 2e fois qu\'il est dit)');
        mot = m[1].toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); n = m[2] ? Number(m[2]) - 1 : 0;
      } else if (!estNombre(quand) || quand < 0) D.err(`${c}[0]`, 'temps en secondes (>= 0) ou "@mot" attendu');
      if (opt.vers !== undefined && (typeof opt.vers !== 'string' || !D.noms.has(opt.vers))) D.err(`${c}[2].vers`, `acteur inconnu : ${JSON.stringify(opt.vers)}`);
      if (opt.bras !== undefined && opt.bras !== 'D' && opt.bras !== 'G') D.err(`${c}[2].bras`, '"D" (bras droit, celui qui tient l\'objet) ou "G"');
      for (const [k, lo, hi] of [['duree', 0.2, 6], ['force', 0, 2], ['retard', -2, 5]]) if (opt[k] !== undefined && (!estNombre(opt[k]) || opt[k] < lo || opt[k] > hi)) D.err(`${c}[2].${k}`, `nombre entre ${lo} et ${hi} attendu`);
      return { t: mot ? null : quand, mot, n, nom, duree: opt.duree ?? GESTES[nom].duree, vers: opt.vers ?? null, bras: opt.bras ?? 'D', force: opt.force ?? 1, retard: opt.retard ?? 0 };
    });
  }
  return o;
}

// "@mot" -> instant : motsTemps = [{ t, mot }] de tous les sous-titres (classes). Un mot introuvable est une erreur claire.
export function resoudreGestes(acteurs, motsTemps, err) {
  for (const a of acteurs) {
    for (const g of a.gestes ?? []) {
      if (g.mot === null) continue;
      const trouves = motsTemps.filter((m) => m.mot.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === g.mot);
      if (!trouves.length) err(`acteurs.${a.nom}.gestes`, `le mot "@${g.mot}" n'est dans aucun sous-titre (mots : ${[...new Set(motsTemps.map((m) => m.mot))].slice(0, 8).join(', ')}...)`);
      const m = trouves[Math.min(g.n, trouves.length - 1)];
      g.t = m.t + g.retard;
    }
    a.gestes?.sort((x, y) => x.t - y.t);
  }
  // parole : les blocs de sous-titres avec `qui` -> repliques de chaque acteur { debut, fin, qui, accents: [t], mots: [t] }
  const blocs = new Map();
  for (const m of motsTemps) {
    if (!m.qui) continue;
    const b = blocs.get(m.bloc) ?? blocs.set(m.bloc, { debut: m.t, fin: m.fin, qui: m.qui, accents: [], mots: [] }).get(m.bloc);
    b.mots.push(m.t); if (m.accent) b.accents.push(m.t);
  }
  const repliques = [...blocs.values()].sort((x, y) => x.debut - y.debut);
  for (const a of acteurs) {
    if (!repliques.length || a.creature) continue;
    a.parole = repliques.filter((r) => r.qui === a.nom);   // ce qu'il dit
    a.ecoute = repliques.filter((r) => r.qui !== a.nom);   // ce qu'il ecoute (il regarde celui qui parle)
  }
}

// ---------------------------------------------------------------- marche automatique
// Un acteur que la scene DEPLACE (piste pos) sans ecrire de jambes (ni piste ni boucle jambeD/jambeG) glissait, raide, sur le sol.
// Dans une scene montee (`jeu` actif) il marche tout seul : la foulee de la fiche marcher (periode 2,16 / v des 2,4 blocs/s, 0,9 s
// en dessous avec des angles x v / 2,4), hanches 42 -> 8 -> -43, genoux jusqu'a 80, bras +-33 opposes, coudes 20 a 40. La phase
// avance avec la vitesse lissee (l'acteur demarre et s'arrete sans a-coup). Rien pour une creature, une monture, un acteur a intentions.
const jambesEcrites = (a) => !!(a.jambeD || a.jambeG || a.genouD || a.genouG || a.boucles?.some((b) => b.pistes.jambeD || b.pistes.jambeG || b.pistes.genouD || b.pistes.genouG));
export function marcheAutoPossible(a) {
  if (a.creature || a.monture || a.actes) return false;
  if (jambesEcrites(a)) return false;
  const c = a.pos?.cles ?? [];
  return c.some((k) => Math.hypot(k.x - c[0].x, k.z - c[0].z) > 0.05);
}
const DT_IMAGE = 1 / 30;
// Avance l'etat de marche `e` (objet de l'acteur dans anim.js) d'une image, v = vitesse horizontale (blocs/s).
export function avancerMarche(e, v) {
  const prec = e.vMarche ?? 0;
  e.vMarche = prec + (Math.min(8, v) - prec) * 0.35;   // ~0,1 s pour prendre la vitesse
  const periode = e.vMarche >= 2.4 ? 2.16 / e.vMarche : 0.9;
  if (e.vMarche > 0.05) e.phaseMarche = ((e.phaseMarche ?? 0) + DT_IMAGE / periode) % 1;   // a l'arret la phase reste : les jambes reviennent par l'amplitude
}
// interpolation periodique de cles [[phase, valeur]] (la derniere rejoint la premiere), lissee
function cycle(cles, ph) {
  for (let k = 0; k < cles.length; k++) {
    const [p0, v0] = cles[k], [p1, v1] = k + 1 < cles.length ? cles[k + 1] : [1 + cles[0][0], cles[0][1]];
    if (ph >= p0 && ph < p1) { const u = (ph - p0) / (p1 - p0); return v0 + (v1 - v0) * (0.5 - 0.5 * Math.cos(Math.PI * u)); }
  }
  return cles[0][1];
}
const HANCHE = [[0, 42], [0.3, 8], [0.64, -43]], GENOU = [[0, 1], [0.3, 21], [0.64, 34], [0.74, 80], [0.9, 30]];
export function poseMarche(pose, e) {
  const A = Math.min(1, (e.vMarche ?? 0) / 2.4) * lisse(((e.vMarche ?? 0) - 0.05) / 0.6);
  if (A <= 0.001) return;
  const ph = e.phaseMarche ?? 0, phG = (ph + 0.5) % 1;
  const hD = cycle(HANCHE, ph), hG = cycle(HANCHE, phG);
  pose.jambeD[0] += A * hD; pose.jambeG[0] += A * hG;
  const c = Math.max(-1, Math.min(1, (hD - hG) / 85));   // les bras suivent les jambes a l'oppose (+-33 quand les hanches sont a +-42)
  pose.brasD[0] += -33 * A * c; pose.brasG[0] += 33 * A * c;
  if (pose.genouD !== undefined) { pose.genouD = Math.max(pose.genouD, A * cycle(GENOU, ph)); pose.genouG = Math.max(pose.genouG, A * cycle(GENOU, phG)); }
  if (pose.coudeD !== undefined) { pose.coudeD = Math.max(pose.coudeD, A * (30 - 10 * c)); pose.coudeG = Math.max(pose.coudeG, A * (30 + 10 * c)); }
}

// ---------------------------------------------------------------- parole (sous-titres avec `qui`)
// Celui qui parle : la tete accompagne les mots (petit hochement a chaque mot), l'avant-bras marque les mots en accent et le debut
// de la replique ("battement" : coude 25 -> 70, bras un peu en avant, 0,6 s) ; celui qui ecoute tourne la tete vers lui.
function jouerParole(pose, a, t, posDe, lacet) {
  for (const r of a.parole ?? []) {
    if (t < r.debut - 0.2 || t > r.fin + 0.4) continue;
    const dedans = lisse((t - r.debut + 0.2) / 0.25) * lisse((r.fin + 0.4 - t) / 0.3);
    for (const tm of r.mots) { const x = t - tm; if (x > -0.05 && x < 0.35) pose.tete[1] += 5 * dedans * Math.sin(Math.PI * (x + 0.05) / 0.4); }
    pose.tete[0] += SIGNE_TETE * 6 * dedans * Math.sin((2 * Math.PI * (t - r.debut)) / 1.7);
    const battements = r.accents.length ? [r.debut, ...r.accents] : [r.debut];
    for (const tb of battements) {
      const x = t - tb + 0.1;   // le geste part un peu avant le mot
      if (x < 0 || x > 0.7) continue;
      const e = lisse(x / 0.18) * lisse((0.7 - x) / 0.3);
      pose.brasD[0] += -24 * e; pose.brasD[1] = (pose.brasD[1] ?? 0) + 8 * e;
      if (pose.coudeD !== undefined) pose.coudeD = Math.min(150, pose.coudeD * (1 - e) + 70 * e);
      pose.tete[1] += 6 * e; pose.penche += 2.5 * e;
    }
  }
  if (!posDe) return;
  for (const r of a.ecoute ?? []) {
    if (t < r.debut || t > r.fin + 0.3) continue;
    const p = posDe(r.qui); if (!p) continue;
    const rel = normaliser180((Math.atan2(-(p[0] - pose.x), p[1] - pose.z) / RAD) - lacet);
    if (Math.abs(rel) > 120) continue;
    const e = lisse((t - r.debut) / 0.4) * lisse((r.fin + 0.3 - t) / 0.3);
    pose.tete[0] += SIGNE_TETE * 0.35 * Math.max(-50, Math.min(50, rel)) * e;   // en plus du regard de la vie au repos : il fixe celui qui parle
  }
}

// Graine stable d'un nom.
const graine = (nom) => { let h = 7; for (const c of nom) h = (h * 31 + c.codePointAt(0)) | 0; return Math.abs(h) % 1000; };

// Enveloppe d'un geste a l'instant t (0 hors geste) : montee 0,18 s, tenue, descente 0,25 s.
function enveloppe(g, t) {
  const x = t - g.t;
  if (x < 0 || x > g.duree) return 0;
  return lisse(x / 0.18) * lisse((g.duree - x) / 0.25);
}

// Ajoute la vie et les gestes a `pose` (modifiee en place). ctx : { t, a, vie (bool : la vie est jouee), posDe(nom) -> [x, z] ou null (avec posDe.noms), marche (bool : l'acteur se deplace ou saute), lacet,
//   la marche automatique est posee avant, par anim.js (poseMarche). }.
export function ajouterJeu(pose, { t, a, marche, posDe, lacet, vie }) {
  const J = a.jeu, I = J.intensite;
  const s = graine(a.nom);
  if (vie && !marche) {
    // respiration : cycle de 3,6 s ; le buste se penche, les bras suivent a contretemps
    const resp = Math.sin((2 * Math.PI * t) / 3.6 + s);
    pose.penche += 1.4 * I * resp + 1.0 * I * bruit(t * 0.22, s + 7);
    // le poids passe d'un pied sur l'autre (cycle lent de ~6 s) : les jambes s'ouvrent d'un cote puis de l'autre, le buste suit
    const poids = Math.sin((2 * Math.PI * t) / 6.2 + s * 0.7) * 0.7 + 0.3 * bruit(t * 0.18, s + 23);
    if (!jambesEcrites(a)) {   // jamais par-dessus des jambes ecrites par la scene (pistes ou boucles)
      pose.jambeD[1] = (pose.jambeD[1] ?? 0) + 2.5 * I * Math.max(0, poids); pose.jambeG[1] = (pose.jambeG[1] ?? 0) + 2.5 * I * Math.max(0, -poids);
      pose.jambeD[0] += 3 * I * poids; pose.jambeG[0] -= 3 * I * poids;
    }
    // bras : balancement de respiration ET changements lents d'appui (visibles sur un telephone : 4 a 6 degres)
    const bras = a.brasD || a.brasG ? 0.5 : 1;
    pose.brasD[0] += 4.5 * I * bras * Math.sin((2 * Math.PI * t) / 3.6 + s + 0.9) + 3.0 * I * bruit(t * 0.35, s + 3);
    pose.brasG[0] += 4.5 * I * bras * Math.sin((2 * Math.PI * t) / 3.6 + s + 1.3) + 3.0 * I * bruit(t * 0.35, s + 5);
    pose.brasD[1] = (pose.brasD[1] ?? 0) + 2.5 * I * bras * (0.5 + 0.5 * resp); pose.brasG[1] = (pose.brasG[1] ?? 0) + 2.5 * I * bras * (0.5 - 0.5 * resp);
    // la tete : bruit lent (regards, petits hochements) + un coup d'oeil de cote toutes les ~4 s
    const coup = Math.sin((2 * Math.PI * t) / 4.3 + s * 1.3);
    pose.tete[0] += SIGNE_TETE * (12 * I * bruit(t * 0.45, s + 11) + 7 * I * Math.sign(coup) * lisse((Math.abs(coup) - 0.85) / 0.15));
    pose.tete[1] += 6 * I * bruit(t * 0.55, s + 17) + 2 * I * resp;
    // le regard va vers l'autre personnage (le plus proche dans le champ), la tete tourne de 85 % de l'angle
    if (J.regard && posDe) {
      let meilleur = null;
      for (const nom of posDe.noms) {
        if (nom === a.nom) continue;
        const p = posDe(nom); if (!p) continue;
        const d = Math.hypot(p[0] - pose.x, p[1] - pose.z);
        if (d > 0.1 && d < 14 && (!meilleur || d < meilleur.d)) meilleur = { d, p };
      }
      if (meilleur) {
        const rel = normaliser180((Math.atan2(-(meilleur.p[0] - pose.x), meilleur.p[1] - pose.z) / RAD) - lacet);
        if (Math.abs(rel) < 110) pose.tete[0] += SIGNE_TETE * 0.85 * Math.max(-50, Math.min(50, rel)) * lisse(1 - (Math.abs(rel) - 60) / 50);
      }
    }
  }
  if (a.parole || a.ecoute) jouerParole(pose, a, t, J.regard ? posDe : null, lacet);
  for (const g of a.gestes ?? []) {
    const e = enveloppe(g, t) * g.force;
    if (e <= 0) continue;
    const x = t - g.t, bras = g.bras === 'G' ? 'brasG' : 'brasD', coude = g.bras === 'G' ? 'coudeG' : 'coudeD';
    const vers = (() => {
      if (!g.vers || !posDe) return 0;
      const p = posDe(g.vers); if (!p) return 0;
      return Math.max(-70, Math.min(70, normaliser180((Math.atan2(-(p[0] - pose.x), p[1] - pose.z) / RAD) - lacet)));
    })();
    const vise = (f = 1) => { pose.tete[0] += SIGNE_TETE * vers * f * e; };
    const melange = (cible, plus = 0) => { pose[bras][0] += (cible - pose[bras][0]) * Math.min(1, e) + plus; };
    switch (g.nom) {
      case 'hocher': pose.tete[1] += 16 * e * Math.sin((2 * Math.PI * x) / (g.duree / 2)) ; pose.penche += 1.5 * e * Math.sin((2 * Math.PI * x) / (g.duree / 2)); break;
      case 'nier': pose.tete[0] += SIGNE_TETE * 20 * e * Math.sin((2 * Math.PI * x) / (g.duree / 2)); break;
      case 'pointer': melange(-88); pose[coude] = Math.min(150, Math.max(0, (pose[coude] ?? 0) * (1 - e) + 4 * e)); vise(0.9); pose.penche += 2 * e; break;
      case 'montrer': melange(-72); pose[coude] = Math.min(150, (pose[coude] ?? 0) * (1 - e) + 58 * e); vise(0.5); pose.tete[1] += 8 * e; pose.penche += 3 * e; break;
      case 'lever': melange(-155); pose[coude] = Math.min(150, (pose[coude] ?? 0) * (1 - e) + 12 * e); pose.tete[1] -= 6 * e; break;
      case 'saluer': melange(-150, 0); pose[coude] = Math.min(150, (pose[coude] ?? 0) * (1 - e) + 30 * e); pose[bras][1] = (pose[bras][1] ?? 0) + 22 * e * Math.sin(2 * Math.PI * 2.6 * x); break;
      case 'regarder': vise(1); break;
      case 'recul': pose.penche -= 9 * e; pose.tete[1] -= 7 * e; vise(0.3); break;
      default: break;
    }
  }
}

// Y a-t-il des gestes qui plient le coude (il faut alors les articulations dans la pose) ?
export const gesteAvecCoude = (a) => (a.gestes ?? []).some((g) => ['pointer', 'montrer', 'lever', 'saluer'].includes(g.nom)) || !!a.parole?.length;
