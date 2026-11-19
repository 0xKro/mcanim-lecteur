// Image d'apercu (mcanim apercu) : sans jeton, avec un filigrane en diagonale pour qu'elle ne remplace pas un vrai rendu.
// 640x360 par defaut ; jusqu'a 1920 de large (avant : 640) pour juger un detail ; le fichier reste petit : JPEG au-dela de 640 de large
// (rendu/jpeg.js, quelques centaines de Ko en 1920x1080), PNG compresse au maximum sinon (ou si la sortie finit par .png).

export const APERCU_LARGEUR_MAX = 1920;
export const APERCU_HAUTEUR_MAX = 1920;     // vertical 1080x1920 permis, jamais plus grand
export const APERCU_LARGEUR_PNG = 640;      // au-dela, la sortie par defaut est un JPEG (apercu.jpg)

// Format du fichier d'apercu : 'jpeg' (.jpg / .jpeg), 'png' (.png) ; sans extension connue : PNG jusqu'a 640 de large, JPEG au-dela.
export function formatApercu(sortie, largeur) {
  if (/\.jpe?g$/i.test(sortie ?? '')) return 'jpeg';
  if (/\.png$/i.test(sortie ?? '')) return 'png';
  return largeur > APERCU_LARGEUR_PNG ? 'jpeg' : 'png';
}

// Police 5x7 des seules lettres utiles (le mot "APERCU", sans accent : 5 colonnes, 7 lignes).
const LETTRES = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
};
const MOT = 'APERCU';

// Bitmap du mot : Uint8Array 35 x 7 (1 = encre)
function bitmapMot() {
  const L = MOT.length * 6 - 1, bits = new Uint8Array(L * 7);
  [...MOT].forEach((c, k) => { for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (LETTRES[c][y][x] === '1') bits[y * L + k * 6 + x] = 1; });
  return { bits, L, H: 7 };
}

// Dessine le filigrane dans `rgba` (Uint8Array W*H*4) en place : le mot repete en diagonale sur toute l'image.
// Texte clair sur fond sombre et inversement : toujours lisible. Retourne la part de pixels touches (pour les tests).
export function filigrane(rgba, W, H) {
  const { bits, L, H: HB } = bitmapMot();
  const s = Math.max(2, Math.round(Math.min(W, H * 16 / 9) / 110));
  const tw = L * s, th = HB * s;
  const pu = Math.round(tw * 1.7), pv = Math.round(th * 3.4);
  const ang = (-28 * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
  let touches = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x * ca + y * sa, v = -x * sa + y * ca;
      const rang = Math.floor(v / pv);
      let uu = (u + rang * pu * 0.5) % pu; if (uu < 0) uu += pu;
      let vv = v % pv; if (vv < 0) vv += pv;
      if (uu >= tw || vv >= th) continue;
      if (!bits[Math.floor(vv / s) * L + Math.floor(uu / s)]) continue;
      const o = (y * W + x) * 4;
      const lum = (rgba[o] * 77 + rgba[o + 1] * 150 + rgba[o + 2] * 29) >> 8;
      const cible = lum > 140 ? 20 : 245;
      for (let c = 0; c < 3; c++) rgba[o + c] = Math.round(rgba[o + c] * 0.35 + cible * 0.65);
      touches++;
    }
  }
  return touches / (W * H);
}

// Taille de l'apercu : "WxH" demande ou, par defaut, 640 de large (ou 360x640 en vertical). Erreur claire si trop grand.
export function tailleApercu(texte, scene) {
  if (texte === undefined) return scene.largeur >= scene.hauteur ? [640, 360] : [360, 640];
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(String(texte).trim());
  if (!m) throw new Error('--taille : forme attendue 640x360 (jusqu\'a 1920x1080)');
  const l = Number(m[1]), h = Number(m[2]);
  if (l > APERCU_LARGEUR_MAX) throw new Error(`--taille : un apercu fait ${APERCU_LARGEUR_MAX} pixels de large au plus (recu ${l})`);
  if (h > APERCU_HAUTEUR_MAX) throw new Error(`--taille : un apercu fait ${APERCU_HAUTEUR_MAX} pixels de haut au plus (recu ${h})`);
  if (l < 64 || h < 64) throw new Error('--taille : au moins 64x64');
  return [l, h];
}
