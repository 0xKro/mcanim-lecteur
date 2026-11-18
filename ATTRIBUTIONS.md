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

## Moteur de simulation (`src/moteur/`, P0a et P0b)

Reecrit en JavaScript a partir de Horizon (MIT) : le code de Horizon n'est ni copie ni execute. Ce qui est porte (regles, ordres, formules) :

| Ce qui est porte | Fichier d'origine (Horizon) | Ou chez nous |
|---|---|---|
| `Level.setBlock` : drapeaux (`UPDATE_NEIGHBORS` 1, `UPDATE_CLIENTS` 2, `UPDATE_KNOWN_SHAPE` 16, `UPDATE_SUPPRESS_DROPS` 32, `UPDATE_SKIP_ON_PLACE` 512...), limite de profondeur 512 des mises a jour de forme, retrait puis pose puis voisins puis formes | `crates/horizon-world/src/level/update.rs` (`set_block_limit`, `chunk_set_block_state`), `level/mod.rs` (`flags`) | `src/moteur/simulation.js` (`_poserIndice`, `F`) |
| `CollectingNeighborUpdater` : pile de mises a jour, file "ajoutes" retournee, plafond de mises a jour enchainees, etape par etape (`Multi` : un voisin a la fois) | `level/update.rs` (`add_and_run`, `run_updates`, `Update::next`) | `src/moteur/simulation.js` (`_ajouter`, `_lancerMaj`, `_executerMaj`) |
| Ordres du jeu : `UPDATE_ORDER` (ouest, est, bas, haut, nord, sud) et `UPDATE_SHAPE_ORDER` (ouest, est, nord, sud, bas, haut) | `level/update.rs` (constantes) | `src/moteur/monde.js` (`ORDRE_VOISINS`, `ORDRE_FORMES`) |
| `updateOrDestroy`, `destroyBlock` (air ou eau selon `waterlogged`), `removeBlock` | `level/update.rs` | `src/moteur/simulation.js` (`_majOuDetruire`, `_casserLimite`) |
| Ticks planifies : un tick par (type de bloc, position), file par chunk, ordre (moment, priorite, ordre d'insertion), chunks departages par priorite puis ordre d'insertion, 65 536 par tick, tick planifie pendant l'execution reporte au tick suivant, tick ignore si le bloc a change | `crates/horizon-core/src/ticks/mod.rs` (`ScheduledTick`, `ChunkTicks`, `LevelTicks::begin_tick`), `level/tick.rs` | `src/moteur/ticks.js`, `simulation.js` (`_tick`) |
| Hasard du jeu : generateur a congruence 48 bits de `java.util.Random` (`LegacyRandom` : multiplicateur 0x5DEECE66D, `next_int_bound`, `next_double`...) | `crates/horizon-core/src/random.rs` | `src/moteur/aleatoire.js` |
| Ticks aleatoires : `Level.randValue` (x 3 + 1013904223), `getBlockRandomPos` (positions tirees par section), vitesse 3 par defaut | `level/ticks.rs` (`random_tick_value`), `level/tick.rs` (`tick_chunk_random`) | `src/moteur/aleatoire.js` (`TirageBlocs`), `simulation.js` (`_aleatoires`) |
| Chaine de classes de comportement (`DoorBlock > Block`), un gestionnaire qui ne rend rien passe la main a la classe suivante (`super`) | `level/classes.rs`, `level/shapes.rs` (en-tete), `level/tick.rs:25-120` | `src/moteur/registre.js` |
| Torches : `BaseTorchBlock.updateShape` / `canSurvive` (appui au centre de la face haute), `WallTorchBlock` (face pleine du mur) | `level/survive.rs`, `level/shapes.rs` | `src/moteur/familles/torches.js` |
| Herbe qui se propage (jouet, desactive par defaut) : `SpreadingSnowyBlock.randomTick` (4 essais, decalage `nextInt(3)-1, nextInt(5)-3, nextInt(3)-1`, lumiere 9) | `level/tick.rs` (herbe) | `src/moteur/familles/herbe.js` |
| Lumiere de blocs et du ciel : -1 par bloc (au moins), blocs opaques arretent la lumiere, faces pleines des demi-blocs (`shape_occlusion`), ciel a 15 qui descend sans perte, mise a jour incrementale par retrait puis ajout | `crates/horizon-client-render/src/light.rs` (`relight`, `relight_layer`, `LightChanges`) | `src/moteur/lumiere.js` |
| Table de lumiere du jeu (`lightmap.fsh`) : `v/(4-3v)`, `sky_light_factor` et `sky_light_color` (pistes de `day.json`), `ambient_light_color`, `block_light_tint` (#ffd88c : lumiere chaude), courbe parabolique du blanc, reglage `gamma` | `crates/horizon-client-render/src/gfx.rs` (`update_lightmap`), `environment_attributes.rs` (`visual/block_light_tint`) | `src/rendu/ciel-vanille.js` (`tableLumiere`) |
| Tables de donnees par etat (emission, opacite, drapeaux, durete, resistance, friction, sons, formes de collision, classes, etiquettes, feu) | dossier prepare du jeu sur le poste du proprietaire (`facts.json`, `gameplay-facts.json`, `block-behaviours.json`, `cached-collision.nbt`, `block-tags.json`) : lu seulement par `outils/extraire-donnees-jeu.mjs` | nos tables compactes (format a nous) : `relais/d/donnees-jeu-1.json.gz`, `src/moteur/donnees.js` |

Les **donnees** sont des nombres et des noms de blocs sortis du jeu du proprietaire par un outil de developpement ; le fichier produit n'a pas le format
des fichiers du jeu (le controle `npm run controle` le verifie). Il est telecharge a la demande (groupe `donnees-jeu`), jamais range dans le paquet npm.

### P1 : acteurs, collisions, blocs interactifs, minage, pose (`src/moteur/acteurs.js`, `collision.js`, `navigation.js`, `cassage.js`, `familles/`)

Reecrit en JavaScript a partir de Horizon (MIT) et du comportement connu du jeu ; rien n'est copie.

| Ce qui est porte | Fichier d'origine (Horizon, `_ref/horizon/crates/`) | Ou chez nous |
|---|---|---|
| `Entity.collide` / `collideBoundingBox` : Y d'abord, puis l'axe horizontal le plus court, marche de 0,6 (deux essais, le plus loin gagne), un tick de descente ; boites de collision par etat | `horizon-world/src/{entity_move,collision,block_collision_scan,block_collision}.rs` | `src/moteur/collision.js` (`deplacerBoite`, `boitesDans`, `solSous`) |
| Mouvement du joueur : acceleration (vitesse x 0,216 / friction^3 au sol, 0,02 en l'air, x 0,98 d'entree, accroupi x 0,3, course 0,13), friction du bloc x 0,91, gravite 0,08 puis 0,98, saut 0,42 (+0,2 en courant), arret au bord accroupi | `horizon-world/src/{living_air,living_motion,living_fluid}.rs` | `src/moteur/acteurs.js` (`physique`, `sansTomber`) |
| Portee d'interaction 4,5 ; balancement du bras (`LivingEntity.swing`, 6 ticks, relance a 3) ; marche des membres (`limbSwing`, `limbSwingAmount`) | `horizon-client/src/game/{hand,perspective}.rs`, `anim.rs` | `src/moteur/acteurs.js`, `src/film/acteurs-vivants.js` |
| Minage : progression = vitesse / durete / (30 ou 100), efficacite, hate, fatigue, eau, air ; regles de l'outil (`minecraft:tool.rules`, `correct_for_drops`) | `horizon-client/src/game/{block_breaking,hand}.rs`, `horizon-items` | `src/moteur/cassage.js` |
| Portes, trappes, portillons (`use_without_item`, `set_door_open`, `door_sound`, mise a jour de forme des moities, charniere, portillon retourne), boutons (`button_press`, `ticksToStayPressed`), leviers (`lever_pull`), plaques (`checkPressed`, 20 et 10 ticks), blocs musicaux (`note_play`), coffres et tonneaux (compteur de visiteurs), cloche (`isProperHit`) | `horizon-world/src/level/{interact,hooks,survive,redstone}.rs` | `src/moteur/familles/{portes,boutons,conteneurs}.js` |
| Etats de pose (`getStateForPlacement` : porte, trappe, portillon, escalier et sa forme, dalle double, coffre double, lit, bûche, clotures et vitres reliees, torche murale, bouton) | `horizon-world/src/level/{place,orientation}.rs` | `src/moteur/familles/pose.js` |
| Couvercle de coffre (`ChestLidController` : +-0,1 par tick, angle 1-(1-o)^3), corps de cloche (`BellRenderer` : sin(f/pi) / (4 + f/3), 50 ticks) | `horizon-client-render/src/` (entites de blocs) | `src/film/effets-monde.js` |
| Particules de casse de bloc (`ParticleEngine.destroy` : 4 x 4 x 4, vitesse normalisee + 0,1, duree 4 a 40 ticks, 1/4 de texture, gravite 0,04, friction 0,98), particule de note | `horizon-client/src/game/{level_particles,block_particles}.rs`, `rendu/particles.rs` | `src/film/effets-monde.js` |
| Affaiblissement des sons (portee 16 x volume, lineaire), hauteur = vitesse de lecture | `horizon-client/src/game/sound_playback.rs` | `src/film/sons-monde.js` |

Les **outils** (`outils` dans les donnees : regles de minage de 38 objets) et l'instrument de chaque etat sortent de `items.json` et de `gameplay-facts.json` du dossier prepare du jeu, par `outils/extraire-donnees-jeu.mjs` (nombres et noms seulement).

### P2 (debut) : entites, blocs qui tombent, TNT, explosion, feu (`src/moteur/{entites,explosion}.js`, `familles/{chute,tnt,feu}.js`)

Reecrit en JavaScript a partir de Horizon (MIT) ; rien n'est copie.

| Ce qui est porte | Fichier d'origine (Horizon, `_ref/horizon/crates/`) | Ou chez nous |
|---|---|---|
| Explosion : 1352 rayons (surface de la grille 16x16x16), pas 0,3, perte (resistance + 0,3) x 0,3 et 0,225 par pas, force x (0,7 + 0,6 x hasard) ; degats `(int)((ab^2 + ab) / 2 x 7 x 2 x puissance + 1)`, recul, exposition par rayons ; amorcage des TNT voisins (meche nextInt(meche/4) + meche/8) ; son et particules | `horizon-client/src/game/{explosion,tnt,native_explosions}.rs` | `src/moteur/explosion.js`, `src/moteur/entites.js` |
| TNT amorce : meche 80, gravite 0,04, trainee 0,98, saut de depart 0,2, sol x (0,7 ; -0,5 ; 0,7) ; bloc qui tombe : gravite 0,04, trainee 0,98, atterrissage dans la cellule ; poudre de beton + eau | `horizon-client/src/game/{tnt,falling_blocks}.rs`, `horizon-world/src/{level/falling,block_landing}.rs` | `src/moteur/entites.js`, `familles/{chute,tnt}.js` |
| Feu : age 0..15, tick 30 + nextInt(10), combustion des voisins (`burnOdds`), propagation (`igniteOdds`), extinction | `horizon-world/src/level/tick.rs` (feu) | `familles/feu.js` |
| Particules de TNT et d'explosion (fumee, `explosion_0..15`) ; flash blanc du TNT toutes les 5 ticks | `horizon-client/src/rendu/particles.rs`, `tnt.rs` | `src/film/effets-monde.js` |

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

## Police des légendes (`src/incrust/polices/`)

`SourceSans3-Black.ttf` : Source Sans 3 Black, Copyright 2010-2020 Adobe, licence SIL Open Font License 1.1 (texte complet dans `src/incrust/polices/OFL.txt`).
Police sans très grasse livrée avec le lecteur pour les légendes (`"police":"sans"`, défaut des sous-titres). Ce n'est pas un fichier du jeu.

## Fluides, butin, objets au sol, sante (`src/moteur/familles/fluides.js`, `butin.js`, `entites.js`, `acteurs.js`, `src/rendu/maillage.js`) : portage depuis Horizon (MIT)

Reecrit en JavaScript, rien n'est copie ; les nombres sont ceux du jeu, verifies par `test/sim4.test.js` et `test/fluides-rendu.test.js`. Fichiers de `_ref/horizon/crates/` :

| Ce qui est porte | Fichier d'origine (Horizon) | Ou chez nous |
|---|---|---|
| `FlowingFluid` : `getNewLiquid`, `getSpread`, `getSlopeDistance`, `isWaterHole`, `spreadTo`, `tick` (source = 8, coulant 7 a 1, tombant = niveau 8 ; perte 1 par bloc pour l'eau, 2 pour la lave ; recherche de pente 4 / 2 ; deux sources voisines au-dessus d'un sol) | `horizon-world/src/level/fluids.rs` (l. 106-684) | `familles/fluides.js` |
| Delais (eau 5, lave 30 ; la lave qui monte attend 4 fois plus 3 fois sur 4) et `canPassThroughWall` / `mergedFaceOccludes` (formes de collision qui bouchent la face commune) | `fluids.rs` (l. 107-246, 685-708, 816-866) | `familles/fluides.js` (`couvre`, `passe`) |
| `LiquidBlock` : lave + eau -> obsidienne (source), pierre cassee (coulant), basalte (terre d'ame + glace bleue), son et fumee (evenement 1501) ; `LavaFluid.randomTick` (feu autour de la lave) | `fluids.rs` (l. 712-813) | `familles/fluides.js` |
| Eau enchainee (`LiquidBlockContainer`, `canPlaceLiquid`, `placeLiquid`), reprise au seau (`BucketPickup.pickupBlock`) | `fluids.rs` (l. 74-362) | `familles/fluides.js` (evenement du monde `objet.utilise`) |
| Courant (`FlowingFluid.getFlow`) et poussee des entites (`Entity.updateFluidHeightAndDoFluidPushing` : 0,014 eau, 0,0023 lave), nage (x 0,8, gravite / 16), lave (x 0,5, gravite / 4), saut dans un fluide (+0,04) | `horizon-world/src/entity_fluid.rs`, `living_fluid.rs` | `simulation.js` (`courant`), `acteurs.js` (`fluidesAutour`, `physique`) |
| Rendu des fluides (`FluidRenderer` : hauteur d'une cellule, moyenne ponderee des 4 coins `calculateAverageHeight`, direction du courant, textures calme / coule, faces cachees) | `horizon-client-render/src/mesher/fluid.rs` | `rendu/maillage.js` (`emettreFluide`, `hauteurCoin`, `courant`) |
| Butin des blocs (`LootTable`, conditions `survives_explosion`, `match_block`, `table_bonus`, `random_chance` ; fonctions `set_count`, `explosion_decay`, `apply_bonus`) : les tables sont compilees dans NOTRE format compact par `outils/extraire-donnees-jeu.mjs` (champ `butins` des donnees : noms et nombres, aucun fichier du jeu) | `horizon-world/src/loot.rs` | `butin.js` |
| Objets au sol (`ItemEntity` : boite 0,25, gravite 0,04, rebond -0,5, delai de ramassage 10, fusion, 6000 ticks ; animation de ramassage de 3 ticks ; rotation et flottement a l'affichage) | `horizon-client/src/entities.rs`, `game/item_entities.rs` | `entites.js` (`tickObjet`, `ramasser`), `film/entites-monde.js` |
| Vie : `hurt` (invulnerabilite de 10 ticks, seul un coup plus fort passe), degats de chute `ceil(distance - 3)`, noyade (300 ticks d'air), mort en 20 ticks (rotation `sqrt(t / 20 x 1,6) x 90`, nuage de 20 `poof`) | `horizon-world/src/living_damage.rs`, `horizon-client/src/game/combat.rs` | `acteurs.js` (`degats`, `mourir`, `atterrir`), `film/anim.js` |

Les valeurs de `display.ground` des modeles d'objets (echelle 0,25 des blocs, 0,5 des objets plats) viennent des modeles du jeu lus par `src/objets/` ; rien n'est embarque.

## Redstone, pistons, entonnoirs (`src/moteur/redstone.js`, `contenus.js`, `familles/{redstone,pistons,contenus}.js`, `src/decor/liaisons.js`) : portage depuis Horizon (MIT)

Reecrit en JavaScript, rien n'est copie ; les nombres sont ceux du jeu, verifies par `test/sim5.test.js` (22 essais) et `test/decor.test.js`. Les tables de signal faible et fort, le drapeau « conduit la redstone » et la reaction aux pistons de chaque etat viennent des donnees du jeu (`outils/extraire-donnees-jeu.mjs` : aucun fichier du jeu n'est embarque). Pas de trace de Horizon comparee (pas de chaine Rust sur le poste) : les cas de `tests/redstone.rs` et `tests/pistons.rs` ont servi de liste de comportements. Fichiers de `_ref/horizon/crates/horizon-world/src/level/` :

| Ce qui est porte | Fichier d'origine (Horizon) | Ou chez nous |
|---|---|---|
| `SignalGetter` : `getSignal`, `getDirectSignal`, `getDirectSignalTo`, `hasNeighborSignal`, `getBestNeighborSignal`, `getControlInputSignal` ; conducteur ou non | `redstone.rs` (l. 31-212) | `moteur/redstone.js` (`signal`, `directEtat`, `directeVers`, `aSignalVoisin`, `meilleurSignalVoisin`, `signalControle`) |
| Poudre : `getConnectionState`, `getConnectingSide`, `updateShape`, `updateIndirectNeighbourShapes`, `DefaultRedstoneWireEvaluator.updatePowerStrength` (avec l'ordre d'un `HashSet<BlockPos>` de Java), `updateNeighborsOfNeighboringWires` | `redstone.rs` (l. 214-498, 1524-1550) | `moteur/redstone.js` (`etatConnexion`, `formeFil`, `formesIndirectes`, `majPuissanceFil`, `majVoisinsDesFils`, `ordreHashSet`), `decor/liaisons.js` |
| Repeteur et comparateur : delai, verrou, priorites des ticks, `checkTickOnNeighbor`, `refreshOutputState`, entree d'un comparateur (bloc a sortie analogique ou derriere un bloc conducteur) | `redstone.rs` (l. 500-745) | `familles/redstone.js` (`DiodeBlock`) |
| Torche (inversion, 2 ticks, grille : 8 changements en 60 ticks, pause de 160), observateur (impulsion de 2 ticks), lampe (4 ticks), cible, detecteur de lumiere du jour, ampoule de cuivre | `redstone.rs` (l. 748-845, 1098-1122, 1266-1306, 1485-1521) | `familles/redstone.js` |
| Boutons, leviers, plaques : mise a jour des voisins apres un changement (`updateNeighbours`), portes, trappes, portillons, bloc musical, cloche, TNT, distributeur, entonnoir reagissant au signal | `redstone.rs` (l. 867-1100, 1155-1420), `hooks.rs` | `familles/{boutons,portes,conteneurs,tnt,contenus}.js` |
| `Level.setBlock` complet : formes indirectes, sortie analogique, drapeaux, `affectNeighborsAfterRemoval` ; `NeighborUpdater` (ordre ouest, est, bas, haut, nord, sud ; mise a jour sans un cote) ; `willTickThisTick` ; file d'evenements de blocs | `update.rs` (l. 289-324, 517-720), `hooks.rs`, `horizon-core/src/ticks/mod.rs` | `moteur/simulation.js` |
| Pistons : `checkIfExtend` (quasi-connexion), `isPushable`, `PistonStructureResolver` (ligne, slime, miel, reordonnancement, limite 12), `moveBlocks` (ordre des `HashMap` de Java, drapeaux 18 82 276 324 340), `triggerEvent`, `PistonMovingBlockEntity` (0,5 par tick, `finalTick`), tete de piston | `pistons.rs` (l. 20-794) | `familles/pistons.js` |
| Rendu d'un bloc en mouvement (`PistonHeadRenderer` : decalage `progres - 1` ou `1 - progres`, tete courte avant 0,5) et sa collision | (formules du jeu) | `familles/pistons.js` (`ecrire`, `collisionDyn`), `film/entites-monde.js` |
| Entonnoir (8 ticks, pousse puis aspire), dropper et distributeur (4 ticks, case au hasard, seaux), plenitude d'un conteneur pour le comparateur | `client/game/machines.rs`, `dispenser.rs` (lecture seule : comportements) | `familles/contenus.js`, `moteur/contenus.js` |

## Phase 7 : objets, projectiles, conteneurs, croissance, meteo (docs/SIMULATION.md partie 13)

Memes termes : code MIT de Horizon, relu et reecrit en JavaScript (comportements et nombres seulement ; aucun fichier du jeu dans le paquet).

| Ce qui est porte | Fichier d'origine (Horizon) | Ou chez nous |
|---|---|---|
| Fleches : deplacement, trainee et gravite, plantage, degats `ceil(vitesse x 2)`, critique, boite de contact, perte du proprietaire ; puissance de l'arc, arbalete | `client/arrows.rs`, `client/game/crossbow.rs` | `moteur/projectiles.js`, `moteur/utilisation.js` |
| Boule de neige, oeuf, perle d'ender (teleportation, 5 de degats), potion jetee (4 x 2 x 4, force), trident | `client/projectiles.rs` | `moteur/projectiles.js` |
| Utilisation d'un objet : `startUsingItem`, `updateUsingItem` (mastication tous les 4 ticks), `completeUsingItem`, faim et saturation, effets de potion | `client/game/{hand,potions}.rs`, `world/food.rs` | `moteur/utilisation.js` |
| Four : `AbstractFurnaceBlockEntity.serverTick` (temps de combustion, cuisson, retour de 2 par tick) | `world/level/furnace.rs` | `moteur/four.js` |
| Cultures `getGrowthSpeed`, `CropBlock.randomTick`, terre labouree, `SaplingBlock`, herbe, canne, cactus, bambou, lierre, feuilles (distance), farine d'os | `world/level/{tick,growth,bonemeal}.rs` | `moteur/familles/croissance.js` |
| `TreeFeature`, troncs droit et fourchu, feuillages en boule, sapin, acacia | `worldgen/tree/` | `moteur/arbres.js` |
| `Level.isRainingAt`, `tickPrecipitation`, neige et gel, foudre (`LightningBolt`), niveaux de pluie et d'orage | `world/level/weather.rs`, `client/game/{weather,lightning}.rs` | `moteur/meteo.js`, `film/meteo.js` |
| Dessin de la pluie et de la neige (`WeatherEffectRenderer`), de l'eclair (`LightningBoltRenderer`) | `client-render/src/{weather,gfx/weather,gfx/lightning}.rs` | `film/meteo-rendu.js` |

## Meteo (`src/film/meteo-rendu.js`) et foudre

Reecrit en JavaScript a partir de Horizon (MIT), aucun fichier copie :

| Ce qui est porte | Fichier d'origine (Horizon) | Ou chez nous |
|---|---|---|
| Forme de l'eclair (`LightningBoltRenderer.submit`) : 8 segments de 16 blocs, deux branches de 3 segments (ecart `nextInt(31) - 15`), 4 couches de largeur `0,1 + 0,2 x couche`, 4 quads par segment, couleur blanc bleute 0,45 0,45 0,5 a 0,3 d'opacite, dessin additif | `crates/horizon-client-render/src/gfx/lightning.rs` (`geometry`) | `src/film/meteo-rendu.js` (`bolt`), additif dans `src/rendu/raster.js` |
| Colonnes de pluie et de neige (`WeatherEffectRenderer`) : opacite `(max + t x (0,5 - max)) x intensite`, pluie max 1, neige 0,8, couleur de sommet blanche | `crates/horizon-client-render/src/weather.rs` (`column_quad`) | `src/film/meteo-rendu.js` |

## Creatures (`src/creatures/`, `src/film/creatures.js`) : portage depuis Horizon (MIT) et tables numeriques du jeu

Code reecrit en JavaScript a partir de Horizon (MIT, `_ref/horizon/crates/horizon-client/src/mobs/`). Aucun code de Mojang n'est
decompile ni copie. Les MODELES (polygones cuits, pivots, UV), les animations a images cles et les statistiques sont des tables
numeriques extraites des donnees du jeu du proprietaire (`outils/extraire-creatures.mjs` -> `relais/d/creatures-1.json.gz`, servi par
le relais, jamais dans le paquet). Les TEXTURES et les SONS ne sont jamais livres : ils viennent des fichiers du jeu chez le client
(groupes de kit a la demande `entites` et `sons_creatures`).

| Ce qui est porte | Fichier d'origine (Horizon) | Ou chez nous |
|---|---|---|
| Arbre de parties, nommage (racine "root" imbriquee, premier nom garde), poses par nom, parties cachees / sautees | `mobs/model.rs` (`Part::parse`), `mobs/anim.rs` (`Poses`) | `src/creatures/poses.js` |
| Animations a images cles (echantillonnage, catmullrom, boucle, `applyWalk`), etats d'animation | `mobs/keyframes.rs` | `src/creatures/images-cles.js` |
| Animations de code de toutes les familles (`setupAnim` : humanoides, bras, arc, arbalete, zombie, nage, quadrupedes, araignee, creeper, poule, villageois, golems, illageois, piglins, sorciere, loup, chat, chevaux, slime, enderman, blaze, ghast, poissons, calamar, dauphin, chameau, breeze, sniffer, warden, creaking, allay, phantom, gardien, vex, ravageur, shulker, wither, golem de cuivre, happy ghast, nautilus, et `body_anim.rs`) ; horloges par tick (ailes, ecrasement du slime, tentacules, queue, tete qui dit non, attaque du golem...) | `mobs/anim.rs`, `body_anim.rs`, `villager.rs`, `golem.rs`, `illager.rs`, `piglin.rs`, `witch.rs`, `tame.rs`, `equine.rs`, `cube.rs`, `enderman.rs`, `nether.rs`, `aquatic.rs`, `camel.rs`, `breeze.rs`, `sniffer.rs`, `warden.rs`, `creaking.rs`, `allay.rs`, `phantom.rs`, `guardian.rs`, `vex.rs`, `ravager.rs`, `shulker.rs`, `wither.rs`, `copper_golem.rs`, `happy_ghast.rs`, `nautilus.rs` | `src/creatures/anim.js` |
| Table des especes (modele, texture, famille d'animation, sons, dimensions des bebes) | `mobs/species.rs` (`ALL`) | `src/creatures/especes.js` (`ESPECES`) |
| Textures et couches par type et variante (corps, bebes, laine et sous-laine teintes, collier, selles, armure de cheval, marques, tapis de lama, metiers / biomes / niveaux des villageois et chapeaux `.mcmeta`, yeux emissifs, couches externes, charge du creeper, armure des humanoides) ; couleurs des teintures et de la laine | `mobs/render.rs` (`body`, `layers`, `humanoid_armor`), `equine.rs`, `llama.rs`, `tame.rs`, `panda.rs`, `villager_hats.rs`, `horizon-client-render/src/pack_palette.rs` | `src/creatures/rendu.js` (`couchesDe`), `especes.js` |
| Chaine de matrices d'un mob (`180 - lacet`, symetrie (-1,-1,1), -1,501, `translateAndRotate` Z.Y.X, echelle de partie), gonflement du creeper et clignotement blanc, ecrasement du slime, balancement du golem de fer ; bateau (0,375, rotation de 90 degres, pagaies) | `mobs/render.rs` (`base_transform_at`, `species_scale`, `posed`), `mobs/cube.rs`, `game/boats.rs` | `src/creatures/rendu.js`, `src/film/creatures.js` |
| Objet tenu par un mob (main, `ItemInHandLayer`) | `mobs/render.rs` (`hand_base`, `held_item_transform`) | `src/creatures/rendu.js` (meme chaine que `src/objets/placement.js`) |
| Marche des pattes (`WalkAnimationState` : min(distance x 4, 1) a 0,4 par tick, bebes x 3 ; chameau x 6 a 0,2) | `mobs/anim.rs` (`walk_position`), `mobs/camel.rs` (`walk_target`) | `src/film/creatures.js` |
| Montures : points d'attache des passagers par type, decalage du cavalier (0,6 joueur, 0,7 zombies et squelettes...), rotation avec la monture, pose assise | `mobs/riders.rs` (`passenger_attachment`, `vehicle_attachment`, `seat`), `mobs/camel.rs`, `game/boats.rs` (`seat`), `mobs/anim.rs` (`humanoid`, passager) | `src/creatures/especes.js` (`SIEGES`), `src/film/creatures.js` |
| Etiquette de nom (hauteur de boite + 0,5, fond noir 25 %, 0,025 bloc par pixel) | `EntityRenderer.renderNameTag` (fait du jeu, decrit par Horizon `render.rs`) | `src/creatures/etiquette.js` |
| Cavalier colle au siege a chaque image : corps du cavalier d'une monture vivante (`solveBodyRot` : 85 degres, 1/5 au-dela de 50), siege du cheval cabre (`rear_offset`), places du chameau (`passenger_attachment_at`, `body_anchor_y`) et du bateau (`seat`) | `mobs/riders.rs`, `mobs/equine.rs`, `mobs/camel.rs`, `game/boats.rs` | `src/film/creatures.js` |
| Lapin : minuteur de repos a la naissance (180 + [0, 40[), sauts (`Rabbit` : la creature n'avance qu'en l'air) | `mobs/rabbit.rs` (`register`, `base_tick`, `start_jumping`) | `src/creatures/anim.js`, `src/film/creatures.js` (`sautsLapin`) |
| IA des creatures : selecteur de buts, enregistrement des buts des zombies et squelettes (priorites), `RangedBowAttackGoal` (tension 20 ticks, intervalle, recul de vue -60), `performRangedAttack` (1/3 de hauteur + dist x 0,2, vitesse 1,6, imprecision 14 - 4 x difficulte, degats de base), `bow_power`, fuite du lapin (8 / 10 / 4 blocs), buts communs (MeleeAttack, Stroll, LookAtPlayer, RandomLookAround, Panic, AvoidEntity, Float, NearestTarget, HurtByTarget) | `mobs/goals.rs`, `mobs/undead.rs` (`register`, `BowAttack`, `perform_ranged_attack`), `mobs/rabbit.rs` (`register`) | `src/moteur/ia.js` (port compact) |

Ecrit d'apres le comportement du jeu (sans code de Horizon pour ces points) : `EnderDragonModel.setupAnim` (battement des ailes sur flapTime, cou et queue) et `EnderDragon.aiStep` (flapTime) ; `CodRenderer` / `SalmonRenderer` / `TropicalFishRenderer.setupRotations` (poisson couche hors de l'eau) ; `WardenRenderer` (taches qui pulsent cos(age x 0,045) x 0,25, coeur) ; `CarriedBlockLayer` de l'enderman, `AbstractMinecartRenderer` (bloc a 0,75, decalage d'affichage), `CrossedArmsItemLayer` ; `Strider.getPassengerAttachmentPoint` (siege qui se dandine) ; `SwellGoal` / `Creeper.tick` (30, rayon 3 ou 6), `IronGolem.doHurtTarget`, `Player.hurt` (difficulte), `Mob.isSunBurnTick`, `BreakDoorGoal`, `Player.attack` (recharge, critique), attributs des armes, butin des tables d'entites.

### Volants, boules de feu, sorciere, enderman, cerveau du villageois, laisse (2026-11-17, suite)

Reecrit en JavaScript a partir de Horizon (MIT) ; rien n'est copie.

| Ce qui est porte | Fichier d'origine (Horizon, `_ref/horizon/crates/horizon-client/src/`) | Ou chez nous |
|---|---|---|
| Chauve-souris : repos sous un bloc conducteur (y = plafond - hauteur), reveil a 4 blocs, but au hasard (7 / 6 - 2 / 7), vitesse vers le but (0,5 / 0,7 a 0,1 par tick), zza 0,5, raccroche 1 sur 100, perte de 40 % de vy | `mobs/bat.rs` | `src/moteur/ia-especes.js` (`tickChauve`, `physiqueVol`) |
| Controle de vol (`FlyingMoveControl` : rotlerp 90, vitesse x flying_speed, yya = +-vitesse, maxTurn) ; deplacement en vol (`travelInAir` 0,02 et trainee 0,91 / 0,98, `travelFlying` 0,91, `Allay.travel`) | `mobs/control.rs`, `mobs/living.rs` | `src/moteur/ia-especes.js` (`suivreVol`, `physiqueVol`) |
| Ghast : `RandomFloatAroundGoal` (+-16), `GhastMoveControl` (poussee 0,1 tous les 2 a 6 ticks si la boite passe), `GhastLookGoal`, `GhastShootFireballGoal` (10 cri, 20 tir, -40), cible a 4 blocs de hauteur ; Blaze : `BlazeAttackGoal` (60, 3 x 6, 100 ; triangle 2,297 x racine4(d2) x 0,5), descente x 0,6, montee (0,3 - vy) x 0,3 | `mobs/nether.rs` | `src/moteur/ia-especes.js` |
| Boules de feu (`AbstractHurtingProjectile` : acceleration 0,1, inertie 0,95 / 0,8 dans l'eau ; tailles 1 et 0,3125 ; echelles de dessin 3 et 0,75 ; charge de feu ; puissance 1 du ghast) | `projectiles.rs` | `src/moteur/projectiles.js` (`tickFeu`, `finFeu`, `renvoyer`), `src/film/entites-monde.js` |
| Sorciere : `RangedAttackGoal(1, 60, 60, 10)`, `performRangedAttack` (lenteur >= 8 blocs, poison si vie >= 8, faiblesse <= 3 blocs a 25 %, degats ; vitesse 0,75 / 0,45, imprecision 8), boissons (`aiStep` : respiration 15 %, feu 15 %, soin 5 %, vitesse 50 %, 32 ticks) | `mobs/witch.rs` | `src/moteur/ia-especes.js` |
| Enderman : `isBeingStaredBy` (cone 0,025 / distance), `teleport` (+-32), `teleportTowards`, `randomTeleport` (sol, boite libre, sans liquide), esquive des projectiles (64 essais), 9 chances sur 10 sans attaquant vivant, fuite en plein jour, regard fixe (5 ticks) | `mobs/enderman.rs` | `src/moteur/ia-especes.js` |
| Vex (`VexMoveControl`, charge, deplacement au hasard), phantom (`PhantomMoveControl`, cercle autour du point d'ancrage, pique) ; abeille (piqure, poison 10 / 18 s, colere), perroquet (epaule), allay (joueur aime) | `mobs/vex.rs`, `mobs/phantom.rs`, `mobs/bee.rs`, `mobs/parrot.rs`, `mobs/allay.rs` | `src/moteur/ia-especes.js` |
| Emploi du temps du villageois (`activity_at` : 10 / 2000 / 9000 / 11000 / 12000) | `mobs/villager.rs` | `src/moteur/ia-especes.js` (`activiteVillageois`) |
| Vie des creatures : `BreedGoal` (8 blocs, 60 ticks, 3 blocs), `FollowParentGoal`, `TemptGoal`, `feed_animal` / `age_up` (600, 6000, -24000, un dixieme), `animal_step` (coeur toutes les 10 ticks), `eating_sound`, `breed` (variantes heritees : pile ou face, champimeuh 1/1024, cheval 4/9 et 2/5, mule), orbe 1 a 7 | `mobs/goals.rs`, `mobs/ai.rs`, `game/creatures.rs` | `src/moteur/ia-vie.js` |
| Abeilles : `BeePollinateGoal` (5 blocs, 400 / 600 ticks, 0,35, 1/25), `BeeEnterHiveGoal`, `BeeLocateHiveGoal` (20 blocs), `BeeGoToHiveGoal`, `BeeGoToKnownFlowerGoal`, `BeeGrowCropGoal` (1/15, 10 cultures), `wantsToEnterHive`, colere 400 a 780 ; ruche : occupants 3, 2400 / 600 ticks, sortie (0,55 + demi-largeur), miel (+1, 1/100 : +2) | `mobs/bee.rs`, `beehive.rs` | `src/moteur/ia-vie.js` |
| Juke-box et danse (perroquet a 3 blocs, allay a 10), imitations du perroquet, conversions (`Zombie.killedEntity`, noyade 600 + 300, foudre), golem appele, blocs de l'enderman | `game/allays.rs`, `mobs/parrot.rs`, `mobs/conversion.rs`, `mobs/enderman.rs` | `src/moteur/ia-vie.js`, `src/moteur/familles/musique.js` |
| Queue du cheval : pose de repos PI/6 (la levee au galop est reduite et balance avec les pattes : ecart voulu, docs/SIMULATION.md partie 16) | `mobs/equine.rs` (`anim`) | `src/creatures/anim.js` (`poserEquide`) |
| Laisse : corde (`LeashRenderer` : 24 segments, parabole, deux rubans de 0,025, tons 1 / 0,7), points d'attache, physique (`Leashable` : 6 et 10 blocs) | `mobs/leash.rs` | `src/creatures/laisse.js`, `src/moteur/ia-especes.js` (`tickLaisse`) |

Ecrit d'apres le comportement du jeu : `WitherBossRenderer.scale` (x 2) ; `LivingEntityRenderer` couche (`sleepDirectionToRotation`, recul de oeil - 0,1) ; `ClientLevel.animateTick` et `animateTick` de l'eau, de la lave et du feu (sons d'ambiance, `src/film/sons.js`) ; `knockback_resistance` du golem de fer et du ravageur.

### Dernieres creatures (docs/SIMULATION.md partie 18)

| Ce qui est porte | Source Horizon (MIT) | Fichier |
|---|---|---|
| Wither : `register` (FlyingMoveControl 10, RangedAttack 40 / 20), `make_invulnerable` (220, vie / 3), `head_pos`, `shoot`, `steer`, `turn_heads` (10 / 40 degres), `custom_server_ai_step` (charge, explosion 7, tetes de cote, volees bleues apres 16, casse des blocs, +1 / s), `accepts` (charge, fleches sous la moitie, morts-vivants), `texture` (clignotement), `scale` | `mobs/wither.rs` | `src/moteur/ia-boss.js`, `src/film/creatures.js` |
| Crane du wither : 8 / 5 de degats, fletrissement 200 / 800, soin 5 du lanceur, explosion 1, plafond de resistance 0,8 du crane bleu ; inertie 0,73 ; motif d'invocation (`WITHER_FULL`, 24 orientations, `check_wither_spawn`) | `game/wither.rs`, `projectiles.rs`, `block_pattern.rs` | `src/moteur/projectiles.js`, `src/moteur/explosion.js`, `src/moteur/ia-boss.js` |
| Dragon : phases (`tick_phase` : cercle, mitraillage, approche, atterrissage, scan, rugissement, souffle, charge, envol, mort), noeuds et `ADJACENCY`, `dragon_path`, `next_target`, `ring_path`, `strafe_begin`, pilotage de `tick_dragon`, parties (`place_dragon_parts`), contacts (`dragon_contacts.rs` : 4 / 0,2 / 5 / 10), `tick_dragon_death` (0,1, 180 a 200, orbes), boule et nuages (`spawn_dragon_fireball`, `dragon_fireball_on_hit`, `tick_breath`, `harm_amount`, `breath_victims`), cristaux (soin 1 / 10 ticks) | `game/dragon.rs`, `mobs/dragon_contacts.rs` | `src/moteur/ia-boss.js` (adapte : centre, perchoir, `dragon.rayon`) |
| Gardiens : `GuardianAttack` (-10, 80 / 60, 1 + 2 + 2 de magie puis le coup), `move_control`, `travel` (0,1, x 0,9), `tail_and_spikes`, sauts sur la terre, `elder_server_ai_step` (1200 ticks, 50 blocs), `beam_geometry` (rayon du laser) | `mobs/guardian.rs` | `src/moteur/ia-eau.js`, `src/film/entites-monde.js` |
| Nage : `register` des poissons, calmars, dauphins, axolotls, tetards (SmoothSwimming 0,02 / 0,1, 0,1 / 0,5), `squid_step`, `travel`, `fish_move_control`, `FishSwim`, `FollowFlockLeader` (8 / 5) ; grenouille (vitesse hors de l'eau 0,1) | `mobs/aquatic.rs`, `mobs/frog.rs` | `src/moteur/ia-eau.js` |
| Warden : `AngerLevel` (40 / 80, 150), `increase_anger`, `listen` (16 blocs), `receive_vibration` (40 ticks, +35 / +10), `hurt`, `do_push`, `server_ai_step` (obscurite 120 / 260 / 200), `tick_sonic_boom` (34, 10, 2,5 / 0,5) ; cerveau : durees (134, 100, 84, 84), `DIGGING_COOLDOWN` 1200, `set_attack_target` (200), vitesses (0,5 / 0,7 / 1,2), activites | `mobs/warden.rs`, `mobs/warden_brain.rs` | `src/moteur/ia-warden.js`, `src/moteur/vibrations.js` |

### Nombres d'abord ecrits de memoire : verifies (2026-11-17, fin)

Chaque point ci-dessous avait ete ecrit d'apres le comportement connu du jeu, sans source lue. Il a ete compare a Horizon (MIT, `_ref/horizon/crates/`) et, quand ils existent, aux fichiers de donnees du jeu prepares sur le poste du proprietaire (lecture seule, rien n'est copie dans le depot).

| Point | Source de la verification | Resultat |
|---|---|---|
| Eclosion de l'oeuf de tortue (`TurtleEggBlock.randomTick`) | `horizon-world/src/level/timeline.rs` (`turtle_hatch_chance`, `turtle_egg_tick`) ; `data/minecraft/timeline/day.json` du jeu (piste `gameplay/turtle_egg_hatch_chance` : 1 de 21062 a 21905 ticks, sinon 0,002) | **corrige** : fenetre en ticks du jour [21062, 21905[ (3 h 04 a 3 h 54) au lieu de l'angle du soleil 0,65 a 0,69 ; tirage `nextFloat() < chance` ; sons `entity.turtle.egg_crack` / `egg_hatch` (les noms `block.turtle_egg.*` n'existent pas : la scene de nuit etait muette) |
| Bebes tortues | `horizon-client/src/game/creatures.rs` (`hatch_turtles`) | identique (x + 0,3 + 0,2 i, age -24000, plage = l'oeuf) |
| Frai (`FrogspawnBlock`) | `level/hooks.rs` (`next_int_between(3600, 12000)`), `horizon-client/src/game.rs` (`hatch`) | delais identiques ; **corrige** : place des tetards 0,2 + 0,6 x `nextFloat()` |
| Oeuf de renifleur (`SnifferEggBlock`) | `level/hooks.rs`, `level/timeline.rs` (`sniffer_egg_tick`), `game/sniffers.rs`, `mobs/animal_brain.rs`, `mobs/sniffer.rs` | delais identiques (24000 / 3, mousse 12000 / 3, + [0, 300[) ; **corrige** : bebe a -48000 (`BABY_START_AGE`), au centre du bloc (+0,5), lacet au hasard ; son de ponte `block.sniffer_egg.plop` (et non `entity.sniffer.egg_plop`, absent du jeu) ; l'oeuf tombe a la place du parent |
| Ponte et retour de la tortue (`TurtleLayEggGoal`, `TurtleGoHomeGoal`) | `mobs/turtle.rs`, `mobs/goals.rs` (`MoveToBlock::walk`, `reduced`) | 200 ticks, 1 a 4 oeufs, amour 600, 1 sur 350, 64 / 7 blocs : identiques ; **corrige** : recherche du sable dans l'ordre du jeu (hauteurs 0, +1, -1 ; anneaux jusqu'a 16), attente `reduced(200 + [0, 200[)` entre deux recherches, distances au centre de la case de la plage, abandon apres 300 ticks a moins de 16 blocs |
| Genes du panda (`Panda.Gene`) | `mobs/panda.rs` (`inherit`), `mobs/finalize.rs` (`panda_gene`, `panda_variant`) | identiques |
| Oeuf de poule (`Chicken.aiStep`) | `mobs/farm.rs` (`chicken_egg_step`), `data/minecraft/loot_table/gameplay/chicken_lay.json` du jeu | identiques (6000 + [0, 6000[, oeuf / brun / bleu selon la variante) |
| Ocelot (`Ocelot.mobInteract`) | `game/creatures.rs` | 3 blocs, 1 sur 3 : identiques ; **corrige** : seulement pendant que l'ocelot vient vers le poisson (`temptGoal.isRunning`) |
| Axolotl bleu, oeuf lance | `game/creatures.rs` (`useRareVariant`, `ThrownEgg.onHit`) | identiques (1 sur 1200 ; 1 sur 8, puis 4 poussins 1 sur 32) |
| Vibrations (`VibrationSystem`, `SculkSensorBlock`) | `horizon-client-render/src/sculk.rs` (`EVENTS`, `ignored_when_sneaking`, `redstone_strength`), `horizon-world/src/level/sculk.rs` | **corrige** : table des frequences (pas 1, projectile qui atterrit 2, bloc pose 13, entite posee 14...), liste des evenements ignores accroupi ; capteur calibre actif 10 ticks ; 30 / 10 ticks et puissance : identiques |
| Guerison du zombie villageois | `mobs/zombie_villager.rs` (`progress`) | identique ; **corrige** : coordonnees tronquees vers zero (`(int) getX()`) |
| Ragots (`GossipType`) | `horizon-client/src/gossip.rs` | **corrige** : major_positive au plus 20 (et non 100), -20 au transfert ; le reste identique |
| Orbes d'experience | `horizon-client/src/entities.rs` | identiques (gravite 0,03, attirees a 8 blocs) |
| Fantome du gardien ancien, rayons de mort du dragon, obscurite | `game/mob_blocks.rs` (30 ticks), `game/dragon/death_render.rs` (graine 432, `(t + t^2) / 2 x 60`), `game/sculk.rs` `darkness_lighting` (cos(t x 0,025 pi) x 0,45, fondu de 22 ticks : `game/potions.rs`) | identiques |
| Taches du warden (`WardenRenderer`), soleil (`isSunBurnTick`), golem de fer (`doHurtTarget`), creeper (`SwellGoal`, 3 blocs) | `mobs/warden.rs`, `mobs/ai.rs`, `mobs/golem.rs`, `mobs/hostile.rs` | identiques |

Restent NON compares ligne a ligne (la source existe dans Horizon mais n'a pas ete relue a ce tour ; ce sont des formes de dessin, pas des delais ni des chances) : `EndCrystalModel`, `MerchantScreen` (mise en page), `EnderDragonModel.setupAnim`, rotations des poissons hors de l'eau, `CarriedBlockLayer`, `AbstractMinecartRenderer`, `CrossedArmsItemLayer`, siege du strider, `WitherBossRenderer.scale`, rotation du dormeur, `animateTick` de l'eau, de la lave et du feu. Aucun n'a de nombre « de memoire » qui change une issue de la simulation.

Dauphins qui nagent avec le joueur (2026-11-17, fin) : `DolphinSwimWithPlayerGoal(4,0)` et la Grace du dauphin (100 ticks, rendue 1 fois sur 6) d'apres `horizon-client/src/mobs/dolphin.rs` (`SwimWithPlayer`, `grace`) et `mobs/aquatic.rs` (priorite 2) ; effet sur la nage du joueur (ralentissement horizontal 0,96 dans l'eau) d'apres `horizon-world/src/living_fluid.rs` (`travel_in_water`) -> `src/moteur/ia-eau.js`, `src/moteur/acteurs.js`.

### Villageois du jeu : vie du village, reproduction, bebes (`src/moteur/ia-villageois.js`, docs/SIMULATION.md partie 20, 2026-11-18)

Port d'apres Horizon (MIT, licence ci-dessus) et les donnees du jeu 26.3 preparees par Horizon (`.../horizon-client/26.3/data/minecraft/tags/item/villager_picks_up.json`, `villager_plantable_seeds.json`, `textures/entity/villager/villager_baby.png`). Chaque nombre a ete lu dans la source citee, aucun n'est ecrit de memoire :

| Ce que fait le moteur | Source Horizon | Nombres |
|---|---|---|
| Activites (temps libre, travail, rassemblement, repos ; bebe : temps libre, jeu, repos) | `mobs/villager.rs` `activity_at` | adulte 10-2000 et 11000-12000 libre, 2000-9000 travail, 9000-11000 rassemblement ; bebe 10-3000 et 6000-10000 libre, 3000-6000 et 10000-12000 jeu |
| Comportements du temps libre et du jeu (RunOne, poids, ShufflingList) | `mobs/villager_brain.rs` `packages`, `Gate::try_start` | libre : villageois 2, partenaire 1, chat 1, flanerie 1, vers le regard 1, lit 1, rien (30-60) 1 ; jeu : villageois 2, chat 1, flanerie 1, vers le regard 1, lit 2, rien (20-40) 2 ; poids -nextFloat^(1/w) |
| InteractWith, MoveToTargetSink | `villager_brain.rs` `B::InteractWith`, `lock_gaze_half` | 8 blocs (64), vitesse 0,5, a 2 blocs ; marche 150-250 ticks (jeu 80-120) |
| TradeWithVillager | `villager_brain.rs` `B::TradeWithVillager`, `mobs/villager.rs` `meet`, `take_half_stack`, `has_excess_food`, `wants_more_food`, `farmer_items` ; `game/villagers.rs` `villager_throw` | 60 ticks ; a 5 (distance au carre) ; exces 24 points, envie moins de 12 ; demi-pile : plus de 32 -> la moitie, plus de 24 -> ce qui depasse 24 ; ble du fermier plus de 32 ; lance depuis l'oeil - 0,3, vitesse 0,3, 10 ticks |
| VillagerMakeLove | `villager_brain.rs` `B::MakeLove`, `breeding_possible`, `take_bed_for_child` ; `game/villagers.rs` `villager_birth` ; `mobs/villager.rs` `can_breed`, `eat_and_digest` | 275 + nextInt(50) ticks, au plus 350 ; coeurs 1 sur 35 (evenement 12) ; a 5 ; lit : tete, pas occupee, d'aucun villageois, 48 blocs, atteignable ; type : biome 1/2, chaque parent 1/4 ; parents 6000 ; bebe -24000 ; sans lit : evenement 13 |
| Particules des evenements 12, 13, 14 | `horizon-client-render/src/particles.rs` `Burst::VILLAGER`, `entity_event_burst` | 5 particules, +1 en hauteur, vitesse gaussienne x 0,02 |
| PlayTagWithOtherKids, JumpOnBed, NearestBedSensor | `villager_brain.rs` `B::PlayTag`, `B::JumpOnBed`, `sense_bed`, `sense_babies` | 1 chance sur 10 ; poursuite 0,6 a 1 bloc ; le moins poursuivi (1 a 5) ; fuite LandRandomPos(20, 8), 10 essais, dans le village ; 100 ticks pour arriver au lit, 3 + nextInt(4) sauts, 5 ticks entre deux |
| AcquirePoi, GoToPotentialJobSite, AssignProfessionFromJobSite | `villager_brain.rs` `B::AcquirePoi`, `B::GoToPotentialJobSite`, `B::AssignProfession`, `poi_matches`, `closer_to_center` ; `mobs/villager.rs` `job_site_profession` | 48 blocs, 5 plus proches, essai tous les 20 + nextInt(20) ticks ; poste : adultes, sans metier ou meme metier, pas l'idiot ; 1200 ticks, 0,5 ; metier a moins de 2 blocs du centre (evenement 14) |
| Ramassage | `game/villagers.rs` `villager_item_sense`, `villager_pickups` ; `mobs/villager.rs` `food_points`, `INVENTORY_SLOTS` | 4 blocs, en vue (oeil de l'objet 0,2125) ; boite + 1 ; 8 cases |
| Pain du fermier | `game/villagers.rs` `villager_make_bread` | 3 pains au plus pour 9 bles, tant qu'il a 36 pains au plus |

Ecarts dits franchement : la recherche des POI couvre 48 blocs a l'horizontale et 24 en hauteur (le jeu : une sphere de 48) ; le village (`sectionsToVillage <= 1`) est approche par les sections a une section au plus d'un lit, d'un poste ou d'une cloche ; le rebond sur le lit n'est pas simule (le bebe saute) ; le metier ne se perd pas (ResetProfession non porte).


### Souffle des explosions sur les entites, aura du creeper charge (`src/moteur/explosion.js`, `src/creatures/rendu.js`, docs/SIMULATION.md partie 21, 2026-11-18)

| Ce que fait le moteur | Source Horizon (MIT) | Nombres |
|---|---|---|
| Distance depuis les pieds, exposition (`getSeenPercent`), direction vers les yeux, poussee (1 - d) x exposition, degats reels (a^2 + a) / 2 x 7 x 2P + 1 meme a exposition 0 | `horizon-client/src/game/explosion.rs` `seen_percent`, `blast_hit`, `explosion_hurt_entities`, `explosion_hurt_player` | rayon 2P, + 1 de degats |
| Hauteur des yeux des entites non vivantes (TNT 0, objet 0,2125, orbe 0,425, bloc qui tombe 0,85 x 0,98) ; objets et orbes : 5 de vie, `(int)(vie - degats)`, etoile du Nether epargnee, `items_ignore_explosion` | `game/entity.rs` `explosion_eye_height`, `game/explosion.rs` | identiques |
| `explosion_knockback_resistance` (Protection contre les explosions 0,15 par niveau ; 0 pour tous les types) | `game/explosion.rs` (commentaire de `explosion_hurt_player` et des mobs) | identiques |
| Aura du creeper charge et du wither : u et v qui defilent (`EnergySwirlLayer`) | `horizon-client/src/mobs/render.rs` (couches) | creeper u = v = age x 0,01 ; wither u = cos(age x 0,02) x 3 |

Pris du jeu sans passer par Horizon (formules publiques de `CombatRules`) : armure `clamp(points - d / (2 + robustesse / 4), points x 0,2, 20) / 25`, protection `min(20, points) / 25`, points d'armure par materiau. Le pantin du film (`src/film/ragdoll.js`) est a nous : ce n'est pas un comportement du jeu.
Corps qui se poussent (`src/moteur/poussee.js`, 2026-11-18) : `LivingEntity.pushEntities` / `Entity.push(Entity)` d'apres Horizon `mobs/ai.rs` (`push_entities`, `Mob::pushable`) : boites qui se touchent, d = max(|dx|, |dz|), rien sous 0,01 (float), racine, / d, x min(1, 1 / d), x 0,05 (float) ; l'acteur recoit +, l'autre - ; un dormeur n'est jamais pousse ; jamais pousses : chauve-souris, shulker (qui pousse), cristal, support d'armure, corps sur un bloc #climbable ; ne poussent pas : chauve-souris, dragon ; vex : noPhysics pendant son tick (Horizon `mobs/ai.rs`) ; entassement : plus de maxEntityCramming - 1 corps, une chance sur 4, 6 de degats `cramming` (`push_entities`).
Particules de l'explosion (2026-11-18, docs/SIMULATION.md partie 21) : HugeExplosionParticle (gris 0,4 + 0,6 r, demi-cote 2 x (1 - f/2), 6 + r(4) ticks, pleine lumiere), HugeExplosionSeedParticle (8 ticks x 6 boules a +-4), ClientExplosionTracker (min(blocs, 512) bouffees, distance racine cubique, vitesse 0,5 / (d/R + 0,1) x r x r + 0,3, poof a mi-distance ou smoke) d'apres Horizon `horizon-client-render/src/particles.rs` (`T::Explosion`, `Behaviour::ExplosionSeed`, `tick_explosions`, `T::Poof`) -> `src/film/effets-monde.js`, `src/moteur/explosion.js`.

### Derniers ecarts des villageois et des creatures (docs/SIMULATION.md partie 22, 2026-11-18)

| Ce qui est porte | Source Horizon (MIT) ou donnees du jeu | Nombres |
|---|---|---|
| Rebond sur un bloc (`src/moteur/rebond.js`) | `horizon-world/src/movement_restitution.rs` (`restitute_movement`), `horizon-client/src/mobs/living.rs` (bloc a 0,2 sous les pieds), `entities.rs` (non-vivant x 0,8) | LUS dans `movement-properties.nbt` du dossier prepare 26.3 (`bounceRestitution` : 16 lits et shelf_mushroom 0,75, slime_block 1 ; `fallDistanceReduction` : lits et shelf_mushroom 0,5) et `block-tags.json` (`#suppresses_bounce` : honey_block) ; le brief citait 0,66 (de memoire, vieilles versions) : le jeu 26.3 dit 0,75 |
| Chute sur le slime sans degat | `horizon-world/src/block_landing.rs` (`Rule::Slime` : multiplicateur 0) | - |
| POI dans la sphere de 48, ordre, tickets, attente | `horizon-client/src/mobs/villager_brain.rs` (`pois_in_range`, `tickets`, `others_tickets`, `Retry` = `AcquirePoi.JitteredLinearRetry`) | 48 ; tickets 1 (lit, poste), 32 (cloche, `max_tickets`) ; attente 40 + [0, 40[, 400 au plus, oubli apres 400 |
| Poste et metier perdus | `villager_brain.rs` (`ValidatePoi`, `PoiCompetitorScan`, `YieldJobSite`, `ResetProfession`, `closer_to_center`) | 16 blocs ; niveau <= 1 et xp 0 ; egalite : l'autre gagne |
| Experience d'un echange | donnees du jeu `data/minecraft/villager_trade/*/1/*.json` ; `horizon-client/src/entity_nbt.rs` (xp d'une offre : 1 par defaut) | 1 (20 offres de novice sur 44 donnent 2) |
| Village, points au hasard | `villager_brain.rs` (`village_sections`, `sections_to_village`, `closest_section`, `VillageBoundStroll`, `PlayTag`), `mobs/goals.rs` (`land_random_pos`, `default_random_pos_towards`, `random_direction_within`, `pick_best`), `mobs/nav.rs` (`stable_destination` : isSolidRender dessous) | 7 sections au plus ; 10 essais ; (10, 7), (20, 8), pi/2 |
| Malus de l'eau et des clotures | `horizon-client/src/mobs/path.rs` (`PathType::malus`, `check_neighbours`, `floor_level` : y + 0,5 dans l'eau pour qui flotte) | WATER et WATER_BORDER 8 ; FENCE -1 ; sniffer et strider : eau -1 (`mobs/sniffer.rs`, `mobs/strider.rs`) |
| Arbalete du pillard | `horizon-client/src/mobs/illager.rs` (`CrossbowAttack`, `charge_ticks`, `shoot_crossbow`), `game/creatures.rs` (son loading_end) | rayon 8, vitesses 1,0 / 0,5, chemin 20 + [0, 21[, charge 25, attente 20 + [0, 20[, fleche de base 2, 1,6, imprecision 14 - 4 x difficulte ; sons `item.crossbow.loading_start|loading_end|shoot` (presents dans sounds.json du kit) |
| Partie du dragon touchee | `EnderDragon.hurt(part)` (deja porte partie 18) ; parties de `contactsDragon` ; boite de contact + 0,3 des projectiles | tete 1 x 1, cou 3 x 3 (5,5 sur l'axe de la tete), corps 5 x 3, ailes 4 x 2 ; rayon du regard : longueur = regle `joueur.portee` (4,5, celle du lecteur) |

Explosions, feu, pantin (2026-11-18, `docs/SIMULATION.md` partie 23) :

| Ce qui est porte | Source Horizon (MIT) | Notre fichier |
|---|---|---|
| Ordre d'iteration d'un `HashMap` / `HashSet` de Java (hachage etale, doublement en deux moities, cases en arbre rouge-noir a 8 elements et 64 cases, racine en tete, nouvelle cle apres son parent, moitie de 6 elements ou moins redevenue liste) ; ordres de test imprimes par une JVM | `horizon-world/src/java_hash_map.rs` (et ses tests) | `src/moteur/ordre-java.js`, `test/explosion-feu-jeu.test.js` |
| `exploded_positions` (cellules d'air dans la liste, resistance max(bloc, fluide 100), plafond du crane bleu sauf `#wither_immune`), `Util.shuffle`, feu sur les cellules vides au-dessus d'un bloc `solid_render`, nombre de debris = taille de la liste ; `blast_hit` / `explosion_hurt_entities` pour les projectiles (`pushed_by_explosion`, `eye_height`), vehicules et supports d'armure ; `seen_percent` avec `clip_world` (Collider, sans fluides) | `horizon-client/src/game/explosion.rs`, `game/entity.rs`, `projectiles.rs` | `src/moteur/explosion.js` |
| `fire_tick`, `fire_check_burn_out`, `fire_near_rain`, `fire_ignite_odds_at` (ordre des tirages, infiniburn, pluie, biomes `increased_fire_burnout`, difficulte) | `horizon-world/src/level/tick.rs` | `src/moteur/familles/feu.js` |
| Fusees d'artifice (lancement d'un bloc, arbalete, distributeur, vol, contact, eclat et degats, Starter et etincelles du client, sons `_far`) | `horizon-client/src/game/fireworks.rs`, `crossbow.rs`, `dispenser.rs`, `horizon-client-render/src/particles.rs`, `horizon-items/src/firework.rs` | `src/moteur/fusees.js`, `src/film/effets-monde.js`, `src/film/entites-monde.js` |
| Charges de vent et rafale (TRIGGER_BLOCK, recul, blocs declenches, impulsion de chute), particules gust | `horizon-client/src/game/wind.rs`, `projectiles.rs`, `horizon-world/src/living_fall.rs`, `fall_damage.rs`, `particles.rs` | `src/moteur/vent.js`, `src/moteur/acteurs.js` |
| Cerveau du breeze (memoires a duree, tir, saut long, glissade, renvoi des projectiles) | `horizon-client/src/mobs/breeze.rs`, `mobs/monster_brain.rs`, `game/creatures.rs` | `src/moteur/ia-breeze.js`, `src/moteur/projectiles.js` |
| Parties du dragon de l'Ender (8 boites, `place_dragon_parts`) | `horizon-client/src/game/dragon.rs` | `src/moteur/ia-boss.js`, `src/moteur/projectiles.js` |


### Elytres, fiole d'experience, orbes, echelles, derniers ecarts (docs/SIMULATION.md partie 25, 2026-11-18)

Portage d'apres Horizon (MIT, lecture seule de `_ref/horizon`) ; nombres et geometrie relus dans les donnees du jeu 26.3 du lanceur (`items.json` : elytres `max_damage` 432, composant `glider` ; `entity-models.json` : `minecraft:elytra#main` ; `damage-tags.json` : `fly_into_wall` dans `#bypasses_armor` ; `equipment/elytra.json`). Aucun nombre ecrit de memoire : chaque formule vient des fichiers cites, le choix « elytres.auto au-dela de 2 blocs de chute » est le notre (dit comme tel).

| Ce qui est porte | Source Horizon | Ou dans le lecteur |
|---|---|---|
| Table de sinus de Mth (10430.378350470453, 65 536 flottants), DEG_TO_RAD 0x3c8efa35, `calculateViewVector` | `horizon-core/src/geometry/trig.rs`, `horizon-world/src/view_direction.rs` | `src/moteur/mth.js` |
| `updateFallFlyingMovement` (bits de la JVM gardes par le test d'Horizon), `handleFallFlyingCollisions`, `tryToStartFallFlying`, `updateFallFlying` (chute tenue, usure), fin un tick apres l'atterrissage, `isMovingSlowly` | `horizon-client/src/motion.rs`, `pose.rs` | `src/moteur/mth.js`, `src/moteur/acteurs.js` |
| Fusee accrochee (`follow_own_player`, `rocket_hand_angle`, degats du porteur) | `horizon-client/src/game/fireworks.rs` | `src/moteur/fusees.js`, `src/moteur/utilisation.js` |
| Pose du vol plane (`setupRotations` : bascule, `flyingYRot` ; tete -pi/4 ; `fly_speed_scale`) et `ElytraAnimation`, `WingsLayer` | `horizon-client/src/mobs/render.rs`, `mobs/anim.rs`, `mobs.rs`, `game/perspective.rs` | `src/film/acteurs-vivants.js`, `src/film/anim.js`, `src/objets/armure.js`, `src/objets/habillage.js` |
| `ElytraOnPlayerSoundInstance` (volume, fondu, hauteur) | `horizon-client-render/src/sound_engine.rs` | `src/film/sons-monde.js`, `src/film/sons.js` |
| Fiole d'experience (lancer, gravite 0,07, evenements 2002 / 1053, 3 + 2 x nextInt(5), `awardWithDirection`), distributeur | `horizon-client/src/game/potions.rs`, `game/xp_bottle_tests.rs`, `game/dispenser.rs`, `projectiles.rs` | `src/moteur/projectiles.js`, `src/moteur/familles/contenus.js` |
| Eclaboussure de potion (`potionSplashParticles`, `SpellParticle`, `set_power`), couleurs des effets | `horizon-client/src/game/level_particles.rs`, `horizon-client-render/src/particles.rs`, `horizon-client-core/src/potions.rs` | `src/film/effets-monde.js`, `src/moteur/projectiles.js` |
| Ordre des projectiles jetes (gravite puis traine 0,99F / 0,8F avant le deplacement) | `horizon-client/src/projectiles.rs` | `src/moteur/projectiles.js` |
| `ExperienceOrb.tick` (eau, lave, suivi, frottement, rebond 0,4, fusion), `tryMergeToExisting`, `Experience.give` et son de niveau | `horizon-client/src/entities.rs`, `game/item_entities.rs` | `src/moteur/entites.js` |
| Echelles : `climbable_velocity`, montee de 0,2, `onClimbable` | `horizon-client/src/mobs/living.rs`, `horizon-world/src/climbing.rs` | `src/moteur/acteurs.js`, `src/moteur/navigation.js` |
| Chaudrons sous la pluie et la neige (0,05 / 0,1), glace qui fond | `horizon-world/src/level/tick.rs` | `src/moteur/meteo.js`, `src/moteur/familles/meteo.js` |
| Face du dessous des boites (sens de la texture) : verifiee sur `entity-models.json` | donnees du jeu | `src/perso/modele.js` |
| Rails (`RailState`, pente, virage, rails de propulsion et declencheurs a 8 rails, detecteur 20 ticks), fil piege et crochets (`calculateState`, 41 cases, sons) | `horizon-world/src/level/rails.rs`, `level/hooks.rs`, `level/place.rs`, `level/shapes.rs`, `level/survive.rs`, `level/tick.rs` | `src/moteur/familles/rails.js` |
| Wagonnets (`OldMinecartBehavior` : rails, pentes, freins, propulsion, sortie de voie, poussees, ramassage des creatures, coffre, entonnoir, four, TNT), bateaux (`floatBoat`, statut, pagaie, colonnes de bulles), ancien rendu du wagonnet sur sa voie, son de roulement | `horizon-client/src/game/minecarts.rs`, `game/boats.rs`, `game/entity.rs`, `horizon-client-render/src/sound_engine.rs` | `src/moteur/vehicules.js`, `src/creatures/rendu.js`, `src/film/acteurs-vivants.js`, `src/film/sons-monde.js` |
| Colonnes de bulles (`updateColumn`, poussee dedans et a la surface, particules et sons d'ambiance), paratonnerre (`findLightningRod`, 8 ticks, etincelles 3002), pupitre (signal du comparateur, impulsion de page), balise (sections du faisceau, pyramide, effets, `BeaconRenderer`) | `horizon-world/src/level/{tick,shapes}.rs`, `horizon-client/src/motion/fluids.rs`, `game/lightning.rs`, `game/books.rs`, `game/beacon.rs`, `game/level_particles.rs`, `horizon-client-render/src/{block_entity_render,particles}.rs`, `horizon-client/src/animate_tick.rs` | `src/moteur/familles/machines.js`, `src/film/machines-rendu.js`, `src/film/effets-monde.js` |
| Cadres (interaction, rotation, comparateur, rendu `fixed`, cadre lumineux), livre du pupitre (`LecternRenderer`, `BookModel.setupAnim`) | `horizon-client/src/game/frames.rs`, `horizon-client-render/src/block_entity_render.rs` | `src/moteur/familles/cadres.js`, `src/film/machines-rendu.js` |
| Pistons et entites (`moveCollidedEntities`, `moveStuckEntities`, `fixEntityWithinPistonBase`, `limitPistonMovement`, rebond du slime), couronne des formes debordantes (`BlockCollisions`) | `horizon-world/src/piston_push.rs`, `piston_movement.rs`, `horizon-client/src/game/piston_push.rs` | `src/moteur/familles/pistons.js`, `src/moteur/simulation.js`, `src/moteur/collision.js` |
| Fours rapides (`fast_cooking`, fournisseurs `cooking/*`, `total_time`, reprise du progres), experience des recettes ; `Containers.dropContents` ; coffre double (`CompoundContainer`, moitie droite d'abord) et son modele (`double_chest_left/right`) | `horizon-client/src/furnace.rs`, `horizon-client-render/src/providers.rs`, `horizon-world/src/level/removal.rs`, `horizon-client/src/game/{machines,storage}.rs`, `entity-models.json` du jeu | `src/moteur/four.js`, `src/moteur/contenus.js`, `src/moteur/familles/contenus.js`, `src/film/effets-monde.js`, `outils/extraire-donnees-jeu.mjs` |
| Caracteristiques d'arbres du jeu lues dans le kit (TreeFeature : troncs droit, fourchu, geant, acajou geant, chene noir, majestueux, courbe, paletuvier, cerisier, peuplier ; feuillages boule, majestueux, buisson, acacia, sapin, pin, pin geant, jungle, chene noir, epars, cerisier, peuplier ; racines du paletuvier ; decorations lianes, cacao, ruche, sol modifie, attaches, coeur de grinceur, mousse pale, au sol, champignons d'etagere ; minimum_size, distances des feuilles, formes aux bords), fournisseurs d'etats et de valeurs, predicats de blocs, champignons geants | horizon-world/src/worldgen/tree.rs, 	ree/{trunk,foliage,decorator}.rs, 	ree_blocks.rs, state_provider.rs, alue_provider.rs, egetation.rs | src/moteur/caracteristiques.js |
| TreeGrower (listes, carre de 2 x 2, fleurs, canGrow, hauteur minimale), MushroomBlock.growMushroom, ticks aleatoires des tiges, champignons, lianes, plantes a tete, propagules ; farine d'os (tiges, champignons, pousses, azalee, plantes a tete, lianes des cavernes, lichen MultifaceSpreader, terre racinee, feuilles de paletuvier) | horizon-world/src/level/growth.rs, level/tick.rs, level/bonemeal.rs, level/survive.rs | src/moteur/arbres.js, src/moteur/familles/croissance.js |
| Recherche de chemin du jeu (PathFinder, tas binaire, WalkNodeEvaluator, SwimNodeEvaluator, FlyNodeEvaluator, AmphibiousNodeEvaluator, types et malus), indSurfacePosition, accuracy des buts | horizon-client/src/mobs/path.rs, mobs/nav.rs, mobs/goals.rs | src/moteur/chemins.js, src/moteur/navigation.js |
| Temperature des biomes (SimplexNoise 26.3, pile du bruit gele, getHeightAdjustedTemperature, FROZEN) ; sky_light_level et couches de meteo (weather_maps) ; faces d'occlusion de la lumiere (aceShapeOccludes) ; table de lumiere (vision nocturne, assombrissement des boss, End) ; ciel de l'End et ses eclairs (uildEndSky, EndFlashState, son directionnel) | horizon-world/src/worldgen/biome_temperature.rs, horizon-core/src/noise/{mod,simplex,stack}.rs, horizon-world/src/environment_system.rs, horizon-client-render/src/environment.rs, light.rs, gfx.rs, gfx/end_sky.rs, horizon-client/src/game/end.rs, game/sculk.rs, game/bossbars.rs | src/moteur/temperature.js, src/moteur/environnement.js, src/moteur/monde.js, src/moteur/lumiere.js, src/rendu/ciel-vanille.js, src/rendu/raster.js, src/film/lumiere-vue.js, src/film/sons-monde.js |
| Orage (	ickThunder, indLightningTargetAround, indLightningRod), difficulte locale (DifficultyInstance), piege du cheval squelette (SkeletonTrapGoal, cavaliers, enchantement mob_spawn_equipment) ; vol plane des creatures (updateFallFlying d'un mob, WingsLayer) | horizon-client/src/game/lightning.rs, mobs/spawning.rs, game/passengers.rs, game/mob_gear.rs, mobs/ai_glide.rs | src/moteur/meteo.js, src/moteur/acteurs.js, src/creatures/rendu.js, src/creatures/anim.js |
| Particules d'ambiance des blocs (`ClientLevel.animateTick` : 667 + 667 cellules par tick, `Block.animateTick` de toutes les familles, `FluidState.animateTick`, `trySpawnDripParticles`, particules d'ambiance des biomes, fumees des feux de camp) et moteur de particules (constructeurs `Particle`/`SingleQuadParticle`, `BaseAshSmokeParticle`, `RisingParticle`, `LavaParticle`, `DripParticle`, `SuspendedParticle`, `PortalParticle`, `FlyTowardsPositionParticle`, `SuspendedTownParticle`, `CampfireSmokeParticle`, `DustParticle`, `DustColorTransitionParticle`, `SimpleAnimatedParticle`, `FallingLeavesParticle`, `FallingDustParticle`, `GlowParticle`, `FireflyParticle`, bulles ; tailles selon l'age, lumiere d'emission) | `horizon-client/src/animate_tick.rs`, `horizon-client-render/src/particles.rs`, `particles/simple.rs` ; ensembles de sprites : `assets/minecraft/particles/*.json` du jeu (noms seulement) | `src/film/ambiance-blocs.js` |
| Teinte des particules de casse (`TerrainParticle` : 0,6 x `BlockColors`, sauf l'herbe) | `horizon-client-render/src/particles.rs` (`Particle::terrain`) | `src/film/effets-monde.js`, `src/rendu/scene.js` |
| Modele du coffre et du coffre double (faces et uv du `ModelPart.Cube` de Java, face interne absente), bannieres (`banner_parts`, ondulation du drapeau, couches teintes), clignotement du TNT amorce (`submitWhiteSolidBlock`, `block_state`) | `horizon-client-render/src/block_entity_render.rs`, `entity-models.json` du jeu (compare en test) | `src/film/effets-monde.js`, `src/film/bannieres.js`, `src/film/entites-monde.js` |
| Surcouche du jeu (`OverlayTexture` : rouge 0xB2FF0000 melange par `entity.fsh`, rangee blanche, `getOverlayCoords`, armure sans surcouche) | `horizon-client-render/src/overlay.rs`, `horizon-client/src/mobs/render.rs` | `src/perso/modele.js`, `src/creatures/rendu.js`, `src/objets/habillage.js`, `src/rendu/raster.js` |
| Proprietes des modeles d'objets (`using_item`, `use_duration`, `crossbow/pull`, `charge_type`, `compass` / `CompassAngleState`, `time` / `ClockTime`), cuir teint (`DyedItemColor`, calque `overlay`) | `horizon-assets/src/item_model.rs` | `src/objets/definition.js`, `src/objets/etat-objet.js`, `src/objets/armure.js`, `src/creatures/rendu.js` |
| Eclair (`LightningBoltRenderer` : 0,45 0,45 0,5, opacite 0,3, `RenderType.lightning` ajoute), brume de pluie (`AtmosphericFogEnvironment.updateRainFogState`, `rainFogMultiplier`), astres sous la pluie (alpha 1 - pluie) | `horizon-client-render/src/fog.rs`, `environment.rs`, `gfx/lightning.rs`, `horizon-client/src/game/render_tick.rs` | `src/film/meteo-rendu.js`, `src/rendu/scene.js`, `src/rendu/raster.js`, `src/film/video.js` |
| Trace tick a tick de la redstone et des pistons (banc d'essai `World` des tests de niveau, `set_block`, `use_without_item`, `full_tick`) : 52 scenarios rejoues par Horizon et compares a notre moteur ; heure du jeu des ticks planifies (`tickTime` apres les commandes) ; composteur (`ComposterBlock.onPlace` / `tick`) | `horizon-world/src/level/tests.rs` (copie hors de `_ref`), `level/tick.rs` | `outils/trace-horizon/`, `test/trace-horizon.test.js`, `src/moteur/simulation.js`, `src/moteur/familles/contenus.js` |
| Tapis de vegetation (`VegetationPatchFeature`), `SimpleBlockFeature` (plantes doubles, tapis de mousse pale `MossyCarpetBlock.placeAt`) ; traceur de chemins de developpement (outils/trace-chemins : `path.rs` compile a part, non livre) | `horizon-world/src/worldgen/vegetation.rs`, `worldgen/simple_block.rs`, `block_placement.rs`, `horizon-client/src/mobs/path.rs` | `src/moteur/caracteristiques.js`, `test/trace-chemins.test.js` |
| Enchantements pilotes par les donnees (LevelBasedValue, effets de valeur, conditions, effets d'entite, attributs, `post_attack`, `hit_block`, `tick`, `location_changed`), table d'enchantement (cout, selection, etageres), enclume (`AnvilMenu.createResult`), mots de l'alphabet galactique (`EnchantmentNames`, liste relue dans la classe du JAR 26.3) | `horizon-client/src/game/enchant.rs`, `game/stations.rs` | `src/moteur/enchantements.js`, `src/moteur/inventaire.js`, `src/moteur/objets-actes.js`, `src/incrust/elements.js` |
| Faim (`FoodData` : epuisement, saturation, regeneration, famine, quantites de course, saut, nage, coup, minage, degats), effets de potion (intervalles, instantanes, absorption, sante en plus, vision, nausee), table des potions, alambic (`BrewingStandBlockEntity.serverTick`, 400 ticks, poudre), nuage persistant | `horizon-client/src/game/food.rs`, `game/effects.rs`, `game/potions.rs`, `game/brewing.rs` | `src/moteur/effets.js`, `src/moteur/potions.js`, `src/moteur/alambic.js`, `src/moteur/nuage.js`, `src/film/vue-effets.js` |
| Peche (`FishingHook` : lancer, attente, morsure, ramener, tirer une entite, tables de butin), trident (Loyaute, Impulsion, Canalisation, `SpinAttackEffectLayer`, pose `SPIN_ATTACK`), masse (ecrasement, recul, Densite, Brise, Rafale), butin des tables (`set_count`, `enchant_with_levels`, `enchant_randomly`, conditions) | `horizon-client/src/game/fishing.rs`, `game/trident.rs`, `game/mace.rs`, `game/loot/items.rs`, `game/perspective.rs`, `mobs/render.rs` | `src/moteur/peche.js`, `src/moteur/utilisation.js`, `src/moteur/projectiles.js`, `src/moteur/butin-jeu.js`, `src/film/entites-monde.js`, `src/film/acteurs-vivants.js` |
| Reflet des objets enchantes (glint : vitesse 0,5, force 0,75, ajout du carre, echelle 8 sur l'atlas, 0,16 sur l'armure, rotation 10 degres) | `horizon-client-render/src/entity.wgsl`, `hud/cit_glint.rs`, `options_file.rs`, `item_render/glint_tests.rs` | `src/objets/reflet.js`, `src/objets/habillage.js` |
| Ecrans des postes (cases de `inventory_slots.rs` et `stations.rs`, titres `title_pos`, "Inventory" a (8, 72), bouton du livre de recettes, icones fantomes), livre de la table d'enchantement (`enchanting_book_pose`, `book_pose`, `EnchantBook`), joueur de l'inventaire (`draw_player_preview`, lumieres ENTITY_IN_UI) | `horizon-client/src/game/inventory_slots.rs`, `game/stations.rs`, `game/recipe_book.rs`, `game.rs`, `item_render/gui.rs`, `item_render/special.rs`, `game/perspective.rs` | `src/incrust/elements.js`, `src/incrust/livre-enchant.js`, `src/incrust/apercu-joueur.js` |
