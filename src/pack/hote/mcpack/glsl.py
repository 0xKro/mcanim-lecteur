"""Couche de compatibilite GLSL : #include, #define du jeu, options, reecritures de source.

On compile avec un contexte OpenGL "compatibilite" (Mesa llvmpipe donne GL 4.5 compat) : les mots du vieux GLSL
(`gl_Vertex`, `gl_ModelViewMatrix`, `ftransform()`, `gl_FragData`, `texture2D`, `varying`) marchent tels quels, sans les reecrire.
On reecrit seulement ce que le compilateur de Mesa refuse (voir REECRITURES) et la ligne `#version`.
"""
import re

MACROS_JEU = {
    "MC_VERSION": "12100", "MC_GL_VERSION": "450", "MC_GLSL_VERSION": "450", "MC_RENDER_QUALITY": "1.0", "MC_SHADOW_QUALITY": "1.0",
    "MC_HAND_DEPTH": "0.125", "MC_OS_LINUX": "", "MC_GL_VENDOR_MESA": "", "MC_GL_RENDERER_LLVMPIPE": "", "IS_IRIS": "",
    "IRIS_VERSION": "11007", "MC_NORMAL_MAP": "", "MC_SPECULAR_MAP": "", "MC_ANISOTROPIC_FILTERING": "1", "MC_FXAA_LEVEL": "0",
    "MC_MIPMAP_LEVEL": "4", "MAX_COLOR_BUFFERS": "16",
    "IRIS_FEATURE_BLOCK_EMISSION_ATTRIBUTE": "", "IRIS_FEATURE_CUSTOM_IMAGES": "", "IRIS_FEATURE_COMPUTE_SHADERS": "",
    "IRIS_FEATURE_ENTITY_TRANSLUCENT": "", "IRIS_FEATURE_REVERSED_CULLING": "", "IRIS_FEATURE_SEPARATE_HARDWARE_SAMPLERS": "",
}
ETAPES_RENDU = ["NONE", "SKY", "SUNSET", "CUSTOM_SKY", "SUN", "MOON", "STARS", "VOID", "TERRAIN_SOLID", "TERRAIN_CUTOUT_MIPPED", "TERRAIN_CUTOUT",
                "ENTITIES", "BLOCK_ENTITIES", "DESTROY", "OUTLINE", "DEBUG", "HAND_SOLID", "TERRAIN_TRANSLUCENT", "TRIPWIRE", "PARTICLES", "CLOUDS",
                "RAIN_SNOW", "WORLD_BORDER", "HAND_TRANSLUCENT"]
for _i, _n in enumerate(ETAPES_RENDU):
    MACROS_JEU["MC_RENDER_STAGE_" + _n] = str(_i)
for _i, _n in enumerate(["UNKNOWN", "LEAVES", "STONE", "WOOD", "METAL", "DIRT", "LAVA", "DEEPSLATE", "SNOW", "SAND", "TERRACOTTA", "NETHER_STONE",
                         "WATER", "GRASS", "AIR", "ILLUMINATED"]):
    MACROS_JEU["DH_BLOCK_" + _n] = str(_i)

# (motif, remplacement, explication) : ce que Mesa refuse alors que le jeu l'accepte
REECRITURES = [
    (re.compile(r"\bflat\s+varying\b"), "@FLAT@", "flat varying : mot de GLSL moderne dans un fichier 120"),
    (re.compile(r"\btexture2DGradARB\b"), "textureGrad", "extension ARB non annoncee par Mesa"),
    (re.compile(r"\btexture2DLodARB\b"), "textureLod", "idem"),
    (re.compile(r"\btexture2DGrad\b"), "textureGrad", "texture2DGrad absent sous 330"),
]

# `flat out vec2 x;` ou `varying float x;` dans un vertex shader (apres reecriture)
RE_SORTIE_VERT = re.compile(r"^[ \t]*(?:flat[ \t]+out|out|varying)[ \t]+(?:(?:highp|mediump|lowp)[ \t]+)?(float|vec[234]|int|ivec[234]|uint|bool)[ \t]+([A-Za-z_]\w*)[ \t]*;", re.M)
RE_MAIN = re.compile(r"\bvoid[ \t]+main[ \t]*\([ \t]*(?:void)?[ \t]*\)\s*\{")


def mettre_a_zero_sorties_non_ecrites(corps):
    """Un `varying` declare mais jamais ecrit par le vertex shader (Bliss : `tempOffsets`) vaut ce qu'il veut avec Mesa (valeur au hasard,
    souvent enorme) ; un pilote de carte graphique donne en general 0 et le pack s'y fie. On l'ecrit a zero au debut de main()."""
    m = RE_MAIN.search(corps)
    if not m:
        return corps
    ajouts = []
    for d in RE_SORTIE_VERT.finditer(corps):
        typ, nom = d.group(1), d.group(2)
        if re.search(r"\b" + re.escape(nom) + r"\b[ \t]*(?:\.\w+|\[[^\]]*\])?[ \t]*(?:[-+*/])?=(?!=)", corps):
            continue
        zero = "false" if typ == "bool" else "%s(0)" % typ if typ[0] in "iu" else "%s(0.0)" % typ
        ajouts.append("%s = %s;" % (nom, zero))
    if not ajouts:
        return corps
    return corps[:m.end()] + " " + " ".join(ajouts) + " " + corps[m.end():]


def mettre_a_zero_sorties_fragment(corps):
    """`gl_FragData[i]` jamais ecrit par un fragment shader (Bliss : `gbuffers_weather` n'ecrit que `gl_FragData[1]` quand WEATHER est defini, alors que
    DRAWBUFFERS vaut 29) : un pilote de carte graphique laisse en pratique la cible intacte (alpha 0 avec le melange du pack), Mesa llvmpipe ecrit une
    valeur au hasard (la pluie devenait une grille de points sombres). On met a zero, au debut de main(), chaque `gl_FragData[i]` cite par le code."""
    m = RE_MAIN.search(corps)
    if not m:
        return corps
    indices = sorted({int(i) for i in re.findall(r"\bgl_FragData\[\s*(\d+)\s*\]", corps)})
    if not indices:
        return corps
    zero = " ".join("gl_FragData[%d] = vec4(0.0);" % i for i in indices)
    return corps[:m.end()] + " " + zero + " " + corps[m.end():]


RE_INCLUDE = re.compile(r'^[ \t]*#[ \t]*include[ \t]+"([^"]+)"[^\n]*$', re.M)
RE_CONST_FORMAT = re.compile(r"^[ \t]*const[ \t]+int[ \t]+\w+Format[ \t]*=[^;\n]*;", re.M)
RE_VERSION = re.compile(r"^[ \t]*#[ \t]*version[ \t]+(\d+)[ \t]*(\w*)[ \t]*$", re.M)


class ErreurInclusion(Exception):
    pass


def resoudre_inclusions(src, chemin, lire, profondeur=0, vus=None):
    """Remplace chaque `#include "x"` par le fichier (chemin absolu `/dossier/f` = racine du dossier shaders ; sinon relatif au fichier courant)."""
    if profondeur > 24:
        raise ErreurInclusion("#include trop profond : " + chemin)

    def rep(m):
        nom = m.group(1)
        if nom.startswith("/"):
            cible = nom.lstrip("/")
        else:
            base = chemin.rsplit("/", 1)[0] if "/" in chemin else ""
            cible = _normaliser((base + "/" + nom) if base else nom)
        sous = lire(cible)
        if sous is None:
            raise ErreurInclusion("#include introuvable : %s (depuis %s)" % (nom, chemin))
        return "\n" + resoudre_inclusions(sous, cible, lire, profondeur + 1) + "\n"
    return RE_INCLUDE.sub(rep, src)


def _normaliser(p):
    out = []
    for part in p.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if out:
                out.pop()
        else:
            out.append(part)
    return "/".join(out)


def appliquer_options(src, surcharges):
    """Change la valeur des options (#define NOM valeur) : `True`/`False` active/desactive un `#define NOM` ; sinon met la valeur."""
    for nom, val in surcharges.items():
        motif = re.compile(r"^([ \t]*)(//[ \t]*)?#define[ \t]+" + re.escape(nom) + r"\b([^\n]*)$", re.M)

        def rep(m, nom=nom, val=val):
            indent, reste = m.group(1), m.group(3)
            comm = ""
            mc = re.search(r"//.*$", reste)
            if mc:
                comm, reste = " " + mc.group(0), reste[:mc.start()]
            if val is False:
                return "%s//#define %s%s%s" % (indent, nom, reste, comm)
            if val is True:
                return "%s#define %s%s%s" % (indent, nom, reste if reste.strip() else "", comm)
            return "%s#define %s %s%s" % (indent, nom, val, comm)
        src, n = motif.subn(rep, src)
        if n == 0 and val not in (True, False):
            # `const float sunPathRotation = -35;` : reglage ecrit comme une constante
            mc = re.compile(r"^([ \t]*const[ \t]+(?:float|int|bool)[ \t]+" + re.escape(nom) + r"[ \t]*=[ \t]*)[^;\n]+;", re.M)
            src = mc.sub(lambda m: "%s%s;" % (m.group(1), val), src)
    return src


def version_et_corps(src):
    """Retire toutes les lignes #version (garde la premiere) ; retourne (numero, profil, corps)."""
    ver = None
    for m in RE_VERSION.finditer(src):
        if ver is None:
            ver = (int(m.group(1)), m.group(2))
    corps = RE_VERSION.sub("", src)
    return ver or (110, ""), corps


def construire(src, chemin, lire, macros_jeu, etape, surcharges=None, macros_extra=None, extensions=None, neutraliser=True):
    """Source GLSL complete prete pour glShaderSource. etape : 'vert' | 'frag' | 'comp'."""
    brut = resoudre_inclusions(src, chemin, lire)
    if surcharges:
        brut = appliquer_options(brut, surcharges)
    (num, profil), corps = version_et_corps(brut)
    if etape == "comp":
        entete = "#version %d compatibility\n" % max(430, num)
    else:
        entete = "#version 330 compatibility\n" if num < 150 else "#version %d compatibility\n" % num
    defs = dict(macros_jeu)
    if macros_extra:
        defs.update(macros_extra)
    defs["VERTEX_SHADER" if etape == "vert" else "FRAGMENT_SHADER" if etape == "frag" else "COMPUTE_SHADER"] = ""
    # les #extension doivent preceder tout code : on les remonte
    exts = re.findall(r"^[ \t]*#[ \t]*extension[^\n]*$", corps, re.M)
    corps = re.sub(r"^[ \t]*#[ \t]*extension[^\n]*$", "", corps, flags=re.M)
    lignes = [entete]
    seen = set()
    for e in exts:
        e = e.strip()
        if e not in seen:
            seen.add(e)
            lignes.append(e + "\n")
    for k, v in defs.items():
        lignes.append("#define %s %s\n" % (k, v))
    lignes.append("#define texelFetch2D texelFetch\n#define texelFetch3D texelFetch\n")
    flat = "flat out" if etape == "vert" else "flat in"
    for motif, rep, _ in REECRITURES:
        corps = motif.sub(flat if rep == "@FLAT@" else rep, corps)
    if etape == "vert":
        corps = mettre_a_zero_sorties_non_ecrites(corps)
    elif etape == "frag":
        corps = mettre_a_zero_sorties_fragment(corps)
    if neutraliser:
        corps = RE_CONST_FORMAT.sub(lambda m: "// " + m.group(0), corps)   # `const int colortex1Format = RGBA16;` : reglage du pack, pas du GLSL
    lignes.append("#line 1\n")
    return "".join(lignes) + corps
