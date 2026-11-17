// Route "mojang": comme le lanceur officiel, mais sans telecharger tout le jar (lecture par plages).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RangeRefused } from '../net.js';
import { FileSource, HttpSource, readCentralDirectory, extractWanted } from '../zip.js';
import { jarWanted, JAR_GROUPS, SOUND_EVENTS, SOUND_EVENTS_CREATURES, resolveSoundNames, sha1, pool } from '../kit.js';

export const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export const OBJECTS = 'https://resources.download.minecraft.net';

function check(body, want, what) {
  const got = sha1(body);
  if (got !== want) throw new Error(`${what}: sha1 ${got} au lieu de ${want}`);
}

async function fromJar(ctx, client, wantedGroups) {
  const { net, put, log } = ctx;
  const want = (e) => jarWanted(e.name, wantedGroups);
  let info = {};
  try {
    const src = new HttpSource(net, client.url, client.size);
    const cd = await readCentralDirectory(src);
    const wanted = cd.entries.filter(want);
    info.entriesInJar = cd.entries.length;
    info.wantedEntries = wanted.length;
    const r = await extractWanted(src, cd, wanted, put, { concurrency: 4, maxGap: ctx.opts.maxGap ?? 128 * 1024 });
    info.mode = 'range'; info.ranges = r.ranges; info.rangeBytes = r.rangeBytes;
    log(`jar: ${wanted.length} fichiers en ${r.ranges} plages`);
    return info;
  } catch (e) {
    if (!(e instanceof RangeRefused)) throw e;
    log('Range refuse: repli sur le jar entier');
  }
  // Repli: jar entier, sha1 + taille controles, lu depuis un fichier temporaire puis supprime.
  const tmp = path.join(ctx.kitDir, '..', `.jar-${process.pid}.partial`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  try {
    const r = await net.open(client.url);
    if (r.status !== 200) throw new Error(`jar: HTTP ${r.status}`);
    const h = crypto.createHash('sha1'); let n = 0;
    const out = fs.createWriteStream(tmp);
    for await (const c of r.stream) { h.update(c); n += c.length; if (!out.write(c)) await new Promise((ok) => out.once('drain', ok)); }
    await new Promise((ok) => out.end(ok));
    if (n !== client.size) throw new Error(`jar: ${n} octets au lieu de ${client.size}`);
    if (h.digest('hex') !== client.sha1) throw new Error('jar: sha1 faux');
    const src = new FileSource(tmp);
    const cd = await readCentralDirectory(src);
    const wanted = cd.entries.filter(want);
    await extractWanted(src, cd, wanted, put, { concurrency: 1, maxGap: Infinity });
    return { mode: 'jar-entier', wantedEntries: wanted.length };
  } finally { try { fs.unlinkSync(tmp); } catch { /* absent */ } }
}

async function fromAssets(ctx, assetIndex, events = ctx.opts.soundEvents || SOUND_EVENTS, tolerant = false) {
  const { net, put, log } = ctx;
  const body = (await net.buffer(assetIndex.url, { gzip: true })).body;
  check(body, assetIndex.sha1, 'index des assets');
  const objects = JSON.parse(body.toString('utf8')).objects;
  const getObj = async (key) => {
    const o = objects[key];
    if (!o) throw new Error(`absent de l'index des assets: ${key}`);
    if (!/^[0-9a-f]{40}$/.test(o.hash)) throw new Error(`hash invalide pour ${key}`);
    const data = (await net.buffer(`${OBJECTS}/${o.hash.slice(0, 2)}/${o.hash}`)).body;
    if (data.length !== o.size) throw new Error(`${key}: ${data.length} octets au lieu de ${o.size}`);
    check(data, o.hash, key);
    return data;
  };
  const sj = await getObj('minecraft/sounds.json');
  put('assets/minecraft/sounds.json', sj);
  const names = resolveSoundNames(JSON.parse(sj.toString('utf8')), events, tolerant);
  await pool(names, 8, async (n) => put(`assets/minecraft/sounds/${n}.ogg`, await getObj(`minecraft/sounds/${n}.ogg`)));
  log(`sons: ${names.length} fichiers .ogg`);
  return { sounds: names.length };
}

export async function run(ctx) {
  const { net, version, groups } = ctx;
  const man = await net.json(MANIFEST);
  const v = man.versions.find((x) => x.id === version);
  if (!v) throw new Error(`version ${version} absente du manifeste Mojang`);
  const vbody = (await net.buffer(v.url, { gzip: true })).body;
  check(vbody, v.sha1, `JSON de version ${version}`);
  const vj = JSON.parse(vbody.toString('utf8'));
  const client = vj.downloads?.client;
  if (!client) throw new Error('pas de downloads.client');
  const jarGroups = new Set([...groups].filter((g) => JAR_GROUPS.includes(g)));
  const tasks = [];
  const notes = {};
  if (jarGroups.size) tasks.push(fromJar(ctx, client, jarGroups).then((r) => { notes.jar = r; }));
  if (groups.has('sons')) tasks.push(fromAssets(ctx, vj.assetIndex).then((r) => { notes.assets = r; }));
  if (groups.has('sons_creatures')) tasks.push(fromAssets(ctx, vj.assetIndex, ctx.opts.evenementsCreatures || SOUND_EVENTS_CREATURES, true).then((r) => { notes.sonsCreatures = r; }));
  await Promise.all(tasks);
  return { notes: { ...notes, jarSize: client.size, jarSha1: client.sha1, assetIndex: vj.assetIndex.id } };
}
