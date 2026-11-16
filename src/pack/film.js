// Film avec un VRAI pack de shaders (route B) : meme scene, memes personnages, mais les images sont calculees par l'hote OpenGL logiciel
// (src/pack/hote/) avec le code du pack. Ce module prepare l'etat de chaque image (camera, heure, ciel, acteurs), gere la chauffe
// (images jetees pour que l'exposition et les historiques se stabilisent), les coupures de camera et la couleur selective.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { chargerScene } from '../rendu/scene.js';
import { exporterZone } from './export-gpu.js';
import { etatImage } from './etat.js';
import { Hote } from './hote.js';
import { animer } from '../film/anim.js';
import { terrainDepuis } from '../film/physique.js';
import { imageEn, cielEn } from '../film/look.js';
import { preparerPersonnages } from '../film/video.js';
import { appliquerTextures, dossierCache } from '../film/cache.js';
import { PostTraitement } from '../rendu/post.js';
import { construireCiel, ticksDepuisHeure } from '../rendu/ciel-vanille.js';

const b64 = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).toString('base64');

// Normale plate par triangle, copiee sur les 3 sommets (pour les nuages : le pack veut des normales)
function normalesPlates(pos, idx) {
  const nor = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    let x = e1y * e2z - e1z * e2y, y = e1z * e2x - e1x * e2z, z = e1x * e2y - e1y * e2x;
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    for (const s of [a, b, c]) { nor[s] = x; nor[s + 1] = y; nor[s + 2] = z; }
  }
  return nor;
}

// Agrandit un RGBA (bilineaire) : rendu du pack a l'echelle 0,5 puis image finale a la taille de la scene.
export function agrandir(src, w, h, W, H) {
  if (w === W && h === H) return src;
  const out = new Uint8Array(W * H * 4);
  const sx = w / W, sy = h / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.max(0, Math.min(h - 1, (y + 0.5) * sy - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.max(0, Math.min(w - 1, (x + 0.5) * sx - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const o = (y * W + x) * 4, a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = (src[a + k] * (1 - tx) + src[b + k] * tx) * (1 - ty) + (src[c + k] * (1 - tx) + src[d + k] * tx) * ty + 0.5;
    }
  }
  return out;
}

// Reduit un tampon de force (octets) de la meme facon
function agrandirForce(f, w, h, W, H) {
  if (w === W && h === H) return f;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = f[Math.min(h - 1, Math.floor((y + 0.5) * h / H)) * w + Math.min(w - 1, Math.floor((x + 0.5) * w / W))];
  return out;
}

// Saut de camera : au-dela, l'image d'avant n'a plus rien a voir avec celle-ci (historiques a oublier)
export function estCoupure(a, b) {
  if (!a) return true;
  const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  let dl = Math.abs(((b.lacet - a.lacet + 540) % 360) - 180);
  return d > 6 || dl > 45 || Math.abs((b.fov ?? 70) - (a.fov ?? 70)) > 25;
}

// Prepare tout : terrain exporte, hote GL, personnages, animation. Retourne { rs, anim, infos, notes, hote, dessiner(i, opts), fermer() }.
export async function preparerFilmPack({ scene, zonePath, kitDir, surcharges = {}, baseDir = process.cwd(), env = process.env, packShader, echelle = 1, options = {}, travailleurs = 0, log = () => {}, chauffe }) {
  const kit = Object.keys(scene.textures ?? {}).length ? appliquerTextures(kitDir, scene.textures, baseDir, { env }) : kitDir;
  const rs = await chargerScene({ zonePath, kitDir: kit, travailleurs, options: { exportGPU: true } });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcanim-pack-'));
  let hote = null;
  try {
    const rapport = exporterZone(rs, path.join(tmp, 'maillage'));
    const { personnages, parRef, infos } = await preparerPersonnages(scene, { kitDir: kit, surcharges, baseDir });
    const terrain = terrainDepuis(rs);
    const anim = animer(scene, terrain);
    const W = scene.largeur, H = scene.hauteur;
    const rw = Math.max(16, Math.round(W * echelle)), rh = Math.max(16, Math.round(H * echelle));
    hote = await Hote.demarrer();
    // un pack inutilisable (programme manquant, GLSL qui ne compile pas, #include absent) : UNE phrase claire, avant le premier calcul
    const propre = (e) => new Error('pack de shaders inutilisable : ' + String(e.message).replace(/^\w*(Error|Erreur\w*):\s*/, '').split('\n')[0]);
    let info;
    try {
      info = await hote.init({ pack: packShader, largeur: rw, hauteur: rh, maillage: path.join(tmp, 'maillage'), options: options.surcharges, reglages: options.reglages });
      await hote.commande({ cmd: 'precompiler' });
    } catch (e) { throw propre(e); }
    log(`pack ${info.pack} : ${info.programmes} programmes, ${rapport.quads ? Object.values(rapport.quads).reduce((a, b) => a + b, 0) : 0} quads`);

    const texIds = new WeakMap();
    let prochaine = 1;
    const envoyees = new Set();
    const idTexture = async (t) => {   // t : { largeur, hauteur, rgba } ou { w, h, rgba }
      const cle = t.rgba;
      let id = texIds.get(cle);
      if (!id) { id = prochaine++; texIds.set(cle, id); }
      if (!envoyees.has(id)) { envoyees.add(id); await hote.texture(id, t.largeur ?? t.w, t.hauteur ?? t.h, Buffer.from(t.rgba.buffer, t.rgba.byteOffset, t.rgba.byteLength).toString('base64')); }
      return id;
    };
    const idMasque = async (m) => {
      let id = texIds.get(m.valeurs);
      if (!id) { id = prochaine++; texIds.set(m.valeurs, id); }
      if (!envoyees.has(id)) { envoyees.add(id); await hote.masque(id, m.largeur, m.hauteur, Buffer.from(m.valeurs.buffer, m.valeurs.byteOffset, m.valeurs.byteLength).toString('base64')); }
      return id;
    };

    let chauffeN = chauffe ?? 12;
    const stats = { images: 0, transfertMs: 0, hoteMs: 0, nodeMs: 0 };   // ou passe le temps : calcul dans l'hote, transfert hote -> Node, reste cote Node
    const lumiere = personnages.map(() => null);
    const post = new PostTraitement();
    let derniereCamera = null, dernierFrame = 0;

    // etat complet d'une image (acteurs et ciel compris)
    const etatDe = async (i, { sansActeurs = false, temps } = {}) => {
      const im = anim.images[i];
      const ciel = cielEn(scene, im.t);
      const heure = ciel?.heure ?? 12, jour = ciel?.jour ?? 0;
      const e = etatImage({ scene: rs, camera: im.camera, heure, jour, largeur: rw, hauteur: rh, frame: 0, temps: temps ?? im.tm });
      // le ciel du jeu : disque, lueur, etoiles, soleil, lune, nuages
      const ticks = ticksDepuisHeure(heure);
      const base = rs.cielV.couleursCamera(rs.zone, im.camera.x, im.camera.z);
      const et = rs.cielV.etat(ticks, jour, base);
      const cv = construireCiel(rs.cielV, et, im.camera, null, (temps ?? im.tm) * 20);
      const v = cv.vanille;
      e.ciel3d = {
        ciel: v.sky, brume: v.fog, sunrise: v.sunrise,
        etoiles: v.etoiles ? { dirs: b64(v.etoiles.dirs.subarray(0, v.etoiles.n * 3)), tailles: b64(v.etoiles.tailles.subarray(0, v.etoiles.n)), lum: v.etoiles.lum, couleur: v.etoiles.couleur } : null,
        astres: await Promise.all(v.astres.filter((a) => a.tex).map(async (a) => ({ n: a.n, ex: a.ex, ez: a.ez, taille: a.taille, lune: a.lune, mult: a.mult, tex: await idTexture(a.tex) }))),
      };
      if (cv.nuage) {
        const m = cv.nuage;
        e.nuages = { pos: b64(m.positions), uv: b64(m.uvs), col: b64(m.couleurs), idx: b64(m.indices), nor: b64(normalesPlates(m.positions, m.indices)), tex: await idTexture(m.texture) };
      }
      const image = imageEn(scene, im.t);
      if (!sansActeurs) {
        e.acteurs = [];
        for (let k = 0; k < im.acteurs.length; k++) {
          const p = im.acteurs[k];
          let l = 1;
          if (typeof rs.luminositeEn === 'function') {
            const brut = rs.luminositeEn(p.x, p.y + 0.9, p.z);
            l = lumiere[k] === null ? brut : lumiere[k] + (brut - lumiere[k]) * 0.25;
            lumiere[k] = l;
          }
          const perso = p.skin ? parRef[k].get(p.skin) : personnages[k];
          const m = perso.maillage({ ...p, age: im.tm * 20 }, l, true);
          const spec = { pos: b64(m.positions), uv: b64(m.uvs), col: null, nor: b64(m.normales), idx: b64(m.indices), tex: await idTexture(m.texture), mode: m.mode, deuxFaces: !!m.deuxFaces, ciel: l * 15, entite: 0 };
          if (m.masque) { spec.masque = await idMasque(m.masque); spec.kM = Math.max(0, Math.min(1, m.forceMasque ?? 1)); }
          if (m.exempt) spec.exempt = true;
          e.acteurs.push(spec);
        }
        e.veutMasque = !!image && e.acteurs.some((a) => a.exempt || a.masque);
      }
      return e;
    };

    // Chauffe : N images jetees sur l'etat de l'image i (a la premiere image du film et apres une coupure)
    const chaufferSur = async (i, n, reinit = false) => {
      if (n <= 0) return;
      const dt = 1 / 30, im = anim.images[i];
      const e = await etatDe(i, { temps: im.tm - n * dt });
      e.frame = dernierFrame; e.dt = dt;
      await hote.commande({ cmd: 'rendre', etat: e, images: n, coupure: true, reinit });
      dernierFrame += n;
    };

    // Une image du film, a la taille de la scene (agrandie si echelle < 1), post-traitement `image` et couleur selective compris
    const dessiner = async (i, { largeur = W, hauteur = H, copie = true, apresChauffe = true } = {}) => {
      const im = anim.images[i];
      const coupure = estCoupure(derniereCamera, im.camera);
      if (coupure && apresChauffe) await chaufferSur(i, derniereCamera ? Math.min(6, chauffeN) : chauffeN);
      const t0 = Date.now();
      const e = await etatDe(i);
      const image = imageEn(scene, im.t);
      e.frame = dernierFrame++; e.dt = 1 / 30;
      const rep = await hote.commande({ cmd: 'rendre', etat: e, images: 1, coupure: coupure && !apresChauffe });
      derniereCamera = im.camera;
      stats.images++; stats.transfertMs += rep.transfert_ms ?? 0; stats.hoteMs += rep.temps?.total ?? 0;
      let rgba = new Uint8Array(rep.donnees.buffer, rep.donnees.byteOffset, rw * rh * 4);
      for (let k = 3; k < rgba.length; k += 4) rgba[k] = 255;    // le pack laisse parfois l'alpha a 0 : l'image finale est opaque
      if (image) {
        const px = new Uint32Array(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength));
        const force = rep.force ? new Uint8Array(rep.force.buffer, rep.force.byteOffset, rw * rh) : null;
        post.appliquer(px, rw, rh, image, force);
        rgba = new Uint8Array(px.buffer);
      }
      const sortie = agrandir(rgba, rw, rh, largeur, hauteur);
      dessiner.dernier = rep;
      stats.nodeMs += Date.now() - t0 - (rep.temps?.total ?? 0) - (rep.transfert_ms ?? 0);
      return copie && sortie === rgba ? Uint8Array.from(rgba) : sortie;
    };
    return {
      rs, anim, infos, kit, notes: [...(info.notes || [])], hote, dessiner, etatDe, chaufferSur, info, tailleRendu: [rw, rh],
      reglerChauffe: (n) => { chauffeN = n; }, chauffe: () => chauffeN, stats,
      memoireHoteMo: () => { try { return Math.round(+/VmHWM:\s+(\d+)/.exec(fs.readFileSync(`/proc/${hote.proc.pid}/status`, 'utf8'))[1] / 1024); } catch { return null; } },
      fermer: async () => { try { await hote.fermer(); } catch { /* deja arrete */ } try { hote.proc.kill('SIGKILL'); } catch { /* rien */ } await rs.fermer(); fs.rmSync(tmp, { recursive: true, force: true }); },
    };
  } catch (e) {
    try { if (hote) { await hote.fermer(); hote.proc.kill('SIGKILL'); } } catch { /* rien */ }
    await rs.fermer();
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

// Nombre d'images de chauffe d'un pack : mesure (luminosite moyenne qui ne bouge plus) puis garde en cache.
export function cleChauffe(packShader, options) {
  const st = fs.statSync(packShader);
  return crypto.createHash('sha1').update(`${path.basename(packShader)}|${st.size}|${JSON.stringify(options ?? {})}`).digest('hex').slice(0, 16);
}
export function lireCacheChauffe(cle) {
  try { return JSON.parse(fs.readFileSync(path.join(dossierCache(), 'chauffe.json'), 'utf8'))[cle] ?? null; } catch { return null; }
}
export function ecrireCacheChauffe(cle, n) {
  const f = path.join(dossierCache(), 'chauffe.json');
  let t = {};
  try { t = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* neuf */ }
  t[cle] = n;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(t));
}
const lumMoy = (rgba) => { let s = 0, n = 0; for (let i = 0; i < rgba.length; i += 4 * 17) { s += rgba[i] * 0.2126 + rgba[i + 1] * 0.7152 + rgba[i + 2] * 0.0722; n++; } return s / n; };
// Rend l'image 0 de 1 en 1 jusqu'a ce que la luminosite moyenne varie de moins de 1 % pendant 3 images de suite. Retourne N (2 a `max`).
export async function mesurerChauffe(film, { max = 60 } = {}) {
  const e = await film.etatDe(0);
  let prec = null, calmes = 0;
  await film.hote.commande({ cmd: 'rendre', etat: { ...e, frame: 0 }, images: 1, coupure: true });
  for (let n = 1; n <= max; n++) {
    const rep = await film.hote.commande({ cmd: 'rendre', etat: { ...e, frame: n, temps: e.temps + n / 30 }, images: 1 });
    const l = lumMoy(rep.donnees);
    if (prec !== null && Math.abs(l - prec) <= Math.max(0.4, prec * 0.01)) { if (++calmes >= 3) return Math.max(2, n); } else calmes = 0;
    prec = l;
  }
  return max;
}
