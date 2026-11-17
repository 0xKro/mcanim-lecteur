// Petit lecteur / rasteriseur TrueType, sans dependance.
// Gere : head, maxp, hhea, hmtx, loca, glyf (simples et composes), cmap (formats 4 et 12).
// Le hinting est ignore. Les contours OpenType CFF ("OTTO") ne sont pas geres.

const TAILLE_MAX_FICHIER = 20 * 1024 * 1024;
const PROFONDEUR_MAX = 6; // profondeur max des glyphes composes
const COMPOSANTS_MAX = 256; // nombre max de composants par glyphe
const POINTS_MAX = 200000; // nombre max de points par glyphe
const BITMAP_MAX = 4096; // cote max d'un bitmap (px)

function erreur(msg) {
  return new Error('police TTF illisible : ' + msg);
}

// Lecteur borne : toute lecture passe par ici.
function creerLecteur(octets) {
  const dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const n = octets.byteLength;
  const v = (o, t) => {
    if (!Number.isInteger(o) || o < 0 || o + t > n) throw erreur('lecture hors du fichier (position ' + o + ')');
  };
  return {
    taille: n,
    u8(o) { v(o, 1); return dv.getUint8(o); },
    i8(o) { v(o, 1); return dv.getInt8(o); },
    u16(o) { v(o, 2); return dv.getUint16(o); },
    i16(o) { v(o, 2); return dv.getInt16(o); },
    u32(o) { v(o, 4); return dv.getUint32(o); },
    tag(o) { v(o, 4); return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)); },
  };
}

// ---------- cmap ----------

function choisirSousTable(r, cmap) {
  const nb = r.u16(cmap + 2);
  let meilleur = null;
  let score = -1;
  for (let i = 0; i < nb && i < 64; i++) {
    const plat = r.u16(cmap + 4 + i * 8);
    const enc = r.u16(cmap + 6 + i * 8);
    const off = cmap + r.u32(cmap + 8 + i * 8);
    let s = -1;
    if (plat === 3 && enc === 10) s = 4;
    else if (plat === 0) s = 3;
    else if (plat === 3 && enc === 1) s = 2;
    if (s < 0) continue;
    let fmt;
    try { fmt = r.u16(off); } catch { continue; }
    if (fmt !== 4 && fmt !== 12) continue;
    if (s > score) { score = s; meilleur = off; }
  }
  if (meilleur === null) throw erreur('aucune table cmap Unicode (format 4 ou 12)');
  return meilleur;
}

function chercherGlyphe(r, sous, cp) {
  const fmt = r.u16(sous);
  if (fmt === 4) {
    if (cp > 0xffff) return 0;
    const segX2 = r.u16(sous + 6);
    const seg = segX2 >> 1;
    const fins = sous + 14;
    const debuts = fins + segX2 + 2;
    const deltas = debuts + segX2;
    const plages = deltas + segX2;
    // recherche binaire sur les fins de segments
    let a = 0;
    let b = seg - 1;
    while (a < b) {
      const m = (a + b) >> 1;
      if (r.u16(fins + m * 2) < cp) a = m + 1; else b = m;
    }
    if (seg === 0 || r.u16(fins + a * 2) < cp) return 0;
    const debut = r.u16(debuts + a * 2);
    if (cp < debut) return 0;
    const delta = r.u16(deltas + a * 2);
    const plage = r.u16(plages + a * 2);
    if (plage === 0) return (cp + delta) & 0xffff;
    const g = r.u16(plages + a * 2 + plage + (cp - debut) * 2);
    return g === 0 ? 0 : (g + delta) & 0xffff;
  }
  if (fmt === 12) {
    const nb = r.u32(sous + 12);
    if (nb * 12 > r.taille) throw erreur('cmap format 12 trop grand');
    let a = 0;
    let b = nb - 1;
    while (a <= b) {
      const m = (a + b) >> 1;
      const o = sous + 16 + m * 12;
      const d = r.u32(o);
      const f = r.u32(o + 4);
      if (cp < d) b = m - 1;
      else if (cp > f) a = m + 1;
      else return r.u32(o + 8) + (cp - d);
    }
    return 0;
  }
  return 0;
}

// ---------- glyf ----------

function lireGlyphe(police, gid, profondeur, etat) {
  const { r, glyf, nbGlyphes } = police;
  if (profondeur > PROFONDEUR_MAX) throw erreur('glyphes composes trop imbriques');
  if (gid < 0 || gid >= nbGlyphes) throw erreur('numero de glyphe invalide : ' + gid);
  const debut = police.decalage(gid);
  const fin = police.decalage(gid + 1);
  if (fin < debut || fin > glyf.longueur) throw erreur('table loca incoherente');
  if (fin === debut) return [];
  const base = glyf.offset + debut;
  const nbContours = r.i16(base);
  if (nbContours >= 0) return lireSimple(r, base + 10, nbContours, etat);

  // glyphe compose
  const contours = [];
  let o = base + 10;
  for (let k = 0; ; k++) {
    if (k >= COMPOSANTS_MAX) throw erreur('trop de composants');
    const flags = r.u16(o);
    const sub = r.u16(o + 2);
    o += 4;
    let dx; let dy;
    if (flags & 1) {
      dx = flags & 2 ? r.i16(o) : 0;
      dy = flags & 2 ? r.i16(o + 2) : 0;
      o += 4;
    } else {
      dx = flags & 2 ? r.i8(o) : 0;
      dy = flags & 2 ? r.i8(o + 1) : 0;
      o += 2;
    }
    let a = 1; let b = 0; let c = 0; let d = 1;
    const f14 = (p) => r.i16(p) / 16384;
    if (flags & 8) { a = d = f14(o); o += 2; }
    else if (flags & 0x40) { a = f14(o); d = f14(o + 2); o += 4; }
    else if (flags & 0x80) { a = f14(o); b = f14(o + 2); c = f14(o + 4); d = f14(o + 6); o += 8; }
    const fils = lireGlyphe(police, sub, profondeur + 1, etat);
    for (const ct of fils) {
      contours.push(ct.map(([x, y, on]) => [a * x + c * y + dx, b * x + d * y + dy, on]));
    }
    if (!(flags & 0x20)) break;
  }
  return contours;
}

function lireSimple(r, o, nbContours, etat) {
  if (nbContours === 0) return [];
  const fins = [];
  let prec = -1;
  for (let i = 0; i < nbContours; i++) {
    const f = r.u16(o + i * 2);
    if (f < prec) throw erreur('fins de contours non croissantes');
    fins.push(f);
    prec = f;
  }
  const nb = prec + 1;
  etat.points += nb;
  if (nb > POINTS_MAX || etat.points > POINTS_MAX) throw erreur('trop de points');
  o += nbContours * 2;
  o += 2 + r.u16(o); // instructions ignorees
  const flags = new Uint8Array(nb);
  for (let i = 0; i < nb;) {
    const f = r.u8(o++);
    flags[i++] = f;
    if (f & 8) {
      let rep = r.u8(o++);
      while (rep-- > 0 && i < nb) flags[i++] = f;
    }
  }
  const xs = new Float64Array(nb);
  const ys = new Float64Array(nb);
  let v = 0;
  for (let i = 0; i < nb; i++) {
    const f = flags[i];
    if (f & 2) { const d = r.u8(o++); v += f & 16 ? d : -d; }
    else if (!(f & 16)) { v += r.i16(o); o += 2; }
    xs[i] = v;
  }
  v = 0;
  for (let i = 0; i < nb; i++) {
    const f = flags[i];
    if (f & 4) { const d = r.u8(o++); v += f & 32 ? d : -d; }
    else if (!(f & 32)) { v += r.i16(o); o += 2; }
    ys[i] = v;
  }
  const contours = [];
  let d = 0;
  for (const e of fins) {
    const ct = [];
    for (let i = d; i <= e; i++) ct.push([xs[i], ys[i], (flags[i] & 1) === 1]);
    if (ct.length) contours.push(ct);
    d = e + 1;
  }
  return contours;
}

// ---------- rasterisation ----------

// Transforme un contour (points on/off) en segments de droites (px, y vers le haut).
function aplatir(ct, s, segs) {
  const n = ct.length;
  if (n < 2) return;
  const P = ct.map(([x, y, on]) => [x * s, y * s, on]);
  let debut; let suite;
  const i0 = P.findIndex((p) => p[2]);
  if (i0 >= 0) {
    debut = [P[i0][0], P[i0][1]];
    suite = [];
    for (let k = 1; k < n; k++) suite.push(P[(i0 + k) % n]);
  } else {
    debut = [(P[0][0] + P[n - 1][0]) / 2, (P[0][1] + P[n - 1][1]) / 2];
    suite = P;
  }
  let cur = debut;
  let ctrl = null;
  const droite = (p) => { segs.push(cur[0], cur[1], p[0], p[1]); cur = p; };
  const quad = (c, p) => {
    const dd = Math.hypot(cur[0] - 2 * c[0] + p[0], cur[1] - 2 * c[1] + p[1]);
    const m = Math.min(32, Math.max(1, Math.ceil(Math.sqrt(dd * 5))));
    const x0 = cur[0]; const y0 = cur[1];
    let px = x0; let py = y0;
    for (let i = 1; i <= m; i++) {
      const t = i / m; const u = 1 - t;
      const x = u * u * x0 + 2 * u * t * c[0] + t * t * p[0];
      const y = u * u * y0 + 2 * u * t * c[1] + t * t * p[1];
      segs.push(px, py, x, y);
      px = x; py = y;
    }
    cur = [p[0], p[1]];
  };
  for (const q of suite) {
    if (q[2]) {
      if (ctrl) { quad(ctrl, q); ctrl = null; } else droite(q);
    } else if (ctrl) {
      const mid = [(ctrl[0] + q[0]) / 2, (ctrl[1] + q[1]) / 2];
      quad(ctrl, mid);
      ctrl = q;
    } else ctrl = q;
  }
  if (ctrl) quad(ctrl, debut); else droite(debut);
}

// Trace une ligne dans le tampon d'accumulation (aire signee exacte par pixel).
function tracerLigne(a, larg, haut, x0, y0, x1, y1) {
  if (y0 === y1) return;
  let dir = 1;
  if (y0 > y1) { dir = -1; [x0, y0, x1, y1] = [x1, y1, x0, y0]; }
  const dxdy = (x1 - x0) / (y1 - y0);
  let x = x0;
  if (y0 < 0) x -= y0 * dxdy;
  const yDeb = Math.max(0, Math.floor(y0));
  const yFin = Math.min(haut, Math.ceil(y1));
  const pas = larg + 2;
  for (let y = yDeb; y < yFin; y++) {
    const dy = Math.min(y + 1, y1) - Math.max(y, y0);
    const xs = x + dxdy * dy;
    const d = dy * dir;
    let xa = x < xs ? x : xs;
    let xb = x < xs ? xs : x;
    if (xa < 0) xa = 0;
    if (xb > larg) xb = larg;
    if (xb < xa) xb = xa;
    const xaf = Math.floor(xa);
    const xai = xaf;
    const xbi = Math.ceil(xb);
    const ligne = y * pas;
    if (xbi <= xai + 1) {
      const xmf = 0.5 * (xa + xb) - xaf;
      a[ligne + xai] += d - d * xmf;
      a[ligne + xai + 1] += d * xmf;
    } else {
      const s = 1 / (xb - xa);
      const xaf2 = xa - xaf;
      const a0 = 0.5 * s * (1 - xaf2) * (1 - xaf2);
      const xbf = xb - xbi + 1;
      const am = 0.5 * s * xbf * xbf;
      a[ligne + xai] += d * a0;
      if (xbi === xai + 2) {
        a[ligne + xai + 1] += d * (1 - a0 - am);
      } else {
        const a1 = s * (1.5 - xaf2);
        a[ligne + xai + 1] += d * (a1 - a0);
        for (let xi = xai + 2; xi < xbi - 1; xi++) a[ligne + xi] += d * s;
        const a2 = a1 + (xbi - xai - 3) * s;
        a[ligne + xbi - 1] += d * (1 - a2 - am);
      }
      a[ligne + xbi] += d * am;
    }
    x = xs;
  }
}

// ---------- police ----------

class Police {
  constructor(r, t) {
    this.r = r;
    this.glyf = t.glyf;
    this.nbGlyphes = t.nbGlyphes;
    this.unitesParEm = t.unitesParEm;
    this.ascendant = t.ascendant;
    this.descendant = t.descendant;
    this._locaLongue = t.locaLongue;
    this._loca = t.loca;
    this._hmtx = t.hmtx;
    this._nbHM = t.nbHM;
    this._cmap = t.cmap;
    this._gids = new Map();
    this._contours = new Map();
    this._cache = new Map();
  }

  decalage(i) {
    const o = this._loca.offset + i * (this._locaLongue ? 4 : 2);
    return this._locaLongue ? this.r.u32(o) : this.r.u16(o) * 2;
  }

  _gid(cp) {
    if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return 0;
    let g = this._gids.get(cp);
    if (g === undefined) {
      g = chercherGlyphe(this.r, this._cmap, cp);
      if (g >= this.nbGlyphes) g = 0;
      this._gids.set(cp, g);
    }
    return g;
  }

  aGlyphe(cp) { return this._gid(cp) !== 0; }

  _avanceUnites(gid) {
    const i = gid < this._nbHM ? gid : this._nbHM - 1;
    return this.r.u16(this._hmtx.offset + i * 4);
  }

  avance(cp, taillePx) {
    return this._avanceUnites(this._gid(cp)) * taillePx / this.unitesParEm;
  }

  rasteriser(cp, taillePx) {
    if (!(taillePx > 0) || !Number.isFinite(taillePx) || taillePx > 2000) return null;
    const gid = this._gid(cp);
    if (gid === 0) return null;
    const cle = cp + '|' + taillePx;
    if (this._cache.has(cle)) return this._cache.get(cle);
    const res = this._rasteriser(gid, taillePx);
    this._cache.set(cle, res);
    return res;
  }

  _rasteriser(gid, taillePx) {
    const s = taillePx / this.unitesParEm;
    const avance = this._avanceUnites(gid) * s;
    let contours = this._contours.get(gid);
    if (!contours) {
      contours = lireGlyphe(this, gid, 0, { points: 0 });
      this._contours.set(gid, contours);
    }
    const vide = { largeur: 0, hauteur: 0, gauche: 0, haut: 0, avance, alpha: new Uint8Array(0) };
    const segs = [];
    for (const ct of contours) aplatir(ct, s, segs);
    if (segs.length === 0) return vide;
    let xmin = Infinity; let xmax = -Infinity; let ymin = Infinity; let ymax = -Infinity;
    for (let i = 0; i < segs.length; i += 2) {
      const x = segs[i]; const y = segs[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return vide;
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
    // petite marge pour les erreurs d'arrondi flottant
    const eps = 1e-6;
    const gauche = Math.floor(xmin + eps);
    const droite = Math.ceil(xmax - eps);
    const bas = Math.floor(ymin + eps);
    const haut = Math.ceil(ymax - eps);
    const largeur = droite - gauche;
    const hauteur = haut - bas;
    if (largeur <= 0 || hauteur <= 0) return vide;
    if (largeur > BITMAP_MAX || hauteur > BITMAP_MAX) return null;
    const acc = new Float32Array((largeur + 2) * hauteur);
    for (let i = 0; i < segs.length; i += 4) {
      tracerLigne(acc, largeur, hauteur,
        segs[i] - gauche, haut - segs[i + 1], segs[i + 2] - gauche, haut - segs[i + 3]);
    }
    const alpha = new Uint8Array(largeur * hauteur);
    const pas = largeur + 2;
    for (let y = 0; y < hauteur; y++) {
      let somme = 0;
      for (let x = 0; x < largeur; x++) {
        somme += acc[y * pas + x];
        const c = Math.abs(somme);
        alpha[y * largeur + x] = c >= 1 ? 255 : Math.round(c * 255);
      }
    }
    return { largeur, hauteur, gauche, haut, avance, alpha };
  }
}

export function lireTTF(octets) {
  if (!(octets instanceof Uint8Array)) throw erreur('on attend un Uint8Array ou un Buffer');
  if (octets.byteLength > TAILLE_MAX_FICHIER) throw erreur('fichier trop gros (plus de 20 Mo)');
  if (octets.byteLength < 12) throw erreur('fichier trop court');
  const r = creerLecteur(octets);
  let base = 0;
  let sig = r.tag(0);
  if (sig === 'ttcf') {
    if (r.u32(8) < 1) throw erreur('collection vide');
    base = r.u32(12);
    sig = r.tag(base);
  }
  if (sig === 'OTTO') throw erreur('OpenType a contours CFF non gere');
  if (sig !== '\0\x01\0\0' && sig !== 'true') throw erreur('signature inconnue');
  const nbTables = r.u16(base + 4);
  if (nbTables < 1 || nbTables > 256) throw erreur('nombre de tables absurde');
  const tables = {};
  for (let i = 0; i < nbTables; i++) {
    const e = base + 12 + i * 16;
    const offset = r.u32(e + 8);
    const longueur = r.u32(e + 12);
    if (offset > r.taille) throw erreur('table hors du fichier');
    tables[r.tag(e)] = { offset, longueur: Math.min(longueur, r.taille - offset) };
  }
  for (const nom of ['head', 'maxp', 'hhea', 'hmtx', 'loca', 'glyf', 'cmap']) {
    if (!tables[nom]) throw erreur('table ' + nom + ' absente');
  }
  const { head, maxp, hhea, hmtx, loca, glyf, cmap } = tables;
  if (head.longueur < 54 || maxp.longueur < 6 || hhea.longueur < 36) throw erreur('table trop courte');
  const unitesParEm = r.u16(head.offset + 18);
  if (unitesParEm < 16 || unitesParEm > 16384) throw erreur('unites par em absurdes');
  const fmtLoca = r.i16(head.offset + 50);
  if (fmtLoca !== 0 && fmtLoca !== 1) throw erreur('format de loca inconnu');
  const nbGlyphes = r.u16(maxp.offset + 4);
  if (nbGlyphes < 1) throw erreur('aucun glyphe');
  const locaLongue = fmtLoca === 1;
  if ((nbGlyphes + 1) * (locaLongue ? 4 : 2) > loca.longueur) throw erreur('table loca trop courte');
  const nbHM = r.u16(hhea.offset + 34);
  if (nbHM < 1 || nbHM > nbGlyphes) throw erreur('hmtx incoherente');
  if (nbHM * 4 > hmtx.longueur) throw erreur('table hmtx trop courte');
  const sous = choisirSousTable(r, cmap.offset);
  return new Police(r, {
    glyf, loca, hmtx, nbGlyphes, unitesParEm, locaLongue, nbHM, cmap: sous,
    ascendant: r.i16(hhea.offset + 4),
    descendant: r.i16(hhea.offset + 6),
  });
}
