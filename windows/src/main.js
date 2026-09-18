// Windows entry point — port of main.swift's dispatch: the offline
// --parse* / --probe flags behave exactly like the Swift binary, everything
// else runs the tray app.

import { app } from 'electron';
import { runCli, runProbe } from './cli.js';
import { loadConfig } from './core/config.js';
import { QuotaBarApp } from './trayapp.js';

// runCli expects the program name at index 0. Electron dev runs also inject
// the app path at argv[1], while packaged builds start flags at argv[1].
const argv = ['quotabar', ...process.argv.slice(app.isPackaged ? 1 : 2)];
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
    openSettingsWindow({
      getConfig: () => trayApp.config,
      getSections: () => trayApp.sections,
      onApply: (config) => { trayApp.config = config; trayApp.rebuild('settings'); },
    });
  }
});

// Tray app: closing the (rare) windows must not quit the process.
app.on('window-all-closed', () => {});
