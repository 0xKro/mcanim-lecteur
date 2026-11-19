// Sons : bruits de pas selon le bloc et la distance parcourue, sons ponctuels du jeu, mixage en PCM.
// Les fichiers .ogg viennent du kit ; ffmpeg les decode, le melange est fait ici (simple et sur).
// Les sons du monde sont PLACES (position, volume, portee) ; le mixage les entend depuis l'auditeur de chaque image (film/ecoute.js) :
// affaiblissement lineaire du jeu jusqu'a la portee, panoramique d'OpenAL Soft, voies limitees comme le moteur de son du jeu.
import { sonsCreature } from './creatures.js';   // sons des creatures
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { instantsDePas, jambesAnimees } from './pas.js';
import { ecouteDe, gainsPour, choisirVoix, estPlace, borneHauteur, porteeDe, coupeApres, ATTENUATION_DEFAUT } from './ecoute.js';

export const FREQUENCE = 44100;
export const VOLUME_MIXAGE = 2.5;       // gain du mixage ; le champ sons.volume de la scene le multiplie
export const DISTANCE_PAS = 1 / 0.6;   // blocs par pas : le jeu ajoute 0,6 par bloc parcouru et sonne a chaque entier
// Pas (Entity.playStepSound) : son de pas du bloc, volume du type de son du bloc x 0,15, hauteur du type. Les types de son des familles
// ci-dessous ont tous volume 1 et hauteur 1 (gameplay-facts.json du jeu 26.3 : seuls METAL, hauteur 1,5, et ANVIL, volume 0,3, different).
export const VOLUME_PAS = 0.15;
const IPS = 30;                          // images par seconde du film (auditeur : une position par image)

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
  fichiers(evenement) { return this.variantes(evenement).map((v) => v.fichier); }

  // evenement -> variantes { fichier, volume, hauteur, attenuation, flux } de sounds.json, repetees selon leur poids. Une reference a un
  // autre evenement (type "event") prend les variantes de celui-ci, comme le jeu (seul le poids de la reference compte).
  variantes(evenement, vus = new Set()) {
    evenement = String(evenement).replace(/^minecraft:/, '');
    if (vus.has(evenement)) return [];
    vus.add(evenement);
    const e = this.defs[evenement];
    if (!e) return [];
    const out = [];
    for (const s of e.sounds || []) {
      const o = typeof s === 'string' ? { name: s } : s;
      const nom = o.name.replace(/^minecraft:/, '');
      if (o.type === 'event') { const r = this.variantes(nom, vus); for (let i = 0; i < (o.weight || 1); i++) out.push(...r); }
      else {
        const f = path.join(this.dossier, 'sounds', nom + '.ogg');
        const v = { fichier: f, volume: o.volume ?? 1, hauteur: o.pitch ?? 1, attenuation: o.attenuation_distance ?? ATTENUATION_DEFAUT, flux: !!o.stream };
        if (fs.existsSync(f)) for (let i = 0; i < (o.weight || 1); i++) out.push(v);
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

// Tire une variante de l'evenement (null s'il n'est pas dans le kit). `sons` sans variantes (essais) : volume, hauteur, portee par defaut.
export function tirer(sons, evenement, graine) {
  const vs = sons.variantes ? sons.variantes(evenement) : sons.fichiers(evenement).map((fichier) => ({ fichier }));
  return vs.length ? choisir(vs, graine) : null;
}

// Son du MONDE place en `pos` (SoundEngine.play) : volume de l'instance x volume de la variante (le gain de la voie le borne a 1, la
// portee vaut max(volume, 1) x attenuation_distance), hauteur x hauteur de la variante. Voir film/ecoute.js.
export function sonMonde({ t, variante: v, volume = 1, hauteur = 1, pos, ...reste }) {
  const vol = volume * (v.volume ?? 1), h = Math.round(hauteur * (v.hauteur ?? 1) * 100) / 100;   // hauteur au centieme (cache des fichiers reechantillonnes)
  return { t, fichier: v.fichier, volume: vol, pos, portee: porteeDe(vol, v.attenuation ?? ATTENUATION_DEFAUT), ...(h !== 1 ? { hauteur: h } : {}), ...(v.flux ? { flux: true } : {}), ...reste };
}

// ---------------------------------------------------------------- planification
// images : sortie de animer(). zone : objet Zone (bloc(x,y,z)). Retourne { evenements, notes, nbPas, ecoute }.
// evenement place : { t, fichier, volume, pos: [x,y,z], portee, hauteur? } ; relatif (sans affaiblissement) : { t, fichier, gain, pan (-1..1) }.
// ecoute : l'auditeur de chaque image (film/ecoute.js), a donner a mixer().
// ---------------------------------------------------------------- ambiance du monde (sons.ambiance : true)
// Le jeu (ClientLevel.animateTick) tire chaque tick 667 cellules au hasard a 16 blocs de la camera et 667 a 32 ; chaque bloc tire joue
// son animateTick : eau qui coule (pas une source, pas une chute) 1 sur 64 -> block.water.ambient (volume 0,75..1, hauteur 0,5..1,5) ;
// lave sous de l'air 1 sur 100 -> block.lava.pop, 1 sur 200 -> block.lava.ambient (volume 0,2..0,4, hauteur 0,9..1,05) ; feu 1 sur 24 ->
// block.fire.ambient (volume 1..2, hauteur 0,3..1). Les blocs sont ceux de la zone ; le hasard est tire d'une graine fixe (deterministe).
// `ecoute` : auditeur par image (defaut : la camera).
export function sonsAmbiance({ images, zone, sons, evenements, ecoute = null }) {
  const DT = 1 / 30, absents = new Set(), sources = new Map();
  const ec = ecoute ?? images.map((im) => im.camera);
  let g = 0x9e3779b9;
  const alea = () => { g = (Math.imul(g, 1664525) + 1013904223) >>> 0; return g / 4294967296; };
  const nom = (e) => String(e || '').replace(/^minecraft:/, '');
  // sources : une fois par seconde de film, les blocs a 32 blocs de l'auditeur (eau qui coule, lave a l'air libre, feu)
  for (let i = 0; i < images.length; i += 30) {
    const c = ec[i], X = Math.floor(c.x), Y = Math.floor(c.y), Z = Math.floor(c.z);
    for (let y = Y - 12; y <= Y + 12; y++) for (let z = Z - 32; z <= Z + 32; z++) for (let x = X - 32; x <= X + 32; x++) {
      const k = `${x},${y},${z}`; if (sources.has(k)) continue;
      const e = nom(zone.bloc(x, y, z));
      if (!e || e === 'air') continue;
      let t = null;
      if (/^water\[/.test(e) && !/level=0\b/.test(e) && !/level=(8|9|1[0-5])\b/.test(e)) t = 'eau';
      else if (/^lava/.test(e) && /^(air|cave_air)/.test(nom(zone.bloc(x, y + 1, z)))) t = 'lave';
      else if (/^(fire|soul_fire)(\[|$)/.test(e)) t = 'feu';
      if (t) sources.set(k, { t, p: [x + 0.5, y + 0.5, z + 0.5] });
    }
  }
  if (!sources.size) return { absents, n: 0 };
  const liste = [...sources.values()], nt = Math.floor((images.length - 1) * DT * 20);
  const p16 = 667 / 33 ** 3, p32 = 667 / 65 ** 3;
  let n = 0;
  const jouer = (evt, t, pos, vol, haut, cle) => {
    const v = tirer(sons, evt, cle);
    if (!v) { absents.add(evt); return; }
    evenements.push(sonMonde({ t, variante: v, volume: vol, hauteur: Math.round(haut * 50) / 50, pos })); n++;
  };
  for (let j = 0; j < nt; j++) {
    const t = j / 20, c = ec[Math.min(images.length - 1, Math.round(t / DT))];
    for (const s of liste) {
      const d = Math.max(Math.abs(s.p[0] - c.x), Math.abs(s.p[1] - c.y), Math.abs(s.p[2] - c.z));
      if (d > 32) continue;
      if (alea() >= (d <= 16 ? p16 + p32 : p32)) continue;   // tire par animateTick ce tick
      if (s.t === 'eau') { if (alea() * 64 < 1) jouer('block.water.ambient', t, s.p, alea() * 0.25 + 0.75, alea() + 0.5, `amb|${j}|${s.p}`); }
      else if (s.t === 'lave') { if (alea() * 100 < 1) jouer('block.lava.pop', t, s.p, 0.2 + alea() * 0.2, 0.9 + alea() * 0.15, `pop|${j}|${s.p}`); if (alea() * 200 < 1) jouer('block.lava.ambient', t, s.p, 0.2 + alea() * 0.2, 0.9 + alea() * 0.15, `lav|${j}|${s.p}`); }
      else if (alea() * 24 < 1) jouer('block.fire.ambient', t, s.p, 1 + alea(), alea() * 0.7 + 0.3, `feu|${j}|${s.p}`);
    }
  }
  return { absents, n };
}

export function planifierSons({ scene, images, zone, sons, sims = null, remap = null }) {
  const evenements = [], notes = [];
  let nbPas = 0;
  const DT = 1 / 30;
  const ecoute = ecouteDe(scene, images);
  // pas d'un acteur : son de pas du bloc, place au pied, volume x 0,15 (Entity.playStepSound)
  const pasDe = (fam, t, pos, graine, manquantes) => {
    let v = tirer(sons, evenementPas(fam), graine);
    if (!v) { manquantes.add(fam); v = tirer(sons, evenementPas('grass'), graine); }
    if (!v) return false;
    evenements.push(sonMonde({ t, variante: v, volume: VOLUME_PAS, pos }));
    return true;
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
          if (pasDe(familleDeBloc(etat), pas.t, [pas.x, pas.y + 0.3, pas.z], `pas|${k}|${n}`, manquantes)) { n++; nbPas++; }
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
          if (pasDe(familleDeBloc(etat), t, [p.x, p.y + 0.5, p.z], `pas|${k}|${n}`, manquantes)) { n++; nbPas++; }
        }
      }
    });
    if (sims) { const absents = new Set(); sonsDeTrajet({ images, zone, sons, sims, evenements, manquantes: absents, remap }); if (absents.size) notes.push(`sons de la physique absents du kit, ignores : ${[...absents].join(', ')}`); }
    if (manquantes.size) notes.push(`sons de pas absents du kit : ${[...manquantes].join(', ')} (herbe utilisee)`);
  }
  // creatures (champ `type`) : pas, cris, blessures, amorce du creeper, pagaies (film/creatures.js)
  if (scene.acteurs.some((a) => a.creature)) {
    const absents = new Set();
    const ajouter = (evt, t, pos, volume, graine, hauteur = 1) => {
      const v = tirer(sons, evt, graine);
      if (!v) { if (sons.defs?.[evt]?.sounds?.length !== 0) absents.add(evt); return false; }   // evenement muet dans le jeu (poissons : sounds vide) : rien a dire
      evenements.push(sonMonde({ t, variante: v, volume, hauteur, pos }));
      return true;
    };
    const blocSous = (p) => evenementPas(familleDeBloc(zone ? zone.bloc(Math.floor(p.x), Math.floor(p.sol - 0.2), Math.floor(p.z)) : null));
    scene.acteurs.forEach((a, k) => { if (a.creature) nbPas += sonsCreature({ a, k, images, sons, ajouter, blocSous, pasAuto: !!scene.sons.pas }); });
    if (absents.size) notes.push(`sons de creatures absents du kit, ignores : ${[...absents].slice(0, 6).join(', ')}`);
  }
  if (scene.sons.ambiance && zone) { const r = sonsAmbiance({ images, zone, sons, evenements, ecoute }); if (r.absents.size) notes.push(`sons d'ambiance absents du kit, ignores : ${[...r.absents].join(', ')}`); }
  for (const s of scene.sons.liste) {
    const v = tirer(sons, s.nom, `liste|${s.nom}|${s.t}`);
    if (!v) { notes.push(`son "${s.nom}" absent du kit : ignore`); continue; }
    if (s.t < 0 || s.t > scene.duree) { notes.push(`son "${s.nom}" a ${s.t} s : hors de la scene, ignore`); continue; }
    // avec cible (acteur ou point) : son du monde, comme les pas (volume du jeu : au-dela de 1 il allonge la portee) ; sans cible : son
    // relatif, au premier plan, le volume multiplie le niveau
    if (s.cible) {
      const im = images[Math.min(images.length - 1, Math.max(0, Math.round(s.t / DT)))];
      let pos = s.cible.pos;
      if (s.cible.acteur) {
        const k = scene.acteurs.findIndex((a) => a.nom === s.cible.acteur), p = im.acteurs[k];
        pos = [p.x, p.y + 0.3, p.z];
      }
      evenements.push(sonMonde({ t: s.t, variante: v, volume: s.volume ?? 1, pos }));
    } else evenements.push({ t: s.t, fichier: v.fichier, gain: s.volume ?? 1, pan: 0 });
  }
  evenements.sort((a, b) => a.t - b.t);
  return { evenements, notes, nbPas, ecoute };
}

// ---------------------------------------------------------------- mixage
// Retourne un Buffer PCM s16le stereo 44100 Hz de `duree` secondes (silence s'il n'y a rien). `ecoute` : auditeur de chaque image
// (planifierSons) ; les sons places sont entendus depuis lui, image par image (film/ecoute.js). Le Buffer porte `voix` :
// { jouees, horsPortee, saturees } (sons places inaudibles ou au-dela des voies du jeu : ni joues ni decodes).
export function mixer({ evenements, duree, sons, volume = VOLUME_MIXAGE, ecoute = null }) {
  const n = Math.ceil(duree * FREQUENCE);
  const mix = new Float32Array(n * 2);
  const SPI = FREQUENCE / IPS;   // echantillons par image
  const hauteurDe = (e) => (estPlace(e) ? borneHauteur(e.hauteur ?? 1) : (e.hauteur || 1));
  // fin de chaque son (s) : boucle -> sa duree ou la fin du film ; sinon la longueur du fichier a sa hauteur
  const longueur = (e) => {
    if (e.boucle) return e.duree !== undefined ? e.duree : duree - e.t;
    return Math.min(e.duree !== undefined ? e.duree : Infinity, Math.max(0, pcmDe(e).length - k0De(e)) / FREQUENCE);
  };
  const pcmDe = (e) => { const h = hauteurDe(e); return h !== 1 ? sons.pcm(e.fichier, h) : sons.pcm(e.fichier); };
  const k0De = (e) => (e.decalage ? Math.round(e.decalage * FREQUENCE / hauteurDe(e)) : 0);
  // choix des voix : les sons places inaudibles tout du long ne sont ni decodes ni mixes (portee : borne haute de la duree sans decoder)
  // (hors de portee de l'auditeur a chaque image d'ici la fin du film : inutile de decoder le fichier pour le savoir)
  const fins = evenements.map((e) => (e.pos && ecoute?.length && horsDePorteeToujours(e, ecoute) ? e.t : e.t + longueur(e)));
  const { joues, horsPortee, satures } = choisirVoix(evenements, fins, ecoute ?? [], IPS);
  evenements.forEach((e, i) => {
    if (!joues.has(i)) return;
    const pcm = pcmDe(e);
    if (!pcm.length) return;
    const debut = Math.round(e.t * FREQUENCE);
    // boucle : le son repart au debut (son en boucle du jeu, elytres) ; decalage : on reprend le fichier a cet instant (secondes du fichier)
    const k0 = k0De(e);
    const fin = Math.min(n, e.boucle ? Infinity : debut + pcm.length - k0, e.duree !== undefined ? debut + Math.round(e.duree * FREQUENCE) : Infinity);   // duree : musique du juke-box coupee
    const i0 = Math.max(0, debut);
    if (fin <= i0) return;
    if (!estPlace(e) || !ecoute?.length) {
      const [gl, gd] = gainsPour(estPlace(e) ? { ...e, pos: null, dir: null, gain: Math.min(1, e.volume ?? 1), pan: 0 } : e, null);
      for (let i = i0; i < fin; i++) { const v = pcm[(i - debut + k0) % pcm.length] / 32768; mix[2 * i] += v * gl * volume; mix[2 * i + 1] += v * gd * volume; }
      return;
    }
    // son place : gains a chaque image, interpoles entre deux images (sauf a une coupe : l'auditeur saute)
    const der = ecoute.length - 1, cache = new Map();
    const g = (f) => { const c = Math.min(der, Math.max(0, f)); let r = cache.get(c); if (!r) { r = gainsPour(e, ecoute[c]); cache.set(c, r); } return r; };
    for (let i = i0; i < fin;) {
      const f = Math.floor(i / SPI), bout = Math.max(i + 1, Math.min(fin, Math.ceil((f + 1) * SPI)));
      const a = g(f), b = f < der && !coupeApres(ecoute, f) ? g(f + 1) : a;
      if (a[0] === 0 && a[1] === 0 && b[0] === 0 && b[1] === 0) { i = bout; continue; }
      for (; i < bout; i++) {
        const u = i / SPI - f, gl = (a[0] + (b[0] - a[0]) * u) * volume, gd = (a[1] + (b[1] - a[1]) * u) * volume;
        const v = pcm[(i - debut + k0) % pcm.length] / 32768;
        mix[2 * i] += v * gl; mix[2 * i + 1] += v * gd;
      }
    }
  });
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n * 2; i++) out.writeInt16LE(Math.round(Math.tanh(mix[i]) * 32767), i * 2); // limiteur doux
  out.voix = { jouees: joues.size, horsPortee, saturees: satures };
  return out;
}

// le son place `e` est-il hors de portee de l'auditeur a chaque image du film ? (test rapide, sans connaitre sa duree)
function horsDePorteeToujours(e, ecoute) {
  const p = e.portee ?? porteeDe(e.volume ?? 1);
  if (!(Math.min(1, e.volume ?? 1) > 0)) return true;
  for (let f = Math.max(0, Math.floor(e.t * IPS)); f < ecoute.length; f++) {
    const l = ecoute[f];
    if (Math.hypot(e.pos[0] - l.x, e.pos[1] - l.y, e.pos[2] - l.z) < p) return false;
  }
  return true;
}

// Sons de la physique (aucun pas en l'air : pas.js). Atterrissage : le pas du bloc touche (volume des pas, x 0,5 a 1 selon la vitesse
// d'arrivee) ; le jeu n'a pas de son de chute sans degats (living_fall.rs : sons seulement si degats > 0, "small_fall" jusqu'a 4,
// "big_fall" au dela) ; eau : "splash" a l'entree, "swim" tous les 1,67 bloc nage (movement_emission.rs:116-146) ; echelle : le pas de
// l'echelle (volume des pas) tous les 1,67 bloc monte. Un son absent du kit est ignore. Tous sont des sons places.
function sonsDeTrajet({ images, zone, sons, sims, evenements, manquantes, remap = null }) {
  const TICK = 1 / 20;
  void images;
  const ajouter = (evt, t, pos, volume, graine) => {
    if (remap) t = remap.filmDe(t);   // montage : le temps d'action (ralenti, arret) est converti en instant du film
    const v = tirer(sons, evt, graine);
    if (!v) { manquantes.add(evt); return; }
    evenements.push(sonMonde({ t, variante: v, volume, pos }));
  };
  const bloc = (x, y, z) => (zone ? zone.bloc(Math.floor(x), Math.floor(y), Math.floor(z)) : null);
  sims.forEach((sim, k) => {
    sim.atterrissages.forEach((a, n) => {
      if (a.impact < 0.15) return;
      const fam = familleDeBloc(bloc(a.x, a.y - 0.2, a.z));
      ajouter(evenementPas(fam), a.t, [a.x, a.y + 0.3, a.z], VOLUME_PAS * (0.5 + 0.5 * Math.min(1, a.impact / 0.7)), `atterrit|${k}|${n}`);
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
          ajouter(/vine/.test(String(e)) ? 'block.vine.step' : 'block.ladder.step', t, [sim.x[i], sim.y[i] + 0.5, sim.z[i]], VOLUME_PAS, `echelle|${k}|${nEch++}`);
        }
      }
    }
  });
}
