#!/usr/bin/env node
// Usage: node bin/fabriquer-kit.js <dossier minecraft> <sortie.zip> [--version 26.3] [--worldgen]
// Fabrique un zip de kit a partir d'une copie LOCALE du jeu. Le zip contient des fichiers du jeu:
// ne jamais le mettre dans le depot ni le publier (ecrire dans kit/, .kit-cache/ ou sorties/).
import { buildArchive } from '../src/archive-build.js';
import { DEFAULT_GROUPS } from '../src/kit.js';

const a = process.argv.slice(2);
const pos = a.filter((x, i) => !x.startsWith('--') && !(i > 0 && a[i - 1] === '--version'));
if (pos.length < 2) { console.error('usage: fabriquer-kit.js <dossier minecraft> <sortie.zip> [--version 26.3] [--worldgen]'); process.exit(2); }
const vi = a.indexOf('--version');
const groups = a.includes('--worldgen') ? [...DEFAULT_GROUPS, 'worldgen'] : undefined;
try {
  const r = await buildArchive({ root: pos[0], out: pos[1], version: vi >= 0 ? a[vi + 1] : '26.3', groups });
  console.log(`kit ecrit: ${pos[1]} (${r.files} fichiers, ${r.bytes} octets)`);
} catch (e) { console.error('erreur: ' + e.message); process.exit(1); }
