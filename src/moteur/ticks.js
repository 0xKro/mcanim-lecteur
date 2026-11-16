// Ticks planifies : la file de Horizon (horizon-core/src/ticks/mod.rs, LevelTicks, MIT) en JavaScript.
// - un tick = (type de bloc, position, moment, priorite, numero d'ordre) ; un seul tick par (type, position) a la fois ;
// - les ticks sont rangés par "chunk" (colonne 16x16) ; dans un chunk : moment, puis priorite, puis ordre d'insertion ;
// - a chaque tick du jeu on collecte ceux qui sont arrives a echeance (65 536 au plus), les chunks se disputent par priorite
//   puis ordre d'insertion (PAS par moment) ; un tick planifie PENDANT l'execution attend le tick suivant.
export const PRIORITE = { tresHaute: -3, trèsHaute: -3, haute: -1, normale: 0, basse: 1, tresBasse: 2, extremementBasse: 3 };
export const MAX_PAR_TICK = 65536;

const cmpDrain = (a, b) => a.declenche - b.declenche || a.priorite - b.priorite || a.ordre - b.ordre;
const cmpIntra = (a, b) => a.priorite - b.priorite || a.ordre - b.ordre;

class Tas {   // tas binaire (file de priorite) selon cmpDrain
  constructor() { this.a = []; }
  get taille() { return this.a.length; }
  tete() { return this.a[0]; }
  pousser(x) {
    const a = this.a; a.push(x);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (cmpDrain(a[i], a[p]) >= 0) break; [a[i], a[p]] = [a[p], a[i]]; i = p; }
  }
  tirer() {
    const a = this.a, haut = a[0], dernier = a.pop();
    if (a.length) {
      a[0] = dernier;
      let i = 0;
      for (;;) {
        const g = 2 * i + 1, d = g + 1; let m = i;
        if (g < a.length && cmpDrain(a[g], a[m]) < 0) m = g;
        if (d < a.length && cmpDrain(a[d], a[m]) < 0) m = d;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return haut;
  }
}

export class FileTicks {
  constructor() { this.chunks = new Map(); this.presents = new Set(); this.ordre = 0; }
  get nb() { return this.presents.size; }
  cle(type, x, y, z) { return `${type}|${x}|${y}|${z}`; }
  estPlanifie(type, x, y, z) { return this.presents.has(this.cle(type, x, y, z)); }
  // temps : tick courant ; rend vrai si le tick est nouveau (faux : un tick (type, position) existait deja, l'ancien reste)
  planifier(temps, type, x, y, z, delai = 0, priorite = 0) {
    const k = this.cle(type, x, y, z);
    if (this.presents.has(k)) return false;
    this.presents.add(k);
    const ck = `${x >> 4},${z >> 4}`;
    let c = this.chunks.get(ck);
    if (!c) { c = new Tas(); this.chunks.set(ck, c); }
    c.pousser({ type, x, y, z, declenche: temps + Math.max(0, delai | 0), priorite: Math.max(-3, Math.min(3, priorite | 0)), ordre: this.ordre++, cle: k, ck });
    return true;
  }
  // Ticks arrives a echeance au tick `temps`, dans l'ordre d'execution du jeu. Ils sont retires de la file.
  collecter(temps, max = MAX_PAR_TICK) {
    const dus = [];
    for (const [ck, c] of [...this.chunks.entries()].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {
      const t = c.tete();
      if (t && t.declenche <= temps) dus.push([ck, c]);
    }
    const sortie = [];
    while (sortie.length < max && dus.length) {
      // le chunk dont la tete a la meilleure (priorite, ordre) ; les autres attendent
      let m = 0;
      for (let i = 1; i < dus.length; i++) if (cmpIntra(dus[i][1].tete(), dus[m][1].tete()) < 0) m = i;
      const c = dus[m][1], t = c.tirer();
      sortie.push(t); this.presents.delete(t.cle);
      const h = c.tete();
      if (!h) { this.chunks.delete(dus[m][0]); dus.splice(m, 1); } else if (h.declenche > temps) dus.splice(m, 1);
    }
    return sortie;
  }
}
