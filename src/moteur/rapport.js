// Rapport COURT de `mcanim simuler` (2 Ko au plus ; une ligne compacte "monde" pour explosions, chutes, fluides, objets et morts) : ce qui s'est passe, pour decider avant de payer le rendu.
// 2 Ko depuis la partie 32 (avant : 1 Ko) : le detail de chaque coup, la solidite de l'armure et une ligne par intention n'y tenaient pas.
import { idArmure, composants } from './inventaire.js';
import { lirePile } from './pile.js';
import { NOMS_FACES } from './util.js';
import { FACE_OPPOSEE } from './monde.js';
const fr = (n, d = 1) => n.toFixed(d).replace('.', ',');
const PIECES = { tete: 'casque', torse: 'plastron', jambes: 'jambieres', pieds: 'bottes' };
// textes du journal : les longs nombres (57.917812579071516) ecrits a 2 decimales (le replay garde la valeur entiere)
const court2 = (t) => t.replace(/-?\d+\.\d{4,}/g, (m) => String(Math.round(Number(m) * 100) / 100));
export const MAX_OCTETS = 2048;
export const MAX_RETRAITS = 8, MAX_TRACE = 40, MAX_OCTETS_TRACE = 4096;   // sans --tout
const sansNs = (s) => String(s).replace(/^minecraft:/, '');

// Blocs casses faute d'appui (simulation.js _noterSansAppui) : une ligne chacun, « ! comparator en x,y,z retiré : pas d'appui (t=1,25 s) »
export function lignesRetraits(sim, rl, tout = false) {
  const R = sim.retraits ?? [], L = [];
  for (const r of tout ? R : R.slice(0, MAX_RETRAITS)) L.push(`! ${r.nom} en ${r.x},${r.y},${r.z} retiré : pas d'appui (t=${fr(r.tick / 20 / rl, 2)} s)`);
  const reste = (sim.nbRetraits ?? R.length) - L.length;
  if (reste > 0) L.push(`(+ ${reste} autres blocs retirés faute d'appui${tout ? '' : ' : mcanim simuler --tout'})`);
  return L;
}

// --trace x,y,z : l'etat de depart puis chaque changement de la cellule, tick par tick, avec sa cause
export function texteTrace(sim, rl, tout = false) {
  const T = sim.trace;
  if (!T) return '';
  const L = [`trace ${T.x},${T.y},${T.z} : depart ${sansNs(T.depart ?? '?')}${T.lignes.length ? '' : ' ; aucun changement pendant la scene'}`];
  const lignes = tout ? T.lignes : T.lignes.slice(0, MAX_TRACE);
  for (const l of lignes) L.push(`t=${fr(l.tick / 20 / rl, 2)} s (tick ${l.tick}) ${sansNs(l.avant)} -> ${sansNs(l.apres)} : ${l.cause}`);
  if (T.lignes.length > lignes.length) L.push(`(+ ${T.lignes.length - lignes.length} changements : mcanim simuler --trace ${T.x},${T.y},${T.z} --tout)`);
  let out = L.join('\n');
  if (!tout && Buffer.byteLength(out) > MAX_OCTETS_TRACE) {
    while (L.length > 2 && Buffer.byteLength(L.join('\n') + '\n...') > MAX_OCTETS_TRACE) L.splice(L.length - 1, 1);
    out = L.join('\n') + '\n... (mcanim simuler --trace ... --tout pour tout voir)';
  }
  return out;
}

// mcanim etat scene.json --t 5 --bloc x,y,z : la cellule a l'instant t (la simulation s'est arretee apres le tick `tick`)
export function texteSonde(sim, [x, y, z], tick) {
  const rl = sim.replay.ralenti || 1, d = sim.d, R = sim.redstone, e = sim.monde.etatEn(x, y, z);
  const L = [`bloc ${x},${y},${z} a t=${fr(tick / 20 / rl, 2)} s (tick ${tick}) : ${e < 0 ? 'cellule cachee (#hidden : sous le terrain, jamais vue)' : `${d.chaine(e)} (etat n° ${e})`}`];
  if (e < 0) return L.join('\n');
  // puissance (SignalGetter) : recue des voisins, recue en direct (forte), emise par face ; fil : power
  const emis = [];
  for (let f = 0; f < 6; f++) { const v = R.signalEtat(e, x, y, z, f); if (v > 0) emis.push(`${NOMS_FACES[FACE_OPPOSEE[f]]} ${v}`); }
  const fil = R.estFil(e) ? `, fil power=${R.puissanceFil(e)}` : '';
  L.push(`puissance : recue ${R.meilleurSignalVoisin(x, y, z)} (directe ${R.directeVers(x, y, z)}), emise ${emis.length ? 'vers ' + emis.join(', ') : '0'}${fil}`);
  // bloc a entite et ticks en attente
  const k = `${x},${y},${z}`, E = [];
  if (R.sorties?.has(k)) E.push(`sortie du comparateur ${R.sorties.get(k)}`);
  const c = sim.contenus.lire(x, y, z);
  if (c) { const pleins = c.filter(Boolean); E.push(`contenu ${pleins.length ? pleins.map((s) => `${s.n} ${sansNs(s.item)}`).join(', ') : 'vide'} (${c.length} cases)`); }
  const fo = sim.fours.etat.get(k);
  if (fo && sim.fours.estFour(x, y, z)) E.push(`four : feu ${fo.feu}/${fo.feuMax}, cuisson ${fo.progres}/${fo.total}${fo.entree ? ', ' + sansNs(fo.entree) : ''}`);
  const jb = sim.jukeboxes.get(k);
  if (jb) E.push(`juke-box : ${sansNs(jb.disque ?? '?')}`);
  const b = d.blocDe(e);
  if (sim.file.estPlanifie(b, x, y, z)) E.push('tick planifie en attente');
  L.push(`bloc a entite : ${E.length ? E.join(' ; ') : 'aucune donnee'}`);
  const lu = sim.lumiere();
  L.push(`lumiere : bloc ${lu.niveauBloc(x, y, z)}, ciel ${lu.niveauCiel(x, y, z)} ; survit : ${sim.survit(x, y, z) ? 'oui' : 'NON (pas d\'appui : le jeu le casse au premier voisin qui change)'}`);
  return L.join('\n');
}

export function texteRapport({ sim, replay, duree, tout = false }) {
  const secondes = replay.stats.ms / 1000;
  const b = replay.blocs, a = sim.monde.ancre, pal = sim.monde.palette;
  const parType = new Map(), sections = new Set();
  // une cellule cachee (`#hidden`, sous le terrain) devoilee quand un voisin s'ouvre (monde.js devoiler) prend son bloc de remplissage :
  // ce n'est pas un changement du jeu (le bloc etait deja la), on la compte a part au lieu de l'annoncer comme « stone x236 »
  let n = 0, devoilees = 0;
  for (let i = 0; i < replay.nbBlocs; i++) {
    if (pal[b[i * 6 + 4]] === '#hidden') { devoilees++; continue; }
    n++;
    const nom = pal[b[i * 6 + 5]].replace(/^minecraft:/, '').replace(/\[.*$/, '');
    parType.set(nom, (parType.get(nom) || 0) + 1);
    sections.add(`${Math.floor((b[i * 6 + 1] - a[0]) / 16)},${Math.floor((b[i * 6 + 2] - a[1]) / 16)},${Math.floor((b[i * 6 + 3] - a[2]) / 16)}`);
  }
  // par type : les 5 plus nombreux (--tout : tous)
  const types = [...parType.entries()].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1));
  const tops = (tout ? types : types.slice(0, 5)).map(([k, v]) => `${k} x${v}`).join(', ') + (!tout && types.length > 5 ? ` (+${types.length - 5} types : --tout)` : '');
  const L = [];
  L.push(`sim ${replay.ticks} ticks (${fr(duree)} s) en ${fr(secondes, 2)} s ; blocs changes ${n} (${sections.size} sections)${devoilees ? ` ; ${devoilees} cellule(s) cachee(s) du sous-sol devoilee(s)` : ''}${replay.mods.length ? ' ; mods : ' + replay.mods.join(', ') : ''}${n ? '' : ' ; aucun changement'}`);
  if (types.length) L.push(`par type : ${tops}`);
  L.push(...lignesRetraits(sim, replay.ralenti || 1, tout));   // blocs casses faute d'appui : en tete (ils comptent)
  // monde : explosions, chutes, fluides, objets au sol, morts (une ligne ; chaque morceau n'apparait que s'il y a quelque chose)
  const S = sim.stats, M = [];
  if (S.explosions) M.push(`explosions ${S.explosions} (${S.explosionsBlocs} blocs${S.objets ? ', ' + S.objets + ' objets' : ''})`);
  if (S.chutes) M.push(`chutes ${S.chutes} (max ${S.chuteMax} pv)`);
  const eauN = (parType.get('water') || 0), laveN = (parType.get('lava') || 0), roche = (parType.get('obsidian') || 0) + (parType.get('cobblestone') || 0) + (parType.get('basalt') || 0);
  if (sim.nbFluides) M.push(`fluides ${sim.nbFluides} pas (eau ${eauN}, lave ${laveN}${roche ? ', roche ' + roche : ''})`);
  if (S.ramasses) M.push(`ramasses ${S.ramasses}`);
  if (S.tirs || S.lances) M.push(`tirs ${S.tirs || 0}, lancers ${S.lances || 0} (${S.fleches || 0} fleches et ${S.touches || 0} boules au but, ${S.plantees || 0} plantees${S.teleports ? ', ' + S.teleports + ' teleportations' : ''})`);
  if (S.repas || S.effets || S.jetes || S.transferts || S.cuits) M.push(`objets : repas ${S.repas || 0}, effets ${S.effets || 0}, jetes ${S.jetes || 0}, transferts ${S.transferts || 0}, cuits ${S.cuits || 0}`);
  if (S.arbres || S.foudres || S.neige || S.gels) M.push(`nature : arbres ${S.arbres || 0}, foudres ${S.foudres || 0}, neige ${S.neige || 0}, gel ${S.gels || 0}`);
  if (S.morts) M.push(`morts ${S.morts} (${(S.mortsListe || []).slice(0, 2).join(', ')})`);
  if (M.length) L.push('monde : ' + M.join(' ; '));
  // combat : totems d'immortalite, coups ecrasants de la masse et relances de la Rafale de vent (hauteur au sommet), pieces d'armure cassees
  const C = [];
  if (S.totems?.length) C.push(`totems ${S.totems.length} (${S.totems.slice(0, 2).map((l) => l.split(' : totem')[0]).join(', ')})`);
  if (S.coupsEcrasants?.length) C.push(`ecrasants ${S.coupsEcrasants.length} (${S.coupsEcrasants.slice(0, 3).map((l) => l.split(' ').slice(1).join(' ')).join(', ')})`);
  if (S.relances?.length) C.push(`relances ${S.relances.slice(0, 3).join(', ')}`);
  if (S.objetsCasses?.length) C.push(`casses ${S.objetsCasses.slice(0, 2).map((l) => l.split(' ').slice(1).join(' ')).join(', ')}`);
  if (C.length) L.push('combat : ' + C.join(' ; '));
  // solidite qui reste a chaque piece d'armure des acteurs touches (tous les modes sauf le creatif : inventaire.js userArmure), une ligne par acteur
  for (const x of (sim.acteurs?.liste ?? []).filter((v) => v.armure && v.touche && !v.typeCreature).slice(0, 3)) {
    const P = [];
    for (const e of ['tete', 'torse', 'jambes', 'pieds']) {
      const t = x.armure[e]; if (!t) continue;
      const id = idArmure(sim.d, t, e), max = composants(sim.d, id).usureMax;
      if (!max) continue;
      P.push(`${PIECES[e]} ${id.replace(/_(helmet|chestplate|leggings|boots)$/, '')} ${max - lirePile(t).usure}/${max}`);
    }
    for (const e of ['tete', 'torse', 'jambes', 'pieds']) if (!x.armure[e] && x.armureDepart?.[e]) P.push(`${PIECES[e]} cassee`);
    if (P.length) L.push(`armure ${x.nom} : ${P.join(', ')}`);
  }
  // IA des creatures : une ligne de compteurs, puis les evenements (attaques, tirs, explosions, morts, brulures) en abrege
  if (S.ia || S.iaJournal || S.coups) {
    const I = S.ia || {};
    L.push(`ia : cibles ${I.cibles || 0}, attaques ${I.attaques || 0}, tirs ${I.tirs || 0}, explosions ${I.explosions || 0}, fuites ${I.fuites || 0}, paniques ${I.paniques || 0}, brulures ${I.brulures || 0}${I.portesCassees ? ', portes cassees ' + I.portesCassees : ''}${S.coups ? ', coups du joueur ' + S.coups.length : ''}`);
    const J = [...(S.iaJournal || []), ...(S.coups || [])].sort((p, q) => parseFloat(p) - parseFloat(q));
    const tri = J.filter((l) => / (meurt|explose|brule)/.test(l)).concat(J.filter((l) => !/ (meurt|explose|brule)/.test(l))).slice(0, 6);
    if (tri.length) L.push('ia : ' + tri.map((l) => l.replace(/^(d+).(d)d? /, '$1,$2s ')).join(' ; ').slice(0, 300));
  }
  // vie des creatures (moteur/ia-vie.js) : entites nees (bebes, conversions, golems), amours, abeilles, danses
  if (replay.naissances?.length || S.ia?.amours || S.ia?.pollinisations || S.ia?.danses || replay.croissances?.length) {
    const I = S.ia || {}, V = [];
    if (replay.naissances?.length) V.push(`nes ${replay.naissances.length} (${replay.naissances.slice(0, 4).map((n) => `${n.nom} t=${fr(n.tick / 20 / replay.ralenti, 1)} ${n.raison}`).join(', ')}${replay.naissances.length > 4 ? '...' : ''})`);
    if (replay.croissances?.length) V.push(`changements ${replay.croissances.length}`);
    if (I.amours || I.amoursVillageois) V.push(`amours ${(I.amours || 0) + (I.amoursVillageois || 0)}`);
    if (I.pollinisations || I.entreesRuche) V.push(`abeilles : fleurs ${I.pollinisations || 0}, nectar ${I.nectars || 0}, ruche ${I.entreesRuche || 0}/${I.sortiesRuche || 0}, miel +${I.miel || 0}, cultures ${I.culturesPoussees || 0}`);
    if (I.danses) V.push(`danses ${I.danses}`);
    if (S.experience) V.push(`xp ${S.experience}`);
    L.push('vie : ' + V.join(' ; '));
  }
  const ev = (replay.sons.length / 7) | 0, pa = (replay.particules.length / 9) | 0;
  if (ev || pa) L.push(`sons ${ev}, particules ${pa} ; voisins mis a jour ${sim.stats.voisins}, ticks planifies ${sim.stats.ticks}, aleatoires ${sim.stats.aleatoires}`);
  const rl = replay.ralenti;
  for (const [tick, t] of tout ? replay.textes : replay.textes.slice(0, 10)) L.push(`t=${fr(tick / 20 / rl, 2)} ${court2(t)}`);   // 10 lignes : les reculs (avant / apres la resistance) ont la leur
  for (const w of replay.avertissements) L.push('avert: ' + w);
  // intentions des acteurs : UNE ligne chacune (fait / interrompu par ... / ECHEC : raison) ; les echecs et interruptions d'abord (ils comptent),
  // puis les reussites, puis les verbes d'etat reussis (regarde, tient, accroupi, saute), tant que ca tient dans la limite
  const A = replay.actes;
  const ligneActe = (a) => `${a.statut === 'ok' ? '' : '! '}t=${fr(a.tick / 20 / rl, 1)} ${a.acteur} ${a.args} ${a.statut === 'ok' ? 'fait' : a.statut === 'echec' ? 'ECHEC' : 'interrompu'}${a.texte ? (a.statut === 'interrompu' && /^par /.test(a.texte) ? ' ' : ' : ') + a.texte : ''}`;
  const etat = (a) => a.statut === 'ok' && ['regarde', 'tient', 'accroupi', 'saute'].includes(a.verbe);
  const actes = A.map((a, i) => ({ i, s: ligneActe(a), mal: a.statut !== 'ok', etat: etat(a) }));
  const base = Buffer.byteLength(L.join('\n'));
  let budget = tout ? Infinity : MAX_OCTETS - base - 40;   // place pour la ligne « (+ n intentions non affichees) » ; --tout : tout
  const gardes = new Set();
  for (const a of actes.filter((x) => x.mal)) { const o = Buffer.byteLength(a.s.slice(0, 150)) + 1; if (budget - o >= 0) { gardes.add(a.i); budget -= o; } }
  for (const a of actes.filter((x) => !x.mal && !x.etat)) { const o = Buffer.byteLength(a.s.slice(0, 110)) + 1; if (budget - o >= 0) { gardes.add(a.i); budget -= o; } }
  for (const a of actes.filter((x) => x.etat)) { const o = Buffer.byteLength(a.s.slice(0, 110)) + 1; if (budget - o >= 0) { gardes.add(a.i); budget -= o; } }
  const nonAffiches = actes.length - gardes.size;
  for (const a of actes) if (gardes.has(a.i)) L.push(a.s.slice(0, a.mal ? 150 : 110));
  if (nonAffiches > 0) L.push(`(+ ${nonAffiches} intentions non affichees)`);
  let out = L.join('\n');
  if (!tout && Buffer.byteLength(out) > MAX_OCTETS) {
    const suite = '\n... (--tout : rapport complet)';
    while (Buffer.byteLength(out + suite) > MAX_OCTETS && L.length > 2) { L.splice(L.length - 1, 1); out = L.join('\n'); }
    out += suite;
  }
  const tr = texteTrace(sim, rl || 1, tout);   // --trace : a part, apres le resume (4 Ko au plus sans --tout)
  return tr ? out + '\n' + tr : out;
}
