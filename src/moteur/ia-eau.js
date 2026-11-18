// Nage dirigee (champ `ia: true`), melangee a la classe IA de ia.js : poissons (morue, saumon, poisson tropical, poisson-globe, tetard) et leurs
// bancs, calmars (propulsion par les tentacules), dauphins (nage rapide, sauts hors de l'eau, air), axolotls (fait le mort), tortues dans l'eau,
// gardiens et gardiens anciens (laser charge, fatigue minière). Chemins en 3D dans l'eau (WaterBoundPathNavigation, compacte : ligne droite si
// elle reste dans l'eau, sinon A* sur les cellules d'eau, 26 voisins).
// Port d'apres Horizon (MIT, voir ATTRIBUTIONS.md) : mobs/aquatic.rs (FishMoveControl, AbstractFish.travel 0,01 / x 0,9 / -0,005, bancs
// FollowFlockLeader 8 / 5, Squid.aiStep et SquidRandomMovement, SmoothSwimmingMoveControl 85 / 10 / 0,02 ou 0,1), mobs/dolphin.rs (saut,
// air 4800), mobs/axolotl.rs, mobs/turtle.rs (TurtleMoveControl), mobs/guardian.rs (GuardianAttackGoal 80 / 60 ticks, degats 1 + 2 + 2 de
// magie puis le coup, GuardianMoveControl, sauts sur la terre, malediction de l'ancien toutes les 1200 ticks a 50 blocs).
import { coupe, deplacerBoite } from './collision.js';
import { blocSous, vitesseApresContact } from './rebond.js';

const RAD = Math.PI / 180, MOVE = 1, LOOK = 2;
const wrap = (a) => { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; };
const rotlerp = (de, vers, max) => de + Math.max(-max, Math.min(max, wrap(vers - de)));
const journal = (sim, t) => (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${t}`);
export const NAGEURS = new Set(['poisson', 'calmar', 'dauphin', 'axolotl', 'gardien']);
const BANC = { cod: 8, tropical_fish: 8, salmon: 5 };   // AbstractSchoolingFish.getMaxSchoolSize
// SmoothSwimmingMoveControl (dans l'eau, hors de l'eau) ; les poissons ont FishMoveControl, les gardiens GuardianMoveControl
const LISSE = { dauphin: [0.02, 0.1], axolotl: [0.1, 0.5] };

// ---------------------------------------------------------------- l'eau
export function eauEn(sim, x, y, z) { return sim.fluide(Math.floor(x), Math.floor(y), Math.floor(z)).type === 'water'; }
function nageable(sim, lec, x, y, z) { return eauEn(sim, x, y, z) && !coupe(lec, [Math.floor(x) + 0.3, Math.floor(y) + 0.05, Math.floor(z) + 0.3, Math.floor(x) + 0.7, Math.floor(y) + 0.6, Math.floor(z) + 0.7]); }
export function segmentEau(sim, lec, p, q) {
  const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), n = Math.max(1, Math.ceil(d / 0.4));
  for (let i = 1; i <= n; i++) { const f = i / n; if (!eauEn(sim, p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f)) return false; }
  return true;
}
// A* sur les cellules d'eau (26 voisins) ; rend des points (centres) ou []
export function cheminEau(sim, lec, de, vers, max = 1200) {
  const cle = (x, y, z) => `${x},${y},${z}`, h = (x, y, z) => Math.hypot(x - vers[0], y - vers[1], z - vers[2]);
  const s = de.map(Math.floor), b = vers.map(Math.floor);
  const ouv = [{ c: s, g: 0, f: h(...s) }], vus = new Map([[cle(...s), null]]), g = new Map([[cle(...s), 0]]);
  let n = 0, fin = null, meil = { c: s, f: h(...s) };
  while (ouv.length && n++ < max) {
    let k = 0; for (let i = 1; i < ouv.length; i++) if (ouv[i].f < ouv[k].f) k = i;
    const o = ouv.splice(k, 1)[0], [x, y, z] = o.c;
    if (x === b[0] && y === b[1] && z === b[2]) { fin = o.c; break; }
    if (h(x, y, z) < meil.f) meil = { c: o.c, f: h(x, y, z) };
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dy && !dz) continue;
      const nx = x + dx, ny = y + dy, nz = z + dz, kk = cle(nx, ny, nz), ng = o.g + Math.hypot(dx, dy, dz);
      if ((g.get(kk) ?? Infinity) <= ng || !nageable(sim, lec, nx, ny, nz)) continue;
      g.set(kk, ng); vus.set(kk, o.c); ouv.push({ c: [nx, ny, nz], g: ng, f: ng + h(nx, ny, nz) });
    }
  }
  const pts = [];
  for (let c = fin ?? meil.c; c; c = vus.get(cle(...c))) pts.unshift([c[0] + 0.5, c[1] + 0.2, c[2] + 0.5]);
  if (fin) pts[pts.length - 1] = vers.slice();
  const l = [pts[0]];
  for (let i = 1; i < pts.length; i++) { if (i + 1 < pts.length && segmentEau(sim, lec, l[l.length - 1], pts[i + 1])) continue; l.push(pts[i]); }
  return l.slice(1);
}

export const METHODES_EAU = {
  initEau(d) {
    const f = this.pr.fam;
    // SmoothSwimmingMoveControl hors de l'eau : vitesse x 0,1 (grenouille, dauphin, tetard) ou x 0,5 (axolotl) ; dans l'eau, l'attribut plein
    const sol = { frog: 0.1, dolphin: 0.1, tadpole: 0.1, axolotl: 0.5 }[this.type];
    if (sol) { this.attrEau = this.attr; this.attr *= sol; }
    this.nage = NAGEURS.has(f) || this.type === 'turtle';
    if (!this.nage) return;
    this.vitNage = 0; this.tangageNage = 0; this.navEau = null;
    if (f === 'calmar') { const h = this.h; this.tent = { mvt: 0, vit: 1 / (h.flottant() + 1) * 0.2, angle: 0, rot: 0, xRot: 0, zRot: 0, oisif: 0 }; this.vecteur = [0, 0, 0]; }
    if (f === 'dauphin') this.a.air = 4800;
    if (f === 'gardien') { this.laser = null; this.maisonGardien = [this.a.x, this.a.y, this.a.z]; }
    if (BANC[this.type]) { this.chef = null; this.suiveurs = 0; this.bancDans = 200 + this.h.entierBorne(200) % 20; }
    if (this.type === 'pufferfish') { this.gonflement = 0; this.compteGonfle = 0; this.compteDegonfle = 0; }
    if (this.type === 'axolotl') this.mortJouee = 0;
    void d;
  },
  installerEau(add) {
    switch (this.pr.fam) {
      case 'poisson': add(0, 'panique', MOVE); add(2, 'evite', MOVE); add(4, 'nageHasard', MOVE); if (BANC[this.type]) add(5, 'banc', 0); return true;
      case 'calmar': add(0, 'calmarHasard', 0); add(1, 'calmarFuite', 0); return true;
      case 'dauphin': add(0, 'respire', MOVE); add(2, 'nageAvecJoueur', MOVE | LOOK); add(4, 'nageHasard', MOVE); add(4, 'regardeAutour', LOOK); add(5, 'regardeJoueur', LOOK); add(5, 'dauphinSaut', MOVE | 4); add(6, 'nageAttaque', MOVE | LOOK); return true;
      case 'axolotl': add(0, 'faitLeMort', MOVE | LOOK); add(1, 'panique', MOVE); add(4, 'nageHasard', MOVE); add(8, 'regardeJoueur', LOOK); return true;
      case 'gardien': add(4, 'gardienLaser', MOVE | LOOK); add(7, 'nageHasard', MOVE); add(8, 'regardeJoueur', LOOK); add(9, 'regardeAutour', LOOK); return true;
      default: return false;
    }
  },

  // ---- navigation dans l'eau -------------------------------------------------------------------------------------------------------
  nageVers(x, y, z, mod, recalcul = 20) {
    const a = this.a, sim = this.sim, n = this.navEau;
    if (n && sim.temps < n.prochain && Math.hypot(n.but[0] - x, n.but[1] - y, n.but[2] - z) < 1) { n.mod = mod; return; }
    const de = [a.x, a.y + a.H / 2, a.z], vers = [x, y, z];
    const chemin = segmentEau(sim, a.lec, de, vers) ? [vers] : cheminEau(sim, a.lec, de, vers);
    this.navEau = { but: vers, chemin, i: 0, mod, prochain: sim.temps + recalcul };
  },
  nageFinie() { return !this.navEau || this.navEau.i >= this.navEau.chemin.length; },
  // le point voulu du controle de deplacement (MoveControl.wantedX/Y/Z) ou null
  vouluEau() {
    const n = this.navEau, a = this.a;
    if (!n) return null;
    while (n.i < n.chemin.length) { const w = n.chemin[n.i]; if (Math.hypot(w[0] - a.x, w[1] - a.y - a.H / 2, w[2] - a.z) < Math.max(0.6, a.L)) n.i++; else break; }
    return n.i < n.chemin.length ? n.chemin[n.i] : null;
  },
  // BehaviorUtils.getRandomSwimmablePos(mob, 10, 7) : 10 essais, une cellule d'eau a +-10 et +-7
  pointNage(rh = 10, rv = 7, base = null) {
    const a = this.a, h = this.h, o = base ?? [a.x, a.y, a.z];
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(o[0]) + h.entierBorne(2 * rh + 1) - rh, y = Math.floor(o[1]) + h.entierBorne(2 * rv + 1) - rv, z = Math.floor(o[2]) + h.entierBorne(2 * rv + 1) - rv;
      if (nageable(this.sim, a.lec, x, y, z)) return [x + 0.5, y + 0.3, z + 0.5];
    }
    return null;
  },

  // ---- buts -------------------------------------------------------------------------------------------------------------------
  // RandomSwimmingGoal : poissons 1 sur 40, dauphins 1 sur 10, gardiens 1 sur 80 (ancien 400), axolotls (RandomStroll.swim 0,5)
  peut_nageHasard() {
    const a = this.a, f = this.pr.fam;
    if (!a.dansEau || this.chef || this.mortJouee > 0) return false;
    const k = f === 'dauphin' ? 10 : f === 'gardien' ? (this.type === 'elder_guardian' ? 400 : 80) : f === 'axolotl' ? 120 : 40;
    if (this.h.entierBorne(k) !== 0) return false;
    const p = this.type === 'elder_guardian' ? this.pointNage(10, 7, this.maisonGardien) : this.pointNage();
    if (!p) return false;
    this.butNage = p; return true;
  },
  continue_nageHasard() { return !this.nageFinie() && this.a.dansEau; },
  debut_nageHasard() { this.nageVers(...this.butNage, this.pr.fam === 'axolotl' ? 0.5 : 1.0, 1e9); },
  tick_nageHasard() {},
  fin_nageHasard() { this.navEau = null; },
  // FollowFlockLeaderGoal : un poisson sans banc, toutes les 10 s environ, rejoint un banc proche qui a de la place (8 blocs) ou rassemble
  // les poissons libres autour de lui ; un suiveur nage vers son chef toutes les 10 ticks tant qu'il est a 11 blocs
  peut_banc() {
    if (this.suiveurs > 0) return false;
    if (this.chef && this.chef.mort < 0) return true;
    if (--this.bancDans > 0) return false;
    this.bancDans = 200 + this.h.entierBorne(200) % 20;
    const max = BANC[this.type], a = this.a;
    const pres = this.sim.acteurs.liste.filter((o) => o.ia?.type === this.type && o.mort < 0 && Math.abs(o.x - a.x) <= 8 + a.L && Math.abs(o.y - a.y) <= 8 + a.H && Math.abs(o.z - a.z) <= 8 + a.L);
    const chef = pres.find((o) => o.ia.suiveurs > 0 && o.ia.suiveurs + 1 < max)?.ia ?? this;
    let place = Math.max(0, max - (chef.suiveurs + 1));
    for (const o of pres) { if (place <= 0) break; if (o.ia === chef || (o.ia.chef && o.ia.chef.mort < 0)) continue; o.ia.chef = chef.a; chef.suiveurs++; place--; }
    if (chef.suiveurs > 0 && chef === this) journal(this.sim, `${a.nom} mene un banc de ${chef.suiveurs + 1}`);
    return !!this.chef;
  },
  continue_banc() { const c = this.chef; return !!c && c.mort < 0 && this.dist2(c) <= 121; },
  debut_banc() { this.recalculBanc = 0; },
  fin_banc() { const c = this.chef; if (c?.ia) c.ia.suiveurs = Math.max(0, c.ia.suiveurs - 1); this.chef = null; },
  tick_banc() { if (--this.recalculBanc > 0) return; this.recalculBanc = 10; const c = this.chef; this.nageVers(c.x, c.y + c.H / 2, c.z, 1.0, 10); },

  // calmar : SquidRandomMovementGoal (plus de 100 ticks sans rien : arret ; sinon 1 sur 50, ou hors de l'eau, ou sans vecteur : un nouveau
  // vecteur (cos, -0,1 + [0, 0,2[, sin) x 0,2) et SquidFleeGoal (frappe, dans l'eau, l'attaquant a 10 blocs : fuite jusqu'a 3 blocs / 20 par tick)
  peut_calmarHasard() { return true; },
  continue_calmarHasard() { return true; },
  tick_calmarHasard() {
    const T = this.tent, h = this.h, v = this.vecteur;
    if (T.oisif > 100) this.vecteur = [0, 0, 0];
    else if (h.entierBorne(50) === 0 || !this.a.dansEau || (!v[0] && !v[1] && !v[2])) { const f = h.flottant() * Math.PI * 2; this.vecteur = [Math.cos(f) * 0.2, -0.1 + h.flottant() * 0.2, Math.sin(f) * 0.2]; }
  },
  peut_calmarFuite() { const o = this.blessePar; return !!o && o.mort < 0 && this.a.dansEau && this.sim.temps - this.blesseTick < 100 && this.dist2(o) < 100; },
  continue_calmarFuite() { return this.peut_calmarFuite() && (this.fuiteT ?? 0) < 100; },
  debut_calmarFuite() { this.fuiteT = 0; },
  tick_calmarFuite() {
    const a = this.a, o = this.blessePar; this.fuiteT++;
    let v = [a.x - o.x, a.y - o.y, a.z - o.z];
    const air = !eauEn(this.sim, a.x + v[0], a.y + v[1], a.z + v[2]) && !coupe(a.lec, [a.x + v[0] - 0.1, a.y + v[1], a.z + v[2] - 0.1, a.x + v[0] + 0.1, a.y + v[1] + 0.2, a.z + v[2] + 0.1]);
    if (eauEn(this.sim, a.x + v[0], a.y + v[1], a.z + v[2]) || air) {
      const d0 = Math.hypot(...v);
      if (d0 > 0) { let d1 = 3; if (d0 > 5) d1 -= (d0 - 5) / 5; v = d1 > 0 ? v.map((c) => c / d0 * d1) : v.map((c) => c / d0); }
      if (air) v[1] = 0;
      this.vecteur = v.map((c) => c / 20);
    }
    if (this.fuiteT % 10 === 5) this.sim.particule('bubble', a.x, a.y, a.z, 0, 0, 0, 1);
  },

  // dauphin : BreathAirGoal (moins de 140 d'air : il monte respirer a la surface), DolphinJumpGoal, MeleeAttack 1,2 (frappe)
  peut_respire() { return this.a.air < 140; },
  continue_respire() { return this.a.air < 4800 && this.peut_surface(); },
  peut_surface() { return true; },
  tick_respire() {
    const a = this.a; let y = Math.floor(a.y);
    while (y < a.y + 16 && eauEn(this.sim, a.x, y, a.z)) y++;
    this.nageVers(a.x, y + 0.2, a.z, 1.0, 10);
  },
  peut_dauphinSaut() {
    const a = this.a, sim = this.sim;
    if (!a.dansEau || this.h.entierBorne(5) !== 0) return false;
    const vh = Math.hypot(a.vx, a.vz); if (vh < 0.05) return false;
    const sx = Math.abs(a.vx) >= Math.abs(a.vz) ? Math.sign(a.vx) : 0, sz = sx ? 0 : Math.sign(a.vz), X = Math.floor(a.x), Y = Math.floor(a.y), Z = Math.floor(a.z);
    for (const k of [0, 1, 4, 5, 6, 7]) {
      if (!eauEn(sim, X + sx * k + 0.5, Y + 0.5, Z + sz * k + 0.5)) return false;
      for (const dy of [1, 2]) { const e = sim.monde.etatEn(X + sx * k, Y + dy, Z + sz * k); if (e < 0 || !/air$/.test(sim.d.nomBloc(e))) return false; }
    }
    this.sautDir = [sx, sz]; return true;
  },
  continue_dauphinSaut() { const a = this.a; return a.vy * a.vy >= 0.03 || !a.dansEau; },
  debut_dauphinSaut() { const a = this.a; a.vx += this.sautDir[0] * 0.6; a.vy += 0.7; a.vz += this.sautDir[1] * 0.6; this.navEau = null; this.stat('sautsDauphin'); journal(this.sim, `${a.nom} saute hors de l eau`); this.sim.son('entity.dolphin.jump', a.x, a.y, a.z, 1, 1); },
  tick_dauphinSaut() { const a = this.a, h = Math.hypot(a.vx, a.vz); this.tangageNage = a.vy * a.vy < 0.03 && this.tangageNage ? rotlerp(this.tangageNage, 0, 0.2) : -Math.atan2(a.vy, h) / RAD; },
  fin_dauphinSaut() { this.tangageNage = 0; },
  // DolphinSwimWithPlayerGoal(4,0) (Horizon mobs/dolphin.rs `SwimWithPlayer`) : un joueur qui NAGE (course dans l'eau, Player.isSwimming) a
  // 10 blocs (sans ligne de vue) et pas sa cible : Grace du dauphin 100 ticks au debut ; chaque tick, il regarde ses yeux, s'arrete a moins de
  // 2,5 blocs, sinon nage vers lui a 4,0 ; 1 fois sur 6 tant qu'il nage : la grace est rendue ; fin quand le joueur ne nage plus ou est a
  // 16 blocs
  peut_nageAvecJoueur() {
    if (!this.a.dansEau) return false;
    const j = this.joueursProches(10).find((o) => o.nageant && o.mort < 0);
    if (!j || this.cible === j) return false;
    this.joueurNage = j; return true;
  },
  continue_nageAvecJoueur() { const j = this.joueurNage; return !!j && j.mort < 0 && !!j.nageant && this.dist2(j) < 256; },
  debut_nageAvecJoueur() { this.graceDauphin(); this.stat('nagesAvecJoueur'); journal(this.sim, `${this.a.nom} nage avec ${this.joueurNage.nom} (grace du dauphin)`); },
  fin_nageAvecJoueur() { this.navEau = null; this.joueurNage = null; },
  tick_nageAvecJoueur() {
    const j = this.joueurNage; this.regarder(j);
    if (this.dist2(j) < 6.25) this.navEau = null; else this.nageVers(j.x, j.y + 0.2, j.z, 4.0, 5);
    if (j.nageant && this.h.entierBorne(6) === 0) this.graceDauphin();
  },
  graceDauphin() { const j = this.joueurNage; if (j && !j.niveauEffet('dolphins_grace')) this.stat('graces'); j?.appliquerEffet('dolphins_grace', 100, 0); },
  peut_nageAttaque() { return !!this.cible && this.cible.mort < 0; },
  continue_nageAttaque() { return this.peut_nageAttaque(); },
  tick_nageAttaque() {
    const o = this.cible; this.regarder(o);
    this.nageVers(o.x, o.y + o.H / 2, o.z, 1.2, 4);
    if (this.prochaineAttaque > 0) this.prochaineAttaque--;
    if (this.auContact(o) && this.prochaineAttaque <= 0) { this.prochaineAttaque = 20; this.frapper(o); }
  },
  // axolotl : PlayDead (200 ticks, Regeneration 200) quand il est blesse dans l'eau : 1 sur 3, et (nextInt(3) < degats ou moins de la moitie
  // de sa vie), degats < vie, avec un attaquant
  peut_faitLeMort() { return this.mortJouee > 0; },
  continue_faitLeMort() { return this.mortJouee > 0; },
  tick_faitLeMort() { this.mortJouee--; this.navEau = null; this.a.vx *= 0.9; this.a.vz *= 0.9; },
  // gardien : GuardianAttackGoal : cible a plus de 3 blocs (ancien : toute distance), visible ; -10 puis le rayon 80 ticks (ancien 60) ;
  // degats de magie 1 (+2 en difficile, +2 ancien) puis son coup (attack_damage 6 / 8) ; la cible est oubliee
  peut_gardienLaser() { return !!this.cible && this.cible.mort < 0; },
  continue_gardienLaser() { return this.peut_gardienLaser() && (this.type === 'elder_guardian' || this.dist2(this.cible) > 9); },
  debut_gardienLaser() { this.laser = { t: -10 }; this.navEau = null; },
  fin_gardienLaser() { this.laser = null; this.cible = null; },
  tick_gardienLaser() {
    const a = this.a, o = this.cible, sim = this.sim, L = this.laser;
    this.navEau = null; this.regarder(o); a.lacet = rotlerp(a.lacet, Math.atan2(-(o.x - a.x), o.z - a.z) / RAD, 90);
    if (!this.voit(o)) { this.cible = null; return; }
    L.t++;
    const duree = this.type === 'elder_guardian' ? 60 : 80;
    if (L.t === 0) { sim.son('entity.guardian.attack', a.x, a.y, a.z, 1, 1); this.stat('lasers'); journal(sim, `${a.nom} vise ${o.nom} au laser`); }
    if (L.t >= 0) sim.replay.trait(sim.temps, 'laser', [a.x, a.y + a.O, a.z], [o.x, o.y + o.O, o.z], Math.min(1, L.t / duree));
    if (L.t >= duree) {
      const q = 1 + (this.difficulte() >= 3 ? 2 : 0) + (this.type === 'elder_guardian' ? 2 : 0);
      o.frappe(q, 'magie', a.x - o.x, a.z - o.z, 0);
      this.frapper(o);
      journal(sim, `${a.nom} : le laser touche ${o.nom} (${q} de magie + le coup)`);
      this.cible = null;
    }
  },
  ciblesEau() {
    const f = this.pr.fam, sim = this.sim;
    if (!NAGEURS.has(f)) return false;
    if (this.cible && this.cible.mort >= 0) this.cible = null;
    if (this.cibleForcee) { const o = sim.acteurs.parNom.get(this.cibleForcee); this.cible = o && o.mort < 0 ? o : null; return true; }
    if (f === 'gardien') {
      if (!this.cible && this.h.entierBorne(10) === 0) {
        const l = this.autres().filter((o) => (this.typeDe(o) === 'joueur' || ['squid', 'glow_squid', 'axolotl'].includes(this.typeDe(o))) && this.dist2(o) > 9 && this.dist2(o) <= this.pr.suivi ** 2 && this.voit(o)).sort((p, q) => this.dist2(p) - this.dist2(q));
        if (l[0]) this.poserCible(l[0]);
      }
    } else if (f === 'dauphin') { if (this.blessePar && this.blessePar.mort < 0 && sim.temps - this.blesseTick < 400 && !/guardian/.test(this.typeDe(this.blessePar))) this.poserCible(this.blessePar); }
    return true;
  },

  // ---- avant et apres les buts ---------------------------------------------------------------------------------------------------
  avantEau() {
    if (!this.nage) return;
    const a = this.a, sim = this.sim, h = this.h;
    // AbstractFish.aiStep : hors de l'eau, sur le sol, il saute (0,4) en se debattant ; Guardian.aiStep : idem (0,5) et tourne au hasard
    if (!a.dansEau && a.auSol && (this.pr.fam === 'poisson' || this.pr.fam === 'gardien')) {
      const k = this.pr.fam === 'gardien' ? 0.4 : 0.05;
      a.vx += (h.flottant() * 2 - 1) * k; a.vy += this.pr.fam === 'gardien' ? 0.5 : 0.4; a.vz += (h.flottant() * 2 - 1) * k; a.auSol = false;
      if (this.pr.fam === 'gardien') a.lacet = h.flottant() * 360;
      sim.son(this.pr.fam === 'gardien' ? `entity.${this.type}.flop` : `entity.${this.type === 'tadpole' ? 'tadpole' : this.type}.flop`, a.x, a.y, a.z, 1, 1);
      this.stat('sursauts');
    }
    // WaterAnimal.handleAirSupply : hors de l'eau, l'air baisse (300) ; a -20 : 2 de degats (noyade a sec) ; le dauphin, lui, respire dehors
    if (this.pr.fam !== 'dauphin' && this.pr.fam !== 'axolotl' && this.type !== 'turtle') { if (!a.dansEau) { if (--a.air <= -20) { a.air = 0; a.degats(2, 'sec'); } } else a.air = 300; }
    if (this.pr.fam === 'dauphin') { if (a.dansEau && !a.teteHorsEau) { if (--a.air <= -20) { a.air = 0; a.degats(2, 'noyade'); } } else a.air = Math.min(4800, a.air + 1 + 1); }
    if (this.type === 'pufferfish') this.tickGlobe();
    if (this.type === 'elder_guardian' && (sim.temps + this.idEntite()) % 1200 === 0) this.maledictionAncien();
  },
  apresEau() {},
  // Entity.getId : un numero d'entite (arbitraire dans le jeu) ; ici tire du nom de l'acteur, stable d'un rendu a l'autre
  idEntite() { if (this._id === undefined) { let h = 0; for (const c of this.a.nom) h = (h * 31 + c.charCodeAt(0)) >>> 0; this._id = h % 100000; } return this._id; },
  // Pufferfish : quelqu'un (pas un poisson ni un gardien) a 2 blocs : il gonfle (1 puis 2 apres 40 ticks, son), poison 60 x etat ticks et 1 + etat
  // de degats au contact ; sans personne 60 ticks : il degonfle
  tickGlobe() {
    const a = this.a, sim = this.sim;
    const proche = this.autres().find((o) => !['cod', 'salmon', 'tropical_fish', 'pufferfish', 'guardian', 'elder_guardian', 'tadpole', 'turtle', 'axolotl', 'dolphin'].includes(this.typeDe(o)) && this.dist2(o) < (2 + a.L) ** 2);
    const etat = (e) => { if (e !== this.gonflement) { this.gonflement = e; this.changer({ variante: ['small', 'medium', 'big'][e] }); sim.son(e > 0 ? 'entity.puffer_fish.blow_up' : 'entity.puffer_fish.blow_out', a.x, a.y, a.z, 1, 1); } };
    if (proche) { this.compteDegonfle = 0; if (this.gonflement === 0) { etat(1); this.compteGonfle = 0; } else if (this.gonflement === 1 && ++this.compteGonfle > 40) etat(2); }
    else if (this.gonflement > 0 && ++this.compteDegonfle > 60) { etat(this.gonflement - 1); this.compteDegonfle = 0; }
    if (this.gonflement > 0) for (const o of this.autres()) if (this.auContact(o) && !['pufferfish', 'cod', 'salmon', 'tropical_fish', 'guardian', 'elder_guardian'].includes(this.typeDe(o))) { if (o.frappe(1 + this.gonflement, 'mob:pufferfish', a.x - o.x, a.z - o.z, 0)) { o.appliquerEffet('poison', 60 * this.gonflement, 0); sim.son('entity.puffer_fish.sting', a.x, a.y, a.z, 1, 1); } }
  },
  // ElderGuardian.customServerAiStep : Fatigue minière III (6000 ticks) aux joueurs a 50 blocs qui ne l'ont pas deja (ou moins de 1200 ticks),
  // le fantome du gardien a l'ecran (particule ELDER_GUARDIAN) et le son de la malediction
  maledictionAncien() {
    const a = this.a, sim = this.sim;
    for (const o of this.autres()) {
      if (this.typeDe(o) !== 'joueur' || this.dist2(o) > 2500) continue;
      const e = o.effets.get('mining_fatigue');
      if (e && e.niveau >= 2 && e.fin - sim.temps > 1200) continue;
      o.appliquerEffet('mining_fatigue', 6000, 2);
      sim.particule('elder_guardian', o.x, o.y + o.O, o.z, 0, 0, 0, 1);
      sim.son('entity.elder_guardian.curse', o.x, o.y, o.z, 1, 1);
      this.stat('maledictions'); journal(sim, `${a.nom} maudit ${o.nom} (fatigue miniere III, 300 s)`);
    }
  },
  // apres un coup (Acteur.degats -> apresDegats) : encre du calmar, l'axolotl fait le mort
  apresDegatsEau(source, q) {
    const a = this.a, sim = this.sim, h = this.h;
    if (this.pr.fam === 'calmar') {   // Squid.spawnInk : 30 particules d'encre derriere lui, son squirt
      sim.son(this.type === 'glow_squid' ? 'entity.glow_squid.squirt' : 'entity.squid.squirt', a.x, a.y, a.z, 1, 1);
      const r = (a.lacet) * RAD, dos = [Math.sin(r) * 0.5, Math.cos(r) * -0.5];
      for (let i = 0; i < 30; i++) sim.particule(this.type === 'glow_squid' ? 'glow_squid_ink' : 'squid_ink', a.x + dos[0], a.y + 0.5, a.z + dos[1], h.gaussien() * 0.1, h.gaussien() * 0.1, h.gaussien() * 0.1, 1);
      this.stat('encres');
    }
    if (this.type === 'axolotl' && a.dansEau && this.mortJouee <= 0 && /^(joueur|mob:)/.test(String(source)) && h.entierBorne(3) === 0 && (h.entierBorne(3) < q || a.vie / a.vieMax < 0.5) && q < a.vie + q) {
      this.mortJouee = 200; a.appliquerEffet('regeneration', 200, 0); this.navEau = null;
      this.stat('mortsJouees'); journal(sim, `${a.nom} fait le mort (200 ticks, regeneration)`);
    }
  },

  // ---- deplacement dans l'eau (travel des especes) ; rend vrai si fait -------------------------------------------------------------
  physiqueEau() {
    if (!this.nage || this.a.mort >= 0) return false;
    const a = this.a, f = this.pr.fam, fl = a.fluidesAutour();
    a.dansEau = fl.eau; a.teteEau = fl.tete; a.teteHorsEau = !fl.tete;
    if (f === 'calmar') return this.physiqueCalmar(fl);
    if (!fl.eau) return false;
    const w = this.vouluEau(), mod = this.navEau?.mod ?? 1;
    let zza = 0, yya = 0, quant;
    if (f === 'poisson' || f === 'gardien' || this.type === 'turtle') {   // FishMoveControl / GuardianMoveControl / TurtleMoveControl
      if (f === 'poisson' && fl.tete) a.vy += 0.005;
      if (this.type === 'turtle') { a.vy += 0.005; }
      if (w) {
        const cible = mod * this.attr;
        this.vitNage += (cible - this.vitNage) * 0.125;
        if (this.type === 'turtle') this.vitNage = Math.max(this.vitNage / 2, this.bebe ? 0.06 : 0.08);
        const dx = w[0] - a.x, dy = w[1] - a.y - (f === 'gardien' ? 0 : a.H / 2), dz = w[2] - a.z, dd = Math.hypot(dx, dy, dz) || 1;
        a.vy += this.vitNage * (dy / dd) * 0.1;
        if (dx || dz) a.lacet = rotlerp(a.lacet, Math.atan2(dz, dx) / RAD - 90, 90);
        if (f === 'gardien') { const t = this.sim.temps + a.id, p = Math.sin(t * 0.5) * 0.05, c = Math.cos(a.lacet * RAD), s = Math.sin(a.lacet * RAD); a.vx += p * c; a.vz += p * s; a.vy += Math.sin(t * 0.75) * 0.05 * (s + c) * 0.25; }
        this.bouge = true;
      } else { this.vitNage = 0; this.bouge = false; }
      zza = this.vitNage; quant = f === 'poisson' ? 0.01 : 0.1;
    } else {   // SmoothSwimmingMoveControl (dauphin 0,02, axolotl 0,1)
      const [kEau] = LISSE[f] ?? [0.02];
      if (w && !(this.mortJouee > 0)) {
        const dx = w[0] - a.x, dy = w[1] - a.y - a.H / 2, dz = w[2] - a.z;
        a.lacet = rotlerp(a.lacet, Math.atan2(dz, dx) / RAD - 90, 10);
        const f1 = mod * (this.attrEau ?? this.attr), hor = Math.hypot(dx, dz);
        this.vitNage = f1 * kEau;
        if (Math.abs(dy) > 1e-5 || hor > 1e-5) this.tangageNage = rotlerp(this.tangageNage, Math.max(-85, Math.min(85, wrap(-Math.atan2(dy, hor) / RAD))), 5);
        zza = Math.cos(this.tangageNage * RAD) * f1; yya = -Math.sin(this.tangageNage * RAD) * f1; this.bouge = true;
        if (f === 'dauphin') a.vy += 0.005;
      } else { this.vitNage = 0; this.bouge = false; }
      quant = this.vitNage;
    }
    // moveRelative(quantite, (0, yya, zza)) puis le deplacement ; x 0,9 ; -0,005 sans cible (poissons, dauphin ; gardien immobile ; tortue)
    let l = Math.hypot(yya, zza); if (l > 1) { yya /= l; zza /= l; } l = 0;
    const s = Math.sin(a.lacet * RAD), c = Math.cos(a.lacet * RAD);
    a.vx += -zza * quant * s; a.vz += zza * quant * c; a.vy += yya * quant;
    const r = deplacerBoite(a.lec, a.boite(), [a.vx, a.vy, a.vz], a.auSol, this.type === 'turtle' ? 1 : 0);
    const vy0 = a.vy; a.x += r.dx; a.y += r.dy; a.z += r.dz; if (r.bloqueX) a.vx = 0; if (r.bloqueZ) a.vz = 0; if (r.bloqueY) a.vy = r.auSol ? vitesseApresContact(vy0, r.dy, 0.08, blocSous(a.lec, a.x, a.y, a.z)) : 0;   // rebond (rebond.js)
    a.auSol = r.auSol; a.bute = r.bloqueX || r.bloqueZ; a.distanceChute = 0;
    a.vx *= 0.9; a.vy *= 0.9; a.vz *= 0.9;
    if (!this.cible && (f === 'poisson' || f === 'dauphin' || (f === 'gardien' && !this.bouge) || (this.type === 'turtle' && !this.versMaison))) a.vy -= 0.005;
    // LivingEntity : contre une berge, un pas libre au-dessus : il se hisse (0,3) (tortue qui sort de l'eau, dauphin)
    if (a.bute && !coupe(a.lec, a.boite(a.x + a.vx, a.y + 0.6, a.z + a.vz))) a.vy = 0.3;
    a.toucherBlocs?.();
    return true;
  },
  // Squid.aiStep : tentacules (le mouvement suit le cycle : le vecteur s'applique au-dela de 0,75 du demi-cycle, puis x 0,9), corps qui se
  // tourne vers la vitesse ; hors de l'eau : il tombe (0,08, x 0,98) sans avancer
  physiqueCalmar(fl) {
    const a = this.a, T = this.tent, h = this.h;
    T.mvt += T.vit;
    if (T.mvt > Math.PI * 2) { T.mvt -= Math.PI * 2; if (h.entierBorne(10) === 0) T.vit = 1 / (h.flottant() + 1) * 0.2; }
    if (fl.eau) {
      if (T.mvt < Math.PI) { const k = T.mvt / Math.PI; T.angle = Math.sin(k * k * Math.PI) * Math.PI * 0.25; if (k > 0.75) { [a.vx, a.vy, a.vz] = this.vecteur; T.rot = 1; } else T.rot *= 0.8; }
      else { T.angle = 0; a.vx *= 0.9; a.vy *= 0.9; a.vz *= 0.9; T.rot *= 0.99; }
      const hor = Math.hypot(a.vx, a.vz);
      a.lacet += (-Math.atan2(a.vx, a.vz) / RAD - a.lacet) * 0.1;
      T.zRot += Math.PI * T.rot * 1.5; T.xRot += (-Math.atan2(hor, a.vy) / RAD - T.xRot) * 0.1;
      T.oisif = Math.hypot(...this.vecteur) < 1e-6 ? T.oisif + 1 : 0;
    } else {
      T.angle = Math.abs(Math.sin(T.mvt)) * Math.PI * 0.25;
      a.vx = 0; a.vz = 0; a.vy = (a.vy - 0.08) * 0.98; T.xRot += (-90 - T.xRot) * 0.02;
    }
    const r = deplacerBoite(a.lec, a.boite(), [a.vx, a.vy, a.vz], a.auSol, 0);
    const vy0 = a.vy; a.x += r.dx; a.y += r.dy; a.z += r.dz; if (r.bloqueX) a.vx = 0; if (r.bloqueZ) a.vz = 0; if (r.bloqueY) a.vy = r.auSol ? vitesseApresContact(vy0, r.dy, 0.08, blocSous(a.lec, a.x, a.y, a.z)) : 0;   // rebond (rebond.js)
    a.auSol = r.auSol; a.distanceChute = 0;
    return true;
  },

  drapeauxEau() {
    let d = 0;
    if (this.bouge) d |= 1 << 21;                 // gardien qui nage (pointes rentrees), poisson qui avance
    if (this.mortJouee > 0) d |= 1 << 22;         // axolotl qui fait le mort
    if (this.laser && this.laser.t >= 0) d |= 1 << 23;
    return d;
  },
  // colonne en plus : calmar [tentacules, angle, xRot, zRot] ; gardien [temps du laser, duree] ; dauphin et axolotl [tangage]
  plusEau() {
    if (!this.nage) return null;
    if (this.pr.fam === 'calmar') return [this.tent.mvt, this.tent.angle, this.tent.xRot, this.tent.zRot, 0, 0];
    if (this.pr.fam === 'gardien') return [this.laser ? this.laser.t : -100, this.type === 'elder_guardian' ? 60 : 80, this.cible ? this.cible.id : -1, 0, 0, 0];
    return [this.tangageNage ?? 0, 0, 0, 0, 0, 0];
  },
};
