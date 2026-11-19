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
- `options` : `rayonMelange` (flou des teintes de biome, defaut 2), `aoActif` (defaut vrai), `gamma` (reglage de luminosite du jeu, 0,5 par defaut ; 0 = courbe pure), `distInterne` (voir « Feuilles » plus bas ; defaut 32 blocs).
- `scene.temps` : `{ lectureMs, maillageMs, totalMs }`. `scene.maillage.stats` : nombre de quads. `scene.modeles.manquants` : etats sans modele/texture (Map etat -> raison) ; `scene.modeles.speciaux` : coffres, lits... dessines par du code dans le jeu (boite de remplacement ou rien) ; `scene.textures.manquantes`.

### `await scene.rendre({ camera, largeur, hauteur, temps, maillagesDynamiques, ssaa, mip, brume, ciel, soleil, lumiere, image, copie }) -> Uint8Array`
- `temps` : secondes ; choisit l'image des textures animees (eau, lave...), 20 ticks par seconde, sans interpolation.
- `ssaa` : 1 (defaut) ou 2 = rendu en 2x2 puis reduction (coute environ 3 fois plus). `mip: false` supprime les petits niveaux de texture (plus lent et plus de scintillement a distance).
- `brume: { debut, fin, couleur:[r,g,b] }` : brouillard de distance (voir « Brouillard et bord de zone » plus bas). `ciel: { zenith, horizon, bas }` couleurs [r,g,b] 0..255. `soleil: [dx,dy,dz]` direction du soleil, ou `false`.
- `lumiere: [r,g,b]` : facteur de lumiere GLOBAL par canal (1,1,1 = inchange, c'est le defaut). Il multiplie la couleur de chaque sommet au dessin (terrain ET maillages dynamiques) : le maillage n'est pas refait. Au-dessus de 1, la couleur est ecretee a 255. Ne touche pas le ciel.
- `brume: { debut, fin, couleur }` : chaque champ est facultatif ; `fin` vaut au moins `debut + 8`.
- `image: { saturation, contraste, luminosite, teinte:[r,g,b], vignette, flou, fondu:[a,r,g,b] }` : post-traitement applique a l'image finale (voir « Post-traitement » plus bas). Tout est facultatif ; neutre = rien, cout nul.
- Sous l'eau (camera dans une cellule d'eau) : brouillard bleu court automatique.
- Fluides (eau, lave, eau enchainee des dalles et escaliers, herbes marines, varech) comme `FluidRenderer` du jeu : le dessus d'une cellule est a `quantite / 9` (une source 8/9, un niveau n : (8 - n) / 9, plein si le meme fluide est au-dessus ; l'eau qui tombe sans eau au-dessus : 8/9) ; les 4 coins sont la moyenne ponderee de la cellule, des 2 voisins de l'arete et de la diagonale (poids 10 si la hauteur est >= 0,8, 1 sinon, un bloc plein ne compte pas), donc deux cellules voisines partagent la hauteur de leur coin et le dessus penche ; la texture est `water_flow` (ou `lava_flow`), tournee dans le sens du courant (`FlowingFluid.getFlow`), quand il y a un courant, `water_still` sinon ; les cotes (`flow`, v = (1 - hauteur) / 2) n'existent que contre l'air ou un bloc non opaque ; pas de face entre deux cellules du meme fluide ; le bas est cache par un sol opaque. Une source isolee entouree d'air a donc ses coins abaisses (0,74), comme dans le jeu. Tests : `test/fluides-rendu.test.js`. Cause du defaut vu sur le puits du village : l'ancien code donnait la hauteur pleine a toute eau tombante (niveau 8) et une hauteur uniforme a chaque cellule (14/16 pour une source), sans moyenne des coins.
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
  // couleur selective (facultatif, voir plus bas) :
  masque: { largeur, hauteur, valeurs: Uint8Array },  // un octet (0..255) par texel de `texture`, meme taille qu'elle ; la force d'exemption
  forceMasque: 1,            // 0..1, multiplie la force du masque (defaut 1)
  lueur: 0,                  // 0..1 : part "lumineuse" des texels du masque (non assombris par les couleurs de sommet) (defaut 0)
  exempt: false,             // true : tous les pixels du maillage sont exemptes (force 255), sans masque
  additif: false,            // true (avec mode 'melange') : destination + couleur x alpha, sans brume, sans lumiere globale ni ecriture de profondeur (foudre)
}
```
- Meme nombre de sommets partout : `positions.length/3 === uvs.length/2 === couleurs.length/3`.
- `opaque` : alpha de la texture ignore. `decoupe` : pixel jete si alpha < 96/255 (cheveux, plumes). `melange` : melange avec ce qui est derriere selon l'alpha de la texture (vitre, eau) ; dessine apres l'opaque, trie de l'arriere vers l'avant par maillage (pas par triangle).
- Pas d'eclairage applique aux maillages dynamiques : c'est a l'appelant de multiplier `couleurs` par un ombrage de face (haut 1,0 ; bas 0,5 ; nord/sud 0,8 ; ouest/est 0,6) et par `scene.luminositeEn(x,y,z)` (0..1, lumiere du ciel de la zone a cet endroit, plus sombre sous les arbres). Le brouillard de distance est applique.
- Cache des textures : une texture est envoyee aux workers la premiere fois qu'on voit son tableau `rgba` (identite de l'objet). Pour changer les pixels, donner un NOUVEAU tableau.
- Cout : les tableaux sont copies a chaque image ; viser quelques dizaines de milliers de triangles par image.
- Test z : les maillages dynamiques se cachent correctement avec le terrain.
- Creatures (`src/creatures/rendu.js`) : un maillage par couche du modele (corps, laine, selle, yeux...), `deuxFaces: true` (rendu `entityCutoutNoCull` du jeu) sauf les couches translucides ; champs en plus `genre: 'creature'`, `entite: 'minecraft:<type>'` (entityId du vrai pack de shaders, `src/pack/film.js`) ; yeux et aura : `mode: 'melange'`, `additif: true`, `emissif: true`, couleurs a 1 (pleine lumiere). Les couleurs portent la teinte de la couche (laine, collier) : le chemin GPU les envoie (`col`).

### Couleur selective et post-traitement `image`
- But : un film peut griser (ou teinter) toute l'image tout en gardant la couleur de certains pixels (cheveux, yeux...).
- Le rasteriseur ecrit pour chaque pixel dessine par un maillage `opaque` ou `decoupe` une **force d'exemption** (Uint8, 0..255) dans un tampon `W x H` partage entre workers (une SharedArrayBuffer ; chaque worker n'ecrit que ses rangees ; efface a 0 au debut de chaque image). Le terrain l'ecrit a 0 (un bloc devant un personnage l'efface). Un maillage `melange` ne l'ecrit pas.
- Force d'un pixel = `max(exempt ? 255 : 0, texel_du_masque x forceMasque)`. Lueur : la couleur de sommet (ombrage x lumiere) est poussee vers 1 dans la proportion `texel x lueur / 255` ; le pixel n'est donc pas assombri (les yeux brillent a l'ombre). Le brouillard de distance s'applique encore.
- Le tampon n'est alloue et rempli que si `image` est active ET qu'un maillage porte `masque` ou `exempt` : sinon aucun cout supplementaire (un test par pixel dans le dessin du terrain, mesure sans effet visible sur le temps de rendu).
- Avec `ssaa: 2`, la force est reduite (moyenne) comme les couleurs, puis le post-traitement s'applique a l'image reduite.
- Les masques sont envoyes aux workers comme les textures : la premiere fois qu'on voit le tableau `valeurs` (identite de l'objet). Un nouveau masque = un NOUVEAU tableau.

**Post-traitement** (`post.js`), ordre fixe : 1. flou en boite (rayon 0..32 px, deux passes, bords repetes) ; 2. saturation (0..2 ; gris = 0,30 R + 0,59 V + 0,11 B) ; 3. teinte (x r,g,b, 0..2) ; 4. contraste (0..3, autour de 127,5) ; 5. luminosite (x l, 0..3) ; [les pixels exemptes retrouvent leur couleur d'avant l'etalonnage 2 a 5, melangee selon la force] ; 6. vignette (0..1) ; 7. fondu (vers la couleur r,g,b a la part a). Calcul entier + tables, sans allocation par pixel. Le flou travaille sur l'image entiere dans le thread principal ; tout le reste se fait par bandes de 16 rangees, dans les workers (chacun les siennes) quand `ssaa` vaut 1 et qu'il n'y a pas de flou, sinon dans le thread principal. Mesure (1920x1080, 1 thread) : saturation 14 ms, vignette ou fondu 8 ms, flou 35 ms.

### Aides pour l'IA et les collisions
- `scene.resumeTerrain({ pas }) -> objet JSON` (moins de 1,8 Ko : 0,9 Ko mesure pour des zones de rayon 48, 96 et 128 ; la grille est retiree si le texte depasse 1,8 Ko) : `zone` (bornes, biomes), `sol` (`min`, `max`, `mediane` : Y du dessus du sol), `eau` (3 plus grandes etendues : boite x/z, niveau y), `nbArbres`, `chemins` (3-4 couloirs droits praticables pour un acteur ET une camera de suivi : `{de:[x,z], a:[x,z], longueur, denivele, degagement}`, entiers, meilleur d'abord ; cherches seulement dans les 56 blocs autour du CENTRE de la zone, la ou la brume ne cache pas encore le paysage : toute la zone si le rayon est <= 56 ; `degagement` = % du trajet ou la camera, 4 blocs derriere / 2 au-dessus, a la place et voit la tete), `clairieres` (1-2 endroits ouverts : `{centre:[x,z], rayon}`), `grille` (sol grossier ; retiree si le texte depasse 1,8 Ko).
- `scene.evaluerSegment(x1,z1,x2,z2) -> { ok, longueur, denivele, degagement (0..1), obstacle?: {distance,x,z,quoi} }` et `scene.verifierChemin(x1,z1,x2,z2) -> phrase` : un segment est libre si, a hauteur du corps (0..2), aucune colonne a +-1 bloc de l'axe n'a de bloc a collision, de feuillage ou d'eau, et sans marche de plus de 1 bloc (`mcanim terrain <zone> --chemin x1,z1,x2,z2`). Algorithme dans `chemins.js` (deterministe, environ 0,2 s pour 96 x 96).
- `scene.solEn(x, z) -> Y | null` : Y du DESSUS du plus haut bloc a collision de la colonne, sans compter feuilles, eau, plantes, neige fine, tapis (on marche sous les arbres). `null` hors zone. Un personnage debout a `solEn(x,z)` aux pieds ; les yeux sont a +1,62.
- `scene.estSolidePourCamera(x, y, z) -> bool` : le point est-il dans un bloc VRAIMENT plein et opaque (pierre, terre, tronc) ? Seul cela bloque la camera de film (`film/camera.js`) ; feuilles, plantes, herbe, fleurs, lianes, eau, dalles et clotures ne comptent pas. `scene.classeBloc(x,y,z)` -> `'tronc' | 'feuillage' | 'bloc' | null`.
- `scene.eauEn(x, z) -> Y | null` : surface de l'eau au-dessus du sol (14/16 du bloc), sinon `null`.
- `scene.estLibre(x, y, z) -> bool` : le point est-il dans une cellule sans bloc a collision, sans feuilles et non cachee (pour la camera et les personnages). L'eau est "libre". Hors zone : libre seulement au-dessus de la surface.
- `scene.distanceLibre(x,y,z,dx,dy,dz,max)` : distance avant le premier obstacle (pas de 0,5). `scene.vueParDefaut()` : point de vue au sol qui regarde vers les arbres. `scene.niveauLumiere(x,y,z)` 0..15, `scene.luminositeEn(x,y,z)` 0..1, `scene.estDansEau(x,y,z)`.
- Aucune aide ajoutee pour la physique des acteurs (`film/physique.js`) : elle lit `scene.zone.bloc(x,y,z)` (dalles, escaliers, echelles, lianes), `solEn` et `eauEn` ; la hauteur fine d'une dalle ou d'un escalier est calculee dans `film/physique.js` (`hauteurDuBloc`).
- Limites : les hauteurs de `solEn` sont des hauteurs de blocs entiers (une dalle ou un escalier compte comme un bloc plein pour `solEn`).

## Fichiers
| Fichier | Role |
|---|---|
| `png.js` | lecture/ecriture PNG a la main (tous types de couleur, 1 a 16 bits, palette, tRNS, Adam7) |
| `zone.js` | lecture/ecriture `.mcz`, `bloc(x,y,z)`, `hauteur(x,z)`, `biome(x,z)` en coordonnees monde |
| `modeles.js` | etat de bloc -> quads : blockstates (variants, aleatoire pondere, multipart `when`/`OR`/`AND`), modeles (parents, `#variables`, UV, rotations, `uvlock`, `cullface`, `tintindex`) |
| `textures.js` | textures du kit, couches (opaque / decoupe / melange), animations `.mcmeta`, atlas a 4 niveaux de mip |
| `teinte.js` | couleurs de biome (herbe, feuillage, feuillage sec, eau) |
| `maillage.js` | mailleur : culling (seul un cube opaque cache une face ; feuilles : faces internes en couche a part), lumiere du ciel, AO, teintes, eau/lave |
| `raster.js` | rasteriseur (coeur, utilise par les workers et en direct ; lumiere globale, force d'exemption) |
| `post.js` | post-traitement de l'image finale (`image`) |
| `travailleur.js` | worker de rendu |
| `chemins.js` | couloirs praticables, clairieres, eau, verification d'un segment (pour `resumeTerrain`) |
| `ciel-vanille.js` | ciel du jeu : états, étoiles, nuages |
| `../shader/` | format `shader.json` (`format.js`), moteur par image (`moteur.js`), ombres cuites (`ombres.js`), passes d'image (`post.js`), lumière (`ciel.js`) |
| `scene.js` | l'API ci-dessus |

## Ciel du jeu et shader (toujours dans le rendu de base)
- `ciel-vanille.js` : ciel de Minecraft 26.3 (couleurs par heure et biome, lueur du lever/coucher, soleil et lune texturés, étoiles, nuages épais). Paramètres de `rendre` : `heure` (0..24, défaut 12), `jour` (phase de la lune), `cielFixe` ; un `ciel: {zenith, horizon, bas}` explicite désactive tout cela (ciel uni, comme `couleurCiel`). Les nuages sont un maillage « melange » (`nuage: true`) avec leur propre brume (220 à 576 blocs) et sans la lumière du terrain ; ils ne comptent pas dans la brume automatique des acteurs. Sans les textures du kit (groupe `environnement`), seuls les couleurs et les étoiles sont dessinés.
- `scene.definirShader(lireShader(json))` (voir `src/shader/` et `docs/FORMAT-SHADER.md`) : ombres cuites (un octet par sommet, tableau partagé `ombre` de chaque dessin), lumière du monde, brume (courbe, brume basse), balancement des feuilles et des plantes (par sommet, position monde : pas de fissure), eau (teinte, opacité, reflet du ciel et ondulations par pixel), modifications du ciel du jeu, puis passes d'image : réduction par les workers, flou de la lueur (principal) en même temps que les rayons (workers), composition par bandes (exposition, courbe, étalonnage, vignette), PUIS l'étalonnage `image` de la scène. Un fichier vide ou à options neutres donne exactement la même image que sans fichier. `scene.moteur.stats` : cuisson des ombres.
- Étiquettes de sommet (`etiq`, genre eau/feuilles/plante + poids du pied) et occlusion (`ao`) sont cuites par le mailleur ; sans shader elles ne servent pas.

## Brouillard et bord de zone
- Par defaut le brouillard est AUTOMATIQUE, recalcule a chaque image : `fin` = distance horizontale de la camera au bord de zone le plus proche moins 4 blocs (jamais moins de 32) ; `debut` = 60 % de `fin`, repousse (jusqu'a 85 % de `fin`) pour ne jamais avaler un maillage dynamique, donc l'acteur suivi (`debut` >= sa plus grande distance horizontale + 3). Un `brume.debut` / `brume.fin` explicite l'emporte. Exemple : camera au centre d'une zone de rayon 128 : brume de 60 a 100 blocs.
- La distance est HORIZONTALE (cylindre autour de la camera, comme le jeu), pas la profondeur d'ecran : un bord de zone a 100 blocs est totalement dans la brume sur toute la largeur de l'image, aux coins aussi.
- Couleur : par defaut (ou si `brume.couleur` = `ciel.horizon`) la brume prend, RANGEE PAR RANGEE, la couleur du ciel derriere elle (`ciel` personnalise et `image` compris : l'etalonnage s'applique ensuite aux deux). La brume epaisse est donc invisible sur le ciel, au niveau de l'horizon comme sous l'horizon ; une camera haute voit le terrain se fondre dans le ciel sans bord net. Une `brume.couleur` differente est utilisee telle quelle.
- Distance : les sections de maillage et les triangles entierement au-dela de `fin` (+ 1 bloc) ne sont pas dessines (le ciel les remplace : c'est la meme couleur). Le niveau de mip (par triangle) reste celui de la texture : mesure, avancer d'un demi-niveau ne change pas le temps de rendu ; a 100 blocs on n'utilise que les niveaux 0 et 1.
- Ce qui reste : camera a moins de ~36 blocs d'un bord (zone petite, acteur au bord) : `fin` ne descend pas sous 32 et le bord peut se voir ; une camera tres haute dont l'image ne contient que le sol voit un disque de brume plutot que la zone entiere ; une rangee de pixels couvre plusieurs blocs a l'horizon, donc un tres leger palier (quelques % du contraste terrain/ciel) reste visible a hauteur d'yeux.

## Feuilles (graphismes « fancy » du jeu)
- Seul un cube OPAQUE cache une face. Les feuilles (`*_leaves`, azalee comprise) emettent leurs 6 faces meme contre une autre feuille : par les trous de la texture on voit les feuilles de derriere, pas le ciel. Seules les surfaces translucides identiques (verre, glace, slime, miel) s'effacent entre elles.
- Les faces entre deux feuilles (« internes ») vont dans un 4e tampon (`couches.interne`), dessine APRES les faces exposees : le test de profondeur en rejette presque tout. Elles ne sont dessinees que jusqu'a `distInterne` blocs (horizontaux, defaut 32) de la camera ; au-dela on ne voit que les faces exposees (difference mesuree : 1 a 2 niveaux de couleur en moyenne sur l'image, aux silhouettes lointaines seulement).
- Faces arriere : le jeu dessine chaque face d'un seul cote (vers l'exterieur) ; avec les 6 faces de chaque bloc cela suffit, l'elimination des faces arriere est conservee.
- Lumiere et AO : la face interne prend la lumiere de la cellule voisine (attenuee de 1 par feuille) et l'AO du jeu (une feuille compte comme un cube plein) : l'interieur du feuillage est sombre, comme dans le jeu.
- Cout (foret, zone de rayon 128, 1920x1080, un thread, camera de la scene d'essai) : avant ce changement 155 ms et 580 000 triangles traites par image (292 000 dessines) ; maintenant 167 ms (+7 %) et 320 000 traites (141 000 dessines) avec `distInterne` = 32 ; 190 ms (+21 %) avec toutes les faces internes (`distInterne: Infinity`). Le brouillard qui coupe le lointain paie une partie de ce cout. Le maillage compte 1,36 fois plus de quads (1 030 000 au lieu de 756 000 pour R = 128) ; rendu de 10 s dans le banc (2 coeurs) : 46,9 s avant, 48,6 s apres.

## Maillage par sections et lumiere de blocs (scenes avec un champ `monde`)

Sans `monde`, rien ne change : un seul maillage de toute la zone, une seule fois (images identiques au bit pres : `scripts/hachage-images.js`).
Avec `monde` (`chargerScene({ options: { monde: { donnees, replay, lumiere } } })`) :
- Le mailleur lit les tableaux d'un **Monde** modifiable (`src/moteur/monde.js` : blocs, lumiere du ciel, lumiere de blocs, memes indices "rembourres" que `mailler`). Le maillage de depart est le meme ; en plus, `maillage.mailleSection(a, b, c)` refait UNE section de 16x16x16 (numeros absolus depuis l'origine de la zone ; `maillage.cleAbs` donne la cle d'une section).
- Le rendu rejoue le replay de la simulation : `await scene.appliquerReplay(tick)` ecrit les changements dans le monde (la lumiere suit : `src/moteur/lumiere.js`), puis refait **seulement** les sections dont une cellule a change a moins d'une cellule (blocs : faces, AO ; lumiere : sommets). Une scene sans changement ne paie rien. Les images vont dans l'ordre du temps (le monde ne revient pas en arriere).
- Les sections refaites sont des **pieces rapportees** : la section du maillage de depart est marquee morte (sa plage n'est plus dessinee : `cle` dans `sections`), la piece neuve est un dessin statique de plus, envoye UNE fois aux workers (message `maj`, memoire partagee : pas de copie par image). `scene.statsMaj` = `{ sections, ms, quads, lots, maxMs }` (cout mesure : 2 a 5 ms par section). Si la boite grandit (bloc pose hors de la zone), tout est refait (`rebatir`, rare).
- **Lumiere** (`options.monde.lumiere !== false`) : le sommet ne porte plus la lumiere cuite mais ses niveaux (ciel, bloc : `niv`, deux octets par sommet) ; le rasteriseur multiplie la couleur par la table de lumiere du jeu (`tableLumiere(ticks, gamma)` de `ciel-vanille.js` : `lightmap.fsh`, lumiere chaude `#ffd88c`), interpolee entre les cases, avec l'heure du jeu de l'image. Le facteur global jour/nuit n'est plus applique (il est dans la table). `scene.luminositeEn` (acteurs) rend la luminance de la table au niveau (ciel, bloc) du point ; `scene.niveauBloc(x,y,z)` le niveau de lumiere de bloc.
- **Ombres du soleil (shader.json)** : une piece neuve est cuite tout de suite ; les sections que le soleil relie a une cellule changee sont recuites (`moteur.cuireChangements`), pas toute la zone.
- **Export GPU (vrai pack de shaders)** : `exporterZone` ecrit la vraie lumiere de bloc par sommet (coordonnee lumiere du jeu, 0 a 240) ; `scene.prendreMajGPU()` + `exporterMaj(scene, dossier, maj)` (`pack/export-gpu.js`) ecrivent les sections refaites entre deux images, `Hote.majMaillage(dossier)` les envoie a l'hote OpenGL (commande `maillage-maj`) qui ne dessine plus les sections mortes et ajoute les pieces. Cout mesure cote Node : voir `docs/SIMULATION.md` (partie 8).

## Grandes zones : maillage paresseux

Au-dela de 257 x 257 colonnes (zones de rayon > 128 ; defaut du site : rayon 256, maximum 512), `chargerScene` ne maille rien (`scene.paresseux`, forcable avec `options.paresseux`). A chaque image, `rendre` appelle `scene.assurerVue(camera, loin)` : les colonnes de 16 x 16 (toute la hauteur) a moins de `loin` (fin de la brume + 1, distance horizontale) sont maillees (`maillage.mailleColonne(a, c)`), envoyees aux workers comme des pieces (message `maj`), et celles a plus de `loin + 64` sont oubliees. Memes quads et memes sections que le maillage complet : meme image (test `grandes-zones.test.js`). Avec `monde`, une colonne deja maillee dont une cellule change est refaite entiere. Vrai pack de shaders : les colonnes partent vers l'hote par `exporterMaj` a chaque image. `scene.statsParesseux` = `{ colonnes, quads, ms }`. Les commandes sans image (`terrain`, `trajet`, `empreinte`) ne maillent rien. Mesures : `docs/CONCEPTION.md` partie 2.2.

## Comment ca marche (pour les curieux)
- Le maillage est divise en sections de 16x16x16 blocs, par couche (opaque, decoupe, melange), dans des `SharedArrayBuffer` partages avec les workers.
- Chaque worker dessine des bandes de 16 rangees (rangees paires pour l'un, impaires pour l'autre) dans le meme tampon d'image : pas de copie ni de recollage.
- Par image : elimination des sections hors champ (cone de vision + distance horizontale > fin de brume), tri des sections (opaque et decoupe de l'avant vers l'arriere, melange de l'arriere vers l'avant), elimination des faces arriere dans l'espace monde, transformation paresseuse des sommets, decoupe au plan proche, remplissage par rangees avec profondeur 1/w (Float32) et UV corrects en perspective, texture "plus proche", niveau de mip choisi par triangle.
- Les textures animees sont reecrites dans l'atlas partage avant chaque image (quelques sprites de 16x16).

## Defauts connus
- Sans champ `monde` : pas de lumiere de blocs (blocs emissifs traites comme pleine lumiere) ; ombres portees seulement avec un shader ; la nuit est un facteur global (`lumiere`, voir `film/look.js`). Avec `monde` : lumiere de blocs et table de lumiere du jeu (voir plus haut).
- Eau : plan plat a 14/16, pas de lissage des coins, pas de courant, tri des surfaces translucides par section seulement.
- Les blocs dessines par code dans le jeu (coffres, lits, panneaux, banniere, tetes) sont une boite de remplacement ou absents.
- Aux bords de la zone le terrain s'arrete, mais le brouillard automatique le cache (voir « Brouillard et bord de zone ») sauf camera tres pres du bord.
- Les textures en moire sur les surfaces tres rasantes (herbe au loin) : choix d'un niveau de mip par triangle, pas par pixel ; `ssaa: 2` aide.
