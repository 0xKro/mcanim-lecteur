// Replay : ce que la simulation a produit, en tableaux compacts. La simulation tourne AVANT le rendu ; le rendu rejoue.
//   blocs     : journal trie par tick : (tick, x, y, z, ancien indice de palette, nouvel indice de palette)
//   palAjouts : textes d'etat ajoutes a la palette de la zone (indices zone.palette.length, +1, ...)
//   sons      : (tick, indice du nom, x, y, z, volume, hauteur)   particules : (tick, indice du nom, x, y, z, vx, vy, vz, nombre)
//   textes    : lignes du rapport (tick, texte)
// Le replay se serialise en octets (stable : meme scene, meme graine = memes octets) ; son SHA-256 sert de preuve de determinisme.
import crypto from 'node:crypto';

class Colonne {   // tableau typÃ© qui grandit
  constructor(Type, nb) { this.Type = Type; this.nb = nb; this.a = new Type(1024 * nb); this.n = 0; }
  pousser(...v) {
    if ((this.n + 1) * this.nb > this.a.length) { const b = new this.Type(this.a.length * 2); b.set(this.a); this.a = b; }
    for (let i = 0; i < this.nb; i++) this.a[this.n * this.nb + i] = v[i];
    this.n++;
  }
  vue() { return this.a.subarray(0, this.n * this.nb); }
}

export class Replay {
  constructor({ graine = 1, ticks = 0, ralenti = 1, moteur = 1 } = {}) {
    this.graine = graine; this.ticks = ticks; this.ralenti = ralenti; this.moteur = moteur;
    this.palAjouts = []; this.noms = []; this.nomIdx = new Map();
    this._blocs = new Colonne(Int32Array, 6); this._sons = new Colonne(Float64Array, 7); this._parts = new Colonne(Float64Array, 9);
    this._act = new Colonne(Float64Array, 16); this._bev = new Colonne(Float64Array, 8);   // acteurs (un enregistrement par acteur et par tick), evenements de blocs a entite (coffre, cloche...)
    this._ent = new Colonne(Float64Array, 8);
    this._ia = new Colonne(Float64Array, 8);   // creatures a IA : [tick, indice, drapeaux, gonflement, tension, debut d'attaque, tangage du corps, direction du lit] (rien sans elles)   // entites (TNT amorce, blocs qui tombent) : un enregistrement par entite et par tick
    this._iax = new Colonne(Float64Array, 8);   // creatures a IA a etat riche (wither, dragon, gardiens, warden, calmars) : [tick, indice, 6 valeurs] (rien sans elles)
    this.obscurite = [];                         // effet Obscurite recu par un joueur (warden) : { debut, fin, acteur } ; le film assombrit l'image
    this.traits = [];                          // rayons dessines entre deux points : { tick, type, de, vers, a } (laser du gardien, rayon du cristal de l'End)
    this.acteurs = []; this.actes = [];
    // entites nees pendant la simulation (moteur/acteurs.js naitre : bebes, conversions, golems) et bebes devenus adultes ; rien sans elles
    this.naissances = []; this.croissances = [];   // noms des acteurs simules ; journal des intentions { tick, acteur, verbe, args, statut, texte }
    this.textes = []; this.avertissements = []; this.stats = {};
    this.mods = [];
    // souffles d'explosion recus par les acteurs (pour le pantin du film, docs/SIMULATION.md partie 21) : { tick, i, v (poussee), m (moment), sol } ; rien sans eux
    this.souffles = [];
    // vol plane aux elytres (moteur/acteurs.js) : [tick, indice d'acteur, vx, vy, vz, ticks de vol] par tick plane ; rien sans lui
    this.vols = [];
    // blocs et machines (docs/SIMULATION.md partie 27) ; rien sans eux : montures prises et quittees { tick, cavalier, vehicule|null }, vehicules
    // [tick, indice d'acteur, lacet du jeu, tangage, secousse, degats x sens, meche, angle des bulles], balises { x, y, z, d: [[tick, sections]] }
    // (sections [[couleur, hauteur], ...] a chaque changement), cadres { id, x, y, z, face, d: [[tick, objet, rotation]] }, pupitres { x, y, z, d: [[tick, livre, page, pages]] }
    this.montures = []; this.vehicules = []; this.balises = []; this.cadres = []; this.pupitres = [];
  }
  // vehicule : [tick, indice, lacet du rendu (jeu), tangage du rendu, secousse (hurtTime), degats x sens, meche, angle des bulles, decalage x, y, z du rendu sur le rail]
  vehicule(tick, i, yaw, pitch, secousse, degats, meche, bulle, dx = 0, dy = 0, dz = 0, wagon = 1) { const r = (x) => Math.round(x * 1e4) / 1e4; this.vehicules.push([tick, i, r(yaw), r(pitch), secousse, r(degats), meche, r(bulle), r(dx), r(dy), r(dz), wagon]); }
  vol(tick, i, vx, vy, vz, n) { const r = (x) => Math.round(x * 1e6) / 1e6; this.vols.push([tick, i, r(vx), r(vy), r(vz), n]); }
  souffle(tick, i, v, m, sol = 0) { const r = (x) => Math.round(x * 1e5) / 1e5; this.souffles.push({ tick, i, v: v.map(r), m: m.map(r), sol }); }
  nom(n) { let i = this.nomIdx.get(n); if (i === undefined) { i = this.noms.length; this.noms.push(n); this.nomIdx.set(n, i); } return i; }
  bloc(tick, x, y, z, ancien, nouveau) { this._blocs.pousser(tick, x, y, z, ancien, nouveau); }
  son(tick, nom, x, y, z, volume = 1, hauteur = 1) { this._sons.pousser(tick, this.nom(nom), x, y, z, volume, hauteur); }
  particule(tick, nom, x, y, z, vx = 0, vy = 0, vz = 0, nombre = 1) { this._parts.pousser(tick, this.nom(nom), x, y, z, vx, vy, vz, nombre); }
  texte(tick, t) { this.textes.push([tick, String(t)]); }
  // acteur : [tick, indice, x, y, z, lacet, lacetTete, tangage, drapeaux, balancement (0..1), cassage (-1 ou 0..1), objet (indice de nom ou -1), phaseMembres, amplitudeMembres, 0, 0]
  acteur(tick, i, x, y, z, lacet, lacetTete, tangage, drapeaux, balancement, cassage, objet, phase, amplitude, blessure = 0, mort = 0) { this._act.pousser(tick, i, x, y, z, lacet, lacetTete, tangage, drapeaux, balancement, cassage, objet, phase, amplitude, blessure, mort); }
  // evenement de bloc a entite : (tick, x, y, z, indice du type, a, b, c) ; types : 'coffre' (a = nombre de visiteurs), 'cloche' (a = direction 0..5 du coup)
  blocEntite(tick, type, x, y, z, a = 0, b = 0, c = 0) { this._bev.pousser(tick, x, y, z, this.nom(type), a, b, c); }
  // entite : [tick, id, indice du type, x, y, z, meche, indice de palette du bloc (-1 : aucun)]
  entite(tick, id, type, x, y, z, a = 0, b = -1) { this._ent.pousser(tick, id, this.nom(type), x, y, z, a, b); }
  ia(tick, i, drapeaux, gonfle, tension, attaque, tangage = 0, lit = 0) { this._ia.pousser(tick, i, drapeaux, gonfle, tension, attaque, tangage, lit); }
  get iaVue() { return this._ia.vue(); }
  iaPlus(tick, i, a = 0, b = 0, c = 0, d = 0, e = 0, f = 0) { this._iax.pousser(tick, i, a, b, c, d, e, f); }
  get iaPlusVue() { return this._iax.vue(); }
  trait(tick, type, de, vers, a = 0) { this.traits.push({ tick, type, de: de.map((v) => Math.round(v * 1000) / 1000), vers: vers.map((v) => Math.round(v * 1000) / 1000), a }); }
  acte(tick, acteur, verbe, args, statut, texte, fin = tick) { this.actes.push({ tick, fin, acteur, verbe, args, statut, texte }); }
  get nbBlocs() { return this._blocs.n; }
  get blocs() { return this._blocs.vue(); }      // 6 entiers par changement
  get sons() { return this._sons.vue(); }        // 7 reels par son
  get particules() { return this._parts.vue(); } // 9 reels par particule
  get acteursVue() { return this._act.vue(); }    // 16 reels par enregistrement d'acteur
  get blocsEntite() { return this._bev.vue(); }
  get entitesVue() { return this._ent.vue(); }    // 8 reels par enregistrement d'entite   // 8 reels par evenement

  // Premier index du journal (changement numero k) dont le tick est > tick : les changements [0, k[ ont eu lieu au tick donne ou avant.
  indiceApres(tick) {
    const b = this.blocs, n = this._blocs.n;
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (b[mid * 6] <= tick) lo = mid + 1; else hi = mid; }
    return lo;
  }
  // tick du monde pour un temps de film (secondes) : 20 ticks par seconde x ralenti
  tickDe(t) { return Math.floor(t * 20 * this.ralenti + 1e-9); }

  // octets stables du replay
  octets() {
    const entete = Buffer.from(JSON.stringify({ moteur: this.moteur, graine: this.graine, ticks: this.ticks, ralenti: this.ralenti, palAjouts: this.palAjouts, noms: this.noms, textes: this.textes, mods: this.mods, n: [this._blocs.n, this._sons.n, this._parts.n, this._act.n, this._bev.n], ...(this.acteurs.length ? { acteurs: this.acteurs, actes: this.actes } : {}), ...(this._ent.n ? { ne: this._ent.n } : {}), ...(this._ia.n ? { ni: this._ia.n } : {}), ...(this.naissances.length ? { naissances: this.naissances } : {}), ...(this.croissances.length ? { croissances: this.croissances } : {}), ...(this._iax.n ? { nx: this._iax.n } : {}), ...(this.traits.length ? { traits: this.traits } : {}), ...(this.obscurite.length ? { obscurite: this.obscurite } : {}), ...(this.souffles.length ? { souffles: this.souffles } : {}), ...(this.vols.length ? { vols: this.vols } : {}), ...(this.montures.length ? { montures: this.montures } : {}), ...(this.vehicules.length ? { vehicules: this.vehicules } : {}), ...(this.balises.length ? { balises: this.balises } : {}), ...(this.cadres.length ? { cadres: this.cadres } : {}), ...(this.pupitres.length ? { pupitres: this.pupitres } : {}), ...(this.visionNuit?.length ? { visionNuit: this.visionNuit } : {}), ...(this.ecrans?.length ? { ecrans: this.ecrans } : {}), ...(this.visions?.length ? { visions: this.visions } : {}), ...(this.armures?.length ? { armures: this.armures } : {}), ...(this.peche?.length ? { peche: this.peche } : {}), ...(this.etats?.length ? { etats: this.etats } : {}), ...(this.totems?.length ? { totems: this.totems } : {}) }), 'utf8');   // objets (partie 26) : ecrans, vue, armure, fil de peche, vie et faim
    const l = Buffer.alloc(4); l.writeUInt32LE(entete.length);
    const tab = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
    return Buffer.concat([Buffer.from('MCR1'), l, entete, tab(this.blocs), tab(this.sons), tab(this.particules), tab(this.acteursVue), tab(this.blocsEntite), ...(this._ent.n ? [tab(this.entitesVue)] : []), ...(this._ia.n ? [tab(this.iaVue)] : []), ...(this._iax.n ? [tab(this.iaPlusVue)] : [])]);
  }
  sha256() { return crypto.createHash('sha256').update(this.octets()).digest('base64url'); }
}

// Passage du replay d'un processus a l'autre (simulation isolee des mods : moteur/isolement.js) : copie structuree (v8) de TOUS les champs,
// les colonnes typees en { Type, nb, a, n }. Generique : un champ ajoute plus tard au replay passe sans rien changer ici.
const TYPES = { Int32Array, Float64Array, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int16Array, Int8Array };
export function replayVersObjet(r) {
  const o = {};
  for (const [k, v] of Object.entries(r)) o[k] = v instanceof Colonne ? { __colonne: v.Type.name, nb: v.nb, a: v.vue().slice(), n: v.n } : v;
  return o;
}
export function replayDepuisObjet(o) {
  const r = Object.create(Replay.prototype);
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object' && typeof v.__colonne === 'string') {
      const Type = TYPES[v.__colonne];
      if (!Type) throw new Error('replay : colonne de type inconnu ' + v.__colonne);
      const c = new Colonne(Type, v.nb);
      if (v.a.length > c.a.length) c.a = new Type(v.a.length);
      c.a.set(v.a); c.n = v.n;
      r[k] = c;
    } else r[k] = v;
  }
  return r;
}
