// Rapport COURT de `mcanim simuler` (800 octets au plus) : ce qui s'est passe, pour decider avant de payer le rendu.
const fr = (n, d = 1) => n.toFixed(d).replace('.', ',');
export const MAX_OCTETS = 800;

export function texteRapport({ sim, replay, duree }) {
  const secondes = replay.stats.ms / 1000;
  const b = replay.blocs, n = replay.nbBlocs, a = sim.monde.ancre;
  const parType = new Map(), sections = new Set();
  for (let i = 0; i < n; i++) {
    const nom = sim.monde.palette[b[i * 6 + 5]].replace(/^minecraft:/, '').replace(/\[.*$/, '');
    parType.set(nom, (parType.get(nom) || 0) + 1);
    sections.add(`${Math.floor((b[i * 6 + 1] - a[0]) / 16)},${Math.floor((b[i * 6 + 2] - a[1]) / 16)},${Math.floor((b[i * 6 + 3] - a[2]) / 16)}`);
  }
  const tops = [...parType.entries()].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1)).slice(0, 5).map(([k, v]) => `${k} x${v}`).join(', ');
  const L = [];
  L.push(`sim ${replay.ticks} ticks (${fr(duree)} s) en ${fr(secondes, 2)} s ; blocs changes ${n} (${sections.size} sections)${replay.mods.length ? ' ; mods : ' + replay.mods.join(', ') : ''}${replay.nbBlocs ? '' : ' ; aucun changement'}`);
  if (tops) L.push(`par type : ${tops}`);
  const ev = (replay.sons.length / 7) | 0, pa = (replay.particules.length / 9) | 0;
  if (ev || pa) L.push(`sons ${ev}, particules ${pa} ; voisins mis a jour ${sim.stats.voisins}, ticks planifies ${sim.stats.ticks}, aleatoires ${sim.stats.aleatoires}`);
  const rl = replay.ralenti;
  for (const [tick, t] of replay.textes.slice(0, 8)) L.push(`t=${fr(tick / 20 / rl, 2)} ${t}`);
  for (const w of replay.avertissements) L.push('avert: ' + w);
  let out = L.join('\n');
  if (Buffer.byteLength(out) > MAX_OCTETS) {
    while (Buffer.byteLength(out + '\n...') > MAX_OCTETS && L.length > 2) { L.splice(L.length - 1, 1); out = L.join('\n'); }
    out += '\n...';
  }
  return out;
}
