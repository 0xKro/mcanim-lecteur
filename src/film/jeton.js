// Verification du jeton, sans internet (CONCEPTION.md, partie 5).
// Format : <charge>.<signature>, base64url. Signature Ed25519 sur les octets ASCII de la charge.
import crypto from 'node:crypto';
import { CLE_PUBLIQUE } from '../cle-publique.js';

export class ErreurJeton extends Error {
  constructor(message) { super(message); this.name = 'ErreurJeton'; }
}

// Cle publique brute (32 octets, base64url) -> objet cle de node:crypto.
function cleDepuisBrute(b64) {
  return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64 }, format: 'jwk' });
}

// jeton : texte. Controles sur la scene : { empreinte, duree, zone } ; zoneSha256 facultatif
// (SHA-256 base64url du fichier de zone) : a donner quand la zone est connue.
// `clePublique` : parametre INTERNE, pour les tests (cle jetable). La ligne de commande ne le donne jamais.
// Retourne la charge du jeton si tout est bon, sinon leve ErreurJeton (message court en francais).
export function verifierJeton(jeton, { empreinte, duree, zone, zoneSha256, maintenant = Date.now() }, { clePublique = CLE_PUBLIQUE } = {}) {
  const morceaux = String(jeton ?? '').trim().split('.');
  if (morceaux.length !== 2 || !morceaux[0] || !morceaux[1]) throw new ErreurJeton('jeton illisible (format attendu : charge.signature)');
  const [c, s] = morceaux;
  if (!/^[A-Za-z0-9_-]+$/.test(c) || !/^[A-Za-z0-9_-]+$/.test(s)) throw new ErreurJeton('jeton illisible (caracteres inattendus)');
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(c, 'ascii'), cleDepuisBrute(clePublique), Buffer.from(s, 'base64url')); } catch { ok = false; }
  if (!ok) throw new ErreurJeton('jeton refuse : signature fausse');
  let charge;
  try { charge = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')); } catch { throw new ErreurJeton('jeton illisible (charge)'); }
  if (!charge || charge.v !== 1) throw new ErreurJeton('jeton d\'une version inconnue');
  if (charge.e !== empreinte) throw new ErreurJeton('jeton refuse : la scene a change depuis l\'autorisation (empreinte differente)');
  if (!(Number.isFinite(charge.d) && charge.d >= duree)) throw new ErreurJeton(`jeton refuse : il autorise ${charge.d} s, la scene en dure ${duree}`);
  if (charge.z !== zone) throw new ErreurJeton('jeton refuse : il est pour une autre zone');
  if (!(Number.isFinite(charge.x) && charge.x * 1000 > maintenant)) throw new ErreurJeton('jeton expire : demandez-en un nouveau');
  if (zoneSha256 !== undefined && charge.zh !== zoneSha256) throw new ErreurJeton('jeton refuse : le fichier de zone ne correspond pas (empreinte differente)');
  return charge;
}
