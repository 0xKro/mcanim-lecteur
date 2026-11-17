// Creatures dans l'animation (apres la passe 1 de anim.js) : montures (le cavalier suit le siege de sa monture, pose assise du jeu),
// puis pour chaque creature l'etat d'animation du jeu tick par tick (WalkAnimationState : les pattes suivent la distance parcourue,
// horloges des especes), regard, pistes de parties, gonflement du creeper, animations nommees. Le rendu (creatures/rendu.js) lit
// `pose.creature`. Une scene sans creature ni monture ne passe pas par ici.
import { ESPECES, SIEGES, DECALAGE_CAVALIER, VEHICULES } from '../creatures/especes.js';
import { etatInitial, tick, echelleRendu } from '../creatures/anim.js';
import { evaluer } from './scene.js';

const RAD = Math.PI / 180;
const norm180 = (a) => { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; };
// decalage du cavalier sous le siege (Entity.getVehicleAttachmentPoint ; riders.rs)
const DECALAGE_TYPE = { zombie: 0.7, husk: 0.7, drowned: 0.7, zombie_villager: 0.7, zombified_piglin: 0.7, piglin: 0.7, piglin_brute: 0.7, skeleton: 0.7, stray: 0.7, bogged: 0.7, parched: 0.7, wither_skeleton: 0.875, pillager: 0.6, vindicator: 0.6, evoker: 0.6, illusioner: 0.6 };
// les pattes vont vers min(distance x 4, 1) a 0,4 par tick (LivingEntity.calculateEntityAnimation) ; le chameau : x 6 a 0,2
const MARCHE = { camel: [6, 0.2] };
const VOLANTS = new Set(['bat', 'bee', 'parrot', 'allay', 'vex', 'ghast', 'happy_ghast', 'phantom', 'blaze', 'breeze', 'ender_dragon', 'wither']);
// valeur d'une piste de changements d'un coup [{ t, v }] au temps t (null avant la premiere cle)
const valeurA = (p, t) => { let v = null; for (const k of p ?? []) { if (k.t <= t + 1e-9) v = k.v; else break; } return v; };
// statistiques du type (taille de la boite, yeux, vitesse) : la cle du jeu (bateau de chene -> oak_boat)
export function statsDe(c, types) {
  const cle = c.type === 'boat' || c.type === 'chest_boat' ? `${(c.variante ?? 'oak').split(/\s+/)[0]}_${c.type}` : c.type;
  return types?.[cle] ?? types?.[c.type] ?? null;
}
// boite (largeur, hauteur, yeux) d'une creature, bebe compris
export function boiteDe(c, types) {
  const st = statsDe(c, types) ?? { l: 0.6, h: 1.8, y: 1.62 };
  const b = c.bebe ? ESPECES[c.type]?.[5] : null;
  let l = st.l, h = st.h, y = st.y;
  if (b && b.length === 3) [l, h, y] = b; else if (b && b.length === 1) { l *= b[0]; h *= b[0]; y *= b[0]; }
  if (c.taille) { l *= c.taille; h *= c.taille; y *= c.taille; }
  return { l, h, y, pas: st.p ?? 0.6 };
}

// scene : validee ; parImage[i][k] : poses de la passe 1 ; terrain : celui de anim.js ; types : stats (table des creatures)
export function appliquerCreatures(scene, parImage, { DT = 1 / 30, terrain = {}, types = {} } = {}) {
  const acteurs = scene.acteurs, n = parImage.length;
  const parNom = new Map(acteurs.map((a, k) => [a.nom, k]));
  const notes = [];
  // ---- 1. vehicules : un bateau flotte a la surface de l'eau (sinon il reste au sol)
  acteurs.forEach((a, k) => {
    if (!a.creature || !VEHICULES.has(a.creature.type) || !terrain.eauEn) return;
    for (let i = 0; i < n; i++) { const p = parImage[i][k]; if (!a.creature.type.includes('boat')) continue; const e = terrain.eauEn(p.x, p.z); if (e !== null && e !== undefined && e > p.y) { p.y = e - 0.1; p.eau = true; p.auSol = false; } }
  });
  // ---- 2. cavaliers : sur le siege de leur monture, tournes comme elle (Entity.positionRider), pose assise
  const montePar = acteurs.map(() => new Array(n).fill(null));
  acteurs.forEach((a, k) => {
    if (!a.monture) return;
    for (let i = 0; i < n; i++) {
      const t = i * DT, nomV = valeurA(a.monture, t);
      if (!nomV) continue;
      const kv = parNom.get(nomV), V = parImage[i][kv], p = parImage[i][k];
      const tv = acteurs[kv].creature?.type;
      const siege = SIEGES[tv] ?? [0, boiteDe(acteurs[kv].creature, types).h, 0];
      const ech = acteurs[kv].creature?.bebe ? 0.5 : 1;
      const dec = a.creature ? (DECALAGE_TYPE[a.creature.type] ?? 0) : DECALAGE_CAVALIER;
      const ya = -(V.lacet ?? 0) * RAD, cs = Math.cos(ya), sn = Math.sin(ya);
      const [sx, sy, sz] = siege.map((v) => v * ech);
      p.x = V.x + sx * cs + sz * sn; p.z = V.z + sz * cs - sx * sn;
      p.y = V.y + (V.dy ?? 0) + sy - dec; p.sol = V.sol; p.auSol = false; p.dy = 0;
      const libre = a.lacet ? norm180(p.lacet - V.lacet) : 0;
      p.lacet = V.lacet + Math.max(-105, Math.min(105, libre));
      p.monture = nomV; p.eau = false;
      montePar[kv][i] = a.nom;
      if (!a.creature) {
        // HumanoidModel.setupAnim, isPassenger : bras -36 degres, jambes levees de 81 degres, ecartees et tournees (18 degres)
        p.brasD = [(p.brasD?.[0] ?? 0) + 36, p.brasD?.[1] ?? 0]; p.brasG = [(p.brasG?.[0] ?? 0) + 36, p.brasG?.[1] ?? 0];
        p.jambeD = [81, 4.5, -18]; p.jambeG = [81, 4.5, -18];
        delete p.genouD; delete p.genouG; delete p.coudeD; delete p.coudeG;
      }
    }
  });
  // ---- 3. creatures : etat d'animation du jeu tick par tick
  acteurs.forEach((a, k) => {
    const c = a.creature;
    if (!c) return;
    const type = c.type, vehicule = VEHICULES.has(type);
    const boite = boiteDe(c, types);
    const nt = Math.ceil(n * DT * 20) + 2;
    // position au tick j (interpolee entre les images)
    const P = (j) => {
      const f = Math.min(n - 1, j / 20 / DT), i0 = Math.floor(f), i1 = Math.min(n - 1, i0 + 1), u = f - i0;
      const a0 = parImage[i0][k], a1 = parImage[i1][k];
      return { x: a0.x + (a1.x - a0.x) * u, y: a0.y + (a1.y - a0.y) * u, z: a0.z + (a1.z - a0.z) * u, auSol: u < 0.5 ? a0.auSol : a1.auSol, eau: !!(u < 0.5 ? a0.eau : a1.eau), i: u < 0.5 ? i0 : i1 };
    };
    const [fm, fa] = MARCHE[type] ?? [4, 0.4];
    const m = vehicule ? {} : etatInitial(type);
    if (!vehicule) { let id = 0; for (const ch of a.nom) id = (id * 31 + ch.charCodeAt(0)) | 0; Object.assign(m, { id, age: -1, bebe: !!c.bebe || m.bebe, coffre: !!c.coffre, tondu: !!c.tondu, taille: c.taille ?? 1, apprivoise: c.colle !== undefined && c.colle !== null, assis: false }); }
    let limbPos = 0, limbSpeed = 0, pagaie = 0, prec = P(0);
    const snaps = [];
    const evts = [];   // { j, nom } animations nommees et speciales
    for (const kf of c.anim ?? []) evts.push({ j: Math.round(kf.t * 20), nom: kf.v });
    let attaque = -100, blesse = -100;
    for (let j = 0; j <= nt; j++) {
      const q = P(j);
      const dx = q.x - prec.x, dz = q.z - prec.z, dy = q.y - prec.y;
      const dist = VOLANTS.has(type) ? Math.hypot(dx, dy, dz) : Math.hypot(dx, dz);
      const avant = limbSpeed;
      const cible = Math.min(dist * fm, 1);
      limbSpeed += (cible - limbSpeed) * fa; limbPos += limbSpeed;
      if (vehicule && dist > 0.01) pagaie += Math.PI / 8;   // Boat.tick : chaque pagaie avance de pi/8 par tick quand on rame
      for (const e of evts) if (e.j === j) { if (e.nom === 'attaque') { attaque = j; if (!vehicule) m.attaque = 10; } if (e.nom === 'blesse') blesse = j; if (e.nom === 'non' && !vehicule) m.mecontent = 40; }
      if (!vehicule) {
        const im = parImage[q.i][k];
        m.auSol = !!q.auSol; m.vy = dy; m.vh = dist; m.dansEau = q.eau; m.nage = q.eau && !m.auSol ? 1 : 0;
        m.agressif = !!valeurA(c.agressif, j / 20);
        m.mainD = im.objetD ? String(im.objetD).replace(/^minecraft:/, '') : null; m.mainG = im.objetG ? String(im.objetG).replace(/^minecraft:/, '') : null;
        m.passager = !!im.monture; m.monte = !!montePar[k][q.i];
        m.gonfle = c.gonfle ? evaluer({ arite: 1, cles: c.gonfle.map((x) => ({ t: x.t, v: [x.v] })) }, j / 20)[0] : 0;
        tick(type, m);
      }
      snaps.push({ limbPos, limbSpeed, avant, pagaie, m: vehicule ? null : structuredClone(m) });
      prec = q;
    }
    for (let i = 0; i < n; i++) {
      const p = parImage[i][k];
      const tt = i * DT * 20, j = Math.floor(tt), al = tt - j;
      const sn = snaps[Math.min(snaps.length - 1, j + 1)];
      const etat = { cacher: [] };
      p.oeil = boite.y; p.hautBoite = boite.h;
      if (vehicule) {
        etat.pagaies = [sn.pagaie, sn.pagaie];
        p.creature = etat; continue;
      }
      // regard : tete vers un acteur ou un point (lacet borne a 75 degres, tangage a 40), sinon la piste tete
      let [yRot, xRot] = p.tete ?? [0, 0];
      const cible = valeurA(c.regarde, i * DT);
      if (cible) {
        const o = typeof cible === 'string' ? parImage[i][parNom.get(cible)] : { x: cible[0], y: cible[1] - 1.62, z: cible[2] };
        const oy = typeof cible === 'string' ? (o.oeil ?? 1.62) : 1.62;
        const ddx = o.x - p.x, ddz = o.z - p.z, ddy = (o.y + oy) - (p.y + boite.y), h = Math.hypot(ddx, ddz);
        yRot += Math.max(-75, Math.min(75, norm180(Math.atan2(-ddx, ddz) / RAD - p.lacet)));
        xRot += Math.max(-40, Math.min(40, -Math.atan2(ddy, h) / RAD));
      }
      const swing = (tt - attaque) >= 0 && (tt - attaque) < 6 ? (tt - attaque) / 6 : 0;   // LivingEntity.swing : 6 ticks
      etat.s = { pos: (sn.limbPos - sn.limbSpeed * (1 - al)) * (c.bebe ? 3 : 1), speed: Math.min(1, sn.avant + (sn.limbSpeed - sn.avant) * al), age: (sn.m?.age ?? tt) - 1 + al, yRot, xRot, swing, baby: !!c.bebe, partial: al };
      etat.m = sn.m;
      // pistes de membres de l'acteur -> rotations de parties (degres) ; quadrupedes : bras = pattes avant, jambes = pattes arriere
      const parties = {};
      const ajoute = (nom, r) => { const x = (parties[nom] ??= [0, 0, 0]); x[0] += r[0]; x[1] += r[1]; x[2] += r[2]; };
      const quad = !!ESPECES[type] && ['Quadruped', 'Sheep', 'Horse', 'Llama', 'Goat', 'Panda', 'PolarBear', 'Hoglin', 'Wolf', 'Feline', 'Fox', 'Camel', 'Creeper', 'Turtle', 'Armadillo', 'Sniffer'].includes(ESPECES[type][2]);
      for (const [champ, nom, lat] of quad ? [['brasD', 'right_front_leg', 1], ['brasG', 'left_front_leg', -1], ['jambeD', 'right_hind_leg', 1], ['jambeG', 'left_hind_leg', -1]] : [['brasD', 'right_arm', 1], ['brasG', 'left_arm', -1], ['jambeD', 'right_leg', 1], ['jambeG', 'left_leg', -1]]) {
        const v = p[champ];
        if (v && (v[0] || v[1])) ajoute(nom, [-(v[0] ?? 0), 0, lat * (v[1] ?? 0)]);
      }
      if (p.penche) ajoute('body', [p.penche, 0, 0]);
      for (const [nom, piste] of Object.entries(c.parties ?? {})) ajoute(nom, evaluer(piste, i * DT));
      etat.parties = parties;
      // animations a images cles nommees : la derniere commencee joue (une animation qui boucle continue jusqu'au nom suivant ou "stop")
      let der = null;
      for (const e of evts) if (e.j <= tt && !['attaque', 'non', 'blesse'].includes(e.nom)) der = e;
      if (der && der.nom && der.nom !== 'stop') etat.nommees = [{ nom: der.nom, ms: (tt - der.j) * 50 }];
      // degats : rougeur 10 ticks
      if (tt - blesse >= 0 && tt - blesse < 10) p.teinte = [1, 0.6, 0.6];
      // creeper qui gonfle (CreeperRenderer.scale, getWhiteOverlayProgress) ; slime, magma : taille et ecrasement (anim.js echelleRendu)
      const g = c.gonfle ? evaluer({ arite: 1, cles: c.gonfle.map((x) => ({ t: x.t, v: [x.v] })) }, i * DT)[0] : 0;
      if (g > 0 || type === 'slime' || type === 'magma_cube') etat.echelleType = echelleRendu(type, { ...sn.m, gonfle: g }, al);
      if (g > 0) etat.blanc = Math.floor(g * 10) % 2 === 0 ? 0 : Math.max(0.5, Math.min(1, g));
      // golem de fer : le corps oscille en marchant (IronGolemRenderer.setupRotations)
      if (type === 'iron_golem' && etat.s.speed >= 0.01) { const wp = etat.s.pos + 6; etat.inclinaison = 6.5 * ((Math.abs((wp % 13) - 6.5) - 3.25) / 3.25); }
      if (['donkey', 'mule', 'llama', 'trader_llama'].includes(type) && !c.coffre) etat.cacher.push('left_chest', 'right_chest');
      if (['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'camel'].includes(type) && !montePar[k][i]) etat.cacher.push('left_saddle_line', 'right_saddle_line');
      if (type === 'spider' || type === 'cave_spider') etat.retourne = true;
      p.creature = etat;
    }
  });
  return notes;
}

// ---------------------------------------------------------------- sons des creatures (planifierSons)
// pas : un pas par bloc parcouru x 0,6 (Entity.moveDist, nextStep), son de pas du type (sinon celui du bloc) ;
// cri : Mob.baseTick (nextInt(1000) < ambientSoundTime++, puis -80 ticks), hauteur (r1 - r2) x 0,2 + 1 ; blessure (anim "blesse") ;
// creeper : amorce quand gonfle quitte 0 ; bateau : un coup de pagaie toutes les 16 ticks quand il avance. `cris: false` coupe les cris.
export function sonsCreature({ a, k, images, sons, ajouter, blocSous, pasAuto }) {
  const c = a.creature, e = ESPECES[c.type], DT = 1 / 30;
  if (!e) return 0;
  let graine = 0; for (const ch of a.nom) graine = (graine * 31 + ch.charCodeAt(0)) >>> 0;
  const alea = () => { graine = (graine * 1664525 + 1013904223) >>> 0; return graine / 4294967296; };
  const place = (i) => { const p = images[i].acteurs[k]; return [p.x, p.y + (p.oeil ?? 1) * 0.6, p.z]; };
  let n = 0;
  // pas
  if (pasAuto && !VEHICULES.has(c.type) && !VOLANTS.has(c.type)) {
    let mouvement = 0, suivant = 1;
    for (let i = 1; i < images.length; i++) {
      const p = images[i].acteurs[k], q = images[i - 1].acteurs[k];
      if (!p.auSol || !q.auSol || p.monture || images[i].fige || p.figee) continue;
      const avant = mouvement;
      mouvement += Math.hypot(p.x - q.x, p.z - q.z) * 0.6;
      if (mouvement > suivant) {
        const t = images[i - 1].t + DT * Math.min(1, Math.max(0, (suivant - avant) / (mouvement - avant)));
        suivant = Math.floor(mouvement) + 1;
        const evt = e[4] ? 'entity.' + e[4] : blocSous(p);
        if (ajouter(evt, t, [p.x, p.y + 0.2, p.z], 1, `pasc|${k}|${n}`)) n++;
      }
    }
  }
  const nt = Math.floor((images.length - 1) * DT * 20);
  const iDe = (j) => Math.min(images.length - 1, Math.round(j / 20 / DT));
  // cris
  if (c.cris !== false && e[3][0]) {
    let temps = 0;
    for (let j = 0; j < nt; j++) {
      if (Math.floor(alea() * 1000) < temps++) { temps = -80; ajouter('entity.' + e[3][0], j / 20, place(iDe(j)), 1, `cri|${k}|${j}`, (alea() - alea()) * 0.2 + 1); }
    }
  }
  for (const kf of c.anim ?? []) if (kf.v === 'blesse' && e[3][1]) ajouter('entity.' + e[3][1], kf.t, place(iDe(kf.t * 20)), 1, `blesse|${k}|${kf.t}`, (alea() - alea()) * 0.2 + 1);
  if (c.type === 'creeper' && c.gonfle) { let avant = 0; for (const kf of c.gonfle) { if (avant === 0 && kf.v > 0) ajouter('entity.creeper.primed', kf.t, place(iDe(kf.t * 20)), 1, `amorce|${k}|${kf.t}`, 0.5); avant = kf.v; } }
  if (c.type.includes('boat')) {
    let phase = 0;
    for (let i = 1; i < images.length; i++) {
      const p = images[i].acteurs[k], q = images[i - 1].acteurs[k];
      const avant = phase;
      if (Math.hypot(p.x - q.x, p.z - q.z) * 20 * DT * 20 > 0.01 * 20) phase += DT * 20;
      if (Math.floor(avant / 16) !== Math.floor(phase / 16)) ajouter(p.eau ? 'entity.boat.paddle_water' : 'entity.boat.paddle_land', images[i].t, [p.x, p.y + 0.3, p.z], 0.6, `pagaie|${k}|${i}`);
    }
  }
  return n;
}
