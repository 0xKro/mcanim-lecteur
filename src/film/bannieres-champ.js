// Champ de scene `bannieres` (motifs des bannieres : un .mcz ne garde pas les donnees des blocs) ; lu par film/scene.js, dessine par film/bannieres.js.
import { TEINTURES } from '../creatures/especes.js';

// noms des motifs (registre banner_pattern du jeu 26.3 : textures entity/banner/<motif>.png)
export const MOTIFS = ['base', 'border', 'bricks', 'circle', 'creeper', 'cross', 'curly_border', 'diagonal_left', 'diagonal_right', 'diagonal_up_left', 'diagonal_up_right', 'flow', 'flower', 'globe', 'gradient', 'gradient_up', 'guster', 'half_horizontal', 'half_horizontal_bottom', 'half_vertical', 'half_vertical_right', 'mojang', 'piglin', 'rhombus', 'skull', 'small_stripes', 'square_bottom_left', 'square_bottom_right', 'square_top_left', 'square_top_right', 'straight_cross', 'stripe_bottom', 'stripe_center', 'stripe_downleft', 'stripe_downright', 'stripe_left', 'stripe_middle', 'stripe_right', 'stripe_top', 'triangle_bottom', 'triangle_top', 'triangles_bottom', 'triangles_top'];

// Champ de scene `bannieres` : [[x, y, z, [["motif", "couleur"], ...]]] (16 motifs au plus). Rend la liste lue ; `err(chemin, message)`.
export function lireBannieres(v, err) {
  if (!Array.isArray(v)) err('bannieres', 'liste [[x, y, z, [["motif", "couleur"], ...]], ...] attendue');
  return v.map((b, i) => {
    const ch = `bannieres[${i}]`;
    if (!Array.isArray(b) || b.length !== 4 || !b.slice(0, 3).every(Number.isInteger) || !Array.isArray(b[3])) err(ch, '[x, y, z, [["motif", "couleur"], ...]] attendu (coordonnees entieres du bloc de banniere)');
    if (b[3].length > 16) err(`${ch}[3]`, '16 motifs au plus (comme le jeu)');
    b[3].forEach((m, j) => {
      if (!Array.isArray(m) || m.length !== 2 || !MOTIFS.includes(m[0]) || m[0] === 'base') err(`${ch}[3][${j}]`, `["motif", "couleur"] attendu ; motifs : ${MOTIFS.filter((x) => x !== 'base').join(', ')}`);
      if (!TEINTURES.includes(m[1])) err(`${ch}[3][${j}][1]`, `couleur parmi ${TEINTURES.join(', ')}`);
    });
    return [b[0], b[1], b[2], b[3].map((m) => [m[0], m[1]])];
  });
}

