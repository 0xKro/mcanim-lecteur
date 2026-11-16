"""Expressions des uniforms personnalises : `uniform.<type>.<nom> = expression` et `variable.<type>.<nom> = expression`.

Langage (documentation Iris) : nombres, operateurs `+ - * / % ! && || == != < > <= >=`, parentheses, fonctions
(`if`, `smooth`, `in`, `equals`, `between`, `clamp`, `sin`...), `vec2/vec3/vec4`, noms d'uniforms du jeu (`sunPosition`, `frameCounter`),
acces aux composantes (`skyColor.r`, `eyeBrightness.y`) et aux matrices (`gbufferProjection.1.1` = colonne 1, ligne 1).
Valeurs : un nombre (float) ou un tuple de 2 a 4 nombres ; une matrice = liste de 4 colonnes (tuples de 4).
Les erreurs ne plantent pas : l'expression vaut 0 et on la signale une fois.
"""
import math
import re

_TOK = re.compile(r"\s*(\d+\.\d*(?:[eE][-+]?\d+)?[fF]?|\.\d+(?:[eE][-+]?\d+)?[fF]?|\d+(?:[eE][-+]?\d+)?[fF]?|[A-Za-z_]\w*(?:\.\w+)*|&&|\|\||==|!=|<=|>=|[-+*/%()<>!,?:])")
_COMP = {"x": 0, "y": 1, "z": 2, "w": 3, "r": 0, "g": 1, "b": 2, "a": 3, "s": 0, "t": 1, "p": 2, "q": 3}


class ErreurExpr(ValueError):
    pass


def _tokens(texte):
    texte = re.sub(r"//.*", "", texte).strip()
    pos, out = 0, []
    while pos < len(texte):
        m = _TOK.match(texte, pos)
        if not m:
            raise ErreurExpr("caractere inattendu dans : " + texte[pos:pos + 20])
        out.append(m.group(1))
        pos = m.end()
    return out


class _Parseur:
    PRIO = {"||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, ">": 4, "<=": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6}

    def __init__(self, toks):
        self.t, self.i = toks, 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else None

    def prendre(self, attendu=None):
        v = self.peek()
        if v is None or (attendu and v != attendu):
            raise ErreurExpr("attendu %r, trouve %r" % (attendu, v))
        self.i += 1
        return v

    def expression(self, pmin=1):
        g = self.unaire()
        while True:
            op = self.peek()
            p = self.PRIO.get(op)
            if p is None or p < pmin:
                break
            self.i += 1
            d = self.expression(p + 1)
            g = ("bin", op, g, d)
        if pmin == 1 and self.peek() == "?":
            self.i += 1
            a = self.expression()
            self.prendre(":")
            b = self.expression()
            g = ("call", "if", [g, a, b])
        return g

    def unaire(self):
        t = self.peek()
        if t == "-":
            self.i += 1
            return ("neg", self.unaire())
        if t == "+":
            self.i += 1
            return self.unaire()
        if t == "!":
            self.i += 1
            return ("not", self.unaire())
        return self.primaire()

    def primaire(self):
        t = self.prendre()
        if t == "(":
            e = self.expression()
            self.prendre(")")
            return e
        if re.match(r"[\d.]", t):
            return ("num", float(t.rstrip("fF")))
        if re.match(r"[A-Za-z_]", t):
            if self.peek() == "(":
                self.i += 1
                args = []
                if self.peek() != ")":
                    args.append(self.expression())
                    while self.peek() == ",":
                        self.i += 1
                        args.append(self.expression())
                self.prendre(")")
                nom = t
                suite = None
                if "." in nom:   # f(...).x impossible apres le jeton : "nom.x(" non attendu
                    raise ErreurExpr("appel inattendu : " + nom)
                return ("call", nom, args)
            return ("nom", t)
        raise ErreurExpr("jeton inattendu : " + t)


def parser(texte):
    p = _Parseur(_tokens(texte))
    e = p.expression()
    if p.peek() is not None:
        raise ErreurExpr("reste inattendu : " + str(p.peek()))
    return e


def _vec(v):
    return v if isinstance(v, tuple) else (v,)


def _zip(f, a, b):
    if isinstance(a, tuple) or isinstance(b, tuple):
        a, b = _vec(a), _vec(b)
        n = max(len(a), len(b))
        a = a * n if len(a) == 1 else a
        b = b * n if len(b) == 1 else b
        return tuple(f(x, y) for x, y in zip(a, b))
    return f(a, b)


def _map(f, a):
    return tuple(f(x) for x in a) if isinstance(a, tuple) else f(a)


def _x(v):
    return v[0] if isinstance(v, tuple) else v


def _fmod(a, b):
    return math.fmod(a, b) if b != 0 else 0.0


_OPS = {
    "+": lambda a, b: a + b, "-": lambda a, b: a - b, "*": lambda a, b: a * b,
    "/": lambda a, b: a / b if b != 0 else 0.0, "%": _fmod,
}
_CMP = {"==": lambda a, b: a == b, "!=": lambda a, b: a != b, "<": lambda a, b: a < b, ">": lambda a, b: a > b, "<=": lambda a, b: a <= b, ">=": lambda a, b: a >= b}


def _fsafe(f):
    def g(*a):
        try:
            return f(*a)
        except (ValueError, OverflowError, ZeroDivisionError):
            return 0.0
    return g


_FN1 = {
    "sin": math.sin, "cos": math.cos, "tan": math.tan, "asin": _fsafe(math.asin), "acos": _fsafe(math.acos), "atan": math.atan,
    "sinh": _fsafe(math.sinh), "cosh": _fsafe(math.cosh), "tanh": math.tanh, "sqrt": _fsafe(math.sqrt), "exp": _fsafe(math.exp),
    "log": _fsafe(math.log), "log10": _fsafe(math.log10), "abs": abs, "floor": math.floor, "ceil": math.ceil,
    "frac": lambda x: x - math.floor(x), "signum": lambda x: (x > 0) - (x < 0), "toRadians": math.radians, "toDegrees": math.degrees,
    "round": lambda x: math.floor(x + 0.5), "trunc": math.trunc,
}


class Evaluateur:
    """Evalue les expressions dans l'ordre du fichier. `env` : nom -> valeur (nombre, tuple, ou matrice)."""

    def __init__(self):
        self.etat_smooth = {}
        self.avert = set()
        self.dt = 0.0
        self.image = False       # True : une image fixe, `smooth` donne directement la cible (pas d'historique)
        self.compteur = 0

    def eval(self, ast, env, cle="?"):
        self.compteur = 0
        try:
            return self._e(ast, env, cle)
        except (ErreurExpr, KeyError, TypeError, IndexError, ValueError) as e:
            if cle not in self.avert:
                self.avert.add(cle)
                self.dernieres_erreurs = getattr(self, "dernieres_erreurs", []) + ["%s : %s" % (cle, e)]
            return 0.0

    def _e(self, n, env, cle):
        k = n[0]
        if k == "num":
            return n[1]
        if k == "nom":
            return self._nom(n[1], env)
        if k == "neg":
            return _map(lambda x: -x, self._e(n[1], env, cle))
        if k == "not":
            return 0.0 if _x(self._e(n[1], env, cle)) else 1.0
        if k == "bin":
            op = n[1]
            if op == "&&":
                return 1.0 if (_x(self._e(n[2], env, cle)) and _x(self._e(n[3], env, cle))) else 0.0
            if op == "||":
                return 1.0 if (_x(self._e(n[2], env, cle)) or _x(self._e(n[3], env, cle))) else 0.0
            a, b = self._e(n[2], env, cle), self._e(n[3], env, cle)
            if op in _CMP:
                return 1.0 if _CMP[op](_x(a), _x(b)) else 0.0
            return _zip(_OPS[op], a, b)
        if k == "call":
            return self._appel(n[1], n[2], env, cle)
        raise ErreurExpr("noeud inconnu")

    def _nom(self, nom, env):
        if nom in ("true",):
            return 1.0
        if nom in ("false",):
            return 0.0
        if nom == "pi":
            return math.pi
        parts = nom.split(".")
        base = parts[0]
        if base not in env:
            raise ErreurExpr("nom inconnu : " + base)
        v = env[base]
        for p in parts[1:]:
            if isinstance(v, list):          # matrice : .colonne
                v = v[int(p)]
            elif p.isdigit():
                v = v[int(p)]
            else:
                idx = [_COMP[c] for c in p]
                v = v[idx[0]] if len(idx) == 1 else tuple(v[i] for i in idx)
        return float(v) if isinstance(v, (int, bool)) else v

    def _appel(self, f, args, env, cle):
        if f == "if":
            i = 0
            while i + 1 < len(args):
                if _x(self._e(args[i], env, cle)):
                    return self._e(args[i + 1], env, cle)
                i += 2
            return self._e(args[i], env, cle) if i < len(args) else 0.0
        if f == "smooth":
            return self._smooth(args, env, cle)
        a = [self._e(x, env, cle) for x in args]
        if f in ("vec2", "vec3", "vec4"):
            n = int(f[3])
            flat = []
            for v in a:
                flat.extend(_vec(v))
            if len(flat) == 1:
                flat = flat * n
            return tuple(flat[:n])
        if f in ("float", "int"):
            return float(int(_x(a[0]))) if f == "int" else float(_x(a[0]))
        if f == "bool":
            return 1.0 if _x(a[0]) else 0.0
        if f == "in":
            x = _x(a[0])
            return 1.0 if any(x == _x(v) for v in a[1:]) else 0.0
        if f == "equals":
            return 1.0 if abs(_x(a[0]) - _x(a[1])) <= (_x(a[2]) if len(a) > 2 else 1e-6) else 0.0
        if f == "between":
            return 1.0 if _x(a[1]) <= _x(a[0]) <= _x(a[2]) else 0.0
        if f in _FN1:
            return _map(_FN1[f], a[0])
        if f == "pow":
            return _zip(_fsafe(math.pow), a[0], a[1])
        if f == "atan2":
            return math.atan2(_x(a[0]), _x(a[1]))
        if f == "min":
            return _zip(min, a[0], a[1])
        if f == "max":
            return _zip(max, a[0], a[1])
        if f == "clamp":
            return _zip(lambda v, lo: max(v, lo), _zip(lambda v, hi: min(v, hi), a[0], a[2]), a[1])
        if f == "lerp" or f == "mix":
            return _zip(lambda x, y: x + (y - x) * _x(a[2]), a[0], a[1])
        if f == "fmod":
            return _zip(_fmod, a[0], a[1])
        if f == "random":
            return 0.5
        raise ErreurExpr("fonction inconnue : " + f)

    def _smooth(self, args, env, cle):
        # smooth([id,] valeur, tempsMontee, tempsDescente) ; temps en dixiemes de seconde (demi-vie)
        if len(args) >= 4:
            args = args[1:]
        cible = _x(self._e(args[0], env, cle))
        montee = _x(self._e(args[1], env, cle)) if len(args) > 1 else 1.0
        descente = _x(self._e(args[2], env, cle)) if len(args) > 2 else montee
        e = self.etat_smooth.get(cle)
        if self.image or e is None:
            self.etat_smooth[cle] = cible
            return cible
        delai = (montee if cible > e else descente) * 0.1
        a = 1.0 if delai <= 0 else 1.0 - 0.5 ** (self.dt / delai)
        v = e + (cible - e) * a
        self.etat_smooth[cle] = v
        return v


def convertir(valeur, type_):
    """Prend la valeur de l'expression et la met au type declare."""
    if type_ == "bool":
        return 1 if _x(valeur) else 0
    if type_ == "int":
        return int(_x(valeur))
    if type_ == "float":
        return float(_x(valeur))
    n = int(type_[3]) if type_.startswith("vec") else 1
    v = _vec(valeur)
    if len(v) < n:
        v = (v * n)[:n] if len(v) == 1 else v + (0.0,) * (n - len(v))
    return tuple(float(x) for x in v[:n])


class UniformsPerso:
    """Les `uniform.*` et `variable.*` d'un pack, evalues dans l'ordre du fichier."""

    def __init__(self, proprietes):
        self.liste = []      # (genre, type, nom, ast, texte)
        self.erreurs = []
        for k, v in proprietes.items():
            m = re.match(r"(uniform|variable)\.(float|int|bool|vec2|vec3|vec4)\.(\w+)$", k)
            if not m:
                continue
            try:
                self.liste.append((m.group(1), m.group(2), m.group(3), parser(v), v))
            except ErreurExpr as e:
                self.erreurs.append("%s : %s" % (k, e))
        self.ev = Evaluateur()

    def evaluer(self, env, dt=0.0, image=True):
        """env : uniforms du jeu. Retourne le dict des uniforms personnalises (nom -> valeur typee) ; les variables restent internes."""
        self.ev.dt, self.ev.image = dt, image
        local = dict(env)
        sortie = {}
        for genre, typ, nom, ast, _ in self.liste:
            v = convertir(self.ev.eval(ast, local, nom), typ)
            local[nom] = v
            if genre == "uniform":
                sortie[nom] = (typ, v)
        return sortie
