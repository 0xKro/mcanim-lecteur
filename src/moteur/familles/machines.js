// Famille "machines" : paratonnerre, pupitre, colonnes de bulles, balise. Ecrite avec la MEME API que les mods.
// Port de LightningRodBlock, LecternBlock / LecternBlockEntity, BubbleColumnBlock (+ LiquidBlock.updateShape / tick), BeaconBlockEntity
// (Horizon horizon-world/src/level/{hooks,tick,shapes,survive,redstone}.rs, horizon-client/src/game/{lightning,books,beacon}.rs : MIT, voir ATTRIBUTIONS.md).
//   - Paratonnerre : la foudre naturelle (sans y impose) cherche le paratonnerre le plus proche a 128 blocs dont le bloc est le dessus de sa
//     colonne et frappe juste au-dessus ; frappe : powered (15, fort vers son support) pendant 8 ticks, evenement 3002 (etincelles).
//   - Pupitre : `utilise` avec un livre (`writable_book`, `written_book`, etiquette #lectern_books) le pose (has_book, son item.book.put) ;
//     `[t, "page", x, y, z, n]` tourne la page (impulsion de 2 ticks, evenement 1043, son item.book.page_turn) ; comparateur :
//     floor(page / (pages - 1) x 14) + 1 (1 page : 15), 0 sans livre ; cassé : le livre tombe un quart de bloc devant, un bloc plus haut.
//   - Colonne de bulles : une source d'eau pleine au-dessus du sable des ames (monte) ou du bloc de magma (descend) devient colonne 20 ticks
//     plus tard, et toute l'eau au-dessus avec elle ; elle redevient de l'eau 5 ticks apres que son pied a change ; les entites dedans
//     montent (min(0,7 ; vy + 0,06)) ou descendent (max(-0,3 ; vy - 0,03)), plus fort a la surface (min(1,8 ; vy + 0,1) / max(-0,9 ; vy - 0,03)).
//   - Balise : toutes les 80 ticks (temps du monde) les etages de la pyramide (1 a 4 : blocs #beacon_base_blocks), puis l'effet choisi aux
//     joueurs a portee (10 x etages + 10, toute la hauteur) pendant (9 + 2 x etages) x 20 ticks (II si le second pouvoir est le meme, 4 etages) ;
//     faisceau : 10 blocs verifies par tick vers le haut, teint par le verre colore (moyenne des couleurs), coupe par un bloc opaque (sauf bedrock).
//     Pouvoirs : champ de scene `monde.balises: [[x, y, z, "speed", "regeneration"?]]` (le menu du jeu).

import { Aleatoire } from '../aleatoire.js';

const DYE = { white: 0xF9FFFE, orange: 0xF9801D, magenta: 0xC74EBD, light_blue: 0x3AB3DA, yellow: 0xFED83D, lime: 0x80C71F, pink: 0xF38BAA, gray: 0x474F52, light_gray: 0x9D9D97, cyan: 0x169C9C, purple: 0x8932B8, blue: 0x3C44AA, brown: 0x835432, green: 0x5E7C16, red: 0xB02E26, black: 0x1D1D21 };   // DyeColor.getTextureDiffuseColor (Horizon mobs/render.rs DYE)
export const EFFETS_BALISE = { speed: 1, haste: 1, resistance: 2, jump_boost: 2, strength: 3, regeneration: 4 };   // BEACON_EFFECTS et l'etage qu'il faut
const moyenne = (a, b) => [16, 8, 0].reduce((acc, s) => acc | ((((a >> s) & 255) + ((b >> s) & 255)) >> 1) << s, 0);   // ARGB.average
const VEC = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
const FRD = { north: 'nord', south: 'sud', west: 'ouest', east: 'est', up: 'haut', down: 'bas' };

export function installer(mc, regles) {
  regles.declarer('paratonnerre.portee', { def: 128, min: 0, max: 512, entier: true, doc: 'distance a laquelle la foudre trouve un paratonnerre (jeu : 128)' });
  regles.declarer('bulles.actif', { def: true, doc: 'colonnes de bulles au-dessus du sable des ames et du magma (jeu : oui)' });
  regles.declarer('balise.actif', { def: true, doc: 'les balises donnent leur effet et leur faisceau (jeu : oui)' });

  // ------------------------------------------------------------ paratonnerre (LightningRodBlock)
  const rods = new Set();   // positions connues 'x,y,z'
  const majRod = (monde, p) => { const n = monde.nom(...p); const k = p.join(','); if (/lightning_rod$/.test(n)) rods.add(k); else rods.delete(k); };
  mc.bloc('LightningRodBlock').sur('pose', (ev, monde) => {
    majRod(monde, ev.pos);
    if (!ev.memeBloc && monde.prop(...ev.pos, 'powered') === 'true' && !monde.aTickPlanifie(...ev.pos)) monde.planifier(ev.pos[0], ev.pos[1], ev.pos[2], 8);
  });
  const voisinsRod = (monde, p, facing) => { const d = OPP[facing], q = [p[0] + VEC[d][0], p[1] + VEC[d][1], p[2] + VEC[d][2]]; monde.notifierVoisins(q[0], q[1], q[2], 'lightning_rod'); };
  mc.bloc('LightningRodBlock').sur('retire', (ev, monde) => {
    if (ev.nouveau.startsWith('minecraft:' + ev.bloc)) return;
    rods.delete(ev.pos.join(','));
    if (/powered=true/.test(ev.etat)) voisinsRod(monde, ev.pos, /facing=(\w+)/.exec(ev.etat)[1]);
  });
  mc.bloc('LightningRodBlock').sur('tick', (ev, monde) => {
    const p = ev.pos;
    monde.poser(p[0], p[1], p[2], ev.etat.replace('powered=true', 'powered=false'), 3);
    voisinsRod(monde, p, monde.prop(...p, 'facing'));
  });
  mc.monde.sur('debutTick', (ev, monde) => { if (ev.tick === 0) for (const p of monde.blocsDeClasse('LightningRodBlock')) rods.add(p.join(',')); });
  // findLightningRod : la cible d'une foudre naturelle (Meteo.foudre la demande ; rien sans paratonnerre)
  mc.monde.sur('meteo.cibleFoudre', (ev, monde) => {
    const R = monde.regle('paratonnerre.portee', 128), c = ev.centre;
    let best = null, bd = Infinity;
    for (const k of rods) {
      const p = k.split(',').map(Number);
      if (!/lightning_rod$/.test(monde.nom(...p))) continue;
      const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
      if (d > R * R || d >= bd) continue;
      if (p[1] !== monde.surface(p[0], p[2]) - 1) continue;
      best = p; bd = d;
    }
    if (best) ev.cible = [best[0], best[1] + 1, best[2]];
  });
  // LightningBolt -> LightningRodBlock.onLightningStrike
  mc.monde.sur('meteo.foudre', (ev, monde) => {
    if (ev.visuel) return;
    const p = [Math.floor(ev.pos[0]), Math.floor(ev.pos[1] - 1e-6), Math.floor(ev.pos[2])];
    if (!/lightning_rod$/.test(monde.nom(...p))) return;
    const e = monde.bloc(...p).chaine;
    monde.poser(p[0], p[1], p[2], e.replace('powered=false', 'powered=true'), 3);
    monde.planifier(p[0], p[1], p[2], 8);
    const f = monde.prop(...p, 'facing');
    voisinsRod(monde, p, f);
    monde.evenementNiveau(3002, p, f === 'east' || f === 'west' ? 0 : f === 'north' || f === 'south' ? 2 : 1);
    monde.dire(`foudre sur le paratonnerre (${p.join(',')})`);
  });

  // ------------------------------------------------------------ pupitre (LecternBlock)
  const pupitres = new Map();   // 'x,y,z' -> { livre, pages, page }
  const LIVRES = /^(writable_book|written_book)$/;
  const basPupitre = (monde, p) => monde.notifierVoisins(p[0], p[1] - 1, p[2], 'lectern');
  const signalPage = (monde, p) => {   // LecternBlock.signalPageChange : powered 2 ticks, evenement 1043
    monde.poser(p[0], p[1], p[2], monde.bloc(...p).chaine.replace('powered=false', 'powered=true'), 3);
    basPupitre(monde, p);
    monde.planifier(p[0], p[1], p[2], 2);
    monde.evenementNiveau(1043, p, 0);
  };
  mc.bloc('LecternBlock').sur('tick', (ev, monde) => {
    monde.poser(ev.pos[0], ev.pos[1], ev.pos[2], ev.etat.replace('powered=true', 'powered=false'), 3);
    basPupitre(monde, ev.pos);
  });
  mc.bloc('LecternBlock').sur('utilise', (ev, monde) => {
    const p = ev.pos, k = p.join(','), o = String(ev.objet ?? '').replace(/^minecraft:/, '');
    if (pupitres.get(k)?.livre || /has_book=true/.test(ev.etat)) return 'fait';   // lire le livre : l'ecran du joueur (rien dans le monde)
    if (!LIVRES.test(o)) return undefined;   // #lectern_books du jeu : writable_book, written_book
    pupitres.set(k, { livre: o, pages: ev.pages ?? 1, page: 0 });
    monde.poser(p[0], p[1], p[2], ev.etat.replace('has_book=false', 'has_book=true'), 3);
    monde.son('item.book.put', p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 1, 1);
    monde.contenuNotifie(...p);
    ev.consomme = true;
    return 'fait';
  });
  mc.bloc('LecternBlock').sur('retire', (ev, monde) => {
    if (ev.nouveau.startsWith('minecraft:lectern')) return;
    const k = ev.pos.join(','), l = pupitres.get(k);
    pupitres.delete(k);
    if (/powered=true/.test(ev.etat)) basPupitre(monde, ev.pos);
    if (l?.livre) {   // LecternBlockEntity.preRemoveSideEffects : un quart de bloc vers l'avant, un bloc plus haut
      const v = VEC[/facing=(\w+)/.exec(ev.etat)[1]] ?? [0, 0, 0];
      monde.lacher(l.livre, 1, ev.pos[0] + 0.5 + v[0] * 0.25, ev.pos[1] + 1, ev.pos[2] + 0.5 + v[2] * 0.25, { pages: l.pages });
    }
  });
  mc.monde.sur('pupitre.page', (ev, monde) => {
    const k = ev.pos.join(','), l = pupitres.get(k);
    if (!l?.livre) return;
    const page = Math.max(0, Math.min(l.pages - 1, ev.page | 0));
    if (page === l.page) return;
    l.page = page;
    signalPage(monde, ev.pos);
    monde.son('item.book.page_turn', ev.pos[0] + 0.5, ev.pos[1] + 0.5, ev.pos[2] + 0.5, 1, 1);
    monde.contenuNotifie(...ev.pos);
  });
  mc.monde.sur('pupitre.livre', (ev) => { pupitres.set(ev.pos.join(','), { livre: ev.livre, pages: Math.max(1, ev.pages | 0), page: Math.max(0, Math.min((ev.pages | 0) - 1, ev.page | 0)) }); });
  // LecternBlock.getAnalogOutputSignal
  mc.monde.sur('redstone.analogique', (ev, monde) => {
    if (ev.bloc !== 'minecraft:lectern') return;
    if (monde.prop(...ev.pos, 'has_book') !== 'true') { ev.valeur = 0; return; }
    const l = pupitres.get(ev.pos.join(','));
    if (!l?.livre) { ev.valeur = 14; return; }
    const f = l.pages > 1 ? Math.fround(l.page / (l.pages - 1)) : 1;
    ev.valeur = Math.floor(Math.fround(f * 14)) + 1;
  });
  mc.monde.sur('pupitre.etat', (ev) => { const l = pupitres.get(ev.pos.join(',')); ev.livre = l?.livre ?? null; ev.page = l?.page ?? 0; ev.pages = l?.pages ?? 0; });

  // ------------------------------------------------------------ colonnes de bulles (BubbleColumnBlock)
  const sous = (monde, p) => monde.nom(p[0], p[1] - 1, p[2]);
  const peutOccuper = (monde, p) => { const n = monde.nom(...p); if (n === 'bubble_column') return true; if (n !== 'water') return false; const f = monde.fluide(...p); return f.source && f.quantite >= 8; };
  const doitOccuper = (monde, p) => monde.nom(...p) === 'water' && monde.fluide(...p).source;
  function majColonne(monde, p) {   // BubbleColumnBlock.updateColumn
    if (!peutOccuper(monde, p)) return;
    const b = sous(monde, p);
    let etat;
    if (b === 'bubble_column') etat = monde.bloc(p[0], p[1] - 1, p[2]).chaine;
    else if (monde.estDans(p[0], p[1] - 1, p[2], '#minecraft:enables_bubble_column_push_up')) etat = 'minecraft:bubble_column[drag=false]';
    else if (monde.estDans(p[0], p[1] - 1, p[2], '#minecraft:enables_bubble_column_drag_down')) etat = 'minecraft:bubble_column[drag=true]';
    else if (monde.nom(...p) === 'bubble_column') etat = 'minecraft:water[level=0]';
    else etat = monde.bloc(...p).chaine;
    monde.poser(p[0], p[1], p[2], etat, 2);
    for (let y = p[1] + 1; peutOccuper(monde, [p[0], y, p[2]]); y++) if (!monde.poser(p[0], y, p[2], etat, 2)) return;
  }
  mc.bloc('water').sur('forme', (ev, monde) => {
    if (!monde.regle('bulles.actif', true) || ev.direction !== 'bas' || !doitOccuper(monde, ev.pos)) return undefined;
    const b = ev.voisinPos;
    if (monde.estDans(b[0], b[1], b[2], '#minecraft:enables_bubble_column_drag_down') || monde.estDans(b[0], b[1], b[2], '#minecraft:enables_bubble_column_push_up')) monde.planifier(ev.pos[0], ev.pos[1], ev.pos[2], 20);
    return undefined;
  });
  // LiquidBlock.onPlace / neighborChanged (Horizon level/fluids.rs liquid_block_changed) : une source pleine posee (seau, eau qui devient source,
  // bloc retire puis eau qui coule et se fait source) ou dont un voisin change, sur sable des ames ou magma : colonne 20 ticks plus tard
  const essayer = (ev, monde) => {
    if (!monde.regle('bulles.actif', true) || !doitOccuper(monde, ev.pos)) return undefined;
    const p = ev.pos;
    if (monde.estDans(p[0], p[1] - 1, p[2], '#minecraft:enables_bubble_column_drag_down') || monde.estDans(p[0], p[1] - 1, p[2], '#minecraft:enables_bubble_column_push_up')) monde.planifier(p[0], p[1], p[2], 20);
    return undefined;
  };
  mc.bloc('water').sur('pose', essayer);
  mc.bloc('water').sur('voisin', essayer);
  mc.bloc('water').sur('tick', (ev, monde) => { if (monde.regle('bulles.actif', true) && doitOccuper(monde, ev.pos)) majColonne(monde, ev.pos); });
  mc.bloc('BubbleColumnBlock').sur('tick', (ev, monde) => majColonne(monde, ev.pos));
  mc.bloc('BubbleColumnBlock').sur('survit', (ev, monde) => {
    const p = ev.pos;
    return sous(monde, p) === 'bubble_column' || monde.estDans(p[0], p[1] - 1, p[2], '#minecraft:enables_bubble_column_push_up') || monde.estDans(p[0], p[1] - 1, p[2], '#minecraft:enables_bubble_column_drag_down');
  });
  mc.bloc('BubbleColumnBlock').sur('forme', (ev, monde) => {
    const p = ev.pos;
    monde.planifierFluide(p[0], p[1], p[2], 5);
    const v = ev.voisinPos;
    if (!monde.survit(...p) || ev.direction === 'bas' || (ev.direction === 'haut' && monde.nom(...v) !== 'bubble_column' && peutOccuper(monde, v))) monde.planifier(p[0], p[1], p[2], 5);
    return undefined;
  });
  // BubbleColumnBlock.animateTick (ClientLevel.animateTick : 667 cellules tirees a 16 blocs et 667 a 32 par tick autour de la camera, soit
  // ~0,0186 + ~0,0024 par cellule proche) : bulles montantes (deux, vitesse 0,04) ou courant descendant, bruit 1 sur 200. Le moteur ne connait pas
  // la camera : le taux d'une cellule a moins de 16 blocs est pris partout ; un hasard a part (le hasard du monde n'est pas touche).
  const colonnes = new Set();
  const amb = new Aleatoire(0x5DEECE66 ^ 0x2B);
  const TAUX = 667 / (33 * 33 * 33) + 667 / (65 * 65 * 65);
  mc.bloc('BubbleColumnBlock').sur('pose', (ev) => colonnes.add(ev.pos.join(',')));
  mc.bloc('BubbleColumnBlock').sur('retire', (ev) => { if (!ev.nouveau.startsWith('minecraft:bubble_column')) colonnes.delete(ev.pos.join(',')); });
  mc.monde.sur('debutTick', (ev, monde) => { if (ev.tick === 0) for (const p of monde.blocsDeClasse('BubbleColumnBlock')) colonnes.add(p.join(',')); });
  mc.monde.sur('finTick', (ev, monde) => {
    for (const k of colonnes) {
      if (amb.flottant() >= TAUX) continue;
      const [x, y, z] = k.split(',').map(Number);
      if (monde.nom(x, y, z) !== 'bubble_column') continue;
      if (monde.prop(x, y, z, 'drag') === 'true') {
        monde.particule('current_down', x + 0.5, y + 0.8, z, 0, 0, 0, 1);
        if (amb.entierBorne(200) === 0) monde.son('block.bubble_column.whirlpool_ambient', x, y, z, 0.2 + amb.flottant() * 0.2, 0.9 + amb.flottant() * 0.15);
      } else {
        monde.particule('bubble_column_up', x + 0.5, y, z + 0.5, 0, 0.04, 0, 1);
        monde.particule('bubble_column_up', x + amb.flottant(), y + amb.flottant(), z + amb.flottant(), 0, 0.04, 0, 1);
        if (amb.entierBorne(200) === 0) monde.son('block.bubble_column.upwards_ambient', x, y, z, 0.2 + amb.flottant() * 0.2, 0.9 + amb.flottant() * 0.15);
      }
    }
    // LightningRodBlock.animateTick : pendant un orage, etincelles sur le paratonnerre du dessus (plus souvent au fil de 200 ticks)
    if (rods.size && monde.niveauxMeteo().orage > 0.9) for (const k of rods) {
      if (amb.flottant() >= TAUX) continue;
      const p = k.split(',').map(Number);
      if (amb.entierBorne(200) > monde.tempsMonde() % 200 || p[1] !== monde.surface(p[0], p[2]) - 1) continue;
      const f = monde.prop(...p, 'facing'), axe = f === 'east' || f === 'west' ? 0 : f === 'up' || f === 'down' ? 1 : 2, n = 1 + amb.entierBorne(2);
      for (let i = 0; i < n; i++) { const c = [0, 1, 2].map((a) => p[a] + 0.5 + (amb.reel() * 2 - 1) * (a === axe ? 0.5 : 0.125)); monde.particule('electric_spark', c[0], c[1], c[2], axe === 0 ? amb.reel() * 2 - 1 : 0, axe === 1 ? amb.reel() * 2 - 1 : 0, axe === 2 ? amb.reel() * 2 - 1 : 0, 1); }
    }
  });

  // ------------------------------------------------------------ balise (BeaconBlockEntity)
  const balises = new Map();   // 'x,y,z' -> { pos, niveaux, sections, enCours, dernierY, primaire, secondaire }
  const nouvelleBalise = (p) => ({ pos: p, niveaux: 0, sections: [], enCours: [], dernierY: p[1] - 1, primaire: null, secondaire: null });
  mc.bloc('BeaconBlock').sur('pose', (ev) => { const k = ev.pos.join(','); if (!balises.has(k)) balises.set(k, nouvelleBalise(ev.pos)); });
  mc.bloc('BeaconBlock').sur('retire', (ev) => { if (!ev.nouveau.startsWith('minecraft:beacon')) balises.delete(ev.pos.join(',')); });
  mc.monde.sur('debutTick', (ev, monde) => {
    if (ev.tick !== 0) return;
    for (const p of monde.blocsDeClasse('BeaconBlock')) if (!balises.has(p.join(','))) balises.set(p.join(','), nouvelleBalise(p));
    for (const [x, y, z, a, b] of monde.configBalises()) {
      const k = [x, y, z].join(','), B = balises.get(k);
      if (!B) { monde.avertir(`monde.balises : pas de balise en ${k}`); continue; }
      B.primaire = a ? String(a).replace(/^minecraft:/, '') : null; B.secondaire = b ? String(b).replace(/^minecraft:/, '') : null;
    }
  });
  const couleurBloc = (nom) => { if (nom === 'beacon') return DYE.white; const m = /^(\w+?)_stained_glass(_pane)?$/.exec(nom); return m && DYE[m[1]] !== undefined ? DYE[m[1]] : null; };
  const etages = (monde, [x, y, z]) => {
    let n = 0;
    for (let k = 1; k <= 4; k++) {
      const ly = y - k;
      if (ly < -64) break;
      let ok = true;
      for (let lx = x - k; lx <= x + k && ok; lx++) for (let lz = z - k; lz <= z + k && ok; lz++) ok = monde.estDans(lx, ly, lz, '#minecraft:beacon_base_blocks');
      if (!ok) break;
      n = k;
    }
    return n;
  };
  function tickBalise(monde, B) {
    const [x, y, z] = B.pos, surface = monde.surface(x, z);
    let y0;
    if (B.dernierY < y) { B.enCours = []; B.dernierY = y - 1; y0 = y; } else y0 = B.dernierY + 1;
    for (let i = 0; i < 10 && y0 <= surface; i++) {
      const nom = monde.nom(x, y0, z), c = couleurBloc(nom);
      if (c !== null) {
        if (B.enCours.length <= 1) B.enCours.push([c, 1]);
        else { const der = B.enCours[B.enCours.length - 1]; if (c === der[0]) der[1]++; else B.enCours.push([moyenne(der[0], c), 1]); }
      } else {
        const der = B.enCours[B.enCours.length - 1];
        if (!der || !(monde.opacite(x, y0, z) < 15 || nom === 'bedrock')) { B.enCours = []; B.dernierY = surface; break; }
        der[1]++;
      }
      y0++; B.dernierY++;
    }
    const avant = B.niveaux;
    if (monde.tempsMonde() % 80 === 0) {
      if (B.sections.length) B.niveaux = etages(monde, B.pos);
      if (B.niveaux > 0 && B.sections.length) { effets(monde, B); monde.son('block.beacon.ambient', x + 0.5, y + 0.5, z + 0.5, 1, 1); }
    }
    if (B.dernierY >= surface) {
      B.dernierY = -65;
      B.sections = B.enCours; B.enCours = [];
      if (avant === 0 && B.niveaux > 0) { monde.son('block.beacon.activate', x + 0.5, y + 0.5, z + 0.5, 1, 1); monde.dire(`balise ${x},${y},${z} allumee (${B.niveaux} etage(s))`); }
      else if (avant > 0 && B.niveaux === 0) monde.son('block.beacon.deactivate', x + 0.5, y + 0.5, z + 0.5, 1, 1);
    }
    monde.ecrireBalise(x, y, z, B.niveaux > 0 ? B.sections : []);
  }
  function effets(monde, B) {
    const p = B.primaire;
    if (!p || EFFETS_BALISE[p] === undefined || EFFETS_BALISE[p] > Math.min(B.niveaux, 3) && !(EFFETS_BALISE[p] <= B.niveaux)) return;
    const R = B.niveaux * 10 + 10, [x, y, z] = B.pos, H = 384;
    const boite = [x - R, y - R, z - R, x + 1 + R, y + 1 + R + H, z + 1 + R];
    const amp = B.niveaux >= 4 && B.secondaire === p ? 1 : 0, duree = (9 + B.niveaux * 2) * 20;
    for (const nom of monde.joueursDans(boite)) {
      monde.donnerEffet(nom, p, duree, amp, true);
      if (B.niveaux >= 4 && B.secondaire && B.secondaire !== p) monde.donnerEffet(nom, B.secondaire, duree, 0, true);
    }
  }
  mc.monde.sur('tickBlocsEntites', (ev, monde) => {
    if (!monde.regle('balise.actif', true)) return;
    for (const [k, B] of [...balises]) { if (monde.nom(...B.pos) !== 'beacon') { balises.delete(k); continue; } tickBalise(monde, B); }
  });
  void FRD; void sous;
}
