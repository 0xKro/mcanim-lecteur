// Nuage d'effet d'une potion persistante (AreaEffectCloud, ThrownLingeringPotion.makeAreaOfEffectCloud ; docs/SIMULATION.md partie 26) :
// rayon 3, -0,5 a chaque utilisation, se retrecit de rayon / duree par tick, 600 ticks, 10 ticks d'attente ; toutes les 5 ticks, les vivants a
// l'interieur (une fois par 20 ticks chacun) prennent les effets (duree x 0,25 : potion_duration_scale de la potion persistante ; instantanes a
// la moitie) ; il disparait sous un rayon de 0,5. Particules d'effet de la couleur de la potion. (Valeurs de AreaEffectCloud du jeu 26.3.)
import { couleurPotion } from './potions.js';

export class Nuages {
  constructor(sim) { this.sim = sim; }
  creer(pos, effets, proprietaire) {
    const sim = this.sim, E = sim.entites;
    const echelle = sim.d.j.objets?.lingering_potion?.[11] ?? 0.25;
    const e = { id: E.prochain++, type: 'nuage', x: pos[0], y: pos[1], z: pos[2], debut: sim.temps, age: 0, rayon: 3, duree: 600, attente: 10, parTick: -3 / 600, surUsage: -0.5, delai: 20, victimes: new Map(),
      effets: effets.map(([id, t, n]) => [id, Math.max(1, Math.floor(t * echelle)), n]), couleur: couleurPotion(effets), proprietaire: proprietaire?.nom ?? null };
    e.tickPerso = (x) => this.tick(x);
    e.ecrirePerso = (x) => sim.replay.entite(sim.temps, x.id, 'nuage', x.x, x.y, x.z, x.rayon, x.couleur);
    E.liste.push(e);
    sim.stats.nuages = (sim.stats.nuages || 0) + 1;
    sim.dire(`nuage de potion persistante en ${pos.map((c) => c.toFixed(1)).join(',')}`);
    return e;
  }
  tick(e) {
    const sim = this.sim;
    e.age++;
    if (e.age >= e.attente + e.duree) return false;
    const attend = e.age < e.attente;
    if (!attend) { e.rayon += e.parTick; if (e.rayon < 0.5) return false; }
    // particules (client) : une par tick environ par unite de surface, couleur de la potion
    const n = Math.ceil(Math.PI * e.rayon * e.rayon / 4), h = sim.hasard;
    for (let i = 0; i < Math.min(n, 12); i++) { const a = h.flottant() * Math.PI * 2, r = Math.sqrt(h.flottant()) * e.rayon; sim.particule(`entity_effect|${(((e.couleur >> 16) & 255) / 255).toFixed(3)},${(((e.couleur >> 8) & 255) / 255).toFixed(3)},${((e.couleur & 255) / 255).toFixed(3)}`, e.x + Math.cos(a) * r, e.y, e.z + Math.sin(a) * r, 0, 0, 0, 1); }
    if (attend || e.age % 5 !== 0) return true;
    for (const [a, t] of [...e.victimes]) if (e.age >= t) e.victimes.delete(a);
    for (const a of sim.acteurs ? sim.acteurs.liste : []) {
      if (a.mort >= 0 || e.victimes.has(a)) continue;
      const dx = a.x - e.x, dz = a.z - e.z;
      if (dx * dx + dz * dz > e.rayon * e.rayon || a.y + a.H < e.y || a.y > e.y + 0.5) continue;
      e.victimes.set(a, e.age + e.delai);
      for (const [id, t, niv] of e.effets) {
        if (id === 'instant_damage' || id === 'instant_health') a.appliquerEffet(id, 1, niv, { force: 0.5 }); else a.appliquerEffet(id, t, niv);
      }
      e.rayon += e.surUsage;
      if (e.rayon <= 0) return false;
    }
    return true;
  }
}
