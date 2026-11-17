// Commande `mcanim decor` : verifier, apercu, executer. Gratuit, sorties COURTES (elles coutent des jetons au client).
//   mcanim decor verifier <decor.json|scene.json> [--zone id]
//   mcanim decor apercu <decor.json|scene.json> [--vue iso|dessus|face] [--cote sud|nord|est|ouest|sud-est...] [--contexte] [--taille 512x384] [--sortie f.png] [--zone id]
//   mcanim decor executer <script.py> --sortie decor.json     (le script ecrit le decor avec decor.py ; le lecteur ne lance JAMAIS de code au rendu)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lireDecorsScene, appliquerDecors } from './appliquer.js';
import { lireDecorTexte } from './lire.js';
import { ErreurDecor } from './grille.js';

export const AIDE_DECOR = `mcanim decor verifier <decor.json|scene.json> [--zone id]   lit, controle et applique le decor EN MEMOIRE (sans rendre) : emprise, blocs, etats recalcules, avertissements (flottants, portes bloquees, sans appui) ; 15 lignes au plus ; gratuit
  mcanim decor apercu <decor.json|scene.json> [--vue iso|dessus|face] [--cote sud|nord|est|ouest|sud-est|...] [--contexte] [--taille 512x384] [--sortie a.png]   petite image filigranee du decor seul (6 blocs de terrain autour) ou dans son contexte ; gratuit
  mcanim decor executer <script.py> --sortie decor.json   lance le script Python (module decor.py, python -I, 20 s) qui ECRIT le decor, puis le controle ; le lecteur n'execute jamais de code au rendu
  mcanim decor module                                       chemin du module decor.py (a copier a cote de ton script) ; fiches decor_bases, decor_operations, decor_terrain, decor_maison
  mcanim terrain --scene scene.json                         le resume du terrain APRES les decors de la scene (chemins, clairieres)`;

const DELAI_MS = 20000;

// Lit un fichier : un decor (objet avec ops) ou une scene (acteurs). Rend { decors: [{decor, nom}], zoneId, scene, baseDir, donnees, zone }.
async function preparer(fichier, opt, o) {
  const { obtenirZone, lireTexte, Usage, dire } = o;
  const texte = lireTexte(fichier);
  let brut;
  try { brut = JSON.parse(texte.replace(/^﻿/, '')); } catch (e) { throw new Usage(`${fichier} : JSON invalide (${e.message})`); }
  const baseDir = path.dirname(path.resolve(fichier));
  const { donneesDuJeu } = await import('../moteur/chargeur.js');
  const donnees = await donneesDuJeu({ log: dire });
  let decors, zoneId, scene = null;
  try {
    if (brut && Array.isArray(brut.acteurs)) {
      const { lireScene } = await import('../film/scene.js');
      scene = lireScene(texte).scene;
      if (!scene.decor?.length) throw new Usage("la scene n'a pas de champ decor (liste de fichiers .decor.json ou d'objets en ligne)");
      zoneId = scene.zone;
      decors = lireDecorsScene(scene.decor, { baseDir, d: donnees, zoneId });
    } else {
      const decor = lireDecorTexte(texte, donnees, path.basename(fichier));
      zoneId = opt.zone || decor.zone;
      if (!zoneId) throw new Usage('--zone <id de zone> est attendu (ou le champ "zone" du decor)');
      decors = [{ decor, nom: path.basename(fichier) }];
    }
  } catch (e) { if (e instanceof ErreurDecor) throw new Usage(e.message); throw e; }
  const { lireZone } = await import('../rendu/zone.js');
  const zone = lireZone((await obtenirZone(zoneId)).chemin);
  return { decors, zoneId, scene, baseDir, donnees, zone };
}

export async function commandeDecor(argv, o) {
  const { lireArgs, dire, Usage } = o;
  const sous = argv[0];
  const reste = argv.slice(1);
  if (!sous || sous === 'aide') return dire(AIDE_DECOR);
  const t0 = Date.now();
  try {
    if (sous === 'module') return dire(fileURLToPath(new URL('./decor.py', import.meta.url)));
    if (sous === 'verifier') {
      const { pos, opt } = lireArgs(reste, { valeurs: ['zone'] });
      if (pos.length !== 1) throw new Usage('usage : mcanim decor verifier <decor.json|scene.json> [--zone id]');
      const p = await preparer(pos[0], opt, o);
      const r = appliquerDecors(p.zone, p.decors, { donnees: p.donnees });
      // 15 lignes au plus en tout : avec plusieurs decors, chacun garde sa premiere ligne et sa ligne d'avertissements, puis ce qui reste de place
      const parDecor = Math.max(2, Math.floor((p.scene?.acteurs?.length ? 14 : 15) / r.rapports.length));
      let lignes = [];
      for (const rap of r.rapports) {
        const L = rap.lignes;
        if (L.length <= parDecor) { lignes.push(...L); continue; }
        const milieu = L.slice(1, -1).slice(0, parDecor - 2);
        lignes.push(L[0], ...milieu, L[L.length - 1]);
      }
      // acteurs de la scene : un trajet qui traverse un mur
      if (p.scene && p.scene.acteurs.length) {
        try {
          const t = await o.terrainDeScene(p.scene, { telecharger: true, baseDir: p.baseDir });
          try {
            const { trajetsDeScene } = await import('../film/trajet.js');
            const tr = trajetsDeScene(p.scene, t.terrain);
            const obs = tr.flatMap((x) => x.evenements.filter((e) => e.genre === 'obstacle').map((e) => `${x.nom} ${e.texte}`));
            lignes.push(`acteurs : ${obs.length ? obs.length + ' obstacle(s) sur les trajets : ' + obs.slice(0, 2).map((s) => s.slice(0, 110)).join(' ; ') : 'aucun obstacle sur les trajets (mcanim trajet pour le detail)'}`);
          } finally { await t.rs.fermer(); }
        } catch (e) { lignes.push(`acteurs : trajets non controles (${String(e.message).slice(0, 80)})`); }
      }
      lignes = lignes.slice(0, 15);
      lignes[lignes.length - 1] += ` (${((Date.now() - t0) / 1000).toFixed(1)} s)`;
      return dire(lignes.join('\n'));
    }
    if (sous === 'apercu') {
      const { pos, opt } = lireArgs(reste, { valeurs: ['zone', 'vue', 'cote', 'taille', 'sortie'], drapeaux: ['contexte'] });
      if (pos.length !== 1) throw new Usage('usage : mcanim decor apercu <decor.json|scene.json> [--vue iso|dessus|face] [--cote ...] [--contexte] [--taille 512x384] [--sortie a.png]');
      let taille = [512, 384];
      if (opt.taille) { const m = /^(\d+)x(\d+)$/.exec(opt.taille); if (!m || +m[1] < 64 || +m[1] > 640 || +m[2] < 64 || +m[2] > 640) throw new Usage('--taille : LARGEURxHAUTEUR entre 64 et 640 (ex. 512x384)'); taille = [+m[1], +m[2]]; }
      const p = await preparer(pos[0], opt, o);
      const r = appliquerDecors(p.zone, p.decors, { donnees: p.donnees });
      const E = r.rapports.reduce((a, rap) => (rap.cellules ? (a ? { x0: Math.min(a.x0, rap.emprise.x0), x1: Math.max(a.x1, rap.emprise.x1), y0: Math.min(a.y0, rap.emprise.y0), y1: Math.max(a.y1, rap.emprise.y1), z0: Math.min(a.z0, rap.emprise.z0), z1: Math.max(a.z1, rap.emprise.z1) } : { ...rap.emprise }) : a), null);
      if (!E) throw new Usage('le decor ne change rien : rien a montrer');
      const { apercuDecor, ecrirePng, VUES } = await import('./apercu.js');
      if (opt.vue && !VUES.includes(opt.vue)) throw new Usage(`--vue : ${VUES.join(', ')}`);
      const kit = await o.trouverKit({});
      const solMin = Math.min(...r.rapports.filter((x) => x.cellules).map((x) => x.sol.min));
      const img = await apercuDecor({ zone: r.zone, zoneAvant: p.zone, donnees: p.donnees, solMin, emprise: E, kitDir: kit, vue: opt.vue || 'iso', cote: opt.cote || null, contexte: !!opt.contexte, taille });
      const sortie = path.resolve(opt.sortie || 'decor-apercu.png');
      ecrirePng(sortie, img.png);
      return dire(`apercu ${sortie} | vue ${opt.vue || 'iso'}${opt.contexte ? ' (contexte)' : ' (decor seul)'} | ${taille.join('x')} | ${((Date.now() - t0) / 1000).toFixed(1)} s | filigrane : ce n'est PAS un rendu, mcanim rendre demande un jeton`);
    }
    if (sous === 'executer') {
      const { pos, opt } = lireArgs(reste, { valeurs: ['sortie'] });
      if (pos.length !== 1 || !opt.sortie) throw new Usage('usage : mcanim decor executer <script.py> --sortie decor.json');
      const script = path.resolve(pos[0]), sortie = path.resolve(opt.sortie);
      if (!fs.existsSync(script)) throw new Usage(`script introuvable : ${pos[0]}`);
      const modDir = path.dirname(fileURLToPath(new URL('./decor.py', import.meta.url)));
      const lanceur = 'import sys, runpy\nsys.path.insert(0, sys.argv[1])\ntry:\n    import resource\n    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))\nexcept Exception:\n    pass\nrunpy.run_path(sys.argv[2], run_name="__main__")\n';
      for (const py of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
        const r = spawnSync(py, ['-I', '-c', lanceur, modDir, script], { cwd: path.dirname(script), timeout: DELAI_MS, encoding: 'utf8', env: { ...process.env, MCANIM_DECOR_SORTIE: sortie, PYTHONIOENCODING: 'utf-8' } });
        if (r.error && r.error.code === 'ENOENT') continue;
        if (r.error && r.error.code === 'ETIMEDOUT') throw new Usage(`le script a depasse ${DELAI_MS / 1000} s : arrete (boucle sans fin ?)`);
        if (r.status !== 0) throw new Usage(`le script a echoue (code ${r.status}) : ${String(r.stderr || r.error?.message || '').trim().split('\n').slice(-4).join(' | ').slice(0, 400)}`);
        if (!fs.existsSync(sortie)) throw new Usage(`le script n'a pas ecrit ${opt.sortie} : termine-le par decor.ecrire() (ou d.ecrire("fichier.json"))`);
        const { donneesDuJeu } = await import('../moteur/chargeur.js');
        const donnees = await donneesDuJeu({ log: dire });
        try { const decor = lireDecorTexte(fs.readFileSync(sortie, 'utf8'), donnees, path.basename(sortie)); return dire(`decor ${path.basename(sortie)} ecrit et controle : ${decor.ops.length} operation(s) apres developpement, ${fs.statSync(sortie).size} octets ; suite : mcanim decor verifier ${opt.sortie} --zone <id>`); } catch (e) { if (e instanceof ErreurDecor) throw new Usage(e.message); throw e; }
      }
      throw new Usage('Python est introuvable (python / python3) : ecris le decor en JSON, ou installe Python 3.8+');
    }
  } catch (e) { if (e instanceof ErreurDecor) throw new Usage(e.message); throw e; }
  throw new Usage(`mcanim decor : sous-commande inconnue "${sous}"\n${AIDE_DECOR}`);
}
