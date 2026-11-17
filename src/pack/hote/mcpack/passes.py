"""Les passes ajoutees apres M3 : ciel, acteurs, eau et translucides, couleur selective, et la boucle d'une image.

C'est un « melange » (mixin) de la classe Rendu de rendu.py : il utilise ses outils (_attacher, _poser, _tex, ...).
Ordre d'une image (comme Iris/OptiFine) : effacements -> ombre (opaques, acteurs, puis translucides) -> ciel (gbuffers_skybasic/skytextured)
-> terrain -> acteurs -> [copie des profondeurs depthtex0/1/2] -> deferred* -> eau, verre, acteurs translucides, nuages -> composite* -> final.
"""
import ctypes
import re
import time

from . import gpu, matrices as M

TEXTURE_2D, FRAMEBUFFER, COLOR_ATT0 = 0x0DE1, 0x8D40, 0x8CE0
READ_FB, DRAW_FB = 0x8CA8, 0x8CA9
ARRAY_BUFFER, ELEMENT_BUFFER = 0x8892, 0x8893
FLOAT_T = 0x1406
NEAREST = 0x2600
FMT_R8 = (0x8229, 0x1903, 0x1401)
FMT_DEPTH = (0x8CAC, 0x1902, FLOAT_T)

GLB = {"ZERO": 0, "ONE": 1, "SRC_COLOR": 0x300, "ONE_MINUS_SRC_COLOR": 0x301, "SRC_ALPHA": 0x302, "ONE_MINUS_SRC_ALPHA": 0x303,
       "DST_ALPHA": 0x304, "ONE_MINUS_DST_ALPHA": 0x305, "DST_COLOR": 0x306, "ONE_MINUS_DST_COLOR": 0x307, "SRC_ALPHA_SATURATE": 0x308}


# genre de geometrie dynamique -> programmes essayes dans l'ordre (le repli d'Iris : block -> terrain, damagedblock -> terrain, particules -> textured)
PROGRAMMES_GEO = [
    ("entites", ["gbuffers_entities", "gbuffers_textured_lit", "gbuffers_textured", "gbuffers_basic"]),
    ("bloc", ["gbuffers_block", "gbuffers_terrain", "gbuffers_textured_lit", "gbuffers_textured", "gbuffers_basic"]),
    ("fissure", ["gbuffers_damagedblock", "gbuffers_terrain", "gbuffers_textured", "gbuffers_basic"]),
    ("particule", ["gbuffers_textured", "gbuffers_textured_lit", "gbuffers_basic"]),
]


class PassesMixin:
    _genres_dits = set()
    # ------------------------------------------------------------------ melange (blend)
    def _facteurs(self, texte):
        return [GLB.get(x.upper(), 1) for x in texte.split()]

    def _appliquer_blend(self, nom_prog, defaut="off", cibles=None):
        """`blend.<programme> = off | S D | SC DC SA DA` ; `blend.<programme>.colortexN` regle un seul tampon. Sans directive : `defaut`
        (meme forme). Les noms sont ceux de glBlendFunc (SRC_ALPHA ONE_MINUS_SRC_ALPHA...)."""
        gl = self.gl
        v = self.pack.directive("blend", nom_prog)
        if v is None:
            v = defaut
        if v is None or v.strip().lower() in ("off", "false"):
            gl.Disable(0x0BE2)
        else:
            p = self._facteurs(v)
            gl.Enable(0x0BE2)
            if len(p) == 2:
                gl.BlendFunc(p[0], p[1])
            elif len(p) >= 4:
                gl.BlendFuncSeparate(*p[:4])
        for i, ct in enumerate(cibles or []):
            vb = self.pack.directive("blend", "%s.colortex%d" % (nom_prog, ct))
            if vb is None:
                continue
            if vb.strip().lower() in ("off", "false"):
                gl.Disablei(0x0BE2, i)
            else:
                p = self._facteurs(vb)
                gl.Enablei(0x0BE2, i)
                if len(p) == 2:
                    gl.BlendFunci(i, p[0], p[1])
                elif len(p) >= 4:
                    gl.BlendFuncSeparatei(i, *p[:4])

    # ------------------------------------------------------------------ dessin d'une geometrie dynamique
    def _tracer_geo(self, nom, g, vals, mv, proj, etape, surcharge=None):
        """Dessine UNE geometrie (acteur, morceau de ciel, nuages) avec le programme `nom`. g vient de Dyn."""
        gl = self.gl
        p = self.prog(nom)
        self.tex_forcee = g.get("tex")
        try:
            self._poser(p, vals, etape, surcharge)
        finally:
            self.tex_forcee = None
        self._matrices_fixes(mv, proj)
        actifs = self._attribs(p, g)
        gl.DrawElements(4, g["n"], 0x1405, None)
        self._fin_attribs(actifs)
        gl.BindBuffer(ARRAY_BUFFER, 0)
        gl.BindBuffer(ELEMENT_BUFFER, 0)
        gl.UseProgram(0)

    def _vals_perso(self, vals, custom, **plus):
        v = dict(vals)
        v.update({k: val for k, (t, val) in custom.items()})
        v.update(plus)
        return v

    # ------------------------------------------------------------------ ciel
    def _passe_ciel(self, vals, custom, e):
        """Ciel du jeu : disque, lueur, etoiles (gbuffers_skybasic), soleil et lune (gbuffers_skytextured). sky= / sun= / moon= / stars= du pack respectes."""
        c = e.get("ciel3d")
        if not c:
            return
        gl = self.gl
        props = self.pack.props
        non = lambda cle: (props.get(cle) or "").strip().lower() in ("false", "off", "0")
        if non("sky"):
            return
        g = self.dyn.ciel(c, None)
        basique = self.premier_existant(["gbuffers_skybasic", "gbuffers_basic"])
        texture = self.premier_existant(["gbuffers_skytextured", "gbuffers_textured"])
        gl.Disable(0x0B71)
        gl.DepthMask(0)
        gl.Disable(0x0B44)
        gl.Disable(0x0BC0)
        mv = vals["gbufferModelView"]
        cam = e["camera"]
        # le ciel est dessine avec un plan lointain beaucoup plus loin que `far` (comme le jeu) : sinon le disque du ciel est coupe a 256 blocs
        proj = M.perspective(cam.get("fov", 70.0), self.W / self.H, 0.05, 4096.0)

        def dessiner(nom, geo, stade, defaut_blend):
            cib = self.pack.cibles_ecriture(nom)
            self._attacher([self._ct_lecture(i) for i in cib], self.depth_gb)
            gl.Viewport(0, 0, self.W, self.H)
            self._appliquer_blend(nom, defaut_blend, cib)
            self._tracer_geo(nom, geo, self._vals_perso(vals, custom, renderStage=stade), mv, proj, nom)
        if basique:
            dessiner(basique, g["vide"], 7, "off")
            dessiner(basique, g["disque"], 1, "off")
            if g.get("lueur") is not None:
                dessiner(basique, g["lueur"], 2, "SRC_ALPHA ONE_MINUS_SRC_ALPHA ONE ZERO")
            if g.get("etoiles") is not None and not non("stars"):
                dessiner(basique, g["etoiles"], 6, "SRC_ALPHA ONE ONE ZERO")
        if texture:
            for a in g["astres"]:
                lune = a.get("lune")
                if non("moon" if lune else "sun"):
                    continue
                dessiner(texture, a, 5 if lune else 4, "SRC_ALPHA ONE ONE ZERO")
        gl.Disable(0x0BE2)
        gl.DepthMask(1)

    # ------------------------------------------------------------------ acteurs
    def _passe_acteurs(self, vals, custom, geos, translucide, mv):
        """Acteurs et geometries du monde dans gbuffers_entities (opaques et decoupes) ou gbuffers_entities_translucent (melange) ; les blocs a entite
        (coffre, cloche) vont dans gbuffers_block, les fissures dans gbuffers_damagedblock, les particules dans gbuffers_textured (repli d'Iris)."""
        for genre, noms in PROGRAMMES_GEO:
            liste = [g for g in geos if g.get("programme", "entites") == genre and (g["mode"] == "melange") == translucide]
            if not liste:
                continue
            if genre == "entites" and translucide:
                noms = ["gbuffers_entities_translucent"] + noms
            nom = self.premier_existant(noms)
            if nom is None:
                if genre not in self._genres_dits:
                    self._genres_dits.add(genre)
                    self.journal.append("geometries '%s' : aucun programme utilisable dans le pack, non dessinees" % genre)
                continue
            self._passe_genre(vals, custom, liste, translucide, mv, nom, genre)

    def _passe_genre(self, vals, custom, liste, translucide, mv, nom, genre):
        gl = self.gl
        cib = self.pack.cibles_ecriture(nom)
        self._attacher([self._ct_lecture(i) for i in cib], self.depth_gb)
        gl.Viewport(0, 0, self.W, self.H)
        gl.Enable(0x0B71)
        gl.DepthFunc(0x0203)
        gl.DepthMask(1)
        self._appliquer_blend(nom, "SRC_ALPHA ONE_MINUS_SRC_ALPHA ONE ONE_MINUS_SRC_ALPHA" if translucide else "off", cib)
        id_joueur = self.pack.entites.id("minecraft:player")
        etape = {"entites": 11, "bloc": 9, "fissure": 12, "particule": 13}.get(genre, 11)
        for g in liste:
            if g["deuxFaces"]:
                gl.Disable(0x0B44)
            else:
                gl.Enable(0x0B44)
                gl.CullFace(0x0405)
            gl.Enable(0x0BC0)
            gl.AlphaFunc(0x204, 0.1)
            v = self._vals_perso(vals, custom, renderStage=etape)
            self._tracer_geo(nom, g, v, mv, vals["gbufferProjection"], nom, {"entityId": g["entite"] or (id_joueur if genre == "entites" else 0),
                                                                              "entityColor": g["couleurEntite"], "blockEntityId": g["bloc_id"]})
        gl.Disable(0x0B44)
        gl.Disable(0x0BC0)
        gl.Disable(0x0BE2)

    # ------------------------------------------------------------------ couleur selective : force d'exemption par pixel
    def _programme_masque(self):
        if getattr(self, "_prog_masque", None) is None:
            v = "#version 330 compatibility\nout vec2 uv;\nvoid main(){ gl_Position = gl_ModelViewProjectionMatrix * gl_Vertex; uv = gl_MultiTexCoord0.xy; }\n"
            f = ("#version 330 compatibility\nin vec2 uv;\nuniform sampler2D tex;\nuniform sampler2D masque;\nuniform float kM;\nuniform float exempt;\n"
                 "out vec4 sortie;\nvoid main(){ if (texture(tex, uv).a < 0.376) discard;\n float f = exempt > 0.5 ? 1.0 : texture(masque, uv).r * kM;\n sortie = vec4(f, 0.0, 0.0, 1.0); }\n")
            prog, _, _ = gpu.construire_programme(self.gl, v, f)
            self._prog_masque = (prog, {n: self.gl.GetUniformLocation(prog, n.encode()) for n in ("tex", "masque", "kM", "exempt")})
        return self._prog_masque

    def _passe_masque(self, vals, geos, mv):
        """Force d'exemption (0..255) de chaque pixel ou un acteur exempte est visible (test de profondeur contre le terrain seul). Ecrit dans self.tex_force."""
        gl = self.gl
        if getattr(self, "tex_force", None) is None:
            self.tex_force = self._tex(self.W, self.H, FMT_R8, NEAREST)
        self._attacher([self.tex_force], self.depth_masque)
        gl.Viewport(0, 0, self.W, self.H)
        gl.ClearColor(0.0, 0.0, 0.0, 1.0)
        gl.Clear(0x4000)
        gl.Enable(0x0B71)
        gl.DepthFunc(0x0203)
        gl.DepthMask(0)
        gl.Disable(0x0BE2)
        gl.Disable(0x0BC0)
        prog, loc = self._programme_masque()
        gl.UseProgram(prog)
        self._matrices_fixes(mv, vals["gbufferProjection"])

        class _Sans:
            attrs = {}
        for g in geos:
            if not (g.get("exempt") or g.get("masque")) or g["mode"] == "melange":
                continue
            if g["deuxFaces"]:
                gl.Disable(0x0B44)
            else:
                gl.Enable(0x0B44)
                gl.CullFace(0x0405)
            gl.ActiveTexture(0x84C0)
            gl.BindTexture(TEXTURE_2D, g["tex"])
            gl.Uniform1i(loc["tex"], 0)
            gl.ActiveTexture(0x84C1)
            gl.BindTexture(TEXTURE_2D, g.get("masque") or self.tex_blanc)
            gl.Uniform1i(loc["masque"], 1)
            gl.ActiveTexture(0x84C0)
            gl.Uniform1f(loc["kM"], g["kM"])
            gl.Uniform1f(loc["exempt"], 1.0 if g["exempt"] else 0.0)
            actifs = self._attribs(_Sans, g)
            gl.DrawElements(4, g["n"], 0x1405, None)
            self._fin_attribs(actifs)
        gl.UseProgram(0)
        gl.Disable(0x0B44)
        gl.DepthMask(1)
        gl.BindBuffer(ARRAY_BUFFER, 0)
        gl.BindBuffer(ELEMENT_BUFFER, 0)

    def _lire_force(self):
        gl = self.gl
        gl.BindFramebuffer(FRAMEBUFFER, self.fbo.value)
        gl.FramebufferTexture2D(FRAMEBUFFER, COLOR_ATT0, TEXTURE_2D, self.tex_force, 0)
        gl.ReadBuffer(COLOR_ATT0)
        buf = ctypes.create_string_buffer(self.W * self.H)
        gl.PixelStorei(0x0D05, 1)
        gl.ReadPixels(0, 0, self.W, self.H, 0x1903, 0x1401, buf)
        raw = buf.raw
        W = self.W
        out = b"".join([raw[y * W:(y + 1) * W] for y in range(self.H - 1, -1, -1)])
        gl.BindFramebuffer(FRAMEBUFFER, 0)
        return out

    def _lire_profondeur(self):
        """depthtex0 (opaques, acteurs, eau : apres les translucides) en flottants 32 bits 0..1, ligne du haut d'abord (profondeur de champ du montage)."""
        gl = self.gl
        self._attacher([], self.depthtex[0])
        buf = ctypes.create_string_buffer(self.W * self.H * 4)
        gl.PixelStorei(0x0D05, 4)
        gl.ReadPixels(0, 0, self.W, self.H, 0x1902, FLOAT_T, buf)
        raw = buf.raw
        ligne = self.W * 4
        gl.BindFramebuffer(FRAMEBUFFER, 0)
        return b"".join([raw[y * ligne:(y + 1) * ligne] for y in range(self.H - 1, -1, -1)])

    # ------------------------------------------------------------------ eau, verre, acteurs translucides, nuages
    def _passe_translucides(self, vals, custom, e, mv, geos_acteurs, nuage):
        """Apres `deferred` : eau et verre (gbuffers_water), acteurs translucides, nuages (gbuffers_clouds). depthtex1/2 gardent les opaques seuls,
        depthtex0 est remis a jour a la fin (opaques + translucides)."""
        gl = self.gl
        v = self._vals_perso(vals, custom)
        eau = self.premier_existant(["gbuffers_water", "gbuffers_terrain", "gbuffers_textured_lit", "gbuffers_textured"])
        if eau and "melange" in self.geo:
            cib = self.pack.cibles_ecriture(eau)
            self._attacher([self._ct_lecture(i) for i in cib], self.depth_gb)
            gl.Viewport(0, 0, self.W, self.H)
            gl.Enable(0x0B71)
            gl.DepthFunc(0x0201)
            gl.DepthMask(1)
            gl.Enable(0x0B44)
            gl.CullFace(0x0405)
            self._appliquer_blend(eau, "SRC_ALPHA ONE_MINUS_SRC_ALPHA ONE ONE_MINUS_SRC_ALPHA", cib)
            vv = dict(v)
            vv["renderStage"] = 17
            self._dessiner_terrain(eau, ["melange"], vv, mv, vals["gbufferProjection"], eau)
            gl.Disable(0x0B44)
            gl.Disable(0x0BC0)
        self._passe_acteurs(vals, custom, geos_acteurs, True, mv)
        non = (self.pack.props.get("clouds") or "").strip().lower() in ("off", "false", "0")
        if nuage is not None and not non:
            nom = self.premier_existant(["gbuffers_clouds", "gbuffers_textured", "gbuffers_basic"])
            if nom:
                cib = self.pack.cibles_ecriture(nom)
                self._attacher([self._ct_lecture(i) for i in cib], self.depth_gb)
                gl.Viewport(0, 0, self.W, self.H)
                gl.Enable(0x0B71)
                gl.DepthFunc(0x0201)
                gl.DepthMask(1)
                gl.Disable(0x0B44)
                self._appliquer_blend(nom, "SRC_ALPHA ONE_MINUS_SRC_ALPHA", cib)
                self._test_alpha(nom, True)
                self._tracer_geo(nom, nuage, self._vals_perso(vals, custom, renderStage=20), mv, vals["gbufferProjection"], nom)
                gl.Disable(0x0BE2)
                gl.Disable(0x0BC0)
        gl.Disable(0x0BE2)
        self._copier_profondeur(self.depthtex[0])

    # ------------------------------------------------------------------ une image
    def rendre(self, e, sortie_ombre=False):
        """Rend une image. e : etat (voir uniformes.construire). Retourne les octets RGBA, ligne du haut d'abord ;
        self.force_octets = force d'exemption par pixel (ou None)."""
        gl = self.gl
        T = {}
        self.liberes = {}
        t_img = time.perf_counter()

        def marque(nom, t0):
            gl.Finish()
            T[nom] = round((time.perf_counter() - t0) * 1000, 1)
        t0 = time.perf_counter()
        e = dict(e)
        e["largeur"], e["hauteur"] = self.W, self.H
        e["atlas"] = getattr(self, "atlas_taille", (1024, 1024))
        e["precedent"] = self.dernier
        vals, env = uniformes.construire(e, self.reglages)
        custom = self.pack.perso.evaluer(env, dt=e.get("dt", 0.033), image=e.get("image", True))
        self._lightmap(e)
        self.stats["perso"] = {k: v for k, (t, v) in custom.items()}
        self.stats["erreurs_expr"] = getattr(self.pack.perso.ev, "dernieres_erreurs", [])[:30]
        # geometrie dynamique de cette image
        o = getattr(self, "origine", (0, 0, 0))
        geos = self.dyn.acteurs(e.get("acteurs"), o)
        nuage = self.dyn.nuages(e.get("nuages"), o) if e.get("nuages") else None
        veut_force = bool(e.get("veutMasque")) and any(g.get("exempt") or g.get("masque") for g in geos)
        T["uniforms"] = round((time.perf_counter() - t0) * 1000, 1)
        gl.Viewport(0, 0, self.W, self.H)
        t0 = time.perf_counter()
        self._effacer()
        marque("effacements", t0)
        t0 = time.perf_counter()
        self._passe_ombre(vals, e, custom, geos)
        marque("ombre", t0)
        t0 = time.perf_counter()
        self._passe_ciel(vals, custom, e)
        marque("ciel", t0)
        # --- gbuffers : terrain puis acteurs
        t0 = time.perf_counter()
        gl.BindFramebuffer(FRAMEBUFFER, 0)
        cam = vals["cameraPosition"]
        mv = M.mul(vals["gbufferModelView"], M.translation(o[0] - cam[0], o[1] - cam[1], o[2] - cam[2]))
        nom_t = self.premier_existant(["gbuffers_terrain", "gbuffers_textured_lit", "gbuffers_textured", "gbuffers_basic"])
        if nom_t and self.geo:
            cib = self.pack.cibles_ecriture(nom_t)
            self._attacher([self._ct_lecture(i) for i in cib], self.depth_gb)
            gl.Viewport(0, 0, self.W, self.H)
            gl.Enable(0x0B71)
            gl.DepthFunc(0x0201)
            gl.DepthMask(1)
            gl.Enable(0x0B44)
            gl.CullFace(0x0405)
            self._appliquer_blend(nom_t, "off", cib)
            v = self._vals_perso(vals, custom)
            v["renderStage"] = 8
            self._dessiner_terrain(nom_t, ["opaque"], v, mv, vals["gbufferProjection"], nom_t)
            v["renderStage"] = 10
            self._dessiner_terrain(nom_t, ["decoupe", "interne"], v, mv, vals["gbufferProjection"], nom_t)
            gl.Disable(0x0B44)
            gl.Disable(0x0BE2)
            gl.Disable(0x0BC0)
        if veut_force:
            if getattr(self, "depth_masque", None) is None:
                self.depth_masque = self._tex(self.W, self.H, FMT_DEPTH, NEAREST)
            self._copier_profondeur(self.depth_masque)
        self._passe_acteurs(vals, custom, geos, False, mv)
        marque("terrain", t0)
        if veut_force:
            self._passe_masque(vals, geos, mv)
        t0 = time.perf_counter()
        for t in self.depthtex:
            self._copier_profondeur(t)
        marque("copie_profondeur", t0)
        # --- passes plein ecran
        ordre = [n for n in self.pack.programmes_du_profil() if re.fullmatch(r"(prepare|deferred|composite|final)\d*", n)]
        ordre.sort(key=lambda n: (0 if n.startswith("prepare") else 1 if n.startswith("deferred") else 2 if n.startswith("composite") else 3, int(re.sub(r"\D", "", n) or 0)))
        fait_translucides = False
        for n in ordre:
            if n.startswith("prepare"):
                continue
            if not fait_translucides and not n.startswith("deferred"):
                t0 = time.perf_counter()
                self._passe_translucides(vals, custom, e, mv, geos, nuage)
                marque("translucides", t0)
                fait_translucides = True
            t0 = time.perf_counter()
            self._passe_ecran(n, dict(vals), custom)
            marque(n, t0)
            for (pn, ci, gain) in getattr(self, "dump", []):
                if pn == n:
                    self.deboguer(ci, "/tmp/dump-%s-ct%d.png" % (n, ci), gain)
        # --- pas de programme `final` : Iris affiche colortex0 tel quel
        if "final" not in ordre:
            gl.BindFramebuffer(READ_FB, self.fbo.value)
            gl.FramebufferTexture2D(READ_FB, COLOR_ATT0, TEXTURE_2D, self._ct_lecture(0), 0)
            gl.ReadBuffer(COLOR_ATT0)
            gl.BindFramebuffer(DRAW_FB, self.fbo_copie.value)
            gl.FramebufferTexture2D(DRAW_FB, COLOR_ATT0, TEXTURE_2D, self.sortie, 0)
            gl.DrawBuffer(COLOR_ATT0)
            gl.BlitFramebuffer(0, 0, self.W, self.H, 0, 0, self.W, self.H, 0x4000, NEAREST)
            gl.BindFramebuffer(FRAMEBUFFER, 0)
        # --- lecture
        t0 = time.perf_counter()
        gl.BindFramebuffer(FRAMEBUFFER, self.fbo.value)
        gl.FramebufferTexture2D(FRAMEBUFFER, COLOR_ATT0, TEXTURE_2D, self.sortie, 0)
        gl.ReadBuffer(COLOR_ATT0)
        buf = ctypes.create_string_buffer(self.W * self.H * 4)
        gl.PixelStorei(0x0D05, 1)
        gl.ReadPixels(0, 0, self.W, self.H, 0x1908, 0x1401, buf)
        raw = buf.raw
        ligne = self.W * 4
        out = b"".join([raw[y * ligne:(y + 1) * ligne] for y in range(self.H - 1, -1, -1)])
        self.force_octets = self._lire_force() if veut_force else None
        self.prof_octets = self._lire_profondeur() if e.get("veutProfondeur") else None
        self.dyn.liberer()
        self.dernier = {"camera": dict(e["camera"]), "vue": vals["gbufferModelView"], "proj": vals["gbufferProjection"]}
        T["lecture"] = round((time.perf_counter() - t0) * 1000, 1)
        T["total"] = round((time.perf_counter() - t_img) * 1000, 1)
        self.stats["dernier"] = T
        return out


from . import uniformes  # noqa: E402  (en bas : evite un import circulaire au chargement)


UTILISES = re.compile(r"^(shadow|gbuffers_(terrain|water|entities|entities_translucent|skybasic|skytextured|clouds|basic|textured|textured_lit|block|damagedblock)|deferred\d*|composite\d*|final)$")


def _premiere_ligne(journal):
    lignes = [l.strip() for l in journal.splitlines() if l.strip()]
    for l in lignes:
        if "error" in l.lower():
            return l[:200]
    return (lignes[0] if lignes else "erreur inconnue")[:200]


def precompiler(self):
    """Compile tous les programmes que l'on va utiliser ; une phrase claire (RuntimeError) si le pack est inutilisable."""
    from .gpu import ErreurCompilation
    from .glsl import ErreurInclusion
    if not self.premier_existant(["gbuffers_terrain", "gbuffers_textured_lit", "gbuffers_textured", "gbuffers_basic"]):
        raise RuntimeError("pack incomplet : aucun programme pour dessiner le terrain (gbuffers_terrain, gbuffers_textured ou gbuffers_basic)")
    for n in self.pack.programmes_du_profil():
        if not UTILISES.match(n):
            continue
        try:
            self.prog(n)
        except ErreurCompilation as e:
            raise RuntimeError("le programme %s ne compile pas : %s" % (n, _premiere_ligne(e.journal)))
        except ErreurInclusion as e:
            raise RuntimeError("programme %s : %s" % (n, e))


PassesMixin.precompiler = precompiler
