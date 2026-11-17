// Texte comme dans le jeu : decoupe en segments colores, retours a la ligne, ombre, gras, italique, contour epais, fond.
// L'unite de base est le "pixel de police" (une ligne fait 8 pixels, 9 avec l'interligne). `S` = pixels de l'image par pixel de police
// (entier = pixels nets ; reel = taille libre, echantillonnage "plus proche").
import { creerImage, lireCouleur, CODES_JEU, NOMS_PAR_CODE, COULEURS_JEU } from './toile.js';

const BLANC = [255, 255, 255];
const CASSES = {
  haut: (s) => s.toLocaleUpperCase('fr'), majuscules: (s) => s.toLocaleUpperCase('fr'), bas: (s) => s.toLocaleLowerCase('fr'), minuscules: (s) => s.toLocaleLowerCase('fr'),
  aucune: (s) => s, titre: (s) => s.replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('fr')),
};
export const casses = Object.keys(CASSES);

// ---------------------------------------------------------------- segments
// texte (avec codes § du jeu : §c rouge, §l gras, §o italique, §r retour), couleur de base, gras/italique de base.
// Retourne [{ texte, couleur:[r,g,b], gras, italique }].
export function segmentsDeTexte(texte, { couleur = BLANC, gras = false, italique = false } = {}) {
  const base = { couleur: couleur.slice(0, 3), gras, italique };
  let cur = { ...base };
  const sortie = [];
  let tampon = '';
  const vider = () => { if (tampon) { sortie.push({ texte: tampon, ...cur }); tampon = ''; } };
  const cs = [...String(texte)];
  for (let i = 0; i < cs.length; i++) {
    if (cs[i] === '§' && i + 1 < cs.length) {
      const c = cs[++i].toLowerCase();
      vider();
      const k = CODES_JEU.indexOf(c);
      if (k >= 0) cur = { couleur: [...COULEURS_JEU[NOMS_PAR_CODE[k]]], gras: false, italique: false };
      else if (c === 'l') cur = { ...cur, gras: true };
      else if (c === 'o') cur = { ...cur, italique: true };
      else if (c === 'r') cur = { ...base };
      continue;
    }
    tampon += cs[i];
  }
  vider();
  return sortie;
}

// Colore des MOTS : `mots` = { "mot": couleur } (comparaison sans casse ni ponctuation) et `indices` = { numero_du_mot: couleur } (le premier mot a le numero 0).
// Coupe les segments aux frontieres des mots concernes.
export function colorerMots(segments, mots = null, indices = null) {
  const cles = mots ? new Map(Object.entries(mots).map(([k, v]) => [k.toLowerCase(), lireCouleur(v)]).filter(([, v]) => v)) : null;
  if (!cles?.size && !indices) return segments;
  const sortie = [];
  let n = 0;
  for (const seg of segments) {
    for (const morceau of seg.texte.split(/(\s+)/)) {
      if (!morceau) continue;
      if (/^\s+$/.test(morceau)) { sortie.push({ ...seg, texte: morceau }); continue; }
      const nu = morceau.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      let c = cles?.get(nu) ?? (indices && indices[n] !== undefined ? lireCouleur(indices[n]) : null);
      sortie.push(c ? { ...seg, texte: morceau, couleur: c.slice(0, 3) } : { ...seg, texte: morceau });
      n++;
    }
  }
  return fusionner(sortie);
}
function fusionner(l) {
  const o = [];
  for (const s of l) { const d = o[o.length - 1]; if (d && d.gras === s.gras && d.italique === s.italique && d.couleur.join() === s.couleur.join()) d.texte += s.texte; else o.push({ ...s }); }
  return o;
}
export const appliquerCasse = (segments, casse) => (casse && CASSES[casse] ? segments.map((s) => ({ ...s, texte: CASSES[casse](s.texte) })) : segments);

// ---------------------------------------------------------------- symboles courants sans glyphe
// Le jeu a deja x (U+00D7), les fleches, les guillemets et les tirets dans ses polices (nonlatin_european.png). Ce tableau ne sert QUE pour un caractere
// qu'aucune police ne dessine (police d'un texture pack incomplete, symboles rares) : on met un equivalent en lettres plutot qu'un carre ou un "?".
export const SUBSTITUTIONS = {
  '×': 'x', '÷': '/', '→': '->', '←': '<-', '↑': '^', '↓': 'v', '⇒': '=>', '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x', '•': '*', '·': '.', '…': '...',
  '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '«': '"', '»': '"', '★': '*', '☆': '*', '❤': '<3', '♥': '<3', '≥': '>=', '≤': '<=', '≠': '!=', '≈': '~',
  'œ': 'oe', 'Œ': 'OE', 'æ': 'ae', 'Æ': 'AE', '€': 'EUR', '°': 'o', ' ': ' ', ' ': ' ', ' ': ' ',
};
// Remplace (si besoin) un caractere sans glyphe ; retourne la liste des caracteres a poser. Le remplacement est note dans police.substitues (une note par film).
function substituer(police, c) {
  const cp = c.codePointAt(0);
  if (cp < 32 || police.aGlyphe(cp) || police.avances.has(cp)) return [c];
  const r = SUBSTITUTIONS[c];
  if (r === undefined) return [c];
  (police.substitues ??= new Map()).set(c, r);
  return [...r];
}

// ---------------------------------------------------------------- mise en page
// Retourne { lignes: [{ glyphes: [{ cp, x, seg }], largeur }], largeur (max, en pixels de police), nbLignes }.
// largeurMax en pixels de police (Infinity = pas de coupe). Coupe aux espaces ; un mot plus long que la ligne est coupe n'importe ou.
export function mettreEnPage(police, segments, { largeurMax = Infinity, gras = false } = {}) {
  const mots = [];   // { glyphes: [{cp, seg, a}], espace: bool, saut: bool }
  segments.forEach((seg) => {
    const g = seg.gras || gras;
    let cur = null;
    for (const c of [...seg.texte].flatMap((x) => substituer(police, x))) {
      const cp = c.codePointAt(0);
      if (c === '\n') { mots.push({ saut: true, glyphes: [], largeur: 0 }); cur = null; continue; }
      const esp = /\s/.test(c);
      const a = police.avance(cp, g);
      if (!cur || cur.espace !== esp) { cur = { glyphes: [], espace: esp, largeur: 0 }; mots.push(cur); }
      cur.glyphes.push({ cp, seg, a }); cur.largeur += a;
    }
  });
  const lignes = [];
  let ligne = { glyphes: [], largeur: 0 };
  const finir = () => { lignes.push(ligne); ligne = { glyphes: [], largeur: 0 }; };
  const poser = (g) => { ligne.glyphes.push({ cp: g.cp, x: ligne.largeur, seg: g.seg }); ligne.largeur += g.a; };
  for (const m of mots) {
    if (m.saut) { finir(); continue; }
    if (m.espace) { if (ligne.glyphes.length) for (const g of m.glyphes) { if (ligne.largeur + g.a <= largeurMax || true) poser(g); } continue; }
    if (ligne.largeur + m.largeur > largeurMax && ligne.glyphes.length) {
      while (ligne.glyphes.length && /\s/.test(String.fromCodePoint(ligne.glyphes[ligne.glyphes.length - 1].cp))) { const g = ligne.glyphes.pop(); ligne.largeur -= police.avance(g.cp, g.seg.gras || gras); }
      finir();
    }
    for (const g of m.glyphes) {
      if (ligne.largeur + g.a > largeurMax && ligne.glyphes.length) finir();
      poser(g);
    }
  }
  if (ligne.glyphes.length || !lignes.length) lignes.push(ligne);
  for (const l of lignes) while (l.glyphes.length && /\s/.test(String.fromCodePoint(l.glyphes[l.glyphes.length - 1].cp))) { const g = l.glyphes.pop(); l.largeur -= police.avance(g.cp, g.seg.gras || gras); }
  return { lignes, largeur: Math.max(0, ...lignes.map((l) => l.largeur)), nbLignes: lignes.length };
}

// Largeur en pixels de police d'un texte sur une ligne (outil de mesure).
export function largeurTexte(police, texte, { gras = false } = {}) {
  return mettreEnPage(police, segmentsDeTexte(texte), { gras }).largeur;
}

// ---------------------------------------------------------------- dessin d'un glyphe
// Pose un glyphe dans `puits.poser(x, y, a)` ; cp, x en pixels (coin haut gauche de la ligne), S : pixels par pixel de police.
// Retourne rien. `italique` : le haut est decale d'un pixel de police vers la droite.
function glypheDans(police, cp, xPx, haut, S, italique, puits) {
  const g = police.glyphe(cp);
  if (!g) { if (police.avances.has(cp)) return; return carreManquant(xPx, haut, S, puits); }   // l'espace n'a pas de dessin
  if (g.type === 'b') {
    const dw = g.cw * g.echelle * S, dh = g.ch * g.echelle * S;
    if (dw <= 0) return;
    const y0 = haut + (7 - g.ascent) * S;
    const ia = Math.ceil(xPx - 0), ib = Math.ceil(xPx + dw + (italique ? S : 0));
    for (let j = Math.ceil(y0 - 0.5); j < Math.ceil(y0 + dh - 0.5); j++) {
      const fv = (j + 0.5 - y0) / dh; if (fv < 0 || fv >= 1) continue;
      const v = g.y + Math.min(g.ch - 1, Math.floor(fv * g.ch));
      const dec = italique ? (1 - fv) * S : 0;
      for (let i = ia; i < ib; i++) {
        const fu = (i + 0.5 - xPx - dec) / dw; if (fu < 0 || fu >= 1) continue;
        const u = g.x + Math.min(g.cw - 1, Math.floor(fu * g.cw));
        const o = (v * g.img.w + u) * 4, a = g.img.px[o + 3];
        if (a) puits.poser(i, j, a, g.img.px[o], g.img.px[o + 1], g.img.px[o + 2]);
      }
    }
    return;
  }
  // TrueType : rasterise a la taille d'ecran
  const bm = g.ttf.rasteriser(cp, g.taille * S);
  if (!bm || !bm.largeur) return;
  const base = haut + (7 - (g.shift?.[1] ?? 0)) * S;   // ligne de base : 7 pixels sous le haut de la ligne
  const x0 = Math.round(xPx + (g.shift?.[0] ?? 0) * S + bm.gauche), y0 = Math.round(base - bm.haut);
  for (let j = 0; j < bm.hauteur; j++) for (let i = 0; i < bm.largeur; i++) {
    const a = bm.alpha[j * bm.largeur + i]; if (!a) continue;
    puits.poser(x0 + i + (italique ? Math.round((1 - j / bm.hauteur) * S) : 0), y0 + j, a, 255, 255, 255);
  }
}
function carreManquant(xPx, haut, S, puits) {
  for (let j = 1; j < 8; j++) for (let i = 0; i < 5; i++) if (i === 0 || i === 4 || j === 1 || j === 7) for (let q = 0; q < S; q++) for (let r = 0; r < S; r++) puits.poser(Math.round(xPx + i * S + q), Math.round(haut + j * S + r), 255, 255, 255, 255);
}

// ---------------------------------------------------------------- rendu
// Dessine les lignes dans une image transparente. Retourne { img, origine: {x, y} (coin haut gauche du texte dans l'image),
// larg, haut (taille du texte seul, en pixels d'image), lignes }.
//   S : pixels d'image par pixel de police ; gras, italique : de base ; couleur : de base (segments sans couleur) ;
//   contour : { couleur, ep } (ep en pixels d'image) ; ombre : true | { couleur?, dec? (en pixels de police) } ; fond : [r,g,b,a] ; marge : pixels autour du fond ;
//   alignement : 'gauche' | 'centre' | 'droite' ; interligne : pixels de police entre deux lignes (9 par defaut).
export function rendreTexte(police, segments, { S = 1, gras = false, italique = false, contour = null, ombre = false, alignement = 'centre', largeurMax = Infinity, interligne = 9, fond = null, marge = 0, visibilite = null } = {}) {
  const mp = mettreEnPage(police, segments, { largeurMax: largeurMax / S, gras });
  const ep = contour ? Math.max(0, Math.round(contour.ep)) : 0;
  const dec = ombre ? Math.round((typeof ombre === 'object' ? ombre.dec ?? 1 : 1) * S) : 0;
  const hautLigne = interligne * S;
  const larg = Math.ceil(mp.largeur * S + (gras ? S : 0)), haut = Math.ceil((8 + (mp.nbLignes - 1) * interligne) * S);
  const pad = Math.max(ep + 1, dec + 1, Math.ceil(3 * S), marge + 1);
  const img = creerImage(larg + 2 * pad, haut + 2 * pad + Math.ceil(3 * S));   // un peu de place au-dessous (queues, accents du haut dans le pad)
  const W = img.w, Hh = img.h;
  const oy = pad + Math.ceil(2 * S);   // les accents ont du jeu au-dessus de la ligne (jusqu'a 3 pixels de police)
  if (fond) {
    const [fr, fg, fb, fa = 255] = fond;
    for (let y = Math.max(0, oy - marge); y < Math.min(Hh, oy + haut + marge); y++) for (let x = Math.max(0, pad - marge); x < Math.min(W, pad + larg + marge); x++) { const o = (y * W + x) * 4; img.px[o] = fr; img.px[o + 1] = fg; img.px[o + 2] = fb; img.px[o + 3] = fa; }
  }
  let gl = [];   // glyphes places : { cp, x, y, seg }
  mp.lignes.forEach((l, k) => {
    const dx = alignement === 'gauche' ? 0 : alignement === 'droite' ? mp.largeur - l.largeur : (mp.largeur - l.largeur) / 2;
    for (const g of l.glyphes) gl.push({ cp: g.cp, x: pad + (g.x + dx) * S, y: oy + k * hautLigne, seg: g.seg });
  });
  // animation lettre par lettre (machine) ou mot par mot (vague) : visibilite({ idx, mot, nChars, nMots }) -> { vu, dy (pixels de police, vers le bas) } ; la mise en page ne bouge pas
  if (visibilite) {
    let mot = -1, idx = -1, precEsp = true;
    for (const g of gl) { const esp = /\s/.test(String.fromCodePoint(g.cp)); g.esp = esp; if (!esp) { idx++; if (precEsp) mot++; g.idx = idx; g.mot = mot; } precEsp = esp; }
    const nChars = idx + 1, nMots = mot + 1;
    gl = gl.filter((g) => { if (g.esp) return true; const r = visibilite({ idx: g.idx, mot: g.mot, nChars, nMots }); if (!r.vu) return false; g.y += Math.round((r.dy ?? 0) * S); return true; });
  }
  const dessineTout = (puits, avecGras = true) => {
    for (const g of gl) {
      const it = g.seg.italique || italique, gr = (g.seg.gras || gras) && !police.sansGras;   // une police deja grasse (sansGras) n'est pas redoublee
      glypheDans(police, g.cp, g.x, g.y, S, it, puits(g));
      if (gr && avecGras) glypheDans(police, g.cp, g.x + S, g.y, S, it, puits(g));
    }
  };
  // 1. contour : masque de tous les glyphes, dilate d'un disque de rayon ep
  if (ep > 0) {
    const masque = new Uint8Array(W * Hh);
    const p = { poser: (x, y) => { if (x >= 0 && y >= 0 && x < W && y < Hh) masque[y * W + x] = 255; } };
    dessineTout(() => p);
    const dil = dilater(masque, W, Hh, ep);
    const [cr, cg, cb, ca = 255] = lireCouleur(contour.couleur) ?? [0, 0, 0, 255];
    for (let i = 0; i < dil.length; i++) if (dil[i]) { const o = i * 4; if (img.px[o + 3] < ca) { img.px[o] = cr; img.px[o + 1] = cg; img.px[o + 2] = cb; img.px[o + 3] = ca; } }
  }
  const ecrire = (x, y, a, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= Hh) return;
    const o = (y * W + x) * 4, da = img.px[o + 3];
    if (a >= 255 || da === 0) { img.px[o] = r; img.px[o + 1] = g; img.px[o + 2] = b; img.px[o + 3] = a >= da ? a : da; return; }
    const sa = a / 255, oa = sa + (da / 255) * (1 - sa);
    img.px[o] = (r * sa + img.px[o] * (da / 255) * (1 - sa)) / oa; img.px[o + 1] = (g * sa + img.px[o + 1] * (da / 255) * (1 - sa)) / oa; img.px[o + 2] = (b * sa + img.px[o + 2] * (da / 255) * (1 - sa)) / oa; img.px[o + 3] = oa * 255;
  };
  // 2. ombre du jeu : meme glyphe decale de (1, 1) pixel de police, couleur x 0,25
  if (dec) {
    const sc = typeof ombre === 'object' && ombre.couleur ? lireCouleur(ombre.couleur) : null, op = typeof ombre === 'object' && ombre.opacite !== undefined ? ombre.opacite : 1;   // opacite : ombre douce des legendes
    dessineTout((g) => ({ poser: (x, y, a, r, gg, b) => { const c = g.seg.couleur; const k = 0.25; ecrire(x + dec, y + dec, a * op, sc ? sc[0] : r * c[0] / 255 * k, sc ? sc[1] : gg * c[1] / 255 * k, sc ? sc[2] : b * c[2] / 255 * k); } }));
  }
  // 3. le texte
  dessineTout((g) => ({ poser: (x, y, a, r, gg, b) => { const c = g.seg.couleur; ecrire(x, y, a, r * c[0] / 255, gg * c[1] / 255, b * c[2] / 255); } }));
  return { img, origine: { x: pad, y: oy }, larg, haut, lignes: mp.nbLignes };
}

// Dilatation d'un masque (0 / 255) par un disque de rayon r : on "tamponne" un disque sur chaque pixel de bord.
function dilater(masque, W, H, r) {
  const sortie = new Uint8Array(masque);
  const demi = [];
  for (let dy = -r; dy <= r; dy++) demi.push(Math.floor(Math.sqrt(Math.max(0, (r + 0.35) * (r + 0.35) - dy * dy))));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!masque[y * W + x]) continue;
    const bord = x === 0 || y === 0 || x === W - 1 || y === H - 1 || !masque[y * W + x - 1] || !masque[y * W + x + 1] || !masque[(y - 1) * W + x] || !masque[(y + 1) * W + x];
    if (!bord) continue;
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= H) continue;
      const a = Math.max(0, x - demi[dy + r]), b = Math.min(W - 1, x + demi[dy + r]);
      for (let xx = a; xx <= b; xx++) sortie[yy * W + xx] = 255;
    }
  }
  return sortie;
}
