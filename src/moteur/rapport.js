// Rapport COURT de `mcanim simuler` (1 Ko au plus ; une ligne compacte "monde" pour explosions, chutes, fluides, objets et morts) : ce qui s'est passe, pour decider avant de payer le rendu.
const fr = (n, d = 1) => n.toFixed(d).replace('.', ',');
export const MAX_OCTETS = 1024;

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
  for (const [tick, t] of replay.textes.slice(0, 8)) L.push(`t=${fr(tick / 20 / rl, 2)} ${t}`);
  for (const w of replay.avertissements) L.push('avert: ' + w);
  // intentions des acteurs : les echecs et interruptions d'abord (ils comptent), puis les reussites, tant que ca tient dans la limite
  const A = replay.actes.filter((a) => !['regarde', 'tient', 'accroupi', 'saute'].includes(a.verbe) || a.statut !== 'ok');
  const ligneActe = (a) => `${a.statut === 'ok' ? '' : '! '}t=${fr(a.tick / 20 / rl, 1)} ${a.acteur} ${a.args}${a.statut === 'ok' ? (a.texte ? ' : ' + a.texte : '') : ` ${a.statut === 'echec' ? 'ECHEC' : 'interrompu'}${a.texte ? ' : ' + a.texte : ''}`}`;
  const actes = A.map((a, i) => ({ i, s: ligneActe(a), mal: a.statut !== 'ok' }));
  const base = Buffer.byteLength(L.join('\n'));
  let budget = MAX_OCTETS - base - 12;
  const gardes = new Set();
  for (const a of actes.filter((x) => x.mal)) { const o = Buffer.byteLength(a.s.slice(0, 150)) + 1; if (budget - o >= 0) { gardes.add(a.i); budget -= o; } }
  for (const a of actes.filter((x) => !x.mal)) { const o = Buffer.byteLength(a.s.slice(0, 110)) + 1; if (budget - o >= 0) { gardes.add(a.i); budget -= o; } }
  const nonAffiches = actes.length - gardes.size;
  for (const a of actes) if (gardes.has(a.i)) L.push(a.s.slice(0, a.mal ? 150 : 110));
  if (nonAffiches > 0) L.push(`(+ ${nonAffiches} intentions non affichees)`);
  let out = L.join('\n');
  if (Buffer.byteLength(out) > MAX_OCTETS) {
    while (Buffer.byteLength(out + '\n...') > MAX_OCTETS && L.length > 2) { L.splice(L.length - 1, 1); out = L.join('\n'); }
    out += '\n...';
  }
  return out;
}
