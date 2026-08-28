// Preload for the settings window (CommonJS: sandboxed preloads are CJS).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quotabar', {
  settingsInitRequest: () => ipcRenderer.send('settings:init-request'),
  onInit: (callback) => ipcRenderer.on('settings:init', (_event, state) => callback(state)),
  setPoll: (minutes) => ipcRenderer.send('settings:set-poll', minutes),
  setSource: (id, enabled) => ipcRenderer.send('settings:set-source', id, enabled),
  setKey: (id, key) => ipcRenderer.send('settings:set-key', id, key),
  openConfig: () => ipcRenderer.send('settings:open-config'),
});
