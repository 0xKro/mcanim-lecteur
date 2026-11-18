// Famille "cadres" : cadres et cadres lumineux (ItemFrame, GlowItemFrame : entites accrochees a la face d'un bloc). Ecrite avec la MEME API que les mods.
// Port d'apres Horizon horizon-client/src/game/frames.rs (MIT, voir ATTRIBUTIONS.md) :
//   - un cadre est dans la cellule devant son support et regarde par sa face (champ de scene `monde.cadres` : [x, y, z, "face", "objet"|null,
//     rotation 0..7, "lueur"]) ;
//   - `utilise x y z` sur la cellule du cadre (ItemFrame.interact) : vide, l'objet tenu y entre (son entity.item_frame.add_item) ; plein, il tourne
//     d'un huitieme (rotation + 1 modulo 8, son entity.item_frame.rotate_item) ; le cadre lumineux a ses propres sons (glow_item_frame) ;
//   - `frappe` sur la cellule (commande `[t, "frappe", x, y, z, ...]` non : verbe d'acteur `casse x y z`) : l'objet tombe (remove_item),
//     un second coup casse le cadre (break, objet du cadre) ; le support retire ou une explosion : le cadre tombe avec son objet ;
//   - comparateur (ComparatorBlock.getItemFrame) : rotation % 8 + 1 avec un objet, 0 vide ; un changement previent les comparateurs
//     (updateNeighbourForOutputSignal).
const V = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
const DE_FR = { nord: 'north', sud: 'south', ouest: 'west', est: 'east', haut: 'up', bas: 'down' };

export function installer(mc, regles) {
  regles.declarer('cadres.actif', { def: true, doc: 'les cadres recoivent, tournent et lachent leur objet (jeu : oui)' });
  const cadres = new Map();   // 'x,y,z' -> { id, pos, face, objet, rotation, lueur, rec }
  const cle = (p) => p.join(',');
  const son = (monde, c, nom) => monde.son(`entity.${c.lueur ? 'glow_item_frame' : 'item_frame'}.${nom}`, c.pos[0] + 0.5, c.pos[1] + 0.5, c.pos[2] + 0.5, 1, 1);
  const noter = (monde, c) => { c.rec.d.push([monde.tick(), c.objet, c.rotation]); monde.contenuNotifie(...c.pos); };
  const support = (c) => { const v = V[OPP[c.face]]; return [c.pos[0] + v[0], c.pos[1] + v[1], c.pos[2] + v[2]]; };
  const tomber = (monde, c, avecCadre) => {
    const p = c.pos, v = V[c.face];
    if (c.objet) monde.lacher(c.objet, 1, p[0] + 0.5 + v[0] * 0.15, p[1] + 0.5 + v[1] * 0.15, p[2] + 0.5 + v[2] * 0.15, {});
    if (avecCadre) { monde.lacher(c.lueur ? 'glow_item_frame' : 'item_frame', 1, p[0] + 0.5 + v[0] * 0.15, p[1] + 0.5 + v[1] * 0.15, p[2] + 0.5 + v[2] * 0.15, {}); son(monde, c, 'break'); cadres.delete(cle(p)); c.rec.d.push([monde.tick(), null, -1]); monde.contenuNotifie(...p); }
    else if (c.objet) { son(monde, c, 'remove_item'); c.objet = null; c.rotation = 0; noter(monde, c); }
  };
  mc.monde.sur('debutTick', (ev, monde) => {
    if (ev.tick !== 0) return;
    for (const [x, y, z, face, objet, rotation, lueur] of monde.configCadres()) {
      const c = { pos: [x, y, z], face, objet: objet ? String(objet).replace(/^minecraft:/, '') : null, rotation: rotation ?? 0, lueur: lueur === 'lueur' };
      c.rec = monde.nouveauCadre(x, y, z, face, c.lueur);
      cadres.set(cle(c.pos), c);
      noter(monde, c);
    }
  });
  // HangingEntityItem.useOn : un acteur pose un cadre (objet item_frame / glow_item_frame) sur la face cliquee d'un bloc solide
  mc.monde.sur('objet.utilise', (ev, monde) => {
    if (ev.fait || !/^(glow_)?item_frame$/.test(ev.objet ?? '')) return;
    const v = V[ev.face], p = [ev.pos[0] + v[0], ev.pos[1] + v[1], ev.pos[2] + v[2]];
    if (cadres.has(cle(p)) || monde.bloc(...p).nom !== 'minecraft:air') return;
    if (!monde.appui(ev.pos[0], ev.pos[1], ev.pos[2], { north: 'nord', south: 'sud', west: 'ouest', east: 'est', up: 'haut', down: 'bas' }[ev.face], 'plein')) { ev.raison = 'pas de face solide pour le cadre'; return; }
    const c = { pos: p, face: ev.face, objet: null, rotation: 0, lueur: ev.objet === 'glow_item_frame' };
    c.rec = monde.nouveauCadre(p[0], p[1], p[2], ev.face, c.lueur);
    cadres.set(cle(p), c); noter(monde, c); son(monde, c, 'place');
    ev.fait = true; ev.consomme = true;
  });
  // ItemFrame.interact
  mc.monde.sur('cadre.utilise', (ev, monde) => {
    const c = cadres.get(cle(ev.pos));
    if (!c || !monde.regle('cadres.actif', true)) return;
    ev.fait = true;
    if (!c.objet) {
      const o = String(ev.objet ?? '').replace(/^minecraft:/, '');
      if (!o) return;
      c.objet = o; c.rotation = 0; son(monde, c, 'add_item'); ev.consomme = true;
    } else { c.rotation = (c.rotation + 1) % 8; son(monde, c, 'rotate_item'); }
    noter(monde, c);
  });
  // ItemFrame.hurtServer : l'objet tombe d'abord, le cadre ensuite
  mc.monde.sur('cadre.frappe', (ev, monde) => {
    const c = cadres.get(cle(ev.pos));
    if (!c) return;
    ev.fait = true;
    tomber(monde, c, !c.objet);
  });
  // HangingEntity.survives : le support doit rester solide (sinon le cadre tombe avec son objet)
  mc.monde.sur('finTick', (ev, monde) => {
    for (const c of [...cadres.values()]) {
      const s = support(c), b = monde.bloc(...s);
      if (b.id >= 0 && (b.nom === 'minecraft:air' || !monde.appui(s[0], s[1], s[2], { north: 'nord', south: 'sud', west: 'ouest', east: 'est', up: 'haut', down: 'bas' }[c.face], 'plein') && !/repeater|comparator/.test(b.nom))) tomber(monde, c, true);
    }
  });
  mc.monde.sur('apresExplosion', (ev, monde) => {
    for (const c of [...cadres.values()]) {
      const d = Math.hypot(c.pos[0] + 0.5 - ev.centre[0], c.pos[1] + 0.5 - ev.centre[1], c.pos[2] + 0.5 - ev.centre[2]);
      if (d <= ev.puissance * 2) tomber(monde, c, true);   // un souffle qui atteint le cadre le detruit (HangingEntity.hurtServer, degats d'explosion)
    }
  });
  mc.monde.sur('cadre.signal', (ev) => {
    const c = cadres.get(cle(ev.pos));
    if (c && c.face === DE_FR[ev.direction]) ev.valeur = c.objet ? c.rotation % 8 + 1 : 0;
  });
}
