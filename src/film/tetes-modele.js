// Tetes (cranes) dessinees comme le jeu (SkullBlockRenderer, CustomHeadLayer) et briques de maillage des blocs dessines par du code.
// Module sans dependance (il sert au rendu des blocs, des creatures et du joueur : pas d'import qui ferait une boucle).
export const OMBRE = { haut: 1.0, bas: 0.5, nord: 0.8, sud: 0.8, ouest: 0.6, est: 0.6 };

const TETES = {
  skeleton: { tex: 'entity/skeleton/skeleton.png', tw: 64, th: 32 }, wither_skeleton: { tex: 'entity/skeleton/wither_skeleton.png', tw: 64, th: 32 },
  zombie: { tex: 'entity/zombie/zombie.png', tw: 64, th: 64, chapeau: true }, creeper: { tex: 'entity/creeper/creeper.png', tw: 64, th: 32 },
  player: { tex: 'entity/player/wide/steve.png', tw: 64, th: 64, chapeau: true }, piglin: { tex: 'entity/piglin/piglin.png', tw: 64, th: 64, large: true },
  dragon: { tex: 'entity/enderdragon/dragon.png', tw: 256, th: 256, dragon: true },
};

// tete de dragon (dragon_skull#main) : levre, crane, ecailles et narines ; machoire a part (pivot (0, 4, -8))
const DRAGON_TETE = [[[-6, -1, -24, 6, 4, -8], 176, 44], [[-8, -8, -10, 8, 8, 6], 112, 30], [[-5, -12, -4, -3, -8, 2], 0, 0], [[-5, -3, -22, -3, -1, -18], 112, 0], [[3, -12, -4, 5, -8, 2], 0, 0], [[3, -3, -22, 5, -1, -18], 112, 0]];
// oreilles et groin du piglin (PiglinHeadModel : groin (31,1) 4x4x1 et (2,4)/(2,0) 2x2x1 ; oreilles (51,6)/(39,6) 1x5x4) : notre repere, avant = +z
const PIGLIN_OREILLES = [[[-2, 0, 4, 2, 4, 5], 31, 1], [[2, 0, 4, 3, 2, 5], 2, 4], [[-3, 0, 4, -2, 2, 5], 2, 0], [[5, 2, -2, 6, 7, 2], 51, 6], [[-6, 2, -2, -5, 7, 2], 39, 6]];

// faces d'une boite (pixels, avant = +z), depliage standard du jeu (u, v) ; dims : dimensions de la boite pour les uv (par defaut celles de b)
export function facesBoite(b, u, v, TW, TH, dims = null) {
  const [x0, y0, z0, x1, y1, z1] = b, [w, h, d] = dims ?? [x1 - x0, y1 - y0, z1 - z0];
  const F = (nom, coins, a, c, e, f) => ({ nom, coins, uv: [[a, c], [e, c], [e, f], [a, f]].map(([s, t]) => [s / TW, t / TH]) });
  return [
    F('sud', [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]], u + d, v + d, u + d + w, v + d + h),
    F('nord', [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]], u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h),
    F('ouest', [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]], u, v + d, u + d, v + d + h),
    F('est', [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]], u + d + w, v + d, u + 2 * d + w, v + d + h),
    F('haut', [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], u + d, v, u + d + w, v + d),
    F('bas', [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], u + d + w, v, u + d + 2 * w, v + d),
  ];
}
export function facesModele(b, u, v, TW, TH) {
  const [x0, y0, z0, x1, y1, z1] = b, w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const F = (nom, coins, a, c, e, f) => ({ nom, coins, uv: [[a, c], [e, c], [e, f], [a, f]].map(([s2, t2]) => [s2 / TW, t2 / TH]) });
  // repere du modele : -z = avant (face (u+d, v+d)), y vers le bas (haut du depliage = dessous du modele)
  return [
    F('nord', [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], u + d, v + d, u + d + w, v + d + h),
    F('sud', [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h),
    F('ouest', [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], u, v + d, u + d, v + d + h),            // cote droit de la creature (-x)
    F('est', [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], u + d + w, v + d, u + 2 * d + w, v + d + h),
    F('haut', [[x1, y0, z1], [x0, y0, z1], [x0, y0, z0], [x1, y0, z0]], u + d, v, u + d + w, v + d),
    F('bas', [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], u + d + w, v, u + d + 2 * w, v + d),
  ];
}
export function maillage(faces, versMonde, L, texture, nom, ombre = true) {
  const pos = [], uv = [], col = [], idx = [];
  for (const F of faces) {
    const b = pos.length / 3;
    for (let k = 0; k < 4; k++) { pos.push(...versMonde(F.coins[k])); uv.push(F.uv[k][0], F.uv[k][1]); const o = (ombre ? OMBRE[F.nom] ?? 1 : 1) * L; col.push(o, o, o); }
    idx.push(b, b + 3, b + 2, b, b + 2, b + 1);
  }
  return { positions: Float32Array.from(pos), uvs: Float32Array.from(uv), couleurs: Float32Array.from(col), indices: Uint32Array.from(idx), texture, mode: 'decoupe', deuxFaces: true, genre: 'bloc', bloc: nom };
}



// Tete (SkullBlockRenderer.renderSkull) dans le repere d'un bloc (0..1) : `place(p)` -> monde (bloc pose : decalage ; tete portee : matrice du
// CustomHeadLayer). type : skeleton, wither_skeleton, zombie, creeper, player, piglin, dragon ; au sol : rotation 0..15 ; au mur : facing.
export function maillagesTete(type, { mur = false, rotation = 0, facing = 'south', alimente = false, u = 0, texture, L = 1, nom = type, place }) {
  const T = TETES[type];
  if (!T || !texture) return [];
  const a = rotation * Math.PI / 8;
  const [fx, fz] = mur ? DIRV[facing] ?? [0, 1] : [Math.round(Math.sin(a) * 1e6) / 1e6, Math.round(-Math.cos(a) * 1e6) / 1e6];
  const cx = mur ? 0.5 - fx * 0.25 : 0.5, cy = mur ? 0.25 : 0, cz = mur ? 0.5 - fz * 0.25 : 0.5;
  const R = tourner(fx, fz), out = [];
  if (T.dragon) {
    // DragonHeadModel (entity-models.json du jeu : dragon_skull) : tete decalee de -5,99, echelle 0,75 ; machoire pivot (0, 4, -8), ouverte de
    // (sin(t x pi x 0,2) + 1) x 0,2 radian (t : ticks d'animation, qui ne courent que si la tete est alimentee) ; repere du modele : y vers le bas,
    // avant = -z ; vers notre repere (y en haut, avant = +z) : (x, -y, -z)
    const ouv = (Math.sin((alimente ? u : 0) * Math.PI * 0.2) + 1) * 0.2, co = Math.cos(ouv), so = Math.sin(ouv);
    const vm = (jaw) => (q) => {
      let [x, y, z] = q;
      if (jaw) { const yy = y * co - z * so, zz = y * so + z * co; y = yy + 4; z = zz - 8; }
      const r = R([x * 0.75 / 16, -(-5.99 + y * 0.75) / 16, -(z * 0.75) / 16]);
      return place([cx + r[0], cy + r[1], cz + r[2]]);
    };
    for (const [b, uu, vv] of DRAGON_TETE) out.push(maillage(facesModele(b, uu, vv, T.tw, T.th), vm(false), L, texture, 'dragon_head'));
    out.push(maillage(facesModele([-6, 0, -16, 6, 4, 0], 176, 65, T.tw, T.th), vm(true), L, texture, 'dragon_head'));
    return out;
  }
  const vm = (q) => { const r = R([q[0] / 16, q[1] / 16, q[2] / 16]); return place([cx + r[0], cy + r[1], cz + r[2]]); };
  out.push(maillage(facesBoite(T.large ? [-5, 0, -4, 5, 8, 4] : [-4, 0, -4, 4, 8, 4], 0, 0, T.tw, T.th), vm, L, texture, nom));
  if (T.chapeau) out.push(maillage(facesBoite([-4.25, -0.25, -4.25, 4.25, 8.25, 4.25], 32, 0, T.tw, T.th, [8, 8, 8]), vm, L, texture, nom));
  if (T.large) for (const [b, uu, vv] of PIGLIN_OREILLES) out.push(maillage(facesBoite(b, uu, vv, T.tw, T.th), vm, L, texture, nom));
  return out;
}
export const TETE_DE_OBJET = { skeleton_skull: 'skeleton', wither_skeleton_skull: 'wither_skeleton', zombie_head: 'zombie', creeper_head: 'creeper', player_head: 'player', piglin_head: 'piglin', dragon_head: 'dragon' };
export { TETES, DRAGON_TETE, PIGLIN_OREILLES };

// DefaultPlayerSkin.get(uuid) : un des 18 skins par defaut (9 fins puis 9 larges), indice floorMod(uuid.hashCode(), 18) ;
// UUID.hashCode = xor des quatre entiers de 32 bits. uuid : 32 chiffres hexadecimaux. Rend { nom, modele }.
const SKINS_DEFAUT = ['alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'steve', 'sunny', 'zuri'];
export function skinParDefautUUID(uuid) {
  const h = String(uuid).replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(h)) return { nom: 'steve', modele: 'wide' };
  let x = 0; for (let i = 0; i < 4; i++) x ^= parseInt(h.slice(i * 8, i * 8 + 8), 16) | 0;
  const k = ((x % 18) + 18) % 18;
  return { nom: SKINS_DEFAUT[k % 9], modele: k < 9 ? 'slim' : 'wide' };
}


// (lx, lz) du repere ou l'avant est +z -> monde, pour une direction d'avant (fx, fz)
export const tourner = (fx, fz) => (p) => [p[0] * fz + p[2] * fx, p[1], -p[0] * fx + p[2] * fz];
const dirRotation = (r) => { const a = r * Math.PI / 8; return [Math.round(-Math.sin(a) * 1e6) / 1e6, Math.round(Math.cos(a) * 1e6) / 1e6]; };
export const DIRV = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

