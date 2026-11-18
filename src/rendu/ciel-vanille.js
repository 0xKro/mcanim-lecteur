// Ciel "comme le vrai jeu" (Minecraft 26.3), toujours present dans le rendu de base, avec ou sans shader.json :
// couleurs du ciel et de la brume selon l'heure et le biome, lueur du lever et du coucher, soleil et lune (textures du jeu, 8 phases),
// etoiles (champ d'etoiles du jeu), nuages epais (clouds.png). Les valeurs viennent des donnees du jeu (timeline day.json, dimension
// overworld) et de la logique de rendu du client Horizon (MIT) : voir ATTRIBUTIONS.md.
//
// Ce module ne dessine rien : il calcule des nombres (etat du ciel a un instant) et fabrique le maillage des nuages. Le dessin du ciel
// est dans raster.js (ciel), les nuages sont un maillage "melange" ordinaire.
//
// Hypotheses (le code de reference est parfois muet) :
//  - distance de rendu 12 chunks (defaut du jeu) : elle regle l'etalement du degrade ciel/brume (fin de brume du ciel = 192 blocs) ;
//  - pas de pluie ni d'orage ; heure du jeu : ticks = ((heure - 6) mod 24) x 1000 (heure 12 = midi = tick 6000) ;
//  - sur le sol du jeu les fichiers de textures sont lus dans <kit>/assets/minecraft/textures/environment/ ; s'ils manquent
//    (kit ancien), soleil, lune et nuages ne sont pas dessines (les couleurs et les etoiles le sont quand meme).
import fs from 'node:fs';
import path from 'node:path';
import { decoderPNG } from './png.js';
import { ternir } from '../film/meteo.js';
import { Aleatoire } from '../moteur/aleatoire.js';   // java.util.Random : eclairs du ciel de l'End

export const PERIODE = 24000;
export const RAYON_CIEL_CHUNKS = 12;
export const HAUTEUR_NUAGES = 192.33;
const CIEL_DEFAUT = [0x78, 0xa7, 0xff], BRUME_DEFAUT = [0xc0, 0xd8, 0xff];   // dimension overworld : sky_color, fog_color
const NUAGE_DEFAUT = [1, 1, 1, 0xcc / 255];                                 // visual/cloud_color

// ---------------------------------------------------------------- timeline day.json (pistes visuelles de l'overworld)
const hex = (s) => { const v = parseInt(s.slice(1), 16); return s.length > 7 ? [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, ((v >>> 24) & 255) / 255] : [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };
// "#aarrggbb" -> [r, g, b, a] 0..1
const argb = (s) => { const v = parseInt(s.slice(1), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, ((v >>> 24) & 255) / 255]; };
void hex;
const PISTE_CIEL = [[133, [1]], [11867, [1]], [13670, [0]], [22330, [0]]];
const PISTE_BRUME = [[133, [1, 1, 1]], [11867, [1, 1, 1]], [13670, [15 / 255, 15 / 255, 22 / 255]], [22330, [15 / 255, 15 / 255, 22 / 255]]];
const PISTE_NUAGE = [[133, [1, 1, 1, 1]], [11867, [1, 1, 1, 1]], [13670, [25 / 255, 25 / 255, 38 / 255, 1]], [22330, [25 / 255, 25 / 255, 38 / 255, 1]]];
const PISTE_ETOILES = [[92, 0.037], [627, 0], [11373, 0], [11732, 0.016], [11959, 0.044], [12399, 0.143], [12729, 0.258], [13228, 0.5], [22772, 0.5], [23032, 0.364], [23356, 0.225], [23758, 0.101]].map(([t, v]) => [t, [v]]);
const PISTE_LEVER = [[71, '#5fefa333'], [310, '#29f5ba33'], [565, '#06fbd433'], [730, '#00ffe533'], [11270, '#00ffe533'], [11397, '#04fcd833'], [11522, '#0ff9cb33'], [11690, '#29f5ba33'], [11929, '#5fefa333'],
  [12243, '#b1e78733'], [12358, '#cce47e33'], [12512, '#e9e07233'], [12613, '#f6dd6b33'], [12732, '#feda6333'], [12841, '#fed75c33'], [13035, '#ecd25133'], [13252, '#c1cc4733'], [13775, '#36be3733'],
  [13888, '#1fbb3533'], [14039, '#09b73333'], [14192, '#00b33333'], [21807, '#00b23333'], [21961, '#09b73333'], [22112, '#1fbb3533'], [22225, '#36be3733'], [22748, '#c1cc4733'], [22965, '#ecd25133'],
  [23159, '#fed75c33'], [23272, '#feda6333'], [23488, '#e9e07233'], [23642, '#cce47e33'], [23757, '#b1e78733']].map(([t, c]) => [t, argb(c)]);

// Interpolation lineaire circulaire (periode 24000) entre images cles triees [[tick, [valeurs]]]
function piste(cles, t) {
  t = ((t % PERIODE) + PERIODE) % PERIODE;
  const n = cles.length;
  let i = -1;
  for (let k = 0; k < n; k++) if (cles[k][0] <= t) i = k; else break;
  let a, b, ta, tb;
  if (i === -1) { a = cles[n - 1]; ta = a[0] - PERIODE; b = cles[0]; tb = b[0]; }
  else if (i === n - 1) { a = cles[n - 1]; ta = a[0]; b = cles[0]; tb = b[0] + PERIODE; }
  else { a = cles[i]; b = cles[i + 1]; ta = a[0]; tb = b[0]; }
  const u = tb === ta ? 0 : (t - ta) / (tb - ta);
  return a[1].map((v, k) => v + (b[1][k] - v) * u);
}

// cubic-bezier(0.362, 0.241, 0.638, 0.759) : adoucissement de la course des astres (comme le jeu)
function bezier(u) {
  const x1 = 0.362, y1 = 0.241, x2 = 0.638, y2 = 0.759;
  const X = (s) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
  const Y = (s) => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (X(m) < u) lo = m; else hi = m; }
  return Y((lo + hi) / 2);
}
// angle (degres) des astres : 0 = au zenith a midi (tick 6000), croit vers l'ouest puis la nuit
export function angleSoleil(ticks) { const t = (((ticks - 6000) % PERIODE) + PERIODE) % PERIODE; return 360 * bezier(t / PERIODE); }

// Heure de la scene (0..24, 12 = midi) -> ticks du jour (0..24000) ; `jour` = numero du jour (phase de la lune)
export const ticksDepuisHeure = (heure) => ((((heure - 6) % 24) + 24) % 24) * 1000;

// ---------------------------------------------------------------- repere des astres
// Le jeu tourne le repere de -90 degres autour de Y puis de `angle` autour de X ; les astres sont a y = 100 dans ce repere.
// M(x, y, z) = ( -(y sin a + z cos a), y cos a - z sin a, x ) : base orthonormee ex = (0,0,1), n = (-sin a, cos a, 0), ez = (-cos a, -sin a, 0).
// `incl` (degres, shader) bascule la course autour de l'axe est-ouest (x) : positif = le soleil de midi passe au sud (+z).
export function reperes(angleDeg, inclDeg = 0) {
  const a = (angleDeg * Math.PI) / 180, s = Math.sin(a), c = Math.cos(a);
  let ex = [0, 0, 1], n = [-s, c, 0], ez = [-c, -s, 0];
  if (inclDeg) {
    const r = (inclDeg * Math.PI) / 180, cr = Math.cos(r), sr = Math.sin(r);
    const rot = (v) => [v[0], v[1] * cr - v[2] * sr, v[1] * sr + v[2] * cr];
    ex = rot(ex); n = rot(n); ez = rot(ez);
  }
  return { ex, n, ez };
}

// ---------------------------------------------------------------- generateur du jeu (java.util.Random) et champ d'etoiles
class JavaRandom {
  constructor(graine) { this.m = (1n << 48n) - 1n; this.s = (BigInt(graine) ^ 0x5deece66dn) & this.m; }
  next(bits) { this.s = (this.s * 0x5deece66dn + 0xbn) & this.m; return Number(BigInt.asIntN(32, this.s >> BigInt(48 - bits))); }
  nextFloat() { return this.next(24) / 16777216; }
  nextDouble() { return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992; }
}
let CHAMP = null;
// SkyRenderer.buildStars : graine 10842, 1500 essais, ceux dont le point tombe dans la sphere unite (hors du centre) restent.
// Retourne { n, dirs (Float32Array 3n, vecteurs unitaires dans le repere des astres), tailles (demi-cote d'un carre a 100 blocs) }.
export function champEtoiles() {
  if (CHAMP) return CHAMP;
  const r = new JavaRandom(10842);
  const d = [], t = [];
  for (let i = 0; i < 1500; i++) {
    const x = r.nextFloat() * 2 - 1, y = r.nextFloat() * 2 - 1, z = r.nextFloat() * 2 - 1;
    const taille = 0.15 + r.nextFloat() * 0.1;
    const l = x * x + y * y + z * z;
    if (l <= 0.010000001 || l >= 1) continue;
    r.nextDouble();   // rotation du carre sur lui-meme (inutile : le carre est trop petit pour que cela se voie)
    const k = 1 / Math.sqrt(l);
    d.push(x * k, y * k, z * k); t.push(taille);
  }
  return (CHAMP = { n: t.length, dirs: Float32Array.from(d), tailles: Float32Array.from(t) });
}

// ---------------------------------------------------------------- textures et donnees chargees depuis le kit
const PHASES = ['full_moon', 'waning_gibbous', 'third_quarter', 'waning_crescent', 'new_moon', 'waxing_crescent', 'first_quarter', 'waxing_gibbous'];

function lirePng(f) {
  try {
    const im = decoderPNG(fs.readFileSync(f));
    const rgba = Uint8Array.from(im.rgba);
    return { w: im.largeur, h: im.hauteur, data: new Uint32Array(rgba.buffer, 0, im.largeur * im.hauteur), rgba };
  } catch { return null; }
}

export class CielVanille {
  constructor(kitDir, couleursBiomes) {
    this.kitDir = kitDir;
    const env = path.join(kitDir, 'assets', 'minecraft', 'textures', 'environment');
    this.soleil = lirePng(path.join(env, 'celestial', 'sun.png'));
    this.lunes = PHASES.map((p) => lirePng(path.join(env, 'celestial', 'moon', p + '.png')));
    const nu = lirePng(path.join(env, 'clouds.png'));
    this.nuages = null;
    if (nu) { const c = new Uint8Array(nu.w * nu.h); for (let i = 0; i < c.length; i++) c[i] = nu.rgba[i * 4 + 3] >= 10 ? 1 : 0; this.nuages = { w: nu.w, h: nu.h, cells: c }; }
    this.dirBiomes = path.join(kitDir, 'data', 'minecraft', 'worldgen', 'biome');
    this.cacheBiome = new Map();
    this.biomes = couleursBiomes;
    this.stats = { soleil: !!this.soleil, lunes: this.lunes.filter(Boolean).length, nuages: !!this.nuages };
  }

  // couleurs de ciel et de brume d'un biome (attributs du jeu ; absentes : valeurs de la dimension)
  couleursBiome(nom) {
    nom = nom.replace(/^minecraft:/, '');
    let r = this.cacheBiome.get(nom);
    if (r) return r;
    let sky = CIEL_DEFAUT, fog = BRUME_DEFAUT;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(this.dirBiomes, nom + '.json'), 'utf8'));
      const a = j.attributes || {};
      const c = (v) => (typeof v === 'string' ? [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)] : null);
      sky = c(a['minecraft:visual/sky_color']) ?? sky; fog = c(a['minecraft:visual/fog_color']) ?? fog;
    } catch { /* biome inconnu : valeurs de la dimension */ }
    r = { sky, fog };
    this.cacheBiome.set(nom, r);
    return r;
  }

  // Couleurs de base autour de la camera : moyenne de 9 points (a +-12 blocs) des biomes de la zone (le jeu melange les biomes voisins).
  couleursCamera(zone, x, z) {
    const sky = [0, 0, 0], fog = [0, 0, 0];
    let n = 0;
    for (let dz = -12; dz <= 12; dz += 12) for (let dx = -12; dx <= 12; dx += 12) {
      const px = Math.min(zone.x0 + zone.sx - 1, Math.max(zone.x0, Math.floor(x + dx))), pz = Math.min(zone.z0 + zone.sz - 1, Math.max(zone.z0, Math.floor(z + dz)));
      const c = this.couleursBiome(zone.biome(px, pz));
      for (let k = 0; k < 3; k++) { sky[k] += c.sky[k]; fog[k] += c.fog[k]; }
      n++;
    }
    return { sky: sky.map((v) => v / n), fog: fog.map((v) => v / n) };
  }

  // Etat du ciel : { sky, fog (0..255, avant melange atmospherique), sunAngle, moonAngle, starAngle, starBrightness, sunrise [r,g,b 0..1, a], cloud [r,g,b,a 0..1], phase }
  //  ticks : tick du jour (0..24000) ; jour : numero du jour (phase de la lune) ; base : { sky, fog } du biome
  etat(ticks, jour = 0, base = { sky: CIEL_DEFAUT, fog: BRUME_DEFAUT }) {
    const mc = piste(PISTE_CIEL, ticks)[0], mf = piste(PISTE_BRUME, ticks), mn = piste(PISTE_NUAGE, ticks);
    const sunrise = piste(PISTE_LEVER, ticks);
    const sunAngle = angleSoleil(ticks);
    return {
      sky: base.sky.map((v) => v * mc), fog: base.fog.map((v, i) => v * mf[i]),
      sunAngle, moonAngle: 180 + sunAngle, starAngle: sunAngle,
      starBrightness: piste(PISTE_ETOILES, ticks)[0],
      sunrise, cloud: NUAGE_DEFAUT.map((v, i) => v * mn[i]),
      phase: ((Math.floor(jour) % 8) + 8) % 8,
    };
  }
}

// Brume atmospherique du jeu (FogRenderer) : la couleur de brume est tiree un peu vers celle du ciel, et vers la lueur du soleil quand on le regarde.
//  forwardX : composante x de la direction de la camera. Retourne [r,g,b] 0..255.
export function brumeAtmospherique(et, forwardX) {
  let fog = et.fog.slice();
  const alpha = et.sunrise[3];
  const sunX = Math.sin((et.sunAngle * Math.PI) / 180) > 0 ? -1 : 1;
  const looking = forwardX * sunX;
  if (looking > 0 && alpha > 0) { const t = looking * alpha; fog = fog.map((v, i) => v + (et.sunrise[i] * 255 - v) * t); }
  const finCiel = Math.min(32, RAYON_CIEL_CHUNKS);
  const mix = 1 - Math.pow(Math.min(1, Math.max(0, finCiel / 32)) * 0.75 + 0.25, 0.25);
  return fog.map((v, i) => v + (et.sky[i] - v) * mix);
}

// ---------------------------------------------------------------- nuages epais (CloudRenderer)
// Cellules de 12 blocs, epaisseur 4, bas a HAUTEUR_NUAGES ; la texture defile de 0,03 bloc par tick vers -x. Faces : dessus 1,0 ; dessous 0,7 ;
// nord/sud 0,8 ; ouest/est 0,9. Maillage "melange" (rayon en cellules autour de la camera), positions monde.
const OMBRES_NUAGE = [1, 0.7, 0.8, 0.9];
const TEX_BLANCHE = (() => { const rgba = new Uint8Array([255, 255, 255, 255]); return { largeur: 1, hauteur: 1, rgba }; })();
export function maillageNuages(ciel, cam, ticksMonde, etat, { rayon = 576, altitude = HAUTEUR_NUAGES, vitesse = 1, couleur = null, opacite = 1, plats = false, epaisseur = 4 } = {}) {
  const N = ciel.nuages;
  if (!N) return null;
  const dec = (((ticksMonde * vitesse) % (N.w * 400)) + N.w * 400) % (N.w * 400);
  const xs = cam.x + dec * 0.030000001, zs = cam.z + 3.96;
  const tw = N.w * 12, th = N.h * 12;
  const X = xs - Math.floor(xs / tw) * tw, Z = zs - Math.floor(zs / th) * th;
  const cx0 = Math.floor(X / 12), cz0 = Math.floor(Z / 12);
  const R = Math.ceil(rayon / 12);
  const bas = altitude - cam.y;   // hauteur du bas des nuages vue de la camera
  let [r, g, b, a] = etat.cloud;
  if (couleur) { r *= couleur[0]; g *= couleur[1]; b *= couleur[2]; }
  a = Math.min(1, a * opacite);
  if (a <= 0.004) return null;
  const pos = [], uv = [], col = [], ind = [];
  const plein = (cx, cz) => N.cells[(((cz % N.h) + N.h) % N.h) * N.w + (((cx % N.w) + N.w) % N.w)] === 1;
  const haut = bas <= 0, dessous = bas + epaisseur >= 0;
  let nq = 0;
  const quad = (p, ombre) => {
    for (const q of p) { pos.push(q[0], q[1], q[2]); col.push(r * ombre, g * ombre, b * ombre); uv.push(0.5, 0.5); }
    ind.push(nq, nq + 1, nq + 2, nq, nq + 2, nq + 3); nq += 4;
  };
  // origine monde de la cellule (cx0 + dx) : x = cam.x - (X - cx0 * 12) + dx * 12 ; meme chose pour z
  const ox = cam.x - (X - cx0 * 12), oz = cam.z - (Z - cz0 * 12), Y0 = altitude, Y1 = altitude + epaisseur;
  const dedans = bas <= 0 && bas + epaisseur >= 0;
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dz * dz > R * R) continue;
    const cx = cx0 + dx, cz = cz0 + dz;
    if (!plein(cx, cz)) continue;
    const x0 = ox + dx * 12, z0 = oz + dz * 12, x1 = x0 + 12, z1 = z0 + 12;
    if (plats) { quad([[x0, Y0, z0], [x0, Y0, z1], [x1, Y0, z1], [x1, Y0, z0]], 1); quad([[x1, Y0, z0], [x1, Y0, z1], [x0, Y0, z1], [x0, Y0, z0]], 1); continue; }
    if (haut) quad([[x0, Y1, z0], [x0, Y1, z1], [x1, Y1, z1], [x1, Y1, z0]], OMBRES_NUAGE[0]);
    if (dessous) quad([[x1, Y0, z0], [x1, Y0, z1], [x0, Y0, z1], [x0, Y0, z0]], OMBRES_NUAGE[1]);
    // cotes : visibles du cote de la camera, ou toutes si la camera est dans la couche (faces vues de l'interieur aussi)
    if ((dz > 0 || dedans) && !plein(cx, cz - 1)) quad([[x0, Y0, z0], [x0, Y1, z0], [x1, Y1, z0], [x1, Y0, z0]], OMBRES_NUAGE[2]);
    if ((dz < 0 || dedans) && !plein(cx, cz + 1)) quad([[x1, Y0, z1], [x1, Y1, z1], [x0, Y1, z1], [x0, Y0, z1]], OMBRES_NUAGE[2]);
    if ((dx > 0 || dedans) && !plein(cx - 1, cz)) quad([[x0, Y0, z1], [x0, Y1, z1], [x0, Y1, z0], [x0, Y0, z0]], OMBRES_NUAGE[3]);
    if ((dx < 0 || dedans) && !plein(cx + 1, cz)) quad([[x1, Y0, z0], [x1, Y1, z0], [x1, Y1, z1], [x1, Y0, z1]], OMBRES_NUAGE[3]);
  }
  if (!nq) return null;
  const rgba = new Uint8Array([255, 255, 255, Math.round(a * 255)]);
  return { positions: Float32Array.from(pos), uvs: Float32Array.from(uv), couleurs: Float32Array.from(col), indices: Uint32Array.from(ind), texture: { largeur: 1, hauteur: 1, rgba }, mode: 'melange', deuxFaces: false, nuage: true };
}
void TEX_BLANCHE;

// ---------------------------------------------------------------- assemblage pour le rasteriseur
const borne255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
// cv : CielVanille ; et : etat(...) ; cam : camera ; mods : modifications du shader (voir shader/ciel.js, modsCiel) ou null ;
// ticksMonde : temps du monde en ticks (nuages ; fige pendant `gel`). Retourne { vanille (parametre du rasteriseur), nuage (maillage ou null), couleurs: {zenith, horizon, bas} }.
// Meteo (docs/SIMULATION.md partie 13) : ciel et brume ternes sous la pluie et l'orage, etoiles et lever de soleil effaces, nuages sombres, flash blanc d'un eclair (45 % vers 0,8 0,8 1)
export function etatAvecMeteo(et, { pluie = 0, orage = 0, eclair = false } = {}) {
  if (!(pluie > 0 || orage > 0 || eclair)) return et;
  const niv = { pluie, orage };
  let sky = ternir(et.sky, niv), fog = ternir(et.fog, niv, true);
  if (eclair) { sky = sky.map((v, i) => v + ([204, 204, 255][i] - v) * 0.45); fog = fog.map((v, i) => v + ([204, 204, 255][i] - v) * 0.45); }
  const sombre = 1 - 0.45 * pluie - 0.3 * orage;
  return { ...et, sky, fog, starBrightness: et.starBrightness * (1 - pluie), sunrise: [et.sunrise[0], et.sunrise[1], et.sunrise[2], et.sunrise[3] * (1 - pluie)], cloud: [et.cloud[0] * sombre, et.cloud[1] * sombre, et.cloud[2] * sombre, et.cloud[3]], pluie };
}

// ---------------------------------------------------------------- monde de l'End (scene avec monde.dimension = "end")
// SkyRenderer.buildEndSky (Horizon gfx/end_sky.rs : MIT, voir ATTRIBUTIONS.md) : les 6 faces d'un cube a 100 blocs, texture environment/end_sky.png
// repetee 16 fois par face, teinte 0x282828 ; sky_color #000000 et fog_color #181318 (attributs du type de dimension the_end du jeu) ; pas de
// soleil, lune, etoiles, lueur ni nuages. EndFlashState (Horizon game/end.rs EndFlash) : toutes les 600 ticks, graine floor(t / 600) (java.util.Random),
// un tirage perdu, decalage 0..200, duree 100..min(380, 600 - decalage), angles x = f x 70 - 60, y = f x 360 - 180 ; intensite sin((t - decalage) x pi
// / duree) ; le sprite environment/celestial/end_flash (60 de demi-cote a 100 blocs) tourne vers l'eclair, et la lumiere du ciel (sky_light_factor) monte
// d'autant (d'un tiers sous la brume du dragon).
const BRUME_END = [0x18, 0x13, 0x18];
function intensiteEnd(t) {
  const s = Math.floor(t / 600), h = new Aleatoire(s);
  h.flottant();
  const decal = h.entierBorne(201), duree = h.entierBorne(Math.min(380, 600 - decal) - 100 + 1) + 100;
  const ax = h.flottant() * 70 - 60, ay = h.flottant() * 360 - 180;
  const k = ((t % 600) + 600) % 600;
  return { i: k >= decal && k <= decal + duree ? Math.fround(Math.sin(((k - decal) * Math.PI) / duree)) : 0, ax, ay, debut: s * 600 + decal };
}
// ticks (flottant) -> { intensite, ax, ay, debut (tick de depart de l'eclair) }
export function eclairEnd(ticks) {
  const k = Math.floor(ticks), u = ticks - k, a = intensiteEnd(k), b = intensiteEnd(k + 1);
  return { intensite: a.i + (b.i - a.i) * u, ax: a.ax, ay: a.ay, debut: a.debut };
}
export function cielEnd(cv, ticksMonde) {
  if (cv.ciel_end === undefined) {
    const env = path.join(cv.kitDir ?? '', 'assets', 'minecraft', 'textures', 'environment');
    cv.ciel_end = lirePng(path.join(env, 'end_sky.png')); cv.eclair_end = lirePng(path.join(env, 'celestial', 'end_flash.png'));
  }
  const e = eclairEnd(ticksMonde), astres = [];
  if (e.intensite > 1e-5 && cv.eclair_end) {
    // pose = rotation Y (180 - ay) x rotation X (-90 - ax), appliquee aux axes du sprite (x, y = 100, z)
    const a = ((180 - e.ay) * Math.PI) / 180, b = ((-90 - e.ax) * Math.PI) / 180;
    const R = ([x, y, z]) => { const y1 = y * Math.cos(b) - z * Math.sin(b), z1 = y * Math.sin(b) + z * Math.cos(b); return [x * Math.cos(a) + z1 * Math.sin(a), y1, -x * Math.sin(a) + z1 * Math.cos(a)]; };
    const I = Math.min(1, Math.max(0, e.intensite));
    astres.push({ n: R([0, 1, 0]), ex: R([1, 0, 0]), ez: R([0, 0, 1]), taille: 60, lune: false, tex: cv.eclair_end, mult: [I, I, I], rond: false, rayonRond: 30, couleur: [255, 255, 255], halo: 0, haloRayon: 0 });
  }
  const vanille = { sky: [0, 0, 0], fog: BRUME_END, bas: null, fin: RAYON_CIEL_CHUNKS * 16, sunrise: null, etoiles: null, astres, boiteEnd: cv.ciel_end ? { tex: cv.ciel_end, teinte: 0x28 / 255 } : null };
  return { vanille, nuage: null, couleurs: { zenith: [0, 0, 0], horizon: BRUME_END, bas: BRUME_END } };
}

export function construireCiel(cv, et, cam, mods, ticksMonde) {
  const m = mods || {};
  const teinte = m.teinte || [1, 1, 1], k = m.intensite ?? 1;
  const tint = (c) => c.map((v, i) => borne255(v * teinte[i] * k));
  const sky = tint(m.zenith || et.sky);
  const fogBase = tint(m.horizon || et.fog);
  const lueur = m.lueur ?? 1;
  const sr = et.sunrise.slice(); sr[3] = Math.min(1, sr[3] * lueur);
  const yaw = (cam.lacet * Math.PI) / 180, pit = (cam.tangage * Math.PI) / 180;
  const fx = -Math.sin(yaw) * Math.cos(pit);
  const fog = brumeAtmospherique({ ...et, sky, fog: fogBase, sunrise: sr }, fx);
  const bas = m.bas ? tint(m.bas) : null;
  const incl = m.incl || 0;
  const astres = [];
  const corps = (nom, angle, S0, tex, defCouleur, lune) => {
    const o = (m[nom] || { visible: true, taille: 1, rond: false, couleur: null, halo: 0, haloRayon: 8 });
    if (!o.visible) return;
    const { ex, n, ez } = reperes(angle, incl);
    if (n[1] < -0.7) return;
    const S = S0 * o.taille;
    astres.push({ n, ex, ez, taille: S, lune, tex: o.rond ? null : tex, mult: o.couleur || [1, 1, 1], rond: !!o.rond, rayonRond: S * 0.5, couleur: o.couleur ? o.couleur.map((v) => v * 255) : defCouleur, halo: o.halo, haloRayon: o.haloRayon });
  };
  corps('lune', et.moonAngle, 20, cv.lunes[m.phases === false ? 0 : et.phase], [224, 235, 255], true);
  corps('soleil', et.sunAngle, 30, cv.soleil, [255, 244, 216], false);
  // etoiles
  let etoiles = null;
  const E = m.etoiles || { dens: 1, lum: 1, couleur: [1, 1, 1] };
  if (et.starBrightness > 0.001 && E.dens > 0 && E.lum > 0) {
    const ch = champEtoiles(), { ex, n, ez } = reperes(et.starAngle, incl), nn = Math.round(ch.n * Math.min(1, E.dens));
    const d = new Float32Array(nn * 3);
    for (let i = 0; i < nn; i++) { const x = ch.dirs[i * 3], y = ch.dirs[i * 3 + 1], z = ch.dirs[i * 3 + 2]; d[i * 3] = x * ex[0] + y * n[0] + z * ez[0]; d[i * 3 + 1] = x * ex[1] + y * n[1] + z * ez[1]; d[i * 3 + 2] = x * ex[2] + y * n[2] + z * ez[2]; }
    etoiles = { n: nn, dirs: d, tailles: ch.tailles, lum: Math.min(1, et.starBrightness) * E.lum, couleur: E.couleur.map((v) => v * 255) };
  }
  const vanille = { sky, fog, bas, fin: RAYON_CIEL_CHUNKS * 16, sunrise: sr[3] > 0.001 ? { rgb: sr.slice(0, 3).map((v) => v * 255), a: sr[3], sgn: Math.sin((et.sunAngle * Math.PI) / 180) > 0 ? 1 : -1 } : null, etoiles, astres };
  let nuage = null;
  const N = m.nuages || { style: 'epais', altitude: HAUTEUR_NUAGES, vitesse: 1, couleur: null, opacite: 1 };
  if (N.style !== 'aucun') nuage = maillageNuages(cv, cam, ticksMonde, et, { altitude: N.altitude, vitesse: N.vitesse, couleur: N.couleur, opacite: N.opacite, plats: N.style === 'plats' });
  return { vanille, nuage, couleurs: { zenith: sky, horizon: fog, bas: bas || fog } };
}

// Lumiere du monde selon l'heure du jeu (pistes sky_light_factor et sky_light_color de day.json) : facteur par canal 0..1 a multiplier
// dans la couleur des sommets (1 le jour ; 0,24 x bleuté la nuit).
const PISTE_LUM_FACTEUR = [[730, [1]], [11270, [1]], [13140, [0.24]], [22860, [0.24]]];
const PISTE_LUM_COULEUR = [[730, [1, 1, 1]], [11270, [1, 1, 1]], [13140, [0x7a / 255, 0x7a / 255, 1]], [22860, [0x7a / 255, 0x7a / 255, 1]]];
// Couleur de la case (ciel 15, bloc 0) de la lightmap du jeu (Horizon, gfx.rs update_lightmap + lightmap.fsh) :
//   brut = ambient_light_color + sky_light_color * sky_light_factor     (ambient_light_color de l'overworld : #0a0a0a ; ciel 15 = courbe 1)
//   puis reglage de luminosite `gamma` (0 = Moody, 0,5 = defaut du jeu, 1 = Bright) : max = plus grand canal, notGamma = brut * (1 - (1-max)^4) / max,
//   resultat = brut + (notGamma - brut) * gamma. Le jour le brut depasse 1 : tout vaut 1, rien ne change. La nuit le plancher ambiant et le
//   reglage relevent la lumiere : bleu lisible, jamais noir. (Avant : facteur x couleur seulement, soit 0,24 : trop sombre.)
export const AMBIANT_OVERWORLD = 0x0a / 255;
export function lumiereMonde(ticks, gamma = 0.5) {
  const f = piste(PISTE_LUM_FACTEUR, ticks)[0], c = piste(PISTE_LUM_COULEUR, ticks);
  const brut = c.map((v) => Math.min(1, Math.max(0, AMBIANT_OVERWORLD + v * f)));
  const max = Math.max(...brut, 1e-6);
  const k = (1 - Math.pow(1 - max, 4)) / max;
  return brut.map((v) => v + (v * k - v) * gamma);
}

// Table de lumiere du jeu (la "lightmap" de 16 x 16 cases : niveau de ciel en ligne, niveau de bloc en colonne), au tick `ticks`.
// C'est lightmap.fsh du jeu, telle que Horizon la calcule (client-render/src/gfx.rs `update_lightmap` : MIT, voir ATTRIBUTIONS.md) :
//   luminosite(v) = v / (4 - 3v)
//   couleur = max(ambient_light_color, 0,6 x vision de nuit) + sky_light_color x luminosite(ciel) x sky_light_factor
//           + lerp(block_light_tint, blanc, 0,9 x (2 x bloc/15 - 1)^2) x luminosite(bloc) x (1,4 + scintillement)
//   puis bornee a 0..1 et reglage de luminosite `gamma` (0 = Moody, 0,5 = defaut du jeu, 1 = Bright) :
//   couleur = lerp(couleur, couleur x (1 - (1 - max)^4) / max, gamma).
// Les pistes sky_light_factor / sky_light_color viennent de day.json (le jour : 1 et blanc ; la nuit : 0,24 et #7a7aff), ambient_light_color
// de l'overworld (#0a0a0a), block_light_tint par defaut du jeu (#ffd88c : chaud). Le scintillement n'est pas simule (0).
// Rend { R, G, B } : trois Float32Array(256), indice ciel * 16 + bloc, valeurs 0..1.
export const TEINTE_BLOC = [0xff / 255, 0xd8 / 255, 0x8c / 255];
// Ajouts (partie 28) : vision nocturne (`nightVision` 0..1 : ambiance = max(ambient_light_color, 0,6 x vision)), assombrissement des boss
// (`boss` 0..1 : couleur melangee vers couleur x (0,7 ; 0,6 ; 0,6)), `obscurite` retiree, puis bornee ; monde de l'End (`dimension: 'end'`) :
// attributs du type de dimension the_end du jeu (ambient_light_color #3f473f, sky_light_color #ac60cd, sky_light_factor 0).
export const AMBIANT_END = [0x3f / 255, 0x47 / 255, 0x3f / 255], CIEL_END = [0xac / 255, 0x60 / 255, 0xcd / 255];
export function tableLumiere(ticks, gamma = 0.5, { flicker = 0, nightVision = 0, facteurCiel = 1, boss = 0, obscurite = 0, dimension = 'overworld', eclairEnd = 0 } = {}) {
  const end = dimension === 'end';
  const f = end ? eclairEnd : piste(PISTE_LUM_FACTEUR, ticks)[0] * facteurCiel, sc = end ? CIEL_END : piste(PISTE_LUM_COULEUR, ticks);
  const R = new Float32Array(256), G = new Float32Array(256), B = new Float32Array(256);
  const lum = (v) => v / (4 - 3 * v);
  const ambB = end ? AMBIANT_END : [AMBIANT_OVERWORLD, AMBIANT_OVERWORLD, AMBIANT_OVERWORLD], amb = ambB.map((a) => Math.max(a, 0.6 * nightVision));
  const ASS = [0.7, 0.6, 0.6];
  for (let s = 0; s < 16; s++) {
    for (let b = 0; b < 16; b++) {
      const lb = b / 15, ls = s / 15;
      const sk = lum(ls) * f, bk = lum(lb) * (1.4 + flicker);
      const par = (2 * lb - 1) ** 2;
      const bc = TEINTE_BLOC.map((t) => t + (1 - t) * 0.9 * par);
      const c = [0, 1, 2].map((k) => { let v = amb[k] + sc[k] * sk + bc[k] * bk; if (boss) v += (v * ASS[k] - v) * boss; return Math.min(1, Math.max(0, v - obscurite)); });
      const max = Math.max(...c, 1e-6), k = (1 - Math.pow(1 - max, 4)) / max;
      R[s * 16 + b] = c[0] + (c[0] * k - c[0]) * gamma; G[s * 16 + b] = c[1] + (c[1] * k - c[1]) * gamma; B[s * 16 + b] = c[2] + (c[2] * k - c[2]) * gamma;
    }
  }
  return { R, G, B };
}
