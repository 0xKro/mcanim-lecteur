// Ordre d'iteration d'un HashSet<BlockPos> de Java (java.util.HashMap) et Util.shuffle du jeu : l'explosion range ses blocs touches dans un
// HashSet (ServerExplosion.calculateExplodedPositions), en fait une liste, la melange avec le hasard du monde, puis casse les blocs, lache le
// butin et pose le feu dans cet ordre. Port d'apres Horizon horizon-world/src/java_hash_map.rs (MIT, voir ATTRIBUTIONS.md), insertion seule :
//   - code de hachage de BlockPos (Vec3i.hashCode) : (y + z x 31) x 31 + x en entiers 32 bits ; etale : h ^ (h >>> 16) ;
//   - table de 16 cases, doublee quand le nombre d'elements depasse les 3/4 ; un doublement coupe chaque case en deux listes (bit `ancienne
//     taille` du hachage), chacune dans son ordre ;
//   - une liste qui a deja 8 elements quand on en ajoute un devient un arbre rouge-noir (si la table a 64 cases, sinon elle double) : la
//     racine passe en tete de liste, un nouvel element se range juste apres son parent dans l'arbre (TreeNode.putTreeVal) ; un arbre coupe a
//     6 elements ou moins redevient une liste.
// Deux positions de meme hachage etale dans un arbre : le jeu les departage par System.identityHashCode (different a chaque lancement du jeu) ;
// ici la plus recente va a droite (deterministe).
const NIL = -1;


// positions : [[x, y, z], ...] dans l'ordre ou le jeu les ajoute (doublons ignores) ; rend les positions dans l'ordre d'iteration du HashSet
export function ordreHashSet(positions) {
  return ordreHashMap(positions, (p) => `${p[0]},${p[1]},${p[2]}`, (p) => (Math.imul((p[1] + Math.imul(p[2], 31)) | 0, 31) + p[0]) | 0, null);
}

// Le coeur, pour toute cle : identite(cle) -> texte (egalite), hashCode(cle) -> entier 32 bits (avant etalement), comparer(a, b) -> <0, 0, >0
// (Comparable de la classe, ou null : departage par l'ordre d'arrivee). Rend les cles dans l'ordre d'iteration du HashMap.
export function ordreHashMap(cles, identite, hashCode, comparer) {
  const positions = cles;
  const cle = [], hash = [], next = [], par = [], gau = [], dro = [], rouge = [];
  let tete = new Array(16).fill(NIL), racine = new Array(16).fill(NIL), seuil = 12, n = 0;
  const index = new Map();
  const bucket = (h) => h & (tete.length - 1);
  // --- arbre rouge-noir (CLRS 13), une case
  const vaGauche = (i, p) => (hash[p] > hash[i] ? true : hash[p] < hash[i] ? false : comparer ? comparer(cle[i], cle[p]) < 0 : false);
  const rotG = (b, x) => { const y = dro[x]; dro[x] = gau[y]; if (gau[y] !== NIL) par[gau[y]] = x; par[y] = par[x]; if (par[x] === NIL) racine[b] = y; else if (gau[par[x]] === x) gau[par[x]] = y; else dro[par[x]] = y; gau[y] = x; par[x] = y; };
  const rotD = (b, x) => { const y = gau[x]; gau[x] = dro[y]; if (dro[y] !== NIL) par[dro[y]] = x; par[y] = par[x]; if (par[x] === NIL) racine[b] = y; else if (dro[par[x]] === x) dro[par[x]] = y; else gau[par[x]] = y; dro[y] = x; par[x] = y; };
  const estRouge = (x) => x !== NIL && rouge[x];
  const attacher = (b, i) => {   // RB-INSERT puis RB-INSERT-FIXUP ; rend le parent
    let p = racine[b], parent = NIL, gauche = false;
    while (p !== NIL) { parent = p; gauche = vaGauche(i, p); p = gauche ? gau[p] : dro[p]; }
    par[i] = parent; gau[i] = NIL; dro[i] = NIL; rouge[i] = true;
    if (parent === NIL) racine[b] = i; else if (gauche) gau[parent] = i; else dro[parent] = i;
    let z = i;
    while (estRouge(par[z])) {
      const zp = par[z], zpp = par[zp];
      if (zp === gau[zpp]) {
        const y = dro[zpp];
        if (estRouge(y)) { rouge[zp] = false; rouge[y] = false; rouge[zpp] = true; z = zpp; }
        else { if (z === dro[zp]) { z = zp; rotG(b, z); } rouge[par[z]] = false; rouge[par[par[z]]] = true; rotD(b, par[par[z]]); }
      } else {
        const y = gau[zpp];
        if (estRouge(y)) { rouge[zp] = false; rouge[y] = false; rouge[zpp] = true; z = zpp; }
        else { if (z === gau[zp]) { z = zp; rotD(b, z); } rouge[par[z]] = false; rouge[par[par[z]]] = true; rotG(b, par[par[z]]); }
      }
    }
    rouge[racine[b]] = false;
    return parent;
  };
  const delier = (b, i) => { if (tete[b] === i) { tete[b] = next[i]; return; } let p = tete[b]; while (next[p] !== i) p = next[p]; next[p] = next[i]; };
  const racineDevant = (b) => { const r = racine[b]; if (r !== tete[b]) { delier(b, r); next[r] = tete[b]; tete[b] = r; } };
  const arboriser = (b) => { racine[b] = NIL; for (let i = tete[b]; i !== NIL; i = next[i]) attacher(b, i); racineDevant(b); };
  const grandir = () => {
    const vieux = tete.length, T = tete, Rr = racine;
    tete = new Array(vieux * 2).fill(NIL); racine = new Array(vieux * 2).fill(NIL);
    for (let j = 0; j < vieux; j++) {
      if (T[j] === NIL) continue;
      if (next[T[j]] === NIL) { const to = bucket(hash[T[j]]); tete[to] = T[j]; racine[to] = Rr[j]; continue; }
      const moities = [[NIL, NIL, 0], [NIL, NIL, 0]];   // [tete, queue, longueur]
      for (let i = T[j]; i !== NIL;) {
        const s = next[i], m = moities[(hash[i] & vieux) !== 0 ? 1 : 0];
        if (m[1] === NIL) m[0] = i; else next[m[1]] = i;
        m[1] = i; m[2]++; next[i] = NIL; i = s;
      }
      moities.forEach(([h, , len], k) => {
        if (h === NIL) return;
        const to = j + k * vieux;
        tete[to] = h;
        if (Rr[j] === NIL || len <= 6) racine[to] = NIL;
        else if (moities[1 - k][0] !== NIL) arboriser(to);
        else racine[to] = Rr[j];
      });
    }
    seuil = tete.length * 3 / 4;
  };
  for (const c of positions) {
    const k = identite(c);
    if (index.has(k)) continue;
    const i = cle.length;
    const h0 = hashCode(c) | 0;
    index.set(k, i); cle.push(c); hash.push((h0 ^ (h0 >>> 16)) | 0); next.push(NIL); par.push(NIL); gau.push(NIL); dro.push(NIL); rouge.push(false);
    const b = bucket(hash[i]);
    if (tete[b] === NIL) tete[b] = i;
    else if (racine[b] !== NIL) { const p = attacher(b, i); next[i] = next[p]; next[p] = i; racineDevant(b); }
    else {
      let len = 0, dernier = NIL;
      for (let q = tete[b]; q !== NIL; q = next[q]) { len++; dernier = q; }
      next[dernier] = i;
      if (len >= 8) { if (tete.length < 64) grandir(); else arboriser(b); }
    }
    if (++n > seuil) grandir();
  }
  const out = [];
  for (let b = 0; b < tete.length; b++) for (let i = tete[b]; i !== NIL; i = next[i]) out.push(cle[i]);
  return out;
}

// Util.shuffle(list, random) : de la fin vers le debut, echange avec un indice tire dans [0, i)
export function melangerJeu(liste, hasard) {
  for (let i = liste.length; i > 1; i--) { const j = hasard.entierBorne(i); const t = liste[i - 1]; liste[i - 1] = liste[j]; liste[j] = t; }
  return liste;
}
