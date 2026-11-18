// Famille "fluides" : l'eau et la lave qui coulent comme dans le jeu (FlowingFluid, LiquidBlock, LavaFluid, seaux). Port de Horizon
// world/level/fluids.rs (MIT, voir ATTRIBUTIONS.md), ecrit avec l'API des mods : un mod peut envelopper `fluide.tick`, changer un nombre par `regles`
// ou ecouter `fluide.change`.
//   - niveaux : source = 8, coulant 7 a 1 (niveau du bloc = 8 - quantite), tombant = niveau 8 ; l'eau perd 1 par bloc (7 blocs), la lave 2 (3 blocs)
//   - delais : eau 5 ticks, lave 30 (le jeu du monde normal) ; la lave coule 4 fois plus lentement quand elle monte (hasard 3 sur 4)
//   - pente : le fluide va vers le trou le plus proche (4 blocs pour l'eau, 2 pour la lave) ; deux sources voisines au-dessus d'un sol font une source
//   - lave + eau : source -> obsidienne, coulante -> pierre cassee (cobblestone) ; lave qui tombe sur de l'eau -> pierre ; basalte (soul soil + blue ice)
//   - eau enchainee (waterlogged) : dalles, escaliers, clotures... gardent l'eau dans leur etat et la laissent couler
//   - seaux : `utilise` avec water_bucket / lava_bucket pose une source, avec bucket il en reprend une
import { avec } from './_aide.js';

const N = 0, E = 1, S = 2, O = 3;
const HORIZ = [[0, -1], [1, 0], [0, 1], [-1, 0]];                 // Direction.Plane.HORIZONTAL : nord, est, sud, ouest (dx, dz)
const ORDRE_SORTIE = [N, S, O, E];                                // ordre des directions du jeu (nord, sud, ouest, est) pour appliquer l'ecoulement
const BAS = 4, HAUT = 5;
const DIRS = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 1, 0]];
const TAG_EMPORTE = '#minecraft:washed_away_by_fluids';
const SANS_CONTENANT = /^minecraft:(kelp|kelp_plant|seagrass|tall_seagrass)$/;
const VIDE = { type: null, quantite: 0, source: false, tombant: false };

const estPlein = (b) => b.some((k) => k[0] <= 1e-6 && k[1] <= 1e-6 && k[2] <= 1e-6 && k[3] >= 1 - 1e-6 && k[4] >= 1 - 1e-6 && k[5] >= 1 - 1e-6);

// Shapes.mergedFaceOccludes : les faces qui se touchent (face de sortie de `a`, face d'entree de `b`) couvrent-elles tout le carre ?
function couvre(a, b, dir) {
  const positif = dir === E || dir === S || dir === HAUT, axe = dir === E || dir === O ? 0 : dir === BAS || dir === HAUT ? 1 : 2;
  const premier = positif ? a : b, second = positif ? b : a;
  const [u, v] = axe === 0 ? [1, 2] : axe === 1 ? [0, 2] : [0, 1];
  const rects = [];
  for (const k of premier) if (Math.abs(k[3 + axe] - 1) <= 1e-7) rects.push([k[u], k[v], k[3 + u], k[3 + v]]);
  for (const k of second) if (Math.abs(k[axe]) <= 1e-7) rects.push([k[u], k[v], k[3 + u], k[3 + v]]);
  if (!rects.length) return false;
  const xs = [...new Set([0, 1, ...rects.flatMap((r) => [r[0], r[2]])])].filter((q) => q >= 0 && q <= 1).sort((p, q) => p - q);
  const ys = [...new Set([0, 1, ...rects.flatMap((r) => [r[1], r[3]])])].filter((q) => q >= 0 && q <= 1).sort((p, q) => p - q);
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    if (!rects.some((r) => cx > r[0] && cx < r[2] && cy > r[1] && cy < r[3])) return false;
  }
  return true;
}

export function installer(mc, regles) {
  regles.declarer('fluide.actif', { def: true, doc: 'l\'eau et la lave coulent (jeu : oui) ; non : les fluides restent ou ils sont' });
  regles.declarer('fluide.eau.delai', { def: 5, min: 1, max: 200, entier: true, doc: 'ticks entre deux pas d\'ecoulement de l\'eau (jeu : 5)' });
  regles.declarer('fluide.eau.distance', { def: 7, min: 1, max: 7, entier: true, doc: 'blocs que l\'eau parcourt a plat depuis une source (jeu : 7, niveaux 7 a 1)' });
  regles.declarer('fluide.eau.pente', { def: 4, min: 0, max: 8, entier: true, doc: 'distance a laquelle l\'eau cherche un trou pour y aller (jeu : 4)' });
  regles.declarer('fluide.lave.delai', { def: 30, min: 1, max: 200, entier: true, doc: 'ticks entre deux pas d\'ecoulement de la lave (jeu : 30 ; 10 au Nether)' });
  regles.declarer('fluide.lave.distance', { def: 3, min: 1, max: 7, entier: true, doc: 'blocs que la lave parcourt a plat depuis une source (jeu : 3 ; 7 au Nether)' });
  regles.declarer('fluide.lave.pente', { def: 2, min: 0, max: 8, entier: true, doc: 'distance a laquelle la lave cherche un trou (jeu : 2)' });
  regles.declarer('fluide.sourcesInfinies', { def: true, doc: 'deux sources d\'eau voisines au-dessus d\'un sol font une nouvelle source (jeu : oui)' });
  regles.declarer('fluide.lave.sourcesInfinies', { def: false, doc: 'meme chose pour la lave (jeu : non)' });
  regles.declarer('fluide.lave.feu', { def: true, doc: 'la lave met le feu aux blocs inflammables autour d\'elle (jeu : oui)' });
  regles.declarer('fluide.reactions', { def: true, doc: 'lave + eau donne obsidienne, pierre cassee ou pierre (jeu : oui)' });

  // ---- nombres du fluide (FlowingFluid.getDropOff, getSlopeFindDistance, getTickDelay) ----
  const nom = (t) => (t === 'water' ? 'eau' : 'lave');
  const delai = (m, t) => m.regle(`fluide.${nom(t)}.delai`, t === 'water' ? 5 : 30);
  const distance = (m, t) => m.regle(`fluide.${nom(t)}.distance`, t === 'water' ? 7 : 3);
  const perte = (m, t) => (t === 'water' || distance(m, t) >= 4 ? 1 : 2);   // la lave du jeu perd 2 par bloc ; au-dela de 3 blocs, 1
  const pente = (m, t) => m.regle(`fluide.${nom(t)}.pente`, t === 'water' ? 4 : 2);
  const convertit = (m, t) => (t === 'water' ? m.regle('fluide.sourcesInfinies', true) : m.regle('fluide.lave.sourcesInfinies', false));
  const hauteur = (m, f, x, y, z) => (!f.type ? 0 : m.fluide(x, y + 1, z).type === f.type ? 1 : f.quantite / 9);

  const cle = (x, y, z) => `${x},${y},${z}`;
  const etatFluide = (t, f) => `minecraft:${t}[level=${f.source ? 0 : f.tombant ? 8 : 8 - f.quantite}]`;        // FluidState.createLegacyBlock
  const nouveau = (t, quantite, source = false, tombant = false) => ({ type: t, quantite, source, tombant });

  // ---- lecture des cellules ----
  const bloc = (m, x, y, z) => m.bloc(x, y, z);
  const estAir = (b) => /^minecraft:(cave_|void_)?air$/.test(b.nom);
  const pleine = (m, x, y, z) => m.solide(x, y, z);                     // BlockState.isSolid du jeu (legacySolid : panneaux, plaques, toile oui ; tapis, pots non)
  const conteneur = (b) => 'waterlogged' in b.etat || SANS_CONTENANT.test(b.nom);   // LiquidBlockContainer (dalles, escaliers... + varech, herbes marines)
  const peutPlacerLiquide = (b, t) => {                                // LiquidBlockContainer.canPlaceLiquid
    if (SANS_CONTENANT.test(b.nom) || b.nom === 'minecraft:barrier') return false;
    if (/_slab$/.test(b.nom) && b.etat.type === 'double') return false;
    return t === 'water';
  };
  const peutTenirTout = (m, b, x, y, z) => conteneur(b) || m.estDans(x, y, z, TAG_EMPORTE);
  const peutTenirPrecis = (b, t) => (conteneur(b) ? peutPlacerLiquide(b, t) : true);
  const peutTenir = (m, b, x, y, z, t) => peutTenirTout(m, b, x, y, z) && peutTenirPrecis(b, t);

  // FlowingFluid.canPassThroughWall : un fluide passe de (a) vers (b) dans la direction `d` si les formes ne bouchent pas la face commune
  const cacheMur = new Map();
  function passe(m, d, ax, ay, az, bx, by, bz) {
    const sb = m.boites(bx, by, bz);
    if (estPlein(sb)) return false;
    const sa = m.boites(ax, ay, az);
    if (estPlein(sa)) return false;
    if (!sa.length && !sb.length) return true;
    let c1 = cacheMur.get(sa); if (!c1) cacheMur.set(sa, (c1 = new Map()));
    let c2 = c1.get(sb); if (!c2) c1.set(sb, (c2 = []));
    if (c2[d] === undefined) c2[d] = !couvre(sa, sb, d);
    return c2[d];
  }

  // FlowingFluid.getNewLiquid : ce que la cellule (x, y, z) devrait contenir d'apres ses voisins
  function nouveauLiquide(m, t, x, y, z) {
    let haut = 0, sources = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + HORIZ[d][0], nz = z + HORIZ[d][1], f = m.fluide(nx, y, nz);
      if (f.type === t && passe(m, d, x, y, z, nx, y, nz)) { if (f.source) sources++; haut = Math.max(haut, f.quantite); }
    }
    if (sources >= 2 && convertit(m, t)) {
      const fb = m.fluide(x, y - 1, z);
      if (pleine(m, x, y - 1, z) || (fb.type === t && fb.source)) return nouveau(t, 8, true);
    }
    const fh = m.fluide(x, y + 1, z);
    if (fh.type === t && passe(m, HAUT, x, y, z, x, y + 1, z)) return nouveau(t, 8, false, true);
    let q = haut - perte(m, t);
    // `fluide.<eau|lave>.distance` : au-dela du nombre de blocs voulu, rien ne coule (le jeu : 7 pour l'eau, 3 pour la lave)
    if (q > 0 && Math.floor((8 - q) / perte(m, t)) > distance(m, t)) q = 0;
    return q <= 0 ? VIDE : nouveau(t, q);
  }

  function estTrou(m, t, ax, ay, az) {          // isWaterHole : la cellule (a) laisse passer le fluide vers le bas
    if (!passe(m, BAS, ax, ay, az, ax, ay - 1, az)) return false;
    if (m.fluide(ax, ay - 1, az).type === t) return true;
    return peutTenir(m, bloc(m, ax, ay - 1, az), ax, ay - 1, az, t);
  }
  function peutPasserMaybe(m, t, sx, sy, sz, d, tx, ty, tz, ft) {
    return !(ft.type === t && ft.source) && peutTenirTout(m, bloc(m, tx, ty, tz), tx, ty, tz) && passe(m, d, sx, sy, sz, tx, ty, tz);
  }
  function peutPasser(m, t, sx, sy, sz, d, tx, ty, tz, ft) {
    return peutPasserMaybe(m, t, sx, sy, sz, d, tx, ty, tz, ft) && peutTenirPrecis(bloc(m, tx, ty, tz), t);
  }
  // FlowingFluid.getSlopeDistance : combien de pas pour atteindre un trou, 1000 si aucun dans la limite
  function distancePente(m, t, x, y, z, passeN, depuis, ctx) {
    let mini = 1000;
    for (let d = 0; d < 4; d++) {
      if (d === depuis) continue;
      const nx = x + HORIZ[d][0], nz = z + HORIZ[d][1];
      const ft = ctx.fluide(nx, y, nz);
      if (peutPasser(m, t, x, y, z, d, nx, y, nz, ft)) {
        if (ctx.trou(nx, y, nz)) return passeN;
        if (passeN < pente(m, t)) mini = Math.min(mini, distancePente(m, t, nx, y, nz, passeN + 1, (d + 2) % 4, ctx));
      }
    }
    return mini;
  }
  const contexte = (m, t) => {
    const f = new Map(), h = new Map();
    return {
      fluide(x, y, z) { const k = cle(x, y, z); let v = f.get(k); if (!v) f.set(k, (v = m.fluide(x, y, z))); return v; },
      trou(x, y, z) { const k = cle(x, y, z); let v = h.get(k); if (v === undefined) h.set(k, (v = estTrou(m, t, x, y, z))); return v; },
    };
  };

  function remplacePar(m, f, x, y, z, autre, d) {   // FluidState.canBeReplacedWith
    if (!f.type) return true;
    if (f.type === 'water') return d === BAS && autre !== 'water';
    return hauteur(m, f, x, y, z) >= 0.44444445 && autre === 'water';
  }

  // FlowingFluid.getSpread : les cotes vers lesquels couler (le plus proche trou), avec ce qu'ils recevront
  function cibles(m, t, x, y, z) {
    let mini = 1000, res = [], ctx = null;
    for (let d = 0; d < 4; d++) {
      const tx = x + HORIZ[d][0], tz = z + HORIZ[d][1];
      const ft = m.fluide(tx, y, tz);
      if (!peutPasserMaybe(m, t, x, y, z, d, tx, y, tz, ft)) continue;
      const nl = nouveauLiquide(m, t, tx, y, tz);
      if (!nl.type || !peutTenirPrecis(bloc(m, tx, y, tz), nl.type)) continue;
      ctx = ctx || contexte(m, t);
      const dist = ctx.trou(tx, y, tz) ? 0 : distancePente(m, t, tx, y, tz, 1, (d + 2) % 4, ctx);
      if (dist < mini) res = [];
      if (dist <= mini) { if (remplacePar(m, ft, tx, y, tz, nl.type, d)) res.push([d, nl]); mini = dist; }
    }
    return res.sort((p, q) => ORDRE_SORTIE.indexOf(p[0]) - ORDRE_SORTIE.indexOf(q[0]));
  }

  // ---- ecriture ----
  const crisse = (m, x, y, z) => {            // LevelEvent 1501 : la lave grésille (son + 8 fumees)
    m.son('block.lava.extinguish', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.6 + (m.hasard.flottant() - m.hasard.flottant()) * 0.8);
    for (let i = 0; i < 8; i++) m.particule('large_smoke', x + m.hasard.flottant(), y + 1.2, z + m.hasard.flottant(), 0, 0, 0, 1);
  };
  const poserLiquide = (m, x, y, z, b, t) => {   // LiquidBlockContainer.placeLiquid : l'eau entre dans le bloc (waterlogged)
    if (t !== 'water' || !('waterlogged' in b.etat) || !peutPlacerLiquide(b, t) || b.etat.waterlogged === 'true') return false;
    const modifs = { waterlogged: 'true' };
    if ('lit' in b.etat && b.etat.lit === 'true' && /campfire|candle/.test(b.nom)) {
      modifs.lit = 'false';
      m.son(/campfire/.test(b.nom) ? 'entity.generic.extinguish_fire' : 'block.candle.extinguish', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    }
    m.poser(x, y, z, avec(b, modifs));
    m.planifierFluide(x, y, z, delai(m, t));
    return true;
  };
  function ecouleVers(m, t, x, y, z, d, cible) {    // FlowingFluid.spreadTo (et LavaFluid.spreadTo)
    const b = bloc(m, x, y, z);
    if (t === 'lava' && d === BAS && m.fluide(x, y, z).type === 'water' && m.regle('fluide.reactions', true)) {
      if (b.nom === 'minecraft:water') m.poser(x, y, z, 'minecraft:stone');
      crisse(m, x, y, z);
      return;
    }
    if (conteneur(b)) { poserLiquide(m, x, y, z, b, cible.type); return; }
    if (!estAir(b)) {
      if (t === 'lava') crisse(m, x, y, z);
      else m.evenement('objets.lache', { pos: [x, y, z], etat: b.chaine, raison: 'eau' });        // beforeDestroyingBlock : l'eau fait lacher le bloc
    }
    m.poser(x, y, z, etatFluide(cible.type, cible));
  }
  const compteSources = (m, t, x, y, z) => HORIZ.filter(([a, c]) => { const f = m.fluide(x + a, y, z + c); return f.type === t && f.source; }).length;
  function ecouleCotes(m, t, x, y, z, f) {
    let voisin = f.quantite - perte(m, t);
    if (f.tombant) voisin = 7;
    if (voisin <= 0) return;
    for (const [d, cible] of cibles(m, t, x, y, z)) ecouleVers(m, t, x + HORIZ[d][0], y, z + HORIZ[d][1], d, cible);
  }
  function ecoule(m, t, x, y, z, f) {              // FlowingFluid.spread
    if (!f.type) return;
    const fb = m.fluide(x, y - 1, z), bb = bloc(m, x, y - 1, z);
    if (peutPasserMaybe(m, t, x, y, z, BAS, x, y - 1, z, fb)) {
      const nb = nouveauLiquide(m, t, x, y - 1, z);
      if (remplacePar(m, fb, x, y - 1, z, nb.type, BAS) && peutTenirPrecis(bb, nb.type)) {
        ecouleVers(m, t, x, y - 1, z, BAS, nb);
        if (compteSources(m, t, x, y, z) >= 3) ecouleCotes(m, t, x, y, z, f);
        return;
      }
    }
    if (f.source || !estTrou(m, t, x, y, z)) ecouleCotes(m, t, x, y, z, f);
  }
  function delaiPas(m, t, x, y, z, ancien, nouv) {  // LavaFluid.getSpreadDelay : la lave qui monte attend 4 fois plus (3 fois sur 4)
    const d = delai(m, t);
    if (t !== 'lava') return d;
    if (ancien.type && nouv.type && !ancien.tombant && !nouv.tombant && hauteur(m, nouv, x, y, z) > hauteur(m, ancien, x, y, z) && m.hasard.entier(4) !== 0) return d * 4;
    return d;
  }
  const egal = (a, b) => a.type === b.type && a.quantite === b.quantite && a.source === b.source && a.tombant === b.tombant;

  // ---- le tick de fluide (evenement du monde `fluide.tick`) ----
  mc.monde.sur('fluide.tick', (ev, m) => {
    if (!m.regle('fluide.actif', true)) return;
    const [x, y, z] = ev.pos, t = ev.type;
    cacheMur.clear();
    let f = m.fluide(x, y, z);
    if (!f.type) return;
    if (!f.source) {
      const nl = nouveauLiquide(m, t, x, y, z), d = delaiPas(m, t, x, y, z, f, nl);
      if (!egal(nl, f)) {
        const c = m.evenement('fluide.change', { pos: [x, y, z], type: t, ancien: f.quantite, nouveau: nl.quantite });
        if (c.annule) return;
      }
      if (!nl.type) { f = nl; m.poser(x, y, z, 'minecraft:air'); } else if (!egal(nl, f)) { f = nl; m.poser(x, y, z, etatFluide(t, nl)); m.planifierFluide(x, y, z, d); }
    }
    ecoule(m, t, x, y, z, f);
  });

  // ---- LiquidBlock : reactions lave + eau, tick a la pose et aux voisins ----
  const reagit = (m, x, y, z) => {                  // LiquidBlock.shouldSpreadLiquid : vrai si le fluide continue a couler
    const f = m.fluide(x, y, z);
    if (f.type !== 'lava' || !m.regle('fluide.reactions', true)) return true;
    const sousSoul = bloc(m, x, y - 1, z).nom === 'minecraft:soul_soil';
    for (const [dx, dy, dz] of [[0, 1, 0], [0, 0, 1], [0, 0, -1], [-1, 0, 0], [1, 0, 0]]) {   // les voisins, sauf celui du dessous
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (m.fluide(nx, ny, nz).type === 'water') {
        m.poser(x, y, z, f.source ? 'minecraft:obsidian' : 'minecraft:cobblestone');
        crisse(m, x, y, z);
        return false;
      }
      if (sousSoul && bloc(m, nx, ny, nz).nom === 'minecraft:blue_ice') { m.poser(x, y, z, 'minecraft:basalt'); crisse(m, x, y, z); return false; }
    }
    return true;
  };
  const surLiquide = (ev, m) => {
    const [x, y, z] = ev.pos;
    if (!m.regle('fluide.actif', true)) return;
    if (reagit(m, x, y, z)) m.planifierFluide(x, y, z, delai(m, m.fluide(x, y, z).type));
  };
  mc.bloc('LiquidBlock').sur('pose', surLiquide);
  mc.bloc('LiquidBlock').sur('voisin', surLiquide);
  mc.bloc('LiquidBlock').sur('forme', (ev, m) => {             // updateShape : une source (la sienne ou celle du voisin) reveille le tick
    const [x, y, z] = ev.pos, f = m.fluide(x, y, z), v = ev.voisinPos, fv = m.fluide(v[0], v[1], v[2]);
    if (m.regle('fluide.actif', true) && f.type && (f.source || fv.source)) m.planifierFluide(x, y, z, delai(m, f.type));
    return undefined;
  });
  // blocs qui gardent l'eau : meme chose (SimpleWaterloggedBlock.updateShape)
  if (mc.donnees) {
    const d = mc.donnees;
    for (let b = 0; b < d.noms.length; b++) {
      if (d.noms[b] === 'water' || d.noms[b] === 'lava') continue;
      if (!d.schema(b).some(([k]) => k === 'waterlogged')) continue;
      mc.bloc(d.noms[b]).sur('forme', (ev, m) => {
        if (ev.etat.includes('waterlogged=true') && m.regle('fluide.actif', true)) m.planifierFluide(ev.pos[0], ev.pos[1], ev.pos[2], delai(m, 'water'));
        return undefined;
      });
    }
  }

  // ---- LavaFluid.randomTick (feu autour de la lave) et bruits (LavaFluid.animateTick) ----
  mc.bloc('lava').sur('tickAleatoire', (ev, m) => {
    const [x, y, z] = ev.pos;
    if (m.fluide(x, y, z).source && m.bloc(x, y + 1, z).nom === 'minecraft:air' && m.hasard.entier(20) === 0) {
      m.particule('lava', x + m.hasard.flottant(), y + 1, z + m.hasard.flottant(), 0, 0, 0, 1);
      m.son('block.lava.pop', x + 0.5, y + 1, z + 0.5, 0.2 + m.hasard.flottant() * 0.2, 0.9 + m.hasard.flottant() * 0.15);
    }
    if (!m.regle('fluide.lave.feu', true) || !m.regle('feu.actif', true)) return;
    const brule = (a, b, c) => m.allumeParLave(a, b, c);
    const passes = m.hasard.entier(3);
    if (passes > 0) {
      let a = x, b = y, c = z;
      for (let i = 0; i < passes; i++) {
        a += m.hasard.entier(3) - 1; b += 1; c += m.hasard.entier(3) - 1;
        const bl = m.bloc(a, b, c);
        if (bl.nom === 'minecraft:air') {
          if (DIRS.some(([dx, dy, dz]) => brule(a + dx, b + dy, c + dz))) { m.poser(a, b, c, 'minecraft:fire[age=0]'); return; }
        } else if (m.estDans(a, b, c, '#minecraft:blocks_lava_fire_spread')) return;
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const a = x + m.hasard.entier(3) - 1, c = z + m.hasard.entier(3) - 1;
        if (m.bloc(a, y + 1, c).nom === 'minecraft:air' && brule(a, y, c)) m.poser(a, y + 1, c, 'minecraft:fire[age=0]');
      }
    }
  });

  // ---- seaux : evenement du monde `seau.utilise` (lance par l'acteur quand le bloc cible ne reagit pas) ----
  // ev : { pos (cellule visee), face, objet, acteur } ; le gestionnaire pose ev.fait = true, ev.nouvelObjet (l'objet qui reste en main) ou ev.raison
  mc.monde.sur('objet.utilise', (ev, m) => {
    if (!/(^|_)bucket$/.test(String(ev.objet))) return;
    const o = String(ev.objet || '').replace(/^minecraft:/, ''), [x, y, z] = ev.pos;
    const sons = { water: 'item.bucket.empty', lava: 'item.bucket.empty_lava' };
    if (o === 'bucket') {                                   // BucketPickup.pickupBlock
      const f = m.fluide(x, y, z), b = bloc(m, x, y, z);
      if (!f.type || !f.source) { ev.raison = 'pas de source ici'; return; }
      if (b.nom === 'minecraft:water' || b.nom === 'minecraft:lava') m.poser(x, y, z, 'minecraft:air', 11);
      else if ('waterlogged' in b.etat) {
        m.poser(x, y, z, avec(b, { waterlogged: 'false' }));
        if (!m.survit(x, y, z)) m.casser(x, y, z);
      } else { ev.raison = 'ce bloc ne garde pas de fluide'; return; }
      m.son(f.type === 'water' ? 'item.bucket.fill' : 'item.bucket.fill_lava', x + 0.5, y + 0.5, z + 0.5, 1, 1);
      ev.nouvelObjet = f.type === 'water' ? 'water_bucket' : 'lava_bucket'; ev.fait = true;
      return;
    }
    const t = o === 'water_bucket' ? 'water' : o === 'lava_bucket' ? 'lava' : null;
    if (!t) return;
    const b = bloc(m, x, y, z), v = DIRS[['north', 'east', 'south', 'west', 'down', 'up'].indexOf(ev.face)] || [0, 1, 0];
    const remplacable = (a, c, e) => { const bl = bloc(m, a, c, e); return m.boites(a, c, e).length === 0 || m.estDans(a, c, e, '#minecraft:replaceable') || (conteneur(bl) && t === 'water' && peutPlacerLiquide(bl, t)); };
    const [px, py, pz] = conteneur(b) && t === 'water' && peutPlacerLiquide(b, t) ? [x, y, z] : [x + v[0], y + v[1], z + v[2]];
    if (!remplacable(px, py, pz) && !(px === x && py === y && pz === z)) { ev.raison = 'rien ne peut recevoir le fluide ici'; return; }
    const bp = bloc(m, px, py, pz);
    if (conteneur(bp) && t === 'water' && peutPlacerLiquide(bp, t)) poserLiquide(m, px, py, pz, bp, t);
    else {
      if (!estAir(bp) && !m.fluide(px, py, pz).type) m.casser(px, py, pz);
      m.poser(px, py, pz, `minecraft:${t}[level=0]`, 11);
    }
    m.son(sons[t], px + 0.5, py + 0.5, pz + 0.5, 1, 1);
    ev.nouvelObjet = 'bucket'; ev.fait = true;
    ev.poseEn = [px, py, pz];
  });
}
