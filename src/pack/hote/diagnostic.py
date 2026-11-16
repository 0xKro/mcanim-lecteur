# "Peut-on rendre avec un vrai pack ici ?" : ouvre un contexte OpenGL logiciel et affiche 4 lignes. Code de sortie 0 = oui.
import ctypes, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from egl import Contexte, ErreurGL


def chaine(gl, nom):
    p = gl.GetString(nom)
    return ctypes.string_at(p).decode() if p else '?'


def entier(gl, nom):
    v = (ctypes.c_int * 4)()
    gl.GetIntegerv(nom, v)
    return v[0]


def diagnostiquer():
    t0 = time.time()
    c = Contexte('compat')
    gl = c.gl
    return {
        'moteur': chaine(gl, 0x1F01), 'fournisseur': chaine(gl, 0x1F00), 'version': chaine(gl, 0x1F02),
        'glsl': chaine(gl, 0x8B8C), 'profil': c.profil, 'egl': c.egl_version,
        'texture_max': entier(gl, 0x0D33), 'attaches_max': entier(gl, 0x8CDF), 'tampons_max': entier(gl, 0x8824),
        'unites_max': entier(gl, 0x8872), 'ms': round((time.time() - t0) * 1000),
    }


def main():
    try:
        i = diagnostiquer()
    except ErreurGL as e:
        print("NON : " + str(e))
        return 1
    m = i['moteur'].lower()
    ok = 'llvmpipe' in m or 'softpipe' in m or 'swrast' in m
    print("rendu : %s (%s), EGL %s, profil %s" % (i['moteur'], i['fournisseur'], i['egl'], i['profil']))
    print("OpenGL %s | GLSL %s" % (i['version'], i['glsl']))
    print("limites : texture %d, cibles couleur %d, sorties MRT %d, unites de texture %d" % (i['texture_max'], i['attaches_max'], i['tampons_max'], i['unites_max']))
    print("verdict : %s (contexte en %d ms)" % ("OUI, rendu logiciel disponible" if ok else "ATTENTION, ce n'est pas un rasteriseur logiciel connu", i['ms']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
