import { BrowserWindow, ipcMain, screen, nativeTheme } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));

export function openUsagePanel({ tray, getState, command }) {
  const bounds = tray.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(416, area.width);
  const height = Math.min(660, area.height - 16);
  const window = new BrowserWindow({
    width, height, frame: false, show: false, resizable: false, skipTaskbar: true,
    alwaysOnTop: true, title: 'QuotaBar', backgroundColor: nativeTheme.shouldUseDarkColors ? '#161c24' : '#f8fafc',
    webPreferences: { preload: path.join(directory, 'usagepreload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'quotabar-usage' },
  });
  const owned = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  const handler = async (event, request) => {
    if (!owned(event)) throw new Error('Unauthorized window');
    try {
      if (request?.action === 'init') return { state: getState() };
      if (request?.action === 'close') { window.close(); return {}; }
      return { state: await command(request) };
    } catch (error) { return { error: error.message }; }
  };
  ipcMain.handle('usage:command', handler);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.once('ready-to-show', () => {
    const x = Math.max(area.x, Math.min(bounds.x + bounds.width - width, area.x + area.width - width));
    const y = bounds.y >= area.y + area.height / 2 ? area.y + area.height - height - 8 : area.y + 8;
    window.setPosition(Math.round(x), Math.round(y));
    window.show();
    window.focus();
  });
  window.on('blur', () => window.close());
  window.on('closed', () => ipcMain.removeHandler('usage:command'));
  window.loadFile(path.join(directory, 'usage.html')).catch(() => window.destroy());
  return window;
}
