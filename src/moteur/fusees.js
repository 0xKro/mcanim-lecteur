// Fusees d'artifice (FireworkRocketItem, FireworkRocketEntity) : port d'apres Horizon horizon-client/src/game/fireworks.rs et crossbow.rs
// (MIT, voir ATTRIBUTIONS.md) ; chiffres du jeu 26.3 relus dans ces fichiers et dans entity-types.json (boite 0,25, yeux 0,2125).
//   - composant de l'objet (`fusee` d'une intention) : { flight_duration (0 a 255, l'objet seul : 1), explosions: [{ shape: small_ball |
//     large_ball | star | creeper | burst, colors: [couleurs], fade_colors: [couleurs], has_trail, has_twinkle }] } ; une couleur : un nom de
//     teinture (couleurs de feu d'artifice de DyeColor) ou un entier 0xRRGGBB ;
//   - lancee d'un bloc (`utilise x y z` en tenant "firework_rocket") : au point vise + 0,15 x la face ; vitesse (triangle(0 ; 0,002297), 0,05,
//     triangle) ; duree de vie 10 x (1 + vol) + 0..5 + 0..6 ticks ; chaque tick x 1,15 a l'horizontale et + 0,04 vers le haut (fusee tiree
//     de biais, a l'arbalete : vitesse constante, 1,6) ; son entity.firework_rocket.launch (3) au premier tick ;
//   - elle touche un vivant (boite elargie de clamp((age - 1) / 20 ; 0 ; 0,3)) : elle eclate ; un breeze la renvoie (x -0,5) ; un bloc : elle
//     eclate si elle porte des explosions, sinon elle continue jusqu'a sa fin ;
//   - eclatement : les vivants a 5 blocs (pieds) qu'elle voit (pieds ou milieu, rayon des formes de collision) prennent
//     (5 + 2 x explosions) x racine((5 - d) / 5) (degats `fireworks`, recul depuis la fusee) ; GameEvent EXPLODE ; le film dessine les
//     etincelles et joue les sons (film/effets-monde.js), sans explosion : 2 a 4 bouffees `poof`.
// Le souffle des explosions la pousse (moteur/explosion.js). En vol plane aux elytres, `utilise` en tenant la fusee l'accroche au joueur
// (suivreAttache : propulsion du jeu ; elle n'est pas dessinee, seule sa trainee l'est).
import { deplacerBoite } from './collision.js';
import { vecteurRegard } from './mth.js';
import { coupeBlocs, coupeCible } from './projectiles.js';
import { coupeSegment } from './explosion.js';

// DyeColor.getFireworkColor (Horizon horizon-items/src/firework.rs DYE_FIREWORK_COLORS)
export const TEINTURES_ARTIFICE = { white: 0xF0F0F0, orange: 0xEB8844, magenta: 0xC354CD, light_blue: 0x6689D3, yellow: 0xDECF2A, lime: 0x41CD34, pink: 0xD88198, gray: 0x434343, light_gray: 0xABABAB, cyan: 0x287697, purple: 0x7B2FBE, blue: 0x253192, brown: 0x51301A, green: 0x3B511A, red: 0xB3312C, black: 0x1E1B1B };
export const FORMES_ARTIFICE = ['small_ball', 'large_ball', 'star', 'creeper', 'burst'];
const DEMI = 0.125;

// Lit et controle le composant `fireworks` d'une scene ; rend { vol, explosions: [{ forme, couleurs, fondu, trainee, scintille }] } ou leve une Error
export function lireFusee(spec) {
  if (spec === undefined || spec === null) return { vol: 1, explosions: [] };
  if (typeof spec !== 'object' || Array.isArray(spec)) throw new Error('fusee : objet attendu, par exemple {"flight_duration": 2, "explosions": [{"shape": "star", "colors": ["red"]}]}');
  for (const k of Object.keys(spec)) if (!['flight_duration', 'explosions'].includes(k)) throw new Error(`fusee : champ "${k}" inconnu (flight_duration, explosions)`);
  const vol = spec.flight_duration ?? 1;
  if (!Number.isInteger(vol) || vol < 0 || vol > 255) throw new Error('fusee.flight_duration : entier de 0 a 255 attendu (fusee fabriquee : 1 a 3)');
  const ex = spec.explosions ?? [];
  if (!Array.isArray(ex) || ex.length > 256) throw new Error('fusee.explosions : liste de 256 explosions au plus attendue');
  const couleur = (c, ch) => {
    if (typeof c === 'string') { const v = TEINTURES_ARTIFICE[c.replace(/^minecraft:/, '')]; if (v === undefined) throw new Error(`${ch} : teinture inconnue "${c}" (${Object.keys(TEINTURES_ARTIFICE).join(', ')})`); return v; }
    if (Number.isInteger(c) && c >= 0 && c <= 0xFFFFFF) return c;
    throw new Error(`${ch} : nom de teinture ou entier 0xRRGGBB attendu`);
  };
  return {
    vol,
    explosions: ex.map((e, i) => {
      const ch = `fusee.explosions[${i}]`;
      if (!e || typeof e !== 'object') throw new Error(`${ch} : objet attendu`);
      for (const k of Object.keys(e)) if (!['shape', 'colors', 'fade_colors', 'has_trail', 'has_twinkle'].includes(k)) throw new Error(`${ch} : champ "${k}" inconnu (shape, colors, fade_colors, has_trail, has_twinkle)`);
      const forme = e.shape ?? 'small_ball';
      if (!FORMES_ARTIFICE.includes(forme)) throw new Error(`${ch}.shape : ${FORMES_ARTIFICE.join(', ')} attendu`);
      return { forme, couleurs: (e.colors ?? []).map((c, j) => couleur(c, `${ch}.colors[${j}]`)), fondu: (e.fade_colors ?? []).map((c, j) => couleur(c, `${ch}.fade_colors[${j}]`)), trainee: !!e.has_trail, scintille: !!e.has_twinkle };
    }),
  };
}

// triangle(mode, ecart) du hasard du jeu : mode + ecart x (r - r)
const triangle = (h, mode, ecart) => mode + ecart * (h.flottant() - h.flottant());

// FireworkRocketEntity(level, x, y, z, stack) : la vitesse puis la duree de vie, tirees du hasard
export function nouvelleFusee(sim, proprietaire, pos, fusee, opt = {}) {
  const h = sim.hasard, P = sim.entites.proj;
  const v = [triangle(h, 0, 0.002297), 0.05, triangle(h, 0, 0.002297)];
  const duree = 10 * (1 + fusee.vol) + h.entierBorne(6) + h.entierBorne(7);
  const e = P.creer('fusee', proprietaire, pos, opt.vitesse ?? v, { sansHerite: true, vieFusee: 0, duree, explosions: fusee.explosions, oblique: !!opt.oblique, objet: 'firework_rocket', attache: opt.attache && proprietaire ? proprietaire.nom : null });
  if (e) sim.dire(`fusee ${e.attache ? 'accrochee a ' + e.attache : 'lancee en ' + pos.map((c) => c.toFixed(2)).join(',')} (vol ${fusee.vol}, duree ${duree} ticks, ${fusee.explosions.length} explosion(s)${opt.oblique ? ', de biais' : ''})`);
  return e;
}

// FireworkRocketEntity.tick d'une fusee accrochee a un vivant (attachedToEntity) : s'il plane, propulsion vers son regard
// v + regard x 0,1 + (regard x 1,5 - v) x 0,5 (regard : Mth, comme le jeu) ; la fusee se place a la main qui la tient (calculateViewVector(0,
// lacet + 80) x 0,5 : main droite), avec la vitesse du vivant ; elle peut toucher un autre vivant (elle eclate alors).
function suivreAttache(s, e, a) {
  if (a.planeur) {
    const L = vecteurRegard(a.tangage, a.lacetTete);
    a.vx = a.vx + L[0] * 0.1 + (L[0] * 1.5 - a.vx) * 0.5;
    a.vy = a.vy + L[1] * 0.1 + (L[1] * 1.5 - a.vy) * 0.5;
    a.vz = a.vz + L[2] * 0.1 + (L[2] * 1.5 - a.vz) * 0.5;
  }
  const m = vecteurRegard(0, a.lacetTete + 80);
  e.x = a.x + m[0] * 0.5; e.y = a.y + m[1] * 0.5; e.z = a.z + m[2] * 0.5;
  e.vx = a.vx; e.vy = a.vy; e.vz = a.vz;
}

// FireworkRocketEntity.tick ; rend vrai si elle continue
export function tickFusee(P, e) {
  const s = P.sim, lec = P.lec();
  const prop = s.acteurs?.parNom.get(e.proprietaire) ?? null;
  if (e.attache) {
    const a = s.acteurs?.parNom.get(e.attache);
    if (a && a.mort < 0) suivreAttache(s, e, a);
    // hitTargetOrDeflectSelf (getHitResultOnMoveVector) : un autre vivant sur le chemin la fait eclater
    const from = [e.x, e.y, e.z], d = [e.vx, e.vy, e.vz], bloc = coupeBlocs(lec, from, [e.x + d[0], e.y + d[1], e.z + d[2]]);
    const marge = Math.max(0, Math.min(0.3, (e.vieFusee - 1) / 20));
    let cible = null;
    for (const o of s.acteurs ? s.acteurs.liste : []) { if (o.mort >= 0 || o === a) continue; const r = coupeCible(o, from, d, marge); if (r && (!cible || r.t < cible.t)) cible = { t: r.t, a: o }; }
    if (cible) e.vieFusee = e.duree; else if (bloc && e.explosions.length) e.vieFusee = e.duree;
    if (e.vieFusee === 0) s.son('entity.firework_rocket.launch', e.x, e.y, e.z, 3, 1);
    e.vieFusee++;
    s.replay.particule(s.temps, 'firework', e.x, e.y, e.z, 0, -e.vy * 0.5, 0, 1);
    if (e.vieFusee > e.duree) { eclater(s, e); return false; }
    return true;
  }
  // Projectile.tick : a-t-elle quitte son lanceur (boite elargie vers la vitesse puis de 1) ?
  if (!e.quitte) {
    const b = [e.x - DEMI, e.y, e.z - DEMI, e.x + DEMI, e.y + 2 * DEMI, e.z + DEMI];
    for (let k = 0; k < 3; k++) { if (e['v' + 'xyz'[k]] < 0) b[k] += e['v' + 'xyz'[k]]; else b[k + 3] += e['v' + 'xyz'[k]]; }
    for (let k = 0; k < 3; k++) { b[k] -= 1; b[k + 3] += 1; }
    const pb = prop?.boite();
    e.quitte = !pb || !(pb[0] < b[3] && pb[3] > b[0] && pb[1] < b[4] && pb[4] > b[1] && pb[2] < b[5] && pb[5] > b[2]);
  }
  // Entity.baseTick (updateFluidInteraction) : le courant de l'eau la pousse de 0,014
  const cx = Math.floor(e.x), cy = Math.floor(e.y + DEMI), cz = Math.floor(e.z);
  if (s.fluide(cx, cy, cz).type === 'water') { const c = s.courant(cx, cy, cz); e.vx += c[0] * 0.014; e.vy += c[1] * 0.014; e.vz += c[2] * 0.014; }
  const mvt = e.oblique ? [e.vx, e.vy, e.vz] : [e.vx * 1.15, e.vy + 0.04, e.vz * 1.15];
  // ProjectileUtil.getHitResultOnMoveVector avant le deplacement : le bloc coupe (formes de collision), puis le vivant le plus proche avant lui
  const from = [e.x, e.y, e.z];
  let to = [e.x + mvt[0], e.y + mvt[1], e.z + mvt[2]];
  const bloc = coupeBlocs(lec, from, to);
  if (bloc) to = bloc.pos;
  const marge = Math.max(0, Math.min(0.3, (e.vieFusee - 1) / 20)), d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  let cible = null;
  for (const a of s.acteurs ? s.acteurs.liste : []) {
    if (a.mort >= 0 || (a === prop && !e.quitte)) continue;
    const r = coupeCible(a, from, d, marge);   // le dragon : ses parties seulement
    if (r && (!cible || r.t < cible.t)) cible = { t: r.t, a };
  }
  // deplacement (Entity.move : les blocs arretent) ; un choc de cote garde la vitesse horizontale d'avant
  const r = deplacerBoite(lec, [e.x - DEMI, e.y, e.z - DEMI, e.x + DEMI, e.y + 2 * DEMI, e.z + DEMI], mvt, false, 0);
  e.x += r.dx; e.y += r.dy; e.z += r.dz;
  const cote = Math.abs(r.dx - mvt[0]) > 1e-7 || Math.abs(r.dz - mvt[2]) > 1e-7;
  if (cote) { e.vy = mvt[1]; } else { e.vx = mvt[0]; e.vy = mvt[1]; e.vz = mvt[2]; }
  // hitTargetOrDeflectSelf : un breeze la renvoie (ProjectileDeflection.REVERSE), un autre vivant la fait eclater ; un bloc, si elle a des explosions
  if (cible && (cible.a.typeCreature === 'breeze' || cible.a.ia?.type === 'breeze')) { e.vx *= -0.5; e.vy *= -0.5; e.vz *= -0.5; s.son('entity.breeze.deflect', cible.a.x, cible.a.y, cible.a.z, 1, 1); }
  else if (cible) e.vieFusee = e.duree;
  else if (bloc && e.explosions.length) e.vieFusee = e.duree;
  if (e.vieFusee === 0) s.son('entity.firework_rocket.launch', e.x, e.y, e.z, 3, 1);
  e.vieFusee++;
  s.replay.particule(s.temps, 'firework', e.x, e.y, e.z, 0, -e.vy * 0.5, 0, 1);   // trainee (client : une etincelle par tick, film/effets-monde.js)
  if (e.vieFusee > e.duree) { eclater(s, e); return false; }
  return true;
}

// FireworkRocketEntity.explode et dealExplosionDamage
function eclater(s, e) {
  s.vibrations?.emettre('explode', e.x, e.y, e.z, { source: e.proprietaire });
  const n = e.explosions.length, lec = { d: s.d, etatEn: (x, y, z) => s.monde.etatEn(x, y, z) };
  if (n) {
    const q = 5 + n * 2, from = [e.x, e.y, e.z];
    // le vivant qui porte la fusee (propulsion aux elytres) prend les degats entiers, sans recul (attachedToEntity.hurt)
    const porteur = e.attache ? s.acteurs?.parNom.get(e.attache) : null;
    if (porteur && porteur.mort < 0) { porteur.degats(q, 'fusee'); s.dire(`fusee : ${porteur.nom} (qui la porte) prend ${q}`); }
    for (const a of s.acteurs ? [...s.acteurs.liste] : []) {
      if (a.mort >= 0 || a === porteur) continue;
      const d2 = (a.x - e.x) ** 2 + (a.y - e.y) ** 2 + (a.z - e.z) ** 2;
      if (d2 > 25) continue;
      const H = a.boite()[4] - a.boite()[1];
      if (![0, 1].some((k) => !coupeSegment(lec, from, [a.x, a.y + H * 0.5 * k, a.z]))) continue;
      // Entity.distanceTo en flottants, puis damage x sqrt((5 - d) / 5)
      const fx = Math.fround(e.x - a.x), fy = Math.fround(e.y - a.y), fz = Math.fround(e.z - a.z);
      const dist = Math.fround(Math.sqrt(Math.fround(Math.fround(fx * fx) + Math.fround(fy * fy)) + Math.fround(fz * fz)));
      const deg = Math.fround(q * Math.sqrt((5 - dist) / 5));
      if (a.frappe(deg, 'fusee', e.x - a.x, e.z - a.z, Math.fround(0.4))) s.stats.fuseesBlessures = (s.stats.fuseesBlessures || 0) + 1;
      s.dire(`fusee : ${a.nom} prend ${deg.toFixed(2)}`);
    }
  }
  // le dessin (ClientLevel.createFireworks) : les explosions, avec la vitesse de la fusee
  const comp = n ? 'feu_artifice|' + JSON.stringify(e.explosions.map((x) => [FORMES_ARTIFICE.indexOf(x.forme), x.couleurs, x.fondu, x.trainee ? 1 : 0, x.scintille ? 1 : 0])) : 'feu_artifice|[]';
  s.replay.particule(s.temps, comp, e.x, e.y, e.z, e.vx, e.vy, e.vz, n);
  // sons du Starter (client) : eclat (gros si 3 explosions ou plus, ou une grosse boule) 20, hauteur 0,95..1,05 ; scintillement a la fin
  // (2 x explosions - 1 + 15 ticks), 0,9..1,05 ; les variantes _far (camera a 16 blocs ou plus) sont choisies par le film (film/sons-monde.js)
  if (n) {
    const gros = n >= 3 || e.explosions.some((x) => x.forme === 'large_ball');
    s.son(gros ? 'entity.firework_rocket.large_blast' : 'entity.firework_rocket.blast', e.x, e.y, e.z, 20, 0.95 + s.hasard.flottant() * 0.1);
    if (e.explosions.some((x) => x.scintille)) s.replay.son(s.temps + n * 2 - 1 + 15 + 1, 'entity.firework_rocket.twinkle', e.x, e.y, e.z, 20, 0.9 + s.hasard.flottant() * 0.15);
  }
  s.stats.fusees = (s.stats.fusees || 0) + 1;
  (s.stats.iaJournal ??= []).push(`${(s.temps / 20).toFixed(2)} fusee eclate en ${e.x.toFixed(1)},${e.y.toFixed(1)},${e.z.toFixed(1)} (${n} explosion(s))`);
}
