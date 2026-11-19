// Ecoute : sons du monde places comme dans le jeu (SoundEngine + OpenAL Soft, lus dans Horizon : horizon-client-render/src/audio.rs et
// sound_engine.rs, MIT).
// - L'auditeur est la camera active de chaque image (position + lacet + tangage) : une coupe de plan change l'auditeur. `sons.ecoute` peut
//   nommer un acteur : l'auditeur est alors ses yeux (1,62 bloc, 1,27 accroupi ; regard = lacet du corps + lacet de la tete, tangage de la tete).
// - Affaiblissement AL_LINEAR_DISTANCE_CLAMPED (distance de reference 0, rolloff 1) : gain = 1 - d / portee, 0 a la portee et au-dela.
//   portee = max(volume, 1) x attenuation_distance du son (sounds.json, 16 par defaut) : Sound.getAttenuationDistance.
//   Gain de la voie = volume borne a 0..1 (SoundEngine.calculateVolume) : un volume > 1 n'eleve pas le niveau, il allonge la portee.
// - Panoramique : celui du jeu. Le jeu joue des sources MONO spatialisees par OpenAL Soft sur une sortie stereo, HRTF coupe : azimut avant
//   etire x 1,5 (60 degres hors axe = tout d'un cote), decodeur stereo du premier ordre 0,5 W, 0,5 Y, 0,0957 X (audio.rs stereo_gains). Une
//   source droit devant donne 0,596 de chaque cote, derriere 0,404. Nous divisons par 0,596 : un son droit devant garde le niveau
//   d'avant (mixage de base VOLUME_MIXAGE) ; les sons relatifs (pluie, sons.liste sans cible, montage) gardent leur ancien chemin.
// - Hauteur (pitch) bornee a 0,5..2 (SoundEngine.calculatePitch). Pas d'effet Doppler (le jeu n'en a pas).
// - Voies : 247 statiques et 8 en flux (Library.init : clamp(sqrt(255), 2, 8) en flux, le reste statique, sur les 255 sources mono par
//   defaut d'OpenAL Soft). Un son lance quand toutes les voies sont prises n'est pas joue (PlayResult.NotStarted). Un son inaudible du debut
//   a la fin (hors de portee de tous les auditeurs qu'il traverse) n'est pas joue et ne prend pas de voie : le serveur ne l'envoie qu'aux
//   joueurs a portee (ServerLevel.playSeededSound, getRange).
// - Les gains sont recalcules a chaque image (1/30 s) et interpoles entre deux images, sauf a une coupe (l'auditeur saute) : un son qui
//   dure suit la camera qui bouge, une source qui bouge (vol aux elytres, wagonnet) est un morceau par tick a sa nouvelle place.
export const ATTENUATION_DEFAUT = 16;
export const VOIES_STATIQUES = 247;
export const VOIES_FLUX = 8;
const DEVANT = 0.5 + 0.0956608;   // gain d'un cote pour une source droit devant (decodeur stereo d'OpenAL Soft)
const SAUT_COUPE = 2;             // blocs entre deux images : au-dela, l'auditeur a change (coupe), pas d'interpolation
const LACET_COUPE = 60;           // degres entre deux images : idem

export const porteeDe = (volume, attenuation = ATTENUATION_DEFAUT) => Math.max(volume, 1) * attenuation;
export const borneHauteur = (h) => Math.min(2, Math.max(0.5, h));

// gain de distance d'OpenAL (lineaire, borne) : 1 a la source, 0 a la portee et au-dela
export function gainDistance(d, portee) {
  if (!(portee > 0) || d >= portee) return 0;
  return Math.min(1, Math.max(0, 1 - d / portee));
}

// gains [gauche, droite] d'une source mono dans la direction (droite, haut, avant) de l'auditeur ; 1 de chaque cote droit devant
export function gainsStereo(droite, haut, avant) {
  const l = Math.hypot(droite, haut, avant);
  if (l <= 1e-7) return [1, 1];                      // source sur l'auditeur : jouee devant
  const u = Math.min(1, Math.max(-1, haut / l)), ce = Math.sqrt(Math.max(0, 1 - u * u));
  let az = Math.atan2(droite, avant);
  if (Math.abs(az) < Math.PI / 2) az = Math.sign(az) * Math.min(Math.PI / 2, Math.abs(az) * 1.5);
  const cote = Math.sin(az) * ce, face = Math.cos(az) * ce * 0.0956608;
  return [(0.5 - 0.5 * cote + face) / DEVANT, (0.5 + 0.5 * cote + face) / DEVANT];
}

// vecteurs avant, haut, droite d'un auditeur (Camera.forwardVector / upVector, droite = avant x haut) ; lacet et tangage du jeu, en degres
export function base(lacet, tangage) {
  const y = (lacet * Math.PI) / 180, p = ((tangage ?? 0) * Math.PI) / 180;
  const sy = Math.sin(y), cy = Math.cos(y), sp = Math.sin(p), cp = Math.cos(p);
  const av = [-sy * cp, -sp, cy * cp], ht = [-sy * sp, cp, cy * sp];
  const dr = [av[1] * ht[2] - av[2] * ht[1], av[2] * ht[0] - av[0] * ht[2], av[0] * ht[1] - av[1] * ht[0]];
  return { av, ht, dr };
}
const scal = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// gains [gauche, droite] d'un evenement pour un auditeur { x, y, z, lacet, tangage } (avant VOLUME_MIXAGE)
//   pos : son du monde (affaibli, panoramique) ; dir : son directionnel sans affaiblissement (eclairs de l'End) ; sinon : son relatif (gain, pan)
export function gainsPour(e, l) {
  if (e.pos) {
    const d = [e.pos[0] - l.x, e.pos[1] - l.y, e.pos[2] - l.z], dist = Math.hypot(d[0], d[1], d[2]);
    const g = Math.min(1, Math.max(0, e.volume ?? 1)) * gainDistance(dist, e.portee ?? porteeDe(e.volume ?? 1));
    if (g <= 0) return [0, 0];
    const b = base(l.lacet, l.tangage), [a, c] = gainsStereo(scal(d, b.dr), scal(d, b.ht), scal(d, b.av));
    return [a * g, c * g];
  }
  if (e.dir) {
    const g = Math.min(1, Math.max(0, e.volume ?? 1)), b = base(l.lacet, l.tangage);
    const [a, c] = gainsStereo(scal(e.dir, b.dr), scal(e.dir, b.ht), scal(e.dir, b.av));
    return [a * g, c * g];
  }
  const angle = (((e.pan ?? 0) + 1) * Math.PI) / 4, g = (e.gain ?? 1) * Math.SQRT2;   // relatif : puissance constante, 1 de chaque cote au centre
  return [Math.cos(angle) * g, Math.sin(angle) * g];
}
export const estPlace = (e) => !!(e.pos || e.dir);

// auditeur de chaque image : la camera (defaut) ou les yeux d'un acteur (sons.ecoute = son nom)
export function ecouteDe(scene, images) {
  const qui = scene?.sons?.ecoute;
  const k = qui && qui !== 'camera' ? scene.acteurs.findIndex((a) => a.nom === qui) : -1;
  return images.map((im) => {
    if (k < 0) { const c = im.camera; return { x: c.x, y: c.y, z: c.z, lacet: c.lacet ?? 0, tangage: c.tangage ?? 0 }; }
    const p = im.acteurs[k], t = p.tete ?? [0, 0];
    const oeil = p.oeil !== undefined ? p.oeil : 1.62 - 0.35 * (p.accroupi ?? 0);   // Player : 1,62 debout, 1,27 accroupi
    return { x: p.x, y: p.y + oeil, z: p.z, lacet: (p.lacet ?? 0) + (t[0] ?? 0), tangage: t[1] ?? 0 };
  });
}

// l'auditeur saute-t-il entre l'image i et i + 1 ? (coupe de plan, ou changement d'auditeur)
export function coupeApres(ecoute, i) {
  const a = ecoute[i], b = ecoute[i + 1];
  if (!a || !b) return true;
  const dl = Math.abs(((b.lacet - a.lacet) % 360 + 540) % 360 - 180);
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > SAUT_COUPE || dl > LACET_COUPE;
}

// Choix des voix comme le moteur du jeu : dans l'ordre des departs, un son place inaudible tout du long n'est pas lance ; un son lance
// quand ses voies (statiques, ou flux pour `flux: true`) sont toutes prises est perdu. `fins[i]` : instant de fin du son i (s).
// Retourne { joues: Set des indices, horsPortee, satures }.
export function choisirVoix(evenements, fins, ecoute, ips = 30) {
  const joues = new Set(), actifs = [[], []];
  let horsPortee = 0, satures = 0;
  const ordre = evenements.map((_, i) => i).sort((a, b) => evenements[a].t - evenements[b].t || a - b);
  for (const i of ordre) {
    const e = evenements[i];
    if (estPlace(e) && ecoute?.length) {
      const i0 = Math.max(0, Math.floor(e.t * ips)), i1 = Math.min(ecoute.length - 1, Math.ceil(fins[i] * ips));
      let audible = false;
      for (let f = Math.min(i0, ecoute.length - 1); f <= i1 && !audible; f++) { const g = gainsPour(e, ecoute[f]); audible = g[0] > 1e-5 || g[1] > 1e-5; }
      if (!audible) { horsPortee++; continue; }
    }
    const pool = e.flux ? 1 : 0, act = actifs[pool];
    for (let j = act.length - 1; j >= 0; j--) if (act[j] <= e.t) act.splice(j, 1);
    if (act.length >= (pool ? VOIES_FLUX : VOIES_STATIQUES)) { satures++; continue; }
    act.push(fins[i]);
    joues.add(i);
  }
  return { joues, horsPortee, satures };
}
