// Explosion du jeu (Explosion.explode / ServerExplosion) : 1352 rayons sur la surface d'une grille 16x16x16, pas de 0,3, la puissance du rayon
// baisse de (resistance + 0,3) x 0,3 dans chaque bloc et de 0,225 par pas ; les blocs touches sont detruits, les TNT voisins amorces (meche courte),
// les entites dans le rayon 2 x puissance prennent des degats et du recul selon la distance et l'exposition.
// Port de Horizon client/game/explosion.rs et tnt.rs : MIT, voir ATTRIBUTIONS.md.
import { evenement } from './registre.js';
import { rayonBloc } from './collision.js';
const F = { TOUS: 3 };   // drapeaux de set_block (voir simulation.js)

export const NB_RAYONS = 1352;
const AIR = /^(cave_|void_)?air$/;

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
    if (rayonBloc(lec, p, centre) === null) {
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
  let points = ARMURE_NATURELLE[a.typeCreature] ?? 0, robustesse = 0;
  ['tete', 'torse', 'jambes', 'pieds'].forEach((emp, i) => {
    const id = a.armure?.[emp];
    if (!id) return;
    const mat = String(id).replace(/^minecraft:/, '').replace(/_(helmet|chestplate|leggings|boots)$/, '');
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
// hauteur des yeux des entites non vivantes (Entity.getEyeHeight : 0,85 de la boite par defaut ; TNT amorce : sa position)
const OEIL_ENTITE = { tnt: 0, chute: 0.98 * 0.85, objet: 0.2125, orbe: 0.5 * 0.85 };
const BOITE_ENTITE = { tnt: [0.98, 0.98], chute: [0.98, 0.98], objet: [0.25, 0.25], orbe: [0.5, 0.5] };

// sim : Simulation ; opt : { puissance, feu, casseBlocs, source, pousse }. Rend { detruits, touches, puissance }.
export function exploser(sim, x, y, z, opt = {}) {
  const d = sim.d, regles = sim.regles;
  const ev = evenement({ centre: [x, y, z], puissance: opt.puissance ?? sim.regles.valeur('tnt.puissance', 4), casseBlocs: opt.casseBlocs ?? sim.regles.valeur('tnt.casseBlocs', true), feu: opt.feu ?? sim.regles.valeur('tnt.feu', false), pousse: opt.pousse ?? sim.regles.valeur('tnt.pousse', true), source: opt.source ?? null });
  if (sim.reg.aMonde('avantExplosion')) sim.reg.lancerMonde('avantExplosion', ev, sim.api);
  if (ev.annule) return { detruits: 0, touches: 0, puissance: 0 };
  const P = Math.max(0, Number(ev.puissance)), facteur = regles.valeur('explosion.resistanceBlocs', 1);
  const detruits = new Map();                      // 'x,y,z' -> [x,y,z] dans l'ordre d'insertion (deterministe)
  const lec = { d, etatEn: (a, b, c) => sim.monde.etatEn(a, b, c) };
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
      if (e >= 0 && !AIR.test(d.nomBloc(e))) {
        // crane bleu du wither (WitherSkull.getBlockExplosionResistance) : la resistance d'un bloc cassable est plafonnee a 0,8
        const res = opt.plafondResistance !== undefined && d.durete?.(e) >= 0 ? Math.min(opt.plafondResistance, d.resistance(e)) : d.resistance(e);
        h -= (res * facteur + 0.3) * 0.3;
        if (h > 0 && ev.casseBlocs) { const c = `${bx},${by},${bz}`; if (!detruits.has(c)) detruits.set(c, [bx, by, bz]); }
      } else if (e < 0) h -= (1200 + 0.3) * 0.3;   // cellule inconnue (cachee) : pleine
      mx += dx * 0.3; my += dy * 0.3; mz += dz * 0.3;
    }
  }
  sim.stats.rayons = (sim.stats.rayons || 0) + rayons;
  // entites (ServerExplosion.hurtEntities, Horizon game/explosion.rs) : toute entite dont les PIEDS sont a moins de 2 x puissance du centre ;
  // exposition par rayons vers la boite ; degats (a^2 + a) / 2 x 7 x 2P + 1 (reel, pas arrondi) ; poussee (1 - d) x exposition, dirigee du
  // centre vers les yeux (TNT amorce : vers sa position), x (1 - explosion_knockback_resistance) pour un vivant (0 pour tous les types ;
  // Protection contre les explosions : 0,15 par niveau). Le souffle n'ajoute pas le recul des coups (tag no_knockback).
  const R = P * 2, touches = [], C = [x, y, z];
  const source = opt.source ?? ev.source ?? null;
  const ecrireSouffle = sim.replay.souffle && regles.valeur('explosion.ragdoll', true);
  if (sim.acteurs && R > 0) {
    for (const a of sim.acteurs.liste) {
      if (opt.exclure && a.nom === opt.exclure) continue;   // level.explode(source, ...) : la source n'est pas touchee (wither)
      if (a.mort >= 0) continue;
      const dist = Math.hypot(a.x - x, a.y - y, a.z - z) / R;   // Entity.distanceToSqr(centre) : depuis les pieds
      if (dist > 1) continue;
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
      const prot = a.protectionExplosion ?? 0;
      degats = degatsApresArmure(degats, armureDe(a), prot);
      const k = ab * (1 - Math.min(1, 0.15 * prot));
      if (ev.pousse) {
        if (couple && k > 0) sim.replay.souffle(sim.temps, a.id, [ex * k, ey * k, ez * k], couple.m, a.auSol ? 1 : 0);
        a.vx += ex * k; a.vy += ey * k; a.vz += ez * k; if (a.vy > 0) a.auSol = false;
      }
      touches.push(a.nom);
      sim.dire(`${a.nom} degats ${Math.round(degats * 100) / 100} (explosion), recul ${(k).toFixed(2)}`);
      if (regles.valeur('vie.explosions', true) && degats > 0 && a.degats(degats, 'explosion')) a.ia?.blesse(sim.acteurs.parNom.get(opt.causeNom) ?? null);   // tag panic_causes : les animaux paniquent
    }
  }
  // entites non vivantes : TNT amorce, blocs qui tombent, objets au sol et orbes d'experience (5 de vie : detruits par le souffle, sauf
  // l'etoile du Nether ; un souffle de mob sans mobGriefing epargne les objets : items_ignore_explosion)
  if (sim.entites && R > 0) {
    const objetsEpargnes = SOURCES_MOB.has(source) && !ev.casseBlocs;
    for (const e of sim.entites.liste) {
      const L = BOITE_ENTITE[e.type];
      if (!L || e.pris || e.detruit || (e.type === 'objet' && objetsEpargnes)) continue;
      const dist = Math.hypot(e.x - x, e.y - y, e.z - z) / R;
      if (dist > 1) continue;
      const b = [e.x - L[0] / 2, e.y, e.z - L[0] / 2, e.x + L[0] / 2, e.y + L[1], e.z + L[0] / 2];
      let ex = e.x - x, ey = e.y + OEIL_ENTITE[e.type] - y, ez = e.z - z;
      const n = Math.hypot(ex, ey, ez);
      if (n < 1e-4) { ex = 0; ey = 0; ez = 0; } else { ex /= n; ey /= n; ez /= n; }
      const ab = (1 - dist) * exposition(lec, C, b);
      if (e.type === 'objet' || e.type === 'orbe') {
        const q = (ab * ab + ab) / 2 * 7 * R + 1;
        if (!(e.type === 'objet' && e.item === 'nether_star')) { e.vie = Math.trunc((e.vie ?? 5) - q); if (e.vie <= 0) { e.detruit = true; continue; } }   // (int)(health - amount)
      }
      if (ev.pousse && ab > 0) { e.vx += ex * ab; e.vy += ey * ab; e.vz += ez * ab; }
    }
  }
  // blocs detruits : les TNT s'amorcent (meche courte), le reste devient de l'air
  const liste = [...detruits.values()], butins = [];
  for (const [bx, by, bz] of liste) {
    const e = sim.monde.etatEn(bx, by, bz);
    if (e < 0) continue;
    if (d.nomBloc(e) === 'tnt') { sim.api.allumer(bx, by, bz, { chaine: true }); continue; }   // le TNT voisin devient une entite a meche courte
    if (regles.valeur('explosion.butin', true) && regles.valeur('butin.actif', true)) butins.push([bx, by, bz, e]);
    sim.poser(bx, by, bz, 'minecraft:air', F.TOUS);
  }
  // butin : les objets des blocs detruits (chance 1 / puissance par objet), les piles identiques fusionnees comme ServerExplosion.addOrAppendStack
  if (butins.length) {
    const piles = [];
    for (const [bx, by, bz, e] of butins) {
      const tmp = sim.entites.liste.length;
      void tmp;
      for (const [item, n] of sim.entites.collecterButin(bx, by, bz, e, P)) {
        const p = piles.find((q) => q.item === item && q.n < 64);
        if (p) { const k = Math.min(n, 64 - p.n); p.n += k; if (n > k) piles.push({ item, n: n - k, x: bx, y: by, z: bz }); } else piles.push({ item, n, x: bx, y: by, z: bz });
      }
    }
    for (const p of piles) sim.entites.objet(p.item, p.n, p.x + 0.5 + (sim.hasard.flottant() * 0.5 - 0.25), p.y + 0.5 + (sim.hasard.flottant() * 0.5 - 0.25) - 0.125, p.z + 0.5 + (sim.hasard.flottant() * 0.5 - 0.25));
  }
  // feu : une chance sur 3 par bloc detruit, sur de l'air au-dessus d'un sol plein
  if (ev.feu) for (const [bx, by, bz] of liste) {
    if (sim.hasard.entierBorne(3) !== 0) continue;
    if (sim.monde.etatEn(bx, by, bz) === d.air && sim.api.appui(bx, by - 1, bz, 'haut', 'plein')) sim.poser(bx, by, bz, 'minecraft:fire', F.TOUS);
  }
  // particules (ClientPacketListener.handleExplosion, Horizon horizon-client-render particles.rs `explosion`) : la grande explosion
  // (emetteur : 6 boules par tick pendant 8 ticks) sauf ServerExplosion.isSmall (puissance < 2 ou sans casse) ; les debris
  // (ClientExplosionTracker : min(blocs, 512) bouffees poof ou smoke dans la sphere) sont tires par le film (film/effets-monde.js)
  const grosse = P >= 2 && ev.casseBlocs;
  sim.replay.particule(sim.temps, grosse ? 'explosion_emitter' : 'explosion', x, y, z, 1, 0, 0, 1);
  if (liste.length) sim.replay.particule(sim.temps, 'explosion_debris', x, y, z, P, 0, 0, liste.length);
  sim.son('entity.generic.explode', x, y, z, 4, (1 + (sim.hasard.flottant() - sim.hasard.flottant()) * 0.2) * 0.7);
  sim.dire(`explosion p=${P} (${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}) : ${liste.length} blocs detruits, ${touches.length} entite(s) touchee(s)`);
  sim.stats.explosions = (sim.stats.explosions || 0) + 1; sim.stats.explosionsBlocs = (sim.stats.explosionsBlocs || 0) + liste.length;
  sim.vibrations?.emettre('explode', x, y, z, { source: opt.exclure ?? null });   // GameEvent.EXPLODE (frequence 15)
  const res = { detruits: liste.length, touches: touches.length, puissance: P, blocs: liste };
  if (sim.reg.aMonde('apresExplosion')) sim.reg.lancerMonde('apresExplosion', evenement({ centre: [x, y, z], puissance: P, blocsDetruits: liste.length, entites: touches }), sim.api);
  return res;
}
