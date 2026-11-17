// Etat d'une image pour l'hote GL : camera, heure, couleurs du ciel du jeu, lumiere a la camera. Pas de GL ici.
import { ticksDepuisHeure, angleSoleil, etatAvecMeteo } from '../rendu/ciel-vanille.js';

// scene : retour de chargerScene (a besoin de scene.cielV, scene.zone, scene.niveauLumiere). camera : { x, y, z, lacet, tangage, fov }.
// meteo (facultatif) : { pluie, orage, humidite, eclair } -> uniformes rainStrength, thunderStrength, wetness du pack ; le ciel du jeu est terni comme dans le rendu de base.
export function etatImage({ scene, camera, heure = 12, jour = 0, largeur, hauteur, frame = 0, temps = 0, meteo = null }) {
  const ticks = ticksDepuisHeure(heure);
  const base = scene.cielV.couleursCamera(scene.zone, camera.x, camera.z);
  const et = meteo ? etatAvecMeteo(scene.cielV.etat(ticks, jour, base), meteo) : scene.cielV.etat(ticks, jour, base);
  const sky = et.sky.map((v) => v / 255), fog = et.fog.map((v) => v / 255);
  let niveau = 15;
  try { const n = scene.niveauLumiere(Math.floor(camera.x), Math.floor(camera.y), Math.floor(camera.z)); if (Number.isFinite(n)) niveau = n; } catch { /* hors zone */ }
  // lumiere du jour pour la texture `lightmap` : 1 le jour, 0 la nuit (suit la piste du ciel)
  const jourLumiere = Math.max(0, Math.min(1, (sky[2] - 0.05) / 0.9));
  return {
    largeur, hauteur, camera: { x: camera.x, y: camera.y, z: camera.z, lacet: camera.lacet ?? 0, tangage: camera.tangage ?? 0, fov: camera.fov ?? 70 },
    heure, ticks, angleSoleil: angleSoleil(ticks), jour, ciel: sky, brume: fog, luminosite: [0, niveau], jourLumiere,
    frame, temps, dt: 1 / 30, pluie: meteo ? meteo.pluie : 0, orage: meteo ? meteo.orage : 0, humidite: meteo ? meteo.humidite ?? 0 : 0,
  };
}
