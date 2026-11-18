// Alambic (BrewingStandBlockEntity, docs/SIMULATION.md partie 26) : 3 fioles, 1 ingredient, 1 carburant. Les RECETTES sont les fichiers du jeu
// (data/minecraft/recipe/brewing/*.json, lus dans le kit : `input` (objet + potion), `reagent`, `output`) ; le carburant est le composant
// `brewing_fuel` de l'objet (poudre de blaze : `uses` = minecraft:brewing/uses_default = 20 infusions, vitesse 1).
//   serverTick : sans carburant, une poudre est prise (20 infusions) ; une infusion commence si l'ingredient fait au moins une recette avec une
//   des fioles, et dure ceil(400 / vitesse) ticks ; si l'ingredient change ou ne sert plus, elle s'arrete ; au bout, chaque fiole qui a une
//   recette devient son resultat, l'ingredient perd une piece, evenement 1035 (son block.brewing_stand.brew) ; l'etat has_bottle_0..2 suit
//   les fioles. Port de Horizon horizon-client-render/src/brewing.rs (MIT, voir ATTRIBUTIONS.md).
import { lirePile, textePile, idDe, canon } from './pile.js';

const court = (s) => String(s ?? '').replace(/^minecraft:/, '');
export const TEMPS_INFUSION = 400;

export class Alambics {
  constructor(sim) { this.sim = sim; this.m = new Map(); this._rec = null; }
  cle(x, y, z) { return `${x},${y},${z}`; }
  estAlambic(x, y, z) { const e = this.sim.monde.etatEn(x, y, z); return e >= 0 && this.sim.d.nomBloc(e) === 'brewing_stand'; }
  etat(x, y, z) {
    const k = this.cle(x, y, z);
    if (!this.m.has(k)) this.m.set(k, { pos: [x, y, z], fioles: [null, null, null], ingredient: null, nIngredient: 0, carburant: null, nCarburant: 0, reserve: 0, total: 20, vitesse: 1, infusion: 0, duree: TEMPS_INFUSION, ingredientInfusion: null, dernieres: null });
    return this.m.get(k);
  }
  // recettes du jeu : [{ entree: {ids, potions}, reactif: {ids}, sortie: texte }]
  recettes() {
    if (this._rec) return this._rec;
    const oj = this.sim.objetsJeu;
    if (!oj) throw new Error('alambic : recettes du jeu absentes (groupe de kit "recettes")');
    const ing = (v) => {
      const ids = new Set();
      for (const s of Array.isArray(v?.item) ? v.item : [v?.item]) if (s) { if (s.startsWith('#')) for (const x of oj.etiquette('item', s.slice(1))) ids.add(x); else ids.add(court(s)); }
      const p = v?.potion_contents?.potions;
      return { ids, potions: p === undefined ? null : new Set((Array.isArray(p) ? p : [p]).map(court)) };
    };
    this._rec = [];
    for (const [nom, r] of oj.recettes) {
      if (!nom.startsWith('brewing/') || nom.slice(8).includes('/') || court(r.type) !== 'brewing') continue;
      const pot = r.output?.components?.['minecraft:potion_contents']?.potion;
      this._rec.push({ nom, entree: ing(r.input), reactif: ing(r.reagent), sortie: textePile({ id: court(r.output?.id ?? 'potion'), ench: {}, potion: pot ? court(pot) : null, usure: 0, travail: 0 }) });
    }
    return this._rec;
  }
  teste(i, texte) { if (!texte) return false; const p = lirePile(texte); return i.ids.has(p.id) && (!i.potions || (p.potion && i.potions.has(p.potion))); }
  trouver(fiole, ingredient) { return this.recettes().find((r) => this.teste(r.entree, fiole) && this.teste(r.reactif, ingredient)) ?? null; }
  estReactif(texte) { return !!texte && this.recettes().some((r) => r.reactif.ids.has(idDe(texte))); }
  estFiole(texte) { const id = idDe(texte); return id === 'glass_bottle' || this.recettes().some((r) => r.entree.ids.has(id)); }

  // un acteur depose : fente 'bouteille' (ou une potion), 'ingredient', 'carburant' ; rend ce qui n'est pas entre
  deposer(pos, objet, n, fente) {
    const A = this.etat(...pos), t = canon(objet), carb = this.sim.d.j.objets?.[idDe(t)]?.[10] ?? 0;
    const f = fente ?? (this.estFiole(t) ? 'bouteille' : carb > 0 && !A.carburant ? 'carburant' : 'ingredient');
    let reste = n;
    if (f === 'bouteille' || f === 'entree') {
      for (let i = 0; i < 3 && reste > 0; i++) if (!A.fioles[i] && this.estFiole(t)) { A.fioles[i] = t; reste--; }
    } else if (f === 'carburant' || f === 'combustible') {
      if (carb <= 0) return n;
      if (!A.carburant || A.carburant === t) { const k = Math.min(64 - A.nCarburant, reste); A.carburant = t; A.nCarburant += k; reste -= k; }
    } else {
      if (!this.estReactif(t)) return n;
      if (!A.ingredient || A.ingredient === t) { const k = Math.min(64 - A.nIngredient, reste); A.ingredient = t; A.nIngredient += k; reste -= k; }
    }
    this.sim.dire(`alambic ${pos.join(',')} : ${n - reste} ${idDe(t)} (${f})`);
    return reste;
  }
  // un acteur prend : les fioles d'abord (ou l'objet demande) ; rend [[texte, n]]
  prendre(pos, objet = null, n = Infinity) {
    const A = this.etat(...pos), out = [];
    for (let i = 0; i < 3 && n > 0; i++) if (A.fioles[i] && (!objet || idDe(A.fioles[i]) === idDe(objet))) { out.push([A.fioles[i], 1]); A.fioles[i] = null; n--; }
    if (objet && A.ingredient && idDe(A.ingredient) === idDe(objet) && n > 0) { const k = Math.min(n, A.nIngredient); out.push([A.ingredient, k]); A.nIngredient -= k; if (!A.nIngredient) A.ingredient = null; }
    return out;
  }
  contenu(pos) { const A = this.etat(...pos); return { fioles: [...A.fioles], ingredient: A.ingredient, nIngredient: A.nIngredient, carburant: A.carburant, nCarburant: A.nCarburant, reserve: A.reserve, infusion: A.infusion, duree: A.duree }; }

  tick() {
    const sim = this.sim;
    for (const A of this.m.values()) {
      if (!this.estAlambic(...A.pos)) continue;
      // BrewingStandBlockEntity.serverTick
      if (A.reserve <= 0 && A.carburant) {
        const uses = sim.d.j.objets?.[idDe(A.carburant)]?.[10] ?? 0;
        if (uses > 0) {
          A.reserve = sim.objetsJeu?.usagesCarburant ?? uses; A.total = A.reserve; A.vitesse = 1;
          if (--A.nCarburant <= 0) { A.carburant = null; A.nCarburant = 0; }
        }
      }
      const infusable = !!A.ingredient && A.nIngredient > 0 && this.estReactif(A.ingredient) && A.fioles.some((f) => f && this.trouver(f, A.ingredient));
      if (A.infusion > 0) {
        A.infusion--;
        const meme = A.ingredient === A.ingredientInfusion;
        if (A.infusion === 0 && infusable) this.infuser(A);
        else if (!infusable || !meme) A.infusion = 0;
      } else if (infusable && A.reserve > 0) {
        A.reserve--;
        A.infusion = Math.ceil(sim.regles.valeur('alambic.temps', TEMPS_INFUSION) / (A.vitesse > 0 ? A.vitesse : 1)); A.duree = A.infusion;   // regle alambic.temps (jeu : 400)
        A.ingredientInfusion = A.ingredient;
      }
      const fl = A.fioles.map((f) => !!f);
      if (!A.dernieres || fl.some((v, i) => v !== A.dernieres[i])) {
        A.dernieres = fl;
        const e = sim.monde.etatEn(...A.pos);
        let et = sim.d.chaine(e);
        for (let i = 0; i < 3; i++) et = et.replace(new RegExp(`has_bottle_${i}=(true|false)`), `has_bottle_${i}=${fl[i]}`);
        sim.poser(A.pos[0], A.pos[1], A.pos[2], et, 2);
      }
      // progression lue par le film (bulles et fleche de l'ecran de l'alambic)
      if (A.infusion > 0) sim.replay.blocEntite(sim.temps, 'alambic', A.pos[0], A.pos[1], A.pos[2], 1 - A.infusion / A.duree);
    }
  }
  infuser(A) {
    const sim = this.sim;
    for (let i = 0; i < 3; i++) { const r = A.fioles[i] && this.trouver(A.fioles[i], A.ingredient); if (r) A.fioles[i] = r.sortie; }
    const rest = sim.d.aliment(A.ingredient)?.[5] || null;
    if (--A.nIngredient <= 0) { A.ingredient = rest; A.nIngredient = rest ? 1 : 0; }
    sim.son('block.brewing_stand.brew', A.pos[0] + 0.5, A.pos[1] + 0.5, A.pos[2] + 0.5, 1, 1);   // LevelEvent 1035
    sim.stats.infusions = (sim.stats.infusions || 0) + 1;
    (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} alambic ${A.pos.join(',')} : ${A.fioles.filter(Boolean).join(', ')}`);
    sim.dire(`alambic ${A.pos.join(',')} : infusion finie (${A.fioles.filter(Boolean).join(', ')})`);
  }
}
