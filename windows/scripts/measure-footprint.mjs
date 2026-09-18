// Run with Electron. Isolated synthetic data; no live credentials or networking.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const home = process.env.QUOTABAR_MEASURE_HOME;
if (!home || !path.isAbsolute(home)) throw new Error('Set QUOTABAR_MEASURE_HOME to an isolated absolute directory');
os.homedir = () => home;
process.env.APPDATA = home;
process.env.LOCALAPPDATA = home;
for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'OPENROUTER_API_KEY', 'QUOTABAR_ZAI_TOKEN']) delete process.env[key];
app.setPath('userData', path.join(home, 'electron'));
BrowserWindow.prototype.show = () => {};
BrowserWindow.prototype.focus = () => {};
app.on('window-all-closed', () => {});
globalThis.fetch = async () => { throw new Error('Unexpected external request'); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function snapshot() {
  const metrics = app.getAppMetrics();
  return {
    processes: metrics.length, renderers: metrics.filter(m => m.type === 'Tab').length,
    privateMiB: metrics.reduce((sum, m) => sum + (m.memory.privateBytes ?? 0), 0) / 1024,
    workingSetMiB: metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024,
  };
}
async function main() {
  await app.whenReady();
  const moduleURL = process.env.QUOTABAR_MEASURE_ENTRY ? pathToFileURL(process.env.QUOTABAR_MEASURE_ENTRY).href : new URL('../src/trayapp.js', import.meta.url).href;
  const { QuotaBarApp } = await import(moduleURL);
  const controller = new QuotaBarApp({ demoMode: true });
  controller.start();
  await wait(2000);
  await wait(5000);
  const idle = snapshot();
  const began = performance.now();
  if (controller.openPanel) controller.openPanel(); else controller.openSettings();
  const window = BrowserWindow.getAllWindows()[0];
  await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  const openMs = performance.now() - began;
  await wait(1000);
  const opened = snapshot();
  for (const window of BrowserWindow.getAllWindows()) window.close();
  await wait(1000);
  await wait(5000);
  const settled = snapshot();
  const result = {
    electron: process.versions.electron, windows: os.release(), logicalProcessors: os.cpus().length,
    mode: 'Synthetic; hidden panel; 5-second idle samples; not a live polling benchmark',
    idle, openMs, opened, closed: settled,
};
fs.writeFileSync(path.join(home, 'result.json'), JSON.stringify(result, null, 2));
controller.tray.destroy();
app.exit(0);
}
main().catch(error => { console.error(error); app.exit(1); });
