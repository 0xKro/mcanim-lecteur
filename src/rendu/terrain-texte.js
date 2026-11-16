// Texte de `mcanim terrain <zone>` : le resume du terrain (rendu/scene.js, resumeTerrain) plus, quand la zone contient un village, ce qu'il
// faut a un animateur : type, rues (lignes centrales et largeur), maisons (cadre et porte avec le cote de la sortie), cloche, puits, fermes,
// lampadaires. Le tout reste court (environ 2,2 Ko) : on retire d'abord la grille de hauteurs, puis des maisons.
import { analyserVillage, resumeVillage } from './village.js';

export const TAILLE_MAX = 2200;
const NOTE = "Fais marcher l'acteur le long d'un des chemins (rue:true = rue du village) ; hors chemin, il traversera des arbres.";
const NOTE_VILLAGE = 'Village : coordonnees du monde comme pos ; rues = lignes centrales (l = largeur) ; maisons : b = cadre [x0,z0,x1,z1], porte = [x,z,cote de la sortie : N=-z S=+z E=+x O=-x]. Image : mcanim terrain <zone> --carte.';

export function texteTerrain(rs, pas) {
  const r = rs.resumeTerrain(pas ? { pas } : undefined);
  let v = null;
  try { v = rs.zone?.palette ? analyserVillage(rs.zone) : null; } catch { v = null; }
  if (!v) return `${JSON.stringify(r)}\n${NOTE}`;
  const fabriquer = (nbMaisons, grille) => {
    const o = { ...r, village: resumeVillage(v, { maisons: nbMaisons }) };
    if (!grille) delete o.grille;
    return `${JSON.stringify(o)}\n${NOTE}\n${NOTE_VILLAGE}`;
  };
  let t = fabriquer(12, true);
  for (const [n, g] of [[12, false], [9, false], [7, false], [5, false], [3, false]]) { if (Buffer.byteLength(t) <= TAILLE_MAX) break; t = fabriquer(n, g); }
  return t;
}
