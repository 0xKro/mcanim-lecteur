// Ce que fait le jeu a la pose et que le modele ne doit pas avoir a ecrire : liaisons des clotures, murets, vitres et barreaux, forme des
// escaliers (coins), coffres doubles, portillons dans un muret, herbe sous la neige, torches murales, lanternes suspendues ; puis nettoyage
// (plantes sans appui, feuilles sans tronc) et dévoilement des cellules cachees. Passe finale d'un decor, sur les cellules changees + 1 bloc autour.
// Les proprietes que le modele a ECRITES (`oak_fence[north=true]`) ne sont jamais recalculees. Algorithmes : StairBlock.getStairsShape, FenceBlock,
// IronBarsBlock, WallBlock, ChestBlock du jeu (tables de proprietes et de formes : donnees du jeu).
import { OPPOSE, VECT, GAUCHE, DROITE, HORIZ } from './etats.js';
import { D } from '../moteur/donnees.js';
import { Redstone } from '../moteur/redstone.js';

const FACE_INDEX = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };
const EXCEPTIONS = /^(barrier|carved_pumpkin|jack_o_lantern|melon|pumpkin|(\w+_)?shulker_box)$/;

export class Liaisons {
  constructor(g, d, cls) {
    this.g = g; this.d = d; this.cls = cls;
    this.compte = { escaliers: 0, clotures: 0, murets: 0, vitres: 0, coffres: 0, autres: 0, poudre: 0 };
    // la poudre de redstone se relie comme dans le jeu (RedStoneWireBlock.getConnectionState) : meme code que le moteur, sur la grille du decor
    this.R = new Redstone({ d, monde: { etatEn: (x, y, z) => g.etat(x, y, z) }, surcharge: null });
  }
  etat(x, y, z) { return this.g.etat(x, y, z); }
  // face du voisin (vers `dir` depuis x,y,z) qui touche la cellule, pleine ?
  appui(x, y, z, dir) {
    const v = VECT[dir], e = this.etat(x + v[0], y + v[1], z + v[2]);
    if (e < 0) return true;
    return this.d.solideFace(e, FACE_INDEX[OPPOSE[dir]], 0);
  }
  exception(e) { return e >= 0 && (this.cls.infoEtat(e).feuilles || EXCEPTIONS.test(this.d.nomBloc(e))); }
  portillonVers(e, dir) {   // FenceGateBlock.connectsToDirection : le portillon est dans l'axe du mur
    if (e < 0 || !this.cls.infoEtat(e).portillon) return false;
    const f = this.d.prop(e, 'facing');
    return f && (HORIZ.indexOf(f) % 2) !== (HORIZ.indexOf(dir) % 2);
  }

  // ---- une cellule : rend le nouvel etat ou -1 s'il ne change pas
  recalculer(x, y, z) {
    const e = this.etat(x, y, z);
    if (e < 0) return -1;
    const info = this.cls.infoEtat(e);
    const forces = this.g.forces_(x, y, z);
    const d = this.d;
    let n = e;
    const mettre = (k, v) => { if (forces && forces.has(k)) return; n = d.avec(n, k, v); };
    const voisin = (dir) => { const v = VECT[dir]; return this.etat(x + v[0], y + v[1], z + v[2]); };

    if (info.cloture) {
      for (const dir of HORIZ) {
        const nb = voisin(dir), ni = nb >= 0 ? this.cls.infoEtat(nb) : null;
        const lien = nb >= 0 && ((!this.exception(nb) && this.appui(x, y, z, dir)) || (ni.cloture && ni.clotureBois === info.clotureBois) || this.portillonVers(nb, dir));
        mettre(dir, lien ? 'true' : 'false');
      }
      if (n !== e) this.compte.clotures++;
    } else if (info.vitre) {
      for (const dir of HORIZ) {
        const nb = voisin(dir), ni = nb >= 0 ? this.cls.infoEtat(nb) : null;
        const lien = nb >= 0 && ((!this.exception(nb) && this.appui(x, y, z, dir)) || ni.vitre || ni.muret);
        mettre(dir, lien ? 'true' : 'false');
      }
      if (n !== e) this.compte.vitres++;
    } else if (info.muret) {
      n = this.muret(x, y, z, e, forces);
      if (n !== e) this.compte.murets++;
    } else if (info.fil) {
      const c = this.R.etatConnexion(e, x, y, z);
      for (const dir of HORIZ) mettre(dir, d.prop(c, dir));
      if (n !== e) this.compte.poudre++;
    } else if (info.escalier) {
      mettre('shape', this.formeEscalier(x, y, z, e));
      if (n !== e) this.compte.escaliers++;
    } else if (info.portillon) {
      const f = d.prop(e, 'facing');
      const mur = (dir) => { const nb = voisin(dir); return nb >= 0 && this.cls.infoEtat(nb).muret; };
      mettre('in_wall', f && (mur(GAUCHE[f]) || mur(DROITE[f])) ? 'true' : 'false');
    } else if (info.neigeux) {
      const h = voisin('up'), nom = h >= 0 ? d.nomBloc(h) : '';
      mettre('snowy', nom === 'snow' || nom === 'snow_block' || nom === 'powder_snow' ? 'true' : 'false');
    } else if (info.lanterne) {
      const bas = voisin('down'), haut = voisin('up');
      const sousPlein = bas >= 0 && d.solideFace(bas, 1, 0), dessusPlein = haut >= 0 && (d.solideFace(haut, 0, 0) || d.solideFace(haut, 0, 1) || this.cls.infoEtat(haut).chaine || this.cls.infoEtat(haut).cloture);
      mettre('hanging', !sousPlein && dessusPlein ? 'true' : 'false');
    } else if (info.torcheMur || info.echelle || info.panneauMur || info.banniereMur) {
      // `facing` deduit du mur voisin quand le modele ne l'a pas ecrit : le bloc regarde a l'oppose du mur
      if (!(forces && forces.has('facing'))) {
        for (const dir of HORIZ) {
          const v = VECT[dir], nb = this.etat(x + v[0], y, z + v[2]);
          if (nb >= 0 && d.solideFace(nb, FACE_INDEX[OPPOSE[dir]], 0)) { n = d.avec(n, 'facing', OPPOSE[dir]); break; }
        }
      }
    }
    return n === e ? -1 : n;
  }

  // StairBlock.getStairsShape
  formeEscalier(x, y, z, e) {
    const d = this.d, f = d.prop(e, 'facing'), half = d.prop(e, 'half');
    const estEsc = (ee) => ee >= 0 && this.cls.infoEtat(ee).escalier;
    const st = (dir) => { const v = VECT[dir]; return this.etat(x + v[0], y, z + v[2]); };
    const peutPrendre = (face) => { const o = st(face); return !estEsc(o) || d.prop(o, 'facing') !== f || d.prop(o, 'half') !== half; };
    const devant = st(f);
    if (estEsc(devant) && d.prop(devant, 'half') === half) {
      const f1 = d.prop(devant, 'facing');
      if (HORIZ.indexOf(f1) % 2 !== HORIZ.indexOf(f) % 2 && peutPrendre(OPPOSE[f1])) return f1 === GAUCHE[f] ? 'outer_left' : 'outer_right';
    }
    const derriere = st(OPPOSE[f]);
    if (estEsc(derriere) && d.prop(derriere, 'half') === half) {
      const f2 = d.prop(derriere, 'facing');
      if (HORIZ.indexOf(f2) % 2 !== HORIZ.indexOf(f) % 2 && peutPrendre(f2)) return f2 === GAUCHE[f] ? 'inner_left' : 'inner_right';
    }
    return 'straight';
  }

  // WallBlock : cotes none/low/tall et poteau `up`
  muret(x, y, z, e, forces) {
    const d = this.d;
    const dessus = this.etat(x, y + 1, z), boitesDessus = dessus >= 0 ? d.boites(dessus) : [];
    const touche = (dir) => {   // la forme du dessous du bloc au-dessus atteint-elle le bras du muret ? (cases WallBlock.NORTH_TEST...)
      const z0 = dir === 'north' ? 0 : dir === 'south' ? 0.4375 : 0.4375, z1 = dir === 'north' ? 0.5625 : dir === 'south' ? 1 : 0.5625;
      const x0 = dir === 'west' ? 0 : dir === 'east' ? 0.4375 : 0.4375, x1 = dir === 'west' ? 0.5625 : dir === 'east' ? 1 : 0.5625;
      if (dessus >= 0 && this.cls.infoEtat(dessus).muret && d.prop(dessus, dir) !== 'none') return true;
      return boitesDessus.some((b) => b[1] <= 1e-6 && b[0] < x1 && b[3] > x0 && b[2] < z1 && b[5] > z0);
    };
    const cotes = {};
    for (const dir of HORIZ) {
      const v = VECT[dir], nb = this.etat(x + v[0], y, z + v[2]);
      const ni = nb >= 0 ? this.cls.infoEtat(nb) : null;
      const lien = nb >= 0 && ((!this.exception(nb) && this.appui(x, y, z, dir)) || ni.muret || this.portillonVers(nb, dir));
      cotes[dir] = lien ? (touche(dir) ? 'tall' : 'low') : 'none';
    }
    const nb = HORIZ.filter((k) => cotes[k] !== 'none');
    let poteau;
    if (dessus >= 0 && this.cls.infoEtat(dessus).muret && d.prop(dessus, 'up') === 'true') poteau = true;
    else if (nb.length === 0) poteau = true;
    else if (nb.length === 2 && (nb.includes('north') && nb.includes('south') || nb.includes('east') && nb.includes('west')) && cotes[nb[0]] === cotes[nb[1]]) {
      poteau = boitesDessus.some((b) => b[1] <= 1e-6 && b[0] < 0.75 && b[3] > 0.25 && b[2] < 0.75 && b[5] > 0.25);
    } else poteau = true;
    let n = e;
    for (const dir of HORIZ) if (!(forces && forces.has(dir))) n = d.avec(n, dir, cotes[dir]);
    if (!(forces && forces.has('up'))) n = d.avec(n, 'up', poteau ? 'true' : 'false');
    return n;
  }
}

// Passe finale : cellules a recalculer = changees + voisines. Rend le nombre de cellules modifiees.
export function passeLiaisons(g, d, cls, cellules) {
  const L = new Liaisons(g, d, cls);
  const marq = new Uint8Array(g.cells.length);
  for (const i of cellules) {
    marq[i] = 1;
    const [x, y, z] = g.xyz(i);
    for (const dir in VECT) { const v = VECT[dir], nx = x + v[0], ny = y + v[1], nz = z + v[2]; if (g.dans(nx, ny, nz)) marq[g.idx(nx, ny, nz)] = 1; }
    // la poudre depend aussi des cellules en diagonale (une marche plus haut ou plus bas)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (!g.dans(nx, ny, nz)) continue;
      const e = g.etat(nx, ny, nz);
      if (e >= 0 && cls.infoEtat(e).fil) marq[g.idx(nx, ny, nz)] = 1;
    }
  }
  // quels etats ont un calcul automatique (memo par indice de palette)
  const besoin = new Int8Array(65536).fill(-1);
  const aBesoin = (p) => {
    let b = besoin[p];
    if (b < 0) {
      const e = g.etatDePal(p);
      const info = e < 0 ? null : cls.infoEtat(e);
      b = info && (info.fil || info.cloture || info.vitre || info.muret || info.escalier || info.portillon || info.neigeux || info.lanterne || info.torcheMur || info.echelle || info.panneauMur || info.banniereMur || info.coffre) ? 1 : 0;
      besoin[p] = b;
    }
    return b === 1;
  };
  // du haut vers le bas (indice lineaire decroissant) : le poteau d'un muret depend du muret au-dessus
  let modifs = 0;
  const coffres = [];
  for (let i = marq.length - 1; i >= 0; i--) {
    if (!marq[i] || !aBesoin(g.cells[i])) continue;
    const [x, y, z] = g.xyz(i);
    const n = L.recalculer(x, y, z);
    if (n >= 0) { g.poserEtat(x, y, z, n); modifs++; }
    const e = g.etat(x, y, z);
    if (e >= 0 && cls.infoEtat(e).coffre) coffres.push([x, y, z]);
  }
  // coffres doubles : deux coffres voisins de meme orientation, dans l'axe perpendiculaire a leur face avant
  const dejaPaire = new Set();
  coffres.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
  for (const [x, y, z] of coffres) {
    const e = g.etat(x, y, z);
    if (e < 0 || !cls.infoEtat(e).coffre) continue;
    const forces = g.forces_(x, y, z);
    if (forces && forces.has('type')) continue;
    const k = g.cle(x, y, z);
    if (dejaPaire.has(k)) continue;
    const f = d.prop(e, 'facing'), bloc = d.blocDe(e);
    const v = VECT[DROITE[f]], nx = x + v[0], nz = z + v[2], o = g.etat(nx, y, nz);
    if (o < 0 || d.blocDe(o) !== bloc || d.prop(o, 'facing') !== f || dejaPaire.has(g.cle(nx, y, nz))) continue;
    const fo = g.forces_(nx, y, nz);
    if (fo && fo.has('type')) continue;
    g.poserEtat(x, y, z, d.avec(e, 'type', 'right')); g.poserEtat(nx, y, nz, d.avec(o, 'type', 'left'));
    dejaPaire.add(k); dejaPaire.add(g.cle(nx, y, nz)); L.compte.coffres++; modifs++;
  }
  return { modifs, compte: L.compte };
}

// ---- nettoyage : plantes sans appui, feuilles sans tronc (comme le jeu les casse ou les laisse mourir)
export function passeNettoyage(g, d, cls, cellules) {
  let plantes = 0, feuilles = 0;
  const air = 0;
  // plantes dont le bloc dessous n'a plus de face haute pleine (ou n'est plus la)
  for (const i of cellules) {
    const [x, y, z] = g.xyz(i);
    const sous = g.etat(x, y, z);
    if (sous >= 0 && d.solideFace(sous, 1, 1)) continue;      // appui possible (centre au moins)
    for (let yy = y + 1; ; yy++) {
      const e = g.etat(x, yy, z);
      if (e < 0) break;
      const info = cls.infoEtat(e);
      if (!info.plante || !g.dans(x, yy, z) || g.marque[g.idx(x, yy, z)]) break;   // seulement les plantes d'origine (pas celles posees par le decor)
      // plante a deux moities : on enleve toute la colonne de la plante
      g.poserPal(x, yy, z, air); plantes++;
      if (!info.plante2) break;
    }
  }
  // feuilles : distance au tronc le plus proche (jeu : 7 ou plus = la feuille disparait) autour de la zone changee
  if (cellules.length) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const i of cellules) { const [x, y, z] = g.xyz(i); x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z); x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z); }
    const R = 7, M = 6;
    const bx0 = Math.max(g.x0, x0 - R - M), bx1 = Math.min(g.x0 + g.sx - 1, x1 + R + M), by0 = Math.max(g.y0, y0 - R - M), by1 = Math.min(g.y0 + g.sy - 1, y1 + R + M), bz0 = Math.max(g.z0, z0 - R - M), bz1 = Math.min(g.z0 + g.sz - 1, z1 + R + M);
    const W = bx1 - bx0 + 1, H = by1 - by0 + 1, Dd = bz1 - bz0 + 1;
    if (W * H * Dd <= 4_000_000) {
      const dist = new Uint8Array(W * H * Dd).fill(255);
      const ix = (x, y, z) => ((y - by0) * Dd + (z - bz0)) * W + (x - bx0);
      const file = [];
      const typ = new Map();
      const genre = (p) => { let t = typ.get(p); if (t === undefined) { const e = g.etatDePal(p); t = e < 0 ? 0 : cls.infoEtat(e).tronc ? 1 : cls.infoEtat(e).feuilles ? 2 : 0; typ.set(p, t); } return t; };
      for (let y = by0; y <= by1; y++) for (let z = bz0; z <= bz1; z++) for (let x = bx0; x <= bx1; x++) if (genre(g.cells[g.idx(x, y, z)]) === 1) { dist[ix(x, y, z)] = 0; file.push([x, y, z]); }
      for (let k = 0; k < file.length; k++) {
        const [x, y, z] = file[k], dc = dist[ix(x, y, z)];
        if (dc >= 6) continue;
        for (const dir of Object.keys(VECT)) {
          const v = VECT[dir], nx = x + v[0], ny = y + v[1], nz = z + v[2];
          if (nx < bx0 || nx > bx1 || ny < by0 || ny > by1 || nz < bz0 || nz > bz1) continue;
          if (dist[ix(nx, ny, nz)] !== 255 || genre(g.cells[g.idx(nx, ny, nz)]) !== 2) continue;
          dist[ix(nx, ny, nz)] = dc + 1; file.push([nx, ny, nz]);
        }
      }
      for (let y = Math.max(by0, y0 - R); y <= Math.min(by1, y1 + R); y++) for (let z = Math.max(bz0, z0 - R); z <= Math.min(bz1, z1 + R); z++) for (let x = Math.max(bx0, x0 - R); x <= Math.min(bx1, x1 + R); x++) {
        if (genre(g.cells[g.idx(x, y, z)]) !== 2 || dist[ix(x, y, z)] !== 255) continue;
        const e = g.etat(x, y, z);
        if (d.prop(e, 'persistent') === 'true' || g.marque[g.idx(x, y, z)]) continue;
        g.poserPal(x, y, z, air); feuilles++;
      }
    }
  }
  return { plantes, feuilles };
}

// ---- cellules cachees (#hidden) devenues visibles : bloc de remplissage plausible (meme regle que moteur/monde.js `remplissage`)
export function passeDevoilement(g, d, cls, cellules) {
  const comble = new Map();
  const plein = new Map();
  const opaquePleine = (p) => {
    let v = plein.get(p);
    if (v === undefined) {
      const e = g.etatDePal(p);
      v = p === 1 || (e >= 0 && d.opacite(e) >= 15 && [0, 1, 2, 3, 4, 5].every((f) => d.solideFace(e, f, 0))) ? 1 : 0;
      plein.set(p, v);
    }
    return v;
  };
  for (const i of cellules) {
    const [x, y, z] = g.xyz(i);
    if (opaquePleine(g.cells[i])) continue;
    for (const dir of Object.keys(VECT)) {
      const v = VECT[dir], nx = x + v[0], ny = y + v[1], nz = z + v[2];
      if (!g.dans(nx, ny, nz) || g.cells[g.idx(nx, ny, nz)] !== 1) continue;
      const nom = remplissage(g, nx, ny, nz);
      g.poserPal(nx, ny, nz, g.palIdx(nom));
      comble.set(nom, (comble.get(nom) || 0) + 1);
    }
  }
  return comble;
}

// Bloc de remplissage d'une cellule cachee devenue visible (deterministe : position et zone seulement)
function remplissage(g, x, y, z) {
  const h = ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0) % 8;
  if (y < 0) return 'minecraft:deepslate[axis=y]';
  if (y < 8 && h > y) return 'minecraft:deepslate[axis=y]';
  const prof = g.hautColonne(x, z) - y;
  if (prof >= 1 && prof <= 3) {
    const lx = Math.min(g.sx - 1, Math.max(0, x - g.x0)), lz = Math.min(g.sz - 1, Math.max(0, z - g.z0));
    const b = g.biomesNoms[g.biomes[lz * g.sx + lx]] || '';
    if (/desert|beach|badlands/.test(b)) return /badlands/.test(b) ? 'minecraft:terracotta' : 'minecraft:sand';
    return 'minecraft:dirt';
  }
  return 'minecraft:stone';
}
