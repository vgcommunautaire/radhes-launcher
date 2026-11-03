// Stockage local : session chiffrée (safeStorage = DPAPI sous Windows) et réglages.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { UserError } = require('./errors');

const file = (name) => path.join(app.getPath('userData'), name);

function saveSession(data) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new UserError('Le chiffrement Windows n\'est pas disponible : impossible d\'enregistrer la session en sécurité.');
  }
  fs.writeFileSync(file('session.bin'), safeStorage.encryptString(JSON.stringify(data)));
}

function loadSession() {
  try {
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file('session.bin'))));
  } catch {
    return null;
  }
}

function clearSession() {
  fs.rmSync(file('session.bin'), { force: true });
}

function defaultSettings() {
  const totalMb = Math.floor(os.totalmem() / 1024 / 1024);
  return { ramMb: Math.min(4096, Math.max(2048, Math.floor(totalMb / 2 / 1024) * 1024)) };
}

function loadSettings() {
  try {
    return { ...defaultSettings(), ...JSON.parse(fs.readFileSync(file('settings.json'), 'utf8')) };
  } catch {
    return defaultSettings();
  }
}

function saveSettings(settings) {
  const clean = { ramMb: Math.max(1024, Math.min(65536, parseInt(settings.ramMb, 10) || defaultSettings().ramMb)) };
  fs.writeFileSync(file('settings.json'), JSON.stringify(clean, null, 2));
  return clean;
}

module.exports = { saveSession, loadSession, clearSession, loadSettings, saveSettings };
