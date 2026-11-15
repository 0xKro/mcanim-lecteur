// Mailleur : zone -> triangles, UNE FOIS par zone.
// Coordonnees monde. Une face est emise si son voisin ne la cache pas.
// Couleur par sommet = ombrage de direction x occlusion ambiante x lumiere du ciel x teinte du biome.
import { melangeHash, NORMALES, AXE_DIR } from './modeles.js';
import { sourcesTeinte } from './teinte.js';
import { COUCHE_OPAQUE, COUCHE_DECOUPE, COUCHE_MELANGE } from './textures.js';

const OMBRE_DIR = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6]; // bas, haut, nord, sud, ouest, est
const AMBIANT = 0.0; // lumiere ambiante de la dimension (overworld : 0)
// Courbe de luminosite du jeu : v/(4-3v), puis reglage "luminosite" par defaut du jeu (gamma 0,5) :
// b = mix(v, 1-(1-v)^4, gamma). gamma = 0 donne la courbe pure.
export const courbeLumiere = (niveau, gamma = 0.5) => {
  const v = niveau / 15, c = v / (4 - 3 * v), b = c + (1 - c) * AMBIANT;
  return b * (1 - gamma) + gamma * (1 - Math.pow(1 - b, 4));
};

// Tampon de quads qui grandit tout seul
class Tampon {
  constructor() { this.n = 0; this.cap = 4096; this.pos = new Float32Array(this.cap * 12); this.uv = new Float32Array(this.cap * 8); this.col = new Uint32Array(this.cap * 4); this.spr = new Int32Array(this.cap); this.sec = new Int32Array(this.cap); this.flip = new Uint8Array(this.cap); }
  garantir() {
    if (this.n < this.cap) return;
    const c = this.cap * 2;
    const g = (a, k) => { const b = new a.constructor(c * k); b.set(a); return b; };
    this.pos = g(this.pos, 12); this.uv = g(this.uv, 8); this.col = g(this.col, 4); this.spr = g(this.spr, 1); this.sec = g(this.sec, 1); this.flip = g(this.flip, 1);
    this.cap = c;
  }
}

const OFFSET_XZ = /^(short_grass|fern|tall_grass|large_fern|dandelion|poppy|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony|dead_bush|seagrass|tall_seagrass|hanging_roots|bamboo|torchflower|pointed_dripstone)$/;
const NON_COLLISION = /(grass|fern|dandelion|poppy|orchid|allium|bluet|tulip|daisy|cornflower|lily_of|lily_pad|rose|peony|lilac|sunflower|bush|mushroom|sapling|vine|torch|lichen|carpet|^snow$|leaf_litter|petals|wildflowers|rail|_sign|button|pressure_plate|tripwire|^string$|^fire$|seagrass|kelp|cobweb|dripleaf|roots|sprout|fungus|^wheat$|carrots|potatoes|beetroots|_stem|sugar_cane|dead_bush|berries|berry|firefly|bubble|^ladder$|^lever$|banner|^water$|^lava$|torchflower|eyeblossom|flower$|^moss_carpet$|frogspawn|pitcher_crop|^light$|^barrier$)/;

function graine(x, y, z) { // Mth.getSeed du jeu
  let l = BigInt.asIntN(64, BigInt(Math.imul(x, 3129871))) ^ (BigInt.asIntN(64, BigInt(z)) * 116129781n) ^ BigInt(y);
  l = BigInt.asIntN(64, l * l * 42317861n + l * 11n);
  return l >> 16n;
}
function decalageXZ(x, z) {
  const s = graine(x, 0, z);
  const f = (v) => Math.max(-0.25, Math.min(0.25, ((Number(v & 15n) / 15) - 0.5) * 0.5));
  return [f(s), f((s >> 8n))];
}

// Construit le maillage. options : { rayonMelange, aoActif, tailleSection }
export function mailler({ zone, modeles, textures, couleurs, options = {} }) {
  const gamma = options.gamma ?? 0.5;
  const courbe = new Float32Array(16).map((_, l) => courbeLumiere(l, gamma));
  const lumiere = (l) => { const i = l | 0, f = l - i; return i >= 15 ? courbe[15] : courbe[i] + (courbe[i + 1] - courbe[i]) * f; };
  const t0 = Date.now();
  const { sx, sy, sz } = zone;
  const PX = sx + 2, PY = sy + 2, PZ = sz + 2;
  const OY = PX * PZ, OZ = PX, OX = 1;
  const pal = new Uint16Array(PX * PY * PZ);
  const caseIdx = (x, y, z) => ((y + 1) * PZ + (z + 1)) * PX + (x + 1);
  // contenu : copie des lignes
  for (let y = 0; y < sy; y++) {
    for (let z = 0; z < sz; z++) {
      const src = (y * sz + z) * sx, dst = caseIdx(0, y, z);
      for (let x = 0; x < sx; x++) pal[dst + x] = zone.cellules[src + x];
    }
  }
  // bordure : cache sous la surface (hauteur de la colonne la plus proche), air au-dessus
  for (let y = -1; y <= sy; y++) {
    const yw = zone.y0 + y;
    for (let z = -1; z <= sz; z++) {
      for (let x = -1; x <= sx; x++) {
        if (x >= 0 && x < sx && z >= 0 && z < sz && y >= 0 && y < sy) continue;
        const h = zone.hauteur(zone.x0 + x, zone.z0 + z);
        pal[caseIdx(x, y, z)] = y < 0 ? 1 : (y >= sy ? 0 : (yw <= h ? 1 : 0));
      }
    }
  }
  // etats par entree de palette
  const NP = zone.palette.length;
  const etats = new Array(NP);
  const opaque = new Uint8Array(NP), perm = new Uint8Array(NP), opac = new Uint8Array(NP), kind = new Uint8Array(NP);
  const aoSh = new Float32Array(NP).fill(1);
  for (let i = 0; i < NP; i++) {
    if (i === 1) { opaque[1] = 1; perm[1] = 0; opac[1] = 15; aoSh[1] = 0.2; continue; }
    const e = modeles.etat(zone.palette[i]);
    etats[i] = e;
    kind[i] = e.type;
    opaque[i] = e.opaque ? 1 : 0; perm[i] = e.opaque ? 0 : 1; opac[i] = e.opaciteLumiere;
    aoSh[i] = e.aoSolide ? 0.2 : 1;
    if (e.type === 1 && e.geo.length === 0 && !e.aleatoire) kind[i] = 0;
  }

  // ---------- lumiere du ciel ----------
  const lum = new Uint8Array(PX * PY * PZ);
  for (let z = 0; z < PZ; z++) {
    for (let x = 0; x < PX; x++) {
      let L = 15;
      for (let y = PY - 1; y >= 0; y--) {
        const i = (y * PZ + z) * PX + x;
        const o = opac[pal[i]];
        if (o >= 15) L = 0; else if (o > 0) L = Math.max(0, L - o);
        lum[i] = L;
      }
    }
  }
  let file = new Int32Array(1 << 16), tete = 0, queue = 0;
  const pousser = (i) => { if (queue >= file.length) { const n = new Int32Array(file.length * 2); n.set(file); file = n; } file[queue++] = i; };
  const voisins = [OX, -OX, OZ, -OZ, OY, -OY];
  for (let y = 1; y < PY - 1; y++) {
    for (let z = 1; z < PZ - 1; z++) {
      for (let x = 1; x < PX - 1; x++) {
        const i = (y * PZ + z) * PX + x;
        const L = lum[i];
        if (L < 2) continue;
        for (let k = 0; k < 6; k++) {
          const n = i + voisins[k];
          if (opac[pal[n]] < 15 && lum[n] + 1 < L) { pousser(i); break; }
        }
      }
    }
  }
  while (tete < queue) {
    const i = file[tete++];
    const L = lum[i];
    if (L < 2) continue;
    for (let k = 0; k < 6; k++) {
      const n = i + voisins[k];
      // ne sort pas du tableau : la bordure sert de garde
      if (n < 0 || n >= lum.length) continue;
      const o = opac[pal[n]];
      if (o >= 15) continue;
      const nl = L - (o > 1 ? o : 1);
      if (nl > lum[n]) { lum[n] = nl; pousser(n); }
    }
  }

  // ---------- teintes par colonne ----------
  const tab = couleurs.tableaux(zone, options.rayonMelange ?? 2);
  const teintesPal = new Array(NP);
  for (let i = 2; i < NP; i++) teintesPal[i] = etats[i].type === 1 ? sourcesTeinte(etats[i].nom, etats[i].props) : null;

  // ---------- emission ----------
  const tampons = [new Tampon(), new Tampon(), new Tampon()];
  const TS = options.tailleSection ?? 16;
  const nsx = Math.ceil(sx / TS), nsy = Math.ceil(sy / TS), nsz = Math.ceil(sz / TS);
  const secDe = (x, y, z) => ((y / TS | 0) * nsz + (z / TS | 0)) * nsx + (x / TS | 0);
  const stat = { quads: 0, cellules: 0, cullees: 0 };
  const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const cible = [0, 0, 0, 0];

  // axes tangents par direction : [decalage t1, decalage t2, axe t1, axe t2]
  const TAN = [[OX, OZ, 0, 2], [OX, OZ, 0, 2], [OX, OY, 0, 1], [OX, OY, 0, 1], [OZ, OY, 2, 1], [OZ, OY, 2, 1]];
  const OFFDIR = [-OY, OY, -OZ, OZ, -OX, OX];

  const luminositeBord = new Float32Array(4);
  const aoBord = new Float32Array(4);
  const luBord = new Float32Array(4);
  const br = new Float32Array(4);

  function emettreQuad(couche, tex, q, i, lx, ly, lz, dx, dy, dz, colonne, vertCol) {
    // lumiere/AO aux 4 coins du carre devant la face
    const dF = q.dirFace;
    if (q.bord === undefined) {
      const ax = AXE_DIR[dF], plan = NORMALES[dF][ax] > 0 ? 1 : 0;
      let ok = true;
      for (const p of q.p) if (Math.abs(p[ax] - plan) > 1e-4) ok = false;
      q.bord = ok;
    }
    const base = q.bord ? i + OFFDIR[dF] : i;
    const [a, b, ax1, ax2] = TAN[dF];
    const pc = pal[base];
    let Lc = lum[base];
    if (opac[pc] >= 15) Lc = lum[i];
    const flat = !q.ao || options.aoActif === false;
    if (flat) {
      const brt = lumiere(q.emission || kind[pal[i]] === 3 ? 15 : Lc);
      br[0] = br[1] = br[2] = br[3] = brt;
    } else {
      const sCentre = aoSh[pc];
      for (let c = 0; c < 4; c++) {
        const oa = (c & 1) ? a : -a, ob = (c & 2) ? b : -b;
        const pa = pal[base + oa], pb = pal[base + ob];
        const pk = (perm[pa] || perm[pb]) ? pal[base + oa + ob] : pa;
        const nk = (perm[pa] || perm[pb]) ? base + oa + ob : base + oa;
        const ao = (aoSh[pa] + aoSh[pb] + aoSh[pk] + sCentre) * 0.25;
        const la = opac[pa] >= 15 ? Lc : lum[base + oa];
        const lb = opac[pb] >= 15 ? Lc : lum[base + ob];
        const lk = opac[pk] >= 15 ? Lc : lum[nk];
        const l = q.emission || kind[pal[i]] === 3 ? 15 : (la + lb + lk + Lc) * 0.25;
        br[c] = ao * lumiere(l);
      }
    }
    const ombre = OMBRE_DIR[q.dirOmbre];
    // teinte
    let r = 255, g = 255, bl = 255;
    if (q.tint >= 0 && vertCol) {
      let src = vertCol[Math.min(q.tint, vertCol.length - 1)];
      if (typeof src === 'string') src = tab[src][colonne];
      if (src !== null && src !== undefined) { r = (src >> 16) & 255; g = (src >> 8) & 255; bl = src & 255; }
    }
    const T = tampons[couche];
    T.garantir();
    const n = T.n++;
    const po = n * 12, uo = n * 8, co = n * 4;
    let jaune = 0;
    const vb = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const p = q.p[k];
      T.pos[po + k * 3] = zone.x0 + lx + p[0] + dx;
      T.pos[po + k * 3 + 1] = zone.y0 + ly + p[1] + dy;
      T.pos[po + k * 3 + 2] = zone.z0 + lz + p[2] + dz;
      T.uv[uo + k * 2] = q.uv[k][0]; T.uv[uo + k * 2 + 1] = q.uv[k][1];
      // poids bilineaire du sommet dans le carre (coordonnees dans la cellule)
      const w1 = Math.min(1, Math.max(0, p[ax1])), w2 = Math.min(1, Math.max(0, p[ax2]));
      const v = (1 - w1) * (1 - w2) * br[0] + w1 * (1 - w2) * br[1] + (1 - w1) * w2 * br[2] + w1 * w2 * br[3];
      vb[k] = v;
      const f = v * ombre;
      const R = Math.min(255, (r * f + 0.5) | 0), G = Math.min(255, (g * f + 0.5) | 0), B = Math.min(255, (bl * f + 0.5) | 0);
      T.col[co + k] = (255 << 24) | (B << 16) | (G << 8) | R;
    }
    void jaune;
    T.flip[n] = vb[1] + vb[3] > vb[0] + vb[2] ? 1 : 0;
    T.spr[n] = q.sprite.id;
    T.sec[n] = secDe(lx, ly, lz);
    stat.quads++;
    return n;
  }

  // Un quad de fluide (positions locales a la cellule en blocs) avec couleur uniforme
  function quadFluide(couche, sprite, pts, uvs, rgbF, f, secteur) {
    const T = tampons[couche];
    T.garantir();
    const n = T.n++;
    const R = Math.min(255, (rgbF[0] * f + 0.5) | 0), G = Math.min(255, (rgbF[1] * f + 0.5) | 0), B = Math.min(255, (rgbF[2] * f + 0.5) | 0);
    for (let k = 0; k < 4; k++) {
      T.pos[n * 12 + k * 3] = pts[k][0]; T.pos[n * 12 + k * 3 + 1] = pts[k][1]; T.pos[n * 12 + k * 3 + 2] = pts[k][2];
      T.uv[n * 8 + k * 2] = uvs[k][0]; T.uv[n * 8 + k * 2 + 1] = uvs[k][1];
      T.col[n * 4 + k] = (255 << 24) | (B << 16) | (G << 8) | R;
    }
    T.flip[n] = 0; T.spr[n] = sprite.id; T.sec[n] = secteur;
    stat.quads++;
  }

  const spriteEauStill = textures.sprite('block/water_still'), spriteEauFlow = textures.sprite('block/water_flow');
  const spriteLaveStill = textures.sprite('block/lava_still'), spriteLaveFlow = textures.sprite('block/lava_flow');
  const FLU_OMBRE = OMBRE_DIR;

  function emettreFluide(i, lx, ly, lz, lave, props, colonne) {
    const lv = +(props.level || 0);
    const dessus = pal[i + OY];
    const dessusEau = lave ? kind[dessus] === 3 : (etats[dessus] && etats[dessus].eau);
    const h = dessusEau || lv >= 8 ? 1 : (lv === 0 ? 14 / 16 : (8 - lv) / 9);
    const X = zone.x0 + lx, Y = zone.y0 + ly, Z = zone.z0 + lz;
    const couche = lave ? 0 : 2;
    const sTop = lave ? spriteLaveStill : spriteEauStill, sSide = lave ? spriteLaveFlow : spriteEauFlow;
    const coul = lave ? [255, 255, 255] : rgb(tab.eau[colonne]);
    const niveauLum = (idx) => (lave ? 15 : lum[idx]);
    const memeFluide = (p) => (lave ? kind[p] === 3 : !!(etats[p] && etats[p].eau));
    const secteur = secDe(lx, ly, lz);
    // haut
    if (!(opaque[dessus]) && !(dessusEau)) {
      const f = FLU_OMBRE[1] * lumiere(niveauLum(i));
      quadFluide(couche, sTop, [[X, Y + h, Z], [X, Y + h, Z + 1], [X + 1, Y + h, Z + 1], [X + 1, Y + h, Z]], [[0, 0], [0, 1], [1, 1], [1, 0]], coul, f, secteur);
    }
    // cotes
    const faces = [[2, OFFDIR[2]], [3, OFFDIR[3]], [4, OFFDIR[4]], [5, OFFDIR[5]]];
    for (const [d, off] of faces) {
      const np = pal[i + off];
      if (opaque[np] || memeFluide(np)) continue;
      const f = FLU_OMBRE[d] * lumiere(niveauLum(i + off));
      let pts;
      if (d === 2) pts = [[X + 1, Y + h, Z], [X + 1, Y, Z], [X, Y, Z], [X, Y + h, Z]];
      else if (d === 3) pts = [[X, Y + h, Z + 1], [X, Y, Z + 1], [X + 1, Y, Z + 1], [X + 1, Y + h, Z + 1]];
      else if (d === 4) pts = [[X, Y + h, Z], [X, Y, Z], [X, Y, Z + 1], [X, Y + h, Z + 1]];
      else pts = [[X + 1, Y + h, Z + 1], [X + 1, Y, Z + 1], [X + 1, Y, Z], [X + 1, Y + h, Z]];
      quadFluide(couche, sSide, pts, [[0, 0], [0, h * 0.5], [0.5, h * 0.5], [0.5, 0]].map((u, k) => [[0, 0], [0, h / 2], [0.5, h / 2], [0.5, 0]][k]), coul, f, secteur);
    }
    // bas
    const dessous = pal[i - OY];
    if (!opaque[dessous] && !memeFluide(dessous)) {
      const f = FLU_OMBRE[0] * lumiere(niveauLum(i - OY));
      quadFluide(couche, sTop, [[X, Y, Z + 1], [X, Y, Z], [X + 1, Y, Z], [X + 1, Y, Z + 1]], [[0, 1], [0, 0], [1, 0], [1, 1]], coul, f, secteur);
    }
  }

  for (let y = 0; y < sy; y++) {
    for (let z = 0; z < sz; z++) {
      const colonne = z * sx + 0;
      let i = caseIdx(0, y, z);
      for (let x = 0; x < sx; x++, i++) {
        const p = pal[i];
        if (p < 2) continue;
        const k = kind[p];
        const e = etats[p];
        if (k === 0 && !e.eau) continue;
        stat.cellules++;
        const col = colonne + x;
        if (k === 2 || k === 3) { emettreFluide(i, x, y, z, k === 3, e.props, col); continue; }
        if (e.eau) emettreFluide(i, x, y, z, false, e.props, col);
        if (k !== 1) continue;
        const geo = e.aleatoire ? modeles.geometrie(e, melangeHash(((x + zone.x0) * 3129871) ^ ((z + zone.z0) * 116129781) ^ (y + zone.y0))) : e.geo;
        let dx = 0, dz = 0;
        if (OFFSET_XZ.test(e.nom)) [dx, dz] = decalageXZ(zone.x0 + x, zone.z0 + z);
        const vertCol = teintesPal[p];
        for (const q of geo) {
          if (q.cull >= 0) {
            const np = pal[i + OFFDIR[q.cull]];
            if (opaque[np]) { stat.cullees++; continue; }
            if (e.memeCulling) {
              const ne = etats[np];
              if (ne && (ne.nom === e.nom || (e.feuilles && ne.feuilles))) { stat.cullees++; continue; }
            }
          }
          emettreQuad(q.couche, null, q, i, x, y, z, dx, 0, dz, col, vertCol);
        }
      }
    }
  }
  void cible; void luminositeBord; void aoBord; void luBord;

  // ---------- assemblage final ----------
  const atlas = textures.construireAtlas();
  const nbSec = nsx * nsy * nsz;
  const couches = tampons.map((T) => assembler(T, textures, atlas, nbSec));
  return {
    atlas, couches: { opaque: couches[0], decoupe: couches[1], melange: couches[2] },
    stats: { ...stat, ms: Date.now() - t0, quadsParCouche: tampons.map((t) => t.n) },
    interne: { pal, lum, PX, PY, PZ, etats, opaque, kind },
  };
}

// Trie les quads par section et fabrique les tableaux finaux.
function assembler(T, textures, atlas, nbSec) {
  const n = T.n;
  const compte = new Int32Array(nbSec + 1);
  for (let i = 0; i < n; i++) compte[T.sec[i] + 1]++;
  for (let s = 0; s < nbSec; s++) compte[s + 1] += compte[s];
  const suivant = compte.slice(0, nbSec);
  const positions = new Float32Array(new SharedArrayBuffer(n * 12 * 4));
  const uvs = new Float32Array(new SharedArrayBuffer(n * 8 * 4));
  const couleurs = new Uint32Array(new SharedArrayBuffer(n * 4 * 4));
  const indices = new Uint32Array(new SharedArrayBuffer(n * 6 * 4));
  const bbox = new Float32Array(nbSec * 6);
  for (let s = 0; s < nbSec; s++) { bbox[s * 6] = bbox[s * 6 + 1] = bbox[s * 6 + 2] = Infinity; bbox[s * 6 + 3] = bbox[s * 6 + 4] = bbox[s * 6 + 5] = -Infinity; }
  const AW = atlas.largeur, AH = atlas.hauteur;
  const eps = 0.02;
  for (let i = 0; i < n; i++) {
    const s = T.sec[i];
    const o = suivant[s]++;
    positions.set(T.pos.subarray(i * 12, i * 12 + 12), o * 12);
    couleurs.set(T.col.subarray(i * 4, i * 4 + 4), o * 4);
    const sp = textures.sprites[T.spr[i]];
    for (let k = 0; k < 4; k++) {
      const u = Math.min(sp.w - eps, Math.max(eps, T.uv[i * 8 + k * 2] * sp.w));
      const v = Math.min(sp.h - eps, Math.max(eps, T.uv[i * 8 + k * 2 + 1] * sp.h));
      uvs[o * 8 + k * 2] = (sp.ax + u) / AW; uvs[o * 8 + k * 2 + 1] = (sp.ay + v) / AH;
    }
    const b = o * 4;
    if (T.flip[i]) indices.set([b + 1, b + 2, b + 3, b + 1, b + 3, b], o * 6);
    else indices.set([b, b + 1, b + 2, b, b + 2, b + 3], o * 6);
    for (let k = 0; k < 4; k++) for (let a = 0; a < 3; a++) {
      const v = T.pos[i * 12 + k * 3 + a];
      if (v < bbox[s * 6 + a]) bbox[s * 6 + a] = v;
      if (v > bbox[s * 6 + 3 + a]) bbox[s * 6 + 3 + a] = v;
    }
  }
  const sections = [];
  for (let s = 0; s < nbSec; s++) {
    if (compte[s + 1] > compte[s]) sections.push({ debut: compte[s] * 6, nb: (compte[s + 1] - compte[s]) * 6, bbox: Array.from(bbox.subarray(s * 6, s * 6 + 6)) });
  }
  return { positions, uvs, couleurs, indices, sections, nbQuads: n };
}

export { COUCHE_OPAQUE, COUCHE_DECOUPE, COUCHE_MELANGE };
