// Ce que la scene demande en objets et en armure : groupes de kit a recuperer, controle des identifiants (erreur d'une ligne, rien n'est
// rendu), et UNE ligne de notes (objets en plaque de repli, types non geres). Sert a mcanim (rendre, apercu) et a `mcanim objets`.
import fs from 'node:fs';
import path from 'node:path';
import { idsDeScene } from '../film/objets-scene.js';
import { evenementsDeScene } from '../creatures/scene.js';
import { listeObjets, groupePresent } from './fichiers.js';
import { objetPourNotes } from './habillage.js';
import { idRendu } from './reflet.js';
import { nomMateriau, couleurArmure, couchesTexture, materiauxDuKit, EMPLACEMENTS } from './armure.js';
import { TETE_DE_OBJET } from '../film/tetes-modele.js';

// Groupes a la demande (kit.js) dont la scene a besoin : ['objets'], ['armures'], les deux ou [].
export function groupesDeScene(scene) {
  const { objets, armures } = idsDeScene(scene);
  const m = groupesMontage(scene);   // textes et incrustations : groupe `interface` (police, sprites) ; icones d'objets : `objets`
  // une scene avec monde peut lacher des objets au sol (butin des blocs casses ou detruits) : leur modele vient du groupe `objets`
  return [...(objets.size || m.objets || scene.monde || scene.acteurs.some((a) => a.creature?.echange) ? ['objets'] : []), ...(armures.size ? ['armures'] : []), ...(m.interface || scene.decor || scene.acteurs.some((a) => a.etiquette) ? ['interface'] : []), ...(scene.monde ? ['projectiles', 'worldgen', 'recettes'] : []),...(scene.acteurs.some((a) => a.creature) ? ['entites', 'sons_creatures'] : evenementsDeScene(scene) ? ['sons_creatures'] : []), ...(scene.monde && !scene.acteurs.some((a) => a.creature) ? ['entites'] : [])];   // monde : rayon de la balise, livre du pupitre, wagonnets nes en route (textures entity/)   // creatures : textures et sons du jeu ; sons du monde a la demande (ambiance, sons nommes hors du kit de base)
}

// Groupes de kit dont le montage a besoin : { interface, objets }.
const AVEC_OBJETS = new Set(['icone', 'equation', 'inventaire', 'coffre', 'hud', 'succes', 'horloge', 'minuteur', 'poste']);
function groupesMontage(scene) {
  const r = { interface: !!scene.textes?.length, objets: false };
  const marche = (liste) => { for (const e of liste ?? []) { r.interface = true; if (AVEC_OBJETS.has(e.type) && !(e.type === 'icone' && !e.objet)) r.objets = true; marche(e.incrustations); } };
  marche(scene.incrustations);
  return r;
}

// Recherche d'objets pour `mcanim objets --cherche` : tous les mots doivent etre dans l'identifiant ; quelques mots francais ou generiques
// sont traduits (poisson ne trouve rien dans les identifiants anglais, "fish" non plus : cod, salmon...).
const SYNONYMES = {
  fish: ['cod', 'salmon', 'cooked_cod', 'cooked_salmon', 'tropical_fish', 'pufferfish'], poisson: ['cod', 'salmon', 'cooked_cod', 'cooked_salmon', 'tropical_fish', 'pufferfish'],
  epee: ['sword'], hache: ['_axe'], pioche: ['pickaxe'], pelle: ['shovel'], houe: ['hoe'], arc: ['bow'], fleche: ['arrow'], bouclier: ['shield'], torche: ['torch'],
  pomme: ['apple'], pain: ['bread'], viande: ['beef', 'porkchop', 'mutton', 'chicken'], livre: ['book'], planches: ['planks'], pierre: ['stone'], terre: ['dirt'],
  bois: ['log', 'planks'], fleur: ['dandelion', 'poppy', 'tulip', 'orchid', 'cornflower'], canne: ['fishing_rod'], diamant: ['diamond'], or: ['gold'], fer: ['iron'],
  casque: ['helmet'], plastron: ['chestplate'], jambieres: ['leggings'], bottes: ['boots'], carte: ['map'], baton: ['stick'], os: ['bone'], oeuf: ['egg'],
};
export function chercherObjets(kit, texte, max = 20) {
  const mots = String(texte).toLowerCase().replace(/minecraft:/g, '').split(/[\s,]+/).filter(Boolean);
  const liste = listeObjets(kit);
  const alt = mots.length === 1 && SYNONYMES[mots[0]] ? SYNONYMES[mots[0]] : null;
  const tous = alt ? [...new Set(alt.flatMap((a) => liste.filter((id) => id.includes(a) && !/_(bucket|spawn_egg)$/.test(id))))] : liste.filter((id) => mots.every((m) => id.includes(m)));
  const premiers = (alt ? tous : [...tous.filter((id) => id.startsWith(mots[0])), ...tous.filter((id) => !id.startsWith(mots[0]))]).slice(0, max);
  return { premiers, total: tous.length };
}

// Mots de la recherche qui ressemblent a `id` : les ids qui le contiennent, sinon ceux qui partagent son plus long morceau (<= 5).
export function proches(kit, id, n = 5) {
  const liste = listeObjets(kit);
  const mot = String(id).toLowerCase();
  let r = liste.filter((x) => x.includes(mot));
  if (!r.length) for (const m of mot.split('_').filter((s) => s.length > 2)) r.push(...liste.filter((x) => x.includes(m)));
  return [...new Set(r)].slice(0, n);
}

// Retourne { erreur: texte | null, note: texte | null }.
export function planifier(scene, kit) {
  const mains = new Map();   // id -> Set('D'|'G')
  for (const a of scene.acteurs) for (const [c, p] of [['D', a.objetD], ['G', a.objetG]]) for (const k of p?.cles ?? []) if (k.id) (mains.get(k.id) ?? mains.set(k.id, new Set()).get(k.id)).add(c);
  for (const a of scene.acteurs) for (const x of a.actes ?? []) if (x.verbe === 'tient' && x.objet) { const id = idRendu(x.objet); (mains.get(id) ?? mains.set(id, new Set()).get(id)).add('D'); }   // objets tenus par les intentions : controles comme `objet` (une pile enchantee `diamond_sword[sharpness=5]` : l'objet dessine)
  const { armures } = idsDeScene(scene);
  const plats = [], blocs = [], plaques = [], vides = [], autres = [];
  if (mains.size && !groupePresent(kit, 'objets')) return { erreur: 'les fichiers d\'objets du jeu manquent dans ce kit (groupe "objets") : relance sans MCANIM_KIT, ils seront recuperes', note: null };
  for (const [id, cotes] of mains) {
    const r = objetPourNotes(kit, id, false);
    if (!r.existe) {
      const p = proches(kit, id);
      return { erreur: `objet inconnu : "${id}"${p.length ? ` (proches : ${p.join(', ')})` : ''} ; cherche avec : mcanim objets --cherche <mot>`, note: null };
    }
    for (const c of cotes) if (c === 'G') objetPourNotes(kit, id, true);
    const natures = new Set(r.natures);
    if (!r.couches.length) vides.push(id);
    else if (natures.has('plaque')) plaques.push(id);
    else if (natures.has('vide')) vides.push(id);
    else if (natures.has('bloc')) blocs.push(id);
    else plats.push(id);
    for (const n of r.notes) if (/type de modele non gere/.test(n)) autres.push(n);
  }
  if (armures.size && !groupePresent(kit, 'armures')) return { erreur: 'les fichiers d\'armure du jeu manquent dans ce kit (groupe "armures") : relance sans MCANIM_KIT, ils seront recuperes', note: null };
  // armure : chaque materiau doit exister pour chaque emplacement ou il est utilise
  for (const a of scene.acteurs) {
    for (const [e, p] of Object.entries(a.armure ?? {})) {
      for (const k of p.cles) {
        if (!k.id) continue;
        const mat = nomMateriau(k.id);
        if (mat === 'elytra' && e === 'torse') { if (!fs.existsSync(path.join(kit, 'assets', 'minecraft', 'textures', 'entity', 'equipment', 'wings', 'elytra.png'))) return { erreur: 'armure.torse "elytra" : texture entity/equipment/wings/elytra absente du kit (groupe "armures")', note: null }; continue; }   // elytres : couche wings (WingsLayer)
        if (e === 'tete' && TETE_DE_OBJET[String(k.id).replace(/^minecraft:/, '')]) continue;   // tete (crane) portee : dessinee comme le jeu (CustomHeadLayer, objets/habillage.js)
        if (!mat || !couchesTexture(kit, mat, e)) return { erreur: `armure.${e} : "${k.id}" inconnu pour cet emplacement (materiaux : ${materiauxDuKit(kit).join(', ')} ; ou un objet comme diamond_helmet ; jambieres : pas de turtle)`, note: null };
        // cuir teint : "leather_chestplate#3A6FD8" ou "leather_chestplate#red" (une teinture du jeu) ; seul un calque teignable se teint
        if (/#/.test(k.id) && (couleurArmure(k.id) === null || !couchesTexture(kit, mat, e).some((c) => c.teinte !== null))) return { erreur: `armure.${e} : "${k.id}" : la teinte se met au cuir seulement, en #RRGGBB ou #teinture (white, orange, magenta, light_blue, yellow, lime, pink, gray, light_gray, cyan, purple, blue, brown, green, red, black)`, note: null };
      }
    }
  }
  void EMPLACEMENTS;
  const morceaux = [];
  if (plats.length) morceaux.push(`plats : ${plats.join(', ')}`);
  if (blocs.length) morceaux.push(`blocs : ${blocs.join(', ')}`);
  if (plaques.length) morceaux.push(`REPLI plaque plate (dessine par code dans le jeu) : ${plaques.join(', ')}`);
  if (vides.length) morceaux.push(`RIEN a dessiner : ${vides.join(', ')}`);
  if (autres.length) morceaux.push(...autres);
  const note = morceaux.length || armures.size ? `objets : ${[...morceaux, ...(armures.size ? [`armure ${[...armures].join(', ')} (sans galons ni brillance)`] : [])].join(' ; ')}` : null;
  return { erreur: null, note };
}
