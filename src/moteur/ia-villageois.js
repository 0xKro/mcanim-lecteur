// Cerveau des villageois, partie « vie du village » (champ `ia: true`), melange a la classe IA de ia.js : temps libre du jeu (RunOne :
// aller voir un villageois, un partenaire, un chat, flaner, marcher vers ce qu'il regarde, sauter sur un lit pour un bebe, ne rien faire),
// echanges entre villageois (TradeWithVillager : ragots, nourriture en trop lancee aux autres, ble et graines au fermier), reproduction
// (VillagerMakeLove : 275 a 324 ticks ensemble, un lit libre a 48 blocs, sinon colere), jeu des bebes (PlayTagWithOtherKids, JumpOnBed),
// lits, postes de travail et cloches pris (AcquirePoi), metier pris au poste (AssignProfessionFromJobSite), pain du fermier au composteur.
// Port d'apres le jeu (net.minecraft.world.entity.ai.behavior.*, Villager, VillagerGoalPackages, Schedule) et Horizon (MIT, voir
// ATTRIBUTIONS.md) : mobs/villager_brain.rs (packages, InteractWith, TradeWithVillager, MakeLove, PlayTag, JumpOnBed, AcquirePoi,
// GoToPotentialJobSite, AssignProfession, take_bed_for_child), mobs/villager.rs (food_points, has_excess_food, wants_more_food,
// take_half_stack, meet, can_breed, job_site_profession, farmer_items), game/villagers.rs (villager_throw, villager_birth,
// villager_make_bread), horizon-client-render particles.rs (Burst::VILLAGER : 5 particules, +1 en hauteur, vitesse 0,02).
// Les nombres du jeu sont ecrits a cote de chaque regle.
import { chercherChemin } from './navigation.js';
import { rayonBloc, coupe } from './collision.js';
import { lireVariante } from '../creatures/especes.js';

const MOVE = 1, LOOK = 2;
const journal = (sim, t) => (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${t}`);

// Villager.FOOD_POINTS (pain 4, pomme de terre, carotte, betterave 1)
export const POINTS = { bread: 4, potato: 1, carrot: 1, beetroot: 1 };
// #minecraft:villager_picks_up (donnees du jeu 26.3 : #villager_plantable_seeds, pain, ble, betterave)
export const RAMASSES = new Set(['wheat_seeds', 'potato', 'carrot', 'beetroot_seeds', 'torchflower_seeds', 'pitcher_pod', 'bread', 'wheat', 'beetroot']);
// VillagerProfession.FARMER.requestedItems (Horizon villager.rs farmer_items)
export const DEMANDES_FERMIER = ['wheat', 'wheat_seeds', 'beetroot_seeds', 'bone_meal'];
// PoiTypes : le bloc de poste de chaque metier (Horizon villager.rs job_site_profession)
export const POSTES = {
  blast_furnace: 'armorer', smoker: 'butcher', cartography_table: 'cartographer', brewing_stand: 'cleric', composter: 'farmer', barrel: 'fisherman',
  fletching_table: 'fletcher', cauldron: 'leatherworker', water_cauldron: 'leatherworker', lava_cauldron: 'leatherworker', powder_snow_cauldron: 'leatherworker',
  lectern: 'librarian', stonecutter: 'mason', loom: 'shepherd', smithing_table: 'toolsmith', grindstone: 'weaponsmith',
};
// Villager : inventaire SimpleContainer(8) ; piles de 64 pour tout ce qu'il ramasse
const CASES = 8, PILE = 64;
// nombres des comportements (VillagerGoalPackages / Horizon packages())
export const NOMBRES = {
  naissanceMin: 275, naissanceAlea: 50, amourMax: 350, coeurs: 35, proche2: 5, interaction2: 64, vue2: 256, echange: 60,
  litRayon: 48, ageBebe: -24000, attenteParents: 6000, exces: 24, envie: 12, bleFermier: 32,
};
// type de villageois du biome (VillagerType.byBiome)
export const typeDuBiome = (b) => { b = String(b ?? '').replace(/^minecraft:/, ''); return /desert/.test(b) ? 'desert' : /jungle|bamboo/.test(b) ? 'jungle' : /savanna/.test(b) ? 'savanna' : /snowy|frozen|ice|grove|peaks/.test(b) ? 'snow' : /swamp|mangrove/.test(b) ? 'swamp' : /taiga/.test(b) ? 'taiga' : 'plains'; };

// ShufflingList.shuffle : un poids -nextFloat()^(1 / poids) par entree, puis un tri stable
function melanger(h, liste) {
  return liste.map(([nom, w], i) => ({ nom, i, k: -Math.pow(h.flottant(), 1 / w) })).sort((p, q) => p.k - q.k || p.i - q.i).map((x) => x.nom);
}
const bloc = (p) => [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
const sectionDe = (b) => [b[0] >> 4, b[1] >> 4, b[2] >> 4];
const DANGER = /^(lava|fire|soul_fire|cactus|magma_block|campfire|soul_campfire|sweet_berry_bush|wither_rose|powder_snow|cobweb)$/;
// PoiManager.sectionsToVillage : distance de Chebyshev (en sections) a la section du village la plus proche, 7 au plus (pas de village : 7)
export function sectionsAuVillage(V, s) { let m = 7; for (const v of V) m = Math.min(m, Math.max(Math.abs(v[0] - s[0]), Math.abs(v[1] - s[1]), Math.abs(v[2] - s[2]))); return m; }
// BehaviorUtils.findSectionClosestToVillage : la section (a +-r) plus proche du village que celle-ci (ordre z, y, x), sinon elle
export function sectionLaPlusProche(V, c, r) {
  const ici = sectionsAuVillage(V, c); let best = null, bd = Infinity;
  for (let z = c[2] - r; z <= c[2] + r; z++) for (let y = c[1] - r; y <= c[1] + r; y++) for (let x = c[0] - r; x <= c[0] + r; x++) { const d = sectionsAuVillage(V, [x, y, z]); if (d < ici && d < bd) { bd = d; best = [x, y, z]; } }
  return best ?? c;
}
const memeBloc = (p, q) => !!p && !!q && Math.floor(p[0]) === Math.floor(q[0]) && Math.floor(p[1]) === Math.floor(q[1]) && Math.floor(p[2]) === Math.floor(q[2]);

// un bloc change en (x, y, z) : est-ce (ou etait-ce) un POI ? (lit, bloc de metier, cloche ; ou une position des listes gardees)
export function poiChange(sim, x, y, z) {
  const e = sim.monde.etatEn(x, y, z), n = e >= 0 ? sim.d.nomBloc(e) : '';
  return n.endsWith('_bed') || n === 'bell' || !!POSTES[n] || !!sim._poiPos?.has(`${x},${y},${z}`);
}

export const METHODES_VILLAGEOIS = {
  installerVillageois(add) {
    add(3, 'amourVillageois', LOOK);       // IDLE : GateBehavior(BREED_TARGET, VillagerMakeLove), priorite 3
    add(4, 'marcheCible', MOVE);           // CORE : MoveToTargetSink (la cible de marche des autres comportements)
    add(5, 'echangeVillageois', LOOK);     // IDLE et MEET : GateBehavior(INTERACTION_TARGET, TradeWithVillager), priorite 3
    add(5, 'jeuBebe', 0);                  // PLAY : PlayTagWithOtherKids, priorite 5
    add(5, 'ramasseNourriture', MOVE);     // CORE : GoToWantedItem, priorite 5
    add(6, 'oisif', MOVE);                 // IDLE (2) et PLAY (5) : RunOne
    add(6, 'sautLit', 0);                  // JumpOnBed (choisi par RunOne)
    add(3, 'versPoste', MOVE);             // CORE : GoToPotentialJobSite (priorite 7 du coeur ; il repose la cible de marche a chaque tick, avant les marches du temps libre)
    add(10, 'prendPoi', 0);                // CORE : AcquirePoi (poste 6, lit et cloche 10) et AssignProfessionFromJobSite (10)
    add(0, 'poiPerdus', 0);                // CORE : ValidateNearbyPoi (0), PoiCompetitorScan (2), YieldJobSite (8), ResetProfession (10)
  },
  initVillageois(d) {
    this.marche = null; this.cibleInteraction = null; this.cibleAmour = null; this.regardVerrou = null; this.posteVise = null;
    this.prochainPoi = { poste: 0, lit: 0, cloche: 0 };
    this.xpMetier = d?.xp ?? 0; this.posteBloc = null; this.poiInit = false; this.essaisPoi = {};   // experience de metier (Villager.xp), poste (JOB_SITE)
  },

  // ---- inventaire --------------------------------------------------------------------------------------------------------------------
  pointsNourriture() { let n = 0; for (const [k, v] of this.a.sac) n += (POINTS[k] ?? 0) * v; return n; },   // countFoodPointsInInventory
  aTropManger() { return this.pointsNourriture() >= NOMBRES.exces; },   // hasExcessFood : 24 points au moins
  veutManger() { return this.pointsNourriture() < NOMBRES.envie; },     // wantsMoreFood : moins de 12 points
  estFermier() { return this.metier() === 'farmer'; },
  demandes() { return this.estFermier() ? DEMANDES_FERMIER : []; },
  // Villager.wantsToPickUp : nourriture, #villager_picks_up ou ce que demande le metier ; et de la place (SimpleContainer.canAddItem)
  veutRamasser(item) {
    if (!(POINTS[item] > 0 || RAMASSES.has(item) || this.demandes().includes(item))) return false;
    let cases = 0; for (const v of this.a.sac.values()) cases += Math.ceil(v / PILE);
    return cases < CASES || ((this.a.sac.get(item) ?? 0) % PILE) !== 0;
  },
  // TradeWithVillager.throwHalfStack : la premiere pile qui convient ; plus de la moitie d'une pile (32) : la moitie ; plus de 24 : ce qui
  // depasse 24 ; sinon la pile suivante
  prendreDemiPile(test) {
    for (const [item, total] of this.a.sac) {
      if (!test(item)) continue;
      for (let reste = total; reste > 0; reste -= PILE) {
        const c = Math.min(PILE, reste), n = c > PILE / 2 ? Math.floor(c / 2) : c > 24 ? c - 24 : 0;
        if (n > 0) { if (total - n > 0) this.a.sac.set(item, total - n); else this.a.sac.delete(item); return [item, n]; }
      }
    }
    return null;
  },
  // BehaviorUtils.throwItem : depuis l'oeil - 0,3, vers la position de l'autre, vitesse 0,3, ramassable apres 10 ticks
  lancerObjet(item, n, o) {
    const a = this.a, sim = this.sim, y = a.oeil()[1] - 0.3;
    const dx = o.x - a.x, dy = o.y - a.y, dz = o.z - a.z, l = Math.hypot(dx, dy, dz) || 1;
    sim.entites.objet(item, n, a.x, y, a.z, { vx: dx / l * 0.3, vy: dy / l * 0.3, vz: dz / l * 0.3, delai: 10 });
    this.stat('lancers'); journal(sim, `${a.nom} lance ${n} ${item} a ${o.nom}`);
  },

  // ---- perception (NearestLivingEntitySensor : 16 blocs, en vue) ------------------------------------------------------------------------
  villageoisVus() {
    if (this._vus?.t === this.sim.temps) return this._vus.l;
    const l = this.autres().filter((o) => this.dist2(o) <= NOMBRES.vue2 && this.voit(o)).sort((p, q) => this.dist2(p) - this.dist2(q));
    this._vus = { t: this.sim.temps, l }; return l;
  },
  estVillageois(o) { return !!o && o.mort < 0 && o.ia?.type === 'villager'; },
  // Villager.canBreed : 12 points (mange + inventaire), eveille, adulte (age 0)
  peutSeReproduireV() { return this.faim + this.pointsNourriture() >= 12 && !this.sommeil && this.age === 0 && !this.bebe; },

  // ---- marche (WALK_TARGET + MoveToTargetSink) et regard (LOOK_TARGET) --------------------------------------------------------------------
  marcherVers(cible, vit, proche, duree = null) {
    this.marche = { cible, vit, proche, fin: this.sim.temps + (duree ?? 150 + this.h.entierBorne(100)) };   // MoveToTargetSink(150, 250) du coeur
  },
  posCible(c) { return Array.isArray(c) ? c : [c.x, c.y, c.z]; },
  // BehaviorUtils.lockGazeAndWalkToEachOther(a, b, 0,5, 2)
  verrouiller(o) {
    this.marcherVers(o, 0.5, 2); this.regardVerrou = { o, fin: this.sim.temps + 45 + this.h.entierBorne(45) };
    if (o.ia?.marcherVers) { o.ia.marcherVers(this.a, 0.5, 2); o.ia.regardVerrou = { o: this.a, fin: this.sim.temps + 45 + this.h.entierBorne(45) }; }
  },
  peut_marcheCible() { return !!this.marche && !this.sommeil; },
  continue_marcheCible() { const m = this.marche; return !!m && !this.sommeil && this.sim.temps <= m.fin && (Array.isArray(m.cible) || m.cible.mort < 0); },
  tick_marcheCible() {
    const m = this.marche, p = this.posCible(m.cible), b = bloc([this.a.x, this.a.y, this.a.z]), q = bloc(p);
    // MoveToTargetSink.reachedTarget : distance de Manhattan entre les blocs <= proche
    if (Math.abs(b[0] - q[0]) + Math.abs(b[1] - q[1]) + Math.abs(b[2] - q[2]) <= m.proche) { this.marche = null; this.nav = null; return; }
    this.allerVers(p[0], p[1], p[2], m.vit, { recalcul: 10, ouvrePortes: true, rayon: Math.max(0.4, m.proche) });
  },
  fin_marcheCible() { this.marche = null; this.nav = null; },
  apresVillageois() {
    const v = this.regardVerrou;
    if (v && (this.sim.temps > v.fin || v.o.mort >= 0)) this.regardVerrou = null;
    else if (v && !this.sommeil && !this.echangeAvec) this.regarder(v.o);
  },
  // ---- temps libre : RunOne (VillagerGoalPackages.getIdlePackage / getPlayPackage) ------------------------------------------------------
  peut_oisif() {
    if (this.sommeil || this.marche || this.sautLitEtat) return false;
    const act = this.activite();
    let options;
    if (act === 'libre') options = [['villageois', 2], ['amour', 1], ['chat', 1], ['flane', 1], ['versRegard', 1], ['sautLit', 1], ['rien', 1]];
    else if (act === 'jeu' && this.bebesVus().length === 0) options = [['villageois', 2], ['chat', 1], ['flane', 1], ['versRegard', 1], ['sautLit', 2], ['rien', 2]];   // VISIBLE_VILLAGER_BABIES absent
    else return false;
    for (const o of melanger(this.h, options)) {
      const r = this['option_' + o](act);
      if (r === 'tient') return true;   // ne rien faire : le RunOne reste actif
      if (r) return false;              // une marche est posee : MoveToTargetSink prend la suite
    }
    return false;
  },
  continue_oisif() { return !!this.rienJusque && this.sim.temps <= this.rienJusque && !this.marche; },
  fin_oisif() { this.rienJusque = 0; },
  tick_oisif() {},
  // InteractWith(VILLAGER, 8, INTERACTION_TARGET, 0,5, 2) : le villageois en vue le plus proche a 8 blocs
  option_villageois() {
    const o = this.villageoisVus().find((x) => this.estVillageois(x) && this.dist2(x) <= NOMBRES.interaction2);
    if (!o) return false;
    this.cibleInteraction = o; this.marcherVers(o, 0.5, 2); this.regardVerrou = { o, fin: this.sim.temps + 45 + this.h.entierBorne(45) };
    return true;
  },
  // InteractWith(VILLAGER, 8, canBreed, canBreed, BREED_TARGET, 0,5, 2)
  option_amour() {
    if (!this.peutSeReproduireV() || !this.sim.regles.valeur('reproduction.actif', true)) return false;
    const o = this.villageoisVus().find((x) => this.estVillageois(x) && x.ia.peutSeReproduireV() && this.dist2(x) <= NOMBRES.interaction2);
    if (!o) return false;
    this.cibleAmour = o; this.marcherVers(o, 0.5, 2); this.regardVerrou = { o, fin: this.sim.temps + 45 + this.h.entierBorne(45) };
    return true;
  },
  // InteractWith(CAT, 8, INTERACTION_TARGET, 0,5, 2)
  option_chat() {
    const o = this.villageoisVus().find((x) => x.ia?.type === 'cat' && this.dist2(x) <= NOMBRES.interaction2);
    if (!o) return false;
    this.cibleInteraction = o; this.marcherVers(o, 0.5, 2); return true;
  },
  // VillageBoundRandomStroll(0,5, 10, 7) : dans le village (a une section au plus d'une section du village) : LandRandomPos.getPos(10, 7) ;
  // dehors : vers le centre de la section la plus proche du village (BehaviorUtils.findSectionClosestToVillage, 2 sections autour ;
  // DefaultRandomPos.getPosTowards, pi/2), sinon LandRandomPos. Pas de point : le comportement a quand meme tourne (rien a faire).
  option_flane() {
    const a = this.a, sec = sectionDe(bloc([a.x, a.y, a.z])), V = this.sectionsVillage();
    let p;
    if (sectionsAuVillage(V, sec) <= 1) p = this.posAleatoireSol(10, 7);
    else {
      const best = sectionLaPlusProche(V, sec, 2);
      p = best.join() !== sec.join() ? this.posAleatoireVers(10, 7, [best[0] * 16 + 8 + 0.5, best[1] * 16 + 8, best[2] * 16 + 8 + 0.5], Math.fround(Math.PI / 2)) : this.posAleatoireSol(10, 7);
    }
    if (p) this.marcherVers(p, 0.5, 0);
    return true;
  },
  // SetWalkTargetFromLookTarget(0,5, 2) : il marche vers ce qu'il regarde
  option_versRegard() {
    const r = this.regardLibre; if (!r || this.sim.temps >= r.fin) return false;
    const c = r.o ?? r.p; if (!c) return false;
    this.marcherVers(r.o ? r.o : [c[0], this.a.y, c[2]], 0.5, 2); return true;
  },
  // JumpOnBed (bebes) : le lit le plus proche qu'il peut atteindre (48 blocs) ; 100 ticks pour y arriver, 3 a 6 sauts, 5 ticks entre deux
  option_sautLit() {
    if (!this.bebe) return false;
    const lit = this.litLePlusProche(); if (!lit) return false;
    this.sautLitEtat = { lit, reste: 100, sauts: 3 + this.h.entierBorne(4), attente: 0 };
    this.marcherVers([lit[0] + 0.5, lit[1], lit[2] + 0.5], 0.5, 0); return true;
  },
  // DoNothing(30, 60) (temps libre) ou (20, 40) (jeu)
  option_rien(act) { this.rienJusque = this.sim.temps + (act === 'jeu' ? 20 + this.h.entierBorne(21) : 30 + this.h.entierBorne(31)); this.nav = null; return 'tient'; },
  peut_sautLit() { return !!this.sautLitEtat; },
  continue_sautLit() {
    const s = this.sautLitEtat; if (!s || !this.bebe) return false;
    const sur = this.surLit(), lit = this.estLit(s.lit);
    return lit && (sur || s.reste > 0) && (!sur || s.sauts > 0);
  },
  tick_sautLit() {
    const s = this.sautLitEtat, sur = this.surLit();
    if (!sur) s.reste--;
    else if (s.attente > 0) s.attente--;
    else if (this.estLit(bloc([this.a.x, this.a.y, this.a.z]))) { this.a.saut = true; s.sauts--; s.attente = 5; }
  },
  fin_sautLit() { this.sautLitEtat = null; },
  estLit(p) { const e = this.sim.monde.etatEn(p[0], p[1], p[2]); return e >= 0 && this.sim.d.nomBloc(e).endsWith('_bed'); },
  surLit() { const b = bloc([this.a.x, this.a.y, this.a.z]); return this.estLit(b) || this.estLit([b[0], b[1] - 1, b[2]]); },

  // Les sections du village (PoiManager : sections qui ont un POI PRIS) : lits, postes, postes vises et cloches des villageois vivants dont le
  // bloc est encore un POI (Horizon villager_brain.rs village_sections) ; un point de travail de la scene qui n'est pas un bloc de metier ne compte pas
  sectionsVillage() {
    const sim = this.sim;
    if (sim._sectionsVillage?.t === sim.temps) return sim._sectionsVillage.l;
    const l = [], vus = new Set();
    for (const v of sim.acteurs.liste) {
      if (v.mort >= 0 || v.ia?.type !== 'villager') continue;
      for (const p of [v.ia.posteBloc, v.ia.posteVise, v.ia.lit, v.ia.rassemblement]) {
        if (!p || !this.poiEn(p)) continue;
        const s = sectionDe(bloc(p)), k = s.join(); if (!vus.has(k)) { vus.add(k); l.push(s); }
      }
    }
    sim._sectionsVillage = { t: sim.temps, l }; return l;
  },
  dansVillage(p) { return sectionsAuVillage(this.sectionsVillage(), sectionDe(bloc(p))) <= 1; },
  // genre de POI du bloc (lit : la tete ; un pied de lit compte par sa tete), ou null
  poiEn(p) {
    const sim = this.sim, b = bloc(p), e = sim.monde.etatEn(b[0], b[1], b[2]); if (e < 0) return null;
    const n = sim.d.nomBloc(e);
    return n.endsWith('_bed') ? 'lit' : POSTES[n] ? 'poste' : n === 'bell' ? 'cloche' : null;
  },
  // ---- points au hasard (LandRandomPos.getPos, DefaultRandomPos.getPosTowards : le meilleur de 10 essais ; le poids de marche du villageois
  // est 0 partout : le premier point valide) -------------------------------------------------------------------------------------------
  posAleatoireSol(h, v) {
    const a = this.a, H = this.h;
    let best = null;
    for (let i = 0; i < 10; i++) {
      const d = [H.entierBorne(2 * h + 1) - h, H.entierBorne(2 * v + 1) - v, H.entierBorne(2 * h + 1) - h];
      let p = [Math.floor(a.x + d[0]), Math.floor(a.y + d[1]), Math.floor(a.z + d[2])];
      if (!best && this.destinationStable(p)) { p = this.sortirDuSolide(p); if (p) best = p; }
    }
    return best ? [best[0] + 0.5, best[1], best[2] + 0.5] : null;
  },
  posAleatoireVers(h, v, vers, maxRad) {
    const a = this.a, H = this.h, centre = Math.atan2(vers[2] - a.z, vers[0] - a.x) - Math.fround(Math.PI / 2);
    let best = null;
    for (let i = 0; i < 10; i++) {
      const yr = centre + (2 * H.flottant() - 1) * maxRad, dist = Math.sqrt(H.reel()) * h * Math.fround(Math.SQRT2);
      const xt = -dist * Math.sin(yr), zt = dist * Math.cos(yr);
      if (Math.abs(xt) > h || Math.abs(zt) > h) continue;
      const yt = H.entierBorne(2 * v + 1) - v, p = [Math.floor(a.x + Math.floor(xt)), Math.floor(a.y + yt), Math.floor(a.z + Math.floor(zt))];
      if (!best && this.destinationStable(p) && this.caseOuverte(p)) best = p;
    }
    return best ? [best[0] + 0.5, best[1], best[2] + 0.5] : null;
  },
  // GroundPathNavigation.isStableDestination : le bloc dessous est un bloc plein opaque (isSolidRender)
  destinationStable(p) { const e = this.sim.monde.etatEn(p[0], p[1] - 1, p[2]); return e >= 0 && this.sim.d.opacite(e) >= 15 && this.solide(p[0], p[1] - 1, p[2]); },
  solide(x, y, z) { return coupe(this.a.lec, [x + 0.01, y + 0.01, z + 0.01, x + 0.99, y + 0.99, z + 0.99]); },
  // RandomPos.moveUpOutOfSolid puis : pas dans l'eau, case sans malus (ouverte : la boite y tient, rien de dangereux)
  sortirDuSolide(p) {
    p = p.slice(); while (p[1] < 320 && this.solide(p[0], p[1], p[2])) p[1]++;
    return this.caseOuverte(p) ? p : null;
  },
  caseOuverte(p) {
    const sim = this.sim, a = this.a;
    for (const dy of [0, 1]) { const f = sim.fluide(p[0], p[1] + dy, p[2]); if (f.type) return false; const e = sim.monde.etatEn(p[0], p[1] + dy, p[2]); if (e >= 0 && DANGER.test(sim.d.nomBloc(e))) return false; }
    const L = Math.max(0.6, a.L) / 2;
    return !coupe(a.lec, [p[0] + 0.5 - L, p[1] + 0.01, p[2] + 0.5 - L, p[0] + 0.5 + L, p[1] + a.H, p[2] + 0.5 + L]);
  },
  // ---- jeu des bebes : PlayTagWithOtherKids (1 chance sur 10 ; poursuite a 0,6) --------------------------------------------------------
  bebesVus() { return this.villageoisVus().filter((o) => this.estVillageois(o) && o.ia.bebe); },
  peut_jeuBebe() {
    if (!this.bebe || this.sommeil || this.marche || this.activite() !== 'jeu') return false;
    const amis = this.bebesVus(); if (!amis.length) return false;
    if (this.h.entierBorne(10) !== 0) return false;
    const poursuivi = amis.some((f) => f.ia.cibleInteraction === this.a);
    if (!poursuivi) {
      // l'enfant poursuivi par le moins de poursuivants (1 a 5), sinon le premier ami
      const n = new Map(); for (const f of amis) { const c = f.ia.cibleInteraction; if (c) n.set(c, (n.get(c) ?? 0) + 1); }
      let cible = null, min = Infinity; for (const [k, v] of n) if (v > 0 && v <= 5 && v < min) { min = v; cible = k; }
      cible ??= amis[0];
      this.cibleInteraction = cible; this.marcherVers(cible, 0.6, 1, 80 + this.h.entierBorne(41)); this.regardVerrou = { o: cible, fin: this.sim.temps + 45 };
      this.stat('poursuites'); journal(this.sim, `${this.a.nom} poursuit ${cible.nom}`);
    } else {
      // poursuivi : il court (0,6) vers un point LandRandomPos.getPos(20, 8) qui reste dans le village (sectionsToVillage <= 1), 10 essais
      const a = this.a, h = this.h;
      for (let i = 0; i < 10; i++) {
        const p = this.posAleatoireSol(20, 8);
        if (!p || !this.dansVillage(p)) continue;
        this.marcherVers(p, 0.6, 0, 80 + h.entierBorne(41)); journal(this.sim, `${a.nom} s enfuit en riant`); break;
      }
    }
    return false;
  },
  tick_jeuBebe() {},

  // ---- echanges entre villageois : TradeWithVillager (60 ticks) ------------------------------------------------------------------------
  peut_echangeVillageois() {
    const o = this.cibleInteraction, act = this.activite();
    if (!this.estVillageois(o) || (act !== 'libre' && act !== 'rassemblement') || this.sommeil) return false;
    this.echangeFinV = this.sim.temps + NOMBRES.echange; this.verrouiller(o);
    return true;
  },
  continue_echangeVillageois() { return this.sim.temps <= this.echangeFinV && this.estVillageois(this.cibleInteraction) && !this.sommeil; },
  fin_echangeVillageois() { this.cibleInteraction = null; },
  tick_echangeVillageois() {
    const o = this.cibleInteraction;
    if (this.dist2(o) > NOMBRES.proche2) return;
    this.verrouiller(o);
    this.bavarder?.(o);   // Villager.gossip (une fois en 1200 ticks pour les deux), puis l'appel du golem (5)
    // nourriture en trop (24 points) : au fermier qui la donne a tous, ou a celui qui en veut (moins de 12 points)
    if (this.aTropManger() && (this.estFermier() || o.ia.veutManger())) { const p = this.prendreDemiPile((i) => POINTS[i] > 0); if (p) this.lancerObjet(p[0], p[1], o); }
    // le ble du fermier (plus de 32)
    if (this.estFermier() && (this.a.sac.get('wheat') ?? 0) > NOMBRES.bleFermier) { const p = this.prendreDemiPile((i) => i === 'wheat'); if (p) this.lancerObjet(p[0], p[1], o); }
    // ce que demande le metier de l'autre et pas le sien
    const voulu = (o.ia.demandes?.() ?? []).filter((i) => !this.demandes().includes(i));
    if (voulu.length) { const p = this.prendreDemiPile((i) => voulu.includes(i)); if (p) this.lancerObjet(p[0], p[1], o); }
  },

  // ---- reproduction : VillagerMakeLove (au plus 350 ticks ; naissance 275 + nextInt(50) apres le debut) ----------------------------------
  reproductionPossible() { const o = this.cibleAmour; return this.estVillageois(o) && this.peutSeReproduireV() && o.ia.peutSeReproduireV(); },
  peut_amourVillageois() {
    if (!this.cibleAmour || !this.reproductionPossible()) { if (this.cibleAmour && !this.reproductionPossible()) this.cibleAmour = null; return false; }
    const t = this.sim.temps;
    this.verrouiller(this.cibleAmour);
    this.naissanceV = t + NOMBRES.naissanceMin + this.h.entierBorne(NOMBRES.naissanceAlea); this.amourFin = t + NOMBRES.amourMax;
    this.stat('amoursVillageois'); journal(this.sim, `${this.a.nom} et ${this.cibleAmour.nom} se plaisent`);
    return true;
  },
  continue_amourVillageois() { const t = this.sim.temps; return t <= this.naissanceV && t <= this.amourFin && this.reproductionPossible(); },
  fin_amourVillageois() { this.cibleAmour = null; this.naissanceV = undefined; },
  tick_amourVillageois() {
    const p = this.cibleAmour, sim = this.sim;
    if (this.dist2(p) > NOMBRES.proche2) return;
    this.verrouiller(p);
    if (sim.temps >= this.naissanceV) this.donnerNaissance(p);
    else if (this.h.entierBorne(NOMBRES.coeurs) === 0) { p.ia.particulesAutour('heart', 5, 1); this.particulesAutour('heart', 5, 1); }   // evenement 12 : le partenaire, puis lui
  },
  // VillagerMakeLove.tryToGiveBirth : les deux mangent (eatAndDigestFood) ; un lit libre (takeVacantBed) ; le bebe (getBreedOffspring)
  donnerNaissance(p) {
    const a = this.a, sim = this.sim;
    this.mangerEtDigerer();
    const lit = this.litLibre();
    let typeV = null;
    if (lit) {
      const r = this.h.reel();   // la moitie : le type du biome ; un quart chacun : celui d'un parent
      typeV = r < 0.5 ? null : r < 0.75 ? this.typeVillageois() : p.ia.typeVillageois();
      this.age = NOMBRES.attenteParents;
    }
    p.ia.mangerEtDigerer();
    if (!lit) {   // evenement 13 : colere, le partenaire puis lui
      p.ia.particulesAutour('angry_villager', 5, 1); this.particulesAutour('angry_villager', 5, 1);
      journal(sim, `${a.nom} et ${p.nom} : pas de lit libre, pas de bebe`); this.stat('sansLit'); return;
    }
    typeV ??= typeDuBiome(sim.zone.biome?.(Math.floor(a.x), Math.floor(a.z)));   // Zone.biome(x, z) : un biome par colonne
    p.ia.age = NOMBRES.attenteParents;
    const b = sim.acteurs.naitre({ type: 'villager', variante: `${typeV} none`, bebe: true, x: a.x, y: a.y, z: a.z, lacet: 0, modele: a.nom, raison: 'reproduction', gabaritParent: { l: a.L, h: a.H, oeil: a.O, vitesse: a.kVit }, ia: { lit, parents: [a.nom, p.nom], maison: this.maison ?? null, rassemblement: this.rassemblement ?? null } });
    if (b) { b.ia.particulesAutour('heart', 5, 1); this.stat('naissances'); journal(sim, `${a.nom} et ${p.nom} ont un bebe villageois : ${b.nom} (lit ${lit.join(',')})`); }
  },
  typeVillageois() { return lireVariante('villager', this.variante).choix?.[0] ?? 'plains'; },

  // ---- lits, postes, cloches (POI) ----------------------------------------------------------------------------------------------------
  // PoiManager.getInRange : la SPHERE de 48 blocs (distSqr entre le bloc du villageois et celui du POI <= 48 x 48, comme Horizon
  // villager_brain.rs pois_in_range). La liste brute est gardee 100 ticks par section de 16 blocs : elle couvre les chunks a 48 + 8 blocs du
  // centre de la section, dans l'ordre du jeu (chunk par chunk en z puis x ; dans un chunk : y, z, x), bornee a la boite du monde.
  pois() {
    const sim = this.sim, a = this.a, o = bloc([a.x, a.y, a.z]), cle = `${o[0] >> 4},${o[1] >> 4},${o[2] >> 4}`;
    const C = (sim._poiCache ??= new Map()), c = C.get(cle);
    if (c && sim.temps - c.t < 100) return c.l;
    const l = [], d = sim.d, m = sim.monde, R = NOMBRES.litRayon + 8, cx = (o[0] >> 4) * 16 + 8, cy = (o[1] >> 4) * 16 + 8, cz = (o[2] >> 4) * 16 + 8;
    const x0 = Math.max(cx - R, m.x0), x1 = Math.min(cx + R, m.x0 + m.sx - 1), z0 = Math.max(cz - R, m.z0), z1 = Math.min(cz + R, m.z0 + m.sz - 1);
    const y0 = Math.max(cy - R, m.y0), y1 = Math.min(cy + R, m.y0 + m.sy - 1);
    for (let qz = z0 >> 4; qz <= z1 >> 4; qz++) for (let qx = x0 >> 4; qx <= x1 >> 4; qx++) {
      for (let y = y0; y <= y1; y++) for (let z = Math.max(z0, qz * 16); z <= Math.min(z1, qz * 16 + 15); z++) for (let x = Math.max(x0, qx * 16); x <= Math.min(x1, qx * 16 + 15); x++) {
        const e = m.etatEn(x, y, z); if (e < 0) continue;
        const n = d.nomBloc(e);
        if (n.endsWith('_bed')) { if (d.prop(e, 'part') === 'head') l.push({ p: [x, y, z], genre: 'lit' }); }
        else if (POSTES[n]) l.push({ p: [x, y, z], genre: 'poste', metier: POSTES[n] });
        else if (n === 'bell') l.push({ p: [x, y, z], genre: 'cloche' });
      }
    }
    const P = (sim._poiPos ??= new Set()); for (const q of l) P.add(q.p.join());
    C.set(cle, { t: sim.temps, l }); return l;
  },
  // les POI de la sphere de 48 blocs autour du bloc du villageois, les plus proches d'abord (distSqr ; egalite : l'ordre du parcours)
  poisProches(test) {
    const c = bloc([this.a.x, this.a.y, this.a.z]), R2 = NOMBRES.litRayon * NOMBRES.litRayon, d2 = (p) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
    return this.pois().filter((q) => d2(q.p) <= R2 && test(q)).map((q, i) => ({ q, i, d: d2(q.p) })).sort((u, v) => u.d - v.d || u.i - v.i).map((x) => x.q);
  },
  poiValide(q) { const e = this.sim.monde.etatEn(q.p[0], q.p[1], q.p[2]); if (e < 0) return false; const n = this.sim.d.nomBloc(e); return q.genre === 'lit' ? n.endsWith('_bed') && this.sim.d.prop(e, 'part') === 'head' && this.sim.d.prop(e, 'occupied') !== 'true' : q.genre === 'poste' ? POSTES[n] === q.metier : n === 'bell'; },
  // tickets pris par les villageois vivants (lui compris) (lit, poste, poste vise, cloche) ; un POI a 1 ticket (lit, poste), la cloche 32
  tickets(genre) {
    const s = new Map(), add = (p) => { const k = bloc(p).join(); s.set(k, (s.get(k) ?? 0) + 1); };
    for (const v of this.sim.acteurs.liste) {
      if (v.mort >= 0 || !v.ia || v.ia.type !== 'villager') continue;   // ses propres POI comptent aussi (Horizon tickets)
      if (genre === 'lit' && v.ia.lit) { add(v.ia.lit); const t = teteLit(this.sim, bloc(v.ia.lit)); if (t.join() !== bloc(v.ia.lit).join()) add(t); }
      if (genre === 'poste') { for (const p of [v.ia.posteBloc, v.ia.posteVise]) if (p) add(p); }
      if (genre === 'cloche' && v.ia.rassemblement) add(v.ia.rassemblement);
    }
    return s;
  },
  pris(genre) { const t = this.tickets(genre), max = genre === 'cloche' ? 32 : 1; return new Set([...t].filter(([, n]) => n >= max).map(([k]) => k)); },
  // un chemin y mene (canReach : validRange 1)
  atteignable(p) {
    const a = this.a;
    const r = chercherChemin(a.lec, [a.x, a.y, a.z], { x: p[0] + 0.5, z: p[2] + 0.5, y: p[1] }, { ouvrePortes: true, rayon: 1, suivi: Math.max(this.pr.suivi ?? 16, this.pr.chemin ?? 0), gabarit: this.gabaritNav(), auSol: a.auSol, dansEau: a.dansEau });   // createPath(poi, 1) : accuracy 1
    return r.complet;
  },
  // AcquirePoi : les candidats de la sphere (les plus proches d'abord), filtres par l'attente de chacun (JitteredLinearRetry : un POI sans
  // chemin attend 40 + [0, 40[ ticks de plus a chaque echec, 400 au plus, oublie apres 400 ticks), les 5 premiers ; le premier qu'un chemin
  // atteint est pris (et les attentes effacees) ; sinon chacun recoit une attente
  premierAtteignable(liste, k = 'lit') {
    const t = this.sim.temps, R = (this.essaisPoi ??= {})[k] ??= new Map();
    for (const [p, r] of R) if (t - r.prec >= 400) R.delete(p);
    const marquer = (r) => { r.prec = t; r.delai = Math.min(400, r.delai + this.h.entierBorne(40) + 40); r.proch = t + r.delai; };
    const gardes = [];
    for (const q of liste) {
      const r = R.get(q.p.join());
      if (!r) gardes.push(q); else if (t >= r.proch) { marquer(r); gardes.push(q); }
    }
    const cinq = gardes.slice(0, 5), trouve = cinq.find((q) => this.atteignable(q.p)) ?? null;
    if (trouve) R.clear();
    else for (const q of cinq) if (!R.has(q.p.join())) { const r = { prec: 0, proch: 0, delai: 0 }; marquer(r); R.set(q.p.join(), r); }
    return trouve;
  },
  // VillagerMakeLove.takeVacantBed : PoiManager.take(HOME, 48) : la tete de lit la plus proche, libre (aucun villageois, pas occupee), atteignable
  litLibre() {
    const pris = this.pris('lit');
    const q = this.premierAtteignable(this.poisProches((x) => x.genre === 'lit' && !pris.has(x.p.join()) && this.poiValide(x)), 'naissance');
    return q ? q.p : null;
  },
  // NearestBedSensor (bebes) : le lit le plus proche qu'il peut atteindre, pris ou non
  litLePlusProche() { const q = this.poisProches((x) => x.genre === 'lit').find((x) => this.atteignable(x.p)); return q ? q.p : null; },
  niveauMetier() { return Number(lireVariante('villager', this.variante).choix?.[2] ?? 1) || 1; },
  // AcquirePoi : un essai toutes les 20 a 39 ticks (le premier dans les 20 ticks) ; lit (tous), cloche (adultes), poste (adultes sans poste
  // ni poste vise, sans metier : tous les blocs ; avec un metier : le sien ; pas l'idiot)
  peut_prendPoi() {
    const sim = this.sim, t = sim.temps, a = this.a;
    if (this.sommeil) return false;
    const essai = (k) => { const n = this.prochainPoi[k]; if (n === 0) { this.prochainPoi[k] = t + this.h.entierBorne(20) || 1; return false; } if (t < n) return false; this.prochainPoi[k] = t + 20 + this.h.entierBorne(20); return true; };
    if (!this.lit && essai('lit')) {
      const pris = this.pris('lit');
      const q = this.premierAtteignable(this.poisProches((x) => x.genre === 'lit' && !pris.has(x.p.join()) && this.poiValide(x)), 'lit');
      if (q) { this.lit = q.p; this.particulesAutour('happy_villager', 5, 1); this.stat('litsPris'); journal(sim, `${a.nom} prend le lit ${q.p.join(',')}`); }
    }
    const m = this.metier();
    if (!this.bebe && !this.travail && !this.posteVise && m !== 'nitwit' && essai('poste')) {
      const pris = this.pris('poste');
      const q = this.premierAtteignable(this.poisProches((x) => x.genre === 'poste' && (m === 'none' || x.metier === m) && !pris.has(x.p.join()) && this.poiValide(x)), 'poste');
      if (q) { this.posteVise = q.p; journal(sim, `${a.nom} vise le poste ${sim.d.nomBloc(sim.monde.etatEn(...q.p))} ${q.p.join(',')} (${Math.sqrt((q.p[0] - Math.floor(a.x)) ** 2 + (q.p[1] - Math.floor(a.y)) ** 2 + (q.p[2] - Math.floor(a.z)) ** 2).toFixed(1)} blocs, ${q.p[1] - Math.floor(a.y) >= 0 ? '+' : ''}${q.p[1] - Math.floor(a.y)} en hauteur)`); }
    }
    if (!this.bebe && !this.rassemblement && essai('cloche')) {
      const pris = this.pris('cloche');
      const q = this.premierAtteignable(this.poisProches((x) => x.genre === 'cloche' && !pris.has(x.p.join()) && this.poiValide(x)), 'cloche');
      if (q) { this.rassemblement = q.p; this.particulesAutour('happy_villager', 5, 1); journal(sim, `${a.nom} prend la cloche ${q.p.join(',')}`); }
    }
    // AssignProfessionFromJobSite : a moins de 2 blocs du centre du poste vise, il le prend ; sans metier : celui du bloc
    const p = this.posteVise;
    if (p && (p[0] + 0.5 - a.x) ** 2 + (p[1] + 0.5 - a.y) ** 2 + (p[2] + 0.5 - a.z) ** 2 < 4) {
      this.posteVise = null; this.travail = [p[0] + 0.5, p[1], p[2] + 0.5]; this.posteBloc = p.slice();
      this.particulesAutour('happy_villager', 5, 1);   // evenement 14
      const nouveau = POSTES[sim.d.nomBloc(sim.monde.etatEn(p[0], p[1], p[2]))];
      if (m === 'none' && nouveau) {
        this.variante = `${this.typeVillageois()} ${nouveau}`; this.changer({ variante: this.variante });
        this.stat('metiers'); journal(sim, `${a.nom} devient ${nouveau} (poste ${p.join(',')})`);
      } else journal(sim, `${a.nom} prend son poste ${p.join(',')}`);
    }
    return false;
  },
  tick_prendPoi() {},
  // ---- POI perdus (coeur, priorite 0 a 10 du jeu) ------------------------------------------------------------------------------------
  // ValidateNearbyPoi (poste, poste vise ; lit au repos ; cloche au rassemblement) : a moins de 16 blocs du centre du bloc, le POI n'existe plus
  // (ou n'est plus du bon metier) : oublie ; un lit ou dort un autre : oublie. PoiCompetitorScan : un villageois du meme metier a 16 blocs qui a
  // le meme poste : celui qui a le plus d'experience le garde, a egalite c'est l'autre (selectWinner). YieldJobSite : un adulte sans metier
  // laisse le poste vise a un villageois vu du metier de ce bloc qui n'a pas de poste vise et pas d'autre poste. ResetProfession : sans poste,
  // un novice (niveau 1) qui n'a jamais echange (xp 0) perd son metier (pas l'idiot) ; il en reprendra un au prochain poste libre (AcquirePoi).
  // Un point `travail` de la scene qui n'est pas un bloc de metier reste un point de mise en scene : il n'est jamais perdu.
  peut_poiPerdus() {
    const sim = this.sim, a = this.a, m = this.metier(), act = this.activite();
    if (!this.poiInit) {   // un `travail` de la scene pose sur un bloc de metier est un vrai poste (POI)
      this.poiInit = true;
      if (this.travail) { const b = bloc(this.travail); if (POSTES[sim.d.nomBloc(sim.monde.etatEn(b[0], b[1], b[2]))]) this.posteBloc = b; }
    }
    const pres = (p) => (p[0] + 0.5 - a.x) ** 2 + (p[1] + 0.5 - a.y) ** 2 + (p[2] + 0.5 - a.z) ** 2 < 256;
    const blocEn = (p) => { const e = sim.monde.etatEn(p[0], p[1], p[2]); return e >= 0 ? sim.d.nomBloc(e) : ''; };
    const employe = m !== 'none' && m !== 'nitwit';
    if (this.posteBloc && pres(this.posteBloc) && !(employe && POSTES[blocEn(this.posteBloc)] === m)) {
      journal(sim, `${a.nom} perd son poste ${this.posteBloc.join(',')} (${blocEn(this.posteBloc).replace(/_/g, ' ') || 'bloc casse'})`); this.stat('postesPerdus');
      this.posteBloc = null; this.travail = null;
    }
    if (this.posteVise && pres(this.posteVise) && !(POSTES[blocEn(this.posteVise)] && (m === 'none' || (employe && POSTES[blocEn(this.posteVise)] === m)))) { this.posteVise = null; this.nav = null; }
    if (this.lit && act === 'repos' && !this.sommeil && pres(this.lit)) {
      const t = teteLit(sim, bloc(this.lit)), autre = sim.acteurs.liste.some((v) => v !== a && v.mort < 0 && v.ia?.sommeil && v.ia.lit && bloc(v.ia.lit).join() === t.join());
      if (!blocEn(t).endsWith('_bed') || autre) { journal(sim, `${a.nom} perd son lit ${this.lit.join(',')}`); this.lit = null; }
    }
    if (this.rassemblement && act === 'rassemblement' && pres(this.rassemblement) && blocEn(this.rassemblement) !== 'bell') this.rassemblement = null;
    // PoiCompetitorScan
    if (this.posteBloc) {
      let gagnant = this.xpMetier, moi = true;
      for (const o of this.autres()) {
        if (o.ia?.type !== 'villager' || this.dist2(o) > NOMBRES.vue2 || !o.ia.posteBloc || o.ia.posteBloc.join() !== this.posteBloc.join() || o.ia.metier() !== m) continue;
        if (!(gagnant > o.ia.xpMetier)) {
          if (moi) { journal(sim, `${a.nom} laisse le poste ${this.posteBloc.join(',')} a ${o.nom} (experience ${this.xpMetier} contre ${o.ia.xpMetier})`); this.stat('postesPerdus'); this.posteBloc = null; this.travail = null; }
          moi = false; gagnant = o.ia.xpMetier;
        }
      }
    }
    // YieldJobSite
    if (this.posteVise && !this.posteBloc && !this.bebe && m === 'none') {
      const metierBloc = POSTES[blocEn(this.posteVise)];
      if (metierBloc) for (const o of this.autres()) {
        if (o.ia?.type !== 'villager' || this.dist2(o) > NOMBRES.vue2 || o.ia.posteVise || o.ia.metier() !== metierBloc) continue;
        if (!o.ia.posteBloc || o.ia.posteBloc.join() === this.posteVise.join()) { journal(sim, `${a.nom} laisse le poste vise ${this.posteVise.join(',')} a ${o.nom}`); this.posteVise = null; this.marche = null; this.nav = null; break; }
      }
    }
    // ResetProfession
    if (!this.travail && employe && this.xpMetier === 0 && this.niveauMetier() <= 1) {
      this.variante = `${this.typeVillageois()} none`; this.changer({ variante: this.variante });
      this.stat('metiersPerdus'); journal(sim, `${a.nom} perd son metier (${m} novice sans experience, sans poste)`);
    }
    return false;
  },
  tick_poiPerdus() {},
  // GoToPotentialJobSite (au plus 1200 ticks, temps libre, travail ou jeu) : il va au poste vise (0,5 ; a 1 bloc)
  peut_versPoste() {
    if (!this.posteVise || this.sommeil || !['libre', 'travail', 'jeu'].includes(this.activite())) return false;
    this.versPosteFin = this.sim.temps + 1200; return true;
  },
  continue_versPoste() { return !!this.posteVise && this.sim.temps <= this.versPosteFin && !this.sommeil; },
  tick_versPoste() { const p = this.posteVise; if (!p) return; this.regarder([p[0] + 0.5, p[1] + 0.5, p[2] + 0.5]); this.allerVers(p[0] + 0.5, p[1], p[2] + 0.5, 0.5, { recalcul: 20, ouvrePortes: true, rayon: 1.2 }); },
  fin_versPoste() { this.nav = null; if (this.posteVise && this.sim.temps > this.versPosteFin) this.posteVise = null; },

  // ---- ramasser (GoToWantedItem : 4 blocs, 0,5 ; Mob.aiStep : boite elargie de 1, 0, 1) -----------------------------------------------
  peut_ramasseNourriture() {
    if (this.sommeil || this.marche || this.activite() === 'repos') return false;
    const a = this.a, oeil = a.oeil(); let best = null, bd = 16;
    for (const e of this.sim.entites.liste) {
      if (e.type !== 'objet' || e.pris || !this.veutRamasser(e.item)) continue;
      const d = (e.x - a.x) ** 2 + (e.y - a.y) ** 2 + (e.z - a.z) ** 2;
      if (d < bd && rayonBloc(a.lec, oeil, [e.x, e.y + 0.2125, e.z]) === null) { bd = d; best = e; }
    }
    this.objetVise = best; return !!best;
  },
  continue_ramasseNourriture() { const e = this.objetVise; return !!e && !e.pris && this.sim.entites.liste.includes(e) && !this.navFinie(); },
  debut_ramasseNourriture() { const e = this.objetVise; this.allerVers(e.x, undefined, e.z, 0.5, { recalcul: 20, rayon: 0.4 }); },
  tick_ramasseNourriture() { const e = this.objetVise; if (e) this.regarder([e.x, e.y + 0.2125, e.z]); },
  ramasserObjets() {
    const a = this.a, sim = this.sim;
    if (this.sommeil || !sim.entites.liste.length) return;
    const b = a.boite(), bx = [b[0] - 1, b[1], b[2] - 1, b[3] + 1, b[4], b[5] + 1];
    for (const e of sim.entites.liste) {
      if (e.type !== 'objet' || e.pris || e.delai > 0 || sim.entites._fini?.has(e) || !this.veutRamasser(e.item)) continue;
      if (e.x < bx[0] || e.x > bx[3] || e.y + 0.25 < bx[1] || e.y > bx[4] || e.z < bx[2] || e.z > bx[5]) continue;
      e.pris = { acteur: a, k: 0, de: [e.x, e.y, e.z] }; a.sac.set(e.item, (a.sac.get(e.item) || 0) + e.n);
      sim.son('entity.item.pickup', e.x, e.y, e.z, 0.2, (sim.hasard.flottant() - sim.hasard.flottant()) * 1.4 + 2);
      this.stat('ramassesVillageois'); journal(sim, `${a.nom} ramasse ${e.n} ${e.item}`);
    }
  },
  // WorkAtComposter.makeBread : au travail, jusqu'a 3 pains pour 9 bles, tant qu'il a 36 pains au plus
  fairePain() {
    const s = this.a.sac;
    if (!this.estFermier() || (s.get('bread') ?? 0) > 36) return;
    const n = Math.min(3, Math.floor((s.get('wheat') ?? 0) / 3)); if (n <= 0) return;
    const w = s.get('wheat') - n * 3; if (w > 0) s.set('wheat', w); else s.delete('wheat');
    s.set('bread', (s.get('bread') ?? 0) + n); journal(this.sim, `${this.a.nom} fait ${n} pain(s) au composteur`);
  },
};

function teteLit(sim, l) {
  const e = sim.monde.etatEn(l[0], l[1], l[2]);
  if (e < 0 || sim.d.prop(e, 'part') !== 'foot') return l;
  const f = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[sim.d.prop(e, 'facing')] ?? [0, 0];
  return [l[0] + f[0], l[1], l[2] + f[1]];
}
void memeBloc;
