// ensureKit: obtient (une fois) le kit de base de fichiers ORIGINAUX du jeu et le met en cache.
import fs from 'node:fs';
import path from 'node:path';
import { Net } from './net.js';
import { normGroups, KitWriter, readInfo, writeInfo, kitFingerprint } from './kit.js';
import * as mojang from './routes/mojang.js';
import * as github from './routes/github.js';
import * as npm from './routes/npm.js';
import * as archive from './routes/archive.js';

export { buildArchive } from './archive-build.js';
export { DEFAULT_GROUPS, GROUPS } from './kit.js';
const ROUTES = { mojang, github, npm, archive };
export const ROUTE_ORDER = ['mojang', 'github', 'npm', 'archive'];

// Retourne { dir, report }. dir = <cacheDir>/<version>/ (memes chemins que dans le jeu: assets/minecraft/...).
export async function ensureKit({ version = '26.3', cacheDir = '.kit-cache', route = 'auto', archivePath, groups, log = () => {}, net: netOpts, ...opts } = {}) {
  const t0 = Date.now();
  const want = normGroups(groups);
  const kitDir = path.resolve(cacheDir, version);
  const info = readInfo(kitDir) || { version, groups: {} };
  const need = new Set([...want].filter((g) => !info.groups[g]));
  const report = { version, route: null, complete: false, missing: [], files: 0, bytesDownloaded: 0, requests: 0, seconds: 0, groups: {}, hash: null, attempts: [], notes: {} };

  if (need.size === 0) {
    const fp = kitFingerprint(kitDir, want);
    Object.assign(report, { route: 'cache', complete: true, files: sumFiles(fp.groups), groups: fp.groups, hash: fp.hash, seconds: (Date.now() - t0) / 1000 });
    return { dir: kitDir, report };
  }

  const order = route === 'auto' ? ROUTE_ORDER.filter((r) => r !== 'archive' || archivePath) : [route];
  if (!order.every((r) => ROUTES[r])) throw new Error(`route inconnue: ${route}`);
  const net = new Net(netOpts);
  let best = null;
  try {
    for (const r of order) {
      const ta = Date.now();
      const writer = new KitWriter(kitDir);
      net.resetStats();
      const ctx = { version, kitDir, groups: need, net, log: (m) => log(`[${r}] ${m}`), put: (rel, data) => writer.put(rel, data), opts: { archivePath, ...opts } };
      try {
        const res = (await ROUTES[r].run(ctx)) || {};
        const missing = res.missing || [];
        const att = { route: r, ok: true, complete: missing.length === 0, seconds: (Date.now() - ta) / 1000, bytes: net.bytes, requests: net.requests, missing };
        report.attempts.push(att);
        const cand = { r, writer, res, att, missing, bytes: net.bytes, requests: net.requests };
        if (!missing.length) { best = cand; break; }
        if (!best || Object.keys(writer.byGroup).length > Object.keys(best.writer.byGroup).length) { best?.writer.rollback(); best = cand; } else writer.rollback();
      } catch (e) {
        writer.rollback();
        report.attempts.push({ route: r, ok: false, seconds: (Date.now() - ta) / 1000, bytes: net.bytes, requests: net.requests, error: e.message });
        log(`[${r}] echec: ${e.message}`);
      }
    }
  } finally { net.close(); }
  if (!best) {
    const err = new Error('aucune route ne marche: ' + report.attempts.map((a) => `${a.route}: ${a.error}`).join(' | '));
    err.report = { ...report, seconds: (Date.now() - t0) / 1000 };
    throw err;
  }
  for (const [g, s] of Object.entries(best.writer.byGroup)) info.groups[g] = { files: s.files, bytes: s.bytes, route: best.r };
  info.updated = new Date().toISOString();
  writeInfo(kitDir, info);
  const done = new Set([...want].filter((g) => info.groups[g]));
  const fp = kitFingerprint(kitDir, done);
  Object.assign(report, {
    route: best.r, complete: best.missing.length === 0, missing: best.missing, files: sumFiles(best.writer.byGroup),
    bytesDownloaded: best.bytes, requests: best.requests, seconds: (Date.now() - t0) / 1000, groups: fp.groups, hash: fp.hash, notes: best.res.notes || {},
  });
  return { dir: kitDir, report };
}
const sumFiles = (g) => Object.values(g).reduce((a, s) => a + s.files, 0);
