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

export function creerEffetsMonde({ rs, scene, sim, kit, donnees, terrain }) {
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
    const xa = droit ? 0 : 1, xb = gauche ? 16 : 15;                      // corps : 14 de large, ou 15 pour une moitie de coffre double (au ras de l'autre)
    const yaw = VERS_Y[I.props.facing] ?? 0;
    const C = new Constructeur();
    const lum0 = lum(I.x + 0.5, I.y + 0.5, I.z + 0.5);
    const piece = (boite, u, v, pivotLid) => {
      for (const f of facesBoite(boite, u, v, tx.largeur, tx.hauteur)) {
        const coins = f.coins.map((p) => {
          let q = p;
          if (pivotLid) q = rotX(q, alpha, [0, 9, 1]);
          q = rotYcentre(q, -yaw);                                          // ChestRenderer : rotation de -toYRot autour du centre du bloc
          return [I.x + q[0] / 16, I.y + q[1] / 16, I.z + q[2] / 16];
        });
        C.quad(coins, f.uv, OMBRE[f.nom] * lum0);
      }
    };
    piece([xa, 0, 1, xb, 10, 15], 0, 19, false);                          // socle
    piece([xa, 9, 1, xb, 14, 15], 0, 0, true);                            // couvercle
    const sx = gauche ? [15, 16] : droit ? [0, 1] : [7, 9];
    piece([sx[0], 8, 15, sx[1], 12, 16], 0, 0, true);                     // serrure (suit le couvercle)
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
  const entites = creerEntites({ rs, replay, kit, texOf, lum, notes });   // TNT amorce, blocs qui tombent, objets au sol
  const meteoR = creerMeteoRendu({ rs, replay, scene, donnees, terrain, texOf, lum });   // pluie, neige, foudre (null sans meteo ni foudre)

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
      out.push(...particules.maillages(u, camera));
      if (meteoR) out.push(...meteoR.maillages(tm, camera));
      return out;
    },
  };
}

// ---------------------------------------------------------------- particules
function creerParticules({ rs, replay, kit, donnees, terrain, texOf, lum, notes }) {
  const P = replay.particules, n = P.length / 9;
  const lecteur = terrain?.lec ?? null;
  const textures = new Map();
  const texPart = (nom) => {   // 'block/dirt' -> texture rgba ; 'particle/note' ...
    if (!textures.has(nom)) textures.set(nom, texOf(nom + '.png'));
    return textures.get(nom);
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
  const reset = () => { etat = { tick: -1, liste: [], prochain: 0 }; };
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
          out.push({ type: 'bloc', tex, debut: tick, x: px, y: py, z: pz, xd, yd, zd, age: 0, duree, taille, uo: alea.flottant() * 3, vo: alea.flottant() * 3, gravite: 1, friction: 0.98, sol: false, couleur: [0.6, 0.6, 0.6] });
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
    } else if (nom === 'happy_villager') {   // HappyVillagerParticle : des etincelles vertes qui montent (farine d'os)
      const r1 = alea.flottant(), r2 = alea.flottant();
      out.push({ type: 'anim', pref: 'particle/glitter_', n: 8, debut: tick, x, y, z, xd: (r1 - 0.5) * 0.02, yd: 0.02 + r2 * 0.03, zd: (r2 - 0.5) * 0.02, age: 0, duree: 14 + Math.floor(r1 * 12), taille: 0.1 + r2 * 0.05, gravite: 0, friction: 0.95, sol: false, uo: 0, vo: 0, couleur: [0.35, 1, 0.35], plein: true });
    } else if (nom === 'flame') {   // FlameParticle
      const r1 = alea.flottant(), r2 = alea.flottant();
      out.push({ type: 'tex', tex: 'particle/flame', debut: tick, x, y, z, xd: (r1 - 0.5) * 0.01, yd: 0.005 + r2 * 0.01, zd: (r2 - 0.5) * 0.01, age: 0, duree: Math.floor(8 / (r1 * 0.8 + 0.2)) + 4, taille: 0.06 + r2 * 0.03, gravite: 0, friction: 0.96, sol: false, uo: 0, vo: 0, couleur: [1, 1, 1], plein: true });
    } else if (nom.startsWith('item|')) {   // miettes d'un objet (nourriture mangee, boule de neige ou oeuf qui se brise) : quarts de la texture de l'objet
      const objet = nom.slice(5), tex = texPart('item/' + objet) ? 'item/' + objet : null;
      if (!tex) { jeter(nom, "miettes d'objet : texture item/" + objet + " absente du kit"); return out; }
      const r1 = alea.flottant(), r2 = alea.flottant(), r3 = alea.flottant();
      out.push({ type: 'bloc', tex, debut: tick, x, y, z, xd: P[idx * 9 + 5], yd: P[idx * 9 + 6], zd: P[idx * 9 + 7], age: 0, duree: Math.floor(4 / (r1 * 0.9 + 0.1)), taille: 0.1 * (r2 * 0.5 + 0.5), uo: r3 * 3, vo: r2 * 3, gravite: 1, friction: 0.98, sol: false, couleur: [1, 1, 1], plein: true });
    } else if (nom === 'explosion' || nom === 'explosion_emitter') {   // ExplosionParticle : 16 images explosion_0..15
      const grand = nom === 'explosion_emitter', nb = grand ? 10 : Math.max(1, N);
      for (let i = 0; i < nb; i++) {
        const o = grand ? [(alea.flottant() - alea.flottant()) * 2.5, (alea.flottant() - alea.flottant()) * 1.5, (alea.flottant() - alea.flottant()) * 2.5] : [0, 0, 0];
        out.push({ type: 'anim', pref: 'particle/explosion_', n: 16, debut: tick, x: x + o[0], y: y + o[1], z: z + o[2], xd: 0, yd: 0, zd: 0, age: 0, duree: 6 + alea.entierBorne(4), taille: grand ? 1.3 + alea.flottant() * 0.7 : 0.4, gravite: 0, friction: 1, sol: false, uo: 0, vo: 0, couleur: [1, 1, 1], plein: true });
      }
    }
    return out;
  };

  // avance d'un tick (Particle.tick)
  const avancer = (E) => {
    for (const p of E.liste) {
      if (p.age++ >= p.duree) { p.mort = true; continue; }
      p.yd -= 0.04 * p.gravite;
      // deplacement avec collisions (boite de 0,2)
      const demi = 0.1, boite = [p.x - demi, p.y - demi, p.z - demi, p.x + demi, p.y + demi, p.z + demi];
      let dx = p.xd, dy = p.yd, dz = p.zd;
      if (lecteur) { const r = deplacerBoite(lecteur, boite, [dx, dy, dz], false, 0); dx = r.dx; dy = r.dy; dz = r.dz; p.sol = r.bloqueY && p.yd < 0; if (r.bloqueY) p.yd = 0; if (r.bloqueX) p.xd = 0; if (r.bloqueZ) p.zd = 0; }
      p.x += dx; p.y += dy; p.z += dz;
      if (p.type === 'note' && dy === 0 && p.yd !== 0) { p.xd *= 1.1; p.zd *= 1.1; }
      p.xd *= p.friction; p.yd *= p.friction; p.zd *= p.friction;
      if (p.sol) { p.xd *= 0.7; p.zd *= 0.7; }
    }
    E.liste = E.liste.filter((p) => !p.mort);
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
      for (const p of etat.liste) { const tp = p.type === 'anim' ? p.pref + Math.min(p.n - 1, Math.floor(p.age / p.duree * p.n)) : p.tex; if (!parTex.has(tp)) parTex.set(tp, new Constructeur()); const C = parTex.get(tp);
        const x = p.x + p.xd * frac, y = p.y + p.yd * frac, z = p.z + p.zd * frac, s = p.taille, L = p.plein ? 1 : lum(x, y, z);
        const ux = r[0] * s, uy = r[1] * s, uz = r[2] * s, vx = h[0] * s, vy = h[1] * s, vz = h[2] * s;
        const coins = [[x - ux + vx, y - uy + vy, z - uz + vz], [x + ux + vx, y + uy + vy, z + uz + vz], [x + ux - vx, y + uy - vy, z + uz - vz], [x - ux - vx, y - uy - vy, z - uz - vz]];
        let uv;
        if (p.type === 'bloc') { const a = p.uo / 4, b = (p.uo + 1) / 4, c = p.vo / 4, d = (p.vo + 1) / 4; uv = [[a, c], [b, c], [b, d], [a, d]]; } else uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
        C.quad(coins, uv, 1);
        const k = C.col.length - 12;
        for (let i = 0; i < 4; i++) { C.col[k + i * 3] = p.couleur[0] * L; C.col[k + i * 3 + 1] = p.couleur[1] * L; C.col[k + i * 3 + 2] = p.couleur[2] * L; }
      }
      const out = [];
      for (const [tex, C] of parTex) { const t = texPart(tex); if (t && !C.vide()) out.push(C.maillage(t, 'decoupe', { deuxFaces: true, genre: 'particule' })); }
      return out;
    },
  };
}
