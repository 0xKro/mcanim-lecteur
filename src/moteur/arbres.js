// Arbres qui poussent : TreeGrower du jeu (pousse seule ou carre de 2 x 2 pousses, arbres a ruches pres des fleurs, chene majestueux 1 fois sur 10...),
// puis la caracteristique `minecraft:tree` du jeu lue dans le kit (caracteristiques.js : tous les troncs, feuillages, racines, decorations, place
// minimale `minimum_size`). Port d'apres Horizon horizon-world/src/level/growth.rs (TreeGrower, MushroomBlock.growMushroom) : MIT, voir ATTRIBUTIONS.md.
// Les listes de TreeGrower (especes et poids) sont celles du code du jeu, recopiees par Horizon (growth.rs, GROWERS) ; les arbres eux-memes viennent
// des fichiers du jeu. Sans le groupe `worldgen` du kit, repli sur l'ancienne approche (table `arbres` : tronc droit ou fourchu) avec un avertissement.
import { Caracteristiques, dossierCaracteristiques } from './caracteristiques.js';
const DIRS = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
const HORIZ = [[0, 1], [0, -1], [1, 0], [-1, 0]];

// pousse -> caracteristique de generation (repli sans kit : donnees `arbres`)
export const ESPECES = { oak_sapling: 'oak', birch_sapling: 'birch', spruce_sapling: 'spruce', jungle_sapling: 'jungle_tree', acacia_sapling: 'acacia', cherry_sapling: 'cherry', dark_oak_sapling: 'dark_oak' };

// TreeGrower du jeu : [caracteristique, poids] (WeightedList) ; `mega` : carre de 2 x 2 pousses ; `fleurs` : une fleur a 2 blocs (1 en hauteur)
export const POUSSES = {
  oak: { arbres: [['oak', 9], ['fancy_oak', 1]], mega: [], fleurs: [['oak_bees_005', 9], ['fancy_oak_bees_005', 1]], court: 'oak' },
  spruce: { arbres: [['spruce', 1]], mega: [['mega_spruce', 1], ['mega_pine', 1]], fleurs: [], court: 'spruce' },
  mangrove: { arbres: [['mangrove', 15], ['tall_mangrove', 85]], mega: [], fleurs: [], court: 'mangrove' },
  azalea: { arbres: [['azalea_tree', 1]], mega: [], fleurs: [], court: 'azalea_tree' },
  birch: { arbres: [['birch', 1]], mega: [], fleurs: [['birch_bees_005', 1]], court: 'birch' },
  jungle: { arbres: [['jungle_tree_no_vine', 1]], mega: [['mega_jungle_tree', 1]], fleurs: [], court: 'jungle_tree_no_vine' },
  acacia: { arbres: [['acacia', 1]], mega: [], fleurs: [], court: 'acacia' },
  cherry: { arbres: [['cherry', 1]], mega: [], fleurs: [['cherry_bees_005', 1]], court: 'cherry' },
  dark_oak: { arbres: [], mega: [['dark_oak', 1]], fleurs: [], court: null },
  pale_oak: { arbres: [], mega: [['pale_oak_bonemeal', 1]], fleurs: [], court: null },
  poplar: { arbres: [['red_poplar', 1], ['orange_poplar', 1], ['yellow_poplar', 1]], mega: [], fleurs: [], court: 'red_poplar' },
};
// WeightedList.getRandom : pas de tirage pour une liste vide
function pondere(l, h) {
  const total = l.reduce((s, x) => s + x[1], 0);
  if (!total) return null;
  let k = h.entierBorne(total);
  for (const [n, p] of l) { if (k < p) return n; k -= p; }
  return null;
}

export class Arbres {
  constructor(sim) { this.sim = sim; this._c = undefined; }

  // caracteristiques du jeu (kit) ; null sans le groupe worldgen
  get carac() {
    if (this._c === undefined) {
      const dossier = dossierCaracteristiques(this.sim.config?.kitDir);
      this._c = dossier ? new Caracteristiques(this.sim, dossier) : null;
      if (!this._c) this.sim.avertir('caracteristiques du jeu absentes du kit (groupe worldgen) : arbres approches, pas de champignons geants');
    }
    return this._c;
  }
  // nom du TreeGrower d'une pousse (champ `treeGrower` du jeu)
  pousseDe(e) { if (e < 0) return null; const ch = this.sim.d.champsBloc(this.sim.d.blocDe(e)); return ch?.treeGrower?.name ?? (this.sim.d.nomBloc(e) === 'azalea' || this.sim.d.nomBloc(e) === 'flowering_azalea' ? 'azalea' : null); }
  // TreeGrower.hasFlowers : une fleur (#flowers) a 2 blocs en x et z, 1 en y
  fleursPres(x, y, z) {
    const sim = this.sim, t = sim.d.etiquette('flowers');
    for (let dy = -1; dy <= 1; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const e = sim.monde.etatEn(x + dx, y + dy, z + dz); if (e >= 0 && t.has(sim.d.blocDe(e))) return true; }
    return false;
  }
  // TreeGrower.findTwoByTwoSaplingPos : [dx, dz, positions] ou null
  carre(e, x, y, z) {
    const sim = this.sim, b = sim.d.blocDe(e);
    for (const dx of [0, -1]) for (const dz of [0, -1]) {
      const pos = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, c]) => [x + dx + a, y, z + dz + c]);
      if (pos.every((p) => { const q = sim.monde.etatEn(...p); return q >= 0 && sim.d.blocDe(q) === b; })) return [dx, dz, pos.map((p) => [p, sim.monde.etatEn(...p)])];
    }
    return null;
  }
  // TreeGrower.removeSapling : le bloc du fluide (eau d'une pousse noyee), drapeaux 818
  retirer(p) {
    const sim = this.sim, e = sim.monde.etatEn(...p);
    sim.poser(p[0], p[1], p[2], e >= 0 && sim.d.prop(e, 'waterlogged') === 'true' ? 'minecraft:water[level=0]' : 'minecraft:air', 818);
  }
  // TreeGrower.growTree ; rend vrai si un arbre a pousse
  grandir(g, x, y, z, e) {
    const sim = this.sim, h = sim.hasard, C = this.carac, G = POUSSES[g];
    if (!G || !C) return false;
    const mega = pondere(G.mega, h);
    let c2;
    if (mega && C.existe(mega) && (c2 = this.carre(e, x, y, z))) {
      const [dx, dz, autour] = c2;
      for (const [p] of autour) this.retirer(p);
      if (C.placer(mega, x + dx, y, z + dz)) { this.fin(mega, x + dx, y, z + dz); return true; }
      for (const [p, s] of autour) sim.poser(p[0], p[1], p[2], s, 4);
      return false;
    }
    const liste = this.fleursPres(x, y, z) && G.fleurs.length ? G.fleurs : G.arbres;
    const nom = pondere(liste, h);
    if (!nom || !C.existe(nom)) return false;
    this.retirer([x, y, z]);
    if (C.placer(nom, x, y, z)) { this.fin(nom, x, y, z); return true; }
    sim.poser(x, y, z, e, 4);
    return false;
  }
  fin(nom, x, y, z) {
    const sim = this.sim;
    sim.stats.arbres = (sim.stats.arbres || 0) + 1;
    sim.dire(`${nom} pousse en ${x},${y},${z}`);
  }
  // TreeGrower.canGrow (tirages comme le jeu : liste normale, puis mega)
  peutGrandir(g, x, y, z, e) {
    const h = this.sim.hasard, G = POUSSES[g];
    if (!G) return false;
    const liste = this.fleursPres(x, y, z) && G.fleurs.length ? G.fleurs : G.arbres;
    const a = pondere(liste, h), m = pondere(G.mega, h);
    return a === null && m !== null ? !!this.carre(e, x, y, z) : true;
  }
  // TreeGrower.getMinimumHeight : base_height du tronc de l'arbre le plus court
  hauteurMin(g) { const G = POUSSES[g], j = G?.court ? this.carac?.json(G.court) : null; return j?.type === 'minecraft:tree' ? j.trunk_placer.base_height ?? 0 : 0; }
  // SaplingBlock.advanceTree : stade 0 -> 1, puis l'arbre
  avancer(x, y, z) {
    const sim = this.sim, e = sim.monde.etatEn(x, y, z);
    if (e < 0) return false;
    if (sim.d.prop(e, 'stage') === '0') { sim.poser(x, y, z, sim.d.avec(e, 'stage', '1'), 4); return false; }
    const g = this.pousseDe(e);
    if (!this.carac) { const esp = ESPECES[sim.d.nomBloc(e)]; return esp ? this.pousserApproche(x, y, z, esp) > 0 : false; }
    return this.grandir(g, x, y, z, e);
  }
  // SaplingBlock.isValidBonemealTarget : la pousse peut grandir (TreeGrower.canGrow, tirages compris) et l'arbre le plus court tient sous le plafond
  possible(x, y, z) {
    const sim = this.sim, e = sim.monde.etatEn(x, y, z), g = this.pousseDe(e);
    if (!g) return false;
    if (!this.carac) return !!ESPECES[sim.d.nomBloc(e)];
    if (sim.d.nomBloc(e) === 'azalea' || sim.d.nomBloc(e) === 'flowering_azalea') {   // AzaleaBlock : 2 de marge, pas de fluide au-dessus
      const f = sim.monde.etatEn(x, y + 1, z);
      return y + this.hauteurMin('azalea') + 2 < 320 && !(f >= 0 && sim.d.fluide(f));
    }
    if (!this.peutGrandir(g, x, y, z, e)) return false;
    return y + this.hauteurMin(g) < 320;
  }
  // MushroomBlock.isValidBonemealTarget : une caracteristique de champignon geant, et la place sous le plafond (y + 4 + rayon)
  champignonPossible(x, y, z) {
    const sim = this.sim, e = sim.monde.etatEn(x, y, z), f = e >= 0 ? sim.d.champsBloc(sim.d.blocDe(e))?.feature : null, j = f ? this.carac?.json(f) : null;
    if (!j || !/huge_(red|brown)_mushroom$/.test(j.type)) return false;
    return y + 4 + (j.foliage_radius ?? 2) < 320;
  }
  // MushroomBlock.growMushroom : le champignon disparait, le champignon geant pousse (sinon il revient)
  champignon(x, y, z) {
    const sim = this.sim, e = sim.monde.etatEn(x, y, z), C = this.carac;
    const f = e >= 0 ? sim.d.champsBloc(sim.d.blocDe(e))?.feature : null;
    if (!f || !C || !C.existe(f)) return false;
    sim.poser(x, y, z, 'minecraft:air', 3);
    if (C.placer(f, x, y, z)) return true;
    sim.poser(x, y, z, e, 3);
    return false;
  }

  // Fait pousser la caracteristique `espece` (nom du jeu : oak, fancy_oak, mega_spruce, cherry...) en (x, y, z), sans pousse. Rend le nombre de blocs changes
  // (0 : pas la place). opt.hauteur : seulement pour l'approche sans kit.
  pousser(x, y, z, espece, opt = {}) {
    const C = this.carac;
    if (C && opt.hauteur === undefined) {
      if (!C.existe(espece)) { this.sim.avertir(`arbre inconnu "${espece}" (caracteristiques du jeu : oak, fancy_oak, birch, spruce, mega_spruce, mega_pine, jungle_tree, mega_jungle_tree, acacia, dark_oak, cherry, mangrove, azalea_tree...)`); return 0; }
      const avant = this.sim.stats.poses;
      if (!C.placer(espece, x, y, z)) return 0;
      this.fin(espece, x, y, z);
      return this.sim.stats.poses - avant;
    }
    return this.pousserApproche(x, y, z, espece, opt);
  }
  // Ancienne approche (sans kit) : table `arbres` des donnees
  pousserApproche(x, y, z, espece, opt = {}) {
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
