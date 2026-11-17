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
