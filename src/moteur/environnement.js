// Environnement du monde (attributs du jeu 26.3) : assombrissement du ciel cote serveur (Level.updateSkyBrightness), dimension de la scene.
// `gameplay/sky_light_level` : 15 x la piste de day.json (fichier du jeu data/minecraft/timeline/day.json : 133 -> 1, 11867 -> 1, 13670 -> 0,26666668,
// 22330 -> 0,26666668, interpolation lineaire circulaire), puis les couches de meteo du jeu (Horizon horizon-world/src/environment_system.rs
// `weather_maps`, MIT : voir ATTRIBUTIONS.md) : la pluie melange vers 4 avec alpha 0,3125 x pluie, l'orage vers 4 avec alpha 0,52734375 x orage.
// skyDarken = (int)(15 - niveau) (Horizon environment.rs `sky_darken` : tronque). Le monde de l'End : pas de piste, niveau 15 (assombrissement 0).
const PISTE = [[133, 1], [11867, 1], [13670, 0.26666668], [22330, 0.26666668]];
const f32 = Math.fround;

function piste(t) {
  t = ((t % 24000) + 24000) % 24000;
  let i = -1;
  for (let k = 0; k < PISTE.length; k++) if (PISTE[k][0] <= t) i = k; else break;
  const n = PISTE.length;
  const [a, b, ta, tb] = i === -1 ? [PISTE[n - 1], PISTE[0], PISTE[n - 1][0] - 24000, PISTE[0][0]] : i === n - 1 ? [PISTE[n - 1], PISTE[0], PISTE[n - 1][0], PISTE[0][0] + 24000] : [PISTE[i], PISTE[i + 1], PISTE[i][0], PISTE[i + 1][0]];
  const u = (t - ta) / (tb - ta);
  return f32(a[1] + (b[1] - a[1]) * u);
}

// Heure de la scene (0..24, 12 = midi) -> ticks du jour (0..24000)
export const ticksDuJour = (heure) => ((((heure - 6) % 24) + 24) % 24) * 1000;

// niveau de lumiere du ciel (0..15, flottant) a l'instant `ticks` du jour, avec pluie et orage (0..1)
export function niveauCiel(ticks, pluie = 0, orage = 0, dimension = 'overworld') {
  if (dimension === 'end' || dimension === 'the_end') return 15;
  let v = f32(15 * piste(ticks));
  if (pluie > 0) v = f32(v + (4 - v) * f32(0.3125 * pluie));
  if (orage > 0) v = f32(v + (4 - v) * f32(0.52734375 * orage));
  return v;
}
// Level.getSkyDarken : de 0 (plein jour) a 11 (nuit)
export function assombrissementCiel(ticks, pluie = 0, orage = 0, dimension = 'overworld') {
  if (dimension === 'nether' || dimension === 'the_nether') return 11;
  return Math.trunc(15 - niveauCiel(ticks, pluie, orage, dimension));
}
