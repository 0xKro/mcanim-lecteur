// Obstruction de la camera par des blocs NON pleins (herbe haute, feuilles, fleurs...) ou par un autre acteur, tout pres de l'objectif.
// Le planificateur de camera (camera.js) n'evite que les blocs pleins : un feuillage colle a l'objectif donne une tache floue sur l'image.
// Ici on ne corrige rien : on previent, avec les secondes et le bloc, pour que le scenariste deplace la camera sans regarder les images.
// Principe : pour chaque image, une grille de rayons dans le champ de vision ; un rayon est "cache" s'il rencontre, a moins de PORTEE blocs,
// un bloc non plein (autre que l'air et l'eau) ou la boite d'un acteur. Cache plus de SEUIL de l'image pendant plus de DUREE_MIN = signale.

const DT = 1 / 30;
export const PORTEE = 1.5;          // blocs devant l'objectif
export const SEUIL = 0.08;          // part de l'image
export const DUREE_MIN = 0.3;       // secondes
const COLS = 16, LIGNES = 9;
const PAS = 0.15;
const RAD = Math.PI / 180;
// air, eau, et ce qui est plat ou minuscule (tapis de feuilles, neige fine, rails, plaques, fleurs au sol, torches...) : ne masque pas l'objectif
const VIDE = /^(minecraft:)?((cave_|void_)?air|water|lava|light|barrier|structure_void|leaf_litter|snow|[a-z_]*carpet|[a-z_]*rail|[a-z_]*pressure_plate|wildflowers|pink_petals|[a-z_]*button|[a-z_]*sign|glow_lichen|sculk_vein|string|tripwire|lever|torch|wall_torch|redstone_torch|soul_torch|lantern|ladder|frogspawn)(\[|$)/;

const nomCourt = (etat) => String(etat).replace(/^minecraft:/, '').replace(/\[.*$/, '');
const genre = (n) => (/leaves/.test(n) ? 'feuillage' : /(grass|fern|bush)/.test(n) ? 'herbe' : /(flower|poppy|dandelion|tulip|orchid|allium|bluet|daisy|cornflower|lilac|peony|rose)/.test(n) ? 'fleur' : 'bloc non plein');

// terrain : { bloc(x,y,z), solide(x,y,z) } (physique.js, terrainDepuis). Retourne [{ t0, t1, part (0..1), quoi, nom, acteur? }], les plus longues d'abord.
export function obstructionsCamera(scene, images, terrain) {
  if (!terrain?.bloc || !terrain?.solide) return [];
  const aspect = scene.largeur / scene.hauteur;
  const parImage = [];
  for (let i = 0; i < images.length; i++) {
    const c = images[i].camera, psi = c.lacet * RAD, th = c.tangage * RAD;
    const f = [-Math.sin(psi) * Math.cos(th), -Math.sin(th), Math.cos(psi) * Math.cos(th)];
    const r = [-Math.cos(psi), 0, -Math.sin(psi)];                   // vers la droite de l'image
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];   // vers le haut : r x f
    const ty = Math.tan((c.fov * RAD) / 2), tx = ty * aspect;
    const boites = images[i].acteurs.map((p) => ({ nom: p.nom, x0: p.x - 0.3, x1: p.x + 0.3, y0: p.y, y1: p.y + 1.8, z0: p.z - 0.3, z1: p.z + 0.3 }));
    let caches = 0;
    const vus = new Map();
    // camera DANS un bloc non plein (coffre, barriere, feuillage...) : le planificateur ne l'evite pas et un bloc a collision (coffre) arrete
    // les rayons des le depart (terrain.solide) : sans ce controle rien n'etait signale alors que l'image entiere montre l'interieur du bloc.
    const dans = terrain.bloc(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z));
    if (dans && !VIDE.test(dans) && !terrain.solide(c.x, c.y, c.z)) { parImage.push({ part: 1, dom: `b:${nomCourt(dans)}` }); continue; }
    for (let j = 0; j < LIGNES; j++) for (let k = 0; k < COLS; k++) {
      const sx = ((k + 0.5) / COLS) * 2 - 1, sy = 1 - ((j + 0.5) / LIGNES) * 2;
      let d = [f[0] + r[0] * sx * tx + u[0] * sy * ty, f[1] + r[1] * sx * tx + u[1] * sy * ty, f[2] + r[2] * sx * tx + u[2] * sy * ty];
      const L = Math.hypot(...d); d = d.map((v) => v / L);
      // acteurs : intersection rayon / boite (methode des plaques)
      let quoi = null, tMin = PORTEE;
      for (const b of boites) {
        let t0 = 0, t1 = PORTEE, ok = true;
        for (const [o, dd, lo, hi] of [[c.x, d[0], b.x0, b.x1], [c.y, d[1], b.y0, b.y1], [c.z, d[2], b.z0, b.z1]]) {
          if (Math.abs(dd) < 1e-9) { if (o < lo || o > hi) { ok = false; break; } continue; }
          let a = (lo - o) / dd, e = (hi - o) / dd; if (a > e) [a, e] = [e, a];
          t0 = Math.max(t0, a); t1 = Math.min(t1, e); if (t0 > t1) { ok = false; break; }
        }
        if (ok && t0 < tMin) { tMin = t0; quoi = { acteur: b.nom }; }
      }
      // blocs : on avance jusqu'a la portee (ou jusqu'a l'acteur trouve) ; un bloc plein arrete le rayon (la camera les evite deja)
      for (let t = 0.1; t <= tMin; t += PAS) {
        const x = c.x + d[0] * t, y = c.y + d[1] * t, z = c.z + d[2] * t;
        if (terrain.solide(x, y, z)) break;
        const etat = terrain.bloc(Math.floor(x), Math.floor(y), Math.floor(z));
        if (!etat || VIDE.test(etat)) continue;
        quoi = { nom: nomCourt(etat) };
        break;
      }
      if (quoi) { caches++; const cle = quoi.acteur ? `a:${quoi.acteur}` : `b:${quoi.nom}`; vus.set(cle, (vus.get(cle) ?? 0) + 1); }
    }
    let dom = null;
    for (const [cle, n] of vus) if (!dom || n > dom.n) dom = { cle, n };
    parImage.push({ part: caches / (COLS * LIGNES), dom: dom?.cle ?? null });
  }
  // plages d'images au-dessus du seuil (2 images d'ecart tolerees), assez longues
  const plages = [];
  let cur = null;
  for (let i = 0; i < parImage.length; i++) {
    if (parImage[i].part > SEUIL) {
      if (cur && i - cur.fin <= 3) { cur.fin = i; cur.parts.push(parImage[i].part); cur.noms.push(parImage[i].dom); }
      else { if (cur) plages.push(cur); cur = { debut: i, fin: i, parts: [parImage[i].part], noms: [parImage[i].dom] }; }
    }
  }
  if (cur) plages.push(cur);
  return plages.filter((p) => (p.fin - p.debut + 1) * DT > DUREE_MIN).map((p) => {
    const compte = new Map();
    for (const n of p.noms) compte.set(n, (compte.get(n) ?? 0) + 1);
    const cle = [...compte].sort((a, b) => b[1] - a[1])[0][0];
    const o = { t0: p.debut * DT, t1: (p.fin + 1) * DT, part: Math.max(...p.parts) };
    if (cle.startsWith('a:')) o.acteur = cle.slice(2); else o.nom = cle.slice(2);
    return o;
  }).sort((a, b) => b.t1 - b.t0 - (a.t1 - a.t0));
}

const s1 = (t) => (Math.round(t * 10) / 10).toFixed(1).replace('.', ',');
// Lignes de note (au plus 3) pour mcanim trajet et les notes du rendu.
export function notesObstruction(scene, images, terrain) {
  return obstructionsCamera(scene, images, terrain).slice(0, 3).map((o) => {
    const part = `${Math.round(o.part * 100)} %`;
    const quoi = o.acteur ? `l'acteur ${o.acteur} passe contre l'objectif` : `${genre(o.nom)} (${o.nom}) devant l'objectif`;
    return `camera : de ${s1(o.t0)} a ${s1(o.t1)} s, ${quoi} : jusqu'a ${part} de l'image masquee a moins de ${String(PORTEE).replace('.', ',')} bloc ; ecarte la camera (decalage, hauteur) ou le chemin`;
  });
}
