// Rebond sur un bloc (lit, champignon d'etagere, bloc de slime) et chute amortie, comme le jeu 26.3 :
// Entity.restituteMovementAfterCollisions (port Horizon horizon-world/src/movement_restitution.rs, mobs/living.rs restitute_movement ;
// MIT, voir ATTRIBUTIONS.md). Nombres LUS dans les donnees du jeu 26.3 (movement-properties.nbt du dossier prepare de Horizon, champ
// `bounceRestitution` et `fallDistanceReduction` de chaque bloc ; tag `minecraft:suppresses_bounce` de block-tags.json) :
//   16 lits et shelf_mushroom : rebond 0,75, chute comptee x (1 - 0,5) ; slime_block : rebond 1, pas de degats de chute (SlimeBlock.fallOn :
//   multiplicateur 0) ; honey_block : supprime le rebond. Tous les autres blocs : 0.
// Le vivant garde le rebond du bloc, le non-vivant (objet au sol, TNT, bloc qui tombe, orbe) le multiplie par 0,8. Un vivant accroupi
// (isSuppressingBounce : la touche maj du joueur) ne rebondit pas ; une vitesse de chute qui ne depasse pas la gravite non plus.
// La vitesse de sortie compense la part du tick passee apres le contact : (fraction x gravite - vy) x (1 + fraction x (0,98 - 1)) x rebond,
// fraction = deplacement fait / vitesse avant (la gravite et la trainee du tick sont ensuite appliquees comme d'habitude).
export const COULEURS_LIT = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
export const RESTITUTION = Object.fromEntries([...COULEURS_LIT.map((c) => [`${c}_bed`, 0.75]), ['shelf_mushroom', 0.75], ['slime_block', 1]]);
export const REDUCTION_CHUTE = Object.fromEntries([...COULEURS_LIT.map((c) => [`${c}_bed`, 0.5]), ['shelf_mushroom', 0.5]]);
export const SANS_REBOND = new Set(['honey_block']);   // #minecraft:suppresses_bounce
export const FACTEUR_NON_VIVANT = 0.8;
export const TRAINEE_AIR = 0.98;

// le bloc sur lequel on se pose : (x, y - 0,2, z) apres le deplacement (Horizon mobs/living.rs : getOnPos a 0,2 sous les pieds)
export function blocSous(lec, x, y, z) {
  const e = lec.etatEn(Math.floor(x), Math.floor(y - 0.2), Math.floor(z));
  return e >= 0 ? lec.d.nomBloc(e) : null;
}
export const restitutionBloc = (nom) => RESTITUTION[nom] ?? 0;
export const reductionChute = (nom) => REDUCTION_CHUTE[nom] ?? 0;

// vitesse verticale apres un contact vertical (bloque en y). vy0 : vitesse avant le deplacement ; dy : deplacement fait ; nom : bloc sous ;
// rend 0 sans rebond (le jeu : la composante bloquee est remise a 0)
export function vitesseApresContact(vy0, dy, gravite, nom, { vivant = true, accroupi = false, trainee = TRAINEE_AIR } = {}) {
  if (!(vy0 < 0)) return 0;                                  // contact par en dessous seulement (collision_below)
  if (-vy0 <= gravite || accroupi || SANS_REBOND.has(nom)) return 0;
  let r = restitutionBloc(nom);
  if (!vivant) r = Math.fround(r * FACTEUR_NON_VIVANT);
  if (!(r > 0)) return 0;
  const frac = dy / vy0, g = frac * gravite, drag = 1 + frac * (trainee - 1);
  return (g - vy0) * drag * r;
}
