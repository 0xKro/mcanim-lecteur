// Transformations d'un volume (rotation d'un quart de tour, miroir) et des ETATS de blocs qui vont avec, comme le jeu
// (BlockState.rotate / BlockState.mirror : StairBlock, DoorBlock, ChestBlock, RailBlock, CrossCollisionBlock...).
// Une transformation du plan horizontal est une matrice 2x2 entiere M = [a, b, c, d] : x' = a x + b z, z' = c x + d z (matrice de
// permutation signee : quart de tour, miroir, ou les deux), plus `ys` (-1 : miroir haut/bas). Reperes : x vers l'est, z vers le sud.
// Rotation d'un quart de tour = sens des aiguilles d'une montre vu d'en haut (nord -> est), comme `rot` du decor et Rotation.CLOCKWISE_90.
// Ordre du jeu (StructureTemplate) : d'abord le miroir, ensuite la rotation.

export const ID = Object.freeze({ M: [1, 0, 0, 1], ys: 1 });
const R1 = [0, -1, 1, 0];                       // (x, z) -> (-z, x) : nord (0,-1) -> est (1,0)
const MX = [-1, 0, 0, 1], MZ = [1, 0, 0, -1];   // miroir "x" : est <-> ouest (Mirror.FRONT_BACK) ; "z" : nord <-> sud (Mirror.LEFT_RIGHT)

export const mul = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]];
export const inv = (A) => [A[0], A[2], A[1], A[3]];   // matrice orthogonale : l'inverse est la transposee
export const det = (A) => A[0] * A[3] - A[1] * A[2];
export function rotM(q) { let M = [1, 0, 0, 1]; for (let i = 0; i < ((q % 4) + 4) % 4; i++) M = mul(R1, M); return M; }
// transformation "miroir puis rotation" (miroir : null, 'x', 'z' ou 'y')
export function transfo(q = 0, miroir = null) {
  const m = miroir === 'x' ? MX : miroir === 'z' ? MZ : [1, 0, 0, 1];
  return { M: mul(rotM(q), m), ys: miroir === 'y' ? -1 : 1 };
}
export const composer = (A, B) => ({ M: mul(A.M, B.M), ys: A.ys * B.ys });     // A apres B
export const inverse = (A) => ({ M: inv(A.M), ys: A.ys });
// A . T . A^-1 : la transformation T ecrite dans le repere local, vue dans le repere du monde (A : local -> monde)
export const conjuguer = (A, T) => composer(composer(A, T), inverse(A));
export const estIdentite = (T) => T.ys === 1 && T.M[0] === 1 && T.M[1] === 0 && T.M[2] === 0 && T.M[3] === 1;
const cle = (T) => T.M.join(',') + '|' + T.ys;

// ---- directions
const VEC = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
export function dirT(dir, T) {
  if (dir === 'up' || dir === 'down') return T.ys < 0 ? (dir === 'up' ? 'down' : 'up') : dir;
  const v = VEC[dir];
  if (!v) return dir;
  const x = T.M[0] * v[0] + T.M[1] * v[1], z = T.M[2] * v[0] + T.M[3] * v[1];
  return x === 1 ? 'east' : x === -1 ? 'west' : z === 1 ? 'south' : 'north';
}

// ---- proprietes d'un etat : { nom: valeur } -> nouvelles proprietes (les valeurs impossibles pour ce bloc gardent l'ancienne valeur)
const DIRS = ['north', 'east', 'south', 'west'];
const LR = { left: 'right', right: 'left' };
const SHAPE_ESC = { inner_left: 'inner_right', inner_right: 'inner_left', outer_left: 'outer_right', outer_right: 'outer_left' };
const TB = { top: 'bottom', bottom: 'top', upper: 'lower', lower: 'upper' };
const FC = { floor: 'ceiling', ceiling: 'floor' };
// forme d'un rail : 'north_south', 'east_west', 'ascending_east', 'south_east'...
function railT(v, T, permis) {
  if (v.startsWith('ascending_')) { const r = 'ascending_' + dirT(v.slice(10), T); return permis.includes(r) ? r : v; }
  const [a, b] = v.split('_').map((w) => dirT(w, T));
  const ns = (w) => w === 'north' || w === 'south';
  const r = ns(a) ? `${a}_${b}` : `${b}_${a}`;
  if (permis.includes(r)) return r;
  return permis.includes(`${a}_${b}`) ? `${a}_${b}` : v;
}
export function transformerProps(props, T, schema) {
  if (estIdentite(T)) return props;
  const permis = schema instanceof Map ? schema : new Map(schema);
  const ok = (k, v) => { const p = permis.get(k); return !p || p.includes(v); };
  const miroir = det(T.M) < 0, bas = T.ys < 0;
  const o = {};
  const aDown = 'down' in props && 'up' in props;     // champignons, lichen, veine de sculk : up/down sont des faces
  for (const [k, v] of Object.entries(props)) {
    let nk = k, nv = v;
    if (DIRS.includes(k)) nk = dirT(k, T);
    else if (aDown && (k === 'up' || k === 'down')) nk = dirT(k, T);
    else if (k === 'facing') nv = dirT(v, T);
    else if (k === 'axis') nv = (v === 'x' || v === 'z') && T.M[1] !== 0 ? (v === 'x' ? 'z' : 'x') : v;
    else if (k === 'rotation') {
      // 0 = sud, 4 = ouest, 8 = nord, 12 = est (16 pas, sens horaire) : vecteur (-sin, cos) transforme, puis angle
      const a = Number(v) * Math.PI / 8, x = -Math.sin(a), z = Math.cos(a);
      const nx = T.M[0] * x + T.M[1] * z, nz = T.M[2] * x + T.M[3] * z;
      nv = String(((Math.round(Math.atan2(-nx, nz) / (Math.PI / 8)) % 16) + 16) % 16);
    } else if (k === 'shape' && SHAPE_ESC[v] !== undefined) nv = miroir ? SHAPE_ESC[v] : v;
    else if (k === 'shape' && /^(north|south|east|west|ascending)_/.test(v)) nv = railT(v, T, permis.get('shape') || []);
    else if (k === 'hinge') nv = miroir ? LR[v] || v : v;
    else if (k === 'type' && LR[v]) nv = miroir ? LR[v] : v;                    // coffre double
    else if (k === 'type' && (v === 'top' || v === 'bottom')) nv = bas ? TB[v] : v;   // dalle
    else if (k === 'half' && TB[v]) nv = bas ? TB[v] : v;
    else if ((k === 'face' || k === 'attachment') && FC[v]) nv = bas ? FC[v] : v;
    else if (k === 'vertical_direction') nv = bas ? (v === 'up' ? 'down' : v === 'down' ? 'up' : v) : v;
    else if (k === 'hanging') nv = bas ? (v === 'true' ? 'false' : 'true') : v;
    else if (k === 'orientation') nv = v.split('_').map((w) => dirT(w, T)).join('_');
    if (!ok(nk, nv)) { nk = k; nv = v; }
    o[nk] = nv;
  }
  return o;
}

// Numero d'etat transforme (memo par transformation). d : donnees du jeu.
const memos = new WeakMap();
export function transformerEtat(d, id, T) {
  if (id < 0 || estIdentite(T)) return id;
  let parT = memos.get(d);
  if (!parT) { parT = new Map(); memos.set(d, parT); }
  const k = cle(T);
  let m = parT.get(k);
  if (!m) { m = new Map(); parT.set(k, m); }
  let r = m.get(id);
  if (r !== undefined) return r;
  const b = d.blocDe(id), props = d.props(id);
  r = id;
  if (Object.keys(props).length) {
    const np = transformerProps(props, T, d.schema(b));
    for (const [kk, v] of Object.entries(np)) if (props[kk] !== v) r = d.avec(r, kk, v);
    // les proprietes permutees (north -> east...) : la valeur d'origine d'une cle qui a change de nom doit etre remplacee aussi
    for (const kk of Object.keys(props)) if (!(kk in np)) r = d.avec(r, kk, props[kk]);
  }
  m.set(id, r);
  return r;
}

// Noms de proprietes "forcees" (ecrites par le modele) apres transformation : north -> east...
export function transformerCles(cles, T) {
  if (estIdentite(T)) return cles;
  const aDown = cles.has('up') && cles.has('down');
  return new Set([...cles].map((k) => (DIRS.includes(k) || (aDown && (k === 'up' || k === 'down')) ? dirT(k, T) : k)));
}
