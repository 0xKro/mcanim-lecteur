// Etiquette de nom au-dessus d'un acteur (champ `etiquette`) : comme EntityRenderer.renderNameTag du jeu, un panneau tourne vers la
// camera a la hauteur de la boite + 0,5 bloc, texte blanc de la police du jeu (kit, groupe `interface`) sur un fond noir a 25 %,
// 0,025 bloc par pixel de police. Maillage `melange` (le fond laisse voir derriere).
import { chargerPolice } from '../incrust/police.js';
import { rendreTexte, segmentsDeTexte } from '../incrust/texte.js';

const cache = new Map();
export async function preparerEtiquettes(scene, kit) {
  const textes = scene.acteurs.filter((a) => a.etiquette).map((a) => a.etiquette);
  if (!textes.length) return null;
  const police = await chargerPolice(kit);
  const images = new Map();
  for (const t of textes) {
    if (images.has(t)) continue;
    const r = rendreTexte(police, segmentsDeTexte(t), { S: 1, fond: [0, 0, 0, 64], marge: 1 });
    images.set(t, { largeur: r.img.w, hauteur: r.img.h, rgba: r.img.px });
  }
  return { images };
}

// pos : pieds de l'acteur ; haut : hauteur de sa boite ; camera : { x, y, z } de l'image
export function maillageEtiquette(prep, texte, pos, haut, camera) {
  const tex = prep?.images.get(texte);
  if (!tex || !camera) return null;
  const k = 0.025, L = tex.largeur * k, H = tex.hauteur * k;
  const cx = pos.x, cy = pos.y + haut + 0.5 + H / 2, cz = pos.z;
  let dx = camera.x - cx, dz = camera.z - cz;
  const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
  const rx = dz, rz = -dx;   // droite du panneau vu de la camera
  const coins = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
  const positions = new Float32Array(12), uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), couleurs = new Float32Array(12).fill(1);
  coins.forEach(([u, v], i) => { positions[i * 3] = cx + rx * u * L / 2; positions[i * 3 + 1] = cy + v * H / 2; positions[i * 3 + 2] = cz + rz * u * L / 2; });
  void cache;
  return { positions, uvs, couleurs, indices: new Uint32Array([0, 1, 2, 0, 2, 3]), texture: tex, mode: 'melange', deuxFaces: true, genre: 'creature', entite: 'minecraft:text_display' };
}
