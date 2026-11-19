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
import { Redstone } from './redstone.js';
import { Contenus, niveauListe } from './contenus.js';
import { deplacerBoite } from './collision.js';   // poussee des pistons (Entity.move(PISTON) avec collisions)
const intersecte = (a, b) => a[3] > b[0] && a[0] < b[3] && a[4] > b[1] && a[1] < b[4] && a[5] > b[2] && a[2] < b[5];   // AABB.intersects (strict)
import { Fours } from './four.js';
import { Arbres } from './arbres.js';
import { assombrissementCiel, ticksDuJour } from './environnement.js';
import { Meteo } from './meteo.js';
import { Vibrations } from './vibrations.js';
import { Boss } from './ia-boss.js';
import { poiChange } from './ia-villageois.js';
import { TYPES as TYPES_PROJ } from './projectiles.js';
import { lireFusee, nouvelleFusee } from './fusees.js';
const PROJECTILES_MOD = new Set(Object.keys(TYPES_PROJ));   // types de projectiles que monde.projectile cree

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
    // heure du jeu (gameTime) des ticks planifies : ServerLevel.tickTime l'avance APRES les commandes du debut du tick ; pendant la phase 0 et
    // entre deux ticks elle vaut celle du dernier tick fait (trace tick a tick de Horizon : test/trace-horizon.test.js)
    this.horloge = -1;
    this.replay = new Replay({ graine: config.graine ?? 1, ralenti: config.ralenti ?? 1, moteur: MOTEUR });
    if (config.dimension && config.dimension !== 'overworld') this.replay.dimension = config.dimension;   // le film : ciel, lumiere et sons de l'End
    this.u = { pile: [], ajoutes: [], count: 0 };
    this.surcharge = null;                        // { x, y, z, e } : etat hypothetique d'une cellule (calcul des formes d'un bloc de piston qui se pose)
    this.enTick = false;                          // vrai pendant les ticks planifies et aleatoires (Level.isHandlingTick)
    this.enAttente = new Set();                   // ticks collectes pour ce tick et pas encore executes (willTickThisTick)
    this.evBlocs = [];                            // file des evenements de blocs (ServerLevel.blockEvent) : { x, y, z, bloc, a, b }
    this.contenus = new Contenus(this);
    this.arbres = new Arbres(this);               // pousses -> arbres (arbres.js)
    this.meteo = config.meteo ? new Meteo(this, config.meteo) : null;   // pluie, neige, orage, foudre (meteo.js) ; absente sans `ciel.meteo`
    this.fours = new Fours(this);                 // cuisson des fours (four.js)          // contenu des conteneurs (coffre, entonnoir, dropper...) : contenus.js
    this.redstone = new Redstone(this);  // mises a jour de voisins en vol (CollectingNeighborUpdater)
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
    this.jukeboxes = new Map();                   // juke-box qui jouent : 'x,y,z' -> { pos, disque, son, debut, fin, depuis } (familles/musique.js) ; les perroquets et allays les ecoutent
    this.vibrations = new Vibrations(this);      // vibrations (pas, blocs, projectiles, explosions) : capteurs de sculk et wardens (vibrations.js)
    this.boss = new Boss(this);                   // cristaux de l'End, nuages de souffle du dragon, motif du wither (ia-boss.js)
    this.creatures = config.creatures ?? null;    // table des creatures pour les entites nees en cours de route : { gabarit(c), stats(type) } (film/video.js)
  }

  // heure du jour de la scene (ciel.heure, 0 a 24 ; midi = 12) au tick courant : le detecteur de lumiere du jour la lit
  // Level.getSkyDarken au tick courant (0 le jour, 11 la nuit ; pluie et orage assombrissent ; End : 0) : environnement.js
  assombrissement() {
    const n = this.meteo ? this.meteo.niveaux() : { pluie: 0, orage: 0 };
    return assombrissementCiel(ticksDuJour(this.heureMonde()), n.pluie ?? 0, n.orage ?? 0, this.config.dimension ?? 'overworld');
  }
  heureMonde() { const f = this.config.heure; return typeof f === 'function' ? f(this.temps / 20 / (this.replay.ralenti || 1)) : typeof f === 'number' ? f : 12; }

  // Forme de collision qui depend du moment : le bloc `moving_piston` (bloc a entite) prend la forme du bloc qu'il porte, decalee par le progres, coupee a sa cellule.
  // `collisionDyn` est posee par la famille des pistons ; rend une liste de boites ou null.
  formeDyn(e, x, y, z) { return this.collisionDyn && this.d.nomBloc(e) === 'moving_piston' ? this.collisionDyn(x, y, z) : null; }

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
    const sc = this.surcharge;
    const e = sc && sc.x === x && sc.y === y && sc.z === z ? sc.e : this.monde.etatEn(x, y, z);
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
    if (change && blocAnc >= 0 && this.reg.a('retire', blocAnc)) this.reg.lancerBloc('retire', blocAnc, evenement({ pos: [x, y, z], etat: this.d.chaine(eAnc), bloc: this.d.nomBloc(eAnc), nouveau: eNou >= 0 ? this.d.chaine(eNou) : '#hidden', drapeaux, deplace: !!(drapeaux & F.PISTON) }), this.api);
    if (m.indiceEn(x, y, z) !== nouveau) return true;                   // un gestionnaire a deja remplace le bloc
    if (!(drapeaux & F.SANS_POSE) && blocNou >= 0 && this.reg.a('pose', blocNou)) {
      this.reg.lancerBloc('pose', blocNou, evenement({ pos: [x, y, z], etat: this.d.chaine(eNou), bloc: this.d.nomBloc(eNou), ancien: eAnc >= 0 ? this.d.chaine(eAnc) : '#hidden', ancienId: eAnc, drapeaux, memeBloc: blocAnc === blocNou }), this.api);
    }
    if (m.indiceEn(x, y, z) === nouveau) {
      if (drapeaux & F.VOISINS) {
        this._majVoisins(x, y, z, blocAnc);
        if (eNou >= 0 && this.d.sortieAnalogique(eNou)) this.redstone.majSortieAnalogique(x, y, z, blocNou);
      }
      if (!(drapeaux & F.FORME_CONNUE) && limite > 0) {
        const f = drapeaux & ~(F.VOISINS | F.SANS_BUTIN);
        // Level.setBlock : formes indirectes de l'ancien etat, formes des voisins, formes indirectes du nouveau (la poudre de redstone les surcharge)
        this.redstone.formesIndirectes(x, y, z, eAnc, f, limite - 1);
        this._majFormesVoisines(x, y, z, f, limite - 1);
        this.redstone.formesIndirectes(x, y, z, eNou, f, limite - 1);
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
      this.entites.lacher(x, y, z, e, { outilOk: ok, acteur: c.acteur ?? null, source: 'casse', outil: c.outil ?? null });   // l'outil : Toucher de soie, Fortune, cisailles (butin.js)
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
  _majVoisins(x, y, z, blocSource) { this._ajouter({ k: 'multi', x, y, z, bloc: blocSource, i: 0, sauf: -1 }); }
  // updateNeighborsAtExceptFromFacing : comme _majVoisins, sans le voisin du cote `sauf` (indice de face)
  majVoisinsSauf(x, y, z, blocSource, sauf) { this._ajouter({ k: 'multi', x, y, z, bloc: blocSource, i: ORDRE_VOISINS[0] === sauf ? 1 : 0, sauf }); }
  // neighborChanged d'UNE cellule (sans les autres voisins)
  voisinChangeEn(x, y, z, blocSource) { this._ajouter({ k: 'simple', x, y, z, bloc: blocSource }); }
  // une mise a jour de forme d'un seul cote (neighborShapeChanged) : le bloc en (x,y,z) apprend que le voisin (nx,ny,nz) a change ; `direction` : indice de face
  formeVoisinEn(direction, x, y, z, nx, ny, nz, drapeaux, limite) { this._ajouter({ k: 'forme', x, y, z, direction, nx, ny, nz, etatVoisin: this.monde.etatEn(nx, ny, nz), drapeaux, limite }); }

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
      if (m.i < 6 && ORDRE_VOISINS[m.i] === m.sauf) m.i++;
      const nx = m.x + FACE_DX[f], ny = m.y + FACE_DY[f], nz = m.z + FACE_DZ[f];
      this._voisinChange(nx, ny, nz, m.bloc, m.x, m.y, m.z);
      return m.i < 6;
    }
    if (m.k === 'simple') { this._voisinChange(m.x, m.y, m.z, m.bloc, m.x, m.y, m.z); return false; }
    // mise a jour de forme : le bloc en (x,y,z) apprend qu'un voisin (nx,ny,nz) a change
    // UPDATE_SKIP_SHAPE_UPDATE_ON_WIRE : la poudre de redstone ne recoit pas la forme
    if ((m.drapeaux & F.SANS_FORME_FIL) && this.redstone.estFil(this.monde.etatEn(m.x, m.y, m.z))) return false;
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
  _forme(x, y, z, direction, nx, ny, nz, etatVoisin, eSur) {
    const e = eSur ?? this.monde.etatEn(x, y, z);
    if (e < 0) return undefined;
    const b = this.d.blocDe(e);
    if (!this.reg.a('forme', b)) return undefined;
    const r = this.reg.lancerBloc('forme', b, evenement({ pos: [x, y, z], etat: this.d.chaine(e), bloc: this.d.nomBloc(e), direction: NOMS_FACES[direction], voisinPos: [nx, ny, nz], voisin: etatVoisin >= 0 ? this.d.chaine(etatVoisin) : '#hidden' }), this.api);
    if (r === undefined || r === null) return undefined;
    return this._indiceDe(r);
  }
  // Block.updateFromNeighbourShapes : l'etat `e0` pose en (x,y,z) apres les mises a jour de forme de ses 6 voisins (ordre du jeu). Rend un numero d'etat (air : le bloc disparait).
  formeDepuisVoisins(x, y, z, e0) {
    let e = e0;
    const avant = this.surcharge;
    try {
      for (const f of ORDRE_FORMES) {
        this.surcharge = { x, y, z, e };
        const nx = x + FACE_DX[f], ny = y + FACE_DY[f], nz = z + FACE_DZ[f];
        const r = this._forme(x, y, z, f, nx, ny, nz, this.monde.etatEn(nx, ny, nz), e);
        if (r === undefined) continue;
        const e2 = this.monde.tEtat[r];
        if (e2 >= 0 && this.d.nomBloc(e2) === 'air') return e2;
        e = e2;
      }
    } finally { this.surcharge = avant; }
    return e;
  }
  // affectNeighborsAfterRemoval d'un etat qui n'est plus la (bloc detruit par un piston) : lance l'evenement `retire`
  retirerEtat(x, y, z, e) {
    const b = this.d.blocDe(e);
    if (this.reg.a('retire', b)) this.reg.lancerBloc('retire', b, evenement({ pos: [x, y, z], etat: this.d.chaine(e), bloc: this.d.nomBloc(e), nouveau: 'minecraft:air', drapeaux: F.TOUS, deplace: false }), this.api);
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
    return this.file.planifier(this.horloge, b, x, y, z, delai, priorite);
  }
  planifierBloc(x, y, z, bloc, delai = 0, priorite = 0) { return this.file.planifier(this.horloge, bloc, x, y, z, delai, priorite); }

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
    return this.fileFluides.planifier(this.horloge, f.type === 'water' ? 1 : 2, x, y, z, delai, priorite);
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
    }).map((a) => ({ id: a.id, type: 'joueur', typeCreature: a.typeCreature ?? null, nom: a.nom, x: a.x, y: a.y, z: a.z, boite: a.boite() }));
  }
  // Clic droit sur un bloc (Block.use) : lance l'evenement utilise ; rend 'fait', 'passe' ou undefined (rien n'ecoute).
  // opt : { acteur (nom), face ('north'...), hit [fx,fy,fz], accroupi, objet, lacet }
  utiliserBloc(x, y, z, opt = {}) {
    const e = this.monde.etatEn(x, y, z);
    if (e < 0) return undefined;
    if (this.d.esAir(e) && this.reg.aMonde('cadre.utilise')) {   // un cadre accroche dans la cellule (familles/cadres.js : ItemFrame.interact)
      const ev = this.evenementPerso('cadre.utilise', { pos: [x, y, z], acteur: opt.acteur || null, objet: opt.objet || null, fait: false });
      if (ev.fait) { this.dernierUtilise = ev; return 'fait'; }
    }
    const b = this.d.blocDe(e);
    if (!this.reg.a('utilise', b)) return undefined;
    const ev = evenement({ pos: [x, y, z], etat: this.d.chaine(e), bloc: this.d.nomBloc(e), face: opt.face || 'up', hit: opt.hit || [0.5, 0.5, 0.5], acteur: opt.acteur || null, accroupi: !!opt.accroupi, objet: opt.objet || null, lacet: opt.lacet ?? 0, vent: !!opt.vent });   // vent : rafale d'une charge de vent (onExplosionHit)
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
    const ev = evenement({ pos: [x, y, z], face: opt.face || 'up', hit: opt.hit || [0.5, 0.5, 0.5], acteur: opt.acteur || null, accroupi: !!opt.accroupi, objet: String(opt.objet || '').replace(/^minecraft:/, ''), lacet: opt.lacet ?? 0, fusee: opt.fusee ?? null, fait: false });
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
    const ch = this.d.chaine(e);   // PrimedTnt.block_state : un bloc de mod qui copie la TNT garde son aspect une fois amorce (rien de change pour la TNT du jeu)
    this.entites.tnt(x, y, z, meche, ch.startsWith('minecraft:') ? -1 : this.monde.indicePalette(ch));
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
      solide: (x, y, z) => { const e = s.monde.etatEn(x | 0, y | 0, z | 0); return e < 0 || s.d.estSolide(e); },   // BlockState.isSolid du jeu (cellule cachee : pleine)
      renduPlein: (x, y, z) => { const e = s.monde.etatEn(x | 0, y | 0, z | 0); return e >= 0 && s.d.a(e, D.RENDU_PLEIN); },   // BlockState.isSolidRender
      appui: (x, y, z, face, type = 'plein') => { const e = s.monde.etatEn(x | 0, y | 0, z | 0); const f = NOMS_FACES.indexOf(face); return e >= 0 && f >= 0 && s.d.solideFace(e, f, type === 'centre' ? 1 : type === 'rigide' ? 2 : 0); },
      lumiere: (x, y, z) => { const l = s.lumiere(); return { bloc: l.niveauBloc(x | 0, y | 0, z | 0), ciel: l.niveauCiel(x | 0, y | 0, z | 0) }; },
      opacite: (x, y, z) => { const e = s.monde.etatEn(x | 0, y | 0, z | 0); return e < 0 ? 15 : s.d.opacite(e); },   // lumiere arretee par le bloc (getLightBlock : 0 a 15)
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
      lacher: (objet, n, x, y, z, opt) => { s.entites.objet(String(objet), Math.max(1, n | 0), +x, +y, +z, opt || {}); },
      // projectile en vol (moteur/projectiles.js) : type fleche, trident, boule, oeuf, perle, potion, boule_feu, petite_boule_feu, crane, boule_dragon ;
      // pos (pieds), vitesse (blocs par tick) ; opt : { puissance (boule de feu), dangereux (crane), proprietaire (nom d'acteur) }. Rend son id ou null.
      // vitesse d'un projectile deja cree (le tir de biais d'une fusee vient apres ses propres tirages)
      orienterProjectile: (id, v) => { const e = s.entites.liste.find((q) => q.id === id && q.proj); if (e) { e.vx = +v[0]; e.vy = +v[1]; e.vz = +v[2]; } },
      // fusee d'artifice (moteur/fusees.js) : pos, composant { flight_duration, explosions }, opt : { vitesse (de biais), proprietaire }
      fusee: (pos, spec, opt = {}) => {
        const f = lireFusee(spec), prop = opt.proprietaire ? s.acteurs?.parNom.get(String(opt.proprietaire)) ?? null : null;
        const e = nouvelleFusee(s, prop, [+pos[0], +pos[1], +pos[2]], f, opt.vitesse ? { oblique: true, vitesse: opt.vitesse.map(Number) } : {});
        return e ? e.id : null;
      },
      projectile: (type, pos, v, opt = {}) => {
        const t = String(type);
        if (!PROJECTILES_MOD.has(t)) throw new ErreurMonde(`monde.projectile('${t}') : type inconnu (${[...PROJECTILES_MOD].join(', ')})`);
        const prop = opt.proprietaire ? s.acteurs?.parNom.get(String(opt.proprietaire)) ?? null : null;
        const e = s.entites.proj.creer(t, prop, [+pos[0], +pos[1], +pos[2]], [+v[0], +v[1], +v[2]], { sansHerite: true, puissance: opt.puissance ?? 1, dangereux: !!opt.dangereux, ...(t === 'fleche' ? { degatsBase: 2, crit: !!opt.critique } : {}), ...(TYPES_PROJ[t]?.objet ? { objet: TYPES_PROJ[t].objet } : {}) });
        return e ? e.id : null;
      },
      // contenus des conteneurs (coffre, tonneau, entonnoir, dropper, distributeur)
      contenuTaille: (x, y, z) => s.contenus.taille(x | 0, y | 0, z | 0),
      contenuListe: (x, y, z) => { const l = s.contenus.lire(x | 0, y | 0, z | 0); return l ? l.map((e) => (e ? { item: e.item, n: e.n } : null)) : []; },
      contenuAjouter: (x, y, z, item, n) => s.contenus.ajouter(x | 0, y | 0, z | 0, String(item).replace(/^minecraft:/, ''), n | 0),
      contenuRetirer: (x, y, z, i, n) => s.contenus.retirer(x | 0, y | 0, z | 0, i | 0, n ?? 1),
      contenuVide: (x, y, z) => s.contenus.vide(x | 0, y | 0, z | 0),
      contenuPlein: (x, y, z) => s.contenus.plein(x | 0, y | 0, z | 0),
      contenuVider: (x, y, z) => s.contenus.vider(x | 0, y | 0, z | 0),
      contenuViderCases: (x, y, z) => s.contenus.viderCases(x | 0, y | 0, z | 0),   // toutes les cases propres du bloc (vides comprises), retirees
      // boite de shulker cassee : son contenu suit l'objet lache (le plus recent de ce type, dans la cellule)
      contenuAttacher: (x, y, z, bloc, liste) => { const o = [...s.entites.liste].reverse().find((e) => e.type === 'objet' && e.item === String(bloc).replace(/^minecraft:/, '') && Math.floor(e.x) === (x | 0) && Math.floor(e.z) === (z | 0) && !e.contenu); if (o && liste.length) o.contenu = liste.map((e) => ({ ...e })); },
      contenuNotifie: (x, y, z) => { const b = s.blocIdx(x | 0, y | 0, z | 0); if (b >= 0) s.redstone.majSortieAnalogique(x | 0, y | 0, z | 0, b); },
      entonnoirsInitiaux: () => s.contenus.entonnoirs(),
      prendreObjets: (boite, fn) => s.entites.prendre(boite, fn),
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
      ...s.redstone.api(),
      formeDepuisVoisins: (x, y, z, etat) => { const id = typeof etat === 'number' ? etat : s.d.etatId(String(etat)); return id < 0 ? null : s.d.chaine(s.formeDepuisVoisins(x | 0, y | 0, z | 0, id)); },
      retirerEtat: (x, y, z, etat) => { const id = typeof etat === 'number' ? etat : s.d.etatId(String(etat)); if (id >= 0) s.retirerEtat(x | 0, y | 0, z | 0, id); },
      dansTick: () => s.enTick,
      collisionDyn: (fn) => { s.collisionDyn = fn; },
      etatId: (t) => s.d.etatId(String(t)),
      boitesEtat: (t) => { const id = s.d.etatId(String(t)); return id < 0 ? [] : s.d.boites(id); },
      formesIndirectes: (x, y, z, etat, drapeaux, limite) => { const id = typeof etat === 'number' ? etat : s.d.etatId(String(etat)); if (id >= 0) s.redstone.formesIndirectes(x | 0, y | 0, z | 0, id, drapeaux ?? 2, limite ?? 512); },
      idEntite: () => s.entites.prochain++,
      ecrireEntite: (id, type, x, y, z, a, etat) => { s.replay.entite(s.temps, id, String(type), x, y, z, a ?? 0, etat === undefined || etat === null ? -1 : s.monde.indicePalette(String(etat))); },
      acteursListe: () => (s.acteurs ? s.acteurs.liste.map((a) => ({ nom: a.nom, boite: a.boite() })) : []),
      deplacerActeur: (nom, dx, dy, dz) => { const a = s.acteurs?.parNom.get(nom); if (a) { a.x += dx; a.y += dy; a.z += dz; } return !!a; },
      evenementBloc: (x, y, z, a, b) => s.evenementBloc(x | 0, y | 0, z | 0, a | 0, b | 0),
      dire: (t) => s.dire(t),
      arbre: (x, y, z, espece, opt) => s.arbres.pousser(x | 0, y | 0, z | 0, String(espece), opt || {}),
      // pousses, champignons et caracteristiques du jeu (arbres.js, caracteristiques.js) ; assombrissement du ciel (environnement.js)
      arbreAvancer: (x, y, z) => s.arbres.avancer(x | 0, y | 0, z | 0),
      arbrePossible: (x, y, z) => s.arbres.possible(x | 0, y | 0, z | 0),
      champignonGeant: (x, y, z) => s.arbres.champignon(x | 0, y | 0, z | 0),
      champignonPossible: (x, y, z) => s.arbres.champignonPossible(x | 0, y | 0, z | 0),
      caracteristique: (nom, x, y, z) => !!s.arbres.carac?.placer(String(nom), x | 0, y | 0, z | 0),
      assombrissement: () => s.assombrissement(),
      dimension: () => s.config.dimension ?? 'overworld',
      pleut: (x, y, z) => (s.meteo ? s.meteo.pleutEn(x | 0, y | 0, z | 0) : false),
      foudre: (x, y, z, opt) => { if (!s.meteo) return false; s.meteo.foudre(+x, +z, y === undefined ? undefined : +y, opt || {}); return true; },
      niveauxMeteo: () => (s.meteo ? s.meteo.niveaux() : { pluie: 0, orage: 0 }),
      precipitation: (x, y, z) => (s.meteo ? s.meteo.precipitation(x | 0, y | 0, z | 0) : null),
      jukeboxes: () => s.jukeboxes,
      // creatures nees d'un bloc (oeufs de tortue, frai, oeuf de renifleur : familles/oeufs.js) ; biome et heure du monde
      naitre: (o) => (s.acteurs ? s.acteurs.naitre(o) : null),
      biome: (x, y, z) => s.zone.biome?.(x | 0, z | 0) ?? null,   // Zone.biome(x, z) : un biome par colonne
      heure: () => s.heureMonde(),
      // ---- blocs et machines (docs/SIMULATION.md partie 27)
      estSourceSignal: (nom) => { const b = s.d.idBloc(String(nom ?? '')); return b >= 0 && s.d.sourceSignal(s.d.etatParDefaut(b)); },   // l'etat par defaut du bloc source
      wagonnetsDans: (b) => (s.acteurs ? s.acteurs.liste.filter((a) => a.veh?.wagon && a.mort < 0 && intersecte(a.boite(), b)).map((a) => ({ nom: a.nom, conteneur: !!a.veh.cases, niveau: a.veh.cases ? niveauListe(a.veh.cases) : 0 })) : []),
      entitesDans: (b) => s.compterEntitesDans(b),   // TripWireBlock.checkPressed : toute entite (acteurs, vehicules, objets, fleches...)
      blocsDeClasse: (classe) => s.blocsDeClasse(classe),
      surface: (x, z) => s.surface(x | 0, z | 0),     // Heightmap WORLD_SURFACE : le premier y libre au-dessus du plus haut bloc non vide
      evenementNiveau: (code, p, donnee) => { s.replay.blocEntite(s.temps, 'niveau' + code, p[0] | 0, p[1] | 0, p[2] | 0, donnee ?? 0); s.particulesNiveau(code, p, donnee); },
      configBalises: () => s.config.balises ?? [],
      ecrireBalise: (x, y, z, sections) => s.ecrireBalise(x, y, z, sections),
      tempsMonde: () => s.temps + (s.config.tempsMonde0 ?? 0),
      joueursDans: (b) => (s.acteurs ? s.acteurs.liste.filter((a) => !a.typeCreature && a.mort < 0 && !a.veh && intersecte(a.boite(), b, true)).map((a) => a.nom) : []),
      donnerEffet: (nom, id, ticks, niveau) => { const a = s.acteurs?.parNom.get(nom); if (a?.appliquerEffet) a.appliquerEffet(String(id), ticks | 0, niveau | 0); },
      avertir: (t) => s.avertir(String(t)),
      configCadres: () => s.config.cadres ?? [],
      corpsPoussables: () => s.corpsPoussables(),   // entites qu'un bloc de piston pousse (familles/pistons.js)
      // cases d'un wagonnet a conteneur dont la boite touche la cellule (HopperBlockEntity.getEntityContainer) : { cases, ajouter(objet, n), retirer(i) } ou null
      wagonCases: (x, y, z) => { const c = [x, y, z, x + 1, y + 1, z + 1], a = s.acteurs?.liste.find((q) => q.veh?.cases && q.mort < 0 && intersecte(q.boite(), c)); if (!a) return null; const L = a.veh.cases; return { cases: L, ajouter: (item, n) => { let r = n; const max = s.d.pileMax(item); for (const e of L) if (e && e.item === item && e.n < max && r > 0) { const k = Math.min(r, max - e.n); e.n += k; r -= k; } for (let i = 0; i < L.length && r > 0; i++) if (!L[i]) { const k = Math.min(r, max); L[i] = { item, n: k }; r -= k; } return r; }, retirer: (i) => { if (L[i]) { L[i].n--; if (L[i].n <= 0) L[i] = null; } } }; },
      nouveauCadre: (x, y, z, face, lueur) => { const r = { id: s.replay.cadres.length, x, y, z, face, lueur: !!lueur, d: [] }; s.replay.cadres.push(r); return r; },
    };
    return api;
  }
  // ---- blocs et machines (docs/SIMULATION.md partie 27)
  // Entity.move(MoverType.PISTON) : limitPistonMovement (0,51 par axe et par tick, cumule ; seul le premier axe non nul), puis les collisions
  limitePiston(o, mv) {
    if (mv[0] * mv[0] + mv[1] * mv[1] + mv[2] * mv[2] <= 1e-7) return mv;
    const L = (o._piston ??= { t: -1, d: [0, 0, 0] });
    if (L.t !== this.temps) { L.d = [0, 0, 0]; L.t = this.temps; }
    for (let i = 0; i < 3; i++) {
      if (mv[i] === 0) continue;
      const s = mv[i] + L.d[i], n = Math.max(-0.51, Math.min(0.51, s)), ch = n - L.d[i];
      L.d[i] = n;
      if (Math.abs(ch) <= Math.fround(1e-5)) return [0, 0, 0];
      const r = [0, 0, 0]; r[i] = ch; return r;
    }
    return [0, 0, 0];
  }
  corpsPoussables() {
    const out = [], lec = this.entites.lec;
    for (const a of this.acteurs?.liste ?? []) {
      if (a.mort >= 0 || a.monte || a.ia?.dansRuche || a.ia?.surEpaule) continue;
      out.push({ boite: () => a.boite(), position: () => [a.x, a.y, a.z], auSol: () => a.auSol, poussable: true,
        rebond: (d) => { const v = { est: ['vx', 1], ouest: ['vx', -1], haut: ['vy', 1], bas: ['vy', -1], sud: ['vz', 1], nord: ['vz', -1] }[d]; a[v[0]] = v[1]; if (d === 'haut') a.auSol = false; (this.stats.rebondsPiston ??= 0); this.stats.rebondsPiston++; },
        pousser: (mv) => { const l = this.limitePiston(a, mv), r = deplacerBoite(a.lec ?? lec, a.boite(), l, false, 0); a.x += r.dx; a.y += r.dy; a.z += r.dz; if (l[1] < 0 && r.dy !== l[1]) a.auSol = true; if (a.veh) a.veh.onGround = a.auSol; } });
    }
    const T = { objet: [0.25, 0.25], tnt: [0.98, 0.98], chute: [0.98, 0.98], orbe: [0.5, 0.5] };
    for (const e of this.entites.liste) {
      const t = T[e.type];
      if (!t || e.detruit || e.pris) continue;
      const bo = () => [e.x - t[0] / 2, e.y, e.z - t[0] / 2, e.x + t[0] / 2, e.y + t[1], e.z + t[0] / 2];
      out.push({ boite: bo, position: () => [e.x, e.y, e.z], auSol: () => !!e.auSol, poussable: true,
        rebond: (d) => { const v = { est: ['vx', 1], ouest: ['vx', -1], haut: ['vy', 1], bas: ['vy', -1], sud: ['vz', 1], nord: ['vz', -1] }[d]; e[v[0]] = v[1]; },
        pousser: (mv) => { const l = this.limitePiston(e, mv), r = deplacerBoite(lec, bo(), l, false, 0); e.x += r.dx; e.y += r.dy; e.z += r.dz; if (l[1] < 0 && r.dy !== l[1]) e.auSol = true; } });
    }
    return out;
  }
  compterEntitesDans(b) {
    let n = 0;
    for (const a of this.acteurs?.liste ?? []) if (a.mort < 0 && !a.ia?.dansRuche && intersecte(a.boite(), b)) n++;
    for (const e of this.entites.liste) {
      if (e.detruit || e.pris) continue;
      const k = e.type === 'objet' ? [e.x - 0.125, e.y, e.z - 0.125, e.x + 0.125, e.y + 0.25, e.z + 0.125] : e.type === 'tnt' || e.type === 'chute' ? [e.x - 0.49, e.y, e.z - 0.49, e.x + 0.49, e.y + 0.98, e.z + 0.49] : e.type === 'orbe' ? [e.x - 0.25, e.y, e.z - 0.25, e.x + 0.25, e.y + 0.5, e.z + 0.25] : e.proj ? [e.x - 0.25, e.y, e.z - 0.25, e.x + 0.25, e.y + 0.5, e.z + 0.25] : null;
      if (k && intersecte(k, b)) n++;
    }
    return n;
  }
  // Entity.checkInsideBlocks pour une entite qui n'est pas un acteur vivant (wagonnet, bateau, objet au sol) : evenement de bloc `entre`
  toucherBlocsEntite(b, entite) {
    const e = 1e-5;
    for (let y = Math.floor(b[1] + e); y <= Math.floor(b[4] - e); y++) for (let z = Math.floor(b[2] + e); z <= Math.floor(b[5] - e); z++) for (let x = Math.floor(b[0] + e); x <= Math.floor(b[3] - e); x++) {
      const k = this.monde.etatEn(x, y, z);
      if (k < 0) continue;
      const bl = this.d.blocDe(k);
      if (!this.reg.a('entre', bl)) continue;
      this.reg.lancerBloc('entre', bl, evenement({ pos: [x, y, z], etat: this.d.chaine(k), bloc: this.d.nomBloc(k), entite }), this.api);
    }
  }
  // positions des blocs d'une classe du jeu (zone de depart)
  blocsDeClasse(classe) {
    const m = this.monde, d = this.d, marque = new Uint8Array(m.palette.length + 1), sortie = [];
    let n = 0;
    for (let p = 2; p < m.palette.length; p++) { const e = m.tEtat[p]; if (e >= 0 && d.classes(d.blocDe(e)).includes(classe)) { marque[p] = 1; n++; } }
    if (!n) return sortie;
    for (let y = m.y0; y < m.y0 + m.sy; y++) for (let z = m.z0; z < m.z0 + m.sz; z++) for (let x = m.x0; x < m.x0 + m.sx; x++) { const p = m.indiceEn(x, y, z); if (p < marque.length && marque[p]) sortie.push([x, y, z]); }
    return sortie;
  }
  surface(x, z) {
    const m = this.monde;
    for (let y = Math.min(319, m.y0 + m.sy + 32); y >= -64; y--) { const e = m.etatEn(x, y, z); if (e < 0 || !this.d.esAir(e)) return y + 1; }
    return -64;
  }
  // balise : le faisceau de chaque tick, ecrit quand il change
  ecrireBalise(x, y, z, sections) {
    const k = `${x},${y},${z}`, B = (this._balises ??= new Map());
    let b = B.get(k);
    if (!b) { b = { x, y, z, d: [] }; B.set(k, b); this.replay.balises.push(b); }
    const txt = JSON.stringify(sections), der = b.d[b.d.length - 1];
    if (!der || JSON.stringify(der[1]) !== txt) b.d.push([this.temps, sections.map((s) => [s[0], s[1]])]);
  }
  // evenements du niveau qui font des particules (LevelEvent) : 3002 etincelles du paratonnerre (ParticleUtils.spawnParticlesAlongAxis)
  particulesNiveau(code, p, donnee) {
    if (code === 3002) {
      // ParticleUtils.spawnParticlesAlongAxis (Horizon particles.rs along_axis) : 10 a 19 etincelles, +-0,5 le long de l'axe, +-0,125 a cote,
      // vitesse -1..1 le long de l'axe
      const h = this.hasard, axe = donnee, n = 10 + h.entierBorne(10), entre = () => h.reel() * 2 - 1;
      for (let i = 0; i < n; i++) {
        const c = [0, 1, 2].map((a) => p[a] + 0.5 + entre() * (a === axe ? 0.5 : 0.125));
        const v = [0, 1, 2].map((a) => (a === axe ? entre() : 0));
        this.particule('electric_spark', c[0], c[1], c[2], v[0], v[1], v[2], 1);
      }
    }
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
    this.horloge = t - 1;
    // 0. commandes datees et debut de tick
    if (this.reg.aMonde('debutTick')) this.reg.lancerMonde('debutTick', evenement({ tick: t }), this.api);
    this._commandes();
    this.horloge = t;                             // tickTime : l'heure du jeu passe au tick t
    // 2. ticks planifies de blocs
    this.enTick = true;
    const dus = this.file.collecter(t, MAX_PAR_TICK);
    this.enAttente.clear();
    for (const x of dus) this.enAttente.add(this.file.cle(x.type, x.x, x.y, x.z));
    for (const x of dus) {
      this.enAttente.delete(this.file.cle(x.type, x.x, x.y, x.z));
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
    // 3. meteo (precipitations, foudre : avant les ticks aleatoires, comme tickChunk) puis ticks aleatoires dans la region active
    if (this.meteo) this.meteo.tick();
    this._suivreRegion();
    this._aleatoires();
    this.enTick = false;
    // 4. evenements de blocs (pistons, blocs musicaux, cloches) : ceux ajoutes pendant la boucle sont traites dans la meme phase
    this._evenementsBlocs();
    // 5. entites : les acteurs (intentions, marche, interactions) ; leurs blocs touches (plaques) sont traites a la fin de leur deplacement
    if (this.acteurs) this.acteurs.tick();
    if (this.entites.liste.length) this.entites.tick();
    if (this.meteo) this.meteo.tickEclairs();
    this.vibrations.tick(); this.boss.tick();
    // 6. blocs a entite qui changent des blocs (pistons en mouvement) : apres les entites ; fours
    if (this.contenus.m.size) this.fours.tick();
    if (this.alambics?.m.size) this.alambics.tick();   // alambics (alambic.js, partie 26)
    if (this.reg.aMonde('tickBlocsEntites')) this.reg.lancerMonde('tickBlocsEntites', evenement({ tick: t }), this.api);
    // 8. fin de tick
    if (this.reg.aMonde('finTick')) this.reg.lancerMonde('finTick', evenement({ tick: t }), this.api);
    this._ecrireReplay();
  }

  // ServerLevel.blockEvent : file dedoublonnee (meme position, bloc, a, b)
  evenementBloc(x, y, z, a = 0, b = 0) {
    const bloc = this.blocIdx(x, y, z);
    if (bloc < 0) return false;
    if (this.evBlocs.some((e) => e.x === x && e.y === y && e.z === z && e.bloc === bloc && e.a === a && e.b === b)) return false;
    this.evBlocs.push({ x, y, z, bloc, a, b });
    return true;
  }
  _evenementsBlocs() {
    let garde = 0;
    while (this.evBlocs.length) {
      if (garde++ > 100000) { this.avertir("trop d'evenements de blocs dans un tick : coupe"); this.evBlocs.length = 0; break; }
      const k = this.evBlocs.shift();
      const e = this.monde.etatEn(k.x, k.y, k.z);
      if (e < 0 || this.d.blocDe(e) !== k.bloc || !this.reg.a('declenche', k.bloc)) continue;
      this.stats.evenements++;
      this.reg.lancerBloc('declenche', k.bloc, evenement({ pos: [k.x, k.y, k.z], etat: this.d.chaine(e), bloc: this.d.nomBloc(e), a: k.a, b: k.b }), this.api);
    }
  }

  _commandes() {
    const c = this.cmds;
    while (this.iCmd < c.length && c[this.iCmd].tick <= this.temps) {
      const k = c[this.iCmd++];
      if (k.tipo === 'alimente') this.alimenter(k.x, k.y, k.z, !!k.bloc);
      else if (k.tipo === 'allume') this.allumer(k.x, k.y, k.z, {});
      else if (k.tipo === 'frappe') this.evenementPerso('redstone.cible', { pos: [k.x, k.y, k.z], force: k.bloc, fleche: false });
      else if (k.tipo === 'page') this.evenementPerso('pupitre.page', { pos: [k.x, k.y, k.z], page: k.bloc });   // pupitre : tourner la page (familles/machines.js)
      else if (k.tipo === 'explose') this.exploser(k.x + 0.5, k.y + 0.5, k.z + 0.5, { puissance: k.bloc });
      else this.poser(k.x, k.y, k.z, k.bloc, F.TOUS);
    }
    // contenu de depart d'un conteneur que la scene pose elle-meme a t = 0 (monde.blocs) : rempli juste apres sa pose
    if (this.contenusEnAttente) { const l = this.contenusEnAttente; this.contenusEnAttente = null; this.contenus.initial(l); }
  }

  _aleatoires() {
    let vitesse = this.regles.valeur('monde.ticksAleatoires', 3);
    if (!vitesse || !this.regionSections.length || !this.aTickAleatoire) return;
    const accel = this.regles.valeur('croissance.vitesse', 1);   // lapse de temps : plus de ticks aleatoires par section (famille croissance)
    let reste = 0;
    if (accel !== 1) { vitesse *= accel; reste = vitesse - Math.floor(vitesse); vitesse = Math.floor(vitesse); }
    for (const [sx, sy, sz] of this.regionSections) {
      const nb = vitesse + (reste > 0 && this.hasard.reel() < reste ? 1 : 0);
      for (let i = 0; i < nb; i++) {
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
  // La region active suit les joueurs (le jeu charge les chunks autour d'eux) : un joueur simule qui entre dans une nouvelle section de 16 y
  // ajoute ses +-48 blocs (on n'en retire jamais : un monde deja reveille continue de pousser). Les creatures ne chargent rien (comme le jeu).
  _suivreRegion() {
    if (!this.acteurs) return;
    const vus = (this._sectionsJoueurs ??= new Set());
    let ajout = false;
    for (const a of this.acteurs.liste) {
      if (a.typeCreature || a.mort >= 0) continue;
      const k = `${Math.floor(a.x / 16)},${Math.floor(a.y / 16)},${Math.floor(a.z / 16)}`;
      if (vus.has(k)) continue;
      vus.add(k);
      if (vus.size > 1 || this.temps > 0) { this.region.push([a.x, a.y, a.z]); ajout = true; }
    }
    if (ajout) this._calculerRegion();
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
    // PoiManager : un lit, un bloc de metier ou une cloche pose ou casse est connu des villageois tout de suite (listes de POI a refaire)
    if (this._poiCache?.size) for (let i = 0; i < c.length; i += 5) if (poiChange(this, c[i], c[i + 1], c[i + 2])) { this._poiCache.clear(); break; }
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
    for (const [t, verbe, x, y, z, v] of cfg.cmd || []) if (verbe === 'alimente' || verbe === 'allume' || verbe === 'explose' || verbe === 'frappe' || verbe === 'page') this.cmds.push({ tick: Math.floor(t * 20 * ralenti + 1e-9), x, y, z, bloc: v, tipo: verbe, i: this.cmds.length });
    this.cmds.sort((p, q) => p.tick - q.tick || p.i - q.i);
    this.iCmd = 0;
    this.region = this.cmds.map((c) => [c.x, c.y, c.z]);
    if (this.acteurs) for (const a of this.acteurs.liste) this.region.push([a.x, a.y, a.z]);
    this.aTickAleatoire = this.reg.entrees.some((e) => e.genre === 'bloc' && e.evt === 'tickAleatoire');
    this._calculerRegion();
    this.reg.figer();
    this.redstone.hookSignal = this.reg.aMonde('redstone.signal');
    // un conteneur pose par monde.blocs a t = 0 n'existe pas encore : son contenu attend la pose (_commandes, tick 0)
    const poseA0 = new Set(this.cmds.filter((k) => k.tick === 0 && !k.tipo).map((k) => `${k.x},${k.y},${k.z}`));
    const contenus = cfg.contenus || [];
    this.contenusEnAttente = contenus.filter(([x, y, z]) => poseA0.has(`${x},${y},${z}`));
    if (!this.contenusEnAttente.length) this.contenusEnAttente = null;
    this.contenus.initial(contenus.filter(([x, y, z]) => !poseA0.has(`${x},${y},${z}`)));
    for (const [x, y, z, livre, pages, page] of cfg.pupitres ?? []) {   // pupitres de depart : le livre pose (has_book) et sa page
      if (this.monde.etatEn(x, y, z) < 0 || this.d.nomBloc(this.monde.etatEn(x, y, z)) !== 'lectern') { this.avertir(`monde.pupitres : pas de pupitre en ${x},${y},${z}`); continue; }
      this.evenementPerso('pupitre.livre', { pos: [x, y, z], livre: String(livre).replace(/^minecraft:/, ''), pages, page: page ?? 0 });
      const e = this.monde.etatEn(x, y, z); this.monde.ecrire(x, y, z, this.monde.indicePaletteEtat(this.d.avec(e, 'has_book', 'true')));
    }
    this.redstone.amorcer();
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
