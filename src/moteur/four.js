// Fours : cuisson d'un four (FurnaceBlock). Trois emplacements du conteneur (0 entree, 1 combustible, 2 sortie) ; chaque tick, comme
// AbstractFurnaceBlockEntity.serverTick du jeu (Horizon world/level/furnace.rs : MIT, voir ATTRIBUTIONS.md) :
//   - le feu baisse de 1 ; s'il est eteint et qu'on peut cuire (entree avec recette, place en sortie), un combustible est consomme : feu = temps de combustion de l'objet
//   - tant que le feu brule et qu'on peut cuire, la cuisson avance de 1 ; a la duree de la recette (200 ticks pour le minerai, la viande, la pomme de terre...) : 1 resultat en sortie
//   - sans feu la cuisson recule de 2 par tick ; l'etat `lit` du bloc suit le feu (la texture allumee et la lumiere 13 viennent des donnees du bloc)
// Les temps de combustion et les recettes viennent des donnees du jeu (`combustibles`, `cuisson`). Regles : `four.actif`, `four.vitesse` (multiplicateur de cuisson), `four.combustible` (multiplicateur de combustion).
import { pileMax } from './contenus.js';
import { avec } from './familles/_aide.js';

export class Fours {
  constructor(sim) { this.sim = sim; this.etat = new Map(); }
  estFour(x, y, z) { const e = this.sim.monde.etatEn(x, y, z); return e >= 0 && this.sim.d.nomBloc(e) === 'furnace'; }
  par(c) { const k = c.join(','); let s = this.etat.get(k); if (!s) { s = { feu: 0, feuMax: 0, progres: 0, total: 200 }; this.etat.set(k, s); } return s; }

  // Depose `n` de `objet` : l'entree si l'objet a une recette, sinon le combustible (ou la fente demandee) ; rend ce qui n'a pas pu entrer
  deposer(c, objet, n, fente) {
    const s = this.sim.contenus.lire(...c);
    if (!s) return n;
    const d = this.sim.d;
    let i = fente === 'entree' ? 0 : fente === 'combustible' ? 1 : fente === 'sortie' ? -1 : d.cuisson(objet) ? 0 : d.combustible(objet) ? 1 : -1;
    if (i < 0) return n;
    const max = pileMax(objet);
    if (s[i] && s[i].item !== objet) return n;
    const place = max - (s[i] ? s[i].n : 0), k = Math.min(n, place);
    if (k <= 0) return n;
    if (s[i]) s[i].n += k; else s[i] = { item: objet, n: k };
    return n - k;
  }

  peutCuire(s) {
    const d = this.sim.d, e = s[0];
    if (!e) return null;
    const r = d.cuisson(e.item);
    if (!r) return null;
    const sortie = s[2];
    if (sortie && (sortie.item !== r[0] || sortie.n >= pileMax(r[0]))) return null;
    return r;
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
    const sim = this.sim, d = sim.d, R = sim.regles, st = this.par(c);
    const avant = st.feu > 0;
    if (st.feu > 0) st.feu--;
    const combustible = s[1], entree = s[0];
    if (st.feu > 0 || (combustible && entree)) {
      const r = this.peutCuire(s);
      if (st.feu <= 0 && r) {
        const t = Math.round(d.combustible(combustible.item) * R.valeur('four.combustible', 1));
        if (t > 0) {
          st.feu = t; st.feuMax = t;
          sim.dire(`four ${c.join(',')} : ${combustible.item} allume (${t} ticks)`);
          if (combustible.item === 'lava_bucket') s[1] = { item: 'bucket', n: 1 };
          else { combustible.n--; if (combustible.n <= 0) s[1] = null; }
        }
      }
      if (st.feu > 0 && r) {
        st.total = Math.max(1, Math.round(r[1] / R.valeur('four.vitesse', 1)));
        st.progres++;
        if (st.progres >= st.total) {
          st.progres = 0;
          if (s[2]) s[2].n++; else s[2] = { item: r[0], n: 1 };
          entree.n--; if (entree.n <= 0) s[0] = null;
          sim.stats.cuits = (sim.stats.cuits || 0) + 1;
          sim.dire(`four ${c.join(',')} : ${r[0]} pret au tick ${sim.temps}`);
        }
      } else st.progres = 0;
    } else if (st.progres > 0) st.progres = Math.max(0, Math.min(st.progres - 2, st.total));
    const apres = st.feu > 0;
    if (avant !== apres) {
      const b = sim.decrire(c[0], c[1], c[2]);
      sim.poser(c[0], c[1], c[2], avec(b, { lit: apres ? 'true' : 'false' }), 3);
    }
    if (apres) {   // FurnaceBlock.animateTick : crepitement (1 sur 10), flamme et fumee devant la bouche
      const h = sim.hasard;
      if (h.reel() < 0.1) sim.son('block.furnace.fire_crackle', c[0] + 0.5, c[1] + 0.5, c[2] + 0.5, 1, 1);
      if (h.reel() < 0.35) {
        const b = sim.decrire(c[0], c[1], c[2]), f = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[b.etat.facing] ?? [0, 1];
        const lat = h.reel() * 0.6 - 0.3, x = c[0] + 0.5 + f[0] * 0.52 + (f[0] ? 0 : lat), z = c[2] + 0.5 + f[1] * 0.52 + (f[1] ? 0 : lat), y = c[1] + h.reel() * 6 / 16;
        sim.particule('smoke', x, y, z, 0, 0, 0, 1); sim.particule('flame', x, y, z, 0, 0, 0, 1);
      }
    }
  }
}
