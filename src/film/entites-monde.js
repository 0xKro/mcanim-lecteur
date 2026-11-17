// Entites non vivantes du monde simule, dessinees comme maillages dynamiques (lus dans la colonne `entites` du replay, deterministes) :
//   - TNT amorce : le bloc TNT (1 bloc de cote), qui clignote en BLANC quand meche / 5 est pair (TntRenderer : face blanche pleine) et gonfle
//     pendant les 10 derniers ticks : echelle 1 + 0,3 x (1 - (meche + 1 - partiel) / 10)^4
//   - bloc qui tombe (sable, gravier, enclume, beton en poudre) : son vrai modele de bloc (enclume orientee, par exemple), pas un cube
//   - bloc en mouvement d'un piston (type `piston`) : le modele de l'etat deplace (ou la tete du piston), a la position interpolee entre deux ticks
//   - projectiles : fleche (modele du jeu : deux plans croises a 45 degres et la plaque de plumes, 16 px x 0,05625), fleche plantee, trident ; objets lances (boule
//     de neige, oeuf, perle, potion) : le sprite de l'objet, de face a la camera (ThrownItemRenderer)
//   - objet au sol (ItemEntity) : le modele d'objet du jeu (plat extrude ou bloc) avec l'affichage `ground`, qui tourne (age / 20 + decalage) et flotte
//     (sin(age / 10 + decalage) x 0,1 + 0,1), 1 a 5 copies selon le nombre ; reutilise le rendu des objets tenus (src/objets)
import { resoudreObjet } from '../objets/definition.js';
import { cuire, afficheDe } from '../objets/modele-objet.js';
import { texture as texObjet, teinter, groupePresent } from '../objets/fichiers.js';

const RAD = Math.PI / 180;
const OMBRE_DIR = [0.5, 1, 0.8, 0.8, 0.6, 0.6];       // bas, haut, nord, sud, ouest, est

class Mailleur {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; }
  quad(p, uv, c) {       // 4 sommets quelconques (le rasteriseur dessine les deux faces)
    const b = this.pos.length / 3;
    for (let i = 0; i < 4; i++) { this.pos.push(p[i][0], p[i][1], p[i][2]); this.uv.push(uv[i][0], uv[i][1]); this.col.push(c, c, c); }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  vide() { return this.idx.length === 0; }
  maillage(texture, genre) { return { genre, positions: Float32Array.from(this.pos), uvs: Float32Array.from(this.uv), couleurs: Float32Array.from(this.col), indices: Uint32Array.from(this.idx), texture, mode: 'decoupe', deuxFaces: true }; }
}

// hasard deterministe d'une entite (decalage de rotation, copies d'une pile) : pas de Math.random
const hash = (n) => { let h = (n * 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };

// rotations de l'affichage (degres), dans l'ordre du jeu : echelle, Z, Y, X, translation
function transformer(p, aff) {
  let x = p[0] - 0.5, y = p[1] - 0.5, z = p[2] - 0.5;
  const s = aff ? aff.scale : [1, 1, 1];
  x *= s[0]; y *= s[1]; z *= s[2];
  if (aff) {
    const [rx, ry, rz] = aff.rotation.map((d) => d * RAD);
    let c = Math.cos(rz), n = Math.sin(rz); [x, y] = [x * c - y * n, x * n + y * c];
    c = Math.cos(ry); n = Math.sin(ry); [x, z] = [x * c + z * n, -x * n + z * c];
    c = Math.cos(rx); n = Math.sin(rx); [y, z] = [y * c - z * n, y * n + z * c];
    x += aff.translation[0]; y += aff.translation[1]; z += aff.translation[2];
  }
  return [x, y, z];
}

// Texture de la fleche (16 x 10) dessinee ici : le kit n'a pas entity/projectiles/arrow.png. Haut (16 x 5) : vue de cote (plumes, hampe, pointe) ; bas gauche (5 x 5) : plumes vues de face.
let TEX_FLECHE = null;
function texFleche() {
  if (TEX_FLECHE) return TEX_FLECHE;
  const W = 16, H = 10, rgba = new Uint8Array(W * H * 4);
  const px = (x, y, c) => { const i = (y * W + x) * 4; rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255; };
  const bois = [128, 96, 56], boisSombre = [98, 72, 40], plume = [236, 236, 232], plumeOmbre = [190, 190, 186], pointe = [150, 150, 154], pointeSombre = [96, 96, 100];
  for (let x = 3; x < 13; x++) { px(x, 1, boisSombre); px(x, 2, x % 3 === 0 ? boisSombre : bois); px(x, 3, boisSombre); }
  for (let x = 0; x < 4; x++) for (let y = 0; y < 5; y++) { if (Math.abs(y - 2) <= (x === 0 ? 2 : x === 1 ? 2 : 1)) px(x, y, (x + y) % 2 ? plume : plumeOmbre); }
  px(2, 2, bois); px(3, 2, bois);
  for (let x = 13; x < 16; x++) for (let y = 1; y <= 3; y++) { if (Math.abs(y - 2) <= (x === 15 ? 0 : 1)) px(x, y, (x + y) % 2 ? pointe : pointeSombre); }
  px(13, 2, pointe);
  for (let y = 5; y < 10; y++) for (let x = 0; x < 5; x++) { if (Math.abs(x - 2) + Math.abs(y - 7) <= 3 || x === 2 || y === 7) px(x, y, (x + y) % 2 ? plume : plumeOmbre); }
  px(2, 7, bois);
  TEX_FLECHE = { largeur: W, hauteur: H, rgba };
  return TEX_FLECHE;
}

export function creerEntites({ rs, replay, kit, texOf, lum, notes }) {
  const E = replay.entitesVue, n = E.length / 8;
  if (!n) return { maillages: () => [] };
  const parId = new Map();
  for (let i = 0; i < n; i++) { const id = E[i * 8 + 1]; if (!parId.has(id)) parId.set(id, []); parId.get(id).push(i * 8); }
  const palette = [...rs.zone.palette, ...replay.palAjouts];
  const vus = new Set();
  const note = (t) => { if (!vus.has(t)) { vus.add(t); notes.push(t); } };
  const blanches = new Map();
  const texBlanche = (nom) => {            // la texture avec tous les pixels blancs (alpha gardee) : le clignotement du TNT
    if (!blanches.has(nom)) { const t = texOf(nom + '.png'); blanches.set(nom, t ? { largeur: t.largeur, hauteur: t.hauteur, rgba: t.rgba.map((v, i) => (i % 4 === 3 ? v : 255)) } : null); }
    return blanches.get(nom);
  };

  // ---- modeles de blocs (blocs qui tombent) : quads de l'etat, par texture
  const cacheBloc = new Map();
  const quadsBloc = (pal) => {
    if (cacheBloc.has(pal)) return cacheBloc.get(pal);
    let r = [];
    try { const e = rs.modeles.etat(palette[pal]); r = e.geo.map((q) => ({ p: q.p, uv: q.uv, tex: q.sprite.nom, ombre: OMBRE_DIR[q.dirOmbre] ?? 1 })); } catch { r = []; }
    if (!r.length) note('bloc qui tombe : modele introuvable pour ' + String(palette[pal]).replace(/\[.*/, ''));
    cacheBloc.set(pal, r);
    return r;
  };

  // ---- modeles d'objets (objets au sol) : quads du modele d'objet, affichage `ground`
  const cacheObjet = new Map();
  const quadsObjet = (id) => {
    if (cacheObjet.has(id)) return cacheObjet.get(id);
    let r = { quads: [], aff: null };
    if (kit && groupePresent(kit, 'objets')) {
      const def = resoudreObjet(kit, id);
      for (const e of def.entrees) {
        if (e.model === undefined) continue;
        const c = cuire(kit, e, { signaler: note });
        const aff = afficheDe(kit, e.model, false, 'ground');
        for (const q of c.quads) r.quads.push({ p: q.p, uv: q.uv, tex: q.tex, tint: q.tint, normale: null });
        if (!r.aff) r.aff = aff;
      }
    }
    if (!r.quads.length) {                    // repli : le modele du bloc du meme nom, a l'echelle 1/4 des objets-blocs au sol
      try {
        const e = rs.modeles.etat('minecraft:' + id);
        r = { quads: e.geo.map((q) => ({ p: q.p, uv: q.uv, tex: q.sprite.nom, tint: null })), aff: { rotation: [0, 0, 0], translation: [0, 0.1875, 0], scale: [0.25, 0.25, 0.25] } };
      } catch { /* aucun modele */ }
    }
    if (!r.quads.length) note(`objet au sol : modele introuvable pour ${id} (les fichiers d'objets du kit sont-ils la ?)`);
    cacheObjet.set(id, r);
    return r;
  };
  const teintees = new Map();
  const textureDe = (tex, tint) => {
    const cle = tex + '|' + (tint ?? '');
    if (!teintees.has(cle)) { const t = (kit ? texObjet(kit, tex) : null) ?? texOf(tex + '.png'); teintees.set(cle, t ? (tint === null || tint === undefined ? t : teinter(t, tint)) : null); }
    return teintees.get(cle);
  };

  return {
    maillages(u, camera) {
      const tick = Math.floor(u), f = u - tick, parTex = new Map();
      const M = (cle, texture, genre) => { if (!parTex.has(cle)) parTex.set(cle, { texture, genre, m: new Mailleur() }); return parTex.get(cle).m; };
      for (const lignes of parId.values()) {
        const t0 = E[lignes[0]], k = tick - t0;
        if (k < 0 || k >= lignes.length) continue;
        const a = lignes[k], b = lignes[Math.min(k + 1, lignes.length - 1)];
        const x = E[a + 3] + (E[b + 3] - E[a + 3]) * f, y = E[a + 4] + (E[b + 4] - E[a + 4]) * f, z = E[a + 5] + (E[b + 5] - E[a + 5]) * f;
        const type = replay.noms[E[a + 2]], id = E[a + 1];
        if (type === 'tnt') {
          const meche = E[a + 6], fl = Math.floor(meche / 5) % 2 === 0;    // clignote en blanc quand meche / 5 est pair
          const ff = meche + 1 - f;
          let ech = 1;
          if (ff < 10) { let g = Math.max(0, Math.min(1, 1 - ff / 10)); g *= g; g *= g; ech = 1 + g * 0.3; }
          const h = 0.5 * ech, L = lum(x, y + 0.5, z), cy = y + 0.5;
          const F = [   // sud, nord, ouest, est, haut, bas (HG, HD, BD, BG vus de l'exterieur)
            [[-h, h, h], [h, h, h], [h, -h, h], [-h, -h, h]], [[h, h, -h], [-h, h, -h], [-h, -h, -h], [h, -h, -h]],
            [[-h, h, -h], [-h, h, h], [-h, -h, h], [-h, -h, -h]], [[h, h, h], [h, h, -h], [h, -h, -h], [h, -h, h]],
            [[-h, h, -h], [h, h, -h], [h, h, h], [-h, h, h]], [[-h, -h, h], [h, -h, h], [h, -h, -h], [-h, -h, -h]],
          ];
          const noms = ['block/tnt_side', 'block/tnt_side', 'block/tnt_side', 'block/tnt_side', 'block/tnt_top', 'block/tnt_bottom'], ombre = [0.8, 0.8, 0.6, 0.6, 1, 0.5];
          for (let i = 0; i < 6; i++) {
            const nom = fl ? 'blanc|' + noms[i] : noms[i], tex = fl ? texBlanche(noms[i]) : texOf(noms[i] + '.png');
            if (!tex) continue;
            M(nom, tex, 'tnt').quad(F[i].map((p) => [x + p[0], cy + p[1], z + p[2]]), [[0, 0], [1, 0], [1, 1], [0, 1]], fl ? 1 : ombre[i] * L);
          }
        } else if (type === 'chute' || (type === 'piston' && k < lignes.length - 1)) {   // bloc en mouvement d'un piston : meme dessin ; le dernier enregistrement est celui du tick ou le vrai bloc est pose
          const L = lum(x, y + 0.5, z);
          for (const q of quadsBloc(E[a + 7])) {
            const tex = textureDe(q.tex, null);
            if (!tex) continue;
            M('b|' + q.tex, tex, 'chute').quad(q.p.map((p) => [x + p[0] - 0.5, y + p[1], z + p[2] - 0.5]), q.uv, q.ombre * L);
          }
        } else if (type === 'fleche' || type === 'fleche_plantee' || type === 'trident' || type === 'trident_plantee') {
          // direction : lacet et tangage du replay (tangage > 0 vers le bas), repere (avant, droite, haut) puis les deux plans a 45 degres et la plaque de plumes
          const ya = E[a + 6] * RAD, pa = E[a + 7] * RAD, dx = -Math.sin(ya) * Math.cos(pa), dy = -Math.sin(pa), dz = Math.cos(ya) * Math.cos(pa);
          const L = lum(x, y, z);
          if (type.startsWith('trident')) {
            const sp = quadsObjet('trident'), nomTex = sp.quads[0]?.tex;
            if (!nomTex) continue;
            const t = textureDe(nomTex, null);
            if (!t) continue;
            const cam = camera ?? { x: x, y: y + 5, z: z };
            const n = [cam.x - x, cam.y - y, cam.z - z], nl = Math.hypot(...n) || 1, nn = n.map((c) => c / nl);
            let w = [nn[1] * dz - nn[2] * dy, nn[2] * dx - nn[0] * dz, nn[0] * dy - nn[1] * dx];
            const wl = Math.hypot(...w) || 1; w = w.map((c) => c / wl);
            const s = 0.55 * 0.7071, R = [(dx - w[0]) * s, (dy - w[1]) * s, (dz - w[2]) * s], U = [(dx + w[0]) * s, (dy + w[1]) * s, (dz + w[2]) * s];
            M('trident|' + nomTex, t, 'objet').quad([[x - R[0] + U[0], y - R[1] + U[1], z - R[2] + U[2]], [x + R[0] + U[0], y + R[1] + U[1], z + R[2] + U[2]], [x + R[0] - U[0], y + R[1] - U[1], z + R[2] - U[2]], [x - R[0] - U[0], y - R[1] - U[1], z - R[2] - U[2]]], [[0, 0], [1, 0], [1, 1], [0, 1]], L);
            continue;
          }
          let r = Math.abs(dy) > 0.99 ? [1, 0, 0] : [dz, 0, -dx];
          const rl = Math.hypot(...r) || 1; r = r.map((c) => c / rl);
          const up = [r[1] * dz - r[2] * dy, r[2] * dx - r[0] * dz, r[0] * dy - r[1] * dx];
          const K = 0.05625, queue = -11 * K, pointe = 5 * K, h = 2.5 * K;
          const P = (c, lat, hau) => [x + dx * c + lat[0] * hau, y + dy * c + lat[1] * hau, z + dz * c + lat[2] * hau];
          const axes = [[(up[0] + r[0]) * 0.7071, (up[1] + r[1]) * 0.7071, (up[2] + r[2]) * 0.7071], [(up[0] - r[0]) * 0.7071, (up[1] - r[1]) * 0.7071, (up[2] - r[2]) * 0.7071]];
          const T = texFleche();
          for (const ax of axes) M('fleche', T, 'fleche').quad([P(queue, ax, h), P(pointe, ax, h), P(pointe, ax, -h), P(queue, ax, -h)], [[0, 0], [1, 0], [1, 0.5], [0, 0.5]], L);
          M('fleche', T, 'fleche').quad([P(queue, up, h), P(queue, r, h), P(queue, up, -h), P(queue, r, -h)], [[0, 0.5], [0.3125, 0.5], [0.3125, 1], [0, 1]], L);
        } else if (type === 'lance') {
          // sprite de l'objet lance, de face a la camera (taille 0,5 comme l'affichage ground)
          const nom = replay.noms[E[a + 7]], modele = quadsObjet(nom), nomTex = modele.quads[0]?.tex;
          if (!nomTex) continue;
          const t = textureDe(nomTex, null);
          if (!t) continue;
          const cam = camera ?? { lacet: 0, tangage: 0 }, ya = (cam.lacet ?? 0) * RAD, pa = (cam.tangage ?? 0) * RAD;
          const fw = [-Math.sin(ya) * Math.cos(pa), -Math.sin(pa), Math.cos(ya) * Math.cos(pa)], rr = [-Math.cos(ya), 0, -Math.sin(ya)];
          const hh = [rr[1] * fw[2] - rr[2] * fw[1], rr[2] * fw[0] - rr[0] * fw[2], rr[0] * fw[1] - rr[1] * fw[0]], s = 0.25, L = lum(x, y, z), cy = y + 0.125;
          M('lance|' + nomTex, t, 'objet').quad([[x - rr[0] * s + hh[0] * s, cy - rr[1] * s + hh[1] * s, z - rr[2] * s + hh[2] * s], [x + rr[0] * s + hh[0] * s, cy + rr[1] * s + hh[1] * s, z + rr[2] * s + hh[2] * s], [x + rr[0] * s - hh[0] * s, cy + rr[1] * s - hh[1] * s, z + rr[2] * s - hh[2] * s], [x - rr[0] * s - hh[0] * s, cy - rr[1] * s - hh[1] * s, z - rr[2] * s - hh[2] * s]], [[0, 0], [1, 0], [1, 1], [0, 1]], L);
        } else if (type === 'objet') {
          const nom = replay.noms[E[a + 7]], N = E[a + 6], modele = quadsObjet(nom);
          if (!modele.quads.length) continue;
          const age = k + f, decal = hash(id) * 2 * Math.PI;
          const spin = age / 20 + decal, bob = Math.sin(age / 10 + decal) * 0.1 + 0.1, ey = modele.aff ? modele.aff.scale[1] : 1;
          const copies = N > 48 ? 5 : N > 32 ? 4 : N > 16 ? 3 : N > 1 ? 2 : 1;
          const cs = Math.cos(spin), sn = Math.sin(spin), L = lum(x, y + 0.2, z);
          for (let c = 0; c < copies; c++) {
            const dx = c ? (hash(id * 7 + c) * 2 - 1) * 0.15 * 0.5 : 0, dy = c ? (hash(id * 11 + c) * 2 - 1) * 0.15 * 0.5 : 0, dz = c ? (hash(id * 13 + c) * 2 - 1) * 0.15 * 0.5 : 0;
            for (const q of modele.quads) {
              const tex = textureDe(q.tex, q.tint);
              if (!tex) continue;
              const P = q.p.map((p) => { const [px, py, pz] = transformer(p, modele.aff); return [x + px * cs + pz * sn + dx, y + bob + 0.25 * ey + py + dy, z - px * sn + pz * cs + dz]; });
              const A = P[0], B = P[1], C = P[2], ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
              const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
              const ombre = 0.75 + 0.25 * Math.abs(ny / l);       // eclairage plat des objets : le dessus un peu plus clair
              M('o|' + q.tex + '|' + (q.tint ?? ''), tex, 'objet').quad(P, q.uv, ombre * L);
            }
          }
        }
      }
      const out = [];
      for (const { texture, genre, m } of parTex.values()) if (!m.vide()) out.push(m.maillage(texture, genre));
      return out;
    },
  };
}
