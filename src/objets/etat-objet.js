// L'objet tenu tel qu'il est a cet instant (proprietes des modeles d'objets du jeu : items/<id>.json, objets/definition.js) :
//   - arc : `using_item` et `use_duration` (ticks d'utilisation x 0,05 : bow_pulling_0, 1 a 0,65, 2 a 0,9) ;
//   - arbalete : `using_item` et `crossbow/pull` (ticks / 25, la duree de charge sans Charge rapide), `charge_type` (arrow une fois chargee) ;
//   - boussole : `compass` vers le point d'apparition (CompassAngleState : 0,5 - (lacet / 360 - 0,25 - angle vers la cible), modulo 1) ;
//   - horloge : `time` (heure du jour : ClockTime, angle celeste du jeu).
// pose : { x, z, lacet, usageObjet: { type (3 arc, 4 arbalete en charge, 5 arbalete chargee), ticks }, heure (heure du jour 0..24) }.
export const POINT_APPARITION = [0, 0];   // une zone .mcz ne garde pas le point d'apparition du monde : la boussole vise (0, 0)

const mod1 = (v) => ((v % 1) + 1) % 1;

// angle celeste du jeu (DimensionType.timeOfDay) pour un tick du jour (0 = 6 h)
export function angleCeleste(tickJour) {
  const d0 = mod1(tickJour / 24000 - 0.25), d1 = 0.5 - Math.cos(d0 * Math.PI) / 2;
  return (d0 * 2 + d1) / 3;
}

export function etatObjet(pose, gauche = false) {
  const u = pose.usageObjet ?? null, o = {};
  if (u && !gauche) {
    if (u.type === 3 || u.type === 4) { o.utilise = true; o.ticks = u.ticks; }
    if (u.type === 5) o.charge = u.charge ?? 'arrow';
  }
  if (Number.isFinite(pose.x) && Number.isFinite(pose.z)) {
    const d = Math.fround(Math.atan2(POINT_APPARITION[1] + 0.5 - pose.z, POINT_APPARITION[0] + 0.5 - pose.x) / Math.fround(Math.PI * 2));
    const e = mod1((pose.lacet ?? 0) / 360);   // CompassAngleState (autre joueur que celui qui regarde) : 0,5 - (lacet - 0,25 - angle vers la cible)
    o.boussole = mod1(0.5 - (e - 0.25 - d));
  }
  if (Number.isFinite(pose.heure)) o.temps = angleCeleste(((pose.heure - 6) * 1000 % 24000 + 24000) % 24000);
  return o;
}
