// Etat d'une scene a un instant : pour chaque acteur, position, direction, vitesse, phases des boucles et pose tenue. `mcanim etat scene.json --t fin`
// donne ce qu'il faut pour enchainer la scene suivante sans a-coup : meme zone, `pos` et `lacet` qui partent de la, et dans chaque boucle en cours
// `"phase0"` (la boucle demarre a cette phase) avec `"fondu":0` et `"de":0`. Un acteur fige (champ `fige`) garde sa pose et ses phases.
import { poidsBoucle, evaluer } from './scene.js';
import { phaseBoucle, horlogeMonde } from './anim.js';
import { creerFige } from './fige.js';

const DT = 1 / 30;
const arr = (v, n = 1) => Math.round(v * 10 ** n) / 10 ** n;
const MEMBRES = ['brasD', 'brasG', 'jambeD', 'jambeG'];
const FLEXIONS = ['coudeD', 'coudeG', 'genouD', 'genouG'];

// images : sortie de animer(scene). t : secondes, ou 'fin' (le temps juste apres la derniere image = la 1re image de la scene suivante).
export function etatDeScene(scene, images, t) {
  const fin = t === 'fin';
  const n = images.length;
  const tt = fin ? scene.duree : Math.max(0, Math.min(scene.duree, Number(t)));
  const i = fin ? n - 1 : Math.max(0, Math.min(n - 1, Math.round(tt / DT)));
  const gel = scene.gel ?? [];
  const acteurs = scene.acteurs.map((a, k) => {
    const p = images[i].acteurs[k];
    const q = images[Math.max(0, i - 1)].acteurs[k];
    // fin : la 1re image de la scene suivante est une image apres la derniere : on prolonge le mouvement d'une image
    const pas = fin && i > 0 ? 1 : 0;
    const x = p.x + (p.x - q.x) * pas, z = p.z + (p.z - q.z) * pas;
    const v = Math.hypot(p.x - q.x, p.z - q.z) / DT;
    // horloges de l'acteur a tt (gel du monde, fige de l'acteur) : memes formules que anim.js
    const FG = creerFige(a, gel);
    const etat = (FG ? FG.U : horlogeMonde(gel)).etat(tt);
    const h = FG ? { tw: etat.tw, monde: FG.U.monde } : gel.length ? { tw: etat.tw, monde: horlogeMonde(gel).monde } : null;
    const boucles = [];
    (FG ? FG.boucles : a.boucles).forEach((b, j) => {
      if (poidsBoucle(b, h ? h.tw : tt) <= 0 && !(fin && tt >= b.de && tt <= b.a + 1e-9)) return;
      const ph = phaseBoucle(b, tt, h);
      boucles.push({ i: j, periode: a.boucles[j].periode, phase0: arr(ph - Math.floor(ph), 3) });
    });
    const pose = {};
    for (const m of MEMBRES) { const val = p[m].map((e) => arr(e)); while (val.length > 1 && val[val.length - 1] === 0) val.pop(); if (val.some((e) => e)) pose[m] = val; }
    for (const m of FLEXIONS) if (p[m]) pose[m] = arr(p[m]);
    if (p.tete?.some((e) => Math.abs(e) > 0.05)) pose.tete = p.tete.map((e) => arr(e));
    if (Math.abs(p.penche) > 0.05) pose.corps = arr(p.penche);
    for (const c of ['accroupi', 'bascule', 'roulis', 'hauteur']) if (p[c]) pose[c] = arr(p[c], 2);
    const o = { nom: a.nom, x: arr(x, 2), y: arr(p.y, 2), z: arr(z, 2), lacet: arr(((p.lacet + 180) % 360 + 360) % 360 - 180), v: arr(v, 2) };
    if (!p.auSol) o.enAir = true;
    if (p.figee || etat.fige) o.fige = true;
    if (boucles.length) o.boucles = boucles;
    if (Object.keys(pose).length) o.pose = pose;
    for (const [c, nom] of [['objetD', 'objet'], ['objetG', 'objetG']]) if (p[c]) o[nom] = p[c];
    if (p.armure) o.armure = p.armure;
    return o;
  });
  return { t: arr(tt, 3), acteurs };
}

// Texte de `mcanim etat` : le JSON compact et trois lignes pour s'en servir.
export function texteEtat(etat) {
  return [
    JSON.stringify(etat),
    'Scene suivante (meme zone) : pos [[0,x,z]] (ou [[0,x,y,z]] pour imposer la hauteur), lacet [[0,lacet]] si tu l\'ecris, et dans chaque boucle listee : "de":0, "fondu":0, "phase0":<phase> (reprend le cycle la ou il etait). v = vitesse en blocs/s : continue au meme rythme.',
    'Assembler (audio en phase) : ffmpeg -i a.mp4 -i b.mp4 -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]" -c:v libx264 -crf 18 -c:a aac ab.mp4',
  ].join('\n');
}
