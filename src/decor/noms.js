// Noms de blocs : normalisation, distance d'edition, "voulais-tu".
// Regle (docs/FORMAT-DECOR.md, B3.4) : un nom inconnu est une ERREUR avec trois propositions au plus ; on ne devine jamais en silence.

// 'minecraft:Oak_Planks' -> 'oak_planks' (prefixe retire, meme doublon 'minecraft:minecraft:')
export function normaliserNom(s) {
  let n = String(s).trim().toLowerCase().replace(/ /g, '_');
  while (n.startsWith('minecraft:')) n = n.slice(10);
  return n;
}

// distance de Levenshtein, avec un plafond (au-dela on rend plafond + 1 : inutile de calculer plus)
export function distance(a, b, plafond = 6) {
  if (Math.abs(a.length - b.length) > plafond) return plafond + 1;
  let prec = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let min = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prec[j] + 1, cur[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < min) min = v;
    }
    if (min > plafond) return plafond + 1;
    prec = cur;
  }
  return prec[b.length];
}

// Les `n` noms les plus proches de `nom` dans `liste` (un nom qui CONTIENT le mot passe avant un nom seulement proche)
export function proposer(nom, liste, n = 3) {
  const cand = [];
  for (const c of liste) {
    const dist = distance(nom, c, Math.max(3, Math.ceil(nom.length / 3)));
    const contient = c.includes(nom) || nom.includes(c);
    if (dist <= Math.max(3, Math.ceil(nom.length / 3)) || (contient && nom.length >= 3)) cand.push([contient ? Math.min(dist, 2) - 0.5 : dist, c]);
  }
  cand.sort((p, q) => p[0] - q[0] || p[1].length - q[1].length || (p[1] < q[1] ? -1 : 1));
  return cand.slice(0, n).map((c) => c[1]);
}

export function voulaisTu(nom, liste) {
  const p = proposer(nom, liste);
  return p.length ? ` -> ${p.join(' ? ')} ?` : '';
}
