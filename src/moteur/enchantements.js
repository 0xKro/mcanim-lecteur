// Enchantements du jeu (docs/SIMULATION.md partie 26) : LUS dans les fichiers du jeu (data/minecraft/enchantment/*.json du kit) et INTERPRETES comme le
// jeu : composants de valeur (damage, knockback, damage_protection, item_damage, ammo_use, projectile_count...), conditions (damage_source_properties,
// entity_properties, match_tool, random_chance, weather_check, location_check...), effets d'entite (ignite, apply_mob_effect, damage_entity,
// change_item_damage, summon_entity, play_sound, explode, replace_disk, attribute), attributs (oxygen_bonus, water_movement_efficiency,
// mining_efficiency...). Table d'enchantement (EnchantmentHelper.getEnchantmentCost / selectEnchantment, etageres de EnchantingTableBlock) et enclume
// (AnvilMenu.createResult). Port de Horizon horizon-items/src/enchant.rs et game/enchant_effects.rs (MIT, voir ATTRIBUTIONS.md).
import { lirePile, textePile } from './pile.js';
import { ErreurMonde } from './erreurs.js';

const court = (s) => String(s ?? '').replace(/^minecraft:/, '');
// emplacements d'equipement d'un acteur et groupes d'emplacements du jeu (EquipmentSlotGroup)
export const EMPLACEMENTS = { main: 'mainhand', gauche: 'offhand', tete: 'head', torse: 'chest', jambes: 'legs', pieds: 'feet' };
const GROUPES = { any: null, mainhand: ['mainhand'], offhand: ['offhand'], hand: ['mainhand', 'offhand'], head: ['head'], chest: ['chest'], legs: ['legs'], feet: ['feet'], armor: ['head', 'chest', 'legs', 'feet'], body: ['body'], saddle: ['saddle'] };
const dansGroupe = (groupes, slot) => (groupes ?? ['any']).some((g) => g === 'any' || (GROUPES[g] ?? []).includes(slot));

// Nos sources de degats -> type de degats du jeu (data/minecraft/damage_type) : les etiquettes (#is_fire, #is_projectile, #bypasses_armor...) s'y lisent
export function typeDegats(source) {
  const s = String(source ?? 'generique');
  if (s.startsWith('joueur:')) return 'player_attack';
  const T = {
    fleche: 'arrow', trident: 'trident', chute: 'fall', feu: 'on_fire', flamme: 'in_fire', lave: 'lava', noyade: 'drown', poison: 'magic', magie: 'magic', magie_indirecte: 'indirect_magic', crane_wither: 'wither_skull',
    fletrissement: 'wither', foudre: 'lightning_bolt', boule_feu: 'fireball', petite_boule_feu: 'fireball', perle: 'ender_pearl', mur: 'fly_into_wall',
    fusee: 'fireworks', cactus: 'cactus', epines: 'thorns', faim: 'starve', sonic_boom: 'sonic_boom', piqure: 'sting', generique: 'generic', cramming: 'cramming',
    souffle_dragon: 'dragon_breath', vent: 'wind_charge', masse: 'mace_smash', boule: 'thrown', oeuf: 'thrown', crane: 'wither_skull', magma: 'hot_floor',
    baie: 'sweet_berry_bush', gel: 'freeze', vide: 'out_of_world', baton: 'player_attack', eau: 'drown', explosion: 'explosion',
  };
  if (T[s]) return T[s];
  if (/^explosion/.test(s)) return s === 'explosion_joueur' ? 'player_explosion' : 'explosion';
  return 'mob_attack';
}
export const estDirect = (source) => !/^(fleche|trident|boule|oeuf|perle|fusee|petite_boule_feu|boule_feu|crane|vent|potion)/.test(String(source ?? ''));

// LevelBasedValue.calculate (Horizon enchant.rs level_value)
export function valeurNiveau(v, n) {
  if (typeof v === 'number') return v;
  if (!v || typeof v !== 'object') return 0;
  const f = (k) => (typeof v[k] === 'number' ? v[k] : 0);
  switch (court(v.type)) {
    case 'linear': return Math.fround(f('base') + f('per_level_above_first') * (n - 1));
    case 'levels_squared': return n * n + f('added');
    case 'clamped': return Math.min(f('max'), Math.max(f('min'), valeurNiveau(v.value, n)));
    case 'fraction': { const d = valeurNiveau(v.denominator, n); return d === 0 ? 0 : Math.fround(valeurNiveau(v.numerator, n) / d); }
    case 'exponent': return Math.pow(valeurNiveau(v.base, n), valeurNiveau(v.power, n));
    case 'lookup': return Array.isArray(v.values) && v.values[n - 1] !== undefined ? v.values[n - 1] : valeurNiveau(v.fallback, n);
    default: return f('value');
  }
}
// EnchantmentValueEffect.process
export function appliquerValeur(effet, n, hasard, v) {
  switch (court(effet?.type)) {
    case 'add': return v + valeurNiveau(effet.value, n);
    case 'multiply': return v * valeurNiveau(effet.factor, n);
    case 'set': return valeurNiveau(effet.value, n);
    case 'remove_binomial': {
      const p = valeurNiveau(effet.chance, n);
      let retire = 0;
      if (v > 128 && v * p >= 20 && v * (1 - p) >= 20) retire = Math.max(0, Math.min(v, Math.round(Math.floor(v * p) + hasard.gaussien() * Math.sqrt(v * p * (1 - p)))));
      else for (let i = 0; i < v; i++) if (hasard.flottant() < p) retire++;
      return v - retire;
    }
    case 'all_of': return (effet.effects ?? []).reduce((x, e) => appliquerValeur(e, n, hasard, x), v);
    default: return v;
  }
}

export class Enchanteur {
  constructor(sim) { this.sim = sim; }
  get oj() {
    const o = this.sim.objetsJeu;
    if (!o) throw new ErreurMonde('enchantements : donnees du jeu absentes (groupe de kit "recettes" : relance sans MCANIM_KIT, ou MCANIM_OBJETS_JEU=<dossier qui contient data/minecraft>)');
    return o;
  }
  def(id) { return this.oj.enchantement(id); }
  niveau(pileTexte, id) { return pileTexte ? lirePile(pileTexte).ench[court(id)] ?? 0 : 0; }

  // ---------------------------------------------------------------- conditions (le sous-ensemble des predicats que les enchantements utilisent)
  // ctx : { type (degats du jeu), direct, ceci (acteur ou entite), attaquant, directAttaquant (type d'entite du jeu : 'trident', 'arrow'...),
  //         outil (id d'objet), actif (enchantment_active_check) }
  condition(c, n, ctx) {
    if (typeof c === 'string') { const p = this.oj.predicat(c); return p ? this.condition(p, n, ctx) : false; }
    const sim = this.sim, oj = this.oj;
    switch (court(c?.type ?? c?.condition)) {
      case 'inverted': return !this.condition(c.term, n, ctx);
      case 'all_of': return (c.terms ?? []).every((t) => this.condition(t, n, ctx));
      case 'any_of': return (c.terms ?? []).some((t) => this.condition(t, n, ctx));
      case 'random_chance': { const ch = c.chance; const p = typeof ch === 'number' ? ch : court(ch?.type) === 'enchantment_level' ? valeurNiveau(ch.amount, n) : valeurNiveau(ch, n); return sim.hasard.flottant() < p; }
      case 'match_tool': {
        if (!ctx.outil) return false;
        const p = c.predicate ?? {};
        if (p.items !== undefined && !oj.objetDans(p.items, court(ctx.outil))) return false;
        return true;
      }
      case 'damage_source_properties': {
        const p = c.predicate ?? {};
        if (p.is_direct !== undefined && p.is_direct !== !!ctx.direct) return false;
        return (p.tags ?? []).every((t) => oj.etiquette('damage_type', t.id).has(ctx.type ?? 'generic') === (t.expected !== false));
      }
      case 'entity_properties': {
        const qui = c.entity ?? 'this';
        const e = qui === 'this' ? ctx.ceci : qui === 'attacker' ? ctx.attaquant : qui === 'direct_attacker' ? ctx.directAttaquant : null;
        return this.entiteVerifie(c.predicate ?? {}, e, ctx);
      }
      case 'weather_check': {
        const m = sim.meteo?.niveaux?.(sim.temps) ?? { pluie: 0, orage: 0 };
        if (c.raining !== undefined && (m.pluie > 0.2) !== c.raining) return false;
        if (c.thundering !== undefined && (m.orage > 0.9) !== c.thundering) return false;
        return true;
      }
      case 'location_check': {
        const p = c.predicate ?? {}, pos = ctx.position;
        if (!pos) return false;
        const [x, y, z] = pos.map(Math.floor);
        if (p.can_see_sky !== undefined && this.voitCiel(x, y, z) !== p.can_see_sky) return false;
        if (p.block?.blocks) { const e = sim.monde.etatEn(x, y, z); const nom = e >= 0 ? sim.d.nomBloc(e) : ''; const b = String(p.block.blocks); if (b.startsWith('#') ? !sim.d.etiquette(b).has(sim.d.idBloc(nom)) : court(b) !== nom) return false; }
        return true;
      }
      case 'enchantment_active_check': return !!ctx.actif === !!c.active;
      default: return false;
    }
  }
  voitCiel(x, y, z) { const l = this.sim.api?.lumiere?.(x, y + 1, z); return l ? l.ciel >= 15 : true; }
  // EntityPredicate : type (etiquette ou nom), drapeaux, chute, lieu (ciel), vehicule
  entiteVerifie(p, e, ctx) {
    if (e === null || e === undefined) return false;
    const type = typeof e === 'string' ? e : e.typeCreature ?? 'player';
    const spec = p['minecraft:entity_type'] ?? p.type;
    if (spec !== undefined) {
      const ok = (s) => (String(s).startsWith('#') ? this.oj.etiquette('entity_type', s.slice(1)).has(type) : court(s) === type);
      if (!(Array.isArray(spec) ? spec.some(ok) : ok(spec))) return false;
    }
    const fl = p['minecraft:flags'];
    if (fl && typeof fl === 'object' && typeof e === 'object') {
      if (fl.is_on_ground !== undefined && !!e.auSol !== fl.is_on_ground) return false;
      if (fl.is_flying !== undefined && !!e.planeur !== fl.is_flying) return false;
    }
    const mv = p['minecraft:movement'];
    if (mv?.fall_distance !== undefined) {
      if (typeof e !== 'object') return false;
      const d = e.distanceChute ?? 0, b = mv.fall_distance;
      if (typeof b === 'number' ? d !== b : (b.min !== undefined && d < b.min) || (b.max !== undefined && d > b.max)) return false;
    }
    if (p['minecraft:location']?.can_see_sky !== undefined && typeof e === 'object') { if (this.voitCiel(Math.floor(e.x), Math.floor(e.y + (e.H ?? 0) - 0.01), Math.floor(e.z)) !== p['minecraft:location'].can_see_sky) return false; }
    if (p['minecraft:vehicle'] !== undefined && typeof e === 'object' && !e.monture) return false;
    // bloc qui agit sur le mouvement (sous les pieds, Entity.getBlockPosBelowThatAffectsMyMovement : 0,5 sous les pieds)
    const ma = p['minecraft:movement_affected_by'];
    if (ma && typeof e === 'object') {
      const sim = this.sim, et = sim.monde.etatEn(Math.floor(e.x), Math.floor(e.y - 0.5000001), Math.floor(e.z));
      if (et < 0) return false;
      const b = ma.block?.blocks;
      if (b) { const s = String(b); if (s.startsWith('#') ? !sim.d.etiquette(s).has(sim.d.blocDe(et)) : court(s) !== sim.d.nomBloc(et)) return false; }
    }
    if (typeof p['minecraft:periodic_tick'] === 'number' && typeof e === 'object' && (this.sim.temps % p['minecraft:periodic_tick']) !== 0) return false;
    const hs = p['minecraft:movement']?.horizontal_speed;
    if (hs && typeof e === 'object') { const v = Math.hypot(e.vx ?? 0, e.vz ?? 0) * 20; if ((hs.min !== undefined && v < hs.min) || (hs.max !== undefined && v > hs.max)) return false; }
    return true;
  }

  // ---------------------------------------------------------------- composants de valeur
  // une pile : EnchantmentHelper (modifyDamage, modifyKnockback...) ; `comp` : 'damage', 'knockback'... ; rend la nouvelle valeur
  valeurPile(texte, comp, ctx, v) {
    if (!texte) return v;
    const p = lirePile(texte);
    for (const [id, n] of Object.entries(p.ench)) v = this.valeurEnch(id, n, comp, { ...ctx, outil: ctx.outil ?? p.id }, v);
    return v;
  }
  valeurEnch(id, n, comp, ctx, v) {
    const e = this.def(id);
    const l = e?.effects?.['minecraft:' + comp];
    if (!l) return v;
    if (!Array.isArray(l)) return appliquerValeur(l, n, this.sim.hasard, v);   // composants a effet unique (crossbow_charge_time, trident_spin_attack_strength)
    for (const x of l) {
      if (x.requirements && !this.condition(x.requirements, n, ctx)) continue;
      v = appliquerValeur(x.effect, n, this.sim.hasard, v);
    }
    return v;
  }
  // tout l'equipement d'un acteur, emplacement par emplacement (EnchantmentHelper.runIterationOnEquipment) : damage_protection, equipment_drops...
  valeurEquipement(a, comp, ctx, v) {
    for (const [emp, slot] of Object.entries(EMPLACEMENTS)) {
      const t = this.pileEquipee(a, emp);
      if (!t) continue;
      const p = lirePile(t);
      for (const [id, n] of Object.entries(p.ench)) { const e = this.def(id); if (e && dansGroupe(e.slots, slot)) v = this.valeurEnch(id, n, comp, { ...ctx, outil: p.id }, v); }
    }
    return v;
  }
  pileEquipee(a, emp) { return emp === 'main' ? a.main?.objet ?? null : emp === 'gauche' ? a.gauche ?? null : a.armure?.[emp] ?? null; }
  // somme des attributs `add_value` des enchantements de l'equipement (oxygen_bonus, water_movement_efficiency, mining_efficiency, sneaking_speed...)
  attribut(a, nom, operation = 'add_value') {
    let s = 0;
    for (const [emp, slot] of Object.entries(EMPLACEMENTS)) {
      const t = this.pileEquipee(a, emp);
      if (!t) continue;
      for (const [id, n] of Object.entries(lirePile(t).ench)) {
        const e = this.def(id);
        if (!e || !dansGroupe(e.slots, slot)) continue;
        for (const x of e.effects?.['minecraft:attributes'] ?? []) if (court(x.attribute) === nom && (x.operation ?? 'add_value') === operation) s += valeurNiveau(x.amount, n);
      }
    }
    return s;
  }
  aComposant(texte, comp) { if (!texte) return false; return Object.keys(lirePile(texte).ench).some((id) => !!this.def(id)?.effects?.['minecraft:' + comp]); }

  // ---------------------------------------------------------------- effets d'entite
  // composant `post_attack` (EnchantmentHelper.doPostAttackEffects) : les enchantements de l'arme (enchanted = attacker) et de l'armure de la victime
  // (enchanted = victim) ; `affected` : qui recoit l'effet. ctx : { type, direct, directAttaquant, arme }
  apresAttaque(victime, attaquant, ctx) {
    const passe = (porteur, enchanted, piles) => {
      for (const { texte, slot } of piles) {
        if (!texte) continue;
        const p = lirePile(texte);
        for (const [id, n] of Object.entries(p.ench)) {
          const e = this.def(id);
          if (!e || (slot && !dansGroupe(e.slots, slot))) continue;
          for (const x of e.effects?.['minecraft:post_attack'] ?? []) {
            if ((x.enchanted ?? 'attacker') !== enchanted) continue;
            const c2 = { ...ctx, ceci: victime, attaquant, outil: p.id, position: [victime.x, victime.y, victime.z] };
            if (x.requirements && !this.condition(x.requirements, n, c2)) continue;
            const cible = x.affected === 'attacker' ? attaquant : x.affected === 'damaging_entity' ? ctx.entiteDirecte ?? attaquant : victime;
            this.effetEntite(x.effect, n, cible, { porteur, emplacement: slot, pile: texte, enchanted, ...c2 });
          }
        }
      }
    };
    if (!ctx.victimeSeule && attaquant && typeof attaquant === 'object') passe(attaquant, 'attacker', [{ texte: ctx.arme ?? null, slot: ctx.arme === attaquant.main?.objet ? 'mainhand' : null }]);
    if (!ctx.attaquantSeul && victime && typeof victime === 'object') passe(victime, 'victim', Object.entries(EMPLACEMENTS).filter(([k]) => k !== 'main' && k !== 'gauche').map(([emp, slot]) => ({ texte: this.pileEquipee(victime, emp), slot })));
  }
  // EnchantmentEntityEffect.apply
  effetEntite(ef, n, cible, ctx) {
    const sim = this.sim, t = court(ef?.type);
    if (!cible || (typeof cible === 'object' && cible.mort >= 0 && t !== 'play_sound')) return;
    const pos = typeof cible === 'object' ? [cible.x, cible.y, cible.z] : ctx.position;
    switch (t) {
      case 'all_of': for (const e of ef.effects ?? []) this.effetEntite(e, n, cible, ctx); return;
      case 'ignite': { const sec = valeurNiveau(ef.duration, n); sim.allumerEntite?.(cible, Math.round(sec * 20)); return; }
      case 'apply_mob_effect': {
        const ids = Array.isArray(ef.to_apply) ? ef.to_apply : [ef.to_apply];
        const id = court(ids[sim.hasard.entierBorne(ids.length)]);
        const d0 = valeurNiveau(ef.min_duration, n), d1 = valeurNiveau(ef.max_duration, n), a0 = valeurNiveau(ef.min_amplifier, n), a1 = valeurNiveau(ef.max_amplifier, n);
        const duree = Math.round((d0 + sim.hasard.flottant() * (d1 - d0)) * 20), amp = Math.max(0, Math.round(a0 + sim.hasard.flottant() * (a1 - a0)));
        cible.appliquerEffet?.(id, duree, amp); return;
      }
      case 'damage_entity': {
        const q = valeurNiveau(ef.min_damage, n) + sim.hasard.flottant() * (valeurNiveau(ef.max_damage, n) - valeurNiveau(ef.min_damage, n));
        const src = court(ef.damage_type) === 'thorns' ? 'epines' : 'magie';
        if (src === 'epines') sim.son('enchant.thorns.hit', cible.x, cible.y, cible.z, 1, 1);
        cible.degats?.(q, src); return;
      }
      case 'change_item_damage': { const p = ctx.porteur, emp = Object.entries(EMPLACEMENTS).find(([, s]) => s === ctx.emplacement)?.[0]; if (p && emp) p.userPile?.(emp, Math.round(valeurNiveau(ef.amount, n))); return; }
      case 'summon_entity': { if (court(Array.isArray(ef.entity) ? ef.entity[0] : ef.entity) === 'lightning_bolt') sim.foudreEn?.(pos[0], pos[1], pos[2]); return; }
      case 'play_sound': { const s = Array.isArray(ef.sound) ? ef.sound[0] : ef.sound; sim.son(court(typeof s === 'object' ? s.sound_id : s), pos[0], pos[1], pos[2], valeurNiveau(ef.volume, n) || 1, typeof ef.pitch === 'number' ? ef.pitch : 1); return; }
      case 'explode': {   // Vent violent : rafale de charge de vent autour de l'attaquant (rayon, recul du niveau)
        sim.rafale?.(pos[0], pos[1], pos[2], { rayon: valeurNiveau(ef.radius, n), recul: valeurNiveau(ef.knockback_multiplier, n), source: cible, son: court(ef.sound) });
        return;
      }
      case 'replace_disk': return this.disque(ef, n, cible);
      case 'spawn_particles': { const pt = court(ef.particle?.type ?? 'poof'); sim.particule(pt, pos[0], pos[1] + 0.1, pos[2], 0, 0.1, 0, 1); return; }
      default: return;
    }
  }
  // ReplaceDisk (Marche givree) : disque de glace givree sur l'eau calme autour des pieds
  disque(ef, n, a) {
    const sim = this.sim, r = valeurNiveau(ef.radius, n), off = ef.offset ?? [0, 0, 0];
    const cx = Math.floor(a.x) + off[0], cy = Math.floor(a.y) + off[1], cz = Math.floor(a.z) + off[2];
    const etat = `minecraft:${court(ef.block_state?.id)}${ef.block_state?.properties ? '[' + Object.entries(ef.block_state.properties).map(([k, v]) => `${k}=${v}`).join(',') + ']' : ''}`;
    const R = Math.ceil(r);
    let n2 = 0;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > r * r) continue;
      const x = cx + dx, z = cz + dz, e = sim.monde.etatEn(x, cy, z), h = sim.monde.etatEn(x, cy + 1, z);
      if (e < 0 || h < 0 || sim.d.nomBloc(e) !== 'water' || sim.d.prop(e, 'level') !== '0' || !/^(air|cave_air|void_air)$/.test(sim.d.nomBloc(h))) continue;
      if (sim.acteurs?.liste.some((o) => o !== a && o.mort < 0 && Math.floor(o.x) === x && Math.floor(o.z) === z && Math.floor(o.y) === cy)) continue;   // unobstructed
      sim.poser(x, cy, z, etat, 3); n2++;
      sim.planifier?.(x, cy, z, 20 + sim.hasard.entierBorne(40));   // FrostedIceBlock : tick planifie (fonte)
    }
    if (n2) sim.stats.glaceGivree = (sim.stats.glaceGivree || 0) + n2;
  }

  // ---------------------------------------------------------------- table d'enchantement
  // EnchantingTableBlock : etageres a 2 blocs (anneau 5 x 5 sur 2 hauteurs), le bloc entre les deux doit laisser passer (#enchantment_power_transmitter)
  etageres(x, y, z) {
    const sim = this.sim, prov = sim.d.etiquette('enchantment_power_provider'), trans = sim.d.etiquette('enchantment_power_transmitter');
    let n = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
      for (let dy = 0; dy <= 1; dy++) {
        const e = sim.monde.etatEn(x + dx, y + dy, z + dz), m = sim.monde.etatEn(x + Math.trunc(dx / 2), y + dy, z + Math.trunc(dz / 2));
        if (e >= 0 && prov.has(sim.d.blocDe(e)) && m >= 0 && trans.has(sim.d.blocDe(m))) n++;
      }
    }
    return n;
  }
  enchantabilite(id) { return this.sim.d.j.objets?.[court(id)]?.[1] ?? 0; }
  // EnchantmentHelper.getEnchantmentCost (au plus 15 etageres)
  cout(hasard, emplacement, etageres, id) {
    if (this.enchantabilite(id) === 0) return 0;
    const b = Math.min(15, etageres);
    const s = hasard.entierBorne(8) + 1 + (b >> 1) + hasard.entierBorne(b + 1);
    return emplacement === 0 ? Math.max(Math.floor(s / 3), 1) : emplacement === 1 ? Math.floor(s * 2 / 3) + 1 : Math.max(s, b * 2);
  }
  primaire(e, id) { return this.oj.objetDans(e.primary_items ?? e.supported_items, id); }
  compatibles(a, b) {
    if (a === b) return false;
    const ea = this.def(a), eb = this.def(b);
    const dans = (e, autre) => { const s = e?.exclusive_set; if (!s) return false; return (Array.isArray(s) ? s : [s]).some((x) => (x.startsWith('#') ? this.oj.etiquette('enchantment', x.slice(1)).has(autre) : court(x) === autre)); };
    return !dans(ea, b) && !dans(eb, a);
  }
  coutNiveau(c, n) { return (c?.base ?? 0) + (c?.per_level_above_first ?? 0) * (n - 1); }
  // EnchantmentHelper.selectEnchantment (pool : #in_enchanting_table)
  // liste d'enchantements d'une option du jeu ('#minecraft:on_random_loot', ['minecraft:x', ...])
  optionsEnchant(opt) { if (!opt) return [...this.oj.enchantements.keys()]; const l = Array.isArray(opt) ? opt : [opt]; return l.flatMap((s) => (String(s).startsWith('#') ? [...this.oj.etiquette('enchantment', s.slice(1))] : [court(s)])); }
  // EnchantmentHelper.enchantItem (fonction de butin enchant_with_levels) : la selection sur la liste options`r
  selectionOptions(hasard, id, niveau, options) { return this.selection(hasard, id, niveau, this.optionsEnchant(options)); }
  selection(hasard, id, cout, pool = null) {
    const val = this.enchantabilite(id);
    const res = [];
    if (val === 0) return res;
    let c = cout + 1 + hasard.entierBorne(Math.floor(val / 4) + 1) + hasard.entierBorne(Math.floor(val / 4) + 1);
    const span = Math.fround(Math.fround(hasard.flottant() + hasard.flottant() - 1) * 0.15);
    c = Math.max(1, Math.round(Math.fround(c + c * span)));
    const livre = id === 'book';
    let dispo = [];
    for (const e of (pool ?? [...this.oj.etiquette('enchantment', 'in_enchanting_table')]).map((k) => this.def(k)).filter(Boolean)) {
      if (!livre && !this.primaire(e, id)) continue;
      for (let n = e.max_level; n >= 1; n--) if (c >= this.coutNiveau(e.min_cost, n) && c <= this.coutNiveau(e.max_cost, n)) { dispo.push([e.id, n]); break; }
    }
    const tirer = () => { const tot = dispo.reduce((s, [k]) => s + (this.def(k).weight ?? 0), 0); if (tot <= 0) return null; let i = hasard.entierBorne(tot); for (const x of dispo) { i -= this.def(x[0]).weight ?? 0; if (i < 0) return x; } return null; };
    if (!dispo.length) return res;
    const p = tirer(); if (p) res.push(p);
    while (hasard.entierBorne(50) <= c) {
      const der = res[res.length - 1]?.[0];
      if (der) dispo = dispo.filter(([k]) => this.compatibles(der, k));
      if (!dispo.length) break;
      const x = tirer(); if (x) res.push(x);
      c = Math.floor(c / 2);
    }
    return res;
  }
  // EnchantmentMenu.slotsChanged puis clickMenuButton : les 3 couts (graine de l'acteur), la liste de l'emplacement choisi (graine + emplacement) ;
  // un livre ne garde qu'un enchantement tire au hasard parmi plusieurs
  table(acteur, pos, id) {
    const sim = this.sim, H = sim.nouvelAleatoire(acteur.graineEnchant);
    const et = this.etageres(...pos);
    const couts = [0, 1, 2].map((k) => this.cout(H, k, et, id));
    for (let k = 0; k < 3; k++) if (couts[k] < k + 1) couts[k] = 0;
    const listes = couts.map((c, k) => {
      if (c <= 0) return [];
      const h = sim.nouvelAleatoire(acteur.graineEnchant + k);
      const l = this.selection(h, id, c);
      if (id === 'book' && l.length > 1) l.splice(h.entierBorne(l.length), 1);
      return l;
    });
    return { etageres: et, couts, listes };
  }

  // ---------------------------------------------------------------- enclume (AnvilMenu.createResult) : renommer, reparer (materiau ou deux objets), fusionner
  // rend { resultat (texte), cout (niveaux), materiaux (unites prises a droite) } ou { erreur }
  enclume(gauche, droite, { nom = null, creatif = false } = {}) {
    const d = this.sim.d, A = lirePile(gauche), B = droite ? lirePile(droite) : null;
    const objA = d.j.objets?.[A.id], usureMax = objA?.[0] ?? 0;
    let res = { ...A, ench: { ...A.ench } }, cout = 0, renommage = 0, materiaux = 0;
    const penalite = A.travail + (B?.travail ?? 0);
    if (B) {
      const livreB = B.id === 'enchanted_book';
      const rep = objA?.[2] ?? '';
      if (usureMax > 0 && rep && this.oj.objetDans(rep, B.id)) {   // reparation au materiau : 25 % de l'usure max par unite
        let us = Math.min(res.usure, Math.floor(usureMax / 4));
        if (us <= 0) return { erreur: 'rien a reparer' };
        let k = 0;
        for (; us > 0 && k < 64; k++) { res.usure -= us; cout++; us = Math.min(res.usure, Math.floor(usureMax / 4)); }
        materiaux = k;
      } else {
        if (!livreB && B.id !== A.id) return { erreur: `${B.id} ne se combine pas avec ${A.id}` };
        if (!livreB && usureMax > 0) {   // deux objets : somme des durabilites + 12 % de l'usure max
          const restA = usureMax - A.usure, restB = usureMax - B.usure, plus = restA + restB + Math.floor(usureMax * 12 / 100);
          const u = Math.max(0, usureMax - plus);
          if (u < A.usure) { res.usure = u; cout += 2; }
        }
        let ok = false, refus = false;
        for (const [id, nB] of Object.entries(B.ench)) {
          const e = this.def(id); if (!e) continue;
          const nA = res.ench[id] ?? 0, n = nA === nB ? nB + 1 : Math.max(nA, nB);
          let peut = this.oj.objetDans(e.supported_items, A.id) || A.id === 'enchanted_book' || creatif;
          for (const k of Object.keys(res.ench)) if (k !== id && !this.compatibles(id, k)) { peut = false; cout++; }
          if (!peut) { refus = true; continue; }
          ok = true;
          res.ench[id] = Math.min(n, e.max_level);
          cout += Math.max(1, livreB ? Math.floor((e.anvil_cost ?? 1) / 2) : e.anvil_cost ?? 1) * res.ench[id];
        }
        if (refus && !ok) return { erreur: 'enchantements incompatibles' };
      }
    }
    if (nom) { renommage = 1; cout += 1; }
    if (cout <= 0) return { erreur: 'rien a faire' };
    const prix = cout;
    let total = penalite + prix;
    if (renommage === prix && total >= 40) total = 39;   // un simple renommage reste possible
    if (total >= 40 && !creatif) return { erreur: `trop cher (${total} niveaux)` };
    let base = Math.max(A.travail, B?.travail ?? 0);
    if (renommage !== prix) base = base * 2 + 1;   // AnvilMenu.calculateIncreasedRepairCost (pas pour un simple renommage)
    res.travail = base;
    return { resultat: textePile(res), cout: total, materiaux, nom };
  }
}
