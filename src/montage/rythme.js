// Rythme : compare le montage aux mesures des 4 videos de reference (analyse/10-videos-reference.md : plan median 1,2 a 2,3 s, jamais plus de ~4 s sans changement,
// legendes de 1 a 3 mots qui changent 1,2 a 1,5 fois par seconde, aucune pause longue). Retourne des notes courtes (jamais une erreur) : le LLM corrige le montage.
const fmt = (x) => String(Math.round(x * 10) / 10).replace('.', ',');

export function notesRythme(scene) {
  const notes = [];
  const plans = scene.plans ?? [];
  if (plans.length >= 2) {
    const d = plans.map((p) => p.a - p.de).sort((x, y) => x - y), med = d[Math.floor(d.length / 2)];
    if (med > 3.2) notes.push(`rythme : plan median de ${fmt(med)} s (references : 1,2 a 2,3 s) ; coupe plus souvent (un plan par phrase ou par idee)`);
    if (med < 0.8) notes.push(`rythme : plan median de ${fmt(med)} s, tres court (references : 1,2 a 2,3 s) ; les plans de moins de 0,6 s ne se lisent pas`);
    const longs = plans.filter((p) => p.a - p.de > 4.5);
    if (longs.length) notes.push(`rythme : ${longs.length} plan(s) de plus de 4,5 s (le premier a t=${fmt(longs[0].de)} s) ; coupe, ou fais bouger la camera / les acteurs`);
    for (let i = 1; i < plans.length; i++) {
      const a = plans[i - 1].camera, b = plans[i].camera;
      if (a?.cadre && b?.cadre && JSON.stringify([a.cadre.sur, a.cadre.plan, a.cadre.de]) === JSON.stringify([b.cadre.sur, b.cadre.plan, b.cadre.de]) && !a.cadre.deux) { notes.push(`rythme : les plans ${i} et ${i + 1} (t=${fmt(plans[i].de)} s) ont le meme cadrage : change de plan, d'angle ou de sujet (saut de coupe)`); break; }
    }
  }
  const puces = (scene.textes ?? []).filter((e) => e.legende);
  if (puces.length >= 6) {
    const t0 = Math.min(...puces.map((p) => p.t[0])), t1 = Math.max(...puces.map((p) => p.t[1])), taux = puces.length / Math.max(1, t1 - t0);
    if (taux < 0.8) notes.push(`rythme : ${fmt(taux)} legende(s) par seconde (references : 1,2 a 1,5) ; passe a 1 ou 2 mots par puce ("par")`);
    if (taux > 2.2) notes.push(`rythme : ${fmt(taux)} legendes par seconde, trop vite pour se lire (references : 1,2 a 1,5) ; "par": 3`);
    const courtes = puces.filter((p) => p.t[1] - p.t[0] < 0.2).length;
    if (courtes > puces.length * 0.2) notes.push(`rythme : ${courtes} legendes de moins de 0,2 s (illisibles) ; regroupe les mots ("par": 2 ou 3)`);
  }
  return notes;
}
