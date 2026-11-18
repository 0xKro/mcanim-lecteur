// Meteo du monde simule : pluie, neige, orage, foudre. Port de ServerLevel.tickPrecipitation / tickChunk, Level.isRainingAt, LightningBolt (Horizon world/level/weather.rs,
// client/game/{weather,lightning}.rs : MIT, voir ATTRIBUTIONS.md). Les niveaux de pluie et d'orage viennent de la piste `ciel.meteo` de la scene (film/meteo.js).
//   - il pleut (isRaining) si le niveau de pluie > 0,2 ; il y a de l'orage (isThundering) si le niveau d'orage > 0,9
//   - Level.isRainingAt(pos) : il pleut, rien qui arrete le mouvement au-dessus (carte des hauteurs MOTION_BLOCKING), et le biome donne de la pluie
//   - biome : temperature < 0,15 : neige, sinon pluie ; temperature du jeu avec ses bruits (moteur/temperature.js : variation au-dessus de 80, biomes geles) ;
//     sans precipitation (desert...) rien ; `has_precipitation` et la temperature viennent des donnees du jeu (`biomes`)
//   - par tick et par colonne de 16 x 16 de la region : une chance sur 16 de tirer une position : l'eau gele (biome froid, lumiere de bloc < 10), la neige se pose (1 couche, jusqu'a
//     `meteo.neigeMax`) ; la pluie eteint le feu (0,2 + age x 0,03) et humidifie la terre labouree (farmland, via monde.pleut)
//   - orage : par colonne et par tick une chance sur 100 000 (regle `meteo.foudre` : multiplicateur) de foudre ; le coup tombe sur le dessus de la colonne, 5 degats aux acteurs a
//     moins de 3 blocs, feu (4 essais), eclair visible 1 a 3 fois, tonnerre et impact
import { niveauxMeteo } from '../film/meteo.js';
import { temperatureBiome } from './temperature.js';
import { SIEGES } from '../creatures/especes.js';   // siege des montures (cavaliers du piege)
import { textePile } from './pile.js';

// DifficultyInstance du jeu (Horizon mobs/spawning.rs LocalDifficulty, MIT) : regles monde.difficulte, monde.ageTicks (temps de jeu total), monde.habite
// (temps habite du tronçon), phase de la lune (jour) : effective = id x (0,75 + clamp((total - 72000) / 1440000) x 0,25 + local)
export function difficulteLocale(sim) {
  const R = sim.regles, id = { paisible: 0, peaceful: 0, facile: 1, easy: 1, normal: 2, difficile: 3, hard: 3 }[R.valeur('monde.difficulte', 'normal')] ?? 2;
  if (!id) return 0;
  const f = Math.fround, total = R.valeur('monde.ageTicks', 0) + sim.temps, hab = R.valeur('monde.habite', 0) + sim.temps;
  const glob = f(Math.min(1, Math.max(0, f((total - 72000) / 1440000))) * 0.25);
  const lune = [1, 0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75][Math.floor(total / 24000) % 8];
  let loc = f(Math.min(1, Math.max(0, f(hab / 3600000))) * (id === 3 ? 1 : 0.75));
  loc = f(loc + Math.min(glob, Math.max(0, f(lune * 0.25))));
  if (id === 1) loc = f(loc * 0.5);
  return f(id * f(f(0.75 + glob) + loc));
}
// DifficultyInstance.getSpecialMultiplier : 0 sous 2, 1 au-dessus de 4
export function difficulteSpeciale(sim) { const e = difficulteLocale(sim); return e < 2 ? 0 : e > 4 ? 1 : (e - 2) / 2; }

const RAD = Math.PI / 180;

export class Meteo {
  // piste : { etats, foudres } (film/meteo.js) ; null : pas de meteo
  constructor(sim, piste) {
    this.sim = sim; this.piste = piste; this.eclairs = []; this.iFoudre = 0; this.colonnes = null; this.sommet = null;
    this.pieges = []; this.cavaliers = [];   // pieges du cheval squelette (orage) et cavaliers assis
  }

  // ------------------------------------------------------------ niveaux
  tempsFilm(tick) { return tick / (20 * (this.sim.replay.ralenti || 1)); }
  niveaux(tick = this.sim.temps) { return niveauxMeteo(this.piste, this.tempsFilm(tick)); }
  pleut(tick) { return this.niveaux(tick).pluie > 0.2; }
  orage(tick) { return this.niveaux(tick).orage > 0.9; }

  // ------------------------------------------------------------ biome et hauteur
  biomeDe(x, z) {
    const m = this.sim.monde, zone = this.sim.zone;
    try { return zone.biome(Math.max(m.x0, Math.min(m.x0 + m.sx - 1, x)), Math.max(m.z0, Math.min(m.z0 + m.sz - 1, z))); } catch { return ''; }
  }
  // temperature du biome en (x, y, z) : Biome.getTemperature du jeu, bruits compris (temperature.js)
  temperature(x, y, z) {
    const b = this.sim.d.biome(this.biomeDe(x, z));
    if (!b) return 0.8;
    return temperatureBiome(b, x, y, z);
  }
  // 'pluie' | 'neige' | null selon le biome de la colonne a la hauteur y
  precipitation(x, y, z) {
    const b = this.sim.d.biome(this.biomeDe(x, z));
    if (!b || !b[1]) return null;
    return this.temperature(x, y, z) < 0.15 ? 'neige' : 'pluie';
  }
  // hauteur MOTION_BLOCKING : 1 au-dessus du bloc le plus haut qui arrete le mouvement ou tient un fluide
  hauteur(x, z) {
    const m = this.sim.monde, api = this.sim.api;
    for (let y = m.y0 + m.sy - 1; y >= m.y0; y--) { if (api.boites(x, y, z).length > 0 || api.fluide(x, y, z).type) return y + 1; }
    return m.y0;
  }
  // Level.isRainingAt
  pleutEn(x, y, z) {
    if (!this.piste || !this.sim.regles.valeur('meteo.actif', true) || !this.pleut(this.sim.temps)) return false;
    if (this.hauteur(x, z) > y) return false;
    return this.precipitation(x, y, z) === 'pluie';
  }

  // ------------------------------------------------------------ colonnes de la region (celles de 16 x 16)
  _colonnes() {
    if (this.colonnes) return this.colonnes;
    const m = this.sim.monde, a = m.ancre, vu = new Set(), l = [];
    for (const [sx, , sz] of this.sim.regionSections) { const k = sx + ',' + sz; if (vu.has(k)) continue; vu.add(k); l.push([a[0] + sx * 16, a[2] + sz * 16]); }
    return (this.colonnes = l);
  }

  // ------------------------------------------------------------ un tick (avant les ticks aleatoires, comme ServerLevel.tickChunk)
  tick() {
    const sim = this.sim, R = sim.regles, h = sim.hasard;
    if (!this.piste || !R.valeur('meteo.actif', true)) return;
    const t = sim.temps;
    // foudres de la scene
    while (this.iFoudre < this.piste.foudres.length) {
      const f = this.piste.foudres[this.iFoudre], tf = Math.floor(f.t * 20 * (sim.replay.ralenti || 1) + 1e-9);
      if (tf > t) break;
      this.iFoudre++;
      if (f.x !== undefined) this.foudre(f.x, f.z, f.y);
      else { const c = this._colonnes(); if (c.length) { const [cx, cz] = c[h.entierBorne(c.length)]; this.foudre(cx + h.entierBorne(16), cz + h.entierBorne(16)); } }
    }
    const n = this.niveaux(t), pluie = n.pluie > 0.2, orage = n.orage > 0.9;
    const mult = R.valeur('meteo.foudre', 1);
    for (const [cx, cz] of this._colonnes()) {
      if (orage && pluie && h.entierBorne(100000) < mult) this.coupOrage(cx, cz);
      if (h.entierBorne(16) === 0) this.precipiter(cx + h.entierBorne(16), cz + h.entierBorne(16), pluie);
    }
  }

  // ServerLevel.tickThunder (Horizon client/game/lightning.rs tick_thunder, MIT) : colonne tiree par getBlockRandomPos (le generateur
  // randValue du niveau, celui des ticks aleatoires), cible findLightningTargetAround (paratonnerre a 128 blocs, sinon une creature ou un
  // joueur vivant sous le ciel a 3 blocs, sinon le dessus), il faut qu'il y pleuve ; piege du cheval squelette : regle de jeu doMobSpawning,
  // nextDouble < difficulte locale x 0,01, pas sur un paratonnerre ; le coup est alors visuel (ni feu ni degats).
  coupOrage(cx, cz) {
    const sim = this.sim, h = sim.hasard, R = sim.regles;
    const [dx, , dz] = sim.tirage.prochain();
    const p = this.cibleFoudre(cx + dx, cz + dz);
    if (!p || !this.pleutEn(p[0], p[1], p[2])) return;
    const dessous = sim.api.bloc(p[0], p[1] - 1, p[2]).nom;
    const piege = R.valeur('monde.apparitions', true) && h.reel() < difficulteLocale(sim) * 0.01 && !/lightning_rod$/.test(dessous);
    if (piege) this.piegeCheval(p);
    this.foudre(p[0], p[2], p[1], { visuel: piege });
  }
  // findLightningTargetAround : le dessus de la colonne (MOTION_BLOCKING), un paratonnerre proche, ou une entite vivante sous le ciel
  cibleFoudre(x, z) {
    const sim = this.sim, top = this.hauteur(x, z);
    const tige = this.paratonnerre([x, top, z]);
    if (tige) return tige;
    const ciel = (q) => sim.lumiere().niveauCiel(q[0], q[1], q[2]) >= 15;
    const L = (sim.acteurs?.liste ?? []).filter((a) => a.mort < 0).map((a) => [Math.floor(a.x), Math.floor(a.y), Math.floor(a.z)])
      .filter((q) => Math.abs(q[0] - x) <= 3 && Math.abs(q[2] - z) <= 3 && q[1] >= top - 3 && ciel(q));
    if (L.length) return L[sim.hasard.entierBorne(L.length)];
    return [x, top, z];
  }
  // ServerLevel.findLightningRod : le paratonnerre le plus proche (128 blocs) qui est le dessus de sa colonne ; le coup tombe juste au-dessus
  paratonnerre(p) {
    const sim = this.sim, m = sim.monde, d = sim.d;
    if (this._tiges === undefined) {   // liste des paratonnerres de la zone (refaite quand un bloc change : rare)
      this._tiges = [];
      const t = new Set(['lightning_rod', 'exposed_lightning_rod', 'weathered_lightning_rod', 'oxidized_lightning_rod', 'waxed_lightning_rod', 'waxed_exposed_lightning_rod', 'waxed_weathered_lightning_rod', 'waxed_oxidized_lightning_rod'].map((n) => d.idBloc(n)));
      for (let y = m.y0; y < m.y0 + m.sy; y++) for (let z = m.z0; z < m.z0 + m.sz; z++) for (let x = m.x0; x < m.x0 + m.sx; x++) { const e = m.etatEn(x, y, z); if (e >= 0 && t.has(d.blocDe(e))) this._tiges.push([x, y, z]); }
    }
    let best = null, bd = Infinity;
    for (const q of this._tiges) {
      const e = m.etatEn(...q);
      if (e < 0 || !/lightning_rod$/.test(d.nomBloc(e))) continue;
      const dd = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
      if (dd > 128 * 128) continue;
      let dessus = true;
      for (let y = q[1] + 1; y < m.y0 + m.sy; y++) { const f = m.etatEn(q[0], y, q[2]); if (f >= 0 && !d.esAir(f)) { dessus = false; break; } }
      if (dessus && dd < bd) { bd = dd; best = [q[0], q[1] + 1, q[2]]; }
    }
    return best;
  }
  // le cheval squelette du piege : il attend un joueur (SkeletonTrapGoal), 18000 ticks au plus
  piegeCheval(p) {
    const sim = this.sim;
    (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} piege du cheval squelette en ${p.join(',')}`);
    sim.dire(`la foudre fait apparaitre un cheval squelette (piege) en ${p.join(',')}`);
    if (!sim.acteurs?.naitre) return null;
    const c = sim.acteurs.naitre({ nom: 'cheval_piege', type: 'skeleton_horse', x: p[0], y: p[1], z: p[2], lacet: 0, raison: 'piege', ia: { piege: true } });
    if (c) { c.piege = { temps: 0 }; this.pieges.push(c); }
    return c;
  }
  // SkeletonHorse.aiStep (le piege disparait apres 18000 ticks) et SkeletonTrapGoal (un joueur vivant a moins de 10 blocs le declenche)
  tickPieges() {
    const sim = this.sim;
    for (const c of this.pieges) {
      if (c.mort >= 0 || !c.piege) continue;
      if (++c.piege.temps > 18000) { c.mort = 21; c.mortSansCorps = true; c.piege = null; continue; }
      const proche = sim.acteurs.liste.some((a) => !a.typeCreature && a.mort < 0 && (a.x - c.x) ** 2 + (a.y - c.y) ** 2 + (a.z - c.z) ** 2 < 100);
      if (proche) this.declencherPiege(c);
    }
    // cavaliers : assis sur leur monture (Entity.positionRider : siege du type)
    for (const a of this.cavaliers) {
      const v = a.vehicule;
      if (!v || v.mort >= 0 || a.mort >= 0) continue;
      a.x = v.x; a.y = v.y + (SIEGES[v.typeCreature]?.[1] ?? 1); a.z = v.z; a.vx = v.vx; a.vy = v.vy; a.vz = v.vz; a.auSol = false; a.distanceChute = 0;
    }
  }
  // SkeletonTrapGoal.tick : le cheval n'est plus un piege (apprivoise, age 0), foudre visuelle, un squelette le monte ; trois autres chevaux
  // squelettes montes, pousses de triangle(0, 1,1485) en x et z (hasard du premier cheval) ; 60 ticks d'invulnerabilite ; casque de fer
  // (s'il n'a rien sur la tete), arc et casque enchantes (EnchantmentsByCostWithDifficulty de mob_spawn_equipment : cout 5 a 5 + 17 x special)
  declencherPiege(c) {
    const sim = this.sim;
    c.piege = null;
    if (c.ia) { c.ia.apprivoise = true; }
    (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} le piege du cheval squelette se declenche`);
    this.foudre(c.x, c.z, c.y, { visuel: true, exact: true });
    const cav = this.squeletteCavalier(c);
    if (!cav) return;
    for (let i = 0; i < 3; i++) {
      const o = sim.acteurs.naitre({ nom: 'cheval_squelette', type: 'skeleton_horse', x: c.x, y: c.y, z: c.z, lacet: 0, raison: 'piege', ia: { apprivoise: true } });
      if (!o) continue;
      o.invulTemps = 60;
      const r = this.squeletteCavalier(o);
      if (r) { const hh = c.ia?.h ?? sim.hasard, tri = () => 1.1485 * (hh.reel() - hh.reel()); o.vx += tri(); o.vz += tri(); }   // RandomSource.triangle(0, 1,1485)
    }
  }
  squeletteCavalier(cheval) {
    const sim = this.sim, sp = difficulteSpeciale(sim);
    const ench = (id) => {   // EnchantmentHelper.enchantItemFromProvider (mob_spawn_equipment) avec le hasard du niveau
      const cout = sim.hasard.entreInclus(5, 5 + Math.trunc(sp * 17));
      if (!sim.enchant?.selection) return id;
      const L = sim.enchant.selection(sim.hasard, id, cout);
      return textePile({ id, ench: Object.fromEntries(L), potion: null, usure: 0, travail: 0 });
    };
    const arc = ench('bow'), casque = ench('iron_helmet');
    const s = sim.acteurs.naitre({ nom: 'cavalier', type: 'skeleton', x: cheval.x, y: cheval.y, z: cheval.z, lacet: 0, raison: 'piege', objet: arc, armure: { tete: casque }, monture: cheval.nom });
    if (!s) return null;
    s.invulTemps = 60; s.vehicule = cheval; this.cavaliers.push(s);
    return s;
  }

  // ServerLevel.tickPrecipitation pour la colonne (x, z)
  precipiter(x, z, pluie) {
    const sim = this.sim, R = sim.regles, api = sim.api, m = sim.monde;
    if (x < m.x0 || x >= m.x0 + m.sx || z < m.z0 || z >= m.z0 + m.sz) return;
    const top = this.hauteur(x, z), dessous = top - 1;
    const type = this.precipitation(x, top, z);
    // gel de l'eau (Biome.shouldFreeze) : biome froid, source d'eau, au moins un voisin horizontal qui n'est pas de l'eau, lumiere de bloc < 10
    if (R.valeur('meteo.gel', true) && type === 'neige' && api.fluide(x, dessous, z).type === 'water' && api.fluide(x, dessous, z).source) {
      const b = api.bloc(x, dessous, z);
      if (b.nom === 'minecraft:water' && sim.lumiere().niveauBloc(x, dessous, z) < 10 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => api.fluide(x + a, dessous, z + c).type !== 'water')) {
        sim.poser(x, dessous, z, 'minecraft:ice', 3);
        sim.stats.gels = (sim.stats.gels || 0) + 1;
      }
    }
    if (!pluie || !type) return;
    const max = R.valeur('meteo.neigeMax', 1);
    if (type === 'neige' && max > 0 && sim.lumiere().niveauBloc(x, top, z) < 10) {
      const e = api.bloc(x, top, z);
      if (e.nom === 'minecraft:snow') {
        const k = Number(e.etat.layers);
        if (k < max && k < 8) { sim.poser(x, top, z, `minecraft:snow[layers=${k + 1}]`, 3); sim.stats.neige = (sim.stats.neige || 0) + 1; }
      } else if (e.nom === 'minecraft:air' || api.remplacable(x, top, z)) {
        const s = api.bloc(x, dessous, z);
        if (!/ice|snow_block|powder_snow|barrier/.test(s.nom) && api.appui(x, dessous, z, 'haut', 'plein') && !/water|lava/.test(s.nom)) { sim.poser(x, top, z, 'minecraft:snow[layers=1]', 3); sim.stats.neige = (sim.stats.neige || 0) + 1; }
      }
    }
    // chaudron sous la pluie ou la neige (CauldronBlock / LayeredCauldronBlock.handlePrecipitation ; Horizon level/tick.rs precipitation_tick) :
    // chance 0,05 (pluie) ou 0,1 (neige) : un chaudron vide devient chaudron d'eau (ou de neige poudreuse) niveau 1, un chaudron du meme
    // contenu monte d'un niveau (3 au plus) ; le tirage est fait pour tout chaudron a niveaux, meme d'un autre contenu
    if (!R.valeur('meteo.chaudrons', true)) return;
    const c = api.bloc(x, dessous, z), chance = type === 'neige' ? 0.1 : 0.05;
    if (c.nom === 'minecraft:cauldron') {
      if (sim.hasard.flottant() < chance) { sim.poser(x, dessous, z, type === 'neige' ? 'minecraft:powder_snow_cauldron[level=1]' : 'minecraft:water_cauldron[level=1]', 3); sim.vibrations?.emettre('block_change', x + 0.5, dessous + 0.5, z + 0.5, {}); sim.stats.chaudrons = (sim.stats.chaudrons || 0) + 1; }
    } else if ((c.nom === 'minecraft:water_cauldron' || c.nom === 'minecraft:powder_snow_cauldron') && sim.hasard.flottant() < chance) {
      const n = Number(c.etat.level), meme = (type === 'pluie') === (c.nom === 'minecraft:water_cauldron');
      if (n !== 3 && meme) { sim.poser(x, dessous, z, `${c.nom}[level=${n + 1}]`, 3); sim.vibrations?.emettre('block_change', x + 0.5, dessous + 0.5, z + 0.5, {}); sim.stats.chaudrons = (sim.stats.chaudrons || 0) + 1; }
    }
  }

  // ------------------------------------------------------------ foudre
  // Coup de foudre sur la colonne (x, z), au sol (ou en y si donne). visuel : sans feu ni degats
  foudre(x, z, y, opt = {}) {
    const sim = this.sim, R = sim.regles, h = sim.hasard;
    if (!opt.exact) { x = Math.floor(x) + 0.5; z = Math.floor(z) + 0.5; }   // exact : la foudre du piege tombe sur le cheval (snapTo)
    let sol = y ?? this.hauteur(Math.floor(x), Math.floor(z));
    // ServerLevel.findLightningTargetAround : un paratonnerre a 128 blocs attire la foudre naturelle (familles/machines.js) ; pas un coup impose
    if (y === undefined && !opt.visuel) { const c = sim.api.evenement('meteo.cibleFoudre', { centre: [Math.floor(x), sol, Math.floor(z)], cible: null }); if (c.cible) { x = c.cible[0] + 0.5; sol = c.cible[1]; z = c.cible[2] + 0.5; } }
    const e = { id: sim.entites.prochain++, x, y: sol, z, vie: 2, eclats: h.entierBorne(3) + 1, graine: h.entier(), visuel: !!opt.visuel, debut: sim.temps };
    this.eclairs.push(e);
    sim.stats.foudres = (sim.stats.foudres || 0) + 1;
    sim.dire(`foudre en ${x.toFixed(1)},${sol},${z.toFixed(1)}`);
    sim.son('entity.lightning_bolt.thunder', x, sol, z, 6, 0.8 + h.flottant() * 0.2);
    sim.son('entity.lightning_bolt.impact', x, sol, z, 2, 0.5 + h.flottant() * 0.2);
    if (!e.visuel && R.valeur('meteo.foudreFeu', true)) this.feu(e, 4);
    this.ecrire(e);
    sim.api.evenement('meteo.foudre', { pos: [x, sol, z], visuel: e.visuel });
    return e;
  }
  // LightningBolt.spawnFire : le feu a la position du coup, puis `n` essais a +-1
  feu(e, n) {
    const sim = this.sim, api = sim.api, h = sim.hasard, bx = Math.floor(e.x), by = e.y, bz = Math.floor(e.z);
    const essai = (x, y, z) => {
      if (api.bloc(x, y, z).nom !== 'minecraft:air') return;
      if (api.survitEtat(x, y, z, 'minecraft:fire[age=0]')) sim.poser(x, y, z, 'minecraft:fire[age=0]', 3);
    };
    essai(bx, by, bz);
    for (let i = 0; i < n; i++) essai(bx + h.entierBorne(3) - 1, by + h.entierBorne(3) - 1, bz + h.entierBorne(3) - 1);
  }
  // un tick des eclairs (phase des entites) : degats aux acteurs a moins de 3 blocs, nouvel eclair ou fin (LightningBolt.tick)
  tickEclairs() {
    const sim = this.sim, h = sim.hasard, R = sim.regles;
    if (this.pieges.length || this.cavaliers.length) this.tickPieges();
    if (!this.eclairs.length) return;
    for (const e of [...this.eclairs]) {
      if (e.debut === sim.temps) continue;
      e.vie--;
      if (e.vie < 0) {
        if (e.eclats === 0) { this.eclairs.splice(this.eclairs.indexOf(e), 1); continue; }
        if (e.vie < -h.entierBorne(10)) { e.eclats--; e.vie = 1; e.graine = h.entier(); if (!e.visuel && R.valeur('meteo.foudreFeu', true)) this.feu(e, 0); }
      }
      if (e.vie >= 0 && !e.visuel) {
        for (const a of sim.acteurs ? sim.acteurs.liste : []) {
          const b = a.boite();
          if (b[3] > e.x - 3 && b[0] < e.x + 3 && b[4] > e.y - 3 && b[1] < e.y + 9 && b[5] > e.z - 3 && b[2] < e.z + 3 && a.mort < 0) {
            // Entity.thunderHit (une fois par eclair) : villageois -> sorciere, cochon -> piglin zombifie, creeper charge, champimeuh qui change de couleur
            if (a.ia && !(e.touches ??= new Set()).has(a)) { e.touches.add(a); if (a.ia.foudroye?.(e)) continue; }
            a.degats(R.valeur('meteo.foudreDegats', 5), 'foudre');
          }
        }
      }
      this.ecrire(e);
    }
  }
  // replay : entite 'foudre' : (x, y, z, graine, vie) ; une vie >= 0 est un instant d'eclair (le ciel flashe)
  ecrire(e) { this.sim.replay.entite(this.sim.temps, e.id, 'foudre', e.x, e.y, e.z, e.graine, e.vie); }
}
void RAD;
