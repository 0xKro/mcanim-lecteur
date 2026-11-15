// Camera de film : planification de la camera SUR TOUT LE PLAN (pas image par image).
//
// Camera de suivi : pour chaque image on connait la camera DEMANDEE (cible + decalage). On cherche, pour toutes les
// images a la fois (programmation dynamique, "Viterbi"), la suite de corrections la moins chere parmi trois gestes :
//   hausse (monter la camera, jusqu'a +3 blocs), cote (tourner autour de l'acteur a distance egale : 15, 30, 45... degres),
//   rapprochee (raccourcir la distance, jamais sous le minimum). Le cout contient : la gene de la vue (ligne de vue
//   tete/buste coupee par un bloc plein), l'ecart a la camera demandee (hausse < cote < rapprochee) et les changements
//   d'une image a l'autre (donc pas de saccades). Puis les trois corrections sont lissees dans le temps (filtre avant ET
//   arriere : la camera s'ecarte AVANT l'obstacle), la trajectoire lissee est re-verifiee (aucune image dans un bloc, 0,3
//   de marge pour le plan proche) et les rares violations restantes sont reparees localement.
//
// Seuls les blocs vraiment pleins comptent (`solide(x,y,z)`) : feuilles, plantes, eau ne bloquent pas la camera.

const RAD = Math.PI / 180;
export const DISTANCE_MINI = 2.5;      // blocs ; ou 60 % de la distance demandee si c'est plus
export const MARGE_PLAN_PROCHE = 0.3;  // blocs de marge entre la camera et tout bloc plein

// ---------------------------------------------------------------- outils
// Marge autour d'un point : aucun bloc plein dans la boite de +-m (les 8 coins suffisent : la boite est plus petite qu'un bloc).
export function pointDegage(solide, x, y, z, m = MARGE_PLAN_PROCHE) {
  return !(solide(x - m, y - m, z - m) || solide(x + m, y - m, z - m) || solide(x - m, y + m, z - m) || solide(x + m, y + m, z - m)
    || solide(x - m, y - m, z + m) || solide(x + m, y - m, z + m) || solide(x - m, y + m, z + m) || solide(x + m, y + m, z + m));
}

// Le segment a -> b (sauf les `fin` derniers blocs cote b) traverse-t-il un bloc plein ?
function segmentBloque(solide, a, b, fin = 0.3, pas = 0.2) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const D = Math.hypot(dx, dy, dz);
  const L = D - fin;
  for (let s = 0; s <= L; s += pas) {
    const q = s / D;
    if (solide(a[0] + dx * q, a[1] + dy * q, a[2] + dz * q)) return true;
  }
  return false;
}

// Filtre d'ordre 1 applique vers l'avant puis vers l'arriere (phase nulle : pas de retard, il anticipe).
function lisserZeroPhase(suite, tau, dt) {
  const n = suite.length, k = suite[0].length;
  const a = 1 - Math.exp(-dt / tau);
  let cur = suite.map((v) => v.slice());
  for (const sens of [1, -1]) {
    const sortie = cur.map((v) => v.slice());
    let etat = cur[sens === 1 ? 0 : n - 1].slice();
    for (let j = 0; j < n; j++) {
      const i = sens === 1 ? j : n - 1 - j;
      for (let c = 0; c < k; c++) etat[c] += (cur[i][c] - etat[c]) * a;
      sortie[i] = etat.slice();
    }
    cur = sortie;
  }
  return cur;
}

// Elargit chaque correction dans le temps (+- `demi` images) : une correction courte garde sa pleine valeur apres lissage.
// `parComposante` : chaque valeur separement (la plus grande en valeur absolue) ; sinon le vecteur entier de plus grande norme.
function dilater(suite, demi, parComposante) {
  const n = suite.length, k = suite[0].length;
  return suite.map((_, i) => {
    const lo = Math.max(0, i - demi), hi = Math.min(n - 1, i + demi);
    if (parComposante) {
      const v = suite[i].slice();
      for (let c = 0; c < k; c++) for (let j = lo; j <= hi; j++) if (Math.abs(suite[j][c]) > Math.abs(v[c])) v[c] = suite[j][c];
      return v;
    }
    let m = suite[i], nm = Math.hypot(...m);
    for (let j = lo; j <= hi; j++) { const nj = Math.hypot(...suite[j]); if (nj > nm) { m = suite[j]; nm = nj; } }
    return m.slice();
  });
}

// Lissage sous contrainte : on elargit, on lisse (filtre avant et arriere), on verifie. Une image qui ne valide pas recoit,
// dans la suite BRUTE, une valeur sure (`repli`) et on recommence : la courbe reste toujours lisse (pas de rustine locale).
function lisserSousContrainte(suite, { tau, dt, valide, repli, iterations = 10, fenetre = 0.5, parComposante = true }) {
  const n = suite.length;
  const demi = Math.round(fenetre / dt);
  const brut = suite.map((v) => v.slice());
  let cur = lisserZeroPhase(dilater(brut, demi, parComposante), tau, dt);
  let reparees = 0;
  for (let it = 0; it < iterations; it++) {
    let mauvaises = 0;
    for (let i = 0; i < n; i++) if (!valide(i, cur[i])) { brut[i] = repli(i, cur[i]); mauvaises++; }
    if (!mauvaises) return { suite: cur, ancrees: reparees };
    reparees += mauvaises;
    cur = lisserZeroPhase(dilater(brut, demi, parComposante), tau, dt);
  }
  let forcees = 0;
  for (let i = 0; i < n; i++) if (!valide(i, cur[i])) { cur[i] = repli(i, cur[i]); forcees++; }
  return { suite: cur, ancrees: reparees + forcees, forcees };
}

// ---------------------------------------------------------------- camera de suivi
const HAUSSES = [0, 0.75, 1.5, 2.25, 3];
const COTES = [0, 15, -15, 30, -30, 45, -45, 60, -60, 75, -75, 90, -90];
const RAPPROCHES = [0, 1 / 3, 2 / 3, 1];
const NH = HAUSSES.length, NC = COTES.length, NR = RAPPROCHES.length, NS = NH * NC * NR;
const etat = (h, c, r) => (h * NC + c) * NR + r;

// Couts (voir l'en-tete). Une gene dure quelques images ; une correction coute a chaque image ou elle est active.
const C_HAUSSE = 0.15, C_COTE = 0.012, C_RAPPROCHE = 1.0;      // par bloc / par degre / pour le raccourcissement maximal
const C_TETE = 1.2, C_BUSTE = 0.4, C_INVALIDE = 40;
const C_PROCHE = 0.25;                                          // bloc plein a moins de 0,9 de la camera (un tronc colle a l'objectif)             // ligne de vue tete coupee, buste coupe, camera dans un bloc
const T_HAUSSE = 0.4, T_COTE = 0.06, T_RAPPROCHE = 1.5;         // changement d'une correction d'une image a la suivante

let TRANSITIONS = null;
function transitions() {
  if (TRANSITIONS) return TRANSITIONS;
  const t = new Float32Array(NS * NS);
  for (let h = 0; h < NH; h++) for (let c = 0; c < NC; c++) for (let r = 0; r < NR; r++) {
    for (let h2 = 0; h2 < NH; h2++) for (let c2 = 0; c2 < NC; c2++) for (let r2 = 0; r2 < NR; r2++) {
      t[etat(h, c, r) * NS + etat(h2, c2, r2)] = T_HAUSSE * Math.abs(HAUSSES[h] - HAUSSES[h2]) + T_COTE * Math.abs(COTES[c] - COTES[c2]) + T_RAPPROCHE * Math.abs(RAPPROCHES[r] - RAPPROCHES[r2]);
    }
  }
  return (TRANSITIONS = t);
}

// cibles[i] : point regarde (yeux de l'acteur). voulues[i] : camera demandee. Retourne { pos, params, stat, ... }.
export function planifierCameraSuivi({ cibles, voulues, solide, dt = 1 / 30, tau = 0.4, buste = 0.9 }) {
  const n = cibles.length;
  const dem = voulues.map((p, i) => [p[0] - cibles[i][0], p[1] - cibles[i][1], p[2] - cibles[i][2]]);
  const Dreq = dem.map((o) => Math.hypot(...o));
  const Dmin = Dreq.map((d) => Math.min(d, Math.max(DISTANCE_MINI, 0.6 * d)));
  const smin = Dreq.map((d, i) => (d > 1e-6 ? Math.min(1, Dmin[i] / d) : 1));

  // position pour des corrections (hausse en blocs, cote en degres, rapprochee 0..1)
  const position = (i, h, cDeg, r, sortie = [0, 0, 0]) => {
    const s = 1 - (1 - smin[i]) * r, th = cDeg * RAD, co = Math.cos(th), si = Math.sin(th);
    const o = dem[i];
    sortie[0] = cibles[i][0] + (o[0] * co - o[2] * si) * s;
    sortie[1] = cibles[i][1] + o[1] * s + h;
    sortie[2] = cibles[i][2] + (o[0] * si + o[2] * co) * s;
    return sortie;
  };
  const distanceOk = (i, p) => Math.hypot(p[0] - cibles[i][0], p[1] - cibles[i][1], p[2] - cibles[i][2]) >= Dmin[i] - 1e-6;
  const valable = (i, p) => pointDegage(solide, p[0], p[1], p[2]) && distanceOk(i, p);
  const poitrine = (i) => [cibles[i][0], cibles[i][1] - buste, cibles[i][2]];

  // ---- couts par image et par etat ; `ok` memorise les etats sans bloc autour de la camera
  const unaire = new Array(n), ok = new Array(n);
  const tmp = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const u = new Float32Array(NS), o = new Uint8Array(NS);
    const po = poitrine(i);
    for (let h = 0; h < NH; h++) for (let c = 0; c < NC; c++) for (let r = 0; r < NR; r++) {
      const e = etat(h, c, r);
      const p = position(i, HAUSSES[h], COTES[c], RAPPROCHES[r], tmp);
      let cout = C_HAUSSE * HAUSSES[h] + C_COTE * Math.abs(COTES[c]) + C_RAPPROCHE * RAPPROCHES[r];
      if (!valable(i, p)) cout += C_INVALIDE;
      else {
        o[e] = 1;
        if (segmentBloque(solide, p, cibles[i])) cout += C_TETE;
        if (segmentBloque(solide, p, po)) cout += C_BUSTE;
        if (!pointDegage(solide, p[0], p[1], p[2], 0.9)) cout += C_PROCHE;
      }
      u[e] = cout;
    }
    unaire[i] = u; ok[i] = o;
  }

  // ---- programmation dynamique sur tout le plan
  const T = transitions();
  let coutPrec = Float64Array.from(unaire[0]);
  const parent = new Uint16Array(n * NS);
  for (let i = 1; i < n; i++) {
    const cout = new Float64Array(NS);
    for (let s = 0; s < NS; s++) {
      let m = Infinity, arg = 0;
      for (let q = 0; q < NS; q++) { const v = coutPrec[q] + T[q * NS + s]; if (v < m) { m = v; arg = q; } }
      cout[s] = m + unaire[i][s]; parent[i * NS + s] = arg;
    }
    coutPrec = cout;
  }
  let s = 0;
  for (let q = 1; q < NS; q++) if (coutPrec[q] < coutPrec[s]) s = q;
  const choix = new Array(n);
  for (let i = n - 1; i >= 0; i--) { choix[i] = s; s = parent[i * NS + s]; }
  const decoder = (e) => [HAUSSES[Math.floor(e / (NR * NC))], COTES[Math.floor(e / NR) % NC], RAPPROCHES[e % NR]];
  const parametres = choix.map(decoder);

  // ---- lissage dans le temps, puis re-verification
  // repli : parmi les etats sans bloc, le plus proche (en corrections) de la valeur lissee ; sinon on monte
  const repli = (i, v) => {
    let meilleur = -1, md = Infinity;
    for (let e = 0; e < NS; e++) {
      if (!ok[i][e]) continue;
      const w = decoder(e);
      const d = ((w[0] - v[0]) / 0.75) ** 2 + ((w[1] - v[1]) / 15) ** 2 + ((w[2] - v[2]) * 3) ** 2;
      if (d < md) { md = d; meilleur = e; }
    }
    return meilleur >= 0 ? decoder(meilleur) : [HAUSSES[NH - 1], 0, 0];
  };
  const valide = (i, v) => valable(i, position(i, v[0], v[1], v[2]));
  const lisse = lisserSousContrainte(parametres, { tau, dt, valide, repli });
  const params = lisse.suite;

  const pos = params.map((v, i) => position(i, v[0], v[1], v[2], [0, 0, 0]));
  // dernier recours : aucune combinaison libre (cavite fermee) -> on monte, sans jamais rester dans un bloc plein
  let poussees = 0;
  for (let i = 0; i < n; i++) {
    if (pointDegage(solide, pos[i][0], pos[i][1], pos[i][2], 0.05)) continue;
    poussees++;
    for (let h = 0.25; h <= 24; h += 0.25) if (pointDegage(solide, pos[i][0], pos[i][1] + h, pos[i][2], 0.05)) { pos[i][1] += h; break; }
  }

  // ---- compte rendu : combien d'images chaque geste est actif
  const stat = { hausse: 0, cote: 0, rapprochee: 0, total: 0 };
  const corrigee = params.map((v) => {
    const h = v[0] > 0.3, c = Math.abs(v[1]) > 4, r = v[2] > 0.1;
    if (h) stat.hausse++;
    if (c) stat.cote++;
    if (r) stat.rapprochee++;
    if (h || c || r) stat.total++;
    return h || c || r;
  });
  // gene residuelle : images dont la ligne de vue vers la tete est coupee par un bloc plein
  let vueCoupee = 0;
  for (let i = 0; i < n; i++) if (segmentBloque(solide, pos[i], cibles[i])) vueCoupee++;
  return { pos, params, corrigee, stat, vueCoupee, poussees, ancrees: lisse.ancrees };
}

// ---------------------------------------------------------------- camera libre
// Pousse la camera hors des blocs pleins (marge de 0,3). Pas de distance minimale. Le deplacement est lisse dans le temps.
export function planifierCameraLibre({ positions, cibles, solide, dt = 1 / 30, tau = 0.25 }) {
  const n = positions.length;
  const DIRS = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0],
    [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1], [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1], [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1],
    [1, 1, 1], [1, 1, -1], [-1, 1, 1], [-1, 1, -1], [1, -1, 1], [1, -1, -1], [-1, -1, 1], [-1, -1, -1]].map((d) => { const l = Math.hypot(...d); return d.map((x) => x / l); });
  const degage = (p) => pointDegage(solide, p[0], p[1], p[2]);
  // deplacement brut : la plus petite poussee qui rend le point libre ; on prefere se rapprocher de la cible (poids 1),
  // puis monter (1,3), puis les autres directions (1,6) : une camera collee a un mur reste du cote du sujet.
  // Hysteresis : la direction choisie a l'image precedente est favorisee (x 0,5), pour ne pas sauter d'une sortie a l'autre.
  let precedente = null;
  const brut = (i) => {
    const p = positions[i];
    if (degage(p)) { precedente = null; return [0, 0, 0]; }
    const dirs = DIRS.map((d, k) => ({ d, k, w: (k === 0 ? 1.3 : 1.6) * (precedente === k ? 0.5 : 1) }));
    if (cibles[i]) {
      const d = [cibles[i][0] - p[0], cibles[i][1] - p[1], cibles[i][2] - p[2]];
      const l = Math.hypot(...d);
      if (l > 1e-6) dirs.push({ d: d.map((x) => x / l), k: 'cible', w: precedente === 'cible' ? 0.5 : 1 });
    }
    let meilleur = null;
    for (const { d, k, w } of dirs) {
      for (let r = 0.1; r <= 40; r += 0.1) {
        if (meilleur && r * w >= meilleur.score) break;
        if (degage([p[0] + d[0] * r, p[1] + d[1] * r, p[2] + d[2] * r])) { meilleur = { score: r * w, k, v: [d[0] * r, d[1] * r, d[2] * r] }; break; }
      }
    }
    precedente = meilleur ? meilleur.k : null;
    return meilleur ? meilleur.v : [0, 40, 0];
  };
  const dep = positions.map((_, i) => brut(i));
  if (!dep.some((d) => Math.hypot(...d) > 1e-9)) return { pos: positions.map((p) => p.slice()), corrigee: dep.map(() => false), stat: { poussee: 0, total: 0 } };
  const apres = (i, v) => [positions[i][0] + v[0], positions[i][1] + v[1], positions[i][2] + v[2]];
  const lisse = lisserSousContrainte(dep, { tau, dt, valide: (i, v) => degage(apres(i, v)), repli: (i) => dep[i], parComposante: false, fenetre: 0.4 });
  const pos = lisse.suite.map((v, i) => apres(i, v));
  const corrigee = lisse.suite.map((v) => Math.hypot(...v) > 0.02);
  const k = corrigee.filter(Boolean).length;
  return { pos, corrigee, stat: { poussee: k, total: k } };
}

// Phrase courte pour la sortie de mcanim rendre. `fps` : images par seconde.
export function resumeCamera(stat, n, fps = 30) {
  if (!stat || !stat.total) return null;
  const s = (k) => (k / fps).toFixed(1).replace('.', ',');
  const gestes = [];
  if (stat.hausse) gestes.push(`hausse ${s(stat.hausse)} s`);
  if (stat.cote) gestes.push(`cote ${s(stat.cote)} s`);
  if (stat.rapprochee) gestes.push(`rapprochee ${s(stat.rapprochee)} s`);
  if (stat.poussee) gestes.push(`poussee hors des blocs ${s(stat.poussee)} s`);
  return `camera corrigee ${s(stat.total)} s sur ${s(n)} s (${gestes.join(', ')})`;
}
