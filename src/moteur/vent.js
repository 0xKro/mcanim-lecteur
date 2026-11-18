// Charges de vent (WindCharge du joueur, BreezeWindCharge du breeze) et leur rafale (ServerExplosion avec TRIGGER_BLOCK : aucun degat, aucun
// bloc casse, seulement le recul et les blocs qui reagissent). Port d'apres Horizon horizon-client/src/game/wind.rs et projectiles.rs (MIT,
// voir ATTRIBUTIONS.md) ; chiffres relus la : rayon 1,2 et recul x 1,22 (joueur), rayon 3 et recul x 1 (breeze).
//   - vol : droit, sans gravite ni frein (AbstractWindCharge : acceleration 0, inertie 1), boite 0,3125 posee 0,15 sous sa position ; au-dessus
//     de y = 350 elle eclate ; le souffle des explosions ne la pousse pas (ni une autre rafale) ;
//   - contact avec un vivant : 1 de degats (`wind_charge`, le breeze est insensible aux charges de breeze), puis la rafale au point de contact ;
//     avec un bloc : la rafale a 0,25 bloc devant la face ;
//   - la rafale : les rayons de l'explosion (1352, pas 0,3) que seuls #minecraft:blocks_wind_charge_explosions (barriere, bedrock) arretent ;
//     la liste dans l'ordre du HashSet de Java, melangee (Util.shuffle) ; recul de toutes les entites a 2 x rayon (pieds), (1 - d) x
//     exposition x multiplicateur, vers les yeux (objets au sol et supports d'armure ignores ; vehicules ignores par une charge de breeze sans
//     mobGriefing) ; un joueur repousse par une charge du joueur ne prend ses degats de chute que sous le point de la rafale (impulsion, 40
//     ticks de grace) ; portes et trappes (sauf en fer, porte : moitie basse seulement, pas alimentees), portillons (bascules sans se
//     retourner), boutons (pas enfonces), leviers, cloches (vers leur face) reagissent comme a la main ; les bougies s'eteignent ; la charge
//     d'un breeze ne fait reagir les blocs qu'avec mobGriefing ; son entity.wind_charge.wind_burst (breeze : entity.breeze.wind_burst), 4,
//     hauteur (1 + (r - r) x 0,2) x 0,7 ; particules gust_emitter_small (rayon < 2) ou gust_emitter_large.
import { ordreHashSet, melangerJeu } from './ordre-java.js';
import { exposition } from './explosion.js';
import { VEHICULES } from '../creatures/especes.js';

export const RAFALE = { vent: { rayon: 1.2, recul: 1.22 }, vent_breeze: { rayon: 3, recul: 1 } };
const ENTITES_POUSSEES = { tnt: [0.98, 0.98, 0], chute: [0.98, 0.98, Math.fround(0.98 * 0.85)], fleche: [0.5, 0.5, 0.13], trident: [0.5, 0.5, 0.13], boule: [0.25, 0.25, 0.2125], oeuf: [0.25, 0.25, 0.2125], perle: [0.25, 0.25, 0.2125], potion: [0.25, 0.25, 0.2125], petite_boule_feu: [0.3125, 0.3125, 0.265625], crane: [0.3125, 0.3125, 0.265625], boule_feu: [1, 1, 0.85], boule_dragon: [1, 1, 0.85], fusee: [0.25, 0.25, 0.2125] };

// la rafale ; type : 'vent' (joueur) ou 'vent_breeze'
export function rafale(sim, centre, type) {
  const { rayon, recul } = RAFALE[type], breeze = type === 'vent_breeze', d = sim.d;
  const griefing = sim.regles.valeur('ia.explosionCasse', true);
  sim.vibrations?.emettre('explode', centre[0], centre[1], centre[2], {});
  // positions (calculateExplodedPositions) : seuls les blocs du tag arretent le rayon
  const arrete = d.etiquette('#minecraft:blocks_wind_charge_explosions'), cellules = [];
  for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) for (let l = 0; l < 16; l++) {
    if (!(j === 0 || j === 15 || k === 0 || k === 15 || l === 0 || l === 15)) continue;
    let dx = j / 15 * 2 - 1, dy = k / 15 * 2 - 1, dz = l / 15 * 2 - 1;
    const g = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= g; dy /= g; dz /= g;
    let h = rayon * (0.7 + sim.hasard.flottant() * 0.6), x = centre[0], y = centre[1], z = centre[2];
    for (; h > 0; h -= 0.225) {
      const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z), e = sim.monde.etatEn(bx, by, bz);
      if (e < 0) break;
      if (arrete.has(d.blocDe(e))) h -= (3600000 + 0.3) * 0.3;
      if (h > 0) cellules.push([bx, by, bz]);
      x += dx * 0.3; y += dy * 0.3; z += dz * 0.3;
    }
  }
  const cibles = ordreHashSet(cellules);
  const lec = { d, etatEn: (a, b, c) => sim.monde.etatEn(a, b, c) }, R = rayon * 2;
  // recul (hurtEntities d'un calculateur sans degats)
  for (const a of sim.acteurs ? sim.acteurs.liste : []) {
    if (a.mort >= 0 || a.typeCreature === 'armor_stand') continue;
    if (VEHICULES.has(a.typeCreature) && breeze && !griefing) continue;
    const dist = Math.hypot(a.x - centre[0], a.y - centre[1], a.z - centre[2]) / R;
    if (dist > 1) continue;
    const o = a.oeil(), w = [o[0] - centre[0], o[1] - centre[1], o[2] - centre[2]], n = Math.hypot(...w);
    const res = Math.min(1, 0.15 * (a.protectionExplosion ?? 0));
    const k = (1 - dist) * exposition(lec, centre, a.boite()) * recul * (VEHICULES.has(a.typeCreature) ? 1 : 1 - res);
    if (n >= 1e-5) { a.vx += w[0] / n * k; a.vy += w[1] / n * k; a.vz += w[2] / n * k; if (a.vy > 0) a.auSol = false; }
    if (!a.typeCreature) a.impulsion = type === 'vent' ? { y: a.y, grace: 40 } : a.impulsion ? { ...a.impulsion, grace: 0 } : null;   // ServerPlayer.onExplosionHit
    sim.dire(`${a.nom} repousse par la rafale (${k.toFixed(3)})`);
  }
  for (const e of sim.entites ? sim.entites.liste : []) {
    const L = ENTITES_POUSSEES[e.type];
    if (!L || e.detruit || sim.entites._fini?.has(e) || (e.proj && e.plantee)) continue;
    const dist = Math.hypot(e.x - centre[0], e.y - centre[1], e.z - centre[2]) / R;
    if (dist > 1) continue;
    const b = [e.x - L[0] / 2, e.y, e.z - L[0] / 2, e.x + L[0] / 2, e.y + L[1], e.z + L[0] / 2];
    const w = [e.x - centre[0], e.y + L[2] - centre[1], e.z - centre[2]], n = Math.hypot(...w), k = (1 - dist) * exposition(lec, centre, b) * recul;
    if (n >= 1e-5) { e.vx += w[0] / n * k; e.vy += w[1] / n * k; e.vz += w[2] / n * k; }
  }
  // blocs qui reagissent (Explosion.canTriggerBlocks : la charge d'un breeze seulement avec mobGriefing)
  let reagis = 0;
  if (!breeze || griefing) {
    melangerJeu(cibles, sim.hasard);
    for (const [x, y, z] of cibles) if (declencher(sim, x, y, z)) { reagis++; sim.dire(`rafale : ${sim.d.chaine(sim.monde.etatEn(x, y, z))} en ${x},${y},${z}`); }
  }
  sim.son(breeze ? 'entity.breeze.wind_burst' : 'entity.wind_charge.wind_burst', centre[0], centre[1], centre[2], 4, (1 + (sim.hasard.flottant() - sim.hasard.flottant()) * 0.2) * 0.7);
  sim.replay.particule(sim.temps, rayon < 2 ? 'gust_emitter_small' : 'gust_emitter_large', centre[0], centre[1], centre[2], 1, 0, 0, 1);
  sim.stats.rafales = (sim.stats.rafales || 0) + 1;
  (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} rafale de ${breeze ? 'breeze' : 'charge de vent'} en ${centre.map((c) => c.toFixed(1)).join(',')} (${cibles.length} cellules, ${reagis} bloc(s) declenche(s))`);
}

// BlockBehaviour.onExplosionHit pour TRIGGER_BLOCK
function declencher(sim, x, y, z) {
  const e = sim.monde.etatEn(x, y, z);
  if (e < 0) return false;
  const nom = sim.d.nomBloc(e), p = sim.d.props(e);
  if (/candle(_cake)?$/.test(nom)) {   // AbstractCandleBlock.onExplosionHit : extinguish
    if (p.lit !== 'true') return false;
    sim.poser(x, y, z, sim.d.chaine(e).replace('lit=true', 'lit=false'), 11);
    sim.son('block.candle.extinguish', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    return true;
  }
  const declenche = ((/_door$/.test(nom) || /_trapdoor$/.test(nom)) && !/^iron_/.test(nom)) || /_fence_gate$/.test(nom) || /_button$/.test(nom) || nom === 'lever' || nom === 'bell';
  if (!declenche) return false;
  if (nom === 'bell') {   // BellBlock.onExplosionHit : attemptToRing sans direction (vers sa face)
    sim.api.blocEntite('cloche', x, y, z, ['down', 'up', 'north', 'south', 'west', 'east'].indexOf(p.facing));
    sim.son('block.bell.use', x + 0.5, y + 0.5, z + 0.5, sim.regles.valeur('cloche.portee', 2), 1);
    return true;
  }
  if (/_door$/.test(nom) && p.half !== 'lower') return false;
  if (p.powered === 'true' && nom !== 'lever') return false;
  const r = sim.utiliserBloc(x, y, z, { face: 'up', hit: [0.5, 0.5, 0.5], acteur: null, vent: true });
  return r === 'fait';
}

// AbstractWindCharge.onHitEntity / onHitBlock : P (Projectiles), e (la charge), pos (point du contact), acteur (touche) ou hit (bloc)
export function toucheVent(P, e, pos, acteur, hit) {
  const s = P.sim;
  let centre = pos;
  if (acteur) {
    const prop = s.acteurs?.parNom.get(e.proprietaire) ?? null;
    const insensible = e.type === 'vent_breeze' && (acteur.typeCreature === 'breeze' || acteur.ia?.type === 'breeze');
    if (!insensible) acteur.frappe(1, e.type === 'vent_breeze' ? 'mob:breeze' : 'vent', e.x - acteur.x, e.z - acteur.z, 0.4);   // recul 0,4 (wind_charge n'est pas dans #no_knockback)
    void prop;
  } else if (hit) centre = [pos[0] + hit.face[0] * 0.25, pos[1] + hit.face[1] * 0.25, pos[2] + hit.face[2] * 0.25];
  rafale(s, centre, e.type);
}
