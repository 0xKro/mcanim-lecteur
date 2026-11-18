// Famille "contenus" : entonnoir, dropper, distributeur (et le contenu des coffres et tonneaux pour le comparateur). Ecrite avec la MEME API que les mods.
// Port, en plus court, de HopperBlock / HopperBlockEntity, DispenserBlock / DropperBlock (Horizon client/game/{machines,dispenser}.rs : MIT, voir ATTRIBUTIONS.md).
//   - Entonnoir : 8 ticks entre deux transferts ; il pousse UN objet dans le conteneur vers lequel il regarde, puis aspire un objet du conteneur au-dessus
//     (ou les objets au sol au-dessus) ; un signal le coupe (`enabled`).
//   - Dropper : un signal programme un tick dans 4 ticks ; il lance UN objet au hasard (ou le met dans le conteneur devant lui).
//   - Distributeur : pareil ; en plus, un seau d'eau ou de lave pose le fluide devant lui, un seau vide reprend une source. Fleches, boules de neige, oeufs...
//     (projectiles) : NON geres, l'objet est lache comme un dropper le ferait (reglable : contenus.projectiles).
// Pas gere : four, alambic, double coffre (chaque moitie a ses 27 emplacements), enchantements, durabilite, tri par face de bloc.
import { FR, JEU } from './_aide.js';
import { pileMax } from '../contenus.js';

const V = { bas: [0, -1, 0], haut: [0, 1, 0], nord: [0, 0, -1], sud: [0, 0, 1], ouest: [-1, 0, 0], est: [1, 0, 0] };
const OPP = { bas: 'haut', haut: 'bas', nord: 'sud', sud: 'nord', ouest: 'est', est: 'ouest' };
const rel = (p, f, n = 1) => [p[0] + V[f][0] * n, p[1] + V[f][1] * n, p[2] + V[f][2] * n];

export function installer(mc, regles) {
  regles.declarer('contenus.delaiEntonnoir', { def: 8, min: 1, max: 200, entier: true, doc: 'ticks entre deux transferts d\'un entonnoir (jeu : 8)' });
  regles.declarer('contenus.delaiDistributeur', { def: 4, min: 1, max: 200, entier: true, doc: 'ticks entre le signal et le tir d\'un dropper ou distributeur (jeu : 4)' });
  regles.declarer('contenus.projectiles', { def: 'tire', choix: ['tire', 'lache', 'garde'], doc: 'distributeur : "tire" lance fleches, boules de neige, oeufs, potions, fusees, charges de feu et de vent comme le jeu (ProjectileDispenseBehavior) ; "lache" les depose comme un dropper ; "garde" ne fait rien' });

  const entonnoirs = new Map();                      // 'x,y,z' -> ticks de pause restants
  const cle = (p) => p.join(',');
  const dirDe = (monde, p) => FR[monde.prop(p[0], p[1], p[2], 'facing')];
  const set = (monde, p, modifs, flags) => monde.poser(p[0], p[1], p[2], monde.etatAvec(p[0], p[1], p[2], modifs), flags);
  const notifie = (monde, p) => { monde.contenuNotifie(p[0], p[1], p[2]); };

  // ------------------------------------------------------------ conteneurs : ce qu'on lache quand le bloc est retire
  // BlockEntity.preRemoveSideEffects -> Containers.dropContents : chaque case (vide comprise) tire sa place dans le bloc (3 nextDouble), puis
  // la pile part en morceaux de 10 a 30 (nextInt(21) + 10) avec la vitesse triangle(0 ; 0,11485), triangle(0,2 ; 0,11485), triangle(0 ; 0,11485)
  // (Horizon horizon-world level/removal.rs drop_item_stack). Casse a la main, par un piston ou par une explosion : le meme chemin.
  // La boite de shulker ne se vide pas : son objet garde son contenu (composant `container` du jeu ; champ `contenu` de l'objet au sol).
  const tri = (monde, a, b) => a + b * (monde.hasard.reel() - monde.hasard.reel());
  for (const classe of ['ChestBlock', 'BarrelBlock', 'HopperBlock', 'DispenserBlock', 'AbstractFurnaceBlock', 'ShulkerBoxBlock']) {
    mc.bloc(classe).sur('retire', (ev, monde) => {
      if (ev.nouveau.startsWith('minecraft:' + ev.bloc)) return;
      const [x, y, z] = ev.pos;
      entonnoirs.delete(cle(ev.pos));
      const cases = monde.contenuViderCases(x, y, z);
      if (classe === 'ShulkerBoxBlock') { monde.contenuAttacher(x, y, z, ev.bloc, cases.filter(Boolean)); return; }
      for (const e of cases) {
        const px = x + monde.hasard.reel() * 0.75 + 0.125, py = y + monde.hasard.reel() * 0.75, pz = z + monde.hasard.reel() * 0.75 + 0.125;
        let reste = e ? e.n : 0;
        while (reste > 0) {
          const k = Math.min(reste, monde.hasard.entier(21) + 10);
          reste -= k;
          const v = [tri(monde, 0, 0.11485000171139836), tri(monde, 0.2, 0.11485000171139836), tri(monde, 0, 0.11485000171139836)];
          monde.lacher(e.item, k, px, py, pz, { vx: v[0], vy: v[1], vz: v[2], delai: 10 });
        }
      }
    });
  }

  // ------------------------------------------------------------ composteur (ComposterBlock.onPlace / tick : le niveau 7 devient 8, « pret », 20 ticks plus tard)
  // Ecart trouve par la trace tick a tick de Horizon (test/trace-horizon.test.js).
  mc.bloc('composter').sur('pose', (ev, monde) => { if (monde.prop(...ev.pos, 'level') === '7') monde.planifier(...ev.pos, 20); });
  mc.bloc('composter').sur('tick', (ev, monde) => {
    if (monde.prop(...ev.pos, 'level') !== '7') return;
    set(monde, ev.pos, { level: '8' }, 3);
    monde.son('block.composter.ready', ev.pos[0] + 0.5, ev.pos[1] + 0.5, ev.pos[2] + 0.5, 1, 1);
  });

  // ------------------------------------------------------------ entonnoir
  mc.bloc('HopperBlock').sur('pose', (ev, monde) => {
    entonnoirs.set(cle(ev.pos), 0);
    if (!ev.memeBloc) set(monde, ev.pos, { enabled: String(!monde.aSignalVoisin(...ev.pos)) }, 2);
  });
  mc.bloc('HopperBlock').sur('voisin', (ev, monde) => {
    const actif = !monde.aSignalVoisin(...ev.pos);
    if (actif !== (monde.prop(...ev.pos, 'enabled') === 'true')) set(monde, ev.pos, { enabled: String(actif) }, 2);
  });
  // ajoute 1 objet de la case (conteneur source) dans un conteneur ; rend vrai si tout est entre
  const pousser1 = (monde, depuis, i, vers) => {
    const liste = monde.contenuListe(...depuis), e = liste[i];
    if (!e) return false;
    if (monde.contenuAjouter(vers[0], vers[1], vers[2], e.item, 1) !== 0) return false;
    monde.contenuRetirer(depuis[0], depuis[1], depuis[2], i, 1);
    return true;
  };
  function tickEntonnoir(monde, p) {
    const k = cle(p);
    let c = (entonnoirs.get(k) ?? 0) - 1;
    entonnoirs.set(k, c);
    if (c > 0 || monde.prop(...p, 'enabled') !== 'true') return;
    let fait = false;
    const dir = dirDe(monde, p);
    // 1. pousser un objet vers le conteneur devant
    if (!monde.contenuVide(...p)) {
      const d = rel(p, dir);
      if (monde.contenuTaille(...d) && !monde.contenuPlein(...d)) {
        const liste = monde.contenuListe(...p);
        for (let i = 0; i < liste.length && !fait; i++) if (liste[i] && pousser1(monde, p, i, d)) { fait = true; if (entonnoirs.has(cle(d))) entonnoirs.set(cle(d), Math.max(entonnoirs.get(cle(d)), monde.regle('contenus.delaiEntonnoir', 8))); notifie(monde, d); notifie(monde, p); }
      } else if (!monde.contenuTaille(...d)) {   // HopperBlockEntity.getEntityContainer : un wagonnet a coffre ou a entonnoir dans la cellule devant
        const w = monde.wagonCases(...d), liste = monde.contenuListe(...p);
        if (w) for (let i = 0; i < liste.length && !fait; i++) if (liste[i] && w.ajouter(liste[i].item, 1) === 0) { monde.contenuRetirer(p[0], p[1], p[2], i, 1); fait = true; notifie(monde, p); }
      }
    }
    // 2. aspirer : un objet du conteneur au-dessus, sinon les objets au sol au-dessus
    if (!monde.contenuPlein(...p)) {
      const h = rel(p, 'haut');
      if (monde.contenuTaille(...h)) {
        if (!monde.contenuVide(...h)) {
          const liste = monde.contenuListe(...h);
          for (let i = 0; i < liste.length; i++) if (liste[i] && pousser1(monde, h, i, p)) { fait = true; notifie(monde, h); notifie(monde, p); break; }
        }
      } else if (monde.wagonCases(...h)) {   // un wagonnet a conteneur au-dessus : un objet de ses cases
        const w = monde.wagonCases(...h);
        for (let i = 0; i < w.cases.length; i++) if (w.cases[i] && monde.contenuAjouter(p[0], p[1], p[2], w.cases[i].item, 1) === 0) { w.retirer(i); fait = true; notifie(monde, p); break; }
      } else {
        const pris = monde.prendreObjets([p[0], p[1] + 11 / 16, p[2], p[0] + 1, p[1] + 2, p[2] + 1], (e) => monde.contenuAjouter(p[0], p[1], p[2], e.item, e.n));
        if (pris) { fait = true; notifie(monde, p); }
      }
    }
    if (fait) entonnoirs.set(k, monde.regle('contenus.delaiEntonnoir', 8));
    else entonnoirs.set(k, 0);
  }
  mc.monde.sur('tickBlocsEntites', (ev, monde) => {
    for (const k of [...entonnoirs.keys()]) {
      const p = k.split(',').map(Number);
      if (monde.nom(...p) !== 'hopper') { entonnoirs.delete(k); continue; }
      tickEntonnoir(monde, p);
    }
  });
  mc.monde.sur('debutTick', (ev, monde) => { if (ev.tick === 0) for (const p of monde.entonnoirsInitiaux()) if (!entonnoirs.has(cle(p))) entonnoirs.set(cle(p), 0); });

  // ------------------------------------------------------------ dropper et distributeur
  mc.bloc('DispenserBlock').sur('voisin', (ev, monde) => {
    const [x, y, z] = ev.pos, signal = monde.aSignalVoisin(x, y, z) || monde.aSignalVoisin(x, y + 1, z), declenche = monde.prop(x, y, z, 'triggered') === 'true';
    if (signal && !declenche) { monde.planifier(x, y, z, monde.regle('contenus.delaiDistributeur', 4)); set(monde, ev.pos, { triggered: 'true' }, 2); }
    else if (!signal && declenche) set(monde, ev.pos, { triggered: 'false' }, 2);
  });
  mc.bloc('DispenserBlock').sur('tick', (ev, monde) => {
    const p = ev.pos, liste = monde.contenuListe(...p);
    // case au hasard parmi les cases pleines (getRandomSlot : tirage a reservoir)
    let slot = -1, n = 0;
    for (let i = 0; i < liste.length; i++) if (liste[i] && monde.hasard.entier(++n) === 0) slot = i;
    const dir = dirDe(monde, p);
    if (slot < 0) { monde.son('block.dispenser.fail', p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 1, 1.2); return; }
    const item = liste[slot].item, devant = rel(p, dir), dropper = monde.nom(...p) === 'dropper';
    let fait = false;
    if (dropper && monde.contenuTaille(...devant)) {                       // dropper devant un conteneur : il y met l'objet
      if (pousser1(monde, p, slot, devant)) { fait = true; notifie(monde, devant); }
      else { monde.son('block.dispenser.fail', p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 1, 1.2); return; }
    } else if (!dropper && /^(water_bucket|lava_bucket)$/.test(item)) {      // distributeur : seau plein
      if (monde.fiche(...devant).air || monde.remplacable(...devant)) {
        monde.poser(devant[0], devant[1], devant[2], item === 'water_bucket' ? 'minecraft:water[level=0]' : 'minecraft:lava[level=0]', 3);
        monde.son(item === 'water_bucket' ? 'item.bucket.empty' : 'item.bucket.empty_lava', devant[0] + 0.5, devant[1] + 0.5, devant[2] + 0.5, 1, 1);
        monde.contenuRetirer(p[0], p[1], p[2], slot, 1); monde.contenuAjouter(p[0], p[1], p[2], 'bucket', 1); fait = true; notifie(monde, p);
      } else { monde.son('block.dispenser.fail', p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 1, 1.2); return; }
    } else if (!dropper && item === 'bucket') {                                // seau vide : reprend une source
      const f = monde.fluide(...devant);
      if (f.type && f.source) {
        monde.poser(devant[0], devant[1], devant[2], 'minecraft:air', 3);
        monde.son(f.type === 'water' ? 'item.bucket.fill' : 'item.bucket.fill_lava', devant[0] + 0.5, devant[1] + 0.5, devant[2] + 0.5, 1, 1);
        monde.contenuRetirer(p[0], p[1], p[2], slot, 1); monde.contenuAjouter(p[0], p[1], p[2], f.type === 'water' ? 'water_bucket' : 'lava_bucket', 1); fait = true; notifie(monde, p);
      } else { monde.son('block.dispenser.fail', p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 1, 1.2); return; }
    } else {
      if (!dropper && /^(arrow|spectral_arrow|tipped_arrow|snowball|egg|ender_pearl|fire_charge|wind_charge|splash_potion|lingering_potion|experience_bottle|firework_rocket|trident)$/.test(item) && monde.regle('contenus.projectiles', 'lache') === 'garde') {
        monde.son('block.dispenser.fail', p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 1, 1.2); return;
      }
      // ProjectileDispenseBehavior (Horizon game/dispenser.rs dispense_projectile) : position, imprecision, puissance et son de chaque objet ;
      // vitesse = (direction + triangle(0 ; 0,0172275 x imprecision)) x puissance
      const TIRS = { arrow: ['fleche', 0.7, 6, 1.1], tipped_arrow: ['fleche', 0.7, 6, 1.1], spectral_arrow: ['fleche', 0.7, 6, 1.1], snowball: ['boule', 0.7, 6, 1.1], egg: ['oeuf', 0.7, 6, 1.1], splash_potion: ['potion', 0.7, 3, 1.375], lingering_potion: ['potion', 0.7, 3, 1.375], experience_bottle: ['fiole', 0.7, 3, 1.375], firework_rocket: ['fusee', 0.5000099999997474, 1, 0.5], fire_charge: ['petite_boule_feu', 1, 6.6666665, 1], wind_charge: ['vent', 1, 6.6666665, 1] };
      const tir = !dropper && monde.regle('contenus.projectiles', 'tire') === 'tire' ? TIRS[item] : null;
      if (tir) {
        const [type, k, u, puiss] = tir, v = V[dir], haut = k === 0.7 ? 0.1 : 0;
        const pos = [p[0] + 0.5 + v[0] * k, p[1] + 0.5 + v[1] * k + haut, p[2] + 0.5 + v[2] * k];
        const tri = () => (monde.hasard.flottant() - monde.hasard.flottant()) * 0.0172275 * u;
        monde.contenuRetirer(p[0], p[1], p[2], slot, 1);
        if (type === 'fusee') {   // la fusee tire d'abord ses propres tirages (vitesse, duree), puis le tir de biais
          const id = monde.fusee(pos, liste[slot]?.fusee ?? null, { vitesse: [0, 0, 0] });
          monde.orienterProjectile(id, [(v[0] + tri()) * puiss, (v[1] + tri()) * puiss, (v[2] + tri()) * puiss]);
          monde.son('entity.firework_rocket.shoot', p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 1, 1.2);
        } else {
          if (type === 'petite_boule_feu' || type === 'vent') { tri(); tri(); tri(); }   // asProjectile vise d'abord avec le hasard du monde (0,11485), remplace ensuite
          monde.projectile(type, pos, [(v[0] + tri()) * puiss, (v[1] + tri()) * puiss, (v[2] + tri()) * puiss]);
          const r = monde.hasard.flottant() - monde.hasard.flottant();
          if (type === 'petite_boule_feu') monde.son('entity.blaze.shoot', p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 2, r * 0.2 + 1);
          else if (type === 'vent') monde.son('entity.wind_charge.throw', p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 0.5, 0.4 / (monde.hasard.flottant() * 0.4 + 0.8));
          else monde.son('block.dispenser.launch', p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 1, 1.2);
        }
        notifie(monde, p);
        monde.particule('smoke', p[0] + 0.5 + v[0] * 0.6, p[1] + 0.5 + v[1] * 0.6, p[2] + 0.5 + v[2] * 0.6, 0, 0, 0, 10);
        return;
      }
      // DefaultDispenseItemBehavior : l'objet part devant, a 0,7 bloc, avec une vitesse au hasard
      const v = V[dir], g = monde.hasard.reel() * 0.1 + 0.2, alea = () => (monde.hasard.reel() + monde.hasard.reel() - 1) * 0.0172275 * 6;
      const ox = p[0] + 0.5 + v[0] * 0.7, oy = p[1] + 0.5 + v[1] * 0.7 - (v[1] !== 0 ? 0.125 : 0.15625), oz = p[2] + 0.5 + v[2] * 0.7;
      monde.contenuRetirer(p[0], p[1], p[2], slot, 1);
      monde.lacher(item, 1, ox, oy, oz, { vx: v[0] * g + alea(), vy: 0.2 + alea(), vz: v[2] * g + alea(), delai: 10 });
      fait = true; notifie(monde, p);
    }
    if (fait) {
      monde.son('block.dispenser.dispense', p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 1, 1);
      monde.particule('smoke', p[0] + 0.5 + V[dir][0] * 0.6, p[1] + 0.5 + V[dir][1] * 0.6, p[2] + 0.5 + V[dir][2] * 0.6, 0, 0, 0, 10);
    }
  });
  void JEU; void OPP; void pileMax;
}
