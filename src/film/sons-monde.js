// Sons du MONDE SIMULE : les evenements `son` du replay (portes, coffres, cloche, pose et casse de blocs, coups de pioche, notes...) sont mixes
// comme les autres sons du film, avec l'affaiblissement du jeu : un son de volume v s'entend jusqu'a 16 x max(1, v) blocs, lineairement.
// La hauteur (pitch) change la vitesse de lecture (reechantillonnage dans film/sons.js). Un son absent du kit est ignore et signale une fois.
import { choisir } from './sons.js';

const DT = 1 / 30;

export function sonsDuReplay({ replay, images, sons, evenements, gel = [], remap = null }) {
  const S = replay.sons, n = S.length / 7;
  const absents = new Set();
  const reel = (w) => { let t = w; for (const [a, b] of gel) if (t > a) t += b - a; return t; };
  for (let i = 0; i < n; i++) {
    const tick = S[i * 7], nom = replay.noms[S[i * 7 + 1]], x = S[i * 7 + 2], y = S[i * 7 + 3], z = S[i * 7 + 4], vol = S[i * 7 + 5], hauteur = S[i * 7 + 6];
    const liste = sons.fichiers(nom);
    if (!liste.length) { absents.add(nom); continue; }
    let t = reel(tick / (20 * replay.ralenti));
    if (remap) t = remap.filmDe(t);
    if (t < 0 || !images.length) continue;
    const im = images[Math.min(images.length - 1, Math.max(0, Math.round(t / DT)))];
    const cam = im.camera, dx = x - cam.x, dy = y - cam.y, dz = z - cam.z, d = Math.hypot(dx, dy, dz);
    const portee = 16 * Math.max(1, vol);
    const gain = Math.min(2, vol * Math.max(0, 1 - d / portee));
    if (gain < 0.01) continue;
    const psi = (cam.lacet * Math.PI) / 180, fx = -Math.sin(psi), fz = Math.cos(psi), dh = Math.hypot(dx, dz);
    const pan = dh > 0.3 ? Math.max(-1, Math.min(1, (dx * -fz + dz * fx) / dh)) : 0;
    evenements.push({ t, fichier: choisir(liste, `monde|${nom}|${i}`), gain, pan, hauteur });
  }
  return absents.size ? [`sons du monde absents du kit, ignores : ${[...absents].join(', ')}`] : [];
}
