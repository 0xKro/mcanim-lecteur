// IA des creatures (champ d'acteur `ia: true`) : un selecteur de buts par priorites comme le jeu (GoalSelector : le but de plus petite
// priorite qui peut demarrer prend les drapeaux MOUVEMENT/REGARD ; il interrompt un but moins prioritaire), une navigation a la boite du
// type (moteur/navigation.js, gabarit), les cibles (NearestAttackableTarget, HurtByTarget) et le combat du jeu.
// Port COMPACT, d'apres Horizon (MIT, voir ATTRIBUTIONS.md) : mobs/goals.rs (MeleeAttack, Stroll, LookAtPlayer, RandomLookAround, Panic,
// AvoidEntity, Float, NearestTarget, HurtByTarget), mobs/undead.rs (enregistrement des zombies et squelettes, BowAttack, perform_ranged_attack,
// bow_power), mobs/rabbit.rs (fuite du lapin) ; nombres du jeu : creeper (SwellGoal, maxSwell 30, rayon 3 / 6 charge), golem de fer
// (doHurtTarget : 7,5 + [0, 15[ et 0,4 vers le haut), degats selon la difficulte (Player.hurt : facile min(d / 2 + 1, d), difficile x 1,5),
// brulure au soleil (Mob.isSunBurnTick), portes cassees par les zombies en difficile (BreakDoorGoal, 240 ticks).
// Le reste est dans les modules melanges a la classe (ia-especes, ia-vie, ia-villageois, ia-boss, ia-eau, ia-warden, ia-oeufs) : cerveau complet
// du villageois, conversions, enderman, sorciere, boules de feu, nage, boss (docs/SIMULATION.md parties 15 a 22). L'apparition spontanee des
// mobs (spawn) n'est pas voulue : le realisateur place ses creatures.
// Tout passe par l'API publique : evenements `creature.cible`, `creature.attaque` (annulable, ev.degats modifiable), `creature.explose`
// (annulable, ev.puissance), regles `monde.difficulte` et `ia.*` (mcanim regles --liste ia).
import { chercherChemin, blocsOuvrables } from './navigation.js';
import { rayonBloc } from './collision.js';
import { exploser } from './explosion.js';
import { VOLS, METHODES } from './ia-especes.js';
import { VIE, declarerReglesVie } from './ia-vie.js';   // age, amour, bebes, abeilles, danse, conversions, golems, blocs de l'enderman
import { METHODES_BOSS, declarerReglesBoss } from './ia-boss.js';   // wither, dragon de l'Ender
import { METHODES_EAU } from './ia-eau.js';   // nage dirigee : poissons, bancs, calmars, dauphins, axolotls, tortues, gardiens
import { METHODES_WARDEN } from './ia-warden.js';
import { METHODES_BREEZE } from './ia-breeze.js';   // breeze : cerveau, tir de charges de vent, saut long, glissade   // warden : vibrations, colere, flairer, rugir, onde sonique, creuser
import { METHODES_OEUFS, declarerReglesOeufs } from './ia-oeufs.js';   // oeufs et reproductions a part : tortue, grenouille, renifleur, panda, ocelot, axolotl, poule
import { METHODES_VILLAGEOIS } from './ia-villageois.js';   // villageois : temps libre, echanges, reproduction, jeu des bebes, lits et postes pris
import { declarerReglesPoussee } from './poussee.js';   // les corps vivants se poussent (acteurs.poussee)

const RAD = Math.PI / 180;
const norm180 = (a) => { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; };
export const DIFFICULTES = { paisible: 0, facile: 1, normal: 2, difficile: 3, peaceful: 0, easy: 1, hard: 3 };
export const COMPORTEMENTS = ['passif', 'agressif', 'fuit', 'garde'];
const MOVE = 1, LOOK = 2;

// ---------------------------------------------------------------- profils (attributs du jeu : attack_damage, follow_range ; buts)
// fam : zombie | squelette | creeper | araignee | golem | neige | villageois | passif | lapin | loup | neutre | illageois | volant
// panique : modificateur de vitesse de PanicGoal ; degats : attack_damage ; suivi : follow_range ; soleil : brule au soleil
const P = (fam, o = {}) => ({ fam, degats: 0, suivi: 16, ...o });
export const PROFILS = {
  zombie: P('zombie', { degats: 3, suivi: 35, soleil: true, portes: true }), zombie_villager: P('zombie', { degats: 3, suivi: 35, soleil: true, portes: true }),
  husk: P('zombie', { degats: 3, suivi: 35, portes: true }), drowned: P('zombie', { degats: 3, suivi: 35, soleil: true }),
  skeleton: P('squelette', { degats: 2, soleil: true, arc: true }), stray: P('squelette', { degats: 2, soleil: true, arc: true }),
  bogged: P('squelette', { degats: 2, soleil: true, arc: true, intervalle: [50, 30] }), parched: P('squelette', { degats: 2, arc: true }),
  wither_skeleton: P('zombie', { degats: 5 }),
  creeper: P('creeper'), spider: P('araignee', { degats: 2 }), cave_spider: P('araignee', { degats: 2 }),
  iron_golem: P('golem', { degats: 15, antiRecul: 1 }), snow_golem: P('neige'),
  rabbit: P('lapin', { panique: 2.2 }), cow: P('passif', { panique: 2.0 }), mooshroom: P('passif', { panique: 2.0 }), pig: P('passif', { panique: 1.25 }),
  sheep: P('passif', { panique: 1.25 }), chicken: P('passif', { panique: 1.4 }), goat: P('passif', { panique: 2.0 }), horse: P('passif', { panique: 1.2 }),
  donkey: P('passif', { panique: 1.2 }), mule: P('passif', { panique: 1.2 }), llama: P('passif', { panique: 1.2 }), camel: P('passif', { panique: 4 }),
  fox: P('passif', { panique: 2.2 }), cat: P('passif', { panique: 1.5 }), ocelot: P('passif', { panique: 1.33 }), turtle: P('passif', { panique: 1.2 }),
  armadillo: P('passif', { panique: 2.0 }), frog: P('passif', { panique: 2.0 }), panda: P('passif', { panique: 2.0 }), polar_bear: P('neutre', { degats: 6 }),
  wolf: P('loup', { degats: 4, panique: 1.5 }), zombified_piglin: P('neutre', { degats: 5, suivi: 35 }),
  piglin: P('neutre', { degats: 5 }), piglin_brute: P('zombie', { degats: 7, suivi: 16 }), vindicator: P('illageois', { degats: 5, suivi: 12 }),
  pillager: P('illageois', { arbalete: true, suivi: 32 }), ravager: P('illageois', { degats: 12, suivi: 32, antiRecul: 0.75 }), hoglin: P('zombie', { degats: 6 }), zoglin: P('zombie', { degats: 6 }),
  // especes a comportement propre (moteur/ia-especes.js) ; attack_damage et follow_range du jeu
  bat: P('chauve'), bee: P('abeille', { degats: 2, suivi: 48 }), allay: P('allay'), parrot: P('perroquet'), ghast: P('ghast', { suivi: 100, immuniseFeu: true }), happy_ghast: P('ghast', { suivi: 16 }),
  phantom: P('phantom', { degats: 6, suivi: 64, soleil: true }), vex: P('vex', { degats: 4, immuniseFeu: true }), blaze: P('blaze', { degats: 6, suivi: 48, immuniseFeu: true }),
  witch: P('sorciere', { suivi: 16 }), enderman: P('enderman', { degats: 7, suivi: 64 }),
  wither: P('wither', { suivi: 40, immuniseFeu: true }), ender_dragon: P('dragon', { immuniseFeu: true, antiRecul: 1 }), warden: P('warden', { degats: 30, suivi: 24, antiRecul: 1 }), breeze: P('breeze', { degats: 3, suivi: 24 }),
  cod: P('poisson', { panique: 1.25 }), salmon: P('poisson', { panique: 1.25 }), tropical_fish: P('poisson', { panique: 1.25 }), pufferfish: P('poisson', { panique: 1.25 }), tadpole: P('poisson', { panique: 1.25 }),
  squid: P('calmar'), glow_squid: P('calmar'), dolphin: P('dauphin', { degats: 3 }), axolotl: P('axolotl', { degats: 2, panique: 2.0 }),
  guardian: P('gardien', { degats: 6 }), elder_guardian: P('gardien', { degats: 8 }), sniffer: P('passif', { panique: 2.0 }),
  villager: P('villageois', { panique: 0.75, chemin: 48 }), wandering_trader: P('villageois', { panique: 0.75 }),
};
const MONSTRES = new Set(['zombie', 'zombie_villager', 'husk', 'drowned', 'skeleton', 'stray', 'bogged', 'parched', 'wither_skeleton', 'creeper', 'spider', 'cave_spider', 'witch', 'enderman', 'zombified_piglin', 'piglin_brute', 'vindicator', 'pillager', 'evoker', 'ravager', 'vex', 'phantom', 'slime', 'magma_cube', 'blaze', 'ghast', 'silverfish', 'endermite', 'hoglin', 'zoglin', 'guardian', 'elder_guardian', 'warden', 'breeze', 'creaking', 'bogged']);
export const estMonstre = (t) => MONSTRES.has(t);
// vitesse de deplacement de chaque but (modificateur du jeu) ; flanerie : RandomStrollGoal
const VITESSES = { attaque: 1.0, fuite: 1.0, flanerie: 1.0, golemFlanerie: 0.6, golemCible: 0.9, villageoisMarche: 0.5, villageoisFuite: 1.0 };
// arme d'un joueur : [degats d'attaque, vitesse d'attaque] (attributs des objets du jeu ; main nue : 1 et 4)
export const ARMES = {
  wooden_sword: [4, 1.6], golden_sword: [4, 1.6], stone_sword: [5, 1.6], copper_sword: [5, 1.6], iron_sword: [6, 1.6], diamond_sword: [7, 1.6], netherite_sword: [8, 1.6],
  wooden_axe: [7, 0.8], golden_axe: [7, 1.0], stone_axe: [9, 0.8], copper_axe: [9, 0.8], iron_axe: [9, 0.9], diamond_axe: [9, 1.0], netherite_axe: [10, 1.0],
  wooden_pickaxe: [2, 1.2], stone_pickaxe: [3, 1.2], iron_pickaxe: [4, 1.2], diamond_pickaxe: [5, 1.2], netherite_pickaxe: [6, 1.2],
  wooden_shovel: [2.5, 1.0], stone_shovel: [3.5, 1.0], iron_shovel: [4.5, 1.0], diamond_shovel: [5.5, 1.0], netherite_shovel: [6.5, 1.0],
  trident: [9, 1.1], mace: [6, 0.6],
};
export const armeDe = (objet) => ARMES[String(objet ?? '').replace(/^minecraft:/, '')] ?? [1, 4];
// butin des creatures (tables du jeu data/minecraft/loot_table/entities, sans pillage ni condition de feu) : [objet, min, max]
export const BUTIN = {
  zombie: [['rotten_flesh', 0, 2]], husk: [['rotten_flesh', 0, 2]], zombie_villager: [['rotten_flesh', 0, 2]], drowned: [['rotten_flesh', 0, 2]],
  skeleton: [['bone', 0, 2], ['arrow', 0, 2]], stray: [['bone', 0, 2], ['arrow', 0, 2]], bogged: [['bone', 0, 2], ['arrow', 0, 2]],
  creeper: [['gunpowder', 0, 2]], spider: [['string', 0, 2]], cave_spider: [['string', 0, 2]], enderman: [['ender_pearl', 0, 1]],
  cow: [['beef', 1, 3], ['leather', 0, 2]], mooshroom: [['beef', 1, 3], ['leather', 0, 2]], pig: [['porkchop', 1, 3]], sheep: [['mutton', 1, 2], ['white_wool', 1, 1]],
  chicken: [['chicken', 1, 1], ['feather', 0, 2]], rabbit: [['rabbit', 0, 1], ['rabbit_hide', 0, 1]], iron_golem: [['iron_ingot', 3, 5], ['poppy', 0, 2]],
  snow_golem: [['snowball', 0, 15]], zombified_piglin: [['rotten_flesh', 0, 1], ['gold_nugget', 0, 1]], wither_skeleton: [['coal', 0, 1], ['bone', 0, 2]],
};

// ---------------------------------------------------------------- regles
export function declarerRegles(regles) {
  regles.declarer('monde.difficulte', { def: 'normal', choix: ['paisible', 'facile', 'normal', 'difficile', 'peaceful', 'easy', 'hard'], doc: 'difficulte du jeu : degats des mobs (facile min(d/2+1, d), difficile x 1,5), imprecision des squelettes (14 - 4 x niveau), cadence de l\'arc (40 ticks, 20 en difficile), portes cassees par les zombies (difficile)' });
  regles.declarer('ia.actif', { def: true, doc: 'false : les creatures `ia: true` restent immobiles (comme `ia: false`)' });
  regles.declarer('ia.soleil', { def: true, doc: 'les morts-vivants brulent au soleil (zombie, squelette, stray, noye ; casque : protege)' });
  regles.declarer('ia.degats', { def: 1, min: 0, max: 100, doc: 'multiplicateur des degats des creatures' });
  regles.declarer('ia.cassePortes', { def: true, doc: 'les zombies cassent les portes en bois en difficile (240 ticks) ; false : jamais' });
  regles.declarer('ia.explosionCasse', { def: true, doc: 'l\'explosion du creeper casse les blocs (mobGriefing)' });
  regles.declarer('ia.phantomAncre', { def: 20, min: 2, max: 64, doc: 'hauteur du point d\'ancrage des phantoms au-dessus de leur cible : le jeu 20 + [0, 20[ (le phantom tourne autour, puis pique) ; plus petit : des piques plus courts, plus faciles a cadrer' });
  regles.declarer('laisse.rupture', { def: 12, min: 0, max: 64, doc: 'distance (blocs, entre les centres) a laquelle la laisse d une creature a IA casse (le jeu 26.3 : 12 ; les versions d avant 1.21.6 : 10 ; 0 : jamais) ; au-dela de 6 elle est tiree' });
  declarerReglesBoss(regles); declarerReglesOeufs(regles);
  regles.declarer('combat.recul', { def: 1, min: 0, max: 10, doc: 'multiplicateur du recul des coups (0,4 par coup recu, + 0,5 si l\'attaquant court)' });
  declarerReglesVie(regles);
  declarerReglesPoussee(regles);   // acteurs.poussee (moteur/poussee.js)
  regles.declarer('combat.critiques', { def: true, doc: 'coups critiques en tombant (x 1,5)' });
}

// ---------------------------------------------------------------- l'IA d'un acteur
export class IA {
  // a : Acteur (moteur/acteurs.js) ; d : { type, comportement, cible, garde, maison, travail, charge, casque }
  constructor(a, d) {
    this.a = a; this.type = d.type; this.pr = PROFILS[d.type] ?? P('passif', { panique: 1.25 });
    this.comportement = d.comportement ?? null; this.cibleForcee = d.cible ?? null;
    this.garde = d.garde ?? [a.x, a.y, a.z]; this.maison = d.maison ?? null; this.travail = d.travail ?? null;
    this.charge = !!d.charge; this.casque = !!d.casque; this.attr = d.vitesseAttr ?? 0.25;
    this.cible = null; this.blessePar = null; this.blesseTick = -1e9;
    this.buts = []; this.actifs = new Set();
    this.nav = null; this.prochaineAttaque = 0; this.gonfle = 0; this.gonfleDir = -1; this.arc = { voit: 0, attente: -1, tension: 0 };
    this.feu = 0; this.agressif = false; this.attaqueTick = -100; this.porteCassage = null;
    this.regardLibre = null; this.flanerie = null;
    // especes (ia-especes.js) : vol, dard de l'abeille, epaule du perroquet, joueur aime de l'allay, lit et cloche du villageois
    this.vol = VOLS[d.type] ?? null; this.dard = true; this.epaule = d.epaule ?? null; this.ami = d.ami ?? null;
    this.lit = d.lit ?? null; this.rassemblement = d.rassemblement ?? null; this.variante = d.variante ?? null; this.bebe = !!d.bebe;
    this.tangageCorps = 0; this.laissePiste = d.laisse ?? null;
    this.charge = !!d.charge; this.initVie(d); this.initBoss(d); this.initEau?.(d); this.initWarden?.(d); this.initBreeze?.(d); this.initOeufs?.(d);
    this.installerButs();
  }
  get sim() { return this.a.sim; }
  get h() { return this.a.sim.hasard; }
  difficulte() { return DIFFICULTES[this.sim.regles.valeur('monde.difficulte', 'normal')] ?? 2; }
  jour() { const h = this.sim.heureMonde(); return h >= 6 && h < 18; }

  // ---- buts (priorite : plus petit = plus important) ----------------------------------------------------------------
  installerButs() {
    const f = this.pr.fam, c = this.comportement, add = (prio, nom, drap) => this.buts.push({ prio, nom, drap });
    if (this.installerEspece(add)) { this.installerVie(add); return; }
    this.installerVie(add);
    if (f !== 'zombie' && f !== 'squelette') add(0, 'flotte', 0);   // zombies et squelettes n'ont pas de FloatGoal : ils coulent (le zombie se noie et devient noye)
    if (c === 'fuit') add(1, 'fuitCible', MOVE);
    if (f === 'creeper') add(2, 'gonfle', MOVE);
    if (this.pr.soleil) add(3, 'fuitSoleil', MOVE);
    if (['passif', 'lapin', 'loup', 'villageois'].includes(f) || c === 'passif') add(1, 'panique', MOVE);
    if (f === 'lapin') add(4, 'evite', MOVE);
    if (f === 'villageois') { add(1, 'evite', MOVE); add(5, 'maison', MOVE); add(6, 'travail', MOVE); }
    if (f === 'squelette') add(3, 'evite', MOVE);
    if (c !== 'passif' && c !== 'fuit') {
      if (this.pr.arc || this.pr.arbalete) add(4, 'tir', MOVE | LOOK);
      else if (f === 'neige') add(1, 'boules', MOVE | LOOK);
      else if (f !== 'villageois' && f !== 'passif' && f !== 'lapin' && f !== 'volant') add(f === 'creeper' ? 4 : f === 'golem' ? 1 : 3, 'melee', MOVE | LOOK);
    }
    if (c === 'garde') add(6, 'garde', MOVE);
    add(7, 'flane', MOVE);
    add(8, 'regardeJoueur', LOOK);
    add(9, 'regardeAutour', LOOK);
  }

  // ---- perception -------------------------------------------------------------------------------------------------
  autres() { return this.sim.acteurs.liste.filter((o) => o !== this.a && o.mort < 0); }
  typeDe(o) { return o.ia ? o.ia.type : o.typeCreature ?? 'joueur'; }
  dist2(o) { return (o.x - this.a.x) ** 2 + (o.y - this.a.y) ** 2 + (o.z - this.a.z) ** 2; }
  voit(o) {   // Mob.hasLineOfSight : rayon de l'oeil a l'oeil sans bloc de collision
    const [ex, ey, ez] = this.a.oeil(), oy = o.oeil()[1];
    return rayonBloc(this.a.lec, [ex, ey, ez], [o.x, oy, o.z]) === null;
  }
  // cibles possibles selon les regles du jeu (Zombie : joueurs, villageois, golems ; squelette : joueurs, golems ; golem : monstres sauf creeper...)
  proies() {
    const f = this.pr.fam, c = this.comportement;
    const tous = this.autres(), joueurs = tous.filter((o) => this.typeDe(o) === 'joueur');
    if (c === 'agressif' && ['passif', 'loup', 'neutre', 'golem', 'neige', 'lapin', 'villageois'].includes(f)) return tous.filter((o) => this.typeDe(o) === 'joueur' || estMonstre(this.typeDe(o)));
    switch (f) {
      case 'zombie': return [...joueurs, ...tous.filter((o) => ['villager', 'wandering_trader', 'iron_golem'].includes(this.typeDe(o)))];
      case 'squelette': case 'creeper': return [...joueurs, ...(f === 'squelette' ? tous.filter((o) => this.typeDe(o) === 'iron_golem') : [])];
      case 'sorciere': case 'blaze': case 'vex': return joueurs;   // NearestAttackableTarget(Player) des especes de ia-especes.js
      case 'araignee': return this.jour() ? [] : joueurs;   // SpiderTargetGoal : seulement dans l'obscurite (nuit)
      case 'illageois': return [...joueurs, ...tous.filter((o) => ['villager', 'wandering_trader', 'iron_golem'].includes(this.typeDe(o)))];
      case 'golem': case 'neige': return tous.filter((o) => estMonstre(this.typeDe(o)) && this.typeDe(o) !== 'creeper');
      default: return [];
    }
  }
  choisirCible() {
    const sim = this.sim;
    if (this.cibleForcee) { const o = sim.acteurs.parNom.get(this.cibleForcee); this.cible = o && o.mort < 0 ? o : null; return; }
    if (this.cible && (this.cible.mort >= 0 || this.dist2(this.cible) > this.pr.suivi ** 2)) this.cible = null;
    // HurtByTarget (priorite 1) : celui qui l'a frappe
    if (this.blessePar && this.blessePar.mort < 0 && sim.temps - this.blesseTick < 400 && this.pr.fam !== 'passif' && this.pr.fam !== 'lapin' && this.pr.fam !== 'villageois' && this.comportement !== 'passif') { this.poserCible(this.blessePar); return; }
    if (this.cible) return;
    // NearestAttackableTarget : une chance sur 10 par tick (reducedTickDelay(10)), la plus proche visible dans le rayon de suivi
    if (this.h.entierBorne(10) !== 0) return;
    let best = null, bd = Infinity;
    for (const o of this.proies()) { const d = this.dist2(o); if (d < bd && d <= this.pr.suivi ** 2 && this.voit(o)) { bd = d; best = o; } }
    if (best) this.poserCible(best);
  }
  poserCible(o) {
    if (this.cible === o) return;
    const ev = this.sim.api.evenement('creature.cible', { creature: this.a.nom, type: this.type, cible: o?.nom ?? null });
    if (ev.annule) return;
    const ec = this.a.evEntite('cible', { cible: o?.nom ?? null, candidats: o ? [o.nom] : [] });   // gestionnaires d'entite : annuler, ou rendre le nom d'une autre cible
    if (ec) {
      if (ec.annule) return;
      if (typeof ec.resultat === 'string') { const o2 = this.sim.acteurs.parNom.get(ec.resultat); if (o2 && o2 !== this.a && o2.mort < 0) o = o2; }
      if (this.cible === o) return;
    }
    this.cible = o; this.cibleDepuis = this.sim.temps;
    if (o) { this.sim.dire(`${this.a.nom} vise ${o.nom}`); this.stat('cibles'); }
  }
  stat(k, n = 1) { const s = (this.sim.stats.ia ??= {}); s[k] = (s[k] || 0) + n; }
  // un coup recu (Acteur.degats) : HurtByTarget, panique
  blesse(par) { this.blesseTick = this.sim.temps; if (par && par !== this.a) this.blessePar = par; }

  // ---- un tick : comme Mob.serverAiStep (cibles, buts, navigation, regard) -------------------------------------------
  tick() {
    const a = this.a, sim = this.sim;
    if (!sim.regles.valeur('ia.actif', true)) return;
    if (this.tickVie()) { a.entree = { avance: 0, cap: a.lacet, saute: false }; a.entreeVol = { zza: 0, yya: 0 }; a.regard = null; this.ecrire(); return; }   // dans une ruche : rien d'autre
    if (this.attaqueTick > sim.temps - 10) a.balancement = a.balancement || 0;
    this.soleil();
    this.avantButs();
    if (!this.ciblesEspece()) this.choisirCible();
    // selecteur : les buts actifs qui ne peuvent plus continuer s'arretent ; puis par priorite, les drapeaux libres
    for (const b of [...this.actifs]) if (!this['continue_' + b.nom]?.(b) || this.prochainPlusPrioritaire(b)) this.arreter(b);
    for (const b of [...this.buts].sort((x, y) => x.prio - y.prio)) {
      if (this.actifs.has(b)) continue;
      const pris = [...this.actifs].some((x) => (x.drap & b.drap) && x.prio <= b.prio);
      if (pris && b.drap) continue;
      if (!this['peut_' + b.nom](b)) continue;
      for (const x of [...this.actifs]) if (x.drap & b.drap) this.arreter(x);
      this.actifs.add(b); this['debut_' + b.nom]?.(b);
    }
    a.entree = { avance: 0, cap: a.lacet, saute: false };
    a.regard = null;
    for (const b of [...this.actifs].sort((x, y) => x.prio - y.prio)) this['tick_' + b.nom](b);
    this.suivreLaisse();
    if (this.vol) { a.entree.avance = 0; this.suivreVol(); } else this.suivreChemin();
    this.apresButs();
    this.agressif = !!this.cible && ['melee', 'tir', 'volAttaque', 'blazeAttaque', 'sorciereTir', 'vexCharge', 'phantomPique', 'ghastTir', 'witherTir', 'gardienLaser', 'nageAttaque'].some((n) => this.actifs.has(this.but(n)));
    this.ecrire();
  }
  but(nom) { return this.buts.find((b) => b.nom === nom); }
  prochainPlusPrioritaire(b) { void b; return false; }
  arreter(b) { this.actifs.delete(b); this['fin_' + b.nom]?.(b); }

  // ---- navigation (PathNavigation : chemin recalcule, suivi des points) ----------------------------------------------
  allerVers(x, y, z, vit, { ouvrePortes = false, rayon = 0.6, recalcul = 10, precision = 1 } = {}) {
    const a = this.a, sim = this.sim, n = this.nav;
    a.kVit = (this.attr * vit) ** 2 / 0.098;
    if (n && sim.temps < n.prochain && Math.hypot(n.but[0] - x, n.but[2] - z) < 1) return;
    const gab = this.gabaritNav();
    // PathNavigation.createPath : la recherche du jeu (moteur/chemins.js), longueur follow_range, accuracy 1 (moveTo), noeuds visites suivi x 16
    const r = chercherChemin(a.lec, [a.x, a.y, a.z], { x, z, y }, { ouvrePortes, rayon: Math.max(1, rayon), precision, gabarit: gab, suivi: Math.max(this.pr.suivi ?? 16, this.pr.chemin ?? 0), auSol: a.auSol, dansEau: a.dansEau });   // getMaxPathLength : max(follow_range, setRequiredPathLength : villageois 48)
    const ch = r.chemin.length > 1 ? r.chemin.slice(1) : r.complet ? [[x, y, z]] : [];
    this.nav = { but: [x, y, z], chemin: ch, i: 0, portes: r.portes, complet: r.complet, prochain: sim.temps + (r.complet ? recalcul : Math.max(recalcul, 20)), ouvrePortes };   // pas de chemin : on reessaie moins souvent (PathNavigation : 20 ticks)
  }
  // boite du type, chute permise, eau : malus 8 des cases d'eau et de bord d'eau (PathType.WATER / WATER_BORDER du jeu) ; le renifleur et
  // l'arpenteur evitent l'eau (malus -1) ; les creatures qui ont FloatGoal (tous sauf zombies et squelettes) flottent a la surface ; pas de
  // chemin sur une cloture ou un muret
  gabaritNav() {
    const a = this.a, f = this.pr.fam, sec = this.type === 'sniffer' || this.type === 'strider';
    return { L: Math.max(0.6, a.L), H: a.H, chute: f === 'volant' ? 64 : 3, eau: sec ? 0 : 8, flotte: f !== 'zombie' && f !== 'squelette', surClotures: false };   // PathType.FENCE : -1
  }
  arreterNav() { this.nav = null; }
  suivreChemin() {
    const a = this.a, n = this.nav;
    if (!n) return;
    for (const p of n.portes || []) {   // portes du chemin : ouvertes a la main en arrivant (villageois), refermees apres le passage
      const d = Math.hypot(a.x - (p[0] + 0.5), a.z - (p[2] + 0.5));
      const e = this.sim.monde.etatEn(p[0], p[1], p[2]);
      if (e < 0) continue;
      const ouverte = this.sim.d.prop(e, 'open') === 'true';
      if (!p.ouverte && d <= 1.8 && !ouverte) { p.ouverte = true; a.balancer(); this.sim.utiliserBloc(p[0], p[1], p[2], { acteur: a.nom, face: 'north', hit: [0.5, 0.5, 0.5], lacet: a.lacet }); }
      else if (p.ouverte && !p.fermee && d >= 2.2 && ouverte && n.i > 0 && !this.sim.acteurs.liste.some((o) => o !== a && o.mort < 0 && Math.hypot(o.x - p[0] - 0.5, o.z - p[2] - 0.5) < 2.5)) {   /* pas sur quelqu'un qui passe */ p.fermee = true; this.sim.utiliserBloc(p[0], p[1], p[2], { acteur: a.nom, face: 'north', hit: [0.5, 0.5, 0.5], lacet: a.lacet }); }
    }
    const w = n.chemin[n.i];
    if (!w) { return; }
    const dx = w[0] - a.x, dz = w[2] - a.z, d = Math.hypot(dx, dz);
    if (d < Math.max(0.35, a.L / 2)) { n.i++; return; }
    const cap = Math.atan2(-dx, dz) / RAD;
    a.entree = { avance: 1, cap, saute: false };
    if (a.auSol && (w[1] - a.y > 0.6 + 0.02 && d < 1.3)) a.saut = true;
    if (a.auSol && a.bute && a.marcheSautable(cap)) a.saut = true;
    if (Math.abs(norm180(cap - a.lacet)) > 50) a.lacet += norm180(cap - a.lacet) * 0.5;   // MoveControl : le corps se tourne vers la route (90 degres par tick au plus)
  }
  navFinie() { return !this.nav || this.nav.i >= this.nav.chemin.length; }
  regarder(o) { this.a.regard = o.nom ? { acteur: o.nom } : { x: o[0], y: o[1], z: o[2] }; }

  // ---- buts ---------------------------------------------------------------------------------------------------------
  // FloatGoal : dans l'eau, il saute (nage vers le haut)
  peut_flotte() { return this.a.dansEau; }
  continue_flotte() { return this.a.dansEau; }
  tick_flotte() { if (this.h.flottant() < 0.8) this.a.saut = true; }

  // PanicGoal : frappe depuis moins de 100 ticks (ou en feu) : court vers un point au hasard (5 blocs, 4 de haut) a `panique`
  peut_panique() { return this.pr.panique && (this.sim.temps - this.blesseTick < 100 || this.feu > 0) && this.comportement !== 'agressif'; }
  continue_panique() { return this.nage && this.a.dansEau ? !this.nageFinie() : !this.navFinie(); }
  debut_panique() {
    const a = this.a, h = this.h, par = this.blessePar;
    if (this.nage && a.dansEau) { const p = this.pointNage(5, 4); if (p) this.nageVers(p[0], p[1], p[2], this.pr.panique, 1e9); this.stat('paniques'); return; }   // nageurs : un point d'eau a 5 blocs
    let x = a.x + h.entierBorne(11) - 5, z = a.z + h.entierBorne(11) - 5;
    if (par) { const dx = a.x - par.x, dz = a.z - par.z, L = Math.hypot(dx, dz) || 1; x = a.x + dx / L * 5 + h.entierBorne(5) - 2; z = a.z + dz / L * 5 + h.entierBorne(5) - 2; }
    this.allerVers(x, undefined, z, this.pr.panique, { recalcul: 1e9 });
    this.stat('paniques');
  }
  tick_panique() { const a = this.a, n = this.nav; if (n) a.kVit = (this.attr * this.pr.panique) ** 2 / 0.098; }

  // AvoidEntityGoal : fuir une menace proche (lapin : joueur 8, loup 10, monstres 4 ; villageois : zombies et illageois 8 ; squelette : loup 6)
  menace() {
    const f = this.pr.fam;
    let best = null, bd = Infinity;
    for (const o of this.autres()) {
      const t = this.typeDe(o);
      let r = 0;
      if (f === 'lapin') r = t === 'joueur' ? 8 : t === 'wolf' ? 10 : estMonstre(t) ? 4 : 0;
      else if (f === 'villageois') r = ['zombie', 'zombie_villager', 'husk', 'drowned'].includes(t) ? 8 : ['vindicator', 'pillager', 'evoker', 'ravager', 'vex'].includes(t) ? 12 : 0;
      else if (f === 'squelette') r = t === 'wolf' ? 6 : 0;
      else if (f === 'poisson') r = t === 'joueur' ? 8 : 0;   // AbstractFish : AvoidEntityGoal(Player, 8, 1,6, 1,4)
      else if (f === 'dauphin') r = /guardian/.test(t) ? 8 : 0;
      const d = this.dist2(o);
      if (r && d < r * r && d < bd) { bd = d; best = o; }
    }
    return best;
  }
  peut_evite() { this.fuite = this.menace(); return !!this.fuite; }
  continue_evite() { return !!this.fuite && this.fuite.mort < 0 && (this.nage && this.a.dansEau ? !this.nageFinie() : !this.navFinie()); }
  debut_evite() {
    const a = this.a, o = this.fuite;
    if (this.nage && a.dansEau) {   // DefaultRandomPos.getPosAway (16, 7) dans l'eau : un point d'eau a l'oppose
      const dx = a.x - o.x, dz = a.z - o.z, L = Math.hypot(dx, dz) || 1, p = this.pointNage(4, 3, [a.x + dx / L * 8, a.y, a.z + dz / L * 8]);
      if (p) this.nageVers(p[0], p[1], p[2], this.dist2(o) < 49 ? 1.4 : 1.6, 1e9);
      this.compterFuite(o); return;
    }
    // DefaultRandomPos.getPosAway : un point a 16 blocs a l'oppose ; un villageois rentre chez lui s'il a une maison
    if (this.pr.fam === 'villageois' && this.maison) { this.allerVers(this.maison[0], this.maison[1], this.maison[2], VITESSES.villageoisFuite, { ouvrePortes: true, recalcul: 1e9 }); this.compterFuite(o); return; }
    const dx = a.x - o.x, dz = a.z - o.z, L = Math.hypot(dx, dz) || 1, k = this.pr.fam === 'lapin' ? 8 : 10;
    this.allerVers(a.x + dx / L * k, undefined, a.z + dz / L * k, this.pr.fam === 'lapin' ? 2.2 : 1.2, { ouvrePortes: this.pr.fam === 'villageois', recalcul: 1e9 });
    this.compterFuite(o);
  }
  compterFuite(o) { if (this.fuiteDe !== o) { this.fuiteDe = o; this.stat('fuites'); (this.sim.stats.iaJournal ??= []).push(`${(this.sim.temps / 20).toFixed(2)} ${this.a.nom} fuit ${o.nom}`); } }
  tick_evite() { if (this.nage && this.a.dansEau) return; const o = this.fuite; if (o) this.a.regard = { acteur: o.nom }; if (this.fuite && this.dist2(this.fuite) < 49) this.a.kVit = (this.attr * (this.pr.fam === 'lapin' ? 2.2 : 1.2)) ** 2 / 0.098; }

  // comportement "fuit" : fuit sa cible (ou tout joueur proche)
  peut_fuitCible() { this.fuite = this.cible ?? this.autres().find((o) => this.typeDe(o) === 'joueur' && this.dist2(o) < 256); return !!this.fuite; }
  continue_fuitCible() { return this.peut_fuitCible(); }
  tick_fuitCible() {
    const a = this.a, o = this.fuite, dx = a.x - o.x, dz = a.z - o.z, L = Math.hypot(dx, dz) || 1;
    if (!this.nav || this.sim.temps >= this.nav.prochain) this.allerVers(a.x + dx / L * 8, undefined, a.z + dz / L * 8, 1.25, { recalcul: 20 });
  }

  // maison la nuit, travail le jour : ces methodes sont remplacees par celles de ia-especes.js (emploi du temps du jeu, melange a la classe)
  peut_maison() { return !!this.maison && !this.jour() && Math.hypot(this.a.x - this.maison[0], this.a.z - this.maison[2]) > 1.2; }
  continue_maison() { return this.peut_maison() && !this.navFinie(); }
  debut_maison() { this.allerVers(this.maison[0], this.maison[1], this.maison[2], VITESSES.villageoisMarche * 1.4, { ouvrePortes: true, recalcul: 1e9 }); }
  tick_maison() {}
  peut_travail() { return !!this.travail && this.jour() && Math.hypot(this.a.x - this.travail[0], this.a.z - this.travail[2]) > 1.5; }
  continue_travail() { return this.peut_travail() && !this.navFinie(); }
  debut_travail() { this.allerVers(this.travail[0], this.travail[1], this.travail[2], VITESSES.villageoisMarche, { ouvrePortes: true, recalcul: 1e9 }); }
  tick_travail() {}

  // FleeSunGoal / RestrictSunGoal : en feu au soleil, cherche l'ombre (un bloc au-dessus de la tete) a 10 blocs
  peut_fuitSoleil() { return this.feu > 0 && this.jour() && !this.casque && this.cielVisible(this.a.x, this.a.y, this.a.z); }
  continue_fuitSoleil() { return !this.navFinie(); }
  debut_fuitSoleil() {
    const a = this.a, h = this.h;
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(a.x + h.entierBorne(20) - 10), z = Math.floor(a.z + h.entierBorne(20) - 10);
      const s = this.sim.acteurs.solAuxCoordonnees(x + 0.5, z + 0.5, a.y);
      if (s !== null && Math.abs(s - a.y) < 6 && !this.cielVisible(x + 0.5, s, z + 0.5)) { this.allerVers(x + 0.5, s, z + 0.5, 1.0, { recalcul: 1e9 }); return; }
    }
    this.nav = null;
  }
  tick_fuitSoleil() {}

  // MeleeAttackGoal : poursuit la cible (chemin recalcule tous les 4 a 10 ticks), frappe au contact toutes les 20 ticks
  peut_melee() { return !!this.cible && this.cible.mort < 0 && !(this.pr.fam === 'creeper' && this.gonfle > 0 && this.gonfleDir > 0); }
  continue_melee() { return this.peut_melee(); }
  debut_melee() { this.prochaineAttaque = 0; this.nav = null; }
  fin_melee() { this.nav = null; }
  tick_melee() {
    const a = this.a, o = this.cible, sim = this.sim;
    this.regarder(o);
    const vit = this.pr.fam === 'golem' ? VITESSES.golemCible : VITESSES.attaque;
    if (!this.nav || sim.temps >= this.nav.prochain) {
      const casse = this.pr.portes && this.difficulte() >= 3 && sim.regles.valeur('ia.cassePortes', true);
      this.allerVers(o.x, o.auSol ? o.y : undefined, o.z, vit, { rayon: 0.5, precision: 0, recalcul: 4 + this.h.entierBorne(7) });   // MeleeAttackGoal : moveTo(cible, accuracy 0) ; cible en l'air (projetee) : son point au sol
      if (casse && this.nav && !this.nav.complet) this.casserPorte();
      if (this.nav && !this.nav.complet && this.dist2(o) < 16 && this.voit(o)) this.nav.chemin = [[o.x, o.y, o.z]];   // tout pres : droit sur elle
    }
    if (this.prochaineAttaque > 0) this.prochaineAttaque--;
    if (this.pr.fam === 'creeper') return;
    if (this.auContact(o) && this.prochaineAttaque <= 0 && this.voit(o)) { this.prochaineAttaque = 20; this.frapper(o); }
    else if (!this.nav?.complet && this.porteCassage) this.tickCasserPorte();
  }
  // Mob.isWithinMeleeAttackRange : la boite du mob elargie de sqrt(2,04) - 0,6 (0,828) touche celle de la cible
  auContact(o) {
    const a = this.a, m = Math.sqrt(2.04) - 0.6, A = a.boite(), B = o.boite();
    return A[0] - m <= B[3] && A[3] + m >= B[0] && A[2] - m <= B[5] && A[5] + m >= B[2] && A[1] <= B[4] && A[4] >= B[1];
  }
  // Mob.doHurtTarget : attack_damage (golem : d / 2 + [0, d[), degats selon la difficulte si la cible est un joueur, recul 0,4
  frapper(o) {
    const a = this.a, sim = this.sim, h = this.h;
    let q = this.pr.degats;
    if (this.pr.fam === 'golem') q = q / 2 + h.entierBorne(Math.floor(q));
    if (this.typeDe(o) === 'joueur') q = degatsJoueur(q, this.difficulte());
    q *= sim.regles.valeur('ia.degats', 1);
    const ev = sim.api.evenement('creature.attaque', { creature: a.nom, type: this.type, cible: o.nom, degats: q });
    if (ev.annule) return;
    q = Number(ev.degats);
    const ea = a.evEntite('attaque', { cible: o.nom, degats: q });   // gestionnaires d'entite (mc.entite(type | id de mod).sur('attaque'))
    if (ea) { if (ea.annule) return; q = Number(ea.degats) || 0; }
    a.balancer(); this.attaqueTick = sim.temps;
    const ok = q > 0 ? o.frappe(q, 'mob:' + this.type, a.x - o.x, a.z - o.z, 0.4 * sim.regles.valeur('combat.recul', 1)) : false;
    if (ok) {
      o.ia?.blesse(a); o.dernierFrappeur = a;
      if (this.pr.fam === 'golem') { o.vy += 0.4; sim.son('entity.iron_golem.attack', a.x, a.y, a.z, 1, 1); }
      this.stat('attaques'); (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${a.nom} frappe ${o.nom} ${+q.toFixed(1)}`);
    }
  }
  // BreakDoorGoal (zombies, difficile) : une porte en bois fermee a moins de 2 blocs sur la route : 240 ticks, coups toutes les 20, puis cassee
  casserPorte() {
    const a = this.a, sim = this.sim, ouvr = (this._ouvr ??= blocsOuvrables(sim.d));
    for (let dy = 0; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const x = Math.floor(a.x) + dx, y = Math.floor(a.y) + dy, z = Math.floor(a.z) + dz, e = sim.monde.etatEn(x, y, z);
      if (e >= 0 && ouvr.has(sim.d.blocDe(e)) && sim.d.nomBloc(e).endsWith('_door') && !sim.d.nomBloc(e).startsWith('iron') && sim.d.prop(e, 'open') === 'false') {
        const bas = sim.d.prop(e, 'half') === 'upper' ? y - 1 : y;
        if (!this.porteCassage || this.porteCassage.pos.join() !== [x, bas, z].join()) this.porteCassage = { pos: [x, bas, z], t: 0 };
        return;
      }
    }
  }
  tickCasserPorte() {
    const sim = this.sim, p = this.porteCassage, a = this.a;
    if (Math.hypot(a.x - p.pos[0] - 0.5, a.z - p.pos[2] - 0.5) > 2.2) { this.porteCassage = null; return; }
    p.t++;
    if (this.h.entierBorne(20) === 0) { sim.son('entity.zombie.attack_wooden_door', p.pos[0] + 0.5, p.pos[1] + 0.5, p.pos[2] + 0.5, 1, 1); a.balancer(); }
    if (p.t >= 240) {
      sim.son('entity.zombie.break_wooden_door', p.pos[0] + 0.5, p.pos[1] + 0.5, p.pos[2] + 0.5, 1, 1);
      sim.api.casser(p.pos[0], p.pos[1], p.pos[2]);
      this.stat('portesCassees'); this.porteCassage = null; this.nav = null;
    }
  }

  // SwellGoal (creeper) : cible a moins de 3 blocs -> il s'arrete et gonfle (+1 par tick), plus de 7 blocs ou hors de vue -> degonfle ;
  // a 30 il explose (puissance 3, 6 s'il est charge) ; Creeper.tick : son "primed" au premier tick du gonflement
  peut_gonfle() { return this.gonfle > 0 || (!!this.cible && this.dist2(this.cible) < 9); }
  continue_gonfle() { return this.peut_gonfle(); }
  debut_gonfle() { this.nav = null; }
  tick_gonfle() {
    const o = this.cible;
    const avant = this.gonfleDir;
    this.gonfleDir = !o ? -1 : this.dist2(o) > 49 ? -1 : !this.voit(o) ? -1 : 1;
    if (o) this.regarder(o);
    this.a.entree.avance = 0; this.nav = null;
    if (this.gonfleDir > 0 && avant <= 0 && this.gonfle === 0) this.sim.son('entity.creeper.primed', this.a.x, this.a.y, this.a.z, 1, 0.5);
  }
  majGonfle() {
    if (this.pr.fam !== 'creeper') return;
    if (!this.actifs.has(this.but('gonfle'))) this.gonfleDir = -1;
    this.gonfle = Math.max(0, this.gonfle + this.gonfleDir);
    if (this.gonfle >= 30) this.exploser();
  }
  exploser() {
    const a = this.a, sim = this.sim;
    const ev = sim.api.evenement('creature.explose', { creature: a.nom, puissance: 3 * (this.charge ? 2 : 1), pos: [a.x, a.y, a.z] });
    this.gonfle = 0;
    if (ev.annule) return;
    a.mort = 21; a.mortSansCorps = true;   // le creeper disparait (discard) : pas de chute du corps
    this.stat('explosions'); (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${a.nom} explose (puissance ${ev.puissance})`);
    exploser(sim, a.x, a.y, a.z, { puissance: Number(ev.puissance), casseBlocs: sim.regles.valeur('ia.explosionCasse', true), source: 'creeper', causeNom: a.nom });
  }

  // RangedBowAttackGoal (squelettes : vitesse 1,0, intervalle 40 / 20 en difficile, rayon 15) ; arbalete du pillard : charge 25 ticks
  peut_tir() { return !!this.cible && this.cible.mort < 0; }
  continue_tir() { return this.peut_tir(); }
  debut_tir() { this.arc = { voit: 0, attente: -1, tension: 0, tempsStrafe: -1 }; }
  fin_tir() { this.arc.tension = 0; this.nav = null; }
  tick_tir() {
    if (this.pr.arbalete) return this.tickArbalete();
    const a = this.a, o = this.cible, A = this.arc, d2 = this.dist2(o), voit = this.voit(o), sim = this.sim;
    if (voit !== A.voit > 0) A.voit = 0;
    A.voit += voit ? 1 : -1;
    if (d2 <= 225 && A.voit >= 20) { this.nav = null; } else if (!this.nav || sim.temps >= this.nav.prochain) this.allerVers(o.x, o.auSol ? o.y : undefined, o.z, 1.0, { recalcul: 10 });
    this.regarder(o);
    const intervalle = (this.pr.intervalle ?? [40, 20])[this.difficulte() >= 3 ? 1 : 0];
    const charge = this.pr.arbalete ? 25 : 20;
    if (A.tension > 0) {
      if (!voit && A.voit < -60) A.tension = 0;
      else if (voit) {
        if (A.tension >= charge + (this.pr.arbalete ? 20 : 0)) { this.tirer(o, this.pr.arbalete ? 1 : puissanceArc(A.tension)); A.tension = 0; A.attente = intervalle; }
        else A.tension++;   // getTicksUsingItem : compte apres le controle (tir au 20e tick d'utilisation)
      }
    } else if (--A.attente <= 0 && A.voit >= -60) A.tension = 1;
  }
  // RangedCrossbowAttackGoal(1,0 ; 8 blocs) du pillard (Horizon mobs/illager.rs CrossbowAttack) : il s'approche (chemin toutes les 20 a 40 ticks ;
  // vitesse 1,0 non chargee, 0,5 sinon) tant qu'il est a plus de 8 blocs ou ne voit pas la cible depuis 5 ticks ; puis charge (son
  // loading_start, 25 ticks : CrossbowItem.getChargeDuration), chargee (son loading_end), attend 20 + [0, 20[ ticks, tire s'il voit (fleche de
  // base 2, vitesse 1,6, imprecision 14 - 4 x difficulte, visee au tiers de la hauteur + distance x 0,2 ; son shoot), et recommence
  tickArbalete() {
    const a = this.a, o = this.cible, A = this.arc, sim = this.sim, h = this.h, voit = this.voit(o), d2 = this.dist2(o);
    A.etat ??= 'vide'; A.delai ??= 0; A.chemin ??= 0; A.utilise ??= 0;
    if (voit !== A.voit > 0) A.voit = 0;
    A.voit += voit ? 1 : -1;
    const bouge = (d2 > 64 || A.voit < 5) && A.delai === 0;
    if (bouge) { if (--A.chemin <= 0) { this.nav = null; this.allerVers(o.x, o.auSol ? o.y : undefined, o.z, A.etat === 'vide' ? 1.0 : 0.5, { recalcul: 1e9 }); A.chemin = 20 + h.entierBorne(21); } }
    else { A.chemin = 0; this.nav = null; }
    this.regarder(o);
    const centre = [a.x, a.y + a.H / 2, a.z];
    if (A.etat === 'vide') { if (!bouge) { A.etat = 'charge'; A.utilise = 0; sim.son('item.crossbow.loading_start', ...centre, 1, (h.flottant() - h.flottant()) * 0.2 + 1); } }
    else if (A.etat === 'charge') {
      if (++A.utilise >= 25) { A.utilise = 0; A.etat = 'chargee'; A.delai = 20 + h.entierBorne(20); sim.son('item.crossbow.loading_end', ...centre, 1, 1 / (h.flottant() * 0.5 + 1) + 0.2); this.stat('chargesArbalete'); }
    } else if (A.etat === 'chargee') { if (--A.delai === 0) A.etat = 'prete'; }
    else if (A.etat === 'prete' && voit) { this.tirerArbalete(o); A.etat = 'vide'; }
    A.tension = A.etat === 'charge' ? Math.max(1, A.utilise) : 0;   // replay.ia : drapeau 4 + duree d'utilisation -> pose CROSSBOW_CHARGE du film
  }
  tirerArbalete(o) {
    const a = this.a, sim = this.sim, h = this.h, dif = this.difficulte();
    const y0 = a.oeil()[1] - 0.1, xd = o.x - a.x, zd = o.z - a.z, dist = Math.hypot(xd, zd), b = o.boite(), yd = b[1] + (b[4] - b[1]) / 3 - y0 + dist * 0.2;
    const L = Math.hypot(xd, yd, zd) || 1, lacet = Math.atan2(-xd, zd) / RAD, tangage = -Math.asin(yd / L) / RAD;
    const P = sim.entites.proj, vit = P.tirer(lacet, tangage, 1.6, 14 - dif * 4);
    P.creer('fleche', a, [a.x, y0, a.z], vit, { crit: false, degatsBase: 2, vitesse0: 1.6, sansHerite: true });
    sim.son('item.crossbow.shoot', a.x, a.y + a.H / 2, a.z, 1, 1 / (h.flottant() * 0.5 + 1.8) + 0.53);
    this.stat('tirs'); (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${a.nom} tire a l arbalete sur ${o.nom}`);
  }
  // AbstractSkeleton.performRangedAttack : vise 1/3 de la hauteur de la cible + dist x 0,2, vitesse 1,6, imprecision 14 - 4 x difficulte,
  // degats de base puissance x 2 + triangle(difficulte x 0,11, 0,57425)
  tirer(o, puissance) {
    const a = this.a, sim = this.sim, h = this.h, dif = this.difficulte();
    const y0 = a.oeil()[1] - 0.1, xd = o.x - a.x, yd = o.y + (o.boite()[4] - o.boite()[1]) / 3 - y0, zd = o.z - a.z, dist = Math.hypot(xd, zd);
    const v = [xd, yd + dist * 0.2, zd], L = Math.hypot(...v) || 1;
    const lacet = Math.atan2(-v[0], v[2]) / RAD, tangage = -Math.asin(v[1] / L) / RAD;
    const P = sim.entites.proj, base = puissance * 2 + (dif * 0.11 + (h.flottant() - h.flottant()) * 0.57425);
    const vit = P.tirer(lacet, tangage, 1.6, 14 - dif * 4);
    const e = P.creer('fleche', a, [a.x, y0, a.z], vit, { crit: false, degatsBase: base, vitesse0: 1.6, sansHerite: true });
    sim.son('entity.skeleton.shoot', a.x, a.y, a.z, 1, 1 / (h.flottant() * 0.4 + 0.8));
    a.balancer(); this.stat('tirs');
    (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${a.nom} tire sur ${o.nom}`);
    return e;
  }

  // golem de neige : RangedAttackGoal(1,25 ; 20 ticks ; 10 blocs) : boule de neige vers l'oeil - 1,1 + dist x 0,2, vitesse 1,6, imprecision 12
  peut_boules() { return !!this.cible && this.cible.mort < 0; }
  continue_boules() { return this.peut_boules(); }
  tick_boules() {
    const a = this.a, o = this.cible, sim = this.sim, d2 = this.dist2(o);
    this.regarder(o);
    if (d2 > 100 || !this.voit(o)) { if (!this.nav || sim.temps >= this.nav.prochain) this.allerVers(o.x, o.auSol ? o.y : undefined, o.z, 1.25, { recalcul: 10 }); }
    else this.nav = null;
    if (--this.prochaineAttaque <= 0 && d2 <= 100 && this.voit(o)) {
      this.prochaineAttaque = 20;
      const y0 = a.oeil()[1] - 0.1, xd = o.x - a.x, yd = o.oeil()[1] - 1.1 - y0, zd = o.z - a.z, dist = Math.hypot(xd, zd);
      const v = [xd, yd + dist * 0.2, zd], L = Math.hypot(...v) || 1;
      const P = sim.entites.proj, vit = P.tirer(Math.atan2(-v[0], v[2]) / RAD, -Math.asin(v[1] / L) / RAD, 1.6, 12);
      P.creer('boule', a, [a.x, y0, a.z], vit, { objet: 'snowball', sansHerite: true });
      sim.son('entity.snow_golem.shoot', a.x, a.y, a.z, 1, 0.4 / (this.h.flottant() * 0.4 + 0.8));
      this.stat('tirs');
    }
  }

  // garde un point : y revient s'il en est a plus de 4 blocs
  peut_garde() { return Math.hypot(this.a.x - this.garde[0], this.a.z - this.garde[2]) > 4; }
  continue_garde() { return !this.navFinie(); }
  debut_garde() { this.allerVers(this.garde[0], this.garde[1], this.garde[2], 1.0, { recalcul: 1e9 }); }
  tick_garde() {}

  // RandomStrollGoal : une chance sur 120 par tick, un point a 10 blocs (7 de haut) ; golem 0,6, villageois 0,5
  peut_flane() {
    if (this.pr.fam === 'villageois') { const act = this.activite(); if ((act === 'travail' && this.travail) || (act === 'repos' && (this.lit || this.maison)) || this.sommeil || (this.type === 'villager' && (act === 'libre' || act === 'jeu'))) return false; }   // villageois en temps libre ou en jeu : RunOne (ia-villageois.js)
    return !this.vol && this.h.entierBorne(120) === 0;
  }
  continue_flane() { return !this.navFinie(); }
  debut_flane() {
    const a = this.a, h = this.h, base = this.comportement === 'garde' ? this.garde : [a.x, a.y, a.z];
    const x = base[0] + h.entierBorne(21) - 10, z = base[2] + h.entierBorne(21) - 10;
    const v = this.pr.fam === 'golem' ? VITESSES.golemFlanerie : this.pr.fam === 'villageois' ? VITESSES.villageoisMarche : VITESSES.flanerie;
    this.allerVers(x + 0.5, undefined, z + 0.5, v, { recalcul: 1e9, ouvrePortes: this.pr.fam === 'villageois' });
  }
  tick_flane() {}
  fin_flane() { this.nav = null; }

  // LookAtPlayerGoal (8 blocs, 2 % par tick, 40 a 80 ticks) et RandomLookAroundGoal (2 %, 20 a 40 ticks)
  peut_regardeJoueur() {
    if (this.h.flottant() >= 0.02) return false;
    const j = this.autres().filter((o) => this.typeDe(o) === 'joueur' && this.dist2(o) < 64).sort((p, q) => this.dist2(p) - this.dist2(q))[0];
    if (!j) return false;
    this.regardLibre = { o: j, fin: this.sim.temps + 40 + this.h.entierBorne(40) };
    return true;
  }
  continue_regardeJoueur() { return !!this.regardLibre?.o && this.sim.temps < this.regardLibre.fin && this.dist2(this.regardLibre.o) < 64; }
  tick_regardeJoueur() { if (this.regardLibre?.o) this.regarder(this.regardLibre.o); }
  peut_regardeAutour() {
    if (this.h.flottant() >= 0.02) return false;
    const ang = this.h.flottant() * Math.PI * 2;
    this.regardLibre = { p: [this.a.x + Math.cos(ang) * 4, this.a.oeil()[1], this.a.z + Math.sin(ang) * 4], fin: this.sim.temps + 20 + this.h.entierBorne(20) };
    return true;
  }
  continue_regardeAutour() { return !!this.regardLibre?.p && this.sim.temps < this.regardLibre.fin; }
  tick_regardeAutour() { if (this.regardLibre?.p) this.regarder(this.regardLibre.p); }

  // ---- soleil (Mob.isSunBurnTick, Zombie/AbstractSkeleton.aiStep) : jour, ciel visible, hors de l'eau, pas de casque ->
  // nextFloat() x 30 < (luminosite - 0,4) x 2 : 8 s de feu ; le feu : 1 degat par seconde (on brule)
  cielVisible(x, y, z) {
    const m = this.sim.monde, d = this.sim.d, X = Math.floor(x), Z = Math.floor(z);
    for (let yy = Math.floor(y + this.a.O) + 1; yy < Math.floor(y) + 80; yy++) { const e = m.etatEn(X, yy, Z); if (e < 0) return true; const n = d.nomBloc(e); if (!/^(air|cave_air|void_air)$/.test(n)) return false; }
    return true;
  }
  soleil() {
    const a = this.a, sim = this.sim;
    // Entity.isInWaterOrRain : sous la pluie (Level.isRainingAt aux pieds ou en haut de la boite) une creature ne brule pas et s'eteint
    const pluie = !!sim.meteo && (sim.meteo.pleutEn(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z)) || sim.meteo.pleutEn(Math.floor(a.x), Math.floor(a.y + a.H), Math.floor(a.z)));
    if (this.pr.soleil && sim.regles.valeur('ia.soleil', true) && this.jour() && !a.dansEau && !pluie && sim.temps % 1 === 0) {
      const lum = 1;   // ciel visible en plein jour : luminosite 1 (lumiere du ciel 15)
      if (this.h.flottant() * 30 < (lum - 0.4) * 2 && this.cielVisible(a.x, a.y, a.z)) {
        if (this.casque || a.armure?.tete) { /* le casque s'abime a la place (non suivi) */ } else if (this.feu < 160) { if (this.feu <= 0) { this.stat('brulures'); (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${a.nom} brule au soleil`); } this.feu = 160; }
      }
    }
    if (a.dansEau || pluie) this.feu = 0;
    if (this.feu > 0) {
      this.feu--;
      if (this.feu % 20 === 0) a.degats(1, 'feu');
      if (this.feu % 4 === 0) sim.particule('flame', a.x + (this.h.flottant() - 0.5) * a.L, a.y + a.H * (0.6 + this.h.flottant() * 0.5), a.z + (this.h.flottant() - 0.5) * a.L, 0, 0.02, 0, 1);
    }
  }

  // etat d'animation pour le rendu (replay.ia) : drapeaux 1 agressif, 2 attaque (coup en cours), 4 arc tendu, 8 en feu ; gonflement 0..1 ; tension
  ecrire() {
    this.majGonfle();
    const a = this.a, sim = this.sim;
    let dr = 0;
    if (this.agressif) dr |= 1;
    if (sim.temps - this.attaqueTick < 10) dr |= 2;
    if (this.arc.tension > 0) dr |= 4;
    if (this.feu > 0) dr |= 8;
    dr |= this.drapeauxEspece();
    // colonnes 7 et 8 : tangage du corps (phantom, volants), direction du lit (villageois endormi)
    sim.replay.ia(sim.temps, a.id, dr, this.gonfle / 30, this.arc.tension, sim.temps - this.attaqueTick === 0 ? 1 : 0, this.tangageCorps ?? 0, this.sommeil ? this.directionLit : 0);
    const plus = this.plusBoss() ?? this.plusEau() ?? this.plusWarden() ?? this.plusBreeze();   // colonne en plus (wither, dragon, gardiens, warden, calmars) : rien pour les autres
    if (plus) sim.replay.iaPlus(sim.temps, a.id, ...plus);
  }
}

// Player.hurt (degats d'un mob selon la difficulte) : paisible 0, facile min(d / 2 + 1, d), normal d, difficile d x 1,5
export function degatsJoueur(d, dif) {
  if (dif === 0) return 0;
  if (dif === 1) return Math.min(d / 2 + 1, d);
  if (dif === 3) return d * 1.5;
  return d;
}
// BowItem.getPowerForTime
export function puissanceArc(ticks) { const t = ticks / 20; return Math.min(1, (t * t + t * 2) / 3); }
// Player.attack : degats x (0,2 + recharge^2 x 0,8), recharge = min(1, (ticks + 0,5) / (20 / vitesse)) ; critique x 1,5
export function coupJoueur(objet, ticksDepuis, { critique = false } = {}) {
  const [deg, vit] = armeDe(objet), periode = 20 / vit;
  const s = Math.max(0, Math.min(1, (ticksDepuis + 0.5) / periode));
  let q = deg * (0.2 + s * s * 0.8);
  const crit = critique && s > 0.9;
  if (crit) q *= 1.5;
  return { degats: q, recharge: s, critique: crit, periode };
}

// comportements des especes (vol, sorciere, enderman, blaze, cerveau du villageois) : moteur/ia-especes.js
Object.assign(IA.prototype, METHODES, VIE, METHODES_BOSS, METHODES_EAU, METHODES_WARDEN, METHODES_BREEZE, METHODES_OEUFS, METHODES_VILLAGEOIS);
