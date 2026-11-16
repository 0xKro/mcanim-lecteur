"""Petits outils OpenGL : compilation, edition de liens, uniforms actifs, textures, cibles de rendu."""
import ctypes
import time

GL_VERTEX_SHADER, GL_FRAGMENT_SHADER, GL_COMPUTE_SHADER = 0x8B31, 0x8B30, 0x91B9
GL_COMPILE_STATUS, GL_LINK_STATUS, GL_INFO_LOG_LENGTH = 0x8B81, 0x8B82, 0x8B84
GL_ACTIVE_UNIFORMS, GL_ACTIVE_UNIFORM_MAX_LENGTH = 0x8B86, 0x8B87
GL_ACTIVE_ATTRIBUTES, GL_ACTIVE_ATTRIBUTE_MAX_LENGTH = 0x8B89, 0x8B8A

TYPES_ECHANTILLONNEUR = {0x8B5E: "sampler2D", 0x8B62: "sampler2DShadow", 0x8B5F: "sampler3D", 0x8B60: "samplerCube", 0x8DC1: "sampler2DArray",
                         0x8DCA: "isampler2D", 0x8DD2: "usampler2D", 0x8B5D: "sampler1D"}
TYPES_UNIFORM = {0x1406: "float", 0x8B50: "vec2", 0x8B51: "vec3", 0x8B52: "vec4", 0x1404: "int", 0x8B53: "ivec2", 0x8B54: "ivec3", 0x8B55: "ivec4",
                 0x8B56: "bool", 0x8B5A: "mat2", 0x8B5B: "mat3", 0x8B5C: "mat4", 0x1405: "uint"}


class ErreurCompilation(Exception):
    def __init__(self, quoi, journal):
        super().__init__("%s : %s" % (quoi, journal[:1500]))
        self.journal = journal


def _journal(gl, obj, est_programme):
    n = ctypes.c_int(0)
    (gl.GetProgramiv if est_programme else gl.GetShaderiv)(obj, GL_INFO_LOG_LENGTH, ctypes.byref(n))
    if n.value <= 1:
        return ""
    buf = ctypes.create_string_buffer(n.value)
    (gl.GetProgramInfoLog if est_programme else gl.GetShaderInfoLog)(obj, n.value, None, buf)
    return buf.value.decode("utf-8", "replace")


def compiler(gl, type_, source):
    sh = gl.CreateShader(type_)
    b = ctypes.c_char_p(source.encode("utf-8"))
    arr = (ctypes.c_char_p * 1)(b)
    gl.ShaderSource(sh, 1, ctypes.cast(arr, ctypes.c_void_p), None)
    gl.CompileShader(sh)
    ok = ctypes.c_int(0)
    gl.GetShaderiv(sh, GL_COMPILE_STATUS, ctypes.byref(ok))
    log = _journal(gl, sh, False)
    if not ok.value:
        gl.DeleteShader(sh)
        raise ErreurCompilation("compilation", log)
    return sh, log


def lier(gl, shaders, attributs=None):
    prog = gl.CreateProgram()
    for s in shaders:
        gl.AttachShader(prog, s)
    for nom, idx in (attributs or {}).items():
        gl.BindAttribLocation(prog, idx, nom.encode())
    gl.LinkProgram(prog)
    ok = ctypes.c_int(0)
    gl.GetProgramiv(prog, GL_LINK_STATUS, ctypes.byref(ok))
    log = _journal(gl, prog, True)
    if not ok.value:
        gl.DeleteProgram(prog)
        raise ErreurCompilation("edition de liens", log)
    return prog, log


def construire_programme(gl, vsrc, fsrc, attributs=None):
    """Retourne (programme, {'compile_ms', 'lien_ms'}, journal)."""
    t0 = time.perf_counter()
    shs, logs = [], []
    try:
        for typ, src in ((GL_VERTEX_SHADER, vsrc), (GL_FRAGMENT_SHADER, fsrc)):
            if src is None:
                continue
            s, lg = compiler(gl, typ, src)
            shs.append(s)
            logs.append(lg)
    except ErreurCompilation:
        for s in shs:
            gl.DeleteShader(s)
        raise
    t1 = time.perf_counter()
    prog, lg = lier(gl, shs, attributs)
    for s in shs:
        gl.DeleteShader(s)
    logs.append(lg)
    t2 = time.perf_counter()
    return prog, {"compile_ms": (t1 - t0) * 1000, "lien_ms": (t2 - t1) * 1000}, "\n".join(l for l in logs if l)


def construire_calcul(gl, csrc):
    t0 = time.perf_counter()
    s, lg = compiler(gl, GL_COMPUTE_SHADER, csrc)
    t1 = time.perf_counter()
    prog, lg2 = lier(gl, [s])
    gl.DeleteShader(s)
    return prog, {"compile_ms": (t1 - t0) * 1000, "lien_ms": (time.perf_counter() - t1) * 1000}, lg + lg2


def uniforms_actifs(gl, prog):
    """[(nom, type_gl, taille, location)] sans les uniforms internes gl_*."""
    n = ctypes.c_int(0)
    gl.GetProgramiv(prog, GL_ACTIVE_UNIFORMS, ctypes.byref(n))
    mx = ctypes.c_int(0)
    gl.GetProgramiv(prog, GL_ACTIVE_UNIFORM_MAX_LENGTH, ctypes.byref(mx))
    res = []
    for i in range(n.value):
        buf = ctypes.create_string_buffer(max(64, mx.value))
        ln, sz, ty = ctypes.c_int(0), ctypes.c_int(0), ctypes.c_uint(0)
        gl.GetActiveUniform(prog, i, len(buf), ctypes.byref(ln), ctypes.byref(sz), ctypes.byref(ty), buf)
        nom = buf.value.decode()
        if nom.startswith("gl_"):
            continue
        loc = gl.GetUniformLocation(prog, nom.encode())
        res.append((nom, ty.value, sz.value, loc))
    return res


def attributs_actifs(gl, prog):
    n = ctypes.c_int(0)
    gl.GetProgramiv(prog, GL_ACTIVE_ATTRIBUTES, ctypes.byref(n))
    res = {}
    for i in range(n.value):
        buf = ctypes.create_string_buffer(128)
        ln, sz, ty = ctypes.c_int(0), ctypes.c_int(0), ctypes.c_uint(0)
        gl.GetActiveAttrib(prog, i, 128, ctypes.byref(ln), ctypes.byref(sz), ctypes.byref(ty), buf)
        nom = buf.value.decode()
        if not nom.startswith("gl_"):
            res[nom] = gl.GetAttribLocation(prog, nom.encode())
    return res


def verifier(gl, quoi=""):
    e = gl.GetError()
    if e:
        raise RuntimeError("erreur OpenGL 0x%x %s" % (e, quoi))
