// Zones sures des plateformes : ce que l'interface de l'application cache sur une video verticale (barre du haut, colonne de boutons a droite,
// bloc nom / description / musique en bas, barre de progression). Tout texte et toute incrustation se pose DANS le rectangle sur.
// Les chiffres sont en pixels sur un canevas de 1080 x 1920 (mises a l'echelle pour les autres tailles). Ce sont des mesures de TIERS
// (guides de createurs, mars a septembre 2026) : aucune plateforme ne publie de marges officielles pour le contenu organique. Sources : docs/MONTAGE.md.
import { melangerPixel, poserImage } from '../incrust/toile.js';
import { segmentsDeTexte, rendreTexte } from '../incrust/texte.js';

export const REF_L = 1080, REF_H = 1920;

// Profils nommes : marges a laisser libres { haut, bas, gauche, droite }.
const P_TIKTOK = { haut: 200, bas: 420, gauche: 60, droite: 165 };       // bande de boutons ~120 a 165 px, bas : legende + musique, bouton ajoute en bas a droite en 2026
const P_INSTAGRAM = { haut: 270, bas: 420, gauche: 65, droite: 150 };    // Reels : en-tete ~210 a 270, bas 310 a 420 (legende, audio, boutons)
const P_YOUTUBE = { haut: 250, bas: 480, gauche: 60, droite: 190 };      // Shorts : titre + chaine + abonnement jusqu'a ~480 en bas, colonne de 96 a 192 a droite
const union = (...l) => ({ haut: Math.max(...l.map((p) => p.haut)), bas: Math.max(...l.map((p) => p.bas)), gauche: Math.max(...l.map((p) => p.gauche)), droite: Math.max(...l.map((p) => p.droite)) });
export const PROFILS = {
  instagram: P_INSTAGRAM, tiktok: P_TIKTOK, youtube: P_YOUTUBE,
  toutes: union(P_INSTAGRAM, P_TIKTOK, P_YOUTUBE),   // le plus sur : { haut: 270, bas: 480, gauche: 65, droite: 190 }
  aucune: { haut: 0, bas: 0, gauche: 0, droite: 0 },
};
export const NOMS_PROFILS = Object.keys(PROFILS);

// Controle du champ de scene `zonesSures` : un nom de profil ou { haut, bas, gauche, droite } (pixels a 1080x1920). Retourne { nom, marges } ou null (absent).
export function lireZonesSures(D, v, ch = 'zonesSures') {
  if (v === undefined) return null;
  if (typeof v === 'string') {
    if (!PROFILS[v]) D.err(ch, `profil : un de ${NOMS_PROFILS.join(', ')} ou { "haut": 270, "bas": 480, "gauche": 65, "droite": 190 } (pixels a 1080x1920)`);
    return { nom: v, marges: { ...PROFILS[v] } };
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) D.err(ch, `un nom de profil (${NOMS_PROFILS.join(', ')}) ou un objet { haut, bas, gauche, droite } en pixels attendu`);
  const m = {};
  for (const k of Object.keys(v)) if (!['haut', 'bas', 'gauche', 'droite'].includes(k)) D.err(`${ch}.${k}`, 'champ inconnu (permis : haut, bas, gauche, droite)');
  for (const k of ['haut', 'bas', 'gauche', 'droite']) {
    const x = v[k] ?? 0;
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 900) D.err(`${ch}.${k}`, 'marge en pixels (0 a 900, a 1080x1920) attendue');
    m[k] = x;
  }
  if (m.haut + m.bas > 1500 || m.gauche + m.droite > 800) D.err(ch, 'marges trop grandes : il ne reste plus de place pour le texte');
  return { nom: 'perso', marges: m };
}

// Rectangle sur en pixels d'une image W x H. zs : { nom, marges } ou undefined (defaut : "toutes" en vertical, "aucune" en horizontal).
// Les marges sont mises a l'echelle : horizontales par W / 1080, verticales par H / 1920.
// Defaut horizontal "aucune" : une video 16:9 est montree en entier (lecteur YouTube, Facebook) ou recadree par l'application ; ses commandes
// se cachent pendant la lecture. On garde les marges de 4 % / 3 % que les legendes avaient deja (incrust/elements.js).
export function rectSur(zs, W, H) {
  const marges = zs?.marges ?? (H > W ? PROFILS.toutes : PROFILS.aucune);
  const sx = W / REF_L, sy = H / REF_H;
  const x0 = Math.round(marges.gauche * sx), x1 = Math.round(W - marges.droite * sx), y0 = Math.round(marges.haut * sy), y1 = Math.round(H - marges.bas * sy);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, actif: marges.haut + marges.bas + marges.gauche + marges.droite > 0 };
}

// Deplace le rectangle (x, y, w, h) pour qu'il tienne dans r (r.x0..x1, r.y0..y1) ; s'il est plus grand, il est aligne au centre.
// Retourne { x, y, deplacement (pixels) }.
export function contenir(r, x, y, w, h) {
  const nx = w >= r.w ? r.x0 + (r.w - w) / 2 : Math.max(r.x0, Math.min(r.x1 - w, x));
  const ny = h >= r.h ? r.y0 + (r.h - h) / 2 : Math.max(r.y0, Math.min(r.y1 - h, y));
  return { x: nx, y: ny, deplacement: Math.hypot(nx - x, ny - y) };
}

// Coupe le segment (x0,y0)-(x1,y1) au rectangle r (Liang-Barsky). Retourne [x0', y0', x1', y1'] ou null s'il est entierement dehors.
export function couperSegment(r, x0, y0, x1, y1) {
  let u0 = 0, u1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const test = (p, q) => {
    if (p === 0) return q >= 0;
    const u = q / p;
    if (p < 0) { if (u > u1) return false; if (u > u0) u0 = u; } else { if (u < u0) return false; if (u < u1) u1 = u; }
    return true;
  };
  if (!test(-dx, x0 - r.x0) || !test(dx, r.x1 - x0) || !test(-dy, y0 - r.y0) || !test(dy, r.y1 - y0)) return null;
  return [x0 + dx * u0, y0 + dy * u0, x0 + dx * u1, y0 + dy * u1];
}

// ---------------------------------------------------------------- masques d'interface (mcanim apercu --zones, planche)
// Silhouettes translucides de l'interface de chaque plateforme, posees SUR l'image : tout ce qu'elles couvrent serait cache.
// Les formes sont des estimations (colonne de boutons ronds, bloc de texte du bas, barre du haut), pas des copies de l'interface.
const TEINTES = { tiktok: [255, 40, 110], instagram: [170, 70, 255], youtube: [255, 190, 0] };
const ETIQUETTES = { tiktok: 'TT', instagram: 'IG', youtube: 'YT' };

function rectAlpha(film, W, H, x0, y0, x1, y1, c, a) {
  const xa = Math.max(0, Math.round(x0)), xb = Math.min(W, Math.round(x1)), ya = Math.max(0, Math.round(y0)), yb = Math.min(H, Math.round(y1));
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) melangerPixel(film, (y * W + x) * 4, c[0], c[1], c[2], a);
}
function disque(film, W, H, cx, cy, r, c, a) {
  const xa = Math.max(0, Math.floor(cx - r)), xb = Math.min(W - 1, Math.ceil(cx + r)), ya = Math.max(0, Math.floor(cy - r)), yb = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) melangerPixel(film, (y * W + x) * 4, c[0], c[1], c[2], a);
}
// disque a peine teinte entoure d'un anneau de 3 pixels
function anneau(film, W, H, cx, cy, r, c, aInt, aBord) {
  const xa = Math.max(0, Math.floor(cx - r - 1)), xb = Math.min(W - 1, Math.ceil(cx + r + 1)), ya = Math.max(0, Math.floor(cy - r - 1)), yb = Math.min(H - 1, Math.ceil(cy + r + 1));
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d <= r - 3) melangerPixel(film, (y * W + x) * 4, c[0], c[1], c[2], aInt); else if (d <= r) melangerPixel(film, (y * W + x) * 4, c[0], c[1], c[2], aBord); }
}
function cadre(film, W, H, x0, y0, x1, y1, c, a) {
  rectAlpha(film, W, H, x0, y0, x1, y0 + 2, c, a); rectAlpha(film, W, H, x0, y1 - 2, x1, y1, c, a);
  rectAlpha(film, W, H, x0, y0, x0 + 2, y1, c, a); rectAlpha(film, W, H, x1 - 2, y0, x1, y1, c, a);
}

// Dessine les masques des trois plateformes sur `film` (RGBA W*H*4). police : pour les etiquettes (facultatif).
export function dessinerMasques(film, W, H, police = null) {
  const sx = W / REF_L, sy = H / REF_H;
  const noms = ['youtube', 'instagram', 'tiktok'];
  noms.forEach((nom, n) => {
    const p = PROFILS[nom], c = TEINTES[nom];
    const x0 = p.gauche * sx, x1 = W - p.droite * sx, haut = p.haut * sy, bas = H - p.bas * sy;
    rectAlpha(film, W, H, 0, 0, W, haut, c, 34); cadre(film, W, H, 0, 0, W, haut, c, 150);   // barre du haut
    rectAlpha(film, W, H, 0, bas, W, H, c, 30); cadre(film, W, H, 0, bas, W, H, c, 150);   // bloc nom, description, musique, progression
    // colonne de boutons ronds a droite (5 boutons, du milieu vers le bas)
    const colonne = W - p.droite * sx, larg = p.droite * sx;
    const r = Math.min(larg * 0.34, 62 * sx), top = 0.46 * H, pas = (bas - top - r) / 5 + n * 0;
    for (let k = 0; k < 5; k++) { const cx = colonne + larg * 0.58, cy = top + r + k * pas; anneau(film, W, H, cx, cy, r, c, 40, 170); }
    rectAlpha(film, W, H, colonne, haut, colonne + 2, bas, c, 140);
    void x0; void x1;
  });
  if (police) {
    noms.forEach((nom, n) => {
      const S = Math.max(1, Math.round(W / 270));
      const r = rendreTexte(police, segmentsDeTexte(ETIQUETTES[nom] + ' ' + PROFILS[nom].haut + '/' + PROFILS[nom].bas + '/' + PROFILS[nom].droite, { couleur: [255, 255, 255] }), { S, contour: { couleur: [0, 0, 0, 255], ep: S }, alignement: 'gauche' });
      poserImage(film, W, H, r.img, Math.round(6 * S), Math.round(4 * S + n * (r.img.h + S)), r.img.w, r.img.h);
    });
  }
}
