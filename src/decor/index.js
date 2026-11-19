// Decors (docs/FORMAT-DECOR.md) : faire construire le LLM sur le terrain de la zone. Point d'entree de la phase 1.
//   scene.decor = ["maison.decor.json", {...decor en ligne...}]   (au plus 32, appliques dans l'ordre)
// Le decor est applique a une COPIE de la zone, avant le moteur et le maillage : le reste du lecteur voit une zone ordinaire.
import { lireDecorsScene, appliquerDecors } from './appliquer.js';
import { validerScene } from '../film/scene.js';
import { ESPECES, lireVariante } from '../creatures/especes.js';
import { skinParDefautUUID, TETE_DE_OBJET } from '../film/tetes-modele.js';

export { lireDecor, lireDecorTexte, NOMS_OPS, encoderGrille, decoderGrille, fichiersImportes } from './lire.js';
export { lireDecorsScene, appliquerDecors } from './appliquer.js';
export { ErreurDecor, LIMITES } from './grille.js';
export { rapportDecor } from './rapport.js';

// Zone + decors de la scene -> { zone, rapports, notes }. Sans decor : la zone elle-meme, sans copie.
// donnees : tables du jeu (moteur/chargeur.js : donneesDuJeu) ; baseDir : dossier du fichier de scene.
export async function zoneAvecDecor({ zone, scene, baseDir, donnees, chercherSkin = chercherSkinProfil }) {
  if (!scene?.decor?.length) return { zone, rapports: [], notes: [] };
  const lus = lireDecorsScene(scene.decor, { baseDir, d: donnees, zoneId: scene.zone });
  const r = appliquerDecors(zone, lus, { donnees });
  const notes = r.rapports.map((x) => `decor ${x.nom} : ${x.plus + x.moins} blocs changes en ${Math.round(x.ms)} ms${x.flottants ? `, ${x.flottants} flottant(s)` : ''}`);
  // motifs des bannieres importees (.schem/.nbt/.litematic) : ajoutes au champ `bannieres` de la scene (celles de la scene passent avant)
  if (r.bannieres.length) {
    const deja = new Set((scene.bannieres ?? []).map(([x, y, z]) => `${x},${y},${z}`));
    scene.bannieres = [...(scene.bannieres ?? []), ...r.bannieres.filter(([x, y, z]) => !deja.has(`${x},${y},${z}`))];
  }
  // donnees des blocs importes : panneaux et pots pour le dessin (champ interne `_entitesDecor`, lu par film/blocs-entites.js) ; conteneurs,
  // pupitres et cadres rejoignent `monde.contenus / pupitres / cadres` (la simulation les garde : un acteur ouvre le coffre et y trouve le butin).
  // Ce que la scene ecrit elle-meme a la meme position passe avant.
  const be = r.blocsEntites;
  // tetes de joueur : skin du profil (adresse du serveur de skins du jeu, sinon session Mojang par l'UUID, sinon par le nom) ; sans reponse :
  // skin par defaut choisi par l'UUID ou le nom (comme le jeu), dit dans les notes
  const tetes = [];
  for (const t of be.tetes) {
    let png = null;
    try { png = await chercherSkin(t.profil); } catch { png = null; }
    if (!png) notes.push(`decor : skin de la tete de joueur ${t.profil.nom ?? t.profil.uuid ?? ''} injoignable : skin par defaut`);
    tetes.push({ x: t.x, y: t.y, z: t.z, png, graine: t.profil.uuid ?? t.profil.nom ?? 'steve' });
  }
  scene._entitesDecor = { panneaux: be.panneaux, pots: be.pots, tetes, cages: be.cages, objetsPoses: be.objetsPoses, tableaux: be.tableaux, noeuds: be.noeuds, coussins: be.coussins };
  if (scene.monde && (be.contenus.length || be.pupitres.length || be.cadres.length)) {
    const cle = (e) => `${e[0]},${e[1]},${e[2]}`;
    const fusion = (k, liste, max) => {
      const deja = new Set((scene.monde[k] ?? []).map(cle));
      const ajout = liste.filter((e) => !deja.has(cle(e)));
      const tout = [...(scene.monde[k] ?? []), ...ajout];
      if (tout.length > max) notes.push(`decor : ${tout.length - max} ligne(s) de monde.${k} importee(s) au-dela de ${max} non reprises`);
      if (ajout.length) scene.monde[k] = tout.slice(0, max);
    };
    fusion('contenus', be.contenus, 5000); fusion('pupitres', be.pupitres, 500); fusion('cadres', be.cadres, 2000);
  }
  // entites des constructions (creatures, villageois, porte-armures, bateaux, wagonnets, cristaux...) : acteurs de la scene, immobiles, simules
  // comme les autres (meme controle que les acteurs ecrits : film/scene.js)
  // tetes de joueur portees par les entites : meme recherche de skin que les tetes posees
  for (const e of be.acteurs) if (e.coiffeProfil) {
    let png = null;
    try { png = await chercherSkin(e.coiffeProfil); } catch { png = null; }
    let tex = null;
    if (png) { try { const { decoderPNG } = await import('../rendu/png.js'); const { convertirSkin } = await import('../perso/skin.js'); const im = decoderPNG(png); tex = { largeur: 64, hauteur: 64, rgba: convertirSkin(im.rgba, im.largeur, im.hauteur).rgba }; } catch { tex = null; } }
    e.coiffeSkin = { png, uuid: e.coiffeProfil.uuid, tex };
    if (!png) notes.push(`decor : skin de la tete de joueur portee ${e.coiffeProfil.nom ?? e.coiffeProfil.uuid ?? ''} injoignable : skin par defaut`);
  }
  if (be.acteurs.length) ajouterActeurs(scene, be.acteurs, notes);
  return { zone: r.zone, rapports: r.rapports, notes, bannieres: r.bannieres, blocsEntites: be };
}

const MAX_ACTEURS = 150;
function ajouterActeurs(scene, liste, notes) {
  const place = Math.max(0, MAX_ACTEURS - scene.acteurs.length);
  if (liste.length > place) notes.push(`decor : ${liste.length - place} entite(s) importee(s) au-dela de ${MAX_ACTEURS} acteurs non reprises`);
  const pris = new Set(scene.acteurs.map((a) => a.nom));
  let k = 0;
  const bruts = [], extras = [];
  for (const e of liste.slice(0, place)) {
    if (e.type && !ESPECES[e.type]) { notes.push(`decor : entite ${e.type} importee non dessinee par le lecteur`); continue; }
    let nom; do nom = `import_${e.source}_${++k}`; while (pris.has(nom));
    pris.add(nom);
    const a = { nom, pos: [[0, ...e.pos.map((v) => Math.round(v * 1000) / 1000)]], lacet: [[0, e.lacet]] };
    if (e.joueur) {
      // mannequin : skin du profil (pseudo). Sans profil, celui du jeu 26.3 (lu dans le jar : ClientMannequin.DEFAULT_SKIN =
      // DefaultPlayerSkin.get(Mannequin.DEFAULT_PROFILE = ResolvableProfile.Static.EMPTY), profil vide -> createPartialProfile -> Util.NIL_UUID,
      // hashCode 0 -> DEFAULT_SKINS[0] = alex fin ; l'UUID de l'entite n'y entre pas). Profil a UUID seul : DefaultPlayerSkin.get(cet UUID)
      // (ce que le jeu montre tant que les services ne repondent pas ; 9 skins, fin ou large).
      if (e.profil?.nom && /^[A-Za-z0-9_]{1,16}$/.test(e.profil.nom)) a.skin = e.profil.nom;
      else { const sd = skinParDefautUUID(e.profil?.uuid ?? '00000000000000000000000000000000'); a.skin = sd.nom; a.modele = sd.modele; }
    }
    else { a.type = e.type; if (e.variante && !lireVariante(e.type, e.variante).erreur) a.variante = e.variante; if (e.bebe) a.bebe = true; }
    if (e.armure) a.armure = e.armure;
    if (e.joueur && e.coiffe && TETE_DE_OBJET[e.coiffe]) a.armure = { ...(a.armure ?? {}), tete: e.coiffe };   // mannequin : crane porte (objets/habillage.js)
    if (e.objet) a.objet = e.objet;
    if (e.objetG) a.objetG = e.objetG;
    if (e.etiquette) a.etiquette = e.etiquette;
    if (e.parties) a.parties = Object.fromEntries(Object.entries(e.parties).map(([n, v]) => [n, [[0, ...v.map((x) => Math.round(x * 1000) / 1000)]]]));
    bruts.push(a); extras.push(e);
  }
  if (!bruts.length) return;
  let lus;
  try {
    lus = validerScene({ v: 1, format: '1920x1080', duree: Math.max(1, scene.duree ?? 1), zone: 'A'.repeat(22), acteurs: bruts, camera: { pos: [[0, 0, 0, 0]], cible: [[0, 0, 0, 1]] } }).acteurs;
  } catch (err) { notes.push(`decor : entites importees non reprises (${String(err.message).slice(0, 120)})`); return; }
  lus.forEach((a, i) => {
    if (a.creature && extras[i].cacher?.length) a.creature.cacher = extras[i].cacher;   // porte-armure : bras, socle (film/creatures.js)
    if (a.creature && extras[i].coiffe) a.creature.coiffe = extras[i].coiffe;           // bloc ou tete porte sur la tete (CustomHeadLayer)
    if (a.creature && extras[i].coiffeSkin) a.creature.coiffeSkin = extras[i].coiffeSkin;
    if (!a.creature && extras[i].coiffeSkin) a.teteSkin = extras[i].coiffeSkin;
    a.importe = true;
    scene.acteurs.push(a);
  });
}

// skin d'un profil de tete de joueur -> octets PNG ou null (serveur de skins du jeu ; delai court : un bac a sable sans reseau ne bloque pas)
const memoSkins = new Map();
export async function chercherSkinProfil(p) {
  const cle = p.url ?? p.uuid ?? p.nom;
  if (memoSkins.has(cle)) return memoSkins.get(cle);
  const { Net } = await import('../net.js');
  const net = new Net({ connectTimeout: 2000 });
  const course = new Promise((_, ko) => setTimeout(() => ko(new Error('delai')), 5000).unref());
  let png = null;
  try {
    png = await Promise.race([(async () => {
      let url = p.url, uuid = p.uuid;
      if (!url && !uuid && p.nom) uuid = (await net.json(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(p.nom)}`, { retries: 0 }))?.id ?? null;
      if (!url && uuid) {
        const sess = await net.json(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`, { retries: 0 });
        const prop = (sess.properties || []).find((x) => x.name === 'textures');
        url = prop ? JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')).textures?.SKIN?.url ?? null : null;
      }
      if (!url || !/^https?:\/\/textures\.minecraft\.net\/texture\/[0-9a-f]+$/i.test(url)) return null;
      return (await net.buffer(url.replace(/^http:/, 'https:'), { retries: 0 })).body;
    })(), course]);
  } catch { png = null; } finally { net.close?.(); }
  memoSkins.set(cle, png);
  return png;
}

// Une ligne pour `mcanim terrain --scene` (300 octets au plus) : les portes des decors comme passages [x, z, cote de la sortie, ouverte|fermee] et les emprises
export function resumeTerrainDecor(rapports) {
  const COTE = { north: 'N', south: 'S', east: 'E', west: 'O' };
  const OPPOSE = { north: 'south', south: 'north', east: 'west', west: 'east' };
  const portes = rapports.flatMap((r) => r.portes.map((p) => `[${p.x},${p.z},${COTE[OPPOSE[p.f]] || '?'},${p.ouverte ? 'ouverte' : 'fermee'}]`));
  const emprises = rapports.filter((r) => r.cellules).map((r) => `${r.nom.replace(/\.decor\.json$/, '')} [${r.emprise.x0},${r.emprise.z0},${r.emprise.x1},${r.emprise.z1}]`);
  let t = `decor : ${emprises.join(' ')}${portes.length ? ' ; portes (x,z,cote de la sortie N=-z S=+z E=+x O=-x, etat) : ' + portes.join(' ') : ''}. Les chemins ci-dessus tiennent compte des batiments ; un acteur entre par une porte ouverte.`;
  if (Buffer.byteLength(t) > 420) t = t.slice(0, 417) + '...';
  return t;
}
