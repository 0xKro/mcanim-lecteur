# Rendu de terrain (CPU, sans carte graphique)

Dessine une zone `.mcz` (voir `zonegen/FORMAT.md`) en images fixes. Node >= 22, zero dependance, modules ES.
Le maillage est fait UNE fois au chargement ; ensuite chaque image coute environ 0,1 a 0,3 s en 1920x1080.

```js
import { ensureKit } from '../index.js';
import { chargerScene } from './scene.js';

const { dir } = await ensureKit({ cacheDir: '.kit-cache', route: 'github' });   // dir = .kit-cache/26.3
const scene = await chargerScene({ zonePath: 'zone.mcz', kitDir: dir });
const rgba = await scene.rendre({ camera: { x, y, z, lacet: 0, tangage: 10, fov: 70 }, largeur: 1920, hauteur: 1080, temps: 0 });
await scene.fermer();   // arrete les workers (sinon le programme ne se termine pas tout seul)
```

## Conventions (a connaitre pour le code des personnages)

- Coordonnees MONDE du jeu : x vers l'est, y vers le haut, z vers le sud. Un bloc `(x,y,z)` occupe `[x,x+1[ x [y,y+1[ x [z,z+1[`.
- Camera : `lacet` en degres, comme le jeu : 0 = regarde vers le sud (+z), 90 = ouest (-x), 180 = nord, -90 = est. `tangage` positif = regarde vers le bas. `fov` = champ vertical en degres (70 par defaut). Plan proche 0,05.
- Image sortie : `Uint8Array` RGBA de `largeur*hauteur*4` octets, ligne du haut d'abord, alpha toujours 255.

## API

### `chargerScene({ zonePath | zone, kitDir, travailleurs, options }) -> Promise<Scene>`
- `kitDir` : dossier retourne par `ensureKit()` (`.kit-cache/26.3`) ou racine du cache. Il faut les groupes `blockstates, models, textures, colormap, biomes` (tous par defaut).
- `travailleurs` : nombre de workers de rendu (defaut : coeurs, au plus 4 ; 2 sur la machine cible). `0` = tout dans le thread principal (resultat identique).
- `options` : `rayonMelange` (flou des teintes de biome, defaut 2), `aoActif` (defaut vrai), `gamma` (reglage de luminosite du jeu, 0,5 par defaut ; 0 = courbe pure).
- `scene.temps` : `{ lectureMs, maillageMs, totalMs }`. `scene.maillage.stats` : nombre de quads. `scene.modeles.manquants` : etats sans modele/texture (Map etat -> raison) ; `scene.modeles.speciaux` : coffres, lits... dessines par du code dans le jeu (boite de remplacement ou rien) ; `scene.textures.manquantes`.

### `await scene.rendre({ camera, largeur, hauteur, temps, maillagesDynamiques, ssaa, mip, brume, ciel, soleil, copie }) -> Uint8Array`
- `temps` : secondes ; choisit l'image des textures animees (eau, lave...), 20 ticks par seconde, sans interpolation.
- `ssaa` : 1 (defaut) ou 2 = rendu en 2x2 puis reduction (coute environ 3 fois plus). `mip: false` supprime les petits niveaux de texture (plus lent et plus de scintillement a distance).
- `brume: { debut, fin, couleur:[r,g,b] }` : brouillard de distance (defaut : de 55 % a 100 % de la distance de vue = 1,15 x demi-zone). `ciel: { zenith, horizon, bas }` couleurs [r,g,b] 0..255. `soleil: [dx,dy,dz]` direction du soleil, ou `false`.
- Sous l'eau (camera dans une cellule d'eau) : brouillard bleu court automatique.
- `copie: false` renvoie la memoire partagee interne (valable jusqu'au prochain `rendre`) : plus rapide si on encode tout de suite.
- Les images `rendre` ne doivent pas se chevaucher : attendre la fin de l'une avant la suivante.

### Maillages dynamiques (personnages, objets) : `maillagesDynamiques: [mesh]` ou `scene.ajouterMaillage(mesh) -> id` / `scene.retirerMaillage(id)`
```js
mesh = {
  positions: Float32Array,   // x,y,z par sommet, coordonnees MONDE
  uvs: Float32Array,         // u,v par sommet, 0..1 sur la texture ; v vers le BAS (v=0 = ligne du haut de l'image) ; clampe aux bords
  couleurs: Float32Array,    // r,g,b par sommet, 0..1 ; MULTIPLIE la texture (1,1,1 = inchange)
  indices: Uint32Array,      // triangles (3 indices) ; faces avant = sens anti-horaire vu de l'EXTERIEUR (regle de la main droite : la normale (b-a)x(c-a) sort du solide)
  texture: { largeur, hauteur, rgba: Uint8Array },  // RGBA 8 bits, ligne du haut d'abord, non pre-multiplie ; filtrage "plus proche"
  mode: 'opaque' | 'decoupe' | 'melange',
  deuxFaces: false,          // facultatif : true = dessine aussi les faces arriere (plans fins, capes)
}
```
- Meme nombre de sommets partout : `positions.length/3 === uvs.length/2 === couleurs.length/3`.
- `opaque` : alpha de la texture ignore. `decoupe` : pixel jete si alpha < 96/255 (cheveux, plumes). `melange` : melange avec ce qui est derriere selon l'alpha de la texture (vitre, eau) ; dessine apres l'opaque, trie de l'arriere vers l'avant par maillage (pas par triangle).
- Pas d'eclairage applique aux maillages dynamiques : c'est a l'appelant de multiplier `couleurs` par un ombrage de face (haut 1,0 ; bas 0,5 ; nord/sud 0,8 ; ouest/est 0,6) et par `scene.luminositeEn(x,y,z)` (0..1, lumiere du ciel de la zone a cet endroit, plus sombre sous les arbres). Le brouillard de distance est applique.
- Cache des textures : une texture est envoyee aux workers la premiere fois qu'on voit son tableau `rgba` (identite de l'objet). Pour changer les pixels, donner un NOUVEAU tableau.
- Cout : les tableaux sont copies a chaque image ; viser quelques dizaines de milliers de triangles par image.
- Test z : les maillages dynamiques se cachent correctement avec le terrain.

### Aides pour l'IA et les collisions
- `scene.resumeTerrain({ pas }) -> objet JSON` (moins de 1,8 Ko pour une zone de rayon 48) : `zone` (bornes, biomes), `sol` (`min`, `max`, `mediane` : Y du dessus du sol), `eau` (3 plus grandes etendues : boite x/z, niveau y), `nbArbres`, `chemins` (3-4 couloirs droits praticables pour un acteur ET une camera de suivi : `{de:[x,z], a:[x,z], longueur, denivele, degagement}`, entiers, meilleur d'abord ; `degagement` = % du trajet ou la camera, 4 blocs derriere / 2 au-dessus, a la place et voit la tete), `clairieres` (1-2 endroits ouverts : `{centre:[x,z], rayon}`), `grille` (sol grossier ; retiree si le texte depasse 1,8 Ko).
- `scene.evaluerSegment(x1,z1,x2,z2) -> { ok, longueur, denivele, degagement (0..1), obstacle?: {distance,x,z,quoi} }` et `scene.verifierChemin(x1,z1,x2,z2) -> phrase` : un segment est libre si, a hauteur du corps (0..2), aucune colonne a +-1 bloc de l'axe n'a de bloc a collision, de feuillage ou d'eau, et sans marche de plus de 1 bloc (`mcanim terrain <zone> --chemin x1,z1,x2,z2`). Algorithme dans `chemins.js` (deterministe, environ 0,2 s pour 96 x 96).
- `scene.solEn(x, z) -> Y | null` : Y du DESSUS du plus haut bloc a collision de la colonne, sans compter feuilles, eau, plantes, neige fine, tapis (on marche sous les arbres). `null` hors zone. Un personnage debout a `solEn(x,z)` aux pieds ; les yeux sont a +1,62.
- `scene.estSolidePourCamera(x, y, z) -> bool` : le point est-il dans un bloc VRAIMENT plein et opaque (pierre, terre, tronc) ? Seul cela bloque la camera de film (`film/camera.js`) ; feuilles, plantes, herbe, fleurs, lianes, eau, dalles et clotures ne comptent pas. `scene.classeBloc(x,y,z)` -> `'tronc' | 'feuillage' | 'bloc' | null`.
- `scene.eauEn(x, z) -> Y | null` : surface de l'eau au-dessus du sol (14/16 du bloc), sinon `null`.
- `scene.estLibre(x, y, z) -> bool` : le point est-il dans une cellule sans bloc a collision, sans feuilles et non cachee (pour la camera et les personnages). L'eau est "libre". Hors zone : libre seulement au-dessus de la surface.
- `scene.distanceLibre(x,y,z,dx,dy,dz,max)` : distance avant le premier obstacle (pas de 0,5). `scene.vueParDefaut()` : point de vue au sol qui regarde vers les arbres. `scene.niveauLumiere(x,y,z)` 0..15, `scene.luminositeEn(x,y,z)` 0..1, `scene.estDansEau(x,y,z)`.
- Limites : les hauteurs sont des hauteurs de blocs entiers (une dalle ou un escalier compte comme un bloc plein pour `solEn`).

## Fichiers
| Fichier | Role |
|---|---|
| `png.js` | lecture/ecriture PNG a la main (tous types de couleur, 1 a 16 bits, palette, tRNS, Adam7) |
| `zone.js` | lecture/ecriture `.mcz`, `bloc(x,y,z)`, `hauteur(x,z)`, `biome(x,z)` en coordonnees monde |
| `modeles.js` | etat de bloc -> quads : blockstates (variants, aleatoire pondere, multipart `when`/`OR`/`AND`), modeles (parents, `#variables`, UV, rotations, `uvlock`, `cullface`, `tintindex`) |
| `textures.js` | textures du kit, couches (opaque / decoupe / melange), animations `.mcmeta`, atlas a 4 niveaux de mip |
| `teinte.js` | couleurs de biome (herbe, feuillage, feuillage sec, eau) |
| `maillage.js` | mailleur : culling, lumiere du ciel, AO, teintes, eau/lave |
| `raster.js` | rasteriseur (coeur, utilise par les workers et en direct) |
| `travailleur.js` | worker de rendu |
| `chemins.js` | couloirs praticables, clairieres, eau, verification d'un segment (pour `resumeTerrain`) |
| `scene.js` | l'API ci-dessus |

## Comment ca marche (pour les curieux)
- Le maillage est divise en sections de 16x16x16 blocs, par couche (opaque, decoupe, melange), dans des `SharedArrayBuffer` partages avec les workers.
- Chaque worker dessine des bandes de 16 rangees (rangees paires pour l'un, impaires pour l'autre) dans le meme tampon d'image : pas de copie ni de recollage.
- Par image : elimination des sections hors champ (cone de vision + distance), tri des sections (opaque et decoupe de l'avant vers l'arriere, melange de l'arriere vers l'avant), elimination des faces arriere dans l'espace monde, transformation paresseuse des sommets, decoupe au plan proche, remplissage par rangees avec profondeur 1/w (Float32) et UV corrects en perspective, texture "plus proche", niveau de mip choisi par triangle.
- Les textures animees sont reecrites dans l'atlas partage avant chaque image (quelques sprites de 16x16).

## Defauts connus
- Pas de lumiere de blocs (sauf blocs emissifs traites comme pleine lumiere), pas de nuit, pas d'ombre portee, pas de nuages.
- Eau : plan plat a 14/16, pas de lissage des coins, pas de courant, tri des surfaces translucides par section seulement.
- Les blocs dessines par code dans le jeu (coffres, lits, panneaux, banniere, tetes) sont une boite de remplacement ou absents.
- Aux bords de la zone, le terrain s'arrete net : on voit le ciel en dessous de l'horizon (le brouillard le cache en partie).
- Les textures en moire sur les surfaces tres rasantes (herbe au loin) : choix d'un niveau de mip par triangle, pas par pixel ; `ssaa: 2` aide.
