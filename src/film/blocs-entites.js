// Blocs dessines par du code dans le jeu, en plus des coffres, cloches et bannieres : tetes (SkullBlockRenderer), pots decores avec leurs
// tessons (DecoratedPotRenderer) et TEXTE des panneaux (SignRenderer, HangingSignRenderer) avec la police du jeu (bitmaps de font/default.json).
// Monde simule seulement (comme les coffres) : appele par film/effets-monde.js. Les panneaux eux-memes (planche, poteau, chaines) sont des
// modeles de blocs dans le jeu 26.3 : le mailleur les dessine deja ; ici seulement leur texte.
// Donnees : etat du bloc (sens, rotation, couleur) ; texte des panneaux et tessons des pots : `scene._entitesDecor` (constructions importees,
// decor/entites-import.js). Sources relues : SignRenderer.translateSign / translateSignText (TEXT_OFFSET (0 ; 0,3333 ; 0,0467), echelle
// 0,015625 x 0,6667, interligne 10, largeur 90), HangingSignRenderer (0,9375 ; -0,3125 ; offset (0 ; -0,32 ; 0,073), echelle x 0,9, interligne 9,
// largeur 60), SignBlockEntity.getDarkColor (couleur x 0,4 ; noir lumineux : contour 0xF0EBCC), DyeColor.textColor. Non verifie contre le jeu :
// le cote "gauche" d'un pot (pris a gauche du pot qui regarde par sa face avant) et la tete de dragon (boites principales seulement).
import fs from 'node:fs';
import path from 'node:path';
import { decoderPNG } from '../rendu/png.js';
import { convertirSkin } from '../perso/skin.js';
import { OMBRE, TETES, facesBoite, facesModele, maillage, tourner, DIRV, maillagesTete, skinParDefautUUID } from './tetes-modele.js';
export { maillagesTete, TETE_DE_OBJET, TETES, skinParDefautUUID } from './tetes-modele.js';

const VERS_Y = { south: 0, west: 90, north: 180, east: 270 };   // Direction.toYRot
const TEXTE_COULEUR = { white: 0xffffff, orange: 0xff681f, magenta: 0xff00ff, light_blue: 0x9ac0cd, yellow: 0xffff00, lime: 0xbfff00, pink: 0xff69b4, gray: 0x808080, light_gray: 0xd3d3d3, cyan: 0x00ffff, purple: 0xa020f0, blue: 0x0000ff, brown: 0x8b4513, green: 0x00ff00, red: 0xff0000, black: 0x000000 };
const RE_TETE = /^minecraft:(skeleton|wither_skeleton|zombie|creeper|piglin|dragon|player)_(wall_)?(skull|head)(\[|$)/;
const RE_POT = /^minecraft:decorated_pot(\[|$)/;
const RE_PANNEAU = /^minecraft:(\w+?)_(wall_)?(hanging_)?sign(\[|$)/;
const props = (s) => Object.fromEntries((/\[(.*)\]/.exec(s)?.[1] ?? '').split(',').filter(Boolean).map((kv) => kv.split('=')));

// ---------------------------------------------------------------- police du jeu (bitmaps seulement ; synchrone)
export function chargerPoliceBitmap(kit) {
  const racine = path.join(kit, 'assets', 'minecraft');
  const glyphes = new Map(), avances = new Map(), images = new Map(), vus = new Set();
  const img = (ref) => {
    const n = String(ref).replace(/^minecraft:/, '');
    if (!images.has(n)) { try { const p = decoderPNG(fs.readFileSync(path.join(racine, 'textures', ...n.split('/')))); images.set(n, { w: p.largeur, h: p.hauteur, px: p.rgba }); } catch { images.set(n, null); } }
    return images.get(n);
  };
  const visiter = (id, prof) => {
    const n = String(id).replace(/^minecraft:/, '');
    if (prof > 6 || vus.has(n)) return;
    vus.add(n);
    let j; try { j = JSON.parse(fs.readFileSync(path.join(racine, 'font', ...n.split('/')) + '.json', 'utf8')); } catch { return; }
    for (const p of j.providers ?? []) {
      if (p.filter && (p.filter.uniform === true || p.filter.jp === true)) continue;
      if (p.type === 'reference') visiter(p.id, prof + 1);
      else if (p.type === 'space') for (const [c, a] of Object.entries(p.advances ?? {})) { const cp = c.codePointAt(0); if (!avances.has(cp) && !glyphes.has(cp)) avances.set(cp, a); }
      else if (p.type === 'bitmap') {
        const im = img(p.file);
        if (!im || !Array.isArray(p.chars)) continue;
        const lignes = p.chars.map((s) => [...String(s)].map((c) => c.codePointAt(0)));
        const cw = Math.floor(im.w / Math.max(...lignes.map((l) => l.length))), ch = Math.floor(im.h / lignes.length);
        const hauteur = p.height ?? 8, ascent = p.ascent ?? 7, ech = hauteur / ch;
        lignes.forEach((l, r) => l.forEach((cp, c) => {
          if (cp === 0 || glyphes.has(cp) || avances.has(cp)) return;
          let lg = 0;
          for (let x = cw - 1; x >= 0 && !lg; x--) for (let y = 0; y < ch; y++) if (im.px[((r * ch + y) * im.w + c * cw + x) * 4 + 3]) { lg = x + 1; break; }
          glyphes.set(cp, { im, x: c * cw, y: r * ch, cw: lg, ch, ech, ascent, avance: Math.trunc(0.5 + lg * ech) + 1 });
        }));
      }
    }
  };
  visiter('default', 0);
  if (!glyphes.size) return null;
  const avance = (cp) => avances.get(cp) ?? glyphes.get(cp)?.avance ?? 6;
  return { glyphes, avance, largeur: (s) => [...s].reduce((a, c) => a + avance(c.codePointAt(0)), 0) };
}
// Texture du texte d'une face de panneau : 4 lignes centrees ; rend { tex, u0, v0, u1, v1 } (unites de police : u vers la droite, v vers le bas, 0 = centre)
export function cuireTexte(police, face, { interligne = 10, largeurMax = 90 } = {}) {
  const lignes = face.lignes.map((l) => {
    let s = '';
    for (const c of String(l ?? '')) { if (police.largeur(s + c) > largeurMax) break; s += c; }   // le jeu coupe ce qui depasse
    return s;
  });
  if (!lignes.some((l) => l.trim())) return null;
  const MX = 3, W = largeurMax + 2 * MX + 2, H = 4 * interligne + 2 * MX + 4, rgba = new Uint8Array(W * H * 4);
  const u0 = -W / 2, v0 = -2 * interligne - MX - 3;   // haut de la toile (les glyphes accentues montent de 3 au-dessus de la ligne)
  const coul = TEXTE_COULEUR[face.couleur] ?? 0;
  const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const sombre = face.lueur && face.couleur === 'black' ? [0xf0, 0xeb, 0xcc] : rgb(coul).map((x) => Math.floor(x * 0.4));   // SignBlockEntity.getDarkColor
  const principal = face.lueur ? rgb(coul) : sombre;
  const tracer = (s, X, Y, c) => {
    let x = X;
    for (const ch of s) {
      const cp = ch.codePointAt(0), g = police.glyphes.get(cp);
      if (g) {
        const dw = Math.round(g.cw * g.ech), dh = Math.round(g.ch * g.ech), top = Y + (7 - g.ascent);
        for (let yy = 0; yy < dh; yy++) for (let xx = 0; xx < dw; xx++) {
          const sx = g.x + Math.floor(xx / g.ech), sy = g.y + Math.floor(yy / g.ech);
          if (!g.im.px[(sy * g.im.w + sx) * 4 + 3]) continue;
          const px = Math.round(x + xx - u0), py = Math.round(top + yy - v0);
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const o = (py * W + px) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
        }
      }
      x += police.avance(cp);
    }
  };
  lignes.forEach((l, k) => {
    const x = Math.floor(-police.largeur(l) / 2), y = k * interligne - 2 * interligne;
    if (face.lueur) for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) tracer(l, x + dx, y + dy, sombre);   // Font.drawInBatch8xOutline
    tracer(l, x, y, principal);
  });
  return { tex: { largeur: W, hauteur: H, rgba }, u0, v0, u1: u0 + W, v1: v0 + H };
}

// instances des blocs voulus : zone de depart + journal du replay ; fonction tick -> [{ x, y, z, etat }]
function instances(zone, replay, re) {
  const palette = [...zone.palette, ...(replay?.palAjouts ?? [])];
  const est = new Set(); palette.forEach((s, i) => { if (re.test(s)) est.add(i); });
  if (!est.size) return null;
  const liste = [], actives = new Map();
  const ajouter = (x, y, z, i, debut) => { const I = { x, y, z, etat: palette[i], debut, fin: Infinity }; liste.push(I); actives.set(`${x},${y},${z}`, I); };
  const { sx, sz, x0, y0, z0, cellules } = zone;
  for (let i = 0; i < cellules.length; i++) if (est.has(cellules[i])) { const lx = i % sx, t = (i - lx) / sx, lz = t % sz, ly = (t - lz) / sz; ajouter(x0 + lx, y0 + ly, z0 + lz, cellules[i], -1); }
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

export function creerBlocsEntites({ rs, replay, kit, texOf, lum, scene, notes = [] }) {
  const zone = rs.zone;
  const tetes = instances(zone, replay, RE_TETE), pots = instances(zone, replay, RE_POT);
  const ed = scene?._entitesDecor ?? {};
  const textes = new Map((ed.panneaux ?? []).map((p) => [`${p.x},${p.y},${p.z}`, p]));
  const tessons = new Map((ed.pots ?? []).map((p) => [`${p.x},${p.y},${p.z}`, p.tessons]));
  const tetesImport = new Map((ed.tetes ?? []).map((p) => [`${p.x},${p.y},${p.z}`, p]));
  const panneaux = textes.size ? instances(zone, replay, RE_PANNEAU) : null;
  if (!tetes && !pots && !panneaux) return null;
  const police = panneaux ? chargerPoliceBitmap(kit) : null;
  if (panneaux && !police) notes.push('panneaux : police du jeu absente du kit (groupe interface) : texte non dessine');
  const cuits = new Map();
  const L = (x, y, z) => lum(x + 0.5, y + 0.5, z + 0.5);

  // SkullBlockRenderer : au sol, rotation r -> la face regarde (sin a, -cos a), a = r x 22,5 (r = 0 : nord ; SkullBlock.getStateForPlacement sans
  // demi-tour, la tete regarde le joueur qui la pose) ; au mur : `facing`, recule de 0,25 vers le mur et monte de 0,25
  const skins = new Map();
  const skinTete = (I) => {
    const cle = `${I.x},${I.y},${I.z}`, d = tetesImport.get(cle);
    if (!d) return null;
    if (!skins.has(cle)) {
      let t = null;
      if (d.png) { try { const im = decoderPNG(d.png); const c = convertirSkin(im.rgba, im.largeur, im.hauteur); t = { largeur: 64, hauteur: 64, rgba: c.rgba }; } catch { t = null; } }
      if (!t) { const sd = skinParDefautUUID(d.graine); t = texOf(`entity/player/${sd.modele}/${sd.nom}.png`) ?? texOf('entity/player/wide/steve.png'); }   // DefaultPlayerSkin.get(uuid), comme le jeu
      skins.set(cle, t);
    }
    return skins.get(cle);
  };
  function tete(I, u) {
    const m = RE_TETE.exec(I.etat), p = props(I.etat);
    const t = (m[1] === 'player' ? skinTete(I) : null) ?? texOf(TETES[m[1]].tex); if (!t) return [];
    return maillagesTete(m[1], { mur: !!m[2], rotation: +p.rotation || 0, facing: p.facing, alimente: p.powered === 'true', u, texture: t, L: L(I.x, I.y, I.z), nom: I.etat, place: (q) => [I.x + q[0], I.y + q[1], I.z + q[2]] });
  }

  function pot(I) {
    const p = props(I.etat), base = texOf('entity/decorated_pot/decorated_pot_base.png'); if (!base) return [];
    const f = DIRV[p.facing] ?? [0, 1], R = tourner(f[0], f[1]);
    const vm = (q) => { const r = R([(q[0] - 8) / 16, q[1] / 16, (q[2] - 8) / 16]); return [I.x + 0.5 + r[0], I.y + r[1], I.z + 0.5 + r[2]]; };
    const l = L(I.x, I.y, I.z), out = [];
    const sides = tessons.get(`${I.x},${I.y},${I.z}`) ?? ['brick', 'brick', 'brick', 'brick'];
    const texSide = (s) => texOf(s === 'brick' || !/_pottery_sherd$/.test(s) ? 'entity/decorated_pot/decorated_pot_side.png' : `entity/decorated_pot/${s.replace(/_pottery_sherd$/, '_pottery_pattern')}.png`) ?? texOf('entity/decorated_pot/decorated_pot_side.png');
    // corps : quatre faces de tessons (u 1..15 de la texture 16x16), dessus et dessous dans la texture de base
    const face = (nom, coins) => ({ nom, coins, uv: [[1 / 16, 0], [15 / 16, 0], [15 / 16, 1], [1 / 16, 1]] });
    const [arriere, gauche, droite, avant] = sides;
    const cotes = [
      [avant, face('sud', [[1, 16, 15], [15, 16, 15], [15, 0, 15], [1, 0, 15]])], [arriere, face('nord', [[15, 16, 1], [1, 16, 1], [1, 0, 1], [15, 0, 1]])],
      [droite, face('est', [[15, 16, 15], [15, 16, 1], [15, 0, 1], [15, 0, 15]])], [gauche, face('ouest', [[1, 16, 1], [1, 16, 15], [1, 0, 15], [1, 0, 1]])],
    ];
    for (const [s, F] of cotes) { const t = texSide(s); if (t) out.push(maillage([F], vm, l, t, 'decorated_pot')); }
    out.push(maillage(facesBoite([1, 0, 1, 15, 16, 15], -14, 13, 32, 32, [14, 0, 14]).filter((F) => F.nom === 'haut' || F.nom === 'bas'), vm, l, base, 'decorated_pot'));
    out.push(maillage(facesBoite([5, 16, 5, 11, 17, 11], 0, 5, 32, 32), vm, l, base, 'decorated_pot'));
    out.push(maillage(facesBoite([4, 17, 4, 12, 20, 12], 0, 0, 32, 32), vm, l, base, 'decorated_pot'));
    return out;
  }

  function texte(I) {
    const d = textes.get(`${I.x},${I.y},${I.z}`); if (!d || !police) return [];
    const m = RE_PANNEAU.exec(I.etat), mur = !!m[2], pendu = !!m[3], p = props(I.etat);
    const yRot = -(mur ? VERS_Y[p.facing] ?? 0 : (+p.rotation || 0) * 22.5) * Math.PI / 180, c = Math.cos(yRot), s = Math.sin(yRot);
    const ech = 0.015625 * (pendu ? 0.9 : 0.6666667), off = pendu ? [0, -0.32, 0.073] : [0, 0.33333334, 0.046666667];
    const C = pendu ? [0.5, 0.9375, 0.5] : [0.5, 0.5, 0.5], T0 = pendu ? [0, -0.3125, 0] : mur ? [0, -0.3125, -0.4375] : [0, 0, 0];
    const out = [];
    for (const [cote, avant] of [['avant', true], ['arriere', false]]) {
      const cle = `${I.x},${I.y},${I.z}|${cote}|${pendu}`;
      if (!cuits.has(cle)) cuits.set(cle, cuireTexte(police, d[cote], pendu ? { interligne: 9, largeurMax: 60 } : {}));
      const k = cuits.get(cle); if (!k) continue;
      const pt = (u, v) => {
        let q = [off[0] + u * ech, off[1] - v * ech, off[2]];
        if (!avant) q = [-q[0], q[1], -q[2]];                     // translateSignText : demi-tour pour l'arriere
        q = [q[0] + T0[0], q[1] + T0[1], q[2] + T0[2]];
        return [I.x + C[0] + q[0] * c + q[2] * s, I.y + C[1] + q[1], I.z + C[2] - q[0] * s + q[2] * c];   // Axis.YP.rotation
      };
      const lux = d[cote].lueur ? 1 : L(I.x, I.y, I.z);
      const coins = [pt(k.u0, k.v0), pt(k.u1, k.v0), pt(k.u1, k.v1), pt(k.u0, k.v1)];
      out.push({ positions: Float32Array.from(coins.flat()), uvs: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1), couleurs: new Float32Array(12).fill(lux), indices: Uint32Array.of(0, 3, 2, 0, 2, 1), texture: k.tex, mode: 'decoupe', deuxFaces: true, genre: 'bloc', bloc: 'sign_text', ...(d[cote].lueur ? { plein: true } : {}) });
    }
    return out;
  }

  return {
    maillages(u) {
      const tick = Math.floor(u), out = [];
      if (tetes) for (const I of tetes(tick)) out.push(...tete(I, u));
      if (pots) for (const I of pots(tick)) out.push(...pot(I));
      if (panneaux) for (const I of panneaux(tick)) out.push(...texte(I));
      return out;
    },
  };
}
