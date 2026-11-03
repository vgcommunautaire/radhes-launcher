// Erreurs affichées telles quelles au joueur (message déjà en français).
class UserError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'UserError';
  }
}

class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} pour ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

const NETWORK_CODES = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'];

function isNetworkError(err) {
  const code = err?.cause?.code || err?.code;
  return (err instanceof TypeError && err.message === 'fetch failed') || NETWORK_CODES.includes(code);
}

// Transforme n'importe quelle erreur en message lisible pour le joueur.
function friendlyMessage(err) {
  if (err instanceof UserError) return err.message;
  if (isNetworkError(err)) {
    return 'Impossible de joindre le serveur. Vérifie ta connexion Internet puis réessaie.';
  }
  if (err instanceof HttpError) {
    let host = err.url;
    try { host = new URL(err.url).host; } catch {}
    if (err.status === 404) return `Fichier introuvable sur ${host} (erreur 404).`;
    if (err.status >= 500) return `Le serveur ${host} rencontre un problème (erreur ${err.status}). Réessaie plus tard.`;
    return `Le serveur ${host} a refusé la requête (erreur ${err.status}).`;
  }
  if (err?.code === 'ENOSPC') return 'Plus assez d\'espace disque.';
  if (err?.code === 'EPERM' || err?.code === 'EBUSY') {
    return 'Un fichier est verrouillé (le jeu est peut-être déjà ouvert, ou un antivirus le bloque).';
  }
  return `Erreur inattendue : ${err?.message || err}. Les détails sont dans le journal.`;
}

module.exports = { UserError, HttpError, isNetworkError, friendlyMessage };
