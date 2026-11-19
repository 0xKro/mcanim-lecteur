// Vehicules simules : wagonnets (AbstractMinecart + OldMinecartBehavior, le comportement par defaut du jeu 26.3 ; MinecartChest, MinecartHopper,
// MinecartFurnace, MinecartTNT) et bateaux (AbstractBoat). Un vehicule est un acteur de la scene de type `minecart`, `chest_minecart`...,
// `boat`, `chest_boat` : il a la physique de son type a la place de celle des vivants. Port de Horizon horizon-client/src/game/{minecarts,
// boats,machines}.rs et motion/fluids.rs (MIT, voir ATTRIBUTIONS.md).
//   Wagonnet, chaque tick : gravite 0,04 (0,005 dans l'eau) ; sur un rail (bloc ou bloc dessous) : moveAlongTrack (glissade de 0,0078125 dans
//   une pente, vitesse portee par la forme du rail, vitesse au plus 2, poussee du passager 0,001 sous 0,1 bloc/tick, rail de propulsion eteint :
//   x 0,5 ou arret sous 0,03, allume : + 0,06 dans le sens de la marche ou depart a 0,02 a l'oppose d'un bloc conducteur ; deplacement borne a
//   0,4 (0,2 dans l'eau ; le four : x 0,5 ou x 0,75), x 0,75 avec un passager ; frein 0,96 (0,997 avec passager ; coffre et entonnoir :
//   0,98 + 0,001 x (15 - signal du contenu), x 0,95 dans l'eau) ; hauteur du rail recalculee et la difference d'altitude x 0,05 rendue en
//   vitesse) ; hors rail : vitesse bornee, x 0,5 au sol, frein de l'air 0,95F. Puis lacet (atan2 de la marche, retourne au-dela de 170 degres),
//   colonnes de bulles, toiles, blocs touches (detecteurs, plaques, fil piege), poussee des autres wagonnets et des creatures (une creature
//   qui n'est pas un golem de fer monte dans un wagonnet vide qui roule), courant de l'eau.
//   Variantes : wagonnet de coffre 27 cases, d'entonnoir 5 (aspire les objets et le conteneur au-dessus, coupe par un rail declencheur
//   alimente), four (combustible : charbon 3600 ticks, pousse dans le sens donne, fumee 1 sur 4), TNT (rail declencheur alimente : meche 80,
//   explosion 4 + vitesse x 1,5 x hasard ; choc a plus de 0,1 bloc/tick : explose ; chute de 3 blocs ou plus : explose ; feu ou explosion :
//   amorce une meche de 0 a 38). Coups : usure + degats x 10, casse au-dela de 40 (objet du wagonnet + contenu lache).
//   Bateau : flottaison (statut dans l'eau / sous l'eau / courant / au sol / en l'air, poussee d'Archimede (niveau - y) / 0,5625 x 0,04 / 0,65,
//   x 0,75), frottement 0,9 (0,45 sous l'eau, glissance du sol a terre), pagaie du conducteur (0,04 vers l'avant, virage de 1 degre par tick),
//   colonne de bulles : 60 ticks au-dessus puis projete a 0,6 (montante) ou tire de -0,7 (descendante, les passagers descendent).
import { deplacerBoite } from './collision.js';
import { sinMth, cosMth } from './mth.js';
import { niveauListe, pileMax } from './contenus.js';
import { evenement } from './registre.js';

export const WAGONNETS = { minecart: 0, chest_minecart: 27, hopper_minecart: 5, furnace_minecart: 0, tnt_minecart: 0, spawner_minecart: 0, command_block_minecart: 0 };
export const estWagonnet = (t) => t !== undefined && t !== null && Object.prototype.hasOwnProperty.call(WAGONNETS, t);
export const estBateau = (t) => t === 'boat' || t === 'chest_boat';
export const estVehiculeSimule = (t) => estWagonnet(t) || estBateau(t);
const L_W = Math.fround(0.98), H_W = Math.fround(0.7);          // EntityType.MINECART.sized(0.98F, 0.7F)
const L_B = 1.375, H_B = 0.5625;                                  // EntityType.OAK_BOAT : 1,375 x 0,5625
const F01 = Math.fround(0.1), F02 = Math.fround(0.2), F095 = Math.fround(0.95);
// decalage du cavalier sous le siege (Entity.getVehicleAttachmentPoint) : joueur 0,6 (Avatar.DEFAULT_VEHICLE_ATTACHMENT), morts-vivants...
const DECALAGE = { zombie: 0.7, husk: 0.7, drowned: 0.7, zombie_villager: 0.7, zombified_piglin: 0.7, piglin: 0.7, piglin_brute: 0.7, skeleton: 0.7, stray: 0.7, bogged: 0.7, parched: 0.7, wither_skeleton: 0.875, pillager: 0.6, vindicator: 0.6, evoker: 0.6, illusioner: 0.6 };
export const decalageCavalier = (a) => (a.typeCreature ? DECALAGE[a.typeCreature] ?? 0 : 0.6);
const EXITS = {
  north_south: [[0, 0, -1], [0, 0, 1]], east_west: [[-1, 0, 0], [1, 0, 0]],
  ascending_east: [[-1, -1, 0], [1, 0, 0]], ascending_west: [[-1, 0, 0], [1, -1, 0]], ascending_north: [[0, 0, -1], [0, -1, 1]], ascending_south: [[0, -1, -1], [0, 0, 1]],
  south_east: [[0, 0, 1], [1, 0, 0]], south_west: [[0, 0, 1], [-1, 0, 0]], north_west: [[0, 0, -1], [-1, 0, 0]], north_east: [[0, 0, -1], [1, 0, 0]],
};
const RAILS = new Set(['rail', 'powered_rail', 'detector_rail', 'activator_rail']);
const pente = (s) => s.startsWith('ascending');
const atan2Deg = (y, x) => Math.fround(Math.atan2(y, x) * 180 / Math.PI);
const tri = (h, a, b) => a + b * (h.reel() - h.reel());

// Etat d'un vehicule (attache a son acteur : a.veh)
export function creerVehicule(a, sim, desc = {}) {
  const t = a.typeCreature;
  const v = { type: t, wagon: estWagonnet(t), bateau: estBateau(t), yaw: 0, yawPrec: 0, pitch: 0, flipped: false, hurtTime: 0, hurtDir: 1, damage: 0, fuel: 0, push: [0, 0, 0], fuse: -1, enabled: true,
    inWater: false, onGround: false, chute: 0, chuteExplose: null, colle: null, ticks: 0, horizontalCollision: false,
    cases: estWagonnet(t) && WAGONNETS[t] ? new Array(WAGONNETS[t]).fill(null) : t === 'chest_boat' ? new Array(27).fill(null) : null, attente: 0,
    statut: 'air', statutAvant: 'air', statutConnu: false, niveauEau: 0, glisseSol: 0, rotation: 0, bulleTemps: 0, auDessusBulle: false, bulleBas: false, bulleMult: 0, bulleAngle: 0, bulleAnglePrec: 0, dernierYd: 0, sousEau: 0 };
  // boite du type (EntityType.sized) ; les yeux du gabarit (entity-types.json) quand il y en a un, sinon 0,85 x la hauteur (EntityDimensions)
  const sansGabarit = a.O === 1.62 && a.H === 1.8;
  if (v.wagon) { v.yaw = Math.fround(((a.lacet ?? 0) + 90) % 360); a.L = L_W; a.H = H_W; }
  if (v.bateau) { v.yaw = a.lacet ?? 0; a.L = L_B; a.H = H_B; }
  if (sansGabarit) a.O = Math.fround(a.H * 0.85);
  v.yawPrec = v.yaw;
  for (const [item, n] of desc.contenu ?? []) { let r = n; const max = pileMax(item); for (let i = 0; i < (v.cases?.length ?? 0) && r > 0; i++) if (!v.cases[i]) { const k = Math.min(r, max); v.cases[i] = { item, n: k }; r -= k; } }
  if (desc.fuel) { v.fuel = desc.fuel; v.push = [desc.pousse?.[0] ?? 0, 0, desc.pousse?.[1] ?? 0]; }
  return v;
}

// ---------------------------------------------------------------- rails
function rail(sim, x, y, z) {
  const e = sim.monde.etatEn(x, y, z);
  if (e < 0) return null;
  const nom = sim.d.nomBloc(e);
  if (!RAILS.has(nom)) return null;
  return { nom, shape: sim.d.prop(e, 'shape'), powered: sim.d.prop(e, 'powered') === 'true' };
}
// getCurrentBlockPosOrRailBelow
function blocRail(sim, x, y, z) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  return rail(sim, bx, by - 1, bz) ? [bx, by - 1, bz] : [bx, by, bz];
}
// OldMinecartBehavior.getPos
function posRail(sim, x, y, z) {
  const [xt, yt, zt] = blocRail(sim, x, y, z), r = rail(sim, xt, yt, zt);
  if (!r) return null;
  const [e0, e1] = EXITS[r.shape];
  const x0 = xt + 0.5 + e0[0] * 0.5, y0 = yt + 0.0625 + e0[1] * 0.5, z0 = zt + 0.5 + e0[2] * 0.5;
  const x1 = xt + 0.5 + e1[0] * 0.5, y1 = yt + 0.0625 + e1[1] * 0.5, z1 = zt + 0.5 + e1[2] * 0.5;
  const xd = x1 - x0, yd = (y1 - y0) * 2, zd = z1 - z0;
  const p = xd === 0 ? z - zt : zd === 0 ? x - xt : ((x - x0) * xd + (z - z0) * zd) * 2;
  const out = [x0 + xd * p, y0 + yd * p, z0 + zd * p];
  if (yd < 0) out[1] += 1; else if (yd > 0) out[1] += 0.5;
  return out;
}
// OldMinecartBehavior.getPosOffs
export function posRailDecale(sim, x, y, z, offs) {
  const [xt, yt, zt] = blocRail(sim, x, y, z), r = rail(sim, xt, yt, zt);
  if (!r) return null;
  y = yt + (pente(r.shape) ? 1 : 0);
  const [e0, e1] = EXITS[r.shape];
  let xd = e1[0] - e0[0], zd = e1[2] - e0[2];
  const dd = Math.hypot(xd, zd); xd /= dd; zd /= dd;
  x += xd * offs; z += zd * offs;
  const at = (e) => Math.floor(x) - xt === e[0] && Math.floor(z) - zt === e[2];
  if (e0[1] !== 0 && at(e0)) y += e0[1]; else if (e1[1] !== 0 && at(e1)) y += e1[1];
  return posRail(sim, x, y, z);
}
// AbstractMinecartRenderer (ancien rendu) : position et angles du wagonnet sur ses rails au point (x, y, z)
export function poseSurRail(sim, x, y, z) {
  const on = posRail(sim, x, y, z);
  if (!on) return null;
  const h = Math.fround(0.3), av = posRailDecale(sim, x, y, z, h) ?? on, ar = posRailDecale(sim, x, y, z, -h) ?? on;
  let d = [ar[0] - av[0], ar[1] - av[1], ar[2] - av[2]];
  const L = Math.hypot(...d);
  const r = { x: on[0], y: (av[1] + ar[1]) / 2, z: on[2], yaw: null, pitch: 0 };
  if (L !== 0) { d = d.map((c) => c / L); r.yaw = Math.fround(Math.atan2(d[2], d[0]) * 180 / Math.PI); r.pitch = Math.fround(Math.atan(d[1]) * 73); }
  return r;
}

// ---------------------------------------------------------------- un tick d'un vehicule (phase des entites, a la place de LivingEntity.travel)
export function tickVehicule(a) {
  const v = a.veh;
  if (v.wagon) tickWagon(a, v); else tickBateau(a, v);
}

const cavaliers = (a) => a.passagers ?? [];
const occupe = (a) => cavaliers(a).length > 0;

// ------------------------------------------------------------ wagonnet
function vitesseMax(v) { const b = v.inWater ? 0.2 : 0.4; return v.type === 'furnace_minecart' ? b * (v.inWater ? 0.75 : 0.5) : b; }
function signalContenu(v) { return v.cases ? niveauListe(v.cases) : 0; }
function freinNaturel(a, v, monte) {
  let vx = a.vx, vz = a.vz;
  if (v.type === 'furnace_minecart') {
    const p = v.push;
    if (p[0] * p[0] + p[1] * p[1] + p[2] * p[2] > 1e-7) {
      // calculateNewPushAlong : la poussee est projetee sur la marche (gardant sa longueur)
      if (p[0] * p[0] + p[2] * p[2] > 1e-4 && vx * vx + vz * vz > 0.001) {
        const L = Math.hypot(...p), m = [vx, 0, vz], mm = vx * vx + vz * vz, k = (p[0] * vx + p[2] * vz) / mm;
        let q = [m[0] * k, 0, m[2] * k]; const lq = Math.hypot(...q); if (lq > 0) q = q.map((c) => c / lq * L); v.push = q;
      }
      vx = vx * 0.8 + v.push[0]; vz = vz * 0.8 + v.push[2];
      if (v.inWater) { vx *= 0.1; vz *= 0.1; }
    } else { vx *= 0.98; vz *= 0.98; }
  }
  if (v.cases && v.wagon) {   // AbstractMinecartContainer.applyNaturalSlowdown : remplace le frein de base
    let keep = Math.fround(Math.fround(0.98) + Math.fround((15 - signalContenu(v)) * Math.fround(0.001)));
    if (v.inWater) keep = Math.fround(keep * F095);
    a.vx = vx * keep; a.vy = 0; a.vz = vz * keep;
    return;
  }
  const f = monte ? 0.997 : 0.96;
  a.vx = vx * f; a.vy = 0; a.vz = vz * f;
  if (v.inWater) { a.vx *= F095; a.vz *= F095; }
}
// Entity.move d'un wagonnet ou d'un bateau : collisions (blocs et entites), velocite coupee sur les axes bloques, chute
function deplacer(a, v, d, entites = true) {
  const sim = a.sim;
  if (v.colle) { d = [d[0] * v.colle[0], d[1] * v.colle[1], d[2] * v.colle[2]]; v.colle = null; a.vx = 0; a.vy = 0; a.vz = 0; }
  const extra = entites && (d[0] || d[1] || d[2]) ? boitesEntites(a) : null;
  const r = deplacerBoite(a.lec, a.boite(), d, v.onGround, 0, extra);
  a.x += r.dx; a.y += r.dy; a.z += r.dz;
  v.onGround = d[1] < 0 && r.dy > d[1];
  v.horizontalCollision = Math.abs(r.dx - d[0]) > 1e-7 || Math.abs(r.dz - d[2]) > 1e-7;
  if (Math.abs(r.dx - d[0]) > 1e-7) a.vx = 0;
  if (Math.abs(r.dz - d[2]) > 1e-7) a.vz = 0;
  if (Math.abs(r.dy - d[1]) > 1e-7) a.vy = 0;
  if (v.wagon) {
    if (r.dy < 0 && !v.inWater) v.chute -= Math.fround(r.dy);
    if (v.onGround) { if (v.type === 'tnt_minecart' && v.chute >= 3) { const p = v.chute / 10; v.chuteExplose = p * p; } v.chute = 0; }
  }
  a.auSol = v.onGround;
  void sim;
  return r;
}
// AbstractMinecart/AbstractBoat.canCollideWith : les autres vehicules et les corps poussables (pas ses passagers)
function boitesEntites(a) {
  const out = [], b = a.boite(), near = [b[0] - 2, b[1] - 2, b[2] - 2, b[3] + 2, b[4] + 2, b[5] + 2];
  for (const o of a.g.liste) {
    if (o === a || o.mort >= 0 || o.monte === a || a.monte === o) continue;
    if (!o.veh && (o.typeCreature === 'bat' || o.typeCreature === 'end_crystal' || o.typeCreature === 'armor_stand')) continue;
    if (!o.veh && o.monte) continue;
    const k = o.boite();
    if (k[3] > near[0] && k[0] < near[3] && k[4] > near[1] && k[1] < near[4] && k[5] > near[2] && k[2] < near[5]) out.push(k);
  }
  return out;
}

function tickWagon(a, v) {
  const sim = a.sim;
  v.ticks++;
  a.xAvant = a.x; a.yAvant = a.y; a.zAvant = a.z; v.yawPrec = v.yaw;
  v.hurtTime = Math.max(0, v.hurtTime - 1); v.damage = Math.max(0, v.damage - 1);
  a.vy -= v.inWater ? 0.005 : 0.04;
  const pos = blocRail(sim, a.x, a.y, a.z), r = rail(sim, ...pos);
  if (r) {
    surRails(a, v, pos, r);
    if (r.nom === 'activator_rail') activer(a, v, r.powered);
  } else horsRails(a, v);
  // OldMinecartBehavior.tick : lacet d'apres la marche, retourne s'il change de plus de 170 degres
  v.pitch = 0;
  const xd = a.xAvant - a.x, zd = a.zAvant - a.z;
  if (xd * xd + zd * zd > 0.001) { v.yaw = atan2Deg(zd, xd); if (v.flipped) v.yaw += 180; }
  let diff = (((v.yaw - v.yawPrec + 180) % 360) + 360) % 360 - 180;
  if (!(diff >= -170 && diff < 170)) { v.yaw += 180; v.flipped = !v.flipped; }
  v.yaw = Math.fround(v.yaw % 360);
  effetsBlocs(a, v);
  sim.toucherBlocsEntite?.(a.boite(), { type: 'wagonnet', nom: a.nom, id: a.id });
  pousserDepuis(a, v);
  courant(a, v);
  if (v.inWater) v.chute = 0;
  if (v.type === 'furnace_minecart') {
    if (v.fuel > 0) v.fuel--;
    if (v.fuel <= 0) v.push = [0, 0, 0];
    if (v.fuel > 0 && sim.hasard.entierBorne(4) === 0) sim.particule('large_smoke', a.x, a.y + 0.8, a.z, 0, 0, 0, 1);
  } else if (v.type === 'tnt_minecart') {
    if (v.chuteExplose !== null) { const s = v.chuteExplose; v.chuteExplose = null; exploserWagon(a, v, s); return; }
    if (v.fuse > 0) { v.fuse--; sim.particule('smoke', a.x, a.y + 0.5, a.z, 0, 0, 0, 1); }
    else if (v.fuse === 0) { exploserWagon(a, v, a.vx * a.vx + a.vz * a.vz); return; }
    const s = a.vx * a.vx + a.vz * a.vz;
    if (v.horizontalCollision && s >= 0.009999999776482582) { exploserWagon(a, v, s); return; }
  } else if (v.type === 'hopper_minecart' && v.enabled) aspirer(a, v);
  // lave : deux fois 4 de degats par tick (LavaFluid.entityInside puis AbstractMinecart.tick)
  for (let i = 0; i < 2 && a.mort < 0; i++) if (dansLave(a)) { blesserVehicule(a, 4, 'lave'); sim.son('entity.generic.burn', a.x, a.y, a.z, 0.4, 2 + sim.hasard.flottant() * 0.4); }
}

// OldMinecartBehavior.moveAlongTrack
function surRails(a, v, pos, r) {
  const sim = a.sim;
  v.chute = 0;
  const monte = occupe(a);
  const vieux = posRail(sim, a.x, a.y, a.z);
  let y = pos[1], allume = false, frein = false;
  if (r.nom === 'powered_rail') { allume = r.powered; frein = !allume; }
  const glisse = v.inWater ? 0.0078125 * 0.2 : 0.0078125;
  if (r.shape === 'ascending_east') a.vx -= glisse; else if (r.shape === 'ascending_west') a.vx += glisse; else if (r.shape === 'ascending_north') a.vz += glisse; else if (r.shape === 'ascending_south') a.vz -= glisse;
  if (pente(r.shape)) y += 1;
  const [e0, e1] = EXITS[r.shape];
  let xd = e1[0] - e0[0], zd = e1[2] - e0[2];
  const L = Math.hypot(xd, zd);
  if (a.vx * xd + a.vz * zd < 0) { xd = -xd; zd = -zd; }
  const pow = Math.min(Math.hypot(a.vx, a.vz), 2);
  a.vx = pow * xd / L; a.vz = pow * zd / L;
  const intent = monte ? intentionPassager(a) : null;
  if (intent && (intent[0] || intent[1]) && a.vx * a.vx + a.vz * a.vz < 0.01) { a.vx += intent[0] * 0.001; a.vz += intent[1] * 0.001; frein = false; }
  if (frein) { if (Math.hypot(a.vx, a.vz) < 0.03) { a.vx = 0; a.vy = 0; a.vz = 0; } else { a.vx *= 0.5; a.vy = 0; a.vz *= 0.5; } }
  const x0 = pos[0] + 0.5 + e0[0] * 0.5, z0 = pos[2] + 0.5 + e0[2] * 0.5, x1 = pos[0] + 0.5 + e1[0] * 0.5, z1 = pos[2] + 0.5 + e1[2] * 0.5;
  const dx = x1 - x0, dz = z1 - z0;
  const p = dx === 0 ? a.z - pos[2] : dz === 0 ? a.x - pos[0] : ((a.x - x0) * dx + (a.z - z0) * dz) * 2;
  a.x = x0 + dx * p; a.y = y; a.z = z0 + dz * p;
  const k = monte ? 0.75 : 1, max = vitesseMax(v);
  deplacer(a, v, [Math.max(-max, Math.min(max, k * a.vx)), 0, Math.max(-max, Math.min(max, k * a.vz))]);
  sim.toucherBlocsEntite?.(a.boite(), { type: 'wagonnet', nom: a.nom, id: a.id });   // AbstractMinecart.move : applyEffectsFromBlocks au sommet du rail
  const at = (e) => Math.floor(a.x) - pos[0] === e[0] && Math.floor(a.z) - pos[2] === e[2];
  if (e0[1] !== 0 && at(e0)) a.y += e0[1]; else if (e1[1] !== 0 && at(e1)) a.y += e1[1];
  freinNaturel(a, v, monte);
  const neuf = posRail(sim, a.x, a.y, a.z);
  if (neuf && vieux) {
    const s = (vieux[1] - neuf[1]) * 0.05, h = Math.hypot(a.vx, a.vz);
    if (h > 0) { a.vx *= (h + s) / h; a.vz *= (h + s) / h; }
    a.y = neuf[1];
  }
  const xn = Math.floor(a.x), zn = Math.floor(a.z);
  if (xn !== pos[0] || zn !== pos[2]) { const h = Math.hypot(a.vx, a.vz); a.vx = h * (xn - pos[0]); a.vz = h * (zn - pos[2]); }
  if (allume) {
    const h = Math.hypot(a.vx, a.vz);
    if (h > 0.01) { a.vx += a.vx / h * 0.06; a.vz += a.vz / h * 0.06; }
    else if (r.shape === 'east_west') { if (sim.redstone.conducteur(pos[0] - 1, pos[1], pos[2])) a.vx = 0.02; else if (sim.redstone.conducteur(pos[0] + 1, pos[1], pos[2])) a.vx = -0.02; }
    else if (r.shape === 'north_south') { if (sim.redstone.conducteur(pos[0], pos[1], pos[2] - 1)) a.vz = 0.02; else if (sim.redstone.conducteur(pos[0], pos[1], pos[2] + 1)) a.vz = -0.02; }
  }
}
// comeOffTrack
function horsRails(a, v) {
  const max = vitesseMax(v);
  a.vx = Math.max(-max, Math.min(max, a.vx)); a.vz = Math.max(-max, Math.min(max, a.vz));
  if (v.onGround) { a.vx *= 0.5; a.vy *= 0.5; a.vz *= 0.5; }
  deplacer(a, v, [a.vx, a.vy, a.vz]);
  const f = facteurVitesseBloc(a);
  a.vx *= f; a.vz *= f;
  if (!v.onGround) { a.vx *= F095; a.vy *= F095; a.vz *= F095; }
}
// Entity.getBlockSpeedFactor (facteurs du jeu : sable des ames et miel 0,4F) : la cellule ; dans l'eau ou une colonne de bulles, elle seule ;
// sinon, si elle vaut 1, le bloc 0,500001F sous le vehicule (pas un vivant : pas de movement_efficiency)
function facteurVitesseBloc(a) {
  const sim = a.sim, d = sim.d, x = Math.floor(a.x), z = Math.floor(a.z);
  const ici = sim.monde.etatEn(x, Math.floor(a.y), z), k = d.facteurVitesse(ici);
  if (ici >= 0 && /^(water|bubble_column)$/.test(d.nomBloc(ici))) return k;
  return k !== 1 ? k : d.facteurVitesse(sim.monde.etatEn(x, Math.floor(a.y - Math.fround(0.500001)), z));
}
// activateMinecart (rail declencheur)
function activer(a, v, alim) {
  const sim = a.sim;
  if (v.type === 'minecart' && alim) {
    for (const c of [...cavaliers(a)]) descendre(c, { y: Math.max(c.y, a.y) });
    if (v.hurtTime === 0) { v.hurtDir = -v.hurtDir; v.hurtTime = 10; v.damage = 50; }
  } else if (v.type === 'tnt_minecart' && alim && v.fuse < 0) amorcer(a, v);
  else if (v.type === 'hopper_minecart') v.enabled = !alim;
  void sim;
}
function amorcer(a, v) {
  if (!a.sim.regles.valeur('tnt.casseBlocs', true) && false) return;
  v.fuse = 80;
  a.sim.son('entity.tnt.primed', a.x, a.y, a.z, 1, 1);
  a.sim.dire(`${a.nom} (wagonnet de TNT) amorce : meche 80`);
}
// MinecartTNT.explode : puissance 4 + 1 x hasard x 1,5 x min(vitesse, 5)
function exploserWagon(a, v, vitesse2) {
  const sim = a.sim, s = Math.min(Math.sqrt(vitesse2), 5), r = sim.hasard.reel();
  const P = Math.fround(4 + 1 * r * 1.5 * s);
  for (const c of [...cavaliers(a)]) descendre(c, { y: Math.max(c.y, a.y) });
  disparaitre(a);
  sim.dire(`${a.nom} (wagonnet de TNT) explose : puissance ${P.toFixed(2)}`);
  sim.exploser(a.x, a.y, a.z, { puissance: P, source: 'tnt', casseBlocs: sim.regles.valeur('tnt.casseBlocs', true), protegeRails: v.fuse >= 0 });
}
function disparaitre(a) { a.vie = 0; a.mort = 0; a.mortSansCorps = true; a.sim.stats.morts = (a.sim.stats.morts || 0) + 1; }
// VehicleEntity.hurtServer
export function blesserVehicule(a, q, source) {
  const sim = a.sim, v = a.veh;
  if (a.mort >= 0) return false;
  v.hurtDir = -v.hurtDir; v.hurtTime = 10; v.damage += q * 10; a.usureVehicule = v.damage;
  const feu = /^(feu|lave|explosion|foudre|tnt)/.test(source);
  const detruit = v.damage > 40 || (feu && v.type === 'tnt_minecart');
  if (!detruit) return true;
  const vit = a.vx * a.vx + a.vz * a.vz;
  if (v.type === 'tnt_minecart' && (feu || vit >= Math.fround(0.01))) {   // MinecartTNT.destroy : amorcer au lieu de casser
    if (v.fuse < 0) { amorcer(a, v); v.fuse = sim.hasard.entierBorne(20) + sim.hasard.entierBorne(20); }
    return true;
  }
  for (const c of [...cavaliers(a)]) descendre(c, { y: Math.max(c.y, a.y) });
  // Containers.dropContents des cases, puis l'objet du vehicule (VehicleEntity.destroy)
  if (v.cases) lacherCases(sim, a.x, a.y, a.z, v.cases);
  disparaitre(a);
  if (sim.regles.valeur('butin.actif', true)) {
    const bois = a.ia?.variante ?? a.variante ?? 'oak';
    const objet = v.bateau ? `${String(bois).split(/\s+/)[0]}_${v.type}` : v.type === 'spawner_minecart' || v.type === 'command_block_minecart' ? 'minecart' : v.type;
    sim.entites.objet(objet, 1, a.x, a.y, a.z, { delai: 10 });
  }
  sim.dire(`${a.nom} (vehicule) casse (${source})`);
  return true;
}
function lacherCases(sim, x, y, z, cases) {
  const h = sim.hasard;
  for (const e of cases) {
    const px = Math.floor(x) + h.reel() * 0.75 + 0.125, py = Math.floor(y) + h.reel() * 0.75, pz = Math.floor(z) + h.reel() * 0.75 + 0.125;
    let reste = e ? e.n : 0;
    while (reste > 0) { const k = Math.min(reste, h.entierBorne(21) + 10); reste -= k; sim.entites.objet(e.item, k, px, py, pz, { vx: tri(h, 0, 0.11485000171139836), vy: tri(h, 0.2, 0.11485000171139836), vz: tri(h, 0, 0.11485000171139836), delai: 10 }); }
  }
}
// applyEffectsFromBlocks d'un vehicule : colonne de bulles et toile
function effetsBlocs(a, v) {
  const sim = a.sim, b = a.boite(), e = 1e-5;
  for (let y = Math.floor(b[1] + e); y <= Math.floor(b[4] - e); y++) for (let z = Math.floor(b[2] + e); z <= Math.floor(b[5] - e); z++) for (let x = Math.floor(b[0] + e); x <= Math.floor(b[3] - e); x++) {
    const k = sim.monde.etatEn(x, y, z);
    if (k < 0) continue;
    const n = sim.d.nomBloc(k);
    if (n === 'cobweb') { v.chute = 0; v.colle = [0.25, Math.fround(0.05), 0.25]; }
  }
  const col = colonnesBulles(sim, b);
  for (const c of col) if (pousseeBulle(c, a)) v.chute = 0;
}
// courant de l'eau (updateFluidInteraction) : poussee 0,014 dans le sens du courant
function courant(a, v) {
  const sim = a.sim, b = a.boite(), e = 0.001;
  let n = 0, acc = [0, 0, 0], dans = false;
  for (let y = Math.floor(b[1] + e); y <= Math.floor(b[4] - e); y++) for (let z = Math.floor(b[2] + e); z <= Math.floor(b[5] - e); z++) for (let x = Math.floor(b[0] + e); x <= Math.floor(b[3] - e); x++) {
    const f = sim.fluide(x, y, z);
    if (f.type !== 'water') continue;
    const h = y + (sim.fluide(x, y + 1, z).type === 'water' ? 1 : f.quantite / 9);
    if (h < b[1]) continue;
    dans = true;
    let c = sim.courant(x, y, z); const d = h - b[1];
    if (d < 0.4) c = c.map((q) => q * d);
    acc = acc.map((q, i) => q + c[i]); n++;
  }
  v.inWater = dans;
  if (n) { let w = acc.map((q) => q / n); const L = Math.hypot(...w); if (L > 0) { w = w.map((q) => q * 0.014); if (Math.abs(a.vx) < 0.003 && Math.abs(a.vz) < 0.003 && Math.hypot(...w) < 0.0045) { const l2 = Math.hypot(...w) || 1; w = w.map((q) => q / l2 * 0.0045); } a.vx += w[0]; a.vy += w[1]; a.vz += w[2]; } }
}
function dansLave(a) {
  const sim = a.sim, b = a.boite();
  for (let y = Math.floor(b[1]); y <= Math.floor(b[4] - 1e-3); y++) for (let z = Math.floor(b[2]); z <= Math.floor(b[5]); z++) for (let x = Math.floor(b[0]); x <= Math.floor(b[3]); x++) if (sim.fluide(x, y, z).type === 'lava') return true;
  return false;
}
// MinecartHopper : aspire le conteneur au-dessus puis les objets au sol (HopperBlockEntity.suckInItems, boite du wagonnet + 0,25 en largeur)
function aspirer(a, v) {
  const sim = a.sim;
  if (v.attente > 0) { v.attente--; }
  const x = Math.floor(a.x), y = Math.floor(a.y + 0.5) + 1, z = Math.floor(a.z);
  let pris = false;
  const ajoute = (item, n) => { let r = n; const max = pileMax(item); for (const e of v.cases) if (e && e.item === item && e.n < max && r > 0) { const k = Math.min(r, max - e.n); e.n += k; r -= k; } for (let i = 0; i < v.cases.length && r > 0; i++) if (!v.cases[i]) { const k = Math.min(r, max); v.cases[i] = { item, n: k }; r -= k; } return r; };
  if (sim.contenus.taille(x, y, z)) {
    const l = sim.api.contenuListe(x, y, z);
    for (let i = 0; i < l.length; i++) if (l[i] && ajoute(l[i].item, 1) === 0) { sim.contenus.retirer(x, y, z, i, 1); sim.api.contenuNotifie(x, y, z); pris = true; break; }
  } else {
    const b = a.boite();
    pris = sim.entites.prendre([b[0] - 0.25, b[1], b[2] - 0.25, b[3] + 0.25, b[4] + 0.25 + 0.5, b[5] + 0.25], (e) => ajoute(e.item, e.n));
  }
  void pris;
}

// pushAndPickupEntities : les autres wagonnets (le long de son axe), les creatures (montent dans un wagonnet vide qui roule)
function pousserDepuis(a, v) {
  const b = a.boite(), r = F02, hb = [b[0] - r, b[1], b[2] - r, b[3] + r, b[4], b[5] + r];
  const coupe = (k) => k[3] > hb[0] && k[0] < hb[3] && k[4] > hb[1] && k[1] < hb[4] && k[5] > hb[2] && k[2] < hb[5];
  for (const o of a.g.liste) {
    if (o === a || o.mort >= 0 || !o.veh?.wagon || !coupe(o.boite())) continue;
    let xa = a.x - o.x, za = a.z - o.z;
    const dd = xa * xa + za * za;
    if (dd < Math.fround(1e-4)) continue;
    const d = Math.sqrt(dd); xa /= d; za /= d;
    const pow = Math.min(1 / d, 1); xa *= pow * F01 * 0.5; za *= pow * F01 * 0.5;
    const dir = [(a.x - o.x) / d, (a.z - o.z) / d], ry = Math.fround(o.veh.yaw * Math.fround(0.017453292));
    let fc = [cosMth(ry), sinMth(ry)]; const lf = Math.hypot(...fc) || 1; fc = fc.map((c) => c / lf);
    if (Math.abs(dir[0] * fc[0] + dir[1] * fc[1]) < Math.fround(0.8)) continue;
    const mt = [o.vx, o.vz], mo = [a.vx, a.vz], ft = o.veh.type === 'furnace_minecart', fo = v.type === 'furnace_minecart';
    let nt, no;
    if (fo && !ft) { nt = [mt[0] * 0.2 + (mo[0] - xa), mt[1] * 0.2 + (mo[1] - za)]; no = [mo[0] * 0.95, mo[1] * 0.95]; }
    else if (!fo && ft) { nt = [mt[0] * 0.95, mt[1] * 0.95]; no = [mo[0] * 0.2 + (mt[0] + xa), mo[1] * 0.2 + (mt[1] + za)]; }
    else { const xdd = (mo[0] + mt[0]) / 2, zdd = (mo[1] + mt[1]) / 2; nt = [mt[0] * 0.2 + (xdd - xa), mt[1] * 0.2 + (zdd - za)]; no = [mo[0] * 0.2 + (xdd + xa), mo[1] * 0.2 + (zdd + za)]; }
    o.vx = nt[0]; o.vz = nt[1]; a.vx = no[0]; a.vz = no[1];
  }
  if (v.type !== 'minecart' || a.vx * a.vx + a.vz * a.vz < 0.01) return;
  for (const o of a.g.liste) {
    if (o === a || o.mort >= 0 || o.veh || o.monte || !o.typeCreature || !coupe(o.boite())) continue;
    if (!occupe(a) && o.typeCreature !== 'iron_golem' && o.typeCreature !== 'warden' && o.typeCreature !== 'wither' && o.typeCreature !== 'bat') { monter(o, a); continue; }
    const xa = o.x - a.x, za = o.z - a.z, dmax = Math.max(Math.abs(xa), Math.abs(za));
    if (dmax < 0.01 || o.typeCreature === 'shulker') continue;
    const dd = Math.sqrt(dmax), k = Math.min(1, 1 / dd) * 0.05, px = xa / dd * k, pz = za / dd * k;
    if (!occupe(a)) { a.vx -= px; a.vz -= pz; }
    o.vx += px; o.vz += pz;
  }
}
// AbstractMinecart.push(entity) par les vivants qui le touchent (LivingEntity.pushEntities) : le wagonnet recoit la poussee, le vivant un quart
export function pousserWagonnets(sim, liste) {
  for (const p of liste) {
    if (p.mort >= 0 || p.veh || p.monte || p.typeCreature === 'bat') continue;
    const bp = p.boite();
    for (const c of liste) {
      if (!c.veh?.wagon || c.mort >= 0 || c.passagers?.includes(p)) continue;
      const k = c.boite();
      if (!(k[3] > bp[0] && k[0] < bp[3] && k[4] > bp[1] && k[1] < bp[4] && k[5] > bp[2] && k[2] < bp[5])) continue;
      let xa = p.x - c.x, za = p.z - c.z;
      const dd = xa * xa + za * za;
      if (dd < Math.fround(1e-4)) continue;
      const d = Math.sqrt(dd), pow = Math.min(1 / d, 1);
      xa = xa / d * pow * F01 * 0.5; za = za / d * pow * F01 * 0.5;
      c.vx -= xa; c.vz -= za;
      if (p.typeCreature && !p.passagers?.length) { p.vx += xa / 4; p.vz += za / 4; }
    }
  }
}

// ------------------------------------------------------------ cavaliers
export function monter(c, v) {
  if (c.monte === v) return;
  if (c.monte) descendre(c);
  c.monte = v; (v.passagers ??= []).push(c);
  c.vx = 0; c.vy = 0; c.vz = 0; c.distanceChute = 0;
  c.sim.replay.montures.push({ tick: c.sim.temps, cavalier: c.nom, vehicule: v.nom });
  c.sim.dire(`${c.nom} monte dans ${v.nom}`);
  placerCavalier(c, v);
}
export function descendre(c, opt = {}) {
  const v = c.monte;
  if (!v) return;
  v.passagers = (v.passagers ?? []).filter((x) => x !== c);
  c.monte = null;
  if (opt.y !== undefined) c.y = opt.y;
  else {
    // getDismountLocationForPassenger : (largeur du vehicule + celle du cavalier) x racine de 2 / 2 sur les cotes (perpendiculaire a la marche
    // d'abord, puis devant et derriere), la premiere place libre avec un sol ; sinon sur le vehicule
    const w = Math.fround(((v.veh?.bateau ? L_B : L_W) + c.L) * Math.SQRT2) / 2, r = (v.veh?.yaw ?? 0) * Math.PI / 180;
    const cotes = [[-Math.sin(r + Math.PI / 2), Math.cos(r + Math.PI / 2)], [Math.sin(r + Math.PI / 2), -Math.cos(r + Math.PI / 2)], [-Math.sin(r), Math.cos(r)], [Math.sin(r), -Math.cos(r)]];
    let fait = false;
    for (const [dx, dz] of cotes) {
      const x = v.x + dx * w, z = v.z + dz * w;
      for (const dy of [0, 1, -1]) {
        const y = Math.floor(v.y) + dy, sol = c.g.solAuxCoordonnees(x, z, y);
        if (sol === null || Math.abs(sol - v.y) > 1.5) continue;
        const b = c.boite(x, sol, z);
        if (deplacerBoite(c.lec, b, [0, 1e-3, 0], false, 0).bloqueY) continue;
        c.x = x; c.y = sol; c.z = z; fait = true; break;
      }
      if (fait) break;
    }
    if (!fait) c.y = v.y + v.H;
  }
  c.sim.replay.montures.push({ tick: c.sim.temps, cavalier: c.nom, vehicule: null });
  c.sim.dire(`${c.nom} descend de ${v.nom}`);
}
// Entity.positionRider : siege du vehicule moins le decalage du cavalier
export function placerCavalier(c, v) {
  const d = decalageCavalier(c);
  if (v.veh?.wagon) { c.x = v.x; c.y = v.y + 0.1875 - d; c.z = v.z; }
  else if (v.veh?.bateau) {
    const l = v.passagers ?? [], i = l.indexOf(c), n = l.length, animal = !!c.typeCreature;
    let z = v.typeCreature === 'chest_boat' ? 0.15 : 0;
    if (n > 1) { z = i === 0 ? 0.2 : -0.6; if (animal) z += 0.2; }
    // getPassengerAttachmentPoint (0 ; rideHeight ; z).yRot(-yaw)
    c.x = v.x - Math.sin(v.veh.yaw * Math.PI / 180) * z; c.z = v.z + Math.cos(v.veh.yaw * Math.PI / 180) * z;
    c.y = v.y + Math.fround(H_B / 3) - d;
  } else { c.x = v.x; c.y = v.y + v.H - d; c.z = v.z; }
  c.vx = 0; c.vy = 0; c.vz = 0; c.auSol = false; c.distanceChute = 0;
}
// ServerPlayer.getLastClientMoveIntent : l'entree du cavalier (verbe `va` : vers son but) tournee de son lacet ; (0, 0) sans entree
function intentionPassager(v) {
  const c = cavaliers(v)[0];
  if (!c || c.typeCreature || !(c.entree?.avance > 0)) return null;
  const r = Math.fround(c.entree.cap * Math.fround(0.017453292)), s = sinMth(r), co = cosMth(r);
  return [-s, co];   // avant = 1, gauche = 0 : [gauche x cos - avant x sin, avant x cos + gauche x sin]
}

// Clic droit d'un acteur sur un vehicule (Minecart.interact, MinecartFurnace.interact, AbstractBoat.interact) : rend le resume
export function interagirVehicule(j, v) {
  const sim = j.sim, objet = String(j.main?.objet ?? '').replace(/^minecraft:/, '');
  if (v.veh.type === 'furnace_minecart') {   // charbon ou charbon de bois (#furnace_minecart_fuel) : + 3600 ticks au plus 32000, poussee depuis le joueur
    if (objet === 'coal' || objet === 'charcoal') {
      if (v.veh.fuel + 3600 <= 32000) { v.veh.fuel += 3600; j.consommerMain?.(1); }
      if (v.veh.fuel > 0) v.veh.push = [v.x - j.x, 0, v.z - j.z];
      sim.dire(`${j.nom} charge ${v.nom} (${v.veh.fuel} ticks de combustible)`);
      return 'four charge';
    }
    return 'rien';
  }
  if (v.veh.type === 'minecart' || v.veh.bateau) {
    if (j.accroupi || j.monte === v) return 'rien';
    const places = v.veh.bateau ? (v.typeCreature === 'chest_boat' ? 1 : 2) : 1;
    if (v.passagers.length >= places) return 'plein';
    monter(j, v);
    return 'monte';
  }
  return 'ouvre';   // coffre, entonnoir : l'ecran du joueur (rien dans le monde)
}

// ------------------------------------------------------------ colonnes de bulles (BubbleColumnBlock.entityInside)
export function colonnesBulles(sim, b) {
  const out = [], e = Math.fround(1e-5);
  for (let x = Math.floor(b[0] + e); x <= Math.ceil(b[3] - e) - 1; x++) for (let y = Math.floor(b[1] + e); y <= Math.ceil(b[4] - e) - 1; y++) for (let z = Math.floor(b[2] + e); z <= Math.ceil(b[5] - e) - 1; z++) {
    const k = sim.monde.etatEn(x, y, z);
    if (k < 0 || sim.d.nomBloc(k) !== 'bubble_column') continue;
    const dessus = sim.monde.etatEn(x, y + 1, z);
    const surface = dessus >= 0 && sim.d.boites(dessus).length === 0 && !sim.d.fluide(dessus);
    out.push({ pos: [x, y, z], drag: sim.d.prop(k, 'drag') === 'true', surface });
  }
  return out;
}
// Entity.onAboveBubbleColumn / onInsideBubbleColumn : rend vrai si la chute est remise a zero (dedans, sous la surface)
export function pousseeBulle(c, o, sim = null) {
  if (c.surface && sim) {   // Entity.onAboveBubbleColumn : 2 eclaboussures et 2 bulles a la surface (sendParticles ; bulle : vitesse 0,2)
    const h = sim.hasard, [x, y, z] = c.pos;
    for (let i = 0; i < 2; i++) {
      sim.particule('splash', x + h.reel(), y + 1, z + h.reel(), 0, 0, 0, 1);
      sim.particule('bubble', x + h.reel(), y + 1, z + h.reel(), h.gaussien() * 0.2, h.gaussien() * 0.2, h.gaussien() * 0.2, 1);
    }
  }
  if (c.surface) o.vy = c.drag ? Math.max(-0.9, o.vy - 0.03) : Math.min(1.8, o.vy + 0.1);
  else o.vy = c.drag ? Math.max(-0.3, o.vy - 0.03) : Math.min(0.7, o.vy + 0.06);
  return !c.surface;
}

// ------------------------------------------------------------ bateau (AbstractBoat.tick)
function hauteurFluide(sim, x, y, z) {
  const f = sim.fluide(x, y, z);
  if (f.type !== 'water') return null;
  return { h: sim.fluide(x, y + 1, z).type === 'water' ? 1 : f.quantite / 9, source: f.source };
}
function statutBateau(a, v) {
  const sim = a.sim, b = a.boite();
  const maxY = b[4] + 0.001;
  let sous = false;
  for (let x = Math.floor(b[0]); x < Math.ceil(b[3]); x++) for (let y = Math.floor(b[4]); y < Math.ceil(maxY); y++) for (let z = Math.floor(b[2]); z < Math.ceil(b[5]); z++) {
    const f = hauteurFluide(sim, x, y, z);
    if (f && maxY < Math.fround(y + f.h)) { if (!f.source) { v.niveauEau = b[4]; return 'courant'; } sous = true; }
  }
  if (sous) { v.niveauEau = b[4]; return 'sous'; }
  let dans = false; v.niveauEau = -Number.MAX_VALUE;
  for (let x = Math.floor(b[0]); x < Math.ceil(b[3]); x++) for (let y = Math.floor(b[1]); y < Math.ceil(b[1] + 0.001); y++) for (let z = Math.floor(b[2]); z < Math.ceil(b[5]); z++) {
    const f = hauteurFluide(sim, x, y, z);
    if (!f) continue;
    const niv = Math.fround(y + f.h);
    v.niveauEau = Math.max(v.niveauEau, niv); dans ||= b[1] < niv;
  }
  if (dans) return 'eau';
  const fr = frictionSol(a);
  if (fr > 0) { v.glisseSol = fr; return 'sol'; }
  return 'air';
}
// getGroundFriction : moyenne de la glissance des blocs sous la coque (sans les nenuphars)
function frictionSol(a) {
  const sim = a.sim, b = a.boite(), g = [b[0], b[1] - 0.001, b[2], b[3], b[1], b[5]];
  const x0 = Math.floor(g[0]) - 1, x1 = Math.ceil(g[3]) + 1, y0 = Math.floor(g[1]) - 1, y1 = Math.ceil(g[4]) + 1, z0 = Math.floor(g[2]) - 1, z1 = Math.ceil(g[5]) + 1;
  let f = 0, n = 0;
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
    const bords = (x === x0 || x === x1 - 1 ? 1 : 0) + (z === z0 || z === z1 - 1 ? 1 : 0);
    if (bords === 2) continue;
    for (let y = y0; y < y1; y++) {
      if (bords === 1 && (y === y0 || y === y1 - 1)) continue;
      const e = sim.monde.etatEn(x, y, z);
      if (e < 0 || sim.d.esAir(e) || sim.d.nomBloc(e) === 'lily_pad') continue;
      for (const k of sim.d.boites(e)) if (k[3] + x > g[0] && k[0] + x < g[3] && k[4] + y > g[1] && k[1] + y < g[4] && k[5] + z > g[2] && k[2] + z < g[5]) { f += sim.d.friction(e); n++; break; }
    }
  }
  return n ? Math.fround(f / n) : 0;
}
function niveauEauAuDessus(a, v) {
  const sim = a.sim, b = a.boite(), y0 = Math.floor(b[4]), y1 = Math.ceil(b[4] - v.dernierYd);
  for (let y = y0; y < y1; y++) {
    let h = 0;
    for (let x = Math.floor(b[0]); x < Math.ceil(b[3]) && h < 1; x++) for (let z = Math.floor(b[2]); z < Math.ceil(b[5]) && h < 1; z++) { const f = hauteurFluide(sim, x, y, z); if (f) h = Math.max(h, f.h); }
    if (h < 1) return Math.fround(y + h);
  }
  return y1 + 1;
}
function tickBateau(a, v) {
  const sim = a.sim;
  a.xAvant = a.x; a.yAvant = a.y; a.zAvant = a.z; v.yawPrec = v.yaw;
  v.hurtTime = Math.max(0, v.hurtTime - 1); v.damage = Math.max(0, v.damage - 1);
  const conduit = cavaliers(a)[0] && !cavaliers(a)[0].typeCreature ? cavaliers(a)[0] : null;
  const avaitStatut = v.statutConnu; v.statutConnu = true;
  v.statutAvant = v.statut; v.statut = statutBateau(a, v);
  v.sousEau = v.statut === 'sous' || v.statut === 'courant' ? v.sousEau + 1 : 0;
  courant(a, v);
  // floatBoat
  let vs = -0.04, flott = 0, fr;
  if (avaitStatut && v.statutAvant === 'air' && v.statut !== 'air' && v.statut !== 'sol') {
    const cible = Math.fround(niveauEauAuDessus(a, v) - Math.fround(H_B)) + 0.101;
    const b = a.boite();
    const libre = !deplacerBoite(a.lec, b, [0, cible - a.y, 0], false, 0).bloqueY;
    if (libre) { a.y = cible; a.vy = 0; }
    v.statut = 'eau';
  } else {
    if (v.statut === 'eau') { flott = (v.niveauEau - a.y) / H_B; fr = 0.9; }
    else if (v.statut === 'courant') { vs = -7e-4; fr = 0.9; }
    else if (v.statut === 'sous') { flott = Math.fround(0.01); fr = 0.45; }
    else if (v.statut === 'air') fr = 0.9;
    else { fr = v.glisseSol; if (conduit) v.glisseSol /= 2; }
    const f = Math.fround(fr);
    a.vx *= f; a.vy += vs; a.vz *= f;
    v.rotation *= f;
    if (flott > 0) a.vy = (a.vy + flott * (0.04 / 0.65)) * 0.75;
  }
  // controlBoat : le conducteur rame vers le but de son `va` (avant ; virage d'un degre par tick vers le cap)
  if (conduit) {
    let acc = 0;
    const veut = conduit.entree?.avance > 0, ecart = (((conduit.entree.cap - v.yaw + 180) % 360) + 360) % 360 - 180;
    const gauche = veut && ecart < -2, droite = veut && ecart > 2, haut = veut && Math.abs(ecart) < 45;
    if (gauche) v.rotation -= 1;
    if (droite) v.rotation += 1;
    if (droite !== gauche && !haut) acc += 0.005;
    v.yaw += v.rotation;
    if (haut) acc += 0.04;
    const ac = Math.fround(acc);
    a.vx += sinMth(Math.fround(-v.yaw * Math.fround(0.017453292))) * ac;
    a.vz += cosMth(Math.fround(v.yaw * Math.fround(0.017453292))) * ac;
  }
  const yAvant = a.y;
  const r = deplacer(a, v, [a.vx, a.vy, a.vz]);
  v.dernierYd = a.vy;
  if (!v.onGround && r.dy < 0) { const e = sim.monde.etatEn(Math.floor(a.x), Math.floor(a.y) - 1, Math.floor(a.z)); if (!(e >= 0 && sim.d.fluide(e) && sim.d.fluide(e) <= 2)) v.chute -= Math.fround(r.dy); } else if (v.onGround) v.chute = 0;
  void yAvant;
  const f = facteurVitesseBloc(a); a.vx *= f; a.vz *= f;
  a.lacet = v.yaw;
  // colonnes de bulles (deux applyEffectsFromBlocks) puis tickBubbleColumn
  const cols = colonnesBulles(sim, a.boite());
  for (let k = 0; k < 2; k++) for (const c of cols) {
    if (c.surface) { v.auDessusBulle = true; v.bulleBas = c.drag; if (v.bulleTemps === 0) v.bulleTemps = 60; if (v.statut !== 'sous' && v.statut !== 'courant' && sim.hasard.entierBorne(100) === 0) { sim.son('entity.generic.splash', a.x, a.y, a.z, 1, 0.8 + 0.4 * sim.hasard.flottant()); sim.particule('splash', a.x + sim.hasard.flottant(), a.y + 0.7, a.z + sim.hasard.flottant(), 0, 0, 0, 1); } }
    else pousseeBulle(c, a);
  }
  if (!v.auDessusBulle) v.bulleTemps = 0;
  if (v.bulleTemps > 0) {
    v.bulleTemps--;
    const diff = 60 - v.bulleTemps - 1;
    if (diff > 0 && v.bulleTemps === 0) {
      if (v.bulleBas) { for (const c of [...cavaliers(a)]) descendre(c); a.vy += -0.7; } else a.vy = 0.6;
      sim.dire(`${a.nom} (bateau) ${v.bulleBas ? 'tire vers le fond' : 'projete en l air'} par la colonne de bulles`);
    }
    v.auDessusBulle = false;
  }
  // balancement visible (tickBubbleColumn cote client) : +0,05 par tick pendant le compte, -0,1 sinon ; angle 10 x sin(0,5 x age) x multiplicateur
  v.ticks++;
  v.bulleMult = Math.max(0, Math.min(1, v.bulleMult + (v.bulleTemps > 0 ? 0.05 : -0.1)));
  v.bulleAnglePrec = v.bulleAngle; v.bulleAngle = Math.fround(10 * Math.sin(0.5 * v.ticks) * v.bulleMult);
  sim.toucherBlocsEntite?.(a.boite(), { type: 'bateau', nom: a.nom, id: a.id });
  for (let i = 0; i < 2 && a.mort < 0; i++) if (dansLave(a)) blesserVehicule(a, 4, 'lave');
  if (v.inWater) v.chute = 0;
}

// ------------------------------------------------------------ replay du vehicule (le film : lacet et tangage du jeu, secousse, meche, bulles)
export function ecrireVehicule(a) {
  const v = a.veh, sim = a.sim;
  // ancien rendu du wagonnet (AbstractMinecartRenderer) : sur un rail, position, lacet et tangage lus sur la voie (getPosOffs a +-0,3)
  let yaw = v.yaw, pitch = v.pitch, d = [0, 0, 0];
  if (v.wagon) { const r = poseSurRail(sim, a.x, a.y, a.z); if (r) { if (r.yaw !== null) { yaw = r.yaw; pitch = r.pitch; } d = [r.x - a.x, r.y - a.y, r.z - a.z]; } }
  sim.replay.vehicule(sim.temps, a.id, yaw, pitch, v.hurtTime, v.damage * v.hurtDir, v.fuse, v.bulleAngle, d[0], d[1], d[2], v.wagon ? 1 : 0);
}
void evenement;
