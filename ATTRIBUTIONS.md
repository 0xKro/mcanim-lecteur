# Attributions

Le rendu de terrain (`src/rendu/`) reprend des REGLES et des CONSTANTES du code de Horizon
(dossier de reference `_ref/horizon` du projet), sous licence MIT.
Aucun fichier de Horizon n'est copie : le code est reecrit en JavaScript. Ce qui est porte, et d'ou :

| Ce qui est porte | Fichier d'origine (Horizon) | Ou chez nous |
|---|---|---|
| Table des teintes par bloc (`BlockColors.createDefault`) : herbe, fougere, herbe haute, canne a sucre, feuilles, vigne, tapis de feuilles (feuillage sec), nenuphar `0x208030`, feuilles de bouleau `0x80A755` et d'epicea `0x619961`, tiges de melon/citrouille, fil de redstone | `crates/horizon-client-render/src/mesher.rs` (enum `Tint`, table des teintes, vers les lignes 877-905 et 1099-1130) | `src/rendu/teinte.js` (`sourcesTeinte`) |
| Lecture des colormaps (`GrassColor.get`, `FoliageColor.get`) : temperature et humidite bornees a 0..1, `x=(1-t)*255`, `y=(1-t*h)*255`, indice `y<<8|x` ; couleurs du biome qui remplacent la colormap ; valeurs par defaut ; modificateurs `dark_forest` et `swamp` ; couleur d'eau par defaut `0x3F76E4` | `crates/horizon-client-render/src/biome.rs` (`sample`, `BiomeInfo::from_json`) | `src/rendu/teinte.js` (`CouleursBiomes`) |
| Ombrage directionnel : haut 1,0 ; bas 0,5 ; nord/sud 0,8 ; ouest/est 0,6 | `crates/horizon-client-render/src/mesher/lighting.rs` (`cardinal`) | `src/rendu/maillage.js` (`OMBRE_DIR`) |
| Occlusion ambiante par sommet (2 cotes + diagonale + centre, moyenne a 4, diagonale ignoree si les deux cotes sont opaques) et luminosite lissee | `mesher/lighting.rs` (`ambient_occlusion`, port de `BlockModelLighter`) | `src/rendu/maillage.js` (`emettreQuad`) |
| "Shade brightness" d'un bloc : 0,2 pour une collision de cube plein (sauf verre et blocs transparents), 1,0 sinon | `mesher.rs` (champ `shade`) | `src/rendu/modeles.js` (`aoSolide`) |
| Courbe de luminosite `v/(4-3v)` et reglage de luminosite | `crates/horizon-client-render/src/screen_effects.rs`, `gfx.rs` (`update_lightmap`) | `src/rendu/maillage.js` (`courbeLumiere`) |
| Regles de propagation de la lumiere du ciel (perte de `max(1, opacite)` en entrant dans un bloc ; descente libre dans l'air ; maximum sur tous les chemins ; opacite 1 pour feuilles/eau/glace) | `crates/horizon-client-render/src/light.rs` | `src/rendu/maillage.js` (calcul de `lum`) |
| Classement des couches par alpha de texture (opaque / decoupe / translucide) | commentaire de `gfx/pack_atlas.rs` et `mesher` (`solid` / `translucent`) | `src/rendu/textures.js`, `modeles.js` |

Aussi inspire par le jeu (faits de jeu, pas du code de Horizon) : ordre des sommets et UV par defaut des faces de modeles,
rotation des blockstates (`x` puis `y`), `uvlock`, rotation d'element (`rescale`), decalage horizontal aleatoire des plantes (`Mth.getSeed`).

## Personnages (`src/perso/`, `src/film/`)

Aussi reecrit en JavaScript a partir de Horizon (MIT) ; voir `analyse/3-personnages.md` pour les fichiers d'origine :

| Ce qui est porte | Fichier d'origine (Horizon) | Ou chez nous |
|---|---|---|
| Modele du joueur : parties, pivots, boites, UV (wide et slim), gonflement des couches externes (chapeau 0,5 ; reste 0,25) | `crates/horizon-cosmetics/src/preview.rs` (`player_model`), `item.rs` (boites et UV) | `src/perso/modele.js` (`definirParties`, `facesBoite`) |
| Chaine de matrices du joueur : rotation `180 - lacet`, symetrie (-1,-1,1), echelle 0,9375, decalage -1,501 ; baisse de 0,125 bloc accroupi | `crates/horizon-client/src/mobs/render.rs` (`base_transform_at`, `posed`), `game/perspective.rs` | `src/perso/modele.js` (`versMonde`) |
| Pose accroupie (decalages de pivots 4,2 / 3,2 / 4 px), balancement des bras au repos (`bobModelPart`) | `crates/horizon-client/src/mobs/anim.rs` | `src/perso/modele.js` (`matricesParties`) |
| Conversion des skins 64x32 -> 64x64 (copies en miroir), alpha force, "astuce Notch" | `crates/horizon-client-render/src/skins.rs` (`process_legacy_skin`) | `src/perso/skin.js` (`convertirSkin`) |
| Retard du corps sur la direction de marche (0,3 par tick de 1/20 s) ; seuil de mouvement 0,05 bloc par tick | `crates/horizon-client/src/game/perspective.rs` (suivi du corps) | `src/film/anim.js` |
| Distance entre deux pas (0,6 par bloc parcouru, un pas a chaque entier) | regle du jeu (`Entity.move`), non copiee de Horizon | `src/film/sons.js` |

## Licence de Horizon (MIT), a conserver

```
MIT License

Copyright (c) 2026 Ludovic Marie and the Horizon contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Les fichiers du jeu (blockstates, modeles, textures, colormaps, biomes) ne sont jamais dans le depot : ils sont recuperes
par `ensureKit()` dans `.kit-cache/` (ignore par git). `npm run controle` verifie qu'aucun n'est dans le depot ni dans le paquet.

## Ciel du jeu (rendu/ciel-vanille.js) : portage depuis Horizon

Le ciel de base (couleurs, lueur du lever et du coucher, soleil et lune texturés, champ d'étoiles, nuages épais) reprend la LOGIQUE du client Horizon
(licence MIT, `crates/horizon-client-render` : `gfx/stars.rs`, `gfx/sunrise_fan.rs`, `terrain.wgsl` (section du ciel), `clouds.rs`, `fog.rs`,
`horizon-client/src/game/frame_geometry.rs`) et les VALEURS des données du jeu (timeline `day.json`, dimension `overworld`) : pistes de couleur,
de luminosité des étoiles, du rouge du lever et du coucher, courbe d'adoucissement des astres, hauteur et vitesse des nuages, graine 10842 et
1500 essais du champ d'étoiles (générateur `java.util.Random` réécrit). Le code est réécrit en JavaScript (pas de copie de fichier). Hypothèses là
où la référence est muette : distance de rendu 12 chunks, pas de pluie, éventail du coucher résolu par dichotomie sur le rayon, nuages jusqu'à 576 blocs.

Copyright (c) Horizon contributors. Licence MIT : voir le texte ci-dessus (même texte).

## Route B : rendu avec un vrai pack de shaders (src/pack/) : portage d'idees depuis Horizon

Le rendu "vrai pack" (`docs/SHADERS-REELS.md`) reprend la LOGIQUE du client Horizon (licence MIT, texte ci-dessus) pour la partie qui reproduit le comportement
d'Iris. Rien n'est copie : tout est réécrit en Python (`src/pack/hote/mcpack/`) et en JavaScript. Ce qui est porté, et d'où :

| Notre fichier | Idée reprise | Source Horizon |
|---|---|---|
| `mcpack/proprietes.py` | lecture des `.properties` : continuations `\`, `#if/#ifdef/#elif/#else/#endif/#define/#include` avec les options et macros du jeu | `horizon-shaders/src/properties.rs`, `condition.rs` |
| `mcpack/expr.py` | langage des uniforms personnalisés : opérateurs, `if` à branches multiples, `in`, `equals`, `smooth` (demi-vie en dixièmes de seconde), `vec2/3/4`, accès `matrice.colonne.ligne`, valeur 0 pour un nom inconnu, type final imposé | `horizon-shaders/src/custom.rs` |
| `mcpack/idmap.py` | `block.<id>=` : espace de noms par défaut `minecraft:`, filtres `:prop=v1,v2`, l'entrée la plus précise gagne puis la première du fichier, `entity.properties` : première ligne gagne | `horizon-shaders/src/block_ids.rs` |
| `mcpack/glsl.py` (`MACROS_JEU`) | la liste des `#define` que le jeu injecte (`MC_VERSION`, `MC_GL_VERSION`, `MC_RENDER_STAGE_*` numérotés dans l'ordre des étapes, `DH_BLOCK_*`...) | `horizon-shaders/src/macros.rs` |
| `mcpack/uniformes.py`, `mcpack/matrices.py` | positions du soleil et de la lune (`vue * Ry(-90) * Rz(inclinaison) * Rx(angle) * (0,100,0)`), `sunAngle` / `shadowAngle`, `shadowModelView` (`Rx(90) Rz(-angle) Rx(inclinaison)`), `shadowProjection` (ortho +-distance, plans -100,05 et 156) | `horizon-client-render/src/gfx/pack_uniforms.rs` |
| `mcpack/rendu.py` | règle de « bascule » des cibles `colortexN` (le passage lit la principale, écrit l'alternative, puis elles s'échangent) ; une texture perso posée sur un `colortexN` cesse de le remplacer quand un programme du même étage l'écrit | `horizon-client-render/src/gfx/pack_post.rs` (commentaires et tests sur `released`) |

Les packs de shaders (Bliss, Sildur's Vibrant...) ne sont jamais dans le dépôt ni dans le paquet : ce sont des ENTRÉES fournies par l'utilisateur, lues en mémoire.
`test/pack-mini/` est un pack minimal écrit par nous pour les tests.

Le rendu OpenGL logiciel utilise Mesa (MIT) déjà présent dans la session (`libEGL.so.1`, llvmpipe) ; rien n'est embarqué.

## Objets tenus et armure portee (`src/objets/`) : portage depuis Horizon (MIT) et donnees de modeles du jeu

Reecrit en JavaScript, rien n'est copie. Ce qui est porte, et d'ou (fichiers de `_ref/horizon/crates/`, lignes de la copie de reference) :

| Ce qui est porte | Fichier d'origine (Horizon) | Ou chez nous |
|---|---|---|
| Objet en main a la troisieme personne (`ItemInHandLayer`) : repere de la main (bras du modele ; bras fins : epaule decalee de 0,5 px vers l'exterieur, `PlayerModel.translateToHand`), puis `Rx(-90) * Ry(180) * T(+-1, 2, -10)/16` (x oppose a gauche ; bebe : 0, 1, -4,5, non repris) | `horizon-client/src/mobs/render.rs` : `hand_base` 2404-2475, `held_item_transform` 2577-2670, `part_matrix` 2326-2352 ; memes constantes pour les mains d'un porte-armure : `horizon-client/src/game/armor_stands.rs` 1962-2015 | `src/objets/placement.js` (`repereMain`, `matriceObjet`) ; le repere est celui du SEGMENT BAS du bras (coude) |
| Transformation d'affichage d'un modele (`ItemTransform.apply`) : translation, rotation en ordre XYZ de JOML (= Rx.Ry.Rz), echelle, centrage -0,5 ; main gauche : x, rotation y et z opposes | `horizon-assets/src/item_bake.rs` : `item_transform_matrix` 83-106 ; `horizon-assets/src/math.rs` : `quaternion_xyz` 309-323 | `src/objets/placement.js` (`matriceAffichage`) |
| Lecture de `display` : translation en 16emes bornee a +-5 blocs, echelle bornee a +-4, chaque contexte pris dans le premier modele de la chaine des parents qui le donne, main gauche reprise de la droite du meme modele quand elle manque | `horizon-assets/src/model.rs` : `ItemTransform::decode` 522-548, `ItemTransforms::decode` 549-565 ; `resolve.rs` 262-272 | `src/objets/modele-objet.js` (`afficheDe`) |
| Objets "plats" (`builtin/generated`) : face avant et face arriere, plus une petite face par arete entre un pixel opaque et un pixel transparent (alpha 0), epaisseur 1/16 centree sur z = 8/16, couches `layer0`... | `horizon-assets/src/item_bake.rs` : `extrude_layer` 223-300 | `src/objets/modele-objet.js` (`extruder`) |
| Armure : un emplacement par morceau, materiaux (`golden` = `gold`, `turtle` = `turtle_scute`), textures `entity/equipment/humanoid` (casque, plastron, bottes) et `humanoid_leggings` (jambieres), cuir teinte `0xA06540` sans teinture puis calque `leather_overlay` | `horizon-client/src/mobs/render.rs` : `humanoid_armor` 1007-1064, `humanoid_layer_folder` 996 | `src/objets/armure.js` (`nomMateriau`, `couchesTexture`) ; definitions lues dans `assets/minecraft/equipment/*.json` du kit |
| Valeurs de pose du bras pour tenir quelque chose (donnees seulement, citees dans la fiche `objets`) : objet 18 degres, pinceau 36, bouclier 54, arc 90, trident lance 180, longue-vue 110, cornet 85 | `horizon-client/src/mobs/anim.rs` : `pose_arm` 490-545 | `site/regles/objets.md` |

**Geometrie de l'armure : table propre a ce projet.** Les boites de la couche d'armure du joueur (`src/objets/armure.js`, `PIECES`) sont des NOMBRES relevees dans les donnees de modeles preparees du jeu (`entity-models.json` du client Horizon, entrees `minecraft:player#helmet`, `#chestplate`, `#leggings`, `#boots`, lecture seule ; le proprietaire a autorise l'usage de la geometrie du jeu) : casque = tete gonflee de 1,0 + chapeau de 1,5 ; plastron = tronc 1,0 et bras 1,0 ; jambieres = tronc 0,5 et jambes 0,4 ; bottes = jambes 0,9 ; decalages de texture (0,0) (32,0) (16,16) (40,16) (0,16) sur une image de 64x32 ; bras gauche et jambe gauche = le droit en miroir ; bras large meme avec un skin a bras fins (verifie dans `minecraft:player_slim#chestplate`). Rien d'autre de ces donnees n'est copie. Les textures, modeles et definitions d'objets et d'equipement du jeu ne sont PAS dans le depot : ils sont recuperes dans le cache du kit (groupes `objets` et `armures`, `src/kit.js`).
