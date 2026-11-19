// Inventaire d'un acteur simule, objets qui s'usent et se consomment, combat avec l'equipement enchante (docs/SIMULATION.md partie 26).
// Ce sont des METHODES de `Acteur` (moteur/acteurs.js) ajoutees ici, comme utilisation.js.
//   - Mode : un acteur avec un champ `sac` joue en SURVIE (piles finies : manger, lancer, tirer, poser consomment ; les outils s'usent et cassent) ;
//     sans `sac` ni `mode`, la main est INFINIE comme avant (rien ne se consomme ni ne s'use ; la faim travaille) ; `mode: "survie"` impose les
//     piles finies, `mode: "creatif"` le creatif du jeu (rien ne se consomme, ne s'use, pas de faim).
//   - Une pile est un texte (moteur/pile.js) : `diamond_sword[sharpness=5]`, `bow[usure=12]`. Le sac compte les piles par texte canonique.
//   - Usure (ItemStack.hurtAndBreak) : Solidite (composant item_damage, remove_binomial du jeu), casse au maximum (son entity.item.break, miettes).
//   - Coup d'epee (Player.attack) : attribut d'attaque du jeu (1 + arme de `objets` + Force / Faiblesse), bonus d'enchantement (Tranchant,
//     Chatiment, Fleau des arthropodes, Empalement) x recharge, critique x 1,5 sur la base, recul (Recul + 1 en courant) x 0,5, effets apres
//     l'attaque (Aura de feu, Fleau, Epines de la victime, Vent violent), usure de l'arme (item_damage_per_attack), epuisement 0,1.
//   - Masse (MaceItem) : coup ecrasant apres une chute de plus de 1,5 bloc (4 par bloc jusqu'a 3, 2 jusqu'a 8, 1 ensuite, + Densite x chute),
//     Brise-armure (armor_effectiveness), recul autour, la chute est remise a zero.
//   - Reparation par l'experience (Raccommodage, ExperienceOrb.repairPlayerItems) ; butin des creatures avec Pillage.
// Port de Horizon game/{item_durability,enchant_effects,mace}.rs, horizon-world/src/{item_durability,component_durability}.rs (MIT, ATTRIBUTIONS.md).
import { lirePile, textePile, canon, idDe } from './pile.js';
import { typeDegats, estDirect, valeurNiveau } from './enchantements.js';
import { armureDe } from './explosion.js';
import { effetsPotion } from './potions.js';

const court = (s) => String(s ?? '').replace(/^minecraft:/, '');
export const f2 = (v) => String(Math.round(v * 100) / 100).replace('.', ',');   // nombre du journal de `mcanim simuler` (2 decimales, virgule)
export const EMP_ARMURE = ['tete', 'torse', 'jambes', 'pieds'];
const VITESSE_ATTRIBUT = 0.1;   // attribut movement_speed du joueur (valeur de base 0,1 : VITESSE_MARCHE d'acteurs.js), pour Player.isSweepAttack
const PIECE = { tete: 'helmet', torse: 'chestplate', jambes: 'leggings', pieds: 'boots' };
// armure donnee par materiau ("diamond", champ armure des scenes) ou par objet ("diamond_helmet[protection=4]") : l'objet du jeu de l'emplacement
export function idArmure(d, texte, emp) {
  const id = idDe(texte);
  if (d.j.objets?.[id]) return id;
  const c = `${id === 'gold' ? 'golden' : id}_${PIECE[emp]}`;
  return d.j.objets?.[c] ? c : id;
}
const SLOT_JEU = { tete: 'head', torse: 'chest', jambes: 'legs', pieds: 'feet' };
// objets a composant death_protection et leurs death_effects apres clear_all_effects (items.json du jeu 26.3 : seul le totem l'a) :
// [effet, ticks, amplificateur]
export const TOTEM_EFFETS = { totem_of_undying: [['regeneration', 900, 1], ['absorption', 100, 1], ['fire_resistance', 800, 0]] };

// composants d'objet de nos tables (outils/extraire-donnees-jeu.mjs, `objets`)
export function composants(d, id) {
  const o = d.j.objets?.[court(idDe(id) ?? id)];
  if (!o) return { usureMax: 0, enchantable: 0, reparable: '', attaque: 0, vitesse: 0, armure: 0, robustesse: 0, antiRecul: 0, usureCoup: -1, emplacement: '', carburant: 0, echelleDuree: 1, reflet: -1, resiste: '' };
  return { usureMax: o[0], enchantable: o[1], reparable: o[2], attaque: o[3], vitesse: o[4], armure: o[5], robustesse: o[6], antiRecul: o[7], usureCoup: o[8], emplacement: o[9], carburant: o[10], echelleDuree: o[11], reflet: o[12], resiste: o[13] };
}
// taille de pile : table `piles` des blocs et machines (partie 27), sinon 64
export const pileMax = (d, id) => d.j.piles?.[court(idDe(id) ?? id)] ?? (d.j.objets?.[court(idDe(id) ?? id)]?.[14] ?? 64);

export function installerInventaire(Acteur, EchecActe) {
  const P = Acteur.prototype;

  P.initInventaire = function (d) {
    this.creatif = d.mode === 'creatif';   // Player.abilities.instabuild : rien ne se consomme ni ne s'use, pas de faim
    this.infini = this.creatif || (d.mode !== 'survie' && d.sac === undefined);   // sans sac ni mode : la main infinie d'avant (rien ne se consomme ni ne s'use)
    this.niveauXp = d.niveaux ?? 0; this.progresXp = 0; this.xp = 0;
    this.gauche = d.gauche ? canon(d.gauche) : null;
    if (this.armure) for (const k of Object.keys(this.armure)) if (this.armure[k]) this.armure[k] = canon(this.armure[k]);
    this.armureDepart = this.armure ? { ...this.armure } : null;   // pieces du depart (rapport : piece cassee)
    // le sac garde les piles par texte canonique ; l'objet tenu au depart y est (survie : il doit y etre, sinon il y est ajoute)
    const s = new Map();
    for (const [k, v] of this.sac) { const c = canon(k); s.set(c, (s.get(c) ?? 0) + v); }
    this.sac = s;
    if (this.main.objet) { this.main.objet = canon(this.main.objet); if (!this.infini && !this.sac.has(this.main.objet)) this.sac.set(this.main.objet, 1); }
    // Player.enchantmentSeed : tiree du hasard du joueur ; ici du nom de l'acteur et de la graine du monde (le hasard du monde n'est pas touche :
    // les scenes d'avant gardent leurs tirages)
    let hsh = 0; for (const ch of String(this.nom)) hsh = (Math.imul(hsh, 31) + ch.charCodeAt(0)) | 0;
    this.graineEnchant = hsh ^ (this.sim.config?.graine ?? 1);
    if (d.saturation !== undefined) this.satur = Math.min(this.faim, d.saturation);
    // les enchantements agissent dans TOUS les modes (survie, creatif, main infinie : seuls la consommation et l'usure en dependent) ; sans les
    // fichiers du jeu ils ne peuvent pas agir : on le dit au lieu de les ignorer en silence
    if (!this.sim.objetsJeu && [this.main.objet, this.gauche, ...Object.values(this.armure ?? {}), ...this.sac.keys()].some((t) => t && Object.keys(lirePile(t).ench).length)) this.sim.avertir(`${this.nom} : enchantements sans effet (donnees du jeu absentes : groupe de kit "recettes" ou MCANIM_OBJETS_JEU)`);
  };

  // ---------------------------------------------------------------- piles du sac
  P.nombre = function (texte) { return this.sac.get(canon(texte)) ?? 0; };
  // premiere pile du sac dont l'identifiant est `id` (ou le texte exact), ordre d'insertion
  P.pileDe = function (texteOuId) {
    const c = canon(texteOuId);
    if (this.sac.get(c) > 0) return c;
    const id = idDe(texteOuId);
    for (const [k, n] of this.sac) if (n > 0 && idDe(k) === id) return k;
    return null;
  };
  P.ajouter = function (texte, n = 1) {
    const c = canon(texte);
    if (this.infini && this.sacLibre) return;
    this.sac.set(c, (this.sac.get(c) ?? 0) + n);
  };
  // consomme n piles (le texte exact, ou la premiere de meme identifiant) ; creatif : rien ne part ; rend vrai si c'etait possible
  P.consommer = function (texte, n = 1, { raison = '' } = {}) {
    if (this.infini) return true;
    const k = this.pileDe(texte);
    const dispo = k ? this.sac.get(k) : 0;
    if (dispo < n) return false;
    if (dispo === n) this.sac.delete(k); else this.sac.set(k, dispo - n);
    if (this.main.objet === k && !this.sac.has(k)) { this.main = { objet: null, efficacite: 0 }; if (raison) this.sim.dire(`${this.nom} n'a plus de ${idDe(k)} (${raison})`); }
    return true;
  };
  // [t, "tient", objet] : en survie l'objet doit etre dans le sac (sa premiere pile de meme identifiant est prise) ; null : main vide
  P.tenir = function (objet, eff = 0) {
    if (objet === null || objet === undefined) { this.main = { objet: null, efficacite: 0 }; return ''; }
    let t = canon(objet);
    if (!this.infini) {
      const k = this.pileDe(objet);
      if (!k) throw new EchecActe(`${this.nom} n'a pas de ${idDe(objet)} dans son sac (survie) : ajoute-le au champ sac`);
      t = k;
    }
    // Efficacite : celle de l'enchantement de la pile (efficiency=n), ou l'ancienne option {eff}
    this.main = { objet: t, efficacite: lirePile(t).ench.efficiency ?? eff ?? 0 };
    return '';
  };

  // ---------------------------------------------------------------- usure (ItemStack.hurtAndBreak / processDurabilityChange)
  // emp : 'main' | 'gauche' | 'tete' | 'torse' | 'jambes' | 'pieds' ; n : usure brute (Solidite la reduit) ; rend vrai si l'objet a casse
  // horsInfini : l'usure compte aussi en main infinie (armure : partie 32) ; seul le creatif l'empeche
  P.userPile = function (emp, n = 1, { horsInfini = false } = {}) {
    const sim = this.sim;
    if ((horsInfini ? this.creatif : this.infini) || n <= 0 || !sim.regles.valeur('objets.usure', true)) return false;
    const texte = emp === 'main' ? this.main.objet : emp === 'gauche' ? this.gauche : this.armure?.[emp];
    if (!texte) return false;
    const p = lirePile(texte), idJeu = EMP_ARMURE.includes(emp) ? idArmure(sim.d, texte, emp) : p.id, max = composants(sim.d, idJeu).usureMax;
    if (!max) return false;
    // Solidite (remove_binomial) : armure (#enchantable/armor) gardee avec la chance 0,6 + 0,4 / (n + 1), le reste 1 / (n + 1)
    if (Object.keys(p.ench).length && sim.objetsJeu) n = Math.max(0, Math.trunc(sim.enchant.valeurPile(texte, 'item_damage', { outil: idJeu }, n)));
    if (n <= 0) return false;
    const usure = p.usure + n;
    const ancien = texte;
    if (usure >= max) {   // casse : son, miettes (LivingEntity.onEquippedItemBroken)
      sim.son('entity.item.break', this.x, this.y + 1, this.z, 0.8, 0.8 + sim.hasard.flottant() * 0.4);
      for (let i = 0; i < 5; i++) sim.particule('item|' + p.id, this.x, this.oeil()[1] - 0.3, this.z, (sim.hasard.flottant() - 0.5) * 0.1, sim.hasard.flottant() * 0.1 + 0.1, (sim.hasard.flottant() - 0.5) * 0.1, 1);
      this.retirerPile(ancien, emp, null);
      sim.dire(`${this.nom} : ${p.id} casse (${max} d'usure)`);
      (sim.stats.objetsCasses ??= []).push(`${(sim.temps / 20).toFixed(2)} ${this.nom} ${p.id}`);
      return true;
    }
    this.retirerPile(ancien, emp, textePile({ ...p, usure }));
    return false;
  };
  // remplace la pile `ancien` de l'emplacement par `nouveau` (null : cassee) dans le sac et l'equipement
  P.retirerPile = function (ancien, emp, nouveau) {
    const k = this.sac.get(ancien) ?? 0;
    if (k > 0) { if (k === 1) this.sac.delete(ancien); else this.sac.set(ancien, k - 1); if (nouveau) this.sac.set(nouveau, (this.sac.get(nouveau) ?? 0) + 1); }
    if (emp === 'main') this.main = { objet: nouveau, efficacite: nouveau ? this.main.efficacite : 0 };
    else if (emp === 'gauche') this.gauche = nouveau;
    else if (this.armure) { this.armure[emp] = nouveau; if (!nouveau) this.armure = { ...this.armure }; if (!nouveau || JSON.stringify(lirePile(ancien).ench) !== JSON.stringify(lirePile(nouveau).ench)) (this.sim.replay.armures ??= []).push([this.sim.temps, this.id, emp, nouveau]); }   // le film : piece cassee (film/acteurs-vivants.js)
  };
  // ItemStack.hurtWithoutBreaking : la pile usee de n (Solidite comprise), jamais au-dela de max - 1 ; rend le texte (rien ne change dans le sac)
  P.useSansCasser = function (texte, n) {
    const sim = this.sim, p = lirePile(texte), max = composants(sim.d, p.id).usureMax;
    if (this.infini || !max) return canon(texte);
    if (Object.keys(p.ench).length && sim.objetsJeu) n = Math.max(0, Math.trunc(sim.enchant.valeurPile(texte, 'item_damage', { outil: p.id }, n)));
    return textePile({ ...p, usure: Math.min(max - 1, p.usure + n) });
  };
  P.usureMain = function () { return this.main.objet ? lirePile(this.main.objet).usure : 0; };

  // Raccommodage (ExperienceOrb.repairPlayerItems) : une pile equipee abimee avec repair_with_xp (tiree au hasard, ordre des emplacements du jeu),
  // reparee de min(xp x 2, usure) ; le reste de l'experience (xp - repare x xp / (xp x 2)) recommence ; rend l'experience qui reste au joueur
  P.reparerXp = function (xp) {
    const sim = this.sim;
    let reste = xp;
    for (let garde = 0; garde < 8 && reste > 0; garde++) {
      const cand = ['main', 'gauche', 'pieds', 'jambes', 'torse', 'tete'].filter((e) => { const t = e === 'main' ? this.main.objet : e === 'gauche' ? this.gauche : this.armure?.[e]; return t && lirePile(t).usure > 0 && sim.objetsJeu && sim.enchant.aComposant(t, 'repair_with_xp'); });
      if (!cand.length) return reste;
      const emp = cand[sim.hasard.entierBorne(cand.length)], t = emp === 'main' ? this.main.objet : emp === 'gauche' ? this.gauche : this.armure[emp];
      const p = lirePile(t), aReparer = Math.trunc(sim.enchant.valeurPile(t, 'repair_with_xp', { outil: p.id }, reste));
      if (aReparer <= 0) return 0;
      const rep = Math.min(aReparer, p.usure);
      if (rep <= 0) return reste;
      this.retirerPile(t, emp, textePile({ ...p, usure: p.usure - rep }));
      sim.stats.raccommode = (sim.stats.raccommode || 0) + rep;
      reste -= Math.floor(rep * reste / aReparer);
    }
    return reste;
  };

  // ---------------------------------------------------------------- combat au corps a corps (Player.attack)
  // attribut attack_damage : 1 (joueur) + l'arme + Force (3 par niveau) - Faiblesse (4 par niveau) ; vitesse : 4 + l'arme
  P.attributAttaque = function () {
    const c = composants(this.sim.d, this.main.objet);
    const base = this.main.objet ? 1 + c.attaque : 1;
    return Math.max(0, base + 3 * this.niveauEffet('strength') - 4 * this.niveauEffet('weakness'));
  };
  P.vitesseAttaque = function () { const c = composants(this.sim.d, this.main.objet); return this.main.objet && (c.attaque || c.vitesse) ? 4 + c.vitesse : 4; };
  // rend { degats, recharge, critique, recul, ecrasant }
  P.coupArme = function (o, depuis, critique) {
    const sim = this.sim, arme = this.main.objet;
    const periode = 20 / this.vitesseAttaque(), s = Math.max(0, Math.min(1, (depuis + 0.5) / periode));
    // ordre de Player.attack (Horizon melee.rs melee_damage) : bonus d'enchantement pris sur l'attribut AVANT la recharge ; base x (0,2 + 0,8 s^2),
    // bonus x s ; PUIS Item.getAttackDamageBonus (coup ecrasant de la masse : NON multiplie par la recharge) ; PUIS le critique (s > 0,9) x 1,5 sur
    // base + ecrasant ; enfin + le bonus d'enchantement
    let f = this.attributAttaque();
    const base = f, facteur = 0.2 + s * s * 0.8;
    const ctx = { type: 'player_attack', direct: true, ceci: o, attaquant: this, directAttaquant: this, outil: idDe(arme) };
    let bonus = arme && sim.objetsJeu ? sim.enchant.valeurPile(arme, 'damage', ctx, f) - f : 0;
    f *= 0.2 + s * s * 0.8; bonus *= s;
    // masse : coup ecrasant (MaceItem.getAttackDamageBonus) apres une chute de plus de 1,5 bloc
    let ecrasant = 0, chute = 0, ecrasantChute = 0, densite = 0;
    if (idDe(arme) === 'mace' && this.distanceChute > 1.5 && !this.planeur) {
      const h = chute = this.distanceChute;
      ecrasant = ecrasantChute = h <= 3 ? 4 * h : h <= 8 ? 12 + 2 * (h - 3) : 22 + h - 8;
      if (sim.objetsJeu) { densite = sim.enchant.valeurPile(arme, 'smash_damage_per_fallen_block', ctx, 0) * h; ecrasant += densite; }
    }
    const baseCharge = f;
    f += ecrasant;
    const avantCritique = f;
    const crit = critique && s > 0.9;
    if (crit) f *= 1.5;
    let recul = arme && sim.objetsJeu ? sim.enchant.valeurPile(arme, 'knockback', ctx, 0) : 0;
    return { degats: f + bonus, recharge: s, critique: crit, recul, ecrasant, periode, balayage: this.estBalayage(s, crit), detail: { base, facteur, baseCharge, bonus, chute, ecrasantChute, densite, avantCritique, apresCritique: f } };
  };
  // une ligne du journal : le calcul du coup, pas a pas (rien n'est recalcule : les valeurs de coupArme et des protections de la victime)
  P.detailCoup = function (o, c, dd) {
    const x = c.detail, L = [`coup ${this.nom}>${o.nom} recharge ${f2(c.recharge * 100)} % : base ${f2(x.base)} x ${f2(x.facteur)} = ${f2(x.baseCharge)}`];
    if (x.ecrasantChute) L.push(`masse +${f2(x.ecrasantChute)} (chute ${f2(x.chute)})`);
    if (x.densite) L.push(`Densite +${f2(x.densite)}`);
    if (c.critique) L.push(`critique x 1,5 -> ${f2(x.apresCritique)}`);
    if (x.bonus) L.push(`enchantement +${f2(x.bonus)}`);
    L.push(`= ${f2(c.degats)}`);
    if (dd.partiel) L.push(`invulnerable : ecart ${f2(dd.entree)}`);
    for (const e of dd.etapes ?? []) L.push(e);
    L.push(`final ${f2(dd.final)}`);
    return L.join(' ; ');
  };
  // apres un coup qui a porte : recul du jeu, effets d'enchantement, masse, usure, epuisement
  P.apresCoup = function (o, c, ok) {
    const sim = this.sim, R = sim.regles.valeur('combat.recul', 1), arme = this.main.objet;
    if (ok) {
      let kb = c.recul + (this.course && c.recharge > 0.9 ? 1 : 0);
      if (kb > 0) { o.recul(kb * 0.5 * R, this.x - o.x, this.z - o.z); this.vx *= 0.6; this.vz *= 0.6; if (this.course && c.recharge > 0.9) sim.son('entity.player.attack.knockback', this.x, this.y, this.z, 1, 1); }
      if (c.balayage) this.balayer(o, c);
      // Player.itemAttackInteraction (Horizon mace.rs weapon_hit) : MaceItem.hurtEnemy (la chute s'arrete : vitesse verticale 0,01, recul autour),
      // PUIS les post_attack de l'arme (Rafale de vent : l'explosion a ses pieds le relance, la chute compte encore pour sa condition), PUIS
      // MaceItem.postHurtEnemy (chute remise a zero)
      if (c.ecrasant > 0) this.ecraser(o, c);
      if (sim.objetsJeu && (arme || o.armure)) sim.enchant.apresAttaque(o, this, { type: 'player_attack', direct: true, directAttaquant: this, arme, attaquantSeul: true });   // l'armure de la victime : dans degats (acteurs.js)
      if (c.ecrasant > 0) { this.distanceChute = 0; if (this.vy > 0.02) this.relance = { y0: this.y, t: sim.temps }; }   // relance (Rafale de vent) : hauteur notee au sommet (acteurs.js)
      // MaceItem.postHurtEnemy et l'arme : usure item_damage_per_attack (epee 1, hache 2) ; un outil sans composant weapon : 2 (Item.hurtEnemy)
      if (arme) { const u = composants(sim.d, arme).usureCoup; this.userPile('main', u >= 0 ? u : composants(sim.d, arme).usureMax ? 2 : 0); }
    }
    this.epuiser(0.1);
  };
  // Player.isSweepAttack (Horizon motion.rs is_sweep_attack) : recharge > 0,9, pas critique, pas en course, au sol, vitesse horizontale au carre
  // sous (movement_speed x 2,5)^2, une epee (#swords) en main
  P.estBalayage = function (s, critique) {
    const arme = this.main.objet, oj = this.sim.objetsJeu;
    if (this.typeCreature || !(s > 0.9) || critique || this.course || !this.auSol || !arme || !oj) return false;
    const lim = VITESSE_ATTRIBUT * (this.facteurVitesse?.() ?? 1) * 2.5;
    return this.vx * this.vx + this.vz * this.vz < lim * lim && oj.etiquette('item', 'swords').has(idDe(arme));
  };
  // Player.doSweepAttack (Horizon mace.rs sweep_damage) : son, puis chaque autre vivant dans la boite de la cible elargie de (1 ; 0,25 ; 1) et a
  // moins de 3 blocs du joueur (distance au carre < 9) prend getEnchantedDamage(1 + sweeping_damage_ratio x attaque x (0,2 + 0,8 s^2)) x s,
  // recule de 0,4 dans le sens du regard, puis les post_attack de l'arme. La cible et l'attaquant sont epargnes.
  P.balayer = function (o, c) {
    const sim = this.sim, arme = this.main.objet, R = sim.regles.valeur('combat.recul', 1), s = c.recharge;
    sim.son('entity.player.attack.sweep', this.x, this.y, this.z, 1, 1);
    const B = o.boite(), zone = [B[0] - 1, B[1] - 0.25, B[2] - 1, B[3] + 1, B[4] + 0.25, B[5] + 1];
    const ratio = Math.max(0, Math.min(1, this.bonusAttribut('sweeping_damage_ratio')));
    const base = 1 + ratio * this.attributAttaque() * (0.2 + s * s * 0.8);
    const a = this.lacetTete * Math.PI / 180, kx = Math.sin(a), kz = -Math.cos(a);   // LivingEntity.knockback(0,4 ; sin(yRot) ; -cos(yRot))
    for (const v of [...this.g.liste]) {
      if (v === this || v === o || v.mort >= 0 || v.veh) continue;
      const b = v.boite();
      if (!(b[0] < zone[3] && b[3] > zone[0] && b[1] < zone[4] && b[4] > zone[1] && b[2] < zone[5] && b[5] > zone[2])) continue;
      if ((v.x - this.x) ** 2 + (v.y - this.y) ** 2 + (v.z - this.z) ** 2 >= 9) continue;
      const ctx = { type: 'player_attack', direct: true, ceci: v, attaquant: this, directAttaquant: this, outil: idDe(arme) };
      const q = (sim.objetsJeu ? sim.enchant.valeurPile(arme, 'damage', ctx, base) : base) * s;
      v.attaquantCourant = this;
      const ok = v.frappe(q, 'joueur:' + this.nom, kx, kz, 0.4 * R);
      v.attaquantCourant = null;
      if (!ok) continue;
      v.ia?.blesse(this); v.dernierFrappeur = this;
      sim.enchant.apresAttaque(v, this, { type: 'player_attack', direct: true, directAttaquant: this, arme, attaquantSeul: true });
      (sim.stats.balayages ??= []).push(`${(sim.temps / 20).toFixed(2)} ${this.nom} balaie ${v.nom} ${+q.toFixed(2)}`);
    }
    // Player.sweepAttack : l'arc devant le joueur, sendParticles(SWEEP_ATTACK, x - sin(lacet), y + hauteur / 2, z + cos(lacet), 0, -sin, 0, cos)
    const dx = -Math.sin(a), dz = Math.cos(a);
    sim.particule('sweep_attack', this.x + dx, this.y + this.H * 0.5, this.z + dz, dx, 0, dz, 1);
  };
  // MaceItem.hurtEnemy (Horizon mace.rs) : vitesse verticale 0,01, son au sol (lourd au-dela de 5 blocs) ou en l'air, chute ignoree, puis
  // MaceItem.knockback : chaque vivant a 3,5 blocs de la cible (sauf l'attaquant et la cible) pousse de (3,5 - d) x 0,7 x (2 si lourd) x
  // (1 - resistance) a l'horizontale et de 0,7 vers le haut ; la chute est remise a zero (postHurtEnemy)
  P.ecraser = function (o, c) {
    const sim = this.sim;
    const lourd = this.distanceChute > 5;
    this.vy = Math.fround(0.01);
    // calculateImpactPosition + setIgnoreFallDamageFromCurrentImpulse(true) : la chute ne comptera que sous le point du coup (40 ticks de grace)
    if (!this.typeCreature) this.impulsion = { y: this.impulsion && this.impulsion.y <= this.y ? this.impulsion.y : this.y, grace: 40 };
    sim.son(o.auSol ? (lourd ? 'item.mace.smash_ground_heavy' : 'item.mace.smash_ground') : 'item.mace.smash_air', this.x, this.y, this.z, 1, 1);
    this.ecrasement = sim.temps;   // la chute est remise a zero apres les post_attack (apresCoup)
    for (const v of this.g.liste) {
      if (v === this || v === o || v.mort >= 0) continue;
      const d = [v.x - o.x, v.y - o.y, v.z - o.z], L = Math.hypot(...d);
      if (L > 3.5) continue;
      const f = (3.5 - L) * Math.fround(0.7) * (lourd ? 2 : 1) * (1 - (v.ia?.pr.antiRecul ?? 0));
      if (f <= 0) continue;
      if (L >= Math.fround(1e-5)) { v.vx += d[0] / L * f; v.vz += d[2] / L * f; }
      v.vy += Math.fround(0.7); v.auSol = false;
    }
    for (let i = 0; i < 20; i++) sim.particule('block_break|' + sim.d.chaine(Math.max(0, sim.monde.etatEn(Math.floor(o.x), Math.floor(o.y - 0.5), Math.floor(o.z)))), o.x + (sim.hasard.flottant() - 0.5) * 2, o.y, o.z + (sim.hasard.flottant() - 0.5) * 2, 0, 0.2, 0, 1);
    (sim.stats.coupsEcrasants ??= []).push(`${(sim.temps / 20).toFixed(2)} ${this.nom} ${c.ecrasant.toFixed(1)}`);
  };

  // ---------------------------------------------------------------- degats recus : armure du jeu, Brise-armure, Resistance, Protection, absorption
  // LivingEntity.actuallyHurt : getDamageAfterArmorAbsorb (armure + robustesse, usure des pieces), getDamageAfterMagicAbsorb (Resistance, puis les
  // protections d'enchantement : somme des damage_protection plafonnee a 20, x (1 - epf / 25)), puis l'absorption.
  P.degatsApresProtections = function (q, source, { contourneArmure, attaquant = null } = {}) {
    const sim = this.sim, type = typeDegats(source), E = this.etapesProtection = [];   // etapes notees pour le journal (acteurs.js detailCoup)
    // armure (LivingEntity.getDamageAfterArmorAbsorb : hurtArmor AVANT la reduction, avec les degats bruts)
    if (!contourneArmure) {
      if (!this.typeCreature) this.userArmure(q, type);   // Player.hurtArmor ; un mob n'use pas son armure (LivingEntity.hurtArmor est vide)
      let pts = 0, rob = 0;
      const arm = this.armureDu?.() ?? null;
      if (arm) { pts = arm.points; rob = arm.robustesse; }
      if (pts > 0) {
        // Brise-armure de l'arme de l'attaquant (armor_effectiveness)
        let eff = 1;
        const arme = attaquant?.main?.objet;
        if (arme && sim.objetsJeu) eff = Math.max(0, sim.enchant.valeurPile(arme, 'armor_effectiveness', { outil: idDe(arme) }, 1));
        const f = 2 + rob / 4, g = Math.min(20, Math.max(pts * 0.2, pts - q / f)) * eff;
        q *= 1 - g / 25;
        E.push(`armure ${pts} robustesse ${rob}${eff !== 1 ? ' efficacite ' + f2(eff) : ''} -> ${f2(q)}`);
      }
    }
    // Resistance : 5 x niveau sur 25 (pas pour le vide)
    const res = this.niveauEffet('resistance');
    if (res > 0 && type !== 'out_of_world') { q = Math.max(0, q * (25 - res * 5) / 25); E.push(`Resistance ${res} -> ${f2(q)}`); }
    // protections d'enchantement (pas pour les degats qui ignorent les enchantements)
    let epf = 0;
    if (sim.objetsJeu && !sim.objetsJeu.etiquette('damage_type', 'bypasses_enchantments').has(type)) epf = sim.enchant.valeurEquipement(this, 'damage_protection', { type, direct: estDirect(source), ceci: this, attaquant }, 0);
    epf += 2 * (/^(explosion|fusee)/.test(source) ? this.protectionExplosion ?? 0 : 0);   // ancien champ protectionExplosion (somme des niveaux)
    epf = Math.min(20, Math.max(0, epf));
    if (epf > 0) { q *= 1 - epf / 25; E.push(`Protection EPF ${f2(epf)} -> ${f2(q)}`); }
    // absorption
    if (this.absorption > 0) { const a = Math.min(this.absorption, q); this.absorption -= a; q -= a; E.push(`absorption -${f2(a)}`); }
    return q;
  };
  // armure portee : points et robustesse des composants du jeu (attribute_modifiers de `objets`)
  P.armureDu = function () {
    let { points, robustesse } = armureDe({ typeCreature: this.typeCreature });   // armure naturelle des creatures (explosion.js)
    for (const e of EMP_ARMURE) { const t = this.armure?.[e]; if (!t) continue; const c = composants(this.sim.d, idArmure(this.sim.d, t, e)); points += c.armure; robustesse += c.robustesse; }
    return { points, robustesse };
  };
  // LivingEntity.doHurtEquipment : (int) max(1, degats / 4) a chaque piece portee qui s'use (pieds, jambes, torse, tete : l'ordre du jeu, celui des
  // tirages de Solidite), dans tous les modes sauf le creatif ; une piece qui resiste au feu (netherite : damage_resistant #is_fire) ne s'use pas sous des degats de feu
  P.userArmure = function (degats, type = 'generic') {
    if (!(degats > 0) || !this.armure) return;
    const sim = this.sim, n = Math.trunc(Math.max(1, degats / 4));
    const feu = sim.objetsJeu ? sim.objetsJeu.etiquette('damage_type', 'is_fire').has(type) : /^(on_fire|in_fire|lava|hot_floor|fireball|campfire|unattributed_fireball)$/.test(type);
    for (const e of ['pieds', 'jambes', 'torse', 'tete']) {
      const t = this.armure[e]; if (!t) continue;
      const c = composants(sim.d, idArmure(sim.d, t, e));
      if (!c.usureMax || (feu && c.resiste === '#is_fire')) continue;
      // tous les modes sauf le creatif : dans le jeu un joueur creatif ne prend aucun degat (Player.isInvulnerableTo : abilities.invulnerable) et
      // ItemStack.hurtAndBreak n'use rien chez un joueur aux materiaux infinis (Horizon horizon-world item_durability.rs) ; la « main infinie »
      // des scenes sans sac est un choix du lecteur (consommation), pas un mode du jeu : l'armure y s'use comme en survie
      this.userPile(e, n, { horsInfini: true });
    }
  };

  // ---------------------------------------------------------------- attributs des enchantements de l'equipement (EnchantmentHelper.forEachModifier)
  P.bonusAttribut = function (nom) { return this.sim.objetsJeu && (this.armure || this.main.objet) ? this.sim.enchant.attribut(this, nom) : 0; };
  // LivingEntity.travelInWater : frein horizontal 0,8 (0,9 en nageant vite), rapproche de 0,546 par water_movement_efficiency (Agilite aquatique,
  // moitie hors du sol) ; Grace du dauphin : 0,96
  P.freinEau = function () {
    let f = this.course ? Math.fround(0.9) : Math.fround(0.8);
    let e = this.bonusAttribut('water_movement_efficiency');
    if (!this.auSol) e *= 0.5;
    if (e > 0) f += (Math.fround(0.54600006) - f) * e;
    if (this.effets.size && this.niveauEffet('dolphins_grace')) f = Math.fround(0.96);
    return f;
  };
  P.vitesseNage = function (vitesseSol) {
    let a = Math.fround(0.02), e = this.bonusAttribut('water_movement_efficiency');
    if (!this.auSol) e *= 0.5;
    if (e > 0) a += (vitesseSol * (this.course ? 1.3 : 1) - a) * e;
    return a;
  };
  // LivingEntity.decreaseAirSupply : avec oxygen_bonus i (Apnee), l'air ne baisse pas si nextDouble() >= 1 / (i + 1)
  P.garderAir = function () { const i = this.bonusAttribut('oxygen_bonus'); return i > 0 && this.sim.hasard.reel() >= 1 / (i + 1); };
  // Player.getDestroySpeed : sous l'eau x submerged_mining_speed (0,2 ; Affinite aquatique : x 5 = 1) ; sur une echelle on mine comme au sol (non : le jeu divise aussi)
  P.sousEauSansAffinite = function () { return !!this.teteEau && this.bonusAttribut('submerged_mining_speed') <= 0 && !(this.armure?.tete && this.sim.objetsJeu && this.sim.enchant.attribut(this, 'submerged_mining_speed', 'add_multiplied_total') > 0); };
  P.grimpeCasse = function () { return false; };
  // location_changed des pieds (Marche givree, Agilite des ames) a chaque changement de cellule ; tick (particules de Agilite des ames)
  P.tickEquipement = function () {
    const sim = this.sim;
    if (!sim.objetsJeu || !this.armure?.pieds || this.mort >= 0) return;
    const t = this.armure.pieds, ench = Object.entries(lirePile(t).ench);
    // composant `tick` (EnchantmentHelper.tickEffects) : chaque tick
    for (const [id, n] of ench) for (const x of sim.enchant.def(id)?.effects?.['minecraft:tick'] ?? []) {
      if (x.requirements && !sim.enchant.condition(x.requirements, n, { ceci: this, position: [this.x, this.y, this.z] })) continue;
      sim.enchant.effetEntite(x.effect, n, this, { porteur: this, emplacement: 'feet', pile: t, ceci: this, position: [this.x, this.y, this.z] });
    }
    // composant `location_changed` (LivingEntity.onChangedBlock) : quand la cellule des pieds change
    const k = `${Math.floor(this.x)},${Math.floor(this.y)},${Math.floor(this.z)},${this.auSol ? 1 : 0}`;
    if (k === this.derniereCellule) return;
    this.derniereCellule = k;
    for (const [id, n] of ench) {
      for (const x of sim.enchant.def(id)?.effects?.['minecraft:location_changed'] ?? []) {
        const ctx = { ceci: this, position: [this.x, this.y, this.z], actif: !!this.agiliteAmes };
        const ty = court(x.effect?.type), attr = ty === 'all_of' && x.effect.effects?.some((e) => court(e.type) === 'attribute');
        if (x.requirements && !sim.enchant.condition(x.requirements, n, ctx)) { if (attr) this.agiliteAmes = 0; continue; }
        if (attr) {   // Agilite des ames : attribut movement_speed (ajout) tant que la condition tient
          const a = x.effect.effects.find((e) => court(e.attribute) === 'movement_speed');
          this.agiliteAmes = a ? valeurNiveau(a.amount, n) : 0;
          continue;
        }
        sim.enchant.effetEntite(x.effect, n, this, { porteur: this, emplacement: 'feet', pile: t, ceci: this });
      }
    }
  };

  // ---------------------------------------------------------------- Totem d'immortalite (LivingEntity.checkTotemDeathProtection, jeu 26.3 ;
  // Horizon game/totem.rs et mobs.rs use_death_protection, MIT) : un coup mortel qui n'est pas dans #bypasses_invulnerability (le vide, /kill)
  // est pris par la premiere main (principale, puis secondaire) qui tient un objet a composant death_protection (le totem : items.json du jeu).
  // La pile perd un objet dans TOUS les modes (itemStack.shrink(1), creatif compris), la vie passe a 1, puis les death_effects du composant :
  // clear_all_effects, Regeneration II 900 ticks, Absorption II 100 ticks, Resistance au feu 800 ticks. Evenement 35 : emetteur de particules
  // totem_of_undying (30 ticks, l'entite suivie), son item.totem.use, et l'animation de l'objet a l'ecran du joueur (film/totem-ecran.js).
  P.totemSauve = function (source) {
    const sim = this.sim, type = typeDegats(source);
    const contourne = sim.objetsJeu ? sim.objetsJeu.etiquette('damage_type', 'bypasses_invulnerability') : new Set(['out_of_world', 'generic_kill']);
    if (contourne.has(type)) return false;
    const emp = [['main', this.main?.objet], ['gauche', this.gauche]].find(([, t]) => t && TOTEM_EFFETS[idDe(t)]);
    if (!emp) return false;
    const [main, pile] = emp, effets = TOTEM_EFFETS[idDe(pile)];
    const k = this.sac.get(pile) ?? 0;   // la pile du sac (survie) perd un objet ; la main se vide (pile de 1 : max_stack_size du totem)
    if (k > 1) this.sac.set(pile, k - 1); else if (k === 1) this.sac.delete(pile);
    if (main === 'main') this.main = { objet: null, efficacite: 0 }; else this.gauche = null;
    this.vie = 1;
    // DeathProtection.applyEffects : clear_all_effects (les vues de Cecite, Nausee, Obscurite, Vision nocturne du film s'arretent aussi), puis les effets
    for (const id of [...this.effets.keys()]) this.retirerEffet(id);
    for (const l of [sim.replay.visions, sim.replay.obscurite, sim.replay.visionNuit]) for (const v of l ?? []) if (v.acteur === this.nom && v.fin > sim.temps) v.fin = sim.temps;
    for (const [id, ticks, niveau] of effets) this.appliquerEffet(id, ticks, niveau);
    sim.son('item.totem.use', this.x, this.y, this.z, 1, 1);
    this.totemEmetteur = 30; this.tickTotem();   // ParticleEngine.createTrackingEmitter(entite, TOTEM_OF_UNDYING, 30) : une salve tout de suite
    (sim.replay.totems ??= []).push({ tick: sim.temps, acteur: this.nom, main, objet: idDe(pile) });   // le film : animation a l'ecran, objet retire de la main
    const texte = `${this.nom} : totem d'immortalite (${main === 'main' ? 'main principale' : 'main secondaire'}) contre ${source} : vie 1, Regeneration II 45 s, Absorption II 5 s, Resistance au feu 40 s`;
    sim.dire(texte);
    (sim.stats.totems ??= []).push(`${(sim.temps / 20).toFixed(2)} ${texte}`);
    return true;
  };
  // TrackingEmitter.tick : 16 essais par tick dans un quart de la boite de l'entite (le film tire les positions : film/effets-monde.js)
  P.tickTotem = function () {
    if (!(this.totemEmetteur > 0)) return;
    this.totemEmetteur--;
    this.sim.particule('totem_of_undying', this.x, this.y, this.z, this.L, this.posePlane ? 0.6 : this.accroupi ? 1.5 : this.H, 0, 16);
  };

  // degats ignores : creatif (sauf le vide), Resistance au feu (#is_fire), enchantements a damage_immunity (Marche givree sur le magma)
  P.immunise = function (source) {
    const sim = this.sim, type = typeDegats(source), oj = sim.objetsJeu;
    if (this.creatif && type !== 'out_of_world' && type !== 'generic_kill') return true;
    const feu = oj ? oj.etiquette('damage_type', 'is_fire').has(type) : /^(on_fire|in_fire|lava|hot_floor|fireball|campfire|unattributed_fireball)$/.test(type);
    if (feu && this.niveauEffet('fire_resistance') > 0) return true;
    if (oj && (this.armure || this.main.objet)) {
      for (const emp of ['main', 'gauche', ...EMP_ARMURE]) {
        const t = sim.enchant.pileEquipee(this, emp); if (!t) continue;
        for (const [id, n] of Object.entries(lirePile(t).ench)) for (const x of sim.enchant.def(id)?.effects?.['minecraft:damage_immunity'] ?? []) if (!x.requirements || sim.enchant.condition(x.requirements, n, { type, direct: estDirect(source), ceci: this })) return true;
      }
    }
    return false;
  };
  // DamageType.exhaustion du jeu (data/minecraft/damage_type) ; sans les fichiers : 0,1 sauf les types a 0 du jeu 26.3
  P.epuisementDegats = function (source) {
    const type = typeDegats(source), j = this.sim.objetsJeu?.typeDegats(type);
    if (j && typeof j.exhaustion === 'number') return Math.fround(j.exhaustion);
    return /^(cramming|dragon_breath|drown|ender_pearl|fall|fly_into_wall|freeze|generic|generic_kill|indirect_magic|in_wall|magic|on_fire|outside_border|out_of_world|sonic_boom|stalagmite|starve|wither)$/.test(type) ? 0 : Math.fround(0.1);
  };

  // ---------------------------------------------------------------- etat du joueur pour le montage (barre de vie, de faim, d'experience, d'armure,
  // d'air ; objets de la barre) : une ligne quand quelque chose change : [tick, acteur, vie, vieMax, faim, saturation, absorption, niveau, progres,
  // armure, air, objet tenu, poison/fletrissement (0 rien, 1 poison, 2 fletrissement), faimEffet (1 si Faim)]
  // cases de l'inventaire (36 au plus) : l'objet tenu en case 0 (la case choisie de la barre), puis le sac en piles de pileMax ; main infinie : 1
  P.casesSac = function () {
    const sim = this.sim, cases = [], tenu = this.main?.objet ?? null;
    if (!this.sac) return tenu ? [[tenu, 1]] : [];
    if (tenu && !(this.sac.get(tenu) > 0)) cases.push([tenu, 1]);
    for (const [k, n] of [...this.sac].sort((a, b) => (b[0] === tenu) - (a[0] === tenu))) {
      if (!(n > 0)) continue;
      if (!Number.isFinite(n)) { if (cases.length < 36) cases.push([k, 1]); continue; }
      const m = Math.max(1, pileMax(sim.d, k));
      for (let r = n; r > 0 && cases.length < 36; r -= m) cases.push([k, Math.min(m, r)]);
    }
    if (!tenu) cases.unshift(['', 0]);   // main vide : la case choisie est vide
    return cases.slice(0, 36);
  };
  P.ecrireEtat = function () {
    const sim = this.sim, arm = this.armureDu().points;
    const pois = this.effets.size ? (this.niveauEffet('wither') ? 2 : this.niveauEffet('poison') ? 1 : 0) : 0;
    const o = this.main.objet, max = o ? composants(sim.d, o).usureMax : 0;
    const l = [Math.round(this.vie * 1000) / 1000, this.vieMax, this.faim, Math.round(this.satur * 100) / 100, Math.round((this.absorption ?? 0) * 100) / 100, this.niveauXp ?? 0, Math.round((this.progresXp ?? 0) * 1000) / 1000, arm, this.air, o ?? '', pois, this.effets.size && this.niveauEffet('hunger') ? 1 : 0,
      o ? (this.infini ? 1 : this.sac.get(o) ?? 1) : 0, max ? Math.round((1 - lirePile(o).usure / max) * 1000) / 1000 : -1,   // nombre de la pile tenue, durabilite restante (barre de l'objet)
      this.casesSac().slice(1, 9).map(([p, n]) => `${p}*${n}`).join(';')];   // cases 1 a 8 de la barre (la case 0 est l'objet tenu)
    const k = l.join('|');
    if (k === this._etat) return;
    this._etat = k;
    (sim.replay.etats ??= []).push([sim.temps, this.id, ...l]);
  };

  // ---------------------------------------------------------------- fleches (Player.getProjectile, ProjectileWeaponItem.createProjectile)
  P.munition = function (pref) {
    if (pref) { const c = canon(pref); return this.infini ? c : this.pileDe(pref); }
    if (this.infini) return 'arrow';
    for (const [k, n] of this.sac) if (n > 0 && /^(arrow|tipped_arrow|spectral_arrow)$/.test(idDe(k))) return k;
    return null;
  };
  // ce que l'arme et la munition donnent a la fleche : Flamme (projectile_spawned : en feu 100 s), Perforation (projectile_piercing), effets d'une
  // fleche a effet (potion_duration_scale 0,125), fleche spectrale (Surbrillance 200 ticks), pile ramassable
  P.flecheEnchantee = function (arme, munition, { ramassable }) {
    const sim = this.sim, oj = sim.objetsJeu, m = lirePile(munition), ech = composants(sim.d, m.id).echelleDuree;
    const x = { pile: canon(munition), arme: canon(arme), ramassable, perce: 0, feuFleche: 0, effetsFleche: m.potion ? effetsPotion(m.potion, ech) : null, spectrale: m.id === 'spectral_arrow' };
    if (oj && Object.keys(lirePile(arme).ench).length) {
      x.perce = Math.trunc(sim.enchant.valeurPile(arme, 'projectile_piercing', { outil: idDe(arme) }, 0));
      for (const [id, n] of Object.entries(lirePile(arme).ench)) for (const ef of sim.enchant.def(id)?.effects?.['minecraft:projectile_spawned'] ?? []) if (court(ef.effect?.type) === 'ignite') x.feuFleche = Math.round(valeurNiveau(ef.effect.duration, n) * 20);
    }
    return x;
  };

  // ---------------------------------------------------------------- butin des creatures avec Pillage (equipment_drops de l'arme ; LootingEnchantFunction)
  P.niveauPillage = function () { return this.main.objet ? lirePile(this.main.objet).ench.looting ?? 0 : 0; };
  void SLOT_JEU;
}
