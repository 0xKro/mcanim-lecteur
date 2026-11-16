// Ou est l'objet tenu : la chaine de matrices du jeu pour un objet en main a la troisieme personne (ItemInHandLayer), portee depuis Horizon
// (MIT) : crates/horizon-client/src/mobs/render.rs `hand_base` (lignes 2404-2480) et `held_item_transform`, puis horizon-assets/src/item_bake.rs
// `item_transform_matrix` (lignes 113-135). Voir ATTRIBUTIONS.md.
//
//   objet = main * Rx(-90) * Ry(180) * T(+-1, 2, -10)/16 * affichage * T(-0,5, -0,5, -0,5)
//
//   - main : le repere de l'avant-bras. Dans le jeu c'est le repere du bras (translateToHand). Ici le coude est une charniere : on prend
//     le repere du SEGMENT BAS, ramene sur l'origine du bras (la charniere K est a 4 px de l'epaule), donc la main suit le coude plie et la
//     cinematique inverse. Sans flexion, c'est exactement le repere du bras du jeu. Bras fins : l'epaule est decalee de 0,5 px vers l'exterieur
//     (PlayerModel.translateToHand), dans le repere du corps.
//   - Rx(-90) Ry(180) T(1, 2, -10)/16 : le decalage de la main (x oppose pour la main gauche) ; l'objet part a 10 px de l'epaule, au bord avant du bras.
//   - affichage : display.thirdperson_righthand / lefthand du modele (rotation XYZ de JOML = Rx.Ry.Rz, translation, echelle) ; a gauche la
//     translation x, la rotation y et la rotation z changent de signe (ItemTransform.apply). Sans affichage : seulement le centrage.
const RAD = Math.PI / 180;
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// matrices 4x4, ligne par ligne
const mul = (A, B) => { const M = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += A[i * 4 + k] * B[k * 4 + j]; M[i * 4 + j] = s; } return M; };
const T = (x, y, z) => { const M = I(); M[3] = x; M[7] = y; M[11] = z; return M; };
const S = (x, y, z) => { const M = I(); M[0] = x; M[5] = y; M[10] = z; return M; };
const RX = (d) => { const c = Math.cos(d * RAD), s = Math.sin(d * RAD), M = I(); M[5] = c; M[6] = -s; M[9] = s; M[10] = c; return M; };
const RY = (d) => { const c = Math.cos(d * RAD), s = Math.sin(d * RAD), M = I(); M[0] = c; M[2] = s; M[8] = -s; M[10] = c; return M; };
const RZ = (d) => { const c = Math.cos(d * RAD), s = Math.sin(d * RAD), M = I(); M[0] = c; M[1] = -s; M[4] = s; M[5] = c; return M; };

// Matrice d'affichage d'un modele (aff : { rotation, translation (blocs), scale } ou null).
export function matriceAffichage(aff, gauche) {
  const centre = T(-0.5, -0.5, -0.5);
  if (!aff) return centre;
  const [rx, ry, rz] = aff.rotation, [tx, ty, tz] = aff.translation;
  let M = T(gauche ? -tx : tx, ty, tz);
  M = mul(M, RX(rx)); M = mul(M, RY(gauche ? -ry : ry)); M = mul(M, RZ(gauche ? -rz : rz));
  M = mul(M, S(aff.scale[0], aff.scale[1], aff.scale[2]));
  return mul(M, centre);
}

// Repere de la main dans le repere du modele : { R (3x3 ligne par ligne), t (blocs) } -> matrice 4x4.
// bas : { R, t } du segment bas du bras (calculerMatrices, partieArt(j, N_ARC)) ; ym, kz : position de la charniere dans le repere du bras (px).
export function repereMain(bas, ym, kz, { mince = false, gauche = false } = {}) {
  const R = bas.R;
  const kx = [0, ym, kz];
  const dK = [R[0] * kx[0] + R[1] * kx[1] + R[2] * kx[2], R[3] * kx[0] + R[4] * kx[1] + R[5] * kx[2], R[6] * kx[0] + R[7] * kx[1] + R[8] * kx[2]];
  const decalageX = mince ? (gauche ? -0.5 : 0.5) / 16 : 0;
  return [R[0], R[1], R[2], bas.t[0] - dK[0] / 16 + decalageX, R[3], R[4], R[5], bas.t[1] - dK[1] / 16, R[6], R[7], R[8], bas.t[2] - dK[2] / 16, 0, 0, 0, 1];
}

// Matrice complete de l'objet (hors centrage deja dans l'affichage) -> { R, t } pour Personnage.projeter.
export function matriceObjet(main, aff, gauche) {
  let M = mul(main, RX(-90));
  M = mul(M, RY(180));
  M = mul(M, T((gauche ? -1 : 1) / 16, 2 / 16, -10 / 16));
  M = mul(M, matriceAffichage(aff, gauche));
  return { R: [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]], t: [M[3], M[7], M[11]] };
}
