// Chemins praticables d'une zone : segments droits ou un acteur peut marcher ET ou une camera de suivi
// (4 blocs derriere, 2 au-dessus) voit l'acteur. Sert a `mcanim terrain` (resume pour l'IA) et a `--chemin` (verification).
// Rapide (quelques dizaines de ms pour 96 x 96) et deterministe : aucune part d'aleatoire, parcours dans un ordre fixe.

const PAS = 0.5;                 // pas d'echantillonnage le long d'un segment (blocs)
const LATERAL = [-1, -0.5, 0, 0.5, 1];  // "pas d'obstacle a 1 bloc de chaque cote"
const MARCHE_MAX = 1;            // marche maximale entre deux points a 1 bloc d'ecart
const CAMERA_ARRIERE = 4, CAMERA_HAUT = 2;
const LONGUEUR_MINI = 30, LONGUEUR_VISEE = 45, LONGUEUR_MAXI = 70;
// Chemins et clairieres : on ne cherche qu'au centre de la zone (fenetre de +-FENETRE blocs). Une grande zone (rayon 128) a un
// bord lointain que la brume cache : un acteur trop pres du bord aurait une vue tres courte. Zone de rayon <= 56 : toute la zone.
const FENETRE = 56;
const fenetre = (Z) => {
  const cx = Z.x0 + Z.sx / 2, cz = Z.z0 + Z.sz / 2;
  return { x0: Math.max(Z.x0 + 2, Math.ceil(cx - FENETRE)), x1: Math.min(Z.x0 + Z.sx - 2, Math.floor(cx + FENETRE)), z0: Math.max(Z.z0 + 2, Math.ceil(cz - FENETRE)), z1: Math.min(Z.z0 + Z.sz - 2, Math.floor(cz + FENETRE)) };
};

import { analyserVillage } from './village.js';

// Rues d'un village : un segment droit par morceau de rue (lignes centrales de village.js), garde s'il est praticable ; un morceau trop long est
// reduit a LONGUEUR_MAXI autour du centre du village ; un obstacle raccourcit le morceau (au moins LONGUEUR_MINI_RUE blocs restent). Les rues passent
// avant les autres chemins : c'est la ou les villageois marchent et ou le decor est fait pour la camera.
const LONGUEUR_MINI_RUE = 18;
export function cheminsDeRues(rs, { max = 4 } = {}) {
  let v = null;
  try { v = rs.zone?.palette ? analyserVillage(rs.zone) : null; } catch { v = null; }
  if (!v || !v.rues.length) return [];
  const sortie = [];
  const arr = (n) => Math.round(n * 2) / 2;
  for (const rue of v.rues) {
    for (let i = 1; i < rue.p.length; i++) {
      const [ax, az] = rue.p[i - 1], [bx, bz] = rue.p[i];
      const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / (L || 1), dz = (bz - az) / (L || 1);
      // morceaux praticables : un obstacle (puits de la place, marche de 2 blocs, mur) coupe le segment, on repart apres lui
      let d0 = 0;
      while (L - d0 >= LONGUEUR_MINI_RUE) {
        let d1 = L;
        let e = evaluerSegment(rs, ax + dx * d0, az + dz * d0, ax + dx * d1, az + dz * d1);
        if (!e.ok) { d1 = d0 + Math.floor(e.obstacle?.distance ?? 0) - 1; if (d1 - d0 >= LONGUEUR_MINI_RUE) e = evaluerSegment(rs, ax + dx * d0, az + dz * d0, ax + dx * d1, az + dz * d1); }
        if (e.ok && d1 - d0 >= LONGUEUR_MINI_RUE) {
          let u0 = d0, u1 = d1;
          if (u1 - u0 > LONGUEUR_MAXI) {                          // trop long : le morceau le plus proche du centre du village
            const t = Math.max(u0, Math.min(u1 - LONGUEUR_MAXI, (v.centre[0] - ax) * dx + (v.centre[1] - az) * dz - LONGUEUR_MAXI / 2));
            u0 = t; u1 = t + LONGUEUR_MAXI; e = evaluerSegment(rs, ax + dx * u0, az + dz * u0, ax + dx * u1, az + dz * u1);
          }
          if (e.ok) sortie.push({ de: [arr(ax + dx * u0), arr(az + dz * u0)], a: [arr(ax + dx * u1), arr(az + dz * u1)], longueur: Math.round(e.longueur), denivele: e.denivele, degagement: Math.round(e.degagement * 100), rue: true });
          d0 = d1 + 3;
        } else d0 += Math.max(3, Math.floor(e.obstacle?.distance ?? 0) + 3);
      }
    }
  }
  sortie.sort((p, q) => q.degagement - p.degagement + (q.longueur - p.longueur) / 40 || p.de[0] - q.de[0]);
  return sortie.slice(0, Math.min(max, 3));
}

// Colonnes de la zone : hauteur du sol, eau, et raison de l'obstacle a hauteur du corps (0..2 au-dessus du sol).
export function preparerMarche(rs) {
  if (rs._marche) return rs._marche;
  const Z = rs.zone;
  const sx = Z.sx, sz = Z.sz;
  const sol = new Int16Array(sx * sz), raison = new Uint8Array(sx * sz); // raison : 0 libre, 1 vide, 2 eau, 3 tronc, 4 feuillage, 5 bloc
  const NOMS = [null, 'le vide (hors du terrain)', "l'eau", 'un tronc', 'du feuillage', 'un bloc'];
  for (let j = 0; j < sz; j++) for (let i = 0; i < sx; i++) {
    const x = Z.x0 + i, z = Z.z0 + j, k = j * sx + i;
    const s = rs.solEn(x, z);
    if (s === null) { sol[k] = -32768; raison[k] = 1; continue; }
    sol[k] = s;
    if (rs.eauEn(x, z) !== null) { raison[k] = 2; continue; }
    let r = 0;
    if (rs.classeBloc(x, s - 1, z) === 'tronc') { raison[k] = 3; continue; }   // tronc : colonne d'arbre (feuilles au-dessus comprises)
    for (const dy of [0, 1]) {
      if (rs.estLibre(x + 0.5, s + dy + 0.5, z + 0.5)) continue;
      r = rs.classeBloc(x, s + dy, z) ?? 'bloc';
      r = r === 'tronc' ? 3 : r === 'feuillage' ? 4 : 5;
      break;
    }
    raison[k] = r;
  }
  const colonne = (x, z) => {
    const i = Math.floor(x) - Z.x0, j = Math.floor(z) - Z.z0;
    return i < 0 || j < 0 || i >= sx || j >= sz ? -1 : j * sx + i;
  };
  const m = { sol, raison, colonne, noms: NOMS, x0: Z.x0, z0: Z.z0, sx, sz, rs };
  rs._marche = m;
  return m;
}

// Evalue le segment (x1,z1) -> (x2,z2). Retourne { ok, longueur, denivele, degagement (0..1), obstacle? : { distance, x, z, quoi } }.
// Le corps est a hauteur 0..2 ; "libre" = pas de bloc a collision ni de feuillage, pas d'eau, marche <= 1 bloc.
export function evaluerSegment(rs, x1, z1, x2, z2) {
  const m = preparerMarche(rs);
  const L = Math.hypot(x2 - x1, z2 - z1);
  const r = { ok: true, longueur: L, denivele: 0, degagement: 0 };
  if (L < 1e-6) return r;
  const dx = (x2 - x1) / L, dz = (z2 - z1) / L, nx = -dz, nz = dx;
  let prec = null, mini = Infinity, maxi = -Infinity;
  let precEntier = null, camOk = 0, camN = 0;
  const nPas = Math.ceil(L / PAS);
  for (let k = 0; k <= nPas; k++) {
    const d = Math.min(L, k * PAS);
    const px = x1 + dx * d, pz = z1 + dz * d;
    // bande de +-1 bloc : toutes les colonnes doivent etre libres
    for (const o of LATERAL) {
      const c = m.colonne(px + nx * o, pz + nz * o);
      const code = c < 0 ? 1 : m.raison[c];
      if (code !== 0) { r.ok = false; r.obstacle = { distance: d, x: Math.floor(px + nx * o), z: Math.floor(pz + nz * o), quoi: m.noms[code] }; return finir(r, mini, maxi, camOk, camN); }
    }
    const c0 = m.colonne(px, pz);
    const s = m.sol[c0];
    mini = Math.min(mini, s); maxi = Math.max(maxi, s);
    // marche : compare avec le point echantillonne environ 1 bloc plus tot
    if (k % 2 === 0) {
      if (precEntier !== null && Math.abs(s - precEntier) > MARCHE_MAX) {
        r.ok = false; r.obstacle = { distance: d, x: Math.floor(px), z: Math.floor(pz), quoi: `une marche de ${Math.abs(s - precEntier)} blocs (${s > precEntier ? 'montee' : 'descente'})` };
        return finir(r, mini, maxi, camOk, camN);
      }
      precEntier = s;
      // espace pour la camera 4 blocs derriere et 2 au-dessus, avec la ligne de vue vers la tete
      camN++;
      if (cameraDegagee(m, px, pz, dx, dz, s)) camOk++;
    }
    void prec;
  }
  return finir(r, mini, maxi, camOk, camN);
}

function finir(r, mini, maxi, camOk, camN) {
  r.denivele = Number.isFinite(mini) ? maxi - mini : 0;
  r.degagement = camN ? camOk / camN : 0;
  return r;
}

function cameraDegagee(m, px, pz, dx, dz, solY) {
  const rs = m.rs;
  const cx = px - dx * CAMERA_ARRIERE, cz = pz - dz * CAMERA_ARRIERE, cy = solY + CAMERA_HAUT;
  if (!rs.estLibre(cx, cy, cz)) return false;
  const tx = px, ty = solY + 1.62, tz = pz;
  for (let s = 0.5; s < 1; s += 0.1) {                       // ligne de vue (feuilles comprises : on veut une image nette)
    if (!rs.estLibre(cx + (tx - cx) * s, cy + (ty - cy) * s, cz + (tz - cz) * s)) return false;
  }
  return true;
}

// Les meilleurs corridors, du meilleur au moins bon : [{ de:[x,z], a:[x,z], longueur, denivele, degagement }] (entiers, degagement en %).
export function trouverChemins(rs, { max = 4 } = {}) {
  const rues = cheminsDeRues(rs, { max });   // village : les rues d'abord
  const m = preparerMarche(rs);
  const Z = rs.zone;
  const candidats = [];
  const ANGLES = 48;
  const F = fenetre(Z);
  for (let z = Z.z0 + 2; z < Z.z0 + Z.sz - 2; z += 2) for (let x = Z.x0 + 2; x < Z.x0 + Z.sx - 2; x += 2) {
    if (x < F.x0 || x > F.x1 || z < F.z0 || z > F.z1) continue;
    if (m.raison[m.colonne(x, z)] !== 0) continue;
    for (let a = 0; a < ANGLES; a++) {
      const ang = (a * 2 * Math.PI) / ANGLES, dx = Math.cos(ang), dz = Math.sin(ang);
      // marche tant que le segment reste praticable (on evalue directement les longueurs croissantes, dichotomie non necessaire : pas de 2)
      let bonne = null;
      for (let L = LONGUEUR_MINI; L <= LONGUEUR_MAXI; L += 5) {
        const ex = Math.round(x + dx * L), ez = Math.round(z + dz * L);
        if (ex < F.x0 || ex > F.x1 || ez < F.z0 || ez > F.z1) break;
        const e = evaluerSegment(rs, x, z, ex, ez);
        if (!e.ok) break;
        bonne = { de: [x, z], a: [ex, ez], e };
      }
      if (bonne && bonne.e.longueur >= LONGUEUR_MINI) candidats.push(bonne);
    }
  }
  // note : plus long (jusqu'a 70), peu de denivele, bon espace pour la camera
  const note = (c) => Math.min(c.e.longueur, LONGUEUR_MAXI) + (c.e.longueur >= LONGUEUR_VISEE ? 15 : 0) + c.e.degagement * 40 - c.e.denivele * 6;
  candidats.sort((p, q) => note(q) - note(p) || p.de[0] - q.de[0] || p.de[1] - q.de[1]);
  const choisis = [];
  for (const c of candidats) {
    if (c.e.degagement < 0.6) continue;
    const mx = (c.de[0] + c.a[0]) / 2, mz = (c.de[1] + c.a[1]) / 2, ang = Math.atan2(c.a[1] - c.de[1], c.a[0] - c.de[0]);
    const proche = choisis.some((o) => {
      const ox = (o.de[0] + o.a[0]) / 2, oz = (o.de[1] + o.a[1]) / 2, oa = Math.atan2(o.a[1] - o.de[1], o.a[0] - o.de[0]);
      let da = Math.abs(ang - oa); da = Math.min(da, 2 * Math.PI - da);
      // meme region ET meme direction (a l'envers aussi) : doublon
      const inverse = Math.abs(da - Math.PI) < 0.5;
      return Math.hypot(mx - ox, mz - oz) < 14 && (da < 0.5 || inverse) || Math.hypot(mx - ox, mz - oz) < 4;
    });
    if (proche) continue;
    choisis.push(c);
    if (choisis.length >= max) break;
  }
  // sens de marche : celui qui laisse le plus d'espace a la camera (elle est derriere l'acteur)
  const ordinaires = choisis.map((c) => {
    const inv = evaluerSegment(rs, c.a[0], c.a[1], c.de[0], c.de[1]);
    const dir = inv.ok && inv.degagement > c.e.degagement + 0.02 ? { de: c.a, a: c.de, e: inv } : c;
    return { de: dir.de, a: dir.a, longueur: Math.round(dir.e.longueur), denivele: dir.e.denivele, degagement: Math.round(dir.e.degagement * 100) };
  });
  return [...rues, ...ordinaires].slice(0, max);
}

// Clairieres : endroits ouverts (aucun obstacle a hauteur du corps, sol presque plat) ; { centre:[x,z], rayon }.
export function trouverClairieres(rs, { max = 2, rayonMini = 5 } = {}) {
  const m = preparerMarche(rs);
  const { sx, sz } = m;
  const bloque = new Uint8Array(sx * sz);
  for (let j = 0; j < sz; j++) for (let i = 0; i < sx; i++) {
    const k = j * sx + i;
    let b = m.raison[k] !== 0;
    if (!b) for (const [di, dj] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const i2 = i + di, j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= sx || j2 >= sz || Math.abs(m.sol[j2 * sx + i2] - m.sol[k]) > MARCHE_MAX) { b = true; break; }
    }
    bloque[k] = b ? 1 : 0;
  }
  const R = 14;
  const res = [];
  const F = fenetre(rs.zone);
  for (let j = 0; j < sz; j++) for (let i = 0; i < sx; i++) {
    if (bloque[j * sx + i]) continue;
    if (m.x0 + i < F.x0 || m.x0 + i > F.x1 || m.z0 + j < F.z0 || m.z0 + j > F.z1) continue;
    let d2 = R * R;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const q = di * di + dj * dj;
      if (q >= d2) continue;
      const i2 = i + di, j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= sx || j2 >= sz || bloque[j2 * sx + i2]) d2 = q;
    }
    const r = Math.sqrt(d2) - 0.5;
    if (r >= rayonMini) res.push({ centre: [m.x0 + i, m.z0 + j], rayon: Math.floor(r) });
  }
  res.sort((p, q) => q.rayon - p.rayon || p.centre[0] - q.centre[0] || p.centre[1] - q.centre[1]);
  const choisis = [];
  for (const c of res) {
    if (choisis.every((o) => Math.hypot(o.centre[0] - c.centre[0], o.centre[1] - c.centre[1]) > o.rayon + c.rayon + 4)) choisis.push(c);
    if (choisis.length >= max) break;
  }
  return choisis;
}

// Etendues d'eau (colonnes d'eau connexes, resolution d'un bloc) : [{ x:[min,max], z:[min,max], y }], les plus grandes d'abord.
export function trouverEau(rs, { max = 3, mini = 6 } = {}) {
  const m = preparerMarche(rs);
  const { sx, sz } = m;
  const vu = new Uint8Array(sx * sz), res = [];
  for (let k0 = 0; k0 < sx * sz; k0++) {
    if (m.raison[k0] !== 2 || vu[k0]) continue;
    const pile = [k0]; vu[k0] = 1;
    let n = 0, i0 = sx, i1 = 0, j0 = sz, j1 = 0;
    while (pile.length) {
      const k = pile.pop(), i = k % sx, j = (k - i) / sx; n++;
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const i2 = i + di, j2 = j + dj;
        if (i2 < 0 || j2 < 0 || i2 >= sx || j2 >= sz) continue;
        const k2 = j2 * sx + i2;
        if (m.raison[k2] === 2 && !vu[k2]) { vu[k2] = 1; pile.push(k2); }
      }
    }
    if (n < mini) continue;
    const niveau = rs.eauEn(m.x0 + (k0 % sx), m.z0 + Math.floor(k0 / sx));
    res.push({ x: [m.x0 + i0, m.x0 + i1], z: [m.z0 + j0, m.z0 + j1], y: Math.round(niveau), n });
  }
  res.sort((p, q) => q.n - p.n || p.x[0] - q.x[0] || p.z[0] - q.z[0]);
  return res.slice(0, max).map(({ n, ...l }) => l);
}

// Phrase de reponse de `mcanim terrain <zone> --chemin x1,z1,x2,z2`.
export function verifierChemin(rs, x1, z1, x2, z2) {
  const e = evaluerSegment(rs, x1, z1, x2, z2);
  const L = Math.round(e.longueur);
  if (e.ok) {
    const cam = Math.round(e.degagement * 100);
    return `chemin LIBRE : ${L} blocs, denivele ${e.denivele}, camera degagee sur ${cam} % du trajet${cam < 60 ? ' (attention : camera souvent gênée ; essaie un chemin de la liste)' : ''}`.replace('gênée', 'genee');
  }
  const o = e.obstacle;
  return `chemin BLOQUE a ${Math.round(o.distance)} blocs du depart, pres de (${o.x}, ${o.z}) : ${o.quoi} (sur ${L} blocs prevus)`;
}
