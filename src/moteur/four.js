// Fours : four (FurnaceBlock), haut fourneau (BlastFurnaceBlock) et fumoir (SmokerBlock). Trois emplacements du conteneur (0 entree,
// 1 combustible, 2 sortie) ; chaque tick, comme AbstractFurnaceBlockEntity.serverTick du jeu 26.3 (Horizon horizon-client/src/furnace.rs,
// horizon-client-render/src/providers.rs : MIT, voir ATTRIBUTIONS.md) :
//   - le feu baisse de 1 ; s'il est eteint et qu'on peut cuire (entree avec recette DU BLOC, place en sortie), un combustible est consomme :
//     feu = temps de combustion de l'objet (dans un four rapide, predicat `block/fast_cooking` = haut fourneau et fumoir : le temps divise par 2,
//     division entiere du fournisseur `cooking/time_*`) et vitesse = `speed_multiplier` du combustible (four normal 1, rapide 2) ; la duree
//     totale devient ceil(temps de la recette / vitesse) et la cuisson deja faite est remise a l'echelle (ceil(ratio x total)) ;
//   - tant que le feu brule et qu'on peut cuire, la cuisson avance de 1 ; a la duree totale : 1 resultat en sortie, recette comptee (experience) ;
//   - une nouvelle entree (autre objet) remet la cuisson a 0 et la duree a ceil(temps / vitesse courante), 200 sans recette (setItem) ;
//   - sans feu la cuisson recule de 2 par tick ; l'etat `lit` du bloc suit le feu ; seau de lave -> seau vide (reste de fabrication) ;
//   - experience : prise de la sortie par un acteur (`prend`) : floor(n x xp) + une chance de la fraction (ExperienceOrb.award par recette).
// Recettes et temps : donnees du jeu (`cuisson` smelting, `fours.hautFourneau` blasting, `fours.fumoir` smoking, `fours.rapide`, `fours.vitesse`).
// Regles : `four.actif`, `four.vitesse` (multiplicateur de cuisson), `four.combustible` (multiplicateur de combustion).
import { pileMax } from './contenus.js';
import { avec } from './familles/_aide.js';

const FOURS = new Set(['furnace', 'blast_furnace', 'smoker']);
const RAPIDES = new Set(['blast_furnace', 'smoker']);
const totalTemps = (t, v) => (v > 0 ? Math.ceil(Math.fround(t / v)) : t);

export class Fours {
  constructor(sim) { this.sim = sim; this.etat = new Map(); }
  nomFour(x, y, z) { const e = this.sim.monde.etatEn(x, y, z); return e >= 0 && FOURS.has(this.sim.d.nomBloc(e)) ? this.sim.d.nomBloc(e) : null; }
  estFour(x, y, z) { return this.nomFour(x, y, z) !== null; }
  par(c) { const k = c.join(','); let s = this.etat.get(k); if (!s) { s = { feu: 0, feuMax: 0, progres: 0, total: 200, vitesse: 1, entree: null, recettes: new Map() }; this.etat.set(k, s); } return s; }
  recette(c, objet) { return this.sim.d.recetteFour(this.nomFour(...c) ?? 'furnace', objet); }

  // AbstractFurnaceBlockEntity.setItem sur l'entree : un autre objet remet la cuisson a 0
  entreeChangee(c, s, st) {
    const it = s[0]?.item ?? null;
    if (it === st.entree) return;
    st.entree = it;
    const r = it ? this.recette(c, it) : null;
    st.total = r ? totalTemps(r[1], st.vitesse) : 200;
    st.progres = 0;
  }

  // Depose `n` de `objet` : l'entree si l'objet a une recette de ce four, sinon le combustible (ou la fente demandee) ; rend ce qui n'a pas pu entrer
  deposer(c, objet, n, fente) {
    const s = this.sim.contenus.lire(...c);
    if (!s) return n;
    const d = this.sim.d;
    const i = fente === 'entree' ? 0 : fente === 'combustible' ? 1 : fente === 'sortie' ? -1 : this.recette(c, objet) ? 0 : d.combustible(objet) ? 1 : -1;
    if (i < 0) return n;
    const max = pileMax(objet);
    if (s[i] && s[i].item !== objet) return n;
    const place = max - (s[i] ? s[i].n : 0), k = Math.min(n, place);
    if (k <= 0) return n;
    if (s[i]) s[i].n += k; else s[i] = { item: objet, n: k };
    if (i === 0) this.entreeChangee(c, s, this.par(c));
    return n - k;
  }

  peutCuire(c, s) {
    const e = s[0];
    if (!e) return null;
    const r = this.recette(c, e.item);
    if (!r) return null;
    const sortie = s[2];
    if (sortie && (sortie.item !== r[0] || sortie.n + 1 > pileMax(r[0]))) return null;
    return r;
  }

  // experience des recettes faites, payee a l'acteur qui prend la sortie (getRecipesToAwardAndPopExperience) : orbes au point donne
  payerExperience(c, x, y, z) {
    const st = this.etat.get(c.join(','));
    if (!st || !st.recettes.size) return 0;
    let total = 0;
    for (const [, [n, xp]] of st.recettes) {
      let v = Math.floor(n * xp);
      const f = n * xp - Math.floor(n * xp);
      if (f !== 0 && this.sim.hasard.flottant() < f) v++;
      total += v;
    }
    st.recettes.clear();
    if (total > 0) this.sim.entites.orbes(x, y, z, total);
    return total;
  }

  tick() {
    const sim = this.sim, R = sim.regles;
    if (!R.valeur('four.actif', true)) return;
    for (const [k, s] of [...sim.contenus.m]) {
      if (s.length !== 3) continue;
      const c = k.split(',').map(Number);
      if (!this.estFour(...c)) continue;
      this.tickUn(c, s);
    }
  }
  tickUn(c, s) {
    const sim = this.sim, d = sim.d, R = sim.regles, st = this.par(c), nom = this.nomFour(...c), rapide = RAPIDES.has(nom);
    this.entreeChangee(c, s, st);
    const avant = st.feu > 0;
    let allume = false;
    if (st.feu > 0) { st.feu--; allume = st.feu > 0; }
    const combustible = s[1], entree = s[0];
    if (allume || (combustible && entree)) {
      const r = this.peutCuire(c, s);
      if (r) {
        if (!allume) {
          const t = Math.round(d.combustionFour(combustible.item, rapide) * R.valeur('four.combustible', 1));
          st.feu = t; st.feuMax = t;
          st.vitesse = d.vitesseCombustible(combustible.item, rapide) * R.valeur('four.vitesse', 1);
          if (st.total > 0 && st.progres < st.total) { const ratio = Math.fround(st.progres / st.total); st.total = totalTemps(r[1], st.vitesse); st.progres = Math.ceil(Math.fround(ratio * st.total)); }
          if (t > 0) {
            sim.dire(`${nom} ${c.join(',')} : ${combustible.item} allume (${t} ticks)`);
            combustible.n--;
            if (combustible.n <= 0) s[1] = combustible.item === 'lava_bucket' ? { item: 'bucket', n: 1 } : null;   // reste de fabrication (seau)
            allume = true;
          }
        }
        if (allume) {
          st.progres++;
          if (st.progres >= st.total) {
            st.progres = 0;
            st.total = totalTemps(r[1], st.vitesse);
            if (s[2]) s[2].n++; else s[2] = { item: r[0], n: 1 };
            const rec = st.recettes.get(entree.item) ?? [0, r[2]]; rec[0]++; st.recettes.set(entree.item, rec);
            if (entree.item === 'wet_sponge' && s[1]?.item === 'bucket') s[1] = { item: 'water_bucket', n: 1 };   // eponge sechee : le seau se remplit
            entree.n--; if (entree.n <= 0) s[0] = null;
            st.entree = s[0]?.item ?? null;
            sim.stats.cuits = (sim.stats.cuits || 0) + 1;
            sim.dire(`${nom} ${c.join(',')} : ${r[0]} pret au tick ${sim.temps}`);
            sim.api.contenuNotifie(c[0], c[1], c[2]);
          }
        } else st.progres = 0;
      } else st.progres = 0;
    } else if (st.progres > 0) st.progres = Math.max(0, Math.min(st.progres - 2, st.total));
    const apres = allume;
    if (avant !== apres) {
      const b = sim.decrire(c[0], c[1], c[2]);
      sim.poser(c[0], c[1], c[2], avec(b, { lit: apres ? 'true' : 'false' }), 3);
    }
    if (apres) this.animer(c, nom);
  }
  // animateTick (Horizon animate_tick.rs) : four et haut fourneau : crepitement (1 sur 10), fumee devant la bouche (haut fourneau : jusqu'a 9/16
  // de haut, sans flamme) ; fumoir : bruit de fumee (1 sur 10) et fumee sur le dessus
  animer(c, nom) {
    const sim = this.sim, h = sim.hasard;
    if (nom === 'smoker') {
      if (h.reel() < 0.1) sim.son('block.smoker.smoke', c[0] + 0.5, c[1], c[2] + 0.5, 1, 1);
      if (h.reel() < 0.35) sim.particule('smoke', c[0] + 0.5, c[1] + 1.1, c[2] + 0.5, 0, 0, 0, 1);
      return;
    }
    const blast = nom === 'blast_furnace';
    if (h.reel() < 0.1) sim.son(blast ? 'block.blastfurnace.fire_crackle' : 'block.furnace.fire_crackle', c[0] + 0.5, c[1], c[2] + 0.5, 1, 1);
    if (h.reel() < 0.35) {
      const b = sim.decrire(c[0], c[1], c[2]), f = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[b.etat.facing] ?? [0, 1];
      const lat = h.reel() * 0.6 - 0.3, x = c[0] + 0.5 + (f[0] ? f[0] * 0.52 : lat), z = c[2] + 0.5 + (f[1] ? f[1] * 0.52 : lat), y = c[1] + h.reel() * (blast ? 9 : 6) / 16;
      sim.particule('smoke', x, y, z, 0, 0, 0, 1);
      if (!blast) sim.particule('flame', x, y, z, 0, 0, 0, 1);
    }
  }
}
