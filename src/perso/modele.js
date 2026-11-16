// Modele du joueur (wide / slim) : boites, pivots, UV, pose -> maillage pour le rendu.
// Geometrie et chaine de matrices : Horizon (preview.rs, render.rs, anim.rs ; MIT), voir ATTRIBUTIONS.md.
//
// Repere du modele : pixels de modele (1/16 de bloc), Y vers le BAS, l'avant du joueur est -Z.
// Chaine vers le monde (blocs), voir `versMonde` : decalage (0, -1,501, 0), echelle 0,9375,
// symetrie (-1,-1,1), rotation autour de Y de (180 - lacet) degres, puis position des pieds.

const RAD = Math.PI / 180;
export const ECHELLE = 0.9375;
export const DECALAGE_Y = -1.501;     // blocs, avant l'echelle
export const BAISSE_ACCROUPI = 0.125; // blocs : le modele descend quand on est accroupi

// Ombrage de face (comme les blocs) : haut 1,0 ; bas 0,5 ; nord/sud 0,8 ; ouest/est 0,6.
const OMBRE_HAUT = 1.0, OMBRE_BAS = 0.5, OMBRE_NS = 0.8, OMBRE_OE = 0.6;

// Les 6 parties. g = gonflement de la couche externe (chapeau 0,5 ; reste 0,25).
export function definirParties(slim) {
  const bras = slim ? { l: 3, y: 2.5, xD: -2 } : { l: 4, y: 2, xD: -3 };
  return [
    { nom: 'tete', pivot: [0, 0, 0], orig: [-4, -8, -4], taille: [8, 8, 8], uv: [0, 0], ext: { uv: [32, 0], g: 0.5 } },
    { nom: 'corps', pivot: [0, 0, 0], orig: [-4, 0, -2], taille: [8, 12, 4], uv: [16, 16], ext: { uv: [16, 32], g: 0.25 } },
    { nom: 'brasD', pivot: [-5, bras.y, 0], orig: [bras.xD, -2, -2], taille: [bras.l, 12, 4], uv: [40, 16], ext: { uv: [40, 32], g: 0.25 } },
    { nom: 'brasG', pivot: [5, bras.y, 0], orig: [-1, -2, -2], taille: [bras.l, 12, 4], uv: [32, 48], ext: { uv: [48, 48], g: 0.25 } },
    { nom: 'jambeD', pivot: [-1.9, 12, 0], orig: [-2, 0, -2], taille: [4, 12, 4], uv: [0, 16], ext: { uv: [0, 32], g: 0.25 } },
    { nom: 'jambeG', pivot: [1.9, 12, 0], orig: [-2, 0, -2], taille: [4, 12, 4], uv: [16, 48], ext: { uv: [0, 48], g: 0.25 } },
  ];
}

// Faces d'une boite : coin haut-gauche de l'image (O), sens de u (U) et de v (V) sur la face, normale sortante (N),
// rectangle de texture [u0, v0, u1, v1] en pixels. (w, h, d) = largeur, hauteur, profondeur SANS gonflement.
// min/max = coins de la boite (gonflee). Voir analyse/3-personnages.md partie 2.1.
export function facesBoite([u, v], [w, h, d], min, max) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const u1 = u + d, u2 = u + d + w, u3 = u + d + w + d, u4 = u + d + w + d + w, v1 = v + d, v2 = v + d + h;
  return [
    { nom: 'avant', O: [x0, y0, z0], U: [1, 0, 0], V: [0, 1, 0], N: [0, 0, -1], rect: [u1, v1, u2, v2] },
    { nom: 'arriere', O: [x1, y0, z1], U: [-1, 0, 0], V: [0, 1, 0], N: [0, 0, 1], rect: [u3, v1, u4, v2] },
    { nom: 'gauche', O: [x1, y0, z0], U: [0, 0, 1], V: [0, 1, 0], N: [1, 0, 0], rect: [u2, v1, u3, v2] },   // cote +X = gauche du joueur
    { nom: 'droite', O: [x0, y0, z1], U: [0, 0, -1], V: [0, 1, 0], N: [-1, 0, 0], rect: [u, v1, u1, v2] }, // cote -X = droite du joueur
    { nom: 'dessus', O: [x0, y0, z1], U: [1, 0, 0], V: [0, 0, -1], N: [0, -1, 0], rect: [u1, v, u2, v1] },
    { nom: 'dessous', O: [x0, y1, z0], U: [1, 0, 0], V: [0, 0, 1], N: [0, 1, 0], rect: [u2, v, u2 + w, v1] },
  ];
}

const TAILLE_FACE = (f, [x0, y0, z0], [x1, y1, z1]) => [Math.abs(f.U[0] * (x1 - x0)) + Math.abs(f.U[1] * (y1 - y0)) + Math.abs(f.U[2] * (z1 - z0)),
  Math.abs(f.V[0] * (x1 - x0)) + Math.abs(f.V[1] * (y1 - y0)) + Math.abs(f.V[2] * (z1 - z0))];

// ---------------------------------------------------------------- matrices 3x3 (tableaux de 9, ligne par ligne)
function rotZYX(rx, ry, rz) { // Rz * Ry * Rx
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)];
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

// ---------------------------------------------------------------- le personnage
export class Personnage {
  // skinRgba : 64x64x4 (Uint8Array), modele : 'wide' | 'slim'.
  // masque (facultatif) : { largeur: 64, hauteur: 64, valeurs: Uint8Array(4096) } ; meme disposition que le skin, force d'exemption 0..255
  // par texel (couleur selective, voir rendu/LISEZMOI.md).
  constructor({ rgba, modele = 'wide', masque = null }) {
    this.modele = modele;
    this.parties = definirParties(modele === 'slim');
    this.texture = { largeur: 64, hauteur: 64, rgba };
    this.masque = masque;
    this._construire();
  }

  // Tout ce qui ne bouge pas : positions locales, normales, UV, indices.
  _construire() {
    const quads = [];
    this.parties.forEach((p, ip) => {
      for (const couche of [0, 1]) {
        const g = couche ? p.ext.g : 0;
        const uvOrig = couche ? p.ext.uv : p.uv;
        const min = p.orig.map((c) => c - g), max = p.orig.map((c, i) => c + p.taille[i] + g);
        for (const f of facesBoite(uvOrig, p.taille, min, max)) quads.push({ ip, couche, f, min, max });
      }
    });
    const n = quads.length * 4;
    this.nbQuads = quads.length;
    this.local = new Float32Array(n * 3);   // position dans le repere de la partie, relative au pivot (px)
    this.normales = new Float32Array(n * 3);
    this.partieDeSommet = new Uint8Array(n);
    this.uvs = new Float32Array(n * 2);
    this.indices = new Uint32Array(quads.length * 6);
    const eps = 0.01; // pixels : on reste a l'interieur du rectangle de texture
    quads.forEach(({ ip, f, min, max }, q) => {
      const [fw, fh] = TAILLE_FACE(f, min, max);
      const coins = [[0, 0], [1, 0], [1, 1], [0, 1]]; // HG, HD, BD, BG
      coins.forEach(([a, b], k) => {
        const s = q * 4 + k;
        for (let i = 0; i < 3; i++) {
          this.local[s * 3 + i] = f.O[i] + f.U[i] * fw * a + f.V[i] * fh * b; // origines relatives au pivot (voir le tableau 1.1)
          this.normales[s * 3 + i] = f.N[i];
        }
        this.partieDeSommet[s] = ip;
        const [ru0, rv0, ru1, rv1] = f.rect;
        this.uvs[s * 2] = (a ? ru1 - eps : ru0 + eps) / 64;
        this.uvs[s * 2 + 1] = (b ? rv1 - eps : rv0 + eps) / 64;
      });
      // sens : la normale (b-a)x(c-a) doit sortir de la boite. U x V donne le sens des trois premiers coins.
      const cr = [f.U[1] * f.V[2] - f.U[2] * f.V[1], f.U[2] * f.V[0] - f.U[0] * f.V[2], f.U[0] * f.V[1] - f.U[1] * f.V[0]];
      const dedans = cr[0] * f.N[0] + cr[1] * f.N[1] + cr[2] * f.N[2] > 0; // HG,HD,BG tournent dans le bon sens ?
      const [HG, HD, BD, BG] = [q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 3];
      // (HG, HD, BG) : normale = U x V (HD-HG = U, BG-HG = V). Si elle sort : ordre direct.
      const t = dedans ? [HG, HD, BG, HD, BD, BG] : [HG, BG, HD, HD, BG, BD];
      this.indices.set(t, q * 6);
    });
    this.positions = new Float32Array(n * 3);
    this.couleurs = new Float32Array(n * 3);
  }

  // Pose -> maillage { positions, uvs, couleurs, indices, texture, mode }.
  //   pose : { x, y, z (pieds), lacet (corps, degres), tete: [lacet, tangage], penche (degres),
  //            brasD/brasG/jambeD/jambeG: [avant, cote] (degres), accroupi (0..1), age (ticks, bras au repos) }
  //   lumiere : 0..1, multiplie les couleurs (lumiere du ciel a l'endroit du personnage).
  // Les tableaux positions/couleurs sont NOUVEAUX a chaque appel (le rendu garde des references).
  maillage(pose, lumiere = 1) {
    const mats = this.matricesParties(pose);
    const th = (180 - (pose.lacet ?? 0)) * RAD;
    const ct = Math.cos(th), st = Math.sin(th);
    const crouch = pose.accroupi ?? 0;
    const positions = new Float32Array(this.positions.length), couleurs = new Float32Array(this.couleurs.length);
    const nS = positions.length / 3;
    for (let s = 0; s < nS; s++) {
      const m = mats[this.partieDeSommet[s]];
      const lx = this.local[s * 3], ly = this.local[s * 3 + 1], lz = this.local[s * 3 + 2];
      // repere du modele (blocs), puis chaine vers le monde
      let px = m.R[0] * lx + m.R[1] * ly + m.R[2] * lz, py = m.R[3] * lx + m.R[4] * ly + m.R[5] * lz, pz = m.R[6] * lx + m.R[7] * ly + m.R[8] * lz;
      px = px / 16 + m.t[0]; py = py / 16 + m.t[1]; pz = pz / 16 + m.t[2];
      const [wx, wy, wz] = versMonde(px, py, pz, ct, st);
      positions[s * 3] = pose.x + wx; positions[s * 3 + 1] = pose.y + wy - BAISSE_ACCROUPI * crouch; positions[s * 3 + 2] = pose.z + wz;
      // ombrage : normale tournee, puis mise au carre pour un passage doux entre les faces
      const nx = this.normales[s * 3], ny = this.normales[s * 3 + 1], nz = this.normales[s * 3 + 2];
      const rx = m.R[0] * nx + m.R[1] * ny + m.R[2] * nz, ry = m.R[3] * nx + m.R[4] * ny + m.R[5] * nz, rz = m.R[6] * nx + m.R[7] * ny + m.R[8] * nz;
      const [vx, vy, vz] = versMondeDir(rx, ry, rz, ct, st);
      const o = ombre(vx, vy, vz) * lumiere;
      couleurs[s * 3] = o; couleurs[s * 3 + 1] = o; couleurs[s * 3 + 2] = o;
    }
    const m = { positions, uvs: this.uvs, couleurs, indices: this.indices, texture: this.texture, mode: 'decoupe' };
    // couleur selective : `lueur` (0..1) absent = le masque protege (force 1) mais n'eclaire pas ; present = il multiplie la force
    // ET rend les pixels du masque lumineux (non assombris par la lumiere ni l'ombrage). `horsImage` = tout le corps est exempte.
    if (this.masque) { m.masque = this.masque; m.forceMasque = pose.lueur ?? 1; m.lueur = pose.lueur ?? 0; }
    if (pose.horsImage) m.exempt = true;
    return m;
  }

  // Rotation (R) et position du pivot (t, en blocs, repere du modele) de chaque partie.
  matricesParties(pose) {
    const crouch = pose.accroupi ?? 0;
    const age = pose.age ?? 0;
    const mem = (v) => v ?? [0, 0];
    const tete = pose.tete ?? [0, 0];
    const angles = {
      // [rx, ry, rz] en radians ; avant > 0 = vers l'avant = rotation X negative
      tete: [clamp(tete[1], -90, 90) * RAD, clamp(tete[0], -85, 85) * RAD, 0], // lacet > 0 = vers la droite du joueur (-X)
      corps: [(pose.penche ?? 0) * RAD, 0, 0],
      brasD: [-mem(pose.brasD)[0] * RAD, 0, mem(pose.brasD)[1] * RAD],
      brasG: [-mem(pose.brasG)[0] * RAD, 0, -mem(pose.brasG)[1] * RAD],
      jambeD: [-mem(pose.jambeD)[0] * RAD, 0, mem(pose.jambeD)[1] * RAD],
      jambeG: [-mem(pose.jambeG)[0] * RAD, 0, -mem(pose.jambeG)[1] * RAD],
    };
    // bras au repos : leger balancement du jeu (AnimationUtils.bobModelPart)
    if (pose.balancement !== false) {
      const s = 1;
      angles.brasD[2] += s * (Math.cos(age * 0.09) * 0.05 + 0.05); angles.brasD[0] += s * Math.sin(age * 0.067) * 0.05;
      angles.brasG[2] -= s * (Math.cos(age * 0.09) * 0.05 + 0.05); angles.brasG[0] -= s * Math.sin(age * 0.067) * 0.05;
    }
    return this.parties.map((p) => {
      const a = angles[p.nom];
      const piv = [...p.pivot];
      if (crouch) {  // pose accroupie du jeu : decalages des pivots (px)
        if (p.nom === 'tete') piv[1] += 4.2 * crouch;
        if (p.nom === 'corps') piv[1] += 3.2 * crouch;
        if (p.nom === 'brasD' || p.nom === 'brasG') piv[1] += 3.2 * crouch;
        if (p.nom === 'jambeD' || p.nom === 'jambeG') piv[2] += 4 * crouch;
      }
      return { R: rotZYX(a[0], a[1], a[2]), t: piv.map((c) => c / 16) };
    });
  }
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Repere du modele (blocs, Y bas) -> monde relatif aux pieds (blocs, Y haut).
function versMonde(px, py, pz, ct, st) {
  // decalage, echelle, symetrie (-1,-1,1)
  const x = -px * ECHELLE, y = -(py + DECALAGE_Y) * ECHELLE, z = pz * ECHELLE;
  return [x * ct + z * st, y, -x * st + z * ct];
}
function versMondeDir(px, py, pz, ct, st) {
  const x = -px, y = -py, z = pz;
  return [x * ct + z * st, y, -x * st + z * ct];
}
// Ombrage doux : vaut 1,0 / 0,5 / 0,8 / 0,6 pour les normales alignees aux axes.
export function ombre(nx, ny, nz) {
  const sy = ny >= 0 ? OMBRE_HAUT : OMBRE_BAS;
  return ny * ny * sy + nz * nz * OMBRE_NS + nx * nx * OMBRE_OE;
}
