// Port de Horizon (client/mobs/keyframes.rs, MIT), voir ATTRIBUTIONS.md
// Animations a images cles (KeyframeAnimation) au format compact du fichier creatures :
//   { d: duree (s), b: 1 si en boucle, os: { nomOs: [ [cible (0 rotation, 1 position, 2 echelle), images], ... ] } }
//   image : [t, x, y, z] (lineaire, avant == apres) ou [t, avX, avY, avZ, apX, apY, apZ, cat] (cat 1 = catmullrom).
// Les valeurs s'AJOUTENT a la pose de chaque os (offsetPos / offsetRotation / offsetScale).

const avant = (k, i) => k[1 + i];
const apres = (k, i) => (k.length > 4 ? k[4 + i] : k[1 + i]);
const catmull = (k) => k.length > 7 && k[7] === 1;

function catmullrom(t, p0, p1, p2, p3) {
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
}

// KeyframeAnimation.Entry.apply : valeur d'un canal a `sec` secondes.
export function echantillon(k, sec, echelle, out = [0, 0, 0]) {
  const n = k.length;
  if (!n) { out[0] = out[1] = out[2] = 0; return out; }
  // Mth.binarySearch(0, n, i -> sec <= k[i].t) - 1, borne a 0
  let lo = 0, hi = n;
  while (lo < hi) { const mi = (lo + hi) >> 1; if (sec <= k[mi][0]) hi = mi; else lo = mi + 1; }
  const prec = Math.max(0, lo - 1);
  const suiv = Math.min(prec + 1, n - 1);
  const delta = sec - k[prec][0];
  let a = 0;
  if (suiv !== prec) { a = delta / (k[suiv][0] - k[prec][0]); a = a < 0 ? 0 : a > 1 ? 1 : a; }
  if (catmull(k[suiv])) {
    const k0 = k[Math.max(0, prec - 1)], k1 = k[prec], k2 = k[suiv], k3 = k[Math.min(suiv + 1, n - 1)];
    for (let i = 0; i < 3; i++) out[i] = catmullrom(a, apres(k0, i), apres(k1, i), apres(k2, i), apres(k3, i)) * echelle;
  } else {
    for (let i = 0; i < 3; i++) { const x = apres(k[prec], i); out[i] = (x + (avant(k[suiv], i) - x) * a) * echelle; }
  }
  return out;
}

// KeyframeAnimation.apply(millis, scale)
export function appliquer(anim, millis, echelle, P) {
  if (!anim) return;
  let sec = millis / 1000;
  if (anim.b && anim.d > 0) sec %= anim.d;
  const v = [0, 0, 0];
  for (const os in anim.os) {
    for (const [cible, images] of anim.os[os]) {
      echantillon(images, sec, echelle, v);
      const p = P.get(os), o = cible === 1 ? 0 : cible === 2 ? 6 : 3;
      p[o] += v[0]; p[o + 1] += v[1]; p[o + 2] += v[2];
    }
  }
}

// KeyframeAnimation.applyWalk(pos, speed, speedFactor, scaleFactor)
export function appliquerMarche(anim, pos, vitesse, facteurVitesse, facteurEchelle, P) {
  appliquer(anim, Math.trunc(pos * 50 * facteurVitesse), Math.min(vitesse * facteurEchelle, 1), P);
}
