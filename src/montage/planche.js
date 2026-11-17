// Planche de contact GRATUITE : N images de la scene (ou une par plan) en basse resolution, dans UNE image filigranee.
// Pour revoir un montage rapide d'un seul coup d'oeil sans payer de rendu. Les incrustations, effets et transitions sont inclus.
import fs from 'node:fs';
import path from 'node:path';
import { encoderPNG } from '../rendu/png.js';
import { filigrane } from '../film/apercu.js';
import { chargerPolice } from '../incrust/police.js';
import { segmentsDeTexte, rendreTexte } from '../incrust/texte.js';
import { poserImage } from '../incrust/toile.js';
import { dessinerMasques } from './zones.js';

// Instants des images : un par plan (au 40 % du plan) s'il y a des plans, sinon `n` instants regulierement espaces. Triés.
export function instantsPlanche(scene, n) {
  if (scene.plans?.length && n === undefined) {
    return scene.plans.slice(0, 48).map((p) => p.de + 0.4 * (p.a - p.de));
  }
  const m = Math.max(1, Math.min(48, n ?? 12));
  return Array.from({ length: m }, (_, k) => Math.min(scene.duree - 1 / 30, ((k + 0.5) * scene.duree) / m));
}

// Dimension de la grille : { cols, tw, th }.
// La planche tient dans largeurMax x largeurMax : on prend le moins de colonnes (donc les plus grandes vignettes) qui y entre.
export function grillePlanche(n, largeurScene, hauteurScene, largeurMax = 1800) {
  let meilleur = null;
  for (let cols = 1; cols <= n; cols++) {
    const tw = Math.max(96, Math.floor(largeurMax / cols) - 4), th = Math.round((tw * hauteurScene) / largeurScene);
    meilleur = { cols, tw, th };
    if (Math.ceil(n / cols) * (th + 4) + 4 <= largeurMax) break;
  }
  return meilleur;
}

// film : retour de preparerFilm (dessiner, anim, kit). Retourne { sortie, n, instants }.
// zones : dessine sur chaque vignette les silhouettes de l'interface des applications (voir zones.js).
export async function ecrirePlanche({ film, scene, sortie, n, largeurMax = 1800, zones = false }) {
  const instants = instantsPlanche(scene, n);
  const { cols, tw, th } = grillePlanche(instants.length, scene.largeur, scene.hauteur, largeurMax);
  const rangs = Math.ceil(instants.length / cols), pad = 4;
  const W = cols * (tw + pad) + pad, H = rangs * (th + pad) + pad;
  const feuille = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { feuille[i * 4] = 24; feuille[i * 4 + 1] = 24; feuille[i * 4 + 2] = 28; feuille[i * 4 + 3] = 255; }
  const police = await chargerPolice(film.kit);
  const idxPlan = (t) => (scene.plans ? scene.plans.findIndex((p) => t >= p.de && t < p.a) : -1);
  for (let k = 0; k < instants.length; k++) {
    const i = Math.min(film.anim.images.length - 1, Math.round(instants[k] * 30));
    const rgba = await film.dessiner(i, { largeur: tw, hauteur: th, copie: true });
    if (zones) dessinerMasques(rgba, tw, th, null);
    const cx = pad + (k % cols) * (tw + pad), cy = pad + Math.floor(k / cols) * (th + pad);
    for (let y = 0; y < th; y++) feuille.set(rgba.subarray(y * tw * 4, (y + 1) * tw * 4), ((cy + y) * W + cx) * 4);
    const p = idxPlan(instants[k]);
    const etiquette = (p >= 0 ? `plan ${p + 1}  ` : `#${k + 1}  `) + `${instants[k].toFixed(1)} s`;
    const S = Math.max(1, Math.round(tw / 120));
    const r = rendreTexte(police, segmentsDeTexte(etiquette, { couleur: [255, 255, 85] }), { S, contour: { couleur: [0, 0, 0, 255], ep: S }, alignement: 'gauche' });
    poserImage(feuille, W, H, r.img, cx + 2, cy + 2, r.img.w, r.img.h);
  }
  filigrane(feuille, W, H);
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  fs.writeFileSync(sortie, encoderPNG({ largeur: W, hauteur: H, rgba: feuille }));
  return { sortie, n: instants.length, instants, taille: [W, H] };
}
