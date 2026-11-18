// Les deux boss, melanges a la classe IA de ia.js (champ `ia: true`) : wither et dragon de l'Ender ; et, au niveau du monde (classe Boss) :
// motif d'invocation du wither (sable des ames + 3 cranes, WitherSkullBlock.checkSpawn), cristaux de l'End (soin du dragon, rayon), nuages
// de souffle du dragon (AreaEffectCloud).
// Port d'apres Horizon (MIT, voir ATTRIBUTIONS.md) : mobs/wither.rs (charge de 220 ticks, explosion 7, vol au-dessus de la cible, trois tetes,
// cranes, casse des blocs quand il est blesse, armure sous la moitie de la vie), game/wither.rs (cranes : 8 degats, fletrissement, explosion 1,
// crane bleu), block_pattern.rs (motif), game/dragon.rs (phases du dragon : tenue en cercle sur 24 noeuds, mitraillage du joueur, approche,
// atterrissage, scan, rugissement, souffle, charge, envol, mort ; pilotage vers la cible de la phase ; contacts des ailes et de la tete ;
// nuages de souffle ; mort en 200 ticks qui monte de 0,1 par tick).
// Adaptation du dragon a l'Overworld (nos zones n'ont pas d'End) : le centre des cercles est `centre` [x, z] du dragon, sinon `monde.fontaine`,
// sinon son point de depart ; le perchoir est `perchoir` [x, y, z], sinon le sol sous le centre ; les noeuds prennent la hauteur du terrain
// de la zone (+5 / +15 / +5 comme le jeu, au moins 9 au-dessus du centre, comme 73 au-dessus du podium a 64) ; regle `dragon.rayon` (60 :
// le jeu ; plus petit : des cercles plus serres pour cadrer).
import { coupe, rayonBloc } from './collision.js';
import { exploser } from './explosion.js';

const RAD = Math.PI / 180, MOVE = 1, LOOK = 2;
const wrap = (a) => { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; };
const journal = (sim, t) => (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${t}`);
export const MORTS_VIVANTS = new Set(['zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'bogged', 'parched', 'wither_skeleton', 'zombie_horse', 'skeleton_horse', 'phantom', 'zombified_piglin', 'zoglin', 'wither']);
export const INVULNERABLE = 220;
// EnderDragon : adjacences des 24 noeuds (findPath)
const ADJ = [6146, 8197, 8202, 16404, 32808, 32848, 65696, 131392, 131712, 263424, 526848, 525313, 1581057, 3166214, 2138120, 6373424, 4358208, 12910976, 9044480, 9706496, 15216640, 13688832, 11763712, 8257536];
const ASSIS = new Set(['scan', 'rugit', 'souffle', 'plane']);
const VITESSE_PHASE = { atterrit: 1.5, charge: 3.0, mourant: 3.0, plane: 1.0 };

export function declarerReglesBoss(regles) {
  regles.declarer('dragon.rayon', { def: 60, min: 8, max: 120, doc: 'rayon du cercle exterieur des noeuds du dragon (le jeu : 60, puis 40 et 20) ; plus petit : des cercles plus serres autour du centre' });
  regles.declarer('ia.wardenCreuse', { def: true, doc: 'le warden s enterre (100 ticks) apres 1200 ticks sans colere ni trouble, comme dans le jeu ; false : il reste' });
  regles.declarer('wither.invocation', { def: true, doc: 'poser le 3e crane de wither squelette sur le T de sable des ames fait naitre un wither (WitherSkullBlock.checkSpawn ; pas en paisible)' });
}

// ---------------------------------------------------------------- au niveau du monde
export class Boss {
  constructor(sim) { this.sim = sim; this.nuages = []; this.vu = false; }
  // WitherSkullBlock.checkSpawn : apres la pose d'un crane de wither squelette, le motif "^^^ / ### / ~#~" (crane, sable ou terre des ames,
  // air) dans l'une de ses 24 orientations ; il est vide (particules de casse) et le wither nait au milieu de la rangee du bas (+0,55)
  apresPose(D, acteur) {
    const sim = this.sim, e = sim.monde.etatEn(D[0], D[1], D[2]);
    if (e < 0 || !/^wither_skeleton(_wall)?_skull$/.test(sim.d.nomBloc(e))) return null;
    if (!sim.regles.valeur('wither.invocation', true) || /^(paisible|peaceful)$/.test(sim.regles.valeur('monde.difficulte', 'normal'))) return null;
    const m = trouverMotif(sim, D);
    if (!m) return null;
    for (const c of m.cellules) { const s = sim.monde.etatEn(c[0], c[1], c[2]); if (s >= 0) sim.particule('block_break|' + sim.d.chaine(s), c[0] + 0.5, c[1] + 0.5, c[2] + 0.5, 0, 0, 0, 1); sim.poser(c[0], c[1], c[2], 'minecraft:air', 2); }
    const b = m.base, yaw = m.avantX ? 0 : 90;
    const w = sim.acteurs.naitre({ type: 'wither', x: b[0] + 0.5, y: b[1] + 0.55, z: b[2] + 0.5, lacet: yaw, modele: acteur?.nom ?? null, raison: 'invocation', nom: 'wither', vie: 300, gabaritParent: { l: 0.9, h: 3.5, oeil: 2.975, vitesse: 1 }, vitesseAttr: 0.6, ia: { invulnerable: INVULNERABLE } });
    if (w) journal(sim, `${acteur?.nom ?? 'quelqu un'} invoque un wither (${w.nom}) en ${b.join(',')}`);
    return w;
  }
  // EndCrystal.hurtServer : tout coup (sauf du dragon) le detruit ; sauf une explosion, il explose (puissance 6) ; s'il soignait le dragon,
  // celui-ci prend 10 de degats (onCrystalDestroyed) et, frappe par un joueur, il le mitraille
  cristalTouche(c, source) {
    const sim = this.sim;
    if (c.mort >= 0 || /^mob:ender_dragon$/.test(String(source))) return false;
    c.mort = 21; c.mortSansCorps = true; c.vie = 0;
    journal(sim, `cristal de l End ${c.nom} detruit (${source})`); sim.stats.cristaux = (sim.stats.cristaux || 0) + 1;
    if (!/explosion/.test(String(source))) exploser(sim, c.x, c.y, c.z, { puissance: 6, casseBlocs: sim.regles.valeur('ia.explosionCasse', true), source: 'cristal', exclure: c.nom });
    for (const d of sim.acteurs.liste) {
      if (d.ia?.type !== 'ender_dragon' || d.mort >= 0) continue;
      if (d.ia.cristalSoin === c) { d.ia.cristalSoin = null; d.degats(10, 'explosion_cristal'); }   // hurt(head, ...) : sur la tete, sans reduction
      const j = c.dernierFrappeur ?? null;
      if (j && !j.ia && d.ia.phase === 'cercle') { d.ia.phaseDragon('mitraille', { joueur: j, charge: 0 }); d.ia.debutMitraille(j); }
    }
    return true;
  }
  // AreaEffectCloud du dragon : { pos, rayon, age, duree, duDragon, victimes }
  nuage(pos, rayon, duree, duDragon) { this.nuages.push({ pos: pos.slice(), rayon, age: 0, duree, duDragon, victimes: [] }); }
  // DragonFireball.onHit : le nuage part du pied de la boule, puis va au premier vivant a moins de 4 blocs ; evenement 2006 (souffle, son)
  nuageBoule(pos, e) {
    const sim = this.sim, pied = [pos[0], pos[1] - 0.5, pos[2]];
    let at = pied;
    for (const a of sim.acteurs?.liste ?? []) {
      if (a.mort >= 0 || a.nom === e.proprietaire) continue;
      const b = a.boite();
      if (b[3] > pied[0] - 4.5 && b[0] < pied[0] + 4.5 && b[4] > pied[1] - 2 && b[1] < pied[1] + 3 && b[5] > pied[2] - 4.5 && b[2] < pied[2] + 4.5 && (a.x - pied[0]) ** 2 + (a.y - pied[1]) ** 2 + (a.z - pied[2]) ** 2 < 16) { at = [a.x, a.y, a.z]; break; }
    }
    this.nuage(at, 3, 600, false);
    for (let i = 0; i < 200; i++) { const h = sim.hasard, r = h.flottant() * 4, ang = h.flottant() * Math.PI * 2; sim.particule('dragon_breath', pos[0] + Math.cos(ang) * r * 0.25, pos[1], pos[2] + Math.sin(ang) * r * 0.25, Math.cos(ang) * r * 0.1, 0.01, Math.sin(ang) * r * 0.1, 1); }
    sim.son('entity.dragon_fireball.explode', pos[0], pos[1], pos[2], 1, sim.hasard.flottant() * 0.1 + 0.9);
    journal(sim, `boule du dragon : nuage de souffle en ${at.map((v) => v.toFixed(1)).join(',')}`);
  }
  tick() {
    const sim = this.sim;
    if (!this.nuages.length) return;
    const dragonVivant = sim.acteurs?.liste.some((a) => a.ia?.type === 'ender_dragon' && a.ia.phase === 'souffle' && a.mort < 0);
    for (const c of [...this.nuages]) {
      if (c.duDragon && !dragonVivant) { this.nuages.splice(this.nuages.indexOf(c), 1); continue; }   // DragonSittingFlamingPhase.end
      c.age++;
      if (c.age - 20 >= c.duree) { this.nuages.splice(this.nuages.indexOf(c), 1); continue; }
      if (!c.duDragon && c.age >= 20) c.rayon += (7 - 3) / c.duree;
      const r = c.rayon, n = Math.min(40, Math.floor(Math.PI * r * r));
      for (let i = 0; i < n; i++) { const a = sim.hasard.flottant() * Math.PI * 2, d = Math.sqrt(sim.hasard.flottant()) * r; sim.particule('dragon_breath', c.pos[0] + Math.cos(a) * d, c.pos[1], c.pos[2] + Math.sin(a) * d, 0, 0, 0, 1); }
      // apres 20 ticks d'attente, toutes les 5 ticks : degats instantanes I (souffle) ou II (boule), echelle 0,5 : 3 ou 6 ; 20 ticks avant de recommencer
      if (c.age < 20 || c.age % 5 !== 0) continue;
      c.victimes = c.victimes.filter((v) => c.age < v.jusqua);
      const q = c.duDragon ? 3 : 6;
      for (const a of sim.acteurs?.liste ?? []) {
        if (a.mort >= 0 || a.ia?.type === 'ender_dragon' || c.victimes.some((v) => v.nom === a.nom)) continue;
        const b = a.boite();
        if (!(b[3] > c.pos[0] - r && b[0] < c.pos[0] + r && b[4] > c.pos[1] && b[1] < c.pos[1] + 0.5 && b[5] > c.pos[2] - r && b[2] < c.pos[2] + r) || (a.x - c.pos[0]) ** 2 + (a.z - c.pos[2]) ** 2 > r * r) continue;
        c.victimes.push({ nom: a.nom, jusqua: c.age + 20 });
        if (MORTS_VIVANTS.has(a.typeCreature)) { a.vie = Math.min(a.vieMax, a.vie + q); continue; }   // les morts-vivants sont soignes
        a.degats(q, 'souffle_dragon');
        sim.stats.souffle = (sim.stats.souffle || 0) + 1;
      }
    }
  }
}

// 24 orientations : la rangee suit `d` (droite), la colonne descend contre `h` (haut) ; le crane pose est l'une des 3 cases du haut
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const MOTIF = ['^^^', '###', '~#~'];
function trouverMotif(sim, D) {
  const nom = (p) => { const e = sim.monde.etatEn(p[0], p[1], p[2]); return e < 0 ? '#hidden' : sim.d.nomBloc(e); };
  const ok = (k, p) => { const n = nom(p); return k === '^' ? /^wither_skeleton(_wall)?_skull$/.test(n) : k === '#' ? n === 'soul_sand' || n === 'soul_soil' : k === '~' ? /^(cave_|void_)?air$/.test(n) : true; };
  for (const h of DIRS) for (const d of DIRS) {
    if (d[0] * h[0] + d[1] * h[1] + d[2] * h[2] !== 0) continue;
    for (let c0 = 0; c0 < 3; c0++) {
      const o = [D[0] - d[0] * c0, D[1] - d[1] * c0, D[2] - d[2] * c0];   // case (0, 0) : en haut a gauche
      const cellule = (c, r) => [o[0] + d[0] * c - h[0] * r, o[1] + d[1] * c - h[1] * r, o[2] + d[2] * c - h[2] * r];
      let bon = true;
      for (let r = 0; r < 3 && bon; r++) for (let c = 0; c < 3 && bon; c++) bon = ok(MOTIF[r][c], cellule(c, r));
      if (!bon) continue;
      const cellules = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (MOTIF[r][c] !== '~') cellules.push(cellule(c, r));
      const av = [d[1] * h[2] - d[2] * h[1], d[2] * h[0] - d[0] * h[2], d[0] * h[1] - d[1] * h[0]];   // l'axe "avant" du motif (normale au plan)
      return { cellules, base: cellule(1, 2), avantX: av[0] !== 0 };
    }
  }
  return null;
}

// ---------------------------------------------------------------- methodes melangees a IA
export const METHODES_BOSS = {
  initBoss(d) {
    if (this.type === 'wither') {
      this.invul = d.invulnerable ?? 0; this.casse = 0; this.tetes = [{ cible: null, prochain: 0, oisif: 0 }, { cible: null, prochain: 0, oisif: 0 }];
      this.tetesLacet = [this.a.lacet, this.a.lacet]; this.tetesTangage = [0, 0];
      if (this.invul > 0) this.a.vie = this.a.vieMax / 3;   // WitherBoss.makeInvulnerable : un tiers de sa vie
    }
    if (this.type === 'ender_dragon') {
      const a = this.a, sim = this.sim;
      this.dyaw = wrap(a.lacet + 180); this.dyawAcc = 0; this.dv = [0, 0, 0]; this.flap = 0; this.grogne = 100; this.ambiant = 0; this.hist = []; this.histL = [];
      const f = sim.config.fontaine ?? null;
      this.centre = d.centre ? [d.centre[0], d.centre[1]] : f ? [f[0], f[2]] : [a.x, a.z];
      this.perchoirFixe = d.perchoir ?? null; this.noeuds = null; this.phase = 'cercle'; this.ph = { horaire: false }; this.flammes = 0; this.mortT = -1;
      this.cristaux = d.cristaux ?? null;
    }
  },
  installerBoss(add) {
    if (this.type === 'wither') { add(0, 'witherRien', MOVE | LOOK); add(2, 'witherTir', MOVE | LOOK); add(5, 'volFlane', MOVE); add(6, 'regardeJoueur', LOOK); add(7, 'regardeAutour', LOOK); this.a.vole = true; return true; }
    if (this.type === 'ender_dragon') { this.a.vole = true; return true; }
    return false;
  },
  estBoss() { return this.type === 'wither' || this.type === 'ender_dragon'; },

  // ================================================================ WITHER
  powered() { return this.a.vie <= this.a.vieMax / 2; },
  peut_witherRien() { return this.invul > 0; },
  continue_witherRien() { return this.invul > 0; },
  tick_witherRien() { this.nav = null; this.navVol = null; },
  // RangedAttackGoal(1,0 ; 40 ; 40 ; 20) : la tete du milieu tire sur la cible ; la vitesse de la cible et 0,1 % de cranes bleus
  peut_witherTir() { return this.invul <= 0 && !!this.cible && this.cible.mort < 0; },
  continue_witherTir() { return this.peut_witherTir(); },
  debut_witherTir() { this.tirW = { attente: -1, vu: 0 }; },
  fin_witherTir() { this.navVol = null; },
  tick_witherTir() {
    const o = this.cible, T = this.tirW, d2 = this.dist2(o), voit = this.voit(o);
    T.vu = voit ? T.vu + 1 : 0;
    if (d2 <= 400 && T.vu >= 5) this.navVol = null; else if (!this.navVol || this.sim.temps >= this.navVol.prochain) { this.gravite = false; this.volVers(o.x, o.y + o.H * 0.5, o.z, 1.0); }
    this.regarder(o);
    if (--T.attente === 0) { if (!voit) return; this.tirerCrane(0, [o.x, o.y + (o.O) * 0.5, o.z], this.h.flottant() < 0.001); T.attente = 40; }
    else if (T.attente < 0) T.attente = 40;
  },
  // WitherBoss.getHeadX/Y/Z : la tete du milieu a 3 blocs, les tetes de cote a 2,2 de haut et 1,3 de cote (x echelle)
  teteWither(i) {
    const a = this.a;
    if (i === 0) return [a.x, a.y + 3, a.z];
    const ang = (a.lacet + 180 * (i - 1)) * RAD;
    return [a.x + Math.cos(ang) * 1.3, a.y + 2.2, a.z + Math.sin(ang) * 1.3];
  },
  // performRangedAttack : un crane depuis la tete i vers le point ; son du tir (evenement 1024) ; acceleration 0,1 (AbstractHurtingProjectile)
  tirerCrane(i, vers, dangereux) {
    const sim = this.sim, t = this.teteWither(i), dir = [vers[0] - t[0], vers[1] - t[1], vers[2] - t[2]], L = Math.hypot(...dir) || 1;
    sim.son('entity.wither.shoot', this.a.x, this.a.y, this.a.z, 2, 1 + (this.h.flottant() - this.h.flottant()) * 0.2);
    const e = sim.entites.proj.creer('crane', this.a, [t[0], t[1] - 0.15625, t[2]], dir.map((c) => c / L * 0.1), { sansHerite: true, acc: 0.1, dangereux: !!dangereux });
    this.stat('cranes'); journal(sim, `${this.a.nom} tire un crane${dangereux ? ' bleu' : ''} (tete ${['du milieu', 'droite', 'gauche'][i]})`);
    return e;
  },
  // WitherBoss.aiStep (avant le deplacement) : vy x 0,6 ; il monte au-dessus de la cible (5 blocs tant qu'il n'est pas a moitie mort) et s'en
  // approche a 3 blocs (0,3 par tick, x 0,6 de la vitesse) ; le corps suit la vitesse
  tickWitherAvant() {
    const a = this.a, o = this.invul > 0 ? null : this.cible;
    a.vy *= 0.6;
    if (o && o.mort < 0) {
      let yd = a.vy;
      if (a.y < o.y || (!this.powered() && a.y < o.y + 5)) { yd = Math.max(0, yd); yd += 0.3 - yd * 0.6; }
      a.vy = yd;
      const dx = o.x - a.x, dz = o.z - a.z;
      if (dx * dx + dz * dz > 9) { const L = Math.hypot(dx, dz); a.vx += dx / L * 0.3 - a.vx * 0.6; a.vz += dz / L * 0.3 - a.vz * 0.6; }
    }
    if (a.vx * a.vx + a.vz * a.vz > 0.05) a.lacet = Math.atan2(a.vz, a.vx) / RAD - 90;
  },
  // WitherBoss.customServerAiStep : charge (invulnerable, +10 de vie toutes les 10 ticks, puis l'explosion de puissance 7 et le son), tetes de cote,
  // casse des blocs apres un coup, +1 de vie par seconde ; particules de fumee aux tetes, nuage bleu pendant la charge
  tickWither() {
    const a = this.a, sim = this.sim, h = this.h;
    for (let i = 0; i < 3; i++) { const t = this.teteWither(i); sim.particule('smoke', t[0] + h.gaussien() * 0.3, t[1] + h.gaussien() * 0.3, t[2] + h.gaussien() * 0.3, 0, 0, 0, 1); if (this.powered() && h.entierBorne(4) === 0) sim.particule('entity_effect|0.7,0.7,0.5', t[0] + h.gaussien() * 0.3, t[1] + h.gaussien() * 0.3, t[2] + h.gaussien() * 0.3, 0, 0, 0, 1); }
    if (this.invul > 0) {
      for (let i = 0; i < 3; i++) sim.particule('entity_effect|0.7,0.7,0.9', a.x + h.gaussien(), a.y + h.flottant() * 3.3, a.z + h.gaussien(), 0, 0, 0, 1);
      const reste = this.invul - 1;
      if (reste <= 0) {
        exploser(sim, a.x, a.y + a.O, a.z, { puissance: 7, casseBlocs: sim.regles.valeur('ia.explosionCasse', true), source: 'wither', exclure: a.nom });
        sim.son('entity.wither.spawn', a.x, a.y, a.z, 1, 1);
        this.stat('explosions'); journal(sim, `${a.nom} : fin de la charge, explosion de puissance 7`);
      }
      this.invul = reste;
      if (sim.temps % 10 === 0) a.vie = Math.min(a.vieMax, a.vie + 10);
      return;
    }
    // tetes de cote : cible au hasard (vivant non mort-vivant a 20 x 8 x 20, visible), tir toutes les 40 a 59 ticks a 30 blocs ; en normal et
    // difficile, apres 16 essais sans cible, un crane bleu au hasard autour (+-10, +-5)
    for (let k = 0; k < 2; k++) {
      const T = this.tetes[k];
      if (sim.temps < T.prochain) continue;
      T.prochain = sim.temps + 10 + h.entierBorne(10);
      const oisif = this.difficulte() >= 2;
      if (oisif) T.oisif++;
      if (oisif && T.oisif > 15 + 1) { this.tirerCrane(k + 1, [a.x - 10 + h.reel() * 20, a.y - 5 + h.reel() * 10, a.z - 10 + h.reel() * 20], true); T.oisif = 0; }
      const o = T.cible;
      if (o) {
        if (o.mort < 0 && this.dist2(o) <= 900 && this.voit(o)) { this.tirerCrane(k + 1, [o.x, o.y + o.O * 0.5, o.z], false); T.prochain = sim.temps + 40 + h.entierBorne(20); T.oisif = 0; }
        else T.cible = null;
      } else {
        const l = this.autres().filter((q) => !MORTS_VIVANTS.has(this.typeDe(q)) && q.typeCreature !== 'end_crystal' && Math.abs(q.x - a.x) <= 20 && Math.abs(q.y - a.y) <= 8 && Math.abs(q.z - a.z) <= 20 && this.voit(q));
        if (l.length) T.cible = l[h.entierBorne(l.length)];
      }
    }
    // tetes qui tournent vers leur cible (WitherBoss.rotlerp : 10 degres en lacet, 40 en tangage), sinon vers le corps
    for (let k = 0; k < 2; k++) {
      const o = this.tetes[k].cible, t = this.teteWither(k + 1);
      if (o && o.mort < 0) {
        const xd = o.x - t[0], yd = o.y + o.O - t[1], zd = o.z - t[2], sd = Math.hypot(xd, zd);
        this.tetesTangage[k] += Math.max(-40, Math.min(40, wrap(-Math.atan2(yd, sd) / RAD - this.tetesTangage[k])));
        this.tetesLacet[k] += Math.max(-10, Math.min(10, wrap(Math.atan2(zd, xd) / RAD - 90 - this.tetesLacet[k])));
      } else this.tetesLacet[k] += Math.max(-10, Math.min(10, wrap(a.lacet - this.tetesLacet[k])));
    }
    if (this.casse > 0 && --this.casse === 0 && sim.regles.valeur('ia.explosionCasse', true)) this.witherCasse();
    if (sim.temps % 20 === 0) a.vie = Math.min(a.vieMax, a.vie + 1);
  },
  // destroyBlocks : les blocs de sa boite (largeur / 2 + 1 de cote, hauteur) sauf #wither_immune ; son 1022
  witherCasse() {
    const a = this.a, sim = this.sim, w = Math.floor(a.L / 2 + 1), hh = Math.floor(a.H), X = Math.floor(a.x), Y = Math.floor(a.y), Z = Math.floor(a.z);
    const immun = sim.d.etiquette?.('wither_immune');
    let n = 0;
    for (let x = X - w; x <= X + w; x++) for (let y = Y; y <= Y + hh; y++) for (let z = Z - w; z <= Z + w; z++) {
      const e = sim.monde.etatEn(x, y, z);
      if (e < 0 || /air$/.test(sim.d.nomBloc(e)) || immun?.has(sim.d.blocDe(e))) continue;
      sim.casser(x, y, z, { butin: true }); n++;
    }
    if (n) { sim.son('entity.wither.break_block', a.x, a.y, a.z, 1, 1); journal(sim, `${a.nom} casse ${n} blocs autour de lui`); }
  },
  // WitherBoss.hurtServer : rien pendant la charge, pas de fleches une fois a moitie mort (armure), rien des morts-vivants ; un coup arme la casse
  refuseDegats(source) {
    if (this.refuseDegatsWarden()) return true;
    if (this.type === 'ender_dragon') return this.mortT >= 0 || this.phase === 'mourant';
    if (this.type !== 'wither') return false;
    if (this.invul > 0) return true;
    if (this.powered() && /^(fleche|trident)$/.test(String(source))) return true;
    if (/^mob:/.test(String(source)) && MORTS_VIVANTS.has(String(source).slice(4))) return true;
    if (this.casse <= 0) this.casse = 20;
    for (const T of this.tetes) T.oisif += 3;
    return false;
  },
  ciblesWither() {
    if (this.type !== 'wither') return false;
    const sim = this.sim;
    if (this.invul > 0) { this.cible = null; return true; }
    if (this.cible && (this.cible.mort >= 0 || this.dist2(this.cible) > 1600)) this.cible = null;
    if (this.cibleForcee) { const o = sim.acteurs.parNom.get(this.cibleForcee); this.cible = o && o.mort < 0 ? o : null; return true; }
    if (this.blessePar && this.blessePar.mort < 0 && sim.temps - this.blesseTick < 400 && !MORTS_VIVANTS.has(this.typeDe(this.blessePar))) { this.poserCible(this.blessePar); return true; }
    if (!this.cible) {   // NearestAttackableTarget(LivingEntity, non mort-vivant), sans delai, a 40 blocs
      let best = null, bd = Infinity;
      for (const o of this.autres()) { if (MORTS_VIVANTS.has(this.typeDe(o)) || o.typeCreature === 'end_crystal') continue; const d = this.dist2(o); if (d < bd && d <= 1600) { bd = d; best = o; } }
      if (best) this.poserCible(best);
    }
    return true;
  },

  // ================================================================ DRAGON
  // noeuds (EnderDragon.findClosestNode) : 12 a 60 blocs (+5), 8 a 40 (+15), 4 a 20 (+5) du centre, sur la hauteur du terrain
  noeudsDragon() {
    if (this.noeuds) return this.noeuds;
    const R = this.sim.regles.valeur('dragon.rayon', 60), [cx, cz] = this.centre, n = [];
    const base = this.solA(cx, cz) + 9;
    for (let i = 0; i < 24; i++) {
      const [r, pas, k, plus] = i < 12 ? [R, Math.PI / 12, i, 5] : i < 20 ? [R * 2 / 3, Math.PI / 8, i - 12, 15] : [R / 3, Math.PI / 4, i - 20, 5];
      const ang = 2 * (-Math.PI + pas * k), x = Math.floor(cx + r * Math.cos(ang)), z = Math.floor(cz + r * Math.sin(ang));
      n.push([x, Math.max(this.solA(x, z) + plus, base), z]);
    }
    return (this.noeuds = n);
  },
  // hauteur du terrain (MOTION_BLOCKING_NO_LEAVES) : le premier bloc solide ou liquide depuis le haut de la zone
  solA(x, z) {
    const sim = this.sim, m = sim.monde, X = Math.floor(x), Z = Math.floor(z);
    for (let y = m.y0 + m.sy - 1; y >= m.y0; y--) { const e = m.etatEn(X, y, Z); if (e < 0) continue; const nom = sim.d.nomBloc(e); if (/air$/.test(nom) || /_leaves$/.test(nom)) continue; if (sim.d.boites(e).length || sim.fluide(X, y, Z).type) return y + 1; }
    return Math.floor(this.a.y);
  },
  perchoir() { const p = this.perchoirFixe; return p ? [p[0] + 0.5, p[1], p[2] + 0.5] : [this.centre[0] + 0.5, this.solA(this.centre[0], this.centre[1]), this.centre[1] + 0.5]; },
  nbCristaux() { return this.sim.acteurs.liste.filter((o) => o.typeCreature === 'end_crystal' && o.mort < 0).length; },
  noeudProche(x, y, z) {
    const N = this.noeudsDragon(), d0 = this.nbCristaux() === 0 ? 12 : 0, p = [Math.floor(x), Math.floor(y), Math.floor(z)];
    let best = 0, bd = 10000;
    for (let i = d0; i < 24; i++) { const d = (N[i][0] - p[0]) ** 2 + (N[i][1] - p[1]) ** 2 + (N[i][2] - p[2]) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
  },
  // findPath : A* sur les adjacences (sans les noeuds exterieurs quand il n'y a plus de cristaux)
  cheminDragon(de, vers, dernier = null) {
    const N = this.noeudsDragon(), min = this.nbCristaux() === 0 ? 12 : 0, dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const g = new Array(24).fill(Infinity), vient = new Array(24).fill(-1), ferme = new Array(24).fill(false), ouv = [de];
    g[de] = 0; let proche = de;
    while (ouv.length) {
      let k = 0; for (let i = 1; i < ouv.length; i++) if (g[ouv[i]] + dist(N[ouv[i]], N[vers]) < g[ouv[k]] + dist(N[ouv[k]], N[vers])) k = i;
      const c = ouv[k]; ouv[k] = ouv[ouv.length - 1]; ouv.pop();
      if (c === vers) { proche = vers; break; }
      if (dist(N[c], N[vers]) < dist(N[proche], N[vers])) proche = c;
      ferme[c] = true;
      for (let i = min; i < 24; i++) if (ADJ[c] & (1 << i) && !ferme[i]) { const t = g[c] + dist(N[c], N[i]); if (t < g[i]) { g[i] = t; vient[i] = c; if (!ouv.includes(i)) ouv.push(i); } }
    }
    if (proche === de && de !== vers) return null;
    const l = [N[proche]]; let n = proche;
    while (vient[n] >= 0) { n = vient[n]; l.unshift(N[n]); }
    if (dernier) l.push(dernier);
    return { noeuds: l, i: 0 };
  },
  // getNextTarget : le noeud suivant, a une hauteur tiree entre la sienne et +20
  suivantDragon(p) { if (!p || p.i >= p.noeuds.length) return null; const c = p.noeuds[p.i++]; return [c[0], c[1] + this.h.flottant() * 20, c[2]]; },
  cheminCercle() {
    const ph = this.ph, a = this.a;
    if (this.h.entierBorne(8) === 0) { ph.horaire = !ph.horaire; ph.cible6 = 6; } else ph.cible6 = 0;
    const cur = this.noeudProche(a.x, a.y, a.z);
    let t = cur + ph.cible6 + (ph.horaire ? 1 : -1);
    t = this.nbCristaux() > 0 ? ((t % 12) + 12) % 12 : (((t - 12) & 7) + 12);
    const p = this.cheminDragon(cur, t); if (p) p.i++;
    return p;
  },
  joueursDragon() { return this.autres().filter((o) => this.typeDe(o) === 'joueur'); },
  phaseDragon(nom, o = {}) { if (this.phase !== nom) journal(this.sim, `${this.a.nom} : phase ${nom}`); this.phase = nom; this.ph = { horaire: this.ph?.horaire ?? false, ...o }; this.stat('phases'); },
  regardDragon() {   // getHeadLookVector
    const a = this.a; let p = 0;
    if (this.phase === 'atterrit' || this.phase === 'envol') { const q = this.perchoir(), d = Math.hypot(q[0] - a.x, q[1] - a.y, q[2] - a.z) / 4; p = -6 / Math.max(1, d) * 1.5 * 5; } else if (ASSIS.has(this.phase)) p = -45;
    const y = this.dyaw * RAD, t = p * RAD;
    return [-Math.sin(y) * Math.cos(t), -Math.sin(t), Math.cos(y) * Math.cos(t)].map((v) => -v);   // la tete du dragon regarde a l'oppose du lacet des mobs
  },
  // une phase par tick (doServerTick)
  tickPhase() {
    const a = this.a, sim = this.sim, ph = this.ph, pos = [a.x, a.y, a.z];
    const loin = (t) => (t ? (t[0] - pos[0]) ** 2 + (t[1] - pos[1]) ** 2 + (t[2] - pos[2]) ** 2 : 0);
    const P = this.perchoir(), joueurs = this.joueursDragon();
    const proche = (de, r = Infinity, f = () => true) => joueurs.filter((o) => (o.x - de[0]) ** 2 + (o.y - de[1]) ** 2 + (o.z - de[2]) ** 2 < r * r && f(o)).sort((p, q) => ((p.x - de[0]) ** 2 + (p.y - de[1]) ** 2 + (p.z - de[2]) ** 2) - ((q.x - de[0]) ** 2 + (q.y - de[1]) ** 2 + (q.z - de[2]) ** 2))[0] ?? null;
    switch (this.phase) {
      case 'cercle': {   // DragonHoldingPatternPhase
        const dt = loin(ph.cible);
        if (dt < 100 || dt > 22500) {
          let choisi = false;
          if (ph.chemin && ph.chemin.i >= ph.chemin.noeuds.length) {
            const n = this.nbCristaux();
            if (this.h.entierBorne(n + 3) === 0) { this.phaseDragon('approche'); choisi = true; }
            else {
              const j = proche([P[0] - 0.5, P[1], P[2] - 0.5]);
              if (j) { const d = ((j.x - P[0]) ** 2 + (j.y - P[1] - 0.5) ** 2 + (j.z - P[2]) ** 2) / 512; if (this.h.entierBorne(Math.floor(d + 2)) === 0 || this.h.entierBorne(n + 2) === 0) { this.phaseDragon('mitraille', { joueur: j, charge: 0 }); this.debutMitraille(j); choisi = true; } }
            }
          }
          if (!choisi) { if (!ph.chemin || ph.chemin.i >= ph.chemin.noeuds.length) ph.chemin = this.cheminCercle(); const t = this.suivantDragon(ph.chemin); if (t) ph.cible = t; }
        }
        break;
      }
      case 'mitraille': {   // DragonStrafePlayerPhase : vers le joueur ; quand il le voit dans un cone de 10 degres depuis 5 ticks : une boule de feu
        const j = ph.joueur;
        if (!j || j.mort >= 0) { this.phaseDragon('cercle'); break; }
        if (ph.chemin && ph.chemin.i >= ph.chemin.noeuds.length) { const d = Math.hypot(j.x - a.x, j.z - a.z), ho = Math.min(0.4 + d / 80 - 1, 10); ph.cible = [j.x, j.y + ho, j.z]; }
        const dt = loin(ph.cible);
        if (dt < 100 || dt > 22500) { if (!ph.chemin || ph.chemin.i >= ph.chemin.noeuds.length) ph.chemin = this.cheminCercle(); const t = this.suivantDragon(ph.chemin); if (t) ph.cible = t; }
        const d2 = this.dist2(j);
        if (d2 < 4096 && rayonBloc(a.lec, [a.x, a.y + 6.8, a.z], [j.x, j.y + j.O, j.z]) === null) {
          ph.charge++;
          const r = this.dyaw * RAD, dir = [Math.sin(r), -Math.cos(r)], vis = [j.x - a.x, j.z - a.z], L = Math.hypot(...vis) || 1;
          const ang = Math.acos(Math.max(-1, Math.min(1, (dir[0] * vis[0] + dir[1] * vis[1]) / L))) / RAD + 0.5;
          if (ph.charge >= 5 && ang >= 0 && ang < 10) {
            const t = this.teteDragon(), v = [Math.sin(r), 0, -Math.cos(r)];
            const de = [t[0] - v[0], t[1] + 1, t[2] - v[2]], vers = [j.x - de[0], j.y + 0.9 - de[1], j.z - de[2]], n = Math.hypot(...vers) || 1;
            sim.son('entity.ender_dragon.shoot', de[0], de[1], de[2], 10, 1);
            sim.entites.proj.creer('boule_dragon', a, [de[0], de[1] - 0.5, de[2]], vers.map((c) => c / n * 0.1), { sansHerite: true, acc: 0.1 });
            this.stat('boulesDragon'); journal(sim, `${a.nom} crache une boule de feu sur ${j.nom}`);
            ph.charge = 0; this.phaseDragon('cercle');
          }
        } else if (ph.charge > 0) ph.charge--;
        break;
      }
      case 'approche': {   // DragonLandingApproachPhase : un chemin jusqu'au noeud oppose au joueur, puis le perchoir
        const dt = loin(ph.cible);
        if (dt < 100 || dt > 22500) {
          if (!ph.chemin || ph.chemin.i >= ph.chemin.noeuds.length) {
            const cur = this.noeudProche(a.x, a.y, a.z), j = proche([P[0] - 0.5, P[1], P[2] - 0.5]);
            let t;
            if (j) { const v = [j.x - this.centre[0], j.z - this.centre[1]], L = Math.hypot(...v) || 1; t = this.noeudProche(this.centre[0] - v[0] / L * 40, P[1] + 41, this.centre[1] - v[1] / L * 40); }
            else t = this.noeudProche(this.centre[0] + 40, P[1], this.centre[1]);
            ph.chemin = this.cheminDragon(cur, t, [Math.floor(P[0]), Math.floor(P[1]), Math.floor(P[2])]); if (ph.chemin) ph.chemin.i++;
          }
          const t = this.suivantDragon(ph.chemin); if (t) ph.cible = t;
          if (ph.chemin && ph.chemin.i >= ph.chemin.noeuds.length) this.phaseDragon('atterrit');
        }
        break;
      }
      case 'atterrit': { ph.cible ??= P; if (loin(ph.cible) < 1) { this.flammes = 0; this.phaseDragon('scan', { temps: 0 }); sim.son('entity.ender_dragon.growl', a.x, a.y, a.z, 2.5, 0.8 + sim.hasard.flottant() * 0.3); } break; }
      case 'scan': {   // DragonSittingScanningPhase : un joueur a 20 blocs (10 de haut) : il se tourne vers lui, rugit apres 25 ticks ; sinon charge (150) ou envol apres 100
        ph.temps++;
        const j = proche(pos, 20, (o) => Math.abs(o.y - a.y) <= 10);
        if (j) {
          if (ph.temps > 25) this.phaseDragon('rugit', { ticks: 0 });
          else {
            const r = this.dyaw * RAD, dir = [Math.sin(r), -Math.cos(r)], v = [j.x - a.x, j.z - a.z], L = Math.hypot(...v) || 1;
            const ang = Math.acos(Math.max(-1, Math.min(1, (dir[0] * v[0] + dir[1] * v[1]) / L))) / RAD + 0.5;
            if (ang < 0 || ang > 10) {
              const t = this.teteDragon(), xd = j.x - t[0], zd = j.z - t[2];
              const delta = Math.max(-100, Math.min(100, wrap(180 - Math.atan2(xd, zd) / RAD - this.dyaw)));
              this.dyawAcc *= 0.8; const dd = Math.min(Math.hypot(xd, zd) + 1, 40); this.dyawAcc += delta * (0.7 / dd / dd); this.dyaw += this.dyawAcc;
            }
          }
        } else if (ph.temps >= 100) { const c = proche(pos, 150); if (c) this.phaseDragon('charge', { cible: [c.x, c.y, c.z], depuis: 0 }); else this.phaseDragon('envol', { premier: true }); }
        break;
      }
      case 'rugit': { if (ph.ticks === 0) sim.son('entity.ender_dragon.growl', a.x, a.y, a.z, 2.5, 0.8 + sim.hasard.flottant() * 0.3); if (++ph.ticks > 40) this.phaseDragon('souffle', { ticks: 0 }); break; }   // DragonSittingAttackingPhase
      case 'souffle': {   // DragonSittingFlamingPhase : au 10e tick, un nuage de souffle de rayon 5 (200 ticks) devant la tete, au sol ; 200 ticks
        ph.ticks++;
        if (ph.ticks === 1) this.flammes++;
        const t = this.teteDragon(), l = [t[0] - a.x, t[2] - a.z], L = Math.hypot(...l) || 1;
        if (ph.ticks % 2 === 0 && ph.ticks < 10) for (let i = 0; i < 8; i++) { const h = sim.hasard; sim.particule('dragon_breath', t[0] + l[0] / L * 2 + h.gaussien() * 0.5, t[1] + h.gaussien() * 0.5, t[2] + l[1] / L * 2 + h.gaussien() * 0.5, l[0] / L * 0.08 + h.gaussien() * 0.04, -0.12, l[1] / L * 0.08 + h.gaussien() * 0.04, 1); }
        if (ph.ticks === 10) {
          const x = t[0] + l[0] / L * 2.5, z = t[2] + l[1] / L * 2.5;
          let y = t[1] + 0.5; while (y > sim.monde.y0) { const e = sim.monde.etatEn(Math.floor(x), Math.floor(y), Math.floor(z)); if (e >= 0 && !/air$/.test(sim.d.nomBloc(e))) break; y -= 1; }
          sim.boss.nuage([x, Math.floor(y) + 1, z], 5, 200, true);
          sim.son('entity.ender_dragon.shoot', x, y, z, 5, 1); journal(sim, `${a.nom} souffle (nuage de rayon 5)`);
        }
        if (ph.ticks >= 200) this.phaseDragon(this.flammes >= 4 ? 'envol' : 'scan', this.flammes >= 4 ? { premier: true } : { temps: 0 });
        break;
      }
      case 'charge': {   // DragonChargePlayerPhase : droit sur le joueur a 3 ; 10 ticks apres l'avoir atteint, le cercle reprend
        if (!ph.cible) this.phaseDragon('cercle');
        else if (ph.depuis > 0) { if (++ph.depuis >= 10) this.phaseDragon('cercle'); }
        else { const dt = loin(ph.cible); if (dt < 100 || dt > 22500) ph.depuis++; }
        break;
      }
      case 'envol': {   // DragonTakeoffPhase : un chemin vers le noeud dans la direction du regard ; il s'eloigne de 10 blocs du perchoir
        if (!ph.premier && ph.chemin) { if ((P[0] - a.x) ** 2 + (P[1] - a.y) ** 2 + (P[2] - a.z) ** 2 >= 100) this.phaseDragon('cercle'); }
        else {
          ph.premier = false;
          const cur = this.noeudProche(a.x, a.y, a.z), r = this.regardDragon();
          let t = this.noeudProche(this.centre[0] - r[0] * 40, P[1] + 41, this.centre[1] - r[2] * 40);
          t = this.nbCristaux() > 0 ? ((t % 12) + 12) % 12 : (((t - 12) & 7) + 12);
          ph.chemin = this.cheminDragon(cur, t) ?? { noeuds: [], i: 0 }; if (ph.chemin.noeuds.length) ph.chemin.i++;
          const tt = this.suivantDragon(ph.chemin); if (tt) ph.cible = tt;
        }
        break;
      }
      case 'mourant': {   // DragonDeathPhase : vers le perchoir a 3 ; la mort commence a moins de 10 blocs (ou au-dela de 150)
        ph.cible ??= this.perchoir();
        const dt = loin(ph.cible);
        if (dt < 100 || dt > 22500) this.commencerMortDragon();
        break;
      }
      default: break;
    }
  },
  debutMitraille(j) {   // DragonStrafePlayerPhase.setTarget
    const a = this.a, cur = this.noeudProche(a.x, a.y, a.z), t = this.noeudProche(j.x, j.y, j.z);
    const sd = Math.hypot(Math.floor(j.x) - a.x, Math.floor(j.z) - a.z), ho = Math.min(0.4 + sd / 80 - 1, 10);
    this.ph.chemin = this.cheminDragon(cur, t, [Math.floor(j.x), Math.floor(j.y + ho), Math.floor(j.z)]); if (this.ph.chemin) this.ph.chemin.i++;
    const tt = this.suivantDragon(this.ph.chemin); if (tt) this.ph.cible = tt;
  },
  // tete (partie 0) : 6,5 devant, decalee du lacet x 0,01 de l'acceleration ; inclinaison de l'historique de vol
  inclinaisonDragon() { const h = this.hist, y5 = h[Math.max(0, h.length - 6)] ?? this.a.y, y10 = h[Math.max(0, h.length - 11)] ?? this.a.y; return (y5 - y10) * 10 * RAD; },
  teteDragon() {
    const a = this.a, tl = this.inclinaisonDragon(), r2 = this.dyaw * RAD - this.dyawAcc * 0.01, hy = ASSIS.has(this.phase) ? -1 : ((this.hist[Math.max(0, this.hist.length - 6)] ?? a.y) - a.y);
    return [a.x + Math.sin(r2) * 6.5 * Math.cos(tl), a.y + hy + Math.sin(tl) * 6.5, a.z - Math.cos(r2) * 6.5 * Math.cos(tl)];
  },
  // EnderDragon.aiStep : sons, battement, soin par le cristal, phase, pilotage vers la cible de la phase, contacts, murs
  tickDragon() {
    const a = this.a, sim = this.sim, h = this.h;
    if (this.mortT >= 0) return this.tickMortDragon();
    if (h.entierBorne(1000) < this.ambiant++) { this.ambiant = -80; sim.son('entity.ender_dragon.ambient', a.x, a.y, a.z, 5, (h.flottant() - h.flottant()) * 0.2 + 1); }
    const avant = Math.cos(this.flap * Math.PI * 2), vh = Math.hypot(this.dv[0], this.dv[2]);
    this.flap += ASSIS.has(this.phase) ? 0.1 : this.dansMur ? 0.2 / (vh * 10 + 1) * 2 ** this.dv[1] * 0.5 : 0.2 / (vh * 10 + 1) * 2 ** this.dv[1];
    if (avant <= -0.3 && Math.cos(this.flap * Math.PI * 2) >= -0.3) sim.son('entity.ender_dragon.flap', a.x, a.y, a.z, 5, 0.8 + sim.hasard.flottant() * 0.3);
    if (!ASSIS.has(this.phase) && --this.grogne < 0) { this.grogne = 200 + h.entierBorne(200); sim.son('entity.ender_dragon.growl', a.x, a.y, a.z, 2.5, 0.8 + sim.hasard.flottant() * 0.3); }
    // checkCrystals : le cristal le plus proche dont la boite touche celle du dragon elargie de 32 ; +1 de vie toutes les 10 ticks
    if (this.cristalSoin && (this.cristalSoin.mort >= 0)) this.cristalSoin = null;
    if (this.cristalSoin && sim.temps % 10 === 0 && a.vie < a.vieMax) a.vie = Math.min(a.vieMax, a.vie + 1);
    if (h.entierBorne(10) === 0) { const c = this.sim.acteurs.liste.filter((o) => o.typeCreature === 'end_crystal' && o.mort < 0 && Math.abs(o.x - a.x) < 32 + a.L / 2 + 1 && Math.abs(o.z - a.z) < 32 + a.L / 2 + 1 && o.y + 2 > a.y - 32 && o.y < a.y + a.H + 32).sort((p, q) => this.dist2(p) - this.dist2(q))[0] ?? null; this.cristalSoin = c; }
    if (this.cristalSoin) sim.replay.trait(sim.temps, 'cristal', [this.cristalSoin.x, this.cristalSoin.y, this.cristalSoin.z], [a.x, a.y, a.z]);   // EnderDragonRenderer.renderCrystalBeams
    this.hist.push(a.y); if (this.hist.length > 64) this.hist.shift();
    this.histL.push(this.dyaw); if (this.histL.length > 64) this.histL.shift();   // DragonFlightHistory : (y, lacet)
    this.tickPhase();
    const t = this.ph.cible;
    if (t) {   // pilotage (EnderDragon.aiStep) : y +-vitesse de phase x 0,01, lacet (0,7 / v / v), vitesse 0,06 x (alignement x span + 1 - span)
      const xd = t[0] - a.x, zd = t[2] - a.z; let yd = t[1] - a.y;
      const dist2 = xd * xd + yd * yd + zd * zd, max = VITESSE_PHASE[this.phase] ?? 0.6, hor = Math.hypot(xd, zd);
      if (hor > 0) yd = Math.max(-max, Math.min(max, yd / hor));
      this.dv[1] += yd * 0.01;
      const nrm = (v) => { const l = Math.hypot(...v); return l < 1e-4 ? [0, 0, 0] : v.map((c) => c / l); };
      const vis = nrm([xd, t[1] - a.y, zd]), r = this.dyaw * RAD, dir = nrm([Math.sin(r), this.dv[1], -Math.cos(r)]);
      const dot = Math.max(0, (vis[0] * dir[0] + vis[1] * dir[1] + vis[2] * dir[2] + 0.5) / 1.5);
      if (Math.abs(xd) > 1e-5 || Math.abs(zd) > 1e-5) {
        const rot = Math.hypot(this.dv[0], this.dv[2]) + 1, tour = this.phase === 'atterrit' ? Math.min(rot, 40) / rot : 0.7 / Math.min(rot, 40) / rot;
        const delta = Math.max(-50, Math.min(50, wrap(180 - Math.atan2(xd, zd) / RAD - this.dyaw)));
        this.dyawAcc *= 0.8; this.dyawAcc += delta * tour; this.dyaw += this.dyawAcc * 0.1;
      }
      const span = 2 / (dist2 + 1), vit = 0.06 * (dot * span + (1 - span)), r2 = this.dyaw * RAD;
      this.dv[0] += vit * Math.sin(r2); this.dv[2] += -vit * Math.cos(r2);
      const k = this.dansMur ? 0.8 : 1;
      a.x += this.dv[0] * k; a.y += this.dv[1] * k; a.z += this.dv[2] * k;
      const act = nrm(this.dv), glisse = 0.8 + 0.15 * ((act[0] * dir[0] + act[1] * dir[1] + act[2] * dir[2]) + 1) / 2;
      this.dv[0] *= glisse; this.dv[1] *= 0.91; this.dv[2] *= glisse;
    }
    this.dyaw = wrap(this.dyaw); a.lacet = wrap(this.dyaw + 180); a.lacetTete = a.lacet; a.vx = this.dv[0]; a.vy = this.dv[1]; a.vz = this.dv[2];
    this.tangageCorps = -(this.hist[Math.max(0, this.hist.length - 6)] - this.hist[Math.max(0, this.hist.length - 11)]) * 10;
    this.contactsDragon(); this.mursDragon();
  },
  // EnderDragon.knockBack / hurt : les ailes (4 x 2, elargies de 4, 2, 4, descendues de 2) repoussent de 4 (et 0,2 vers le haut), 5 de degats en
  // vol ; la tete et le cou (elargis de 1) font 10 de degats
  contactsDragon() {
    const a = this.a, sim = this.sim, r = this.dyaw * RAD, s1 = Math.sin(r), c1 = Math.cos(r), t = this.teteDragon();
    const boite = (x, y, z, w, hh, gx = 0, gy = 0, gz = 0, dy = 0) => [x - w / 2 - gx, y - gy + dy, z - w / 2 - gz, x + w / 2 + gx, y + hh + gy + dy, z + w / 2 + gz];
    const ailes = [boite(a.x + c1 * 4.5, a.y + 2, a.z + s1 * 4.5, 4, 2, 4, 2, 4, -2), boite(a.x - c1 * 4.5, a.y + 2, a.z - s1 * 4.5, 4, 2, 4, 2, 4, -2)];
    const cou = [t[0] - s1, t[1], t[2] + c1];
    const tetes = [boite(t[0], t[1], t[2], 1, 1, 1, 1, 1), boite(cou[0], cou[1], cou[2], 3, 3, 1, 1, 1)];
    const touche = (b, o) => { const q = o.boite(); return q[3] > b[0] && q[0] < b[3] && q[4] > b[1] && q[1] < b[4] && q[5] > b[2] && q[2] < b[5]; };
    if (a.hurtTime > 0) return;
    for (const o of this.autres()) {
      if (o.typeCreature === 'end_crystal') continue;
      if (ailes.some((b) => touche(b, o))) {
        const dx = o.x - a.x, dz = o.z - a.z, d = Math.max(dx * dx + dz * dz, 0.1);
        o.vx += dx / d * 4; o.vy += 0.2; o.vz += dz / d * 4; o.auSol = false;
        if (!ASSIS.has(this.phase) && sim.temps - (o.dernierCoupDragon ?? -1e9) > 2) { o.dernierCoupDragon = sim.temps; o.frappe(5, 'mob:ender_dragon', a.x - o.x, a.z - o.z, 0); }
        this.stat('coupsAiles');
      } else if (tetes.some((b) => touche(b, o))) { o.frappe(10, 'mob:ender_dragon', a.x - o.x, a.z - o.z, 0); this.stat('coupsTete'); }
    }
  },
  // checkWalls (tete, cou, corps) : avec mobGriefing, les blocs ni #dragon_immune ni #dragon_transparent sont detruits (evenement 2008) ;
  // un bloc immune ralentit (inWall)
  mursDragon() {
    const a = this.a, sim = this.sim, r = this.dyaw * RAD, s1 = Math.sin(r), c1 = Math.cos(r), t = this.teteDragon();
    const imm = sim.d.etiquette?.('dragon_immune'), tr = sim.d.etiquette?.('dragon_transparent'), casse = sim.regles.valeur('ia.explosionCasse', true);
    const B = [[t[0], t[1], t[2], 1, 1], [t[0] - s1, t[1], t[2] + c1, 3, 3], [a.x + s1 * 0.5, a.y, a.z - c1 * 0.5, 5, 3]];
    let mur = false, detruit = false;
    for (const [x, y, z, w, hh] of B) {
      for (let X = Math.floor(x - w / 2); X <= Math.floor(x + w / 2); X++) for (let Y = Math.floor(y); Y <= Math.floor(y + hh); Y++) for (let Z = Math.floor(z - w / 2); Z <= Math.floor(z + w / 2); Z++) {
        const e = sim.monde.etatEn(X, Y, Z);
        if (e < 0 || /air$/.test(sim.d.nomBloc(e)) || tr?.has(sim.d.blocDe(e))) continue;
        if (casse && !imm?.has(sim.d.blocDe(e))) { sim.poser(X, Y, Z, 'minecraft:air', 3); detruit = true; } else mur = true;
      }
    }
    this.dansMur = mur;
    if (detruit) { const b = B[2]; sim.particule('explosion', b[0] + (this.h.flottant() - 0.5) * 5, b[1] + this.h.flottant() * 3, b[2] + (this.h.flottant() - 0.5) * 5, 0, 0, 0, 1); this.stat('blocsDragon'); }
  },
  // la partie du dragon que le coup touche (EnderDragonPart : tete 1 x 1, seule a prendre les degats entiers) : un coup d'un joueur suit son
  // regard (rayon de l'oeil, longueur joueur.portee : la premiere partie coupee parmi tete, cou 3 x 3, corps 5 x 3, ailes 4 x 2) ; une fleche ou un trident :
  // le segment de son dernier tick contre les parties elargies de 0,3 (ProjectileUtil.getEntityHitResult)
  // les 8 EnderDragonPart (Horizon game/dragon.rs place_dragon_parts, PART_SIZES) : tete 1 x 1, cou 3 x 3, corps 5 x 3, queue 3 x (2 x 2),
  // ailes 4 x 2 ; positions depuis le lacet, l'inclinaison et l'historique de vol (y et lacet, 64 echantillons)
  partiesDragon() {
    const a = this.a, h = this.hist, hl = this.histL ?? [], ech = (k) => [h[Math.max(0, h.length - 1 - k)] ?? a.y, hl[Math.max(0, hl.length - 1 - k)] ?? this.dyaw];
    const w180 = (v) => { v = ((v + 180) % 360 + 360) % 360 - 180; return v; };
    const tl = (ech(5)[0] - ech(10)[0]) * 10 * RAD, ct = Math.cos(tl), st = Math.sin(tl), r1 = this.dyaw * RAD, s1 = Math.sin(r1), c1 = Math.cos(r1);
    const r2 = this.dyaw * RAD - this.dyawAcc * 0.01, s2 = Math.sin(r2), c2 = Math.cos(r2), yo = ASSIS.has(this.phase) ? -1 : ech(5)[0] - ech(0)[0];
    const B = (x, y, z, w, hh) => [a.x + x - w / 2, a.y + y, a.z + z - w / 2, a.x + x + w / 2, a.y + y + hh, a.z + z + w / 2];
    const out = [['tete', B(s2 * 6.5 * ct, yo + st * 6.5, -c2 * 6.5 * ct, 1, 1)], ['cou', B(s2 * 5.5 * ct, yo + st * 5.5, -c2 * 5.5 * ct, 3, 3)], ['corps', B(s1 * 0.5, 0, -c1 * 0.5, 5, 3)]];
    const p1 = ech(5);
    for (let i = 0; i < 3; i++) {
      const p0 = ech(12 + i * 2), rot = this.dyaw * RAD + w180(p0[1] - p1[1]) * RAD, ss = Math.sin(rot), cc = Math.cos(rot), dd = (i + 1) * 2;
      out.push(['queue', B(-(s1 * 1.5 + ss * dd) * ct, p0[0] - p1[0] - (dd + 1.5) * st + 1.5, (c1 * 1.5 + cc * dd) * ct, 2, 2)]);
    }
    out.push(['aile', B(c1 * 4.5, 2, s1 * 4.5, 4, 2)], ['aile', B(-c1 * 4.5, 2, -s1 * 4.5, 4, 2)]);
    return out;
  },
  partieTouchee(source) {
    if (this.a.partieCoup && this.a.partieCoup.t === this.sim.temps) return this.a.partieCoup.nom;   // projectile : la partie qu'il a touchee (projectiles.js)
    const a = this.a, c = a.dernierCoup, t = this.teteDragon(), r = this.dyaw * RAD, s1 = Math.sin(r), c1 = Math.cos(r);
    if (!c || c.t !== this.sim.temps) return null;
    const boite = (x, y, z, w, hh) => [x - w / 2, y, z - w / 2, x + w / 2, y + hh, z + w / 2];
    const tete = boite(t[0], t[1], t[2], 1, 1);
    const r2 = this.dyaw * RAD - this.dyawAcc * 0.01, ct = Math.cos(this.inclinaisonDragon());   // tete (6,5) et cou (5,5) sur le meme axe (EnderDragon.aiStep : tickPart)
    const parties = this.partiesDragon();   // les 8 parties du jeu
    void r2; void ct; void s1; void c1;
    // rayon contre les boites (methode des tranches) : la premiere partie coupee (egalite : la premiere de la liste)
    const premiere = (oe, d, max, marge) => {
      let best = null, bt = Infinity;
      for (const [nom, b0] of parties) {
        const b = b0.map((v, i) => v + (i < 3 ? -marge : marge));
        let t0 = 0, t1 = max, ok = true;
        for (let k = 0; k < 3 && ok; k++) {
          if (Math.abs(d[k]) < 1e-9) { if (oe[k] < b[k] || oe[k] > b[k + 3]) ok = false; continue; }
          let u = (b[k] - oe[k]) / d[k], v = (b[k + 3] - oe[k]) / d[k]; if (u > v) [u, v] = [v, u];
          t0 = Math.max(t0, u); t1 = Math.min(t1, v); if (t0 > t1) ok = false;
        }
        if (ok && t0 < bt - 1e-6) { bt = t0; best = nom; }
      }
      return best;
    };
    if (/^(fleche|trident)$/.test(String(source))) {
      // la fleche qui vient de toucher (encore dans la liste, ce tick) : son segment du tick contre les parties elargies de 0,3 (ProjectileUtil)
      const x = a.x + c.dx, z = a.z + c.dz, E = this.sim.entites;
      const f = E.liste.filter((e) => (e.type === 'fleche' || e.type === 'trident') && !e.plantee && !E._fini?.has(e)).map((e) => { const v2 = e.vx * e.vx + e.vz * e.vz, u = v2 > 0 ? Math.max(0, Math.min(1, ((x - e.x) * e.vx + (z - e.z) * e.vz) / v2)) : 0; return { e, d: Math.hypot(e.x + e.vx * u - x, e.z + e.vz * u - z) }; }).sort((p, q) => p.d - q.d)[0];
      if (f && f.d < 0.05) return premiere([f.e.x, f.e.y, f.e.z], [f.e.vx, f.e.vy, f.e.vz], 1, 0.3) ?? 'corps';
      return x >= tete[0] - 0.3 && x <= tete[3] + 0.3 && z >= tete[2] - 0.3 && z <= tete[5] + 0.3 ? 'tete' : 'corps';
    }
    const j = /^joueur:(.+)$/.exec(String(source))?.[1], o = j ? this.sim.acteurs.parNom.get(j) : null;
    if (!o) return null;
    const oe = o.oeil(), lt = (o.lacetTete ?? o.lacet ?? 0) * RAD, tg = (o.tangage ?? 0) * RAD, d = [-Math.sin(lt) * Math.cos(tg), -Math.sin(tg), Math.cos(lt) * Math.cos(tg)];
    return premiere(oe, d, this.sim.regles.valeur('joueur.portee', 4.5), 0) ?? 'corps';   // portee : regle joueur.portee
  },
  // EnderDragon.hurt : a 0 de vie en vol, la vie reste a 1 et la phase de mort commence (vers le perchoir) ; les coups sur le corps : d / 4 + 1
  ajusterDegats(q, source) {
    if (this.type !== 'ender_dragon') return q;
    if ((/^(joueur|fleche|trident|explosion$)/.test(String(source)) || /^mob:/.test(String(source))) && this.partieTouchee(source) !== 'tete') q = q / 4 + Math.min(q, 1);   // EnderDragon.hurt(part) : hors de la tete, d / 4 + min(d, 1)
    if (this.a.vie - q <= 0 && this.phase !== 'mourant' && this.mortT < 0) { this.a.vie = 1 + q; this.dv = [0, 0, 0]; this.phaseDragon('mourant', {}); }
    return q;
  },
  commencerMortDragon() { const a = this.a; this.mortT = 0; a.vie = 0; this.sim.son('entity.ender_dragon.death', a.x, a.y, a.z, 5, 1); journal(this.sim, `${a.nom} meurt (200 ticks)`); this.stat('mortsDragon'); this.sim.stats.morts = (this.sim.stats.morts || 0) + 1; },
  // EnderDragon.tickDeath : il monte de 0,1 par tick ; de 180 a 200, des explosions ; des orbes d'experience (500 x 0,08 toutes les 5 ticks
  // apres 150, 500 x 0,2 a la fin) ; a 200 il disparait
  tickMortDragon() {
    const a = this.a, sim = this.sim, h = this.h;
    this.mortT++;
    sim.replay.trait(sim.temps, 'rayons', [a.x, a.y + 2.5, a.z], [this.dyaw, 0, 0], this.mortT);   // EnderDragonRenderer : les rayons de lumiere de la mort
    if (this.mortT >= 180 && this.mortT <= 200) sim.particule('explosion_emitter', a.x + (h.flottant() - 0.5) * 8, a.y + 2 + (h.flottant() - 0.5) * 4, a.z + (h.flottant() - 0.5) * 8, 0, 0, 0, 1);
    if (this.mortT > 150 && this.mortT % 5 === 0) { sim.stats.experience = (sim.stats.experience || 0) + Math.floor(500 * 0.08); sim.entites.orbes(a.x, a.y, a.z, Math.floor(500 * 0.08)); }
    a.y += 0.1; a.vx = a.vy = a.vz = 0;
    if (this.mortT >= 200) { sim.stats.experience = (sim.stats.experience || 0) + Math.floor(500 * 0.2); sim.entites.orbes(a.x, a.y, a.z, Math.floor(500 * 0.2)); a.mort = 21; a.mortSansCorps = true; journal(sim, `${a.nom} a disparu`); }
  },

  drapeauxBoss() {
    let d = 0;
    if (this.type === 'wither' && this.powered()) d |= 1 << 19;                     // armure (moitie de la vie)
    if (this.type === 'ender_dragon' && ASSIS.has(this.phase)) d |= 1 << 20;        // assis sur le perchoir (battement lent)
    return d;
  },
  // colonne en plus de replay (iaPlus) : wither [charge, lacets et tangages des tetes de cote] ; dragon [phase, mort, cristal qui soigne]
  plusBoss() {
    if (this.type === 'wither') return [this.invul, this.tetesLacet[0], this.tetesLacet[1], this.tetesTangage[0], this.tetesTangage[1], 0];
    if (this.type === 'ender_dragon') return [['cercle', 'mitraille', 'approche', 'atterrit', 'envol', 'souffle', 'scan', 'rugit', 'charge', 'mourant', 'plane'].indexOf(this.phase), this.mortT, this.cristalSoin ? this.cristalSoin.id : -1, this.flap, 0, 0];
    return null;
  },
};
