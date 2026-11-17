// Casser un bloc : vitesse de minage du jeu (BlockBehaviour.getDestroyProgress, Player.getDestroySpeed, Tool.getMiningSpeed / isCorrectForDrops).
// Port de Horizon client/game/{block_breaking,hand}.rs : MIT, voir ATTRIBUTIONS.md. Nombres du jeu : progression par tick
//   = vitesse de l'outil / durete du bloc / (30 si l'outil convient aux butins, sinon 100) ; le bloc casse quand la somme atteint 1.
//   Exemples verifies en test : terre a la main 15 ticks (0,75 s), pierre avec une pioche en bois 23 ticks (1,15 s).
// Les calculs sont faits en flottants simples (Math.fround), comme le jeu, pour arrondir au meme tick.
const f = Math.fround;

// Le bloc `bloc` (indice) est-il dans un des selecteurs : '#etiquette' ou 'nom' ?
function correspond(d, bloc, selecteurs) {
  for (const s of selecteurs) {
    if (s.startsWith('#')) { if (d.etiquette(s).has(bloc)) return true; } else if (d.parNom.get(s) === bloc) return true;
  }
  return false;
}

// Vitesse de base d'un outil sur un bloc (Tool.getMiningSpeed) : la premiere regle qui donne une vitesse et dont le bloc fait partie ; sinon 1.
export function vitesseOutil(d, bloc, nomOutil) {
  const o = nomOutil ? d.outil(nomOutil) : null;
  if (!o) return 1;
  for (const [sel, , vitesse] of o.r) if (vitesse !== null && correspond(d, bloc, sel)) return vitesse;
  return 1;
}
// L'outil convient-il aux butins de ce bloc (Tool.isCorrectForDrops) ? Un bloc qui n'exige pas d'outil donne toujours ses butins.
export function bonOutil(d, etat, nomOutil) {
  if (!d.a(etat, 512 /* OUTIL_REQUIS */)) return true;
  const o = nomOutil ? d.outil(nomOutil) : null;
  if (!o) return false;
  const bloc = d.blocDe(etat);
  for (const [sel, ok] of o.r) if (ok !== -1 && correspond(d, bloc, sel)) return ok === 1;
  return false;
}

// Progression par tick (flottant simple) d'un etat de bloc pour un joueur : { progression, bonOutil, vitesse, durete }
// contexte : { outil (nom d'objet ou null), efficacite (niveau), hate (niveau, 0 = rien), fatigue (niveau, 0 = rien), auSol (vrai), sousEau (faux), multiplicateur }
export function progressionParTick(d, etat, ctx = {}) {
  const durete = d.durete(etat);
  if (durete === -1) return { progression: 0, bonOutil: false, vitesse: 0, durete, incassable: true };
  const bloc = d.blocDe(etat);
  let v = f(vitesseOutil(d, bloc, ctx.outil));
  if (v > 1 && ctx.efficacite > 0) v = f(v + f(ctx.efficacite * ctx.efficacite + 1));   // attribut mining_efficiency de l'enchantement
  if (ctx.hate > 0) v = f(v * f(1 + ctx.hate * 0.2));
  if (ctx.fatigue > 0) v = f(v * [0.3, 0.09, 0.0027, 0.00081][Math.min(ctx.fatigue - 1, 3)]);
  if (ctx.sousEau) v = f(v * 0.2);                    // SUBMERGED_MINING_SPEED
  if (ctx.auSol === false) v = f(v / 5);
  if (ctx.multiplicateur && ctx.multiplicateur !== 1) v = f(v * ctx.multiplicateur);
  const ok = bonOutil(d, etat, ctx.outil);
  const p = f(f(v / f(durete)) / (ok ? 30 : 100));
  return { progression: p, bonOutil: ok, vitesse: v, durete };
}

// Nombre de ticks pour casser : 0 si le bloc part des le premier clic (progression >= 1), sinon le nombre de ticks de minage, ou Infinity.
export function ticksPourCasser(progression) {
  if (progression >= 1) return 0;
  if (!(progression > 0)) return Infinity;
  let somme = 0, n = 0;
  while (somme < 1 && n < 100000) { somme = f(somme + progression); n++; }
  return n;
}

// Etape de fissure (0..9) pour une progression 0..1 (Level.destroyBlockProgress(id, pos, (int)(progress * 10)))
export const etapeFissure = (p) => Math.max(0, Math.min(9, Math.floor(p * 10)));
