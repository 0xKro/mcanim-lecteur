// Worker de rendu : il garde le maillage statique (partage en memoire) et dessine ses rangees.
import { parentPort, workerData } from 'node:worker_threads';
import { Rasteriseur } from './raster.js';

const rast = new Rasteriseur();
const statiques = workerData.draws; // buffers partages
const textures = new Map(); // textures dynamiques recues (par id)
const { rangeeDe, nW } = workerData;

parentPort.on('message', (m) => {
  if (m.type === 'arret') { process.exit(0); }
  if (m.type !== 'image') return;
  for (const t of m.texturesNouvelles) textures.set(t.id, { niveaux: [{ w: t.w, h: t.h, data: t.data }] });
  const dyn = m.dynamiques.map((d) => ({ ...d, tex: textures.get(d.texId) }));
  const pixels = m.pixels;
  const st = rast.rendre({ pixels, W: m.W, H: m.H, cam: m.cam, draws: statiques.concat(dyn), rangeeDe, nW, params: m.params });
  parentPort.postMessage({ type: 'fini', id: m.id, stats: { ...st } });
});
