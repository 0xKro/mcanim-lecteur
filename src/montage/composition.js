// Composition d'une image du film : effets d'image, transition, incrustations. Branchee dans film/video.js (preparerFilm.dessiner) ;
// une scene sans plans, sans textes, sans incrustations et sans effets de camera n'en cree aucune (aucun cout, images d'avant au bit pres).
import { appliquerEffetsImage, melangerCouleur } from './effets-image.js';
import { effetsDeScene } from './effets-camera.js';
import { creerIncrustations, aIncrustations } from '../incrust/index.js';
import { creerProjecteur, transformRoulis } from '../incrust/ancrage.js';
import { notesRythme } from './rythme.js';
import { textesEnDouble, notesDoublons } from './doublons.js';

export const scenePourMontage = (scene) => effetsDeScene(scene) || aIncrustations(scene);

const RAD = Math.PI / 180;
export const FONDU_CARTE = 0.15;
const ETAGE = [0, 900, 0];   // les acteurs d'une carte sont poses tres haut : le terrain, cache par la brume, n'apparait pas

export async function creerComposition({ scene, kit, baseDir, rs = null, anim, gpu = false }) {
  if (!scenePourMontage(scene)) return null;
  const solide = rs && typeof rs.estSolidePourCamera === 'function' ? (x, y, z) => rs.estSolidePourCamera(x, y, z) : null;
  const inc = aIncrustations(scene) ? await creerIncrustations({ scene, kit, baseDir, solide }) : null;
  const notes = [...notesRythme(scene, anim.images), ...notesDoublons(textesEnDouble(scene))];   // rythme compare aux videos de reference ; textes en double (doublons.js)
  const nDepart = notes.length;
  const prof = { demandee: 0, ignoree: 0 };
  const parNom = new Map(scene.acteurs.map((a, k) => [a.nom, k]));
  return {
    inc, notes, stats: prof,
    // la profondeur du rasteriseur est utile pour la profondeur de champ (et l'occlusion fine des ancrages)
    veutProfondeur(i) { return !gpu && !!anim.images[i].champ; },
    carteA(i) { return inc?.carteA(anim.images[i].t) ?? null; },
    // Fondu du fond d'une carte : 0 -> 1 pendant ses 0,15 premieres secondes (le monde se fond dans le fond de la carte), 1 si elle a anim:'aucune'.
    // Tant qu'il est < 1, le film dessine le monde puis melange le fond par-dessus (film/video.js).
    fonduCarte(i, carte) { if (!carte || carte.anim === 'aucune') return 1; return Math.max(0, Math.min(1, (anim.images[i].t - carte.t[0]) / FONDU_CARTE)); },
    // Image d'animation d'une carte : les acteurs de la carte sont places sur l'etage ; la camera les regarde de face.
    imageCarte(carte, im) {
      const ks = carte.acteurs.map((n) => parNom.get(n));
      const p0 = im.acteurs[ks[0] ?? 0];
      const v = carte.vue;
      const dec = (p) => ({ ...p, x: p.x - p0.x + ETAGE[0], y: p.y - p0.y + ETAGE[1], z: p.z - p0.z + ETAGE[2], sol: (p.sol ?? p.y) - p0.y + ETAGE[1] });
      const acteurs = im.acteurs.map((p, k) => (ks.includes(k) ? dec(p) : p));
      // camera : en face de l'acteur (il regarde dans la direction `lacet`), tournee de vue.lacet, a `distance`, regardant sa poitrine
      const psi = (p0.lacet + v.lacet) * RAD, fx = -Math.sin(psi), fz = Math.cos(psi);
      const cible = [ETAGE[0], ETAGE[1] + v.hauteur, ETAGE[2]];
      const lx = fz, lz = -fx;   // vers la droite de l'acteur vu de face
      const pos = [cible[0] + fx * v.distance + lx * v.decalage, cible[1], cible[2] + fz * v.distance + lz * v.decalage];
      const dx = cible[0] - pos[0], dy = cible[1] - pos[1], dz = cible[2] - pos[2], h = Math.hypot(dx, dz);
      return { ...im, acteurs, camera: { x: pos[0], y: pos[1], z: pos[2], lacet: Math.atan2(-dx, dz) / RAD, tangage: Math.atan2(-dy, h) / RAD, fov: v.fov }, ks };
    },
    // Effets d'image, transition, incrustations sur `rgba` (modifie en place). prof : tampon de profondeur ou null. carte : { el, im } si une carte est a l'ecran.
    finaliser(i, rgba, W, H, profondeur = null, carte = null) {
      const im = anim.images[i];
      const faits = appliquerEffetsImage(rgba, W, H, im, profondeur);
      if (faits.includes('champ-sans-profondeur') && !prof.ignoree++) notes.push(gpu ? 'profondeurChamp : le rendu avec un vrai pack de shaders ne renvoie pas la profondeur, l\'effet est ignore' : 'profondeurChamp : pas de profondeur disponible, effet ignore');
      if (im.transition) melangerCouleur(rgba, im.transition.couleur, im.transition.alpha);
      if (inc) {
        const imUtile = carte ? carte.im : im;
        const roulis = im.roulis ? transformRoulis(im.roulis, W, H) : null;
        const proj = creerProjecteur(imUtile.camera, W, H, roulis);
        inc.dessiner(rgba, W, H, { t: im.t, im: imUtile, proj, prof: profondeur, carte: carte?.el ?? null, images: carte ? [imUtile] : anim.images, carteImage: !!carte });
      }
      return faits;
    },
    // les notes de depart (rythme, textes en double) sont deja recopiees dans les notes du film (film/video.js) : ici seulement les suivantes
    notesFinales() { return [...notes.slice(nDepart), ...(inc?.notes() ?? [])]; },
  };
}
