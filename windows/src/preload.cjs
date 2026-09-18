// Preload for the settings window (CommonJS: sandboxed preloads are CJS).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quotabar', {
  settingsInitRequest: () => ipcRenderer.send('settings:init-request'),
  onInit: (callback) => ipcRenderer.on('settings:init', (_event, state) => callback(state)),
  setPoll: (minutes) => ipcRenderer.send('settings:set-poll', minutes),
  setSource: (id, enabled) => ipcRenderer.send('settings:set-source', id, enabled),
  setMain: (id) => ipcRenderer.send('settings:set-main', id),
  setKey: (id, key) => ipcRenderer.send('settings:set-key', id, key),
  clearKey: (id) => ipcRenderer.send('settings:clear-key', id),
  setLogin: (enabled) => ipcRenderer.send('settings:set-login', enabled),
  onLoginError: (callback) => ipcRenderer.on('settings:login-error', (_event, message) => callback(message)),
  openConfig: () => ipcRenderer.send('settings:open-config'),
  saveAdvanced: (settings) => ipcRenderer.invoke('settings:save-advanced', settings),
});
