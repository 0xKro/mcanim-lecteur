// Famille "herbe" (jouet de preuve, desactive par defaut) : l'herbe gagne du terrain par ticks aleatoires, comme
// SpreadingSnowyBlock.randomTick du jeu. Elle montre qu'une mecanique de bloc tient en quelques lignes avec l'API commune :
// ticks aleatoires seedes, lumiere, regles. Activer : "regles": {"herbe": {"actif": true}}.
export function installer(mc, regles) {
  regles.declarer('herbe.actif', { def: false, doc: 'l\'herbe se propage sur la terre voisine par ticks aleatoires (jouet)' });
  regles.declarer('herbe.lumiereMin', { def: 9, min: 0, max: 15, entier: true, doc: 'lumiere minimale au-dessus de l\'herbe pour qu\'elle se propage (jeu : 9)' });
  const opaque = (b) => b.nom !== 'minecraft:air' && !/short_grass|fern|torch|flower|snow$/.test(b.nom) && !/water|lava/.test(b.nom);
  mc.bloc('grass_block').sur('tickAleatoire', (ev, monde) => {
    if (!monde.regle('herbe.actif', false)) return;
    const [x, y, z] = ev.pos;
    const dessus = monde.bloc(x, y + 1, z);
    if (opaque(dessus) && !/leaves/.test(dessus.nom)) { monde.poser(x, y, z, 'minecraft:dirt'); return; }   // etouffee : redevient terre
    const l = monde.lumiere(x, y + 1, z);
    if (Math.max(l.bloc, l.ciel) < monde.regle('herbe.lumiereMin', 9)) return;
    for (let i = 0; i < 4; i++) {
      const tx = x + monde.hasard.entier(3) - 1, ty = y + monde.hasard.entier(5) - 3, tz = z + monde.hasard.entier(3) - 1;
      if (monde.bloc(tx, ty, tz).nom !== 'minecraft:dirt') continue;
      const h = monde.bloc(tx, ty + 1, tz);
      if (opaque(h) || /water/.test(h.nom)) continue;
      monde.poser(tx, ty, tz, 'minecraft:grass_block[snowy=false]');
    }
  });
}
