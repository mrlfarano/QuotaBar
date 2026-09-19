import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = (process.env.VERSION || JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version).replace(/^(windows-)?v/, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable numeric version');
const output = path.resolve(process.env.QUOTABAR_PACKAGE_OUT || path.join(root, 'out'));
const source = path.join(output, 'QuotaBar-win32-x64');
if (!fs.existsSync(path.join(source, 'QuotaBar.exe'))) throw new Error('Run npm run package:win first');
const compiler = [process.env.ISCC_PATH,
  path.join(process.env.LOCALAPPDATA || '', 'Programs/Inno Setup 6/ISCC.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Inno Setup 6/ISCC.exe'),
  path.join(process.env.ProgramFiles || '', 'Inno Setup 6/ISCC.exe'),
].find(file => file && fs.existsSync(file));
if (!compiler) throw new Error('Install Inno Setup 6, or set ISCC_PATH to ISCC.exe');
const installerOutput = path.resolve(process.env.QUOTABAR_INSTALLER_OUT || output);
const args = ['/Qp', `/DAppVersion=${version}`, `/DSourceDir=${source}`, `/DOutputDir=${installerOutput}`, `/DIconFile=${path.join(root, 'build/QuotaBar.ico')}`];
// Test builds use isolated Windows registration and shortcuts.
if (process.env.QUOTABAR_INSTALLER_TEST_ID) {
  const id = process.env.QUOTABAR_INSTALLER_TEST_ID;
  if (!/^QuotaBarInstallerTest-[a-z0-9-]+$/i.test(id)) throw new Error('Invalid installer test ID');
  args.push(`/DAppId=${id}`, `/DAppName=${id}`);
}
args.push(path.join(root, 'scripts/installer.iss'));
const result = spawnSync(compiler, args, { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
