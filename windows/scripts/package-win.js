// Packages the Windows build: out/QuotaBar-win32-x64/QuotaBar.exe (+ a zip).
// Runs fine from macOS/Linux — @electron/packager downloads the prebuilt
// win32 Electron binaries; no Windows machine or wine needed. The exe keeps
// the default Electron icon (rebranding via rcedit requires wine); the tray
// glyph itself is generated at runtime.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const paths = await packager({
  dir: root,
  out: path.join(root, 'out'),
  name: 'QuotaBar',
  platform: 'win32',
  arch: 'x64',
  overwrite: true,
  asar: true,
  prune: true,
  derefSymlinks: true,
  // .gitignore is not auto-applied by packager; keep the bundle clean.
  // The app itself has zero runtime npm deps, so node_modules stays out
  // entirely (main.js imports only Electron and Node built-ins).
  ignore: [
    /\/out\//,
    /\/node_modules\//,
    /\.git$/u,
  ],
});

console.log(`Packaged: ${paths.join(', ')}`);
