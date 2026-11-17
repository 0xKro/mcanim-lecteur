// Famille "musique" : le juke-box (JukeboxBlock, JukeboxSongPlayer du jeu). Clic avec un disque : il le prend (has_record=true), joue la musique
// du disque (son `music_disc.<nom>`, volume 4, a la demande dans le kit) pendant la duree du morceau, une note de musique au-dessus toutes les
// 20 ticks (JUKEBOX_PLAY : les perroquets a 3 blocs et les allays a 10 blocs dansent, moteur/ia-vie.js) ; clic sans disque : il rend le disque
// (objet au sol) et se tait. Ecrite avec la meme API que les mods ; duree des morceaux : JukeboxSong.lengthInSeconds du jeu.
import { avec } from './_aide.js';

export const DISQUES = { '13': 178, cat: 185, blocks: 345, chirp: 185, far: 174, mall: 197, mellohi: 96, stal: 150, strad: 188, ward: 251, '11': 71, wait: 238, pigstep: 149, otherside: 195, '5': 178, relic: 218, creator: 176, creator_music_box: 73, precipice: 299, tears: 175, lava_chicken: 135 };
export const disqueDe = (objet) => { const m = /^(?:minecraft:)?music_disc_(.+)$/.exec(String(objet ?? '')); return m && DISQUES[m[1]] ? m[1] : null; };

export function installer(mc, regles) {
  regles.declarer('jukebox.volume', { def: 4, min: 0, max: 16, doc: 'volume de la musique du juke-box (le jeu : 4, entendue a 64 blocs)' });
  const arreter = (monde, pos) => {
    const J = monde.jukeboxes(), k = pos.join(), j = J.get(k);
    if (!j) return;
    J.delete(k);
    monde.son('!stop', pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5, 0, j.idSon ?? 0);   // le mixage coupe la musique a cet instant (film/sons-monde.js)
    monde.evenement('jukebox.arret', { pos });
  };
  mc.bloc('jukebox').sur('utilise', (ev, monde) => {
    const [x, y, z] = ev.pos, b = monde.bloc(x, y, z);
    if (b.etat.has_record === 'true') {   // JukeboxBlockEntity.popOutTheItem : le disque saute au-dessus (0,7 x hasard + 0,15)
      const j = monde.jukeboxes().get(ev.pos.join());
      arreter(monde, ev.pos);
      monde.poser(x, y, z, avec(b, { has_record: 'false' }), 3);
      if (j) monde.lacher(`music_disc_${j.disque}`, 1, x + 0.5, y + 1.01, z + 0.5, { vy: 0.1 });
      return 'fait';
    }
    const disque = disqueDe(ev.objet);
    if (!disque) { ev.raison = 'il faut un disque en main (par exemple "music_disc_cat")'; return 'passe'; }
    monde.poser(x, y, z, avec(b, { has_record: 'true' }), 3);
    const t = monde.tick();
    monde.jukeboxes().set(ev.pos.join(), { pos: ev.pos.slice(), disque, debut: t, fin: t + DISQUES[disque] * 20, depuis: 0 });
    monde.son(`music_disc.${disque}`, x + 0.5, y + 0.5, z + 0.5, monde.regle('jukebox.volume', 4), 1);
    monde.evenement('jukebox.joue', { pos: ev.pos.slice(), disque });
    ev.nouvelObjet = null;   // le disque quitte la main
    return 'fait';
  });
  // JukeboxSongPlayer.tick : une note toutes les 20 ticks (couleur nextInt(4) / 24), fin du morceau ; juke-box casse : silence
  mc.monde.sur('tickBlocsEntites', (ev, monde) => {
    const J = monde.jukeboxes();
    if (!J.size) return;
    for (const j of [...J.values()]) {
      const [x, y, z] = j.pos, b = monde.bloc(x, y, z);
      if (b.nom !== 'minecraft:jukebox') { arreter(monde, j.pos); continue; }
      if (monde.tick() >= j.fin) { arreter(monde, j.pos); continue; }
      if ((monde.tick() - j.debut) % 20 === 0) monde.particule('note', x + 0.5, y + 1.2, z + 0.5, monde.hasard.entier(4) / 24, 0, 0, 1);
    }
  });
}
