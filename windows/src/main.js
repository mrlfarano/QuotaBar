// Windows entry point — port of main.swift's dispatch: the offline
// --parse* / --probe flags behave exactly like the Swift binary, everything
// else runs the tray app.

import { app } from 'electron';
import { runCli, runProbe } from './cli.js';
import { loadConfig } from './core/config.js';
import { QuotaBarApp } from './trayapp.js';

// Electron dev runs inject the app path ('.') as argv[1]; packaged builds
// don't. Strip it so flag parsing matches the Swift binary's.
const argv = process.argv.slice(1).filter((arg, index) => !(index === 0 && arg === '.'));
const demoMode = argv.includes('--demo');

// Offline parser checks never touch the GUI.
const cliCode = runCli(argv);
if (cliCode !== null) {
  process.exit(cliCode);
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.hide(); // menu-bar only, no Dock icon (dev runs on macOS)

  if (argv.includes('--probe')) {
    const code = await runProbe(argv, process, loadConfig());
    process.exit(code);
  }

  new QuotaBarApp({ demoMode }).start();
  if (argv.includes('--settings')) {
    // Dev/verification flag: pop the Settings window without touching the tray.
    const { openSettingsWindow } = await import('./settingswindow.js');
    const trayApp = app.quotabarInstance;
    openSettingsWindow({ getConfig: () => trayApp.config, onApply: (config) => { trayApp.config = config; trayApp.rebuild('settings'); } });
  }
});

// Tray app: closing the (rare) windows must not quit the process.
app.on('window-all-closed', () => {});
