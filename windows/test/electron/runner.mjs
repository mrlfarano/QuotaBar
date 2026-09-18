// Real Electron/Chromium, native tray/menu, and preload IPC. No real credentials,
// external requests, clipboard writes, or visible windows. The native login
// check creates one uniquely named temporary startup entry and removes it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';
import { QuotaBarApp } from '../../src/trayapp.js';
import { openSettingsWindow } from '../../src/settingswindow.js';
import { loginItemOptions, isLoginEnabled, setLoginEnabled } from '../../src/loginitem.js';
import { defaultConfig, saveConfig, loadConfig, cacheFileURL, configFileURL } from '../../src/core/config.js';

const home = process.env.QUOTABAR_TEST_HOME;
assert.ok(home && path.basename(home).startsWith('quotabar-electron-test-'));
os.homedir = () => home;
app.setPath('userData', path.join(home, 'electron'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
BrowserWindow.prototype.show = () => {};
BrowserWindow.prototype.focus = () => {};
const nativeLogin = {
  getLoginItemSettings: app.getLoginItemSettings.bind(app),
  setLoginItemSettings: app.setLoginItemSettings.bind(app),
};
let login = false;
const loginWrites = [];
app.getLoginItemSettings = () => ({ openAtLogin: false, launchItems: login ? [{ ...loginItemOptions(app), scope: 'user', enabled: true }] : [] });
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

    await check('discovery saves new sources and refreshes without opening an alert or window', async () => {
      const discoverer = new QuotaBarApp({ demoMode: false });
      const authFile = path.join(home, '.codex', 'auth.json');
      fs.mkdirSync(path.dirname(authFile), { recursive: true });
      fs.writeFileSync(authFile, JSON.stringify({ tokens: { access_token: 'REDACTED-discovery' } }));
      const originalDialog = dialog.showMessageBox;
      const windows = BrowserWindow.getAllWindows();
      let alerts = 0;
      let refreshes = 0;
      const rebuilds = [];
      dialog.showMessageBox = async () => { alerts++; return { response: 0 }; };
      discoverer.rebuild = (reason) => rebuilds.push(reason);
      discoverer.refreshNow = async () => {
        assert.equal(discoverer.config.sources.codex.enabled, true);
        refreshes++;
      };
      try {
        await discoverer.discoverSources();
        assert.equal(loadConfig().sources.codex.discovered, true);
        assert.deepEqual(rebuilds, ['discovered']);
        assert.equal(refreshes, 1);
        await discoverer.discoverSources();
        assert.deepEqual(rebuilds, ['discovered'], 'Unchanged discovery should not rewrite config');
        assert.equal(refreshes, 2, 'Existing sources also refresh after discovery');
        assert.equal(alerts, 0);
        assert.deepEqual(BrowserWindow.getAllWindows(), windows);
      } finally {
        dialog.showMessageBox = originalDialog;
        fs.unlinkSync(authFile);
        saveConfig(controller.config);
        app.quotabarInstance = controller;
      }
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
      await js("document.getElementById('tab-sources').click(); { const box = document.querySelector('#sources input[data-id=zai]'); box.focus(); box.click(); }");
      await until(() => controller.config.sources?.zai?.enabled === false);
      assert.equal(loadConfig().zaiToken, 'REDACTED-original-key');
      await until(() => js("document.activeElement.matches('#sources input[data-id=zai]')"));
    });

    await check('Start at login invokes login IPC without changing provider config', async () => {
      const before = JSON.stringify(controller.config);
      await js("document.getElementById('tab-general').click(); document.getElementById('login').click()");
      await until(() => loginWrites.length > 0);
      assert.equal(login, true);
      await until(() => js("document.getElementById('login').checked"));
      await js('window.quotabar.settingsInitRequest()');
      assert.equal(await js("document.getElementById('login').checked"), true);
      await js("document.getElementById('login').click()");
      await until(() => !login);
      assert.equal(await js("document.getElementById('login').checked"), false);
      assert.equal(JSON.stringify(controller.config), before);
    });

    await check('real Windows login entry enables, reads back, disables, and cleans up', () => {
      const options = { ...loginItemOptions(app), name: `QuotaBarVerification-${process.pid}` };
      try {
        assert.equal(isLoginEnabled(nativeLogin, options), false);
        setLoginEnabled(nativeLogin, true, options);
        assert.equal(isLoginEnabled(nativeLogin, options), true);
        setLoginEnabled(nativeLogin, false, options);
        assert.equal(isLoginEnabled(nativeLogin, options), false);
      } finally {
        nativeLogin.setLoginItemSettings({ ...options, openAtLogin: false });
      }
    });

    await check('provider toggles keep row positions and visible text unchanged', async () => {
      await js("document.getElementById('tab-sources').click()");
      const layout = () => js("[...document.querySelectorAll('#sources label')].map(row => ({text:row.innerText,top:row.getBoundingClientRect().top,height:row.getBoundingClientRect().height}))");
      const before = await layout();
      await js("document.querySelector('#sources input[data-id=claude]').click()");
      await until(() => controller.config.sources?.claude?.enabled);
      assert.deepEqual(await layout(), before);
      await js("document.querySelector('#sources input[data-id=claude]').click()");
      await until(() => !controller.config.sources?.claude?.enabled);
      assert.deepEqual(await layout(), before);
    });

    await check('settings tabs support arrow keys and keep advanced draft when switching', async () => {
      await js("document.getElementById('tab-general').focus(); document.getElementById('tab-general').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight',bubbles:true}))");
      assert.equal(await js("document.activeElement.id"), 'tab-sources');
      assert.equal(await js("document.getElementById('sourceSettings').hidden"), false);
      await js("document.getElementById('tab-advanced').click(); { const field = document.querySelector('[data-field=baseURL]'); field.value = 'https://draft.example.com'; field.dispatchEvent(new Event('input',{bubbles:true})); } document.getElementById('tab-general').click(); document.getElementById('tab-advanced').click()");
      assert.equal(await js("document.querySelector('[data-field=baseURL]').value"), 'https://draft.example.com');
      await js("document.getElementById('reloadAdvanced').click()");
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

    await check('advanced settings validate inline and save custom sources through the form', async () => {
      await js(`document.getElementById('tab-advanced').click();
        document.getElementById('addCustom').click();
        document.querySelector('.custom-source [data-field=id]').value = 'test-custom';
        document.getElementById('saveAdvanced').click();`);
      await until(() => js("document.getElementById('advancedStatus').textContent.includes('required')"));
      assert.equal(controller.config.sources?.custom, undefined);
      await js(`{
        const source = document.querySelector('.custom-source');
        for (const [key, value] of Object.entries({url:'https://example.com/usage',title:'<img src=x onerror=alert(1)>',usedPath:'data.used',limitPath:'data.limit',token:'REDACTED-custom-form',headers:'{"X-Key":"REDACTED-header"}'})) source.querySelector('[data-field=' + key + ']').value = value;
        document.getElementById('saveAdvanced').click();
      }`);
      await until(() => controller.config.sources?.custom?.length === 1);
      await until(() => js("document.querySelector('#mainSource option[value=test-custom]') !== null"));
      await js("document.getElementById('mainSource').value = 'test-custom'; document.getElementById('mainSource').dispatchEvent(new Event('change'))");
      await until(() => loadConfig().mainSource === 'test-custom');
      assert.equal(loadConfig().sources.custom[0].token, 'REDACTED-custom-form');
      assert.deepEqual(loadConfig().sources.custom[0].headers, { 'X-Key': 'REDACTED-header' });
      assert.equal(await js("document.body.innerHTML.includes('REDACTED-custom-form')"), false);
      assert.equal(await js("document.body.innerHTML.includes('REDACTED-header')"), false);
      assert.equal(await js("document.querySelectorAll('#customSources img').length"), 0);
    });

    await check('advanced drafts survive live updates and discard restores saved values', async () => {
      await js(`{
        const field = document.querySelector('#advancedGeneral [data-field=baseURL]');
        field.value = 'https://draft.example.com'; field.dispatchEvent(new Event('input', {bubbles:true}));
        window.quotabar.setPoll(15);
      }`);
      await until(() => controller.config.pollMinutes === 15);
      assert.equal(await js("document.querySelector('#advancedGeneral [data-field=baseURL]').value"), 'https://draft.example.com');
      await js("document.getElementById('reloadAdvanced').click()");
      assert.equal(await js("document.querySelector('#advancedGeneral [data-field=baseURL]').value"), controller.config.baseURL);
      await js("document.getElementById('mainSource').value = ''; document.getElementById('mainSource').dispatchEvent(new Event('change'))");
      await until(() => controller.config.mainSource === undefined);
      await js("document.querySelector('.remove-custom').click(); document.getElementById('saveAdvanced').click()");
      await until(() => controller.config.sources?.custom?.length === 0);
      assert.equal(loadConfig().mainSource, undefined);
    });

    await check('advanced credential fields retain refreshed tokens and support explicit clearing', async () => {
      controller.config.sources.codex = { enabled: false, discovered: true, token: 'REDACTED-old-access', refreshToken: 'REDACTED-old-refresh' };
      await js('window.quotabar.settingsInitRequest()');
      await until(() => js("document.querySelector('.advanced-provider[data-id=codex] [data-field=token]').placeholder.includes('ccess')"));
      controller.config.sources.codex.token = 'REDACTED-refreshed-access';
      controller.config.sources.codex.refreshToken = 'REDACTED-refreshed-refresh';
      await js("document.getElementById('saveAdvanced').click()");
      await until(() => js("!document.getElementById('saveAdvanced').disabled"));
      assert.equal(loadConfig().sources.codex.token, 'REDACTED-refreshed-access');
      assert.equal(loadConfig().sources.codex.refreshToken, 'REDACTED-refreshed-refresh');
      await js("document.querySelector('.advanced-provider[data-id=codex] [data-field=cleartoken]').click(); document.getElementById('saveAdvanced').click()");
      await until(() => controller.config.sources.codex.token === '');
      assert.equal(loadConfig().sources.codex.enabled, false);
      assert.equal(loadConfig().sources.codex.refreshToken, 'REDACTED-refreshed-refresh');
    });

    await check('failed advanced save keeps live config and editable draft', async () => {
      const file = configFileURL();
      const saved = fs.readFileSync(file);
      const original = controller.config;
      fs.unlinkSync(file);
      fs.mkdirSync(file);
      try {
        await js(`{
          const field = document.querySelector('#advancedGeneral [data-field=baseURL]');
          field.value = 'https://unsaved.example.com'; field.dispatchEvent(new Event('input', {bubbles:true}));
          document.getElementById('saveAdvanced').click();
        }`);
        await until(() => js("document.getElementById('advancedStatus').textContent.includes('Could not save')"));
        assert.equal(controller.config, original);
        assert.equal(await js("document.querySelector('#advancedGeneral [data-field=baseURL]').value"), 'https://unsaved.example.com');
      } finally {
        fs.rmdirSync(file);
        fs.writeFileSync(file, saved);
        await js("document.getElementById('reloadAdvanced').click()");
      }
    });

    await check('advanced save rejects a different renderer', async () => {
      const other = new BrowserWindow({ show: false, webPreferences: { preload: fileURLToPath(new URL('../../src/preload.cjs', import.meta.url)) } });
      try {
        await other.loadURL('about:blank');
        const result = await other.webContents.executeJavaScript('window.quotabar.saveAdvanced({})');
        assert.equal(result.error, 'Settings window required.');
      } finally { other.destroy(); }
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
