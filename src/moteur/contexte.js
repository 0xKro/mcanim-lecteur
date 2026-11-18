// Options de simulation qui sont des FONCTIONS (heure du jour lue par le detecteur de lumiere, gabarit et statistiques des creatures nees en
// cours de route) refaites a partir de donnees simples : la meme chose dans le processus du lecteur et dans le fils des mods (moteur/fils.js).
//   contexte : { heurePiste (piste ciel.heure de la scene), typesC (table des types de creatures, creatures/donnees.js) }
export async function optionsAvecContexte(options = {}, contexte = {}) {
  const o = { ...options };
  if (contexte.heurePiste) { const { evaluer } = await import('../film/scene.js'); o.heure = (t) => evaluer(contexte.heurePiste, t)[0]; }
  if (contexte.typesC) {
    const { gabaritCreature } = await import('../film/actes.js');
    const { statsDe } = await import('../film/creatures.js');
    const typesC = contexte.typesC;
    o.creatures = { gabarit: (c) => gabaritCreature(c, typesC), stats: (t) => { const st = statsDe({ type: t }, typesC); return st ? { v: st.v, pv: st.pv } : null; } };
    o.typesCreatures = Object.keys(typesC);
  }
  return o;
}
