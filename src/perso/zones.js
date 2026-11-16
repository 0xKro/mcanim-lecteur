// Disposition d'un skin 64x64 : rectangles de chaque face de chaque partie du corps, couche de base et couche externe.
// Tout vient de la VRAIE table d'UV du modele (modele.js : definirParties + facesBoite), rien n'est recopie a la main.
import { definirParties, facesBoite } from './modele.js';

const COURT = { avant: 'Av', arriere: 'Ar', gauche: 'G', droite: 'D', dessus: 'H', dessous: 'B' };

// Liste d'objets { partie, couche: 'base'|'ext', faces: { avant: [x,y,l,h], ... } } ; (x,y) = coin haut-gauche, en pixels du PNG.
export function rectanglesSkin(modele = 'wide') {
  const sortie = [];
  for (const p of definirParties(modele === 'slim')) {
    for (const couche of ['base', 'ext']) {
      const g = couche === 'ext' ? p.ext.g : 0;
      const uv = couche === 'ext' ? p.ext.uv : p.uv;
      const min = p.orig.map((c) => c - g), max = p.orig.map((c, i) => c + p.taille[i] + g);
      const faces = {};
      for (const f of facesBoite(uv, p.taille, min, max)) { const [u0, v0, u1, v1] = f.rect; faces[f.nom] = [u0, v0, u1 - u0, v1 - v0]; }
      sortie.push({ partie: p.nom, couche, faces });
    }
  }
  return sortie;
}

// Texte court (9 lignes) pour l'IA : `mcanim skin ... --zones`.
export function textZonesSkin(modele = 'wide') {
  const par = rectanglesSkin(modele);
  const ligne = (partie, couche) => {
    const r = par.find((e) => e.partie === partie && e.couche === couche).faces;
    return Object.entries(COURT).map(([nom, c]) => `${c} ${r[nom].join(',')}`).join('  ');
  };
  const membre = (n) => `${n} : ${ligne(n, 'base')}  | couche externe : ${ligne(n, 'ext')}`;
  return [
    `skin 64x64 (modele ${modele}) ; rectangle = x,y,largeur,hauteur du coin haut-gauche ; Av devant, Ar dos, G gauche, D droite, H dessus, B dessous`,
    `tete : ${ligne('tete', 'base')}`,
    `chapeau (couche externe de la tete, cheveux ou casque) : ${ligne('tete', 'ext')}`,
    membre('corps'), membre('brasD'), membre('brasG'), membre('jambeD'), membre('jambeG'),
    'les couches externes (chapeau, manches...) sont transparentes ou non : alpha 0 = on voit la couche de base dessous',
    'visage de face = Av de la tete (8,8,8,8) : yeux sur ses lignes 4 et 5 (y = 12 et 13), cheveux = sommet H de la tete + chapeau',
  ].join('\n');
}
