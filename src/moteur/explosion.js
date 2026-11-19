// Explosion du jeu (Explosion.explode / ServerExplosion) : 1352 rayons sur la surface d'une grille 16x16x16, pas de 0,3, la puissance du rayon
// baisse de (resistance + 0,3) x 0,3 dans chaque bloc et de 0,225 par pas ; les blocs touches sont detruits, les TNT voisins amorces (meche courte),
// les entites dans le rayon 2 x puissance prennent des degats et du recul selon la distance et l'exposition.
// Port de Horizon client/game/explosion.rs et tnt.rs : MIT, voir ATTRIBUTIONS.md.
import { evenement } from './registre.js';
import { boitesLocales } from './collision.js';
import { valeurAttribut } from './attributs.js';
import { VEHICULES } from '../creatures/especes.js';
import { ordreHashSet, melangerJeu } from './ordre-java.js';
const F = { TOUS: 3 };   // drapeaux de set_block (voir simulation.js)
const D_RENDU_PLEIN = 4;   // drapeau RENDU_PLEIN de donnees.js (BlockState.isSolidRender)

export const NB_RAYONS = 1352;

// BlockGetter.clip(ClipContext COLLIDER, Fluid.NONE) : vrai si une forme de COLLISION coupe le segment a -> b. Les cellules sont parcourues
// comme BlockGetter.traverseBlocks (segment allonge de 1e-7 aux deux bouts), chaque forme de cellule coupee comme VoxelShape.clip ; une
// cellule inconnue (hors de la zone) est pleine.
export function coupeSegment(lec, a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  if (!d[0] && !d[1] && !d[2]) return false;
  const s = [a[0] - d[0] * 1e-7, a[1] - d[1] * 1e-7, a[2] - d[2] * 1e-7], e = [b[0] + d[0] * 1e-7, b[1] + d[1] * 1e-7, b[2] + d[2] * 1e-7];
  const c = [Math.floor(s[0]), Math.floor(s[1]), Math.floor(s[2])], fin = [Math.floor(e[0]), Math.floor(e[1]), Math.floor(e[2])];
  const pas = [0, 0, 0], tMax = [Infinity, Infinity, Infinity], tPas = [Infinity, Infinity, Infinity], de = [e[0] - s[0], e[1] - s[1], e[2] - s[2]];
  for (let k = 0; k < 3; k++) {
    if (de[k] > 0) { pas[k] = 1; tPas[k] = 1 / de[k]; tMax[k] = (c[k] + 1 - s[k]) / de[k]; }
    else if (de[k] < 0) { pas[k] = -1; tPas[k] = -1 / de[k]; tMax[k] = (c[k] - s[k]) / de[k]; }
  }
  // VoxelShape.clip : le point a + 0,001 x (b - a) dans la forme -> touche ; sinon AABB.clip : une face d'ENTREE coupee a 0 < t < 1 (bornes a 1e-7)
  const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (L2 < 1e-7) return false;
  const q = [a[0] + d[0] * 0.001, a[1] + d[1] * 0.001, a[2] + d[2] * 0.001];
  const touche = (x, y, z) => {
    const L = boitesLocales(lec, x, y, z);
    for (let i = 0; i < L.length; i++) {
      const k = L[i];
      if (q[0] >= k[0] + x && q[0] < k[3] + x && q[1] >= k[1] + y && q[1] < k[4] + y && q[2] >= k[2] + z && q[2] < k[5] + z) return true;
    }
    for (let i = 0; i < L.length; i++) {
      const k = L[i], mn = [k[0] + x, k[1] + y, k[2] + z], mx = [k[3] + x, k[4] + y, k[5] + z];
      for (let ax = 0; ax < 3; ax++) {
        if (Math.abs(d[ax]) <= 1e-7) continue;
        const t = ((d[ax] > 0 ? mn[ax] : mx[ax]) - a[ax]) / d[ax];
        if (!(t > 0 && t < 1)) continue;
        const u = (ax + 1) % 3, v = (ax + 2) % 3, pu = a[u] + t * d[u], pv = a[v] + t * d[v];
        if (mn[u] - 1e-7 < pu && pu < mx[u] + 1e-7 && mn[v] - 1e-7 < pv && pv < mx[v] + 1e-7) return true;
      }
    }
    return false;
  };
  for (let n = 0; n < 4096; n++) {
    if (touche(c[0], c[1], c[2])) return true;
    if (c[0] === fin[0] && c[1] === fin[1] && c[2] === fin[2]) return false;
    const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
    if (tMax[k] > 1) return false;
    c[k] += pas[k]; tMax[k] += tPas[k];
  }
  return false;
}

// Exposition d'une boite a l'explosion (ServerExplosion.getSeenPercent) : part des points de la boite vus depuis le centre sans obstacle.
// `couple` (facultatif, pour le pantin du film seulement) : { com, R } -> moment moyen, autour du centre de la boite, du souffle recu par les
// points vus (direction centre -> point, x (1 - distance / R)) ; un souffle qui ne voit qu'un cote de la boite la fait tourner.
export function exposition(lec, centre, b, couple = null) {
  const dx = 1 / ((b[3] - b[0]) * 2 + 1), dy = 1 / ((b[4] - b[1]) * 2 + 1), dz = 1 / ((b[5] - b[2]) * 2 + 1);
  const gx = (1 - Math.floor(1 / dx) * dx) / 2, gz = (1 - Math.floor(1 / dz) * dz) / 2;
  if (dx < 0 || dy < 0 || dz < 0) return 0;
  let vus = 0, tot = 0;
  for (let u = 0; u <= 1; u += dx) for (let v = 0; v <= 1; v += dy) for (let w = 0; w <= 1; w += dz) {
    const p = [b[0] + (b[3] - b[0]) * u + gx, b[1] + (b[4] - b[1]) * v, b[2] + (b[5] - b[2]) * w + gz];
    if (!coupeSegment(lec, p, centre)) {   // le rayon va du point VERS le centre (ServerExplosion.getSeenPercent)
      vus++;
      if (couple) {
        const f = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]], l = Math.hypot(...f) || 1, k = Math.max(0, 1 - l / couple.R) / l;
        const r = [p[0] - couple.com[0], p[1] - couple.com[1], p[2] - couple.com[2]];
        couple.m[0] += (r[1] * f[2] - r[2] * f[1]) * k; couple.m[1] += (r[2] * f[0] - r[0] * f[2]) * k; couple.m[2] += (r[0] * f[1] - r[1] * f[0]) * k;
      }
    }
    tot++;
  }
  if (couple && tot) { couple.m[0] /= tot; couple.m[1] /= tot; couple.m[2] /= tot; }
  return tot ? vus / tot : 0;
}

// Points d'armure du jeu (ArmorMaterials : tete, torse, jambes, pieds) et robustesse ; armure naturelle des types (attribut armor)
const ARMURE = { leather: [[1, 3, 2, 1], 0], chainmail: [[2, 5, 4, 1], 0], iron: [[2, 6, 5, 2], 0], golden: [[2, 5, 3, 1], 0], gold: [[2, 5, 3, 1], 0], copper: [[2, 4, 3, 1], 0], diamond: [[3, 8, 6, 3], 2], netherite: [[3, 8, 6, 3], 3], turtle: [[2, 0, 0, 0], 0], turtle_scute: [[2, 0, 0, 0], 0] };
const ARMURE_NATURELLE = { zombie: 2, husk: 2, drowned: 2, zombie_villager: 2, zombified_piglin: 2, wither: 4 };
// armure d'un acteur : { points, robustesse } depuis son champ `armure` ({ tete: "iron", torse: "diamond_chestplate" ... })
export function armureDe(a) {
  let points = a.persoDef?.attributs?.armure ?? ARMURE_NATURELLE[a.typeCreature] ?? 0, robustesse = 0;   // entite de mod (mc.definirEntite) : attribut armor remplace
  ['tete', 'torse', 'jambes', 'pieds'].forEach((emp, i) => {
    const id = a.armure?.[emp];
    if (!id) return;
    const mat = String(id).replace(/^minecraft:/, '').replace(/\[.*$/, '').replace(/_(helmet|chestplate|leggings|boots)$/, '');   // composants (enchantements) ignores
    const m = ARMURE[mat];
    if (m) { points += m[0][i]; robustesse += m[1]; }
  });
  return { points, robustesse };
}
// CombatRules.getDamageAfterAbsorb puis getDamageAfterMagicAbsorb (Protection contre les explosions : 2 par niveau, plafond 20)
export function degatsApresArmure(q, { points, robustesse }, niveauxProtection = 0) {
  if (points > 0) { const f = 2 + robustesse / 4, g = Math.min(20, Math.max(points * 0.2, points - q / f)); q *= 1 - g / 25; }
  const epf = Math.min(20, Math.max(0, 2 * niveauxProtection));
  return q * (1 - epf / 25);
}
// sources d'explosion dont l'entite qui cause est un vivant non joueur : les degats aux joueurs suivent la difficulte (DamageScaling
// WHEN_CAUSED_BY_LIVING_NON_PLAYER) ; le TNT (proprietaire joueur ou aucun) et le cristal de l'End non
const SOURCES_MOB = new Set(['creeper', 'boule_feu', 'wither', 'crane']);
const DIFFICULTES = { paisible: 0, peaceful: 0, facile: 1, easy: 1, normal: 2, difficile: 3, hard: 3 };
// Player.hurtServer : paisible 0, facile min(d / 2 + 1, d), normal d, difficile d x 1,5 (comme degatsJoueur de ia.js)
const degatsDifficulte = (d, dif) => (dif === 0 ? 0 : dif === 1 ? Math.min(d / 2 + 1, d) : dif === 3 ? d * 1.5 : d);
// Entites non vivantes : boite (largeur, hauteur) et hauteur des yeux (Entity.getEyeHeight, vers laquelle le souffle pousse) lues dans
// entity-types.json du jeu 26.3 (tnt 0,98 ; bloc qui tombe 0,98 ; objet 0,25 ; orbe 0,5 ; fleche et trident 0,5 / yeux 0,13 ; boule de neige,
// oeuf, perle, potion 0,25 / 0,2125 ; petite boule de feu et crane du wither 0,3125 / 0,265625 ; boule de feu du ghast et du dragon 1 / 0,85).
// TNT amorce : le souffle vise sa position (PrimedTnt : getY, pas les yeux). Bloc qui tombe : 0,98 x 0,85 (f32), comme Horizon.
const ENTITE = {
  tnt: [0.98, 0.98, 0], chute: [0.98, 0.98, Math.fround(0.98 * 0.85)], objet: [0.25, 0.25, 0.2125], orbe: [0.5, 0.5, Math.fround(0.5 * 0.85)],
  fleche: [0.5, 0.5, 0.13], trident: [0.5, 0.5, 0.13],
  boule: [0.25, 0.25, 0.2125], oeuf: [0.25, 0.25, 0.2125], perle: [0.25, 0.25, 0.2125], potion: [0.25, 0.25, 0.2125],
  petite_boule_feu: [0.3125, 0.3125, 0.265625], crane: [0.3125, 0.3125, 0.265625], boule_feu: [1, 1, 0.85], boule_dragon: [1, 1, 0.85],
  fusee: [0.25, 0.25, 0.2125],   // fusee d'artifice (FireworkRocketEntity) ; les charges de vent ne sont pas poussees (ProjectileKind.ignores_blast)
};
// Le souffle ne fait rien d'autre aux projectiles que les pousser (hurtServer ne fait rien : Horizon explosion_hurt_entities) ; une boule de
// feu garde son acceleration (accelerationPower, un nombre) le long de sa NOUVELLE vitesse : la poussee devie donc sa course (projectiles.js).
// Pas poussees : fleche ou trident plantes (Projectile.pushed_by_explosion : !stuck).

// sim : Simulation ; opt : { puissance, feu, casseBlocs, source, pousse }. Rend { detruits, touches, puissance }.
export function exploser(sim, x, y, z, opt = {}) {
  const d = sim.d, regles = sim.regles;
  const ev = evenement({ centre: [x, y, z], puissance: opt.puissance ?? sim.regles.valeur('tnt.puissance', 4), casseBlocs: opt.casseBlocs ?? sim.regles.valeur('tnt.casseBlocs', true), feu: opt.feu ?? sim.regles.valeur('tnt.feu', false), pousse: opt.pousse ?? sim.regles.valeur('tnt.pousse', true), source: opt.source ?? null });
  if (sim.reg.aMonde('avantExplosion')) sim.reg.lancerMonde('avantExplosion', ev, sim.api);
  if (ev.annule) return { detruits: 0, touches: 0, puissance: 0 };
  const P = Math.max(0, Number(ev.puissance)), facteur = regles.valeur('explosion.resistanceBlocs', 1);
  // ServerExplosion.calculateExplodedPositions : toute cellule ou le rayon garde de la puissance entre dans le HashSet, air compris (sa
  // resistance est nulle : le feu peut y naitre) ; resistance = max(bloc, 100 s'il y a un fluide), plafonnee a 0,8 par un crane bleu du wither
  // (sauf #minecraft:wither_immune). Cellule hors de la zone : le rayon s'arrete (le bord du monde du jeu).
  const touches0 = [];
  const lec = { d, etatEn: (a, b, c) => sim.monde.etatEn(a, b, c) };
  const immunes = opt.plafondResistance !== undefined ? d.etiquette('#minecraft:wither_immune') : null;
  let rayons = 0;
  for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) for (let l = 0; l < 16; l++) {
    if (!(j === 0 || j === 15 || k === 0 || k === 15 || l === 0 || l === 15)) continue;
    rayons++;
    let dx = j / 15 * 2 - 1, dy = k / 15 * 2 - 1, dz = l / 15 * 2 - 1;
    const g = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= g; dy /= g; dz /= g;
    let h = P * (0.7 + sim.hasard.flottant() * 0.6);
    let mx = x, my = y, mz = z;
    for (; h > 0; h -= 0.225) {
      const bx = Math.floor(mx), by = Math.floor(my), bz = Math.floor(mz);
      const e = sim.monde.etatEn(bx, by, bz);
      if (e < 0) break;
      if (!d.esAir(e) || d.fluide(e) > 0) {
        let res = Math.max(d.resistance(e), d.fluide(e) > 0 ? 100 : 0);
        if (immunes && !immunes.has(d.blocDe(e))) res = Math.min(opt.plafondResistance, res);   // WitherSkull.getBlockExplosionResistance
        if (opt.protegeRails) { const rails = d.etiquette('#minecraft:rails'), up = sim.monde.etatEn(bx, by + 1, bz); if (rails.has(d.blocDe(e)) || (up >= 0 && rails.has(d.blocDe(up)))) res = 0; }   // MinecartTNT.getBlockExplosionResistance
        h -= (res * facteur + 0.3) * 0.3;
      }
      if (h > 0) touches0.push([bx, by, bz]);
      mx += dx * 0.3; my += dy * 0.3; mz += dz * 0.3;
    }
  }
  const cibles = ordreHashSet(touches0);   // l'ordre du HashSet<BlockPos> de Java (moteur/ordre-java.js)
  sim.stats.rayons = (sim.stats.rayons || 0) + rayons;
  // entites (ServerExplosion.hurtEntities, Horizon game/explosion.rs) : toute entite dont les PIEDS sont a moins de 2 x puissance du centre ;
  // exposition par rayons vers la boite ; degats (a^2 + a) / 2 x 7 x 2P + 1 (reel, pas arrondi) ; poussee (1 - d) x exposition, dirigee du
  // centre vers les yeux (TNT amorce : vers sa position), x (1 - explosion_knockback_resistance) pour un vivant (0 pour tous les types ;
  // Protection contre les explosions : 0,15 par niveau). Le souffle n'ajoute pas le recul des coups (tag no_knockback).
  const R = P * 2, touches = [], C = [x, y, z];
  const source = opt.source ?? ev.source ?? null;
  const ecrireSouffle = sim.replay.souffle && regles.valeur('explosion.ragdoll', true);
  const griefing = regles.valeur('ia.explosionCasse', true);   // la regle mobGriefing du jeu
  if (sim.acteurs && R > 0) {
    for (const a of sim.acteurs.liste) {
      if (opt.exclure && a.nom === opt.exclure) continue;   // level.explode(source, ...) : la source n'est pas touchee (wither)
      if (a.mort >= 0) continue;
      const dist = Math.hypot(a.x - x, a.y - y, a.z - z) / R;   // Entity.distanceToSqr(centre) : depuis les pieds
      if (dist > 1) continue;
      // support d'armure (ArmorStand : jamais pousse ; hurtServer IS_EXPLOSION -> brokenByAnything puis kill) : casse s'il est atteint, sauf un
      // souffle qui epargne les decorations (sans mobGriefing : explosion qui garde les blocs, ou causee par un mob ; Horizon blast_spares_decorations)
      if (a.typeCreature === 'armor_stand') {
        if (!griefing && (!ev.casseBlocs || SOURCES_MOB.has(source))) continue;
        a.vie = 0; a.mort = 0; a.mortSansCorps = true;
        sim.son('entity.armor_stand.break', a.x, a.y, a.z, 1, 1);
        sim.stats.morts = (sim.stats.morts || 0) + 1; touches.push(a.nom);
        sim.dire(`${a.nom} (support d armure) casse par l explosion`);
        continue;
      }
      // bateau, wagonnet (VehicleEntity) : ignores par un souffle de mob sans mobGriefing (Horizon vehicles_ignore) ; ailleurs plus bas
      const vehicule = VEHICULES.has(a.typeCreature);
      if (vehicule && !griefing && SOURCES_MOB.has(source)) continue;
      const b = a.boite(), oeil = a.oeil();
      let ex = oeil[0] - x, ey = oeil[1] - y, ez = oeil[2] - z;
      const n = Math.hypot(ex, ey, ez);
      if (n < 1e-4) { ex = 0; ey = 0; ez = 0; } else { ex /= n; ey /= n; ez /= n; }
      const couple = ecrireSouffle ? { com: [a.x, a.y + (b[4] - b[1]) / 2, a.z], R, m: [0, 0, 0] } : null;
      const vu = exposition(lec, C, b, couple);
      const ab = (1 - dist) * vu;   // 0 derriere un mur : 1 de degats quand meme (le + 1 de la formule), pas de poussee
      let degats = (ab * ab + ab) / 2 * 7 * R + 1;
      // joueur : difficulte si l'explosion vient d'un mob (creeper, ghast, wither ; Player.hurtServer) ; armure et Protection contre les explosions
      if (!a.typeCreature && SOURCES_MOB.has(source)) degats = degatsDifficulte(degats, DIFFICULTES[regles.valeur('monde.difficulte', 'normal')] ?? 2);
      if (vehicule && a.veh) {   // vehicule simule (moteur/vehicules.js) : VehicleEntity.hurtServer (TNT : amorce ; casse : contenu et objet), puis la poussee
        touches.push(a.nom);
        a.degats(degats, source === 'tnt' ? 'explosion' : 'explosion');
        if (ev.pousse && a.mort < 0) { a.vx += ex * ab; a.vy += ey * ab; a.vz += ez * ab; }
        continue;
      }
      if (vehicule) {
        // VehicleEntity.hurtServer : usure += degats x 10 (elle redescend de 1 par tick : VehicleEntity.tick), detruit au-dela de 40
        // (destroy : kill puis l'objet du vehicule) ; il est pousse comme toute entite (la poussee n'a pas de resistance : pas un vivant)
        const usure = Math.max(0, (a.usureVehicule ?? 0) - (sim.temps - (a.usureTick ?? sim.temps))) + degats * 10;
        a.usureVehicule = usure; a.usureTick = sim.temps; touches.push(a.nom);
        sim.dire(`${a.nom} (vehicule) usure ${usure.toFixed(1)} (explosion), recul ${ab.toFixed(2)}`);
        if (usure > 40) {
          a.vie = 0; a.mort = 0; a.mortSansCorps = true; sim.stats.morts = (sim.stats.morts || 0) + 1;
          const t = a.typeCreature, bois = a.ia?.variante ?? a.variante ?? 'oak';
          if (regles.valeur('butin.actif', true)) sim.entites?.objet(/boat$/.test(t) ? `${bois}_${t}` : t, 1, a.x, a.y, a.z);
          continue;
        }
        if (ev.pousse) { a.vx += ex * ab; a.vy += ey * ab; a.vz += ez * ab; if (a.vy > 0) a.auSol = false; }
        continue;
      }
      // attribut explosion_knockback_resistance (moteur/attributs.js : 0 pour tous les types ; Protection contre les explosions 0,15F par niveau et
      // par piece ; ancien champ protectionExplosion : 0,15 par niveau ; borne 0..1) ; PAS knockback_resistance : golem, ravageur et netherite sont
      // pousses ; l'armure et la Protection (degats) sont comptees par Acteur.degats (apres la fenetre d'invulnerabilite)
      const k = ab * (1 - valeurAttribut(a, 'explosion_knockback_resistance'));
      if (ev.pousse) {
        if (couple && k > 0) sim.replay.souffle(sim.temps, a.id, [ex * k, ey * k, ez * k], couple.m, a.auSol ? 1 : 0);
        a.vx += ex * k; a.vy += ey * k; a.vz += ez * k; if (a.vy > 0) a.auSol = false;
      }
      if (!a.typeCreature && a.impulsion) a.impulsion.grace = 0;   // ServerPlayer.onExplosionHit : une explosion qui n'est pas une charge de vent finit la grace de l'impulsion
      touches.push(a.nom);
      sim.dire(`${a.nom} degats ${Math.round(degats * 100) / 100} (explosion), recul ${(k).toFixed(2)}`);
      if (regles.valeur('vie.explosions', true) && degats > 0 && a.degats(degats, 'explosion')) a.ia?.blesse(sim.acteurs.parNom.get(opt.causeNom) ?? null);   // tag panic_causes : les animaux paniquent
    }
  }
  // entites non vivantes : TNT amorce, blocs qui tombent, projectiles en vol (fleches, trident, boules de neige, oeufs, perles, potions,
  // boules de feu, cranes du wither), objets au sol et orbes d'experience (5 de vie : detruits par le souffle, sauf l'etoile du Nether ;
  // ItemEntity.ignoreExplosion : sans mobGriefing, une explosion qui garde les blocs ne touche pas les objets). L'entite qui explose (TNT,
  // boule de feu, crane) est deja retiree (discard avant level.explode) : elle n'est ni touchee ni poussee.
  if (sim.entites && R > 0) {
    const objetsEpargnes = !griefing && !ev.casseBlocs;   // items_ignore_explosion(mobGriefing, BlockInteraction.KEEP)
    const finis = sim.entites._fini;
    for (const e of sim.entites.liste) {
      const L = ENTITE[e.type];
      if (!L || e.pris || e.detruit || finis?.has(e) || (e.type === 'objet' && objetsEpargnes)) continue;
      if (e.proj && e.plantee) continue;
      const dist = Math.hypot(e.x - x, e.y - y, e.z - z) / R;
      if (dist > 1) continue;
      const b = [e.x - L[0] / 2, e.y, e.z - L[0] / 2, e.x + L[0] / 2, e.y + L[1], e.z + L[0] / 2];
      let ex = e.x - x, ey = e.y + L[2] - y, ez = e.z - z;
      const n = Math.hypot(ex, ey, ez);
      if (n < 1e-4) { ex = 0; ey = 0; ez = 0; } else { ex /= n; ey /= n; ez /= n; }
      const ab = (1 - dist) * exposition(lec, C, b);
      if (e.type === 'objet' || e.type === 'orbe') {
        const q = (ab * ab + ab) / 2 * 7 * R + 1;
        if (!(e.type === 'objet' && e.item === 'nether_star')) { e.vie = Math.trunc((e.vie ?? 5) - q); if (e.vie <= 0) { e.detruit = true; continue; } }   // (int)(health - amount)
      }
      if (ev.pousse && ab > 0) {
        e.vx += ex * ab; e.vy += ey * ab; e.vz += ez * ab;
        if (e.proj) { sim.stats.projectilesPousses = (sim.stats.projectilesPousses || 0) + 1; sim.dire(`${e.type} ${e.id} pousse par le souffle (${(ex * ab).toFixed(3)} ; ${(ey * ab).toFixed(3)} ; ${(ez * ab).toFixed(3)})`); }
      }
    }
  }
  // blocs (ServerExplosion.interactWithBlocks) : la liste est melangee par le hasard du monde (Util.shuffle), puis chaque bloc non vide est
  // touche dans cet ordre : un TNT s'amorce (meche courte), les autres lachent leur butin et deviennent de l'air
  const liste = [], butins = [];
  if (ev.casseBlocs) {
    melangerJeu(cibles, sim.hasard);
    for (const [bx, by, bz] of cibles) {
      const e = sim.monde.etatEn(bx, by, bz);
      if (e < 0 || d.esAir(e)) continue;
      const bloc = d.blocDe(e);
      // MinecartTNT.shouldBlockExplode : un wagonnet de TNT amorce epargne les rails et le bloc sous un rail
      if (opt.protegeRails) { const rails = d.etiquette('#minecraft:rails'), dessus = sim.monde.etatEn(bx, by + 1, bz); if (rails.has(bloc) || (dessus >= 0 && rails.has(d.blocDe(dessus)))) continue; }
      if (sim.reg.a('explosion', bloc)) {   // evenement de bloc des mods : `explosion` (ev.annuler() garde le bloc)
        const evb = evenement({ pos: [bx, by, bz], etat: d.chaine(e), centre: [x, y, z], puissance: P });
        sim.reg.lancerBloc('explosion', bloc, evb, sim.api);
        if (evb.annule) continue;
      }
      liste.push([bx, by, bz]);
      if (d.nomBloc(e) === 'tnt') { sim.api.allumer(bx, by, bz, { chaine: true }); continue; }   // le TNT voisin devient une entite a meche courte
      if (regles.valeur('explosion.butin', true) && regles.valeur('butin.actif', true)) butins.push([bx, by, bz, e]);
      sim.poser(bx, by, bz, 'minecraft:air', F.TOUS);
    }
  }
  // butin : les objets des blocs detruits (chance 1 / puissance par objet), les piles identiques fusionnees comme ServerExplosion.addOrAppendStack
  if (butins.length) {
    const piles = [];
    for (const [bx, by, bz, e] of butins) {
      for (const [item, n] of sim.entites.collecterButin(bx, by, bz, e, P)) {
        const p = piles.find((q) => q.item === item && q.n < 64);
        if (p) { const k = Math.min(n, 64 - p.n); p.n += k; if (n > k) piles.push({ item, n: n - k, x: bx, y: by, z: bz }); } else piles.push({ item, n, x: bx, y: by, z: bz });
      }
    }
    for (const p of piles) sim.entites.objet(p.item, p.n, p.x + 0.5 + (sim.hasard.flottant() * 0.5 - 0.25), p.y + 0.5 + (sim.hasard.flottant() * 0.5 - 0.25) - 0.125, p.z + 0.5 + (sim.hasard.flottant() * 0.5 - 0.25));
  }
  // feu (ServerExplosion.createFire) : sur chaque cellule de la liste (air d'origine compris), une chance sur 3, si elle est vide et que le
  // dessous est un bloc plein opaque (isSolidRender) ; feu d'ame sur sa base (BaseFireBlock.getState)
  if (ev.feu) for (const [bx, by, bz] of cibles) {
    if (sim.hasard.entierBorne(3) !== 0) continue;
    const e = sim.monde.etatEn(bx, by, bz), s0 = sim.monde.etatEn(bx, by - 1, bz);
    if (e < 0 || s0 < 0 || !d.esAir(e) || !d.a(s0, D_RENDU_PLEIN)) continue;
    sim.poser(bx, by, bz, d.etiquette('#minecraft:soul_fire_base_blocks').has(d.blocDe(s0)) ? 'minecraft:soul_fire' : 'minecraft:fire', F.TOUS);
  }
  // particules (ClientPacketListener.handleExplosion, Horizon horizon-client-render particles.rs `explosion`) : la grande explosion
  // (emetteur : 6 boules par tick pendant 8 ticks) sauf ServerExplosion.isSmall (puissance < 2 ou sans casse) ; les debris
  // (ClientExplosionTracker : min(blocs, 512) bouffees poof ou smoke dans la sphere) sont tires par le film (film/effets-monde.js)
  const grosse = P >= 2 && ev.casseBlocs;
  sim.replay.particule(sim.temps, grosse ? 'explosion_emitter' : 'explosion', x, y, z, 1, 0, 0, 1);
  if (cibles.length) sim.replay.particule(sim.temps, 'explosion_debris', x, y, z, P, 0, 0, cibles.length);   // ClientExplosionTracker : le nombre de cellules de la liste (air compris), quelle que soit la casse
  sim.son('entity.generic.explode', x, y, z, 4, (1 + (sim.hasard.flottant() - sim.hasard.flottant()) * 0.2) * 0.7);
  sim.dire(`explosion p=${P} (${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}) : ${liste.length} blocs detruits, ${touches.length} entite(s) touchee(s)`);
  sim.stats.explosions = (sim.stats.explosions || 0) + 1; sim.stats.explosionsBlocs = (sim.stats.explosionsBlocs || 0) + liste.length;
  sim.vibrations?.emettre('explode', x, y, z, { source: opt.exclure ?? null });   // GameEvent.EXPLODE (frequence 15)
  const res = { detruits: liste.length, touches: touches.length, puissance: P, blocs: liste };
  if (sim.reg.aMonde('apresExplosion')) sim.reg.lancerMonde('apresExplosion', evenement({ centre: [x, y, z], puissance: P, blocsDetruits: liste.length, entites: touches }), sim.api);
  return res;
}
