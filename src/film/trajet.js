// `mcanim trajet` : ce qui arrive aux acteurs le long de leur chemin (saut, chute, eau, echelle, marches, murs), en texte COURT,
// pour que Claude choisisse les animations qui conviennent. Utilise la meme simulation que le rendu (physique.js).
import { evaluer } from './scene.js';
import { simulerActeur, TICK, VITESSES } from './physique.js';
import { animer } from './anim.js';
import { creerFige } from './fige.js';
import { noteAmplitudes } from './limites.js';

const OCTETS_PAR_ACTEUR = 600;
export const RAPPEL = 'ajoute les animations correspondantes (fiches : sauter, descendre, echelle, nager) ; sans elles, les réactions automatiques sont appliquées';
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const f2 = (v) => (Math.round(v * 100) / 100).toString();
const pc = (v) => Math.round(v);

// Piste [x, y, z] d'un acteur valide (y = NaN : automatique)
const pistePos = (a) => ({ arite: 3, cles: a.pos.cles.map((k) => ({ t: k.t, v: [k.x, k.y, k.z], l: k.l })) });

// Vitesses de croisiere par morceau de meme milieu (>= 0,5 s) : la liste des ecarts de plus de 10 % avec les vitesses du jeu.
function avertissementsVitesse(sim, a) {
  const K = sim.ticks;
  const milieu = (k) => (sim.echelle[k] || sim.surEchelle[k] ? 'echelle' : sim.eau[k] || sim.prof[k] >= 0.3 ? 'eau' : sim.air[k] ? 'air' : 'sol');
  const accroupi = (t) => (a.accroupi ? evaluer(a.accroupi, t)[0] >= 0.5 : false);
  const couche = (t) => (a.bascule ? Math.abs(evaluer(a.bascule, t)[0]) >= 60 : false);
  const morceaux = [];
  let debut = 0, genre = null;
  const fermer = (fin) => { if (genre && fin - debut >= 10) morceaux.push({ genre, d: debut, f: fin }); };
  for (let k = 1; k <= K; k++) {
    const t = sim.reel(k * TICK);
    const m = milieu(k);
    const g = m === 'sol' ? (accroupi(t) ? 'sol-accroupi' : couche(t) ? 'sol-couche' : 'sol') : m;
    if (g !== genre) { fermer(k); debut = k; genre = g; }
  }
  fermer(K + 1);
  const sorties = [];
  for (const mo of morceaux) {
    if (mo.genre === 'air') continue;
    const v = [];
    for (let k = mo.d; k < mo.f && k <= K; k++) {
      if (mo.genre === 'echelle') v.push((sim.y[k] - sim.y[k - 1]) / TICK); else v.push(Math.hypot(sim.X[k] - sim.X[k - 1], sim.Z[k] - sim.Z[k - 1]) / TICK);
    }
    const bouge = mo.genre === 'echelle' ? v.filter((x) => Math.abs(x) > 0.3) : v.filter((x) => x > 1.0);
    if (bouge.length < 8) continue;                       // pas de vrai deplacement : demarrage, arret, immobile
    bouge.sort((p, q) => Math.abs(p) - Math.abs(q));
    const c = bouge[Math.floor(bouge.length * 0.8)];      // 80e centile : les departs et arrets doux ne comptent pas
    const t0 = sim.reel(mo.d * TICK), t1 = sim.reel(mo.f * TICK);
    let attendu, nom;
    if (mo.genre === 'sol') { attendu = [VITESSES.marche, VITESSES.course]; nom = `marche ${VITESSES.marche} ou course ${VITESSES.course}`; }
    else if (mo.genre === 'sol-accroupi') { attendu = [VITESSES.accroupi]; nom = `accroupi ${VITESSES.accroupi}`; }
    else if (mo.genre === 'sol-couche') { attendu = [VITESSES.ramper]; nom = `ramper ${VITESSES.ramper}`; }
    else if (mo.genre === 'eau') { attendu = [VITESSES.eau, VITESSES.nage]; nom = `eau ${VITESSES.eau} (nage rapide ${VITESSES.nage})`; }
    else { attendu = c >= 0 ? [VITESSES.echelleMonte] : [VITESSES.echelleDescend]; nom = c >= 0 ? `echelle montee ${VITESSES.echelleMonte}` : `echelle descente ${VITESSES.echelleDescend}`; }
    const ecart = Math.min(...attendu.map((e) => Math.abs(Math.abs(c) - e) / e));
    if (ecart > 0.10) sorties.push({ t: t0, texte: `vitesse ${f1(Math.abs(c))} b/s${mo.genre === 'echelle' ? ' (vertical)' : ''} t=${f1(t0)}-${f1(t1)} : le jeu = ${nom}` });
  }
  return sorties;
}

// Evenements d'un acteur : [{ t, texte, genre }] tries par temps.
export function evenementsActeur(sim, a) {
  const ev = [];
  const K = sim.ticks;
  // sauts et chutes (un vol = du decollage ou du bord jusqu'a l'atterrissage)
  for (const at of sim.atterrissages) {
    const saut = sim.decollages.find((d) => d.k === at.depuis);
    const tDepart = sim.reel((at.depuis - 1) * TICK), air = at.t - tDepart;
    const v = at.impact * 20;
    if (saut) {
      const mont = at.y - at.departY;
      const brut = sim.brut.find((b) => b.type === 'saut' && b.k === saut.k);
      ev.push({ t: tDepart, genre: 'saut', texte: `t=${f2(tDepart)} saut ${mont >= 0.05 ? '+' : ''}${f1(mont)} bloc (${pc(brut ? brut.x : at.x)},${pc(brut ? brut.z : at.z)}), air ${f2(air)} s, pose t=${f2(at.t)} a ${f1(v)} b/s` });
    } else if (at.chute >= 0.9) {
      ev.push({ t: tDepart, genre: 'chute', texte: `t=${f2(tDepart)} chute ${f1(at.chute)} blocs, air ${f2(air)} s, pose t=${f2(at.t)} a ${f1(v)} b/s${at.chute > 3 ? ' (degats)' : ''}` });
    }
  }
  // eau : morceaux ou la profondeur depasse 0,3 bloc
  let d = -1, pmax = 0, nage = false;
  const fermerEau = (fin) => {
    const t0 = sim.reel(d * TICK), t1 = sim.reel(fin * TICK);
    ev.push({ t: t0, genre: 'eau', texte: `t=${f1(t0)}-${f1(t1)} eau ${nage ? 'nage (flotte)' : 'patauge'}, prof ${f1(pmax)}` });
    d = -1; pmax = 0; nage = false;
  };
  for (let k = 0; k <= K; k++) {
    const dans = sim.prof[k] >= 0.3 || sim.eau[k];
    if (dans && d < 0) d = k;
    if (dans) { pmax = Math.max(pmax, sim.prof[k]); if (sim.eau[k]) nage = true; }
    if (!dans && d >= 0) fermerEau(k);
  }
  if (d >= 0) fermerEau(K);
  // echelle
  d = -1;
  const fermerEch = (fin) => {
    const t0 = sim.reel(d * TICK), t1 = sim.reel((fin - 1) * TICK), dy = sim.y[fin - 1] - sim.y[d];
    const vit = Math.abs(dy) / Math.max(TICK, t1 - t0);
    ev.push({ t: t0, genre: 'echelle', texte: `t=${f1(t0)}-${f1(t1)} echelle ${dy >= 0 ? 'monte' : 'descend'} ${f1(Math.abs(dy))} blocs (y ${f1(sim.y[d])}->${f1(sim.y[fin - 1])}, ${f2(vit)} b/s)` });
    d = -1;
  };
  for (let k = 0; k <= K; k++) {
    if (sim.surEchelle[k] && d < 0) d = k;
    if (!sim.surEchelle[k] && d >= 0) { if (k - d >= 3) fermerEch(k); else d = -1; }
  }
  if (d >= 0 && K - d >= 3) fermerEch(K);
  // marches de moins de 0,6 bloc (dalles, escaliers) : regroupees quand elles se suivent a moins de 1 s
  let groupe = null;
  const fermerGroupe = () => { if (groupe) ev.push({ t: groupe.t, genre: 'marche_escalier', texte: `t=${f1(groupe.t)} marche_escalier x${groupe.n} (+${f1(groupe.h / groupe.n)} chacune, sans saut)` }); groupe = null; };
  for (let k = 1; k <= K; k++) {
    if (sim.pas[k] <= 0) continue;
    const t = sim.reel(k * TICK);
    if (groupe && t - groupe.dernier > 1) fermerGroupe();
    if (!groupe) groupe = { t, n: 0, h: 0, dernier: t };
    groupe.n++; groupe.h += sim.pas[k]; groupe.dernier = t;
  }
  fermerGroupe();
  // mur
  for (const b of sim.brut) if (b.type === 'obstacle') {
    const t = sim.reel(b.k * TICK);
    ev.push({ t, genre: 'obstacle', texte: `t=${f2(t)} obstacle : ${b.bloc} haut de ${f1(b.haut)} blocs en (${pc(b.x)},${pc(b.z)}) ; l'acteur s'arrete, change le chemin` });
  }
  for (const w of avertissementsVitesse(sim, a)) ev.push({ t: w.t, genre: 'vitesse', texte: w.texte });
  return ev.sort((p, q) => p.t - q.t);
}

// scene : validerScene(...). terrain : voir physique.js. Retourne [{ nom, evenements, texte }].
export function trajetsDeScene(scene, terrain) {
  return scene.acteurs.map((a) => {
    const fg = creerFige(a, scene.gel ?? []);   // acteur fige seul : sa physique s'arrete aussi (fige.js)
    const sim = simulerActeur({ piste: pistePos(a), terrain, duree: scene.duree, gel: fg ? fg.simGel : scene.gel ?? [], tempsPos: fg?.simTemps ?? null });
    const evenements = evenementsActeur(sim, a);
    return { nom: a.nom, evenements, sim };
  });
}

// Texte court d'un acteur (au plus ~600 octets).
export function texteActeur(nom, evenements) {
  if (!evenements.length) return `${nom} : aucun evenement (sol sans marche, ni eau, ni echelle ; vitesses du jeu)`;
  const entete = `${nom} : ${evenements.length} evenement(s)`;
  const lignes = [];
  let octets = Buffer.byteLength(entete, 'utf8');
  for (const e of evenements) {
    const l = '  ' + e.texte;
    const o = Buffer.byteLength(l, 'utf8') + 1;
    if (octets + o > OCTETS_PAR_ACTEUR - 24 && lignes.length < evenements.length) { lignes.push(`  (+${evenements.length - lignes.length} autres)`); break; }
    lignes.push(l); octets += o;
  }
  return [entete, ...lignes].join('\n');
}

// Acteur commande par ses `actes` (monde simule) : resume de sa trace dans le replay (marche, sauts, arrivee) et de ses echecs.
export function texteActeurVivant(nom, replay) {
  const id = replay.acteurs.indexOf(nom), A = replay.acteursVue, pts = [];
  for (let i = 0; i < A.length / 16; i++) if (A[i * 16 + 1] === id) pts.push({ k: A[i * 16], x: A[i * 16 + 2], y: A[i * 16 + 3], z: A[i * 16 + 4], sol: (A[i * 16 + 8] & 2) !== 0 });
  let dist = 0, sauts = 0, chuteMax = 0, depart = null;
  for (let i = 1; i < pts.length; i++) {
    dist += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (pts[i - 1].sol && !pts[i].sol && pts[i].y > pts[i - 1].y + 0.05) sauts++;
    if (pts[i - 1].sol && !pts[i].sol) depart = pts[i - 1].y;
    if (!pts[i - 1].sol && pts[i].sol && depart !== null) { chuteMax = Math.max(chuteMax, depart - pts[i].y); depart = null; }
  }
  const fin = pts[pts.length - 1];
  const echecs = replay.actes.filter((a) => a.acteur === nom && a.statut !== 'ok');
  const l = [`${nom} : guide par ses actes (monde simule) : ${f1(dist)} blocs de marche, ${sauts} saut(s)${chuteMax >= 0.9 ? `, chute max ${f1(chuteMax)} blocs` : ''}, arrivee (${f1(fin.x)}, ${f1(fin.y)}, ${f1(fin.z)})`];
  for (const e of echecs.slice(0, 3)) l.push(`  ! t=${f1(e.tick / 20 / replay.ralenti)} ${e.args} ${e.statut === 'echec' ? 'ECHEC' : 'interrompu'}${e.texte ? ' : ' + e.texte.slice(0, 110) : ''}`);
  if (echecs.length > 3) l.push(`  (+${echecs.length - 3} autres, mcanim simuler)`);
  return l.join('\n');
}

// Reponse complete de `mcanim trajet`. monde (facultatif) : { replay } de la simulation du jeu (acteurs a `actes`) ; le terrain est alors le monde vivant.
export function texteTrajets(scene, terrain, monde = null) {
  const t = trajetsDeScene(scene, terrain);
  let note = null;   // articulations libres : amplitudes hors plausible, une ligne (information seule)
  let camera = [];   // camera : herbe, feuilles ou acteur colles a l'objectif (obstruction.js)
  try { const anim = animer(scene, terrain, monde); note = noteAmplitudes(scene, anim); camera = anim.notes.filter((n) => n.startsWith('camera : ')); } catch { /* facultatif */ }
  const parNom = new Map(scene.acteurs.map((a) => [a.nom, a]));
  return [...t.map((x) => (parNom.get(x.nom).actes && monde?.replay ? texteActeurVivant(x.nom, monde.replay) : texteActeur(x.nom, x.evenements))), ...(note ? [note] : []), ...camera, RAPPEL].join('\n');
}

// Nombre d'evenements (hors vitesse) et d'avertissements de vitesse, pour la ligne de `mcanim empreinte`.
export function compterEvenements(trajets) {
  let n = 0, v = 0;
  for (const t of trajets) for (const e of t.evenements) { if (e.genre === 'vitesse') v++; else n++; }
  return { evenements: n, vitesses: v };
}

// Profil de hauteur d'un segment droit parcouru a la vitesse de marche : une ou deux lignes pour `mcanim terrain --chemin`.
export function profilSegment(terrain, x1, z1, x2, z2) {
  const L = Math.hypot(x2 - x1, z2 - z1);
  if (L < 0.5) return '';
  const duree = Math.max(1, L / VITESSES.marche);
  const piste = { arite: 3, cles: [{ t: 0, v: [x1, NaN, z1], l: null }, { t: duree, v: [x2, NaN, z2], l: null }] };
  const sim = simulerActeur({ piste, terrain, duree });
  const ev = evenementsActeur(sim, { pos: null }).filter((e) => e.genre !== 'vitesse');
  const dist = (t) => `${pc(Math.min(L, t * VITESSES.marche))}`;
  // les textes d'evenements parlent en secondes ; ici on les donne en blocs depuis le depart
  const parts = ev.map((e) => {
    const g = e.genre;
    const m = /t=([\d.]+)/.exec(e.texte);
    const d = m ? dist(Number(m[1])) : '?';
    if (g === 'saut') return `saut ${/saut ([+-]?[\d.]+)/.exec(e.texte)[1]} a ${d} blocs`;
    if (g === 'chute') return `chute ${/chute ([\d.]+)/.exec(e.texte)[1]} blocs a ${d}`;
    if (g === 'eau') { const m2 = /t=([\d.]+)-([\d.]+) eau (\S+).*prof ([\d.]+)/.exec(e.texte); return `eau ${m2[3]} de ${d} a ${dist(Number(m2[2]))} blocs (prof ${m2[4]})`; }
    if (g === 'echelle') return `echelle a ${d} blocs`;
    if (g === 'marche_escalier') return `${/x(\d+)/.exec(e.texte)[1]} marche(s) de dalle/escalier a ${d}`;
    if (g === 'obstacle') return `OBSTACLE ${/obstacle : (.*?) haut de ([\d.]+)/.exec(e.texte)[1]} (${/haut de ([\d.]+)/.exec(e.texte)[1]} blocs) a ${d} blocs`;
    return e.texte;
  });
  return parts.length ? `profil de hauteur (a ${VITESSES.marche} b/s) : ${parts.join(' ; ')} -> mcanim trajet scene.json pour les animations` : 'profil de hauteur : sol sans marche, eau ni echelle';
}
