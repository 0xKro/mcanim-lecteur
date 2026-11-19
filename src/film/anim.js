// Animation d'une scene : pour chaque image (30 par seconde) calcule la pose de chaque acteur
// (position posee sur le sol, direction du corps, membres, tete) et la camera (avec anti-collision).
// La hauteur vient de la physique du jeu (physique.js : saut, marche d'escalier, chute, eau, echelle) ; les reactions automatiques
// du corps (reactions.js) s'ajoutent aux pistes et boucles de l'acteur.
import { evaluer, evaluerPhase, poidsBoucle } from './scene.js';
import { appliquerCreatures, boiteDe } from './creatures.js';   // creatures (champ `type`) et montures
import { VEHICULES as VEHICULES_MARCHE } from '../creatures/especes.js';   // vehicules : seuil de marche des joueurs
import { planifierCameraSuivi, planifierCameraLibre } from './camera.js';
import { compensationAppui, descenteBascule, decalageYeux } from '../perso/modele.js';
import { simulerActeur, creerSol, lisser01 } from './physique.js';
import { reactionsA } from './reactions.js';
import { creerVivant, rotationVol, rotationVrille } from './acteurs-vivants.js';   // acteurs commandes par la simulation (champ `actes`) : leur trace dans le replay
import { appliquerPantins } from './ragdoll.js';   // pantin des explosions (regle explosion.ragdoll)
import { creerFige } from './fige.js';   // acteur fige seul : horloges propres
import { sujetsDuPlan, masquageSujets, noteSujetCache, SEUIL_CACHE } from './sujet-visible.js';   // le sujet du plan est-il cache par un bloc ? (correction + note)
import { notesObstruction } from './obstruction.js';   // camera : herbe, feuilles ou acteur colles a l'objectif (note, sans correction)
import { valeurObjet, pileObjet } from './objets-scene.js';
import { aReflet, galonDe } from '../objets/reflet.js';   // objets tenus et armure : pistes de changements d'un coup
import { appliquerCibles, aCibles } from './cibles.js';   // articulations libres : cibles des mains et des pieds (cinematique inverse)
import { carteTemps } from '../montage/temps.js';   // montage : ralenti, accelere, arret du temps du monde par plan (facultatif)
import { ajouterJeu, gesteAvecCoude, marcheAutoPossible, avancerMarche, poseMarche } from '../montage/jeu.js';   // montage : vie des acteurs au repos et gestes sur mots cles (facultatif)
import { cameraDeCadre, reserverTitres } from '../montage/cadrage.js';
import { rectSur } from '../montage/zones.js';   // montage : cadrage par intention (plan moyen, rapproche...)
import { appliquerMontage, effetsDeScene } from '../montage/effets-camera.js';   // montage : secousse, coup de zoom, roulis, flous, transitions (facultatif)

const RAD = Math.PI / 180;
const DT = 1 / 30; // 30 images par seconde (IMAGES_PAR_SECONDE de scene.js)
const VITESSE_MARCHE_MINI = 1.0;     // en dessous : l'acteur est immobile (0,05 bloc par tick dans le jeu)
// creatures : MoveControl tourne le corps vers sa destination a toute vitesse (une vache marche a 1,7 bloc/s, un golem a 1,3) ; vehicules exclus
const VITESSE_MINI_CREATURE = 0.1;
const seuilMarche = (a) => (a.creature && !VEHICULES_MARCHE.has(a.creature.type) ? VITESSE_MINI_CREATURE : VITESSE_MARCHE_MINI);
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

// Phase (0..1 et plus) d'une boucle au temps t : (t - de) / periode + phase0 ; avec un gel (h = { tw, monde }) seul le temps du monde compte.
// phase0 (facultatif, champ de la boucle) : la boucle demarre a cette phase (enchainer deux scenes sans a-coup : mcanim etat).
export function phaseBoucle(b, t, h = null) {
  return (h ? (h.monde(h.tw) - h.monde(b.de)) / b.periode : (t - b.de) / b.periode) + (b.phase0 ?? 0);
}

// Somme des boucles actives pour une piste donnee. Retourne un tableau de `n` valeurs.
// `h` (facultatif) : { tw, monde } voir horlogeMonde ; sans lui, le temps normal.
function sommeBoucles(a, nom, t, n, h = null) {
  const s = new Array(n).fill(0);
  const tw = h ? h.tw : t;
  for (const b of (h?.boucles ?? a.boucles)) {   // h.boucles : boucles decalees d'un acteur fige (fige.js)
    const piste = b.pistes[nom];
    if (!piste) continue;
    const w = poidsBoucle(b, tw);
    if (w <= 0) continue;
    const phase = phaseBoucle(b, t, h);
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
// monde (facultatif) : { replay } d'une scene avec simulation ; terrain vivant : voir terrain-vivant.js (le monde de chaque instant).
export function animer(scene, terrain = {}, monde = null, extra = {}) {   // extra.creatures : table des creatures (stats) quand la scene en a
  const estLibre = terrain.estLibre ?? (() => true);
  // solide pour la camera : seulement les blocs pleins (voir rendu/scene.js, estSolidePourCamera) ; a defaut, tout ce qui n'est pas libre
  const solide = terrain.solide ?? ((x, y, z) => !estLibre(x, y, z));
  const solFin = creerSol(terrain);
  const n = scene.images;
  const acteurs = scene.acteurs;
  const parNom = new Map(acteurs.map((a, i) => [a.nom, i]));
  const notes = [...(scene.notesSaisie ?? [])];   // formes courtes acceptees a la lecture (camera.pos [x,y,z]...)
  const marcheAuto = acteurs.map((a) => !!scene.jeu && marcheAutoPossible(a));   // montage : un acteur deplace sans jambes ecrites marche tout seul (jeu.js)
  const articule = acteurs.map((a, k) => ['coudeD', 'coudeG', 'genouD', 'genouG'].some((n) => a[n] || a.boucles.some((b) => b.pistes[n])) || aCibles(a) || gesteAvecCoude(a) || marcheAuto[k]);
  // corps [t, penche, cote, torsion] (plus d'une valeur) : le haut du corps entier tourne autour des hanches ; une seule valeur : le dos du jeu
  const etatsIK = acteurs.map(() => ({}));   // dernier pivot de coude de chaque membre tenu par une cible (continuite d'une image a l'autre)
  const corpsComplet = acteurs.map((a) => (a.corps?.arite ?? 1) > 1 || a.boucles.some((b) => (b.pistes.corps?.arite ?? 1) > 1));

  // Pied du joueur : plus haut sol sous les 4 coins et le centre (comme la boite du jeu), dalles et escaliers a leur vraie hauteur.
  const solSous = (x, z, yr) => { const m = solFin.sous(x, z, yr); return m ? m.y : null; };
  const vivants = acteurs.map((a) => ((a.actes || a.creature?.ia || (monde?.replay?.vehiculesSim ?? []).includes(a.nom)) && monde?.replay ? creerVivant(monde.replay, a._trace ?? a.nom) : null));   // vehiculesSim : wagonnets, bateaux et leurs cavaliers simules (partie 27)   // _trace : acteur ne ou change en cours de route (film/naissances.js)   // trace des acteurs a intentions

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
      if (Math.hypot(dx, dz) / DT > seuilMarche(a)) { lacet = Math.atan2(-dx, dz) / RAD; break; }
    }
    const sol = solSous(p0[0], p0[2]);
    return { y: Number.isFinite(p0[1]) ? p0[1] : (sol ?? 0), vy: 0, lacet, xPrec: p0[0], zPrec: p0[2], pistePos: piste };
  });

  // ---- passe 1 : acteurs, image par image (l'etat avance avec le temps)
  const parImage = [], infosImage = [];
  const gel = scene.gel ?? [];
  const horloge = horlogeMonde(gel);
  const remap = carteTemps(scene);   // null sans `plans` avec vitesse/arret : le temps d'action est alors le temps du film, comme avant
  // physique verticale de chaque acteur (physique.js) : saut, marche d'escalier, chute, eau, echelle ; la piste pos donne l'horizontale
  const figes = acteurs.map((a) => creerFige(a, gel));   // acteurs figes seuls (champ fige) : null pour les autres, calcul inchange
  // creatures : boite et hauteur de marche du type (physique) ; rien de change pour les joueurs
  const boites = acteurs.map((a) => (a.creature ? boiteDe(a.creature, extra.creatures?.types) : null));
  const sims = acteurs.map((a, k) => simulerActeur({ piste: pistePos(a), terrain, duree: scene.duree, gel: figes[k] ? figes[k].simGel : gel, tempsPos: figes[k]?.simTemps ?? null, ...(boites[k] ? { rayon: boites[k].l / 2, pas: Math.max(0.6, boites[k].pas) } : {}) }));
  for (let i = 0; i < n; i++) {
    const t = remap ? remap.tw[i] : i * DT;
    const { tw, fige } = horloge.etat(t);
    // sans gel on garde exactement le calcul d'avant (h = null)
    const h = gel.length ? { tw, monde: horloge.monde } : null;
    infosImage.push({ fige, tm: gel.length ? horloge.monde(t) : t });
    const posDeImage = scene.jeu || acteurs.some((a) => a.gestes?.length) ? Object.assign((nom) => { const j = parNom.get(nom); if (j === undefined) return null; const q = evaluer(etat[j].pistePos, t); return [q[0], q[2]]; }, { noms: acteurs.map((a) => a.nom) }) : null;
    parImage.push(acteurs.map((a, k) => {
      const e = etat[k];
      // acteur fige seul : temps propre pour les pistes ecrites (T), horloge des boucles (H), arret de l'acteur ; sans fige : ceux de l'image
      const FG = figes[k], etU = FG ? FG.U.etat(t) : null;
      const T = (nom) => (FG && !FG.sauf.has(nom) ? FG.propre(t) : t);
      const hU = FG ? { tw: etU.tw, monde: FG.U.monde, boucles: FG.boucles } : h;
      const H = (nom) => (FG && !FG.sauf.has(nom) ? hU : h);
      const figeA = FG ? etU.fige : fige;
      const p = evaluer(e.pistePos, T('pos'));
      const sim = sims[k];
      const tmA = FG && !FG.sauf.has('pos') ? FG.U.monde(t) : infosImage[i].tm;   // temps du monde (il ne passe pas pendant un gel ni un fige)
      const V = vivants[k], vs = V ? V.en(tmA) : null;   // acteur commande par la simulation : sa trace remplace la piste pos et la physique
      if (vs && terrain.regler) terrain.regler(tmA);
      const st = vs ? V.etat(vs) : sim.etatA(tmA);
      // le chemin horizontal est celui de pos, sauf quand un mur l'arrete (physique.js : obstacle)
      const x = (vs || sim.horizModifie) ? st.x : p[0], z = (vs || sim.horizModifie) ? st.z : p[2];
      // --- hauteur : imposee (cle a 3 valeurs), sinon physique du jeu (gravite 0,08, saut 0,42, pas de 0,6 : physique.js)
      const sol = vs ? (vs.auSol ? vs.y : solSous(x, z, vs.y)) : solSous(x, z, e.y);
      const solY = sol ?? e.y;
      let auSol, imposee = false;
      if (vs) { e.y = vs.y; e.vy = 0; imposee = true; auSol = vs.auSol; } else if (Number.isFinite(p[1])) {
        e.y = p[1]; e.vy = 0; imposee = true;
        auSol = e.y <= solY + 0.05;
      } else { e.y = st.y; e.vy = st.vy; auSol = st.auSol; }

      // --- direction du corps
      let lacet;
      const dx = x - e.xPrec, dz = z - e.zPrec;
      if (!figeA && i > 0 && Math.hypot(dx, dz) / DT > seuilMarche(a) && !a.lacet) {   // gel : le corps ne se retourne plus tout seul
        const cible = Math.atan2(-dx, dz) / RAD;
        e.lacet += normaliser180(cible - e.lacet) * (1 - Math.pow(0.7, 20 * DT)); // 0,3 par tick de 1/20 s, comme le jeu
      }
      e.xPrec = x; e.zPrec = z;
      if (a.lacet) lacet = evaluer(a.lacet, T('lacet'))[0] + sommeBoucles(a, 'lacet', t, 1, H('lacet'))[0];
      else lacet = e.lacet + sommeBoucles(a, 'lacet', t, 1, H('lacet'))[0];
      if (vs) { e.lacet = vs.lacet; if (!a.lacet) lacet = vs.lacet + sommeBoucles(a, 'lacet', t, 1, H('lacet'))[0]; }

      // --- reactions automatiques (additives), membres, tete, buste
      const R = a.reactions && !imposee ? reactionsA(sim, tmA) : null;
      const fJ = R ? R.amortiJambes : 1, fB = R ? R.amortiBras : 1;
      const th = vs && !a.tete ? [Math.max(-75, Math.min(75, normaliser180(vs.lacetTete - vs.lacet))), vs.tangage] : valeurPiste(a.tete, T('tete'), ZERO2);
      const tb = sommeBoucles(a, 'tete', t, 2, H('tete'));
      const corps = (a.corps ? evaluer(a.corps, T('corps'))[0] : 0) + sommeBoucles(a, 'corps', t, 1, H('corps'))[0] + (R ? R.corps : 0);
      const accroupi = a.accroupi ? Math.min(1, Math.max(0, evaluer(a.accroupi, T('accroupi'))[0])) : (vs && vs.accroupi ? 1 : 0);
      const pose = {
        nom: a.nom, x, y: e.y, z, sol: solY, auSol, lacet,
        tete: [th[0] + tb[0], th[1] + tb[1]], penche: corps, accroupi,
        brasD: membre(a, 'brasD', T('brasD'), H('brasD'), fB), brasG: membre(a, 'brasG', T('brasG'), H('brasG'), fB), jambeD: membre(a, 'jambeD', T('jambeD'), H('jambeD'), fJ), jambeG: membre(a, 'jambeG', T('jambeG'), H('jambeG'), fJ),
      };
      if (R) { pose.brasD[0] += R.bras; pose.brasG[0] += R.bras; pose.jambeD[0] += R.jambe; pose.jambeG[0] += R.jambe; }
      if (vs) { if (!a.creature) V.membres(vs, pose); if (vs.objet && !a.objetD) { pose.objetD = vs.objet; if (vs.reflet) pose.refletD = true; } }   // une creature a sa propre marche (film/creatures.js)   // balancement du jeu, coup du bras, objet tenu
      if (vs?.plane && !a.creature) {   // vol plane aux elytres : corps couche dans le sens du vol (AvatarRenderer.setupRotations), tete a -45 degres (HumanoidModel)
        pose.ragdoll = { R: rotationVol(lacet, vs.lacetTete, vs.tangage, vs.ticksVol, vs.vitesse), centre: 0 };
        if (!a.tete) pose.tete[1] = -45;
        pose.plane = true;
      }
      if (vs?.usage === 7 && !a.creature) {   // Impulsion : pose SPIN_ATTACK (corps couche selon le regard, tourne de 75 degres par tick)
        pose.ragdoll = { R: rotationVrille(lacet, vs.tangage, tmA * 20), centre: 0 };   // age + partialTick
        pose.vrille = true;
      }
      if (V) pose.ailes = V.ailes(tmA);   // angles des elytres (dessinees si le plastron est "elytra" ; creatures : WingsLayer, creatures/rendu.js)
      if (vs?.plane && a.creature) pose.volCreature = { vitesse: vs.vitesse, ticks: vs.ticksVol };   // creature en vol plane : HumanoidModel (tete a -45, membres freines)
      // articulations libres (additif) : torsion des membres, roulis de la tete, haut du corps entier ; rien n'est ajoute sans elles
      for (const [nom, f] of [['brasD', fB], ['brasG', fB], ['jambeD', fJ], ['jambeG', fJ]]) {
        const tors = (a[nom] ? (evaluer(a[nom], T(nom))[2] ?? 0) : 0) + sommeBoucles(a, nom, t, 3, H(nom))[2] * f;
        if (tors) pose[nom][2] = tors;
      }
      const roulisTete = (a.tete ? (evaluer(a.tete, T('tete'))[2] ?? 0) : 0) + sommeBoucles(a, 'tete', t, 3, H('tete'))[2];
      if (roulisTete) pose.tete[2] = roulisTete;
      if (corpsComplet[k]) {
        const cs = a.corps ? evaluer(a.corps, T('corps')) : [], sb = sommeBoucles(a, 'corps', t, 3, H('corps'));
        pose.troncComplet = true; pose.troncCote = (cs[1] ?? 0) + sb[1]; pose.troncTorsion = (cs[2] ?? 0) + sb[2];
      }
      if (st.eau && !imposee) pose.eau = true;
      if (vs) {   // sante : rougeur des degats (10 ticks), mort = le corps tombe sur le cote en 20 ticks (LivingEntityRenderer : sqrt(t / 20 x 1,6) x 90 degres) puis disparait
        if (vs.eau) pose.eau = true;
        if (vs.blessure > 0 || vs.mort > 0) pose.rouge = true;   // surcouche rouge du jeu (OverlayTexture : melange, pas une multiplication), perso/modele.js
        else if (vs.lueur) pose.teinte = [1.5, 1.5, 1.1];                       // effet Lueur : le corps luit (le contour du jeu n'est pas dessine)
        if (vs.invisible) { pose.y -= 1000; pose.absent = true; }               // effet Invisibilite
        if (vs.mortT >= 0) {
          if (vs.mortT >= 20) { pose.y -= 1000; pose.absent = true; } else { const rot = Math.min(1, Math.sqrt(Math.max(0, vs.mortT) / 20 * 1.6)) * 90; pose.roulis = rot; pose._dyMort = descenteBascule(0, rot); pose.dy = (pose.dy ?? 0) + pose._dyMort; }
        }
      }
      // vehicule simule (wagonnet, bateau : moteur/vehicules.js) : la pose du rendu du jeu (wagonnet pose sur sa voie, lacet et tangage du rail,
      // secousse des coups, meche du TNT, balancement d'une colonne de bulles) ; creatures/rendu.js la lit dans pose.vehiculeJeu
      if (vs && V.vehicule && a.creature) {
        const ve = V.vehicule(tmA);
        if (ve) {
          pose.x += ve.dx; pose.y += ve.dy; pose.z += ve.dz; e.y = pose.y;
          pose.lacet = a.creature.type.includes('minecart') ? ve.yaw - 90 : ve.yaw;
          const d = Math.abs(ve.degats), sg = Math.sign(ve.degats) || 1, h = ve.secousse, dd = Math.max(0, d - (vs.blessure ? 0 : 0));
          pose.vehiculeJeu = { tangage: ve.pitch, secousse: h > 0 ? Math.sin(h) * h * dd / 10 * sg : 0, meche: ve.meche, bulle: ve.bulle };
        }
      }
      if (a._absentAvant !== undefined || a._absentApres !== undefined) {   // entite nee (ou changee) en cours de route : rien hors de sa fenetre de ticks
        const tk = monde?.replay ? monde.replay.tickDe(tmA) : 0;
        if ((a._absentAvant !== undefined && tk < a._absentAvant) || (a._absentApres !== undefined && tk >= a._absentApres)) { pose.y -= 1000; pose.absent = true; }
      }
      if (st.echelle && !imposee) pose.echelle = true;
      // orientation du corps entier et decalage vertical (pistes facultatives : rien n'est ajoute sans elles)
      const clamp180 = (v) => Math.max(-180, Math.min(180, v));
      const bascule = aPiste(a, 'bascule') ? clamp180(valeurSeule(a, 'bascule', T('bascule'), H('bascule'))) : 0;
      const roulis = aPiste(a, 'roulis') ? clamp180(valeurSeule(a, 'roulis', T('roulis'), H('roulis'))) : 0;
      let hauteur = aPiste(a, 'hauteur') ? valeurSeule(a, 'hauteur', T('hauteur'), H('hauteur')) : 0;
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
        pose.coudeD = flexion(a, 'coudeD', T('coudeD'), H('coudeD'), fB, c); pose.coudeG = flexion(a, 'coudeG', T('coudeG'), H('coudeG'), fB, c);
        pose.genouD = flexion(a, 'genouD', T('genouD'), H('genouD'), fJ, g); pose.genouG = flexion(a, 'genouG', T('genouG'), H('genouG'), fJ, g);
      }
      if (marcheAuto[k]) { avancerMarche(e, figeA ? 0 : Math.hypot(dx, dz) / DT); poseMarche(pose, e); }   // montage : marche automatique, avant l'appui (le corps monte et descend)
      // cibles des pieds (cinematique inverse) : avant l'appui, qui pose ensuite le pied le plus bas sur le sol
      const fk = {}, ciblesPieds = aCibles(a) ? appliquerCibles(a, pose, t, evaluer, 'jambes', fk, etatsIK[k], FG ? T : null) : 0;
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
      if (aCibles(a)) { if (ciblesPieds && pose.dy) appliquerCibles(a, pose, t, evaluer, 'jambes', fk, etatsIK[k], FG ? T : null); appliquerCibles(a, pose, t, evaluer, 'bras', fk, etatsIK[k], FG ? T : null); }
      // apparence (pistes facultatives : rien n'est ajoute si elles manquent)
      const sk = skinEn(a, T('skins'));
      if (sk) pose.skin = sk;
      if (a.horsImage) pose.horsImage = evaluer(a.horsImage, T('horsImage'))[0] >= 0.5;
      if (a.lueur) pose.lueur = evaluer(a.lueur, T('lueur'))[0];
      // objets tenus et armure (champs facultatifs : rien n'est ajoute sans eux)
      for (const [champ, piste] of [['objetD', a.objetD], ['objetG', a.objetG]]) { const id = piste ? valeurObjet(piste, T(champ)) : null; if (id) { pose[champ] = id; if (aReflet(pileObjet(piste, T(champ)), monde?.replay?.refletsForces)) pose['reflet' + champ.slice(-1)] = true; } }
      // totem d'immortalite utilise (moteur/inventaire.js totemSauve) : il quitte la main a l'evenement, jusqu'a une cle de piste posterieure
      for (const tt of monde?.replay?.totems ?? []) {
        if (tt.acteur !== a.nom || tt.tick > tmA * 20 * (monde.replay.ralenti || 1) + 1e-6) continue;
        const champ = tt.main === 'gauche' ? 'objetG' : 'objetD', piste = a[champ], tEv = tt.tick / 20 / (monde.replay.ralenti || 1);
        if (pose[champ] === tt.objet && !(piste?.cles ?? []).some((c) => c.t > tEv && c.t <= T(champ))) { delete pose[champ]; delete pose['reflet' + champ.slice(-1)]; }
      }   // enchante : reflet (objets/reflet.js)
      if (a.teteSkin) pose.teteSkin = a.teteSkin;   // tete de joueur portee (entite importee, decor/index.js) : skin de son profil
      if (a.armure) { let arm = null; for (const [e, piste] of Object.entries(a.armure)) { const id = valeurObjet(piste, T('armure')); if (id) { (arm ??= {})[e] = id; const pl = pileObjet(piste, T('armure')); if (aReflet(pl)) (pose.refletArmure ??= {})[e] = true; const gl = galonDe(pl); if (gl) (pose.galonArmure ??= {})[e] = gl; } } if (arm) pose.armure = arm; }
      if (vs?.armures) { const arm = { ...(pose.armure ?? {}) }; pose.refletArmure = { ...(pose.refletArmure ?? {}) }; for (const [e, p] of Object.entries(vs.armures)) { if (p) { arm[e] = p.replace(/\[[^\]]*\]/, ''); pose.refletArmure[e] = aReflet(p); const gl = galonDe(p); if (gl) (pose.galonArmure ??= {})[e] = gl; else if (pose.galonArmure) delete pose.galonArmure[e]; } else { delete arm[e]; delete pose.refletArmure[e]; if (pose.galonArmure) delete pose.galonArmure[e]; } } pose.armure = arm; }   // armure changee par la simulation (cassee, enchantee)
      // montage : vie au repos (respiration, regard) et gestes sur mots cles, ajoutes a la pose (rien sans `jeu` ni `gestes`)
      if (a.gestes?.length || a.parole?.length || a.ecoute?.length || (scene.jeu && a.jeu?.actif && !a.creature)) ajouterJeu(pose, { t, a, vie: !!scene.jeu && a.jeu.actif, marche: Math.hypot(dx, dz) / DT > 0.5 || !auSol || !!st.eau, posDe: posDeImage, lacet });
      if (FG && etU.fige) pose.figee = true;   // cet acteur est fige : pas de bruits de pas (pas.js, sons.js)
      return pose;
    }));
  }

  // creatures et montures (film/creatures.js) : etat d'animation du jeu, cavaliers sur leur siege ; rien sans elles
  if (acteurs.some((a) => a.creature || a.monture)) notes.push(...appliquerCreatures(scene, parImage, { DT, terrain, types: extra.creatures?.types, replay: monde?.replay ?? null }));
  // pantin des explosions (film/ragdoll.js) : seulement si le replay a des souffles (regle explosion.ragdoll) ; rien sinon
  if (monde?.replay?.souffles?.length) appliquerPantins(scene, parImage, { replay: monde.replay, vivants, tm: infosImage.map((x) => x.tm), modeles: extra.creatures?.modeles ?? null, creatures: extra.creatures ?? null, personnages: extra.personnages ?? null });   // personnages : le vrai maillage pour poser le corps sur le sol

  if (terrain.fin) terrain.fin();   // monde vivant : par defaut le monde de la fin de la scene (murs poses, trous faits)...
  // ... mais la camera planifie chaque image dans le monde de SON instant (un mur pose plus tard ne repousse pas la camera avant sa pose)
  const instantDe = (i0) => (terrain.vivant && terrain.regler ? (j) => terrain.regler(infosImage[i0 + j]?.tm ?? 0) : null);

  // ---- passe 2 : camera (on connait tout le film : planification sur tout le plan, voir camera.js)
  // Un seul plan (sans `plans`) : toute la scene avec la camera de la scene, comme avant. Avec `plans` : un plan de camera par segment, qui REPREND
  // A ZERO (cap, hauteur lissee, collisions : rien ne se propage d'un plan a l'autre, pas d'interpolation a travers une coupe) ; les temps des pistes
  // de camera d'un plan sont relatifs a son debut.
  const yeux = (p) => {
    if (p.oeil !== undefined) return [p.x, p.y + p.oeil, p.z];   // creature : ses yeux (statistiques du type)
    if (p.plane) return [p.x, p.y + 0.4, p.z];                    // vol plane aux elytres : yeux de la pose FALL_FLYING (0,4), la camera suit le corps couche
    if (!p.bascule && !p.roulis && !p.hauteur && !p.troncComplet) return [p.x, p.y + 1.62 - 0.35 * p.accroupi, p.z];   // corps droit : la formule d'avant, au bit pres
    const [ox, oy, oz] = decalageYeux(p);
    return [p.x + ox, p.y + oy, p.z + oz];
  };
  const pos = new Array(n), cible = new Array(n);
  const fovPar = new Array(n), suitPar = new Array(n).fill(null);   // suitPar : l'acteur que la camera suit (son ecran : totem, film/totem-ecran.js)
  let corrigee = new Array(n).fill(false);
  let statCamera = null;
  const cumuler = (st) => { if (!st) return; statCamera = statCamera ?? {}; for (const [k, v] of Object.entries(st)) statCamera[k] = (statCamera[k] ?? 0) + v; };
  const segments = [];
  if (scene.plans) {
    let i = 0;
    for (const [k, p] of scene.plans.entries()) {
      if (p.i0 > i) segments.push({ i0: i, i1: p.i0, c: scene.camera, dec: 0 });   // trou entre deux plans : camera de la scene
      if (p.i1 > p.i0) segments.push({ i0: p.i0, i1: p.i1, c: p.camera, dec: p.de, plan: k + 1, de: p.de, a: p.a });
      i = Math.max(i, p.i1);
    }
    if (i < n) segments.push({ i0: i, i1: n, c: scene.camera, dec: 0 });
  } else segments.push({ i0: 0, i1: n, c: scene.camera, dec: 0 });
  // Sujet cache par un bloc plein ? Mesure sur le plan, corrige (camera libre ou cadree) comme la camera de suivi, sinon UNE note (plan, secondes, bloc).
  const aspect = scene.largeur / scene.hauteur;
  const yeuxDe = (i, nom) => yeux(parImage[i][parNom.get(nom)]);
  const camDe = (i) => { const dx = cible[i][0] - pos[i][0], dy = cible[i][1] - pos[i][1], dz = cible[i][2] - pos[i][2], h = Math.hypot(dx, dz); return { x: pos[i][0], y: pos[i][1], z: pos[i][2], lacet: Math.atan2(-dx, dz) / RAD, tangage: Math.atan2(-dy, h) / RAD, fov: fovPar[i] }; };
  const controlerSujet = (seg, corrigeable) => {
    if (!terrain.solide) return false;
    const { i0, i1 } = seg, sj = sujetsDuPlan(seg.c);
    const mesurer = () => masquageSujets({ pos, yeux: yeuxDe, i0, i1, noms: sj.noms, solide, instant: instantDe(0), bloc: terrain.bloc ? (x, y, z) => terrain.bloc(x, y, z) : null, ecran: sj.explicite ? null : { cam: camDe, aspect, tous: acteurs.map((a) => a.nom) } });
    let r = mesurer();
    if (sj.explicite && corrigeable && r[0]?.part > SEUIL_CACHE) {
      const avant = pos.slice(i0, i1).map((q) => q.slice());
      const cibles = []; for (let i = i0; i < i1; i++) cibles.push(yeuxDe(i, r[0].nom));
      const essai = planifierCameraSuivi({ cibles, voulues: avant, solide, dt: DT, instant: instantDe(i0) });
      for (let j = 0; j < i1 - i0; j++) pos[i0 + j] = essai.pos[j];
      const r2 = mesurer();
      if (r2[0].part < r[0].part - 0.02) { r = r2; cumuler(essai.stat); for (let j = 0; j < i1 - i0; j++) if (essai.corrigee[j]) corrigee[i0 + j] = true; }
      else for (let j = 0; j < i1 - i0; j++) pos[i0 + j] = avant[j];
    }
    let note = false;
    for (const m of r.slice(0, 2)) if (m.part > SEUIL_CACHE) { notes.push(noteSujetCache({ plan: seg.plan, de: seg.de ?? i0 * DT, a: seg.a ?? i1 * DT, nom: m.nom, part: m.part, bloc: m.bloc, corrigee: corrigeable })); note = true; }
    return note;
  };
  if (scene.plans && scene.incrustations) reserverTitres(scene, rectSur(scene.zonesSures, scene.largeur, scene.hauteur), scene.largeur, scene.hauteur);   // montage : place pour les titres du haut (cadrage.js)
  for (const seg of segments) {
    const { i0, i1, c: c0, dec } = seg;
    // cadrage par intention (montage/cadrage.js) : la camera est calculee depuis les poses des acteurs de ce plan
    const c = c0.mode === 'cadre' ? cameraDeCadre(c0, (i, nom) => parImage[i][parNom.get(nom)], i0, i1, dec, acteurs.map((a) => a.nom)) : c0;
    if (c.mode === 'suit') {
      const k = parNom.get(c.suit);
      let cap = parImage[i0][k].lacet;   // direction suivie par la camera : celle du corps, un peu adoucie
      // hauteur de reference de la camera : celle de l'acteur, adoucie (sauts, chutes, marches : la camera ne saute pas avec lui)
      const ys = parImage.slice(i0, i1).map((poses) => poses[k].y);
      const ysLisse = lisserHauteur(ys, TEMPS_HAUTEUR_CAMERA);
      const cibles = [];
      const voulues = parImage.slice(i0, i1).map((poses, j) => {
        const A = poses[k];
        cap += normaliser180(A.lacet - cap) * (1 - Math.exp(-DT / TEMPS_CAP));
        const [droite, haut, arriere] = evaluer(c.decalage, (i0 + j) * DT - dec);
        const psi = cap * RAD, fx = -Math.sin(psi), fz = Math.cos(psi);
        cibles.push(yeux(A));
        return [A.x - fz * droite - fx * arriere, ysLisse[j] + haut, A.z + fx * droite - fz * arriere];
      });
      const plan = planifierCameraSuivi({ cibles, voulues, solide, dt: DT, instant: instantDe(i0) });
      for (let j = 0; j < i1 - i0; j++) { pos[i0 + j] = plan.pos[j]; cible[i0 + j] = cibles[j]; corrigee[i0 + j] = plan.corrigee[j]; }
      cumuler(plan.stat);
      for (let i = i0; i < i1; i++) fovPar[i] = evaluer(c.fov, i * DT - dec)[0];
      const noteSujet = controlerSujet(seg, false);
      if (!noteSujet && plan.vueCoupee > 0.5 / DT) notes.push(`camera : acteur cache par un bloc pendant ${(plan.vueCoupee * DT).toFixed(1).replace('.', ',')} s malgre les corrections`);
    } else {
      const voulues = [], cibles = [];
      for (let i = i0; i < i1; i++) {
        const t = i * DT - dec;
        voulues.push(Array.from(evaluer(c.pos, t)));
        cibles.push(c.regarde ? yeux(parImage[i][parNom.get(c.regarde)]) : Array.from(evaluer(c.cible, t)));
      }
      const plan = planifierCameraLibre({ positions: voulues, cibles, solide, dt: DT, instant: instantDe(i0) });
      for (let j = 0; j < i1 - i0; j++) { pos[i0 + j] = plan.pos[j]; cible[i0 + j] = cibles[j]; corrigee[i0 + j] = plan.corrigee[j]; }
      cumuler(plan.stat);
      for (let i = i0; i < i1; i++) fovPar[i] = evaluer(c.fov, i * DT - dec)[0];
      controlerSujet(seg, true);
    }
    for (let i = i0; i < i1; i++) fovPar[i] = evaluer(c.fov, i * DT - dec)[0];
    if (c.mode === 'suit') for (let i = i0; i < i1; i++) suitPar[i] = c.suit;
  }

  if (terrain.vivant && terrain.fin) terrain.fin();   // apres la camera planifiee instant par instant : le monde de la fin (notes d'obstruction)
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
    images.push({ t, fige: infosImage[i].fige, tm: infosImage[i].tm, acteurs: parImage[i], camera: { x: pos[i][0], y: pos[i][1], z: pos[i][2], lacet: lacetCam, tangage: tangageCam, fov: fovPar[i], ...(suitPar[i] ? { suit: suitPar[i] } : {}) }, corrigee: corrigee[i] });
  }
  if (terrain.bloc && terrain.solide) notes.push(...notesObstruction(scene, images, terrain));   // seulement avec un vrai terrain
  if (effetsDeScene(scene)) appliquerMontage(scene, images);   // secousse, coup de zoom, roulis, flous, profondeur de champ, transitions (rien sans ces champs)
  return { images, corrections, notes, camera: statCamera, sims, remap };
}

// Piste [x, y, z] d'un acteur ; y vaut NaN quand la cle n'impose pas la hauteur.
function pistePos(a) {
  return { arite: 3, cles: a.pos.cles.map((k) => ({ t: k.t, v: [k.x, k.y, k.z], l: k.l })) };
}
