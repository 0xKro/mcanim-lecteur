// Film : anime la scene, dessine les images (terrain + personnages), envoie tout a ffmpeg (H.264 + AAC).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { poseApercu } from '../incrust/apercu-joueur.js';   // joueur de l'ecran d'inventaire (partie 26)
import { spawn } from 'node:child_process';
import { chargerScene } from '../rendu/scene.js';
import { encoderPNG, decoderPNG } from '../rendu/png.js';
import { animer } from './anim.js';
import { terrainDepuis } from './physique.js';
import { descripteursActeurs, gabaritCreature } from './actes.js';   // acteurs a intentions (champ `actes`) pour la simulation
import { statsDe } from './creatures.js';
import { ajouterNaissances } from './naissances.js';   // entites nees pendant la simulation : acteurs de plus
import { evaluer } from './scene.js';
import { imageEn, cielEn, obscuriteDe } from './look.js';
import { facteurCielMeteo } from './meteo.js';
import { Personnage } from '../perso/modele.js';
import { maillageEtiquette } from '../creatures/etiquette.js';   // etiquette de nom (champ `etiquette`)
import { resoudreSkin } from '../perso/skin.js';
import { lireMasque } from '../perso/masque.js';
import { Sons, planifierSons, mixer, FREQUENCE, VOLUME_MIXAGE } from './sons.js';
import { trouverFfmpeg } from './ffmpeg.js';
import { appliquerTextures } from './cache.js';
import { filigrane, tailleApercu, formatApercu } from './apercu.js';
import { encoderJPEG } from '../rendu/jpeg.js';
import { lireShader } from '../shader/format.js';
import { creerComposition } from '../montage/composition.js';
import { melangerCouleur } from '../montage/effets-image.js';   // montage : effets d'image, transitions, incrustations (rien sans ces champs)
import { mixerFichiers } from '../montage/audio.js';   // montage : fichiers audio de sons.fichiers

// Fichier de shader a utiliser : l'option (chemin deja resolu) l'emporte sur le champ `shader` de la scene (relatif au fichier de scene).
export function fichierShader(scene, baseDir, option) {
  if (option) return path.resolve(option);
  return scene.shader ? path.resolve(baseDir, scene.shader) : null;
}

// Prepare les skins de tous les acteurs. `surcharges` : { nomActeur: "fichier.png" } (option --skin).
// Retourne { personnages (le skin de base de chaque acteur), parRef (par acteur : Map "reference de skin" -> Personnage, pour la
// piste `skins`), infos }. Le masque de couleur selective (champ `masque`) est lu une fois par acteur et partage par tous ses skins.
export async function preparerPersonnages(scene, { kitDir, surcharges = {}, baseDir, resoudre: resoudreBrut = resoudreSkin, creatures = null }) {
  const personnages = [], parRef = [], infos = [];
  // cache des skins (foule de 40 joueurs, 150 acteurs) : un meme skin (pseudo, fichier, skin par defaut) n'est lu, decode ou telecharge
  // qu'une fois ; les acteurs qui le portent partagent ses pixels (lecture seule)
  const memo = new Map();
  const resoudre = (args) => {
    const cle = JSON.stringify([args.description, args.modele ?? null, args.surcharge ?? null]);
    if (!memo.has(cle)) memo.set(cle, resoudreBrut(args));
    return memo.get(cle);
  };
  for (const a of scene.acteurs) {
    if (a.creature) {   // creature (champ `type`) : modele et textures du jeu (creatures/rendu.js), pas de skin
      const { Creature } = await import('../creatures/rendu.js');
      const c = new Creature({ ...a.creature, armure: armureFixe(a) }, creatures, kitDir);
      personnages.push(c); parRef.push(new Map());
      infos.push({ acteur: a.nom, modele: a.creature.type, origine: 'creature', detail: c.notes.join(' ; ') || null, repli: false });
      continue;
    }
    const masque = a.masque ? lireMasque(a.masque, baseDir) : null;
    const r = await resoudre({ description: a.skin, modele: a.modele, kitDir, surcharge: surcharges[a.nom], baseDir });
    personnages.push(new Personnage({ rgba: r.rgba, modele: r.modele, masque }));
    infos.push({ acteur: a.nom, modele: r.modele, origine: r.origine, detail: r.detail, repli: r.repli });
    // autres skins : meme modele de corps que le skin de base (le corps ne change pas de forme en cours de scene)
    const refs = new Map();
    for (const k of a.skins?.cles ?? []) {
      if (refs.has(k.ref)) continue;
      const s = await resoudre({ description: k.ref, modele: a.modele ?? r.modele, kitDir, baseDir });
      refs.set(k.ref, new Personnage({ rgba: s.rgba, modele: r.modele, masque }));
      infos.push({ acteur: a.nom, modele: r.modele, origine: s.origine, detail: s.detail, repli: s.repli });
    }
    parRef.push(refs);
  }
  return { personnages, parRef, infos };
}

// Entites definies par les mods (mc.definirEntite, moteur/perso.js) : l'acteur qui porte "mod" recoit l'echelle et la texture de la scene
// (meme disposition que la texture du type copie). Le moteur a deja verifie que l'identifiant existe et que le type correspond.
function appliquerEntitesScene(scene, defs, baseDir) {
  const parId = new Map(defs.map((d) => [d.id, d]));
  for (const a of scene.acteurs) {
    const def = a.mod && a.creature ? parId.get(a.mod) : null;
    if (!def) continue;
    let texture = null;
    if (def.texture) {
      const f = path.resolve(baseDir, def.texture);
      if (path.relative(path.resolve(baseDir), f).startsWith('..') || !fs.existsSync(f)) throw new Error(`mc.definirEntite('${def.id}').texture : fichier introuvable : ${def.texture} (chemin relatif au fichier de scene)`);
      const im = decoderPNG(fs.readFileSync(f));
      texture = { largeur: im.largeur, hauteur: im.hauteur, rgba: im.rgba };
    }
    a.creature = { ...a.creature, perso: { id: def.id, echelle: def.echelle, texture } };
  }
}

// armure d'une creature : la premiere valeur de chaque emplacement (les creatures gardent leur armure toute la scene)
function armureFixe(a) {
  if (!a.armure) return null;
  const o = {};
  for (const [e, p] of Object.entries(a.armure)) { const k = p.cles?.find((x) => x.id); if (k) o[e] = k.id; }
  return o;
}

// Etat d'un joueur simule au temps du monde tm (secondes) : la derniere ligne de replay.etats (moteur/inventaire.js ecrireEtat) ; null s'il n'y en a pas
export function etatJoueurDe(replay) {
  const parActeur = new Map();
  for (const l of replay.etats) { if (!parActeur.has(l[1])) parActeur.set(l[1], []); parActeur.get(l[1]).push(l); }
  return (nom, tm) => {
    const L = parActeur.get(replay.acteurs.indexOf(nom));
    if (!L) return null;
    const k = tm * 20 * (replay.ralenti || 1);
    let l = null;
    for (const x of L) { if (x[0] <= k) l = x; else break; }
    if (!l) return null;
    return { vie: l[2], vieMax: l[3], faim: l[4], saturation: l[5], absorption: l[6], niveau: l[7], progres: l[8], armure: l[9], air: l[10], objet: l[11], poison: l[12], faimEffet: l[13], nombre: l[14], barre: l[15],
      cases: String(l[16] ?? '').split(';').filter(Boolean).map((s) => { const i = s.lastIndexOf('*'); return [s.slice(0, i), Number(s.slice(i + 1))]; }) };   // cases 1 a 8 de la barre
  };
}

// Simulation du jeu d'une scene avec un champ `monde` : { zone, donnees, replay, rapport, notes, secondes }. Gratuit (pas de jeton) : meme calcul pour
// `mcanim simuler`, `apercu` et `rendre` (graine fixee : memes blocs a chaque fois).
export async function simulerScene({ scene, zonePath, baseDir, env = process.env, kitDir = null }) {
  const t0 = performance.now();
  const { lireZone } = await import('../rendu/zone.js');
  const { simuler } = await import('../moteur/index.js');
  const { donneesDuJeu } = await import('../moteur/chargeur.js');
  let zone = lireZone(zonePath);
  const donnees = await donneesDuJeu({ env });
  // decors de la scene (docs/FORMAT-DECOR.md) : appliques a une copie de la zone AVANT la simulation et le maillage ; rien sans champ `decor`
  let notesDecor = [];
  if (scene.decor) { const r0 = await (await import('../decor/index.js')).zoneAvecDecor({ zone, scene, baseDir, donnees }); zone = r0.zone; notesDecor = r0.notes; }
  const hp = scene.ciel?.heure;   // l'heure du jour de la scene : lue par le detecteur de lumiere du jour
  const typesC = scene.acteurs.some((a) => a.creature && (a.actes || a.creature.ia)) ? (await (await import('../creatures/donnees.js')).donneesCreatures({ env })).types : null;   // creatures a intentions : leur gabarit
  void simuler; void gabaritCreature; void statsDe;
  // les mods de la scene tournent dans un processus fils a permissions (moteur/isolement.js) ; l'heure du jour et les creatures nees en cours
  // de route (fonctions) y sont refaites depuis la piste et la table des types (moteur/contexte.js) ; sans mods : dans ce processus, comme avant
  const { simulerIsole } = await import('../moteur/isolement.js');
  const r = await simulerIsole({ zone, donnees, monde: scene.monde, acteurs: descripteursActeurs(scene, typesC), baseDir, duree: scene.duree, options: { meteo: scene.ciel?.meteo ?? null, kitDir }, contexte: { heurePiste: hp ?? null, typesC } });
  if (r.replay.perso) {   // fichiers des blocs et entites de mods : seulement ceux que l'empreinte couvre (cites tels quels dans le code des mods)
    const { fichiersDeMods } = await import('./empreinte-fichiers.js');
    const couverts = new Set(fichiersDeMods(scene.monde?.mods, baseDir));
    for (const d of [...(r.replay.perso.blocs ?? []), ...(r.replay.perso.entites ?? [])]) for (const f of [d.modele, d.texture, ...Object.values(d.textures ?? {})].filter(Boolean)) {
      if (!couverts.has(f)) throw new Error(`mod : "${f}" (${d.id}) doit etre ecrit tel quel entre guillemets dans le mod et exister a cote de la scene (l'empreinte couvre ce fichier)`);
    }
  }
  ajouterNaissances(scene, r.replay);
  // montures prises et quittees dans le monde (wagonnet qui ramasse une creature, rail declencheur, colonne de bulles, clic) : la piste `monture`
  // du film devient celle du moteur pour ces acteurs (moteur/vehicules.js, replay.montures)
  for (const m of r.replay.montures ?? []) {
    const a = scene.acteurs.find((x) => x.nom === m.cavalier);
    if (!a) continue;
    if (!a._montureMoteur) { a._montureMoteur = true; a.monture = []; }
    a.monture.push({ t: m.tick / 20 / (r.replay.ralenti || 1), v: m.vehicule });
  }   // bebes, conversions, golems : des acteurs de plus dans la scene (film/naissances.js)
  const ob = obscuriteDe(r.replay); if (ob) scene._obscurite = ob;   // Obscurite du warden : l'image s'assombrit (film/look.js)
  if (r.replay.refletsForces) scene._refletsForces = r.replay.refletsForces;   // objets qui brillent sans enchantement (icones du montage)
  if (r.replay.etats?.length) scene._etatJoueur = etatJoueurDe(r.replay);   // HUD du montage relie a la simulation (champ joueur : incrust/elements.js)
  if (r.replay.ecrans?.length) scene._ecranJoueur = (nom, tm) => { const k = tm * 20 * (r.replay.ralenti || 1); let e = null; for (const x of r.replay.ecrans) if (x.acteur === nom && k >= x.debut && k < x.fin) e = x; return e && { ...e, age: k - e.debut }; };   // age : ticks depuis l'ouverture (livre de la table d'enchantement)   // incrustation poste
  return { zone, donnees: r.donnees, replay: r.replay, rapport: r.rapport, notes: [...notesDecor, ...r.replay.avertissements.map((a) => 'monde : ' + a)], secondes: (performance.now() - t0) / 1000 };
}

// Prepare tout ce qui sert a dessiner des images de la scene : kit (avec les textures de la scene), terrain, personnages, animation.
// Retourne { rs, anim, infos, dessiner(i, { largeur, hauteur, ssaa, copie }) -> RGBA, fermer() }.
export async function preparerFilm({ scene, zonePath, kitDir, surcharges = {}, baseDir = process.cwd(), env = process.env, travailleurs, shader }) {
  const kit = Object.keys(scene.textures ?? {}).length ? appliquerTextures(kitDir, scene.textures, baseDir, { env }) : kitDir;
  // scene avec un champ `monde` : la simulation tourne AVANT le premier rendu (elle produit le replay des changements de blocs) ; le moteur
  // n'est charge que dans ce cas (une scene sans `monde` ne change pas d'un bit et ne paie rien)
  const sim = scene.monde ? await simulerScene({ scene, zonePath, baseDir, env, kitDir }) : null;
  const rs = await chargerScene({ zonePath, zone: sim?.zone, kitDir: kit, travailleurs, options: sim ? { monde: { donnees: sim.donnees, replay: sim.replay, lumiere: scene.monde.lumiere, multBlocs: scene.monde.regles?.lumiere?.blocs ?? 1, perso: sim.replay.perso?.blocs?.length ? { blocs: sim.replay.perso.blocs, baseDir } : null } } : {} });
  if (sim?.replay.perso?.entites?.length) appliquerEntitesScene(scene, sim.replay.perso.entites, baseDir);   // entites de mods : echelle et texture au rendu
  try {
    // shader (facultatif) : lu et controle ici ; sans fichier, ou avec {}, le rendu est celui d'avant au pixel pres
    const fs0 = fichierShader(scene, baseDir, shader);
    const sh = fs0 ? lireShader(fs.readFileSync(fs0, 'utf8')) : null;
    rs.definirShader(sh);
    const notes = sh ? [...sh.notes] : [];
    if (sim) notes.push(...sim.notes);
    const creatures = scene.acteurs.some((a) => a.creature) || scene.monde ? await (await import('../creatures/donnees.js')).donneesCreatures({ env }) : null;   // monde : aussi le modele de la charge de vent   // table des creatures (relais), seulement si la scene en a
    const { personnages, parRef, infos } = await preparerPersonnages(scene, { kitDir: kit, surcharges, baseDir, creatures });
    // scene avec simulation : le terrain est le monde VIVANT (blocs poses, portes ouvertes, collisions des boites du jeu), instant par instant
    const terrain = sim ? (await import('./terrain-vivant.js')).creerTerrainVivant({ rs, replay: sim.replay, donnees: sim.donnees }) : terrainDepuis(rs);
    const anim = animer(scene, terrain, sim ? { replay: sim.replay } : null, { ...(creatures ? { creatures } : {}), personnages });   // personnages : le pantin pose le vrai maillage sur le sol
    const etiquettes = scene.acteurs.some((a) => a.etiquette) ? await (await import('../creatures/etiquette.js')).preparerEtiquettes(scene, kit) : null;   // noms au-dessus des tetes
    const comp = await creerComposition({ scene, kit, baseDir, rs, anim });   // null sans plans, textes, incrustations ni effets de camera
    if (comp) notes.push(...comp.notes);
    const lumiere = personnages.map(() => null);
    // effets visibles du monde simule (coffres, cloches, fissures, particules) : maillages dynamiques lus dans le replay
    const effets = sim ? (await import('./effets-monde.js')).creerEffetsMonde({ rs, scene, sim, kit, donnees: sim.donnees, terrain, creatures }) : null;
    const lumVue = sim ? (await import('./lumiere-vue.js')).creerLumiereVue({ scene, anim, replay: sim.replay }) : null;   // null sans vision nocturne ni wither
    const vueFx = sim ? await import('./vue-effets.js') : null, vueEffets = vueFx ? vueFx.creerVueEffets({ scene, replay: sim.replay }) : null;   // Cecite, Nausee (partie 26)
    const totemEcran = sim ? (await import('./totem-ecran.js')).creerTotemEcran({ scene, replay: sim.replay, kit }) : null;   // totem d'immortalite a l'ecran du joueur sauve
    if (scene.monde?.dimension) rs.dimension = scene.monde.dimension;   // monde de l'End : lumiere et ciel de l'End (rendu/scene.js, ciel-vanille.js)
    if (effets) notes.push(...effets.notes);
    // particules d'ambiance des blocs (ClientLevel.animateTick : flammes des torches, fumee, poudre de redstone, portail, feuilles qui tombent...) :
    // toutes les scenes, comme le jeu (film/ambiance-blocs.js) ; les tables du jeu sont celles de la simulation, ou chargees pour une scene sans monde
    let ambiance = null;
    try {
      const dJeu = sim ? sim.donnees : await (await import('../moteur/chargeur.js')).donneesDuJeu({ env });
      ambiance = (await import('./ambiance-blocs.js')).creerAmbianceScene({ rs, scene, kit, terrain: sim ? terrain : null, donnees: dJeu, replay: sim?.replay ?? null });
    } catch (e) { notes.push('particules d\'ambiance des blocs : non dessinees (' + e.message + ')'); }
    // bannieres (BannerRenderer : poteau, drapeau qui ondule, couleur et motifs du champ `bannieres`) : film/bannieres.js ; rien sans banniere
    const modB = await import('./bannieres.js');
    const instB = modB.instancesBannieres(rs.zone, sim?.replay ?? null);
    const bannieres = instB ? modB.creerBannieres({ kit, scene, instances: instB, lum: (x, y, z) => (typeof rs.luminositeEn === 'function' ? rs.luminositeEn(x, y, z) : 1) }) : null;
    // une image : personnages (skin du moment, lumiere du lieu), ciel, lumiere globale, puis post-traitement `image`
    const brumePluie = { m: 0, tm: null };   // AtmosphericFogEnvironment.rainFogMultiplier, d'une image a la suivante
    const dessiner = async (i, { largeur, hauteur, ssaa = 1, copie = true }) => {
      const im = anim.images[i];
      const carteBrute = comp ? comp.carteA(i) : null;   // carte plein cadre (montage) : fond uni, avec ou sans acteurs
      const uFond = carteBrute ? comp.fonduCarte(i, carteBrute) : 1;   // 0,15 s de fondu du monde vers le fond de la carte
      const carte = uFond >= 1 ? carteBrute : null;
      if (carte && !carte.acteurs.length) {
        const rgba = new Uint8Array(largeur * hauteur * 4);
        for (let k = 0; k < rgba.length; k += 4) { rgba[k] = carte.fond[0]; rgba[k + 1] = carte.fond[1]; rgba[k + 2] = carte.fond[2]; rgba[k + 3] = 255; }
        comp.finaliser(i, rgba, largeur, hauteur, null, { el: carte, im });
        return rgba;
      }
      if (sim) await rs.appliquerReplay(sim.replay.tickDe(im.tm));   // les blocs changes jusqu'a cet instant du monde (refait les sections touchees)
      const cielM = sim ? cielEn(scene, im.t, { lightmap: rs.maillage.lightmap }) : null;
      // meteo (ciel.meteo, coup de foudre) : niveaux de pluie et d'orage a cet instant du monde, eclair, facteur de lumiere du ciel du jeu ; null sans meteo
      const metNiv = effets?.meteo ? effets.meteo.niveaux(im.tm) : null, eclair = effets?.meteo ? effets.meteo.eclair(sim.replay.tickDe(im.tm)) : false;
      const meteoP = metNiv && (metNiv.pluie > 0 || metNiv.orage > 0 || eclair) ? { ...metNiv, eclair, facteurCiel: eclair ? 1 : facteurCielMeteo(metNiv) } : null;
      // brume de pluie (AtmosphericFogEnvironment.updateRainFogState) : cible = pluie x clamp((lumiere du ciel a l'oeil - 8) / 7) x (1, ou 0,5 dans un biome sans
      // precipitation), approchee de 0,2 x ticks ecoules a chaque image ; reglee d'un coup a la premiere image ou en revenant en arriere
      if (meteoP) {
        const c = im.camera, n = rs.niveauxEn?.(c.x, c.y, c.z), b = sim.donnees.biome?.(rs.zone.biome(Math.floor(c.x), Math.floor(c.z)));
        const cible = meteoP.pluie * Math.min(1, Math.max(0, ((n ? n.ciel : 15) - 8) / 7)) * (b && !b[1] ? 0.5 : 1);
        const dt = brumePluie.tm === null ? -1 : (im.tm - brumePluie.tm) * 20 * sim.replay.ralenti;
        brumePluie.m = dt < 0 || dt > 40 ? cible : brumePluie.m + (cible - brumePluie.m) * Math.min(1, dt * 0.2);
        brumePluie.tm = im.tm; meteoP.brumePluie = brumePluie.m;
      } else { brumePluie.m = 0; brumePluie.tm = im.tm; }
      if (lumVue) rs.lumiereVue = lumVue(i);
      rs.tempsMonde = im.tm;   // vision nocturne, barre du wither (film/lumiere-vue.js) : dans la table de lumiere
      if (cielM && rs.maillage.lightmap) rs.tableLumiere(cielM.heure ?? 12, cielM.gamma, meteoP ? meteoP.facteurCiel : 1);   // la lumiere des acteurs suit la meme table que le terrain
      const heureJour = (sim ? cielM : cielEn(scene, im.t))?.heure ?? 12;
      const imC = carte ? comp.imageCarte(carte, im) : null;   // carte avec acteurs : ils sont sur l'etage, la camera les regarde de face
      const maillages = (carte ? imC.ks : im.acteurs.map((_, k) => k)).map((k) => {
        const p = (carte ? imC : im).acteurs[k];
        let l = carte ? carte.lumiere : 1;
        if (!carte && typeof rs.luminositeEn === 'function') {
          const brut = rs.luminositeEn(p.x, p.y + 0.9, p.z);
          l = lumiere[k] === null ? brut : lumiere[k] + (brut - lumiere[k]) * 0.25;
          lumiere[k] = l;
        }
        const perso = p.skin ? parRef[k].get(p.skin) : personnages[k];
        const m = perso.maillage({ ...p, age: im.tm * 20, camera: im.camera, heure: heureJour }, l);   // heure : horloge tenue (objets/etat-objet.js)
        if (scene._ecranJoueur && !carte && scene.acteurs[k]?.nom) (scene._apercus ??= new Map()).set(scene.acteurs[k].nom, () => ({ m: perso.maillage(poseApercu({ ...p, age: im.tm * 20, heure: heureJour }), 1, true), accroupi: !!p.accroupi }));   // joueur de l'ecran d'inventaire (incrust/apercu-joueur.js)
        const et = !carte && etiquettes && scene.acteurs[k].etiquette && !p.absent ? maillageEtiquette(etiquettes, scene.acteurs[k].etiquette, p, p.hautBoite ?? 1.8, im.camera) : null;
        return et ? [m, et].flat() : m;
      }).flat();   // une creature donne un maillage par couche ; etiquette de nom en plus
      if (effets && !carte) maillages.push(...effets.maillages(im.tm, im.camera));
      if (bannieres && !carte) maillages.push(...bannieres.maillages(Math.max(0, (im.tm ?? im.t) * 20 * (sim ? sim.replay.ralenti : 1))));
      if (ambiance && !carte) maillages.push(...ambiance.maillages(Math.max(0, (im.tm ?? im.t) * 20 * (sim ? sim.replay.ralenti : 1)), im.camera, meteoP));
      const ciel = sim ? cielM : cielEn(scene, im.t);
      const veutProf = comp ? comp.veutProfondeur(i) : false;
      const fond = carte ? carte.fond : null;   // carte : ciel et brume de la couleur du fond, terrain hors de portee
      const vx = vueEffets ? vueEffets(im.tm) : null;
      const rgbaRendu = await rs.rendre({
        camera: carte ? imC.camera : im.camera, largeur, hauteur, temps: im.tm, maillagesDynamiques: maillages, ssaa, copie, ...(veutProf ? { profondeur: true } : {}),
        image: imageEn(scene, im.t), heure: ciel?.heure, jour: ciel?.jour, cielFixe: ciel?.fixe, lumiere: meteoP && !rs.maillage.lightmap && ciel?.lumiere ? ciel.lumiere.map((v) => v * meteoP.facteurCiel) : ciel?.lumiere, gamma: ciel?.gamma, meteo: meteoP,
        // le ciel est celui du jeu ; couleurs de ciel et de brume imposees seulement par couleurCiel
        ciel: ciel?.fixe ? ciel.ciel : undefined, soleil: ciel?.fixe ? ciel.soleil : undefined,
        brume: ciel?.fixe ? ciel.brume : (ciel?.brume?.debut !== undefined ? { debut: ciel.brume.debut } : undefined),
        // carte : ciel, brume et lumiere imposes (fond uni, acteurs eclaires normalement)
        ...(fond ? { ciel: { zenith: fond, horizon: fond, bas: fond }, soleil: false, cielFixe: true, brume: { debut: 30, fin: 50, couleur: fond }, lumiere: [1, 1, 1] } : {}),
        ...(vx && !fond && vx.brume ? { ciel: vx.ciel, soleil: false, cielFixe: true, brume: vx.brume } : {}),   // Cecite : brume noire a 5 blocs
      });
      if (vx?.nausee && !fond) vueFx.deformerNausee(rgbaRendu, largeur, hauteur, (carte ? imC.camera : im.camera).fov ?? 70, vx.nausee);   // Nausee : image deformee
      if (totemEcran && !fond) totemEcran(rgbaRendu, largeur, hauteur, im);   // ScreenEffectRenderer.renderItemActivationAnimation : apres le monde, avant l'interface
      if (comp && carteBrute && !carte) { melangerCouleur(rgbaRendu, carteBrute.fond, uFond); comp.finaliser(i, rgbaRendu, largeur, hauteur, null, { el: carteBrute, im }); }
      else if (comp) comp.finaliser(i, rgbaRendu, largeur, hauteur, veutProf ? rs.profondeurDerniere : null, carte ? { el: carte, im: imC } : null);
      return rgbaRendu;
    };
    return { rs, anim, infos, kit, notes, dessiner, sim, comp, fermer: () => rs.fermer() };
  } catch (e) { await rs.fermer(); throw e; }
}

// Film avec un vrai pack : prepare l'hote GL puis fixe le nombre d'images de chauffe (mesure une fois par pack, gardee dans le cache).
export async function preparerFilmReel({ scene, zonePath, kitDir, surcharges, baseDir, env, packShader, echelle, optionsPack, log, chauffe }) {
  const pf = await import('../pack/film.js');
  const chemin = path.resolve(packShader);
  const film = await pf.preparerFilmPack({ scene, zonePath, kitDir, surcharges, baseDir, env, packShader: chemin, echelle, options: optionsPack ?? {}, log, chauffe });
  try {
    if (chauffe === undefined) {
      const cle = pf.cleChauffe(chemin, optionsPack?.surcharges);
      let n = pf.lireCacheChauffe(cle);
      if (!n) { log('premiere utilisation de ce pack : mesure des images de chauffe...'); n = await pf.mesurerChauffe(film); pf.ecrireCacheChauffe(cle, n); }
      film.reglerChauffe(n);
      log(`chauffe : ${n} images avant la premiere image du film`);
    }
    // montage (facultatif) : effets d'image, transitions et incrustations sont appliques sur les images RGBA rendues par l'hote (pas de profondeur : la
    // profondeur de champ vient de depthtex0 de l'hote ; une carte avec acteurs devient un fond uni)
    const comp = await creerComposition({ scene, kit: film.kit, baseDir, rs: film.rs, anim: film.anim, gpu: true });
    if (comp) {
      const brut = film.dessiner;
      film.comp = comp;
      film.dessiner = async (i, opts = {}) => {
        const carteBrute = comp.carteA(i), im = film.anim.images[i];
        const uFond = carteBrute ? comp.fonduCarte(i, carteBrute) : 1;
        const carte = uFond >= 1 ? carteBrute : null;
        let rgba;
        if (carteBrute && !carte) {   // fondu du fond de la carte : le monde rendu par l'hote, puis le fond melange par-dessus
          rgba = await brut(i, opts);
          melangerCouleur(rgba, carteBrute.fond, uFond);
          comp.finaliser(i, rgba, opts.largeur ?? scene.largeur, opts.hauteur ?? scene.hauteur, im.champ ? brut.profondeur ?? null : null, { el: carteBrute, im });
          return rgba;
        }
        if (carte) {
          const L = opts.largeur ?? scene.largeur, H = opts.hauteur ?? scene.hauteur;
          rgba = new Uint8Array(L * H * 4);
          for (let k = 0; k < rgba.length; k += 4) { rgba[k] = carte.fond[0]; rgba[k + 1] = carte.fond[1]; rgba[k + 2] = carte.fond[2]; rgba[k + 3] = 255; }
          comp.finaliser(i, rgba, L, H, null, { el: carte, im: carte.acteurs.length ? comp.imageCarte(carte, im) : im });
          return rgba;
        }
        rgba = await brut(i, opts);
        // profondeur de champ : l'hote a rendu depthtex0 (src/pack/film.js, profondeurDeChamp), meme format que le tampon du rasteriseur
        comp.finaliser(i, rgba, opts.largeur ?? scene.largeur, opts.hauteur ?? scene.hauteur, im.champ ? brut.profondeur ?? null : null, null);
        return rgba;
      };
      film.notes.push(...comp.notes);
    }
  } catch (e) { await film.fermer(); throw e; }
  return film;
}

// Rend la scene en MP4. Retourne un compte rendu { sortie, images, secondes, corrections, notes, ... }.
//   scene : sortie de validerScene. zonePath : fichier .mcz. kitDir : kit (eventuellement fusionne avec un pack).
//   baseDir : dossier de la scene (les PNG du skin, du masque et des textures y sont cherches).
//   packShader (chemin d'un pack .zip ou dossier) : les images viennent d'un VRAI pack de shaders (hote OpenGL logiciel, src/pack/film.js) ;
//   echelle : 1 = pleine taille, 0.5 = le pack tourne a mi-taille puis l'image est agrandie ; optionsPack : { surcharges, reglages } deja controles.
export async function rendreVideo({ scene, zonePath, kitDir, sortie, surcharges = {}, baseDir = process.cwd(), env = process.env, log = () => {}, ssaa = 1, travailleurs, shader, packShader, echelle = 1, optionsPack }) {
  const t0 = Date.now();
  const ffmpeg = trouverFfmpeg(env);
  const film = packShader ? await preparerFilmReel({ scene, zonePath, kitDir, surcharges, baseDir, env, packShader, echelle, optionsPack, log }) : await preparerFilm({ scene, zonePath, kitDir, surcharges, baseDir, env, travailleurs, shader });
  const { rs, anim, infos } = film;
  let tmpAudio = null, mesuresAudio = null;
  try {
    const images = anim.images;

    // --- son
    const sons = new Sons(film.kit, ffmpeg);
    const plan = planifierSons({ scene, images, zone: rs.zone, sons, sims: anim.sims, remap: anim.remap });
    if (film.sim) { const { sonsDuReplay, sonsMeteo } = await import('./sons-monde.js'); plan.notes.push(...sonsDuReplay({ replay: film.sim.replay, images, sons, evenements: plan.evenements, gel: scene.gel, remap: anim.remap, ecoute: plan.ecoute }), ...sonsMeteo({ scene, sons, evenements: plan.evenements })); plan.evenements.sort((a, b) => a.t - b.t); }   // sons du monde simule (portes, coups de pioche, cloche...)
    let pcm = mixer({ evenements: plan.evenements, duree: scene.duree, sons, volume: VOLUME_MIXAGE * (scene.sons.volume ?? 1), ecoute: plan.ecoute });   // sons places entendus depuis l'auditeur (film/ecoute.js)
    if (pcm.voix && (pcm.voix.horsPortee || pcm.voix.saturees)) plan.notes.push(`sons du monde : ${pcm.voix.jouees} joues, ${pcm.voix.horsPortee} hors de portee de l'auditeur (non joues)${pcm.voix.saturees ? `, ${pcm.voix.saturees} perdus (247 voies du jeu prises)` : ''}`);
    // fichiers audio du montage (voix, musique, effets) : mixes par-dessus les bruits du jeu, ducking et sonie finale (montage/audio.js)
    let notesAudio = [];
    if (scene.sons.fichiers?.length) {
      const m = mixerFichiers({ pcm, entrees: scene.sons.fichiers, duree: scene.duree, baseDir, ffmpeg, normalise: scene.sons.normalise });
      pcm = m.pcm; notesAudio = m.notes; mesuresAudio = m.mesures;
    }
    tmpAudio = path.join(os.tmpdir(), `mcanim-audio-${process.pid}-${Date.now()}.raw`);
    fs.writeFileSync(tmpAudio, pcm);

    // --- ffmpeg
    const { largeur, hauteur } = scene;
    const args = ['-v', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${largeur}x${hauteur}`, '-r', '30', '-i', '-',
      '-f', 's16le', '-ar', String(FREQUENCE), '-ac', '2', '-i', tmpAudio,
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '26', '-maxrate', '4M', '-bufsize', '8M',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', sortie];
    const ff = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let erreurFf = '';
    ff.stderr.on('data', (d) => { erreurFf = (erreurFf + d).slice(-2000); });
    const fini = new Promise((ok, ko) => {
      ff.on('error', ko);
      ff.on('close', (code) => (code === 0 ? ok() : ko(new Error(`ffmpeg a echoue (code ${code}) : ${erreurFf.trim().split('\n').slice(-3).join(' | ')}`))));
    });
    let erreurPipe = null;
    ff.stdin.on('error', (e) => { erreurPipe = e; });
    fini.catch(() => {});

    // --- images
    const n = images.length;
    // rendu normal : 25, 50, 75 % ; vrai pack (long) : une ligne tous les 10 % avec le temps restant estime
    const jalons = new Set(packShader ? [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => Math.floor(n * k / 10)) : [Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75)]);
    const tRendu = Date.now();
    for (let i = 0; i < n; i++) {
      const rgba = await film.dessiner(i, { largeur, hauteur, ssaa });
      if (erreurPipe) break;
      if (!ff.stdin.write(rgba)) await new Promise((ok) => ff.stdin.once('drain', ok));
      if (jalons.has(i)) {
        const ecoule = (Date.now() - tRendu) / 1000, fait = i + 1;
        log(`rendu ${Math.round((fait / n) * 100)} % (${ecoule.toFixed(0)} s${packShader ? `, reste environ ${Math.round(ecoule / fait * (n - fait) / 60 * 10) / 10} min` : ''})`);
      }
    }
    ff.stdin.end();
    await fini;
    return {
      sortie, images: n, duree: scene.duree, secondes: (Date.now() - t0) / 1000, secondesRendu: (Date.now() - tRendu) / 1000,
      corrections: anim.corrections, camera: anim.camera, skins: infos, notes: [...anim.notes, ...plan.notes, ...notesAudio, ...film.notes, ...(film.comp?.notesFinales() ?? [])], audio: mesuresAudio, pas: plan.nbPas, evenementsSon: plan.evenements.length,
      memoireMaxMo: Math.round(process.resourceUsage().maxRSS / 1024), taille: fs.statSync(sortie).size,
      ...(packShader ? { echelle, secondesParImage: (Date.now() - tRendu) / 1000 / n, memoireHoteMo: film.memoireHoteMo?.() ?? null, chauffe: film.chauffe?.() ?? null, tempsParImage: film.stats && film.stats.images ? { hoteMs: Math.round(film.stats.hoteMs / film.stats.images), transfertMs: Math.round(film.stats.transfertMs / film.stats.images * 10) / 10, nodeMs: Math.round(film.stats.nodeMs / film.stats.images) } : null } : {}),
    };
  } finally {
    await film.fermer();
    if (tmpAudio) { try { fs.rmSync(tmpAudio, { force: true }); } catch { /* Windows : fichier encore tenu par ffmpeg apres une erreur */ } }
  }
}

// Une seule image de la scene, petite et filigranee, SANS jeton (mcanim apercu). Ecrit un PNG ; retourne { sortie, image, t, taille, secondes }.
//   t : secondes (0 a la duree). taille : "WxH" (1920 de large au plus ; JPEG au-dela de 640, voir film/apercu.js). Le rendu complet, lui, demande toujours un jeton.
export async function apercuImage({ scene, zonePath, kitDir, t, sortie, taille, surcharges = {}, baseDir = process.cwd(), env = process.env, shader, packShader, optionsPack, echelle = 1, zones = false, log = () => {} }) {
  const t0 = Date.now();
  if (!(t >= 0 && t <= scene.duree)) throw new Error(`--t : entre 0 et ${scene.duree} secondes (duree de la scene)`);
  const [largeur, hauteur] = tailleApercu(taille, scene);
  // vrai pack : l'image est calculee directement a la taille de l'apercu (avec la chauffe en cache, ou 16 images si le pack est nouveau)
  const film = packShader
    ? await (async () => {
      const pf = await import('../pack/film.js');
      const chemin = path.resolve(packShader);
      const n = pf.lireCacheChauffe(pf.cleChauffe(chemin, optionsPack?.surcharges)) ?? 16;
      return preparerFilmReel({ scene: { ...scene, largeur, hauteur }, zonePath, kitDir, surcharges, baseDir, env, packShader, echelle, optionsPack, log, chauffe: n });
    })()
    : await preparerFilm({ scene, zonePath, kitDir, surcharges, baseDir, env, travailleurs: 0, shader });
  try {
    const i = Math.min(film.anim.images.length - 1, Math.round(t * 30));
    const rgba = await film.dessiner(i, { largeur, hauteur, copie: true });
    if (zones) { const { dessinerMasques } = await import('../montage/zones.js'); const { chargerPolice } = await import('../incrust/police.js'); dessinerMasques(rgba, largeur, hauteur, await chargerPolice(film.kit)); }   // --zones : silhouettes de l'interface des applications
    filigrane(rgba, largeur, hauteur);
    fs.mkdirSync(path.dirname(sortie), { recursive: true });
    // fichier petit : JPEG (qualite 85, 4:2:0) au-dela de 640 de large ou pour une sortie .jpg ; PNG compresse au maximum sinon
    const format = formatApercu(sortie, largeur);
    const octets = format === 'jpeg' ? encoderJPEG({ largeur, hauteur, rgba }, { qualite: 85 }) : encoderPNG({ largeur, hauteur, rgba }, { niveau: 9 });
    fs.writeFileSync(sortie, octets);
    return { sortie, image: i, t: film.anim.images[i].t, taille: [largeur, hauteur], format, octets: octets.length, secondes: (Date.now() - t0) / 1000, skins: film.infos, notes: [...film.anim.notes, ...film.notes] };
  } finally { await film.fermer(); }
}
