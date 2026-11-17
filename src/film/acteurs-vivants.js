// Acteurs COMMANDES PAR LA SIMULATION (champ `actes`) : relecture de leur trace dans le replay (moteur/acteurs.js ecrit un enregistrement par tick)
// et conversion en pose. Les pistes explicites de la scene (lacet, tete, accroupi, brasD...) s'ajoutent ou l'emportent (docs/SIMULATION.md, partie 9).
//   position, direction du corps : la simulation  | tete : la simulation sauf piste `tete`  | accroupi : la simulation sauf piste `accroupi`
//   jambes et bras : balancement automatique du jeu (cos(phase x 0,6662), jambes 1,4 x amplitude, bras 1,0 x amplitude) + coup de bras
//   (LivingEntity.swing, 6 ticks) + objet tenu ; les pistes brasD / jambeD / boucles de la scene s'ajoutent par-dessus.
const DEG = 180 / Math.PI;
const norm180 = (a) => { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; };
const arc = (a, b, u) => a + norm180(b - a) * u;

export function creerVivant(replay, nom) {
  const id = replay.acteurs.indexOf(nom);
  if (id < 0) return null;
  const R = replay.acteursVue, n = replay.acteursVue.length / 16;
  const lignes = [];
  for (let i = 0; i < n; i++) if (R[i * 16 + 1] === id) lignes.push(i * 16);
  if (!lignes.length) return null;
  const K = lignes.length, t0 = R[lignes[0]];   // t0 : premier tick de la trace (une entite nee en cours de route commence plus tard)
  const ligne = (k) => lignes[Math.max(0, Math.min(K - 1, k - t0))];
  const noms = replay.noms;
  return {
    id, ticks: K,
    // etat interpole au temps du monde tm (secondes de film) : comme le partialTick du jeu
    en(tm) {
      const u = Math.max(0, tm * 20 * replay.ralenti), k = Math.floor(u), f = Math.min(1, u - k);
      const a = ligne(k), b = ligne(k + 1);
      const lerp = (j) => R[a + j] + (R[b + j] - R[a + j]) * f;
      const dr = R[(f < 0.5 ? a : b) + 8];
      const objet = R[(f < 0.5 ? a : b) + 11];
      return {
        x: lerp(2), y: lerp(3), z: lerp(4), lacet: arc(R[a + 5], R[b + 5], f), lacetTete: arc(R[a + 6], R[b + 6], f), tangage: lerp(7),
        accroupi: (dr & 1) !== 0, auSol: (dr & 2) !== 0, course: (dr & 4) !== 0, balance: (dr & 8) !== 0, balancement: lerp(9), cassage: R[(f < 0.5 ? a : b) + 10],
        objet: objet >= 0 ? noms[objet] : null, phase: lerp(12), amplitude: lerp(13),
        usage: (dr >> 6) & 7, usageTicks: (dr >> 9) & 4095, invisible: (dr & (1 << 21)) !== 0, lueur: (dr & (1 << 22)) !== 0,   // pose d'utilisation (1 manger, 2 boire, 3 arc, 4 arbalete en charge, 5 arbalete chargee), effets visibles
        eau: (dr & 32) !== 0, blessure: R[(f < 0.5 ? a : b) + 14], mort: R[(f < 0.5 ? a : b) + 15], mortT: R[a + 15] > 0 ? R[a + 15] - 1 + f : -1,   // vie : rougeur 10 ticks, mort 1..21 (20 = disparait)
      };
    },
    // etat au format de physique.etatA (pour le reste de anim.js)
    etat(vs) { return { x: vs.x, z: vs.z, y: vs.y, vy: 0, auSol: vs.auSol, eau: vs.eau, echelle: false, imp: false, air: 0 }; },
    // ajoute le balancement automatique du jeu aux membres de `pose` (degres, "avant > 0" = vers l'avant)
    membres(vs, pose) {
      const ph = vs.phase * 0.6662, A = vs.amplitude;
      const jambe = Math.cos(ph) * 1.4 * A * DEG, bras = Math.cos(ph) * A * DEG;
      pose.jambeD[0] += -jambe; pose.jambeG[0] += jambe;
      pose.brasD[0] += bras; pose.brasG[0] += -bras;
      if (vs.objet) pose.brasD[0] = pose.brasD[0] * 0.5 + 18;                 // ArmPose.ITEM : le bras tenant un objet est a moitie leve
      if (vs.balance || vs.balancement > 0) {                                 // HumanoidModel.setupAttackAnim : coup du bras droit
        const s = vs.balancement, eased = 1 - Math.pow(1 - s, 4), aa = Math.sin(eased * Math.PI);
        const bb = Math.sin(s * Math.PI) * -((vs.tangage / DEG) - 0.7) * 0.75;
        pose.brasD[0] += (1.2 * aa + bb) * DEG;
      }
      const u = vs.usage;
      if (u === 1 || u === 2) {                                               // manger, boire : le bras monte a la bouche (3e personne), petit va-et-vient toutes les 4 ticks
        pose.brasD[0] = 84 + Math.sin(vs.usageTicks * Math.PI / 2) * 6; pose.brasD[1] = 0;
      } else if (u >= 3) {                                                    // ArmPose.BOW_AND_ARROW / CROSSBOW_CHARGE / CROSSBOW_HOLD : les deux bras en avant, a la hauteur de la tete (xRot = -90 + tangage)
        const a = (u === 4 ? 70 : 90) - vs.tangage;
        pose.brasD[0] = a; pose.brasG[0] = a;
      }
    },
  };
}
