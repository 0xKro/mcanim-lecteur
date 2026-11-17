// Textes en double : un titre d'ecran (incrustation `texte`, ou `compteur` avec sa valeur finale) et une legende (puce de sousTitres / textes)
// visibles EN MEME TEMPS qui disent le meme mot. Test combat v3 : la legende « IMPOSSIBLE ! » juste au-dessus du titre « IMPOSSIBLE ?! »,
// « TU TRICHES » au-dessus de « TRICHEUR ?! » : le spectateur lit deux fois la meme chose.
// Regle (fiche sous_titres) : un titre REMPLACE la legende pour ces mots, il ne la repete pas.
// Ce que fait le lecteur :
//   - la puce dont TOUS les mots utiles sont deja dans le titre est cachee pendant que le titre est a l'ecran (fusion) ; une note le dit ;
//   - si la puce dit autre chose en plus (un seul mot en commun), elle reste, et une note le signale (« texte en double ») ;
//   - dans les deux cas la disposition eloigne le titre de la legende (incrust/index.js : ecart plus grand).
// Mots compares sans casse, sans accents ni ponctuation ; « triches » et « tricheur » sont le meme mot (5 lettres communes au debut) ;
// les nombres comptent (« -58 » dans « COUCHE -58 » et le compteur « Y = -58 »). Les mots de moins de 3 lettres sont ignores.

const sansAccents = (s) => s.normalize('NFD').replace(/\p{M}/gu, '');
const VIDES = new Set(['les', 'des', 'une', 'est', 'pas', 'que', 'qui', 'mon', 'ton', 'son', 'mes', 'tes', 'ses', 'the', 'and', 'you', 'avec', 'pour', 'dans', 'sur']);

// Mots utiles d'un texte (codes § du jeu retires) : lettres de 3+ ou nombres de 2+ caracteres (signe compris).
export function motsUtiles(texte) {
  const t = sansAccents(String(texte).replace(/§./g, '')).toLowerCase();
  const out = [];
  for (const m of t.matchAll(/-?\d+(?:[.,]\d+)?|\p{L}+/gu)) {
    const w = m[0];
    if (/\d/.test(w)) { if (w.replace(/\D/g, '').length >= 2) out.push(w.replace(',', '.')); }
    else if (w.length >= 3 && !VIDES.has(w)) out.push(w);
  }
  return out;
}

const prefixe = (a, b) => { let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return k; };
export const memeMot = (a, b) => a === b || (!/\d/.test(a) && !/\d/.test(b) && a.length >= 5 && b.length >= 5 && prefixe(a, b) >= 5);

// Texte affiche par un titre : texte, ou prefixe + valeur finale + suffixe d'un compteur.
function texteTitre(el) {
  if (el.type === 'texte' && !el.legende && typeof el.texte === 'string') return el.texte;
  if (el.type === 'compteur' && Array.isArray(el.valeurs) && el.valeurs.length) return `${el.prefixe ?? ''}${el.valeurs[el.valeurs.length - 1]}${el.suffixe ?? ''}`;
  return null;
}

// scene validee -> [{ titre, legende, t0, t1, mots: [communs], couvert (la puce ne dit rien de plus) }]
export function textesEnDouble(scene) {
  const legendes = (scene.textes ?? []).filter((e) => e.legende && typeof e.texte === 'string');
  const titres = (scene.incrustations ?? []).filter((e) => texteTitre(e) !== null);
  const res = [];
  for (const ti of titres) {
    const mt = motsUtiles(texteTitre(ti));
    if (!mt.length) continue;
    for (const le of legendes) {
      const t0 = Math.max(ti.t[0], le.t[0]), t1 = Math.min(ti.t[1], le.t[1]);
      if (t1 - t0 < 0.05) continue;
      const ml = motsUtiles(le.texte);
      const communs = ml.filter((w) => mt.some((x) => memeMot(w, x)));
      if (!communs.length) continue;
      res.push({ titre: ti, legende: le, t0, t1, mots: communs, couvert: communs.length === ml.length });
    }
  }
  return res;
}

const r1 = (x) => Math.round(x * 10) / 10;
// Notes courtes, une par paire.
export function notesDoublons(doublons) {
  return doublons.map((d) => {
    const titre = `"${String(d.titre.texte ?? texteTitre(d.titre)).slice(0, 24)}"`, leg = `"${String(d.legende.texte).slice(0, 24)}"`;
    return d.couvert
      ? `texte en double ${r1(d.t0)}-${r1(d.t1)} s : la legende ${leg} repete le titre ${titre} : elle est cachee pendant le titre (un titre remplace la legende pour ces mots)`
      : `texte en double ${r1(d.t0)}-${r1(d.t1)} s : la legende ${leg} et le titre ${titre} disent tous deux "${d.mots.join(' ')}" : garde le mot dans un seul des deux`;
  });
}
