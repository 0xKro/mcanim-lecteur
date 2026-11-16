// Erreur du moteur : le message est une seule ligne de francais, deja lisible par l'utilisateur.
export class ErreurMonde extends Error {
  constructor(message, details = null) { super(message); this.name = 'ErreurMonde'; this.details = details; }
}
