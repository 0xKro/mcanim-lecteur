// Navigation des acteurs et des creatures sur le monde VIVANT (blocs poses et portes comprises) : la recherche de chemin du jeu
// (chemins.js : PathFinder, WalkNodeEvaluator, SwimNodeEvaluator, FlyNodeEvaluator, AmphibiousNodeEvaluator, types de chemin et malus du jeu,
// portes, sauts, chutes, clotures) ; GroundPathNavigation.findSurfacePosition pour la cible. Le joueur des scenes (pas un mob) grimpe en plus aux
// echelles et lianes, ouvre portes et portillons a la main et lisse son trajet ; une creature suit les noeuds du jeu.
import { boitesLocales, coupe, solSous, deplacerBoite } from './collision.js';
import { Chercheur, positionSurface, pointDeNoeud, TYPES } from './chemins.js';

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

// danger : lave, feu, cactus... et les fluides ; avec `eauOk` (creatures a IA : PathType.WATER malus 8 du jeu), l'eau n'est plus un danger
const estDanger = (lec, x, y, z, eauOk = false) => { const e = lec.etatEn(x, y, z); if (e < 0) return false; const f = lec.d.fluide(e); return DANGER.test(lec.d.nomBloc(e)) || (f !== 0 && !(eauOk && (f === 1 || f === 2))); };
const estEau = (lec, x, y, z) => { const e = lec.etatEn(x, y, z); if (e < 0) return false; const f = lec.d.fluide(e); return f === 1 || f === 2; };
// WalkNodeEvaluator : la case est de l'eau (WATER) ou touche de l'eau (checkNeighbourBlocks : x +-1, y +-1, z +-1 hors de la colonne : WATER_BORDER)
function typeEau(lec, x, y, z) {
  if (estEau(lec, x, y, z)) return 'eau';
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if ((dx || dz) && estEau(lec, x + dx, y + dy, z + dz)) return 'bord';
  return null;
}

// Case #minecraft:climbable (echelle, lianes, echafaudage...) ; une trappe ouverte au-dessus d'une echelle de meme direction compte aussi
export function grimpable(lec, x, y, z) {
  const e = lec.etatEn(x, y, z);
  if (e < 0) return false;
  const d = lec.d, t = (d._grimpables ??= d.etiquette('#minecraft:climbable'));
  if (t.has(d.blocDe(e))) return true;
  if (!/_trapdoor$/.test(d.nomBloc(e)) || d.prop(e, 'open') !== 'true') return false;
  const s = lec.etatEn(x, y - 1, z);
  return s >= 0 && d.nomBloc(s) === 'ladder' && d.prop(s, 'facing') === d.prop(e, 'facing');
}

// Un point de station valide (pieds en (x, y, z) reels) : la boite de l'acteur est libre, du sol dessous, rien de dangereux
// g : gabarit { L, H, chute } (creatures : leur boite et leur chute permise ; defaut : le joueur)
const GJ = { L: LARGEUR, H: HAUTEUR, chute: CHUTE_MAX, eau: 0, flotte: false, surClotures: true };
// PathType.FENCE (malus -1) : une creature ne marche pas sur une cloture, un muret ou un portillon (WalkNodeEvaluator : #fences, #walls,
// FenceGateBlock) ; le joueur, si (il saute dessus)
const CLOTURE = /(_fence|_wall|_fence_gate)$/;
function stationValide(lec, x, y, z, g = GJ) {
  const b = [x - g.L / 2 + 1e-3, y + 1e-3, z - g.L / 2 + 1e-3, x + g.L / 2 - 1e-3, y + g.H - 1e-3, z + g.L / 2 - 1e-3];
  if (coupe(lec, b)) return false;
  const bx = Math.floor(x), bz = Math.floor(z), by = Math.floor(y + 1e-6);
  const ok = g.eau > 0;
  if (!g.surClotures) { const e = lec.etatEn(bx, Math.floor(y - 0.6), bz); if (e >= 0 && CLOTURE.test(lec.d.nomBloc(e))) return false; }
  if (estDanger(lec, bx, by, bz, ok) || estDanger(lec, bx, by + 1, bz, ok) || estDanger(lec, bx, by - 1, bz, ok)) return false;
  return true;
}

// Hauteur de sol de la colonne (cx, cz) pour un acteur dont les pieds sont a fy : montee d'une marche de 1 bloc ou descente de 3 blocs au plus.
// Une creature qui flotte (FloatGoal : can_float) se tient a la surface de l'eau : WalkNodeEvaluator.getFloorLevel = y du bloc d'eau + 0,5.
function solColonne(lec, cx, cz, fy, g = GJ) {
  const s = solSous(lec, cx + 0.5, cz + 0.5, fy, SAUT_PAS + 1e-6, g.chute + 1e-6);
  if (g.eau > 0 && g.flotte) {
    for (let y = Math.floor(fy + SAUT_PAS - 0.5); y >= Math.floor(fy - g.chute); y--) {
      if (!estEau(lec, cx, y, cz)) continue;
      if (estEau(lec, cx, y + 1, cz)) break;   // pas la surface : la surface est plus haut que la marche permise
      const f = y + 0.5;
      if (s === null || f > s) return f;
      break;
    }
  }
  return s;
}

// Un segment droit a hauteur constante est-il praticable (boite de l'acteur qui glisse, sol continu) ?
export function segmentLibre(lec, a, b, g = GJ) {
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (Math.abs(b[1] - a[1]) > 0.02) return false;
  const n = Math.max(1, Math.ceil(L / 0.25));
  for (let i = 1; i <= n; i++) {
    const x = a[0] + (b[0] - a[0]) * i / n, z = a[2] + (b[2] - a[2]) * i / n;
    if (g.eau > 0 && typeEau(lec, Math.floor(x), Math.floor(a[1] + 1e-6), Math.floor(z))) return false;   // eau ou bord : le malus compte (A*)
    if (!stationValide(lec, x, a[1], z, g)) return false;
    const s = solSous(lec, x, z, a[1], 0.05, 0.2);
    if (s === null || Math.abs(s - a[1]) > 0.03) return false;
    const r = g.L / 2;
    for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
      const s2 = solSous(lec, x + dx, z + dz, a[1], 0.05, 0.6);
      if (s2 === null) return false;
    }
  }
  return true;
}

// Chemin de `de` = [x, y, z] (pieds) vers le point (bx, bz) [, by] avec la recherche de chemin du jeu (chemins.js : PathFinder et
// WalkNodeEvaluator portes de Horizon). Rend { chemin: [[x,y,z(,grimpe)]...], portes: [[x,y,z]...], complet, noeuds, raison, types }.
// Si le but n'est pas atteignable, `complet` est faux et le chemin mene au noeud le plus proche (Path du jeu : le meilleur noeud).
//   gabarit : { L, H, chute, eau, flotte, surClotures, pas, malus } d'une creature (null : le joueur, 0,6 x 1,8, qui grimpe aux echelles et
//   evite l'eau) ; suivi : follow_range (longueur maximale du chemin ; noeuds visites au plus : suivi x 16, PathNavigation) ;
//   rayon : distance d'arrivee (le jeu : `accuracy` entiere, 1 pour moveTo d'une creature) ; evaluateur : marche, nage, vol, amphibie.
export function chercherChemin(lec, de, but, { ouvrePortes = false, ferOuvrable = false, rayon = 0.5, maxNoeuds = null, gabarit = null, suivi = null, auSol = true, dansEau = false, evaluateur = 'marche', exact = null, precision = null } = {}) {
  const d = lec.d, joueur = !gabarit;
  const L = gabarit?.L ?? LARGEUR, H = gabarit?.H ?? HAUTEUR;
  const malus = { ...(gabarit?.malus ?? {}) };
  if (joueur) malus.WATER ??= -1;                                     // le joueur des scenes contourne l'eau (comme avant)
  else if (gabarit.eau === 0) malus.WATER ??= -1;                    // renifleur, arpenteur : setPathfindingMalus(WATER, -1)
  else if (gabarit.eau > 0 && gabarit.eau !== 8) malus.WATER ??= gabarit.eau;
  const mob = {
    x: de[0], y: de[1], z: de[2], largeur: L, hauteur: H, auSol, dansEau, pas: gabarit?.pas ?? 0.6, chute: gabarit?.chute ?? CHUTE_MAX,
    malus, flotte: !!gabarit?.flotte, ouvrePortes, ouvrePortesFer: ouvrePortes && ferOuvrable, passePortes: true, surClotures: !!gabarit?.surClotures && !joueur ? true : false,
    lave: !!gabarit?.lave, grimpe: joueur ? (x, y, z) => grimpable(lec, x, y, z) : null,
  };
  const bx = but.x, bz = but.z;
  const yRef = but.y !== undefined ? but.y : de[1];
  const cible = evaluateur === 'marche' ? positionSurface(lec, [Math.floor(bx), Math.floor(yRef + 1e-6), Math.floor(bz)]) : [Math.floor(bx), Math.floor(yRef), Math.floor(bz)];
  const dist = Math.hypot(bx - de[0], bz - de[2]);
  const longueur = suivi ?? (joueur ? Math.min(256, Math.max(96, dist * 3 + 32)) : 16);   // le joueur n'est pas un mob : pas de follow_range, une longueur large
  const visites = maxNoeuds ?? Math.floor(longueur * 16);
  const ex = exact ?? joueur;                                        // acteur a intentions : il va au point exact demande (accuracy 0)
  const portee = precision ?? (ex ? 0 : rayon >= 1 ? Math.floor(rayon) : 1);   // precision : ccuracy du jeu (MeleeAttackGoal : 0, moveTo : 1)
  // le joueur ouvre a la main portes et portillons (il n'est pas un mob) : il les voit ouverts ; une creature suit les regles du jeu
  // (porte en bois fermee : WALKABLE_DOOR si elle sait ouvrir, portillon ferme : FENCE)
  const LV = joueur && ouvrePortes ? lecteurOuvert(lec, blocsOuvrables(d, { fer: ferOuvrable })) : lec;
  const ch = new Chercheur(LV, mob, evaluateur);
  const p = ch.trouver([cible], longueur, portee, visites);
  if (!p) return { chemin: [[de[0], de[1], de[2]]], portes: [], complet: false, noeuds: 0, raison: 'aucun chemin', types: [] };
  const sol = evaluateur === 'marche' || evaluateur.startsWith('amphibie');
  const pts = [[de[0], de[1], de[2]]];
  for (const n of p.noeuds.slice(1)) { const q = pointDeNoeud(LV, n, L, sol && !n.echelle); if (n.echelle) { q[1] = n.y; q.push(n.echelle); } pts.push(q); }
  // joueur : il s'arrete sur le point exact demande (sa case est le dernier noeud)
  if (ex && p.atteint) { const dernier = pts[pts.length - 1]; if (Math.hypot(dernier[0] - bx, dernier[2] - bz) > 0.2) pts.push([bx, dernier[1], bz]); }
  // joueur : lissage (on saute les points qu'un segment droit libre relie : un joueur ne suit pas les noeuds d'une creature)
  let chemin = pts;
  if (joueur) {
    const GL = { L, H, chute: mob.chute, eau: 0, flotte: false, surClotures: true };
    chemin = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) { let j = pts.length - 1; while (j > i + 1 && (pts[j][3] || pts[j - 1][3] || !segmentLibre(LV, pts[i], pts[j], GL))) j--; chemin.push(pts[j]); i = j; }
  }
  // portes du chemin : les portes fermees que le chemin traverse (noeuds WALKABLE_DOOR, et la cellule des noeuds), case basse
  const portes = [], vus = new Set();
  if (ouvrePortes) for (const n of p.noeuds) for (const yy of [n.y, n.y + 1]) {
    const e = lec.etatEn(n.x, yy, n.z);
    if (e < 0 || d.prop(e, 'open') !== 'false' || !/^(DoorBlock|FenceGateBlock|WeatheringCopperDoorBlock)$/.test(d.classes(d.blocDe(e))[0])) continue;
    const bas = d.prop(e, 'half') === 'upper' ? yy - 1 : yy, id = `${n.x},${bas},${n.z}`;
    if (!vus.has(id)) { vus.add(id); portes.push([n.x, bas, n.z]); }
  }
  return { chemin, portes, complet: p.atteint, noeuds: p.visites, raison: p.atteint ? null : (p.visites >= visites ? 'limite de recherche atteinte' : 'aucun chemin'), types: p.noeuds.map((n) => TYPES[n.type]) };
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
