// Meteo du monde simule : pluie, neige, orage, foudre. Port de ServerLevel.tickPrecipitation / tickChunk, Level.isRainingAt, LightningBolt (Horizon world/level/weather.rs,
// client/game/{weather,lightning}.rs : MIT, voir ATTRIBUTIONS.md). Les niveaux de pluie et d'orage viennent de la piste `ciel.meteo` de la scene (film/meteo.js).
//   - il pleut (isRaining) si le niveau de pluie > 0,2 ; il y a de l'orage (isThundering) si le niveau d'orage > 0,9
//   - Level.isRainingAt(pos) : il pleut, rien qui arrete le mouvement au-dessus (carte des hauteurs MOTION_BLOCKING), et le biome donne de la pluie
//   - biome : temperature <= 0,15 (diminuee de 0,05 / 40 par bloc au-dessus de 80) : neige, sinon pluie ; sans precipitation (desert...) rien ; `has_precipitation` et la temperature
//     viennent des donnees du jeu (`biomes`)
//   - par tick et par colonne de 16 x 16 de la region : une chance sur 16 de tirer une position : l'eau gele (biome froid, lumiere de bloc < 10), la neige se pose (1 couche, jusqu'a
//     `meteo.neigeMax`) ; la pluie eteint le feu (0,2 + age x 0,03) et humidifie la terre labouree (farmland, via monde.pleut)
//   - orage : par colonne et par tick une chance sur 100 000 (regle `meteo.foudre` : multiplicateur) de foudre ; le coup tombe sur le dessus de la colonne, 5 degats aux acteurs a
//     moins de 3 blocs, feu (4 essais), eclair visible 1 a 3 fois, tonnerre et impact
import { niveauxMeteo } from '../film/meteo.js';

const RAD = Math.PI / 180;

export class Meteo {
  // piste : { etats, foudres } (film/meteo.js) ; null : pas de meteo
  constructor(sim, piste) {
    this.sim = sim; this.piste = piste; this.eclairs = []; this.iFoudre = 0; this.colonnes = null; this.sommet = null;
  }

  // ------------------------------------------------------------ niveaux
  tempsFilm(tick) { return tick / (20 * (this.sim.replay.ralenti || 1)); }
  niveaux(tick = this.sim.temps) { return niveauxMeteo(this.piste, this.tempsFilm(tick)); }
  pleut(tick) { return this.niveaux(tick).pluie > 0.2; }
  orage(tick) { return this.niveaux(tick).orage > 0.9; }

  // ------------------------------------------------------------ biome et hauteur
  biomeDe(x, z) {
    const m = this.sim.monde, zone = this.sim.zone;
    try { return zone.biome(Math.max(m.x0, Math.min(m.x0 + m.sx - 1, x)), Math.max(m.z0, Math.min(m.z0 + m.sz - 1, z))); } catch { return ''; }
  }
  // temperature du biome a la hauteur y (Biome.getTemperature, sans le bruit)
  temperature(x, y, z) {
    const b = this.sim.d.biome(this.biomeDe(x, z));
    if (!b) return 0.8;
    let t = b[2] ? Math.min(b[0], 0) : b[0];
    if (y > 63 + 17) t -= (y - 63 - 17) * 0.05 / 40;
    return t;
  }
  // 'pluie' | 'neige' | null selon le biome de la colonne a la hauteur y
  precipitation(x, y, z) {
    const b = this.sim.d.biome(this.biomeDe(x, z));
    if (!b || !b[1]) return null;
    return this.temperature(x, y, z) < 0.15 ? 'neige' : 'pluie';
  }
  // hauteur MOTION_BLOCKING : 1 au-dessus du bloc le plus haut qui arrete le mouvement ou tient un fluide
  hauteur(x, z) {
    const m = this.sim.monde, api = this.sim.api;
    for (let y = m.y0 + m.sy - 1; y >= m.y0; y--) { if (api.boites(x, y, z).length > 0 || api.fluide(x, y, z).type) return y + 1; }
    return m.y0;
  }
  // Level.isRainingAt
  pleutEn(x, y, z) {
    if (!this.piste || !this.sim.regles.valeur('meteo.actif', true) || !this.pleut(this.sim.temps)) return false;
    if (this.hauteur(x, z) > y) return false;
    return this.precipitation(x, y, z) === 'pluie';
  }

  // ------------------------------------------------------------ colonnes de la region (celles de 16 x 16)
  _colonnes() {
    if (this.colonnes) return this.colonnes;
    const m = this.sim.monde, a = m.ancre, vu = new Set(), l = [];
    for (const [sx, , sz] of this.sim.regionSections) { const k = sx + ',' + sz; if (vu.has(k)) continue; vu.add(k); l.push([a[0] + sx * 16, a[2] + sz * 16]); }
    return (this.colonnes = l);
  }

  // ------------------------------------------------------------ un tick (avant les ticks aleatoires, comme ServerLevel.tickChunk)
  tick() {
    const sim = this.sim, R = sim.regles, h = sim.hasard;
    if (!this.piste || !R.valeur('meteo.actif', true)) return;
    const t = sim.temps;
    // foudres de la scene
    while (this.iFoudre < this.piste.foudres.length) {
      const f = this.piste.foudres[this.iFoudre], tf = Math.floor(f.t * 20 * (sim.replay.ralenti || 1) + 1e-9);
      if (tf > t) break;
      this.iFoudre++;
      if (f.x !== undefined) this.foudre(f.x, f.z, f.y);
      else { const c = this._colonnes(); if (c.length) { const [cx, cz] = c[h.entierBorne(c.length)]; this.foudre(cx + h.entierBorne(16), cz + h.entierBorne(16)); } }
    }
    const n = this.niveaux(t), pluie = n.pluie > 0.2, orage = n.orage > 0.9;
    const mult = R.valeur('meteo.foudre', 1);
    for (const [cx, cz] of this._colonnes()) {
      if (orage && pluie && h.entierBorne(100000) < mult) this.foudre(cx + h.entierBorne(16), cz + h.entierBorne(16));
      if (h.entierBorne(16) === 0) this.precipiter(cx + h.entierBorne(16), cz + h.entierBorne(16), pluie);
    }
  }

  // ServerLevel.tickPrecipitation pour la colonne (x, z)
  precipiter(x, z, pluie) {
    const sim = this.sim, R = sim.regles, api = sim.api, m = sim.monde;
    if (x < m.x0 || x >= m.x0 + m.sx || z < m.z0 || z >= m.z0 + m.sz) return;
    const top = this.hauteur(x, z), dessous = top - 1;
    const type = this.precipitation(x, top, z);
    // gel de l'eau (Biome.shouldFreeze) : biome froid, source d'eau, au moins un voisin horizontal qui n'est pas de l'eau, lumiere de bloc < 10
    if (R.valeur('meteo.gel', true) && type === 'neige' && api.fluide(x, dessous, z).type === 'water' && api.fluide(x, dessous, z).source) {
      const b = api.bloc(x, dessous, z);
      if (b.nom === 'minecraft:water' && sim.lumiere().niveauBloc(x, dessous, z) < 10 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => api.fluide(x + a, dessous, z + c).type !== 'water')) {
        sim.poser(x, dessous, z, 'minecraft:ice', 3);
        sim.stats.gels = (sim.stats.gels || 0) + 1;
      }
    }
    if (!pluie || !type) return;
    if (type === 'neige') {
      if (sim.lumiere().niveauBloc(x, top, z) >= 10) return;
      const e = api.bloc(x, top, z), max = R.valeur('meteo.neigeMax', 1);
      if (max <= 0) return;
      if (e.nom === 'minecraft:snow') {
        const k = Number(e.etat.layers);
        if (k < max && k < 8) { sim.poser(x, top, z, `minecraft:snow[layers=${k + 1}]`, 3); sim.stats.neige = (sim.stats.neige || 0) + 1; }
      } else if (e.nom === 'minecraft:air' || api.remplacable(x, top, z)) {
        const s = api.bloc(x, dessous, z);
        if (!/ice|snow_block|powder_snow|barrier/.test(s.nom) && api.appui(x, dessous, z, 'haut', 'plein') && !/water|lava/.test(s.nom)) { sim.poser(x, top, z, 'minecraft:snow[layers=1]', 3); sim.stats.neige = (sim.stats.neige || 0) + 1; }
      }
    }
  }

  // ------------------------------------------------------------ foudre
  // Coup de foudre sur la colonne (x, z), au sol (ou en y si donne). visuel : sans feu ni degats
  foudre(x, z, y, opt = {}) {
    const sim = this.sim, R = sim.regles, h = sim.hasard;
    x = Math.floor(x) + 0.5; z = Math.floor(z) + 0.5;
    const sol = y ?? this.hauteur(Math.floor(x), Math.floor(z));
    const e = { id: sim.entites.prochain++, x, y: sol, z, vie: 2, eclats: h.entierBorne(3) + 1, graine: h.entier(), visuel: !!opt.visuel, debut: sim.temps };
    this.eclairs.push(e);
    sim.stats.foudres = (sim.stats.foudres || 0) + 1;
    sim.dire(`foudre en ${x.toFixed(1)},${sol},${z.toFixed(1)}`);
    sim.son('entity.lightning_bolt.thunder', x, sol, z, 6, 0.8 + h.flottant() * 0.2);
    sim.son('entity.lightning_bolt.impact', x, sol, z, 2, 0.5 + h.flottant() * 0.2);
    if (!e.visuel && R.valeur('meteo.foudreFeu', true)) this.feu(e, 4);
    this.ecrire(e);
    sim.api.evenement('meteo.foudre', { pos: [x, sol, z] });
    return e;
  }
  // LightningBolt.spawnFire : le feu a la position du coup, puis `n` essais a +-1
  feu(e, n) {
    const sim = this.sim, api = sim.api, h = sim.hasard, bx = Math.floor(e.x), by = e.y, bz = Math.floor(e.z);
    const essai = (x, y, z) => {
      if (api.bloc(x, y, z).nom !== 'minecraft:air') return;
      if (api.survitEtat(x, y, z, 'minecraft:fire[age=0]')) sim.poser(x, y, z, 'minecraft:fire[age=0]', 3);
    };
    essai(bx, by, bz);
    for (let i = 0; i < n; i++) essai(bx + h.entierBorne(3) - 1, by + h.entierBorne(3) - 1, bz + h.entierBorne(3) - 1);
  }
  // un tick des eclairs (phase des entites) : degats aux acteurs a moins de 3 blocs, nouvel eclair ou fin (LightningBolt.tick)
  tickEclairs() {
    const sim = this.sim, h = sim.hasard, R = sim.regles;
    if (!this.eclairs.length) return;
    for (const e of [...this.eclairs]) {
      if (e.debut === sim.temps) continue;
      e.vie--;
      if (e.vie < 0) {
        if (e.eclats === 0) { this.eclairs.splice(this.eclairs.indexOf(e), 1); continue; }
        if (e.vie < -h.entierBorne(10)) { e.eclats--; e.vie = 1; e.graine = h.entier(); if (!e.visuel && R.valeur('meteo.foudreFeu', true)) this.feu(e, 0); }
      }
      if (e.vie >= 0 && !e.visuel) {
        for (const a of sim.acteurs ? sim.acteurs.liste : []) {
          const b = a.boite();
          if (b[3] > e.x - 3 && b[0] < e.x + 3 && b[4] > e.y - 3 && b[1] < e.y + 9 && b[5] > e.z - 3 && b[2] < e.z + 3 && a.mort < 0) {
            // Entity.thunderHit (une fois par eclair) : villageois -> sorciere, cochon -> piglin zombifie, creeper charge, champimeuh qui change de couleur
            if (a.ia && !(e.touches ??= new Set()).has(a)) { e.touches.add(a); if (a.ia.foudroye?.(e)) continue; }
            a.degats(R.valeur('meteo.foudreDegats', 5), 'foudre');
          }
        }
      }
      this.ecrire(e);
    }
  }
  // replay : entite 'foudre' : (x, y, z, graine, vie) ; une vie >= 0 est un instant d'eclair (le ciel flashe)
  ecrire(e) { this.sim.replay.entite(this.sim.temps, e.id, 'foudre', e.x, e.y, e.z, e.graine, e.vie); }
}
void RAD;
