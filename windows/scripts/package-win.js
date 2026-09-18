// Packages the Windows build: out/QuotaBar-win32-x64/QuotaBar.exe (+ a zip).
// Runs from any OS — @electron/packager downloads the prebuilt win32
// Electron binaries. The exe is rebranded with build/QuotaBar.ico (regenerated
// from docs/icon-1024.png first, native rcedit on Windows runners — no wine)
// and version metadata; on tags the VERSION env (vX.Y.Z) wins over
// package.json, mirroring scripts/make-app.sh on the macOS side.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { makeIco } from './make-ico.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = (process.env.VERSION ?? '').trim().replace(/^v/, '');
const version = tag !== '' ? tag : pkg.version;

const iconPath = makeIco();

const paths = await packager({
  dir: root,
  out: process.env.QUOTABAR_PACKAGE_OUT || path.join(root, 'out'),
  name: 'QuotaBar',
  platform: 'win32',
  arch: 'x64',
  overwrite: true,
  asar: true,
  prune: true,
  derefSymlinks: true,
  appVersion: version,
  icon: iconPath,
  appBundleId: 'app.quotabar.windows',
  win32metadata: {
    FileDescription: pkg.description,
    ProductName: 'QuotaBar',
    CompanyName: 'QuotaBar',
    LegalCopyright: 'MIT License',
    FileVersion: version,
    ProductVersion: version,
  },
  // .gitignore is not auto-applied by packager; keep the bundle clean.
  // The app itself has zero runtime npm deps, so node_modules stays out
  // entirely (main.js imports only Electron and Node built-ins).
  ignore: [
    /\/out\//,
    /\/node_modules\//,
    /\/build\//,
    /\/test(?:\/|$)/,
    /\/scripts(?:\/|$)/,
    /\.git$/u,
  ],
});

console.log(`Packaged: ${paths.join(', ')}`);
