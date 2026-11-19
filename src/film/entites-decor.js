// Entites et blocs a contenu des constructions importees (decor/entites-import.js -> scene._entitesDecor), dessines comme le jeu :
//   - creature dans la cage d'un geniteur (SpawnerRenderer : translate(0,5 ; 0,4 ; 0,5), tourne de spin x 10 degres, spin += 1000 / (20 + 200)
//     par tick, recule de 0,2, penche de -30 degres, echelle 0,53125 / max(largeur, hauteur) si > 1) ; meme chose pour un geniteur d'epreuve ;
//   - statue de golem de cuivre (bloc copper_golem_statue : modeles copper_golem, _sitting, _running, _star de la table des creatures, texture
//     selon l'oxydation, tournee selon `facing`) ;
//   - objets poses : sur un feu de camp (CampfireRenderer : 4 cases, (0,5 ; 0,4492 ; 0,5), a plat, decales de 0,3125, echelle 0,375) et dans un
//     coffre-fort (objet montre qui tourne) ;
//   - tableaux (PaintingRenderer : image du tableau devant, dos et tranches en painting/back, epaisseur 1/16 ; Painting.calculateBoundingBox :
//     centre a 0,46875 du mur, decale d'un demi-bloc pour une largeur ou une hauteur paire) ;
//   - noeuds de laisse (LeashKnotModel : boite 6 x 8 x 6, de y + 0,375 a y + 0,875) ; coussins (cushion#main : boite 16 x 4 x 16).
// Tailles des tableaux : data/minecraft/painting_variant du jeu 26.3 (relevees ; essai : test/decor-entites.test.js les compare au jeu si present).
import { Creature, aplatir, mul, T, S, RX, RY } from '../creatures/rendu.js';
import { etatInitial } from '../creatures/anim.js';

const RAD = Math.PI / 180;
export const PEINTURES = { alban: [1, 1], aztec: [1, 1], aztec2: [1, 1], backyard: [3, 4], baroque: [2, 2], bomb: [1, 1], bouquet: [3, 3], burning_skull: [4, 4], bust: [2, 2], cavebird: [3, 3], changing: [4, 2], cotan: [3, 3], courbet: [2, 1], creebet: [2, 1], dennis: [3, 3], donkey_kong: [4, 3], earth: [2, 2], endboss: [3, 3], fern: [3, 3], fighters: [4, 2], finding: [4, 2], fire: [2, 2], graham: [1, 2], humble: [2, 2], kebab: [1, 1], lowmist: [4, 2], match: [2, 2], meditative: [1, 1], orb: [4, 4], owlemons: [3, 3], passage: [4, 2], pigscene: [4, 4], plant: [1, 1], pointer: [4, 4], pond: [3, 4], pool: [2, 1], prairie_ride: [1, 2], sea: [2, 1], skeleton: [4, 3], skull_and_roses: [2, 2], stage: [2, 2], sunflowers: [3, 3], sunset: [2, 1], tides: [3, 3], unpacked: [4, 4], void: [2, 2], wanderer: [1, 2], wasteland: [1, 1], water: [2, 2], wind: [2, 2], wither: [2, 2] };
const VEC = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };
const CCW = { north: 'west', west: 'south', south: 'east', east: 'north' };
const VERS_Y = { south: 0, west: 90, north: 180, east: 270 };
const OMBRE = { haut: 1.0, bas: 0.5, nord: 0.8, sud: 0.8, ouest: 0.6, est: 0.6 };
const RE_STATUE = /^minecraft:(?:waxed_)?(?:(exposed|weathered|oxidized)_)?copper_golem_statue(\[|$)/;
const props = (s) => Object.fromEntries((/\[(.*)\]/.exec(s)?.[1] ?? '').split(',').filter(Boolean).map((kv) => kv.split('=')));

// boite (pixels, y en haut, avant = +z) -> faces avec depliage du jeu (u, v)
function faces(b, u, v, TW, TH) {
  const [x0, y0, z0, x1, y1, z1] = b, w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const F = (nom, coins, a, c, e, f) => ({ nom, coins, uv: [[a, c], [e, c], [e, f], [a, f]].map(([s, t]) => [s / TW, t / TH]) });
  return [
    F('sud', [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]], u + d, v + d, u + d + w, v + d + h),
    F('nord', [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]], u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h),
    F('ouest', [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]], u, v + d, u + d, v + d + h),
    F('est', [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]], u + d + w, v + d, u + 2 * d + w, v + d + h),
    F('haut', [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], u + d, v, u + d + w, v + d),
    F('bas', [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], u + d + w, v, u + d + 2 * w, v + d),
  ];
}
function maillage(fs, vm, L, texture, bloc, ombre = true) {
  const pos = [], uv = [], col = [], idx = [];
  for (const F of fs) {
    const b = pos.length / 3;
    for (let k = 0; k < 4; k++) { pos.push(...vm(F.coins[k])); uv.push(F.uv[k][0], F.uv[k][1]); const o = (ombre ? OMBRE[F.nom] ?? 1 : 1) * L; col.push(o, o, o); }
    idx.push(b, b + 3, b + 2, b, b + 2, b + 1);
  }
  return { positions: Float32Array.from(pos), uvs: Float32Array.from(uv), couleurs: Float32Array.from(col), indices: Uint32Array.from(idx), texture, mode: 'decoupe', deuxFaces: true, genre: 'bloc', bloc };
}
const quad = (coins, uvs, L, texture, bloc) => ({ positions: Float32Array.from(coins.flat()), uvs: Float32Array.from(uvs.flat()), couleurs: new Float32Array(12).fill(L), indices: Uint32Array.of(0, 3, 2, 0, 2, 1), texture, mode: 'decoupe', deuxFaces: true, genre: 'bloc', bloc });
const appliquer = (M, p) => [M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + M[3], M[4] * p[0] + M[5] * p[1] + M[6] * p[2] + M[7], M[8] * p[0] + M[9] * p[1] + M[10] * p[2] + M[11]];

export function creerEntitesDecor({ rs, replay, kit, texOf, lum, scene, creatures, notes = [] }) {
  const ed = scene?._entitesDecor ?? {};
  const zone = rs.zone;
  // statues : zone de depart (une statue posee pendant le film par la simulation n'est pas dans les constructions importees)
  const statues = [];
  {
    const palette = [...zone.palette, ...(replay?.palAjouts ?? [])];
    const est = new Set(); palette.forEach((s, i) => { if (RE_STATUE.test(s)) est.add(i); });
    if (est.size) { const { sx, sz, x0, y0, z0, cellules } = zone; for (let i = 0; i < cellules.length; i++) if (est.has(cellules[i])) { const lx = i % sx, t = (i - lx) / sx, lz = t % sz, ly = (t - lz) / sz; statues.push({ x: x0 + lx, y: y0 + ly, z: z0 + lz, etat: palette[cellules[i]] }); } }
  }
  const cages = ed.cages ?? [], objets = ed.objetsPoses ?? [], tableaux = ed.tableaux ?? [], noeuds = ed.noeuds ?? [], coussins = ed.coussins ?? [];
  if (!statues.length && !cages.length && !objets.length && !tableaux.length && !noeuds.length && !coussins.length) return null;
  const L = (x, y, z) => lum(x + 0.5, y + 0.5, z + 0.5);
  const creaturesC = new Map();
  const creature = (cle, o, modele = null) => {
    if (!creatures) return null;
    if (!creaturesC.has(cle)) {
      let c = null;
      try {
        c = new Creature(o, creatures, kit);
        if (modele) {   // statue : modele de la pose, sans les yeux lumineux (la statue est un bloc)
          c.couches = c.couches.filter((k) => !k.emissif).map((k) => { const m = creatures.modeles[modele]?.[k.couche]; return m ? { ...k, racine: m.r, noeuds: aplatir(m.r) } : k; });
        }
      } catch (e) { notes.push(`decor : ${o.type} non dessine (${String(e.message).slice(0, 60)})`); c = null; }
      creaturesC.set(cle, c);
    }
    return creaturesC.get(cle);
  };
  const etatCreature = (type, u) => ({ cacher: [], s: { pos: 0, speed: 0, age: u, yRot: 0, xRot: 0, swing: 0, baby: false, partial: 0 }, m: etatInitial(type), parties: {} });

  function cage(c, u) {
    const cr = creature(c.type, { type: c.type }); if (!cr) return [];
    const ty = creatures.types?.[c.type] ?? {}, dim = Math.max(ty.l ?? 0.6, ty.h ?? 1.8);
    const f = dim > 1 ? 0.53125 / dim : 0.53125;
    const spin = ((u * 1000 / 220) % 360) * 10;
    const base = cr.base({ x: 0, y: 0, z: 0, lacet: 0, creature: etatCreature(c.type, u) });
    const M = mul(mul(mul(mul(mul(mul(T(c.x + 0.5, c.y, c.z + 0.5), T(0, 0.4, 0)), RY(spin * RAD)), T(0, -0.2, 0)), RX(-30 * RAD)), S(f, f, f)), base);
    return cr.maillage({ x: c.x + 0.5, y: c.y, z: c.z + 0.5, matrice: M, age: u, creature: etatCreature(c.type, u) }, L(c.x, c.y, c.z));
  }
  function statue(I) {
    const m = RE_STATUE.exec(I.etat), p = props(I.etat), ox = m[1] ?? 'unaffected';
    const pose = { sitting: 'copper_golem_sitting', running: 'copper_golem_running', star: 'copper_golem_star' }[p.copper_golem_pose] ?? null;
    const cr = creature(`statue|${ox}|${pose}`, { type: 'copper_golem', variante: ox }, pose ?? 'copper_golem'); if (!cr) return [];
    // les modeles de statue n'ont pas le decalage de 24 pixels de la racine des creatures : pieds a y = 0 du modele (le rendu d'entite remonte de 1,501)
    return cr.maillage({ x: I.x + 0.5, y: pose ? I.y - 1.501 : I.y, z: I.z + 0.5, lacet: VERS_Y[p.facing] ?? 0, age: 0 }, L(I.x, I.y, I.z));
  }
  const texItem = (id) => texOf(`item/${id}.png`) ?? texOf(`block/${id}.png`);
  function objetPose(o, u) {
    const t = texItem(o.objet); if (!t) { notes.push(`decor : objet ${o.objet} sans image dans le kit`); return []; }
    const l = L(o.x, o.y, o.z), uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    if (o.genre === 'campfire') {
      const fac = props(zoneEtat(o.x, o.y, o.z)).facing ?? 'north', i2 = ['south', 'west', 'north', 'east'];
      const dir = i2[(o.case + i2.indexOf(fac)) % 4];
      const M = mul(mul(mul(mul(T(o.x + 0.5, o.y + 0.44921875, o.z + 0.5), RY(-VERS_Y[dir] * RAD)), RX(90 * RAD)), T(-0.3125, -0.3125, 0)), S(0.375, 0.375, 0.375));
      return [quad([[-0.5, 0.5, 0], [0.5, 0.5, 0], [0.5, -0.5, 0], [-0.5, -0.5, 0]].map((q) => appliquer(M, q)), uv, l, t, o.objet)];
    }
    const M = mul(mul(T(o.x + 0.5, o.y + 0.5 + Math.sin(u / 10) * 0.05, o.z + 0.5), RY(u * 3 * RAD)), S(0.5, 0.5, 0.5));   // objet montre du coffre-fort : tourne, flotte
    return [quad([[-0.5, 0.5, 0], [0.5, 0.5, 0], [0.5, -0.5, 0], [-0.5, -0.5, 0]].map((q) => appliquer(M, q)), uv, l, t, o.objet)];
  }
  const zoneEtat = (x, y, z) => zone.palette[zone.paletteEn(x, y, z)] ?? '';
  function tableau(t) {
    const taille = PEINTURES[t.variante]; const img = texOf(`painting/${t.variante}.png`), dos = texOf('painting/back.png');
    if (!taille || !img) { notes.push(`decor : tableau ${t.variante} inconnu ou sans image (groupe entites du kit)`); return []; }
    const [w, h] = taille, F = VEC[t.face], D = VEC[CCW[t.face]];   // D : vers la droite de celui qui regarde le tableau
    const c = [t.x + 0.5 - F[0] * 0.46875 + D[0] * (w % 2 ? 0 : 0.5), t.y + 0.5 + (h % 2 ? 0 : 0.5), t.z + 0.5 - F[2] * 0.46875 + D[2] * (w % 2 ? 0 : 0.5)];
    const pt = (a, b, e) => [c[0] + D[0] * a + F[0] * e, c[1] + b, c[2] + D[2] * a + F[2] * e];
    const l = lum(c[0] + F[0] * 0.5, c[1], c[2] + F[2] * 0.5), e = 1 / 32;
    const out = [quad([pt(-w / 2, h / 2, e), pt(w / 2, h / 2, e), pt(w / 2, -h / 2, e), pt(-w / 2, -h / 2, e)], [[0, 0], [1, 0], [1, 1], [0, 1]], l, img, 'painting')];
    if (dos) {
      const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
      out.push(quad([pt(w / 2, h / 2, -e), pt(-w / 2, h / 2, -e), pt(-w / 2, -h / 2, -e), pt(w / 2, -h / 2, -e)], uv, l * 0.8, dos, 'painting'));
      out.push(quad([pt(-w / 2, h / 2, -e), pt(w / 2, h / 2, -e), pt(w / 2, h / 2, e), pt(-w / 2, h / 2, e)], uv, l, dos, 'painting'));
      out.push(quad([pt(-w / 2, -h / 2, e), pt(w / 2, -h / 2, e), pt(w / 2, -h / 2, -e), pt(-w / 2, -h / 2, -e)], uv, l * 0.5, dos, 'painting'));
      out.push(quad([pt(-w / 2, h / 2, -e), pt(-w / 2, h / 2, e), pt(-w / 2, -h / 2, e), pt(-w / 2, -h / 2, -e)], uv, l * 0.6, dos, 'painting'));
      out.push(quad([pt(w / 2, h / 2, e), pt(w / 2, h / 2, -e), pt(w / 2, -h / 2, -e), pt(w / 2, -h / 2, e)], uv, l * 0.6, dos, 'painting'));
    }
    return out;
  }
  function noeud(n) {
    const t = texOf('entity/lead_knot/lead_knot.png') ?? texOf('entity/lead_knot.png'); if (!t) return [];
    return [maillage(faces([-3, 0, -3, 3, 8, 3], 0, 0, 32, 32), (q) => [n.x + 0.5 + q[0] / 16, n.y + 0.375 + q[1] / 16, n.z + 0.5 + q[2] / 16], L(n.x, n.y, n.z), t, 'leash_knot')];
  }
  function coussin(c) {
    const t = texOf(`entity/cushion/${c.couleur}_cushion.png`); if (!t) return [];
    const a = -c.lacet * RAD, ca = Math.cos(a), sa = Math.sin(a);
    return [maillage(faces([-8, 0, -8, 8, 4, 8], 0, 0, 64, 64), (q) => { const x = q[0] / 16, z = q[2] / 16; return [c.x + x * ca + z * sa, c.y + q[1] / 16, c.z - x * sa + z * ca]; }, lum(c.x, c.y + 0.2, c.z), t, 'cushion')];
  }

  return {
    maillages(u) {
      const out = [];
      for (const c of cages) out.push(...cage(c, u));
      for (const s of statues) out.push(...statue(s));
      for (const o of objets) out.push(...objetPose(o, u));
      for (const t of tableaux) out.push(...tableau(t));
      for (const n of noeuds) out.push(...noeud(n));
      for (const c of coussins) out.push(...coussin(c));
      return out;
    },
  };
}
