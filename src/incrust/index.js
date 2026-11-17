// Incrustations : legendes (textes, sousTitres) et graphismes poses sur les images du film (tout ce qui n'est pas du terrain ni des acteurs).
// Appel : const inc = await creerIncrustations({ scene, kit, baseDir, solide }) ; inc.dessiner(film, W, H, { t, im, proj, prof }).
import { chargerPolice, chargerPoliceSans } from './police.js';
import { dessinerElement } from './elements.js';
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
      let n = 0;
      for (const e of liste) if (t >= e.t[0] && t < e.t[1]) { if (dessinerElement(film, ctx, e)) n++; }
      return n;
    },
    notes() { const n = []; const m = police.noteManquants(); if (m) n.push(m); for (const v of notesZone.values()) n.push(v);
      if (manquants.size) n.push(`objets sans icone (damier) : ${[...manquants].join(', ')}`); return n; },
  };
}
