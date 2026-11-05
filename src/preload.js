// Pont sécurisé entre l'interface et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = ['progress', 'game', 'update'];

contextBridge.exposeInMainWorld('launcher', {
  getState: () => ipcRenderer.invoke('state:get'),
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  play: (opts) => ipcRenderer.invoke('game:play', opts),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  openFolder: (which) => ipcRenderer.invoke('folder:open', which),
  getSkin: () => ipcRenderer.invoke('account:skin'),
  getPack: () => ipcRenderer.invoke('pack:info'),
  getServer: () => ipcRenderer.invoke('server:status'),
  quit: () => ipcRenderer.invoke('app:quit'),
  on: (channel, cb) => {
    if (EVENTS.includes(channel)) ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});
