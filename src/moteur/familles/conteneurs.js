// Famille "conteneurs" : coffres, tonneaux, cloches, blocs musicaux, lits. Port de ChestBlock / BarrelBlock / BellBlock / NoteBlock / BedBlock
// (Horizon world/level/{interact,hooks}.rs, client/game : MIT, voir ATTRIBUTIONS.md). Evenements du monde "conteneur.ouvre" / "conteneur.ferme"
// (le visiteur est un acteur) : un coffre compte ses visiteurs (ContainerOpenersCounter), son couvercle s'anime tant qu'il y en a (le rendu lit
// l'evenement de bloc 'coffre' du replay), le son est joue au passage de 0 a 1 visiteur puis de 1 a 0.
import { avec, court, FR, JEU, VEC, horaire, antihoraire } from './_aide.js';

export const DIRECTIONS_3D = ['down', 'up', 'north', 'south', 'west', 'east'];   // Direction.get3DDataValue
const MOB_HEAD = new Set(['zombie', 'skeleton', 'creeper', 'dragon', 'wither_skeleton', 'piglin', 'custom_head']);
const SON_MOB = { zombie: 'block.note_block.imitate.zombie', skeleton: 'block.note_block.imitate.skeleton', creeper: 'block.note_block.imitate.creeper', dragon: 'block.note_block.imitate.ender_dragon', wither_skeleton: 'block.note_block.imitate.wither_skeleton', piglin: 'block.note_block.imitate.piglin', custom_head: '' };
export const sonInstrument = (nom) => SON_MOB[nom] ?? `block.note_block.${nom}`;

export function installer(mc, regles) {
  regles.declarer('conteneurs.bloquesParBloc', { def: true, doc: 'un coffre ne s\'ouvre pas si un bloc plein est au-dessus (jeu : oui)' });
  regles.declarer('cloche.portee', { def: 2, min: 0, max: 4, doc: 'volume du son de la cloche (jeu : 2)' });

  const visiteurs = new Map();   // 'x,y,z' -> Set des noms
  const cle = (p) => p.join(',');
  const hauteurSon = (monde) => monde.hasard.flottant() * 0.1 + 0.9;

  // ---------------------------------------------------------------- ContainerOpenersCounter
  const emettre = (monde, pos, n) => monde.blocEntite('coffre', pos[0], pos[1], pos[2], n);
  const sonCoffre = (monde, pos, b, son) => {   // ChestBlockEntity.playSound : au milieu d'un double coffre
    let x = pos[0] + 0.5, z = pos[2] + 0.5;
    const type = b.etat.type;
    if (type === 'left' || type === 'right') {
      const f = b.etat.facing, d = VEC[type === 'left' ? horaire(f) : antihoraire(f)];
      x += d[0] * 0.5; z += d[2] * 0.5;
    }
    monde.son(son, x, pos[1] + 0.5, z, 0.5, hauteurSon(monde));
  };
  const sonTonneau = (monde, pos, b, son) => {   // BarrelBlockEntity.playSound : devant la face du tonneau
    const v = VEC[b.etat.facing] ?? [0, 0, 0];
    monde.son(son, pos[0] + 0.5 + v[0] / 2, pos[1] + 0.5 + v[1] / 2, pos[2] + 0.5 + v[2] / 2, 0.5, hauteurSon(monde));
  };
  mc.monde.sur('conteneur.ouvre', (ev, monde) => {
    const pos = ev.pos, k = cle(pos), b = monde.bloc(...pos);
    let s = visiteurs.get(k); if (!s) visiteurs.set(k, (s = new Set()));
    const avant = s.size; s.add(ev.acteur || '?');
    if (/chest/.test(b.nom)) {
      emettre(monde, pos, s.size);
      if (avant === 0) sonCoffre(monde, pos, b, monde.champs(court(b.nom))?.openSound ?? 'block.chest.open');
    } else if (/barrel/.test(b.nom) && avant === 0) {
      monde.poser(pos[0], pos[1], pos[2], avec(b, { open: 'true' }), 3);
      sonTonneau(monde, pos, b, 'block.barrel.open');
    }
  });
  mc.monde.sur('conteneur.ferme', (ev, monde) => {
    const pos = ev.pos, k = cle(pos), s = visiteurs.get(k);
    if (!s || !s.has(ev.acteur || '?')) return;
    s.delete(ev.acteur || '?');
    const b = monde.bloc(...pos);
    if (/chest/.test(b.nom)) {
      emettre(monde, pos, s.size);
      if (s.size === 0) sonCoffre(monde, pos, b, monde.champs(court(b.nom))?.closeSound ?? 'block.chest.close');
    } else if (/barrel/.test(b.nom) && s.size === 0) {
      monde.poser(pos[0], pos[1], pos[2], avec(b, { open: 'false' }), 3);
      sonTonneau(monde, pos, b, 'block.barrel.close');
    }
    if (s.size === 0) visiteurs.delete(k);
  });
  // le coffre ou le tonneau qui disparait ferme ses visiteurs sans bruit
  const retire = (ev, monde) => { void monde; visiteurs.delete(cle(ev.pos)); };
  mc.bloc('ChestBlock').sur('retire', retire);
  mc.bloc('BarrelBlock').sur('retire', retire);

  // ChestBlock.useWithoutItem : un bloc plein au-dessus bloque l'ouverture (isChestBlockedAt)
  const ouvreConteneur = (ev, monde) => {
    const [x, y, z] = ev.pos;
    if (monde.regle('conteneurs.bloquesParBloc', true) && /chest/.test(monde.bloc(x, y, z).nom) && monde.appui(x, y + 1, z, 'bas', 'plein')) { ev.raison = 'bloc plein au-dessus du coffre'; return 'passe'; }
    ev.ouvre = true;
    return 'fait';
  };
  mc.bloc('ChestBlock').sur('utilise', ouvreConteneur);
  mc.bloc('EnderChestBlock').sur('utilise', ouvreConteneur);
  mc.bloc('BarrelBlock').sur('utilise', ouvreConteneur);

  // ---------------------------------------------------------------- cloche (BellBlock)
  // isProperHit : on frappe le corps (pas la tete, y <= 0,8124), par le cote que l'attache permet
  const bonCoup = (b, face, y) => {
    if (face === 'up' || face === 'down' || y > 0.8124) return false;
    const axeFace = face === 'north' || face === 'south' ? 'z' : 'x';
    const axeBloc = b.etat.facing === 'north' || b.etat.facing === 'south' ? 'z' : 'x';
    switch (b.etat.attachment) {
      case 'floor': return axeBloc === axeFace;
      case 'single_wall': case 'double_wall': return axeBloc !== axeFace;
      case 'ceiling': return true;
      default: return false;
    }
  };
  const sonner = (monde, pos, direction) => {
    monde.blocEntite('cloche', pos[0], pos[1], pos[2], DIRECTIONS_3D.indexOf(direction));
    monde.son('block.bell.use', pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5, monde.regle('cloche.portee', 2), 1);
  };
  mc.bloc('BellBlock').sur('utilise', (ev, monde) => {
    const b = monde.bloc(...ev.pos);
    if (!bonCoup(b, ev.face, ev.hit[1])) { ev.raison = 'il faut frapper le corps de la cloche, pas la tete ni le cote de l\'attache'; return 'passe'; }
    sonner(monde, ev.pos, ev.face);
    return 'fait';
  });
  mc.bloc('BellBlock').sur('alimente', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z), vrai = !!ev.alimente;
    if (vrai === (b.etat.powered === 'true')) return;
    if (vrai) sonner(monde, ev.pos, b.etat.facing);
    monde.poser(x, y, z, avec(b, { powered: vrai ? 'true' : 'false' }), 3);
  });

  // ---------------------------------------------------------------- bloc musical (NoteBlock)
  const jouerNote = (monde, pos, b) => {
    const [x, y, z] = pos, inst = b.etat.instrument, note = Number(b.etat.note);
    const dessus = monde.bloc(x, y + 1, z);
    if (!MOB_HEAD.has(inst) && !/^minecraft:(cave_|void_)?air$/.test(dessus.nom)) return;
    const son = sonInstrument(inst);
    if (son) monde.son(son, x + 0.5, y + 0.5, z + 0.5, 3, MOB_HEAD.has(inst) ? 1 : 2 ** ((note - 12) / 12));
    monde.particule('note', x + 0.5, y + 1.2, z + 0.5, note / 24, 0, 0, 1);
  };
  mc.bloc('NoteBlock').sur('utilise', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z);
    const suivant = avec(b, { note: String((Number(b.etat.note) + 1) % 25) });
    monde.poser(x, y, z, suivant, 3);
    jouerNote(monde, ev.pos, monde.bloc(x, y, z));
    return 'fait';
  });
  mc.bloc('NoteBlock').sur('alimente', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z), vrai = !!ev.alimente;
    if (vrai === (b.etat.powered === 'true')) return;
    if (vrai) jouerNote(monde, ev.pos, b);
    monde.poser(x, y, z, avec(b, { powered: vrai ? 'true' : 'false' }), 3);
  });
  // NoteBlock.updateShape : l'instrument suit le bloc du dessous
  mc.bloc('NoteBlock').sur('forme', (ev, monde) => {
    if (ev.direction !== 'bas' && ev.direction !== 'haut') return undefined;
    const b = monde.bloc(...ev.pos), inst = instrumentSous(monde, ev.pos);
    return inst === b.etat.instrument ? undefined : avec(b, { instrument: inst });
  });

  // ---------------------------------------------------------------- lits (BedBlock) : pas de sommeil en P1
  mc.bloc('BedBlock').sur('utilise', (ev) => { ev.raison = 'dormir n\'est pas gere (P7)'; return 'passe'; });
  mc.bloc('BedBlock').sur('forme', (ev, monde) => {   // BedBlock.updateShape : une moitie sans l'autre disparait
    const b = monde.bloc(...ev.pos), dir = JEU[ev.direction];
    const voulue = b.etat.part === 'foot' ? b.etat.facing : { north: 'south', south: 'north', west: 'east', east: 'west' }[b.etat.facing];
    if (dir !== voulue) return undefined;
    const n = ev.voisin;
    const ok = n.startsWith(b.nom) && n.includes(`part=${b.etat.part === 'foot' ? 'head' : 'foot'}`);
    return ok ? undefined : 'minecraft:air';
  });
}

// instrument du bloc sous le bloc musical : lu des donnees (NoteBlockInstrument.byState)
export function instrumentSous(monde, pos) {
  const haut = monde.bloc(pos[0], pos[1] + 1, pos[2]).instrument ?? 'harp';
  if (MOB_HEAD.has(haut)) return haut;
  const bas = monde.bloc(pos[0], pos[1] - 1, pos[2]).instrument ?? 'harp';
  return MOB_HEAD.has(bas) ? 'harp' : bas;
}
void FR;
