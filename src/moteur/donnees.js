// Tables de donnees du jeu (nos tables compactes, faites par outils/extraire-donnees-jeu.mjs) : proprietes des blocs par etat.
// Un etat de bloc = un numero (comme le registre du jeu). Le texte canonique `minecraft:nom[prop=val,...]` (proprietes triees par
// nom) est celui de la palette des fichiers .mcz. Les tables se chargent depuis un fichier local ou le relais (voir obtenirDonneesJeu).
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

// Bits de `drapeaux` (meme ordre que `bits` dans le fichier)
export const D = {
  REMPLACABLE: 1, TICK_ALEATOIRE: 2, RENDU_PLEIN: 4, LIQUIDE: 8, ENTITE_BLOC: 16, ALLUME_PAR_LAVE: 32, PEUT_OCCLURE: 64,
  COLLISION_PLEINE: 128, CIEL_DESCEND: 256, OUTIL_REQUIS: 512, OCCLUSION_FORME: 1024,
};
export const FACES = ['bas', 'haut', 'nord', 'sud', 'ouest', 'est'];   // ordre du jeu (Direction) : bas, haut, nord, sud, ouest, est

export class Donnees {
  constructor(j) {
    if (j.v !== 1) throw new Error(`donnees-jeu : version ${j.v} non geree (le lecteur attend 1)`);
    this.j = j;
    this.nbEtats = j.nbEtats;
    this.noms = j.noms;
    this.parNom = new Map(j.noms.map((n, b) => [n, b]));
    // debut de chaque bloc dans la numerotation des etats + pas de chaque propriete
    const nb = j.noms.length;
    this.debut = new Int32Array(nb + 1);
    this.pas = new Array(nb);
    let a = 0;
    for (let b = 0; b < nb; b++) {
      this.debut[b] = a;
      const sch = j.schemas[j.schemaBloc[b]];
      const pas = new Array(sch.length);
      let p = 1;
      for (let k = sch.length - 1; k >= 0; k--) { pas[k] = p; p *= sch[k][1].length; }
      this.pas[b] = pas;
      a += p;
    }
    this.debut[nb] = a;
    if (a !== this.nbEtats) throw new Error('donnees-jeu : nombre d\'etats incoherent');
    // bloc de chaque etat
    this.blocDeEtat = new Uint16Array(a);
    for (let b = 0; b < nb; b++) this.blocDeEtat.fill(b, this.debut[b], this.debut[b + 1]);
    // tables par etat (depliees depuis les lignes distinctes)
    const idx = new Uint16Array(Buffer.from(j.etatLigne, 'base64').buffer.slice(0));
    const L = j.lignes, c = Object.fromEntries(j.champsLigne.map((n, i) => [n, i]));
    this.emissionE = new Uint8Array(a); this.opaciteE = new Uint8Array(a); this.drapeauxE = new Uint16Array(a);
    this.dureteE = new Float32Array(a); this.resistanceE = new Float32Array(a); this.frictionE = new Float32Array(a);
    // Block.getSpeedFactor / getJumpFactor (flottants du jeu : sable des ames 0,4 ; bloc de miel 0,4 et 0,5 ; les autres 1)
    this.vitesseE = new Float32Array(a); this.sautE = new Float32Array(a);
    this.formeE = new Int16Array(a); this.sonE = new Uint8Array(a); this.solideE = new Uint32Array(a);
    this.faibleE = new Uint32Array(a); this.fortE = new Uint32Array(a); this.fluideE = new Uint8Array(a); this.pousseeE = new Uint8Array(a);
    this.niveauFluideE = new Uint8Array(a); this.instrumentE = new Uint8Array(a); this.jeuE = new Uint8Array(a);   // jeuE : drapeaux du jeu (bit 0 plein, 1 air, 2 conduit la redstone, 3 source de signal, 4 sortie analogique)
    for (let i = 0; i < a; i++) {
      const l = L[idx[i]];
      this.emissionE[i] = l[c.emission]; this.opaciteE[i] = l[c.opacite]; this.drapeauxE[i] = l[c.drapeaux];
      this.dureteE[i] = l[c.durete]; this.resistanceE[i] = l[c.resistance]; this.frictionE[i] = l[c.friction];
      this.vitesseE[i] = c.vitesse !== undefined ? l[c.vitesse] : 1; this.sautE[i] = c.saut !== undefined ? l[c.saut] : 1;
      this.formeE[i] = l[c.forme]; this.sonE[i] = l[c.son]; this.solideE[i] = l[c.solide]; this.faibleE[i] = l[c.faible]; this.fortE[i] = l[c.fort];
      this.instrumentE[i] = l[c.instrument]; this.jeuE[i] = l[c.drapeauxJeu]; this.fluideE[i] = l[c.fluide]; this.niveauFluideE[i] = l[c.niveauFluide]; this.pousseeE[i] = l[c.poussee];
    }
    this._etiq = new Map();
    this.copies = new Map();                     // bloc du jeu -> blocs de mods qui le copient (mc.definirBloc, moteur/perso.js)
    this.air = this.etatId('air');
    this.pierre = this.etatId('stone');
  }

  // ---- identifiants
  idBloc(nom) { return this.parNom.get(nom.startsWith('minecraft:') ? nom.slice(10) : nom) ?? -1; }
  blocDe(id) { return this.blocDeEtat[id]; }
  // nom du COMPORTEMENT : un bloc de mod (mc.definirBloc) repond par le nom du bloc qu'il copie (les familles le traitent comme lui) ; son
  // identifiant reste dans chaine(id) (palette, rendu, replay)
  nomBloc(id) { const b = this.blocDeEtat[id]; return this.alias?.get(b) ?? this.noms[b]; }
  // classes de comportement du bloc (la plus derivee d'abord), ex. ['DoorBlock', 'Block']
  classes(bloc) { return this.j.chaines[this.j.chaineBloc[bloc]].map((i) => this.j.classes[i]); }
  champsBloc(bloc) { return this.j.champs[bloc] ?? null; }
  schema(bloc) { return this.j.schemas[this.j.schemaBloc[bloc]]; }

  // 'minecraft:oak_door[facing=north,half=lower]' (proprietes dans n'importe quel ordre, absentes = valeur par defaut) -> numero d'etat, ou -1
  etatId(txt) {
    const i = txt.indexOf('[');
    const nom = i < 0 ? txt : txt.slice(0, i);
    const b = this.idBloc(nom);
    if (b < 0) return -1;
    let k = this.j.defauts[b];
    if (i >= 0) {
      if (!txt.endsWith(']')) return -1;
      const sch = this.schema(b), pas = this.pas[b];
      // on part de l'etat par defaut et on remplace chaque propriete donnee
      for (const kv of txt.slice(i + 1, -1).split(',')) {
        if (!kv) continue;
        const e = kv.indexOf('=');
        const p = sch.findIndex(([n]) => n === kv.slice(0, e));
        if (p < 0) return -1;
        const v = sch[p][1].indexOf(kv.slice(e + 1));
        if (v < 0) return -1;
        const actuel = Math.floor(k / pas[p]) % sch[p][1].length;
        k += (v - actuel) * pas[p];
      }
    }
    return this.debut[b] + k;
  }
  // numero d'etat -> texte canonique
  chaine(id) {
    const b = this.blocDeEtat[id], sch = this.schema(b);
    const ns = this.noms[b].includes(':') ? this.noms[b] : 'minecraft:' + this.noms[b];   // blocs definis par un mod (mc.definirBloc) : 'ville:tnt_bleue'
    if (!sch.length) return ns;
    const k = id - this.debut[b], pas = this.pas[b];
    return `${ns}[${sch.map(([n, v], p) => `${n}=${v[Math.floor(k / pas[p]) % v.length]}`).join(',')}]`;
  }
  // proprietes de l'etat : { facing: 'north', ... }
  props(id) {
    const b = this.blocDeEtat[id], sch = this.schema(b), k = id - this.debut[b], pas = this.pas[b], o = {};
    sch.forEach(([n, v], p) => { o[n] = v[Math.floor(k / pas[p]) % v.length]; });
    return o;
  }
  prop(id, nom) {
    const b = this.blocDeEtat[id], sch = this.schema(b), p = sch.findIndex(([n]) => n === nom);
    if (p < 0) return undefined;
    return sch[p][1][Math.floor((id - this.debut[b]) / this.pas[b][p]) % sch[p][1].length];
  }
  // meme etat avec une propriete changee (id inchange si la propriete ou la valeur n'existe pas)
  avec(id, nom, valeur) {
    const b = this.blocDeEtat[id], sch = this.schema(b), p = sch.findIndex(([n]) => n === nom);
    if (p < 0) return id;
    const v = sch[p][1].indexOf(String(valeur));
    if (v < 0) return id;
    const pas = this.pas[b][p], n = sch[p][1].length;
    const actuel = Math.floor((id - this.debut[b]) / pas) % n;
    return id + (v - actuel) * pas;
  }
  // instrument du bloc de bois musical pose DESSUS-DESSOUS (NoteBlockInstrument.byState), en minuscules : 'harp', 'basedrum'...
  instrument(id) { return String(this.j.instruments[this.instrumentE[id]]).toLowerCase(); }
  // regles de l'outil `nom` (composant minecraft:tool) : { r: [[selecteurs, butinOk (1/0/-1), vitesse|null]], d, u } ou null
  outil(nom) { return this.j.outils?.[String(nom).replace(/^minecraft:/, '').replace(/\[.*$/, '')] ?? null; }   // composants (enchantements, usure) ignores
  // objets du jeu (phase 7) : nourriture [nutrition, saturation, toujours, ticks, 'eat'|'drink', rendu, effets], combustible (ticks), cuisson [resultat, ticks, xp],
  // arbre (caracteristique de generation simplifiee), biome [temperature, precipitation, gele]
  aliment(nom) { return this.j.aliments?.[String(nom).replace(/^minecraft:/, '').replace(/\[.*$/, '')] ?? null; }
  combustible(nom) { return this.j.combustibles?.[String(nom).replace(/^minecraft:/, '')] ?? 0; }
  cuisson(nom) { return this.j.cuisson?.[String(nom).replace(/^minecraft:/, '')] ?? null; }
  arbre(nom) { return this.j.arbres?.[nom] ?? null; }
  // taille de pile du composant `max_stack_size` (table entiere du jeu ; 64 pour un objet absent : docs/SIMULATION.md partie 27)
  pileMax(nom) { return this.j.piles?.[String(nom).replace(/^minecraft:/, '')] ?? 64; }
  // fours : recette du bloc ('furnace' smelting, 'blast_furnace' blasting, 'smoker' smoking) ; combustion et vitesse du combustible (four rapide : haut fourneau, fumoir)
  recetteFour(bloc, nom) { const n = String(nom).replace(/^minecraft:/, ''); return bloc === 'blast_furnace' ? this.j.fours?.hautFourneau?.[n] ?? null : bloc === 'smoker' ? this.j.fours?.fumoir?.[n] ?? null : this.cuisson(n); }
  combustionFour(nom, rapide) { const n = String(nom).replace(/^minecraft:/, ''); return rapide ? this.j.fours?.rapide?.[n] ?? 0 : this.combustible(n); }
  vitesseCombustible(nom, rapide) { const v = this.j.fours?.vitesse?.[String(nom).replace(/^minecraft:/, '')] ?? this.j.fours?.vitesseDefaut ?? [1, 2]; return rapide ? v[1] : v[0]; }
  biome(nom) { return this.j.biomes?.[String(nom || '').replace(/^minecraft:/, '')] ?? null; }
  etatParDefaut(bloc) { return this.debut[bloc] + this.j.defauts[bloc]; }

  // ---- proprietes d'un etat
  emission(id) { return this.emissionE[id]; }
  opacite(id) { return this.opaciteE[id]; }                      // lumiere arretee par le bloc (0 a 15)
  drapeaux(id) { return this.drapeauxE[id]; }
  a(id, bit) { return (this.drapeauxE[id] & bit) !== 0; }
  durete(id) { return this.dureteE[id]; }
  resistance(id) { return this.resistanceE[id]; }
  friction(id) { return this.frictionE[id]; }
  facteurVitesse(id) { return id >= 0 ? this.vitesseE[id] : 1; }   // Block.getSpeedFactor (flottant)
  facteurSaut(id) { return id >= 0 ? this.sautE[id] : 1; }         // Block.getJumpFactor (flottant)
  boites(id) { const f = this.formeE[id]; return f < 0 ? [] : this.j.formes[f]; }
  // appui sur une face : 0 bas, 1 haut, 2 nord, 3 sud, 4 ouest, 5 est ; type 0 = face pleine, 1 = centre seulement, 2 = rigide (3 jeux de 6 bits)
  solideFace(id, face, type = 0) { return (this.solideE[id] & (1 << (type * 6 + face))) !== 0; }
  // drapeaux du jeu (BlockStateBase) : conduit la redstone (`isRedstoneConductor`), est une source de signal, a une sortie analogique (comparateur)
  conducteur(id) { return (this.jeuE[id] & 4) !== 0; }
  sourceSignal(id) { return (this.jeuE[id] & 8) !== 0; }
  sortieAnalogique(id) { return (this.jeuE[id] & 16) !== 0; }
  esAir(id) { return (this.jeuE[id] & 2) !== 0; }
  // BlockState.isSolid (legacySolid du jeu : forceSolidOn/Off puis la boite de collision, taille moyenne >= 0,7291666 ou hauteur pleine) : bit 0 du drapeau du jeu
  estSolide(id) { return (this.jeuE[id] & 1) !== 0; }
  // Navigation du jeu (partie 28) : PathType de l'etat (WalkNodeEvaluator.getPathTypeFromState) et isPathfindable (bit 0 LAND, 1 WATER, 2 AIR)
  _chemins() {
    if (!this._ch) {
      const c = this.j.chemins;
      if (!c) throw new Error('donnees-jeu : table `chemins` absente (relance outils/extraire-donnees-jeu.mjs)');
      this._ch = { types: c.types, e: new Uint8Array(Buffer.from(c.etat, 'base64')), d: new Uint8Array(Buffer.from(c.drap, 'base64')), h: new Uint8Array(Buffer.from(c.haut ?? '', 'base64')) };
    }
    return this._ch;
  }
  typeChemin(id) { const c = this._chemins(); return c.types[c.e[id]]; }
  cheminPossible(id, quoi = 0) { return (this._chemins().d[id] & (1 << quoi)) !== 0; }
  hautCollision(id) { const c = this._chemins(); return c.h.length ? c.h[id] / 64 : (this.boites(id).length ? Math.max(...this.boites(id).map((b) => b[4])) : 0); }   // haut de la forme de collision
  // Lumiere (partie 28) : forme d'occlusion de l'etat (getOcclusionShape) si le jeu s'en sert pour la lumiere (useShapeForLightOcclusion), sinon null
  formeOcclusion(id) {
    const o = this.j.occlusion;
    if (!o) return null;
    if (!this._occ) this._occ = new Int16Array(new Uint8Array(Buffer.from(o.etat, 'base64')).buffer);
    const k = this._occ[id];
    return k < 0 ? null : o.formes[k];
  }
  signalFaible(id) { return this.faibleE[id]; }
  signalFort(id) { return this.fortE[id]; }
  fluide(id) { return this.fluideE[id]; }                         // 0 aucun, 1 eau qui coule, 2 eau, 3 lave qui coule, 4 lave
  son(id) { const s = this.j.sons[this.sonE[id]]; return { casse: s[0], pas: s[1], pose: s[2], coup: s[3], chute: s[4], volume: s[5], hauteur: s[6] }; }
  poussee(id) { return this.j.push[this.pousseeE[id]]; }
  // numeros de blocs d'une etiquette ('minecraft:doors' ou 'doors'), Set vide si inconnue
  etiquette(nom) {
    const n = nom.replace(/^#?(minecraft:)?/, '');
    let s = this._etiq.get(n);
    if (!s) { s = new Set(this.j.etiquettes[n] ?? []); this._etiq.set(n, s); }
    return s;
  }
  // chances d'allumage / de combustion du bloc (table du feu), 0 si non inflammable
  feu(bloc) { return [this.j.feu.allume[bloc] ?? 0, this.j.feu.brule[bloc] ?? 0]; }
}

// ---------------------------------------------------------------- chargement
export function depuisOctets(brut) {
  const octets = brut[0] === 0x1f && brut[1] === 0x8b ? zlib.gunzipSync(brut) : brut;
  const d = new Donnees(JSON.parse(octets.toString('utf8')));
  d.octets = brut;   // fichier tel quel : passe au processus fils des scenes avec mods (moteur/isolement.js)
  return d;
}
export function sha256Octets(b) { return crypto.createHash('sha256').update(b).digest('base64url'); }

let CACHE = null;
// Charge les tables depuis un fichier local (essais, outil) ; une seule fois par chemin.
export function chargerDonneesFichier(chemin) {
  if (CACHE && CACHE.chemin === chemin) return CACHE.d;
  const d = depuisOctets(fs.readFileSync(chemin));
  CACHE = { chemin, d };
  return d;
}
