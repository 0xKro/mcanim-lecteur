// Simulation : le tick a 20 par seconde, dans l'ordre de ServerLevel.tick du jeu (Horizon client/game.rs `tick_world`, `block_ticks.rs`,
// world/level/update.rs : MIT, voir ATTRIBUTIONS.md). Elle tourne AVANT le rendu pour toute la duree de la scene et produit un replay.
//
// Phases d'un tick (docs/SIMULATION.md 1.2) ; "stub" = prevu, rien a faire encore :
//   0  commandes datees de la scene (monde.blocs), evenement `debutTick`
//   1  entites qui touchent des blocs (stub)
//   2  ticks planifies de blocs (65 536 au plus), un par un ; les effets de bord sont traites entre deux ticks
//   3  ticks aleatoires dans la region active
//   4  evenements de blocs (pistons...) et du niveau (stub)
//   5  entites (stub)    6  pistons en mouvement, block entities (stub)
//   7  lumiere : tenue a jour a chaque ecriture, rien a faire ici
//   8  evenement `finTick`, ecriture du replay
import { Monde, FACE_DX, FACE_DY, FACE_DZ, FACE_OPPOSEE, ORDRE_VOISINS, ORDRE_FORMES } from './monde.js';
import { Lumiere } from './lumiere.js';
import { FileTicks, MAX_PAR_TICK } from './ticks.js';
import { Aleatoire, TirageBlocs } from './aleatoire.js';
import { Replay } from './replay.js';
import { Regles } from './regles.js';
import { Registre, evenement } from './registre.js';
import { ErreurMonde } from './erreurs.js';
import { NOMS_FACES } from './util.js';
import { D } from './donnees.js';
import { Entites } from './entites.js';
import { exploser } from './explosion.js';
import { bonOutil } from './cassage.js';

// Drapeaux de set_block (Block.UPDATE_*)
export const F = { VOISINS: 1, CLIENTS: 2, INVISIBLE: 4, IMMEDIAT: 8, FORME_CONNUE: 16, SANS_BUTIN: 32, PISTON: 64, SANS_FORME_FIL: 128, SANS_EFFETS_ENTITE: 256, SANS_POSE: 512, TOUS: 3, AUCUN: 260 };
export const LIMITE_FORMES = 512;                // Block.UPDATE_LIMIT : profondeur des mises a jour de forme
export const MOTEUR = 1;
const FLUIDE_VIDE = Object.freeze({ type: null, quantite: 0, source: false, tombant: false });
const PLEIN = [[0, 0, 0, 1, 1, 1]];                // cellule inconnue (cachee) : pleine

export class Simulation {
  // zone : rendu/zone.js ; donnees : moteur/donnees.js ;
  // config : { graine, duree, ralenti, blocs: [[t, x, y, z, 'bloc'], ...], regles, lumiere }
  constructor({ zone, donnees, config = {}, monde }) {
    this.zone = zone; this.d = donnees; this.config = config;
    this.monde = monde || new Monde({ zone, donnees });
    this.regles = new Regles(); this.reg = new Registre(donnees, this.regles);
    this.hasard = new Aleatoire(config.graine ?? 1);
    this.tirage = new TirageBlocs(this.hasard.entier());
    this.file = new FileTicks();
    this.temps = 0;                               // numero du tick en cours
    this.replay = new Replay({ graine: config.graine ?? 1, ralenti: config.ralenti ?? 1, moteur: MOTEUR });
    this.u = { pile: [], ajoutes: [], count: 0 };  // mises a jour de voisins en vol (CollectingNeighborUpdater)
    this.stats = { voisins: 0, ticks: 0, aleatoires: 0, poses: 0, plafondVoisins: 0, evenements: 0 };
    this.avertissements = [];
    this.posesCeTick = 0;
    this.region = [];                             // centres des regions actives (positions de la scene)
    this.api = this._creerApi();
    this.budgetPoses = 20000;
    this.mods = null;                             // hote des mods (mods.js), s'il y en a
    this.acteurs = null;                          // acteurs simules (acteurs.js) : intentions, marche, interactions
    this.conteneurs = new Map();                  // coffres et tonneaux ouverts : 'x,y,z' -> Set des noms des visiteurs
    this.entites = new Entites(this);             // TNT amorce, blocs qui tombent, objets au sol (entites.js)
    this.fileFluides = new FileTicks();           // ticks planifies des fluides (file a part, comme le jeu) : type = famille (1 eau, 2 lave)
    this.nbFluides = 0;                           // ticks de fluide executes (pour le resume)
  }

  avertir(t) { if (this.avertissements.length < 20 && !this.avertissements.includes(t)) this.avertissements.push(t); }

  // ------------------------------------------------------------ lumiere (a la demande)
  lumiere() {
    if (!this.monde.lumiere) this.monde.lumiere = new Lumiere(this.monde);
    return this.monde.lumiere;
  }

  // ------------------------------------------------------------ lecture
  indice(x, y, z) { return this.monde.indiceEn(x, y, z); }
  etat(x, y, z) { return this.monde.etatEn(x, y, z); }                 // numero d'etat du jeu, -1 si cellule cachee inconnue
  blocIdx(x, y, z) { const e = this.monde.etatEn(x, y, z); return e < 0 ? -1 : this.d.blocDe(e); }
  decrire(x, y, z) {
    const e = this.monde.etatEn(x, y, z);
    if (e < 0) return { nom: 'minecraft:#hidden', chaine: '#hidden', etat: {}, id: -1, indice: 1 };
    return { nom: 'minecraft:' + this.d.nomBloc(e), chaine: this.d.chaine(e), etat: this.d.props(e), id: e, indice: this.monde.indiceEn(x, y, z), instrument: this.d.instrument(e) };
  }
  _indiceDe(bloc) {
    if (typeof bloc === 'number') return this.monde.indicePaletteEtat(bloc);
    return this.monde.indicePalette(String(bloc));
  }

  // ------------------------------------------------------------ ecriture : Level.setBlock
  // bloc : texte d'etat ('minecraft:oak_door[open=true]'), numero d'etat. Rend vrai si quelque chose a change.
  poser(x, y, z, bloc, drapeaux = F.TOUS) {
    return this._poserIndice(x, y, z, this._indiceDe(bloc), drapeaux, LIMITE_FORMES);
  }
  _poserIndice(x, y, z, nouveau, drapeaux, limite) {
    const m = this.monde;
    if (y < -64 || y >= 320) return false;
    if (this.posesCeTick++ > this.budgetPoses) throw new ErreurMonde(`plus de ${this.budgetPoses} poses de blocs dans le meme tick (tick ${this.temps}) : boucle dans un mod ?`);
    const ancien = m.ecrire(x, y, z, nouveau);
    if (ancien < 0) return false;
    this.stats.poses++;
    const eAnc = m.tEtat[ancien], eNou = m.tEtat[nouveau];
    const blocAnc = eAnc < 0 ? -1 : this.d.blocDe(eAnc), blocNou = eNou < 0 ? -1 : this.d.blocDe(eNou);
    m.devoiler(x, y, z);
    const change = blocAnc !== blocNou;
    // "affect_neighbors_after_removal" : l'ancien bloc apprend qu'il a ete retire
    if (change && blocAnc >= 0 && this.reg.a('retire', blocAnc)) this.reg.lancerBloc('retire', blocAnc, evenement({ pos: [x, y, z], etat: this.d.chaine(eAnc), bloc: this.d.nomBloc(eAnc), nouveau: eNou >= 0 ? this.d.chaine(eNou) : '#hidden' }), this.api);
    if (m.indiceEn(x, y, z) !== nouveau) return true;                   // un gestionnaire a deja remplace le bloc
    if (!(drapeaux & F.SANS_POSE) && blocNou >= 0 && this.reg.a('pose', blocNou)) {
      this.reg.lancerBloc('pose', blocNou, evenement({ pos: [x, y, z], etat: this.d.chaine(eNou), bloc: this.d.nomBloc(eNou), ancien: eAnc >= 0 ? this.d.chaine(eAnc) : '#hidden' }), this.api);
    }
    if (m.indiceEn(x, y, z) === nouveau) {
      if (drapeaux & F.VOISINS) this._majVoisins(x, y, z, blocAnc);
      if (!(drapeaux & F.FORME_CONNUE) && limite > 0) {
        const f = drapeaux & ~(F.VOISINS | F.SANS_BUTIN);
        this._majFormesVoisines(x, y, z, f, limite - 1);
      }
    }
    return true;
  }

  // Level.destroyBlock : le bloc devient de l'air (ou de l'eau s'il etait "waterlogged"), avec son bruit de casse
  // opt.outil : objet tenu (le bon outil decide du butin des blocs qui exigent un outil) ; opt.acteur : nom de celui qui casse
  casser(x, y, z, { butin = true, outil = null, acteur = null, outilOk } = {}) {
    this._butinCtx = { outil, acteur, outilOk };
    try { return this._casserLimite(x, y, z, butin ? 0 : F.SANS_BUTIN, LIMITE_FORMES); } finally { this._butinCtx = null; }
  }
  _casserLimite(x, y, z, drapeaux, limite) {
    const e = this.monde.etatEn(x, y, z);
    if (e < 0 || this.d.nomBloc(e) === 'air') return false;
    // Block.dropResources : les objets du bloc, avant qu'il soit retire (pas de butin si le drapeau SANS_BUTIN est la)
    if (!(drapeaux & F.SANS_BUTIN) && this.regles.valeur('butin.actif', true)) {
      const c = this._butinCtx || {};
      const ok = c.outilOk !== undefined ? c.outilOk : (c.acteur ? bonOutil(this.d, e, c.outil) : true);
      this.entites.lacher(x, y, z, e, { outilOk: ok, acteur: c.acteur ?? null, source: 'casse' });
    }
    const s = this.d.son(e);
    this.son(s.casse, x + 0.5, y + 0.5, z + 0.5, (s.volume + 1) / 2, s.hauteur * 0.8);
    // particules de casse (ParticleEngine.destroy) : une par sous-cellule de 0,25 de chaque boite de collision (4 x 4 x 4 = 64 pour un cube) ; nom `block_break|<etat>` : le rendu y lit la texture
    let n = 0;
    for (const b of this.d.boites(e).length ? this.d.boites(e) : [[0, 0, 0, 1, 1, 1]]) n += Math.max(2, Math.ceil(Math.min(1, b[3] - b[0]) / 0.25)) * Math.max(2, Math.ceil(Math.min(1, b[4] - b[1]) / 0.25)) * Math.max(2, Math.ceil(Math.min(1, b[5] - b[2]) / 0.25));
    this.replay.particule(this.temps, 'block_break|' + this.d.chaine(e), x + 0.5, y + 0.5, z + 0.5, 0, 0, 0, n);
    const eau = this.d.prop(e, 'waterlogged') === 'true';
    return this._poserIndice(x, y, z, this.monde.indicePalette(eau ? 'minecraft:water[level=0]' : 'minecraft:air'), F.TOUS | (drapeaux & F.SANS_BUTIN), limite);
  }

  // ------------------------------------------------------------ voisins et formes (CollectingNeighborUpdater)
  _majVoisins(x, y, z, blocSource) { this._ajouter({ k: 'multi', x, y, z, bloc: blocSource, i: 0 }); }

  _majFormesVoisines(x, y, z, drapeaux, limite) {
    // BlockStateBase.updateNeighbourShapes : chaque voisin recoit la mise a jour de forme du cote de la cellule
    const etat = this.monde.etatEn(x, y, z);
    for (const f of ORDRE_FORMES) {
      this._ajouter({ k: 'forme', x: x + FACE_DX[f], y: y + FACE_DY[f], z: z + FACE_DZ[f], direction: FACE_OPPOSEE[f], nx: x, ny: y, nz: z, etatVoisin: etat, drapeaux, limite });
    }
  }

  _ajouter(maj) {
    const u = this.u;
    const enCours = u.count > 0;
    const trop = u.count >= this.regles.valeur('monde.plafondVoisins', 200000);
    u.count++;
    if (!trop) { if (enCours) u.ajoutes.push(maj); else u.pile.push(maj); } else if (!this.plafond) {
      this.plafond = true; this.stats.plafondVoisins++;
      this.avertir(`t=${(this.temps / 20 / this.replay.ralenti).toFixed(2)} s : plafond de mises a jour de voisins atteint (${this.regles.valeur('monde.plafondVoisins', 200000)}) ; la chaine est coupee (regle monde.plafondVoisins)`);
    }
    if (!enCours) this._lancerMaj();
  }
  _lancerMaj() {
    const u = this.u;
    try {
      for (;;) {
        if (!u.pile.length && !u.ajoutes.length) break;
        while (u.ajoutes.length) u.pile.push(u.ajoutes.pop());
        while (u.pile.length) {
          const haut = u.pile[u.pile.length - 1];
          const plus = this._executerMaj(haut);
          if (!plus) { u.pile.pop(); break; }
          if (u.ajoutes.length) break;
        }
      }
    } finally { u.pile.length = 0; u.ajoutes.length = 0; u.count = 0; this.plafond = false; }
  }
  // execute l'etape suivante d'une mise a jour ; rend vrai s'il en reste
  _executerMaj(m) {
    this.stats.voisins++;
    if (m.k === 'multi') {
      const f = ORDRE_VOISINS[m.i++];
      const nx = m.x + FACE_DX[f], ny = m.y + FACE_DY[f], nz = m.z + FACE_DZ[f];
      this._voisinChange(nx, ny, nz, m.bloc, m.x, m.y, m.z);
      return m.i < 6;
    }
    // mise a jour de forme : le bloc en (x,y,z) apprend qu'un voisin (nx,ny,nz) a change
    const courant = this.monde.indiceEn(m.x, m.y, m.z);
    const nouveau = this._forme(m.x, m.y, m.z, m.direction, m.nx, m.ny, m.nz, m.etatVoisin);
    if (nouveau !== undefined && nouveau !== courant) this._majOuDetruire(m.x, m.y, m.z, courant, nouveau, m.drapeaux, m.limite);
    return false;
  }
  // BlockBehaviour.neighborChanged
  _voisinChange(x, y, z, blocSource, sx, sy, sz) {
    const e = this.monde.etatEn(x, y, z);
    if (e < 0) return;
    const b = this.d.blocDe(e);
    if (!this.reg.a('voisin', b)) return;
    this.reg.lancerBloc('voisin', b, evenement({ pos: [x, y, z], etat: this.d.chaine(e), bloc: this.d.nomBloc(e), de: [sx, sy, sz], blocSource: blocSource >= 0 ? this.d.noms[blocSource] : '#hidden' }), this.api);
  }
  // BlockBehaviour.updateShape : indice de palette du nouvel etat, ou undefined (inchange)
  _forme(x, y, z, direction, nx, ny, nz, etatVoisin) {
    const e = this.monde.etatEn(x, y, z);
    if (e < 0) return undefined;
    const b = this.d.blocDe(e);
    if (!this.reg.a('forme', b)) return undefined;
    const r = this.reg.lancerBloc('forme', b, evenement({ pos: [x, y, z], etat: this.d.chaine(e), bloc: this.d.nomBloc(e), direction: NOMS_FACES[direction], voisinPos: [nx, ny, nz], voisin: etatVoisin >= 0 ? this.d.chaine(etatVoisin) : '#hidden' }), this.api);
    if (r === undefined || r === null) return undefined;
    return this._indiceDe(r);
  }
  // Block.updateOrDestroy
  _majOuDetruire(x, y, z, ancien, nouveau, drapeaux, limite) {
    const eN = this.monde.tEtat[nouveau];
    if (eN >= 0 && this.d.nomBloc(eN) === 'air') this._casserLimite(x, y, z, drapeaux, limite);
    else this._poserIndice(x, y, z, nouveau, drapeaux & ~F.SANS_BUTIN, limite);
  }

  // ------------------------------------------------------------ ticks planifies
  planifier(x, y, z, delai = 0, priorite = 0) {
    const b = this.blocIdx(x, y, z);
    if (b < 0) return false;
    return this.file.planifier(this.temps, b, x, y, z, delai, priorite);
  }
  planifierBloc(x, y, z, bloc, delai = 0, priorite = 0) { return this.file.planifier(this.temps, bloc, x, y, z, delai, priorite); }

  // FluidState de la cellule : { type: 'water' | 'lava' | null, quantite (0 a 8), source, tombant }. Eau enchainee (waterlogged), herbes marines et varech : eau source.
  fluide(x, y, z) {
    const e = this.monde.etatEn(x, y, z);
    if (e < 0) return FLUIDE_VIDE;
    const f = this.d.fluide(e);
    if (!f) return FLUIDE_VIDE;
    const q = this.d.niveauFluideE[e], source = f === 2 || f === 4;
    let tombant = false;
    if (!source) { const l = this.d.prop(e, 'level'); tombant = l !== undefined && Number(l) >= 8; }
    return { type: f <= 2 ? 'water' : 'lava', quantite: q, source, tombant };
  }
  // tick de fluide : le fluide present dans la cellule doit etre de la famille voulue a l'echeance
  planifierFluide(x, y, z, delai = 0, priorite = 0) {
    const f = this.fluide(x, y, z);
    if (!f.type) return false;
    return this.fileFluides.planifier(this.temps, f.type === 'water' ? 1 : 2, x, y, z, delai, priorite);
  }

  // survie d'un bloc (BlockState.canSurvive) : vrai s'il n'y a pas de gestionnaire `survit`
  survit(x, y, z) {
    const e = this.monde.etatEn(x, y, z);
    if (e < 0) return true;
    const b = this.d.blocDe(e);
    if (!this.reg.a('survit', b)) return true;
    const r = this.reg.lancerBloc('survit', b, evenement({ pos: [x, y, z], etat: this.d.chaine(e), bloc: this.d.nomBloc(e) }), this.api);
    return r === undefined ? true : !!r;
  }

  // canSurvive d'un etat HYPOTHETIQUE en (x,y,z) (pose d'un bloc : on teste avant d'ecrire)
  survitEtat(x, y, z, etat) {
    const id = this.d.etatId(String(etat));
    if (id < 0) return false;
    const b = this.d.blocDe(id);
    if (!this.reg.a('survit', b)) return true;
    const r = this.reg.lancerBloc('survit', b, evenement({ pos: [x, y, z], etat: this.d.chaine(id), bloc: this.d.nomBloc(id) }), this.api);
    return r === undefined ? true : !!r;
  }

  // ------------------------------------------------------------ sons, particules, textes
  son(nom, x, y, z, volume = 1, hauteur = 1) { this.replay.son(this.temps, String(nom).replace(/^minecraft:/, ''), x, y, z, volume, hauteur); this.stats.evenements++; }
  particule(nom, x, y, z, vx = 0, vy = 0, vz = 0, nombre = 1) { this.replay.particule(this.temps, String(nom).replace(/^minecraft:/, ''), x, y, z, vx, vy, vz, nombre); this.stats.evenements++; }
  dire(texte) { this.replay.texte(this.temps, texte); }

  // ------------------------------------------------------------ entites et interactions
  // Entites dont la boite touche filtre.boite [x1,y1,z1,x2,y2,z2] (toutes sans boite) : { id, type, nom, x, y, z, boite }
  entitesDans(filtre = {}) {
    if (!this.acteurs) return [];
    const b = filtre.boite;
    return this.acteurs.liste.filter((a) => {
      if (filtre.type && filtre.type !== 'joueur') return false;
      if (!b) return true;
      const k = a.boite();
      return k[3] > b[0] && k[0] < b[3] && k[4] > b[1] && k[1] < b[4] && k[5] > b[2] && k[2] < b[5];
    }).map((a) => ({ id: a.id, type: 'joueur', nom: a.nom, x: a.x, y: a.y, z: a.z, boite: a.boite() }));
  }
  // Clic droit sur un bloc (Block.use) : lance l'evenement utilise ; rend 'fait', 'passe' ou undefined (rien n'ecoute).
  // opt : { acteur (nom), face ('north'...), hit [fx,fy,fz], accroupi, objet, lacet }
  utiliserBloc(x, y, z, opt = {}) {
    const e = this.monde.etatEn(x, y, z);
    if (e < 0) return undefined;
    const b = this.d.blocDe(e);
    if (!this.reg.a('utilise', b)) return undefined;
    const ev = evenement({ pos: [x, y, z], etat: this.d.chaine(e), bloc: this.d.nomBloc(e), face: opt.face || 'up', hit: opt.hit || [0.5, 0.5, 0.5], acteur: opt.acteur || null, accroupi: !!opt.accroupi, objet: opt.objet || null, lacet: opt.lacet ?? 0 });
    const r = this.reg.lancerBloc('utilise', b, ev, this.api);
    this.dernierUtilise = ev;
    return r;
  }
  // Courant du fluide d'une cellule (FlowingFluid.getFlow) : vecteur [x, y, z] normalise, nul sur de l'eau calme. Sert a la poussee des entites et au rendu.
  courant(x, y, z) {
    const f = this.fluide(x, y, z);
    if (!f.type) return [0, 0, 0];
    const mien = f.quantite / 9, DIR = [[0, -1, 'north'], [0, 1, 'south'], [-1, 0, 'west'], [1, 0, 'east']], FACE = { north: 2, south: 3, west: 4, east: 5 };
    const affecte = (g) => !g.type || g.type === f.type;
    const haut = (g) => (g.type ? g.quantite / 9 : 0);
    const bloque = (a, b, c) => this.api.boites(a, b, c).length > 0;
    let vx = 0, vz = 0;
    for (const [dx, dz] of DIR) {
      const g = this.fluide(x + dx, y, z + dz);
      if (!affecte(g)) continue;
      let h = haut(g), f1 = 0;
      if (h === 0) {
        if (!bloque(x + dx, y, z + dz)) { const gb = this.fluide(x + dx, y - 1, z + dz); if (affecte(gb)) { h = haut(gb); if (h > 0) f1 = mien - (h - 0.8888889); } }
      } else f1 = mien - h;
      if (f1 !== 0) { vx += dx * f1; vz += dz * f1; }
    }
    let v = [vx, 0, vz];
    const norme = (a) => { const l = Math.hypot(...a); return l > 0 ? a.map((q) => q / l) : [0, 0, 0]; };
    if (f.tombant) {
      const pleine = (a, b, c, face) => { const g = this.fluide(a, b, c); if (g.type === f.type) return false; const e = this.monde.etatEn(a, b, c); return e >= 0 && this.d.solideFace(e, FACE[face], 0); };
      for (const [dx, dz, face] of DIR) if (pleine(x + dx, y, z + dz, face) || pleine(x + dx, y + 1, z + dz, face)) { const n = norme(v); v = [n[0], n[1] - 6, n[2]]; break; }
    }
    return norme(v);
  }
  // Objet tenu utilise sur un bloc qui ne reagit pas (seau, briquet...) : evenement du monde `objet.utilise` ; les familles ecrivent ev.fait, ev.nouvelObjet, ev.raison
  utiliserObjet(x, y, z, opt = {}) {
    const ev = evenement({ pos: [x, y, z], face: opt.face || 'up', hit: opt.hit || [0.5, 0.5, 0.5], acteur: opt.acteur || null, accroupi: !!opt.accroupi, objet: String(opt.objet || '').replace(/^minecraft:/, ''), lacet: opt.lacet ?? 0, fait: false });
    this.reg.lancerMonde('objet.utilise', ev, this.api);
    return ev;
  }
  // Amorce un TNT en (x, y, z) : le bloc devient une entite a meche. opt.chaine : meche courte (amorce par une explosion voisine)
  allumer(x, y, z, opt = {}) {
    const e = this.monde.etatEn(x, y, z);
    if (e < 0 || this.d.nomBloc(e) !== 'tnt') return false;
    const b = this.d.blocDe(e), ev = evenement({ pos: [x, y, z], acteur: opt.acteur || null, chaine: !!opt.chaine });
    if (this.reg.a('allume', b)) this.reg.lancerBloc('allume', b, ev, this.api);
    if (ev.annule) return false;
    let meche;
    if (opt.chaine) {
      const m = this.regles.valeur('tnt.meche', 80), mn = this.regles.valeur('tnt.chaineMin', -1), mx = this.regles.valeur('tnt.chaineMax', -1);
      meche = mn >= 0 && mx >= mn ? mn + this.hasard.entierBorne(mx - mn + 1) : this.hasard.entierBorne(Math.max(1, Math.floor(m / 4))) + Math.floor(m / 8);
    }
    this.poser(x, y, z, 'minecraft:air', F.TOUS);
    this.entites.tnt(x, y, z, meche);
    return true;
  }
  // Un bloc qui tombe (sable, gravier...) : il quitte sa cellule et devient une entite
  chuter(x, y, z) {
    const e = this.monde.etatEn(x, y, z);
    if (e < 0) return false;
    const chaine = this.d.chaine(e);
    this.poser(x, y, z, 'minecraft:air', F.TOUS);
    this.entites.chute(x, y, z, chaine);
    return true;
  }
  exploser(x, y, z, opt = {}) { return exploser(this, x, y, z, opt); }
  // Signal de redstone direct sur un bloc (en attendant la redstone, P5) : evenement alimente
  alimenter(x, y, z, vrai) {
    const e = this.monde.etatEn(x, y, z);
    if (e < 0) return false;
    const b = this.d.blocDe(e);
    if (!this.reg.a('alimente', b)) return false;
    this.reg.lancerBloc('alimente', b, evenement({ pos: [x, y, z], etat: this.d.chaine(e), bloc: this.d.nomBloc(e), alimente: vrai }), this.api);
    return true;
  }

  // ------------------------------------------------------------ API publique (la meme pour le moteur et pour les mods)
  _creerApi() {
    const s = this;
    const api = {
      bloc: (x, y, z) => s.decrire(x | 0, y | 0, z | 0),
      poser: (x, y, z, bloc, drapeaux = F.TOUS) => s.poser(x | 0, y | 0, z | 0, bloc, drapeaux),
      casser: (x, y, z, opt) => s.casser(x | 0, y | 0, z | 0, opt),
      planifier: (x, y, z, delai, priorite) => s.planifier(x | 0, y | 0, z | 0, delai, priorite),
      voisins: (x, y, z) => ORDRE_VOISINS.map((f) => { const nx = x + FACE_DX[f], ny = y + FACE_DY[f], nz = z + FACE_DZ[f]; return { face: NOMS_FACES[f], x: nx, y: ny, z: nz, bloc: s.decrire(nx, ny, nz) }; }),
      survit: (x, y, z) => s.survit(x | 0, y | 0, z | 0),
      survitEtat: (x, y, z, etat) => s.survitEtat(x | 0, y | 0, z | 0, etat),
      remplacable: (x, y, z) => { const e = s.monde.etatEn(x | 0, y | 0, z | 0); return e >= 0 && s.d.a(e, D.REMPLACABLE); },
      appui: (x, y, z, face, type = 'plein') => { const e = s.monde.etatEn(x | 0, y | 0, z | 0); const f = NOMS_FACES.indexOf(face); return e >= 0 && f >= 0 && s.d.solideFace(e, f, type === 'centre' ? 1 : type === 'rigide' ? 2 : 0); },
      lumiere: (x, y, z) => { const l = s.lumiere(); return { bloc: l.niveauBloc(x | 0, y | 0, z | 0), ciel: l.niveauCiel(x | 0, y | 0, z | 0) }; },
      evenement: (nom, donnees) => s.evenementPerso(nom, donnees),
      son: (nom, x, y, z, volume, hauteur) => s.son(nom, x, y, z, volume, hauteur),
      particule: (nom, x, y, z, vx, vy, vz, nombre) => s.particule(nom, x, y, z, vx, vy, vz, nombre),
      entites: (filtre) => s.entitesDans(filtre),          // acteurs (P1) ; mobs et objets en P2/P3
      champs: (nom) => { const b = s.d.idBloc(String(nom)); return b < 0 ? null : s.d.champsBloc(b); },
      utiliser: (x, y, z, opt) => s.utiliserBloc(x | 0, y | 0, z | 0, opt),
      alimenter: (x, y, z, vrai) => s.alimenter(x | 0, y | 0, z | 0, !!vrai),
      feu: (nom) => { const b = s.d.idBloc(String(nom)); return b < 0 ? [0, 0] : s.d.feu(b); },
      allumer: (x, y, z, opt) => s.allumer(x | 0, y | 0, z | 0, opt),
      butin: (x, y, z, opt) => { const e = s.monde.etatEn(x | 0, y | 0, z | 0); return e < 0 ? [] : s.entites.lacher(x | 0, y | 0, z | 0, e, opt || {}); },
      lacher: (objet, n, x, y, z) => { s.entites.objet(String(objet), Math.max(1, n | 0), +x, +y, +z); },
      fluide: (x, y, z) => s.fluide(x | 0, y | 0, z | 0),
      courant: (x, y, z) => s.courant(x | 0, y | 0, z | 0),
      degats: (nom, quantite, source) => { const a = s.acteurs?.parNom.get(nom); return !!a && a.degats(Number(quantite), String(source || 'generique')); },
      vie: (nom) => { const a = s.acteurs?.parNom.get(nom); return a ? { vie: a.vie, max: a.vieMax, mort: a.mort >= 0 } : null; },
      allumeParLave: (x, y, z) => { const e = s.monde.etatEn(x | 0, y | 0, z | 0); return e >= 0 && s.d.a(e, D.ALLUME_PAR_LAVE); },
      planifierFluide: (x, y, z, delai, priorite) => s.planifierFluide(x | 0, y | 0, z | 0, delai, priorite),
      boites: (x, y, z) => { const e = s.monde.etatEn(x | 0, y | 0, z | 0); return e < 0 ? PLEIN : s.d.boites(e); },
      estDans: (x, y, z, tag) => { const b = s.blocIdx(x | 0, y | 0, z | 0); return b >= 0 && s.d.etiquette(tag).has(b); },
      chuter: (x, y, z) => s.chuter(x | 0, y | 0, z | 0),
      exploser: (x, y, z, opt) => { const r = s.exploser(+x, +y, +z, opt || {}); return { detruits: r.detruits, touches: r.touches, puissance: r.puissance }; },
      blocEntite: (type, x, y, z, a, b, c) => { s.replay.blocEntite(s.temps, String(type), x | 0, y | 0, z | 0, a, b, c); },
      regle: (nom, repli) => s.regles.valeur(nom, repli),
      hasard: { entier: (n) => s.hasard.entierBorne(n), reel: () => s.hasard.reel(), booleen: () => s.hasard.booleen(), flottant: () => s.hasard.flottant() },
      tick: () => s.temps,
      dire: (t) => s.dire(t),
    };
    return api;
  }
  evenementPerso(nom, donnees) {
    if (!/^[a-z][A-Za-z0-9_]*\.[A-Za-z0-9_.]+$/.test(String(nom))) throw new ErreurMonde(`monde.evenement('${nom}') : nom de la forme "famille.nom" attendu`);
    this.stats.evenements++;
    const ev = evenement({ ...(donnees || {}), nom });
    this.reg.lancerMonde(nom, ev, this.api);
    return ev;
  }

  // ------------------------------------------------------------ le tick
  _tick() {
    const t = this.temps;
    this.posesCeTick = 0;
    // 0. commandes datees et debut de tick
    if (this.reg.aMonde('debutTick')) this.reg.lancerMonde('debutTick', evenement({ tick: t }), this.api);
    this._commandes();
    // 2. ticks planifies de blocs
    const dus = this.file.collecter(t, MAX_PAR_TICK);
    for (const x of dus) {
      const b = this.blocIdx(x.x, x.y, x.z);
      if (b !== x.type) continue;                 // le bloc a change entre-temps : le tick est ignore
      this.stats.ticks++;
      const e = this.monde.etatEn(x.x, x.y, x.z);
      if (this.reg.a('tick', b)) this.reg.lancerBloc('tick', b, evenement({ pos: [x.x, x.y, x.z], etat: this.d.chaine(e), bloc: this.d.nomBloc(e) }), this.api);
    }
    // 2b. ticks planifies de fluides (apres ceux des blocs, comme le jeu) : l'ecoulement est ecrit avec l'API des mods (familles/fluides.js)
    if (this.fileFluides.nb) {
      for (const x of this.fileFluides.collecter(t, MAX_PAR_TICK)) {
        const f = this.fluide(x.x, x.y, x.z);
        if (f.type !== (x.type === 1 ? 'water' : 'lava')) continue;     // le fluide a change de famille ou a disparu
        this.nbFluides++;
        this.reg.lancerMonde('fluide.tick', evenement({ pos: [x.x, x.y, x.z], type: f.type }), this.api);
      }
    }
    // 3. ticks aleatoires dans la region active
    this._aleatoires();
    // 5. entites : les acteurs (intentions, marche, interactions) ; leurs blocs touches (plaques) sont traites a la fin de leur deplacement
    if (this.acteurs) this.acteurs.tick();
    if (this.entites.liste.length) this.entites.tick();
    // 8. fin de tick
    if (this.reg.aMonde('finTick')) this.reg.lancerMonde('finTick', evenement({ tick: t }), this.api);
    this._ecrireReplay();
  }

  _commandes() {
    const c = this.cmds;
    while (this.iCmd < c.length && c[this.iCmd].tick <= this.temps) {
      const k = c[this.iCmd++];
      if (k.tipo === 'alimente') this.alimenter(k.x, k.y, k.z, !!k.bloc);
      else if (k.tipo === 'allume') this.allumer(k.x, k.y, k.z, {});
      else if (k.tipo === 'explose') this.exploser(k.x + 0.5, k.y + 0.5, k.z + 0.5, { puissance: k.bloc });
      else this.poser(k.x, k.y, k.z, k.bloc, F.TOUS);
    }
  }

  _aleatoires() {
    const vitesse = this.regles.valeur('monde.ticksAleatoires', 3);
    if (!vitesse || !this.regionSections.length || !this.aTickAleatoire) return;
    for (const [sx, sy, sz] of this.regionSections) {
      for (let i = 0; i < vitesse; i++) {
        const [dx, dy, dz] = this.tirage.prochain();
        const a = this.monde.ancre, x = a[0] + sx * 16 + dx, y = a[1] + sy * 16 + dy, z = a[2] + sz * 16 + dz;
        const e = this.monde.etatEn(x, y, z);
        if (e < 0 || !this.d.a(e, D.TICK_ALEATOIRE)) continue;
        const b = this.d.blocDe(e);
        if (!this.reg.a('tickAleatoire', b)) continue;
        this.stats.aleatoires++;
        this.reg.lancerBloc('tickAleatoire', b, evenement({ pos: [x, y, z], etat: this.d.chaine(e), bloc: this.d.nomBloc(e) }), this.api);
      }
    }
  }
  // sections (16x16x16, ancrees a l'origine de la zone) de la region active : +-48 blocs autour des positions de la scene,
  // rognees a la boite. Chaque section = [sx, sy, sz] relatifs a l'ancre.
  _calculerRegion() {
    const m = this.monde, a = m.ancre, R = 48;
    const cles = new Set();
    const ymin = Math.floor((m.y0 - a[1]) / 16), ymax = Math.floor((m.y0 + m.sy - 1 - a[1]) / 16);
    const xmin = Math.floor((m.x0 - a[0]) / 16), xmax = Math.floor((m.x0 + m.sx - 1 - a[0]) / 16);
    const zmin = Math.floor((m.z0 - a[2]) / 16), zmax = Math.floor((m.z0 + m.sz - 1 - a[2]) / 16);
    for (const [x, y, z] of this.region) {
      for (let sx = Math.max(xmin, Math.floor((x - R - a[0]) / 16)); sx <= Math.min(xmax, Math.floor((x + R - a[0]) / 16)); sx++) {
        for (let sz = Math.max(zmin, Math.floor((z - R - a[2]) / 16)); sz <= Math.min(zmax, Math.floor((z + R - a[2]) / 16)); sz++) {
          for (let sy = Math.max(ymin, Math.floor((y - R - a[1]) / 16)); sy <= Math.min(ymax, Math.floor((y + R - a[1]) / 16)); sy++) cles.add(`${sz},${sx},${sy}`);
        }
      }
    }
    // ordre du jeu : par chunk (z puis x) puis section de bas en haut
    this.regionSections = [...cles].map((k) => k.split(',').map(Number)).sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]).map(([sz, sx, sy]) => [sx, sy, sz]);
  }

  _ecrireReplay() {
    const c = this.monde.changes;
    for (let i = 0; i < c.length; i += 5) this.replay.bloc(this.temps, c[i], c[i + 1], c[i + 2], c[i + 3], c[i + 4]);
    c.length = 0;
  }

  // ------------------------------------------------------------ execution complete
  // Lance la simulation pour toute la duree de la scene. Rend le replay.
  // Prepare l'execution (commandes datees, region active, enregistrements figes) sans avancer ; rend le nombre de ticks.
  initialiser({ duree, ralenti = 1 } = {}) {
    const cfg = this.config;
    duree = duree ?? cfg.duree ?? 1;
    const n = Math.floor(duree * 20 * ralenti + 1e-9) + 1;       // ticks 0..n-1 : le dernier est celui de l'instant `duree`
    this.replay.ticks = n; this.replay.ralenti = ralenti;
    // commandes datees : [t, x, y, z, bloc] (t en secondes de film) -> tick du monde
    this.cmds = (cfg.blocs || []).map(([t, x, y, z, bloc], i) => ({ tick: Math.floor(t * 20 * ralenti + 1e-9), x, y, z, bloc, i })).sort((p, q) => p.tick - q.tick || p.i - q.i);
    // commandes `cmd` : [t, "alimente", x, y, z, vrai|faux] (signal direct sur un bloc : porte en fer, cloche, bloc musical...)
    // [t, "allume", x, y, z] : amorce un TNT ; [t, "explose", x, y, z, puissance] : explosion
    for (const [t, verbe, x, y, z, v] of cfg.cmd || []) if (verbe === 'alimente' || verbe === 'allume' || verbe === 'explose') this.cmds.push({ tick: Math.floor(t * 20 * ralenti + 1e-9), x, y, z, bloc: v, tipo: verbe, i: this.cmds.length });
    this.cmds.sort((p, q) => p.tick - q.tick || p.i - q.i);
    this.iCmd = 0;
    this.region = this.cmds.map((c) => [c.x, c.y, c.z]);
    if (this.acteurs) for (const a of this.acteurs.liste) this.region.push([a.x, a.y, a.z]);
    this.aTickAleatoire = this.reg.entrees.some((e) => e.genre === 'bloc' && e.evt === 'tickAleatoire');
    this._calculerRegion();
    this.reg.figer();
    return n;
  }

  // Avance de `n` ticks (essais, ou boucle de `executer`)
  avancer(n = 1) { for (let k = 0; k < n; k++) { this._tick(); this.temps++; } }

  executer({ duree, ralenti = 1 } = {}) {
    const cfg = this.config;
    const n = this.initialiser({ duree, ralenti });
    const t0 = performance.now();
    for (this.temps = 0; this.temps < n; this.temps++) {
      this._tick();
      if (performance.now() - t0 > (cfg.plafondMs ?? 60000)) { this.avertir(`simulation arretee au tick ${this.temps} : plus de ${(cfg.plafondMs ?? 60000) / 1000} s de calcul`); break; }
    }
    this.replay.palAjouts = this.monde.palette.slice(this.zone.palette.length);
    this.replay.avertissements = this.avertissements;
    this.replay.stats = { ...this.stats, ms: performance.now() - t0, agrandissements: this.monde.agrandissements };
    return this.replay;
  }
}
