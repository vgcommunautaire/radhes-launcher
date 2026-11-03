// Réglages du launcher. Le seul champ à remplir obligatoirement est AZURE_CLIENT_ID.
// Le dépôt GitHub (propriétaire/nom) est lu dans package.json > build.publish.
const pkg = require('../../package.json');

const repo = pkg.build.publish[0];

module.exports = {
  // Identifiant client (Application ID) de l'application Azure.
  AZURE_CLIENT_ID: '00000000-0000-0000-0000-000000000000',

  // Emplacement du manifest des mods, publié par scripts/publish.js.
  // Remplace cette URL si tu héberges le manifest ailleurs (dossier synchronisé, site web...).
  MANIFEST_URL: `https://github.com/${repo.owner}/${repo.repo}/releases/download/mods/manifest.json`,

  // Dossier du jeu, dans %APPDATA%. Séparé du .minecraft officiel.
  GAME_DIR_NAME: '.radhes-launcher',

  LAUNCHER_NAME: 'radhes-launcher',
  USER_AGENT: `radhes-launcher/${pkg.version}`,
};
