// Projectiles : fleches (arc, arbalete), boules de neige, oeufs, perles d'ender, potions jetees, trident. Port de AbstractArrow, ThrowableProjectile,
// ThrownEnderpearl, ThrownPotion, BowItem, CrossbowItem (Horizon client/{arrows,projectiles}.rs, client/game/crossbow.rs : MIT, voir ATTRIBUTIONS.md).
// Un projectile est une entite (moteur/entites.js) : un enregistrement par tick dans la colonne `entites` du replay, dessine par film/entites-monde.js.
//   fleche  : gravite 0,05, trainee 0,99 (0,6 dans l'eau), vitesse 3,0 x puissance (arc) ou 3,15 (arbalete) ; degats ceil(vitesse x 2) (+ alea si critique) ;
//             plantee dans un bloc (1200 ticks), boite de contact elargie de 0,3
//   boule, oeuf, perle : gravite 0,03, trainee 0,99, vitesse 1,5 ; la perle teleporte son lanceur et lui fait 5 de degats ; la boule et l'oeuf ne blessent pas
//   potion jetee : gravite 0,05, vitesse 0,5 (tir 20 degres plus haut), effets dans 4 x 2 x 4 autour, force 1 - sqrt(d2) / 4 si d2 < 16
//   trident : gravite 0,05, vitesse 2,5, degats 8
// Le hasard vient du monde (moteur/aleatoire.js) : meme graine, memes tirs.
import { boitesLocales } from './collision.js';
import { exploser } from './explosion.js';

const RAD = Math.PI / 180;
const CUBE = [[0, 0, 0, 1, 1, 1]];

// type -> parametres du jeu
export const TYPES = {
  fleche: { g: 0.05, eau: 0.6, boite: 0.5 },
  boule: { g: 0.03, eau: 0.8, boite: 0.25, objet: 'snowball' },
  oeuf: { g: 0.03, eau: 0.8, boite: 0.25, objet: 'egg' },
  perle: { g: 0.03, eau: 0.8, boite: 0.25, objet: 'ender_pearl' },
  potion: { g: 0.05, eau: 0.8, boite: 0.25, objet: 'splash_potion' },
  trident: { g: 0.05, eau: 0.99, boite: 0.5, objet: 'trident' },
  // boules de feu (AbstractHurtingProjectile : sans gravite, acceleration 0,1 le long de la vitesse, inertie 0,95 (0,8 dans l'eau) ; LargeFireball 1 x 1,
  // SmallFireball 0,3125 ; dessinees comme une charge de feu x 3 et x 0,75, pleine lumiere)
  boule_feu: { g: 0, eau: 0.8, boite: 1.0, objet: 'fire_charge', feu: true, echelle: 3 },
  petite_boule_feu: { g: 0, eau: 0.8, boite: 0.3125, objet: 'fire_charge', feu: true, echelle: 0.75 },
  // crane du wither (WitherSkull : 0,3125, inertie 0,95, bleu 0,73) ; boule de feu du dragon (DragonFireball : 1 x 1, trainee de souffle)
  crane: { g: 0, eau: 0.8, boite: 0.3125, feu: true, sansFeu: true },
  boule_dragon: { g: 0, eau: 0.8, boite: 1.0, feu: true, sansFeu: true },
};
// objet tenu -> type de projectile lance (clic droit dans l'air, verbe `lance`)
export const LANCABLES = { snowball: 'boule', egg: 'oeuf', ender_pearl: 'perle', splash_potion: 'potion', lingering_potion: 'potion', trident: 'trident' };
// vitesse de depart et deviation (le jeu : Snowball.shootFromRotation(..., 1.5, 1.0) ; potion : 0,5 avec -20 degres ; trident : 2,5)
export const VITESSE_LANCE = { boule: 1.5, oeuf: 1.5, perle: 1.5, potion: 0.5, trident: 2.5 };
export const TANGAGE_LANCE = { potion: -20 };

// puissance d'un arc (BowItem.getPowerForTime) : f = t / 20 ; (f x f + 2 f) / 3 ; au plus 1
export function puissanceArc(ticks) { const f = ticks / 20; return Math.min(1, (f * f + f * 2) / 3); }

// Vecteur de direction d'un lacet et d'un tangage (degres, tangage > 0 = vers le bas) : celui du jeu
export const direction = (lacet, tangage) => [-Math.sin(lacet * RAD) * Math.cos(tangage * RAD), -Math.sin(tangage * RAD), Math.cos(lacet * RAD) * Math.cos(tangage * RAD)];

// Premiere boite de collision touchee par le segment p0 -> p1 : { t (0..1), x, y, z, face (normale), cellule } ou null (ClipContext COLLIDER, sans fluides)
export function coupeBlocs(lec, p0, p1) {
  const x0 = Math.floor(Math.min(p0[0], p1[0]) - 1e-6), x1 = Math.floor(Math.max(p0[0], p1[0]) + 1e-6);
  const y0 = Math.floor(Math.min(p0[1], p1[1]) - 1e-6) - 1, y1 = Math.floor(Math.max(p0[1], p1[1]) + 1e-6);
  const z0 = Math.floor(Math.min(p0[2], p1[2]) - 1e-6), z1 = Math.floor(Math.max(p0[2], p1[2]) + 1e-6);
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  let meilleur = null;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const L = boitesLocales(lec, x, y, z);
    for (let i = 0; i < L.length; i++) {
      const k = L[i], r = tranche([k[0] + x, k[1] + y, k[2] + z, k[3] + x, k[4] + y, k[5] + z], p0, d);
      if (r && (!meilleur || r.t < meilleur.t)) meilleur = { ...r, cellule: [x, y, z] };
    }
  }
  if (meilleur) meilleur.pos = [p0[0] + d[0] * meilleur.t, p0[1] + d[1] * meilleur.t, p0[2] + d[2] * meilleur.t];
  return meilleur;
}

// Segment p0 + t x d (0 <= t <= 1) contre la boite b : { t, face } a l'entree, ou null ; un segment qui commence dedans rend t = 0
export function tranche(b, p0, d) {
  let t0 = 0, t1 = 1, face = null;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) { if (p0[a] < b[a] || p0[a] > b[3 + a]) return null; continue; }
    let ta = (b[a] - p0[a]) / d[a], tb = (b[3 + a] - p0[a]) / d[a], sens = -1;
    if (ta > tb) { [ta, tb] = [tb, ta]; sens = 1; }
    if (ta > t0) { t0 = ta; face = [0, 0, 0]; face[a] = sens; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  return { t: t0, face };
}

// Angle de tir (tangage, degres, > 0 vers le bas) pour qu'un projectile lance a la vitesse v atteigne la hauteur `dy` a la distance horizontale `dh`
// (gravite g, trainee c) : on essaie les angles du plus bas au plus haut et on garde le premier tir direct ; null si hors de portee.
export function tangageBalistique(dh, dy, v, g, c = 0.99) {
  const hauteurA = (ang) => {      // ang : degres vers le haut ; hauteur en dh, ou NaN si la portee est insuffisante
    let x = 0, y = 0, vx = v * Math.cos(ang * RAD), vy = v * Math.sin(ang * RAD);
    for (let i = 0; i < 400; i++) {
      const nx = x + vx, ny = y + vy;
      if (nx >= dh) { return y + (ny - y) * ((dh - x) / (nx - x || 1)); }
      x = nx; y = ny; vy = vy * c - g; vx *= c;
      if (y < dy - 80) return NaN;
    }
    return NaN;
  };
  let prec = null, precAng = null;
  for (let a = -60; a <= 70; a += 0.5) {
    const h = hauteurA(a);
    if (Number.isNaN(h)) { prec = null; continue; }
    const f = h - dy;
    if (prec !== null && prec < 0 && f >= 0) {            // le tir direct : on affine
      let lo = precAng, hi = a;
      for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (hauteurA(m) - dy < 0) lo = m; else hi = m; }
      return -(lo + hi) / 2;
    }
    prec = f; precAng = a;
  }
  return null;
}

export class Projectiles {
  constructor(entites) { this.E = entites; this.sim = entites.sim; }
  get R() { return this.sim.regles; }
  lec() { return this.E.lec; }

  // Direction de tir comme Projectile.shoot : normalisee + bruit triangulaire (0,0172275 x deviation) sur chaque axe, puis x vitesse
  tirer(lacet, tangage, vitesse, deviation) {
    const s = this.sim, h = s.hasard, d = direction(lacet, tangage), k = 0.0172275 * deviation * this.R.valeur('projectiles.imprecision', 1);
    const v = [d[0] + (h.flottant() - h.flottant()) * k, d[1] + (h.flottant() - h.flottant()) * k, d[2] + (h.flottant() - h.flottant()) * k];
    const L = Math.hypot(...v) || 1;
    const vit = vitesse * this.R.valeur('projectiles.vitesse', 1);
    return v.map((c) => (c / L) * vit);
  }

  // Cree le projectile. proprietaire : acteur (ou null) ; origine : [x, y, z] ; v : vitesse [vx, vy, vz]
  creer(type, proprietaire, origine, v, opt = {}) {
    const E = this.E, s = this.sim;
    if (!s.regles.valeur('projectiles.actif', true)) return null;
    const e = { id: E.prochain++, type, proj: true, x: origine[0], y: origine[1], z: origine[2], vx: v[0], vy: v[1], vz: v[2], proprietaire: proprietaire ? proprietaire.nom : null, age: 0, debut: s.temps, plantee: false, ...opt };
    // le projectile herite de la vitesse de son lanceur (x, z ; y seulement en l'air) comme le jeu
    if (proprietaire && !opt.sansHerite) { e.vx += proprietaire.vx; e.vz += proprietaire.vz; if (!proprietaire.auSol) e.vy += proprietaire.vy; }
    E.liste.push(e);
    s.stats.projectiles = (s.stats.projectiles || 0) + 1;
    return e;
  }

  // Une fleche d'arc ou d'arbitre : puissance 0..1 (vitesse = 3 x puissance), critique si la puissance est pleine
  fleche(acteur, lacet, tangage, puissance, opt = {}) {
    const s = this.sim, vit = opt.vitesse ?? 3.0 * puissance;
    const origine = [acteur.x, acteur.oeil()[1] - 0.1, acteur.z];
    const v = this.tirer(lacet, tangage, vit, 1.0);
    const e = this.creer('fleche', acteur, origine, v, { crit: opt.crit ?? puissance >= 1.0, degatsBase: opt.degatsBase ?? 2.0, arbalete: !!opt.arbalete, vitesse0: vit });
    if (e) s.dire(`${acteur.nom} tire une fleche (puissance ${puissance.toFixed(2)}, vitesse ${Math.hypot(e.vx, e.vy, e.vz).toFixed(2)})`);
    return e;
  }

  // Objet lance (boule, oeuf, perle, potion, trident) dans la direction (lacet, tangage) de l'acteur
  lancer(acteur, type, lacet, tangage, opt = {}) {
    const vit = VITESSE_LANCE[type] ?? 1.5, dev = 1.0;
    const origine = [acteur.x, acteur.oeil()[1] - 0.1, acteur.z];
    const v = this.tirer(lacet, tangage + (TANGAGE_LANCE[type] ?? 0), vit, dev);
    return this.creer(type, acteur, origine, v, { objet: opt.objet ?? TYPES[type].objet, effet: opt.effet ?? null });
  }

  // ------------------------------------------------------------ un tick
  tick(e) {
    const s = this.sim, R = this.R, P = TYPES[e.type];
    if (e.debut === s.temps) { this.ecrire(e); return true; }      // cree ce tick : elle part au suivant
    e.age++;
    const lec = this.lec();
    if (e.plantee) {
      // bloc retire sous la fleche : elle tombe ; sinon elle attend sa fin de vie
      const [bx, by, bz] = e.cellulePlantee;
      const boites = boitesLocales(lec, bx, by, bz);
      if (!boites.length) { e.plantee = false; e.vx = (s.hasard.flottant() * 0.2) * (s.hasard.booleen() ? 1 : -1); e.vy = s.hasard.flottant() * 0.2 * (s.hasard.booleen() ? 1 : -1); e.vz = s.hasard.flottant() * 0.2 * (s.hasard.booleen() ? 1 : -1); e.age = 0; }
      else {
        e.vie = (e.vie ?? 0) + 1;
        if (e.vie >= R.valeur('projectiles.vieFleche', 1200)) { this.E._fini.add(e); return false; }
        this.ecrire(e);
        return true;
      }
    }
    if (P.feu) return this.tickFeu(e);
    const g = P.g * R.valeur('projectiles.gravite', 1);
    const p0 = [e.x, e.y, e.z], p1 = [e.x + e.vx, e.y + e.vy, e.z + e.vz];
    // blocs puis acteurs : le plus proche des deux
    let bloc = coupeBlocs(lec, p0, p1), cible = null;
    const d = [e.vx, e.vy, e.vz];
    const t1 = bloc ? bloc.t : 1;
    const prop = s.acteurs?.parNom.get(e.proprietaire) ?? null;
    if (!e.quitte && (!prop || !this.coupeActeur(prop, p0, d, P.boite))) e.quitte = true;     // le projectile quitte la boite de son lanceur avant de pouvoir le toucher
    for (const a of s.acteurs ? s.acteurs.liste : []) {
      if (a.mort >= 0 || (a === prop && !e.quitte)) continue;
      const r = this.coupeActeur(a, p0, d, P.boite);
      if (r && r.t <= t1 && (!cible || r.t < cible.t)) cible = { ...r, acteur: a };
    }
    if (cible) { if (this.toucheActeur(e, cible)) return false; }
    else if (bloc) return this.toucheBloc(e, bloc);
    // deplacement, puis trainee et gravite (AbstractArrow.tick : setPos, puis x inertie, puis gravite)
    e.x = p1[0]; e.y = p1[1]; e.z = p1[2];
    const fl = s.fluide(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z));
    const eau = fl.type === 'water';
    let c = eau ? P.eau : 0.99;
    if (eau && e.type === 'fleche') for (let i = 0; i < 4; i++) s.replay.particule(s.temps, 'bubble', e.x - e.vx * 0.25 * (i + 1), e.y - e.vy * 0.25 * (i + 1), e.z - e.vz * 0.25 * (i + 1), -e.vx, -e.vy, -e.vz, 1);
    if (e.type === 'fleche' && e.crit) for (let i = 0; i < 4; i++) s.replay.particule(s.temps, 'crit', e.x + e.vx * i / 4, e.y + e.vy * i / 4, e.z + e.vz * i / 4, -e.vx, -e.vy + 0.2, -e.vz, 1);
    if (e.type === 'perle') s.replay.particule(s.temps, 'portal', e.x, e.y + 0.1, e.z, 0, 0, 0, 1);
    e.vx *= c; e.vy = e.vy * c - g; e.vz *= c;
    if (e.y < -80 || e.age > 6000) { this.E._fini.add(e); return false; }
    this.ecrire(e);
    return true;
  }

  // ------------------------------------------------------------ boules de feu (AbstractHurtingProjectile.tick, LargeFireball, SmallFireball)
  // contact (blocs puis acteurs, le lanceur une fois quitte), deplacement, inertie (v + v/|v| x acceleration) x 0,95, trainee de fumee.
  // Grande : 6 de degats au touche puis explosion de puissance `puissance` (1 pour le ghast) avec feu (mobGriefing) ; petite : 5 de degats et
  // 5 s de feu sur l'acteur, ou un feu pose devant le bloc touche.
  tickFeu(e) {
    const s = this.sim, P = TYPES[e.type], lec = this.lec(), demi = P.boite / 2;
    const c0 = [e.x, e.y + demi, e.z], d = [e.vx, e.vy, e.vz], c1 = [c0[0] + d[0], c0[1] + d[1], c0[2] + d[2]];
    const bloc = coupeBlocs(lec, c0, c1);
    const prop = s.acteurs?.parNom.get(e.proprietaire) ?? null;
    const coupe = (a) => { const b = a.boite(); return tranche([b[0] - demi, b[1] - demi, b[2] - demi, b[3] + demi, b[4] + demi, b[5] + demi], c0, d); };
    if (!e.quitte && (!prop || !coupe(prop))) e.quitte = true;
    let cible = null;
    for (const a of s.acteurs ? s.acteurs.liste : []) {
      if (a.mort >= 0 || (a === prop && !e.quitte)) continue;
      const r = coupe(a);
      if (r && r.t <= (bloc ? bloc.t : 1) && (!cible || r.t < cible.t)) cible = { ...r, acteur: a };
    }
    if (cible || bloc) {
      const t = cible ? cible.t : bloc.t, pos = [c0[0] + d[0] * t, c0[1] + d[1] * t, c0[2] + d[2] * t];
      const evt = s.api.evenement('projectile.touche', { type: e.type, cible: cible?.acteur.nom ?? null, proprietaire: e.proprietaire });
      if (!evt.annule) { this.finFeu(e, pos, cible?.acteur ?? null, bloc && !cible ? bloc : null); this.E._fini.add(e); return false; }
    }
    e.x += e.vx; e.y += e.vy; e.z += e.vz;
    const eau = s.fluide(Math.floor(e.x), Math.floor(e.y + demi), Math.floor(e.z)).type === 'water';
    const k = eau ? P.eau : e.type === 'crane' && e.dangereux ? 0.73 : 0.95, L = Math.hypot(e.vx, e.vy, e.vz) || 1e-9, acc = e.acc ?? 0.1;
    e.vx = (e.vx + e.vx / L * acc) * k; e.vy = (e.vy + e.vy / L * acc) * k; e.vz = (e.vz + e.vz / L * acc) * k;
    s.replay.particule(s.temps, eau ? 'bubble' : e.type === 'boule_dragon' ? 'dragon_breath' : 'smoke', e.x, e.y + demi + 0.5, e.z, 0, 0, 0, 1);
    if (e.type === 'boule_feu' && e.age % 2 === 0) s.replay.particule(s.temps, 'flame', e.x, e.y + demi, e.z, 0, 0, 0, 1);
    if (e.y < -80 || e.age > 1200) { this.E._fini.add(e); return false; }
    this.ecrire(e);
    return true;
  }
  finFeu(e, pos, acteur, hit) {
    const s = this.sim, R = this.R, griefing = R.valeur('ia.explosionCasse', true);
    const [x, y, z] = pos;
    if (e.type === 'crane') return craneTouche(s, e, pos, acteur, griefing);
    if (e.type === 'boule_dragon') { if (acteur && acteur.nom === e.proprietaire) return; s.boss.nuageBoule(pos, e); return; }
    if (e.type === 'boule_feu') {
      if (acteur) { acteur.frappe(6, 'boule_feu', x - acteur.x, z - acteur.z, 0); s.dire(`boule de feu touche ${acteur.nom} : 6 degats`); }
      s.stats.boulesFeu = (s.stats.boulesFeu || 0) + 1;
      (s.stats.iaJournal ??= []).push(`${(s.temps / 20).toFixed(2)} boule de feu explose (puissance ${e.puissance ?? 1})${acteur ? ' sur ' + acteur.nom : ''} en ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}${e.renvoyee ? ' (renvoyee)' : ''}`);
      s.dire(`boule de feu : explosion de puissance ${e.puissance ?? 1}`);
      exploserFeu(s, x, y, z, e.puissance ?? 1, griefing);
      return;
    }
    // petite boule de feu
    s.stats.petitesBoulesFeu = (s.stats.petitesBoulesFeu || 0) + 1;
    if (acteur) {
      const ok = acteur.frappe(5, 'petite_boule_feu', x - acteur.x, z - acteur.z, 0);
      if (ok || acteur.mort < 0) allumerActeur(acteur, 100);
      (s.stats.iaJournal ??= []).push(`${(s.temps / 20).toFixed(2)} petite boule de feu touche ${acteur.nom}`);
    } else if (hit && griefing) {
      const c = hit.cellule, f = hit.face ?? [0, 1, 0], fx = c[0] + f[0], fy = c[1] + f[1], fz = c[2] + f[2];   // la face d'entree (normale sortante du bloc) : la cellule devant
      const n = s.monde.etatEn(fx, fy, fz);
      if (n >= 0 && /^(air|cave_air)$/.test(s.d.nomBloc(n))) s.api.poser(fx, fy, fz, 'minecraft:fire');
    }
  }
  // Fireball.hurtServer -> deflect (AIM_DEFLECT) : la boule repart dans la direction du regard de celui qui frappe (vitesse 1), acceleration 0,1,
  // et change de proprietaire (elle peut alors toucher le ghast).
  renvoyer(e, acteur, dir) {
    const L = Math.hypot(...dir) || 1;
    e.vx = dir[0] / L; e.vy = dir[1] / L; e.vz = dir[2] / L; e.acc = 0.1;
    e.proprietaire = acteur.nom; e.quitte = false; e.renvoyee = true;
    const s = this.sim;
    s.stats.renvois = (s.stats.renvois || 0) + 1;
    (s.stats.iaJournal ??= []).push(`${(s.temps / 20).toFixed(2)} ${acteur.nom} renvoie la boule de feu`);
  }

  // segment contre la boite de l'acteur, elargie de la marge de contact (0,3 pour une fleche)
  coupeActeur(a, p0, d) {
    const b = a.boite(), m = 0.3;
    return tranche([b[0] - m, b[1] - m, b[2] - m, b[3] + m, b[4] + m, b[5] + m], p0, d);
  }

  // ------------------------------------------------------------ contact avec un bloc
  toucheBloc(e, hit) {
    const s = this.sim, E = this.E;
    const nx = hit.pos[0], ny = hit.pos[1], nz = hit.pos[2];
    if (e.type === 'fleche' || e.type === 'trident') {
      // plantee : la fleche s'arrete au point d'impact, reculee de 0,05 le long de sa vitesse (AbstractArrow.onHitBlock)
      const L = Math.hypot(e.vx, e.vy, e.vz) || 1, vit = L;
      e.x = nx - (e.vx / L) * 0.05; e.y = ny - (e.vy / L) * 0.05; e.z = nz - (e.vz / L) * 0.05;
      e.dirx = e.vx / L; e.diry = e.vy / L; e.dirz = e.vz / L;
      e.plantee = true; e.cellulePlantee = hit.cellule; e.crit = false; e.vie = 0; e.vx = 0; e.vy = 0; e.vz = 0;
      s.son(e.type === 'trident' ? 'item.trident.hit_ground' : 'entity.arrow.hit', e.x, e.y, e.z, 1.0, 1.2 / (s.hasard.flottant() * 0.2 + 0.9));
      s.stats.plantees = (s.stats.plantees || 0) + 1;
      s.dire(`${e.type} plantee en ${hit.cellule.join(',')} (vitesse ${vit.toFixed(2)})`);
      s.api.evenement('projectile.bloc', { type: e.type, pos: hit.cellule, proprietaire: e.proprietaire });
      s.vibrations.emettre('projectile_land', e.x, e.y, e.z, { proprietaire: e.proprietaire });   // GameEvent.PROJECTILE_LAND
      this.ecrire(e);
      return true;
    }
    // objets lances : ils s'arretent ; effet selon le type
    s.vibrations.emettre('projectile_land', nx, ny, nz, { proprietaire: e.proprietaire });
    this.effetFin(e, [nx, ny, nz], null, hit);
    E._fini.add(e);
    return false;
  }

  // ------------------------------------------------------------ contact avec un acteur
  toucheActeur(e, cible) {
    const s = this.sim, E = this.E, a = cible.acteur, R = this.R;
    const px = e.x + e.vx * cible.t, py = e.y + e.vy * cible.t, pz = e.z + e.vz * cible.t;
    const dx = px - a.x, dz = pz - a.z, recul = R.valeur('projectiles.recul', 1);
    const evt = s.api.evenement('projectile.touche', { type: e.type, cible: a.nom, proprietaire: e.proprietaire });
    if (evt.annule) return false;
    if (e.type === 'fleche' || e.type === 'trident') {
      const vit = Math.hypot(e.vx, e.vy, e.vz);
      let q = Math.ceil(Math.min(vit * (e.type === 'trident' ? 8 : e.degatsBase), 2147483647));
      if (e.type === 'trident') q = 8;
      if (e.crit && e.type === 'fleche') q = Math.min(q + s.hasard.entierBorne(Math.floor(q / 2) + 2), 2147483647);
      q = Math.round(q * R.valeur('projectiles.degats', 1));
      const ok = a.frappe(q, e.type === 'trident' ? 'trident' : 'fleche', dx, dz, 0.4 * recul);
      if (ok) {
        s.stats.fleches = (s.stats.fleches || 0) + 1;
        s.dire(`${e.type} touche ${a.nom} : ${q} degats (vitesse ${vit.toFixed(2)}${e.crit ? ', critique' : ''})`);
        const proprio = s.acteurs?.parNom.get(e.proprietaire);
        if (proprio && proprio !== a) s.son('entity.arrow.hit_player', proprio.x, proprio.y + 1, proprio.z, 0.18, 0.45);
        s.son('entity.arrow.hit', px, py, pz, 1.0, 1.2 / (s.hasard.flottant() * 0.2 + 0.9));
        e.finEnTouchant = true;
        E._fini.add(e);
        return true;
      }
      // fenetre d'invulnerabilite : la fleche rebondit (AbstractArrow.deflect) et tombe
      e.vx *= -0.1; e.vy *= -0.1; e.vz *= -0.1; e.x = px; e.y = py; e.z = pz;
      return false;
    }
    this.effetFin(e, [px, py, pz], a, null);
    E._fini.add(e);
    return true;
  }

  // ------------------------------------------------------------ effets de fin des objets lances
  effetFin(e, pos, acteur, hit) {
    const s = this.sim, R = this.R;
    const [x, y, z] = pos;
    const prop = s.acteurs?.parNom.get(e.proprietaire) ?? null;
    if (e.type === 'boule' || e.type === 'oeuf') {
      if (acteur) { const dx = x - acteur.x, dz = z - acteur.z; acteur.frappe(0, e.type, dx, dz, 0.4 * R.valeur('projectiles.recul', 1)); s.stats.touches = (s.stats.touches || 0) + 1; s.dire(`${e.type} touche ${acteur.nom}`); }
      for (let i = 0; i < 8; i++) s.replay.particule(s.temps, 'item|' + TYPES[e.type].objet, x, y, z, (s.hasard.flottant() - 0.5) * 0.2, s.hasard.flottant() * 0.2, (s.hasard.flottant() - 0.5) * 0.2, 1);
      s.son(e.type === 'oeuf' ? 'entity.egg.throw' : 'block.snow.break', x, y, z, 0.5, 1);
      // ThrownEgg.onHit : 1 chance sur 8 qu'un poussin naisse (et 1 sur 32 alors : quatre), age -24000 ; regle `oeufs.poussins`
      if (e.type === 'oeuf' && R.valeur('oeufs.poussins', true) && s.acteurs && s.hasard.entierBorne(8) === 0) {
        const n = s.hasard.entierBorne(32) === 0 ? 4 : 1;
        for (let i = 0; i < n; i++) {
          const b = s.acteurs.naitre({ type: 'chicken', variante: e.variante ?? null, bebe: true, x, y: Math.floor(y + 0.01), z, lacet: e.lacet0 ?? 0, modele: prop?.nom ?? null, raison: 'oeuf', nom: `poussin`, gabaritParent: { l: 0.4, h: 0.7, oeil: 0.644, vitesse: 1 }, ia: {} });
          if (b) (s.stats.iaJournal ??= []).push(`${(s.temps / 20).toFixed(2)} un poussin sort de l oeuf : ${b.nom}`);
        }
      }
    } else if (e.type === 'perle') {
      for (let i = 0; i < 32; i++) s.replay.particule(s.temps, 'portal', x, y + s.hasard.reel() * 2, z, s.hasard.gaussien(), 0, s.hasard.gaussien(), 1);
      if (prop && prop.mort < 0) {
        // teleportation au point de contact (la position du projectile avant l'impact), degats 5 (regle perle.degats)
        let px = e.x, py = e.y, pz = e.z;
        for (let k = 0; k < 6; k++) { const b = prop.boite(px, py, pz); if (!this.occupe(b)) break; py += 0.5; }
        const ancien = [prop.x, prop.y, prop.z];
        for (let i = 0; i < 32; i++) s.replay.particule(s.temps, 'portal', ancien[0], ancien[1] + s.hasard.reel() * 2, ancien[2], s.hasard.gaussien(), 0, s.hasard.gaussien(), 1);
        prop.x = px; prop.y = py; prop.z = pz; prop.vx = 0; prop.vy = 0; prop.vz = 0; prop.distanceChute = 0;
        s.son('entity.player.teleport', px, py, pz, 1, 1);
        const q = R.valeur('perle.degats', 5);
        if (q > 0) prop.degats(q, 'perle');
        s.stats.teleports = (s.stats.teleports || 0) + 1;
        s.dire(`${prop.nom} se teleporte en ${px.toFixed(1)},${py.toFixed(1)},${pz.toFixed(1)}`);
      }
    } else if (e.type === 'potion') {
      s.son('entity.splash_potion.break', x, y, z, 1, s.hasard.flottant() * 0.1 + 0.9);
      const effet = e.effet || { id: 'speed', ticks: 1800, niveau: 0 };
      const couleur = COULEURS_EFFETS[effet.id] ?? 0.7;
      for (let i = 0; i < 24; i++) s.replay.particule(s.temps, 'effet', x, y + 0.1, z, (s.hasard.flottant() - 0.5) * 0.6, 0.1 + s.hasard.flottant() * 0.3, (s.hasard.flottant() - 0.5) * 0.6, couleur);
      for (let i = 0; i < 8; i++) s.replay.particule(s.temps, 'splash', x, y + 0.1, z, 0, 0, 0, 1);
      for (const a of s.acteurs ? s.acteurs.liste : []) {
        if (a.mort >= 0) continue;
        const b = a.boite();
        // boite du projectile elargie de (4, 2, 4)
        if (!(b[3] > x - 4.25 && b[0] < x + 4.25 && b[4] > y - 2.25 && b[1] < y + 2.25 && b[5] > z - 4.25 && b[2] < z + 4.25)) continue;
        const d2 = (a.x - x) ** 2 + (a.y + 0.9 - y) ** 2 + (a.z - z) ** 2;
        if (d2 >= 16) continue;
        const force = a === acteur ? 1 : 1 - Math.sqrt(d2) / 4;
        // degats instantanes (InstantenousMobEffect : (int)(force x (6 << niveau) + 0,5)) ; soin instantane : 4 << niveau
        if (effet.id === 'instant_damage') { const q = Math.floor(force * (6 << (effet.niveau ?? 0)) + 0.5); if (q > 0) a.degats(q, 'magie'); continue; }
        if (effet.id === 'instant_health') { a.vie = Math.min(a.vieMax, a.vie + Math.floor(force * (4 << (effet.niveau ?? 0)) + 0.5)); continue; }
        a.appliquerEffet(effet.id, Math.floor(force * effet.ticks + 0.5), effet.niveau ?? 0);
      }
    } else if (e.type === 'trident') {
      s.son('item.trident.hit_ground', x, y, z, 1, 1);
    }
    void hit;
  }
  occupe(b) {
    const lec = this.lec();
    for (let y = Math.floor(b[1]); y <= Math.floor(b[4] - 1e-6); y++) for (let z = Math.floor(b[2]); z <= Math.floor(b[5] - 1e-6); z++) for (let x = Math.floor(b[0]); x <= Math.floor(b[3] - 1e-6); x++) {
      for (const k of boitesLocales(lec, x, y, z)) if (b[3] > k[0] + x && b[0] < k[3] + x && b[4] > k[1] + y && b[1] < k[4] + y && b[5] > k[2] + z && b[2] < k[5] + z) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ replay
  // fleche, trident : (type, x, y, z, lacet, tangage) ; objet lance : (type, x, y, z, 0, nom de l'objet)
  ecrire(e) {
    const s = this.sim, rp = s.replay;
    let vx = e.vx, vy = e.vy, vz = e.vz;
    if (e.plantee) { vx = e.dirx; vy = e.diry; vz = e.dirz; }
    if (e.type === 'fleche' || e.type === 'trident') {
      const h = Math.hypot(vx, vz), lacet = Math.atan2(-vx, vz) / RAD, tangage = -Math.atan2(vy, h) / RAD;
      rp.entite(s.temps, e.id, e.plantee ? e.type + '_plantee' : e.type, e.x, e.y, e.z, lacet, tangage);
    } else if (e.type === 'crane') {   // WitherSkullRenderer : la tete du wither (cube 8 px), tournee selon la vitesse ; bleue si dangereuse
      const h = Math.hypot(vx, vz);
      rp.entite(s.temps, e.id, e.dangereux ? 'crane_bleu' : 'crane', e.x, e.y + 0.15625, e.z, Math.atan2(-vx, vz) / RAD, -Math.atan2(vy, h) / RAD);
    } else if (e.type === 'boule_dragon') rp.entite(s.temps, e.id, 'boule_dragon', e.x, e.y + 0.5, e.z, 2, -1);   // DragonFireballRenderer : sprite x 2
    else if (TYPES[e.type]?.feu) rp.entite(s.temps, e.id, 'boule_feu', e.x, e.y + TYPES[e.type].boite / 2, e.z, TYPES[e.type].echelle, rp.nom('fire_charge'));   // centre de la boule, echelle du dessin
    else rp.entite(s.temps, e.id, 'lance', e.x, e.y, e.z, 0, rp.nom(e.objet));
  }
}

// explosion d'une grande boule de feu (LargeFireball.onHit : explode(puissance, feu = mobGriefing))
function exploserFeu(sim, x, y, z, puissance, griefing) { exploser(sim, x, y, z, { puissance, feu: griefing, casseBlocs: griefing, source: 'boule_feu' }); }
// WitherSkull.onHitEntity / onHit (Horizon game/wither.rs, MIT) : 8 degats `wither_skull` si le lanceur vit encore (5 de magie sinon), puis
// Fletrissement II 10 s (normal) ou 40 s (difficile) sur une cible qui survit ; le lanceur regagne 5 s'il tue ; enfin une explosion de
// puissance 1 (mobGriefing), qui plafonne la resistance des blocs a 0,8 pour un crane bleu (il casse la pierre, l'obsidienne...).
function craneTouche(s, e, pos, acteur, griefing) {
  const prop = s.acteurs?.parNom.get(e.proprietaire) ?? null, vivant = !!prop && prop.mort < 0;
  const dif = { paisible: 0, peaceful: 0, facile: 1, easy: 1, normal: 2, difficile: 3, hard: 3 }[s.regles.valeur('monde.difficulte', 'normal')] ?? 2;
  const fl = dif === 2 ? 200 : dif === 3 ? 800 : 0;
  if (acteur && !(prop?.ia?.type === 'wither' && /^(zombie|husk|drowned|zombie_villager|skeleton|stray|bogged|parched|wither_skeleton|zombie_horse|skeleton_horse|phantom|zombified_piglin|zoglin|wither)$/.test(acteur.ia?.type ?? acteur.typeCreature ?? ''))) {
    const q = vivant ? 8 : 5, ok = acteur.frappe(q, vivant ? 'crane_wither' : 'magie', pos[0] - acteur.x, pos[2] - acteur.z, 0);
    if (ok && acteur.mort < 0 && fl > 0 && acteur.typeCreature !== 'wither') acteur.appliquerEffet('wither', fl, 1);
    if (ok && acteur.mort >= 0 && vivant) prop.vie = Math.min(prop.vieMax, prop.vie + 5);
    (s.stats.iaJournal ??= []).push(`${(s.temps / 20).toFixed(2)} crane${e.dangereux ? ' bleu' : ''} touche ${acteur.nom} : ${q}${fl && acteur.mort < 0 ? `, fletrissement II ${fl / 20} s` : ''}`);
  }
  s.stats.cranes = (s.stats.cranes || 0) + 1;
  exploser(s, pos[0], pos[1], pos[2], { puissance: 1, casseBlocs: griefing, source: 'crane', ...(e.dangereux ? { plafondResistance: 0.8 } : {}) });
}
// met un acteur en feu `ticks` ticks (Entity.igniteForSeconds) : une creature a IA brule par son IA, un joueur par le compteur `feuJoueur` (acteurs.js)
export function allumerActeur(a, ticks) {
  if (a.ia) { if (!a.ia.pr.immuniseFeu) a.ia.feu = Math.max(a.ia.feu, ticks); return; }
  a.feuJoueur = Math.max(a.feuJoueur ?? 0, ticks);
}

// couleur (teinte 0..1) des particules d'un effet de potion : sert a `effet` du rendu
export const COULEURS_EFFETS = { speed: 0.55, slowness: 0.62, jump_boost: 0.35, invisibility: 0.8, glowing: 0.15, regeneration: 0.95, poison: 0.28, strength: 0.0, night_vision: 0.7, weakness: 0.66, instant_damage: 0.98, instant_health: 0.02, fire_resistance: 0.08, water_breathing: 0.6, absorption: 0.12 };
