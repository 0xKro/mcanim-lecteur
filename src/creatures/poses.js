// Port de Horizon (client/mobs/anim.rs, model.rs, MIT), voir ATTRIBUTIONS.md
// Poses des parties d'un modele de creature pour un dessin : par nom de partie, un tableau de 9 nombres
// [x, y, z, rotX, rotY, rotZ, echX, echY, echZ] (pixels, radians, Y vers le bas), copie de la pose de repos.
// Regles de nommage (Part::parse, createPartLookup) :
//  - les enfants sont parcourus tries par nom ;
//  - une racine "root" qui a un enfant "root" perd son nom (nom vide) : l'enfant est "root" ;
//  - le premier nom rencontre garde la pose (putIfAbsent).

const NEUTRE = [0, 0, 0, 0, 0, 0, 1, 1, 1];

function poseBase(p) {
  const r = NEUTRE.slice();
  if (p) for (let i = 0; i < 9 && i < p.length; i++) r[i] = p[i];
  return r;
}

// Parcours d'un arbre compact { p?, q?, c? } : appelle f(nom, partie) dans l'ordre de Horizon.
function parcourir(part, nom, f) {
  const enfants = part.c ? Object.keys(part.c).sort() : [];
  const n = nom === 'root' && enfants.includes('root') ? '' : nom;
  f(n, part);
  for (const e of enfants) parcourir(part.c[e], e, f);
}

// Noms des parties (sans doublon, dans l'ordre d'enregistrement ; la racine sans nom est omise).
export function nomsParties(racine) {
  const vus = new Set();
  parcourir(racine, 'root', (n) => { if (n !== '') vus.add(n); });
  return [...vus];
}

export class Poses {
  constructor(racine) {
    this.map = new Map();
    this.caches = new Set();
    this.sautes = new Set();
    if (racine) parcourir(racine, 'root', (n, p) => { if (!this.map.has(n)) this.map.set(n, poseBase(p.p)); });
  }
  // Tableau modifiable ; une partie inconnue donne un tableau jetable.
  get(nom) { return this.map.get(nom) ?? NEUTRE.slice(); }
  has(nom) { return this.map.has(nom); }
  // Lecture sans modification ; null si inconnue (ne pas modifier le tableau rendu).
  pose(nom) { return this.map.get(nom) ?? null; }
  xrot(nom, v) { this.get(nom)[3] = v; }
  yrot(nom, v) { this.get(nom)[4] = v; }
  zrot(nom, v) { this.get(nom)[5] = v; }
  // ModelPart.visible : une partie cachee ne dessine ni elle ni ses enfants.
  visible(nom, v) { if (v) this.caches.delete(nom); else if (this.map.has(nom)) this.caches.add(nom); }
  cache(nom) { return this.caches.has(nom); }
  // ModelPart.skipDraw : ses propres cubes ne sont pas dessines, ses enfants si.
  sauter(nom) { this.sautes.add(nom); }
  saute(nom) { return this.sautes.has(nom); }
}
