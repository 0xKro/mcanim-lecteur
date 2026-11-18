// Les potions du jeu (registre `Potions`, du CODE dans le jeu : pas de fichier de donnees) : effets, durees en ticks, niveaux ; couleurs des effets
// (MobEffect.getColor) et melange de couleur d'une potion (PotionContents.getColor). Recopie de la table de Horizon
// horizon-client-core/src/potions.rs (MIT, voir ATTRIBUTIONS.md), elle-meme tiree de Potions.java du jeu 26.3.
// Les RECETTES de l'alambic, elles, sont des fichiers du jeu (data/minecraft/recipe/brewing/*.json) lus dans le kit (moteur/alambic.js).
const p = (effets) => effets;
export const POTIONS = {
  water: p([]), mundane: p([]), thick: p([]), awkward: p([]),
  night_vision: p([['night_vision', 3600, 0]]), long_night_vision: p([['night_vision', 9600, 0]]),
  invisibility: p([['invisibility', 3600, 0]]), long_invisibility: p([['invisibility', 9600, 0]]),
  leaping: p([['jump_boost', 3600, 0]]), long_leaping: p([['jump_boost', 9600, 0]]), strong_leaping: p([['jump_boost', 1800, 1]]),
  fire_resistance: p([['fire_resistance', 3600, 0]]), long_fire_resistance: p([['fire_resistance', 9600, 0]]),
  swiftness: p([['speed', 3600, 0]]), long_swiftness: p([['speed', 9600, 0]]), strong_swiftness: p([['speed', 1800, 1]]),
  slowness: p([['slowness', 1800, 0]]), long_slowness: p([['slowness', 4800, 0]]), strong_slowness: p([['slowness', 400, 3]]),
  turtle_master: p([['slowness', 400, 3], ['resistance', 400, 2]]), long_turtle_master: p([['slowness', 800, 3], ['resistance', 800, 2]]), strong_turtle_master: p([['slowness', 400, 5], ['resistance', 400, 3]]),
  water_breathing: p([['water_breathing', 3600, 0]]), long_water_breathing: p([['water_breathing', 9600, 0]]),
  healing: p([['instant_health', 1, 0]]), strong_healing: p([['instant_health', 1, 1]]),
  harming: p([['instant_damage', 1, 0]]), strong_harming: p([['instant_damage', 1, 1]]),
  poison: p([['poison', 900, 0]]), long_poison: p([['poison', 1800, 0]]), strong_poison: p([['poison', 432, 1]]),
  regeneration: p([['regeneration', 900, 0]]), long_regeneration: p([['regeneration', 1800, 0]]), strong_regeneration: p([['regeneration', 450, 1]]),
  strength: p([['strength', 3600, 0]]), long_strength: p([['strength', 9600, 0]]), strong_strength: p([['strength', 1800, 1]]),
  weakness: p([['weakness', 1800, 0]]), long_weakness: p([['weakness', 4800, 0]]),
  luck: p([['luck', 6000, 0]]),
  slow_falling: p([['slow_falling', 1800, 0]]), long_slow_falling: p([['slow_falling', 4800, 0]]),
  wind_charged: p([['wind_charged', 3600, 0]]), weaving: p([['weaving', 3600, 0]]), oozing: p([['oozing', 3600, 0]]), infested: p([['infested', 3600, 0]]),
};
// MobEffect.getColor (0xRRGGBB) et effets instantanes
export const COULEUR_EFFET = {
  speed: 3402751, slowness: 9154528, haste: 14270531, mining_fatigue: 4866583, strength: 16762624, instant_health: 16262179, instant_damage: 11101546, jump_boost: 16646020,
  nausea: 5578058, regeneration: 13458603, resistance: 9520880, fire_resistance: 16750848, water_breathing: 10017472, invisibility: 16185078, blindness: 2039587,
  night_vision: 12779366, hunger: 5797459, weakness: 4738376, poison: 8889187, wither: 7561558, health_boost: 16284963, absorption: 2445989, saturation: 16262179,
  glowing: 9740385, levitation: 13565951, luck: 5882118, unluck: 12624973, slow_falling: 15978425, conduit_power: 1950417, dolphins_grace: 8954814, bad_omen: 745784,
  hero_of_the_village: 4521796, darkness: 2696993, trial_omen: 1484454, raid_omen: 14565464, wind_charged: 12438015, weaving: 7891290, oozing: 10092451, infested: 9214860,
  breath_of_the_nautilus: 65518,
};
export const INSTANTANES = new Set(['instant_health', 'instant_damage', 'saturation']);
export const COULEUR_BASE = 0x385DC6;   // PotionContents.BASE_POTION_COLOR
// PotionContents.getColor : melange pondere par (niveau + 1), divisions entieres par canal
export function couleurPotion(effets) {
  let r = 0, g = 0, b = 0, t = 0;
  for (const [id, , amp] of effets) { const c = COULEUR_EFFET[id]; if (c === undefined) continue; const w = amp + 1; r += w * ((c >> 16) & 255); g += w * ((c >> 8) & 255); b += w * (c & 255); t += w; }
  return t ? (Math.floor(r / t) << 16) | (Math.floor(g / t) << 8) | Math.floor(b / t) : COULEUR_BASE;
}
// effets d'une pile (potion, potion jetee, persistante, fleche a effet) : [[effet, ticks, niveau]] mis a l'echelle (potion_duration_scale : persistante
// 0,25, fleche 0,125 ; les instantanes gardent 1 tick) ; inconnue : []
export function effetsPotion(potion, echelle = 1) {
  const l = POTIONS[String(potion ?? '').replace(/^minecraft:/, '')] ?? [];
  return l.map(([id, t, a]) => [id, Math.max(1, Math.floor(Math.fround(t * echelle))), a]);   // MobEffectInstance.withScaledDuration : max(floor(t x echelle), 1)
}
