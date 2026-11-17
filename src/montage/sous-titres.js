// Sous-titres mot a mot : les mots (avec leur instant) sont regroupes en puces de 1 a 3 mots. Une puce apparait au temps de son premier mot
// et reste jusqu'a la puce suivante (sans trou), sans depasser 1,2 s apres son dernier mot (une pause de la voix efface la legende).
// Une puce se coupe aussi apres une ponctuation de fin de phrase (. ! ?), ou apres une virgule si elle a deja 2 mots, ou apres un mot marque `coupe`.
export const PAUSE_MAX = 1.2;

// mots : [{ t, mot }] classes par temps. Retourne [{ debut, fin, texte, accent: [numeros de mots de la puce, 0 = premier] }].
// `accent` : numeros de mots GLOBAUX (0 = premier mot de la liste) a mettre en couleur d'accent.
export function decouperSousTitres(mots, { par = 2, fin = null, accent = null } = {}) {
  const puces = [];
  let cur = null;
  mots.forEach((m, k) => {
    if (!cur || cur.mots.length >= par) { cur = { mots: [], premier: k }; puces.push(cur); }
    cur.mots.push(m);
    const finPhrase = /[.!?…]["')»]*$/.test(m.mot), virgule = /[,;:]["')»]*$/.test(m.mot);
    if (m.coupe || finPhrase || (virgule && cur.mots.length >= 2)) cur = null;
  });
  const A = accent ? new Set(accent) : null;
  return puces.map((p, i) => {
    const debut = p.mots[0].t;
    const dernier = p.mots[p.mots.length - 1].t;
    const suivante = i + 1 < puces.length ? puces[i + 1].mots[0].t : (fin ?? dernier + PAUSE_MAX);
    const f = Math.min(suivante, dernier + PAUSE_MAX, fin ?? Infinity);
    return { debut, fin: Math.max(f, debut + 0.1), texte: p.mots.map((m) => m.mot).join(' '), accent: A ? p.mots.map((_, j) => p.premier + j).filter((g) => A.has(g)).map((g) => g - p.premier) : [] };
  });
}
