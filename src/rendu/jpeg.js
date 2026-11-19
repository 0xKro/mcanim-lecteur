// Encodeur JPEG de base (baseline, 8 bits, YCbCr 4:2:0), sans dependance : pour les apercus en grand (mcanim apercu jusqu'a 1920 de large),
// une image de 1920x1080 tient en quelques centaines de Ko au lieu de plusieurs Mo en PNG.
// Tables de quantification de la norme (ITU T.81, annexe K.1) mises a l'echelle par la qualite (formule de l'IJG) ; tables de Huffman
// OPTIMALES calculees sur l'image elle-meme (annexe K.2, longueurs limitees a 16 bits) : deux passes, aucune table recopiee a la main.

const QL = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const QC = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...new Array(32).fill(99)];

// ordre en zigzag : ZZ[k] = indice naturel (ligne * 8 + colonne) du k-ieme coefficient
const ZZ = (() => {
  const o = [];
  for (let s = 0; s < 15; s++) {
    const cases = [];
    for (let y = 0; y < 8; y++) { const x = s - y; if (x >= 0 && x < 8) cases.push(y * 8 + x); }
    if (s % 2 === 0) cases.reverse();   // diagonales paires : de bas-gauche vers haut-droite
    o.push(...cases);
  }
  return o;
})();

// cosinus de la DCT : C[u * 8 + x] = c(u) / 2 * cos((2x + 1) u pi / 16)
const COS = (() => {
  const c = new Float64Array(64);
  for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) c[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) / 2 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  return c;
})();

function tablesQuant(qualite) {
  const q = Math.max(1, Math.min(100, Math.round(qualite)));
  const s = q < 50 ? 5000 / q : 200 - 2 * q;
  const f = (t) => t.map((v) => Math.max(1, Math.min(255, Math.floor((v * s + 50) / 100))));
  return [f(QL), f(QC)];
}

// DCT 8x8 separable + quantification ; `bloc` : 64 valeurs (deja centrees sur 0), rend 64 entiers dans l'ordre zigzag
const tmp = new Float64Array(64);
function dctQuant(bloc, q, sortie, o) {
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += COS[u * 8 + x] * bloc[y * 8 + x]; tmp[y * 8 + u] = s; }
  for (let k = 0; k < 64; k++) {
    const n = ZZ[k], v = n >> 3, u = n & 7;
    let s = 0;
    for (let y = 0; y < 8; y++) s += COS[v * 8 + y] * tmp[y * 8 + u];
    sortie[o + k] = Math.round(s / q[n]);
  }
}

const categorie = (v) => { let a = v < 0 ? -v : v, n = 0; while (a) { n++; a >>= 1; } return n; };

// Annexe K.2 : longueurs de codes (limitees a 16) depuis les frequences ; rend { bits[16], vals[] } (segment DHT) et les codes par symbole
function huffman(freq) {
  const f = Float64Array.from(freq); f[256] = 1;   // symbole reserve : aucun code n'est fait que de 1
  const taille = new Int32Array(257), autres = new Int32Array(257).fill(-1);
  for (;;) {
    let c1 = -1, c2 = -1, v = Infinity;
    for (let i = 0; i < 257; i++) if (f[i] > 0 && f[i] <= v) { v = f[i]; c1 = i; }
    v = Infinity;
    for (let i = 0; i < 257; i++) if (f[i] > 0 && f[i] <= v && i !== c1) { v = f[i]; c2 = i; }
    if (c2 < 0) break;
    f[c1] += f[c2]; f[c2] = 0;
    taille[c1]++; while (autres[c1] >= 0) { c1 = autres[c1]; taille[c1]++; }
    autres[c1] = c2;
    taille[c2]++; while (autres[c2] >= 0) { c2 = autres[c2]; taille[c2]++; }
  }
  const bits = new Int32Array(33);
  for (let i = 0; i < 257; i++) if (taille[i]) bits[taille[i]]++;
  for (let i = 32; i > 16; i--) {
    while (bits[i] > 0) { let j = i - 2; while (bits[j] === 0) j--; bits[i] -= 2; bits[i - 1]++; bits[j + 1] += 2; bits[j]--; }
  }
  let i = 16; while (bits[i] === 0) i--; bits[i]--;   // retire le symbole reserve
  const vals = [];
  for (let l = 1; l <= 32; l++) for (let s = 0; s < 256; s++) if (taille[s] === l) vals.push(s);
  const code = new Int32Array(256), lon = new Int32Array(256);
  let c = 0, k = 0;
  for (let l = 1; l <= 16; l++) { for (let n = 0; n < bits[l]; n++) { code[vals[k]] = c++; lon[vals[k]] = l; k++; } c <<= 1; }
  return { bits: Array.from(bits.slice(1, 17)), vals, code, lon };
}

// Image RGBA (W*H*4) -> Buffer JPEG. qualite : 1..100 (defaut 85).
export function encoderJPEG({ largeur: W, hauteur: H, rgba }, { qualite = 85 } = {}) {
  const [qY, qC] = tablesQuant(qualite);
  const mx = Math.ceil(W / 16), my = Math.ceil(H / 16);
  const nMcu = mx * my;
  const coef = new Int16Array(nMcu * 6 * 64);   // par MCU : 4 blocs Y puis Cb puis Cr
  const Y = new Float64Array(256), Cb = new Float64Array(256), Cr = new Float64Array(256), bloc = new Float64Array(64);
  let o = 0;
  for (let by = 0; by < my; by++) {
    for (let bx = 0; bx < mx; bx++) {
      for (let j = 0; j < 16; j++) {
        const py = Math.min(H - 1, by * 16 + j);
        for (let i = 0; i < 16; i++) {
          const px = Math.min(W - 1, bx * 16 + i), p = (py * W + px) * 4;
          const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
          Y[j * 16 + i] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
          Cb[j * 16 + i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
          Cr[j * 16 + i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }
      for (let k = 0; k < 4; k++) {
        const ox = (k & 1) * 8, oy = (k >> 1) * 8;
        for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) bloc[j * 8 + i] = Y[(oy + j) * 16 + ox + i];
        dctQuant(bloc, qY, coef, o); o += 64;
      }
      for (const C of [Cb, Cr]) {   // 4:2:0 : moyenne de chaque carre de 2x2
        for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const a = j * 32 + i * 2; bloc[j * 8 + i] = (C[a] + C[a + 1] + C[a + 16] + C[a + 17]) / 4; }
        dctQuant(bloc, qC, coef, o); o += 64;
      }
    }
  }
  // passe 1 : frequences des symboles (DC et AC, luminance et chrominance)
  const fr = [0, 1, 2, 3].map(() => new Float64Array(257));   // 0 DC Y, 1 AC Y, 2 DC C, 3 AC C
  const parcourir = (emettre) => {
    const pred = [0, 0, 0];
    for (let m = 0; m < nMcu; m++) {
      for (let b = 0; b < 6; b++) {
        const comp = b < 4 ? 0 : b - 3, base = (m * 6 + b) * 64, t = comp ? 2 : 0;
        const dc = coef[base], diff = dc - pred[comp]; pred[comp] = dc;
        const s = categorie(diff); emettre(t, s, diff, s);
        let zero = 0;
        for (let k = 1; k < 64; k++) {
          const v = coef[base + k];
          if (v === 0) { zero++; continue; }
          while (zero > 15) { emettre(t + 1, 0xf0, 0, 0); zero -= 16; }
          const c = categorie(v); emettre(t + 1, (zero << 4) | c, v, c); zero = 0;
        }
        if (zero) emettre(t + 1, 0, 0, 0);
      }
    }
  };
  parcourir((t, sym) => { fr[t][sym]++; });
  const tables = fr.map(huffman);
  // passe 2 : ecriture
  const out = [];
  const octet = (v) => out.push(v & 255);
  const mot = (v) => { octet(v >> 8); octet(v); };
  mot(0xffd8);
  mot(0xffe0); mot(16); for (const c of 'JFIF') octet(c.charCodeAt(0)); octet(0); octet(1); octet(1); octet(0); mot(1); mot(1); octet(0); octet(0);
  mot(0xffdb); mot(2 + 2 * 65);
  octet(0); for (let k = 0; k < 64; k++) octet(qY[ZZ[k]]);
  octet(1); for (let k = 0; k < 64; k++) octet(qC[ZZ[k]]);
  mot(0xffc0); mot(17); octet(8); mot(H); mot(W); octet(3);
  octet(1); octet(0x22); octet(0); octet(2); octet(0x11); octet(1); octet(3); octet(0x11); octet(1);
  const classes = [0x00, 0x10, 0x01, 0x11];
  mot(0xffc4); mot(2 + tables.reduce((s, t) => s + 17 + t.vals.length, 0));
  tables.forEach((t, i) => { octet(classes[i]); t.bits.forEach(octet); t.vals.forEach(octet); });
  mot(0xffda); mot(12); octet(3); octet(1); octet(0x00); octet(2); octet(0x11); octet(3); octet(0x11); octet(0); octet(63); octet(0);
  let acc = 0, n = 0;
  const ecrireBits = (v, l) => {
    for (let k = l - 1; k >= 0; k--) {
      acc = (acc << 1) | ((v >> k) & 1); n++;
      if (n === 8) { octet(acc); if (acc === 0xff) octet(0); acc = 0; n = 0; }
    }
  };
  parcourir((t, sym, v, s) => {
    const T = tables[t];
    ecrireBits(T.code[sym], T.lon[sym]);
    if (s) ecrireBits(v < 0 ? v + (1 << s) - 1 : v, s);
  });
  if (n) ecrireBits(0x7f, 8 - n);   // bourrage avec des 1
  mot(0xffd9);
  return Buffer.from(out);
}
