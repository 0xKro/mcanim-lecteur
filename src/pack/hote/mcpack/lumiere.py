"""Texture `lightmap` du pack (16 x 16 : x = lumiere de bloc, y = lumiere du ciel), a la maniere du jeu. Sans OpenGL (testable seul)."""


def pixels_lightmap(jour=1.0, mult_blocs=1.0):
    """Octets RGBA (16 x 16 x 4). jour : 1 le jour, 0 la nuit. mult_blocs : regle de scene monde.regles.lumiere.blocs
    (0 a 3, 1 = le jeu) : rendu seulement, multiplie la lumiere de bloc."""
    jour = max(0.0, min(1.0, float(jour)))
    mult_blocs = max(0.0, min(3.0, float(mult_blocs)))

    def courbe(v):
        v = v / 15.0
        return v / (4 - 3 * v)

    px = bytearray()
    for sky in range(16):
        for blk in range(16):
            b = courbe(blk) * mult_blocs
            s = courbe(sky) * (0.25 + 0.75 * jour)
            r = min(1.0, max(b, 0) + s * 0.95)
            g = min(1.0, b * 0.85 + s * 0.97)
            bl = min(1.0, b * 0.65 + s * 1.0)
            px += bytes((int(r * 255), int(g * 255), int(bl * 255), 255))
    return px
