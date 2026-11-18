// Une pile d'objets du jeu ecrite en TEXTE : `id[composant=valeur,...]` (forme courte, inspiree de la syntaxe des composants de `/give`).
//   diamond_sword[sharpness=5,unbreaking=3]   enchantements (noms du jeu : data/minecraft/enchantment/*.json), niveau entier
//   potion[potion=strong_healing]              contenu d'une potion, d'une potion jetee ou persistante, d'une fleche a effet (Potions du jeu)
//   bow[usure=120]                             usure deja prise (composant minecraft:damage)
//   iron_pickaxe[travail=3]                    penalite de l'enclume (composant minecraft:repair_cost)
//   iron_chestplate[motif=coast,garniture=gold] galon d'armure (composant minecraft:trim : trim_pattern et trim_material du jeu)
// Le texte canonique (composants tries) sert de cle dans le sac d'un acteur : deux piles egales s'empilent, une epee usee ne s'empile pas avec une
// neuve (ItemStack.isSameItemSameComponents). Aucun fichier du jeu ici : seulement la lecture de ce texte.
export const COMPOSANTS = new Set(['potion', 'usure', 'travail', 'motif', 'garniture']);
const ID = /^[a-z0-9_./-]{1,80}$/;

const cache = new Map();
// texte -> { id, ench: {nom: niveau}, potion, usure, travail } ; leve une erreur lisible si la forme est mauvaise
export function lirePile(texte) {
  if (texte === null || texte === undefined) return null;
  if (typeof texte === 'object') return texte;
  const t0 = String(texte).trim().replace(/^minecraft:/, '');
  const c = cache.get(t0); if (c) return c;
  // cuir teint (composant dyed_color) : suffixe #RRGGBB ou #teinture (objets/armure.js couleurArmure) ; garde dans le texte canonique
  const mT = /#([0-9a-fA-F]{6}|[a-z_]{3,12})$/.exec(t0), t = mT ? t0.slice(0, mT.index) : t0;
  const i = t.indexOf('[');
  const id = i < 0 ? t : t.slice(0, i);
  if (!ID.test(id)) throw new Error(`objet "${t}" : identifiant du jeu attendu (lettres minuscules, chiffres, _)`);
  const p = { id, ench: {}, potion: null, usure: 0, travail: 0, ...(mT ? { teinte: mT[1] } : {}) };
  if (i >= 0) {
    if (!t.endsWith(']')) throw new Error(`objet "${t}" : "]" manquant (forme : diamond_sword[sharpness=5,unbreaking=3])`);
    for (const kv of t.slice(i + 1, -1).split(',')) {
      if (!kv) continue;
      const [k0, v] = kv.split('=');
      const k = String(k0).trim().replace(/^minecraft:/, '');
      if (v === undefined || !/^[a-z0-9_]+$/.test(k)) throw new Error(`objet "${t}" : composant "${kv}" mal ecrit (cle=valeur)`);
      if (k === 'potion') { if (!/^[a-z0-9_]+$/.test(v)) throw new Error(`objet "${t}" : potion "${v}" mal ecrite`); p.potion = v.replace(/^minecraft:/, ''); continue; }
      if (k === 'motif' || k === 'garniture') { if (!/^[a-z0-9_]+$/.test(v)) throw new Error(`objet "${t}" : ${k} "${v}" mal ecrit`); p[k] = v; continue; }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error(`objet "${t}" : ${k}=${v} : entier positif attendu`);
      if (k === 'usure') p.usure = n; else if (k === 'travail') p.travail = n; else if (n > 0) { if (n > 255) throw new Error(`objet "${t}" : niveau d'enchantement ${n} (255 au plus)`); p.ench[k] = n; }
    }
  }
  Object.freeze(p.ench);
  cache.set(t0, p);
  return p;
}

// pile -> texte canonique (composants tries) ; une pile sans composant redonne son identifiant seul
export function textePile(p) {
  if (!p) return null;
  const l = [];
  for (const k of Object.keys(p.ench).sort()) l.push(`${k}=${p.ench[k]}`);
  if (p.garniture) l.push(`garniture=${p.garniture}`);
  if (p.motif) l.push(`motif=${p.motif}`);
  if (p.potion) l.push(`potion=${p.potion}`);
  if (p.travail) l.push(`travail=${p.travail}`);
  if (p.usure) l.push(`usure=${p.usure}`);
  return (l.length ? `${p.id}[${l.join(',')}]` : p.id) + (p.teinte ? '#' + p.teinte : '');
}
export const canon = (texte) => (texte === null || texte === undefined ? null : textePile(lirePile(texte)));
export const idDe = (texte) => (texte === null || texte === undefined ? null : lirePile(texte).id);
export const niveauEnch = (texte, e) => (texte ? lirePile(texte).ench[e] ?? 0 : 0);
// la meme pile avec des changements (usure, enchantements, potion) : texte canonique
export function avecPile(texte, chg) {
  const p = lirePile(texte);
  return textePile({ ...p, ...chg, ench: { ...(chg.ench ?? p.ench) } });
}
export const estEnchantee = (texte) => !!texte && Object.keys(lirePile(texte).ench).length > 0;
