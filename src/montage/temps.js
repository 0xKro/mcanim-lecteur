// Temps du monde : un plan peut ralentir, accelerer (`vitesse`) ou arreter (`arret`) le temps du MONDE pendant qu'il est a l'ecran.
// Les acteurs, les boucles et la physique lisent le "temps d'action" tw(t) au lieu du temps du film t ; la camera, l'image, le ciel
// et les incrustations restent au temps du film. Sans vitesse ni arret : aucune carte (null), le calcul d'avant tel quel.
import { evaluer } from '../film/scene.js';

const DT = 1 / 30;

// scene : scene validee (plans). Retourne null ou { tw: Float64Array(images + 1), filmDe(w), duree }.
export function carteTemps(scene) {
  if (!scene.plans?.some((p) => p.vitesse || p.arret)) return null;
  const n = scene.images, tw = new Float64Array(n + 1);
  let w = 0;
  for (let i = 0; i < n; i++) {
    tw[i] = Math.min(w, scene.duree);
    const t = i * DT;
    const p = scene.plans.find((q) => i >= q.i0 && i < q.i1);
    let v = 1;
    if (p) {
      const tl = t - p.de;
      if (p.arret?.some(([a, b]) => tl >= a && tl < b)) v = 0;
      else if (p.vitesse) v = evaluer(p.vitesse, tl)[0];
    }
    w += v * DT;
  }
  tw[n] = Math.min(w, scene.duree);
  // instant du film ou le temps d'action vaut `x` (premier t tel que tw(t) >= x), interpole ; au-dela : fin du film + 1 s
  const filmDe = (x) => {
    if (x <= tw[0]) return 0;
    if (x > tw[n]) return scene.duree + 1;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tw[m] >= x) hi = m; else lo = m; }
    const a = tw[lo], b = tw[hi];
    return (lo + (b > a ? (x - a) / (b - a) : 0)) * DT;
  };
  return { tw, filmDe, duree: scene.duree };
}
