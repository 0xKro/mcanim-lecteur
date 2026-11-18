// Blocs et entites DEFINIS par les mods d'une scene (docs/SIMULATION.md 3.2 et partie 26) :
//   mc.definirBloc('ville:tnt_bleue', { copieDe: 'tnt', aspect, teinte, modele, textures, lumiere, durete, resistance, friction, sur: {...} })
//   mc.definirEntite('ville:zombie_geant', { copieDe: 'zombie', echelle, attributs: { vie, vitesse, degats, armure }, texture, sur: {...} })
// Un bloc de mod recoit de NOUVEAUX numeros d'etat (apres ceux du jeu), les memes proprietes que `copieDe` (schema, tables, classes,
// tags, feu), et se comporte comme lui pour tout ce qui passe par le registre (familles du moteur), plus ses propres gestionnaires.
// Ces definitions sont lues par une PREMIERE lecture des mods (moteur/mods.js : collecterDefinitions), avant la simulation : les
// tables du jeu de la scene en dependent. Les numeros sont deterministes (ordre des fichiers puis des appels).
import { Donnees } from './donnees.js';
import { ErreurMonde } from './erreurs.js';
import { voulaisTu } from './util.js';

export const ID_PERSO = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const FICHIER = /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.(png|json)$/;
export const MAX_BLOCS_PERSO = 64, MAX_ENTITES_PERSO = 64;

const nombre = (v, min, max, ch) => { if (v === undefined) return undefined; if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ErreurMonde(`${ch} : nombre de ${min} a ${max} attendu`); return v; };
const fichier = (v, ext, ch) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !FICHIER.test(v) || v.includes('..') || !v.endsWith('.' + ext)) throw new ErreurMonde(`${ch} : chemin relatif d'un fichier .${ext} de la scene attendu (lettres, chiffres, _ . - /, sans ..)`);
  return v;
};
const verifierId = (id, quoi) => {
  if (typeof id !== 'string' || !ID_PERSO.test(id) || id.startsWith('minecraft:')) throw new ErreurMonde(`mc.${quoi}('${id}') : identifiant "espace:nom" attendu, hors de l'espace minecraft (ex. "ville:tnt_bleue")`);
};

// Definition de bloc normalisee (donnees seulement : les gestionnaires `sur` sont enregistres a part, dans le mod)
export function verifierDefBloc(id, def, donnees) {
  verifierId(id, 'definirBloc');
  const ch = `mc.definirBloc('${id}')`;
  if (!def || typeof def !== 'object') throw new ErreurMonde(`${ch} : un objet { copieDe, ... } est attendu`);
  const inconnus = Object.keys(def).filter((k) => !['copieDe', 'aspect', 'teinte', 'modele', 'textures', 'lumiere', 'durete', 'resistance', 'friction'].includes(k));
  if (inconnus.length) throw new ErreurMonde(`${ch} : champ inconnu "${inconnus[0]}"${voulaisTu(inconnus[0], ['copieDe', 'aspect', 'teinte', 'modele', 'textures', 'lumiere', 'durete', 'resistance', 'friction', 'sur'])}`);
  const base = String(def.copieDe ?? '').replace(/^minecraft:/, '');
  if (donnees.idBloc(base) < 0 || base.includes(':')) throw new ErreurMonde(`${ch}.copieDe : bloc du jeu attendu, pas "${def.copieDe}"${voulaisTu(base, donnees.noms.filter((n) => !n.includes(':')))}`);
  let aspect = null;
  if (def.aspect !== undefined && def.aspect !== null) {
    if (typeof def.aspect !== 'string' || donnees.etatId(def.aspect.replace(/^(minecraft:)?/, 'minecraft:')) < 0 || def.aspect.replace(/^minecraft:/, '').split('[')[0].includes(':')) throw new ErreurMonde(`${ch}.aspect : etat d'un bloc du jeu attendu (ex. "blue_wool"), pas ${JSON.stringify(def.aspect)}`);
    aspect = def.aspect.replace(/^minecraft:/, '');
  }
  let teinte = null;
  if (def.teinte !== undefined && def.teinte !== null) {
    if (!Array.isArray(def.teinte) || def.teinte.length !== 3 || def.teinte.some((v) => typeof v !== 'number' || !(v >= 0 && v <= 1))) throw new ErreurMonde(`${ch}.teinte : [r, g, b] de 0 a 1 attendu`);
    teinte = def.teinte.slice();
  }
  const modele = fichier(def.modele, 'json', `${ch}.modele`);
  let textures = null;
  if (def.textures !== undefined && def.textures !== null) {
    if (typeof def.textures !== 'object' || Array.isArray(def.textures)) throw new ErreurMonde(`${ch}.textures : { cle: "fichier.png" } attendu`);
    textures = {};
    for (const [k, v] of Object.entries(def.textures)) { if (!/^[a-z0-9_]+$/.test(k)) throw new ErreurMonde(`${ch}.textures : cle "${k}" (lettres minuscules, chiffres, _)`); textures[k] = fichier(v, 'png', `${ch}.textures.${k}`); }
    if (Object.keys(textures).length > 16) throw new ErreurMonde(`${ch}.textures : 16 textures au plus`);
  }
  return {
    id, copieDe: base, aspect, teinte, modele, textures,
    lumiere: nombre(def.lumiere, 0, 15, `${ch}.lumiere`), durete: nombre(def.durete, -1, 1000, `${ch}.durete`),
    resistance: nombre(def.resistance, 0, 3600000, `${ch}.resistance`), friction: nombre(def.friction, 0, 1.2, `${ch}.friction`),
  };
}

// Definition d'entite normalisee. `types` : liste des types de creatures connus (null : pas de controle ici)
export function verifierDefEntite(id, def, types = null) {
  verifierId(id, 'definirEntite');
  const ch = `mc.definirEntite('${id}')`;
  if (!def || typeof def !== 'object') throw new ErreurMonde(`${ch} : un objet { copieDe, ... } est attendu`);
  const inconnus = Object.keys(def).filter((k) => !['copieDe', 'echelle', 'attributs', 'texture'].includes(k));
  if (inconnus.length) throw new ErreurMonde(`${ch} : champ inconnu "${inconnus[0]}"${voulaisTu(inconnus[0], ['copieDe', 'echelle', 'attributs', 'texture', 'sur'])}`);
  const base = String(def.copieDe ?? '').replace(/^minecraft:/, '');
  if (!/^[a-z_]+$/.test(base) || (types && !types.includes(base))) throw new ErreurMonde(`${ch}.copieDe : type de creature du jeu attendu, pas "${def.copieDe}"${types ? voulaisTu(base, types) : ''}`);
  const attributs = {};
  if (def.attributs !== undefined) {
    if (!def.attributs || typeof def.attributs !== 'object') throw new ErreurMonde(`${ch}.attributs : { vie, vitesse, degats, armure } attendu`);
    for (const [k, v] of Object.entries(def.attributs)) {
      const borne = { vie: [1, 1024], vitesse: [0, 4], degats: [0, 2048], armure: [0, 30] }[k];
      if (!borne) throw new ErreurMonde(`${ch}.attributs : "${k}" inconnu${voulaisTu(k, ['vie', 'vitesse', 'degats', 'armure'])}`);
      attributs[k] = nombre(v, borne[0], borne[1], `${ch}.attributs.${k}`);
    }
  }
  return { id, copieDe: base, echelle: nombre(def.echelle, 0.0625, 16, `${ch}.echelle`) ?? 1, attributs, texture: fichier(def.texture, 'png', `${ch}.texture`) };
}

// Tables du jeu + blocs des mods : un NOUVEL objet Donnees (les tables d'origine, partagees entre scenes, ne changent pas).
export function donneesAvecPerso(d, blocs) {
  if (!blocs || !blocs.length) return d;
  if (blocs.length > MAX_BLOCS_PERSO) throw new ErreurMonde(`mc.definirBloc : ${MAX_BLOCS_PERSO} blocs au plus par scene`);
  const j = d.j, c = Object.fromEntries(j.champsLigne.map((n, i) => [n, i]));
  const idx0 = new Uint16Array(Buffer.from(j.etatLigne, 'base64').buffer.slice(0));
  let ajout = 0;
  for (const b of blocs) { const s = d.idBloc(b.copieDe); ajout += d.debut[s + 1] - d.debut[s]; }
  const idx = new Uint16Array(j.nbEtats + ajout); idx.set(idx0.subarray(0, j.nbEtats));
  const lignes = j.lignes.slice();
  const copie = (v) => (Array.isArray(v) ? v.slice() : { ...v });
  const j2 = { ...j, noms: j.noms.slice(), schemaBloc: j.schemaBloc.slice(), defauts: j.defauts.slice(), chaineBloc: j.chaineBloc.slice(), lignes, champs: copie(j.champs ?? {}),
    etiquettes: Object.fromEntries(Object.entries(j.etiquettes).map(([k, v]) => [k, v.slice()])), feu: { ...j.feu, allume: copie(j.feu.allume), brule: copie(j.feu.brule) }, nbEtats: j.nbEtats + ajout };
  let e = j.nbEtats;
  const copies = new Map();
  for (const def of blocs) {
    if (j2.noms.includes(def.id)) throw new ErreurMonde(`mc.definirBloc('${def.id}') : deja defini`);
    const s = d.idBloc(def.copieDe), nb = j2.noms.length;
    j2.noms.push(def.id); j2.schemaBloc.push(j.schemaBloc[s]); j2.defauts.push(j.defauts[s]); j2.chaineBloc.push(j.chaineBloc[s]);
    if (j.champs?.[s] !== undefined) j2.champs[nb] = j.champs[s];
    for (const l of Object.values(j2.etiquettes)) if (l.includes(s)) l.push(nb);
    if (j.feu.allume[s] !== undefined) j2.feu.allume[nb] = j.feu.allume[s];
    if (j.feu.brule[s] !== undefined) j2.feu.brule[nb] = j.feu.brule[s];
    const surcharge = [['emission', def.lumiere], ['durete', def.durete], ['resistance', def.resistance], ['friction', def.friction]].filter(([, v]) => v !== undefined);
    const memo = new Map();
    for (let k = d.debut[s]; k < d.debut[s + 1]; k++) {
      let li = idx0[k];
      if (surcharge.length) {
        if (!memo.has(li)) { const l = lignes[li].slice(); for (const [n, v] of surcharge) l[c[n]] = v; memo.set(li, lignes.length); lignes.push(l); }
        li = memo.get(li);
      }
      if (li > 65535) throw new ErreurMonde('mc.definirBloc : trop de lignes de donnees');
      idx[e++] = li;
    }
    if (!copies.has(s)) copies.set(s, []);
    copies.get(s).push(nb);
  }
  j2.etatLigne = Buffer.from(idx.buffer).toString('base64');
  const d2 = new Donnees(j2);
  d2.copies = copies;
  d2.alias = new Map(blocs.map((b, i) => [j.noms.length + i, b.copieDe]));
  d2.perso = { blocs: blocs.map((b) => ({ ...b })) };
  return d2;
}

// Acteurs (descripteurs de moteur/index.js) qui portent `perso` (champ `mod` de la scene) : echelle de la boite, attributs.
export function appliquerEntitesPerso(descs, entites) {
  if (!descs.some((a) => a.perso)) return descs;
  const parId = new Map((entites || []).map((e) => [e.id, e]));
  return descs.map((a) => {
    if (!a.perso) return a;
    const def = parId.get(a.perso);
    if (!def) throw new ErreurMonde(`acteur ${a.nom} : "mod": "${a.perso}" n'est defini par aucun mod de la scene (mc.definirEntite)${voulaisTu(a.perso, [...parId.keys()])}`);
    if (def.copieDe !== (a.typeCreature ?? 'joueur')) throw new ErreurMonde(`acteur ${a.nom} : "${a.perso}" copie "${def.copieDe}", mais l'acteur est de type "${a.typeCreature ?? 'joueur'}"`);
    const o = { ...a, persoDef: def };
    const k = def.echelle;
    if (k !== 1 && a.gabarit) o.gabarit = { ...a.gabarit, l: a.gabarit.l * k, h: a.gabarit.h * k, oeil: a.gabarit.oeil * k };
    if (def.attributs.vie !== undefined) o.vie = def.attributs.vie;
    const v = def.attributs.vitesse;   // movement_speed : l'acceleration de marche suit son carre (film/actes.js gabaritCreature), l'IA lit l'attribut
    if (v !== undefined) {
      const v0 = a.ia?.vitesseAttr ?? a.gabarit?.mv ?? 0.1;
      if (o.gabarit) o.gabarit = { ...o.gabarit, vitesse: o.gabarit.vitesse * (v / v0) ** 2, mv: v };
      if (a.ia) o.ia = { ...a.ia, vitesseAttr: v };
    }
    if (def.attributs.vie !== undefined && a.ia) o.ia = { ...(o.ia ?? a.ia), vie: def.attributs.vie };
    return o;
  });
}
