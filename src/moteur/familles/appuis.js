// Famille "appuis" : blocs que le jeu CASSE quand leur appui disparait et qu'aucune autre famille ne couvrait encore : tapis, plantes (fleurs,
// herbes, pousses, buissons, plantes hautes), panneaux, lanternes, echelles. Les torches, rails, boutons, leviers, plaques, portes, poudre,
// repeteurs et comparateurs ont deja leur survie (torches.js, rails.js, boutons.js, portes.js, redstone.js).
// Port de canSurvive / updateShape du jeu (Horizon world/level/survive.rs : MIT, voir ATTRIBUTIONS.md) :
//   CarpetBlock : !isEmptyBlock(dessous) ; VegetationBlock : mayPlaceOn(dessous) = tag #supports_vegetation (le jeu 26.x ; les sous-classes
//   ont leur tag : WitherRoseBlock #supports_wither_rose, DryVegetationBlock #supports_dry_vegetation, AzaleaBlock #supports_azalea,
//   NetherWartBlock #supports_nether_wart, NetherFungusBlock supportBlocks) ; DoublePlantBlock : la moitie haute tient a la basse, et la basse
//   au sol ; StandingSignBlock : dessous isSolid ; WallSignBlock : derriere isSolid ; LanternBlock : centre de la face (dessus ou dessous) ;
//   LadderBlock : face pleine derriere. Classes EXACTES seulement (les sous-classes aux regles a part, nenuphar, herbes marines, petite
//   grande-feuille, propagule de paletuvier, cultures, tapis de mousse pale, ne sont pas touchees).
// Le moteur note chaque bloc casse ainsi (simulation.js `retraits`) : `mcanim simuler` ecrit « ! comparator en x,y,z retiré : pas d'appui ».
const VEG = {
  FlowerBlock: '#minecraft:supports_vegetation', TallGrassBlock: '#minecraft:supports_vegetation', SaplingBlock: '#minecraft:supports_vegetation',
  BushBlock: '#minecraft:supports_vegetation', FireflyBushBlock: '#minecraft:supports_vegetation', FlowerBedBlock: '#minecraft:supports_vegetation',
  SweetBerryBushBlock: '#minecraft:supports_vegetation', EyeblossomBlock: '#minecraft:supports_vegetation', WitherRoseBlock: '#minecraft:supports_wither_rose',
  DryVegetationBlock: '#minecraft:supports_dry_vegetation', AzaleaBlock: '#minecraft:supports_azalea', NetherWartBlock: '#minecraft:supports_nether_wart',
  NetherFungusBlock: 'champs', DoublePlantBlock: '#minecraft:supports_vegetation', TallFlowerBlock: '#minecraft:supports_vegetation',
};
const DOUBLES = new Set(['DoublePlantBlock', 'TallFlowerBlock']);
const AUTRES = new Set(['CarpetBlock', 'WoolCarpetBlock', 'StandingSignBlock', 'WallSignBlock', 'LanternBlock', 'LadderBlock']);
const FACE_JEU = { north: 'nord', south: 'sud', west: 'ouest', east: 'est' };
const OPPOSEE = { bas: 'haut', haut: 'bas', nord: 'sud', sud: 'nord', ouest: 'est', est: 'ouest' };
const DELTA = { bas: [0, -1, 0], haut: [0, 1, 0], nord: [0, 0, -1], sud: [0, 0, 1], ouest: [-1, 0, 0], est: [1, 0, 0] };
const AIR = /^minecraft:(air|cave_air|void_air)$/;

const lire = (chaine) => {
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(String(chaine));
  const p = {};
  if (m?.[2]) for (const kv of m[2].split(',')) { const [k, v] = kv.split('='); p[k] = v; }
  return { nom: m ? m[1] : '', p };
};

export function installer(mc, regles) {
  regles.declarer('appuis.survie', { def: true, doc: 'tapis, plantes, panneaux, lanternes, echelles tombent (deviennent de l\'air) quand leur appui disparait, comme dans le jeu' });
  const d = mc.donnees;
  if (!d) return;   // `mcanim regles --liste` : la regle seule
  // classe exacte de chaque bloc (le premier maillon de sa chaine de classes)
  const parClasse = new Map();
  for (let b = 0; b < d.noms.length; b++) {
    const c = d.classes(b)[0];
    if (!VEG[c] && !AUTRES.has(c)) continue;
    if (!parClasse.has(c)) parClasse.set(c, []);
    parClasse.get(c).push(d.noms[b]);
  }
  const actif = (monde) => monde.regle('appuis.survie', true);
  const air = 'minecraft:air';
  for (const [classe, noms] of parClasse) {
    for (const nom of noms) {
      const bl = mc.bloc(nom);
      if (VEG[classe]) {
        const tag = VEG[classe];
        // VegetationBlock.canSurvive : mayPlaceOn(dessous) ; cellule cachee dessous : appui suppose (on ne casse rien qu'on ne voit pas)
        const surSol = (monde, [x, y, z]) => {
          if (monde.bloc(x, y - 1, z).id < 0) return true;
          const t = tag === 'champs' ? monde.champs(nom)?.supportBlocks : tag;
          return t ? monde.estDans(x, y - 1, z, t) : true;
        };
        if (DOUBLES.has(classe)) {
          // DoublePlantBlock.canSurvive : moitie haute = la basse du meme bloc dessous ; basse = le sol
          bl.sur('survit', (ev, monde) => {
            const e = lire(ev.etat);
            if (e.p.half !== 'upper') return surSol(monde, ev.pos);
            const s = lire(monde.bloc(ev.pos[0], ev.pos[1] - 1, ev.pos[2]).chaine);
            return s.nom === nom && s.p.half === 'lower';
          });
          // DoublePlantBlock.updateShape : l'autre moitie manque -> air ; la basse sans sol -> air
          bl.sur('forme', (ev, monde) => {
            if (!actif(monde)) return undefined;
            const e = lire(ev.etat), haut = e.p.half === 'upper';
            if (ev.direction === (haut ? 'bas' : 'haut')) { const v = lire(ev.voisin); if (v.nom !== nom || v.p.half === e.p.half) return air; return undefined; }
            if (!haut && ev.direction === 'bas' && !monde.survit(...ev.pos)) return air;
            return undefined;
          });
        } else {
          bl.sur('survit', (ev, monde) => surSol(monde, ev.pos));
          // VegetationBlock.updateShape : quel que soit le voisin, plus d'appui -> air
          bl.sur('forme', (ev, monde) => (actif(monde) && !monde.survit(...ev.pos) ? air : undefined));
        }
        continue;
      }
      if (classe === 'CarpetBlock' || classe === 'WoolCarpetBlock') {
        bl.sur('survit', (ev, monde) => { const s = monde.bloc(ev.pos[0], ev.pos[1] - 1, ev.pos[2]); return s.id < 0 || !AIR.test(s.nom); });
        bl.sur('forme', (ev, monde) => (actif(monde) && !monde.survit(...ev.pos) ? air : undefined));
      } else if (classe === 'StandingSignBlock') {
        bl.sur('survit', (ev, monde) => monde.solide(ev.pos[0], ev.pos[1] - 1, ev.pos[2]));
        bl.sur('forme', (ev, monde) => (actif(monde) && ev.direction === 'bas' && !monde.survit(...ev.pos) ? air : undefined));
      } else if (classe === 'WallSignBlock' || classe === 'LadderBlock') {
        // derriere = la cellule opposee a `facing` ; panneau : isSolid ; echelle : face pleine (isFaceSturdy FULL) tournee vers elle
        const derriere = (ev) => { const f = FACE_JEU[lire(ev.etat).p.facing] ?? 'nord'; const [dx, dy, dz] = DELTA[OPPOSEE[f]]; return { f, p: [ev.pos[0] + dx, ev.pos[1] + dy, ev.pos[2] + dz] }; };
        bl.sur('survit', (ev, monde) => { const { f, p } = derriere(ev); return classe === 'LadderBlock' ? monde.appui(p[0], p[1], p[2], f, 'plein') : monde.solide(...p); });
        bl.sur('forme', (ev, monde) => (actif(monde) && ev.direction === OPPOSEE[derriere(ev).f] && !monde.survit(...ev.pos) ? air : undefined));
      } else if (classe === 'LanternBlock') {
        // suspendue : centre de la face du dessous du bloc du dessus ; posee : centre de la face du dessus du bloc du dessous
        bl.sur('survit', (ev, monde) => { const pend = lire(ev.etat).p.hanging === 'true'; return pend ? monde.appui(ev.pos[0], ev.pos[1] + 1, ev.pos[2], 'bas', 'centre') : monde.appui(ev.pos[0], ev.pos[1] - 1, ev.pos[2], 'haut', 'centre'); });
        bl.sur('forme', (ev, monde) => { if (!actif(monde)) return undefined; const pend = lire(ev.etat).p.hanging === 'true'; return ev.direction === (pend ? 'haut' : 'bas') && !monde.survit(...ev.pos) ? air : undefined; });
      }
    }
  }
}
