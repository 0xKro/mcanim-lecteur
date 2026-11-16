// Pas automatiques cales sur les PIEDS : on regarde le modele anime, image par image, et on trouve l'instant ou chaque pied touche le sol.
// (Les fiches marcher/courir posent les pieds : la cadence suit la `periode` de la boucle, plus la distance parcourue.)
//
// Hauteur d'un pied = le plus bas de ses 4 coins de semelle au-dessus du sol (modele.js, coinsPieds : meme repere que l'appui).
// Un pas = le pied DESCEND sous le seuil bas apres avoir ete au-dessus du seuil haut depuis le pas precedent (hysteresis : un pied qui
// reste pose, ou qui tremble un peu sur le sol, ne sonne jamais), et ensuite il RECULE par rapport au corps (vitesse avant de l'image
// suivante au plus VITESSE_APRES_MAX : un pied pose glisse vers l'arriere du corps ; une jambe raide qui balance passe par le sol DEUX
// fois par periode, une seule fois en reculant = le pied qui se pose). Ecart minimal entre deux pas du meme pied : INTERVALLE_MIN.
// Seuils : SEUIL_BAS (2 cm) et SEUIL_HAUT (6 cm), reduits pour un balancement de petite amplitude (jambes raides a 30 degres : le pied
// ne monte que de 3 cm) ; si le pied ne monte jamais de plus de AMPLITUDE_MIN, il ne marche pas : aucun pas.
// Marche lente (1 a 2,4 blocs/s) : le pied rase le sol en balancant vers l'avant ; le pas est alors date a l'arret de ce glissement.
// Rien quand le monde est gele ni quand l'acteur n'est pas au sol. Deterministe : que des nombres tires des images, aucun hasard.
import { coinsPieds } from '../perso/modele.js';

export const SEUIL_BAS = 0.02;          // blocs : sous cette hauteur (au dessus du plus bas du film), le pied est pose
export const SEUIL_HAUT = 0.06;         // blocs : le pied doit d'abord monter au-dessus pour pouvoir se reposer
export const AMPLITUDE_MIN = 0.015;     // blocs : amplitude de hauteur des pieds en dessous de laquelle il n'y a pas de pas
export const VITESSE_APRES_MAX = 0.3;   // blocs/s : vitesse avant maximale du pied (par rapport au corps) juste apres le contact
export const INTERVALLE_MIN = 0.15;     // s entre deux pas du meme pied
export const ATTENTE_MAX = 8;           // images : delai maximal entre la descente du pied sous le seuil bas et l'arret de son glissement
const DT = 1 / 30;
const SOL_PLAT = Math.min(...coinsPieds({}).map((c) => c.haut));
const BOUGE_MIN = 1;                    // degres : en dessous, une jambe est consideree comme immobile
const PIEDS = ['D', 'G'];

// Les DEUX jambes de l'acteur k bougent-elles dans le film ? (sinon : regle de la distance. Une seule jambe animee n'est pas une marche.)
export function jambesAnimees(images, k) {
  const bouge = (suite) => Math.max(...suite) - Math.min(...suite) > BOUGE_MIN;
  const jambe = (nom, genou) => {
    const j = images.map((im) => im.acteurs[k][nom]);
    return bouge(j.map((x) => x[0])) || bouge(j.map((x) => x[1])) || bouge(images.map((im) => im.acteurs[k][genou] ?? 0));
  };
  return jambe('jambeD', 'genouD') && jambe('jambeG', 'genouG');
}

// Hauteur (blocs, au-dessus du sol de l'acteur) et position avant (blocs, repere du corps) de chaque pied dans une pose.
function pieds(p) {
  const cs = coinsPieds(p), r = {};
  const base = (p.y - p.sol) + (p.dy ?? 0) - SOL_PLAT;
  for (const c of cs) {
    const h = base + c.haut;
    const q = (r[c.pied] ??= { h: Infinity, avant: 0 });
    if (h < q.h) q.h = h;
    q.avant += c.avant / 4;
  }
  return r;
}

// Instants de pas de l'acteur k : [{ t, pied: 'D'|'G', x, z (pied), ax, az (corps), sol, y }] tries par temps. `images` : sortie de animer().
export function instantsDePas(images, k) {
  const n = images.length;
  const P = images.map((im) => pieds(im.acteurs[k]));
  const libre = images.map((im) => im.acteurs[k].auSol && !im.fige && !im.acteurs[k].figee && !im.acteurs[k].eau && Math.abs(im.acteurs[k].bascule ?? 0) < 30);   // au sol et monde non gele
  // seuils : mesures sur les images utilisables
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) if (libre[i]) for (const f of PIEDS) { lo = Math.min(lo, P[i][f].h); hi = Math.max(hi, P[i][f].h); }
  const amp = hi - lo;
  if (!(amp >= AMPLITUDE_MIN)) return [];
  const bas = lo + Math.min(SEUIL_BAS, 0.2 * amp), haut = lo + Math.min(SEUIL_HAUT, 0.45 * amp);

  const sortie = [];
  // attente : le pied vient de descendre sous le seuil bas mais glisse encore vers l'avant (marche lente : le pied rase le sol avant de se poser) ;
  // le pas sonne quand il cesse d'avancer par rapport au corps, tant qu'il reste sous le seuil haut et au plus ATTENTE_MAX images.
  const etat = { D: { arme: false, dernier: -Infinity, attente: null }, G: { arme: false, dernier: -Infinity, attente: null } };
  for (let i = 0; i < n; i++) {
    if (!libre[i]) { for (const f of PIEDS) { etat[f].arme = false; etat[f].attente = null; } continue; }   // en l'air ou monde gele : on repart de zero
    if (i === 0 || !libre[i - 1]) continue;
    const p = images[i].acteurs[k], pp = images[i - 1].acteurs[k];
    for (const f of PIEDS) {
      const e = etat[f], h0 = P[i - 1][f].h, h1 = P[i][f].h;
      if (h1 > haut) { e.arme = true; e.attente = null; }
      if (e.arme && !e.attente && h0 > bas && h1 <= bas) {
        const u = h0 === h1 ? 1 : Math.min(1, Math.max(0, (h0 - bas) / (h0 - h1)));
        e.attente = { i, u };
      }
      if (!e.attente) continue;
      if (i - e.attente.i > ATTENTE_MAX) { e.attente = null; continue; }
      // vitesse avant juste apres le contact (image suivante ; a la derniere image : celle d'avant)
      const vAvant = i + 1 < n ? (P[i + 1][f].avant - P[i][f].avant) / DT : (P[i][f].avant - P[i - 1][f].avant) / DT;
      if (vAvant > VITESSE_APRES_MAX) continue;
      const u = i === e.attente.i ? e.attente.u : 1;
      const t = images[i - 1].t + DT * u;
      e.attente = null;
      if (t - e.dernier < INTERVALLE_MIN) continue;
      const psi = (p.lacet * Math.PI) / 180, av = P[i - 1][f].avant + (P[i][f].avant - P[i - 1][f].avant) * u;
      const x = pp.x + (p.x - pp.x) * u, z = pp.z + (p.z - pp.z) * u;
      sortie.push({ t, pied: f, x: x - Math.sin(psi) * av, z: z + Math.cos(psi) * av, ax: x, az: z, sol: p.sol, y: p.y });
      e.dernier = t; e.arme = false;
    }
  }
  return sortie.sort((a, b) => a.t - b.t);
}
