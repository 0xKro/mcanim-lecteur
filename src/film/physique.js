// Physique verticale AUTOMATIQUE des acteurs : saut, marche d'escalier, chute, eau, echelle. Le chemin horizontal est celui de la
// piste `pos` ; la hauteur est celle du joueur du jeu, simulee tick par tick (20 par seconde), puis interpolee pour les 30 images
// par seconde comme les "partial ticks" du jeu. Deterministe : aucun hasard. Derivation et sources : site/regles/DERIVATION.md.
//
// Constantes du jeu (Horizon, _ref/horizon/crates, lignes citees) :
//   - Gravite 0,08 puis trainee verticale 0,98, dans cet ordre, apres le deplacement du tick :
//       horizon-world/src/living_air.rs:146 (velocity.y -= gravite) et :158-168 (vertical * modified_friction(0.98)) ;
//       gravite 0,08 : horizon-client/src/entities.rs:1031 `(dy - 0.08) * 0.98`, horizon-bots/src/main.rs:567.
//   - Saut : vitesse verticale 0,42 posee avant le deplacement du meme tick (analyse/3-personnages.md 3.12 ; perspective.rs:196
//     `jump_strength 0.42` ; living_motion.rs:48-72).
//   - Hauteur de pas 0,6 : perspective.rs:196, motion.rs:2254. Boite du joueur 0,6 x 1,8 : perspective.rs:179.
//   - Echelle : vitesse verticale bornee a -0,15 (descente libre 3,0 blocs/s) ; on monte en posant 0,2 apres le deplacement, donc
//     (0,2 - 0,08) x 0,98 = 0,1176 par tick = 2,352 blocs/s : horizon-world/src/living_air.rs:81-93 et :124-129.
//   - Eau : vitesse horizontale x 0,8 (x 0,9 en nage rapide), vertical x 0,8, gravite/16 : living_fluid.rs:63-91, environment.rs:228.
//   - Pas : la distance de pas ne compte que l'horizontale, sauf sur une echelle : movement_emission.rs:116-124.
import { evaluer } from './scene.js';

export const TICK = 1 / 20;
export const GRAVITE = 0.08;
export const TRAINEE = 0.98;
export const VITESSE_SAUT = 0.42;
export const HAUTEUR_PAS = 0.6;          // au plus : on monte sans sauter
export const RAYON_PIED = 0.3;           // demi-largeur de la boite du joueur
export const VITESSE_ECHELLE_MONTE = 0.1176;   // blocs par tick
export const NAGE_FLOTTE = 1.3;          // blocs : les pieds sont 1,3 sous la surface quand on flotte (tete et epaules dehors) ; NOTRE choix
export const SEUIL_NAGE = 1.3;           // profondeur d'eau a partir de laquelle l'acteur flotte au lieu de marcher au fond ; NOTRE choix
export const SEUIL_IMPACT_REACTION = 0.15; // blocs par tick : en dessous, pas de reaction d'atterrissage (une marche de 0,5 bloc)

// Hauteur atteinte n ticks apres le debut du saut (le tick du decollage compte). SAUT[0] = 0,42 ; sommet SAUT_MAX = 1,2522.
export const SAUT = (() => {
  const h = []; let v = VITESSE_SAUT, y = 0;
  for (let i = 0; i < 40 && v > -0.2; i++) { y += v; h.push(y); v = (v - GRAVITE) * TRAINEE; }
  return h;
})();
export const SAUT_MAX = Math.max(...SAUT);

// Vitesses horizontales du jeu (blocs/s) pour la verification des scenes (voir trajet.js). Derivation : DERIVATION.md.
export const VITESSES = {
  marche: 4.317, course: 5.612, accroupi: 1.295, ramper: 1.295,
  eau: 1.96,          // marcher ou nager a la surface : 0,02 x 0,98 / (1 - 0,8) = 0,098 bloc/tick
  nage: 3.92,         // nage rapide (course dans l'eau) : 0,0196 / (1 - 0,9) = 0,196 bloc/tick
  echelleMonte: 2.352, echelleDescend: 3.0,
};

const ETAT_ECHELLE = /^(?:minecraft:)?(?:ladder|vine|scaffolding|(?:cave|weeping|twisting)_vines(?:_plant)?)(?:\[|$)/;
export const estEchelle = (etat) => typeof etat === 'string' && ETAT_ECHELLE.test(etat);
const nomBloc = (etat) => String(etat ?? '').replace(/^minecraft:/, '').replace(/\[.*$/, '');

// Proprietes d'un etat de bloc : 'minecraft:oak_stairs[facing=east,half=bottom]' -> { facing: 'east', half: 'bottom' }.
function proprietes(etat) {
  const m = /\[(.*)\]$/.exec(etat);
  const o = {};
  if (m) for (const p of m[1].split(',')) { const [k, v] = p.split('='); o[k] = v; }
  return o;
}

// Hauteur (0..1) du dessus d'un bloc a collision au point (fx, fz) de sa face (0..1) : dalle basse 0,5, escalier : marche basse 0,5
// et marche haute 1. Les escaliers en angle sont traites comme des escaliers droits. Les autres blocs : 1.
export function hauteurDuBloc(etat, fx, fz) {
  const nom = nomBloc(etat);
  if (/_slab$/.test(nom)) return proprietes(etat).type === 'bottom' ? 0.5 : 1;
  if (/_stairs$/.test(nom)) {
    const p = proprietes(etat);
    if (p.half === 'top') return 1;
    const haut = p.facing === 'east' ? fx >= 0.5 : p.facing === 'west' ? fx < 0.5 : p.facing === 'south' ? fz >= 0.5 : fz < 0.5;
    return haut ? 1 : 0.5;
  }
  return 1;
}

// terrain : { solEn(x,z), estLibre, solide, bloc(x,y,z) (facultatif), eauEn(x,z) (facultatif) }. Un terrain vide = sol plat a y = 0.
export function terrainDepuis(rs) {
  return {
    solEn: (x, z) => rs.solEn(x, z), estLibre: (x, y, z) => rs.estLibre(x, y, z), solide: (x, y, z) => rs.estSolidePourCamera(x, y, z),
    bloc: (x, y, z) => rs.zone.bloc(x, y, z), eauEn: (x, z) => rs.eauEn(x, z),
  };
}

// Sol de l'acteur : dessus du bloc le plus haut sous la boite (4 coins et centre), fin pour les dalles et escaliers.
export function creerSol(terrain) {
  const solEn = terrain.solEn ?? (() => 0);
  const bloc = terrain.bloc ?? null;
  const solFin = (x, z) => {
    const s = solEn(x, z);
    if (s === null || s === undefined) return null;
    if (!bloc) return s;
    const bx = Math.floor(x), bz = Math.floor(z);
    const etat = bloc(bx, s - 1, bz);
    return etat ? s - 1 + hauteurDuBloc(etat, x - bx, z - bz) : s;
  };
  const POINTS = [[0, 0], [-RAYON_PIED, -RAYON_PIED], [RAYON_PIED, -RAYON_PIED], [-RAYON_PIED, RAYON_PIED], [RAYON_PIED, RAYON_PIED]];
  // { y, x, z } du point le plus haut, ou null
  const sous = (x, z) => {
    let m = null;
    for (const [dx, dz] of POINTS) {
      const y = solFin(x + dx, z + dz);
      if (y !== null && y !== undefined && (m === null || y > m.y)) m = { y, x: x + dx, z: z + dz };
    }
    return m;
  };
  return { sous, solFin };
}

const lisser01 = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };

// Simulation d'un acteur. piste : { arite: 3, cles: [{ t, v: [x, y, z], l }] } (y = NaN : hauteur automatique), duree (s), gel :
// intervalles du monde gele [[a, b]] (le monde ne vit pas pendant un gel : ni chute, ni saut, ni pas).
// Retourne { ticks, x, z, y, vy, sol (booleens), air, eau, echelle, imp (hauteur imposee par pos), horizModifie, evenementsBruts,
//   decollages: [{ k, t }], atterrissages: [{ k, t, impact (blocs/tick), chute (blocs) }], etatA(tm), temps(k) }.
// tempsPos (facultatif) : fonction qui decale le temps de lecture de la piste (acteur fige seul, fige.js) ; sans elle, le temps du film.
export function simulerActeur({ piste, terrain = {}, duree, gel = [], tempsPos = null }) {
  const sol = creerSol(terrain);
  const eauEn = terrain.eauEn ?? (() => null);
  const bloc = terrain.bloc ?? (() => null);
  const monde = (x) => { let g = 0; for (const [a, b] of gel) if (x > a) g += Math.min(x, b) - a; return x - g; };
  const reel = (w) => { let t = w; for (const [a, b] of gel) if (t > a) t += b - a; return t; };
  const K = Math.ceil(monde(duree) / TICK) + 2;
  const X = new Float64Array(K + 12), Z = new Float64Array(K + 12), YI = new Float64Array(K + 12);
  const tmp = [0, 0, 0];
  for (let k = 0; k < K + 12; k++) {
    evaluer(piste, tempsPos ? tempsPos(reel(k * TICK)) : reel(k * TICK), tmp);
    X[k] = tmp[0]; Z[k] = tmp[2]; YI[k] = tmp[1];
  }
  const gAt = (x, z) => { const s = sol.sous(x, z); return s ? s.y : null; };

  const Y = new Float64Array(K + 1), VY = new Float64Array(K + 1), XE = new Float64Array(K + 1), ZE = new Float64Array(K + 1);
  const SOL = new Uint8Array(K + 1), AIR = new Uint8Array(K + 1), EAU = new Uint8Array(K + 1), ECH = new Uint8Array(K + 1), IMP = new Uint8Array(K + 1);
  const SAUTE = new Uint8Array(K + 1);                       // 1 au tick d'un decollage voulu
  const IMPACT = new Float64Array(K + 1);                    // vitesse verticale (blocs/tick, > 0) au tick d'un atterrissage
  const PAS = new Float64Array(K + 1);                       // marche montee de cette hauteur a ce tick (0 sinon)
  const brut = [];                                           // evenements isoles (obstacle, plouf...)
  let horizModifie = false;

  // ---- etat initial
  const g0 = gAt(X[0], Z[0]);
  let y = Number.isFinite(YI[0]) ? YI[0] : (g0 ?? 0);
  let vy = -GRAVITE * TRAINEE, grounded = true, mode = 'sol';
  let bloque = null, climb = null;
  let xe = X[0], ze = Z[0];
  const eau0 = eauEn(xe, ze);
  const bob = (k) => 0.04 * Math.sin(k * 0.3142);          // 2 s par oscillation
  if (!Number.isFinite(YI[0]) && eau0 !== null && g0 !== null && eau0 - g0 >= SEUIL_NAGE) { y = Math.max(g0, eau0 - NAGE_FLOTTE); mode = 'eau'; grounded = false; vy = 0; }
  const ecrire = (k, m) => {
    Y[k] = y; VY[k] = vy; XE[k] = xe; ZE[k] = ze; SOL[k] = grounded ? 1 : 0;
    AIR[k] = (!grounded && m === 'sol') ? 1 : 0; EAU[k] = m === 'eau' ? 1 : 0; ECH[k] = m === 'ech' ? 1 : 0; IMP[k] = m === 'imp' ? 1 : 0;
  };
  ecrire(0, Number.isFinite(YI[0]) ? 'imp' : mode);

  const celluleEchelle = (x, yy, z) => estEchelle(bloc(Math.floor(x), Math.floor(yy), Math.floor(z)));

  // planification du saut : retourne le tick de decollage voulu, ou null. On suit les marches de moins de 0,6 sur le chemin (escalier :
  // les marches se montent sans sauter) et on ne saute que pour une hauteur qui depasse 0,6 au-dessus de ce que les pieds auront atteint.
  const planSaut = (k) => {
    let yp = y;
    for (let j = 0; j <= 8; j++) {
      const g = gAt(X[k + j], Z[k + j]);
      if (g === null) continue;
      const r = g - yp;
      if (r > HAUTEUR_PAS + 1e-6) {
        if (r > SAUT_MAX - 0.004) return null;            // trop haut : mur (signale par l'obstacle)
        let n = 1;
        while (n < SAUT.length && SAUT[n - 1] < r + 0.002) n++;
        const kj = k + j - n + 1;
        if (yp - y > 0.05 && kj <= k) return null;        // des marches viennent d'abord : on saute depuis le haut des marches
        return { kj: Math.max(k, kj), r };
      }
      yp = g;                                              // marche (ou descente) : les pieds suivent le sol
    }
    return null;
  };

  for (let k = 1; k <= K; k++) {
    const xd = X[k], zd = Z[k];
    const xPrec = xe, zPrec = ze;
    xe = xd; ze = zd;
    if (bloque) {
      if (Math.hypot(xd - bloque.x, zd - bloque.z) > 0.75) { xe = bloque.x; ze = bloque.z; horizModifie = true; } else bloque = null;
    }
    // ---- hauteur imposee par la piste (cle a 3 valeurs) : elle l'emporte sur tout
    if (Number.isFinite(YI[k])) {
      y = YI[k]; vy = 0; climb = null; mode = 'imp';
      const g = gAt(xe, ze);
      grounded = g === null ? true : y <= g + 0.05;
      ecrire(k, 'imp'); continue;
    }
    const etaitImpose = mode === 'imp';
    if (etaitImpose) { mode = 'sol'; grounded = false; vy = 0; }

    // ---- echelle : l'acteur immobile dans une cellule d'echelle monte jusqu'au bout de la colonne
    const bouge = Math.hypot(xd - X[k - 1], zd - Z[k - 1]) > 0.05;
    if (climb) {
      if (bouge || !celluleEchelle(xe, y + 0.01, ze)) { climb = null; mode = 'sol'; grounded = false; vy = 0; } else {
        y = Math.min(climb.haut, y + VITESSE_ECHELLE_MONTE); vy = 0; mode = 'ech'; grounded = false;
        ecrire(k, 'ech'); continue;
      }
    } else if (!bouge && Math.hypot(X[k + 1] - xd, Z[k + 1] - zd) < 0.05 && mode !== 'eau' && celluleEchelle(xe, y + 0.01, ze) && celluleEchelle(xe, y + 1.01, ze)) {
      let h = Math.floor(y + 0.01) + 1;
      while (celluleEchelle(xe, h + 0.01, ze) && h < Math.floor(y) + 200) h++;
      climb = { haut: h - 0.05 }; mode = 'ech'; grounded = false;
      y = Math.min(climb.haut, y + VITESSE_ECHELLE_MONTE); vy = 0;
      ecrire(k, 'ech'); continue;
    }
    if (mode === 'ech') { mode = 'sol'; grounded = false; vy = 0; }

    let g = gAt(xe, ze);
    const w = eauEn(xe, ze);
    let ny = y + vy;
    const profondeur = w !== null && g !== null ? w - g : 0;

    // ---- eau profonde : on flotte a la surface (ressort amorti, 0,8 par tick comme le jeu)
    if (w !== null && profondeur >= SEUIL_NAGE && (mode === 'eau' || ny < w)) {
      if (mode !== 'eau') brut.push({ k, type: 'eau', x: xe, z: ze, prof: profondeur, vitesse: -vy, y: y });
      let cible = Math.max(g, w - NAGE_FLOTTE) + bob(k);
      let gMax = g;
      for (let j = 1; j <= 4; j++) { const gj = gAt(X[k + j], Z[k + j]); if (gj !== null && gj > gMax && gj <= w + 1.2) gMax = gj; }
      let vNext = vy * 0.8 + Math.min(0.04, Math.max(-0.05, 0.05 * (cible - ny)));
      if (gMax > ny + 0.02 && gMax > cible) vNext = Math.min(0.3, (gMax - ny) * 0.6 + 0.05);   // on se hisse sur la berge (le jeu : 0,3)
      if (ny < g) { ny = g; vNext = Math.max(0, vNext); }
      y = ny; vy = vNext; grounded = false; mode = 'eau';
      ecrire(k, 'eau'); continue;
    }
    if (mode === 'eau') mode = 'sol';

    // ---- marche, saut, chute
    const etaitAuSol = grounded;
    let saute = false;
    if (grounded) {
      const p = planSaut(k);
      if (p && p.kj <= k) { saute = true; vy = VITESSE_SAUT; ny = y + vy; SAUTE[k] = 1; brut.push({ k, type: 'saut', x: xe, z: ze, haut: p.r, y }); }
    }
    const vyApplique = vy;
    let gd = g === null ? y : g;
    // ground plus haut que les pieds (apres le mouvement vertical si on monte) : marche de moins de 0,6 = on monte sans sauter ; sinon mur
    let r = gd - Math.max(y, ny);
    if (r > 1e-6) {
      if (r <= HAUTEUR_PAS + 1e-9) {
        ny = gd; if (vy < 0) vy = 0;
        if (etaitAuSol && r > 0.02) PAS[k] = r;
      } else {                                                    // mur : le deplacement horizontal est bloque
        if (gd - y > SAUT_MAX - 0.004 && !bloque && !saute) {
          const m = sol.sous(xd, zd);
          const b = m ? bloc(Math.floor(m.x), Math.ceil(m.y) - 1, Math.floor(m.z)) : null;
          brut.push({ k, type: 'obstacle', x: xPrec, z: zPrec, bloc: nomBloc(b) || 'bloc', haut: gd - y });
          bloque = { x: xPrec, z: zPrec };
        }
        xe = xPrec; ze = zPrec; horizModifie = true;
        g = gAt(xe, ze); gd = g === null ? y : g; r = gd - Math.max(y, ny);
        if (r > 1e-6) { ny = gd; if (vy < 0) vy = 0; }
      }
    }
    const pose = ny <= gd + 1e-6 && vy <= 0 && !(saute);
    if (pose) {
      if (!etaitAuSol && !saute) {
        const enEau = w !== null && w > gd;
        IMPACT[k] = enEau ? -vyApplique * 0.5 : -vyApplique;
      }
      ny = gd; grounded = true; y = ny; vy = -GRAVITE * TRAINEE;
    } else { grounded = false; y = ny; vy = (vy - GRAVITE) * TRAINEE; }
    ecrire(k, 'sol');
  }

  // ---- derives : decollages, atterrissages (+ chute depuis le sommet), facteur d'air lisse
  // profondeur d'eau sous l'acteur (surface - sol) et presence sur une echelle (auto ou hauteur imposee), tick par tick
  const PROF = new Float64Array(K + 1), SURECH = new Uint8Array(K + 1);
  for (let k = 0; k <= K; k++) {
    const w = eauEn(XE[k], ZE[k]), g = gAt(XE[k], ZE[k]);
    PROF[k] = w !== null && g !== null && w > g ? w - g : 0;
    SURECH[k] = ECH[k] || (IMP[k] && celluleEchelle(XE[k], Y[k] + 0.01, ZE[k])) ? 1 : 0;
  }
  const decollages = [], atterrissages = [];
  let sommet = null, depuis = -1, depuisY = 0;
  for (let k = 1; k <= K; k++) {
    if (SAUTE[k]) decollages.push({ k, t: reel((k - 1) * TICK), tw: (k - 1) * TICK });   // les pieds quittent le sol au debut du tick
    if (AIR[k] && !AIR[k - 1]) { sommet = Math.max(Y[k], Y[k - 1]); depuis = k; depuisY = Y[k - 1]; }
    if (AIR[k] && sommet !== null) sommet = Math.max(sommet, Y[k]);
    if (SOL[k] && !SOL[k - 1] && !EAU[k] && IMPACT[k] > 0 && IMP[k] === 0) {
      atterrissages.push({ k, t: reel(k * TICK), tw: k * TICK, impact: IMPACT[k], chute: Math.max(0, (sommet ?? Y[k]) - Y[k]), depuis, departY: depuisY, y: Y[k], x: XE[k], z: ZE[k] });
      sommet = null;
    }
    if (EAU[k]) sommet = null;
  }
  const lisse = new Float64Array(K + 1);
  let s = 0;
  for (let k = 0; k <= K; k++) { s += (AIR[k] - s) * 0.5; lisse[k] = s; }

  const interp = (T, tm) => {
    const u = Math.max(0, tm / TICK), k = Math.min(K - 1, Math.floor(u)), a = Math.min(1, u - k);
    return T[k] + (T[k + 1] - T[k]) * a;
  };
  const plus = (T, tm) => { const u = Math.max(0, tm / TICK); return T[Math.min(K, Math.round(u))]; };
  return {
    ticks: K, x: XE, z: ZE, y: Y, vy: VY, sol: SOL, air: AIR, eau: EAU, echelle: ECH, imp: IMP, horizModifie,
    decollages, atterrissages, brut, pas: PAS, reel, lisse, X, Z, YI, prof: PROF, surEchelle: SURECH,
    // etat au temps du monde tm (secondes) : y et position interpolees, drapeaux du tick le plus proche
    etatA(tm) {
      return {
        y: interp(Y, tm), x: interp(XE, tm), z: interp(ZE, tm), vy: interp(VY, tm) * 20,
        auSol: plus(SOL, tm) === 1, eau: plus(EAU, tm) === 1, echelle: plus(ECH, tm) === 1, imp: plus(IMP, tm) === 1, air: interp(lisse, tm),
      };
    },
  };
}

export { lisser01 };
