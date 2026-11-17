// Oeufs et reproductions a part (champ `ia: true`), melanges a la classe IA de ia.js : tortue (oeuf porte, retour a sa plage, ponte de 1 a 4
// oeufs sur le sable), grenouille (enceinte, frai pondu sur l'eau au bord), renifleur (oeuf lache entre les parents), panda (bambou a 8 blocs,
// genes dominants et recessifs), ocelot (confiance par le poisson, 1 sur 3), axolotl (seau de poisson tropical, variante d'un parent, bleu
// 1 sur 1200), poule (un oeuf toutes les 6000 a 12000 ticks), tetard (24000 ticks puis grenouille du climat du biome).
// L'eclosion des blocs (oeuf de tortue, frai, oeuf de renifleur) : moteur/familles/oeufs.js.
// D'apres le jeu (Turtle, TurtleLayEggGoal, TurtleGoHomeGoal, Frog / TryLaySpawnOnWaterNearLand, Sniffer.spawnChildFromBreeding, Panda.Gene,
// PandaBreedGoal, Ocelot.mobInteract, Axolotl.getBreedOffspring, Chicken.aiStep, Tadpole.ageUp) et Horizon (mobs/turtle.rs, frog.rs,
// sniffer.rs, panda.rs, axolotl.rs, MIT, voir ATTRIBUTIONS.md).
import { NOURRITURE, TENTE } from './ia-vie.js';
import { lireVariante } from '../creatures/especes.js';
import { Aleatoire } from './aleatoire.js';
import { coupe } from './collision.js';

const MOVE = 1, LOOK = 2;
const journal = (sim, t) => (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${t}`);
// nourriture et tentation (tags *_food du jeu ; TemptGoal de chaque espece)
Object.assign(NOURRITURE, { turtle: ['seagrass'], frog: ['slime_ball'], sniffer: ['torchflower_seeds'], panda: ['bamboo'], ocelot: ['cod', 'salmon'], axolotl: ['tropical_fish_bucket'] });
Object.assign(TENTE, { turtle: 1.1, frog: 1.25, sniffer: 1.25, panda: 1.0, ocelot: 0.6, axolotl: 1.1 });
// Panda.Gene : recessifs (brown, weak) ; Gene.getRandom : nextInt(16) -> 0 lazy, 1 worried, 2 playful, 4 aggressive, < 9 weak, < 11 brown, sinon normal
export const GENES_RECESSIFS = new Set(['brown', 'weak']);
export function geneAuHasard(h) { const i = h.entierBorne(16); return i === 0 ? 'lazy' : i === 1 ? 'worried' : i === 2 ? 'playful' : i === 4 ? 'aggressive' : i < 9 ? 'weak' : i < 11 ? 'brown' : 'normal'; }
export function varianteGenes(principal, cache) { return GENES_RECESSIFS.has(principal) ? (principal === cache ? principal : 'normal') : principal; }
// FrogVariant : #spawns_warm_variant_frogs, #spawns_cold_variant_frogs (biome du lieu d'eclosion), sinon temperate
export function climatGrenouille(biome) {
  const b = String(biome ?? '').replace(/^minecraft:/, '');
  if (/desert|warm_ocean|jungle|savanna|badlands|mangrove|nether|crimson|warped|basalt|soul_sand/.test(b)) return 'warm';
  if (/snowy|frozen|ice_spikes|jagged_peaks|grove|deep_dark|the_end|end_|small_end/.test(b)) return 'cold';
  return 'temperate';
}
// DimensionType.timeOfDay (angle du soleil) depuis l'heure de la scene (12 h = midi = 6000 ticks)
export function momentDuJour(heure) { const t = ((((heure - 6) % 24) + 24) % 24) * 1000, d0 = ((t / 24000 - 0.25) % 1 + 1) % 1, d1 = 0.5 - Math.cos(d0 * Math.PI) / 2; return (d0 * 2 + d1) / 3; }

export function declarerReglesOeufs(regles) {
  regles.declarer('oeufs.poussins', { def: true, doc: 'un oeuf lance fait naitre un poussin 1 fois sur 8 (et alors 4 poussins 1 fois sur 32)' });
  regles.declarer('oeufs.poules', { def: true, doc: 'les poules adultes pondent un oeuf toutes les 6000 a 12000 ticks (x `croissance.vitesse`) ; froides : oeuf bleu, chaudes : brun' });
}

export const METHODES_OEUFS = {
  initOeufs(d) {
    const a = this.a, t = this.type;
    if (t === 'chicken') { this.hasardPropre = new Aleatoire(((this.sim.config.graine ?? 1) * 31 + a.id * 2654435761) >>> 0); this.oeufDans = this.hasardPropre.entierBorne(6000) + 6000; this.fracOeuf = 0; }
    if (t === 'turtle') { this.plage = d.maison ? d.maison.slice() : [a.x, a.y, a.z]; this.aOeuf = !!d.aOeuf; this.ponte = 0; }
    if (t === 'frog') this.enceinte = !!d.enceinte;
    if (t === 'tadpole') { this.ageTetard = d.ageTetard ?? 0; this.fracTetard = 0; }
    if (t === 'panda') { const v = lireVariante('panda', this.variante).choix?.[0] ?? 'normal', g = d.genes ?? [v, v]; this.genes = [g[0], g[1]]; this.malheureux = 0; }
    if (t === 'ocelot') this.confiance = !!d.confiance;
  },
  // buts en plus (appele par installerVie : la tortue garde ses buts d'animal)
  installerOeufs(add) {
    if (this.type === 'turtle') { add(1, 'tortuePond', MOVE | LOOK); add(1, 'tortueMaison', MOVE); add(7, 'tortueNage', MOVE); }
    if (this.type === 'frog') add(2, 'grenouillePond', MOVE);
    if (this.type === 'ocelot') add(4, 'oceloteFuit', MOVE);
  },
  // ---- chaque tick (tickVie) ---------------------------------------------------------------------------------------------------
  tickOeufs() {
    const a = this.a, sim = this.sim, t = this.type;
    // Chicken.aiStep : --eggTime <= 0 : un oeuf (son, ENTITY_PLACE), puis 6000 a 12000 ticks (le hasard de la poule)
    if (t === 'chicken' && !this.bebe && sim.regles.valeur('oeufs.poules', true)) {
      this.fracOeuf += sim.regles.valeur('croissance.vitesse', 1);
      while (this.fracOeuf >= 1) {
        this.fracOeuf -= 1;
        if (--this.oeufDans <= 0) {
          const v = lireVariante('chicken', this.variante).choix?.[0], objet = v === 'cold' ? 'blue_egg' : v === 'warm' ? 'brown_egg' : 'egg';
          sim.son('entity.chicken.egg', a.x, a.y, a.z, 1, (this.hasardPropre.flottant() - this.hasardPropre.flottant()) * 0.2 + 1);
          sim.entites.objet(objet, 1, a.x, a.y, a.z);
          sim.vibrations.emettre('entity_place', a.x, a.y, a.z, { source: a.nom });
          this.oeufDans = this.hasardPropre.entierBorne(6000) + 6000;
          this.stat('oeufsPondus'); journal(sim, `${a.nom} pond un oeuf (${objet})`);
        }
      }
    }
    // Tadpole : 24000 ticks (x croissance.vitesse) puis une grenouille du climat du biome (FrogVariant)
    if (t === 'tadpole') {
      this.fracTetard += sim.regles.valeur('croissance.vitesse', 1);
      const n = Math.floor(this.fracTetard); this.fracTetard -= n; this.ageTetard += n;
      if (this.ageTetard >= 24000) {
        const v = climatGrenouille(sim.zone.biome?.(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z)));
        this.convertir('frog', { variante: v, son: 'entity.tadpole.grow_up', raison: 'metamorphose' });
      }
    }
    // Turtle.aiStep : la ponte creuse le sable (particules de casse toutes les 5 ticks)
    if (t === 'turtle' && this.ponte > 0 && this.ponte % 5 === 0) { const X = Math.floor(a.x), Y = Math.floor(a.y) - 1, Z = Math.floor(a.z), e = sim.monde.etatEn(X, Y, Z); if (e >= 0) sim.particule('block_break|' + sim.d.chaine(e), a.x, a.y, a.z, 0, 0, 0, 1); }
    if (t === 'panda' && this.malheureux > 0) this.malheureux--;
  },
  // ---- reproduction ---------------------------------------------------------------------------------------------------------------
  conditionOeufs() {
    if (this.type === 'ocelot') return this.confiance;
    if (this.type === 'panda') {   // PandaBreedGoal.canFindBamboo : un bambou a 8 blocs (0 a 2 de haut) ; sinon malheureux 32 ticks
      if (this.malheureux > 0) return false;
      const a = this.a, X = Math.floor(a.x), Y = Math.floor(a.y), Z = Math.floor(a.z);
      for (let dy = 0; dy < 3; dy++) for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) { const e = this.sim.monde.etatEn(X + dx, Y + dy, Z + dz); if (e >= 0 && this.sim.d.nomBloc(e) === 'bamboo') return true; }
      if (this.amour > 0 && !this.malheureux) { this.malheureux = 32; this.mecontentFin = this.sim.temps + 32; this.mecontentDebut = this.sim.temps; journal(this.sim, `${a.nom} : pas de bambou a 8 blocs, pas de bebe`); this.stat('sansBambou'); }
      return false;
    }
    return true;
  },
  // Turtle / Frog / Sniffer.spawnChildFromBreeding : pas de bebe direct
  naissanceOeuf(p) {
    const a = this.a, sim = this.sim, t = this.type;
    if (['turtle', 'frog', 'sniffer'].includes(t)) { const xp = 1 + this.h.entierBorne(7); sim.stats.experience = (sim.stats.experience || 0) + xp; sim.entites.orbes(a.x, a.y, a.z, xp); }   // finalizeSpawnChildFromBreeding : l'orbe
    if (t === 'turtle') { this.aOeuf = true; this.particulesAutour('heart', 7); journal(sim, `${a.nom} porte un oeuf (elle rentre a sa plage ${this.plage.map((v) => Math.floor(v)).join(',')})`); this.stat('oeufsPortes'); return true; }
    if (t === 'frog') { this.enceinte = true; this.particulesAutour('heart', 7); journal(sim, `${a.nom} est enceinte (frai a pondre)`); return true; }
    if (t === 'sniffer') {
      // Sniffer.spawnChildFromBreeding (Horizon mobs/animal_brain.rs, game/sniffers.rs `lay_sniffer_egg`) : son block.sniffer_egg.plop
      // (hasard du parent, ton (f - f) x 0,2 + 0,5), l'objet oeuf a la position du parent
      sim.son('block.sniffer_egg.plop', a.x, a.y, a.z, 1, (this.h.flottant() - this.h.flottant()) * 0.2 + 0.5);
      sim.entites.objet('sniffer_egg', 1, a.x, a.y, a.z);
      this.particulesAutour('heart', 7); journal(sim, `${a.nom} et ${p.nom} : un oeuf de renifleur`); this.stat('oeufsRenifleur');
      return true;
    }
    return false;
  },
  heritageOeufs(type, q, out) {
    const h = this.h, mot = (ia) => lireVariante(ia.type, ia.variante).choix?.[0];
    if (type === 'axolotl') out.variante = h.entierBorne(1200) === 0 ? 'blue' : h.booleen() ? mot(this) : mot(q);   // Axolotl.useRareVariant
    if (type === 'panda') {   // Panda.setGeneFromParents : un gene de chacun (pile ou face), 1 sur 32 au hasard chacun
      const un = (g) => (h.booleen() ? g[0] : g[1]);
      let princ, cache;
      if (h.booleen()) { princ = un(this.genes); cache = un(q.genes); } else { princ = un(q.genes); cache = un(this.genes); }
      if (h.entierBorne(32) === 0) princ = geneAuHasard(h);
      if (h.entierBorne(32) === 0) cache = geneAuHasard(h);
      out.genes = [princ, cache]; out.variante = varianteGenes(princ, cache);
    }
  },
  nourrirOeufs(joueur, o) {
    const a = this.a, sim = this.sim;
    // Ocelot.mobInteract : pas encore confiant, poisson a moins de 3 blocs : 1 sur 3 il fait confiance (7 coeurs), sinon fumee
    if (this.type === 'ocelot' && !this.confiance && (o === 'cod' || o === 'salmon')) {
      if (this.dist2(joueur) >= 9) return 'trop loin (3 blocs)';
      // Horizon game/creatures.rs : seulement pendant que l'ocelot vient vers la nourriture (temptGoal.isRunning)
      if (this.but('tente') && !this.actifs.has(this.but('tente'))) return 'il ne vient pas vers le poisson (immobile, poisson en main : il approche)';
      if (this.h.entierBorne(3) === 0) { this.confiance = true; this.particulesAutour('heart', 7); journal(sim, `${a.nom} fait confiance a ${joueur.nom}`); this.stat('confiances'); return 'confiance'; }
      this.particulesAutour('smoke', 7); return 'pas encore confiance (fumee)';
    }
    if (this.type === 'tadpole' && o === 'slime_ball') { const s = Math.floor(Math.floor((24000 - this.ageTetard) / 20) * 0.1); this.ageTetard += s * 20; this.particulesAutour('happy_villager', 1); return `grandit de ${s} s`; }
    return undefined;
  },

  // ---- tortue ---------------------------------------------------------------------------------------------------------------------
  // TurtleGoHomeGoal (Horizon mobs/turtle.rs `GoHome`) : avec un oeuf, ou 1 sur reduced(700) = 350 si la plage est a 64 blocs ou plus ;
  // jusqu'a 7 blocs du centre de la case de la plage ; abandon apres reduced(600) = 300 ticks passes a moins de 16 blocs
  distPlage() { const p = this.plage, a = this.a; return Math.hypot(Math.floor(p[0]) + 0.5 - a.x, Math.floor(p[1]) + 0.5 - a.y, Math.floor(p[2]) + 0.5 - a.z); },
  peut_tortueMaison() { return !this.bebe && (this.aOeuf ? this.distPlage() >= 7 : this.h.entierBorne(350) === 0 && this.distPlage() >= 64); },
  continue_tortueMaison() { if (this.distPlage() < 16) this.essaisPlage = (this.essaisPlage ?? 0) + 1; return this.distPlage() >= 7 && (this.essaisPlage ?? 0) <= 300; },
  debut_tortueMaison() { this.versMaison = true; this.essaisPlage = 0; this.stat('retoursPlage'); },
  fin_tortueMaison() { this.versMaison = false; this.nav = null; this.navEau = null; },
  tick_tortueMaison() { const p = this.plage; if (this.sim.temps % 10 === 0 || (this.a.dansEau ? this.nageFinie() : this.navFinie())) this.aller(p[0], p[1], p[2], 1.0); },
  // TurtleLayEggGoal : avec un oeuf a moins de 9 blocs de la plage ; un sable libre dessus a 16 blocs ; arrivee : 200 ticks a creuser, puis
  // un oeuf de tortue (1 a 4) sur le sable, son, amour 600
  // MoveToBlockGoal(1,0 ; 16 ; 1) (Horizon mobs/goals.rs `find_nearest` / `walk`) : attente reduced(200 + [0, 200[) entre deux recherches,
  // puis la premiere case valide dans l'ordre du jeu (hauteurs 0, +1, -1 ; anneaux de 0 a 15 ; x et z en 0, 1, -1, 2, -2...)
  sablePondable(p) { const sim = this.sim, e = sim.monde.etatEn(p[0], p[1], p[2]), u = sim.monde.etatEn(p[0], p[1] + 1, p[2]); return e >= 0 && u >= 0 && /^(sand|red_sand|suspicious_sand|suspicious_red_sand)$/.test(sim.d.nomBloc(e)) && /^(air|cave_air|void_air)$/.test(sim.d.nomBloc(u)); },
  peut_tortuePond() {
    if (!this.aOeuf || this.distPlage() >= 9) return false;
    if ((this.attentePonte ?? 0) > 0) { this.attentePonte--; return false; }
    this.attentePonte = Math.floor((200 + this.h.entierBorne(200) + 1) / 2);
    const a = this.a, X = Math.floor(a.x), Y = Math.floor(a.y), Z = Math.floor(a.z), suiv = (v) => (v > 0 ? -v : 1 - v);
    for (let y = 0; y <= 1; y = suiv(y)) for (let r = 0; r < 16; r++) for (let x = 0; x <= r; x = suiv(x)) for (let z = x < r && x > -r ? r : 0; z <= r; z = suiv(z)) {
      const p = [X + x, Y + y - 1, Z + z];
      if (this.sablePondable(p)) { this.sableVise = p; return true; }
    }
    this.sableVise = null; return false;
  },
  continue_tortuePond() { return this.aOeuf && !!this.sableVise && this.sablePondable(this.sableVise) && this.distPlage() < 9; },
  debut_tortuePond() { this.ponte = 0; },
  fin_tortuePond() { this.ponte = 0; },
  tick_tortuePond() {
    const a = this.a, sim = this.sim, s = this.sableVise;
    if (Math.hypot(s[0] + 0.5 - a.x, s[1] + 1 - a.y, s[2] + 0.5 - a.z) > 1.0) { this.ponte = 0; if (sim.temps % 10 === 0 || this.navFinie()) this.allerVers(s[0] + 0.5, s[1] + 1, s[2] + 0.5, 1.0, { recalcul: 20, rayon: 0.3 }); return; }
    this.nav = null; this.ponte++;
    if (this.ponte > 200) {
      const n = this.h.entierBorne(4) + 1;
      sim.son('entity.turtle.lay_egg', a.x, a.y, a.z, 0.3, 0.9 + this.h.flottant() * 0.2);
      sim.poser(s[0], s[1] + 1, s[2], `minecraft:turtle_egg[eggs=${n},hatch=0]`, 3);
      this.aOeuf = false; this.ponte = 0; this.amour = 600; this.sableVise = null;
      this.stat('pontes'); journal(sim, `${a.nom} pond ${n} oeuf(s) de tortue en ${[s[0], s[1] + 1, s[2]].join(',')}`);
    }
  },
  // TurtleRandomStrollGoal dans l'eau : un point d'eau au hasard (1 sur 120)
  peut_tortueNage() { if (!this.a.dansEau || this.h.entierBorne(120) !== 0) return false; this.butNage = this.pointNage(); return !!this.butNage; },
  continue_tortueNage() { return this.a.dansEau && !this.nageFinie(); },
  debut_tortueNage() { this.nageVers(...this.butNage, 1.0, 1e9); },
  tick_tortueNage() {},
  fin_tortueNage() { this.navEau = null; },
  // ---- grenouille : TryLaySpawnOnWaterNearLand (enceinte, sur le sol, une eau sans bloc a cote avec de l'air au-dessus : le frai) -------
  peut_grenouillePond() {
    if (!this.enceinte) return false;
    const a = this.a, sim = this.sim, X = Math.floor(a.x), Y = Math.floor(a.y), Z = Math.floor(a.z);
    let best = null, bd = Infinity;
    for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) for (let dy = -2; dy <= 1; dy++) {
      const x = X + dx, y = Y + dy, z = Z + dz;
      if (sim.fluide(x, y - 1, z).type !== 'water' || !/^air$/.test(sim.d.nomBloc(Math.max(0, sim.monde.etatEn(x, y, z))))) continue;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { if (coupe(a.lec, [x + ox + 0.2, y - 0.2, z + oz + 0.2, x + ox + 0.8, y - 0.01, z + oz + 0.8]) && !coupe(a.lec, [x + ox + 0.2, y + 0.01, z + oz + 0.2, x + ox + 0.8, y + 1, z + oz + 0.8])) { const d = dx * dx + dz * dz + dy * dy; if (d < bd) { bd = d; best = { eau: [x, y - 1, z], terre: [x + ox, y, z + oz] }; } } }
    }
    this.lieuFrai = best; return !!best;
  },
  continue_grenouillePond() { return this.enceinte && !!this.lieuFrai; },
  tick_grenouillePond() {
    const a = this.a, sim = this.sim, L = this.lieuFrai, t = L.terre;
    if (Math.hypot(t[0] + 0.5 - a.x, t[2] + 0.5 - a.z) > 0.7 || !a.auSol) { if (sim.temps % 10 === 0 || this.navFinie()) this.allerVers(t[0] + 0.5, t[1], t[2] + 0.5, 1.0, { recalcul: 20, rayon: 0.3 }); return; }
    const p = [L.eau[0], L.eau[1] + 1, L.eau[2]];
    sim.poser(p[0], p[1], p[2], 'minecraft:frogspawn', 3);
    sim.son('entity.frog.lay_spawn', a.x, a.y, a.z, 1, 1);
    this.enceinte = false; this.lieuFrai = null; this.nav = null;
    this.stat('frais'); journal(sim, `${a.nom} pond du frai en ${p.join(',')}`);
  },
  // ---- ocelot : OcelotAvoidEntityGoal (pas confiant : fuit les joueurs a 16 blocs, 0,8 / 1,33) ; le tente avec du poisson s'il ne bouge pas vite
  peut_oceloteFuit() {
    if (this.confiance) return false;
    const j = this.joueursProches(16)[0];
    if (!j || (j.main?.objet && NOURRITURE.ocelot.includes(String(j.main.objet)) && Math.hypot(j.vx, j.vz) < 0.05)) return false;
    this.fuiteO = j; return true;
  },
  continue_oceloteFuit() { return !this.confiance && !!this.fuiteO && this.dist2(this.fuiteO) < 256 && !this.navFinie(); },
  debut_oceloteFuit() { const a = this.a, o = this.fuiteO, dx = a.x - o.x, dz = a.z - o.z, L = Math.hypot(dx, dz) || 1; this.allerVers(a.x + dx / L * 10, undefined, a.z + dz / L * 10, this.dist2(o) < 49 ? 1.33 : 0.8, { recalcul: 1e9 }); },
  tick_oceloteFuit() {},
  fin_oceloteFuit() { this.nav = null; },

  drapeauxOeufs() {
    let d = 0;
    if (this.aOeuf) d |= 1 << 24;                       // tortue qui porte un oeuf (ventre)
    if (this.ponte > 0) d |= 1 << 25;                    // tortue qui creuse
    if (this.enceinte) d |= 1 << 26;
    return d;
  },
};
