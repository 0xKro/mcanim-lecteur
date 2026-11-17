// Entites non vivantes du monde (phase 5, apres les acteurs) : TNT amorce et blocs qui tombent. Chaque tick de chaque entite est ecrit dans le replay
// (colonne `entites`) ; le rendu les dessine. Port de Horizon client/game/{tnt,falling_blocks}.rs et world/block_landing.rs : MIT, voir ATTRIBUTIONS.md.
//   TNT amorce : meche 80 ticks, gravite 0,04, trainee 0,98, sol x (0,7 ; -0,5 ; 0,7), saut de depart (0,2 vers le haut), explose a la fin de la meche.
//   Bloc qui tombe : gravite 0,04 puis 0,98, se repose dans la cellule ou il s'arrete si elle est remplacable.
//   Objet au sol (ItemEntity) : boite 0,25, gravite 0,04, trainee 0,98, friction du sol x 0,98, rebond -0,5, delai de ramassage 10 ticks, fusion des
//   piles identiques, 6000 ticks de vie, courant de l'eau ; ramasse par un acteur (`ramasse: true`) dont la boite elargie de (1 ; 0,5 ; 1) le touche,
//   avec l'animation de ramassage du jeu (3 ticks vers l'acteur) et le son entity.item.pickup.
import { deplacerBoite } from './collision.js';
import { exploser } from './explosion.js';
import { butinDe } from './butin.js';
import { evenement } from './registre.js';

const F_TOUS = 3;
const LARGEUR = 0.98;
const COTE_OBJET = 0.25;

export class Entites {
  constructor(sim) {
    this.sim = sim; this.liste = []; this.prochain = 0;
    this.lec = { d: sim.d, etatEn: (x, y, z) => sim.monde.etatEn(x, y, z), dyn: (e, x, y, z) => sim.formeDyn(e, x, y, z) };
  }
  get actives() { return this.liste.length; }

  // TNT amorce en (x, y, z) (coordonnees du bloc) ; meche : ticks (defaut : regle tnt.meche)
  tnt(x, y, z, meche) {
    const s = this.sim, a = s.hasard.reel() * 2 * Math.PI;
    const e = { id: this.prochain++, type: 'tnt', x: x + 0.5, y, z: z + 0.5, vx: -Math.sin(a) * 0.02, vy: 0.2, vz: -Math.cos(a) * 0.02, meche: meche ?? s.regles.valeur('tnt.meche', 80), debut: s.temps };
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
    const nom = d.nomBloc(e), liste = butinDe(d, nom, d.props(e), { hasard: s.hasard, explosion: opt.explosion ?? null });
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
    const r = deplacerBoite(this.lec, b, [e.vx, e.vy, e.vz], false, 0);
    e.x += r.dx; e.y += r.dy; e.z += r.dz;
    if (r.bloqueX) e.vx = 0;
    if (r.bloqueZ) e.vz = 0;
    if (r.bloqueY) e.vy = 0;
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
      if (o === e || o.type !== 'objet' || o.pris || o.item !== e.item || this._fini.has(o) || this._fini.has(e)) continue;
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
      if (e.type !== 'objet' || e.pris || e.delai > 0 || this._fini?.has(e)) continue;
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
      if (e.debut === s.temps) { this.ecrire(e); continue; }    // creee ce tick : elle ne bouge qu'au suivant (meche exacte)
      const vivante = e.type === 'tnt' ? this.tickTnt(e) : e.type === 'objet' ? this.tickObjet(e) : this.tickChute(e);
      if (vivante) this.ecrire(e);
    }
    this.liste = this.liste.filter((e) => !fini.has(e));    // les entites creees pendant ce tick (chaine) restent
  }

  ecrire(e) { this.sim.replay.entite(this.sim.temps, e.id, e.type, e.x, e.y, e.z, e.type === 'tnt' ? e.meche : e.type === 'objet' ? e.n : 0, e.type === 'chute' ? e.pal : e.type === 'objet' ? this.sim.replay.nom(e.item) : -1); }

  bouger(e, g) {
    const s = this.sim;
    e.vy -= g;
    const b = [e.x - LARGEUR / 2, e.y, e.z - LARGEUR / 2, e.x + LARGEUR / 2, e.y + LARGEUR, e.z + LARGEUR / 2];
    const r = deplacerBoite(this.lec, b, [e.vx, e.vy, e.vz], false, 0);
    e.x += r.dx; e.y += r.dy; e.z += r.dz;
    if (r.bloqueX) e.vx = 0;
    if (r.bloqueZ) e.vz = 0;
    if (r.bloqueY) e.vy = 0;
    e.vx *= 0.98; e.vy *= 0.98; e.vz *= 0.98;
    void s;
    return r.auSol;
  }

  tickTnt(e) {
    const s = this.sim;
    const sol = this.bouger(e, s.regles.valeur('tnt.gravite', 0.04));
    if (sol) { e.vx *= 0.7; e.vy *= -0.5; e.vz *= 0.7; }
    e.meche--;
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
