// Obstacles des incrustations : les boites ecran des TETES et des TORSES des acteurs (memes boites que les legendes, montage/evitement.js).
// La decision est prise UNE FOIS PAR PLAN : on projette les acteurs sur 9 images du plan et on garde, par acteur et par partie, le rectangle qui les contient toutes.
// Une incrustation ne saute donc pas d'une image a l'autre quand l'acteur bouge un peu ; a la coupe, le calcul est refait.
import { boitesActeurs } from '../montage/evitement.js';

const SONDES = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
const GONFLE = 0.1;   // chaque boite est agrandie de 10 % de sa taille (tete tournee, bras, ombre de la perspective)

function unir(liste) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of liste) { if (r.x0 < x0) x0 = r.x0; if (r.y0 < y0) y0 = r.y0; if (r.x1 > x1) x1 = r.x1; if (r.y1 > y1) y1 = r.y1; }
  const w = x1 - x0, h = y1 - y0;
  return { x: x0 - w * GONFLE, y: y0 - h * GONFLE, w: w * (1 + 2 * GONFLE), h: h * (1 + 2 * GONFLE) };
}

// Retourne { tetes: [{ nom, x, y, w, h }], torses: [...] } (pixels de l'image) ; listes vides s'il n'y a pas d'acteur visible.
// ctx : { scene, im, images, W, H, t, cacheEvite, carteImage }
export function obstaclesActeurs(ctx) {
  const plan = ctx.carteImage ? null : ctx.scene.plans?.find((p) => ctx.t >= p.de && ctx.t < p.a);
  const cle = plan && ctx.images ? `act|p${plan.de}|${ctx.W}x${ctx.H}` : null;
  if (cle && ctx.cacheEvite?.has(cle)) return ctx.cacheEvite.get(cle);
  let images = [ctx.im];
  if (plan && ctx.images && plan.i0 !== undefined) {
    const n = Math.max(1, plan.i1 - plan.i0);
    images = SONDES.map((f) => ctx.images[Math.min(ctx.images.length - 1, plan.i0 + Math.floor(f * (n - 1)))]).filter(Boolean);
  }
  const parNom = new Map();   // nom -> { tete: [rect], torse: [rect] }
  for (const im of images) for (const b of boitesActeurs(im, ctx.W, ctx.H)) {
    const e = parNom.get(b.nom) ?? { tete: [], torse: [] };
    for (const p of b.parties) if (e[p.nom]) e[p.nom].push(p.r);
    parNom.set(b.nom, e);
  }
  const res = { tetes: [], torses: [] };
  // figurant au loin : une tete minuscule (moins de 4 % de la hauteur ET moins de 40 % de la plus grosse tete du plan) n'est pas un obstacle
  // (test combat v3 : la petite Kira au fond poussait le compteur et l'icone sur le torse de Steve, au premier plan)
  const hauteur = (e) => Math.max(0, ...e.tete.map((r) => r.y1 - r.y0));
  const plusGrosse = Math.max(0, ...[...parNom.values()].map(hauteur));
  for (const [nom, e] of parNom) {
    if (parNom.size > 1 && hauteur(e) < 0.04 * ctx.H && hauteur(e) < 0.4 * plusGrosse) continue;
    if (e.tete.length) res.tetes.push({ nom, ...unir(e.tete) });
    if (e.torse.length) res.torses.push({ nom, ...unir(e.torse) });
  }
  if (cle) ctx.cacheEvite.set(cle, res);
  return res;
}
