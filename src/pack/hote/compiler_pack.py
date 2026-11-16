# Compile et lie TOUS les programmes d'un pack (profil par defaut) sur llvmpipe ; mesure compilation, liaison et premier dessin (JIT).
# usage : python3 -I compiler_pack.py pack.zip [--dimension world0] [--sans-jit] [--json sortie.json]
import argparse, ctypes, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from egl import Contexte
from mcpack.pack import Pack
from mcpack import gpu, glsl


def premier_dessin(gl, prog, fbo):
    """Dessine un triangle plein ecran dans un petit FBO : le JIT de llvmpipe compile les shaders au premier dessin."""
    t0 = time.perf_counter()
    gl.UseProgram(prog)
    gl.BindFramebuffer(0x8D40, fbo)
    gl.Viewport(0, 0, 64, 64)
    quad = (ctypes.c_float * 12)(-1, -1, 0, 3, -1, 0, -1, 3, 0, 0, 0, 0)
    gl.EnableClientState(0x8074)
    gl.VertexPointer(3, 0x1406, 12, ctypes.cast(quad, ctypes.c_void_p))
    gl.DrawArrays(4, 0, 3)
    gl.Finish()
    gl.DisableClientState(0x8074)
    gl.UseProgram(0)
    return (time.perf_counter() - t0) * 1000


def cible(gl):
    tex, fbo = ctypes.c_uint(), ctypes.c_uint()
    gl.GenTextures(1, ctypes.byref(tex))
    gl.BindTexture(0x0DE1, tex.value)
    gl.TexImage2D(0x0DE1, 0, 0x881A, 64, 64, 0, 0x1908, 0x1406, None)   # RGBA16F
    gl.TexParameteri(0x0DE1, 0x2801, 0x2600); gl.TexParameteri(0x0DE1, 0x2800, 0x2600)
    gl.GenFramebuffers(1, ctypes.byref(fbo))
    gl.BindFramebuffer(0x8D40, fbo.value)
    gl.FramebufferTexture2D(0x8D40, 0x8CE0, 0x0DE1, tex.value, 0)
    gl.DrawBuffers(1, ctypes.cast((ctypes.c_uint * 1)(0x8CE0), ctypes.c_void_p))
    return fbo.value


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pack")
    ap.add_argument("--dimension", default="world0")
    ap.add_argument("--sans-jit", action="store_true")
    ap.add_argument("--json")
    ap.add_argument("--calcul", action="store_true", help="essaie aussi les shaders de calcul (.csh)")
    a = ap.parse_args()
    ctx = Contexte("compat")
    gl = ctx.gl
    t0 = time.perf_counter()
    pack = Pack(a.pack, a.dimension)
    t_lect = (time.perf_counter() - t0) * 1000
    fbo = cible(gl)
    res = []
    for nom in pack.programmes_du_profil():
        r = {"programme": nom, "ok": False}
        try:
            v = pack.sources_programme(nom, "vert")
            f = pack.sources_programme(nom, "frag")
            prog, t, log = gpu.construire_programme(gl, v, f)
            r.update(ok=True, **{k: round(x, 1) for k, x in t.items()})
            if log.strip():
                r["avertissements"] = log.strip().count("\n") + 1
            if not a.sans_jit:
                r["jit_ms"] = round(premier_dessin(gl, prog, fbo), 1)
        except gpu.ErreurCompilation as e:
            r["erreur"] = e.journal[:700]
        except Exception as e:
            r["erreur"] = "%s: %s" % (type(e).__name__, e)
        res.append(r)
    if a.calcul:
        for nom, p in pack.programmes.items():
            if p["csh"]:
                r = {"programme": nom + ".csh", "ok": False}
                try:
                    prog, t, log = gpu.construire_calcul(gl, pack.sources_programme(nom, "comp"))
                    r.update(ok=True, **{k: round(x, 1) for k, x in t.items()})
                except Exception as e:
                    r["erreur"] = str(e)[:500]
                res.append(r)
    ok = [r for r in res if r["ok"]]
    echecs = [r for r in res if not r["ok"]]
    resume = {
        "pack": pack.nom, "programmes": len(res), "ok": len(ok), "echecs": len(echecs), "lecture_pack_ms": round(t_lect),
        "compile_ms": round(sum(r.get("compile_ms", 0) for r in ok)), "lien_ms": round(sum(r.get("lien_ms", 0) for r in ok)),
        "jit_ms": round(sum(r.get("jit_ms", 0) for r in ok)), "options": len(pack.options), "uniformes_perso": len(pack.perso.liste),
        "notes": pack.notes[:5],
    }
    print(json.dumps(resume, ensure_ascii=False))
    for r in res:
        if r["ok"]:
            print("  OK  %-34s compile %6.0f ms  lien %6.0f ms  jit %6s ms" % (r["programme"], r["compile_ms"], r["lien_ms"], r.get("jit_ms", "-")))
        else:
            print("  ECHEC %-32s %s" % (r["programme"], r["erreur"].replace("\n", " | ")[:300]))
    if a.json:
        with open(a.json, "w", encoding="utf8") as f:
            json.dump({"resume": resume, "programmes": res}, f, ensure_ascii=False, indent=1)
    return 0 if not echecs else 2


if __name__ == "__main__":
    sys.exit(main())
