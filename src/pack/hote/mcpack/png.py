"""PNG minimal sans dependance : lecture (8/16 bits, gris, RVB, RVBA, palette, sans entrelacement) et ecriture RVBA 8 bits."""
import struct
import zlib


def lire(octets):
    """Retourne (largeur, hauteur, rgba bytes ligne du haut d'abord, 8 bits par canal)."""
    if octets[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("pas un PNG")
    pos, idat, plte, trns = 8, [], None, None
    w = h = prof = ctype = ent = 0
    while pos < len(octets):
        n, typ = struct.unpack(">I4s", octets[pos:pos + 8])
        data = octets[pos + 8:pos + 8 + n]
        pos += 12 + n
        if typ == b"IHDR":
            w, h, prof, ctype, _, _, ent = struct.unpack(">IIBBBBB", data)
        elif typ == b"PLTE":
            plte = data
        elif typ == b"tRNS":
            trns = data
        elif typ == b"IDAT":
            idat.append(data)
        elif typ == b"IEND":
            break
    if ent:
        raise ValueError("PNG entrelace non gere")
    canaux = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    bits = canaux * prof
    ligne = (w * bits + 7) // 8
    bpp = max(1, bits // 8)
    brut = zlib.decompress(b"".join(idat))
    out = bytearray(w * h * 4)
    prev = bytearray(ligne)
    p = 0
    for y in range(h):
        f = brut[p]
        cur = bytearray(brut[p + 1:p + 1 + ligne])
        p += 1 + ligne
        if f == 1:
            for i in range(bpp, ligne):
                cur[i] = (cur[i] + cur[i - bpp]) & 255
        elif f == 2:
            for i in range(ligne):
                cur[i] = (cur[i] + prev[i]) & 255
        elif f == 3:
            for i in range(ligne):
                a = cur[i - bpp] if i >= bpp else 0
                cur[i] = (cur[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(ligne):
                a = cur[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                cur[i] = (cur[i] + pr) & 255
        prev = cur
        o = y * w * 4
        if prof == 8 and ctype == 6:
            out[o:o + w * 4] = cur
        elif prof == 8 and ctype == 2:
            for x in range(w):
                out[o + x * 4:o + x * 4 + 3] = cur[x * 3:x * 3 + 3]
                out[o + x * 4 + 3] = 255
        elif prof == 8 and ctype == 0:
            for x in range(w):
                g = cur[x]
                out[o + x * 4:o + x * 4 + 4] = bytes((g, g, g, 255))
        elif prof == 8 and ctype == 4:
            for x in range(w):
                g = cur[x * 2]
                out[o + x * 4:o + x * 4 + 4] = bytes((g, g, g, cur[x * 2 + 1]))
        elif prof == 16:
            for x in range(w):
                px = [cur[(x * canaux + k) * 2] for k in range(canaux)]
                if ctype == 6:
                    out[o + x * 4:o + x * 4 + 4] = bytes(px)
                elif ctype == 2:
                    out[o + x * 4:o + x * 4 + 4] = bytes((px[0], px[1], px[2], 255))
                elif ctype == 4:
                    out[o + x * 4:o + x * 4 + 4] = bytes((px[0], px[0], px[0], px[1]))
                else:
                    out[o + x * 4:o + x * 4 + 4] = bytes((px[0], px[0], px[0], 255))
        elif ctype == 3:
            for x in range(w):
                if prof == 8:
                    i = cur[x]
                else:
                    per = 8 // prof
                    i = (cur[x // per] >> (8 - prof * (x % per + 1))) & ((1 << prof) - 1)
                out[o + x * 4:o + x * 4 + 3] = plte[i * 3:i * 3 + 3]
                out[o + x * 4 + 3] = trns[i] if trns and i < len(trns) else 255
        else:
            raise ValueError("format PNG non gere (type %d, %d bits)" % (ctype, prof))
    return w, h, bytes(out)


def ecrire(w, h, rgba, chemin):
    """rgba : bytes de w*h*4, ligne du haut d'abord."""
    def morceau(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    brut = b"".join(b"\x00" + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    with open(chemin, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + morceau(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + morceau(b"IDAT", zlib.compress(brut, 3)) + morceau(b"IEND", b""))
