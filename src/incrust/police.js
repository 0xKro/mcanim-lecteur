// Police du jeu : lit assets/minecraft/font/<nom>.json dans le KIT (groupe `interface`) et donne les glyphes comme le jeu.
// Un pack de ressources (--pack) qui redefinit font/default.json (ou les PNG de textures/font/) REMPLACE ces fichiers dans le kit fusionne :
// la police du pack prend donc la place de celle du jeu sans autre reglage.
//
// Fournisseurs gere (comme le jeu) :
//   bitmap     : grille de glyphes `chars` dans une image (hauteur `height`, defaut 8 ; `ascent`) ; la largeur d'un glyphe est rognee
//                sur la derniere colonne non transparente ; avance = (int)(0,5 + largeur * echelle) + 1.
//   space      : avances fixes (l'espace vaut 4).
//   reference  : un autre fichier de police (font/include/xxx.json), avec ses filtres.
//   ttf        : police TrueType (src/incrust/ttf.js) ; `size`, `shift`, `skip`.
//   unihex / legacy_unicode : NON gere (fichiers trop gros, absents du kit) -> les glyphes qui en dependent sont "manquants" ; on le dit UNE fois.
// Premier fournisseur qui a le caractere : il gagne (comme le jeu).
import fs from 'node:fs';
import path from 'node:path';
import { decoderPNG } from '../rendu/png.js';

const RACINE = (kit) => path.join(kit, 'assets', 'minecraft');
const nettoyer = (n) => String(n).replace(/^minecraft:/, '');
const caches = new Map();   // kit|nom -> Police
let ttfModule = null;
async function chargerTtf() { if (ttfModule === null) { try { ttfModule = await import('./ttf.js'); } catch { ttfModule = false; } } return ttfModule; }

export class Police {
  constructor(nom) { this.nom = nom; this.glyphes = new Map(); this.avances = new Map(); this.notes = new Set(); this.manquants = new Set(); this.ttf = []; this.fournisseurs = 0; }
  // Glyphe d'un point de code, ou null (alors on prend le carre "manquant" du jeu).
  glyphe(cp) { return this.glyphes.get(cp) ?? null; }
  // Avance horizontale en pixels de police (1 pixel = 1/8 de la hauteur d'une ligne).
  avance(cp, gras = false) {
    const a = this.avances.get(cp);
    const g = a !== undefined ? a : this.glyphes.get(cp)?.avance;
    if (g === undefined) { this.manquants.add(cp); return 6 + (gras && !this.sansGras ? 1 : 0); }   // glyphe manquant : le jeu dessine un carre de 5 de large
    return g + (gras && !this.sansGras ? 1 : 0);
  }
  aGlyphe(cp) { return this.glyphes.has(cp) || this.avances.has(cp); }
  // Phrase unique sur les glyphes absents (a afficher une fois).
  noteManquants() {
    const sub = this.substitues?.size ? `police : ${[...this.substitues].map(([c, r]) => `${c} -> ${r}`).join(', ')} (caractere(s) absent(s) de la police, remplace(s) par des lettres)` : null;
    if (!this.manquants.size) return sub;
    const l = [...this.manquants].slice(0, 8).map((c) => String.fromCodePoint(c)).join(' ');
    return `police : ${this.manquants.size} glyphe(s) absent(s) (${l}${this.manquants.size > 8 ? '...' : ''}), remplaces par un carre${this.notes.has('unihex') ? ' ; le fournisseur unihex du jeu (police Unifont) n\'est pas dans le kit' : ''}${sub ? ' ; ' + sub : ''}`;
  }
}

function lireFichierPolice(kit, id) {
  const n = nettoyer(id).replace(/\.json$/, '');
  const f = path.join(RACINE(kit), 'font', ...n.split('/')) + '.json';
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}
function lirePng(kit, ref, cache) {
  const n = nettoyer(ref);
  if (cache.has(n)) return cache.get(n);
  let r = null;
  try { const d = decoderPNG(fs.readFileSync(path.join(RACINE(kit), 'textures', ...n.split('/')))); r = { w: d.largeur, h: d.hauteur, px: new Uint8Array(d.rgba) }; } catch { /* absent */ }
  cache.set(n, r);
  return r;
}

// Un fournisseur "filter" : { uniform: bool, jp: bool } : on garde ceux qui conviennent a la police "normale" (uniform faux).
const filtreOk = (f) => !f || ((f.uniform === undefined || f.uniform === false) && (f.jp === undefined || f.jp === false));

// Charge la police `nom` ("default") du kit. Synchrone sauf le module TTF (charge a la demande) : `await chargerPolice(...)`.
export async function chargerPolice(kit, nom = 'default', { notes = null } = {}) {
  const cle = `${kit}|${nom}`;
  if (caches.has(cle)) return caches.get(cle);
  const police = new Police(nom);
  const pngs = new Map();
  const vus = new Set();
  const visiter = async (id, profondeur) => {
    if (profondeur > 6 || vus.has(id)) return;
    vus.add(id);
    const j = lireFichierPolice(kit, id);
    if (!j || !Array.isArray(j.providers)) { police.notes.add('fichier'); return; }
    for (const p of j.providers) {
      if (!p || typeof p !== 'object' || !filtreOk(p.filter)) continue;
      police.fournisseurs++;
      if (p.type === 'reference') await visiter(p.id, profondeur + 1);
      else if (p.type === 'space') { for (const [c, a] of Object.entries(p.advances ?? {})) { const cp = c.codePointAt(0); if (!police.avances.has(cp) && Number.isFinite(a)) police.avances.set(cp, a); } }
      else if (p.type === 'bitmap') ajouterBitmap(police, p, lirePng(kit, p.file, pngs));
      else if (p.type === 'ttf') await ajouterTtf(police, p, kit);
      else if (p.type === 'unihex' || p.type === 'legacy_unicode') police.notes.add('unihex');
    }
  };
  await visiter(`${nom}`, 0);
  if (!police.glyphes.size && !police.avances.size) police.notes.add('vide');
  caches.set(cle, police);
  void notes;
  return police;
}

function ajouterBitmap(police, p, img) {
  if (!img || !Array.isArray(p.chars) || !p.chars.length) { police.notes.add('bitmap'); return; }
  const lignes = p.chars.map((s) => [...String(s)].map((c) => c.codePointAt(0)));
  const cols = Math.max(...lignes.map((l) => l.length)), rangs = lignes.length;
  const cw = Math.floor(img.w / cols), ch = Math.floor(img.h / rangs);
  if (cw < 1 || ch < 1) { police.notes.add('bitmap'); return; }
  const hauteur = Number.isFinite(p.height) && p.height > 0 ? p.height : 8, ascent = Number.isFinite(p.ascent) ? p.ascent : 7;
  const echelle = hauteur / ch;
  lignes.forEach((l, r) => l.forEach((cp, c) => {
    if (cp === 0 || police.glyphes.has(cp) || police.avances.has(cp)) return;
    const x0 = c * cw, y0 = r * ch;
    // largeur reelle : derniere colonne (a partir de la droite) qui a un pixel non transparent
    let lg = 0;
    for (let x = cw - 1; x >= 0 && !lg; x--) for (let y = 0; y < ch; y++) if (img.px[((y0 + y) * img.w + x0 + x) * 4 + 3] !== 0) { lg = x + 1; break; }
    police.glyphes.set(cp, { type: 'b', img, x: x0, y: y0, cw: lg, ch, echelle, ascent, avance: Math.trunc(0.5 + lg * echelle) + 1 });
  }));
}

async function ajouterTtf(police, p, kit) {
  const m = await chargerTtf();
  if (!m) { police.notes.add('ttf'); return; }
  let police0 = null;
  try { const f = path.join(RACINE(kit), 'font', ...nettoyer(p.file).split('/')); police0 = m.lireTTF(fs.readFileSync(fs.existsSync(f) ? f : path.join(RACINE(kit), 'textures', ...nettoyer(p.file).split('/')))); } catch { police.notes.add('ttf'); return; }
  const taille = Number.isFinite(p.size) && p.size > 0 ? p.size : 11;
  const saute = new Set([...(typeof p.skip === 'string' ? p.skip : Array.isArray(p.skip) ? p.skip.join('') : '')].map((c) => c.codePointAt(0)));
  const shift = Array.isArray(p.shift) ? p.shift : [0, 0];
  police.ttf.push(police0);
  // les glyphes TTF sont ajoutes a la demande : on ne connait pas la liste des points de code ; `glyphe` y est paresseux (voir Police.glyphe)
  const ancien = police.glyphe.bind(police), ancienAvance = police.avance.bind(police), ancienA = police.aGlyphe.bind(police);
  const fabrique = (cp) => {
    if (saute.has(cp) || !police0.aGlyphe(cp)) return null;
    // en pixels de police : taille `size` = hauteur d'em ; echelle de dessin appliquee plus tard (S)
    return { type: 't', ttf: police0, cp, taille, shift, avance: police0.avance(cp, taille) };
  };
  police.glyphe = (cp) => { const a = ancien(cp); if (a) return a; const g = fabrique(cp); if (g) police.glyphes.set(cp, g); return g; };
  police.avance = (cp, gras = false) => { if (!ancienA(cp)) { const g = fabrique(cp); if (g) { police.glyphes.set(cp, g); } } return ancienAvance(cp, gras); };
  police.aGlyphe = (cp) => ancienA(cp) || !!fabrique(cp);
}

// Police "sans" fournie avec le lecteur : Source Sans 3 Black (licence SIL OFL 1.1, polices/OFL.txt), un gras rond et lisible comme les legendes des
// videos de reference. Les glyphes manquants (rares) viennent de la police du jeu. Le gras n'est pas redouble (la police est deja grasse).
let sansCache = null;
export async function chargerPoliceSans(kit) {
  const cle = 'sans|' + kit;
  if (sansCache?.has(cle)) return sansCache.get(cle);
  const jeu = await chargerPolice(kit);
  const m = await chargerTtf();
  const police = new Police('sans');
  police.sansGras = true;
  if (!m) { police.notes.add('ttf'); return jeu; }
  let police0;
  try { police0 = m.lireTTF(fs.readFileSync(new URL('./polices/SourceSans3-Black.ttf', import.meta.url))); } catch { return jeu; }
  const taille = 10.6;   // hauteur d'em en pixels de police : capitales de 7 pixels, comme la police du jeu
  const fabrique = (cp) => (police0.aGlyphe(cp) ? { type: 't', ttf: police0, cp, taille, shift: [0, 0], avance: police0.avance(cp, taille) } : null);
  police.ttf.push(police0);
  police.glyphe = (cp) => { const a = police.glyphes.get(cp); if (a) return a; const g = fabrique(cp) ?? jeu.glyphe(cp); if (g) police.glyphes.set(cp, g); return g; };
  police.avance = (cp) => { const g = police.glyphe(cp); if (g) return g.avance; const a = jeu.avances.get(cp); if (a !== undefined) return a; police.manquants.add(cp); return 6; };
  police.aGlyphe = (cp) => !!police.glyphe(cp) || jeu.avances.has(cp);
  police.avances = jeu.avances;   // les espaces fins du jeu
  if (!sansCache) sansCache = new Map();
  sansCache.set(cle, police);
  return police;
}

// Oublie les polices lues (tests).
export function viderCachePolices() { caches.clear(); sansCache = null; }
