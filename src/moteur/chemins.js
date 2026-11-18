// Recherche de chemin du jeu : PathFinder (A* sur un tas binaire), Node, Path et les evaluateurs de noeuds WalkNodeEvaluator (marche, sauts,
// chutes, portes, clotures), SwimNodeEvaluator (nage, breche), FlyNodeEvaluator (vol, 26 voisins) et AmphibiousNodeEvaluator, regle pour regle.
// Port d'apres Horizon horizon-client/src/mobs/path.rs et nav.rs (MIT, voir ATTRIBUTIONS.md). Les types de chemin de chaque etat
// (WalkNodeEvaluator.getPathTypeFromState), les drapeaux isPathfindable et le haut des formes de collision viennent des donnees du jeu
// (table `chemins` : export mob-data du jeu 26.3). Nombres en flottants simples (Math.fround) la ou le jeu les a.
import { coupe } from './collision.js';

const f32 = Math.fround;
export const TYPES = ['BLOCKED', 'OPEN', 'WALKABLE', 'WALKABLE_DOOR', 'TRAPDOOR', 'POWDER_SNOW', 'ON_TOP_OF_POWDER_SNOW', 'FENCE', 'LAVA', 'WATER', 'WATER_BORDER', 'RAIL',
  'UNPASSABLE_RAIL', 'FIRE_IN_NEIGHBOR', 'FIRE', 'DAMAGING_IN_NEIGHBOR', 'DAMAGING', 'DOOR_OPEN', 'DOOR_WOOD_CLOSED', 'DOOR_IRON_CLOSED', 'BREACH', 'LEAVES', 'STICKY_HONEY', 'COCOA',
  'DAMAGE_CAUTIOUS', 'ON_TOP_OF_TRAPDOOR', 'BIG_MOBS_CLOSE_TO_DANGER'];   // ordre de declaration de PathType (EnumSet)
export const T = Object.fromEntries(TYPES.map((n, i) => [n, i]));
// PathType.getMalus par defaut
const MALUS = new Float32Array(TYPES.length);
for (const n of ['BLOCKED', 'POWDER_SNOW', 'FENCE', 'LAVA', 'UNPASSABLE_RAIL', 'DAMAGING', 'DOOR_WOOD_CLOSED', 'DOOR_IRON_CLOSED', 'LEAVES']) MALUS[T[n]] = -1;
for (const n of ['WATER', 'WATER_BORDER', 'FIRE_IN_NEIGHBOR', 'DAMAGING_IN_NEIGHBOR', 'STICKY_HONEY']) MALUS[T[n]] = 8;
MALUS[T.FIRE] = 16; MALUS[T.BREACH] = 4; MALUS[T.BIG_MOBS_CLOSE_TO_DANGER] = 4;
export const malusDefaut = (t) => MALUS[t];

const cleP = (x, y, z) => `${x},${y},${z}`;

// mob : { x, y, z (pieds), largeur, hauteur, auSol, dansEau, pas (maxUpStep), chute (getMaxFallDistance), malus: { NOM: valeur }, flotte (canFloat),
//         ouvrePortes, passePortes, surClotures (canWalkOverFences), lave (strider), grimpe (joueur : echelles et lianes) }
// eval : 'marche' | 'nage' | 'nage_breche' | 'vol' | 'amphibie' | 'amphibie_peu_profond'
export class Chercheur {
  constructor(lec, mob, eval_ = 'marche') {
    this.lec = lec; this.d = lec.d; this.mob = mob; this.ev = eval_;
    this.noeuds = []; this.index = new Map(); this.tas = [];
    this.types = new Map(); this.statiques = new Map(); this.collisions = new Map();
    this.L = Math.floor(mob.largeur + 1); this.H = Math.floor(mob.hauteur + 1); this.P = Math.floor(mob.largeur + 1);
    this.amph = this.ev.startsWith('amphibie');
    this.mal = new Float32Array(TYPES.length);
    for (let i = 0; i < TYPES.length; i++) this.mal[i] = mob.malus?.[TYPES[i]] ?? MALUS[i];
    if (this.amph) { this.mal[T.WATER] = 0; this.mal[T.WALKABLE] = 6; this.mal[T.WATER_BORDER] = 4; }   // AmphibiousNodeEvaluator.prepare
    this.bas = -64;   // Level.getMinY du monde (les cellules hors de la zone sont cachees : BLOCKED)
    this.lim = lec.limites ?? null;
    this.mp = [Math.floor(mob.x), Math.floor(mob.y), Math.floor(mob.z)];
  }
  malus(t) { return this.mal[t]; }
  // ---- monde
  etat(x, y, z) { return this.lec.etatEn(x, y, z); }
  typeEtat(x, y, z) {
    const l = this.lim;
    if (l && (x < l.x0 || x >= l.x1 || z < l.z0 || z >= l.z1)) return T.BLOCKED;   // hors de la boite du monde simule : inconnu, infranchissable
    const e = this.etat(x, y, z);
    return e < 0 ? T.BLOCKED : T[this.d.typeChemin(e)] ?? T.BLOCKED;
  }
  fluide(x, y, z) { const e = this.etat(x, y, z); if (e < 0) return 0; const f = this.d.fluide(e); return f === 1 || f === 2 ? 1 : f === 3 || f === 4 ? 2 : 0; }   // 1 eau, 2 lave
  air(x, y, z) { const e = this.etat(x, y, z); return e >= 0 && this.d.esAir(e); }
  haut(x, y, z) { const e = this.etat(x, y, z); return e < 0 ? 1 : this.d.hautCollision(e); }
  sol(x, y, z) { return y - 1 + this.haut(x, y - 1, z); }                         // WalkNodeEvaluator.getFloorLevel(level, pos)
  niveauSol(x, y, z) { return (this.mob.flotte || this.amph) && this.fluide(x, y, z) === 1 ? y + 0.5 : this.sol(x, y, z); }
  heurte(b) {
    const k = b.join(',');
    let v = this.collisions.get(k);
    if (v === undefined) { v = coupe(this.lec, b); this.collisions.set(k, v); }
    return v;
  }
  // ---- types de chemin
  voisinsDangereux(x, y, z, t) {   // WalkNodeEvaluator.checkNeighbourBlocks
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const v = this.typeEtat(x + dx, y + dy, z + dz);
      if (v === T.DAMAGING) return T.DAMAGING_IN_NEIGHBOR;
      if (v === T.FIRE || v === T.LAVA) return T.FIRE_IN_NEIGHBOR;
      if (v === T.WATER) return T.WATER_BORDER;
      if (v === T.DAMAGE_CAUTIOUS) return T.DAMAGE_CAUTIOUS;
    }
    return t;
  }
  typeMarche(x, y, z) {            // WalkNodeEvaluator.getPathTypeStatic
    const t = this.typeEtat(x, y, z);
    if (t !== T.OPEN || y <= this.bas) return t;
    switch (this.typeEtat(x, y - 1, z)) {
      case T.OPEN: case T.WATER: case T.LAVA: case T.WALKABLE: return T.OPEN;
      case T.FIRE: return T.FIRE;
      case T.DAMAGING: return T.DAMAGING;
      case T.STICKY_HONEY: return T.STICKY_HONEY;
      case T.POWDER_SNOW: return T.ON_TOP_OF_POWDER_SNOW;
      case T.DAMAGE_CAUTIOUS: return T.DAMAGE_CAUTIOUS;
      case T.TRAPDOOR: return T.ON_TOP_OF_TRAPDOOR;
      default: return this.voisinsDangereux(x, y, z, T.WALKABLE);
    }
  }
  typeVol(x, y, z) {               // FlyNodeEvaluator.getPathTypeStatic
    let t = this.typeEtat(x, y, z);
    if (t === T.OPEN && y > this.bas) {
      const b = this.typeEtat(x, y - 1, z);
      if (b === T.FIRE || b === T.LAVA) t = T.FIRE;
      else if (b === T.DAMAGING) t = T.DAMAGING;
      else if (b === T.COCOA) t = T.COCOA;
      else if (b === T.FENCE) t = x === this.mp[0] && y - 1 === this.mp[1] && z === this.mp[2] ? t : T.FENCE;
      else if (b === T.WALKABLE || b === T.OPEN || b === T.WATER) t = T.OPEN;
      else t = T.WALKABLE;
    }
    if (t === T.WALKABLE || t === T.OPEN) t = this.voisinsDangereux(x, y, z, t);
    return t;
  }
  typeChemin(x, y, z) {
    const k = cleP(x, y, z);
    let t = this.statiques.get(k);
    if (t !== undefined) return t;
    if (this.ev === 'vol') t = this.typeVol(x, y, z);
    else if (this.amph) {
      t = this.typeEtat(x, y, z);
      if (t === T.WATER) { for (const [dx, dy, dz] of [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]]) if (this.typeEtat(x + dx, y + dy, z + dz) === T.BLOCKED) { t = T.WATER_BORDER; break; } } else t = this.typeMarche(x, y, z);
    } else t = this.typeMarche(x, y, z);
    this.statiques.set(k, t);
    return t;
  }
  dansBoite(x, y, z) {
    const out = [], m = this.mob, mp = this.mp;
    for (let dx = 0; dx < this.L; dx++) for (let dy = 0; dy < this.H; dy++) for (let dz = 0; dz < this.P; dz++) {
      let t = this.typeChemin(x + dx, y + dy, z + dz);
      if (t === T.DOOR_WOOD_CLOSED && m.ouvrePortes && m.passePortes) t = T.WALKABLE_DOOR;
      if (t === T.DOOR_IRON_CLOSED && m.ouvrePortesFer && m.passePortes) t = T.WALKABLE_DOOR;   // joueur qui a de quoi ouvrir une porte en fer (regle portes.fer)
      if (t === T.DOOR_OPEN && !m.passePortes) t = T.BLOCKED;
      if (t === T.RAIL && this.typeChemin(mp[0], mp[1], mp[2]) !== T.RAIL && this.typeChemin(mp[0], mp[1] - 1, mp[2]) !== T.RAIL) t = T.UNPASSABLE_RAIL;
      if (!out.includes(t)) out.push(t);
    }
    return out;
  }
  typeNage(x, y, z) {              // SwimNodeEvaluator.getPathType
    let dernier = [x, y, z];
    for (let xx = x; xx < x + this.L; xx++) for (let yy = y; yy < y + this.H; yy++) for (let zz = z; zz < z + this.P; zz++) {
      const f = this.fluide(xx, yy, zz);
      if (f !== 1) {
        const eauDessous = () => { const e = this.etat(xx, yy - 1, zz); return e >= 0 && this.d.cheminPossible(e, 1); };
        return f === 0 && eauDessous() && this.air(xx, yy, zz) ? T.BREACH : T.BLOCKED;
      }
      dernier = [xx, yy, zz];
    }
    const e = this.etat(...dernier);
    return e >= 0 && this.d.cheminPossible(e, 1) ? T.WATER : T.BLOCKED;
  }
  typeMob(x, y, z) {               // WalkNodeEvaluator.getPathTypeOfMob
    if (this.ev.startsWith('nage')) return this.typeNage(x, y, z);
    const types = this.dansBoite(x, y, z).sort((a, b) => a - b);
    if (types.length === 1) return types[0];
    if (types.includes(T.FENCE)) return T.FENCE;
    if (types.includes(T.UNPASSABLE_RAIL)) return T.UNPASSABLE_RAIL;
    let haut = T.BLOCKED, hm = this.malus(haut);
    for (const t of types) { const m = this.malus(t); if (m < 0) return t; if (m >= hm) { hm = m; haut = t; } }
    const ici = this.typeChemin(x, y, z);
    if (this.L > 1) return this.malus(ici) < hm && this.malus(T.BIG_MOBS_CLOSE_TO_DANGER) < hm ? T.BIG_MOBS_CLOSE_TO_DANGER : haut;
    return ici === T.OPEN && haut !== T.OPEN && hm === 0 ? T.OPEN : haut;
  }
  cache(x, y, z) { const k = cleP(x, y, z); let t = this.types.get(k); if (t === undefined) { t = this.typeMob(x, y, z); this.types.set(k, t); } return t; }
  // ---- noeuds
  noeud(x, y, z) {
    const k = cleP(x, y, z);
    let i = this.index.get(k);
    if (i === undefined) { i = this.noeuds.length; this.noeuds.push({ x, y, z, tas: -1, g: 0, h: 0, f: 0, de: -1, ferme: false, marche: 0, malus: 0, type: T.BLOCKED }); this.index.set(k, i); }
    return i;
  }
  noeudDepart(x, y, z) { const n = this.noeud(x, y, z), t = this.cache(x, y, z), o = this.noeuds[n]; o.type = t; o.malus = this.malus(t); return n; }
  peutPartir(x, y, z) { const t = this.cache(x, y, z); return this.ev === 'vol' ? this.malus(t) >= 0 : t !== T.OPEN && this.malus(t) >= 0; }
  depart() {
    const m = this.mob, w = m.largeur / 2, lo = [m.x - w, m.y, m.z - w], hi = [m.x + w, m.y + m.hauteur, m.z + w];
    const bx = Math.floor(m.x), bz = Math.floor(m.z);
    const coins = () => [[lo[0], lo[2]], [lo[0], hi[2]], [hi[0], lo[2]], [hi[0], hi[2]]].map(([a, b]) => [Math.floor(a), Math.floor(b)]);
    if (this.ev.startsWith('nage')) return this.noeud(Math.floor(lo[0]), Math.floor(lo[1] + 0.5), Math.floor(lo[2]));
    if (this.amph && m.dansEau) return this.noeudDepart(Math.floor(lo[0]), Math.floor(lo[1] + 0.5), Math.floor(lo[2]));
    if (this.ev === 'vol') {
      let y;
      if (m.flotte && m.dansEau) { y = Math.floor(m.y); while (this.d.nomBloc(Math.max(0, this.etat(bx, y, bz))) === 'water' && this.etat(bx, y, bz) >= 0) y++; } else y = Math.floor(m.y + 0.5);
      if (!this.peutPartir(bx, y, bz)) { const by = Math.floor(m.y); for (const [cx, cz] of coins()) if (this.peutPartir(cx, by, cz)) return this.noeudDepart(cx, by, cz); }
      return this.noeudDepart(bx, y, bz);
    }
    let y = Math.floor(m.y);
    if (!(m.lave && this.fluide(bx, y, bz) === 2)) {
      if (m.flotte && this.fluide(bx, y, bz) === 1) { while (this.fluide(bx, y, bz) === 1) y++; y--; }
      else if (m.auSol) y = Math.floor(m.y + 0.5);
      else {
        let yy = Math.floor(m.y + 1);
        while (yy > this.bas) { y = yy; yy--; const e = this.etat(bx, yy, bz); if (e < 0 || (!this.d.esAir(e) && !this.d.cheminPossible(e, 0))) break; }
      }
    } else { while (m.lave && this.fluide(bx, y, bz) === 2) y++; y--; }
    if (!this.peutPartir(bx, y, bz)) for (const [cx, cz] of coins()) if (this.peutPartir(cx, y, cz)) return this.noeudDepart(cx, y, cz);
    return this.noeudDepart(bx, y, bz);
  }
  majMax(x, y, z, t, cout) { const n = this.noeud(x, y, z), o = this.noeuds[n]; o.type = t; o.malus = Math.max(o.malus, cout); return n; }
  bloque(x, y, z) { const n = this.noeud(x, y, z), o = this.noeuds[n]; o.type = T.BLOCKED; o.malus = -1; return n; }
  ferme(x, y, z, t) { const n = this.noeud(x, y, z), o = this.noeuds[n]; o.ferme = true; o.type = t; o.malus = MALUS[t]; return n; }
  hautSaut() { return Math.max(this.mob.pas, 1.125); }
  static partielle(t) { return t === T.FENCE || t === T.DOOR_WOOD_CLOSED || t === T.DOOR_IRON_CLOSED; }
  sansCollision(n) {               // WalkNodeEvaluator.canReachWithoutCollision
    const m = this.mob, o = this.noeuds[n], w = m.largeur / 2;
    let b = [m.x - w, m.y, m.z - w, m.x + w, m.y + m.hauteur, m.z + w];
    const taille = (m.largeur * 2 + m.hauteur) / 3;
    let d = [o.x - m.x + m.largeur / 2, o.y - m.y + m.hauteur / 2, o.z - m.z + m.largeur / 2];
    const L = Math.hypot(...d), n2 = Math.max(1, Math.ceil(L / taille));
    d = d.map((v) => v / n2);
    for (let i = 1; i <= n2; i++) { b = [b[0] + d[0], b[1] + d[1], b[2] + d[2], b[3] + d[0], b[4] + d[1], b[5] + d[2]]; if (this.heurte(b)) return false; }
    return true;
  }
  accepte(x, y, z, saut, hNoeud, dir, cur) {   // WalkNodeEvaluator.findAcceptedNode
    const maxY = this.niveauSol(x, y, z);
    if (maxY - hNoeud > this.hautSaut()) return null;
    const t = this.cache(x, y, z), cout = this.malus(t);
    let best = null;
    if (cout >= 0) best = this.majMax(x, y, z, t, cout);
    if (Chercheur.partielle(cur) && best !== null && this.noeuds[best].malus >= 0 && !this.sansCollision(best)) best = null;
    if (t === T.WALKABLE || (this.amph && t === T.WATER)) return best;
    const neg = best === null || this.noeuds[best].malus < 0;
    if (neg && saut > 0 && (t !== T.FENCE || this.mob.surClotures) && t !== T.UNPASSABLE_RAIL && t !== T.TRAPDOOR && t !== T.POWDER_SNOW) best = this.sautSur(x, y, z, saut, hNoeud, dir, cur);
    else if (!this.amph && t === T.WATER && !this.mob.flotte) best = this.premierHorsEau(x, y, z, best);
    else if (t === T.OPEN) best = this.premierSol(x, y, z);
    else if (Chercheur.partielle(t) && best === null) best = this.ferme(x, y, z, t);
    return best;
  }
  sautSur(x, y, z, saut, hNoeud, dir, cur) {
    const dessus = this.accepte(x, y + 1, z, saut - 1, hNoeud, dir, cur);
    if (dessus === null) return null;
    if (this.mob.largeur >= 1) return dessus;
    const a = this.noeuds[dessus];
    if (a.type !== T.OPEN && a.type !== T.WALKABLE) return dessus;
    const cx = x - dir[0] + 0.5, cz = z - dir[1] + 0.5, w = this.mob.largeur / 2;
    const b = [cx - w, this.niveauSol(Math.floor(cx), y + 1, Math.floor(cz)) + 0.001, cz - w, cx + w, this.mob.hauteur + this.niveauSol(a.x, a.y, a.z) - 0.002, cz + w];
    return this.heurte(b) ? null : dessus;
  }
  premierHorsEau(x, y, z, best) {
    for (y--; y > this.bas; y--) { const t = this.cache(x, y, z); if (t !== T.WATER) return best; best = this.majMax(x, y, z, t, this.malus(t)); }
    return best;
  }
  premierSol(x, y, z) {
    for (let cy = y - 1; cy >= this.bas; cy--) {
      if (y - cy > this.mob.chute) return this.bloque(x, cy, z);
      const t = this.cache(x, cy, z), c = this.malus(t);
      if (t !== T.OPEN) return c >= 0 ? this.majMax(x, cy, z, t, c) : this.bloque(x, cy, z);
    }
    return this.bloque(x, y, z);
  }
  voisinValide(n, cur) { if (n === null) return false; const o = this.noeuds[n]; return !o.ferme && (o.malus >= 0 || this.noeuds[cur].malus < 0); }
  diagPaire(p, ew, ns) {
    if (ew === null || ns === null) return false;
    const P = this.noeuds[p], E = this.noeuds[ew], N = this.noeuds[ns];
    if (N.y > P.y || E.y > P.y) return false;
    if (E.type === T.WALKABLE_DOOR || N.type === T.WALKABLE_DOOR) return false;
    if (this.mob.largeur > 1 && (E.malus > 0 || N.malus > 0)) return false;
    const poteaux = N.type === T.FENCE && E.type === T.FENCE && this.mob.largeur < 0.5;
    return (N.y < P.y || N.malus >= 0 || poteaux) && (E.y < P.y || E.malus >= 0 || poteaux);
  }
  diagValide(d) { if (d === null) return false; const o = this.noeuds[d]; return !o.ferme && o.type !== T.WALKABLE_DOOR && o.malus >= 0; }
  voisinsMarche(pos, out) {
    const { x: px, y: py, z: pz } = this.noeuds[pos];
    const dessus = this.cache(px, py + 1, pz), cur = this.cache(px, py, pz);
    let saut = 0;
    if (this.malus(dessus) >= 0 && cur !== T.STICKY_HONEY) saut = Math.floor(Math.max(1, this.mob.pas));
    const h = this.niveauSol(px, py, pz);
    // Direction.Plane.HORIZONTAL : nord, est, sud, ouest ; indice 2D sud 0, ouest 1, nord 2, est 3
    const DIRS = [[0, -1, 2], [1, 0, 3], [0, 1, 0], [-1, 0, 1]], par2d = [null, null, null, null];
    for (const [dx, dz, i2] of DIRS) { const n = this.accepte(px + dx, py, pz + dz, saut, h, [dx, dz], cur); par2d[i2] = n; if (this.voisinValide(n, pos)) out.push(n); }
    const HOR = { 2: 3, 3: 0, 0: 1, 1: 2 }, VEC = { 0: [0, 1], 1: [-1, 0], 2: [0, -1], 3: [1, 0] };
    for (const [dx, dz, i2] of DIRS) {
      const c = HOR[i2], [cdx, cdz] = VEC[c];
      if (this.diagPaire(pos, par2d[i2], par2d[c])) { const d = this.accepte(px + dx + cdx, py, pz + dz + cdz, saut, h, [dx, dz], cur); if (this.diagValide(d)) out.push(d); }
    }
    if (this.amph) {
      const haut = this.accepte(px, py + 1, pz, Math.max(0, saut - 1), h, [0, 0], cur), bas = this.accepte(px, py - 1, pz, saut, h, [0, 0], cur);
      if (this.voisinValide(haut, pos) && this.noeuds[haut].type === T.WATER) out.push(haut);
      if (this.voisinValide(bas, pos) && this.noeuds[bas].type === T.WATER && cur !== T.TRAPDOOR) out.push(bas);
      if (this.ev === 'amphibie_peu_profond') for (const n of out) { const o = this.noeuds[n]; if (o.type === T.WATER && o.y < 63 - 10) o.malus = f32(o.malus + 1); }
    }
    if (this.mob.grimpe) this.voisinsEchelle(pos, out);
  }
  // Joueur (pas un mob du jeu) : il monte et descend les echelles, lianes et echafaudages (#minecraft:climbable : LivingEntity.onClimbable)
  voisinsEchelle(pos, out) {
    const { x, y, z } = this.noeuds[pos], g = this.mob.grimpe;
    for (const [y2, ok] of [[y + 1, g(x, y, z) || g(x, y + 1, z)], [y - 1, g(x, y - 1, z)]]) {
      if (!ok) continue;
      const w = this.mob.largeur / 2;
      if (this.heurte([x + 0.5 - w + 1e-3, y2 + 1e-3, z + 0.5 - w + 1e-3, x + 0.5 + w - 1e-3, y2 + this.mob.hauteur - 1e-3, z + 0.5 + w - 1e-3])) continue;
      const n = this.noeud(x, y2, z), o = this.noeuds[n];
      if (o.ferme) continue;
      o.type = T.WALKABLE; o.malus = Math.max(o.malus, 0); o.echelle = y2 > y ? 1 : -1;
      out.push(n);
    }
  }
  nageAccepte(x, y, z) {
    const t = this.cache(x, y, z);
    if ((this.ev === 'nage_breche' && t === T.BREACH) || t === T.WATER) {
      const c = this.malus(t);
      if (c >= 0) { const n = this.majMax(x, y, z, t, c); if (this.fluide(x, y, z) === 0) this.noeuds[n].malus = f32(this.noeuds[n].malus + 8); return n; }
    }
    return null;
  }
  voisinsNage(pos, out) {
    const { x: px, y: py, z: pz } = this.noeuds[pos];
    const ouvert = (n) => n !== null && !this.noeuds[n].ferme, mal = (n) => n !== null && this.noeuds[n].malus >= 0;
    const D = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]], par = [];
    for (const [dx, dy, dz] of D) { const n = this.nageAccepte(px + dx, py + dy, pz + dz); par.push(n); if (ouvert(n)) out.push(n); }
    for (const [a, b, dx, dz, cx, cz] of [[2, 5, 0, -1, 1, 0], [5, 3, 1, 0, 0, 1], [3, 4, 0, 1, -1, 0], [4, 2, -1, 0, 0, -1]]) {
      if (mal(par[a]) && mal(par[b])) { const d = this.nageAccepte(px + dx + cx, py, pz + dz + cz); if (ouvert(d)) out.push(d); }
    }
  }
  volAccepte(x, y, z) {
    const t = this.cache(x, y, z), c = this.malus(t);
    if (c < 0) return null;
    const n = this.majMax(x, y, z, t, c);
    if (t === T.WALKABLE) this.noeuds[n].malus = f32(this.noeuds[n].malus + 1);
    return n;
  }
  voisinsVol(pos, out) {
    const { x: px, y: py, z: pz } = this.noeuds[pos];
    const f = (dx, dy, dz) => this.volAccepte(px + dx, py + dy, pz + dz);
    const ouvert = (n) => n !== null && !this.noeuds[n].ferme, m = (n) => n !== null && this.noeuds[n].malus >= 0;
    const push = (n, ok) => { if (ouvert(n) && ok) out.push(n); };
    const S = f(0, 0, 1), W = f(-1, 0, 0), E = f(1, 0, 0), N = f(0, 0, -1), U = f(0, 1, 0), Dn = f(0, -1, 0);
    for (const n of [S, W, E, N, U, Dn]) if (ouvert(n)) out.push(n);
    const SU = f(0, 1, 1); push(SU, m(S) && m(U));
    const WU = f(-1, 1, 0); push(WU, m(W) && m(U));
    const EU = f(1, 1, 0); push(EU, m(E) && m(U));
    const NU = f(0, 1, -1); push(NU, m(N) && m(U));
    const SD = f(0, -1, 1); push(SD, m(S) && m(Dn));
    const WD = f(-1, -1, 0); push(WD, m(W) && m(Dn));
    const ED = f(1, -1, 0); push(ED, m(E) && m(Dn));
    const ND = f(0, -1, -1); push(ND, m(N) && m(Dn));
    const NE = f(1, 0, -1); push(NE, m(N) && m(E));
    const SE = f(1, 0, 1); push(SE, m(S) && m(E));
    const NW = f(-1, 0, -1); push(NW, m(N) && m(W));
    const SW = f(-1, 0, 1); push(SW, m(S) && m(W));
    push(f(1, 1, -1), m(NE) && m(N) && m(E) && m(U) && m(NU) && m(EU));
    push(f(1, 1, 1), m(SE) && m(S) && m(E) && m(U) && m(SU) && m(EU));
    push(f(-1, 1, -1), m(NW) && m(N) && m(W) && m(U) && m(NU) && m(WU));
    push(f(-1, 1, 1), m(SW) && m(S) && m(W) && m(U) && m(SU) && m(WU));
    push(f(1, -1, -1), m(NE) && m(N) && m(E) && m(Dn) && m(ND) && m(ED));
    push(f(1, -1, 1), m(SE) && m(S) && m(E) && m(Dn) && m(SD) && m(ED));
    push(f(-1, -1, -1), m(NW) && m(N) && m(W) && m(Dn) && m(ND) && m(WD));
    push(f(-1, -1, 1), m(SW) && m(S) && m(W) && m(Dn) && m(SD) && m(WD));
  }
  // ---- tas binaire du jeu (BinaryHeap)
  inserer(n) { const i = this.tas.length; this.tas.push(n); this.noeuds[n].tas = i; this.monter(i); }
  extraire() {
    const p = this.tas[0], d = this.tas.pop();
    if (this.tas.length) { this.tas[0] = d; this.noeuds[d].tas = 0; this.descendre(0); }
    this.noeuds[p].tas = -1;
    return p;
  }
  changer(n, c) { const o = this.noeuds[n], v = o.f; o.f = c; if (c < v) this.monter(o.tas); else this.descendre(o.tas); }
  monter(i) {
    const n = this.tas[i], c = this.noeuds[n].f;
    while (i > 0) { const pi = (i - 1) >> 1, p = this.tas[pi]; if (c >= this.noeuds[p].f) break; this.tas[i] = p; this.noeuds[p].tas = i; i = pi; }
    this.tas[i] = n; this.noeuds[n].tas = i;
  }
  descendre(i) {
    const n = this.tas[i], c = this.noeuds[n].f, s = this.tas.length;
    for (;;) {
      const li = 1 + (i << 1), ri = li + 1;
      if (li >= s) break;
      const l = this.tas[li], lc = this.noeuds[l].f;
      const [r, rc] = ri >= s ? [-1, Infinity] : [this.tas[ri], this.noeuds[this.tas[ri]].f];
      if (lc < rc) { if (lc >= c) break; this.tas[i] = l; this.noeuds[l].tas = i; i = li; } else { if (rc >= c) break; this.tas[i] = r; this.noeuds[r].tas = i; i = ri; }
    }
    this.tas[i] = n; this.noeuds[n].tas = i;
  }
  static distance(a, x, y, z) { const dx = f32(x - a.x), dy = f32(y - a.y), dz = f32(z - a.z); return f32(Math.sqrt(f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(dz * dz)))); }
  // ---- PathFinder.findPath : cibles [[x, y, z]], longueur maximale (followRange), portee d'arrivee (accuracy), noeuds visites au plus
  trouver(cibles, maxLong, portee, maxVisites) {
    const de = this.depart();
    const C = cibles.map((p) => { const n = this.noeuds[this.noeud(p[0], p[1], p[2])]; return { x: n.x, y: n.y, z: n.z, bestH: Infinity, best: -1, atteinte: false, pos: p }; });
    const bestH = (n) => { let b = Infinity; const o = this.noeuds[n]; for (const t of C) { const h = Chercheur.distance(o, t.x, t.y, t.z); if (h < t.bestH) { t.bestH = h; t.best = n; } b = Math.min(b, h); } return b; };
    const D = this.noeuds[de];
    D.g = 0; D.h = bestH(de); D.f = D.h;
    this.tas.length = 0; this.inserer(de);
    let compte = 0;
    const V = [];
    while (this.tas.length) {
      if (++compte >= maxVisites) break;
      const cur = this.extraire(), c = this.noeuds[cur];
      c.ferme = true;
      let fini = false;
      for (const t of C) if (Math.abs(t.x - c.x) + Math.abs(t.y - c.y) + Math.abs(t.z - c.z) <= portee) { t.atteinte = true; fini = true; }
      if (fini) break;
      if (Chercheur.distance(c, D.x, D.y, D.z) >= maxLong) continue;
      V.length = 0;
      if (this.ev === 'vol') this.voisinsVol(cur, V); else if (this.ev.startsWith('nage')) this.voisinsNage(cur, V); else this.voisinsMarche(cur, V);
      for (const nb of V) {
        const o = this.noeuds[nb], dist = Chercheur.distance(o, c.x, c.y, c.z);
        o.marche = f32(c.marche + dist);
        const tent = f32(f32(c.g + dist) + o.malus), dansTas = o.tas >= 0;
        if (o.marche < maxLong && (!dansTas || tent < o.g)) {
          o.de = cur; o.g = tent; o.h = f32(bestH(nb) * 1.5);
          if (dansTas) this.changer(nb, f32(tent + o.h)); else { o.f = f32(tent + o.h); this.inserer(nb); }
        }
      }
    }
    const construire = (t, atteint) => {
      if (t.best < 0) return null;
      const L = [];
      for (let n = t.best; n >= 0; n = this.noeuds[n].de) { const o = this.noeuds[n]; L.push({ x: o.x, y: o.y, z: o.z, type: o.type, echelle: o.echelle ?? 0 }); }
      L.reverse();
      const fin = L[L.length - 1];
      return { noeuds: L, cible: t.pos, atteint, distCible: Math.abs(fin.x - t.pos[0]) + Math.abs(fin.y - t.pos[1]) + Math.abs(fin.z - t.pos[2]), visites: compte };
    };
    const atteintes = C.filter((t) => t.atteinte);
    const ch = (atteintes.length ? atteintes.map((t) => construire(t, true)) : C.map((t) => construire(t, false))).filter(Boolean);
    if (!ch.length) return null;
    return atteintes.length ? ch.reduce((a, b) => (b.noeuds.length < a.noeuds.length ? b : a)) : ch.reduce((a, b) => (b.distCible < a.distCible || (b.distCible === a.distCible && b.noeuds.length < a.noeuds.length) ? b : a));
  }
}

// GroundPathNavigation.findSurfacePosition : cible dans l'air -> le premier bloc non vide dessous (sinon au-dessus) ; cible dans un bloc solide (isSolid) -> au-dessus
export function positionSurface(lec, p) {
  const d = lec.d, bas = lec.limites?.y0 ?? -64;
  const air = (q) => { const e = lec.etatEn(q[0], q[1], q[2]); return e >= 0 && d.esAir(e); };
  const solide = (q) => { const e = lec.etatEn(q[0], q[1], q[2]); return e < 0 || d.estSolide(e); };
  p = p.slice();
  if (air(p)) {
    const q = [p[0], p[1] - 1, p[2]];
    while (q[1] >= bas && air(q)) q[1]--;
    if (q[1] >= bas) return [q[0], q[1] + 1, q[2]];
    q[1] = p[1] + 1;
    while (q[1] <= 319 && air(q)) q[1]++;
    p = q;
  }
  if (!solide(p)) return p;
  const q = [p[0], p[1] + 1, p[2]];
  while (q[1] <= 319 && solide(q)) q[1]++;
  return q;
}

// Path.getEntityPosAtNode et hauteur visee par MoveControl (GroundPathNavigation : le sol du noeud si le bloc dessous n'est pas de l'air)
export function pointDeNoeud(lec, n, largeur, sol = true) {
  const k = Math.floor(largeur + 1) * 0.5;
  let y = n.y;
  if (sol) { const e = lec.etatEn(n.x, n.y - 1, n.z); if (!(e >= 0 && lec.d.esAir(e))) y = n.y - 1 + (e < 0 ? 1 : lec.d.hautCollision(e)); }
  return [n.x + k, y, n.z + k];
}
