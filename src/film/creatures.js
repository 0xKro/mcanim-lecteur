// Creatures dans l'animation (apres la passe 1 de anim.js) : montures (le cavalier suit le siege de sa monture, pose assise du jeu),
// puis pour chaque creature l'etat d'animation du jeu tick par tick (WalkAnimationState : les pattes suivent la distance parcourue,
// horloges des especes), regard, pistes de parties, gonflement du creeper, animations nommees. Le rendu (creatures/rendu.js) lit
// `pose.creature`. Une scene sans creature ni monture ne passe pas par ici.
import { ESPECES, SIEGES, DECALAGE_CAVALIER, VEHICULES, couleurLaine } from '../creatures/especes.js';
import { etatInitial, tick, echelleRendu, demarrer } from '../creatures/anim.js';
import { evaluer } from './scene.js';
import { attacheCreature, mainJoueur, tenueCreature, noeudBarriere } from '../creatures/laisse.js';

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
export function appliquerCreatures(scene, parImage, { DT = 1 / 30, terrain = {}, types = {}, replay = null } = {}) {
  const acteurs = scene.acteurs, n = parImage.length;
  const parNom = new Map(acteurs.map((a, k) => [a.nom, k]));
  const notes = [];
  // ---- 1. vehicules : un bateau flotte a la surface de l'eau (sinon il reste au sol)
  acteurs.forEach((a, k) => {
    if (!a.creature || !VEHICULES.has(a.creature.type) || !terrain.eauEn) return;
    for (let i = 0; i < n; i++) { const p = parImage[i][k]; if (!a.creature.type.includes('boat')) continue; const e = terrain.eauEn(p.x, p.z); if (e !== null && e !== undefined && e > p.y) { p.y = e - 0.1; p.eau = true; p.auSol = false; } }
  });
  // ---- 2a. qui monte quoi a chaque image (ordre des passagers = ordre des acteurs, comme getPassengers)
  const montePar = acteurs.map(() => new Array(n).fill(null));       // premier cavalier (conducteur) de chaque monture
  const passagers = acteurs.map(() => new Array(n).fill(null));      // liste des cavaliers de chaque monture
  const vehiculeDe = acteurs.map(() => new Array(n).fill(-1));       // monture de chaque cavalier
  acteurs.forEach((a, k) => {
    if (!a.monture) return;
    for (let i = 0; i < n; i++) {
      const nomV = valeurA(a.monture, i * DT);
      if (!nomV) continue;
      const kv = parNom.get(nomV);
      vehiculeDe[k][i] = kv; parImage[i][k].monture = nomV;
      (passagers[kv][i] ??= []).push(k);
      montePar[kv][i] ??= a.nom;
    }
  });
  // ---- 3a. creatures : etat d'animation du jeu tick par tick (les cavaliers ne marchent pas : leurs pattes ne suivent pas le trajet)
  const etats = acteurs.map((a, k) => (a.creature ? etatTicks(a, k) : null));
  function etatTicks(a, k) {
    const c = a.creature;
    const type = c.type, vehicule = VEHICULES.has(type);
    const nt = Math.ceil(n * DT * 20) + 2;
    // position au tick j (interpolee entre les images)
    const P = (j) => {
      const f = Math.max(0, Math.min(n - 1, j / 20 / DT)), i0 = Math.floor(f), i1 = Math.min(n - 1, i0 + 1), u = f - i0;
      const a0 = parImage[i0][k], a1 = parImage[i1][k];
      return { x: a0.x + (a1.x - a0.x) * u, y: a0.y + (a1.y - a0.y) * u, z: a0.z + (a1.z - a0.z) * u, auSol: u < 0.5 ? a0.auSol : a1.auSol, eau: !!(u < 0.5 ? a0.eau : a1.eau), i: u < 0.5 ? i0 : i1 };
    };
    const [fm, fa] = MARCHE[type] ?? [4, 0.4];
    const m = vehicule ? {} : etatInitial(type);
    const ia = c.ia && replay ? etatsIA(replay, a._trace ?? a.nom) : null;   // creature a IA : son etat d'animation tick par tick (moteur/ia.js, replay.ia)
    if (!vehicule) { let id = 0; for (const ch of a.nom) id = (id * 31 + ch.charCodeAt(0)) | 0; Object.assign(m, { id, age: -1, bebe: !!c.bebe || m.bebe, coffre: !!c.coffre, tondu: !!c.tondu, taille: c.taille ?? 1, apprivoise: c.colle !== undefined && c.colle !== null, assis: false, bloc: !!c.porte }); }
    // lapin : il ne se deplace qu'en sautant (RabbitMoveControl) : sauts du jeu poses sur le trajet ecrit (sautsLapin)
    const sauts = type === 'rabbit' && c.sautille !== false ? sautsLapin(P, nt, vehiculeDe[k]) : null;
    const Q = sauts ? (j) => { const q = P(j), r = sauts.position(j); return { ...q, x: r.x, z: r.z, y: q.y + r.h, auSol: q.auSol && r.h <= 0 }; } : P;
    let limbPos = 0, limbSpeed = 0, pagaie = 0, prec = Q(0);
    const snaps = [];
    const evts = [];   // { j, nom } animations nommees et speciales
    for (const kf of c.anim ?? []) evts.push({ j: Math.round(kf.t * 20), nom: kf.v });
    let attaque = -100, blesse = -100;
    for (let j = 0; j <= nt; j++) {
      const q = Q(j);
      const passager = vehiculeDe[k][q.i] >= 0;
      const dx = passager ? 0 : q.x - prec.x, dz = passager ? 0 : q.z - prec.z, dy = passager ? 0 : q.y - prec.y;
      const dist = VOLANTS.has(type) ? Math.hypot(dx, dy, dz) : Math.hypot(dx, dz);
      const avant = limbSpeed;
      const cible = Math.min(dist * fm, 1);
      limbSpeed += (cible - limbSpeed) * fa; limbPos += limbSpeed;
      if (vehicule && dist > 0.01) pagaie += Math.PI / 8;   // Boat.tick : chaque pagaie avance de pi/8 par tick quand on rame
      for (const e of evts) if (e.j === j) { if (e.nom === 'attaque') { attaque = j; if (!vehicule) m.attaque = 10; } if (e.nom === 'blesse') blesse = j; if (e.nom === 'non' && !vehicule) m.mecontent = 40; if (e.nom === 'broute' && !vehicule) m.broute = 40; }
      if (!vehicule) {
        const im = parImage[q.i][k];
        m.auSol = !!q.auSol; m.vy = dy; m.vh = dist; m.dansEau = q.eau; m.nage = q.eau && !m.auSol ? 1 : 0;
        const e = ia?.get(j);
        m.agressif = c.agressif ? !!valeurA(c.agressif, j / 20) : !!(e && e.dr & 1);
        if (e?.attaque && !vehicule) { m.attaque = 10; attaque = j; }
        if (e && (e.dr & 4)) m.utilise = e.tension;
        m.mainD = im.objetD ? String(im.objetD).replace(/^minecraft:/, '') : null;
        if (type === 'enderman' && c.ia) { m.bloc = !!m.mainD; m.mainD = null; }   // CarriedBlockLayer : bras leves quand il porte un bloc m.mainG = im.objetG ? String(im.objetG).replace(/^minecraft:/, '') : null;
        m.passager = passager; m.monte = !!montePar[k][q.i];
        m.gonfle = c.gonfle ? evaluer({ arite: 1, cles: c.gonfle.map((x) => ({ t: x.t, v: [x.v] })) }, j / 20)[0] : (e?.gonfle ?? 0);
        m._ia = e ?? null;
        if (e) etatEspece(type, m, e);   // drapeaux des especes (moteur/ia-especes.js) : perche, sommeil, boit, cri, charge, epaule, non, dard
        if (e) etatPlus(type, m, e, j, im.lacet ?? 0, false);   // wither, dragon, warden, gardien, axolotl, tortue
        tick(type, m);
        if (e) etatPlus(type, m, e, j, im.lacet ?? 0, true);    // calmar et tetes du wither : apres l'horloge du tick
      }
      snaps.push({ limbPos, limbSpeed, avant, pagaie, m: vehicule ? null : structuredClone(m) });
      prec = q;
    }
    return { snaps, evts, attaque, blesse, sauts };
  }
  // instantane du tick de l'image i (et la fraction de tick)
  function snapA(k, i) { const tt = i * DT * 20, j = Math.floor(tt), sn = etats[k].snaps; return { sn: sn[Math.min(sn.length - 1, j + 1)], al: tt - j, tt }; }

  // ---- 2b. cavaliers : sur le siege de leur monture a chaque image (Entity.positionRider), pose assise du jeu.
  // Siege = point d'attache du type (riders.rs passenger_attachment, MIT) + son animation : cheval cabre (AbstractHorse, standAnim),
  // strider qui se dandine (Strider.getPassengerAttachmentPoint), dromadaire (2 places, assis), bateau (2 places).
  // Corps : celui de la monture vivante (LivingEntityRenderer.solveBodyRot : 85 degres au plus de la tete), du bateau (Boat.clampRotation,
  // tete a +-105) ; wagonnet : le sien. La monture est deja a sa place de l'image : le cavalier la suit image par image, sans retard.
  for (const [k, a] of acteurs.entries()) {
    if (!a.monture) continue;
    for (let i = 0; i < n; i++) {
      const kv = vehiculeDe[k][i];
      if (kv < 0) continue;
      const V = parImage[i][kv], p = parImage[i][k], av = acteurs[kv];
      const tv = av.creature?.type;
      const liste = passagers[kv][i], rang = liste.indexOf(k), nb = liste.length;
      const animal = !!a.creature && (types?.[a.creature.type]?.c === 1);
      const [sx, sy, sz] = siegeDe(av, tv, rang, nb, animal, kv, i);
      const dec = a.creature ? (DECALAGE_TYPE[a.creature.type] ?? 0) : DECALAGE_CAVALIER;
      const ya = -(V.lacet ?? 0) * RAD, cs = Math.cos(ya), sn = Math.sin(ya);
      p.x = V.x + sx * cs + sz * sn; p.z = V.z + sz * cs - sx * sn;
      p.y = V.y + (V.dy ?? 0) + (V.hauteur ?? 0) + sy - dec; p.sol = V.sol; p.auSol = false; p.dy = 0;
      // regard voulu (absolu) : la piste lacet du cavalier + sa tete ; sans piste lacet, il regarde ou va sa monture
      const tete = p.tete ?? [0, 0];
      const voulu = (a.lacet ? p.lacet : V.lacet) + (tete[0] ?? 0);
      let corps;
      if (tv && tv.includes('minecart')) corps = a.lacet ? p.lacet : V.lacet;
      else if (tv && tv.includes('boat')) corps = V.lacet;
      else { const d = Math.max(-85, Math.min(85, norm180(voulu - V.lacet))); corps = voulu - d; if (Math.abs(d) > 50) corps += d * 0.2; }
      p.lacet = corps;
      const lim = tv && tv.includes('boat') ? 105 : 85;
      p.tete = [Math.max(-lim, Math.min(lim, norm180(voulu - corps))), tete[1] ?? 0];
      p.monture = av.nom; p.eau = false;
      if (!a.creature) {
        // HumanoidModel.setupAnim, isPassenger : bras -36 degres, jambes levees de 81 degres, ecartees et tournees (18 degres)
        p.brasD = [(p.brasD?.[0] ?? 0) + 36, p.brasD?.[1] ?? 0]; p.brasG = [(p.brasG?.[0] ?? 0) + 36, p.brasG?.[1] ?? 0];
        p.jambeD = [81, 4.5, -18]; p.jambeG = [81, 4.5, -18];
        delete p.genouD; delete p.genouG; delete p.coudeD; delete p.coudeG;
      }
    }
  }
  // point d'attache du siege [droite, haut, avant] (blocs, depuis les pieds) de la monture kv a l'image i
  function siegeDe(av, tv, rang, nb, animal, kv, i) {
    const ech = av.creature?.bebe ? 0.5 : 1;
    if (tv === 'camel') {   // Camel.getPassengerAttachmentPoint (camel.rs passenger_attachment_at, body_anchor_y)
      const e = av.creature?.bebe ? 0.6 : 1, st = etats[kv] ? snapA(kv, i).sn.m : null;
      let h = boiteDe(av.creature, types).h - (av.creature?.bebe ? 0.09375 : 0.375);
      if (st?.assis) h += -1.43 * e + 0.2 * e;
      let z = 0.5;
      if (nb > 1) { if (rang > 0) z = -0.7; if (animal) z += 0.2; }
      return [0, h, z * e];
    }
    if (tv === 'boat' || tv === 'chest_boat') {   // boats.rs seat
      let z = tv === 'chest_boat' ? 0.15 : 0;
      if (nb > 1 && tv === 'boat') { z = rang === 0 ? 0.2 : -0.6; if (animal) z += 0.2; }
      return [0, SIEGES[tv][1], z];
    }
    const base = (SIEGES[tv] ?? [0, boiteDe(av.creature, types).h, 0]).map((v) => v * ech);
    if (!etats[kv] || VEHICULES.has(tv)) return base;
    const { sn, al } = snapA(kv, i);
    if (['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse'].includes(tv) && sn.m) {   // equine.rs rear_offset
      const st = sn.m.anim.vo[1] + (sn.m.anim.v[1] - sn.m.anim.vo[1]) * al;
      return [base[0], base[1] + 0.15 * st * ech, base[2] - 0.7 * st * ech];
    }
    if (tv === 'strider') {   // Strider.getPassengerAttachmentPoint : le siege suit le dandinement des pattes
      const h = 0.12 * Math.cos(sn.limbPos * 1.5) * 2 * Math.min(0.25, sn.limbSpeed);
      return [base[0], base[1] + h * ech, base[2]];
    }
    return base;
  }

  // ---- 3b. creatures : etat de rendu de chaque image
  acteurs.forEach((a, k) => {
    const c = a.creature;
    if (!c) return;
    const type = c.type, vehicule = VEHICULES.has(type);
    const boite = boiteDe(c, types);
    const { evts, sauts, attaque, blesse } = etats[k];
    for (let i = 0; i < n; i++) {
      const p = parImage[i][k];
      const { sn, al, tt } = snapA(k, i);
      const etat = { cacher: [] };
      p.oeil = boite.y; p.hautBoite = boite.h;
      if (vehicule) {
        etat.pagaies = [sn.pagaie, sn.pagaie];
        if (c.contenu) etat.contenu = c.contenu;
        p.creature = etat; continue;
      }
      if (sauts && vehiculeDe[k][i] < 0) {   // lapin : position du saut (le trajet n'avance qu'en l'air) et hauteur de l'arc
        const q = sauts.position(tt); p.x = q.x; p.z = q.z; p.dy = (p.dy ?? 0) + q.h; if (q.h > 0) p.auSol = false;
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
      const ie = sn.m?._ia;   // IA : tangage du corps (PhantomRenderer), lit (LivingEntityRenderer, Pose.SLEEPING), textures d'etat
      if (ie) {
        if (type === 'phantom') etat.tangage = ie.tangage;
        if (ie.dr & 8192) etat.couche = { lacet: ie.lit, oeil: boite.y };
        if ((type === 'ghast' || type === 'vex') ? ie.dr & 128 : false) etat.alt = true;
        if (type === 'bee' && !c.bebe && (ie.dr & (1 | 65536))) etat.texEtat = `bee/bee${ie.dr & 1 ? '_angry' : ''}${ie.dr & 65536 ? '_nectar' : ''}`;   // BeeRenderer : en colere, avec du nectar
        if (ie.dr & 131072) { p.y -= 1000; p.absent = true; }                       // abeille dans la ruche : pas dessinee
        if (ie.dr & 262144) etat.tremble = true;                                    // conversion (zombie qui se noie, zombie villageois qui guerit) : il tremble
      }
      if (type === 'enderman' && c.ia) { etat.porte = p.objetD ? String(p.objetD).replace(/^minecraft:/, '') : null; delete p.objetD; }   // bloc pris par l'enderman (ia-vie.js)
      // mouton nomme jeb_ (etiquette) : laine arc-en-ciel (SheepWoolLayer : une couleur toutes les 25 ticks, fondu entre les deux)
      if (type === 'sheep' && a.etiquette === 'jeb_') {
        const age = etat.s.age, k = Math.floor(age / 25) + Math.abs(sn.m?.id ?? 0), f = ((age % 25) + 25) % 25 / 25;
        const A = couleurLaine(((k % 16) + 16) % 16), B = couleurLaine((((k + 1) % 16) + 16) % 16);
        etat.teinteLaine = A.map((v, j) => v + (B[j] - v) * f);
      }
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
      for (const e of evts) if (e.j <= tt && !['attaque', 'non', 'blesse', 'broute'].includes(e.nom)) der = e;
      if (der && der.nom && der.nom !== 'stop') etat.nommees = [{ nom: der.nom, ms: (tt - der.j) * 50 }];
      // degats : rougeur 10 ticks
      if (tt - blesse >= 0 && tt - blesse < 10) p.rouge = true;   // surcouche rouge du jeu (OverlayTexture, hasRedOverlay) : voir creatures/rendu.js
      // creeper qui gonfle (CreeperRenderer.scale, getWhiteOverlayProgress) ; slime, magma : taille et ecrasement (anim.js echelleRendu)
      const g = c.gonfle ? evaluer({ arite: 1, cles: c.gonfle.map((x) => ({ t: x.t, v: [x.v] })) }, i * DT)[0] : (sn.m?.gonfle ?? 0);
      if (g > 0 || type === 'slime' || type === 'magma_cube') etat.echelleType = echelleRendu(type, { ...sn.m, gonfle: g }, al);
      if (g > 0) etat.blanc = Math.floor(g * 10) % 2 === 0 ? 0 : Math.max(0.5, Math.min(1, g));
      // golem de fer : le corps oscille en marchant (IronGolemRenderer.setupRotations)
      if (type === 'iron_golem' && etat.s.speed >= 0.01) { const wp = etat.s.pos + 6; etat.inclinaison = 6.5 * ((Math.abs((wp % 13) - 6.5) - 3.25) / 3.25); }
      if (['donkey', 'mule', 'llama', 'trader_llama'].includes(type) && !c.coffre) etat.cacher.push('left_chest', 'right_chest');
      if (['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'camel'].includes(type) && !montePar[k][i]) etat.cacher.push('left_saddle_line', 'right_saddle_line');
      if (c.coiffe) { etat.coiffe = c.coiffe; etat.coiffeSkin = c.coiffeSkin ?? null; }   // bloc ou tete porte sur la tete (CustomHeadLayer, creatures/rendu.js)
      if (c.cacher) etat.cacher.push(...c.cacher);   // entite importee (decor/entites-import.js) : porte-armure sans bras, sans socle, invisible
      if (type === 'spider' || type === 'cave_spider') etat.retourne = true;
      if (type === 'wither') {   // WitherBossRenderer.scale : x 2, plus petit pendant la charge (2 - (charge - partiel) / 220 x 0,5) ; texture bleue qui clignote
        const inv = sn.m?._invul ?? 0;
        etat.echelle = 2 - (inv > 0 ? (inv - al) / 220 * 0.5 : 0);
        if (inv > 0 && (inv > 80 || Math.floor(inv / 5) % 2 !== 1)) etat.texEtat = 'wither/wither_invulnerable';
        if (sn.m?._armure) etat.armure = true;
      }
      if (type === 'end_crystal') etat.echelle = 2;   // EndCrystalRenderer : x 2
      if (type === 'ender_dragon' && ie) {   // EnderDragonRenderer : tangage de l'historique de vol ; mort : texture qui se defait (dragon_exploding)
        etat.tangage = ie.tangage;
        const mt = sn.m?._mortDragon ?? -1;
        if (mt > 0) etat.dissolution = Math.min(1, (mt - 1 + al) / 200);
      }
      if (type === 'dolphin' && sn.m?._tangage) etat.tangage = sn.m._tangage;
      // poissons (CodRenderer, SalmonRenderer, TropicalFishRenderer.setupRotations) : le corps ondule en lacet ; hors de l'eau il se couche
      // sur le flanc (rotation Z de 90 degres) et se debat plus vite (saumon : x 1,3 d'amplitude, x 1,7 de frequence)
      if (type === 'cod' || type === 'salmon' || type === 'tropical_fish') {
        const hors = !sn.m.dansEau, age = etat.s.age;
        const [fa, fg] = type === 'salmon' && hors ? [1.3, 1.7] : [1, 1];
        etat.poisson = { lacet: fa * 4.3 * Math.sin(fg * 0.6 * age), avant: type === 'salmon' ? [0, 0, -0.4] : [0, 0, 0], hors, decal: type === 'cod' ? [0.1, 0.1, -0.1] : [0.2, 0.1, 0] };
      }
      p.creature = etat;
      // laisse : points d'attache de la corde (creatures/laisse.js) ; une creature a IA dont la laisse a casse (replay.ia) n'en a plus
      if (c.laisse) {
        let v = valeurA(c.laisse, i * DT);
        if (v && c.ia && ie && !(ie.dr & 16384)) v = null;
        if (v) {
          const de = attacheCreature(p, boite.y, boite.l, type);
          let vers, noeud = null;
          if (Array.isArray(v)) { vers = noeudBarriere(v); noeud = v; }
          else { const kh = parNom.get(v), h = parImage[i][kh], ah = acteurs[kh]; vers = ah.creature ? tenueCreature(h, boiteDe(ah.creature, types).y) : mainJoueur(h); }
          p.laisse = { de, vers, noeud };
        }
      }
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

// drapeaux des especes (moteur/ia-especes.js, D) -> champs d'animation de m (creatures/anim.js)
function etatEspece(type, m, e) {
  const d = e.dr;
  if (type === 'bat') m.perche = !!(d & 16);
  if (d & 32) m.mainD = 'potion';                        // sorciere qui boit (WitchModel : le nez s'ecarte, la potion en main)
  if (type === 'enderman') m.cri = !!(d & 64);            // DATA_CREEPY : bouche ouverte
  if (type === 'vex') m.charge = !!(d & 128);
  if (type === 'pillager') { m.charge = !!(d & 4); m.dureeCharge = 25; }   // arbalete qui se charge (Pillager.getArmPose : CROSSBOW_CHARGE ; 25 ticks)
  if (type === 'bee') m.dard = !(d & 256);
  if (d & 1024) m.mecontent = 40;                         // villageois qui secoue la tete (setUnhappy)
  if (type === 'parrot') m.assis = !!(d & 4096);          // sur l'epaule : pose assise du perroquet
  if (d & 8192) m.dort = true; else if (type === 'villager' || type === 'wandering_trader') m.dort = false;
  if (type === 'parrot') m.fete = !!(d & 2048);           // perroquet qui danse pres d'un juke-box (ParrotModel.State.PARTY)
  if (type === 'allay') m.danse = !!(d & 2048);           // allay qui danse (Allay.isDancing)
}

// etats d'IA d'un acteur (replay.ia) : Map tick -> { dr, gonfle, tension, attaque, plus (colonne iaPlus : wither, dragon, gardiens, warden, calmar) }
function etatsIA(replay, nom) {
  const id = replay.acteurs.indexOf(nom), R = replay.iaVue, m = new Map();
  if (id < 0 || !R) return m;
  for (let i = 0; i < R.length; i += 8) if (R[i + 1] === id) m.set(R[i] / (replay.ralenti || 1), { dr: R[i + 2], gonfle: R[i + 3], tension: R[i + 4], attaque: R[i + 5] > 0, tangage: R[i + 6], lit: R[i + 7] });
  const X = replay.iaPlusVue;
  if (X?.length) for (let i = 0; i < X.length; i += 8) if (X[i + 1] === id) { const e = m.get(X[i] / (replay.ralenti || 1)); if (e) e.plus = Array.from(X.subarray(i + 2, i + 8)); }
  return m;
}
// colonne iaPlus et drapeaux des dernieres creatures (moteur/ia-boss.js, ia-eau.js, ia-warden.js, ia-oeufs.js) -> champs d'animation
const POSTURES_WARDEN = ['standing', 'emerging', 'digging', 'roaring', 'sniffing'];
function etatPlus(type, m, e, j, lacetCorps, apres) {
  const d = e.dr, x = e.plus;
  if (apres) {
    if ((type === 'squid' || type === 'glow_squid') && x) { const v = m.anim.v; v[0] = x[0]; v[1] = x[1]; v[2] = x[2]; v[3] = x[3]; }
    if (type === 'wither' && x) for (let k = 0; k < 2; k++) { m.anim.v[k] = norm180(x[1 + k] - lacetCorps); m.anim.v[2 + k] = x[3 + k]; }
    return;
  }
  if (type === 'wither' && x) { m._invul = x[0]; for (let k = 0; k < 2; k++) { m.anim.v[k] = norm180(x[1 + k] - lacetCorps); m.anim.v[2 + k] = x[3 + k]; } m._armure = !!(d & (1 << 19)); }
  if (type === 'ender_dragon') { m.assis = !!(d & (1 << 20)); if (x) m._mortDragon = x[1]; }
  if (type === 'warden' && x) {
    m.posture = POSTURES_WARDEN[x[0]] ?? 'standing'; m.colere = x[2];
    if (x[3] === j) m.vibration = true;
    if (x[4] === j) demarrer('warden', m, 'attack');
    if (x[5] === j) demarrer('warden', m, 'sonic_boom');
  }
  if (type === 'breeze' && x) m.posture = ['idle', 'shooting', 'inhaling', 'long_jumping', 'sliding'][x[0]] ?? 'idle';   // pose du cerveau (moteur/ia-breeze.js)
  if ((type === 'squid' || type === 'glow_squid') && x) { const v = m.anim.v; v[0] = x[0]; v[1] = x[1]; v[2] = x[2]; v[3] = x[3]; }
  if (type === 'guardian' || type === 'elder_guardian') m.bouge = !!(d & (1 << 21));
  if (type === 'axolotl') { m.mortFeinte = !!(d & (1 << 22)); m.bouge = !!(d & (1 << 21)); }
  if (type === 'turtle') { m.oeuf = !!(d & (1 << 24)); m.pond = !!(d & (1 << 25)); }
  if (type === 'dolphin' && x) m._tangage = x[0];
}

// ---------------------------------------------------------------- sauts du lapin (Rabbit.getJumpPower, RabbitMoveControl, setLandingDelay)
// Le lapin n'avance qu'en l'air : saut a 0,2 (flanerie, modificateur <= 0,6) ou 0,3 (plus vite), gravite 0,08 et frottement 0,98 par tick,
// puis 10 ticks au sol (1 tick en fuite, modificateur 2,2). Le temps du trajet ecrit n'avance que pendant les sauts : a la fin de chaque
// saut le lapin a rattrape sa piste (elle reste la reference). P(j) : position du trajet au tick j ; monte[i] >= 0 : image en monture.
export function sautsLapin(P, nt, monte = []) {
  const tau = new Float64Array(nt + 2), h = new Float64Array(nt + 2);
  const loin = (a, b) => { const p = P(a), q = P(b); return Math.hypot(p.x - q.x, p.z - q.z); };
  let t = 0, j = 0;
  while (j <= nt) {
    if (monte[P(j).i] >= 0 || loin(j, t) < 0.05) { if (loin(j, t) < 0.05 || monte[P(j).i] >= 0) t = j; tau[j] = t; h[j] = 0; j++; continue; }
    const v = loin(j, Math.min(nt, j + 20)) / 20;   // vitesse de la piste (bloc/tick)
    const rapide = v > 0.15;
    let vy = rapide ? 0.3 : 0.2, y = 0;
    const arc = [];
    do { y += vy; vy = (vy - 0.08) * 0.98; arc.push(Math.max(0, y)); } while (y > 0 && arc.length < 40);
    const d = arc.length, repos = rapide ? 1 : 10;
    const t0 = t, t1 = Math.min(nt, j + d + repos);
    for (let s = 0; s < d && j <= nt; s++, j++) { tau[j] = t0 + (t1 - t0) * (s + 1) / d; h[j] = arc[s]; }
    t = t1;
    for (let s = 0; s < repos && j <= nt; s++, j++) { tau[j] = t; h[j] = 0; }
  }
  const lire = (tab, x) => { const a = Math.max(0, Math.min(nt, Math.floor(x))), b = Math.min(nt, a + 1), u = Math.max(0, Math.min(1, x - a)); return tab[a] + (tab[b] - tab[a]) * u; };
  return { h, position: (x) => { const q = P(lire(tau, x)); return { x: q.x, z: q.z, h: lire(h, x) }; } };
}
