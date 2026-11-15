// Empreinte d'une scene (CONCEPTION.md, partie 4) :
// JSON canonique (cles triees, sans espace, nombres comme JSON.stringify) -> SHA-256 -> base64url.
import crypto from 'node:crypto';

// Ecrit une valeur JSON sous forme canonique.
export function canonique(v) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('nombre non fini dans la scene');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return '[' + v.map(canonique).join(',') + ']';
  const cles = Object.keys(v).sort(); // ordre des unites UTF-16, comme le tri par defaut
  return '{' + cles.filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonique(v[k])).join(',') + '}';
}

// v : objet deja lu (JSON.parse). Retourne 43 caracteres base64url.
export function empreinte(v) {
  return crypto.createHash('sha256').update(canonique(v), 'utf8').digest('base64url');
}

// SHA-256 d'un fichier (octets), base64url. Sert pour la zone (champ zh du jeton).
export function sha256Base64url(octets) {
  return crypto.createHash('sha256').update(octets).digest('base64url');
}
