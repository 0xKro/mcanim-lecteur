// Canne a peche (FishingRodItem, FishingHook ; docs/SIMULATION.md partie 26). Port de Horizon horizon-client/src/game/fishing.rs (MIT, voir
// ATTRIBUTIONS.md), chiffres relus la :
//   - lancer : depart aux yeux, 0,3 derriere le lacet ; vitesse (-sin, clamp(-sin(t)/-cos(t), -5, 5), -cos) normalisee x (0,6 + triangle(0,5 ; 0,0103365))
//     par axe ; son entity.fishing_bobber.throw (0,5 ; 0,4 / (r x 0,4 + 0,8)) ; Appat : 5 s de moins par niveau (fishing_time_reduction) ;
//     Chance de la mer : chance + niveau (fishing_luck_bonus) + effets Chance / Malchance ;
//   - vol : gravite 0,03, frein 0,92 ; touche une creature (marge 0 a 0,3 selon l'age) -> accrochee ; un bloc : s'arrete ; l'eau : x (0,3 ; 0,2 ; 0,3) et flotte ;
//   - flotte : force = y + vy - surface de l'eau, vy -= force x r x 0,2, x 0,9 a l'horizontale ; eau libre (5 x 5 x 4 autour) ;
//   - attente du poisson : 100 a 600 ticks moins l'Appat (x 2 plus vite sous la pluie une fois sur 4, moitie sous un toit une fois sur 2), le poisson
//     arrive en 20 a 80 ticks (bulles, sillage), la touche dure 20 a 40 ticks (plongee -0,4 x [0,6 ; 1], son entity.fishing_bobber.splash 0,25) ;
//   - ramener : creature accrochee -> tiree de 0,1 x (joueur - bouchon) (usure 5 ; objet 3) ; touche -> butin du jeu (gameplay/fishing : poisson 85,
//     dechet 10 (-2 par chance), tresor 5 (+2 par chance, eau libre seulement)), objet lance vers le joueur, 1 a 6 d'experience ; posee au sol : 2 ;
//     son entity.fishing_bobber.retrieve ; a plus de 32 blocs, ou sans canne en main, le bouchon disparait.
import { Aleatoire } from './aleatoire.js';
import { sinMth, cosMth, DEG_RAD } from './mth.js';
import { coupeCible } from './projectiles.js';
import { deplacerBoite } from './collision.js';
import { tirerTable } from './butin-jeu.js';
import { idDe, lirePile } from './pile.js';

const TAILLE = 0.25;
const triangle = (h, m, d) => m + d * (h.reel() - h.reel());

export function lancerBouchon(sim, a) {
  const canne = a.main.objet;
  const h0 = sim.hasard;
  sim.son('entity.fishing_bobber.throw', a.x, a.y, a.z, 0.5, 0.4 / (h0.flottant() * 0.4 + 0.8));
  const lure = sim.objetsJeu ? Math.trunc(sim.enchant.valeurPile(canne, 'fishing_time_reduction', { outil: 'fishing_rod' }, 0) * 20) : (lirePile(canne).ench.lure ?? 0) * 100;
  const chance = sim.objetsJeu ? Math.trunc(sim.enchant.valeurPile(canne, 'fishing_luck_bonus', { outil: 'fishing_rod' }, 0)) : (lirePile(canne).ench.luck_of_the_sea ?? 0);
  const ya = Math.fround(-a.lacetTete * DEG_RAD - Math.PI), pa = Math.fround(-a.tangage * DEG_RAD);
  const ys = sinMth(ya), yc = cosMth(ya), xc = -cosMth(pa), xs = sinMth(pa);
  const dy = Math.max(-5, Math.min(5, -(xs / xc)));
  const r = new Aleatoire(h0.entier());
  const L = Math.hypot(-ys, dy, -yc);
  const v = [-ys * (0.6 / L + triangle(r, 0.5, 0.0103365)), dy * (0.6 / L + triangle(r, 0.5, 0.0103365)), -yc * (0.6 / L + triangle(r, 0.5, 0.0103365))];
  const E = sim.entites;
  const e = { id: E.prochain++, type: 'bouchon', x: a.x - ys * 0.3, y: a.oeil()[1], z: a.z - yc * 0.3, vx: v[0], vy: v[1], vz: v[2], debut: sim.temps, etat: 'vol', proprietaire: a.nom,
    age: 0, vie: 0, auSol: false, morsure: 0, attenteLeurre: 0, attenteTouche: 0, angle: 0, horsEau: 0, eauLibre: true, chance, lure, r, accroche: null };
  e.tickPerso = (x) => tickBouchon(sim, x);
  e.ecrirePerso = (x) => {
    sim.replay.entite(sim.temps, x.id, 'bouchon', x.x, x.y, x.z, sim.acteurs?.parNom.get(x.proprietaire)?.id ?? -1, x.morsure > 0 ? 1 : 0);
    // FishingHookRenderer.getPlayerHandPos (3e personne) : yeux + (-cos x 0,35 - sin x 0,8 ; -0,45 (accroupi -0,1875 de plus) ; -sin x 0,35 + cos x 0,8),
    // angle = lacet du corps ; le fil part de la canne et pend en (a^2 + a) / 2 jusqu'a 0,25 au-dessus du bouchon (film/entites-monde.js)
    const o = sim.acteurs?.parNom.get(x.proprietaire);
    if (o) { const an = o.lacet * Math.PI / 180, s = Math.sin(an), c = Math.cos(an), oe = o.oeil(); (sim.replay.peche ??= []).push([sim.temps, x.id, oe[0] - c * 0.35 - s * 0.8, oe[1] - 0.45 - (o.accroupi ? 0.1875 : 0), oe[2] - s * 0.35 + c * 0.8]); }
  };
  E.liste.push(e);
  a.bouchon = e;
  sim.stats.peche = (sim.stats.peche || 0) + 1;
  return e;
}

function hauteurEau(sim, x, y, z) {
  const f = sim.fluide(x, y, z);
  if (f.type !== 'water') return 0;
  return sim.fluide(x, y + 1, z).type === 'water' ? 1 : f.quantite / 9;
}

function tickBouchon(sim, h) {
  const a = sim.acteurs?.parNom.get(h.proprietaire);
  if (!a || a.mort >= 0 || idDe(a.main.objet) !== 'fishing_rod' || (h.x - a.x) ** 2 + (h.y - a.y) ** 2 + (h.z - a.z) ** 2 > 1024) { if (a && a.bouchon === h) a.bouchon = null; return false; }
  h.age++;
  if (h.auSol) { if (++h.vie >= 1200) { a.bouchon = null; return false; } } else h.vie = 0;
  const b = [Math.floor(h.x), Math.floor(h.y), Math.floor(h.z)];
  const eau = hauteurEau(sim, ...b), dansEau = eau > 0;
  if (h.etat === 'vol') {
    if (dansEau) { h.vx *= 0.3; h.vy *= 0.2; h.vz *= 0.3; h.etat = 'flotte'; return true; }
    // contact avec une creature ou un acteur (pas le pecheur) : marge (age - 2) / 20 bornee a 0,3
    const marge = Math.max(0, Math.min(6, h.age - 2)) / 20, p0 = [h.x, h.y + TAILLE / 2, h.z], d = [h.vx, h.vy, h.vz];
    let best = null;
    for (const o of sim.acteurs.liste) {
      if (o === a || o.mort >= 0) continue;
      const c = coupeCible(o, p0, d, marge);
      if (c && (!best || c.t < best.t)) best = { o, t: c.t };
    }
    if (best) { h.etat = 'accroche'; h.accroche = best.o; h.vx = 0; h.vy = 0; h.vz = 0; sim.dire(`bouchon de ${a.nom} accroche ${best.o.nom}`); return true; }
  } else if (h.etat === 'accroche') {
    const o = h.accroche;
    if (!o || o.mort >= 0) { h.etat = 'vol'; h.accroche = null; }
    else { h.x = o.x; h.y = o.y + o.H * 0.8; h.z = o.z; return true; }
  } else if (h.etat === 'flotte') {
    let force = h.y + h.vy - b[1] - eau;
    if (Math.abs(force) < 0.01) force += Math.sign(force) * 0.1;
    const r = h.r.flottant();
    h.vx *= 0.9; h.vy -= force * r * 0.2; h.vz *= 0.9;
    if (h.morsure <= 0 && h.attenteTouche <= 0) h.eauLibre = true;
    else h.eauLibre = h.eauLibre && h.horsEau < 10 && eauLibre(sim, b);
    if (dansEau) {
      h.horsEau = Math.max(0, h.horsEau - 1);
      if (h.morsure > 0) { const sr = new Aleatoire(h.id ^ sim.temps); h.vy += -0.1 * sr.flottant() * sr.flottant(); }
      attraper(sim, h, b, a);
    } else h.horsEau = Math.min(10, h.horsEau + 1);
  }
  if (!dansEau && !h.auSol) h.vy -= Math.fround(0.03);
  const boite = [h.x - TAILLE / 2, h.y, h.z - TAILLE / 2, h.x + TAILLE / 2, h.y + TAILLE, h.z + TAILLE / 2];
  const r = deplacerBoite(sim.acteurs.lec, boite, [h.vx, h.vy, h.vz], h.auSol, 0);
  const vy0 = h.vy;
  h.x += r.dx; h.y += r.dy; h.z += r.dz;
  h.auSol = vy0 < 0 && r.dy > vy0;
  if (h.etat === 'vol' && (h.auSol || r.bloqueX || r.bloqueZ)) { h.vx = 0; h.vy = 0; h.vz = 0; }
  h.vx *= 0.92; h.vy *= 0.92; h.vz *= 0.92;
  return true;
}

// FishingHook.calculateOpenWater : 4 couches (y-1..y+2) de 5 x 5 ; chaque couche uniforme : eau (0), air ou nenuphar (1) ; dessous d'abord de l'eau
function eauLibre(sim, b) {
  let prec = 2;
  for (let dy = -1; dy <= 2; dy++) {
    let c = null;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const x = b[0] + dx, y = b[1] + dy, z = b[2] + dz, e = sim.monde.etatEn(x, y, z), f = sim.fluide(x, y, z);
      const n = e >= 0 ? sim.d.nomBloc(e) : '';
      const t = /^(air|cave_air|lily_pad)$/.test(n) ? 1 : (n === 'water' || (f.type === 'water' && f.source)) && f.type === 'water' ? 0 : 2;
      c = c === null ? t : c === t ? c : 2;
    }
    if (c === 2 || (c === 0 && prec === 2) || (c === 1 && prec === 0)) return false;
    prec = c;
  }
  return true;
}

// FishingHook.catchingFish
function attraper(sim, h, b, a) {
  const R = h.r;
  let vitesse = 1;
  const l = sim.api.lumiere?.(b[0], b[1] + 1, b[2]);
  const ciel = l ? l.ciel >= 15 : true;
  if (R.flottant() < 0.25 && sim.meteo?.pleut(sim.temps) && ciel) vitesse++;
  if (R.flottant() < 0.5 && !ciel) vitesse--;
  if (h.morsure > 0) { if (--h.morsure <= 0) { h.attenteLeurre = 0; h.attenteTouche = 0; } return; }
  if (h.attenteTouche > 0) {
    h.attenteTouche -= vitesse;
    if (h.attenteTouche > 0) {
      h.angle += triangle(R, 0, 9.188);
      const ang = h.angle * DEG_RAD, s = sinMth(ang), c = cosMth(ang), d = h.attenteTouche * 0.1;
      const f = [h.x + s * d, Math.floor(h.y) + 1, h.z + c * d];
      if (sim.monde.etatEn(Math.floor(f[0]), Math.floor(f[1] - 1), Math.floor(f[2])) >= 0 && sim.fluide(Math.floor(f[0]), Math.floor(f[1] - 1), Math.floor(f[2])).type === 'water') {
        if (R.flottant() < 0.15) sim.particule('bubble', f[0], f[1] - 0.1, f[2], s, 0.1, c, 1);
        sim.particule('fishing', f[0], f[1], f[2], c * 0.04, 0.01, -s * 0.04, 1);
        sim.particule('fishing', f[0], f[1], f[2], -c * 0.04, 0.01, s * 0.04, 1);
      }
      return;
    }
    // la touche
    sim.son('entity.fishing_bobber.splash', h.x, h.y, h.z, 0.25, 1 + (R.flottant() - R.flottant()) * 0.4);
    const n = Math.floor(1 + TAILLE * 20);
    for (let i = 0; i < n; i++) { sim.particule('bubble', h.x + (R.flottant() - 0.5) * TAILLE * 2, h.y + 0.5, h.z + (R.flottant() - 0.5) * TAILLE * 2, 0, 0.2, 0, 1); sim.particule('fishing', h.x + (R.flottant() - 0.5) * TAILLE * 2, h.y + 0.5, h.z + (R.flottant() - 0.5) * TAILLE * 2, 0, 0.2, 0, 1); }
    h.morsure = 20 + R.entierBorne(21);
    const sr = new Aleatoire(h.id ^ sim.temps);
    h.vy = Math.fround(-0.4 * Math.fround(sr.flottant() * Math.fround(1 - 0.6) + 0.6));
    h.touche = sim.temps;
    sim.dire(`${a.nom} : ca mord (bouchon en ${h.x.toFixed(1)},${h.y.toFixed(1)},${h.z.toFixed(1)})`);
    (sim.stats.morsures ??= []).push(sim.temps);
    if (a.tache?.ferre && a.tache.acte.verbe === 'utilise') a.tache.ramener = true;   // {"ferre": true} : il ramene au moment de la touche
    return;
  }
  if (h.attenteLeurre > 0) {
    h.attenteLeurre -= vitesse;
    let tease = 0.15;
    if (h.attenteLeurre < 20) tease += (20 - h.attenteLeurre) * 0.05; else if (h.attenteLeurre < 40) tease += (40 - h.attenteLeurre) * 0.02; else if (h.attenteLeurre < 60) tease += (60 - h.attenteLeurre) * 0.01;
    if (R.flottant() < tease) {
      const ang = R.flottant() * 360 * DEG_RAD, d = R.flottant() * 35 + 25;
      const f = [h.x + sinMth(ang) * d * 0.1, Math.floor(h.y) + 1, h.z + cosMth(ang) * d * 0.1];
      if (sim.fluide(Math.floor(f[0]), Math.floor(f[1] - 1), Math.floor(f[2])).type === 'water') sim.particule('splash', f[0], f[1], f[2], 0.1, 0, 0.1, 2 + R.entierBorne(2));
    }
    if (h.attenteLeurre <= 0) { h.angle = R.flottant() * 360; h.attenteTouche = 20 + R.entierBorne(61); }
    return;
  }
  h.attenteLeurre = 100 + R.entierBorne(501) - h.lure;
}

// FishingHook.retrieve : rend l'usure de la canne
export function ramener(sim, a) {
  const h = a.bouchon;
  a.bouchon = null;
  if (!h) return 0;
  sim.entites._fini?.add(h); h.detruit = true;
  let usure = 0;
  if (h.etat === 'accroche' && h.accroche) {
    const o = h.accroche;
    o.vx += (a.x - h.x) * 0.1; o.vy += (a.y - h.y) * 0.1; o.vz += (a.z - h.z) * 0.1; o.auSol = false;
    sim.dire(`${a.nom} tire ${o.nom} avec la canne`);
    usure = 5;
  } else if (h.morsure > 0) {
    const oj = sim.objetsJeu;
    const prises = oj ? tirerTable(oj, 'gameplay/fishing', { sim, hasard: sim.hasard, chance: h.chance + (a.chance?.() ?? 0), eauLibre: h.eauLibre, biome: sim.zone.biome?.(Math.floor(h.x), Math.floor(h.z)) }) : [['cod', 1]];
    for (const [t, n] of prises) {
      const dx = a.x - h.x, dy = a.y - h.y, dz = a.z - h.z;
      sim.entites.objet(t, n, h.x, h.y, h.z, { vx: dx * 0.1, vy: dy * 0.1 + Math.sqrt(Math.sqrt(dx * dx + dy * dy + dz * dz)) * 0.08, vz: dz * 0.1, delai: 0 });
      sim.entites.orbes?.(a.x, a.y + 0.5, a.z + 0.5, h.r.entierBorne(6) + 1);
      (sim.stats.prises ??= []).push(`${(sim.temps / 20).toFixed(2)} ${a.nom} ${t} x${n}`);
      sim.dire(`${a.nom} peche ${n} ${t}`);
    }
    usure = 1;
  }
  if (h.auSol) usure = 2;
  return usure;
}
