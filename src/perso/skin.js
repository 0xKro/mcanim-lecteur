// Skins : lecture d'un PNG, conversion 64x32 -> 64x64, skins par defaut du kit, pseudo Minecraft.
// Les regles de conversion viennent de Horizon (skins.rs, MIT), voir ATTRIBUTIONS.md.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { decoderPNG } from '../rendu/png.js';
import { Net } from '../net.js';

// ---------------------------------------------------------------- conversion
// Copies de rectangles (sx, sy, ox, oy, l, h) avec miroir horizontal : (sx+x, sy+y) -> (sx+ox+l-1-x, sy+oy+y).
const RECTS_ANCIEN = [
  [4, 16, 16, 32, 4, 4], [8, 16, 16, 32, 4, 4],
  [0, 20, 24, 32, 4, 12], [4, 20, 16, 32, 4, 12], [8, 20, 8, 32, 4, 12], [12, 20, 16, 32, 4, 12],
  [44, 16, -8, 32, 4, 4], [48, 16, -8, 32, 4, 4],
  [40, 20, 0, 32, 4, 12], [44, 20, -8, 32, 4, 12], [48, 20, -16, 32, 4, 12], [52, 20, -8, 32, 4, 12],
];

// rgba : Uint8Array l*h*4. Retourne { rgba (64x64x4), ancien (bool), note }.
// Tailles permises : 64x64, 64x32 (ancien format) ; toute autre taille est ramenee a 64x64 (plus proche voisin).
export function convertirSkin(rgba, l, h) {
  const out = new Uint8Array(64 * 64 * 4);
  let ancien = false, note = null;
  if (l === 64 && (h === 64 || h === 32)) {
    out.set(rgba.subarray(0, 64 * h * 4));
    ancien = h === 32;
  } else {
    if (l < 1 || h < 1) throw new Error('image de skin vide');
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const sx = Math.floor((x * l) / 64), sy = Math.floor((y * h) / 64);
      out.set(rgba.subarray((sy * l + sx) * 4, (sy * l + sx) * 4 + 4), (y * 64 + x) * 4);
    }
    note = `skin ${l}x${h} ramene a 64x64`;
  }
  if (ancien) {
    for (const [sx, sy, ox, oy, rl, rh] of RECTS_ANCIEN) {
      for (let y = 0; y < rh; y++) for (let x = 0; x < rl; x++) {
        const s = ((sy + y) * 64 + sx + x) * 4;
        const d = ((sy + oy + y) * 64 + (sx + ox + rl - 1 - x)) * 4;
        out.copyWithin(d, s, s + 4);
      }
    }
  }
  const sansAlpha = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out[(y * 64 + x) * 4 + 3] = 255; };
  sansAlpha(0, 0, 32, 16);      // tete (couche de base)
  if (ancien) {                  // "astuce Notch" : un chapeau entierement opaque disparait
    let tout = true;
    for (let y = 0; y < 32 && tout; y++) for (let x = 32; x < 64; x++) if (out[(y * 64 + x) * 4 + 3] < 128) { tout = false; break; }
    if (tout) for (let y = 0; y < 32; y++) for (let x = 32; x < 64; x++) out[(y * 64 + x) * 4 + 3] = 0;
  }
  sansAlpha(0, 16, 64, 32);     // corps, bras, jambes (couche de base)
  sansAlpha(16, 48, 48, 64);    // bras gauche, jambe gauche (couche de base)
  return { rgba: out, ancien, note };
}

export function lirePng(octets) {
  const im = decoderPNG(octets);
  return convertirSkin(im.rgba, im.largeur, im.hauteur);
}

// ---------------------------------------------------------------- skins par defaut du kit
export function nomsParDefaut(kitDir, modele = 'wide') {
  const d = path.join(kitDir, 'assets', 'minecraft', 'textures', 'entity', 'player', modele);
  try { return fs.readdirSync(d).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort(); } catch { return []; }
}

function lireParDefaut(kitDir, nom, modele) {
  const f = path.join(kitDir, 'assets', 'minecraft', 'textures', 'entity', 'player', modele, nom + '.png');
  return lirePng(fs.readFileSync(f));
}

// Choix deterministe d'un skin par defaut a partir d'un pseudo (comme le jeu le fait avec l'UUID).
export function skinDeRepli(pseudo, noms) {
  const h = crypto.createHash('sha256').update(String(pseudo).toLowerCase()).digest();
  return noms[h.readUInt32BE(0) % noms.length];
}

// ---------------------------------------------------------------- Mojang (peut etre bloque : echec rapide)
const DELAI_MOJANG_MS = 4000;

async function skinMojang(pseudo, fabriqueNet) {
  const net = fabriqueNet();
  const course = new Promise((_, ko) => setTimeout(() => ko(new Error('delai depasse (4 s)')), DELAI_MOJANG_MS).unref());
  try {
    return await Promise.race([(async () => {
      const profil = await net.json(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(pseudo)}`, { retries: 0 });
      if (!profil?.id) throw new Error('pseudo inconnu');
      const sess = await net.json(`https://sessionserver.mojang.com/session/minecraft/profile/${profil.id}`, { retries: 0 });
      const prop = (sess.properties || []).find((p) => p.name === 'textures');
      if (!prop) throw new Error('pas de textures');
      const tex = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')).textures?.SKIN;
      if (!tex?.url) throw new Error('pas de skin');
      const u = new URL(tex.url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('adresse de skin etrange');
      u.protocol = 'https:';
      const png = (await net.buffer(u.href, { retries: 0 })).body;
      return { png, slim: tex.metadata?.model === 'slim' };
    })(), course]);
  } finally { net.close(); }
}

// ---------------------------------------------------------------- resolution
// Retourne { rgba, modele ('wide'|'slim'), origine, detail, repli (bool) }.
//   description : texte du champ `skin`. surcharge : chemin PNG donne par --skin nom=fichier.png.
//   modele : 'wide' | 'slim' | null (null = a deviner).
export async function resoudreSkin({ description, modele, kitDir, surcharge, fabriqueNet = () => new Net({ connectTimeout: 2000 }), baseDir = process.cwd(), mojang = skinMojang }) {
  const choisir = (m) => m ?? 'wide';
  if (surcharge) {
    const f = path.resolve(baseDir, surcharge);
    if (!fs.existsSync(f)) throw new Error(`fichier de skin introuvable : ${surcharge}`);
    const r = lirePng(fs.readFileSync(f));
    return { rgba: r.rgba, modele: choisir(modele), origine: 'fichier', detail: path.basename(f), repli: false };
  }
  const desc = String(description ?? 'steve').trim();
  const bas = desc.toLowerCase();
  const m = choisir(modele);
  const noms = nomsParDefaut(kitDir, m);
  if (noms.includes(bas)) return { rgba: lireParDefaut(kitDir, bas, m).rgba, modele: m, origine: 'defaut', detail: bas, repli: false };
  if (/\.png$/i.test(desc) || /[\\/]/.test(desc)) {
    const f = path.resolve(baseDir, desc);
    if (!fs.existsSync(f)) throw new Error(`fichier de skin introuvable : ${desc}`);
    return { rgba: lirePng(fs.readFileSync(f)).rgba, modele: m, origine: 'fichier', detail: path.basename(f), repli: false };
  }
  // pseudo Minecraft
  if (!/^[A-Za-z0-9_]{1,16}$/.test(desc)) throw new Error(`skin "${desc}" : ni skin par defaut, ni fichier PNG, ni pseudo Minecraft valide`);
  let raison;
  try {
    const { png, slim } = await mojang(desc, fabriqueNet);
    return { rgba: lirePng(png).rgba, modele: modele ?? (slim ? 'slim' : 'wide'), origine: 'mojang', detail: desc, repli: false };
  } catch (e) { raison = e.message; }
  if (!noms.length) throw new Error(`skin "${desc}" : Mojang injoignable (${raison}) et aucun skin par defaut dans le kit`);
  const nom = skinDeRepli(desc, noms);
  return { rgba: lireParDefaut(kitDir, nom, m).rgba, modele: m, origine: 'repli', detail: `${desc} -> ${nom}`, repli: true, raison };
}
