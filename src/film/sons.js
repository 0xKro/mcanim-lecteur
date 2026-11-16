// Sons : bruits de pas selon le bloc et la distance parcourue, sons ponctuels du jeu, mixage en PCM.
// Les fichiers .ogg viennent du kit ; ffmpeg les decode, le melange est fait ici (simple et sur).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const FREQUENCE = 44100;
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

  // fichier .ogg -> Int16Array mono 44100 Hz
  pcm(fichier) {
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
function choisir(liste, graine) {
  const h = crypto.createHash('sha256').update(String(graine)).digest();
  return liste[h.readUInt32BE(0) % liste.length];
}

// ---------------------------------------------------------------- planification
// images : sortie de animer(). zone : objet Zone (bloc(x,y,z)). Retourne { evenements, notes, nbPas }.
// evenement : { t, fichier, gain, pan (-1 gauche .. +1 droite) }
export function planifierSons({ scene, images, zone, sons }) {
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
  if (scene.sons.pas) {
    const manquantes = new Set();
    scene.acteurs.forEach((a, k) => {
      let mouvement = 0, suivant = 1, n = 0;
      for (let i = 1; i < images.length; i++) {
        const p = images[i].acteurs[k], q = images[i - 1].acteurs[k];
        if (!p.auSol || !q.auSol) continue;
        if (images[i].fige) continue;      // monde gele (champ `gel`) : plus de pas automatiques
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
    if (manquantes.size) notes.push(`sons de pas absents du kit : ${[...manquantes].join(', ')} (herbe utilisee)`);
  }
  for (const s of scene.sons.liste) {
    const liste = sons.fichiers(s.nom);
    if (!liste.length) { notes.push(`son "${s.nom}" absent du kit : ignore`); continue; }
    if (s.t < 0 || s.t > scene.duree) { notes.push(`son "${s.nom}" a ${s.t} s : hors de la scene, ignore`); continue; }
    evenements.push({ t: s.t, fichier: choisir(liste, `liste|${s.nom}|${s.t}`), gain: 1, pan: 0 });
  }
  evenements.sort((a, b) => a.t - b.t);
  return { evenements, notes, nbPas };
}

// ---------------------------------------------------------------- mixage
// Retourne un Buffer PCM s16le stereo 44100 Hz de `duree` secondes (silence s'il n'y a rien).
export function mixer({ evenements, duree, sons, volume = 2.5 }) {
  const n = Math.ceil(duree * FREQUENCE);
  const mix = new Float32Array(n * 2);
  for (const e of evenements) {
    const pcm = sons.pcm(e.fichier);
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
