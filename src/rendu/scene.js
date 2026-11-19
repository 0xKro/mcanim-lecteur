// Scene : zone + maillage + rendu (workers) + aides pour l'IA (resume, sol, collisions).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { lireZone } from './zone.js';
import { BibliothequeTextures } from './textures.js';
import { BibliothequeModeles, analyserEtat } from './modeles.js';
import { CouleursBiomes, sourcesTeinte } from './teinte.js';
import { mailler, courbeLumiere } from './maillage.js';
import { trouverChemins, trouverClairieres, trouverEau, evaluerSegment, verifierChemin } from './chemins.js';
import { Rasteriseur, MODE_OPAQUE, MODE_DECOUPE, MODE_MELANGE } from './raster.js';
import { PostTraitement, imageActive, aFlou } from './post.js';
import { MoteurShader } from '../shader/moteur.js';
import { CielVanille, ticksDepuisHeure, construireCiel, cielEnd, eclairEnd, tableLumiere, etatAvecMeteo } from './ciel-vanille.js';
import { analyser, calculerBloom, calculerRayons, composer, creerTampons } from '../shader/post.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DIST_INTERNE = 32;   // distance horizontale (blocs) au-dela de laquelle les faces internes des feuilles ne sont plus dessinees
const BRUME_MIN = 32, BRUME_MARGE = 4;   // brouillard automatique : fin minimale, marge avant le bord de la zone (blocs)
export const SEUIL_PARESSEUX = 257 * 257;   // colonnes : au-dela (zones de rayon > 128), maillage paresseux
const GARDE_COLONNES = 64;   // maillage paresseux : une colonne maillee est oubliee au-dela de la portee de la vue + 64 blocs
const MODES = { opaque: MODE_OPAQUE, decoupe: MODE_DECOUPE, melange: MODE_MELANGE };

// Brume de pluie du jeu (AtmosphericFogEnvironment) : debut - 160 x m, fin = max(min(fin, 96), fin - 256 x m), m = rainFogMultiplier (0..1) ;
// les distances du jeu valent pour sa distance de vue par defaut (12 troncons : brume a 192 blocs) et sont ramenees a la portee de notre brume.
export function brumeDePluie(debut, fin, m) {
  const k = fin / 192;
  return [debut - 160 * k * m, Math.max(Math.min(fin, 96 * k), fin - 256 * k * m)];
}

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
  // grande zone (plus de 257 x 257 colonnes) : maillage paresseux, colonne par colonne, seulement a portee de la camera (assurerVue) ;
  // les commandes sans image (terrain, trajet, empreinte) ne maillent rien. Memes sections, meme image que le maillage complet.
  if (options.paresseux === undefined) options = { ...options, paresseux: z.sx * z.sz > SEUIL_PARESSEUX };
  // scene avec un champ `monde` (options.monde = { donnees, replay, lumiere }) : le maillage lit les tableaux d'un Monde modifiable, la lumiere de blocs
  // est calculee et les sections sont refaites quand le replay change des blocs. Le moteur n'est charge que dans ce cas.
  let monde = null, optionsM = options, curseur = 0, tickInitial = -1;
  if (options.monde) {
    const { Monde } = await import('../moteur/monde.js');
    const { Lumiere } = await import('../moteur/lumiere.js');
    monde = new Monde({ zone: z, donnees: options.monde.donnees, suivi: true });
    const rp = options.monde.replay;
    for (const p of rp?.palAjouts ?? []) monde.indicePalette(p);   // memes indices de palette que la simulation
    // tickInitial (essais) : les changements jusqu'a ce tick sont appliques AVANT le maillage de depart (maillage complet de l'etat final)
    if (rp && options.monde.tickInitial !== undefined) {
      const fin = rp.indiceApres(options.monde.tickInitial), b = rp.blocs;
      for (let k = 0; k < fin; k++) monde.ecrire(b[k * 6 + 1], b[k * 6 + 2], b[k * 6 + 3], b[k * 6 + 5]);
      curseur = fin; tickInitial = options.monde.tickInitial;
    }
    const lumiereBlocs = options.monde.lumiere !== false;
    monde.lumiere = new Lumiere(monde, { blocs: lumiereBlocs });
    monde.sales = [];
    optionsM = { ...options, monde, lightmap: lumiereBlocs };
  }
  const tex = new BibliothequeTextures(kit);
  const modeles = new BibliothequeModeles(kit, tex);
  if (options.monde?.perso?.blocs?.length) modeles.definirPerso(options.monde.perso.blocs, options.monde.perso.baseDir);   // blocs definis par les mods de la scene (rendu/modeles.js)
  if (options.monde) modeles.coffresDynamiques = true;   // scene avec monde : les coffres sont dessines par film/effets-monde.js (couvercle anime), pas par la boite de remplacement
  const couleurs = new CouleursBiomes(kit);
  const tLecture = performance.now();
  const maillage = mailler({ zone: z, modeles, textures: tex, couleurs, options: optionsM });
  const tMaillage = performance.now();
  const s = new Scene({ zone: z, modeles, textures: tex, maillage, travailleurs, options, monde, replay: options.monde?.replay ?? null, couleurs });
  s.curseurReplay = curseur; s.tickRejoue = tickInitial;
  s.cielV = new CielVanille(kit);   // ciel du jeu : textures du kit (soleil, lune, nuages) lues une fois
  s.temps = { lectureMs: tLecture - t0, maillageMs: tMaillage - tLecture, totalMs: performance.now() - t0 };
  await s.demarrer();
  s.temps.totalMs = performance.now() - t0;
  return s;
}

class Scene {
  constructor({ zone, modeles, textures, maillage, travailleurs, options, monde = null, replay = null, couleurs = null }) {
    this.monde = monde; this.replay = replay; this.couleurs = couleurs; this.curseurReplay = 0; this.tickRejoue = -1;
    this.pieces = new Map();   // sections refaites : cle `${section}|${couche}` -> { id, draw }
    this.prochainePiece = 1; this.statsMaj = { sections: 0, ms: 0, quads: 0, lots: 0, maxMs: 0 };
    this.zone = zone; this.modeles = modeles; this.textures = textures; this.maillage = maillage;
    this.options = options;
    this.paresseux = !!maillage.paresseux; this.colonnesM = new Map();   // maillage paresseux : cle de colonne -> { a, c, ids }
    this.nTrav = travailleurs ?? Math.max(1, Math.min(os.availableParallelism(), 4));
    // draws statiques
    this.draws = [];
    const atlas = maillage.atlas;
    const tex = { niveaux: atlas.niveaux.map((n) => ({ w: n.w, h: n.h, data: n.data })) };
    this.texAtlas = tex;
    for (const [nom, mode] of [['opaque', MODE_OPAQUE], ['decoupe', MODE_DECOUPE], ['interne', MODE_DECOUPE], ['melange', MODE_MELANGE]]) {
      const c = maillage.couches[nom];
      if (c.nbQuads === 0) continue;
      // interne : faces de feuilles cachees par d'autres feuilles, dessinees apres les faces exposees ; invisibles au-dela de distInterne
      this.draws.push({ positions: c.positions, uvs: c.uvs, couleurs: c.couleurs, indices: c.indices, sections: c.sections, ao: c.ao, etiq: c.etiq, niv: c.niv, tex, mode, deuxFaces: false, partage: false, ...(nom === 'interne' ? { interne: true, distMax: options.distInterne ?? DIST_INTERNE } : {}) });
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
      const w = new Worker(url, { workerData: { draws: this.draws, rangeeDe: i, nW: this.nTrav, texAtlas: this.texAtlas } });
      this.travailleursListe.push(w);
    }
  }

  async fermer() {
    for (const w of this.travailleursListe) await w.terminate();
    this.travailleursListe = [];
  }

  // ---- lumiere du jeu (scenes avec monde)
  tableLumiere(heure, gamma, facteurCiel = 1) {
    const g = gamma ?? this.options.gamma ?? 0.5, v = this.lumiereVue, dim = this.dimension ?? 'overworld';
    // lumiereVue (film/lumiere-vue.js) : vision nocturne et assombrissement des boss de celui qui regarde ; dimension : monde de l'End
    // End : l'eclair du ciel eclaire le monde (sky_light_factor += intensite, / 3 sous la brume du dragon)
    const fl = dim === 'end' ? eclairEnd((this.tempsMonde ?? 0) * 20).intensite / (v?.brumeDragon ? 3 : 1) : 0;
    // multBlocs : regle de scene monde.regles.lumiere.blocs (rendu seulement ; 1 = le jeu)
    const mb = this.options.monde?.multBlocs ?? 1;
    const cle = heure + '|' + g + (facteurCiel !== 1 ? '|' + facteurCiel : '') + (v ? `|${v.visionNuit}|${v.boss}` : '') + (dim !== 'overworld' ? `|${dim}|${fl}` : '') + (mb !== 1 ? '|b' + mb : '');
    if (this._lmCle !== cle) { this._lm = tableLumiere(ticksDepuisHeure(heure), g, { facteurCiel, nightVision: v?.visionNuit ?? 0, boss: v?.boss ?? 0, dimension: dim, eclairEnd: fl, blocs: mb }); this._lmCle = cle; }
    return this._lm;
  }

  // ---- sections refaites (scenes avec monde) ----
  // Tous les dessins statiques : le maillage de depart (dont certaines sections sont "mortes") + les pieces rapportees
  tousDraws() { return this.pieces.size ? this.draws.concat([...this.pieces.values()].map((p) => p.draw)) : this.draws; }

  _construireDraws(maillage) {
    const draws = [];
    const atlas = maillage.atlas, options = this.options;
    const tex = { niveaux: atlas.niveaux.map((n) => ({ w: n.w, h: n.h, data: n.data })) };
    this.texAtlas = tex;
    for (const [nom, mode] of [['opaque', MODE_OPAQUE], ['decoupe', MODE_DECOUPE], ['interne', MODE_DECOUPE], ['melange', MODE_MELANGE]]) {
      const c = maillage.couches[nom];
      if (c.nbQuads === 0) continue;
      draws.push({ positions: c.positions, uvs: c.uvs, couleurs: c.couleurs, indices: c.indices, sections: c.sections, ao: c.ao, etiq: c.etiq, niv: c.niv, tex, mode, deuxFaces: false, partage: false, ...(nom === 'interne' ? { interne: true, distMax: options.distInterne ?? DIST_INTERNE } : {}) });
    }
    return draws;
  }

  // Rejoue les changements du replay jusqu'au tick donne (les images vont dans l'ordre du temps), puis refait les sections touchees.
  async appliquerReplay(tick) {
    const r = this.replay, m = this.monde;
    if (!r || !m || tick <= this.tickRejoue) return 0;
    this.tickRejoue = tick;
    const fin = r.indiceApres(tick), b = r.blocs;
    if (this.curseurReplay >= fin) return 0;
    const cellules = [];
    for (; this.curseurReplay < fin; this.curseurReplay++) { const k = this.curseurReplay * 6; m.ecrire(b[k + 1], b[k + 2], b[k + 3], b[k + 5]); cellules.push([b[k + 1], b[k + 2], b[k + 3]]); }
    const n = await this.remailler();
    // ombres du soleil (shader) : seulement les sections que le soleil relie aux cellules changees
    if (this.moteur && this.moteur.cuireChangements && n >= 0) this.moteur.cuireChangements(cellules, new Set(this._derniersCles || []));
    return n;
  }

  // ---- maillage paresseux (grandes zones) : colonnes de sections (16 x 16, toute la hauteur) maillees quand la camera s'en approche
  _cleCol(a, c) { return (c + 4096) * 8192 + (a + 4096); }
  // Maille (ou remaille) la colonne (a, c) : ses pieces remplacent les anciennes. Rend le nombre de quads.
  _maillerColonne(a, c, maj) {
    const k = this._cleCol(a, c), ancien = this.colonnesM.get(k);
    if (ancien) this._oublierColonne(k, maj);
    const res = this.maillage.mailleColonne(a, c);
    const ids = [];
    let quads = 0;
    for (const nom of ['opaque', 'decoupe', 'melange', 'interne']) {
      const cc = res && res[nom];
      if (!cc) continue;
      const mode = nom === 'opaque' ? MODE_OPAQUE : nom === 'melange' ? MODE_MELANGE : MODE_DECOUPE;
      const draw = { positions: cc.positions, uvs: cc.uvs, couleurs: cc.couleurs, indices: cc.indices, sections: cc.sections, ao: cc.ao, etiq: cc.etiq, niv: cc.niv, tex: this.texAtlas, mode, deuxFaces: false, partage: false, ...(nom === 'interne' ? { interne: true, distMax: this.options.distInterne ?? DIST_INTERNE } : {}) };
      const id = this.prochainePiece++;
      if (this.moteur && this.moteur.cuirePiece) this.moteur.cuirePiece(draw);   // ombres cuites de la piece (shader)
      this.pieces.set('c' + k + '|' + nom, { id, draw });
      maj.ajouts.push({ id, draw: { ...draw, tex: undefined } });
      if (this.options.exportGPU) this._pendantGPU(id, nom, cc, k);
      ids.push(id); quads += cc.nbQuads;
    }
    this.colonnesM.set(k, { a, c, ids });
    return quads;
  }
  _oublierColonne(k, maj) {
    const col = this.colonnesM.get(k);
    if (!col) return;
    for (const nom of ['opaque', 'decoupe', 'melange', 'interne']) {
      const p = this.pieces.get('c' + k + '|' + nom);
      if (!p) continue;
      this.pieces.delete('c' + k + '|' + nom); maj.retraits.push(p.id);
      if (this.options.exportGPU) { const g = (this.majGPU ||= { mortes: new Set(), retraits: new Set(), ajouts: new Map() }); if (!g.ajouts.delete(p.id)) g.retraits.add(p.id); }
    }
    this.colonnesM.delete(k);
  }
  // Colonnes a moins de `rayon` blocs (distance horizontale, comme la brume) de la camera : maillees si besoin ; celles au-dela de `garde` : oubliees.
  // Rend le nombre de colonnes maillees. Sans effet hors du mode paresseux.
  assurerVue(cam, rayon, garde = rayon + GARDE_COLONNES) {
    if (!this.paresseux) return 0;
    const t0 = performance.now();
    const A = this.maillage.ancre, B = this.boite();
    const dist2 = (a, c) => {
      const xa = a * 16 + A[0], za = c * 16 + A[2];
      const ex = Math.max(xa - cam.x, 0, cam.x - (xa + 16)), ez = Math.max(za - cam.z, 0, cam.z - (za + 16));
      return ex * ex + ez * ez;
    };
    const maj = { mortes: [], retraits: [], ajouts: [] };
    for (const [k, col] of this.colonnesM) if (dist2(col.a, col.c) > garde * garde) this._oublierColonne(k, maj);
    const r = Math.max(0, rayon);
    const a0 = Math.floor((Math.max(B.x0, cam.x - r) - A[0]) / 16), a1 = Math.floor((Math.min(B.x0 + B.sx - 1, cam.x + r) - A[0]) / 16);
    const c0 = Math.floor((Math.max(B.z0, cam.z - r) - A[2]) / 16), c1 = Math.floor((Math.min(B.z0 + B.sz - 1, cam.z + r) - A[2]) / 16);
    let n = 0, quads = 0;
    for (let c = c0; c <= c1; c++) for (let a = a0; a <= a1; a++) {
      if (this.colonnesM.has(this._cleCol(a, c)) || dist2(a, c) > r * r) continue;
      quads += this._maillerColonne(a, c, maj); n++;
    }
    this._envoyerMaj(maj);
    const s = (this.statsParesseux ||= { colonnes: 0, quads: 0, ms: 0 });
    s.colonnes += n; s.quads += quads; s.ms += performance.now() - t0;
    return n;
  }

  // Refait les sections dont les cellules (blocs ou lumiere) ont change : une cellule salit sa section et celles a moins d'une cellule.
  async remailler() {
    const m = this.monde, mail = this.maillage, t0 = performance.now();
    if (m.sales === null) return this.rebatir();
    if (!m.sales.length) return 0;
    if (this.paresseux) return this._remaillerColonnes(t0);
    const A = m.ancre, PX = m.PX, PZ = m.PZ, cles = new Map();
    for (const i of m.sales) {
      const lx = i % PX - 1, t = (i - (lx + 1)) / PX, lz = t % PZ - 1, ly = (t - (lz + 1)) / PZ - 1;
      const x = m.x0 + lx, y = m.y0 + ly, z = m.z0 + lz;
      for (let a = Math.floor((x - 1 - A[0]) / 16); a <= Math.floor((x + 1 - A[0]) / 16); a++) {
        for (let b = Math.floor((y - 1 - A[1]) / 16); b <= Math.floor((y + 1 - A[1]) / 16); b++) {
          for (let c = Math.floor((z - 1 - A[2]) / 16); c <= Math.floor((z + 1 - A[2]) / 16); c++) cles.set(mail.cleAbs(a, b, c), [a, b, c]);
        }
      }
    }
    m.sales = [];
    const maj = { mortes: [], retraits: [], ajouts: [] };
    this._derniersCles = [...cles.keys()];
    let quads = 0;
    for (const [cle, [a, b, c]] of cles) {
      const res = mail.mailleSection(a, b, c);
      this._remplacerSection(cle, res, maj);
      if (res) for (const k of ['opaque', 'decoupe', 'melange', 'interne']) quads += res[k]?.nbQuads ?? 0;
    }
    this._envoyerMaj(maj);
    const ms = performance.now() - t0;
    const s = this.statsMaj;
    s.sections += cles.size; s.ms += ms; s.quads += quads; s.lots++; s.maxMs = Math.max(s.maxMs, ms);
    return cles.size;
  }

  // maillage paresseux : les colonnes deja maillees qui contiennent une section salie sont refaites entieres ; les autres le seront a la demande
  _remaillerColonnes(t0) {
    const m = this.monde, mail = this.maillage, A = m.ancre, PX = m.PX, PZ = m.PZ, cles = new Map(), cols = new Map();
    for (const i of m.sales) {
      const lx = i % PX - 1, t = (i - (lx + 1)) / PX, lz = t % PZ - 1, ly = (t - (lz + 1)) / PZ - 1;
      const x = m.x0 + lx, y = m.y0 + ly, z = m.z0 + lz;
      for (let a = Math.floor((x - 1 - A[0]) / 16); a <= Math.floor((x + 1 - A[0]) / 16); a++) {
        for (let c = Math.floor((z - 1 - A[2]) / 16); c <= Math.floor((z + 1 - A[2]) / 16); c++) {
          cols.set(this._cleCol(a, c), [a, c]);
          for (let b = Math.floor((y - 1 - A[1]) / 16); b <= Math.floor((y + 1 - A[1]) / 16); b++) cles.set(mail.cleAbs(a, b, c), [a, b, c]);
        }
      }
    }
    m.sales = [];
    this._derniersCles = [...cles.keys()];
    const maj = { mortes: [], retraits: [], ajouts: [] };
    let quads = 0, n = 0;
    for (const [k, [a, c]] of cols) if (this.colonnesM.has(k)) { quads += this._maillerColonne(a, c, maj); n++; }
    this._envoyerMaj(maj);
    const ms = performance.now() - t0, s = this.statsMaj;
    s.sections += cles.size; s.ms += ms; s.quads += quads; s.lots++; s.maxMs = Math.max(s.maxMs, ms);
    return cles.size;
  }

  _remplacerSection(cle, res, maj) {
    // le maillage de depart ne dessine plus cette section
    if (!this.mortes) this.mortes = new Set();
    if (this.options.exportGPU) (this.majGPU ||= { mortes: new Set(), retraits: new Set(), ajouts: new Map() }).mortes.add(cle);
    if (!this.mortes.has(cle)) {
      this.mortes.add(cle); maj.mortes.push(cle);
      for (const d of this.draws) { const n = d.sections.filter((s) => s.cle !== cle); if (n.length !== d.sections.length) d.sections = n; }
    }
    for (const nom of ['opaque', 'decoupe', 'melange', 'interne']) {
      const k = cle + '|' + nom, ancien = this.pieces.get(k);
      if (ancien) {
        maj.retraits.push(ancien.id); this.pieces.delete(k);
        if (this.options.exportGPU) { const p = (this.majGPU ||= { mortes: new Set(), retraits: new Set(), ajouts: new Map() }); if (!p.ajouts.delete(ancien.id)) p.retraits.add(ancien.id); }
      }
      const c = res && res[nom];
      if (!c) continue;
      const mode = nom === 'opaque' ? MODE_OPAQUE : nom === 'melange' ? MODE_MELANGE : MODE_DECOUPE;
      const draw = { positions: c.positions, uvs: c.uvs, couleurs: c.couleurs, indices: c.indices, sections: c.sections, ao: c.ao, etiq: c.etiq, niv: c.niv, tex: this.texAtlas, mode, deuxFaces: false, partage: false, ...(nom === 'interne' ? { interne: true, distMax: this.options.distInterne ?? DIST_INTERNE } : {}) };
      const id = this.prochainePiece++;
      if (this.moteur && this.moteur.cuirePiece) this.moteur.cuirePiece(draw);   // ombres cuites de la nouvelle piece (shader)
      this.pieces.set(k, { id, draw });
      maj.ajouts.push({ id, draw: { ...draw, tex: undefined } });
      if (this.options.exportGPU) this._pendantGPU(id, nom, c, cle);
    }
  }

  // Export GPU : ce qui a change depuis le dernier export (sections mortes, pieces retirees, pieces neuves) ; voir pack/export-gpu.js exporterMaj
  _pendantGPU(id, nom, c, cle) {
    const p = (this.majGPU ||= { mortes: new Set(), retraits: new Set(), ajouts: new Map() });
    p.ajouts.set(id, { id, nom, c, cle });
  }
  prendreMajGPU() {
    const p = this.majGPU;
    this.majGPU = null;
    if (!p) return { mortes: [], retraits: [], ajouts: [] };
    return { mortes: [...p.mortes], retraits: [...p.retraits], ajouts: [...p.ajouts.values()] };
  }

  _envoyerMaj(maj) {
    if (!maj.mortes.length && !maj.retraits.length && !maj.ajouts.length) return;
    for (const w of this.travailleursListe) w.postMessage({ type: 'maj', ...maj });
  }

  // Apres un agrandissement de la boite : tout est a refaire (rare)
  async rebatir() {
    const m = this.monde;
    this.maillage = mailler({ zone: this.zone, modeles: this.modeles, textures: this.textures, couleurs: this.couleurs, options: { ...this.options, monde: m, lightmap: this.maillage.lightmap } });
    m.sales = [];
    this.draws = this._construireDraws(this.maillage);
    this.pieces.clear(); this.mortes = new Set(); this.colonnesM.clear();   // paresseux : les colonnes seront remaillees a la demande
    await this.fermer();
    this.travailleursListe = [];
    if (this.nTrav > 0) await this.demarrer();
    this._preparerAcces();
    this.statsMaj.rebatis = (this.statsMaj.rebatis || 0) + 1;
    return -1;
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
    return { positions: pos, uvs, couleurs: col, indices: ind, sections: [{ debut: 0, nb: ind.length, bbox: [...mn, ...mx] }], texId: tex, mode, deuxFaces: !!m.deuxFaces, partage: true, masqueId, kM, kE, exempt: !!m.exempt, nuage: !!m.nuage, additif: !!m.additif, ajout: m.ajout ?? null };
  }

  // ---- shader (voir src/shader et docs/FORMAT-SHADER.md) : null ou un fichier lu par lireShader ; vide = rendu d'avant, au pixel pres
  definirShader(sh) {
    this.moteur = sh && !sh.actif.rien ? new MoteurShader(this, sh) : null;
    this.notesShader = sh ? sh.notes : [];
  }

  // donne aux workers les tableaux d'ombre cuits (partages : une seule fois, ils sont ensuite remplis sur place)
  envoyerOmbres() {
    const liste = this.draws.map((d) => d.ombre || null);
    const pieces = [...this.pieces.values()].filter((p) => p.draw.ombre).map((p) => [p.id, p.draw.ombre]);
    for (const w of this.travailleursListe) w.postMessage({ type: 'ombres', liste, pieces });
  }

  _tampons(W, H, F) {
    const t = this._tp;
    if (t && t.W === W && t.H === H && t.F === F) return t;
    return (this._tp = creerTampons(W, H, F));
  }

  ajouterMaillage(m) { const id = this.prochainMaillage++; this.persistants.set(id, m); return id; }
  retirerMaillage(id) { this.persistants.delete(id); }

  // ---- brouillard automatique ----
  // fin : distance horizontale a laquelle la brume est totale = distance de la camera au bord de zone le plus proche moins une marge,
  // jamais moins de BRUME_MIN (zone trop petite ou camera au bord : le bord peut alors se voir). debut : 60 % de fin, repousse
  // (jusqu'a 85 % de fin) pour ne pas avaler les maillages dynamiques (l'acteur suivi) : debut >= plus grande distance horizontale + 3.
  brumeAuto(cam, dyn) {
    const z = this.zone;
    const bord = Math.min(cam.x - z.x0, z.x0 + z.sx - cam.x, cam.z - z.z0, z.z0 + z.sz - cam.z);
    const fin = Math.max(BRUME_MIN, bord - BRUME_MARGE);
    let debut = fin * 0.6;
    let proche = 0;
    for (const d of dyn) {
      if (d.nuage) continue;
      const bb = d.sections[0].bbox;
      const dx = Math.max(Math.abs(bb[0] - cam.x), Math.abs(bb[3] - cam.x)), dz = Math.max(Math.abs(bb[2] - cam.z), Math.abs(bb[5] - cam.z));
      proche = Math.max(proche, Math.hypot(dx, dz));
    }
    if (proche + 3 > debut) debut = Math.min(proche + 3, fin * 0.85);
    return { debut, fin, bord, proche };
  }

  // ---- rendu ----
  async rendre({ camera, largeur = 1920, hauteur = 1080, temps = 0, maillagesDynamiques = [], brume, ciel, soleil, loin, mip = true, ssaa = 1, copie = true, lumiere, image, heure, jour, cielFixe, gamma, profondeur = false, meteo = null } = {}) {
    const tDebut = performance.now();
    const sortieW = largeur, sortieH = hauteur;
    largeur *= ssaa; hauteur *= ssaa;
    const cam = { x: camera.x, y: camera.y, z: camera.z, lacet: camera.lacet ?? 0, tangage: camera.tangage ?? 0, fov: camera.fov ?? 70 };
    if (!this.pixels || this.W !== largeur || this.H !== hauteur) {
      this.pixels = new Uint32Array(new SharedArrayBuffer(largeur * hauteur * 4)); this.W = largeur; this.H = hauteur;
      this.force = null;
    }
    // profondeur (facultatif, montage : profondeur de champ) : 1/w par pixel (0 = ciel), copie partagee des rangees de chaque worker ; rien sans `profondeur`
    let profBuf = null;
    if (profondeur) { if (!this._prof || this._prof.length !== largeur * hauteur) this._prof = new Float32Array(new SharedArrayBuffer(largeur * hauteur * 4)); profBuf = this._prof; }
    this.profondeurDerniere = profondeur ? { donnees: profBuf, W: largeur, H: hauteur, ssaa } : null;
    this.textures.mettreAJour(temps);
    this.tempsMonde = temps;   // secondes du monde : eclairs du ciel de l'End (table de lumiere)
    this._nouvelles = []; this._masquesNouveaux = [];
    const meshes = [...this.persistants.values(), ...maillagesDynamiques];
    let dyn = meshes.map((m) => this._preparer(m));
    const b = this.brumeAuto(cam, dyn);
    // ciel du jeu (toujours, sauf couleur de ciel imposee par l'appelant : `ciel` explicite ou couleurCiel de la scene)
    const sousEau = this.estDansEau(cam.x, cam.y, cam.z);
    const vanilleOn = !ciel && !cielFixe && !!this.cielV && !sousEau;
    let etV = null;
    if (vanilleOn) {
      const base = this.cielV.couleursCamera(this.zone, cam.x, cam.z);
      etV = this.cielV.etat(ticksDepuisHeure(heure ?? 12), jour ?? 0, base);
      if (meteo) etV = etatAvecMeteo(etV, meteo);   // pluie, orage, eclair : ciel terne (rien sans `ciel.meteo`)
    }
    // shader : lumiere, brume, ombres, eau, balancement, modifications du ciel, passes d'image (rien du tout sans fichier de shader)
    let cielV = null, nuage = null;
    if (vanilleOn) {
      cielV = this.dimension === 'end' ? cielEnd(this.cielV, temps * 20) : construireCiel(this.cielV, etV, cam, this.moteur ? this.moteur.modsCiel(heure) : null, temps * 20);
      nuage = cielV.nuage;
      ciel = cielV.couleurs;
      if (meteo && meteo.pluie > 0) for (const a of cielV.vanille.astres) a.alpha = Math.max(0, 1 - meteo.pluie);   // SkyRenderer : le soleil et la lune sont dessines avec l'alpha 1 - pluie (les etoiles x (1 - pluie) : etatAvecMeteo)
    }
    let res = null;
    if (this.moteur) {
      res = this.moteur.preparer({ heure, temps, cam, W: largeur, H: hauteur, ssaa, lumiere, brume, auto: b, meshes, ciel: ciel || { zenith: [120, 167, 255], horizon: [192, 216, 255], bas: [170, 195, 235] } });
      lumiere = res.lumiere; brume = res.brume;
      if (res.meshes !== meshes) dyn = res.meshes.map((m) => this._preparer(m));
    }
    if (nuage) dyn.push(this._preparer(nuage));
    const postSh = res ? res.post : null;
    // couleur selective : le tampon de force n'existe (et ne coute) que si l'image est etalonnee ET qu'un maillage est exempte
    const postActif = imageActive(image);
    const veutForce = (postActif || (postSh && res.veutForce)) && dyn.some((d) => d.masqueId || d.exempt);
    if (veutForce && !this.force) this.force = new Uint8Array(new SharedArrayBuffer(largeur * hauteur));
    const force = veutForce ? this.force : null;
    // le post-traitement se fait par les workers (chacun ses bandes) quand il n'y a ni flou ni surechantillonnage ; sinon thread principal
    const postParWorkers = postActif && ssaa === 1 && !aFlou(image) && !this.local && this.travailleursListe.length > 0;
    const params = {
      proche: 0.05, mip,
      brumeDebut: brume?.debut ?? b.debut, brumeFin: brume?.fin ?? b.fin,
      cielZenith: ciel?.zenith ?? [120, 167, 255], cielHorizon: ciel?.horizon ?? [192, 216, 255], cielBas: ciel?.bas ?? [170, 195, 235],
      soleil: soleil === false ? null : (soleil ?? normaliser([0.35, 0.8, -0.45])),
    };
    // couleur de la brume : par defaut (ou si elle est egale a l'horizon du ciel) la brume prend, rangee par rangee, la couleur du ciel
    // derriere elle ; la brume epaisse est donc invisible sur le ciel. Une couleur differente est utilisee telle quelle.
    if (cielV) params.vanille = cielV.vanille;
    const cb = brume?.couleur, h = params.cielHorizon;
    params.brumeCiel = !cb || (Math.abs(cb[0] - h[0]) < 1 && Math.abs(cb[1] - h[1]) < 1 && Math.abs(cb[2] - h[2]) < 1);
    params.brume = params.brumeCiel ? h : cb;
    // brume de pluie (AtmosphericFogEnvironment : debut - 160 x m, fin max(min(fin, 96), fin - 256 x m), m = rainFogMultiplier calcule par
    // l'appelant : film/video.js) ; rien sans pluie
    if (meteo && meteo.brumePluie > 0 && !sousEau && !brume) {
      // les distances du jeu (160, 96, 256 blocs) valent pour sa distance de vue par defaut (12 troncons : brume jusqu'a 192 blocs) ; notre brume
      // finit a la portee de la zone : memes proportions (k = fin / 192)
      [params.brumeDebut, params.brumeFin] = brumeDePluie(params.brumeDebut, params.brumeFin, meteo.brumePluie);
    }
    if (params.brumeFin <= params.brumeDebut) params.brumeFin = params.brumeDebut + 8;
    params.loin = loin ?? params.brumeFin + 1;
    if (nuage) { params.nuageDebut = 220; params.nuageFin = 576; }   // les nuages ont leur propre brume (loin de la zone) : ils ne suivent pas le bord de zone
    if (lumiere && (lumiere[0] !== 1 || lumiere[1] !== 1 || lumiere[2] !== 1)) params.lumiere = lumiere.map((v) => Math.max(0, v));
    // lumiere du jeu (scenes avec monde) : table (ciel, bloc) -> couleur, de l'heure du jeu ; elle remplace le facteur global jour/nuit
    if (this.maillage.lightmap) params.lm = this.tableLumiere(heure ?? 12, gamma, meteo ? meteo.facteurCiel ?? 1 : 1);
    // camera sous l'eau : brouillard bleu court, comme dans le jeu
    if (res) Object.assign(params, res.params);
    if (sousEau) {
      let c = [24, 56, 150], fin = 28;
      const se = this.moteur ? this.moteur.sousEau(heure) : null;
      if (se) { if (se.couleur) c = se.couleur; if (se.distance) fin = se.distance; if (se.lum !== 1) params.lumiere = (params.lumiere || [1, 1, 1]).map((x) => x * se.lum); }
      params.vanille = null; params.eau = null; params.fogLut = null; params.fogH = null; params.ven = null;
      params.brumeDebut = 0; params.brumeFin = fin; params.loin = loin ?? fin + 1; params.brumeCiel = true; params.brume = c; params.cielZenith = c; params.cielHorizon = c; params.cielBas = c; params.soleil = null;
    }
    // maillage paresseux : les colonnes a portee de la vue (au-dela de `loin` rien n'est dessine) ; garde : la portee hors de l'eau (pas d'oubli en plongee)
    if (this.paresseux) this.assurerVue(cam, params.loin, Math.max(params.loin, b.fin + 1) + GARDE_COLONNES);
    const id = ++this.idImage;
    const tp = postSh ? this._tampons(largeur, hauteur, postSh.F) : null;
    const sw = this.local || !this.travailleursListe.length;
    if (sw) {
      const r = this.local || (this.local = new Rasteriseur());
      const textures = new Map(this._nouvelles.map((t) => [t.id, { niveaux: [{ w: t.w, h: t.h, data: t.data }] }]));
      this._texLocales = new Map([...(this._texLocales || []), ...textures]);
      for (const k of this._masquesNouveaux) this._masquesLocaux.set(k.id, k.data);
      const draws = this.tousDraws().concat(dyn.map((d) => ({ ...d, tex: this._texLocales.get(d.texId), masque: d.masqueId ? this._masquesLocaux.get(d.masqueId) : null })));
      this.dernieresStats = r.rendre({ pixels: this.pixels, W: largeur, H: hauteur, cam, draws, rangeeDe: 0, nW: 1, params, force });
      if (profBuf) profBuf.set(r.zbuf);
      if (postSh) analyser(this.pixels, r.zbuf, largeur, hauteur, tp, postSh, 0, 1);
    } else {
      const promesses = this.travailleursListe.map((w, i) => new Promise((ok, ko) => {
        const cle = id * 100 + i;
        const h = (m) => { if (m.type === 'fini' && m.id === cle) { w.off('message', h); w.off('error', ko); ok(m); } };
        w.on('message', h);
        w.once('error', ko);
        // les masques sont envoyes a tous les workers la premiere fois (liste cumulee tant que l'image n'a pas ete rendue)
        w.postMessage({ type: 'image', id: cle, pixels: this.pixels, W: largeur, H: hauteur, cam, dynamiques: dyn, texturesNouvelles: this._nouvelles, masquesNouveaux: this._masquesNouveaux, params, force, post: postParWorkers && !postSh ? image : null, ana: postSh ? { tp, par: postSh } : null, prof: profBuf });
      }));
      const fin = await Promise.all(promesses);
      this.dernieresStats = { workers: fin.map((r) => r.stats) };
    }
    // passes d'image du shader : flou de la lueur et des rayons (petite image, thread principal), puis composition par bandes
    let composeFait = false;
    const tPost0 = performance.now();
    this.msRendu = tPost0 - tDebut;
    if (postSh) {
      // rayons (workers, par rangees) en meme temps que le flou de la lueur (thread principal)
      let attente = null;
      if (postSh.rayons && !sw) {
        const cle0 = id * 100 + 20;
        attente = Promise.all(this.travailleursListe.map((w, i) => new Promise((ok, ko) => {
          const h = (m) => { if (m.type === 'fini' && m.id === cle0 + i) { w.off('message', h); w.off('error', ko); ok(); } };
          w.on('message', h); w.once('error', ko);
          w.postMessage({ type: 'rayons', id: cle0 + i, tp, par: postSh });
        })));
      }
      calculerBloom(tp, postSh);
      if (attente) await attente; else calculerRayons(tp, postSh, 0, 1);
      this.msFlous = performance.now() - tPost0;
      if (ssaa === 1 && !sw) {
        const cle = id * 100 + 50;
        await Promise.all(this.travailleursListe.map((w, i) => new Promise((ok, ko) => {
          const h = (m) => { if (m.type === 'fini' && m.id === cle + i) { w.off('message', h); w.off('error', ko); ok(); } };
          w.on('message', h); w.once('error', ko);
          w.postMessage({ type: 'composer', id: cle + i, pixels: this.pixels, W: largeur, H: hauteur, tp, par: postSh, force, post: postParWorkers ? image : null });
        })));
        composeFait = true;
      } else if (ssaa === 1) { composer(this.pixels, largeur, hauteur, tp, postSh, force, 0, 1); composeFait = true; }
      this.msPasses = performance.now() - tPost0;
    }
    if (ssaa > 1) { // reduction : moyenne des ssaa x ssaa pixels (la force d'exemption aussi)
      if (!this.sortie || this.sortie.length !== sortieW * sortieH) { this.sortie = new Uint32Array(sortieW * sortieH); this.forceRed = null; }
      reduire(this.pixels, largeur, this.sortie, sortieW, sortieH, ssaa);
      let fr = null;
      if (force) { if (!this.forceRed) this.forceRed = new Uint8Array(sortieW * sortieH); reduireForce(force, largeur, this.forceRed, sortieW, sortieH, ssaa); fr = this.forceRed; }
      if (postSh) composer(this.sortie, sortieW, sortieH, tp, postSh, fr, 0, 1);
      if (postActif) this.post.appliquer(this.sortie, sortieW, sortieH, image, fr);
      const o = new Uint8Array(this.sortie.buffer, 0, sortieW * sortieH * 4);
      return copie ? Uint8Array.from(o) : o;
    }
    void composeFait;
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
    const B = this.boite();
    const lx = x - B.x0, ly = y - B.y0, lz = z - B.z0;
    if (lx < -1 || ly < -1 || lz < -1 || lx > B.sx || ly > B.sy || lz > B.sz) return 0;
    return pal[((ly + 1) * PZ + (lz + 1)) * PX + (lx + 1)];
  }

  // Y (haut du bloc) ou l'on peut marcher en (x,z) : le plus haut bloc a collision, SANS compter les
  // feuilles (on marche "sous" les arbres), l'eau, ni les plantes. null si hors zone ou colonne vide.
  solEn(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (!this.zone.dansZone(x, z)) return null;
    const B = this.boite();
    for (let y = B.y0 + B.sy - 1; y >= B.y0; y--) {
      const p = this._pal(x, y, z);
      if (this.collision[p] && !this.feuillesP[p]) return p === 1 ? null : y + 1;
    }
    return null;
  }

  // Niveau de lumiere du ciel (0..15) de la cellule qui contient le point (15 = plein ciel, sous un arbre : 10 a 13).
  niveauLumiere(x, y, z) {
    const { lum, PX, PY, PZ } = this.maillage.interne;
    const B = this.boite();
    const lx = Math.floor(x) - B.x0, ly = Math.floor(y) - B.y0, lz = Math.floor(z) - B.z0;
    if (lx < -1 || ly < -1 || lz < -1 || lx > B.sx || ly > B.sy || lz > B.sz) return 15;
    return lum[((ly + 1) * PZ + (lz + 1)) * PX + (lx + 1)];
  }

  // Luminosite 0..1 (apres la courbe du jeu) a multiplier dans les couleurs des maillages dynamiques.
  // Avec un monde (lightmap) : luminance de la table de lumiere du jeu aux niveaux (ciel, bloc) du point, a l'heure du dernier rendu ; sinon courbe du ciel seule.
  // Couleur du bloc pour l'indice de teinte 0 (BlockColors.getColor) a la colonne (x, z) : herbe, feuillage, eau du biome (melangees comme
  // le maillage) ou couleur fixe ; null pour un bloc sans teinte. Sert aux particules de casse (TerrainParticle : 0,6 x cette couleur).
  teinteBloc(chaine, x, z) {
    const { nom, props } = analyserEtat(chaine);
    const s = sourcesTeinte(nom, props);
    if (!s || s[0] === null || s[0] === undefined) return null;
    let v = s[0];
    if (typeof v === 'string') {
      if (!this.couleurs) return null;
      this._tabTeintes ??= this.couleurs.tableaux(this.zone, 2);
      const Z = this.zone, i = Math.min(Z.sz - 1, Math.max(0, Math.floor(z) - Z.z0)) * Z.sx + Math.min(Z.sx - 1, Math.max(0, Math.floor(x) - Z.x0));
      v = this._tabTeintes[v]?.[i];
      if (v === undefined) return null;
    }
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }  // Niveaux de lumiere du ciel et des blocs (0..15) de la cellule du point, ou null sans table de lumiere (scene sans monde)
  niveauxEn(x, y, z) {
    if (!this.maillage.lightmap || !this._lm) return null;
    const { lum, blk, PX, PZ } = this.maillage.interne, B = this.boite();
    const lx = Math.floor(x) - B.x0, ly = Math.floor(y) - B.y0, lz = Math.floor(z) - B.z0;
    if (lx < -1 || ly < -1 || lz < -1 || lx > B.sx || ly > B.sy || lz > B.sz) return null;
    const i = ((ly + 1) * PZ + (lz + 1)) * PX + (lx + 1);
    return { ciel: lum[i], bloc: blk[i] };
  }
  // Luminance de la table de lumiere du jeu pour des niveaux donnes (niveaux fractionnaires : interpoles comme LightTexture) ; particules
  // emissives (flammes, portail) : film/ambiance-blocs.js
  luminositeNiveaux(ciel, bloc) {
    if (!this._lm) return null;
    const c = Math.max(0, Math.min(15, ciel)), b = Math.max(0, Math.min(15, bloc));
    const c0 = Math.floor(c), b0 = Math.floor(b), c1 = Math.min(15, c0 + 1), b1 = Math.min(15, b0 + 1), fc = c - c0, fb = b - b0;
    const L = (s, k) => 0.299 * this._lm.R[s * 16 + k] + 0.587 * this._lm.G[s * 16 + k] + 0.114 * this._lm.B[s * 16 + k];
    const v = (L(c0, b0) * (1 - fb) + L(c0, b1) * fb) * (1 - fc) + (L(c1, b0) * (1 - fb) + L(c1, b1) * fb) * fc;
    return Math.min(1, v);
  }
  luminositeEn(x, y, z) {
    if (this.maillage.lightmap && this._lm) {
      const { lum, blk, PX, PZ } = this.maillage.interne, B = this.boite();
      const lx = Math.floor(x) - B.x0, ly = Math.floor(y) - B.y0, lz = Math.floor(z) - B.z0;
      if (lx >= -1 && ly >= -1 && lz >= -1 && lx <= B.sx && ly <= B.sy && lz <= B.sz) {
        const i = ((ly + 1) * PZ + (lz + 1)) * PX + (lx + 1), k = lum[i] * 16 + blk[i];
        return Math.min(1, 0.299 * this._lm.R[k] + 0.587 * this._lm.G[k] + 0.114 * this._lm.B[k]);
      }
    }
    return courbeLumiere(this.niveauLumiere(x, y, z), this.options.gamma ?? 0.5);
  }
  // Niveau de lumiere de bloc (0..15) de la cellule du point (0 sans monde)
  niveauBloc(x, y, z) {
    const { blk, PX, PZ } = this.maillage.interne;
    if (!blk) return 0;
    const B = this.boite();
    const lx = Math.floor(x) - B.x0, ly = Math.floor(y) - B.y0, lz = Math.floor(z) - B.z0;
    if (lx < -1 || ly < -1 || lz < -1 || lx > B.sx || ly > B.sy || lz > B.sz) return 0;
    return blk[((ly + 1) * PZ + (lz + 1)) * PX + (lx + 1)];
  }
  // Boite des blocs (celle de la zone ; celle du monde, qui peut avoir grandi, quand il y en a un)
  boite() { return this.monde || this.zone; }

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
