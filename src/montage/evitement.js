// Place des legendes : une legende ne doit pas couvrir un visage ni un torse. On projette les boites des acteurs a l'ecran (visage, torse, jambes),
// on essaie quelques hauteurs dans la zone sure (celle des references d'abord : 64 % de l'image, puis plus bas, puis plus haut) et on garde la moins genante.
// Le choix est fait UNE FOIS PAR PLAN (3 images echantillonnees) : la legende ne saute pas d'une puce a l'autre.
import { creerProjecteur, transformRoulis } from '../incrust/ancrage.js';

// Hauteurs essayees (part de la hauteur de l'image, centre de la legende) ; la premiere est la position des references.
export const CANDIDATS = [0.64, 0.68, 0.72, 0.6, 0.56, 0.5, 0.3, 0.24, 0.18];
const PARTIES = [   // [nom, y bas, y haut (blocs au-dessus des pieds), demi-largeur, poids]
  ['tete', 1.35, 2.05, 0.34, 4], ['torse', 0.7, 1.4, 0.5, 1.6], ['jambes', 0, 0.75, 0.3, 0.4],
];

// Rectangle ecran d'une boite verticale autour de (x, z) ; null si un coin est derriere la camera.
function rect(proj, p, y0, y1, dm) {
  let x0 = Infinity, y0e = Infinity, x1 = -Infinity, y1e = -Infinity;
  for (const dx of [-dm, dm]) for (const dz of [-dm, dm]) for (const y of [y0, y1]) {
    const q = proj.projeter([p.x + dx, p.y + y, p.z + dz]);
    if (!q) return null;
    if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < y0e) y0e = q.y; if (q.y > y1e) y1e = q.y;
  }
  return { x0, y0: y0e, x1, y1: y1e };
}

// Boites ecran des acteurs d'une image : [{ nom, parties: [{ nom, r: {x0,y0,x1,y1}, poids }] }]
export function boitesActeurs(im, W, H) {
  const proj = creerProjecteur(im.camera, W, H, im.roulis ? transformRoulis(im.roulis, W, H) : null);
  const sortie = [];
  for (const p of im.acteurs) {
    if (p.horsImage) continue;
    const parties = [];
    for (const [nom, a, b, dm, poids] of PARTIES) { const r = rect(proj, p, a, b, dm); if (r) parties.push({ nom, r, poids }); }
    if (parties.length) sortie.push({ nom: p.nom, parties });
  }
  return sortie;
}

const aire = (a, b) => { const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0); return w > 0 && h > 0 ? w * h : 0; };

// Cout d'une legende (rectangle r) : part couverte de la legende par les parties des acteurs, ponderee (le visage compte le plus).
export function coutLegende(boites, r) {
  const A = (r.x1 - r.x0) * (r.y1 - r.y0) || 1;
  let c = 0;
  for (const b of boites) for (const p of b.parties) c += (aire(r, p.r) / A) * p.poids;
  return c;
}

// Hauteur (part de H) du centre de la legende pour un plan : { y, cout, deplacee }.
//   images : images de l'animation ; i0, i1 : images du plan ; zone : zone sure { x0, y0, x1, y1 } ; larg, haut : taille de la legende en pixels.
//   interdits : bandes [y0, y1] (pixels) gardees par les titres d'ecran du plan : une hauteur qui les touche coute tres cher (un titre et une
//   legende colles se lisent comme un texte en double, test combat v3).
export function choisirHauteur({ images, i0, i1, W, H, zone, larg, haut, xc = W / 2, interdits = [] }) {
  const n = Math.max(1, i1 - i0);
  const echantillons = [0.2, 0.5, 0.8].map((f) => images[Math.min(images.length - 1, i0 + Math.floor(f * (n - 1)))]).map((im) => boitesActeurs(im, W, H));
  const bas = (zone.y1 - haut / 2) / H, hautMax = (zone.y0 + haut / 2) / H;
  const vus = new Set(); let meilleur = null;
  for (const c0 of CANDIDATS) {
    const y = Math.min(bas, Math.max(hautMax, c0)), cle = Math.round(y * 200);
    if (vus.has(cle)) continue; vus.add(cle);
    const r = { x0: xc - larg / 2, x1: xc + larg / 2, y0: y * H - haut / 2, y1: y * H + haut / 2 };
    const titre = interdits.some(([a, b]) => r.y0 < b && r.y1 > a) ? 5 : 0;
    const cout = Math.max(...echantillons.map((b) => coutLegende(b, r))) + (y < 0.6 ? 0.12 : 0) + Math.abs(y - CANDIDATS[0]) * 0.4 + titre;   // on prefere rester pres de la position de reference, et en dessous
    if (!meilleur || cout < meilleur.cout - 1e-9) meilleur = { y, cout };
  }
  if (meilleur.cout >= 5) meilleur.cout -= 5;   // aucune place hors des titres : la note de cout parle des acteurs seulement
  return { ...meilleur, deplacee: Math.abs(meilleur.y - Math.min(bas, Math.max(hautMax, CANDIDATS[0]))) > 0.01 };
}
