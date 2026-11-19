// Projectiles : fleches (arc, arbalete), boules de neige, oeufs, perles d'ender, potions jetees, trident. Port de AbstractArrow, ThrowableProjectile,
// ThrownEnderpearl, ThrownPotion, BowItem, CrossbowItem (Horizon client/{arrows,projectiles}.rs, client/game/crossbow.rs : MIT, voir ATTRIBUTIONS.md).
// Un projectile est une entite (moteur/entites.js) : un enregistrement par tick dans la colonne `entites` du replay, dessine par film/entites-monde.js.
//   fleche  : gravite 0,05, trainee 0,99 (0,6 dans l'eau), vitesse 3,0 x puissance (arc) ou 3,15 (arbalete) ; degats ceil(vitesse x 2) (+ alea si critique) ;
//             plantee dans un bloc (1200 ticks), boite de contact elargie de 0,3
//   boule, oeuf, perle : gravite 0,03, trainee 0,99, vitesse 1,5 ; la perle teleporte son lanceur et lui fait 5 de degats ; la boule et l'oeuf ne blessent pas
//   potion jetee : gravite 0,05, vitesse 0,5 (tir 20 degres plus haut), effets dans 4 x 2 x 4 autour, force 1 - sqrt(d2) / 4 si d2 < 16
//   trident : gravite 0,05, vitesse 2,5, degats 8
//   eau (la boite touche l'eau au tick d'avant) : objets jetes x 0,8F au lieu de 0,99F, fleche 0,6F, trident 0,99F, 4 bulles ; ils continuent ;
//   colonnes de bulles (Projectile.onInsideBubbleColumn / onAboveBubbleColumn, sans borne) : +0,06 dedans, +0,1 a la surface, -0,03 descendante :
//   une perle y reste en suspens (stase) jusqu'a ce qu'un bloc la touche (trappe qui se ferme : elle est DANS la forme, VoxelShape.clip)
// Le hasard vient du monde (moteur/aleatoire.js) : meme graine, memes tirs.
import { boitesLocales } from './collision.js';
import { exploser } from './explosion.js';
import { tickFusee } from './fusees.js';
import { toucheVent } from './vent.js';
import { lirePile } from './pile.js';
import { couleurPotion } from './potions.js';
import { descendre } from './vehicules.js';

const RAD = Math.PI / 180;
const CUBE = [[0, 0, 0, 1, 1, 1]];

// type -> parametres du jeu
export const TYPES = {
  fleche: { g: 0.05, eau: 0.6, boite: 0.5 },
  // ThrowableProjectile (jete) : gravite PUIS trainee (0,99F ; 0,8F dans l'eau), puis le contact et le deplacement (Horizon projectiles.rs)
  boule: { g: 0.03, eau: 0.8, boite: 0.25, objet: 'snowball', jete: true },
  oeuf: { g: 0.03, eau: 0.8, boite: 0.25, objet: 'egg', jete: true },
  perle: { g: 0.03, eau: 0.8, boite: 0.25, objet: 'ender_pearl', jete: true },
  potion: { g: 0.05, eau: 0.8, boite: 0.25, objet: 'splash_potion', jete: true },
  // fiole d'experience (ThrownExperienceBottle : gravite 0,07 ; lancee a 0,7, 20 degres plus haut ; distributeur 1,375, imprecision 3)
  fiole: { g: 0.07, eau: 0.8, boite: 0.25, objet: 'experience_bottle', jete: true },
  trident: { g: 0.05, eau: 0.99, boite: 0.5, objet: 'trident' },
  // boules de feu (AbstractHurtingProjectile : sans gravite, acceleration 0,1 le long de la vitesse, inertie 0,95 (0,8 dans l'eau) ; LargeFireball 1 x 1,
  // SmallFireball 0,3125 ; dessinees comme une charge de feu x 3 et x 0,75, pleine lumiere)
  boule_feu: { g: 0, eau: 0.8, boite: 1.0, objet: 'fire_charge', feu: true, echelle: 3 },
  petite_boule_feu: { g: 0, eau: 0.8, boite: 0.3125, objet: 'fire_charge', feu: true, echelle: 0.75 },
  // crane du wither (WitherSkull : 0,3125, inertie 0,95, bleu 0,73) ; boule de feu du dragon (DragonFireball : 1 x 1, trainee de souffle)
  crane: { g: 0, eau: 0.8, boite: 0.3125, feu: true, sansFeu: true },
  boule_dragon: { g: 0, eau: 0.8, boite: 1.0, feu: true, sansFeu: true },
  // fusee d'artifice (moteur/fusees.js) ; charges de vent du joueur et du breeze (moteur/vent.js : 0,3125, vol droit, inertie 1, sans acceleration)
  fusee: { g: 0, eau: 0.99, boite: 0.25, objet: 'firework_rocket', fusee: true },
  vent: { g: 0, eau: 1, boite: 0.3125, objet: 'wind_charge', vent: true },
  vent_breeze: { g: 0, eau: 1, boite: 0.3125, objet: 'wind_charge', vent: true },
};
// Entity.deflection : un breeze renvoie tout projectile sauf les charges de vent (ProjectileDeflection.REVERSE : vitesse x -0,5) ; son entity.breeze.deflect (5)
export const estBreeze = (a) => !!a && (a.typeCreature === 'breeze' || a.ia?.type === 'breeze');
// Le segment p0 + t x d contre un acteur, sa boite elargie de `marge` ; le dragon de l'Ender n'a pas de boite a toucher : seulement ses 8
// parties (EnderDragonPart : tete, cou, corps, 3 de queue, 2 ailes), chacune elargie de la marge ; un projectile qui passe entre elles le
// manque. Rend { t, face, partie } ou null.
export function coupeCible(a, p0, d, marge) {
  if (a.ia?.type === 'ender_dragon' && a.ia.partiesDragon) {
    let best = null;
    for (const [nom, b] of a.ia.partiesDragon()) {
      const r = tranche([b[0] - marge, b[1] - marge, b[2] - marge, b[3] + marge, b[4] + marge, b[5] + marge], p0, d);
      if (r && (!best || r.t < best.t)) best = { ...r, partie: nom };
    }
    return best;
  }
  const b = a.boite();
  return tranche([b[0] - marge, b[1] - marge, b[2] - marge, b[3] + marge, b[4] + marge, b[5] + marge], p0, d);
}
// la partie du dragon touchee ce tick (ia-boss.js partieTouchee : tete = degats entiers, ailleurs d / 4 + min(d, 1))
const marquerPartie = (s, a, r) => { if (r?.partie) a.partieCoup = { nom: r.partie, t: s.temps }; };
export function renvoyerBreeze(s, e, a) {
  e.vx *= -0.5; e.vy *= -0.5; e.vz *= -0.5; e.quitte = true;
  s.son('entity.breeze.deflect', a.x, a.y, a.z, 1, 1);
  s.stats.renvoisBreeze = (s.stats.renvoisBreeze || 0) + 1;
}
// objet tenu -> type de projectile lance (clic droit dans l'air, verbe `lance`)
export const LANCABLES = { snowball: 'boule', egg: 'oeuf', ender_pearl: 'perle', splash_potion: 'potion', lingering_potion: 'potion', trident: 'trident', wind_charge: 'vent', experience_bottle: 'fiole' };
// vitesse de depart et deviation (le jeu : Snowball.shootFromRotation(..., 1.5, 1.0) ; potion : 0,5 avec -20 degres ; fiole : 0,7 avec -20 ; trident : 2,5)
export const VITESSE_LANCE = { boule: 1.5, oeuf: 1.5, perle: 1.5, potion: 0.5, trident: 2.5, vent: 1.5, fiole: 0.7 };
export const TANGAGE_LANCE = { potion: -20, fiole: -20 };

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
  if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < 1e-7) return null;   // VoxelShape.clip : un deplacement de moins de 1e-7 (au carre) ne touche rien
  let meilleur = null;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const L = boitesLocales(lec, x, y, z);
    for (let i = 0; i < L.length; i++) {
      const k = L[i], bb = [k[0] + x, k[1] + y, k[2] + z, k[3] + x, k[4] + y, k[5] + z], r = tranche(bb, p0, d);
      if (r && r.t === 0 && !r.face) {   // depart sur ou dans la boite : ne compte que si le point avance de 0,001 x d est dedans (VoxelShape.clip)
        const q = [p0[0] + d[0] * 0.001, p0[1] + d[1] * 0.001, p0[2] + d[2] * 0.001];
        if (!(q[0] >= bb[0] && q[0] < bb[3] && q[1] >= bb[1] && q[1] < bb[4] && q[2] >= bb[2] && q[2] < bb[5])) continue;
      }
      if (r && (!meilleur || r.t < meilleur.t)) meilleur = { ...r, cellule: [x, y, z] };
    }
  }
  if (meilleur && meilleur.t === 0 && !meilleur.face) {
    // VoxelShape.clip, depart DANS la forme (un bloc pose sur le projectile : trappe qui se ferme sur une perle en stase) : touche au point
    // avance de 0,001 x le deplacement, face = l'oppose de la direction dominante (Direction.getApproximateNearest)
    meilleur.t = 0.001;
    const a = Math.abs(d[0]) >= Math.abs(d[1]) && Math.abs(d[0]) >= Math.abs(d[2]) ? 0 : Math.abs(d[1]) >= Math.abs(d[2]) ? 1 : 2;
    meilleur.face = [0, 0, 0]; meilleur.face[a] = -Math.sign(d[a]); meilleur.dedans = true;
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
// (gravite g, trainee c), tous les angles du jeu permis (-90 droit en haut .. 90 droit en bas ; `min`, `max` : bornes du projectile, une potion
// part 20 degres au-dessus du regard). Le vol est celui du jeu : `ordre` "fleche" (AbstractArrow : deplacement, puis trainee et gravite) ou
// "jete" (ThrowableProjectile : gravite et trainee, puis deplacement). On balaie du plus bas (droit en bas) au plus haut et on garde le premier
// angle qui atteint le point : le tir tendu (l'arc bas) ; null si aucun angle ne l'atteint.
export function tangageBalistique(dh, dy, v, g, c = 0.99, { ordre = 'fleche', min = -90, max = 90 } = {}) {
  dh = Math.max(dh, 1e-3);   // droit en dessous ou au-dessus : un millieme de bloc a cote (le balayage trouve alors l'angle vertical)
  const reste = c < 1 ? c / (1 - c) : Infinity;   // portee horizontale qui reste : vx x (c + c^2 + ...)
  const hauteurA = (tang) => {                     // hauteur atteinte a la distance dh, ou -Infinity (retombe avant, ou n'y arrive jamais)
    const a = -tang * RAD;
    let x = 0, y = 0, vx = v * Math.cos(a), vy = v * Math.sin(a);
    if (!(vx > 1e-9)) return -Infinity;
    for (let i = 0; i < 4000; i++) {
      if (ordre === 'jete') { vy -= g; vx *= c; vy *= c; }
      const nx = x + vx, ny = y + vy;
      if (nx >= dh) return y + (ny - y) * ((dh - x) / (nx - x));
      x = nx; y = ny;
      if (ordre !== 'jete') { vx *= c; vy = vy * c - g; }
      if ((y < dy && vy <= 0) || x + vx * reste < dh) return -Infinity;
    }
    return -Infinity;
  };
  let prec = -Infinity, precT = max;
  for (let t = max; t >= min - 1e-9; t -= 0.25) {
    const f = hauteurA(t) - dy;
    if (prec < 0 && f >= 0) {                      // premier angle qui passe au-dessus du point : on affine entre les deux
      let lo = precT, hi = t;
      for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (hauteurA(m) - dy < 0) lo = m; else hi = m; }
      return hi;
    }
    prec = f; precT = t;
  }
  return null;
}

// ------------------------------------------------------------ l'eau et les colonnes de bulles autour d'un projectile
// Boite d'un projectile (cote `l`, pieds en y) : celle du jeu (EntityDimensions : 0,25 pour les objets jetes, 0,5 fleche et trident)
const boiteProj = (x, y, z, l) => [x - l / 2, y, z - l / 2, x + l / 2, y + l, z + l / 2];
// Entity.updateFluidInteraction (updateFluidHeightAndDoFluidPushing) : la boite (reduite de 0,001) touche de l'eau dont la surface
// (y + 1 si de l'eau est au-dessus, sinon niveau / 9) atteint son bas ; le courant moyen, normalise (pas un joueur), x 0,014, au moins
// 0,0045 si l'entite est presque arretee (FlowingFluid.getFlow, `sim.courant`) ; vrai : l'entite est dans l'eau.
export function eauEtCourant(s, e, l, pousse = true, bas = 0) {
  const b = boiteProj(e.x, e.y + bas, e.z, l), m = 0.001, base = b[1];
  let dans = false, haut = 0, n = 0;
  const acc = [0, 0, 0];
  for (let x = Math.floor(b[0] + m); x <= Math.ceil(b[3] - m) - 1; x++) for (let y = Math.floor(b[1] + m); y <= Math.ceil(b[4] - m) - 1; y++) for (let z = Math.floor(b[2] + m); z <= Math.ceil(b[5] - m) - 1; z++) {
    const f = s.fluide(x, y, z);
    if (f.type !== 'water') continue;
    const surface = y + (s.fluide(x, y + 1, z).type === 'water' ? 1 : f.quantite / 9);
    if (surface < b[1] + m) continue;
    dans = true; haut = Math.max(haut, surface - base);
    let c = s.courant(x, y, z);
    if (haut < 0.4) c = c.map((q) => q * haut);
    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; n++;
  }
  const L2 = acc[0] ** 2 + acc[1] ** 2 + acc[2] ** 2;
  if (pousse && n && L2 >= Math.fround(1e-5)) {
    const L = Math.sqrt(L2);
    let w = acc.map((q) => q / L * 0.014);
    if (Math.abs(e.vx) < 0.003 && Math.abs(e.vz) < 0.003 && Math.hypot(...w) < 0.0045000000000000005) { const k = Math.hypot(...w); w = w.map((q) => q / k * 0.0045000000000000005); }
    e.vx += w[0]; e.vy += w[1]; e.vz += w[2];
  }
  return dans;
}
// BubbleColumnBlock.entityInside pour la cellule (x, y, z) : { drag, surface } ou null (surface : au-dessus, ni boite de collision ni fluide)
export function colonneBulleEn(s, x, y, z) {
  const k = s.monde.etatEn(x, y, z);
  if (k < 0 || s.d.nomBloc(k) !== 'bubble_column') return null;
  const dessus = s.monde.etatEn(x, y + 1, z);
  return { drag: s.d.prop(k, 'drag') === 'true', surface: dessus >= 0 && s.d.boites(dessus).length === 0 && !s.d.fluide(dessus) };
}
// Projectile.onAboveBubbleColumn / onInsideBubbleColumn : SANS les bornes des autres entites ; descendante (magma) -0,03, montante +0,06 dedans,
// +0,1 a la surface (et les eclaboussures de la surface : Entity.sendBubbleColumnParticles, 2 splash et 2 bulles)
function pousseeBulleProj(s, e, c, x, y, z) {
  if (c.surface) {
    const h = s.hasard;
    for (let i = 0; i < 2; i++) {
      s.replay.particule(s.temps, 'splash', x + h.reel(), y + 1, z + h.reel(), 0, 0, 0, 1);
      s.replay.particule(s.temps, 'bubble', x + h.reel(), y + 1, z + h.reel(), h.gaussien() * 0.2, h.gaussien() * 0.2, h.gaussien() * 0.2, 1);
    }
  }
  e.vy += c.drag ? -0.03 : c.surface ? 0.1 : 0.06;
  s.stats.poussesBulles = (s.stats.poussesBulles || 0) + 1;
}
// ThrowableProjectile.handleFirstTickBubbleColumn : au premier tick, chaque colonne de la boite (cellules de ses deux coins) pousse avant la gravite
function bullesPremierTick(s, e, l) {
  const b = boiteProj(e.x, e.y, e.z, l);
  for (let x = Math.floor(b[0]); x <= Math.floor(b[3]); x++) for (let y = Math.floor(b[1]); y <= Math.floor(b[4]); y++) for (let z = Math.floor(b[2]); z <= Math.floor(b[5]); z++) {
    const c = colonneBulleEn(s, x, y, z);
    if (c) pousseeBulleProj(s, e, c, x, y, z);
  }
}
// Entity.applyEffectsFromBlocks (checkInsideBlocks) apres le deplacement de `de` a la position : les cellules balayees par la boite (reduite
// de 1e-5F), chacune une fois ; une colonne pousse si le deplacement depasse presque un bloc ou si la boite d'arrivee est dedans
function bullesLeLong(s, e, de, l, bas = 0) {
  const eps = Math.fround(1e-5), a = [e.x, e.y + bas, e.z], d = [e.x - de[0], e.y - de[1], e.z - de[2]], L = Math.hypot(...d);
  const loin = L * L > 0.9999900000002526 * 0.9999900000002526;
  const n = Math.min(64, Math.max(1, Math.ceil(L / (l / 2)))), vues = new Set(), cellules = [];
  for (let i = 0; i <= n; i++) {
    const p = [de[0] + d[0] * i / n, de[1] + bas + d[1] * i / n, de[2] + d[2] * i / n], b = boiteProj(p[0], p[1], p[2], l);
    for (let x = Math.floor(b[0] + eps); x <= Math.floor(b[3] - eps); x++) for (let y = Math.floor(b[1] + eps); y <= Math.floor(b[4] - eps); y++) for (let z = Math.floor(b[2] + eps); z <= Math.floor(b[5] - eps); z++) {
      const k = `${x},${y},${z}`;
      if (!vues.has(k)) { vues.add(k); cellules.push([x, y, z]); }
    }
  }
  const f = boiteProj(a[0], a[1], a[2], l);
  for (const [x, y, z] of cellules) {
    const c = colonneBulleEn(s, x, y, z);
    if (!c) continue;
    const dedans = f[3] - eps > x && f[0] + eps < x + 1 && f[4] - eps > y && f[1] + eps < y + 1 && f[5] - eps > z && f[2] + eps < z + 1;
    if (loin || dedans) pousseeBulleProj(s, e, c, x, y, z);
  }
}
// 4 bulles en pos - v x 0,25, de vitesse v (ThrowableProjectile / AbstractHurtingProjectile.applyInertia, AbstractArrow.tick dans l'eau)
function bullesSillage(s, x, y, z, v) {
  for (let i = 0; i < 4; i++) s.replay.particule(s.temps, 'bubble', x - v[0] * 0.25, y - v[1] * 0.25, z - v[2] * 0.25, v[0], v[1], v[2], 1);
}

export class Projectiles {
  constructor(entites) { this.E = entites; this.sim = entites.sim; }
  get R() { return this.sim.regles; }
  lec() { return this.E.lec; }

  // Direction de tir comme Projectile.shoot : normalisee + bruit triangulaire (0,0172275 x deviation) sur chaque axe, puis x vitesse
  tirer(lacet, tangage, vitesse, deviation) {
    const s = this.sim, h = s.hasard, d = direction(lacet, tangage), k = 0.0172275 * deviation * this.R.valeur('projectiles.imprecision', 1);
    const v = [d[0] + (h.flottant() - h.flottant()) * k, d[1] + (h.flottant() - h.flottant()) * k, d[2] + (h.flottant() - h.flottant()) * k];
    const vit = vitesse * this.R.valeur('projectiles.vitesse', 1);
    return v.map((c) => c * vit);   // Projectile.getMovementToShoot : (direction normalisee + triangle) x vitesse, sans renormaliser
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
    const e = this.creer('fleche', acteur, origine, v, { crit: opt.crit ?? puissance >= 1.0, degatsBase: opt.degatsBase ?? 2.0, arbalete: !!opt.arbalete, vitesse0: vit, ...(opt.extra ?? {}) });   // extra : arme, munition, Flamme, Perforation, effets (inventaire.js)
    if (e) s.dire(`${acteur.nom} tire une fleche (puissance ${puissance.toFixed(2)}, vitesse ${Math.hypot(e.vx, e.vy, e.vz).toFixed(2)})`);
    return e;
  }

  // Objet lance (boule, oeuf, perle, potion, trident) dans la direction (lacet, tangage) de l'acteur
  lancer(acteur, type, lacet, tangage, opt = {}) {
    const vit = VITESSE_LANCE[type] ?? 1.5, dev = 1.0;
    const origine = [acteur.x, acteur.oeil()[1] - (type === 'vent' ? 0 : 0.1), acteur.z];   // WindChargeItem.use : la charge part des yeux
    const v = this.tirer(lacet, tangage + (TANGAGE_LANCE[type] ?? 0), vit, dev);
    return this.creer(type, acteur, origine, v, { objet: opt.objet ?? TYPES[type].objet, effet: opt.effet ?? null, effets: opt.effets ?? null, persistante: !!opt.persistante, pile: opt.pile ?? null });
  }

  // ------------------------------------------------------------ un tick
  tick(e) {
    const s = this.sim, R = this.R, P = TYPES[e.type];
    if (e.debut === s.temps) { this.ecrire(e); return true; }      // cree ce tick : elle part au suivant
    e.age++;
    const lec = this.lec();
    // Loyaute (ThrownTrident.tick) : apres un coup, ou plantee depuis plus de 4 ticks, la lance revient vers les yeux de son lanceur
    if (e.type === 'trident') {
      e.loyaute ??= e.pile ? lirePile(e.pile).ench.loyalty ?? 0 : 0;
      const o = s.acteurs?.parNom.get(e.proprietaire);
      if (e.loyaute > 0 && (e.inflige || e.retour || (e.plantee && (e.vie ?? 0) > 4)) && o && o.mort < 0) return this.tickRetour(e, o);
    }
    if ((e.type === 'fleche' || e.type === 'trident') && (e.plantee || e.retour) && this.ramasser(e)) return false;
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
    if (P.fusee) { const vit = tickFusee(this, e); if (vit) this.ecrire(e); else this.E._fini.add(e); return vit; }
    if (P.vent) return this.tickVent(e);
    const g = P.g * R.valeur('projectiles.gravite', 1);
    // ThrownEnderpearl.tick : la perle d'un joueur mort disparait (regle du jeu enderPearlsVanishOnDeath, `perle.disparaitMort`)
    if (e.type === 'perle' && R.valeur('perle.disparaitMort', true)) {
      const o = s.acteurs?.parNom.get(e.proprietaire);
      if (o && !o.typeCreature && o.mort >= 0) { s.dire(`la perle de ${o.nom} disparait (lanceur mort)`); this.E._fini.add(e); return false; }
    }
    const l = P.boite;
    if (P.jete) {   // ThrowableProjectile.tick : colonnes du premier tick, applyGravity puis applyInertia (dans l'eau au tick d'avant : 0,8F, et 4 bulles)
      if (e.age === 1) bullesPremierTick(s, e, l);
      e.vy -= g;
      if (e.dansEau) bullesSillage(s, e.x, e.y, e.z, [e.vx, e.vy, e.vz]);
      const c = Math.fround(e.dansEau ? P.eau : 0.99);
      e.vx *= c; e.vy *= c; e.vz *= c;
    }
    const p0 = [e.x, e.y, e.z], p1 = [e.x + e.vx, e.y + e.vy, e.z + e.vz];
    // blocs puis acteurs : le plus proche des deux
    let bloc = coupeBlocs(lec, p0, p1), cible = null;
    const d = [e.vx, e.vy, e.vz];
    const t1 = bloc ? bloc.t : 1;
    const prop = s.acteurs?.parNom.get(e.proprietaire) ?? null;
    if (!e.quitte && (!prop || !this.coupeActeur(prop, p0, d, P.boite))) e.quitte = true;     // le projectile quitte la boite de son lanceur avant de pouvoir le toucher
    for (const a of s.acteurs ? s.acteurs.liste : []) {
      if (a.mort >= 0 || (a === prop && !e.quitte) || e.inflige || e.perces?.has(a)) continue;   // trident qui a deja touche, fleche qui a perce cet acteur
      const r = this.coupeActeur(a, p0, d, P.boite);
      if (r && r.t <= t1 && (!cible || r.t < cible.t)) cible = { ...r, acteur: a };
    }
    if (cible && estBreeze(cible.acteur)) { renvoyerBreeze(s, e, cible.acteur); this.ecrire(e); return true; }   // renvoyee sans avancer (le contact n'est pas un deplacement)
    if (cible) { if (this.toucheActeur(e, cible)) return false; }
    else if (bloc) return this.toucheBloc(e, bloc);
    // deplacement. Fleche, trident (AbstractArrow.tick) : la vitesse du tick d'avant deplace ; dans l'eau (au tick d'avant) elle est
    // multipliee par getWaterInertia (fleche 0,6F, trident 0,99F) et laisse 4 bulles, sinon par 0,99F ; puis la gravite.
    if (e.type === 'fleche' && e.crit) for (let i = 0; i < 4; i++) s.replay.particule(s.temps, 'crit', p0[0] + e.vx * i / 4, p0[1] + e.vy * i / 4, p0[2] + e.vz * i / 4, -e.vx, -e.vy + 0.2, -e.vz, 1);
    e.x = p1[0]; e.y = p1[1]; e.z = p1[2];
    if (!P.jete) {
      if (e.dansEau) { const c = Math.fround(P.eau); e.vx *= c; e.vy *= c; e.vz *= c; bullesSillage(s, p0[0], p0[1], p0[2], [e.vx, e.vy, e.vz]); }
      else { const c = Math.fround(0.99); e.vx *= c; e.vy *= c; e.vz *= c; }
      e.vy -= g;
    }
    if (e.type === 'perle') s.replay.particule(s.temps, 'portal', e.x, e.y + 0.1, e.z, 0, 0, 0, 1);
    // Entity.baseTick : l'eau que touche la boite maintenant (elle compte au tick suivant) et ses courants ; puis applyEffectsFromBlocks : les
    // colonnes de bulles traversees (Projectile.onInsideBubbleColumn / onAboveBubbleColumn : une perle y reste en suspens, "stase")
    e.dansEau = eauEtCourant(s, e, l);
    bullesLeLong(s, e, p0, l);
    if (e.feuFleche > 0) { if (e.dansEau) e.feuFleche = 0; else { e.feuFleche--; s.replay.particule(s.temps, 'flame', e.x, e.y, e.z, 0, 0.01, 0, 1); } }   // fleche en feu (Flamme) : l'eau l'eteint ; flammes comme les acteurs qui brulent (convention du film)
    if (e.y < -128 || e.age > 6000) { this.E._fini.add(e); return false; }
    this.ecrire(e);
    return true;
  }

  // ThrownTrident.tick, retour de Loyaute (Horizon trident.rs loyalty_pull) : sans collisions, y += dy x 0,015 x niveau, v = v x 0,95 + direction x
  // 0,05 x niveau ; son item.trident.return au depart ; le lanceur la reprend en la touchant
  tickRetour(e, o) {
    const s = this.sim, oeil = o.oeil();
    if (!e.retour) { e.retour = true; e.plantee = false; s.son('item.trident.return', e.x, e.y, e.z, 10, 1); }
    const v = [oeil[0] - e.x, oeil[1] - e.y, oeil[2] - e.z], L = Math.max(1e-9, Math.hypot(...v)), k = 0.05 * e.loyaute;
    e.y += v[1] * 0.015 * e.loyaute;
    e.vx = e.vx * 0.95 + v[0] / L * k; e.vy = e.vy * 0.95 + v[1] / L * k; e.vz = e.vz * 0.95 + v[2] / L * k;
    e.x += e.vx; e.y += e.vy; e.z += e.vz;
    e.vx *= 0.99; e.vy *= 0.99; e.vz *= 0.99;
    if (this.ramasser(e)) return false;
    this.ecrire(e);
    return true;
  }
  // AbstractArrow.playerTouch : une fleche plantee (ramassable) ou un trident (plante, ou qui revient a son lanceur) touche par un acteur qui ramasse
  // (ou par le lanceur du trident) : dans son sac, son entity.item.pickup
  ramasser(e) {
    const s = this.sim;
    for (const a of s.acteurs ? s.acteurs.liste : []) {
      if (a.mort >= 0 || a.typeCreature) continue;
      const proprio = a.nom === e.proprietaire;
      if (e.type === 'trident' ? !(proprio || a.ramasse) : !(a.ramasse && e.ramassable)) continue;
      if (e.type === 'trident' && e.retour && !proprio) continue;
      const b = a.boite();
      if (e.x < b[0] - 1 || e.x > b[3] + 1 || e.y < b[1] - 0.5 || e.y > b[4] + 0.5 || e.z < b[2] - 1 || e.z > b[5] + 1) continue;
      a.ajouter(e.pile ?? (e.type === 'trident' ? 'trident' : 'arrow'), 1);
      if (e.type === 'trident' && proprio && !a.main.objet) a.main = { objet: a.pileDe(e.pile ?? 'trident') ?? e.pile, efficacite: 0 };
      s.son('entity.item.pickup', e.x, e.y, e.z, 0.2, (s.hasard.flottant() - s.hasard.flottant()) * 0.7 + 1);
      s.dire(`${a.nom} reprend ${e.pile ?? e.type}`);
      this.E._fini.add(e);
      return true;
    }
    return false;
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
    const coupe = (a) => coupeCible(a, c0, d, demi);
    if (!e.quitte && (!prop || !coupe(prop))) e.quitte = true;
    let cible = null;
    for (const a of s.acteurs ? s.acteurs.liste : []) {
      if (a.mort >= 0 || (a === prop && !e.quitte)) continue;
      const r = coupe(a);
      if (r && r.t <= (bloc ? bloc.t : 1) && (!cible || r.t < cible.t)) cible = { ...r, acteur: a };
    }
    if (cible && estBreeze(cible.acteur)) { renvoyerBreeze(s, e, cible.acteur); this.ecrire(e); return true; }
    if (cible || bloc) {
      const t = cible ? cible.t : bloc.t, pos = [c0[0] + d[0] * t, c0[1] + d[1] * t, c0[2] + d[2] * t];
      const evt = s.api.evenement('projectile.touche', { type: e.type, cible: cible?.acteur.nom ?? null, proprietaire: e.proprietaire });
      if (!evt.annule) { this.E._fini.add(e); if (cible) marquerPartie(s, cible.acteur, cible); this.finFeu(e, pos, cible?.acteur ?? null, bloc && !cible ? bloc : null); return false; }   // retiree avant d'exploser : son propre souffle ne la pousse pas
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
  // ------------------------------------------------------------ charges de vent (AbstractWindCharge.tick : AbstractHurtingProjectile sans acceleration)
  // contact (blocs puis acteurs, le lanceur une fois quitte), deplacement en ligne droite ; au-dessus de y = 350 : la rafale (moteur/vent.js)
  tickVent(e) {
    const s = this.sim, lec = this.lec(), demi = TYPES[e.type].boite / 2;
    const c0 = [e.x, e.y - 0.15 + demi, e.z], d = [e.vx, e.vy, e.vz], c1 = [c0[0] + d[0], c0[1] + d[1], c0[2] + d[2]];
    const bloc = coupeBlocs(lec, c0, c1), prop = s.acteurs?.parNom.get(e.proprietaire) ?? null;
    const coupe = (a) => coupeCible(a, c0, d, demi);
    if (!e.quitte && (!prop || !coupe(prop))) e.quitte = true;
    let cible = null;
    for (const a of s.acteurs ? s.acteurs.liste : []) {
      if (a.mort >= 0 || (a === prop && !e.quitte) || a.typeCreature === 'end_crystal') continue;   // AbstractWindCharge.canHitEntity : pas un cristal
      const r = coupe(a);
      if (r && r.t <= (bloc ? bloc.t : 1) && (!cible || r.t < cible.t)) cible = { ...r, acteur: a };
    }
    if (cible || bloc) {
      const t = cible ? cible.t : bloc.t, pos = [c0[0] + d[0] * t, c0[1] + d[1] * t, c0[2] + d[2] * t];
      const evt = s.api.evenement('projectile.touche', { type: e.type, cible: cible?.acteur.nom ?? null, proprietaire: e.proprietaire });
      if (!evt.annule) { this.E._fini.add(e); if (cible) marquerPartie(s, cible.acteur, cible); toucheVent(this, e, pos, cible?.acteur ?? null, bloc && !cible ? bloc : null); return false; }
    }
    // AbstractHurtingProjectile.applyInertia d'une charge de vent : inertie 1 dans l'air ET dans l'eau (getInertia, getLiquidInertia), 4 bulles
    // dans l'eau ; puis le deplacement, l'eau et ses courants, les colonnes de bulles traversees (qui la poussent comme les objets jetes)
    if (e.dansEau) bullesSillage(s, e.x, e.y, e.z, [e.vx, e.vy, e.vz]);
    const de = [e.x, e.y, e.z];
    e.x += e.vx; e.y += e.vy; e.z += e.vz;
    e.dansEau = eauEtCourant(s, e, TYPES[e.type].boite, true, -0.15);
    bullesLeLong(s, e, de, TYPES[e.type].boite, -0.15);
    if (e.y > 350) { this.E._fini.add(e); toucheVent(this, e, [e.x, e.y, e.z], null, null); return false; }
    if (e.age > 1200) { this.E._fini.add(e); return false; }
    this.ecrire(e);
    return true;
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
  coupeActeur(a, p0, d) { return coupeCible(a, p0, d, 0.3); }

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
      // composant hit_block des enchantements du trident (Canalisation sur un paratonnerre pendant l'orage : la foudre)
      if (e.type === 'trident' && e.pile && s.objetsJeu) for (const [id, n] of Object.entries(lirePile(e.pile).ench)) for (const x of s.enchant.def(id)?.effects?.['minecraft:hit_block'] ?? []) {
        const ctx = { ceci: 'trident', position: [hit.cellule[0] + 0.5, hit.cellule[1] + 0.5, hit.cellule[2] + 0.5] };
        if (!x.requirements || s.enchant.condition(x.requirements, n, ctx)) s.enchant.effetEntite(x.effect, n, 'bloc', ctx);
      }
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
    marquerPartie(s, a, cible);
    if (e.type === 'fleche' || e.type === 'trident') {
      const vit = Math.hypot(e.vx, e.vy, e.vz);
      const prop0 = s.acteurs?.parNom.get(e.proprietaire) ?? null, typeDirect = e.type === 'trident' ? 'trident' : e.spectrale ? 'spectral_arrow' : 'arrow';
      // AbstractArrow.onHitEntity : la base (2 ; trident 8) passe par les enchantements de l'arme (Puissance, Empalement : composant damage)
      let base = e.type === 'trident' ? 8 : e.degatsBase;
      const arme = e.type === 'trident' ? e.pile : e.arme;
      if (arme && s.objetsJeu) base = s.enchant.valeurPile(arme, 'damage', { type: typeDirect, direct: false, ceci: a, attaquant: prop0, directAttaquant: typeDirect, outil: arme.replace(/\[.*$/, '') }, base);
      let q = e.type === 'trident' ? base : Math.ceil(Math.min(vit * base, 2147483647));
      if (e.crit && e.type === 'fleche') q = Math.min(q + s.hasard.entierBorne(Math.floor(q / 2) + 2), 2147483647);
      q = e.type === 'trident' ? q * R.valeur('projectiles.degats', 1) : Math.round(q * R.valeur('projectiles.degats', 1));
      if (e.feuFleche > 0) allumerActeur(a, 100);   // une fleche en feu (Flamme) allume la cible 5 s
      a.attaquantCourant = prop0;
      const ok = a.frappe(q, e.type === 'trident' ? 'trident' : 'fleche', dx, dz, 0.4 * recul);
      a.attaquantCourant = null;
      if (ok && s.objetsJeu && arme) {
        // Frappe (knockback de l'arme) : poussee le long du vol x 0,6 (AbstractArrow.doKnockback), effets apres l'attaque de l'arme (Canalisation)
        const kb = e.type === 'fleche' ? s.enchant.valeurPile(arme, 'knockback', { type: typeDirect, ceci: a, directAttaquant: typeDirect }, 0) : 0;
        if (kb > 0) { const h = Math.hypot(e.vx, e.vz) || 1, f = kb * 0.6 * (1 - (a.ia?.pr.antiRecul ?? 0)); a.vx += e.vx / h * f; a.vy += 0.1; a.vz += e.vz / h * f; a.auSol = false; }
        s.enchant.apresAttaque(a, prop0, { type: typeDirect, direct: false, directAttaquant: typeDirect, arme, attaquantSeul: true });
      }
      if (ok && e.effetsFleche) for (const [id, t, n] of e.effetsFleche) a.appliquerEffet(id, t, n);   // fleche a effet (duree x 0,125)
      if (ok && e.spectrale) a.appliquerEffet('glowing', 200, 0);   // SpectralArrow.doPostHurtEffects
      if (ok && e.type === 'trident') {   // ThrownTrident.onHitEntity : la lance rebondit (x -0,01, -0,1, -0,01) et peut revenir (Loyaute)
        e.inflige = true; e.vx *= -0.01; e.vy *= -0.1; e.vz *= -0.01;
        s.son('item.trident.hit', px, py, pz, 1, 1);
        s.dire(`trident touche ${a.nom} : ${q} degats`);
        return false;
      }
      if (ok && e.perce > 0) { (e.perces ??= new Set()).add(a); e.perce--; s.stats.fleches = (s.stats.fleches || 0) + 1; s.dire(`fleche perce ${a.nom} : ${q} degats`); return false; }   // Perforation : elle continue
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
      // ThrownEnderpearl.onHit (Horizon game/creatures.rs, MIT) : le lanceur vivant (et pas endormi : isAllowedToTeleportOwner) va EXACTEMENT a
      // la position de la perle au debut de son dernier tick (oldPosition, sans recherche de place libre) ; un joueur : 5 % d'endermite la ou il
      // etait (monstres permis, difficulte pas paisible), il descend de sa monture, 5 degats `ender_pearl` (regle perle.degats), son
      // entity.player.teleport. Sans lanceur (parti, mort) : la perle se brise seulement. Tout le monde de la scene est charge : en 26.3 la perle
      // d'un joueur connecte garde ses tronÃ§ons charges, elle attend donc dans sa colonne, meme loin de lui.
      if (prop && prop.mort < 0 && !prop.ia?.sommeil) {
        const px = e.x, py = e.y, pz = e.z, joueur = !prop.typeCreature;
        const ancien = [prop.x, prop.y, prop.z];
        for (let i = 0; i < 32; i++) s.replay.particule(s.temps, 'portal', ancien[0], ancien[1] + s.hasard.reel() * 2, ancien[2], s.hasard.gaussien(), 0, s.hasard.gaussien(), 1);
        if (joueur && s.hasard.flottant() < 0.05 && R.valeur('perle.endermite', true) && !/^(paisible|peaceful)$/.test(R.valeur('monde.difficulte', 'normal')) && s.acteurs) {
          const m = s.acteurs.naitre({ type: 'endermite', x: ancien[0], y: ancien[1], z: ancien[2], lacet: prop.lacet, raison: 'perle', nom: 'endermite' });
          if (m) (s.stats.iaJournal ??= []).push(`${(s.temps / 20).toFixed(2)} un endermite sort de la perle de ${prop.nom}`);
        }
        if (prop.monte) descendre(prop);
        prop.x = px; prop.y = py; prop.z = pz; prop.vx = 0; prop.vy = 0; prop.vz = 0; prop.distanceChute = 0;
        if (joueur) { const q = R.valeur('perle.degats', 5); if (q > 0) prop.degats(q, 'perle'); }
        s.son('entity.player.teleport', px, py, pz, 1, 1);
        s.stats.teleports = (s.stats.teleports || 0) + 1;
        s.dire(`${prop.nom} se teleporte en ${px.toFixed(2)},${py.toFixed(2)},${pz.toFixed(2)}`);
        s.api.evenement('perle.teleporte', { acteur: prop.nom, pos: [px, py, pz], de: ancien });
      } else s.dire(`perle brisee sans teleportation (${prop ? (prop.mort >= 0 ? 'lanceur mort' : 'lanceur endormi') : 'pas de lanceur'})`);
    } else if (e.type === 'fiole') {
      // ThrownExperienceBottle.onHit : evenement 2002 (eclaboussure couleur 0x385DC6) et son 1053, puis 3 + nextInt(5) + nextInt(5) d'experience
      // en orbes qui partent de la face touchee (ou a l'oppose de la vitesse sur une entite) : ExperienceOrb.awardWithDirection
      eclaboussure(s, x, y, z, 0x385DC6, false);
      const xp = 3 + s.hasard.entierBorne(5) + s.hasard.entierBorne(5);
      s.entites.orbes(x, y, z, xp, hit?.face ? hit.face.slice() : [-e.vx, -e.vy, -e.vz]);
      s.stats.experience = (s.stats.experience || 0) + xp; s.stats.fioles = (s.stats.fioles || 0) + 1;
      (s.stats.iaJournal ??= []).push(`${(s.temps / 20).toFixed(2)} fiole d experience brisee en ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)} : ${xp} points`);
    } else if (e.type === 'potion' && e.effets) {
      // potion du jeu (ThrownSplashPotion / ThrownLingeringPotion) : toutes ses effets ; persistante : un nuage (AreaEffectCloud)
      const inst = e.effets.some(([id]) => id === 'instant_damage' || id === 'instant_health');
      eclaboussure(s, x, y, z, couleurPotion(e.effets), inst);
      if (e.persistante) { s.nuages?.creer([x, y, z], e.effets, prop); return; }
      for (const a of s.acteurs ? s.acteurs.liste : []) {
        if (a.mort >= 0) continue;
        const b = a.boite();
        if (!(b[3] > x - 4.25 && b[0] < x + 4.25 && b[4] > y - 2.25 && b[1] < y + 2.25 && b[5] > z - 4.25 && b[2] < z + 4.25)) continue;
        const d2 = (a.x - x) ** 2 + (a.y + 0.9 - y) ** 2 + (a.z - z) ** 2;
        if (d2 >= 16) continue;
        const force = a === acteur ? 1 : 1 - Math.sqrt(d2) / 4;
        for (const [id, t, n] of e.effets) {
          if (id === 'instant_damage' || id === 'instant_health') a.appliquerEffet(id, 1, n, { force });
          else { const dt = Math.floor(force * t + 0.5); if (dt > 20) a.appliquerEffet(id, dt, n); }   // ThrownSplashPotion.applySplash : plus d'une seconde
        }
      }
    } else if (e.type === 'potion') {
      const effet = e.effet || { id: 'speed', ticks: 1800, niveau: 0 };
      eclaboussure(s, x, y, z, COULEURS_RGB[effet.id] ?? 0x385DC6, effet.id === 'instant_damage' || effet.id === 'instant_health');
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
    else if (e.type === 'fusee') rp.entite(s.temps, e.id, e.attache ? 'fusee_attachee' : 'fusee', e.x, e.y, e.z, e.oblique ? 1 : 0, rp.nom('firework_rocket'));   // FireworkEntityRenderer (shouldRender : pas accrochee a un vivant)
    else if (e.type === 'vent' || e.type === 'vent_breeze') rp.entite(s.temps, e.id, 'vent', e.x, e.y, e.z, e.age, 0);   // WindChargeRenderer (age : rotation, defilement)
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

// LevelEventHandler 2002 / 2007 (potionSplashParticles) et son 1053 / 1054 : 8 miettes de la potion jetee et 100 particules d'effet de la
// couleur, au centre bas de la cellule ; le film les tire (film/effets-monde.js `eclat_potion`) ; son splash_potion.break, volume 1, hauteur
// 0,9..1 (hasard du client : un hasard a part, pour ne pas changer celui du monde)
export function eclaboussure(s, x, y, z, rgb, instant) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  s.replay.particule(s.temps, `eclat_potion|${(rgb >> 16) & 255},${(rgb >> 8) & 255},${rgb & 255}|${instant ? 1 : 0}`, bx + 0.5, by, bz + 0.5, 0, 0, 0, 1);
  const h = ((bx * 73856093) ^ (by * 19349663) ^ (bz * 83492791) ^ (s.temps * 2654435761)) >>> 0;
  s.son('entity.splash_potion.break', bx + 0.5, by + 0.5, bz + 0.5, 1, (h % 1000) / 1000 * 0.1 + 0.9);
}
// MobEffect.getColor (Horizon horizon-client-core/src/potions.rs EFFECTS, MIT) : couleur d'une potion a un seul effet
export const COULEURS_RGB = { speed: 3402751, slowness: 9154528, haste: 14270531, mining_fatigue: 4866583, strength: 16762624, instant_health: 16262179, instant_damage: 11101546, jump_boost: 16646020, nausea: 5578058, regeneration: 13458603, resistance: 9520880, fire_resistance: 16750848, water_breathing: 10017472, invisibility: 16185078, blindness: 2039587, night_vision: 12779366, hunger: 5797459, weakness: 4738376, poison: 8889187, wither: 7561558, health_boost: 16284963, absorption: 2445989, glowing: 9740385, levitation: 13565951, slow_falling: 15978425, dolphins_grace: 8954814, darkness: 2696993 };
// couleur (teinte 0..1) des particules d'un effet de potion : sert a `effet` du rendu
export const COULEURS_EFFETS = { speed: 0.55, slowness: 0.62, jump_boost: 0.35, invisibility: 0.8, glowing: 0.15, regeneration: 0.95, poison: 0.28, strength: 0.0, night_vision: 0.7, weakness: 0.66, instant_damage: 0.98, instant_health: 0.02, fire_resistance: 0.08, water_breathing: 0.6, absorption: 0.12 };
