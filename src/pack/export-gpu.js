// Export GPU du maillage de zone : sommets prets pour OpenGL avec les attributs que les packs attendent.
// UNE fois par zone. Le rasteriseur logiciel (src/rendu/raster.js) n'utilise rien de tout cela : il garde ses propres tableaux.
//
// Disposition d'un sommet (28 flottants = 112 octets, petit-boutiste) :
//   0-2  position monde            3-4  texcoord dans l'atlas (v vers le bas, ligne 0 = haut de l'image)
//   5-6  lumiere (bloc, ciel) en unites du jeu 0..240 (= niveau 0..15 x 16), gl_MultiTexCoord1
//   7-9  couleur de sommet rgb = teinte de biome 0..1      10  alpha = occlusion ambiante 0..1 (comme Iris : gl_Color.a)
//   11-13 normale                  14-17 tangente (xyz, w = sens), at_tangent
//   18-21 mc_Entity (id de bloc rempli par l'hote depuis block.properties ; ici : indice de palette en 20, couche en 19)
//   22-23 mc_midTexCoord           24-27 at_midBlock (decalage au centre du bloc x64, lumiere emise)
import fs from 'node:fs';
import path from 'node:path';

export const FLOATS_PAR_SOMMET = 28;
const COUCHES = [['opaque', 0], ['decoupe', 1], ['interne', 1], ['melange', 3]];   // numero de couche : 0 plein, 1 decoupe, 3 translucide

function normaliser(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

// Remplit `out` (Float32Array) pour une couche du mailleur. Retourne le nombre de sommets.
// lightmap : scenes avec un monde, la lumiere de bloc des sommets (niveau 0..15 x 16) est la vraie ; sinon (comme avant) celle du bloc emissif.
export function sommetsDeCouche(c, numCouche, emission, lightmap = false) {
  const n = c.nbQuads, g = c.gpu;
  const out = new Float32Array(n * 4 * FLOATS_PAR_SOMMET);
  const P = c.positions, U = c.uvs;
  for (let q = 0; q < n; q++) {
    const p0 = [P[q * 12], P[q * 12 + 1], P[q * 12 + 2]], p1 = [P[q * 12 + 3], P[q * 12 + 4], P[q * 12 + 5]], p2 = [P[q * 12 + 6], P[q * 12 + 7], P[q * 12 + 8]];
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const nor = normaliser([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
    const du1 = U[q * 8 + 2] - U[q * 8], dv1 = U[q * 8 + 3] - U[q * 8 + 1], du2 = U[q * 8 + 4] - U[q * 8], dv2 = U[q * 8 + 5] - U[q * 8 + 1];
    const det = du1 * dv2 - du2 * dv1;
    let tan = [1, 0, 0], w = 1;
    if (Math.abs(det) > 1e-12) {
      const f = 1 / det;
      tan = normaliser([f * (dv2 * e1[0] - dv1 * e2[0]), f * (dv2 * e1[1] - dv1 * e2[1]), f * (dv2 * e1[2] - dv1 * e2[2])]);
      const bit = [f * (-du2 * e1[0] + du1 * e2[0]), f * (-du2 * e1[1] + du1 * e2[1]), f * (-du2 * e1[2] + du1 * e2[2])];
      const cx = [nor[1] * tan[2] - nor[2] * tan[1], nor[2] * tan[0] - nor[0] * tan[2], nor[0] * tan[1] - nor[1] * tan[0]];
      w = (cx[0] * bit[0] + cx[1] * bit[1] + cx[2] * bit[2]) < 0 ? -1 : 1;
    }
    const cx = g.ctr[q * 3], cy = g.ctr[q * 3 + 1], cz = g.ctr[q * 3 + 2];
    const em = emission ? emission(g.blk[q]) : 0;
    for (let k = 0; k < 4; k++) {
      const o = (q * 4 + k) * FLOATS_PAR_SOMMET;
      const px = P[q * 12 + k * 3], py = P[q * 12 + k * 3 + 1], pz = P[q * 12 + k * 3 + 2];
      out[o] = px; out[o + 1] = py; out[o + 2] = pz;
      out[o + 3] = U[q * 8 + k * 2]; out[o + 4] = U[q * 8 + k * 2 + 1];
      out[o + 5] = lightmap ? Math.min(240, g.blv[q * 4 + k] * 16) : em * 16; out[o + 6] = Math.min(240, g.lvl[q * 4 + k] * 16);
      out[o + 7] = g.tint[q * 3] / 255; out[o + 8] = g.tint[q * 3 + 1] / 255; out[o + 9] = g.tint[q * 3 + 2] / 255;
      out[o + 10] = c.ao[q * 4 + k] / 255;
      out[o + 11] = nor[0]; out[o + 12] = nor[1]; out[o + 13] = nor[2];
      out[o + 14] = tan[0]; out[o + 15] = tan[1]; out[o + 16] = tan[2]; out[o + 17] = w;
      out[o + 18] = 0; out[o + 19] = numCouche; out[o + 20] = g.blk[q]; out[o + 21] = 0;
      out[o + 22] = g.mid[q * 2]; out[o + 23] = g.mid[q * 2 + 1];
      out[o + 24] = (px - cx) * 64; out[o + 25] = (py - cy) * 64; out[o + 26] = (pz - cz) * 64; out[o + 27] = em;
    }
  }
  return out;
}

// Ecrit dans `dossier` : maillage.json, <couche>.vtx, <couche>.idx, atlas.rgba. `scene` vient de chargerScene({ options: { exportGPU: true } }).
export function exporterZone(scene, dossier) {
  const m = scene.maillage;
  fs.mkdirSync(dossier, { recursive: true });
  const t0 = performance.now();
  const emission = (idx) => {   // lumiere emise par l'etat de bloc (0..15) : les blocs emissifs du mailleur
    const e = m.interne.etats[idx];
    return e && (e.emission || e.type === 3) ? 15 : 0;
  };
  const B = scene.boite ? scene.boite() : scene.zone;
  const entete = { v: 1, floatsParSommet: FLOATS_PAR_SOMMET, zone: { origine: [B.x0, B.y0, B.z0], taille: [B.sx, B.sy, B.sz] }, palette: scene.monde ? scene.monde.palette : scene.zone.palette, couches: {} };
  const lightmap = !!m.lightmap;
  let octets = 0;
  for (const [nom, num] of COUCHES) {
    const c = m.couches[nom];
    if (!c || c.nbQuads === 0 || !c.gpu) continue;
    const sommets = sommetsDeCouche(c, num, emission, lightmap);
    fs.writeFileSync(path.join(dossier, nom + '.vtx'), Buffer.from(sommets.buffer, 0, sommets.byteLength));
    fs.writeFileSync(path.join(dossier, nom + '.idx'), Buffer.from(c.indices.buffer.slice(0, c.nbQuads * 6 * 4)));
    entete.couches[nom] = { quads: c.nbQuads, couche: num, ...(scene.monde ? { sections: c.sections.map((s) => [s.debut, s.nb, s.cle]) } : {}) };
    octets += sommets.byteLength + c.nbQuads * 24;
  }
  const a = m.atlas, niv = a.niveaux[0];
  fs.writeFileSync(path.join(dossier, 'atlas.rgba'), Buffer.from(new Uint8Array(niv.data.buffer.slice(niv.data.byteOffset, niv.data.byteOffset + niv.w * niv.h * 4))));
  entete.atlas = { largeur: a.largeur, hauteur: a.hauteur };
  fs.writeFileSync(path.join(dossier, 'maillage.json'), JSON.stringify(entete));
  return { ms: performance.now() - t0, octets: octets + a.largeur * a.hauteur * 4, quads: Object.fromEntries(Object.entries(entete.couches).map(([k, v]) => [k, v.quads])) };
}

// Mises a jour entre deux images (scenes avec un monde) : les sections refaites depuis le dernier export. `maj` vient de scene.prendreMajGPU() :
// { mortes: [cle...], retraits: [id...], ajouts: [{ id, nom, c }] } (c : tableaux du mailleur pour UNE section). Ecrit maj.json et, par piece,
// p<id>.vtx / p<id>.idx dans `dossier` (vide a chaque fois) ; l'hote lit ces fichiers (commande maillage-maj). Rend { ms, octets, pieces, quads }.
export function exporterMaj(scene, dossier, maj) {
  const t0 = performance.now();
  fs.rmSync(dossier, { recursive: true, force: true });
  fs.mkdirSync(dossier, { recursive: true });
  const emission = (idx) => { const e = scene.maillage.interne.etats[idx]; return e && (e.emission || e.type === 3) ? 15 : 0; };
  const lightmap = !!scene.maillage.lightmap;
  let octets = 0, quads = 0;
  const ajouts = [];
  for (const a of maj.ajouts) {
    const num = COUCHES.find(([n]) => n === a.nom)[1];
    const sommets = sommetsDeCouche(a.c, num, emission, lightmap);
    fs.writeFileSync(path.join(dossier, `p${a.id}.vtx`), Buffer.from(sommets.buffer, 0, sommets.byteLength));
    fs.writeFileSync(path.join(dossier, `p${a.id}.idx`), Buffer.from(a.c.indices.buffer.slice(0, a.c.nbQuads * 6 * 4)));
    octets += sommets.byteLength + a.c.nbQuads * 24; quads += a.c.nbQuads;
    ajouts.push({ id: a.id, couche: a.nom, num, quads: a.c.nbQuads });
  }
  // la palette s'allonge quand une scene pose un bloc nouveau (torche...) : l'hote en a besoin pour mc_Entity
  fs.writeFileSync(path.join(dossier, 'maj.json'), JSON.stringify({ mortes: maj.mortes, retraits: maj.retraits, ajouts, palette: scene.monde ? scene.monde.palette : scene.zone.palette }));
  return { ms: performance.now() - t0, octets, pieces: ajouts.length, quads };
}
