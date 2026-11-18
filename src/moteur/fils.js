// Processus fils de la simulation d'une scene AVEC mods (docs/SIMULATION.md 3.5, couche 2 ; partie 26). Lance par moteur/isolement.js avec le
// modele de permissions de Node : lecture du seul dossier du lecteur (son code), aucune ecriture, aucun processus fils, aucun worker, pas
// d'inspecteur, pas de module natif. Le reseau (que Node 24 ne coupe pas encore par permission) est ferme ici, AVANT de charger le moteur :
// les fonctions publiques qui ouvrent un socket, resolvent un nom ou lancent une requete sont remplacees par une erreur, et les liaisons
// internes (process.binding) sont deja refusees par le modele de permissions. Le mod lui-meme tourne en plus dans un contexte vm durci
// (moteur/mods.js, couche 1). Le fils recoit la scene par le canal IPC, rend le replay, et s'arrete.
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import { syncBuiltinESMExports } from 'node:module';

const RESEAU = 'reseau interdit pendant la simulation des mods';
const refus = (nom) => function interdit() { const e = new Error(`${nom} : ${RESEAU}`); e.code = 'ERR_ACCESS_DENIED'; throw e; };
function fermer(obj, noms, prefixe) {
  for (const n of noms) {
    if (!obj || !(n in obj)) continue;
    try { Object.defineProperty(obj, n, { value: refus(prefixe + n), writable: false, configurable: false, enumerable: true }); } catch { /* deja fige */ }
  }
}
export function fermerReseau() {
  fermer(net, ['connect', 'createConnection', 'createServer'], 'net.');
  fermer(net.Socket.prototype, ['connect'], 'net.Socket.');
  fermer(net.Server.prototype, ['listen'], 'net.Server.');
  fermer(tls, ['connect', 'createServer', 'createSecureContext'], 'tls.');
  fermer(dgram, ['createSocket'], 'dgram.');
  fermer(dgram.Socket.prototype, ['bind', 'send', 'connect'], 'dgram.Socket.');
  for (const o of [dns, dns.promises, dns.Resolver?.prototype, dns.promises?.Resolver?.prototype]) fermer(o, Object.getOwnPropertyNames(o ?? {}).filter((k) => /^(lookup|lookupService|resolve\w*|reverse)$/.test(k)), 'dns.');
  fermer(http, ['request', 'get', 'createServer'], 'http.');
  fermer(https, ['request', 'get', 'createServer'], 'https.');
  fermer(http2, ['connect', 'createServer', 'createSecureServer'], 'http2.');
  for (const g of ['fetch', 'WebSocket', 'EventSource', 'Request', 'Response', 'XMLHttpRequest']) { try { delete globalThis[g]; } catch { /* rien */ } }
  syncBuiltinESMExports();   // les exports nommes des modules du noyau (import { lookup } from 'node:dns') suivent les remplacements
}

const envoyer = (m) => new Promise((ok) => process.send(m, () => ok()));

async function traiter(m) {
  const { Zone } = await import('../rendu/zone.js');
  const { depuisOctets } = await import('./donnees.js');
  const moteur = await import('./index.js');
  const donnees = depuisOctets(Buffer.from(m.donnees));
  const z = m.zone;
  const zone = new Zone(z.hdr, z.cellules, z.biomes, z.hauteurs);
  const ctx = m.contexte || {};
  if (m.op === 'verifier') {   // mcanim mods verifier : chargement seul
    const sim = moteur.preparer({ zone, donnees, monde: {}, mods: m.mods, options: { hote: m.hote } });
    return { n: sim.reg.entrees.filter((e) => e.source !== 'moteur').length, definitions: sim.definitions };
  }
  const { optionsAvecContexte } = await import('./contexte.js');
  const options = await optionsAvecContexte(m.options, ctx);
  const { replayVersObjet } = await import('./replay.js');
  const r = moteur.simuler({ zone, donnees, monde: m.monde, mods: m.mods, acteurs: m.acteurs, duree: m.duree, options });
  return { replay: replayVersObjet(r.replay), rapport: r.rapport };
}

fermerReseau();
process.once('message', async (m) => {
  let sortie;
  try { sortie = { ok: true, ...(await traiter(m)) }; } catch (e) {
    sortie = { ok: false, monde: e?.name === 'ErreurMonde' || e?.constructor?.name === 'ErreurMonde', message: String(e?.message ?? e) };
  }
  await envoyer(sortie);
  process.exit(0);
});
