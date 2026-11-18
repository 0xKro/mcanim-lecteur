// Bannieres (BannerRenderer du jeu) : blocs dessines par du code. Mat et barre (standing_banner#main : barre et poteau ; wall_banner#main :
// barre seule) et drapeau (#flag) des modeles du jeu 26.3 (entity-models.json : boites et origines uv relevees, comparees au fichier en test),
// textures entity/banner/banner_base (bois et dessous du drapeau), entity/banner/base teinte de la couleur de la banniere, puis jusqu'a 16
// motifs teints (entity/banner/<motif>), dans l'ordre. Le drapeau ondule : xRot = (-0,0125 + 0,01 cos(2 pi f)) pi, f = ((7x + 9y + 13z + temps)
// mod 100 + fraction) / 100. Repere : T(0,5 ; 0 ; 0,5) . Ry(-angle) . S(2/3, -2/3, -2/3) (Horizon block_entity_render.rs `banner_parts`, MIT).
// Les motifs viennent de la scene (champ `bannieres` : [[x, y, z, [["motif", "couleur"], ...]]]) : un .mcz ne garde pas les donnees des blocs.
import fs from 'node:fs';
import path from 'node:path';
import { decoderPNG } from '../rendu/png.js';
import { TEINTURES, couleurTeinture } from '../creatures/especes.js';
import { facesCubeJava } from './effets-monde.js';
import { MOTIFS } from './bannieres-champ.js';
export { MOTIFS };

const OMBRE = { haut: 1.0, bas: 0.5, nord: 0.8, sud: 0.8, ouest: 0.6, est: 0.6 };
const VERS_Y = { south: 0, west: 90, north: 180, east: 270 };   // Direction.toYRot
const RE = new RegExp(`^minecraft:(${TEINTURES.join('|')})_(wall_)?banner(\\[|$)`);
// modeles (pixels, repere du ModelPart de Java)
const BARRE = { boite: [-10, -44, -1, 10, -42, 1], uv: [0, 42] }, POTEAU = { boite: [-1, -42, -1, 1, 0, 1], uv: [44, 0] };
const BARRE_MUR = { boite: [-10, -20.5, 9.5, 10, -18.5, 11.5], uv: [0, 42] };
const DRAPEAU = { boite: [-10, 0, -2, 10, 40, -1], uv: [0, 0] }, PIVOT = [0, -44, 0], PIVOT_MUR = [0, -20.5, 10.5];

const rgbInt = (c) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
export const couleurBanniere = (nom) => couleurTeinture(TEINTURES.indexOf(nom));

// Texture du drapeau cuite : banner_base, puis base teinte, puis les motifs teints, melanges par alpha (comme les couches du jeu)
export function cuireDrapeau(lire, couleur, motifs = []) {
  const fond = lire('entity/banner/banner_base');
  if (!fond) return null;
  const out = new Uint8Array(fond.rgba);
  const couches = [['base', couleur], ...motifs.slice(0, 16)];
  for (const [m, c] of couches) {
    const t = lire('entity/banner/' + m);
    if (!t || t.largeur !== fond.largeur || t.hauteur !== fond.hauteur) continue;
    const k = typeof c === 'string' ? couleurBanniere(c) : c;
    for (let i = 0; i < out.length; i += 4) {
      const a = t.rgba[i + 3] / 255;
      if (a <= 0) continue;
      for (let j = 0; j < 3; j++) out[i + j] = Math.round(out[i + j] * (1 - a) + t.rgba[i + j] * k[j] * a);
      out[i + 3] = Math.max(out[i + 3], t.rgba[i + 3]);
    }
  }
  return { largeur: fond.largeur, hauteur: fond.hauteur, rgba: out };
}

// Bannieres d'une scene : { maillages(u) } ; u = tick du monde (avec sa fraction). `instances(u)` : [{ x, y, z, etat }] presentes a cet instant.
export function creerBannieres({ kit, scene, instances, lum }) {
  const dir = path.join(kit, 'assets', 'minecraft', 'textures');
  const cache = new Map();
  const lire = (rel) => { if (!cache.has(rel)) { let t = null; try { const im = decoderPNG(fs.readFileSync(path.join(dir, ...rel.split('/')) + '.png')); t = { largeur: im.largeur, hauteur: im.hauteur, rgba: im.rgba }; } catch { t = null; } cache.set(rel, t); } return cache.get(rel); };
  const motifsEn = new Map((scene.bannieres ?? []).map(([x, y, z, l]) => [`${x},${y},${z}`, l]));
  const drapeaux = new Map();
  const drapeau = (couleur, cle) => { const k = couleur + '|' + JSON.stringify(motifsEn.get(cle) ?? []); if (!drapeaux.has(k)) drapeaux.set(k, cuireDrapeau(lire, couleur, motifsEn.get(cle) ?? [])); return drapeaux.get(k); };
  return {
    maillages(u) {
      const out = [];
      const tick = Math.floor(u), frac = u - tick;
      for (const I of instances(tick)) {
        const m = RE.exec(I.etat);
        if (!m) continue;
        const mur = !!m[2], couleur = m[1];
        const props = Object.fromEntries((I.etat.match(/\[(.*)\]/)?.[1] ?? '').split(',').filter(Boolean).map((kv) => kv.split('=')));
        const angle = mur ? VERS_Y[props.facing] ?? 0 : (+props.rotation || 0) * 22.5;
        const base = lire('entity/banner/banner_base'), tDrap = drapeau(couleur, `${I.x},${I.y},${I.z}`);
        if (!base || !tDrap) continue;
        const a = -angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
        // point du modele (pixels) -> monde : S(2/3, -2/3, -2/3) puis Ry, puis T(0,5 ; 0 ; 0,5)
        const versMonde = (p) => { const x = p[0] / 16 * (2 / 3), y = -p[1] / 16 * (2 / 3), z = -p[2] / 16 * (2 / 3); return [I.x + 0.5 + x * ca + z * sa, I.y + y, I.z + 0.5 - x * sa + z * ca]; };
        const L = lum(I.x + 0.5, I.y + 0.5, I.z + 0.5);
        const f = ((((I.x * 7 + I.y * 9 + I.z * 13 + tick) % 100) + 100) % 100 + frac) / 100;
        const xr = (-0.0125 + 0.01 * Math.cos(2 * Math.PI * f)) * Math.PI, cx = Math.cos(xr), sx = Math.sin(xr);
        const piv = mur ? PIVOT_MUR : PIVOT;
        const parties = (mur ? [BARRE_MUR] : [BARRE, POTEAU]).map((p) => ({ ...p, t: base, pivot: null })).concat([{ ...DRAPEAU, t: tDrap, pivot: piv }]);
        for (const P of parties) {
          const pos = [], uv = [], col = [], idx = [];
          for (const F of facesCubeJava(P.boite, P.uv[0], P.uv[1], P.t.largeur, P.t.hauteur)) {
            const b = pos.length / 3;
            for (let k = 0; k < 4; k++) {
              let q = F.coins[k];
              if (P.pivot) { const y = q[1], z = q[2]; q = [q[0] + P.pivot[0], y * cx - z * sx + P.pivot[1], y * sx + z * cx + P.pivot[2]]; }   // ModelPart : translation du pivot puis xRot
              pos.push(...versMonde(q)); uv.push(F.uv[k][0], F.uv[k][1]);
              const o = OMBRE[F.nom] * L; col.push(o, o, o);
            }
            idx.push(b, b + 3, b + 2, b, b + 2, b + 1);
          }
          out.push({ positions: Float32Array.from(pos), uvs: Float32Array.from(uv), couleurs: Float32Array.from(col), indices: Uint32Array.from(idx), texture: P.t, mode: 'decoupe', deuxFaces: true, genre: 'bloc', bloc: I.etat.replace(/\[.*$/, '') });
        }
      }
      return out;
    },
  };
}

// Bannieres de la zone et celles posees ou retirees par la simulation (journal du replay) : fonction tick -> instances ; null s'il n'y en a aucune
export function instancesBannieres(zone, replay = null) {
  const palette = [...zone.palette, ...(replay?.palAjouts ?? [])];
  const est = new Set(); palette.forEach((s, i) => { if (RE.test(s)) est.add(i); });
  if (!est.size) return null;
  const liste = [], actives = new Map();
  const ajouter = (x, y, z, i, debut) => { const I = { x, y, z, etat: palette[i], debut, fin: Infinity }; liste.push(I); actives.set(`${x},${y},${z}`, I); };
  const { sx, sz, x0, y0, z0, cellules } = zone;
  for (let i = 0; i < cellules.length; i++) {
    if (!est.has(cellules[i])) continue;
    const lx = i % sx, t = (i - lx) / sx, lz = t % sz, ly = (t - lz) / sz;
    ajouter(x0 + lx, y0 + ly, z0 + lz, cellules[i], -1);
  }
  if (replay) {
    const J = replay.blocs;
    for (let k = 0; k < replay.nbBlocs; k++) {
      const tick = J[k * 6], x = J[k * 6 + 1], y = J[k * 6 + 2], z = J[k * 6 + 3], nou = J[k * 6 + 5], cle = `${x},${y},${z}`, a = actives.get(cle);
      if (a && palette[nou] === a.etat) continue;
      if (a) { a.fin = tick; actives.delete(cle); }
      if (est.has(nou)) ajouter(x, y, z, nou, tick);
    }
  }
  return (tick) => liste.filter((I) => I.debut <= tick && tick < I.fin);
}

