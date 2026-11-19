// Rapport d'un decor applique (gratuit, court : 15 lignes au plus) : emprise, blocs, sol, etats recalcules, avertissements
// (blocs flottants, portes bloquees, blocs sans appui, zone agrandie).
import { VECT } from './etats.js';
import { limitesEmprise } from './appliquer.js';

const NOM = (s) => String(s).replace(/^minecraft:/, '');

export function rapportDecor({ g, d, cls, ex, decor, diff, net, lia, comble, nom, emprise = null }) {
  void decor;
  const liste = Array.isArray(diff) ? diff : [...diff];
  const E = emprise ?? limitesEmprise(g, liste);
  let plus = 0, moins = 0;
  // memo par indice de palette (un grand decor change des millions de cellules) : air ?
  const airP = new Int8Array(g.palette.length).fill(-1);
  const estAir = (p) => { let v = airP[p]; if (v < 0) { const e = g.etatDePal(p); v = e >= 0 && cls.infoEtat(e).air ? 1 : 0; airP[p] = v; } return v === 1; };
  const parPal = new Uint32Array(g.palette.length);
  const S = [];               // cellules du decor qui ne sont pas de l'air
  for (const i of liste) {
    const p = g.cells[i];
    if (estAir(p)) { if (!estAir(g.orig[i])) moins++; continue; }
    plus++; S.push(i); parPal[p]++;
  }
  const compte = new Map();
  for (let p = 0; p < parPal.length; p++) {
    if (!parPal[p]) continue;
    const e = g.etatDePal(p), n = e < 0 ? '#hidden' : d.nomBloc(e);
    compte.set(n, (compte.get(n) || 0) + parPal[p]);
  }
  const blocs = [...compte.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

  // sol sous l'emprise (d'avant le decor)
  let smin = Infinity, smax = -Infinity;
  if (liste.length) {
    // grande emprise : une colonne sur `pas` dans chaque sens (65 536 colonnes lues au plus ; c'est un resume)
    const pas = Math.max(1, Math.ceil(Math.sqrt(((E.x1 - E.x0 + 1) * (E.z1 - E.z0 + 1)) / 65536)));
    for (let z = E.z0; z <= E.z1; z += pas) for (let x = E.x0; x <= E.x1; x += pas) {
      if (!g.dansXZ(x, z)) continue;
      const s = ex.solColonne(x, z, g.orig);
      if (s === null) continue;
      if (s - 1 < smin) smin = s - 1;
      if (s - 1 > smax) smax = s - 1;
    }
  }

  // ---- blocs flottants : un morceau de decor qui ne touche ni le terrain ni rien de pose avant lui (voisinage de 26 cellules : les rangees d'un toit en
  // escaliers ne se touchent que par les coins, comme dans le jeu ; un morceau isole de TOUT le reste est signale)
  const VOIS = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if (a || b || c) VOIS.push([a, b, c]);
  const N = g.cells.length, inS = new Uint8Array(N), vuF = new Uint8Array(N);
  for (const i of S) inS[i] = 1;
  const sxz = g.sx * g.sz, OFF = VOIS.map(([a, b, c]) => c * sxz + b * g.sx + a);
  const solideP = new Int8Array(65536).fill(-1);
  const solide = (p) => {
    let v = solideP[p];
    if (v < 0) { const e = g.etatDePal(p); v = e < 0 || (d.boites(e).length && d.fluide(e) === 0) ? 1 : 0; solideP[p] = v; }
    return v === 1;
  };
  const supporte = (i) => {
    const ly = Math.floor(i / sxz), r = i - ly * sxz, lz = Math.floor(r / g.sx), lx = r - lz * g.sx;
    if (ly === 0) return true;                                    // le bas de la boite : le sous-sol
    if (lx > 0 && lx < g.sx - 1 && ly < g.sy - 1 && lz > 0 && lz < g.sz - 1) {
      for (let k = 0; k < 26; k++) { const j = i + OFF[k]; if (!inS[j] && solide(g.cells[j])) return true; }
      return false;
    }
    for (const v of VOIS) {
      const nx = lx + v[0], ny = ly + v[1], nz = lz + v[2];
      if (ny < 0) return true;
      if (nx < 0 || nz < 0 || nx >= g.sx || ny >= g.sy || nz >= g.sz) continue;
      const j = (ny * g.sz + nz) * g.sx + nx;
      if (!inS[j] && solide(g.cells[j])) return true;
    }
    return false;
  };
  const file = new Int32Array(S.length); let nf = 0;
  for (const i of S) if (supporte(i)) { vuF[i] = 1; file[nf++] = i; }
  for (let k = 0; k < nf; k++) {
    const i = file[k], ly = Math.floor(i / sxz), r = i - ly * sxz, lz = Math.floor(r / g.sx), lx = r - lz * g.sx;
    const interieur = lx > 0 && lx < g.sx - 1 && ly > 0 && ly < g.sy - 1 && lz > 0 && lz < g.sz - 1;
    for (let q = 0; q < 26; q++) {
      let j;
      if (interieur) j = i + OFF[q];
      else {
        const v = VOIS[q], nx = lx + v[0], ny = ly + v[1], nz = lz + v[2];
        if (nx < 0 || ny < 0 || nz < 0 || nx >= g.sx || ny >= g.sy || nz >= g.sz) continue;
        j = (ny * g.sz + nz) * g.sx + nx;
      }
      if (inS[j] && !vuF[j]) { vuF[j] = 1; file[nf++] = j; }
    }
  }
  const flottants = S.filter((i) => !vuF[i]);

  // ---- portes et blocs sans appui
  const portes = [], sansAppui = [];
  const plein = (x, y, z) => { const e = g.etat(x, y, z); return e < 0 || (d.boites(e).some((b) => b[0] <= 0.01 && b[3] >= 0.99 && b[2] <= 0.01 && b[5] >= 0.99 && b[4] >= 0.99) && d.fluide(e) === 0); };
  let sources = 0;
  // memo par indice de palette : 1 = source de lumiere, 2 = porte (moitie basse) ou bloc qui demande un appui
  const genreP = new Int8Array(g.palette.length).fill(-1);
  const genre = (p) => {
    let v = genreP[p];
    if (v < 0) {
      const e = g.etatDePal(p); v = 0;
      if (e >= 0) {
        const info = cls.infoEtat(e);
        if (d.emission(e) > 0) v |= 1;
        if ((info.porte && d.prop(e, 'half') === 'lower') || info.torche || info.tapis || info.plaque || info.bougie || info.rail || (info.plante && !info.eau)) v |= 2;
      }
      genreP[p] = v;
    }
    return v;
  };
  for (const i of S) {
    const gp = genre(g.cells[i]);
    if (!gp) continue;
    if (gp & 1) sources++;
    if (!(gp & 2)) continue;
    const e = g.etatDePal(g.cells[i]);
    const info = cls.infoEtat(e);
    const porteBasse = info.porte && d.prop(e, 'half') === 'lower';
    const [x, y, z] = g.xyz(i);
    if (porteBasse) {
      const f = d.prop(e, 'facing'), v = VECT[f], ouverte = d.prop(e, 'open') === 'true';
      const devant = plein(x + v[0], y, z + v[2]) || plein(x + v[0], y + 1, z + v[2]);
      const derriere = plein(x - v[0], y, z - v[2]) || plein(x - v[0], y + 1, z - v[2]);
      // sol des deux cotes : un bloc a collision dans la cellule sous la porte ou celle d'en dessous (une marche de 1 se saute)
      const aSol = (xx, zz) => [1, 2].some((k) => { const ee = g.etat(xx, y - k, zz); return ee < 0 || d.boites(ee).length > 0 || d.fluide(ee) !== 0; });
      portes.push({ x, y, z, ouverte, devant, derriere, solD: aSol(x + v[0], z + v[2]), solR: aSol(x - v[0], z - v[2]), f });
    } else {
      const sous = g.etat(x, y - 1, z);
      if (sous < 0) continue;
      if (!d.solideFace(sous, 1, 1) && !(info.plante && cls.infoEtat(sous).eau)) sansAppui.push([x, y, z]);
    }
  }

  const lignes = [];
  const dim = liste.length ? `${E.largeur}x${E.longueur}x${E.hauteur} (x ${E.x0}..${E.x1}, y ${E.y0}..${E.y1}, z ${E.z0}..${E.z1})` : 'aucun changement';
  const ap = ex.stats.aplani ? `, aplani ${ex.stats.aplani.largeur}x${ex.stats.aplani.longueur} au plan y=${ex.stats.aplani.y}${ex.stats.dessus ? ' en ' + ex.stats.dessus : ''}` : '';
  lignes.push(`decor ${nom} : OK | emprise ${dim} | ${plus + moins} blocs changes (+${plus} -${moins}) | niveau y=${ex.ay}, sol ${smin === Infinity ? '?' : smin + '..' + smax}${ap}`);
  lignes.push('blocs : ' + (blocs.slice(0, 8).map(([n, k]) => `${NOM(n)} ${k}`).join(', ') || 'aucun') + (blocs.length > 8 ? ` (+${blocs.length - 8} autres)` : ''));
  const et = [];
  const c = lia.compte;
  if (c.escaliers) et.push(`${c.escaliers} escaliers (shape)`);
  if (c.clotures) et.push(`${c.clotures} clotures`);
  if (c.murets) et.push(`${c.murets} murets`);
  if (c.vitres) et.push(`${c.vitres} vitres/barreaux`);
  if (c.coffres) et.push(`${c.coffres} coffres doubles`);
  if (c.poudre) et.push(`${c.poudre} poudres de redstone (liaisons)`);
  if (net.plantes) et.push(`${net.plantes} plantes retirees`);
  if (net.feuilles) et.push(`${net.feuilles} feuilles sans tronc retirees`);
  const cn = [...comble.values()].reduce((s, v) => s + v, 0);
  if (cn) et.push(`${cn} cellules cachees comblees (${[...comble.entries()].map(([k, v]) => `${NOM(k).replace(/\[.*$/, '')} ${v}`).join(', ')})`);
  if (ex.stats.fondN) et.push(`fondations : ${ex.stats.fondN} colonnes, jusqu'a ${ex.stats.fondMax} blocs de profondeur`);
  lignes.push('etats : ' + (et.join(', ') || 'rien a recalculer'));
  if (portes.length) {
    lignes.push('portes : ' + portes.slice(0, 4).map((p) => `(${p.x},${p.y},${p.z}) ${p.ouverte ? 'ouverte' : 'fermee'}, ${p.devant || p.derriere ? 'BLOQUEE ' + (p.devant ? 'devant' : '') + (p.devant && p.derriere ? '+' : '') + (p.derriere ? 'derriere' : '') : 'libre des deux cotes'}`).join(' ; ') + (portes.length > 4 ? ` (+${portes.length - 4})` : ''));
  }
  const avert = [];
  if (flottants.length) { const [x, y, z] = g.xyz(flottants[0]); avert.push(`${flottants.length} bloc(s) flottant(s) (le premier en ${x},${y},${z})`); } else avert.push('0 flottant');
  for (const p of portes) {
    if (p.devant || p.derriere) avert.push(`porte (${p.x},${p.y},${p.z}) bloquee ${p.devant ? 'devant' : ''}${p.devant && p.derriere ? ' et ' : ''}${p.derriere ? 'derriere' : ''} (un bloc plein dans le passage)`);
    else if (!p.solD || !p.solR) avert.push(`porte (${p.x},${p.y},${p.z}) : pas de sol ${!p.solD && !p.solR ? 'des deux cotes' : !p.solD ? 'devant' : 'derriere'}`);
  }
  if (sansAppui.length) avert.push(`${sansAppui.length} bloc(s) sans appui dessous (torche, tapis, plante, plaque...) ; le premier en ${sansAppui[0].join(',')}`);
  if (g.agrandissements) avert.push(`zone agrandie ${g.agrandissements} fois (le decor depasse la boite de la zone)`);
  for (const a of ex.stats.avert) avert.push(a);
  if (sources) lignes.push(`lumiere : ${sources} source(s) (torches, lanternes...) ; la lumiere de blocs est calculee par le monde (scene avec decor)`);
  const notes = ex.stats.notes;
  for (const n of notes.slice(0, 4)) lignes.push(n.length > 390 ? n.slice(0, 387) + '...' : n);
  if (notes.length > 4) lignes.push(`... et ${notes.length - 4} autre(s) import(s)`);
  lignes.push('avert : ' + avert.join(' | '));
  return { emprise: E, plus, moins, blocs, sol: { y: ex.ay, min: smin, max: smax }, flottants: flottants.length, portes, sansAppui: sansAppui.length, avertissements: avert.filter((a) => a !== '0 flottant'), lignes: lignes.slice(0, 15), stats: ex.stats, cellules: liste.length };
}
