// Pilote Node de l'hote GL (src/pack/hote/hote.py) : lance python3, envoie des commandes JSON, recoit des images RGBA.
// Rien n'est installe : Python 3 (stdlib, ctypes) + libEGL de Mesa. Voir docs/SHADERS-REELS.md.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
export const DOSSIER_HOTE = path.join(ICI, 'hote');
// pas de fichiers .pyc ecrits dans le paquet installe (dossier parfois en lecture seule)
const ENV_PY = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };

function trouverPython() {
  for (const c of [process.env.MCANIM_PYTHON, 'python3', 'python'].filter(Boolean)) {
    const r = spawnSync(c, ['-c', 'import sys;print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === '3') return c;
  }
  return null;
}

// "Peut-on rendre avec un vrai pack ici ?" -> { ok, lignes[], raison? }. Rapide (moins d'une seconde), ne cree rien.
export function diagnostic() {
  if (process.platform !== 'linux') return { ok: false, lignes: [], raison: `Linux seulement (ici ${process.platform})` };
  const py = trouverPython();
  if (!py) return { ok: false, lignes: [], raison: 'Python 3 est introuvable (sur Ubuntu : apt-get install -y python3)' };
  const r = spawnSync(py, ['-I', '-B', path.join(DOSSIER_HOTE, 'diagnostic.py')], { encoding: 'utf8', timeout: 30000, env: ENV_PY });
  const lignes = (r.stdout || '').trim().split('\n').filter(Boolean);
  if (r.status === 0) return { ok: true, lignes, python: py };
  return { ok: false, lignes, raison: lignes[0] || (r.stderr || '').trim().split('\n').pop() || 'le contexte OpenGL logiciel ne demarre pas' };
}

export class Hote {
  constructor(proc) {
    this.proc = proc;
    this.tampon = Buffer.alloc(0);
    this.attentes = [];
    this.morceaux = []; this.total = 0; this.besoin = 0;
    proc.stdout.on('data', (d) => { this.morceaux.push(d); this.total += d.length; if (this.total >= this.besoin) this._vider(); });
    proc.stderr.on('data', (d) => { this.stderr = ((this.stderr || '') + d.toString()).slice(-4000); });
    proc.on('exit', (code) => { this.fini = true; for (const a of this.attentes.splice(0)) a.rejeter(new Error(`l'hote GL s'est arrete (code ${code}) : ${(this.stderr || '').trim().split('\n').slice(-3).join(' | ')}`)); });
  }

  static async demarrer({ python } = {}) {
    const d = diagnostic();
    if (!d.ok) throw new Error('rendu avec un vrai pack impossible ici : ' + d.raison);
    const proc = spawn(python || d.python, ['-I', '-B', path.join(DOSSIER_HOTE, 'hote.py')], { stdio: ['pipe', 'pipe', 'pipe'], env: ENV_PY });
    const h = new Hote(proc);
    process.once('exit', () => { try { proc.kill('SIGKILL'); } catch { /* deja arrete */ } });   // jamais de processus orphelin
    const pret = await h._lire();
    if (!pret.ok) throw new Error('hote GL : ' + pret.erreur);
    return h;
  }

  // Reponse = une ligne JSON ; si `octets` est present, autant d'octets bruts suivent.
  _vider() {
    if (this.morceaux.length) { this.tampon = Buffer.concat([this.tampon, ...this.morceaux]); this.morceaux = []; this.total = this.tampon.length; }
    while (this.attentes.length) {
      const i = this.tampon.indexOf(10);
      if (i < 0) { this.besoin = 0; return; }
      const rep = JSON.parse(this.tampon.subarray(0, i).toString('utf8'));
      const n = rep.octets || 0;
      if (this.tampon.length < i + 1 + n) { this.besoin = i + 1 + n; return; }   // on attend tout le corps avant de recoller (une seule copie)
      if (rep.ts) rep.transfert_ms = Date.now() - rep.ts;
      rep.donnees = n ? this.tampon.subarray(i + 1, i + 1 + n) : null;     // pas de copie : le tampon n'est jamais modifie ensuite
      if (n && rep.masque) { rep.force = rep.donnees.subarray(n - rep.masque); rep.donnees = rep.donnees.subarray(0, n - rep.masque); }
      this.tampon = this.tampon.subarray(i + 1 + n);
      this.besoin = 0;
      this.attentes.shift().resoudre(rep);
    }
  }

  _lire() { return new Promise((resoudre, rejeter) => { if (this.fini) return rejeter(new Error("l'hote GL est arrete")); this.attentes.push({ resoudre, rejeter }); this._vider(); }); }

  async commande(obj) {
    const p = this._lire();
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
    const rep = await p;
    if (!rep.ok) throw new Error(rep.erreur || 'erreur de l\'hote GL');
    return rep;
  }

  init({ pack, largeur, hauteur, maillage, dimension = 'world0', options, reglages }) { return this.commande({ cmd: 'init', pack, largeur, hauteur, maillage, dimension, options, reglages }); }
  // etat : voir src/pack/etat.js ; images : nombre d'images calculees (les precedentes servent d'historique au pack) ; retourne { donnees: Buffer RGBA, temps, ... }
  texture(id, w, h, rgbaBase64) { return this.commande({ cmd: 'texture', id, w, h, rgba: rgbaBase64 }); }
  masque(id, w, h, octetsBase64) { return this.commande({ cmd: 'masque', id, w, h, octets: octetsBase64 }); }
  rendre(etat, images = 1) { return this.commande({ cmd: 'rendre', etat, images }); }
  async fermer() { try { await this.commande({ cmd: 'fin' }); } catch { /* deja arrete */ } this.proc.stdin.end(); }
}
