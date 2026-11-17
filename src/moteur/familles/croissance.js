// Famille "croissance" : cultures, terre labouree, pousses -> arbres, herbe qui se propage, feuilles qui meurent, canne a sucre, cactus, bambou, lierre, farine d'os,
// houe et graines. Ecrite avec la meme API que les mods ; les nombres sont ceux du jeu (Horizon world/level/{tick,growth,bonemeal}.rs : MIT, voir ATTRIBUTIONS.md).
//   culture : au tick aleatoire, si la lumiere >= 9 : age + 1 avec la chance 1 / (floor(25 / vitesse) + 1) ; vitesse = 1 + somme sur les 9 blocs du dessous (terre labouree : 1, humide : 3,
//             divise par 4 hors du bloc du dessous) ; divisee par 2 si la meme culture est en ligne ET en colonne, ou en diagonale ; betterave : une chance sur 3 d'essayer seulement
//   terre labouree : humidite 7 si de l'eau est dans le cube (-4..4, 0..1, -4..4) ou s'il pleut ; sinon -1 par tick aleatoire ; a 0 elle redevient de la terre (sauf culture dessus)
//   pousse : lumiere >= 9 au-dessus, 1 chance sur 7 ; stade 0 -> 1, puis l'arbre ; feuilles : distance au bois (1 au contact, 7 : meurt au tick aleatoire sauf `persistent`)
//   herbe : meurt sous un bloc opaque, se propage 4 essais par tick aleatoire sur la terre voisine ; canne : age 15 -> un cran au-dessus (3 au plus) ; cactus idem ; bambou : 1 chance sur 3
//   `croissance.vitesse` : multiplie le nombre de ticks aleatoires par section et par tick (monde.ticksAleatoires x vitesse) ; les nombres du jeu ne changent pas (lapse de temps)
import { avec, court, etatTexte } from './_aide.js';

const CULTURES = { wheat: 7, carrots: 7, potatoes: 7, beetroots: 3 };
const GRAINES = { wheat_seeds: 'wheat', carrot: 'carrots', potato: 'potatoes', beetroot_seeds: 'beetroots' };
const COTES = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
const SAPLINGS = { oak_sapling: 'oak', birch_sapling: 'birch', spruce_sapling: 'spruce', jungle_sapling: 'jungle_tree', acacia_sapling: 'acacia', cherry_sapling: 'cherry', dark_oak_sapling: 'dark_oak' };
const estBois = (nom) => /(_log|_wood)$/.test(nom);

export function installer(mc, regles) {
  regles.declarer('croissance.actif', { def: true, doc: 'les plantes poussent, l\'herbe se propage, les feuilles meurent (jeu : oui)' });
  regles.declarer('croissance.vitesse', { def: 1, min: 0, max: 100000, doc: 'multiplicateur de la croissance (lapse de temps) : le nombre de ticks aleatoires par section et par tick est multiplie (jeu : 3) ; 1 = le jeu, 200 = un champ de ble mur en une dizaine de secondes' });
  regles.declarer('croissance.cultures', { def: true, doc: 'ble, carottes, pommes de terre, betteraves poussent (formule du jeu : 1 chance sur floor(25 / vitesse) + 1)' });
  regles.declarer('croissance.arbres', { def: true, doc: 'les pousses deviennent des arbres (1 chance sur 7 par tick aleatoire, lumiere >= 9, deux stades)' });
  regles.declarer('croissance.herbe', { def: true, doc: 'l\'herbe se propage sur la terre voisine et meurt sous un bloc opaque (jeu : oui)' });
  regles.declarer('croissance.feuilles', { def: true, doc: 'les feuilles sans bois a moins de 6 blocs meurent (distance 7) et lachent leurs objets' });
  regles.declarer('croissance.lumiereMin', { def: 9, min: 0, max: 15, entier: true, doc: 'lumiere minimale au-dessus d\'une plante pour qu\'elle pousse (jeu : 9)' });
  regles.declarer('croissance.farineOs', { def: 1, min: 0, max: 100, doc: 'multiplicateur des crans de croissance de la farine d\'os (jeu : 1 ; ble : 2 a 5 crans)' });

  // `croissance.vitesse` agit sur le NOMBRE de ticks aleatoires par section et par tick (simulation.js) : le monde pousse plus vite, chaque tick garde les nombres du jeu
  const fois = () => 1;
  const actif = (monde) => monde.regle('croissance.actif', true);
  const lumiereMax = (monde, x, y, z) => { const l = monde.lumiere(x, y, z); return Math.max(l.bloc, l.ciel); };
  const lumOk = (monde, x, y, z) => lumiereMax(monde, x, y, z) >= monde.regle('croissance.lumiereMin', 9);
  const d = mc.donnees;
  const opaque = (monde, x, y, z) => { const b = monde.bloc(x, y, z); return b.id < 0 ? 15 : d.opacite(b.id); };

  // ---------------------------------------------------------------- vitesse de croissance d'une culture (CropBlock.getGrowthSpeed)
  const vitesseCulture = (monde, x, y, z, nom) => {
    let v = 1;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const s = monde.bloc(x + dx, y - 1, z + dz);
      let k = 0;
      if (s.nom === 'minecraft:farmland') { k = 1; if (Number(s.etat.moisture) > 0) k = 3; }
      if (dx !== 0 || dz !== 0) k /= 4;
      v += k;
    }
    const meme = (a, c) => monde.bloc(a, y, c).nom === 'minecraft:' + nom;
    const horiz = meme(x - 1, z) || meme(x + 1, z), vert = meme(x, z - 1) || meme(x, z + 1);
    const diag = meme(x - 1, z - 1) || meme(x + 1, z - 1) || meme(x + 1, z + 1) || meme(x - 1, z + 1);
    if ((horiz && vert) || diag) v /= 2;
    return Math.fround(v);
  };
  mc.monde.sur('croissance.vitesseCulture', (ev, monde) => { ev.vitesse = vitesseCulture(monde, ev.pos[0], ev.pos[1], ev.pos[2], ev.nom); });

  // ---------------------------------------------------------------- cultures (CropBlock.randomTick)
  mc.bloc('CropBlock').sur('tickAleatoire', (ev, monde) => {
    if (!actif(monde) || !monde.regle('croissance.cultures', true)) return;
    const [x, y, z] = ev.pos;
    for (let i = fois(monde); i > 0; i--) {
      const b = monde.bloc(x, y, z), nom = court(b.nom), max = CULTURES[nom];
      if (max === undefined) return;
      if (nom === 'beetroots' && monde.hasard.entier(3) !== 0) continue;        // BeetrootBlock.randomTick
      if (!lumOk(monde, x, y, z)) continue;
      const age = Number(b.etat.age);
      if (age >= max) return;
      const vit = vitesseCulture(monde, x, y, z, nom);
      if (monde.hasard.entier(Math.floor(Math.fround(25 / vit)) + 1) === 0) monde.poser(x, y, z, avec(b, { age: age + 1 }), 2);
    }
  });

  // ---------------------------------------------------------------- terre labouree (FarmBlock.randomTick)
  const eauProche = (monde, x, y, z) => {
    for (let dx = -4; dx <= 4; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = -4; dz <= 4; dz++) if (monde.fluide(x + dx, y + dy, z + dz).type === 'water') return true;
    return false;
  };
  mc.bloc('FarmlandBlock').sur('tickAleatoire', (ev, monde) => {
    if (!actif(monde)) return;
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z), m = Number(b.etat.moisture);
    if (!eauProche(monde, x, y, z) && !monde.pleut(x, y + 1, z)) {
      if (m > 0) monde.poser(x, y, z, avec(b, { moisture: m - 1 }), 2);
      else {
        const dessus = monde.bloc(x, y + 1, z);
        if (!mc.donnees.etiquette('maintains_farmland').has(d.idBloc(court(dessus.nom)))) monde.poser(x, y, z, 'minecraft:dirt', 3);
      }
    } else if (m < 7) monde.poser(x, y, z, avec(b, { moisture: 7 }), 2);
  });

  // ---------------------------------------------------------------- pousses -> arbres (SaplingBlock.randomTick / advanceTree)
  const avancerArbre = (monde, x, y, z) => {
    const b = monde.bloc(x, y, z), espece = SAPLINGS[court(b.nom)];
    if (!espece) return;
    if (Number(b.etat.stage) === 0) { monde.poser(x, y, z, avec(b, { stage: 1 }), 4); return; }
    monde.arbre(x, y, z, espece);
  };
  mc.bloc('SaplingBlock').sur('tickAleatoire', (ev, monde) => {
    if (!actif(monde) || !monde.regle('croissance.arbres', true)) return;
    const [x, y, z] = ev.pos;
    for (let i = fois(monde); i > 0; i--) {
      if (!SAPLINGS[court(monde.bloc(x, y, z).nom)]) return;
      if (lumiereMax(monde, x, y + 1, z) >= 9 && monde.hasard.entier(7) === 0) avancerArbre(monde, x, y, z);
    }
  });

  // ---------------------------------------------------------------- herbe (SpreadingSnowyBlock.randomTick)
  const peutEtreHerbe = (monde, x, y, z) => {
    const dessus = monde.bloc(x, y + 1, z);
    if (dessus.nom === 'minecraft:snow' && Number(dessus.etat.layers) === 1) return true;
    const f = monde.fluide(x, y + 1, z);
    if (f.type && f.quantite === 8) return false;
    return opaque(monde, x, y + 1, z) < 15;
  };
  mc.bloc('GrassBlock').sur('tickAleatoire', (ev, monde) => {
    if (!actif(monde) || !monde.regle('croissance.herbe', true)) return;
    const [x, y, z] = ev.pos;
    for (let i = fois(monde); i > 0; i--) {
      if (monde.bloc(x, y, z).nom !== 'minecraft:grass_block') return;
      if (!peutEtreHerbe(monde, x, y, z)) { monde.poser(x, y, z, 'minecraft:dirt', 3); return; }
      if (lumiereMax(monde, x, y + 1, z) < 9) continue;
      for (let k = 0; k < 4; k++) {
        const tx = x + monde.hasard.entier(3) - 1, ty = y + monde.hasard.entier(5) - 3, tz = z + monde.hasard.entier(3) - 1;
        if (monde.bloc(tx, ty, tz).nom !== 'minecraft:dirt') continue;
        if (!peutEtreHerbe(monde, tx, ty, tz) || monde.fluide(tx, ty + 1, tz).type === 'water') continue;
        monde.poser(tx, ty, tz, `minecraft:grass_block[snowy=${monde.bloc(tx, ty + 1, tz).nom === 'minecraft:snow'}]`, 3);
      }
    }
  });

  // ---------------------------------------------------------------- feuilles (LeavesBlock : distance au bois, mort)
  const distanceFeuille = (monde, x, y, z) => {
    let dist = 7;
    for (const [a, b, c] of COTES) {
      const n = monde.bloc(x + a, y + b, z + c);
      const k = estBois(court(n.nom)) ? 0 : /_leaves$/.test(n.nom) ? Number(n.etat.distance) : 7;
      dist = Math.min(dist, k + 1);
    }
    return dist;
  };
  const planifierFeuille = (ev, monde) => { if (monde.regle('croissance.feuilles', true)) monde.planifier(ev.pos[0], ev.pos[1], ev.pos[2], 1); };
  mc.bloc('LeavesBlock').sur('forme', (ev, monde) => { planifierFeuille(ev, monde); return ev.etat; });
  mc.bloc('LeavesBlock').sur('pose', planifierFeuille);
  mc.bloc('LeavesBlock').sur('tick', (ev, monde) => {
    if (!monde.regle('croissance.feuilles', true)) return;
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z), dist = distanceFeuille(monde, x, y, z);
    if (Number(b.etat.distance) !== dist) monde.poser(x, y, z, avec(b, { distance: dist }), 3);
  });
  mc.bloc('LeavesBlock').sur('tickAleatoire', (ev, monde) => {
    if (!actif(monde) || !monde.regle('croissance.feuilles', true)) return;
    const [x, y, z] = ev.pos;
    for (let i = fois(monde); i > 0; i--) {
      const b = monde.bloc(x, y, z);
      if (!/_leaves$/.test(b.nom)) return;
      if (b.etat.persistent === 'false' && Number(b.etat.distance) === 7) { monde.butin(x, y, z, { source: 'decay' }); monde.poser(x, y, z, 'minecraft:air', 3); return; }
    }
  });

  // ---------------------------------------------------------------- canne a sucre et cactus (age 15 : un bloc de plus, 3 au plus)
  const pousseColonne = (nomBloc) => (ev, monde) => {
    if (!actif(monde)) return;
    const [x, y, z] = ev.pos;
    for (let i = fois(monde); i > 0; i--) {
      const b = monde.bloc(x, y, z);
      if (b.nom !== nomBloc) return;
      if (monde.bloc(x, y + 1, z).nom !== 'minecraft:air') return;
      let h = 1;
      while (monde.bloc(x, y - h, z).nom === nomBloc) h++;
      if (h >= 3) return;
      const age = Number(b.etat.age);
      if (age === 15) { monde.poser(x, y + 1, z, nomBloc, 3); monde.poser(x, y, z, avec(b, { age: 0 }), 260); } else monde.poser(x, y, z, avec(b, { age: age + 1 }), 260);
    }
  };
  mc.bloc('SugarCaneBlock').sur('tickAleatoire', pousseColonne('minecraft:sugar_cane'));
  mc.bloc('CactusBlock').sur('tickAleatoire', pousseColonne('minecraft:cactus'));

  // ---------------------------------------------------------------- bambou (BambooStalkBlock.randomTick / growBamboo), hauteur 16 au plus
  mc.bloc('BambooStalkBlock').sur('tickAleatoire', (ev, monde) => {
    if (!actif(monde)) return;
    const [x, y, z] = ev.pos;
    for (let i = fois(monde); i > 0; i--) {
      const b = monde.bloc(x, y, z);
      if (b.nom !== 'minecraft:bamboo' || b.etat.stage !== '0') return;
      if (monde.hasard.entier(3) !== 0 || monde.bloc(x, y + 1, z).nom !== 'minecraft:air' || lumiereMax(monde, x, y + 1, z) < 9) continue;
      let h = 0;
      while (monde.bloc(x, y - 1 - h, z).nom === 'minecraft:bamboo' && h < 16) h++;
      h++;
      if (h >= 16) continue;
      const b2 = monde.bloc(x, y - 1, z), b3 = monde.bloc(x, y - 2, z);
      let feuilles = 'none';
      if (h >= 2) {
        if (b2.nom !== 'minecraft:bamboo' || b2.etat.leaves === 'none') feuilles = 'small';
        else { feuilles = 'large'; if (b3.nom === 'minecraft:bamboo') { monde.poser(x, y - 1, z, avec(b2, { leaves: 'small' }), 3); monde.poser(x, y - 2, z, avec(b3, { leaves: 'none' }), 3); } }
      }
      const age = b.etat.age !== '1' && b3.nom !== 'minecraft:bamboo' ? 0 : 1;
      const stade = (h < 11 || !(monde.hasard.reel() < (h - 11) / 15)) && h !== 15 ? 0 : 1;
      monde.poser(x, y + 1, z, `minecraft:bamboo[age=${age},leaves=${feuilles},stage=${stade}]`, 3);
    }
  });

  // ---------------------------------------------------------------- lierre : s'etend vers le bas (VineBlock.randomTick, cote bas seulement)
  mc.bloc('VineBlock').sur('tickAleatoire', (ev, monde) => {
    if (!actif(monde)) return;
    const [x, y, z] = ev.pos;
    for (let i = fois(monde); i > 0; i--) {
      const b = monde.bloc(x, y, z);
      if (b.nom !== 'minecraft:vine') return;
      if (monde.hasard.entier(4) !== 0 || monde.hasard.entier(6) !== 1) continue;      // 1 chance sur 4, puis la direction tiree est le bas
      const dessous = monde.bloc(x, y - 1, z);
      if (dessous.nom !== 'minecraft:air' && dessous.nom !== 'minecraft:vine') continue;
      const e = dessous.nom === 'minecraft:vine' ? { ...dessous.etat } : { east: 'false', north: 'false', south: 'false', up: 'false', west: 'false' };
      let change = false;
      for (const f of ['east', 'north', 'south', 'west']) if (b.etat[f] === 'true' && monde.hasard.booleen() && e[f] !== 'true') { e[f] = 'true'; change = true; }
      if (change && ['east', 'north', 'south', 'west'].some((f) => e[f] === 'true')) monde.poser(x, y - 1, z, etatTexte('minecraft:vine', e), 2);
    }
  });

  // ---------------------------------------------------------------- objets sur un bloc : farine d'os, houe, graines (evenement du monde `objet.utilise`)
  const particulesCroissance = (monde, x, y, z, n = 15) => {
    for (let i = 0; i < n; i++) monde.particule('happy_villager', x + 0.1 + monde.hasard.reel() * 0.8, y + 0.2 + monde.hasard.reel() * 0.8, z + 0.1 + monde.hasard.reel() * 0.8, 0, 0, 0, 1);
  };
  mc.monde.sur('objet.utilise', (ev, monde) => {
    const [x, y, z] = ev.pos, o = ev.objet;
    if (o === 'bone_meal') {
      const b = monde.bloc(x, y, z), nom = court(b.nom);
      if (CULTURES[nom] !== undefined) {
        const max = CULTURES[nom], age = Number(b.etat.age);
        if (age >= max) return;
        let plus = 2 + monde.hasard.entier(4);                 // Mth.nextInt(random, 2, 5)
        if (nom === 'beetroots') plus = Math.trunc(plus / 3);
        plus = Math.max(0, Math.round(plus * monde.regle('croissance.farineOs', 1)));
        monde.poser(x, y, z, avec(b, { age: Math.min(max, age + plus) }), 2);
        monde.son('item.bone_meal.use', x + 0.5, y + 0.5, z + 0.5, 1, 1);
        particulesCroissance(monde, x, y, z);
        ev.fait = true;
      } else if (SAPLINGS[nom]) {
        if (monde.hasard.flottant() < 0.45) avancerArbre(monde, x, y, z);
        monde.son('item.bone_meal.use', x + 0.5, y + 0.5, z + 0.5, 1, 1);
        particulesCroissance(monde, x, y, z);
        ev.fait = true;
      } else if (nom === 'grass_block' && monde.bloc(x, y + 1, z).nom === 'minecraft:air') {
        for (let k = 0; k < 24; k++) {                         // herbe courte autour (BoneMealItem : marche aleatoire de 128 essais, resumee)
          const tx = x + monde.hasard.entier(7) - 3, tz = z + monde.hasard.entier(7) - 3;
          for (let ty = y + 1; ty >= y - 1; ty--) if (monde.bloc(tx, ty, tz).nom === 'minecraft:grass_block' && monde.bloc(tx, ty + 1, tz).nom === 'minecraft:air' && monde.hasard.entier(3) === 0) { monde.poser(tx, ty + 1, tz, 'minecraft:short_grass', 3); break; }
        }
        monde.son('item.bone_meal.use', x + 0.5, y + 0.5, z + 0.5, 1, 1);
        particulesCroissance(monde, x, y, z);
        ev.fait = true;
      }
      return;
    }
    if (/_hoe$/.test(o)) {
      const b = monde.bloc(x, y, z), nom = court(b.nom);
      if (ev.face === 'down' || monde.bloc(x, y + 1, z).nom !== 'minecraft:air') { ev.raison = 'il faut de l\'air au-dessus'; return; }
      if (nom === 'grass_block' || nom === 'dirt' || nom === 'dirt_path') monde.poser(x, y, z, 'minecraft:farmland[moisture=0]', 11);
      else if (nom === 'coarse_dirt') monde.poser(x, y, z, 'minecraft:dirt', 11);
      else return;
      monde.son('item.hoe.till', x + 0.5, y + 0.5, z + 0.5, 1, 1);
      ev.fait = true;
      return;
    }
    if (GRAINES[o]) {
      const b = monde.bloc(x, y, z);
      if (b.nom !== 'minecraft:farmland' || ev.face !== 'up' || monde.bloc(x, y + 1, z).nom !== 'minecraft:air') { ev.raison = 'les graines se plantent sur le dessus d\'une terre labouree'; return; }
      monde.poser(x, y + 1, z, `minecraft:${GRAINES[o]}[age=0]`, 3);
      monde.son('item.crop.plant', x + 0.5, y + 1.5, z + 0.5, 1, 1);
      ev.fait = true;
    }
  });
}
