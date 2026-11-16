// Modele du joueur (wide / slim) : boites, pivots, UV, pose -> maillage pour le rendu.
// Geometrie et chaine de matrices : Horizon (preview.rs, render.rs, anim.rs ; MIT), voir ATTRIBUTIONS.md.
//
// Repere du modele : pixels de modele (1/16 de bloc), Y vers le BAS, l'avant du joueur est -Z.
// Chaine vers le monde (blocs), voir `versMonde` : decalage (0, -1,501, 0), echelle 0,9375,
// symetrie (-1,-1,1), rotation autour de Y de (180 - lacet) degres, puis position des pieds.

import { habiller } from '../objets/habillage.js';   // armure et objets tenus (ajout : le corps seul ne passe pas par la)

const RAD = Math.PI / 180;
export const ECHELLE = 0.9375;
export const DECALAGE_Y = -1.501;     // blocs, avant l'echelle
export const BAISSE_ACCROUPI = 0.125; // blocs : le modele descend quand on est accroupi

// Ombrage de face (comme les blocs) : haut 1,0 ; bas 0,5 ; nord/sud 0,8 ; ouest/est 0,6.
const OMBRE_HAUT = 1.0, OMBRE_BAS = 0.5, OMBRE_NS = 0.8, OMBRE_OE = 0.6;

// Les 6 parties. g = gonflement de la couche externe (chapeau 0,5 ; reste 0,25).
export function definirParties(slim) {
  const bras = slim ? { l: 3, y: 2.5, xD: -2 } : { l: 4, y: 2, xD: -3 };
  return [
    { nom: 'tete', pivot: [0, 0, 0], orig: [-4, -8, -4], taille: [8, 8, 8], uv: [0, 0], ext: { uv: [32, 0], g: 0.5 } },
    { nom: 'corps', pivot: [0, 0, 0], orig: [-4, 0, -2], taille: [8, 12, 4], uv: [16, 16], ext: { uv: [16, 32], g: 0.25 } },
    { nom: 'brasD', pivot: [-5, bras.y, 0], orig: [bras.xD, -2, -2], taille: [bras.l, 12, 4], uv: [40, 16], ext: { uv: [40, 32], g: 0.25 } },
    { nom: 'brasG', pivot: [5, bras.y, 0], orig: [-1, -2, -2], taille: [bras.l, 12, 4], uv: [32, 48], ext: { uv: [48, 48], g: 0.25 } },
    { nom: 'jambeD', pivot: [-1.9, 12, 0], orig: [-2, 0, -2], taille: [4, 12, 4], uv: [0, 16], ext: { uv: [0, 32], g: 0.25 } },
    { nom: 'jambeG', pivot: [1.9, 12, 0], orig: [-2, 0, -2], taille: [4, 12, 4], uv: [16, 48], ext: { uv: [0, 48], g: 0.25 } },
  ];
}

// Faces d'une boite : coin haut-gauche de l'image (O), sens de u (U) et de v (V) sur la face, normale sortante (N),
// rectangle de texture [u0, v0, u1, v1] en pixels. (w, h, d) = largeur, hauteur, profondeur SANS gonflement.
// min/max = coins de la boite (gonflee). Voir analyse/3-personnages.md partie 2.1.
export function facesBoite([u, v], [w, h, d], min, max) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const u1 = u + d, u2 = u + d + w, u3 = u + d + w + d, u4 = u + d + w + d + w, v1 = v + d, v2 = v + d + h;
  return [
    { nom: 'avant', O: [x0, y0, z0], U: [1, 0, 0], V: [0, 1, 0], N: [0, 0, -1], rect: [u1, v1, u2, v2] },
    { nom: 'arriere', O: [x1, y0, z1], U: [-1, 0, 0], V: [0, 1, 0], N: [0, 0, 1], rect: [u3, v1, u4, v2] },
    { nom: 'gauche', O: [x1, y0, z0], U: [0, 0, 1], V: [0, 1, 0], N: [1, 0, 0], rect: [u2, v1, u3, v2] },   // cote +X = gauche du joueur
    { nom: 'droite', O: [x0, y0, z1], U: [0, 0, -1], V: [0, 1, 0], N: [-1, 0, 0], rect: [u, v1, u1, v2] }, // cote -X = droite du joueur
    { nom: 'dessus', O: [x0, y0, z1], U: [1, 0, 0], V: [0, 0, -1], N: [0, -1, 0], rect: [u1, v, u2, v1] },
    { nom: 'dessous', O: [x0, y1, z0], U: [1, 0, 0], V: [0, 0, 1], N: [0, 1, 0], rect: [u2, v, u2 + w, v1] },
  ];
}

const TAILLE_FACE = (f, [x0, y0, z0], [x1, y1, z1]) => [Math.abs(f.U[0] * (x1 - x0)) + Math.abs(f.U[1] * (y1 - y0)) + Math.abs(f.U[2] * (z1 - z0)),
  Math.abs(f.V[0] * (x1 - x0)) + Math.abs(f.V[1] * (y1 - y0)) + Math.abs(f.V[2] * (z1 - z0))];

// ---------------------------------------------------------------- matrices 3x3 (tableaux de 9, ligne par ligne)
function rotZYX(rx, ry, rz) { // Rz * Ry * Rx
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)];
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}
const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
function mult3(A, B) {
  const M = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return M;
}
const appliquer3 = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---------------------------------------------------------------- articulations (coudes, genoux)
// Chaque membre (12 px) est coupe a mi-longueur (6 px + 6 px). Le segment haut suit la partie d'origine (meme pivot, meme matrice) ;
// le segment bas tourne autour de la charniere K (axe X, a mi-longueur, au centre du membre). Pour fermer l'exterieur du pli,
// un coin de remplissage (eventail sur chaque cote + bande sur la face externe) relie l'arete externe du haut a celle du bas en
// N_ARC pas : le pas k porte la matrice du segment bas tournee de k/N_ARC de l'angle (sommets sur un arc de cercle autour de K).
// Les textures du coin sont les deux rangees de pixels de part et d'autre de la coupe. Sans flexion (angle 0) on garde la boite
// entiere d'origine : exactement les memes pixels qu'avant l'articulation.
export const FLEXION_MAX = 150;      // degres
const N_ARC = 3;
const PIVOT_INTERIEUR = 0;           // charniere : 0 = au centre du membre, 1 = au bord interieur du pli (genou : arriere ; coude : avant)
const EPS_X = 0.02;                  // px : le segment bas est un peu moins large, pour que les faces laterales du haut gagnent dans le pli
const LIMBES = [
  { nom: 'brasD', ip: 2, signe: -1, flex: 'coudeD' },   // signe : sens de la rotation autour d'X ; coude : l'avant-bras part vers l'avant (-z)
  { nom: 'brasG', ip: 3, signe: -1, flex: 'coudeG' },
  { nom: 'jambeD', ip: 4, signe: 1, flex: 'genouD' },   // genou : le bas de jambe part vers l'arriere (+z)
  { nom: 'jambeG', ip: 5, signe: 1, flex: 'genouG' },
];
const partieArt = (j, k) => 6 + j * (N_ARC + 1) + k;

// Flexion (radians, 0..150 degres) d'un membre dans une pose.
const flexion = (pose, L) => clamp(Number(pose[L.flex]) || 0, 0, FLEXION_MAX) * RAD;

// Accumulateur de sommets / triangles. kk = pas d'arc du sommet (sert a verifier le sens des triangles).
class Reservoir {
  constructor() { this.local = []; this.norm = []; this.part = []; this.uv = []; this.kk = []; this.idx = []; }
  sommet(part, l, n, uv, k = 0) {
    const i = this.part.length;
    this.local.push(l[0], l[1], l[2]); this.norm.push(n[0], n[1], n[2]); this.part.push(part); this.uv.push(uv[0], uv[1]); this.kk.push(k);
    return i;
  }
  // Triangle (a, b, c) dont la normale doit regarder dans le sens `voulue` (essai avec 69 degres de flexion, pas kn de l'arc).
  tri(a, b, c, voulue, signe, kn = 0) {
    const P = (i) => appliquer3(rotX(signe * (this.kk[i] / N_ARC) * 1.2), [this.local[i * 3], this.local[i * 3 + 1], this.local[i * 3 + 2]]);
    const [A, B, C] = [P(a), P(b), P(c)];
    const u = B.map((v, i) => v - A[i]), w = C.map((v, i) => v - A[i]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const nv = appliquer3(rotX(signe * (kn / N_ARC) * 1.2), voulue);
    if (n[0] * nv[0] + n[1] * nv[1] + n[2] * nv[2] >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }
  marque() { return { v0: this.part.length, i0: this.idx.length }; }
  fin(m) { return { ...m, v1: this.part.length, i1: this.idx.length }; }
}

const EPS_UV = 0.01; // pixels : on reste a l'interieur du rectangle de texture

// Une face de boite -> 4 sommets (HG, HD, BD, BG) et 2 triangles. decal : origine du repere de la partie (charniere K pour le segment bas).
function ajouterFace(R, part, f, min, max, decal = [0, 0, 0], k = 0) {
  const [fw, fh] = TAILLE_FACE(f, min, max);
  const base = R.part.length;
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([a, b]) => { // HG, HD, BD, BG
    const l = [0, 1, 2].map((i) => f.O[i] + f.U[i] * fw * a + f.V[i] * fh * b - decal[i]); // origines relatives au pivot (voir le tableau 1.1)
    const [ru0, rv0, ru1, rv1] = f.rect;
    R.sommet(part, l, f.N, [(a ? ru1 - EPS_UV : ru0 + EPS_UV) / 64, (b ? rv1 - EPS_UV : rv0 + EPS_UV) / 64], k);
  });
  // sens : la normale (b-a)x(c-a) doit sortir de la boite. U x V donne le sens des trois premiers coins.
  const cr = [f.U[1] * f.V[2] - f.U[2] * f.V[1], f.U[2] * f.V[0] - f.U[0] * f.V[2], f.U[0] * f.V[1] - f.U[1] * f.V[0]];
  const dedans = cr[0] * f.N[0] + cr[1] * f.N[1] + cr[2] * f.N[2] > 0; // HG,HD,BG tournent dans le bon sens ?
  const [HG, HD, BD, BG] = [base, base + 1, base + 2, base + 3];
  // (HG, HD, BG) : normale = U x V (HD-HG = U, BG-HG = V). Si elle sort : ordre direct.
  R.idx.push(...(dedans ? [HG, HD, BG, HD, BD, BG] : [HG, BG, HD, HD, BG, BD]));
}

// Une couche d'un membre articule : segment haut, segment bas, bouchons de la charniere, coin de remplissage de l'exterieur du pli.
function ajouterMembreScinde(R, j, p, couche) {
  const L = LIMBES[j];
  const g = couche ? p.ext.g : 0;
  const uvOrig = couche ? p.ext.uv : p.uv;
  const min = p.orig.map((c) => c - g), max = p.orig.map((c, i) => c + p.taille[i] + g);
  const ym = p.orig[1] + p.taille[1] / 2;                       // plan de coupe (au milieu, aussi pour la couche gonflee)
  const zc = p.orig[2] + p.taille[2] / 2, demi = p.taille[2] / 2 + g;
  const kz = zc + L.signe * PIVOT_INTERIEUR * p.taille[2] / 2;  // charniere K = (0, ym, kz) dans le repere du membre
  const K = [0, ym, kz];
  const F = Object.fromEntries(facesBoite(uvOrig, p.taille, min, max).map((f) => [f.nom, f]));
  const [au0, av0, au1, av1] = F.avant.rect;
  const mid = (av0 + av1) / 2, rangHaut = mid - 0.5, rangBas = mid + 0.5;   // rangees de texture de part et d'autre de la coupe
  const COTES = ['avant', 'arriere', 'gauche', 'droite'];
  const bouchon = (f, rang) => ({ ...f, rect: [au0, rang, au1, rang] });   // une seule rangee de la face avant, etiree

  // segment haut : de min a ym (moitie haute de chaque face laterale)
  const maxH = [max[0], ym, max[2]];
  for (const f of facesBoite(uvOrig, p.taille, min, maxH)) {
    if (COTES.includes(f.nom)) ajouterFace(R, L.ip, { ...f, rect: [f.rect[0], f.rect[1], f.rect[2], (f.rect[1] + f.rect[3]) / 2] }, min, maxH);
    else if (f.nom === 'dessus') ajouterFace(R, L.ip, f, min, maxH);
    else ajouterFace(R, L.ip, bouchon(f, rangHaut), min, maxH);
  }
  // segment bas : de ym a max (moitie basse), dans le repere de la charniere
  const minB = [min[0] + EPS_X, ym, min[2]], maxB = [max[0] - EPS_X, max[1], max[2]];
  const pb = partieArt(j, N_ARC);
  for (const f of facesBoite(uvOrig, p.taille, minB, maxB)) {
    if (COTES.includes(f.nom)) ajouterFace(R, pb, { ...f, rect: [f.rect[0], (f.rect[1] + f.rect[3]) / 2, f.rect[2], f.rect[3]] }, minB, maxB, K, N_ARC);
    else if (f.nom === 'dessous') ajouterFace(R, pb, f, minB, maxB, K, N_ARC);
    else ajouterFace(R, pb, bouchon(f, rangBas), minB, maxB, K, N_ARC);
  }

  // coin de remplissage : l'arete externe du haut (k = 0) tourne jusqu'a celle du bas (k = N_ARC) autour de K
  const xmin = min[0], xmax = max[0], zmin = zc - demi, zmax = zc + demi;
  const zExt = zc - L.signe * demi;                           // arete externe, repere du membre
  const zA = zExt - kz;                                       // idem, repere de K
  const ext = L.signe > 0 ? F.avant : F.arriere;
  const borne = (u, a, b) => Math.min(b - EPS_UV, Math.max(a + EPS_UV, u));
  const uExt = (x) => { let a = (x - xmin) / (xmax - xmin); if (ext.U[0] < 0) a = 1 - a; return borne(ext.rect[0] + a * (ext.rect[2] - ext.rect[0]), ext.rect[0], ext.rect[2]) / 64; };
  const uLat = (f, z) => { let a = (z - zmin) / (zmax - zmin); if (f.U[2] < 0) a = 1 - a; return borne(f.rect[0] + a * (f.rect[2] - f.rect[0]), f.rect[0], f.rect[2]) / 64; };
  const vk = (k) => (rangHaut + (rangBas - rangHaut) * k / N_ARC) / 64;
  for (const [x, f] of [[xmax, F.gauche], [xmin, F.droite]]) {
    const P = R.sommet(partieArt(j, 0), [x, 0, 0], f.N, [uLat(f, kz), mid / 64], 0);
    const E = [];
    for (let k = 0; k <= N_ARC; k++) E.push(R.sommet(partieArt(j, k), [x, 0, zA], f.N, [uLat(f, zExt), vk(k)], k));
    for (let k = 0; k < N_ARC; k++) R.tri(P, E[k], E[k + 1], f.N, L.signe, k + 0.5);
  }
  const nExt = [0, 0, -L.signe];
  const G = [], D = [];
  for (let k = 0; k <= N_ARC; k++) {
    G.push(R.sommet(partieArt(j, k), [xmin, 0, zA], nExt, [uExt(xmin), vk(k)], k));
    D.push(R.sommet(partieArt(j, k), [xmax, 0, zA], nExt, [uExt(xmax), vk(k)], k));
  }
  for (let k = 0; k < N_ARC; k++) {
    R.tri(G[k], D[k], D[k + 1], nExt, L.signe, k + 0.5);
    R.tri(G[k], D[k + 1], G[k + 1], nExt, L.signe, k + 0.5);
  }
}

// ---------------------------------------------------------------- le personnage
export class Personnage {
  // skinRgba : 64x64x4 (Uint8Array), modele : 'wide' | 'slim'.
  // masque (facultatif) : { largeur: 64, hauteur: 64, valeurs: Uint8Array(4096) } ; meme disposition que le skin, force d'exemption 0..255
  // par texel (couleur selective, voir rendu/LISEZMOI.md).
  constructor({ rgba, modele = 'wide', masque = null }) {
    this.modele = modele;
    this.kitDir = rgba?.kitDir ?? null;   // pose par resoudreSkin (perso/skin.js) : kit des objets tenus et de l'armure (src/objets/)
    this.parties = definirParties(modele === 'slim');
    this.texture = { largeur: 64, hauteur: 64, rgba };
    this.masque = masque;
    this._construire();
  }

  // Tout ce qui ne bouge pas : positions locales, normales, UV, indices. Deux versions de chaque membre : la boite entiere
  // (rigide, identique a l'ancien rendu) et la version articulee (voir plus haut) ; `_config(masque)` choisit membre par membre.
  _construire() {
    const R = new Reservoir();
    this.groupes = this.parties.map((p, ip) => {
      const m = R.marque();
      for (const couche of [0, 1]) {
        const g = couche ? p.ext.g : 0;
        const uvOrig = couche ? p.ext.uv : p.uv;
        const min = p.orig.map((c) => c - g), max = p.orig.map((c, i) => c + p.taille[i] + g);
        for (const f of facesBoite(uvOrig, p.taille, min, max)) ajouterFace(R, ip, f, min, max);
      }
      const rigide = R.fin(m);
      let scinde = null;
      if (ip >= 2) {
        const m2 = R.marque();
        for (const couche of [0, 1]) ajouterMembreScinde(R, ip - 2, p, couche);
        scinde = R.fin(m2);
      }
      return { rigide, scinde };
    });
    this.maitre = {
      local: new Float32Array(R.local), normales: new Float32Array(R.norm), partie: new Uint8Array(R.part),
      uvs: new Float32Array(R.uv), indices: new Uint32Array(R.idx),
    };
    this._configs = new Map();
    const c0 = this._config(0);   // tous les membres rigides : l'ancien maillage, 12 boites
    this.nbQuads = c0.indices.length / 6;
    this.local = c0.local; this.normales = c0.normales; this.partieDeSommet = c0.partie; this.uvs = c0.uvs; this.indices = c0.indices;
    this.positions = new Float32Array(c0.partie.length * 3);
    this.couleurs = new Float32Array(c0.partie.length * 3);
  }

  // Maillage fixe pour un masque de membres articules (bit j = LIMBES[j] plie) : groupes copies, indices recales.
  _config(masque) {
    let c = this._configs.get(masque);
    if (c) return c;
    const M = this.maitre;
    const sel = this.groupes.map((g, ip) => (ip >= 2 && ((masque >> (ip - 2)) & 1) ? g.scinde : g.rigide));
    const nV = sel.reduce((s, g) => s + g.v1 - g.v0, 0), nI = sel.reduce((s, g) => s + g.i1 - g.i0, 0);
    c = { local: new Float32Array(nV * 3), normales: new Float32Array(nV * 3), partie: new Uint8Array(nV), uvs: new Float32Array(nV * 2), indices: new Uint32Array(nI) };
    let v = 0, i = 0;
    for (const g of sel) {
      c.local.set(M.local.subarray(g.v0 * 3, g.v1 * 3), v * 3);
      c.normales.set(M.normales.subarray(g.v0 * 3, g.v1 * 3), v * 3);
      c.partie.set(M.partie.subarray(g.v0, g.v1), v);
      c.uvs.set(M.uvs.subarray(g.v0 * 2, g.v1 * 2), v * 2);
      for (let q = g.i0; q < g.i1; q++) c.indices[i++] = M.indices[q] - g.v0 + v;
      v += g.v1 - g.v0;
    }
    this._configs.set(masque, c);
    return c;
  }

  // Pose -> maillage { positions, uvs, couleurs, indices, texture, mode }.
  //   pose : { x, y, z (pieds), lacet (corps, degres), tete: [lacet, tangage], penche (degres),
  //            brasD/brasG/jambeD/jambeG: [avant, cote] (degres), accroupi (0..1), age (ticks, bras au repos),
  //            coudeD/coudeG/genouD/genouG (degres, 0..150 : flexion), dy (blocs : appui des pieds, voir compensationAppui) }
  //   lumiere : 0..1, multiplie les couleurs (lumiere du ciel a l'endroit du personnage).
  //   brut : true = pas d'ombrage ni de lumiere dans les couleurs (1,1,1) et `normales` en plus (pour un vrai pack de shaders).
  // Les tableaux positions/couleurs sont NOUVEAUX a chaque appel (le rendu garde des references).
  maillage(pose, lumiere = 1, brut = false) {
    const mats = this.matricesParties(pose);
    let masque = 0;
    LIMBES.forEach((L, j) => { if (flexion(pose, L) > 1e-4) masque |= 1 << j; });
    const cfg = this._config(masque);
    const th = (180 - (pose.lacet ?? 0)) * RAD;
    const ct = Math.cos(th), st = Math.sin(th);
    const crouch = pose.accroupi ?? 0;
    const dy = (pose.dy ?? 0) + (pose.hauteur ?? 0);
    const inc = inclinaison(pose.bascule, pose.roulis);   // null : corps droit, rendu d'avant inchange
    const nS = cfg.partie.length;
    const positions = new Float32Array(nS * 3), couleurs = new Float32Array(nS * 3);
    const normales = brut ? new Float32Array(nS * 3) : null;
    for (let s = 0; s < nS; s++) {
      const m = mats[cfg.partie[s]];
      const lx = cfg.local[s * 3], ly = cfg.local[s * 3 + 1], lz = cfg.local[s * 3 + 2];
      // repere du modele (blocs), puis chaine vers le monde
      let px = m.R[0] * lx + m.R[1] * ly + m.R[2] * lz, py = m.R[3] * lx + m.R[4] * ly + m.R[5] * lz, pz = m.R[6] * lx + m.R[7] * ly + m.R[8] * lz;
      px = px / 16 + m.t[0]; py = py / 16 + m.t[1]; pz = pz / 16 + m.t[2];
      const [wx, wy, wz] = versMonde(px, py, pz, ct, st, inc);
      positions[s * 3] = pose.x + wx; positions[s * 3 + 1] = pose.y + wy - BAISSE_ACCROUPI * crouch + dy; positions[s * 3 + 2] = pose.z + wz;
      // ombrage : normale tournee, puis mise au carre pour un passage doux entre les faces
      const nx = cfg.normales[s * 3], ny = cfg.normales[s * 3 + 1], nz = cfg.normales[s * 3 + 2];
      const rx = m.R[0] * nx + m.R[1] * ny + m.R[2] * nz, ry = m.R[3] * nx + m.R[4] * ny + m.R[5] * nz, rz = m.R[6] * nx + m.R[7] * ny + m.R[8] * nz;
      const [vx, vy, vz] = versMondeDir(rx, ry, rz, ct, st, inc);
      if (brut) { couleurs[s * 3] = 1; couleurs[s * 3 + 1] = 1; couleurs[s * 3 + 2] = 1; normales[s * 3] = vx; normales[s * 3 + 1] = vy; normales[s * 3 + 2] = vz; continue; }
      const o = ombre(vx, vy, vz) * lumiere;
      couleurs[s * 3] = o; couleurs[s * 3 + 1] = o; couleurs[s * 3 + 2] = o;
    }
    const m = { positions, uvs: cfg.uvs, couleurs, indices: cfg.indices, texture: this.texture, mode: 'decoupe' };
    if (brut) m.normales = normales;   // vrai pack de shaders : couleurs a 1 (c'est le pack qui eclaire) et normales en repere monde
    // couleur selective : `lueur` (0..1) absent = le masque protege (force 1) mais n'eclaire pas ; present = il multiplie la force
    // ET rend les pixels du masque lumineux (non assombris par la lumiere ni l'ombrage). `horsImage` = tout le corps est exempte.
    if (this.masque) { m.masque = this.masque; m.forceMasque = pose.lueur ?? 1; m.lueur = pose.lueur ?? 0; }
    if (pose.horsImage) m.exempt = true;
    if ((pose.armure || pose.objetD || pose.objetG) && this.kitDir) return habiller(this, m, pose, mats, masque, lumiere, brut);
    return m;
  }

  // Projette des sommets ajoutes (armure, objets tenus : src/objets/habillage.js) avec EXACTEMENT la chaine de `maillage` (pose, lacet,
  // accroupi, bascule, ombrage de face). `mats` : les matrices des parties (les memes que le corps, plus celles des objets) ; `ext` :
  // { local (px), normales, partie } ; retourne { positions, couleurs, normales? } (normales : repere monde, normalisees).
  projeter(ext, mats, pose, lumiere = 1, brut = false) {
    const th = (180 - (pose.lacet ?? 0)) * RAD, ct = Math.cos(th), st = Math.sin(th);
    const crouch = pose.accroupi ?? 0, dy = (pose.dy ?? 0) + (pose.hauteur ?? 0);
    const inc = inclinaison(pose.bascule, pose.roulis);
    const n = ext.partie.length;
    const positions = new Float32Array(n * 3), couleurs = new Float32Array(n * 3), normales = brut ? new Float32Array(n * 3) : null;
    for (let s = 0; s < n; s++) {
      const m = mats[ext.partie[s]];
      const lx = ext.local[s * 3], ly = ext.local[s * 3 + 1], lz = ext.local[s * 3 + 2];
      const px = (m.R[0] * lx + m.R[1] * ly + m.R[2] * lz) / 16 + m.t[0], py = (m.R[3] * lx + m.R[4] * ly + m.R[5] * lz) / 16 + m.t[1], pz = (m.R[6] * lx + m.R[7] * ly + m.R[8] * lz) / 16 + m.t[2];
      const [wx, wy, wz] = versMonde(px, py, pz, ct, st, inc);
      positions[s * 3] = pose.x + wx; positions[s * 3 + 1] = pose.y + wy - BAISSE_ACCROUPI * crouch + dy; positions[s * 3 + 2] = pose.z + wz;
      const nx = ext.normales[s * 3], ny = ext.normales[s * 3 + 1], nz = ext.normales[s * 3 + 2];
      let rx = m.R[0] * nx + m.R[1] * ny + m.R[2] * nz, ry = m.R[3] * nx + m.R[4] * ny + m.R[5] * nz, rz = m.R[6] * nx + m.R[7] * ny + m.R[8] * nz;
      const l = Math.hypot(rx, ry, rz) || 1; rx /= l; ry /= l; rz /= l;   // une echelle d'objet ne change pas l'ombrage
      const [vx, vy, vz] = versMondeDir(rx, ry, rz, ct, st, inc);
      if (brut) { couleurs[s * 3] = 1; couleurs[s * 3 + 1] = 1; couleurs[s * 3 + 2] = 1; normales[s * 3] = vx; normales[s * 3 + 1] = vy; normales[s * 3 + 2] = vz; continue; }
      const o = ombre(vx, vy, vz) * lumiere;
      couleurs[s * 3] = o; couleurs[s * 3 + 1] = o; couleurs[s * 3 + 2] = o;
    }
    return { positions, couleurs, normales };
  }

  // Rotation (R) et position du pivot (t, en blocs, repere du modele) de chaque partie : les 6 d'origine, puis pour chaque membre
  // articule les N_ARC + 1 reperes de la charniere (voir partieArt).
  matricesParties(pose) { return calculerMatrices(this.parties, pose); }
}

// Rotation d'un membre : R = Rz(cote) . Rx(-avant) . Ry(torsion), voir docs/CONCEPTION.md "Articulations libres".
// Sans torsion on garde exactement la matrice d'avant (rotZYX). cote > 0 = le membre s'ecarte du corps (< 0 : il se croise devant ou derriere) ;
// torsion > 0 = rotation interne (le bas du membre plie va vers l'axe du corps) : Ry(-torsion) a droite, Ry(+torsion) a gauche.
const LATERAL = { brasD: 1, brasG: -1, jambeD: 1, jambeG: -1 };
function rotationMembre(nom, v, balX = 0, balZ = 0) {
  const lat = LATERAL[nom];
  const R = rotZYX(-(v?.[0] ?? 0) * RAD + balX, 0, lat * (v?.[1] ?? 0) * RAD + balZ);
  const tors = v?.[2] ?? 0;
  return tors ? mult3(R, rotY(-lat * tors * RAD)) : R;
}

function calculerMatrices(parties, pose) {
  const crouch = pose.accroupi ?? 0;
  const age = pose.age ?? 0;
  const tete = pose.tete ?? [0, 0];
  const complet = !!pose.troncComplet;   // haut du corps entier autour des hanches (corps [t, penche, cote, torsion]) ; sinon le dos du jeu
  // bras au repos : leger balancement du jeu (AnimationUtils.bobModelPart) ; balD / balG (0..1) l'attenuent quand une cible tient la main
  const sD = pose.balancement !== false ? (pose.balD ?? 1) : 0, sG = pose.balancement !== false ? (pose.balG ?? 1) : 0;
  const bal = (s) => [s * Math.sin(age * 0.067) * 0.05, s * (Math.cos(age * 0.09) * 0.05 + 0.05)];   // [rx, rz]
  const bD = bal(sD), bG = bal(sG);
  const mats = parties.map((p) => {
    const piv = [...p.pivot];
    if (crouch) {  // pose accroupie du jeu : decalages des pivots (px)
      if (p.nom === 'tete') piv[1] += 4.2 * crouch;
      if (p.nom === 'corps') piv[1] += 3.2 * crouch;
      if (p.nom === 'brasD' || p.nom === 'brasG') piv[1] += 3.2 * crouch;
      if (p.nom === 'jambeD' || p.nom === 'jambeG') piv[2] += 4 * crouch;
    }
    let R;
    switch (p.nom) {
      case 'tete':   // lacet > 0 = vers la droite du joueur (-X) ; roulis > 0 = l'oreille droite vers l'epaule droite, autour de l'axe du nez (apres lacet et tangage)
        R = rotZYX(tete[1] * RAD, tete[0] * RAD, 0);
        if (tete[2]) R = mult3(R, rotZ(-tete[2] * RAD));
        break;
      case 'corps': R = rotZYX(complet ? 0 : (pose.penche ?? 0) * RAD, 0, 0); break;
      case 'brasD': R = rotationMembre('brasD', pose.brasD, bD[0], bD[1]); break;   // avant > 0 = rotation X negative
      case 'brasG': R = rotationMembre('brasG', pose.brasG, -bG[0], -bG[1]); break;
      case 'jambeD': R = rotationMembre('jambeD', pose.jambeD); break;
      default: R = rotationMembre('jambeG', pose.jambeG); break;
    }
    return { R, t: piv.map((c) => c / 16) };
  });
  // haut du corps entier : penche, cote, torsion autour des hanches (le bas du tronc) ; tete, tronc et bras suivent, les jambes restent.
  // Ru = Rz(-cote) . Rx(penche) . Ry(torsion) : la torsion tourne autour de l'axe du dos (deja penche), la penche autour de l'axe des epaules,
  // le cote autour de l'axe avant-arriere du corps. Rien de tout cela sans troncComplet : le dos du jeu (tronc seul autour du cou) est inchange.
  if (complet) {
    const Ru = mult3(mult3(rotZ(-(pose.troncCote ?? 0) * RAD), rotX((pose.penche ?? 0) * RAD)), rotY((pose.troncTorsion ?? 0) * RAD));
    const H = [0, 12 + 3.2 * crouch, 0];
    for (const nom of ['tete', 'corps', 'brasD', 'brasG']) {
      const i = parties.findIndex((p) => p.nom === nom), m = mats[i];
      const d = m.t.map((c, k) => c * 16 - H[k]), r = appliquer3(Ru, d);
      mats[i] = { R: mult3(Ru, m.R), t: r.map((c, k) => (c + H[k]) / 16) };
    }
  }
  // articulations : la charniere K est a mi-longueur du membre, dans son repere ; le pas k tourne de k/N_ARC de la flexion
  LIMBES.forEach((L, j) => {
    const p = parties[L.ip], m = mats[L.ip];
    const th = flexion(pose, L);
    const ym = p.orig[1] + p.taille[1] / 2, kz = p.orig[2] + p.taille[2] / 2 + L.signe * PIVOT_INTERIEUR * p.taille[2] / 2;
    const dK = appliquer3(m.R, [0, ym, kz]);
    const t = [m.t[0] + dK[0] / 16, m.t[1] + dK[1] / 16, m.t[2] + dK[2] / 16];
    for (let k = 0; k <= N_ARC; k++) mats[partieArt(j, k)] = { R: k === 0 || th === 0 ? m.R : mult3(m.R, rotX(L.signe * (k / N_ARC) * th)), t };
  });
  return mats;
}

// Coins de semelle des deux pieds (le bas de la boite du bas de jambe, couche externe comprise : c'est le point le plus bas du maillage).
// Retourne [{ pied: 'D'|'G', coin: 0..3, avant, haut }] : `avant` = abscisse vers l'avant du joueur (blocs, corps de face), `haut` = hauteur
// (blocs, meme repere que le decalage `dy`, 0 = sol de la pose a plat). Les jambes sont les memes en wide et en slim.
// Sert a l'appui (ci-dessous) et aux mesures de glissement du pied (test/marche.test.js, outils/marche-ik.mjs).
const PARTIES_REF = definirParties(false);
export function coinsPieds(pose) {
  const mats = calculerMatrices(PARTIES_REF, { ...pose, balancement: false });
  const coins = [];
  for (const j of [2, 3]) {
    const p = PARTIES_REF[LIMBES[j].ip], m = mats[partieArt(j, N_ARC)];
    const ym = p.orig[1] + p.taille[1] / 2, kz = p.orig[2] + p.taille[2] / 2 + LIMBES[j].signe * PIVOT_INTERIEUR * p.taille[2] / 2;
    const g = p.ext.g;
    let c = 0;
    for (const x of [p.orig[0] - g, p.orig[0] + p.taille[0] + g]) for (const z of [p.orig[2] - g, p.orig[2] + p.taille[2] + g]) {
      const l = [x, p.orig[1] + p.taille[1] + g - ym, z - kz];
      const py = (m.R[3] * l[0] + m.R[4] * l[1] + m.R[5] * l[2]) / 16 + m.t[1];
      const pz = (m.R[6] * l[0] + m.R[7] * l[1] + m.R[8] * l[2]) / 16 + m.t[2];
      coins.push({ pied: j === 2 ? 'D' : 'G', coin: c++, avant: -pz * ECHELLE, haut: -(py + DECALAGE_Y) * ECHELLE });
    }
  }
  return coins;
}
const basDesPieds = (pose) => Math.min(...coinsPieds(pose).map((c) => c.haut));

// Appui : decalage vertical (blocs) du corps pour que le pied le plus bas repose sur le sol a chaque instant (`pos` reste la position
// des pieds de la pose a plat). dy = hauteur du pied le plus bas jambes tendues et droites - hauteur du pied le plus bas de la pose :
//  - negatif quand les pieds sont plus hauts que le sol (jambes ecartees, genou porteur plie) : le corps descend, au plus de
//    DESCENTE_MAX ; au-dela la foulee est trop longue pour les jambes et les pieds flottent ;
//  - petit positif (au plus 4 cm) quand un pied qui bascule sur sa pointe passerait sous le sol ;
//  - jamais de saut : le pied le plus bas varie sans discontinuite (min de deux fonctions continues) ; les jambes ne se tendent
//    jamais plus que droites, donc le corps ne monte pas au-dessus de sa hauteur a plat de plus de ce demi-pixel.
// Zero exactement sans flexion de genou ET jambes a la verticale. (anim.js l'attenue quand l'acteur quitte le sol.)
const SOL = basDesPieds({});
export const DESCENTE_MAX = 0.12;   // blocs : amplitude maximale de l'appui (bob d'une marche : 0,02 a 0,08)
export function compensationAppui(pose, descenteMax = DESCENTE_MAX) {
  const dy = SOL - basDesPieds(pose);
  return Math.max(-descenteMax, Math.min(0.04, dy));
}

// Repere du modele (blocs, Y bas) -> monde relatif aux pieds (blocs, Y haut).
function versMonde(px, py, pz, ct, st, inc = null) {
  // decalage, echelle, symetrie (-1,-1,1)
  let x = -px * ECHELLE, y = -(py + DECALAGE_Y) * ECHELLE, z = pz * ECHELLE;
  if (inc) [x, y, z] = inc.point(x, y, z);
  return [x * ct + z * st, y, -x * st + z * ct];
}
function versMondeDir(px, py, pz, ct, st, inc = null) {
  let x = -px, y = -py, z = pz;
  if (inc) [x, y, z] = inc.dir(x, y, z);
  return [x * ct + z * st, y, -x * st + z * ct];
}

// ---------------------------------------------------------------- orientation du corps entier (bascule, roulis)
// Pivot : les hanches (haut des jambes), a 12 px de hauteur du modele = 0,704 bloc au-dessus des pieds. Repere avant le lacet :
// l'avant du joueur est -Z, sa droite +X, le haut +Y. bascule > 0 : le haut du corps part vers l'avant (90 = a plat, face au sol) ;
// roulis > 0 : le haut part vers la droite du joueur. Le roulis tourne autour de l'axe avant du monde APRES la bascule : couche sur
// le ventre (bascule 90), roulis 90 = couche sur le cote droit.
export const PIVOT_HANCHE = -(12 / 16 + DECALAGE_Y) * ECHELLE;
export function inclinaison(bascule = 0, roulis = 0) {
  if (!bascule && !roulis) return null;
  const b = (bascule || 0) * RAD, r = (roulis || 0) * RAD;
  const cb = Math.cos(b), sb = Math.sin(b), cr = Math.cos(r), sr = Math.sin(r);
  const dir = (x, y, z) => {
    const y1 = y * cb + z * sb, z1 = -y * sb + z * cb;     // bascule autour de l'axe X
    return [x * cr + y1 * sr, -x * sr + y1 * cr, z1];       // roulis autour de l'axe avant
  };
  return { dir, point: (x, y, z) => { const v = dir(x, y - PIVOT_HANCHE, z); return [v[0], v[1] + PIVOT_HANCHE, v[2]]; } };
}
// Decalage vertical (blocs) pour que le point le plus bas du corps incline touche le sol (hauteur 0 = pieds sur le sol, corps droit).
// 0 sans inclinaison. Les boites des six parties, membres tendus.
export function descenteBascule(bascule = 0, roulis = 0) {
  const inc = inclinaison(bascule, roulis);
  if (!inc) return 0;
  let bas = Infinity;
  for (const p of PARTIES_REF) {
    const g = p.ext.g;
    for (const x of [p.orig[0] - g, p.orig[0] + p.taille[0] + g]) for (const y of [p.orig[1] - g, p.orig[1] + p.taille[1] + g]) for (const z of [p.orig[2] - g, p.orig[2] + p.taille[2] + g]) {
      const [wx, wy, wz] = inc.point(-(x + p.pivot[0]) / 16 * ECHELLE, -((y + p.pivot[1]) / 16 + DECALAGE_Y) * ECHELLE, (z + p.pivot[2]) / 16 * ECHELLE);
      bas = Math.min(bas, wy); void wx; void wz;
    }
  }
  return -bas;
}
// Position des yeux (blocs, par rapport aux pieds de la pose) : 1,62 de haut (1,27 accroupi), emporte par la bascule et le roulis.
export function decalageYeux(pose) {
  const h = 1.62 - 0.35 * (pose.accroupi ?? 0);
  const inc = inclinaison(pose.bascule, pose.roulis);
  let base;
  if (!inc) base = [0, h + (pose.hauteur ?? 0), 0];
  else {
    const th = (180 - (pose.lacet ?? 0)) * RAD, ct = Math.cos(th), st = Math.sin(th);
    const [x, y, z] = inc.point(0, h, 0);
    base = [x * ct + z * st, y + (pose.hauteur ?? 0), -x * st + z * ct];
  }
  if (!pose.troncComplet || !(pose.penche || pose.troncCote || pose.troncTorsion)) return base;
  // haut du corps penche ou tourne : la tete suit (ecart entre la tete de la pose et la tete du corps droit)
  const oeil = [0, -3.632, 0];
  const pos = (po) => { const m = calculerMatrices(PARTIES_REF, { ...po, balancement: false })[0]; return appliquer3(m.R, oeil).map((c, i) => c + m.t[i] * 16); };
  const a = pos(pose), b = pos({ ...pose, penche: 0, troncCote: 0, troncTorsion: 0 });
  const th = (180 - (pose.lacet ?? 0)) * RAD, ct = Math.cos(th), st = Math.sin(th);
  const d = [-(a[0] - b[0]) / 16 * ECHELLE, -(a[1] - b[1]) / 16 * ECHELLE, (a[2] - b[2]) / 16 * ECHELLE];
  const e = inc ? inc.dir(d[0], d[1], d[2]) : d;
  return [base[0] + e[0] * ct + e[2] * st, base[1] + e[1], base[2] - e[0] * st + e[2] * ct];
}
// Ombrage doux : vaut 1,0 / 0,5 / 0,8 / 0,6 pour les normales alignees aux axes.
export function ombre(nx, ny, nz) {
  const sy = ny >= 0 ? OMBRE_HAUT : OMBRE_BAS;
  return ny * ny * sy + nz * nz * OMBRE_NS + nx * nx * OMBRE_OE;
}

// ---------------------------------------------------------------- articulations libres : reperes, points d'ancrage, geometrie des membres
// Utilise par film/cibles.js (cinematique inverse) et film/limites.js (notes). Tout est en pixels de modele, repere du modele (Y vers le bas).
const PARTIES_SLIM = definirParties(true);
export const partiesDe = (slim) => (slim ? PARTIES_SLIM : PARTIES_REF);

// Geometrie d'un membre : pivot (px), charniere K = (0, ym, 0) a mi-longueur, extremite = centre de la face du bout du segment bas
// (couche externe comprise) de coordonnees (hOff, long, 0) dans le repere de la charniere. signe : sens de la flexion autour d'X.
export function geometrieMembre(nom, slim = false) {
  const j = LIMBES.findIndex((L) => L.nom === nom);
  const L = LIMBES[j], p = partiesDe(slim)[L.ip];
  const ym = p.orig[1] + p.taille[1] / 2;
  return { nom, j, ip: L.ip, signe: L.signe, lat: LATERAL[nom], ym, hOff: p.orig[0] + p.taille[0] / 2, long: p.orig[1] + p.taille[1] + p.ext.g - ym, pivot: p.pivot };
}

// Repere du parent d'un membre : rotation R et position S (px) de son pivot, membre a plat (sa propre rotation nulle). Suit le tronc complet.
export function repereParent(pose, nom, slim = false) {
  const g = geometrieMembre(nom, slim);
  const m = calculerMatrices(partiesDe(slim), { ...pose, balancement: false, [nom]: [0, 0, 0] })[g.ip];
  return { R: m.R, S: m.t.map((c) => c * 16) };
}

// Position (px, repere du modele) de la charniere et de l'extremite d'un membre dans une pose.
export function pointsMembre(pose, nom, slim = false) {
  const g = geometrieMembre(nom, slim);
  const mats = calculerMatrices(partiesDe(slim), pose);
  const m = mats[g.ip], th = flexion(pose, LIMBES[g.j]);
  const K = m.t.map((c, i) => c * 16 + appliquer3(m.R, [0, g.ym, 0])[i]);
  const Rb = mult3(m.R, rotX(g.signe * th));
  const bout = appliquer3(Rb, [g.hOff, g.long, 0]).map((c, i) => c + K[i]);
  const milieu = appliquer3(Rb, [g.hOff, g.long - 2, 0]).map((c, i) => c + K[i]);   // le centre de la "main" (les 4 derniers px du segment)
  return { K, bout, milieu };
}

// Points d'ancrage sur le corps : [partie, x, y, z] en px dans le repere de la partie (pivot en 0,0,0 ; la surface porte la couche externe).
// Tete : x droite = -X, face avant z = -4 (chapeau -4,5), dessous y = 0 (0,5). Tronc : x +-4, y 0 (cou) a 12 (hanches), z +-2 (+0,25).
export const ANCRES = {
  menton: ['tete', 0, 0.5, -3], joue_d: ['tete', -4.5, -3, -2.5], joue_g: ['tete', 4.5, -3, -2.5], front: ['tete', 0, -5, -4.5],
  dessus_tete: ['tete', 0, -8.5, 0], nuque: ['tete', 0, -2.5, 4.5], oreille_d: ['tete', -4.5, -4, 0], oreille_g: ['tete', 4.5, -4, 0], bouche: ['tete', 0, -2, -4.5],
  poitrine: ['corps', 0, 3.5, -2.25], ventre: ['corps', 0, 8, -2.25], dos: ['corps', 0, 8, 2.25],
  hanche_d: ['corps', -4.25, 10, -0.5], hanche_g: ['corps', 4.25, 10, -0.5], poche_d: ['corps', -3.2, 10.5, -2.25], poche_g: ['corps', 3.2, 10.5, -2.25],
  epaule_d: ['corps', -3.5, -0.3, -0.3], epaule_g: ['corps', 3.5, -0.3, -0.3],
  genou_d: ['jambeD', 0, 6, -2.25], genou_g: ['jambeG', 0, 6, -2.25],
};
export const NOMS_ANCRES = Object.keys(ANCRES);
const IP = { tete: 0, corps: 1, brasD: 2, brasG: 3, jambeD: 4, jambeG: 5 };
export function pointAncre(nom, mats) {
  const [partie, x, y, z] = ANCRES[nom], m = mats[IP[partie]];
  return appliquer3(m.R, [x, y, z]).map((c, i) => c + m.t[i] * 16);
}

// Repere de l'acteur (blocs, relatif aux pieds ; avant du corps a lacet 0 = +Z, droite = -X, haut = +Y) -> repere du modele (px).
// C'est l'inverse de `maillage` (dy, hauteur, accroupi, lacet, bascule/roulis). dir : seulement une direction (pas de translation ni d'echelle).
export function versModele(pose, rel, dir = false) {
  let [x, y, z] = rel;
  if (!dir) y = y + BAISSE_ACCROUPI * (pose.accroupi ?? 0) - ((pose.dy ?? 0) + (pose.hauteur ?? 0));
  const th = (180 - (pose.lacet ?? 0)) * RAD, ct = Math.cos(th), st = Math.sin(th);
  [x, z] = [x * ct - z * st, x * st + z * ct];                     // annule le lacet
  const b = (pose.bascule ?? 0) * RAD, r = (pose.roulis ?? 0) * RAD;
  if (b || r) {                                                    // annule bascule et roulis (autour des hanches)
    if (!dir) y -= PIVOT_HANCHE;
    const cb = Math.cos(b), sb = Math.sin(b), cr = Math.cos(r), sr = Math.sin(r);
    const xr = x * cr - y * sr, y1 = x * sr + y * cr;
    [x, y, z] = [xr, y1 * cb - z * sb, y1 * sb + z * cb];
    if (!dir) y += PIVOT_HANCHE;
  }
  if (dir) return [-x, -y, z];
  return [-x / ECHELLE * 16, (-y / ECHELLE - DECALAGE_Y) * 16, z / ECHELLE * 16];
}

// Les mains sont-elles dans la tete ou le tronc ? (centre de la main dans la boite, retrecie de 0,5 px). Retourne [{ membre, dans }].
export function mainsDansCorps(pose, slim = false) {
  const mats = calculerMatrices(partiesDe(slim), pose), res = [];
  const dans = (p, m, [x0, x1, y0, y1, z0, z1]) => {
    const l = [0, 1, 2].map((i) => p[i] - m.t[i] * 16);
    const q = [m.R[0] * l[0] + m.R[3] * l[1] + m.R[6] * l[2], m.R[1] * l[0] + m.R[4] * l[1] + m.R[7] * l[2], m.R[2] * l[0] + m.R[5] * l[1] + m.R[8] * l[2]];
    return q[0] > x0 && q[0] < x1 && q[1] > y0 && q[1] < y1 && q[2] > z0 && q[2] < z1;
  };
  for (const nom of ['brasD', 'brasG']) {
    const { milieu } = pointsMembre(pose, nom, slim);
    if (dans(milieu, mats[0], [-3.5, 3.5, -7.5, -0.5, -3.5, 3.5])) res.push({ membre: nom, dans: 'tete' });
    else if (dans(milieu, mats[1], [-3.5, 3.5, 0.5, 11.5, -1.5, 1.5])) res.push({ membre: nom, dans: 'corps' });
  }
  return res;
}
export const matricesPose = (pose, slim = false) => calculerMatrices(partiesDe(slim), pose);
export const matriceMembre = (nom, v) => rotationMembre(nom, v);   // rotation de l'epaule ou de la hanche pour [avant, cote, torsion], sans balancement

// ---------------------------------------------------------------- pour src/objets/ (armure, objets tenus) : memes briques que le corps
export { Reservoir, ajouterFace, ajouterMembreScinde, calculerMatrices, partieArt, LIMBES, N_ARC, flexion, mult3, rotX, rotY, appliquer3 };
