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
import { Aleatoire } from '../moteur/aleatoire.js';
import { aReflet, cuireReflet, idRendu } from '../objets/reflet.js';   // reflet des objets enchantes au sol (partie 26)
import { rotationVrille } from './acteurs-vivants.js';   // Impulsion : pose et tourbillon (partie 26)

const RAD = Math.PI / 180;
const OMBRE_DIR = [0.5, 1, 0.8, 0.8, 0.6, 0.6];       // bas, haut, nord, sud, ouest, est

class Mailleur {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; }
  quad(p, uv, c) {       // 4 sommets quelconques (le rasteriseur dessine les deux faces) ; c : gris, [r, g, b], ou 4 couleurs [[r, g, b] x 4]
    const b = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2]); this.uv.push(uv[i][0], uv[i][1]);
      const k = Array.isArray(c) ? (Array.isArray(c[0]) ? c[i] : c) : null;
      if (k) this.col.push(k[0], k[1], k[2]); else this.col.push(c, c, c);
    }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  vide() { return this.idx.length === 0; }
  maillage(texture, genre) {
    const m = { genre, positions: Float32Array.from(this.pos), uvs: Float32Array.from(this.uv), couleurs: Float32Array.from(this.col), indices: Uint32Array.from(this.idx), texture, mode: 'decoupe', deuxFaces: true };
    if (genre === 'lumiere') { m.mode = 'melange'; m.additif = true; m.emissif = true; }   // rayons (laser du gardien, cristal, mort du dragon) : additifs, pleine lumiere
    return m;
  }
}

// ModelPart.translateAndRotate (pixels, radians) : parent . T(x, y, z) / 16 . Rz . Ry . Rx (. echelle)
function matPartie(P, q) {
  const mul = (A, B) => { const R = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let v = 0; for (let k = 0; k < 4; k++) v += A[i * 4 + k] * B[k * 4 + j]; R[i * 4 + j] = v; } return R; };
  const c = (v) => Math.cos(v), s = (v) => Math.sin(v);
  const T4 = [1, 0, 0, q[0] / 16, 0, 1, 0, q[1] / 16, 0, 0, 1, q[2] / 16, 0, 0, 0, 1];
  const RZ = [c(q[5]), -s(q[5]), 0, 0, s(q[5]), c(q[5]), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], RY = [c(q[4]), 0, s(q[4]), 0, 0, 1, 0, 0, -s(q[4]), 0, c(q[4]), 0, 0, 0, 0, 1], RX = [1, 0, 0, 0, 0, c(q[3]), -s(q[3]), 0, 0, s(q[3]), c(q[3]), 0, 0, 0, 0, 1];
  let M = mul(mul(mul(mul(P, T4), RZ), RY), RX);
  if (q[6] !== 1 || q[7] !== 1 || q[8] !== 1) M = mul(M, [q[6], 0, 0, 0, 0, q[7], 0, 0, 0, 0, q[8], 0, 0, 0, 0, 1]);
  return M;
}
// la texture repetee deux fois en largeur (le defilement de la charge de vent sort de [0, 1] ; le rendu ne repete pas les UV)
const repetees = new WeakMap();
function texRepetee(t) {
  if (repetees.has(t)) return repetees.get(t);
  const W = t.largeur, H = t.hauteur, rgba = new Uint8Array(W * 2 * H * 4);
  for (let y = 0; y < H; y++) for (let k = 0; k < 2; k++) rgba.set(t.rgba.subarray(y * W * 4, (y + 1) * W * 4), (y * W * 2 + k * W) * 4);
  const r = { largeur: W * 2, hauteur: H, rgba, repete: true };
  repetees.set(t, r);
  return r;
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

// Texture de repli de la fleche (16 x 10) dessinee ici, pour un kit sans le groupe `projectiles` (entity/projectiles/arrow.png, vraie texture 32 x 32). Haut (16 x 5) : vue de cote (plumes, hampe, pointe) ; bas gauche (5 x 5) : plumes vues de face.
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

export function creerEntites({ rs, replay, kit, texOf, lum, notes, creatures = null }) {
  const E = replay.entitesVue, n = E.length / 8;
  const traits = new Map();   // replay.traits par tick (laser du gardien, rayon du cristal de l'End, rayons de la mort du dragon)
  for (const t of replay.traits ?? []) { const k = Math.round(t.tick); if (!traits.has(k)) traits.set(k, []); traits.get(k).push(t); }
  if (!n && !traits.size) return { maillages: () => [] };
  const parId = new Map();
  for (let i = 0; i < n; i++) { const id = E[i * 8 + 1]; if (!parId.has(id)) parId.set(id, []); parId.get(id).push(i * 8); }
  const palette = [...rs.zone.palette, ...replay.palAjouts];
  const vus = new Set();
  const note = (t) => { if (!vus.has(t)) { vus.add(t); notes.push(t); } };
  const blanches = new Map();
  // clignotement du TNT amorce (TntMinecartRenderer.submitWhiteSolidBlock) : surcouche blanche OverlayTexture.u(1) (alpha 63/255) :
  // texel = melange(blanc, texture, 63/255), eclaire normalement
  const texBlanche = (nom, tex0 = null) => {
    if (!blanches.has(nom)) { const t = tex0 ?? texOf(nom + '.png'); blanches.set(nom, t ? { largeur: t.largeur, hauteur: t.hauteur, rgba: t.rgba.map((v, i) => (i % 4 === 3 ? v : Math.round(255 + (v - 255) * 63 / 255))) } : null); }
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
  const quadsObjet = (brut) => {
    if (cacheObjet.has(brut)) return cacheObjet.get(brut);
    const id = idRendu(brut);   // une pile avec composants (enchantements : moteur/pile.js) : le modele de l'objet, et son reflet
    let r = { quads: [], aff: null, reflet: aReflet(brut, replay.refletsForces) };
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
    cacheObjet.set(brut, r);
    return r;
  };
  const teintees = new Map();
  const textureDe = (tex, tint) => {
    const cle = tex + '|' + (tint ?? '');
    if (!teintees.has(cle)) { const t = (kit ? texObjet(kit, tex) : null) ?? texOf(tex + '.png'); teintees.set(cle, t ? (tint === null || tint === undefined ? t : teinter(t, tint)) : null); }
    return teintees.get(cle);
  };

  const blancTex = { largeur: 1, hauteur: 1, rgba: new Uint8Array([255, 255, 255, 255]) };
  const noirTex = { largeur: 1, hauteur: 1, rgba: new Uint8Array([0, 0, 0, 255]) };   // fil de peche (FishingHookRenderer : lignes noires)
  // main du pecheur par bouchon et par tick (moteur/peche.js : replay.peche [tick, id, x, y, z])
  const mainsPeche = new Map();
  for (const [tk, id2, hx, hy, hz] of replay.peche ?? []) { if (!mainsPeche.has(id2)) mainsPeche.set(id2, new Map()); mainsPeche.get(id2).set(tk, [hx, hy, hz]); }
  // rayons entre deux points (replay.traits)
  function dessinerTrait(t, u, M) {
    const [ax, ay, az] = t.de, [bx, by, bz] = t.vers;
    if (t.type === 'laser') {
      // GuardianRenderer.renderBeam : deux plans croises qui tournent (rayon 0,2), texture guardian_beam qui defile (V x 2,5 par bloc),
      // couleur (64 + s^2 x 191, 32 + s^2 x 191, 128 - s^2 x 64) selon la charge s ; pleine lumiere
      const tx = textureDe('entity/guardian_beam', null); if (!tx) return;
      const v = [bx - ax, by - ay, bz - az], L = Math.hypot(...v) || 1, d = v.map((c) => c / L);
      let r = Math.abs(d[1]) > 0.99 ? [1, 0, 0] : [d[2], 0, -d[0]]; const rl = Math.hypot(...r); r = r.map((c) => c / rl);
      const up = [r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]];
      const temps = u, rot = temps * 0.05 * -1.5, cs = t.a * t.a, col = [(64 + cs * 191) / 255, (32 + cs * 191) / 255, Math.max(0, 128 - cs * 64) / 255];
      const P = (s, ang, rad) => [ax + d[0] * s + (r[0] * Math.cos(ang) + up[0] * Math.sin(ang)) * rad, ay + d[1] * s + (r[1] * Math.cos(ang) + up[1] * Math.sin(ang)) * rad, az + d[2] * s + (r[2] * Math.cos(ang) + up[2] * Math.sin(ang)) * rad];
      const minV = -1 + (temps * 0.5) % 1, maxV = minV + L * 2.5, len = L + 1;
      for (let k0 = Math.floor(minV); k0 < maxV; k0++) {
        const v0 = Math.max(minV, k0), v1 = Math.min(maxV, k0 + 1), s0 = (v0 - minV) / (maxV - minV) * len, s1 = (v1 - minV) / (maxV - minV) * len;
        for (const a0 of [rot + Math.PI, rot + Math.PI / 2]) M('laser', tx, 'lumiere').quad([P(s1, a0, 0.2), P(s0, a0, 0.2), P(s0, a0 + Math.PI, 0.2), P(s1, a0 + Math.PI, 0.2)], [[0.4999, v1 - k0], [0.4999, v0 - k0], [0, v0 - k0], [0, v1 - k0]], col);
      }
    } else if (t.type === 'cristal') {
      // EnderDragonRenderer.renderCrystalBeams : un tube de 8 faces du dragon (rayon 0,15, noir) au cristal (rayon 0,75, blanc ; le cristal
      // monte de getY), texture end_crystal_beam qui defile de 0,01 par tick
      const tx = textureDe('entity/end_crystal/end_crystal_beam', null); if (!tx) return;
      const f0 = Math.sin(u * 0.2) / 2 + 0.5, cy = ay + ((f0 * f0 + f0) * 0.4 - 1.4) + 1 + 1.5;   // haut du cristal (getY), echelle 2
      const v = [ax - bx, cy - by, az - bz], L = Math.hypot(...v) || 1, d = v.map((c) => c / L);
      let r = Math.abs(d[1]) > 0.99 ? [1, 0, 0] : [d[2], 0, -d[0]]; const rl = Math.hypot(...r); r = r.map((c) => c / rl);
      const up = [r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]];
      const v2 = -u * 0.01, v3 = L / 32 - u * 0.01;
      const P = (s, ang, rad) => [bx + d[0] * s + (r[0] * Math.sin(ang) + up[0] * Math.cos(ang)) * rad, by + d[1] * s + (r[1] * Math.sin(ang) + up[1] * Math.cos(ang)) * rad, bz + d[2] * s + (r[2] * Math.sin(ang) + up[2] * Math.cos(ang)) * rad];
      for (let j = 1; j <= 8; j++) {
        const a0 = (j - 1) * Math.PI * 2 / 8, a1 = j * Math.PI * 2 / 8, u0 = (j - 1) / 8, u1 = j / 8;
        M('cristal', tx, 'lumiere').quad([P(0, a0, 0.15), P(L, a0, 0.75), P(L, a1, 0.75), P(0, a1, 0.15)], [[u0, v2], [u0, v3], [u1, v3], [u1, v2]], [[0, 0, 0], [1, 1, 1], [1, 1, 1], [0, 0, 0]]);
      }
    } else if (t.type === 'rayons') {
      // rayons de la mort du dragon : (f + f^2) / 2 x 60 triangles, hasard fixe (graine 432), blanc au centre -> magenta transparent au bout,
      // longueur 5 a 25 (+ 10 apres 0,8), largeur 1 a 3 ; ils palissent apres 0,8 (additifs)
      const f = Math.min(1, t.a / 200), f5 = Math.min(f > 0.8 ? (f - 0.8) / 0.2 : 0, 1), n = Math.floor((f + f * f) / 2 * 60);
      const h = new Aleatoire(432), c0 = [1 - f5, 1 - f5, 1 - f5], c1 = [0, 0, 0];
      let Q = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      const mulM = (A, B) => { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C; };
      const RX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)], RY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)], RZ = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
      const ap = (M3, p) => [ax + M3[0] * p[0] + M3[1] * p[1] + M3[2] * p[2], ay + M3[3] * p[0] + M3[4] * p[1] + M3[5] * p[2], az + M3[6] * p[0] + M3[7] * p[1] + M3[8] * p[2]];
      const T2 = Math.PI * 2, S3 = Math.sqrt(3) / 2;
      for (let k = 0; k < n; k++) {
        Q = mulM(Q, mulM(mulM(RX(h.flottant() * T2), RY(h.flottant() * T2)), RZ(h.flottant() * T2)));
        Q = mulM(Q, mulM(mulM(RX(h.flottant() * T2), RY(h.flottant() * T2)), RZ(h.flottant() * T2 + f * Math.PI / 2)));
        const lo = h.flottant() * 20 + 5 + f5 * 10, la = h.flottant() * 2 + 1 + f5 * 2;
        const p0 = ap(Q, [0, 0, 0]), p1 = ap(Q, [-S3 * la, lo, -0.5 * la]), p2 = ap(Q, [S3 * la, lo, -0.5 * la]), p3 = ap(Q, [0, lo, la]);
        for (const [A, B] of [[p1, p2], [p2, p3], [p3, p1]]) M('rayons', blancTex, 'lumiere').quad([p0, A, B, B], [[0, 0], [0, 0], [0, 0], [0, 0]], [c0, c1, c1, c1]);
      }
    }
  }
  // Impulsion (Riptide) : SpinAttackEffectLayer, deux boites autour du joueur qui tourne (texture entity/trident/trident_riptide, 64 x 64,
  // dessinee sans culling). Geometrie de entity-models.json du jeu 26.3 (`minecraft:spin_attack#main`, lecture seule) : box0 addBox(-8, -9,6,
  // -8, 16, 32, 16) x 0,75 ; box1 addBox(-8, 0, -8, 16, 32, 16) x 1,5 ; yRot = age x -(45 + (i + 1) x 5) degres (SpinAttackEffectModel ;
  // Horizon game/perspective.rs, MIT). Le corps est couche par la meme rotation que la pose (film/acteurs-vivants.js rotationVrille).
  const RA = replay.acteursVue ?? [], vrilles = new Map();
  for (let i = 0; i + 15 < RA.length; i += 16) if (((RA[i + 8] >> 6) & 7) === 7) { if (!vrilles.has(RA[i])) vrilles.set(RA[i], []); vrilles.get(RA[i]).push([RA[i + 1], i]); }
  const suivante = (ida, i) => { for (let j = i + 16; j < Math.min(RA.length, i + 16 * 64); j += 16) if (RA[j + 1] === ida) return j; return i; };
  const BOITES_VRILLE = [{ y0: -9.6, s: 0.75 }, { y0: 0, s: 1.5 }];
  const dessinerVrille = (ida, a, u, f, M) => {
    const t = textureDe('entity/trident/trident_riptide', null);
    if (!t) { note('Impulsion : texture entity/trident/trident_riptide absente du kit (groupe projectiles)'); return; }
    const b = suivante(ida, a), L3 = (j) => RA[a + j] + (RA[b + j] - RA[a + j]) * f;
    const x = L3(2), y = L3(3), z = L3(4), lacet = RA[a + 5], R = rotationVrille(lacet, L3(7), u);
    const th = (180 - lacet) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    const vers = (p) => {   // modele (pixels) -> monde : echelle (-1, -1, 1), 1,501 au-dessus des pieds, lacet du corps, puis la rotation de la vrille
      const lx = -p[0] / 16, ly = 1.501 - p[1] / 16, lz = p[2] / 16;
      const wx = c * lx + s * lz, wz = -s * lx + c * lz;
      return [x + R[0] * wx + R[1] * ly + R[2] * wz, y + R[3] * wx + R[4] * ly + R[5] * wz, z + R[6] * wx + R[7] * ly + R[8] * wz];
    };
    const L = lum(x, y + 1, z);
    BOITES_VRILLE.forEach(({ y0, s: k }, i) => {
      const ang = u * -(45 + (i + 1) * 5) * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
      const P = (px, py, pz) => { const X = px * k, Y = py * k, Z = pz * k; return vers([ca * X + sa * Z, Y, -sa * X + ca * Z]); };
      const y1 = y0 + 32;
      // faces du cube (u, v en 64e : ModelPart.Cube, texOffs 0, 0, taille 16 x 32 x 16)
      const F = [
        [[[8, y0, 8], [-8, y0, 8], [-8, y0, -8], [8, y0, -8]], [[32, 0], [16, 0], [16, 16], [32, 16]]],
        [[[8, y1, -8], [-8, y1, -8], [-8, y1, 8], [8, y1, 8]], [[48, 16], [32, 16], [32, 0], [48, 0]]],
        [[[-8, y0, -8], [-8, y0, 8], [-8, y1, 8], [-8, y1, -8]], [[16, 16], [0, 16], [0, 48], [16, 48]]],
        [[[8, y0, -8], [-8, y0, -8], [-8, y1, -8], [8, y1, -8]], [[32, 16], [16, 16], [16, 48], [32, 48]]],
        [[[8, y0, 8], [8, y0, -8], [8, y1, -8], [8, y1, 8]], [[48, 16], [32, 16], [32, 48], [48, 48]]],
        [[[-8, y0, 8], [8, y0, 8], [8, y1, 8], [-8, y1, 8]], [[64, 16], [48, 16], [48, 48], [64, 48]]],
      ];
      for (const [pts, uv] of F) {
        const q = pts.map((p) => P(...p)), w = uv.map(([uu, vv]) => [uu / 64, vv / 64]);
        M('vrille', t, 'objet').quad(q, w, L);
        M('vrille', t, 'objet').quad([q[3], q[2], q[1], q[0]], [w[3], w[2], w[1], w[0]], L);   // entityCutoutNoCull : les deux faces
      }
    });
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
          if (E[a + 7] >= 0) {   // PrimedTnt.block_state : un bloc de mod qui copie la TNT (moteur/perso.js) garde son aspect amorce
            for (const q of quadsBloc(E[a + 7])) {
              const t0 = textureDe(q.tex, null), tex = fl ? texBlanche('pal|' + q.tex, t0) : t0;
              if (!tex) continue;
              M((fl ? 'blanc|' : 'b|') + q.tex, tex, 'tnt').quad(q.p.map((p) => [x + (p[0] - 0.5) * ech, cy + (p[1] - 0.5) * ech, z + (p[2] - 0.5) * ech]), q.uv, q.ombre * L);
            }
            continue;
          }
          const noms = ['block/tnt_side', 'block/tnt_side', 'block/tnt_side', 'block/tnt_side', 'block/tnt_top', 'block/tnt_bottom'], ombre = [0.8, 0.8, 0.6, 0.6, 1, 0.5];
          for (let i = 0; i < 6; i++) {
            const nom = fl ? 'blanc|' + noms[i] : noms[i], tex = fl ? texBlanche(noms[i]) : texOf(noms[i] + '.png');
            if (!tex) continue;
            M(nom, tex, 'tnt').quad(F[i].map((p) => [x + p[0], cy + p[1], z + p[2]]), [[0, 0], [1, 0], [1, 1], [0, 1]], ombre[i] * L);
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
          // vraie texture du jeu (32 x 32, groupe `projectiles` du kit) : hampe vue de cote en haut a gauche (16 x 5), plaque de plumes (5 x 5) dessous ; sinon l'image dessinee ici (16 x 10)
          const reelle = kit ? texObjet(kit, 'entity/projectiles/arrow') : null;
          const T = reelle ?? texFleche(), us = reelle ? 0.5 : 1, vs = reelle ? 5 / 32 : 0.5, pu = reelle ? 5 / 32 : 0.3125, pv0 = reelle ? 5 / 32 : 0.5, pv1 = reelle ? 10 / 32 : 1;
          for (const ax of axes) M('fleche', T, 'fleche').quad([P(queue, ax, h), P(pointe, ax, h), P(pointe, ax, -h), P(queue, ax, -h)], [[0, 0], [us, 0], [us, vs], [0, vs]], L);
          M('fleche', T, 'fleche').quad([P(queue, up, h), P(queue, r, h), P(queue, up, -h), P(queue, r, -h)], [[0, pv0], [pu, pv0], [pu, pv1], [0, pv1]], L);
        } else if (type === 'boule_feu') {
          // boule de feu (ThrownItemRenderer de la charge de feu, echelle 3 ou 0,75, pleine lumiere) : sprite de face a la camera, centre au milieu
          const nom = replay.noms[E[a + 7]], modele = quadsObjet(nom), nomTex = modele.quads[0]?.tex;
          if (!nomTex) continue;
          const t = textureDe(nomTex, null);
          if (!t) continue;
          const cam = camera ?? { lacet: 0, tangage: 0 }, ya = (cam.lacet ?? 0) * RAD, pa = (cam.tangage ?? 0) * RAD;
          const fw = [-Math.sin(ya) * Math.cos(pa), -Math.sin(pa), Math.cos(ya) * Math.cos(pa)], rr = [-Math.cos(ya), 0, -Math.sin(ya)];
          const hh = [rr[1] * fw[2] - rr[2] * fw[1], rr[2] * fw[0] - rr[0] * fw[2], rr[0] * fw[1] - rr[1] * fw[0]], s = 0.25 * E[a + 6];
          M('feu|' + nomTex, t, 'objet').quad([[x - rr[0] * s + hh[0] * s, y - rr[1] * s + hh[1] * s, z - rr[2] * s + hh[2] * s], [x + rr[0] * s + hh[0] * s, y + rr[1] * s + hh[1] * s, z + rr[2] * s + hh[2] * s], [x + rr[0] * s - hh[0] * s, y + rr[1] * s - hh[1] * s, z + rr[2] * s - hh[2] * s], [x - rr[0] * s - hh[0] * s, y - rr[1] * s - hh[1] * s, z - rr[2] * s - hh[2] * s]], [[0, 0], [1, 0], [1, 1], [0, 1]], 1);
        } else if (type === 'crane' || type === 'crane_bleu') {
          // WitherSkullRenderer : la tete du wither (cube de 8 px, texOffs(0, 35) sur la texture du wither, bleue si dangereuse), tournee
          // selon sa vitesse (lacet, tangage) ; les faces UV du cube du jeu (dessus, dessous, cotes)
          const t = textureDe(type === 'crane' ? 'entity/wither/wither' : 'entity/wither/wither_invulnerable', null);
          if (!t) { note('crane du wither : texture entity/wither/wither absente du kit'); continue; }
          const ya = E[a + 6] * RAD, pa = E[a + 7] * RAD, h = 0.25, L = lum(x, y, z), W = t.largeur, H = t.hauteur;
          const tourne = (q) => { let [px, py, pz] = q; [py, pz] = [py * Math.cos(pa) - pz * Math.sin(pa), py * Math.sin(pa) + pz * Math.cos(pa)]; [px, pz] = [px * Math.cos(ya) - pz * Math.sin(ya), px * Math.sin(ya) + pz * Math.cos(ya)]; return [x + px, y + py, z + pz]; };
          const uvr = (u0, v0, w, hh) => [[u0 / W, v0 / H], [(u0 + w) / W, v0 / H], [(u0 + w) / W, (v0 + hh) / H], [u0 / W, (v0 + hh) / H]];
          const F = [   // avant (+z, le visage : vers la vitesse), arriere, gauche, droite, dessus, dessous : [sommets, uv]
            [[[h, h, h], [-h, h, h], [-h, -h, h], [h, -h, h]], uvr(8, 43, 8, 8), 0.8], [[[-h, h, -h], [h, h, -h], [h, -h, -h], [-h, -h, -h]], uvr(24, 43, 8, 8), 0.8],
            [[[-h, h, h], [-h, h, -h], [-h, -h, -h], [-h, -h, h]], uvr(16, 43, 8, 8), 0.6], [[[h, h, -h], [h, h, h], [h, -h, h], [h, -h, -h]], uvr(0, 43, 8, 8), 0.6],
            [[[h, h, -h], [-h, h, -h], [-h, h, h], [h, h, h]], uvr(8, 35, 8, 8), 1], [[[h, -h, h], [-h, -h, h], [-h, -h, -h], [h, -h, -h]], uvr(16, 35, 8, 8), 0.5],
          ];
          for (const [P4, uv, o] of F) M(type, t, 'objet').quad(P4.map(tourne), uv, o * L);
        } else if (type === 'boule_dragon') {
          // DragonFireballRenderer : sprite de face a la camera, echelle 2, pleine lumiere
          const t = textureDe('entity/enderdragon/dragon_fireball', null);
          if (!t) continue;
          const cam = camera ?? { lacet: 0, tangage: 0 }, ya = (cam.lacet ?? 0) * RAD, pa = (cam.tangage ?? 0) * RAD;
          const fw = [-Math.sin(ya) * Math.cos(pa), -Math.sin(pa), Math.cos(ya) * Math.cos(pa)], rr = [-Math.cos(ya), 0, -Math.sin(ya)];
          const hh = [rr[1] * fw[2] - rr[2] * fw[1], rr[2] * fw[0] - rr[0] * fw[2], rr[0] * fw[1] - rr[1] * fw[0]], s = 0.5 * E[a + 6];
          M('dragon_boule', t, 'objet').quad([[x - rr[0] * s + hh[0] * s, y - rr[1] * s + hh[1] * s, z - rr[2] * s + hh[2] * s], [x + rr[0] * s + hh[0] * s, y + rr[1] * s + hh[1] * s, z + rr[2] * s + hh[2] * s], [x + rr[0] * s - hh[0] * s, y + rr[1] * s - hh[1] * s, z + rr[2] * s - hh[2] * s], [x - rr[0] * s - hh[0] * s, y - rr[1] * s - hh[1] * s, z - rr[2] * s - hh[2] * s]], [[0, 0], [1, 0], [1, 1], [0, 1]], 1);
        } else if (type === 'orbe') {
          // ExperienceOrbRenderer : icone (4 x 4 de 16 px) selon la valeur, echelle 0,3, couleur qui pulse (r = (sin(f) + 1) x 0,5, v = 1,
          // b = (sin(f + 4,189) + 1) x 0,1, f = (age + partiel) / 2), pleine lumiere, monte de 0,1
          const t = textureDe('entity/experience_orb', null);
          if (!t) continue;
          const ic = E[a + 6], u0 = (ic % 4) * 16 / 64, v0 = Math.floor(ic / 4) * 16 / 64, f2 = (k + f) / 2;
          const col = [(Math.sin(f2) + 1) * 0.5, 1, (Math.sin(f2 + 4.1887903) + 1) * 0.1];
          const cam = camera ?? { lacet: 0, tangage: 0 }, ya = (cam.lacet ?? 0) * RAD, pa = (cam.tangage ?? 0) * RAD;
          const fw = [-Math.sin(ya) * Math.cos(pa), -Math.sin(pa), Math.cos(ya) * Math.cos(pa)], rr = [-Math.cos(ya), 0, -Math.sin(ya)];
          const hh = [rr[1] * fw[2] - rr[2] * fw[1], rr[2] * fw[0] - rr[0] * fw[2], rr[0] * fw[1] - rr[1] * fw[0]], s = 0.15, cy = y + 0.1 + 0.075;
          M('orbe', t, 'orbe').quad([[x - rr[0] * s + hh[0] * s, cy - rr[1] * s + hh[1] * s, z - rr[2] * s + hh[2] * s], [x + rr[0] * s + hh[0] * s, cy + rr[1] * s + hh[1] * s, z + rr[2] * s + hh[2] * s], [x + rr[0] * s - hh[0] * s, cy + rr[1] * s - hh[1] * s, z + rr[2] * s - hh[2] * s], [x - rr[0] * s - hh[0] * s, cy - rr[1] * s - hh[1] * s, z - rr[2] * s - hh[2] * s]], [[u0, v0], [u0 + 0.25, v0], [u0 + 0.25, v0 + 0.25], [u0, v0 + 0.25]], col);
        } else if (type === 'fusee') {
          // FireworkEntityRenderer : le modele de l'objet (affichage ground) tourne vers la camera ; tiree de biais : puis Z 180, Y 180, X 90
          const modele = quadsObjet('firework_rocket');
          if (!modele.quads.length) continue;
          const cam = camera ?? { lacet: 0, tangage: 0 }, ya = (cam.lacet ?? 0) * RAD, pa = (cam.tangage ?? 0) * RAD;
          const fw = [-Math.sin(ya) * Math.cos(pa), -Math.sin(pa), Math.cos(ya) * Math.cos(pa)], rr = [-Math.cos(ya), 0, -Math.sin(ya)];
          const hh = [rr[1] * fw[2] - rr[2] * fw[1], rr[2] * fw[0] - rr[0] * fw[2], rr[0] * fw[1] - rr[1] * fw[0]], zz = [-fw[0], -fw[1], -fw[2]];
          const biais = E[a + 6] > 0.5, L = lum(x, y, z);
          for (const q of modele.quads) {
            const tex = textureDe(q.tex, q.tint);
            if (!tex) continue;
            const P = q.p.map((p0) => {
              let [px, py, pz] = transformer(p0, modele.aff);
              if (biais) { [py, pz] = [-pz, py]; [px, pz] = [-px, -pz]; [px, py] = [-px, -py]; }   // pile du jeu Z 180 . Y 180 . X 90 : X d'abord
              return [x + rr[0] * px + hh[0] * py + zz[0] * pz, y + rr[1] * px + hh[1] * py + zz[1] * pz, z + rr[2] * px + hh[2] * py + zz[2] * pz];
            });
            M('fusee|' + q.tex + '|' + (q.tint ?? ''), tex, 'objet').quad(P, q.uv, L);
          }
        } else if (type === 'vent') {
          // WindChargeRenderer : le modele wind_charge du jeu (cube de la charge et son vent), parties tournees de -age x 16 et +age x 16 degres
          // autour de Y, texture entity/projectiles/wind_charge qui defile en u de age x 0,03 (RenderTypes.breezeWind), pleine lumiere
          const racine = creatures?.modeles?.wind_charge?.main?.r, t = textureDe('entity/projectiles/wind_charge', null);
          if (!racine || !t) { note('charge de vent : modele wind_charge (table des creatures) ou texture entity/projectiles/wind_charge absents'); continue; }
          const age = E[a + 6] + f, rot = { wind_charge: -age * 16 * RAD, wind: age * 16 * RAD }, defile = (age * 0.03) % 1;
          const W = creatures.modeles.wind_charge.main.t?.[0] || t.largeur, H = creatures.modeles.wind_charge.main.t?.[1] || t.hauteur;
          const marche = (part, nom, Mp) => {
            const q = [0, 0, 0, 0, 0, 0, 1, 1, 1]; (part.p ?? []).forEach((v, i) => { q[i] = v; });
            if (rot[nom] !== undefined) q[4] += rot[nom];
            const Mn = matPartie(Mp, q);
            for (let k = 0; k + 19 < (part.q?.length ?? 0); k += 20) {
              const P = [], uv = [];
              for (let c = 0; c < 4; c++) {
                const b = k + c * 5, X = part.q[b] / 16, Y = part.q[b + 1] / 16, Z = part.q[b + 2] / 16;
                const w = [Mn[0] * X + Mn[1] * Y + Mn[2] * Z + Mn[3], Mn[4] * X + Mn[5] * Y + Mn[6] * Z + Mn[7], Mn[8] * X + Mn[9] * Y + Mn[10] * Z + Mn[11]];
                P.push([x - w[0], y - w[1], z + w[2]]);   // translation(position) . scale(-1, -1, 1)
                uv.push([(part.q[b + 3] / W + defile) / 2, part.q[b + 4] / H]);   // texture repetee deux fois en largeur
              }
              M('vent', texRepetee(t), 'objet').quad(P, uv, 1);
            }
            for (const kk of Object.keys(part.c ?? {}).sort()) marche(part.c[kk], kk, Mn);
          };
          marche(racine, 'root', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
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
        } else if (type === 'bouchon') {
          // FishingHookRenderer : le bouchon (entity/fishing/fishing_hook, carre de 0,5 face a la camera) et le fil : 16 segments noirs depuis
          // 0,25 au-dessus du bouchon jusqu'a la canne, y = dy x (a^2 + a) / 2 + 0,25 (moteur/peche.js ecrit la main dans replay.peche)
          const t = textureDe('entity/fishing/fishing_hook', null);
          if (!t) { note('bouchon de peche : texture entity/fishing/fishing_hook absente du kit (groupe projectiles)'); continue; }
          const cam = camera ?? { lacet: 0, tangage: 0, x, y, z }, ya = (cam.lacet ?? 0) * RAD, pa = (cam.tangage ?? 0) * RAD;
          const fw = [-Math.sin(ya) * Math.cos(pa), -Math.sin(pa), Math.cos(ya) * Math.cos(pa)];
          const rr0 = [fw[2], 0, -fw[0]], nr = Math.hypot(...rr0) || 1, rr = rr0.map((c) => c / nr);
          const up = [rr[1] * fw[2] - rr[2] * fw[1], rr[2] * fw[0] - rr[0] * fw[2], rr[0] * fw[1] - rr[1] * fw[0]], s = 0.25, L = lum(x, y, z);
          const C = (a2, b2) => [x + rr[0] * a2 + up[0] * b2, y + rr[1] * a2 + up[1] * b2, z + rr[2] * a2 + up[2] * b2];
          // rr pointe vers la gauche de l'ecran et up vers le bas : le coin (0, 0) de la texture est en haut a gauche a l'ecran
          M('bouchon', t, 'objet').quad([C(s, -s), C(-s, -s), C(-s, s), C(s, s)], [[0, 0], [1, 0], [1, 1], [0, 1]], L);
          const main = mainsPeche.get(id)?.get(tick) ?? mainsPeche.get(id)?.get(tick - 1);
          if (main) {
            const o = [main[0] - x, main[1] - (y + 0.25), main[2] - z], pt = (a2) => [x + o[0] * a2, y + o[1] * (a2 * a2 + a2) * 0.5 + 0.25, z + o[2] * a2];
            for (let i = 0; i < 16; i++) {
              const A = pt(i / 16), B = pt((i + 1) / 16), d = Math.hypot(A[0] - (cam.x ?? x), A[1] - (cam.y ?? y), A[2] - (cam.z ?? z)), w = Math.max(0.004, d * 0.0026);   // ~2 pixels a l'ecran (1080 lignes, 70 degres)
              const seg = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], vc = [A[0] - (cam.x ?? x), A[1] - (cam.y ?? y), A[2] - (cam.z ?? z)];
              let n = [seg[1] * vc[2] - seg[2] * vc[1], seg[2] * vc[0] - seg[0] * vc[2], seg[0] * vc[1] - seg[1] * vc[0]]; const ln = Math.hypot(...n) || 1; n = n.map((c) => c / ln * w / 2);
              const q4 = [[A[0] - n[0], A[1] - n[1], A[2] - n[2]], [A[0] + n[0], A[1] + n[1], A[2] + n[2]], [B[0] + n[0], B[1] + n[1], B[2] + n[2]], [B[0] - n[0], B[1] - n[1], B[2] - n[2]]];
              M('fil', noirTex, 'objet').quad(q4, [[0, 0], [1, 0], [1, 1], [0, 1]], 1);
              M('fil', noirTex, 'objet').quad([q4[3], q4[2], q4[1], q4[0]], [[0, 1], [1, 1], [1, 0], [0, 0]], 1);   // les deux faces (une ligne n'a pas d'envers)
            }
          }
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
              const tex0 = textureDe(q.tex, q.tint);
              if (!tex0) continue;
              const tex = modele.reflet && kit ? cuireReflet(kit, tex0, u * 50) : tex0;   // objet enchante au sol : reflet (objets/reflet.js)
              const P = q.p.map((p) => { const [px, py, pz] = transformer(p, modele.aff); return [x + px * cs + pz * sn + dx, y + bob + 0.25 * ey + py + dy, z - px * sn + pz * cs + dz]; });
              const A = P[0], B = P[1], C = P[2], ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
              const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
              const ombre = 0.75 + 0.25 * Math.abs(ny / l);       // eclairage plat des objets : le dessus un peu plus clair
              M('o|' + q.tex + '|' + (q.tint ?? '') + (modele.reflet ? '|reflet' : ''), tex, 'objet').quad(P, q.uv, ombre * L);
            }
          }
        }
      }
      for (const t of traits.get(tick) ?? []) dessinerTrait(t, u, M);
      for (const [ida, a] of vrilles.get(tick) ?? []) dessinerVrille(ida, a, u, f, M);
      const out = [];
      for (const { texture, genre, m } of parTex.values()) if (!m.vide()) out.push(m.maillage(texture, genre));
      return out;
    },
  };
}
