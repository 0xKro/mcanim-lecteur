// Famille "oeufs" : les blocs qui eclosent (ecrite avec la meme API que les mods). Nombres verifies dans Horizon (MIT, `_ref/horizon/crates/`) :
//   oeuf de tortue (TurtleEggBlock.randomTick, horizon-world/src/level/timeline.rs `turtle_egg_tick`, `turtle_hatch_chance`) : au tick
//     aleatoire, chance 1,0 quand l'heure du jour (ticks du jour, timeline `minecraft:day`) est dans [21062, 21905[ (3 h 04 a 3 h 54),
//     sinon 0,002 (nextFloat() < chance) ; puis sur #sand seulement : hatch + 1 (son entity.turtle.egg_crack 0,7), a 2 : son
//     entity.turtle.egg_hatch, le bloc disparait, un bebe par oeuf en (x + 0,3 + 0,2 i, y, z + 0,3), age -24000, lacet 0, plage = l'oeuf
//     (horizon-client/src/game/creatures.rs `hatch_turtles`)
//   frai (FrogspawnBlock, level/hooks.rs : `next_int_between(3600, 12000)`) : a la pose, un tick dans 3600 + [0, 8400[ ; il eclot en
//     2 + [0, 4[ tetards a (x + 0,2 + 0,6 f, y - 0,5, z + 0,2 + 0,6 f) (game.rs, `hatch`), son block.frogspawn.hatch
//   oeuf de renifleur (SnifferEggBlock, level/hooks.rs et timeline.rs `sniffer_egg_tick`) : a la pose, un tick dans 24000 / 3 (12000 / 3 sur
//     un bloc de mousse) + [0, 300[ ; crack (0,7) deux fois, puis hatch : un bebe (age -48000) au centre du bloc (+0,5), lacet au hasard
//     (game/sniffers.rs `hatch_sniffer`)
// `croissance.vitesse` (lapse de temps) accelere les ticks aleatoires (simulation.js) et raccourcit ici les delais planifies.

// ticks du jour (0 = 6 h, 6000 = midi, 18000 = minuit) depuis l'heure de la scene
export const ticksDuJour = (heure) => Math.floor(((((heure - 6) % 24) + 24) % 24) * 1000) % 24000;
export const FENETRE_TORTUE = [21062, 21905];
export function chanceEclosionTortue(heure) { const t = ticksDuJour(heure); return t >= FENETRE_TORTUE[0] && t < FENETRE_TORTUE[1] ? 1.0 : 0.002; }

export function installer(mc) {
  const delai = (monde, n) => Math.max(1, Math.round(n / Math.max(1e-6, monde.regle('croissance.vitesse', 1))));
  const avec = (b, k, v) => b.etat ? `${b.nom}[${Object.entries({ ...b.etat, [k]: String(v) }).map(([a, c]) => `${a}=${c}`).join(',')}]` : b.nom;
  // ---- oeuf de tortue
  mc.bloc('turtle_egg').sur('tickAleatoire', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z), chance = chanceEclosionTortue(monde.heure());
    if (!(chance > 0 && monde.hasard.flottant() < chance)) return;
    if (!/(^|:)(sand|red_sand|suspicious_sand)$/.test(monde.bloc(x, y - 1, z).nom)) return;   // #minecraft:sand
    const hatch = Number(b.etat.hatch ?? 0), n = Number(b.etat.eggs ?? 1), ton = 0.9 + monde.hasard.flottant() * 0.2;
    if (hatch < 2) { monde.son('entity.turtle.egg_crack', x + 0.5, y + 0.5, z + 0.5, 0.7, ton); monde.poser(x, y, z, avec(b, 'hatch', hatch + 1), 2); monde.dire(`oeuf de tortue ${x},${y},${z} : hatch ${hatch + 1}`); return; }
    monde.son('entity.turtle.egg_hatch', x + 0.5, y + 0.5, z + 0.5, 0.7, ton);
    monde.poser(x, y, z, 'minecraft:air', 3);
    for (let j = 0; j < n; j++) {
      monde.particule('block_break|minecraft:turtle_egg', x + 0.5, y + 0.3, z + 0.5, 0, 0, 0, 1);
      monde.naitre({ type: 'turtle', bebe: true, x: x + 0.3 + j * 0.2, y, z: z + 0.3, lacet: 0, raison: 'eclosion', nom: 'tortue_bebe', gabaritParent: { l: 1.2, h: 0.4, oeil: 0.32, vitesse: 1 }, ia: { maison: [x, y, z] } });
    }
    monde.dire(`oeuf de tortue ${x},${y},${z} : ${n} bebe(s)`);
  });
  // ---- frai de grenouille
  mc.bloc('frogspawn').sur('pose', (ev, monde) => { if (!ev.memeBloc) monde.planifier(ev.pos[0], ev.pos[1], ev.pos[2], delai(monde, 3600 + monde.hasard.entier(8400))); });
  mc.bloc('frogspawn').sur('tick', (ev, monde) => {
    const [x, y, z] = ev.pos;
    monde.son('block.frogspawn.hatch', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    monde.poser(x, y, z, 'minecraft:air', 3);
    const n = 2 + monde.hasard.entier(4);
    for (let i = 0; i < n; i++) {
      const o = () => monde.hasard.flottant() * 0.6 + 0.2;   // getRandomTadpolePositionOffset
      const dx = o(), dz = o();
      monde.naitre({ type: 'tadpole', x: x + dx, y: y - 0.5, z: z + dz, lacet: 1 + monde.hasard.entier(360), raison: 'eclosion', nom: 'tetard', gabaritParent: { l: 0.4, h: 0.3, oeil: 0.19, vitesse: 1 }, ia: {} });
    }
    monde.dire(`frai ${x},${y},${z} : ${n} tetards`);
  });
  // ---- oeuf de renifleur
  const planifierRenifleur = (monde, x, y, z) => { const boost = /^moss_block$/.test(monde.bloc(x, y - 1, z).nom.replace('minecraft:', '')); monde.planifier(x, y, z, delai(monde, (boost ? 12000 : 24000) / 3 + monde.hasard.entier(300))); if (boost) for (let i = 0; i < 6; i++) monde.particule('happy_villager', x + monde.hasard.reel(), y + 0.5, z + monde.hasard.reel(), 0, 0, 0, 1); };
  mc.bloc('sniffer_egg').sur('pose', (ev, monde) => planifierRenifleur(monde, ...ev.pos));
  mc.bloc('sniffer_egg').sur('tick', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z), hatch = Number(b.etat.hatch ?? 0), ton = 0.9 + monde.hasard.flottant() * 0.2;
    if (hatch < 2) { monde.son('block.sniffer_egg.crack', x + 0.5, y + 0.5, z + 0.5, 0.7, ton); monde.poser(x, y, z, avec(b, 'hatch', hatch + 1), 2); return; }   // le nouvel etat repasse par `pose` (onPlace) : prochain tick
    monde.son('block.sniffer_egg.hatch', x + 0.5, y + 0.5, z + 0.5, 0.7, ton);
    monde.poser(x, y, z, 'minecraft:air', 3);
    const lacet = monde.hasard.flottant() * 360 - 180;
    monde.naitre({ type: 'sniffer', bebe: true, x: x + 0.5, y: y + 0.5, z: z + 0.5, lacet, raison: 'eclosion', nom: 'renifleur_bebe', gabaritParent: { l: 1.9, h: 1.75, oeil: 1.05, vitesse: 1 }, ia: { age: -48000 } });
    monde.dire(`oeuf de renifleur ${x},${y},${z} : un bebe`);
  });
}
