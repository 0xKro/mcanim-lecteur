"""block.properties / entity.properties / item.properties : `block.<id> = nom nom:prop=val,val ...` -> id numerique (mc_Entity.x).

Regles (idee reprise de horizon-shaders/block_ids.rs, MIT) : un nom sans espace de noms est `minecraft:` ; `:prop=v1,v2` = filtres
(les valeurs d'un filtre sont des alternatives, tous les filtres doivent coller) ; l'entree avec le plus de filtres gagne, puis la
premiere du fichier. Les etiquettes `%tag` sont ignorees (notees). Un bloc sans id recoit 0.
"""
import re


class IdMap:
    def __init__(self, proprietes, genre="block"):
        self.regles = {}    # nom -> liste de (id, filtres, ordre)
        self.notes = []
        self.couches = {}   # block.properties : layer.solid/cutout/cutout_mipped/translucent = noms
        pref = genre + "."
        ordre = 0
        for k, v in proprietes.items():
            if k.startswith("layer."):
                self.couches[k[6:]] = v.split()
                continue
            if not k.startswith(pref):
                continue
            try:
                ident = int(k[len(pref):])
            except ValueError:
                continue
            for mot in v.split():
                if mot.startswith("%"):
                    self.notes.append("etiquette ignoree : " + mot)
                    continue
                parts = mot.split(":")
                noms = [p for p in parts if "=" not in p]
                filtres = {}
                for p in parts:
                    if "=" in p:
                        a, b = p.split("=", 1)
                        filtres[a] = b.split(",")
                if len(noms) == 1:
                    nom = "minecraft:" + noms[0]
                elif len(noms) == 2:
                    nom = noms[0] + ":" + noms[1]
                else:
                    self.notes.append("nom illisible : " + mot)
                    continue
                ordre += 1
                self.regles.setdefault(nom, []).append((ident, filtres, ordre))

    def id(self, nom, props=None):
        """id du bloc `nom` ('minecraft:stone' ou 'stone') avec les proprietes d'etat `props` (dict) ; 0 si absent."""
        if ":" not in nom:
            nom = "minecraft:" + nom
        props = props or {}
        meilleur = None
        for ident, filtres, ordre in self.regles.get(nom, ()):
            if all(k in props and props[k] in vs for k, vs in filtres.items()):
                cle = (-len(filtres), ordre)
                if meilleur is None or cle < meilleur[0]:
                    meilleur = (cle, ident)
        return meilleur[1] if meilleur else 0

    def noms_simples(self):
        """Pour entity/item.properties : nom -> id (la premiere ligne qui le cite)."""
        sortie = {}
        for nom, rs in self.regles.items():
            for ident, filtres, ordre in sorted(rs, key=lambda r: r[2]):
                if not filtres:
                    sortie.setdefault(nom, ident)
        return sortie


def analyser_etat(chaine):
    """'minecraft:oak_leaves[distance=7,persistent=false]' -> ('minecraft:oak_leaves', {'distance': '7', ...})"""
    m = re.match(r"([^\[]+)(?:\[(.*)\])?$", chaine.strip())
    nom = m.group(1)
    props = {}
    if m.group(2):
        for kv in m.group(2).split(","):
            if "=" in kv:
                a, b = kv.split("=", 1)
                props[a.strip()] = b.strip()
    return nom, props
