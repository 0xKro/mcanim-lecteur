// Vibrations du jeu (VibrationSystem, SculkSensorBlock, Warden.VibrationUser), en version compacte : un evenement de jeu (pas, bloc pose ou
// casse, projectile qui atterrit, explosion...) a une position ; les ecouteurs a portee (capteurs de sculk : 8 blocs ; warden : 16 blocs depuis
// ses yeux) le recoivent apres floor(distance) ticks (le trajet de la particule `vibration`). Un pas d'un acteur accroupi est ignore
// (#ignored_when_sneaking : pas, chute, ...). Rien n'est calcule tant qu'il n'y a ni warden a IA ni capteur de sculk dans le monde : les
// scenes d'avant ne changent pas d'un octet.
// Port depuis Horizon (MIT, voir ATTRIBUTIONS.md) : table des frequences et #ignored_when_sneaking (horizon-client-render/src/sculk.rs
// `EVENTS`, `ignored_when_sneaking`, `redstone_strength` : max(1, 15 - floor(15 / 8 x d))), capteur 30 ticks actif (calibre 10), 10 de repos
// (horizon-world/src/level/sculk.rs), warden (mobs/warden.rs listen / receive_vibration).

// frequence de chaque evenement (VibrationSystem.getGameEventFrequency, table de Horizon `sculk.rs` EVENTS) ; les pistons du jeu postent
// block_activate (sortie) et block_deactivate (rentree)
export const FREQUENCES = { step: 1, swim: 1, flap: 1, projectile_land: 2, hit_ground: 2, splash: 2, bounce: 2, item_interact_finish: 3, projectile_shoot: 3, instrument_play: 3, entity_action: 4, elytra_glide: 4, unequip: 4, entity_dismount: 5, equip: 5, entity_interact: 6, shear: 6, entity_mount: 6, entity_damage: 7, drink: 8, eat: 8, container_close: 9, block_close: 9, block_deactivate: 9, block_detach: 9, container_open: 10, block_open: 10, block_activate: 10, block_attach: 10, prime_fuse: 10, note_block_play: 10, block_change: 11, block_destroy: 12, fluid_pickup: 12, block_place: 13, fluid_place: 13, entity_place: 14, lightning_strike: 14, teleport: 14, entity_die: 15, explode: 15, piston_extend: 10, piston_contract: 9 };
const SNEAK = new Set(['hit_ground', 'projectile_shoot', 'step', 'swim', 'item_interact_start', 'item_interact_finish']);   // #ignored_when_sneaking
export const PORTEE_CAPTEUR = 8, PORTEE_WARDEN = 16, ACTIF = 30, ACTIF_CALIBRE = 10, REPOS = 10;
const CAPTEUR = /^(calibrated_)?sculk_sensor$/;

export class Vibrations {
  constructor(sim) { this.sim = sim; this.enVol = []; this.capteurs = new Map(); this._nPal = -1; this._aCapteur = false; }
  // un capteur de sculk existe-t-il dans le monde ? (palette du monde : recalcule quand elle grandit)
  aCapteurs() {
    const p = this.sim.monde.palette;
    if (p.length !== this._nPal) { this._nPal = p.length; this._aCapteur = p.some((s) => /sculk_sensor/.test(s)); }
    return this._aCapteur;
  }
  wardens() { return this.sim.acteurs ? this.sim.acteurs.liste.filter((a) => a.ia?.type === 'warden' && a.mort < 0) : []; }
  actif() { return this.aCapteurs() || this.wardens().length > 0; }
  // un evenement de jeu : nom (FREQUENCES), position, source (acteur ou null), proprietaire (lanceur d'un projectile), accroupi
  emettre(nom, x, y, z, { source = null, proprietaire = null, accroupi = false } = {}) {
    if (!FREQUENCES[nom] || !this.actif()) return 0;
    const sim = this.sim;
    if (accroupi && SNEAK.has(nom)) return 0;
    let n = 0;
    // capteurs de sculk a 8 blocs (cellules), le plus proche d'abord ; chacun ne recoit qu'une vibration a la fois
    if (this.aCapteurs()) {
      const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
      for (let dx = -PORTEE_CAPTEUR; dx <= PORTEE_CAPTEUR; dx++) for (let dy = -PORTEE_CAPTEUR; dy <= PORTEE_CAPTEUR; dy++) for (let dz = -PORTEE_CAPTEUR; dz <= PORTEE_CAPTEUR; dz++) {
        if (dx * dx + dy * dy + dz * dz > PORTEE_CAPTEUR * PORTEE_CAPTEUR) continue;
        const e = sim.monde.etatEn(X + dx, Y + dy, Z + dz);
        if (e < 0 || !CAPTEUR.test(sim.d.nomBloc(e)) || sim.d.prop(e, 'sculk_sensor_phase') !== 'inactive') continue;
        const c = [X + dx, Y + dy, Z + dz], k = c.join();
        if (this.enVol.some((v) => v.cle === k)) continue;
        if (source && sim.acteurs?.parNom.get(source)?.ia?.type === 'warden') continue;   // le warden etouffe ses propres vibrations
        const d = Math.hypot(x - c[0] - 0.5, y - c[1] - 0.5, z - c[2] - 0.5);
        this.enVol.push({ cle: k, capteur: c, nom, de: [x, y, z], vers: [c[0] + 0.5, c[1] + 0.5, c[2] + 0.5], arrivee: sim.temps + Math.floor(d), distance: d, source });
        this.particuleTrajet([x, y, z], [c[0] + 0.5, c[1] + 0.5, c[2] + 0.5], Math.floor(d));
        n++;
      }
    }
    // wardens a 16 blocs de leurs yeux (Warden.VibrationUser) : un pas d'un warden ne compte pas
    for (const w of this.wardens()) {
      if (w.nom === source) continue;
      const r = w.ia.entendre?.(nom, [x, y, z], { source, proprietaire });
      if (r) { this.particuleTrajet([x, y, z], w.oeil(), r.ticks); n++; }
    }
    sim.stats.vibrations = (sim.stats.vibrations || 0) + n;
    return n;
  }
  // la particule `vibration` va de la source a l'ecouteur en `ticks` ticks (VibrationParticle) : son point de depart et sa duree dans le champ vx..vz
  particuleTrajet(de, vers, ticks) { this.sim.particule('vibration', de[0], de[1], de[2], vers[0], vers[1], vers[2], Math.max(1, ticks)); }
  // un tick : vibrations arrivees aux capteurs ; capteurs actifs qui se reposent puis se rearment
  tick() {
    const sim = this.sim;
    if (!this.enVol.length && !this.capteurs.size) return;
    for (const v of [...this.enVol]) {
      if (sim.temps < v.arrivee) continue;
      this.enVol.splice(this.enVol.indexOf(v), 1);
      const [x, y, z] = v.capteur, e = sim.monde.etatEn(x, y, z);
      if (e < 0 || !CAPTEUR.test(sim.d.nomBloc(e)) || sim.d.prop(e, 'sculk_sensor_phase') !== 'inactive') continue;
      const puissance = Math.max(1, 15 - Math.floor(15 * v.distance / PORTEE_CAPTEUR));
      sim.poser(x, y, z, sim.d.chaine(e).replace(/sculk_sensor_phase=\w+/, 'sculk_sensor_phase=active').replace(/power=\d+/, `power=${puissance}`), 3);
      this.capteurs.set(v.cle, { pos: v.capteur, fin: sim.temps + (/calibrated/.test(sim.d.nomBloc(e)) ? ACTIF_CALIBRE : ACTIF), phase: 'active' });
      sim.son('block.sculk_sensor.clicking', x + 0.5, y + 0.5, z + 0.5, 1, sim.hasard.flottant() * 0.2 + 0.8);
      (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} capteur de sculk ${v.capteur.join(',')} : ${v.nom} (puissance ${puissance})`);
      sim.stats.capteurs = (sim.stats.capteurs || 0) + 1;
    }
    for (const [k, c] of [...this.capteurs]) {
      if (sim.temps < c.fin) continue;
      const [x, y, z] = c.pos, e = sim.monde.etatEn(x, y, z);
      if (e < 0 || !CAPTEUR.test(sim.d.nomBloc(e))) { this.capteurs.delete(k); continue; }
      if (c.phase === 'active') {
        sim.poser(x, y, z, sim.d.chaine(e).replace(/sculk_sensor_phase=\w+/, 'sculk_sensor_phase=cooldown').replace(/power=\d+/, 'power=0'), 3);
        sim.son('block.sculk_sensor.clicking_stop', x + 0.5, y + 0.5, z + 0.5, 1, sim.hasard.flottant() * 0.2 + 0.8);
        c.phase = 'repos'; c.fin = sim.temps + REPOS;
      } else { sim.poser(x, y, z, sim.d.chaine(e).replace(/sculk_sensor_phase=\w+/, 'sculk_sensor_phase=inactive'), 3); this.capteurs.delete(k); }
    }
  }
}
