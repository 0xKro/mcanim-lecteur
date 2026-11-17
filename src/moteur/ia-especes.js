// IA des especes a comportement propre (champ `ia: true`), melangee a la classe IA de ia.js : volants (chauve-souris, abeille, perroquet,
// allay, ghast, phantom, vex), blaze, sorciere, enderman, cerveau du villageois (emploi du temps, lit, travail, rassemblement, echange).
// Port d'apres Horizon (MIT, voir ATTRIBUTIONS.md) : mobs/bat.rs (Bat.customServerAiStep, repos sous un bloc), control.rs (FlyingMoveControl),
// living.rs (travelInAir / travelFlying : 0,02, trainee 0,91), nether.rs (Ghast : RandomFloatAround, GhastMoveControl 0,1, GhastShoot
// 10 / 20 / -40 ; Blaze : BlazeAttackGoal 60 + 3 x 6 puis 100 ticks, descente lente x 0,6), projectiles.rs (AbstractHurtingProjectile),
// witch.rs (RangedAttackGoal 60 ticks rayon 10, potions bues et lancees), enderman.rs (regard fixe, teleportation 64 x 64 x 64, eau),
// vex.rs (VexMoveControl, charge), phantom.rs (cercle autour d'un point d'ancrage, pique), bee.rs (piqure, poison), parrot.rs (epaule),
// allay.rs (suit le joueur aime), villager.rs (emploi du temps du jeu : activity_at).
// Rien n'est dessine ici : l'etat d'animation part dans replay.ia (drapeaux D.*, tangage du corps, objet tenu) et film/creatures.js le lit.
import { coupe, deplacerBoite, rayonBloc } from './collision.js';
import { direction } from './projectiles.js';

const RAD = Math.PI / 180, MOVE = 1, LOOK = 2;
const norm180 = (a) => { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; };
const rotlerp = (de, vers, max) => de + Math.max(-max, Math.min(max, norm180(vers - de)));   // MoveControl.rotlerp
// drapeaux de replay.ia (en plus de 1 agressif, 2 attaque, 4 arc, 8 feu de ia.js)
export const D = { REPOS: 16, BOIT: 32, CRI: 64, CHARGE: 128, DARD_PERDU: 256, ECHANGE: 512, NON: 1024, DANSE: 2048, EPAULE: 4096, SOMMEIL: 8192, LAISSE: 16384, AMOUR: 32768, NECTAR: 65536, RUCHE: 131072, CONVERSION: 262144 };

// ---------------------------------------------------------------- volants : mode de deplacement et vitesse de vol (attribut flying_speed)
// mode : chauve (Bat), animal (FlyingMoveControl + travelInAir), allay (travel a la vitesse du controle), ghast, phantom, vex (sans collision)
// tour : maxTurn du FlyingMoveControl ; plane : hoversInPlace (false : la gravite revient quand il n'a pas de but : le perroquet se pose)
export const VOLS = {
  bat: { mode: 'chauve' },
  bee: { mode: 'animal', vv: 0.6, tour: 20, plane: true },
  parrot: { mode: 'animal', vv: 0.4, tour: 10, plane: false },
  allay: { mode: 'allay', vv: 0.1, tour: 20, plane: true },
  ghast: { mode: 'ghast' }, happy_ghast: { mode: 'ghast' },
  phantom: { mode: 'phantom' },
  vex: { mode: 'vex' },
  wither: { mode: 'animal', vv: 0.6, tour: 10, plane: true },   // FlyingMoveControl(10, hovers false) + setNoGravity : jamais de gravite
  ender_dragon: { mode: 'dragon' },                             // son propre pilotage (ia-boss.js)
};
export const VITESSES_VOL = Object.fromEntries(Object.entries(VOLS).filter(([, v]) => v.vv).map(([t, v]) => [t, v.vv]));
// Villager : emploi du temps (Schedule.VILLAGER_DEFAULT, ticks du jour, 0 = 6 h) : repos 12000..10, libre 10..2000, travail 2000..9000,
// rassemblement 9000..11000, libre 11000..12000 ; bebe : jeu 3000..6000 et 10000..12000
export function activiteVillageois(heure, bebe = false) {
  const t = Math.floor(((((heure - 6) % 24) + 24) % 24) * 1000);
  if (bebe) return (t >= 10 && t < 3000) || (t >= 6000 && t < 10000) ? 'libre' : (t >= 3000 && t < 6000) || (t >= 10000 && t < 12000) ? 'jeu' : 'repos';
  if ((t >= 10 && t < 2000) || (t >= 11000 && t < 12000)) return 'libre';
  if (t >= 2000 && t < 9000) return 'travail';
  if (t >= 9000 && t < 11000) return 'rassemblement';
  return 'repos';
}
// villageois sans echanges (Villager.mobInteract : pas d'offres -> setUnhappy, son "no")
const SANS_METIER = new Set(['none', 'nitwit']);
// sources de degats "projectile" (Enderman.hurtServer : il les esquive en se teleportant)
const PROJECTILES = new Set(['fleche', 'trident', 'boule', 'oeuf', 'boule_feu', 'petite_boule_feu', 'perle']);
const VIVANT = (s) => /^(joueur|mob):/.test(String(s));

// ---------------------------------------------------------------- recherche de chemin en 3D (FlyingPathNavigation, compacte)
function libre(lec, x, y, z, L, H) { return !coupe(lec, [x - L / 2, y, z - L / 2, x + L / 2, y + H, z + L / 2]); }
export function segmentVolLibre(lec, p, q, L, H) {
  const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), n = Math.max(1, Math.ceil(d / 0.4));
  for (let i = 1; i <= n; i++) { const f = i / n; if (!libre(lec, p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f, L, H)) return false; }
  return true;
}
// A* sur les cellules (26 voisins) ou la boite tient ; rend des points [x, y, z] (pieds) ou null
export function cheminVol(lec, de, vers, L, H, max = 1500) {
  const cle = (x, y, z) => `${x},${y},${z}`, h = (x, y, z) => Math.hypot(x - vers[0], y - vers[1], z - vers[2]);
  const ok = (x, y, z) => libre(lec, x + 0.5, y + 0.05, z + 0.5, L, H);
  const s = [Math.floor(de[0]), Math.floor(de[1]), Math.floor(de[2])], b = [Math.floor(vers[0]), Math.floor(vers[1]), Math.floor(vers[2])];
  const ouverts = [{ c: s, g: 0, f: h(...s) }], vus = new Map([[cle(...s), null]]), g = new Map([[cle(...s), 0]]);
  let n = 0, fin = null, meilleur = { c: s, f: h(...s) };
  while (ouverts.length && n++ < max) {
    let k = 0; for (let i = 1; i < ouverts.length; i++) if (ouverts[i].f < ouverts[k].f) k = i;
    const o = ouverts.splice(k, 1)[0], [x, y, z] = o.c;
    if (x === b[0] && y === b[1] && z === b[2]) { fin = o.c; break; }
    if (h(x, y, z) < meilleur.f) meilleur = { c: o.c, f: h(x, y, z) };
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dy && !dz) continue;
      const nx = x + dx, ny = y + dy, nz = z + dz, kk = cle(nx, ny, nz), ng = o.g + Math.hypot(dx, dy, dz);
      if (g.has(kk) && g.get(kk) <= ng) continue;
      if (!ok(nx, ny, nz) || ((dx && dz || dy) && (!ok(x + dx, y, z) && !ok(x, y, z + dz)))) continue;
      g.set(kk, ng); vus.set(kk, o.c); ouverts.push({ c: [nx, ny, nz], g: ng, f: ng + h(nx, ny, nz) });
    }
  }
  const bout = fin ?? meilleur.c, pts = [];
  for (let c = bout; c; c = vus.get(cle(...c))) pts.unshift([c[0] + 0.5, c[1] + 0.05, c[2] + 0.5]);
  if (fin) pts[pts.length - 1] = vers.slice();
  // lissage : on saute les points intermediaires quand la ligne droite est libre
  const lisse = [pts[0]];
  for (let i = 1; i < pts.length; i++) { const dernier = lisse[lisse.length - 1]; if (i + 1 < pts.length && segmentVolLibre(lec, dernier, pts[i + 1], L, H)) continue; lisse.push(pts[i]); }
  return lisse.slice(1);
}

// ---------------------------------------------------------------- methodes melangees a IA (ia.js : Object.assign(IA.prototype, METHODES))
export const METHODES = {
  // installation propre a l'espece (appelee par IA.installerButs) ; rend true si les buts sont poses
  installerEspece(add) {
    const f = this.pr.fam, c = this.comportement;
    if (this.vol) this.a.vole = true;
    if (this.installerBoss(add) || this.installerEau(add) || this.installerWarden(add)) return true;
    switch (f) {
      case 'chauve': this.perche = true; return true;   // Bat : pas de buts, tout est dans customServerAiStep (tickChauve)
      case 'abeille': add(0, 'volAttaque', MOVE | LOOK); add(8, 'volFlane', MOVE); add(9, 'regardeAutour', LOOK); return true;
      case 'perroquet': add(1, 'epaule', MOVE | LOOK); add(2, 'volFlane', MOVE); add(3, 'regardeJoueur', LOOK); return true;
      case 'allay': add(1, 'suitAmi', MOVE); add(2, 'volFlane', MOVE); add(3, 'regardeJoueur', LOOK); return true;
      case 'ghast': add(5, 'ghastFlotte', MOVE); add(7, 'ghastRegard', LOOK); if (c !== 'passif' && this.type !== 'happy_ghast') add(7, 'ghastTir', 0); return true;
      case 'phantom': add(1, 'phantomStrategie', 0); add(2, 'phantomPique', MOVE); add(3, 'phantomCercle', MOVE); return true;
      case 'vex': if (c !== 'passif') add(4, 'vexCharge', MOVE); add(8, 'vexFlane', MOVE); add(9, 'regardeJoueur', LOOK); return true;
      case 'blaze': add(0, 'flotte', 0); if (c !== 'passif') add(4, 'blazeAttaque', MOVE | LOOK); add(7, 'flane', MOVE); add(8, 'regardeJoueur', LOOK); add(8, 'regardeAutour', LOOK); return true;
      case 'sorciere': add(1, 'flotte', 0); if (c !== 'passif') add(2, 'sorciereTir', MOVE | LOOK); add(2, 'flane', MOVE); add(3, 'regardeJoueur', LOOK); add(3, 'regardeAutour', LOOK); return true;
      case 'enderman': add(0, 'flotte', 0); add(1, 'endermanFige', MOVE | LOOK); if (c !== 'passif') add(2, 'melee', MOVE | LOOK); add(7, 'flane', MOVE); add(8, 'regardeJoueur', LOOK); add(8, 'regardeAutour', LOOK); return true;
      case 'villageois':
        add(0, 'flotte', 0); add(0, 'dort', MOVE | LOOK); add(1, 'echange', MOVE | LOOK); add(1, 'panique', MOVE); add(1, 'evite', MOVE);
        add(5, 'maison', MOVE); add(6, 'travail', MOVE); add(6, 'auPoste', LOOK); add(6, 'reunion', MOVE); add(6, 'ragot', LOOK);
        add(7, 'flane', MOVE); add(8, 'regardeJoueur', LOOK); add(9, 'regardeAutour', LOOK);
        return true;
      default: return false;
    }
  },

  // ---- avant les buts (aiStep / customServerAiStep des especes) ---------------------------------------------------------
  avantButs() {
    const f = this.pr.fam, a = this.a;
    a.entreeVol = { zza: 0, yya: 0 };
    this.tickLaisse();
    if (f === 'sorciere') this.boire();
    if (f === 'enderman') this.tickEnderman();
    if (f === 'blaze') this.tickBlaze();
    if (f === 'abeille' && !this.dard) { this.depuisPiqure = (this.depuisPiqure ?? 0) + 1; if (this.depuisPiqure % 5 === 0 && this.h.entierBorne(Math.max(1, Math.min(1200, 1200 - this.depuisPiqure))) === 0) a.degats(a.vie, 'piqure'); }
    if (f === 'abeille' && this.sim.temps % 40 === 0) this.sim.son(this.cible ? 'entity.bee.loop_aggressive' : 'entity.bee.loop', a.x, a.y, a.z, 0.6, 1);   // bourdonnement (son en boucle du jeu)
    if (this.vol?.mode === 'chauve') this.tickChauve();
    if (f === 'wither') this.tickWitherAvant();
    if (f === 'dragon') this.tickDragon();
    this.avantEau(); this.avantWarden();
    if (this.echangeAvec && this.sim.temps >= this.echangeFin) this.finEchange();
    if (this.mecontentFin && this.sim.temps >= this.mecontentFin) this.mecontentFin = 0;
  },
  // cibles propres (rend true si l'espece a choisi elle-meme)
  ciblesEspece() {
    const f = this.pr.fam, sim = this.sim;
    if (this.ciblesWither() || f === 'dragon' || this.ciblesEau() || this.ciblesWarden()) return true;
    if (f === 'ghast') {   // NearestTarget joueur, |dy| <= 4
      if (this.cible && (this.cible.mort >= 0 || this.dist2(this.cible) > this.pr.suivi ** 2)) this.cible = null;
      if (this.cibleForcee) { const o = sim.acteurs.parNom.get(this.cibleForcee); this.cible = o && o.mort < 0 ? o : null; return true; }
      if (!this.cible && this.h.entierBorne(10) === 0) { const j = this.joueursProches(this.pr.suivi).find((o) => Math.abs(o.y - this.a.y) <= 4 && this.voit(o)); if (j) this.poserCible(j); }
      return true;
    }
    if (f === 'phantom') {   // PhantomAttackPlayerTargetGoal : la nuit (et sous un ciel), un joueur a 64 blocs, verifie toutes les 20 ticks
      if (this.cible && this.cible.mort >= 0) this.cible = null;
      if (this.cibleForcee) { const o = sim.acteurs.parNom.get(this.cibleForcee); this.cible = o && o.mort < 0 ? o : null; return true; }
      if (!this.cible && sim.temps % 20 === 0 && (!this.jour() || this.comportement === 'agressif')) { const j = this.joueursProches(64)[0]; if (j) this.poserCible(j); }
      return true;
    }
    if (f === 'enderman') {   // EndermanLookForPlayerGoal (regard fixe 5 ticks) + HurtByTarget
      if (this.cible && (this.cible.mort >= 0 || this.dist2(this.cible) > this.pr.suivi ** 2)) this.poserCible(null);
      if (this.cibleForcee) { const o = sim.acteurs.parNom.get(this.cibleForcee); if (o && o.mort < 0) this.poserCible(o); return true; }
      if (this.blessePar && this.blessePar.mort < 0 && sim.temps - this.blesseTick < 400 && !this.cible) { this.poserCible(this.blessePar); return true; }
      if (!this.cible && this.comportement !== 'passif') {
        const j = this.joueursProches(this.pr.suivi).find((o) => this.fixePar(o));
        if (j) { if (this.attenteRegard?.o === j) { if (++this.attenteRegard.n >= 5) { this.poserCible(j); this.stat('regards'); (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${j.nom} fixe ${this.a.nom}`); this.attenteRegard = null; } } else this.attenteRegard = { o: j, n: 0 }; }
        else this.attenteRegard = null;
      }
      return true;
    }
    if (f === 'abeille' || f === 'chauve' || f === 'perroquet' || f === 'allay') {   // pas de cible spontanee ; l'abeille : HurtByTarget (colere) ou `cible`
      if (this.cible && this.cible.mort >= 0) this.cible = null;
      if (f === 'abeille' && this.dard) {
        if (this.cibleForcee) { const o = sim.acteurs.parNom.get(this.cibleForcee); this.cible = o && o.mort < 0 ? o : null; }
        else if (this.blessePar && this.blessePar.mort < 0 && sim.temps < (this.colereFin ?? 0)) this.poserCible(this.blessePar);
        else if (this.comportement === 'agressif' && !this.cible) { const j = this.joueursProches(16)[0]; if (j) this.poserCible(j); }
        else if (sim.temps >= (this.colereFin ?? 0) && !this.cibleForcee && this.comportement !== 'agressif') this.cible = null;
      } else if (f === 'abeille') this.cible = null;
      return true;
    }
    return false;
  },
  joueursProches(r) { return this.autres().filter((o) => this.typeDe(o) === 'joueur' && this.dist2(o) <= r * r).sort((p, q) => this.dist2(p) - this.dist2(q)); },

  // ---- vol : navigation et physique ------------------------------------------------------------------------------------------
  // FlyingPathNavigation (compacte) : ligne droite si la boite passe, sinon A* en 3D ; le chemin est refait toutes les 20 ticks
  volVers(x, y, z, mod) {
    const a = this.a, sim = this.sim, n = this.navVol;
    if (n && sim.temps < n.prochain && Math.hypot(n.but[0] - x, n.but[1] - y, n.but[2] - z) < 1) { n.mod = mod; return; }
    const L = Math.max(0.3, a.L), H = a.H;
    const chemin = segmentVolLibre(a.lec, [a.x, a.y, a.z], [x, y, z], L, H) ? [[x, y, z]] : (cheminVol(a.lec, [a.x, a.y, a.z], [x, y, z], L, H) ?? []);
    this.navVol = { but: [x, y, z], chemin, i: 0, mod, prochain: sim.temps + 20 };
  },
  volFini() { return !this.navVol || this.navVol.i >= this.navVol.chemin.length; },
  // FlyingMoveControl.tick : le corps tourne vers le point (90 degres par tick au plus), zza = vitesse, yya = +-vitesse
  suivreVol() {
    const a = this.a, n = this.navVol, V = this.vol;
    if (!V || !['animal', 'allay'].includes(V.mode)) return;
    this.enVol = false;
    if (!n || n.i >= n.chemin.length) { this.vitesseVol = 0; return; }
    const w = n.chemin[n.i], dx = w[0] - a.x, dy = w[1] - a.y, dz = w[2] - a.z;
    if (n.precis ? Math.hypot(dx, dy, dz) <= 0.1 : Math.hypot(dx, dz) < Math.max(0.5, a.L / 2) && Math.abs(dy) < 0.6) { n.i++; if (n.i >= n.chemin.length) return; }   // precis : MoveControl.setWantedPosition (abeille au-dessus d'une fleur)
    if (dx * dx + dy * dy + dz * dz < 2.5e-7) return;
    a.lacet = norm180(rotlerp(a.lacet, Math.atan2(dz, dx) / RAD - 90, 90));
    const vit = n.mod * (a.auSol ? this.attr : V.vv);
    this.vitesseVol = vit; this.enVol = true;
    const sd = Math.hypot(dx, dz);
    this.tangageCorps = rotlerp(this.tangageCorps ?? 0, -Math.atan2(dy, sd) / RAD, V.tour);
    a.entreeVol = { zza: vit, yya: Math.abs(dy) > 1e-5 || sd > 1e-5 ? (dy > 0 ? vit : -vit) : 0 };
  },
  // travel en vol (LivingEntity.travelInAir / travelFlying, Allay.travel, Bat.tick) ; rend true (la physique du joueur n'est pas faite)
  physiqueVol() {
    const a = this.a, V = this.vol, lec = a.lec;
    if (this.surEpaule || this.dansRuche) { a.vx = a.vy = a.vz = 0; a.auSol = false; return true; }   // sur l'epaule, ou dans la ruche (ia-vie.js)
    if (V.mode === 'chauve' && this.perche && a.mort < 0) { a.vx = a.vy = a.vz = 0; return true; }
    if (V.mode === 'dragon') { a.auSol = false; a.distanceChute = 0; return true; }   // deplace par tickDragon (noPhysics : il traverse et casse les blocs)
    const e = a.entreeVol ?? { zza: 0, yya: 0 }, vivant = a.mort < 0;
    // moveRelative(quantite, (0, yya, zza)) : l'entree est ramenee a 1 si plus longue, x quantite, tournee du lacet
    const quant = V.mode === 'allay' ? (this.vitesseVol ?? 0) : a.auSol && V.mode === 'animal' && !this.enVol ? 0 : 0.02;
    let zz = vivant ? e.zza : 0, yy = vivant ? e.yya : 0;
    const l2 = zz * zz + yy * yy; if (l2 > 1) { const l = Math.sqrt(l2); zz /= l; yy /= l; }
    const sn = Math.sin(a.lacet * RAD), cs = Math.cos(a.lacet * RAD);
    a.vx += -zz * quant * sn; a.vz += zz * quant * cs; a.vy += yy * quant;
    if (V.mode === 'vex') { a.x += a.vx; a.y += a.vy; a.z += a.vz; a.auSol = false; }   // Vex : noPhysics, traverse les blocs
    else {
      const r = deplacerBoite(lec, a.boite(), [a.vx, a.vy, a.vz], a.auSol, V.mode === 'chauve' || this.gravite ? 0.6 : 0);
      a.x += r.dx; a.y += r.dy; a.z += r.dz;
      if (r.bloqueX) a.vx = 0; if (r.bloqueZ) a.vz = 0; if (r.bloqueY) a.vy = 0;
      a.auSol = r.auSol; a.bute = r.bloqueX || r.bloqueZ;
    }
    a.distanceChute = 0;   // les volants ne prennent pas de degats de chute
    if (['ghast', 'phantom', 'allay'].includes(V.mode)) { a.vx *= 0.91; a.vy *= 0.91; a.vz *= 0.91; }   // travelFlying
    else {   // travelInAir : gravite 0,08 si elle s'applique, y x 0,98, x et z x 0,91 (sol : friction x 0,91)
      const g = V.mode === 'chauve' || this.gravite || !vivant ? 0.08 : 0, f = a.auSol ? 0.6 * 0.91 : 0.91;
      a.vy = (a.vy - g) * 0.98; a.vx *= f; a.vz *= f;
      if (V.mode === 'chauve') a.vy *= 0.6;                                         // Bat.tick : la chauve-souris perd 40 % de sa vitesse verticale
      if (this.pr.fam === 'perroquet' && !a.auSol && a.vy < 0) a.vy *= 0.6;        // Parrot.aiStep : descente lente
    }
    return true;
  },

  // ---- chauve-souris (Bat.customServerAiStep) -------------------------------------------------------------------------------
  tickChauve() {
    const a = this.a, sim = this.sim, h = this.h, X = Math.floor(a.x), Y = Math.floor(a.y), Z = Math.floor(a.z);
    const plafond = coupe(a.lec, [X + 0.3, Y + 1.01, Z + 0.3, X + 0.7, Y + 1.99, Z + 0.7]);
    if (a.mort >= 0) return;
    if (this.perche) {
      if (plafond) {
        a.y = Y + 1 - a.H;   // Bat.tick : accrochee sous le bloc
        if (h.entierBorne(200) === 0) a.lacetTete = h.entierBorne(360);
        if (this.joueursProches(4).some((o) => this.voit(o))) { this.perche = false; this.envol(); }
      } else { this.perche = false; this.envol(); }
      return;
    }
    const t = this.butChauve;
    if (t && (coupe(a.lec, [t[0] + 0.2, t[1] + 0.2, t[2] + 0.2, t[0] + 0.8, t[1] + 0.8, t[2] + 0.8]) || t[1] < -63)) this.butChauve = null;
    const pres = (q) => (q[0] + 0.5 - a.x) ** 2 + (q[1] + 0.5 - a.y) ** 2 + (q[2] + 0.5 - a.z) ** 2 < 4;
    if (!this.butChauve || h.entierBorne(30) === 0 || pres(this.butChauve)) {
      const x = a.x + h.entierBorne(7) - h.entierBorne(7), y = a.y + h.entierBorne(6) - 2, z = a.z + h.entierBorne(7) - h.entierBorne(7);
      this.butChauve = [Math.floor(x), Math.floor(y), Math.floor(z)];
    }
    const b = this.butChauve, dx = b[0] + 0.5 - a.x, dy = b[1] + 0.1 - a.y, dz = b[2] + 0.5 - a.z;
    a.vx += (Math.sign(dx) * 0.5 - a.vx) * 0.1; a.vy += (Math.sign(dy) * 0.7 - a.vy) * 0.1; a.vz += (Math.sign(dz) * 0.5 - a.vz) * 0.1;
    a.lacet = norm180(a.lacet + norm180(Math.atan2(a.vz, a.vx) / RAD - 90 - a.lacet));
    a.entreeVol = { zza: 0.5, yya: 0 };
    if (h.entierBorne(100) === 0 && plafond) { this.perche = true; this.stat('perchoirs'); }
  },
  envol() { const a = this.a; this.sim.son('entity.bat.takeoff', Math.floor(a.x) + 0.5, Math.floor(a.y) + 0.5, Math.floor(a.z) + 0.5, 0.05, 0.8 + this.h.flottant() * 0.4); this.stat('envols'); },

  // ---- abeille, perroquet, allay : flaner en volant (BeeWanderGoal, WaterAvoidingRandomFlyingGoal, RandomStroll.fly) -------------------
  peut_volFlane() {
    if (this.surEpaule) return false;
    const f = this.pr.fam;
    if (f === 'abeille' ? !(this.volFini() && this.h.entierBorne(10) === 0) : this.h.entierBorne(f === 'perroquet' || f === 'wither' ? 120 : 60) !== 0) return false;
    const a = this.a, h = this.h;
    for (let i = 0; i < 10; i++) {   // HoverRandomPos : 8 blocs autour (devant de preference), 1 a 4 blocs au-dessus du sol
      const ang = (a.lacet + (h.flottant() - 0.5) * 180) * RAD, r = 2 + h.flottant() * 6;
      const x = a.x - Math.sin(ang) * r, z = a.z + Math.cos(ang) * r;
      const sol = this.sim.acteurs.solAuxCoordonnees(x, z, a.y);
      if (sol === null) continue;
      const y = f === 'perroquet' && h.entierBorne(3) === 0 ? sol : sol + 1 + h.flottant() * 3;
      if (libre(a.lec, x, y, z, a.L, a.H)) { this.butFlane = [x, y, z]; return true; }
    }
    return false;
  },
  continue_volFlane() { return !this.volFini(); },
  debut_volFlane() { const b = this.butFlane; this.gravite = false; this.volVers(b[0], b[1], b[2], 1.0); },
  tick_volFlane() {},
  fin_volFlane() { this.navVol = null; if (this.vol && !this.vol.plane) this.gravite = true; },

  // abeille : BeeAttackGoal (MeleeAttackGoal 1,4) ; piqure : 2 de degats, poison 10 s (normal) ou 18 s (difficile), puis l'abeille perd son dard
  peut_volAttaque() { return this.dard && !!this.cible && this.cible.mort < 0; },
  continue_volAttaque() { return this.peut_volAttaque(); },
  debut_volAttaque() { this.prochaineAttaque = 0; },
  fin_volAttaque() { this.navVol = null; },
  tick_volAttaque() {
    const o = this.cible, sim = this.sim;
    this.regarder(o);
    if (!this.navVol || sim.temps >= this.navVol.prochain || Math.hypot(this.navVol.but[0] - o.x, this.navVol.but[2] - o.z) > 1) this.volVers(o.x, o.y + o.H * 0.5, o.z, 1.4);
    if (this.prochaineAttaque > 0) this.prochaineAttaque--;
    if (this.auContact(o) && this.prochaineAttaque <= 0) {
      this.prochaineAttaque = 20;
      const avant = o.vie;
      this.frapper(o);
      if (o.vie < avant) {
        const dif = this.difficulte(), s = dif === 2 ? 10 : dif === 3 ? 18 : 0;
        if (s > 0) o.appliquerEffet('poison', s * 20, 0);
        this.dard = false; this.cible = null; this.stat('piqures');
        (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${this.a.nom} pique ${o.nom}${s ? ` (poison ${s} s)` : ''}`);
        sim.son('entity.bee.sting', this.a.x, this.a.y, this.a.z, 1, 1);
      }
    }
  },

  // perroquet : se pose sur l'epaule de son joueur (LandOnOwnersShoulderGoal) : vole jusqu'a lui, puis suit l'epaule gauche
  peut_epaule() { return !!this.epaule; },
  continue_epaule() { return !!this.epaule; },
  tick_epaule() {
    const a = this.a, o = this.sim.acteurs.parNom.get(this.epaule);
    if (!o || o.mort >= 0) { this.surEpaule = false; return; }
    const ang = o.lacet * RAD, px = o.x + Math.cos(ang) * 0.4, pz = o.z + Math.sin(ang) * 0.4, py = o.y + (o.accroupi ? 1.3 : 1.5) - 0.1;
    if (this.surEpaule) { a.x = px; a.y = py; a.z = pz; a.lacet = o.lacet; a.lacetTete = o.lacetTete; this.navVol = null; return; }
    if (Math.hypot(px - a.x, py - a.y, pz - a.z) < 1.0) {
      this.surEpaule = true; this.stat('epaules'); this.sim.son('entity.parrot.step', a.x, a.y, a.z, 0.5, 1);
      (this.sim.stats.iaJournal ??= []).push(`${(this.sim.temps / 20).toFixed(2)} ${a.nom} se pose sur l epaule de ${o.nom}`);
      return;
    }
    this.gravite = false; this.volVers(px, py, pz, 1.0); this.regarder(o);
  },

  // allay : reste pres du joueur aime s'il tient un objet (StayCloseToTarget 4 / 16 blocs, vitesse 2,25)
  peut_suitAmi() { const o = this.sim.acteurs.parNom.get(this.ami ?? ''); return !!o && o.mort < 0 && !!o.main?.objet && this.dist2(o) > 16; },
  continue_suitAmi() { const o = this.sim.acteurs.parNom.get(this.ami ?? ''); return !!o && o.mort < 0 && !!o.main?.objet && this.dist2(o) > 4; },
  tick_suitAmi() { const o = this.sim.acteurs.parNom.get(this.ami); this.volVers(o.x, o.y + 1.2, o.z, 2.25); this.regarder(o); },
  fin_suitAmi() { this.navVol = null; },

  // ---- ghast (RandomFloatAroundGoal, GhastMoveControl, GhastLookGoal, GhastShootFireballGoal) --------------------------------------
  peut_ghastFlotte() { const v = this.voulu; if (!v || !this.ghastBouge) return true; const d = (v[0] - this.a.x) ** 2 + (v[1] - this.a.y) ** 2 + (v[2] - this.a.z) ** 2; return d < 1 || d > 3600; },
  continue_ghastFlotte() { return false; },
  debut_ghastFlotte() { const a = this.a, r = () => (this.h.flottant() * 2 - 1) * 16; this.voulu = [a.x + r(), a.y + r(), a.z + r()]; this.ghastBouge = true; },
  tick_ghastFlotte() {},
  // GhastMoveControl : toutes les 2 a 6 ticks, une poussee de 0,1 vers le point voulu si la boite y passe
  bougerGhast() {
    const a = this.a, v = this.voulu;
    if (!v || !this.ghastBouge) return;
    const avant = this.flotteDuree ?? 0; this.flotteDuree = avant - 1;
    if (avant > 0) return;
    this.flotteDuree += this.h.entierBorne(5) + 2;
    const t = [v[0] - a.x, v[1] - a.y, v[2] - a.z], L = Math.hypot(...t);
    if (L < 1e-6) return;
    const b = a.boite(), n = Math.ceil(L);
    for (let i = 1; i <= n; i++) { const f = i / n; if (coupe(a.lec, [b[0] + t[0] * f, b[1] + t[1] * f, b[2] + t[2] * f, b[3] + t[0] * f, b[4] + t[1] * f, b[5] + t[2] * f])) { this.ghastBouge = false; return; } }
    const k = 0.06 * 5 / 3;
    a.vx += t[0] / L * k; a.vy += t[1] / L * k; a.vz += t[2] / L * k;
  },
  peut_ghastRegard() { return true; },
  continue_ghastRegard() { return true; },
  tick_ghastRegard() {
    const a = this.a, o = this.cible;
    if (!o) { if (Math.hypot(a.vx, a.vz) > 1e-4) a.lacet = -Math.atan2(a.vx, a.vz) / RAD; }
    else if (this.dist2(o) < 4096) a.lacet = -Math.atan2(o.x - a.x, o.z - a.z) / RAD;
    a.lacetTete = a.lacet;
    if (o) this.regarder(o);
  },
  peut_ghastTir() { return !!this.cible; },
  continue_ghastTir() { return !!this.cible; },
  debut_ghastTir() { this.chargeTir = 0; },
  fin_ghastTir() { this.chargeTir = 0; },
  tick_ghastTir() {
    const a = this.a, o = this.cible, sim = this.sim;
    if (this.dist2(o) < 4096 && this.voit(o)) {
      this.chargeTir++;
      if (this.chargeTir === 10) sim.son('entity.ghast.warn', a.x, a.y + a.H / 2, a.z, 10, (this.h.flottant() - this.h.flottant()) * 0.2 + 1);
      if (this.chargeTir === 20) {
        const ya = a.lacet * RAD, vue = [-Math.sin(ya), Math.cos(ya)], demi = a.H * 0.5, B = o.boite();
        const dir = [o.x - (a.x + vue[0] * 4), (B[1] + B[4]) / 2 - (0.5 + a.y + demi), o.z - (a.z + vue[1] * 4)];
        sim.son('entity.ghast.shoot', a.x, a.y + demi, a.z, 10, (this.h.flottant() - this.h.flottant()) * 0.2 + 1);
        this.lancerBoule('boule_feu', [a.x + vue[0] * 4, a.y + demi + 0.5 - 0.5, a.z + vue[1] * 4], dir, { puissance: 1 });
        this.chargeTir = -40;
      }
    } else if (this.chargeTir > 0) this.chargeTir--;
  },
  // boule de feu : vitesse de depart = direction normalisee x 0,1 (AbstractHurtingProjectile, accelerationPower 0,1)
  lancerBoule(type, pos, dir, opt = {}) {
    const L = Math.hypot(...dir) || 1, P = this.sim.entites.proj;
    const e = P.creer(type, this.a, pos, dir.map((c) => c / L * 0.1), { sansHerite: true, acc: 0.1, ...opt });
    this.stat('boules'); (this.sim.stats.iaJournal ??= []).push(`${(this.sim.temps / 20).toFixed(2)} ${this.a.nom} lance une ${type === 'boule_feu' ? 'boule de feu' : 'petite boule de feu'}`);
    return e;
  },

  // ---- phantom (PhantomAttackStrategyGoal, PhantomSweepAttackGoal, PhantomCircleAroundAnchorGoal, PhantomMoveControl) ----------------
  phantomAncre() {
    const o = this.cible, h = this.h, base = this.sim.regles.valeur('ia.phantomAncre', 20);
    this.ancre = o ? [Math.floor(o.x) + 0.5, Math.floor(o.y) + base + h.entierBorne(Math.max(1, base)), Math.floor(o.z) + 0.5] : [this.a.x, this.a.y, this.a.z];
  },
  peut_phantomStrategie() { return !!this.cible; },
  continue_phantomStrategie() { return !!this.cible && this.cible.mort < 0; },
  debut_phantomStrategie() { this.prochainePique = 10; this.phase = 'cercle'; this.phantomAncre(); },
  tick_phantomStrategie() {
    if (this.phase !== 'cercle') return;
    if (--this.prochainePique <= 0) {
      this.phase = 'pique'; this.phantomAncre();
      this.prochainePique = (8 + this.h.entierBorne(4)) * 20;
      this.sim.son('entity.phantom.swoop', this.a.x, this.a.y, this.a.z, 10, 0.95 + this.h.flottant() * 0.1);
      this.stat('piques'); (this.sim.stats.iaJournal ??= []).push(`${(this.sim.temps / 20).toFixed(2)} ${this.a.nom} pique sur ${this.cible.nom}`);
    }
  },
  peut_phantomPique() { return this.phase === 'pique' && !!this.cible && this.cible.mort < 0; },
  continue_phantomPique() { return this.peut_phantomPique(); },
  tick_phantomPique() {
    const a = this.a, o = this.cible;
    this.pointPhantom = [o.x, o.y + o.H * 0.5, o.z];
    const B = a.boite(), C = o.boite(), m = 0.2;
    if (B[0] <= C[3] + m && B[3] >= C[0] - m && B[1] <= C[4] + m && B[4] >= C[1] - m && B[2] <= C[5] + m && B[5] >= C[2] - m) { this.frapper(o); this.phase = 'cercle'; }
    else if (a.bute) this.phase = 'cercle';
  },
  peut_phantomCercle() { return this.phase !== 'pique'; },
  continue_phantomCercle() { return this.phase !== 'pique'; },
  debut_phantomCercle() { const h = this.h; this.cercle = { r: 5 + h.flottant() * 10, haut: -4 + h.flottant() * 9, sens: h.flottant() < 0.5 ? 1 : -1, ang: h.flottant() * Math.PI * 2 }; if (!this.ancre) this.phantomAncre(); this.pointCercle(); },
  pointCercle() { const c = this.cercle, A = this.ancre; this.pointPhantom = [A[0] + c.r * Math.cos(c.ang), A[1] - 4 + c.haut, A[2] + c.r * Math.sin(c.ang)]; },
  tick_phantomCercle() {
    const a = this.a, c = this.cercle, h = this.h;
    if (h.entierBorne(350) === 0) c.haut = -4 + h.flottant() * 9;
    if (h.entierBorne(250) === 0) { c.r += 1; if (c.r > 15) { c.r = 5; c.sens = -c.sens; } }
    if (h.entierBorne(450) === 0) { c.ang = h.flottant() * 2 * Math.PI; c.ang += c.sens * 15 * RAD; this.pointCercle(); }
    const p = this.pointPhantom, suivant = () => { c.ang += c.sens * 15 * RAD; this.pointCercle(); };   // selectNext : 15 degres plus loin sur le cercle
    if ((p[0] - a.x) ** 2 + (p[1] - a.y) ** 2 + (p[2] - a.z) ** 2 < 4) suivant();
    const X = Math.floor(a.x), Y = Math.floor(a.y), Z = Math.floor(a.z), plein = (y) => coupe(a.lec, [X + 0.1, y + 0.1, Z + 0.1, X + 0.9, y + 0.9, Z + 0.9]);
    if (p[1] < a.y && plein(Y - 1)) { c.haut = Math.max(1, c.haut); suivant(); }
    if (p[1] > a.y && plein(Y + 1)) { c.haut = Math.min(-1, c.haut); suivant(); }
  },
  // PhantomMoveControl : tourne de 4 degres par tick vers le point, vitesse 0,2 -> 1,8 en ligne droite, melange 0,2 de la nouvelle vitesse
  bougerPhantom() {
    const a = this.a, p = this.pointPhantom;
    if (!p) return;
    if (a.bute) { a.lacet += 180; this.vitPhantom = 0.1; }
    let dx = p[0] - a.x, dy = p[1] - a.y, dz = p[2] - a.z, dist = Math.hypot(dx, dz);
    if (Math.abs(dist) < 1e-5) return;
    const k = 1 - Math.abs(dy * 0.7) / dist; dx *= k; dz *= k; dist = Math.hypot(dx, dz);
    const tot = Math.hypot(dx, dz, dy), ancien = a.lacet;
    const cible = norm180(Math.atan2(dz, dx) / RAD), act = norm180(a.lacet + 90);
    a.lacet = norm180(act + Math.max(-4, Math.min(4, norm180(cible - act))) - 90);
    let v = this.vitPhantom ?? 0.1;
    v = Math.abs(norm180(ancien - a.lacet)) < 3 ? v + Math.min(0.005 * (1.8 / v), 1.8 - v) : v + Math.max(-0.025, Math.min(0.025, 0.2 - v));
    this.vitPhantom = v;
    const tg = -Math.atan2(-dy, dist); this.tangageCorps = tg / RAD;
    const yr = (a.lacet + 90) * RAD;
    const nv = [v * Math.cos(yr) * Math.abs(dx / tot), v * Math.sin(tg) * Math.abs(dy / tot), v * Math.sin(yr) * Math.abs(dz / tot)];
    a.vx += (nv[0] - a.vx) * 0.2; a.vy += (nv[1] - a.vy) * 0.2; a.vz += (nv[2] - a.vz) * 0.2;
    a.lacetTete = a.lacet;
  },

  // ---- vex (VexChargeAttackGoal, VexRandomMoveGoal, VexMoveControl) ------------------------------------------------------------------
  peut_vexCharge() { return !!this.cible && this.cible.mort < 0 && !this.vexVoulu && this.h.entierBorne(4) === 0 && this.dist2(this.cible) > 4; },
  continue_vexCharge() { return !!this.vexVoulu && this.charge2 && !!this.cible && this.cible.mort < 0; },
  debut_vexCharge() { const o = this.cible; this.vexVoulu = [o.x, o.y + o.O, o.z]; this.vexMod = 1.0; this.charge2 = true; this.sim.son('entity.vex.charge', this.a.x, this.a.y, this.a.z, 1, 1); this.stat('charges'); },
  fin_vexCharge() { this.charge2 = false; },
  tick_vexCharge() {
    const a = this.a, o = this.cible, B = a.boite(), C = o.boite();
    this.regarder(o);
    if (B[0] <= C[3] && B[3] >= C[0] && B[1] <= C[4] && B[4] >= C[1] && B[2] <= C[5] && B[5] >= C[2]) { this.frapper(o); this.charge2 = false; }
    else if (this.dist2(o) < 9) this.vexVoulu = [o.x, o.y + o.O, o.z];
  },
  peut_vexFlane() { return !this.vexVoulu && this.h.entierBorne(4) === 0; },
  continue_vexFlane() { return false; },
  debut_vexFlane() {
    const a = this.a, h = this.h;
    for (let i = 0; i < 3; i++) {
      const p = [Math.floor(a.x) + h.entierBorne(15) - 7, Math.floor(a.y) + h.entierBorne(11) - 5, Math.floor(a.z) + h.entierBorne(15) - 7];
      const e = this.sim.monde.etatEn(p[0], p[1], p[2]);
      if (e >= 0 && /^(air|cave_air)$/.test(this.sim.d.nomBloc(e))) { this.vexVoulu = [p[0] + 0.5, p[1] + 0.5, p[2] + 0.5]; this.vexMod = 0.25; if (!this.cible) this.regarder(this.vexVoulu); return; }
    }
  },
  tick_vexFlane() {},
  bougerVex() {
    const a = this.a, v = this.vexVoulu;
    if (!v) return;
    const t = [v[0] - a.x, v[1] - a.y, v[2] - a.z], L = Math.hypot(...t);
    if (L < Math.max(a.L, a.H)) { this.vexVoulu = null; a.vx *= 0.5; a.vy *= 0.5; a.vz *= 0.5; return; }
    const k = this.vexMod * 0.05 / L; a.vx += t[0] * k; a.vy += t[1] * k; a.vz += t[2] * k;
    if (!this.cible) a.lacet = -Math.atan2(a.vx, a.vz) / RAD; else a.lacet = -Math.atan2(this.cible.x - a.x, this.cible.z - a.z) / RAD;
  },

  // ---- blaze (BlazeAttackGoal ; Blaze.aiStep : descente x 0,6 ; customServerAiStep : monte vers une cible plus haute) ------------
  tickBlaze() {
    const a = this.a, o = this.cible;
    if (!a.auSol && a.vy < 0) a.vy *= 0.6;
    if (--this.blazeCompte <= 0 || this.blazeCompte === undefined) { this.blazeCompte = 100; this.blazeDecal = 0.5 + 6.891 * (this.h.flottant() - this.h.flottant()); }
    if (o && o.mort < 0 && o.oeil()[1] > a.oeil()[1] + this.blazeDecal) a.vy += (0.3 - a.vy) * 0.3;
    if (this.sim.temps % 3 === 0 && this.h.entierBorne(2) === 0) this.sim.particule('large_smoke', a.x + (this.h.flottant() - 0.5) * a.L, a.y + this.h.flottant() * a.H, a.z + (this.h.flottant() - 0.5) * a.L, 0, 0, 0, 1);
    if (this.blaze?.charge && this.sim.temps % 2 === 0) this.sim.particule('flame', a.x + (this.h.flottant() - 0.5) * 0.8, a.y + this.h.flottant() * a.H, a.z + (this.h.flottant() - 0.5) * 0.8, 0, 0.03, 0, 1);
  },
  peut_blazeAttaque() { return !!this.cible && this.cible.mort < 0; },
  continue_blazeAttaque() { return this.peut_blazeAttaque(); },
  debut_blazeAttaque() { this.blaze = { pas: 0, temps: 0, vu: 0, charge: false }; },
  fin_blazeAttaque() { if (this.blaze) { this.blaze.charge = false; this.blaze.vu = 0; } this.nav = null; },
  tick_blazeAttaque() {
    const a = this.a, o = this.cible, B = this.blaze, sim = this.sim, h = this.h;
    B.temps--;
    const voit = this.voit(o); B.vu = voit ? 0 : B.vu + 1;
    const d2 = this.dist2(o);
    if (d2 < 4) {
      if (!voit) return;
      if (B.temps <= 0) { B.temps = 20; this.frapper(o); }
      if (!this.nav || sim.temps >= this.nav.prochain) this.allerVers(o.x, o.y, o.z, 1.0, { recalcul: 10 });
    } else if (d2 < this.pr.suivi ** 2 && voit) {
      this.nav = null;
      const demi = a.H * 0.5, C = o.boite(), xd = o.x - a.x, yd = (C[1] + C[4]) / 2 - (a.y + demi), zd = o.z - a.z;
      if (B.temps <= 0) {
        B.pas++;
        if (B.pas === 1) { B.temps = 60; B.charge = true; }
        else if (B.pas <= 4) B.temps = 6;
        else { B.temps = 100; B.pas = 0; B.charge = false; }
        if (B.pas > 1) {
          const sqd = Math.sqrt(Math.sqrt(d2)) * 0.5;
          sim.son('entity.blaze.shoot', Math.floor(a.x) + 0.5, Math.floor(a.y) + 0.5, Math.floor(a.z) + 0.5, 2, (h.flottant() - h.flottant()) * 0.2 + 1);
          const dir = [xd + 2.297 * sqd * (h.flottant() - h.flottant()), yd, zd + 2.297 * sqd * (h.flottant() - h.flottant())];
          this.lancerBoule('petite_boule_feu', [a.x, a.y + demi + 0.5, a.z], dir);
        }
      }
      this.regarder(o);
    } else if (B.vu < 5) { if (!this.nav || sim.temps >= this.nav.prochain) this.allerVers(o.x, o.y, o.z, 1.0, { recalcul: 10 }); }
    this.regarder(o);
  },

  // ---- sorciere (Witch.aiStep : boire ; RangedAttackGoal(1,0 ; 60 ; 60 ; 10) ; performRangedAttack) ------------------------------------
  boire() {
    const a = this.a, h = this.h, sim = this.sim;
    if (this.boit > 0) {
      a.entree.avance = 0;
      if (sim.temps % 4 === 0) sim.particule('effet', a.x, a.y + 2.1, a.z, 0, 0.05, 0, 0.82);
      if (--this.boit === 0) {
        const p = this.potionBue; a.main = { objet: null, efficacite: 0 }; this.potionBue = null;
        if (p === 'healing') a.vie = Math.min(a.vieMax, a.vie + 4);
        else if (p === 'swiftness') a.appliquerEffet('speed', 3600, 0);
        else a.appliquerEffet(p, 3600, 0);
        for (let i = 0; i < 12; i++) sim.particule('effet', a.x + (h.flottant() - 0.5) * 0.8, a.y + 0.5 + h.flottant() * 1.5, a.z + (h.flottant() - 0.5) * 0.8, 0, 0.05, 0, p === 'healing' ? 0.02 : p === 'fire_resistance' ? 0.08 : p === 'water_breathing' ? 0.6 : 0.55);
        (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${a.nom} a bu ${p}`);
      }
      return;
    }
    const loin = !!this.cible && this.dist2(this.cible) > 121;
    let p = null;
    if (h.flottant() < 0.15 && a.dansEau && !a.niveauEffet('water_breathing')) p = 'water_breathing';
    else if (h.flottant() < 0.15 && (this.feu > 0 || this.derniereSource === 'feu' || this.derniereSource === 'petite_boule_feu') && !a.niveauEffet('fire_resistance')) p = 'fire_resistance';
    else if (h.flottant() < 0.05 && a.vie < a.vieMax) p = 'healing';
    else if (h.flottant() < 0.5 && this.cible && !a.niveauEffet('speed') && loin) p = 'swiftness';
    if (p) {
      this.potionBue = p; this.boit = 32; a.main = { objet: 'potion', efficacite: 0 };
      sim.son('entity.witch.drink', a.x, a.y, a.z, 1, 0.8 + h.flottant() * 0.4);
      this.stat('potionsBues'); (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${a.nom} boit ${p}`);
    }
    if (h.flottant() < 7.5e-4) for (let i = 0; i < 10; i++) sim.particule('effet', a.x, a.y + 2.2, a.z, (h.flottant() - 0.5) * 0.2, 0.1, (h.flottant() - 0.5) * 0.2, 0.82);   // evenement 15 : fumee magique au-dessus du chapeau
  },
  peut_sorciereTir() { return !!this.cible && this.cible.mort < 0; },
  continue_sorciereTir() { return this.peut_sorciereTir(); },
  debut_sorciereTir() { this.tirSorciere = { attente: -1, vu: 0 }; },
  fin_sorciereTir() { this.nav = null; },
  tick_sorciereTir() {
    const o = this.cible, T = this.tirSorciere, sim = this.sim, d2 = this.dist2(o), voit = this.voit(o);
    T.vu = voit ? T.vu + 1 : 0;
    if (d2 <= 100 && T.vu >= 5) this.nav = null;
    else if (!this.nav || sim.temps >= this.nav.prochain) this.allerVers(o.x, o.auSol ? o.y : undefined, o.z, 1.0, { recalcul: 10 });
    this.regarder(o);
    if (--T.attente === 0) { if (!voit) return; this.lancerPotion(o); T.attente = 60; }
    else if (T.attente < 0) T.attente = 60;
  },
  // Witch.performRangedAttack : lenteur a 8 blocs et plus, poison sur une cible a 8 de vie ou plus, faiblesse tout pres (1 sur 4), degats sinon ;
  // vise la position + la vitesse de la cible, oeil - 1,1 + dist x 0,2, vitesse 0,75 (0,45 a 2 blocs), imprecision 8
  choixPotion(o, dist) {
    if (dist >= 8 && !o.niveauEffet('slowness')) return 'slowness';
    if (o.vie >= 8 && !o.niveauEffet('poison')) return 'poison';
    if (dist <= 3 && !o.niveauEffet('weakness') && this.h.flottant() < 0.25) return 'weakness';
    return 'instant_damage';
  },
  lancerPotion(o) {
    if (this.boit > 0) return null;
    const a = this.a, sim = this.sim;
    const xd = o.x + o.vx - a.x, yd = o.oeil()[1] - 1.1 - a.y, zd = o.z + o.vz - a.z, dist = Math.hypot(xd, zd);
    const id = this.choixPotion(o, dist);
    const DUREES = { slowness: 1800, poison: 900, weakness: 1800, instant_damage: 1 };
    const v = [xd, yd + dist * 0.2, zd], L = Math.hypot(...v) || 1;
    const P = sim.entites.proj, vit = P.tirer(Math.atan2(-v[0], v[2]) / RAD, -Math.asin(v[1] / L) / RAD, dist <= 2 ? 0.45 : 0.75, 8);
    const e = P.creer('potion', a, [a.x, a.oeil()[1] - 0.1, a.z], vit, { objet: 'splash_potion', effet: { id, ticks: DUREES[id], niveau: 0 }, sansHerite: true });
    sim.son('entity.witch.throw', a.x, a.y, a.z, 1, 0.8 + this.h.flottant() * 0.4);
    a.balancer(); this.stat('potionsLancees');
    (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${a.nom} lance ${id} sur ${o.nom}`);
    return e;
  },

  // ---- enderman ---------------------------------------------------------------------------------------------------------------------
  // Enderman.isBeingStaredBy : le regard du joueur dans un cone de 0,025 / distance autour des yeux, sans bloc entre eux (citrouille : non)
  fixePar(o) {
    const a = this.a;
    if (o.ia || /carved_pumpkin/.test(String(o.casque ?? ''))) return false;
    const [ex, ey, ez] = o.oeil(), look = direction(o.lacetTete, o.tangage);
    const d = [a.x - ex, a.y + a.O - ey, a.z - ez], dist = Math.hypot(...d);
    if (dist < 1e-6) return false;
    const dot = (look[0] * d[0] + look[1] * d[1] + look[2] * d[2]) / dist;
    return dot > 1 - 0.025 / dist && this.voitDe(o);
  },
  voitDe(o) { const [ex, ey, ez] = o.oeil(); return this.sim.acteurs && rayonLibre(this.a.lec, [ex, ey, ez], [this.a.x, this.a.y + this.a.O, this.a.z]); },
  tickEnderman() {
    const a = this.a, sim = this.sim;
    // eau et pluie : 1 de degats (sensible a l'eau), qui le fait se teleporter
    if (a.dansEau || sim.meteo?.pleutEn?.(Math.floor(a.x), Math.floor(a.y + a.H), Math.floor(a.z))) a.degats(1, 'eau');
    if (this.teleportsEnAttente > 0) { const n = this.teleportsEnAttente; this.teleportsEnAttente = 0; for (let i = 0; i < n; i++) if (this.teleporter()) break; }
    // Enderman.customServerAiStep : en plein jour, a ciel ouvert, 600 ticks apres son dernier changement de cible
    if (this.jour() && sim.temps >= (this.cibleDepuis ?? -1e9) + 600 && sim.regles.valeur('ia.soleil', true)) {
      const br = 1;
      if (this.cielVisible(a.x, a.y, a.z) && this.h.flottant() * 30 < (br - 0.4) * 2) { this.poserCible(null); this.teleporter(); }
    }
    // EndermanLookForPlayerGoal.tick : la cible le fixe a moins de 4 blocs -> il se teleporte ; a plus de 16 blocs, il se rapproche toutes les 30 ticks
    const o = this.cible;
    if (o && o.mort < 0 && this.typeDe(o) === 'joueur') {
      if (this.fixePar(o)) { if (this.dist2(o) < 16) this.teleporter(); this.teleTemps = 0; }
      else if (this.dist2(o) > 256 && (this.teleTemps = (this.teleTemps ?? 0) + 1) >= 30 && this.teleporterVers(o)) this.teleTemps = 0;
    }
    // hurle quand il a une cible (DATA_CREEPY) : son de cri de temps en temps
    if (this.cible && this.h.entierBorne(80) === 0) sim.son('entity.enderman.scream', a.x, a.y + a.O, a.z, 1, 1);
  },
  // Enderman.teleport : x et z a +-32, y a +-32 (nextInt(64) - 32), puis randomTeleport : descend jusqu'au premier bloc solide ; boite libre et sans liquide
  teleporter() {
    const a = this.a, h = this.h;
    const x = a.x + (h.flottant() - 0.5) * 64, y = a.y + (h.entierBorne(64) - 32), z = a.z + (h.flottant() - 0.5) * 64;
    return this.teleporterA(x, y, z);
  },
  teleporterVers(o) {
    const a = this.a, h = this.h;
    let d = [a.x - o.x, a.y + a.H * 0.5 - o.oeil()[1], a.z - o.z]; const L = Math.hypot(...d) || 1; d = d.map((c) => c / L);
    return this.teleporterA(a.x + (h.flottant() - 0.5) * 8 - d[0] * 16, a.y + (h.entierBorne(16) - 8) - d[1] * 16, a.z + (h.flottant() - 0.5) * 8 - d[2] * 16);
  },
  teleporterA(x, y, z) {
    const a = this.a, sim = this.sim, lec = a.lec, Lm = lec.limites;
    if (x < Lm.x0 || x >= Lm.x1 || z < Lm.z0 || z >= Lm.z1) return false;
    let ny = Math.floor(y), by = ny;
    for (;;) { if (by < -64) return false; by--; if (coupe(lec, [x - 0.01, by + 0.5, z - 0.01, x + 0.01, by + 0.99, z + 0.01])) break; ny -= 1; }
    ny = by + 1;
    const b = [x - a.L / 2, ny, z - a.L / 2, x + a.L / 2, ny + a.H, z + a.L / 2];
    if (coupe(lec, b)) return false;
    for (let cx = Math.floor(b[0]); cx <= Math.floor(b[3]); cx++) for (let cy = Math.floor(b[1]); cy <= Math.floor(b[4]); cy++) for (let cz = Math.floor(b[2]); cz <= Math.floor(b[5]); cz++) if (sim.fluide(cx, cy, cz).type) return false;
    if (sim.fluide(Math.floor(x), by, Math.floor(z)).type === 'water') return false;
    const ancien = [a.x, a.y, a.z];
    a.x = x; a.y = ny; a.z = z; a.vx = a.vz = 0; a.vy = 0; a.distanceChute = 0; this.nav = null;
    // evenement de niveau 2018 : la trainee de portail de l'ancienne place a la nouvelle (128 particules), deux sons a l'arrivee
    for (let i = 0; i < 128; i++) {
      const f = i / 127, h = this.h;
      sim.particule('portal', ancien[0] + (x - ancien[0]) * f + (h.flottant() - 0.5) * a.L * 2, ancien[1] + (ny - ancien[1]) * f + h.flottant() * a.H, ancien[2] + (z - ancien[2]) * f + (h.flottant() - 0.5) * a.L * 2, (h.flottant() - 0.5) * 0.2, (h.flottant() - 0.5) * 0.2, (h.flottant() - 0.5) * 0.2, 1);
    }
    sim.son('entity.enderman.teleport', x, ny, z, 1, 1); sim.son('entity.enderman.teleport', x, ny, z, 1, 1);
    this.stat('teleports'); (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${a.nom} se teleporte de ${ancien.map((v) => v.toFixed(1)).join(',')} a ${x.toFixed(1)},${ny.toFixed(1)},${z.toFixed(1)}`);
    sim.api.evenement('creature.teleporte', { creature: a.nom, de: ancien, vers: [x, ny, z] });
    return true;
  },
  // EndermanFreezeWhenLookedAtGoal : il s'arrete et regarde le joueur qui le fixe (a 16 blocs)
  peut_endermanFige() { const o = this.cible; return !!o && this.typeDe(o) === 'joueur' && this.dist2(o) <= 256 && this.fixePar(o); },
  continue_endermanFige() { return this.peut_endermanFige(); },
  tick_endermanFige() { this.nav = null; this.regarder(this.cible); },

  // degats : l'enderman esquive les projectiles (64 essais de teleportation) ; apres un coup sans attaquant vivant : 9 chances sur 10
  esquive(source) {
    if (this.pr.fam !== 'enderman' || !PROJECTILES.has(String(source))) return false;
    this.teleportsEnAttente = 64; this.stat('esquives');
    return true;
  },
  apresDegats(source, q) {
    const f = this.pr.fam;
    this.apresDegatsEau(source, q); this.apresDegatsWarden(source, q);
    this.derniereSource = String(source);
    if (f === 'enderman' && !VIVANT(source) && source !== 'magie' && this.h.entierBorne(10) !== 0) this.teleportsEnAttente = Math.max(this.teleportsEnAttente ?? 0, 1);
    if (f === 'chauve') this.perche = false;
    if (f === 'abeille' && VIVANT(source)) { this.colereFin = this.sim.temps + 400 + this.h.entierBorne(380); for (const o of this.autres()) if (o.ia?.pr.fam === 'abeille' && o.ia.dard && this.dist2(o) < 400) { o.ia.blessePar = this.blessePar; o.ia.colereFin = this.colereFin; } }   // HurtByTarget.setAlertOthers
    if (f === 'villageois' && VIVANT(source)) this.sim.particule('angry_villager', this.a.x, this.a.y + this.a.H + 0.2, this.a.z, 0, 0, 0, 1);
    const parJoueur = /^joueur:(.+)$/.exec(String(source))?.[1];
    if (this.type === 'villager' && parJoueur) this.ragot(parJoueur, 'minor_negative', 25);   // VILLAGER_HURT
  },

  // ---- villageois : emploi du temps du jeu --------------------------------------------------------------------------------------------
  activite() { return activiteVillageois(this.sim.heureMonde(), this.bebe); },
  metier() { return String(this.variante ?? '').split(/\s+/)[0] || 'none'; },
  pointLit() { const l = this.lit; return l ? [l[0] + 0.5, l[1], l[2] + 0.5] : null; },
  // SleepInBed : activite repos, le lit a 2 blocs au plus ; il se couche (Pose.SLEEPING) a 0,6875 au-dessus du bloc, jusqu'a la fin du repos
  peut_dort() { const p = this.pointLit(); return !!p && this.activite() === 'repos' && Math.hypot(this.a.x - p[0], this.a.z - p[2]) <= 1.6 && Math.abs(this.a.y - p[1]) < 1.5; },
  continue_dort() { return this.activite() === 'repos'; },
  debut_dort() {
    const a = this.a; this.sommeil = true; this.nav = null;
    this.debout = [a.x, a.y, a.z];
    // la tete du lit (le point du jeu : BlockPos du lit, partie "head") ; l'orientation du lit donne le sens du corps couche
    const l0 = this.lit, e0 = this.sim.monde.etatEn(l0[0], l0[1], l0[2]), face = e0 >= 0 ? this.sim.d.prop(e0, 'facing') : null;
    const pas = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[face] ?? [0, 0];
    const pied = e0 >= 0 && this.sim.d.prop(e0, 'part') === 'foot';
    this.tete = pied ? [l0[0] + pas[0], l0[1], l0[2] + pas[1]] : l0.slice();
    // LivingEntityRenderer.sleepDirectionToRotation : sud 90, ouest 0, nord 270, est 180
    this.directionLit = { south: 90, west: 0, north: 270, east: 180 }[face] ?? 90;
    this.lit = this.tete;
    const l = this.lit;
    a.x = l[0] + 0.5; a.y = l[1] + 0.6875; a.z = l[2] + 0.5; a.vx = a.vy = a.vz = 0;
    this.stat('sommeils'); (this.sim.stats.iaJournal ??= []).push(`${(this.sim.temps / 20).toFixed(2)} ${a.nom} se couche`);
  },
  tick_dort() { const a = this.a, l = this.lit; a.x = l[0] + 0.5; a.y = l[1] + 0.6875; a.z = l[2] + 0.5; a.vx = a.vy = a.vz = 0; a.entree.avance = 0; a.lacet = this.directionLit; a.lacetTete = a.lacet; },
  fin_dort() {
    // BedBlock.findStandUpPosition : une case libre autour du lit (d'abord la ou il etait avant de se coucher)
    const a = this.a, l = this.lit, y = Math.floor(l[1]); this.sommeil = false;
    const cases = [this.debout ? [this.debout[0], this.debout[2]] : null, ...[[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1], [0, -2], [0, 2], [-1, -2], [1, -2], [-1, 2], [1, 2]].map(([dx, dz]) => [l[0] + 0.5 + dx, l[2] + 0.5 + dz])].filter(Boolean);
    const libreEn = (x, z) => !coupe(a.lec, [x - a.L / 2, y + 0.01, z - a.L / 2, x + a.L / 2, y + a.H, z + a.L / 2]) && coupe(a.lec, [x - 0.1, y - 0.2, z - 0.1, x + 0.1, y - 0.01, z + 0.1]);
    const d = cases.find(([x, z]) => libreEn(x, z)) ?? [l[0] + 1.5, l[2] + 0.5];
    a.x = d[0]; a.y = y; a.z = d[1];
    (this.sim.stats.iaJournal ??= []).push(`${(this.sim.temps / 20).toFixed(2)} ${a.nom} se reveille`);
  },
  // repos : rentre au lit (ou a la maison) ; travail : va a son poste ; rassemblement : va a la cloche
  peut_maison() {
    if (this.activite() !== 'repos') return false;
    const p = this.pointLit() ?? this.maison; if (!p) return false;
    return Math.hypot(this.a.x - p[0], this.a.z - p[2]) > (this.lit ? 1.4 : 1.2);
  },
  continue_maison() { return this.peut_maison() && !this.navFinie(); },
  debut_maison() { const p = this.pointLit() ?? this.maison; this.allerVers(p[0], p[1], p[2], 0.5, { ouvrePortes: true, recalcul: 1e9, rayon: 0.4 }); },
  tick_maison() {},
  peut_travail() { return !!this.travail && this.activite() === 'travail' && Math.hypot(this.a.x - this.travail[0], this.a.z - this.travail[2]) > 1.5; },
  continue_travail() { return this.peut_travail() && !this.navFinie(); },
  debut_travail() { this.allerVers(this.travail[0], this.travail[1], this.travail[2], 0.5, { ouvrePortes: true, recalcul: 1e9 }); },
  tick_travail() {},
  // WorkAtPoi : au poste, il regarde le bloc de metier ; toutes les 300 ticks, le son de travail de son metier
  peut_auPoste() { return !!this.travail && this.activite() === 'travail' && Math.hypot(this.a.x - this.travail[0], this.a.z - this.travail[2]) <= 2; },
  continue_auPoste() { return this.peut_auPoste(); },
  tick_auPoste() {
    const a = this.a, t = this.travail, sim = this.sim;
    this.regarder([t[0], t[1] + 0.5, t[2]]);
    if (sim.temps - (this.dernierTravail ?? -1e9) >= 300) {
      this.dernierTravail = sim.temps; const m = this.metier();
      if (!SANS_METIER.has(m)) { sim.son(`entity.villager.work_${m}`, t[0], t[1], t[2], 1, 1); this.stat('travaux'); (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${a.nom} travaille (${m})`); }
    }
  },
  peut_reunion() { const r = this.rassemblement; return !!r && this.activite() === 'rassemblement' && Math.hypot(this.a.x - r[0] - 0.5, this.a.z - r[2] - 0.5) > 4; },
  continue_reunion() { return this.peut_reunion() && !this.navFinie(); },
  debut_reunion() {
    const r = this.rassemblement, h = this.h, ang = h.flottant() * Math.PI * 2, d = 2 + h.flottant() * 1.5;
    this.allerVers(r[0] + 0.5 + Math.cos(ang) * d, r[1], r[2] + 0.5 + Math.sin(ang) * d, 0.5, { ouvrePortes: true, recalcul: 1e9 });
  },
  tick_reunion() {},
  // ragots (GossipWithVillager / InteractWith) : au rassemblement, deux villageois a 5 blocs se regardent ; les ragots du jeu sont des
  // reputations invisibles : ils sont comptes (stat `ragots`) mais ne changent rien a l'image
  peut_ragot() {
    if (this.activite() !== 'rassemblement' || this.h.entierBorne(20) !== 0) return false;
    const o = this.autres().find((x) => x.ia?.pr.fam === 'villageois' && this.dist2(x) < 25);
    if (!o) return false;
    this.ragotAvec = o; this.ragotFin = this.sim.temps + 60 + this.h.entierBorne(40); return true;
  },
  continue_ragot() { return !!this.ragotAvec && this.sim.temps < this.ragotFin && this.ragotAvec.mort < 0; },
  debut_ragot() { this.bavarder?.(this.ragotAvec); this.stat('ragots'); (this.sim.stats.iaJournal ??= []).push(`${(this.sim.temps / 20).toFixed(2)} ${this.a.nom} parle avec ${this.ragotAvec.nom}`); },
  tick_ragot() { this.regarder(this.ragotAvec); },
  // Villager.mobInteract : pas d'echanges (sans metier, idiot, bebe) -> il secoue la tete 40 ticks et dit "no" ; sinon il echange
  interagir(joueur, duree) {
    const a = this.a, sim = this.sim, m = this.metier();
    if (this.pr.fam !== 'villageois' || this.sommeil) return 'rien';
    if (SANS_METIER.has(m) || this.bebe) {
      this.mecontentFin = sim.temps + 40; this.mecontentDebut = sim.temps;
      sim.son('entity.villager.no', a.x, a.y, a.z, 1, 1);
      this.stat('refus'); (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${a.nom} refuse (pas d'echanges)`);
      return 'non';
    }
    this.echangeAvec = joueur; this.echangeFin = sim.temps + duree;
    sim.son('entity.villager.trade', a.x, a.y, a.z, 1, 1);
    this.stat('echanges'); (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${a.nom} echange avec ${joueur.nom} (reputation ${this.reputation(joueur.nom)}, prix ${this.prixDiff(joueur.nom) >= 0 ? '+' : ''}${this.prixDiff(joueur.nom)} par offre x 0,05)`);
    this.ragot(joueur.nom, 'trading', 2);   // ReputationEventType.TRADE
    return 'echange';
  },
  finEchange() { if (!this.echangeAvec) return; const a = this.a; this.echangeAvec = null; this.sim.son('entity.villager.yes', a.x, a.y, a.z, 1, 1); },
  peut_echange() { return !!this.echangeAvec; },
  continue_echange() { return !!this.echangeAvec; },
  tick_echange() { this.nav = null; this.regarder(this.echangeAvec); },

  // ---- laisse (Leashable.tickLeash, checkElasticInteractions, PathfinderMob.closeRangeLeashBehaviour : Horizon mobs/leash.rs) --------
  // distance entre les centres des boites ; au-dela de la regle `laisse.rupture` (le jeu : 12 blocs) la laisse casse (son, laisse au sol) ;
  // tendue (au-dela de 6 - largeurs) : force elastique entre les points d'attache (0 / 0,5 h / 0,5 l de la creature, 0 / 0,5 h / 0 de celui
  // qui tient) : unite x (d - 6), x 0,3 si elle va deja dans ce sens, appliquee x (0,8 ; 0,2 ; 0,8) + 0,11 x vitesse relative, et une rotation ;
  // sinon elle marche (ou vole) jusqu'a 2 blocs de celui qui tient (vitesse 1, lama 2)
  laisseActuelle() {
    const L = this.laissePiste; if (!L || this.laisseCassee) return null;
    const t = this.sim.temps / 20 / (this.sim.replay.ralenti || 1); let v = null;
    for (const k of L) if (k.t <= t + 1e-9) v = k.v;
    if (!v) return null;
    if (Array.isArray(v)) return { pos: [v[0] + 0.5, v[1] + 0.375, v[2] + 0.5], l: 0.375, h: 0.5, v: [0, 0, 0], lacet: 0, nom: `barriere ${v.join(',')}` };
    const h = this.sim.acteurs.parNom.get(v);
    return h && h.mort < 0 ? { pos: [h.x, h.y, h.z], l: h.L, h: h.H, v: [h.vx, h.vy, h.vz], lacet: h.lacet, nom: h.nom } : null;
  },
  tickLaisse() {
    const a = this.a, sim = this.sim, l = this.laisseActuelle();
    this.enLaisse = !!l; this.laisseVers = null;
    if (!l) return;
    const [hx, hy, hz] = l.pos, d = Math.hypot(hx - a.x, hy + l.h / 2 - a.y - a.H / 2, hz - a.z), rupture = sim.regles.valeur('laisse.rupture', 12);
    if (rupture > 0 && d > rupture) {
      this.laisseCassee = true; this.enLaisse = false;
      sim.son('item.lead.break', a.x, a.y, a.z, 1, 1);
      if (sim.regles.valeur('butin.actif', true)) sim.entites.objet('lead', 1, a.x, a.y + 0.5, a.z);
      this.stat('laissesCassees'); (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} la laisse de ${a.nom} casse (${d.toFixed(1)} blocs de ${l.nom})`);
      return;
    }
    let tire = false;
    if (d > 6 - l.l - a.L) {
      const rot = (p, deg) => { const r = -deg * RAD; return [p[0] * Math.cos(r) + p[2] * Math.sin(r), p[1], p[2] * Math.cos(r) - p[0] * Math.sin(r)]; };
      const lev = rot([0, 0.5 * a.H, 0.5 * a.L], a.lacet), bras = rot([0, 0.5 * l.h, 0], l.lacet);
      const dd = [hx + bras[0] - a.x - lev[0], hy + bras[1] - a.y - lev[1], hz + bras[2] - a.z - lev[2]], dist = Math.hypot(...dd);
      if (dist >= 6) {
        const u = dist < 1e-5 ? [0, 0, 0] : dd.map((c) => c / dist), f = u.map((c) => c * (dist - 6));
        const couple = lev[2] * f[0] - lev[0] * f[2];
        if (a.vx * f[0] + a.vy * f[1] + a.vz * f[2] >= 0) for (let k = 0; k < 3; k++) f[k] *= 0.3;
        a.vx += f[0] * 0.8 + (l.v[0] - a.vx) * 0.11; a.vy += f[1] * 0.2 + (l.v[1] - a.vy) * 0.11; a.vz += f[2] * 0.8 + (l.v[2] - a.vz) * 0.11;
        this.laisseTourne = (this.laisseTourne ?? 0) + 10 * couple;
        tire = true; if (!this.tireLaisse) this.stat('laissesTirees');
      }
    }
    this.tireLaisse = tire;
    if (!tire && d > 2 && !(sim.temps - this.blesseTick < 100)) { const k = (d - 2) / d; this.laisseVers = [a.x + (hx - a.x) * k, a.vole ? a.y + (hy + 1 - a.y) * k : hy, a.z + (hz - a.z) * k]; }
    if (this.laisseTourne) { a.lacet -= this.laisseTourne; this.laisseTourne *= a.auSol ? 0.6 * 0.91 : a.dansEau ? 0.8 : 0.91; if (Math.abs(this.laisseTourne) < 1e-4) this.laisseTourne = 0; }
  },
  suivreLaisse() {
    const p = this.laisseVers;
    if (!p || this.sommeil || this.surEpaule) return;
    if (this.vol) { if (['animal', 'allay'].includes(this.vol.mode)) this.volVers(p[0], p[1], p[2], 1.0); }
    else if (!this.nav || this.sim.temps >= this.nav.prochain || Math.hypot(this.nav.but[0] - p[0], this.nav.but[2] - p[2]) > 1) this.allerVers(p[0], p[1], p[2], /llama/.test(this.type) ? 2.0 : 1.0, { recalcul: 10 });
  },

  // ---- apres les buts : deplacements propres, drapeaux du rendu ------------------------------------------------------------------------
  apresButs() {
    const f = this.pr.fam, m = this.vol?.mode;
    if (m === 'ghast') this.bougerGhast();
    else if (m === 'phantom') this.bougerPhantom();
    else if (m === 'vex') this.bougerVex();
    if (this.boit > 0 || this.sommeil || this.echangeAvec || this.mecontentFin) this.a.entree.avance = 0;
    if (f === 'perroquet' && !this.surEpaule && this.volFini() && !this.vol.plane) this.gravite = true;
    if (f === 'wither') this.tickWither();
    this.apresEau(); this.apresWarden();
  },
  drapeauxEspece() {
    let d = 0;
    if (this.vol?.mode === 'chauve' && this.perche) d |= D.REPOS;
    if (this.boit > 0) d |= D.BOIT;
    if (this.pr.fam === 'enderman' && this.cible) d |= D.CRI;
    if ((this.pr.fam === 'ghast' && this.chargeTir > 10) || (this.pr.fam === 'blaze' && this.blaze?.charge) || (this.pr.fam === 'vex' && this.charge2)) d |= D.CHARGE;
    if (this.pr.fam === 'abeille' && !this.dard) d |= D.DARD_PERDU;
    if (this.echangeAvec) d |= D.ECHANGE;
    if (this.mecontentFin && this.sim.temps === this.mecontentDebut) d |= D.NON;
    if (this.surEpaule) d |= D.EPAULE;
    if (this.sommeil) d |= D.SOMMEIL;
    if (this.enLaisse) d |= D.LAISSE;
    d |= this.drapeauxVie?.() ?? 0;
    d |= this.drapeauxBoss() | this.drapeauxEau() | this.drapeauxWarden() | this.drapeauxOeufs();
    return d;
  },
};

// rayon de vue sans bloc de collision (comme ia.js voit)
function rayonLibre(lec, de, vers) { return rayonBloc(lec, de, vers) === null; }
