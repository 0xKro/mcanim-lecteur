// Definition du kit de base : groupes, chemins, ecriture dans le cache, empreinte.
// Rien ici n'est un fichier du jeu : ce sont seulement des noms de dossiers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SOUND_MATERIALS = ['grass', 'stone', 'wood', 'sand', 'gravel', 'snow'];
export const SOUND_EVENTS = SOUND_MATERIALS.map((m) => `block.${m}.step`);

// groupe -> prefixes de chemin dans le jar (et dans le cache, qui reprend les memes chemins)
export const GROUPS = {
  blockstates: ['assets/minecraft/blockstates/'],
  models: ['assets/minecraft/models/block/'],
  textures: ['assets/minecraft/textures/block/'],
  colormap: ['assets/minecraft/textures/colormap/'],
  skins: ['assets/minecraft/textures/entity/player/'],
  sons: ['assets/minecraft/sounds.json', 'assets/minecraft/sounds/'],
  environnement: ['assets/minecraft/textures/environment/'], // ciel : soleil, lune (8 phases), nuages (voir src/rendu/ciel-vanille.js)
  biomes: ['data/minecraft/worldgen/biome/'], // temperature, humidite, couleurs (teintes herbe/feuilles/eau)
  worldgen: ['data/minecraft/worldgen/'], // facultatif (le reste de worldgen)
};
export const DEFAULT_GROUPS = ['blockstates', 'models', 'textures', 'colormap', 'skins', 'biomes', 'environnement', 'sons'];
export const JAR_GROUPS = ['blockstates', 'models', 'textures', 'colormap', 'skins', 'biomes', 'environnement', 'worldgen'];

export function groupOf(rel) {
  for (const [g, prefixes] of Object.entries(GROUPS)) {
    for (const p of prefixes) if (p.endsWith('/') ? rel.startsWith(p) : rel === p) return g;
  }
  return null;
}
// Pour les groupes du jar (hors sons): le chemin est-il voulu ?
export function jarWanted(name, groups) {
  if (name.endsWith('/')) return false;
  const g = groupOf(name);
  return !!g && g !== 'sons' && groups.has(g);
}

export function normGroups(groups) {
  const g = new Set(groups?.length ? groups : DEFAULT_GROUPS);
  for (const x of g) if (!GROUPS[x]) throw new Error(`groupe inconnu: ${x} (connus: ${Object.keys(GROUPS).join(', ')})`);
  return g;
}

export function safeRel(rel) {
  if (!rel || rel.includes('\\') || rel.startsWith('/') || rel.split('/').some((s) => s === '..' || s === '' || s.includes(':'))) {
    throw new Error(`chemin refuse: ${rel}`);
  }
  return rel;
}

// sounds.json -> liste des noms de sons (ex. "step/grass1") pour des evenements donnes
export function resolveSoundNames(soundsJson, events = SOUND_EVENTS) {
  const out = new Set(); const seen = new Set();
  const visit = (ev) => {
    if (seen.has(ev)) return; seen.add(ev);
    const e = soundsJson[ev];
    if (!e) throw new Error(`evenement de son absent de sounds.json: ${ev}`);
    for (const s of e.sounds || []) {
      const o = typeof s === 'string' ? { name: s } : s;
      const name = o.name.replace(/^minecraft:/, '');
      if (o.type === 'event') visit(name); else out.add(name);
    }
  };
  events.forEach(visit);
  return [...out].sort();
}

export const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');

export async function pool(items, n, fn) {
  let i = 0;
  const w = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, w));
}

// Ecrit dans le cache en comptant par groupe. Ecriture atomique (.partial puis rename).
export class KitWriter {
  constructor(kitDir) { this.kitDir = kitDir; this.written = []; this.byGroup = {}; }
  put(rel, data) {
    safeRel(rel);
    const g = groupOf(rel);
    if (!g) throw new Error(`fichier hors kit: ${rel}`);
    const dest = path.join(this.kitDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.partial';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dest);
    this.written.push(rel);
    const s = (this.byGroup[g] ||= { files: 0, bytes: 0 });
    s.files++; s.bytes += data.length;
  }
  rollback() {
    for (const rel of this.written) { try { fs.unlinkSync(path.join(this.kitDir, ...rel.split('/'))); } catch { /* deja absent */ } }
    this.written = []; this.byGroup = {};
  }
}

export function listKitFiles(kitDir, groups) {
  const out = [];
  const walk = (dir, rel) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(path.join(dir, d.name), r);
      else if (d.isFile() && !d.name.endsWith('.partial')) { const g = groupOf(r); if (g && (!groups || groups.has(g))) out.push({ rel: r, group: g }); }
    }
  };
  for (const top of ['assets', 'data']) if (fs.existsSync(path.join(kitDir, top))) walk(path.join(kitDir, top), top);
  return out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

// Empreinte: sha1 de la liste triee "chemin sha1" (globale et par groupe) + comptes.
export function kitFingerprint(kitDir, groups) {
  const per = {}; const all = crypto.createHash('sha1');
  const lines = {};
  for (const f of listKitFiles(kitDir, groups)) {
    const data = fs.readFileSync(path.join(kitDir, ...f.rel.split('/')));
    const line = `${f.rel} ${sha1(data)}\n`;
    all.update(line);
    (lines[f.group] ||= crypto.createHash('sha1')).update(line);
    const s = (per[f.group] ||= { files: 0, bytes: 0 });
    s.files++; s.bytes += data.length;
  }
  for (const g of Object.keys(per)) per[g].hash = lines[g].digest('hex').slice(0, 12);
  return { hash: all.digest('hex'), groups: per };
}

export function readInfo(kitDir) {
  try { return JSON.parse(fs.readFileSync(path.join(kitDir, 'kit.json'), 'utf8')); } catch { return null; }
}
export function writeInfo(kitDir, info) {
  fs.mkdirSync(kitDir, { recursive: true });
  fs.writeFileSync(path.join(kitDir, 'kit.json'), JSON.stringify(info, null, 1));
}
