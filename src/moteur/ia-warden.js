// Le warden (champ `ia: true`), melange a la classe IA de ia.js : vibrations entendues a 16 blocs (moteur/vibrations.js), colere par suspect
// (AngerManagement : +35 par vibration, +10 pour un projectile, +20 au rugissement ; -1 par seconde ; 80 = en colere, 150 au plus), cerveau
// du jeu en version compacte (WardenAi : sortir de terre 134 ticks, creuser 100 ticks apres 1200 ticks de calme, rugir 84 ticks, flairer 84 ticks,
// enqueter sur une vibration a 0,7, combattre a 1,2 : coup de 30, onde sonique : charge, a 34 ticks le rayon (particules), 10 degats qui ignorent
// l'armure, recul 2,5 / 0,5 ; 40 ticks de repos), Obscurite (260 ticks) aux joueurs a 20 blocs toutes les 120 ticks.
// Port d'apres Horizon (MIT, voir ATTRIBUTIONS.md) : mobs/warden.rs (increase_anger, receive_vibration, tick_sonic_boom, server_ai_step),
// mobs/warden_brain.rs (activites, durees, vitesses, delais).
const journal = (sim, t) => (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${t}`);
export const POSTURES = ['standing', 'emerging', 'digging', 'roaring', 'sniffing'];
const DUREE = { emerging: 134, digging: 100, roaring: 84, sniffing: 84 };

export const METHODES_WARDEN = {
  initWarden(d) {
    if (this.type !== 'warden') return;
    this.colereDe = new Map();            // nom -> colere
    this.digFin = this.sim.temps + 1200;   // DIG_COOLDOWN : 1200 ticks a l'apparition, rafraichi a chaque colere
    this.vibCooldown = 0; this.vibEnVol = null; this.flairCooldown = 0; this.trouble = null; this.cibleW = null; this.rugirCible = null;
    this.posture = 'standing'; this.postureT = 0; this.soniqueCd = 0; this.soniqueT = -1; this.coupCd = 0; this.projRecent = -1e9; this.vrille = -100;
    this.animAttaque = -100; this.animSonique = -100;
    if (d.emerge) this.poser_posture('emerging');
  },
  installerWarden(add) { if (this.type !== 'warden') return false; add(0, 'flotte', 0); return true; },   // tout le reste : le cerveau (avantWarden)
  poser_posture(p) {
    if (p === this.posture) return;
    this.posture = p; this.postureT = this.sim.temps;
    const a = this.a, sim = this.sim;
    if (p === 'emerging') sim.son('entity.warden.emerge', a.x, a.y, a.z, 1, 1);
    if (p === 'digging') sim.son('entity.warden.dig', a.x, a.y, a.z, 1, 1);
    if (p === 'sniffing') sim.son('entity.warden.sniff', a.x, a.y, a.z, 5, 1);
    if (p !== 'standing') journal(sim, `${a.nom} : ${p}`);
  },
  peutCibler(o) { return !!o && o.mort < 0 && (o.ia?.type ?? o.typeCreature ?? 'joueur') !== 'warden' && o.typeCreature !== 'end_crystal' && !o.invulnerable; },
  colereActive() {
    if (this.cibleW && this.colereDe.has(this.cibleW.nom)) return this.colereDe.get(this.cibleW.nom);
    let m = 0; for (const v of this.colereDe.values()) m = Math.max(m, v); return m;
  },
  enColere() { return this.colereActive() >= 80; },
  // Warden.getEntityAngryAt : le suspect le plus en colere (et ciblable), s'il est a 80 ou plus
  suspect() {
    let best = null, bv = -1;
    for (const [nom, v] of this.colereDe) { const o = this.sim.acteurs.parNom.get(nom); if (this.peutCibler(o) && v > bv) { bv = v; best = o; } }
    return best && bv >= 80 ? best : null;
  },
  // increaseAngerAt : +n (150 au plus), le delai pour creuser repart ; le son d'ecoute (sauf en rugissant)
  colere(o, n, son = true) {
    if (!this.peutCibler(o)) return;
    this.digFin = this.sim.temps + 1200;
    const v = Math.min(150, (this.colereDe.get(o.nom) ?? 0) + n);
    this.colereDe.set(o.nom, v);
    if (o.ia === undefined || !o.ia) { if (v >= 80 && this.cibleW && this.cibleW.ia) this.cibleW = null; }   // un joueur en colere passe devant
    if (son && this.posture !== 'roaring') { const a = this.a; this.sim.son(this.enColere() || v >= 40 ? 'entity.warden.listening_angry' : 'entity.warden.listening', a.x, a.y, a.z, 10, 1 + (this.h.flottant() - this.h.flottant()) * 0.2); }
    this.stat('coleres');
  },
  // VibrationSystem.Listener : une vibration a 16 blocs (cellules) de ses yeux, s'il n'en ecoute pas deja une, sans repos, ni sous terre ;
  // elle arrive dans floor(distance) ticks
  entendre(nom, pos, { source = null, proprietaire = null } = {}) {
    const a = this.a, [ex, ey, ez] = a.oeil();
    if (this.vibEnVol || this.sim.temps < this.vibCooldown || this.posture === 'digging' || this.posture === 'emerging' || a.mort >= 0) return null;
    const d2c = (Math.floor(pos[0]) - Math.floor(ex)) ** 2 + (Math.floor(pos[1]) - Math.floor(ey)) ** 2 + (Math.floor(pos[2]) - Math.floor(ez)) ** 2;
    if (d2c > 256) return null;
    const src = source ? this.sim.acteurs.parNom.get(source) : null;
    if (src && !this.peutCibler(src)) return null;
    const d = Math.hypot(pos[0] - ex, pos[1] - ey, pos[2] - ez), ticks = Math.floor(d);
    this.vibEnVol = { nom, pos: pos.slice(), source: src, proprietaire: proprietaire ? this.sim.acteurs.parNom.get(proprietaire) ?? null : null, arrivee: this.sim.temps + ticks };
    return { ticks };
  },
  // onReceiveVibration : 40 ticks de repos, les vrilles tressaillent (son), colere contre la source (+35) ou le lanceur (+10, puis +35) ;
  // pas encore en colere : il va voir (trouble, 100 ticks)
  recevoirVibration(v) {
    const a = this.a, sim = this.sim;
    this.vibCooldown = sim.temps + 40; this.vrille = sim.temps;
    sim.son('entity.warden.tendril_clicks', a.x, a.y, a.z, 5, 1 + (this.h.flottant() - this.h.flottant()) * 0.2);
    let susp = v.pos.map(Math.floor);
    if (v.proprietaire) {
      if (this.dist2(v.proprietaire) < 900) {
        if (sim.temps - this.projRecent < 100) { if (this.peutCibler(v.proprietaire)) susp = [v.proprietaire.x, v.proprietaire.y, v.proprietaire.z].map(Math.floor); this.colere(v.proprietaire, 35); }
        else this.colere(v.proprietaire, 10);
      }
      this.projRecent = sim.temps;
    } else if (v.source) this.colere(v.source, 35);
    if (!this.enColere()) { const act = this.suspect(); if (v.proprietaire || !act || act === v.source) this.troubler(susp); }
    this.stat('vibrationsEntendues'); journal(sim, `${a.nom} entend ${v.nom} (${v.pos.map((q) => q.toFixed(0)).join(',')})`);
  },
  troubler(p) {   // WardenAi.setDisturbanceLocation
    if (this.suspect() || this.cibleW) return;
    this.digFin = this.sim.temps + 1200; this.flairCooldown = this.sim.temps + 100;
    this.trouble = { pos: p, fin: this.sim.temps + 100 }; this.nav = null;
  },
  ciblesWarden() { if (this.type !== 'warden') return false; this.cible = this.cibleW; return true; },
  // le cerveau, chaque tick (Warden.customServerAiStep, WardenAi)
  avantWarden() {
    if (this.type !== 'warden') return;
    const a = this.a, sim = this.sim, h = this.h, t = sim.temps;
    if (this.vibEnVol && t >= this.vibEnVol.arrivee) { const v = this.vibEnVol; this.vibEnVol = null; this.recevoirVibration(v); }
    // la colere baisse de 1 par seconde ; les suspects morts ou partis sont oublies
    if (t % 20 === 0) for (const [nom, v] of [...this.colereDe]) { const o = sim.acteurs.parNom.get(nom); if (v > 1 && this.peutCibler(o)) this.colereDe.set(nom, v - 1); else this.colereDe.delete(nom); }
    // Obscurite aux joueurs a 20 blocs toutes les 120 ticks (260 ticks, renouvelee sous 200)
    if ((t + a.id) % 120 === 0) for (const o of this.autres()) { if (this.typeDe(o) !== 'joueur' || this.dist2(o) > 400) continue; const e = o.effets.get('darkness'); if (!e || e.fin - t < 200) { o.appliquerEffet('darkness', 260, 0); this.stat('obscurites'); } }
    // poussee : un acteur qui le touche le met en colere (+35, une fois par seconde)
    for (const o of this.autres()) if (this.auContact(o) && this.peutCibler(o) && t - (this.toucheT ?? -1e9) >= 20) { this.toucheT = t; this.colere(o, 35); this.troubler([o.x, o.y, o.z].map(Math.floor)); }
    // les postures en cours vont au bout de leur duree
    const p = this.posture, ecoule = t - this.postureT;
    a.entree.avance = 0;
    if (p === 'emerging') { this.nav = null; if (ecoule >= DUREE.emerging) this.poser_posture('standing'); return; }
    if (p === 'digging') { this.nav = null; if (ecoule >= DUREE.digging) { a.mort = 21; a.mortSansCorps = true; journal(sim, `${a.nom} s est enterre`); this.stat('enterres'); } return; }
    if (p === 'roaring') {
      this.nav = null; if (this.rugirCible) this.viseW(this.rugirCible);
      if (ecoule === 25) sim.son('entity.warden.roar', a.x, a.y, a.z, 3, 1);
      if (ecoule >= DUREE.roaring) { this.poser_posture('standing'); if (this.rugirCible) { this.cibleW = this.rugirCible; this.soniqueCd = t + 200; journal(sim, `${a.nom} attaque ${this.cibleW.nom}`); } this.rugirCible = null; }
      return;
    }
    if (p === 'sniffing') {
      this.nav = null;
      if (ecoule >= DUREE.sniffing) {
        this.poser_posture('standing');
        const o = this.plusProche();
        if (o) { if ((o.x - a.x) ** 2 + (o.z - a.z) ** 2 < 36 && (o.y - a.y) ** 2 < 400) this.colere(o, 35); if (!this.trouble) this.troubler([o.x, o.y, o.z].map(Math.floor)); }
      }
      return;
    }
    // updateActivity : creuser, rugir, combattre, enqueter, flairer, rien
    if (this.trouble && t >= this.trouble.fin) this.trouble = null;
    const s = this.suspect();
    if (!this.rugirCible && !this.cibleW && t >= this.digFin && sim.regles.valeur('ia.wardenCreuse', true)) { this.poser_posture('digging'); return; }
    if (!this.cibleW && s) { this.rugirCible = s; this.poser_posture('roaring'); this.colere(s, 20, false); return; }
    if (this.cibleW) { this.tickCombatWarden(); return; }
    if (this.trouble) {   // GoToDisturbance (0,7) : pres du point (+-1)
      const q = this.trouble.pos; this.viseW([q[0] + 0.5, q[1] + 0.5, q[2] + 0.5]);
      if ((q[0] - Math.floor(a.x)) ** 2 + (q[1] - Math.floor(a.y)) ** 2 + (q[2] - Math.floor(a.z)) ** 2 >= 4) { if (!this.nav || t >= this.nav.prochain) this.allerVers(q[0] + 0.5, q[1], q[2] + 0.5, 0.7, { recalcul: 20 }); }
      else this.nav = null;
      return;
    }
    // TryToSniff : un vivant a 24 blocs, flair libre : 84 ticks a flairer (delai 100 a 200)
    if (t >= this.flairCooldown && this.plusProche()) { this.flairCooldown = t + 100 + h.entierBorne(101); this.poser_posture('sniffing'); return; }
    // rien : flaner (0,5) ou ne rien faire (30 a 60 ticks)
    if (this.navFinie() && t >= (this.reposFin ?? 0)) {
      if (h.entierBorne(3) < 2) { const x = a.x + h.entierBorne(21) - 10, z = a.z + h.entierBorne(21) - 10; this.allerVers(x, undefined, z, 0.5, { recalcul: 1e9 }); }
      else this.reposFin = t + 30 + h.entierBorne(31);
    }
  },
  plusProche() { return this.autres().filter((o) => this.peutCibler(o) && this.dist2(o) <= 576).sort((p, q) => this.dist2(p) - this.dist2(q))[0] ?? null; },
  // combat : cible valide (vivante, ciblable, en colere) ; vers elle a 1,2 ; onde sonique a 15 / 20 blocs ; coup au contact (18 ticks)
  tickCombatWarden() {
    const a = this.a, sim = this.sim, o = this.cibleW, t = sim.temps;
    if (!this.peutCibler(o) || !this.enColere()) { if (o && !this.peutCibler(o)) this.colereDe.delete(o.nom); this.cibleW = null; this.digFin = t + 1200; this.soniqueT = -1; return; }
    this.viseW(o);
    if (this.soniqueT >= 0) { this.tickSonique(); return; }
    const proche = (o.x - a.x) ** 2 + (o.z - a.z) ** 2 < 225 && (o.y - a.y) ** 2 < 400;
    if (t >= this.soniqueCd && proche && t >= this.coupCd) { this.soniqueT = 0; this.coupCd = t + 60; this.animSonique = t; sim.son('entity.warden.sonic_charge', a.x, a.y, a.z, 3, 1); this.stat('ondes'); journal(sim, `${a.nom} charge une onde sonique`); this.nav = null; return; }
    if (this.auContact(o) && this.voit(o)) {
      this.nav = null;
      if (t >= this.coupCd) {
        this.animAttaque = t; sim.son('entity.warden.attack_impact', a.x, a.y, a.z, 10, 1 + (this.h.flottant() - this.h.flottant()) * 0.2);
        this.soniqueCd = t + 40; this.frapper(o); this.coupCd = t + 18;
      }
    } else if (!this.nav || t >= this.nav.prochain) this.allerVers(o.x, o.auSol ? o.y : undefined, o.z, 1.2, { recalcul: 10 });
  },
  // SonicBoom.tick : 60 ticks ; a 34, le rayon (floor(longueur) + 7 particules depuis la poitrine), le son, 10 degats sonic_boom (sans armure),
  // recul 2,5 a l'horizontale et 0,5 vers le haut (x 1 - resistance au recul)
  tickSonique() {
    const a = this.a, sim = this.sim, o = this.cibleW;
    this.soniqueT++;
    if (this.soniqueT === 34 && (o.x - a.x) ** 2 + (o.z - a.z) ** 2 < 225 && (o.y - a.y) ** 2 < 400) {
      const s = [a.x, a.y + 1.6, a.z], e = o.oeil(), d = [e[0] - s[0], e[1] - s[1], e[2] - s[2]], L = Math.hypot(...d), n = L < 1e-5 ? [0, 0, 0] : d.map((c) => c / L);
      for (let i = 1; i < Math.floor(L) + 7; i++) sim.particule('sonic_boom', s[0] + n[0] * i, s[1] + n[1] * i, s[2] + n[2] * i, 0, 0, 0, 1);
      sim.son('entity.warden.sonic_boom', a.x, a.y, a.z, 3, 1);
      if (o.degats(10, 'sonic_boom')) { const k = 1 - (o.ia?.pr.antiRecul ?? 0); o.vx += n[0] * 2.5 * k; o.vy += n[1] * 0.5 * k; o.vz += n[2] * 2.5 * k; o.auSol = false; o.ia?.blesse(a); }
      journal(sim, `${a.nom} : onde sonique sur ${o.nom} (10, ignore l armure)`);
    }
    if (this.soniqueT >= 60) { this.soniqueT = -1; this.soniqueCd = sim.temps + 40; }
  },
  viseW(o) { this.regardW = o; },   // le regard est pose apres les buts (IA.tick remet a.regard a zero avant eux)
  apresWarden() { if (this.type === 'warden' && this.regardW) this.regarder(this.regardW); this.regardW = null; },
  // Warden.hurtServer : rien sous terre ; un coup : colere 80 + 20 contre l'attaquant, qui devient la cible s'il frappe directement (ou a 5 blocs)
  apresDegatsWarden(source) {
    if (this.type !== 'warden') return;
    const o = this.blessePar;
    if (!o || o.mort >= 0 || !/^(joueur|mob:|fleche|trident|boule)/.test(String(source))) return;
    this.colere(o, 100, false);
    if (!this.cibleW && (/^(joueur|mob:)/.test(String(source)) || this.dist2(o) < 25)) { this.cibleW = o; this.rugirCible = null; this.soniqueCd = this.sim.temps + 200; }
  },
  refuseDegatsWarden() { return this.type === 'warden' && (this.posture === 'digging' || this.posture === 'emerging'); },
  drapeauxWarden() { return 0; },
  // colonne en plus : posture, debut de posture, colere, vrilles (tick), debut de l'animation d'attaque, debut de l'onde sonique
  plusWarden() {
    if (this.type !== 'warden') return null;
    return [POSTURES.indexOf(this.posture), this.postureT, this.colereActive(), this.vrille, this.animAttaque, this.animSonique];
  },
};
