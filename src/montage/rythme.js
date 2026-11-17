// Rythme : compare le montage aux mesures des 4 videos de reference (analyse/10-videos-reference.md : plan median 1,2 a 2,3 s, jamais plus de ~4 s sans changement,
// legendes de 1 a 3 mots qui changent 1,2 a 1,5 fois par seconde, aucune pause longue). Retourne des notes courtes (jamais une erreur) : le LLM corrige le montage.
const fmt = (x) => String(Math.round(x * 10) / 10).replace('.', ',');

// Taille de la tete du sujet principal : part de la hauteur de l'image (une tete = 0,5 bloc ; hauteur vue a la distance d = 2 d tan(fov/2)).
export const TETE_MINI = 0.04;
const RAD = Math.PI / 180;
function sujetDuPlan(scene, plan, im) {
  const c = plan?.camera ?? scene.camera, noms = scene.acteurs.map((a) => a.nom);
  const nom = c.cadre ? (c.cadre.sur ?? c.cadre.deux?.[0] ?? c.cadre.epaule?.[1]) : c.suit ?? c.regarde;
  if (nom) return noms.indexOf(nom);
  // sinon l'acteur le plus proche du centre de l'image (devant la camera)
  const cam = im.camera, a = cam.lacet * RAD, p = cam.tangage * RAD, f = [-Math.sin(a) * Math.cos(p), -Math.sin(p), Math.cos(a) * Math.cos(p)];
  let meilleur = -1, mc = 0.5;
  im.acteurs.forEach((q, k) => { const d = [q.x - cam.x, q.y + 1.62 - cam.y, q.z - cam.z], L = Math.hypot(...d) || 1, cos = (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]) / L; if (cos > mc) { mc = cos; meilleur = k; } });
  return meilleur;
}
// Part de plans ou la tete du sujet fait moins de TETE_MINI de la hauteur de l'image : { petits: [numeros de plan], total }.
export function plansTropPetits(scene, images) {
  const plans = scene.plans?.length ? scene.plans : [{ i0: 0, i1: images.length, camera: scene.camera }];
  const petits = []; let total = 0;
  plans.forEach((p, k) => {
    const i0 = Math.min(images.length - 1, p.i0 ?? 0), i1 = Math.max(i0 + 1, Math.min(images.length, p.i1 ?? images.length));
    const mesures = [0.25, 0.5, 0.75].map((u) => images[Math.min(images.length - 1, i0 + Math.floor((i1 - i0 - 1) * u))]).map((im) => {
      const s = sujetDuPlan(scene, p, im); if (s < 0) return null;
      const q = im.acteurs[s], cam = im.camera, d = Math.hypot(q.x - cam.x, q.y + 1.62 - cam.y, q.z - cam.z);
      return d > 0.05 ? 0.5 / (2 * d * Math.tan((cam.fov * RAD) / 2)) : 1;
    }).filter((x) => x !== null);
    if (!mesures.length) return;
    total++;
    if (mesures.reduce((a, b) => a + b, 0) / mesures.length < TETE_MINI) petits.push(k + 1);
  });
  return { petits, total };
}

// images (facultatif) : les images d'animation (camera, acteurs) ; sans elles, pas de note sur la taille du sujet.
export function notesRythme(scene, images = null) {
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
  if (images?.length) {
    const { petits, total } = plansTropPetits(scene, images);
    if (total >= 3 && petits.length > total * 0.4) notes.push(`cadrage : sujet trop petit (tete sous 4 % de l'image) dans ${petits.length} plan(s) sur ${total} (plans ${petits.slice(0, 8).join(', ')}${petits.length > 8 ? '...' : ''}) ; les references montrent la tete a 8 - 14 % : cadre {sur, plan: "moyen" (8,5 %) | "americain" (11 %) | "rapproche" (14 %)} ou {deux: [...], tete: 0.1}, et coupe plus pres`);
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
