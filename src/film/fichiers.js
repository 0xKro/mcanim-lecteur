import fs from 'node:fs';
import path from 'node:path';

// Controle vite (avant tout telechargement) que les fichiers cites par la scene existent : masque, textures, skins en fichier PNG.
// Les fichiers ne font PAS partie de l'empreinte de la scene. Leve une erreur qui donne le champ fautif.
export function verifierFichiers(scene, baseDir = process.cwd(), surcharges = {}) {
  const manque = (champ, f) => { throw new Error(`${champ} : fichier introuvable : ${f} (chemin relatif au fichier de scene)`); };
  const existe = (f) => fs.existsSync(path.resolve(baseDir, f));
  const local = (s) => typeof s === 'string' && (/\.png$/i.test(s) || /[\\/]/.test(s));
  scene.acteurs.forEach((a, i) => {
    if (a.masque && !existe(a.masque)) manque(`acteurs[${i}].masque`, a.masque);
    if (local(a.skin) && !surcharges[a.nom] && !existe(a.skin)) manque(`acteurs[${i}].skin`, a.skin);
    (a.skins?.cles ?? []).forEach((k, j) => { if (local(k.ref) && !existe(k.ref)) manque(`acteurs[${i}].skins[${j}][1]`, k.ref); });
  });
  if (scene.shader && !existe(scene.shader)) manque('shader', scene.shader);
  for (const [nom, f] of Object.entries(scene.textures ?? {})) if (!existe(f)) manque(`textures["${nom}"]`, f);
}
