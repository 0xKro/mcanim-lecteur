// Navigation simple des acteurs : A* sur la grille des blocs du monde VIVANT (blocs poses et portes comprises), avec les regles de marche
// du jeu : une marche de 1 bloc se monte en sautant (0,6 sans sauter), on ne descend pas de plus de 3 blocs, on evite l'eau, la lave, le feu,
// les cactus ; une porte fermee passe seulement avec `ouvrePortes`. La navigation du jeu (port de path.rs) viendra en P3 avec la meme interface.
import { boitesLocales, coupe, solSous, deplacerBoite } from './collision.js';

const LARGEUR = 0.6, HAUTEUR = 1.8;
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DANGER = /^(lava|fire|soul_fire|cactus|magma_block|campfire|soul_campfire|sweet_berry_bush|wither_rose|powder_snow|cobweb)$/;
export const CHUTE_MAX = 3;                    // blocs : plus profond = trou, evite
export const SAUT_PAS = 1.2;                   // on monte une marche d'au plus 1,2 bloc en sautant (le saut du jeu monte 1,2522)

// Lecteur ou les portes que l'acteur sait ouvrir sont de l'air (pour planifier a travers elles)
function lecteurOuvert(lec, ouvrables) {
  return {
    d: lec.d,
    etatEn(x, y, z) { const e = lec.etatEn(x, y, z); if (e >= 0 && ouvrables.has(lec.d.blocDe(e)) && lec.d.prop(e, 'open') === 'false') return lec.d.air; return e; },
    get limites() { return lec.limites; },
  };
}

// Blocs que l'acteur ouvre a la main : portes (type `canOpenByHand`) et portillons
export function blocsOuvrables(d, { fer = false } = {}) {
  const s = new Set();
  for (let b = 0; b < d.noms.length; b++) {
    const cl = d.classes(b);
    if (cl[0] === 'DoorBlock') { const t = d.champsBloc(b)?.type; if (t?.canOpenByHand || fer) s.add(b); } else if (cl[0] === 'FenceGateBlock') s.add(b);
  }
  return s;
}

const estDanger = (lec, x, y, z) => { const e = lec.etatEn(x, y, z); return e >= 0 && (DANGER.test(lec.d.nomBloc(e)) || lec.d.fluide(e) !== 0); };

// Un point de station valide (pieds en (x, y, z) reels) : la boite de l'acteur est libre, du sol dessous, rien de dangereux
function stationValide(lec, x, y, z) {
  const b = [x - LARGEUR / 2 + 1e-3, y + 1e-3, z - LARGEUR / 2 + 1e-3, x + LARGEUR / 2 - 1e-3, y + HAUTEUR - 1e-3, z + LARGEUR / 2 - 1e-3];
  if (coupe(lec, b)) return false;
  const bx = Math.floor(x), bz = Math.floor(z), by = Math.floor(y + 1e-6);
  if (estDanger(lec, bx, by, bz) || estDanger(lec, bx, by + 1, bz) || estDanger(lec, bx, by - 1, bz)) return false;
  return true;
}

// Hauteur de sol de la colonne (cx, cz) pour un acteur dont les pieds sont a fy : montee d'une marche de 1 bloc ou descente de 3 blocs au plus.
function solColonne(lec, cx, cz, fy) {
  const s = solSous(lec, cx + 0.5, cz + 0.5, fy, SAUT_PAS + 1e-6, CHUTE_MAX + 1e-6);
  return s;
}

// Un segment droit a hauteur constante est-il praticable (boite de l'acteur qui glisse, sol continu) ?
export function segmentLibre(lec, a, b) {
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (Math.abs(b[1] - a[1]) > 0.02) return false;
  const n = Math.max(1, Math.ceil(L / 0.25));
  for (let i = 1; i <= n; i++) {
    const x = a[0] + (b[0] - a[0]) * i / n, z = a[2] + (b[2] - a[2]) * i / n;
    if (!stationValide(lec, x, a[1], z)) return false;
    const s = solSous(lec, x, z, a[1], 0.05, 0.2);
    if (s === null || Math.abs(s - a[1]) > 0.03) return false;
    for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
      const s2 = solSous(lec, x + dx, z + dz, a[1], 0.05, 0.6);
      if (s2 === null) return false;
    }
  }
  return true;
}

// Chemin de `de` = [x, y, z] (pieds) vers le point (bx, bz) [, by]. Rend { chemin: [[x,y,z]...], portes: [[x,y,z]...], complet, raison }.
// Si le but n'est pas atteignable, `complet` est faux et le chemin mene au point le plus proche (ou est vide).
export function chercherChemin(lec, de, but, { ouvrePortes = false, ferOuvrable = false, rayon = 0.5, maxNoeuds = 12000 } = {}) {
  const d = lec.d;
  const ouvrables = ouvrePortes ? blocsOuvrables(d, { fer: ferOuvrable }) : new Set();
  const L = ouvrePortes ? lecteurOuvert(lec, ouvrables) : lec;
  const bx = but.x, bz = but.z;
  const cle = (cx, cz, fy) => `${cx},${cz},${Math.round(fy * 32)}`;
  const heur = (x, z) => Math.hypot(x - bx, z - bz);
  const cx0 = Math.floor(de[0]), cz0 = Math.floor(de[2]);
  const ouvert = new Map(), fermes = new Set();
  const tas = [];
  const pousser = (n) => { tas.push(n); let i = tas.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (tas[p].f <= tas[i].f) break; [tas[p], tas[i]] = [tas[i], tas[p]]; i = p; } };
  const tirer = () => { const t = tas[0], q = tas.pop(); if (tas.length) { tas[0] = q; let i = 0; for (;;) { let m = i; const l = 2 * i + 1, r = l + 1; if (l < tas.length && tas[l].f < tas[m].f) m = l; if (r < tas.length && tas[r].f < tas[m].f) m = r; if (m === i) break; [tas[m], tas[i]] = [tas[i], tas[m]]; i = m; } } return t; };
  const dep = { cx: cx0, cz: cz0, x: de[0], z: de[2], y: de[1], g: 0, f: heur(de[0], de[2]), parent: null };
  pousser(dep); ouvert.set(cle(cx0, cz0, de[1]), dep);
  let meilleur = dep, nb = 0, trouve = null;
  while (tas.length && nb < maxNoeuds) {
    const n = tirer(); const k = cle(n.cx, n.cz, n.y);
    if (fermes.has(k)) continue;
    fermes.add(k); nb++;
    // but atteint : la case contient le point, ou son centre est a `rayon` du point (les noeuds sont des centres de cases)
    if ((Math.hypot(n.x - bx, n.z - bz) <= rayon || (n.cx === Math.floor(bx) && n.cz === Math.floor(bz))) && (but.y === undefined || Math.abs(n.y - but.y) < 2)) { trouve = n; break; }
    if (heur(n.x, n.z) < heur(meilleur.x, meilleur.z)) meilleur = n;
    for (const [dx, dz] of DIRS8) {
      const cx = n.cx + dx, cz = n.cz + dz;
      const lim = lec.limites;
      if (lim && (cx < lim.x0 || cx >= lim.x1 || cz < lim.z0 || cz >= lim.z1)) continue;   // on reste dans la boite du monde
      const diag = dx !== 0 && dz !== 0;
      const s = solColonne(L, cx, cz, n.y);
      if (s === null) continue;
      // un point de la colonne : le centre de la cellule ; pour le but, on s'arrete sur le point exact
      const x = cx + 0.5, z = cz + 0.5;
      if (!stationValide(L, x, s, z)) continue;
      if (diag) {   // pas de coin coupe : les deux colonnes voisines doivent etre praticables a la meme hauteur
        const s1 = solColonne(L, n.cx + dx, n.cz, n.y), s2 = solColonne(L, n.cx, n.cz + dz, n.y);
        if (s1 === null || s2 === null || Math.abs(s1 - n.y) > 0.02 || Math.abs(s2 - n.y) > 0.02 || Math.abs(s - n.y) > 0.02) continue;
        if (!stationValide(L, n.cx + dx + 0.5, s1, n.cz + 0.5) || !stationValide(L, n.cx + 0.5, s2, n.cz + dz + 0.5)) continue;
      }
      // une marche de plus de 0,6 demande un saut : le plafond au-dessus de la case de depart doit etre libre sur 1,25 de plus
      if (s - n.y > 0.6 + 1e-6) {
        const hb = [n.x - 0.29, n.y + 1e-3, n.z - 0.29, n.x + 0.29, n.y + 1.8 + (s - n.y) - 1e-3, n.z + 0.29];
        if (coupe(L, hb)) continue;
      }
      // la boite qui glisse d'une case a l'autre ne doit rien toucher en chemin (panneau d'une porte fermee a l'arete d'une case, cloture...)
      let libre = true;
      for (const t of [0.25, 0.5, 0.75]) { if (!stationValide(L, n.x + (x - n.x) * t, t < 0.5 ? n.y : Math.max(n.y, s), n.z + (z - n.z) * t)) { libre = false; break; } }
      if (!libre) continue;
      const chute = n.y - s;
      let cout = diag ? 1.4142 : 1;
      if (s - n.y > 0.6) cout += 0.6; else if (chute > 0.6) cout += 0.3 * chute;
      // porte a traverser
      const eReel = lec.etatEn(cx, Math.floor(s + 1e-6), cz);
      if (ouvrePortes && eReel >= 0 && ouvrables.has(d.blocDe(eReel))) cout += 2;
      const g = n.g + cout, kk = cle(cx, cz, s);
      if (fermes.has(kk)) continue;
      const ex = ouvert.get(kk);
      if (ex && ex.g <= g) continue;
      const nn = { cx, cz, x, z, y: s, g, f: g + heur(x, z), parent: n };
      ouvert.set(kk, nn); pousser(nn);
    }
  }
  const fin = trouve || meilleur;
  const pts = [];
  for (let n = fin; n; n = n.parent) pts.push([n.x, n.y, n.z]);
  pts.reverse();
  if (trouve) { const dernier = pts[pts.length - 1]; if (rayon < 0.5 || Math.hypot(dernier[0] - bx, dernier[2] - bz) > 0.2) pts.push([bx, dernier[1], bz]); }
  // lissage : on saute les points intermediaires qu'un segment droit libre relie
  const lisse = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !segmentLibre(L, pts[i], pts[j])) j--;
    lisse.push(pts[j]); i = j;
  }
  // portes sur le chemin : cellules d'une porte fermee que le chemin traverse
  const portes = [];
  if (ouvrePortes) {
    const vus = new Set();
    for (let k = 0; k + 1 < lisse.length; k++) {
      const a = lisse[k], b = lisse[k + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.25));
      for (let q = 0; q <= n; q++) {
        const x = Math.floor(a[0] + (b[0] - a[0]) * q / n), z = Math.floor(a[2] + (b[2] - a[2]) * q / n);
        for (const yy of [Math.floor(a[1] + 1e-6), Math.floor(a[1] + 1e-6) + 1]) {
          const e = lec.etatEn(x, yy, z);
          if (e >= 0 && ouvrables.has(d.blocDe(e)) && d.prop(e, 'open') === 'false') {
            // pour une porte a deux cases on garde la case basse
            const bas = d.prop(e, 'half') === 'upper' ? yy - 1 : yy, id = `${x},${bas},${z}`;
            if (!vus.has(id)) { vus.add(id); portes.push([x, bas, z]); }
          }
        }
      }
    }
  }
  return { chemin: lisse, portes, complet: !!trouve, noeuds: nb, raison: trouve ? null : (nb >= maxNoeuds ? 'limite de recherche atteinte' : 'aucun chemin') };
}

// Position debout (pieds) la plus proche de `cible` (x, y, z) d'ou l'on atteint la cellule : sert aux verbes `utilise`/`pose`/`casse` avec `va`.
// Cherche autour de la cellule une station valide a portee `portee` de l'oeil (1,62), en commencant par la plus proche de l'acteur.
export function stationPourCellule(lec, de, cellule, { portee = 4.0, ouvrePortes = false } = {}) {
  const [cx, cy, cz] = cellule;
  const candidats = [];
  const R = Math.ceil(portee);
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const x = cx + dx + 0.5, z = cz + dz + 0.5;
    for (let dy = -3; dy <= 1; dy++) {
      const s = solSous(lec, x, z, cy + dy + 0.01, 0.01, 0.02);
      if (s === null || !stationValide(lec, x, s, z)) continue;
      const ex = x, ey = s + 1.62, ez = z;
      const px = Math.max(cx, Math.min(ex, cx + 1)), py = Math.max(cy, Math.min(ey, cy + 1)), pz = Math.max(cz, Math.min(ez, cz + 1));
      const dist = Math.hypot(ex - px, ey - py, ez - pz);
      if (dist > portee) continue;
      if (dx === 0 && dz === 0 && dy >= -1 && dy <= 0) continue;     // dans la cellule elle-meme
      candidats.push({ x, y: s, z, dist, loin: Math.hypot(x - de[0], z - de[2]) + Math.abs(s - de[1]) });
    }
  }
  candidats.sort((p, q) => p.loin - q.loin || p.dist - q.dist);
  for (const c of candidats.slice(0, 12)) {
    const r = chercherChemin(lec, de, { x: c.x, z: c.z, y: c.y }, { ouvrePortes, rayon: 0.35 });
    if (r.complet) return { ...c, chemin: r };
  }
  return null;
}

void boitesLocales; void deplacerBoite;
