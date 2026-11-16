// Amplitudes plausibles des articulations et note courte pour `mcanim empreinte` / `mcanim trajet`.
// Les valeurs dans l'intervalle ne disent rien ; hors intervalle elles sont PERMISES (exageration voulue d'un dessin anime) mais signalees
// en UNE ligne, pour que l'auteur choisisse : voulu, ou erreur. Un plafond dur n'existe que pour les valeurs absurdes (+-360 degres).
// L'acteur `souple: true` n'a aucune note. Les mains qui entrent dans la tete ou le tronc sont signalees dans la meme ligne (information seule).
import { mainsDansCorps } from '../perso/modele.js';
import { eulerZXY, RAD } from './ik.js';

export const PLAFOND = 360;   // degres : au-dela, la scene est refusee

// [min, max] en degres. avant > 0 = vers l'avant ; cote > 0 = s'ecarte, < 0 = se croise ; torsion > 0 = rotation interne.
export const LIMITES = {
  bras: { avant: [-70, 180], cote: [-60, 180], torsion: [-90, 90] },
  jambe: { avant: [-85, 130], cote: [-30, 50], torsion: [-45, 45] },
  coude: { flexion: [0, 150] }, genou: { flexion: [0, 150] },
  tete: { lacet: [-85, 85], tangage: [-70, 60], roulis: [-40, 40] },
  corps: { penche: [-30, 90], cote: [-30, 30], torsion: [-45, 45] },
};

// Excedent (degres, > 0 hors intervalle) d'une valeur.
const exces = (v, [lo, hi]) => (v > hi ? v - hi : v < lo ? lo - v : 0);

// Penalite (radians au carre) d'une rotation locale d'epaule ou de hanche : sert a la cinematique inverse pour ne pas sortir des amplitudes.
export function penaliteMembre(genre, lat) {
  const L = LIMITES[genre];
  return (Rloc) => {
    const [rz, rx, ry] = eulerZXY(Rloc);
    const e = [exces(-rx / RAD, L.avant), exces(lat * rz / RAD, L.cote), exces(-lat * ry / RAD, L.torsion)];
    return e.reduce((s, x) => s + (x * RAD) ** 2, 0);
  };
}

// Valeurs de la pose a comparer : [acteur.joint.axe, valeur, intervalle]
function mesures(pose) {
  const m = [];
  for (const nom of ['brasD', 'brasG', 'jambeD', 'jambeG']) {
    const L = LIMITES[nom.startsWith('bras') ? 'bras' : 'jambe'], v = pose[nom] ?? [];
    for (const [i, axe] of ['avant', 'cote', 'torsion'].entries()) m.push([`${nom}.${axe}`, v[i] ?? 0, L[axe]]);
  }
  const t = pose.tete ?? [];
  m.push(['tete.lacet', t[0] ?? 0, LIMITES.tete.lacet], ['tete.tangage', t[1] ?? 0, LIMITES.tete.tangage], ['tete.roulis', t[2] ?? 0, LIMITES.tete.roulis]);
  m.push(['corps.penche', pose.penche ?? 0, LIMITES.corps.penche], ['corps.cote', pose.troncCote ?? 0, LIMITES.corps.cote], ['corps.torsion', pose.troncTorsion ?? 0, LIMITES.corps.torsion]);
  return m;
}

const f1 = (x) => (Math.round(x * 10) / 10).toString();
const MAX_CITES = 4;

// Note sur les amplitudes d'une scene (texte sur une ligne) ou null. `res` : le resultat de animer(scene) (les poses de chaque image).
export function noteAmplitudes(scene, res) {
  const trouves = new Map();   // cle -> { t0, t1, pic, limite, texte, nb }
  scene.acteurs.forEach((a, k) => {
    if (a.souple) return;
    const dans = new Map();    // penetrations en cours : cle -> { t0, t1, nb }
    for (const im of res.images) {
      const pose = im.acteurs[k];
      for (const [joint, v, iv] of mesures(pose)) {
        const e = exces(v, iv);
        if (e < 1) continue;
        const cle = `${a.nom} ${joint}`, bord = v > iv[1] ? iv[1] : iv[0];
        const o = trouves.get(cle);
        if (!o) trouves.set(cle, { t0: im.t, t1: im.t, pic: v, bord, sens: v > iv[1] ? '>' : '<', nb: 1 });
        else { o.t1 = im.t; o.nb++; if (Math.abs(v - bord) > Math.abs(o.pic - bord)) o.pic = v; }
      }
      for (const { membre, dans: corps } of mainsDansCorps(pose, a.modele === 'slim')) {
        const cle = `${a.nom} ${membre} dans ${corps}`, o = dans.get(cle);
        if (!o) dans.set(cle, { t0: im.t, t1: im.t, nb: 1, derniere: im.t }); else { o.t1 = im.t; o.nb++; }
      }
    }
    for (const [cle, o] of dans) if (o.nb >= 3) trouves.set(cle, { t0: o.t0, t1: o.t1, penetre: true });
  });
  if (!trouves.size) return null;
  const liste = [...trouves.entries()].sort((p, q) => p[1].t0 - q[1].t0).map(([cle, o]) => {
    const quand = o.t1 - o.t0 > 0.05 ? `t=${f1(o.t0)}-${f1(o.t1)}` : `t=${f1(o.t0)}`;
    return o.penetre ? `${cle} (${quand})` : `${cle} ${f1(o.pic)}${o.sens}${o.bord} (${quand})`;
  });
  const montre = liste.slice(0, MAX_CITES).join(' ; ') + (liste.length > MAX_CITES ? ` ; +${liste.length - MAX_CITES} autre(s)` : '');
  return `amplitudes hors plausible (permis) : ${montre} -> voulu (exageration) ou erreur ? "souple": true sur l'acteur coupe cette note`;
}
