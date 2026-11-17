// Film avec un VRAI pack de shaders (route B) : meme scene, memes personnages, mais les images sont calculees par l'hote OpenGL logiciel
// (src/pack/hote/) avec le code du pack. Ce module prepare l'etat de chaque image (camera, heure, ciel, acteurs), gere la chauffe
// (images jetees pour que l'exposition et les historiques se stabilisent), les coupures de camera et la couleur selective.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { chargerScene } from '../rendu/scene.js';
import { exporterZone, exporterMaj } from './export-gpu.js';
import { etatImage } from './etat.js';
import { Hote } from './hote.js';
import { animer } from '../film/anim.js';
import { terrainDepuis } from '../film/physique.js';
import { imageEn, cielEn } from '../film/look.js';
import { preparerPersonnages, simulerScene } from '../film/video.js';
import { appliquerTextures, dossierCache } from '../film/cache.js';
import { PostTraitement } from '../rendu/post.js';
import { construireCiel, ticksDepuisHeure, etatAvecMeteo } from '../rendu/ciel-vanille.js';

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

// Genres de geometries du monde simule -> entityId (entity.properties) ou programme du pack (repli d'Iris : block -> terrain, damagedblock -> terrain, particules -> textured)
const GENRES = {
  tnt: { entite: 'minecraft:tnt' }, chute: { entite: 'minecraft:falling_block' }, objet: { entite: 'minecraft:item' },
  bloc: { programme: 'bloc' }, fissure: { programme: 'fissure' }, particule: { programme: 'particule' },
  fleche: { entite: 'minecraft:arrow' }, pluie: { programme: 'meteo' }, eclair: { entite: 'minecraft:lightning_bolt' },   // projectiles, pluie et neige (gbuffers_weather), foudre (Iris : programme des entites, emissif, additif)
};

// Profondeur de l'hote (depthtex0, flottants 0..1 non lineaires, ligne du haut d'abord) -> { donnees: 1 / distance de vue (0 = ciel), W, H, ssaa }
// a la taille de l'image finale : le format du tampon du rasteriseur, pour la profondeur de champ du montage.
export function profondeurDeChamp(octets, w, h, W, H, near = 0.05, far = 256) {
  const d = new Float32Array(octets.buffer.slice(octets.byteOffset, octets.byteOffset + w * h * 4));
  const iw = new Float32Array(W * H);
  const conv = new Float32Array(w * h);
  for (let k = 0; k < d.length; k++) { const v = d[k]; conv[k] = v >= 0.99999 ? 0 : ((far + near) - (2 * v - 1) * (far - near)) / (2 * far * near); }
  for (let y = 0; y < H; y++) { const sy = Math.min(h - 1, Math.floor((y + 0.5) * h / H)) * w; for (let x = 0; x < W; x++) iw[y * W + x] = conv[sy + Math.min(w - 1, Math.floor((x + 0.5) * w / W))]; }
  return { donnees: iw, W, H, ssaa: 1 };
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
  // scene avec un champ `monde` : simulation avant le premier rendu ; les sections de terrain refaites sont envoyees a l'hote entre les images
  const sim = scene.monde ? await simulerScene({ scene, zonePath, baseDir, env }) : null;
  const rs = await chargerScene({ zonePath, zone: sim?.zone, kitDir: kit, travailleurs, options: { exportGPU: true, ...(sim ? { monde: { donnees: sim.donnees, replay: sim.replay, lumiere: scene.monde.lumiere } } : {}) } });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcanim-pack-'));
  let hote = null;
  try {
    const rapport = exporterZone(rs, path.join(tmp, 'maillage'));
    const creatures = scene.acteurs.some((a) => a.creature) ? await (await import('../creatures/donnees.js')).donneesCreatures({ env }) : null;
    const { personnages, parRef, infos } = await preparerPersonnages(scene, { kitDir: kit, surcharges, baseDir, creatures });
    // scene avec monde : terrain vivant (portes, murs poses...) et acteurs a `actes` lus dans le replay, comme dans le rendu de base ; les effets visibles
    // (couvercles de coffre, cloche, fissures, particules, objets au sol, blocs qui tombent, TNT : film/effets-monde.js) sont envoyes a l'hote comme des
    // geometries dynamiques (programme choisi selon leur genre, voir GENRES)
    const terrain = sim ? (await import('../film/terrain-vivant.js')).creerTerrainVivant({ rs, replay: sim.replay, donnees: sim.donnees }) : terrainDepuis(rs);
    const anim = animer(scene, terrain, sim ? { replay: sim.replay } : null, creatures ? { creatures } : {});
    const effets = sim ? (await import('../film/effets-monde.js')).creerEffetsMonde({ rs, scene, sim, kit, donnees: sim.donnees, terrain }) : null;
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
    const stats = { images: 0, transfertMs: 0, hoteMs: 0, nodeMs: 0, majExportMs: 0, majHoteMs: 0, majLots: 0, majSections: 0, majQuads: 0 };   // ou passe le temps : calcul dans l'hote, transfert hote -> Node, reste cote Node
    const lumiere = personnages.map(() => null);
    const post = new PostTraitement();
    let derniereCamera = null, dernierFrame = 0;

    // etat complet d'une image (acteurs et ciel compris)
    // Blocs changes jusqu'a l'instant du monde `tm` : sections refaites, puis envoyees a l'hote (cout mesure dans stats.majMs)
    const dirMaj = path.join(tmp, 'maj');
    const appliquerMaj = async (tm) => {
      if (!sim) return;
      const n = await rs.appliquerReplay(sim.replay.tickDe(tm));
      if (n === -1) throw new Error('monde : la boite de blocs a grandi pendant la scene ; ce cas n\'est pas encore gere avec un vrai pack de shaders (rendu de base : ok)');
      const maj = rs.prendreMajGPU();
      if (!maj.ajouts.length && !maj.mortes.length && !maj.retraits.length) return;
      const t0 = performance.now();
      const r = exporterMaj(rs, dirMaj, maj);
      const t1 = performance.now();
      await hote.majMaillage(dirMaj);
      stats.majExportMs += t1 - t0; stats.majHoteMs += performance.now() - t1; stats.majLots++; stats.majSections += maj.mortes.length; stats.majQuads += r.quads;
    };
    // geometrie du monde simule -> specification pour l'hote : couleurs sans l'eclairage deja cuit (c'est le pack qui eclaire, avec la lumiere du lieu)
    const specMonde = async (m) => {
      const n = m.positions.length / 3;
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < n; k++) { cx += m.positions[k * 3]; cy += m.positions[k * 3 + 1]; cz += m.positions[k * 3 + 2]; }
      cx /= n; cy /= n; cz /= n;
      const l = typeof rs.luminositeEn === 'function' ? Math.max(0, Math.min(1, rs.luminositeEn(cx, cy, cz))) : 1;
      const col = new Float32Array(m.couleurs.length), k1 = 1 / Math.max(0.05, l);
      let blanc = true;
      for (let k = 0; k < col.length; k++) { col[k] = Math.min(1, m.couleurs[k] * k1); if (col[k] < 0.999) blanc = false; }
      const g = GENRES[m.genre] ?? {};
      const spec = { pos: b64(m.positions), uv: b64(m.uvs), col: b64(col), nor: null, idx: b64(m.indices), tex: await idTexture(m.texture), mode: m.mode, deuxFaces: !!m.deuxFaces, ciel: l * 15, entite: 0 };
      if (g.entite) spec.entiteNom = g.entite;
      if (g.programme) spec.programme = g.programme;
      if (m.bloc) spec.blocNom = m.bloc;
      if (m.additif) { spec.additif = true; spec.bloc = 15; }     // foudre : emissive (lumiere 15) et additive (SRC_ALPHA, ONE), comme RenderType.lightning
      if (m.genre === 'tnt' && blanc) spec.bloc = 15;    // le clignotement du TNT est blanc plein (emissif)
      return spec;
    };
    const etatDe = async (i, { sansActeurs = false, temps } = {}) => {
      const im = anim.images[i];
      await appliquerMaj(im.tm);
      const ciel = cielEn(scene, im.t);
      const heure = ciel?.heure ?? 12, jour = ciel?.jour ?? 0;
      // meteo : rainStrength, thunderStrength et wetness du pack (humidite = pluie moyenne des 10 dernieres secondes, le jeu l'adoucit) ; ciel du jeu terni comme dans le rendu de base
      let meteo = null;
      if (effets?.meteo) {
        const niv = effets.meteo.niveaux(im.tm), eclair = effets.meteo.eclair(sim.replay.tickDe(im.tm));
        let h = 0;
        for (let k = 0; k < 20; k++) h += effets.meteo.niveaux(Math.max(0, im.tm - k * 0.5)).pluie / 20;
        if (niv.pluie > 0 || niv.orage > 0 || h > 0 || eclair) meteo = { pluie: niv.pluie, orage: niv.orage, humidite: h, eclair };
      }
      const e = etatImage({ scene: rs, camera: im.camera, heure, jour, largeur: rw, hauteur: rh, frame: 0, temps: temps ?? im.tm, meteo });
      // le ciel du jeu : disque, lueur, etoiles, soleil, lune, nuages
      const ticks = ticksDepuisHeure(heure);
      const base = rs.cielV.couleursCamera(rs.zone, im.camera.x, im.camera.z);
      const et = meteo ? etatAvecMeteo(rs.cielV.etat(ticks, jour, base), meteo) : rs.cielV.etat(ticks, jour, base);
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
          const ms = perso.maillage({ ...p, age: im.tm * 20, camera: im.camera }, l, true);
          for (const m of Array.isArray(ms) ? ms : [ms]) {   // une creature : un maillage par couche
            const spec = { pos: b64(m.positions), uv: b64(m.uvs), col: null, nor: b64(m.normales), idx: b64(m.indices), tex: await idTexture(m.texture), mode: m.mode, deuxFaces: !!m.deuxFaces, ciel: l * 15, entite: 0 };
            if (m.masque) { spec.masque = await idMasque(m.masque); spec.kM = Math.max(0, Math.min(1, m.forceMasque ?? 1)); }
            if (m.exempt) spec.exempt = true;
            if (p.absent) continue;                                    // mort depuis plus d'une seconde : plus dessine
            if (p.teinte) spec.couleurEntite = [1, 0, 0, 0.3];         // rougeur des degats : l'entityColor du jeu (hurt)
            if (m.genre === 'creature') {                              // creature : entityId du pack (entity.properties), teinte de la couche (laine, collier), yeux emissifs
              spec.entiteNom = m.entite; spec.col = b64(m.couleurs);
              if (m.emissif) { spec.additif = true; spec.bloc = 15; }
            }
            e.acteurs.push(spec);
          }
        }
        if (effets) for (const m of effets.maillages(im.tm, im.camera)) e.acteurs.push(await specMonde(m));
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
      const veutProf = !!im.champ;    // profondeur de champ du montage : l'hote rend aussi la profondeur (depthtex0)
      const rep = await hote.commande({ cmd: 'rendre', etat: e, images: 1, coupure: coupure && !apresChauffe, ...(veutProf ? { profondeur: true } : {}) });
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
      dessiner.profondeur = veutProf && rep.profBrut ? profondeurDeChamp(rep.profBrut, rw, rh, largeur, hauteur) : null;
      stats.nodeMs += Date.now() - t0 - (rep.temps?.total ?? 0) - (rep.transfert_ms ?? 0);
      return copie && sortie === rgba ? Uint8Array.from(rgba) : sortie;
    };
    return {
      rs, anim, infos, kit, notes: [...(info.notes || []), ...(sim ? sim.notes : []), ...(effets ? effets.notes : [])], hote, sim, dessiner, etatDe, chaufferSur, info, tailleRendu: [rw, rh],
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
