// Ce que la table de lumiere du film doit a celui qui regarde (LightTexture du jeu, Horizon gfx.rs `update_lightmap` : MIT, voir ATTRIBUTIONS.md) :
//   - vision nocturne (GameRenderer.getNightVisionScale ; Horizon game/sculk.rs night_vision_intensity) : 1 tant qu'il reste plus de 200 ticks,
//     puis 0,7 + sin((duree restante - partiel) x pi x 0,2) x 0,3 (le clignotement de la fin) ; ambiance = max(ambient_light_color, 0,6 x vision) ;
//   - assombrissement des boss (BossHealthOverlay.shouldDarkenScreen : la barre du wither, Horizon game/bossbars.rs ; GameRenderer.tick :
//     +0,05 par tick tant qu'une barre assombrit, -0,0125 sinon ; lightmap.fsh : couleur melangee vers (0,7 ; 0,6 ; 0,6) de ce facteur).
//     La barre du wither est montree a qui est a min(10, distance de vue) x 16 = 160 blocs a l'horizontale de lui.
// Celui qui regarde : l'acteur que la camera suit (camera.suit), sinon le premier joueur. Rend i -> { visionNuit, boss } ou null sans rien.
const PORTEE_BOSS = 160;

export function creerLumiereVue({ scene, anim, replay }) {
  const VN = replay?.visionNuit ?? [];
  const withers = scene.acteurs.map((a, k) => (a.creature?.type === 'wither' ? k : -1)).filter((k) => k >= 0);
  // barre du dragon (EndDragonFight : brume du monde) : dans l'End, l'eclair du ciel n'eclaire plus qu'au tiers
  const dragons = scene.monde?.dimension === 'end' ? scene.acteurs.map((a, k) => (a.creature?.type === 'ender_dragon' ? k : -1)).filter((k) => k >= 0) : [];
  if (!VN.length && !withers.length && !dragons.length) return null;
  const ral = replay?.ralenti || 1;
  const suit = typeof scene.camera?.suit === 'string' ? scene.camera.suit : null;
  const regard = suit ?? scene.acteurs.find((a) => !a.creature)?.nom ?? null;
  const n = anim.images.length;
  // assombrissement du wither, tick par tick du monde (la camera de l'image la plus proche)
  const tickDe = (im) => im.tm * 20 * ral;
  const nT = Math.ceil(tickDe(anim.images[n - 1]) ?? 0) + 2;
  const doit = new Uint8Array(nT);
  if (withers.length) {
    for (let i = 0; i < n; i++) {
      const im = anim.images[i], c = im.camera;
      const t0 = Math.floor(tickDe(im)), t1 = i + 1 < n ? Math.floor(tickDe(anim.images[i + 1])) : t0 + 1;
      const proche = withers.some((k) => { const p = im.acteurs[k]; return p && !p.absent && !(p.mort > 0) && Math.hypot(p.x - c.x, p.z - c.z) <= PORTEE_BOSS; });
      for (let t = Math.max(0, t0); t < Math.min(nT, Math.max(t1, t0 + 1)); t++) doit[t] = proche ? 1 : 0;
    }
  }
  const sombre = new Float32Array(nT + 1);
  for (let t = 1; t <= nT; t++) sombre[t] = doit[t - 1] ? Math.min(1, sombre[t - 1] + 0.05) : Math.max(0, sombre[t - 1] - 0.0125);
  return (i) => {
    const im = anim.images[i], u = tickDe(im), k = Math.floor(u), part = u - k;
    const b = withers.length ? sombre[Math.min(nT, k)] + (sombre[Math.min(nT, k + 1)] - sombre[Math.min(nT, k)]) * part : 0;
    let vn = 0;
    for (const e of VN) {
      if (regard && e.acteur !== regard) continue;
      if (u < e.debut || u >= e.fin) continue;
      const reste = e.fin - u;
      vn = Math.max(vn, reste > 200 ? 1 : 0.7 + Math.sin(reste * Math.PI * 0.2) * 0.3);
    }
    const brumeDragon = dragons.some((k) => { const p = im.acteurs[k]; return p && !p.absent && !(p.mort > 0); });
    return vn || b || brumeDragon ? { visionNuit: vn, boss: b, brumeDragon } : null;
  };
}
