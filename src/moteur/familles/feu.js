// Famille "feu" (bases) : un bloc de feu vieillit (age 0 a 15), se propage vers les blocs inflammables voisins selon les tables du jeu
// (igniteOdds / burnOdds de chaque bloc) et s'eteint sans combustible. Un TNT qui brule s'amorce. Port simplifie de FireBlock.tick
// (Horizon world/level/tick.rs : MIT, voir ATTRIBUTIONS.md). Ecarts : pas de pluie, pas de difficulte (valeur normale fixe), pas de feu sur les murs
// au-dela de la propagation par voisinage direct, pas de braises ni de fumee.
import { avec } from './_aide.js';

const COTES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];

export function installer(mc, regles) {
  regles.declarer('feu.actif', { def: true, doc: 'le feu vieillit, se propage et brule (jeu : oui)' });
  regles.declarer('feu.propagation', { def: 1, min: 0, max: 20, doc: 'facteur sur la propagation du feu aux blocs voisins (1 = jeu ; 0 = le feu ne se propage pas)' });

  const delai = (monde) => 30 + monde.hasard.entier(10);
  mc.bloc('FireBlock').sur('pose', (ev, monde) => { if (monde.regle('feu.actif', true)) monde.planifier(ev.pos[0], ev.pos[1], ev.pos[2], delai(monde)); });

  const brule = (monde, x, y, z, chance, age) => {   // FireBlock.checkBurnOut : le voisin part en fumee ou devient du feu
    const b = monde.bloc(x, y, z), odds = monde.feu(b.nom)[1];
    if (odds <= 0 || monde.hasard.entier(chance) >= odds) return;
    if (b.nom === 'minecraft:tnt') { monde.allumer(x, y, z, {}); return; }
    if (monde.hasard.entier(age + 10) < 5) monde.poser(x, y, z, avec({ nom: 'minecraft:fire', etat: { age: String(Math.min(15, age + (monde.hasard.entier(5) >> 2))), east: 'false', north: 'false', south: 'false', up: 'false', west: 'false' } }, {}));
    else monde.poser(x, y, z, 'minecraft:air');
  };

  mc.bloc('FireBlock').sur('tick', (ev, monde) => {
    if (!monde.regle('feu.actif', true)) return;
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z), age = Number(b.etat.age);
    const dessous = monde.bloc(x, y - 1, z), infini = /netherrack|magma_block/.test(dessous.nom);
    const combustible = COTES.some(([a, c, d]) => monde.feu(monde.bloc(x + a, y + c, z + d).nom)[0] > 0);
    const appui = monde.appui(x, y - 1, z, 'haut', 'plein');
    if (!appui && !combustible) { monde.poser(x, y, z, 'minecraft:air'); return; }
    if (!infini && age === 15 && monde.hasard.entier(4) === 0 && monde.feu(dessous.nom)[0] <= 0) { monde.poser(x, y, z, 'minecraft:air'); return; }
    const age2 = Math.min(15, age + (monde.hasard.entier(3) >> 1));
    if (age2 !== age) monde.poser(x, y, z, avec(b, { age: String(age2) }), 4);
    monde.planifier(x, y, z, delai(monde));
    if (!infini && !combustible && (!appui || age > 3)) { monde.poser(x, y, z, 'minecraft:air'); return; }
    const prop = monde.regle('feu.propagation', 1);
    if (prop <= 0) return;
    for (const [a, c, d] of COTES) brule(monde, x + a, y + c, z + d, c !== 0 ? 250 : 300, age2);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 4; dy++) {
      if (!dx && !dz && !dy) continue;
      const px = x + dx, py = y + dy, pz = z + dz;
      if (monde.bloc(px, py, pz).nom !== 'minecraft:air') continue;
      let odds = 0;
      for (const [a, c, e] of COTES) odds = Math.max(odds, monde.feu(monde.bloc(px + a, py + c, pz + e).nom)[0]);
      if (odds <= 0) continue;
      const n = dy > 1 ? 100 + (dy - 1) * 100 : 100, r = Math.floor((odds + 54) * prop / (age2 + 30));
      if (r > 0 && monde.hasard.entier(n) <= r) monde.poser(px, py, pz, 'minecraft:fire[age=' + Math.min(15, age2 + (monde.hasard.entier(5) >> 2)) + ']');
    }
  });

  // ---- briquet et charge de feu sur une face (FlintAndSteelItem.useOn, FireChargeItem.useOn) : evenement du monde `objet.utilise` ----
  // Le feu est pose dans la case voisine de la face visee (la face du dessus : le feu sur le bloc) s'il y tient : sol plein dessous ou voisin inflammable.
  const DIR = { up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };
  mc.monde.sur('objet.utilise', (ev, monde) => {
    if (ev.objet !== 'flint_and_steel' && ev.objet !== 'fire_charge') return;
    if (!monde.regle('feu.actif', true)) { ev.raison = 'le feu est coupe (regle feu.actif)'; return; }
    const v = DIR[ev.face] || DIR.up, [cx, cy, cz] = [ev.pos[0] + v[0], ev.pos[1] + v[1], ev.pos[2] + v[2]];
    if (monde.bloc(cx, cy, cz).nom !== 'minecraft:air') { ev.raison = 'la case ' + [cx, cy, cz].join(',') + ' est occupee'; return; }
    const sous = monde.bloc(cx, cy - 1, cz), appui = monde.appui(cx, cy - 1, cz, 'haut', 'plein') || monde.feu(sous.nom)[1] > 0;
    const voisinInflammable = COTES.some(([a, c, d]) => monde.feu(monde.bloc(cx + a, cy + c, cz + d).nom)[0] > 0);
    if (!appui && !voisinInflammable) { ev.raison = "le feu ne tient pas ici (rien dessous, rien d'inflammable autour)"; return; }
    monde.son(ev.objet === 'flint_and_steel' ? 'item.flintandsteel.use' : 'item.firecharge.use', cx + 0.5, cy + 0.5, cz + 0.5, 1, monde.hasard.flottant() * 0.4 + 0.8);
    // BaseFireBlock.getState : feu d'ame sur du sable ou de la terre d'ame ; sinon les cotes inflammables s'allument quand il n'y a pas d'appui
    let etat;
    if (monde.estDans(cx, cy - 1, cz, '#minecraft:soul_fire_base_blocks')) etat = 'minecraft:soul_fire';
    else if (appui) etat = 'minecraft:fire[age=0]';
    else {
      const f = (a, c, d) => String(monde.feu(monde.bloc(cx + a, cy + c, cz + d).nom)[0] > 0);
      etat = `minecraft:fire[age=0,east=${f(1, 0, 0)},north=${f(0, 0, -1)},south=${f(0, 0, 1)},up=${f(0, 1, 0)},west=${f(-1, 0, 0)}]`;
    }
    monde.poser(cx, cy, cz, etat, 11);
    ev.fait = true;
    if (ev.objet === 'fire_charge') ev.nouvelObjet = null;
  });
}
