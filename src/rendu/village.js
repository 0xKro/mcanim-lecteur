// Lecture d'un village dans une zone (.mcz) pour `mcanim terrain` : rues (lignes centrales), maisons avec leurs portes, cloche, puits,
// fermes, lampadaires. Tout vient des BLOCS de la zone (le fichier ne garde pas la structure) : dirt_path pour les rues, portes (porte du bas),
// blocs de construction autour des portes. Deterministe, rapide (un seul passage sur les cellules). Aucune dependance du rasteriseur.
// Coordonnees rendues : coordonnees du MONDE, comme la piste `pos` (centre d'un bloc = entier + 0,5 ; un cadre = bords du bloc).

const SANS_ETAT = (n) => String(n).replace(/^minecraft:/, '').replace(/\[.*$/, '');
const AIR = /^(cave_|void_)?air$/;
// ce qui ne gene pas le passage et ne cache pas le sol (plantes, neige fine, torches, rails, tapis)
const LEGER = /^((cave_|void_)?air|snow|short_grass|tall_grass|fern|large_fern|dead_bush|bush|[a-z_]*flower|dandelion|poppy|[a-z_]*tulip|allium|azure_bluet|cornflower|lilac|rose_bush|peony|torch|wall_torch|lantern|rail|[a-z_]*carpet|leaf_litter|wildflowers|vine|sweet_berry_bush|[a-z_]*pressure_plate|[a-z_]*sapling|[a-z_]*button|[a-z_]*sign)$/;
// materiaux de maison (au-dessus du sol, a cote d'une porte)
const BATI = /(planks|_log$|_wood$|^cobblestone$|^mossy_cobblestone$|stone_brick|_stairs$|_slab$|glass|terracotta|sandstone|^bricks$|_wool$|^hay_block$|_door$|_bed$|^bookshelf$|crafting_table|^barrel$|^chest$|^lectern$|^composter$|^smoker$|^furnace$|^blast_furnace$|^loom$|^stonecutter$|^grindstone$|^cartography_table$|^fletching_table$|^smithing_table$|^brewing_stand$|^cauldron$|iron_bars|^ladder$|_trapdoor$|^bell$)/;
const SOL_RUE = /^(dirt_path)$/;
const DIRS = [[0, -1, 'N'], [0, 1, 'S'], [1, 0, 'E'], [-1, 0, 'O']];   // [dx, dz, nom] ; nord = -z, sud = +z, est = +x, ouest = -x

// ---------------------------------------------------------------- morphologie sur un masque w x h (Uint8Array 0/1)
function dilater(m, w, h) {
  const o = new Uint8Array(m.length);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!m[j * w + i]) continue;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < w && b < h) o[b * w + a] = 1; }
  }
  return o;
}
function eroder(m, w, h) {
  const o = new Uint8Array(m.length);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let ok = m[j * w + i] === 1;
    for (let dj = -1; ok && dj <= 1; dj++) for (let di = -1; ok && di <= 1; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= w || b >= h || !m[b * w + a]) ok = false; }
    o[j * w + i] = ok ? 1 : 0;
  }
  return o;
}

// Amincissement de Zhang-Suen : squelette d'un pixel de large.
function amincir(m0, w, h) {
  const m = Uint8Array.from(m0);
  const p = (i, j) => (i >= 0 && j >= 0 && i < w && j < h ? m[j * w + i] : 0);
  let change = true;
  while (change) {
    change = false;
    for (const pas of [0, 1]) {
      const sup = [];
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        if (!m[j * w + i]) continue;
        const n = [p(i, j - 1), p(i + 1, j - 1), p(i + 1, j), p(i + 1, j + 1), p(i, j + 1), p(i - 1, j + 1), p(i - 1, j), p(i - 1, j - 1)];
        const B = n.reduce((s, v) => s + v, 0);
        if (B < 2 || B > 6) continue;
        let A = 0;
        for (let k = 0; k < 8; k++) if (!n[k] && n[(k + 1) % 8]) A++;
        if (A !== 1) continue;
        if (pas === 0 ? (n[0] && n[2] && n[4]) || (n[2] && n[4] && n[6]) : (n[0] && n[2] && n[6]) || (n[0] && n[4] && n[6])) continue;
        sup.push(j * w + i);
      }
      if (sup.length) { change = true; for (const k of sup) m[k] = 0; }
    }
  }
  return m;
}

// Distance (en cases) de chaque case du masque au fond le plus proche (chanfrein 3-4).
function distance(m, w, h) {
  const d = new Float32Array(m.length);
  const INF = 1e9;
  for (let k = 0; k < d.length; k++) d[k] = m[k] ? INF : 0;
  const v = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : d[j * w + i]);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (m[j * w + i]) d[j * w + i] = Math.min(d[j * w + i], v(i - 1, j) + 1, v(i, j - 1) + 1, v(i - 1, j - 1) + 1.4, v(i + 1, j - 1) + 1.4);
  for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) if (m[j * w + i]) d[j * w + i] = Math.min(d[j * w + i], v(i + 1, j) + 1, v(i, j + 1) + 1, v(i + 1, j + 1) + 1.4, v(i - 1, j + 1) + 1.4);
  return d;
}

// Douglas-Peucker : polyligne [[x,z],...] simplifiee a `eps` blocs.
export function simplifier(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const [ax, az] = pts[0], [bx, bz] = pts[pts.length - 1];
  const L = Math.hypot(bx - ax, bz - az);
  let imax = -1, dmax = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = L < 1e-9 ? Math.hypot(pts[i][0] - ax, pts[i][1] - az) : Math.abs((bx - ax) * (az - pts[i][1]) - (ax - pts[i][0]) * (bz - az)) / L;
    if (d > dmax) { dmax = d; imax = i; }
  }
  if (dmax <= eps) return [pts[0], pts[pts.length - 1]];
  const g = simplifier(pts.slice(0, imax + 1), eps), dr = simplifier(pts.slice(imax), eps);
  return g.slice(0, -1).concat(dr);
}

const longueur = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };

// Squelette -> branches [{ a, b, pts }] ; noeuds = pixels qui ne sont pas de simples passages (nombre de branches != 2), regroupes en amas.
function brancher(sk, w, h) {
  const px = (i, j) => (i >= 0 && j >= 0 && i < w && j < h ? sk[j * w + i] : 0);
  const V8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const nb = (i, j) => V8.filter(([di, dj]) => px(i + di, j + dj)).map(([di, dj]) => [i + di, j + dj]);
  const cn = (i, j) => { const n = V8.map(([di, dj]) => px(i + di, j + dj)); let c = 0; for (let k = 0; k < 8; k++) if (!n[k] && n[(k + 1) % 8]) c++; return c; };
  const noeud = new Int32Array(sk.length).fill(-1);   // amas de noeuds
  const amas = [];
  const estNoeud = (i, j) => { const c = cn(i, j); return c !== 2 && c !== 0 ? true : c === 0; };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!sk[j * w + i] || noeud[j * w + i] >= 0 || !estNoeud(i, j)) continue;
    const id = amas.length, pile = [[i, j]], membres = [];
    noeud[j * w + i] = id;
    while (pile.length) {
      const [a, b] = pile.pop(); membres.push([a, b]);
      for (const [c, d] of nb(a, b)) if (noeud[d * w + c] < 0 && estNoeud(c, d)) { noeud[d * w + c] = id; pile.push([c, d]); }
    }
    amas.push({ x: membres.reduce((s, m) => s + m[0], 0) / membres.length, z: membres.reduce((s, m) => s + m[1], 0) / membres.length, n: membres.length });
  }
  const vu = new Uint8Array(sk.length), branches = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const id = noeud[j * w + i];
    if (id < 0) continue;
    for (const [a, b] of nb(i, j)) {
      const idn = noeud[b * w + a];
      if (idn >= 0 || vu[b * w + a]) continue;
      const pts = [[amas[id].x, amas[id].z], [a, b]]; vu[b * w + a] = 1;
      let prec = [i, j], cur = [a, b], fin = -1;
      for (;;) {
        const cand = nb(cur[0], cur[1]).filter(([c, d]) => !(c === prec[0] && d === prec[1]));
        const n = cand.find(([c, d]) => noeud[d * w + c] >= 0) ?? cand.find(([c, d]) => !vu[d * w + c]);
        if (!n) break;
        if (noeud[n[1] * w + n[0]] >= 0) { fin = noeud[n[1] * w + n[0]]; pts.push([amas[fin].x, amas[fin].z]); break; }
        vu[n[1] * w + n[0]] = 1; pts.push(n); prec = cur; cur = n;
      }
      if (fin >= 0 || pts.length > 2) branches.push({ a: id, b: fin >= 0 ? fin : -1, pts });
    }
  }
  // une branche entre deux noeuds est trouvee des deux cotes : on garde la premiere
  const cles = new Set(), uniques = [];
  for (const br of branches) {
    const p = br.pts, k1 = `${br.a}|${br.b}|${p.length}|${p[1][0]},${p[1][1]}`, k2 = `${br.b}|${br.a}|${p.length}|${p[p.length - 2][0]},${p[p.length - 2][1]}`;
    if (cles.has(k2)) continue;
    cles.add(k1); uniques.push(br);
  }
  return { branches: uniques, amas };
}

// Rues : { l (largeur), p: [[x,z],...] (coordonnees du monde) } ; les plus longues d'abord.
function ruesDuMasque(cases, x0, z0) {
  if (cases.length < 24) return [];
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const [x, z] of cases) { i0 = Math.min(i0, x); i1 = Math.max(i1, x); j0 = Math.min(j0, z); j1 = Math.max(j1, z); }
  const R = 3, w = i1 - i0 + 1 + 2 * R + 2, h = j1 - j0 + 1 + 2 * R + 2;
  let m = new Uint8Array(w * h);
  for (const [x, z] of cases) m[(z - j0 + R + 1) * w + (x - i0 + R + 1)] = 1;
  // fermeture : comble les trous d'une a trois cases (portes, bords, ponts)
  for (let k = 0; k < 2; k++) m = dilater(m, w, h);
  for (let k = 0; k < 2; k++) m = eroder(m, w, h);
  // taches minuscules : ignorees
  const lab = new Int32Array(m.length).fill(-1);
  const tailles = [];
  for (let k0 = 0; k0 < m.length; k0++) {
    if (!m[k0] || lab[k0] >= 0) continue;
    const id = tailles.length, pile = [k0]; lab[k0] = id; let n = 0;
    while (pile.length) {
      const k = pile.pop(); n++;
      const i = k % w, j = (k - i) / w;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < w && b < h && m[b * w + a] && lab[b * w + a] < 0) { lab[b * w + a] = id; pile.push(b * w + a); } }
    }
    tailles.push(n);
  }
  for (let k = 0; k < m.length; k++) if (m[k] && tailles[lab[k]] < 40) m[k] = 0;
  const dt = distance(m, w, h);
  const sk = amincir(m, w, h);
  let { branches, amas } = brancher(sk, w, h);
  // elagage : les petites branches terminales (barbes du squelette) disparaissent, puis les passages simples se rejoignent
  for (let tour = 0; tour < 4; tour++) {
    const deg = new Map();
    for (const b of branches) { deg.set(b.a, (deg.get(b.a) ?? 0) + 1); if (b.b >= 0) deg.set(b.b, (deg.get(b.b) ?? 0) + 1); }
    const avant = branches.length;
    branches = branches.filter((b) => !((b.b < 0 || deg.get(b.a) === 1 || deg.get(b.b) === 1) && longueur(b.pts) < 7 && (b.b < 0 ? deg.get(b.a) >= 2 : Math.max(deg.get(b.a), deg.get(b.b)) >= 3)));
    branches = joindre(branches, amas);
    if (branches.length === avant) break;
  }
  const rues = [];
  for (const b of branches) {
    const L = longueur(b.pts);
    if (L < 9) continue;
    const pts = simplifier(b.pts, 1.5);
    const ws = b.pts.map(([x, z]) => dt[Math.round(z) * w + Math.round(x)]).filter((v) => v > 0).sort((p, q) => p - q);
    const larg = Math.max(1, Math.round(2 * (ws[ws.length >> 1] ?? 1) - 1));
    rues.push({ l: larg, p: pts.map(([x, z]) => [Math.round((x - R - 1 + i0 + x0 + 0.5) * 2) / 2, Math.round((z - R - 1 + j0 + z0 + 0.5) * 2) / 2]), long: L });
  }
  rues.sort((p, q) => q.long - p.long);
  return rues;
}

// Relie les branches qui se suivent : noeud de degre 2 (passage), ou noeud de degre >= 3 ou deux branches continuent presque droit.
function joindre(branches, amas) {
  const dir = (b, finA) => {
    const p = b.pts, n = Math.min(p.length - 1, 5), [ax, az] = finA ? p[0] : p[p.length - 1], [bx, bz] = finA ? p[n] : p[p.length - 1 - n];
    const L = Math.hypot(bx - ax, bz - az) || 1;
    return [(bx - ax) / L, (bz - az) / L];
  };
  let fait = true;
  while (fait) {
    fait = false;
    for (let id = 0; id < amas.length && !fait; id++) {
      const liees = branches.filter((b) => b.a === id || b.b === id);
      if (liees.length < 2 || liees.some((b) => b.a === b.b)) continue;
      let meilleure = null;
      for (let p = 0; p < liees.length; p++) for (let q = p + 1; q < liees.length; q++) {
        const d1 = dir(liees[p], liees[p].a === id), d2 = dir(liees[q], liees[q].a === id);
        const cos = d1[0] * d2[0] + d1[1] * d2[1];       // -1 = parfaitement droit (les deux partent en sens opposes)
        if (cos < -0.82 && (!meilleure || cos < meilleure.cos)) meilleure = { p: liees[p], q: liees[q], cos };
      }
      if (liees.length === 2 && !meilleure) meilleure = { p: liees[0], q: liees[1], cos: 0 };    // simple passage (un coude)
      if (!meilleure) continue;
      const { p, q } = meilleure;
      const gp = p.b === id ? p.pts : p.pts.slice().reverse(), dq = q.a === id ? q.pts : q.pts.slice().reverse();
      const autreP = p.b === id ? p.a : p.b, autreQ = q.a === id ? q.b : q.a;
      const fus = { a: autreP, b: autreQ, pts: gp.concat(dq.slice(1)) };
      branches = branches.filter((b) => b !== p && b !== q); branches.push(fus); fait = true;
    }
  }
  return branches;
}

// ---------------------------------------------------------------- analyse
export function analyserVillage(Z) {
  if (Z._village !== undefined) return Z._village;
  const pal = Z.palette.map((n) => SANS_ETAT(n));
  const classe = new Uint8Array(pal.length);   // 0 rien, 1 chemin, 2 porte, 3 cloche, 4 lit, 5 ferme, 6 lampe, 7 bati, 8 eau
  pal.forEach((n, i) => {
    classe[i] = SOL_RUE.test(n) ? 1 : /_door$/.test(n) ? 2 : n === 'bell' ? 3 : /_bed$/.test(n) ? 4 : n === 'farmland' ? 5 : n === 'torch' || n === 'lantern' ? 6
      : n === 'water' ? 8 : BATI.test(n) ? 7 : 0;
  });
  const demiPorte = pal.map((n, i) => (classe[i] === 2 ? /half=lower/.test(Z.palette[i]) : false));
  const leger = pal.map((n) => LEGER.test(n));
  const { sx, sy, sz, x0, y0, z0 } = Z;
  const portes = [], cloches = [], chemins = [], lits = [], lampes = [], farm = [], eaux = [], gres = [];
  const bati = new Set();
  const cel = Z.cellules, plan = sx * sz;
  for (let ly = 0; ly < sy; ly++) {
    const base = ly * plan;
    for (let k = 0; k < plan; k++) {
      const p = cel[base + k];
      const c = classe[p];
      if (c === 0) continue;
      const lx = k % sx, lz = (k - lx) / sx;
      const x = x0 + lx, y = y0 + ly, z = z0 + lz;
      if (pal[p] === 'smooth_sandstone') gres.push([x, y, z]);   // village du desert : rues et places en gres lisse
      if (c === 1) chemins.push([x, y, z]);
      else if (c === 2) { if (demiPorte[p]) portes.push({ x, y, z, nom: pal[p] }); bati.add(k + base); }
      else if (c === 3) { cloches.push([x, y, z]); bati.add(k + base); }
      else if (c === 4) { lits.push([x, y, z]); bati.add(k + base); }
      else if (c === 5) farm.push([x, y, z]);
      else if (c === 6) lampes.push([x, y, z, pal[p]]);
      else if (c === 7) bati.add(k + base);
      else if (c === 8 && /level=0/.test(Z.palette[p])) eaux.push([x, y, z]);
    }
  }
  const nom = (x, y, z) => pal[Z.paletteEn(x, y, z)];
  const libre = (x, y, z) => leger[Z.paletteEn(x, y, z)];
  // rues : cases de chemin dont le dessus est libre (pas un souterrain)
  const surface = chemins.filter(([x, y, z]) => libre(x, y + 1, z));
  if (portes.length < 2 && !cloches.length && surface.length < 60) return (Z._village = null);

  // centre du village : portes et cloche
  const ancres = [...portes.map((p) => [p.x, p.z]), ...cloches.map((c) => [c[0], c[2]])];
  const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  const centre = ancres.length ? [med(ancres.map((a) => a[0])), med(ancres.map((a) => a[1]))] : [med(surface.map((s) => s[0])), med(surface.map((s) => s[2]))];
  const proche = (x, z, r) => Math.hypot(x - centre[0], z - centre[1]) <= r;
  const portesV = portes.filter((p) => proche(p.x, p.z, 90));
  let casesRue = surface.filter(([x, , z]) => proche(x, z, 90)).map(([x, , z]) => [x, z]);

  // maisons : blocs de construction relies a une porte (au niveau de la porte ou au-dessus ; le sol naturel dessous n'en fait pas partie)
  const cle = (x, y, z) => ((y - y0) * sz + (z - z0)) * sx + (x - x0);
  const maisons = [];
  for (const p of portesV) {
    const sol = { x: p.x, z: p.z };
    const vus = new Set([cle(p.x, p.y, p.z)]), pile = [[p.x, p.y, p.z]];
    let a0 = p.x, a1 = p.x, b0 = p.z, b1 = p.z, n = 0;
    while (pile.length && n < 4000) {
      const [x, y, z] = pile.pop(); n++;
      a0 = Math.min(a0, x); a1 = Math.max(a1, x); b0 = Math.min(b0, z); b1 = Math.max(b1, z);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const X = x + dx, Y = y + dy, Z2 = z + dz;
        if (Y < p.y || Math.abs(X - sol.x) > 14 || Math.abs(Z2 - sol.z) > 14 || Y > p.y + 14) continue;
        const k = cle(X, Y, Z2);
        if (vus.has(k) || !bati.has(k)) continue;
        vus.add(k); pile.push([X, Y, Z2]);
      }
    }
    // cote de la sortie : la porte est dans un mur, on passe par l'axe ou les deux voisins sont libres ; l'interieur a un sol de maison
    let sortie = null;
    const aire = (x, y, z) => libre(x, y, z) && libre(x, y + 1, z);
    for (const [dx, dz] of [[0, 1], [1, 0]]) {
      if (!(aire(p.x + dx, p.y, p.z + dz) && aire(p.x - dx, p.y, p.z - dz))) continue;
      const murs = [[dz, dx], [-dz, -dx]].filter(([ox, oz]) => !libre(p.x + ox, p.y, p.z + oz)).length;
      if (murs === 0) continue;
      // l'interieur est sous le toit : la hauteur de la colonne (toit compris) y est plus grande que dehors, ou le sol est un sol de maison
      const toit = (s) => Z.hauteur(p.x + dx * s, p.z + dz * s) + Z.hauteur(p.x + 2 * dx * s, p.z + 2 * dz * s);
      const sol1 = (s) => classe[Z.paletteEn(p.x + dx * s, p.y - 1, p.z + dz * s)] === 7;
      const dedans = Math.abs(toit(1) - toit(-1)) >= 3 ? (toit(1) > toit(-1) ? 1 : -1) : sol1(1) !== sol1(-1) ? (sol1(1) ? 1 : -1) : 0;
      const s = dedans ? -dedans : (Z.hauteur(p.x + dx, p.z + dz) >= Z.hauteur(p.x - dx, p.z - dz) ? -1 : 1);
      sortie = DIRS.find((d) => d[0] === dx * s && d[1] === dz * s)[2];
      break;
    }
    maisons.push({ b: [a0, b0, a1 + 1, b1 + 1], porte: [p.x + 0.5, p.z + 0.5, sortie ?? '?'], n, type: p.nom });
  }
  // une maison peut avoir plusieurs portes (et se retrouver deux fois) : on fusionne les cadres qui se recouvrent
  const fusion = [];
  for (const m of maisons.sort((a, b) => b.n - a.n)) {
    const f = fusion.find((o) => !(m.b[2] <= o.b[0] || m.b[0] >= o.b[2] || m.b[3] <= o.b[1] || m.b[1] >= o.b[3]));
    if (f) { f.portes.push(m.porte); f.b = [Math.min(f.b[0], m.b[0]), Math.min(f.b[1], m.b[1]), Math.max(f.b[2], m.b[2]), Math.max(f.b[3], m.b[3])]; }
    else fusion.push({ b: m.b, portes: [m.porte], n: m.n });
  }
  const petites = fusion.filter((m) => m.n >= 12);
  // village du desert : pas de dirt_path, les rues sont en gres lisse (hors des maisons)
  if (casesRue.length < 40) {
    const dedans = (x, z) => petites.some((m) => x >= m.b[0] - 1 && x < m.b[2] + 1 && z >= m.b[1] - 1 && z < m.b[3] + 1);
    const g = gres.filter(([x, y, z]) => proche(x, z, 90) && libre(x, y + 1, z) && !dedans(x, z)).map(([x, , z]) => [x, z]);
    if (g.length > casesRue.length) casesRue = g;
  }

  // objets notables
  const cloche = cloches.length ? [cloches[0][0] + 0.5, cloches[0][2] + 0.5] : null;
  const puits = [];
  for (const [x, y, z] of eaux) {
    const mur = (a, b) => /^(mossy_)?cobblestone$|stone_brick/.test(nom(a, y, b));
    if (mur(x + 1, z) && mur(x - 1, z) && mur(x, z + 1) && mur(x, z - 1)) puits.push([x + 0.5, z + 0.5]);
  }
  // fermes : champs de terre labouree d'un seul tenant
  const clef2 = (x, z) => x * 100003 + z, labours = new Map(farm.map(([x, , z]) => [clef2(x, z), [x, z]])), fermes = [];
  const vu2 = new Set();
  for (const [k0, [x, z]] of labours) {
    if (vu2.has(k0)) continue;
    const pile = [[x, z]]; vu2.add(k0); let a0 = x, a1 = x, b0 = z, b1 = z, n = 0;
    while (pile.length) {
      const [a, b] = pile.pop(); n++; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) { const k = clef2(a + dx, b + dz); if (labours.has(k) && !vu2.has(k)) { vu2.add(k); pile.push([a + dx, b + dz]); } }
    }
    if (n >= 6) fermes.push({ b: [a0, b0, a1 + 1, b1 + 1], n });
  }
  fermes.sort((p, q) => q.n - p.n);
  // lampadaires : torche ou lanterne posee sur une barriere, un mur ou une chaine, hors des maisons
  const lampadaires = lampes.filter(([x, y, z, n]) => /fence|wall$|chain/.test(nom(x, y - 1, z)) || (n === 'lantern' && /chain/.test(nom(x, y + 1, z))))
    .filter(([x, , z]) => proche(x, z, 90) && !petites.some((m) => x >= m.b[0] && x < m.b[2] && z >= m.b[1] && z < m.b[3]))
    .map(([x, , z]) => [x + 0.5, z + 0.5]);

  const biome = Z.biome(centre[0], centre[1]).replace('minecraft:', '');
  const porteNom = portesV.length ? portesV.map((p) => p.nom)[0] : '';
  const type = /snowy|ice|frozen|grove|slopes|peaks/.test(biome) ? 'village_snowy' : /desert/.test(biome) ? 'village_desert' : /savanna/.test(biome) ? 'village_savanna' : /taiga/.test(biome) ? 'village_taiga'
    : /acacia/.test(porteNom) ? 'village_savanna' : /spruce/.test(porteNom) ? 'village_taiga' : /jungle|birch/.test(porteNom) && /desert|badlands/.test(biome) ? 'village_desert' : 'village_plains';

  const rues = ruesDuMasque(casesRue, 0, 0);
  const v = { type, centre: [centre[0] + 0.5, centre[1] + 0.5], rues, maisons: petites, cloche, puits: puits.slice(0, 2), fermes: fermes.slice(0, 3), lampes: lampadaires, nbCasesRue: casesRue.length };
  return (Z._village = v);
}

// Resume court pour `mcanim terrain` (objet JSON) : tient dans environ 1,2 Ko. `max` : nombre de maisons au plus.
export function resumeVillage(v, { maisons = 12 } = {}) {
  const r2 = (n) => Math.round(n * 2) / 2;
  const centre = v.centre;
  const proches = v.maisons.slice().sort((p, q) => Math.hypot((p.b[0] + p.b[2]) / 2 - centre[0], (p.b[1] + p.b[3]) / 2 - centre[1]) - Math.hypot((q.b[0] + q.b[2]) / 2 - centre[0], (q.b[1] + q.b[3]) / 2 - centre[1]));
  const o = {
    type: v.type, centre: v.centre.map(r2),
    rues: v.rues.slice(0, 6).map((r) => ({ l: r.l, p: r.p.slice(0, 7) })),
    maisons: proches.slice(0, maisons).map((m) => ({ b: m.b, porte: m.portes[0], ...(m.portes.length > 1 ? { portes: m.portes.slice(1, 3) } : {}) })),
  };
  if (v.cloche) o.cloche = v.cloche;
  if (v.puits.length) o.puits = v.puits.map((p) => p.map(r2));
  if (v.fermes.length) o.fermes = v.fermes.map((f) => f.b);
  if (v.lampes.length) o.lampes = v.lampes.slice(0, 6).map((p) => p.map(r2));
  return o;
}
