// Petits outils communs du moteur.

// Distance d'edition (Levenshtein) pour les messages "voulais-tu ...".
function distance(a, b) {
  const m = a.length, n = b.length;
  let prec = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prec[j] + 1, cur[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prec = cur;
  }
  return prec[n];
}

// Le mot de la liste le plus proche de `mot` (ou null s'il n'y en a pas d'assez proche).
export function plusProche(mot, liste) {
  let meilleur = null, d0 = Infinity;
  const m = String(mot).toLowerCase();
  for (const x of liste) {
    const d = distance(m, String(x).toLowerCase());
    if (d < d0) { d0 = d; meilleur = x; }
  }
  return meilleur !== null && d0 <= Math.max(2, Math.floor(m.length / 3)) ? meilleur : null;
}
export const voulaisTu = (mot, liste) => { const p = plusProche(mot, liste); return p ? ` ; voulais-tu "${p}" ?` : ''; };

// Nom de face lisible
export const NOMS_FACES = ['bas', 'haut', 'nord', 'sud', 'ouest', 'est'];
