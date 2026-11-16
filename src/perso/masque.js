// Masque de couleur selective : un PNG 64x64 qui a la meme disposition que le skin.
// Force d'exemption d'un texel (0..255) = luminosite du pixel (le plus grand de R, G, B) x alpha. Noir ou transparent = 0.
import fs from 'node:fs';
import path from 'node:path';
import { decoderPNG } from '../rendu/png.js';

// rgba : Uint8Array l*h*4. Retourne { largeur: 64, hauteur: 64, valeurs: Uint8Array(4096), nonNuls }.
export function masqueDepuisRgba(rgba, l, h) {
  if (l !== 64 || h !== 64) throw new Error(`le masque doit faire 64x64 (meme disposition que le skin), pas ${l}x${h}`);
  const valeurs = new Uint8Array(64 * 64);
  let nonNuls = 0;
  for (let i = 0; i < valeurs.length; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
    const v = Math.round(Math.max(r, g, b) * a / 255);
    valeurs[i] = v;
    if (v) nonNuls++;
  }
  return { largeur: 64, hauteur: 64, valeurs, nonNuls };
}

// Lit le fichier (chemin relatif au dossier de la scene).
export function lireMasque(fichier, baseDir = process.cwd()) {
  const f = path.resolve(baseDir, fichier);
  if (!fs.existsSync(f)) throw new Error(`fichier de masque introuvable : ${fichier}`);
  let im;
  try { im = decoderPNG(fs.readFileSync(f)); } catch (e) { throw new Error(`masque ${fichier} : PNG illisible (${e.message})`); }
  try { return masqueDepuisRgba(im.rgba, im.largeur, im.hauteur); } catch (e) { throw new Error(`masque ${fichier} : ${e.message}`); }
}
