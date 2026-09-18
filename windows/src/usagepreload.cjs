const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('usage', {
  command: request => ipcRenderer.invoke('usage:command', request),
  onState: callback => ipcRenderer.on('usage:state', (_event, state) => callback(state)),
});
