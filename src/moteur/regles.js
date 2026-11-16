// Niveau 1 de modification du jeu : les `regles` (tableaux de parametres). Chaque famille DECLARE ses parametres (nom, type, plage,
// defaut, une ligne d'explication) ; `mcanim regles --liste [famille]` imprime ces declarations (donc jamais de derive).
// Une scene surcharge des valeurs : monde.regles = { "torches": { "survie": false }, "mob.zombie": { "vie": 40 } }
// (la cle est la famille, la sous-cle le parametre : nom complet `famille.parametre`).
import { ErreurMonde } from './erreurs.js';
import { voulaisTu } from './util.js';

export class Regles {
  constructor() { this.decl = new Map(); this.val = new Map(); }

  // decl : { def, min?, max?, entier?, choix?: [..], doc }
  declarer(nom, decl) {
    if (!/^[a-z][A-Za-z0-9_.]*\.[A-Za-z][A-Za-z0-9_]*$/.test(nom)) throw new ErreurMonde(`regle "${nom}" : nom attendu de la forme famille.parametre`);
    if (decl.def === undefined) throw new ErreurMonde(`regle "${nom}" : valeur par defaut manquante`);
    const type = typeof decl.def === 'boolean' ? 'booleen' : typeof decl.def === 'number' ? (decl.entier ? 'entier' : 'nombre') : typeof decl.def === 'string' ? 'texte' : 'autre';
    const d = { nom, type, def: decl.def, min: decl.min, max: decl.max, choix: decl.choix, doc: decl.doc || '' };
    this.decl.set(nom, d);
    return d;
  }

  // Applique les surcharges d'une scene (objet { famille: { parametre: valeur } }). `chemin` : debut du chemin pour les messages.
  appliquer(obj, chemin = 'scene.monde.regles') {
    if (obj === undefined || obj === null) return;
    if (typeof obj !== 'object' || Array.isArray(obj)) throw new ErreurMonde(`${chemin} : un objet est attendu, par exemple {"monde": {"ticksAleatoires": 0}}`);
    for (const [famille, params] of Object.entries(obj)) {
      if (params === null || typeof params !== 'object' || Array.isArray(params)) throw new ErreurMonde(`${chemin}.${famille} : un objet de parametres est attendu, par exemple {"${famille}": {"parametre": 1}}`);
      for (const [p, v] of Object.entries(params)) {
        const nom = `${famille}.${p}`, ch = `${chemin}.${famille}.${p}`;
        const d = this.decl.get(nom);
        if (!d) {
          const memeFamille = [...this.decl.keys()].filter((k) => k.startsWith(famille + '.'));
          const sug = memeFamille.length ? voulaisTu(nom, memeFamille) : voulaisTu(nom, [...this.decl.keys()]);
          throw new ErreurMonde(`${ch} : regle inconnue${sug} (mcanim regles --liste${memeFamille.length ? ' ' + famille : ''})`);
        }
        this.val.set(nom, this._controler(d, v, ch));
      }
    }
  }

  _controler(d, v, ch) {
    if (d.type === 'booleen') { if (typeof v !== 'boolean') throw new ErreurMonde(`${ch} : true ou false attendu`); return v; }
    if (d.type === 'texte') {
      if (typeof v !== 'string') throw new ErreurMonde(`${ch} : texte attendu`);
      if (d.choix && !d.choix.includes(v)) throw new ErreurMonde(`${ch} : "${v}" non permis (${d.choix.join(', ')})`);
      return v;
    }
    if (d.type === 'entier' || d.type === 'nombre') {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new ErreurMonde(`${ch} : nombre attendu`);
      if (d.type === 'entier' && !Number.isInteger(v)) throw new ErreurMonde(`${ch} : entier attendu`);
      if ((d.min !== undefined && v < d.min) || (d.max !== undefined && v > d.max)) throw new ErreurMonde(`${ch} : ${v} hors plage (${d.min ?? '-'} a ${d.max ?? '-'})`);
      return v;
    }
    return v;
  }

  // valeur d'une regle ; `repli` si elle n'est pas declaree
  valeur(nom, repli) {
    if (this.val.has(nom)) return this.val.get(nom);
    const d = this.decl.get(nom);
    return d ? d.def : repli;
  }

  // lignes de `mcanim regles --liste [famille]` : "famille.nom = defaut   [plage]  explication"
  liste(famille) {
    const noms = [...this.decl.keys()].filter((n) => !famille || n === famille || n.startsWith(famille + '.')).sort();
    return noms.map((n) => {
      const d = this.decl.get(n);
      const plage = d.choix ? ` [${d.choix.join('|')}]` : d.min !== undefined || d.max !== undefined ? ` [${d.min ?? ''}..${d.max ?? ''}]` : '';
      return `${n} = ${JSON.stringify(d.def)}${plage}   ${d.doc}`;
    });
  }
  familles() { const f = new Map(); for (const n of this.decl.keys()) { const k = n.slice(0, n.lastIndexOf('.')); f.set(k, (f.get(k) || 0) + 1); } return [...f.entries()].sort(); }
}
