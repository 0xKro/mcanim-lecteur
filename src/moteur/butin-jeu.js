// Tables de butin du jeu LUES TELLES QUELLES dans le kit (data/minecraft/loot_table/gameplay/*.json) : la peche (fishing, fish, junk, treasure).
// LootTable.getRandomItems : pools (rolls nombre ou uniforme, bonus_rolls x chance), entrees ponderees (weight + quality x chance, plancher 0 ;
// une seule entree : sans tirage), entrees `loot_table` (table imbriquee), `item` ; conditions entity_properties (bouchon en eau libre),
// location_check (biome), random_chance, inverted / any_of / all_of ; fonctions set_count, set_damage (part de durabilite restante), set_potion,
// enchant_with_levels (EnchantmentHelper.enchantItem : les enchantements de la table d'enchantement, livre -> livre enchante), enchant_randomly.
// Port de Horizon horizon-world/src/loot (MIT, voir ATTRIBUTIONS.md).
import { textePile } from './pile.js';

const court = (s) => String(s ?? '').replace(/^minecraft:/, '');
const nombre = (v, h) => (typeof v === 'number' ? v : v && court(v.type) === 'uniform' ? v.min + h.flottant() * (v.max - v.min) : v && court(v.type) === 'binomial' ? (() => { let k = 0; for (let i = 0; i < v.n; i++) if (h.flottant() < v.p) k++; return k; })() : v?.value ?? 1);
const entier = (v, h) => (typeof v === 'number' ? Math.floor(v) : v && court(v.type) === 'uniform' ? v.min + h.entierBorne(Math.floor(v.max) - Math.ceil(v.min) + 1) : Math.floor(nombre(v, h)));

// ctx : { sim, hasard, chance (luck), eauLibre, biome }
export function tirerTable(oj, nom, ctx) {
  const t = oj.butin(nom);
  if (!t) return [];
  const out = [];
  for (const p of t.pools ?? []) {
    if (!conditions(p.conditions ?? p.condition, ctx)) continue;
    const n = entier(p.rolls, ctx.hasard) + Math.floor(nombre(p.bonus_rolls ?? 0, ctx.hasard) * (ctx.chance ?? 0));
    for (let i = 0; i < n; i++) tirerPool(oj, p, ctx, out);
  }
  return out;
}
function tirerPool(oj, p, ctx, out) {
  const h = ctx.hasard, valides = [];
  let total = 0;
  for (const e of p.entries ?? []) {
    if (!conditions(e.conditions ?? e.condition, ctx)) continue;
    const w = Math.max(0, Math.floor((e.weight ?? 1) + (e.quality ?? 0) * (ctx.chance ?? 0)));   // LootPoolSingletonContainer.getWeight
    if (w <= 0) continue;
    valides.push([e, w]); total += w;
  }
  if (!valides.length || total === 0) return;
  let choisie = valides[0][0];
  if (valides.length > 1) { let j = h.entierBorne(total); for (const [e, w] of valides) { j -= w; if (j < 0) { choisie = e; break; } } }
  const t = court(choisie.type);
  if (t === 'loot_table') { out.push(...tirerTable(oj, court(choisie.value ?? choisie.name), ctx)); return; }
  if (t !== 'item') return;
  const pile = { id: court(choisie.name), ench: {}, potion: null, usure: 0, travail: 0, n: 1 };
  for (const f of [].concat(choisie.functions ?? choisie.modifier ?? [])) fonction(oj, f, pile, ctx);
  for (const f of [].concat(p.functions ?? p.modifier ?? [])) fonction(oj, f, pile, ctx);
  if (pile.n > 0) out.push([textePile(pile), pile.n]);
}
function fonction(oj, f, pile, ctx) {
  if (!conditions(f.conditions ?? f.condition, ctx)) return;
  const h = ctx.hasard, t = court(f.type), d = ctx.sim.d;
  if (t === 'set_count') pile.n = f.add ? pile.n + entier(f.count, h) : entier(f.count, h);
  else if (t === 'set_damage') { const max = d.j.objets?.[pile.id]?.[0] ?? 0; if (max) { const r = Math.min(1, Math.max(0, Math.fround(nombre(f.damage, h)) + (f.add ? 1 - pile.usure / max : 0))); pile.usure = Math.floor(Math.fround((1 - r)) * max); } }   // SetItemDamageFunction : usure = floor((1 - part) x max)
  else if (t === 'set_potion') pile.potion = court(f.id);
  else if (t === 'enchant_with_levels') {
    const niveau = entier(f.levels, h), sel = ctx.sim.enchant.selectionOptions(h, pile.id, niveau, f.options ?? '#minecraft:on_random_loot');
    if (pile.id === 'book') pile.id = 'enchanted_book';
    for (const [id, n] of sel) pile.ench[id] = n;
  } else if (t === 'enchant_randomly') {
    const ids = ctx.sim.enchant.optionsEnchant(f.options).filter((e) => pile.id === 'book' || oj.objetDans(oj.enchantement(e)?.supported_items, pile.id));
    if (ids.length) { const id = ids[h.entierBorne(ids.length)], e = oj.enchantement(id); pile.ench[id] = 1 + h.entierBorne(e.max_level); if (pile.id === 'book') pile.id = 'enchanted_book'; }
  }
}
function conditions(c, ctx) {
  if (!c) return true;
  if (Array.isArray(c)) return c.every((x) => conditions(x, ctx));
  const t = court(c.condition ?? c.type);
  switch (t) {
    case 'inverted': return !conditions(c.term, ctx);
    case 'any_of': return (c.terms ?? []).some((x) => conditions(x, ctx));
    case 'all_of': return (c.terms ?? []).every((x) => conditions(x, ctx));
    case 'random_chance': return ctx.hasard.flottant() < (typeof c.chance === 'number' ? c.chance : 1);
    case 'entity_properties': { const fh = c.predicate?.['minecraft:type_specific/fishing_hook'] ?? c.predicate?.type_specific; if (fh && fh.in_open_water !== undefined) return !!ctx.eauLibre === fh.in_open_water; return true; }
    case 'location_check': { const b = c.predicate?.biomes ?? c.predicate?.biome; if (!b) return true; const l = Array.isArray(b) ? b : [b]; return l.some((x) => (String(x).startsWith('#') ? false : court(x) === court(ctx.biome))); }
    default: return true;
  }
}
