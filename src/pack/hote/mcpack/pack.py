"""Un pack de shaders (dossier ou .zip) : fichiers, options, proprietes, programmes, uniforms personnalises.

Aucun fichier de pack n'est copie dans le depot : le pack est une ENTREE, lue ici et jetee a la fin.
"""
import os
import re
import zipfile

from . import glsl, proprietes
from .expr import UniformsPerso
from .idmap import IdMap

EXT_SHADER = (".vsh", ".fsh", ".gsh", ".csh", ".glsl", ".inc", ".h", ".settings")
RE_OPTION = re.compile(r"^[ \t]*(//[ \t]*)?#define[ \t]+(\w+)(?!\()([^\n]*)$", re.M)
RE_CONST = re.compile(r"^[ \t]*const[ \t]+(int|float|bool|vec2|vec3|vec4|ivec2|ivec3)[ \t]+(\w+)[ \t]*=[ \t]*([^;]+);", re.M)
RE_DRAWBUFFERS = re.compile(r"/\*\s*DRAWBUFFERS\s*:\s*([0-9A-Fa-f ]+)\s*\*/")
RE_RENDERTARGETS = re.compile(r"/\*\s*RENDERTARGETS\s*:\s*([0-9, ]+)\s*\*/")


class Source:
    """Acces en lecture aux fichiers du pack, dossier ou zip, chemins en '/' relatifs au dossier `shaders/`."""

    def __init__(self, chemin):
        self.chemin = chemin
        self.zip = None
        self.fichiers = {}   # chemin relatif a shaders/ -> chemin reel (dossier) ou nom dans le zip
        self.racine_hors = {}  # chemins hors de shaders/ (textures)
        if os.path.isdir(chemin):
            base = chemin
            for r, _, fs in os.walk(base):
                for f in fs:
                    rel = os.path.relpath(os.path.join(r, f), base).replace("\\", "/")
                    self.fichiers[rel] = os.path.join(r, f)
            self._detecter_racine()
        else:
            self.zip = zipfile.ZipFile(chemin)
            for n in self.zip.namelist():
                if not n.endswith("/"):
                    self.fichiers[n.replace("\\", "/")] = n      # zip fait sous Windows : parfois des \ au lieu de /
            self._detecter_racine()

    def _detecter_racine(self):
        prefixe = None
        for n in self.fichiers:
            m = re.match(r"^(.*?)shaders/(shaders\.properties|world0/|composite|final|gbuffers_|block\.properties)", n)
            if m:
                prefixe = m.group(1)
                break
        if prefixe is None:
            for n in self.fichiers:
                if n.endswith("shaders/final.fsh") or n.endswith("shaders/composite.fsh") or n.endswith("shaders/gbuffers_terrain.fsh"):
                    prefixe = n[:n.index("shaders/")]
                    break
        if prefixe is None:
            raise ValueError("ce n'est pas un pack de shaders : dossier `shaders/` introuvable")
        self.prefixe = prefixe + "shaders/"
        self.fichiers_pack = {n[len(self.prefixe):]: n for n in self.fichiers if n.startswith(self.prefixe)}

    def existe(self, rel):
        return rel in self.fichiers_pack

    def octets(self, rel):
        n = self.fichiers_pack.get(rel)
        if n is None:
            return None
        if self.zip:
            return self.zip.read(self.fichiers[n])
        with open(self.fichiers[n], "rb") as f:
            return f.read()

    def texte(self, rel):
        b = self.octets(rel)
        return None if b is None else b.decode("utf-8", "replace").replace("\r\n", "\n").replace("\r", "\n")


def _lire_nombre(txt, macros):
    txt = txt.strip().rstrip("fF") if re.fullmatch(r"-?[\d.]+[fF]?", txt.strip()) else txt.strip()
    try:
        return float(txt)
    except ValueError:
        pass
    sub = re.sub(r"[A-Za-z_]\w*", lambda m: str(macros.get(m.group(0), m.group(0))) if m.group(0) not in ("true", "false") else m.group(0), txt)
    sub = sub.replace("true", "1").replace("false", "0")
    sub = re.sub(r"(\d)[fF]\b", r"\1", sub)
    if re.fullmatch(r"[\d.eE+\-*/()\s]+", sub):
        try:
            return float(eval(sub, {"__builtins__": {}}, {}))
        except Exception:
            return None
    return None


class Pack:
    def __init__(self, chemin, dimension="world0", surcharges=None, macros_extra=None):
        self.src = Source(chemin)
        self.nom = os.path.basename(chemin)
        self.dimension = dimension
        self.surcharges = dict(surcharges or {})
        self.macros_extra = dict(macros_extra or {})
        self.notes = []
        self._scanner_options()
        self.macros = dict(glsl.MACROS_JEU)
        self.macros.update(self.options_valeurs)
        self.macros.update({k: v for k, v in self.macros_extra.items()})
        # proprietes
        txt = self.src.texte("shaders.properties") or ""
        self.props = proprietes.lire(txt, self.macros, lambda n: self.src.texte(n.lstrip("/")))
        self.perso = UniformsPerso(self.props)
        self.notes += ["uniform perso illisible : " + e for e in self.perso.erreurs]
        self.blocs = IdMap(proprietes.lire(self.src.texte("block.properties") or "", self.macros), "block")
        self.entites = IdMap(proprietes.lire(self.src.texte("entity.properties") or "", self.macros), "entity")
        self.objets = IdMap(proprietes.lire(self.src.texte("item.properties") or "", self.macros), "item")
        self._decouvrir_programmes()

    # ---------------------------------------------------------- options
    def _scanner_options(self):
        """Options = #define du pack (actifs) ; `//#define X` = option coupee. Valeurs : les defaults du fichier."""
        self.options = {}          # nom -> {actif, valeur, fichier}
        self.options_valeurs = {}  # macros actives
        for rel in sorted(self.src.fichiers_pack):
            if not rel.endswith(EXT_SHADER):
                continue
            t = self.src.texte(rel)
            if t is None or "#define" not in t:
                continue
            for m in RE_OPTION.finditer(t):
                commente, nom, reste = bool(m.group(1)), m.group(2), m.group(3)
                valeur = re.sub(r"//.*$|/\*.*?\*/", "", reste).strip()
                comm = re.search(r"//\s*(.*)$", reste)
                est_option = (valeur == "") or (comm is not None and "[" in comm.group(1))
                if not est_option:
                    continue
                if nom not in self.options:
                    self.options[nom] = {"actif": not commente, "valeur": valeur, "fichier": rel}
        for nom, o in self.options.items():
            if o["actif"]:
                self.options_valeurs[nom] = o["valeur"]
        for nom, v in self.surcharges.items():
            if v is False:
                self.options_valeurs.pop(nom, None)
            elif v is True:
                self.options_valeurs[nom] = self.options.get(nom, {}).get("valeur", "")
            else:
                self.options_valeurs[nom] = str(v)

    # ---------------------------------------------------------- programmes
    def _dossiers(self):
        d = [self.dimension + "/"] if any(n.startswith(self.dimension + "/") for n in self.src.fichiers_pack) else []
        return d + [""]

    def fichier_programme(self, nom, ext):
        for d in self._dossiers():
            rel = d + nom + ext
            if self.src.existe(rel):
                return rel
        return None

    def active(self, nom):
        for cle in ("program.%s/%s.enabled" % (self.dimension, nom), "program.%s.enabled" % nom):
            if cle in self.props:
                return proprietes.evaluer_condition(self.props[cle], self.macros)
        return True

    def _decouvrir_programmes(self):
        noms = set()
        for d in self._dossiers():
            for rel in self.src.fichiers_pack:
                if rel.startswith(d) and "/" not in rel[len(d):]:
                    m = re.match(r"(.+)\.(vsh|fsh|gsh|csh)$", rel[len(d):])
                    if m:
                        noms.add(m.group(1))
        self.programmes = {}
        for n in sorted(noms):
            v, f, c = self.fichier_programme(n, ".vsh"), self.fichier_programme(n, ".fsh"), self.fichier_programme(n, ".csh")
            self.programmes[n] = {"nom": n, "vsh": v, "fsh": f, "csh": c, "actif": self.active(n)}

    def programmes_du_profil(self):
        """Programmes activés, hors Distant Horizons (dh_*) et calcul (csh) ; ordre du jeu."""
        res = []
        for n, p in self.programmes.items():
            if not p["actif"] or n.startswith("dh_") or p["csh"] or not (p["vsh"] or p["fsh"]):
                continue
            res.append(n)
        return sorted(res, key=ordre_programme)

    def sources_programme(self, nom, etape, neutraliser=True):
        """Source GLSL complete (vert/frag) d'un programme : fichier du pack, ou source minimale si un seul des deux manque."""
        p = self.programmes[nom]
        rel = p["vsh"] if etape == "vert" else p["fsh"] if etape == "frag" else p["csh"]
        if rel is None:
            return None
        txt = self.src.texte(rel)
        return glsl.construire(txt, rel, lambda n: self.src.texte(n), glsl.MACROS_JEU | self.options_macros_actives(), etape, self.surcharges, self.macros_extra, neutraliser=neutraliser)

    def options_macros_actives(self):
        return {}

    # ---------------------------------------------------------- reglages dans les sources
    def constantes(self, noms_programmes=None):
        """`const int shadowMapResolution = 2048;`... : cherchees dans tous les programmes actifs (apres #include), la premiere gagne."""
        res = {}
        for n in noms_programmes or self.programmes_du_profil():
            for etape in ("frag", "vert"):
                try:
                    src = self.sources_programme(n, etape, neutraliser=False)
                except glsl.ErreurInclusion:
                    continue
                if not src:
                    continue
                lignes = "\n".join(proprietes.preprocesser(src, self.macros))
                for m in RE_CONST.finditer(lignes):
                    res.setdefault(m.group(2), (m.group(1), m.group(3).strip()))
        return res

    def constante_nombre(self, consts, nom, defaut):
        if nom not in consts:
            return defaut
        v = _lire_nombre(consts[nom][1], self.macros)
        return defaut if v is None else v

    def cibles_ecriture(self, nom):
        """Liste des colortex ecrits par le programme (DRAWBUFFERS / RENDERTARGETS), [0] si rien."""
        p = self.programmes[nom]
        txt = (self.src.texte(p["fsh"]) if p["fsh"] else "") or ""
        # les commentaires peuvent etre dans un fichier inclus
        try:
            txt = glsl.resoudre_inclusions(txt, p["fsh"], lambda n: self.src.texte(n)) if p["fsh"] else ""
        except glsl.ErreurInclusion:
            pass
        m = RE_RENDERTARGETS.search(txt)
        if m:
            return [int(x) for x in re.split(r"[ ,]+", m.group(1).strip()) if x != ""]
        m = RE_DRAWBUFFERS.search(txt)
        if m:
            return [int(c, 16) for c in m.group(1).replace(" ", "")]
        return [0]

    # ---------------------------------------------------------- directives de shaders.properties
    def directive(self, prefixe, programme):
        for cle in ("%s.%s/%s" % (prefixe, self.dimension, programme), "%s.%s" % (prefixe, programme)):
            if cle in self.props:
                return self.props[cle]
        return None

    def textures_perso(self):
        """texture.<etape>.<echantillonneur> = chemin [type...] -> liste (etape, nom, chemin, extras)."""
        res = []
        for k, v in self.props.items():
            m = re.match(r"texture\.(\w+)\.(\w+)$", k)
            if m:
                parts = v.split()
                res.append((m.group(1), m.group(2), parts[0], parts[1:]))
            m = re.match(r"texture\.(noise)$", k)
            if m:
                res.append(("*", "noisetex", v.split()[0], []))
        return res


def ordre_programme(n):
    """Ordre d'execution du jeu : setup, begin, shadow, prepare, gbuffers_*, deferred, composite, final."""
    m = re.match(r"([a-z_]+?)(\d*)$", n)
    base, num = (m.group(1), int(m.group(2) or 0)) if m else (n, 0)
    rang = {"setup": 0, "begin": 1, "shadow": 2, "shadow_solid": 2, "shadow_cutout": 2, "prepare": 3, "gbuffers_basic": 4, "gbuffers_textured": 4,
            "gbuffers_textured_lit": 4, "gbuffers_skybasic": 4, "gbuffers_skytextured": 4, "gbuffers_clouds": 4, "gbuffers_terrain": 4,
            "gbuffers_terrain_solid": 4, "gbuffers_terrain_cutout": 4, "gbuffers_terrain_cutout_mip": 4, "gbuffers_damagedblock": 4,
            "gbuffers_block": 4, "gbuffers_beaconbeam": 4, "gbuffers_entities": 4, "gbuffers_entities_glowing": 4, "gbuffers_armor_glint": 4,
            "gbuffers_spidereyes": 4, "gbuffers_hand": 4, "deferred": 5, "gbuffers_water": 6, "gbuffers_hand_water": 6, "gbuffers_weather": 6,
            "composite": 7, "final": 8}.get(base, 4 if base.startswith("gbuffers") else 4)
    return (rang, num, n)
