// Explosion du jeu (Explosion.explode / ServerExplosion) : 1352 rayons sur la surface d'une grille 16x16x16, pas de 0,3, la puissance du rayon
// baisse de (resistance + 0,3) x 0,3 dans chaque bloc et de 0,225 par pas ; les blocs touches sont detruits, les TNT voisins amorces (meche courte),
// les entites dans le rayon 2 x puissance prennent des degats et du recul selon la distance et l'exposition.
// Port de Horizon client/game/explosion.rs et tnt.rs : MIT, voir ATTRIBUTIONS.md.
import { evenement } from './registre.js';
import { rayonBloc } from './collision.js';
const F = { TOUS: 3 };   // drapeaux de set_block (voir simulation.js)

export const NB_RAYONS = 1352;
const AIR = /^(cave_|void_)?air$/;

// Exposition d'une boite a l'explosion (Explosion.getSeenPercent) : part des points de la boite vus depuis le centre sans obstacle
function exposition(lec, centre, b) {
  const dx = 1 / ((b[3] - b[0]) * 2 + 1), dy = 1 / ((b[4] - b[1]) * 2 + 1), dz = 1 / ((b[5] - b[2]) * 2 + 1);
  const gx = (1 - Math.floor(1 / dx) * dx) / 2, gz = (1 - Math.floor(1 / dz) * dz) / 2;
  if (dx < 0 || dy < 0 || dz < 0) return 0;
  let vus = 0, tot = 0;
  for (let u = 0; u <= 1; u += dx) for (let v = 0; v <= 1; v += dy) for (let w = 0; w <= 1; w += dz) {
    const p = [b[0] + (b[3] - b[0]) * u + gx, b[1] + (b[4] - b[1]) * v, b[2] + (b[5] - b[2]) * w + gz];
    if (rayonBloc(lec, p, centre) === null) vus++;
    tot++;
  }
  return tot ? vus / tot : 0;
}

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
  // entites : acteurs dans le rayon 2 x puissance
  const R = P * 2, touches = [];
  if (sim.acteurs && R > 0) {
    for (const a of sim.acteurs.liste) {
      if (opt.exclure && a.nom === opt.exclure) continue;   // level.explode(source, ...) : la source n'est pas touchee (wither)
      const b = a.boite(), cx = a.x, cy = a.y + 0.5 * (b[4] - b[1]), cz = a.z;
      const dist = Math.hypot(cx - x, cy - y, cz - z) / R;
      if (dist > 1) continue;
      let ex = cx - x, ey = (a.y + (a.accroupi ? 1.27 : 1.62)) - y, ez = cz - z;
      const n = Math.hypot(ex, ey, ez);
      if (n === 0) continue;
      ex /= n; ey /= n; ez /= n;
      if (a.mort >= 0) continue;
      const ab = (1 - dist) * exposition(lec, [x, y, z], b);
      const degats = Math.floor((ab * ab + ab) / 2 * 7 * R + 1);
      if (ab <= 0) continue;
      if (ev.pousse) { a.vx += ex * ab; a.vy += ey * ab; a.vz += ez * ab; if (a.vy > 0) a.auSol = false; }
      touches.push(a.nom);
      sim.dire(`${a.nom} degats ${degats} (explosion), recul ${(ab).toFixed(2)}`);
      if (regles.valeur('vie.explosions', true)) a.degats(degats, 'explosion');
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
    sim.replay.particule(sim.temps, 'explosion', bx + sim.hasard.flottant(), by + sim.hasard.flottant(), bz + sim.hasard.flottant(), 0, 0, 0, 1);
    sim.replay.particule(sim.temps, 'smoke', bx + 0.5, by + 0.5, bz + 0.5, 0, 0, 0, 1);
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
  const grosse = P >= 2 && liste.length > 0;
  sim.replay.particule(sim.temps, grosse ? 'explosion_emitter' : 'explosion', x, y, z, 0, 0, 0, 1);
  sim.son('entity.generic.explode', x, y, z, 4, (1 + (sim.hasard.flottant() - sim.hasard.flottant()) * 0.2) * 0.7);
  sim.dire(`explosion p=${P} (${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}) : ${liste.length} blocs detruits, ${touches.length} entite(s) touchee(s)`);
  sim.stats.explosions = (sim.stats.explosions || 0) + 1; sim.stats.explosionsBlocs = (sim.stats.explosionsBlocs || 0) + liste.length;
  sim.vibrations?.emettre('explode', x, y, z, { source: opt.exclure ?? null });   // GameEvent.EXPLODE (frequence 15)
  const res = { detruits: liste.length, touches: touches.length, puissance: P, blocs: liste };
  if (sim.reg.aMonde('apresExplosion')) sim.reg.lancerMonde('apresExplosion', evenement({ centre: [x, y, z], puissance: P, blocsDetruits: liste.length, entites: touches }), sim.api);
  return res;
}
