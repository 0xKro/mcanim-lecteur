// Execution des operations d'un decor sur la grille. Les coordonnees du decor sont RELATIVES a l'ancre : x vers l'est, y vers le haut,
// z vers le sud ; y local 0 = la couche d'air juste au-dessus du sol de l'ancre (la ou se tiennent les pieds), y = -1 le bloc de surface.
// Une operation venue d'un gabarit (`pose`) porte `op.tf` = { M, o } : ses coordonnees (gabarit) passent par la matrice M (miroir puis quart
// de tour, transfo.js) puis sont decalees de o (position de la pose), avant la rotation `rot` du decor entier.
import { choisir } from './lire.js';
import { Classes, etatDe, orienter, OPPOSE, VECT, NOM_FR, MOTS, traduireValeur } from './etats.js';
import { ErreurDecor, LIMITES } from './grille.js';
import { toit } from './toit.js';
import { D } from '../moteur/donnees.js';
import { rotM, mul, det, dirT, transformerProps } from './transfo.js';
import { OPS_VOLUMES } from './volumes.js';
import { OPS_FORMES } from './formes.js';

// d.drapeaux : COLLISION_PLEINE = 128 ; REMPLACABLE = 1
export class Exec {
  constructor(g, d, decor, cls = new Classes(d)) {
    this.g = g; this.d = d; this.decor = decor; this.cls = cls;
    this.rot = decor.rot / 90; this.graine = decor.graine;
    const [ax, az] = decor.ancre;
    this.ax = ax; this.az = az;
    this.ay = decor.niveau === 'sol' ? this.solAncre(ax, az) : decor.niveau;
    this.stats = { fondMax: 0, fondN: 0, fondSansSol: 0, aplani: null, avert: [], dessus: null, dalleSansSol: 0, notes: [], bannieres: [], blocsEntites: { panneaux: [], pots: [], contenus: [], pupitres: [], cadres: [], tetes: [], cages: [], objetsPoses: [], tableaux: [], noeuds: [], coussins: [], acteurs: [] } };
  }

  // ---- sol d'une colonne (comme rs.solEn : le plus haut bloc a collision, sans les feuilles ; l'eau et les plantes ne comptent pas). null si rien.
  solColonne(x, z, source = null) {
    const g = this.g, d = this.d;
    for (let y = g.y0 + g.sy - 1; y >= g.y0; y--) {
      const p = source ? source[g.idx(x, y, z)] : g.cells[g.idx(x, y, z)];
      const e = g.etatDePal(p);
      if (e < 0) return y + 1;
      if (d.boites(e).length && !this.cls.infoEtat(e).feuilles) return y + 1;
    }
    return null;
  }
  solAncre(x, z) {
    if (!this.g.dansXZ(x, z)) throw new ErreurDecor(`l'ancre [${x}, ${z}] est hors de la zone (x ${this.g.x0}..${this.g.x0 + this.g.sx - 1}, z ${this.g.z0}..${this.g.z0 + this.g.sz - 1})`);
    const s = this.solColonne(x, z);
    if (s === null) throw new ErreurDecor(`pas de sol sous l'ancre [${x}, ${z}] : donne "niveau" (Y du monde de y=0)`);
    return s;
  }

  // ---- coordonnees : local (avec le decalage de rep, et la pose d'un gabarit) -> monde
  rotXZ(x, z) { switch (this.rot) { case 1: return [-z, x]; case 2: return [-x, -z]; case 3: return [z, -x]; default: return [x, z]; } }
  pt(op, [x, y, z]) {
    let lx = x + op.dec[0], lz = z + op.dec[2], ly = y + op.dec[1];
    if (op.tf) { const M = op.tf.M, o = op.tf.o; const tx = M[0] * lx + M[1] * lz + o[0]; lz = M[2] * lx + M[3] * lz + o[2]; lx = tx; ly += o[1]; }
    const [rx, rz] = this.rotXZ(lx, lz);
    return [this.ax + rx, this.ay + ly, this.az + rz];
  }
  // matrice (plan horizontal) du repere de l'operation vers le monde : rotation du decor . pose du gabarit
  matrice(op) { const R = rotM(this.rot); return op.tf ? mul(R, op.tf.M) : R; }
  // decalage vertical de l'operation (rep + pose)
  decY(op) { return op.dec[1] + (op.tf ? op.tf.o[1] : 0); }
  // l'axe x du repere de l'operation devient-il l'axe z du monde ?
  echangeAxes(op) { return this.matrice(op)[0] === 0; }
  // proprietes ecrites par le modele dans un gabarit pose avec rotation ou miroir : tournees comme le bloc (les mots de direction le sont par motMonde)
  propsPose(op, props, info) { return op.tf && props ? transformerProps(props, { M: op.tf.M, ys: 1 }, info.props) : props; }
  boite(op, b) {
    const p = this.pt(op, [b[0], b[1], b[2]]), q = this.pt(op, [b[3], b[4], b[5]]);
    return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2]), Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2])];
  }
  rectXZ(op, x1, z1, x2, z2) { const b = this.boite(op, [x1, 0, z1, x2, 0, z2]); return [b[0], b[2], b[3], b[5]]; }
  // direction d'une operation -> mot du jeu, en tenant compte de `rot` ; `vers` : le point cible est en coordonnees du decor
  motMonde(op, dir, X, Z) {
    if (!dir) return null;
    if (dir.mot) return dirT(dir.mot, { M: this.matrice(op), ys: 1 });
    const [tx, , tz] = this.pt(op, [dir.vers[0], 0, dir.vers[1]]);
    const dx = tx - X, dz = tz - Z;
    if (dx === 0 && dz === 0) throw new ErreurDecor(`${op.chemin} : ${op.nom} : ["vers", ${dir.vers}] est la cellule elle-meme (aucune direction)`);
    return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : (dz > 0 ? 'south' : 'north');
  }

  // ---- ecriture d'un bloc (un Choix) avec tout ce que fait le jeu a la pose
  etatBloc(spec, X, Y, Z, mot, extra) {
    const d = this.d, info = this.cls.info(spec.bloc);
    const props = { ...this.propsPose(this.opCourante, spec.props, info) };
    const forces = Object.keys(props);
    if (mot) {
      const o = orienter(info, mot);
      if (typeof o === 'string') throw new ErreurDecor(`${this.opCourante.chemin} : ${this.opCourante.nom} : ${o}`);
      for (const [k, v] of Object.entries(o)) if (!(k in props)) { props[k] = v; forces.push(k); }
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        const permis = info.props.get(k);
        if (!permis) throw new ErreurDecor(`${this.opCourante.chemin} : ${spec.nom} : propriete inconnue "${k}"${info.props.size ? ` (permis : ${[...info.props.keys()].join(', ')})` : ''}`);
        const val = traduireValeur(k, typeof v === 'boolean' ? String(v) : v, permis);
        if (!permis.includes(val)) throw new ErreurDecor(`${this.opCourante.chemin} : ${spec.nom}[${k}] : valeur "${v}" inconnue (permis : ${permis.join(', ')})`);
        props[k] = val; forces.push(k);
      }
    }
    let id = etatDe(d, spec.bloc, props);
    // waterlogged : vrai si de l'eau (source) etait dans la cellule et que le bloc le permet
    if (info.props.has('waterlogged') && !('waterlogged' in props)) {
      const cur = this.g.etat(X, Y, Z);
      if (cur >= 0 && ((d.nomBloc(cur) === 'water' && d.prop(cur, 'level') === '0') || d.prop(cur, 'waterlogged') === 'true')) id = d.avec(id, 'waterlogged', 'true');
    }
    return { id, forces };
  }
  poserSpec(spec, X, Y, Z, mot = null, extra = null) {
    // chemin rapide (les grandes boites) : bloc sans orientation ni propriete ajoutee, hors eau : l'etat et la liste des proprietes ecrites sont calcules une fois par bloc
    if (!mot && !extra && !this.opCourante?.tf) {
      let c = spec.cache;
      if (!c) { const r = this.etatBloc(spec, X, Y, Z, null, null); c = spec.cache = { id: r.id, forces: r.forces.length ? new Set(r.forces) : null, eau: this.cls.info(spec.bloc).props.has('waterlogged') && !('waterlogged' in spec.props) }; }
      if (!c.eau) { this.g.poserEtat(X, Y, Z, c.id); if (c.forces) this.g.forces.set(this.g.cle(X, Y, Z), c.forces); else if (this.g.forces.size) this.g.forces.delete(this.g.cle(X, Y, Z)); if (this.g.fige) this.g.defiger(X, Y, Z); return c.id; }
    }
    const { id, forces } = this.etatBloc(spec, X, Y, Z, mot, extra);
    this.g.poserEtat(X, Y, Z, id);
    this.g.forcer(X, Y, Z, forces);
    return id;
  }
  // un bloc d'un Choix en (X,Y,Z) ; bloc a deux cellules (porte, lit, grande plante) : les deux cellules
  poserChoix(op, X, Y, Z, choix, mot = null, extra = null) {
    this.opCourante = op;
    const spec = choisir(choix, this.graine, X - this.ax, Y - this.ay, Z - this.az), info = this.cls.info(spec.bloc);
    if (info.porte) return this.porteEn(op, X, Y, Z, spec, mot ? OPPOSE[mot] : null, extra);
    if (info.lit) {
      if (!mot || mot === 'up' || mot === 'down') throw new ErreurDecor(`${op.chemin} : ${op.nom} : un lit demande une direction horizontale (du pied vers la tete)`);
      const v = VECT[mot];
      this.poserSpec(spec, X, Y, Z, mot, { ...(extra || {}), part: 'foot' });
      this.poserSpec(spec, X + v[0], Y, Z + v[2], mot, { ...(extra || {}), part: 'head' });
      return;
    }
    if (info.plante2) {
      this.poserSpec(spec, X, Y, Z, mot, { ...(extra || {}), half: 'lower' });
      this.poserSpec(spec, X, Y + 1, Z, mot, { ...(extra || {}), half: 'upper' });
      return;
    }
    this.poserSpec(spec, X, Y, Z, mot, extra);
  }
  // porte : deux moities. `facing` du jeu donne ; sinon celui du bloc.
  porteEn(op, X, Y, Z, spec, facing, extra) {
    const o = { ...(extra || {}) };
    if (facing) o.facing = facing;
    o.half = 'lower'; this.poserSpec(spec, X, Y, Z, null, o);
    o.half = 'upper'; this.poserSpec(spec, X, Y + 1, Z, null, o);
  }

  poserAir(X, Y, Z) { this.g.poserPal(X, Y, Z, 0); this.g.forcer(X, Y, Z, []); }

  // ---- une operation
  executer(op) {
    this.opCourante = op;
    const f = OPS[op.nom];
    f(this, op);
  }

  // parcourt une boite monde
  boiteMonde(b, fn) { for (let y = b[1]; y <= b[4]; y++) for (let z = b[2]; z <= b[5]; z++) for (let x = b[0]; x <= b[3]; x++) fn(x, y, z); }
  verifierTaille(op, b) {
    const n = (b[3] - b[0] + 1) * (b[4] - b[1] + 1) * (b[5] - b[2] + 1);
    if (n > LIMITES.volume) throw new ErreurDecor(`${op.chemin} : ${op.nom} : boite de ${n} cellules (trop grande ; ${LIMITES.volume} cellules au plus par operation, ${LIMITES.cellules} cellules changees par decor)`);
  }
  // le bloc est-il "terrain plein" (arrete une fondation) : cube plein sans feuilles ni liquide ; #hidden compte comme plein
  terrainPlein(e) {
    if (e < 0) return true;
    const d = this.d;
    return d.a(e, D.COLLISION_PLEINE) && d.fluide(e) === 0 && !this.cls.infoEtat(e).feuilles;
  }
}

const OPS = {
  plein(ex, op) { const b = ex.boite(op, op.b); ex.verifierTaille(op, b); ex.boiteMonde(b, (x, y, z) => ex.poserChoix(op, x, y, z, op.B)); },
  creux(ex, op) {
    const b = ex.boite(op, op.b); ex.verifierTaille(op, b);
    ex.boiteMonde(b, (x, y, z) => {
      const bord = x === b[0] || x === b[3] || y === b[1] || y === b[4] || z === b[2] || z === b[5];
      if (bord) ex.poserChoix(op, x, y, z, op.B); else ex.poserAir(x, y, z);
    });
  },
  mur(ex, op) {
    const b = ex.boite(op, op.b); ex.verifierTaille(op, b);
    ex.boiteMonde(b, (x, y, z) => { if (x === b[0] || x === b[3] || z === b[2] || z === b[5]) ex.poserChoix(op, x, y, z, op.B); });
  },
  coins(ex, op) {
    const r = ex.rectXZ(op, op.x1, op.z1, op.x2, op.z2);
    const ya = ex.pt(op, [0, op.y1, 0])[1], yb = ex.pt(op, [0, op.y2, 0])[1];
    for (const [x, z] of [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]]) for (let y = ya; y <= yb; y++) ex.poserChoix(op, x, y, z, op.B);
  },
  ligne(ex, op) {
    const a = ex.pt(op, op.a), c = ex.pt(op, op.c);
    const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2], n = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    if (n >= LIMITES.ligne) throw new ErreurDecor(`${op.chemin} : ligne : ${n + 1} blocs (maximum ${LIMITES.ligne})`);
    let dernier = null;
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0 : i / n, p = [Math.round(a[0] + dx * t), Math.round(a[1] + dy * t), Math.round(a[2] + dz * t)];
      if (dernier && dernier[0] === p[0] && dernier[1] === p[1] && dernier[2] === p[2]) continue;
      dernier = p; ex.poserChoix(op, p[0], p[1], p[2], op.B);
    }
  },
  bloc(ex, op) {
    const [x, y, z] = ex.pt(op, op.p);
    // gabarit pose avec rotation ou miroir : les proprietes ecrites tournent avec lui (mots francais traduits d'abord)
    const FR = { gauche: 'left', droite: 'right' };
    const props = op.tf && op.props ? transformerProps(Object.fromEntries(Object.entries(op.props).map(([k, v]) => { const s = String(v).trim().toLowerCase(); return [k, k === 'facing' ? MOTS[s] || s : FR[s] || s]; })), { M: op.tf.M, ys: 1 }, new Map()) : op.props;
    ex.poserChoix(op, x, y, z, op.B, ex.motMonde(op, op.dir, x, z), props);
  },
  pts(ex, op) {
    for (const q of op.pts) { const [x, y, z] = ex.pt(op, q.p); ex.poserChoix(op, x, y, z, op.B, ex.motMonde(op, q.dir, x, z)); }
  },
  remplacer(ex, op) {
    const b = ex.boite(op, op.b); ex.verifierTaille(op, b);
    const g = ex.g, d = ex.d, m = op.A;
    const colle = (e) => {
      if (e < 0) return m.tout;                                    // #hidden : seulement "*"
      if (m.tout) return d.nomBloc(e) !== 'air';
      const bl = d.blocDe(e);
      for (const c of m.cibles) if (c.bloc === bl && Object.entries(c.props).every(([k, v]) => d.prop(e, k) === v)) return true;
      for (const s of m.etiquettes) if (s.has(bl)) return true;
      return false;
    };
    ex.boiteMonde(b, (x, y, z) => { if (colle(g.etat(x, y, z))) ex.poserChoix(op, x, y, z, op.B); });
  },
  effacer(ex, op) { const b = ex.boite(op, op.b); ex.verifierTaille(op, b); ex.boiteMonde(b, (x, y, z) => ex.poserAir(x, y, z)); },

  // fondation : de y local `de` (defaut -1) vers le bas jusqu'au terrain plein
  fond(ex, op) {
    const r = ex.rectXZ(op, op.x1, op.z1, op.x2, op.z2), g = ex.g;
    const y0 = ex.ay + op.opt.de + ex.decY(op);
    for (let z = r[1]; z <= r[3]; z++) for (let x = r[0]; x <= r[2]; x++) {
      let n = 0, arret = false;
      for (let y = y0; n < op.opt.profondeur; y--, n++) {
        if (y < g.y0) { arret = true; break; }
        if (ex.terrainPlein(g.etat(x, y, z))) { arret = true; break; }
        ex.poserChoix(op, x, y, z, op.B);
      }
      ex.stats.fondN++; ex.stats.fondMax = Math.max(ex.stats.fondMax, n);
      if (!arret) ex.stats.fondSansSol++;
    }
    if (ex.stats.fondSansSol) ex.stats.avert.push(`fond : ${ex.stats.fondSansSol} colonne(s) sans sol plein a moins de ${op.opt.profondeur} blocs (augmente "profondeur")`);
  },

  // aplanir : coupe le terrain a partir de y (local) et comble dessous, dans le rectangle (+ une marge en pente douce)
  aplanir(ex, op) {
    const g = ex.g, d = ex.d;
    const r = ex.rectXZ(op, op.x1, op.z1, op.x2, op.z2);
    const Y = ex.ay + op.y + ex.decY(op), marge = op.opt.marge;
    const orig = g.orig;
    // bloc de surface par defaut : le plus frequent sous le plan, dans le rectangle (sinon l'herbe)
    let dessus = op.opt.dessus || null;
    if (!dessus) {
      const cpt = new Map();
      for (let z = r[1]; z <= r[3]; z++) for (let x = r[0]; x <= r[2]; x++) {
        const s = ex.solColonne(x, z, orig);
        if (s === null) continue;
        const p = orig[g.idx(x, s - 1, z)], e = g.etatDePal(p);
        if (e < 0 || ex.cls.infoEtat(e).tronc) continue;
        cpt.set(p, (cpt.get(p) || 0) + 1);
      }
      let mp = -1, mn = 0;
      for (const [p, n] of cpt) if (n > mn) { mn = n; mp = p; }
      const t = mp >= 0 ? g.palette[mp] : 'minecraft:grass_block[snowy=false]';
      const spec = { nom: 'surface', bloc: d.idBloc(t.replace(/\[.*$/, '')), props: {} };
      dessus = { entrees: [{ spec, poids: 1 }], total: 1, brut: t };
      ex.stats.dessus = t.replace(/^minecraft:/, '').replace(/\[.*$/, '');
    }
    const dessous = op.opt.dessous || { entrees: [{ spec: { nom: 'dirt', bloc: d.idBloc('dirt'), props: {} }, poids: 1 }], total: 1 };
    const haut = g.y0 + g.sy - 1;
    let coupes = 0, comble = 0;
    for (let z = r[1] - marge; z <= r[3] + marge; z++) for (let x = r[0] - marge; x <= r[2] + marge; x++) {
      if (!g.dansXZ(x, z)) continue;
      const dist = Math.max(r[0] - x, 0, x - r[2], r[1] - z, 0, z - r[3]);
      let T = Y;
      if (dist > 0) {
        const s = ex.solColonne(x, z, orig);
        if (s === null) continue;
        T = Y + Math.round((s - Y) * dist / (marge + 1));
      }
      // coupe : tout ce qui est a partir du plan T devient de l'air
      for (let y = T; y <= haut; y++) { const i = g.idx(x, y, z); if (g.cells[i] !== 0) { g.poserPal(x, y, z, 0); g.forcer(x, y, z, []); coupes++; } }
      // surface puis remblai
      if (T - 1 >= g.y0) {
        ex.poserChoix(op, x, T - 1, z, dessus);
        for (let y = T - 2; y >= g.y0; y--) {
          if (ex.terrainPlein(g.etat(x, y, z))) break;
          ex.poserChoix(op, x, y, z, dessous); comble++;
        }
      }
    }
    ex.stats.aplani = { y: Y, largeur: r[2] - r[0] + 1, longueur: r[3] - r[1] + 1, coupes, comble };
  },

  // porte : deux moities ; `dir` = le cote exterieur (la facade) ; le panneau se pose au ras de ce cote
  porte(ex, op) {
    const [x, y, z] = ex.pt(op, op.p);
    const mot = ex.motMonde(op, op.dir, x, z);
    if (mot === 'up' || mot === 'down') throw new ErreurDecor(`${op.chemin} : porte : direction horizontale attendue (nord, sud, est, ouest)`);
    const spec = choisir(op.B, ex.graine, x - ex.ax, y - ex.ay, z - ex.az), info = ex.cls.info(spec.bloc);
    if (!info.porte) throw new ErreurDecor(`${op.chemin} : porte : "${spec.nom}" n'est pas une porte (essaie oak_door, iron_door...)`);
    const charniere = op.tf && det(op.tf.M) < 0 ? (op.opt.charniere === 'left' ? 'right' : 'left') : op.opt.charniere;   // gabarit pose en miroir : DoorBlock.mirror
    ex.porteEn(op, x, y, z, spec, OPPOSE[mot], { hinge: charniere, open: op.opt.ouverte });
  },

  toit,
  ...OPS_VOLUMES,
  ...OPS_FORMES,
};

export { NOM_FR };
