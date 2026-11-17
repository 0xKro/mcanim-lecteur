"""decor.py : ecrire un decor Minecraft (fichier .decor.json) avec des boucles et des fonctions.

Ce module ne fait QUE ecrire le meme JSON que celui qu'on peut ecrire a la main (docs/FORMAT-DECOR.md). Il ne connait pas les blocs :
le lecteur controle tout (noms, proprietes, limites) avec `mcanim decor verifier`. Le lecteur n'execute JAMAIS ce script au rendu :
c'est le fichier produit qui compte (et qui entre dans l'empreinte de la scene).

Usage (Python 3.8 ou plus, aucune dependance) :

    from decor import Decor
    d = Decor(ancre=(-250, -640), graine=7)            # x, z du monde ; niveau="sol" : y=0 est la couche d'air au-dessus du sol de l'ancre
    d.alias("p", "oak_planks")                          # alias court ; melange : "cobblestone:6,mossy_cobblestone:1"
    d.aplanir(-1, -1, 7, 7, 0)                          # coupe et comble le terrain
    d.creux(0, -1, 0, 6, 3, 6, "p")                     # coque : sol y=-1, murs, plafond y=3
    for x in (2, 4):
        d.pts("glass_pane", (x, 1, 0), (x, 1, 6))      # fenetres
    d.porte(0, 0, 3, "oak_door", "ouest")               # deux moities posees, direction = cote EXTERIEUR
    d.toit(0, 0, 6, 6, 4, "spruce_stairs", "x")         # toit en escaliers : le lecteur choisit facing, half et shape
    with d.rep(3, 0, 0, 4):                             # repete le bloc d'operations 3 fois, decale de (0, 0, 4)
        d.bloc(3, 0, 1, "lantern")
    d.ecrire("maison.decor.json")                       # ou d.ecrire() quand le script est lance par `mcanim decor executer`

Directions : "nord" (-z), "sud" (+z), "est" (+x), "ouest" (-x), "haut", "bas", ou d.vers(x, z) ("tourne vers ce point").
Lancer : mcanim decor executer script.py --sortie maison.decor.json   (python -I, 20 s) puis mcanim decor verifier maison.decor.json --zone <id>
"""
import json
import os

__all__ = ["Decor", "vers"]


def vers(x, z):
    """Direction 'tournee vers' le point (x, z) du decor (relatif a l'ancre)."""
    return ["vers", int(x), int(z)]


class _Rep:
    """Contexte `with d.rep(n, dx, dy, dz):` : les operations ecrites dedans sont repetees n fois, decalees de (dx, dy, dz)."""

    def __init__(self, decor, n, dx, dy, dz):
        self.decor, self.n, self.d = decor, n, (dx, dy, dz)
        self.ops = []

    def __enter__(self):
        self.decor._piles.append(self.ops)
        return self

    def __exit__(self, type_, valeur, trace):
        self.decor._piles.pop()
        if type_ is None:
            self.decor._ajouter(["rep", int(self.n), int(self.d[0]), int(self.d[1]), int(self.d[2]), self.ops])
        return False


class Decor:
    def __init__(self, ancre, niveau="sol", rot=0, graine=0, zone=None, note=None):
        self.ancre, self.niveau, self.rot, self.graine, self.zone, self.note = list(ancre), niveau, rot, graine, zone, note
        self.pal = {}
        self.ops = []
        self._piles = [self.ops]

    # ---- palette
    def alias(self, nom, valeur):
        """Definit un alias : un nom de bloc (avec etats : oak_log[axis=x]) ou un melange pondere "a:3,b:1"."""
        self.pal[nom] = valeur
        return nom

    def _ajouter(self, op):
        self._piles[-1].append(op)
        return self

    @staticmethod
    def _opts(**kw):
        return {k: v for k, v in kw.items() if v is not None}

    # ---- formes
    def plein(self, x1, y1, z1, x2, y2, z2, b):
        return self._ajouter(["plein", x1, y1, z1, x2, y2, z2, b])

    def creux(self, x1, y1, z1, x2, y2, z2, b):
        return self._ajouter(["creux", x1, y1, z1, x2, y2, z2, b])

    def mur(self, x1, y1, z1, x2, y2, z2, b):
        return self._ajouter(["mur", x1, y1, z1, x2, y2, z2, b])

    def coins(self, x1, z1, x2, z2, y1, y2, b):
        return self._ajouter(["coins", x1, z1, x2, z2, y1, y2, b])

    def ligne(self, x1, y1, z1, x2, y2, z2, b):
        return self._ajouter(["ligne", x1, y1, z1, x2, y2, z2, b])

    def bloc(self, x, y, z, b, direction=None, **proprietes):
        """Un bloc. `direction` : mot, ou vers(x, z). `proprietes` : etats du jeu, par exemple half="top", open=True."""
        op = ["bloc", x, y, z, b]
        if direction is not None:
            op.append(direction)
        if proprietes:
            op.append(proprietes)
        return self._ajouter(op)

    def pts(self, b, *points):
        """Le meme bloc a plusieurs endroits : points (x, y, z) ou (x, y, z, direction)."""
        return self._ajouter(["pts", b] + [list(p) for p in points])

    def remplacer(self, x1, y1, z1, x2, y2, z2, ancien, nouveau):
        """`ancien` : "*" (tout sauf l'air), un nom, "#etiquette" (ex. "#leaves"), un alias ou une liste de ces textes."""
        return self._ajouter(["remplacer", x1, y1, z1, x2, y2, z2, ancien, nouveau])

    def effacer(self, x1, y1, z1, x2, y2, z2):
        return self._ajouter(["effacer", x1, y1, z1, x2, y2, z2])

    # ---- terrain
    def fond(self, x1, z1, x2, z2, b, profondeur=None, de=None):
        """Fondation : de y=`de` (defaut -1) vers le bas jusqu'au terrain plein (au plus `profondeur`, defaut 12)."""
        op = ["fond", x1, z1, x2, z2, b]
        o = self._opts(profondeur=profondeur, de=de)
        if o:
            op.append(o)
        return self._ajouter(op)

    def aplanir(self, x1, z1, x2, z2, y, dessus=None, dessous=None, marge=None):
        """Coupe le terrain a partir de y et comble dessous ; `marge` : pente douce autour."""
        op = ["aplanir", x1, z1, x2, z2, y]
        o = self._opts(dessus=dessus, dessous=dessous, marge=marge)
        if o:
            op.append(o)
        return self._ajouter(op)

    # ---- pieces
    def porte(self, x, y, z, b, direction, ouverte=None, charniere=None):
        """Porte a deux moities. `direction` = le cote exterieur ; ouverte=True : les acteurs passent ; charniere="droite"."""
        op = ["porte", x, y, z, b, direction]
        o = self._opts(ouverte=ouverte, charniere=charniere)
        if o:
            op.append(o)
        return self._ajouter(op)

    def toit(self, x1, z1, x2, z2, y, b, axe, faite=None, pignon=None, debord=None, forme=None):
        """Toit en escaliers sur l'emprise des murs. axe "x" ou "z" = sens du faite ; forme="croupe" : quatre pans."""
        op = ["toit", x1, z1, x2, z2, y, b, axe]
        o = self._opts(faite=faite, pignon=pignon, debord=debord, forme=forme)
        if o:
            op.append(o)
        return self._ajouter(op)

    def rep(self, n, dx=0, dy=0, dz=0):
        """A utiliser avec `with` : les operations du bloc sont repetees n fois, decalees de (dx, dy, dz)."""
        return _Rep(self, n, dx, dy, dz)

    @staticmethod
    def vers(x, z):
        return vers(x, z)

    # ---- sortie
    def dict(self):
        d = {"v": 1}
        if self.zone:
            d["zone"] = self.zone
        d["ancre"] = self.ancre
        d["niveau"] = self.niveau
        if self.rot:
            d["rot"] = self.rot
        if self.graine:
            d["graine"] = self.graine
        if self.note:
            d["note"] = self.note
        if self.pal:
            d["pal"] = self.pal
        d["ops"] = self.ops
        return d

    def json(self, indent=None):
        if indent is None:
            return json.dumps(self.dict(), ensure_ascii=False, separators=(",", ":"))
        return json.dumps(self.dict(), ensure_ascii=False, indent=indent)

    def ecrire(self, chemin=None):
        """Ecrit le fichier .decor.json. Sans chemin : le fichier demande par `mcanim decor executer --sortie`."""
        cibles = []
        if chemin:
            cibles.append(chemin)
        env = os.environ.get("MCANIM_DECOR_SORTIE")
        if env and env not in cibles:
            cibles.append(env)
        if not cibles:
            raise ValueError("ecrire(chemin) : donne le nom du fichier, par exemple d.ecrire('maison.decor.json')")
        for c in cibles:
            with open(c, "w", encoding="utf-8", newline="\n") as f:
                f.write(self.json())
        return cibles[0]
