// Worker de rendu : il garde le maillage statique (partage en memoire) et dessine ses rangees.
import { parentPort, workerData } from 'node:worker_threads';
import { Rasteriseur } from './raster.js';
import { PostTraitement } from './post.js';
import { analyser, calculerRayons, composer } from '../shader/post.js';

const rast = new Rasteriseur();
const post = new PostTraitement();
const statiques = workerData.draws; // buffers partages
const textures = new Map(); // textures dynamiques recues (par id)
const masques = new Map();  // masques de couleur selective recus (par id) : Uint8Array
const { rangeeDe, nW } = workerData;

parentPort.on('message', (m) => {
  if (m.type === 'arret') { process.exit(0); }
  if (m.type === 'ombres') { m.liste.forEach((o, i) => { if (o) statiques[i].ombre = o; }); return; }
  if (m.type === 'rayons') { calculerRayons(m.tp, m.par, rangeeDe, nW); parentPort.postMessage({ type: 'fini', id: m.id }); return; }
  if (m.type === 'composer') {   // passe finale du shader sur mes bandes, puis l'etalonnage `image` de la scene
    composer(m.pixels, m.W, m.H, m.tp, m.par, m.force || null, rangeeDe, nW);
    if (m.post) post.appliquer(m.pixels, m.W, m.H, m.post, m.force || null, { rangeeDe, nW });
    parentPort.postMessage({ type: 'fini', id: m.id });
    return;
  }
  if (m.type !== 'image') return;
  for (const t of m.texturesNouvelles) textures.set(t.id, { niveaux: [{ w: t.w, h: t.h, data: t.data }] });
  for (const k of m.masquesNouveaux || []) masques.set(k.id, k.data);
  const dyn = m.dynamiques.map((d) => ({ ...d, tex: textures.get(d.texId), masque: d.masqueId ? masques.get(d.masqueId) : null }));
  const pixels = m.pixels;
  const st = rast.rendre({ pixels, W: m.W, H: m.H, cam: m.cam, draws: statiques.concat(dyn), rangeeDe, nW, params: m.params, force: m.force || null });
  if (m.ana) analyser(pixels, rast.zbuf, m.W, m.H, m.ana.tp, m.ana.par, rangeeDe, nW);
  // post-traitement `image` sur mes bandes (la couleur selective vient du tampon `force` partage)
  if (m.post) post.appliquer(pixels, m.W, m.H, m.post, m.force || null, { rangeeDe, nW });
  parentPort.postMessage({ type: 'fini', id: m.id, stats: { ...st } });
});
