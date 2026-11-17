// Champs d'acteur `objet`, `objetG` (objet tenu en main droite et en main gauche) et `armure` : lecture, controle, valeur au temps t.
// Un objet : un identifiant d'objet du jeu ("cod", "diamond_sword", "torch", "oak_planks"...) pour toute la scene, ou une piste de
// changements d'un coup [[t, "id" | null], ...] (null = la main est vide). Avant la premiere cle : main vide.
// Armure : { tete, torse, jambes, pieds } ; chaque emplacement : un materiau ("diamond", "iron", "golden", "leather", "chainmail",
// "netherite", "copper", "turtle") ou un objet d'armure ("diamond_helmet"), pour toute la scene ou en piste de changements.
// Le controle ne regarde pas le kit (la scene se lit sans lui) : l'existence de l'objet est controlee par mcanim avant le rendu.
export const MAX_CLES_OBJETS = 16;
export const EMPLACEMENTS_ARMURE = ['tete', 'torse', 'jambes', 'pieds'];
const ID = /^(minecraft:)?[a-z0-9_./-]{1,80}$/;

const estNombre = (x) => typeof x === 'number' && Number.isFinite(x);

// Retourne { cles: [{ t, id }] } (id : texte sans "minecraft:", ou null) ou leve via `erreur(chemin, message)`.
function lirePisteTexte(brut, ch, erreur, quoi) {
  const verifie = (v, c) => {
    if (v === null) return null;
    if (typeof v !== 'string' || !ID.test(v) || v.includes('..')) erreur(c, `${quoi} attendu (minuscules, chiffres, _ - . / ; par exemple "cod" ou "diamond_sword"), ou null pour une main vide, pas ${JSON.stringify(v)}`);
    return v.replace(/^minecraft:/, '');
  };
  if (typeof brut === 'string') return { cles: [{ t: 0, id: verifie(brut, ch) }] };
  if (!Array.isArray(brut) || brut.length === 0) erreur(ch, `${quoi} (texte) ou liste de changements [[t, "id" ou null], ...] attendu`);
  if (brut.length > MAX_CLES_OBJETS) erreur(ch, `${MAX_CLES_OBJETS} changements au maximum`);
  return {
    cles: brut.map((k, i) => {
      const c = `${ch}[${i}]`;
      if (!Array.isArray(k) || k.length !== 2 || !estNombre(k[0]) || k[0] < 0) erreur(c, 'forme attendue : [temps, "id" ou null] (temps >= 0)');
      if (i > 0 && k[0] < brut[i - 1][0]) erreur(`${c}[0]`, 'les cles doivent etre classees par temps croissant');
      return { t: k[0], id: verifie(k[1], `${c}[1]`) };
    }),
  };
}

// a : acteur brut ; ch : "acteurs[i]" ; erreur : (chemin, message) => leve. Retourne { objetD, objetG, armure } (champs absents : non definis).
export function lireHabillage(a, ch, erreur) {
  const o = {};
  if (a.objet !== undefined && a.objetD !== undefined) erreur(`${ch}.objetD`, '"objet" et "objetD" disent la meme chose (main droite) : garde un seul des deux');
  if (a.objet !== undefined) o.objetD = lirePisteTexte(a.objet, `${ch}.objet`, erreur, 'identifiant d\'objet');
  else if (a.objetD !== undefined) o.objetD = lirePisteTexte(a.objetD, `${ch}.objetD`, erreur, 'identifiant d\'objet');   // "objetD" = "objet" (avant : accepte puis ignore sans rien dire)
  if (a.objetG !== undefined) o.objetG = lirePisteTexte(a.objetG, `${ch}.objetG`, erreur, 'identifiant d\'objet');
  if (a.armure !== undefined) {
    if (a.armure === null || typeof a.armure !== 'object' || Array.isArray(a.armure)) erreur(`${ch}.armure`, 'un objet est attendu, par exemple {"tete": "iron", "torse": "diamond"}');
    const arm = {};
    for (const [k, v] of Object.entries(a.armure)) {
      if (!EMPLACEMENTS_ARMURE.includes(k)) erreur(`${ch}.armure.${k}`, `emplacement inconnu (permis : ${EMPLACEMENTS_ARMURE.join(', ')} ; elytres, citrouille et tetes ne sont pas dessinees)`);
      arm[k] = lirePisteTexte(v, `${ch}.armure.${k}`, erreur, 'materiau ou objet d\'armure');
    }
    if (Object.keys(arm).length) o.armure = arm;
  }
  return o;
}

// Valeur d'une piste de changements au temps t : l'id de la derniere cle atteinte, sinon null (main vide, pas d'armure).
export function valeurObjet(piste, t) {
  let id = null;
  for (const k of piste.cles) { if (k.t <= t) id = k.id; else break; }
  return id;
}

// Tous les identifiants cites par une scene validee : { objets: Set, armures: Set } (pour mcanim : kit a recuperer, controles, note).
export function idsDeScene(scene) {
  const objets = new Set(), armures = new Set();
  for (const a of scene.acteurs) {
    for (const p of [a.objetD, a.objetG]) for (const k of p?.cles ?? []) if (k.id) objets.add(k.id);
    for (const p of Object.values(a.armure ?? {})) for (const k of p.cles) if (k.id) armures.add(k.id);
    for (const x of a.actes ?? []) { if (x.verbe === 'tient' && x.objet) objets.add(x.objet); else if (x.verbe === 'pose') objets.add(x.bloc); }   // objets tenus par les intentions (tient, pose)
  }
  return { objets, armures };
}
