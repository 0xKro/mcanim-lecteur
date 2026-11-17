# Le meme decor que maison.decor.json, ecrit avec decor.py : mcanim decor executer exemples/decor/maison.py --sortie maison2.decor.json
from decor import Decor

d = Decor(ancre=(-262, -668), niveau=73, graine=7, zone="W-BTYtCHIX2i6X16byJpog")
d.alias("p", "oak_planks")
d.alias("b", "cobblestone:6,mossy_cobblestone:1")
d.alias("l", "oak_log")
d.alias("v", "glass_pane")
d.alias("e", "spruce_stairs")
d.alias("d", "oak_door")
d.alias("t", "spruce_planks")

for etiquette in ("#leaves", "#logs"):               # la cour est degagee des arbres
    d.remplacer(-12, 0, -6, 12, 16, 12, etiquette, "air")
d.aplanir(-7, 2, -1, 4, 0, dessus="coarse_dirt", marge=1)
d.fond(0, 0, 6, 6, "b", profondeur=12, de=-2)
d.creux(0, -1, 0, 6, 3, 6, "p")
d.plein(0, -1, 0, 6, -1, 6, "b")
d.coins(0, 0, 6, 6, 0, 2, "l")
d.porte(0, 0, 3, "d", "ouest", ouverte=True)
d.pts("v", *[(x, 1, z) for x, z in ((2, 0), (4, 0), (2, 6), (4, 6), (6, 3), (0, 1), (0, 5))])
d.toit(0, 0, 6, 6, 4, "e", "x", pignon="t")
d.bloc(1, 0, 1, "red_bed", "sud")
d.bloc(5, 0, 1, "chest", "ouest")
d.bloc(5, 0, 5, "crafting_table")
d.bloc(3, 2, 3, "lantern")
d.ecrire()
