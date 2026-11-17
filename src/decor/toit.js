// Toit en escaliers : le lecteur choisit `facing`, `half` et (par la passe de liaisons) `shape` ; le modele donne seulement le rectangle des murs,
// la hauteur de la premiere rangee, le bloc (un escalier), le sens du faite et des options.
//   ["toit", x1, z1, x2, z2, y, "escalier", "x"|"z", {debord: 1, forme: "pignon"|"croupe", pignon: bloc|false, faite: bloc|"dalle"|false}]
// (x1,z1)-(x2,z2) = emprise des MURS (faces exterieures comprises) ; `debord` blocs de plus de chaque cote ; y = couche de la rangee basse (avant-toit).
// Pente : un bloc de haut par bloc de large (45 degres), comme les escaliers du jeu. Largeur impaire : une rangee de faite (bloc plein sous une dalle).
import { choisir } from './lire.js';
import { blocPleinDe, dalleDe } from './etats.js';
import { ErreurDecor } from './grille.js';

export function toit(ex, op) {
  const d = ex.d;
  const spec = choisir(op.B, ex.graine, 0, 0, 0), info = ex.cls.info(spec.bloc);
  if (!info.escalier) throw new ErreurDecor(`${op.chemin} : toit : "${spec.nom}" n'est pas un escalier (essaie oak_stairs, stone_brick_stairs...)`);
  const o = op.opt, deb = o.debord;
  const r = ex.rectXZ(op, op.x1, op.z1, op.x2, op.z2);
  const axe = ex.rot % 2 === 1 ? (op.axe === 'x' ? 'z' : 'x') : op.axe;
  const X0 = r[0] - deb, X1 = r[2] + deb, Z0 = r[1] - deb, Z1 = r[3] + deb;
  const Yb = ex.ay + op.y + op.dec[1];
  const marche = (x, y, z, facing) => ex.poserSpec(spec, x, y, z, null, { facing, half: 'bottom' });

  // blocs de remplissage : pignon et sous le faite (par defaut le bloc plein qui va avec l'escalier)
  const plein = (() => {
    if (o.pignon === false) return null;
    if (o.pignon) return o.pignon;
    const n = blocPleinDe(d, spec.nom) || 'cobblestone';
    return { entrees: [{ spec: { nom: n, bloc: d.idBloc(n), props: {} }, poids: 1 }], total: 1 };
  })();
  const remplissage = plein || (() => { const n = blocPleinDe(d, spec.nom) || 'cobblestone'; return { entrees: [{ spec: { nom: n, bloc: d.idBloc(n), props: {} }, poids: 1 }], total: 1 }; })();
  const faite = (() => {
    if (o.faite === false) return null;
    if (o.faite && o.faite !== 'dalle') return o.faite;
    const n = dalleDe(d, spec.nom);
    return n ? { entrees: [{ spec: { nom: n, bloc: d.idBloc(n), props: { type: 'bottom' } }, poids: 1 }], total: 1 } : null;
  })();
  const poserPlein = (x, y, z, choix) => ex.poserChoix(op, x, y, z, choix);

  if (o.forme === 'croupe') {
    const W = Z1 - Z0 + 1, L = X1 - X0 + 1, M = Math.min(W, L), h = M >> 1;
    for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) {
      const dn = z - Z0, ds = Z1 - z, dw = x - X0, de = X1 - x, dist = Math.min(dn, ds, dw, de);
      if (M % 2 === 0 ? dist <= h - 1 : dist <= h - 1) {
        const facing = dn === dist ? 'south' : ds === dist ? 'north' : dw === dist ? 'east' : 'west';
        marche(x, Yb + dist, z, facing);
      } else if (M % 2 === 1 && dist === h) {          // rangee de faite
        if (h >= 1) poserPlein(x, Yb + h - 1, z, remplissage);
        if (faite) poserPlein(x, Yb + h, z, faite);
      }
    }
    return;
  }

  // deux pans : rangees en travers du faite
  const W = axe === 'x' ? Z1 - Z0 + 1 : X1 - X0 + 1;          // nombre de rangees
  const Lr = axe === 'x' ? X1 - X0 + 1 : Z1 - Z0 + 1;         // longueur du faite
  const m = (W - 1) >> 1, impair = W % 2 === 1;
  const cell = (u, rang) => (axe === 'x' ? [X0 + u, Z0 + rang] : [X0 + rang, Z0 + u]);
  for (let rang = 0; rang < W; rang++) {
    const dist = Math.min(rang, W - 1 - rang);
    const basse = rang < W - 1 - rang || (!impair && rang < W / 2);   // rangee du cote bas du repere (nord ou ouest)
    const centre = impair && rang === m;
    for (let u = 0; u < Lr; u++) {
      const [x, z] = cell(u, rang);
      if (centre) {
        if (m >= 1) poserPlein(x, Yb + m - 1, z, remplissage);
        if (faite) poserPlein(x, Yb + m, z, faite);
        continue;
      }
      const facing = axe === 'x' ? (basse ? 'south' : 'north') : (basse ? 'east' : 'west');
      marche(x, Yb + dist, z, facing);
    }
  }
  // pignons : triangles pleins dans le plan des murs, aux deux bouts du faite
  if (plein) {
    for (const u of [deb, Lr - 1 - deb]) {
      for (let rang = deb; rang <= W - 1 - deb; rang++) {
        const dist = Math.min(rang, W - 1 - rang);
        const [x, z] = cell(u, rang);
        for (let k = 0; k < dist; k++) poserPlein(x, Yb + k, z, plein);
      }
    }
  }
}
