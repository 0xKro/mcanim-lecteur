#!/usr/bin/env node
// mcanim : lecteur d'animations Minecraft. Commandes (voir docs/CONCEPTION.md, partie 7) :
//   mcanim terrain <zone> [--pas N] [--chemin x1,z1,x2,z2] [--carte [f.png] [--echelle N]]
//   mcanim etat <scene.json> [--t secondes|fin]
//   mcanim trajet <scene.json>
//   mcanim empreinte <scene.json>
//   mcanim rendre <scene.json> --jeton <jeton> [--sortie f.mp4] [--pack pack.zip] [--skin nom=fichier.png]
//        [--pack-shader pack.zip [--echelle 1|0.5] [--profil NOM] [--option NOM=VALEUR ...] [--repli]]   (vrai pack de shaders, plus lent)
//   mcanim skin <ref> [--sortie skin.png] [--zones] [--modele wide|slim]
//   mcanim texture <jeu/chemin> [--sortie f.png] [--pack pack.zip]
//   mcanim apercu <scene.json> --t 3.5 [--sortie a.png] [--taille 640x360] [--pack pack.zip]
//   mcanim shader --guide | --cles <famille> | --verifier f.json | --extraire pack.zip [--sortie dossier] | --exemples
//   mcanim simuler <scene.json>   (simulation du jeu : gratuit, resume court)
//   mcanim regles --liste [famille] | --familles   (parametres du jeu modifiables par la scene)
//   mcanim mods verifier <fichier.js>
//   mcanim kit
// Les sorties sont COURTES (elles coutent des tokens au client) ; en cas d'echec : message sur stderr, code non nul.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lireScene } from '../src/film/scene.js';
import { empreinte } from '../src/film/empreinte.js';
import { empreinteComplete } from '../src/film/empreinte-fichiers.js';
import { groupesDeScene, planifier as planifierHabillage, chercherObjets } from '../src/objets/plan.js';   // objets tenus et armure (kit a la demande, controles, note)
import { evenementsDeScene } from '../src/creatures/scene.js';   // sons des creatures de la scene (kit a la demande)
import { materiauxDuKit } from '../src/objets/armure.js';   // empreinte = scene + contenu des fichiers cites + options (CONCEPTION.md partie 4)
import { verifierJeton } from '../src/film/jeton.js';
import { noteSkinsDeRepli } from '../src/perso/skin.js';
import { resumeCamera } from '../src/film/camera.js';
import { obtenirZone, trouverKit, appliquerPack, dossierCache } from '../src/film/cache.js';
import { verifierFichiers } from '../src/film/fichiers.js';
import { textZonesSkin } from '../src/perso/zones.js';
import { encoderPNG, decoderPNG } from '../src/rendu/png.js';
import { lireShader, ErreurShader } from '../src/shader/format.js';
import { texteGuide, texteFamille, verifierTexte } from '../src/shader/guide.js';
import { texteTrajets, trajetsDeScene, compterEvenements, profilSegment } from '../src/film/trajet.js';
import { terrainDepuis } from '../src/film/physique.js';
import { lireReglages, preparerOptions, nonGere, ErreurPack } from '../src/shader/reglages.js';
import { noteAmplitudes } from '../src/film/limites.js';   // articulations libres : amplitudes hors plausible (une ligne)
import { animer } from '../src/film/scene.js';
import { descripteursActeurs } from '../src/film/actes.js';   // acteurs a intentions de la simulation

const AIDE = `mcanim : de la scene au MP4 (personnages Minecraft dans un vrai terrain)
  mcanim terrain <zone> [--pas 8]     telecharge la zone et le kit, resume du terrain (chemins, clairieres, eau)
  mcanim terrain <zone> --chemin x1,z1,x2,z2   verifie un trajet droit : libre, ou premier obstacle
  mcanim terrain <zone> --carte [f.png] [--echelle N]   carte vue de dessus GRATUITE (grille et etiquettes tous les 16 blocs, rues, portes, cloche d'un village) ; a lire pour se reperer
  (village : le resume donne village{type, rues[l,p], maisons[b,porte[x,z,cote]], cloche, puits, fermes, lampes} ; rue:true dans chemins = rue du village)
  mcanim etat <scene.json> [--t secondes|fin]   position, cap, vitesse, phases des boucles, pose de chaque acteur : pour enchainer la scene suivante (pos, lacet, boucle "phase0") ; assemblage ffmpeg : fiche enchainer
  mcanim trajet <scene.json>          ce qui arrive aux acteurs sur leur chemin : saut, chute, eau, echelle, marches, mur, vitesses ; gratuit, court
  mcanim empreinte <scene.json> [memes options que rendre]   controle la scene, affiche empreinte et duree ; l'empreinte couvre le CONTENU des PNG / shader / pack cites et les options
                                      de rendu (--skin --pack --shader --pack-shader --echelle --profil --option) : un octet change apres autoriser_scene = jeton refuse (modifier_scene)
  mcanim rendre <scene.json> --jeton <jeton> [--sortie f.mp4] [--pack pack.zip] [--skin nom=fichier.png] [--shader shader.json]
  mcanim rendre ... --pack-shader pack.zip [--echelle 1|0.5] [--profil NOM] [--option NOM=VALEUR ...] [--repli]   VRAI pack de shaders (le code du pack tourne sur
                                      un OpenGL logiciel ; lent : quelques secondes par image ; 0.5 = le pack tourne a mi-taille puis l'image est agrandie)
  mcanim apercu <scene.json> --t 3.5 [--sortie a.png] [--taille 640x360] [--zones] [--shader shader.json | --pack-shader pack.zip ...]   UNE image de la scene, petite, filigranee, SANS jeton
                                      (verifie couleurs, masques, cadrage avant de payer ; le rendu complet exige le jeton)
  mcanim planche <scene.json> [--n 12] [--sortie f.png] [--sans-zones]   PLANCHE DE CONTACT gratuite et filigranee : N images (ou une par plan si la scene a des plans), avec incrustations, effets et transitions, en UNE image ; revoir un montage rapide sans payer
  (vertical : textes et incrustations restent dans la ZONE SURE des applications, champ zonesSures "toutes" par defaut = instagram + tiktok + youtube ; "aucune" pour la desactiver ; --zones / planche montrent les masques d'interface)
  (textes et incrustations ANIMES par defaut : entree, emphase, sortie ; entree/sortie/emphase/anim/courbe/retard par element, "anim":"aucune" pour couper ; fiches sous_titres, incrustations)
  mcanim son duree <fichier audio>   duree, sonie (LUFS), crete et silences d'un fichier mp3/wav/... : pour caler les sous-titres sur une voix (gratuit)
  mcanim skin <ref> [--sortie skin.png] [--zones]   exporte le skin 64x64 (a retoucher) et affiche ou sont visage, cheveux, corps
  mcanim texture <jeu/chemin> [--sortie f.png]      exporte une texture du jeu (ex. block/oak_leaves) a retoucher
  mcanim shader --guide               reference courte pour traduire un pack de shaders en shader.json (cles, methode)
  mcanim shader --cles <famille>      une famille de cles en detail (ex. ciel, lumiere, eau)
  mcanim shader --verifier f.json     controle un shader.json : erreur avec le chemin de la cle, cles ignorees
  mcanim shader --extraire pack.zip [--sortie dossier]   resume court des reglages d'un pack .zip (profils, options, const) ; memes noms pour --profil / --option
  mcanim shader --diagnostic          peut-on rendre avec un VRAI pack de shaders ici ? (moteur OpenGL logiciel, version, limites ; 4 lignes)
  mcanim shader --exemples            ou sont shader-leger.json et shader-tout.json
  mcanim creatures --liste [mot]     CREATURES (champ d'acteur type) : types, variantes, animations nommees, parties, vitesses (30 lignes au plus) ; gratuit
  mcanim objets --cherche <mot>       identifiants d'objets du jeu (20 au plus) pour les champs objet / objetG ; --armures : materiaux du champ armure
  mcanim simuler <scene.json>         simule le jeu (champ monde : blocs poses, regles, mods) AVANT de payer le rendu ; gratuit, resume court (blocs changes, avertissements)
  (acteur.actes [[t,"verbe",..]] : un joueur SIMULE par le jeu : va x z | regarde | saute | accroupi | tient "objet" | attends s | utilise x y z (porte, bouton, levier, coffre, cloche...) | pose x y z "bloc" | casse x y z | utilise (manger, boire) | lance x y z|"acteur" (boule de neige, oeuf, perle, potion, trident) | tire x y z|"acteur" (arc, arbalete) | jette n | prend|depose x y z "objet" n ; options {va, ouvrePortes, duree, max, effet, niveau, secondes, charge} ; portee 4.5 ; mcanim simuler dit les echecs ; fiches actions, blocs_interactifs, casser_poser, objets_utiliser, arcs_projectiles)
  (croissance et meteo comme le jeu : cultures (1/(floor(25/v)+1)), pousses -> arbres, farine d'os, feuilles qui meurent, herbe ; ciel.meteo [[t,"pluie"|"orage"|"clair"|"foudre",...]] : pluie, neige, tonnerre, eclair, ciel terne ; regle croissance.vitesse = lapse de temps ; fiches croissance, meteo)
  (redstone et pistons comme le jeu : levier, bouton, plaque, poudre (15, -1 par bloc), torche (2 ticks, grille), repeteur (2 a 8 ticks), comparateur, observateur (2 ticks), lampe, pistons (12 blocs, collant, slime), entonnoir, dropper ; monde.contenus [[x,y,z,"objet",n]] ; monde.cmd [t,"frappe",x,y,z,force] ; regles redstone.* pistons.* contenus.* ; fiches redstone, pistons)
  mcanim regles --liste [famille]     parametres du jeu que monde.regles peut changer (nom = defaut [plage] explication) ; --familles : les familles
  mcanim mods verifier <fichier.js>   charge un mod de monde.mods dans le bac a sable et signale l'erreur en une ligne
  mcanim decor verifier|apercu|executer|module ... [--scene scene.json]   DECORS (la zone vient de la scene : plus de --zone) : faire construire sur le terrain (maisons, ponts, tours, aplanir) ; champ de scene decor ["maison.decor.json"] ; verifier = rapport de 15 lignes, apercu = petite image ; gratuits ; fiches decor_bases, decor_operations, decor_terrain, decor_maison
  mcanim terrain --scene scene.json   resume du terrain APRES les decors de la scene (les chemins contournent les batiments)
  mcanim kit                          recupere le kit de base
  (options de rendre : --ssaa 2 pour un rendu plus lisse, 3 fois plus lent)
  --shader shader.json : ombres du soleil, ciel, brume, rayons de lumiere, bloom, eau, feuilles qui bougent... (format : docs/FORMAT-SHADER.md ;
                         exemples : exemples/shader-leger.json, shader-tout.json ; ou le champ de scene "shader": "shader.json", chemin relatif a la scene ; l'option l'emporte)
  acteur : fige [[debut,fin]] (cet acteur seul s'arrete, pose tenue ; les autres continuent) figeSauf ["tete",...] (pistes qui continuent) ; boucle : phase0 (0..1, demarre a cette phase) ; sons : {pas, volume 0..4, liste [[t,"son",volume,cible]]} cible {"acteur":"nom"} ou [x,y,z]
  montage (facultatif, 1 a 180 s, fichier 64 Ko max) : plans [{de,a,camera,transition,vitesse,arret,image}] (une camera par plan, coupes) ; sousTitres {texte,debut,fin|mots,par,couleurs} et textes [[debut,fin,"texte"]] ;
  incrustations [{type: texte compteur fleche ligne icone equation coeurs faim horloge nom bulle chat succes inventaire coffre hud carte image, t:[debut,fin], ecran|monde|acteur}] ; camera : roulis secousse coupZoom flouFile flouRadial profondeurChamp ; sons.fichiers [[t,"voix.mp3",volume,{voix,sousVoix,fondu,boucle}]] (fiches du site)
  champs de scene facultatifs : monde {graine, regles, mods, blocs [[t,x,y,z,"bloc"]], cmd, contenus, lumiere} (simulation du jeu ; lumiere des blocs), image, ciel, gel, textures, shader, packShader (pack .zip, chemin relatif a la scene) ; acteur : skins, masque, lueur, horsImage, coudeD coudeG genouD genouG appui, objet objetG [t,"id"|null] (objet tenu en main droite / gauche ; mcanim objets --cherche mot), armure {tete,torse,jambes,pieds} (fiches du site) ; CREATURES : type (zombie, cow, horse, boat... : mcanim creatures --liste), variante, bebe, taille, charge, selle, armureCheval, colle, coffre, tondu, gonfle, agressif, anim [[t,nom]], regarde, parties ; monture (cavalier), etiquette (fiches creatures, creatures_anim, montures)
  hauteur automatique (physique du jeu : saut 0.42, gravite 0.08, pas de 0.6, chute, eau, echelle) a partir de pos [t,x,z] ; acteur : bascule [t,deg] roulis [t,deg]
  (corps entier autour des hanches, 90 = a plat) hauteur [t,blocs] (decalage vertical) reactions:false (coupe les reactions automatiques du corps)
  membres libres : brasD brasG jambeD jambeG [t,avant,cote,torsion] (cote < 0 : croise le corps ; torsion > 0 : rotation interne), tete [t,lacet,tangage,roulis],
  corps [t,penche,cote,torsion] (haut du corps autour des hanches), mainD mainG piedD piedG [t,cible,poids] (cible : point du corps, [droite,haut,avant] ou {"monde":[x,y,z]} ;
  null = relache), coudeVers genouVers [t,dehors,haut,avant], souple:true (pas de note d'amplitude) ; fiches articulations et mains ; mcanim empreinte / trajet signalent les amplitudes hors plausible`;

class Usage extends Error {}

// Shader : fichier de l'option --shader (relatif au dossier courant) ou champ `shader` de la scene (relatif a la scene). Controle complet avant tout
// telechargement ; retourne le chemin a donner au rendu (ou null).
function controlerShader(scene, baseDir, option) {
  const f = option ? path.resolve(option) : scene.shader ? path.resolve(baseDir, scene.shader) : null;
  if (!f) return null;
  try { lireShader(lireTexte(f)); } catch (e) { if (e instanceof ErreurShader) throw new Usage(e.message); throw e; }
  return f;
}

// Vrai pack de shaders (--pack-shader, ou champ `packShader` de la scene) : controle complet AVANT tout telechargement. Retourne null (pas de pack reel)
// ou { chemin, echelle, optionsPack, resume[], nonGere[] }. Si le rendu reel est impossible ici : erreur d'une ligne, ou (avec --repli) null apres l'avoir dit.
async function controlerPackShader(scene, baseDir, opt, dire) {
  const chemin = opt['pack-shader'] ? path.resolve(opt['pack-shader']) : scene.packShader ? path.resolve(baseDir, scene.packShader) : null;
  if (!chemin) {
    if (opt.profil !== undefined || opt.option || opt.echelle !== undefined) throw new Usage('--profil, --option et --echelle demandent --pack-shader pack.zip (ou le champ "packShader" de la scene)');
    return null;
  }
  let echelle = 1;
  if (opt.echelle !== undefined) { echelle = Number(opt.echelle); if (![1, 0.5].includes(echelle)) throw new Usage('--echelle : 1 (pleine taille, defaut) ou 0.5 (le pack tourne a mi-taille puis l\'image est agrandie)'); }
  let reglages;
  try { reglages = await lireReglages(chemin); } catch (e) { if (e instanceof ErreurPack) throw new Usage(e.message); throw e; }
  let r;
  try { r = preparerOptions(reglages, { profil: opt.profil, valeurs: opt.option || [] }); } catch (e) { if (e instanceof ErreurPack) throw new Usage(e.message); throw e; } finally { reglages.nettoyer(); }
  const manque = nonGere(reglages);
  const { diagnostic } = await import('../src/pack/hote.js');
  const d = diagnostic();
  if (!d.ok) {
    if (opt.repli) { dire(`rendu avec un vrai pack impossible ici (${d.raison}) ; --repli : je continue avec le rendu de base`); return null; }
    throw new Usage(`rendu avec un vrai pack impossible ici : ${d.raison}. Rien n'est rendu ; pour continuer avec notre rendu approximatif, relance avec --repli (ou avec --shader shader.json)`);
  }
  return { chemin, echelle, optionsPack: { surcharges: r.surcharges }, resume: r.resume, nonGere: manque };
}

// Lecture d'un fichier de scene avec un message clair s'il manque.
function lireTexte(chemin) {
  try { return fs.readFileSync(chemin, 'utf8'); } catch (e) { throw new Usage(`fichier illisible : ${chemin} (${e.code === 'ENOENT' ? 'introuvable' : e.message})`); }
}

function lireArgs(argv, { valeurs = [], multiples = [], drapeaux = [] } = {}) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const nom = a.slice(2);
      if (drapeaux.includes(nom)) { opt[nom] = true; continue; }
      if (![...valeurs, ...multiples].includes(nom)) throw new Usage(`option inconnue : ${a}`);
      if (i + 1 >= argv.length) throw new Usage(`l'option ${a} attend une valeur`);
      const v = argv[++i];
      if (multiples.includes(nom)) (opt[nom] ||= []).push(v); else opt[nom] = v;
    } else pos.push(a);
  }
  return { pos, opt };
}

const dire = (m) => console.log(m);
const sec = (ms) => (ms / 1000).toFixed(1);

async function commandeKit() {
  const t = Date.now();
  const dir = await trouverKit({});
  dire(`kit pret : ${dir} (${sec(Date.now() - t)} s)`);
}

async function commandeTerrain(argv) {
  // --carte [fichier.png] : l'image est facultative (valeur seulement si elle se termine par .png)
  let carte = null;
  const ic = argv.indexOf('--carte');
  if (ic >= 0) { carte = /.png$/i.test(argv[ic + 1] ?? '') ? argv[ic + 1] : true; argv = argv.filter((_, i) => i !== ic && !(carte !== true && i === ic + 1)); }
  const { pos, opt } = lireArgs(argv, { valeurs: ['pas', 'chemin', 'echelle', 'scene'] });
  let sceneDecor = null;   // --scene scene.json : le resume du terrain APRES les decors de la scene (docs/FORMAT-DECOR.md)
  if (opt.scene !== undefined) { sceneDecor = lireScene(lireTexte(opt.scene)).scene; if (!pos.length) pos.push(sceneDecor.zone); }
  if (pos.length !== 1) throw new Usage('usage : mcanim terrain <zone> [--pas N] [--chemin x1,z1,x2,z2] [--scene scene.json]');
  let seg = null;
  if (opt.chemin !== undefined) {
    seg = opt.chemin.split(',').map(Number);
    if (seg.length !== 4 || seg.some((v) => !Number.isFinite(v))) throw new Usage('--chemin : quatre nombres x1,z1,x2,z2 (ex. --chemin -262,-656,-218,-656)');
  }
  const t0 = Date.now();
  const pas = opt.pas ? Number(opt.pas) : undefined;
  if (pas !== undefined && !(pas >= 1 && pas <= 64)) throw new Usage('--pas : nombre entre 1 et 64');
  let chemin;
  if (/\.mcz$/i.test(pos[0]) && fs.existsSync(pos[0])) chemin = path.resolve(pos[0]);
  else chemin = (await obtenirZone(pos[0])).chemin;
  const kit = await trouverKit({});
  const { chargerScene } = await import('../src/rendu/scene.js');
  let zoneDecor, ligneDecor = null;
  if (sceneDecor?.decor) {
    const { lireZone } = await import('../src/rendu/zone.js');
    const { donneesDuJeu } = await import('../src/moteur/chargeur.js');
    const { zoneAvecDecor } = await import('../src/decor/index.js');
    try { const r = await zoneAvecDecor({ zone: lireZone(chemin), scene: sceneDecor, baseDir: path.dirname(path.resolve(opt.scene)), donnees: await donneesDuJeu({ log: dire }) }); zoneDecor = r.zone; r.notes.forEach(dire); ligneDecor = (await import('../src/decor/index.js')).resumeTerrainDecor(r.rapports); } catch (e) { if (e.name === 'ErreurDecor') throw new Usage(e.message); throw e; }
  }
  const rs = await chargerScene({ zonePath: chemin, zone: zoneDecor, kitDir: kit, travailleurs: 0 });
  try {
    if (seg) { dire(rs.verifierChemin(...seg)); const profil = profilSegment(terrainDepuis(rs), ...seg); if (profil) dire(profil); }
    else if (carte) dire(await ecrireCarte(rs, kit, carte === true ? `carte-${path.basename(chemin, '.mcz')}.png` : carte, opt.echelle));
    else dire((await import('../src/rendu/terrain-texte.js')).texteTerrain(rs, pas));
    if (ligneDecor && !seg && !carte) dire(ligneDecor);
    dire(`(${sec(Date.now() - t0)} s)`);
  } finally { await rs.fermer(); }
}

// Carte vue de dessus (gratuite) : fichier PNG, grille et etiquettes tous les 16 blocs, village en surbrillance. Une ligne de reponse.
async function ecrireCarte(rs, kit, fichier, echelle) {
  let E;
  if (echelle !== undefined) { E = Number(echelle); if (!(Number.isInteger(E) && E >= 1 && E <= 8)) throw new Usage('--echelle : entier de 1 a 8 (pixels par bloc)'); }
  const { dessinerCarte } = await import('../src/rendu/carte.js');
  const { analyserVillage } = await import('../src/rendu/village.js');
  let v = null;
  try { v = analyserVillage(rs.zone); } catch { v = null; }
  const r = dessinerCarte({ zone: rs.zone, village: v, kitDir: kit, echelle: E });
  fs.writeFileSync(fichier, r.png);
  return `carte : ${path.resolve(fichier)} (${r.largeur}x${r.hauteur} px, ${Math.round(r.png.length / 1024)} Ko, ${r.echelle} px par bloc). Lignes tous les 16 blocs, etiquettes = coordonnees du monde (x en haut et en bas, z a gauche et a droite ; jaune = multiples de 64). ${v ? 'Village : rues = trait magenta, portes = carre rouge (trait = cote de la sortie), cloche = jaune, puits = cyan, maisons = cadre blanc.' : 'Pas de village dans cette zone.'}`;
}

// Le terrain de la zone de la scene, pour la simulation du trajet. `telecharger` faux : seulement le cache local (sinon null).
async function terrainDeScene(scene, { telecharger, baseDir = process.cwd() }) {
  const cache = path.join(dossierCache(), 'zones', `${scene.zone}.mcz`);
  if (!telecharger && !fs.existsSync(cache)) return null;
  const zone = await obtenirZone(scene.zone);
  const kit = await trouverKit({});
  const { chargerScene } = await import('../src/rendu/scene.js');
  if (scene.monde) {   // scene avec simulation : le terrain est le monde VIVANT (blocs poses, portes ouvertes) ; les acteurs a `actes` viennent du replay
    const { simulerScene } = await import('../src/film/video.js');
    const { creerTerrainVivant } = await import('../src/film/terrain-vivant.js');
    const sim = await simulerScene({ scene, zonePath: zone.chemin, baseDir });
    const rs = await chargerScene({ zonePath: zone.chemin, zone: sim.zone, kitDir: kit, travailleurs: 0, options: { monde: { donnees: sim.donnees, replay: sim.replay, lumiere: scene.monde.lumiere } } });
    return { rs, terrain: creerTerrainVivant({ rs, replay: sim.replay, donnees: sim.donnees }), monde: { replay: sim.replay } };
  }
  const rs = await chargerScene({ zonePath: zone.chemin, kitDir: kit, travailleurs: 0 });
  return { rs, terrain: terrainDepuis(rs) };
}

// Ce qui arrive aux acteurs sur leur chemin (gratuit, comme terrain et empreinte).
async function commandeTrajet(argv) {
  const { pos } = lireArgs(argv);
  if (pos.length !== 1) throw new Usage('usage : mcanim trajet <scene.json>');
  const { scene } = lireScene(lireTexte(pos[0]));
  const t = await terrainDeScene(scene, { telecharger: true });
  try { dire(texteTrajets(scene, t.terrain, t.monde)); } finally { await t.rs.fermer(); }
}

// Etat de la scene a un instant (gratuit) : position, direction, phases des boucles, pose tenue ; pour enchainer la scene suivante sans a-coup.
async function commandeEtat(argv) {
  const { pos, opt } = lireArgs(argv, { valeurs: ['t'] });
  if (pos.length !== 1) throw new Usage('usage : mcanim etat <scene.json> [--t secondes|fin]   (defaut : fin)');
  const tt = opt.t === undefined || opt.t === 'fin' ? 'fin' : Number(opt.t);
  if (tt !== 'fin' && !Number.isFinite(tt)) throw new Usage('--t : un nombre de secondes ou "fin"');
  const { scene } = lireScene(lireTexte(pos[0]));
  const t = await terrainDeScene(scene, { telecharger: true });
  try {
    const { animer: animerFilm } = await import('../src/film/anim.js');
    const { etatDeScene, texteEtat } = await import('../src/film/etat.js');
    dire(texteEtat(etatDeScene(scene, animerFilm(scene, t.terrain, t.monde).images, tt)));
  } finally { await t.rs.fermer(); }
}

async function commandeEmpreinte(argv) {
  // memes options que rendre pour tout ce qui change l'image : elles entrent dans l'empreinte (--ssaa et --repli : sans effet sur elle)
  const { pos, opt } = lireArgs(argv, { valeurs: ['pack', 'shader', 'pack-shader', 'echelle', 'profil', 'ssaa'], multiples: ['skin', 'option'], drapeaux: ['repli'] });
  if (pos.length !== 1) throw new Usage('usage : mcanim empreinte <scene.json> [memes options de rendu que rendre : --skin --pack --shader --pack-shader --echelle --profil --option]');
  const { brut, scene } = lireScene(lireTexte(pos[0]));
  for (const s of opt.skin || []) if (s.indexOf('=') < 1) throw new Usage(`--skin attend nom=fichier.png (recu : ${s})`);
  const fp = empreinteComplete(brut, { scene, baseDir: path.dirname(path.resolve(pos[0])), opt });
  dire(`empreinte ${fp.empreinte} | duree ${scene.duree} s | ${scene.format} | ${scene.acteurs.length} acteur(s) | ${scene.images} images`);
  dire(fp.texte);
  try { const n = noteAmplitudes(scene, animer(scene)); if (n) dire(n); } catch { /* la note d'amplitudes est facultative */ }
  // meme simulation que le rendu : combien d'evenements de trajet (zone deja dans le cache seulement ; jamais d'erreur ici)
  try {
    const t = await terrainDeScene(scene, { telecharger: false });
    if (t) {
      try {
        const c = compterEvenements(trajetsDeScene(scene, t.terrain));
        dire(`trajet : ${c.evenements} evenement(s)${c.vitesses ? `, ${c.vitesses} vitesse(s) a revoir` : ''} (saut, chute, eau, echelle, mur) -> mcanim trajet ${path.basename(pos[0])}`);
      } finally { await t.rs.fermer(); }
    }
  } catch { /* la ligne de trajet est facultative */ }
}

async function commandeRendre(argv) {
  const { pos, opt } = lireArgs(argv, { valeurs: ['jeton', 'sortie', 'pack', 'ssaa', 'shader', 'pack-shader', 'echelle', 'profil'], multiples: ['skin', 'option'], drapeaux: ['repli'] });
  if (pos.length !== 1) throw new Usage('usage : mcanim rendre <scene.json> --jeton <jeton> [--sortie f.mp4] [--pack pack.zip] [--skin nom=fichier.png]');
  if (!opt.jeton) throw new Usage('il faut un jeton : --jeton <jeton> (obtenu avec autoriser_scene)');
  const surcharges = {};
  for (const s of opt.skin || []) {
    const i = s.indexOf('=');
    if (i < 1) throw new Usage(`--skin attend nom=fichier.png (recu : ${s})`);
    surcharges[s.slice(0, i)] = path.resolve(s.slice(i + 1));    // relatif au dossier courant (pas a la scene)
  }
  const ssaa = opt.ssaa ? Number(opt.ssaa) : 1;
  if (![1, 2].includes(ssaa)) throw new Usage('--ssaa : 1 ou 2');
  const t0 = Date.now();

  // 1. scene et jeton : rien n'est telecharge ni calcule si l'un des deux est mauvais
  const { brut, scene } = lireScene(lireTexte(pos[0]));
  for (const nom of Object.keys(surcharges)) if (!scene.acteurs.some((a) => a.nom === nom)) throw new Usage(`--skin : aucun acteur nomme "${nom}"`);
  const baseDir = path.dirname(path.resolve(pos[0]));
  // l'empreinte couvre le contenu des fichiers cites et les options de rendu : un octet change = jeton refuse (modifier_scene)
  const fp = empreinteComplete(brut, { scene, baseDir, opt });   // verifie aussi que les PNG cites existent (avant tout telechargement)
  const e = fp.empreinte;
  const verifier = (extra = {}) => {
    try { return verifierJeton(opt.jeton, { empreinte: e, duree: scene.duree, zone: scene.zone, ...extra }); } catch (err) {
      if (scene.decor && /empreinte differente/.test(err.message)) throw new Error("jeton refuse : le decor a change depuis l'autorisation (ou la scene, un fichier cite, une option de rendu) ; demande une retouche (modifier_scene) avec la nouvelle empreinte (mcanim empreinte), puis rends avec le nouveau jeton");
      if (fp.fichiers.length && /empreinte differente/.test(err.message)) throw new Error("jeton refuse : la scene, un fichier cite (skin, masque, texture, shader, pack) ou une option de rendu a change depuis l'autorisation ; demande une retouche (modifier_scene) avec la nouvelle empreinte (mcanim empreinte avec les memes options), puis rends avec le nouveau jeton");
      throw err;
    }
  };
  const charge = verifier();
  const shader = controlerShader(scene, baseDir, opt.shader);
  const reel = await controlerPackShader(scene, baseDir, opt, dire);

  // 2. zone, kit, pack
  const zone = await obtenirZone(scene.zone, { zh: charge.zh });
  verifier({ zoneSha256: zone.sha256 });
  let kit = await trouverKit({ groupes: groupesDeScene(scene), evenementsCreatures: evenementsDeScene(scene) });
  if (opt.pack) kit = await appliquerPack(kit, path.resolve(opt.pack));
  const habillage = planifierHabillage(scene, kit);   // objets et armure : identifiants controles AVANT le rendu
  if (habillage.erreur) throw new Usage(habillage.erreur);
  dire(`jeton ok, zone prete${opt.pack ? ', pack applique' : ''} (${sec(Date.now() - t0)} s)`);
  if (habillage.note) dire(habillage.note);

  // 3. rendu
  const sortie = path.resolve(opt.sortie || path.basename(pos[0]).replace(/\.json$/i, '') + '.mp4');
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  const { rendreVideo } = await import('../src/film/video.js');
  if (reel) dire(`vrai pack de shaders : ${path.basename(reel.chemin)}, echelle ${reel.echelle}${reel.resume.length ? ', ' + reel.resume.join(' ') : ''} ; non gere : ${reel.nonGere.join(' ; ')}`);
  const r = await rendreVideo({ scene, zonePath: zone.chemin, kitDir: kit, sortie, surcharges, baseDir, log: dire, ssaa, shader: reel ? null : shader, ...(reel ? { packShader: reel.chemin, echelle: reel.echelle, optionsPack: reel.optionsPack } : {}) });

  const repli = r.skins.filter((s) => s.repli);
  const notes = [...r.notes];
  if (repli.length) notes.push(noteSkinsDeRepli(repli));
  if (notes.length) dire('notes : ' + notes.join(' ; '));
  dire(`OK ${sortie} | ${r.duree} s | ${r.images} images | ${sec(r.secondes * 1000)} s de calcul | ${resumeCamera(r.camera, r.images) ?? 'camera sans correction'} | skins de repli : ${repli.length} | ${(r.taille / 1048576).toFixed(1)} Mo | memoire max ${r.memoireMaxMo} Mo${reel ? ` | pack : ${r.secondesParImage.toFixed(2)} s par image, hote ${r.memoireHoteMo ?? '?'} Mo, chauffe ${r.chauffe} images${r.tempsParImage ? `, par image : hote ${r.tempsParImage.hoteMs} ms + transfert ${r.tempsParImage.transfertMs} ms + Node ${r.tempsParImage.nodeMs} ms` : ''}` : ''}`);
}

// Skin d'un acteur exporte en PNG 64x64 (ancien format 64x32 deja converti) + disposition des parties : pour le retoucher.
async function commandeSkin(argv) {
  const { pos, opt } = lireArgs(argv, { valeurs: ['sortie', 'modele', 'pack'], drapeaux: ['zones'] });
  if (opt.modele !== undefined && !['wide', 'slim'].includes(opt.modele)) throw new Usage('--modele : "wide" ou "slim"');
  if (opt.zones) { dire(textZonesSkin(opt.modele ?? 'wide')); return; }
  if (pos.length !== 1) throw new Usage('usage : mcanim skin <skin> [--sortie skin.png] [--zones]   (skin : pseudo, "steve", "@identifiant" ou fichier.png)');
  let kit = await trouverKit({});
  if (opt.pack) kit = await appliquerPack(kit, path.resolve(opt.pack));
  const { resoudreSkin } = await import('../src/perso/skin.js');
  const r = await resoudreSkin({ description: pos[0], modele: opt.modele ?? null, kitDir: kit, baseDir: process.cwd() });
  const sortie = path.resolve(opt.sortie || 'skin.png');
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  fs.writeFileSync(sortie, encoderPNG({ largeur: 64, hauteur: 64, rgba: r.rgba }));
  dire(`skin ecrit : ${sortie} (64x64, modele ${r.modele}, ${r.origine}${r.repli ? ' de repli' : ''} : ${r.detail})`);
  dire(textZonesSkin(r.modele));
}

// Une texture du jeu exportee en PNG, pour la retoucher puis la declarer dans le champ `textures` de la scene.
async function commandeTexture(argv) {
  const { pos, opt } = lireArgs(argv, { valeurs: ['sortie', 'pack'] });
  if (pos.length !== 1) throw new Usage('usage : mcanim texture <chemin du jeu> [--sortie f.png]   (ex. block/oak_leaves, entity/player/wide/steve)');
  const nom = pos[0].replace(/^minecraft:/, '').replace(/\.png$/i, '');
  if (!/^[a-z0-9_-]+(\/[a-z0-9_-]+)+$/.test(nom)) throw new Usage('nom de texture attendu : dossier/nom, par exemple block/oak_leaves');
  let kit = await trouverKit({});
  if (opt.pack) kit = await appliquerPack(kit, path.resolve(opt.pack));
  const racine = path.join(kit, 'assets', 'minecraft', 'textures');
  const f = path.join(racine, ...nom.split('/')) + '.png';
  if (!fs.existsSync(f)) {
    const fin = nom.split('/').pop(), proches = [];
    const marche = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) marche(path.join(d, e.name), r); else if (e.name.endsWith('.png') && e.name.includes(fin) && proches.length < 8) proches.push(r.slice(0, -4)); } };
    marche(racine, '');
    throw new Usage(`texture inconnue : ${nom}${proches.length ? ' ; noms proches : ' + proches.join(', ') : ''}`);
  }
  const octets = fs.readFileSync(f);
  const im = decoderPNG(octets);
  let anim = '';
  try { const m = JSON.parse(fs.readFileSync(f + '.mcmeta', 'utf8')); if (m.animation) anim = ` ; animee : ${Math.floor(im.hauteur / (m.animation.height || m.animation.width || im.largeur))} images empilees (garde la meme hauteur)`; } catch { /* pas anime */ }
  const sortie = path.resolve(opt.sortie || nom.split('/').pop() + '.png');
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  fs.writeFileSync(sortie, octets);
  dire(`texture ecrite : ${sortie} (${im.largeur}x${im.hauteur}${anim})`);
  dire(`pour la remplacer : "textures": {"${nom}": "${path.basename(sortie)}"} dans la scene (PNG de meme taille, multiple ou puissance de 2, 1024 au plus)`);
}

// Une image de la scene a l'instant t, sans jeton : petite, avec un filigrane. Le rendu complet (mcanim rendre) exige toujours un jeton.
async function commandeApercu(argv) {
  const { pos, opt } = lireArgs(argv, { valeurs: ['t', 'sortie', 'taille', 'pack', 'skin', 'shader', 'pack-shader', 'echelle', 'profil'], multiples: ['option'], drapeaux: ['repli', 'zones'] });
  if (pos.length !== 1) throw new Usage('usage : mcanim apercu <scene.json> --t 3.5 [--sortie a.png] [--taille 640x360]');
  const t = opt.t === undefined ? 0 : Number(opt.t);
  if (!Number.isFinite(t) || t < 0) throw new Usage('--t : un nombre de secondes >= 0, par exemple --t 3.5');
  const t0 = Date.now();
  const { scene } = lireScene(lireTexte(pos[0]));
  const baseDir = path.dirname(path.resolve(pos[0]));
  const surcharges = {};
  if (opt.skin) { const i = opt.skin.indexOf('='); if (i < 1) throw new Usage('--skin attend nom=fichier.png'); surcharges[opt.skin.slice(0, i)] = path.resolve(opt.skin.slice(i + 1)); }
  verifierFichiers(scene, baseDir, surcharges);
  const shader = controlerShader(scene, baseDir, opt.shader);
  const reel = await controlerPackShader(scene, baseDir, opt, dire);
  if (reel) dire(`apercu avec un vrai pack de shaders : ${path.basename(reel.chemin)}${reel.resume.length ? ', ' + reel.resume.join(' ') : ''} ; non gere : ${reel.nonGere.join(' ; ')}`);
  const zone = await obtenirZone(scene.zone);
  let kit = await trouverKit({ groupes: groupesDeScene(scene), evenementsCreatures: evenementsDeScene(scene) });
  if (opt.pack) kit = await appliquerPack(kit, path.resolve(opt.pack));
  const habillage = planifierHabillage(scene, kit);
  if (habillage.erreur) throw new Usage(habillage.erreur);
  if (habillage.note) dire(habillage.note);
  const sortie = path.resolve(opt.sortie || 'apercu.png');
  const { apercuImage } = await import('../src/film/video.js');
  const r = await apercuImage({ scene, zonePath: zone.chemin, kitDir: kit, t, sortie, taille: opt.taille, surcharges, baseDir, zones: !!opt.zones, shader: reel ? null : shader, ...(reel ? { packShader: reel.chemin, optionsPack: reel.optionsPack, echelle: reel.echelle, log: dire } : {}) }).catch((e) => { if (/^--(t|taille)/.test(e.message)) throw new Usage(e.message); throw e; });
  const repli = r.skins.filter((s) => s.repli);
  dire(`apercu ${r.sortie} | t=${r.t.toFixed(2)} s (image ${r.image}) | ${r.taille.join('x')} | ${sec(Date.now() - t0)} s | filigrane : ce n'est PAS le rendu final, mcanim rendre demande un jeton`);
  const notesA = (r.notes || []).filter((n) => /^options non prises/.test(n));
  if (repli.length) notesA.push(noteSkinsDeRepli(repli));
  if (notesA.length) dire('notes : ' + notesA.join(' ; '));
}

// Planche de contact (gratuite, filigranee) : N images de la scene, ou une par plan, en une seule image.
async function commandePlanche(argv) {
  const { pos, opt } = lireArgs(argv, { valeurs: ['n', 'sortie', 'pack', 'skin', 'shader'], drapeaux: ['zones', 'sans-zones'] });
  if (pos.length !== 1) throw new Usage('usage : mcanim planche <scene.json> [--n 12] [--sortie planche.png]   (une image par plan si la scene a des plans et pas de --n)');
  const n = opt.n === undefined ? undefined : Number(opt.n);
  if (n !== undefined && !(Number.isInteger(n) && n >= 1 && n <= 48)) throw new Usage('--n : entier de 1 a 48');
  const t0 = Date.now();
  const { scene } = lireScene(lireTexte(pos[0]));
  const baseDir = path.dirname(path.resolve(pos[0]));
  const surcharges = {};
  if (opt.skin) { const i = opt.skin.indexOf('='); if (i < 1) throw new Usage('--skin attend nom=fichier.png'); surcharges[opt.skin.slice(0, i)] = path.resolve(opt.skin.slice(i + 1)); }
  verifierFichiers(scene, baseDir, surcharges);
  const shader = controlerShader(scene, baseDir, opt.shader);
  const zone = await obtenirZone(scene.zone);
  let kit = await trouverKit({ groupes: groupesDeScene(scene), evenementsCreatures: evenementsDeScene(scene) });
  if (opt.pack) kit = await appliquerPack(kit, path.resolve(opt.pack));
  const habillage = planifierHabillage(scene, kit);
  if (habillage.erreur) throw new Usage(habillage.erreur);
  const { preparerFilm } = await import('../src/film/video.js');
  const { ecrirePlanche } = await import('../src/montage/planche.js');
  const film = await preparerFilm({ scene, zonePath: zone.chemin, kitDir: kit, surcharges, baseDir, travailleurs: 0, shader });
  try {
    const sortie = path.resolve(opt.sortie || path.basename(pos[0]).replace(/\.json$/i, '') + '-planche.png');
    // vertical : les masques d'interface (TikTok, Reels, Shorts) sont dessines par defaut ; --sans-zones les cache
    const zones = opt['sans-zones'] ? false : (opt.zones || scene.hauteur > scene.largeur);
    const r = await ecrirePlanche({ film, scene, sortie, n, zones });
    dire(`planche ${r.sortie} | ${r.n} images (${r.instants.map((t) => t.toFixed(1)).join(' ')} s) | ${r.taille.join('x')} | ${sec(Date.now() - t0)} s | filigrane : ce n'est PAS le rendu final`);
    const notes = [...film.anim.notes.filter((n) => n.startsWith('camera : ')), ...film.notes, ...(film.comp?.notesFinales() ?? [])];   // + camera : sujet cache, herbe devant l'objectif
    if (notes.length) dire('notes : ' + notes.join(' ; '));
  } finally { await film.fermer(); }
}

// Duree et sonie d'un fichier audio (gratuit) : pour caler les sous-titres (sousTitres.mots) sur une voix.
async function commandeSon(argv) {
  const args = argv[0] === 'duree' ? argv.slice(1) : argv;
  if (args.length !== 1) throw new Usage('usage : mcanim son duree <fichier audio>');
  const f = path.resolve(args[0]);
  if (!fs.existsSync(f)) throw new Usage(`fichier introuvable : ${args[0]}`);
  const { trouverFfmpeg } = await import('../src/film/ffmpeg.js');
  const { mesurerSon } = await import('../src/montage/audio.js');
  const m = await mesurerSon(f, trouverFfmpeg());
  const si = m.silences.length ? ' | silences > 0,3 s : ' + m.silences.map(([a, b]) => `${a}-${b}`).join(' ') + ' s' : '';
  dire(`${path.basename(f)} : ${String(m.duree).replace('.', ',')} s | sonie ${m.lufs === null ? 'trop faible' : m.lufs + ' LUFS'} | crete ${m.creteDb} dBFS | ${m.canaux} canal(aux) ${m.frequence} Hz${si}`);
  dire('pour la scene : "sons":{"fichiers":[[0,"' + path.basename(f) + '",1,{"voix":true}]]} ; sousTitres.mots = [[temps,"mot"],...] calcules sur ces durees (mcanim planche pour verifier)');
}

// Aide gratuite : cherche des identifiants d'objets (et de materiaux d'armure) pour ne pas deviner les noms.
// Simulation du jeu pour une scene qui a un champ `monde` : gratuite, imprime un resume court (docs/SIMULATION.md 1.8).
async function commandeSimuler(argv) {
  const { pos } = lireArgs(argv);
  if (pos.length !== 1) throw new Usage('usage : mcanim simuler <scene.json>');
  const { scene } = lireScene(lireTexte(pos[0]));
  if (!scene.monde) return dire("la scene n'a pas de champ monde : rien a simuler (le rendu est le meme qu'avant)");
  const baseDir = path.dirname(path.resolve(pos[0]));
  verifierFichiers(scene, baseDir);
  const zone = await obtenirZone(scene.zone);
  const { lireZone } = await import('../src/rendu/zone.js');
  const { simuler, ErreurMonde } = await import('../src/moteur/index.js');
  const { donneesDuJeu } = await import('../src/moteur/chargeur.js');
  const donnees = await donneesDuJeu({ log: dire });
  try {
    let zoneS = lireZone(zone.chemin);
    if (scene.decor) { const { zoneAvecDecor } = await import('../src/decor/index.js'); const r0 = await zoneAvecDecor({ zone: zoneS, scene, baseDir, donnees }); zoneS = r0.zone; r0.notes.forEach(dire); }
    const hp = scene.ciel?.heure;
    const { evaluer } = await import('../src/film/scene.js');
    const typesC = scene.acteurs.some((a) => a.creature && a.actes) ? (await (await import('../src/creatures/donnees.js')).donneesCreatures({})).types : null;
    const r = simuler({ zone: zoneS, donnees, monde: scene.monde, acteurs: descripteursActeurs(scene, typesC), baseDir, duree: scene.duree, options: { heure: hp ? (t) => evaluer(hp, t)[0] : undefined, meteo: scene.ciel?.meteo ?? null } });
    dire(r.rapport);
  } catch (e) { if (e instanceof ErreurMonde) throw new Usage(e.message); throw e; }
}

// Parametres modifiables du jeu (declares par chaque famille : jamais de derive).
async function commandeRegles(argv) {
  const { pos, opt } = lireArgs(argv, { drapeaux: ['liste', 'familles'] });
  const { reglesPubliques } = await import('../src/moteur/index.js');
  const regles = reglesPubliques();
  if (opt.familles) return dire(regles.familles().map(([f, n]) => `${f} (${n})`).join('\n'));
  if (!opt.liste) throw new Usage('usage : mcanim regles --liste [famille]   |   mcanim regles --familles');
  const famille = pos[0];
  const l = regles.liste(famille);
  if (!l.length) throw new Usage(`aucune regle pour "${famille}" ; familles : ${regles.familles().map(([f]) => f).join(', ')}`);
  dire(l.join('\n'));
}

// Charge un mod dans le bac a sable (sans scene) et dit en une ligne s'il est correct.
async function commandeMods(argv) {
  const [sous, fichier] = argv;
  if (sous !== 'verifier' || !fichier) throw new Usage('usage : mcanim mods verifier <fichier.js>');
  const texte = lireTexte(path.resolve(fichier));
  const { preparer, ErreurMonde } = await import('../src/moteur/index.js');
  const { donneesDuJeu } = await import('../src/moteur/chargeur.js');
  const { Zone } = await import('../src/rendu/zone.js');
  const donnees = await donneesDuJeu({ log: dire });
  const zone = new Zone({ palette: ['minecraft:air', '#hidden'], biomes: ['minecraft:plains'], origine: [0, 0, 0], taille: [1, 1, 1] }, new Uint32Array(1), new Uint8Array(1), new Int16Array(1));
  try {
    const sim = preparer({ zone, donnees, monde: {}, mods: [{ nom: path.basename(fichier), source: texte }] });
    const n = sim.reg.entrees.filter((e) => e.source !== 'moteur').length;
    dire(`${path.basename(fichier)} : ok, ${n} gestionnaire(s) enregistre(s)${sim.regles.val.size ? '' : ''}`);
  } catch (e) { if (e instanceof ErreurMonde) throw new Usage(e.message); throw e; }
}

async function commandeObjets(argv) {
  const { opt } = lireArgs(argv, { valeurs: ['cherche'], drapeaux: ['armures'] });
  if (opt.armures) {
    const kit = await trouverKit({ groupes: ['armures'] });
    return dire(`materiaux d'armure : ${materiauxDuKit(kit).join(', ')} (champ armure : un materiau ou un objet comme diamond_helmet ; "golden" = gold, "turtle" = turtle_scute)`);
  }
  if (!opt.cherche) throw new Usage('usage : mcanim objets --cherche <mot>  (ex. sword, fish, torch, planks)   |   mcanim objets --armures');
  const kit = await trouverKit({ groupes: ['objets'] });
  const { premiers, total } = chercherObjets(kit, opt.cherche);
  if (!total) return dire(`aucun objet ne contient "${opt.cherche}" (essaie un mot anglais plus court : sword, apple, planks)`);
  dire(`${premiers.join(' ')}${total > premiers.length ? `
(+${total - premiers.length} autres : precise le mot)` : ''}`);
}

// Aide au traducteur de packs de shaders : tout est du texte court, rien n'est telecharge.
async function commandeShader(argv) {
  const { opt } = lireArgs(argv, { valeurs: ['cles', 'verifier', 'extraire', 'sortie'], drapeaux: ['guide', 'exemples', 'diagnostic'] });
  if (opt.diagnostic) {
    const { diagnostic } = await import('../src/pack/hote.js');
    const d = diagnostic();
    if (!d.ok) throw new Usage(`rendu avec un vrai pack : NON (${d.raison}). Le rendu de base reste disponible.`);
    return dire(d.lignes.join('\n'));
  }
  if (opt.guide) return dire(texteGuide());
  if (opt.cles !== undefined) {
    const r = texteFamille(opt.cles);
    if (!r.ok) throw new Usage(r.texte);
    return dire(r.texte);
  }
  if (opt.verifier !== undefined) {
    const r = verifierTexte(lireTexte(path.resolve(opt.verifier)));
    if (!r.ok) throw new Usage(r.texte);
    return dire(r.texte);
  }
  if (opt.extraire !== undefined) {
    const zip = path.resolve(opt.extraire);
    if (!fs.existsSync(zip)) throw new Usage(`pack introuvable : ${zip}`);
    const sortie = path.resolve(opt.sortie || path.basename(zip).replace(/\.zip$/i, '') + '-extrait');
    const { extraire } = await import('../src/shader/extraire.js');
    let r;
    try { r = await extraire(zip, sortie); } catch (e) { throw new Usage(`pack illisible : ${e.message}`); }
    let note = '';
    try { const rg = await lireReglages(zip); rg.nettoyer(); note = `\nrendu reel (rendre --pack-shader ${path.basename(zip)} [--profil NOM] [--option NOM=VALEUR]) : non gere encore : ${nonGere(rg).join(' ; ')}`; } catch { /* le resume reste valable */ }
    return dire(r.texte + note);
  }
  if (opt.exemples) {
    const d = path.resolve(fileURLToPath(new URL('../exemples/', import.meta.url)));
    return dire(`exemples (a copier puis modifier) :
${path.join(d, 'shader-leger.json')}   ombres, bloom, vignette, feuilles : ~ +25 % de temps de rendu
${path.join(d, 'shader-tout.json')}   toutes les familles du palier 1 : ~ +55 %`);
  }
  throw new Usage('usage : mcanim shader --diagnostic | --guide | --cles <famille> | --verifier shader.json | --extraire pack.zip [--sortie dossier] | --exemples');
}

async function main() {
  const [cmd, ...reste] = process.argv.slice(2);
  switch (cmd) {
    case 'terrain': return commandeTerrain(reste);
    case 'trajet': return commandeTrajet(reste);
    case 'etat': return commandeEtat(reste);
    case 'empreinte': return commandeEmpreinte(reste);
    case 'rendre': return commandeRendre(reste);
    case 'skin': return commandeSkin(reste);
    case 'texture': return commandeTexture(reste);
    case 'planche': return commandePlanche(reste);
    case 'son': return commandeSon(reste);
    case 'apercu': return commandeApercu(reste);
    case 'shader': return commandeShader(reste);
    case 'kit': return commandeKit();
    case 'objets': return commandeObjets(reste);
    case 'creatures': return (await import('../src/creatures/liste.js')).commandeCreatures(reste, { lireArgs, dire, Usage });
    case 'simuler': return commandeSimuler(reste);
    case 'regles': return commandeRegles(reste);
    case 'mods': return commandeMods(reste);
    case 'decor': return (await import('../src/decor/commande.js')).commandeDecor(reste, { obtenirZone, trouverKit, lireArgs, dire, Usage, lireTexte, terrainDeScene });
    case '--version': case '-v': return dire(JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version);
    case undefined: case 'aide': case '--help': case '-h': return dire(AIDE);
    default: throw new Usage(`commande inconnue : ${cmd}\n${AIDE}`);
  }
}

// On attend que la sortie soit ecrite avant de quitter (tuyaux asynchrones sous Windows).
const quitter = (code) => process.stdout.write('', () => process.exit(code));
main().then(() => quitter(0), (e) => {
  console.error(`erreur : ${e.message}`);
  if (process.env.MCANIM_DEBUG) console.error(e.stack);
  quitter(e instanceof Usage ? 2 : 1);
});
