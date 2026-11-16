# Processus "hote GL" : possede le contexte OpenGL logiciel (Mesa llvmpipe) et rend avec un vrai pack de shaders.
# Pilote par Node (src/pack/hote.js) : une ligne JSON par commande sur l'entree standard ; reponse = une ligne JSON sur la sortie
# standard, suivie, pour `rendre`, des octets RGBA bruts (largeur x hauteur x 4, ligne du haut d'abord).
# Mode essai (sans Node) : python3 -I hote.py --still --pack P --maillage D --etat etat.json --sortie image.png
import argparse, json, os, sys, time, traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def repondre(sortie, obj, octets=None):
    if octets:
        obj["ts"] = time.time() * 1000
    sortie.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf8"))
    if octets:
        sortie.write(octets)
    sortie.flush()


class Hote:
    def __init__(self):
        from egl import Contexte
        self.ctx = Contexte("compat")
        self.rendu = None

    def init(self, c):
        from mcpack.pack import Pack
        from mcpack.rendu import Rendu
        t0 = time.perf_counter()
        pack = Pack(c["pack"], c.get("dimension", "world0"), c.get("options"))
        self.rendu = Rendu(self.ctx, pack, int(c["largeur"]), int(c["hauteur"]), c.get("reglages"))
        if c.get("maillage"):
            self.rendu.charger_maillage(c["maillage"])
        return {"pack": pack.nom, "programmes": len(pack.programmes_du_profil()), "options": len(pack.options), "uniformesPerso": len(pack.perso.liste),
                "reglages": self.rendu.reglages, "ms": round((time.perf_counter() - t0) * 1000), "stats": self.rendu.stats, "notes": pack.notes + self.rendu.journal}

    def rendre(self, c):
        n = int(c.get("images", 1))
        r = self.rendu
        if c.get("reinit"):
            r.reinitialiser()
        if c.get("coupure") or c.get("reinit"):
            r.dernier = None      # plus d'image « precedente » : camera et matrices precedentes = celles d'ici
        raw = None
        e = dict(c["etat"])
        base = int(e.get("frame", 0))
        for k in range(n):
            e["frame"] = base + k
            if n > 1 and "temps" in e:
                e["temps"] = float(c["etat"].get("temps", 0.0)) + k * float(e.get("dt", 1.0 / 30.0))
            raw = r.rendre(e)
        force = r.force_octets
        if force:
            raw = raw + force
        return raw, {"temps": r.stats.get("dernier"), "manquants": sorted(r.manquants)[:80], "compile_ms": r.stats.get("compile_ms"), "masque": len(force) if force else 0,
                     "journal": r.journal[-6:]}


def boucle():
    sortie = os.fdopen(os.dup(1), "wb")
    os.dup2(2, 1)       # les messages perdus du pilote vont sur stderr, jamais dans le protocole
    try:
        h = Hote()
    except Exception as e:
        repondre(sortie, {"ok": False, "erreur": str(e)})
        return 1
    repondre(sortie, {"ok": True, "pret": True})
    for ligne in sys.stdin:
        ligne = ligne.strip()
        if not ligne:
            continue
        try:
            c = json.loads(ligne)
            if c["cmd"] == "init":
                repondre(sortie, {"ok": True, **h.init(c)})
            elif c["cmd"] == "rendre":
                raw, info = h.rendre(c)
                repondre(sortie, {"ok": True, "octets": len(raw), **info}, raw)
            elif c["cmd"] == "maillage-maj":
                repondre(sortie, {"ok": True, **h.rendu.mettre_a_jour_maillage(c["dossier"])})
            elif c["cmd"] == "precompiler":
                h.rendu.precompiler()
                repondre(sortie, {"ok": True, "compile_ms": h.rendu.stats.get("compile_ms")})
            elif c["cmd"] == "texture":
                h.rendu.dyn.ajouter_texture(c["id"], int(c["w"]), int(c["h"]), c["rgba"])
                repondre(sortie, {"ok": True})
            elif c["cmd"] == "masque":
                h.rendu.dyn.ajouter_masque(c["id"], int(c["w"]), int(c["h"]), c["octets"])
                repondre(sortie, {"ok": True})
            elif c["cmd"] == "fin":
                repondre(sortie, {"ok": True})
                return 0
            else:
                repondre(sortie, {"ok": False, "erreur": "commande inconnue : " + str(c["cmd"])})
        except Exception as e:
            traceback.print_exc()
            repondre(sortie, {"ok": False, "erreur": "%s: %s" % (type(e).__name__, e)})
    return 0


def essai(a):
    from mcpack import png
    h = Hote()
    etat = json.load(open(a.etat, encoding="utf8"))
    if a.largeur:
        etat["largeur"], etat["hauteur"] = a.largeur, a.hauteur
    info = h.init({"pack": a.pack, "largeur": etat["largeur"], "hauteur": etat["hauteur"], "maillage": a.maillage, "dimension": "world0"})
    print(json.dumps(info, ensure_ascii=False), file=sys.stderr)
    h.rendu.dump = [(d.split(":")[0], int(d.split(":")[1]), float(d.split(":")[2]) if d.count(":") > 1 else 1.0) for d in a.dump.split(",") if d]
    t0 = time.perf_counter()
    raw, st = h.rendre({"etat": etat, "images": a.images})
    print("rendu %d ms" % ((time.perf_counter() - t0) * 1000), json.dumps(st, ensure_ascii=False), file=sys.stderr)
    if a.perso:
        print(json.dumps(h.rendu.stats.get("perso"), ensure_ascii=False), file=sys.stderr)
        print(json.dumps(h.rendu.stats.get("erreurs_expr"), ensure_ascii=False), file=sys.stderr)
    png.ecrire(etat["largeur"], etat["hauteur"], raw, a.sortie)
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--still", action="store_true")
    ap.add_argument("--pack")
    ap.add_argument("--maillage")
    ap.add_argument("--etat")
    ap.add_argument("--images", type=int, default=1)
    ap.add_argument("--dump", default="")
    ap.add_argument("--perso", action="store_true")
    ap.add_argument("--largeur", type=int, default=0)
    ap.add_argument("--hauteur", type=int, default=0)
    ap.add_argument("--sortie", default="image.png")
    a = ap.parse_args()
    sys.exit(essai(a) if a.still else boucle())
