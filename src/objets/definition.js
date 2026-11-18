// Identifiant d'objet -> modeles a dessiner, par la definition d'objet de la 26.x (assets/minecraft/items/<id>.json).
// Cas geres : `model`, `composite`, `empty`, `special` (modele de base, voir modele.js), et les aiguilleurs avec leur valeur PAR DEFAUT :
//   - `condition` : la branche `on_false` (objet pas utilise, pas casse, pas selectionne...) ;
//   - `range_dispatch` : la valeur 0 (1 pour `count`) : la plus grande entree dont le seuil <= valeur, sinon `fallback` ;
//   - `select` : `display_context` = main (thirdperson_righthand ou lefthand), `main_hand` = right, `charge_type` = none, joueur, overworld ;
//     une valeur inconnue (`block_state`, `local_time`, `trim_material`, `custom_model_data`...) donne `fallback`.
// Ignores (dits dans `exotiques`) : `bundle/selected_item` et tout type inconnu.
import { lireJson } from './fichiers.js';
import { couleurPotion, effetsPotion } from '../moteur/potions.js';   // couleur d'une potion (partie 26)

const net = (s) => String(s).replace(/^minecraft:/, '');

// Teintes (`tints`) : couleur ARGB entiere. On prend `default` ; sinon une couleur fixe selon le type (herbe, feuillage...).
const TEINTES_TYPE = { grass: 0xFF91BD59, foliage: 0xFF77AB2F, dry_foliage: 0xFF8A6B2E, 'map_color': 0xFF4C7FFF, firework: 0xFF8A8A8A };
export function couleurTeinte(t) {
  if (!t || typeof t !== 'object') return null;
  if (t.type === 'minecraft:constant' && Number.isInteger(t.value)) return t.value | 0;
  if (Number.isInteger(t.default)) return t.default | 0;
  return TEINTES_TYPE[net(t.type ?? '')] ?? null;
}

// Identifiant valide : minuscules, chiffres, _ . / -  (avec ou sans "minecraft:").
export function normaliserId(id) {
  const s = net(String(id ?? '').trim());
  return /^[a-z0-9_./-]{1,80}$/.test(s) && !s.includes('..') ? s : null;
}

// Retourne { id, existe, entrees: [{ model, tints } | { special, base }], exotiques: [] }.
// etat (facultatif) : l'objet tel que tenu a cet instant (objets/etat-objet.js) : { utilise, ticks (temps d'utilisation), charge ('none' | 'arrow' |
// 'rocket' : arbalete chargee), boussole (angle 0..1 vers la cible), temps (heure du jour 0..1 de l'horloge) } : arc tendu, arbalete, boussole, horloge.
export function resoudreObjet(kit, id, { gauche = false, etat = null } = {}) {
  // potion, fleche a effet : `potion[potion=swiftness]` (objets/reflet.js idRendu) : teinte `minecraft:potion` = couleur des effets (PotionContents.getColor)
  const pot = /\[potion=([a-z0-9_]+)\]$/.exec(String(id ?? ''))?.[1] ?? null;
  const garniture = /\[garniture=([a-z0-9_]+)\]$/.exec(String(id ?? ''))?.[1] ?? null;   // galon : select `trim_material` (minecraft:gold...)
  if (pot || garniture) id = String(id).replace(/\[.*$/, '');
  const n = normaliserId(id);
  const sortie = { id: n, existe: false, entrees: [], exotiques: [] };
  if (!n) return sortie;
  const def = lireJson(kit, `items/${n}.json`);
  if (!def) return sortie;
  sortie.existe = true;
  const contexte = gauche ? 'thirdperson_lefthand' : 'thirdperson_righthand';
  const valeurSelect = (prop) => {
    switch (net(prop)) {
      case 'display_context': return contexte;
      case 'main_hand': return 'right';
      case 'charge_type': return etat?.charge ?? 'none';
      case 'context_entity_type': return 'player';
      case 'context_dimension': return 'overworld';
      case 'trim_material': return garniture ?? undefined;
      default: return undefined;
    }
  };
  const aller = (nd, profondeur = 0) => {
    if (!nd || typeof nd !== 'object' || profondeur > 12) return;
    const type = net(nd.type ?? '');
    switch (type) {
      case 'model': sortie.entrees.push({ model: net(nd.model), tints: (nd.tints ?? []).map((t) => (pot && t && net(t.type ?? '') === 'potion' ? (0xFF000000 | couleurPotion(effetsPotion(pot))) | 0 : couleurTeinte(t))) }); return;
      case 'empty': return;
      case 'composite': for (const m of nd.models ?? []) aller(m, profondeur + 1); return;
      case 'special': sortie.entrees.push({ special: net(nd.model?.type ?? ''), base: net(nd.base ?? '') }); return;
      case 'condition': aller(net(nd.property ?? '') === 'using_item' && etat?.utilise ? nd.on_true : nd.on_false, profondeur + 1); return;
      case 'range_dispatch': {
        // RangeSelectItemModel : valeur de la propriete x scale, la plus grande entree dont le seuil <= valeur (sinon fallback)
        const p = net(nd.property ?? ''), k = nd.scale ?? 1;
        const brute = p === 'count' ? 1 : p === 'use_duration' ? (etat?.ticks ?? 0) : p === 'crossbow/pull' ? (etat?.ticks ?? 0) / 25 : p === 'compass' ? (etat?.boussole ?? 0) : p === 'time' ? (etat?.temps ?? 0) : 0;
        const v = p === 'count' ? 1 : brute * k;
        let choix = null;
        for (const e of [...(nd.entries ?? [])].sort((a, b) => a.threshold - b.threshold)) if (e.threshold <= v) choix = e.model;
        aller(choix ?? nd.fallback, profondeur + 1);
        return;
      }
      case 'select': {
        const v = valeurSelect(nd.property);
        const cas = v === undefined ? null : (nd.cases ?? []).find((c) => (Array.isArray(c.when) ? c.when : [c.when]).some((w) => net(w) === v));
        aller(cas ? cas.model : nd.fallback, profondeur + 1);
        return;
      }
      default: sortie.exotiques.push(type || '?');
    }
  };
  aller(def.model);
  return sortie;
}
