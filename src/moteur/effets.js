// Effets de potion (tous ceux du jeu) et faim (FoodData) des acteurs simules (docs/SIMULATION.md partie 26). METHODES de `Acteur`, installees APRES
// utilisation.js (elles remplacent appliquerEffet et tickEffets de la phase 7).
//   Effets : intervalles du jeu (MobEffect.shouldApplyEffectTickThisTick : regeneration 50 >> niveau, poison 25 >> niveau, fletrissement 40 >> niveau ;
//   un intervalle <= 0 : chaque tick), faim (0,005 x (niveau + 1) d'epuisement par tick), saturation (+ niveau + 1 de faim, x 2 en saturation),
//   soin et degats instantanes (4 << niveau, 6 << niveau ; inverses pour les morts-vivants), Bonus de vie (+4 de vie max par niveau),
//   Absorption (4 par niveau), Resistance (5 x niveau / 25 : moteur/inventaire.js), Resistance au feu (feu et lave : rien), Respiration
//   aquatique / Force du conduit / Souffle du nautile (pas d'air perdu), Levitation (vy += (0,05 x (niveau + 1) - vy) x 0,2), Chute lente
//   (gravite 0,01 en descente, chute remise a zero), Force / Faiblesse (attaque), Celerite / Fatigue (minage et vitesse d'attaque +-10 %),
//   Chance / Malchance (peche), Charge de vent / Tissage / Suintement a la mort (rafale, toiles, deux slimes), Infestation (poissons d'argent
//   quand on est blesse, 1 chance sur 10), Vision nocturne / Cecite / Nausee / Obscurite : la vue de l'acteur suivi par la camera (film/look.js).
//   Faim (Horizon horizon-world/src/food.rs) : epuisement > 4 : -4 et -1 de saturation (ou de faim) ; regeneration naturelle (saturation et faim 20 :
//   min(sat, 6) / 6 toutes les 10 ticks ; faim >= 18 : 1 toutes les 80 ticks, +6 d'epuisement) ; faim a 0 : 1 de degats toutes les 80 ticks
//   (jusqu'a 10 en facile, 1 en normal, la mort en difficile) ; course impossible a 6 de faim ou moins.
//   Epuisement : course 0,1 et nage 0,01 par bloc, saut 0,05 (0,2 en courant), coup 0,1, bloc casse 0,005, degats recus (exhaustion du type).
// Port de Horizon horizon-client-render/src/effects.rs, game/potions.rs, horizon-world/src/{food,movement_statistics}.rs (MIT, ATTRIBUTIONS.md).
import { EFFETS } from './utilisation.js';
import { couleurPotion } from './potions.js';

const MORTS_VIVANTS = new Set(['zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'bogged', 'parched', 'wither_skeleton', 'zombified_piglin', 'zoglin', 'phantom', 'wither', 'skeleton_horse', 'zombie_horse', 'zombie_nautilus']);
// durees par defaut (ticks) d'une potion du jeu par effet : Potions du jeu (Horizon horizon-client-core/src/potions.rs) ; instantanes : 1
export const DUREES = { ...Object.fromEntries(Object.entries(EFFETS).map(([k, v]) => [k, v.ticks])), instant_health: 1, instant_damage: 1, saturation: 1, fire_resistance: 3600, water_breathing: 3600, resistance: 400, luck: 6000, slow_falling: 1800, wind_charged: 3600, weaving: 3600, oozing: 3600, infested: 3600, weakness: 1800, levitation: 200, nausea: 300, blindness: 300, hunger: 600, health_boost: 2400, unluck: 6000, conduit_power: 260, bad_omen: 120000, trial_omen: 18000, raid_omen: 300, hero_of_the_village: 48000, breath_of_the_nautilus: 1200 };
export const TOUS_EFFETS = ['speed', 'slowness', 'haste', 'mining_fatigue', 'strength', 'instant_health', 'instant_damage', 'jump_boost', 'nausea', 'regeneration', 'resistance', 'fire_resistance', 'water_breathing', 'invisibility', 'blindness', 'night_vision', 'hunger', 'weakness', 'poison', 'wither', 'health_boost', 'absorption', 'saturation', 'glowing', 'levitation', 'luck', 'unluck', 'slow_falling', 'conduit_power', 'dolphins_grace', 'bad_omen', 'hero_of_the_village', 'darkness', 'trial_omen', 'raid_omen', 'wind_charged', 'weaving', 'oozing', 'infested', 'breath_of_the_nautilus'];
const VUES = new Set(['night_vision', 'blindness', 'nausea']);   // effets qui changent la vue de l'acteur (film/look.js) ; obscurite : deja dans replay.obscurite

export function installerEffets(Acteur) {
  const P = Acteur.prototype;

  P.estMortVivant = function () {
    const oj = this.sim.objetsJeu;
    if (!this.typeCreature) return false;
    return oj ? oj.etiquette('entity_type', 'undead').has(this.typeCreature) : MORTS_VIVANTS.has(this.typeCreature);
  };
  // LivingEntity.addEffect / MobEffect.applyInstantenousEffect ; `force` : potion jetee (1 - d / 4)
  P.appliquerEffet = function (id, ticks, niveau = 0, { force = 1 } = {}) {
    const sim = this.sim;
    id = String(id).replace(/^minecraft:/, '');
    if (!sim.regles.valeur('effets.actif', true) || this.mort >= 0) return;
    if ((id === 'infested' && this.typeCreature === 'silverfish') || (id === 'oozing' && this.typeCreature === 'slime')) return;   // #immune_to_infested, #immune_to_oozing
    if (id === 'instant_health' || id === 'instant_damage') {
      const soigne = (id === 'instant_health') !== this.estMortVivant();
      const q = Math.floor(force * ((soigne ? 4 : 6) << niveau) + 0.5);
      if (soigne) { if (this.vie > 0) this.vie = Math.min(this.vieMax, this.vie + q); }
      else if (q > 0) this.degats(q, 'magie');
      sim.dire(`${this.nom} : ${id} ${niveau + 1} (${soigne ? '+' : '-'}${q})`);
      return;
    }
    if (id === 'saturation') { this.manger(niveau + 1, (niveau + 1) * 2); return; }
    const actuel = this.effets.get(id);
    const fin = sim.temps + ticks;
    // MobEffectInstance.update : un niveau plus fort remplace ; meme niveau : la plus longue duree
    if (!actuel || actuel.niveau < niveau || (actuel.niveau === niveau && actuel.fin < fin)) this.effets.set(id, { fin, niveau, debut: sim.temps });
    else return;
    if (id === 'health_boost') { this.vieMaxBase ??= this.vieMax; this.vieMax = this.vieMaxBase + 4 * (niveau + 1); }
    if (id === 'absorption') this.absorption = Math.max(this.absorption ?? 0, 4 * (niveau + 1));
    if (!this.typeCreature) {
      if (id === 'darkness') sim.replay.obscurite.push({ debut: sim.temps, fin, acteur: this.nom });   // le film assombrit la vue (film/look.js)
      if (VUES.has(id)) (sim.replay.visions ??= []).push({ debut: sim.temps, fin, acteur: this.nom, effet: id, niveau });
      if (id === 'night_vision') (sim.replay.visionNuit ??= []).push({ debut: sim.temps, fin, acteur: this.nom });   // table de lumiere du film (film/lumiere-vue.js)
    }
    if (actuel && actuel.fin > sim.temps && id === 'dolphins_grace') return;   // la grace rendue 1 fois sur 6 par tick : une seule ligne
    sim.dire(`${this.nom} : effet ${id} ${niveau + 1} pendant ${(ticks / 20).toFixed(0)} s`);
    sim.stats.effets = (sim.stats.effets || 0) + 1;
  };
  P.retirerEffet = function (id) {
    const e = this.effets.get(id);
    if (!e) return;
    this.effets.delete(id);
    if (id === 'health_boost') { this.vieMax = this.vieMaxBase ?? 20; this.vie = Math.min(this.vie, this.vieMax); }
    if (id === 'absorption') this.absorption = 0;
  };
  P.niveauEffet = function (id) { const e = this.effets.get(id); return e && e.fin > this.sim.temps ? e.niveau + 1 : 0; };
  P.facteurVitesse = function () {
    const v = this.niveauEffet('speed'), l = this.niveauEffet('slowness');
    const ames = this.agiliteAmes ? 1 + this.agiliteAmes / 0.1 : 1;   // Agilite des ames : movement_speed 0,1 + ajout (inventaire.js)
    return Math.max(0, ames * (1 + Math.fround(0.2) * v) * (1 - Math.fround(0.15) * l)) * this.sim.regles.valeur('effets.vitesse', 1);
  };
  P.bonusSaut = function () { return 0.1 * this.niveauEffet('jump_boost'); };
  P.respireSousEau = function () { return this.niveauEffet('water_breathing') > 0 || this.niveauEffet('conduit_power') > 0 || this.niveauEffet('breath_of_the_nautilus') > 0; };
  P.chance = function () { return this.niveauEffet('luck') - this.niveauEffet('unluck'); };

  // LivingEntity.tickEffects (ordre d'insertion), puis FoodData.tick
  P.tickEffets = function () {
    const sim = this.sim;
    for (const [id, e] of [...this.effets]) {
      if (e.fin <= sim.temps) { this.retirerEffet(id); continue; }
      const restant = e.fin - sim.temps, k = (b) => { const i = b >> e.niveau; return i <= 0 || restant % i === 0; };
      if (this.mort >= 0) continue;
      if (id === 'regeneration' && k(50) && this.vie < this.vieMax) this.vie = Math.min(this.vieMax, this.vie + 1);
      else if (id === 'poison' && k(25) && this.vie > 1) this.degats(1, 'poison');
      else if (id === 'wither' && k(40) && this.typeCreature !== 'wither') this.degats(1, 'fletrissement');
      else if (id === 'hunger') this.epuiser(Math.fround(0.005 * (e.niveau + 1)));
    }
    if (this.mort < 0) {
      if (this.niveauEffet('slow_falling') || this.niveauEffet('levitation')) this.distanceChute = 0;   // LivingEntity.aiStep
      this.tickFaim();
      if (this.effets.size) this.particulesEffets();
    }
  };
  // ActiveEffects.tick (client) : une particule d'effet 1 fois sur 4 (15 si invisible), de la couleur melangee des effets ; hasard a part (celui du
  // monde n'est pas touche : les tirages du jeu restent les memes)
  P.particulesEffets = function () {
    const sim = this.sim, h = (this._hEffets ??= sim.nouvelAleatoire ? sim.nouvelAleatoire(0x5eff + this.id * 7919) : null);
    if (!h || h.entierBorne(this.niveauEffet('invisibility') ? 15 : 4) !== 0) return;
    const l = [...this.effets].filter(([id, e]) => e.fin > sim.temps && !['invisibility'].includes(id)).map(([id, e]) => [id, 0, e.niveau]);
    if (!l.length) return;
    const c = couleurPotion(l);
    sim.particule(`entity_effect|${(((c >> 16) & 255) / 255).toFixed(3)},${(((c >> 8) & 255) / 255).toFixed(3)},${((c & 255) / 255).toFixed(3)}`, this.x + (h.reel() - 0.5) * this.L, this.y + h.reel() * this.H, this.z + (h.reel() - 0.5) * this.L, 1, 1, 1, 1);
  };

  // ---------------------------------------------------------------- faim (FoodData)
  P.epuiser = function (q) { if (this.typeCreature || this.creatif) return; this.epuisement = Math.min(Math.fround(this.epuisement + q), 40); };   // Player.causeFoodExhaustion : pas en creatif
  P.manger = function (nutrition, saturation) {
    this.faim = Math.max(0, Math.min(20, this.faim + nutrition));
    this.satur = Math.max(0, Math.min(this.faim, Math.fround(this.satur + saturation)));
  };
  P.tickFaim = function () {
    const sim = this.sim, R = sim.regles;
    if (this.typeCreature || !R.valeur('faim.actif', true)) return;
    const dif = R.valeur('faim.difficulte', 'normal');
    if (this.epuisement > 4) {
      this.epuisement = Math.fround(this.epuisement - 4);
      if (this.satur > 0) this.satur = Math.max(Math.fround(this.satur - 1), 0);
      else if (dif !== 'paisible') this.faim = Math.max(this.faim - 1, 0);
    }
    const regen = R.valeur('faim.regeneration', true), blesse = this.vie > 0 && this.vie < this.vieMax;
    if (regen && this.satur > 0 && blesse && this.faim >= 20) {
      if (++this.minuteurRegen >= 10) { const f = Math.min(this.satur, 6); this.vie = Math.min(this.vieMax, this.vie + f / 6); this.epuiser(f); this.minuteurRegen = 0; }
    } else if (regen && this.faim >= 18 && blesse) {
      if (++this.minuteurRegen >= 80) { this.vie = Math.min(this.vieMax, this.vie + 1); this.epuiser(6); this.minuteurRegen = 0; }
    } else if (this.faim <= 0) {
      if (++this.minuteurRegen >= 80) {
        if (this.vie > 10 || dif === 'difficile' || (this.vie > 1 && dif === 'normal')) this.degats(1, 'faim');
        this.minuteurRegen = 0;
      }
    } else this.minuteurRegen = 0;
  };
  // Player.checkMovementStatistics : epuisement de la course (0,1 par bloc) et de la nage (0,01 par bloc), distances en centimetres arrondis
  P.epuisementDeplacement = function (dx, dy, dz) {
    if (this.typeCreature || this.mort >= 0) return;
    const cm = (v) => Math.round(Math.fround(Math.sqrt(v)) * 100);
    if (this.nageant || this.teteEau) { const c = cm(dx * dx + dy * dy + dz * dz); if (c > 0) this.epuiser(Math.fround(0.01 * c * 0.01)); }
    else if (this.dansEau) { const c = cm(dx * dx + dz * dz); if (c > 0) this.epuiser(Math.fround(0.01 * c * 0.01)); }
    else if (this.auSol && this.course) { const c = cm(dx * dx + dz * dz); if (c > 0) this.epuiser(Math.fround(0.1 * c * 0.01)); }
  };
  // la course s'arrete a 6 de faim ou moins (FoodData.hasEnoughFood)
  P.peutCourir = function () { return this.typeCreature || this.creatif || this.faim > 6 || !this.sim.regles.valeur('faim.actif', true); };

  // ---------------------------------------------------------------- effets a la mort et quand on est blesse
  P.effetsMort = function () {
    const sim = this.sim;
    if (this.niveauEffet('oozing') && sim.acteurs) for (let i = 0; i < 2; i++) sim.acteurs.naitre({ type: 'slime', bebe: false, x: this.x, y: this.y + 0.5, z: this.z, lacet: 0, raison: 'suintement', nom: 'slime', gabaritParent: { l: 1.04, h: 1.04, oeil: 0.65, vitesse: 1 }, ia: {}, taille: 2 });
    if (this.niveauEffet('weaving')) {
      const h = sim.hasard, voulu = 2 + h.entierBorne(2), pris = [];
      for (let i = 0; i < 15 && pris.length < voulu; i++) {
        const p = [Math.floor(this.x) - 1 + h.entierBorne(3), Math.floor(this.y) - 1 + h.entierBorne(3), Math.floor(this.z) - 1 + h.entierBorne(3)];
        const e = sim.monde.etatEn(...p), sous = sim.monde.etatEn(p[0], p[1] - 1, p[2]);
        if (pris.some((q) => q[0] === p[0] && q[1] === p[1] && q[2] === p[2]) || e < 0 || sous < 0 || !sim.d.a(e, 1) || !sim.d.solideFace(sous, 1, 2)) continue;
        pris.push(p);
      }
      for (const p of pris) sim.poser(p[0], p[1], p[2], 'minecraft:cobweb', 3);
    }
    if (this.niveauEffet('wind_charged')) sim.rafale?.(this.x, this.y + this.H / 2, this.z, { rayon: 3 + sim.hasard.flottant() * 2, recul: 1, source: this });
  };
  P.effetsBlessure = function () {
    const sim = this.sim;
    if (!this.niveauEffet('infested') || !sim.acteurs) return;
    if (sim.hasard.flottant() > 0.1) return;
    const n = 1 + sim.hasard.entierBorne(2);
    for (let i = 0; i < n; i++) sim.acteurs.naitre({ type: 'silverfish', bebe: false, x: this.x, y: this.y + this.H / 2, z: this.z, lacet: sim.hasard.flottant() * 360, raison: 'infestation', nom: 'poisson_argent', gabaritParent: { l: 0.4, h: 0.3, oeil: 0.13, vitesse: 1 }, ia: {} });
  };
}
