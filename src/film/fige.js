// Acteur fige seul (champ `fige` de l'acteur) : pendant ses intervalles [debut, fin] l'acteur ne vit plus : son temps propre s'arrete, les
// autres continuent. Sa pose reste exactement celle de `debut` (boucles et jambes a mi-foulee, position, physique, pas, corps, tete).
// A la fin de l'intervalle il reprend OU IL S'ETAIT ARRETE : tout son temps (pos, pistes, boucles) est decale de la duree figee.
// `figeSauf` : noms de pistes qui ignorent ce gel et se jouent en temps reel (ex. ["tete"] : les figes tournent la tete).
// Different du `gel` de la scene : le gel arrete le monde entier mais laisse jouer les pistes ecrites ; `fige` arrete une personne
// entiere, pistes ecrites comprises, sauf celles de `figeSauf`.
import { horlogeMonde } from './anim.js';

// Fusionne deux listes d'intervalles triees en une liste triee sans chevauchement.
export function fusionner(a, b) {
  const tous = [...a, ...b].map((x) => [x[0], x[1]]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const sortie = [];
  for (const g of tous) {
    const d = sortie[sortie.length - 1];
    if (d && g[0] <= d[1]) d[1] = Math.max(d[1], g[1]); else sortie.push(g);
  }
  return sortie;
}

// Retourne null si l'acteur n'a pas de `fige`. Sinon :
//   F, U : horloges (voir horlogeMonde) du fige seul, et du fige + gel de la scene ; sauf : Set des pistes qui ignorent le fige ;
//   propre(t) : temps propre de l'acteur (pistes ecrites, pos) = t moins les secondes figees avant t ;
//   reel(s) : instant du film ou le temps propre atteint s ; boucles : copies des boucles decalees (de, a en temps du film) ;
//   simGel, simTemps : gel et decalage de pos a donner a la simulation physique (physique.js).
export function creerFige(a, gel = []) {
  if (!a.fige?.length) return null;
  const sauf = new Set(a.figeSauf ?? []);
  const F = horlogeMonde(a.fige);
  const reel = (s) => { let t = s; for (const [d, f] of a.fige) if (t > d) t += f - d; return t; };
  const U = horlogeMonde(fusionner(gel, a.fige));
  const marche = sauf.has('pos');            // pos en temps reel : l'acteur avance malgre le fige (rare)
  return {
    F, U, sauf, reel, propre: (t) => F.monde(t),
    boucles: a.boucles.map((b) => ({ ...b, de: reel(b.de), a: reel(b.a) })),
    simGel: marche ? gel : fusionner(gel, a.fige),
    simTemps: marche ? null : (x) => F.monde(x),
  };
}
