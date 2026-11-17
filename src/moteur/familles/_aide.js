// Petits outils communs des familles de blocs (directions du jeu, textes d'etat). Aucune logique de bloc ici.
// Directions : mots francais de l'API du moteur (bas, haut, nord, sud, ouest, est) et mots du jeu dans les proprietes (north, ...).
export const JEU = { nord: 'north', sud: 'south', ouest: 'west', est: 'east', haut: 'up', bas: 'down' };
export const FR = { north: 'nord', south: 'sud', west: 'ouest', east: 'est', up: 'haut', down: 'bas' };
export const VEC = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
export const OPPOSE = { north: 'south', south: 'north', west: 'east', east: 'west', up: 'down', down: 'up' };
export const HORIZ = ['north', 'east', 'south', 'west'];                     // dans le sens des aiguilles d'une montre (vu d'en haut)
export const horaire = (d) => HORIZ[(HORIZ.indexOf(d) + 1) % 4];             // Direction.getClockWise
export const antihoraire = (d) => HORIZ[(HORIZ.indexOf(d) + 3) % 4];         // Direction.getCounterClockWise
export const axe = (d) => (d === 'up' || d === 'down' ? 'y' : d === 'north' || d === 'south' ? 'z' : 'x');
export const decale = ([x, y, z], d) => [x + VEC[d][0], y + VEC[d][1], z + VEC[d][2]];

// Direction horizontale d'un lacet (degres) : Direction.fromYRot = from2DDataValue(floor(yaw / 90 + 0.5) & 3), valeurs 2D : sud 0, ouest 1, nord 2, est 3
export function dirDeLacet(lacet) {
  const k = Math.floor(lacet / 90 + 0.5) & 3;
  return ['south', 'west', 'north', 'east'][k];
}
// Direction vers laquelle on regarde en haut/bas/horizontal (Direction.orderedByNearest) a partir d'un lacet et d'un tangage
export function dirRegard(lacet, tangage) {
  if (tangage < -45) return 'up';
  if (tangage > 45) return 'down';
  return dirDeLacet(lacet);
}

// 'minecraft:oak_door[...]' + modifications de proprietes -> texte d'etat
export function etatTexte(nom, props) {
  const n = nom.startsWith('minecraft:') ? nom : 'minecraft:' + nom;
  const cles = Object.keys(props);
  return cles.length ? `${n}[${cles.map((k) => `${k}=${props[k]}`).join(',')}]` : n;
}
export const avec = (b, modifs) => etatTexte(b.nom, { ...b.etat, ...modifs });
// 'minecraft:oak_door[half=lower]' -> { nom: 'minecraft:oak_door', etat: { half: 'lower' } }
export function parseEtat(txt) { const i = txt.indexOf('['); const o = { nom: i < 0 ? txt : txt.slice(0, i), etat: {} }; if (i >= 0) for (const kv of txt.slice(i + 1, -1).split(',')) { const [k, v] = kv.split('='); o.etat[k] = v; } return o; }
export const court = (nom) => nom.replace(/^minecraft:/, '');
export const estAir = (b) => /^minecraft:(cave_|void_)?air$/.test(b.nom);
