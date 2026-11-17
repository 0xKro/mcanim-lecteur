// Cadrage par intention : on dit QUOI montrer (plan moyen, rapproche, gros plan, plan a deux) et le lecteur calcule la camera
// (position, cible, champ de vision) a partir de la taille de la tete a l'image. Champ de camera : { cadre: {...} } (a la place de pos/cible/suit).
// Faits : un personnage fait 1,8 bloc, sa tete 0,5 bloc ; la hauteur vue a la distance d vaut 2 d tan(fov/2) ; le FOV est vertical.
// Les references (analyse/10-videos-reference.md) gardent les yeux dans le tiers haut de l'image et laissent le bas libre pour les legendes :
// les yeux sont donc places plus haut que dans un portrait classique.
const RAD = Math.PI / 180;

// Tailles de plan : part de la hauteur de l'image occupee par la tete, et place des yeux (part depuis le haut).
export const PLANS_CADRAGE = {
  large: { tete: 0.045, yeux: 0.38 },       // corps entier et decor : le personnage fait 1/6 de l'image
  moyen: { tete: 0.085, yeux: 0.28 },       // corps entier (les pieds a 55 % de l'image : la legende tient dessous)
  americain: { tete: 0.11, yeux: 0.26 },    // des cuisses a la tete
  rapproche: { tete: 0.14, yeux: 0.26 },    // poitrine et tete
  gros: { tete: 0.19, yeux: 0.3 },          // epaules et tete
};
export const NOMS_PLANS = Object.keys(PLANS_CADRAGE);
const CLES_CADRE = ['sur', 'deux', 'epaule', 'derriere', 'plan', 'de', 'haut', 'fov', 'lateral', 'decale', 'vers', 'cote', 'tete', 'rotation', 'yeux'];

const estNombre = (x) => typeof x === 'number' && Number.isFinite(x);
const estObjet = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Controle du champ `cadre` : retourne l'objet normalise. D = { err, noms }.
export function lireCadre(D, c, ch) {
  if (!estObjet(c)) D.err(ch, 'objet attendu, par exemple {"sur":"heros","plan":"moyen","de":-25} ou {"deux":["a","b"]}');
  for (const k of Object.keys(c)) if (!CLES_CADRE.includes(k)) D.err(`${ch}.${k}`, `champ inconnu ; permis : ${CLES_CADRE.join(', ')}`);
  const acteur = (n, p) => { if (typeof n !== 'string' || !D.noms.has(n)) D.err(p, `acteur inconnu : ${JSON.stringify(n)}`); return n; };
  const nb = (k, lo, hi, def) => { const v = c[k]; if (v === undefined) return def; if (!estNombre(v) || v < lo || v > hi) D.err(`${ch}.${k}`, `nombre entre ${lo} et ${hi} attendu`); return v; };
  const o = { fov: nb('fov', 20, 100, 50), haut: nb('haut', -3, 8, 0.1), de: nb('de', -360, 360, 0), lateral: nb('lateral', -6, 6, 0), decale: nb('decale', -3, 3, 0) };
  if (c.epaule !== undefined) {   // par-dessus l'epaule du premier acteur, vers le second (champ / contrechamp)
    if (!Array.isArray(c.epaule) || c.epaule.length !== 2) D.err(`${ch}.epaule`, "liste de deux noms d'acteurs attendue : [celui dont on voit l'epaule, celui qu'on regarde]");
    o.epaule = [acteur(c.epaule[0], `${ch}.epaule[0]`), acteur(c.epaule[1], `${ch}.epaule[1]`)];
    if (c.sur !== undefined || c.deux !== undefined) D.err(`${ch}.epaule`, '"epaule" se suffit : pas de "sur" ni de "deux"');
    o.cote = nb('cote', -1.5, 1.5, 0.55); o.derriere = nb('derriere', 0.3, 4, 1.1); o.haut = nb('haut', -1, 3, 0.15);
  } else if (c.deux !== undefined) {
    if (!Array.isArray(c.deux) || c.deux.length !== 2) D.err(`${ch}.deux`, 'liste de deux noms d\'acteurs attendue, par exemple ["a","b"]');
    o.deux = [acteur(c.deux[0], `${ch}.deux[0]`), acteur(c.deux[1], `${ch}.deux[1]`)];
    if (c.sur !== undefined) D.err(`${ch}.sur`, '"sur" et "deux" ensemble : choisis l\'un ou l\'autre');
    o.cote = nb('cote', -1, 1, 1); o.tete = nb('tete', 0.04, 0.3, 0.12); o.rotation = nb('rotation', -90, 90, 0); o.haut = nb('haut', -3, 8, 0.3);
  } else {
    if (c.sur === undefined) D.err(ch, 'il faut "sur" (un acteur) ou "deux" (deux acteurs)');
    o.sur = acteur(c.sur, `${ch}.sur`);
    const plan = c.plan ?? 'moyen';
    if (!PLANS_CADRAGE[plan]) D.err(`${ch}.plan`, `une de : ${NOMS_PLANS.join(', ')}`);
    o.plan = plan;
    if (c.yeux !== undefined) o.yeux = nb('yeux', 0.1, 0.6, undefined);
    if (c.tete !== undefined) o.tete = nb('tete', 0.01, 0.4, undefined);   // taille de la tete a l'image (remplace celle du plan) : 0,02 = un personnage minuscule dans un grand decor
  }
  if (c.vers !== undefined) {   // deuxieme cadrage atteint a la fin du plan (avance ou recul lent)
    if (typeof c.vers === 'string') { if (!PLANS_CADRAGE[c.vers]) D.err(`${ch}.vers`, `un nom de plan (${NOMS_PLANS.join(', ')}) ou un objet {plan, de, haut, lateral}`); o.vers = { plan: c.vers }; }
    else if (estObjet(c.vers)) {
      for (const k of Object.keys(c.vers)) if (!['plan', 'de', 'haut', 'lateral', 'fov', 'tete', 'decale'].includes(k)) D.err(`${ch}.vers.${k}`, 'champ inconnu ; permis : plan, de, haut, lateral, fov, tete, decale');
      if (c.vers.plan !== undefined && !PLANS_CADRAGE[c.vers.plan]) D.err(`${ch}.vers.plan`, `une de : ${NOMS_PLANS.join(', ')}`);
      o.vers = { ...c.vers };
    } else D.err(`${ch}.vers`, 'nom de plan ou objet attendu');
  }
  return o;
}

// Camera d'un cadrage pour un acteur : p = pose { x, y (pieds), z, lacet }.
function camSur(p, o) {
  const T = PLANS_CADRAGE[o.plan];
  const tete = o.tete ?? T.tete, yeux = o.yeux ?? T.yeux;
  const V = 0.5 / tete, d = V / (2 * Math.tan((o.fov * RAD) / 2));
  const ye = p.y + 1.62;
  const a = (p.lacet + o.de) * RAD, f = [-Math.sin(a), Math.cos(a)], r = [-f[1], f[0]];
  const pos = [p.x + f[0] * d + r[0] * o.lateral, ye + o.haut, p.z + f[1] * d + r[1] * o.lateral];
  const cible = [p.x + r[0] * o.decale, ye - (0.5 - yeux) * V + o.haut * 0.4, p.z + r[1] * o.decale];
  return { pos, cible, fov: o.fov };
}

// Plan a deux : A et B se font face ; la camera est de cote et recule pour que les deux tiennent dans la LARGEUR (12 % de marge).
function camDeux(a, b, o) {
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, ecart = Math.hypot(a.x - b.x, a.z - b.z);
  const V = 0.5 / o.tete, tf = Math.tan((o.fov * RAD) / 2);
  const dW = (ecart + 1.2) / (2 * tf * 9 / 16) * 1.12;
  const d = Math.max(dW, V / (2 * tf));
  const ax = Math.atan2(b.z - a.z, b.x - a.x), n = [-Math.sin(ax), Math.cos(ax)];
  const ye = (a.y + b.y) / 2 + 1.35, rot = o.rotation * RAD;
  const nx = n[0] * Math.cos(rot) - n[1] * Math.sin(rot), nz = n[0] * Math.sin(rot) + n[1] * Math.cos(rot);
  return { pos: [mx + nx * o.cote * d, ye + o.haut, mz + nz * o.cote * d], cible: [mx, ye - 0.15, mz], fov: o.fov };
}

// Par-dessus l'epaule de A : camera derriere A (decalee sur le cote, `cote` blocs), qui regarde la tete de B.
function camEpaule(a, b, o) {
  const dir = [b.x - a.x, b.z - a.z], L = Math.hypot(...dir) || 1, u = [dir[0] / L, dir[1] / L], r = [-u[1], u[0]];
  const pos = [a.x - u[0] * o.derriere + r[0] * o.cote, a.y + 1.62 + o.haut, a.z - u[1] * o.derriere + r[1] * o.cote];
  return { pos, cible: [b.x, b.y + 1.5, b.z], fov: o.fov };
}

// Camera (champ `camera` normal : mode libre, pistes pos / cible / fov) d'un cadrage, pour les images i0..i1 d'un plan.
// poseAu(i, nomActeur) -> pose { x, y, z, lacet } ; dec : debut du plan en secondes (les pistes d'un plan sont relatives a son debut).
export function cameraDeCadre(c, poseAu, i0, i1, dec, noms = []) {
  const cad = c.cadre, DT = 1 / 30;
  // un autre acteur ne doit pas se trouver sur l'objectif : si la camera tombe a moins de 1,5 bloc de lui, on tourne autour du sujet par pas de 30 degres
  const libre = (i, cam, sujet) => noms.every((n) => n === sujet || Math.hypot(poseAu(i, n).x - cam.pos[0], poseAu(i, n).z - cam.pos[2]) > 1.5);
  const calcSur = (i, o) => {
    let cam = camSur(poseAu(i, cad.sur), o);
    if (!noms.length || libre(i, cam, cad.sur)) return cam;
    for (const d of [30, -30, 60, -60, 90, -90, 120, -120]) { const c2 = camSur(poseAu(i, cad.sur), { ...o, de: o.de + d }); if (libre(i, c2, cad.sur)) return c2; }
    return cam;
  };
  const calc = (i, o) => (cad.epaule ? camEpaule(poseAu(i, cad.epaule[0]), poseAu(i, cad.epaule[1]), o) : cad.deux ? camDeux(poseAu(i, cad.deux[0]), poseAu(i, cad.deux[1]), o)   : calcSur(i, o));
  const base = cad.epaule ? { fov: cad.fov, cote: cad.cote, derriere: cad.derriere, haut: cad.haut } : cad.deux ? { fov: cad.fov, tete: cad.tete, cote: cad.cote, rotation: cad.rotation, haut: cad.haut } : { fov: cad.fov, plan: cad.plan, de: cad.de, haut: cad.haut, lateral: cad.lateral, decale: cad.decale, yeux: cad.yeux, tete: cad.tete };
  const A = calc(i0, base);
  const iFin = Math.max(i0, i1 - 1);
  const B = calc(iFin, cad.vers ? { ...base, ...cad.vers, ...(cad.vers.plan && !cad.deux ? { yeux: undefined, tete: cad.vers.tete } : {}) } : base);
  const t0 = i0 * DT - dec, t1 = Math.max(t0 + DT, iFin * DT - dec);
  const cle = (t, k, l = null) => ({ t, v: [...k], l });
  return {
    mode: 'libre', effets: c.effets,
    pos: { arite: 3, cles: [cle(t0, A.pos), cle(t1, B.pos, 'd')] },
    cible: { arite: 3, cles: [cle(t0, A.cible), cle(t1, B.cible, 'd')] },
    fov: { arite: 1, cles: [cle(t0, [A.fov]), cle(t1, [B.fov], 'd')] },
  };
}
