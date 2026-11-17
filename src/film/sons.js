// Sons : bruits de pas selon le bloc et la distance parcourue, sons ponctuels du jeu, mixage en PCM.
// Les fichiers .ogg viennent du kit ; ffmpeg les decode, le melange est fait ici (simple et sur).
import { sonsCreature } from './creatures.js';   // sons des creatures
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { instantsDePas, jambesAnimees } from './pas.js';

export const FREQUENCE = 44100;
export const VOLUME_MIXAGE = 2.5;       // gain du mixage ; le champ sons.volume de la scene le multiplie
export const DISTANCE_PAS = 1 / 0.6;   // blocs par pas : le jeu ajoute 0,6 par bloc parcouru et sonne a chaque entier
const PORTEE = 24;                       // blocs : au dela, le son est tres faible

// Table ecrite a la main : morceau du nom de bloc -> famille de pas. Le premier qui correspond gagne.
const FAMILLES = [
  [/sandstone|smooth_sand/, 'stone'],
  [/(^|_)sand$|soul_sand/, 'sand'],
  [/snow/, 'snow'],
  [/gravel|dirt|podzol|mud|clay|farmland|path|rooted/, 'gravel'],
  [/plank|log|wood|stem|hyphae|door|fence|bookshelf|crafting|chest|barrel|bamboo|scaffolding|sign/, 'wood'],
  [/stone|cobble|deepslate|andesite|granite|diorite|brick|_ore|concrete|terracotta|basalt|obsidian|netherrack|tuff|calcite|dripstone|blackstone|copper|iron|gold|quartz|prismarine|purpur|bedrock|glass|ice/, 'stone'],
  [/grass|fern|moss|leaves|leaf|mycelium|azalea|vine|bush|flower|wool|carpet|sponge|sculk|nylium|roots|sprout/, 'grass'],
];

// 'minecraft:grass_block[snowy=false]' -> 'grass' ; defaut : herbe.
export function familleDeBloc(etat) {
  const nom = String(etat || '').replace(/^minecraft:/, '').replace(/\[.*$/, '');
  if (!nom || nom === 'air' || nom === 'grass_block') return 'grass';
  for (const [re, fam] of FAMILLES) if (re.test(nom)) return fam;
  return 'grass';
}
export const evenementPas = (famille) => `block.${famille}.step`;

// ---------------------------------------------------------------- bibliotheque de sons du kit
export class Sons {
  constructor(kitDir, ffmpeg) {
    this.dossier = path.join(kitDir, 'assets', 'minecraft');
    this.ffmpeg = ffmpeg;
    this.cachePcm = new Map();
    try { this.defs = JSON.parse(fs.readFileSync(path.join(this.dossier, 'sounds.json'), 'utf8')); } catch { this.defs = {}; }
  }

  // evenement -> liste de chemins de fichiers .ogg presents dans le kit (vide si inconnu)
  fichiers(evenement, vus = new Set()) {
    evenement = String(evenement).replace(/^minecraft:/, '');
    if (vus.has(evenement)) return [];
    vus.add(evenement);
    const e = this.defs[evenement];
    if (!e) return [];
    const out = [];
    for (const s of e.sounds || []) {
      const o = typeof s === 'string' ? { name: s } : s;
      const nom = o.name.replace(/^minecraft:/, '');
      if (o.type === 'event') out.push(...this.fichiers(nom, vus));
      else {
        const f = path.join(this.dossier, 'sounds', nom + '.ogg');
        if (fs.existsSync(f)) for (let i = 0; i < (o.weight || 1); i++) out.push(f);
      }
    }
    return out;
  }

  // fichier .ogg -> Int16Array mono 44100 Hz ; `hauteur` (pitch du jeu, 1 = normal) change la vitesse de lecture (reechantillonnage lineaire)
  pcm(fichier, hauteur = 1) {
    if (hauteur !== 1) {
      const cle = fichier + '|' + hauteur.toFixed(4);
      if (this.cachePcm.has(cle)) return this.cachePcm.get(cle);
      const src = this.pcm(fichier), n = Math.max(1, Math.floor(src.length / hauteur)), out = new Int16Array(n);
      for (let i = 0; i < n; i++) { const p = i * hauteur, k = Math.floor(p), f = p - k; out[i] = Math.round(src[k] * (1 - f) + (src[Math.min(src.length - 1, k + 1)] ?? 0) * f); }
      this.cachePcm.set(cle, out);
      return out;
    }
    if (this.cachePcm.has(fichier)) return this.cachePcm.get(fichier);
    const r = spawnSync(this.ffmpeg, ['-v', 'error', '-i', fichier, '-f', 's16le', '-ac', '1', '-ar', String(FREQUENCE), '-'], { maxBuffer: 64 << 20 });
    if (r.status !== 0) throw new Error(`ffmpeg n'a pas pu lire ${path.basename(fichier)} : ${String(r.stderr).slice(0, 200)}`);
    const b = r.stdout;
    const a = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~1)));
    this.cachePcm.set(fichier, a);
    return a;
  }
}

// Choix pseudo-aleatoire mais repetable.
export function choisir(liste, graine) {
  const h = crypto.createHash('sha256').update(String(graine)).digest();
  return liste[h.readUInt32BE(0) % liste.length];
}

// ---------------------------------------------------------------- planification
// images : sortie de animer(). zone : objet Zone (bloc(x,y,z)). Retourne { evenements, notes, nbPas }.
// evenement : { t, fichier, gain, pan (-1 gauche .. +1 droite) }
export function planifierSons({ scene, images, zone, sons, sims = null, remap = null }) {
  const evenements = [], notes = [];
  let nbPas = 0;
  const DT = 1 / 30;
  const gainPan = (A, cam) => {
    const dx = A[0] - cam.x, dy = A[1] - cam.y, dz = A[2] - cam.z;
    const d = Math.hypot(dx, dy, dz);
    const gain = Math.max(0.04, 1 - d / PORTEE);
    const psi = (cam.lacet * Math.PI) / 180;
    const fx = -Math.sin(psi), fz = Math.cos(psi);
    const dh = Math.hypot(dx, dz);
    const pan = dh > 0.3 ? Math.max(-1, Math.min(1, (dx * -fz + dz * fx) / dh)) : 0; // composante vers la droite de la camera
    return { gain, pan };
  };
  // l'acteur k parcourt-il au moins une foulee au sol hors gel ? (sert quand les pieds ne donnent aucun contact)
  const deplacement = (k) => {
    let d = 0;
    for (let i = 1; i < images.length; i++) {
      const p = images[i].acteurs[k], q = images[i - 1].acteurs[k];
      if (p.auSol && q.auSol && !images[i].fige && !p.figee) d += Math.hypot(p.x - q.x, p.z - q.z);
    }
    return d >= DISTANCE_PAS;
  };
  if (scene.sons.pas) {
    const manquantes = new Set();
    scene.acteurs.forEach((a, k) => {
      if (a.creature) return;   // creatures : leurs propres pas (plus bas)
      let mouvement = 0, suivant = 1, n = 0;
      // Jambes animees : un pas a chaque contact d'un pied avec le sol (film/pas.js), avec le bloc sous CE pied.
      let nbContacts = 0;
      if (images.length > 1 && jambesAnimees(images, k)) {
        for (const pas of instantsDePas(images, k)) {
          nbContacts++;
          const bloc = (x, z) => (zone ? zone.bloc(Math.floor(x), Math.floor(pas.sol - 0.2), Math.floor(z)) : null);
          let etat = bloc(pas.x, pas.z);                                 // bloc sous le pied ; en l'air (bord de marche) : bloc sous le corps
          if (!etat || /(^|:)(cave_|void_)?air$/.test(String(etat).replace(/\[.*$/, ''))) etat = bloc(pas.ax, pas.az);
          let fam = familleDeBloc(etat);
          let liste = sons.fichiers(evenementPas(fam));
          if (!liste.length) { manquantes.add(fam); fam = 'grass'; liste = sons.fichiers(evenementPas('grass')); }
          if (!liste.length) continue;
          const fichier = choisir(liste, `pas|${k}|${n}`);
          const im = images[Math.min(images.length - 1, Math.max(0, Math.round(pas.t / DT)))];
          n++; nbPas++;
          evenements.push({ t: pas.t, fichier, ...gainPan([pas.x, pas.y + 0.3, pas.z], im.camera) });
        }
        if (nbContacts > 0 || !deplacement(k)) return;
        // aucun contact trouve (pieds qui ne se levent presque pas) mais l'acteur avance : regle de la distance
      }
      for (let i = 1; i < images.length; i++) {
        const p = images[i].acteurs[k], q = images[i - 1].acteurs[k];
        if (!p.auSol || !q.auSol) continue;
        if (images[i].fige || p.figee) continue;      // monde gele (champ `gel`) ou acteur fige (champ `fige`) : plus de pas automatiques
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        const avant = mouvement;
        mouvement += d * 0.6;
        if (mouvement > suivant) {
          const frac = (suivant - avant) / (mouvement - avant);
          suivant = Math.floor(mouvement) + 1;
          const t = images[i - 1].t + DT * Math.min(1, Math.max(0, frac));
          const etat = zone ? zone.bloc(Math.floor(p.x), Math.floor(p.sol - 0.2), Math.floor(p.z)) : null;
          let fam = familleDeBloc(etat);
          let liste = sons.fichiers(evenementPas(fam));
          if (!liste.length) { manquantes.add(fam); fam = 'grass'; liste = sons.fichiers(evenementPas('grass')); }
          if (!liste.length) continue;
          const fichier = choisir(liste, `pas|${k}|${n}`);
          n++; nbPas++;
          evenements.push({ t, fichier, ...gainPan([p.x, p.y + 0.5, p.z], images[i].camera) });
        }
      }
    });
    if (sims) { const absents = new Set(); sonsDeTrajet({ scene, images, zone, sons, sims, evenements, gainPan, manquantes: absents, remap }); if (absents.size) notes.push(`sons de la physique absents du kit, ignores : ${[...absents].join(', ')}`); }
    if (manquantes.size) notes.push(`sons de pas absents du kit : ${[...manquantes].join(', ')} (herbe utilisee)`);
  }
  // creatures (champ `type`) : pas, cris, blessures, amorce du creeper, pagaies (film/creatures.js)
  if (scene.acteurs.some((a) => a.creature)) {
    const absents = new Set();
    const ajouter = (evt, t, pos, gain, graine, hauteur = 1) => {
      const liste = sons.fichiers(evt);
      if (!liste.length) { absents.add(evt); return false; }
      const im = images[Math.min(images.length - 1, Math.max(0, Math.round(t / DT)))], gp = gainPan(pos, im.camera);
      evenements.push({ t, fichier: choisir(liste, graine), gain: Math.min(1, gp.gain * gain), pan: gp.pan, ...(hauteur !== 1 ? { hauteur: Math.round(hauteur * 50) / 50 } : {}) });
      return true;
    };
    const blocSous = (p) => evenementPas(familleDeBloc(zone ? zone.bloc(Math.floor(p.x), Math.floor(p.sol - 0.2), Math.floor(p.z)) : null));
    scene.acteurs.forEach((a, k) => { if (a.creature) nbPas += sonsCreature({ a, k, images, sons, ajouter, blocSous, pasAuto: !!scene.sons.pas }); });
    if (absents.size) notes.push(`sons de creatures absents du kit, ignores : ${[...absents].slice(0, 6).join(', ')}`);
  }
  for (const s of scene.sons.liste) {
    const liste = sons.fichiers(s.nom);
    if (!liste.length) { notes.push(`son "${s.nom}" absent du kit : ignore`); continue; }
    if (s.t < 0 || s.t > scene.duree) { notes.push(`son "${s.nom}" a ${s.t} s : hors de la scene, ignore`); continue; }
    // meme chemin que les pas automatiques : la cible (acteur ou point) donne distance et panoramique, le volume multiplie
    let place = { gain: 1, pan: 0 };
    if (s.cible) {
      const im = images[Math.min(images.length - 1, Math.max(0, Math.round(s.t / DT)))];
      let pos = s.cible.pos;
      if (s.cible.acteur) {
        const k = scene.acteurs.findIndex((a) => a.nom === s.cible.acteur), p = im.acteurs[k];
        pos = [p.x, p.y + 0.3, p.z];
      }
      place = gainPan(pos, im.camera);
    }
    evenements.push({ t: s.t, fichier: choisir(liste, `liste|${s.nom}|${s.t}`), gain: place.gain * (s.volume ?? 1), pan: place.pan });
  }
  evenements.sort((a, b) => a.t - b.t);
  return { evenements, notes, nbPas };
}

// ---------------------------------------------------------------- mixage
// Retourne un Buffer PCM s16le stereo 44100 Hz de `duree` secondes (silence s'il n'y a rien).
export function mixer({ evenements, duree, sons, volume = VOLUME_MIXAGE }) {
  const n = Math.ceil(duree * FREQUENCE);
  const mix = new Float32Array(n * 2);
  for (const e of evenements) {
    const pcm = e.hauteur && e.hauteur !== 1 ? sons.pcm(e.fichier, e.hauteur) : sons.pcm(e.fichier);
    const debut = Math.round(e.t * FREQUENCE);
    const angle = ((e.pan + 1) * Math.PI) / 4;     // puissance constante
    const gl = Math.cos(angle) * e.gain * volume * 1.4142, gd = Math.sin(angle) * e.gain * volume * 1.4142;
    const fin = Math.min(n, debut + pcm.length);
    for (let i = debut; i < fin; i++) {
      const v = pcm[i - debut] / 32768;
      mix[2 * i] += v * gl; mix[2 * i + 1] += v * gd;
    }
  }
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n * 2; i++) out.writeInt16LE(Math.round(Math.tanh(mix[i]) * 32767), i * 2); // limiteur doux
  return out;
}

// Sons de la physique (aucun pas en l'air : pas.js). Atterrissage : le pas du bloc touche, plus fort avec la vitesse d'arrivee ; le jeu n'a
// pas de son de chute sans degats (living_fall.rs : sons seulement si degats > 0, "small_fall" jusqu'a 4, "big_fall" au dela) ; eau :
// "splash" a l'entree, "swim" tous les 1,67 bloc nage (movement_emission.rs:116-146) ; echelle : "block.ladder.step" tous les 1,67 bloc monte.
// Un son absent du kit est ignore.
function sonsDeTrajet({ scene, images, zone, sons, sims, evenements, gainPan, manquantes, remap = null }) {
  const DT = 1 / 30, TICK = 1 / 20;
  const ajouter = (evt, t, pos, gain, graine) => {
    if (remap) t = remap.filmDe(t);   // montage : le temps d'action (ralenti, arret) est converti en instant du film
    const liste = sons.fichiers(evt);
    if (!liste.length) { manquantes.add(evt); return; }
    const im = images[Math.min(images.length - 1, Math.max(0, Math.round(t / DT)))];
    evenements.push({ t, fichier: choisir(liste, graine), ...gainPan(pos, im.camera), gain: Math.min(1, gainPan(pos, im.camera).gain * gain) });
  };
  const bloc = (x, y, z) => (zone ? zone.bloc(Math.floor(x), Math.floor(y), Math.floor(z)) : null);
  sims.forEach((sim, k) => {
    sim.atterrissages.forEach((a, n) => {
      if (a.impact < 0.15) return;
      const fam = familleDeBloc(bloc(a.x, a.y - 0.2, a.z));
      ajouter(evenementPas(fam), a.t, [a.x, a.y + 0.3, a.z], 0.5 + 0.5 * Math.min(1, a.impact / 0.7), `atterrit|${k}|${n}`);
      if (a.chute > 3) ajouter(a.chute > 7 ? 'entity.player.big_fall' : 'entity.player.small_fall', a.t, [a.x, a.y + 0.3, a.z], 1, `chute|${k}|${n}`);
    });
    sim.brut.filter((b) => b.type === 'eau' && b.vitesse > 0.1).forEach((b, n) => ajouter('entity.player.splash', sim.reel(b.k * TICK), [b.x, b.y, b.z], 0.6 + Math.min(0.4, b.vitesse), `plouf|${k}|${n}`));
    let cumulEau = 0, cumulEch = 0, nEau = 0, nEch = 0;
    for (let i = 1; i <= sim.ticks; i++) {
      const t = sim.reel(i * TICK);
      if (sim.eau[i]) {
        const d = Math.hypot(sim.x[i] - sim.x[i - 1], sim.z[i] - sim.z[i - 1]) * 0.6, avant = cumulEau;
        cumulEau += d;
        if (Math.floor(cumulEau) > Math.floor(avant)) ajouter('entity.player.swim', t, [sim.x[i], sim.y[i] + 0.8, sim.z[i]], 0.8, `nage|${k}|${nEau++}`);
      }
      if (sim.surEchelle[i] && !sim.imp[i]) {
        const d = Math.abs(sim.y[i] - sim.y[i - 1]) * 0.6, avant = cumulEch;
        cumulEch += d;
        if (Math.floor(cumulEch) > Math.floor(avant)) {
          const e = bloc(sim.x[i], sim.y[i] + 0.1, sim.z[i]);
          ajouter(/vine/.test(String(e)) ? 'block.vine.step' : 'block.ladder.step', t, [sim.x[i], sim.y[i] + 0.5, sim.z[i]], 0.8, `echelle|${k}|${nEch++}`);
        }
      }
    }
  });
}
