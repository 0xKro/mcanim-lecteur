"""Lecture des fichiers `.properties` des packs (shaders.properties, block.properties...).

Format (documentation OptiFine/Iris) : `cle=valeur`, `#` commentaire, `\\` en fin de ligne = la ligne continue,
et un petit preprocesseur : `#if`, `#ifdef`, `#ifndef`, `#elif`, `#else`, `#endif`, `#define`, `#undef`, `#include`.
Les noms des #if sont les options du pack et les macros du jeu (MC_VERSION...). Rien ici n'est copie d'un pack.
"""
import re

_TOK = re.compile(r"\s*(defined\s*\(\s*\w+\s*\)|defined\s+\w+|[A-Za-z_]\w*|0[xX][0-9a-fA-F]+|\d+\.?\d*|&&|\|\||==|!=|<=|>=|<<|>>|[-+*/%()<>!~&|^?:])")


def evaluer_condition(texte, macros):
    """Evalue une condition de #if (entiers, comparaisons, defined, noms de macros). Un nom inconnu vaut 0."""
    texte = re.sub(r"//.*|/\*.*?\*/", "", texte).strip()
    pos, sortie = 0, []
    while pos < len(texte):
        m = _TOK.match(texte, pos)
        if not m:
            if texte[pos:].strip() == "":
                break
            raise ValueError("condition illisible : " + texte)
        pos = m.end()
        t = m.group(1)
        if t.startswith("defined"):
            nom = re.sub(r"defined|[()\s]", "", t)
            sortie.append("1" if nom in macros else "0")
        elif re.match(r"[A-Za-z_]", t):
            sortie.append(_valeur_macro(t, macros, 0))
        else:
            sortie.append(t)
    expr = " ".join(sortie)
    expr = expr.replace("&&", " and ").replace("||", " or ")
    expr = re.sub(r"!(?!=)", " not ", expr)
    expr = expr.replace("/", "//") if re.search(r"(?<!/)/(?!/)", expr) else expr
    if not re.fullmatch(r"[0-9a-fA-FxX\s.()+\-*/%<>=!&|^~andort]*", expr):
        raise ValueError("condition non sure : " + texte)
    try:
        return bool(eval(expr, {"__builtins__": {}}, {}))
    except Exception:
        return False


def _valeur_macro(nom, macros, profondeur):
    if nom in ("true", "True"):
        return "1"
    if nom in ("false", "False"):
        return "0"
    v = macros.get(nom)
    if v is None or profondeur > 8:
        return "0"
    v = str(v).strip()
    if v == "":
        return "1"
    try:
        float(v)
        return v
    except ValueError:
        if re.fullmatch(r"[A-Za-z_]\w*", v):
            return _valeur_macro(v, macros, profondeur + 1)
        return "0"


def preprocesser(texte, macros, lire_inclusion=None):
    """Applique #if/#define... sur un texte de propriete ; retourne les lignes gardees (continuations jointes)."""
    macros = dict(macros)
    brutes = texte.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    # jonction des continuations "\"
    lignes, cur = [], None
    for l in brutes:
        if cur is not None:
            cur += l.strip()
        else:
            cur = l
        if cur.rstrip().endswith("\\"):
            cur = cur.rstrip()[:-1] + " "
            continue
        lignes.append(cur)
        cur = None
    if cur is not None:
        lignes.append(cur)
    sortie = []
    pile = []   # (actif_parent, deja_pris, actif)
    actif = True
    for l in lignes:
        s = l.strip()
        m = re.match(r"#\s*(ifdef|ifndef|if|elif|else|endif|define|undef|include)\b(.*)", s)
        if not m:
            if actif:
                sortie.append(l)
            continue
        d, reste = m.group(1), m.group(2).strip()
        if d in ("if", "ifdef", "ifndef"):
            if d == "ifdef":
                c = reste.split()[0] in macros if reste else False
            elif d == "ifndef":
                c = reste.split()[0] not in macros if reste else False
            else:
                c = evaluer_condition(reste, macros) if actif else False
            pile.append((actif, c, actif and c))
            actif = actif and c
        elif d == "elif" and pile:
            par, pris, _ = pile[-1]
            c = par and not pris and evaluer_condition(reste, macros)
            pile[-1] = (par, pris or c, c)
            actif = c
        elif d == "else" and pile:
            par, pris, _ = pile[-1]
            c = par and not pris
            pile[-1] = (par, True, c)
            actif = c
        elif d == "endif" and pile:
            par, _, _ = pile.pop()
            actif = par
        elif actif and d == "define":
            p = reste.split(None, 1)
            if p:
                macros[p[0]] = p[1] if len(p) > 1 else ""
        elif actif and d == "undef":
            macros.pop(reste, None)
        elif actif and d == "include" and lire_inclusion:
            nom = reste.strip('"')
            sous = lire_inclusion(nom)
            if sous is not None:
                sortie.extend(preprocesser(sous, macros, lire_inclusion))
    return sortie


def lire(texte, macros, lire_inclusion=None):
    """Retourne un dict ordonne cle -> valeur (texte). Les cles repetees : la derniere gagne."""
    res = {}
    for l in preprocesser(texte, macros, lire_inclusion):
        s = l.strip()
        if not s or s.startswith("#") or s.startswith("!"):
            continue
        if "=" not in s:
            continue
        k, v = s.split("=", 1)
        res[k.strip()] = re.sub(r"\s+", " ", v.strip())
    return res
