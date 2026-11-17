// Mailleur : zone -> triangles.
// Coordonnees monde. Une face est emise si son voisin ne la cache pas : seul un cube OPAQUE cache une face (ou, pour le verre,
// la glace..., le meme bloc translucide). Les feuilles montrent donc leurs faces entre deux feuilles ("fancy" du jeu : on voit
// les feuilles de derriere par les trous de la texture) ; ces faces INTERNES vont dans une couche a part (4e tampon, dessinee
// apres les faces exposees : le test de profondeur en rejette presque tout, ce qui coute peu).
// Couleur par sommet = ombrage de direction x occlusion ambiante x lumiere du ciel x teinte du biome.
//
// Deux usages :
//  - sans `options.monde` (scenes sans simulation) : UN maillage de toute la zone, une fois, comme toujours (resultat inchange) ;
//  - avec `options.monde` (moteur/monde.js, scenes avec un champ `monde`) : meme maillage de depart, mais les tableaux de blocs et de
//    lumiere (ciel, blocs) sont CEUX DU MONDE, modifies en cours de film ; le resultat porte `mailleSection(sx, sy, sz)` qui refait UNE
//    section de 16x16x16 (les sections voisines dont les faces, l'AO ou la lumiere en dependent sont a refaire par l'appelant :
//    toute cellule changee salit les sections a moins d'une cellule). `options.lightmap` : la lumiere n'est PAS cuite dans la couleur
//    des sommets ; chaque sommet porte ses niveaux (ciel, bloc) et le rasteriseur applique la table de lumiere du jeu a chaque image
//    (rendu/ciel-vanille.js `tableLumiere` : la lumiere chaude des torches, le jour et la nuit, le reglage gamma).
import { melangeHash, NORMALES, AXE_DIR } from './modeles.js';
import { sourcesTeinte } from './teinte.js';
import { COUCHE_OPAQUE, COUCHE_DECOUPE, COUCHE_MELANGE } from './textures.js';

const COUCHE_INTERNE = 3;   // tampon des faces de feuilles cachees par d'autres feuilles (pas une couche de texture)

const OMBRE_DIR = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6]; // bas, haut, nord, sud, ouest, est
const AMBIANT = 0.0; // lumiere ambiante de la dimension (overworld : 0)
// Courbe de luminosite du jeu : v/(4-3v), puis reglage "luminosite" par defaut du jeu (gamma 0,5) :
// b = mix(v, 1-(1-v)^4, gamma). gamma = 0 donne la courbe pure.
export const courbeLumiere = (niveau, gamma = 0.5) => {
  const v = niveau / 15, c = v / (4 - 3 * v), b = c + (1 - c) * AMBIANT;
  return b * (1 - gamma) + gamma * (1 - Math.pow(1 - b, 4));
};

// Tampon de quads qui grandit tout seul. gpu : niveaux (ciel, bloc), teinte, bloc, centre pour l'export OpenGL ; niv : niveaux par sommet (lightmap)
class Tampon {
  constructor(gpu = false, niv = false) {
    this.gpu = gpu; this.niv = niv;
    if (gpu) { this.lvl = new Float32Array(4096 * 4); this.blv = new Float32Array(4096 * 4); this.tint = new Uint8Array(4096 * 3); this.blk = new Uint16Array(4096); this.ctr = new Float32Array(4096 * 3); }
    if (niv) this.nv = new Uint8Array(4096 * 8);
    this.n = 0; this.cap = 4096; this.pos = new Float32Array(this.cap * 12); this.uv = new Float32Array(this.cap * 8); this.col = new Uint32Array(this.cap * 4); this.spr = new Int32Array(this.cap); this.sec = new Int32Array(this.cap); this.flip = new Uint8Array(this.cap); this.aob = new Uint8Array(this.cap * 4); this.eti = new Uint8Array(this.cap * 4);
  }
  garantir() {
    if (this.n < this.cap) return;
    const c = this.cap * 2;
    const g = (a, k) => { const b = new a.constructor(c * k); b.set(a); return b; };
    this.pos = g(this.pos, 12); this.uv = g(this.uv, 8); this.col = g(this.col, 4); this.spr = g(this.spr, 1); this.sec = g(this.sec, 1); this.flip = g(this.flip, 1); this.aob = g(this.aob, 4); this.eti = g(this.eti, 4);
    if (this.gpu) { this.lvl = g(this.lvl, 4); this.blv = g(this.blv, 4); this.tint = g(this.tint, 3); this.blk = g(this.blk, 1); this.ctr = g(this.ctr, 3); }
    if (this.niv) this.nv = g(this.nv, 8);
    this.cap = c;
  }
}

const OFFSET_XZ = /^(short_grass|fern|tall_grass|large_fern|dandelion|poppy|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony|dead_bush|seagrass|tall_seagrass|hanging_roots|bamboo|torchflower|pointed_dripstone)$/;
const NON_COLLISION = /(grass|fern|dandelion|poppy|orchid|allium|bluet|tulip|daisy|cornflower|lily_of|lily_pad|rose|peony|lilac|sunflower|bush|mushroom|sapling|vine|torch|lichen|carpet|^snow$|leaf_litter|petals|wildflowers|rail|_sign|button|pressure_plate|tripwire|^string$|^fire$|seagrass|kelp|cobweb|dripleaf|roots|sprout|fungus|^wheat$|carrots|potatoes|beetroots|_stem|sugar_cane|dead_bush|berries|berry|firefly|bubble|^ladder$|^lever$|banner|^water$|^lava$|torchflower|eyeblossom|flower$|^moss_carpet$|frogspawn|pitcher_crop|^light$|^barrier$)/;
void NON_COLLISION;

// Etiquette par sommet (pour les options du shader, voir src/shader) : bits 0-2 = genre (0 rien, 1 surface d'eau, 2 feuilles, 3 plante),
// bits 3-7 = poids du balancement pour une plante (0 au pied, 31 en haut). Sans shader elles ne servent a rien.
export const ETI_EAU = 1, ETI_FEUILLES = 2, ETI_PLANTE = 3;
const PLANTES = /^(short_grass|fern|tall_grass|large_fern|dandelion|poppy|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony|dead_bush|torchflower|wheat|carrots|potatoes|beetroots|sweet_berry_bush|pink_petals|wildflowers|short_dry_grass|tall_dry_grass|bush)$/;

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

// Construit le maillage. options : { rayonMelange, aoActif, tailleSection, gamma, exportGPU, monde, lightmap }
export function mailler({ zone, modeles, textures, couleurs, options = {} }) {
  const gamma = options.gamma ?? 0.5;
  const courbe = new Float32Array(16).map((_, l) => courbeLumiere(l, gamma));
  const lumiere = (l) => { const i = l | 0, f = l - i; return i >= 15 ? courbe[15] : courbe[i] + (courbe[i + 1] - courbe[i]) * f; };
  const t0 = Date.now();
  const monde = options.monde || null;
  const lightmap = !!(monde && options.lightmap);
  const G = monde || zone;               // geometrie : la boite du monde (qui peut avoir grandi) ou celle de la zone
  const X0 = G.x0, Y0 = G.y0, Z0 = G.z0;
  const { sx, sy, sz } = G;
  const PX = sx + 2, PY = sy + 2, PZ = sz + 2;
  const OY = PX * PZ, OZ = PX, OX = 1;
  const caseIdx = (x, y, z) => ((y + 1) * PZ + (z + 1)) * PX + (x + 1);
  let pal;
  if (monde) pal = monde.pal;           // les tableaux du monde, lus sur place
  else {
    pal = new Uint16Array(PX * PY * PZ);
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
  }
  // etats par entree de palette (la palette du monde s'allonge : `majPalette` complete les tables)
  const palette = monde ? monde.palette : zone.palette;
  const CAP = monde ? 65536 : palette.length;
  const etats = new Array(CAP);
  const opaque = new Uint8Array(CAP), perm = new Uint8Array(CAP), opac = new Uint8Array(CAP), kind = new Uint8Array(CAP);
  const aoSh = new Float32Array(CAP).fill(1);
  const genre = new Uint8Array(CAP);
  const fluFam = new Uint8Array(CAP), fluQte = new Uint8Array(CAP);   // fluide de l'entree : famille (1 eau, 2 lave) et quantite (8 source ou chute, 1..7 coulant), comme FluidState
  const teintesPal = new Array(CAP);
  let NP = 0;
  function preparerEntree(i) {
    if (i === 1) { opaque[1] = 1; perm[1] = 0; opac[1] = 15; aoSh[1] = 0.2; return; }
    const e = modeles.etat(palette[i]);
    etats[i] = e;
    // variantes au hasard (feu : fire_floor0 / fire_floor1, herbes...) : TOUTES les textures doivent etre connues avant l'atlas, sinon une variante tiree
    // plus tard (section refaite) aurait des uv NaN (sprite sans place dans l'atlas) et un carre de texture au hasard
    if (e.aleatoire) for (const l of e.emplacements) for (const v of l) if (v && v.model) modeles.quadsModele(v.model, v.x || 0, v.y || 0, !!v.uvlock);
    kind[i] = e.type;
    if (e.type === 2 || e.type === 3 || e.eau) {
      fluFam[i] = e.type === 3 ? 2 : 1;
      const lv = e.type === 2 || e.type === 3 ? +(e.props.level || 0) : 0;
      fluQte[i] = lv === 0 || lv >= 8 ? 8 : 8 - lv;
    }
    opaque[i] = e.opaque ? 1 : 0; perm[i] = e.opaque ? 0 : 1; opac[i] = e.opaciteLumiere;
    aoSh[i] = e.aoSolide ? 0.2 : 1;
    if (e.type === 1 && e.geo.length === 0 && !e.aleatoire) kind[i] = 0;
    if (i >= 2) {
      if (e.type === 1) genre[i] = e.feuilles ? ETI_FEUILLES : PLANTES.test(e.nom) ? ETI_PLANTE : 0;
      teintesPal[i] = e.type === 1 ? sourcesTeinte(e.nom, e.props) : null;
    }
  }
  const majPalette = () => { for (; NP < palette.length; NP++) preparerEntree(NP); };
  majPalette();
  let etiCourant = 0, etiHalf = 0;   // genre du bloc en cours et moitie (0 normal, 1 bas d'une grande plante, 2 haut)

  // ---------- lumiere du ciel (et des blocs) ----------
  let lum, blk = null;
  if (monde) { lum = monde.ciel; blk = monde.bloc; }   // tenues a jour par moteur/lumiere.js
  else {
    lum = new Uint8Array(PX * PY * PZ);
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
  }

  // ---------- teintes par colonne (colonnes de la zone d'origine ; hors de la zone : la colonne la plus proche) ----------
  const tab = couleurs.tableaux(zone, options.rayonMelange ?? 2);
  const colDe = monde
    ? (x, z) => Math.min(zone.sz - 1, Math.max(0, z + Z0 - zone.z0)) * zone.sx + Math.min(zone.sx - 1, Math.max(0, x + X0 - zone.x0))
    : (x, z) => z * sx + x;

  // ---------- emission ----------
  const gpu = !!options.exportGPU;
  let tampons;
  const nouveauxTampons = () => [new Tampon(gpu, lightmap), new Tampon(gpu, lightmap), new Tampon(gpu, lightmap), new Tampon(gpu, lightmap)];   // opaque, decoupe, melange, decoupe interne
  tampons = nouveauxTampons();
  const TS = options.tailleSection ?? 16;
  const nsx = Math.ceil(sx / TS), nsy = Math.ceil(sy / TS), nsz = Math.ceil(sz / TS);
  let secDe = (x, y, z) => ((y / TS | 0) * nsz + (z / TS | 0)) * nsx + (x / TS | 0);
  const stat = { quads: 0, cellules: 0, cullees: 0 };
  const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  // numero de section ABSOLU (ancre = origine de la zone) pour reperer une section meme apres un agrandissement de la boite
  const A = monde ? monde.ancre : null;
  const cleAbs = (a, b, c) => ((b + 64) * 4096 + (c + 2048)) * 4096 + (a + 2048);
  const cleDe = monde ? (s) => {
    const a = s % nsx, c = Math.floor(s / nsx) % nsz, b = Math.floor(s / (nsx * nsz));
    return cleAbs(a + (X0 - A[0]) / TS, b + (Y0 - A[1]) / TS, c + (Z0 - A[2]) / TS);
  } : null;

  // axes tangents par direction : [decalage t1, decalage t2, axe t1, axe t2]
  const TAN = [[OX, OZ, 0, 2], [OX, OZ, 0, 2], [OX, OY, 0, 1], [OX, OY, 0, 1], [OZ, OY, 2, 1], [OZ, OY, 2, 1]];
  const OFFDIR = [-OY, OY, -OZ, OZ, -OX, OX];

  const br = new Float32Array(4);
  const lv = new Float32Array(4);   // niveau de lumiere du ciel 0..15 aux 4 coins
  const bv = new Float32Array(4);   // niveau de lumiere de bloc 0..15 aux 4 coins
  const fl = new Float32Array(4);   // luminosite combinee (choix de la diagonale)
  const aoc = new Float32Array(4);

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
    let Bc = 0;
    if (lightmap) { Bc = blk[base]; if (opac[pc] >= 15) Bc = blk[i]; }
    const flat = !q.ao || options.aoActif === false;
    const emis = q.emission || kind[pal[i]] === 3;
    if (flat) {
      if (lightmap) {
        const lc = emis ? 15 : Lc, bc = emis ? 15 : Bc;
        br[0] = br[1] = br[2] = br[3] = 1;
        lv[0] = lv[1] = lv[2] = lv[3] = lc; bv[0] = bv[1] = bv[2] = bv[3] = bc;
        fl[0] = fl[1] = fl[2] = fl[3] = lumiere(Math.max(lc, bc));
      } else {
        const brt = lumiere(emis ? 15 : Lc);
        br[0] = br[1] = br[2] = br[3] = brt;
        lv[0] = lv[1] = lv[2] = lv[3] = emis ? 15 : Lc;
        bv[0] = bv[1] = bv[2] = bv[3] = emis ? 15 : 0;
      }
      aoc[0] = aoc[1] = aoc[2] = aoc[3] = 1;
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
        const l = emis ? 15 : (la + lb + lk + Lc) * 0.25;
        if (lightmap) {
          const ba = opac[pa] >= 15 ? Bc : blk[base + oa];
          const bb = opac[pb] >= 15 ? Bc : blk[base + ob];
          const bk = opac[pk] >= 15 ? Bc : blk[nk];
          const lbk = emis ? 15 : (ba + bb + bk + Bc) * 0.25;
          br[c] = ao; aoc[c] = ao; lv[c] = l; bv[c] = lbk; fl[c] = ao * lumiere(Math.max(l, lbk));
        } else { br[c] = ao * lumiere(l); aoc[c] = ao; lv[c] = l; bv[c] = emis ? 15 : 0; }
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
    if (gpu) { T.tint[n * 3] = r; T.tint[n * 3 + 1] = g; T.tint[n * 3 + 2] = bl; T.blk[n] = pal[i]; T.ctr[n * 3] = X0 + lx + 0.5; T.ctr[n * 3 + 1] = Y0 + ly + 0.5; T.ctr[n * 3 + 2] = Z0 + lz + 0.5; }
    const vb = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const p = q.p[k];
      T.pos[po + k * 3] = X0 + lx + p[0] + dx;
      T.pos[po + k * 3 + 1] = Y0 + ly + p[1] + dy;
      T.pos[po + k * 3 + 2] = Z0 + lz + p[2] + dz;
      T.uv[uo + k * 2] = q.uv[k][0]; T.uv[uo + k * 2 + 1] = q.uv[k][1];
      // poids bilineaire du sommet dans le carre (coordonnees dans la cellule)
      const w1 = Math.min(1, Math.max(0, p[ax1])), w2 = Math.min(1, Math.max(0, p[ax2]));
      const bil = (t) => (1 - w1) * (1 - w2) * t[0] + w1 * (1 - w2) * t[1] + (1 - w1) * w2 * t[2] + w1 * w2 * t[3];
      const v = bil(lightmap ? fl : br);
      vb[k] = v;
      if (gpu) { T.lvl[n * 4 + k] = bil(lv); T.blv[n * 4 + k] = bil(bv); }
      if (lightmap) { T.nv[n * 8 + k * 2] = Math.round(bil(lv) * 17); T.nv[n * 8 + k * 2 + 1] = Math.round(bil(bv) * 17); }
      T.aob[n * 4 + k] = Math.min(255, Math.round(bil(aoc) * 255));
      T.eti[n * 4 + k] = etiCourant === ETI_PLANTE ? ETI_PLANTE | (Math.min(31, Math.round(31 * Math.min(1, Math.max(0, (p[1] + (etiHalf === 2 ? 1 : 0)) / (etiHalf ? 2 : 1))))) << 3) : etiCourant;
      const f = (lightmap ? bil(br) : v) * ombre;
      const R = Math.min(255, (r * f + 0.5) | 0), G2 = Math.min(255, (g * f + 0.5) | 0), B = Math.min(255, (bl * f + 0.5) | 0);
      T.col[co + k] = (255 << 24) | (B << 16) | (G2 << 8) | R;
    }
    T.flip[n] = vb[1] + vb[3] > vb[0] + vb[2] ? 1 : 0;
    T.spr[n] = q.sprite.id;
    T.sec[n] = secDe(lx, ly, lz);
    stat.quads++;
    return n;
  }

  // Un quad de fluide (positions locales a la cellule en blocs) avec couleur uniforme
  function quadFluide(couche, sprite, pts, uvs, rgbF, f, secteur, tag = 0, niveau = 15, bloc = 0, niveauBloc = 0) {
    const T = tampons[couche];
    T.garantir();
    const n = T.n++;
    const R = Math.min(255, (rgbF[0] * f + 0.5) | 0), G2 = Math.min(255, (rgbF[1] * f + 0.5) | 0), B = Math.min(255, (rgbF[2] * f + 0.5) | 0);
    for (let k = 0; k < 4; k++) {
      T.pos[n * 12 + k * 3] = pts[k][0]; T.pos[n * 12 + k * 3 + 1] = pts[k][1]; T.pos[n * 12 + k * 3 + 2] = pts[k][2];
      T.uv[n * 8 + k * 2] = uvs[k][0]; T.uv[n * 8 + k * 2 + 1] = uvs[k][1];
      T.col[n * 4 + k] = (255 << 24) | (B << 16) | (G2 << 8) | R;
    }
    T.flip[n] = 0; T.spr[n] = sprite.id; T.sec[n] = secteur;
    if (gpu) { for (let k = 0; k < 4; k++) { T.lvl[n * 4 + k] = niveau; T.blv[n * 4 + k] = niveauBloc; } T.tint[n * 3] = rgbF[0]; T.tint[n * 3 + 1] = rgbF[1]; T.tint[n * 3 + 2] = rgbF[2]; T.blk[n] = bloc; T.ctr[n * 3] = pts[0][0]; T.ctr[n * 3 + 1] = pts[0][1]; T.ctr[n * 3 + 2] = pts[0][2]; }
    if (lightmap) for (let k = 0; k < 4; k++) { T.nv[n * 8 + k * 2] = Math.round(niveau * 17); T.nv[n * 8 + k * 2 + 1] = Math.round(niveauBloc * 17); }
    for (let k = 0; k < 4; k++) { T.aob[n * 4 + k] = 255; T.eti[n * 4 + k] = tag; }
    stat.quads++;
  }

  const spriteEauStill = textures.sprite('block/water_still'), spriteEauFlow = textures.sprite('block/water_flow');
  const spriteLaveStill = textures.sprite('block/lava_still'), spriteLaveFlow = textures.sprite('block/lava_flow');
  const FLU_OMBRE = OMBRE_DIR;

  // Hauteur d'une cellule pour un fluide de famille `fam` (FluidRenderer.getHeight) : 1 si le meme fluide est au-dessus, sinon quantite / 9 ;
  // une cellule sans ce fluide : 0, ou -1 si c'est un bloc solide (il ne compte pas dans la moyenne des coins)
  const hauteurFluide = (p, dessusP, fam) => (fluFam[p] === fam ? (fluFam[dessusP] === fam ? 1 : fluQte[p] / 9) : (opaque[p] ? -1 : 0));
  const poids = (acc, h) => { if (h >= 0.8) { acc[0] += h * 10; acc[1] += 10; } else if (h >= 0) { acc[0] += h; acc[1] += 1; } };
  // FluidRenderer.calculateAverageHeight : moyenne ponderee du coin (cellule, deux voisins de l'arete, voisin en diagonale)
  function hauteurCoin(h, h1, h2, diag) {
    if (h2 >= 1 || h1 >= 1) return 1;
    const acc = [0, 0];
    if (h2 > 0 || h1 > 0) { const f = diag(); if (f >= 1) return 1; poids(acc, f); }
    poids(acc, h); poids(acc, h2); poids(acc, h1);
    return acc[1] ? acc[0] / acc[1] : h;
  }
  // FlowingFluid.getFlow : direction du courant (x, z) normalisee, ou null (eau calme)
  function courant(i, fam) {
    const OFF = [[OFFDIR[2], 0, -1], [OFFDIR[3], 0, 1], [OFFDIR[4], -1, 0], [OFFDIR[5], 1, 0]];   // nord, sud, ouest, est : [decalage, dx, dz]
    const propre = (p) => (fluFam[p] === fam ? fluQte[p] / 9 : 0);
    const touche = (p) => fluFam[p] === 0 || fluFam[p] === fam;
    const mien = propre(pal[i]);
    let x = 0, z = 0;
    for (const [off, dx, dz] of OFF) {
      const p = pal[i + off];
      if (!touche(p)) continue;
      let h = propre(p), f = 0;
      if (h === 0) {
        if (!opaque[p]) {
          const pb = pal[i + off - OY];
          if (touche(pb)) { h = propre(pb); if (h > 0) f = mien - (h - 0.8888889); }
        }
      } else f = mien - h;
      if (f !== 0) { x += dx * f; z += dz * f; }
    }
    const n = Math.hypot(x, z);
    return n > 1e-9 ? [x / n, z / n] : null;
  }

  function emettreFluide(i, lx, ly, lz, lave, props, colonne) {
    const fam = lave ? 2 : 1;
    const p0 = pal[i], dessus = pal[i + OY];
    const dessusEau = fluFam[dessus] === fam;
    const X = X0 + lx, Y = Y0 + ly, Z = Z0 + lz;
    const couche = lave ? 0 : 2;
    const sTop = lave ? spriteLaveStill : spriteEauStill, sFlow = lave ? spriteLaveFlow : spriteEauFlow;
    const coul = lave ? [255, 255, 255] : rgb(tab.eau[colonne]);
    const niveauLum = (idx) => (lave ? 15 : lum[idx]);
    const niveauBlk = (idx) => (lave ? 15 : (lightmap ? blk[idx] : 0));
    const lumF = (idx) => (lightmap ? 1 : lumiere(niveauLum(idx)));
    const memeFluide = (p) => fluFam[p] === fam;
    const secteur = secDe(lx, ly, lz);
    // hauteurs : de la cellule, des quatre voisins, puis des quatre coins (moyenne des cellules qui les touchent)
    const h = hauteurFluide(p0, dessus, fam);
    const H = (off) => hauteurFluide(pal[i + off], pal[i + off + OY], fam);
    let hNW, hNE, hSW, hSE;
    if (h >= 1) hNW = hNE = hSW = hSE = 1;
    else {
      const hN = H(OFFDIR[2]), hS = H(OFFDIR[3]), hW = H(OFFDIR[4]), hE = H(OFFDIR[5]);
      hNW = hauteurCoin(h, hN, hW, () => H(OFFDIR[2] + OFFDIR[4]));
      hNE = hauteurCoin(h, hN, hE, () => H(OFFDIR[2] + OFFDIR[5]));
      hSW = hauteurCoin(h, hS, hW, () => H(OFFDIR[3] + OFFDIR[4]));
      hSE = hauteurCoin(h, hS, hE, () => H(OFFDIR[3] + OFFDIR[5]));
    }
    // haut : texture "coule" avec la direction du courant, "calme" sinon (uv comme FluidRenderer)
    if (!opaque[dessus] && !dessusEau) {
      const f = FLU_OMBRE[1] * lumF(i);
      const fl = h < 1 ? courant(i, fam) : null;
      let sp = sTop, uv = [[0, 0], [0, 1], [1, 1], [1, 0]];
      if (fl) {
        sp = sFlow;
        const ang = Math.atan2(fl[1], fl[0]) - Math.PI / 2, sn = Math.sin(ang) * 0.25, cs = Math.cos(ang) * 0.25;
        uv = [[0.5 + (-cs - sn), 0.5 + (-cs + sn)], [0.5 + (-cs + sn), 0.5 + (cs + sn)], [0.5 + (cs + sn), 0.5 + (cs - sn)], [0.5 + (cs - sn), 0.5 + (-cs - sn)]];
      }
      const dessusPts = [[X, Y + hNW, Z], [X, Y + hSW, Z + 1], [X + 1, Y + hSE, Z + 1], [X + 1, Y + hNE, Z]];
      quadFluide(couche, sp, dessusPts, uv, coul, f, secteur, lave ? 0 : ETI_EAU, niveauLum(i), p0, niveauBlk(i));
      // FluidRenderer dessine aussi le dessous de la surface de l'EAU (vue d'en dessous) : meme quad, sommets dans l'ordre inverse
      if (!lave) quadFluide(couche, sp, [dessusPts[0], dessusPts[3], dessusPts[2], dessusPts[1]], [uv[0], uv[3], uv[2], uv[1]], coul, f, secteur, ETI_EAU, niveauLum(i), p0, niveauBlk(i));
    }
    // cotes : seulement la ou le voisin n'est ni opaque ni le meme fluide ; le bord haut suit les hauteurs des deux coins
    const v = (hh) => (1 - hh) * 0.5;
    const cotes = [
      [2, [[X + 1, Y + hNE, Z], [X + 1, Y, Z], [X, Y, Z], [X, Y + hNW, Z]], hNE, hNW],
      [3, [[X, Y + hSW, Z + 1], [X, Y, Z + 1], [X + 1, Y, Z + 1], [X + 1, Y + hSE, Z + 1]], hSW, hSE],
      [4, [[X, Y + hNW, Z], [X, Y, Z], [X, Y, Z + 1], [X, Y + hSW, Z + 1]], hNW, hSW],
      [5, [[X + 1, Y + hSE, Z + 1], [X + 1, Y, Z + 1], [X + 1, Y, Z], [X + 1, Y + hNE, Z]], hSE, hNE],
    ];
    for (const [d, pts, ha, hb] of cotes) {
      const off = OFFDIR[d], np = pal[i + off];
      if (opaque[np] || memeFluide(np)) continue;
      const f = FLU_OMBRE[d] * lumF(i + off);
      quadFluide(couche, sFlow, pts, [[0, v(ha)], [0, 0.5], [0.5, 0.5], [0.5, v(hb)]], coul, f, secteur, 0, niveauLum(i + off), p0, niveauBlk(i + off));
    }
    // bas
    const dessous = pal[i - OY];
    if (!opaque[dessous] && !memeFluide(dessous)) {
      const f = FLU_OMBRE[0] * lumF(i - OY);
      quadFluide(couche, sTop, [[X, Y, Z + 1], [X, Y, Z], [X + 1, Y, Z], [X + 1, Y, Z + 1]], [[0, 1], [0, 0], [1, 0], [1, 1]], coul, f, secteur, 0, niveauLum(i - OY), p0, niveauBlk(i - OY));
    }
    void props;
  }

  // Emet les quads des cellules locales [xa, xb[ x [ya, yb[ x [za, zb[
  function emettreCellules(xa, xb, ya, yb, za, zb) {
    for (let y = ya; y < yb; y++) {
      for (let z = za; z < zb; z++) {
        let i = caseIdx(xa, y, z);
        for (let x = xa; x < xb; x++, i++) {
          const p = pal[i];
          if (p < 2) continue;
          const k = kind[p];
          const e = etats[p];
          if (k === 0 && !e.eau) continue;
          stat.cellules++;
          const col = colDe(x, z);
          if (k === 2 || k === 3) { emettreFluide(i, x, y, z, k === 3, e.props, col); continue; }
          if (e.eau) emettreFluide(i, x, y, z, false, e.props, col);
          if (k !== 1) continue;
          const geo = e.aleatoire ? modeles.geometrie(e, melangeHash(((x + X0) * 3129871) ^ ((z + Z0) * 116129781) ^ (y + Y0))) : e.geo;
          let dx = 0, dz = 0;
          if (OFFSET_XZ.test(e.nom)) [dx, dz] = decalageXZ(X0 + x, Z0 + z);
          const vertCol = teintesPal[p];
          etiCourant = genre[p]; etiHalf = etiCourant === ETI_PLANTE ? (e.props && e.props.half === 'lower' ? 1 : e.props && e.props.half === 'upper' ? 2 : 0) : 0;
          for (const q of geo) {
            if (q.cull >= 0) {
              const np = pal[i + OFFDIR[q.cull]];
              if (opaque[np]) { stat.cullees++; continue; }
              if (e.memeCulling) {
                const ne = etats[np];
                if (ne && ne.nom === e.nom) { stat.cullees++; continue; }
              }
            }
            let couche = q.couche;
            if (e.feuilles && couche === COUCHE_DECOUPE && q.cull >= 0) {
              const ne = etats[pal[i + OFFDIR[q.cull]]];
              if (ne && ne.type === 1 && (ne.feuilles || ne.aoSolide)) couche = COUCHE_INTERNE;   // voisin = feuilles ou cube plein (cutout) : face interne
            }
            emettreQuad(couche, null, q, i, x, y, z, dx, 0, dz, col, vertCol);
          }
        }
      }
    }
  }
  emettreCellules(0, sx, 0, sy, 0, sz);

  // ---------- assemblage final ----------
  const atlas = textures.construireAtlas();
  const nbSec = nsx * nsy * nsz;
  const couches = tampons.map((T) => assembler(T, textures, atlas, nbSec, cleDe));
  const resultat = {
    atlas, couches: { opaque: couches[0], decoupe: couches[1], melange: couches[2], interne: couches[3] },
    stats: { ...stat, ms: Date.now() - t0, quadsParCouche: tampons.map((t) => t.n) },
    interne: { pal, lum, blk, PX, PY, PZ, etats, opaque, kind, x0: X0, y0: Y0, z0: Z0 },
    lightmap,
  };

  // Section ABSOLUE (a, b, c : numeros de section de 16 cellules depuis l'ancre du monde) -> { opaque, decoupe, melange, interne }
  // (chacun : tableaux du mailleur avec UNE section, ou null s'il est vide) ; rend null si la section est hors de la boite.
  if (monde) {
    resultat.mailleSection = (a, b, c) => {
      majPalette();
      const lx0 = a * TS + A[0] - X0, ly0 = b * TS + A[1] - Y0, lz0 = c * TS + A[2] - Z0;
      const xa = Math.max(0, lx0), xb = Math.min(sx, lx0 + TS), ya = Math.max(0, ly0), yb = Math.min(sy, ly0 + TS), za = Math.max(0, lz0), zb = Math.min(sz, lz0 + TS);
      if (xa >= xb || ya >= yb || za >= zb) return null;
      const sauveT = tampons, sauveS = secDe;
      tampons = nouveauxTampons(); secDe = () => 0;
      try {
        emettreCellules(xa, xb, ya, yb, za, zb);
        const cs = tampons.map((T) => (T.n ? assembler(T, textures, atlas, 1, () => cleAbs(a, b, c)) : null));
        return { opaque: cs[0], decoupe: cs[1], melange: cs[2], interne: cs[3] };
      } finally { tampons = sauveT; secDe = sauveS; }
    };
    resultat.majPalette = majPalette;
    resultat.cleAbs = cleAbs;
    resultat.sectionDe = (x, y, z) => [Math.floor((x - A[0]) / TS), Math.floor((y - A[1]) / TS), Math.floor((z - A[2]) / TS)];
  }
  return resultat;
}

// Trie les quads par section et fabrique les tableaux finaux.
function assembler(T, textures, atlas, nbSec, cleDe = null) {
  const n = T.n;
  const compte = new Int32Array(nbSec + 1);
  for (let i = 0; i < n; i++) compte[T.sec[i] + 1]++;
  for (let s = 0; s < nbSec; s++) compte[s + 1] += compte[s];
  const suivant = compte.slice(0, nbSec);
  const positions = new Float32Array(new SharedArrayBuffer(n * 12 * 4));
  const uvs = new Float32Array(new SharedArrayBuffer(n * 8 * 4));
  const couleurs = new Uint32Array(new SharedArrayBuffer(n * 4 * 4));
  const indices = new Uint32Array(new SharedArrayBuffer(n * 6 * 4));
  const ao = new Uint8Array(new SharedArrayBuffer(Math.max(1, n * 4))), etiq = new Uint8Array(new SharedArrayBuffer(Math.max(1, n * 4)));
  const niv = T.niv ? new Uint8Array(new SharedArrayBuffer(Math.max(1, n * 8))) : null;
  const bbox = new Float32Array(nbSec * 6);
  for (let s = 0; s < nbSec; s++) { bbox[s * 6] = bbox[s * 6 + 1] = bbox[s * 6 + 2] = Infinity; bbox[s * 6 + 3] = bbox[s * 6 + 4] = bbox[s * 6 + 5] = -Infinity; }
  const AW = atlas.largeur, AH = atlas.hauteur;
  const eps = 0.02;
  const mid = T.gpu ? new Float32Array(n * 2) : null;
  for (let i = 0; i < n; i++) {
    const s = T.sec[i];
    const o = suivant[s]++;
    positions.set(T.pos.subarray(i * 12, i * 12 + 12), o * 12);
    couleurs.set(T.col.subarray(i * 4, i * 4 + 4), o * 4);
    ao.set(T.aob.subarray(i * 4, i * 4 + 4), o * 4); etiq.set(T.eti.subarray(i * 4, i * 4 + 4), o * 4);
    if (niv) niv.set(T.nv.subarray(i * 8, i * 8 + 8), o * 8);
    const sp = textures.sprites[T.spr[i]];
    if (mid) { mid[o * 2] = (sp.ax + sp.w / 2) / AW; mid[o * 2 + 1] = (sp.ay + sp.h / 2) / AH; }
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
    if (compte[s + 1] > compte[s]) sections.push({ debut: compte[s] * 6, nb: (compte[s + 1] - compte[s]) * 6, bbox: Array.from(bbox.subarray(s * 6, s * 6 + 6)), ...(cleDe ? { cle: cleDe(s) } : {}) });
  }
  let gpu = null;
  if (T.gpu) {
    const lvl = new Float32Array(n * 4), blv = new Float32Array(n * 4), tint = new Uint8Array(n * 3), blk = new Uint16Array(n), ctr = new Float32Array(n * 3);
    const suivant2 = compte.slice(0, nbSec);
    for (let i = 0; i < n; i++) {
      const o = suivant2[T.sec[i]]++;
      lvl.set(T.lvl.subarray(i * 4, i * 4 + 4), o * 4); blv.set(T.blv.subarray(i * 4, i * 4 + 4), o * 4); tint.set(T.tint.subarray(i * 3, i * 3 + 3), o * 3); blk[o] = T.blk[i]; ctr.set(T.ctr.subarray(i * 3, i * 3 + 3), o * 3);
    }
    gpu = { lvl, blv, tint, blk, ctr, mid };
  }
  return { positions, uvs, couleurs, indices, sections, nbQuads: n, ao, etiq, niv, gpu };
}

export { COUCHE_OPAQUE, COUCHE_DECOUPE, COUCHE_MELANGE, COUCHE_INTERNE };
