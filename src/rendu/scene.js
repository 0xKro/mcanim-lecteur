// Scene : zone + maillage + rendu (workers) + aides pour l'IA (resume, sol, collisions).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { lireZone } from './zone.js';
import { BibliothequeTextures } from './textures.js';
import { BibliothequeModeles } from './modeles.js';
import { CouleursBiomes } from './teinte.js';
import { mailler, courbeLumiere } from './maillage.js';
import { trouverChemins, trouverClairieres, trouverEau, evaluerSegment, verifierChemin } from './chemins.js';
import { Rasteriseur, MODE_OPAQUE, MODE_DECOUPE, MODE_MELANGE } from './raster.js';
import { PostTraitement, imageActive, aFlou } from './post.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const MODES = { opaque: MODE_OPAQUE, decoupe: MODE_DECOUPE, melange: MODE_MELANGE };

// Accepte le dossier du kit (<cache>/26.3) ou la racine du cache (<cache>).
export function dossierKit(kitDir) {
  if (!kitDir) throw new Error('kitDir manquant : donnez le dossier retourne par ensureKit() (ex. .kit-cache/26.3)');
  const cands = [kitDir, path.join(kitDir, '26.3')];
  for (const c of cands) if (fs.existsSync(path.join(c, 'assets', 'minecraft', 'blockstates'))) return c;
  throw new Error('kit introuvable dans ' + kitDir + ' (lancez bin/kit.js pour le telecharger)');
}

export async function chargerScene({ zonePath, zone, kitDir, travailleurs, options = {} } = {}) {
  const t0 = performance.now();
  const kit = dossierKit(kitDir);
  const z = zone || lireZone(zonePath);
  const tex = new BibliothequeTextures(kit);
  const modeles = new BibliothequeModeles(kit, tex);
  const couleurs = new CouleursBiomes(kit);
  const tLecture = performance.now();
  const maillage = mailler({ zone: z, modeles, textures: tex, couleurs, options });
  const tMaillage = performance.now();
  const s = new Scene({ zone: z, modeles, textures: tex, maillage, travailleurs, options });
  s.temps = { lectureMs: tLecture - t0, maillageMs: tMaillage - tLecture, totalMs: performance.now() - t0 };
  await s.demarrer();
  s.temps.totalMs = performance.now() - t0;
  return s;
}

class Scene {
  constructor({ zone, modeles, textures, maillage, travailleurs, options }) {
    this.zone = zone; this.modeles = modeles; this.textures = textures; this.maillage = maillage;
    this.options = options;
    this.nTrav = travailleurs ?? Math.max(1, Math.min(os.availableParallelism(), 4));
    // draws statiques
    this.draws = [];
    const atlas = maillage.atlas;
    const tex = { niveaux: atlas.niveaux.map((n) => ({ w: n.w, h: n.h, data: n.data })) };
    for (const [nom, mode] of [['opaque', MODE_OPAQUE], ['decoupe', MODE_DECOUPE], ['melange', MODE_MELANGE]]) {
      const c = maillage.couches[nom];
      if (c.nbQuads === 0) continue;
      this.draws.push({ positions: c.positions, uvs: c.uvs, couleurs: c.couleurs, indices: c.indices, sections: c.sections, tex, mode, deuxFaces: false, partage: false });
    }
    this.travailleursListe = [];
    this.idImage = 0;
    this.pixels = null; this.W = 0; this.H = 0;
    this.texIds = new WeakMap(); this.prochainTexId = 1;
    this.masqueIds = new WeakMap(); this.prochainMasque = 1; this._masquesNouveaux = []; this._masquesLocaux = new Map();
    this.force = null; this.post = new PostTraitement();
    this.persistants = new Map(); this.prochainMaillage = 1;
    this.local = null;
    this._preparerAcces();
    const R = Math.max(40, 0.5 * Math.min(zone.sx, zone.sz));
    this.distanceVue = R * 1.15;
  }

  async demarrer() {
    if (this.nTrav <= 0) { this.local = new Rasteriseur(); return; }
    const url = path.join(ICI, 'travailleur.js');
    for (let i = 0; i < this.nTrav; i++) {
      const w = new Worker(url, { workerData: { draws: this.draws, rangeeDe: i, nW: this.nTrav } });
      this.travailleursListe.push(w);
    }
  }

  async fermer() {
    for (const w of this.travailleursListe) await w.terminate();
    this.travailleursListe = [];
  }

  // ---- maillages dynamiques ----
  _preparer(m) {
    const nv = m.positions.length / 3;
    if (m.uvs.length / 2 !== nv || m.couleurs.length / 3 !== nv) throw new Error('maillage : positions, uvs et couleurs doivent avoir le meme nombre de sommets');
    const pos = Float32Array.from(m.positions), uvs = Float32Array.from(m.uvs);
    const col = new Uint32Array(nv);
    for (let i = 0; i < nv; i++) {
      const r = Math.max(0, Math.min(255, Math.round(m.couleurs[i * 3] * 255))), g = Math.max(0, Math.min(255, Math.round(m.couleurs[i * 3 + 1] * 255))), b = Math.max(0, Math.min(255, Math.round(m.couleurs[i * 3 + 2] * 255)));
      col[i] = (255 << 24 | b << 16 | g << 8 | r) >>> 0;
    }
    const ind = Uint32Array.from(m.indices);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nv; i++) for (let a = 0; a < 3; a++) { const v = pos[i * 3 + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
    const t = m.texture;
    let tex;
    if (t && t.rgba) {
      let id = this.texIds.get(t.rgba);
      if (!id) { id = this.prochainTexId++; this.texIds.set(t.rgba, id); this._nouvelles.push({ id, w: t.largeur, h: t.hauteur, data: new Uint32Array(t.rgba.buffer.slice(t.rgba.byteOffset, t.rgba.byteOffset + t.largeur * t.hauteur * 4)) }); }
      tex = id;
    } else {
      let id = this.texBlanche;
      if (!id) { id = this.texBlanche = this.prochainTexId++; this._nouvelles.push({ id, w: 1, h: 1, data: new Uint32Array([0xffffffff]) }); }
      tex = id;
    }
    const mode = MODES[m.mode || 'opaque'];
    if (mode === undefined) throw new Error("mode inconnu (opaque, decoupe, melange) : " + m.mode);
    // couleur selective : masque (un octet par texel de la texture), force, lueur, exemption totale
    let masqueId = 0;
    const mk = m.masque;
    if (mk) {
      if (!t || !t.rgba || mk.largeur !== t.largeur || mk.hauteur !== t.hauteur || mk.valeurs.length !== t.largeur * t.hauteur) throw new Error('maillage : le masque doit avoir la meme taille que la texture');
      masqueId = this.masqueIds.get(mk.valeurs) || 0;
      if (!masqueId) { masqueId = this.prochainMasque++; this.masqueIds.set(mk.valeurs, masqueId); this._masquesNouveaux.push({ id: masqueId, data: Uint8Array.from(mk.valeurs) }); }
    }
    const kM = Math.max(0, Math.min(256, Math.round((m.forceMasque ?? 1) * 256))), kE = Math.max(0, Math.min(256, Math.round((m.lueur ?? 0) * 256)));
    return { positions: pos, uvs, couleurs: col, indices: ind, sections: [{ debut: 0, nb: ind.length, bbox: [...mn, ...mx] }], texId: tex, mode, deuxFaces: !!m.deuxFaces, partage: true, masqueId, kM, kE, exempt: !!m.exempt };
  }

  ajouterMaillage(m) { const id = this.prochainMaillage++; this.persistants.set(id, m); return id; }
  retirerMaillage(id) { this.persistants.delete(id); }

  // ---- rendu ----
  async rendre({ camera, largeur = 1920, hauteur = 1080, temps = 0, maillagesDynamiques = [], brume, ciel, soleil, loin, mip = true, ssaa = 1, copie = true, lumiere, image } = {}) {
    const sortieW = largeur, sortieH = hauteur;
    largeur *= ssaa; hauteur *= ssaa;
    const cam = { x: camera.x, y: camera.y, z: camera.z, lacet: camera.lacet ?? 0, tangage: camera.tangage ?? 0, fov: camera.fov ?? 70 };
    if (!this.pixels || this.W !== largeur || this.H !== hauteur) {
      this.pixels = new Uint32Array(new SharedArrayBuffer(largeur * hauteur * 4)); this.W = largeur; this.H = hauteur;
      this.force = null;
    }
    this.textures.mettreAJour(temps);
    this._nouvelles = []; this._masquesNouveaux = [];
    const dyn = [...this.persistants.values(), ...maillagesDynamiques].map((m) => this._preparer(m));
    // couleur selective : le tampon de force n'existe (et ne coute) que si l'image est etalonnee ET qu'un maillage est exempte
    const postActif = imageActive(image);
    const veutForce = postActif && dyn.some((d) => d.masqueId || d.exempt);
    if (veutForce && !this.force) this.force = new Uint8Array(new SharedArrayBuffer(largeur * hauteur));
    const force = veutForce ? this.force : null;
    // le post-traitement se fait par les workers (chacun ses bandes) quand il n'y a ni flou ni surechantillonnage ; sinon thread principal
    const postParWorkers = postActif && ssaa === 1 && !aFlou(image) && !this.local && this.travailleursListe.length > 0;
    const R = this.distanceVue;
    const params = {
      proche: 0.05, loin: loin ?? (brume?.fin ?? R) + 8, mip,
      brumeDebut: brume?.debut ?? R * 0.55, brumeFin: brume?.fin ?? R, brume: brume?.couleur ?? [192, 216, 255],
      cielZenith: ciel?.zenith ?? [120, 167, 255], cielHorizon: ciel?.horizon ?? [192, 216, 255], cielBas: ciel?.bas ?? [170, 195, 235],
      soleil: soleil === false ? null : (soleil ?? normaliser([0.35, 0.8, -0.45])),
    };
    if (brume?.debut !== undefined && brume.fin === undefined && params.brumeFin <= params.brumeDebut) params.brumeFin = params.brumeDebut + 8;
    if (lumiere && (lumiere[0] !== 1 || lumiere[1] !== 1 || lumiere[2] !== 1)) params.lumiere = lumiere.map((v) => Math.max(0, v));
    // camera sous l'eau : brouillard bleu court, comme dans le jeu
    if (this.estDansEau(cam.x, cam.y, cam.z)) {
      const c = [24, 56, 150];
      params.brumeDebut = 0; params.brumeFin = 28; params.brume = c; params.cielZenith = c; params.cielHorizon = c; params.cielBas = c; params.soleil = null;
    }
    const id = ++this.idImage;
    const sw = this.local || !this.travailleursListe.length;
    if (sw) {
      const r = this.local || (this.local = new Rasteriseur());
      const textures = new Map(this._nouvelles.map((t) => [t.id, { niveaux: [{ w: t.w, h: t.h, data: t.data }] }]));
      this._texLocales = new Map([...(this._texLocales || []), ...textures]);
      for (const k of this._masquesNouveaux) this._masquesLocaux.set(k.id, k.data);
      const draws = this.draws.concat(dyn.map((d) => ({ ...d, tex: this._texLocales.get(d.texId), masque: d.masqueId ? this._masquesLocaux.get(d.masqueId) : null })));
      this.dernieresStats = r.rendre({ pixels: this.pixels, W: largeur, H: hauteur, cam, draws, rangeeDe: 0, nW: 1, params, force });
    } else {
      const promesses = this.travailleursListe.map((w, i) => new Promise((ok, ko) => {
        const cle = id * 100 + i;
        const h = (m) => { if (m.type === 'fini' && m.id === cle) { w.off('message', h); w.off('error', ko); ok(m); } };
        w.on('message', h);
        w.once('error', ko);
        // les masques sont envoyes a tous les workers la premiere fois (liste cumulee tant que l'image n'a pas ete rendue)
        w.postMessage({ type: 'image', id: cle, pixels: this.pixels, W: largeur, H: hauteur, cam, dynamiques: dyn, texturesNouvelles: this._nouvelles, masquesNouveaux: this._masquesNouveaux, params, force, post: postParWorkers ? image : null });
      }));
      const res = await Promise.all(promesses);
      this.dernieresStats = { workers: res.map((r) => r.stats) };
    }
    if (ssaa > 1) { // reduction : moyenne des ssaa x ssaa pixels (la force d'exemption aussi)
      if (!this.sortie || this.sortie.length !== sortieW * sortieH) { this.sortie = new Uint32Array(sortieW * sortieH); this.forceRed = null; }
      reduire(this.pixels, largeur, this.sortie, sortieW, sortieH, ssaa);
      let fr = null;
      if (force) { if (!this.forceRed) this.forceRed = new Uint8Array(sortieW * sortieH); reduireForce(force, largeur, this.forceRed, sortieW, sortieH, ssaa); fr = this.forceRed; }
      if (postActif) this.post.appliquer(this.sortie, sortieW, sortieH, image, fr);
      const o = new Uint8Array(this.sortie.buffer, 0, sortieW * sortieH * 4);
      return copie ? Uint8Array.from(o) : o;
    }
    if (postActif && !postParWorkers) this.post.appliquer(this.pixels, largeur, hauteur, image, force);
    const out = new Uint8Array(this.pixels.buffer, 0, largeur * hauteur * 4);
    return copie ? Uint8Array.from(out) : out;
  }

  // ---------------- aides ----------------
  _preparerAcces() {
    const { pal, PX, PY, PZ, etats, kind } = this.maillage.interne;
    const n = etats.length;
    this.collision = new Uint8Array(n); this.feuillesP = new Uint8Array(n); this.solideCam = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (i === 1) { this.collision[i] = 1; this.solideCam[i] = 1; continue; }
      const e = etats[i];
      if (!e) continue;
      this.feuillesP[i] = e.feuilles ? 1 : 0;
      this.solideCam[i] = e.opaque && !e.feuilles ? 1 : 0;   // cube plein opaque (troncs compris) : bloque la camera
      this.collision[i] = e.type === 1 && (e.opaque || e.aoSolide || !NON_COLLISION.test(e.nom)) ? 1 : 0;
    }
    void pal; void PX; void PY; void PZ; void kind;
  }

  _pal(x, y, z) { // indice de palette (monde), bordure comprise
    const { pal, PX, PY, PZ } = this.maillage.interne;
    const lx = x - this.zone.x0, ly = y - this.zone.y0, lz = z - this.zone.z0;
    if (lx < -1 || ly < -1 || lz < -1 || lx > this.zone.sx || ly > this.zone.sy || lz > this.zone.sz) return 0;
    return pal[((ly + 1) * PZ + (lz + 1)) * PX + (lx + 1)];
  }

  // Y (haut du bloc) ou l'on peut marcher en (x,z) : le plus haut bloc a collision, SANS compter les
  // feuilles (on marche "sous" les arbres), l'eau, ni les plantes. null si hors zone ou colonne vide.
  solEn(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (!this.zone.dansZone(x, z)) return null;
    for (let y = this.zone.y0 + this.zone.sy - 1; y >= this.zone.y0; y--) {
      const p = this._pal(x, y, z);
      if (this.collision[p] && !this.feuillesP[p]) return p === 1 ? null : y + 1;
    }
    return null;
  }

  // Niveau de lumiere du ciel (0..15) de la cellule qui contient le point (15 = plein ciel, sous un arbre : 10 a 13).
  niveauLumiere(x, y, z) {
    const { lum, PX, PY, PZ } = this.maillage.interne;
    const lx = Math.floor(x) - this.zone.x0, ly = Math.floor(y) - this.zone.y0, lz = Math.floor(z) - this.zone.z0;
    if (lx < -1 || ly < -1 || lz < -1 || lx > this.zone.sx || ly > this.zone.sy || lz > this.zone.sz) return 15;
    return lum[((ly + 1) * PZ + (lz + 1)) * PX + (lx + 1)];
  }

  // Luminosite 0..1 (apres la courbe du jeu) a multiplier dans les couleurs des maillages dynamiques.
  luminositeEn(x, y, z) { return courbeLumiere(this.niveauLumiere(x, y, z), this.options.gamma ?? 0.5); }

  // Vrai si le point est dans une cellule d'eau
  estDansEau(x, y, z) {
    const e = this.maillage.interne.etats[this._pal(Math.floor(x), Math.floor(y), Math.floor(z))];
    return !!(e && e.eau);
  }

  // Y de la surface de l'eau en (x,z), ou null s'il n'y a pas d'eau au-dessus du sol.
  eauEn(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    const sol = this.solEn(x, z);
    if (sol === null) return null;
    for (let y = this.zone.y0 + this.zone.sy - 1; y >= sol; y--) {
      const e = this.maillage.interne.etats[this._pal(x, y, z)];
      if (e && e.eau) return y + (this._pal(x, y + 1, z) && this.maillage.interne.etats[this._pal(x, y + 1, z)]?.eau ? 1 : 14 / 16);
    }
    return null;
  }

  // Vrai si le point (x,y,z) est dans une cellule ou la camera/un personnage peut se trouver :
  // ni bloc a collision, ni feuilles, ni cellule cachee. Hors zone : libre au-dessus de la surface seulement.
  estLibre(x, y, z) {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (!this.zone.dansZone(bx, bz)) return by > this.zone.hauteur(bx, bz);
    const p = this._pal(bx, by, bz);
    return !(this.collision[p] || this.feuillesP[p]);
  }

  // Vrai si le point est dans un bloc VRAIMENT plein et opaque (pierre, terre, tronc...) : seul ce qui bloque la camera.
  // Feuilles, plantes, herbe, fleurs, lianes, eau, dalles, clotures ne comptent pas (une camera peut traverser un feuillage).
  // Hors zone : plein sous la surface seulement (comme estLibre).
  estSolidePourCamera(x, y, z) {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (!this.zone.dansZone(bx, bz)) return by <= this.zone.hauteur(bx, bz);
    return this.solideCam[this._pal(bx, by, bz)] === 1;
  }

  // Nature du bloc qui occupe la cellule : 'tronc' | 'feuillage' | 'bloc' (autre bloc a collision) | null (rien qui gene).
  classeBloc(x, y, z) {
    const p = this._pal(Math.floor(x), Math.floor(y), Math.floor(z));
    if (this.feuillesP[p]) return 'feuillage';
    if (!this.collision[p]) return null;
    const e = this.maillage.interne.etats[p];
    return e && /(_log|_stem|_wood)$/.test(e.nom) ? 'tronc' : 'bloc';
  }

  // Distance libre (en blocs, max `max`) devant un point, dans une direction (pas de 0,5).
  distanceLibre(x, y, z, dx, dy, dz, max = 30) {
    const n = Math.hypot(dx, dy, dz); dx /= n; dy /= n; dz /= n;
    for (let d = 0.5; d <= max; d += 0.5) if (!this.estLibre(x + dx * d, y + dy * d, z + dz * d)) return d - 0.5;
    return max;
  }

  // Point de vue par defaut : au sol pres du centre (yeux a 1,62), tourne vers le centre des troncs d'arbres,
  // en choisissant parmi les points proches du centre celui qui a le plus de vue degagee.
  vueParDefaut() {
    const Z = this.zone;
    const cx = Math.floor(Z.x0 + Z.sx / 2), cz = Math.floor(Z.z0 + Z.sz / 2);
    const troncs = this._troncs();
    let tx = cx, tz = cz + 10;
    if (troncs.length) { tx = troncs.reduce((a, t) => a + t[0], 0) / troncs.length; tz = troncs.reduce((a, t) => a + t[1], 0) / troncs.length; }
    let meilleur = null;
    const rMax = Math.max(24, Math.floor(Math.min(Z.sx, Z.sz) / 2) - 4);
    for (let r = 0; r <= rMax; r += 3) {
      for (let a = 0; a < 360; a += 30) {
        const x = Math.round(cx + r * Math.cos((a * Math.PI) / 180)), zz = Math.round(cz + r * Math.sin((a * Math.PI) / 180));
        const sol = this.solEn(x, zz);
        if (sol === null || this.eauEn(x, zz) !== null) continue;
        const p = { x: x + 0.5, y: sol + 1.62, z: zz + 0.5 };
        if (!this.estLibre(p.x, p.y, p.z) || !this.estLibre(p.x, sol + 0.5, p.z)) continue;
        // degagement autour de la tete : au moins 2 blocs libres dans les 8 directions
        let serre = false;
        for (let k = 0; k < 8 && !serre; k++) serre = this.distanceLibre(p.x, p.y, p.z, Math.cos((k * Math.PI) / 4), 0, Math.sin((k * Math.PI) / 4), 2) < 1.9;
        if (serre) continue;
        let dx = tx - p.x, dz = tz - p.z;
        if (Math.hypot(dx, dz) < 4) { dx = 0; dz = 1; }
        const lacet = (Math.atan2(-dx, dz) * 180) / Math.PI;
        // vue degagee : moyenne de la distance libre sur 5 directions autour de la visee
        let somme = 0;
        for (const da of [-30, -15, 0, 15, 30]) {
          const y = ((lacet + da) * Math.PI) / 180;
          somme += this.distanceLibre(p.x, p.y, p.z, -Math.sin(y), -0.05, Math.cos(y), 24);
        }
        const score = somme - r * 0.3;
        if (!meilleur || score > meilleur.score) meilleur = { score, ...p, lacet };
      }
    }
    if (!meilleur) { // pas de terre ferme : on regarde l'eau d'un peu haut
      const eau = this.eauEn(cx, cz) ?? (Z.y0 + Z.sy / 2);
      return { x: cx + 0.5, y: eau + 8, z: cz + 0.5, lacet: 0, tangage: 18, fov: 70 };
    }
    return { x: meilleur.x, y: meilleur.y, z: meilleur.z, lacet: meilleur.lacet, tangage: 3, fov: 70 };
  }

  // Troncs (colonnes avec un bloc *_log / *_stem au-dessus du sol), regroupes : [x, z, yBas, yHaut]
  _troncs() {
    if (this._troncsCache) return this._troncsCache;
    const Z = this.zone, { etats } = this.maillage.interne;
    const estTronc = new Uint8Array(etats.length);
    etats.forEach((e, i) => { if (e && /(_log|_stem|_wood|mushroom_stem)$/.test(e.nom)) estTronc[i] = 1; });
    const col = new Map();
    for (let y = 0; y < Z.sy; y++) for (let z = 0; z < Z.sz; z++) for (let x = 0; x < Z.sx; x++) {
      const p = Z.cellules[(y * Z.sz + z) * Z.sx + x];
      if (!estTronc[p]) continue;
      const k = z * Z.sx + x;
      const c = col.get(k) || { x: Z.x0 + x, z: Z.z0 + z, min: 1e9, max: -1e9 };
      c.min = Math.min(c.min, Z.y0 + y); c.max = Math.max(c.max, Z.y0 + y); col.set(k, c);
    }
    // regroupement par voisinage (8 voisins)
    const vus = new Set(), res = [];
    for (const [k, c] of col) {
      if (vus.has(k)) continue;
      const pile = [c]; vus.add(k);
      let sx = 0, sz = 0, n = 0, mn = 1e9, mx = -1e9;
      while (pile.length) {
        const q = pile.pop(); sx += q.x; sz += q.z; n++; mn = Math.min(mn, q.min); mx = Math.max(mx, q.max);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const kk = (q.z - Z.z0 + dz) * Z.sx + (q.x - Z.x0 + dx);
          const o = col.get(kk);
          if (o && !vus.has(kk)) { vus.add(kk); pile.push(o); }
        }
      }
      res.push([Math.round(sx / n), Math.round(sz / n), mn, mx]);
    }
    this._troncsCache = res;
    return res;
  }

  // Resume du terrain pour un LLM (JSON court, moins de 1,8 Ko pour une zone de rayon 48).
  //   zone, sol {min,max,mediane} (Y du dessus du sol), grille grossiere (si elle tient), eau (lacs), nbArbres,
  //   chemins (3-4 corridors droits praticables pour l'acteur ET la camera de suivi), clairieres (1-2 endroits ouverts).
  resumeTerrain({ pas } = {}) {
    const Z = this.zone;
    pas = pas || Math.max(8, Math.ceil(Math.max(Z.sx, Z.sz) / 6));
    const xs = [], zs = [];
    for (let x = Z.x0 + Math.floor(pas / 2); x < Z.x0 + Z.sx; x += pas) xs.push(x);
    for (let z = Z.z0 + Math.floor(pas / 2); z < Z.z0 + Z.sz; z += pas) zs.push(z);
    const sol = zs.map((z) => xs.map((x) => { const s = this.solEn(x, z); return s === null ? null : s - 1; }));
    // statistiques du sol sur toute la zone (colonnes tous les 2 blocs)
    const hs = [];
    for (let z = Z.z0; z < Z.z0 + Z.sz; z += 2) for (let x = Z.x0; x < Z.x0 + Z.sx; x += 2) { const s = this.solEn(x, z); if (s !== null) hs.push(s - 1); }
    hs.sort((p, q) => p - q);
    const stat = hs.length ? { min: hs[0], max: hs[hs.length - 1], mediane: hs[hs.length >> 1] } : null;
    const troncs = this._troncs().filter((t) => t[3] - t[2] >= 2);
    const r = {
      zone: { x: [Z.x0, Z.x0 + Z.sx - 1], z: [Z.z0, Z.z0 + Z.sz - 1], biomes: Z.biomesNoms.map((b) => b.replace('minecraft:', '')) },
      sol: stat,
      eau: trouverEau(this, { max: 3 }),
      nbArbres: troncs.length,
      chemins: trouverChemins(this, { max: 4 }),
      clairieres: trouverClairieres(this, { max: 2 }),
      grille: { pas, x0: xs[0], z0: zs[0], note: 'sol[j][i] = Y du sol en (x0+i*pas, z0+j*pas), j vers le sud', sol: sol.map((row) => row.join(',')) },
    };
    // le texte doit rester court : sans la grille grossiere si elle fait depasser 1,8 Ko
    if (JSON.stringify(r).length > 1800) delete r.grille;
    return r;
  }

  // Verifie un segment (x1,z1) -> (x2,z2) pour un acteur et sa camera de suivi : { ok, longueur, denivele, degagement, obstacle? }.
  evaluerSegment(x1, z1, x2, z2) { return evaluerSegment(this, x1, z1, x2, z2); }
  // Meme chose, en une phrase (pour `mcanim terrain <zone> --chemin x1,z1,x2,z2`).
  verifierChemin(x1, z1, x2, z2) { return verifierChemin(this, x1, z1, x2, z2); }
}

const NON_COLLISION = /(grass|fern|dandelion|poppy|orchid|allium|bluet|tulip|daisy|cornflower|lily_of|lily_pad|rose|peony|lilac|sunflower|bush|mushroom|sapling|vine|torch|lichen|carpet|^snow$|leaf_litter|petals|wildflowers|rail|_sign|button|pressure_plate|tripwire|^string$|^fire$|seagrass|kelp|cobweb|dripleaf|roots|sprout|fungus|^wheat$|carrots|potatoes|beetroots|_stem|sugar_cane|dead_bush|berries|berry|firefly|bubble|^ladder$|^lever$|banner|^water$|^lava$|torchflower|eyeblossom|flower$|frogspawn|pitcher_crop|^light$|^barrier$)/;

// Reduit une image Uint32 ABGR de largeur wSrc par un facteur k (moyenne par canal)
function reduire(src, wSrc, dst, w, h, k) {
  const n = k * k;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < k; j++) {
        const o = (y * k + j) * wSrc + x * k;
        for (let i = 0; i < k; i++) { const p = src[o + i]; r += p & 255; g += (p >> 8) & 255; b += (p >> 16) & 255; }
      }
      dst[y * w + x] = (0xff000000 | (((b / n) | 0) << 16) | (((g / n) | 0) << 8) | ((r / n) | 0)) >>> 0;
    }
  }
}

// Meme chose pour la force d'exemption (un octet par pixel)
function reduireForce(src, wSrc, dst, w, h, k) {
  const n = k * k;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = 0; j < k; j++) { const o = (y * k + j) * wSrc + x * k; for (let i = 0; i < k; i++) s += src[o + i]; }
      dst[y * w + x] = (s / n) | 0;
    }
  }
}

function normaliser(v) { const n = Math.hypot(...v); return v.map((x) => x / n); }
