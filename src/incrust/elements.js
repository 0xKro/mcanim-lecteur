// Elements d'incrustation : chacun fabrique une image (ou dessine directement : fleche, ligne) a partir de sa description controlee
// (montage/format.js) et du contexte de l'image : tailles en fraction du PETIT COTE de l'image (donc les memes en 1080x1920 et 1920x1080).
import fs from 'node:fs';
import path from 'node:path';
import { creerImage, lireCouleur, poserImage, poserAffine, rectPlein, segmentEpais, trianglePlein, redimensionner, composer, flouHorizontal, melangerPixel } from './toile.js';
import { segmentsDeTexte, colorerMots, appliquerCasse, rendreTexte } from './texte.js';
import { sprite, textureGui, decouper, poserSprite } from './sprites.js';
import { iconeObjet } from './icone.js';
import { texture } from '../objets/fichiers.js';
import { decoderPNG } from '../rendu/png.js';
import { refletIcone, aReflet, idRendu } from '../objets/reflet.js';
import { etatLivre, dessinerLivre } from './livre-enchant.js';
import { dessinerApercu } from './apercu-joueur.js';   // livre de la table d'enchantement (partie 26)
import { Aleatoire } from '../moteur/aleatoire.js';   // mots galactiques de la table d'enchantement (EnchantmentNames : java.util.Random)
import { visibleParProfondeur, visibleParTerrain } from './ancrage.js';
import { contenir, couperSegment } from '../montage/zones.js';
import { choisirHauteur } from '../montage/evitement.js';
import { HAUTS, hauteurElement } from '../montage/cadrage.js';   // elements d'ecran du haut : leur place est gardee   // legendes : hors des visages et des torses
import { neutre, etatEntree, etatSortie, etatEmphase, composer2, progressionMot, courbe, COURBE_DEFAUT, DUREE_DEFAUT } from '../montage/mouvement.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sortieCubique = (u) => 1 - Math.pow(1 - clamp01(u), 3);
const BLANC = [255, 255, 255, 255];

// ---------------------------------------------------------------- formats
// 1234567.891 -> "1,234,567.89" (separateur "," decimales 2) ; separateur "" : rien ; le separateur decimal est "." sauf si le separateur est "." ou " " (alors ",").
export function formaterNombre(v, { decimales = 0, separateur = '', decimal = null, prefixe = '', suffixe = '' } = {}) {
  const neg = v < 0, a = Math.abs(v);
  const fixe = a.toFixed(decimales);
  let [ent, dec = ''] = fixe.split('.');
  if (separateur) ent = ent.replace(/\B(?=(\d{3})+(?!\d))/g, separateur);
  const sepDec = decimal ?? (separateur === '.' || separateur === ' ' ? ',' : '.');
  return `${prefixe}${neg ? '-' : ''}${ent}${dec ? sepDec + dec : ''}${suffixe}`;
}

// Teinte -> RGB (comme la barre de durabilite du jeu : hsv(fraction / 3, 1, 1))
export function couleurDurabilite(fraction) {
  const h = clamp01(fraction) / 3, i = Math.floor(h * 6), f = h * 6 - i, q = 1 - f;
  const [r, g, b] = [[1, f, 0], [q, 1, 0], [0, 1, f], [0, q, 1], [f, 0, 1], [1, 0, q]][i % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// ---------------------------------------------------------------- contexte
// ctx : { kit, police, W, H, U (petit cote), t, im, scene, proj, solide, prof, baseDir, cache }
const imagesLocales = new Map();
function pngLocal(ctx, f) {
  const cle = path.resolve(ctx.baseDir ?? '.', f);
  if (imagesLocales.has(cle)) return imagesLocales.get(cle);
  const d = decoderPNG(fs.readFileSync(cle));
  const r = { w: d.largeur, h: d.hauteur, px: new Uint8Array(d.rgba) };
  imagesLocales.set(cle, r);
  return r;
}

// pixels d'image par pixel de police : entier des qu'il vaut 2 ou plus (pixels nets, comme le jeu)
// la police sans (TrueType, lisse) prend l'echelle exacte ; la police du jeu (pixels) reste entiere
const echellePolice = (ctx, taille, lisse = false) => { const s = (taille * ctx.U) / 8; return lisse ? Math.max(0.5, s) : s >= 2 ? Math.round(s) : Math.max(0.5, s); };

// Tailles MINIMALES lisibles sur un telephone (part du petit cote de l'image : 0,05 = 54 px de haut de ligne sur 1080). Une taille plus petite est relevee
// et une note le dit : le texte d'un film vertical se lit a bout de bras, sur un ecran de 6 pouces.
export const TAILLE_MINI = { poste: 0.6, texte: 0.05, legende: 0.05, compteur: 0.05, nom: 0.034, bulle: 0.065, chat: 0.036, fleche: 0.045, horloge: 0.04, succes: 0.8, coffre: 0.6, marchand: 0.6, inventaire: 0.5, hud: 0.6 };
function tailleLisible(ctx, el, type, def, mini = TAILLE_MINI[type] ?? 0) {
  const t = el.taille ?? def;
  if (t >= mini) return t;
  noter(ctx, `mini#${type}#${el.ordre ?? el._seq}`, `${type}${el.texte ? ` "${String(el.texte).slice(0, 18)}"` : ''} a t=${el.t?.[0]} s : taille ${t} relevee a ${mini} (minimum lisible sur un telephone)`);
  return mini;
}

// Echelle (pixels d'ecran par pixel du jeu) d'un panneau de jeu large de `total` pixels de jeu (coffre 176, barre 182, toast 160...).
// Sans `taille` : `part` de la LARGEUR SURE (0,8 = 80 %), arrondie a un ENTIER (pixels nets du jeu), sans depasser la zone ni 0,9 du petit cote.
// Avec `taille` (part du petit cote) : echelle exacte, relevee au minimum lisible (TAILLE_MINI) avec une note.
export function echelleGui(ctx, el, total, type, part) {
  if (el.taille !== undefined) return (tailleLisible(ctx, el, type, el.taille) * ctx.U) / total;
  const zw = ctx.zone?.actif ? ctx.zone.w : ctx.W * 0.92;
  const E = (Math.min(part * zw, 0.9 * ctx.U)) / total;
  if (E < 2) return E;
  return Math.max(2, Math.min(Math.round(E), Math.floor(zw / total)));
}
const eHud = (ctx, el) => echelleGui(ctx, el, 182, 'hud', 0.85);

function imageTexte(ctx, texte, el, defauts = {}) {
  const police = el.police === 'sans' && ctx.policeSans ? ctx.policeSans : ctx.police, lisse = police === ctx.policeSans && !!ctx.policeSans;
  const taille = tailleLisible(ctx, el, defauts.type ?? 'texte', defauts.taille ?? 0.05, defauts.mini);
  const S = echellePolice(ctx, taille, lisse);
  const couleur = el.couleur ?? defauts.couleur ?? BLANC;
  let segs = Array.isArray(texte) ? texte.flatMap(([t, c]) => segmentsDeTexte(t, { couleur: c ?? couleur, gras: el.gras ?? defauts.gras, italique: el.italique }))
    : segmentsDeTexte(texte, { couleur, gras: el.gras ?? defauts.gras, italique: el.italique });
  const idx = el.accent?.length ? Object.fromEntries(el.accent.map((k) => [k, el.couleurAccent ?? [229, 32, 45, 255]])) : null;
  segs = colorerMots(segs, el.couleurs, idx);
  segs = appliquerCasse(segs, el.casse);
  const contour = el.contour !== undefined ? el.contour : defauts.contour;
  let ombre = el.ombre ?? defauts.ombre ?? false;
  if (lisse && ombre === true) ombre = { dec: 0.6, couleur: [0, 0, 0], opacite: 0.55 };   // ombre portee douce des legendes de reference
  const fond = el.fond !== undefined ? el.fond : defauts.fond;
  const largeurMax = (el.largeurMax ?? defauts.largeurMax) ? (el.largeurMax ?? defauts.largeurMax) * ctx.zone.w : Infinity;   // part de la LARGEUR SURE
  const marge = Math.round((el.marge ?? defauts.marge ?? 0) * S);
  const r = rendreTexte(police, segs, {
    S, gras: false, contour: contour ? { couleur: contour.couleur, ep: contour.ep * 8 * S } : null, ombre,
    alignement: el.alignement ?? defauts.alignement ?? 'centre', largeurMax, interligne: el.interligne ?? defauts.interligne ?? 9, fond, marge,
    visibilite: ctx.anim ? visibiliteDe(ctx.anim) : null,
  });
  return { img: r.img, boite: { x: r.origine.x - marge, y: r.origine.y - marge, w: r.larg + 2 * marge, h: r.haut + 2 * marge }, S, lignes: r.lignes };
}

// Image d'un objet agrandie a `px` pixels de cote (pixels nets) ; null si inconnu.
function imageObjet(ctx, id, px) {
  const ic = iconeObjet(ctx.kit, id);
  if (!ic) return null;
  return ic.w >= 32 ? redimensionner(ic, px, px, 'lineaire') : redimensionner(ic, px, px, 'proche');
}

// Icone (+ nombre + barre de durabilite) en une image carree de `px` pixels.
function imageIcone(ctx, { objet, fichier, nombre, barre, reflet }, px, S = null) {
  const base = fichier ? pngLocal(ctx, fichier) : null;
  let im = base ? redimensionner(base, px, px, 'proche') : imageObjet(ctx, objet, px);
  const o = creerImage(px, px);
  if (im) { composer(o, im, 0, 0); if (reflet) refletIcone(ctx.kit, o, (ctx.t ?? 0) * 1000); }   // objet enchante : le reflet du jeu sur l'icone (objets/reflet.js)
  else { const m = creerImage(px, px); for (let i = 0; i < m.px.length; i += 4) { const x = (i / 4) % px, y = Math.floor(i / 4 / px), v = ((x * 2 / px | 0) + (y * 2 / px | 0)) & 1; m.px[i] = v ? 248 : 0; m.px[i + 1] = 0; m.px[i + 2] = v ? 248 : 0; m.px[i + 3] = 255; } composer(o, m, 0, 0); ctx.manquants?.add(objet); }
  const g = px / 16;   // pixels d'image par pixel de GUI
  if (barre !== undefined && barre !== null && barre < 1) {
    const f = clamp01(barre), c = couleurDurabilite(f);
    const bx = Math.round(2 * g), by = Math.round(13 * g), bw = Math.round(13 * g), bh = Math.max(1, Math.round(2 * g));
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) { const k = (y * px + x) * 4; o.px[k] = 0; o.px[k + 1] = 0; o.px[k + 2] = 0; o.px[k + 3] = 255; }
    const fw = Math.max(1, Math.round(13 * f * g));
    for (let y = by; y < by + Math.max(1, Math.round(g)); y++) for (let x = bx; x < bx + fw; x++) { const k = (y * px + x) * 4; o.px[k] = c[0]; o.px[k + 1] = c[1]; o.px[k + 2] = c[2]; o.px[k + 3] = 255; }
  }
  if (nombre !== undefined && nombre !== null && (nombre > 1 || nombre === 0)) {
    const SS = S ?? Math.max(1, Math.round(g));
    const t = rendreTexte(ctx.police, segmentsDeTexte(String(nombre)), { S: SS, ombre: true, alignement: 'droite' });
    // en bas a droite de la case : le bord droit du texte a 1 pixel de GUI du bord, la base a 1 pixel du bas
    const tx = Math.round(px - t.origine.x - t.larg - g * 0), ty = Math.round(px - t.origine.y - 8 * SS + g * 1);
    composer(o, t.img, Math.max(-t.origine.x, tx), ty);
  }
  return o;
}

// Image composee "bas de page" des coeurs ou de la faim.
function imageCoeurs(ctx, el, faim) {
  const E = (el.taille ?? 0.035) * ctx.U / 9;
  const taille9 = Math.max(1, Math.round(9 * E));
  const pas = Math.round(8 * E);
  const n = Math.round(el.max / 2);
  const v = faim ? 'food' : (el.variante === 'poison' ? 'poisoned_' : el.variante === 'wither' ? 'withered_' : el.variante === 'gel' ? 'frozen_' : el.variante === 'absorption' ? 'absorbing_' : '');
  const dur = el.dur ? 'hardcore_' : '';
  const nom = (k) => (faim ? `hud/${k}` : `hud/heart/${k}`);
  const o = creerImage(pas * (n - 1) + taille9, taille9);
  for (let i = 0; i < n; i++) {
    const idx = faim ? n - 1 - i : i;   // la faim se remplit depuis la droite, comme dans le jeu
    const x = i * pas;
    const demi = el.valeur - idx * 2;
    const fond = sprite(ctx.kit, faim ? (el.variante === 'faim' ? 'hud/food_empty_hunger' : 'hud/food_empty') : 'hud/heart/container');
    const plein = demi >= 2, moitie = demi === 1 || (demi > 0 && demi < 2);
    let s = null;
    if (faim) s = plein ? sprite(ctx.kit, el.variante === 'faim' ? 'hud/food_full_hunger' : 'hud/food_full') : moitie ? sprite(ctx.kit, el.variante === 'faim' ? 'hud/food_half_hunger' : 'hud/food_half') : null;
    else s = plein ? sprite(ctx.kit, `hud/heart/${v}${dur}full`) ?? sprite(ctx.kit, 'hud/heart/full') : moitie ? sprite(ctx.kit, `hud/heart/${v}${dur}half`) ?? sprite(ctx.kit, 'hud/heart/half') : null;
    for (const sp of [fond, s]) if (sp) composer(o, redimensionner(sp, taille9, taille9, 'proche'), x, 0);
  }
  return o;
}

// ---------------------------------------------------------------- construction des images (une par element et par etat)
// Retourne { img, boite? ({x,y,w,h} dans l'image : la zone que l'ancre vise), pivot? }.
function construire(el, ctx) {
  const U = ctx.U;
  switch (el.type) {
    case 'texte': {
      const texte = el.segments ?? el.texte;
      return imageTexte(ctx, texte, el, el.legende ? { type: 'legende' } : { type: 'texte', taille: 0.065, contour: { couleur: [10, 10, 10, 255], ep: 0.07 }, gras: true, ombre: false });
    }
    case 'compteur': {
      const [a, b] = el.valeurs;
      const u = clamp01((ctx.t - el.t[0] - (el.delai ?? 0)) / el.duree);
      const f = { decimales: el.decimales, separateur: el.separateur ?? '', decimal: el.decimal ?? null, prefixe: el.prefixe ?? '', suffixe: el.suffixe ?? '' };
      const mode = el.mode ?? 'compte';
      let texte;
      if (mode === 'compte') texte = formaterNombre(a + (b - a) * sortieCubique(u), f);
      else {
        const final = formaterNombre(b, f);
        if (mode === 'saisie') {
          const nb = Math.min(final.length, Math.ceil(u * final.length));
          // chiffre par chiffre : on ne montre que le debut ; le prefixe et le suffixe suivent le meme rythme
          texte = final.slice(0, nb);
        } else {   // roulette : chaque chiffre tourne puis se fixe, de gauche a droite
          const chiffres = [...final].map((c, k) => {
            if (!/\d/.test(c)) return c;
            const fixeA = 0.35 + 0.65 * (k + 1) / final.length;
            return u >= fixeA ? c : String((Number(c) + Math.floor((fixeA - u) * 40) + k * 3) % 10);
          });
          texte = chiffres.join('');
        }
      }
      return imageTexte(ctx, texte, { ...el, alignement: mode === 'saisie' ? 'gauche' : (el.alignement ?? 'centre') }, { type: 'compteur', taille: 0.07, contour: { couleur: [10, 10, 10, 255], ep: 0.07 }, gras: true });
    }
    case 'icone': {
      const px = Math.max(8, Math.round((el.taille ?? 0.12) * U));
      const img = imageIcone(ctx, el, px);
      return { img, boite: { x: 0, y: 0, w: px, h: px } };
    }
    case 'image': {
      const im = pngLocal(ctx, el.fichier);
      const w = Math.max(4, Math.round((el.taille ?? 0.3) * U));
      return { img: redimensionner(im, w, Math.round(w * im.h / im.w), w < im.w ? 'lineaire' : 'proche'), boite: null };
    }
    case 'equation': {
      const px = Math.max(8, Math.round((el.taille ?? 0.1) * U));
      const cases = el.elements.map((x) => (x.objet !== undefined
        ? imageIcone(ctx, x, px, Math.max(1, Math.round(px / 16)))
        : imageTexte(ctx, x.texte, { ...el, couleur: x.couleur ?? el.couleur ?? BLANC, taille: (el.taille ?? 0.1) * 0.6 }, { contour: { couleur: [10, 10, 10, 255], ep: 0.07 }, gras: true }).img));
      const gap = Math.round((el.espacement ?? 0.3) * px);
      const W = cases.reduce((a, c) => a + c.w, 0) + gap * (cases.length - 1), H = Math.max(...cases.map((c) => c.h));
      const o = creerImage(W, H); let x = 0;
      for (const c of cases) { composer(o, c, x, Math.round((H - c.h) / 2)); x += c.w + gap; }
      return { img: o, boite: null };
    }
    case 'coeurs': case 'faim': return { img: imageCoeurs(ctx, el, el.type === 'faim'), boite: null };
    case 'horloge': case 'minuteur': {
      const px = Math.max(8, Math.round((el.taille ?? 0.12) * U));
      const [p0, p1] = el.progression;
      const u = clamp01((ctx.t - el.t[0]) / (el.t[1] - el.t[0]));
      const tour = p0 + (p1 - p0) * u, frame = Math.floor((tour - Math.floor(tour)) * 64) % 64;
      const tex = texture(ctx.kit, `item/clock_${String(frame).padStart(2, '0')}`);
      const o = creerImage(px, px);
      if (tex) composer(o, redimensionner({ w: tex.largeur, h: tex.hauteur, px: tex.rgba }, px, px, 'proche'), 0, 0);
      let etiquette = el.etiquette;
      if (etiquette === undefined && el.type === 'minuteur' && el.duree) { const r = Math.max(0, Math.round(el.duree * (1 - u))); etiquette = `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; }
      if (!etiquette) return { img: o, boite: { x: 0, y: 0, w: px, h: px } };
      const tx = imageTexte(ctx, etiquette, { ...el, taille: (el.taille ?? 0.12) * 0.42 }, { type: 'horloge', contour: { couleur: [10, 10, 10, 255], ep: 0.07 }, gras: true });
      const W = Math.max(px, tx.img.w), H = px + tx.img.h;
      const c = creerImage(W, H);
      composer(c, o, Math.round((W - px) / 2), 0); composer(c, tx.img, Math.round((W - tx.img.w) / 2), px);
      return { img: c, boite: { x: 0, y: 0, w: W, h: H } };
    }
    case 'nom': {
      const t = imageTexte(ctx, el.texte ?? el.acteur, { ...el, taille: el.taille ?? 0.04 }, { type: 'nom', gras: false, ombre: false, fond: [0, 0, 0, 64], marge: 1 });
      return t;
    }
    case 'bulle': return imageBulle(ctx, el);
    case 'chat': return imageChat(ctx, el);
    case 'succes': return imageSucces(ctx, el);
    case 'inventaire': return imageInventaire(ctx, el);
    case 'coffre': return imageCoffre(ctx, el);
    case 'marchand': return imageMarchand(ctx, el);
    case 'hud': return imageHud(ctx, el);
    case 'poste': return imagePoste(ctx, el);
    default: return null;
  }
}

// Infobulle : fond et cadre du jeu (sprites tooltip/), texte colore par les codes §.
function imageBulle(ctx, el) {
  const tb0 = tailleLisible(ctx, el, "bulle", 0.075);
  const S = echellePolice(ctx, tb0);
  const texte = el.lignes.map((l) => l.texte).join('\n');
  const t = imageTexte(ctx, texte, { ...el, taille: tb0, alignement: 'gauche', largeurMax: undefined }, { type: 'bulle', ombre: true, gras: false, interligne: 10, couleur: BLANC });
  const marge = Math.round(7 * S), tb = t.boite;
  const w = tb.w + 2 * marge, h = tb.h + 2 * marge;
  const o = creerImage(w, h);
  const film = o.px, bg = sprite(ctx.kit, 'tooltip/background'), cadre = sprite(ctx.kit, 'tooltip/frame');
  // dessine les sprites dans une image opaque temporaire : on passe par une "image de film" vide (alpha traite par le melange)
  const tmp = new Uint8Array(w * h * 4);
  if (bg && cadre) {
    poserSpriteAlpha(o, bg, 0, 0, w, h, S); poserSpriteAlpha(o, cadre, 0, 0, w, h, S);
  } else { for (let i = 0; i < w * h; i++) { film[i * 4] = 16; film[i * 4 + 1] = 0; film[i * 4 + 2] = 16; film[i * 4 + 3] = 240; } }
  void tmp;
  composer(o, t.img, marge - tb.x, marge - tb.y);
  return { img: o, boite: { x: 0, y: 0, w, h } };
}
// Pose un sprite (nine-slice ou simple) dans une image avec alpha (pas dans une image de film).
function poserSpriteAlpha(dst, spr, x, y, w, h, E) {
  const d = spr.decoupe;
  const piece = (src, dx, dy, dw, dh) => { if (dw > 0 && dh > 0 && src.w > 0 && src.h > 0) composer(dst, redimensionner(src, Math.max(1, Math.round(dw)), Math.max(1, Math.round(dh)), 'proche'), Math.round(dx), Math.round(dy)); };
  if (!d) return piece(spr, x, y, w, h);
  const g = d.gauche * E, hh = d.haut * E, dr = d.droite * E, b = d.bas * E;
  const xs = [0, d.gauche, spr.w - d.droite, spr.w], ys = [0, d.haut, spr.h - d.bas, spr.h];
  const xd = [x, x + g, x + w - dr, x + w], yd = [y, y + hh, y + h - b, y + h];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) piece(decouper(spr, xs[i], ys[j], xs[i + 1] - xs[i], ys[j + 1] - ys[j]), xd[i], yd[j], xd[i + 1] - xd[i], yd[j + 1] - yd[j]);
}

// Lignes de chat en haut a gauche : bande sombre translucide par ligne, texte avec ombre, les lignes datees apparaissent a leur temps.
function imageChat(ctx, el) {
  const tc = tailleLisible(ctx, el, 'chat', 0.042);
  const S = echellePolice(ctx, tc);
  const tt = ctx.t;
  const vis = [];
  for (const l of el.lignes) {
    const t0 = l.t ?? el.t[0];
    if (tt < t0) continue;
    const age = tt - t0;
    if (age > el.vie) continue;
    let a = clamp01(age / 0.15);
    if (el.vie !== Infinity) a *= clamp01((el.vie - age) / (el.fondu || 0.001));
    vis.push({ l, a });
  }
  if (!vis.length) return null;
  // les messages longs passent a la ligne dans la largeur sure (une ligne de chat de jeu depasserait l'image a cette taille)
  const lignes = vis.map(({ l, a }) => ({ ...imageTexte(ctx, l.texte, { ...el, taille: tc, alignement: 'gauche', largeurMax: el.largeurMax ?? 0.94 }, { type: 'chat', ombre: true, gras: false, couleur: BLANC }), a }));
  const lh = Math.round(9 * S), W = Math.max(...lignes.map((x) => x.boite.w)) + Math.round(4 * S);
  const hs = lignes.map((x) => lh * Math.max(1, x.lignes ?? 1)), HT = hs.reduce((a, b) => a + b, 0);
  const o = creerImage(W, HT);
  let yy = 0;
  lignes.forEach((x, k) => {
    const bande = creerImage(W, hs[k]);
    for (let i = 0; i < bande.px.length; i += 4) { bande.px[i + 3] = 128 * x.a; }
    composer(o, bande, 0, yy);
    composer(o, x.img, Math.round(2 * S) - x.boite.x, yy + Math.round(1 * S) - x.boite.y, { alpha: x.a });
    yy += hs[k];
  });
  return { img: o, boite: { x: 0, y: 0, w: W, h: o.h } };
}

// Toast de succes du jeu : sprite 160 x 32, icone a gauche, deux lignes de texte.
function imageSucces(ctx, el) {
  const E = echelleGui(ctx, el, 160, 'succes', 0.8);
  const S = Math.max(1, Math.round(E));
  const spr = sprite(ctx.kit, 'toast/advancement');
  const w = Math.round(160 * E), h = Math.round(32 * E);
  const o = creerImage(w, h);
  if (spr) composer(o, redimensionner(spr, w, h, 'proche'), 0, 0);
  else { for (let i = 0; i < o.px.length; i += 4) { o.px[i] = 30; o.px[i + 1] = 30; o.px[i + 2] = 30; o.px[i + 3] = 230; } }
  const px = Math.round(16 * E);
  if (el.objet) { const ic = imageIcone(ctx, { objet: el.objet }, px); composer(o, ic, Math.round(8 * E), Math.round(8 * E)); }
  const titre = rendreTexte(ctx.police, segmentsDeTexte(el.titre ?? 'Advancement Made!', { couleur: [255, 255, 0] }), { S: E, ombre: true, alignement: 'gauche' });
  composer(o, titre.img, Math.round(30 * E) - titre.origine.x, Math.round(7 * E) - titre.origine.y);
  if (el.texte) { const d = rendreTexte(ctx.police, segmentsDeTexte(el.texte, { couleur: [255, 255, 255] }), { S: E, ombre: true, alignement: 'gauche' }); composer(o, d.img, Math.round(30 * E) - d.origine.x, Math.round(18 * E) - d.origine.y); }
  void S;
  return { img: o, boite: { x: 0, y: 0, w, h } };
}

// Panneau d'inventaire : une barre (sprite hotbar) ou une grille de cases (fond du jeu), icones, nombres, barres de durabilite, cases surlignees.
function imageInventaire(ctx, el, Eforce = null) {
  const cols = el.colonnes, rows = Math.ceil(el.cases.length / cols);
  const style = el.style ?? (rows === 1 ? 'barre' : 'grille');
  const total = style === 'barre' ? 182 : cols * 18 + 14;
  const E = Eforce ?? echelleGui(ctx, el, total, 'inventaire', 0.8);
  const Sg = Math.max(1, Math.round(E));
  let o, pos;   // pos(k) -> [x, y] de l'icone (pixels d'image)
  if (style === 'barre') {
    const hb = sprite(ctx.kit, 'hud/hotbar');
    const w = Math.round(182 * E), h = Math.round(22 * E);
    o = creerImage(w, h);
    if (hb) composer(o, redimensionner(hb, w, h, 'proche'), 0, 0);
    pos = (k) => [Math.round((3 + 20 * k) * E), Math.round(3 * E)];
  } else {
    const w = Math.round(total * E), h = Math.round((rows * 18 + 14) * E);
    o = creerImage(w, h);
    const gris = [198, 198, 198], clair = [255, 255, 255], sombre = [85, 85, 85];
    const remplir = (x0, y0, x1, y1, c) => { for (let y = Math.round(y0 * E); y < Math.round(y1 * E); y++) for (let x = Math.round(x0 * E); x < Math.round(x1 * E); x++) { const i = (y * w + x) * 4; o.px[i] = c[0]; o.px[i + 1] = c[1]; o.px[i + 2] = c[2]; o.px[i + 3] = 255; } };
    remplir(0, 0, total, rows * 18 + 14, [0, 0, 0]); remplir(0, 0, total - 2, rows * 18 + 12, clair); remplir(2, 2, total, rows * 18 + 14, sombre); remplir(2, 2, total - 2, rows * 18 + 12, gris);
    const cont = textureGui(ctx.kit, 'container/generic_54');
    const cell = cont ? decouper(cont, 7, 17, 18, 18) : null;
    for (let k = 0; k < cols * rows; k++) {
      const x = 7 + (k % cols) * 18, y = 7 + Math.floor(k / cols) * 18;
      if (cell) composer(o, redimensionner(cell, Math.round(18 * E), Math.round(18 * E), 'proche'), Math.round(x * E), Math.round(y * E));
      else { remplir(x, y, x + 18, y + 18, sombre); remplir(x + 1, y + 1, x + 17, y + 17, [139, 139, 139]); }
    }
    pos = (k) => [Math.round((8 + (k % cols) * 18) * E), Math.round((8 + Math.floor(k / cols) * 18) * E)];
  }
  const px = Math.round(16 * E);
  el.cases.forEach((c, k) => { if (c) { const [x, y] = pos(k); composer(o, imageIcone(ctx, c, px, Sg), x, y); } });
  if (style === 'barre' && el.selection !== undefined) {
    const sel = sprite(ctx.kit, 'hud/hotbar_selection');
    if (sel) composer(o, redimensionner(sel, Math.round(24 * E), Math.round(23 * E), 'proche'), Math.round((-1 + 20 * el.selection) * E), Math.round(-1 * E));
  }
  for (const k of el.surligner ?? []) {   // carre rouge autour de la case (comme dans les explications)
    const [x, y] = pos(k), e = Math.max(2, Math.round(E)), c = Math.round(18 * E), x0 = x - Math.round(E), y0 = y - Math.round(E);
    for (let j = 0; j < c; j++) for (let i = 0; i < c; i++) if (i < e || j < e || i >= c - e || j >= c - e) { const X = x0 + i, Y = y0 + j; if (X >= 0 && Y >= 0 && X < o.w && Y < o.h) { const q = (Y * o.w + X) * 4; o.px[q] = 255; o.px[q + 1] = 30; o.px[q + 2] = 30; o.px[q + 3] = 255; } }
  }
  return { img: o, boite: { x: 0, y: 0, w: o.w, h: o.h } };
}

// Ecran d'un conteneur (coffre) : le fond du jeu (container/generic_54.png : titre, rangees de cases), le titre en gris sombre sans ombre, les icones avec leur nombre.
// Le jeu ne montre pas le contenu d'un coffre ouvert dans le monde : c'est CET ecran que le joueur voit. Sans "joueur", on garde le haut du panneau et son bord du bas.
function imageCoffre(ctx, el) {
  // sans `taille` : TOUTE la largeur sure (test combat v3 : a 80 % et echelle entiere, 704 px sur 1080, le panneau paraissait petit) ;
  // l'echelle n'est plus entiere (4,69 en zone "toutes") : les pixels du jeu font 4 ou 5 px, invisible apres compression video.
  const rows = el.rangees, zw = ctx.zone?.actif ? ctx.zone.w : ctx.W * 0.92;
  const E = el.taille !== undefined ? echelleGui(ctx, el, 176, 'coffre', 0.8) : Math.max(2, Math.min(zw, 0.9 * ctx.U) / 176), Sg = Math.max(1, Math.round(E));
  const hTop = rows * 18 + 17, hBas = el.joueur ? 96 : 7;
  const w = Math.round(176 * E), hT = Math.round(hTop * E), h = Math.round((hTop + hBas) * E);
  const o = creerImage(w, h);
  const tex = textureGui(ctx.kit, 'container/generic_54');
  if (tex) {
    composer(o, redimensionner(decouper(tex, 0, 0, 176, hTop), w, hT, 'proche'), 0, 0);
    composer(o, redimensionner(decouper(tex, 0, el.joueur ? 126 : 215, 176, hBas), w, h - hT, 'proche'), 0, hT);
  } else {   // texture absente du kit : panneau gris et cases creuses
    const remplir = (x0, y0, x1, y1, c) => { for (let y = Math.round(y0 * E); y < Math.round(y1 * E); y++) for (let x = Math.round(x0 * E); x < Math.round(x1 * E); x++) { const i = (y * w + x) * 4; o.px[i] = c[0]; o.px[i + 1] = c[1]; o.px[i + 2] = c[2]; o.px[i + 3] = 255; } };
    remplir(0, 0, 176, hTop + hBas, [198, 198, 198]);
    for (let k = 0; k < rows * 9; k++) { const x = 7 + (k % 9) * 18, y = 17 + Math.floor(k / 9) * 18; remplir(x, y, x + 18, y + 18, [85, 85, 85]); remplir(x + 1, y + 1, x + 17, y + 17, [139, 139, 139]); }
  }
  const titre = rendreTexte(ctx.police, segmentsDeTexte(el.titre ?? 'Coffre', { couleur: [64, 64, 64] }), { S: Sg, alignement: 'gauche' });
  composer(o, titre.img, Math.round(8 * E) - titre.origine.x, Math.round(6 * E) - titre.origine.y);
  const px = Math.round(16 * E);
  el.cases.forEach((c, k) => { if (c) composer(o, imageIcone(ctx, c, px, Sg), Math.round((8 + (k % 9) * 18) * E), Math.round((18 + Math.floor(k / 9) * 18) * E)); });
  return { img: o, boite: { x: 0, y: 0, w: o.w, h: o.h } };
}

// Ecran du marchand (MerchantScreen, gui/container/villager.png 276 x 166) : la liste des offres a gauche (boutons de 88 x 20 a x 5,
// y 18 + 20 i : prix a x + 5, deuxieme prix a x + 30, fleche, resultat a x + 63), l'offre choisie dans les cases a droite (136, 37 ;
// 162, 37 ; 220, 37), le titre centre. Sans la texture du kit : panneau gris.
function imageMarchand(ctx, el) {
  const zw = ctx.zone?.actif ? ctx.zone.w : ctx.W * 0.92;
  const E = el.taille !== undefined ? echelleGui(ctx, el, 276, 'marchand', 0.8) : Math.max(2, Math.min(zw, 0.9 * ctx.U) / 276), Sg = Math.max(1, Math.round(E));
  const w = Math.round(276 * E), h = Math.round(166 * E), o = creerImage(w, h);
  const remplir = (x0, y0, x1, y1, c) => { for (let y = Math.round(y0 * E); y < Math.round(y1 * E); y++) for (let x = Math.round(x0 * E); x < Math.round(x1 * E); x++) { const i = (y * w + x) * 4; o.px[i] = c[0]; o.px[i + 1] = c[1]; o.px[i + 2] = c[2]; o.px[i + 3] = c[3] ?? 255; } };
  const tex = textureGui(ctx.kit, 'container/villager');
  if (tex) composer(o, redimensionner(decouper(tex, 0, 0, 276, 166), w, h, 'proche'), 0, 0);
  else remplir(0, 0, 276, 166, [198, 198, 198]);
  const px = Math.round(16 * E), icone = (c, x, y) => { if (c) composer(o, imageIcone(ctx, c, px, Sg), Math.round(x * E), Math.round(y * E)); };
  el.offres.forEach((f, i) => {
    const y = 18 + 20 * i;
    if (i === el.selection) remplir(5, y, 93, y + 20, [255, 255, 255, 70]);
    icone(f.a, 10, y + 2); icone(f.b, 35, y + 2); icone(f.r, 68, y + 2);
    const fl = sprite(ctx.kit, 'container/villager/trade_arrow');
    if (fl) composer(o, redimensionner(fl, Math.round(10 * E), Math.round(9 * E), 'proche'), Math.round(55 * E), Math.round((y + 5) * E));
  });
  const s = el.offres[el.selection]; icone(s.a, 136, 37); icone(s.b, 162, 37); icone(s.r, 220, 37);
  const titre = rendreTexte(ctx.police, segmentsDeTexte(el.titre, { couleur: [64, 64, 64] }), { S: Sg, alignement: 'gauche' });
  composer(o, titre.img, Math.round((49 + 227 / 2) * E) - Math.round(titre.img.w / 2) - titre.origine.x, Math.round(6 * E) - titre.origine.y);
  return { img: o, boite: { x: 0, y: 0, w: o.w, h: o.h } };
}

// Ecran du poste ouvert par un acteur simule (replay.ecrans, moteur/objets-actes.js) : le fond du jeu (gui/container/<poste>.png, 176 x 166),
// les cases aux places des menus du jeu (relues dans Horizon game/inventory_slots.rs et stations.rs : etabli 3 x 3 a (30 + 18 c, 17 + 18 r),
// resultat (124, 35) ; inventaire 2 x 2 a (98 + 18 c, 18 + 18 r), resultat (154, 28) ; alambic : fioles (56, 51) (79, 58) (102, 51),
// ingredient (79, 17), poudre (17, 17) ; table d'enchantement : objet (15, 47), lapis (35, 47), boutons (60, 14 + 19 k) ; enclume (27, 47)
// (76, 47) -> (134, 47) ; tailleur (20, 33) -> (143, 33) ; forge (8, 48) (26, 48) (44, 48) -> (98, 48)), l'inventaire du joueur en bas
// (8 + 18 c, 84 + 18 r ; barre 142), le titre en gris sombre.
const FONDS_POSTE = { etabli: 'crafting_table', inventaire: 'inventory', alambic: 'brewing_stand', enchantement: 'enchanting_table', enclume: 'anvil', tailleur: 'stonecutter', forge: 'smithing' };
const TITRES_POSTE = { etabli: 'Crafting', inventaire: 'Crafting', alambic: 'Brewing Stand', enchantement: 'Enchant', enclume: 'Repair & Name', tailleur: 'Stonecutter', forge: 'Upgrade Gear' };
const MOTS_GALACTIQUES = 'the elder scrolls klaatu berata niktu xyzzy bless curse light darkness fire air earth water hot dry cold wet ignite snuff embiggen twist shorten stretch fiddle destroy imbue galvanize enchant free limited range of towards inside sphere cube self other ball mental physical grow shrink demon elemental spirit animal creature beast humanoid undead fresh stale phnglui mglwnafh cthulhu rlyeh wgahnagl fhtagn baguette'.split(' ');   // EnchantmentNames du jeu 26.3 (liste relue dans la classe du JAR du client, ordre du tableau)
function imagePoste(ctx, el) {
  const v = el.poste;
  const zw = ctx.zone?.actif ? ctx.zone.w : ctx.W * 0.92;
  const E = el.taille !== undefined ? echelleGui(ctx, el, 176, 'poste', 0.6) : Math.max(2, Math.min(zw, 0.9 * ctx.U) / 176), Sg = Math.max(1, Math.round(E));
  const w = Math.round(176 * E), h = Math.round(166 * E), o = creerImage(w, h);
  const tex = textureGui(ctx.kit, 'container/' + (FONDS_POSTE[v.type] ?? 'crafting_table'));
  if (tex) composer(o, redimensionner(decouper(tex, 0, 0, 176, 166), w, h, 'proche'), 0, 0);
  const px = Math.round(16 * E);
  let genGalactique = null;
  const icone = (t, x, y, n) => { if (!t) return; const id = idRendu(t); composer(o, imageIcone(ctx, { objet: id, reflet: aReflet(t, ctx.scene?._refletsForces), ...(n > 1 ? { nombre: n } : {}) }, px, Sg), Math.round(x * E), Math.round(y * E)); };
  const g = v.grille ?? [];
  if (v.type === 'etabli') { g.forEach((c, k) => icone(c, 30 + (k % 3) * 18, 17 + Math.floor(k / 3) * 18)); icone(v.resultat, 124, 35, v.n); }
  else if (v.type === 'inventaire') {
    const ap = ctx.scene?._apercus?.get(v.acteur)?.();   // le joueur dans sa boite (incrust/apercu-joueur.js)
    if (ap) dessinerApercu(o, E, ap.m, ap.accroupi);
    // armure (8, 8 + 18 k) et main gauche (77, 62) ; case vide : icone fantome (InventoryMenu : container/slot/helmet... shield)
    const fant = (nom, x, y) => { const s = sprite(ctx.kit, 'container/slot/' + nom); if (s) composer(o, redimensionner(s, px, px, 'proche'), Math.round(x * E), Math.round(y * E)); };
    ['helmet', 'chestplate', 'leggings', 'boots'].forEach((nom, k) => { const a = (v.armures ?? [])[k]; if (a) icone(a, 8, 8 + 18 * k); else fant(nom, 8, 8 + 18 * k); });
    if (v.gauche) icone(v.gauche, 77, 62); else fant('shield', 77, 62);
    g.forEach((c, k) => icone(c, 98 + (k % 2) * 18, 18 + Math.floor(k / 2) * 18)); icone(v.resultat, 154, 28, v.n); }
  else if (v.type === 'tailleur') { icone(g[0], 20, 33); icone(v.resultat, 143, 33, v.n); }
  else if (v.type === 'forge') { icone(g[0], 8, 48); icone(g[1], 26, 48); icone(g[2], 44, 48); icone(v.resultat, 98, 48, v.n); }
  else if (v.type === 'enclume') {
    icone(v.gauche, 27, 47); icone(v.droite, 76, 47); icone(v.resultat, 134, 47);
    const c = rendreTexte(ctx.police, segmentsDeTexte(`Enchantment Cost: ${v.cout}`, { couleur: v.cout >= 40 ? [255, 96, 96] : [128, 255, 32] }), { S: Sg, alignement: 'gauche' });   // AnvilScreen : 0x80FF20 (vert), rouge si trop cher
    composer(o, c.img, Math.round((176 - 8) * E) - c.img.w, Math.round(69 * E) - c.origine.y);
    if (v.nom) { const nm = rendreTexte(ctx.police, segmentsDeTexte(v.nom, { couleur: [255, 255, 255] }), { S: Sg, alignement: 'gauche' }); composer(o, nm.img, Math.round(62 * E) - nm.origine.x, Math.round(24 * E) - nm.origine.y); }
  } else if (v.type === 'alambic') {
    const c = v.contenu ?? {};
    (c.fioles ?? []).forEach((f, k) => icone(f, [56, 79, 102][k], [51, 58, 51][k]));
    icone(c.ingredient, 79, 17, c.nIngredient); icone(c.carburant, 17, 17, c.nCarburant);
    // BrewingStandScreen : jauge de poudre clamp((18 x reste + 19) / 20, 0, 18) a (60, 44) ; fleche 28 x (1 - t / 400) a (97, 16) ; bulles
    // BUBBLELENGTHS[t / 2 % 7] (29, 24, 20, 16, 11, 6, 0) a (63, 14)
    const jauge = Math.max(0, Math.min(18, Math.floor((18 * (c.reserve ?? 0) + 19) / 20))), sj = sprite(ctx.kit, 'container/brewing_stand/fuel_length');
    if (sj && jauge > 0) composer(o, redimensionner(decouper(sj, 0, 0, jauge, 4), Math.round(jauge * E), Math.round(4 * E), 'proche'), Math.round(60 * E), Math.round(44 * E));
    if ((c.infusion ?? 0) > 0) {
      const hf = Math.round(28 * (1 - c.infusion / (c.duree || 400))), sp = sprite(ctx.kit, 'container/brewing_stand/brew_progress'), sb = sprite(ctx.kit, 'container/brewing_stand/bubbles');
      if (sp && hf > 0) composer(o, redimensionner(decouper(sp, 0, 0, 9, hf), Math.round(9 * E), Math.round(hf * E), 'proche'), Math.round(97 * E), Math.round(16 * E));
      const hb = [29, 24, 20, 16, 11, 6, 0][Math.floor(c.infusion / 2) % 7];
      if (sb && hb > 0) composer(o, redimensionner(decouper(sb, 0, 29 - hb, 12, hb), Math.round(12 * E), Math.round(hb * E), 'proche'), Math.round(63 * E), Math.round((14 + 29 - hb) * E));
    }
  } else if (v.type === 'enchantement') {
    // le livre ouvert au-dessus des offres (EnchantmentScreen.extractBook, incrust/livre-enchant.js) : pose, s'ouvre de 0,2 par tick
    const lv = etatLivre(Math.max(0, v.age ?? 0), v.graine ?? 0, (v.couts ?? []).some((c) => c > 0));
    dessinerLivre(ctx.kit, o, E, 14, 14, lv.open, lv.flip);
    icone(v.objet, 15, 47); icone('lapis_lazuli', 35, 47, 3);
    for (let k = 0; k < 3; k++) {
      const cout = v.couts?.[k] ?? 0, actif = cout > 0 && (v.niveaux ?? 0) >= cout;
      const sp = sprite(ctx.kit, cout <= 0 ? 'container/enchanting_table/enchantment_slot_disabled' : k === v.choisi ? 'container/enchanting_table/enchantment_slot_highlighted' : actif ? 'container/enchanting_table/enchantment_slot' : 'container/enchanting_table/enchantment_slot_disabled');
      if (sp) composer(o, redimensionner(sp, Math.round(108 * E), Math.round(19 * E), 'proche'), Math.round(60 * E), Math.round((14 + 19 * k) * E));
      if (cout > 0) {
        const lv = sprite(ctx.kit, `container/enchanting_table/level_${k + 1}${actif ? '' : '_disabled'}`);
        if (lv) composer(o, redimensionner(lv, Math.round(16 * E), Math.round(16 * E), 'proche'), Math.round(61 * E), Math.round((15 + 19 * k) * E));
        const ct = rendreTexte(ctx.police, segmentsDeTexte(String(cout), { couleur: actif ? [128, 255, 32] : [64, 127, 16] }), { S: Sg, alignement: 'gauche' });
        composer(o, ct.img, Math.round((60 + 104) * E) - ct.img.w, Math.round((14 + 19 * k + 8) * E) - ct.origine.y);
        if (ctx.policeAlt) {   // EnchantmentNames.getRandomName (graine de l'acteur, java.util.Random) : nextInt(2) + 3 mots, alphabet galactique, couleur 0x685E4A
          const R = (genGalactique ??= new Aleatoire(v.graine ?? 0));
          let mots = Array.from({ length: R.entierBorne(2) + 3 }, () => MOTS_GALACTIQUES[R.entierBorne(MOTS_GALACTIQUES.length)]).join(' ');
          // EnchantmentScreen : largeur 86 - largeur du cout (6 par chiffre) ; getRandomName garde le debut qui tient (headByWidth, lettre par lettre)
          const larg = 86 - 6 * String(cout).length, coul = { couleur: actif ? [104, 94, 74] : [52, 47, 37] };
          let gl = rendreTexte(ctx.policeAlt, segmentsDeTexte(mots, coul), { S: Sg, ombre: false, alignement: 'gauche' });
          while (mots.length > 1 && gl.larg > larg * E) { mots = mots.slice(0, -1); gl = rendreTexte(ctx.policeAlt, segmentsDeTexte(mots, coul), { S: Sg, ombre: false, alignement: 'gauche' }); }
          composer(o, gl.img, Math.round((60 + 20) * E) - gl.origine.x, Math.round((14 + 19 * k + 2) * E) - gl.origine.y);   // a (x + 20, y + 2)
        }
      }
    }
  }
  // inventaire du joueur (le sac) : les cases 0 a 8 sont la barre (y 142), les 27 suivantes les trois rangees (84 + 18 r) (Inventory du jeu)
  (v.sac ?? []).forEach((c, k) => { if (!c) return; const [t, n] = c, x = 8 + (k % 9) * 18, y = k < 9 ? 142 : 84 + Math.floor((k - 9) / 9) * 18; if (k < 36) icone(t, x, y, n); });
  // cases vides de l'alambic : icones fantomes (BrewingStandScreen : container/slot/potion, container/slot/brewing_fuel)
  if (v.type === 'alambic') {
    const c = v.contenu ?? {}, fant = (nom, x, y) => { const s = sprite(ctx.kit, 'container/slot/' + nom); if (s) composer(o, redimensionner(s, px, px, 'proche'), Math.round(x * E), Math.round(y * E)); };
    [0, 1, 2].forEach((k) => { if (!(c.fioles ?? [])[k]) fant('potion', [56, 79, 102][k], [51, 58, 51][k]); });
    if (!c.carburant) fant('brewing_fuel', 17, 17);
  }
  // bouton du livre de recettes (AbstractRecipeBookScreen : etabli (5, 34), inventaire (104, 61) ; Horizon game/recipe_book.rs book_button_pos)
  if (v.type === 'etabli' || v.type === 'inventaire') {
    const s = sprite(ctx.kit, 'recipe_book/button');
    if (s) composer(o, redimensionner(s, Math.round(20 * E), Math.round(18 * E), 'proche'), Math.round((v.type === 'etabli' ? 5 : 104) * E), Math.round((v.type === 'etabli' ? 34 : 61) * E));
  }
  // titre (titleLabelX, titleLabelY : Horizon game/stations.rs title_pos ; alambic centre) et "Inventory" a (8, 72) (sauf l'inventaire seul)
  const titre = rendreTexte(ctx.police, segmentsDeTexte(TITRES_POSTE[v.type] ?? '', { couleur: [64, 64, 64] }), { S: Sg, alignement: 'gauche' });
  const TX = { etabli: 29, inventaire: 97, enclume: 60, forge: 44 }, TY = { forge: 15, tailleur: 5 };
  const tx = v.type === 'alambic' ? Math.round((176 * E - titre.larg) / 2) : Math.round((TX[v.type] ?? 8) * E);
  composer(o, titre.img, tx - titre.origine.x, Math.round((TY[v.type] ?? 6) * E) - titre.origine.y);
  if (v.type !== 'inventaire') {
    const inv = rendreTexte(ctx.police, segmentsDeTexte('Inventory', { couleur: [64, 64, 64] }), { S: Sg, alignement: 'gauche' });
    composer(o, inv.img, Math.round(8 * E) - inv.origine.x, Math.round(72 * E) - inv.origine.y);
  }
  return { img: o, boite: { x: 0, y: 0, w: o.w, h: o.h } };
}

// HUD de jeu : barre d'objets, coeurs, faim, barre d'experience (+ niveau). Le viseur est dessine a part, au centre de l'image.
function imageHud(ctx, el) {
  const E = eHud(ctx, el);
  // relie a la simulation (champ joueur) : rangee de plus pour l'armure (au-dessus des coeurs), l'air (au-dessus de la faim) et l'absorption (Gui.renderPlayerHealth)
  const plus = (el.armurePts > 0 || (el.air ?? 300) < 300 || el.absorption > 0 || (el.vieMax ?? 20) > 20) ? 10 : 0;
  const w = Math.round(182 * E), h = Math.round((49 + plus) * E);
  const o = creerImage(w, h);
  if (plus) {
    const yp = 0, s9 = Math.max(1, Math.round(9 * E)), pas = Math.round(8 * E);
    if (el.absorption > 0 || (el.vieMax ?? 20) > 20) {   // coeurs au-dela de 20 (Bonus de vie) puis coeurs d'or (absorption), rangee du dessus
      const ab = imageCoeurs(ctx, { valeur: Math.max(0, el.coeurs - 20) + 0, max: Math.max(2, (el.vieMax ?? 20) - 20), taille: 9 * E / ctx.U, variante: el.variante }, false);
      if ((el.vieMax ?? 20) > 20) composer(o, ab, 0, yp);
      if (el.absorption > 0) composer(o, imageCoeurs(ctx, { valeur: el.absorption, max: Math.ceil(el.absorption / 2) * 2, taille: 9 * E / ctx.U, variante: 'absorption' }, false), (el.vieMax ?? 20) > 20 ? ab.w + pas : 0, yp);
    } else if (el.armurePts > 0) {   // armure : 10 icones, pleine, moitie, vide
      for (let i = 0; i < 10; i++) { const k = el.armurePts - i * 2, sp = sprite(ctx.kit, k >= 2 ? 'hud/armor_full' : k === 1 ? 'hud/armor_half' : 'hud/armor_empty'); if (sp) composer(o, redimensionner(sp, s9, s9, 'proche'), i * pas, yp); }
    }
    if ((el.air ?? 300) < 300) {   // air : ceil((air - 2) x 10 / 300) bulles pleines, la suivante qui eclate (Gui.renderAirBubbles), a droite
      const plein = Math.ceil((Math.max(0, el.air) - 2) * 10 / 300), eclate = Math.ceil(Math.max(0, el.air) * 10 / 300) - plein;
      for (let i = 0; i < plein + eclate && i < 10; i++) { const sp = sprite(ctx.kit, i < plein ? 'hud/air' : 'hud/air_bursting'); if (sp) composer(o, redimensionner(sp, s9, s9, 'proche'), w - s9 - i * pas, yp); }
    }
  }
  const hotbar = imageInventaire(ctx, { cases: Array.from({ length: 9 }, (_, k) => el.cases?.[k] ?? null), colonnes: 9, selection: el.selection }, E).img;
  composer(o, hotbar, 0, h - hotbar.h);
  const fond = sprite(ctx.kit, 'hud/experience_bar_background'), prog = sprite(ctx.kit, 'hud/experience_bar_progress');
  const yx = Math.round((49 + plus - 22 - 7) * E);
  if (fond) composer(o, redimensionner(fond, w, Math.round(5 * E), 'proche'), 0, yx);
  if (prog && el.xp > 0) { const pw = Math.max(1, Math.round(182 * el.xp)); composer(o, redimensionner(decouper(prog, 0, 0, pw, 5), Math.round(pw * E), Math.round(5 * E), 'proche'), 0, yx); }
  const yc = Math.round((49 + plus - 22 - 7 - 10) * E);
  composer(o, imageCoeurs(ctx, { valeur: Math.min(20, el.coeurs), max: 20, taille: 9 * E / ctx.U, variante: el.variante }, false), 0, yc);
  const f = imageCoeurs(ctx, { valeur: el.faim, max: 20, taille: 9 * E / ctx.U, variante: el.varianteFaim }, true);
  composer(o, f, w - f.w, yc);
  if (el.niveau !== null && el.niveau > 0) {
    const t = rendreTexte(ctx.police, segmentsDeTexte(String(el.niveau), { couleur: [128, 255, 32] }), { S: E, ombre: false, contour: { couleur: [0, 0, 0, 255], ep: E }, alignement: 'centre' });
    composer(o, t.img, Math.round((w - t.larg) / 2) - t.origine.x, Math.round((49 + plus - 22 - 7 - 7) * E) - t.origine.y - 0);
  }
  return { img: o, boite: { x: 0, y: 0, w, h } };
}

// ---------------------------------------------------------------- mouvement : entree, emphase, sortie (montage/mouvement.js)
// Defauts par type d'element, mesures sur les 4 videos de reference (docs/MONTAGE.md) : une legende arrive en ~5 images avec depassement ;
// un libelle du monde fait un pop avec un petit rebond ; un compteur fait un pop, compte, puis pulse ; une icone tombe et flotte ;
// une fleche se trace ; une infobulle ou un succes glissent ; une carte : fond puis contenu l'un apres l'autre.
const DEFAUTS_MOUV = {
  legende: { entree: 'pop', duree: 0.36, depart: 0.79, courbe: 'cubique', sortie: 'aucune' },   // mesure (V1, V3) : la puce apparait d'un coup, opaque, a 79 % de sa taille finale puis grossit en ~11 images (ease-out), sans depassement
  texte: { entree: 'pop', duree: 0.26, depart: 0.3, sortie: 'fondu', dsortie: 0.15 },
  compteur: { entree: 'compte', duree: 0.26, depart: 0.3, sortie: 'fondu', dsortie: 0.2 },
  icone: { entree: 'tombe', duree: 0.5, sortie: 'fondu', dsortie: 0.15, emphase: { type: 'flotte', periode: 1.6, intensite: 1 } },
  fleche: { entree: 'dessin', duree: 0.3, sortie: 'dessin', dsortie: 0.2 },
  ligne: { entree: 'dessin', duree: 0.3, sortie: 'fondu', dsortie: 0.15 },
  nom: { entree: 'fondu', duree: 0.2, sortie: 'fondu', dsortie: 0.15 },
  bulle: { entree: 'glisse', duree: 0.22, depuis: 'bas', distance: 0.04, sortie: 'fondu', dsortie: 0.15 },
  chat: { entree: 'fondu', duree: 0.12, sortie: 'fondu', dsortie: 0.2 },
  coffre: { entree: 'pop', duree: 0.25, depart: 0.8, sortie: 'fondu', dsortie: 0.15 },
  marchand: { entree: 'pop', duree: 0.25, depart: 0.8, sortie: 'fondu', dsortie: 0.15 },
  succes: { entree: 'glisse', duree: 0.35, depuis: 'haut', distance: 0.14, courbe: 'retour', sortie: 'glisse', dsortie: 0.25 },
  defaut: { entree: 'pop', duree: 0.22, depart: 0.4, sortie: 'fondu', dsortie: 0.15 },
};
const HORS = { type: 'aucune', duree: 0, courbe: 'lineaire', delai: 0 };

// Mouvement d'un element : { entree, sortie, emphase } ; calcule une fois par element (garde dans el._mouv).
export function specMouvement(el) {
  if (el._mouv) return el._mouv;
  const d = DEFAUTS_MOUV[el.legende ? 'legende' : el.type] ?? DEFAUTS_MOUV.defaut;
  const coupe = el.anim === 'aucune' || el.anim === false;
  const alias = (x) => (x === 'trace' ? 'dessin' : x);
  const dureeCle = typeof el.anim === 'number' ? el.anim : null;
  let typeIn = alias(el.entree ?? d.entree), typeOut = alias(el.sortie ?? d.sortie);
  let depart = d.depart ?? null, duree = dureeCle ?? el.dureeEntree ?? (el.pop ? el.pop[1] : null) ?? d.duree ?? DUREE_DEFAUT[typeIn] ?? 0.2;
  if (Array.isArray(el.pop)) depart = el.pop[0] < 1 ? el.pop[0] : 0.5;
  if (el.pop === null && el.legende) typeIn = 'aucune';   // pop:false sur une legende : elle apparait d'un coup
  const enChaine = (type, dur, ex) => ({ type, duree: type === 'aucune' ? 0 : dur, courbe: ex.courbe ?? COURBE_DEFAUT[type] ?? 'cubique', delai: 0, depuis: ex.depuis ?? d.depuis ?? 'gauche', depart: ex.depart ?? null, distance: ex.distance ?? d.distance ?? null });
  const entree = enChaine(typeIn, duree, { courbe: el.courbe ?? d.courbe, depuis: el.depuis, depart });
  entree.delai = el.retard ?? el._delaiAuto ?? 0;
  const sortie = enChaine(typeOut, el.animSortie ?? d.dsortie ?? duree, { courbe: el.courbeSortie ?? 'cubique', depuis: el.depuis });
  let emphase = null;
  const brute = el.emphase !== undefined ? el.emphase : d.emphase ?? (el.type === 'compteur' ? 'fin-compte' : null);
  if (brute && brute !== 'aucune') {
    const o = typeof brute === 'string' ? { type: brute } : { ...brute };
    if (o.type === 'fin-compte') { o.type = 'pulse'; o.unique = true; o.t = el.t[0] + (el.delai ?? 0) + (el.duree ?? 0.5); o.duree = 0.4; o.intensite = 1.6; o.flash = true; }
    if (o.t !== undefined && o.t !== null) { o.unique = true; o.duree ??= 0.4; }
    o.periode ??= o.type === 'flotte' ? 1.6 : o.type === 'clignote' ? 0.5 : 0.9;
    o.duree ??= 0.4; o.intensite ??= 1;
    emphase = o;
  }
  const vie = el.t[1] - el.t[0];
  if (!coupe) {
    entree.duree = Math.min(entree.duree, vie * 0.6);
    if (entree.type !== 'aucune' && entree.delai > 0) entree.delai = Math.min(entree.delai, vie * 0.5);
    sortie.duree = Math.min(sortie.duree, vie * 0.4);
  }
  el._mouv = coupe ? { entree: { ...HORS }, sortie: { ...HORS }, emphase: null } : { entree, sortie, emphase };
  return el._mouv;
}

// Etat d'animation d'un element a l'instant t : null s'il n'est pas visible, sinon
//   { a (opacite), kx, ky (echelle), dx, dy (pixels), rot (radians), flou (pixels), blanc (0..1), n, vague (progression), dessin (0..1 trace) }.
export function etatAnimation(el, t, ctx) {
  if (t < el.t[0] || t >= el.t[1]) return null;
  const M = specMouvement(el), U = ctx.U;
  const tin = t - el.t[0] - M.entree.delai, tout = el.t[1] - t;
  if (tin < 0) return { ...neutre(), a: 0 };
  let s = neutre();
  if (M.entree.type !== 'aucune' && M.entree.duree > 0 && tin < M.entree.duree) {
    const e = M.entree;
    s = etatEntree(e.type, tin / e.duree, { courbeNom: e.courbe, depuis: e.depuis, depart: e.depart });
    if (e.type === 'glisse' && e.distance !== null) { const f = e.distance / 0.5; s.dx *= f; s.dy *= f; }
  }
  if (M.sortie.type !== 'aucune' && M.sortie.duree > 0 && tout < M.sortie.duree) {
    const x = M.sortie;
    const so = etatSortie(x.type, tout / x.duree, { courbeNom: x.courbe, depuis: x.depuis, depart: x.depart });
    if (x.type === 'glisse' && x.distance !== null) { const f = x.distance / 0.5; so.dx *= f; so.dy *= f; }
    s = composer2(s, so);
  }
  if (M.emphase) {
    const e = M.emphase, debut = e.unique ? (e.t ?? el.t[0] + M.entree.delai + M.entree.duree) : el.t[0] + M.entree.delai + M.entree.duree;
    const em = etatEmphase(e, t - debut);
    if (e.unique && e.flash && t >= debut && t - debut < e.duree) em.blanc = 0.65 * (1 - (t - debut) / e.duree);
    s = composer2(s, em);
  }
  s.a *= el.opacite ?? 1;
  s.dx *= U; s.dy *= U; s.flou = Math.round(s.flou * U);
  if (!(s.kx > 0)) s.kx = 0.001;
  if (!(s.ky > 0)) s.ky = 0.001;
  return s;
}

// Visibilite des lettres (machine) ou des mots (vague) pour rendreTexte ; null sinon.
function visibiliteDe(anim) {
  if (anim.n !== null && anim.n !== undefined) return ({ idx, nChars }) => ({ vu: idx < Math.max(1, Math.ceil(anim.n * nChars - 1e-9)) });
  if (anim.vague !== null && anim.vague !== undefined) return ({ mot, nMots }) => { const p = progressionMot(anim.vague, mot, nMots); return { vu: p > 0.02, dy: (1 - p) * 3 }; };
  return null;
}

// ---------------------------------------------------------------- ancrage
// Point de l'image ou se pose l'element : { x, y, scale, visible } ; null si derriere la camera.
// Une position d'ecran [x, y] (fractions) est comptee DANS LA ZONE SURE (pas dans l'image entiere).
function pointMonde(ctx, p) {
  if (p.ecranAbs) return { x: p.ecranAbs[0] * ctx.W, y: p.ecranAbs[1] * ctx.H, w: null };
  if (p.ecran) return { x: ctx.zone.x0 + p.ecran[0] * ctx.zone.w, y: ctx.zone.y0 + p.ecran[1] * ctx.zone.h, w: null };
  let P;
  if (p.acteur !== undefined) {
    const k = ctx.scene.acteurs.findIndex((a) => a.nom === p.acteur), a = ctx.im.acteurs[k];
    const d = p.decalage ?? [0, 2.3, 0];
    P = [a.x + d[0], a.y + d[1], a.z + d[2]];
  } else P = p.monde;
  const q = ctx.proj.projeter(P);
  return q ? { x: q.x, y: q.y, w: q.w, P } : null;
}
function estVisible(ctx, q, tol) {
  if (q.w === null || !q.P) return true;
  if (ctx.prof) return visibleParProfondeur(ctx.prof, q.x, q.y, q.w, tol);
  if (ctx.solide) return visibleParTerrain(ctx.solide, ctx.im.camera, q.P);
  return true;
}
function ancreElement(el, ctx) {
  let spec;
  if (el.acteur !== undefined) spec = { acteur: el.acteur, decalage: el.decalage ?? [0, el.type === 'nom' ? 2.3 : 2.3, 0] };
  else if (el.monde !== undefined) spec = { monde: el.decalage ? el.monde.map((v, i) => v + el.decalage[i]) : el.monde };
  else if (el.ecranAbs !== undefined) spec = { ecranAbs: el.ecranAbs };
  else spec = { ecran: el.ecran ?? [0.5, 0.5] };
  const q = pointMonde(ctx, spec);
  if (!q) return null;   // ancre derriere la camera : pas dessinee (normal : l'acteur n'est pas dans le plan)
  const mondeAncre = q.w !== null;
  if (mondeAncre) {
    // une incrustation ancree au monde n'est JAMAIS ramenee dans l'image : ancre hors du cadre, ou acteur absent / cache -> pas dessinee
    const a = el.acteur !== undefined ? ctx.im.acteurs[ctx.scene.acteurs.findIndex((x) => x.nom === el.acteur)] : null;
    if (a?.absent) return null;
    if (q.x < 0 || q.x > ctx.W || q.y < 0 || q.y > ctx.H) return null;   // ancre hors du cadre : pas dessinee, jamais ramenee dans l'image (normal : l'acteur n'est pas dans le plan)
  }
  const occ = el.occlusion ?? (el.type === 'nom' ? !(el.traverse || el.aTraversMurs) : false);
  if (mondeAncre && occ && !estVisible(ctx, q, 0.7)) return null;
  const mode = el.echelle ?? (el.type === 'nom' ? 'distance' : 'ecran');
  let k = 1;
  if (mondeAncre && mode === 'distance') k = Math.max(0.12, Math.min(4, el.ref / q.w));
  else if (typeof mode === 'number') k = mode;
  const dx = (el.decalageEcran?.[0] ?? 0) * ctx.U, dy = (el.decalageEcran?.[1] ?? 0) * ctx.U;
  return { x: q.x + dx, y: q.y + dy, k, mondeAncre };
}

// Rectangle opaque d'une image (hors bords transparents) : { x, y, w, h } en pixels de l'image. Calcule une fois par image.
function boiteOpaque(img) {
  if (img._vis) return img._vis;
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.px[(y * img.w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  img._vis = x1 < 0 ? { x: 0, y: 0, w: img.w, h: img.h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  return img._vis;
}

// ---------------------------------------------------------------- dessin d'un element
const PIVOT_PAR_TYPE = { chat: [0, 0], hud: [0.5, 1], succes: [0.5, 0], nom: [0.5, 1], bulle: [0.5, 1] };   // la bulle se pose AU-DESSUS du point d ancrage (la tete)
const TEXTES = new Set(['texte', 'compteur']);
const libelle = (el) => `${el.type}${el.texte ? ` "${String(el.texte).slice(0, 18)}"` : el.acteur ? ` "${el.acteur}"` : ''}`;
function noter(ctx, cle, msg) { if (ctx.notes && !ctx.notes.has(cle)) ctx.notes.set(cle, msg); }

// Titre d'ecran : texte ou compteur ancre a l'ecran (pas une legende). Ecart minimal titre / legende : part du petit cote.
export const ECART_TITRE_LEGENDE = 0.12;
export const estTitre = (el) => !el.legende && (el.type === 'texte' || el.type === 'compteur') && el.monde === undefined && el.acteur === undefined && Array.isArray(el.ecran);
// Bandes (pixels [y0, y1]) gardees par les elements d'ecran (titre, compteur, icone, panneau de coffre) visibles au moins 0,2 s pendant
// [t0, t1], ecart compris : la legende ne s'y pose pas (sinon elle les pousse sur les visages, ou colle au titre).
function bandesTitres(ctx, t0, t1, Z) {
  const out = [], zone = { x0: Z.x0, y0: Z.y0, w: Z.x1 - Z.x0, h: Z.y1 - Z.y0 };
  for (const e of ctx.scene.incrustations ?? []) {
    if (!HAUTS.has(e.type) || e.legende || !Array.isArray(e.ecran) || e.monde !== undefined || e.acteur !== undefined || e._carte) continue;
    if (Math.min(t1, e.t[1]) - Math.max(t0, e.t[0]) < 0.2) continue;
    const h = hauteurElement(e, zone, ctx.U), yc = Math.min(Z.y1 - h / 2, Math.max(Z.y0 + h / 2, Z.y0 + e.ecran[1] * zone.h));
    const d = h / 2 + (estTitre(e) ? ECART_TITRE_LEGENDE + 0.01 : 0.045) * ctx.U;
    out.push([yc - d, yc + d]);
  }
  return out;
}

// Hauteur (pixels) de la legende `auto` : choisie une fois par plan (montage/evitement.js), gardee pour toutes les puces du plan.
function hauteurLegende(ctx, el, vis, k, zone) {   // vis, k : gardes pour compatibilite ; la taille essayee est celle d'une puce moyenne (0,075 du petit cote de haut, 55 % de la largeur sure)
  const plan = ctx.carteImage ? null : ctx.scene.plans?.find((p) => ctx.t >= p.de && ctx.t < p.a);
  const cle = `${ctx.carteImage ? 'carte' + Math.floor(ctx.t * 10) : plan ? 'p' + plan.de : 'c' + el._seq}|${ctx.W}x${ctx.H}`;   // une carte : l'image de la carte (acteurs sur l'etage), pas le monde
  let c = ctx.cacheEvite.get(cle);
  if (!c) {
    const Z = zone ?? { x0: 0, y0: 0, x1: ctx.W, y1: ctx.H };
    const i0 = ctx.carteImage ? 0 : plan ? plan.i0 : Math.round(el.t[0] * 30), i1 = ctx.carteImage ? 1 : plan ? plan.i1 : Math.max(i0 + 1, Math.round(el.t[1] * 30));
    const interdits = ctx.carteImage ? [] : bandesTitres(ctx, plan ? plan.de : el.t[0], plan ? plan.a : el.t[1], Z);   // place des titres du plan
    c = choisirHauteur({ images: ctx.images, i0, i1, W: ctx.W, H: ctx.H, zone: Z, larg: 0.55 * (Z.x1 - Z.x0), haut: 0.075 * ctx.U, interdits });
    ctx.cacheEvite.set(cle, c);
    if (c.cout > 0.6) noter(ctx, `evite#${cle}`, `legende a t=${el.t[0]} s : couvre un visage ou un torse malgre tout (aucune place libre dans la zone sure) ; cadre plus large, personnage decale (cadre.decale) ou "position":"haut"`);
  }
  return c.y * ctx.H;
}

// Les libelles ancres au monde (texte, compteur, icone...) ne se posent pas sur la bande des legendes : s'ils la touchent ils passent juste au-dessus (ou dessous).
const LIBELLES = new Set(['texte', 'compteur', 'icone', 'equation', 'bulle', 'horloge', 'minuteur']);   // pas 'nom' : une etiquette de nom reste pres de sa tete (la disposition la decale un peu ou la masque)
const aLegendes = (scene) => (scene._aLegendes ??= !!scene.textes?.some((e) => e.legende && e.evite));
function hors_bande(ctx, el, vis, k, zone, cy, b, pivot) {
  const Z = zone ?? { x0: 0, y0: 0, x1: ctx.W, y1: ctx.H };
  const plan = ctx.scene.plans?.find((p) => ctx.t >= p.de && ctx.t < p.a);
  const cle = `${plan ? 'p' + plan.de : 'c' + el._seq}|${ctx.W}x${ctx.H}`;
  let c = ctx.cacheEvite.get(cle);
  if (!c) {
    const i0 = plan ? plan.i0 : Math.round(el.t[0] * 30), i1 = plan ? plan.i1 : Math.max(i0 + 1, Math.round(el.t[1] * 30));
    c = choisirHauteur({ images: ctx.images, i0, i1, W: ctx.W, H: ctx.H, zone: Z, larg: 0.55 * (Z.x1 - Z.x0), haut: 0.075 * ctx.U, interdits: bandesTitres(ctx, plan ? plan.de : el.t[0], plan ? plan.a : el.t[1], Z) });   // meme choix que hauteurLegende (meme cache)
    ctx.cacheEvite.set(cle, c);
  }
  const marge = 0.012 * ctx.U, b0 = c.y * ctx.H - 0.0375 * ctx.U - marge, b1 = c.y * ctx.H + 0.0375 * ctx.U + marge;
  const oy = b.y + pivot[1] * b.h, haut = vis.h * k, haut0 = cy + (vis.y - oy) * k, bas0 = haut0 + haut;
  if (bas0 <= b0 || haut0 >= b1) return cy;
  const dessus = b0 - haut - haut0, dessous = b1 - haut0;   // deplacements pour passer au-dessus / au-dessous
  const ok = (d) => haut0 + d >= Z.y0 && haut0 + d + haut <= Z.y1;
  const d = ok(dessus) && (Math.abs(dessus) <= Math.abs(dessous) || !ok(dessous)) ? dessus : ok(dessous) ? dessous : 0;
  if (Math.abs(d) > 0.04 * ctx.U) noter(ctx, `bande#${el.type}#${el.ordre ?? el._seq}`, `${el.type}${el.texte ? ` "${String(el.texte).slice(0, 18)}"` : ''} a t=${el.t[0]} s : deplace de ${Math.round(Math.abs(d))} px pour ne pas recouvrir la legende`);
  return cy + d;
}

// Prepare la pose d'un element (taille, place, zone sure) SANS dessiner. Retourne { box (rectangle opaque au repos, pixels de l'image), peindre(dx, dy) }.
function preparerPose(film, ctx, el, spr, anc, anim) {
  const pivot = el.pivot ?? PIVOT_PAR_TYPE[el.type] ?? [0.5, 0.5];
  const b = spr.boite ?? { x: 0, y: 0, w: spr.img.w, h: spr.img.h };
  const texte = !!(el.legende || TEXTES.has(el.type));
  // la zone dans laquelle l'element doit rester : la zone sure ; sans zone (horizontal), les legendes gardent leurs marges de 4 % / 3 %
  const Z = ctx.zone;
  let zone = Z;
  if (!Z.actif) zone = texte ? { x0: ctx.W * 0.04, y0: ctx.H * 0.03, x1: ctx.W * 0.96, y1: ctx.H * 0.97, w: ctx.W * 0.92, h: ctx.H * 0.94 } : null;
  const vis = boiteOpaque(spr.img);
  // l'emphase (pulse, flotte, secousse...) deborde un peu : on garde de la marge pour que le MAXIMUM reste dans la zone
  const em = specMouvement(el).emphase;
  if (zone && em) { const I = em.intensite ?? 1, mx = (em.type === 'pulse' || em.type === 'croit') ? 0.04 * I * vis.w + 1 : em.type === 'secousse' ? 0.014 * I * ctx.U + 0.03 * I * vis.h : 0, my = (em.type === 'pulse' || em.type === 'croit') ? 0.04 * I * vis.h + 1 : em.type === 'flotte' ? 0.006 * I * ctx.U + 1 : em.type === 'rebond' ? 0.02 * I * ctx.U : em.type === 'secousse' ? 0.03 * I * vis.w : 0; zone = { x0: zone.x0 + mx, y0: zone.y0 + my + (em.type === 'rebond' ? 0.02 * I * ctx.U : 0), x1: zone.x1 - mx, y1: zone.y1 - my, w: zone.w - 2 * mx, h: zone.h - 2 * my }; }
  let k = anc.k;
  if (zone) { const kmax = Math.min((zone.w * (Z.actif ? 1 : 1)) / vis.w, zone.h / vis.h); if (vis.w * k > zone.w + 0.5 || vis.h * k > zone.h + 0.5) k = Math.min(k, kmax); }
  let cx = anc.x, cy = anc.y;
  if (el.evite && ctx.images) cy = hauteurLegende(ctx, el, vis, k, zone);   // position `auto` des legendes : hors des acteurs
  else if (anc.mondeAncre && LIBELLES.has(el.type) && ctx.images && aLegendes(ctx.scene)) cy = hors_bande(ctx, el, vis, k, zone, cy, b, pivot);   // libelle du monde : pas sur la bande des legendes
  const ox = b.x + pivot[0] * b.w, oy = b.y + pivot[1] * b.h;   // le pivot, dans l'image du sprite
  if (zone) {
    // rectangle opaque au repos (avant l'animation) : on le ramene dans la zone
    const rx = cx + (vis.x - ox) * k, ry = cy + (vis.y - oy) * k;
    const c = contenir(zone, rx, ry, vis.w * k, vis.h * k);
    // un nom (etiquette d'un acteur) ne se decale pas loin de sa tete : s'il sort de la zone sure de plus de 6 % du petit cote, il n'est pas dessine
    if (anc.mondeAncre && el.type === 'nom' && c.deplacement > 0.06 * ctx.U) return null;
    if (c.deplacement > 0.5) {
      cx += c.x - rx; cy += c.y - ry;
      if (c.deplacement > 0.04 * ctx.U && Z.actif) noter(ctx, `${el.type}#${el.ordre ?? el._seq}`, `${libelle(el)} a t=${el.t[0]} s : deplace de ${Math.round(c.deplacement)} px pour rester dans la zone sure (hors de l'interface des applications)`);
    }
  }
  const box = { x: cx + (vis.x - ox) * k, y: cy + (vis.y - oy) * k, w: vis.w * k, h: vis.h * k };
  const peindre = (ddx = 0, ddy = 0) => {
    let img = spr.img, oxi = ox;
    if (anim.flou > 0) { img = flouHorizontal(img, anim.flou); oxi += anim.flou; }
    const kx = k * anim.kx, ky = k * anim.ky;
    const dx = cx + ddx + anim.dx, dy = cy + ddy + anim.dy;
    if (kx === 1 && ky === 1 && anim.rot === 0 && anim.blanc === 0 && Number.isInteger(Math.round(dx - oxi)) ) {
      poserImage(film, ctx.W, ctx.H, img, Math.round(dx - oxi), Math.round(dy - oy), img.w, img.h, { alpha: anim.a, filtre: 'proche' });
    } else {
      const net = Math.abs(kx - 1) < 1e-6 && Math.abs(ky - 1) < 1e-6 && anim.rot === 0;
      poserAffine(film, ctx.W, ctx.H, img, oxi, oy, net ? Math.round(dx) : dx, net ? Math.round(dy) : dy, kx, ky, anim.rot, { alpha: anim.a, blanc: anim.blanc, lineaire: !net });
    }
  };
  return { box, peindre, zone };
}

// ---- fleches et visages : le trait et l'etiquette ne passent pas sur la tete ni le torse d'un acteur (boites du plan : acteurs-evites.js).
// Decision UNE FOIS PAR PLAN (memo ctx.cacheEvite) : decalage horizontal du trait (cote ou il y a le plus de place, au moins 0,6 bloc d'un acteur quand
// l'ancre est dans le monde) et place de l'etiquette (cote normal, cote oppose, ou au bout de la fleche) la moins genante. `eviteActeurs: false` coupe tout ca.
function rectsActeurs(ctx, el) {
  if (el.eviteActeurs === false || !ctx.obstacles) return [];
  return [...ctx.obstacles.tetes, ...ctx.obstacles.torses].map((o) => ({ x0: o.x, y0: o.y, x1: o.x + o.w, y1: o.y + o.h }));
}
function clePlan(ctx, el) {
  const plan = ctx.scene.plans?.find((q) => ctx.t >= q.de && ctx.t < q.a);
  return `${plan ? 'p' + plan.de : 'c'}|${ctx.W}x${ctx.H}|${el._seq}`;
}
const aireCommune = (a, b) => { const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0); return w > 0 && h > 0 ? w * h : 0; };
function decalageFleche(ctx, el, pa, pb, ep, tete) {
  const rects = rectsActeurs(ctx, el);
  if (!rects.length || !ctx.cacheEvite) return 0;
  const cle = 'fl|' + clePlan(ctx, el);
  if (ctx.cacheEvite.has(cle)) return ctx.cacheEvite.get(cle);
  const bloc = pa.P && pa.w ? (0.6 * ctx.proj.f) / pa.w : 0;   // 0,6 bloc en pixels d'ecran
  const m = ep / 2 + tete * 0.6 + Math.max(bloc, 0.008 * ctx.U);
  const infl = rects.map((r) => ({ x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m }));
  const Z = ctx.zone.actif ? ctx.zone : { x0: 0, y0: 0, x1: ctx.W, y1: ctx.H };
  const coupe = (d) => infl.filter((r) => couperSegment(r, pa.x + d, pa.y, pb.x + d, pb.y));
  const xmin = Math.min(pa.x, pb.x), xmax = Math.max(pa.x, pb.x);
  let res = 0;
  const g0 = coupe(0);
  if (g0.length) {
    const essai = (sens) => {
      let d = 0;
      for (let i = 0; i < 6; i++) {
        const g = coupe(d);
        if (!g.length) return xmin + d >= Z.x0 + m && xmax + d <= Z.x1 - m ? d : null;
        d = sens < 0 ? Math.min(...g.map((r) => r.x0 - xmax)) - 1 : Math.max(...g.map((r) => r.x1 - xmin)) + 1;
      }
      return null;
    };
    const dg = essai(-1), dd = essai(1);
    const placeG = Math.min(...g0.map((r) => r.x0)) - Z.x0, placeD = Z.x1 - Math.max(...g0.map((r) => r.x1));
    res = dg === null ? (dd ?? 0) : dd === null ? dg : placeG >= placeD ? dg : dd;
    if (res) noter(ctx, `fleche-visage#${el.ordre ?? el._seq}`, `fleche a t=${el.t[0]} s : trait decale de ${Math.round(Math.abs(res))} px pour ne pas passer sur un acteur`);
  }
  ctx.cacheEvite.set(cle, res);
  return res;
}
// Choix (une fois par plan) de la place de l'etiquette parmi 4 : 0 cote normal, 1 cote oppose, 2 et 3 au-dela des deux bouts. cands : [{ex, ey}] (coin haut gauche de l'image).
function choisirEtiquette(ctx, el, cands, vis, R) {
  const rects = rectsActeurs(ctx, el), occ = ctx.occupe ?? [];
  if ((!rects.length && !occ.length) || !ctx.cacheEvite) return 0;
  const cle = 'fe|' + clePlan(ctx, el);
  if (ctx.cacheEvite.has(cle)) return ctx.cacheEvite.get(cle);
  let best = 0, bestC = Infinity;
  cands.forEach((c, i) => {
    const r = contenir(R, c.ex + vis.x, c.ey + vis.y, vis.w, vis.h);
    const box = { x0: r.x, y0: r.y, x1: r.x + vis.w, y1: r.y + vis.h };
    const cout = rects.reduce((a, q) => a + aireCommune(box, { x0: q.x0 - 0.01 * ctx.U, y0: q.y0 - 0.01 * ctx.U, x1: q.x1 + 0.01 * ctx.U, y1: q.y1 + 0.01 * ctx.U }), 0) / (vis.w * vis.h) * 1000 + occ.reduce((a, q) => a + aireCommune(box, { x0: q.x - 0.008 * ctx.U, y0: q.y - 0.008 * ctx.U, x1: q.x + q.w + 0.008 * ctx.U, y1: q.y + q.h + 0.008 * ctx.U }), 0) / (vis.w * vis.h) * 1000 + r.deplacement * 0.5 + i * 0.01;
    if (cout < bestC - 1e-9) { bestC = cout; best = i; }
  });
  ctx.cacheEvite.set(cle, best);
  return best;
}

function dessinerFleche(film, ctx, el, anim) {
  const A = pointMonde(ctx, el.de), B = pointMonde(ctx, el.a);
  let pa, pb;
  if (A && B) { pa = A; pb = B; }
  else if (A && B === null && A.P && el.a.monde) { const seg = ctx.proj.recouper(A.P, el.a.monde); if (!seg) return; pa = pointMonde(ctx, { monde: seg[0] }); pb = pointMonde(ctx, { monde: seg[1] }); }
  else if (B && A === null && B.P && el.de.monde) { const seg = ctx.proj.recouper(el.de.monde, B.P); if (!seg) return; pa = pointMonde(ctx, { monde: seg[0] }); pb = pointMonde(ctx, { monde: seg[1] }); }
  else return;
  if (!pa || !pb) return;
  { const dxv = decalageFleche(ctx, el, pa, pb, Math.max(1.5, el.epaisseur * ctx.U), el.pointe * ctx.U); if (dxv) { pa = { ...pa, x: pa.x + dxv }; pb = { ...pb, x: pb.x + dxv }; } }
  // la fleche reste dans la zone sure : on coupe son segment au rectangle (les pointes se posent sur les bouts coupes)
  const Z = ctx.zone;
  if (Z.actif) {
    const m = el.pointe * ctx.U * 0.8 + Math.max(1.5, el.epaisseur * ctx.U) / 2 + 4;   // les pointes et l'ombre debordent du trait
    const Zi = { x0: Z.x0 + m, y0: Z.y0 + m, x1: Z.x1 - m, y1: Z.y1 - m };
    const c = couperSegment(Zi, pa.x, pa.y, pb.x, pb.y);
    if (!c) return;
    const dep = Math.hypot(c[0] - pa.x, c[1] - pa.y) + Math.hypot(c[2] - pb.x, c[3] - pb.y);
    if (dep > 0.04 * ctx.U) noter(ctx, `fleche#${el.ordre}`, `fleche a t=${el.t[0]} s : raccourcie de ${Math.round(dep)} px pour rester dans la zone sure`);
    pa = { ...pa, x: c[0], y: c[1] }; pb = { ...pb, x: c[2], y: c[3] };
  }
  const p = anim.dessin;
  const U = ctx.U, ep = Math.max(1.5, el.epaisseur * U), tete = el.pointe * U;
  let x0 = pa.x, y0 = pa.y, x1 = pa.x + (pb.x - pa.x) * p, y1 = pa.y + (pb.y - pa.y) * p;
  const L = Math.hypot(x1 - x0, y1 - y0); if (L < 2) return;
  const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
  const col = el.couleur, alpha = anim.a;
  const sombre = [0, 0, 0, 255];
  // vers l'arriere des pointes : l'axe commence apres la pointe de depart (double) et finit avant celle d'arrivee
  const t0 = el.double ? Math.min(tete, L / 2) : 0, t1 = Math.min(tete, L - t0);
  const ax = x0 + ux * t0, ay = y0 + uy * t0, bx = x1 - ux * t1 * 0.6, by = y1 - uy * t1 * 0.6;
  const occ = el.occlusion === true && pa.P && pb.P;
  const dessinerAxe = (c, e, a) => {
    if (!occ) { segmentEpais(film, ctx.W, ctx.H, ax, ay, bx, by, e, c, a); return; }
    const n = Math.max(2, Math.ceil(L / 10));
    for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n, um = (u0 + u1) / 2;
      const Pm = [pa.P[0] + (pb.P[0] - pa.P[0]) * um * p, pa.P[1] + (pb.P[1] - pa.P[1]) * um * p, pa.P[2] + (pb.P[2] - pa.P[2]) * um * p];
      const q = ctx.proj.projeter(Pm); if (!q || !estVisible(ctx, { ...q, P: Pm }, 0.8)) continue;
      segmentEpais(film, ctx.W, ctx.H, ax + (bx - ax) * u0, ay + (by - ay) * u0, ax + (bx - ax) * u1, ay + (by - ay) * u1, e, c, a);
    }
  };
  const pointe = (x, y, dx, dy, c, a, ex = 0) => {
    const h = tete + ex, l = tete * 0.6 + ex;
    trianglePlein(film, ctx.W, ctx.H, [x, y], [x - dx * h - dy * l, y - dy * h + dx * l], [x - dx * h + dy * l, y - dy * h - dx * l], c, a);
  };
  dessinerAxe(sombre, ep + 3, alpha * 0.45); pointe(x1, y1, ux, uy, sombre, alpha * 0.45, 2); if (el.double) pointe(x0, y0, -ux, -uy, sombre, alpha * 0.45, 2);
  dessinerAxe(col, ep, alpha); pointe(x1, y1, ux, uy, col, alpha); if (el.double) pointe(x0, y0, -ux, -uy, col, alpha);
  if (el.texte && p >= 1) {
    const t = imageTexte(ctx, el.texte, { ...el, taille: el.taille ?? 0.05, couleur: el.couleur }, { type: 'fleche', contour: { couleur: [10, 10, 10, 255], ep: 0.07 }, gras: true });
    const b = t.boite, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    let nx = uy, ny = -ux; if (Math.abs(ny) > Math.abs(nx)) { if (ny > 0) { nx = -nx; ny = -ny; } } else if (nx < 0) { nx = -nx; ny = -ny; }
    const decal = Math.abs(nx) * (b.w / 2) + Math.abs(ny) * (b.h / 2) + ep / 2 + 0.018 * U;
    const dx = (el.decalageEtiquette?.[0] ?? 0) * U, dy = (el.decalageEtiquette?.[1] ?? 0) * U;
    // l'etiquette reste entierement dans la zone sure (l'image entiere moins 2 % sans zone) ; elle fait un petit pop quand la fleche est finie
    const R = Z.actif ? Z : { x0: ctx.W * 0.02, y0: ctx.H * 0.02, x1: ctx.W * 0.98, y1: ctx.H * 0.98, w: ctx.W * 0.96, h: ctx.H * 0.96 };
    const vis = boiteOpaque(t.img);
    const place = (cx, cy) => ({ ex: cx - b.w / 2 - b.x + dx, ey: cy - b.h / 2 - b.y + dy });
    const bout = Math.abs(ux) * (b.w / 2) + Math.abs(uy) * (b.h / 2) + tete + 0.012 * U;
    const cands = [place(mx + nx * decal, my + ny * decal), place(mx - nx * decal, my - ny * decal), place(x0 - ux * bout, y0 - uy * bout), place(x1 + ux * bout, y1 + uy * bout)];
    const { ex, ey } = cands[choisirEtiquette(ctx, el, cands, vis, R)];
    const c = contenir(R, ex + vis.x, ey + vis.y, vis.w, vis.h);
    const lx = c.x - vis.x, ly = c.y - vis.y;
    if (c.deplacement > 0.04 * ctx.U && Z.actif) noter(ctx, `fleche-etiquette#${el.ordre}`, `etiquette de fleche a t=${el.t[0]} s : deplacee de ${Math.round(c.deplacement)} px pour rester dans la zone sure`);
    const M = specMouvement(el), fin = el.t[0] + M.entree.delai + M.entree.duree, tl = ctx.t - fin;
    const sc = M.entree.type === 'aucune' ? 1 : Math.max(0.01, 0.4 + 0.6 * courbe('retour', tl / 0.18));
    const a2 = M.entree.type === 'aucune' ? alpha : alpha * clamp01(tl / 0.05 + 0.2);
    poserAffine(film, ctx.W, ctx.H, t.img, t.img.w / 2, t.img.h / 2, lx + t.img.w / 2, ly + t.img.h / 2, sc, sc, 0, { alpha: a2, lineaire: sc !== 1 });
  }
}

function dessinerLigne(film, ctx, el, anim) {
  const U = ctx.U, ep = Math.max(1.5, el.epaisseur * U), pts = el.points;
  // longueur monde de chaque segment (pour le trace progressif)
  const lg = []; let tot = 0;
  for (let i = 0; i + 1 < pts.length; i++) { const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]); lg.push(d); tot += d; }
  const p = el.tracer > 0 ? Math.min(clamp01((ctx.t - el.t[0]) / el.tracer), anim.dessin) : anim.dessin;
  let reste = tot * p, derniere = null, cumul = 0;
  const dash = 0.03 * U, trou = 0.022 * U;
  const col = el.couleur, Z = ctx.zone;
  const m = ep / 2 + 1.5;   // le trait a de l'epaisseur : on reste a une demi-epaisseur du bord
  const dedans = (x, y) => !Z.actif || (x >= Z.x0 + m && x <= Z.x1 - m && y >= Z.y0 + m && y <= Z.y1 - m);
  for (let i = 0; i + 1 < pts.length && reste > 0; i++) {
    const frac = Math.min(1, reste / lg[i]);
    const a = pts[i], b = [a[0] + (pts[i + 1][0] - a[0]) * frac, a[1] + (pts[i + 1][1] - a[1]) * frac, a[2] + (pts[i + 1][2] - a[2]) * frac];
    reste -= lg[i];
    const seg = ctx.proj.recouper(a, b); if (!seg) continue;
    const q0 = ctx.proj.projeter(seg[0]), q1 = ctx.proj.projeter(seg[1]); if (!q0 || !q1) continue;
    const L = Math.hypot(q1.x - q0.x, q1.y - q0.y); if (L < 1) continue;
    const pas = el.pointille ? 2 : 6;
    for (let s = 0; s < L; s += pas) {
      const e = Math.min(L, s + pas), cyc = (cumul + s) % (dash + trou);
      if (el.pointille && cyc > dash) continue;
      const u0 = s / L, u1 = e / L, m = (u0 + u1) / 2;
      const xa = q0.x + (q1.x - q0.x) * u0, ya = q0.y + (q1.y - q0.y) * u0, xb = q0.x + (q1.x - q0.x) * u1, yb = q0.y + (q1.y - q0.y) * u1;
      if (!dedans(xa, ya) || !dedans(xb, yb)) continue;
      if (el.occlusion === true) { const Pm = [seg[0][0] + (seg[1][0] - seg[0][0]) * m, seg[0][1] + (seg[1][1] - seg[0][1]) * m, seg[0][2] + (seg[1][2] - seg[0][2]) * m]; const qm = ctx.proj.projeter(Pm); if (!qm || !estVisible(ctx, { ...qm, P: Pm }, 0.8)) continue; }
      segmentEpais(film, ctx.W, ctx.H, xa, ya, xb, yb, ep, col, anim.a);
    }
    cumul += L; derniere = q1;
  }
  if (el.tete && el.tracer > 0 && p < 1 && derniere && dedans(derniere.x, derniere.y)) segmentEpais(film, ctx.W, ctx.H, derniere.x, derniere.y, derniere.x + 0.01, derniere.y, ep * 2.2, col, anim.a);
}

// Priorites de la disposition (disposition.js) : plus petit = plus fort.
const FIXES = new Set(['hud', 'image', 'coeurs', 'faim']);   // grands elements poses a dessein : obstacles qui ne bougent pas
// evAct : 2 = l'element evite les tetes et les torses des acteurs (repli : les tetes seules) ; 0 = jamais (legendes, noms, elements fixes, `eviteActeurs: false`).
// gap : ecart minimal (part du petit cote) avec les autres incrustations d'ecran : les textes et panneaux empiles ne se collent pas (0,045 = 49 px sur 1080).
export const ECART_ECRAN = 0.045;
function classer(el, anc) {
  if (el.legende) return { prio: 0, fixe: true, evAct: 0 };
  if (FIXES.has(el.type)) return { prio: 2, fixe: true, evAct: 0 };
  if (el.type === 'nom') return { prio: 4, fixe: false, maxDep: 0.05, evAct: 0 };
  const monde = !!anc.mondeAncre;
  const evAct = el.eviteActeurs === false ? 0 : 2;   // tetes ET torses d'abord ; si aucune place, tetes seules (disposition.js)
  const gap = monde ? 0 : ECART_ECRAN;
  if (['texte', 'chat', 'succes', 'bulle'].includes(el.type)) return { prio: monde ? 3 : 1, fixe: false, maxDep: monde ? 0.15 : Infinity, evAct, gap };
  return { prio: monde ? 3 : 2, fixe: false, maxDep: monde ? 0.15 : Infinity, evAct, gap };
}

// Prepare un element a l'instant ctx.t : retourne null (rien a dessiner) ou { el, prio, fixe, box, force, maxDep, peindre(dx, dy) }.
// Les fleches et les lignes n'ont pas de boite : elles se dessinent par-dessus sans gener la disposition.
export function preparerElement(film, ctx, el0) {
  let el = el0;
  // HUD relie a un joueur simule (champ joueur) : vie, faim, experience, armure, air, objet tenu lus dans le replay a l'instant du monde (moteur/inventaire.js)
  if (el0.type === 'hud' && el0.joueur && ctx.scene?._etatJoueur) {
    const v = ctx.scene._etatJoueur(el0.joueur, ctx.im?.tm ?? ctx.t);
    if (v) {
      el = Object.assign(Object.create(Object.getPrototypeOf(el0)), el0, { coeurs: Math.ceil(v.vie - 1e-9), vieMax: v.vieMax, faim: v.faim, xp: v.progres, niveau: v.niveau, armurePts: v.armure, air: v.air, absorption: Math.ceil(v.absorption - 1e-9), variante: v.poison === 2 ? 'wither' : v.poison === 1 ? 'poison' : undefined, varianteFaim: v.faimEffet ? 'faim' : undefined, cases: [v.objet ? { objet: idRendu(v.objet), reflet: aReflet(v.objet, ctx.scene?._refletsForces), ...(v.nombre > 1 ? { nombre: v.nombre } : {}), ...(v.barre >= 0 && v.barre < 1 ? { barre: v.barre } : {}) } : null, ...(v.cases ? Array.from({ length: 8 }, (_, i) => (v.cases[i] ? { objet: idRendu(v.cases[i][0]), reflet: aReflet(v.cases[i][0], ctx.scene?._refletsForces), ...(v.cases[i][1] > 1 ? { nombre: v.cases[i][1] } : {}) } : null)) : (el0.cases ?? []).slice(1))] });
      el._cle = JSON.stringify([el.coeurs, el.vieMax, el.faim, el.xp, el.niveau, el.armurePts, el.air, el.absorption, el.variante, el.varianteFaim, v.objet, v.cases, (aReflet(v.objet, ctx.scene?._refletsForces) || (v.cases ?? []).some((q) => aReflet(q[0], ctx.scene?._refletsForces))) ? Math.round(ctx.t * 30) : 0]);   // un objet enchante : le reflet bouge a chaque image
      el._cache = el0._cacheJ; el.t = el0.t;
    }
  }
  // ecran du poste ouvert par un acteur simule : rien tant qu'il n'en a pas d'ouvert
  if (el0.type === 'poste') {
    const v = ctx.scene?._ecranJoueur?.(el0.joueur, ctx.im?.tm ?? ctx.t);
    if (!v) return null;
    el = Object.assign(Object.create(Object.getPrototypeOf(el0)), el0, { poste: v });
    el._cle = `${v.type}|${v.debut}|${Math.round(ctx.t * 30)}`; el._cache = el0._cacheJ;   // refait a chaque image (reflet des objets enchantes, alambic)
  }
  if (el._cache && ctx.t >= el.t[1]) el._cache = undefined;   // fini : on libere l'image (180 s de legendes ne doivent pas rester en memoire)
  const anim = etatAnimation(el, ctx.t, ctx);
  if (!anim || anim.a <= 0.002) return null;
  if (el.type === 'fleche') return { el, box: null, peindre: () => dessinerFleche(film, ctx, el, anim) };
  if (el.type === 'ligne') return { el, box: null, peindre: () => dessinerLigne(film, ctx, el, anim) };
  const anc = ancreElement(el, ctx);
  if (!anc) return null;
  // cache : les elements sans etat variable (texte fixe, icone, coeurs...) ne sont refaits que si la taille de l'image change ;
  // machine et vague refont l'image a chaque pas de l'entree seulement
  const dyn = el.type === 'compteur' || el.type === 'horloge' || el.type === 'minuteur' || el.type === 'chat';
  const lettres = anim.n !== null || anim.vague !== null;
  const cle = `${ctx.W}x${ctx.H}|${ctx.zone.w}` + (dyn ? `|${Math.round(ctx.t * 30)}` : '') + (lettres ? `|m${Math.round((anim.n ?? anim.vague) * 60)}` : '') + (el._cle ? '|' + el._cle : '');
  let spr = el._cache && el._cache.cle === cle ? el._cache.spr : undefined;
  if (spr === undefined) { ctx.anim = anim; spr = construire(el, ctx); ctx.anim = null; el._cache = { cle, spr }; if (el !== el0) el0._cacheJ = el._cache; }
  if (!spr) return null;
  const pose = preparerPose(film, ctx, el, spr, anc, anim);
  if (!pose) return null;
  const c = classer(el, anc);
  const peindre = (dx = 0, dy = 0) => {
    pose.peindre(dx, dy);
    if (el.type === 'hud' && el.viseur) {
      const v = sprite(ctx.kit, 'hud/crosshair');
      if (v) { const E = eHud(ctx, el), w = Math.round(15 * E); poserImage(film, ctx.W, ctx.H, v, Math.round(ctx.W / 2 - w / 2), Math.round(ctx.H / 2 - w / 2), w, w, { alpha: anim.a }); }
    }
  };
  return { el, prio: c.prio, fixe: c.fixe, maxDep: c.maxDep === undefined ? undefined : c.maxDep * ctx.U, evAct: c.evAct, gap: c.gap ? c.gap * ctx.U : 0, box: pose.box, force: anc.mondeAncre ? anc.k : 0, peindre };
}

// Dessine un element sur l'image de film `film` (RGBA W*H*4, alpha 255) a l'instant ctx.t. Retourne true s'il a dessine quelque chose.
// (Sans disposition : le montage complet passe par preparerElement + disposer, voir incrust/index.js.)
export function dessinerElement(film, ctx, el) {
  const p = preparerElement(film, ctx, el);
  if (!p) return false;
  p.peindre(0, 0);
  return true;
}

export { rectPlein, melangerPixel, lireCouleur };
