// Sons du MONDE SIMULE : les evenements `son` du replay (portes, coffres, cloche, pose et casse de blocs, coups de pioche, notes...) sont mixes
// comme les autres sons du film : des sons PLACES, entendus depuis l'auditeur de chaque image (film/ecoute.js) avec l'affaiblissement du
// jeu : un son de volume v s'entend jusqu'a max(1, v) x attenuation_distance (16 par defaut) blocs, lineairement, au gain min(1, v).
// La hauteur (pitch) change la vitesse de lecture (reechantillonnage dans film/sons.js). Un son absent du kit est ignore et signale une fois.
// `ecoute` : l'auditeur de chaque image (planifierSons) ; sans lui, la camera.
import { choisir, tirer, sonMonde } from './sons.js';
import { niveauxMeteo } from './meteo.js';
import { eclairEnd } from '../rendu/ciel-vanille.js';   // eclairs du ciel de l'End (memes tirages que le dessin)

const DT = 1 / 30;

export function sonsDuReplay({ replay, images, sons, evenements, gel = [], remap = null, ecoute = null }) {
  const ec = ecoute ?? images.map((im) => im.camera);
  const S = replay.sons, n = S.length / 7;
  const absents = new Set();
  const musiques = new Map();   // juke-box : 'x,y,z' -> evenement de la musique en cours ; '!stop' (familles/musique.js) la coupe a son instant
  const reel = (w) => { let t = w; for (const [a, b] of gel) if (t > a) t += b - a; return t; };
  sonsElytres({ replay, images, sons, evenements, reel, remap, absents });
  sonsWagonnets({ replay, images, sons, evenements, reel, remap, absents });
  if (replay.dimension === 'end') sonsEclairsEnd({ replay, images, sons, evenements, reel, remap, absents });
  for (let i = 0; i < n; i++) {
    const tick = S[i * 7], nom = replay.noms[S[i * 7 + 1]], x = S[i * 7 + 2], y = S[i * 7 + 3], z = S[i * 7 + 4], vol = S[i * 7 + 5], hauteur = S[i * 7 + 6];
    let t = reel(tick / (20 * replay.ralenti));
    if (remap) t = remap.filmDe(t);
    const cle = `${x},${y},${z}`;
    if (nom === '!stop') { const m = musiques.get(cle); if (m) { m.duree = Math.max(0, t - m.t); musiques.delete(cle); } continue; }
    if (t < 0 || !images.length) continue;
    const cam = ec[Math.min(images.length - 1, Math.max(0, Math.round(t / DT)))], d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    // feux d'artifice (ClientLevel.createFireworks) : la variante lointaine quand l'auditeur est a 16 blocs ou plus
    const nomJoue = /^entity\.firework_rocket\.(large_blast|blast|twinkle)$/.test(nom) && d >= 16 ? nom + '_far' : nom;
    const v = tirer(sons, nomJoue, `monde|${nomJoue}|${i}`);
    if (!v) { absents.add(nomJoue); continue; }
    const ev = sonMonde({ t, variante: v, volume: vol, hauteur, pos: [x, y, z] });   // place : affaibli et panoramique depuis l'auditeur au mixage
    if (nom.startsWith('music_disc.')) musiques.set(cle, ev);
    evenements.push(ev);
  }
  return absents.size ? [`sons du monde absents du kit, ignores : ${[...absents].join(', ')}`] : [];
}

// Eclairs du ciel de l'End (Horizon game/end.rs, sound_engine.rs SoundInstance::directional, MIT) : au tick ou un eclair commence, le son
// weather.end_flash (volume 1, hauteur 1, sans affaiblissement : Attenuation.NONE) vient de la direction de l'eclair (angles de EndFlashState).
function sonsEclairsEnd({ replay, images, sons, evenements, reel, remap, absents }) {
  if (!images.length) return;
  const liste = sons.fichiers('weather.end_flash');
  if (!liste.length) { absents.add('weather.end_flash'); return; }
  const vus = new Set();
  for (let tk = 0; tk < (replay.ticks ?? 0); tk++) {
    const e = eclairEnd(tk);
    if (e.debut + 1 !== tk || vus.has(tk)) continue;   // flashStartedThisTick : premiere intensite > 0 (sin(0) = 0 au tick du decalage)
    vus.add(tk);
    let t = reel(tk / (20 * (replay.ralenti || 1)));
    if (remap) t = remap.filmDe(t);
    if (t < 0) continue;
    // direction de l'eclair : rotation Y (180 - ay) apres rotation X (-90 - ax) du vecteur (0, 1, 0) ; son directionnel, sans affaiblissement
    const a = ((180 - e.ay) * Math.PI) / 180, b = ((-90 - e.ax) * Math.PI) / 180, y1 = Math.cos(b), z1 = Math.sin(b);
    evenements.push({ t, fichier: choisir(liste, `end_flash|${tk}`), volume: 1, dir: [z1 * Math.sin(a), y1, z1 * Math.cos(a)] });
  }
}

// ElytraOnPlayerSoundInstance (Horizon horizon-client-render/src/sound_engine.rs Ticking::Elytra, MIT) : au debut d'un vol plane, le son en
// boucle item.elytra.flying suit le joueur ; volume clamp(|v|^2 / 4, 0, 1), muet la premiere seconde, fondu de la deuxieme ; hauteur
// 1 + (volume - 0,8) au-dessus de 0,8 ; il s'arrete apres 20 ticks quand le vol cesse. Un morceau par tick (gain, hauteur, suite du fichier).
function sonsElytres({ replay, images, sons, evenements, reel, remap, absents }) {
  if (!replay.vols?.length || !images.length) return;
  const liste = sons.fichiers('item.elytra.flying');
  if (!liste.length) { absents.add('item.elytra.flying'); return; }
  const parActeur = new Map();
  for (const v of replay.vols) (parActeur.get(v[1]) ?? parActeur.set(v[1], new Map()).get(v[1])).set(v[0], v);
  const A = replay.acteursVue;
  for (const [id, vols] of parActeur) {
    const posDe = new Map();
    for (let q = 0; q < A.length; q += 16) if (A[q + 1] === id) posDe.set(A[q], [A[q + 2], A[q + 3], A[q + 4]]);
    const ticks = [...vols.keys()].sort((a, b) => a - b);
    let i = 0;
    while (i < ticks.length) {
      // un son par vol (ticks consecutifs) ; il vit tant que le vol dure, et au moins 20 ticks
      let j = i; while (j + 1 < ticks.length && ticks[j + 1] === ticks[j] + 1) j++;
      const t0 = ticks[i], fichier = choisir(liste, `elytres|${id}|${t0}`);
      const vv = sons.variantes?.('item.elytra.flying').find((x) => x.fichier === fichier)?.volume ?? 1;   // volume de la variante (sounds.json : 0,6)
      let decal = 0, dernier = vols.get(ticks[j]);
      for (let tk = t0, time = 1; tk <= Math.max(ticks[j], t0 + 19); tk++, time++) {
        const v = vols.get(tk) ?? dernier, sp = Math.fround(v[2] * v[2] + v[3] * v[3] + v[4] * v[4]);
        let vol = sp >= 1e-7 ? Math.min(1, Math.max(0, sp / 4)) : 0;
        if (time < 20) vol = 0; else if (time < 40) vol *= (time - 20) / 20;
        const hauteur = vol > 0.8 ? 1 + (vol - 0.8) : 1;
        let t = reel(tk / (20 * replay.ralenti)); if (remap) t = remap.filmDe(t);
        const dt = 1 / (20 * replay.ralenti);
        if (vol > 0.001 && t >= 0) {
          const p = posDe.get(tk);   // morceau place a la position du joueur a ce tick (le son le suit)
          if (p) evenements.push({ t, fichier, volume: vol * vv, pos: p, portee: 16, hauteur: Math.round(hauteur * 100) / 100, boucle: true, decalage: decal, duree: dt });
        }
        decal += dt * hauteur;
      }
      i = j + 1;
    }
  }
}

// MinecartSoundInstance (Horizon sound_engine.rs Ticking::Minecart, MIT) : chaque wagonnet simule (replay.vehicules) a son roulement en boucle
// entity.minecart.riding a sa position, volume clamp(vitesse horizontale, 0, 0,5) x 0,7 (muet sous 0,01), hauteur 1 ; un morceau par tick.
function sonsWagonnets({ replay, images, sons, evenements, reel, remap, absents }) {
  if (!replay.vehicules?.length || !images.length) return;
  const liste = sons.fichiers('entity.minecart.riding');
  if (!liste.length) { absents.add('entity.minecart.riding'); return; }
  const A = replay.acteursVue, ids = new Set(replay.vehicules.filter((v) => v[11] === 1).map((v) => v[1]));
  for (const id of ids) {
    const posDe = new Map();
    for (let q = 0; q < A.length; q += 16) if (A[q + 1] === id) posDe.set(A[q], [A[q + 2], A[q + 3], A[q + 4]]);
    const fichier = choisir(liste, `wagonnet|${id}`), dt = 1 / (20 * replay.ralenti);
    let decal = 0;
    for (const [tk, p] of posDe) {
      const q = posDe.get(tk - 1);
      if (!q) continue;
      const v = Math.hypot(p[0] - q[0], p[2] - q[2]), vol = v >= 0.01 ? Math.min(0.5, v) * 0.7 : 0;
      let t = reel(tk / (20 * replay.ralenti)); if (remap) t = remap.filmDe(t);
      if (vol > 0.001 && t >= 0) {
        evenements.push({ t, fichier, volume: vol, pos: p, portee: 16, boucle: true, decalage: decal, duree: dt });
      }
      decal += dt;
    }
  }
}

// Bruit de la pluie (weather.rain, weather.rain.above) : un son toutes les 1,2 s, de la camera (la pluie tombe autour d'elle, sans affaiblissement), au volume du niveau de pluie
// (WeatherEffectRenderer.tickRain : 0,2 sous le ciel, 0,1 couvert). Le tonnerre et l'impact sont des sons du replay (entity.lightning_bolt.*).
export function sonsMeteo({ scene, sons, evenements }) {
  const piste = scene.ciel?.meteo;
  if (!piste || !piste.etats.length) return [];
  const liste = sons.fichiers('weather.rain');
  if (!liste.length) return ['sons de pluie (weather.rain) absents du kit, ignores'];
  for (let i = 0, t = 0; t < scene.duree; i++, t += 1.2) {
    const n = niveauxMeteo(piste, t).pluie;
    if (n < 0.05) continue;
    evenements.push({ t, fichier: choisir(liste, `pluie|${i}`), gain: Math.min(1, 0.55 * n), pan: 0, hauteur: 1 });
  }
  return [];
}
