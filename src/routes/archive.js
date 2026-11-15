// Route "archive": charge un zip de kit fabrique par bin/fabriquer-kit.js (hors ligne).
import { FileSource, readCentralDirectory, extractWanted } from '../zip.js';
import { groupOf, GROUPS } from '../kit.js';

export async function run(ctx) {
  const p = ctx.opts.archivePath;
  if (!p) throw new Error("pas d'archivePath");
  const src = new FileSource(p);
  const cd = await readCentralDirectory(src);
  const wanted = cd.entries.filter((e) => { const g = groupOf(e.name); return g && ctx.groups.has(g) && !e.name.endsWith('/'); });
  if (!wanted.length) throw new Error('archive: aucun fichier du kit dedans');
  await extractWanted(src, cd, wanted, ctx.put, { concurrency: 1, maxGap: Infinity });
  const have = new Set(wanted.map((e) => groupOf(e.name)));
  const missing = [...ctx.groups].filter((g) => !have.has(g));
  return { missing, notes: { archive: p, archiveBytes: src.size } };
}
