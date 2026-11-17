"""Le pipeline d'un pack de shaders (ordre Iris/OptiFine) sur un contexte OpenGL logiciel.

Ordre d'une image : effacements -> ombre (`shadow`) -> `gbuffers_*` (terrain, ...) -> copie des profondeurs -> `deferred*` -> `composite*` -> `final`.
Les `colortex0..15` ont deux textures (principale / alternative) : un passage lit la principale et ecrit dans l'alternative des cibles
qu'il declare (DRAWBUFFERS / RENDERTARGETS) ; apres le passage, ces cibles s'echangent (regle "flip" d'Iris).
"""
import array
import ctypes
import json
import os
import re
import struct
import time

from . import glsl, gpu, matrices as M, png, uniformes
from .dyn import Dyn
from .passes import PassesMixin
from .idmap import analyser_etat

FORMATS = {
    "RGBA8": (0x8058, 0x1908, 0x1401), "RGBA16": (0x805B, 0x1908, 0x1403), "RGBA16F": (0x881A, 0x1908, 0x1406), "RGBA32F": (0x8814, 0x1908, 0x1406),
    "R11F_G11F_B10F": (0x8C3A, 0x1907, 0x1406), "RGB8": (0x8051, 0x1907, 0x1401), "RGB16": (0x8054, 0x1907, 0x1403), "RGB16F": (0x881B, 0x1907, 0x1406),
    "RGB32F": (0x8815, 0x1907, 0x1406), "RG8": (0x822B, 0x8227, 0x1401), "RG16": (0x822C, 0x8227, 0x1403), "RG16F": (0x822F, 0x8227, 0x1406),
    "RG32F": (0x8230, 0x8227, 0x1406), "R8": (0x8229, 0x1903, 0x1401), "R16": (0x822A, 0x1903, 0x1403), "R16F": (0x822D, 0x1903, 0x1406),
    "R32F": (0x822E, 0x1903, 0x1406), "RGB10_A2": (0x8059, 0x1908, 0x1401), "RGBA8_SNORM": (0x8F97, 0x1908, 0x1401),
}
# constantes GL
TEXTURE_2D, FRAMEBUFFER, READ_FB, DRAW_FB = 0x0DE1, 0x8D40, 0x8CA8, 0x8CA9
COLOR_ATT0, DEPTH_ATT = 0x8CE0, 0x8D00
NEAREST, LINEAR, LINEAR_MIP_LINEAR, NEAREST_MIP_LINEAR = 0x2600, 0x2601, 0x2703, 0x2702
CLAMP_TO_EDGE, REPEAT = 0x812F, 0x2901
T_MIN, T_MAG, T_WRAP_S, T_WRAP_T = 0x2801, 0x2800, 0x2802, 0x2803
T_COMPARE_MODE, T_COMPARE_FUNC, T_MAX_LEVEL = 0x884C, 0x884D, 0x813D
ARRAY_BUFFER, ELEMENT_BUFFER, STATIC_DRAW = 0x8892, 0x8893, 0x88E4
FLOAT_T = 0x1406
UNITES_SAMPLER = {0x8B5E, 0x8B62, 0x8B5F, 0x8DC1, 0x8DCA, 0x8DD2, 0x8B5D}
ALIAS_COLORTEX = {"gcolor": 0, "gdepth": 1, "gnormal": 2, "composite": 3, "gaux1": 4, "gaux2": 5, "gaux3": 6, "gaux4": 7}
FLOATS = 28
STRIDE = FLOATS * 4


def _arr(ctype, valeurs):
    return (ctype * len(valeurs))(*valeurs)


def plages_vivantes(sections, mortes):
    """[(debut, nb), ...] des sections dont la cle n'est pas dans `mortes`, plages contigues fusionnees. `sections` : [[debut, nb, cle], ...]."""
    out = []
    for deb, nb, cle in sections:
        if cle in mortes:
            continue
        if out and out[-1][0] + out[-1][1] == deb:
            out[-1] = (out[-1][0], out[-1][1] + nb)
        else:
            out.append((deb, nb))
    return out


class Prog:
    def __init__(self, nom, prog, unifs, attrs, tps):
        self.nom, self.prog, self.unifs, self.attrs, self.tps = nom, prog, unifs, attrs, tps


class Rendu(PassesMixin):
    def __init__(self, ctx, pack, largeur, hauteur, reglages=None):
        self.ctx, self.gl, self.pack = ctx, ctx.gl, pack
        self.W, self.H = largeur, hauteur
        self.stats = {}
        self.manquants = set()
        self.journal = []
        self.progs = {}
        self.liberes = {}
        self.geo = {}
        self.samplers_ombre = None
        t0 = time.perf_counter()
        # reglages lus dans les sources du pack
        self.consts = pack.constantes()
        n = lambda k, d: pack.constante_nombre(self.consts, k, d)
        self.reglages = {
            "sunPathRotation": n("sunPathRotation", 0.0), "shadowDistance": n("shadowDistance", 160.0),
            "shadowMapResolution": int(n("shadowMapResolution", 1024)), "shadowIntervalSize": n("shadowIntervalSize", 2.0),
        }
        if reglages:
            self.reglages.update(reglages)
        self.tex_forcee = None       # texture imposee aux echantillonneurs tex/gtexture (peau d'un acteur, soleil, lune...)
        self.dernier = None          # camera de l'image precedente (matrices et position "precedentes")
        self._creer_cibles()
        self._creer_ombre()
        self._creer_textures_fixes()
        self.dyn = Dyn(self)
        self.fbo = ctypes.c_uint()
        self.gl.GenFramebuffers(1, ctypes.byref(self.fbo))
        self.fbo_copie = ctypes.c_uint()
        self.gl.GenFramebuffers(1, ctypes.byref(self.fbo_copie))
        self.vao = ctypes.c_uint()
        self.gl.GenVertexArrays(1, ctypes.byref(self.vao))
        self.gl.BindVertexArray(self.vao.value)
        quad = _arr(ctypes.c_float, [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
        self.vbo_quad = self._buffer(ARRAY_BUFFER, ctypes.cast(quad, ctypes.c_void_p), 48)
        self.stats["init_ms"] = (time.perf_counter() - t0) * 1000

    # ------------------------------------------------------------------ ressources
    def _buffer(self, cible, ptr, taille):
        b = ctypes.c_uint()
        self.gl.GenBuffers(1, ctypes.byref(b))
        self.gl.BindBuffer(cible, b.value)
        self.gl.BufferData(cible, taille, ptr, STATIC_DRAW)
        return b.value

    def _tex(self, w, h, fmt, filtre=LINEAR, wrap=CLAMP_TO_EDGE, mip=False, donnees=None):
        gl = self.gl
        t = ctypes.c_uint()
        gl.GenTextures(1, ctypes.byref(t))
        gl.BindTexture(TEXTURE_2D, t.value)
        interne, forme, typ = fmt
        gl.TexImage2D(TEXTURE_2D, 0, interne, w, h, 0, forme, typ, donnees)
        gl.TexParameteri(TEXTURE_2D, T_MAG, filtre)
        gl.TexParameteri(TEXTURE_2D, T_MIN, LINEAR_MIP_LINEAR if mip else filtre)
        gl.TexParameteri(TEXTURE_2D, T_WRAP_S, wrap)
        gl.TexParameteri(TEXTURE_2D, T_WRAP_T, wrap)
        if mip:
            gl.GenerateMipmap(TEXTURE_2D)
        return t.value

    def _format_const(self, nom, defaut="RGBA8"):
        c = self.consts.get(nom)
        if c and c[1] in FORMATS:
            return c[1]
        return defaut

    def _bool_const(self, nom, defaut):
        c = self.consts.get(nom)
        if not c:
            return defaut
        v = c[1].strip().lower()
        return v in ("true", "1")

    def _vec4_const(self, nom, defaut):
        c = self.consts.get(nom)
        if not c:
            return defaut
        nums = re.findall(r"-?\d+\.?\d*", c[1])
        return tuple(float(x) for x in nums[:4]) if len(nums) >= 4 else defaut

    def _creer_cibles(self):
        gl = self.gl
        self.ct = []   # par colortex : dict
        W, H = self.W, self.H
        alias_inv = {v: k for k, v in ALIAS_COLORTEX.items()}
        for i in range(16):
            noms = ["colortex%d" % i] + ([alias_inv[i]] if i in alias_inv else [])
            fmt = FORMATS[next((self._format_const(n + "Format") for n in noms if n + "Format" in self.consts), "RGBA8")]
            mip = any(self._bool_const(n + "MipmapEnabled", False) for n in noms)
            clear = next((self._bool_const(n + "Clear", True) for n in noms if n + "Clear" in self.consts), True)
            couleur = next((self._vec4_const(n + "ClearColor", (0.0, 0.0, 0.0, 0.0)) for n in noms if n + "ClearColor" in self.consts), (0.0, 0.0, 0.0, 0.0))
            self.ct.append({"fmt": fmt, "mip": mip, "clear": clear, "couleur": couleur, "tex": [self._tex(W, H, fmt, LINEAR, CLAMP_TO_EDGE, mip), None], "p": 0, "sale": True})
        # profondeurs
        D = (0x8CAC, 0x1902, FLOAT_T)
        self.depth_gb = self._tex(W, H, D, NEAREST)
        self.depthtex = [self._tex(W, H, D, NEAREST) for _ in range(3)]
        self.sortie = self._tex(W, H, FORMATS["RGBA8"], NEAREST)

    def _creer_ombre(self):
        R = self.reglages["shadowMapResolution"]
        D = (0x8CAC, 0x1902, FLOAT_T)
        self.shadowtex = [self._tex(R, R, D, NEAREST), self._tex(R, R, D, NEAREST)]
        self.shadowcolor = [self._tex(R, R, FORMATS[self._format_const("shadowcolor%dFormat" % i)], LINEAR) for i in range(2)]
        self.R = R
        gl = self.gl
        s = (ctypes.c_uint * 2)()
        gl.GenSamplers(2, s)
        for i in (0, 1):
            gl.SamplerParameteri(s[i], T_MIN, LINEAR)
            gl.SamplerParameteri(s[i], T_MAG, LINEAR)
            gl.SamplerParameteri(s[i], T_WRAP_S, CLAMP_TO_EDGE)
            gl.SamplerParameteri(s[i], T_WRAP_T, CLAMP_TO_EDGE)
            gl.SamplerParameteri(s[i], T_COMPARE_MODE, 0x884E)
            gl.SamplerParameteri(s[i], T_COMPARE_FUNC, 0x0203)    # LEQUAL
        self.samplers_ombre = list(s)
        s2 = ctypes.c_uint()
        gl.GenSamplers(1, ctypes.byref(s2))
        gl.SamplerParameteri(s2.value, T_MIN, NEAREST); gl.SamplerParameteri(s2.value, T_MAG, NEAREST)
        gl.SamplerParameteri(s2.value, T_WRAP_S, CLAMP_TO_EDGE); gl.SamplerParameteri(s2.value, T_WRAP_T, CLAMP_TO_EDGE)
        self.sampler_ombre_brut = s2.value

    def _creer_textures_fixes(self):
        gl = self.gl
        # bruit et textures perso
        self.perso = {}   # (etape, nom) -> texture ; etape '*' = partout
        for etape, nom, chemin, extras in self.pack.textures_perso():
            octets = self.pack.src.octets(chemin.lstrip("/"))
            if octets is None:
                self.journal.append("texture perso absente : " + chemin)
                continue
            try:
                w, h, rgba = png.lire(octets)
            except Exception as e:
                self.journal.append("texture perso illisible %s : %s" % (chemin, e))
                continue
            buf = ctypes.create_string_buffer(rgba, len(rgba))
            self.perso[(etape, nom)] = self._tex(w, h, FORMATS["RGBA8"], LINEAR, REPEAT, False, ctypes.cast(buf, ctypes.c_void_p))
        # normales / speculaire plates (labPBR hors perimetre)
        b = ctypes.create_string_buffer(bytes([128, 128, 255, 255]), 4)
        self.tex_normals = self._tex(1, 1, FORMATS["RGBA8"], NEAREST, REPEAT, False, ctypes.cast(b, ctypes.c_void_p))
        b2 = ctypes.create_string_buffer(bytes([0, 0, 0, 0]), 4)
        self.tex_specular = self._tex(1, 1, FORMATS["RGBA8"], NEAREST, REPEAT, False, ctypes.cast(b2, ctypes.c_void_p))
        self.tex_lightmap = None
        self.tex_atlas = None
        self.tex_blanc = self._tex(1, 1, FORMATS["RGBA8"], NEAREST, REPEAT, False, ctypes.cast(ctypes.create_string_buffer(bytes([255] * 4), 4), ctypes.c_void_p))

    def _lightmap(self, e):
        """Texture de lumiere 16x16 (x = lumiere de bloc, y = lumiere du ciel), a la maniere du jeu."""
        gl = self.gl
        jour = max(0.0, min(1.0, float(e.get("jourLumiere", 1.0))))
        px = bytearray()
        for sky in range(16):
            for blk in range(16):
                def courbe(v):
                    v = v / 15.0
                    return v / (4 - 3 * v)
                b = courbe(blk)
                s = courbe(sky) * (0.25 + 0.75 * jour)
                r = min(1.0, max(b * 1.0 + 0.0, 0) * (1.0) + s * 0.95 * (1 - 0.0))
                g = min(1.0, b * 0.85 + s * 0.97)
                bl = min(1.0, b * 0.65 + s * 1.0)
                px += bytes((int(r * 255), int(g * 255), int(bl * 255), 255))
        buf = ctypes.create_string_buffer(bytes(px), len(px))
        if self.tex_lightmap:
            t = ctypes.c_uint(self.tex_lightmap)
            gl.DeleteTextures(1, ctypes.byref(t))
        self.tex_lightmap = self._tex(16, 16, FORMATS["RGBA8"], LINEAR, CLAMP_TO_EDGE, False, ctypes.cast(buf, ctypes.c_void_p))

    # ------------------------------------------------------------------ maillage
    def charger_maillage(self, dossier):
        """Lit le dossier ecrit par export-gpu.js : sommets par couche, atlas, palette -> mc_Entity."""
        gl = self.gl
        t0 = time.perf_counter()
        with open(os.path.join(dossier, "maillage.json"), encoding="utf8") as f:
            ent = json.load(f)
        ids = []
        for etat in ent["palette"]:
            nom, props = analyser_etat(etat)
            ids.append(self.pack.blocs.id(nom, props))
        self.geo = {}
        o = ent["zone"]["origine"]
        self.origine = tuple(o)
        self.ids_palette = ids
        gl.BindVertexArray(self.vao.value)
        for nom, info in ent["couches"].items():
            with open(os.path.join(dossier, nom + ".vtx"), "rb") as f:
                data = bytearray(f.read())
            with open(os.path.join(dossier, nom + ".idx"), "rb") as f:
                idx = bytearray(f.read())
            g = self._preparer_couche(data, idx, info["quads"])
            g["couche"] = info["couche"]
            if info.get("sections") is not None:      # scene avec un monde : les sections peuvent etre retirees puis refaites (maillage-maj)
                g["sections"] = info["sections"]
                g["mortes"] = set()
            self.geo[nom] = g
        a = ent["atlas"]
        with open(os.path.join(dossier, "atlas.rgba"), "rb") as f:
            rgba = f.read()
        buf = ctypes.create_string_buffer(rgba, len(rgba))
        gl.BindTexture(TEXTURE_2D, 0)
        t = ctypes.c_uint()
        gl.GenTextures(1, ctypes.byref(t))
        gl.BindTexture(TEXTURE_2D, t.value)
        gl.TexImage2D(TEXTURE_2D, 0, 0x8058, a["largeur"], a["hauteur"], 0, 0x1908, 0x1401, ctypes.cast(buf, ctypes.c_void_p))
        gl.TexParameteri(TEXTURE_2D, T_MAX_LEVEL, 4)
        gl.GenerateMipmap(TEXTURE_2D)
        gl.TexParameteri(TEXTURE_2D, T_MAG, NEAREST)
        gl.TexParameteri(TEXTURE_2D, T_MIN, NEAREST_MIP_LINEAR)
        gl.TexParameteri(TEXTURE_2D, T_WRAP_S, CLAMP_TO_EDGE)
        gl.TexParameteri(TEXTURE_2D, T_WRAP_T, CLAMP_TO_EDGE)
        self.tex_atlas = t.value
        self.atlas_taille = (a["largeur"], a["hauteur"])
        self.stats["maillage_ms"] = (time.perf_counter() - t0) * 1000
        self.stats["quads"] = {k: v["n"] // 6 for k, v in self.geo.items()}

    def _preparer_couche(self, data, idx, nq):
        """Sommets (bytearray) et indices -> tampons GL. mc_Entity.x = id du pack (par quad) ; positions relatives a l'origine de la zone."""
        o, ids = self.origine, self.ids_palette
        mv = memoryview(data).cast("f")
        for q in range(nq):
            b = q * 4 * FLOATS
            pi = int(mv[b + 20])
            idv = float(ids[pi]) if pi < len(ids) else 0.0
            for k in range(4):
                j = b + k * FLOATS
                mv[j + 18] = idv
                if os.environ.get("MCPACK_DEBUG_SKY"):
                    mv[j + 6] = float(os.environ["MCPACK_DEBUG_SKY"])
                mv[j] -= o[0]
                mv[j + 1] -= o[1]
                mv[j + 2] -= o[2]
        fl = (ctypes.c_float * (nq * 4 * FLOATS)).from_buffer(data)
        vbo = self._buffer(ARRAY_BUFFER, ctypes.cast(fl, ctypes.c_void_p), len(data))
        del mv
        ia = (ctypes.c_uint * (len(idx) // 4)).from_buffer(idx)
        ibo = self._buffer(ELEMENT_BUFFER, ctypes.cast(ia, ctypes.c_void_p), len(idx))
        del fl, ia
        return {"vbo": vbo, "ibo": ibo, "n": len(idx) // 4}

    def mettre_a_jour_maillage(self, dossier):
        """Sections refaites entre deux images (scene avec un monde) : `maj.json` + p<id>.vtx / p<id>.idx ecrits par export-gpu.js (exporterMaj).
        mortes : les sections du maillage de depart qui ne sont plus dessinees ; retraits : pieces a oublier ; ajouts : pieces neuves."""
        gl = self.gl
        t0 = time.perf_counter()
        with open(os.path.join(dossier, "maj.json"), encoding="utf8") as f:
            maj = json.load(f)
        gl.BindVertexArray(self.vao.value)
        for etat in (maj.get("palette") or [])[len(self.ids_palette):]:      # blocs nouveaux de la palette (torche posee...) : leur id du pack pour mc_Entity
            nom, props = analyser_etat(etat)
            self.ids_palette.append(self.pack.blocs.id(nom, props))
        mortes = set(maj.get("mortes", []))
        for g in self.geo.values():
            if "sections" in g and mortes:
                g["mortes"] |= mortes
                g["plages"] = plages_vivantes(g["sections"], g["mortes"])
        retraits = set(maj.get("retraits", []))
        for g in self.geo.values():
            gardees = []
            for e in g.get("extras", []):
                if e["id"] in retraits:
                    for t in (e["vbo"], e["ibo"]):
                        x = ctypes.c_uint(t)
                        gl.DeleteBuffers(1, ctypes.byref(x))
                else:
                    gardees.append(e)
            g["extras"] = gardees
        for a in maj.get("ajouts", []):
            with open(os.path.join(dossier, "p%d.vtx" % a["id"]), "rb") as f:
                data = bytearray(f.read())
            with open(os.path.join(dossier, "p%d.idx" % a["id"]), "rb") as f:
                idx = bytearray(f.read())
            e = self._preparer_couche(data, idx, a["quads"])
            e["id"] = a["id"]
            base = self.geo.get(a["couche"])
            if base is None:       # couche absente du maillage de depart (premiere eau, premier verre...)
                base = self.geo[a["couche"]] = {"vbo": 0, "ibo": 0, "n": 0, "couche": a["num"], "plages": []}
            base.setdefault("extras", []).append(e)
        self.stats["maj_ms"] = (time.perf_counter() - t0) * 1000
        # quads vraiment dessines (sections mortes retirees, pieces rapportees comprises)
        self.stats["quads"] = {k: ((sum(nb for _, nb in v["plages"]) if v.get("plages") is not None else v["n"]) + sum(e["n"] for e in v.get("extras", []))) // 6 for k, v in self.geo.items()}
        return {"ms": round(self.stats["maj_ms"], 2), "quads": self.stats["quads"]}

    # ------------------------------------------------------------------ programmes
    def prog(self, nom):
        p = self.progs.get(nom)
        if p is not None:
            return p
        t0 = time.perf_counter()
        v = self.pack.sources_programme(nom, "vert")
        f = self.pack.sources_programme(nom, "frag")
        prog, tps, log = gpu.construire_programme(self.gl, v, f)
        p = Prog(nom, prog, gpu.uniforms_actifs(self.gl, prog), gpu.attributs_actifs(self.gl, prog), tps)
        p.cibles = self.pack.cibles_ecriture(nom)
        self.progs[nom] = p
        self.stats.setdefault("compile_ms", {})[nom] = round((time.perf_counter() - t0) * 1000)
        return p

    def premier_existant(self, noms):
        for n in noms:
            if n in self.pack.programmes and self.pack.programmes[n]["actif"] and (self.pack.programmes[n]["fsh"] or self.pack.programmes[n]["vsh"]):
                return n
        return None

    # ------------------------------------------------------------------ uniforms et textures
    def _texture_pour(self, nom, etape):
        """(texture, est_depth_ombre?, sampler_object) pour un echantillonneur du pack."""
        stage = re.sub(r"\d+$", "", etape)
        if etape.startswith("gbuffers") or etape.startswith("dh_"):
            stage2 = "gbuffers"
        elif etape.startswith("shadow"):
            stage2 = "shadow"
        else:
            stage2 = stage
        if stage == "final":
            stage, stage2 = "composite", "composite"
        for cle in ((etape, nom), (stage, nom), (stage2, nom), ("*", nom)):
            if cle in self.perso:
                # une texture perso posee sur un colortex cesse de le remplacer quand un programme du meme etage l'ecrit (regle d'Iris)
                m = re.fullmatch(r"colortex(\d+)", nom)
                if m and int(m.group(1)) in self.liberes.get(stage2, ()):
                    break
                return self.perso[cle], None
        m = re.fullmatch(r"colortex(\d+)", nom)
        if m and int(m.group(1)) < 16:
            return self._ct_lecture(int(m.group(1))), None
        if nom in ALIAS_COLORTEX:
            return self._ct_lecture(ALIAS_COLORTEX[nom]), None
        if nom in ("depthtex0", "depthtex1", "depthtex2"):
            return self.depthtex[int(nom[-1])], None
        if nom in ("shadowtex0", "shadow", "watershadow", "shadowtex0HW"):
            return self.shadowtex[0], "ombre"
        if nom in ("shadowtex1", "shadowtex1HW"):
            return self.shadowtex[1], "ombre"
        if nom in ("shadowcolor0", "shadowcolor"):
            return self.shadowcolor[0], None
        if nom == "shadowcolor1":
            return self.shadowcolor[1], None
        if nom in ("tex", "texture", "gtexture", "colortex"):
            if self.tex_forcee is not None:
                return self.tex_forcee, None
            return self.tex_atlas or self.tex_blanc, None
        if nom == "lightmap":
            return self.tex_lightmap or self.tex_blanc, None
        if nom == "normals":
            return self.tex_normals, None
        if nom == "specular":
            return self.tex_specular, None
        if nom == "noisetex":
            return self.perso.get(("*", "noisetex"), self.tex_blanc), None
        return None, None

    def _ct_lecture(self, i):
        c = self.ct[i]
        return c["tex"][c["p"]]

    def _poser(self, p, vals, etape, surcharge=None):
        gl = self.gl
        unite = 0
        gl.UseProgram(p.prog)
        for nom, typ, taille, loc in p.unifs:
            if loc < 0:
                continue
            base = nom[:-3] if nom.endswith("[0]") else nom
            if typ in UNITES_SAMPLER:
                tex, mode = self._texture_pour(base, etape)
                if tex is None:
                    self.manquants.add("sampler:" + base)
                    tex = self.tex_blanc
                gl.ActiveTexture(0x84C0 + unite)
                gl.BindTexture(TEXTURE_2D, tex)
                if typ == 0x8B62:    # sampler2DShadow : comparaison materielle
                    gl.BindSampler(unite, self.samplers_ombre[0])
                else:
                    gl.BindSampler(unite, self.sampler_ombre_brut if mode == "ombre" else 0)
                gl.Uniform1i(loc, unite)
                unite += 1
                continue
            v = None
            if surcharge and base in surcharge:
                v = surcharge[base]
            elif base in vals:
                v = vals[base]
            else:
                self.manquants.add(base)
                continue
            self._ecrire(typ, loc, taille, v)
        gl.ActiveTexture(0x84C0)
        self._unite_max = unite

    def _ecrire(self, typ, loc, taille, v):
        gl = self.gl
        try:
            if typ == 0x1406:
                gl.Uniform1f(loc, float(v if not isinstance(v, tuple) else v[0]))
            elif typ in (0x1404, 0x8B56, 0x1405):
                gl.Uniform1i(loc, int(v if not isinstance(v, tuple) else v[0]))
            elif typ == 0x8B50:
                gl.Uniform2f(loc, float(v[0]), float(v[1]))
            elif typ == 0x8B51:
                gl.Uniform3f(loc, float(v[0]), float(v[1]), float(v[2]))
            elif typ == 0x8B52:
                gl.Uniform4f(loc, *[float(x) for x in (tuple(v) + (0, 0, 0, 0))[:4]])
            elif typ == 0x8B53:
                gl.Uniform2i(loc, int(v[0]), int(v[1]))
            elif typ == 0x8B54:
                gl.Uniform3i(loc, int(v[0]), int(v[1]), int(v[2]))
            elif typ == 0x8B55:
                gl.Uniform4i(loc, *[int(x) for x in (tuple(v) + (0, 0, 0, 0))[:4]])
            elif typ == 0x8B5C:
                gl.UniformMatrix4fv(loc, 1, 0, ctypes.cast(_arr(ctypes.c_float, v), ctypes.c_void_p))
            elif typ == 0x8B5B:
                gl.UniformMatrix3fv(loc, 1, 0, ctypes.cast(_arr(ctypes.c_float, M.sous_matrice3(v)), ctypes.c_void_p))
        except (TypeError, IndexError, ValueError):
            self.manquants.add("type:%x" % typ)

    # ------------------------------------------------------------------ dessin de la geometrie
    def _attribs(self, p, g):
        gl = self.gl
        gl.BindBuffer(ARRAY_BUFFER, g["vbo"])
        gl.BindBuffer(ELEMENT_BUFFER, g["ibo"])
        gl.EnableClientState(0x8074)
        gl.VertexPointer(3, FLOAT_T, STRIDE, ctypes.c_void_p(0))
        gl.ClientActiveTexture(0x84C0)
        gl.EnableClientState(0x8078)
        gl.TexCoordPointer(2, FLOAT_T, STRIDE, ctypes.c_void_p(12))
        gl.ClientActiveTexture(0x84C1)
        gl.EnableClientState(0x8078)
        gl.TexCoordPointer(2, FLOAT_T, STRIDE, ctypes.c_void_p(20))
        gl.ClientActiveTexture(0x84C0)
        gl.EnableClientState(0x8076)
        gl.ColorPointer(4, FLOAT_T, STRIDE, ctypes.c_void_p(28))
        gl.EnableClientState(0x8075)
        gl.NormalPointer(FLOAT_T, STRIDE, ctypes.c_void_p(44))
        gen = {"at_tangent": (4, 56), "mc_Entity": (4, 72), "mc_midTexCoord": (2, 88), "at_midBlock": (4, 96)}
        actifs = []
        for nom, (n, off) in gen.items():
            loc = p.attrs.get(nom, -1)
            if loc >= 0:
                gl.EnableVertexAttribArray(loc)
                gl.VertexAttribPointer(loc, n, FLOAT_T, 0, STRIDE, ctypes.c_void_p(off))
                actifs.append(loc)
        return actifs

    def _fin_attribs(self, actifs):
        gl = self.gl
        for loc in actifs:
            gl.DisableVertexAttribArray(loc)
        gl.DisableClientState(0x8074)
        gl.DisableClientState(0x8075)
        gl.DisableClientState(0x8076)
        gl.ClientActiveTexture(0x84C1)
        gl.DisableClientState(0x8078)
        gl.ClientActiveTexture(0x84C0)
        gl.DisableClientState(0x8078)

    def _matrices_fixes(self, mv, proj):
        gl = self.gl
        gl.MatrixMode(0x1701)
        gl.LoadMatrixf(ctypes.cast(_arr(ctypes.c_float, proj), ctypes.c_void_p))
        gl.MatrixMode(0x1700)
        gl.LoadMatrixf(ctypes.cast(_arr(ctypes.c_float, mv), ctypes.c_void_p))
        # matrice de texture 1 : lumiere (v + 8) / 256 comme le jeu
        gl.MatrixMode(0x1702)
        gl.ActiveTexture(0x84C1)
        lm = M.mul(M.translation(1.0 / 32.0, 1.0 / 32.0, 0.0), [1 / 256.0, 0, 0, 0, 0, 1 / 256.0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1.0])
        gl.LoadMatrixf(ctypes.cast(_arr(ctypes.c_float, lm), ctypes.c_void_p))
        gl.ActiveTexture(0x84C0)
        gl.LoadIdentity()
        gl.MatrixMode(0x1700)

    def _dessiner_terrain(self, nom_prog, couches, vals, mv, proj, etape, surcharge=None):
        gl = self.gl
        p = self.prog(nom_prog)
        self._poser(p, vals, etape, surcharge)
        self._matrices_fixes(mv, proj)
        for couche in couches:
            if couche not in self.geo:
                continue
            self._test_alpha(nom_prog, couche != "opaque")
            for g in [self.geo[couche]] + self.geo[couche].get("extras", []):
                if g["n"] == 0:
                    continue
                actifs = self._attribs(p, g)
                plages = g.get("plages")
                if plages is None:
                    gl.DrawElements(4, g["n"], 0x1405, None)
                else:      # sections vivantes seulement (les mortes ont ete refaites : leur nouvelle version est dans les pieces)
                    for deb, nb in plages:
                        gl.DrawElements(4, nb, 0x1405, ctypes.c_void_p(deb * 4))
                self._fin_attribs(actifs)
        gl.BindBuffer(ARRAY_BUFFER, 0)
        gl.BindBuffer(ELEMENT_BUFFER, 0)
        gl.UseProgram(0)

    def _test_alpha(self, nom_prog, decoupe):
        """`alphaTest.<programme> = off | FONCTION reference` (Iris l'injecte dans le shader ; ici : test d'alpha fixe sur la sortie 0).
        Sans directive : les couches decoupees (feuilles, plantes) sont testees a GREATER 0.1, les pleines non."""
        gl = self.gl
        v = self.pack.directive("alphaTest", nom_prog)
        fonctions = {"NEVER": 0x200, "LESS": 0x201, "EQUAL": 0x202, "LEQUAL": 0x203, "GREATER": 0x204, "NOTEQUAL": 0x205, "GEQUAL": 0x206, "ALWAYS": 0x207}
        if v is not None:
            t = v.split()
            if t and t[0].lower() in ("off", "false"):
                gl.Disable(0x0BC0)
                return
            if t and t[0].upper() in fonctions:
                gl.Enable(0x0BC0)
                gl.AlphaFunc(fonctions[t[0].upper()], float(t[1]) if len(t) > 1 else 0.1)
                return
            if t and t[0].lower() == "true":
                gl.Enable(0x0BC0)
                gl.AlphaFunc(0x204, 0.1)
                return
        if decoupe:
            gl.Enable(0x0BC0)
            gl.AlphaFunc(0x204, 0.1)
        else:
            gl.Disable(0x0BC0)

    # ------------------------------------------------------------------ cibles
    def _attacher(self, textures, depth=None):
        gl = self.gl
        gl.BindFramebuffer(FRAMEBUFFER, self.fbo.value)
        for i, t in enumerate(textures):
            gl.FramebufferTexture2D(FRAMEBUFFER, COLOR_ATT0 + i, TEXTURE_2D, t, 0)
        for i in range(len(textures), 8):
            gl.FramebufferTexture2D(FRAMEBUFFER, COLOR_ATT0 + i, TEXTURE_2D, 0, 0)
        gl.FramebufferTexture2D(FRAMEBUFFER, DEPTH_ATT, TEXTURE_2D, depth or 0, 0)
        if textures:
            gl.DrawBuffers(len(textures), ctypes.cast(_arr(ctypes.c_uint, [COLOR_ATT0 + i for i in range(len(textures))]), ctypes.c_void_p))
        else:
            gl.DrawBuffers(0, None)
            gl.ReadBuffer(0)
        st = gl.CheckFramebufferStatus(FRAMEBUFFER)
        if st != 0x8CD5:
            raise RuntimeError("cadre de rendu incomplet : 0x%x" % st)

    def _ct_ecriture(self, i):
        c = self.ct[i]
        if c["tex"][1 - c["p"]] is None:
            c["tex"][1 - c["p"]] = self._tex(self.W, self.H, c["fmt"], LINEAR, CLAMP_TO_EDGE, c["mip"])
            self.gl.BindFramebuffer(FRAMEBUFFER, 0)
        return c["tex"][1 - c["p"]]

    def _copier_profondeur(self, vers):
        gl = self.gl
        gl.BindFramebuffer(READ_FB, self.fbo.value)
        gl.BindFramebuffer(DRAW_FB, self.fbo_copie.value)
        gl.FramebufferTexture2D(DRAW_FB, DEPTH_ATT, TEXTURE_2D, vers, 0)
        gl.BlitFramebuffer(0, 0, self.W, self.H, 0, 0, self.W, self.H, 0x100, NEAREST)
        gl.BindFramebuffer(FRAMEBUFFER, 0)

    def _effacer(self):
        gl = self.gl
        for i, c in enumerate(self.ct):
            if c["clear"] or c["sale"]:
                self._attacher([c["tex"][c["p"]]])
                gl.ClearColor(*c["couleur"] if c["clear"] else (0.0, 0.0, 0.0, 0.0))
                gl.Clear(0x4000)
                c["sale"] = False
        self._attacher([], self.depth_gb)
        gl.DepthMask(1)
        gl.ClearDepth(1.0)
        gl.Clear(0x100)

    def _passe_ecran(self, nom, vals, custom, flip=True):
        """Un passage plein ecran (deferred, composite, final...)."""
        gl = self.gl
        p = self.prog(nom)
        cibles = p.cibles
        if nom == "final":
            self._attacher([self.sortie])
        else:
            self._attacher([self._ct_ecriture(i) for i in cibles])
        echelle = self.pack.directive("scale", nom)
        s = float(echelle) if echelle and re.fullmatch(r"[\d.]+", echelle.strip()) else 1.0
        gl.Viewport(0, 0, max(1, int(self.W * s)), max(1, int(self.H * s)))
        gl.Disable(0x0B71)    # test de profondeur
        gl.DepthMask(0)
        gl.Disable(0x0B44)    # cull
        gl.Disable(0x0BE2)
        # mipmaps des colortex lus
        for i, c in enumerate(self.ct):
            if c["mip"] and c.get("sale_mip", True):
                gl.BindTexture(TEXTURE_2D, c["tex"][c["p"]])
                gl.GenerateMipmap(TEXTURE_2D)
                c["sale_mip"] = False
        v = dict(vals)
        v.update({k: val for k, (t, val) in custom.items()})
        self._poser(p, v, nom)
        self._matrices_ecran()
        gl.BindBuffer(ARRAY_BUFFER, self.vbo_quad)
        gl.EnableClientState(0x8074)
        gl.VertexPointer(3, FLOAT_T, 12, ctypes.c_void_p(0))
        gl.ClientActiveTexture(0x84C0)
        gl.EnableClientState(0x8078)
        gl.TexCoordPointer(3, FLOAT_T, 12, ctypes.c_void_p(0))
        gl.DrawArrays(0x0007, 0, 4)
        gl.DisableClientState(0x8078)
        gl.DisableClientState(0x8074)
        gl.BindBuffer(ARRAY_BUFFER, 0)
        gl.UseProgram(0)
        for u in range(self._unite_max):
            gl.ActiveTexture(0x84C0 + u)
            gl.BindSampler(u, 0)
        gl.ActiveTexture(0x84C0)
        gl.Viewport(0, 0, self.W, self.H)
        gl.DepthMask(1)
        if nom != "final" and flip:
            for i in cibles:
                self.ct[i]["p"] = 1 - self.ct[i]["p"]
                self.ct[i]["sale_mip"] = True
                self.liberes.setdefault(re.sub(r"\d+$", "", nom), set()).add(i)

    def _matrices_ecran(self):
        gl = self.gl
        gl.MatrixMode(0x1701)
        o = M.mul(M.translation(-1.0, -1.0, 0.0), [2.0, 0, 0, 0, 0, 2.0, 0, 0, 0, 0, -1.0, 0, 0, 0, 0, 1.0])
        gl.LoadMatrixf(ctypes.cast(_arr(ctypes.c_float, o), ctypes.c_void_p))
        gl.MatrixMode(0x1700)
        gl.LoadIdentity()

    def _passe_ombre(self, vals, e, custom, geos=()):
        gl = self.gl
        nom = self.premier_existant(["shadow"])
        if nom is None or not self.geo:
            return
        R = self.R
        self._attacher([self.shadowcolor[0], self.shadowcolor[1]], self.shadowtex[0])
        gl.Viewport(0, 0, R, R)
        gl.ClearColor(1.0, 1.0, 1.0, 1.0)
        gl.ClearDepth(1.0)
        gl.Clear(0x4100)
        gl.Enable(0x0B71)
        gl.DepthFunc(0x0201)
        gl.DepthMask(1)
        gl.Disable(0x0BE2)
        cul = (self.pack.props.get("shadow.culling") or "").strip().lower()
        if cul in ("off", "false"):
            gl.Disable(0x0B44)
        else:
            gl.Enable(0x0B44)
            gl.CullFace(0x0404 if cul == "reversed" else 0x0405)
        cam = vals["cameraPosition"]
        o = self.origine
        mv = M.mul(vals["shadowModelView"], M.translation(o[0] - cam[0], o[1] - cam[1], o[2] - cam[2]))
        v = dict(vals)
        v.update({k: val for k, (t, val) in custom.items()})
        v["renderStage"] = 8
        self._dessiner_terrain(nom, ["opaque", "decoupe", "interne"], v, mv, vals["shadowProjection"], "shadow")
        # les acteurs projettent leur ombre (programme `shadow` du pack, entityId du joueur)
        id_joueur = self.pack.entites.id("minecraft:player")
        for g in geos:
            if g["mode"] == "melange" or g.get("programme") in ("fissure", "particule", "meteo"):
                continue
            gl.Enable(0x0BC0)
            gl.AlphaFunc(0x204, 0.1)
            if g["deuxFaces"]:
                gl.Disable(0x0B44)
            else:
                gl.Enable(0x0B44)
            self._tracer_geo(nom, g, self._vals_perso(vals, custom, renderStage=11), mv, vals["shadowProjection"], "shadow",
                             {"entityId": g["entite"] or id_joueur, "entityColor": g["couleurEntite"]})
        gl.Disable(0x0B44)
        gl.Disable(0x0BC0)
        gl.BindFramebuffer(FRAMEBUFFER, 0)
        # shadowtex1 = profondeur sans translucides (copiee ici) ; shadowtex0 recoit ensuite l'eau et le verre (shadowcolor0 : leur couleur)
        gl.BindFramebuffer(READ_FB, self.fbo.value)
        gl.BindFramebuffer(DRAW_FB, self.fbo_copie.value)
        gl.FramebufferTexture2D(DRAW_FB, DEPTH_ATT, TEXTURE_2D, self.shadowtex[1], 0)
        gl.BlitFramebuffer(0, 0, R, R, 0, 0, R, R, 0x100, NEAREST)
        gl.BindFramebuffer(FRAMEBUFFER, 0)
        if "melange" in self.geo and (self.pack.props.get("shadowTranslucent") or "true").strip().lower() not in ("false", "off", "0"):
            self._attacher([self.shadowcolor[0], self.shadowcolor[1]], self.shadowtex[0])
            gl.Viewport(0, 0, R, R)
            gl.Enable(0x0B71)
            gl.DepthFunc(0x0201)
            gl.DepthMask(1)
            gl.Enable(0x0B44)
            gl.CullFace(0x0404 if cul == "reversed" else 0x0405) if cul not in ("off", "false") else gl.Disable(0x0B44)
            self._appliquer_blend("shadow", "SRC_ALPHA ONE_MINUS_SRC_ALPHA", [0, 1])
            vv = dict(v)
            vv["renderStage"] = 17
            self._dessiner_terrain(nom, ["melange"], vv, mv, vals["shadowProjection"], "shadow")
            gl.Disable(0x0BE2)
            gl.Disable(0x0B44)
            gl.Disable(0x0BC0)
            gl.BindFramebuffer(FRAMEBUFFER, 0)
        gl.Viewport(0, 0, self.W, self.H)

    def reinitialiser(self):
        """Oublie l'historique (TAA, exposition...) : toutes les cibles seront effacees a la prochaine image."""
        for c in self.ct:
            c["sale"] = True

    def texel(self, i, x, y):
        """Valeur flottante RGBA d'un texel d'un colortex (mise au point)."""
        gl = self.gl
        gl.BindFramebuffer(FRAMEBUFFER, self.fbo.value)
        gl.FramebufferTexture2D(FRAMEBUFFER, COLOR_ATT0, TEXTURE_2D, self._ct_lecture(i), 0)
        gl.ReadBuffer(COLOR_ATT0)
        b = (ctypes.c_float * 4)()
        gl.ReadPixels(x, y, 1, 1, 0x1908, FLOAT_T, b)
        gl.BindFramebuffer(FRAMEBUFFER, 0)
        return [round(v, 4) for v in b]

    def deboguer(self, i, chemin, gain=1.0, tex=None, profondeur=False):
        """Ecrit une cible (colortex i, apres le dernier passage) en PNG : outil de mise au point, pas utilise en production."""
        gl = self.gl
        t = tex if tex is not None else self._ct_lecture(i)
        gl.BindFramebuffer(FRAMEBUFFER, self.fbo.value)
        gl.FramebufferTexture2D(FRAMEBUFFER, COLOR_ATT0, TEXTURE_2D, t, 0)
        gl.ReadBuffer(COLOR_ATT0)
        n = self.W * self.H
        buf = (ctypes.c_float * (n * 4))()
        gl.ReadPixels(0, 0, self.W, self.H, 0x1908, FLOAT_T, buf)
        out = bytearray(n * 4)
        W = self.W
        for y in range(self.H):
            sy = self.H - 1 - y
            for x in range(W):
                o = (sy * W + x) * 4
                d = (y * W + x) * 4
                for k in range(3):
                    v = buf[o + k] * gain
                    v = 0.0 if v != v else min(1.0, max(0.0, v))
                    out[d + k] = int((v ** (1 / 2.2)) * 255)
                out[d + 3] = 255
        png.ecrire(self.W, self.H, bytes(out), chemin)
        gl.BindFramebuffer(FRAMEBUFFER, 0)
