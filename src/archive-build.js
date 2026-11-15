// Fabrique un zip de kit a partir d'un dossier Minecraft/lanceur LOCAL (pour tests et dernier recours).
// Le zip contient des fichiers du jeu: il ne doit jamais etre mis dans le depot ni publie.
import fs from 'node:fs';
import path from 'node:path';
import { FileSource, readCentralDirectory, extractWanted, buildZip } from './zip.js';
import { jarWanted, normGroups, resolveSoundNames, SOUND_EVENTS, sha1 } from './kit.js';

export function findInstall(root, version) {
  const jar = path.join(root, 'versions', version, `${version}.jar`);
  if (!fs.existsSync(jar)) throw new Error(`jar introuvable: ${jar}`);
  let indexId = null;
  try { indexId = JSON.parse(fs.readFileSync(path.join(root, 'versions', version, `${version}.json`), 'utf8')).assetIndex?.id; } catch { /* pas de json */ }
  const dir = path.join(root, 'assets', 'indexes');
  let index = indexId && fs.existsSync(path.join(dir, `${indexId}.json`)) ? path.join(dir, `${indexId}.json`) : null;
  if (!index && fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      try { if (JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).objects?.['minecraft/sounds.json']) { index = path.join(dir, f); break; } } catch { /* ignore */ }
    }
  }
  return { jar, index, objects: path.join(root, 'assets', 'objects') };
}

export async function buildArchive({ root, version = '26.3', out, groups }) {
  const g = normGroups(groups);
  const inst = findInstall(root, version);
  const files = [];
  const src = new FileSource(inst.jar);
  const cd = await readCentralDirectory(src);
  await extractWanted(src, cd, cd.entries.filter((e) => jarWanted(e.name, g)), (name, data) => files.push({ name, data }), { concurrency: 1, maxGap: Infinity });
  if (g.has('sons')) {
    if (!inst.index) throw new Error("index d'assets introuvable (assets/indexes)");
    const objects = JSON.parse(fs.readFileSync(inst.index, 'utf8')).objects;
    const read = (key) => {
      const o = objects[key];
      if (!o) throw new Error(`absent de l'index: ${key}`);
      const data = fs.readFileSync(path.join(inst.objects, o.hash.slice(0, 2), o.hash));
      if (sha1(data) !== o.hash) throw new Error(`sha1 faux pour ${key}`);
      return data;
    };
    const sj = read('minecraft/sounds.json');
    files.push({ name: 'assets/minecraft/sounds.json', data: sj });
    for (const n of resolveSoundNames(JSON.parse(sj.toString('utf8')), SOUND_EVENTS)) files.push({ name: `assets/minecraft/sounds/${n}.ogg`, data: read(`minecraft/sounds/${n}.ogg`) });
  }
  files.sort((a, b) => (a.name < b.name ? -1 : 1));
  files.push({ name: 'kit-info.json', data: Buffer.from(JSON.stringify({ version, groups: [...g], fichiers: files.length })) });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const zip = buildZip(files);
  fs.writeFileSync(out, zip);
  return { files: files.length - 1, bytes: zip.length };
}
