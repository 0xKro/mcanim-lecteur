"""Geometrie dynamique : acteurs (personnages), ciel (disque, etoiles, soleil, lune, lueur) et nuages.

Tout est converti dans la MEME disposition de sommet que le terrain (28 flottants, voir src/pack/export-gpu.js), pour que le meme code de dessin
serve partout. Node envoie des tableaux en base64 (flottants 32 bits) ; les textures (peau du personnage, soleil, lune) sont envoyees UNE fois.
"""
import array
import base64
import ctypes
import math

from . import matrices as M

FLOATS = 28


def _f32(b64):
    a = array.array("f")
    a.frombytes(base64.b64decode(b64))
    return a


def _u32(b64):
    a = array.array("I")
    a.frombytes(base64.b64decode(b64))
    return a


def _normaliser(x, y, z):
    n = math.sqrt(x * x + y * y + z * z) or 1.0
    return x / n, y / n, z / n


def calculer_normales(pos, idx):
    """Normale plate par triangle, copiee sur ses 3 sommets (les cubes de personnage n'ont pas de sommet partage entre deux faces)."""
    nor = array.array("f", bytes(len(pos) * 4))
    for t in range(0, len(idx), 3):
        a, b, c = idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3
        e1 = (pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2])
        e2 = (pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2])
        n = _normaliser(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
        for s in (a, b, c):
            nor[s], nor[s + 1], nor[s + 2] = n
    return nor


def entrelacer(pos, uv, col, nor, idx, origine, lum=(0.0, 240.0), alpha=None, entite=0.0):
    """pos (3n), uv (2n), col (3n ou 4n, 0..1), nor (3n) -> array('f') de n sommets x 28 flottants. Positions moins `origine`."""
    n = len(pos) // 3
    a = array.array("f", bytes(n * FLOATS * 4))
    px = pos[0::3]
    py = pos[1::3]
    pz = pos[2::3]
    ox, oy, oz = origine
    a[0::FLOATS] = array.array("f", [v - ox for v in px])
    a[1::FLOATS] = array.array("f", [v - oy for v in py])
    a[2::FLOATS] = array.array("f", [v - oz for v in pz])
    a[3::FLOATS] = uv[0::2]
    a[4::FLOATS] = uv[1::2]
    a[5::FLOATS] = array.array("f", [lum[0]]) * n
    a[6::FLOATS] = array.array("f", [lum[1]]) * n
    k = len(col) // n
    a[7::FLOATS] = col[0::k]
    a[8::FLOATS] = col[1::k]
    a[9::FLOATS] = col[2::k]
    a[10::FLOATS] = col[3::k] if k >= 4 else array.array("f", [1.0]) * n
    a[11::FLOATS] = nor[0::3]
    a[12::FLOATS] = nor[1::3]
    a[13::FLOATS] = nor[2::3]
    # tangente : perpendiculaire a la normale (pas de relief sur les personnages ni le ciel)
    tx = array.array("f", bytes(n * 4))
    ty = array.array("f", bytes(n * 4))
    tz = array.array("f", bytes(n * 4))
    for i in range(n):
        nx, ny, nz = nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]
        if abs(ny) > 0.99:
            tx[i], ty[i], tz[i] = 1.0, 0.0, 0.0
        else:
            tx[i], ty[i], tz[i] = _normaliser(nz, 0.0, -nx)
    a[14::FLOATS] = tx
    a[15::FLOATS] = ty
    a[16::FLOATS] = tz
    a[17::FLOATS] = array.array("f", [1.0]) * n
    a[18::FLOATS] = array.array("f", [entite]) * n
    a[22::FLOATS] = uv[0::2]
    a[23::FLOATS] = uv[1::2]
    return a


class Dyn:
    def __init__(self, rendu):
        self.r = rendu
        self.textures = {}   # id -> (texture GL, w, h)
        self.masques = {}    # id -> texture GL (R8)
        self.courant = []    # buffers a liberer a la fin de l'image

    # ---------------------------------------------------------------- ressources envoyees une fois
    def ajouter_texture(self, ident, w, h, rgba_b64):
        from .rendu import FORMATS, NEAREST, CLAMP_TO_EDGE
        if ident in self.textures:
            return
        brut = base64.b64decode(rgba_b64)
        buf = ctypes.create_string_buffer(brut, len(brut))
        t = self.r._tex(w, h, FORMATS["RGBA8"], NEAREST, CLAMP_TO_EDGE, False, ctypes.cast(buf, ctypes.c_void_p))
        self.textures[ident] = (t, w, h)

    def ajouter_masque(self, ident, w, h, octets_b64):
        from .rendu import FORMATS, NEAREST, CLAMP_TO_EDGE
        if ident in self.masques:
            return
        brut = base64.b64decode(octets_b64)
        buf = ctypes.create_string_buffer(brut, len(brut))
        gl = self.r.gl
        gl.PixelStorei(0x0CF5, 1)    # lignes sans remplissage
        t = self.r._tex(w, h, FORMATS["R8"], NEAREST, CLAMP_TO_EDGE, False, ctypes.cast(buf, ctypes.c_void_p))
        self.masques[ident] = t

    # ---------------------------------------------------------------- geometrie d'une image
    def _geo(self, a, idx, **extra):
        r = self.r
        from .rendu import ARRAY_BUFFER, ELEMENT_BUFFER
        buf = (ctypes.c_float * len(a)).from_buffer(a)
        vbo = r._buffer(ARRAY_BUFFER, ctypes.cast(buf, ctypes.c_void_p), len(a) * 4)
        ia = (ctypes.c_uint * len(idx)).from_buffer(idx)
        ibo = r._buffer(ELEMENT_BUFFER, ctypes.cast(ia, ctypes.c_void_p), len(idx) * 4)
        g = {"vbo": vbo, "ibo": ibo, "n": len(idx), "couche": 0}
        g.update(extra)
        self.courant.extend([vbo, ibo])
        return g

    def acteurs(self, specs, origine):
        """specs envoyees par Node (voir src/pack/film.js) -> liste de geometries pretes a dessiner."""
        res = []
        for s in specs or []:
            tex = self.textures.get(s["tex"])
            if tex is None:
                continue
            pos, uv, idx = _f32(s["pos"]), _f32(s["uv"]), _u32(s["idx"])
            col = _f32(s["col"]) if s.get("col") else array.array("f", [1.0, 1.0, 1.0]) * (len(pos) // 3)
            nor = _f32(s["nor"]) if s.get("nor") else calculer_normales(pos, idx)
            sky = float(s.get("ciel", 15.0)) * 16.0
            a = entrelacer(pos, uv, col, nor, idx, origine, lum=(float(s.get("bloc", 0.0)) * 16.0, min(240.0, sky)))
            m = s.get("mode", "decoupe")
            res.append(self._geo(a, idx, tex=tex[0], mode=m, deuxFaces=bool(s.get("deuxFaces")), masque=self.masques.get(s.get("masque")),
                                 kM=float(s.get("kM", 1.0)), exempt=bool(s.get("exempt")), entite=int(s.get("entite", 0)),
                                 couleurEntite=tuple(s.get("couleurEntite", (0.0, 0.0, 0.0, 0.0))), couche=3 if m == "melange" else 1))
        return res

    def liberer(self):
        gl = self.r.gl
        for b in self.courant:
            x = ctypes.c_uint(b)
            gl.DeleteBuffers(1, ctypes.byref(x))
        self.courant = []

    # ---------------------------------------------------------------- ciel
    def ciel(self, c, cam_origine):
        """c : { ciel:[r,g,b], sunrise:{rgb,a,sgn}|None, etoiles:{dirs,tailles,lum}|None, astres:[{n,ex,ez,taille,lune,tex}] } (positions autour de la camera).
        Retourne {'disque': geo, 'lueur': geo|None, 'etoiles': geo|None, 'astres': [geo...]}. Pas de translation : la camera est l'origine."""
        zero = (0.0, 0.0, 0.0)
        res = {"astres": [], "lueur": None, "etoiles": None}
        # disque du ciel (comme le jeu : plat, a +16 blocs) et disque du vide (a -16, couleur de brume) ; rayon 4000 : le plan lointain du ciel est a 4096
        def disque(y, rgb, retourne):
            N, R = 32, 4000.0
            pos, col, idx = [0.0, y, 0.0], list(rgb) + [1.0], []
            for i in range(N):
                a = 2 * math.pi * i / N
                pos += [math.sin(a) * R, y, math.cos(a) * R]
                col += list(rgb) + [1.0]
            for i in range(N):
                idx += [0, 1 + (i + 1) % N, 1 + i] if retourne else [0, 1 + i, 1 + (i + 1) % N]
            pa, ia = array.array("f", pos), array.array("I", idx)
            nv = len(pa) // 3
            nor = array.array("f", [0.0, -1.0 if retourne else 1.0, 0.0]) * nv
            return self._geo(entrelacer(pa, array.array("f", [0.0] * (nv * 2)), array.array("f", col), nor, ia, zero, lum=(0.0, 240.0)), ia, tex=None, mode="ciel", couche=0)
        res["disque"] = disque(16.0, [v / 255.0 for v in c["ciel"]], True)
        res["vide"] = disque(-16.0, [v / 255.0 for v in c.get("brume", c["ciel"])], False)
        # lueur du lever / coucher du soleil
        sr = c.get("sunrise")
        if sr:
            al = sr["a"]
            f = 180.0 if sr["sgn"] < 0 else 0.0
            m = M.mul(M.mul(M.mul(M.rot_y(-90.0), M.rot_x(90.0)), M.rot_z(f)), M.rot_z(90.0))
            pos, col = [], []
            ctr = M.mul_vec(m, [0.0, 100.0, 0.0, 1.0])
            pos += ctr[:3]
            col += [sr["rgb"][0] / 255.0, sr["rgb"][1] / 255.0, sr["rgb"][2] / 255.0, al]
            for i in range(17):
                a = i * 2 * math.pi / 16
                p = M.mul_vec(m, [math.sin(a) * 120.0, math.cos(a) * 120.0, -math.cos(a) * 40.0 * al, 1.0])
                pos += p[:3]
                col += [sr["rgb"][0] / 255.0, sr["rgb"][1] / 255.0, sr["rgb"][2] / 255.0, 0.0]
            idx = []
            for i in range(16):
                idx += [0, 1 + i, 2 + i]
            pa = array.array("f", pos)
            ia = array.array("I", idx)
            nor = array.array("f", [0.0, -1.0, 0.0]) * (len(pa) // 3)
            res["lueur"] = self._geo(entrelacer(pa, array.array("f", [0.0] * (len(pa) // 3 * 2)), array.array("f", col), nor, ia, zero), ia, tex=None, mode="ciel-melange", deuxFaces=True, couche=3)
        # etoiles
        e = c.get("etoiles")
        if e:
            dirs, tail = _f32(e["dirs"]), _f32(e["tailles"])
            n = len(tail)
            pos, idx = [], []
            for i in range(n):
                dx, dy, dz = dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]
                if dy < -0.05:
                    continue
                s = tail[i]
                ax, ay, az = _normaliser(dz, 0.0, -dx) if abs(dy) < 0.99 else (1.0, 0.0, 0.0)
                bx, by, bz = dy * az - dz * ay, dz * ax - dx * az, dx * ay - dy * ax
                k = len(pos) // 3
                for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    pos += [dx * 100 + (ax * sa + bx * sb) * s, dy * 100 + (ay * sa + by * sb) * s, dz * 100 + (az * sa + bz * sb) * s]
                idx += [k, k + 1, k + 2, k, k + 2, k + 3]
            if idx:
                pa, ia = array.array("f", pos), array.array("I", idx)
                nv = len(pa) // 3
                lum = float(e["lum"])
                cc = e.get("couleur", (255, 255, 255))
                col = array.array("f", [cc[0] / 255.0, cc[1] / 255.0, cc[2] / 255.0, lum]) * nv
                nor = array.array("f", [0.0, -1.0, 0.0]) * nv
                res["etoiles"] = self._geo(entrelacer(pa, array.array("f", [0.0] * (nv * 2)), col, nor, ia, zero), ia, tex=None, mode="ciel-melange", deuxFaces=True, couche=3)
        # soleil, lune : carres texturises a 100 blocs
        for a in c.get("astres", []):
            tex = self.textures.get(a.get("tex"))
            if tex is None:
                continue
            n, ex, ez, S = a["n"], a["ex"], a["ez"], a["taille"]
            pos, uv = [], []
            for lx, lz, u, v in ((-S, -S, 0, 0), (S, -S, 1, 0), (S, S, 1, 1), (-S, S, 0, 1)):
                pos += [n[0] * 100 + ex[0] * lx + ez[0] * lz, n[1] * 100 + ex[1] * lx + ez[1] * lz, n[2] * 100 + ex[2] * lx + ez[2] * lz]
                if a.get("lune"):
                    u, v = 1 - u, 1 - v
                uv += [u, v]
            ia = array.array("I", [0, 1, 2, 0, 2, 3])
            pa = array.array("f", pos)
            col = array.array("f", [a["mult"][0], a["mult"][1], a["mult"][2], 1.0]) * 4
            nor = array.array("f", [-n[0], -n[1], -n[2]]) * 4
            res["astres"].append(self._geo(entrelacer(pa, array.array("f", uv), col, nor, ia, zero), ia, tex=tex[0], mode="ciel-melange", deuxFaces=True, couche=3, lune=bool(a.get("lune"))))
        return res

    def nuages(self, m, origine):
        """Maillage de nuages (format de Node : positions monde, couleurs rgb, 1 texture blanche) -> geometrie, ou None."""
        if not m:
            return None
        pos, uv, idx = _f32(m["pos"]), _f32(m["uv"]), _u32(m["idx"])
        col = _f32(m["col"])
        nor = calculer_normales(pos, idx)
        a = entrelacer(pos, uv, col, nor, idx, origine, lum=(0.0, 240.0))
        if not getattr(self, "_dit_nuages", False):
            self._dit_nuages = True
            self.r.journal.append("nuages : %d sommets, %d triangles" % (len(pos) // 3, len(idx) // 3))
        blanc = self.textures.get(m.get("tex"))
        return self._geo(a, idx, tex=blanc[0] if blanc else self.r.tex_blanc, mode="melange", deuxFaces=False, couche=3)
