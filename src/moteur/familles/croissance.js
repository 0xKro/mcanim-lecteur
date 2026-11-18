// Famille "croissance" : cultures, terre labouree, pousses -> arbres, herbe qui se propage, feuilles qui meurent, canne a sucre, cactus, bambou, lierre, farine d'os,
// houe et graines. Ecrite avec la meme API que les mods ; les nombres sont ceux du jeu (Horizon world/level/{tick,growth,bonemeal}.rs : MIT, voir ATTRIBUTIONS.md).
//   culture : au tick aleatoire, si la lumiere >= 9 : age + 1 avec la chance 1 / (floor(25 / vitesse) + 1) ; vitesse = 1 + somme sur les 9 blocs du dessous (terre labouree : 1, humide : 3,
//             divise par 4 hors du bloc du dessous) ; divisee par 2 si la meme culture est en ligne ET en colonne, ou en diagonale ; betterave : une chance sur 3 d'essayer seulement
//   terre labouree : humidite 7 si de l'eau est dans le cube (-4..4, 0..1, -4..4) ou s'il pleut ; sinon -1 par tick aleatoire ; a 0 elle redevient de la terre (sauf culture dessus)
//   pousse : lumiere >= 9 au-dessus, 1 chance sur 7 ; stade 0 -> 1, puis l'arbre ; feuilles : distance au bois (1 au contact, 7 : meurt au tick aleatoire sauf `persistent`)
//   herbe : meurt sous un bloc opaque, se propage 4 essais par tick aleatoire sur la terre voisine ; canne : age 15 -> un cran au-dessus (3 au plus) ; cactus idem ; bambou : 1 chance sur 3
//   `croissance.vitesse` : multiplie le nombre de ticks aleatoires par section et par tick (monde.ticksAleatoires x vitesse) ; les nombres du jeu ne changent pas (lapse de temps)
import { avec, court, etatTexte, estAir, JEU as JEU_DIR } from './_aide.js';

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

  // ---------------------------------------------------------------- pousses -> arbres (SaplingBlock.randomTick / advanceTree ; TreeGrower : arbres.js)
  // Level.getMaxLocalRawBrightness : la lumiere du ciel moins l'assombrissement du moment (la nuit : -11 ; pluie, orage), ou celle des blocs
  const lumiereLocale = (monde, x, y, z) => { const l = monde.lumiere(x, y, z); return Math.max(l.bloc, l.ciel - monde.assombrissement()); };
  const avancerArbre = (monde, x, y, z) => monde.arbreAvancer(x, y, z);
  mc.bloc('SaplingBlock').sur('tickAleatoire', (ev, monde) => {
    if (!actif(monde) || !monde.regle('croissance.arbres', true)) return;
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z);
    if (b.nom === 'minecraft:mangrove_propagule') {                     // MangrovePropaguleBlock.randomTick
      if (b.etat.hanging !== 'true') { if (monde.hasard.entier(7) === 0) avancerArbre(monde, x, y, z); }
      else if (b.etat.age !== '4') monde.poser(x, y, z, avec(b, { age: Number(b.etat.age) + 1 }), 2);
      return;
    }
    if (lumiereLocale(monde, x, y + 1, z) >= 9 && monde.hasard.entier(7) === 0) avancerArbre(monde, x, y, z);
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

  // ---------------------------------------------------------------- lianes (VineBlock.randomTick complet : cotes, haut, bas ; Horizon level/tick.rs vine_random_tick)
  // MultifaceBlock.canAttachTo : la face du voisin tournee vers la liane est pleine (forme d'appui ou de collision)
  const DIRS6 = ['down', 'up', 'north', 'south', 'west', 'east'];                       // Direction.values()
  const H4 = ['north', 'east', 'south', 'west'];                                         // Direction.Plane.HORIZONTAL
  const V = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
  const OPP = { north: 'south', south: 'north', west: 'east', east: 'west', up: 'down', down: 'up' };
  const FR6 = { north: 'nord', south: 'sud', west: 'ouest', east: 'est', up: 'haut', down: 'bas' };
  const HOR = { north: 'east', east: 'south', south: 'west', west: 'north' };
  const AHOR = { north: 'west', west: 'south', south: 'east', east: 'north' };
  const plus = (p, dir) => [p[0] + V[dir][0], p[1] + V[dir][1], p[2] + V[dir][2]];
  const faceFull = (boites, face) => {   // Block.isFaceFull sur une liste de boites (projection de la face sur le carre 1 x 1)
    const ax = face === 'up' || face === 'down' ? 1 : face === 'north' || face === 'south' ? 2 : 0, cote = face === 'up' || face === 'south' || face === 'east' ? 1 : 0;
    const [u, v] = [0, 1, 2].filter((k) => k !== ax), cell = new Uint8Array(256);
    for (const b of boites) if ((cote ? b[ax + 3] : b[ax]) === cote) for (let i = Math.round(b[u] * 16); i < Math.round(b[u + 3] * 16); i++) for (let j = Math.round(b[v] * 16); j < Math.round(b[v + 3] * 16); j++) cell[i * 16 + j] = 1;
    return cell.every((c) => c === 1);
  };
  const peutAccrocher = (monde, p, dir) => monde.appui(p[0], p[1], p[2], FR6[OPP[dir]], 'plein') || faceFull(monde.boites(p[0], p[1], p[2]), OPP[dir]);
  const vide = (monde, p) => estAir(monde.bloc(...p));
  const lianesAutour = (monde, x, y, z, nom) => {   // VineBlock.canSpread : au plus 4 du meme bloc dans la boite 9 x 3 x 9
    let max = 5;
    for (let dx = -4; dx <= 4; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -4; dz <= 4; dz++) if (monde.bloc(x + dx, y + dy, z + dz).nom === nom && --max <= 0) return false;
    return true;
  };
  const ETAT_LIANE = { east: 'false', north: 'false', south: 'false', up: 'false', west: 'false' };
  mc.bloc('VineBlock').sur('tickAleatoire', (ev, monde) => {
    if (!actif(monde) || !monde.regle('croissance.lianes', true)) return;
    const p = ev.pos, [x, y, z] = p, b = monde.bloc(x, y, z), nom = b.nom, h = monde.hasard;
    if (h.entier(4) !== 0) return;
    const dir = DIRS6[h.entier(6)], dessus = plus(p, 'up');
    const liane = (e) => etatTexte(nom, { ...ETAT_LIANE, ...e });
    if (H4.includes(dir) && b.etat[dir] !== 'true') {
      if (!lianesAutour(monde, x, y, z, nom)) return;
      const t = plus(p, dir), bord = monde.bloc(...t);
      if (estAir(bord)) {
        const cw = HOR[dir], ccw = AHOR[dir], fcw = b.etat[cw] === 'true', fccw = b.etat[ccw] === 'true', tcw = plus(t, cw), tccw = plus(t, ccw);
        if (fcw && peutAccrocher(monde, tcw, cw)) monde.poser(...t, liane({ [cw]: 'true' }), 2);
        else if (fccw && peutAccrocher(monde, tccw, ccw)) monde.poser(...t, liane({ [ccw]: 'true' }), 2);
        else {
          const op = OPP[dir];
          if (fcw && vide(monde, tcw) && peutAccrocher(monde, plus(p, cw), op)) monde.poser(...tcw, liane({ [op]: 'true' }), 2);
          else if (fccw && vide(monde, tccw) && peutAccrocher(monde, plus(p, ccw), op)) monde.poser(...tccw, liane({ [op]: 'true' }), 2);
          else if (h.flottant() < 0.05 && peutAccrocher(monde, plus(t, 'up'), 'up')) monde.poser(...t, liane({ up: 'true' }), 2);
        }
      } else if (peutAccrocher(monde, t, dir)) monde.poser(x, y, z, avec(b, { [dir]: 'true' }), 2);
      return;
    }
    if (dir === 'up' && y < 319 - 1) {
      if (peutAccrocher(monde, dessus, 'up')) { monde.poser(x, y, z, avec(b, { up: 'true' }), 2); return; }
      if (vide(monde, dessus)) {
        if (!lianesAutour(monde, x, y, z, nom)) return;
        const e = { ...b.etat };
        for (const d of H4) if (h.booleen() || !peutAccrocher(monde, plus(dessus, d), d)) e[d] = 'false';
        if (H4.some((d) => e[d] === 'true')) monde.poser(...dessus, etatTexte(nom, e), 2);
        return;
      }
    }
    if (y > -64) {
      const dessous = monde.bloc(x, y - 1, z);
      if (estAir(dessous) || dessous.nom === nom) {
        const avant = estAir(dessous) ? { ...ETAT_LIANE } : { ...dessous.etat }, apres = { ...avant };
        for (const d of H4) if (h.booleen() && b.etat[d] === 'true') apres[d] = 'true';
        if (H4.some((d) => apres[d] !== avant[d]) && H4.some((d) => apres[d] === 'true')) monde.poser(x, y - 1, z, etatTexte(nom, apres), 2);
      }
    }
  });

  // ---------------------------------------------------------------- tiges de citrouille et de pasteque (StemBlock, AttachedStemBlock)
  regles.declarer('croissance.lianes', { def: true, doc: 'regle de jeu spread_vines : les lianes s etendent (jeu : oui)' });
  const lumBrute = (monde, x, y, z) => { const l = monde.lumiere(x, y, z); return Math.max(l.bloc, l.ciel); };   // getRawBrightness(pos, 0)
  const tagHas = (monde, x, y, z, tag) => monde.estDans(x, y, z, String(tag).replace(/^#/, ''));
  // StemBlock.randomTick : lumiere >= 9, 1 chance sur floor(25 / vitesse) + 1 ; age 7 : un fruit sur une case libre tiree au hasard (sol #supports_..._fruit)
  const pousseTige = (monde, x, y, z) => {
    const b = monde.bloc(x, y, z), ch = monde.champs(court(b.nom)), age = Number(b.etat.age);
    if (age < 7) { monde.poser(x, y, z, avec(b, { age: age + 1 }), 2); return; }
    const dir = H4[monde.hasard.entier(4)], t = plus([x, y, z], dir);
    if (estAir(monde.bloc(...t)) && tagHas(monde, t[0], t[1] - 1, t[2], ch.fruitSupportBlocks)) {
      monde.poser(...t, 'minecraft:' + ch.fruit, 3);
      monde.poser(x, y, z, `minecraft:${ch.attachedStem}[facing=${dir}]`, 3);
    }
  };
  mc.bloc('StemBlock').sur('tickAleatoire', (ev, monde) => {
    if (!actif(monde) || !monde.regle('croissance.cultures', true)) return;
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z);
    if (lumBrute(monde, x, y, z) < 9) return;
    const v = vitesseCulture(monde, x, y, z, court(b.nom));
    if (monde.hasard.entier(Math.floor(Math.fround(25 / v)) + 1) !== 0) return;
    pousseTige(monde, x, y, z);
  });
  // AttachedStemBlock.updateShape : le fruit retire -> la tige redevient une tige d'age 7
  mc.bloc('AttachedStemBlock').sur('forme', (ev, monde) => {
    const b = monde.bloc(...ev.pos), ch = monde.champs(court(b.nom));
    if (JEU_DIR[ev.direction] === b.etat.facing && !String(ev.voisin).startsWith('minecraft:' + ch.fruit + '[') && ev.voisin !== 'minecraft:' + ch.fruit) return `minecraft:${ch.stem}[age=7]`;
    return undefined;
  });
  for (const cl of ['StemBlock', 'AttachedStemBlock']) mc.bloc(cl).sur('survit', (ev, monde) => { const ch = monde.champs(ev.bloc); return tagHas(monde, ev.pos[0], ev.pos[1] - 1, ev.pos[2], ch.stemSupportBlocks ?? ch.supportBlocks); });

  // ---------------------------------------------------------------- champignons (MushroomBlock : propagation, survie ; geants : farine d'os)
  regles.declarer('croissance.champignons', { def: true, doc: 'les champignons se propagent dans le noir (1 chance sur 25, au plus 4 dans 9 x 3 x 9) (jeu : oui)' });
  mc.bloc('MushroomBlock').sur('survit', (ev, monde) => {   // MushroomBlock.canSurvive
    const [x, y, z] = ev.pos;
    if (monde.estDans(x, y - 1, z, 'overrides_mushroom_light_requirement')) return true;
    const e = monde.bloc(x, y - 1, z);
    return lumBrute(monde, x, y, z) < 13 && e.id >= 0 && monde.renduPlein(x, y - 1, z);
  });
  mc.bloc('MushroomBlock').sur('tickAleatoire', (ev, monde) => {
    if (!actif(monde) || !monde.regle('croissance.champignons', true)) return;
    const h = monde.hasard, b = monde.bloc(...ev.pos);
    if (h.entier(25) !== 0) return;
    let [x, y, z] = ev.pos, max = 5;
    for (let dx = -4; dx <= 4; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -4; dz <= 4; dz++) if (monde.bloc(x + dx, y + dy, z + dz).nom === b.nom && --max <= 0) return;
    const decal = (p) => { const a = h.entier(3) - 1, c = h.entier(2) - h.entier(2), e = h.entier(3) - 1; return [p[0] + a, p[1] + c, p[2] + e]; };
    let p = [x, y, z], o = decal(p);
    for (let i = 0; i < 4; i++) { if (vide(monde, o) && monde.survitEtat(...o, b.chaine)) p = o; o = decal(p); }
    if (vide(monde, o) && monde.survitEtat(...o, b.chaine)) monde.poser(...o, b.chaine, 2);
  });
  // HugeMushroomBlock.updateShape : une face contre un bloc de champignon du meme genre n'a plus sa peau
  mc.bloc('HugeMushroomBlock').sur('forme', (ev, monde) => {
    const b = monde.bloc(...ev.pos), d = JEU_DIR[ev.direction];
    if (String(ev.voisin).replace(/\[.*$/, '') === b.nom && b.etat[d] !== 'false') return avec(b, { [d]: 'false' });
    return undefined;
  });

  // ---------------------------------------------------------------- plantes qui poussent par la tete (GrowingPlantHeadBlock : lianes pleureuses et
  // tordues, lianes des cavernes, varech) : age < 25, chance growPerTickProbability (jeu : 0,1 ; varech 0,14), une case dans la direction de pousse
  const DIR_POUSSE = { DOWN: 'down', UP: 'up' };
  const peutPousserDans = (monde, tete, p) => { const n = monde.bloc(...p); return tete.nom === 'minecraft:kelp' ? n.nom === 'minecraft:water' : estAir(n); };
  const etatPousse = (monde, b) => {           // GrowingPlantHeadBlock.getGrowIntoState (lianes des cavernes : baies 1 fois sur 0,11)
    const age = Math.min(25, Number(b.etat.age) + 1);
    if (b.nom === 'minecraft:cave_vines') return avec(b, { age, berries: monde.hasard.flottant() < 0.11 ? 'true' : 'false' });
    return avec(b, { age });
  };
  mc.bloc('GrowingPlantHeadBlock').sur('tickAleatoire', (ev, monde) => {
    if (!actif(monde)) return;
    const b = monde.bloc(...ev.pos), ch = monde.champs(court(b.nom));
    if (Number(b.etat.age) >= 25 || !(monde.hasard.reel() < ch.growPerTickProbability)) return;
    const q = plus(ev.pos, DIR_POUSSE[ch.growthDirection]);
    if (peutPousserDans(monde, b, q)) monde.poser(...q, etatPousse(monde, b), 3);
  });

  // ---------------------------------------------------------------- lichen lumineux (MultifaceSpreader : seulement par la farine d'os)
  const aFace = (b, d) => b.etat[d] === 'true';
  const peutEtendreDans = (monde, nom, at, face) => {       // DefaultSpreaderConfig.canSpreadInto
    const n = monde.bloc(...at), f = monde.fluide(...at);
    const ok = estAir(n) || n.nom === nom || (n.nom === 'minecraft:water' && f.source);
    return ok && !(n.nom === nom && aFace(n, face)) && peutAccrocher(monde, plus(at, face), face);
  };
  const axeDe = (d) => (d === 'up' || d === 'down' ? 'y' : d === 'north' || d === 'south' ? 'z' : 'x');
  const cibleLichen = (monde, b, p, de, vers) => {          // MultifaceSpreader.getSpreadFromFaceTowardDirection
    if (axeDe(vers) === axeDe(de) || !aFace(b, de) || aFace(b, vers)) return null;
    for (const [at, face] of [[p, vers], [plus(p, vers), de], [plus(plus(p, vers), de), OPP[vers]]]) if (peutEtendreDans(monde, b.nom, at, face)) return [at, face];
    return null;
  };
  const melange6 = (h) => { const l = DIRS6.slice(); for (let i = l.length; i > 1; i--) { const j = h.entier(i); [l[i - 1], l[j]] = [l[j], l[i - 1]]; } return l; };
  const lichenPossible = (monde, b, p) => DIRS6.some((f) => DIRS6.some((s) => cibleLichen(monde, b, p, OPP[f], s)));
  const etendreLichen = (monde, b, p) => {
    for (const de of melange6(monde.hasard)) {
      if (!aFace(b, de)) continue;
      for (const vers of melange6(monde.hasard)) {
        const c = cibleLichen(monde, b, p, de, vers);
        if (!c) continue;
        const [at, face] = c, ancien = monde.bloc(...at);
        const base = ancien.nom === b.nom ? ancien.etat : { down: 'false', east: 'false', north: 'false', south: 'false', up: 'false', west: 'false', waterlogged: ancien.nom === 'minecraft:water' && monde.fluide(...at).source ? 'true' : 'false' };
        if (monde.poser(...at, etatTexte(b.nom, { ...base, [face]: 'true' }), 2)) return true;
      }
    }
    return false;
  };
  mc.bloc('MultifaceBlock').sur('survit', (ev, monde) => {  // MultifaceBlock.canSurvive : chaque face posee tient a son voisin
    const b = monde.bloc(...ev.pos);
    let une = false;
    for (const d of DIRS6) if (aFace(b, d)) { if (!peutAccrocher(monde, plus(ev.pos, d), d)) return false; une = true; }
    return une;
  });

  // ---------------------------------------------------------------- objets sur un bloc : farine d'os, houe, graines (evenement du monde `objet.utilise`)
  const particulesCroissance = (monde, x, y, z, n = 15) => {
    for (let i = 0; i < n; i++) monde.particule('happy_villager', x + 0.1 + monde.hasard.reel() * 0.8, y + 0.2 + monde.hasard.reel() * 0.8, z + 0.1 + monde.hasard.reel() * 0.8, 0, 0, 0, 1);
  };
  // farine d'os sur les autres plantes (BonemealableBlock : isValidBonemealTarget, isBonemealSuccess, performBonemeal ; Horizon level/bonemeal.rs).
  // Rend vrai si le bloc est une cible valide (la farine est utilisee, meme si l'essai rate).
  const tetePlante = (monde, p, nom, dir) => {               // BlockUtil.getTopConnectedBlock
    let q = p;
    for (let i = 0; i < 400; i++) { q = plus(q, dir); const n = monde.bloc(...q).nom; if (n !== nom) return n === nom.replace(/_plant$/, '') ? q : null; }
    return null;
  };
  const farineTete = (monde, p, b) => {                       // GrowingPlantHeadBlock.performBonemeal
    const dir = DIR_POUSSE[monde.champs(court(b.nom)).growthDirection];
    let q = plus(p, dir), age = Math.min(25, Number(b.etat.age) + 1), n = 1;
    if (b.nom === 'minecraft:weeping_vines' || b.nom === 'minecraft:twisting_vines') { let pr = 1; n = 0; while (monde.hasard.reel() < pr) { pr *= 0.826; n++; } }   // NetherVines.getBlocksToGrowWhenBonemealed
    for (let i = 0; i < n; i++) {
      if (!peutPousserDans(monde, b, q) || q[1] < -64 || q[1] >= 320) break;
      monde.poser(...q, avec(b, { age }), 3);
      q = plus(q, dir); age = Math.min(25, age + 1);
    }
  };
  function farineAutres(monde, b, x, y, z) {
    const nom = court(b.nom), h = monde.hasard, p = [x, y, z], ch = monde.champs(nom);
    if (ch?.treeGrower || nom === 'azalea' || nom === 'flowering_azalea') {
      if (nom === 'mangrove_propagule') {
        const pend = b.etat.hanging === 'true';
        if (pend && b.etat.age === '4') return false;
        if (pend) monde.poser(x, y, z, avec(b, { age: Number(b.etat.age) + 1 }), 2);
        else if (h.flottant() < 0.45) avancerArbre(monde, x, y, z);
        return true;
      }
      if (!monde.arbrePossible(x, y, z)) return false;
      if (h.flottant() < 0.45) avancerArbre(monde, x, y, z);
      return true;
    }
    if (nom === 'red_mushroom' || nom === 'brown_mushroom') {
      if (!monde.champignonPossible(x, y, z)) return false;
      if (h.flottant() < 0.4) monde.champignonGeant(x, y, z);
      return true;
    }
    if (ch?.attachedStem) {                                   // StemBlock : 2 a 5 crans, puis un tick aleatoire complet a l'age 7
      if (b.etat.age === '7') return false;
      const age = Math.min(7, Number(b.etat.age) + 2 + h.entier(4));
      monde.poser(x, y, z, avec(b, { age }), 2);
      if (age === 7 && lumBrute(monde, x, y, z) >= 9 && h.entier(Math.floor(Math.fround(25 / vitesseCulture(monde, x, y, z, nom))) + 1) === 0) pousseTige(monde, x, y, z);
      return true;
    }
    if (nom === 'cave_vines' || nom === 'cave_vines_plant') {
      if (b.etat.berries === 'true') return false;
      monde.poser(x, y, z, avec(b, { berries: 'true' }), 2);
      return true;
    }
    if (ch?.growthDirection && !/_plant$/.test(nom)) {        // tete : lianes pleureuses, tordues, varech
      const q = plus(p, DIR_POUSSE[ch.growthDirection]);
      if (!peutPousserDans(monde, b, q) || q[1] < -64 || q[1] >= 320) return false;
      farineTete(monde, p, b);
      return true;
    }
    if (/_plant$/.test(nom) && monde.champs(nom.replace(/_plant$/, ''))?.growthDirection) {   // corps : la tete pousse
      const dir = DIR_POUSSE[monde.champs(nom.replace(/_plant$/, '')).growthDirection], t = tetePlante(monde, p, b.nom, dir);
      if (!t) return false;
      const tb = monde.bloc(...t), q = plus(t, dir);
      if (!peutPousserDans(monde, tb, q) || q[1] < -64 || q[1] >= 320) return false;
      farineTete(monde, t, tb);
      return true;
    }
    if (nom === 'glow_lichen') {
      if (!lichenPossible(monde, b, p)) return false;
      etendreLichen(monde, b, p);
      return true;
    }
    if (nom === 'rooted_dirt') {                              // RootedDirtBlock : des racines pendantes dessous
      if (!estAir(monde.bloc(x, y - 1, z)) || y - 1 < -64) return false;
      monde.poser(x, y - 1, z, 'minecraft:hanging_roots', 3);
      return true;
    }
    if (nom === 'mangrove_leaves') {                          // MangroveLeavesBlock : une propagule pendante dessous
      if (!estAir(monde.bloc(x, y - 1, z))) return false;
      monde.poser(x, y - 1, z, 'minecraft:mangrove_propagule[age=0,hanging=true,stage=0,waterlogged=false]', 2);
      return true;
    }
    return false;
  }

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
      } else if (farineAutres(monde, b, x, y, z)) {
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
