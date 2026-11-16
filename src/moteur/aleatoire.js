// Hasard du jeu : le generateur a congruence 48 bits de java.util.Random (le "LegacyRandom" de Horizon,
// horizon-core/src/random.rs, MIT : voir ATTRIBUTIONS.md). Seul hasard permis dans le moteur et dans les mods :
// jamais Math.random. Calcul en deux moities de 24 bits pour rester exact avec des nombres a virgule (pas de BigInt par tirage).
const M24 = 16777216;                 // 2^24
const MH = 0x5de, ML = 0xece66d;      // multiplicateur 0x5DEECE66D = MH * 2^24 + ML

export class Aleatoire {
  // graine : entier (jusqu'a 2^53) ou BigInt
  constructor(graine = 0) { this.defGraine(graine); }

  defGraine(graine) {
    const g = BigInt.asUintN(48, BigInt(graine) ^ 0x5deece66dn);
    this.hi = Number(g >> 24n); this.lo = Number(g & 0xffffffn);
    this.gauss = null;
  }

  // avance d'un pas et rend les `n` bits du haut (n <= 32), comme Random.next(bits)
  bits(n) {
    const pLo = this.lo * ML + 11;
    const lo = pLo % M24;
    const retenue = Math.floor(pLo / M24);
    const hi = (retenue + this.hi * ML + this.lo * MH) % M24;
    this.hi = hi; this.lo = lo;
    // etat >> (48 - n) : l'etat vaut hi * 2^24 + lo
    return Math.floor((hi * M24 + lo) / 2 ** (48 - n));
  }

  etat() { return BigInt(this.hi) * 16777216n + BigInt(this.lo); }

  entier() { return this.bits(32) | 0; }                                   // nextInt()

  // nextInt(borne) : 0 <= v < borne
  entierBorne(borne) {
    if (!(borne > 0)) throw new RangeError('borne doit etre positive');
    if ((borne & (borne - 1)) === 0) return Math.floor((borne * this.bits(31)) / 2147483648);
    for (;;) {
      const b = this.bits(31), v = b % borne;
      if (((b - v + (borne - 1)) | 0) >= 0) return v;
    }
  }

  booleen() { return this.bits(1) !== 0; }
  flottant() { return this.bits(24) / 16777216; }
  reel() { return (this.bits(26) * 134217728 + this.bits(27)) / 9007199254740992; }   // nextDouble()
  long() { return (BigInt(this.bits(32) | 0) << 32n) + BigInt(this.bits(32) | 0); }
  // entre `min` et `max` inclus
  entreInclus(min, max) { return this.entierBorne(max - min + 1) + min; }
  gaussien() {
    if (this.gauss !== null) { const g = this.gauss; this.gauss = null; return g; }
    let v1, v2, s;
    do { v1 = 2 * this.reel() - 1; v2 = 2 * this.reel() - 1; s = v1 * v1 + v2 * v2; } while (s >= 1 || s === 0);
    const k = Math.sqrt((-2 * Math.log(s)) / s);
    this.gauss = v2 * k;
    return v1 * k;
  }
}

// Generateur des ticks aleatoires (Level.randValue + getBlockRandomPos du jeu) : valeur = valeur * 3 + 1013904223.
export class TirageBlocs {
  constructor(depart) { this.v = depart | 0; }
  // position (x0,y0,z0 = coin de la section ; masque 15) : [dx, dy, dz]
  prochain() {
    this.v = (Math.imul(this.v, 3) + 1013904223) | 0;
    const i = this.v >> 2;
    return [i & 15, (i >> 16) & 15, (i >> 8) & 15];
  }
}
