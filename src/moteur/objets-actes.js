// Verbes d'objets des acteurs simules (docs/SIMULATION.md partie 26) : METHODES de `Acteur` installees apres utilisation.js et inventaire.js.
//   fabrique "objet" [n] [{table: [x,y,z], recette, va, duree, poudre}]   etabli (3 x 3), inventaire (2 x 2), tailleur de pierre, table de forgeron
//   enchante x y z "objet" [emplacement 1|2|3] [{va}]                     table d'enchantement (etageres, lapis, niveaux, graine de l'acteur)
//   forge x y z "objet" ["objet2"] [{nom, va}]                             enclume : renommer, reparer, fusionner (12 % d'usure de l'enclume)
//   utilise (canne a peche) [{ferre, attends}]                            lancer le bouchon ; un second `utilise` ramene ; {ferre: true} ramene a la touche
//   utilise (trident) [{charge}]                                          Impulsion sous la pluie ou dans l'eau : l'acteur s'elance (lance : le trident part)
// L'ecran du poste (etabli, table, enclume, alambic, tailleur, forge) est note dans le replay (`ecrans`) : le montage peut le dessiner.
import { lirePile, textePile, canon, idDe } from './pile.js';
import { recettesPour, analyser, choisir, resultat, resteDe } from './fabrication.js';
import { lancerBouchon, ramener } from './peche.js';
import { composants, idArmure, EMP_ARMURE } from './inventaire.js';

const STATIONS = { etabli: 'crafting_table', tailleur: 'stonecutter', forge: 'smithing_table' };
const RAD = Math.PI / 180;

export function installerObjets(Acteur, EchecActe) {
  const P = Acteur.prototype;

  // ecran ouvert pendant [debut, fin] (lu par le montage) ; contenu : { type, grille, resultat, n, ... }
  P.noterEcran = function (type, pos, contenu, ticks) {
    const sim = this.sim;
    // l'inventaire du joueur, en bas de l'ecran : l'objet tenu d'abord (case 0 de la barre, comme le HUD), puis le reste, en piles de pileMax
    const sac = this.casesSac().map(([k, n]) => (k ? [k, n] : null));
    // armure portee (cases de l'ecran d'inventaire, tete en haut) et main gauche ; un materiau seul ('diamond') devient la piece de l'emplacement
    const armures = EMP_ARMURE.map((e) => { const b = this.armure?.[e]; if (!b) return null; const s = String(b), i = s.indexOf('['); return idDe(idArmure(sim.d, b, e)) + (i >= 0 ? s.slice(i) : ''); });
    (sim.replay.ecrans ??= []).push({ acteur: this.nom, type, pos, debut: sim.temps, fin: sim.temps + ticks, sac, armures, gauche: this.gauche ?? null, niveaux: this.niveauXp ?? 0, graine: this.graineEnchant, ...contenu });
  };
  // cherche un bloc du nom donne a portee (4,5 blocs) autour de l'acteur, ou celui de l'option `table`
  P.posteProche = function (nom, opt) {
    const sim = this.sim;
    if (opt) { const e = sim.monde.etatEn(...opt); if (e < 0 || sim.d.nomBloc(e) !== nom) throw new EchecActe(`pas de ${nom} en ${opt.join(',')}`); return opt; }
    let best = null, bd = Infinity;
    const cx = Math.floor(this.x), cy = Math.floor(this.y), cz = Math.floor(this.z);
    for (let dy = -2; dy <= 3; dy++) for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
      const e = sim.monde.etatEn(cx + dx, cy + dy, cz + dz);
      if (e < 0 || sim.d.nomBloc(e) !== nom) continue;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = [cx + dx, cy + dy, cz + dz]; }
    }
    if (!best) throw new EchecActe(`pas de ${nom} a moins de 5 blocs : ajoute {"table": [x, y, z], "va": true}`);
    return best;
  };

  // ---------------------------------------------------------------- fabrique
  P.debut_fabrique = function (T, a) {
    const sim = this.sim, oj = sim.objetsJeu;
    if (!oj) throw new EchecActe('recettes du jeu absentes (groupe de kit "recettes")');
    const id = idDe(a.objet), voulu = a.n ?? 1;
    const cands = recettesPour(oj, id, a.opts.recette ?? null);
    if (!cands.length) throw new EchecActe(`aucune recette du jeu ne donne ${id}${a.opts.recette ? ` (recette ${a.opts.recette})` : ''}`);
    let choix = null, manque = null;
    for (const { nom, r } of cands) {
      const an = analyser(oj, r, { poudre: a.opts.poudre, cible: id });
      if (!an || !an.ing.length) continue;
      const c = choisir(this, an.ing, this.infini);
      if (!c.manque) { choix = { nom, an }; break; }
      manque ??= `${nom} : manque ${c.manque}`;
    }
    if (!choix) throw new EchecActe(`${id} : ingredients absents du sac (${manque})`);
    T.recette = choix; T.voulu = voulu; T.fait = 0; T.produits = 0;
    const station = STATIONS[choix.an.atelier];
    T.station = station ? this.posteProche(station, a.opts.table) : null;
    T.duree = Math.max(1, Math.round((a.opts.duree ?? 0.75) * 20 * sim.replay.ralenti));   // temps a l'ecran avant le clic sur le resultat (mise en scene ; le jeu : un clic)
    if (T.station) this.preparerAction(T, a, T.station, { visible: true });
    else { T.etat = 'fabrique'; T.k = 0; }
  };
  P.tick_fabrique = function (T) {
    const sim = this.sim;
    if (T.etat === 'approche') { if (this.tickApproche(T)) { T.etat = 'vise'; T.vise = 0; this.entree.avance = 0; } return; }
    if (T.etat === 'vise') {
      const r = this.cibleCellule(T.station);
      if (!this.viseTache(T, r.point)) return;
      const v = this.verifierPortee(T.station, { visible: true });
      if (!v.ok) throw new EchecActe(v.raison);
      this.regardTache = null; this.balancer();
      T.etat = 'fabrique'; T.k = 0;
      return;
    }
    if (T.etat !== 'fabrique') return;
    if (T.k++ === 0) this.ecranFabrique(T);
    if (T.k < T.duree) return;
    // une fabrication (un clic sur le resultat) ; on recommence tant que le nombre voulu n'est pas atteint
    const { an, nom } = T.recette;
    const c = choisir(this, an.ing, this.infini);
    if (c.manque) { this.finirTache(T.produits ? 'ok' : 'echec', `${T.produits} ${an.resultat ?? ''} (manque ${c.manque})`); return; }
    const res = resultat(sim.d, an, c.piles);
    for (const p of c.piles) { this.consommer(p, 1); const rest = resteDe(p); if (rest) this.ajouter(rest, 1); }
    this.ajouter(res.texte, res.n);
    T.produits += res.n; T.fait++;
    this.balancer();
    const son = an.atelier === 'tailleur' ? 'ui.stonecutter.take_result' : an.atelier === 'forge' ? 'block.smithing_table.use' : null;
    if (son) sim.son(son, this.x, this.y + 1, this.z, 1, 1);
    sim.dire(`${this.nom} fabrique ${res.n} ${res.texte} (${nom})`);
    (sim.stats.fabrications ??= []).push(`${(sim.temps / 20).toFixed(2)} ${this.nom} ${res.n} ${idDe(res.texte)}`);
    sim.api.evenement('acteur.fabrique', { acteur: this.nom, objet: res.texte, n: res.n, recette: nom });
    if (T.produits >= T.voulu) { this.finirTache('ok', `${T.produits} ${idDe(res.texte)}`); return; }
    T.k = 1; T.duree = Math.max(4, Math.floor(T.duree / 3));
  };
  P.ecranFabrique = function (T) {
    const { an } = T.recette, c = choisir(this, an.ing, this.infini);
    const grille = new Array(an.atelier === 'inventaire' ? 4 : 9).fill(null);
    an.ing.forEach((x, i) => { const k = an.atelier === 'inventaire' && x.case < 9 ? Math.floor(x.case / 3) * 2 + (x.case % 3) : x.case; if (k < grille.length) grille[k] = c.piles[i] ?? x.ids[0]; });
    const r = resultat(this.sim.d, an, c.piles);
    const ecran = an.atelier === 'etabli' ? 'etabli' : an.atelier === 'inventaire' ? 'inventaire' : an.atelier;
    this.noterEcran(ecran, T.station, { grille, resultat: r.texte, n: r.n }, T.duree);
  };

  // ---------------------------------------------------------------- enchante (EnchantmentMenu)
  P.debut_enchante = function (T, a) {
    const sim = this.sim;
    if (!sim.objetsJeu) throw new EchecActe('enchantements du jeu absents (groupe de kit "recettes")');
    const c = [a.x, a.y, a.z], e = sim.monde.etatEn(...c);
    if (e < 0 || sim.d.nomBloc(e) !== 'enchanting_table') throw new EchecActe(`pas de table d'enchantement en ${c.join(',')}`);
    T.objet = this.infini ? canon(a.objet) : this.pileDe(a.objet);
    if (!T.objet) throw new EchecActe(`${this.nom} n'a pas de ${a.objet} (sac)`);
    if (Object.keys(lirePile(T.objet).ench).length) throw new EchecActe(`${a.objet} est deja enchante (la table refuse un objet enchante)`);
    T.emplacement = (a.emplacement ?? 3) - 1;
    this.preparerAction(T, a, c, { visible: true });
  };
  P.tick_enchante = function (T) {
    const sim = this.sim;
    if (T.etat === 'approche') { if (this.tickApproche(T)) { T.etat = 'vise'; T.vise = 0; this.entree.avance = 0; } return; }
    if (T.etat === 'vise') {
      const r = this.cibleCellule(T.cible);
      if (!this.viseTache(T, r.point)) return;
      const v = this.verifierPortee(T.cible, { visible: true });
      if (!v.ok) throw new EchecActe(v.raison);
      this.regardTache = null; this.balancer();
      T.offre = sim.enchant.table(this, T.cible, idDe(T.objet));
      this.noterEcran('enchantement', T.cible, { objet: T.objet, couts: T.offre.couts, indices: T.offre.listes.map((l) => l[0] ?? null), etageres: T.offre.etageres, choisi: T.emplacement }, 40);
      T.etat = 'choisit'; T.k = 0; return;
    }
    if (T.etat !== 'choisit' || ++T.k < 30) return;
    const k = T.emplacement, cout = T.offre.couts[k], liste = T.offre.listes[k];
    if (!cout || !liste.length) throw new EchecActe(`emplacement ${k + 1} vide (couts ${T.offre.couts.join('/')}, ${T.offre.etageres} etageres)`);
    // EnchantmentMenu.clickMenuButton : niveaux >= cout et >= k + 1, lapis >= k + 1 (sauf creatif) ; on paie k + 1 niveaux et k + 1 lapis
    if (!this.creatif) {
      if ((this.niveauXp ?? 0) < cout) throw new EchecActe(`${this.nom} a ${this.niveauXp ?? 0} niveaux, il en faut ${cout}`);
      if (!this.infini && this.nombre('lapis_lazuli') < k + 1) throw new EchecActe(`il faut ${k + 1} lapis-lazuli`);
      this.consommer('lapis_lazuli', k + 1);
      this.niveauXp -= k + 1; if (this.niveauXp < 0) this.niveauXp = 0;
    }
    const p = lirePile(T.objet), id = p.id === 'book' ? 'enchanted_book' : p.id;
    const res = textePile({ ...p, id, ench: Object.fromEntries(liste) });
    this.consommer(T.objet, 1); this.ajouter(res, 1);
    if (this.main.objet === T.objet && !this.sac.has(T.objet)) this.main = { objet: res, efficacite: 0 };
    this.graineEnchant = sim.hasard.entier();   // Player.onEnchantmentPerformed
    sim.son('block.enchantment_table.use', T.cible[0] + 0.5, T.cible[1] + 0.5, T.cible[2] + 0.5, 1, sim.hasard.flottant() * 0.1 + 0.9);
    sim.dire(`${this.nom} enchante ${p.id} : ${liste.map(([e, n]) => `${e} ${n}`).join(', ')} (${cout} niveaux, ${k + 1} lapis)`);
    (sim.stats.enchantements ??= []).push(`${(sim.temps / 20).toFixed(2)} ${this.nom} ${res}`);
    this.finirTache('ok', res);
  };

  // ---------------------------------------------------------------- forge (AnvilMenu)
  P.debut_forge = function (T, a) {
    const sim = this.sim;
    const c = [a.x, a.y, a.z], e = sim.monde.etatEn(...c);
    if (e < 0 || !/anvil$/.test(sim.d.nomBloc(e))) throw new EchecActe(`pas d'enclume en ${c.join(',')}`);
    T.gauche = this.infini ? canon(a.objet) : this.pileDe(a.objet);
    if (!T.gauche) throw new EchecActe(`${this.nom} n'a pas de ${a.objet}`);
    T.droite = a.objet2 ? (this.infini ? canon(a.objet2) : this.pileDe(a.objet2)) : null;
    if (a.objet2 && !T.droite) throw new EchecActe(`${this.nom} n'a pas de ${a.objet2}`);
    if (T.droite === T.gauche && this.nombre(T.gauche) < 2 && !this.infini) throw new EchecActe(`il faut deux ${a.objet}`);
    this.preparerAction(T, a, c, { visible: true });
  };
  P.tick_forge = function (T) {
    const sim = this.sim;
    if (T.etat === 'approche') { if (this.tickApproche(T)) { T.etat = 'vise'; T.vise = 0; this.entree.avance = 0; } return; }
    if (T.etat === 'vise') {
      const r = this.cibleCellule(T.cible);
      if (!this.viseTache(T, r.point)) return;
      const v = this.verifierPortee(T.cible, { visible: true });
      if (!v.ok) throw new EchecActe(v.raison);
      this.regardTache = null; this.balancer();
      T.res = sim.enchant.enclume(T.gauche, T.droite, { nom: T.acte.opts.nom ?? null, creatif: this.creatif });
      if (T.res.erreur) throw new EchecActe(`enclume : ${T.res.erreur}`);
      this.noterEcran('enclume', T.cible, { gauche: T.gauche, droite: T.droite, resultat: T.res.resultat, cout: T.res.cout, nom: T.res.nom }, 30);
      T.etat = 'forge'; T.k = 0; return;
    }
    if (T.etat !== 'forge' || ++T.k < 24) return;
    const R = T.res;
    if (!this.creatif && (this.niveauXp ?? 0) < R.cout) throw new EchecActe(`${this.nom} a ${this.niveauXp ?? 0} niveaux, il en faut ${R.cout}`);
    if (!this.creatif) this.niveauXp -= R.cout;
    this.consommer(T.gauche, 1);
    if (T.droite) this.consommer(T.droite, R.materiaux > 0 ? R.materiaux : 1);
    this.ajouter(R.resultat, 1);
    if (this.main.objet === T.gauche && !this.sac.has(T.gauche)) this.main = { objet: R.resultat, efficacite: 0 };
    // AnvilMenu.onTake : 12 % de chances que l'enclume s'abime (chipped, damaged, puis detruite : son block.anvil.destroy) ; sinon block.anvil.use
    const c = T.cible, e = sim.monde.etatEn(...c), nom = sim.d.nomBloc(e);
    if (!this.creatif && sim.hasard.flottant() < 0.12) {
      const suite = { anvil: 'chipped_anvil', chipped_anvil: 'damaged_anvil' }[nom];
      if (suite) { sim.poser(c[0], c[1], c[2], sim.d.chaine(e).replace(nom, suite), 2); sim.son('block.anvil.use', c[0] + 0.5, c[1] + 0.5, c[2] + 0.5, 1, sim.hasard.flottant() * 0.1 + 0.9); }
      else { sim.poser(c[0], c[1], c[2], 'minecraft:air', 3); sim.son('block.anvil.destroy', c[0] + 0.5, c[1] + 0.5, c[2] + 0.5, 1, sim.hasard.flottant() * 0.1 + 0.9); }
    } else sim.son('block.anvil.use', c[0] + 0.5, c[1] + 0.5, c[2] + 0.5, 1, sim.hasard.flottant() * 0.1 + 0.9);
    sim.dire(`${this.nom} forge ${R.resultat}${R.nom ? ` nomme "${R.nom}"` : ''} (${R.cout} niveaux)`);
    (sim.stats.forges ??= []).push(`${(sim.temps / 20).toFixed(2)} ${this.nom} ${R.resultat}`);
    this.finirTache('ok', R.resultat);
  };

  // ---------------------------------------------------------------- peche : utilise (canne en main)
  P.debutPeche = function (T, a) {
    const sim = this.sim;
    if (this.bouchon) { const u = ramener(sim, this); this.ramenerSon(); this.balancer(); this.userPile('main', u); T.mode = 'peche'; T.finiPeche = 'ramene'; return; }
    lancerBouchon(sim, this);
    this.balancer();
    T.mode = 'peche'; T.ferre = !!a.opts.ferre; T.ramener = false;
    T.finAttente = a.opts.attends ? sim.temps + Math.round(a.opts.attends * 20 * sim.replay.ralenti) : null;
    if (!T.ferre && !T.finAttente) T.finiPeche = 'lance';
  };
  P.ramenerSon = function () { const h = this.sim.hasard; this.sim.son('entity.fishing_bobber.retrieve', this.x, this.y, this.z, 1, 0.4 / (h.flottant() * 0.4 + 0.8)); };
  P.tickPeche = function (T) {
    if (T.finiPeche) { this.finirTache('ok', T.finiPeche); return; }
    const sim = this.sim;
    if (!this.bouchon) { this.finirTache('echec', 'le bouchon est perdu'); return; }
    if (T.ramener || (T.finAttente !== null && sim.temps >= T.finAttente)) {
      const u = ramener(sim, this); this.ramenerSon(); this.balancer(); this.userPile('main', u);
      this.finirTache('ok', u === 1 ? 'prise' : u === 5 ? 'creature tiree' : 'rien');
    }
  };

  // ---------------------------------------------------------------- trident : Impulsion (TridentItem.releaseUsing)
  P.impulsionTrident = function () {
    const sim = this.sim, t = this.main.objet, n = lirePile(t).ench.riptide ?? 0;
    if (!n) return false;
    const mouille = this.dansEau || (sim.meteo?.pleut(sim.temps) && (sim.api.lumiere?.(Math.floor(this.x), Math.floor(this.y + 1.8), Math.floor(this.z))?.ciel ?? 15) >= 15);
    if (!mouille) { sim.dire(`${this.nom} : Impulsion sans eau ni pluie, rien`); return 'sec'; }
    this.userPile('main', 1);
    const f = sim.objetsJeu ? sim.enchant.valeurPile(t, 'trident_spin_attack_strength', { outil: 'trident' }, 0) : 1.5 + 0.75 * (n - 1);
    const lac = this.lacetTete * RAD, tan = this.tangage * RAD;
    const d = [-Math.sin(lac) * Math.cos(tan), -Math.sin(tan), Math.cos(lac) * Math.cos(tan)];
    this.vx += d[0] * f; this.vy += d[1] * f; this.vz += d[2] * f;
    this.vrille = 20; this.vrilleDegats = 8; this.vrilleTouches = new Set();   // Player.startAutoSpinAttack(20, 8)
    if (this.auSol) { this.y += 1.1999999; this.auSol = false; }
    sim.son(`item.trident.riptide_${Math.min(3, n)}`, this.x, this.y, this.z, 1, 1);
    sim.dire(`${this.nom} : Impulsion ${n} (force ${f.toFixed(2)})`);
    (sim.stats.impulsions ??= []).push(`${(sim.temps / 20).toFixed(2)} ${this.nom}`);
    return true;
  };
  // LivingEntity.checkAutoSpinAttack : pendant 20 ticks, la premiere creature touchee prend 8 (+ enchantements du trident), l'acteur rebondit (x -0,2)
  P.tickVrille = function () {
    if (!(this.vrille > 0)) return;
    this.vrille--;
    const sim = this.sim, b = this.boite();
    for (const o of this.g.liste) {
      if (o === this || o.mort >= 0 || this.vrilleTouches.has(o)) continue;
      const k = o.boite();
      if (k[3] < b[0] || k[0] > b[3] || k[4] < b[1] || k[1] > b[4] || k[5] < b[2] || k[2] > b[5]) continue;
      this.vrilleTouches.add(o);
      let q = this.vrilleDegats;
      if (sim.objetsJeu && this.main.objet) q = sim.enchant.valeurPile(this.main.objet, 'damage', { type: 'player_attack', direct: true, ceci: o, attaquant: this, directAttaquant: this, outil: 'trident' }, q);
      o.attaquantCourant = this; o.frappe(q, 'joueur:' + this.nom, this.x - o.x, this.z - o.z, Math.fround(0.4), { recul: 'vrille' }); o.attaquantCourant = null;
      this.vx *= -0.2; this.vy *= -0.2; this.vz *= -0.2; this.vrille = 0;
      sim.dire(`${this.nom} touche ${o.nom} en vrille (${q})`);
      break;
    }
  };
  // ---------------------------------------------------------------- alambic : prend / depose (fentes : bouteille, ingredient, carburant)
  const debutPrend = P.debut_prend, debutDepose = P.debut_depose, transfererBase = P.transferer;
  const alambicEn = (sim, a) => a.x !== undefined && sim.alambics.estAlambic(a.x, a.y, a.z);
  const debutAlambic = function (T, a, sens) {
    T.sens = sens; T.objet = a.objet; T.n = a.n; T.alambic = true;
    if (sens === 'depose' && !T.objet) { T.objet = this.main.objet; if (!T.objet) throw new EchecActe('depose : quel objet ? [t, "depose", x, y, z, "nether_wart", 1]'); }
    this.preparerAction(T, a, [a.x, a.y, a.z], { visible: true });
  };
  P.debut_prend = function (T, a) { return alambicEn(this.sim, a) ? debutAlambic.call(this, T, a, 'prend') : debutPrend.call(this, T, a); };
  P.debut_depose = function (T, a) { return alambicEn(this.sim, a) ? debutAlambic.call(this, T, a, 'depose') : debutDepose.call(this, T, a); };
  P.transferer = function (T) {
    if (!T.alambic) return transfererBase.call(this, T);
    const sim = this.sim, c = T.cible;
    if (T.sens === 'prend') {
      const l = sim.alambics.prendre(c, T.objet ?? null, T.n ?? Infinity);
      for (const [t, n] of l) this.ajouter(t, n);
      T.resume = l.map(([t, n]) => `${n} ${t}`).join(', ') || 'rien';
      sim.dire(`${this.nom} prend ${T.resume} dans l'alambic ${c.join(',')}`);
      this.noterEcran('alambic', c, { contenu: sim.alambics.contenu(c) }, 20);
      if (!l.length && T.acte.opts.strict) throw new EchecActe('alambic vide');
      return;
    }
    const t = this.infini ? canon(T.objet) : this.pileDe(T.objet), n = T.n ?? 1;
    if (!t || (!this.infini && this.nombre(t) < n)) throw new EchecActe(`${this.nom} n'a pas ${n} ${T.objet} (sac)`);
    const reste = sim.alambics.deposer(c, t, n, T.acte.opts.fente);
    if (reste === n) throw new EchecActe(`${idDe(t)} ne va pas dans l'alambic (fente : {"fente": "bouteille"|"ingredient"|"carburant"})`);
    this.consommer(t, n - reste);
    T.resume = `${n - reste} ${t}`;
    this.noterEcran('alambic', c, { contenu: sim.alambics.contenu(c) }, 20);
  };
  void composants;
}
