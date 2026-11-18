// Le sujet d'un plan est-il visible ? Pour chaque image d'un plan, la ligne de vue de la camera vers la tete et vers la poitrine du sujet
// (l'acteur cadre par `cadre`, suivi par `suit`, regarde par `regarde`) ; le sujet est CACHE si les deux lignes traversent un bloc plein.
// Sert a : (1) corriger la camera comme la camera de suivi le fait (hausse, tour autour du sujet, rapprochement : camera.js), (2) dire UNE note claire
// avec le plan, les secondes et le bloc quand la correction ne suffit pas. Sans terrain (tests, apercu sans zone) : rien n'est cache.
const RAD = Math.PI / 180;
export const SEUIL_CACHE = 0.25;   // part du plan (images) pendant laquelle le sujet est cache avant d'agir ou d'avertir

const nomCourt = (etat) => String(etat).replace(/^minecraft:/, '').replace(/\[.*$/, '');

// Premier bloc plein sur le segment a -> b (on s'arrete `fin` blocs avant b) : { x, y, z } ou null.
function premierBloc(solide, a, b, fin = 0.3, pas = 0.2) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], D = Math.hypot(dx, dy, dz), L = D - fin;
  for (let s = 0; s <= L; s += pas) { const q = s / D, x = a[0] + dx * q, y = a[1] + dy * q, z = a[2] + dz * q; if (solide(x, y, z)) return [x, y, z]; }
  return null;
}

// Les acteurs que le plan montre : { noms, explicite } ; explicite = le scenariste les a designes (cadre, suit, regarde).
export function sujetsDuPlan(c0) {
  const cad = c0.cadre;
  if (c0.mode === 'cadre' && cad) return { noms: cad.epaule ? [cad.epaule[1], cad.epaule[0]] : cad.deux ? cad.deux : [cad.sur], explicite: true };
  if (c0.mode === 'suit' && c0.suit) return { noms: [c0.suit], explicite: true };
  if (c0.regarde) return { noms: [c0.regarde], explicite: true };
  return { noms: [], explicite: false };
}

// Dans le champ de la camera ? cam : { x, y, z, lacet, tangage, fov } d'une image ; p : point du monde.
function dansChamp(cam, aspect, p) {
  const yaw = cam.lacet * RAD, pit = cam.tangage * RAD, cp = Math.cos(pit);
  const f = [-Math.sin(yaw) * cp, -Math.sin(pit), Math.cos(yaw) * cp];
  let r = [-f[2], 0, f[0]]; const n = Math.hypot(r[0], r[2]) || 1; r = [r[0] / n, 0, r[2] / n];
  const u = [-r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1]];
  const d = [p[0] - cam.x, p[1] - cam.y, p[2] - cam.z], w = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  if (w < 0.3) return false;
  const ty = Math.tan((cam.fov * RAD) / 2);
  return Math.abs((d[0] * r[0] + d[2] * r[2]) / w) < ty * aspect && Math.abs((d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / w) < ty;
}

// Mesure sur les images i0..i1 d'un plan.
//   pos[i] : position de la camera ; yeux(i, nom) : point des yeux de l'acteur ; solide(x,y,z) ; bloc(x,y,z) : etat du bloc (pour le nom, facultatif).
//   noms : acteurs a controler. Sans nom (`ecran` : { cam(i), aspect, tous }) : les acteurs qui sont dans le champ ; cache = tous ceux du champ le sont.
// Retourne [{ nom, part (0..1 des images du plan), bloc (nom du bloc qui cache le plus souvent) }], le plus cache d'abord.
export function masquageSujets({ pos, yeux, i0, i1, noms, solide, bloc = null, ecran = null, instant = null }) {   // instant(i) : le monde de l'image i
  const n = i1 - i0;
  if (n <= 0 || !solide) return [];
  const test = (i, nom) => {
    const p = pos[i], tete = yeux(i, nom), poitrine = [tete[0], tete[1] - 0.9, tete[2]];
    const a = premierBloc(solide, p, tete);
    if (!a) return null;
    return premierBloc(solide, p, poitrine) ? a : null;   // cache seulement si la tete ET la poitrine le sont
  };
  const nomDe = (pt) => { if (!pt || !bloc) return 'bloc plein'; const e = bloc(Math.floor(pt[0]), Math.floor(pt[1]), Math.floor(pt[2])); return e ? nomCourt(e) : 'bloc plein'; };
  const sorties = [];
  const listes = ecran ? [{ nom: null, tous: ecran.tous }] : noms.map((nom) => ({ nom, tous: [nom] }));
  for (const { nom, tous } of listes) {
    let caches = 0, vus = 0; const blocs = new Map();
    for (let i = i0; i < i1; i++) {
      if (instant) instant(i);
      let controles = tous;
      if (ecran) controles = tous.filter((x) => dansChamp(ecran.cam(i), ecran.aspect, yeux(i, x)));
      if (!controles.length) continue;
      vus++;
      const r = controles.map((x) => test(i, x));
      if (r.every((x) => x)) { caches++; const b = nomDe(r[0]); blocs.set(b, (blocs.get(b) ?? 0) + 1); }
    }
    const b = [...blocs].sort((p, q) => q[1] - p[1])[0];
    sorties.push({ nom: nom ?? (ecran.tous.length === 1 ? ecran.tous[0] : 'les acteurs a l\'image'), part: caches / n, vus: vus / n, bloc: b ? b[0] : null });
  }
  return sorties.sort((p, q) => q.part - p.part);
}

const f1 = (t) => (Math.round(t * 10) / 10).toFixed(1).replace('.', ',');
// "camera : plan 9 (13,4-15,2 s) : steve cache par oak_log 80 % du plan malgre les corrections ; ..."
export function noteSujetCache({ plan, de, a, nom, part, bloc, corrigee }) {
  const quoi = plan ? `plan ${plan} (${f1(de)}-${f1(a)} s)` : `de ${f1(de)} a ${f1(a)} s`;
  return `camera : ${quoi} : ${nom} cache par ${bloc ?? 'un bloc'} ${Math.round(part * 100)} % du plan${corrigee ? ' malgre les corrections (hausse, tour, rapprochement)' : ''} ; ecarte la camera (cadre.de, cadre.haut, cadre.lateral, plan plus large) ou choisis un autre cote du decor`;
}
