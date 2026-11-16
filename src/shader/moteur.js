// Moteur du shader : prepare, a chaque image, tout ce que le rasteriseur et les passes d'image doivent savoir.
// Le rasteriseur ne recoit que des nombres (tables, parametres) ; ici on traduit les options de shader.json en ces nombres.
// Tout ce qui est desactive dans le fichier est ABSENT des parametres (null) : cout nul et rendu identique a celui sans shader.
import { evaluerShader } from './format.js';
import { etatCiel, modsCiel } from './ciel.js';
import { construireGrille, cuire, cuireDraw, ombreSommets, ombreProjetee } from './ombres.js';
import { preparerPasses } from './post.js';
import { cielDepuisHeure } from '../film/look.js';
import { Rasteriseur } from '../rendu/raster.js';

const borne = (x, a, b) => (x < a ? a : x > b ? b : x);
const PLAFOND_CUISSON_MS = 90000;   // total de cuisson des ombres sur tout le film : au-dela on garde la derniere
const L_REF_EAU = 100;              // luminosite moyenne de l'eau vanilla eclairee (sert a garder l'ombrage en changeant sa couleur)

export class MoteurShader {
  constructor(rs, shader) {
    this.rs = rs; this.sh = shader; this.actif = shader.actif;
    this.grille = null; this.cleBake = null; this.dirBake = null; this.cuissonMs = 0; this.cuissons = 0; this.envoyees = false; this.notes = [];
    this.stats = { cuissonMs: 0, cuissons: 0, echantillons: 0 };
  }

  get rien() { return this.actif.rien; }

  // valeurs a l'heure (mises en cache pour l'image)
  _valeurs(heure) {
    const h = heure ?? 12;
    if (!this._c || this._c.h !== h) this._c = { h, r: evaluerShader(this.sh, h) };
    return this._c.r;
  }

  // modifications du ciel du jeu demandees par le fichier (ou null)
  modsCiel(heure) { return this.actif.ciel ? modsCiel(this._valeurs(heure)) : null; }

  // Direction de la lumiere directe a l'heure h (soleil le jour, lune la nuit), ou null.
  _dirHeure(h, incl) {
    const s = cielDepuisHeure(h, { inclinaison: incl }).soleilDir;
    if (s[1] > 0.0) return s;
    const l = s.map((x) => -x);
    return l[1] > 0 ? l : null;
  }

  // args : { heure, fixe, temps, cam, W, H, ssaa, ciel:{zenith,horizon,bas}, lumiere:[r,g,b]|undefined, brume:{debut,fin,couleur}|undefined, auto:{debut,fin,proche}, meshes:[...] }
  // retourne { params, ciel, lumiere, brume:{debut,fin,couleur}, meshes, post, veutForce }
  preparer(a) {
    const { actif, sh } = this;
    const r = this._valeurs(a.heure);
    const et = etatCiel(r, actif, a.heure);
    const params = {};
    const out = { params, ciel: a.ciel, lumiere: a.lumiere, brume: a.brume, meshes: a.meshes, post: null, veutForce: false, r };
    // ---- lumiere du monde et ombres
    const mult = et.mult;
    const lut = (couleurs, int, tint) => {   // tables 256 : multiplicateur selon l'octet d'ombre
      const R = new Float32Array(256), G = new Float32Array(256), B = new Float32Array(256);
      for (let s = 0; s < 256; s++) {
        const L = s / 255, k = 1 - int * (1 - L);
        for (let c = 0; c < 3; c++) {
          const direct = couleurs.sun[c] * k;
          const m = ((1 - et.part) * couleurs.amb[c] + et.part * direct) * (1 + (tint[c] - 1) * (1 - L));
          (c === 0 ? R : c === 1 ? G : B)[s] = m;
        }
      }
      return { R, G, B };
    };
    let sv = null;
    if (actif.ombres) {
      sv = lut({ sun: et.sunC, amb: et.ambC }, r['ombres.intensite'], r['ombres.couleur']);
      this._cuire(r, et, a);
    } else if (actif.lumiere) {
      const f = out.lumiere || [1, 1, 1];
      out.lumiere = [f[0] * mult[0], f[1] * mult[1], f[2] * mult[2]];
    }
    if (actif.occlusion || et.minimum > 0) {
      sv = sv || { R: null, G: null, B: null };
      const s = r['occlusion.force'];
      if (s !== 1) { sv.aoLut = new Float32Array(256); for (let i = 0; i < 256; i++) sv.aoLut[i] = i === 0 ? 1 : Math.min(4, Math.pow(i / 255, s - 1)); }
      sv.min = et.minimum * 255;
    }
    if (sv) { sv.min = sv.min || 0; params.sv = sv; }
    // ---- acteurs : ombre recue et ombre portee
    if (actif.ombres && this.grille && this.dirBake) {
      const neutre = r['acteurs.lumiereMonde'] === false;
      const lutA = lut(neutre ? { sun: [1, 1, 1], amb: [1, 1, 1] } : { sun: et.sunC, amb: et.ambC }, r['ombres.intensite'], r['ombres.couleur']);
      const ms = [], extra = [];
      for (const m of a.meshes) {
        if (m.ombre) { ms.push(m); continue; }
        const T = ombreSommets(this.grille, m.positions, this.dirBake), nv = T.length;
        const col = new Float32Array(nv * 3);
        for (let i = 0; i < nv; i++) {
          const s = (T[i] * 255 + 0.5) | 0;
          col[i * 3] = m.couleurs[i * 3] * lutA.R[s]; col[i * 3 + 1] = m.couleurs[i * 3 + 1] * lutA.G[s]; col[i * 3 + 2] = m.couleurs[i * 3 + 2] * lutA.B[s];
        }
        ms.push({ ...m, couleurs: col });
        if (r['ombres.acteurs']) { const d = ombreProjetee(this.rs, this.grille, m, this.dirBake, r['ombres.acteursOpacite']); if (d) extra.push(d); }
      }
      out.meshes = ms.concat(extra);
    }
    // ---- brume
    out.brume = this._brume(r, a, params, out);
    // ---- balancement et eau
    const D = r['vegetation.distance'] * (r.qualite === 'basse' ? 0.6 : 1), eh = r['eau.vagues.hauteur'];
    const fa = r['vegetation.feuilles.amplitude'], ha = r['vegetation.herbe.amplitude'];
    if (fa > 0 || ha > 0 || eh > 0) {
      const ang = (r['vegetation.vent.direction'] * Math.PI) / 180;
      const De = eh > 0 ? Math.max(D, 2 * D) : D;
      params.ven = { t: a.temps, wx: Math.cos(ang), wz: Math.sin(ang), raf: r['vegetation.vent.rafales'], k: 1 / r['vegetation.echelle'],
        fa, fs: r['vegetation.feuilles.vitesse'], ha, hs: r['vegetation.herbe.vitesse'], D, D2: D * D, D2n: 0.49 * D * D,
        eh, ev: r['eau.vagues.vitesse'], ke: 1 / r['eau.vagues.echelle'], De, D2e: De * De, D2en: 0.49 * De * De };
    }
    if (actif.eauSurface) params.eau = this._eau(r, a, out);
    // ---- passes d'image
    if (actif.post) {
      const base = Rasteriseur.prototype.base(a.cam);
      const f = (a.H / 2) / Math.tan((a.cam.fov * Math.PI) / 360);
      const F = this.facteur(r, a.ssaa);
      const par = preparerPasses(r, actif, { sol: r['rayons.couleur'] ? null : [1, 0.95, 0.8], sunDir: et.soleilDir[1] > -0.1 ? et.soleilDir : null, cam: { ...base, f }, W: a.W, H: a.H, F, ssaa: a.ssaa, qualite: r.qualite });
      out.post = par;
      out.veutForce = par.respecter;
    }
    return out;
  }

  // facteur de reduction des tampons des effets flous (puissance de 2 qui divise 16)
  facteur(r, ssaa) {
    let e = r['performance.echellePost'];
    if (r.qualite === 'basse') e /= 2; else if (r.qualite === 'haute') e *= 2;
    e = borne(e, 0.125, 1);
    return Math.min(16, Math.max(1, Math.round(1 / e)) * ssaa);
  }

  _cuire(r, et, a) {
    const pas = r['ombres.pasHeure'];
    if (!et.lumDir) { if (!this.grille) this._grille(r); return; }
    const jour = et.lumDir === et.soleilDir ? 0 : 1;
    const cle = pas > 0 ? `${jour}:${Math.round(et.heure / pas)}` : 'fixe';
    if (cle === this.cleBake) return;
    if (this.cleBake !== null && this.cuissonMs > PLAFOND_CUISSON_MS) {
      if (!this.notes.length) this.notes.push('ombres : le calcul a depasse le temps prevu, les dernieres ombres sont gardees (augmenter ombres.pasHeure)');
      return;
    }
    if (!this.grille) this._grille(r);
    const dir = pas > 0 ? (this._dirHeure(Math.round(et.heure / pas) * pas, r['ciel.inclinaisonTrajet']) ?? et.lumDir) : et.lumDir;
    this.optsCuisson = { distance: r['ombres.distance'], cuisson: r.qualite === 'basse' ? 0 : r.qualite === 'haute' ? Math.max(2, r['performance.cuisson']) : r['performance.cuisson'] };
    const res = cuire(this.rs, this.grille, dir, this.optsCuisson);
    this.cuissonMs += res.ms; this.cuissons++; this.stats = { cuissonMs: this.cuissonMs, cuissons: this.cuissons, echantillons: res.echantillons, derniereMs: res.ms };
    this.cleBake = cle; this.dirBake = dir;
    this._envoyer();
  }

  // Scenes avec un monde (blocs poses ou retires) : l'ombre d'une piece neuve est cuite tout de suite (comme celles des autres) ...
  cuirePiece(draw) {
    if (!this.grille || !this.dirBake || !this.optsCuisson) return;
    cuireDraw(this.rs, this.grille, this.dirBake, draw, this.optsCuisson);
  }

  // ... et les sections dont le soleil passe par une cellule changee sont recuites (les colonnes en dessous du changement dans le sens du soleil,
  // pas toute la zone). `cles` : ensemble de numeros de section deja refaites (leur piece est deja cuite). Rend le nombre de sections recuites.
  cuireChangements(cellules, dejaFaites = new Set()) {
    if (!this.grille || !this.dirBake || !this.optsCuisson || !cellules.length) return 0;
    const [lx, ly, lz] = this.dirBake, A = this.rs.monde.ancre, g = this.grille;
    const cles = new Set();
    const cle = (a, b, c) => this.rs.maillage.cleAbs(a, b, c);
    for (const [x, y, z] of cellules) {
      // le point de depart est la cellule ; on descend dans le sens oppose au soleil (l'ombre tombe de ce cote), 6 blocs par pas
      for (let s = 0; s <= 96; s += 6) {
        const px = x - lx * s, py = y - ly * s, pz = z - lz * s;
        if (py < g.y0 - 2) break;
        for (let a = Math.floor((px - 2 - A[0]) / 16); a <= Math.floor((px + 2 - A[0]) / 16); a++) for (let b = Math.floor((py - 2 - A[1]) / 16); b <= Math.floor((py + 2 - A[1]) / 16); b++) for (let c = Math.floor((pz - 2 - A[2]) / 16); c <= Math.floor((pz + 2 - A[2]) / 16); c++) cles.add(cle(a, b, c));
      }
    }
    let n = 0;
    for (const k of cles) {
      if (dejaFaites.has(k)) continue;
      for (const d of this.rs.tousDraws()) for (const s of d.sections) if (s.cle === k) { cuireDraw(this.rs, g, this.dirBake, d, this.optsCuisson, s.debut / 6, (s.debut + s.nb) / 6); n++; }
    }
    return n;
  }

  _grille(r) { this.grille = construireGrille(this.rs, { feuillage: r['ombres.feuillage'], verre: r['ombres.verre'], eau: r['ombres.eau'] }); }

  // Les tableaux d'ombre sont partages : on les donne une fois aux workers.
  _envoyer() {
    if (this.envoyees) return;
    this.envoyees = true;
    this.rs.envoyerOmbres?.();
  }

  _brume(r, a, params, out) {
    const { actif } = this;
    const base = a.brume ? { ...a.brume } : {};
    const auto = a.auto;
    const explicite = base.debut !== undefined || base.fin !== undefined;
    if (!actif.brume) return a.brume;
    const dens = r['brume.densite'];
    if (!explicite && dens > 1) {
      const fin = Math.max(auto.fin / dens, auto.proche + 12);
      base.fin = fin; base.debut = Math.max(auto.debut / dens, Math.min(auto.proche + 3, fin * 0.85));
      if (base.debut > fin - 8) base.debut = fin - 8;
    }
    const col = r['brume.couleur'];
    if (col) base.couleur = col.map((x) => x * 255);
    const courbe = r['brume.courbe'];
    if (courbe !== 'lineaire') {
      const L = new Float32Array(257);
      for (let i = 0; i <= 256; i++) { const u = i / 256; L[i] = courbe === 'exp' ? (1 - Math.exp(-3 * u)) / (1 - Math.exp(-3)) : (1 - Math.exp(-5 * u * u)) / (1 - Math.exp(-5)); }
      params.fogLut = L;
    }
    const hd = r['brume.hauteur.densite'];
    if (hd > 0) { const ep = r['brume.hauteur.epaisseur']; params.fogH = { haut: r['brume.hauteur.niveau'] + ep, inv: 1 / ep, k: hd * 0.025 }; }
    void out;
    return base;
  }

  _eau(r, a, out) {
    const refl = r['eau.reflet.ciel'];
    const ciel = out.ciel || a.ciel;
    const e = { t: a.temps, refl: refl > 0, opacite: r['eau.opacite'], tint: null, kLum: 1 / L_REF_EAU, pente: borne(0.04 + 2.2 * r['eau.vagues.hauteur'], 0, 0.6) };
    const c = r['eau.couleur'];
    if (c) e.tint = c.map((x) => x * 255);
    const k = r['eau.reflet.fresnel'];
    e.fres = new Float32Array(256);
    for (let i = 0; i < 256; i++) e.fres[i] = refl * (0.08 + 0.92 * Math.pow(1 - i / 255, k));
    e.sky = new Float32Array(64 * 3);
    const [zr, zg, zb] = ciel.zenith, [hr, hg, hb] = ciel.horizon;
    for (let i = 0; i < 64; i++) { const t = Math.pow(i / 63, 0.55); e.sky[i * 3] = hr + (zr - hr) * t; e.sky[i * 3 + 1] = hg + (zg - hg) * t; e.sky[i * 3 + 2] = hb + (zb - hb) * t; }
    const es = r['eau.vagues.echelle'], v = r['eau.vagues.vitesse'];
    e.ond = new Float32Array(12);
    [[0.35, 1.1, 0.8, 0.5], [1.75, 1.9, 1.3, 0.3], [3.4, 3.3, 1.9, 0.2]].forEach(([ang, kk, om, am], i) => { const K = kk / es; e.ond[i * 4] = Math.cos(ang) * K; e.ond[i * 4 + 1] = Math.sin(ang) * K; e.ond[i * 4 + 2] = om * v; e.ond[i * 4 + 3] = am; });
    return e;
  }

  // Vue sous l'eau : { couleur, distance, lum } (valeurs du shader) ; null = comportement d'avant.
  sousEau(heure) {
    if (!this.actif.eau) return null;
    const r = this._valeurs(heure);
    const c = r['eau.sousEau.couleur'], d = r['eau.sousEau.distance'], l = r['eau.sousEau.luminosite'];
    if (!c && !d && l === 1) return null;
    return { couleur: c ? c.map((x) => x * 255) : null, distance: d || 0, lum: l };
  }
}
