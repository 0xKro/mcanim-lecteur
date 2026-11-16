"""Uniforms standard du jeu (liste documentee Iris/OptiFine) calcules depuis NOTRE scene.

`construire(etat, reglages)` -> dict nom -> valeur. Types : float, int, tuple (vec2/3/4, ivec2), liste de 16 (mat4).
`TABLE` = la liste de contrôle : (nom, statut, remarque) avec statut = "fait" | "valeur fixe" | "non géré". C'est elle que reprend docs/SHADERS-REELS.md.
"""
import math

from . import matrices as M

# ordre : nom, statut, remarque
TABLE = [
    ("gbufferModelView / gbufferModelViewInverse", "fait", "Rx(tangage) * Ry(lacet+180), camera a l'origine"),
    ("gbufferProjection / gbufferProjectionInverse", "fait", "perspective, near 0,05, far = 256 (16 chunks)"),
    ("gbufferPreviousModelView / gbufferPreviousProjection", "fait", "matrices de l'image d'avant (M7) ; egales a l'image courante apres une coupure de camera ou a la premiere image"),
    ("shadowModelView / shadowModelViewInverse", "fait", "formules d'Iris (rotX 90, rotZ -angle, rotX sunPathRotation, pas d'intervalle)"),
    ("shadowProjection / shadowProjectionInverse", "fait", "ortho +-shadowDistance, plans -100,05 / 156"),
    ("cameraPosition / previousCameraPosition", "fait", "previous = camera de l'image d'avant (M7)"),
    ("cameraPositionFract / cameraPositionInt", "fait", ""),
    ("sunPosition / moonPosition / shadowLightPosition / upPosition", "fait", "espace vue, longueur 100 ; sunPathRotation du pack"),
    ("sunAngle / shadowAngle", "fait", "angle du ciel du jeu (courbe adoucie comme le jeu) : 0,25 midi, 0,75 minuit, 0,0344 a 6 h, 0,4656 a 18 h ; shadowAngle = sunAngle la nuit - 0,5"),
    ("worldTime / worldDay / moonPhase", "fait", "heure -> ticks ((h-6) mod 24 x 1000) : 6 h = 0, midi = 6000, 18 h = 12000, minuit = 18000 ; worldDay et moonPhase (jour % 8) viennent de `ciel.jour`"),
    ("frameTimeCounter / frameTime / frameCounter", "fait", "temps de la scene (fige pendant `gel`), 1/30 s, compteur d'images continu (chauffe comprise) : le TAA du pack s'en sert"),
    ("viewWidth / viewHeight / aspectRatio / near / far", "fait", ""),
    ("skyColor / fogColor", "fait", "couleurs du ciel du jeu (ciel-vanille.js) a l'heure donnee"),
    ("rainStrength / thunderStrength / wetness", "valeur fixe", "0 (pas de meteo) ; M6"),
    ("isEyeInWater / eyeAltitude", "fait", "isEyeInWater 0 sauf sous l'eau"),
    ("eyeBrightness / eyeBrightnessSmooth", "fait", "lumiere du bloc et du ciel a la camera x 16"),
    ("blindness / nightVision / darknessFactor / darknessLightFactor", "valeur fixe", "0"),
    ("screenBrightness / hideGUI / playerMood", "valeur fixe", "0,5 / 1 / 0"),
    ("centerDepthSmooth", "fait", "profondeur au centre de l'image precedente (= courante)"),
    ("fogMode / fogDensity / fogStart / fogEnd / fogShape", "valeur fixe", "brume lineaire du jeu : debut 0,8 x far, fin far"),
    ("alphaTestRef", "fait", "selon `alphaTest.<programme>` (0,1 par defaut)"),
    ("entityColor / entityId / blockEntityId / currentRenderedItemId", "fait", "entityId du joueur (entity.properties), entityColor a 0 ; blockEntityId / currentRenderedItemId a 0"),
    ("heldItemId / heldItemId2 / heldBlockLightValue / heldBlockLightValue2", "valeur fixe", "0"),
    ("atlasSize / blendFunc / renderStage / dimension", "fait", "renderStage mis par passe (MC_RENDER_STAGE_*)"),
    ("biome / biome_category / biome_precipitation / temperature / rainfall", "valeur fixe", "biome plaines/foret ; M6"),
    ("lightningBoltPosition / currentPlayerHealth / is_hurt / is_alive ... (etat du joueur)", "valeur fixe", "joueur en pleine forme"),
    ("velocity / cameraMovement", "valeur fixe", "0"),
    ("textures : colortex0-15, gcolor, gdepth, gaux1-4, depthtex0-2, shadowtex0/1(+HW), shadowcolor0/1, noisetex, tex/texture/gtexture, lightmap, normals, specular", "fait", "specular/normals : defauts plats"),
    ("images (image2D, compute) / SSBO", "non géré", "LPV desactive par defaut dans Bliss ; hors perimetre"),
    ("uniforms de Distant Horizons (dh*)", "non géré", "hors perimetre"),
    ("uniforms personnalises (uniform.* de shaders.properties)", "fait", "interprete d'expressions : expr.py ; `smooth` donne la cible (image fixe)"),
]

FAR = 256.0
NEAR = 0.05


def angle_ciel_vers_fraction(angle_deg):
    """Angle du soleil du jeu (degres, 0 a midi) -> sunAngle d'Iris (0 au lever, 0,25 a midi)."""
    return ((angle_deg + 90.0) % 360.0) / 360.0


def construire(e, r):
    """e : etat de l'image (envoye par Node). r : reglages du pack {sunPathRotation, shadowDistance, ...}. Retourne (uniforms, matrices_expr)."""
    W, H = e["largeur"], e["hauteur"]
    cam = e["camera"]
    ticks = e.get("ticks", ((e.get("heure", 12.0) - 6.0) % 24.0) * 1000.0)
    angle = e.get("angleSoleil", 0.0)    # degres, 0 = midi (convention du jeu)
    tilt = r.get("sunPathRotation", 0.0)
    vue = M.vue_camera(cam.get("lacet", 0.0), cam.get("tangage", 0.0))
    proj = M.perspective(cam.get("fov", 70.0), W / H, NEAR, FAR)
    u = {}
    u["gbufferModelView"] = vue
    u["gbufferModelViewInverse"] = M.inverse(vue)
    u["gbufferProjection"] = proj
    u["gbufferProjectionInverse"] = M.inverse(proj)
    prec = e.get("precedent")      # image d'avant ({camera, vue, proj}) ; absente a la premiere image et apres une coupure
    u["gbufferPreviousModelView"] = prec["vue"] if prec else vue
    u["gbufferPreviousProjection"] = prec["proj"] if prec else proj
    cp = (float(cam["x"]), float(cam["y"]), float(cam["z"]))
    pc = prec["camera"] if prec else cam
    pcp = (float(pc["x"]), float(pc["y"]), float(pc["z"]))
    u["cameraPosition"] = cp
    u["previousCameraPosition"] = pcp
    u["cameraPositionFract"] = tuple(c - math.floor(c) for c in cp)
    u["cameraPositionInt"] = tuple(int(math.floor(c)) for c in cp)
    u["previousCameraPositionFract"] = tuple(c - math.floor(c) for c in pcp)
    u["previousCameraPositionInt"] = tuple(int(math.floor(c)) for c in pcp)
    u["cameraMovement"] = tuple(a - b for a, b in zip(cp, pcp))
    u["eyePosition"] = cp
    # astres : View * Ry(-90) * Rz(tilt) * Rx(angle) * (0,100,0)  (moitie d'ajustement mesure sur Iris par Horizon)
    base = M.mul(vue, M.rot_y(-90.0))

    def astre(a):
        m = M.mul(M.mul(base, M.rot_z(tilt)), M.rot_x(a))
        v = M.mul_vec(m, [0.0, 100.0, 0.0, 0.0])
        return tuple(0.0 if abs(c) < 1e-6 else c for c in v[:3])   # zero exact comme en flottants (evite un signe aleatoire a midi)
    u["sunPosition"] = astre(angle)
    u["moonPosition"] = astre(angle + 180.0)
    v = M.mul_vec(base, [0.0, 100.0, 0.0, 0.0])
    u["upPosition"] = (v[0], v[1], v[2])
    sun_frac = angle_ciel_vers_fraction(angle)
    jour = sun_frac < 0.5
    u["sunAngle"] = sun_frac
    shadow_angle = sun_frac if jour else (angle_ciel_vers_fraction(angle + 180.0) % 1.0)
    u["shadowAngle"] = shadow_angle
    u["shadowLightPosition"] = u["sunPosition"] if jour else u["moonPosition"]
    # ombre
    deg = (shadow_angle - 0.25) * 360.0
    if deg < 0:
        deg += 360.0
    sm = M.mul(M.mul(M.rot_x(90.0), M.rot_z(-deg)), M.rot_x(tilt))
    u["shadowModelView"] = sm
    u["shadowModelViewInverse"] = M.inverse(sm)
    d = r.get("shadowDistance", 128.0)
    sp = M.ortho(d, -100.05, 156.0)
    u["shadowProjection"] = sp
    u["shadowProjectionInverse"] = M.inverse(sp)
    # temps
    u["worldTime"] = int(ticks) % 24000
    u["worldDay"] = int(e.get("jourMonde", e.get("jour", 0)))
    u["moonPhase"] = int(e.get("jour", 0)) % 8
    u["frameTimeCounter"] = float(e.get("temps", 0.0))
    u["frameTime"] = float(e.get("dt", 1.0 / 30.0))
    u["frameCounter"] = int(e.get("frame", 0))
    u["viewWidth"] = float(W)
    u["viewHeight"] = float(H)
    u["aspectRatio"] = W / H
    u["near"] = NEAR
    u["far"] = FAR
    u["skyColor"] = tuple(e.get("ciel", (0.47, 0.65, 1.0)))
    u["fogColor"] = tuple(e.get("brume", (0.75, 0.85, 1.0)))
    u["rainStrength"] = float(e.get("pluie", 0.0))
    u["thunderStrength"] = 0.0
    u["wetness"] = 0.0
    u["isEyeInWater"] = int(e.get("sousEau", 0))
    u["eyeAltitude"] = cp[1]
    lb = e.get("luminosite", (0.0, 15.0))
    eb = (int(lb[0] * 16), int(lb[1] * 16))
    u["eyeBrightness"] = eb
    u["eyeBrightnessSmooth"] = eb
    u["blindness"] = 0.0
    u["nightVision"] = 0.0
    u["darknessFactor"] = 0.0
    u["darknessLightFactor"] = 0.0
    u["screenBrightness"] = 0.5
    u["hideGUI"] = 1
    u["playerMood"] = 0.0
    u["centerDepthSmooth"] = float(e.get("profondeurCentre", 0.5))
    u["fogMode"] = 9729
    u["fogDensity"] = 0.1
    u["fogStart"] = FAR * 0.8
    u["fogEnd"] = FAR
    u["fogShape"] = 0
    u["alphaTestRef"] = 0.1
    u["entityColor"] = (0.0, 0.0, 0.0, 0.0)
    u["entityId"] = 0
    u["blockEntityId"] = 0
    u["currentRenderedItemId"] = 0
    u["heldItemId"] = 0
    u["heldItemId2"] = 0
    u["heldBlockLightValue"] = 0
    u["heldBlockLightValue2"] = 0
    u["atlasSize"] = tuple(e.get("atlas", (1024, 1024)))
    u["blendFunc"] = (0, 0, 0, 0)
    u["renderStage"] = 0
    u["dimension"] = 0
    u["biome"] = 4              # forest
    u["biome_category"] = 4
    u["biome_precipitation"] = 1
    u["temperature"] = 0.7
    u["rainfall"] = 0.8
    u["lightningBoltPosition"] = (0.0, 0.0, 0.0, 0.0)
    u["currentPlayerHealth"] = 1.0
    u["maxPlayerHealth"] = 20.0
    u["currentPlayerHunger"] = 1.0
    u["currentPlayerArmor"] = 0.0
    u["currentPlayerAir"] = 1.0
    u["maxPlayerAir"] = 300.0
    for b in ("is_hurt", "is_burning", "is_sneaking", "is_sprinting", "is_invisible", "is_in_lava", "is_in_water", "is_on_ground", "is_riding"):
        u[b] = 0
    u["is_alive"] = 1
    u["is_on_ground"] = 1
    u["velocity"] = (0.0, 0.0, 0.0)
    u["texelSizeBuiltin"] = (1.0 / W, 1.0 / H)
    u["invViewWidth"] = 1.0 / W
    u["invViewHeight"] = 1.0 / H
    u["isOutdoors"] = 1
    u["MC_MIPMAP_LEVEL"] = 4
    u["dhNearPlane"] = NEAR
    u["dhFarPlane"] = FAR
    u["dhRenderDistance"] = 0
    # environnement des expressions : matrices en colonnes
    env = {}
    for k, v in u.items():
        if isinstance(v, list) and len(v) == 16:
            env[k] = M.colonnes(v)
        elif isinstance(v, bool):
            env[k] = float(v)
        else:
            env[k] = v
    return u, env


def heure_vers_ticks(heure):
    return ((heure - 6.0) % 24.0) * 1000.0
