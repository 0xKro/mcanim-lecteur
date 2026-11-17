// Ancrages des incrustations : point de l'ecran (coordonnees normalisees) ou point du MONDE projete a chaque image avec la camera du film
// (meme repere que le rasteriseur : rendu/raster.js, base()). Cache par le terrain (rayon) ou par le tampon de profondeur (1/w).
const RAD = Math.PI / 180;

// Base de la camera : avant f, droite r, haut u (comme raster.js).
export function baseCamera(cam) {
  const yaw = (cam.lacet ?? 0) * RAD, pit = (cam.tangage ?? 0) * RAD, cp = Math.cos(pit);
  const fx = -Math.sin(yaw) * cp, fy = -Math.sin(pit), fz = Math.cos(yaw) * cp;
  let rx = -fz, rz = fx; const n = Math.hypot(rx, rz) || 1; rx /= n; rz /= n;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  return { fx, fy, fz, rx, rz, ux, uy, uz };
}

// Roulis de l'image (degres) : l'image est tournee autour du centre puis agrandie pour remplir le cadre. Retourne { c, s, k } ou null.
export function transformRoulis(deg, W, H) {
  if (!deg) return null;
  const a = deg * RAD, c = Math.cos(a), s = Math.sin(a);
  const k = Math.abs(c) + Math.max(W / H, H / W) * Math.abs(s);   // agrandissement qui couvre les coins
  return { c, s, k, deg };
}

// Projecteur d'une image : p = [x, y, z] du monde -> { x, y (pixels de l'image finale), w (profondeur le long de l'axe de vue), f (focale en pixels) } ou null si derriere.
export function creerProjecteur(cam, W, H, roulis = null) {
  const B = baseCamera(cam);
  const f = (H / 2) / Math.tan(((cam.fov ?? 70) * RAD) / 2);
  const proche = 0.05;
  const projeter = (p) => {
    const dx = p[0] - cam.x, dy = p[1] - cam.y, dz = p[2] - cam.z;
    const w = dx * B.fx + dy * B.fy + dz * B.fz;
    if (w < proche) return null;
    const xv = dx * B.rx + dz * B.rz, yv = dx * B.ux + dy * B.uy + dz * B.uz;
    let x = W / 2 + (xv / w) * f, y = H / 2 - (yv / w) * f;
    if (roulis) {   // meme transformation que l'image : rotation autour du centre puis agrandissement
      const ex = x - W / 2, ey = y - H / 2;
      x = W / 2 + (ex * roulis.c - ey * roulis.s) * roulis.k; y = H / 2 + (ex * roulis.s + ey * roulis.c) * roulis.k;
    }
    return { x, y, w, f: f * (roulis ? roulis.k : 1) };
  };
  // segment a -> b recoupe au plan proche (coordonnees monde) ; retourne [a', b'] ou null
  const recouper = (a, b) => {
    const wa = (a[0] - cam.x) * B.fx + (a[1] - cam.y) * B.fy + (a[2] - cam.z) * B.fz, wb = (b[0] - cam.x) * B.fx + (b[1] - cam.y) * B.fy + (b[2] - cam.z) * B.fz;
    if (wa < proche && wb < proche) return null;
    const cut = (p, q, wp, wq) => { const u = (proche + 0.001 - wp) / (wq - wp); return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u]; };
    if (wa < proche) return [cut(a, b, wa, wb), b];
    if (wb < proche) return [a, cut(b, a, wb, wa)];
    return [a, b];
  };
  return { projeter, recouper, f, base: B };
}

// Le point (sx, sy) de l'image, a la profondeur `w`, est-il devant la surface dessinee ? prof : { donnees: Float32Array (1/w, 0 = ciel), W, H, ssaa }.
// Tolerance en blocs : la surface peut etre un peu devant (corps de l'acteur ancre, bloc contre lequel on pose un libelle).
export function visibleParProfondeur(prof, sx, sy, w, tol = 0.6) {
  const q = prof.ssaa ?? 1, X = Math.round(sx * q - 0.5), Y = Math.round(sy * q - 0.5);
  const W = prof.W, H = prof.H;
  if (X < 0 || Y < 0 || X >= W || Y >= H) return true;
  let vu = 0;
  // 3 x 3 : un point est visible s'il l'est sur au moins un voisin (un fil, un bord ne cache pas tout)
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const x = X + i * q, y = Y + j * q; if (x < 0 || y < 0 || x >= W || y >= H) { vu++; continue; }
    const iw = prof.donnees[y * W + x];
    if (iw === 0 || 1 / iw >= w - tol) vu++;
  }
  return vu >= 2;
}

// Le segment camera -> p traverse-t-il un bloc plein ? `solide(x, y, z)` (terrain). On s'arrete a `marge` blocs du point.
export function visibleParTerrain(solide, cam, p, marge = 0.45, pas = 0.35) {
  const dx = p[0] - cam.x, dy = p[1] - cam.y, dz = p[2] - cam.z, D = Math.hypot(dx, dy, dz);
  for (let s = 0.6; s < D - marge; s += pas) { const q = s / D; if (solide(cam.x + dx * q, cam.y + dy * q, cam.z + dz * q)) return false; }
  return true;
}
