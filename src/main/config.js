// Réglages du launcher.
const pkg = require('../../package.json');

// Dépôt GitHub : mêmes valeurs que package.json > build.publish
// (cette partie de package.json est retirée de l'application installée, d'où la copie ici).
const GITHUB_OWNER = 'vgcommunautaire';
const GITHUB_REPO = 'radhes-launcher';

module.exports = {
  // Identifiant client (Application ID) de l'application Azure.
  AZURE_CLIENT_ID: '1611a195-ec9d-44c7-a7a3-8c65b4467ecf',

  // Emplacement du manifest des mods, publié par scripts/publish.js.
  // Remplace cette URL si tu héberges le manifest ailleurs (dossier synchronisé, site web...).
  MANIFEST_URL: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/mods/manifest.json`,

  // Dossier du jeu, dans %APPDATA%. Séparé du .minecraft officiel.
  GAME_DIR_NAME: '.radhes-launcher',

  LAUNCHER_NAME: 'radhes-launcher',
  USER_AGENT: `radhes-launcher/${pkg.version}`,
};
