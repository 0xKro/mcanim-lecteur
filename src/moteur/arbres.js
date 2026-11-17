// Arbres qui poussent (pousse -> arbre, farine d'os). Port de TreeFeature, StraightTrunkPlacer, ForkingTrunkPlacer, BlobFoliagePlacer, SpruceFoliagePlacer,
// AcaciaFoliagePlacer (Horizon world/worldgen/tree/ : MIT, voir ATTRIBUTIONS.md) ; les nombres (hauteurs, rayons, bois, feuilles) viennent des donnees du jeu
// (`arbres`, extraites de data/worldgen/feature/*.json). Ordre des tirages du jeu : hauteur (base + a + b), hauteur du feuillage, rayon, tronc, puis chaque feuillage.
// ECARTS : chene majestueux (fancy_oak), cerisier (branches), tronc double (chene noir, sapin et acajou geants) : approches ou absents, voir docs/SIMULATION.md partie 13.
//   - cerisier : tronc droit (7 a 8) et feuillage en boule de rayon 4 ; chene noir : refuse (il demande 2 x 2 pousses) ; pas de ruches ni de vignes de la jungle
const DIRS = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
const HORIZ = [[0, 1], [0, -1], [1, 0], [-1, 0]];

// pousse -> caracteristique de generation (donnees `arbres`)
export const ESPECES = { oak_sapling: 'oak', birch_sapling: 'birch', spruce_sapling: 'spruce', jungle_sapling: 'jungle_tree', acacia_sapling: 'acacia', cherry_sapling: 'cherry', dark_oak_sapling: 'dark_oak' };

export class Arbres {
  constructor(sim) { this.sim = sim; }

  // Fait pousser l'arbre `espece` (cle de `arbres`) a partir de la pousse en (x, y, z). Rend le nombre de blocs poses (0 : pas la place, ou espece refusee).
  pousser(x, y, z, espece, opt = {}) {
    const sim = this.sim, d = sim.d, h = sim.hasard, A = d.arbre(espece);
    if (!A) { sim.avertir(`arbre inconnu "${espece}" (donnees : oak, birch, spruce, acacia, jungle_tree, cherry)`); return 0; }
    if (A.t[0] === 'dark_oak_trunk_placer' || A.t[0] === 'fancy_trunk_placer') { sim.avertir(`arbre ${espece} : non gere (2 x 2 pousses ou chene majestueux), l'arbre ne pousse pas`); return 0; }
    const val = (v) => (Array.isArray(v) ? h.entreInclus(v[0], v[1]) : v);
    const [typeTronc, base, ra, rb] = A.t;
    const hauteur = opt.hauteur ?? (base + h.entierBorne(ra + 1) + h.entierBorne(rb + 1));
    const typeF = A.f[0];
    let hauteurF = typeF === 'spruce_foliage_placer' ? Math.max(4, hauteur - val(A.f[1])) : typeF === 'acacia_foliage_placer' ? 0 : val(A.f[1]);
    if (typeF === 'cherry_foliage_placer') hauteurF = 5;
    const rayon = val(A.f[3]);
    // place libre : la colonne du tronc doit etre remplacable par un arbre
    for (let k = 1; k < hauteur; k++) if (!this.libre(x, y + k, z)) return 0;
    const logs = new Map(), feuilles = new Map(), cle = (a, b, c) => `${a},${b},${c}`;
    const bois = 'minecraft:' + A.b + '[axis=y]';
    const log = (a, b, c) => { if (!this.libre(a, b, c) && !(a === x && b === y && c === z)) return false; logs.set(cle(a, b, c), [a, b, c]); return true; };
    const attaches = [];
    if (typeTronc === 'forking_trunk_placer') {
      const dir = HORIZ[h.entierBorne(4)], lean = hauteur - h.entierBorne(4) - 1;
      let steps = 3 - h.entierBorne(3), a = x, c = z, dernier = null;
      for (let k = 0; k < hauteur; k++) { if (k >= lean && steps > 0) { a += dir[0]; c += dir[1]; steps--; } if (log(a, y + k, c)) dernier = y + k + 1; }
      if (dernier !== null) attaches.push({ x: a, y: dernier, z: c, rayon: 1 });
      a = x; c = z;
      const dir2 = HORIZ[h.entierBorne(4)];
      if (dir2 !== dir) {
        const depart = lean - h.entierBorne(2) - 1;
        let pas = 1 + h.entierBorne(3), dernier2 = null;
        for (let k = depart; k < hauteur && pas > 0; k++, pas--) { if (k >= 1) { a += dir2[0]; c += dir2[1]; if (log(a, y + k, c)) dernier2 = y + k + 1; } }
        if (dernier2 !== null) attaches.push({ x: a, y: dernier2, z: c, rayon: 0 });
      }
    } else {
      for (let k = 0; k < hauteur; k++) log(x, y + k, z);
      attaches.push({ x, y: y + hauteur, z, rayon: 0 });
    }
    // feuillage
    const feuille = (a, b, c) => { const k = cle(a, b, c); if (logs.has(k) || feuilles.has(k)) return; if (this.libre(a, b, c) || this.estFeuille(a, b, c)) feuilles.set(k, [a, b, c]); };
    const rangee = (at, range, dy, saute) => {
      for (let dx = -range; dx <= range; dx++) for (let dz = -range; dz <= range; dz++) { if (saute(Math.abs(dx), dy, Math.abs(dz), range)) continue; feuille(at.x + dx, at.y + dy, at.z + dz); }
    };
    for (const at of attaches) {
      if (typeF === 'blob_foliage_placer' || typeF === 'cherry_foliage_placer') {
        const decalage = val(A.f[2]);
        for (let yo = decalage; yo >= decalage - hauteurF; yo--) {
          const r = Math.max(rayon + at.rayon - 1 - Math.trunc(yo / 2), 0);
          rangee(at, r, yo, (dx, dy, dz, range) => dx === range && dz === range && (h.entierBorne(2) === 0 || dy === 0));
        }
      } else if (typeF === 'spruce_foliage_placer') {
        let r = h.entierBorne(2), max = 1, min = 0;
        const decalage = val(A.f[2]);
        for (let yo = decalage; yo >= -hauteurF; yo--) {
          rangee(at, r, yo, (dx, dy, dz, range) => dx === range && dz === range && range > 0);
          if (r >= max) { r = min; min = 1; max = Math.min(max + 1, rayon + at.rayon); } else r++;
        }
      } else if (typeF === 'acacia_foliage_placer') {
        rangee(at, rayon + at.rayon, -1 - hauteurF, (dx, dy, dz, range) => dx === range && dz === range && range > 0);
        rangee(at, rayon - 1, -hauteurF, (dx, dy, dz, range) => dx === range && dz === range && range > 0);
        rangee(at, rayon + at.rayon - 1, 0, (dx, dy, dz) => (dx > 1 || dz > 1) && dx !== 0 && dz !== 0);
      } else rangee(at, rayon, 0, () => false);
    }
    // distances des feuilles au bois le plus proche (LeavesBlock.distance : 1 au contact d'une buche, 7 = meurt)
    const dist = new Map(), file = [];
    for (const [k, p] of logs) { dist.set(k, 0); file.push(p); }
    for (let i = 0; i < file.length; i++) {
      const p = file[i], dp = dist.get(cle(...p));
      for (const [a, b, c] of DIRS) { const q = [p[0] + a, p[1] + b, p[2] + c], kq = cle(...q); if (feuilles.has(kq) && !dist.has(kq) && dp + 1 <= 6) { dist.set(kq, dp + 1); file.push(q); } }
    }
    // ecriture : le sol sous l'arbre devient de la terre, les buches puis les feuilles (sans mise a jour des voisins : drapeau 2)
    const dessous = sim.decrire(x, y - 1, z);
    if (/grass_block|podzol|mycelium|coarse_dirt/.test(dessous.nom)) sim.poser(x, y - 1, z, 'minecraft:dirt', 2);
    let n = 0;
    for (const p of logs.values()) { sim.poser(p[0], p[1], p[2], bois, 2); n++; }
    for (const [k, p] of feuilles) { sim.poser(p[0], p[1], p[2], `minecraft:${A.l}[distance=${dist.get(k) ?? 7},persistent=false,waterlogged=false]`, 2); n++; }
    sim.stats.arbres = (sim.stats.arbres || 0) + 1;
    sim.son('block.grass.place', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    sim.dire(`${espece} pousse en ${x},${y},${z} : hauteur ${hauteur}, ${logs.size} buches, ${feuilles.size} feuilles`);
    return n;
  }

  libre(x, y, z) {
    const sim = this.sim, e = sim.monde.etatEn(x, y, z);
    if (e < 0) return false;
    const nom = sim.d.nomBloc(e);
    if (/^(water|lava)$/.test(nom)) return false;
    if (sim.d.a(e, 1)) return true;               // remplacable : air, herbes, fleurs, neige
    return /_sapling$|_leaves$|^vine$/.test(nom);
  }
  estFeuille(x, y, z) { const e = this.sim.monde.etatEn(x, y, z); return e >= 0 && /_leaves$/.test(this.sim.d.nomBloc(e)); }
}
