// Disposition des incrustations d'une image : chaque element visible a une boite a l'ecran ; deux boites ne doivent pas se recouvrir.
// Par priorite (la plus forte d'abord) : legendes (0) > textes d'ecran (1) > compteurs, icones, panneaux (2) > libelles du monde (3) > noms (4).
// Un element de priorite plus faible qui en touche un plus fort est DEPLACE le long de son axe permis (vertical par defaut), dans la zone sure,
// ou CACHE s'il n'y a pas de place. Les elements `fixe` (legendes, HUD) ne bougent jamais : ils servent d'obstacles.
// Stabilite dans le temps : la decision d'un element (decalage ou cache) est GARDEE tant que le plan est le meme, que les elements plus forts
// presents sont les memes et que la place gardee reste libre. Elle est refaite seulement a une coupe (autre plan) ou quand l'un de ces trois points change :
// pas de tremblement d'une image a l'autre.
//
// Visages : les elements non fixes qui ont `evAct` (1 = evite les tetes, 2 = tetes et torses) evitent aussi les boites ecran des acteurs (options.obstacles, voir acteurs-evites.js).
// Si aucune place n'evite le torse, on essaie sans le torse ; si aucune place n'evite la tete, on garde seulement l'evitement des autres incrustations (jamais masque pour un visage).
// Ecart : `gap` (pixels) = distance minimale voulue entre cet element et un autre (le plus grand des deux gagne), pour le rythme vertical des textes d'ecran empiles.
//
// Entree : items [{ id, prio, box: {x, y, w, h}, fixe?, axe? ('v' | 'h' | 'vh'), maxDep? (pixels), force? (plus grand = garde sa place), ordre?, evAct? (0 | 1 | 2), gap? }]
//          options { zone: {x0,y0,x1,y1} | null, memo: Map, cle (identifiant du plan), marge (pixels), obstacles: { tetes: [{nom,x,y,w,h}], torses: [...] } | null }
// Sortie : Map id -> { dx, dy, cache: bool, cause? (id de l'element qui gene) }
const touche = (a, b, m) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

function chercher(it, boite, places, zone, mg, avant = null) {
  const axes = (it.axe ?? 'v').split('');
  const max = it.maxDep ?? Infinity;
  const dedans = (b) => !zone || (b.x >= zone.x0 - 0.5 && b.y >= zone.y0 - 0.5 && b.x + b.w <= zone.x1 + 0.5 && b.y + b.h <= zone.y1 + 0.5);
  let meilleur = null;
  for (const axe of axes) for (const sens of [-1, 1]) {
    let d = 0, ok = false;
    for (let tour = 0; tour < 12; tour++) {
      const b = axe === 'v' ? { ...boite, y: boite.y + d } : { ...boite, x: boite.x + d };
      const gens = places.filter((p) => touche(b, p.box, mg(p)));
      if (!gens.length) { ok = dedans(b) && Math.abs(d) <= max + 1e-6; break; }
      // on franchit le bord le plus lointain des boites qui gênent, dans le sens choisi
      if (axe === 'v') d = sens < 0 ? Math.min(...gens.map((p) => p.box.y - mg(p) - boite.h)) : Math.max(...gens.map((p) => p.box.y + p.box.h + mg(p)));
      else d = sens < 0 ? Math.min(...gens.map((p) => p.box.x - mg(p) - boite.w)) : Math.max(...gens.map((p) => p.box.x + p.box.w + mg(p)));
      d -= axe === 'v' ? boite.y : boite.x;
      if (Math.abs(d) > max + 1e-6) break;
    }
    if (!ok) continue;
    // hysteresis : on garde le cote de la decision precedente (un nom ne saute pas de dessus a dessous quand l'acteur bouge)
    const memeCote = avant && avant.axe === axe && Math.sign(avant.d) === Math.sign(d);
    if (!meilleur || (memeCote && !meilleur.memeCote) || (memeCote === meilleur.memeCote && Math.abs(d) < Math.abs(meilleur.d) - 1e-6)) meilleur = { axe, d, memeCote };
  }
  return meilleur;
}

export function disposer(items, { zone = null, memo = new Map(), cle = '', marge = 0, obstacles = null } = {}) {
  const ordre = items.slice().sort((a, b) => (b.fixe ? 1 : 0) - (a.fixe ? 1 : 0) || a.prio - b.prio || (b.force ?? 0) - (a.force ?? 0) || (a.ordre ?? 0) - (b.ordre ?? 0) || (String(a.id) < String(b.id) ? -1 : 1));
  const places = [], res = new Map();
  const vus = [];   // ids deja traites (= plus forts ou egaux et passes avant)
  const visages = (niv) => (obstacles && niv >= 1 ? [...(obstacles.tetes ?? []).map((o) => ({ id: `acteur:${o.nom}`, box: { x: o.x, y: o.y, w: o.w, h: o.h }, visage: true })), ...(niv >= 2 ? (obstacles.torses ?? []).map((o) => ({ id: `acteur:${o.nom}`, box: { x: o.x, y: o.y, w: o.w, h: o.h }, visage: true })) : [])] : []);
  for (const it of ordre) {
    const sig = vus.join('|');
    vus.push(it.id);
    if (it.fixe) { res.set(it.id, { dx: 0, dy: 0, cache: false }); places.push({ id: it.id, box: it.box, gap: it.gap }); continue; }
    const mg = (p) => Math.max(marge, it.gap ?? 0, p.gap ?? 0);
    const niveaux = it.evAct && obstacles ? [it.evAct, Math.min(1, it.evAct), 0] : [0];   // du plus strict au plus lache
    const bl = (niv) => (niv ? places.concat(visages(niv)) : places);
    const m = memo.get(it.id);
    let d = null;
    if (m && m.cle === cle && m.sig === sig) {
      if (m.cache) d = m;
      else {
        const b = { ...it.box, x: it.box.x + m.dx, y: it.box.y + m.dy };
        if (!bl(m.niv ?? 0).some((p) => touche(b, p.box, mg(p)))) d = m;   // la place gardee est toujours libre
      }
    }
    if (!d) {
      const avant = m && !m.cache && (m.dx || m.dy) ? { axe: m.dx ? 'h' : 'v', d: m.dx || m.dy } : null;
      for (const niv of niveaux) {
        const liste = bl(niv);
        const gene = liste.find((p) => touche(it.box, p.box, mg(p)));
        if (!gene) { d = { dx: 0, dy: 0, cache: false, niv }; break; }
        // contre un visage on cherche dans les deux axes (le deplacement le plus court) ; contre une autre incrustation, l'axe de l'element
        const axe = gene.visage ? 'vh' : (it.axe ?? 'v');
        const r = chercher({ ...it, axe }, it.box, liste, zone, mg, avant);
        if (r) { d = { dx: r.axe === 'h' ? r.d : 0, dy: r.axe === 'v' ? r.d : 0, cache: false, cause: gene.id, niv }; break; }
        if (niv === 0) d = { dx: 0, dy: 0, cache: true, cause: gene.id, niv };
      }
      d = { ...d, cle, sig };
    }
    memo.set(it.id, d);
    res.set(it.id, { dx: d.dx, dy: d.dy, cache: d.cache, cause: d.cause, niv: d.niv });
    if (!d.cache) places.push({ id: it.id, box: { ...it.box, x: it.box.x + d.dx, y: it.box.y + d.dy }, gap: it.gap });
  }
  return res;
}
