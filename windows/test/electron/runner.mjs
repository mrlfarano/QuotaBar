// Real Electron/Chromium, native tray/menu, and preload IPC. No real credentials,
// external requests, clipboard writes, login-item writes, or visible windows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, nativeImage, shell } from 'electron';
import { QuotaBarApp } from '../../src/trayapp.js';
import { openSettingsWindow } from '../../src/settingswindow.js';
import { defaultConfig, saveConfig, loadConfig, cacheFileURL } from '../../src/core/config.js';

const home = process.env.QUOTABAR_TEST_HOME;
assert.ok(home && path.basename(home).startsWith('quotabar-electron-test-'));
os.homedir = () => home;
app.setPath('userData', path.join(home, 'electron'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
BrowserWindow.prototype.show = () => {};
BrowserWindow.prototype.focus = () => {};
let login = false;
const loginWrites = [];
app.getLoginItemSettings = () => ({ openAtLogin: login });
app.setLoginItemSettings = (value) => { login = value.openAtLogin; loginWrites.push(value); };
const opened = [];
shell.openPath = async (file) => { opened.push(file); return ''; };
globalThis.fetch = async () => { throw new Error('Unexpected network request in Electron test'); };

const results = [];
async function check(name, fn) {
  process.stdout.write(`Checking: ${name}\n`);
  try { await fn(); results.push({ name }); }
  catch (error) { results.push({ name, error: error.stack }); }
}
async function until(predicate) {
  const end = Date.now() + 4000;
  while (!await predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for UI state');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

let controller;
let settings;
const intervals = [];
const originalInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => { const timer = originalInterval(...args); intervals.push(timer); return timer; };
async function main() {
  try {
    await app.whenReady();
    saveConfig({ ...defaultConfig(), zaiToken: 'REDACTED-original-key' });
    controller = new QuotaBarApp({ demoMode: true });
    await check('demo starts a native tray and menu without external requests', async () => {
      controller.start();
      assert.equal(controller.tray.isDestroyed(), false);
      assert.deepEqual(controller.sections.map((s) => s.id), ['zai', 'github']);
      assert.equal(fs.existsSync(cacheFileURL()), false, 'Demo must not overwrite real cache');
      const menu = controller.buildMenu();
      assert.ok(menu.items.find((item) => item.label === 'Refresh Now'));
      assert.ok(menu.items.find((item) => item.role === 'quit'));
    });

    await check('tray tooltip fits Windows limit and icon supports both DPI scales', () => {
      let icon;
      let tooltip;
      const originalImage = controller.tray.setImage.bind(controller.tray);
      const originalTooltip = controller.tray.setToolTip.bind(controller.tray);
      controller.tray.setImage = (value) => { icon = value; originalImage(value); };
      controller.tray.setToolTip = (value) => { tooltip = value; originalTooltip(value); };
      controller.applyGlyph(controller.demoGauges, 'Long provider title '.repeat(15));
      assert.ok(tooltip.length <= 128);
      assert.equal(tooltip.at(-1), '…');
      assert.equal(icon.isEmpty(), false);
      assert.deepEqual(icon.getScaleFactors(), [1, 2]);
      assert.equal(nativeImage.createFromBuffer(icon.toPNG()).isEmpty(), false);
    });

    await check('native menu switches active source and persists selection', () => {
      const item = controller.buildMenu().items.find((item) => item.type === 'checkbox' && item.label.includes('GitHub'));
      assert.ok(item);
      item.click();
      assert.equal(loadConfig().mainSource, 'github');
    });

    let applies = 0;
    const options = {
      getConfig: () => controller.config,
      getSections: () => controller.sections,
      onApply: (config) => { controller.config = config; applies++; },
    };
    const js = (code) => settings.webContents.executeJavaScript(code);
    async function open() {
      settings = openSettingsWindow(options);
      await until(() => js("document.querySelectorAll('.keyrow input').length === 4"));
    }

    await check('settings renderer loads sandboxed preload and masks credentials', async () => {
      await open();
      assert.equal(await js('typeof window.quotabar.setPoll'), 'function');
      assert.equal(await js('typeof require'), 'undefined');
      assert.equal(await js("document.body.innerHTML.includes('REDACTED-original-key')"), false);
      assert.match(await js("document.getElementById('key-zai').value"), /\*.*l-key$/);
      assert.equal(openSettingsWindow(options), settings, 'Reopening should reuse existing window');
    });

    await check('poll selector applies and persists cadence through preload IPC', async () => {
      await js("document.getElementById('poll').value = '15'; document.getElementById('poll').dispatchEvent(new Event('change'))");
      await until(() => controller.config.pollMinutes === 15);
      assert.equal(loadConfig().pollMinutes, 15);
    });

    await check('source checkbox disables fetching while preserving stored key', async () => {
      await js("document.querySelector('#sources input[data-id=zai]').click()");
      await until(() => controller.config.sources?.zai?.enabled === false);
      assert.equal(loadConfig().zaiToken, 'REDACTED-original-key');
    });

    await check('Start at login invokes login IPC without changing provider config', async () => {
      const before = JSON.stringify(controller.config);
      await js("document.getElementById('login').click()");
      await until(() => loginWrites.length > 0);
      assert.equal(login, true);
      assert.equal(JSON.stringify(controller.config), before);
    });

    await check('blank key blur retains stored secret; edited key persists and masks', async () => {
      await js("{ const input = document.getElementById('key-zai'); input.dispatchEvent(new Event('focus')); input.dispatchEvent(new Event('blur')); }");
      assert.equal(controller.config.zaiToken, 'REDACTED-original-key');
      await js("{ const input = document.getElementById('key-zai'); input.dispatchEvent(new Event('focus')); input.value = ' REDACTED-replacement '; input.dispatchEvent(new Event('blur')); }");
      await until(() => controller.config.zaiToken === 'REDACTED-replacement');
      assert.equal(loadConfig().zaiToken, 'REDACTED-replacement');
      await until(() => js("document.getElementById('key-zai').value.includes('*')"));
    });

    await check('clear-key button removes credential and persisted auth scheme', async () => {
      await js("document.querySelector('.clearbtn[data-id=zai]').click()");
      await until(() => controller.config.zaiToken === '');
      assert.equal(loadConfig().authScheme, undefined);
    });

    await check('Open config uses isolated profile path', async () => {
      await js("document.getElementById('openConfig').click()");
      await until(() => opened.length === 1);
      assert.equal(opened[0], path.join(home, '.quotabar', 'config.json'));
    });

    await check('settings close removes IPC listeners; reopened window applies exactly once', async () => {
      settings.destroy();
      assert.equal(ipcMain.listenerCount('settings:set-poll'), 0);
      await open();
      const before = applies;
      await js('window.quotabar.setPoll(10)');
      await until(() => controller.config.pollMinutes === 10);
      assert.equal(applies - before, 1);
      assert.equal(ipcMain.listenerCount('settings:set-poll'), 1);
    });

    await check('settings IPC ignores messages from unrelated renderers', () => {
      const before = controller.config.pollMinutes;
      ipcMain.emit('settings:set-poll', { sender: {} }, 60);
      assert.equal(controller.config.pollMinutes, before);
    });

    await check('live controller caches snapshots and respects disabled sources', async () => {
      controller.demoMode = false;
      controller.config = { ...defaultConfig(), sources: { zai: { enabled: false }, github: { enabled: false } } };
      await controller.refreshNow();
      assert.deepEqual(controller.sections, []);
      assert.equal(fs.existsSync(cacheFileURL()), false);
      controller.saveCachedSnapshot(controller.snapshot);
      const fresh = new QuotaBarApp({ demoMode: false });
      fresh.loadCachedSnapshot();
      assert.equal(fresh.snapshot.gauges.length, 3);
      fs.writeFileSync(cacheFileURL(), '{broken');
      fresh.loadCachedSnapshot();
      assert.equal(fresh.snapshot, null);
    });

    await check('polling refreshes missing or stale data, but leaves fresh data alone', async () => {
      const poller = new QuotaBarApp({ demoMode: false });
      let refreshes = 0;
      poller.refreshNow = async () => { refreshes++; };
      poller.config.pollMinutes = 5;
      poller.pollTick();
      assert.equal(refreshes, 1);
      poller.snapshot = { fetchedAt: new Date() };
      poller.pollTick();
      assert.equal(refreshes, 1);
      poller.snapshot.fetchedAt = new Date(Date.now() - 301000);
      poller.pollTick();
      assert.equal(refreshes, 2);
    });

    await check('menu aligns variable labels and shows reset-only provider details', () => {
      const original = controller.sections;
      controller.sections = [{ id: 'custom', title: 'Custom', gauges: [
        { id: 'short', label: 'Short', pct: 10, resetAt: new Date(Date.now() + 3600000) },
        { id: 'long', label: 'Long provider gauge label', pct: 20 },
      ] }];
      try {
        const labels = controller.buildMenu().items.map((item) => item.label);
        const rows = labels.filter((label) => label.includes('% used'));
        assert.ok(rows[0].search(/[█░]/) > 0);
        assert.equal(rows[0].search(/[█░]/), rows[1].search(/[█░]/));
        assert.ok(labels.some((label) => label.startsWith('    ') && /reset/i.test(label)), 'OAuth providers need reset rows even without raw counts');
      } finally { controller.sections = original; }
    });

    await check('in-flight refreshes coalesce into one follow-up using current settings', async () => {
      controller.config = { ...defaultConfig(), sources: { zai: { enabled: false }, github: { enabled: true } } };
      const originalFetch = globalThis.fetch;
      let release;
      let calls = 0;
      const ready = new Promise((resolve) => { release = resolve; });
      globalThis.fetch = async () => {
        calls++;
        if (calls === 1) await ready;
        return new Response(JSON.stringify({ resources: { core: { used: 5, limit: 60, reset: 1788278400 } } }));
      };
      try {
        const first = controller.refreshNow();
        await controller.refreshNow();
        await controller.refreshNow();
        assert.equal(calls, 1);
        release();
        await first;
        await until(() => !controller.refreshGate.running);
        assert.equal(calls, 2);
        assert.deepEqual(controller.sections.map((section) => section.id), ['github']);
        assert.equal(controller.sections[0].errorMessage, undefined);
      } finally { globalThis.fetch = originalFetch; }
    });

    await check('refreshed OAuth credentials persist through the application controller', async () => {
      const entry = { enabled: false, token: '', discovered: false };
      controller.config = { ...defaultConfig(), sources: {
        zai: { ...entry }, github: { enabled: false, token: '' },
        claude: { ...entry, enabled: true, token: 'REDACTED-old', refreshToken: 'REDACTED-refresh' },
      } };
      const originalFetch = globalThis.fetch;
      const replies = [
        new Response('{}', { status: 401 }),
        new Response(JSON.stringify({ access_token: 'REDACTED-rotated', refresh_token: 'REDACTED-rotated-refresh' })),
        new Response(JSON.stringify({ five_hour: { utilization: 40 } })),
      ];
      globalThis.fetch = async () => { assert.ok(replies.length); return replies.shift(); };
      try {
        await controller.refreshNow();
        assert.equal(replies.length, 0);
        assert.equal(loadConfig().sources.claude.token, 'REDACTED-rotated');
        assert.equal(loadConfig().sources.claude.refreshToken, 'REDACTED-rotated-refresh');
        assert.equal(controller.sections[0].gauges[0].pct, 40);
      } finally { globalThis.fetch = originalFetch; }
    });
  } catch (error) {
    results.push({ name: 'Electron harness setup', error: error.stack });
  } finally {
    for (const timer of intervals) clearInterval(timer);
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    controller?.tray?.destroy();
    process.stdout.write(`QUOTABAR_RESULTS=${JSON.stringify(results)}\n`, () => app.exit(0));
  }
}
main();
