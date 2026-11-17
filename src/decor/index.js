// Decors (docs/FORMAT-DECOR.md) : faire construire le LLM sur le terrain de la zone. Point d'entree de la phase 1.
//   scene.decor = ["maison.decor.json", {...decor en ligne...}]   (au plus 8, appliques dans l'ordre)
// Le decor est applique a une COPIE de la zone, avant le moteur et le maillage : le reste du lecteur voit une zone ordinaire.
import { lireDecorsScene, appliquerDecors } from './appliquer.js';

export { lireDecor, lireDecorTexte, NOMS_OPS } from './lire.js';
export { lireDecorsScene, appliquerDecors } from './appliquer.js';
export { ErreurDecor, LIMITES } from './grille.js';
export { rapportDecor } from './rapport.js';

// Zone + decors de la scene -> { zone, rapports, notes }. Sans decor : la zone elle-meme, sans copie.
// donnees : tables du jeu (moteur/chargeur.js : donneesDuJeu) ; baseDir : dossier du fichier de scene.
export async function zoneAvecDecor({ zone, scene, baseDir, donnees }) {
  if (!scene?.decor?.length) return { zone, rapports: [], notes: [] };
  const lus = lireDecorsScene(scene.decor, { baseDir, d: donnees, zoneId: scene.zone });
  const r = appliquerDecors(zone, lus, { donnees });
  const notes = r.rapports.map((x) => `decor ${x.nom} : ${x.plus + x.moins} blocs changes en ${Math.round(x.ms)} ms${x.flottants ? `, ${x.flottants} flottant(s)` : ''}`);
  return { zone: r.zone, rapports: r.rapports, notes };
}

// Une ligne pour `mcanim terrain --scene` (300 octets au plus) : les portes des decors comme passages [x, z, cote de la sortie, ouverte|fermee] et les emprises
export function resumeTerrainDecor(rapports) {
  const COTE = { north: 'N', south: 'S', east: 'E', west: 'O' };
  const OPPOSE = { north: 'south', south: 'north', east: 'west', west: 'east' };
  const portes = rapports.flatMap((r) => r.portes.map((p) => `[${p.x},${p.z},${COTE[OPPOSE[p.f]] || '?'},${p.ouverte ? 'ouverte' : 'fermee'}]`));
  const emprises = rapports.filter((r) => r.cellules).map((r) => `${r.nom.replace(/\.decor\.json$/, '')} [${r.emprise.x0},${r.emprise.z0},${r.emprise.x1},${r.emprise.z1}]`);
  let t = `decor : ${emprises.join(' ')}${portes.length ? ' ; portes (x,z,cote de la sortie N=-z S=+z E=+x O=-x, etat) : ' + portes.join(' ') : ''}. Les chemins ci-dessus tiennent compte des batiments ; un acteur entre par une porte ouverte.`;
  if (Buffer.byteLength(t) > 420) t = t.slice(0, 417) + '...';
  return t;
}
