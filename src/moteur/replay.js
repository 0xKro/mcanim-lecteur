// Replay : ce que la simulation a produit, en tableaux compacts. La simulation tourne AVANT le rendu ; le rendu rejoue.
//   blocs     : journal trie par tick : (tick, x, y, z, ancien indice de palette, nouvel indice de palette)
//   palAjouts : textes d'etat ajoutes a la palette de la zone (indices zone.palette.length, +1, ...)
//   sons      : (tick, indice du nom, x, y, z, volume, hauteur)   particules : (tick, indice du nom, x, y, z, vx, vy, vz, nombre)
//   textes    : lignes du rapport (tick, texte)
// Le replay se serialise en octets (stable : meme scene, meme graine = memes octets) ; son SHA-256 sert de preuve de determinisme.
import crypto from 'node:crypto';

class Colonne {   // tableau typé qui grandit
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
    this.textes = []; this.avertissements = []; this.stats = {};
    this.mods = [];
  }
  nom(n) { let i = this.nomIdx.get(n); if (i === undefined) { i = this.noms.length; this.noms.push(n); this.nomIdx.set(n, i); } return i; }
  bloc(tick, x, y, z, ancien, nouveau) { this._blocs.pousser(tick, x, y, z, ancien, nouveau); }
  son(tick, nom, x, y, z, volume = 1, hauteur = 1) { this._sons.pousser(tick, this.nom(nom), x, y, z, volume, hauteur); }
  particule(tick, nom, x, y, z, vx = 0, vy = 0, vz = 0, nombre = 1) { this._parts.pousser(tick, this.nom(nom), x, y, z, vx, vy, vz, nombre); }
  texte(tick, t) { this.textes.push([tick, String(t)]); }
  get nbBlocs() { return this._blocs.n; }
  get blocs() { return this._blocs.vue(); }      // 6 entiers par changement
  get sons() { return this._sons.vue(); }        // 7 reels par son
  get particules() { return this._parts.vue(); } // 9 reels par particule

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
    const entete = Buffer.from(JSON.stringify({ moteur: this.moteur, graine: this.graine, ticks: this.ticks, ralenti: this.ralenti, palAjouts: this.palAjouts, noms: this.noms, textes: this.textes, mods: this.mods, n: [this._blocs.n, this._sons.n, this._parts.n] }), 'utf8');
    const l = Buffer.alloc(4); l.writeUInt32LE(entete.length);
    const tab = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
    return Buffer.concat([Buffer.from('MCR1'), l, entete, tab(this.blocs), tab(this.sons), tab(this.particules)]);
  }
  sha256() { return crypto.createHash('sha256').update(this.octets()).digest('base64url'); }
}
