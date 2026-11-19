// Attributs du jeu (AttributeInstance du jeu 26.3, docs/SIMULATION.md partie 33) : UNE valeur par attribut et par acteur, calculee comme
// AttributeInstance.calculateValue : la base du type, + les modificateurs `add_value`, puis + base x chaque `add_multiplied_base`, puis
// x (1 + a) pour chaque `add_multiplied_total`, bornee par RangedAttribute (min, max) ; NaN -> min.
// Les modificateurs viennent de :
//   - l'equipement porte (attribute_modifiers des objets du jeu, emplacement qui correspond : armure des quatre pieces, arme en main) ;
//   - les enchantements de l'equipement (effet `minecraft:attributes`, EnchantmentHelper.forEachModifier : un modificateur par emplacement) ;
//   - Agilite des ames (effet `attribute` de location_changed, tant que sa condition tient : inventaire.js tickEquipement) ;
//   - les effets de potion (MobEffect.addAttributeModifier : montant x (amplificateur + 1)).
// Nombres LUS (aucun de memoire) : defauts et bornes, valeurs des types : `attributes.json` du jeu 26.3 (dossier prepare du lanceur) ;
// montants des objets : `items.json` (nos tables `objets`, outils/extraire-donnees-jeu.mjs) ; enchantements : data/minecraft/enchantment du kit ;
// effets : Horizon horizon-client-render/src/effects.rs `effect_modifier` et mobs/finalize.rs `compute` (MIT, voir ATTRIBUTIONS.md).
import { composants, idArmure, EMP_ARMURE } from './inventaire.js';
import { valeurNiveau, EMPLACEMENTS } from './enchantements.js';
import { lirePile, idDe } from './pile.js';

const court = (s) => String(s ?? '').replace(/^minecraft:/, '');
const F = Math.fround;

// [defaut, min, max] (attributes.json du jeu 26.3, doubles du jeu)
export const ATTRIBUTS = {
  air_drag_modifier: [1, 0, 2048], armor: [0, 0, 30], armor_toughness: [0, 0, 20], attack_damage: [2, 0, 2048], attack_knockback: [0, 0, 5],
  attack_speed: [4, 0, 1024], block_break_speed: [1, 0, 1024], block_interaction_range: [4.5, 0, 64], bounciness: [0, 0, 1], burning_time: [1, 0, 1024],
  explosion_knockback_resistance: [0, 0, 1], entity_interaction_range: [3, 0, 64], fall_damage_multiplier: [1, 0, 100], flying_speed: [0.4, 0, 1024],
  follow_range: [32, 0, 2048], friction_modifier: [1, 0, 2048], gravity: [0.08, -1, 1], jump_strength: [0.41999998688697815, 0, 32],
  knockback_resistance: [0, -2, 1], luck: [0, -1024, 1024], max_absorption: [0, 0, 2048], max_health: [20, 1, 1024], mining_efficiency: [0, 0, 1024],
  movement_efficiency: [0, 0, 1], movement_speed: [0.7, 0, 1024], oxygen_bonus: [0, 0, 1024], safe_fall_distance: [3, -1024, 1024], scale: [1, 0.0625, 16],
  sneaking_speed: [0.3, 0, 1], step_height: [0.6, 0, 10], submerged_mining_speed: [0.2, 0, 20], sweeping_damage_ratio: [0, 0, 1],
  water_movement_efficiency: [0, 0, 1],
};
// valeurs des types qui different du defaut (attributes.json, `entities`) pour les attributs que le moteur lit ; `joueur` : minecraft:player.
// (movement_speed, max_health, follow_range, attack_damage des mobs : les profils d'ia.js et les gabarits du film les portent deja.)
export const BASES = {
  joueur: { attack_damage: 1 },
  hoglin: { attack_knockback: 1, knockback_resistance: 0.6000000238418579 }, zoglin: { attack_knockback: 1, knockback_resistance: 0.6000000238418579 },
  iron_golem: { knockback_resistance: 1, step_height: 1 }, ravager: { attack_knockback: 1.5, knockback_resistance: 0.75, step_height: 1 },
  warden: { attack_knockback: 1.5, knockback_resistance: 1 },
  nautilus: { knockback_resistance: 0.30000001192092896 }, zombie_nautilus: { knockback_resistance: 0.30000001192092896 },
  zombie: { armor: 2 }, husk: { armor: 2 }, drowned: { armor: 2, step_height: 1 }, zombie_villager: { armor: 2 }, zombified_piglin: { armor: 2 }, wither: { armor: 4 },
  camel: { fall_damage_multiplier: 0.5, safe_fall_distance: 6, step_height: 1.5 }, camel_husk: { fall_damage_multiplier: 0.5, safe_fall_distance: 6, step_height: 1.5 },
  horse: { fall_damage_multiplier: 0.5, safe_fall_distance: 6, step_height: 1 }, donkey: { fall_damage_multiplier: 0.5, safe_fall_distance: 6, step_height: 1 },
  mule: { fall_damage_multiplier: 0.5, safe_fall_distance: 6, step_height: 1 }, llama: { fall_damage_multiplier: 0.5, safe_fall_distance: 6, step_height: 1 },
  trader_llama: { fall_damage_multiplier: 0.5, safe_fall_distance: 6, step_height: 1 }, skeleton_horse: { fall_damage_multiplier: 0.5, safe_fall_distance: 6, step_height: 1 },
  zombie_horse: { fall_damage_multiplier: 0.5, safe_fall_distance: 6, step_height: 1 }, fox: { safe_fall_distance: 5 },
};
// MobEffect.addAttributeModifier (montant au niveau 1 ; les flottants du jeu elargis en double) : [attribut, montant, operation]
export const EFFETS_ATTRIBUTS = {
  speed: ['movement_speed', F(0.2), 'add_multiplied_total'], slowness: ['movement_speed', F(-0.15), 'add_multiplied_total'],
  haste: ['attack_speed', F(0.1), 'add_multiplied_total'], mining_fatigue: ['attack_speed', F(-0.1), 'add_multiplied_total'],
  strength: ['attack_damage', 3, 'add_value'], weakness: ['attack_damage', -4, 'add_value'], jump_boost: ['safe_fall_distance', 1, 'add_value'],
  health_boost: ['max_health', 4, 'add_value'], absorption: ['max_absorption', 4, 'add_value'], luck: ['luck', 1, 'add_value'], unluck: ['luck', -1, 'add_value'],
};
// attack_speed des lances : nos tables `objets` gardent 6 decimales, qui ne suffisent pas a retrouver le flottant du jeu pour elles seules
// (items.json du jeu 26.3, doubles exacts) ; pour tous les autres objets, Math.fround(valeur de la table) est la valeur du jeu (verifie en test)
const VITESSE_EXACTE = {
  copper_spear: -2.8235294818878174, diamond_spear: -3.0476189851760864, golden_spear: -2.9473683834075928, iron_spear: -2.9473683834075928,
  netherite_spear: -3.13043475151062, stone_spear: -2.666666626930237, wooden_spear: -2.4615384340286255,
};

// la base d'un attribut pour cet acteur (type du jeu ; `joueur` sans type)
export function baseAttribut(a, nom) {
  const t = a.typeCreature ?? 'joueur';
  if (nom === 'armor' && a.persoDef?.attributs?.armure !== undefined) return a.persoDef.attributs.armure;   // entite de mod : attribut armor remplace
  return BASES[t]?.[nom] ?? ATTRIBUTS[nom]?.[0] ?? 0;
}

// les modificateurs de l'acteur pour cet attribut : [[montant, operation, origine], ...] (origine : pour le journal et les essais)
export function modificateurs(a, nom) {
  const out = [], sim = a.sim, d = sim?.d;
  // equipement : armure (tete, torse, jambes, pieds : leur emplacement) ; arme en main principale
  if (a.armure && d && (nom === 'armor' || nom === 'armor_toughness' || nom === 'knockback_resistance')) {
    for (const e of EMP_ARMURE) {
      const t = a.armure[e]; if (!t) continue;
      const c = composants(d, idArmure(d, t, e));
      const v = nom === 'armor' ? c.armure : nom === 'armor_toughness' ? c.robustesse : F(c.antiRecul);   // montants flottants du jeu (0,1F)
      if (v) out.push([v, 'add_value', `${e} ${idDe(t)}`]);
    }
  }
  const arme = a.main?.objet;
  if (arme && d && (nom === 'attack_damage' || nom === 'attack_speed')) {
    const c = composants(d, arme), id = idDe(arme);
    const v = nom === 'attack_damage' ? c.attaque : VITESSE_EXACTE[id] ?? F(c.vitesse);
    if (v) out.push([v, 'add_value', `main ${id}`]);
  }
  // enchantements de l'equipement
  if (sim?.objetsJeu && (a.armure || a.main?.objet || a.gauche)) {
    for (const [emp, slot] of Object.entries(EMPLACEMENTS)) {
      const t = sim.enchant.pileEquipee(a, emp); if (!t) continue;
      for (const [id, n] of Object.entries(lirePile(t).ench)) {
        const e = sim.enchant.def(id);
        if (!e || !dansGroupe(e.slots, slot)) continue;
        for (const x of e.effects?.['minecraft:attributes'] ?? []) if (court(x.attribute) === nom) out.push([valeurNiveau(x.amount, n), x.operation ?? 'add_value', `${id} ${n} (${emp})`]);
      }
    }
  }
  // joueur en creatif : portees du mode (Horizon hand.rs interaction_range : entites 3 -> 5, blocs 4,5 -> 5)
  if (a.creatif && !a.typeCreature && nom === 'entity_interaction_range') out.push([2, 'add_value', 'creatif']);
  if (a.creatif && !a.typeCreature && nom === 'block_interaction_range') out.push([0.5, 'add_value', 'creatif']);
  // ancien champ d'acteur `protectionExplosion` (somme des niveaux de Protection contre les explosions) : 0,15 par niveau
  if (nom === 'explosion_knockback_resistance' && a.protectionExplosion > 0) out.push([0.15 * a.protectionExplosion, 'add_value', 'champ protectionExplosion']);
  // Agilite des ames (location_changed) : ses attributs tant que la condition tient
  for (const [att, v, op] of a.attributsLieu ?? []) if (att === nom) out.push([v, op, 'soul_speed']);
  // effets de potion
  if (a.effets?.size) {
    for (const [id, [att, v, op]] of Object.entries(EFFETS_ATTRIBUTS)) {
      if (att !== nom) continue;
      const n = a.niveauEffet(id);
      if (n > 0) out.push([v * n, op, `${id} ${n}`]);
    }
  }
  return out;
}
const GROUPES = { mainhand: ['mainhand'], offhand: ['offhand'], hand: ['mainhand', 'offhand'], head: ['head'], chest: ['chest'], legs: ['legs'], feet: ['feet'], armor: ['head', 'chest', 'legs', 'feet'], body: ['body'], saddle: ['saddle'] };
const dansGroupe = (groupes, slot) => (groupes ?? ['any']).some((g) => g === 'any' || (GROUPES[g] ?? []).includes(slot));

// AttributeInstance.calculateValue
export function calculer(nom, base, mods) {
  let b = base;
  for (const [v, op] of mods) if (op === 'add_value') b += v;
  let r = b;
  for (const [v, op] of mods) if (op === 'add_multiplied_base') r += b * v;
  for (const [v, op] of mods) if (op === 'add_multiplied_total') r *= 1 + v;
  const [, min, max] = ATTRIBUTS[nom] ?? [0, -Infinity, Infinity];
  return Number.isNaN(r) ? min : Math.max(min, Math.min(max, r));
}
// getAttributeValue(nom) ; `base` : une base donnee par l'appelant (profil d'un mob, regle de la scene)
export function valeurAttribut(a, nom, base = baseAttribut(a, nom)) { return calculer(nom, base, modificateurs(a, nom)); }
