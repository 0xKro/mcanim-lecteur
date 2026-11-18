// Le breeze (champ `ia: true`), melange a la classe IA de ia.js : son cerveau (Breeze.BRAIN_PROVIDER, BreezeAi), d'apres Horizon (MIT, voir
// ATTRIBUTIONS.md) horizon-client/src/mobs/monster_brain.rs (paquets, comportements, memoires a duree) et mobs/breeze.rs (poses, saut long,
// sons). Chiffres relus la et dans entity-types.json du jeu 26.3 : vie 30, vitesse 0,63, portee de suivi 24, yeux 1,3452, hauteur 1,77.
//   - capteurs toutes les 20 ticks (debut tire 0..19) : cible = le joueur (pas en creatif) ou golem de fer le plus proche, vu, a 24 blocs ;
//     l'attaquant (blesse il y a 40 ticks au plus) ;
//   - combat (cible, pas de point de marche) : Tir (pose shooting, inspiration, 15 ticks de charge, la charge de vent part a 0,7 de la hauteur
//     de tir y + 1,77 / 2 + 0,3 vers 0,3 de la hauteur de la cible, imprecision 5 - 4 x difficulte, son entity.breeze.shoot 1,5 ; 4 ticks de
//     reprise ; 10 ticks de repos apres) ; Saut long (au sol, cible a plus de 4 blocs, 4 blocs libres au-dessus : un point a 4 a 8 blocs
//     derriere la cible pose au sol, 10 ticks d'inspiration (son charge), angle tire parmi 40, 55, 60, 75, 80, vitesse au plus 1,4, x 0,95 ;
//     sans frottement en l'air ; a l'atterrissage : son land, 10 ticks (2 s'il a ete blesse) avant le prochain saut, 100 ticks pour tirer) ;
//     tir quand il est coince (eau, monture) ; Glissade (un point loin de la cible s'il est a moins de 4 blocs, sinon derriere elle ou a 4 a 8
//     blocs d'elle : glisse a 0,6, pose sliding, son slide ; ensuite 60 ticks pour tirer) ;
//   - repos : flaner a 0,6 ou ne rien faire 20 a 100 ticks ; la cible est oubliee 100 ticks apres qu'il ne la voit plus ;
//   - il est insensible aux charges des breezes et renvoie les projectiles (projectiles.js) ; sons whirl (1 a 80 ticks), idle_ground/idle_air.
import { rayonBloc } from './collision.js';
export const POSES_BREEZE = ['idle', 'shooting', 'inhaling', 'long_jumping', 'sliding'];
const DEBOUT = 0, TIR = 1, INSPIRE = 2, SAUT = 3, GLISSE = 4;
const ANGLES = [40, 55, 60, 75, 80];
const DANGER = /^(fire|soul_fire|lava|magma_block|lava_cauldron|wither_rose|sweet_berry_bush|cactus|powder_snow)$/;
const journal = (sim, t) => (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${t}`);

export const METHODES_BREEZE = {
  initBreeze() {
    if (this.type !== 'breeze') return;
    const h = this.h;
    this.bz = { mem: new Map(), pose: DEBOUT, capteurs: [h.entierBorne(20), h.entierBorne(20)], tir: { fin: -1 }, saut: { fin: -1 }, glisse: { fin: -1 }, flane: { fin: -1, rien: false }, vuT: this.sim.temps, sonTick: 0 };
  },
  installerBreeze() { return this.type === 'breeze'; },   // pas de buts : le cerveau (avantBreeze)
  ciblesBreeze() { if (this.type !== 'breeze') return false; this.cible = this.mem('cible'); return true; },
  // ---- memoires (Brain : valeur et duree ; une duree de 0 efface au tick suivant)
  mem(n) { return this.bz.mem.get(n)?.v ?? null; },
  a_(n) { return this.bz.mem.has(n); },
  pose_(n, v, ttl = Infinity) { this.bz.mem.set(n, { v, ttl }); },
  oublie(n) { this.bz.mem.delete(n); },
  poseBz(p) { this.bz.pose = p; },
  sansFrottement() { return this.type === 'breeze' && this.bz?.pose === SAUT; },   // Breeze.shouldDiscardFriction
  peutAttaquerBz(o) { return !!o && o.mort < 0 && !o.invulnerable && (this.typeDe(o) === 'joueur' || this.typeDe(o) === 'iron_golem'); },   // Breeze.canAttack
  attaquableBz(o) { return this.peutAttaquerBz(o) && this.dist2(o) <= 576 && this.voit(o); },
  dansEauBz() { return !!this.a.dansEau; },
  // ---- le cerveau, chaque tick (Breeze.customServerAiStep : Brain.tick puis BreezeAi.updateActivity)
  avantBreeze() {
    if (this.type !== 'breeze') return;
    const a = this.a, sim = this.sim, h = this.h, t = sim.temps, B = this.bz;
    for (const [n, m] of [...B.mem]) { if (m.ttl === Infinity) continue; if (m.ttl <= 0) B.mem.delete(n); else m.ttl--; }
    // capteurs (20 ticks)
    for (let i = 0; i < 2; i++) {
      if (--B.capteurs[i] > 0) continue;
      B.capteurs[i] = 20;
      if (i === 0) { const o = this.autres().filter((q) => this.attaquableBz(q)).sort((p, q) => this.dist2(p) - this.dist2(q))[0] ?? null; if (o) this.pose_('proche', o); else this.oublie('proche'); }
      else if (this.blessePar && t - this.blesseTick <= 40 && this.blessePar.mort < 0) this.pose_('attaquant', this.blessePar); else this.oublie('attaquant');
    }
    if (this.cibleForcee && !this.a_('cible')) { const o = sim.acteurs.parNom.get(this.cibleForcee); if (o && o.mort < 0) this.pose_('cible', o); }
    a.entree.avance = 0;
    const combat = this.a_('cible') && !this.a_('marche');
    // ---- noyau : nager (Swim 0,8)
    if (a.dansEau && h.flottant() < 0.8) a.saut = true;
    if (combat) this.combatBreeze(); else this.reposBreeze();
    // regard : la cible
    const c = this.mem('cible');
    if (c) this.regardBz = c;
    // sons (Breeze.tick : whirl ; Mob.baseTick : idle_ground / idle_air)
    if (B.sonTick === 0) B.sonTick = 1 + h.entierBorne(80); else B.sonTick--;
    if (B.sonTick === 0) sim.son('entity.breeze.whirl', a.x, a.y, a.z, 0.8 + 0.2 * h.flottant(), 0.7 + 0.4 * h.flottant());
    // miettes du bloc sous lui (Breeze.emitGroundParticles) : 1 debout, en tir ou en inspiration ; 20 en glissade
    const nb = B.pose === GLISSE ? 20 : B.pose === SAUT ? 0 : 1 + h.entierBorne(1);
    if (nb && a.auSol) { const e = sim.monde.etatEn(Math.floor(a.x), Math.floor(a.y - 0.2), Math.floor(a.z)); if (e >= 0 && !sim.d.esAir(e)) sim.replay.particule(t, 'miettes|' + sim.d.chaine(e), a.x, a.y, a.z, 0, 0, 0, nb); }
  },
  apresBreeze() { if (this.type === 'breeze' && this.regardBz) this.regarder(this.regardBz); this.regardBz = null; },
  // ---- repos : commencer l'attaque, glisser vers le point de marche, flaner ou ne rien faire
  reposBreeze() {
    const a = this.a, sim = this.sim, h = this.h, t = sim.temps, B = this.bz;
    if (!this.a_('cible')) { const o = this.mem('proche') ?? this.mem('attaquant'); if (o) { this.pose_('cible', o); B.vuT = t; journal(sim, `${a.nom} vise ${o.nom}`); return; } }
    // SlideToTargetSink (20 a 40 ticks)
    const m = this.mem('marche');
    if (m && B.glisse.fin < 0) {
      B.glisse.fin = t + 20 + h.entierBorne(21);
      this.allerVers(m[0] + 0.5, m[1], m[2] + 0.5, 0.6, { recalcul: 1e9 });
      sim.son('entity.breeze.slide', a.x, a.y + a.H / 2, a.z, 1, 1); this.poseBz(GLISSE);
      return;
    }
    if (B.glisse.fin >= 0) {
      const arrive = m && Math.abs(Math.floor(a.x) - m[0]) + Math.abs(Math.floor(a.y) - m[1]) + Math.abs(Math.floor(a.z) - m[2]) <= 1;
      if (t > B.glisse.fin || !m || arrive || this.navFinie()) {
        B.glisse.fin = -1; this.nav = null; this.oublie('marche');
        this.poseBz(DEBOUT);
        if (this.a_('cible')) this.pose_('tirer', true, 60);
      }
      return;
    }
    // RunOne : ne rien faire (poids 1) ou flaner (poids 2) ; ShufflingList : -r^(1/poids), le plus petit d'abord
    if (B.flane.fin >= 0) { if (t > B.flane.fin || (!B.flane.rien && this.navFinie())) B.flane.fin = -1; return; }
    const r1 = h.flottant(), r2 = h.flottant(), ordre = -Math.pow(r1, 1) <= -Math.pow(r2, 1 / 2) ? ['rien', 'flane'] : ['flane', 'rien'];
    for (const k of ordre) {
      if (k === 'rien') { B.flane = { fin: t + 20 + h.entierBorne(81), rien: true }; return; }
      const p = this.pointBz(10, 7, null);
      if (p) { this.allerVers(p[0], p[1], p[2], 0.6, { recalcul: 1e9 }); B.flane = { fin: t + 1e9, rien: false }; return; }
    }
  },
  // ---- combat : arreter si la cible n'est plus valable, tirer, sauter, tirer coince, glisser
  combatBreeze() {
    const a = this.a, sim = this.sim, h = this.h, t = sim.temps, B = this.bz, o = this.mem('cible');
    // StopAttackingIfTargetInvalid : morte, plus attaquable, ou pas vue depuis 100 ticks
    if (!o || o.mort >= 0 || !this.peutAttaquerBz(o)) { this.oublie('cible'); return; }
    if (this.attaquableBz(o)) B.vuT = t; else if (t - B.vuT > 100) { this.oublie('cible'); return; }
    // Tir (en cours)
    if (B.tir.fin >= 0) {
      if (t > B.tir.fin || !this.a_('tirer')) return this.finTir();
      this.regardBz = o;
      if (!this.a_('charge') && !this.a_('reprise')) {
        this.pose_('reprise', true, 4);
        const fy = a.y + a.H / 2 + Math.fround(0.3), oh = o.boite()[4] - o.boite()[1];
        const d = [o.x - a.x, o.y + oh * 0.3 - fy, o.z - a.z], L = Math.hypot(...d) || 1;
        const u = 0.0172275 * (5 - this.difficulte() * 4), v = d.map((c) => (c / L + u * (h.flottant() - h.flottant())) * 0.7);
        sim.entites.proj.creer('vent_breeze', a, [a.x, fy, a.z], v, { sansHerite: true });
        sim.son('entity.breeze.shoot', a.x, a.y, a.z, 1.5, 1);
        this.stat('tirsVent'); journal(sim, `${a.nom} tire une charge de vent sur ${o.nom}`);
      }
      return;
    }
    // Saut long (en cours)
    if (B.saut.fin >= 0) {
      if (t > B.saut.fin || B.pose === DEBOUT || this.a_('sautRepos')) return this.finSaut();
      if (!a.dansEau && this.a_('quitteEau')) this.oublie('quitteEau');
      if (!this.a_('inspire') && B.pose === INSPIRE) {
        const c = this.mem('sautBut'), v = c ? this.vecteurSaut([c[0] + 0.5, c[1], c[2] + 0.5]) : null;
        if (!v) { this.poseBz(DEBOUT); return; }
        if (a.dansEau) this.pose_('quitteEau', true);
        sim.son('entity.breeze.jump', a.x, a.y, a.z, 1, 1); this.poseBz(SAUT);
        a.vx = v[0]; a.vy = v[1]; a.vz = v[2]; a.auSol = false;
        journal(sim, `${a.nom} saute vers ${c.join(',')}`);
        return;
      }
      if (B.pose === SAUT && (a.auSol || (a.dansEau && !this.a_('quitteEau')))) {
        sim.son('entity.breeze.land', a.x, a.y, a.z, 1, 1); this.poseBz(DEBOUT);
        this.pose_('sautRepos', true, sim.temps - this.blesseTick <= 40 ? 2 : 10); this.pose_('tirer', true, 100);
      }
      return;
    }
    // Tir : demarrage
    if (this.a_('tirer') && !this.a_('tirRepos') && !this.a_('charge') && !this.a_('reprise') && !this.a_('sautBut') && B.pose === DEBOUT) {
      if (this.dist2(o) >= 256) { this.oublie('tirer'); }
      else {
        B.tir.fin = t + 20; this.poseBz(TIR); this.pose_('charge', true, 15);
        sim.son('entity.breeze.inhale', a.x, a.y, a.z, 1, 1);
        return;
      }
    }
    // Saut long : demarrage
    if (!this.a_('sautRepos') && !this.a_('tirer') && this.peutSauter(o)) {
      B.saut.fin = t + 200;
      if (!this.a_('inspire')) this.pose_('inspire', true, 10);
      this.poseBz(INSPIRE);
      sim.son('entity.breeze.charge', a.x, a.y, a.z, 1, 1);
      const c = this.mem('sautBut'); if (c) this.regardBz = [c[0] + 0.5, c[1] + 0.5, c[2] + 0.5];
      return;
    }
    // Tir quand il est coince (eau)
    if (!this.a_('inspire') && !this.a_('sautBut') && !this.a_('tirer') && a.dansEau) { this.pose_('tirer', true, 60); return; }
    // Glissade : un point de marche (le repos le suit, l'activite de combat attend qu'il soit atteint)
    if (!this.a_('sautRepos') && !this.a_('tirer') && a.auSol && !a.dansEau && B.pose === DEBOUT) {
      const p = this.pointGlisse(o);
      if (p) this.pose_('marche', p.map(Math.floor));
    }
  },
  finTir() { const B = this.bz; B.tir.fin = -1; if (B.pose === TIR) this.poseBz(DEBOUT); this.pose_('tirRepos', true, 10); this.oublie('tirer'); },
  finSaut() { const B = this.bz; B.saut.fin = -1; if (B.pose === SAUT || B.pose === INSPIRE) this.poseBz(DEBOUT); this.oublie('sautBut'); this.oublie('inspire'); this.oublie('quitteEau'); },
  // LongJump.canRun
  peutSauter(o) {
    const a = this.a, sim = this.sim;
    if (!a.auSol && !a.dansEau) return false;
    if (this.a_('sautBut')) return true;
    if (this.dist2(o) >= 576) { this.oublie('cible'); return false; }
    if (Math.fround(Math.sqrt(this.dist2(o))) - 4 <= 0) return false;
    const x = Math.floor(a.x), y = Math.floor(a.y), z = Math.floor(a.z);
    if (sim.d.nomBloc(sim.monde.etatEn(x, y, z)) === 'honey_block') return false;
    for (let i = 1; i <= 4; i++) { const e = sim.monde.etatEn(x, y + i, z); if (!(e >= 0 && (sim.d.esAir(e) || sim.fluide(x, y + i, z).type === 'water'))) return false; }
    const derriere = this.pointDerriere(o), but = this.surSurface(derriere);
    if (!but) return false;
    const sous = sim.monde.etatEn(but[0], but[1] - 1, but[2]);
    if (sous >= 0 && DANGER.test(sim.d.nomBloc(sous))) return false;
    const centre = [but[0] + 0.5, but[1] + 0.5, but[2] + 0.5];
    if (!this.vueBz(centre) && !this.vueBz([centre[0], centre[1] + 4, centre[2]])) return false;
    this.pose_('sautBut', but);
    return true;
  },
  // BreezeUtil.randomPointBehindTarget : 4 a 8 blocs derriere la cible (sa tete), +- 45 degres (gaussien)
  pointDerriere(o) {
    const h = this.h, vue = (o.lacetTete ?? o.lacet ?? 0) + 180 + Math.fround(h.gaussien()) * 90 / 2, r = 4 + h.flottant() * 4, a = vue * Math.PI / 180;
    return [o.x - Math.sin(a) * r, o.y, o.z + Math.cos(a) * r];
  },
  // BreezeUtil.hasLineOfSight : a 50 blocs au plus, rien entre
  vueBz(p) { const a = this.a; return Math.hypot(p[0] - a.x, p[1] - a.y, p[2] - a.z) <= 50 && rayonBloc(a.lec, [a.x, a.y, a.z], p) === null; },
  // LongJump.snapToSurface : le bloc au-dessus du sol trouve 10 blocs plus bas (sinon plus haut)
  surSurface(p) {
    const a = this.a;
    for (const dy of [-10, 10]) { const c = rayonBloc(a.lec, p, [p[0], p[1] + dy, p[2]]); if (c) return dy < 0 ? [Math.floor(p[0]), c[1] + 1, Math.floor(p[2])] : [Math.floor(p[0]), c[1] + 1, Math.floor(p[2])]; }
    return null;
  },
  // LongJump.calculateOptimalJumpVector : les angles melanges, le premier qui atteint le but (vitesse au plus 0,058333334 x 24)
  vecteurSaut(but) {
    const h = this.h, ang = ANGLES.slice();
    for (let i = ang.length; i > 1; i--) { const j = h.entierBorne(i); [ang[i - 1], ang[j]] = [ang[j], ang[i - 1]]; }
    const a = this.a, max = Math.fround(0.058333334 * 24);
    const pl = [but[0] - a.x, 0, but[2] - a.z], lp = Math.hypot(...pl) || 1, vise = [but[0] - pl[0] / lp * 0.5, but[1], but[2] - pl[2] / lp * 0.5];
    const d = [vise[0] - a.x, vise[1] - a.y, vise[2] - a.z], xz = Math.atan2(d[2], d[0]), r2 = d[0] * d[0] + d[2] * d[2], r = Math.sqrt(r2), y = d[1], g = 0.08;
    for (const deg of ang) {
      const rad = Math.fround(deg * Math.fround(Math.PI) / 180);
      const v0sq = r2 * g / (r * Math.sin(2 * rad) - 2 * y * Math.cos(rad) ** 2);
      if (!(v0sq >= 0)) continue;
      const v0 = Math.sqrt(v0sq); if (v0 > max) continue;
      const v0r = v0 * Math.cos(rad), v0y = v0 * Math.sin(rad), k = Math.fround(0.95);
      return [v0r * Math.cos(xz) * k, v0y * k, v0r * Math.sin(xz) * k];
    }
    return null;
  },
  // Slide.start
  pointGlisse(o) {
    const a = this.a, h = this.h;
    const c = [Math.floor(a.x) + 0.5, Math.floor(a.y) + 0.5, Math.floor(a.z) + 0.5], dx = o.x - c[0], dy = o.y - c[1], dz = o.z - c[2];
    if (dx * dx + dz * dz < 16 && Math.abs(dy) < 10) {
      const p = this.pointBz(5, 5, [o.x, o.y, o.z]);
      if (p && this.vueBz(p) && (p[0] - o.x) ** 2 + (p[1] - o.y) ** 2 + (p[2] - o.z) ** 2 > this.dist2(o)) return p;
    }
    if (h.booleen()) return this.pointDerriere(o);
    const d = [o.x - a.x, o.y - a.y, o.z - a.z], L = Math.hypot(...d) || 1, k = L - (8 + h.reel() * (4 - 8));
    return [a.x + d[0] / L * k, a.y + d[1] / L * k, a.z + d[2] / L * k];
  },
  // DefaultRandomPos (getPos / getPosAway) : 10 essais, le premier stable (sol plein dessous, la boite y tient, pas d'eau ni de danger)
  pointBz(hz, vt, loinDe) {
    const a = this.a, H = this.h, sim = this.sim;
    let best = null;
    const centre = loinDe ? Math.atan2(a.z - loinDe[2], a.x - loinDe[0]) - Math.fround(Math.PI / 2) : 0;
    for (let i = 0; i < 10; i++) {
      let xt, zt;
      if (loinDe) { const yr = centre + (2 * H.flottant() - 1) * Math.fround(Math.PI / 2), dist = Math.sqrt(H.reel()) * hz * Math.fround(Math.SQRT2); xt = -dist * Math.sin(yr); zt = dist * Math.cos(yr); if (Math.abs(xt) > hz || Math.abs(zt) > hz) continue; }
      else { xt = H.entierBorne(2 * hz + 1) - hz; zt = H.entierBorne(2 * hz + 1) - hz; }
      const p = [Math.floor(a.x + Math.floor(xt)), Math.floor(a.y + H.entierBorne(2 * vt + 1) - vt), Math.floor(a.z + Math.floor(zt))];
      if (best) continue;
      const sous = sim.monde.etatEn(p[0], p[1] - 1, p[2]);
      if (!(sous >= 0 && sim.d.opacite(sous) >= 15)) continue;
      let ok = true;
      for (const dy of [0, 1]) { const e = sim.monde.etatEn(p[0], p[1] + dy, p[2]); if (e < 0 || sim.fluide(p[0], p[1] + dy, p[2]).type || DANGER.test(sim.d.nomBloc(e)) || sim.d.boites(e).length) ok = false; }
      if (ok) best = p;
    }
    return best ? [best[0] + 0.5, best[1], best[2] + 0.5] : null;
  },
  apresDegatsBreeze() {},
  // colonne en plus : pose
  plusBreeze() { return this.type === 'breeze' ? [this.bz.pose, 0, 0, 0, 0, 0] : null; },
};
