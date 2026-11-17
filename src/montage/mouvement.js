// Mouvement des textes et incrustations : UN petit systeme pour tout. Chaque element a une ENTREE, une EMPHASE (boucle ou une fois) et une SORTIE ;
// chacune = un type + une duree + une courbe (easing) + un delai. Rien n'apparait ni ne disparait d'un coup, sauf si la scene le demande ("anim": "aucune").
// Fonctions pures : le temps entre, un etat de transformation sort ; le dessin (incrust/elements.js) applique l'etat a l'image de l'element.

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------------------------------------------------------------- courbes (u de 0 a 1 -> progression, 1 a la fin)
const C1 = 2.17;   // depassement de la courbe "retour" : pointe a 1,15 (4 c1^3 / (27 (c1+1)^2) = 0,15)
export const COURBES = {
  lineaire: (u) => u,
  cubique: (u) => 1 - Math.pow(1 - u, 3),
  retour: (u) => 1 + (C1 + 1) * Math.pow(u - 1, 3) + C1 * Math.pow(u - 1, 2),   // depasse puis revient (out-back)
  elastique: (u) => (u <= 0 ? 0 : u >= 1 ? 1 : Math.pow(2, -10 * u) * Math.sin(((u * 10 - 0.75) * 2 * Math.PI) / 3) + 1),   // out-elastic
  sinus: (u) => -(Math.cos(Math.PI * u) - 1) / 2,   // in-out-sine
  ressort: (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - Math.exp(-6 * u) * Math.cos(2 * Math.PI * 1.6 * u)),   // ressort amorti : 1,2 puis se pose
  rebond: (u) => { const n = 7.5625, d = 2.75; if (u < 1 / d) return n * u * u; if (u < 2 / d) { u -= 1.5 / d; return n * u * u + 0.75; } if (u < 2.5 / d) { u -= 2.25 / d; return n * u * u + 0.9375; } u -= 2.625 / d; return n * u * u + 0.984375; },   // out-bounce (chute)
};
export const NOMS_COURBES = ['lineaire', 'cubique', 'retour', 'elastique', 'sinus', 'ressort'];
export const courbe = (nom, u) => (COURBES[nom] ?? COURBES.cubique)(clamp01(u));

// ---------------------------------------------------------------- types
export const ENTREES = ['pop', 'rebond', 'glisse', 'fondu', 'zoom', 'machine', 'vague', 'tombe', 'dessin', 'compte', 'aucune'];
export const SORTIES = ENTREES;
export const EMPHASES = ['pulse', 'secousse', 'clignote', 'rebond', 'flotte', 'croit', 'aucune'];   // croit : grossit doucement pendant toute la vie (les legendes des references)
export const ALIAS_TYPE = { trace: 'dessin' };   // ancien nom

// Duree (en s) et courbe par defaut de chaque type d'entree (30 images par seconde : 0,133 s = 4 images).
export const DUREE_DEFAUT = { pop: 0.2, rebond: 0.4, glisse: 0.22, fondu: 0.2, zoom: 0.22, machine: 0.5, vague: 0.4, tombe: 0.5, dessin: 0.3, compte: 0.25, aucune: 0 };
export const COURBE_DEFAUT = { pop: 'retour', rebond: 'ressort', glisse: 'cubique', fondu: 'lineaire', zoom: 'cubique', machine: 'lineaire', vague: 'retour', tombe: 'rebond', dessin: 'cubique', compte: 'retour', aucune: 'lineaire' };

// Etat neutre : { a (opacite), kx, ky (echelle), dx, dy (en parts du petit cote U), rot (radians), flou (part de U), blanc (0..1 : melange vers le blanc),
//   n (machine : part des lettres visibles, null sinon), mots (vague : progression 0..1 de chaque mot, tableau, sinon null), dessin (part tracee 0..1) }
export const neutre = () => ({ a: 1, kx: 1, ky: 1, dx: 0, dy: 0, rot: 0, flou: 0, blanc: 0, n: null, vague: null, dessin: 1 });

// Etat d'une ENTREE a la progression brute u (0..1 ; au dela de 1 : fini). `dir` : 'gauche' | 'droite' | 'haut' | 'bas'. `p` : parametres { depart, courbe }.
export function etatEntree(type, u, { courbeNom, depuis = 'gauche', depart = null } = {}) {
  const s = neutre();
  if (u >= 1) return s;
  const nom = courbeNom ?? COURBE_DEFAUT[type] ?? 'cubique';
  const e = courbe(nom, u), eC = courbe('cubique', u);
  switch (type) {
    case 'pop': { const d = depart ?? 0.2; const k = d + (1 - d) * e; s.kx = s.ky = Math.max(0.01, k); s.a = d >= 0.7 ? 1 : clamp01(0.4 + u * 5); break; }   // un pop qui part de 70 % ou plus (legendes de reference) est opaque d'emblee
    case 'rebond': { const ky = 0.35 + 0.65 * e; s.ky = Math.max(0.01, ky); s.kx = 1 + (1 - ky) * 0.55; s.dy = (1 - e) * 0.03; s.a = clamp01(0.4 + u * 5); break; }
    case 'zoom': { const k = 1 + (depart ?? 0.8) * (1 - e); s.kx = s.ky = k; s.a = clamp01(0.4 + u * 3); break; }
    case 'fondu': s.a = e; break;
    case 'glisse': {
      const d = (1 - eC) * 0.5;   // part du petit cote
      if (depuis === 'gauche') s.dx = -d; else if (depuis === 'droite') s.dx = d; else if (depuis === 'haut') s.dy = -d; else s.dy = d;
      s.a = clamp01(u * 4); s.flou = (1 - eC) * 0.05; break;
    }
    case 'tombe': { const k = courbe('rebond', u); s.dy = -(1 - k) * 0.16; s.a = clamp01(0.5 + u * 6); s.ky = 1 - (1 - clamp01(u * 1.8)) * 0.0; break; }
    case 'dessin': s.dessin = e; s.a = clamp01(u * 8); break;
    case 'compte': { const d = depart ?? 0.3; const k = d + (1 - d) * e; s.kx = s.ky = Math.max(0.01, k); s.a = clamp01(0.4 + u * 5); break; }
    case 'machine': s.n = clamp01(e); break;
    case 'vague': s.vague = u; s.a = 1; break;   // la progression de chaque mot est calculee au dessin (nombre de mots connu la-bas)
    default: break;
  }
  return s;
}

// Progression (0..1) du mot k sur n pendant une entree "vague" a la progression globale u : chaque mot demarre un peu apres le precedent.
export function progressionMot(u, k, n, courbeNom = 'retour') {
  const dur = 0.45, pas = n > 1 ? (1 - dur) / (n - 1) : 0;
  return courbe(courbeNom, (u - k * pas) / dur);
}

// Etat d'une SORTIE : v va de 1 (debut de la sortie) a 0 (disparu). L'image de l'entree jouee a l'envers, sauf les types dont l'envers n'a pas de sens.
export function etatSortie(type, v, opts = {}) {
  const t = type === 'tombe' || type === 'machine' || type === 'vague' ? 'fondu' : type === 'compte' ? 'pop' : type;
  const u = 1 - clamp01(v);   // 0 au debut de la sortie, 1 quand c'est fini
  if (t === 'dessin') { const s = neutre(); s.dessin = clamp01(v); s.a = clamp01(v * 4); return s; }
  const e = etatEntree(t, clamp01(v), { ...opts, courbeNom: !opts.courbeNom || ['retour', 'ressort', 'elastique'].includes(opts.courbeNom) ? 'cubique' : opts.courbeNom });
  void u;
  if (t === 'glisse') { e.dx = -e.dx * 0.4; e.dy = -e.dy * 0.4; }   // sort du meme cote, plus doucement
  return e;
}

// Etat d'une EMPHASE. ts : secondes depuis le debut de l'emphase. e : { type, duree, periode, intensite, unique }.
export function etatEmphase(e, ts) {
  const s = neutre();
  if (!e || e.type === 'aucune' || ts < 0) return s;
  const I = e.intensite ?? 1;
  if (e.unique && ts > e.duree) return s;
  const u = e.unique ? clamp01(ts / e.duree) : (ts % e.periode) / e.periode;
  switch (e.type) {
    case 'pulse': { const k = 1 + 0.08 * I * Math.sin(Math.PI * u); s.kx = s.ky = k; break; }
    case 'secousse': { const f = 5.5, amort = e.unique ? 1 - u : 1; s.dx = 0.012 * I * amort * Math.sin(2 * Math.PI * f * u * (e.unique ? 1 : 1)); s.rot = 0.05 * I * amort * Math.sin(2 * Math.PI * (f + 1.5) * u); break; }
    case 'clignote': s.a = u < 0.5 ? 1 : 0.25; break;
    case 'rebond': { const h = Math.abs(Math.sin(Math.PI * u * (e.unique ? 2 : 1))) * (e.unique ? 1 - u * 0.5 : 1); s.dy = -0.02 * I * h; break; }
    case 'croit': { const k = 1 + 0.07 * I * courbe('cubique', e.unique ? u : clamp01(ts / e.duree)); s.kx = s.ky = k; break; }
    case 'flotte': s.dy = 0.006 * I * Math.sin(2 * Math.PI * u); break;
    default: break;
  }
  return s;
}

// Compose deux etats (l'emphase par-dessus l'entree ou la sortie).
export function composer2(a, b) {
  return { a: a.a * b.a, kx: a.kx * b.kx, ky: a.ky * b.ky, dx: a.dx + b.dx, dy: a.dy + b.dy, rot: a.rot + b.rot, flou: Math.max(a.flou, b.flou), blanc: Math.max(a.blanc, b.blanc), n: a.n ?? b.n, vague: a.vague ?? b.vague, dessin: Math.min(a.dessin, b.dessin) };
}
