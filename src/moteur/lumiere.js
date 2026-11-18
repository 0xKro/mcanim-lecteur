// Lumiere des blocs et du ciel, calculee et tenue a jour comme dans le jeu : -1 par bloc (au moins), les blocs opaques arretent
// la lumiere, les demi-blocs (dalles, escaliers) l'arretent par leurs faces pleines, la lumiere du ciel descend sans perte tant
// qu'elle vaut 15 et que rien ne l'arrete. Mise a jour incrementale par "retrait puis ajout" (algorithme des moteurs de lumiere du
// jeu, voir Horizon rendu/light.rs : relight, LightChanges ; ATTRIBUTIONS.md). Deux canaux : `bloc` (emission) et `ciel`.
//
// Tableaux : memes indices rembourres que `monde.pal` (une cellule de bordure de chaque cote). Les cellules de la bordure recoivent
// de la lumiere mais n'en renvoient pas (leur contenu est virtuel).
import { FACE_OPPOSEE } from './monde.js';

export class Lumiere {
  // options.blocs : faux = pas de lumiere de blocs (seulement le ciel)
  constructor(monde, { blocs = true } = {}) { this.m = monde; this.blocs = blocs; this.recommencer(); }

  // Tout recalculer (au debut, ou quand la boite grandit)
  recommencer() {
    const m = this.m, N = m.PX * m.PY * m.PZ;
    m.ciel = new Uint8Array(N); m.bloc = new Uint8Array(N);
    this.OFF = [-m.OY, m.OY, -m.OZ, m.OZ, -1, 1];
    // masque de bordure
    this.bord = new Uint8Array(N);
    const { PX, PY, PZ } = m;
    for (let y = 0; y < PY; y++) for (let z = 0; z < PZ; z++) for (let x = 0; x < PX; x++) {
      if (x === 0 || x === PX - 1 || y === 0 || y === PY - 1 || z === 0 || z === PZ - 1) this.bord[(y * PZ + z) * PX + x] = 1;
    }
    this.fileA = new Int32Array(1 << 16); this.dqI = new Int32Array(1 << 14); this.dqL = new Uint8Array(1 << 14);
    this._initCiel();
    if (this.blocs) this._initBloc();
  }

  // niveau qu'une cellule d'opacite `o` laisse passer vers le bas depuis le niveau `L` (le ciel a 15 ne s'affaiblit que par l'opacite)
  static bas(L, o) { if (o >= 15) return 0; return L === 15 ? 15 - o : Math.max(0, L - Math.max(1, o)); }

  _initCiel() {
    const m = this.m, { PX, PY, PZ, pal, tOpac, ciel } = m, OY = m.OY;
    for (let z = 0; z < PZ; z++) for (let x = 0; x < PX; x++) {
      let L = 15;
      for (let y = PY - 1; y >= 0; y--) {
        const i = (y * PZ + z) * PX + x;
        // une face pleine (dalle, escalier) de la cellule du dessus (bas) ou de celle-ci (haut) arrete la lumiere qui descend
        if (y < PY - 1 && m.occulte(pal[i + OY], pal[i], 0)) L = 0;
        else L = Lumiere.bas(L, tOpac[pal[i]]);
        ciel[i] = L;
      }
    }
    const graines = [];
    for (let y = 1; y < PY - 1; y++) for (let z = 1; z < PZ - 1; z++) {
      let i = (y * PZ + z) * PX + 1;
      for (let x = 1; x < PX - 1; x++, i++) if (ciel[i] > 1) graines.push(i);
    }
    this._propager(ciel, true, Int32Array.from(graines), graines.length);
  }
  _initBloc() {
    const m = this.m, { pal, tEmis, bloc } = m, N = pal.length;
    const g = [];
    for (let i = 0; i < N; i++) { const e = tEmis[pal[i]]; if (e > 0) { bloc[i] = e; g.push(i); } }
    this._propager(bloc, false, Int32Array.from(g), g.length);
  }

  // niveau que (to) recoit depuis (from, niveau lv) dans la direction f
  // sansDe : ignorer les faces pleines de la cellule de depart (elle vient de changer : on cherche ce qu'elle alimentait AVANT)
  _passe(lv, f, from, to, ciel, sansDe = false) {
    const m = this.m, pal = m.pal;
    const pt = pal[to], o = m.tOpac[pt];
    if (o >= 15) return 0;
    // LightEngine.shapeOccludes : faces de la forme d'occlusion (pleines, ou partielles dont l'union couvre la face : monde.occulte)
    if (sansDe ? (m.tOcc[pt] & (1 << FACE_OPPOSEE[f])) !== 0 : m.occulte(pal[from], pt, f)) return 0;
    if (ciel && f === 0 && lv === 15) return 15 - o;
    const nl = lv - (o > 1 ? o : 1);
    return nl > 0 ? nl : 0;
  }
  // niveau que la cellule i tient d'elle-meme (emission, ou ciel du dessus du monde)
  _source(i, ciel) {
    const m = this.m;
    if (ciel) { return i >= (m.PY - 1) * m.OY ? Lumiere.bas(15, m.tOpac[m.pal[i]]) : 0; }
    return m.tEmis[m.pal[i]];
  }

  // Ajout : file `depart` (indices deja a jour), propage vers les voisins plus sombres.
  _propager(arr, ciel, depart, n) {
    let file = this.fileA;
    if (file.length < n + 1024) file = this.fileA = new Int32Array(n * 2);
    for (let k = 0; k < n; k++) file[k] = depart[k];
    let tete = 0, fin = n;
    const OFF = this.OFF, bord = this.bord, m = this.m;
    const suivi = m.suivi && m.sales !== null;
    while (tete < fin) {
      const i = file[tete++];
      const lv = arr[i];
      if (lv < 2) continue;
      if (bord[i]) continue;
      for (let f = 0; f < 6; f++) {
        const j = i + OFF[f];
        const nl = this._passe(lv, f, i, j, ciel);
        if (nl > arr[j]) {
          arr[j] = nl;
          if (suivi) m.sales.push(j);
          if (fin >= file.length) { const g = new Int32Array(file.length * 2); g.set(file); file = this.fileA = g; }
          file[fin++] = j;
        }
      }
      if (tete > 1 << 20 && tete * 2 > fin) { file.copyWithin(0, tete, fin); fin -= tete; tete = 0; }   // file qui glisse : on recolle
    }
  }

  // Retrait : la cellule i vient de perdre de la lumiere. Rend la liste des cellules a re-propager.
  _retirer(arr, ciel, i, ancien) {
    const OFF = this.OFF, bord = this.bord, m = this.m;
    const suivi = m.suivi && m.sales !== null;
    const aj = [];
    let dqI = this.dqI, dqL = this.dqL, tete = 0, fin = 0;
    dqI[fin] = i; dqL[fin++] = ancien;
    while (tete < fin) {
      const p = dqI[tete], lv = dqL[tete++];
      if (bord[p]) continue;
      for (let f = 0; f < 6; f++) {
        const n = p + OFF[f];
        const ln = arr[n];
        if (ln === 0) continue;
        const d = this._passe(lv, f, p, n, ciel, p === i);
        if (ln <= d) {
          const s = this._source(n, ciel);
          if (ln > s) {
            arr[n] = s;
            if (suivi) m.sales.push(n);
            if (fin >= dqI.length) { const a = new Int32Array(dqI.length * 2), b = new Uint8Array(dqL.length * 2); a.set(dqI); b.set(dqL); dqI = this.dqI = a; dqL = this.dqL = b; }
            dqI[fin] = n; dqL[fin++] = ln;
            if (s > 0) aj.push(n);
          } else aj.push(n);
        } else aj.push(n);
      }
    }
    return aj;
  }

  // La cellule (x,y,z) vient de passer de l'indice de palette `ancien` a `nouveau` (la palette est deja a jour dans monde.pal).
  changer(x, y, z, ancien, nouveau) {
    const m = this.m;
    if (!m.dansRembourre(x, y, z)) return;
    const i = m.idxMonde(x, y, z);
    void ancien; void nouveau;
    for (const ciel of this.blocs ? [true, false] : [true]) {
      const arr = ciel ? m.ciel : m.bloc;
      const vieux = arr[i];
      let aj = [];
      if (vieux > 0) { arr[i] = 0; aj = this._retirer(arr, ciel, i, vieux); }
      // la cellule tient maintenant sa propre lumiere (emission, ou ciel)
      const s = this._source(i, ciel);
      if (s > arr[i]) arr[i] = s;
      if (m.suivi && m.sales !== null && arr[i] !== vieux) m.sales.push(i);
      if (arr[i] > 0) aj.push(i);
      // les voisins peuvent maintenant entrer dans la cellule (bloc retire, ou plus transparent)
      for (let f = 0; f < 6; f++) { const n = i + this.OFF[f]; if (arr[n] > 0) aj.push(n); }
      if (aj.length) this._propager(arr, ciel, Int32Array.from(aj), aj.length);
    }
  }

  // ---- lecture (coordonnees monde) ; hors de la zone : ciel 15 au-dessus de la surface, 0 sous
  niveauCiel(x, y, z) { const m = this.m; return m.dansRembourre(x, y, z) ? m.ciel[m.idxMonde(x, y, z)] : (y >= m.zone.hauteur(x, z) ? 15 : 0); }
  niveauBloc(x, y, z) { const m = this.m; return m.dansRembourre(x, y, z) ? m.bloc[m.idxMonde(x, y, z)] : 0; }
}
