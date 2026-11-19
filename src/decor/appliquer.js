// Application d'un ou plusieurs decors sur une zone : tout ou rien. La zone d'origine n'est jamais modifiee ; on rend une NOUVELLE zone
// (cellules, palette, hauteurs recalculees), lue ensuite par le moteur, le maillage et la physique comme une zone ordinaire.
import fs from 'node:fs';
import path from 'node:path';
import { Grille, ErreurDecor, LIMITES } from './grille.js';
import { Classes } from './etats.js';
import { lireDecor, lireDecorTexte } from './lire.js';
import { Exec } from './ops.js';
import { passeLiaisons, passeNettoyage, passeDevoilement, passeBulles } from './liaisons.js';
import { rapportDecor } from './rapport.js';

// Entrees de `scene.decor` (chemins relatifs a la scene, ou objets en ligne) -> decors lus et controles.
// Toutes les erreurs de tous les decors sont rassemblees avant de refuser.
export function lireDecorsScene(entrees, { baseDir = process.cwd(), d, zoneId = null } = {}) {
  const sortie = [], erreurs = [];
  let total = 0;
  (entrees || []).forEach((e, i) => {
    const nom = typeof e === 'string' ? e : `decor[${i}] (en ligne)`;
    try {
      let decor;
      if (typeof e === 'string') {
        const f = path.resolve(baseDir, e);
        if (!fs.existsSync(f)) throw new ErreurDecor([`decor[${i}] : fichier introuvable : ${e} (chemin relatif au fichier de scene)`]);
        const texte = fs.readFileSync(f, 'utf8');
        total += Buffer.byteLength(texte);
        decor = lireDecorTexte(texte, d, e, { baseDir: path.dirname(f) });
      } else decor = lireDecor(e, d, nom, { baseDir });
      if (decor.zone && zoneId && decor.zone !== zoneId) throw new ErreurDecor([`${nom} : zone "${decor.zone}" differente de celle de la scene ("${zoneId}") : un decor ne sert que sur sa zone`]);
      sortie.push({ decor, nom });
    } catch (err) {
      if (err instanceof ErreurDecor) erreurs.push(...err.lignes); else throw err;
    }
  });
  if (total > LIMITES.octetsTotal) erreurs.push(`decors : ${total} octets au total (maximum ${LIMITES.octetsTotal})`);
  if (erreurs.length) throw new ErreurDecor(erreurs);
  return sortie;
}

// Applique des decors lus (liste de { decor, nom }) a une zone. Rend { zone, rapports: [{ nom, ... , lignes }], ms }.
export function appliquerDecors(zone, decors, { donnees: d, cls = new Classes(d), classesRapport = true } = {}) {
  const t0 = performance.now();
  if (decors.length > LIMITES.decors) throw new ErreurDecor([`${decors.length} decors (maximum ${LIMITES.decors} par scene)`]);
  const g = new Grille(zone, d);
  const rapports = [], bannieres = [], entites = { panneaux: [], pots: [], contenus: [], pupitres: [], cadres: [], tetes: [], cages: [], objetsPoses: [], tableaux: [], noeuds: [], coussins: [], acteurs: [] };
  for (const { decor, nom } of decors) {
    g.debut();
    const t1 = performance.now();
    let ex;
    try {
      ex = new Exec(g, d, decor, cls);
      for (const op of decor.ops) ex.executer(op);
      // finalisation : nettoyage, liaisons, cellules cachees, hauteurs
      const net = passeNettoyage(g, d, cls, g.differences());
      const lia = passeLiaisons(g, d, cls, g.differences());
      lia.bulles = passeBulles(g, d, g.differences());   // eau sur sable des ames / magma : colonne de bulles (BubbleColumnBlock)
      const diffDecor = g.differences();
      const comble = passeDevoilement(g, d, cls, diffDecor);
      g.recalculerHauteurs();
      const diff = diffDecor;
      const l = limitesEmprise(g, diffDecor);
      if (l.largeur > LIMITES.largeur || l.longueur > LIMITES.largeur || l.hauteur > LIMITES.hauteur) {
        throw new ErreurDecor([`${nom} : emprise ${l.largeur} x ${l.longueur} x ${l.hauteur} trop grande (maximum ${LIMITES.largeur} x ${LIMITES.largeur} x ${LIMITES.hauteur} : coupe en plusieurs decors)`]);
      }
      bannieres.push(...ex.stats.bannieres);
      for (const k of Object.keys(entites)) entites[k].push(...ex.stats.blocsEntites[k]);
      if (classesRapport) rapports.push({ nom, ...rapportDecor({ g, d, cls, ex, decor, diff, net, lia, comble, nom, emprise: l }), ms: performance.now() - t1 });
    } catch (e) {
      if (e instanceof ErreurDecor) throw new ErreurDecor(e.lignes.map((m) => (m.startsWith(nom) ? m : `${nom} : ${m}`)), nom);
      throw e;
    }
  }
  // bannieres importees (motifs) : seulement celles dont le bloc est encore une banniere a la fin
  const z = g.versZone();
  const bloc = (x, y, zz) => z.palette[z.paletteEn(x, y, zz)] ?? '';
  const restent = bannieres.filter(([x, y, zz]) => /_banner(\[|$)/.test(bloc(x, y, zz)));
  // donnees des blocs importes : gardees si le bloc est encore le bon a la fin (un decor suivant a pu le remplacer) ; derniere ecriture gagnante
  const dernier = (l, cle) => [...new Map(l.map((e) => [cle(e), e])).values()];
  const pos = (e) => (Array.isArray(e) ? `${e[0]},${e[1]},${e[2]}` : `${e.x},${e.y},${e.z}`);
  const blocsEntites = {
    panneaux: dernier(entites.panneaux.filter((e) => /_sign(\[|$)/.test(bloc(e.x, e.y, e.z))), pos),
    pots: dernier(entites.pots.filter((e) => /^minecraft:decorated_pot(\[|$)/.test(bloc(e.x, e.y, e.z))), pos),
    contenus: entites.contenus.filter((e) => !/^minecraft:(air|cave_air)$/.test(bloc(e[0], e[1], e[2]).replace(/\[.*$/, ''))),
    pupitres: dernier(entites.pupitres.filter((e) => /^minecraft:lectern\[.*has_book=true/.test(bloc(e[0], e[1], e[2]))), pos),
    cadres: dernier(entites.cadres.filter((e) => !/^minecraft:/.test(bloc(e[0], e[1], e[2])) || /^minecraft:(air|cave_air|water)(\[|$)/.test(bloc(e[0], e[1], e[2]))), pos),
    tetes: dernier(entites.tetes.filter((e) => /^minecraft:player_(wall_)?head(\[|$)/.test(bloc(e.x, e.y, e.z))), pos),
    cages: dernier(entites.cages.filter((e) => /^minecraft:(spawner|trial_spawner)(\[|$)/.test(bloc(e.x, e.y, e.z))), pos),
    objetsPoses: entites.objetsPoses.filter((e) => /^minecraft:(vault|campfire|soul_campfire)(\[|$)/.test(bloc(e.x, e.y, e.z))),
    tableaux: dernier(entites.tableaux, pos), noeuds: dernier(entites.noeuds.filter((e) => /_fence(\[|$)/.test(bloc(e.x, e.y, e.z))), pos),
    coussins: entites.coussins, acteurs: entites.acteurs,
  };
  return { zone: z, rapports, ms: performance.now() - t0, agrandissements: g.agrandissements, bannieres: restent, blocsEntites };
}

function limitesEmprise(g, indices) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const sxz = g.sx * g.sz;
  for (const i of indices) { const ly = Math.floor(i / sxz), r = i - ly * sxz, lz = Math.floor(r / g.sx), x = r - lz * g.sx + g.x0, y = ly + g.y0, z = lz + g.z0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  if (!indices.length) return { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0, largeur: 0, longueur: 0, hauteur: 0 };
  return { x0, x1, y0, y1, z0, z1, largeur: x1 - x0 + 1, longueur: z1 - z0 + 1, hauteur: y1 - y0 + 1 };
}
export { limitesEmprise };
