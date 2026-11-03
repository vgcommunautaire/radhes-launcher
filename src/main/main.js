const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const config = require('./config');
const log = require('./logger');
const store = require('./store');
const auth = require('./auth');
const minecraft = require('./minecraft');
const mods = require('./mods');
const dl = require('./download');
const { initUpdater } = require('./updater');
const { UserError, friendlyMessage } = require('./errors');

const gameRoot = () => path.join(app.getPath('appData'), config.GAME_DIR_NAME);

let win = null;
let busy = false; // installation en cours
let game = null; // processus du jeu

const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };
const progress = (p) => send('progress', p);

function createWindow() {
  win = new BrowserWindow({
    width: 960,
    height: 600,
    minWidth: 760,
    minHeight: 520,
    title: 'Radhes Launcher',
    backgroundColor: '#0b0707',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function account(session) {
  return session ? { name: session.profile.name, uuid: session.profile.id } : null;
}

// Les gestionnaires IPC renvoient { ok, ... } plutôt que de lever une erreur (messages plus propres).
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, ...(await fn(...args)) };
    } catch (err) {
      log.error(`[${channel}]`, err);
      return { ok: false, error: friendlyMessage(err) };
    }
  });
}

handle('state:get', async () => {
  let session = null;
  let warning = null;
  try {
    session = await auth.getFreshSession();
  } catch (err) {
    log.warn('Rafraîchissement de la session impossible :', err);
    session = err instanceof UserError ? null : store.loadSession(); // hors ligne : on garde la session
    warning = friendlyMessage(err);
  }
  return { version: app.getVersion(), account: account(session), settings: store.loadSettings(), playing: !!game, warning };
});

handle('auth:login', async () => ({ account: account(await auth.login(win)) }));

handle('auth:logout', async () => { auth.logout(); return {}; });

handle('settings:save', async (s) => ({ settings: store.saveSettings(s) }));

handle('folder:open', async (which) => {
  const target = which === 'logs' ? path.dirname(log.file) : which === 'mods' ? path.join(gameRoot(), 'mods') : gameRoot();
  require('fs').mkdirSync(target, { recursive: true });
  await shell.openPath(target);
  return {};
});

handle('game:play', async ({ deep = false } = {}) => {
  if (busy || game) throw new UserError('Le jeu est déjà en cours de lancement.');
  busy = true;
  try {
    const session = await auth.getFreshSession();
    if (!session) throw new UserError('Connecte-toi avec ton compte Microsoft avant de jouer.');

    progress({ label: 'Récupération de la liste des mods...', percent: null });
    const root = gameRoot();
    const manifest = await mods.loadManifest(config.MANIFEST_URL, root);
    if (manifest.launcherMinVersion && mods.compareVersions(app.getVersion(), manifest.launcherMinVersion) < 0) {
      throw new UserError(
        `Ton launcher est trop ancien (${app.getVersion()}). Version minimale : ${manifest.launcherMinVersion}. Ferme-le et rouvre-le pour qu'il se mette à jour.`,
      );
    }

    const inst = await minecraft.install({
      root,
      mcVersion: manifest.minecraftVersion,
      loaderVersion: manifest.loader.version,
      deep,
      onProgress: progress,
    });
    await mods.syncMods({ root, manifest, onProgress: progress, log });

    progress({ label: 'Lancement du jeu...', percent: 100 });
    const settings = store.loadSettings();
    game = minecraft.launch(inst, {
      session,
      ramMb: settings.ramMb,
      launcherName: config.LAUNCHER_NAME,
      launcherVersion: app.getVersion(),
      clientId: config.AZURE_CLIENT_ID,
    });
    log.info(`Lancement : ${inst.javaw} ${game.safeArgs.join(' ')}`);
    const startedAt = Date.now();

    game.on('error', (err) => {
      log.error('Le jeu n\'a pas pu démarrer :', err);
      game = null;
      send('game', { state: 'stopped', error: 'Java n\'a pas pu démarrer. Essaie « Vérifier les fichiers » dans les réglages.' });
    });
    game.on('exit', (code) => {
      log.info(`Le jeu s'est fermé (code ${code}).`);
      const logPath = game?.logPath;
      game = null;
      if (win && !win.isDestroyed()) win.restore();
      const crashed = code !== 0 && code !== null;
      send('game', {
        state: 'stopped',
        error: crashed
          ? `Le jeu s'est fermé avec une erreur (code ${code})${Date.now() - startedAt < 60000 ? ' juste après le démarrage' : ''}. Le journal du jeu est ici : ${logPath}`
          : null,
      });
    });
    send('game', { state: 'running' });
    setTimeout(() => { if (game && win && !win.isDestroyed()) win.minimize(); }, 5000);
    return {};
  } finally {
    busy = false;
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    log.init(path.join(app.getPath('userData'), 'logs'));
    log.info(`Radhes Launcher ${app.getVersion()} démarré`);
    dl.setUserAgent(config.USER_AGENT);
    createWindow();
    initUpdater((s) => send('update', s), () => busy || !!game);
  });

  app.on('window-all-closed', () => app.quit());
}
