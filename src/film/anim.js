// Animation d'une scene : pour chaque image (30 par seconde) calcule la pose de chaque acteur
// (position posee sur le sol, direction du corps, membres, tete) et la camera (avec anti-collision).
// La hauteur vient de la physique du jeu (physique.js : saut, marche d'escalier, chute, eau, echelle) ; les reactions automatiques
// du corps (reactions.js) s'ajoutent aux pistes et boucles de l'acteur.
import { evaluer, evaluerPhase, poidsBoucle } from './scene.js';
import { planifierCameraSuivi, planifierCameraLibre } from './camera.js';
import { compensationAppui, descenteBascule, decalageYeux } from '../perso/modele.js';
import { simulerActeur, creerSol, lisser01 } from './physique.js';
import { reactionsA } from './reactions.js';
import { valeurObjet } from './objets-scene.js';   // objets tenus et armure : pistes de changements d'un coup
import { appliquerCibles, aCibles } from './cibles.js';   // articulations libres : cibles des mains et des pieds (cinematique inverse)

const RAD = Math.PI / 180;
const DT = 1 / 30; // 30 images par seconde (IMAGES_PAR_SECONDE de scene.js)
const VITESSE_MARCHE_MINI = 1.0;     // en dessous : l'acteur est immobile (0,05 bloc par tick dans le jeu)
const ZERO2 = [0, 0];
const TEMPS_CAP = 0.2;               // secondes : la camera de suivi tourne un peu moins vite que le corps
const TEMPS_HAUTEUR_CAMERA = 0.3;    // secondes : la camera de suivi monte et descend un peu moins vite que l'acteur (sauts, chutes)

const normaliser180 = (a) => { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; };

// ---------------------------------------------------------------- pose d'un acteur au temps t (sans position)
function valeurPiste(piste, t, defaut) { return piste ? evaluer(piste, t) : defaut; }

// Temps du monde avec gel (voir docs/CONCEPTION.md, "Gel") : `gel` = intervalles [debut, fin] tries.
//   monde(x) : temps "ecoule dans le monde" = x moins les secondes gelees avant x (il ne bouge pas pendant un gel).
//   etat(t)  : { tw, fige } ; tw = t, ou le debut du gel quand t est dans un gel. Les boucles sont jugees (fenetre, fondu) a tw
//              et leur phase avance avec monde(tw) : pendant un gel la pose des boucles ne change plus du tout.
export function horlogeMonde(gel = []) {
  const monde = (x) => { let g = 0; for (const [a, b] of gel) { if (x > a) g += Math.min(x, b) - a; } return x - g; };
  const etat = (t) => { for (const [a, b] of gel) if (t >= a && t < b) return { tw: a, fige: true }; return { tw: t, fige: false }; };
  return { monde, etat };
}

// Somme des boucles actives pour une piste donnee. Retourne un tableau de `n` valeurs.
// `h` (facultatif) : { tw, monde } voir horlogeMonde ; sans lui, le temps normal.
function sommeBoucles(a, nom, t, n, h = null) {
  const s = new Array(n).fill(0);
  const tw = h ? h.tw : t;
  for (const b of a.boucles) {
    const piste = b.pistes[nom];
    if (!piste) continue;
    const w = poidsBoucle(b, tw);
    if (w <= 0) continue;
    const phase = h ? (h.monde(tw) - h.monde(b.de)) / b.periode : (t - b.de) / b.periode;
    const v = evaluerPhase(piste, phase);
    for (let i = 0; i < n; i++) s[i] += w * (v[i] ?? 0);
  }
  return s;
}

// f : facteur applique aux boucles (reactions : le balancement des jambes s'attenue en l'air)
function membre(a, nom, t, h, f = 1) {
  const base = a[nom] ? evaluer(a[nom], t) : ZERO2;
  const b = sommeBoucles(a, nom, t, 2, h);
  return [(base[0] ?? 0) + b[0] * f, (base[1] ?? 0) + b[1] * f];
}

// Flexion d'une articulation (coude, genou) en degres : piste + boucles (x f) + reaction, ramenee a 0..150.
function flexion(a, nom, t, h, f = 1, plus = 0) {
  const v = (a[nom] ? evaluer(a[nom], t)[0] : 0) + sommeBoucles(a, nom, t, 1, h)[0] * f + plus;
  return Math.min(150, Math.max(0, v));
}

// Piste + boucles d'une valeur seule (bascule, roulis, hauteur) ; 0 sans piste.
const aPiste = (a, nom) => !!a[nom] || a.boucles.some((b) => b.pistes[nom]);
const valeurSeule = (a, nom, t, h) => (a[nom] ? evaluer(a[nom], t)[0] : 0) + sommeBoucles(a, nom, t, 1, h)[0];

// Filtre d'ordre 1, avant puis arriere (phase nulle) : la hauteur lissee de la camera de suivi.
function lisserHauteur(suite, tau) {
  const a = 1 - Math.exp(-DT / tau);
  let cur = suite.slice();
  for (const sens of [1, -1]) {
    let v = cur[sens === 1 ? 0 : cur.length - 1];
    const sortie = cur.slice();
    for (let j = 0; j < cur.length; j++) { const i = sens === 1 ? j : cur.length - 1 - j; v += (cur[i] - v) * a; sortie[i] = v; }
    cur = sortie;
  }
  // loin de tout changement de hauteur (1,5 s), la valeur brute : la queue du filtre ne bouge plus la camera d'un micron
  const demi = Math.ceil(1.5 / DT);
  return cur.map((v, i) => {
    for (let j = Math.max(0, i - demi); j <= Math.min(suite.length - 1, i + demi); j++) if (suite[j] !== suite[i]) return v;
    return suite[i];
  });
}

// Skin actif au temps t : la reference de la derniere cle `skins` atteinte, ou null (= le champ `skin` de l'acteur).
function skinEn(a, t) {
  if (!a.skins) return null;
  let ref = null;
  for (const k of a.skins.cles) { if (k.t <= t) ref = k.ref; else break; }
  return ref;
}

// ---------------------------------------------------------------- animation complete
// scene : sortie de validerScene. terrain : { solEn(x,z), estLibre(x,y,z), bloc?(x,y,z), eauEn?(x,z) } (facultatif : sans terrain, sol a y=0
// et pas de collision). bloc et eauEn servent aux dalles, escaliers, echelles et a l'eau (physique.js).
// Retourne { images: [...], corrections (nombre d'images ou la camera a ete corrigee), notes, camera (stat des corrections), trajets }.
export function animer(scene, terrain = {}) {
  const estLibre = terrain.estLibre ?? (() => true);
  // solide pour la camera : seulement les blocs pleins (voir rendu/scene.js, estSolidePourCamera) ; a defaut, tout ce qui n'est pas libre
  const solide = terrain.solide ?? ((x, y, z) => !estLibre(x, y, z));
  const solFin = creerSol(terrain);
  const n = scene.images;
  const acteurs = scene.acteurs;
  const parNom = new Map(acteurs.map((a, i) => [a.nom, i]));
  const notes = [];
  const articule = acteurs.map((a) => ['coudeD', 'coudeG', 'genouD', 'genouG'].some((n) => a[n] || a.boucles.some((b) => b.pistes[n])) || aCibles(a));
  // corps [t, penche, cote, torsion] (plus d'une valeur) : le haut du corps entier tourne autour des hanches ; une seule valeur : le dos du jeu
  const etatsIK = acteurs.map(() => ({}));   // dernier pivot de coude de chaque membre tenu par une cible (continuite d'une image a l'autre)
  const corpsComplet = acteurs.map((a) => (a.corps?.arite ?? 1) > 1 || a.boucles.some((b) => (b.pistes.corps?.arite ?? 1) > 1));

  // Pied du joueur : plus haut sol sous les 4 coins et le centre (comme la boite du jeu), dalles et escaliers a leur vraie hauteur.
  const solSous = (x, z) => { const m = solFin.sous(x, z); return m ? m.y : null; };

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
  const parImage = [], infosImage = [];
  const gel = scene.gel ?? [];
  const horloge = horlogeMonde(gel);
  // physique verticale de chaque acteur (physique.js) : saut, marche d'escalier, chute, eau, echelle ; la piste pos donne l'horizontale
  const sims = acteurs.map((a) => simulerActeur({ piste: pistePos(a), terrain, duree: scene.duree, gel }));
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    const { tw, fige } = horloge.etat(t);
    // sans gel on garde exactement le calcul d'avant (h = null)
    const h = gel.length ? { tw, monde: horloge.monde } : null;
    infosImage.push({ fige, tm: gel.length ? horloge.monde(t) : t });
    parImage.push(acteurs.map((a, k) => {
      const e = etat[k];
      const p = evaluer(e.pistePos, t);
      const sim = sims[k];
      const tmA = infosImage[i].tm;                 // temps du monde (il ne passe pas pendant un gel)
      const st = sim.etatA(tmA);
      // le chemin horizontal est celui de pos, sauf quand un mur l'arrete (physique.js : obstacle)
      const x = sim.horizModifie ? st.x : p[0], z = sim.horizModifie ? st.z : p[2];
      // --- hauteur : imposee (cle a 3 valeurs), sinon physique du jeu (gravite 0,08, saut 0,42, pas de 0,6 : physique.js)
      const sol = solSous(x, z);
      const solY = sol ?? e.y;
      let auSol, imposee = false;
      if (Number.isFinite(p[1])) {
        e.y = p[1]; e.vy = 0; imposee = true;
        auSol = e.y <= solY + 0.05;
      } else { e.y = st.y; e.vy = st.vy; auSol = st.auSol; }

      // --- direction du corps
      let lacet;
      const dx = x - e.xPrec, dz = z - e.zPrec;
      if (!fige && i > 0 && Math.hypot(dx, dz) / DT > VITESSE_MARCHE_MINI && !a.lacet) {   // gel : le corps ne se retourne plus tout seul
        const cible = Math.atan2(-dx, dz) / RAD;
        e.lacet += normaliser180(cible - e.lacet) * (1 - Math.pow(0.7, 20 * DT)); // 0,3 par tick de 1/20 s, comme le jeu
      }
      e.xPrec = x; e.zPrec = z;
      if (a.lacet) lacet = evaluer(a.lacet, t)[0] + sommeBoucles(a, 'lacet', t, 1, h)[0];
      else lacet = e.lacet + sommeBoucles(a, 'lacet', t, 1, h)[0];

      // --- reactions automatiques (additives), membres, tete, buste
      const R = a.reactions && !imposee ? reactionsA(sim, tmA) : null;
      const fJ = R ? R.amortiJambes : 1, fB = R ? R.amortiBras : 1;
      const th = valeurPiste(a.tete, t, ZERO2);
      const tb = sommeBoucles(a, 'tete', t, 2, h);
      const corps = (a.corps ? evaluer(a.corps, t)[0] : 0) + sommeBoucles(a, 'corps', t, 1, h)[0] + (R ? R.corps : 0);
      const accroupi = a.accroupi ? Math.min(1, Math.max(0, evaluer(a.accroupi, t)[0])) : 0;
      const pose = {
        nom: a.nom, x, y: e.y, z, sol: solY, auSol, lacet,
        tete: [th[0] + tb[0], th[1] + tb[1]], penche: corps, accroupi,
        brasD: membre(a, 'brasD', t, h, fB), brasG: membre(a, 'brasG', t, h, fB), jambeD: membre(a, 'jambeD', t, h, fJ), jambeG: membre(a, 'jambeG', t, h, fJ),
      };
      if (R) { pose.brasD[0] += R.bras; pose.brasG[0] += R.bras; pose.jambeD[0] += R.jambe; pose.jambeG[0] += R.jambe; }
      // articulations libres (additif) : torsion des membres, roulis de la tete, haut du corps entier ; rien n'est ajoute sans elles
      for (const [nom, f] of [['brasD', fB], ['brasG', fB], ['jambeD', fJ], ['jambeG', fJ]]) {
        const tors = (a[nom] ? (evaluer(a[nom], t)[2] ?? 0) : 0) + sommeBoucles(a, nom, t, 3, h)[2] * f;
        if (tors) pose[nom][2] = tors;
      }
      const roulisTete = (a.tete ? (evaluer(a.tete, t)[2] ?? 0) : 0) + sommeBoucles(a, 'tete', t, 3, h)[2];
      if (roulisTete) pose.tete[2] = roulisTete;
      if (corpsComplet[k]) {
        const cs = a.corps ? evaluer(a.corps, t) : [], sb = sommeBoucles(a, 'corps', t, 3, h);
        pose.troncComplet = true; pose.troncCote = (cs[1] ?? 0) + sb[1]; pose.troncTorsion = (cs[2] ?? 0) + sb[2];
      }
      if (st.eau && !imposee) pose.eau = true;
      if (st.echelle && !imposee) pose.echelle = true;
      // orientation du corps entier et decalage vertical (pistes facultatives : rien n'est ajoute sans elles)
      const clamp180 = (v) => Math.max(-180, Math.min(180, v));
      const bascule = aPiste(a, 'bascule') ? clamp180(valeurSeule(a, 'bascule', t, h)) : 0;
      const roulis = aPiste(a, 'roulis') ? clamp180(valeurSeule(a, 'roulis', t, h)) : 0;
      let hauteur = aPiste(a, 'hauteur') ? valeurSeule(a, 'hauteur', t, h) : 0;
      const incline = Math.max(Math.abs(bascule), Math.abs(roulis));
      // dans l'eau le corps couche flotte plus haut (les hanches a la surface)
      if (pose.eau && incline) hauteur += 0.35 * Math.sin(Math.min(90, incline) * RAD);
      if (bascule) pose.bascule = bascule;
      if (roulis) pose.roulis = roulis;
      if (hauteur) pose.hauteur = hauteur;
      // articulations : champs ajoutes seulement s'il y en a (sans elles la pose est celle d'avant)
      const plie = R && (R.genou > 0.01 || R.coude > 0.01);
      if (articule[k] || plie) {
        const g = R ? R.genou : 0, c = R ? R.coude : 0;
        pose.coudeD = flexion(a, 'coudeD', t, h, fB, c); pose.coudeG = flexion(a, 'coudeG', t, h, fB, c);
        pose.genouD = flexion(a, 'genouD', t, h, fJ, g); pose.genouG = flexion(a, 'genouG', t, h, fJ, g);
      }
      // cibles des pieds (cinematique inverse) : avant l'appui, qui pose ensuite le pied le plus bas sur le sol
      const fk = {}, ciblesPieds = aCibles(a) ? appliquerCibles(a, pose, t, evaluer, 'jambes', fk, etatsIK[k]) : 0;
      if (articule[k] || plie || incline) {
        // appui : le corps s'ajuste pour que le pied le plus bas repose sur le sol (modele.js, compensationAppui). Poids 1 au sol,
        // decroissant jusqu'a 0 quand l'acteur s'eleve de 2 a 12 cm (saut, chute) : en l'air les pieds ne sont plus attires par le sol.
        // Il s'efface quand le corps est couche (de 15 a 45 degres d'inclinaison) : la bascule pose alors le corps sur ses points bas.
        const poids = Math.max(0, Math.min(1, 1 - (e.y - solY - 0.02) / 0.10));
        const droit = 1 - lisser01((incline - 15) / 30);
        if (a.appui && (pose.genouD > 0 || pose.genouG > 0) && droit > 0) {
          // appui numerique (0..1) : seule la descente est reduite (jambes ecartees, pieds au-dessus du sol : le corps reste plus haut
          // et le pied flotte, c'est la phase aerienne d'une course) ; la montee (pointe sous le sol) reste entiere.
          const dy0 = compensationAppui(pose, 0.12 + (R ? R.descente : 0));
          pose.dy = poids * droit * (typeof a.appui === 'number' && dy0 < 0 ? dy0 * a.appui : dy0);
        }
        if (incline && !pose.eau) {
          const d = poids * descenteBascule(bascule, roulis);
          if (d) pose.dy = (pose.dy ?? 0) + d;
        }
      }
      // cibles des mains (apres l'appui : le corps a sa hauteur definitive) ; les pieds sont repris si l'appui a deplace le corps
      if (aCibles(a)) { if (ciblesPieds && pose.dy) appliquerCibles(a, pose, t, evaluer, 'jambes', fk, etatsIK[k]); appliquerCibles(a, pose, t, evaluer, 'bras', fk, etatsIK[k]); }
      // apparence (pistes facultatives : rien n'est ajoute si elles manquent)
      const sk = skinEn(a, t);
      if (sk) pose.skin = sk;
      if (a.horsImage) pose.horsImage = evaluer(a.horsImage, t)[0] >= 0.5;
      if (a.lueur) pose.lueur = evaluer(a.lueur, t)[0];
      // objets tenus et armure (champs facultatifs : rien n'est ajoute sans eux)
      for (const [champ, piste] of [['objetD', a.objetD], ['objetG', a.objetG]]) { const id = piste ? valeurObjet(piste, t) : null; if (id) pose[champ] = id; }
      if (a.armure) { let arm = null; for (const [e, piste] of Object.entries(a.armure)) { const id = valeurObjet(piste, t); if (id) (arm ??= {})[e] = id; } if (arm) pose.armure = arm; }
      return pose;
    }));
  }

  // ---- passe 2 : camera (on connait tout le film : planification sur tout le plan, voir camera.js)
  const c = scene.camera;
  const yeux = (p) => {
    if (!p.bascule && !p.roulis && !p.hauteur && !p.troncComplet) return [p.x, p.y + 1.62 - 0.35 * p.accroupi, p.z];   // corps droit : la formule d'avant, au bit pres
    const [ox, oy, oz] = decalageYeux(p);
    return [p.x + ox, p.y + oy, p.z + oz];
  };
  const pos = new Array(n), cible = new Array(n);
  let corrigee = new Array(n).fill(false);
  let statCamera = null;
  if (c.mode === 'suit') {
    const k = parNom.get(c.suit);
    let cap = parImage[0][k].lacet;   // direction suivie par la camera : celle du corps, un peu adoucie
    // hauteur de reference de la camera : celle de l'acteur, adoucie (sauts, chutes, marches : la camera ne saute pas avec lui)
    const ys = parImage.map((poses) => poses[k].y);
    const ysLisse = lisserHauteur(ys, TEMPS_HAUTEUR_CAMERA);
    const voulues = parImage.map((poses, i) => {
      const A = poses[k];
      cap += normaliser180(A.lacet - cap) * (1 - Math.exp(-DT / TEMPS_CAP));
      const [droite, haut, arriere] = evaluer(c.decalage, i * DT);
      const psi = cap * RAD, fx = -Math.sin(psi), fz = Math.cos(psi);
      cible[i] = yeux(A);
      return [A.x - fz * droite - fx * arriere, ysLisse[i] + haut, A.z + fx * droite - fz * arriere];
    });
    const plan = planifierCameraSuivi({ cibles: cible, voulues, solide, dt: DT });
    for (let i = 0; i < n; i++) pos[i] = plan.pos[i];
    corrigee = plan.corrigee; statCamera = plan.stat;
    if (plan.vueCoupee > 0.5 / DT) notes.push(`camera : acteur cache par un bloc pendant ${(plan.vueCoupee * DT).toFixed(1).replace('.', ',')} s malgre les corrections`);
  } else {
    const voulues = [];
    for (let i = 0; i < n; i++) {
      const t = i * DT;
      voulues.push(Array.from(evaluer(c.pos, t)));
      cible[i] = c.regarde ? yeux(parImage[i][parNom.get(c.regarde)]) : Array.from(evaluer(c.cible, t));
    }
    const plan = planifierCameraLibre({ positions: voulues, cibles: cible, solide, dt: DT });
    for (let i = 0; i < n; i++) pos[i] = plan.pos[i];
    corrigee = plan.corrigee; statCamera = plan.stat;
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
    images.push({ t, fige: infosImage[i].fige, tm: infosImage[i].tm, acteurs: parImage[i], camera: { x: pos[i][0], y: pos[i][1], z: pos[i][2], lacet: lacetCam, tangage: tangageCam, fov: evaluer(c.fov, t)[0] }, corrigee: corrigee[i] });
  }
  return { images, corrections, notes, camera: statCamera, sims };
}

// Piste [x, y, z] d'un acteur ; y vaut NaN quand la cle n'impose pas la hauteur.
function pistePos(a) {
  return { arite: 3, cles: a.pos.cles.map((k) => ({ t: k.t, v: [k.x, k.y, k.z], l: k.l })) };
}
