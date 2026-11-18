// Contenus des conteneurs (coffre, coffre double, tonneau, entonnoir, dropper, distributeur, boite de shulker, fours) :
//   - chaque bloc a des emplacements { item, n } ; la taille vient du bloc (coffre 27, entonnoir 5, dropper et distributeur 9, fours 3) ;
//   - un coffre double (deux moities `type=left` / `type=right` appariees : ChestBlock.getConnectedDirection) est vu comme UN conteneur de
//     54 cases (CompoundContainer : la moitie `right` d'abord, puis la `left`, comme Horizon game/machines.rs) pour les entonnoirs, les
//     droppers, le comparateur et `monde.contenus` ; chaque moitie garde ses 27 cases (cassee : elle lache les siennes) ;
//   - la scene donne le contenu de depart : `monde.contenus: [[x, y, z, "diamond", 12], ...]` ; un conteneur sans ligne est vide ;
//   - le comparateur lit la plenitude (AbstractContainerMenu.getRedstoneSignalFromContainer) ;
//   - la taille d'une pile est celle du composant `max_stack_size` de chaque objet (table entiere du jeu : donnees.pileMax ; 316 objets a 1 ou 16).
const TAILLES = { ChestBlock: 27, BarrelBlock: 27, HopperBlock: 5, DispenserBlock: 9, ShulkerBoxBlock: 27, AbstractFurnaceBlock: 3 };   // fours : entree, combustible, sortie (four.js)

// Repli SANS donnees du jeu (aucun cas dans le moteur : la simulation a toujours ses donnees) ; avec elles, la table du jeu.
let DONNEES = null;
const UN = /(_sword|_spear|_pickaxe|_axe|_shovel|_hoe|_helmet|_chestplate|_leggings|_boots|_horse_armor|_boat|_raft|_minecart|_bed|_chest_boat)$|^(bow|crossbow|trident|shield|fishing_rod|elytra|flint_and_steel|shears|water_bucket|lava_bucket|milk_bucket|powder_snow_bucket|potion|splash_potion|lingering_potion|saddle|totem_of_undying|cake|enchanted_book|writable_book|carrot_on_a_stick|warped_fungus_on_a_stick|brush|spyglass|mace|music_disc_\w+|minecart)$/;
const SEIZE = /(_sign|_hanging_sign|_banner)$|^(bucket|ender_pearl|egg|snowball|honey_bottle|armor_stand|wind_charge|written_book)$/;
export const pileMax = (item) => (DONNEES ? DONNEES.pileMax(item) : UN.test(item) ? 1 : SEIZE.test(item) ? 16 : 64);
export const definirDonneesPiles = (d) => { DONNEES = d; };

const HORIZ = ['north', 'east', 'south', 'west'];
const VEC = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

export class Contenus {
  constructor(sim) { this.sim = sim; this.m = new Map(); if (sim.d?.pileMax) DONNEES = sim.d; }
  cle(x, y, z) { return `${x},${y},${z}`; }
  // taille du bloc en (x, y, z) (une moitie de coffre : 27), ou 0 si le bloc n'en est pas un
  taille(x, y, z) {
    const e = this.sim.monde.etatEn(x, y, z);
    if (e < 0) return 0;
    for (const c of this.sim.d.classes(this.sim.d.blocDe(e))) if (TAILLES[c]) return TAILLES[c];
    return 0;
  }
  estConteneur(x, y, z) { return this.taille(x, y, z) > 0; }
  // l'autre moitie d'un coffre double (ChestBlock.getConnectedDirection : `left` -> sens horaire de `facing`, `right` -> anti-horaire), ou null
  moitie(x, y, z) {
    const d = this.sim.d, e = this.sim.monde.etatEn(x, y, z);
    if (e < 0 || !d.classes(d.blocDe(e)).includes('ChestBlock')) return null;
    const p = d.props(e);
    if (p.type !== 'left' && p.type !== 'right') return null;
    const i = HORIZ.indexOf(p.facing), dir = HORIZ[(i + (p.type === 'left' ? 1 : 3)) % 4], v = VEC[dir];
    const ox = x + v[0], oz = z + v[1], e2 = this.sim.monde.etatEn(ox, y, oz);
    if (e2 < 0 || d.blocDe(e2) !== d.blocDe(e)) return null;
    const q = d.props(e2);
    if (q.facing !== p.facing || q.type !== (p.type === 'left' ? 'right' : 'left')) return null;
    return { pos: [ox, y, oz], droite: p.type === 'right' };
  }
  // emplacements d'un bloc (crees a la demande) ou null
  propres(x, y, z) {
    const t = this.taille(x, y, z);
    if (!t) return null;
    const k = this.cle(x, y, z);
    let s = this.m.get(k);
    if (!s) { s = new Array(t).fill(null); this.m.set(k, s); }
    return s;
  }
  // emplacements VUS (coffre double : 54, la moitie droite d'abord) ; les objets sont partages avec les moities
  lire(x, y, z) {
    const s = this.propres(x, y, z);
    if (!s) return null;
    const o = this.moitie(x, y, z);
    if (!o) return s;
    const autre = this.propres(...o.pos);
    return o.droite ? new Vue(s, autre) : new Vue(autre, s);
  }
  // ce que lache le bloc quand il est retire : ses PROPRES cases (Containers.dropContents de la moitie)
  vider(x, y, z) { const k = this.cle(x, y, z), s = this.m.get(k); this.m.delete(k); return s ? s.filter(Boolean) : []; }
  viderCases(x, y, z) { const k = this.cle(x, y, z), s = this.m.get(k); this.m.delete(k); return s ? [...s] : []; }
  // ajoute `n` de `item` : d'abord dans les piles du meme objet, puis dans les emplacements vides ; rend ce qui n'a pas pu entrer
  ajouter(x, y, z, item, n) {
    const s = this.lire(x, y, z);
    if (!s) return n;
    if (s.length === 3 && this.sim.fours?.estFour(x, y, z)) return this.sim.fours.deposer([x, y, z], item, n);   // le four range l'entree, le combustible et la sortie lui-meme
    const max = pileMax(item);
    for (let i = 0; i < s.length && n > 0; i++) { const e = g(s, i); if (e && e.item === item && e.n < max) { const k = Math.min(n, max - e.n); e.n += k; n -= k; } }
    for (let i = 0; i < s.length && n > 0; i++) if (!g(s, i)) { const k = Math.min(n, max); st(s, i, { item, n: k }); n -= k; }
    return n;
  }
  retirer(x, y, z, i, n = 1) {
    const s = this.lire(x, y, z);
    if (!s || !g(s, i)) return 0;
    const e = g(s, i), k = Math.min(n, e.n);
    e.n -= k;
    if (e.n <= 0) st(s, i, null);
    return k;
  }
  vide(x, y, z) { const s = this.lire(x, y, z); return !s || s.every((e) => !e); }
  plein(x, y, z) { const s = this.lire(x, y, z); return !!s && s.every((e) => e && e.n >= pileMax(e.item)); }
  // signal du comparateur : floor(f x 14) + (au moins une pile ? 1 : 0), f = moyenne de n / min(pileMax, 64) sur tous les emplacements
  niveau(x, y, z) {
    const s = this.lire(x, y, z);
    if (!s) return 0;
    return niveauListe(s);
  }
  // positions des entonnoirs deja presents dans la zone (pour qu'ils tournent des le tick 0)
  entonnoirs() {
    const m = this.sim.monde, d = this.sim.d, marque = new Uint8Array(m.palette.length + 1);
    let n = 0;
    for (let p = 2; p < m.palette.length; p++) { const e = m.tEtat[p]; if (e >= 0 && d.nomBloc(e) === 'hopper') { marque[p] = 1; n++; } }
    const sortie = [];
    if (!n) return sortie;
    for (let y = m.y0; y < m.y0 + m.sy; y++) for (let z = m.z0; z < m.z0 + m.sz; z++) for (let x = m.x0; x < m.x0 + m.sx; x++) { const p = m.indiceEn(x, y, z); if (p < marque.length && marque[p]) sortie.push([x, y, z]); }
    return sortie;
  }
  // contenu de depart de la scene : [[x, y, z, "objet", n], ...]
  initial(liste) {
    for (const [x, y, z, item, n] of liste || []) {
      const nom = String(item).replace(/^minecraft:/, '');
      if (!this.estConteneur(x, y, z)) { this.sim.avertir(`monde.contenus : pas de conteneur en ${x},${y},${z}`); continue; }
      const reste = this.ajouter(x, y, z, nom, n);
      if (reste) this.sim.avertir(`monde.contenus : ${reste} ${nom} ne tiennent pas en ${x},${y},${z}`);
    }
  }
}

// signal d'un ensemble de cases (tableau, Vue ou cases d'un wagonnet)
export function niveauListe(s) {
  let f = 0, piles = 0;
  for (const e of s) if (e) { f += e.n / Math.min(64, pileMax(e.item)); piles++; }
  f /= s.length;
  return Math.floor(f * 14) + (piles > 0 ? 1 : 0);
}

// CompoundContainer : deux tableaux vus comme un seul (54 cases), avec les memes methodes que les tableaux simples
// case i d'un tableau simple ou d'une Vue
const g = (s, i) => (s instanceof Vue ? s.get(i) : s[i]);
const st = (s, i, v) => { if (s instanceof Vue) s.set(i, v); else s[i] = v; };
export class Vue {
  constructor(a, b) { this.a = a; this.b = b; }
  get length() { return this.a.length + this.b.length; }
  get(i) { return i < this.a.length ? this.a[i] : this.b[i - this.a.length]; }
  set(i, v) { if (i < this.a.length) this.a[i] = v; else this.b[i - this.a.length] = v; }
  every(f) { return this.a.every(f) && this.b.every(f); }
  filter(f) { return [...this.a, ...this.b].filter(f); }
  map(f) { return [...this.a, ...this.b].map(f); }
  [Symbol.iterator]() { return [...this.a, ...this.b][Symbol.iterator](); }
}
