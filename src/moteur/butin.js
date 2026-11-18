// Butin d'un bloc detruit : les tables du jeu compilees dans NOTRE format (outils/extraire-donnees-jeu.mjs, champ `butins` des donnees : arbres de
// pools, entrees, conditions et fonctions ; voir le commentaire de l'outil). L'outil compte (partie 26) : Toucher de soie (`tool/can_silk_touch`),
// cisailles (`tool/can_shear`), Fortune (`table_bonus`, `apply_bonus` ore_drops / uniform_bonus_count / binomial_with_bonus_count) ; l'etat du bloc,
// le hasard du monde et le rayon d'une explosion (survit_explosion : 1 chance sur puissance, decroissance par objet) sont les autres variables.
// Port de LootTable / LootPool / LootItem (conditions survives_explosion, match_block, match_tool, random_chance, table_bonus ; fonctions set_count,
// explosion_decay, apply_bonus, limit_count) : Horizon world/loot.rs (MIT, voir ATTRIBUTIONS.md).

// bloc : nom ('stone', sans 'minecraft:') ; props : { type: 'double', ... } ; ctx : { hasard (flottant()/entierBorne(n)), explosion (puissance ou null),
// outil : { id, ench: { silk_touch: 1, fortune: 3 } } ou null, etiquetteObjet(nom, etiquette) facultatif }
// Rend [[objet, nombre], ...] (objets sans 'minecraft:').
export function butinDe(d, nomBloc, props, ctx) {
  const T = d.j.butins;
  if (!T) return [];
  const idx = T.b[nomBloc];
  if (idx === undefined) return [];
  const { hasard, explosion } = ctx, R = explosion ?? 0;
  const outil = ctx.outil ?? null, niveau = (e) => (outil?.ench?.[e] ?? 0);
  const outilParmi = (liste) => !!outil && liste.some((x) => (x.startsWith('#') ? !!ctx.etiquetteObjet?.(outil.id, x.slice(1)) : x === outil.id));
  const vrai = (c) => {
    switch (c[0]) {
      case 'v': return true;
      case 'f': return false;
      case 's': return Object.entries(c[1]).every(([k, vals]) => vals.includes(props[k]));
      case 'p': return hasard.flottant() < c[1];
      case 'tb': { const ch = c[2]; return hasard.flottant() < ch[Math.min(niveau(c[1]), ch.length - 1)]; }   // BonusLevelTableCondition
      case 'o': return outilParmi(c[1]);
      case 'e': return niveau(c[1]) >= c[2];
      case 'x': return R > 0 ? hasard.flottant() <= 1 / R : true;
      case 'et': { for (let i = 1; i < c.length; i++) if (!vrai(c[i])) return false; return true; }
      case 'ou': { for (let i = 1; i < c.length; i++) if (vrai(c[i])) return true; return false; }
      case 'non': return !vrai(c[1]);
      default: return true;
    }
  };
  const ok = (g) => !g || vrai(g);
  // une entree : rend { nom, n } ou null (condition fausse ; pour des alternatives : la premiere qui reussit)
  const entree = (e) => {
    if (!ok(e.g)) return null;
    if (e.a) { for (const x of e.a) { const r = entree(x); if (r) return r; } return null; }
    if (e.n === undefined) return null;
    let n = 1, decroit = false;
    for (const f of e.f || []) {
      if (f[0] === 'n') { if (f[2] && !vrai(f[2])) continue; n = Array.isArray(f[1]) ? f[1][0] + hasard.entierBorne(f[1][1] - f[1][0] + 1) : f[1]; }
      else if (f[0] === 'b') { const k = f[1] + (f[3] ? niveau(f[3]) : 0); for (let i = 0; i < k; i++) if (hasard.flottant() < f[2]) n++; }   // binomial_with_bonus_count
      else if (f[0] === 'bo') { const l = niveau(f[1]); if (l > 0) { const b = hasard.entierBorne(l + 2) - 1; n *= Math.max(0, b) + 1; } }   // ore_drops : x (max(0, nextInt(l + 2) - 1) + 1)
      else if (f[0] === 'bu') { const l = niveau(f[1]); if (l > 0) n += hasard.entierBorne(Math.round(f[2] * l) + 1); }   // uniform_bonus_count : + nextInt(mult x l + 1)
      else if (f[0] === 'l') { if (f[1] !== null) n = Math.max(n, f[1]); if (f[2] !== null) n = Math.min(n, f[2]); }
      else if (f[0] === 'd') decroit = true;
    }
    if (decroit && R > 0) { let k = 0; for (let i = 0; i < n; i++) if (hasard.flottant() <= 1 / R) k++; n = k; }
    return { nom: e.n === '$' ? nomBloc : e.n, n };
  };
  const sortie = [];
  for (const p of T.t[idx]) {
    if (!ok(p.g)) continue;
    const rouleaux = Array.isArray(p.r) ? p.r[0] + hasard.entierBorne(p.r[1] - p.r[0] + 1) : p.r;
    for (let r = 0; r < rouleaux; r++) {
      // les entrees valides d'un pool : une est tiree au hasard (poids egaux)
      const choix = [];
      for (const e of p.e) { const x = entree(e); if (x) choix.push(x); }
      if (!choix.length) continue;
      const x = choix.length === 1 ? choix[0] : choix[hasard.entierBorne(choix.length)];
      if (x.n > 0) sortie.push([x.nom, x.n]);
    }
  }
  return sortie;
}
