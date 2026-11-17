// ensureKit: obtient (une fois) le kit de base de fichiers ORIGINAUX du jeu et le met en cache.
import fs from 'node:fs';
import path from 'node:path';
import { Net } from './net.js';
import { normGroups, KitWriter, readInfo, writeInfo, kitFingerprint, GROUP_VERSIONS } from './kit.js';
import * as mojang from './routes/mojang.js';
import * as git from './routes/git.js';
import * as github from './routes/github.js';
import * as npm from './routes/npm.js';
import * as archive from './routes/archive.js';

export { buildArchive } from './archive-build.js';
export { DEFAULT_GROUPS, GROUPS } from './kit.js';
const ROUTES = { mojang, git, github, npm, archive };
// Ordre de 'auto' : officiel d'abord ; puis git (github.com seul : passe quand codeload/api sont bloques) ; puis le tarball codeload ;
// puis l'archive hors ligne (seulement si donnee) ; npm en dernier : PARTIEL (autre version du jeu, aucun son), jamais accepte seul sans le dire.
export const ROUTE_ORDER = ['mojang', 'git', 'github', 'archive', 'npm'];

// Raison d'echec en quelques mots, pour le message final : "403 (codeload)", "git absent", "delai depasse"...
export function raisonCourte(e) {
  if (e.court) return e.court;
  if (e.status) { const h = e.url ? new URL(e.url).hostname.split('.')[0] : ''; return h ? `${e.status} (${h})` : String(e.status); }
  if (/delai depasse|plus de donnees/.test(e.message)) return 'delai depasse';
  const m = /\b(40[0-9]|50[0-9])\b/.exec(e.message);
  if (m) return m[1];
  return e.message.replace(/\s+/g, ' ').slice(0, 60);
}

const CONSEIL = "que faire : ouvrir github.com (avec git) ou piston-meta.mojang.com, ou donner un kit pret (MCANIM_KIT=<dossier> ou archive)";
export function messageKitIntrouvable(attempts) {
  const parts = attempts.map((a) => (/^\d/.test(a.court) || a.court.startsWith('partiel') ? `${a.route} ${a.court}` : `${a.route}: ${a.court}`));
  const seule = attempts.find((a) => a.ok && !a.complete);
  return `${seule ? `kit incomplet (la route ${seule.route} est PARTIELLE, rendu refuse)` : 'kit introuvable'} : ${parts.join(', ')} ; ${CONSEIL}`;
}

export async function ensureKit({ version = '26.3', cacheDir = '.kit-cache', route = 'auto', archivePath, groups, allowPartial = false, log = () => {}, net: netOpts, _routes = ROUTES, ...opts } = {}) {
  const t0 = Date.now();
  const want = normGroups(groups);
  const kitDir = path.resolve(cacheDir, version);
  const info = readInfo(kitDir) || { version, groups: {} };
  const need = new Set([...want].filter((g) => !info.groups[g] || (info.groups[g].v ?? 1) < (GROUP_VERSIONS[g] ?? 1)));   // groupe absent ou d'une version plus ancienne
  // sons des creatures : on ne prend que les evenements des types de la scene (opts.evenementsCreatures) ; il en manque -> on recupere le manque
  const dejaCreatures = info.groups.sons_creatures?.evenements ?? [];
  if (want.has('sons_creatures') && opts.evenementsCreatures) {
    const manque = opts.evenementsCreatures.filter((e) => !dejaCreatures.includes(e));
    if (manque.length) { need.add('sons_creatures'); opts.evenementsCreatures = manque; } else need.delete('sons_creatures');
  }
  const report = { version, route: null, complete: false, partial: false, missing: [], files: 0, bytesDownloaded: 0, requests: 0, seconds: 0, groups: {}, hash: null, attempts: [], notes: {} };

  if (need.size === 0) {
    const fp = kitFingerprint(kitDir, want);
    Object.assign(report, { route: 'cache', complete: true, files: sumFiles(fp.groups), groups: fp.groups, hash: fp.hash, seconds: (Date.now() - t0) / 1000 });
    return { dir: kitDir, report };
  }

  const routes = _routes;
  const order = route === 'auto' ? ROUTE_ORDER.filter((r) => routes[r] && (r !== 'archive' || archivePath)) : [route];
  if (!order.every((r) => routes[r])) throw new Error(`route inconnue: ${route}`);
  const net = new Net(netOpts);
  let best = null;     // route COMPLETE (arret des essais)
  let partial = null;  // meilleure route partielle : gardee seulement si allowPartial, sinon annulee
  try {
    for (const r of order) {
      const ta = Date.now();
      const writer = new KitWriter(kitDir);
      net.resetStats();
      const ctx = { version, kitDir, groups: need, net, log: (m) => log(`[${r}] ${m}`), put: (rel, data) => writer.put(rel, data), opts: { archivePath, ...opts } };
      try {
        const res = (await routes[r].run(ctx)) || {};
        const missing = res.missing || [];
        const att = { route: r, ok: true, complete: missing.length === 0, seconds: (Date.now() - ta) / 1000, bytes: net.bytes, requests: net.requests, missing };
        if (missing.length) att.court = res.court || `partiel (manque ${missing.join('+')})`;
        report.attempts.push(att);
        const cand = { r, writer, res, att, missing, bytes: net.bytes, requests: net.requests };
        if (!missing.length) { best = cand; break; }
        log(`[${r}] kit PARTIEL (manque ${missing.join(', ')}) : ${res.notes?.avertissement || ''}`);
        if (!partial || Object.keys(writer.byGroup).length > Object.keys(partial.writer.byGroup).length) { partial?.writer.rollback(); partial = cand; } else writer.rollback();
      } catch (e) {
        writer.rollback();
        report.attempts.push({ route: r, ok: false, seconds: (Date.now() - ta) / 1000, bytes: net.bytes, requests: net.requests, error: e.message, court: raisonCourte(e) });
        log(`[${r}] echec: ${e.message}`);
      }
    }
  } finally { net.close(); }
  if (!best && partial && allowPartial) { best = partial; partial = null; report.partial = true; }
  partial?.writer.rollback();
  if (!best) {
    const err = new Error(messageKitIntrouvable(report.attempts));
    err.report = { ...report, seconds: (Date.now() - t0) / 1000 };
    throw err;
  }
  if (!report.partial) for (const [g, s] of Object.entries(best.writer.byGroup)) if (need.has(g)) info.groups[g] = { files: s.files + (g === 'sons_creatures' ? info.groups[g]?.files ?? 0 : 0), bytes: s.bytes + (g === 'sons_creatures' ? info.groups[g]?.bytes ?? 0 : 0), route: best.r, ...(GROUP_VERSIONS[g] ? { v: GROUP_VERSIONS[g] } : {}), ...(g === 'sons_creatures' ? { evenements: [...new Set([...dejaCreatures, ...(opts.evenementsCreatures ?? [])])].sort() } : {}) };
  if (!report.partial && need.has('sons_creatures') && !best.writer.byGroup.sons_creatures) info.groups.sons_creatures = { files: info.groups.sons_creatures?.files ?? 0, bytes: info.groups.sons_creatures?.bytes ?? 0, route: best.r, evenements: [...new Set([...dejaCreatures, ...(opts.evenementsCreatures ?? [])])].sort() };
  info.updated = new Date().toISOString();
  if (!report.partial) writeInfo(kitDir, info);
  const done = new Set([...want].filter((g) => info.groups[g] || (report.partial && best.writer.byGroup[g])));
  const fp = kitFingerprint(kitDir, done);
  Object.assign(report, {
    route: best.r, complete: best.missing.length === 0, missing: best.missing, files: sumFiles(best.writer.byGroup),
    bytesDownloaded: best.bytes, requests: best.requests, seconds: (Date.now() - t0) / 1000, groups: fp.groups, hash: fp.hash, notes: best.res.notes || {},
  });
  return { dir: kitDir, report };
}
const sumFiles = (g) => Object.values(g).reduce((a, s) => a + s.files, 0);
