"""Matrices 4x4 en colonnes (comme OpenGL) : liste de 16 nombres, m[colonne*4 + ligne]. Pur Python."""
import math

ID = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def mul(a, b):
    """a * b (b applique d'abord)."""
    r = [0.0] * 16
    for c in range(4):
        for l in range(4):
            r[c * 4 + l] = a[l] * b[c * 4] + a[4 + l] * b[c * 4 + 1] + a[8 + l] * b[c * 4 + 2] + a[12 + l] * b[c * 4 + 3]
    return r


def mul_vec(m, v):
    return [m[l] * v[0] + m[4 + l] * v[1] + m[8 + l] * v[2] + m[12 + l] * v[3] for l in range(4)]


def translation(x, y, z):
    m = list(ID)
    m[12], m[13], m[14] = x, y, z
    return m


def rot_x(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1.0]


def rot_y(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1.0]


def rot_z(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1.0]


def perspective(fov_deg, aspect, near, far):
    f = 1.0 / math.tan(math.radians(fov_deg) / 2)
    m = [0.0] * 16
    m[0], m[5] = f / aspect, f
    m[10], m[11] = (far + near) / (near - far), -1.0
    m[14] = 2 * far * near / (near - far)
    return m


def ortho(demi, near, far):
    """Projection orthographique centree, demi-largeur `demi` (cote a cote : -demi..demi), z de near a far (convention du jeu pour l'ombre)."""
    m = list(ID)
    m[0] = m[5] = 1.0 / demi
    m[10] = 1.0 / (near - far) * 2.0
    m[14] = near / (near - far) * 2.0 - 1.0
    return m


def inverse(m):
    """Inverse generale 4x4 (cofacteurs)."""
    a = [m[i * 4:(i + 1) * 4] for i in range(4)]  # colonnes
    # on travaille sur la matrice ligne : M[l][c] = m[c*4+l]
    M = [[m[c * 4 + l] for c in range(4)] for l in range(4)]
    n = 4
    aug = [M[i][:] + [1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]
    for i in range(n):
        p = max(range(i, n), key=lambda r: abs(aug[r][i]))
        if abs(aug[p][i]) < 1e-30:
            return list(ID)
        aug[i], aug[p] = aug[p], aug[i]
        d = aug[i][i]
        aug[i] = [v / d for v in aug[i]]
        for r in range(n):
            if r != i:
                f = aug[r][i]
                if f:
                    aug[r] = [x - f * y for x, y in zip(aug[r], aug[i])]
    inv = [row[n:] for row in aug]
    return [inv[l][c] for c in range(4) for l in range(4)]


def vue_camera(lacet, tangage):
    """Monde -> vue, camera a l'origine : Rx(tangage) * Ry(lacet + 180). Lacet 0 = regarde vers +z (sud), tangage > 0 = vers le bas."""
    return mul(rot_x(tangage), rot_y(lacet + 180.0))


def colonnes(m):
    """liste de 16 -> liste de 4 colonnes (pour l'evaluateur d'expressions : gbufferProjection.1.1 = colonne 1, ligne 1)."""
    return [tuple(m[c * 4:(c + 1) * 4]) for c in range(4)]


def sous_matrice3(m):
    return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
