// Effets de camera et transitions, calcules par image APRES la planification de la camera (anim.js) :
//   secousse  : bruit deterministe sur le cap, le tangage et un peu la position, qui s'eteint (amplitude, frequence, decay) ;
//   coupZoom  : coup de zoom (le champ de vue se ferme d'un coup puis revient en ralentissant) ;
//   roulis    : inclinaison de l'image (appliquee sur l'image finale : montage/effets-image.js) ;
//   flou      : flouFile (direction), flouRadial, flouAuto (vitesse reelle de la camera) ; profondeur de champ ;
//   transitions : fondu (par une couleur), flash, file (balayage : le cap tourne vite et l'image est floue de part et d'autre de la coupe).
// Resultat ecrit dans images[i] : camera (modifiee), roulis (degres), flou {force, angle, radial}, champ {dist, force, zone}, transition {couleur, alpha}.
import { evaluer } from '../film/scene.js';

const DT = 1 / 30, RAD = Math.PI / 180;
const lisse = (u) => u * u * (3 - 2 * u);

// Bruit de valeur deterministe : meme x -> meme valeur, lisse, entre -1 et 1.
function hache(n, graine) { let h = (n * 374761393 + graine * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296 * 2 - 1; }
export function bruit(x, graine = 0) { const i = Math.floor(x), f = x - i; return hache(i, graine) * (1 - lisse(f)) + hache(i + 1, graine) * lisse(f); }

// La scene a-t-elle quelque chose a faire ici ? (sinon on ne touche pas aux images : calcul d'avant)
export function effetsDeScene(scene) {
  return !!(scene.plans || scene.camera?.effets);
}

export function appliquerMontage(scene, images) {
  const n = images.length;
  const parNom = new Map(scene.acteurs.map((a, k) => [a.nom, k]));
  const plans = scene.plans ?? [];
  const planDe = (i) => plans.find((p) => i >= p.i0 && i < p.i1) ?? null;
  let precLacet = images[0].camera.lacet, precTangage = images[0].camera.tangage;
  for (let i = 0; i < n; i++) {
    const im = images[i], cam = im.camera, t = i * DT;
    const p = planDe(i);
    const specCam = p ? p.camera : scene.camera;
    const e = specCam?.effets;
    const tl = p ? t - p.de : t;   // temps du plan (les pistes d'un plan sont relatives a son debut)
    const lacetAvant = cam.lacet, tangageAvant = cam.tangage;   // vitesse de la camera planifiee, hors secousse
    if (e) {
      if (e.roulis) { const r = evaluer(e.roulis, tl)[0]; if (r) im.roulis = r; }
      if (e.secousse) {
        let a = 0, dl = 0, dtg = 0, dr = 0;
        for (const ev of e.secousse) {
          const [amp, freq, decay] = ev.v, x = tl - ev.t;
          if (x < 0 || x > decay * 6) continue;
          const k = amp * Math.exp(-x / decay);
          dl += k * bruit(x * freq, 11); dtg += k * bruit(x * freq, 23); dr += k * 0.02 * bruit(x * freq, 37); a += k;
        }
        if (a > 1e-4) { cam.lacet += dl; cam.tangage += dtg; cam.x += dr; cam.y += dr * bruit(tl * 9, 5); cam.z += dr * bruit(tl * 9, 6); }
      }
      let flou = null;
      const creer = () => (flou ??= { force: 0, angle: 0, radial: 0 });
      if (e.coupZoom) {
        let k = 0, fl = 0;
        for (const ev of e.coupZoom) {
          const [amp, dur, flouE] = ev.v, u = (tl - ev.t) / dur;
          if (u < 0 || u >= 1) continue;
          const kk = Math.pow(1 - u, 3); k = Math.max(k, amp * kk); fl = Math.max(fl, flouE * kk);
        }
        if (k > 0) cam.fov = cam.fov * (1 - k);
        if (fl > 0) creer().radial = fl;
      }
      if (e.flouFile) { const v = evaluer(e.flouFile, tl); if (v[0] > 0) { const f = creer(); f.force = v[0]; f.angle = v[1] ?? 0; } }
      if (e.flouRadial) { const v = evaluer(e.flouRadial, tl)[0]; if (v > 0) { const f = creer(); f.radial = Math.max(f.radial, v); } }
      if (e.flouAuto && i > 0 && !(p && i === p.i0)) {   // vitesse reelle de rotation de la camera : longueur du flou = deplacement de l'image pendant l'obturation
        const f = 0.5 / Math.tan((cam.fov * RAD) / 2);   // focale en hauteurs d'image
        const dy = ((lacetAvant - precLacet + 540) % 360 - 180) * RAD, dp = (tangageAvant - precTangage) * RAD;
        const vx = dy * f, vy = dp * f;   // hauteurs d'image par image
        const l = Math.hypot(vx, vy) * e.flouAuto;
        if (l > 0.004) { const fl = creer(); fl.force = Math.max(fl.force, Math.min(0.3, l)); fl.angle = Math.atan2(vy, vx) / RAD; fl.hauteur = true; }
      }
      if (flou) im.flou = flou;
      if (e.champ) {
        const f = evaluer(e.champ.force, tl)[0];
        if (f > 0.01) {
          let dist;
          if (e.champ.acteur) { const a = im.acteurs[parNom.get(e.champ.acteur)]; dist = Math.hypot(a.x - cam.x, a.y + 1.0 - cam.y, a.z - cam.z); }
          else dist = evaluer(e.champ.distance, tl)[0];
          im.champ = { dist, force: f, zone: e.champ.zone };
        }
      }
    }
    precLacet = lacetAvant; precTangage = tangageAvant;
  }
  // ---- transitions : a la coupe de chaque plan (limite = debut du plan)
  plans.forEach((p) => {
    if (p.transition === 'coupe') return;
    const B = p.i0, D = Math.max(2, Math.round(p.duree / DT)), demi = Math.max(1, Math.round(D / 2));
    const cible = (i) => (i >= 0 && i < n ? images[i] : null);
    if (p.transition === 'flash') {
      for (let j = 0; j < D; j++) { const im = cible(B + j); if (im) im.transition = { couleur: p.couleur, alpha: Math.pow(1 - j / D, 1.4) }; }
    } else if (p.transition === 'fondu') {
      for (let j = -demi; j < demi; j++) {
        const im = cible(B + j); if (!im) continue;
        const v = j < 0 ? (j + demi + 1) / (demi + 1) : 1 - (j + 1) / (demi + 1);
        im.transition = { couleur: p.couleur, alpha: Math.max(im.transition?.alpha ?? 0, Math.min(1, v)) };
      }
    } else if (p.transition === 'file') {
      const dir = p.direction * RAD;
      for (let j = -demi; j < demi; j++) {
        const im = cible(B + j); if (!im) continue;
        const v = j < 0 ? (j + demi + 1) / demi : (j - demi) / demi;   // vers 1 avant la coupe, de -1 a 0 apres
        const off = j < 0 ? v * v : -(v * v);
        im.camera.lacet += p.pan * Math.cos(dir) * off; im.camera.tangage -= p.pan * Math.sin(dir) * off;
        const force = p.force * (j < 0 ? v : -v);   // maximal a la coupe
        im.flou = { force: Math.max(im.flou?.force ?? 0, Math.max(0.01, force)), angle: p.direction, radial: im.flou?.radial ?? 0 };
      }
    }
  });
}
