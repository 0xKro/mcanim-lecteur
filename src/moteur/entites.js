// Entites non vivantes du monde (phase 5, apres les acteurs) : TNT amorce et blocs qui tombent. Chaque tick de chaque entite est ecrit dans le replay
// (colonne `entites`) ; le rendu les dessine. Port de Horizon client/game/{tnt,falling_blocks}.rs et world/block_landing.rs : MIT, voir ATTRIBUTIONS.md.
//   TNT amorce : meche 80 ticks, gravite 0,04, trainee 0,98, sol x (0,7 ; -0,5 ; 0,7), saut de depart (0,2 vers le haut), explose a la fin de la meche.
//   Bloc qui tombe : gravite 0,04 puis 0,98, se repose dans la cellule ou il s'arrete si elle est remplacable.
//   Objet au sol (ItemEntity) : boite 0,25, gravite 0,04, trainee 0,98, friction du sol x 0,98, rebond -0,5, delai de ramassage 10 ticks, fusion des
//   piles identiques, 6000 ticks de vie, courant de l'eau ; ramasse par un acteur (`ramasse: true`) dont la boite elargie de (1 ; 0,5 ; 1) le touche,
//   avec l'animation de ramassage du jeu (3 ticks vers l'acteur) et le son entity.item.pickup.
import { deplacerBoite, coupe } from './collision.js';
import { colonnesBulles, pousseeBulle } from './vehicules.js';   // colonnes de bulles (BubbleColumnBlock.entityInside)

// Experience du joueur (Player.giveExperiencePoints, getXpNeededForNextLevel, giveExperienceLevels ; Horizon entities.rs Experience, MIT) :
// niveau, progression (flottant simple), total ; au passage d'un niveau multiple de 5, son entity.player.levelup (volume min(1, n / 30) x 0,75),
// pas plus d'une fois par 100 ticks.
export const xpPourNiveau = (n) => (n >= 30 ? 112 + (n - 30) * 9 : n >= 15 ? 37 + (n - 15) * 5 : 7 + n * 2);
export function donnerXp(sim, a, points) {
  a.niveauXp ??= 0; a.progresXp ??= 0; a.xp = (a.xp ?? 0) + points;
  let p = Math.fround(a.progresXp + Math.fround(points / xpPourNiveau(a.niveauXp))), son = null;
  while (p >= 1) { p = Math.fround((p - 1) * xpPourNiveau(a.niveauXp)); a.niveauXp++; if (a.niveauXp % 5 === 0) son ??= a.niveauXp; p = Math.fround(p / xpPourNiveau(a.niveauXp)); }
  a.progresXp = p;
  if (son !== null && (a.dernierNiveauSon ?? -1e9) < sim.temps - 100) { a.dernierNiveauSon = sim.temps; sim.son('entity.player.levelup', a.x, a.y, a.z, (son > 30 ? 1 : son / 30) * 0.75, 1); }
  sim.stats.xpRamassee = (sim.stats.xpRamassee || 0) + points;
}
import { blocSous, vitesseApresContact } from './rebond.js';   // rebond des lits et du slime (non vivants : x 0,8)
import { exploser } from './explosion.js';
import { butinDe } from './butin.js';
import { lirePile } from './pile.js';
import { evenement } from './registre.js';
import { Projectiles } from './projectiles.js';
import { Aleatoire } from './aleatoire.js';

const F_TOUS = 3;
const LARGEUR = 0.98;
const COTE_OBJET = 0.25;

export class Entites {
  constructor(sim) {
    this.sim = sim; this.liste = []; this.prochain = 0;
    this.proj = new Projectiles(this);       // fleches, boules de neige, perles, potions, trident (projectiles.js)
    this.lec = { d: sim.d, etatEn: (x, y, z) => sim.monde.etatEn(x, y, z), dyn: (e, x, y, z) => sim.formeDyn(e, x, y, z) };
  }
  get actives() { return this.liste.length; }

  // TNT amorce en (x, y, z) (coordonnees du bloc) ; meche : ticks (defaut : regle tnt.meche)
  tnt(x, y, z, meche, pal = -1) {
    const s = this.sim, a = s.hasard.reel() * 2 * Math.PI;
    const e = { id: this.prochain++, type: 'tnt', x: x + 0.5, y, z: z + 0.5, vx: -Math.sin(a) * 0.02, vy: 0.2, vz: -Math.cos(a) * 0.02, meche: meche ?? s.regles.valeur('tnt.meche', 80), debut: s.temps, pal };
    this.liste.push(e);
    s.son('entity.tnt.primed', e.x, e.y, e.z, 1, 1);
    s.dire(`tnt amorce (${x},${y},${z}) meche ${e.meche}`);
    return e;
  }
  // bloc qui tombe : l'etat (texte) quitte la cellule (x, y, z)
  chute(x, y, z, etat) {
    const s = this.sim;
    const e = { id: this.prochain++, type: 'chute', x: x + 0.5, y: y + 0.01, z: z + 0.5, vx: 0, vy: 0, vz: 0, etat, pal: s.monde.indicePalette(etat), debut: s.temps };
    this.liste.push(e);
    return e;
  }

  // ------------------------------------------------------------ objets au sol
  // Un objet (nom sans 'minecraft:', nombre) en (x, y, z) : vitesse de depart du jeu (Block.popResource : (+-0,1 ; 0,2 ; +-0,1)), ramassable apres `delai` ticks
  objet(nom, n, x, y, z, opt = {}) {
    const s = this.sim, h = s.hasard;
    const e = { id: this.prochain++, type: 'objet', item: String(nom).replace(/^minecraft:/, ''), n, x, y, z, vx: opt.vx ?? h.flottant() * 0.2 - 0.1, vy: opt.vy ?? 0.2, vz: opt.vz ?? h.flottant() * 0.2 - 0.1, age: 0, delai: opt.delai ?? s.regles.valeur('objets.delai', 10), debut: s.temps, pris: null };
    this.liste.push(e);
    s.stats.objets = (s.stats.objets || 0) + n;
    return e;
  }
  // Level.destroyBlock -> Block.dropResources : les objets du bloc de l'etat `e` (numero d'etat), sans le retirer. opt : { explosion (puissance), outilOk, acteur, source }
  // Rend la liste [[objet, n], ...] lachee. L'evenement de bloc `butin` (ev.butin) peut la changer ou l'annuler (ev.annuler()).
  lacher(x, y, z, e, opt = {}) {
    const s = this.sim, d = s.d;
    if (!s.regles.valeur('butin.actif', true) || (opt.outilOk === false)) return [];
    const nom = d.nomBloc(e), liste = butinDe(d, nom, d.props(e), { hasard: s.hasard, explosion: opt.explosion ?? null, outil: opt.outil ? lirePile(opt.outil) : null, etiquetteObjet: (id, et) => !!s.objetsJeu?.etiquette('item', et).has(id) });
    const bloc = d.blocDe(e), ev = evenement({ pos: [x, y, z], etat: d.chaine(e), bloc: 'minecraft:' + nom, butin: liste.map((l) => [l[0], l[1]]), acteur: opt.acteur ?? null, source: opt.source ?? 'casse', explosion: opt.explosion ?? 0 });
    if (s.reg.a('butin', bloc)) s.reg.lancerBloc('butin', bloc, ev, s.api);
    if (ev.annule) return [];
    for (const [item, n] of ev.butin) {
      if (!(n > 0)) continue;
      // Block.popResource : position tiree dans le bloc (+-0,25 autour du centre, 0,125 plus bas)
      this.objet(item, n, x + 0.5 + (s.hasard.flottant() * 0.5 - 0.25), y + 0.5 + (s.hasard.flottant() * 0.5 - 0.25) - 0.125, z + 0.5 + (s.hasard.flottant() * 0.5 - 0.25));
    }
    return ev.butin;
  }

  // Les objets que donnerait le bloc \`e\` detruit par une explosion de puissance P, sans les creer (evenement \`butin\` compris)
  collecterButin(x, y, z, e, P) {
    const s = this.sim, d = s.d, nom = d.nomBloc(e), liste = butinDe(d, nom, d.props(e), { hasard: s.hasard, explosion: P });
    const bloc = d.blocDe(e), ev = evenement({ pos: [x, y, z], etat: d.chaine(e), bloc: 'minecraft:' + nom, butin: liste.map((l) => [l[0], l[1]]), acteur: null, source: 'explosion', explosion: P });
    if (s.reg.a('butin', bloc)) s.reg.lancerBloc('butin', bloc, ev, s.api);
    return ev.annule ? [] : ev.butin;
  }

  tickObjet(e) {
    const s = this.sim, regles = s.regles, d = s.d;
    if (e.pris) {                                   // animation de ramassage : 3 ticks vers l'acteur (ItemPickupParticle), puis l'objet disparait
      const a = e.pris.acteur, k = ++e.pris.k, t = Math.min(1, k / 3) ** 2;
      e.x = e.pris.de[0] + (a.x - e.pris.de[0]) * t; e.y = e.pris.de[1] + (a.y + 0.81 - 0.125 - e.pris.de[1]) * t; e.z = e.pris.de[2] + (a.z - e.pris.de[2]) * t;
      if (k >= 3) { this._fini.add(e); return false; }
      return true;
    }
    if (e.delai > 0) e.delai--;
    // fluide : l'eau pousse (0,014 dans le sens du courant), freine et fait monter ; la lave freine plus
    const cx = Math.floor(e.x), cy = Math.floor(e.y + COTE_OBJET / 2), cz = Math.floor(e.z), fl = s.fluide(cx, cy, cz);
    const dessus = fl.type ? cy + (s.fluide(cx, cy + 1, cz).type === fl.type ? 1 : fl.quantite / 9) - e.y : 0;
    const dansFluide = fl.type && dessus > 0.1;
    if (fl.type === 'water' && dessus > 0) {
      const c = s.courant(cx, cy, cz);
      if (Math.hypot(...c) > 0) { e.vx += c[0] * 0.014; e.vy += c[1] * 0.014; e.vz += c[2] * 0.014; }
    }
    if (dansFluide && fl.type === 'water') { e.vx *= 0.99; e.vz *= 0.99; if (e.vy < 0.06) e.vy += 5e-4; }
    else if (dansFluide) { e.vx *= 0.95; e.vz *= 0.95; if (e.vy < 0.06) e.vy += 5e-4; }
    else e.vy -= regles.valeur('objets.gravite', 0.04);
    const b = [e.x - COTE_OBJET / 2, e.y, e.z - COTE_OBJET / 2, e.x + COTE_OBJET / 2, e.y + COTE_OBJET, e.z + COTE_OBJET / 2];
    const vy0 = e.vy, r = deplacerBoite(this.lec, b, [e.vx, e.vy, e.vz], false, 0);
    e.x += r.dx; e.y += r.dy; e.z += r.dz;
    if (r.bloqueX) e.vx = 0;
    if (r.bloqueZ) e.vz = 0;
    if (r.bloqueY) e.vy = this.rebond(e, vy0, r, regles.valeur('objets.gravite', 0.04));
    // Entity.move -> applyEffectsFromBlocks : colonnes de bulles, puis les blocs qui sentent les entites (fil piege)
    const bo = [e.x - COTE_OBJET / 2, e.y, e.z - COTE_OBJET / 2, e.x + COTE_OBJET / 2, e.y + COTE_OBJET, e.z + COTE_OBJET / 2];
    for (const c of colonnesBulles(s, bo)) pousseeBulle(c, e, s);
    s.toucherBlocsEntite(bo, { type: 'objet', id: e.id });
    let f = 0.98;
    if (r.auSol) { const k = this.lec.etatEn(Math.floor(e.x), Math.floor(e.y - 0.5000001), Math.floor(e.z)); f = (k >= 0 ? d.friction(k) || 0.6 : 0.6) * 0.98; }
    e.vx *= f; e.vy *= 0.98; e.vz *= f;
    if (r.auSol && e.vy < 0) e.vy *= -0.5;                 // rebond : la moitie de la vitesse, vers le haut
    e.auSol = r.auSol;
    // fusion des piles identiques (toutes les 40 ticks, 2 si l'objet change de cellule) et fin de vie
    if (regles.valeur('objets.fusion', true) && e.age % (cx !== e.cx || cz !== e.cz || cy !== e.cy ? 2 : 40) === 0) this.fusionner(e);
    e.cx = cx; e.cy = cy; e.cz = cz;
    e.age++;
    if (e.age >= regles.valeur('objets.vie', 6000)) { this._fini.add(e); return false; }
    return !this._fini.has(e);
  }
  // ItemEntity.mergeWithNeighbours : une pile voisine (boite elargie de 0,5 en x et z) du meme objet absorbe la plus petite
  fusionner(e) {
    for (const o of this.liste) {
      if (o === e || o.type !== 'objet' || o.pris || o.detruit || o.item !== e.item || this._fini.has(o) || this._fini.has(e)) continue;
      if (Math.abs(o.x - e.x) > COTE_OBJET + 0.5 || Math.abs(o.z - e.z) > COTE_OBJET + 0.5 || Math.abs(o.y - e.y) > COTE_OBJET) continue;
      if (o.n + e.n > 64) continue;
      const [gros, petit] = o.n < e.n ? [e, o] : [o, e];
      gros.n += petit.n; gros.delai = Math.max(gros.delai, petit.delai); gros.age = Math.min(gros.age, petit.age);
      this._fini.add(petit);
      return;
    }
  }
  // Un acteur (`ramasse: true`) touche des objets : PlayerTouch. Boite elargie de (1 ; 0,5 ; 1), delai de ramassage ecoule.
  ramasser(a) {
    const s = this.sim, b = a.boite(), bx = [b[0] - 1, b[1] - 0.5, b[2] - 1, b[3] + 1, b[4] + 0.5, b[5] + 1];
    for (const e of this.liste) {
      if (e.type !== 'objet' || e.pris || e.delai > 0 || e.detruit || this._fini?.has(e)) continue;
      if (e.x + COTE_OBJET / 2 < bx[0] || e.x - COTE_OBJET / 2 > bx[3] || e.y + COTE_OBJET < bx[1] || e.y > bx[4] || e.z + COTE_OBJET / 2 < bx[2] || e.z - COTE_OBJET / 2 > bx[5]) continue;
      e.pris = { acteur: a, k: 0, de: [e.x, e.y, e.z] };
      a.sac.set(e.item, (a.sac.get(e.item) || 0) + e.n);
      s.son('entity.item.pickup', e.x, e.y, e.z, 0.2, (s.hasard.flottant() - s.hasard.flottant()) * 1.4 + 2);
      s.stats.ramasses = (s.stats.ramasses || 0) + e.n;
      s.api.evenement('acteur.ramasse', { acteur: a.nom, objet: e.item, nombre: e.n });
    }
  }

  // Un entonnoir aspire les objets au sol dans `boite` [x1,y1,z1,x2,y2,z2] : fn(objet) rend ce qui n'a pas pu entrer ; rend vrai si quelque chose est entre
  prendre(boite, fn) {
    let pris = false;
    for (const e of this.liste) {
      if (e.type !== 'objet' || e.pris || (this._fini && this._fini.has(e))) continue;
      if (e.x < boite[0] || e.x > boite[3] || e.y + COTE_OBJET < boite[1] || e.y > boite[4] || e.z < boite[2] || e.z > boite[5]) continue;
      const reste = fn(e);
      if (reste < e.n) { pris = true; e.n = reste; }
      if (reste <= 0) { e.age = 1e9; e.pris = null; e.n = 0; }
    }
    if (pris) this.liste = this.liste.filter((e) => !(e.type === 'objet' && e.n <= 0));
    return pris;
  }

  tick() {
    const s = this.sim, fini = (this._fini = new Set());
    for (const e of [...this.liste]) {
      if (fini.has(e)) continue;
      if (e.detruit) { fini.add(e); continue; }                 // objet ou orbe detruit par une explosion (moteur/explosion.js)
      if (e.debut === s.temps) { this.ecrire(e); continue; }    // creee ce tick : elle ne bouge qu'au suivant (meche exacte)
      if (e.proj) { this.proj.tick(e); continue; }
      if (e.tickPerso) { if (e.tickPerso(e)) this.ecrire(e); else fini.add(e); continue; }   // bouchon de peche (peche.js) : entites qui ont leur propre tick
      const vivante = e.type === 'tnt' ? this.tickTnt(e) : e.type === 'objet' ? this.tickObjet(e) : e.type === 'orbe' ? this.tickOrbe(e) : this.tickChute(e);
      if (vivante) this.ecrire(e);
    }
    this.liste = this.liste.filter((e) => !fini.has(e) && !e.detruit);    // les entites creees pendant ce tick (chaine) restent
  }

  ecrire(e) { if (e.proj) { this.proj.ecrire(e); return; } if (e.ecrirePerso) { e.ecrirePerso(e); return; } this.sim.replay.entite(this.sim.temps, e.id, e.type, e.x, e.y, e.z, e.type === 'tnt' ? e.meche : e.type === 'objet' ? e.n : e.type === 'orbe' ? e.icone : 0, e.type === 'chute' || e.type === 'tnt' ? e.pal ?? -1 : e.type === 'objet' ? this.sim.replay.nom(e.item) : -1); }

  // orbes d'experience (ExperienceOrb ; Horizon horizon-client/src/entities.rs ExperienceOrb.tick, game/item_entities.rs, MIT) :
  //   - ExperienceOrb.award / awardWithDirection : la valeur coupee en orbes du jeu (2477, 1237, 617... 3, 1) ; chacune entre d'abord dans une
  //     orbe de meme valeur a moins d'un demi-bloc dont l'identifiant est a un multiple de 40 d'un tirage nextInt(40) du monde (count + 1,
  //     age 0 : tryMergeToExisting), sinon une nouvelle orbe ; avec une direction (fiole d'experience) : 0,25 plus loin dans ce sens, vitesse
  //     (+-0,2, 0..0,4, +-0,2) retournee si elle part a l'oppose ; hasard propre de l'orbe (le jeu : Entity.random, sans graine) ;
  //   - tick : gravite 0,03 (sauf coincee dans un bloc), yeux dans l'eau : x 0,99 et +5e-4 (au plus 0,06), lave : rejetee ; vers le joueur
  //     le plus proche a 8 blocs ((1 - d / 8)^2 x 0,1 vers ses yeux / 2) ; deplacement ; axes bloques a 0 ; frottement 0,98 (x la friction
  //     du bloc au sol) sur les trois axes ; rebond 0,4 de la vitesse d'arrivee (si elle tombait a plus de 0,03) ; fusion toutes les 20 ticks
  //     (scanForMerges : meme valeur, identifiants a un multiple de 40) ; 6000 ticks au plus ;
  //   - ramassee au contact (delai de 2 ticks du joueur), une a la fois (count - 1), son pickup 0,1 ; niveaux du joueur : Player.giveExperiencePoints.
  orbes(x, y, z, total, direction = null) {
    const s = this.sim, T = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1], I = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    while (total > 0) {
      const k = T.findIndex((t) => total >= t), v = T[k]; total -= v;
      const idFusion = s.hasard.entierBorne(40);
      const proche = this.liste.find((o) => o.type === 'orbe' && !o.detruit && o.valeur === v && Math.abs(o.x - x) < 0.5 + 0.25 && o.y < y + 0.5 && o.y + 0.5 > y - 0.5 && Math.abs(o.z - z) < 0.5 + 0.25 && (((o.id - idFusion) % 40) + 40) % 40 === 0);
      if (proche) { proche.n = (proche.n ?? 1) + 1; proche.age = 0; continue; }
      const id = this.prochain++, h = new Aleatoire(((s.config.graine ?? 1) * 7919 + id * 2654435761) >>> 0);
      h.reel();   // le lacet de depart (setYRot(nextDouble() x 360)) : sans effet ici, tire pour l'ordre
      let vx = (h.reel() * 0.2 - 0.1) * 2, vy = h.reel() * 0.2 * 2, vz = (h.reel() * 0.2 - 0.1) * 2, px = x, py = y, pz = z;
      if (direction) {
        const L = Math.hypot(...direction), u = L < 1e-5 ? [0, 0, 0] : direction.map((c) => c / L);
        px += u[0] * 0.25; py += u[1] * 0.25; pz += u[2] * 0.25;
        if (L > 0 && direction[0] * vx + direction[1] * vy + direction[2] * vz < 0) { vx = -vx; vy = -vy; vz = -vz; }
      }
      this.liste.push({ id, type: 'orbe', valeur: v, icone: I[k], x: px, y: py, z: pz, vx, vy, vz, age: 0, n: 1, ticks: 0, debut: s.temps });
    }
  }
  tickOrbe(e) {
    const s = this.sim, lec = this.lec;
    e.ticks = (e.ticks ?? 0) + 1;
    const b = [e.x - 0.25, e.y, e.z - 0.25, e.x + 0.25, e.y + 0.5, e.z + 0.25];
    const coince = coupe(lec, b);
    const yeux = e.y + 0.5 * 0.85, fo = s.fluide(Math.floor(e.x), Math.floor(yeux), Math.floor(e.z));
    const dansEau = fo.type === 'water' && Math.floor(yeux) + (s.fluide(Math.floor(e.x), Math.floor(yeux) + 1, Math.floor(e.z)).type === 'water' ? 1 : fo.quantite / 9) > yeux;
    if (dansEau) { e.vx *= Math.fround(0.99); e.vy = Math.min(e.vy + Math.fround(5e-4), Math.fround(0.06)); e.vz *= Math.fround(0.99); }
    else if (!coince) e.vy -= 0.03;
    if (s.fluide(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)).type === 'lava') { const h = s.hasard; e.vx = Math.fround((h.flottant() - h.flottant()) * 0.2); e.vy = Math.fround(0.2); e.vz = Math.fround((h.flottant() - h.flottant()) * 0.2); }
    let cible = null, bd = 64;
    for (const a of s.acteurs?.liste ?? []) { if (a.mort >= 0 || a.typeCreature) continue; const d = (a.x - e.x) ** 2 + (a.y + a.O / 2 - e.y) ** 2 + (a.z - e.z) ** 2; if (d < bd) { bd = d; cible = a; } }
    if (cible) {
      const d = [(cible.x - e.x) / 8, (cible.y + cible.O / 2 - e.y) / 8, (cible.z - e.z) / 8], L = Math.hypot(...d), p = 1 - L;
      if (p > 0 && L > 1e-6) { const k = p * p * 0.1; e.vx += d[0] / L * k; e.vy += d[1] / L * k; e.vz += d[2] / L * k; }
    }
    const voulu = [e.vx, e.vy, e.vz], r = deplacerBoite(lec, b, voulu, false, 0);
    e.x += r.dx; e.y += r.dy; e.z += r.dz;
    const sol = voulu[1] < 0 && r.dy !== voulu[1];
    if (Math.abs(voulu[0] - r.dx) >= 1e-5) e.vx = 0;
    if (Math.abs(voulu[2] - r.dz) >= 1e-5) e.vz = 0;
    if (r.dy !== voulu[1]) e.vy = 0;
    let fr = Math.fround(0.98);
    if (sol) { const sous = lec.etatEn(Math.floor(e.x), Math.floor(e.y - 0.999999), Math.floor(e.z)); fr = Math.fround(fr * (sous >= 0 ? (s.d.friction(sous) || 0.6) : 0.6)); }
    e.vx *= fr; e.vy *= fr; e.vz *= fr;
    if (sol && voulu[1] < -0.03) e.vy = -voulu[1] * 0.4;
    if (++e.age >= 6000) { this._fini.add(e); return false; }
    // scanForMerges (tickCount % 20 == 1) : une orbe voisine (boite elargie de 0,5) de meme valeur, identifiants a un multiple de 40
    if (e.ticks % 20 === 1) for (const o of this.liste) {
      if (o === e || o.type !== 'orbe' || o.detruit || this._fini.has(o) || o.valeur !== e.valeur || (((o.id - e.id) % 40) + 40) % 40 !== 0) continue;
      if (Math.abs(o.x - e.x) < 1 && Math.abs(o.z - e.z) < 1 && o.y < e.y + 1 && o.y + 0.5 > e.y - 0.5) { e.n = (e.n ?? 1) + (o.n ?? 1); e.age = Math.min(e.age, o.age); this._fini.add(o); }
    }
    if (cible) { const k = cible.boite(); if (k[3] > b[0] && k[0] < b[3] && k[4] > b[1] && k[1] < b[4] && k[5] > b[2] && k[2] < b[5] && s.temps >= (cible.delaiXp ?? 0)) {
      cible.delaiXp = s.temps + 2; const xp = cible.reparerXp ? cible.reparerXp(e.valeur) : e.valeur; if (xp > 0) donnerXp(s, cible, xp);   // Raccommodage d'abord (inventaire.js)
      s.son('entity.experience_orb.pickup', e.x, e.y, e.z, 0.1, (s.hasard.flottant() - s.hasard.flottant()) * 0.35 + 0.9);
      e.n = (e.n ?? 1) - 1;
      if (e.n <= 0) { this._fini.add(e); return false; }
    } }
    return true;
  }

  // Entity.restituteMovementAfterCollisions d'un non-vivant : rebond du bloc sous lui x 0,8 (lit 0,6, slime 0,8), sinon 0 (rebond.js)
  rebond(e, vy0, r, g) {
    const v = r.auSol ? vitesseApresContact(vy0, r.dy, g, blocSous(this.lec, e.x, e.y, e.z), { vivant: false }) : 0;
    if (v > 0) this.sim.stats.rebondsObjets = (this.sim.stats.rebondsObjets || 0) + 1;
    return v;
  }
  bouger(e, g) {
    const s = this.sim;
    e.vy -= g;
    const b = [e.x - LARGEUR / 2, e.y, e.z - LARGEUR / 2, e.x + LARGEUR / 2, e.y + LARGEUR, e.z + LARGEUR / 2];
    const vy0 = e.vy, r = deplacerBoite(this.lec, b, [e.vx, e.vy, e.vz], false, 0);
    e.x += r.dx; e.y += r.dy; e.z += r.dz;
    if (r.bloqueX) e.vx = 0;
    if (r.bloqueZ) e.vz = 0;
    if (r.bloqueY) e.vy = this.rebond(e, vy0, r, g);
    // colonnes de bulles (TNT amorce, bloc qui tombe) et blocs qui sentent les entites (fil piege, plaques)
    const bo = [e.x - LARGEUR / 2, e.y, e.z - LARGEUR / 2, e.x + LARGEUR / 2, e.y + LARGEUR, e.z + LARGEUR / 2];
    for (const c of colonnesBulles(s, bo)) pousseeBulle(c, e, s);
    s.toucherBlocsEntite(bo, { type: e.type, id: e.id });
    e.vx *= 0.98; e.vy *= 0.98; e.vz *= 0.98;
    void s;
    return r.auSol;
  }

  tickTnt(e) {
    const s = this.sim;
    const sol = this.bouger(e, s.regles.valeur('tnt.gravite', 0.04));
    if (sol) { e.vx *= 0.7; e.vy *= -0.5; e.vz *= 0.7; }
    e.meche--;
    if (s.reg.aEntite('meche', 'tnt')) {   // gestionnaires d'entite (mc.entite('tnt').sur('meche')) : ev.restant modifiable
      const ev = evenement({ entite: { type: 'tnt', id: e.id, pos: [e.x, e.y, e.z] }, restant: e.meche, pos: [e.x, e.y, e.z] });
      s.reg.lancerEntite('meche', 'tnt', ev, s.api);
      if (Number.isFinite(Number(ev.restant))) e.meche = Math.floor(Number(ev.restant));
    }
    if (e.meche <= 0) {
      this._fini.add(e);
      exploser(s, e.x, e.y + 0.0625 * LARGEUR, e.z, {
        puissance: s.regles.valeur('tnt.puissance', 4), casseBlocs: s.regles.valeur('tnt.casseBlocs', true), feu: s.regles.valeur('tnt.feu', false), pousse: s.regles.valeur('tnt.pousse', true), source: 'tnt',
      });
      return false;
    }
    s.replay.particule(s.temps, 'smoke', e.x, e.y + 0.5, e.z, 0, 0, 0, 1);
    return true;
  }

  tickChute(e) {
    const s = this.sim;
    const sol = this.bouger(e, s.regles.valeur('chute.gravite', 0.04));
    if (!sol && e.y > -64) return true;
    this._fini.add(e);
    const bx = Math.floor(e.x), by = Math.floor(e.y + 1e-6), bz = Math.floor(e.z);
    let etat = e.etat;
    // poudre de beton : au contact de l'eau (cellule d'arrivee ou voisins, hors dessous) elle durcit
    if (/_concrete_powder/.test(etat)) {
      const eau = (x, y, z) => { const k = s.monde.etatEn(x, y, z); return k >= 0 && s.d.fluide(k) >= 1 && s.d.fluide(k) <= 2; };
      if (eau(bx, by, bz) || eau(bx + 1, by, bz) || eau(bx - 1, by, bz) || eau(bx, by, bz + 1) || eau(bx, by, bz - 1) || eau(bx, by + 1, bz)) etat = etat.replace('_concrete_powder', '_concrete');
    }
    if (s.api.remplacable(bx, by, bz)) {
      s.poser(bx, by, bz, etat, F_TOUS);
      if (/anvil/.test(etat)) s.son('block.anvil.land', bx + 0.5, by + 0.5, bz + 0.5, 0.3, 1);
      s.dire(`bloc qui tombe se pose (${bx},${by},${bz}) ${etat.replace(/^minecraft:/, '').replace(/\[.*/, '')}`);
    } else {
      s.dire(`bloc qui tombe perdu en (${bx},${by},${bz}) : cellule occupee, il devient un objet`);
      const nom = etat.replace(/^minecraft:/, '').replace(/\[.*/, '');
      this.objet(nom, 1, e.x, e.y + 0.1, e.z);
    }
    return false;
  }
}
