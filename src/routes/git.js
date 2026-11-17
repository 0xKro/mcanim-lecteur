// Route "git": miroir communautaire misode/mcmeta, lu avec le programme `git` du systeme sur github.com SEUL
// (git smart-HTTP passe dans les environnements ou codeload.github.com et api.github.com sont bloques).
// Pour chaque etiquette utile : clone vide + recuperation d'un seul commit (profondeur 1) SANS les blobs (filtre blob:none),
// puis extraction creuse (sparse-checkout) des seuls dossiers du kit : seuls les fichiers voulus sont telecharges.
// Sons : sounds.json + les .ogg de pas un par un sur raw.githubusercontent.com (plus leger) ; sinon, repli par git.
// Aucun shell : execFile avec des arguments fixes. Le clone temporaire est TOUJOURS supprime (succes, echec, delai).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { GROUPS, SOUND_EVENTS, resolveSoundNames, listKitFiles, pool } from '../kit.js';

export const DEPOT = 'https://github.com/misode/mcmeta';
const RAW = 'https://raw.githubusercontent.com/misode/mcmeta';
const GROUPES_ASSETS = ['blockstates', 'models', 'textures', 'colormap', 'skins', 'environnement', 'objets', 'armures', 'interface', 'projectiles'];

const erreur = (message, court) => Object.assign(new Error(message), { court });

// Lance git (sans shell). Echec -> Error avec `court` = raison en quelques mots (pour le message final de ensureKit).
function git(args, { cwd, timeout, env }) {
  return new Promise((ok, ko) => {
    execFile('git', args, {
      cwd, timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024, killSignal: 'SIGKILL',
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GCM_INTERACTIVE: 'never', LC_ALL: 'C', LANG: 'C' },
    }, (e, stdout, stderr) => {
      if (!e) return ok(String(stdout));
      const msg = String(stderr || '').trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300) || e.message;
      if (e.code === 'ENOENT') return ko(erreur("git n'est pas installe (programme `git` introuvable)", 'git absent'));
      if (e.killed || e.signal) return ko(erreur(`git : delai depasse (${Math.round(timeout / 1000)} s) : ${args.find((a) => !a.startsWith('-')) || ''}`, 'delai depasse'));
      const code = /\b(?:HTTP(?: code)?|CONNECT[^0-9]*|response)\s*(?:code\s*)?(\d{3})\b/i.exec(msg)?.[1] || /\b(40[0-9]|50[0-9])\b/.exec(msg)?.[1];
      let court = code || (/resolve host|could not resolve/i.test(msg) ? 'DNS' : /timed? ?out/i.test(msg) ? 'delai depasse' : msg.slice(0, 60));
      ko(erreur(`git ${args.find((a) => !a.startsWith('-') && a !== 'tag') || ''} : ${msg}`, court));
    });
  });
}

// "git version 2.43.0.windows.1" -> [2, 43]
async function versionGit(opts) {
  const out = await git(['--version'], { timeout: 5000, ...opts });
  const m = /(\d+)\.(\d+)/.exec(out);
  if (!m) throw erreur(`version de git illisible : ${out.trim()}`, 'git illisible');
  const v = [Number(m[1]), Number(m[2])];
  if (v[0] < 2 || (v[0] === 2 && v[1] < 30)) throw erreur(`git ${v.join('.')} trop ancien (2.30 minimum)`, `git ${v.join('.')} trop ancien`);
  return v;
}

const prefixeSparse = (g) => GROUPS[g].map((p) => '/' + p);
const tailleDossier = (d) => { let n = 0; try { for (const f of fs.readdirSync(d)) n += fs.statSync(path.join(d, f)).size; } catch { /* absent */ } return n; };

// Prepare un depot temporaire, recupere <etiquette> en profondeur 1 sans blobs, ne materialise que `patterns`, appelle fn(dir, etendre).
// `etendre(patterns)` ajoute des chemins (deuxieme lot de blobs, une seule requete groupee). Supprime le depot a la fin.
async function avecClone(ctx, tag, patterns, fn) {
  const { depot, delaiGit, delaiTelechargement } = ctx.cfg;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcanim-git-'));
  const lent = ['-c', 'http.lowSpeedLimit=2000', '-c', 'http.lowSpeedTime=20'];
  const o = { cwd: tmp };
  try {
    await git(['init', '-q', '.'], { ...o, timeout: delaiGit });
    await git(['remote', 'add', 'origin', depot], { ...o, timeout: delaiGit });
    // octets exacts : pas de conversion de fin de ligne (Git pour Windows convertit par defaut)
    for (const [k, v] of [['core.autocrlf', 'false'], ['core.eol', 'lf'], ['core.safecrlf', 'false'], ['core.longpaths', 'true'], ['core.sparseCheckout', 'true'], ['advice.detachedHead', 'false']]) {
      await git(['config', k, v], { ...o, timeout: delaiGit });
    }
    const ecrireSparse = (liste) => fs.writeFileSync(path.join(tmp, '.git', 'info', 'sparse-checkout'), liste.join('\n') + '\n');
    fs.mkdirSync(path.join(tmp, '.git', 'info'), { recursive: true });
    ecrireSparse(patterns);
    ctx.log(`git: ${tag}`);
    await git([...lent, 'fetch', '-q', '--depth', '1', '--filter=blob:none', '--no-tags', 'origin', 'tag', tag], { ...o, timeout: delaiTelechargement });
    await git([...lent, 'checkout', '-q', '--detach', `refs/tags/${tag}`], { ...o, timeout: delaiTelechargement });
    ctx.compter(1);
    const etendre = async (plus) => {
      ecrireSparse([...patterns, ...plus]);
      await git([...lent, 'read-tree', '-mu', 'HEAD'], { ...o, timeout: delaiTelechargement });
      ctx.compter(1);
    };
    return await fn(tmp, etendre);
  } finally {
    ctx.octets(tailleDossier(path.join(tmp, '.git', 'objects', 'pack')));
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch (e) { ctx.log(`dossier temporaire non supprime : ${tmp} (${e.code})`); }
  }
}

// Copie dans le cache les fichiers des groupes voulus trouves dans le clone.
function copier(ctx, dir, groupes) {
  let n = 0;
  for (const f of listKitFiles(dir, new Set(groupes))) { ctx.put(f.rel, fs.readFileSync(path.join(dir, ...f.rel.split('/')))); n++; }
  return n;
}

async function sonsParRaw(ctx, version) {
  const { net } = ctx;
  const raw = (p) => `${RAW}/${version}-assets/assets/minecraft/${p}`;
  const sj = (await net.buffer(raw('sounds.json'))).body;
  const names = resolveSoundNames(JSON.parse(sj.toString('utf8')), ctx.opts.soundEvents || SOUND_EVENTS);
  const oggs = new Map();
  await pool(names, 8, async (nm) => oggs.set(nm, (await net.buffer(raw(`sounds/${nm}.ogg`))).body));
  ctx.put('assets/minecraft/sounds.json', sj);
  for (const nm of names) ctx.put(`assets/minecraft/sounds/${nm}.ogg`, oggs.get(nm));
  return names.length;
}

async function sonsParGit(ctx, version) {
  return avecClone(ctx, `${version}-assets`, ['/assets/minecraft/sounds.json'], async (dir, etendre) => {
    const sj = fs.readFileSync(path.join(dir, 'assets', 'minecraft', 'sounds.json'));
    const names = resolveSoundNames(JSON.parse(sj.toString('utf8')), ctx.opts.soundEvents || SOUND_EVENTS);
    await etendre(names.map((n) => `/assets/minecraft/sounds/${n}.ogg`));
    for (const nm of names) if (!fs.existsSync(path.join(dir, 'assets', 'minecraft', 'sounds', ...`${nm}.ogg`.split('/')))) throw erreur(`son absent du depot : ${nm}`, 'son absent');
    ctx.put('assets/minecraft/sounds.json', sj);
    copier(ctx, dir, ['sons']);
    return names.length;
  });
}

export async function run(ctx) {
  const { version, groups } = ctx;
  ctx.cfg = {
    depot: ctx.opts.gitUrl || DEPOT,
    delaiGit: ctx.opts.gitDelai ?? 4000,                 // etapes locales et premiere prise de contact
    delaiTelechargement: ctx.opts.gitDelaiTelechargement ?? 120000,
  };
  const net = ctx.net;
  ctx.compter = (n) => { net.requests += n; };
  ctx.octets = (n) => { net.bytes += n; };
  const { depot, delaiGit } = ctx.cfg;
  const nots = {};
  await versionGit({});
  const assets = [...groups].filter((g) => GROUPES_ASSETS.includes(g));
  const donnees = [...groups].filter((g) => g === 'biomes' || g === 'worldgen');
  const tagAssets = `${version}-assets-tiny`;
  const tagDonnees = `${version}-${ctx.opts.dataTag || 'data-json'}`;
  const tags = [];
  if (assets.length) tags.push(tagAssets);
  if (donnees.length) tags.push(tagDonnees);
  if (groups.has('sons')) tags.push(`${version}-assets`);
  // prise de contact rapide : un site bloque (403) ou muet echoue en quelques secondes, avant tout telechargement
  const refs = await git(['ls-remote', '--tags', depot, ...tags.map((t) => `refs/tags/${t}`)], { timeout: delaiGit });
  for (const t of tags) if (!refs.includes(`refs/tags/${t}`)) throw erreur(`etiquette ${t} absente de ${depot}`, `etiquette ${t} absente`);
  net.requests += 1;

  const taches = [];
  if (assets.length) {
    taches.push(avecClone(ctx, tagAssets, assets.flatMap(prefixeSparse), async (dir) => { nots.assets = copier(ctx, dir, assets); }));
  }
  if (donnees.length) {
    taches.push(avecClone(ctx, tagDonnees, donnees.flatMap(prefixeSparse), async (dir) => { nots.donnees = copier(ctx, dir, donnees); }));
  }
  if (groups.has('sons')) {
    taches.push((async () => {
      try { nots.sons = await sonsParRaw(ctx, version); nots.sonsVia = 'raw.githubusercontent.com'; } catch (e) {
        ctx.log(`sons par raw impossibles (${e.message}) : repli par git`);
        nots.sons = await sonsParGit(ctx, version); nots.sonsVia = 'git';
      }
    })());
  }
  const res = await Promise.allSettled(taches);
  const echec = res.find((r) => r.status === 'rejected');
  if (echec) throw echec.reason;
  nots.avertissement = 'miroir communautaire sans licence ni sha1 officiel: contenu non verifie contre Mojang';
  return { notes: nots };
}
