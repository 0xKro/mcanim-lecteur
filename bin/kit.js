#!/usr/bin/env node
// Usage: node bin/kit.js [--route auto|mojang|npm|github|archive] [--cache DIR] [--version 26.3]
//        [--archive kit.zip] [--groups a,b,c] [--worldgen] [--verbose]
// Affiche le rapport en JSON sur la sortie standard (une ligne).
import { ensureKit, DEFAULT_GROUPS } from '../src/index.js';

const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
const flag = (n) => a.includes('--' + n);
let groups = opt('groups') ? opt('groups').split(',') : undefined;
if (flag('worldgen')) groups = [...(groups || DEFAULT_GROUPS), 'worldgen'];
try {
  const { dir, report } = await ensureKit({
    version: opt('version', '26.3'), cacheDir: opt('cache', '.kit-cache'), route: opt('route', 'auto'),
    archivePath: opt('archive'), dataTag: opt('data-tag'), groups, log: flag('verbose') ? (m) => console.error(m) : undefined,
  });
  console.log(JSON.stringify({ dir, ...report }));
} catch (e) {
  console.log(JSON.stringify({ erreur: e.message, ...(e.report || {}) }));
  process.exit(1);
}
