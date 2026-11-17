// Incrustations : legendes (textes, sousTitres) et graphismes poses sur les images du film (tout ce qui n'est pas du terrain ni des acteurs).
// Appel : const inc = await creerIncrustations({ scene, kit, baseDir, solide }) ; inc.dessiner(film, W, H, { t, im, proj, prof }).
import { chargerPolice, chargerPoliceSans } from './police.js';
import { preparerElement } from './elements.js';
import { disposer } from './disposition.js';
import { creerProjecteur, transformRoulis } from './ancrage.js';
import { rectSur } from '../montage/zones.js';

// Y a-t-il quelque chose a dessiner dans cette scene ?
export const aIncrustations = (scene) => !!(scene.textes?.length || scene.incrustations?.length);

export async function creerIncrustations({ scene, kit, baseDir = process.cwd(), solide = null }) {
  const police = await chargerPolice(kit);
  const policeSans = await chargerPoliceSans(kit);   // police des legendes (gras rond, fournie avec le lecteur)
  const tous = [...(scene.textes ?? []), ...(scene.incrustations ?? [])];
  tous.forEach((e, i) => { e._seq = i; });
  const cartes = tous.filter((e) => e.type === 'carte');
  const enfants = new Set();
  // carte : le fond d'abord, puis le contenu, un element apres l'autre (0,1 s d'ecart, sauf retard donne)
  for (const c of cartes) c.incrustations.forEach((e, k) => { enfants.add(e); e._carte = c; e._seq = 100000 + (e.ordre ?? k); e._delaiAuto = 0.1 + 0.1 * k; });
  const libres = tous.filter((e) => e.type !== 'carte' && !enfants.has(e));
  const tri = (l) => l.slice().sort((a, b) => a.calque - b.calque || a._seq - b._seq);
  const libresTries = tri(libres);
  const manquants = new Set();
  const notesZone = new Map();
  const memoDispo = new Map();    // disposition : decision gardee par element jusqu'a la coupe suivante (disposition.js)
  const cacheEvite = new Map();   // legendes : emplacement choisi par plan (montage/evitement.js)
  return {
    police, policeSans, cartes,
    // carte plein cadre active a l'instant t (la derniere declaree si elles se chevauchent) ou null
    carteA(t) { let r = null; for (const c of cartes) if (t >= c.t[0] && t < c.t[1]) r = c; return r; },
    // Dessine tout ce qui est visible a l'instant t. Pendant une carte : ses incrustations et les elements ancres a l'ecran seulement.
    //   im : image d'animation (camera, acteurs) ; proj : projecteur ; prof : profondeur { donnees, W, H, ssaa } ou null ; carte : carte active.
    dessiner(film, W, H, { t, im, proj = null, prof = null, carte = null, roulis = null, images = null, carteImage = false }) {
      const U = Math.min(W, H);
      const ctx = { kit, police, policeSans, images, carteImage, cacheEvite, W, H, U, t, im, scene, zone: rectSur(scene.zonesSures, W, H), notes: notesZone, anim: null, proj: proj ?? creerProjecteur(im.camera, W, H, roulis ? transformRoulis(roulis, W, H) : null), solide, prof, baseDir, manquants };
      const liste = carte ? tri([...libresTries.filter((e) => e.monde === undefined && e.acteur === undefined && e.type !== 'fleche' && e.type !== 'ligne'), ...carte.incrustations]) : libresTries;
      // 1. on prepare tout ce qui est visible, 2. la disposition decale ou cache ce qui se recouvre, 3. on dessine dans l'ordre des calques
      const prets = [];
      for (const e of liste) if (t >= e.t[0] && t < e.t[1]) { const p = preparerElement(film, ctx, e); if (p) prets.push(p); }
      const items = prets.filter((p) => p.box).map((p) => ({ id: p.el._seq, prio: p.prio, fixe: p.fixe, box: p.box, maxDep: p.maxDep, force: p.force, ordre: p.el._seq }));
      const plan = carte ? null : scene.plans?.find((q) => t >= q.de && t < q.a);
      const Z = ctx.zone.actif ? ctx.zone : { x0: 0, y0: 0, x1: W, y1: H };
      const place = items.length > 1 ? disposer(items, { zone: Z, memo: memoDispo, cle: carte ? 'carte' + carte.t[0] : plan ? 'p' + plan.de : 'sans-plan', marge: 0.006 * U }) : null;
      let n = 0;
      for (const p of prets) {
        const r = place?.get(p.el._seq);
        if (r?.cache) { noterDispo(notesZone, p.el, 'cache', r.cause, tous, t); continue; }
        if (r && (r.dx || r.dy)) noterDispo(notesZone, p.el, 'deplace', r.cause, tous, t);
        p.peindre(r?.dx ?? 0, r?.dy ?? 0); n++;
      }
      return n;
    },
    notes() { const n = []; const m = police.noteManquants(); if (m) n.push(m); const ms = policeSans !== police ? policeSans.noteManquants() : null; if (ms && ms !== m) n.push(ms); for (const v of notesZone.values()) n.push(v);
      if (manquants.size) n.push(`objets sans icone (damier) : ${[...manquants].join(', ')}`); return n; },
  };
}

// Une note par element decale ou cache par la disposition.
function noterDispo(notes, el, quoi, cause, tous, t) {
  const cle = `dispo#${el._seq}`;   // une seule note par element (la premiere decision)
  if (notes.has(cle)) return;
  const nom = (e) => `${e.type}${e.texte ? ` "${String(e.texte).slice(0, 18)}"` : e.acteur ? ` "${e.acteur}"` : ''}`;
  const g = tous.find((e) => e._seq === cause);
  notes.set(cle, `${nom(el)} a t=${Math.round(t * 10) / 10} s : ${quoi === 'cache' ? 'masque' : 'decale'} pour ne pas recouvrir ${g ? nom(g) : 'une autre incrustation'}${quoi === 'cache' ? ' (pas de place libre dans la zone sure)' : ''}`);
}
