// La vie des creatures (champ `ia: true`), melangee a la classe IA de ia.js : age et croissance des bebes, amour et reproduction, bebes qui
// suivent leurs parents, tentation par la nourriture, reproduction des villageois (nourriture, lits libres), abeilles (fleurs, nectar, ruche,
// miel, cultures, essaim en colere), danse des perroquets et des allays au juke-box, imitations du perroquet, duplication de l'allay,
// conversions (villageois -> zombie villageois, zombie -> noye, foudre, guerison du zombie villageois), golem appele par les villageois,
// blocs pris et poses par l'enderman. Les nouvelles entites passent par Acteurs.naitre (moteur/acteurs.js).
// Port d'apres Horizon (MIT, voir ATTRIBUTIONS.md) : mobs/goals.rs (Breed, FollowParent, Tempt), mobs/ai.rs (feed_animal, age_up, animal_step,
// eating_sound), game/creatures.rs (breed : variantes heritees, coeurs, orbe d'experience), mobs/bee.rs (Pollinate, EnterHive, LocateHive,
// GoToHive, GoToKnownFlower, GrowCrop, colere), beehive.rs (occupants, sortie, miel), mobs/parrot.rs, mobs/allay.rs, mobs/conversion.rs,
// mobs/enderman.rs ; les nombres du jeu sont ecrits a cote de chaque regle.
import { coupe, rayonBloc } from './collision.js';
import { cheminVol, segmentVolLibre, D } from './ia-especes.js';
import { lireVariante, TEINTURES, IMITES } from '../creatures/especes.js';

const RAD = Math.PI / 180, MOVE = 1, LOOK = 2;
const VIANDE = ['beef', 'cooked_beef', 'chicken', 'cooked_chicken', 'porkchop', 'cooked_porkchop', 'mutton', 'cooked_mutton', 'rabbit', 'cooked_rabbit', 'rotten_flesh', 'cod', 'cooked_cod', 'salmon', 'cooked_salmon', 'tropical_fish', 'pufferfish', 'rabbit_stew'];
// #minecraft:flowers et #bee_attractive (Bee.attractsBees : fleur non noyee ; tournesol : la moitie haute)
export const FLEURS = ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'torchflower', 'open_eyeblossom', 'sunflower', 'lilac', 'rose_bush', 'peony', 'pitcher_plant', 'flowering_azalea', 'flowering_azalea_leaves', 'cherry_leaves', 'mangrove_propagule', 'pink_petals', 'wildflowers', 'spore_blossom', 'chorus_flower', 'cactus_flower', 'golden_dandelion'];
// nourriture de reproduction (tags <espece>_food du jeu, Animal.isFood)
export const NOURRITURE = {
  cow: ['wheat'], mooshroom: ['wheat'], sheep: ['wheat'], goat: ['wheat'], pig: ['carrot', 'potato', 'beetroot'],
  chicken: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds', 'torchflower_seeds', 'pitcher_pod'],
  rabbit: ['carrot', 'golden_carrot', 'dandelion'], horse: ['golden_carrot', 'golden_apple', 'enchanted_golden_apple'], donkey: ['golden_carrot', 'golden_apple', 'enchanted_golden_apple'],
  llama: ['hay_block'], trader_llama: ['hay_block'], wolf: VIANDE, cat: ['cod', 'salmon'], fox: ['sweet_berries', 'glow_berries'], bee: FLEURS,
  armadillo: ['spider_eye'], camel: ['cactus'], hoglin: ['crimson_fungus'], strider: ['warped_fungus'],
};
// les equides et le lama ne tombent amoureux qu'apprivoises (AbstractHorse.handleEating) ; loup et chat ne se reproduisent qu'apprivoises (canMate)
const AMOUR_APPRIVOISE = new Set(['horse', 'donkey', 'llama', 'trader_llama']), REPRO_APPRIVOISE = new Set(['horse', 'donkey', 'llama', 'trader_llama', 'wolf', 'cat']);
// vitesses des buts (registerGoals de chaque espece) : BreedGoal, TemptGoal, FollowParentGoal
const REPRO = { rabbit: 0.8, cat: 0.8 };
export const TENTE = { cow: 1.25, mooshroom: 1.25, sheep: 1.1, pig: 1.2, chicken: 1.0, rabbit: 1.0, goat: 1.25, horse: 1.25, donkey: 1.25, llama: 1.25, trader_llama: 1.25, bee: 1.25, camel: 2.5, armadillo: 1.25, cat: 0.6, strider: 1.4 };
const SUIT = { cow: 1.25, mooshroom: 1.25, sheep: 1.1, pig: 1.1, chicken: 1.1, goat: 1.25, horse: 1.0, donkey: 1.0, llama: 1.0, trader_llama: 1.0, bee: 1.25, camel: 2.5, armadillo: 1.25, fox: 1.1, hoglin: 0.6, strider: 1.1 };
// Animal.playEatingSound et ses surcharges (le reste mange en silence)
const SON_MANGER = { pig: 'entity.pig.eat', cat: 'entity.cat.eat', fox: 'entity.fox.eat', goat: 'entity.goat.eat', armadillo: 'entity.armadillo.eat', strider: 'entity.strider.eat', horse: 'entity.horse.eat', donkey: 'entity.donkey.eat', llama: 'entity.llama.eat', trader_llama: 'entity.llama.eat', camel: 'entity.camel.eat' };
// nourriture des villageois (Villager.FOOD_POINTS) et objets qu'ils ramassent (WANTED_ITEMS)
export const POINTS_VILLAGEOIS = { bread: 4, potato: 1, carrot: 1, beetroot: 1 };
// Parrot.MOB_SOUND_MAP : les mobs que le perroquet imite (entity.parrot.imitate.<type>)
export { IMITES };
// #enderman_holdable (blocs que l'enderman prend)
const PORTABLES = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium', 'rooted_dirt', 'moss_block', 'pale_moss_block', 'mud', 'muddy_mangrove_roots', 'sand', 'red_sand', 'gravel', 'clay', 'pumpkin', 'carved_pumpkin', 'melon', 'tnt', 'cactus', 'brown_mushroom', 'red_mushroom', 'crimson_fungus', 'crimson_nylium', 'crimson_roots', 'warped_fungus', 'warped_nylium', 'warped_roots', 'netherrack', ...FLEURS.filter((f) => !['sunflower', 'lilac', 'rose_bush', 'peony', 'pitcher_plant', 'flowering_azalea', 'flowering_azalea_leaves', 'cherry_leaves', 'mangrove_propagule', 'spore_blossom', 'chorus_flower'].includes(f))]);
// melange de deux teintures (recettes de deux colorants : Sheep.getOffspringColor) ; sans recette : l'une des deux au hasard
const MELANGES = { 'red+white': 'pink', 'green+white': 'lime', 'blue+white': 'light_blue', 'black+white': 'gray', 'gray+white': 'light_gray', 'blue+green': 'cyan', 'blue+red': 'purple', 'pink+purple': 'magenta', 'red+yellow': 'orange' };
const CHEVAUX_JEU = ['white', 'creamy', 'chestnut', 'brown', 'black', 'gray', 'darkbrown'], MARQUES_JEU = ['sans', 'markings_white', 'markings_whitefield', 'markings_whitedots', 'markings_blackdots'];
const ZOMBIES = /^mob:(zombie|husk|drowned|zombie_villager)$/;
const journal = (sim, t) => (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${t}`);
// GossipType : poids, maximum, declin par jour, declin par transfert
export const RAGOTS = { major_negative: { poids: -5, max: 100, declin: 10, transfert: 10 }, minor_negative: { poids: -1, max: 200, declin: 20, transfert: 20 }, minor_positive: { poids: 1, max: 25, declin: 1, transfert: 5 }, major_positive: { poids: 5, max: 20, declin: 0, transfert: 20 }, trading: { poids: 1, max: 25, declin: 2, transfert: 20 } };

export function declarerReglesVie(regles) {
  regles.declarer('reproduction.actif', { def: true, doc: 'les animaux nourris tombent amoureux (600 ticks), se rejoignent et font un bebe ; les villageois nourris aussi (lit libre)' });
  regles.declarer('naissances.max', { def: 16, min: 0, max: 64, entier: true, doc: 'entites nees pendant une scene (bebes, conversions, golems, allays dupliques) ; au-dela, rien ne nait (avertissement)' });
  regles.declarer('entites.max', { def: 40, min: 1, max: 64, entier: true, doc: 'acteurs en tout dans une scene simulee (ceux de la scene + les nes) ; au-dela, rien ne nait' });
  regles.declarer('abeilles.pollinisation', { def: 400, min: 1, max: 1200, entier: true, doc: 'ticks de vol au-dessus d une fleur avant que l abeille porte du nectar (le jeu : plus de 400, abandon a 600)' });
  regles.declarer('abeilles.rucheNectar', { def: 2400, min: 1, max: 24000, entier: true, doc: 'ticks dans la ruche d une abeille qui rapporte du nectar (le jeu : 2400) ; elle ressort et le miel monte d un cran' });
  regles.declarer('abeilles.ruche', { def: 600, min: 1, max: 24000, entier: true, doc: 'ticks dans la ruche d une abeille sans nectar (le jeu : 600)' });
  regles.declarer('ia.endermanBlocs', { def: true, doc: 'l enderman prend des blocs (terre, sable, fleurs... : 1 chance sur 10 par tick d en viser un a 2 blocs) et les repose (1 sur 1000) (mobGriefing)' });
  regles.declarer('ia.golems', { def: true, doc: 'les villageois appellent un golem de fer (5 qui ont dormi dans la journee et bavardent, ou 3 qui paniquent ; pas de golem a 16 blocs)' });
}

export const VIE = {
  // ---- etat (appele par le constructeur d'IA) -----------------------------------------------------------------------------------
  initVie(d) {
    this.age = d.age ?? (d.bebe ? (this.type === 'sniffer' ? -48000 : -24000) : 0); this.fracAge = 0; this.amour = 0;   // AgeableMob.getBabyStartAge (renifleur : -48000, Horizon mobs/sniffer.rs BABY_START_AGE)
    this.apprivoise = !!(d.apprivoise || d.colle || this.type === 'camel'); this.colle = d.colle ?? null; this.gabAdulte = d.gabaritAdulte ?? null;
    if (this.type === 'bee') {
      this.ruche = d.ruche ?? null; this.fleur = null; this.nectar = /nectar/.test(String(d.variante ?? '')); this.dehorsRuche = 0; this.cdRuche = 0;
      this.cdFleur = 20 + this.h.entierBorne(41); this.sansNectar = 0; this.pollinise = false; this.cultures = 0; this.dansRuche = null; this.listeNoire = [];
    }
    if (this.type === 'enderman' && d.porte) { this.porteEtat = 'minecraft:' + String(d.porte).replace(/^minecraft:/, ''); this.a.main = { objet: String(d.porte).replace(/^minecraft:/, ''), efficacite: 0 }; }
    if (this.type === 'villager' && d.nourriture) for (const [k, n] of Object.entries(d.nourriture)) this.a.sac.set(k, (this.a.sac.get(k) || 0) + n);
    this.faim = 0;   // Villager.foodLevel
    if (this.type === 'villager') this.initVillageois(d);   // ia-villageois.js
  },
  installerVie(add) {
    const t = this.type, f = this.pr.fam;
    if (NOURRITURE[t] && t !== 'mule') { add(2, 'reproduit', MOVE | LOOK); if (TENTE[t]) add(3, 'tente', MOVE | LOOK); if (SUIT[t]) add(4, 'suitParent', 0); }
    if (t === 'bee') { add(1, 'entreRuche', 0); add(4, 'pollinise', MOVE); add(5, 'chercheRuche', 0); add(5, 'versRuche', MOVE); add(6, 'versFleur', MOVE); add(7, 'pousseCulture', 0); }
    if (t === 'villager') this.installerVillageois(add);   // temps libre, echanges, reproduction, jeu des bebes, POI (ia-villageois.js)
    if (t === 'enderman') { add(10, 'endermanPose', 0); add(11, 'endermanPrend', 0); }
    this.installerOeufs(add);   // tortue, grenouille, ocelot (ia-oeufs.js)
    void f;
  },
  // deplacement commun (marche ou vol) vers un point
  aller(x, y, z, vit, opt = {}) {
    if (this.nage && this.a.dansEau) { this.nageVers(x, (y ?? this.a.y) + 0.3, z, vit, 10); return; }   // nageurs dans l'eau (ia-eau.js)
    if (this.vol && ['animal', 'allay'].includes(this.vol.mode)) { this.gravite = false; this.volVers(x, y, z, vit); }
    else this.allerVers(x, y, z, vit, { recalcul: 10, ...opt });
  },
  enMarche() { return this.nage && this.a.dansEau ? !this.nageFinie() : this.vol ? !this.volFini() : !this.navFinie(); },
  particulesAutour(nom, n, dy = 0.5) {   // LivingEntity : getRandomX(1), getRandomY() + dy, getRandomZ(1), vitesse gaussienne x 0,02
    const a = this.a, h = this.h;
    for (let i = 0; i < n; i++) this.sim.particule(nom, a.x + a.L * (2 * h.reel() - 1), a.y + a.H * h.reel() + dy, a.z + a.L * (2 * h.reel() - 1), h.gaussien() * 0.02, h.gaussien() * 0.02, h.gaussien() * 0.02, 1);
  },
  jourTicks() { const h = this.sim.heureMonde(); return Math.floor(((((h - 6) % 24) + 24) % 24) * 1000); },
  pleut() { return (this.sim.api.niveauxMeteo().pluie ?? 0) > 0.2; },

  // ---- chaque tick, avant les buts : age, amour, compteurs ; rend vrai si la creature est dans une ruche (rien d'autre ne tourne) --------
  tickVie() {
    const a = this.a, sim = this.sim;
    // AgeableMob.aiStep : un bebe grandit d'un tick par tick (x `croissance.vitesse`, le lapse de temps du monde) ; un adulte compte son attente
    if (this.age < 0) {
      this.fracAge += sim.regles.valeur('croissance.vitesse', 1);
      const n = Math.floor(this.fracAge);
      if (n > 0) { this.fracAge -= n; this.age = Math.min(0, this.age + n); if (this.age === 0) this.grandir(); }
    } else if (this.age > 0) this.age--;
    // Animal.aiStep : l'amour s'arrete si l'age n'est pas 0 ; un coeur toutes les 10 ticks
    if (this.age !== 0) this.amour = 0;
    if (this.amour > 0) { this.amour--; if (this.amour % 10 === 0) this.particulesAutour('heart', 1); }
    if (this.cdDuplication > 0) this.cdDuplication--;
    if (this.type === 'bee') { if (this.tickAbeille()) return true; }
    if (this.type === 'parrot' || this.type === 'allay') this.tickDanse();
    if (this.type === 'parrot') this.imiter();
    if (['zombie', 'husk', 'zombie_villager'].includes(this.type)) this.tickNoyade();
    if (this.conversionSoin !== undefined) this.tickSoin();
    if (this.type === 'villager') this.tickVillageoisVie();
    this.tickOeufs();   // poule qui pond, tetard qui grandit, tortue qui creuse (ia-oeufs.js)
    return false;
  },
  grandir() {
    const a = this.a, sim = this.sim, g = this.gabAdulte;
    this.bebe = false;
    if (g) { a.L = g.l; a.H = g.h; a.O = g.oeil; }
    sim.replay.croissances.push({ tick: sim.temps, nom: a.nom, change: { bebe: false } });
    this.stat('croissances'); journal(sim, `${a.nom} devient adulte`);
  },
  // changement d'apparence en cours de route (creeper charge, champimeuh qui change de couleur) : le film change le modele a ce tick
  changer(change) { this.sim.replay.croissances.push({ tick: this.sim.temps, nom: this.a.nom, change }); },

  // ---- nourrir (Animal.mobInteract, feed_animal) ------------------------------------------------------------------------------
  nourrir(joueur, objet) {
    const a = this.a, sim = this.sim, o = String(objet).replace(/^minecraft:/, ''), t = this.type;
    const r0 = this.nourrirOeufs(joueur, o); if (r0 !== undefined) return r0;   // ocelot (confiance), tetard (boule de slime)
    if (t === 'allay' && o === 'amethyst_shard') return this.dupliquer(joueur);
    if (t === 'zombie_villager' && o === 'golden_apple') return this.commencerSoin(joueur);
    if (!NOURRITURE[t]?.includes(o) || t === 'mule' || !sim.regles.valeur('reproduction.actif', true)) return null;
    if (sim.temps - this.blesseTick < 100) return 'panique : ne mange pas';
    const son = () => { const s = SON_MANGER[t]; if (s) sim.son(s, a.x, a.y, a.z, 1, t === 'goat' ? 0.8 + this.h.flottant() * 0.4 : 1); };
    if (this.age === 0 && this.amour <= 0) {
      if (AMOUR_APPRIVOISE.has(t) && !this.apprivoise) { son(); return `${t} non apprivoise : il mange sans tomber amoureux`; }
      this.amour = 600; this.amoureuxPar = joueur.nom;
      this.particulesAutour('heart', 7);   // evenement 18 (Animal.handleEntityEvent) : 7 coeurs
      son(); this.stat('amours'); journal(sim, `${a.nom} mange ${o} et tombe amoureux`);
      return 'amoureux (600 ticks)';
    }
    if (this.age < 0) {   // AgeableMob.ageUp(getSpeedUpSecondsWhenFeeding(-age)) : un dixieme du temps qui reste
      const s = Math.floor(Math.floor(-this.age / 20) * 0.1), avant = this.age;
      this.age = Math.min(0, this.age + s * 20);
      this.particulesAutour('happy_villager', 1);
      son(); journal(sim, `${a.nom} mange ${o} : grandit de ${s} s`);
      if (avant < 0 && this.age === 0) this.grandir();
      return `grandit de ${s} s`;
    }
    return this.age > 0 ? `n en veut pas (attente de reproduction : ${Math.ceil(this.age / 20)} s)` : 'deja amoureux';
  },

  // ---- reproduction (BreedGoal) --------------------------------------------------------------------------------------------------
  memeEspece(o) {
    const t = this.type, u = o.ia?.type;
    if (!u) return false;
    if (/llama/.test(t)) return /llama/.test(u);
    if (t === 'horse' || t === 'donkey') return u === 'horse' || u === 'donkey';
    return u === t;
  },
  panique() { return this.sim.temps - this.blesseTick < 100 || this.actifs.has(this.but('panique')); },
  peutReproduire() {
    if (this.amour <= 0 || this.bebe || this.type === 'mule') return false;
    if (REPRO_APPRIVOISE.has(this.type) && !this.apprivoise) return false;
    if (/horse|donkey|llama|camel/.test(this.type) && this.a.vie < this.a.vieMax) return false;   // AbstractHorse.canParent : pleine sante
    if (!this.conditionOeufs()) return false;   // panda : du bambou a 8 blocs ; ocelot : confiance
    return this.sim.acteurs.peutNaitre();
  },
  peut_reproduit() {
    if (!this.peutReproduire()) return false;
    let best = null, bd = Infinity;
    for (const o of this.autres()) {
      const q = o.ia;
      if (!q || !this.memeEspece(o) || q.amour <= 0 || q.bebe || q.panique() || (REPRO_APPRIVOISE.has(q.type) && !q.apprivoise)) continue;
      const d = this.dist2(o); if (d <= 64 && d < bd) { bd = d; best = o; }
    }
    this.partenaire = best; return !!best;
  },
  continue_reproduit() { const p = this.partenaire; return !!p && p.mort < 0 && p.ia.amour > 0 && !p.ia.panique() && this.tempsAmour < 60; },
  debut_reproduit() { this.tempsAmour = 0; },
  fin_reproduit() { this.partenaire = null; this.tempsAmour = 0; },
  tick_reproduit() {
    const p = this.partenaire;
    this.regarder(p);
    this.aller(p.x, p.y, p.z, REPRO[this.type] ?? 1.0);
    this.tempsAmour++;
    if (this.tempsAmour >= 60 && this.dist2(p) < 9) this.naissance(p);
  },
  // Animal.spawnChildFromBreeding / finalizeSpawnChildFromBreeding : bebe a la place du parent, age -24000 ; les parents attendent 6000 ticks ;
  // 7 coeurs ; une orbe d'experience de 1 a 7
  naissance(p) {
    const a = this.a, sim = this.sim, q = p.ia;
    this.amour = 0; this.age = 6000; q.amour = 0; q.age = 6000;
    if (this.naissanceOeuf(p)) return null;   // tortue (oeuf a pondre), grenouille (frai a pondre), renifleur (oeuf lache) : ia-oeufs.js
    const type = (this.type === 'horse' && q.type === 'donkey') || (this.type === 'donkey' && q.type === 'horse') ? 'mule' : this.type;
    const her = this.heritage(type, q);
    this.particulesAutour('heart', 7);
    const xp = 1 + this.h.entierBorne(7);
    sim.stats.experience = (sim.stats.experience || 0) + xp;
    sim.entites.orbes(a.x, a.y, a.z, xp);   // l'orbe d'experience (ExperienceOrb), dessinee
    const b = sim.acteurs.naitre({ type, variante: her.variante, bebe: true, x: a.x, y: a.y, z: a.z, lacet: 0, modele: a.nom, raison: 'reproduction', gabaritParent: { l: a.L, h: a.H, oeil: a.O, vitesse: a.kVit }, colle: her.colle, ia: { apprivoise: her.apprivoise, colle: her.colle, parents: [a.nom, p.nom], ruche: this.ruche ?? null, ...(her.genes ? { genes: her.genes } : {}) } });
    this.stat('naissances');
    journal(sim, `${a.nom} et ${p.nom} ont un bebe${b ? ' : ' + b.nom : ' (plafond)'} (+${xp} xp)`);
    return b;
  },
  // variante du bebe (getBreedOffspring de chaque espece)
  heritage(type, q) {
    const h = this.h, mot = (ia, i) => lireVariante(ia.type, ia.variante).choix?.[i];
    const coin = () => h.booleen();
    const out = { variante: null, apprivoise: false, colle: null };
    const melange = (c1, c2) => { if (!c1 || !c2) return c1 ?? c2 ?? null; if (c1 === c2) return c1; const k = [c1, c2].sort().join('+'); return MELANGES[k] ?? (h.booleen() ? c1 : c2); };
    switch (type) {
      case 'cow': case 'pig': case 'chicken': case 'fox': out.variante = coin() ? mot(this, 0) : mot(q, 0); break;
      case 'mooshroom': { const m = mot(this, 0), n = mot(q, 0); out.variante = m === n && h.entierBorne(1024) === 0 ? (m === 'red' ? 'brown' : 'red') : h.booleen() ? m : n; break; }
      case 'sheep': out.variante = melange(mot(this, 0), mot(q, 0)); break;
      case 'cat': case 'wolf': out.variante = coin() ? mot(this, 0) : mot(q, 0); if (this.apprivoise) { out.apprivoise = true; out.colle = melange(this.colle ?? 'red', q.colle ?? 'red'); } break;
      case 'llama': case 'trader_llama': out.variante = coin() ? mot(this, 0) : mot(q, 0); break;
      case 'rabbit': out.variante = h.entierBorne(20) !== 0 ? (h.booleen() ? mot(this, 0) : mot(q, 0)) : 'brown'; break;   // 1 sur 20 : la variante du biome (brun hors desert et neige)
      case 'horse': {
        const c = h.entierBorne(9), robe = c < 4 ? mot(this, 0) : c < 8 ? mot(q, 0) : CHEVAUX_JEU[h.entierBorne(7)];
        const k = h.entierBorne(5), marque = k < 2 ? mot(this, 1) : k < 4 ? mot(q, 1) : MARQUES_JEU[h.entierBorne(5)];
        out.variante = `${robe} ${marque}`; out.apprivoise = false; break;
      }
      default: this.heritageOeufs(type, q, out); break;   // axolotl (bleu 1 sur 1200), panda (genes)
    }
    return out;
  },
  // FollowParentGoal : bebe a plus de 3 blocs de l'adulte de son espece le plus proche (8 x 4 x 8) ; il le suit jusqu'a 3 blocs (16 au plus)
  peut_suitParent() {
    if (this.age >= 0) return false;
    let best = null, bd = Infinity;
    for (const o of this.autres()) {
      if (!o.ia || o.ia.type !== this.type || o.ia.bebe || Math.abs(o.x - this.a.x) > 8 || Math.abs(o.y - this.a.y) > 4 || Math.abs(o.z - this.a.z) > 8) continue;
      const d = this.dist2(o); if (d <= bd) { bd = d; best = o; }
    }
    if (!best || bd < 9) return false;
    this.parentSuivi = best; return true;
  },
  continue_suitParent() { const p = this.parentSuivi; if (this.age >= 0 || !p || p.mort >= 0) return false; const d = this.dist2(p); return d >= 9 && d <= 256; },
  debut_suitParent() { this.recalculParent = 0; },
  fin_suitParent() { this.parentSuivi = null; },
  tick_suitParent() {
    if (--this.recalculParent > 0) return;
    this.recalculParent = 10;
    const p = this.parentSuivi; this.aller(p.x, p.y, p.z, SUIT[this.type] ?? 1.1);
  },
  // TemptGoal : un joueur a 10 blocs qui tient sa nourriture ; il s'approche a 2,5 blocs ; 100 ticks de calme apres
  peut_tente() {
    if (this.calmeTente > 0) { this.calmeTente--; return false; }
    const f = NOURRITURE[this.type] ?? [];
    const j = this.autres().filter((o) => this.typeDe(o) === 'joueur' && f.includes(String(o.main?.objet ?? '')) && this.dist2(o) < 100).sort((p, q) => this.dist2(p) - this.dist2(q))[0];
    this.tentateur = j ?? null; return !!j;
  },
  continue_tente() { const j = this.tentateur; return !!j && j.mort < 0 && (NOURRITURE[this.type] ?? []).includes(String(j.main?.objet ?? '')) && this.dist2(j) < 100; },
  fin_tente() { this.tentateur = null; this.calmeTente = 100; this.nav = null; this.navVol = null; },
  tick_tente() {
    const j = this.tentateur; this.regarder(j);
    if (this.dist2(j) < 6.25) { this.nav = null; this.navVol = null; } else this.aller(j.x, j.y, j.z, TENTE[this.type]);
  },

  // ---- abeilles ------------------------------------------------------------------------------------------------------------------
  colere() { return !!this.blessePar && this.sim.temps < (this.colereFin ?? 0) && this.dard; },
  calme() { return !this.colere() && !this.cible; },
  nuitAbeille() { const t = this.jourTicks(); return (t >= 12542 && t < 23460) || this.pleut(); },   // BEES_STAY_IN_HIVE : nuit du monde ou pluie
  estRuche(p) { if (!p) return false; const e = this.sim.monde.etatEn(p[0], p[1], p[2]); return e >= 0 && /^(beehive|bee_nest)$/.test(this.sim.d.nomBloc(e)); },
  rucheValide() { const p = this.ruche; return !!p && this.blocProche(p, 48) && this.estRuche(p); },
  blocProche(p, r) { const a = this.a, d = [p[0] - Math.floor(a.x), p[1] - Math.floor(a.y), p[2] - Math.floor(a.z)]; return d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < r * r; },
  rucheFeu() { const p = this.ruche; if (!this.rucheValide()) return false; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const e = this.sim.monde.etatEn(p[0] + dx, p[1] + dy, p[2] + dz); if (e >= 0 && this.sim.d.nomBloc(e) === 'fire') return true; } return false; },
  veutRuche() { return this.dehorsRuche <= 0 && !this.pollinise && this.dard && !this.cible && (this.nectar || this.sansNectar > 3600 || this.nuitAbeille()) && !this.rucheFeu(); },
  occupants(p) { return this.sim.acteurs.liste.filter((o) => o.ia?.dansRuche && o.ia.dansRuche.pos.join() === p.join()).length; },
  infoRuche(p) { const m = (this.sim.ruches ??= new Map()), k = p.join(); if (!m.has(k)) m.set(k, { fleur: null }); return m.get(k); },
  // Bee.aiStep / customServerAiStep : compteurs, nectar qui tombe (5 % par tick, 1 ou 2 gouttes, moins de 10 cultures poussees)
  tickAbeille() {
    const a = this.a, sim = this.sim, h = this.h;
    if (this.dansRuche) { this.tickRuche(); return true; }
    for (const k of ['dehorsRuche', 'cdRuche', 'cdFleur']) if (this[k] > 0) this[k]--;
    if (!this.nectar) this.sansNectar++;
    if (sim.temps % 20 === 0 && this.ruche && !this.rucheValide()) this.ruche = null;
    if (this.nectar && this.cultures < 10 && h.flottant() < 0.05) {
      const n = h.entierBorne(2) + 1;
      for (let i = 0; i < n; i++) sim.particule('falling_nectar', a.x - 0.3 + h.reel() * 0.6, a.y + a.H * 0.5, a.z - 0.3 + h.reel() * 0.6, 0, 0, 0, 1);
    }
    return false;
  },
  // BeeEnterHiveGoal : a moins de 2 blocs du centre de la ruche, avec l'envie d'y entrer ; ruche pleine (3) : il l'oublie
  peut_entreRuche() {
    const p = this.ruche, a = this.a;
    if (!p || (p[0] + 0.5 - a.x) ** 2 + (p[1] + 0.5 - a.y) ** 2 + (p[2] + 0.5 - a.z) ** 2 >= 4 || !this.veutRuche() || !this.rucheValide()) return false;
    if (this.occupants(p) >= 3) { this.ruche = null; return false; }
    return this.calme();
  },
  continue_entreRuche() { return false; },
  tick_entreRuche() {},
  debut_entreRuche() {
    const a = this.a, sim = this.sim, p = this.ruche.slice(), R = sim.regles;
    const info = this.infoRuche(p);
    if (this.fleur && (!info.fleur || this.h.booleen())) info.fleur = this.fleur.slice();
    this.dansRuche = { pos: p, ticks: 0, min: this.nectar ? R.valeur('abeilles.rucheNectar', 2400) : R.valeur('abeilles.ruche', 600), nectar: this.nectar };
    sim.son('block.beehive.enter', p[0], p[1], p[2], 1, 1);
    a.x = p[0] + 0.5; a.y = p[1] + 0.5 - a.H / 2; a.z = p[2] + 0.5; a.vx = a.vy = a.vz = 0; this.navVol = null; this.nav = null;
    this.stat('entreesRuche'); journal(sim, `${a.nom} entre dans la ruche ${p.join(',')}${this.nectar ? ' avec du nectar' : ''}`);
  },
  // BeehiveBlockEntity.serverTick : l'abeille sort quand son temps est passe (pas la nuit ni sous la pluie, l'avant de la ruche libre) ;
  // bourdonnement de la ruche (0,5 % par tick)
  tickRuche() {
    const r = this.dansRuche, sim = this.sim, a = this.a;
    a.vx = a.vy = a.vz = 0;
    if (!this.estRuche(r.pos)) { this.sortirRuche('urgence'); return; }
    const fini = r.ticks > r.min; r.ticks++;
    if (fini && this.sortirRuche(r.nectar ? 'miel' : 'sortie')) return;
    const premier = sim.acteurs.liste.find((o) => o.ia?.dansRuche && o.ia.dansRuche.pos.join() === r.pos.join());
    if (premier === a && this.h.reel() < 0.005) sim.son('block.beehive.work', r.pos[0] + 0.5, r.pos[1], r.pos[2] + 0.5, 1, 1);
  },
  sortirRuche(statut) {
    const r = this.dansRuche, sim = this.sim, a = this.a, p = r.pos;
    if (statut !== 'urgence' && this.nuitAbeille()) return false;
    const e = sim.monde.etatEn(p[0], p[1], p[2]), face = e >= 0 ? sim.d.prop(e, 'facing') : 'south';
    const f = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[face] ?? [0, 1];
    const bloque = coupe(a.lec, [p[0] + f[0] + 0.01, p[1] + 0.01, p[2] + f[1] + 0.01, p[0] + f[0] + 0.99, p[1] + 0.99, p[2] + f[1] + 0.99]);
    if (bloque && statut !== 'urgence') return false;
    // setBeeReleaseData : le temps passe dedans compte pour grandir et pour l'amour
    if (this.age < 0) { this.age = Math.min(0, this.age + r.ticks); if (this.age === 0) this.grandir(); } else if (this.age > 0) this.age = Math.max(0, this.age - r.ticks);
    this.amour = Math.max(0, this.amour - r.ticks);
    const info = this.infoRuche(p);
    if (info.fleur && !this.fleur && this.h.flottant() < 0.9) this.fleur = info.fleur.slice();
    if (statut === 'miel') {
      this.nectar = false; this.cultures = 0;
      const niv = e >= 0 ? Number(sim.d.prop(e, 'honey_level') ?? -1) : -1;
      if (niv >= 0 && niv < 5) {
        let plus = this.h.entierBorne(100) === 0 ? 2 : 1; if (niv + plus > 5) plus--;
        sim.poser(p[0], p[1], p[2], sim.d.chaine(e).replace(/honey_level=\d/, `honey_level=${niv + plus}`), 3);
        this.stat('miel', plus); journal(sim, `ruche ${p.join(',')} : miel ${niv} -> ${niv + plus}`);
      }
    }
    const delta = bloque ? 0 : 0.55 + a.L / 2;
    a.x = p[0] + 0.5 + delta * f[0]; a.y = p[1] + 0.5 - a.H / 2; a.z = p[2] + 0.5 + delta * f[1];
    a.lacet = Math.atan2(-f[0], f[1]) / RAD; a.lacetTete = a.lacet;
    sim.son('block.beehive.exit', p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 1, 1);
    this.dansRuche = null; this.ruche = estRucheBloc(sim, p) ? p : null; this.gravite = false;
    this.stat('sortiesRuche'); journal(sim, `${a.nom} sort de la ruche ${p.join(',')}${statut === 'urgence' ? ' (urgence)' : ''}`);
    return true;
  },
  // ruche cassee (Acteurs.rucheCassee) : sortie d'urgence, colere contre celui qui casse (4 blocs), puis les abeilles a 8 x 6 x 8 blocs sans cible
  surRucheCassee(pos, joueur, phase) {
    if (this.type !== 'bee') return;
    const a = this.a;
    if (phase === 'sortie') {
      if (this.dansRuche && this.dansRuche.pos.join() === pos.join()) { this.sortirRuche('urgence'); if (this.dist2(joueur) <= 16) this.facher(joueur); }
      if (this.ruche && this.ruche.join() === pos.join()) { this.ruche = null; this.cdRuche = 200; }
      return;
    }
    if (a.x >= pos[0] - 8 && a.x <= pos[0] + 9 && a.y >= pos[1] - 6 && a.y <= pos[1] + 7 && a.z >= pos[2] - 8 && a.z <= pos[2] + 9 && !this.cible && !this.colere()) this.facher(joueur);
  },
  facher(o) {
    if (!this.dard || this.typeDe(o) !== 'joueur') return;
    this.blessePar = o; this.blesseTick = this.sim.temps; this.colereFin = this.sim.temps + 400 + this.h.entierBorne(381);   // NeutralMob : 400 a 780 ticks
    this.stat('coleres'); journal(this.sim, `${this.a.nom} en colere contre ${o.nom}`);
  },
  // BeePollinateGoal : une fleur a 5 blocs (la plus proche en distance de Manhattan, chemin possible), vol jusqu'a elle a 1,2 puis au-dessus
  // d'elle (0,6) a 0,35 ; nouveau point a +-1/3 de bloc une fois sur 25 ; nectar apres plus de 400 ticks, puis 1 chance sur 5 de repartir par tick
  chercherFleur() {
    const a = this.a, o = [Math.floor(a.x), Math.floor(a.y), Math.floor(a.z)];
    for (const p of manhattan(o, 5, 5, 5)) {
      const e = this.sim.monde.etatEn(p[0], p[1], p[2]);
      if (e < 0) continue;
      const n = this.sim.d.nomBloc(e);
      if (!FLEURS.includes(n) || this.sim.d.prop(e, 'waterlogged') === 'true' || (n === 'sunflower' && this.sim.d.prop(e, 'half') !== 'upper')) continue;
      const c = [p[0] + 0.5, p[1] + 0.6, p[2] + 0.5];
      if (segmentVolLibre(a.lec, [a.x, a.y, a.z], c, Math.max(0.3, a.L), a.H)) return p;
      const ch = cheminVol(a.lec, [a.x, a.y, a.z], c, Math.max(0.3, a.L), a.H, 600);
      const der = ch?.[ch.length - 1];
      if (der && Math.hypot(der[0] - c[0], der[1] - c[1], der[2] - c[2]) < 1.5) return p;
    }
    return null;
  },
  peut_pollinise() {
    if (this.cdFleur > 0 || this.nectar || this.pleut() || !this.calme()) return false;
    const p = this.chercherFleur();
    if (!p) { this.cdFleur = 20 + this.h.entierBorne(41); return false; }
    this.fleur = p; this.gravite = false; this.volVers(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 1.2);
    return true;
  },
  continue_pollinise() {
    if (!this.pollinise || !this.fleur || this.pleut() || !this.calme()) return false;
    return this.succes > this.sim.regles.valeur('abeilles.pollinisation', 400) ? this.h.flottant() < 0.2 : true;
  },
  debut_pollinise() { this.succes = 0; this.ticksP = 0; this.dernierSonP = 0; this.pollinise = true; this.sansNectar = 0; this.survol = null; this.stat('pollinisations'); journal(this.sim, `${this.a.nom} va polliniser ${this.fleur.join(',')}`); },
  fin_pollinise() {
    if (this.succes > this.sim.regles.valeur('abeilles.pollinisation', 400)) { this.nectar = true; this.stat('nectars'); journal(this.sim, `${this.a.nom} porte du nectar`); }
    this.pollinise = false; this.navVol = null; this.cdFleur = 200;
  },
  tick_pollinise() {
    const a = this.a, f = this.fleur;
    if (!f) return;
    if (++this.ticksP > 600) { this.fleur = null; this.cdFleur = 20 + this.h.entierBorne(41); this.pollinise = false; this.cdFleur = 200; return; }
    const fl = [f[0] + 0.5, f[1] + 0.6, f[2] + 0.5], dist = (p) => Math.hypot(p[0] - a.x, p[1] - a.y, p[2] - a.z);
    if (dist(fl) > 1) { this.survol = fl; if (this.volFini()) this.viser(fl, 0.35); return; }
    const sv = (this.survol ??= fl);
    const arrive = dist(sv) <= 0.1;
    if (!arrive && this.ticksP > 600) { this.fleur = null; return; }
    let viser = true;
    if (arrive) {
      if (this.h.entierBorne(25) === 0) { this.survol = [fl[0] + (this.h.flottant() * 2 - 1) * 0.33333334, fl[1], fl[2] + (this.h.flottant() * 2 - 1) * 0.33333334]; this.navVol = null; } else viser = false;
      this.regarder(fl);
    }
    if (viser) this.viser(this.survol, 0.35);
    this.succes++;
    if (this.h.flottant() < 0.05 && this.succes > this.dernierSonP + 60) { this.dernierSonP = this.succes; this.sim.son('entity.bee.pollinate', a.x, a.y, a.z, 1, 1); }
  },
  // MoveControl.setWantedPosition : droit vers le point, sans chemin
  viser(p, mod) { this.navVol = { but: p.slice(), chemin: [p.slice()], i: 0, mod, prochain: this.sim.temps + 1, precis: true }; },
  // BeeLocateHiveGoal : toutes les 200 ticks, la ruche la plus proche (20 blocs) qui a de la place
  peut_chercheRuche() { return this.cdRuche === 0 && !this.ruche && this.veutRuche() && this.calme(); },
  continue_chercheRuche() { return false; },
  tick_chercheRuche() {},
  debut_chercheRuche() {
    this.cdRuche = 200;
    const a = this.a, o = [Math.floor(a.x), Math.floor(a.y), Math.floor(a.z)], trouves = [];
    for (let dx = -20; dx <= 20; dx++) for (let dy = -20; dy <= 20; dy++) for (let dz = -20; dz <= 20; dz++) {
      if (dx * dx + dy * dy + dz * dz > 400) continue;
      const p = [o[0] + dx, o[1] + dy, o[2] + dz];
      if (this.estRuche(p) && this.occupants(p) < 3) trouves.push(p);
    }
    trouves.sort((p, q) => ((p[0] - o[0]) ** 2 + (p[1] - o[1]) ** 2 + (p[2] - o[2]) ** 2) - ((q[0] - o[0]) ** 2 + (q[1] - o[1]) ** 2 + (q[2] - o[2]) ** 2));
    const pris = trouves.find((p) => !this.listeNoire.some((n) => n.join() === p.join()));
    if (!pris && trouves.length) this.listeNoire = [];
    this.ruche = pris ?? trouves[0] ?? this.ruche;
    if (this.ruche) journal(this.sim, `${a.nom} trouve la ruche ${this.ruche.join(',')}`);
  },
  // BeeGoToHiveGoal : vers la ruche (au hasard vers elle au-dela de 16 blocs, sinon un chemin jusqu'a la case devant) ; 2400 ticks au plus
  devantRuche(p) {
    const e = this.sim.monde.etatEn(p[0], p[1], p[2]), face = e >= 0 ? this.sim.d.prop(e, 'facing') : 'south';
    const f = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[face] ?? [0, 1];
    return [p[0] + f[0] + 0.5, p[1] + 0.2, p[2] + f[1] + 0.5];
  },
  peut_versRuche() { const p = this.ruche; return !!p && this.blocProche(p, 48) && this.veutRuche() && !this.blocProche(p, 2) && this.estRuche(p) && this.calme(); },
  continue_versRuche() { return this.peut_versRuche(); },
  debut_versRuche() { this.voyage = 0; },
  fin_versRuche() { this.voyage = 0; this.navVol = null; },
  tick_versRuche() {
    const p = this.ruche;
    if (++this.voyage > 2400) { this.listeNoire.push(p); while (this.listeNoire.length > 3) this.listeNoire.shift(); this.ruche = null; this.cdRuche = 200; return; }
    if (!this.volFini()) return;
    if (!this.blocProche(p, 16)) this.versHasard(p);
    else { const d = this.devantRuche(p); this.gravite = false; this.volVers(d[0], d[1], d[2], 1.0); if (!this.navVol?.chemin?.length) { this.listeNoire.push(p); this.ruche = null; this.cdRuche = 200; } }
  },
  // Bee.pathfindRandomlyTowards : un point au hasard vers la cible (moitie de la distance, au plus 6 / 8 blocs)
  versHasard(p) {
    const a = this.a, dist = Math.abs(p[0] - Math.floor(a.x)) + Math.abs(p[1] - Math.floor(a.y)) + Math.abs(p[2] - Math.floor(a.z));
    const hz = dist < 15 ? dist / 2 : 6, d = [p[0] + 0.5 - a.x, p[1] - a.y, p[2] + 0.5 - a.z], L = Math.hypot(d[0], d[2]) || 1;
    const ang = Math.atan2(d[2], d[0]) + (this.h.flottant() * 2 - 1) * Math.PI / 10, r = Math.min(L, hz);
    const dyA = d[1] > 2 ? 4 : d[1] < -2 ? -4 : 0;
    this.gravite = false; this.volVers(a.x + Math.cos(ang) * r, a.y + Math.max(-hz, Math.min(hz, dyA)) * 0.5, a.z + Math.sin(ang) * r, 1.0);
  },
  // BeeGoToKnownFlowerGoal : 600 ticks sans nectar, il retourne vers la fleur connue
  peut_versFleur() { return !!this.fleur && this.sansNectar > 600 && !this.blocProche(this.fleur, 2) && this.calme(); },
  continue_versFleur() { return this.peut_versFleur(); },
  debut_versFleur() { this.voyageF = 0; },
  tick_versFleur() { if (++this.voyageF > 2400) { this.fleur = null; return; } if (this.volFini()) { if (!this.blocProche(this.fleur, 48)) this.fleur = null; else this.versHasard(this.fleur); } },
  // BeeGrowCropGoal : avec du nectar et une ruche, moins de 10 cultures : 1 chance sur 15 par tick de faire pousser d'un cran la culture 1 ou 2 blocs sous elle
  peut_pousseCulture() { return this.cultures < 10 && this.h.flottant() >= 0.3 && this.nectar && this.rucheValide() && this.calme(); },
  continue_pousseCulture() { return this.peut_pousseCulture(); },
  tick_pousseCulture() {
    if (this.h.entierBorne(15) !== 0) return;
    const a = this.a, sim = this.sim, X = Math.floor(a.x), Y = Math.floor(a.y), Z = Math.floor(a.z);
    for (let i = 1; i <= 2; i++) {
      const e = sim.monde.etatEn(X, Y - i, Z); if (e < 0) continue;
      const n = sim.d.nomBloc(e), max = { wheat: 7, carrots: 7, potatoes: 7, melon_stem: 7, pumpkin_stem: 7, beetroots: 3, sweet_berry_bush: 3, torchflower_crop: 1 }[n];
      if (max === undefined) continue;
      const age = Number(sim.d.prop(e, 'age'));
      if (!(age < max)) continue;
      const nouv = n === 'torchflower_crop' && age + 1 >= 2 ? 'minecraft:torchflower' : sim.d.chaine(e).replace(/age=\d+/, `age=${age + 1}`);
      for (let k = 0; k < 15; k++) sim.particule('happy_villager', X + this.h.reel(), Y - i + this.h.reel(), Z + this.h.reel(), 0, 0, 0, 1);   // evenement 2011 (15 etincelles)
      sim.poser(X, Y - i, Z, nouv, 3);
      this.cultures++; this.stat('culturesPoussees'); journal(sim, `${a.nom} fait pousser ${n} (${age} -> ${age + 1})`);
    }
  },

  // ---- danse au juke-box ----------------------------------------------------------------------------------------------------------
  // perroquet (LevelRenderer.playJukeboxSong : les entites a 3 blocs de la boite du juke-box quand le disque commence ; Parrot.aiStep : fin a
  // plus de 3,46 blocs ou sans juke-box) ; allay (JUKEBOX_PLAY toutes les 20 ticks, rayon 10 ; fin quand il est loin, toutes les 20 ticks)
  tickDanse() {
    const a = this.a, sim = this.sim, J = sim.jukeboxes;
    const dansBoite = (p) => { const b = a.boite(); return b[3] > p[0] - 3 && b[0] < p[0] + 4 && b[4] > p[1] - 3 && b[1] < p[1] + 4 && b[5] > p[2] - 3 && b[2] < p[2] + 4; };
    const centre = (p) => Math.hypot(a.x - p[0] - 0.5, a.y - p[1] - 0.5, a.z - p[2] - 0.5);
    const estJuke = (p) => { const e = sim.monde.etatEn(p[0], p[1], p[2]); return e >= 0 && sim.d.nomBloc(e) === 'jukebox'; };
    const avant = !!this.danse;
    if (this.type === 'parrot') {
      // le disque vient de commencer (ce tick, ou au tick d'avant si le joueur a agi apres le perroquet dans le meme tick)
      for (const j of J.values()) { const k = `${j.pos}|${j.debut}`; if (sim.temps - j.debut <= 1 && !(this.debutsVus ??= new Set()).has(k)) { this.debutsVus.add(k); if (dansBoite(j.pos)) this.danse = j.pos; } }
      if (this.danse && !J.has(this.danse.join()) && dansBoite(this.danse)) this.danse = null;   // notifyNearbySongStopped
      if (this.danse && (centre(this.danse) >= 3.46 || !estJuke(this.danse))) this.danse = null;
    } else {
      for (const j of J.values()) if ((sim.temps - j.debut) % 20 === 0 && !this.danse && centre(j.pos) <= 10) this.danse = j.pos;
      if (this.danse && !J.has(this.danse.join())) this.danse = null;   // JUKEBOX_STOP_PLAY
      if (this.danse && sim.temps % 20 === 0 && (centre(this.danse) > 10 || !estJuke(this.danse))) this.danse = null;
    }
    if (!avant && this.danse) { this.stat('danses'); journal(sim, `${a.nom} danse`); }
  },
  // Parrot.imitateNearbyMobs : 1 chance sur 400 par tick, un mob imitable a 20 blocs (au hasard), son entity.parrot.imitate.<type> (0,7)
  imiter() {
    const sim = this.sim, a = this.a;
    if (sim.hasard.entierBorne(400) !== 0) return;
    const l = this.autres().filter((o) => IMITES.has(this.typeDe(o)) && Math.abs(o.x - a.x) <= 20 + o.L / 2 && Math.abs(o.y - a.y) <= 20 + o.H && Math.abs(o.z - a.z) <= 20 + o.L / 2);
    if (!l.length) return;
    const o = l[sim.hasard.entierBorne(l.length)];
    sim.son(`entity.parrot.imitate.${this.typeDe(o)}`, a.x, a.y, a.z, 0.7, (sim.hasard.flottant() - sim.hasard.flottant()) * 0.2 + 1);
    this.stat('imitations'); journal(sim, `${a.nom} imite ${o.nom} (${this.typeDe(o)})`);
  },
  // Allay.mobInteract : un eclat d'amethyste pendant la danse duplique l'allay (6000 ticks d'attente), coeurs, son du bloc d'amethyste
  dupliquer(joueur) {
    const a = this.a, sim = this.sim;
    if (!this.danse || (this.cdDuplication ?? 0) > 0) return this.danse ? 'pas encore (attente de duplication)' : 'il ne danse pas : rien';
    const b = sim.acteurs.naitre({ type: 'allay', x: a.x, y: a.y, z: a.z, lacet: a.lacet, modele: a.nom, raison: 'duplication', gabaritParent: { l: a.L, h: a.H, oeil: a.O, vitesse: a.kVit } });
    if (!b) return 'plafond des entites';
    this.cdDuplication = 6000; b.ia.cdDuplication = 6000;
    this.particulesAutour('heart', 7);
    sim.son('block.amethyst_block.chime', a.x, a.y, a.z, 2, 1);
    journal(sim, `${a.nom} se duplique : ${b.nom}`); void joueur;
    return `duplique : ${b.nom}`;
  },

  // ---- conversions ------------------------------------------------------------------------------------------------------------------
  // remplace cette creature par une autre (Mob.convertTo : meme place, meme direction, meme age ; l'ancienne disparait sans mourir)
  convertir(type, { variante = this.variante, son = null, raison = 'conversion', ia = {}, objet = null } = {}) {
    const a = this.a, sim = this.sim;
    if (!sim.acteurs.peutNaitre()) { sim.avertir(`conversion de ${a.nom} en ${type} impossible : plafond des entites`); return null; }
    const b = sim.acteurs.naitre({ type, variante, bebe: this.bebe, x: a.x, y: a.y, z: a.z, lacet: a.lacet, modele: a.nom, raison, nom: `${a.nom}_${type}`, objet, ia: { age: this.age, ...ia } });
    if (!b) return null;
    a.mort = 21; a.mortSansCorps = true; a.vie = 0;
    if (son) sim.son(son, a.x, a.y, a.z, 1, 1);
    this.stat('conversions'); journal(sim, `${a.nom} devient ${type} (${b.nom})`);
    return b;
  },
  // Zombie.killedEntity : un villageois tue par un zombie devient zombie villageois (normal : 1 chance sur 2 ; difficile : toujours)
  convertirMort(source) {
    if (this.type !== 'villager' || !ZOMBIES.test(String(source))) return false;
    const dif = this.difficulte();
    if (dif < 2 || (dif !== 3 && this.h.booleen())) return false;
    return !!this.convertir('zombie_villager', { son: 'entity.zombie.infect', raison: 'infection' });
  },
  // ServerLevel.onReputationEvent(VILLAGER_KILLED) : les villageois a 16 blocs qui le voient : ragot major_negative +25 sur le tueur
  surMort(source) {
    const tueur = /^joueur:(.+)$/.exec(String(source))?.[1];
    if (this.type !== 'villager' || !tueur) return;
    for (const v of this.autres()) if (v.ia?.type === 'villager' && this.dist2(v) <= 256 && v.ia.voit(this.a)) v.ia.ragot(tueur, 'major_negative', 25);
  },
  // Zombie.tick : les yeux dans l'eau 600 ticks -> conversion de 300 ticks (il tremble) -> noye (le husk : zombie)
  tickNoyade() {
    const a = this.a;
    if (this.conversionEau !== undefined) {
      if (--this.conversionEau < 0) { const husk = this.type === 'husk'; this.convertir(husk ? 'zombie' : 'drowned', { variante: null, son: husk ? 'entity.husk.converted_to_zombie' : 'entity.zombie.converted_to_drowned', raison: 'noyade' }); }
      return;
    }
    if (a.teteEau) { this.tempsEau = (this.tempsEau ?? 0) + 1; if (this.tempsEau >= 600) { this.conversionEau = 300; journal(this.sim, `${a.nom} commence a se noyer (300 ticks)`); } } else this.tempsEau = -1;
  },
  // Entity.thunderHit des especes : rend vrai si la foudre ne fait pas de degats (conversion, changement de couleur)
  foudroye(eclair) {
    const t = this.type, dif = this.difficulte();
    if (t === 'villager' && dif > 0) return !!this.convertir('witch', { variante: null, raison: 'foudre' });
    if (t === 'pig' && dif > 0) return !!this.convertir('zombified_piglin', { variante: null, raison: 'foudre', objet: 'golden_sword' });
    if (t === 'creeper' && !this.charge) { this.charge = true; this.changer({ charge: true }); journal(this.sim, `${this.a.nom} est charge par la foudre`); return false; }
    if (t === 'mooshroom') {
      const v = lireVariante('mooshroom', this.variante).choix?.[0] === 'brown' ? 'red' : 'brown';
      this.variante = v; this.changer({ variante: v }); this.sim.son('entity.mooshroom.convert', this.a.x, this.a.y, this.a.z, 2, 1);
      journal(this.sim, `${this.a.nom} devient ${v} (foudre)`); void eclair;
      return true;
    }
    return false;
  },
  // ZombieVillager.mobInteract : pomme doree sur un zombie villageois sous Faiblesse -> 3600 a 6000 ticks de conversion (force, son de guerison)
  commencerSoin(joueur) {
    const a = this.a, sim = this.sim;
    if (!a.niveauEffet('weakness')) return 'il faut d abord la Faiblesse (potion jetee) : rien';
    if (this.conversionSoin !== undefined) return 'deja en guerison';
    this.conversionSoin = this.h.entierBorne(2401) + 3600; this.soigneur = joueur?.nom ?? null;
    a.effets.delete('weakness'); a.appliquerEffet('strength', this.conversionSoin, Math.min(this.difficulte() - 1, 0));
    sim.son('entity.zombie_villager.cure', a.x, a.y + a.O, a.z, 1 + this.h.flottant(), this.h.flottant() * 0.7 + 0.3);
    journal(sim, `${a.nom} commence a guerir (${this.conversionSoin} ticks)`); void joueur;
    return `guerison en ${this.conversionSoin} ticks`;
  },
  // ZombieVillager.getConversionProgress : 1 par tick ; 1 fois sur 100, chaque barreau de fer ou lit dans le cube de +-4 (14 au plus) ajoute 1
  // avec la chance 0,3
  vitesseSoin() {
    let i = 1;
    if (this.h.flottant() < 0.01) {
      const a = this.a, sim = this.sim, X = Math.trunc(a.x), Y = Math.trunc(a.y), Z = Math.trunc(a.z); let j = 0;   // (int) getX() : vers zero (Horizon zombie_villager.rs)
      for (let x = X - 4; x < X + 4 && j < 14; x++) for (let y = Y - 4; y < Y + 4 && j < 14; y++) for (let z = Z - 4; z < Z + 4 && j < 14; z++) {
        const e = sim.monde.etatEn(x, y, z); if (e < 0) continue; const n = sim.d.nomBloc(e);
        if (n === 'iron_bars' || n.endsWith('_bed')) { if (this.h.flottant() < 0.3) i++; j++; }
      }
    }
    return i;
  },
  tickSoin() {
    this.conversionSoin -= this.vitesseSoin() - 1;
    if (--this.conversionSoin > 0) return;
    delete this.conversionSoin;
    const b = this.convertir('villager', { son: 'entity.zombie_villager.converted', raison: 'guerison' });
    if (b) { b.appliquerEffet('nausea', 200, 0); if (this.soigneur) { b.ia.ragot(this.soigneur, 'major_positive', 20); b.ia.ragot(this.soigneur, 'minor_positive', 25); } }   // ZOMBIE_VILLAGER_CURED
  },

  // ---- villageois : nourriture, golem (le reste : ia-villageois.js) ---------------------------------------------------------------------
  mangerEtDigerer() {   // Villager.eatAndDigestFood : mange jusqu'a 12 points, puis en digere 12
    if (this.faim < 12) for (const [k, v] of [...this.a.sac]) { const p = POINTS_VILLAGEOIS[k]; if (!p) continue; for (let j = v; j > 0; j--) { this.faim += p; if (j - 1 > 0) this.a.sac.set(k, j - 1); else this.a.sac.delete(k); if (this.faim >= 12) break; } if (this.faim >= 12) break; }
    this.faim -= 12;
  },
  tickVillageoisVie() {
    const sim = this.sim;
    if (this.sommeil && !this.dormaitAvant) this.dernierSommeil = sim.temps;   // SleepInBed : LAST_SLEPT
    if (sim.temps - (this.dernierDeclin ?? 0) >= 24000) { this.dernierDeclin = sim.temps; if (sim.temps > 0) this.declinRagots(); }   // maybeDecayGossip
    this.dormaitAvant = !!this.sommeil;
    this.ramasserObjets();   // Mob.aiStep : ramasse les objets voulus a portee (ia-villageois.js)
    // VillagerPanicTrigger : en panique, toutes les 100 ticks, un golem si 3 villageois le veulent
    if ((this.actifs.has(this.but('panique')) || this.actifs.has(this.but('evite'))) && sim.temps % 100 === 0) this.golemSiBesoin(3);
  },
  // Villager.gossip -> spawnGolemIfNeeded(5) ; wantsToSpawnGolem : a dormi depuis moins de 24000 ticks, pas de golem vu (16 blocs, 600 ticks)
  veutGolem() {
    const sim = this.sim;
    if (this.dernierSommeil === undefined || sim.temps - this.dernierSommeil >= 24000 || (this.golemVu ?? -1) > sim.temps) return false;
    if (this.autres().some((o) => this.typeDe(o) === 'iron_golem' && this.dist2(o) <= 256)) { this.golemVu = sim.temps + 600; return false; }
    return true;
  },
  golemSiBesoin(min) {
    const sim = this.sim, a = this.a;
    if (!sim.regles.valeur('ia.golems', true) || !this.veutGolem()) return null;
    const groupe = [a, ...this.autres().filter((o) => o.ia?.type === 'villager' && Math.abs(o.x - a.x) <= 10.6 && Math.abs(o.y - a.y) <= 10 + a.H && Math.abs(o.z - a.z) <= 10.6)].filter((v) => v.ia.veutGolem());
    if (groupe.length < min) return null;
    // SpawnUtil.trySpawnMob(IRON_GOLEM, 10 essais, 8 de cote, 6 de haut, LEGACY_IRON_GOLEM)
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(a.x) + this.h.entierBorne(17) - 8, z = Math.floor(a.z) + this.h.entierBorne(17) - 8;
      for (let y = Math.floor(a.y) + 6; y >= Math.floor(a.y) - 6; y--) {
        const sous = sim.monde.etatEn(x, y - 1, z);
        if (sous < 0 || !coupe(a.lec, [x + 0.1, y - 0.1, z + 0.1, x + 0.9, y - 0.01, z + 0.9]) || /glass|leaves|cobweb|cactus/.test(sim.d.nomBloc(sous))) continue;
        if (coupe(a.lec, [x + 0.5 - 0.7, y + 0.01, z + 0.5 - 0.7, x + 0.5 + 0.7, y + 2.7, z + 0.5 + 0.7])) continue;
        const g = sim.acteurs.naitre({ type: 'iron_golem', x: x + 0.5, y, z: z + 0.5, lacet: 0, modele: a.nom, raison: 'golem', nom: 'golem', gabaritParent: { l: 1.4, h: 2.7, oeil: 2.295, vitesse: a.kVit } });
        if (g) { for (const v of groupe) v.ia.golemVu = sim.temps + 600; this.stat('golems'); journal(sim, `les villageois appellent un golem de fer : ${g.nom} (${groupe.length} villageois)`); }
        return g;
      }
    }
    return null;
  },
  // ---- reputation (GossipContainer) : ragots par joueur et par type ; reputation = somme poids x valeur ; prix des echanges
  // -floor(reputation x multiplicateur de l'offre (0,05 en general))
  ragot(joueur, type, n) {
    if (!joueur) return;
    const R = RAGOTS[type], g = ((this.ragots ??= new Map()).get(joueur) ?? {});
    g[type] = Math.min(R.max, (g[type] ?? 0) + n); this.ragots.set(joueur, g);
    this.stat('ragotsAjoutes'); journal(this.sim, `${this.a.nom} : ragot ${type} +${n} sur ${joueur} (reputation ${this.reputation(joueur)})`);
  },
  reputation(joueur) { const g = this.ragots?.get(joueur); if (!g) return 0; let r = 0; for (const [t, v] of Object.entries(g)) r += RAGOTS[t].poids * v; return r; },
  prixDiff(joueur, mult = 0.05) { return -Math.floor(this.reputation(joueur) * mult); },
  // GossipContainer.transferFrom : jusqu'a 10 ragots de l'autre (les plus lourds), moins le declin de transfert, au max des deux
  recevoirRagots(o) {
    const L = [];
    for (const [j, g] of o.ragots ?? []) for (const [t, v] of Object.entries(g)) L.push([j, t, v]);
    L.sort((p, q) => Math.abs(RAGOTS[q[1]].poids * q[2]) - Math.abs(RAGOTS[p[1]].poids * p[2]));
    for (const [j, t, v] of L.slice(0, 10)) { const w = v - RAGOTS[t].transfert; if (w <= 0) continue; const g = ((this.ragots ??= new Map()).get(j) ?? {}); g[t] = Math.max(g[t] ?? 0, w); this.ragots.set(j, g); }
  },
  // Villager.maybeDecayGossip : une fois par jour (24000 ticks), chaque ragot baisse de son declin quotidien
  declinRagots() {
    for (const [j, g] of this.ragots ?? []) { for (const t of Object.keys(g)) { g[t] -= RAGOTS[t].declin; if (g[t] <= 0) delete g[t]; } if (!Object.keys(g).length) this.ragots.delete(j); }
  },
  bavarder(o) {   // Villager.gossip : pas deux fois en 1200 ticks ; ragots echanges ; puis l'appel du golem (5)
    const t = this.sim.temps;
    if ((this.dernierRagot !== undefined && t < this.dernierRagot + 1200) || (o.ia.dernierRagot !== undefined && t < o.ia.dernierRagot + 1200)) return;
    this.dernierRagot = t; o.ia.dernierRagot = t;
    this.recevoirRagots(o.ia); o.ia.recevoirRagots(this);
    this.golemSiBesoin(5);
  },

  // ---- enderman : prend et pose des blocs ----------------------------------------------------------------------------------------
  // EndermanTakeBlockGoal : sans bloc, 1 chance sur 10 par tick ; un point a +-2 blocs (0 a 3 de haut), visible depuis le centre de sa case
  peut_endermanPrend() { return !this.porteEtat && this.sim.regles.valeur('ia.endermanBlocs', true) && this.h.entierBorne(10) === 0; },
  continue_endermanPrend() { return false; },
  debut_endermanPrend() {
    const a = this.a, sim = this.sim, h = this.h;
    const x = Math.floor(a.x - 2 + h.reel() * 4), y = Math.floor(a.y + h.reel() * 3), z = Math.floor(a.z - 2 + h.reel() * 4);
    const e = sim.monde.etatEn(x, y, z);
    if (e < 0 || !PORTABLES.has(sim.d.nomBloc(e))) return;
    const de = [Math.floor(a.x) + 0.5, y + 0.5, Math.floor(a.z) + 0.5];
    const t = rayonBloc(a.lec, de, [x + 0.5, y + 0.5, z + 0.5]);
    if (t && (t[0] !== x || t[1] !== y || t[2] !== z)) return;
    const nom = sim.d.nomBloc(e);
    this.porteEtat = 'minecraft:' + nom;
    sim.poser(x, y, z, 'minecraft:air', 3);
    a.main = { objet: nom, efficacite: 0 };
    this.stat('blocsPris'); journal(sim, `${a.nom} prend ${nom} en ${x},${y},${z}`);
  },
  tick_endermanPrend() {},
  // EndermanLeaveBlockGoal : avec un bloc, 1 chance sur 1000 par tick ; un point a +-1 (0 a 2 de haut) : de l'air au-dessus d'un bloc plein
  peut_endermanPose() { return !!this.porteEtat && this.sim.regles.valeur('ia.endermanBlocs', true) && this.h.entierBorne(1000) === 0; },
  continue_endermanPose() { return false; },
  debut_endermanPose() {
    const a = this.a, sim = this.sim, h = this.h;
    const x = Math.floor(a.x - 1 + h.reel() * 2), y = Math.floor(a.y + h.reel() * 2), z = Math.floor(a.z - 1 + h.reel() * 2);
    const e = sim.monde.etatEn(x, y, z), s = sim.monde.etatEn(x, y - 1, z);
    if (e < 0 || s < 0 || !/^(air|cave_air)$/.test(sim.d.nomBloc(e)) || sim.d.nomBloc(s) === 'bedrock') return;
    if (!coupe(a.lec, [x + 0.01, y - 0.99, z + 0.01, x + 0.99, y - 0.01, z + 0.99]) || !sim.api.survitEtat(x, y, z, this.porteEtat)) return;
    if (sim.acteurs.liste.some((o) => o.mort < 0 && o !== a && (() => { const b = o.boite(); return b[3] > x && b[0] < x + 1 && b[4] > y && b[1] < y + 1 && b[5] > z && b[2] < z + 1; })())) return;
    sim.poser(x, y, z, sim.api.formeDepuisVoisins(x, y, z, this.porteEtat) ?? this.porteEtat, 3);
    journal(sim, `${a.nom} pose ${this.porteEtat.replace('minecraft:', '')} en ${x},${y},${z}`);
    this.porteEtat = null; a.main = { objet: null, efficacite: 0 }; this.stat('blocsPoses');
  },
  tick_endermanPose() {},

  drapeauxVie() {
    let d = 0;
    if (this.danse) d |= D.DANSE;
    if (this.amour > 0) d |= D.AMOUR;
    if (this.nectar) d |= D.NECTAR;
    if (this.dansRuche) d |= D.RUCHE;
    if (this.conversionEau !== undefined || this.conversionSoin !== undefined) d |= D.CONVERSION;
    return d;
  },
};

function estRucheBloc(sim, p) { const e = sim.monde.etatEn(p[0], p[1], p[2]); return e >= 0 && /^(beehive|bee_nest)$/.test(sim.d.nomBloc(e)); }
// BlockPos.withinBoxByManhattanDistance : les plus proches d'abord (distance de Manhattan), puis x, y, +z avant -z
export function manhattan(o, rx, ry, rz) {
  const out = [];
  for (let p = 0; p <= rx + ry + rz; p++) {
    const mx = Math.min(rx, p);
    for (let x = -mx; x <= mx; x++) {
      const my = Math.min(ry, p - Math.abs(x));
      for (let y = -my; y <= my; y++) {
        const z = p - Math.abs(x) - Math.abs(y);
        if (z <= rz) { out.push([o[0] + x, o[1] + y, o[2] + z]); if (z !== 0) out.push([o[0] + x, o[1] + y, o[2] - z]); }
      }
    }
  }
  return out;
}
void TEINTURES;
