// Banc d'essai des incrustations SANS rendu du monde : on pose textes et incrustations sur un fond uni, a des instants donnes, et on lit les pixels.
// Sert aux tests (le mouvement et la zone sure ne doivent jamais revenir en arriere) et a la feuille de preuves (outils/montage-preuves.mjs).
import { validerScene } from '../film/scene.js';
import { creerIncrustations } from '../incrust/index.js';

export const FOND = [96, 104, 120];

// Scene minimale : un acteur devant la camera (a 10 blocs), camera a l'origine regardant +z. `plus` : champs de la scene (textes, sousTitres, incrustations, zonesSures...).
export function sceneEssai(plus = {}, { format = '1080x1920', duree = 6 } = {}) {
  return validerScene({ v: 1, format, duree, zone: 'A'.repeat(22), acteurs: [{ nom: 'a', pos: [[0, 0, -1.5, 10], [duree, 0, -1.5, 10]] }], camera: { pos: [[0, 0, 0, 0]], cible: [[0, 0, 0, 10]] }, ...plus });
}

export const imageEssai = (t, acteurs = [{ x: 0, y: -1.5, z: 10 }]) => ({ t, camera: { x: 0, y: 0, z: 0, lacet: 0, tangage: 0, fov: 60 }, acteurs });

// Rend les instants `ts` : retourne { W, H, images: [Uint8Array RGBA], notes }.
// acteurs : positions [{x, y, z}] des acteurs de la scene (defaut : un acteur a 10 blocs devant la camera).
export async function rendreInstants({ scene, kit, ts, fond = FOND, acteurs = undefined }) {
  const inc = await creerIncrustations({ scene, kit });
  const W = scene.largeur, H = scene.hauteur, images = [];
  for (const t of ts) {
    const rgba = new Uint8Array(W * H * 4);
    for (let i = 0; i < rgba.length; i += 4) { rgba[i] = fond[0]; rgba[i + 1] = fond[1]; rgba[i + 2] = fond[2]; rgba[i + 3] = 255; }
    inc.dessiner(rgba, W, H, { t, im: imageEssai(t, acteurs) });
    images.push(rgba);
  }
  return { W, H, images, notes: inc.notes() };
}

// Boite des pixels qui different du fond : { x0, y0, x1, y1, n } (x1, y1 exclus) ou null si rien n'est dessine.
export function boiteDessinee(rgba, W, H, fond = FOND, seuil = 6) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    if (Math.abs(rgba[o] - fond[0]) + Math.abs(rgba[o + 1] - fond[1]) + Math.abs(rgba[o + 2] - fond[2]) > seuil) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return n ? { x0, y0, x1: x1 + 1, y1: y1 + 1, n } : null;
}

// Somme des differences entre deux images (mesure du mouvement d'une image a l'autre).
export function difference(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return s;
}
