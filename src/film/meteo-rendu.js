// Dessin de la meteo : pluie et neige (colonnes de traits autour de la camera, comme WeatherEffectRenderer du jeu), eclaboussures au sol, coups de foudre (forme du jeu :
// LightningBoltRenderer, 4 couches de segments de 16 blocs). Maillages dynamiques deterministes, lus dans la piste `ciel.meteo` de la scene et dans le replay (entite `foudre`).
//   pluie : rayon 10 ; une colonne = un plan tourne vers la camera, large de 1 bloc, de la surface (carte des hauteurs MOTION_BLOCKING) jusqu'a 10 blocs au-dessus de la camera ;
//           texture environment/rain.png repetee tous les 4 blocs, defilement (3 + alea) / 32 par tick ; opacite ((1 - d^2) x 0,5 + 0,5) x niveau de pluie
//   neige : environment/snow.png, defilement lent, opacite ((1 - d^2) x 0,3 + 0,5) x niveau ; le type vient du biome de la colonne (temperature < 0,15 : neige ; sans precipitation : rien)
//   Le raster a des UV bornees (pas de repetition) : une colonne est coupee en tranches de une texture de haut ; l'opacite est cuite dans des copies de la texture (8 niveaux).
import { Aleatoire } from '../moteur/aleatoire.js';
import { boitesLocales } from '../moteur/collision.js';
import { niveauxMeteo } from './meteo.js';

const RAD = Math.PI / 180;
const RAYON = 10;
const hash = (n) => { let h = (n * 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };

class Plans {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; }
  quad(p, uv, c) {
    const b = this.pos.length / 3;
    for (let i = 0; i < 4; i++) { this.pos.push(p[i][0], p[i][1], p[i][2]); this.uv.push(uv[i][0], uv[i][1]); this.col.push(c[0], c[1], c[2]); }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  vide() { return this.idx.length === 0; }
  maillage(texture, genre, additif = false) { return { genre, additif, positions: Float32Array.from(this.pos), uvs: Float32Array.from(this.uv), couleurs: Float32Array.from(this.col), indices: Uint32Array.from(this.idx), texture, mode: 'melange', deuxFaces: true }; }
}

// Pluie : la texture du jeu (environment/rain.png, 70/103/195 a alpha faible) est dessinee telle quelle, comme le jeu et Horizon (couleur de sommet blanche).
// Regle du proprietaire : tout comme le jeu. Les constantes ci-dessous permettent de la palir (0 et 1 = texture d'origine) ; ne pas les changer sans raison.
const PALE = [222, 228, 238], MELANGE_PALE = 0, OPACITE_PALE = 1;
const palir = (t) => t && ({ largeur: t.largeur, hauteur: t.hauteur, rgba: t.rgba.map((v, i) => { const c = i % 4; return c === 3 ? Math.round(v * OPACITE_PALE) : Math.round(v + (PALE[c] - v) * MELANGE_PALE); }) });

export function creerMeteoRendu({ rs, replay, scene, donnees, terrain, texOf, lum }) {
  const piste = scene.ciel?.meteo ?? null;
  const E = replay.entitesVue, n = E.length / 8;
  // coups de foudre : lignes du replay par identifiant
  const foudres = new Map();
  for (let i = 0; i < n; i++) if (replay.noms[E[i * 8 + 2]] === 'foudre') { const id = E[i * 8 + 1]; if (!foudres.has(id)) foudres.set(id, []); foudres.get(id).push(i * 8); }
  if (!piste && !foudres.size) return null;
  const tex = { pluie: piste ? palir(texOf('environment/rain.png')) : null, neige: piste ? texOf('environment/snow.png') : null, eclat: [] };
  let splash;   // gouttes : texture palie une seule fois (le rasteriseur garde les textures par identite)
  const variantes = new Map();
  const alphaTex = (cle, base, niveau) => {      // copie de la texture dont l'alpha est multiplie par (niveau + 1) / 8
    const k = cle + niveau;
    if (!variantes.has(k)) { const f = (niveau + 1) / 8; variantes.set(k, { largeur: base.largeur, hauteur: base.hauteur, rgba: base.rgba.map((v, i) => (i % 4 === 3 ? Math.round(v * f) : v)) }); }
    return variantes.get(k);
  };
  const m = rs.monde;
  const lec = terrain?.lec ?? null;
  const surface = (x, z) => {          // MOTION_BLOCKING : 1 au-dessus du bloc le plus haut qui arrete le mouvement ou tient un fluide
    if (!m || !lec) return rs.zone.hauteur ? rs.zone.hauteur(x, z) + 1 : 0;
    for (let y = m.y0 + m.sy - 1; y >= m.y0; y--) {
      const e = lec.etatEn(x, y, z);
      if (e >= 0 && (donnees.fluide(e) > 0 || boitesLocales(lec, x, y, z).length > 0)) return y + 1;
    }
    return m.y0;
  };
  const type = (x, z, y) => {          // 'pluie' | 'neige' | null selon le biome de la colonne
    let b = null;
    try { b = donnees.biome(rs.zone.biome(x, z)); } catch { b = null; }
    if (!b || !b[1]) return null;
    let t = b[2] ? Math.min(b[0], 0) : b[0];
    if (y > 80) t -= (y - 80) * 0.05 / 40;
    return t < 0.15 ? 'neige' : 'pluie';
  };
  const alea = new Map();
  const tire = (x, z) => {             // les tirages d'une colonne (graine du jeu), gardes
    const k = x + ',' + z;
    if (!alea.has(k)) {
      const graine = (Math.imul(Math.imul(x, x), 3121) + Math.imul(x, 45238971)) ^ (Math.imul(Math.imul(z, z), 418711) + Math.imul(z, 13761));
      const r = new Aleatoire(graine >>> 0);
      alea.set(k, { f: r.flottant(), d1: r.reel(), g1: r.gaussien(), d2: r.reel(), g2: r.gaussien(), cle: (Math.imul(Math.imul(x, x), 3121) + Math.imul(x, 45238971) + Math.imul(Math.imul(z, z), 418711) + Math.imul(z, 13761)) });
    }
    return alea.get(k);
  };

  // ---- foudre : la forme du jeu
  // couleur par couche (de la plus fine, tres claire, a la plus large, bleutee et faible) : un coeur mince tres brillant, un halo discret
  const CL = [[1, 1, 1], [0.27, 0.32, 0.5], [0.1, 0.12, 0.22], [0.04, 0.05, 0.1]];
  const bolt = (graine, x, y, z, P) => {
    const af = new Float64Array(8), af1 = new Float64Array(8);
    let f = 0, f1 = 0;
    const r = new Aleatoire(graine >>> 0);
    for (let i = 7; i >= 0; i--) { af[i] = f; af1[i] = f1; f += r.entierBorne(11) - 5; f1 += r.entierBorne(11) - 5; }
    for (let k1 = 0; k1 < 4; k1++) {
      const r1 = new Aleatoire(graine >>> 0);
      for (let j = 0; j < 3; j++) {
        let k = 7, l = 0;
        if (j > 0) k = 7 - j;
        if (j > 0) l = k - 2;
        let f2 = af[k] - f, f3 = af1[k] - f1;
        for (let i1 = k; i1 >= l; i1--) {
          const f4 = f2, f5 = f3;
          if (j === 0) { f2 += r1.entierBorne(11) - 5; f3 += r1.entierBorne(11) - 5; } else { f2 += r1.entierBorne(31) - 15; f3 += r1.entierBorne(31) - 15; }   // branches : plus larges (Horizon : nextInt(31) - 15)
          let w1 = 0.1 + k1 * 0.2, w2 = 0.1 + k1 * 0.2;
          if (j === 0) { w1 *= i1 * 0.1 + 1; w2 *= (i1 - 1) * 0.1 + 1; }
          const face = (a, b, c, d) => {
            const S = (cond, w) => (cond ? w : -w);
            P.quad([[x + f2 + S(a, w1), y + i1 * 16, z + f3 + S(b, w1)], [x + f4 + S(a, w2), y + (i1 + 1) * 16, z + f5 + S(b, w2)], [x + f4 + S(c, w2), y + (i1 + 1) * 16, z + f5 + S(d, w2)], [x + f2 + S(c, w1), y + i1 * 16, z + f3 + S(d, w1)]], [[0, 0], [1, 0], [1, 1], [0, 1]], CL[k1]);
          };
          face(false, false, true, false); face(true, false, true, true); face(true, true, false, true); face(false, true, false, false);
        }
      }
    }
  };
  // couche de 0,3 d'opacite en blanc bleute (0,45 0,45 0,5 dans LightningBoltRenderer), ici un peu renforcee ; dessinee en ADDITIF : 4 couches empilees, coeur tres clair, halo bleute
const texEclair = { largeur: 1, hauteur: 1, rgba: new Uint8Array([255, 255, 255, 235]) };

  return {
    // niveaux de pluie et d'orage au temps du monde tm (secondes de film)
    niveaux(tm) { return niveauxMeteo(piste, tm); },
    // vrai quand un eclair illumine le ciel a ce tick (un coup de foudre dont la vie est >= 0)
    eclair(tick) {
      for (const L of foudres.values()) { const k = tick - E[L[0]]; if (k >= 0 && k < L.length && E[L[k] + 7] >= 0) return true; }
      return false;
    },
    maillages(tm, camera) {
      const u = Math.max(0, tm * 20 * replay.ralenti), tick = Math.floor(u), frac = u - tick, out = [];
      const niv = niveauxMeteo(piste, tm);
      terrain?.regle?.(tick);
      if (piste && niv.pluie > 0.01 && camera) {
        const cx = Math.floor(camera.x), cz = Math.floor(camera.z), cy = Math.floor(camera.y);
        const parTex = new Map();
        const P = (t, niveau) => { const k = t + niveau; if (!parTex.has(k)) parTex.set(k, { t, niveau, P: new Plans() }); return parTex.get(k).P; };
        for (let z = cz - RAYON; z <= cz + RAYON; z++) for (let x = cx - RAYON; x <= cx + RAYON; x++) {
          const dx = x - cx, dz = z - cz, dist = Math.hypot(dx, dz);
          const surf = surface(x, z), genre = type(x, z, surf);
          if (!genre) continue;
          let y0 = cy - RAYON, y1 = cy + RAYON;
          if (y0 < surf) y0 = surf;
          if (y1 < surf) y1 = surf;
          if (y0 === y1) continue;
          const sx = dist > 0 ? -dz / dist : 1, sz = dist > 0 ? dx / dist : 0, xd = sx * 0.5, zd = sz * 0.5;
          const T = tire(x, z), d2 = (Math.hypot(x + 0.5 - camera.x, z + 0.5 - camera.z) / RAYON) ** 2;
          let alpha, vOff, uOff = 0;
          if (genre === 'pluie') { alpha = ((1 - d2) * 0.5 + 0.5) * niv.pluie; vOff = -(((tick + T.cle) & 31) + frac) / 32 * (3 + T.f); } else { alpha = ((1 - d2) * 0.3 + 0.5) * niv.pluie; uOff = T.d1 + (tick + frac) * 0.01 * T.g1 * 0.1; vOff = T.d2 - (tick + frac) * 0.012 + 0 * T.g2; }
          if (alpha <= 0.02) continue;
          const base = genre === 'pluie' ? tex.pluie : tex.neige;
          if (!base) continue;
          const niveau = Math.max(0, Math.min(7, Math.round(alpha * 8) - 1));
          const L = Math.max(0.35, lum(x + 0.5, y1, z + 0.5));
          const col = genre === 'pluie' ? [L, L, L] : [Math.min(1, (L * 3 + 1) / 4), Math.min(1, (L * 3 + 1) / 4), Math.min(1, (L * 3 + 1) / 4)];
          // v(y) = (y0 + y1 - y) / 4 + vOff : decoupe en tranches ou floor(v) est constant
          const vDe = (y) => (y0 + y1 - y) * 0.25 + vOff;
          let yb = y0;                 // du bas vers le haut : v diminue
          while (yb < y1 - 1e-9) {
            const vb = vDe(yb), k = Math.ceil(vb - 1e-9) - 1;       // tranche [k, k + 1] contenant vb
            let yh = (y0 + y1) - (k + 0 - vOff) * 4;             // y ou v = k
            if (yh > y1) yh = y1;
            if (yh <= yb + 1e-9) yh = Math.min(y1, yb + 0.25);
            const vh = vDe(yh);
            P(genre, niveau).quad([[x - camera.x * 0 + 0.5 - xd, yh, z + 0.5 - zd], [x + 0.5 + xd, yh, z + 0.5 + zd], [x + 0.5 + xd, yb, z + 0.5 + zd], [x + 0.5 - xd, yb, z + 0.5 - zd]], [[uOff % 1 < 0 ? 0 : 0, vh - k], [1, vh - k], [1, vb - k], [0, vb - k]].map(([a, b]) => [Math.max(0, Math.min(1, a)), Math.max(0, Math.min(1, b))]), col);
            yb = yh;
          }
          // eclaboussures au sol (pluie) : des gouttes qui rebondissent, tirees par colonne et par tick (les 4 derniers ticks)
          if (genre === 'pluie' && surf >= cy - RAYON && surf <= cy + RAYON + 4) {
            for (let a = 0; a < 4; a++) {
              const h = hash(Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ Math.imul(tick - a, 83492791));
              if (h > 0.2 * niv.pluie) continue;
              const px = x + hash(h * 977) , pz = z + hash(h * 1999), s = 0.07 + 0.05 * hash(h * 31), yy = surf + 0.04 + a * 0.05;
              P('goutte', 7).quad([[px - s, yy, pz - s], [px + s, yy, pz - s], [px + s, yy, pz + s], [px - s, yy, pz + s]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.9, 0.95, 1]);
            }
          }
        }
        for (const { t, niveau, P } of parTex.values()) {
          if (P.vide()) continue;
          if (t === 'goutte') { const g = (splash ??= palir(texOf('particle/splash_0.png'))); if (g) out.push(P.maillage(alphaTex('g', g, 7), 'pluie')); continue; }
          out.push(P.maillage(alphaTex(t, t === 'pluie' ? tex.pluie : tex.neige, niveau), 'pluie'));
        }
      }
      // coups de foudre vivants a ce tick
      const B = new Plans();
      for (const L of foudres.values()) {
        const k = tick - E[L[0]];
        if (k < 0 || k >= L.length) continue;
        const r = L[k];
        bolt(E[r + 6] | 0, E[r + 3], E[r + 4], E[r + 5], B);
      }
      if (!B.vide()) out.push(B.maillage(texEclair, 'eclair', true));
      return out;
    },
  };
}
