// Route "github": miroir communautaire misode/mcmeta (aucune licence indiquee; nous ne copions rien dans notre depot).
// Textures/modeles/blockstates: tarball de l'etiquette <version>-assets-tiny filtre au vol.
// Sons: sounds.json et .ogg pris un par un dans l'etiquette <version>-assets (raw.githubusercontent.com).
import zlib from 'node:zlib';
import { Transform } from 'node:stream';
import { readTar } from '../tar.js';
import { jarWanted, SOUND_EVENTS, resolveSoundNames, pool } from '../kit.js';

const REPO = 'misode/mcmeta';

async function fromTarball(ctx, tag, groups) {
  const { net, put } = ctx;
  const r = await net.open(`https://codeload.github.com/${REPO}/tar.gz/refs/tags/${tag}`);
  if (r.status !== 200) { r.stream.resume(); throw new Error(`codeload: HTTP ${r.status} pour ${tag}`); }
  let n = 0;
  const strip = (name) => name.split('/').slice(1).join('/');
  await readTar(r.stream.pipe(zlib.createGunzip()), (name) => jarWanted(strip(name), groups), (name, data) => { put(strip(name), data); n++; });
  return n;
}

export async function run(ctx) {
  const { net, version, groups } = ctx;
  const notes = {};
  const tasks = [];
  const assetGroups = new Set([...groups].filter((g) => ['blockstates', 'models', 'textures', 'colormap', 'skins', 'environnement', 'objets', 'armures', 'interface'].includes(g)));
  if (assetGroups.size) tasks.push(fromTarball(ctx, `${version}-assets-tiny`, assetGroups).then((n) => { notes.tarballAssetsTiny = n; }));
  const dataGroups = new Set([...groups].filter((x) => x === 'worldgen' || x === 'biomes'));
  if (dataGroups.size) tasks.push(fromTarball(ctx, `${version}-${ctx.opts.dataTag || "data-json"}`, dataGroups).then((n) => { notes.tarballDataJson = n; }));
  if (groups.has('sons')) {
    tasks.push((async () => {
      const raw = (p) => `https://raw.githubusercontent.com/${REPO}/${version}-assets/assets/minecraft/${p}`;
      const sj = (await net.buffer(raw('sounds.json'))).body;
      ctx.put('assets/minecraft/sounds.json', sj);
      const names = resolveSoundNames(JSON.parse(sj.toString('utf8')), ctx.opts.soundEvents || SOUND_EVENTS);
      await pool(names, 8, async (nm) => ctx.put(`assets/minecraft/sounds/${nm}.ogg`, (await net.buffer(raw(`sounds/${nm}.ogg`))).body));
      notes.sounds = names.length;
    })());
  }
  await Promise.all(tasks);
  notes.avertissement = 'miroir communautaire sans licence ni sha1 officiel: contenu non verifie contre Mojang';
  return { notes };
}
