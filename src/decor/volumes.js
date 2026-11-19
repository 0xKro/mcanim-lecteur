// Operations de VOLUME : grille (blocs denses + palette), importer (.schem, .nbt, .litematic), copier, miroir, rotation.
// Tout passe par une transformation du contenu (miroir puis quart de tour, transfo.js) appliquee aux positions ET aux etats des blocs
// (escaliers, portes, rails, clotures, axes...), comme le jeu quand il pose une structure tournee.
import { choisir } from './lire.js';
import { ErreurDecor, LIMITES, TOUT } from './grille.js';
import { etatDe } from './etats.js';
import { transfo, composer, conjuguer, transformerEtat, transformerCles } from './transfo.js';
import { motifsBanniere } from './importer.js';
import { reprendreEntiteBloc, reprendreEntite } from './entites-import.js';
import { MOTIFS } from '../film/bannieres-champ.js';
import { TEINTURES } from '../creatures/especes.js';

// repere affine de l'operation : monde = A . (x, z) local + t ; Y = y local + t[1]
function affine(ex, op) { return { A: ex.matrice(op), t: ex.pt(op, [0, 0, 0]) }; }

// placement d'un contenu (sx, sy, sz) transforme par T (local) : decalages pour que le coin bas reste en (0, 0, 0)
function placement(T, sx, sy, sz) {
  const M = T.M, coins = [[0, 0], [sx - 1, 0], [0, sz - 1], [sx - 1, sz - 1]].map(([i, k]) => [M[0] * i + M[1] * k, M[2] * i + M[3] * k]);
  const mx = Math.min(...coins.map((c) => c[0])), mz = Math.min(...coins.map((c) => c[1]));
  const W = M[0] !== 0 ? sx : sz, L = M[0] !== 0 ? sz : sx;
  return { M, ys: T.ys, dx: -mx, dz: -mz, W, H: sy, L };
}

// Pose un contenu dense. `entree(p)` -> { garder } | { id, jeu } | { choix, props?, jeu } pour un indice de palette p.
function poserContenu(ex, op, { sx, sy, sz, indices, entree, T, coin }) {
  const g = ex.g, d = ex.d;
  const { A, t } = affine(ex, op);
  const P = placement(T, sx, sy, sz), M = P.M;
  const Tm = composer({ M: A, ys: 1 }, T);    // etats : repere du contenu -> monde
  const cache = new Map();
  const vol = sx * sy * sz;
  if (vol > LIMITES.volume) throw new ErreurDecor(`${op.chemin} : ${op.nom} : ${vol} cellules (maximum ${LIMITES.volume} par operation)`);
  let poses = 0;
  for (let j = 0; j < sy; j++) {
    const ly = coin[1] + (P.ys < 0 ? sy - 1 - j : j), Y = ly + t[1];
    for (let k = 0; k < sz; k++) {
      let ii = (j * sz + k) * sx;
      for (let i = 0; i < sx; i++, ii++) {
        const p = indices[ii];
        let e = cache.get(p);
        if (e === undefined) { e = entree(p, Tm); cache.set(p, e); }
        if (e.garder) continue;
        const lx = coin[0] + M[0] * i + M[1] * k + P.dx, lz = coin[2] + M[2] * i + M[3] * k + P.dz;
        const X = A[0] * lx + A[1] * lz + t[0], Z = A[2] * lx + A[3] * lz + t[2];
        let id = e.id;
        if (e.choix) {
          const spec = choisir(e.choix, ex.graine, X - ex.ax, Y - ex.ay, Z - ex.az);
          let m = e.memo.get(spec);
          if (m === undefined) { m = transformerEtat(d, etatDe(d, spec.bloc, spec.props), Tm); e.memo.set(spec, m); }
          id = m;
        }
        if (id === -1) g.poserPal(X, Y, Z, 1); else g.poserEtat(X, Y, Z, id);
        g.figer(X, Y, Z, e.jeu);
        poses++;
      }
    }
  }
  return { poses, P };
}

// transformation du contenu d'une operation : options rot (0/90/180/270) et miroir ("x", "z" ; "y" pour copier/miroir)
const transfoOp = (o) => transfo((o.rot ?? 0) / 90, o.miroir ?? null);

// ---- grille : ["grille", x, y, z, sx, sy, sz, [palette], "donnees", {rot, miroir, air}]
function grille(ex, op) {
  const d = ex.d, g = ex.g, cls = ex.cls;
  const T = transfoOp(op.opt);
  const entree = (p, Tm) => {
    const c = op.palette[p];
    if (c === null || c === undefined) return { garder: true };
    const e1 = c.entrees[0].spec;
    if (op.opt.air === false && c.entrees.length === 1 && cls.info(e1.bloc).air) return { garder: true };
    const cles = new Set(Object.keys(e1.props));
    const jeu = g.numeroJeu(transformerCles(cles, Tm));
    if (c.entrees.length > 1) return { choix: c, memo: new Map(), jeu: g.numeroJeu(transformerCles(new Set(c.entrees.flatMap((x) => Object.keys(x.spec.props))), Tm)) };
    return { id: transformerEtat(d, etatDe(d, e1.bloc, e1.props), Tm), jeu };
  };
  poserContenu(ex, op, { sx: op.taille[0], sy: op.taille[1], sz: op.taille[2], indices: op.indices, entree, T, coin: op.p });
}

// ---- importer : ["importer", "fichier", x, y, z, {rot, miroir, air, inconnu, etats}]
function importer(ex, op) {
  const d = ex.d, g = ex.g;
  const I = op.imp, T = transfoOp(op.opt);
  const fige = op.opt.etats !== 'recalculer' ? g.numeroJeu(TOUT) : 0;
  const entree = (p, Tm) => {
    const r = I.resolus[p];
    if (r.garder || (op.opt.air === false && r.air)) return { garder: true };
    return { id: transformerEtat(d, r.id, Tm), jeu: fige };
  };
  const [sx, sy, sz] = I.taille;
  const { poses, P } = poserContenu(ex, op, { sx, sy, sz, indices: I.indices, entree, T, coin: op.p });
  // entites de blocs et entites : reprises pour le dessin (bannieres, panneaux, pots) et la simulation (conteneurs, pupitres, cadres), le reste compte
  const { A, t } = affine(ex, op);
  const M = P.M;
  const versMonde = (x, y, z) => {
    const j = P.ys < 0 ? sy - 1 - y : y;
    const lx = op.p[0] + M[0] * x + M[1] * z + P.dx, lz = op.p[2] + M[2] * x + M[3] * z + P.dz;
    return [A[0] * lx + A[1] * lz + t[0], op.p[1] + j + t[1], A[2] * lx + A[3] * lz + t[2]];
  };
  const Tm = composer({ M: A, ys: 1 }, T);
  const be = ex.stats.blocsEntites;
  const repris = new Map(), ignorees = new Map();
  const butins0 = be.butins ?? 0;
  const compter = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const e of I.entites) {
    const id = e.id.replace(/^minecraft:/, '').toLowerCase();
    if (id === 'banner') {
      const motifs = motifsBanniere(e.donnees, TEINTURES).filter(([m, c]) => MOTIFS.includes(m) && m !== 'base' && TEINTURES.includes(c)).slice(0, 16);
      if (motifs.length) ex.stats.bannieres.push([...versMonde(e.x, e.y, e.z), motifs]);
      compter(repris, 'banner');
      continue;
    }
    // blocs de jeu de construction : le jeu remplace un bloc jigsaw par son `final_state` en posant la piece, et un bloc de structure par de l'air
    if (id === 'jigsaw' || id === 'structure_block') {
      const [X, Y, Z] = versMonde(e.x, e.y, e.z);
      let fin = id === 'jigsaw' ? d.etatId(String(e.donnees?.final_state ?? 'minecraft:air').replace(/^(?!minecraft:)/, 'minecraft:')) : -1;
      if (fin < 0) fin = d.etatParDefaut(d.idBloc('air'));
      g.poserEtat(X, Y, Z, transformerEtat(d, fin, Tm)); g.figer(X, Y, Z, fige);
      compter(repris, `${id} (remplace)`);
      continue;
    }
    const r = reprendreEntiteBloc(e, versMonde, Tm, be);
    compter(r ? repris : ignorees, r || id || '?');
  }
  // point (doubles) : cellule transformee + partie fractionnaire tournee autour du centre de la cellule
  const versPoint = (x, y, z) => {
    const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z), fx = x - cx - 0.5, fy = y - cy, fz = z - cz - 0.5;
    const [X, Y, Z] = versMonde(cx, cy, cz);
    return [X + 0.5 + Tm.M[0] * fx + Tm.M[1] * fz, Y + (Tm.ys < 0 ? 1 - fy : fy), Z + 0.5 + Tm.M[2] * fx + Tm.M[3] * fz];
  };
  for (const e of I.entitesMonde ?? []) {
    const id = e.id.replace(/^minecraft:/, '').toLowerCase();
    if (reprendreEntite(e, versMonde, Tm, be, versPoint)) compter(repris, id); else compter(ignorees, id || '?');
  }
  const liste = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} ${n}`).join(', ');
  ex.stats.notes.push(`import ${op.fichier} (${I.format}) : ${sx}x${sy}x${sz}, ${poses} cellules posees${op.opt.rot ? `, rot ${op.opt.rot}` : ''}${op.opt.miroir ? `, miroir ${op.opt.miroir}` : ''}`
    + `${I.notes.length ? ' ; ' + I.notes.join(' ; ') : ''}${repris.size ? ` ; repris : ${liste(repris)}` : ''}${(be.butins ?? 0) > butins0 ? ` ; ${(be.butins ?? 0) - butins0} conteneur(s) a table de butin, vides (le jeu tire leur contenu a la premiere ouverture : mets-le dans monde.contenus)` : ''}${ignorees.size ? ` ; ignores (ni dessines ni simules) : ${liste(ignorees)}` : ''}`);
}

// ---- copier / miroir / rotation : contenu d'une boite du decor (deja construite), transforme et pose ailleurs ou sur place
function transferer(ex, op, b, T, dest, { vider = false, air = true } = {}) {
  const g = ex.g, d = ex.d, cls = ex.cls;
  const [x1, y1, z1, x2, y2, z2] = b, sx = x2 - x1 + 1, sy = y2 - y1 + 1, sz = z2 - z1 + 1, vol = sx * sy * sz;
  if (vol > LIMITES.volume) throw new ErreurDecor(`${op.chemin} : ${op.nom} : boite de ${vol} cellules (maximum ${LIMITES.volume})`);
  const { A, t } = affine(ex, op);
  const W = (lx, ly, lz) => [A[0] * lx + A[1] * lz + t[0], ly + t[1], A[2] * lx + A[3] * lz + t[2]];
  // photo de la source (indices de palette et proprietes figees) : la destination peut la recouvrir
  const src = new Uint32Array(vol), figes = new Map();
  let n = 0;
  for (let j = 0; j < sy; j++) for (let k = 0; k < sz; k++) for (let i = 0; i < sx; i++, n++) {
    const [X, Y, Z] = W(x1 + i, y1 + j, z1 + k);
    src[n] = g.pal(X, Y, Z);
    const f = g.forces_(X, Y, Z);
    if (f) figes.set(n, f);
  }
  const Tw = conjuguer({ M: A, ys: 1 }, T);   // la transformation locale vue dans le monde (etats des blocs)
  const P = placement(T, sx, sy, sz), M = P.M;
  const dedans = (lx, ly, lz) => lx >= dest[0] && lx < dest[0] + P.W && ly >= dest[1] && ly < dest[1] + P.H && lz >= dest[2] && lz < dest[2] + P.L;
  if (vider) {
    for (let j = 0; j < sy; j++) for (let k = 0; k < sz; k++) for (let i = 0; i < sx; i++) {
      if (dedans(x1 + i, y1 + j, z1 + k)) continue;
      const [X, Y, Z] = W(x1 + i, y1 + j, z1 + k);
      if (g.pal(X, Y, Z) !== 0) ex.poserAir(X, Y, Z);
    }
  }
  const estAir = new Map();
  const memoJeu = new Map();
  n = 0;
  for (let j = 0; j < sy; j++) for (let k = 0; k < sz; k++) for (let i = 0; i < sx; i++, n++) {
    const p = src[n];
    let a = estAir.get(p);
    if (a === undefined) { const e = g.etatDePal(p); a = e >= 0 && cls.infoEtat(e).air; estAir.set(p, a); }
    if (a && !air) continue;
    const ly = dest[1] + (P.ys < 0 ? sy - 1 - j : j);
    const lx = dest[0] + M[0] * i + M[1] * k + P.dx, lz = dest[2] + M[2] * i + M[3] * k + P.dz;
    const [X, Y, Z] = W(lx, ly, lz);
    const e = g.etatDePal(p);
    if (e < 0) g.poserPal(X, Y, Z, 1);
    else g.poserEtat(X, Y, Z, transformerEtat(d, e, Tw));
    const f = figes.get(n);
    if (f) {
      let num = memoJeu.get(f);
      if (num === undefined) { num = g.numeroJeu(f === TOUT || f.tout ? TOUT : transformerCles(f, Tw)); memoJeu.set(f, num); }
      g.figer(X, Y, Z, num);
    } else g.forcer(X, Y, Z, []);
  }
}

export const OPS_VOLUMES = {
  grille,
  importer,
  // ["copier", x1,y1,z1,x2,y2,z2, dx,dy,dz, {rot, miroir, air}] : le coin bas de la copie = coin bas de la boite + (dx, dy, dz)
  copier(ex, op) { const b = op.b; transferer(ex, op, b, transfoOp(op.opt), [b[0] + op.d[0], b[1] + op.d[1], b[2] + op.d[2]], { air: op.opt.air !== false }); },
  // ["miroir", x1,y1,z1,x2,y2,z2, "x"|"y"|"z", {decalage: [dx,dy,dz], air}] : sur place (sans decalage) ou copie miroir decalee
  miroir(ex, op) { const b = op.b, dd = op.opt.decalage ?? [0, 0, 0]; transferer(ex, op, b, transfo(0, op.axe), [b[0] + dd[0], b[1] + dd[1], b[2] + dd[2]], { air: op.opt.air !== false }); },
  // ["rotation", x1,y1,z1,x2,y2,z2, angle, {miroir, air}] : la boite tourne sur place autour de son axe vertical ; ce qu'elle ne couvre plus devient de l'air
  rotation(ex, op) {
    const b = op.b, T = transfo(op.angle / 90, op.opt.miroir ?? null);
    const sx = b[3] - b[0] + 1, sz = b[5] - b[2] + 1, P = placement(T, sx, b[4] - b[1] + 1, sz);
    transferer(ex, op, b, T, [b[0] + Math.floor((sx - P.W) / 2), b[1], b[2] + Math.floor((sz - P.L) / 2)], { vider: true, air: op.opt.air !== false });
  },
};
