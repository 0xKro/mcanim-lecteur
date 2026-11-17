// Acteurs simules : des joueurs qui executent des INTENTIONS datees (`actes` : va, regarde, saute, accroupi, tient, utilise, pose, casse, attends).
// Phase 5 du tick (entites). Tout passe par l'API publique du monde (poser, casser, evenement utilise, sons) : aucune mecanique de bloc ici.
//   - Physique du joueur du jeu : acceleration 0,1 x 0,98 sur le sol, friction du bloc x 0,91, gravite 0,08, saut 0,42, marche de 0,6,
//     boite 0,6 x 1,8 (1,5 accroupi), yeux a 1,62 (1,27) : vitesses 4,317 / 5,612 / 1,295 blocs par seconde (LivingEntity.travel, Entity.collide).
//   - Portee des mains : 4,5 blocs (Player.blockInteractionRange) de l'oeil au bloc ; rayon de visee (les blocs entre les deux masquent).
//   - Balancement du bras : LivingEntity.swing / updateSwingTime (6 ticks, relance quand 3 ticks sont passes).
//   - Minage : cassage.js (progression par tick, fissures 0..9, son de coup tous les 4 ticks, delai de 5 ticks entre deux blocs).
// Port de Horizon client/game/{player_move,hand,block_breaking,interaction}.rs et world/{entity_move,living_air}.rs : MIT (ATTRIBUTIONS.md).
import { deplacerBoite, coupe, rayonBloc, distanceCellule, boitesLocales, solSous } from './collision.js';
import { chercherChemin, stationPourCellule, blocsOuvrables } from './navigation.js';
import { progressionParTick, ticksPourCasser, etapeFissure } from './cassage.js';
import { dirDeLacet, VEC, OPPOSE, JEU, FR, decale, parseEtat, court } from './familles/_aide.js';
import { evenement } from './registre.js';
import { installerUtilisation, BIT, FATIGUE } from './utilisation.js';
import { IA, BUTIN, coupJoueur } from './ia.js';   // creatures `ia: true` (buts du jeu, cibles, combat) ; coup d'epee du joueur (verbe frappe)
import { ESPECES } from '../creatures/especes.js';   // dimensions des bebes (entites nees pendant la simulation)

export const LARGEUR = 0.6, HAUTEUR = 1.8, HAUTEUR_ACCROUPI = 1.5, OEIL = 1.62, OEIL_ACCROUPI = 1.27;
export const GRAVITE = 0.08, TRAINEE = 0.98, SAUT = 0.42, PAS = 0.6, FRICTION_AIR = 0.91;
export const VITESSE_MARCHE = 0.1, VITESSE_COURSE = 0.13, FACTEUR_ACCROUPI = 0.3, ENTREE = 0.98;
export const DUREE_BALANCEMENT = 6, DUREE_COFFRE = 40;
const RAD = Math.PI / 180;
const norm180 = (a) => { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; };
const FACE_3D = ['down', 'up', 'north', 'south', 'west', 'east'];
// #minecraft:can_breathe_under_water (les morts-vivants, les creatures de l'eau)
const RESPIRE_SOUS_EAU = new Set(['zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'bogged', 'parched', 'wither_skeleton', 'zombified_piglin', 'zoglin', 'phantom', 'wither', 'skeleton_horse', 'zombie_horse', 'axolotl', 'frog', 'turtle', 'guardian', 'elder_guardian', 'dolphin', 'squid', 'glow_squid', 'cod', 'salmon', 'tropical_fish', 'pufferfish', 'tadpole', 'nautilus', 'zombie_nautilus']);
export const DRAPEAUX = { ACCROUPI: 1, AU_SOL: 2, COURSE: 4, BALANCE: 8, SAUTE: 16, EAU: 32 };

// nombre de ticks du film -> tick du monde (ralenti)
export const tickDe = (t, ralenti) => Math.floor(t * 20 * ralenti + 1e-9);

export class Acteur {
  constructor(gest, id, d) {
    this.g = gest; this.sim = gest.sim; this.id = id; this.nom = d.nom;
    this.x = d.x; this.y = d.y; this.z = d.z; this.vx = 0; this.vy = 0; this.vz = 0;
    this.lacet = d.lacet ?? 0; this.lacetTete = this.lacet; this.tangage = 0;
    this.auSol = false; this.accroupi = false; this.course = false; this.saut = false;
    this.main = { objet: d.objet ?? null, efficacite: 0 };
    this.balance = { actif: false, temps: 0 }; this.balancement = 0;
    this.membres = { phase: 0, amplitude: 0 };
    this.regard = null;                        // regard persistant { x, y, z } | { acteur }
    this.actes = d.actes || []; this.iActe = 0;
    this.tache = null;                         // tache en cours
    this.delaiCassage = 0;
    this.cassage = -1;                         // progression affichee (0..1), -1 : rien
    this.ouvert = null;                        // conteneur tenu ouvert { pos, jusqua }
    this.xPrec = this.x; this.zPrec = this.z;
    this.entree = { avance: 0, cap: this.lacet, saute: false };
    // sante, chute, fluides (docs/SIMULATION.md partie 11)
    this.vieMax = d.vie ?? d.ia?.vie ?? 20; this.vie = this.vieMax; this.invulnerable = !!d.invulnerable; this.ramasse = d.ramasse === true; this.sac = new Map();
    this.hurtTime = 0; this.invulTemps = 0; this.derniereBlessure = 0; this.mort = -1; this.distanceChute = 0; this.air = 300; this.dansEau = false; this.dansLave = false;
    this.initUtilisation(d);
    // creature (champ `type`) : sa boite, ses yeux et sa vitesse (film/actes.js, gabarit) ; joueur sinon
    const gb = d.gabarit ?? null;
    this.L = gb?.l ?? LARGEUR; this.H = gb?.h ?? HAUTEUR; this.O = gb?.oeil ?? OEIL; this.kVit = gb?.vitesse ?? 1;
    this.typeCreature = d.typeCreature ?? null; this.dernierCoup = -1e9;
    this.ia = d.ia ? new IA(this, d.ia) : null;
  }

  boite(x = this.x, y = this.y, z = this.z) { const h = this.accroupi ? HAUTEUR_ACCROUPI : this.H, L = this.L; return [x - L / 2, y, z - L / 2, x + L / 2, y + h, z + L / 2]; }
  oeil() { return [this.x, this.y + (this.accroupi ? OEIL_ACCROUPI : this.O), this.z]; }
  get lec() { return this.g.lec; }
  get regles() { return this.sim.regles; }
  portee() { return this.regles.valeur('joueur.portee', 4.5); }

  // ---------------------------------------------------------------- journal des intentions
  note(acte, statut, texte, debut = this.sim.temps) { this.sim.replay.acte(debut, this.nom, acte.verbe, acte.resume ?? '', statut, texte, this.sim.temps); }

  // ---------------------------------------------------------------- balancement du bras (LivingEntity.swing)
  balancer() { const b = this.balance; if (!b.actif || b.temps >= DUREE_BALANCEMENT / 2 || b.temps < 0) { b.temps = -1; b.actif = true; } }
  _majBalancement() {
    const b = this.balance;
    if (b.actif) { b.temps++; if (b.temps >= DUREE_BALANCEMENT) { b.temps = 0; b.actif = false; } } else b.temps = 0;
    this.balancement = b.actif ? Math.max(0, b.temps) / DUREE_BALANCEMENT : 0;
  }

  // ---------------------------------------------------------------- intentions
  demarrerDues() {
    const t = this.sim.temps;
    while (this.iActe < this.actes.length && this.actes[this.iActe].tick <= t) this.lancer(this.actes[this.iActe++]);
  }

  lancer(a) {
    const v = a.verbe;
    // verbes d'etat : ils n'interrompent pas la tache en cours
    if (v === 'regarde') { this.regard = a.cible === null ? null : a.cible.acteur ? { acteur: a.cible.acteur } : { x: a.cible.x, y: a.cible.y, z: a.cible.z }; this.note(a, 'ok', ''); return; }
    if (v === 'saute') { this.saut = true; this.note(a, 'ok', ''); return; }
    if (v === 'accroupi') { this.accroupi = !!a.valeur; this.note(a, 'ok', ''); return; }
    if (v === 'tient') { this.main = { objet: a.objet, efficacite: a.opts?.eff ?? 0 }; this.note(a, 'ok', a.objet ? '' : 'main vide'); return; }
    // taches : la nouvelle interrompt la precedente
    if (this.tache) this.finirTache('interrompu', this.tache.msgInterrompu?.() ?? '');
    const T = { acte: a, debut: this.sim.temps, etat: 'init', n: 0 };
    this.tache = T;
    try { this['debut_' + v](T, a); } catch (e) { if (e instanceof EchecActe) { this.finirTache('echec', e.message); return; } throw e; }
  }

  finirTache(statut, texte) {
    const T = this.tache; if (!T) return;
    this.tache = null; this.usage = null;
    if (this.ouvert) this.fermerConteneur();
    if (T.acte.verbe === 'casse' && this.cassage >= 0) { this.fissure(T, -1); this.cassage = -1; this.sim.api.evenement('acteur.cassageArrete', { acteur: this.nom, pos: T.cible }); }
    if (T.accroupiAvant !== undefined) this.accroupi = T.accroupiAvant;
    this.course = false; this.entree.avance = 0;
    this.note(T.acte, statut, texte, T.debut);
  }

  tickTache() {
    const T = this.tache;
    if (!T) { this.entree.avance = 0; return; }
    if (T.max && this.sim.temps - T.debut > T.max) { this.finirTache('echec', `delai de ${(T.max / 20 / this.sim.replay.ralenti).toFixed(1)} s depasse`); return; }
    try { this['tick_' + T.acte.verbe](T); } catch (e) { if (e instanceof EchecActe) { this.finirTache('echec', e.message); return; } throw e; }
  }

  // ---------------------------------------------------------------- attends
  debut_attends(T, a) { T.fin = this.sim.temps + tickDe(a.secondes, this.sim.replay.ralenti); }
  tick_attends(T) { if (this.sim.temps >= T.fin) this.finirTache('ok', ''); }

  // ---------------------------------------------------------------- frappe (Player.attack) : portee 3 blocs, recharge de l'arme, critique en tombant
  debut_frappe(T, a) {
    T.max = a.opts.max ? tickDe(a.opts.max, this.sim.replay.ralenti) : 0;
    if (a.opts.objet) this.main = { objet: a.opts.objet, efficacite: 0 };
    T.coups = a.opts.coups ?? Infinity; T.n = 0; T.critique = !!a.opts.critique;
  }
  // frappe "boule_feu" : attend qu'une boule de feu (pas la sienne) passe a portee (3 blocs de l'oeil), la regarde et la frappe : elle repart
  // dans la direction du regard (Fireball.hurtServer, deflect)
  tickRenvoi(T) {
    const sim = this.sim, [ex, ey, ez] = this.oeil(), P = sim.entites.proj;
    let best = null, bd = Infinity;
    for (const e of sim.entites.liste) {
      if (!e.proj || (e.type !== 'boule_feu' && e.type !== 'petite_boule_feu') || e.proprietaire === this.nom || sim.entites._fini?.has(e)) continue;
      const cy = e.y + (e.type === 'boule_feu' ? 0.5 : 0.15625), d = Math.hypot(e.x - ex, cy - ey, e.z - ez);
      if (d < bd) { bd = d; best = { e, cy }; }
    }
    if (!best) return;
    // le regard du joueur donne la direction du renvoi : son regard persistant (verbe regarde, par exemple le ghast) ou la boule elle-meme
    const R = this.regard?.acteur ? this.g.parNom.get(this.regard.acteur) : null, vise = R ? [R.x, R.y + R.H / 2, R.z] : this.regard ? [this.regard.x, this.regard.y, this.regard.z] : null;
    if (!vise) this.regardTache = { x: best.e.x, y: best.cy, z: best.e.z };
    if (bd > 3.2) return;
    const dir = vise ? [vise[0] - ex, vise[1] - ey, vise[2] - ez] : [best.e.x - ex, best.cy - ey, best.e.z - ez];
    this.dernierCoup = sim.temps; this.balancer();
    P.renvoyer(best.e, this, dir);
    sim.son('entity.player.attack.strong', this.x, this.y, this.z, 1, 1);
    if (++T.n >= T.coups) this.finirTache('ok', `${T.n} renvoi(s)`);
  }
  tick_frappe(T) {
    if (T.acte.cible.acteur === 'boule_feu') return this.tickRenvoi(T);
    const sim = this.sim, o = this.g.parNom.get(T.acte.cible.acteur);
    if (!o) throw new EchecActe('cible inconnue');
    if (o.mort >= 0) { this.finirTache('ok', `${o.nom} est mort`); return; }
    this.regardTache = { x: o.x, y: o.y + o.H * 0.8, z: o.z };
    const B = o.boite(), [ex, ey, ez] = this.oeil();
    const cx = Math.max(B[0], Math.min(ex, B[3])), cy = Math.max(B[1], Math.min(ey, B[4])), cz = Math.max(B[2], Math.min(ez, B[5]));
    const d = Math.hypot(ex - cx, ey - cy, ez - cz);
    if (d > 2.6) { const cap = Math.atan2(-(o.x - this.x), o.z - this.z) / RAD; this.entree = { avance: 1, cap, saute: false }; if (this.auSol && this.bute && this.marcheSautable(cap)) this.saut = true; }
    const depuis = sim.temps - this.dernierCoup, c0 = coupJoueur(this.main.objet, depuis);
    if (d > 3 || c0.recharge < 1) return;
    if (T.critique && this.auSol) { this.saut = true; return; }                 // coup critique : sauter, frapper en retombant
    if (T.critique && !(this.vy < 0)) return;
    const crit = !this.auSol && this.vy < 0 && !this.dansEau && !this.course && sim.regles.valeur('combat.critiques', true);
    const c = coupJoueur(this.main.objet, depuis, { critique: crit });
    this.dernierCoup = sim.temps; this.balancer();
    const R = sim.regles.valeur('combat.recul', 1);
    const ok = o.frappe(c.degats, 'joueur:' + this.nom, this.x - o.x, this.z - o.z, 0.4 * R);
    if (ok) { if (this.course) o.recul(0.5 * R, this.x - o.x, this.z - o.z); o.ia?.blesse(this); o.dernierFrappeur = this; }
    sim.son(c.critique ? 'entity.player.attack.crit' : c.recharge > 0.9 ? 'entity.player.attack.strong' : 'entity.player.attack.weak', this.x, this.y, this.z, 1, 1);
    if (c.critique) for (let i = 0; i < 6; i++) sim.particule('crit', o.x, o.y + o.H * 0.6, o.z, (sim.hasard.flottant() - 0.5), 0.2, (sim.hasard.flottant() - 0.5), 1);
    (sim.stats.coups ??= []).push(`${(sim.temps / 20).toFixed(2)} ${this.nom} frappe ${o.nom} ${+c.degats.toFixed(1)}${c.critique ? ' critique' : ''}${ok ? '' : ' (sans effet)'}`);
    if (++T.n >= T.coups) this.finirTache('ok', `${T.n} coup(s)`);
  }

  // ---------------------------------------------------------------- va
  debut_va(T, a) {
    T.max = a.opts.max ? tickDe(a.opts.max, this.sim.replay.ralenti) : 0;
    T.rayon = a.opts.rayon ?? 0.5;
    if (a.vitesse === 'accroupi') { T.accroupiAvant = this.accroupi; this.accroupi = true; }
    this.course = a.vitesse === 'court';
    const but = { x: a.x, z: a.z, y: a.y };
    if (but.y === undefined) { const s = this.g.solAuxCoordonnees(a.x, a.z, this.y); if (s !== null) but.y = s; }
    T.but = but;
    this.planifierChemin(T, { ouvrePortes: !!a.opts.ouvrePortes, rayon: T.rayon });
  }
  planifierChemin(T, { ouvrePortes, rayon }) {
    const r = chercherChemin(this.lec, [this.x, this.y, this.z], T.but, { ouvrePortes, rayon: Math.max(0.35, rayon - 0.15), ferOuvrable: this.regles.valeur('portes.fer', false) });
    T.portes = r.portes; T.chemin = r.chemin.length > 1 ? r.chemin.slice(1) : []; T.i = 0; T.complet = r.complet;
    if (!r.complet) {
      // pas de chemin : on marche droit vers le but ; le monde dira ce qui bloque (porte fermee, mur...)
      T.chemin = [[T.but.x, T.but.y ?? this.y, T.but.z]]; T.droit = true; T.raison = r.raison;
    }
    T.pas = { x: this.x, z: this.z, k: 0, immobile: 0 };
  }
  tick_va(T) {
    const a = T.acte;
    // portes du chemin : on les ouvre en arrivant (a la main)
    for (const p of T.portes || []) {
      if (p.fait) continue;
      if (Math.hypot(this.x - (p[0] + 0.5), this.z - (p[2] + 0.5)) <= 2.3) {
        p.fait = true;
        const e = this.sim.monde.etatEn(p[0], p[1], p[2]);
        if (e >= 0 && this.sim.d.prop(e, 'open') === 'false') {
          this.balancer();
          const bas = this.sim.d.prop(e, 'half') === 'upper' ? p[1] - 1 : p[1];
          this.sim.utiliserBloc(p[0], bas, p[2], { acteur: this.nom, face: 'north', hit: [0.5, 0.5, 0.5], accroupi: this.accroupi, lacet: this.lacet });
        }
      }
    }
    const w = T.chemin[T.i];
    if (!w) { this.finirTache('ok', ''); return; }
    const dx = w[0] - this.x, dz = w[2] - this.z, d = Math.hypot(dx, dz);
    const dernier = T.i === T.chemin.length - 1;
    const arret = dernier ? Math.max(0.3, Math.min(T.rayon - 0.2, 0.6)) : 0.35;
    if (d <= arret || (!dernier && d < 0.6 && this.depasse(T, w))) {
      if (dernier) { this.finirTache('ok', ''); return; }
      T.i++; return;
    }
    // le saut : une marche de plus de 0,6 devant, ou un obstacle de 1 bloc contre lequel on bute
    const marche = (w[1] ?? this.y) - this.y;
    if (this.auSol && (marche > PAS + 0.02 && d < 1.3)) this.saut = true;
    const cap = Math.atan2(-dx, dz) / RAD;
    this.entree.cap = cap; this.entree.avance = 1;
    if (this.auSol && this.bute && this.marcheSautable(cap)) this.saut = true;   // on bute contre une marche de 1 bloc : on saute (sans chemin planifie)
    // blocage : peu de progres pendant 1,5 s
    T.pas.k++;
    if (T.pas.k >= 30) {
      const moved = Math.hypot(this.x - T.pas.x, this.z - T.pas.z);
      T.pas.x = this.x; T.pas.z = this.z; T.pas.k = 0;
      if (moved < 0.25) {
        const obs = this.obstacleDevant(cap);
        if (T.droit || T.pas.immobile >= 1) {
          this.finirTache('echec', `bloque a ${this.x.toFixed(1)},${this.z.toFixed(1)}${obs ? ' par ' + obs : ''}${T.droit ? ' : aucun chemin' + (a.opts.ouvrePortes ? '' : ' ; essaie {"ouvrePortes": true}') : ''}`);
          return;
        }
        T.pas.immobile++;
        this.planifierChemin(T, { ouvrePortes: !!a.opts.ouvrePortes, rayon: T.rayon });
      }
    }
    void a;
  }
  // une marche de 1 bloc (au plus) devant : la boite relevee de 1 passe, avec le plafond libre
  marcheSautable(cap) {
    const a = cap * RAD, dx = -Math.sin(a) * 0.4, dz = Math.cos(a) * 0.4, y = this.y + 1.2;
    const L = this.L, H = this.H;
    return !coupe(this.lec, [this.x + dx - L / 2, y + 1e-3, this.z + dz - L / 2, this.x + dx + L / 2, y + H, this.z + dz + L / 2]) && !coupe(this.lec, [this.x - L / 2, this.y + H, this.z - L / 2, this.x + L / 2, y + H, this.z + L / 2]);
  }
  depasse(T, w) {   // le point est derriere nous : le prochain est plus proche
    const n = T.chemin[T.i + 1]; if (!n) return false;
    return Math.hypot(n[0] - this.x, n[2] - this.z) < Math.hypot(n[0] - w[0], n[2] - w[2]);
  }
  obstacleDevant(cap) {
    const lec = this.lec, x = this.x - Math.sin(cap * RAD) * 0.6, z = this.z + Math.cos(cap * RAD) * 0.6;
    for (const dy of [0.3, 1.2]) {
      const e = lec.etatEn(Math.floor(x), Math.floor(this.y + dy), Math.floor(z));
      if (e >= 0 && boitesLocales(lec, Math.floor(x), Math.floor(this.y + dy), Math.floor(z)).length) return `${court(this.sim.d.nomBloc(e))} en ${Math.floor(x)},${Math.floor(this.y + dy)},${Math.floor(z)}`;
    }
    return '';
  }

  // ---------------------------------------------------------------- viser une cellule : portee, visibilite, face touchee
  cibleCellule(c, point = null) {
    const [x, y, z] = c, [ex, ey, ez] = this.oeil();
    const dist = distanceCellule(ex, ey, ez, x, y, z);
    const P = point ?? [x + 0.5, y + 0.5, z + 0.5];   // point vise : le centre du bloc, ou le point d'une face (pose)
    // face d'entree du rayon oeil -> centre (methode des plans)
    const d = [P[0] - ex, P[1] - ey, P[2] - ez];
    let tMin = 0, face = 'up';
    const dedans = ex >= x && ex <= x + 1 && ey >= y && ey <= y + 1 && ez >= z && ez <= z + 1;
    let hit = [0.5, 0.5, 0.5];
    if (!dedans) {
      const lo = [x, y, z], hi = [x + 1, y + 1, z + 1], O = [ex, ey, ez];
      let tEnter = -Infinity, axe = 0, sens = 1;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-12) continue;
        const t1 = (lo[i] - O[i]) / d[i], t2 = (hi[i] - O[i]) / d[i], tm = Math.min(t1, t2);
        if (tm > tEnter) { tEnter = tm; axe = i; sens = d[i] > 0 ? -1 : 1; }
      }
      tMin = tEnter;
      face = axe === 0 ? (sens < 0 ? 'west' : 'east') : axe === 1 ? (sens < 0 ? 'down' : 'up') : sens < 0 ? 'north' : 'south';
      hit = [O[0] + d[0] * tMin - x, O[1] + d[1] * tMin - y, O[2] + d[2] * tMin - z].map((v) => Math.max(0, Math.min(1, v)));
    }
    return { dist, face, hit, point: P, oeil: [ex, ey, ez] };
  }
  verifierPortee(c, { visible = true, point = null } = {}) {
    const r = this.cibleCellule(c, point);
    const portee = this.portee();
    if (r.dist > portee) return { ok: false, r, raison: `hors de portee (${r.dist.toFixed(1)} blocs, maximum ${portee})` };
    if (visible) {
      const premier = rayonBloc(this.lec, r.oeil, r.point, c);
      if (premier && (premier[0] !== c[0] || premier[1] !== c[1] || premier[2] !== c[2])) {
        const e = this.sim.monde.etatEn(...premier);
        return { ok: false, r, raison: `${e >= 0 ? court(this.sim.d.nomBloc(e)) : 'un bloc'} en ${premier.join(',')} masque la cible` };
      }
    }
    return { ok: true, r };
  }

  // approche commune a utilise / pose / casse : verifie la portee, sinon marche (si `va`) ; puis vise
  preparerAction(T, a, cellule, { visible = true, point = null } = {}) {
    T.cible = cellule;
    T.max = a.opts.max ? tickDe(a.opts.max, this.sim.replay.ralenti) : 0;
    const v = this.verifierPortee(cellule, { visible, point });
    if (v.ok) { T.etat = 'vise'; T.vise = 0; return; }
    if (!a.opts.va) throw new EchecActe(v.raison + ' ; ajoute {"va": true} pour qu\'il s\'approche');
    const st = stationPourCellule(this.lec, [this.x, this.y, this.z], cellule, { portee: Math.min(this.portee() - 0.5, 4), ouvrePortes: !!a.opts.ouvrePortes });
    if (!st) throw new EchecActe(`${v.raison} ; aucune position d'ou l'atteindre`);
    T.etat = 'approche'; T.but = { x: st.x, z: st.z, y: st.y }; T.rayon = 0.4; T.portes = st.chemin.portes; T.chemin = st.chemin.chemin.slice(1); T.i = 0; T.pas = { x: this.x, z: this.z, k: 0, immobile: 0 }; T.droit = false;
    if (!T.chemin.length) T.etat = 'vise', T.vise = 0;
  }
  // un pas de l'approche, rend vrai quand arrive
  tickApproche(T) {
    const w = T.chemin[T.i];
    if (!w) { return true; }
    const dx = w[0] - this.x, dz = w[2] - this.z, d = Math.hypot(dx, dz), dernier = T.i === T.chemin.length - 1;
    if (d <= (dernier ? 0.35 : 0.4)) { if (dernier) return true; T.i++; return false; }
    if (this.auSol && (w[1] - this.y) > PAS + 0.02 && d < 1.3) this.saut = true;
    this.entree.cap = Math.atan2(-dx, dz) / RAD; this.entree.avance = 1;
    for (const p of T.portes || []) {
      if (!p.fait && Math.hypot(this.x - (p[0] + 0.5), this.z - (p[2] + 0.5)) <= 2.3) { p.fait = true; this.balancer(); this.sim.utiliserBloc(p[0], p[1], p[2], { acteur: this.nom, face: 'north', hit: [0.5, 0.5, 0.5], lacet: this.lacet }); }
    }
    T.pas.k++;
    if (T.pas.k >= 40) { const m = Math.hypot(this.x - T.pas.x, this.z - T.pas.z); T.pas.x = this.x; T.pas.z = this.z; T.pas.k = 0; if (m < 0.25) throw new EchecActe('bloque en s\'approchant'); }
    return false;
  }
  // regard vers le point cible : vrai quand la tete y est (au plus 8 ticks)
  viseTache(T, point) {
    this.regardTache = { x: point[0], y: point[1], z: point[2] };
    T.vise = (T.vise ?? 0) + 1;
    const e = this.ecartRegard(point);
    return (T.vise >= 3 && e < 6) || T.vise >= 9;
  }
  ecartRegard(p) {
    const [ex, ey, ez] = this.oeil(), dx = p[0] - ex, dy = p[1] - ey, dz = p[2] - ez;
    const yaw = Math.atan2(-dx, dz) / RAD, pit = -Math.atan2(dy, Math.hypot(dx, dz)) / RAD;
    return Math.hypot(norm180(yaw - this.lacetTete), pit - this.tangage);
  }

  // ---------------------------------------------------------------- utilise
  debut_utilise(T, a) {
    if (a.cible?.acteur) { if (a.opts.objet) this.main = { objet: a.opts.objet, efficacite: 0 }; T.mode = 'interagit'; T.duree = tickDe(a.opts.duree ?? 3, this.sim.replay.ralenti); T.max = tickDe(a.opts.max ?? 20, this.sim.replay.ralenti); return; }   // clic droit sur une creature (villageois : echange ; animal : nourriture -> amour ; allay qui danse : eclat d'amethyste)
    if (a.x === undefined) return this.debutObjet(T, a);
    const objetU = a.objet ?? a.opts.objet;   // utilise x y z {"objet": "music_disc_cat"} : l'objet en main pour ce clic (disque dans le juke-box)
    if (objetU !== undefined && objetU !== null) this.main = { objet: objetU, efficacite: 0 };
    const c = [a.x, a.y, a.z];
    if (this.sim.monde.etatEn(...c) < 0) throw new EchecActe('cellule inconnue');
    T.visible = this.main.objet !== 'bucket';           // le seau vide vise aussi les sources d'eau et de lave (rayon de fluide du jeu)
    this.preparerAction(T, a, c, { visible: T.visible });
  }
  // Mob.interact (Villager.mobInteract) : s'approche a 3 blocs (portee d'interaction avec une entite), regarde la creature, clic droit ;
  // un villageois sans metier (ou idiot, ou bebe) secoue la tete (40 ticks, son "no"), sinon il echange avec le joueur pendant `duree`
  tickInteraction(T) {
    const o = this.g.parNom.get(T.acte.cible.acteur);
    if (!o || o.mort >= 0) throw new EchecActe('cible absente ou morte');
    this.regardTache = { x: o.x, y: o.y + o.H * 0.85, z: o.z };
    const d = Math.hypot(o.x - this.x, o.z - this.z);
    if (!T.fait) {
      if (d > 2.5) { const cap = Math.atan2(-(o.x - this.x), o.z - this.z) / RAD; this.entree = { avance: 1, cap, saute: false }; if (this.auSol && this.bute && this.marcheSautable(cap)) this.saut = true; return; }
      this.balancer(); T.fait = this.sim.temps;
      // objet en main d'abord (Animal.mobInteract : nourriture -> amour ou croissance ; Allay : eclat d'amethyste pendant la danse) ; sinon l'echange
      const parObjet = this.main.objet && o.ia?.nourrir ? o.ia.nourrir(this, this.main.objet) : null;
      if (parObjet) { this.finirTache('ok', parObjet); return; }
      T.resultat = o.ia?.interagir ? o.ia.interagir(this, T.duree) : 'rien';
      if (T.resultat !== 'echange') { this.finirTache('ok', T.resultat); return; }
    }
    if (this.sim.temps - T.fait >= T.duree) { o.ia?.finEchange?.(this); this.finirTache('ok', 'echange'); }
  }
  tick_utilise(T) {
    if (T.mode === 'interagit') return this.tickInteraction(T);
    if (T.mode) return this.tickObjet(T);
    const a = T.acte;
    if (T.etat === 'approche') { if (this.tickApproche(T)) { T.etat = 'vise'; T.vise = 0; this.entree.avance = 0; } return; }
    if (T.etat === 'vise') {
      const c = T.cible, r = this.cibleCellule(c);
      if (!this.viseTache(T, r.point)) return;
      const v = this.verifierPortee(c, { visible: T.visible !== false });
      if (!v.ok) throw new EchecActe(v.raison);
      let { face, hit } = v.r;
      if (a.opts.face) {                                   // face imposee par la scene ("haut" : le dessus du bloc)
        face = JEU[a.opts.face] ?? a.opts.face;
        hit = face === 'up' ? [0.5, 1, 0.5] : face === 'down' ? [0.5, 0, 0.5] : face === 'north' ? [0.5, 0.5, 0] : face === 'south' ? [0.5, 0.5, 1] : face === 'west' ? [0, 0.5, 0.5] : [1, 0.5, 0.5];
      }
      this.regardTache = null;
      const sim = this.sim, e = sim.monde.etatEn(...c);
      sim.dernierUtilise = null;
      let res = sim.utiliserBloc(c[0], c[1], c[2], { acteur: this.nom, face, hit, accroupi: this.accroupi, objet: this.main.objet, lacet: this.lacet });
      let ev = sim.dernierUtilise;
      if (res === 'fait' && ev && ev.nouvelObjet !== undefined) this.main = { objet: ev.nouvelObjet, efficacite: 0 };   // le bloc prend ou rend l'objet (disque du juke-box)
      if (res !== 'fait' && this.main.objet) {          // le bloc ne reagit pas : l'objet tenu agit (seaux, briquet : evenement du monde `objet.utilise`)
        const o = sim.utiliserObjet(c[0], c[1], c[2], { acteur: this.nom, face, hit, accroupi: this.accroupi, objet: this.main.objet, lacet: this.lacet });
        if (o.fait) { res = 'fait'; ev = null; if (o.nouvelObjet !== undefined) this.main = { objet: o.nouvelObjet, efficacite: 0 }; } else if (o.raison) ev = { raison: o.raison };
      }
      if (res !== 'fait') {
        throw new EchecActe(ev?.raison ? `${court(sim.d.nomBloc(e))} : ${ev.raison}` : `${court(sim.d.nomBloc(e))} : rien ne se passe${res === undefined ? ' (bloc non interactif)' : ''}`);
      }
      this.balancer();
      if (ev?.ouvre) {
        this.ouvert = { pos: c, jusqua: sim.temps + (a.opts.duree ? tickDe(a.opts.duree, sim.replay.ralenti) : DUREE_COFFRE) };
        sim.api.evenement('conteneur.ouvre', { pos: c, acteur: this.nom });
        T.etat = 'ouvert'; return;
      }
      this.finirTache('ok', '');
      return;
    }
    if (T.etat === 'ouvert') {
      if (this.sim.temps >= this.ouvert.jusqua) this.finirTache('ok', '');
    }
  }
  fermerConteneur() { const o = this.ouvert; this.ouvert = null; if (o) this.sim.api.evenement('conteneur.ferme', { pos: o.pos, acteur: this.nom }); }

  // ---------------------------------------------------------------- pose
  debut_pose(T, a) {
    const D = [a.x, a.y, a.z];
    T.dest = D;
    // face cliquee et bloc d'appui
    const loin = (f) => Math.hypot(D[0] + 0.5 + VEC[f][0] - this.x, D[2] + 0.5 + VEC[f][2] - this.z);
    const faces = a.opts.face ? [OPPOSE[JEU[a.opts.face] ?? a.opts.face]] : ['down', ...['north', 'south', 'west', 'east'].sort((p, q) => loin(p) - loin(q)), 'up'];
    let appui = null;
    for (const f of faces) {
      const S = decale(D, f), e = this.sim.monde.etatEn(...S);
      const solide = e >= 0 && boitesLocales(this.lec, ...S).length > 0;
      if (solide || (a.opts.face && f === faces[0] && e >= 0 && !this.sim.d.a(e, 1))) { appui = { S, face: OPPOSE[f] }; break; }
    }
    if (!appui) throw new EchecActe('rien pour appuyer le bloc en ' + D.join(',') + ' : pose a cote d\'un bloc plein');
    T.appui = appui;
    this.main = { objet: a.bloc, efficacite: 0 };
    const fv0 = VEC[appui.face];
    T.occupee = !this.sim.api.remplacable(...D);   // cellule deja occupee (dalle a fusionner, neige...) : le rayon vers la face d'appui la traverse, on ne controle pas la visibilite
    this.preparerAction(T, a, appui.S, { visible: !T.occupee, point: [appui.S[0] + 0.5 + fv0[0] * 0.5, appui.S[1] + 0.5 + fv0[1] * 0.5, appui.S[2] + 0.5 + fv0[2] * 0.5] });
  }
  tick_pose(T) {
    if (T.etat === 'approche') { if (this.tickApproche(T)) { T.etat = 'vise'; T.vise = 0; this.entree.avance = 0; } return; }
    const a = T.acte, sim = this.sim, D = T.dest, S = T.appui.S;
    const fv = VEC[T.appui.face], face0 = [S[0] + 0.5 + fv[0] * 0.5, S[1] + 0.5 + fv[1] * 0.5, S[2] + 0.5 + fv[2] * 0.5];   // centre de la face du bloc d'appui qui regarde la cellule
    const r = this.cibleCellule(S, face0);
    if (!this.viseTache(T, r.point)) return;
    this.regardTache = null;
    const v = this.verifierPortee(S, { point: face0, visible: !T.occupee });
    if (!v.ok) throw new EchecActe(v.raison);
    // bloc du jeu a poser
    const nom = String(a.bloc).replace(/^minecraft:/, '');
    const idBloc = sim.d.idBloc(nom);
    if (idBloc < 0) throw new EchecActe(`bloc inconnu "${a.bloc}"`);
    const defaut = sim.d.etatParDefaut(idBloc);
    const face = T.appui.face;                                         // face du bloc d'appui touchee
    // point de contact en coordonnees de la cellule de destination : le plan commun est a 0 ou 1 sur l'axe de la face
    const h = [0.5, 0.5, 0.5];
    if (face === 'up') h[1] = 0; else if (face === 'down') h[1] = 1; else if (face === 'north') h[2] = 1; else if (face === 'south') h[2] = 0; else if (face === 'west') h[0] = 1; else h[0] = 0;
    if (a.opts.hit) { h[0] = a.opts.hit[0]; h[1] = a.opts.hit[1]; h[2] = a.opts.hit[2]; }
    const existant = sim.decrire(...D);
    const ev = evenement({ pos: D, etat: sim.d.chaine(defaut), bloc: 'minecraft:' + nom, face, hit: h, lacet: this.lacet, tangage: this.tangage, accroupi: this.accroupi, acteur: this.nom, existant });
    const res = sim.reg.a('etatPose', idBloc) ? sim.reg.lancerBloc('etatPose', idBloc, ev, sim.api) : undefined;
    if (res === false) throw new EchecActe(`${nom} : pose impossible en ${D.join(',')} ${ev.raison ?? ''}`.trim());
    let etat, aussi = [];
    if (typeof res === 'string') etat = res; else if (res && typeof res === 'object') { etat = res.etat; aussi = res.aussi || []; } else etat = this.etatParDefaut(sim, defaut, existant);
    const remplacable = sim.api.remplacable(...D);
    if (!remplacable && !ev.fusion) throw new EchecActe(`la cellule ${D.join(',')} est occupee par ${court(existant.nom)}`);
    const idEtat = sim.d.etatId(etat);
    if (idEtat < 0) throw new EchecActe(`etat de pose invalide "${etat}"`);
    // la boite du bloc ne doit toucher aucun acteur
    const boites = sim.d.boites(idEtat);
    for (const a2 of this.g.liste) {
      const k = a2.boite();
      for (const b of boites) if (k[3] > b[0] + D[0] + 1e-6 && k[0] < b[3] + D[0] - 1e-6 && k[4] > b[1] + D[1] + 1e-6 && k[1] < b[4] + D[1] - 1e-6 && k[5] > b[2] + D[2] + 1e-6 && k[2] < b[5] + D[2] - 1e-6) throw new EchecActe(`${a2.nom} se tient dans la cellule ${D.join(',')}`);
    }
    if (!sim.api.survitEtat(D[0], D[1], D[2], etat)) throw new EchecActe(`${nom} ne tient pas en ${D.join(',')} (appui manquant)`);
    sim.poser(D[0], D[1], D[2], etat, 11);
    for (const [x, y, z, e2] of aussi) sim.poser(x, y, z, e2, 3);
    sim.vibrations.emettre('block_place', D[0] + 0.5, D[1] + 0.5, D[2] + 0.5, { source: this.nom });   // GameEvent.BLOCK_PLACE
    sim.boss.apresPose(D, this);   // WitherSkullBlock.checkSpawn : sable des ames + 3 cranes de wither squelette
    const s = sim.d.son(idEtat);
    sim.son(s.pose, D[0] + 0.5, D[1] + 0.5, D[2] + 0.5, (s.volume + 1) / 2, s.hauteur * 0.8);
    this.balancer();
    this.finirTache('ok', '');
  }
  etatParDefaut(sim, defaut, existant) {
    const e = parseEtat(sim.d.chaine(defaut));
    const eau = /^minecraft:water$/.test(existant.nom) && existant.etat.level === '0';
    if (eau && 'waterlogged' in e.etat) e.etat.waterlogged = 'true';
    const cles = Object.keys(e.etat);
    return cles.length ? `${e.nom}[${cles.map((k) => `${k}=${e.etat[k]}`).join(',')}]` : e.nom;
  }

  // ---------------------------------------------------------------- casse
  debut_casse(T, a) {
    const c = [a.x, a.y, a.z], sim = this.sim, e = sim.monde.etatEn(...c);
    if (e < 0 || sim.d.nomBloc(e) === 'air') throw new EchecActe(`rien a casser en ${c.join(',')} (air)`);
    T.ancien = e;
    const fat = this.effets.size ? FATIGUE[Math.min(4, this.niveauEffet('mining_fatigue'))] * (1 + 0.2 * this.niveauEffet('haste')) : 1;   // fatigue du gardien ancien, celerite
    const p = progressionParTick(sim.d, e, { outil: this.main.objet, efficacite: this.main.efficacite, auSol: true, multiplicateur: this.regles.valeur('casser.vitesse', 1) * fat });
    if (p.incassable) throw new EchecActe(`${court(sim.d.nomBloc(e))} est incassable (durete -1)`);
    T.prog = p; T.somme = 0; T.ticksMine = 0;
    this.preparerAction(T, a, c);
  }
  tick_casse(T) {
    if (T.etat === 'approche') { if (this.tickApproche(T)) { T.etat = 'vise'; T.vise = 0; this.entree.avance = 0; } return; }
    const sim = this.sim, c = T.cible;
    if (T.etat === 'vise') {
      const r = this.cibleCellule(c);
      if (!this.viseTache(T, r.point)) return;
      const v = this.verifierPortee(c);
      if (!v.ok) throw new EchecActe(v.raison);
      if (this.delaiCassage > 0) { T.etat = 'delai'; return; }
      T.etat = 'mine'; T.debutMine = sim.temps;
      sim.api.evenement('acteur.cassageDebut', { acteur: this.nom, pos: c });
      if (T.prog.progression >= 1) return this.casserMaintenant(T);   // instantane (fleurs, torches...) : au premier clic
      this.cassage = 0; this.balancer(); this.fissure(T, 0);
      return;
    }
    if (T.etat === 'delai') { if (this.delaiCassage <= 0) { T.etat = 'vise'; T.vise = 9; } return; }
    // mine : on verifie que le bloc est toujours le meme et a portee
    const e = sim.monde.etatEn(...c);
    if (e !== T.ancien) { this.finirTache('echec', 'le bloc a change pendant le minage'); return; }
    const v = this.verifierPortee(c);
    if (!v.ok) throw new EchecActe(v.raison + ' pendant le minage');
    this.regardTache = { x: c[0] + 0.5, y: c[1] + 0.5, z: c[2] + 0.5 };
    T.ticksMine++;
    T.somme = Math.fround(T.somme + T.prog.progression);
    this.cassage = Math.min(1, T.somme);
    this.fissure(T, etapeFissure(this.cassage));
    this.balancer();
    if (T.ticksMine % 4 === 0) { const s = sim.d.son(e); sim.son(s.coup, c[0] + 0.5, c[1] + 0.5, c[2] + 0.5, (s.volume + 1) / 8, s.hauteur * 0.5); }
    if (T.somme >= 1) this.casserMaintenant(T);
  }
  // etape de fissures (0..9, -1 : plus de fissure) : evenement de bloc du replay, lu par le rendu (texture destroy_stage_N)
  fissure(T, etape) {
    if (T.etape === etape) return;
    T.etape = etape;
    this.sim.replay.blocEntite(this.sim.temps, 'fissure', T.cible[0], T.cible[1], T.cible[2], etape);
  }
  casserMaintenant(T) {
    const sim = this.sim, c = T.cible, e = sim.monde.etatEn(...c);
    const ev = evenement({ pos: c, etat: sim.d.chaine(e), bloc: sim.d.nomBloc(e), acteur: this.nom, outil: this.main.objet, butin: [] });
    if (sim.reg.a('casse', sim.d.blocDe(e))) sim.reg.lancerBloc('casse', sim.d.blocDe(e), ev, sim.api);
    if (ev.annule) { this.finirTache('echec', 'casse annulee par un gestionnaire'); return; }
    this.fissure(T, -1);
    const nomCasse = sim.d.nomBloc(e);
    sim.casser(c[0], c[1], c[2], { butin: true, outil: this.main.objet, acteur: this.nom });
    sim.vibrations.emettre('block_destroy', c[0] + 0.5, c[1] + 0.5, c[2] + 0.5, { source: this.nom });   // GameEvent.BLOCK_DESTROY
    if (nomCasse === 'beehive' || nomCasse === 'bee_nest') this.g.rucheCassee(c, this);   // BeehiveBlock.playerDestroy : abeilles relachees en urgence et en colere
    this.cassage = -1; this.delaiCassage = this.regles.valeur('casser.delai', 5);
    this.balancer();
    this.regardTache = null;
    this.finirTache('ok', `casse en ${T.ticksMine ?? 0} ticks (${(((T.ticksMine ?? 0)) / 20 / sim.replay.ralenti).toFixed(2)} s)`);
  }

  // ---------------------------------------------------------------- regard : tete et corps
  _regard() {
    let cible = this.regardTache ?? this.regard;
    let yawV = null, pitV = 0;
    if (cible && cible.acteur) { const o = this.g.parNom.get(cible.acteur); if (o) cible = { x: o.x, y: o.y + 1.62, z: o.z }; else cible = null; }
    if (cible) {
      const [ex, ey, ez] = this.oeil(), dx = cible.x - ex, dy = cible.y - ey, dz = cible.z - ez;
      yawV = Math.atan2(-dx, dz) / RAD; pitV = -Math.atan2(dy, Math.hypot(dx, dz)) / RAD;
    }
    const bouge = Math.hypot(this.vx, this.vz) > 0.02;
    if (yawV === null) { yawV = bouge ? this.lacet : this.lacetTete; if (!bouge) yawV = this.lacet; pitV = 0; }
    // la tete tourne vers la cible (au plus 40 degres par tick), le corps la suit au dela de 50 degres
    const dy = norm180(yawV - this.lacetTete);
    this.lacetTete += Math.max(-40, Math.min(40, dy * 0.5 + Math.sign(dy) * Math.min(Math.abs(dy), 6)));
    this.tangage += Math.max(-30, Math.min(30, (pitV - this.tangage) * 0.5));
    this.tangage = Math.max(-90, Math.min(90, this.tangage));
    const rel = norm180(this.lacetTete - this.lacet);
    if (this.entree.avance > 0) {
      const err = norm180(this.entree.cap - this.lacet);
      this.lacet += err * 0.3;                              // 0,3 par tick : le corps suit sa route comme dans le jeu
    } else if (Math.abs(rel) > 50) this.lacet += (rel - Math.sign(rel) * 50) * 0.5;
    this.lacet = norm180(this.lacet); this.lacetTete = norm180(this.lacetTete);
  }

  // ---------------------------------------------------------------- fluides autour du corps (Entity.updateFluidHeightAndDoFluidPushing)
  // Rend { eau, lave, hauteurEau, hauteurLave, tete (yeux dans l'eau), pousseeEau [x,y,z], pousseeLave } : les cellules de fluide touchees par la boite
  // reduite de 0,001, la hauteur de fluide au-dessus des pieds, et le courant (moyenne des courants des cellules ; x hauteur si moins de 0,4).
  fluidesAutour() {
    const sim = this.sim, b = this.boite(), e = 0.001;
    const x0 = Math.floor(b[0] + e), x1 = Math.floor(b[3] - e), y0 = Math.floor(b[1] + e), y1 = Math.floor(b[4] - e), z0 = Math.floor(b[2] + e), z1 = Math.floor(b[5] - e);
    const r = { eau: false, lave: false, hauteurEau: 0, hauteurLave: 0, tete: false, pousseeEau: [0, 0, 0], pousseeLave: [0, 0, 0] };
    const acc = { water: { v: [0, 0, 0], n: 0 }, lava: { v: [0, 0, 0], n: 0 } };
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const f = sim.fluide(x, y, z);
      if (!f.type) continue;
      const h = y + (sim.fluide(x, y + 1, z).type === f.type ? 1 : f.quantite / 9);
      if (h < b[1]) continue;
      const w = f.type === 'water';
      const d = h - b[1];
      if (w) { r.eau = true; r.hauteurEau = Math.max(r.hauteurEau, d); } else { r.lave = true; r.hauteurLave = Math.max(r.hauteurLave, d); }
      const A = acc[f.type], dd = w ? r.hauteurEau : r.hauteurLave;
      let c = sim.courant(x, y, z);
      if (dd < 0.4) c = c.map((q) => q * dd);
      A.v[0] += c[0]; A.v[1] += c[1]; A.v[2] += c[2]; A.n++;
    }
    for (const [t, cle, vit] of [['water', 'pousseeEau', 0.014], ['lava', 'pousseeLave', 0.0023333333333333335]]) {
      const A = acc[t];
      if (!A.n) continue;
      let v = A.v.map((q) => q / A.n);
      const L = Math.hypot(...v);
      if (L > 0) {
        v = v.map((q) => q * vit);
        if (Math.abs(this.vx) < 0.003 && Math.abs(this.vz) < 0.003 && Math.hypot(...v) < 0.0045) { const l2 = Math.hypot(...v) || 1; v = v.map((q) => q / l2 * 0.0045); }
        r[cle] = v;
      }
    }
    const [ex, ey, ez] = this.oeil(), yy = Math.floor(ey - 0.1111111), fe = sim.fluide(Math.floor(ex), yy, Math.floor(ez));
    r.tete = fe.type === 'water' && yy + (sim.fluide(Math.floor(ex), yy + 1, Math.floor(ez)).type === 'water' ? 1 : fe.quantite / 9) > ey - 0.1111111;
    return r;
  }

  // ---------------------------------------------------------------- physique (LivingEntity.travel)
  physique() {
    if (this.typeCreature === 'end_crystal') return;     // cristal de l'End : sans gravite, immobile
    if (this.ia?.vol && this.ia.physiqueVol()) return;   // creatures volantes (moteur/ia-especes.js : travel du jeu en vol)
    if (this.ia?.physiqueEau?.()) return;                // nage dirigee (ia-eau.js : travel des poissons, calmars, dauphins, axolotls, gardiens)
    const lec = this.lec, d = this.sim.d;
    const fl = this.fluidesAutour(), enEau = fl.eau, enLave = fl.lave, enFluide = enEau || enLave;
    // courant : le fluide pousse l'acteur (poussee de l'eau 0,014, de la lave 0,0023 : Entity.updateFluidHeightAndDoFluidPushing)
    if (enEau) { this.vx += fl.pousseeEau[0]; this.vy += fl.pousseeEau[1]; this.vz += fl.pousseeEau[2]; }
    if (enLave) { this.vx += fl.pousseeLave[0]; this.vy += fl.pousseeLave[1]; this.vz += fl.pousseeLave[2]; }
    if (enEau && !this.dansEau) this.eclaboussure();
    this.dansEau = enEau; this.dansLave = enLave; this.teteEau = fl.tete;
    // Player.updateSwimming : nage (pose de nage) = course dans l'eau, commencee la tete sous l'eau (le dauphin nage avec un joueur qui nage)
    this.nageant = !this.typeCreature && this.course && enEau && (this.nageant || fl.tete);
    if (this.sim.regles.valeur('vie.actif', true) && !RESPIRE_SOUS_EAU.has(this.typeCreature)) this.respirer(fl.tete);   // #can_breathe_under_water : les morts-vivants ne se noient pas
    // sol : bloc sous les pieds (friction)
    let friction = 0.6;
    if (this.auSol) {
      const e = lec.etatEn(Math.floor(this.x), Math.floor(this.y - 0.5000001), Math.floor(this.z));
      if (e >= 0) friction = d.friction(e) || 0.6;
    }
    // saut (avant le deplacement) ; dans un fluide : pousse vers le haut de 0,04 par tick (Mob.jumpInLiquid), seuil de 0,4 de hauteur pour sauter du fond
    if (this.saut) {
      const h = enEau ? fl.hauteurEau : fl.hauteurLave;
      if (enFluide && (!this.auSol || h > 0.4)) this.vy += 0.04;
      else if (this.auSol) {
        this.vy = SAUT + this.bonusSaut();
        if (this.course) { this.vx += -Math.sin(this.lacet * RAD) * 0.2; this.vz += Math.cos(this.lacet * RAD) * 0.2; }
        this.auSol = false;
      }
    }
    this.saut = false;
    // moveRelative : vitesse x (0,216 / friction^3) au sol, 0,02 en l'air (0,026 en courant) ; dans un fluide 0,02
    let av = this.entree.avance > 0 ? ENTREE : 0;
    // on avance seulement quand le corps est a peu pres tourne vers la route
    if (av > 0 && Math.abs(norm180(this.entree.cap - this.lacet)) > 50) av = 0;
    if (this.accroupi) av *= FACTEUR_ACCROUPI;
    const vit = enFluide ? 0.02 : this.auSol ? (this.course ? VITESSE_COURSE : VITESSE_MARCHE) * this.kVit * this.facteurVitesse() * (0.21600002 / (friction * friction * friction)) : (this.course ? 0.026 : 0.02);
    if (av > 0) {
      const dx = av * vit, a = this.lacet * RAD;     // entree (0, av) tournee de `lacet`
      this.vx += -Math.sin(a) * dx; this.vz += Math.cos(a) * dx;
    }
    // deplacement avec collisions
    let mx = this.vx, my = this.vy, mz = this.vz;
    if (this.accroupi && this.auSol && !enFluide) [mx, mz] = this.sansTomber(mx, mz);
    const yAvant = this.y;
    const r = deplacerBoite(lec, this.boite(), [mx, my, mz], this.auSol, PAS);
    this.x += r.dx; this.y += r.dy; this.z += r.dz;
    if (r.bloqueX) this.vx = 0;
    if (r.bloqueZ) this.vz = 0;
    if (r.bloqueY) this.vy = 0;
    this.auSol = r.auSol;
    this.bute = r.bloqueX || r.bloqueZ;
    // chute : la distance s'accumule en l'air, les degats tombent a l'atterrissage (LivingEntity.checkFallDamage / causeFallDamage) ; un fluide l'annule
    if (enFluide) this.distanceChute = 0;
    else if (r.auSol) { if (this.distanceChute > 0) this.atterrir(this.distanceChute); this.distanceChute = 0; } else if (r.dy < 0) this.distanceChute -= r.dy;
    // blocs touches par la boite (plaques de pression...) a la fin du deplacement
    this.toucherBlocs();
    if (enFluide) {
      // LivingEntity.travel dans l'eau (x 0,8, gravite / 16) ou la lave (x 0,5, gravite / 4) ; hisse sur la berge (0,3) si un pas libre existe
      // Grace du dauphin (Horizon horizon-world/src/living_fluid.rs `travel_in_water`) : ralentissement horizontal 0,96 au lieu de 0,8 dans
      // l'eau (vitesse limite x 5), le vertical reste x 0,8
      const k = enEau ? 0.8 : 0.5, kh = enEau && this.effets?.size && this.niveauEffet('dolphins_grace') ? 0.96 : k;
      this.vx *= kh; this.vy *= k; this.vz *= kh;
      if (enEau) {
        if (this.vy <= 0 && Math.abs(this.vy - 0.005) >= 0.003 && Math.abs(this.vy - GRAVITE / 16) < 0.003) this.vy = -0.003; else this.vy -= GRAVITE / 16;
      } else this.vy -= GRAVITE / 4;
      if (this.bute) {
        const b = this.boite(this.x + this.vx, this.y + this.vy + 0.6 - this.y + yAvant, this.z + this.vz);
        if (!coupe(lec, b)) this.vy = 0.3;
      }
      if (enLave) this.degats(4, 'lave');
      return;
    }
    // gravite, trainee, friction
    const f = this.auSol ? friction * FRICTION_AIR : FRICTION_AIR;
    this.vy = (this.vy - GRAVITE) * TRAINEE;
    this.vx *= f; this.vz *= f;
    if (Math.abs(this.vx) < 0.003) this.vx = 0;
    if (Math.abs(this.vz) < 0.003) this.vz = 0;
  }

  // Entity.doWaterSplashEffect : son selon la vitesse, bulles et gouttes
  eclaboussure() {
    const sim = this.sim, v = Math.sqrt(this.vx * this.vx * 0.2 + this.vy * this.vy + this.vz * this.vz * 0.2) * 0.2, vol = Math.min(1, v);
    sim.son(vol < 0.25 ? 'entity.player.splash' : 'entity.player.splash.high_speed', this.x, this.y, this.z, vol, 1 + (sim.hasard.flottant() - sim.hasard.flottant()) * 0.4);
    const n = 1 + Math.floor(LARGEUR * 20);
    for (let i = 0; i < n; i++) {
      sim.particule('bubble', this.x + (sim.hasard.flottant() * 2 - 1) * LARGEUR / 2, this.y + 1, this.z + (sim.hasard.flottant() * 2 - 1) * LARGEUR / 2, this.vx, this.vy - sim.hasard.flottant() * 0.2, this.vz, 1);
      sim.particule('splash', this.x + (sim.hasard.flottant() * 2 - 1) * LARGEUR / 2, this.y + 1, this.z + (sim.hasard.flottant() * 2 - 1) * LARGEUR / 2, this.vx, this.vy, this.vz, 1);
    }
  }

  // ---------------------------------------------------------------- sante (LivingEntity.hurt, actuallyHurt, die, tickDeath)
  // Degats d'une source ('chute', 'explosion', 'lave', 'noyade', 'generique'...). L'evenement du monde `acteur.degats` peut les changer (ev.quantite)
  // ou les annuler (ev.annuler()) ; `invulnerable: true` sur l'acteur ou la regle `vie.actif: false` les coupent. Rend vrai si de la vie a ete perdue.
  degats(quantite, source = 'generique') {
    const sim = this.sim;
    if (this.mort >= 0 || this.invulnerable || !sim.regles.valeur('vie.actif', true)) return false;
    if (this.ia?.esquive?.(source)) return false;   // enderman : un projectile le manque (il se teleporte)
    if (this.typeCreature === 'end_crystal') return sim.boss.cristalTouche(this, source);   // EndCrystal.hurtServer : il explose
    if (this.ia?.refuseDegats(source)) return false;   // wither qui charge ou en armure (fleches), warden qui creuse, dragon qui meurt
    if (this.ia) quantite = this.ia.ajusterDegats(quantite, source);   // dragon : d / 4 + 1 sur le corps, mort differee
    const ev = sim.api.evenement('acteur.degats', { acteur: this.nom, quantite, source });
    if (ev.annule) return false;
    let q = Number(ev.quantite);
    if (!(q > 0)) return false;
    let nouveau = true;
    if (this.invulTemps > 10) {                 // fenetre d'invulnerabilite de 10 ticks : seul un coup plus fort passe, pour la difference
      if (q <= this.derniereBlessure) return false;
      const reste = q - this.derniereBlessure; this.derniereBlessure = q; q = reste; nouveau = false;
    } else { this.derniereBlessure = q; this.invulTemps = 20; this.hurtTime = 10; }
    this.vie = Math.max(0, this.vie - q);
    sim.dire(`${this.nom} perd ${q} (${source}) : ${this.vie}/${this.vieMax}`);
    sim.stats.degats = (sim.stats.degats || 0) + q;
    if (this.vie <= 0) this.mourir(source);
    else if (nouveau) sim.son(this.typeCreature ? `entity.${this.typeCreature}.hurt` : 'entity.player.hurt', this.x, this.y, this.z, 1, 1 + (sim.hasard.flottant() - sim.hasard.flottant()) * 0.2);
    if (this.vie > 0) this.ia?.apresDegats?.(source, q);   // enderman (teleportation), chauve-souris (reveil), abeille (colere)
    return true;
  }
  mourir(source) {
    const sim = this.sim;
    if (this.ia?.convertirMort?.(source)) return;   // villageois tue par un zombie : il devient zombie villageois (Zombie.killedEntity)
    this.ia?.surMort?.(source);                      // villageois tue par un joueur : les temoins s'en souviennent (VILLAGER_KILLED)
    this.mort = 0;
    sim.son(this.typeCreature ? `entity.${this.typeCreature}.death` : 'entity.player.death', this.x, this.y, this.z, 1, 1 + (sim.hasard.flottant() - sim.hasard.flottant()) * 0.2);
    sim.stats.morts = (sim.stats.morts || 0) + 1;
    if (this.typeCreature && sim.regles.valeur('butin.actif', true)) {   // butin de la creature (LivingEntity.dropAllDeathLoot) : objets au sol
      for (const [objet, min, max] of BUTIN[this.typeCreature] ?? []) { const n = min + sim.hasard.entierBorne(max - min + 1); if (n > 0) sim.entites.objet(objet, n, this.x, this.y + this.H / 2, this.z); }
    }
    if (this.ia) (sim.stats.iaJournal ??= []).push(`${(sim.temps / 20).toFixed(2)} ${this.nom} meurt (${source})`);
    sim.dire(`${this.nom} meurt (${source})`);
    (sim.stats.mortsListe ??= []).push(`${this.nom} t=${(sim.temps / 20 / sim.replay.ralenti).toFixed(1).replace('.', ',')} ${source}`);
    if (this.tache) this.finirTache('interrompu', 'mort');
    this.regard = null; this.entree = { avance: 0, cap: this.lacet, saute: false }; this.saut = false;
    sim.api.evenement('acteur.meurt', { acteur: this.nom, source, pos: [this.x, this.y, this.z] });
  }
  // atterrissage apres une chute de `dist` blocs : ceil(dist - 3) points de vie (3 = distance de chute sans degats), x regle `vie.chute`
  atterrir(dist) {
    const sim = this.sim, R = sim.regles;
    const q = Math.ceil((dist - R.valeur('vie.chuteSeuil', 3)) * R.valeur('vie.chute', 1));
    if (q > 0) { sim.son(q > 4 ? 'entity.player.big_fall' : 'entity.player.small_fall', this.x, this.y, this.z, 1, 1); sim.stats.chutes = (sim.stats.chutes || 0) + 1; sim.stats.chuteMax = Math.max(sim.stats.chuteMax || 0, q); this.degats(q, 'chute'); }
  }
  // noyade : 300 ticks d'air, puis 2 de degats par seconde apres -20 (LivingEntity.baseTick)
  respirer(tete) {
    if (tete) {
      this.air--;
      if (this.air <= -20) { this.air = 0; this.degats(2, 'noyade'); for (let i = 0; i < 8; i++) this.sim.particule('bubble', this.x, this.y + 1.5, this.z, 0, 0.1, 0, 1); }
    } else this.air = Math.min(300, this.air + 4);
  }

  // Player.maybeBackOffFromEdge : accroupi, on ne quitte pas le bord (pas de chute possible a 0,6)
  sansTomber(mx, mz) {
    const lec = this.lec, step = 0.05;
    const surBord = (dx, dz) => !coupe(lec, [this.x + dx - this.L / 2, this.y - PAS, this.z + dz - this.L / 2, this.x + dx + this.L / 2, this.y - 1e-6, this.z + dz + this.L / 2]);
    while (mx !== 0 && surBord(mx, 0)) mx = Math.abs(mx) <= step ? 0 : mx - Math.sign(mx) * step;
    while (mz !== 0 && surBord(0, mz)) mz = Math.abs(mz) <= step ? 0 : mz - Math.sign(mz) * step;
    while (mx !== 0 && mz !== 0 && surBord(mx, mz)) { mx = Math.abs(mx) <= step ? 0 : mx - Math.sign(mx) * step; mz = Math.abs(mz) <= step ? 0 : mz - Math.sign(mz) * step; }
    return [mx, mz];
  }
  // Entity.checkInsideBlocks : chaque cellule touchee par la boite (reduite de 1e-5) recoit l'evenement `entre`
  toucherBlocs() {
    const sim = this.sim, b = this.boite();
    const x0 = Math.floor(b[0] + 1e-5), x1 = Math.floor(b[3] - 1e-5), y0 = Math.floor(b[1] + 1e-5), y1 = Math.floor(b[4] - 1e-5), z0 = Math.floor(b[2] + 1e-5), z1 = Math.floor(b[5] - 1e-5);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const e = sim.monde.etatEn(x, y, z);
      if (e < 0) continue;
      const bl = sim.d.blocDe(e);
      if (!sim.reg.a('entre', bl)) continue;
      sim.reg.lancerBloc('entre', bl, evenement({ pos: [x, y, z], etat: sim.d.chaine(e), bloc: sim.d.nomBloc(e), entite: { type: 'joueur', nom: this.nom, id: this.id } }), sim.api);
    }
  }

  // ---------------------------------------------------------------- un tick
  tick() {
    const sim = this.sim;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invulTemps > 0) this.invulTemps--;
    if (this.mort >= 0) { this.tickMort(); this.ecrire(); if (this.ia && this.mort < 21) this.sim.replay.ia(this.sim.temps, this.id, 0, 0, 0, 0); return; }      // LivingEntity.tickDeath : le corps tombe, 20 ticks, puis un nuage et il disparait
    this.regardTache = this.tache && (this.tache.etat === 'vise' || this.tache.etat === 'mine') ? this.regardTache : null;
    if (this.delaiCassage > 0) this.delaiCassage--;
    this.demarrerDues();
    this.entree = { avance: 0, cap: this.lacet, saute: false };
    this.tickEffets();
    if (this.feuJoueur > 0) this.brulerJoueur();
    if (this.ia && !this.tache) this.ia.tick();   // IA : seulement quand aucune intention ecrite ne tourne (les actes l'emportent)
    else { this.tickTache(); if (this.ia) this.ia.ecrire(); }
    this._regard();
    const x0 = this.x, z0 = this.z;
    this.physique();
    // pas (Entity.moveDist x 0,6, nextStep) : GameEvent.STEP pour les capteurs de sculk et les wardens (ignore accroupi)
    if (this.auSol && !this.vole && sim.vibrations.actif()) {
      this.distPas = (this.distPas ?? 0) + Math.hypot(this.x - x0, this.z - z0) * 0.6;
      if (this.distPas > (this.prochainPas ?? 1)) { this.prochainPas = Math.floor(this.distPas) + 1; sim.vibrations.emettre('step', this.x, this.y, this.z, { source: this.nom, accroupi: this.accroupi }); }
    }
    if (this.ramasse && this.mort < 0) sim.entites.ramasser(this);
    this._majBalancement();
    this.ecrire();
  }
  // joueur en feu (petite boule de feu du blaze : 5 s) : 1 degat par seconde, flammes ; l'eau l'eteint
  brulerJoueur() {
    const sim = this.sim;
    if (this.dansEau) { this.feuJoueur = 0; return; }
    this.feuJoueur--;
    if (this.feuJoueur % 20 === 0) this.degats(1, 'feu');
    if (this.feuJoueur % 3 === 0) sim.particule('flame', this.x + (sim.hasard.flottant() - 0.5) * 0.6, this.y + 0.3 + sim.hasard.flottant() * 1.4, this.z + (sim.hasard.flottant() - 0.5) * 0.6, 0, 0.02, 0, 1);
  }
  tickMort() {
    const sim = this.sim;
    if (this.mortSansCorps) { this.mort = 21; return; }
    if (this.mort < 20) this.mort++;
    else if (this.mort === 20) this.mort = 21;
    if (this.mort === 20) {
      for (let i = 0; i < 20; i++) sim.particule('poof', this.x + (sim.hasard.flottant() * 2 - 1) * 0.3, this.y + sim.hasard.flottant() * HAUTEUR, this.z + (sim.hasard.flottant() * 2 - 1) * 0.3, sim.hasard.flottant() * 0.04 - 0.02, sim.hasard.flottant() * 0.04 - 0.02, sim.hasard.flottant() * 0.04 - 0.02, 1);
    }
    this.entree = { avance: 0, cap: this.lacet, saute: false };
    this.physique();
    this.balancement = 0;
  }
  ecrire() {
    const sim = this.sim;
    // marche : position et amplitude des membres (LivingEntity.updateWalkAnimation)
    const dist = Math.hypot(this.x - this.xPrec, this.z - this.zPrec);
    const f = Math.min(dist * 4, 1);
    this.membres.amplitude += (f - this.membres.amplitude) * 0.4;
    this.membres.phase += this.membres.amplitude;
    this.xPrec = this.x; this.zPrec = this.z;
    let dr = 0;
    if (this.accroupi) dr |= DRAPEAUX.ACCROUPI; if (this.auSol) dr |= DRAPEAUX.AU_SOL; if (this.course) dr |= DRAPEAUX.COURSE; if (this.balance.actif) dr |= DRAPEAUX.BALANCE; if (this.dansEau) dr |= DRAPEAUX.EAU;
    if (this.usage) dr += this.usage.type * 64 + Math.min(this.usage.ticks, 4095) * 512;       // pose d'utilisation (manger, boire, arc, arbalete) : voir film/acteurs-vivants.js
    if (this.effets.size) { if (this.niveauEffet('invisibility')) dr += BIT.INVISIBLE; if (this.niveauEffet('glowing')) dr += BIT.LUEUR; }
    sim.replay.acteur(sim.temps, this.id, this.x, this.y, this.z, this.lacet, this.lacetTete, this.tangage, dr, this.balancement, this.cassage, this.main.objet ? sim.replay.nom(this.main.objet) : -1, this.membres.phase, this.membres.amplitude, this.hurtTime, this.mort < 0 ? 0 : this.mort + 1);
  }
}

export class EchecActe extends Error {}

// gabarit d'un bebe sans la table des creatures (essais) : dimensions de bebe du jeu (ESPECES[type][5]) ou celles du parent a l'echelle
function gabaritDe(type, bebe, parent) {
  const p = parent ?? { l: LARGEUR, h: HAUTEUR, oeil: OEIL, vitesse: 1 };
  const b = bebe ? ESPECES[type]?.[5] : null;
  if (b && b.length === 3) return { ...p, l: b[0], h: b[1], oeil: b[2] };
  if (b && b.length === 1) return { ...p, l: p.l * b[0], h: p.h * b[0], oeil: p.oeil * b[0] };
  return { ...p };
}

export class Acteurs {
  // descripteurs : [{ nom, x, y, z, lacet, objet, actes: [{ tick, verbe, ... }] }]
  constructor(sim, descripteurs) {
    this.sim = sim;
    const m = sim.monde;
    this.lec = { etatEn: (x, y, z) => m.etatEn(x, y, z), d: sim.d, dyn: (e, x, y, z) => sim.formeDyn(e, x, y, z), get limites() { return { x0: m.x0, x1: m.x0 + m.sx, z0: m.z0, z1: m.z0 + m.sz }; } };   // la boite du monde (qui peut grandir)
    this.liste = descripteurs.map((d, i) => new Acteur(this, i, d));
    this.parNom = new Map(this.liste.map((a) => [a.nom, a]));
    sim.replay.acteurs = this.liste.map((a) => a.nom);
  }
  // les acteurs nes pendant ce tick (naitre) ne jouent qu'au tick suivant ; leur premier enregistrement est ecrit a la naissance
  tick() { const n = this.liste.length; for (let i = 0; i < n; i++) this.liste[i].tick(); }

  // ---------------------------------------------------------------- entites nees pendant la simulation (docs/SIMULATION.md partie 17)
  // o : { type, variante, bebe, x, y, z, lacet, modele (acteur dont le film reprend les reglages), raison, ia (champs d'IA en plus), nom, gabaritParent }
  // Plafonds (regles) : `naissances.max` entites nees par scene, `entites.max` acteurs en tout. Rend l'acteur, ou null (plafond atteint).
  peutNaitre() { const R = this.sim.regles; return (this.nbNes ?? 0) < R.valeur('naissances.max', 16) && this.liste.length < R.valeur('entites.max', 40); }
  naitre(o) {
    const sim = this.sim;
    if (!this.peutNaitre()) { sim.avertir(`plafond des entites atteint (naissances.max ${sim.regles.valeur('naissances.max', 16)}, entites.max ${sim.regles.valeur('entites.max', 40)}) : ${o.type} pas ne`); return null; }
    this.nbNes = (this.nbNes ?? 0) + 1;
    let nom = o.nom ?? `${o.modele}_${o.raison === 'reproduction' ? 'bebe' : o.type}`;
    if (this.parNom.has(nom)) { let k = 2; while (this.parNom.has(`${nom}${k}`)) k++; nom = `${nom}${k}`; }
    const c = { type: o.type, variante: o.variante ?? null, bebe: !!o.bebe };
    const cr = this.sim.creatures, st = cr?.stats?.(o.type) ?? null;
    const gab = cr?.gabarit ? cr.gabarit(c) : gabaritDe(o.type, c.bebe, o.gabaritParent);
    const gabAdulte = cr?.gabarit ? cr.gabarit({ ...c, bebe: false }) : (o.gabaritParent ?? gab);
    const d = { nom, x: o.x, y: o.y, z: o.z, lacet: o.lacet ?? 0, objet: o.objet ?? null, vie: o.vie ?? st?.pv, gabarit: gab, typeCreature: o.type, actes: [],
      ia: { type: o.type, variante: c.variante, bebe: c.bebe, vitesseAttr: st?.v ?? o.vitesseAttr ?? 0.25, vie: o.vie ?? st?.pv ?? 20, gabaritAdulte: gabAdulte, ...(o.ia ?? {}) } };
    const a = new Acteur(this, this.liste.length, d);
    this.liste.push(a); this.parNom.set(nom, a); sim.replay.acteurs.push(nom);
    sim.replay.naissances.push({ tick: sim.temps, nom, pos: [o.x, o.y, o.z].map((v) => Math.round(v * 1000) / 1000), type: o.type, variante: c.variante, bebe: c.bebe, modele: o.modele ?? null, raison: o.raison ?? 'apparition', ...(o.ia?.apprivoise ? { apprivoise: true } : {}), ...(o.colle ? { colle: o.colle } : {}), ...(o.objet ? { objet: o.objet } : {}) });
    (sim.stats.naissances ??= []).push(`${(sim.temps / 20).toFixed(2)} ${nom} (${o.type}${c.variante ? ' ' + c.variante : ''}${c.bebe ? ', bebe' : ''}, ${o.raison ?? 'apparition'}${o.modele ? ' de ' + o.modele : ''})`);
    sim.dire(`${nom} apparait (${o.raison ?? 'apparition'})`);
    sim.api.evenement('creature.nait', { creature: nom, type: o.type, raison: o.raison ?? 'apparition', parent: o.modele ?? null, pos: [o.x, o.y, o.z] });
    a.ecrire(); if (a.ia) a.ia.ecrire();
    return a;
  }
  // BeehiveBlock.playerDestroy : les abeilles de la ruche sortent en urgence (en colere contre celui qui casse s'il est a 4 blocs), et
  // angerNearbyBees : toutes les abeilles a 8 x 6 x 8 blocs sans cible le prennent pour cible
  rucheCassee(pos, joueur) {
    for (const phase of ['sortie', 'colere']) for (const o of [...this.liste]) if (o.ia && o.mort < 0) o.ia.surRucheCassee?.(pos, joueur, phase);
  }
  // sol sous le point (x, z) pres de la hauteur `yRef` (ou le plus haut sol de la colonne)
  solAuxCoordonnees(x, z, yRef) {
    const s = solSous(this.lec, x, z, yRef + 4, 0.5, 12);
    if (s !== null) return s;
    return solSous(this.lec, x, z, 319, 0.5, 400);
  }
}
installerUtilisation(Acteur, EchecActe);
void VEC; void FR; void FACE_3D; void blocsOuvrables; void ticksPourCasser; void etapeFissure; void dirDeLacet;
