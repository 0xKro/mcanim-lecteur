// Effets VISIBLES du monde simule, dessines comme maillages dynamiques a chaque image (le jeu les dessine avec du code, pas avec des blocs) :
//   - coffres : le vrai modele du jeu (socle, couvercle, serrure) ; le couvercle s'ouvre selon les visiteurs (ChestLidController : +-0,1 par tick,
//     angle = 1 - (1 - o)^3 x 90 degrees) ; la texture est celle du kit (entity/chest/*.png)
//   - cloches : le corps (bell_body) oscille apres un coup (BellRenderer : sin(f / pi) / (4 + f / 3), 50 ticks)
//   - fissures de casse : texture destroy_stage_0..9 sur les boites du bloc (etape = progression x 10)
//   - particules : morceaux de bloc (4x4x4, gravite, duree 4 a 40 ticks, 1/4 de la texture), notes ; physique de Particle.tick du jeu
// Tout est lu dans le replay (evenements de blocs et particules) : meme replay = memes images. Aucun hasard hors de moteur/aleatoire.js.
import fs from 'node:fs';
import path from 'node:path';
import { decoderPNG } from '../rendu/png.js';
import { Aleatoire } from '../moteur/aleatoire.js';
import { deplacerBoite } from '../moteur/collision.js';
import { creerMeteoRendu } from './meteo-rendu.js';   // pluie, neige, foudre
import { creerEntites } from './entites-monde.js';   // TNT amorce, blocs qui tombent (vrai modele), objets au sol
import { creerMachinesRendu } from './machines-rendu.js';
import { creerBlocsEntites } from './blocs-entites.js';   // tetes, pots decores, texte des panneaux
import { creerEntitesDecor } from './entites-decor.js';   // entites des constructions importees   // faisceau de balise, cadres, livre du pupitre (partie 27)
import { Creature, mul, T, S, RX, RY } from '../creatures/rendu.js';   // fantome du gardien ancien (ElderGuardianParticle)
import { etatInitial } from '../creatures/anim.js';

const RAD = Math.PI / 180;
const OMBRE = { haut: 1.0, bas: 0.5, nord: 0.8, sud: 0.8, ouest: 0.6, est: 0.6 };
const VERS_Y = { south: 0, west: 90, north: 180, east: 270 };            // Direction.toYRot
const DIRS3D = ['down', 'up', 'north', 'south', 'west', 'east'];

// ---------------------------------------------------------------- boites de modele d'entite (depliage standard d'une boite du jeu)
// Boite px [x0,y0,z0,x1,y1,z1] (y vers le haut, avant = +z), texture (largeur, hauteur) ; (u, v) = coin de depart du depliage. Rend 6 faces : positions, uv.
function facesBoite(b, u, v, TW, TH) {
  const [x0, y0, z0, x1, y1, z1] = b, w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const F = (nom, coins, a, c, e, f) => ({ nom, coins, uv: [[a, c], [e, c], [e, f], [a, f]].map(([s, t]) => [s / TW, t / TH]) });   // coins : HG, HD, BD, BG vus de l'exterieur
  return [
    F('sud', [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]], u + d, v + d, u + d + w, v + d + h),
    F('nord', [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]], u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h),
    F('ouest', [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]], u, v + d, u + d, v + d + h),
    F('est', [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]], u + d + w, v + d, u + 2 * d + w, v + d + h),
    F('haut', [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], u + d, v, u + d + w, v + d),
    F('bas', [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], u + d + w, v, u + d + 2 * w, v + d),
  ];
}

// Boite d'un modele de bloc a entite dessine SANS retournement (ChestRenderer : pas de scale(-1, -1, 1) comme les entites) : les faces et
// les uv du ModelPart.Cube de Java tels que entity-models.json du jeu 26.3 les donne (chest#main : y = 0 prend la case "down" (u+d, v), les
// cotes ont y = 0 en haut de leur case, le nord est la case (u+d, v+d)). Coins rendus dans l'ordre de Constructeur (sens horaire vu de dehors).
export function facesCubeJava(b, u, v, TW, TH) {
  const [x0, y0, z0, x1, y1, z1] = b, w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const f4 = u, f5 = u + d, f6 = u + d + w, f7 = u + d + w + w, f8 = u + d + w + d, f9 = u + d + w + d + w, f10 = v, f11 = v + d, f12 = v + d + h;
  const F = (nom, pts) => { const r = pts.slice().reverse(); return { nom, coins: r.map((p) => [p[0], p[1], p[2]]), uv: r.map((p) => [p[3] / TW, p[4] / TH]) }; };
  return [
    F('bas', [[x1, y0, z1, f6, f10], [x0, y0, z1, f5, f10], [x0, y0, z0, f5, f11], [x1, y0, z0, f6, f11]]),
    F('haut', [[x1, y1, z0, f7, f11], [x0, y1, z0, f6, f11], [x0, y1, z1, f6, f10], [x1, y1, z1, f7, f10]]),
    F('ouest', [[x0, y0, z0, f5, f11], [x0, y0, z1, f4, f11], [x0, y1, z1, f4, f12], [x0, y1, z0, f5, f12]]),
    F('nord', [[x1, y0, z0, f6, f11], [x0, y0, z0, f5, f11], [x0, y1, z0, f5, f12], [x1, y1, z0, f6, f12]]),
    F('est', [[x1, y0, z1, f8, f11], [x1, y0, z0, f6, f11], [x1, y1, z0, f6, f12], [x1, y1, z1, f8, f12]]),
    F('sud', [[x0, y0, z1, f9, f11], [x1, y0, z1, f8, f11], [x1, y1, z1, f8, f12], [x0, y1, z1, f9, f12]]),
  ];
}

class Constructeur {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; }
  quad(coins, uvs, couleur) {
    const b = this.pos.length / 3;
    for (let i = 0; i < 4; i++) { this.pos.push(...coins[i]); this.uv.push(...uvs[i]); this.col.push(couleur, couleur, couleur); }
    this.idx.push(b, b + 3, b + 2, b, b + 2, b + 1);     // HG, BG, BD / HG, BD, HD : sens direct vu de l'exterieur
  }
  vide() { return this.idx.length === 0; }
  maillage(texture, mode = 'decoupe', extra = {}) {
    return { positions: Float32Array.from(this.pos), uvs: Float32Array.from(this.uv), couleurs: Float32Array.from(this.col), indices: Uint32Array.from(this.idx), texture, mode, ...extra };
  }
}

// rotations (angle en radians) autour d'un pivot [px,py,pz] : X (le couvercle), Z, Y ; operent sur [x,y,z]
const rotX = (p, a, [cx, cy, cz]) => { const y = p[1] - cy, z = p[2] - cz, c = Math.cos(a), s = Math.sin(a); return [p[0], cy + y * c + z * s, cz - y * s + z * c]; };
const rotZ = (p, a, [cx, cy]) => { const x = p[0] - cx, y = p[1] - cy, c = Math.cos(a), s = Math.sin(a); return [cx + x * c - y * s, cy + x * s + y * c, p[2]]; };
const rotYcentre = (p, deg) => { const a = deg * RAD, x = p[0] - 8, z = p[2] - 8, c = Math.cos(a), s = Math.sin(a); return [8 + x * c + z * s, p[1], 8 - x * s + z * c]; };

// Matrice (monde) du fantome du gardien ancien a la fraction f (0..1) de ses 30 ticks : ElderGuardianParticle.renderCustom, dans le repere
// de la camera (x a droite, y en haut, -z devant) : rotate(camera.rotation()) . Rx(60 - 150 f) . scale(1/2,35, -1/2,35, -1/2,35)
// . translate(0, -0,56, 3,5), puis le modele cuit du gardien ancien (racine a l'echelle 2,35, comme le calque ELDER_GUARDIAN du jeu), SANS le T(0, -1,501, 0) des entites.
// Le jeu fait scale(1, -1, -1) (pas 1/2,35) : avec 1/2,35, le gardien etait a 1 bloc de la camera, vu presque de l'interieur (signale par le proprietaire).
// camera.rotation() = Ry(180 - lacet) . Rx(-tangage) (Camera.setRotation). Le gardien regarde la camera (son oeil, -z du modele, vient
// vers elle), tete en haut, pas en miroir (scale(1, -1, -1) = Ry(180) . scale(-1, -1, 1) du rendu normal) ; il passe d'au-dessus
// (60 degres) a devant (f = 0,4) puis en dessous (-90 degres) en tournant autour de la camera.
export function matriceFantome(camera, f) {
  const k = 1;   // ElderGuardianParticle : scale(1, -1, -1) ; le modele garde sa taille de gardien ancien (2,35)
  const rot = mul(RY((180 - camera.lacet) * RAD), RX(-camera.tangage * RAD));
  return mul(mul(mul(mul(T(camera.x, camera.y, camera.z), rot), RX((60 - 150 * f) * RAD)), S(k, -k, -k)), T(0, -0.56, 3.5));
}

export function creerEffetsMonde({ rs, scene, sim, kit, donnees, terrain, creatures: creaturesDonnees = null }) {
  const replay = sim.replay, zone = rs.zone, notes = [];
  const palette = [...zone.palette, ...replay.palAjouts];
  const dirTex = path.join(kit, 'assets', 'minecraft', 'textures');
  const pngs = new Map();
  const png = (rel) => { if (!pngs.has(rel)) { try { pngs.set(rel, decoderPNG(fs.readFileSync(path.join(dirTex, ...rel.split('/'))))); } catch { pngs.set(rel, null); notes.push(`texture ${rel} absente du kit : effet non dessine`); } } return pngs.get(rel); };
  const texOf = (rel) => { const p = png(rel); return p ? { largeur: p.largeur, hauteur: p.hauteur, rgba: p.rgba } : null; };

  // ---------------------------------------------------------------- instances de blocs a entite (coffres, cloches) : zone de depart + journal
  const estCoffre = (s) => /^minecraft:(chest|trapped_chest|ender_chest)(\[|$)/.test(s);
  const estCloche = (s) => /^minecraft:bell(\[|$)/.test(s);
  const interessants = new Set(); palette.forEach((s, i) => { if (estCoffre(s) || estCloche(s)) interessants.add(i); });
  const instances = [], actives = new Map();
  const propsDe = (s) => { const o = {}; const i = s.indexOf('['); if (i >= 0) for (const kv of s.slice(i + 1, -1).split(',')) { const [k, v] = kv.split('='); o[k] = v; } return o; };
  const ajouter = (x, y, z, idx, debut) => {
    const s = palette[idx], I = { x, y, z, debut, fin: Infinity, etat: s, props: propsDe(s), genre: estCoffre(s) ? 'coffre' : 'cloche', nom: s.replace(/^minecraft:/, '').replace(/\[.*/, '') };
    instances.push(I); actives.set(`${x},${y},${z}`, I);
  };
  if (interessants.size) {
    const { sx, sy, sz, x0, y0, z0, cellules } = zone;
    for (let i = 0; i < cellules.length; i++) {
      if (!interessants.has(cellules[i])) continue;
      const lx = i % sx, t = (i - lx) / sx, lz = t % sz, ly = (t - lz) / sz;
      ajouter(x0 + lx, y0 + ly, z0 + lz, cellules[i], -1);
    }
    void sy;
  }
  const J = replay.blocs;
  for (let k = 0; k < replay.nbBlocs; k++) {
    const tick = J[k * 6], x = J[k * 6 + 1], y = J[k * 6 + 2], z = J[k * 6 + 3], nou = J[k * 6 + 5], cle = `${x},${y},${z}`;
    const a = actives.get(cle);
    if (a && palette[nou] === a.etat) continue;
    if (a) { a.fin = tick; actives.delete(cle); }
    if (interessants.has(nou)) ajouter(x, y, z, nou, tick);
  }
  // evenements de blocs a entite : par cellule
  const B = replay.blocsEntite, evParCellule = new Map();
  for (let i = 0; i < B.length / 8; i++) {
    const tick = B[i * 8], x = B[i * 8 + 1], y = B[i * 8 + 2], z = B[i * 8 + 3], type = replay.noms[B[i * 8 + 4]], a = B[i * 8 + 5];
    const cle = `${type}|${x},${y},${z}`;
    if (!evParCellule.has(cle)) evParCellule.set(cle, []);
    evParCellule.get(cle).push({ tick, a });
  }
  const evs = (type, x, y, z) => evParCellule.get(`${type}|${x},${y},${z}`) || [];

  // couvercle d'un coffre : ouverture par tick (0..1), tous les ticks de la scene (ChestLidController)
  const T = replay.ticks;
  const calculerOuverture = (I) => {
    const cellules = [[I.x, I.y, I.z]];
    if (I.props.type === 'left' || I.props.type === 'right') {   // coffre double : le partenaire partage les visiteurs
      const f = I.props.facing, horaire = { north: 'east', east: 'south', south: 'west', west: 'north' }, anti = { north: 'west', west: 'south', south: 'east', east: 'north' };
      const d = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[I.props.type === 'left' ? horaire[f] : anti[f]];
      cellules.push([I.x + d[0], I.y, I.z + d[1]]);
    }
    const E = cellules.flatMap(([x, y, z]) => evs('coffre', x, y, z)).sort((p, q) => p.tick - q.tick);
    const o = new Float32Array(T + 2);
    let i = 0, visiteurs = 0, ouv = 0;
    for (let t = 0; t <= T + 1; t++) {
      while (i < E.length && E[i].tick <= t) visiteurs = E[i++].a;
      if (visiteurs === 0 && ouv > 0) ouv = Math.max(ouv - 0.1, 0); else if (visiteurs > 0 && ouv < 1) ouv = Math.min(ouv + 0.1, 1);
      o[t] = ouv;
    }
    return o;
  };

  // ---------------------------------------------------------------- lumiere d'un point
  const lum = (x, y, z) => (typeof rs.luminositeEn === 'function' ? rs.luminositeEn(x, y, z) : 1);

  // ---------------------------------------------------------------- coffres
  const texCoffre = (I) => {
    const base = I.nom === 'ender_chest' ? 'ender' : I.nom === 'trapped_chest' ? 'trapped' : 'normal';
    const suffixe = I.props.type === 'left' ? '_left' : I.props.type === 'right' ? '_right' : '';
    return `entity/chest/${base}${base === 'ender' ? '' : suffixe}.png`;
  };
  const maillageCoffre = (I, o) => {
    const rel = texCoffre(I), tx = texOf(rel);
    if (!tx) return null;
    const lissage = 1 - Math.pow(1 - o, 3), alpha = lissage * Math.PI / 2;
    const gauche = I.props.type === 'left', droit = I.props.type === 'right';
    // corps : 14 de large ; moitie de coffre double : 15, au ras de l'autre moitie (entity-models.json du jeu 26.3 : double_chest_left#main
    // bas 0..15, serrure 0..1 ; double_chest_right#main bas 1..16, serrure 15..16 ; l'autre moitie de `left` est a sa gauche vue de face)
    const xa = gauche ? 0 : 1, xb = droit ? 16 : 15;
    const yaw = VERS_Y[I.props.facing] ?? 0;
    const C = new Constructeur();
    const lum0 = lum(I.x + 0.5, I.y + 0.5, I.z + 0.5);
    const sans = gauche ? 'ouest' : droit ? 'est' : null;   // coffre double : la face contre l'autre moitie n'existe pas (5 faces par piece dans le modele)
    const piece = (boite, u, v, pivotLid) => {
      // uv : depliage du Cube de Java en coordonnees LOCALES de la piece (le couvercle et la serrure sont definis autour du pivot (0, 9, 1))
      const loc = pivotLid ? [boite[0], boite[1] - 9, boite[2] - 1, boite[3], boite[4] - 9, boite[5] - 1] : boite;
      for (const f0 of facesCubeJava(loc, u, v, tx.largeur, tx.hauteur)) {
        if (f0.nom === sans) continue;
        const f = pivotLid ? { ...f0, coins: f0.coins.map((p) => [p[0], p[1] + 9, p[2] + 1]) } : f0;
        const coins = f.coins.map((p) => {
          let q = p;
          if (pivotLid) q = rotX(q, alpha, [0, 9, 1]);
          q = rotYcentre(q, -yaw);                                          // ChestRenderer : rotation de -toYRot autour du centre du bloc
          return [I.x + q[0] / 16, I.y + q[1] / 16, I.z + q[2] / 16];
        });
        C.quad(coins, f.uv, OMBRE[f.nom] * lum0);
      }
    };
    // ChestModel du jeu 26.3 (entity-models.json : chest#main, double_chest_left#main, double_chest_right#main) : boites et origines UV de
    // chaque piece (origines uv 0,19 / 0,0 / 0,0 pour les trois formes, textures _left et _right)
    const uvG = 0;
    piece([xa, 0, 1, xb, 10, 15], uvG, 19, false);                        // socle
    piece([xa, 9, 1, xb, 14, 15], uvG, 0, true);                          // couvercle (pivot y 9, z 1)
    const sx = gauche ? [0, 1] : droit ? [15, 16] : [7, 9];
    piece([sx[0], 7, 15, sx[1], 11, 16], 0, 0, true);        // serrure : y -2..2 autour du pivot du couvercle (7..11), suit le couvercle
    return C.maillage(tx, 'decoupe', { genre: 'bloc', bloc: 'minecraft:' + I.nom });   // genre : pour le chemin GPU (programme et blockEntityId)
  };

  // ---------------------------------------------------------------- cloches
  const sonneries = new Map();
  const ouvertureCloche = (I, u) => {   // u : tick du monde fractionnaire ; rend { x, z } rotation du corps (radians) ou null
    let L = sonneries.get(`${I.x},${I.y},${I.z}`);
    if (!L) { L = evs('cloche', I.x, I.y, I.z); sonneries.set(`${I.x},${I.y},${I.z}`, L); }
    let r = null;
    for (const e of L) { if (e.tick <= u) r = e; else break; }
    if (!r) return null;
    const f = u - r.tick;
    if (f >= 50) return null;
    const i = Math.sin(f / Math.PI) / (4 + f / 3), d = DIRS3D[r.a];
    return { x: d === 'north' ? -i : d === 'south' ? i : 0, z: d === 'east' ? -i : d === 'west' ? i : 0 };
  };
  const maillageCloche = (I, rot) => {
    const tx = texOf('entity/bell/bell_body.png');
    if (!tx) return null;
    const C = new Constructeur(), lum0 = lum(I.x + 0.5, I.y + 0.5, I.z + 0.5);
    const pivot = [8, 12, 8];
    const piece = (boite, u, v) => {
      for (const f of facesBoite(boite, u, v, tx.largeur, tx.hauteur)) {
        const coins = f.coins.map((p) => {
          let q = rotX(p, rot.x, pivot); q = rotZ(q, rot.z, pivot);
          return [I.x + q[0] / 16, I.y + q[1] / 16, I.z + q[2] / 16];
        });
        C.quad(coins, f.uv, OMBRE[f.nom] * lum0);
      }
    };
    piece([5, 6, 5, 11, 13, 11], 0, 0);      // corps
    piece([4, 4, 4, 12, 6, 12], 0, 13);      // evasement du bas
    return C.maillage(tx, 'decoupe', { genre: 'bloc', bloc: 'minecraft:bell' });
  };

  // ---------------------------------------------------------------- fissures de casse
  const fiss = new Map();   // cellule -> [{ tick, etape }]
  for (let i = 0; i < B.length / 8; i++) {
    if (replay.noms[B[i * 8 + 4]] !== 'fissure') continue;
    const cle = `${B[i * 8 + 1]},${B[i * 8 + 2]},${B[i * 8 + 3]}`;
    if (!fiss.has(cle)) fiss.set(cle, []);
    fiss.get(cle).push({ tick: B[i * 8], etape: B[i * 8 + 5] });
  }
  const texFiss = [];
  const textureFissure = (n) => {
    if (texFiss[n] === undefined) {
      const p = png(`block/destroy_stage_${n}.png`);
      if (!p) texFiss[n] = null;
      else {   // fissures sombres : le jeu multiplie la couleur ; ici gris fonce a demi transparent
        const rgba = new Uint8Array(p.rgba.length);
        for (let i = 0; i < rgba.length; i += 4) { const a = p.rgba[i + 3]; const g = a > 8 ? p.rgba[i] * 0.45 : 0; rgba[i] = g; rgba[i + 1] = g; rgba[i + 2] = g; rgba[i + 3] = a > 8 ? 235 : 0; }
        texFiss[n] = { largeur: p.largeur, hauteur: p.hauteur, rgba };
      }
    }
    return texFiss[n];
  };
  const maillageFissure = (x, y, z, etape, tick) => {
    const tx = textureFissure(etape);
    if (!tx) return null;
    terrain?.regle?.(tick);
    const e = donnees ? donnees.etatId(terrain?.bloc ? String(terrain.bloc(x, y, z)) : 'minecraft:stone') : -1;
    const boites = e >= 0 && donnees.boites(e).length ? donnees.boites(e) : [[0, 0, 0, 1, 1, 1]];
    const C = new Constructeur(), g = 0.003;
    for (const b of boites) {
      const [x0, y0, z0, x1, y1, z1] = [b[0] - g + x, b[1] - g + y, b[2] - g + z, b[3] + g + x, b[4] + g + y, b[5] + g + z];
      const F = [
        [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]], [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]],
        [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]], [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]],
        [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]],
      ];
      for (const f of F) C.quad(f, [[0, 0], [1, 0], [1, 1], [0, 1]], 1);
    }
    return C.maillage(tx, 'melange', { deuxFaces: false, genre: 'fissure' });
  };

  // ---------------------------------------------------------------- particules (Particle.tick du jeu)
  const particules = creerParticules({ rs, replay, kit, donnees, terrain, texOf, lum, notes });
  const entites = creerEntites({ rs, replay, kit, texOf, lum, notes, creatures: creaturesDonnees });
  const machines = creerMachinesRendu({ rs, replay, kit, texOf, lum, creatures: creaturesDonnees, notes });   // balise, cadres, livre du pupitre (partie 27) ; null sans eux   // TNT amorce, blocs qui tombent, objets au sol
  const meteoR = creerMeteoRendu({ rs, replay, scene, donnees, terrain, texOf, lum });   // pluie, neige, foudre (null sans meteo ni foudre)
  const blocsE = creerBlocsEntites({ rs, replay, kit, texOf, lum, scene, notes });   // tetes, pots decores, texte des panneaux (null sans eux)
  const entitesD = creerEntitesDecor({ rs, replay, kit, texOf, lum, scene, creatures: creaturesDonnees, notes });   // constructions importees : geniteurs, statues, tableaux, noeuds, coussins, objets poses
  // malediction du gardien ancien (ElderGuardianParticle) : 30 ticks, le modele du gardien ancien dans le repere de la camera (voir
  // matriceFantome), opacite 0,05 + 0,5 x sin(f x pi)
  const fantomes = [];
  { const P = replay.particules; for (let i = 0; i < P.length; i += 9) if (replay.noms[P[i + 1]] === 'elder_guardian') fantomes.push(P[i]); }
  let ancien = null;
  if (fantomes.length && creaturesDonnees) { try { ancien = new Creature({ type: 'elder_guardian' }, creaturesDonnees, kit); } catch { ancien = null; } }
  const transparents = new Map();
  const transparent = (t, a) => { const k = Math.round(a * 50); let c = transparents.get(t); if (!c) transparents.set(t, (c = new Map())); if (!c.has(k)) { const rgba = new Uint8Array(t.rgba); for (let i = 3; i < rgba.length; i += 4) rgba[i] = Math.round(rgba[i] * k / 50); c.set(k, { largeur: t.largeur, hauteur: t.hauteur, rgba }); } return c.get(k); };
  // piques sorties comme sur les images du jeu (wiki : piques longues autour du corps)
  const etatGhost = () => { const m = etatInitial('elder_guardian'); m.anim.v[2] = 1; m.anim.vo[2] = 1; return m; };
  function fantomeAncien(u, camera) {
    if (!ancien) return [];
    const t0 = fantomes.filter((t) => u >= t && u < t + 30).pop();
    if (t0 === undefined) return [];
    const f = (u - t0) / 30, alpha = 0.05 + 0.5 * Math.sin(f * Math.PI);
    const pose = { x: camera.x, y: camera.y, z: camera.z, matrice: matriceFantome(camera, f), age: u,
      creature:{ cacher: [], s: { pos: 0, speed: 0, age: u, yRot: 0, xRot: 0, swing: 0, baby: false, partial: 0 }, m: etatGhost(), parties: {} } };
    // faces arriere cachees : sinon, en transparence, on voit l'interieur de la boite (parois qui fuient vers l'oeil, signale par le
    // proprietaire). Les quads du modele sont tournes dans le sens que le rendu cache pour cette matrice : on inverse chaque triangle.
    return ancien.maillage(pose, 1).map((m) => {
      const ind = new Uint32Array(m.indices);
      for (let i = 0; i < ind.length; i += 3) { const a = ind[i + 1]; ind[i + 1] = ind[i + 2]; ind[i + 2] = a; }
      return { ...m, indices: ind, texture: transparent(m.texture, alpha), mode: 'melange', deuxFaces: false, exempt: true };
    });
  }

  // ---------------------------------------------------------------- une image
  return {
    notes, meteo: meteoR,
    nbCoffres: instances.filter((i) => i.genre === 'coffre').length, nbCloches: instances.filter((i) => i.genre === 'cloche').length,
    // maillages dynamiques pour l'image de temps `tm` (secondes du monde) ; `camera` : pour les particules (face a la camera)
    maillages(tm, camera) {
      const u = Math.max(0, tm * 20 * replay.ralenti), tick = Math.floor(u), out = [];
      for (const I of instances) {
        if (tick < I.debut || tick >= I.fin) continue;
        if (I.genre === 'coffre') {
          if (!I.ouverture) I.ouverture = calculerOuverture(I);
          const f = u - tick, o = I.ouverture[Math.min(tick, T)] + (I.ouverture[Math.min(tick + 1, T + 1)] - I.ouverture[Math.min(tick, T)]) * f;
          const m = maillageCoffre(I, o); if (m) out.push(m);
        } else {
          const r = ouvertureCloche(I, u);
          const m = maillageCloche(I, r || { x: 0, z: 0 }); if (m) out.push(m);
        }
      }
      for (const [cle, L] of fiss) {
        let e = -1, t0 = 0;
        for (const q of L) { if (q.tick <= u) { e = q.etape; t0 = q.tick; } else break; }
        if (e < 0) continue;
        const [x, y, z] = cle.split(',').map(Number);
        const m = maillageFissure(x, y, z, Math.min(9, e), t0); if (m) out.push(m);
      }
      out.push(...entites.maillages(u, camera));
      if (machines) out.push(...machines.maillages(u, camera));
      out.push(...particules.maillages(u, camera));
      if (fantomes.length && camera) out.push(...fantomeAncien(u, camera));
      if (meteoR) out.push(...meteoR.maillages(tm, camera));
      if (blocsE) out.push(...blocsE.maillages(u));
      if (entitesD) out.push(...entitesD.maillages(u));
      return out;
    },
  };
}

// ---------------------------------------------------------------- etincelles des feux d'artifice (FireworkParticles.SparkParticle, Horizon particles.rs `spark`)
// gravite 0,1, frottement 0,91, taille 0,1 x (r x 0,5 + 0,5) x 2 x 0,75, 48 a 59 ticks, pleine lumiere, images spark_7..spark_0 (firework.json du jeu)
function etincelle(alea, tick, x, y, z, v, couleur, fondu, trainee, scintille) {
  return { type: 'anim', pref: 'particle/spark_', n: 8, inverse: true, jeu: true, etincelle: true, debut: tick, x, y, z, xd: v[0], yd: v[1], zd: v[2], age: 0, duree: 48 + alea.entierBorne(12), taille: 0.1 * (alea.flottant() * 0.5 + 0.5) * 2 * 0.75, gravite: 0.1, friction: 0.91, sol: false, uo: 0, vo: 0, couleur, fondu, trainee, scintille, alpha: 0.99, plein: true, alea };
}
// formes de FireworkParticles.Starter (etoile, tete de creeper)
const ETOILE = [[0.0, 1.0], [0.3455, 0.309], [0.9511, 0.309], [0.3795918367346939, -0.12653061224489795], [0.6122448979591837, -0.8040816326530612], [0.0, -0.35918367346938773]];
const CREEPER = [[0.0, 0.2], [0.2, 0.2], [0.2, 0.6], [0.6, 0.6], [0.6, 0.2], [0.2, 0.2], [0.2, 0.0], [0.4, 0.0], [0.4, -0.6], [0.2, -0.6], [0.2, -0.4], [0.0, -0.4]];

// ---------------------------------------------------------------- particules
function creerParticules({ rs, replay, kit, donnees, terrain, texOf, lum, notes }) {
  const P = replay.particules, n = P.length / 9;
  const lecteur = terrain?.lec ?? null;
  const textures = new Map();
  const texPart = (nom) => {   // 'block/dirt' -> texture rgba ; 'particle/note' ...
    if (!textures.has(nom)) textures.set(nom, texOf(nom + '.png'));
    return textures.get(nom);
  };
  const alphas = new Map();
  const texAlpha = (nom, a) => {   // copie de la texture, alpha x a (etincelles et eclair des feux d'artifice : rendu translucide du jeu)
    const cle = nom + '@' + a;
    if (!alphas.has(cle)) { const t = texPart(nom); if (!t) alphas.set(cle, null); else { const rgba = new Uint8Array(t.rgba); for (let i = 3; i < rgba.length; i += 4) rgba[i] = Math.round(rgba[i] * Math.min(1, a)); alphas.set(cle, { largeur: t.largeur, hauteur: t.hauteur, rgba }); } }
    return alphas.get(cle);
  };
  const texDeBloc = (chaine) => {
    let nom = null;
    try { nom = rs.modeles.texParticule(chaine); } catch { nom = null; }
    nom = (nom || '').replace(/^minecraft:/, '');
    if (nom && texPart(nom)) return nom;
    const court = chaine.replace(/^minecraft:/, '').replace(/\[.*/, '');
    for (const c of [`block/${court}`, `block/${court.replace(/_(stairs|slab|fence|fence_gate|button|pressure_plate|wall)$/, '')}_planks`, `block/${court.replace(/_(stairs|slab|wall)$/, '')}`]) if (texPart(c)) return c;
    return null;
  };
  // particules vivantes : tableaux par particule
  let etat = null;
  const reset = () => { etat = { tick: -1, liste: [], prochain: 0, nouvelles: [] }; };
  reset();
  const jeter = (nom, msg) => { if (!notes.includes(msg)) notes.push(msg); void nom; };

  const creer = (idx) => {   // enregistrement idx -> particules (ParticleEngine.destroy / NoteParticle)
    const tick = P[idx * 9], nom = replay.noms[P[idx * 9 + 1]], x = P[idx * 9 + 2], y = P[idx * 9 + 3], z = P[idx * 9 + 4], vx = P[idx * 9 + 5], N = P[idx * 9 + 8];
    const alea = new Aleatoire(((replay.graine * 31 + idx) * 2654435761) >>> 0);
    const out = [];
    if (nom.startsWith('block_break|')) {
      const chaine = nom.slice(12), tex = texDeBloc(chaine);
      if (!tex) { jeter(nom, `particules de casse : texture introuvable pour ${chaine.replace(/\[.*/, '')}`); return out; }
      const e = donnees ? donnees.etatId(chaine) : -1;
      const boites = e >= 0 && donnees.boites(e).length ? donnees.boites(e) : [[0, 0, 0, 1, 1, 1]];
      const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
      // TerrainParticle : 0,6 x la couleur du bloc (BlockColors, indice 0 : herbe et feuillage du biome, eau...), sauf le bloc d'herbe (texture de terre)
      const tb = /^minecraft:grass_block(\[|$)/.test(chaine) ? null : rs.teinteBloc?.(chaine, cx, cz) ?? null;
      const gris = tb ? [0.6 * tb[0], 0.6 * tb[1], 0.6 * tb[2]] : [0.6, 0.6, 0.6];
      for (const b of boites) {
        const nx = Math.max(2, Math.ceil(Math.min(1, b[3] - b[0]) / 0.25)), ny = Math.max(2, Math.ceil(Math.min(1, b[4] - b[1]) / 0.25)), nz = Math.max(2, Math.ceil(Math.min(1, b[5] - b[2]) / 0.25));
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
          const d = (i + 0.5) / nx * (b[3] - b[0]) + b[0], f = (j + 0.5) / ny * (b[4] - b[1]) + b[1], g = (k + 0.5) / nz * (b[5] - b[2]) + b[2];
          const px = cx + d, py = cy + f, pz = cz + g;
          // Particle(level, x, y, z, xd, yd, zd) : vitesse = (position - centre) + bruit, normalisee
          let xd = d - 0.5 + (alea.flottant() * 2 - 1) * 0.4, yd = f - 0.5 + (alea.flottant() * 2 - 1) * 0.4, zd = g - 0.5 + (alea.flottant() * 2 - 1) * 0.4;
          const dd = (alea.flottant() + alea.flottant() + 1) * 0.15, e2 = Math.sqrt(xd * xd + yd * yd + zd * zd) || 1;
          xd = xd / e2 * dd * 0.4; yd = yd / e2 * dd * 0.4 + 0.1; zd = zd / e2 * dd * 0.4;
          const duree = Math.floor(4 / (alea.flottant() * 0.9 + 0.1));
          const taille = 0.1 * (alea.flottant() * 0.5 + 0.5) * 2 / 2;
          out.push({ type: 'bloc', tex, debut: tick, x: px, y: py, z: pz, xd, yd, zd, age: 0, duree, taille, uo: alea.flottant() * 3, vo: alea.flottant() * 3, gravite: 1, friction: 0.98, sol: false, couleur: gris.slice() });
        }
      }
      void N;
    } else if (nom === 'note') {
      const note = vx;
      const c = (a) => Math.max(0, Math.sin((note + a) * 2 * Math.PI) * 0.65 + 0.35);
      for (let i = 0; i < Math.max(1, N); i++) out.push({ type: 'note', tex: 'particle/note', debut: tick, x, y, z, xd: 0.0001, yd: 0.2 + 0.0001, zd: 0.0001, age: 0, duree: 6, taille: 0.1 * (alea.flottant() * 0.5 + 0.5) * 2 * 1.5 / 2, gravite: 0, friction: 0.66, sol: false, uo: 0, vo: 0, couleur: [c(0), c(1 / 3), c(2 / 3)] });
    } else if (nom === 'smoke') {   // SmokeParticle : monte doucement, 8 images generic_0..7
      for (let i = 0; i < Math.max(1, N); i++) out.push({ type: 'anim', pref: 'particle/generic_', n: 8, debut: tick, x, y, z, xd: (alea.flottant() - 0.5) * 0.02, yd: 0.03 + alea.flottant() * 0.02, zd: (alea.flottant() - 0.5) * 0.02, age: 0, duree: Math.floor(8 / (alea.flottant() * 0.8 + 0.2)), taille: 0.12 + alea.flottant() * 0.1, gravite: -0.1, friction: 0.96, sol: false, uo: 0, vo: 0, couleur: [0.4, 0.4, 0.4] });
    } else if (nom === 'splash' || nom === 'bubble' || nom === 'poof' || nom === 'large_smoke' || nom === 'lava') {   // particules d'eau, de mort et de lave (WaterSplashParticle, BubbleParticle, PoofParticle, LargeSmokeParticle, LavaParticle)
      const nb = Math.max(1, N);
      for (let i = 0; i < nb; i++) {
        const r1 = alea.flottant(), r2 = alea.flottant(), r3 = alea.flottant();
        const base = { debut: tick, x, y, z, xd: P[idx * 9 + 5], yd: P[idx * 9 + 6], zd: P[idx * 9 + 7], age: 0, sol: false, uo: 0, vo: 0, couleur: [1, 1, 1] };
        if (nom === 'splash') out.push({ ...base, type: 'anim', pref: 'particle/splash_', n: 4, xd: base.xd * 0.4 + (r1 - 0.5) * 0.1, yd: 0.1 + r2 * 0.2, zd: base.zd * 0.4 + (r3 - 0.5) * 0.1, duree: Math.floor(8 / (r2 * 0.8 + 0.2)), taille: 0.1 + r1 * 0.08, gravite: 1, friction: 0.98, couleur: [0.7, 0.85, 1], plein: true });
        else if (nom === 'bubble') out.push({ ...base, type: 'tex', tex: 'particle/bubble', xd: base.xd * 0.2, yd: base.yd * 0.2 + 0.02, zd: base.zd * 0.2, duree: Math.floor(8 / (r2 * 0.8 + 0.2)), taille: 0.04 + r1 * 0.04, gravite: -0.05, friction: 0.85, couleur: [1, 1, 1], plein: true });
        else if (nom === 'poof') out.push({ ...base, type: 'anim', pref: 'particle/generic_', n: 8, duree: 6 + Math.floor(r1 * 4), taille: 0.3 + r2 * 0.2, gravite: 0, friction: 0.9, couleur: [0.95, 0.95, 0.95], plein: true });
        else if (nom === 'large_smoke') out.push({ ...base, type: 'anim', pref: 'particle/big_smoke_', n: 12, xd: (r1 - 0.5) * 0.02, yd: 0.03 + r2 * 0.02, zd: (r3 - 0.5) * 0.02, duree: Math.floor(8 / (r2 * 0.8 + 0.2)) + 6, taille: 0.25 + r1 * 0.15, gravite: -0.1, friction: 0.96, couleur: [0.5, 0.5, 0.5] });
        else out.push({ ...base, type: 'tex', tex: 'particle/lava', xd: (r1 - 0.5) * 0.1, yd: 0.15 + r2 * 0.15, zd: (r3 - 0.5) * 0.1, duree: Math.floor(16 / (r2 * 0.8 + 0.2)), taille: 0.07 + r1 * 0.05, gravite: 0.75, friction: 0.999, couleur: [1, 1, 1], plein: true });
      }
    } else if (nom === 'electric_spark') {   // GlowParticle (ElectricSpark) : couleur (1 ; 0,9 ; 1), vitesse x 0,25, 2 ou 3 ticks, sans collisions, pleine lumiere
      const r1 = alea.flottant();
      out.push({ type: 'tex', tex: 'particle/glow', debut: tick, x, y, z, xd: P[idx * 9 + 5] * 0.25, yd: P[idx * 9 + 6] * 0.25, zd: P[idx * 9 + 7] * 0.25, age: 0, duree: 2 + alea.entierBorne(2), taille: 0.1 * (r1 * 0.5 + 0.5) * 2 * 0.75 / 2, gravite: 0, friction: 0.96, sol: false, uo: 0, vo: 0, couleur: [1, 0.9, 1], plein: true, fixe: false });
    } else if (nom === 'bubble_column_up' || nom === 'current_down' || nom === 'bubble_pop') {
      // colonnes de bulles (Horizon horizon-client-render particles.rs) : BubbleColumnUp : taille x (0,2..0,8), vitesse x 0,2 + (r x 2 - 1) x 0,02,
      // gravite -0,125, frottement 0,85, 40 / (r x 0,8 + 0,2) ticks, disparait hors de l'eau ; CurrentDown : 30..89 ticks, -0,05 en y, spirale ;
      // BubblePop : 4 ticks, gravite 0,008, images bubble_pop_0..4
      for (let i = 0; i < Math.max(1, N); i++) {
        const r1 = alea.flottant(), r2 = alea.flottant(), r3 = alea.flottant(), r4 = alea.flottant(), r5 = alea.flottant();
        const base = { debut: tick, x, y, z, age: 0, sol: false, uo: 0, vo: 0, couleur: [1, 1, 1], plein: true };
        if (nom === 'bubble_column_up') out.push({ ...base, type: 'tex', tex: 'particle/bubble', xd: P[idx * 9 + 5] * 0.2 + (r2 * 2 - 1) * 0.02, yd: P[idx * 9 + 6] * 0.2 + (r3 * 2 - 1) * 0.02, zd: P[idx * 9 + 7] * 0.2 + (r4 * 2 - 1) * 0.02, duree: Math.floor(40 / (r5 * 0.8 + 0.2)), taille: 0.1 * (r1 * 0.6 + 0.2), gravite: -0.125, friction: 0.85, dansEau: true });
        else if (nom === 'current_down') out.push({ ...base, type: 'tex', tex: 'particle/bubble', xd: 0, yd: -0.05, zd: 0, duree: Math.floor(r1 * 60) + 30, taille: 0.1 * (r2 * 0.6 + 0.2), gravite: 0.002, friction: 1, courant: true, angle: 0 });
        else out.push({ ...base, type: 'anim', pref: 'particle/bubble_pop_', n: 5, xd: P[idx * 9 + 5], yd: P[idx * 9 + 6], zd: P[idx * 9 + 7], duree: 4, taille: 0.1 * (r1 * 0.5 + 0.5) * 2 / 2, gravite: 0.008 / 0.04, friction: 1 });
      }
    } else if (nom === 'sweep_attack') {
      // AttackSweepParticle (Horizon horizon-client-render particles.rs `T::SweepAttack`, MIT) : 4 ticks, gris 0,4 + 0,6 x hasard, taille
      // 1 - xd x 0,5 (xd : premier nombre envoye par Player.sweepAttack, -sin(lacet) ; la taille depend donc du sens, comme dans le jeu),
      // pleine lumiere, immobile, images sweep_0..7 choisies par l'age (SpriteSet.get)
      const c = alea.flottant() * 0.6 + 0.4;
      out.push({ type: 'anim', pref: 'particle/sweep_', n: 8, jeu: true, debut: tick, x, y, z, xd: 0, yd: 0, zd: 0, age: 0, duree: 4, taille: 1 - vx * 0.5, gravite: 0, friction: 1, sol: false, uo: 0, vo: 0, couleur: [c, c, c], plein: true, fixe: true });
    } else if (nom === 'crit') {   // CritParticle : petites etoiles qui retombent vite (friction 0,7, gravite 0,5)
      const r1 = alea.flottant(), r2 = alea.flottant(), r3 = alea.flottant();
      out.push({ type: 'tex', tex: 'particle/critical_hit', debut: tick, x, y, z, xd: P[idx * 9 + 5] * 0.1 + (r1 - r2) * 0.05, yd: P[idx * 9 + 6] * 0.1 + (r2 - r3) * 0.05, zd: P[idx * 9 + 7] * 0.1 + (r3 - r1) * 0.05, age: 0, duree: Math.floor(6 / (r1 * 0.8 + 0.6)), taille: 0.09 + r2 * 0.05, gravite: 0.5, friction: 0.7, sol: false, uo: 0, vo: 0, couleur: [1, 1, 1], plein: true });
    } else if (nom === 'portal') {   // PortalParticle : des points violets qui s'eloignent
      const r1 = alea.flottant(), r2 = alea.flottant();
      out.push({ type: 'tex', tex: 'particle/generic_0', debut: tick, x, y, z, xd: P[idx * 9 + 5] * 0.05 + (r1 - 0.5) * 0.1, yd: (r2 - 0.5) * 0.1, zd: P[idx * 9 + 7] * 0.05 + (r2 - 0.5) * 0.1, age: 0, duree: 20 + Math.floor(r1 * 20), taille: 0.05 + r2 * 0.05, gravite: 0, friction: 0.98, sol: false, uo: 0, vo: 0, couleur: [0.6 + r1 * 0.2, 0.25, 0.95], plein: true });
    } else if (nom === 'effet') {   // SpellParticle (potion jetee) : spirale d'une couleur (teinte dans le champ nombre)
      const teinte = N, k = Math.floor(teinte * 6) % 6, f = teinte * 6 - Math.floor(teinte * 6), q = 1 - 0.6 * f, t2 = 1 - 0.6 * (1 - f);
      const col = [[1, t2, 0.4], [q, 1, 0.4], [0.4, 1, t2], [0.4, q, 1], [t2, 0.4, 1], [1, 0.4, q]][k];
      const r1 = alea.flottant();
      out.push({ type: 'anim', pref: 'particle/effect_', n: 8, debut: tick, x, y, z, xd: P[idx * 9 + 5], yd: P[idx * 9 + 6], zd: P[idx * 9 + 7], age: 0, duree: Math.floor(40 / (r1 * 0.8 + 0.2)), taille: 0.12 + r1 * 0.06, gravite: -0.02, friction: 0.9, sol: false, uo: 0, vo: 0, couleur: col, plein: true });
    } else if (nom.startsWith('eclat_potion|')) {
      // LevelEventHandler.potionSplashParticles (2002 / 2007 ; Horizon game/level_particles.rs et particles.rs SpellParticle, MIT) : 8 miettes de la
      // potion jetee (gaussien x 0,15, 0..0,2, gaussien x 0,15 ; une couche du modele au hasard : le flacon ou le liquide) ; 100 particules
      // d'effet : direction au hasard (Particle : bruit +-0,4, vitesse (r + r + 1) x 0,15 x 0,4, +0,1 en y), y de l'evenement 0,01..0,51 x 0,2,
      // puissance d = 0..4 (x d a l'horizontale, (vy - 0,1) x d + 0,1), couleur x 0,75..1, taille 0,1..0,2 x 0,75, 8 / (r x 0,8 + 0,2) ticks,
      // frottement 0,96, gravite -0,1 (elles montent), images effect_0..7 (instant_effect_ pour 2007)
      const [, rgb, inst] = nom.split('|'), c = rgb.split(',').map((v) => Number(v) / 255);
      for (let i = 0; i < 8; i++) {
        const tex = alea.flottant() < 0.5 ? 'item/splash_potion' : 'item/potion_overlay';
        if (!texPart(tex)) continue;
        out.push({ type: 'bloc', tex, debut: tick, x, y, z, xd: alea.gaussien() * 0.15, yd: alea.reel() * 0.2, zd: alea.gaussien() * 0.15, age: 0, duree: Math.floor(4 / (alea.flottant() * 0.9 + 0.1)), taille: 0.1 * (alea.flottant() * 0.5 + 0.5), uo: alea.flottant() * 3, vo: alea.flottant() * 3, gravite: 1, friction: 0.98, sol: false, couleur: tex === 'item/potion_overlay' ? c : [1, 1, 1], plein: true });
      }
      const pref = inst === '1' ? 'particle/instant_effect_' : 'particle/effect_';
      for (let i = 0; i < 100; i++) {
        const d = alea.reel() * 4, ang = alea.reel() * Math.PI * 2, vy = 0.01 + alea.reel() * 0.5, k = 0.75 + alea.flottant() * 0.25;
        let xd = (0.5 - alea.reel()) + (alea.flottant() * 2 - 1) * 0.4, yd = vy + (alea.flottant() * 2 - 1) * 0.4, zd = (0.5 - alea.reel()) + (alea.flottant() * 2 - 1) * 0.4;
        const sp = (alea.flottant() + alea.flottant() + 1) * 0.15, L = Math.hypot(xd, yd, zd) || 1;
        xd = xd / L * sp * 0.4; yd = yd / L * sp * 0.4 + 0.1; zd = zd / L * sp * 0.4;
        yd *= 0.2; xd *= d; yd = (yd - 0.1) * d + 0.1; zd *= d;
        out.push({ type: 'anim', pref, n: 8, debut: tick, x: x + Math.cos(ang) * d * 0.1, y: y + 0.3, z: z + Math.sin(ang) * d * 0.1, xd, yd, zd, age: 0, duree: Math.floor(8 / (alea.flottant() * 0.8 + 0.2)), taille: 0.1 * (alea.flottant() * 0.5 + 0.5) * 2 * 0.75, gravite: -0.1, friction: 0.96, sol: false, uo: 0, vo: 0, couleur: [c[0] * k, c[1] * k, c[2] * k], plein: true });
      }
    } else if (nom === 'totem_of_undying') {
      // evenement 35 du totem (Horizon particles.rs : TrackingEmitter.tick et TotemParticle, MIT) : 16 essais par tick, direction (r x 2 - 1) dans la
      // boule unite, depart a pieds + largeur x a / 4, hauteur x (0,5 + b / 4), vitesse (a, b + 0,2, c) ; SimpleAnimatedParticle : 60 + [0, 12[ ticks,
      // gravite 1,25, frottement 0,6, taille x 0,75, pleine lumiere, images glitter_7 -> glitter_0 ; couleur : 1 sur 4 jaune-vert (0,6..0,8 ;
      // 0,6..0,9 ; 0..0,2), sinon vert (0,1..0,3 ; 0,4..0,7 ; 0..0,2) ; la seconde moitie de sa vie l'alpha baisse de 1 a 0,5
      const L = P[idx * 9 + 5], Hh = P[idx * 9 + 6];
      for (let i = 0; i < Math.max(1, N); i++) {
        const xa = alea.flottant() * 2 - 1, ya = alea.flottant() * 2 - 1, za = alea.flottant() * 2 - 1;
        if (xa * xa + ya * ya + za * za > 1) continue;
        alea.flottant();   // Particle(level, x, y, z) : duree tiree puis remplacee
        const taille = 0.1 * (alea.flottant() * 0.5 + 0.5) * 2 * 0.75, duree = 60 + alea.entierBorne(12);
        const couleur = alea.entierBorne(4) === 0 ? [0.6 + alea.flottant() * 0.2, 0.6 + alea.flottant() * 0.3, alea.flottant() * 0.2] : [0.1 + alea.flottant() * 0.2, 0.4 + alea.flottant() * 0.3, alea.flottant() * 0.2];
        out.push({ type: 'anim', pref: 'particle/glitter_', n: 8, jeu: true, inverse: true, debut: tick, x: x + L * (xa / 4), y: y + Hh * (0.5 + ya / 4), z: z + L * (za / 4), xd: xa, yd: ya + 0.2, zd: za, age: 0, duree, taille, gravite: 1.25, friction: 0.6, sol: false, uo: 0, vo: 0, couleur, plein: true, fondu: true });
      }
    } else if (nom === 'happy_villager') {   // HappyVillagerParticle : des etincelles vertes qui montent (farine d'os)
      const r1 = alea.flottant(), r2 = alea.flottant();
      out.push({ type: 'anim', pref: 'particle/glitter_', n: 8, debut: tick, x, y, z, xd: (r1 - 0.5) * 0.02, yd: 0.02 + r2 * 0.03, zd: (r2 - 0.5) * 0.02, age: 0, duree: 14 + Math.floor(r1 * 12), taille: 0.1 + r2 * 0.05, gravite: 0, friction: 0.95, sol: false, uo: 0, vo: 0, couleur: [0.35, 1, 0.35], plein: true });
    } else if (nom === 'heart' || nom === 'angry_villager') {   // HeartParticle (amour, colere du villageois) : vitesse x 0,01 + 0,1 vers le haut, taille x 1,5, 16 ticks, frottement 0,86
      const r1 = alea.flottant();
      out.push({ type: 'tex', tex: nom === 'heart' ? 'particle/heart' : 'particle/angry', debut: tick, x, y: nom === 'angry_villager' ? y + 0.5 : y, z, xd: P[idx * 9 + 5] * 0.01, yd: P[idx * 9 + 6] * 0.01 + 0.1, zd: P[idx * 9 + 7] * 0.01, age: 0, duree: 16, taille: 0.1 * (r1 * 0.5 + 0.5) * 1.5, gravite: 0, friction: 0.86, sol: false, uo: 0, vo: 0, couleur: [1, 1, 1], plein: true });
    } else if (nom === 'falling_nectar') {   // DripParticle (nectar de l'abeille) : goutte qui tombe, couleur (0,92 ; 0,782 ; 0,72), gravite 0,007
      const r1 = alea.flottant(), r2 = alea.flottant();
      out.push({ type: 'tex', tex: 'particle/drip_fall', debut: tick, x, y, z, xd: 0, yd: 0, zd: 0, age: 0, duree: Math.floor(16 / (r1 * 0.8 + 0.2)), taille: 0.1 * (r2 * 0.5 + 0.5), gravite: 0.007 / 0.04, friction: 0.98, sol: false, uo: 0, vo: 0, couleur: [0.92, 0.782, 0.72] });
    } else if (nom === 'flame') {   // FlameParticle
      const r1 = alea.flottant(), r2 = alea.flottant();
      out.push({ type: 'tex', tex: 'particle/flame', debut: tick, x, y, z, xd: (r1 - 0.5) * 0.01, yd: 0.005 + r2 * 0.01, zd: (r2 - 0.5) * 0.01, age: 0, duree: Math.floor(8 / (r1 * 0.8 + 0.2)) + 4, taille: 0.06 + r2 * 0.03, gravite: 0, friction: 0.96, sol: false, uo: 0, vo: 0, couleur: [1, 1, 1], plein: true });
    } else if (nom.startsWith('item|')) {   // miettes d'un objet (nourriture mangee, boule de neige ou oeuf qui se brise) : quarts de la texture de l'objet
      const objet = nom.slice(5), tex = texPart('item/' + objet) ? 'item/' + objet : null;
      if (!tex) { jeter(nom, "miettes d'objet : texture item/" + objet + " absente du kit"); return out; }
      const r1 = alea.flottant(), r2 = alea.flottant(), r3 = alea.flottant();
      out.push({ type: 'bloc', tex, debut: tick, x, y, z, xd: P[idx * 9 + 5], yd: P[idx * 9 + 6], zd: P[idx * 9 + 7], age: 0, duree: Math.floor(4 / (r1 * 0.9 + 0.1)), taille: 0.1 * (r2 * 0.5 + 0.5), uo: r3 * 3, vo: r2 * 3, gravite: 1, friction: 0.98, sol: false, couleur: [1, 1, 1], plein: true });
    } else if (nom === 'dragon_breath') {   // DragonBreathParticle : sprites generic, violet (0,72..0,80 ; 0 ; 0,82..0,98), 20 / (r x 0,8 + 0,2) ticks
      const r1 = alea.flottant(), r2 = alea.flottant(), r3 = alea.flottant();
      out.push({ type: 'anim', pref: 'particle/generic_', n: 8, debut: tick, x, y, z, xd: P[idx * 9 + 5] + (r1 - 0.5) * 0.01, yd: P[idx * 9 + 6], zd: P[idx * 9 + 7] + (r3 - 0.5) * 0.01, age: 0, duree: Math.floor(20 / (r2 * 0.8 + 0.2)), taille: 0.1 * 0.75 * (r3 * 0.5 + 0.5) * 2, gravite: 0, friction: 0.96, sol: false, uo: 0, vo: 0, couleur: [0.7176471 + r1 * 0.086, 0, 0.8235294 + r2 * 0.153], plein: true });
    } else if (nom === 'sonic_boom') {   // SonicBoomParticle : 16 images sonic_boom_0..15, 16 ticks, taille 1,5, pleine lumiere
      out.push({ type: 'anim', pref: 'particle/sonic_boom_', n: 16, debut: tick, x, y, z, xd: 0, yd: 0, zd: 0, age: 0, duree: 16, taille: 1.5, gravite: 0, friction: 1, sol: false, uo: 0, vo: 0, couleur: [1, 1, 1], plein: true, lumineux: true });
    } else if (nom === 'vibration') {   // VibrationParticle : de la source a l'ecouteur en N ticks (champ nombre), texture vibration, 0,3, pleine lumiere
      out.push({ type: 'tex', tex: 'particle/vibration', debut: tick, x, y, z, xd: 0, yd: 0, zd: 0, age: 0, duree: Math.max(1, N), taille: 0.15, gravite: 0, friction: 1, sol: false, uo: 0, vo: 0, couleur: [1, 1, 1], plein: true, trajet: { de: [x, y, z], vers: [P[idx * 9 + 5], P[idx * 9 + 6], P[idx * 9 + 7]] } });
    } else if (nom === 'squid_ink' || nom === 'glow_squid_ink') {   // SquidInkParticle : nuage d'encre (noir ; luisant : cyan 0x00FFBF), frottement 0,92
      const r1 = alea.flottant();
      out.push({ type: 'anim', pref: 'particle/generic_', n: 8, debut: tick, x, y, z, xd: P[idx * 9 + 5], yd: P[idx * 9 + 6], zd: P[idx * 9 + 7], age: 0, duree: Math.floor(15 / (r1 * 0.8 + 0.2)), taille: 0.25 + r1 * 0.2, gravite: 0, friction: 0.92, sol: false, uo: 0, vo: 0, couleur: nom === 'squid_ink' ? [0.05, 0.05, 0.05] : [0.2, 1, 0.75], plein: true });
    } else if (nom.startsWith('entity_effect|')) {   // particule d'effet d'une couleur donnee (wither : 0,7 0,7 0,9 pendant la charge, 0,7 0,7 0,5 en armure)
      const col = nom.slice(14).split(',').map(Number), r1 = alea.flottant();
      out.push({ type: 'anim', pref: 'particle/effect_', n: 8, debut: tick, x, y, z, xd: (r1 - 0.5) * 0.02, yd: 0.02, zd: (alea.flottant() - 0.5) * 0.02, age: 0, duree: Math.floor(16 / (r1 * 0.8 + 0.2)), taille: 0.12 + r1 * 0.06, gravite: -0.02, friction: 0.9, sol: false, uo: 0, vo: 0, couleur: col, plein: true });
    } else if (nom.startsWith('miettes|')) {   // miettes du bloc sous un breeze (Breeze.emitGroundParticles : TerrainParticle a l'arret, N d'un coup)
      const chaine = nom.slice(8), tex = texDeBloc(chaine);
      if (!tex) return out;
      const tb = /^minecraft:grass_block(\[|$)/.test(chaine) ? null : rs.teinteBloc?.(chaine, Math.floor(x), Math.floor(z)) ?? null;   // TerrainParticle : teinte du bloc
      const gris = tb ? [0.6 * tb[0], 0.6 * tb[1], 0.6 * tb[2]] : [0.6, 0.6, 0.6];
      for (let i = 0; i < Math.max(1, N); i++) {
        let xd = (alea.flottant() * 2 - 1) * 0.4, yd = (alea.flottant() * 2 - 1) * 0.4, zd = (alea.flottant() * 2 - 1) * 0.4;
        const dd = (alea.flottant() + alea.flottant() + 1) * 0.15, e2 = Math.sqrt(xd * xd + yd * yd + zd * zd) || 1;
        xd = xd / e2 * dd * 0.4; yd = yd / e2 * dd * 0.4 + 0.1; zd = zd / e2 * dd * 0.4;
        out.push({ type: 'bloc', tex, debut: tick, x, y, z, xd, yd, zd, age: 0, duree: Math.floor(4 / (alea.flottant() * 0.9 + 0.1)), taille: 0.1 * (alea.flottant() * 0.5 + 0.5) * 2 / 2, uo: alea.flottant() * 3, vo: alea.flottant() * 3, gravite: 1, friction: 0.98, sol: false, couleur: gris.slice() });
      }
    } else if (nom === 'firework') {   // trainee d'une fusee (FireworkRocketEntity.tick, client) : une etincelle par tick, gaussien x 0,05 sur x et z, -vy/2
      out.push(etincelle(alea, tick, x, y, z, [alea.gaussien() * 0.05, P[idx * 9 + 6], alea.gaussien() * 0.05], [1, 1, 1], null, false, false));
    } else if (nom.startsWith('feu_artifice|')) {   // ClientLevel.createFireworks -> FireworkParticles.Starter (Horizon particles.rs tick_starters)
      const ex = JSON.parse(nom.slice(13)), v = [P[idx * 9 + 5], P[idx * 9 + 6], P[idx * 9 + 7]];
      if (!ex.length) {   // sans explosion : 2 a 4 bouffees
        for (let i = 0; i < alea.entierBorne(3) + 2; i++) out.push({ type: 'anim', pref: 'particle/generic_', n: 8, debut: tick, x, y, z, xd: alea.gaussien() * 0.05, yd: 0.005, zd: alea.gaussien() * 0.05, age: 0, duree: 6 + alea.entierBorne(4), taille: 0.3, gravite: 0, friction: 0.9, sol: false, uo: 0, vo: 0, couleur: [1, 1, 1], plein: true });
        return out;
      }
      ex.forEach(([forme, couleurs0, fondu, trainee, scintille], i) => {
        const couleurs = couleurs0.length ? couleurs0 : [0x1E1B1B];
        const rgb = (c) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
        const attente = i * 2;   // une explosion tous les 2 ticks
        const etinc = (vv) => {
          const c = couleurs[alea.entierBorne(couleurs.length)], f = fondu.length ? rgb(fondu[alea.entierBorne(fondu.length)]) : null;
          const q = etincelle(alea, tick, x, y, z, vv, rgb(c), f, !!trainee, !!scintille); q.attente = attente; out.push(q);
        };
        if (forme === 0 || forme === 1) {   // boule : 0,25 et 2 pas ; grosse : 0,5 et 4 pas
          const vit = forme === 0 ? 0.25 : 0.5, n = forme === 0 ? 2 : 4;
          for (let yy = -n; yy <= n; yy++) for (let xx = -n; xx <= n; xx++) for (let zz = -n; zz <= n; zz++) {
            const d = () => (alea.reel() - alea.reel()) * 0.5;
            const xa = xx + d(), ya = yy + d(), za = zz + d(), L = Math.sqrt(xa * xa + ya * ya + za * za) / vit + alea.gaussien() * 0.05;
            etinc([xa / L, ya / L, za / L]);
            if (yy !== -n && yy !== n && xx !== -n && xx !== n) zz += n * 2 - 1;
          }
        } else if (forme === 2 || forme === 3) {   // etoile, tete de creeper (plate)
          const C = forme === 2 ? ETOILE : CREEPER, vit = 0.5, plat = forme === 3;
          etinc([C[0][0] * vit, C[0][1] * vit, 0]);
          const base = Math.fround(alea.flottant() * Math.fround(Math.PI)), mod = plat ? 0.034 : 0.34;
          for (let st = 0; st < 3; st++) {
            const ang = base + Math.fround(st * Math.fround(Math.PI)) * mod;
            let [ox, oy] = C[0];
            for (const [tx, ty] of C.slice(1)) {
              for (let sub = 0.25; sub <= 1.0; sub += 0.25) {
                let xa = (ox + (tx - ox) * sub) * vit; const ya = (oy + (ty - oy) * sub) * vit, za = xa * Math.sin(ang); xa *= Math.cos(ang);
                for (const fl of [-1, 1]) etinc([xa * fl, ya, za * fl]);
              }
              ox = tx; oy = ty;
            }
          }
        } else {   // gerbe (burst) : 70 etincelles, la moitie de la vitesse de la fusee + un ecart
          const bx = alea.gaussien() * 0.05, bz = alea.gaussien() * 0.05;
          for (let k = 0; k < 70; k++) etinc([v[0] * 0.5 + alea.gaussien() * 0.15 + bx, v[1] * 0.5 + alea.reel() * 0.5, v[2] * 0.5 + alea.gaussien() * 0.15 + bz]);
        }
        // l'eclair (FireworkParticles.OverlayParticle) : 4 ticks, la premiere couleur, taille 7,1 x sin((age - 1) x pi / 4), alpha 0,6 - (age - 1) / 8
        out.push({ type: 'flash', tex: 'particle/flash', debut: tick, attente, x, y, z, xd: 0, yd: 0, zd: 0, age: 0, duree: 4, taille: 0, gravite: 0, friction: 1, sol: false, uo: 0, vo: 0, couleur: rgb(couleurs[0]), plein: true, fixe: true });
      });
    } else if (nom === 'gust_emitter_large' || nom === 'gust_emitter_small') {
      // GustSeedParticle : (echelle, duree, delai) = (3, 7, 0) ou (1, 3, 2) ; tous les delai + 1 ticks, 3 rafales (GustParticle : 12 a 15 ticks,
      // taille 1, pleine lumiere, images gust_0..11, immobiles) a (r - r) x echelle du centre
      const [ech, duree, delai] = nom === 'gust_emitter_large' ? [3, 7, 0] : [1, 3, 2];
      for (let ag = 0; ag <= duree; ag++) if (ag % (delai + 1) === 0) for (let k = 0; k < 3; k++) out.push({ type: 'anim', pref: 'particle/gust_', n: 12, jeu: true, debut: tick, attente: ag, x: x + (alea.reel() - alea.reel()) * ech, y: y + (alea.reel() - alea.reel()) * ech, z: z + (alea.reel() - alea.reel()) * ech, xd: 0, yd: 0, zd: 0, age: 0, duree: 12 + alea.entierBorne(4), taille: 1, gravite: 0, friction: 1, sol: false, uo: 0, vo: 0, couleur: [1, 1, 1], plein: true, fixe: true });
    } else if (nom === 'explosion' || nom === 'explosion_emitter') {
      // HugeExplosionParticle (Horizon horizon-client-render particles.rs, MIT) : 16 images explosion_0..15 (silhouettes blanches du jeu
      // 26.3) teintees d'un gris tire 0,4 + 0,6 x hasard, 6 a 9 ticks, demi-cote 2 x (1 - f / 2), pleine lumiere, immobile.
      // HugeExplosionSeedParticle (emetteur) : 8 ticks, 6 boules par tick a (r - r) x 4 du centre, f = age / 8 (les dernieres plus petites).
      const boule = (px, py, pz, f, attente) => { const c = alea.flottant() * 0.6 + 0.4; out.push({ type: 'anim', pref: 'particle/explosion_', n: 16, debut: tick, attente, x: px, y: py, z: pz, xd: 0, yd: 0, zd: 0, age: 0, duree: 6 + alea.entierBorne(4), taille: 2 * (1 - f * 0.5), gravite: 0, friction: 1, sol: false, uo: 0, vo: 0, couleur: [c, c, c], plein: true }); };
      if (nom === 'explosion') boule(x, y, z, Number.isFinite(vx) && vx > 0 ? vx : 1, 0);
      else for (let k = 0; k < 8; k++) for (let i = 0; i < 6; i++) boule(x + (alea.flottant() - alea.flottant()) * 4, y + (alea.flottant() - alea.flottant()) * 4, z + (alea.flottant() - alea.flottant()) * 4, k / 8, k);
    } else if (nom === 'explosion_debris') {
      // ClientExplosionTracker.tick : min(blocs, 512) bouffees dans la sphere de rayon = puissance (distance racine cubique), vitesse
      // 0,5 / (d / R + 0,1) x r x r + 0,3 vers l'exterieur ; une sur deux poof (a mi-distance) ou smoke (Horizon particles.rs `tick_explosions`)
      const R = vx, nb = Math.min(512, Math.max(0, N));
      for (let i = 0; i < nb; i++) {
        let d = [alea.flottant() * 2 - 1, alea.flottant() * 2 - 1, alea.flottant() * 2 - 1]; const l = Math.hypot(...d) || 1; d = d.map((v) => v / l);
        const dist = Math.cbrt(alea.flottant()) * R, sp = 0.5 / (dist / R + 0.1) * alea.flottant() * alea.flottant() + 0.3;
        const v = d.map((c) => c * sp);
        if (alea.entierBorne(2) === 0) {   // PoofParticle : gris 0,7 a 1, 0,1 x (r x r x 6 + 1), 16 / (r x 0,8 + 0,2) + 2 ticks, monte (gravite -0,1), frottement 0,9
          const c = alea.flottant() * 0.3 + 0.7;
          out.push({ type: 'anim', pref: 'particle/generic_', n: 8, debut: tick, x: x + d[0] * dist * 0.5, y: y + d[1] * dist * 0.5, z: z + d[2] * dist * 0.5, xd: v[0] + (alea.flottant() * 2 - 1) * 0.05, yd: v[1] + (alea.flottant() * 2 - 1) * 0.05, zd: v[2] + (alea.flottant() * 2 - 1) * 0.05, age: 0, duree: Math.floor(16 / (alea.flottant() * 0.8 + 0.2)) + 2, taille: 0.1 * (alea.flottant() * alea.flottant() * 6 + 1), gravite: -0.1, friction: 0.9, sol: false, uo: 0, vo: 0, couleur: [c, c, c], plein: true, inverse: true });
        } else {   // SmokeParticle (BaseAshSmokeParticle) : gris fonce r x 0,3, vitesse x 0,1 + la poussee, 8 / (r x 0,8 + 0,2) ticks, monte
          const c = alea.flottant() * 0.3;
          out.push({ type: 'anim', pref: 'particle/generic_', n: 8, debut: tick, x: x + d[0] * dist, y: y + d[1] * dist, z: z + d[2] * dist, xd: v[0] + (alea.flottant() * 2 - 1) * 0.01, yd: v[1] + (alea.flottant() * 2 - 1) * 0.01, zd: v[2] + (alea.flottant() * 2 - 1) * 0.01, age: 0, duree: Math.max(1, Math.floor(8 / (alea.flottant() * 0.8 + 0.2))), taille: 0.075 * (alea.flottant() * 0.5 + 0.5) * 2, gravite: -0.1, friction: 0.96, sol: false, uo: 0, vo: 0, couleur: [c, c, c], plein: true, inverse: true });
        }
      }
    }
    return out;
  };

  // avance d'un tick (Particle.tick)
  const avancer = (E) => {
    for (const p of E.liste) {
      if (p.attente > 0) { p.attente--; continue; }   // boule d'un emetteur pas encore nee (HugeExplosionSeedParticle : une salve par tick)
      if (p.age++ >= p.duree) { p.mort = true; continue; }
      if (p.fixe) continue;   // eclair, rafales : immobiles
      if (p.etincelle) {   // SparkParticle.tick : seconde moitie, l'alpha baisse et la couleur va vers le fondu ; trainee : une etincelle fille tous les 2 ticks
        const L = p.duree, a = p.age;   // apres super.tick : l'age compte deja ce tick
        if (a > Math.floor(L / 2)) { p.alpha = 1 - (a - Math.floor(L / 2)) / L; if (p.fondu) for (let i = 0; i < 3; i++) p.couleur[i] += (p.fondu[i] - p.couleur[i]) * 0.2; }
        if (p.trainee && a < Math.floor(L / 2) && (a + L) % 2 === 0) { const f = etincelle(p.alea, p.debut, p.x, p.y, p.z, [0, 0, 0], p.couleur.slice(), p.fondu, false, p.scintille); f.age = Math.floor(f.duree / 2); f.alpha = p.alpha; E.nouvelles.push(f); }
      }
      if (p.trajet) {   // vibration : position interpolee de la source a l'ecouteur (VibrationParticle), vitesse = le pas suivant
        const g = (q) => { const k = Math.min(1, q / p.duree); return p.trajet.de.map((c, i) => c + (p.trajet.vers[i] - c) * k); };
        const [a0, a1] = [g(p.age), g(p.age + 1)];
        p.x = a0[0]; p.y = a0[1]; p.z = a0[2]; p.xd = a1[0] - a0[0]; p.yd = a1[1] - a0[1]; p.zd = a1[2] - a0[2];
        continue;
      }
      const horsEau = () => { if (!lecteur || !donnees) return false; const e = lecteur.etatEn(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); const f = e >= 0 ? donnees.fluide(e) : 0; return f !== 1 && f !== 2; };
      if (p.courant) {   // WaterCurrentDownParticle : spirale (angle + 0,08 par tick), sans collisions, finit hors de l'eau
        p.xd = (p.xd + 0.6 * Math.cos(p.angle)) * 0.07; p.zd = (p.zd + 0.6 * Math.sin(p.angle)) * 0.07;
        p.x += p.xd; p.y += p.yd; p.z += p.zd; p.angle += 0.08;
        if (horsEau()) p.mort = true;
        continue;
      }
      p.yd -= 0.04 * p.gravite;
      // deplacement avec collisions (boite de 0,2)
      const demi = 0.1, boite = [p.x - demi, p.y - demi, p.z - demi, p.x + demi, p.y + demi, p.z + demi];
      let dx = p.xd, dy = p.yd, dz = p.zd;
      if (lecteur) { const r = deplacerBoite(lecteur, boite, [dx, dy, dz], false, 0); dx = r.dx; dy = r.dy; dz = r.dz; p.sol = r.bloqueY && p.yd < 0; if (r.bloqueY) p.yd = 0; if (r.bloqueX) p.xd = 0; if (r.bloqueZ) p.zd = 0; }
      p.x += dx; p.y += dy; p.z += dz;
      if (p.type === 'note' && dy === 0 && p.yd !== 0) { p.xd *= 1.1; p.zd *= 1.1; }
      p.xd *= p.friction; p.yd *= p.friction; p.zd *= p.friction;
      if (p.sol) { p.xd *= 0.7; p.zd *= 0.7; }
      if (p.fondu && p.age > Math.floor(p.duree / 2)) p.alpha = 1 - (p.age - Math.floor(p.duree / 2)) / p.duree;   // SimpleAnimatedParticle.tick
      if (p.dansEau && horsEau()) p.mort = true;   // BubbleColumnUpParticle : disparait hors de l'eau
    }
    E.liste = E.liste.filter((p) => !p.mort);
    if (E.nouvelles?.length) { E.liste.push(...E.nouvelles); E.nouvelles = []; }
  };

  return {
    maillages(u, camera) {
      if (!n) return [];
      const tick = Math.floor(u);
      if (!etat || tick < etat.tick) reset();
      while (etat.tick < tick) {
        etat.tick++;
        terrain?.regle?.(etat.tick);
        avancer(etat);
        while (etat.prochain < n && P[etat.prochain * 9] <= etat.tick) { for (const p of creer(etat.prochain)) etat.liste.push(p); etat.prochain++; }
      }
      if (!etat.liste.length) return [];
      // gabarit de la camera (face a l'ecran) : droite = (-cos lacet, 0, -sin lacet), avant, haut = droite x avant
      const ya = camera.lacet * RAD, pa = camera.tangage * RAD;
      const f = [-Math.sin(ya) * Math.cos(pa), -Math.sin(pa), Math.cos(ya) * Math.cos(pa)], r = [-Math.cos(ya), 0, -Math.sin(ya)];
      const h = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      const parTex = new Map(), frac = u - tick;
      for (const p of etat.liste) { if (p.attente > 0) continue;
        if (p.etincelle && p.scintille && p.age >= p.duree / 3 && Math.floor((p.age + p.duree) / 3) % 2 !== 0) continue;   // SparkParticle : clignote apres un tiers de sa vie
        let alpha = p.alpha ?? 1, s = p.taille;
        if (p.type === 'flash') { const ag = p.age + frac - 1; s = 7.1 * Math.sin(ag * 0.25 * Math.PI); alpha = 0.6 - ag * 0.25 * 0.5; if (s <= 0 || alpha <= 0) continue; }
        const im = p.type === 'anim' ? (p.jeu ? Math.min(p.n - 1, Math.floor(p.age * (p.n - 1) / p.duree)) : Math.min(p.n - 1, Math.floor(p.age / p.duree * p.n))) : 0;   // SpriteSet.get(age, duree)
        const tp0 = p.type === 'anim' ? p.pref + (p.inverse ? p.n - 1 - im : im) : p.tex, qa = p.etincelle || p.type === 'flash' || (p.fondu && alpha < 1) ? Math.max(1, Math.round(alpha * 16)) : 0;
        const tp = qa ? tp0 + '@' + qa : tp0;   // translucide (etincelles, eclair) : texture a l'alpha reduit (16 paliers), dessinee en melange
        if (!parTex.has(tp)) parTex.set(tp, new Constructeur()); const C = parTex.get(tp);   // inverse : poof et smoke vont de generic_7 a generic_0
        const x = p.x + p.xd * frac, y = p.y + p.yd * frac, z = p.z + p.zd * frac, L = p.plein ? 1 : lum(x, y, z);
        const ux = r[0] * s, uy = r[1] * s, uz = r[2] * s, vx = h[0] * s, vy = h[1] * s, vz = h[2] * s;
        const coins = [[x - ux + vx, y - uy + vy, z - uz + vz], [x + ux + vx, y + uy + vy, z + uz + vz], [x + ux - vx, y + uy - vy, z + uz - vz], [x - ux - vx, y - uy - vy, z - uz - vz]];
        let uv;
        if (p.type === 'bloc') { const a = p.uo / 4, b = (p.uo + 1) / 4, c = p.vo / 4, d = (p.vo + 1) / 4; uv = [[a, c], [b, c], [b, d], [a, d]]; } else uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
        C.quad(coins, uv, 1);
        const k = C.col.length - 12;
        for (let i = 0; i < 4; i++) { C.col[k + i * 3] = p.couleur[0] * L; C.col[k + i * 3 + 1] = p.couleur[1] * L; C.col[k + i * 3 + 2] = p.couleur[2] * L; }
      }
      const out = [];
      for (const [tex, C] of parTex) {
        if (C.vide()) continue;
        const k = tex.indexOf('@');
        if (k < 0) { const t = texPart(tex); if (t) out.push(C.maillage(t, 'decoupe', { deuxFaces: true, genre: 'particule' })); continue; }
        const t = texAlpha(tex.slice(0, k), Number(tex.slice(k + 1)) / 16);
        if (t) out.push(C.maillage(t, 'melange', { deuxFaces: true, genre: 'particule' }));
      }
      return out;
    },
  };
}
