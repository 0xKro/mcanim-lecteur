// Terrain VIVANT : le monde tel qu'il est a chaque instant de la simulation (blocs poses, casses, portes ouvertes), vu par la physique des acteurs
// a pistes de cles (physique.js) et par la camera (anim.js). Le monde du rendu (rs.monde) est encore a son etat de depart pendant le calcul
// de l'animation ; on pose dessus une couche de changements ("overlay") qu'on avance et recule dans le journal du replay (anciens et nouveaux
// indices de palette : exactement reversible). Les collisions viennent des boites des donnees du jeu (collision.js), pas de hauteurs de colonnes.
import { boitesLocales, solSous, deplacerBoite } from '../moteur/collision.js';

const MARCHE = 0.6, HAUT_CORPS = 1.8, EPS = 1e-6;

export function creerTerrainVivant({ rs, replay, donnees }) {
  const base = rs.monde;
  if (!base) throw new Error('terrain vivant : le rendu n\'a pas de monde modifiable');
  const J = replay.blocs, n = replay.nbBlocs;
  const overlay = new Map();
  let curseur = 0, tickCourant = -1;
  const cle = (x, y, z) => `${x},${y},${z}`;
  const indice = (x, y, z) => { const v = overlay.get(cle(x, y, z)); return v !== undefined ? v : base.indiceEn(x, y, z); };
  const lec = { d: donnees, etatEn: (x, y, z) => base.tEtat[indice(x, y, z)] };

  // avance (ou recule) le monde jusqu'au tick du replay donne
  function allerAuTick(tick) {
    if (tick === tickCourant) return;
    const cible = replay.indiceApres(tick);
    while (curseur < cible) { const k = curseur * 6; overlay.set(cle(J[k + 1], J[k + 2], J[k + 3]), J[k + 5]); curseur++; }
    while (curseur > cible) { curseur--; const k = curseur * 6; overlay.set(cle(J[k + 1], J[k + 2], J[k + 3]), J[k + 4]); }
    tickCourant = tick;
  }

  const T = {
    vivant: true, lec, replay,
    // temps du film (secondes de monde) -> monde regle a ce moment
    regler(t) { allerAuTick(replay.tickDe(t)); },
    regle: allerAuTick,
    fin() { allerAuTick(replay.ticks); },
    nbChangements: n,
    // ---- interface de film/physique.js
    solEn: (x, z) => rs.solEn(x, z),
    eauEn: (x, z) => rs.eauEn(x, z),
    estLibre: (x, y, z) => {
      const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
      if (!rs.zone.dansZone(bx, bz)) return by > rs.zone.hauteur(bx, bz);
      const p = indice(bx, by, bz);
      return !(rs.collision[p] || rs.feuillesP[p]);
    },
    // seul un cube plein opaque bloque la camera (comme rs.estSolidePourCamera), dans le monde de l'instant
    solide: (x, y, z) => {
      const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
      if (!rs.zone.dansZone(bx, bz)) return by <= rs.zone.hauteur(bx, bz);
      return rs.solideCam[indice(bx, by, bz)] === 1;
    },
    bloc: (x, y, z) => base.palette[indice(x, y, z)],
    // Balaie la boite du joueur (0,6 x 1,8) de (x, y, z) d'un deplacement horizontal (dx, dz) ; marche de 0,6 montee comme dans le jeu.
    // Rend { bloque, x, z (derniere position libre), bloc (nom), haut (hauteur de l'obstacle au-dessus des pieds) }.
    balayer(x, y, z, dx, dz, auSol) {
      const r = deplacerBoite(lec, [x - 0.3, y, z - 0.3, x + 0.3, y + 1.8, z + 0.3], [dx, 0, dz], auSol, MARCHE);
      if (!(r.bloqueX || r.bloqueZ)) return { bloque: false };
      const L = Math.hypot(dx, dz) || 1, ax = x + r.dx + dx / L * 0.4, az = z + r.dz + dz / L * 0.4;
      let bloc = 'bloc', haut = 1;
      for (const h of [0.1, 0.7, 1.2, 1.7]) {
        const cx = Math.floor(ax), cy = Math.floor(y + h), cz = Math.floor(az), Lb = boitesLocales(lec, cx, cy, cz);
        if (Lb.length) { bloc = String(base.palette[indice(cx, cy, cz)]).replace(/^minecraft:/, '').replace(/\[.*$/, ''); haut = Math.max(...Lb.map((k) => k[4])) + cy - y; break; }
      }
      return { bloque: true, x: x + r.dx, z: z + r.dz, bloc, haut };
    },
    // Dessus du sol et obstacles au point (x, z) pour un acteur dont les pieds sont a `yr` : la boite du joueur monte une marche de 0,6 au plus ;
    // un obstacle qui coupe le corps (portes fermees, clotures de 1,5, murs) rend sa hauteur, que la physique traite comme un mur.
    solFinEn(x, z, yr) {
      if (!rs.zone.dansZone(Math.floor(x), Math.floor(z))) return null;
      let s = solSous(lec, x, z, yr, MARCHE + EPS, 80);
      const bx = Math.floor(x), bz = Math.floor(z), bas = yr + MARCHE + EPS, haut = yr + HAUT_CORPS - EPS;
      for (let y = Math.floor(bas); y <= Math.floor(haut); y++) {
        const L = boitesLocales(lec, bx, y, bz);
        for (let i = 0; i < L.length; i++) {
          const k = L[i];
          if (x + 1e-7 >= k[0] + bx && x - 1e-7 <= k[3] + bx && z + 1e-7 >= k[2] + bz && z - 1e-7 <= k[5] + bz && k[1] + y < haut && k[4] + y > bas) { const top = k[4] + y; if (s === null || top > s) s = top; }
        }
      }
      return s;
    },
  };
  return T;
}
