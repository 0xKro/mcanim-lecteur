// Recettes du jeu (docs/SIMULATION.md partie 26) : LUES dans les fichiers du jeu (data/minecraft/recipe/*.json du kit), jamais recopiees.
// Types : crafting_shaped (motif, miroir), crafting_shapeless, crafting_transmute (composants gardes), crafting_imbue (fleches a effet),
// crafting_dye, crafting_decorated_pot, crafting_special_* (fusee, etoile et fondu d'artifice, reparation, livre, carte, banniere, bouclier),
// stonecutting (tailleur de pierre), smithing_transform et smithing_trim (table de forgeron). Le four, le fumoir et le haut fourneau sont aux
// blocs et machines (moteur/four.js).
// Une recette 2 x 2 (ou de 4 ingredients au plus) se fait dans l'inventaire ; plus grande, il faut un etabli (CraftingMenu 3 x 3).
// Restes (Item.craftRemainder, du CODE du jeu : seaux et fioles ; liste relue dans Items.java du jeu, pas dans un fichier de donnees) : un seau
// d'eau, de lave, de lait ou de neige poudreuse rend un seau ; une fiole de miel et le souffle du dragon rendent une fiole.
// Port de Horizon horizon-client/src/crafting.rs (MIT, voir ATTRIBUTIONS.md).
import { lirePile, textePile, idDe } from './pile.js';

const court = (s) => String(s ?? '').replace(/^minecraft:/, '');
export const RESTES = { water_bucket: 'bucket', lava_bucket: 'bucket', milk_bucket: 'bucket', powder_snow_bucket: 'bucket', honey_bottle: 'glass_bottle', dragon_breath: 'glass_bottle' };

// un ingredient du jeu -> liste d'identifiants acceptes
export function accepte(oj, ing) {
  if (ing === null || ing === undefined) return [];
  if (Array.isArray(ing)) return ing.flatMap((x) => accepte(oj, x));
  if (typeof ing === 'object') return ing.tag ? accepte(oj, '#' + court(ing.tag)) : accepte(oj, ing.item ?? ing.items ?? null);
  const s = String(ing);
  return s.startsWith('#') ? [...oj.etiquette('item', s.slice(1))] : [court(s)];
}

// Les recettes qui donnent `id` (ou la recette `nomRecette`) : [{ nom, r }] dans l'ordre des fichiers
export function recettesPour(oj, id, nomRecette = null) {
  const out = [];
  for (const [nom, r] of oj.recettes) {
    if (nomRecette) { if (nom === court(nomRecette)) out.push({ nom, r }); continue; }
    const res = court(typeof r.result === 'string' ? r.result : r.result?.id ?? r.output?.id ?? '');
    if (res === id) out.push({ nom, r });
    else if (/special_(firework_rocket|firework_star|repairitem|bookcloning|mapextending)/.test(r.type) && SPECIAUX[court(r.type)]?.resultat === id) out.push({ nom, r });
  }
  return out;
}
const SPECIAUX = {
  crafting_special_firework_rocket: { resultat: 'firework_rocket' }, crafting_special_firework_star: { resultat: 'firework_star' }, crafting_special_firework_star_fade: { resultat: 'firework_star' },
  crafting_special_repairitem: { resultat: null }, crafting_special_bookcloning: { resultat: 'written_book' }, crafting_special_mapextending: { resultat: 'filled_map' },
};

// Ingredients d'une recette : [{ ids: [...], n: 1 }] et la grille d'affichage (9 cases) ; `atelier` : 'inventaire' | 'etabli' | 'tailleur' | 'forge'
// opts : { avec: [ids voulus] } pour les recettes speciales (fusee : poudre), { cible } pour la reparation
export function analyser(oj, r, opts = {}) {
  const t = court(r.type);
  const ing = [];
  let grille = null, atelier = 'inventaire', resultat = null, n = 1, motif = null;
  const res = (x) => { if (!x) return; resultat = court(typeof x === 'string' ? x : x.id); n = (typeof x === 'object' && x.count) || 1; };
  if (t === 'crafting_shaped') {
    const P = r.pattern, H = P.length, W = Math.max(...P.map((l) => l.length));
    grille = new Array(9).fill(null);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = P[y][x];
      if (!c || c === ' ') continue;
      const ids = accepte(oj, r.key[c]);
      ing.push({ ids, n: 1, case: y * 3 + x });
      grille[y * 3 + x] = ids;
    }
    if (W > 2 || H > 2) atelier = 'etabli';
    res(r.result);
  } else if (t === 'crafting_shapeless') {
    r.ingredients.forEach((x, i) => ing.push({ ids: accepte(oj, x), n: 1, case: i }));
    if (r.ingredients.length > 4) atelier = 'etabli';
    res(r.result);
  } else if (t === 'crafting_transmute') {
    ing.push({ ids: accepte(oj, r.input), n: 1, case: 0, garde: true }, { ids: accepte(oj, r.material), n: 1, case: 1 });
    res(r.result);
  } else if (t === 'crafting_imbue') {   // 8 materiaux autour d'une source (fleches autour d'une potion persistante)
    ing.push({ ids: accepte(oj, r.source), n: 1, case: 4, source: true });
    for (const k of [0, 1, 2, 3, 5, 6, 7, 8]) ing.push({ ids: accepte(oj, r.material), n: 1, case: k });
    atelier = 'etabli'; res(r.result);
  } else if (t === 'crafting_dye') {
    ing.push({ ids: accepte(oj, r.target), n: 1, case: 0, garde: true }, { ids: accepte(oj, r.dye), n: 1, case: 1 });
    res(r.result);
  } else if (t === 'crafting_decorated_pot') {
    for (const k of [1, 3, 5, 7]) ing.push({ ids: [...oj.etiquette('item', 'decorated_pot_ingredients')], n: 1, case: k });
    atelier = 'etabli'; resultat = 'decorated_pot';
  } else if (t === 'crafting_special_firework_rocket') {   // papier + 1 a 3 poudres (+ etoiles) : duree de vol = nombre de poudres
    const k = Math.max(1, Math.min(3, opts.poudre ?? 1));
    ing.push({ ids: ['paper'], n: 1, case: 0 });
    for (let i = 0; i < k; i++) ing.push({ ids: ['gunpowder'], n: 1, case: 1 + i });
    resultat = 'firework_rocket'; n = 3;
  } else if (t === 'crafting_special_firework_star' || t === 'crafting_special_firework_star_fade') {
    ing.push({ ids: ['gunpowder'], n: 1, case: 0 }, { ids: [...oj.etiquette('item', 'dyes')], n: 1, case: 1 });
    if (t.endsWith('fade')) ing.push({ ids: ['firework_star'], n: 1, case: 2, garde: true });
    resultat = 'firework_star';
  } else if (t === 'crafting_special_repairitem') {   // deux objets usables identiques : somme des durabilites + 5 % (enchantements perdus sauf les maledictions)
    if (opts.cible) { ing.push({ ids: [opts.cible], n: 1, case: 0, repare: true }, { ids: [opts.cible], n: 1, case: 1, repare: true }); resultat = opts.cible; }
  } else if (t === 'crafting_special_bookcloning') { ing.push({ ids: ['written_book'], n: 1, case: 0, garde: true }, { ids: ['writable_book'], n: 1, case: 1 }); resultat = 'written_book'; n = 2; }
  else if (t === 'crafting_special_mapextending') { ing.push({ ids: ['filled_map'], n: 1, case: 4, garde: true }); for (const k of [0, 1, 2, 3, 5, 6, 7, 8]) ing.push({ ids: ['paper'], n: 1, case: k }); atelier = 'etabli'; resultat = 'filled_map'; }
  else if (t === 'crafting_special_bannerduplicate') { ing.push({ ids: [court(r.banner ?? '')], n: 1, case: 0, garde: true }, { ids: [court(r.banner ?? '')], n: 1, case: 1 }); resultat = court(r.banner ?? r.result?.id); n = 2; }
  else if (t === 'crafting_special_shielddecoration') { ing.push({ ids: ['shield'], n: 1, case: 0, garde: true }, { ids: [...oj.etiquette('item', 'banners')], n: 1, case: 1 }); resultat = 'shield'; }
  else if (t === 'stonecutting') { ing.push({ ids: accepte(oj, r.ingredient), n: 1, case: 0 }); atelier = 'tailleur'; res(r.result); }
  else if (t === 'smithing_transform') { ing.push({ ids: accepte(oj, r.template), n: 1, case: 0 }, { ids: accepte(oj, r.base), n: 1, case: 1, garde: true }, { ids: accepte(oj, r.addition), n: 1, case: 2 }); atelier = 'forge'; res(r.result); }
  else if (t === 'smithing_trim') { ing.push({ ids: accepte(oj, r.template), n: 1, case: 0 }, { ids: accepte(oj, r.base), n: 1, case: 1, garde: true }, { ids: accepte(oj, r.addition), n: 1, case: 2, materiau: true }); atelier = 'forge'; resultat = opts.cible ?? null; motif = court(r.pattern ?? ''); }
  else return null;
  if (!grille) { grille = new Array(9).fill(null); for (const x of ing) if (x.case < 9) grille[x.case] = x.ids; }
  return { type: t, ing, grille, atelier, resultat, n, ...(motif ? { motif } : {}) };
}

// Choisit dans le sac (Map texte -> nombre ; `infini` : tout est disponible) une pile pour chaque ingredient. Rend { piles: [texte|null par
// ingredient], manque: id | null }
export function choisir(a, ing, infini) {
  const pris = new Map(), piles = [];
  for (const x of ing) {
    let trouve = null;
    if (!infini) for (const [k, n] of a.sac) if (n - (pris.get(k) ?? 0) > 0 && x.ids.includes(idDe(k))) { trouve = k; break; }
    if (!trouve && infini) trouve = x.ids[0] ?? null;
    if (!trouve) return { piles, manque: x.ids.slice(0, 3).join(' | ') || '?' };
    pris.set(trouve, (pris.get(trouve) ?? 0) + 1);
    piles.push(trouve);
  }
  return { piles, manque: null };
}

// Le resultat d'une fabrication : texte de pile et nombre. `piles` : les piles prises (ordre des ingredients). d : donnees du jeu (usure max).
export function resultat(d, an, piles, opts = {}) {
  const base = an.ing.findIndex((x) => x.garde);
  let res = an.resultat, n = an.n;
  if (an.type === 'crafting_imbue') {   // la potion de la source passe aux fleches
    const pot = lirePile(piles[an.ing.findIndex((x) => x.source)]).potion;
    res = textePile({ ...lirePile(res), potion: pot });
  } else if (an.type === 'crafting_special_repairitem') {   // ItemStack : (max - usure1) + (max - usure2) + max x 5 / 100 ; enchantements : seulement les maledictions
    const A = lirePile(piles[0]), B = lirePile(piles[1]), max = d.j.objets?.[A.id]?.[0] ?? 0;
    const reste = Math.min(max, (max - A.usure) + (max - B.usure) + Math.floor(max * 5 / 100));
    const ench = Object.fromEntries(Object.entries(A.ench).filter(([k]) => /_curse$/.test(k)));
    res = textePile({ id: A.id, ench, potion: null, usure: Math.max(0, max - reste), travail: 0 });
  } else if (base >= 0 && piles[base] && an.type !== 'crafting_special_bannerduplicate') {   // transmute, forge : les composants de la base passent au resultat
    const B = lirePile(piles[base]);
    res = textePile({ ...B, id: res ?? B.id });
  }
  if (an.type === 'smithing_trim' && res) {   // SmithingTrimRecipe : la base garde ses composants et prend le galon (motif de la recette, materiau donne par l'ajout)
    const m = piles[an.ing.findIndex((x) => x.materiau)], g = m ? d.j.garnitures?.[idDe(m)] : null;
    if (g) res = textePile({ ...lirePile(res), motif: an.motif, garniture: g });
  }
  if (an.type === 'crafting_special_firework_rocket') res = `firework_rocket`;   // duree de vol : le nombre de poudres (composant fireworks, lu par fusees.js depuis l'option fusee)
  void opts;
  return { texte: res, n };
}
// restes laisses dans la grille (Item.craftRemainder)
export const resteDe = (texte) => RESTES[idDe(texte)] ?? null;
