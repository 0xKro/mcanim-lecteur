// Recherche de ffmpeg : variable MCANIM_FFMPEG, sinon le PATH.
import { spawnSync } from 'node:child_process';

export function trouverFfmpeg(env = process.env) {
  const cands = env.MCANIM_FFMPEG ? [env.MCANIM_FFMPEG] : ['ffmpeg'];
  for (const c of cands) {
    const r = spawnSync(c, ['-version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return c;
  }
  throw new Error(env.MCANIM_FFMPEG
    ? `ffmpeg introuvable : MCANIM_FFMPEG=${env.MCANIM_FFMPEG} ne se lance pas`
    : 'ffmpeg est introuvable. Installez-le (par exemple : apt install ffmpeg) ou indiquez son chemin avec MCANIM_FFMPEG.');
}
