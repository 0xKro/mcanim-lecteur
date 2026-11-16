# Contexte OpenGL sans fenetre : EGL "surfaceless" sur Mesa (llvmpipe), uniquement avec ctypes (aucun paquet pip).
# Tout le reste de l'hote passe par `gl` (fonctions OpenGL chargees avec eglGetProcAddress).
import ctypes, ctypes.util, os, sys

EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT = 0x3033, 0x0001, 0x3040, 0x0008
EGL_NONE, EGL_OPENGL_API = 0x3038, 0x30A2
EGL_PLATFORM_SURFACELESS_MESA = 0x31DD
EGL_CONTEXT_MAJOR_VERSION, EGL_CONTEXT_MINOR_VERSION = 0x3098, 0x30FB
EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_COMPAT_BIT, EGL_CORE_BIT = 0x30FD, 0x2, 0x1
EGL_WIDTH, EGL_HEIGHT = 0x3057, 0x3056

class ErreurGL(RuntimeError):
    pass

def _charger(noms):
    for n in noms:
        try:
            return ctypes.CDLL(n)
        except OSError:
            pass
    trouve = ctypes.util.find_library(noms[0].split('.so')[0].replace('lib', '', 1))
    if trouve:
        return ctypes.CDLL(trouve)
    raise ErreurGL("bibliotheque introuvable : " + " / ".join(noms))

class Contexte:
    """Cree un contexte GL compatibilite (sinon core) sur le rasteriseur logiciel de Mesa."""
    def __init__(self, profil='compat', version=(4, 5)):
        try:
            self.egl = _charger(['libEGL.so.1', 'libEGL.so'])
        except ErreurGL:
            raise ErreurGL("libEGL.so.1 est absente : le rendu avec un vrai pack demande Mesa (sur Ubuntu : apt-get install -y libegl1 libgl1-mesa-dri libgl1)")
        e = self.egl
        e.eglGetProcAddress.restype = ctypes.c_void_p
        e.eglGetProcAddress.argtypes = [ctypes.c_char_p]
        e.eglInitialize.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int)]
        e.eglChooseConfig.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_void_p), ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
        e.eglCreateContext.restype = ctypes.c_void_p
        e.eglCreateContext.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
        e.eglCreatePbufferSurface.restype = ctypes.c_void_p
        e.eglCreatePbufferSurface.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
        e.eglMakeCurrent.argtypes = [ctypes.c_void_p] * 4
        e.eglQueryString.restype = ctypes.c_char_p
        e.eglQueryString.argtypes = [ctypes.c_void_p, ctypes.c_int]
        e.eglGetError.restype = ctypes.c_int
        os.environ.setdefault('MESA_GL_VERSION_OVERRIDE', '')  # pas de forcage : on lit ce que Mesa donne
        if not os.environ['MESA_GL_VERSION_OVERRIDE']:
            del os.environ['MESA_GL_VERSION_OVERRIDE']
        os.environ.setdefault('LIBGL_ALWAYS_SOFTWARE', '1')
        os.environ.setdefault('GALLIUM_DRIVER', 'llvmpipe')
        gpad = e.eglGetProcAddress(b'eglGetPlatformDisplayEXT')
        self.dpy = None
        if gpad:
            f = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)(gpad)
            self.dpy = f(EGL_PLATFORM_SURFACELESS_MESA, None, None)
        if not self.dpy:
            e.eglGetDisplay.restype = ctypes.c_void_p
            e.eglGetDisplay.argtypes = [ctypes.c_void_p]
            self.dpy = e.eglGetDisplay(None)
        if not self.dpy:
            raise ErreurGL("EGL : aucun affichage (display) disponible")
        maj, mi = ctypes.c_int(), ctypes.c_int()
        if not e.eglInitialize(self.dpy, ctypes.byref(maj), ctypes.byref(mi)):
            raise ErreurGL("EGL : eglInitialize a echoue (erreur 0x%x)" % e.eglGetError())
        self.egl_version = "%d.%d" % (maj.value, mi.value)
        self.egl_fournisseur = (e.eglQueryString(self.dpy, 0x3053) or b'').decode()
        attr = (ctypes.c_int * 5)(EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT, EGL_NONE)
        cfg, n = ctypes.c_void_p(), ctypes.c_int()
        if not e.eglChooseConfig(self.dpy, attr, ctypes.byref(cfg), 1, ctypes.byref(n)) or n.value < 1:
            raise ErreurGL("EGL : aucune configuration OpenGL de bureau (eglChooseConfig)")
        if not e.eglBindAPI(EGL_OPENGL_API):
            raise ErreurGL("EGL : OpenGL de bureau indisponible (eglBindAPI)")
        self.ctx = None
        essais = [(profil, version)] if profil != 'compat' else [('compat', version), ('core', version)]
        for p, v in essais:
            a = (ctypes.c_int * 9)(EGL_CONTEXT_MAJOR_VERSION, v[0], EGL_CONTEXT_MINOR_VERSION, v[1],
                                   EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_COMPAT_BIT if p == 'compat' else EGL_CORE_BIT, EGL_NONE, 0, 0)
            c = e.eglCreateContext(self.dpy, cfg, None, a)
            if c:
                self.ctx, self.profil = c, p
                break
        if not self.ctx:
            raise ErreurGL("EGL : impossible de creer un contexte OpenGL %d.%d (erreur 0x%x)" % (version[0], version[1], e.eglGetError()))
        # petite surface pbuffer pour etre sur d'avoir un contexte "courant" meme sans l'extension surfaceless
        pb = (ctypes.c_int * 5)(EGL_WIDTH, 1, EGL_HEIGHT, 1, EGL_NONE)
        self.surf = e.eglCreatePbufferSurface(self.dpy, cfg, pb)
        if not e.eglMakeCurrent(self.dpy, self.surf, self.surf, self.ctx):
            raise ErreurGL("EGL : eglMakeCurrent a echoue (erreur 0x%x)" % e.eglGetError())
        self.gl = GL(e)

# Signatures : "retour:arguments" ; u=uint32 i=int32 f=float d=double p=pointeur s=chaine v=rien I=int64 (taille/decalage)
SIG = {
 'GetString': 'p:u', 'GetIntegerv': 'v:up', 'GetFloatv': 'v:up', 'GetError': 'u:', 'Enable': 'v:u', 'Disable': 'v:u', 'Finish': 'v:', 'Flush': 'v:',
 'GetStringi': 'p:uu',
 'Viewport': 'v:iiii', 'Scissor': 'v:iiii', 'ClearColor': 'v:ffff', 'ClearDepth': 'v:d', 'Clear': 'v:u', 'ClearBufferfv': 'v:uip', 'ClearBufferfi': 'v:uifi',
 'DepthFunc': 'v:u', 'DepthMask': 'v:u', 'ColorMask': 'v:uuuu', 'CullFace': 'v:u', 'FrontFace': 'v:u', 'BlendFunc': 'v:uu', 'BlendFuncSeparate': 'v:uuuu',
 'BlendFunci': 'v:uuu', 'BlendFuncSeparatei': 'v:uuuuu', 'Disablei': 'v:uu', 'Enablei': 'v:uu', 'BlendEquation': 'v:u', 'PolygonOffset': 'v:ff', 'ColorMaski': 'v:uuuuu',
 'GenTextures': 'v:ip', 'DeleteTextures': 'v:ip', 'BindTexture': 'v:uu', 'ActiveTexture': 'v:u', 'TexParameteri': 'v:uui', 'TexParameterf': 'v:uuf', 'TexParameterfv': 'v:uup',
 'TexImage2D': 'v:uiiiiiuup', 'TexSubImage2D': 'v:uiiiiiuup', 'TexImage3D': 'v:uiiiiiiuup', 'GenerateMipmap': 'v:u', 'PixelStorei': 'v:ui', 'ReadPixels': 'v:iiiiuup',
 'GenFramebuffers': 'v:ip', 'DeleteFramebuffers': 'v:ip', 'BindFramebuffer': 'v:uu', 'FramebufferTexture2D': 'v:uuuui', 'CheckFramebufferStatus': 'u:u', 'DrawBuffers': 'v:ip', 'ReadBuffer': 'v:u', 'DrawBuffer': 'v:u',
 'BlitFramebuffer': 'v:iiiiiiiiuu', 'FramebufferTextureLayer': 'v:uuuii',
 'CreateShader': 'u:u', 'ShaderSource': 'v:uipp', 'CompileShader': 'v:u', 'GetShaderiv': 'v:uup', 'GetShaderInfoLog': 'v:uipp', 'DeleteShader': 'v:u',
 'CreateProgram': 'u:', 'AttachShader': 'v:uu', 'LinkProgram': 'v:u', 'GetProgramiv': 'v:uup', 'GetProgramInfoLog': 'v:uipp', 'UseProgram': 'v:u', 'DeleteProgram': 'v:u',
 'BindAttribLocation': 'v:uus', 'GetUniformLocation': 'i:us', 'GetAttribLocation': 'i:us', 'GetActiveUniform': 'v:uuipppp', 'GetActiveAttrib': 'v:uuipppp',
 'Uniform1i': 'v:ii', 'Uniform1f': 'v:if', 'Uniform2f': 'v:iff', 'Uniform3f': 'v:ifff', 'Uniform4f': 'v:iffff', 'Uniform2i': 'v:iii', 'Uniform3i': 'v:iiii', 'Uniform4i': 'v:iiiii',
 'UniformMatrix3fv': 'v:iiup', 'UniformMatrix4fv': 'v:iiup', 'Uniform1fv': 'v:iip', 'Uniform1iv': 'v:iip',
 'GenBuffers': 'v:ip', 'DeleteBuffers': 'v:ip', 'BindBuffer': 'v:uu', 'BufferData': 'v:uIpu', 'BufferSubData': 'v:uIIp',
 'EnableVertexAttribArray': 'v:u', 'DisableVertexAttribArray': 'v:u', 'VertexAttribPointer': 'v:uiuuip', 'VertexAttribIPointer': 'v:uiuip', 'VertexAttrib4f': 'v:uffff',
 'GenVertexArrays': 'v:ip', 'BindVertexArray': 'v:u', 'DeleteVertexArrays': 'v:ip',
 'DrawArrays': 'v:uii', 'DrawElements': 'v:uiup', 'DrawElementsBaseVertex': 'v:uiupi', 'DrawElementsInstanced': 'v:uiupi',
 'MatrixMode': 'v:u', 'LoadIdentity': 'v:', 'LoadMatrixf': 'v:p', 'MultMatrixf': 'v:p', 'Color4f': 'v:ffff', 'Normal3f': 'v:fff', 'MultiTexCoord4f': 'v:uffff', 'VertexAttrib3f': 'v:ufff',
 'ClientActiveTexture': 'v:u', 'LightModelfv': 'v:up', 'Fogf': 'v:uf', 'Fogfv': 'v:up', 'Fogi': 'v:ui',
 'BindImageTexture': 'v:uuiuuu', 'TexStorage2D': 'v:uiuii', 'TextureBarrier': 'v:', 'GetTexLevelParameteriv': 'v:uiup', 'GetTexImage': 'v:uiuup',
 'FramebufferParameteri': 'v:uui', 'GenQueries': 'v:ip', 'BeginQuery': 'v:uu', 'EndQuery': 'v:u', 'GetQueryObjectui64v': 'v:uup', 'SamplerParameteri': 'v:uui', 'GenSamplers': 'v:ip', 'BindSampler': 'v:uu',
 'VertexPointer': 'v:iuip', 'NormalPointer': 'v:uip', 'ColorPointer': 'v:iuip', 'TexCoordPointer': 'v:iuip', 'EnableClientState': 'v:u', 'DisableClientState': 'v:u',
 'DispatchCompute': 'v:uuu', 'DeleteSamplers': 'v:ip', 'SamplerParameterf': 'v:uuf', 'TexParameteriv': 'v:uup', 'ClearTexImage': 'v:uiuup', 'GetTexParameteriv': 'v:uup',
 'PushMatrix': 'v:', 'PopMatrix': 'v:', 'Ortho': 'v:dddddd', 'LoadMatrixd': 'v:p', 'GetUniformfv': 'v:uip',
 'DepthRange': 'v:dd', 'ClipControl': 'v:uu', 'LineWidth': 'v:f', 'PointSize': 'v:f', 'LogicOp': 'v:u', 'AlphaFunc': 'v:uf', 'Hint': 'v:uu',
}
_C = {'u': ctypes.c_uint32, 'i': ctypes.c_int32, 'f': ctypes.c_float, 'd': ctypes.c_double, 'p': ctypes.c_void_p, 's': ctypes.c_char_p, 'I': ctypes.c_ssize_t, 'v': None}

class GL:
    """gl.Nom(...) : le pointeur est cherche au premier appel (eglGetProcAddress, puis libGL)."""
    def __init__(self, egl):
        self._egl = egl
        self._f = {}
        try:
            self._libgl = ctypes.CDLL('libGL.so.1')
        except OSError:
            self._libgl = None
    def __getattr__(self, nom):
        if nom.startswith('_'):
            raise AttributeError(nom)
        sig = SIG.get(nom)
        if sig is None:
            raise AttributeError("signature GL inconnue : " + nom)
        p = self._egl.eglGetProcAddress(('gl' + nom).encode())
        if not p and self._libgl is not None:
            try:
                p = ctypes.cast(getattr(self._libgl, 'gl' + nom), ctypes.c_void_p).value
            except AttributeError:
                p = None
        if not p:
            raise ErreurGL("fonction OpenGL absente : gl" + nom)
        ret, args = sig.split(':')
        f = ctypes.CFUNCTYPE(_C[ret], *[_C[c] for c in args])(p)
        self._f[nom] = f
        setattr(self, nom, f)
        return f
