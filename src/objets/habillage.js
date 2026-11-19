// Habillage d'un personnage : armure portee et objets tenus, ajoutes AU MEME maillage dynamique que le corps (le format du maillage ne change
// pas). Les textures du corps, de l'armure et des objets sont rangees dans un seul atlas (colonne de 64 de large : le skin en haut, puis
// chaque texture dans l'ordre ou on la rencontre) ; les UV du corps sont recalculees pour cet atlas. Sans armure ni objet, rien de tout cela
// n'est appele et le maillage est celui d'avant, au bit pres.
import { maillagesTete, TETE_DE_OBJET, TETES, skinParDefautUUID } from '../film/tetes-modele.js';   // tete portee comme casque
import * as M from '../perso/modele.js';
import { definirParties } from '../perso/modele.js';
import { texture, teinter, textureManquante } from './fichiers.js';
import { cuireReflet } from './reflet.js';
import { resoudreObjet } from './definition.js';
import { cuire, cuireSpecial } from './modele-objet.js';
import { repereMain, matriceObjet } from './placement.js';
import { etatObjet } from './etat-objet.js';
import { PIECES, EMPLACEMENTS, geometrie as geometrieArmure, nomMateriau, couleurArmure, couchesTexture, textureGalon, geometrieAiles, matricesAiles, estElytresArmure } from './armure.js';
const AILES_REPOS = [Math.PI / 12, 0, -Math.PI / 12], AILES_ACCROUPI = [Math.PI * 2 / 9, 0.08726646, -Math.PI / 4];   // ElytraAnimationState (acteur sans simulation : pas de lissage par tick)

// ---------------------------------------------------------------- atlas
class Atlas {
  constructor(perso) {
    this.perso = perso;
    this.entrees = [];            // { cle, t, ox, oy }
    this.parCle = new Map();
    this.l = 64; this.h = 64;
    this.version = 0;
    this._texture = perso.texture; this._masque = perso.masque;
  }
  // Region d'une texture { largeur, hauteur, rgba } : { ox, oy, largeur, hauteur }. Ajoute et reconstruit l'atlas si elle est nouvelle.
  region(cle, t) {
    const e = this.parCle.get(cle);
    if (e) return e;
    const oy = this.entrees.length ? this.entrees[this.entrees.length - 1].oy + this.entrees[this.entrees.length - 1].t.hauteur + 1 : 65;
    const n = { cle, t, ox: 0, oy };
    this.entrees.push(n); this.parCle.set(cle, n);
    this._reconstruire();
    return n;
  }
  _reconstruire() {
    const l = Math.max(64, ...this.entrees.map((e) => e.t.largeur));
    const dernier = this.entrees[this.entrees.length - 1];
    const h = dernier.oy + dernier.t.hauteur;
    const rgba = new Uint8Array(l * h * 4);
    for (let y = 0; y < 64; y++) rgba.set(this.perso.texture.rgba.subarray(y * 256, y * 256 + 256), y * l * 4);   // le skin en haut a gauche
    for (const e of this.entrees) for (let y = 0; y < e.t.hauteur; y++) rgba.set(e.t.rgba.subarray(y * e.t.largeur * 4, (y + 1) * e.t.largeur * 4), ((e.oy + y) * l + e.ox) * 4);
    this.l = l; this.h = h; this.version++;
    this._texture = { largeur: l, hauteur: h, rgba };
    const mk = this.perso.masque;
    if (mk) {
      const valeurs = new Uint8Array(l * h);
      for (let y = 0; y < 64; y++) valeurs.set(mk.valeurs.subarray(y * 64, y * 64 + 64), y * l);
      this._masque = { largeur: l, hauteur: h, valeurs };
    }
  }
  // reflet des objets enchantes (reflet.js) : la meme region, ses pixels recuits a chaque image
  remplacer(e, t) {
    if (e.t.largeur !== t.largeur || e.t.hauteur !== t.hauteur) return;
    e.t = t;
    const rgba = new Uint8Array(this._texture.rgba), l = this.l;   // une copie : le rendu reconnait une texture a son tampon (une nouvelle part aux travailleurs)
    this._texture = { ...this._texture, rgba };
    for (let y = 0; y < t.hauteur; y++) rgba.set(t.rgba.subarray(y * t.largeur * 4, (y + 1) * t.largeur * 4), ((e.oy + y) * l + e.ox) * 4);
    this.version++;
  }
  get texture() { return this._texture; }
  get masque() { return this._masque; }
}

// ---------------------------------------------------------------- objets : geometrie en pixels de modele, mise en cache par (kit, id, main)
const cacheObjets = new Map();
// Retourne { couches: [{ quads par texture : [{ cle, t, local, normales, uvs, indices }], affiche }], notes: [] }
// etat : l'objet tel que tenu (arc tendu, arbalete, boussole, horloge : objets/etat-objet.js) ; le cache suit les modeles choisis
export function objetPret(kit, id, gauche, etat = null) {
  const def = resoudreObjet(kit, id, { gauche, etat });
  const cle = `${kit}|${id}|${gauche ? 'G' : 'D'}|${def.entrees.map((e) => e.model ?? e.special).join(',')}`;
  if (cacheObjets.has(cle)) return cacheObjets.get(cle);
  const notes = [];
  const signaler = (t) => notes.push(t);
  const couches = [];
  if (!def.existe) notes.push(`objet inconnu : ${id}`);
  for (const e of def.entrees) {
    const c = e.special !== undefined ? cuireSpecial(kit, e, { gauche, signaler }) : cuire(kit, e, { gauche, signaler });
    if (e.special !== undefined && c.nature === 'plaque') notes.push(`${id} : dessine par code dans le jeu (${e.special || 'special'}), plaque plate`);
    // un groupe de quads par texture (et par teinte)
    const groupes = new Map();
    for (const q of c.quads) {
      const k = `${q.tex}|${q.tint ?? ''}`;
      if (!groupes.has(k)) groupes.set(k, { tex: q.tex, tint: q.tint, quads: [] });
      groupes.get(k).quads.push(q);
    }
    const morceaux = [];
    for (const g of groupes.values()) {
      let t = texture(kit, g.tex);
      if (!t) { notes.push(`texture absente : ${g.tex}`); t = textureManquante(); }
      morceaux.push({ cle: `${kit}|${g.tex}|${g.tint ?? ''}`, t: teinter(t, g.tint), ...maillageQuads(g.quads) });
    }
    couches.push({ morceaux, affiche: c.affiche, nature: c.nature });
  }
  if (def.exotiques.length) notes.push(`${id} : type de modele non gere (${[...new Set(def.exotiques)].join(', ')})`);
  const r = { couches, notes, existe: def.existe, natures: couches.map((c) => c.nature) };
  cacheObjets.set(cle, r);
  return r;
}
export const objetPourNotes = objetPret;

// quads (4 sommets, blocs) -> local en pixels (x16), normales de face, UV (normalises sur l'image de la texture), indices.
function maillageQuads(quads) {
  const n = quads.length * 4;
  const local = new Float32Array(n * 3), normales = new Float32Array(n * 3), uvs = new Float32Array(n * 2), indices = new Uint32Array(quads.length * 6);
  quads.forEach((q, i) => {
    const a = q.p[0], b = q.p[1], c = q.p[2];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 4; k++) {
      const s = i * 4 + k;
      local.set([q.p[k][0] * 16, q.p[k][1] * 16, q.p[k][2] * 16], s * 3);
      normales.set([nx, ny, nz], s * 3);
      uvs.set(q.uv[k], s * 2);
    }
    indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  return { local, normales, uvs, indices };
}

// ---------------------------------------------------------------- assemblage
// Le Personnage a deja fait son maillage `m` (corps seul) ; on y ajoute l'armure et les objets de la pose.
//   pose.armure : { tete, torse, jambes, pieds } (materiau ou objet d'armure, ou absent/null) ; pose.objetD / pose.objetG : id d'objet ou null.
export function habiller(perso, m, pose, mats, bitsFlexion, lumiere, brut) {
  const kit = perso.kitDir;
  const slim = perso.modele === 'slim';
  const atlas = perso._atlas ??= new Atlas(perso);
  const morceaux = [];     // { local, normales, partie (tableau d'index de mats), uvs (brut), echelle: [lu, lv], region, indices }
  const matsExt = mats.slice();

  // ---- armure : toujours le bras large du jeu (la meme pose, calculee avec les parties larges quand le skin est a bras fins)
  const armure = pose.armure ?? {};
  const utilisees = EMPLACEMENTS.filter((e) => armure[e]);
  let decalageArmure = 0;
  if (utilisees.length) {
    if (slim && utilisees.includes('torse')) { decalageArmure = matsExt.length; for (const x of M.calculerMatrices(definirParties(false), pose)) matsExt.push(x); }
    for (const e of utilisees) {
      const mat = nomMateriau(armure[e]);
      const couches = mat ? couchesTexture(kit, mat, e) : null;
      if (!couches) continue;   // materiau absent du kit pour cet emplacement : signale par le planificateur (mcanim), rien ici
      const g = geometrieArmure(e, bitsFlexion);
      const decale = e === 'torse' ? decalageArmure : 0;
      for (const c of couches) {
        const t = texture(kit, c.nom);
        const teinte = c.teinte !== null ? couleurArmure(armure[e]) ?? c.teinte : null;   // cuir teint de la scene (couleur ou teinture), sinon sa couleur sans teinture
        const brille = !!pose.refletArmure?.[e], tt = teinter(t, teinte);   // armure enchantee : reflet d'armure cuit a cette image (reflet.js)
        morceaux.push({ ...g, partie: decale ? g.partie.map((p) => p + decale) : g.partie, echelle: [64, 64], t: brille ? cuireReflet(kit, tt, (pose.age ?? 0) * 50, true) : tt, cle: `${kit}|${c.nom}|${teinte ?? ''}${brille ? '|reflet|' + e : ''}`, vivant: brille });
      }
      // galon (composant trim) : une couche de plus, par-dessus, sur la meme geometrie (EquipmentLayerRenderer : apres les couches ; reflet aussi)
      const gl = pose.galonArmure?.[e];
      const tg = gl ? textureGalon(kit, mat, e, gl.motif, gl.garniture) : null;
      if (tg) {
        const brille = !!pose.refletArmure?.[e];
        morceaux.push({ ...g, partie: decale ? g.partie.map((p) => p + decale) : g.partie, echelle: [64, 64], t: brille ? cuireReflet(kit, tg, (pose.age ?? 0) * 50, true) : tg, cle: `${kit}|galon|${e}|${mat}|${gl.motif}|${gl.garniture}${brille ? '|reflet' : ''}`, vivant: brille });
      }
    }
  }

  // ---- tete (crane) portee comme casque (CustomHeadLayer) : repere de la tete, scale(1,1875, -1,1875, -1,1875), translate(-0,5, 0, -0,5), puis le crane
  // pose au sol tourne de 180 degres (SkullBlockRenderer.renderSkull(null, 180)) ; joueur : skin du profil (pose.teteSkin), sinon Steve
  const typeTete = TETE_DE_OBJET[String(armure.tete ?? '').replace(/^minecraft:/, '')];
  if (typeTete) {
    const T0 = TETES[typeTete];
    let t = null;
    if (typeTete === 'player' && pose.teteSkin?.tex) t = pose.teteSkin.tex;   // skin du profil deja lu (decor/index.js)
    if (!t && typeTete === 'player' && pose.teteSkin?.uuid) { const sd = skinParDefautUUID(pose.teteSkin.uuid); t = texture(kit, `entity/player/${sd.modele}/${sd.nom}`); }
    if (!t) t = texture(kit, T0.tex.replace(/\.png$/, ''));
    if (t) {
      const k = 16 * 1.1875;
      for (const mt of maillagesTete(typeTete, { rotation: 8, texture: t, place: (q) => [k * (q[0] - 0.5), -k * q[1], -k * (q[2] - 0.5)] })) {
        const n = mt.positions.length / 3, normales = new Float32Array(n * 3);
        for (let q = 0; q < n; q += 4) {
          const P = (i) => [mt.positions[(q + i) * 3], mt.positions[(q + i) * 3 + 1], mt.positions[(q + i) * 3 + 2]];
          const a0 = P(0), a1 = P(1), a2 = P(3), u = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]], w = [a2[0] - a0[0], a2[1] - a0[1], a2[2] - a0[2]];
          let nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
          for (let i = 0; i < 4; i++) normales.set([nx, ny, nz], (q + i) * 3);
        }
        const ind = new Uint32Array(mt.indices.length * 2); ind.set(mt.indices); for (let i = 0; i < mt.indices.length; i += 3) { ind[mt.indices.length + i] = mt.indices[i]; ind[mt.indices.length + i + 1] = mt.indices[i + 2]; ind[mt.indices.length + i + 2] = mt.indices[i + 1]; }   // les deux faces
        morceaux.push({ local: mt.positions, normales, partie: new Uint16Array(n).fill(0), uvs: mt.uvs, indices: ind, echelle: null, t, cle: `${kit}|tete|${typeTete}|${pose.teteSkin?.uuid ?? ''}|${pose.teteSkin?.tex ? 'profil' : ''}` });
      }
    }
  }

  // ---- elytres au plastron (WingsLayer) : deux ailes dans le repere du modele, angles de pose.ailes (film/acteurs-vivants.js : ElytraAnimationState)
  if (estElytresArmure(armure.torse)) {
    const t = texture(kit, 'entity/equipment/wings/elytra');
    if (t) {
      const acc = (pose.accroupi ?? 0) > 0.5;
      const ang = pose.ailes ?? AILES_REPOS.map((a, i) => a + (AILES_ACCROUPI[i] - a) * Math.min(1, Math.max(0, pose.accroupi ?? 0)));
      const g = geometrieAiles(), i0 = matsExt.length;
      for (const m of matricesAiles(ang, acc)) matsExt.push(m);
      morceaux.push({ ...g, partie: Uint16Array.from(g.partie, (p) => p + i0), echelle: [64, 64], t, cle: `${kit}|entity/equipment/wings/elytra|` });
    }
  }

  // ---- objets tenus (main droite = bras droit)
  for (const [cote, champ] of [['D', 'objetD'], ['G', 'objetG']]) {
    const id = pose[champ];
    if (!id) continue;
    const gauche = cote === 'G';
    const o = objetPret(kit, id, gauche, etatObjet(pose, gauche));
    const j = gauche ? 1 : 0;
    const bras = definirParties(slim)[2 + j];
    const ym = bras.orig[1] + bras.taille[1] / 2, kz = bras.orig[2] + bras.taille[2] / 2;
    const main = repereMain(mats[M.partieArt(j, M.N_ARC)], ym, kz, { mince: slim, gauche });
    for (const c of o.couches) {
      const idx = matsExt.length;
      matsExt.push(matriceObjet(main, c.affiche, gauche));
      const brille = !!pose['reflet' + cote];   // objet enchante : reflet cuit a cette image (reflet.js)
      for (const mo of c.morceaux) morceaux.push({ ...mo, ...(brille ? { cle: mo.cle + '|reflet|' + cote, t: cuireReflet(kit, mo.t, (pose.age ?? 0) * 50), vivant: true } : {}), partie: new Uint16Array(mo.local.length / 3).fill(idx), echelle: null });
    }
  }
  if (!morceaux.length) return m;

  // ---- atlas et UV
  for (const p of morceaux) { p.region = atlas.region(p.cle, p.t); if (p.vivant && p.region.t !== p.t) atlas.remplacer(p.region, p.t); }
  const L = atlas.l, H = atlas.h;
  const nBase = m.positions.length / 3;
  const nExtra = morceaux.reduce((s, p) => s + p.local.length / 3, 0);
  const nIdx = morceaux.reduce((s, p) => s + p.indices.length, 0);
  const local = new Float32Array(nExtra * 3), normales = new Float32Array(nExtra * 3), partie = new Uint16Array(nExtra);
  const uvsExtra = new Float32Array(nExtra * 2), indicesExtra = new Uint32Array(nIdx);
  let v = 0, i = 0;
  for (const p of morceaux) {
    const n = p.local.length / 3;
    local.set(p.local, v * 3); normales.set(p.normales, v * 3); partie.set(p.partie, v);
    const r = p.region, sx = p.echelle ? p.echelle[0] : r.t.largeur, sy = p.echelle ? p.echelle[1] : r.t.hauteur;
    for (let k = 0; k < n; k++) { uvsExtra[(v + k) * 2] = (r.ox + p.uvs[k * 2] * sx) / L; uvsExtra[(v + k) * 2 + 1] = (r.oy + p.uvs[k * 2 + 1] * sy) / H; }
    for (let k = 0; k < p.indices.length; k++) indicesExtra[i + k] = p.indices[k] + nBase + v;
    v += n; i += p.indices.length;
  }
  const proj = perso.projeter({ local, normales, partie }, matsExt, pose, lumiere, brut);

  // ---- tout concatener
  const positions = new Float32Array((nBase + nExtra) * 3); positions.set(m.positions); positions.set(proj.positions, nBase * 3);
  const couleurs = new Float32Array((nBase + nExtra) * 3); couleurs.set(m.couleurs); couleurs.set(proj.couleurs, nBase * 3);
  const uvs = new Float32Array((nBase + nExtra) * 2);
  for (let k = 0; k < m.uvs.length; k += 2) { uvs[k] = m.uvs[k] * 64 / L; uvs[k + 1] = m.uvs[k + 1] * 64 / H; }
  uvs.set(uvsExtra, nBase * 2);
  const indices = new Uint32Array(m.indices.length + nIdx); indices.set(m.indices); indices.set(indicesExtra, m.indices.length);
  const sortie = { ...m, positions, uvs, couleurs, indices, texture: atlas.texture };
  if (m.normales) { const nn = new Float32Array((nBase + nExtra) * 3); nn.set(m.normales); nn.set(proj.normales, nBase * 3); sortie.normales = nn; }
  if (m.masque) sortie.masque = atlas.masque;
  if (m.ajout) {   // surcouche rouge des degats : le corps seulement (armure et objets : NO_OVERLAY dans le jeu) ; deux maillages sur le meme atlas
    const corps = { ...sortie, indices: indices.slice(0, m.indices.length) };
    const reste = { ...sortie, indices: indices.slice(m.indices.length) };
    delete reste.ajout;
    return [corps, reste];
  }
  return sortie;
}

// ---------------------------------------------------------------- pour mcanim : ce que la scene demande (planification, notes, erreurs)
export { PIECES };
