// Animation d'une scene : pour chaque image (30 par seconde) calcule la pose de chaque acteur
// (position posee sur le sol, direction du corps, membres, tete) et la camera (avec anti-collision).
import { evaluer, evaluerPhase, poidsBoucle } from './scene.js';

const RAD = Math.PI / 180;
const DT = 1 / 30; // 30 images par seconde (IMAGES_PAR_SECONDE de scene.js)
const HAUTEUR_YEUX = 1.62;
const BAISSE_YEUX_ACCROUPI = 0.35;   // yeux a 1,27 accroupi
const RAYON_PIED = 0.3;              // demi-largeur du joueur (0,6)
const GRAVITE = 32;                  // blocs/s^2 (0,08 par tick^2)
const VITESSE_MONTEE = 10;           // blocs/s au plus quand on monte sur une marche
const VITESSE_MARCHE_MINI = 1.0;     // en dessous : l'acteur est immobile (0,05 bloc par tick dans le jeu)
const ZERO2 = [0, 0];
const TEMPS_CAP = 0.2;               // secondes : la camera de suivi tourne un peu moins vite que le corps

const normaliser180 = (a) => { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; };

// ---------------------------------------------------------------- pose d'un acteur au temps t (sans position)
function valeurPiste(piste, t, defaut) { return piste ? evaluer(piste, t) : defaut; }

// Somme des boucles actives pour une piste donnee. Retourne un tableau de `n` valeurs.
function sommeBoucles(a, nom, t, n) {
  const s = new Array(n).fill(0);
  for (const b of a.boucles) {
    const piste = b.pistes[nom];
    if (!piste) continue;
    const w = poidsBoucle(b, t);
    if (w <= 0) continue;
    const v = evaluerPhase(piste, (t - b.de) / b.periode);
    for (let i = 0; i < n; i++) s[i] += w * (v[i] ?? 0);
  }
  return s;
}

function membre(a, nom, t) {
  const base = a[nom] ? evaluer(a[nom], t) : ZERO2;
  const b = sommeBoucles(a, nom, t, 2);
  return [(base[0] ?? 0) + b[0], (base[1] ?? 0) + b[1]];
}

// ---------------------------------------------------------------- animation complete
// scene : sortie de validerScene. terrain : { solEn(x,z), estLibre(x,y,z) } (facultatif : sans terrain, sol a y=0 et pas de collision).
// Retourne { images: [...], corrections, notes }.
export function animer(scene, terrain = {}) {
  const solEn = terrain.solEn ?? (() => 0);
  const estLibre = terrain.estLibre ?? (() => true);
  const n = scene.images;
  const acteurs = scene.acteurs;
  const parNom = new Map(acteurs.map((a, i) => [a.nom, i]));
  const notes = [];

  // Pied du joueur : plus haut sol sous les 4 coins et le centre (comme la boite du jeu).
  const solSous = (x, z) => {
    let m = null;
    for (const [dx, dz] of [[0, 0], [-RAYON_PIED, -RAYON_PIED], [RAYON_PIED, -RAYON_PIED], [-RAYON_PIED, RAYON_PIED], [RAYON_PIED, RAYON_PIED]]) {
      const y = solEn(x + dx, z + dz);
      if (y !== null && y !== undefined && (m === null || y > m)) m = y;
    }
    return m;
  };

  // Etat de chaque acteur, avance image par image.
  const etat = acteurs.map((a) => {
    const p0 = evaluer({ arite: 3, cles: a.pos.cles.map((k) => ({ t: k.t, v: [k.x, k.y, k.z], l: k.l })) }, 0);
    // direction initiale du corps : celle du premier deplacement net (le personnage demarre deja tourne vers sa route)
    let lacet = 0;
    const piste = pistePos(a);
    const tmp = [0, 0, 0], tmp2 = [0, 0, 0];
    for (let i = 1; i < n; i++) {
      evaluer(piste, i * DT, tmp); evaluer(piste, (i - 1) * DT, tmp2);
      const dx = tmp[0] - tmp2[0], dz = tmp[2] - tmp2[2];
      if (Math.hypot(dx, dz) / DT > VITESSE_MARCHE_MINI) { lacet = Math.atan2(-dx, dz) / RAD; break; }
    }
    const sol = solSous(p0[0], p0[2]);
    return { y: Number.isFinite(p0[1]) ? p0[1] : (sol ?? 0), vy: 0, lacet, xPrec: p0[0], zPrec: p0[2], pistePos: piste };
  });

  // ---- passe 1 : acteurs, image par image (l'etat avance avec le temps)
  const parImage = [];
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    parImage.push(acteurs.map((a, k) => {
      const e = etat[k];
      const p = evaluer(e.pistePos, t);
      const x = p[0], z = p[2];
      // --- hauteur : imposee (cle a 3 valeurs) ou posee sur le sol avec lissage
      const sol = solSous(x, z);
      const solY = sol ?? e.y;
      let auSol;
      if (Number.isFinite(p[1])) {
        e.y = p[1]; e.vy = 0;
        auSol = e.y <= solY + 0.05;
      } else if (i === 0) {
        e.y = solY; e.vy = 0; auSol = true;
      } else if (solY > e.y) {            // marche a monter : on monte vite mais pas d'un coup
        const diff = solY - e.y;
        e.y += Math.min(diff, Math.max(diff * (1 - Math.exp(-DT * 25)), 0), VITESSE_MONTEE * DT);
        e.vy = 0; auSol = solY - e.y < 0.05;
      } else if (solY < e.y - 1e-6) {     // vide : on tombe avec la gravite
        e.vy -= GRAVITE * DT;
        e.y = Math.max(solY, e.y + e.vy * DT);
        if (e.y === solY) e.vy = 0;
        auSol = e.y - solY < 0.05;
      } else { e.y = solY; e.vy = 0; auSol = true; }

      // --- direction du corps
      let lacet;
      const dx = x - e.xPrec, dz = z - e.zPrec;
      if (i > 0 && Math.hypot(dx, dz) / DT > VITESSE_MARCHE_MINI && !a.lacet) {
        const cible = Math.atan2(-dx, dz) / RAD;
        e.lacet += normaliser180(cible - e.lacet) * (1 - Math.pow(0.7, 20 * DT)); // 0,3 par tick de 1/20 s, comme le jeu
      }
      e.xPrec = x; e.zPrec = z;
      if (a.lacet) lacet = evaluer(a.lacet, t)[0] + sommeBoucles(a, 'lacet', t, 1)[0];
      else lacet = e.lacet + sommeBoucles(a, 'lacet', t, 1)[0];

      // --- membres, tete, buste
      const th = valeurPiste(a.tete, t, ZERO2);
      const tb = sommeBoucles(a, 'tete', t, 2);
      const corps = (a.corps ? evaluer(a.corps, t)[0] : 0) + sommeBoucles(a, 'corps', t, 1)[0];
      const accroupi = a.accroupi ? Math.min(1, Math.max(0, evaluer(a.accroupi, t)[0])) : 0;
      return {
        nom: a.nom, x, y: e.y, z, sol: solY, auSol, lacet,
        tete: [th[0] + tb[0], th[1] + tb[1]], penche: corps, accroupi,
        brasD: membre(a, 'brasD', t), brasG: membre(a, 'brasG', t), jambeD: membre(a, 'jambeD', t), jambeG: membre(a, 'jambeG', t),
      };
    }));
  }

  // ---- passe 2 : camera (on connait tout le film : les corrections sont adoucies A L'AVANCE, sans saccade)
  const c = scene.camera;
  const yeux = (p) => [p.x, p.y + HAUTEUR_YEUX - BAISSE_YEUX_ACCROUPI * p.accroupi, p.z];
  const pos = new Array(n), cible = new Array(n), corrigee = new Array(n).fill(false);
  if (c.mode === 'suit') {
    const k = parNom.get(c.suit);
    let cap = parImage[0][k].lacet;   // direction suivie par la camera : celle du corps, un peu adoucie
    const brut = parImage.map((poses, i) => {
      const A = poses[k];
      cap += normaliser180(A.lacet - cap) * (1 - Math.exp(-DT / TEMPS_CAP));
      const [droite, haut, arriere] = evaluer(c.decalage, i * DT);
      const psi = cap * RAD, fx = -Math.sin(psi), fz = Math.cos(psi);
      cible[i] = yeux(A);
      return { p: [A.x - fz * droite - fx * arriere, A.y + haut, A.z + fx * droite - fz * arriere], yPieds: A.y };
    });
    // distance libre le long du rayon tete -> camera
    const permisDe = (i, p) => {
      const o = cible[i];
      const d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
      const D = Math.hypot(...d);
      for (let s = 0.6; s <= D + 1e-9; s += 0.15) {
        const q = Math.min(s, D) / D;
        if (!libreEpais(estLibre, o[0] + d[0] * q, o[1] + d[1] * q, o[2] + d[2] * q)) return { D, d, permis: Math.max(0.6, s - 0.3) };
      }
      return { D, d, permis: D };
    };
    // 1) feuillage au-dessus : on essaie de BAISSER la camera
    const besoinBaisse = brut.map((b, i) => {
      if (permisDe(i, b.p).permis >= permisDe(i, b.p).D - 1e-9) return 0;
      const maxBaisse = Math.max(0, b.p[1] - (b.yPieds + 0.8));
      for (let h = 0.25; h <= maxBaisse + 1e-9; h += 0.25) {
        const r = permisDe(i, [b.p[0], b.p[1] - h, b.p[2]]);
        if (r.permis >= r.D - 1e-9) return h;
      }
      return 0;
    });
    const baisse = adoucir(besoinBaisse);
    const abaisses = brut.map((b, i) => [b.p[0], b.p[1] - baisse[i], b.p[2]]);
    // 2) il reste un obstacle : on RAPPROCHE la camera de la tete
    const rayons = abaisses.map((p, i) => permisDe(i, p));
    const recul = adoucir(rayons.map((r) => r.D - r.permis));
    for (let i = 0; i < n; i++) {
      const r = rayons[i];
      const Dc = Math.max(0.6, r.D - recul[i]);
      const q = r.D > 1e-6 ? Math.min(1, Dc / r.D) : 1;
      pos[i] = [cible[i][0] + r.d[0] * q, cible[i][1] + r.d[1] * q, cible[i][2] + r.d[2] * q];
      corrigee[i] = baisse[i] > 0.02 || recul[i] > 0.02;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const t = i * DT;
      pos[i] = Array.from(evaluer(c.pos, t));
      cible[i] = c.regarde ? yeux(parImage[i][parNom.get(c.regarde)]) : Array.from(evaluer(c.cible, t));
      const corr = corrigerCameraLibre(pos[i], cible[i], estLibre);
      if (corr) { pos[i] = corr; corrigee[i] = true; }
    }
  }

  // ---- images finales : orientation de la camera vers la cible
  const images = [];
  let corrections = 0, lacetCam = 0, tangageCam = 0;
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    const dx = cible[i][0] - pos[i][0], dy = cible[i][1] - pos[i][1], dz = cible[i][2] - pos[i][2];
    const h = Math.hypot(dx, dz);
    if (h > 1e-6 || Math.abs(dy) > 1e-6) {
      if (h > 1e-6) lacetCam = Math.atan2(-dx, dz) / RAD;
      tangageCam = Math.atan2(-dy, h) / RAD;
    }
    if (corrigee[i]) corrections++;
    images.push({ t, acteurs: parImage[i], camera: { x: pos[i][0], y: pos[i][1], z: pos[i][2], lacet: lacetCam, tangage: tangageCam, fov: evaluer(c.fov, t)[0] }, corrigee: corrigee[i] });
  }
  return { images, corrections, notes };
}

// Adoucit une correction de camera sans jamais la rendre plus petite que le besoin :
// maximum glissant (un peu en avance : on commence a s'ecarter avant l'obstacle), puis moyenne glissante.
function adoucir(besoin, avant = 8, apres = 12, demi = 6) {
  const n = besoin.length;
  const cl = (i) => Math.min(n - 1, Math.max(0, i));
  const m = besoin.map((_, i) => { let v = 0; for (let j = i - avant; j <= i + apres; j++) v = Math.max(v, besoin[cl(j)]); return v; });
  return m.map((_, i) => { let s = 0; for (let j = i - demi; j <= i + demi; j++) s += m[cl(j)]; return s / (2 * demi + 1); });
}

// Piste [x, y, z] d'un acteur ; y vaut NaN quand la cle n'impose pas la hauteur.
function pistePos(a) {
  return { arite: 3, cles: a.pos.cles.map((k) => ({ t: k.t, v: [k.x, k.y, k.z], l: k.l })) };
}

// Point libre avec une petite marge autour (la camera n'est pas un point).
function libreEpais(estLibre, x, y, z, m = 0.15) {
  return estLibre(x, y, z) && estLibre(x + m, y, z) && estLibre(x - m, y, z) && estLibre(x, y, z + m) && estLibre(x, y, z - m) && estLibre(x, y + m, z) && estLibre(x, y - m, z);
}

// Camera libre : si elle est dans un bloc, ou si l'obstacle est collé a elle, on la rapproche de la cible,
// puis on la monte si cela ne suffit pas. Retourne la nouvelle position, ou null si rien a corriger.
function corrigerCameraLibre(pos, cible, estLibre) {
  const d = [cible[0] - pos[0], cible[1] - pos[1], cible[2] - pos[2]];
  const D = Math.hypot(...d);
  const u = D > 1e-6 ? d.map((v) => v / D) : [0, 0, 1];
  const librePres = (p) => libreEpais(estLibre, p[0], p[1], p[2], 0.1)
    && [0.15, 0.3].every((s) => estLibre(p[0] + u[0] * s, p[1] + u[1] * s, p[2] + u[2] * s));
  if (librePres(pos)) return null;
  for (let s = 0.1; s <= Math.max(0, D - 0.5); s += 0.1) {
    const p = [pos[0] + u[0] * s, pos[1] + u[1] * s, pos[2] + u[2] * s];
    if (librePres(p)) return p;
  }
  for (let h = 0.25; h <= 8; h += 0.25) {
    const p = [pos[0], pos[1] + h, pos[2]];
    if (librePres(p)) return p;
  }
  return null;
}
