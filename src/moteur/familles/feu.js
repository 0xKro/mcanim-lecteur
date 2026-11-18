// Famille "feu" : un bloc de feu vieillit (age 0 a 15), se propage vers les blocs inflammables voisins selon les tables du jeu
// (igniteOdds / burnOdds de chaque bloc), s'eteint sous la pluie ou sans combustible ; un TNT qui brule s'amorce. Port de FireBlock.tick tel
// que Horizon l'ecrit (horizon-world level/tick.rs fire_tick, fire_check_burn_out : MIT, voir ATTRIBUTIONS.md), dans le meme ordre de tirages :
//   tick replanifie (30 + 0..9) ; regle doFireTick (feu.actif) ; le feu qui ne tient plus est retire (et le tick continue, comme le jeu) ;
//   sol #minecraft:infiniburn_overworld : jamais eteint ; pluie ici ou a cote (O, E, N, S) : retire avec la chance 0,2 + age x 0,03 ;
//   age + 0..2 / 2 ; sans voisin inflammable : retire si le dessous n'est pas plein ou age > 3 ; age 15 : une chance sur 4 de s'eteindre si le
//   dessous ne brule pas ; voisins brules (E, O, bas, haut, N, S : 300 / 250, 50 de moins dans un biome humide : increased_fire_burnout de
//   jungle, jungle de bambous, marais, marais de mangrove, champignons, pics geles, pics dentels, pentes enneigees, donnees du jeu 26.3) ;
//   propagation dans 3 x 6 x 3 : (allumage + 40 + difficulte x 7) / (age + 30) (divise par 2 dans un biome humide), pas sous la pluie.
// Un bloc gorge d'eau (waterlogged) ne brule pas (FireBlock.getBurnOdds / getIgniteOdds).
import { avec } from './_aide.js';

const COTES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
// FireBlock.tick : checkBurnOut est, ouest, bas, haut, nord, sud
const BRULE = [[1, 0, 0, 300], [-1, 0, 0, 300], [0, -1, 0, 250], [0, 1, 0, 250], [0, 0, -1, 300], [0, 0, 1, 300]];
const DIFFICULTE = { paisible: 0, peaceful: 0, facile: 1, easy: 1, normal: 2, difficile: 3, hard: 3 };
export const BIOMES_HUMIDES = new Set(['jungle', 'bamboo_jungle', 'swamp', 'mangrove_swamp', 'mushroom_fields', 'frozen_peaks', 'jagged_peaks', 'snowy_slopes']);

export function installer(mc, regles) {
  regles.declarer('feu.actif', { def: true, doc: 'le feu vieillit, se propage et brule (regle doFireTick du jeu : oui)' });
  regles.declarer('feu.propagation', { def: 1, min: 0, max: 20, doc: 'facteur sur la propagation du feu aux blocs voisins (1 = jeu ; 0 = le feu ne se propage pas)' });

  const delai = (monde) => 30 + monde.hasard.entier(10);
  mc.bloc('FireBlock').sur('pose', (ev, monde) => { monde.planifier(ev.pos[0], ev.pos[1], ev.pos[2], delai(monde)); });

  const sec = (b) => b.etat?.waterlogged !== 'true';
  const allumage = (monde, b) => (sec(b) ? monde.feu(b.nom)[0] : 0);   // FireBlock.getIgniteOdds(state)
  const combustion = (monde, b) => (sec(b) ? monde.feu(b.nom)[1] : 0); // FireBlock.getBurnOdds(state)
  const vide = (b) => /^minecraft:(cave_|void_)?air$/.test(b.nom);
  const plein = (monde, x, y, z) => monde.appui(x, y, z, 'haut', 'plein');
  const lieuValide = (monde, x, y, z) => COTES.some(([a, c, d]) => allumage(monde, monde.bloc(x + a, y + c, z + d)) > 0);   // isValidFireLocation
  const presDeLaPluie = (monde, x, y, z) => monde.pleut(x, y, z) || monde.pleut(x - 1, y, z) || monde.pleut(x + 1, y, z) || monde.pleut(x, y, z - 1) || monde.pleut(x, y, z + 1);
  // FireBlock.getStateWithAge -> BaseFireBlock.getState : feu d'ame sur sa base ; sinon les cotes inflammables s'allument quand le dessous ne porte pas
  const etatFeu = (monde, x, y, z, age) => {
    if (monde.estDans(x, y - 1, z, '#minecraft:soul_fire_base_blocks')) return 'minecraft:soul_fire';
    const sous = monde.bloc(x, y - 1, z);
    if (allumage(monde, sous) > 0 || plein(monde, x, y - 1, z)) return 'minecraft:fire[age=' + age + ']';
    const f = (a, c, d) => String(allumage(monde, monde.bloc(x + a, y + c, z + d)) > 0);
    return 'minecraft:fire[age=' + age + ',east=' + f(1, 0, 0) + ',north=' + f(0, 0, -1) + ',south=' + f(0, 0, 1) + ',up=' + f(0, 1, 0) + ',west=' + f(-1, 0, 0) + ']';
  };
  // FireBlock.checkBurnOut : le voisin part en fumee ou devient du feu ; un TNT brule s'amorce
  const brule = (monde, x, y, z, chance, age) => {
    const b = monde.bloc(x, y, z);
    if (monde.hasard.entier(chance) >= combustion(monde, b)) return;
    const tnt = b.nom === 'minecraft:tnt';
    if (monde.hasard.entier(age + 10) < 5 && !monde.pleut(x, y, z)) {
      const a = Math.min(15, age + Math.floor(monde.hasard.entier(5) / 4));
      if (tnt) monde.allumer(x, y, z, {});
      monde.poser(x, y, z, etatFeu(monde, x, y, z, a), 3);
    } else {
      if (tnt) monde.allumer(x, y, z, {});
      monde.poser(x, y, z, 'minecraft:air', 3);
    }
  };

  mc.bloc('FireBlock').sur('tick', (ev, monde) => {
    const [x, y, z] = ev.pos;
    monde.planifier(x, y, z, delai(monde));
    if (!monde.regle('feu.actif', true)) return;
    let b = monde.bloc(x, y, z);
    if (!plein(monde, x, y - 1, z) && !lieuValide(monde, x, y, z)) monde.poser(x, y, z, 'minecraft:air', 3);   // canSurvive (le tick continue)
    const sous = monde.bloc(x, y - 1, z), infini = monde.estDans(x, y - 1, z, '#minecraft:infiniburn_overworld');
    const age = Number(b.etat.age ?? 0);
    if (!infini && presDeLaPluie(monde, x, y, z) && monde.hasard.flottant() < 0.2 + age * 0.03) { monde.poser(x, y, z, 'minecraft:air', 3); return; }
    const age2 = Math.min(15, age + Math.floor(monde.hasard.entier(3) / 2));
    if (age2 !== age) { b = avec(b, { age: String(age2) }); monde.poser(x, y, z, b, 4); }
    if (!infini) {
      if (!lieuValide(monde, x, y, z)) { if (!plein(monde, x, y - 1, z) || age > 3) monde.poser(x, y, z, 'minecraft:air', 3); return; }
      if (age === 15 && monde.hasard.entier(4) === 0 && allumage(monde, sous) <= 0) { monde.poser(x, y, z, 'minecraft:air', 3); return; }
    }
    const humide = BIOMES_HUMIDES.has(String(monde.biome(x, y, z) ?? '').replace(/^minecraft:/, '')), moins = humide ? -50 : 0;
    const prop = monde.regle('feu.propagation', 1);
    if (prop <= 0) return;   // regle du film (pas du jeu) : 0 coupe la combustion des voisins et la propagation
    for (const [a, c, d, chance] of BRULE) brule(monde, x + a, y + c, z + d, chance + moins, age);
    const dif = DIFFICULTE[monde.regle('monde.difficulte', 'normal')] ?? 2;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 4; dy++) {
      if (!dx && !dz && !dy) continue;
      const px = x + dx, py = y + dy, pz = z + dz, n = dy > 1 ? 100 + (dy - 1) * 100 : 100;
      if (!vide(monde.bloc(px, py, pz))) continue;   // FireBlock.getIgniteOdds(level, pos) : de l'air seulement
      let odds = 0;
      for (const [a, c, e] of COTES) odds = Math.max(odds, allumage(monde, monde.bloc(px + a, py + c, pz + e)));
      if (odds <= 0) continue;
      let r = Math.floor((odds + 40 + dif * 7) * prop / (age + 30));
      if (humide) r = Math.floor(r / 2);
      if (r > 0 && monde.hasard.entier(n) <= r && !presDeLaPluie(monde, px, py, pz)) monde.poser(px, py, pz, etatFeu(monde, px, py, pz, Math.min(15, age + Math.floor(monde.hasard.entier(5) / 4))), 3);
    }
  });

  // ---- briquet et charge de feu sur une face (FlintAndSteelItem.useOn, FireChargeItem.useOn) : evenement du monde `objet.utilise` ----
  // Le feu est pose dans la case voisine de la face visee (la face du dessus : le feu sur le bloc) s'il y tient : sol plein dessous ou voisin inflammable.
  const DIR = { up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };
  mc.monde.sur('objet.utilise', (ev, monde) => {
    if (ev.objet !== 'flint_and_steel' && ev.objet !== 'fire_charge') return;
    if (!monde.regle('feu.actif', true)) { ev.raison = 'le feu est coupe (regle feu.actif)'; return; }
    const v = DIR[ev.face] || DIR.up, [cx, cy, cz] = [ev.pos[0] + v[0], ev.pos[1] + v[1], ev.pos[2] + v[2]];
    if (!vide(monde.bloc(cx, cy, cz))) { ev.raison = 'la case ' + [cx, cy, cz].join(',') + ' est occupee'; return; }
    // BaseFireBlock.canBePlacedAt -> FireBlock.canSurvive : dessous plein, ou un voisin qui peut bruler
    if (!plein(monde, cx, cy - 1, cz) && !lieuValide(monde, cx, cy, cz) && !monde.estDans(cx, cy - 1, cz, '#minecraft:soul_fire_base_blocks')) { ev.raison = "le feu ne tient pas ici (rien dessous, rien d'inflammable autour)"; return; }
    monde.son(ev.objet === 'flint_and_steel' ? 'item.flintandsteel.use' : 'item.firecharge.use', cx + 0.5, cy + 0.5, cz + 0.5, 1, monde.hasard.flottant() * 0.4 + 0.8);
    monde.poser(cx, cy, cz, etatFeu(monde, cx, cy, cz, 0), 11);
    ev.fait = true;
    if (ev.objet === 'fire_charge') ev.nouvelObjet = null;
  });
}
