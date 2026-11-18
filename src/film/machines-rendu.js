// Rendu des blocs et machines du monde simule (docs/SIMULATION.md partie 27), maillages dynamiques lus dans le replay :
//   - faisceau de la balise (BeaconRenderer.submitBeaconBeam, Horizon horizon-client-render/src/block_entity_render.rs beam, MIT) : par section
//     de couleur, un pilier plein de rayon 0,2 qui tourne de (temps x 2,25 - 45) degres et un halo de 0,25 a 32/255 d'opacite, texture
//     entity/beacon/beacon_beam qui defile (v + temps x 0,2 - floor(temps x 0,1)) ; la derniere section monte de 2048 blocs ; pleine lumiere ;
//   - cadres (ItemFrameRenderer, Horizon game/frames.rs) : modele block/item_frame (ou glow_item_frame), objet en affichage `fixed`, a 0,4375 du
//     centre, tourne de rotation x 45 degres, a l'echelle 0,5 ; le cadre lumineux a une lumiere de bloc d'au moins 5, son objet pleine lumiere ;
//   - livre du pupitre (LecternRenderer) : modele `book` du jeu, ouvert (1,25 x 1,2 ; pages 0,1 et 0,9), pose a (0,5 ; 1,0625 ; 0,5), tourne de
//     -toYRot(facing horaire), penche de 67,5 degres, texture entity/enchantment/enchanting_table_book.
import { resoudreObjet } from '../objets/definition.js';
import { cuire, afficheDe } from '../objets/modele-objet.js';
import { texture as texObjet, teinter, groupePresent } from '../objets/fichiers.js';
import { morceauxBloc, mul, T, S, RY, RZ, RX } from '../creatures/rendu.js';

const RAD = Math.PI / 180;
const VERS_Y = { south: 0, west: 90, north: 180, east: 270 };
const HORAIRE = { north: 'east', east: 'south', south: 'west', west: 'north' };
const app = (M, p) => [M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + M[3], M[4] * p[0] + M[5] * p[1] + M[6] * p[2] + M[7], M[8] * p[0] + M[9] * p[1] + M[10] * p[2] + M[11]];

class Mailles {
  constructor() { this.m = new Map(); }
  de(cle, texture, extra) { if (!this.m.has(cle)) this.m.set(cle, { texture, extra, pos: [], uv: [], col: [], idx: [] }); return this.m.get(cle); }
  quad(cle, texture, extra, P, UV, c) {
    const g = this.de(cle, texture, extra), b = g.pos.length / 3;
    for (let i = 0; i < 4; i++) { g.pos.push(...P[i]); g.uv.push(...UV[i]); const k = Array.isArray(c[0]) ? c[i] : c; g.col.push(k[0], k[1], k[2]); }
    g.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  sortie() { return [...this.m.values()].filter((g) => g.idx.length).map((g) => ({ positions: Float32Array.from(g.pos), uvs: Float32Array.from(g.uv), couleurs: Float32Array.from(g.col), indices: Uint32Array.from(g.idx), texture: g.texture, mode: 'decoupe', deuxFaces: true, genre: 'bloc', ...g.extra })); }
}

export function creerMachinesRendu({ rs, replay, kit, texOf, lum, creatures = null, notes = [] }) {
  const balises = replay.balises ?? [], cadres = replay.cadres ?? [];
  // pupitres a livre : zone de depart + journal des blocs (etat has_book=true)
  const palette = [...rs.zone.palette, ...replay.palAjouts];
  const avecLivre = new Set(); palette.forEach((s, i) => { if (/^minecraft:lectern\[.*has_book=true/.test(s)) avecLivre.add(i); });
  const pupitres = [], actifs = new Map();
  const facingDe = (s) => /facing=(\w+)/.exec(s)?.[1] ?? 'north';
  if (avecLivre.size) {
    const { sx, sz, x0, y0, z0, cellules } = rs.zone;
    for (let i = 0; i < cellules.length; i++) if (avecLivre.has(cellules[i])) { const lx = i % sx, t = (i - lx) / sx, lz = t % sz, ly = (t - lz) / sz; const P = { x: x0 + lx, y: y0 + ly, z: z0 + lz, debut: -1, fin: Infinity, facing: facingDe(palette[cellules[i]]) }; pupitres.push(P); actifs.set(`${P.x},${P.y},${P.z}`, P); }
  }
  {
    const J = replay.blocs;
    for (let k = 0; k < replay.nbBlocs; k++) {
      const tick = J[k * 6], x = J[k * 6 + 1], y = J[k * 6 + 2], z = J[k * 6 + 3], nou = J[k * 6 + 5], cle = `${x},${y},${z}`;
      const a = actives(cle);
      if (a && avecLivre.has(nou) && facingDe(palette[nou]) === a.facing) continue;
      if (a) { a.fin = tick; actifs.delete(cle); }
      if (avecLivre.has(nou)) { const P = { x, y, z, debut: tick, fin: Infinity, facing: facingDe(palette[nou]) }; pupitres.push(P); actifs.set(cle, P); }
    }
  }
  function actives(cle) { return actifs.get(cle); }
  if (!balises.length && !cadres.length && !pupitres.length) return null;

  // ---- textures
  const beam = texOf('entity/beacon/beacon_beam.png');
  if (balises.length && !beam) notes.push('balise : texture entity/beacon/beacon_beam absente du kit (groupe entites) : faisceau non dessine');
  // la texture repetee 64 fois en hauteur (le rendu ne repete pas les UV) ; halo : alpha x 32/255
  const repetee = (t, n, alpha) => { const W = t.largeur, H = t.hauteur, rgba = new Uint8Array(W * H * n * 4); for (let k = 0; k < n; k++) rgba.set(t.rgba, k * W * H * 4); if (alpha !== 1) for (let i = 3; i < rgba.length; i += 4) rgba[i] = Math.round(rgba[i] * alpha); return { largeur: W, hauteur: H * n, rgba }; };
  const NREP = 64;
  const beamPlein = beam ? repetee(beam, NREP, 1) : null, beamHalo = beam ? repetee(beam, NREP, 32 / 255) : null;
  const livreTex = pupitres.length ? texOf('entity/enchantment/enchanting_table_book.png') : null;
  if (pupitres.length && !livreTex) notes.push('pupitre : texture entity/enchantment/enchanting_table_book absente du kit (groupe entites) : livre non dessine');
  const livreModele = creatures?.modeles?.book?.main ?? null;
  if (pupitres.length && !livreModele) notes.push('pupitre : modele du livre absent de la table des creatures (relancer outils/extraire-creatures.mjs) : livre non dessine');

  // ---- faisceau : BeamPart.emit (quatre faces entre les coins wn, en, ws, es), v de v2 (bas) a v1 (haut)
  function faisceau(M, b, sections, temps, k = 1) {   // k : max(1, distance horizontale / 96) (BeaconRenderer : le faisceau lointain s'epaissit)
    let debut = 0;
    sections.forEach(([couleur, h0], i) => {
      const h = i === sections.length - 1 ? 2048 : h0, fin = debut + h;
      const col = [((couleur >> 16) & 255) / 255, ((couleur >> 8) & 255) / 255, (couleur & 255) / 255];
      const defile = -temps, vOff = (defile * 0.2 - Math.floor(defile * 0.1)) - Math.floor(defile * 0.2 - Math.floor(defile * 0.1));
      const rot = (temps * 2.25 - 45) * RAD, cs = Math.cos(rot), sn = Math.sin(rot), r = 0.2 * k;
      const ry = (v) => [v[0] * cs + v[2] * sn, 0, -v[0] * sn + v[2] * cs];
      const plein = [ry([0, 0, r]), ry([r, 0, 0]), ry([-r, 0, 0]), ry([0, 0, -r])];
      const g = 0.25 * k, halo = [[-g, 0, -g], [g, 0, -g], [-g, 0, g], [g, 0, g]];
      const v2 = -1 + vOff;
      partie(M, b, plein, debut, fin, v2, h * (0.5 / r) + v2, col, beamPlein, 'beam|p', { mode: 'decoupe', emissif: true, deuxFaces: false, genre: 'balise' });
      partie(M, b, halo, debut, fin, v2, h + v2, col, beamHalo, 'beam|h', { mode: 'melange', emissif: true, deuxFaces: false, genre: 'balise' });
      debut = fin;
    });
  }
  // une face de 'fin' a 'debut' : coupee en morceaux de NREP unites de v (la texture repetee couvre NREP tours)
  function partie(M, b, [wn, en, ws, es], y0, y1, v2, v1, col, tex, cle, extra) {
    if (!tex) return;
    const at = (c, y) => [b[0] + 0.5 + c[0], b[1] + y, b[2] + 0.5 + c[2]];
    for (const [a, c] of [[wn, en], [es, ws], [en, es], [ws, wn]]) {
      const n = Math.ceil((v1 - v2) / NREP);
      for (let k = 0; k < n; k++) {
        const va = v2 + k * NREP, vb = Math.min(v1, va + NREP), ya = y0 + (y1 - y0) * (va - v2) / (v1 - v2), yb = y0 + (y1 - y0) * (vb - v2) / (v1 - v2);
        const base = Math.floor(va), ua = (va - base) / NREP, ub = (vb - base) / NREP;
        M.quad(cle, tex, extra, [at(a, yb), at(a, ya), at(c, ya), at(c, yb)], [[1, ub], [1, ua], [0, ua], [0, ub]], col);
      }
    }
  }

  // ---- cadres
  const cacheObj = new Map();
  const quadsObjetFixe = (id) => {
    if (cacheObj.has(id)) return cacheObj.get(id);
    const r = { quads: [], aff: null };
    if (kit && groupePresent(kit, 'objets')) {
      try {
        const def = resoudreObjet(kit, id);
        for (const e of def.entrees) {
          if (e.model === undefined) continue;
          const c = cuire(kit, e, { signaler: (t) => notes.push(t) });
          for (const q of c.quads) r.quads.push(q);
          r.aff ??= afficheDe(kit, e.model, false, 'fixed');
        }
      } catch { /* objet inconnu : rien */ }
    }
    if (!r.quads.length) notes.push(`cadre : modele introuvable pour ${id}`);
    cacheObj.set(id, r);
    return r;
  };
  const texCache = new Map();
  const texDe = (nom, tint) => { const k = nom + '|' + (tint ?? ''); if (!texCache.has(k)) { const t = (kit ? texObjet(kit, nom) : null) ?? texOf(nom + '.png'); texCache.set(k, t ? (tint === null || tint === undefined ? t : teinter(t, tint)) : null); } return texCache.get(k); };
  const etatCadre = (c, tick) => { let s = null; for (const d of c.d) { if (d[0] <= tick) s = d; else break; } return s; };
  function dessinerCadre(M, c, s) {
    const step = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] }[c.face];
    const [xr, yr] = step[1] === 0 ? [0, 180 - VERS_Y[c.face]] : [-90 * step[1], 180];
    const pose = mul(mul(T(c.x + 0.5, c.y + 0.5, c.z + 0.5), RX(xr * RAD)), RY(yr * RAD));
    const L0 = lum(c.x + 0.5, c.y + 0.5, c.z + 0.5), Lc = c.lueur ? Math.max(L0, 5 / 15) : L0;
    for (const mo of morceauxBloc(kit, c.lueur ? 'glow_item_frame' : 'item_frame')) {
      const n = mo.local.length / 3;
      for (let k = 0; k < n; k += 4) {
        const P = [0, 1, 2, 3].map((j) => app(pose, [mo.local[(k + j) * 3] / 16 - 0.5, mo.local[(k + j) * 3 + 1] / 16 - 0.5, mo.local[(k + j) * 3 + 2] / 16 - 0.5]));
        const UV = [0, 1, 2, 3].map((j) => [mo.uvs[(k + j) * 2], mo.uvs[(k + j) * 2 + 1]]);
        M.quad('cadre|' + (c.lueur ? 'g' : 'n') + '|' + mo.t.largeur + mo.t.hauteur + (mo.t.rgba[0] ?? 0), mo.t, { genre: 'entite', entite: c.lueur ? 'glow_item_frame' : 'item_frame' }, P, UV, [Lc, Lc, Lc]);
      }
    }
    if (!s[1]) return;
    const o = quadsObjetFixe(s[1]);
    if (!o.quads.length) return;
    const Mi = mul(mul(mul(pose, T(0, 0, 0.4375)), RZ(s[2] * 45 * RAD)), S(0.5, 0.5, 0.5));
    const Li = c.lueur ? 1 : L0, aff = o.aff;
    for (const q of o.quads) {
      const tex = texDe(q.tex, q.tint);
      if (!tex) continue;
      const P = q.p.map((p) => {
        let x = p[0] - 0.5, y = p[1] - 0.5, z = p[2] - 0.5;
        if (aff) {
          x *= aff.scale[0]; y *= aff.scale[1]; z *= aff.scale[2];
          const [rx, ry, rz] = aff.rotation.map((d) => d * RAD);
          let cc = Math.cos(rz), nn = Math.sin(rz); [x, y] = [x * cc - y * nn, x * nn + y * cc];
          cc = Math.cos(ry); nn = Math.sin(ry); [x, z] = [x * cc + z * nn, -x * nn + z * cc];
          cc = Math.cos(rx); nn = Math.sin(rx); [y, z] = [y * cc - z * nn, y * nn + z * cc];
          x += aff.translation[0]; y += aff.translation[1]; z += aff.translation[2];
        }
        return app(Mi, [x, y, z]);
      });
      M.quad('obj|' + q.tex + '|' + (q.tint ?? ''), tex, { genre: 'objet' }, P, q.uv, [Li, Li, Li]);
    }
  }

  // ---- livre du pupitre (ModelPart.render : T(p / 16) . Rz . Ry . Rx . echelle ; BookModel.setupAnim)
  const ouvert = 1.25 * 1.2, f1 = 0.1, f2 = 0.9;
  const posePartie = (nom, p0) => {
    const p = [...(p0 ?? [0, 0, 0, 0, 0, 0]), ...(p0 && p0.length > 6 ? [] : [1, 1, 1])].slice(0, 9);
    const s = Math.sin(ouvert);
    if (nom === 'left_lid') p[4] = Math.PI + ouvert;
    else if (nom === 'right_lid') p[4] = -ouvert;
    else if (nom === 'left_pages') { p[4] = ouvert; p[0] = s; }
    else if (nom === 'right_pages') { p[4] = -ouvert; p[0] = s; }
    else if (nom === 'flip_page1') { p[4] = ouvert - ouvert * 2 * f1; p[0] = s; }
    else if (nom === 'flip_page2') { p[4] = ouvert - ouvert * 2 * f2; p[0] = s; }
    return p;
  };
  function dessinerPartie(M, part, nom, parent, L) {
    const p = posePartie(nom, part.p);
    const Mp = mul(mul(mul(mul(mul(parent, T(p[0] / 16, p[1] / 16, p[2] / 16)), RZ(p[5])), RY(p[4])), RX(p[3])), S(p[6], p[7], p[8]));
    const q = part.q ?? [], W = livreModele.t[0] || 1, H = livreModele.t[1] || 1;   // t = [0, 0] : UV deja en fractions de la texture (extraire-creatures.mjs)
    for (let k = 0; k < q.length; k += 20) {
      const P = [0, 1, 2, 3].map((j) => app(Mp, [q[k + j * 5] / 16, q[k + j * 5 + 1] / 16, q[k + j * 5 + 2] / 16]));
      const UV = [0, 1, 2, 3].map((j) => [q[k + j * 5 + 3] / W, q[k + j * 5 + 4] / H]);
      M.quad('livre', livreTex, { genre: 'bloc', bloc: 'minecraft:lectern' }, P, UV, [L, L, L]);
    }
    for (const [n, c] of Object.entries(part.c ?? {})) dessinerPartie(M, c, n, Mp, L);
  }
  function dessinerLivre(M, P) {
    const yr = VERS_Y[HORAIRE[P.facing]] ?? 0;
    const base = mul(mul(mul(T(P.x + 0.5, P.y + 1.0625, P.z + 0.5), RY(-yr * RAD)), RZ(67.5 * RAD)), T(0, -0.125, 0));
    dessinerPartie(M, livreModele.r, 'root', base, lum(P.x + 0.5, P.y + 1, P.z + 0.5));
  }

  return {
    maillages(u, camera) {
      const tick = Math.floor(u), M = new Mailles();
      const temps = (tick % 40) + (u - tick);
      for (const b of balises) {
        let sec = null; for (const d of b.d) { if (d[0] <= tick) sec = d[1]; else break; }
        if (sec && sec.length && beam) faisceau(M, [b.x, b.y, b.z], sec, temps, camera ? Math.max(1, Math.hypot(b.x + 0.5 - camera.x, b.z + 0.5 - camera.z) / 96) : 1);   // la premiere section part du bloc de la balise
      }
      for (const c of cadres) { const s = etatCadre(c, tick); if (s && s[2] >= 0) dessinerCadre(M, c, s); }
      if (livreModele && livreTex) for (const P of pupitres) if (tick >= P.debut && tick < P.fin) dessinerLivre(M, P);
      return M.sortie();
    },
  };
}
