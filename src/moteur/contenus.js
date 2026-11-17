// Contenus des conteneurs (coffre, tonneau, entonnoir, dropper, distributeur, boite de shulker) : le MINIMUM pour la redstone.
//   - chaque conteneur a des emplacements { item, n } ; la taille vient du bloc (coffre 27, entonnoir 5, dropper et distributeur 9) ;
//   - la scene donne le contenu de depart : `monde.contenus: [[x, y, z, "diamond", 12], ...]` ; un conteneur sans ligne est vide ;
//   - le comparateur lit la plenitude (AbstractContainerMenu.getRedstoneSignalFromContainer) ;
//   - la taille maximale d'une pile est une table courte (1, 16 ou 64) : pas les donnees du jeu entieres.
// Ce n'est PAS un inventaire de joueur : pas de clic, pas de recettes, pas d'enchantements, pas de four (le contenu d'un four n'est pas gere).
const TAILLES = { ChestBlock: 27, BarrelBlock: 27, HopperBlock: 5, DispenserBlock: 9, ShulkerBoxBlock: 27, FurnaceBlock: 3 };   // le four : entree, combustible, sortie (four.js)

const UN = /(_sword|_pickaxe|_axe|_shovel|_hoe|_helmet|_chestplate|_leggings|_boots|_horse_armor|_boat|_raft|_minecart|_bed|_chest_boat)$|^(bow|crossbow|trident|shield|fishing_rod|elytra|flint_and_steel|shears|water_bucket|lava_bucket|milk_bucket|powder_snow_bucket|potion|splash_potion|lingering_potion|saddle|totem_of_undying|cake|enchanted_book|written_book|writable_book|carrot_on_a_stick|warped_fungus_on_a_stick|brush|spyglass|compass|clock|mace|music_disc_\w+|minecart|lead|name_tag|map|filled_map)$/;
const SEIZE = /(_sign|_hanging_sign|_banner)$|^(bucket|ender_pearl|egg|snowball|honey_bottle|armor_stand|wind_charge)$/;
export const pileMax = (item) => (UN.test(item) ? 1 : SEIZE.test(item) ? 16 : 64);

export class Contenus {
  constructor(sim) { this.sim = sim; this.m = new Map(); }
  cle(x, y, z) { return `${x},${y},${z}`; }
  // taille du conteneur en (x, y, z), ou 0 si le bloc n'en est pas un
  taille(x, y, z) {
    const e = this.sim.monde.etatEn(x, y, z);
    if (e < 0) return 0;
    for (const c of this.sim.d.classes(this.sim.d.blocDe(e))) if (TAILLES[c]) return TAILLES[c];
    return 0;
  }
  estConteneur(x, y, z) { return this.taille(x, y, z) > 0; }
  // emplacements (cree a la demande) ou null
  lire(x, y, z) {
    const t = this.taille(x, y, z);
    if (!t) return null;
    const k = this.cle(x, y, z);
    let s = this.m.get(k);
    if (!s) { s = new Array(t).fill(null); this.m.set(k, s); }
    return s;
  }
  vider(x, y, z) { const k = this.cle(x, y, z), s = this.m.get(k); this.m.delete(k); return s ? s.filter(Boolean) : []; }
  // ajoute `n` de `item` : d'abord dans les piles du meme objet, puis dans les emplacements vides ; rend ce qui n'a pas pu entrer
  ajouter(x, y, z, item, n) {
    const s = this.lire(x, y, z);
    if (!s) return n;
    if (s.length === 3 && this.sim.fours?.estFour(x, y, z)) return this.sim.fours.deposer([x, y, z], item, n);   // le four range l'entree, le combustible et la sortie lui-meme
    const max = pileMax(item);
    for (const e of s) if (e && e.item === item && e.n < max && n > 0) { const k = Math.min(n, max - e.n); e.n += k; n -= k; }
    for (let i = 0; i < s.length && n > 0; i++) if (!s[i]) { const k = Math.min(n, max); s[i] = { item, n: k }; n -= k; }
    return n;
  }
  retirer(x, y, z, i, n = 1) {
    const s = this.lire(x, y, z);
    if (!s || !s[i]) return 0;
    const k = Math.min(n, s[i].n);
    s[i].n -= k;
    if (s[i].n <= 0) s[i] = null;
    return k;
  }
  vide(x, y, z) { const s = this.lire(x, y, z); return !s || s.every((e) => !e); }
  plein(x, y, z) { const s = this.lire(x, y, z); return !!s && s.every((e) => e && e.n >= pileMax(e.item)); }
  // signal du comparateur : floor(f x 14) + (au moins une pile ? 1 : 0), f = moyenne de n / min(pileMax, 64) sur tous les emplacements
  niveau(x, y, z) {
    const s = this.lire(x, y, z);
    if (!s) return 0;
    let f = 0, piles = 0;
    for (const e of s) if (e) { f += e.n / Math.min(64, pileMax(e.item)); piles++; }
    f /= s.length;
    return Math.floor(f * 14) + (piles > 0 ? 1 : 0);
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
