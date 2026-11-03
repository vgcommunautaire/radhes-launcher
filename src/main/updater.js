// Mise à jour automatique du launcher via GitHub Releases.
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('./logger');

// send(état) informe l'interface ; isBusy() indique qu'un téléchargement ou le jeu est en cours.
function initUpdater(send, isBusy) {
  if (!app.isPackaged) {
    log.info('Mode développement : pas de vérification des mises à jour.');
    return;
  }
  autoUpdater.logger = { info: log.info, warn: log.warn, error: log.error, debug() {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => send({ state: 'none' }));
  autoUpdater.on('update-available', (info) => send({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: p.percent }));
  autoUpdater.on('error', (err) => {
    log.error('Mise à jour :', err);
    send({ state: 'error' });
  });
  autoUpdater.on('update-downloaded', (info) => {
    if (isBusy()) {
      // Le jeu tourne : la mise à jour s'installera à la fermeture du launcher.
      send({ state: 'ready-later', version: info.version });
      return;
    }
    send({ state: 'installing', version: info.version });
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 3000);
  });

  autoUpdater.checkForUpdates().catch((err) => log.error('Vérification des mises à jour :', err));
}

module.exports = { initUpdater };
