// Sous-titres mot a mot : les mots (avec leur instant) sont regroupes en puces de 1 a 3 mots. Une puce apparait au temps de son premier mot
// et reste jusqu'a la puce suivante (sans trou), sans depasser 1,2 s apres son dernier mot (une pause de la voix efface la legende).
// Une puce se coupe aussi apres une ponctuation de fin de phrase (. ! ?), ou apres une virgule si elle a deja 2 mots, ou apres un mot marque `coupe`.
export const PAUSE_MAX = 1.2;
// Rythme par defaut d'un bloc {texte, debut, fin} : 1,5 puce par seconde, comme les videos de reference (mesure : 1,2 a 1,5 ; decision du 18/11).
export const RYTHME = 1.5;

// la puce se termine-t-elle apres ce mot, sachant qu'elle en a deja n (mot compris) ?
const coupeApres = (m, n) => m.coupe || /[.!?…]["')»]*$/.test(m.mot) || (/[,;:]["')»]*$/.test(m.mot) && n >= 2);

// petit mot de liaison (article, preposition, possessif...) : une puce ne finit pas dessus (« PIOCHE A » puis « TENU ») ; il part avec le mot suivant
const LIAISON = new Set('a à au aux de du des d le la les l un une et ou en ma mon mes ta ton tes sa son ses ce cet cette pour par sur dans avec sans the a an of to and in on my your'.split(' '));
const liaison = (m) => LIAISON.has(m.mot.toLowerCase().replace(/[^\p{L}]/gu, ''));

// Regroupe les mots en puces de `par` mots au plus (coupes de ponctuation et marques comprises). Retourne des listes de numeros de mots.
export function grouperMots(mots, par) {
  const g = [];
  let cur = null;
  mots.forEach((m, k) => {
    if (!cur || (cur.length >= par && !(par >= 2 && cur.length < 3 && liaison(mots[cur[cur.length - 1]])))) { cur = []; g.push(cur); }
    cur.push(k);
    if (coupeApres(m, cur.length)) cur = null;
  });
  return g;
}

// Regroupe en `cible` puces de 1 ou 2 mots environ : on part d'un mot par puce et on colle des paires, reparties sur tout le bloc,
// jamais par-dessus une fin de phrase. Si la ponctuation empeche assez de paires, il reste un peu plus de puces que la cible.
function grouperVers(mots, cible) {
  const W = mots.length, fusions = Math.max(0, W - cible), g = [];
  let faites = 0;
  for (let j = 0; j < W; j++) {
    const peut = j + 1 < W && !coupeApres(mots[j], 1) && !liaison(mots[j + 1]);   // une paire ne finit pas sur un mot de liaison
    if (peut && liaison(mots[j]) && faites < fusions) { g.push([j, j + 1]); j++; faites++; continue; }   // le mot de liaison part avec le suivant
    const enRetard = faites < fusions * (j + 2) / W || fusions - faites >= (W - j - 1) / 2;
    if (peut && faites < fusions && enRetard) { g.push([j, j + 1]); j++; faites++; } else g.push([j]);
  }
  return g;
}

// poids d'un mot pour le placer dans le temps : ses lettres, + une pause apres la ponctuation
const poids = (w) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 2 + (/[.!?]$/.test(w) ? 2 : /[,;:]$/.test(w) ? 1 : 0);

// Bloc {texte, debut, fin} sans temps par mot : choisit les puces et leurs instants pour tenir `rythme` puces par seconde.
// - `par` donne : puces de `par` mots au plus. Sinon : 2 mots ; si c'est trop lent, des puces de 1 ou 2 mots pour approcher le rythme ;
//   si c'est trop rapide et que le rythme a ete demande (`choisi`), des puces de 3 mots si c'est plus proche.
// - Puces plus lentes que le rythme (texte court) : elles passent au rythme demande et la derniere reste jusqu'a la fin du bloc (jamais de trou).
//   Sinon les mots sont repartis sur tout le bloc selon leurs lettres.
// ws : mots du texte. Retourne [{ t, mot, coupe }] (coupe = fin de puce), a donner a decouperSousTitres avec par 3.
export function rythmerTexte(ws, { debut, fin, rythme = RYTHME, par = null, choisi = false }) {
  const D = fin - debut, cible = Math.max(1, Math.round(D * rythme));
  const nus = ws.map((mot) => ({ mot }));
  let g;
  if (par) g = grouperMots(nus, par);
  else {
    g = grouperMots(nus, 2);
    if (g.length < cible) g = grouperVers(nus, cible);
    else if (choisi && g.length > cible) { const g3 = grouperMots(nus, 3); if (Math.abs(g3.length - cible) < Math.abs(g.length - cible)) g = g3; }
  }
  const duree = g.length / D >= rythme - 1e-9 ? D : g.length / rythme;   // texte court : au rythme, puis la derniere puce tient
  // duree d'une puce : moitie egale, moitie selon ses lettres (un « TU » reste lisible) ; dans la puce, chaque mot selon ses lettres
  const p = ws.map(poids), pg = g.map((x) => x.reduce((a, k) => a + p[k], 0));
  const moyen = pg.reduce((a, x) => a + x, 0) / g.length, total = pg.reduce((a, x) => a + x + moyen, 0);
  const mots = [];
  let t = debut;
  g.forEach((x, i) => {
    const dg = duree * (pg[i] + moyen) / total;
    let u = t;
    x.forEach((k, n) => { mots.push({ t: u, mot: ws[k], coupe: n === x.length - 1 }); u += dg * p[k] / pg[i]; });
    t += dg;
  });
  return mots;
}

// mots : [{ t, mot }] classes par temps. Retourne [{ debut, fin, texte, accent: [numeros de mots de la puce, 0 = premier] }].
// `accent` : numeros de mots GLOBAUX (0 = premier mot de la liste) a mettre en couleur d'accent.
// `pause` : temps maximal apres le dernier mot d'une puce (PAUSE_MAX pour la voix ; Infinity pour un bloc {texte, debut, fin} : pas de trou).
// rang dans le texte affiche du j-ieme mot d'une puce (un mot peut porter sa ponctuation isolee : « steve ! » compte pour deux)
const rang = (p, j) => p.mots.slice(0, j).reduce((n, m) => n + m.mot.split(' ').length, 0);
export function decouperSousTitres(mots, { par = 2, fin = null, accent = null, pause = PAUSE_MAX } = {}) {
  const puces = grouperMots(mots, par).map((ks) => ({ mots: ks.map((k) => mots[k]), premier: ks[0] }));
  const A = accent ? new Set(accent) : null;
  return puces.map((p, i) => {
    const debut = p.mots[0].t;
    const dernier = p.mots[p.mots.length - 1].t;
    const suivante = i + 1 < puces.length ? puces[i + 1].mots[0].t : (fin ?? dernier + PAUSE_MAX);
    const f = Math.min(suivante, dernier + pause, fin ?? Infinity);
    return { debut, fin: Math.max(f, debut + 0.1), texte: p.mots.map((m) => m.mot).join(' '), accent: A ? p.mots.map((_, j) => p.premier + j).filter((g) => A.has(g)).map((g) => rang(p, g - p.premier)) : [] };
  });
}
