// Donnees de blocs (entites de blocs) et entites d'une construction importee -> ce que le lecteur sait dessiner ou simuler :
//   banniere        motifs (champ `bannieres` de la scene)
//   panneau         texte avant / arriere, couleur, lueur (film/blocs-entites.js, comme SignRenderer / HangingSignRenderer)
//   conteneurs      Items -> `monde.contenus` (coffre, tonneau, entonnoir, dropper, distributeur, four, boite de shulker...) : contenu garde dans la simulation
//   pupitre         Book -> `monde.pupitres` (livre ecrit ou a ecrire, nombre de pages, page ouverte)
//   pot decore      sherds -> tessons dessines sur les quatre faces (film/blocs-entites.js)
//   cadre (entite)  item_frame / glow_item_frame -> `monde.cadres` (face, objet, rotation)
// Tetes, lits, coffres : leur dessin ne depend que de l'etat du bloc (rien a reprendre). Le reste (geniteurs, ruches, panneaux d'armure,
// tableaux, creatures) est compte et rapporte. Formats : 1.20.5+ (`front_text`, `count`, `components`) et anciens (`Text1..4`, `Count`, `tag`).
import { dirT, det } from './transfo.js';

const court = (s) => String(s ?? '').replace(/^minecraft:/, '').toLowerCase();
const CONTENEURS = /^(chest|trapped_chest|barrel|hopper|dropper|dispenser|furnace|blast_furnace|smoker|brewing_stand|(\w+_)?shulker_box|crafter|chiseled_bookshelf)$/;
const DIR3D = ['down', 'up', 'north', 'south', 'west', 'east'];   // Direction.get3DDataValue

// composant de texte du jeu (JSON en texte, texte simple 1.21.5+, ou compose NBT) -> texte brut
export function texteComposant(v, prof = 0) {
  if (v === null || v === undefined || prof > 8) return '';
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('{') || t.startsWith('[') || t.startsWith('"')) { try { return texteComposant(JSON.parse(t), prof + 1); } catch { return v; } }
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => texteComposant(x, prof + 1)).join('');
  if (typeof v === 'object') {
    let s = v.text !== undefined ? texteComposant(String(v.text), prof + 1) : v.translate !== undefined ? String(v.fallback ?? v.translate) : '';
    if (Array.isArray(v.extra)) s += v.extra.map((x) => texteComposant(x, prof + 1)).join('');
    return s;
  }
  return String(v);
}
const face = (t) => ({ lignes: [0, 1, 2, 3].map((k) => texteComposant(t?.messages?.[k]).slice(0, 80)), couleur: court(t?.color || 'black'), lueur: !!Number(t?.has_glowing_text ?? 0) });
export function texteDePanneau(dn) {
  if (dn.front_text || dn.back_text) return { avant: face(dn.front_text), arriere: face(dn.back_text) };
  return { avant: { lignes: [1, 2, 3, 4].map((k) => texteComposant(dn[`Text${k}`]).slice(0, 80)), couleur: court(dn.Color || 'black'), lueur: !!Number(dn.GlowingText ?? 0) }, arriere: { lignes: ['', '', '', ''], couleur: 'black', lueur: false } };
}
const nombre = (it) => Number(it?.count ?? it?.Count ?? 1) | 0;
const pagesLivre = (b) => {
  const c = b?.components ?? {}, w = c['minecraft:written_book_content'] ?? c['minecraft:writable_book_content'], p = w?.pages ?? b?.tag?.pages;
  return Array.isArray(p) ? p.length : 1;
};

// e : { x, y, z } (cellule dans le repere du fichier) ; versMonde(x, y, z) -> [X, Y, Z] ; T : transformation des etats (repere du fichier -> monde)
// sortie : { panneaux, pots, contenus, pupitres, cadres } (alimentee) ; rend le nom court si l'entite est reprise, sinon null
export function reprendreEntiteBloc(e, versMonde, T, sortie) {
  const id = court(e.id), dn = e.donnees ?? {};
  const [X, Y, Z] = versMonde(e.x, e.y, e.z);
  if (id === 'sign' || id === 'hanging_sign') { const t = texteDePanneau(dn); if ([...t.avant.lignes, ...t.arriere.lignes].some((l) => l.trim())) sortie.panneaux.push({ x: X, y: Y, z: Z, ...t }); return id; }
  if (id === 'decorated_pot') {
    // 1.20 : liste [arriere, gauche, droite, avant] ; 26.x : { back: {id}, left, right, front }
    const sh = dn.sherds;
    const s = Array.isArray(sh) ? sh.map((x) => court(x?.id ?? x)) : sh && typeof sh === 'object' ? ['back', 'left', 'right', 'front'].map((k) => court(sh[k]?.id ?? sh[k] ?? 'brick')) : [];
    while (s.length < 4) s.push('brick');
    const [arriere, gauche, droite, avant] = s;
    sortie.pots.push({ x: X, y: Y, z: Z, tessons: det(T.M) < 0 ? [arriere, droite, gauche, avant] : [arriere, gauche, droite, avant] });   // miroir : gauche <-> droite
    return id;
  }
  if (id === 'lectern') { if (dn.Book) sortie.pupitres.push([X, Y, Z, court(dn.Book.id) === 'writable_book' ? 'writable_book' : 'written_book', Math.max(1, Math.min(100, pagesLivre(dn.Book))), Math.max(0, Math.min(Number(dn.Page ?? 0) | 0, Math.max(1, Math.min(100, pagesLivre(dn.Book))) - 1))]); return id; }
  if (CONTENEURS.test(id)) {
    if (dn.LootTable && !(Array.isArray(dn.Items) && dn.Items.length)) sortie.butins = (sortie.butins ?? 0) + 1;   // table de butin : le jeu tire le contenu a l'ouverture
    const n = new Map();
    for (const it of Array.isArray(dn.Items) ? dn.Items : []) { const k = court(it.id); if (/^[a-z0-9_]+$/.test(k) && nombre(it) > 0) n.set(k, (n.get(k) || 0) + nombre(it)); }
    for (const [k, c] of n) sortie.contenus.push([X, Y, Z, k, Math.min(1728, c)]);
    return id;
  }
  if (id === 'skull') {
    // tete de joueur : profil (26.x `profile` : nom, id, proprietes "textures" ; ancien `SkullOwner`) -> skin du joueur au rendu
    const p = profilDe(dn.profile ?? dn.SkullOwner);
    if (p) sortie.tetes.push({ x: X, y: Y, z: Z, profil: p });
    return id;
  }
  if (id === 'mob_spawner' || id === 'trial_spawner') {
    // la creature qui tourne dans la cage (SpawnerRenderer / TrialSpawnerRenderer) : SpawnData / spawn_data / next_spawn_data
    const ent = dn.SpawnData?.entity ?? dn.spawn_data?.entity ?? dn.next_spawn_data?.entity ?? null;
    if (ent?.id) sortie.cages.push({ x: X, y: Y, z: Z, type: court(ent.id), genre: id });
    return id;
  }
  if (id === 'vault') { const it = dn.shared_data?.display_item; if (it?.id) sortie.objetsPoses.push({ x: X, y: Y, z: Z, objet: court(it.id), genre: 'vault' }); return id; }
  if (id === 'campfire') {
    // CampfireRenderer : jusqu'a 4 objets qui cuisent, a plat sur le feu
    (Array.isArray(dn.Items) ? dn.Items : []).forEach((it) => { if (it?.id) sortie.objetsPoses.push({ x: X, y: Y, z: Z, objet: court(it.id), genre: 'campfire', case: Number(it.Slot ?? 0) & 3 }); });
    return id;
  }
  // dessines par l'etat du bloc (modele, coffre, cloche, tete, statue...) ou sans rien de visible a reprendre (comparateur, capteur, ruche : les
  // abeilles sont dedans, bloc suspect : objet visible seulement pendant le brossage, coeur de grinceur)
  if (/^(banner|bed|bell|comparator|sculk_sensor|calibrated_sculk_sensor|sculk_shrieker|sculk_catalyst|beehive|creaking_heart|brushable_block|enchanting_table|end_portal|end_gateway|conduit|daylight_detector|jukebox|crafter|copper_golem_statue|shelf|note_block|chiseled_bookshelf|test_block|test_instance_block|command_block|beacon)$/.test(id) || /chest$/.test(id)) return id;
  return null;
}

// profil d'une tete de joueur -> { nom, uuid, url } (url du skin si la propriete "textures" est la)
export function profilDe(p) {
  if (!p) return null;
  if (typeof p === 'string') return /^[A-Za-z0-9_]{1,16}$/.test(p) ? { nom: p, uuid: null, url: null } : null;
  const nom = typeof (p.name ?? p.Name) === 'string' ? String(p.name ?? p.Name) : null;
  const idb = p.id ?? p.Id;
  let uuid = null;
  if (idb && typeof idb.length === 'number' && idb.length === 4) uuid = Array.from(idb, (v) => (Number(v) >>> 0).toString(16).padStart(8, '0')).join('');
  else if (typeof idb === 'string') uuid = idb.replace(/-/g, '').toLowerCase();
  let url = null;
  const props = Array.isArray(p.properties) ? p.properties : Array.isArray(p.Properties?.textures) ? p.Properties.textures.map((t) => ({ name: 'textures', value: t.Value })) : [];
  for (const pr of props) {
    const v = pr.value ?? pr.Value;
    if ((pr.name ?? 'textures') !== 'textures' || typeof v !== 'string') continue;
    try { url = JSON.parse(Buffer.from(v, 'base64').toString('utf8')).textures?.SKIN?.url ?? null; } catch { url = null; }
  }
  if (url && !/^https?:\/\/textures\.minecraft\.net\/texture\/[0-9a-f]+$/i.test(url)) url = null;   // seulement le serveur de skins du jeu
  if (!nom && !uuid && !url) return null;
  return { nom, uuid, url };
}

// ---------------------------------------------------------------- entites (non blocs)
const EQUIPEMENT = ['feet', 'legs', 'chest', 'head'];
const ARMURE = { head: 'tete', chest: 'torse', legs: 'jambes', feet: 'pieds' };
const estArmure = (id) => /_(helmet|chestplate|leggings|boots)$/.test(id) || id === 'turtle_helmet' || id === 'elytra';
const CHEVAUX = ['white', 'creamy', 'chestnut', 'brown', 'black', 'gray', 'darkbrown'], MARQUES = ['sans', 'markings_white', 'markings_whitefield', 'markings_whitedots', 'markings_blackdots'];
const PERROQUETS = ['red_blue', 'blue', 'green', 'yellow_blue', 'grey'], LAMAS = ['creamy', 'white', 'brown', 'gray'], AXOLOTLS = ['lucy', 'wild', 'gold', 'cyan', 'blue'];
const LAPINS = { 0: 'brown', 1: 'white', 2: 'black', 3: 'white_splotched', 4: 'gold', 5: 'salt', 99: 'caerbannog' };
const TEINTURES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const BOIS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'cherry', 'dark_oak', 'pale_oak', 'mangrove', 'bamboo', 'poplar'];
// pose par defaut d'un porte-armure (ArmorStand.DEFAULT_*_POSE), degres
const POSE_DEFAUT = { Head: [0, 0, 0], Body: [0, 0, 0], LeftArm: [-10, 0, -10], RightArm: [-15, 0, 10], LeftLeg: [-1, 0, -1], RightLeg: [1, 0, 1] };
const PARTIE = { Head: 'head', Body: 'body', LeftArm: 'left_arm', RightArm: 'right_arm', LeftLeg: 'left_leg', RightLeg: 'right_leg' };
const DIR2D = ['south', 'west', 'north', 'east'];   // Direction.get2DDataValue

// equipement (26.x `equipment` ; ancien ArmorItems [pieds, jambes, torse, tete] + HandItems [main, autre main])
function equipementDe(dn) {
  const eq = {};
  // profil d'une tete de joueur portee : composant minecraft:profile (1.20.5+) ou tag.SkullOwner (avant)
  const prof = (v) => profilDe(v?.components?.['minecraft:profile'] ?? v?.tag?.SkullOwner ?? null);
  if (dn.equipment?.head) eq.profilTete = prof(dn.equipment.head);
  if (!eq.profilTete && Array.isArray(dn.ArmorItems) && dn.ArmorItems[3]) eq.profilTete = prof(dn.ArmorItems[3]);
  if (dn.equipment && typeof dn.equipment === 'object') for (const [k, v] of Object.entries(dn.equipment)) if (v?.id) eq[k] = court(v.id);
  (Array.isArray(dn.ArmorItems) ? dn.ArmorItems : []).forEach((v, i) => { if (v?.id && !eq[EQUIPEMENT[i]]) eq[EQUIPEMENT[i]] = court(v.id); });
  (Array.isArray(dn.HandItems) ? dn.HandItems : []).forEach((v, i) => { const k = i ? 'offhand' : 'mainhand'; if (v?.id && !eq[k]) eq[k] = court(v.id); });
  return eq;
}
const variante = (v) => court(v).replace(/^.*:/, '');
function nomPerso(dn) {
  if (!dn.CustomNameVisible || dn.CustomName === undefined) return null;
  const t = texteComposant(dn.CustomName);
  return t ? String(t).slice(0, 40) : null;
}

// e : { x, y, z (doubles : position dans le repere du fichier), bloc ([x, y, z] de la cellule, .nbt), id, donnees } ; versMonde(cellule) -> monde (entiers) ;
// T : transformation (etats, directions, lacets) ; versPoint(x, y, z) -> monde (doubles) ; rend le genre repris ou null
export function reprendreEntite(e, versMonde, T, sortie, versPoint = null) {
  const id = court(e.id), dn = e.donnees ?? {};
  const cell = e.bloc ?? [Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)];
  const [X, Y, Z] = versMonde(cell[0], cell[1], cell[2]);
  if (id === 'item_frame' || id === 'glow_item_frame') {
    const f = DIR3D[Number(dn.Facing ?? 2)] ?? 'north';
    const objet = dn.Item?.id ? court(dn.Item.id) : null;
    sortie.cadres.push([X, Y, Z, dirT(f, T), objet && /^[a-z0-9_]+$/.test(objet) ? objet : null, (Number(dn.ItemRotation ?? 0) | 0) & 7, ...(id === 'glow_item_frame' ? ['lueur'] : [])]);
    return id;
  }
  if (id === 'painting') {
    const f = dn.facing !== undefined ? DIR2D[Number(dn.facing) & 3] : dn.Facing !== undefined ? DIR2D[Number(dn.Facing) & 3] : 'south';
    sortie.tableaux.push({ x: X, y: Y, z: Z, face: dirT(f, T), variante: variante(dn.variant ?? dn.Motive ?? 'kebab') });
    return id;
  }
  if (id === 'leash_knot') { sortie.noeuds.push({ x: X, y: Y, z: Z }); return id; }
  // lacet (0 = sud, 90 = ouest) transforme : vecteur (-sin, cos) -> T -> angle
  const a = Number(dn.Rotation?.[0] ?? 0) * Math.PI / 180, vx = -Math.sin(a), vz = Math.cos(a), nx = T.M[0] * vx + T.M[1] * vz, nz = T.M[2] * vx + T.M[3] * vz;
  const lacet = Math.round((Math.atan2(-nx, nz) * 180 / Math.PI) * 100) / 100;
  const P = versPoint ? versPoint(e.x, e.y, e.z) : [X + 0.5, Y, Z + 0.5];
  if (id === 'cushion') { sortie.coussins.push({ x: P[0], y: P[1], z: P[2], lacet, couleur: TEINTURES.includes(court(dn.color)) ? court(dn.color) : 'white' }); return id; }
  const eq = equipementDe(dn);
  const acteur = { pos: P, lacet, source: id };
  if (Number(dn.Age ?? 0) < 0 || Number(dn.IsBaby ?? 0) === 1) acteur.bebe = true;
  const nom = nomPerso(dn); if (nom) acteur.etiquette = nom;
  const armure = {};
  for (const [k, v] of Object.entries(ARMURE)) if (eq[k] && estArmure(eq[k])) armure[v] = eq[k];
  if (Object.keys(armure).length) acteur.armure = armure;
  if (eq.mainhand) acteur.objet = eq.mainhand;
  if (eq.offhand) acteur.objetG = eq.offhand;
  if (eq.head && !estArmure(eq.head)) acteur.coiffe = eq.head;   // citrouille, tete, bloc porte sur la tete (CustomHeadLayer)
  if (acteur.coiffe === 'player_head' && eq.profilTete) acteur.coiffeProfil = eq.profilTete;
  const uid = dn.UUID; if (uid && typeof uid.length === 'number' && uid.length === 4) acteur.uuid = Array.from(uid, (v) => (Number(v) >>> 0).toString(16).padStart(8, '0')).join('');
  const mobs = (type, v = null) => { acteur.type = type; if (v) acteur.variante = v; sortie.acteurs.push(acteur); return id; };
  if (id === 'armor_stand') {
    // pose (degres) ; miroir : gauche <-> droite et rotations y, z opposees
    const pose = {};
    const mi = det(T.M) < 0;
    for (const [k, def] of Object.entries(POSE_DEFAUT)) {
      const v = dn.Pose?.[k] ? Array.from(dn.Pose[k], Number) : def;
      let n = PARTIE[k];
      if (mi) n = n.startsWith('left_') ? n.replace('left_', 'right_') : n.startsWith('right_') ? n.replace('right_', 'left_') : n;
      pose[n] = mi ? [v[0], -v[1], -v[2]] : v;
    }
    acteur.parties = { ...pose, left_body_stick: pose.body, right_body_stick: pose.body, shoulder_stick: pose.body, base_plate: [0, -lacet, 0] };   // ArmorStandModel.setupAnim
    acteur.cacher = [...(dn.ShowArms ? [] : ['left_arm', 'right_arm']), ...(dn.NoBasePlate ? ['base_plate'] : []), ...(dn.Invisible ? ['head', 'body', 'left_arm', 'right_arm', 'left_leg', 'right_leg', 'left_body_stick', 'right_body_stick', 'shoulder_stick', 'base_plate'] : [])];
    if (dn.Small) acteur.bebe = true;
    return mobs('armor_stand');
  }
  if (id === 'mannequin') {   // MANNEQUIN (26.x) : modele de joueur, skin de son profil
    const p = profilDe(dn.profile);
    acteur.joueur = true; if (p) acteur.profil = p;
    sortie.acteurs.push(acteur); return id;
  }
  if (id === 'villager' || id === 'zombie_villager') {
    const vd = dn.VillagerData ?? {};
    return mobs(id, `${variante(vd.type ?? 'plains')} ${variante(vd.profession ?? 'none')} ${Math.max(1, Math.min(5, Number(vd.level ?? 1)))}`);
  }
  if (id === 'cat') return mobs('cat', variante(dn.variant ?? 'tabby'));
  if (id === 'wolf') return mobs('wolf', variante(dn.variant ?? 'pale'));
  if (id === 'cow' || id === 'pig' || id === 'chicken' || id === 'frog') return mobs(id, dn.variant ? variante(dn.variant) : null);
  if (id === 'sheep') return mobs('sheep', TEINTURES[Number(dn.Color ?? 0) & 15]);
  if (id === 'horse') { const v = Number(dn.Variant ?? 0); return mobs('horse', `${CHEVAUX[v & 255] ?? 'white'} ${MARQUES[(v >> 8) & 255] ?? 'sans'}`); }
  if (id === 'parrot') return mobs('parrot', PERROQUETS[Number(dn.Variant ?? 0)] ?? 'red_blue');
  if (id === 'llama' || id === 'trader_llama') return mobs(id, LAMAS[Number(dn.Variant ?? 0)] ?? 'creamy');
  if (id === 'axolotl') return mobs('axolotl', AXOLOTLS[Number(dn.Variant ?? 0)] ?? 'lucy');
  if (id === 'rabbit') return mobs('rabbit', LAPINS[Number(dn.RabbitType ?? 0)] ?? 'brown');
  if (id === 'fox') return mobs('fox', court(dn.Type ?? 'red') === 'snow' ? 'snow' : 'red');
  if (id === 'mooshroom') return mobs('mooshroom', court(dn.Type ?? 'red') === 'brown' ? 'brown' : 'red');
  if (id === 'copper_golem') return mobs('copper_golem', court(dn.weather_state ?? 'unaffected'));
  const bateau = /^(\w+?)_(chest_)?(boat|raft)$/.exec(id);
  if (bateau && BOIS.includes(bateau[1])) return mobs(bateau[2] ? 'chest_boat' : 'boat', bateau[1]);
  if (id === 'boat' || id === 'chest_boat') return mobs(id, BOIS.includes(court(dn.Type)) ? court(dn.Type) : 'oak');
  acteur.type = id;
  sortie.acteurs.push(acteur);   // type controle plus tard (decor/index.js : seulement les types que le lecteur dessine)
  return id;
}
