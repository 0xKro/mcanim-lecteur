// Objets en main, utilises par les acteurs simules (phase 7) : manger, boire, lancer, tirer (arc, arbalete), jeter, prendre et deposer dans un conteneur.
// Ce sont des METHODES de `Acteur` (moteur/acteurs.js) ajoutees ici pour garder le fichier des acteurs lisible ; chaque verbe de film/actes.js a son couple
// `debut_<verbe>` / `tick_<verbe>` comme les verbes d'avant. Port de LivingEntity.startUsingItem / updateUsingItem / completeUsingItem, Consumable, FoodData,
// BowItem, CrossbowItem, Player.drop (Horizon client/game/{hand,potions,crossbow}.rs, world/food.rs : MIT, voir ATTRIBUTIONS.md).
//   manger : 32 ticks (1,6 s ; varech sec 16, miel 40) ; des le 9e tick et tous les 4 ticks : son `entity.generic.eat` et 5 miettes ; a la fin : faim + saturation
//   boire  : meme duree, son `entity.generic.drink`, effet de la potion ; `{effet, niveau, duree}` choisissent l'effet (speed, slowness, jump_boost, invisibility, glowing...)
//   arc    : puissance (f x f + 2 f) / 3 avec f = ticks / 20, au plus 1 ; fleche a 3 x puissance ; sous 0,1 rien ne part
//   arbalete : 25 ticks de chargement, fleche critique a 3,15 ; lancer : boule de neige, oeuf, perle d'ender, potion jetee, trident
import { LANCABLES, VITESSE_LANCE, TANGAGE_LANCE, TYPES, puissanceArc, tangageBalistique } from './projectiles.js';
import { lireFusee, nouvelleFusee } from './fusees.js';
import { lirePile, idDe, textePile } from './pile.js';
import { effetsPotion } from './potions.js';
import { valeurAttribut } from './attributs.js';
import { typeDegats } from './enchantements.js';

const RAD = Math.PI / 180;
const f2 = (v) => String(Math.round(v * 100) / 100).replace('.', ',');   // nombre du journal (2 decimales, virgule)
// #minecraft:no_knockback (data/minecraft/tags/damage_type du jeu 26.3) : lu dans les fichiers du jeu quand ils sont la, sinon cette copie
const SANS_RECUL = new Set(['explosion', 'player_explosion', 'bad_respawn_point', 'in_fire', 'lightning_bolt', 'on_fire', 'lava', 'hot_floor', 'sulfur_cube_hot', 'in_wall', 'cramming', 'drown', 'starve', 'cactus', 'fall', 'ender_pearl', 'fly_into_wall', 'out_of_world', 'generic', 'magic', 'wither', 'dragon_breath', 'dry_out', 'sweet_berry_bush', 'freeze', 'stalagmite', 'outside_border', 'generic_kill', 'campfire', 'spear']);
const sansRecul = (sim, source) => (sim.objetsJeu ? sim.objetsJeu.etiquette('damage_type', 'no_knockback') : SANS_RECUL).has(typeDegats(source));

// Effets que le moteur sait appliquer. `ticks` : duree par defaut de la potion du jeu ; `vitesse` / `saut` : multiplicateurs ou ajouts du jeu
export const EFFETS = {
  speed: { ticks: 3600 }, slowness: { ticks: 1800 }, jump_boost: { ticks: 3600 }, invisibility: { ticks: 3600 }, glowing: { ticks: 200 },
  regeneration: { ticks: 900 }, poison: { ticks: 900 }, strength: { ticks: 3600 }, night_vision: { ticks: 3600 }, absorption: { ticks: 2400 },
  wither: { ticks: 200 }, darkness: { ticks: 260 }, mining_fatigue: { ticks: 6000 }, haste: { ticks: 3600 },
  dolphins_grace: { ticks: 100 },   // donnee par un dauphin qui nage avec le joueur (moteur/ia-eau.js) ; dans l'eau : ralentissement 0,96
};
// MobEffects.DIG_SLOWDOWN (fatigue) : vitesse de minage x 0,3 / 0,09 / 0,0027 / 0,00081 ; DIG_SPEED (celerite) : x (1 + 0,2 x niveau)
export const FATIGUE = [1, 0.3, 0.09, 0.0027, 0.00081];
export const BIT = { INVISIBLE: 1 << 21, LUEUR: 1 << 22 };

export function installerUtilisation(Acteur, EchecActe) {
  const P = Acteur.prototype;

  P.initUtilisation = function (d) {
    this.faim = d.faim ?? 20; this.satur = Math.min(5, this.faim); this.epuisement = 0;
    this.effets = new Map();                     // id -> { fin (tick), niveau }
    this.usage = null;                           // { type: 1 manger, 2 boire, 3 arc, 4 arbalete en charge, 5 arbalete chargee, ticks }
    this.sacLibre = d.sac === undefined;
    if (d.sac) for (const [k, v] of Object.entries(d.sac)) this.sac.set(k, v);
    this.minuteurRegen = 0;
  };

  // ---------------------------------------------------------------- effets de potion
  P.appliquerEffet = function (id, ticks, niveau = 0) {
    const sim = this.sim;
    if (!sim.regles.valeur('effets.actif', true)) return;
    const actuel = this.effets.get(id);
    const fin = sim.temps + ticks;
    if (!actuel || actuel.niveau < niveau || (actuel.niveau === niveau && actuel.fin < fin)) this.effets.set(id, { fin, niveau });
    if (id === 'darkness' && !this.typeCreature) sim.replay.obscurite.push({ debut: sim.temps, fin, acteur: this.nom });   // le film assombrit la vue (film/look.js)
    if (id === 'night_vision' && !this.typeCreature) (sim.replay.visionNuit ??= []).push({ debut: sim.temps, fin, acteur: this.nom });   // table de lumiere du film (film/lumiere-vue.js)
    if (actuel && actuel.fin > sim.temps && id === 'dolphins_grace') return;   // la grace rendue 1 fois sur 6 par tick : une seule ligne
    sim.dire(`${this.nom} : effet ${id} ${niveau + 1} pendant ${(ticks / 20).toFixed(0)} s`);
    sim.stats.effets = (sim.stats.effets || 0) + 1;
  };
  P.niveauEffet = function (id) { const e = this.effets.get(id); return e && e.fin > this.sim.temps ? e.niveau + 1 : 0; };
  // MobEffects.SPEED : +20 % par niveau ; SLOWNESS : -15 % par niveau (modificateurs multiplicatifs sur la vitesse de marche)
  P.facteurVitesse = function () {
    const v = this.niveauEffet('speed'), l = this.niveauEffet('slowness');
    return Math.max(0, (1 + 0.2 * v) * (1 - 0.15 * l)) * this.sim.regles.valeur('effets.vitesse', 1);
  };
  P.bonusSaut = function () { return 0.1 * this.niveauEffet('jump_boost'); };
  P.tickEffets = function () {
    const sim = this.sim;
    for (const [id, e] of this.effets) {
      if (e.fin <= sim.temps) { this.effets.delete(id); continue; }
      const restant = e.fin - sim.temps;
      // regeneration : 1 coeur toutes les 50 >> niveau ticks ; poison : 1 de degats toutes les 25 >> niveau ticks sans jamais tuer
      if (id === 'regeneration') { const k = 50 >> e.niveau; if (k > 0 && restant % k === 0 && this.vie < this.vieMax && this.mort < 0) this.vie = Math.min(this.vieMax, this.vie + 1); }
      if (id === 'poison') { const k = 25 >> e.niveau; if (k > 0 && restant % k === 0 && this.vie > 1 && this.mort < 0) this.degats(1, 'poison'); }
      // fletrissement (WitherMobEffect) : 1 de degats toutes les 40 >> niveau ticks, il peut tuer (le wither y est insensible)
      if (id === 'wither') { const k = 40 >> e.niveau; if (k > 0 && restant % k === 0 && this.mort < 0 && this.typeCreature !== 'wither') this.degats(1, 'fletrissement'); }
    }
    // FoodData.tick : la vie remonte seule (regle faim.regeneration, coupee par defaut)
    if (this.mort < 0 && this.vie < this.vieMax && sim.regles.valeur('faim.regeneration', false)) {
      if (this.epuisement > 4) { this.epuisement -= 4; if (this.satur > 0) this.satur = Math.max(this.satur - 1, 0); else this.faim = Math.max(this.faim - 1, 0); }
      if (this.satur > 0 && this.faim >= 20) { if (++this.minuteurRegen >= 10) { const f = Math.min(this.satur, 6); this.vie = Math.min(this.vieMax, this.vie + f / 6); this.epuisement += f; this.minuteurRegen = 0; } }
      else if (this.faim >= 18) { if (++this.minuteurRegen >= 80) { this.vie = Math.min(this.vieMax, this.vie + 1); this.epuisement += 6; this.minuteurRegen = 0; } }
      else this.minuteurRegen = 0;
    }
  };

  // ---------------------------------------------------------------- faim (FoodData.eat) : le niveau monte de la nutrition, la saturation de sa valeur, bornees
  P.manger = function (nutrition, saturation) {
    this.faim = Math.min(20, this.faim + nutrition);
    this.satur = Math.max(0, Math.min(this.faim, this.satur + saturation));
  };

  // ---------------------------------------------------------------- coups recus (knockback du jeu) : 0 degat = clignotement rouge et recul seulement
  // LivingEntity.hurtServer : dealDefaultKnockback (force 0,4F ; `force` des appelants, x regles combat.recul / projectiles.recul) seulement pour
  // un coup ENTIER (pas celui qui passe la fenetre d'invulnerabilite pour la difference) et un type de degats hors #minecraft:no_knockback ;
  // (dx, dz) : vers la source (sa position ; un projectile : -sa vitesse horizontale, calculateHorizontalHurtKnockbackDirection)
  P.frappe = function (q, source, dx, dz, force = Math.fround(0.4), { recul: cause = 'coup' } = {}) {
    const sim = this.sim;
    if (this.mort >= 0 || this.invulnerable || !sim.regles.valeur('vie.actif', true)) return false;
    this.dernierCoup = { source, dx, dz, t: sim.temps };   // d'ou vient le coup (dragon : la partie touchee, ia-boss.js partieTouchee)
    this.coupEntier = true;
    if (q > 0) { if (!this.degats(q, source)) return false; } else {
      if (this.invulTemps > 10) return false;
      this.invulTemps = 20; this.hurtTime = 10; this.derniereBlessure = 0;
      sim.son('entity.player.hurt', this.x, this.y, this.z, 1, 1 + (sim.hasard.flottant() - sim.hasard.flottant()) * 0.2);
    }
    if (force > 0 && this.coupEntier && !sansRecul(sim, source)) this.recul(force, dx, dz, cause);
    return true;
  };
  // LivingEntity.knockback(force, dx, dz) : force x (1 - knockback_resistance) (attribut : base du type, armure en netherite 0,1F par piece,
  // borne -2..1 : moteur/attributs.js) ; rien si elle n'est pas positive ; (dx, dz) pointe vers la source (tire au hasard de l'entite, 0,01 x
  // (r - r), tant que dx^2 + dz^2 < 1e-5F) ; vitesse horizontale / 2 - direction x force ; au sol vy = min(0,4 ; vy / 2 + force). Le journal
  // ecrit la force avant et apres la resistance.
  P.recul = function (force, dx, dz, cause = 'coup') {
    const sim = this.sim;
    if (this.ia?.reculBoss?.(force, dx, dz)) return;   // dragon (EnderDragon.knockback : rien assis, sa propre vitesse sinon)
    const kr = valeurAttribut(this, 'knockback_resistance'), f = force * (1 - kr);
    sim.dire(`recul ${this.nom} ${f2(force)} -> ${f2(f)} (${cause}, knockback_resistance ${f2(kr)})`);
    (sim.stats.reculs ??= []).push([sim.temps, this.nom, force, f, kr, cause]);
    if (!(f > 0)) return;
    while (dx * dx + dz * dz < Math.fround(1e-5)) {
      const h = this.ia?.h ?? (this._hRecul ??= sim.nouvelAleatoire ? sim.nouvelAleatoire(0x7ec0 + this.id * 7919) : sim.hasard);   // hasard de l'entite (pas celui du monde)
      dx = (h.reel() - h.reel()) * 0.01; dz = (h.reel() - h.reel()) * 0.01;
    }
    const L = Math.sqrt(dx * dx + dz * dz);
    this.vx = this.vx / 2 - (dx / L) * f; this.vz = this.vz / 2 - (dz / L) * f;
    if (this.auSol) { this.vy = Math.min(0.4, this.vy / 2 + f); this.auSol = false; }
  };

  // ---------------------------------------------------------------- aide : point vise (nombres, nom d'acteur ou rien)
  P.pointVise = function (cible, ticksVol = 0) {
    if (!cible) return null;
    if (cible.acteur) {
      const o = this.g.parNom.get(cible.acteur);
      if (!o) throw new EchecActe(`acteur inconnu "${cible.acteur}"`);
      // l'acteur bouge : on vise ou il sera quand le projectile arrive
      return [o.x + o.vx * ticksVol, o.y + 1.0, o.z + o.vz * ticksVol];
    }
    return [cible.x, cible.y, cible.z];
  };
  // Angles de la tete (lacet, tangage du jeu, -90..90) pour que le projectile (vitesse v, gravite g, trainee c, vol `ordre` : "jete" ou
  // "fleche") parti de `depart` sous les yeux atteigne `but` : le tir tendu (arc bas) ; `offset` : angle que le jeu ajoute au lancer (potion,
  // fiole : -20). Hors de portee : on vise droit sur le point (horsPortee). Droit en dessous ou au-dessus : le lacet de la tete ne change pas.
  P.viseBalistique = function (but, v, g, offset = 0, { ordre = 'fleche', c = 0.99, depart = 0.1 } = {}) {
    const [ex, ey, ez] = [this.x, this.oeil()[1] - depart, this.z];
    const dx = but[0] - ex, dz = but[2] - ez, dh = Math.hypot(dx, dz), dy = but[1] - ey;
    const min = -90 + offset, max = 90 + offset;         // le projectile part a tangage de la tete + offset
    let ang = tangageBalistique(dh, dy, v, g, c, { ordre, min, max });
    const horsPortee = ang === null;
    if (horsPortee) ang = Math.max(min, Math.min(max, -Math.atan2(dy, dh) / RAD));
    const tangage = Math.max(-90, Math.min(90, ang - offset));
    const lacet = dh > 1e-6 ? Math.atan2(-dx, dz) / RAD : this.lacetTete;
    return { lacet, tangage, horsPortee, dh };
  };
  // ecart (degres) entre le regard et les angles voulus
  P.ecartAngles = function (lacet, tangage) { return Math.hypot(((lacet - this.lacetTete) % 360 + 540) % 360 - 180, tangage - this.tangage); };

  // ---------------------------------------------------------------- utilise (sans bloc) : manger, boire, lancer devant soi
  P.debutObjet = function (T, a) {
    const sim = this.sim, R = sim.regles;
    if (a.objet !== undefined && a.objet !== null) this.main = { objet: a.objet, efficacite: 0 };
    const o = this.main.objet;
    if (!o) throw new EchecActe('rien en main : ajoute [t, "tient", "bread"] avant');
    T.objet = o;
    if (idDe(o) === 'fishing_rod') return this.debutPeche(T, a);   // canne a peche : lancer ou ramener (objets-actes.js)
    if (idDe(o) === 'trident' && lirePile(o).ench.riptide) { T.mode = 'trident'; T.k = 0; T.charge = Math.max(10, Math.round((a.opts.charge ?? 0.5) * 20)); this.usage = { type: 6, ticks: 0 }; return; }   // Impulsion : tendre 10 ticks au moins
    const al = sim.d.aliment(o);
    if (al) {
      if (al[0] > 0 && !al[2] && this.faim >= 20 && !R.valeur('faim.mangerPlein', true)) throw new EchecActe(`${o} : la faim est pleine (regle faim.mangerPlein)`);
      T.mode = 'mange'; T.k = 0; T.anim = al[4];
      const force = R.valeur('objets.mangerTicks', 0);
      T.dur = force > 0 ? force : al[3];
      T.al = al;
      this.usage = { type: al[4] === 'drink' ? 2 : 1, ticks: 0 };
      return;
    }
    if (LANCABLES[idDe(o)]) { T.mode = 'jet'; T.k = 0; return; }
    if (o === 'firework_rocket') {
      // FireworkRocketItem.use en vol plane : une fusee accrochee au joueur (propulsion), le bras balance ; sinon rien (le jeu ne fait rien)
      if (!this.planeur) throw new EchecActe('une fusee se lance sur un bloc (utilise x y z {"fusee": ...}), a l arbalete (tire {"objet": "crossbow", "fusee": ...}) ou en vol plane (elytres : propulsion) ; au sol, en l air sans planer : rien');
      let fusee; try { fusee = lireFusee(a.opts?.fusee); } catch (err) { throw new EchecActe(err.message); }
      nouvelleFusee(sim, this, [this.x, this.y, this.z], fusee, { attache: true });
      this.balancer();
      sim.stats.propulsions = (sim.stats.propulsions || 0) + 1;
      T.mode = 'fini'; return;
    }
    if (idDe(o) === 'bow' || idDe(o) === 'crossbow') { debutTir.call(this, T, { ...a, cible: null, opts: a.opts }); T.mode = 'tir'; return; }
    throw new EchecActe(`${o} : rien ne se passe en l'utilisant dans l'air (a manger, a boire ou a lancer, essaie utilise x y z sur un bloc)`);
  };
  P.tickObjet = function (T) {
    const sim = this.sim;
    if (T.mode === 'fini') { this.finirTache('ok', 'propulsion'); return; }
    if (T.mode === 'tir') return tickTir.call(this, T);
    if (T.mode === 'peche') return this.tickPeche(T);
    if (T.mode === 'trident') {   // TridentItem.releaseUsing apres `charge` ticks (10 au moins) : Impulsion (objets-actes.js)
      this.usage = { type: 6, ticks: ++T.k };
      if (T.k < T.charge) return;
      const r = this.impulsionTrident();
      this.usage = null;
      this.finirTache(r === true ? 'ok' : 'echec', r === true ? 'impulsion' : 'Impulsion : ni eau ni pluie');
      return;
    }
    if (T.mode === 'jet') {
      this.balancer();
      lancerObjet.call(this, T.objet, this.lacetTete, this.tangage, T.acte.opts);
      this.finirTache('ok', '');
      return;
    }
    // manger / boire : LivingEntity.updateUsingItem
    T.k++;
    this.usage = { type: T.anim === 'drink' ? 2 : 1, ticks: T.k };
    const reste = T.dur - (T.k - 1);                    // useItemRemaining avant le decompte du tick
    if (reste <= T.dur - 7 && reste % 4 === 0) {
      const h = sim.hasard, volume = 0.5 + 0.5 * h.entierBorne(2);
      sim.son(T.anim === 'drink' ? 'entity.generic.drink' : 'entity.generic.eat', this.x, this.oeil()[1], this.z, volume, (h.flottant() - h.flottant()) * 0.2 + 1);
      if (T.anim === 'eat') this.miettes(T.objet);
    }
    if (T.k >= T.dur) this.finirManger(T);
  };
  // 5 miettes devant la bouche (LivingEntity.spawnItemParticles) : vitesse aleatoire tournee par la tete
  P.miettes = function (objet) {
    const sim = this.sim, h = sim.hasard, rx = this.tangage * RAD, ry = this.lacetTete * RAD;
    for (let i = 0; i < 5; i++) {
      let v = [(h.flottant() - 0.5) * 0.1, h.reel() * 0.1 + 0.1, 0];
      // xRot(-pitch) puis yRot(-yaw) comme Vec3 du jeu (tangage > 0 : vers le bas)
      v = [v[0], v[1] * Math.cos(rx) - v[2] * Math.sin(rx), v[1] * Math.sin(rx) + v[2] * Math.cos(rx)];
      v = [v[0] * Math.cos(ry) + v[2] * Math.sin(ry), v[1], -v[0] * Math.sin(ry) + v[2] * Math.cos(ry)];
      let p = [(h.flottant() - 0.5) * 0.3, -h.flottant() * 0.6 - 0.3, 0.6];
      p = [p[0], p[1] * Math.cos(rx) - p[2] * Math.sin(rx), p[1] * Math.sin(rx) + p[2] * Math.cos(rx)];
      p = [p[0] * Math.cos(ry) + p[2] * Math.sin(ry), p[1], -p[0] * Math.sin(ry) + p[2] * Math.cos(ry)];
      const o = this.oeil();
      sim.particule('item|' + objet, o[0] + p[0], o[1] + p[1], o[2] + p[2], v[0], v[1] + 0.05, v[2], 1);
    }
  };
  P.finirManger = function (T) {
    const sim = this.sim, al = T.al, R = sim.regles;
    sim.son(T.anim === 'drink' ? 'entity.generic.drink' : 'entity.generic.eat', this.x, this.oeil()[1], this.z, 1, 1 + sim.hasard.gaussien() * 0.2);
    if (R.valeur('faim.actif', true)) this.manger(al[0], al[1]);
    if (T.anim === 'eat' && al[0] > 0) sim.son('entity.player.burp', this.x, this.y, this.z, 0.5, sim.hasard.flottant() * 0.1 + 0.9);
    // effets de l'objet (pomme en or...) ; potion : l'effet demande par la scene
    for (const [id, ticks, niveau] of al[6]) this.appliquerEffet(id, ticks, niveau);
    const o = T.acte.opts;
    if (idDe(T.objet) === 'potion') {
      const pot = lirePile(T.objet).potion;
      if (pot) for (const [id, t, n] of effetsPotion(pot)) this.appliquerEffet(id, t, n);   // contenu de la potion (Potions du jeu : potions.js)
      else if (o.effet || !pot) { const id = o.effet ?? 'speed'; this.appliquerEffet(id, Math.round((o.secondes ?? (EFFETS[id]?.ticks ?? 3600) / 20) * 20), (o.niveau ?? 1) - 1); }
    }
    // la piece mangee ou bue part du sac (survie) ; le reste (bol, fiole) y entre (Consumable.onConsume, use_remainder)
    if (!this.infini) { this.consommer(T.objet, 1); if (al[5]) { this.ajouter(al[5], 1); if (!this.main.objet) this.main = { objet: al[5], efficacite: 0 }; } }
    sim.stats.repas = (sim.stats.repas || 0) + 1;
    sim.dire(`${this.nom} a fini ${T.anim === 'drink' ? 'de boire' : 'de manger'} ${T.objet} apres ${T.k} ticks (faim ${this.faim}, saturation ${this.satur.toFixed(1)})`);
    sim.api.evenement('acteur.mange', { acteur: this.nom, objet: T.objet, nutrition: al[0], faim: this.faim });
    this.usage = null;
    this.finirTache('ok', `${T.k} ticks`);
  };

  // ---------------------------------------------------------------- lance : boule de neige, oeuf, perle, potion, trident vers un point ou un acteur
  P.debut_lance = function (T, a) {
    const sim = this.sim;
    if (a.opts.objet) this.main = { objet: a.opts.objet, efficacite: 0 };
    const o = this.main.objet;
    if (!o || !LANCABLES[idDe(o)]) throw new EchecActe(`${o ?? 'main vide'} ne se lance pas (lancables : ${Object.keys(LANCABLES).join(', ')}) ; [t, "tient", "snowball"] ou {"objet": "snowball"}`);
    T.objet = o; T.type = LANCABLES[idDe(o)]; T.max = a.opts.max ? Math.floor(a.opts.max * 20 * sim.replay.ralenti) : 0;
    T.vise = 0; T.etat = 'vise';
    void a;
  };
  P.tick_lance = function (T) {
    const sim = this.sim, a = T.acte, R = sim.regles;
    if (T.etat === 'vise') {
      const v = (VITESSE_LANCE[T.type] ?? 1.5) * R.valeur('projectiles.vitesse', 1), g = TYPES[T.type].g * R.valeur('projectiles.gravite', 1);
      let tvol = 0, vise = null;
      if (a.cible || a.opts.tangage !== undefined) {
        if (a.cible) {
          // le jeu lance dans le regard (tous les angles, droit en bas compris) : on cherche le regard qui envoie l'objet sur le point
          const jete = !!TYPES[T.type].jete, opt = { ordre: jete ? 'jete' : 'fleche', c: TYPES[T.type].vent ? 1 : 0.99, depart: T.type === 'vent' ? 0 : 0.1 };
          for (let i = 0; i < 3; i++) {                 // une estimation du temps de vol corrige la position future de la cible
            const but = this.pointVise(a.cible, a.opts.predit === false ? 0 : tvol);
            vise = this.viseBalistique(but, v, g, TANGAGE_LANCE[T.type] ?? 0, opt);
            tvol = Math.max(1, vise.dh / (v * 0.92));
          }
        } else vise = { lacet: a.opts.lacet ?? this.lacetTete, tangage: a.opts.tangage, horsPortee: false };   // angles donnes : {tangage: 90} = droit en bas
        this.regardTache = { fixe: [vise.lacet, vise.tangage] };
        T.horsPortee = vise.horsPortee;
        T.vise = (T.vise ?? 0) + 1;
        if (this.ecartAngles(vise.lacet, vise.tangage) > 0.02 && T.vise < 24) return;   // la tete arrive sur les angles (a 0,02 degre ; au plus 24 ticks)
      } else if (T.vise++ < 2) return;
      this.balancer();
      lancerObjet.call(this, T.objet, this.lacetTete, this.tangage, a.opts);
      if (T.horsPortee) sim.dire(`${this.nom} : cible hors de portee du tir`);
      T.etat = 'apres'; T.attente = 4;
      return;
    }
    if (--T.attente <= 0) { this.regardTache = null; this.finirTache('ok', ''); }
  };

  // ---------------------------------------------------------------- tire : arc ou arbalete
  P.debut_tire = function (T, a) { debutTir.call(this, T, a); };
  P.tick_tire = function (T) { tickTir.call(this, T); };

  // ---------------------------------------------------------------- jette : Player.drop (vitesse 0,3 dans la direction du regard + 0,1 de haut)
  P.debut_jette = function (T, a) {
    const sim = this.sim, o = a.opts.objet ?? this.main.objet;
    if (!o) throw new EchecActe('rien a jeter : ajoute [t, "tient", "stone"] ou {"objet": "stone"}');
    let n = a.n ?? 1;
    if (!this.sacLibre || this.sac.has(o)) {
      const dispo = this.sac.get(o) || 0;
      if (dispo < n) { if (!this.sacLibre) throw new EchecActe(`${this.nom} n'a que ${dispo} ${o} (sac)`); } else this.sac.set(o, dispo - n);
    }
    const h = sim.hasard, lac = this.lacetTete * RAD, tang = this.tangage * RAD;
    const f = 0.3;
    let vx = -Math.sin(lac) * Math.cos(tang) * f, vz = Math.cos(lac) * Math.cos(tang) * f, vy = -Math.sin(tang) * f + 0.1;
    const f1 = h.flottant() * 2 * Math.PI, f2 = h.flottant() * 0.02;
    vx += Math.cos(f1) * f2; vy += (h.flottant() - h.flottant()) * 0.1; vz += Math.sin(f1) * f2;
    const e = this.sim.entites.objet(String(o).replace(/^minecraft:/, ''), n, this.x, this.oeil()[1] - 0.3, this.z, { vx, vy, vz, delai: sim.regles.valeur('objets.delaiJet', 40) });
    this.balancer();
    sim.dire(`${this.nom} jette ${n} ${o}`);
    sim.stats.jetes = (sim.stats.jetes || 0) + n;
    void e;
    T.fin = sim.temps + 3;
  };
  P.tick_jette = function (T) { if (this.sim.temps >= T.fin) this.finirTache('ok', ''); };

  // ---------------------------------------------------------------- prend / depose : transferts avec un conteneur (coffre, tonneau, entonnoir, dropper, four)
  P.debut_prend = function (T, a) { debutTransfert.call(this, T, a, 'prend'); };
  P.debut_depose = function (T, a) { debutTransfert.call(this, T, a, 'depose'); };
  P.tick_prend = function (T) { tickTransfert.call(this, T); };
  P.tick_depose = function (T) { tickTransfert.call(this, T); };

  // ================================================================ details
  // Lance l'objet (boule, oeuf, perle, potion, trident) dans la direction (lacet, tangage)
  function lancerObjet(objet, lacet, tangage, opts = {}) {
    const sim = this.sim, type = LANCABLES[idDe(objet)];
    // WindChargeItem.use : 10 ticks de recharge (ItemCooldowns) ; pendant la recharge, rien ne part
    if (type === 'vent') { if (sim.temps < (this.rechargeVent ?? -1)) { sim.dire(`${this.nom} : charge de vent en recharge`); return; } this.rechargeVent = sim.temps + 10; }
    let effet = null, effets = null;
    const pot = type === 'potion' ? lirePile(objet).potion : null;
    if (pot) effets = effetsPotion(pot);   // potion du jeu (splash_potion[potion=strong_harming]) : ses effets ; persistante : nuage (projectiles.js)
    else if (type === 'potion') { const id = opts.effet ?? 'speed'; effet = { id, ticks: Math.round((opts.secondes ?? (EFFETS[id]?.ticks ?? 1800) / 20 / 2) * 20), niveau: (opts.niveau ?? 1) - 1 }; }
    sim.entites.proj.lancer(this, type, lacet, tangage, { objet: idDe(objet), pile: objet, effet, effets, persistante: idDe(objet) === 'lingering_potion' });
    this.consommer(objet, 1);   // survie : la piece lancee quitte le sac (le trident y revient quand on le ramasse)
    if (type === 'trident') { const e = sim.entites.liste[sim.entites.liste.length - 1]; if (e?.type === 'trident') e.pile = this.useSansCasser(objet, 1); }   // TridentItem.releaseUsing : hurtWithoutBreaking(1), la copie lancee garde enchantements et usure
    const h = sim.hasard;
    const sons = { boule: 'entity.snowball.throw', oeuf: 'entity.egg.throw', perle: 'entity.ender_pearl.throw', potion: 'entity.splash_potion.throw', trident: 'item.trident.throw', vent: 'entity.wind_charge.throw', fiole: 'entity.experience_bottle.throw' };
    sim.son(sons[type], this.x, this.oeil()[1], this.z, type === 'trident' ? 1 : 0.5, 0.4 / (h.flottant() * 0.4 + 0.8));
    sim.stats.lances = (sim.stats.lances || 0) + 1;
  }

  function debutTir(T, a) {
    const sim = this.sim, R = sim.regles;
    if (a.opts.objet) this.main = { objet: a.opts.objet, efficacite: 0 };
    const o = this.main.objet;
    if (idDe(o) !== 'bow' && idDe(o) !== 'crossbow') throw new EchecActe(`${o ?? 'main vide'} ne tire pas : [t, "tient", "bow"] ou {"objet": "bow"} (arc ou arbalete)`);
    T.objet = o; T.arbalete = idDe(o) === 'crossbow'; T.k = 0; T.etat = 'tend';
    // munition (Player.getProjectile : la premiere fleche du sac, ou {fleche}) ; survie sans fleche : rien (creatif, main infinie : une fleche)
    T.munition = T.acte.opts.fusee !== undefined ? null : this.munition(a.opts.fleche);
    if (T.acte.opts.fusee === undefined && !T.munition) throw new EchecActe(`${this.nom} n'a pas de fleches (sac) : arrow, tipped_arrow[potion=...], spectral_arrow`);
    const charge = a.opts.charge ?? 1.0;
    // CrossbowItem.getChargeDuration : crossbow_charge_time (1,25 s ; Charge rapide : -0,25 s par niveau)
    const tempsArbalete = sim.objetsJeu && lirePile(o).ench.quick_charge ? Math.floor(sim.enchant.valeurPile(o, 'crossbow_charge_time', { outil: 'crossbow' }, 1.25) * 20) : R.valeur('arcs.arbaleteCharge', 25);
    T.ticksCharge = T.arbalete ? Math.max(0, tempsArbalete) : Math.max(1, Math.floor(charge * 20 + 1e-9));
    T.puissance = T.arbalete ? 1 : puissanceArc(T.ticksCharge);
    T.vitesse = T.arbalete ? R.valeur('arcs.arbaleteVitesse', 3.15) : 3.0 * T.puissance * R.valeur('projectiles.vitesse', 1);
    T.vitesse0 = T.arbalete ? R.valeur('arcs.arbaleteVitesse', 3.15) : 3.0 * T.puissance;
    T.cible = a.cible ?? null;
    T.angles = a.opts?.tangage !== undefined ? [a.opts.lacet, a.opts.tangage] : null;   // {lacet, tangage} : tirer dans ce regard (90 : droit en bas)
    // arbalete chargee d'une fusee d'artifice (CrossbowItem : fusee de biais a 1,6, 0,15 sous les yeux)
    T.fusee = T.arbalete && a.opts.fusee !== undefined ? (() => { try { return lireFusee(a.opts.fusee); } catch (err) { throw new EchecActe(err.message); } })() : null;
    if (T.fusee) { T.vitesse = 1.6; T.vitesse0 = 1.6; }
    T.max = a.opts.max ? Math.floor(a.opts.max * 20 * sim.replay.ralenti) : 0;
    this.usage = { type: T.arbalete ? 4 : 3, ticks: 0 };
    if (T.arbalete) sim.son('item.crossbow.loading_start', this.x, this.oeil()[1], this.z, 1, 1);
  }
  function tickTir(T) {
    const sim = this.sim, R = sim.regles, g = TYPES.fleche.g * R.valeur('projectiles.gravite', 1);
    // tout au long de la tension la tete suit la cible, avec l'angle balistique de la puissance finale
    // (ou les angles donnes {lacet, tangage} : tout le regard du jeu, -90 droit en haut a 90 droit en bas)
    if ((T.cible || T.angles) && T.etat !== 'apres') {
      const v = T.vitesse;
      let tvol = 0, vise = null;
      if (T.cible) {
        // fusee d'arbalete : vol droit (sans gravite ni trainee : moteur/fusees.js) ; fleche : AbstractArrow ; la fleche part 0,1 sous les yeux, la fusee 0,15
        const opt = T.fusee ? { ordre: 'fleche', c: 1, depart: 0.15 } : { ordre: 'fleche', c: 0.99, depart: 0.1 };
        for (let i = 0; i < 3; i++) { const but = this.pointVise(T.cible, T.acte.opts.predit === false ? 0 : tvol); vise = this.viseBalistique(but, v, T.fusee ? 0 : g, 0, opt); tvol = Math.max(1, vise.dh / (v * 0.9)); }
      } else vise = { lacet: T.angles[0] ?? this.lacetTete, tangage: T.angles[1], horsPortee: false };
      this.regardTache = { fixe: [vise.lacet, vise.tangage] };
      T.viseAngles = [vise.lacet, vise.tangage];
      T.horsPortee = vise.horsPortee;
    }
    if (T.etat === 'tend') {
      T.k++;
      this.usage = { type: T.arbalete ? 4 : 3, ticks: T.k };
      if (T.arbalete && T.k === Math.floor(T.ticksCharge / 2)) sim.son('item.crossbow.loading_middle', this.x, this.oeil()[1], this.z, 1, 1);
      if (T.k < T.ticksCharge) return;
      // la tete doit etre sur la cible au moment du tir (au plus 6 ticks d'attente supplementaires)
      if (T.viseAngles && T.k < T.ticksCharge + 16 && this.ecartAngles(...T.viseAngles) > 0.02) return;
      if (T.arbalete) { sim.son('item.crossbow.loading_end', this.x, this.oeil()[1], this.z, 1, 1); this.usage = { type: 5, ticks: 0 }; T.etat = 'tenu'; T.attente = 3; return; }
      return tirer.call(this, T);
    }
    if (T.etat === 'tenu') { this.usage = { type: 5, ticks: 0 }; if (--T.attente <= 0) tirer.call(this, T); return; }
    if (T.etat === 'apres') { if (--T.attente <= 0) { this.regardTache = null; this.usage = null; this.finirTache('ok', ''); } }
  }
  function tirer(T) {
    const sim = this.sim, R = sim.regles, h = sim.hasard;
    const min = R.valeur('arcs.puissanceMin', 0.1);
    this.usage = null;
    T.etat = 'apres'; T.attente = 4;
    if (T.puissance < min) { sim.dire(`${this.nom} : arc trop peu tendu (${T.puissance.toFixed(2)} < ${min}), aucune fleche`); return; }
    if (T.horsPortee) sim.dire(`${this.nom} : cible hors de portee du tir`);
    if (T.fusee) {
      const e = nouvelleFusee(sim, this, [this.x, this.oeil()[1] - Math.fround(0.15), this.z], T.fusee, { oblique: true });
      if (e) { const v = sim.entites.proj.tirer(this.lacetTete, this.tangage, 1.6, 1.0); e.vx = v[0]; e.vy = v[1]; e.vz = v[2]; }
      sim.son('item.crossbow.shoot', this.x, this.oeil()[1], this.z, 1, 1 / (h.flottant() * 0.5 + 1.8) + 0.53);
      sim.stats.tirs = (sim.stats.tirs || 0) + 1;
      return;
    }
    // ProjectileWeaponItem.shoot : Tir multiple (projectile_count, projectile_spread : 0, +10, -10 degres), une usure par fleche ; Infinite
    // (ammo_use 0 sur une fleche simple) ; les fleches en plus du Tir multiple ne se ramassent pas
    const arme = this.main.objet, ench = sim.objetsJeu && Object.keys(lirePile(arme).ench).length > 0;
    const nb = ench ? Math.max(1, Math.trunc(sim.enchant.valeurPile(arme, 'projectile_count', { outil: idDe(arme) }, 1))) : 1;
    const ecart = ench ? sim.enchant.valeurPile(arme, 'projectile_spread', { outil: idDe(arme) }, 0) : 0;
    const pas = nb === 1 ? 0 : 2 * ecart / (nb - 1), d0 = ((nb - 1) % 2) * pas / 2;
    const munition = T.munition, conso = ench ? Math.trunc(sim.enchant.valeurPile(arme, 'ammo_use', { outil: idDe(munition) }, 1)) : 1;
    let signe = 1;
    for (let i = 0; i < nb; i++) {
      const angle = d0 + signe * Math.floor((i + 1) / 2) * pas; signe = -signe;
      sim.entites.proj.fleche(this, this.lacetTete + angle, this.tangage, T.puissance, { ...(T.arbalete ? { vitesse: T.vitesse0 * R.valeur('projectiles.vitesse', 1), crit: true, arbalete: true } : { vitesse: T.vitesse0 * R.valeur('projectiles.vitesse', 1) }), extra: this.flecheEnchantee(arme, munition, { ramassable: !this.creatif && !this.infini && conso > 0 && i === 0 }) });
      this.userPile('main', 1);
    }
    if (conso > 0) this.consommer(munition, 1);
    if (T.arbalete) sim.son('item.crossbow.shoot', this.x, this.oeil()[1], this.z, 1, 1 / (h.flottant() * 0.5 + 1.8) + 0.53);
    else sim.son('entity.arrow.shoot', this.x, this.oeil()[1], this.z, 1, 1 / (h.flottant() * 0.4 + 1.2) + T.puissance * 0.5);
    sim.stats.tirs = (sim.stats.tirs || 0) + 1;
  }

  // prend / depose
  function debutTransfert(T, a, sens) {
    const sim = this.sim, c = [a.x, a.y, a.z];
    if (sim.monde.etatEn(...c) < 0) throw new EchecActe('cellule inconnue');
    if (!sim.contenus.estConteneur(...c)) throw new EchecActe(`pas de conteneur en ${c.join(',')} (coffre, tonneau, entonnoir, dropper, distributeur ou four)`);
    T.sens = sens; T.objet = a.objet; T.n = a.n;
    if (sens === 'depose' && !T.objet) { T.objet = this.main.objet; if (!T.objet) throw new EchecActe('depose : quel objet ? [t, "depose", x, y, z, "coal", 4]'); }
    T.visible = true;
    this.preparerAction(T, a, c, { visible: true });
  }
  function tickTransfert(T) {
    const sim = this.sim, c = T.cible;
    if (T.etat === 'approche') { if (this.tickApproche(T)) { T.etat = 'vise'; T.vise = 0; this.entree.avance = 0; } return; }
    if (T.etat === 'vise') {
      const r = this.cibleCellule(c);
      if (!this.viseTache(T, r.point)) return;
      const v = this.verifierPortee(c, { visible: true });
      if (!v.ok) throw new EchecActe(v.raison);
      this.regardTache = null;
      // le coffre et le tonneau s'ouvrent (couvercle, son) comme avec `utilise`
      const e = sim.monde.etatEn(...c);
      sim.dernierUtilise = null;
      if (/chest|barrel/.test(sim.d.nomBloc(e))) {
        sim.utiliserBloc(c[0], c[1], c[2], { acteur: this.nom, face: v.r.face, hit: v.r.hit, accroupi: false, objet: null, lacet: this.lacet });
        if (sim.dernierUtilise?.ouvre) {
          this.ouvert = { pos: c, jusqua: sim.temps + 14 + 6 };
          sim.api.evenement('conteneur.ouvre', { pos: c, acteur: this.nom });
        }
      }
      this.balancer();
      T.etat = 'ouvre'; T.attente = this.ouvert ? 8 : 2;
      return;
    }
    if (T.etat === 'ouvre') {
      if (--T.attente > 0) return;
      this.transferer(T);
      T.etat = 'ferme'; T.attente = this.ouvert ? Math.max(1, this.ouvert.jusqua - sim.temps) : 1;
      return;
    }
    if (--T.attente <= 0) this.finirTache('ok', T.resume ?? '');
  }
  P.transferer = function (T) {
    const sim = this.sim, c = T.cible, a = T.acte, objet = String(T.objet ?? '').replace(/^minecraft:/, '');
    const four = sim.fours.estFour(...c);   // four, haut fourneau, fumoir
    if (T.sens === 'prend') {
      const liste = sim.api.contenuListe(c[0], c[1], c[2]);   // coffre double : les 54 cases
      let reste = T.n ?? Infinity, pris = 0;
      for (let i = 0; i < liste.length && reste > 0; i++) {
        const e = liste[i];
        if (!e || (objet && e.item !== objet)) continue;
        const k = sim.contenus.retirer(c[0], c[1], c[2], i, reste);
        this.sac.set(e.item, (this.sac.get(e.item) || 0) + k); pris += k; reste -= k;
        if (four && i === 2 && k > 0) sim.fours.payerExperience(c, this.x, this.y + 0.5, this.z);   // FurnaceResultSlot : l'experience des recettes faites
      }
      if (T.n !== undefined && pris < T.n) { sim.dire(`${this.nom} : ${pris} sur ${T.n} ${objet || 'objets'} trouves en ${c.join(',')}`); }
      sim.api.contenuNotifie(c[0], c[1], c[2]);
      sim.dire(`${this.nom} prend ${pris} ${objet || 'objets'} en ${c.join(',')}`);
      sim.stats.transferts = (sim.stats.transferts || 0) + pris;
      T.resume = `${pris} ${objet}`;
      if (pris === 0 && a.opts.strict) throw new EchecActe(`rien a prendre (${objet || 'objets'}) en ${c.join(',')}`);
      return;
    }
    const dispo = this.sac.get(objet) || 0, n = T.n ?? 1;
    if (!this.sacLibre && dispo < n) throw new EchecActe(`${this.nom} n'a que ${dispo} ${objet} (sac) : ajoute le champ sac de l'acteur`);
    let reste;
    if (four) reste = sim.fours.deposer(c, objet, n, a.opts.fente);
    else reste = sim.contenus.ajouter(c[0], c[1], c[2], objet, n);
    const mis = n - reste;
    if (!this.sacLibre || this.sac.has(objet)) this.sac.set(objet, Math.max(0, dispo - mis));
    sim.api.contenuNotifie(c[0], c[1], c[2]);
    sim.dire(`${this.nom} depose ${mis} ${objet} en ${c.join(',')}${reste ? ` (${reste} ne tiennent pas)` : ''}`);
    sim.stats.transferts = (sim.stats.transferts || 0) + mis;
    T.resume = `${mis} ${objet}`;
    if (reste === n) throw new EchecActe(`${objet} ne tient pas dans ${sim.d.nomBloc(sim.monde.etatEn(...c))} (plein, ou mauvaise fente : {"fente": "entree"|"combustible"})`);
  };
}
