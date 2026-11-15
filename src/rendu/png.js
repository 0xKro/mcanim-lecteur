// PNG a la main (zero dependance) : lecture de tous les types de couleur et profondeurs,
// ecriture RGBA/RGB 8 bits.
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Nombre de canaux par type de couleur : 0 gris, 2 rvb, 3 palette, 4 gris+alpha, 6 rvba
const CANAUX = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Enleve les filtres d'une image (ou d'une passe Adam7). Retourne les octets bruts sans filtre.
function defiltrer(data, debut, largeurOctets, hauteur, bpp) {
  const out = new Uint8Array(largeurOctets * hauteur);
  let p = debut;
  for (let y = 0; y < hauteur; y++) {
    const f = data[p++];
    const ligne = y * largeurOctets;
    const prec = ligne - largeurOctets;
    for (let i = 0; i < largeurOctets; i++) {
      const brut = data[p++];
      const a = i >= bpp ? out[ligne + i - bpp] : 0;
      const b = y > 0 ? out[prec + i] : 0;
      const c = i >= bpp && y > 0 ? out[prec + i - bpp] : 0;
      let v;
      switch (f) {
        case 0: v = brut; break;
        case 1: v = brut + a; break;
        case 2: v = brut + b; break;
        case 3: v = brut + ((a + b) >> 1); break;
        case 4: v = brut + paeth(a, b, c); break;
        default: throw new Error('PNG : filtre inconnu ' + f);
      }
      out[ligne + i] = v & 255;
    }
  }
  return { out, fin: p };
}

// Lit un echantillon de `bits` bits (1,2,4,8,16) dans une ligne.
function lireEchantillon(ligne, off, idx, bits) {
  if (bits === 8) return ligne[off + idx];
  if (bits === 16) return (ligne[off + idx * 2] << 8) | ligne[off + idx * 2 + 1];
  const parOctet = 8 / bits;
  const octet = ligne[off + ((idx / parOctet) | 0)];
  const decal = 8 - bits * ((idx % parOctet) + 1);
  return (octet >> decal) & ((1 << bits) - 1);
}

// decoderPNG(buffer) -> { largeur, hauteur, rgba: Uint8Array (largeur*hauteur*4) }
export function decoderPNG(buf) {
  buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('PNG : signature fausse');
  let p = 8;
  let ihdr = null, palette = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    p += 12 + len;
    if (type === 'IHDR') {
      ihdr = { w: d.readUInt32BE(0), h: d.readUInt32BE(4), bits: d[8], ct: d[9], entrelace: d[12] };
    } else if (type === 'PLTE') palette = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('PNG : pas de IHDR');
  const { w, h, bits, ct, entrelace } = ihdr;
  const canaux = CANAUX[ct];
  if (!canaux) throw new Error('PNG : type de couleur inconnu ' + ct);
  const brut = zlib.inflateSync(Buffer.concat(idat));
  const bitsPixel = canaux * bits;
  const bpp = Math.max(1, bitsPixel >> 3);
  const rgba = new Uint8Array(w * h * 4);

  // Transparence "couleur cle" (tRNS pour gris et rvb)
  let cleGris = -1, cleR = -1, cleG = -1, cleB = -1;
  if (trns && ct === 0) cleGris = trns.readUInt16BE(0);
  if (trns && ct === 2) { cleR = trns.readUInt16BE(0); cleG = trns.readUInt16BE(2); cleB = trns.readUInt16BE(4); }
  const max = (1 << Math.min(bits, 8)) - 1;
  const vers8 = (v) => (bits === 16 ? v >> 8 : bits === 8 ? v : Math.round((v * 255) / max));

  // Convertit une ligne defiltree (n pixels) vers rgba ; dest(x) donne l'indice du pixel.
  const ecrireLigne = (ligne, off, n, dest) => {
    for (let x = 0; x < n; x++) {
      const o = dest(x) * 4;
      if (ct === 0) {
        const g = lireEchantillon(ligne, off, x, bits);
        const g8 = vers8(g);
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g8;
        rgba[o + 3] = g === cleGris ? 0 : 255;
      } else if (ct === 2) {
        const r = lireEchantillon(ligne, off, x * 3, bits), g = lireEchantillon(ligne, off, x * 3 + 1, bits), b = lireEchantillon(ligne, off, x * 3 + 2, bits);
        rgba[o] = vers8(r); rgba[o + 1] = vers8(g); rgba[o + 2] = vers8(b);
        rgba[o + 3] = r === cleR && g === cleG && b === cleB ? 0 : 255;
      } else if (ct === 3) {
        const i = lireEchantillon(ligne, off, x, bits);
        if (!palette || i * 3 + 2 >= palette.length) throw new Error('PNG : indice de palette hors limites');
        rgba[o] = palette[i * 3]; rgba[o + 1] = palette[i * 3 + 1]; rgba[o + 2] = palette[i * 3 + 2];
        rgba[o + 3] = trns && i < trns.length ? trns[i] : 255;
      } else if (ct === 4) {
        const g = vers8(lireEchantillon(ligne, off, x * 2, bits)), a = vers8(lireEchantillon(ligne, off, x * 2 + 1, bits));
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g; rgba[o + 3] = a;
      } else {
        rgba[o] = vers8(lireEchantillon(ligne, off, x * 4, bits));
        rgba[o + 1] = vers8(lireEchantillon(ligne, off, x * 4 + 1, bits));
        rgba[o + 2] = vers8(lireEchantillon(ligne, off, x * 4 + 2, bits));
        rgba[o + 3] = vers8(lireEchantillon(ligne, off, x * 4 + 3, bits));
      }
    }
  };

  if (!entrelace) {
    const lo = Math.ceil((w * bitsPixel) / 8);
    const { out } = defiltrer(brut, 0, lo, h, bpp);
    for (let y = 0; y < h; y++) ecrireLigne(out, y * lo, w, (x) => y * w + x);
  } else {
    // Adam7 : 7 passes
    const X0 = [0, 4, 0, 2, 0, 1, 0], Y0 = [0, 0, 4, 0, 2, 0, 1], DX = [8, 8, 4, 4, 2, 2, 1], DY = [8, 8, 8, 4, 4, 2, 2];
    let pos = 0;
    for (let k = 0; k < 7; k++) {
      const pw = Math.ceil((w - X0[k]) / DX[k]), ph = Math.ceil((h - Y0[k]) / DY[k]);
      if (pw <= 0 || ph <= 0) continue;
      const lo = Math.ceil((pw * bitsPixel) / 8);
      const { out, fin } = defiltrer(brut, pos, lo, ph, bpp);
      pos = fin;
      for (let y = 0; y < ph; y++) ecrireLigne(out, y * lo, pw, (x) => (Y0[k] + y * DY[k]) * w + X0[k] + x * DX[k]);
    }
  }
  return { largeur: w, hauteur: h, rgba };
}

// ---- ecriture ----
const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE_CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloc(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// encoderPNG({largeur, hauteur, rgba}, {niveau}) -> Buffer. Ecrit en RVB si aucun pixel n'est transparent.
export function encoderPNG({ largeur, hauteur, rgba }, { niveau = 3 } = {}) {
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break; }
  const canaux = opaque ? 3 : 4;
  const lo = largeur * canaux;
  const brut = Buffer.alloc((lo + 1) * hauteur);
  for (let y = 0; y < hauteur; y++) {
    const d = y * (lo + 1);
    brut[d] = 2; // filtre "Up"
    for (let x = 0; x < largeur; x++) {
      const s = (y * largeur + x) * 4;
      const sp = s - largeur * 4;
      for (let c = 0; c < canaux; c++) {
        const v = rgba[s + c];
        brut[d + 1 + x * canaux + c] = y > 0 ? (v - rgba[sp + c]) & 255 : v;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0); ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([SIGNATURE, bloc('IHDR', ihdr), bloc('IDAT', zlib.deflateSync(brut, { level: niveau })), bloc('IEND', new Uint8Array(0))]);
}
