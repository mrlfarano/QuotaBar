// Port of SettingsWindowController.swift — UI for the config fields people
// otherwise hand-edit: poll cadence, per-source on/off, and the directly
// pasted keys (Z.AI, GitHub, OpenRouter). Every change applies live (saved
// through the same config store and pushed via onApply, which rebuilds the
// tray menu and refreshes sources). Key fields show stars + the last 5
// characters; focusing clears the field for a fresh paste, leaving it empty
// keeps the old value. Advanced options and custom sources use an explicit
// Save button so incomplete edits never replace the working configuration.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import {
  POLL_CHOICES, TOGGLEABLE_SOURCES, KEY_FIELDS,
  isSourceEnabled, setSourceEnabled, maskedKey, keyValue, setKey,
} from './core/settings.js';
import { normalizedPollMinutes } from './core/format.js';
import { saveConfig, configFileURL } from './core/config.js';
import { advancedSettingsState, applyAdvancedSettings } from './core/advancedsettings.js';
import { setupAdvancedSettings } from './settingsadvanced.js';
import { isLoginEnabled, setLoginEnabled } from './loginitem.js';

let shared = null; // shared instance so reopening re-syncs to the live config

/// Opens (or re-syncs) the settings window. `getConfig` must return the
/// controller's current config (it mutates outside this window);
/// `onApply` receives the updated
/// config after every change.
export function openSettingsWindow({ getConfig, onApply }) {
  if (shared && !shared.isDestroyed()) {
    shared.webContents.send('settings:init', settingsState(getConfig()));
    shared.show();
    shared.focus();
    return shared;
  }

  shared = new BrowserWindow({
    width: 640,
    height: 720,
    minWidth: 480,
    minHeight: 400,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'QuotaBar Settings',
    show: false,
    webPreferences: { preload: path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload.cjs') },
  });
  shared.setMenuBarVisibility(false);
  shared.once('ready-to-show', () => shared.show());
  const window = shared;
  const handlers = [];
  const on = (channel, handler) => {
    const listener = (event, ...args) => {
      if (event.sender === window.webContents) handler(event, ...args);
    };
    handlers.push([channel, listener]);
    ipcMain.on(channel, listener);
  };
  shared.on('closed', () => {
    for (const [channel, listener] of handlers) ipcMain.removeListener(channel, listener);
    ipcMain.removeHandler('settings:save-advanced');
    shared = null;
  });

  // Every apply re-pushes the full state so the key masks and per-source
  // statuses reflect what was actually stored (and edits in one control
  // don't desync the others).
  const pushState = () => {
    if (shared && !shared.isDestroyed()) shared.webContents.send('settings:init', settingsState(getConfig()));
  };

  on('settings:init-request', () => pushState());
  on('settings:set-poll', (_event, minutes) => {
    const updated = { ...getConfig(), pollMinutes: normalizedPollMinutes(Number(minutes)) };
    saveConfig(updated);
    onApply(updated);
    pushState();
  });
  on('settings:set-source', (_event, id, enabled) => {
    const updated = setSourceEnabled(getConfig(), String(id), Boolean(enabled));
    saveConfig(updated);
    onApply(updated);
    pushState();
  });
  on('settings:set-main', (_event, id) => {
    if (typeof id !== 'string' || (id && ![...TOGGLEABLE_SOURCES, ...(getConfig().sources?.custom ?? [])].some((source) => source.id === id))) return;
    const updated = { ...getConfig(), mainSource: id || undefined };
    if (!saveConfig(updated)) return;
    onApply(updated);
    pushState();
  });
  on('settings:set-key', (_event, id, key) => {
    const candidate = String(key ?? '').trim();
    if (candidate === '') return;
    const updated = setKey(getConfig(), String(id), candidate);
    saveConfig(updated);
    onApply(updated);
    pushState();
  });
  // The × button: remove the credential outright (empty blur still means
  // "keep"; setKey('') also drops the zai auth scheme for a re-probe).
  on('settings:clear-key', (_event, id) => {
    const updated = setKey(getConfig(), String(id), '');
    saveConfig(updated);
    onApply(updated);
    pushState();
  });
  // Start-at-login: the OS login-items registry is the source of truth
  // (never stored in config.json), re-read on every state push.
  on('settings:set-login', (_event, enabled) => {
    try {
      setLoginEnabled(app, Boolean(enabled));
      window.webContents.send('settings:login-error', '');
    } catch (error) { window.webContents.send('settings:login-error', error.message); }
    pushState();
  });
  on('settings:open-config', () => { shell.openPath(configFileURL()); });
  ipcMain.handle('settings:save-advanced', (event, edit) => {
    if (event.sender !== window.webContents) return { error: 'Settings window required.' };
    try {
      const updated = applyAdvancedSettings(getConfig(), edit);
      if (!saveConfig(updated)) return { error: 'Could not save config.json. Check folder permissions and try again.' };
      onApply(updated);
      pushState();
      return { state: advancedSettingsState(updated) };
    } catch (error) { return { error: error.message }; }
  });

  shared.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(settingsHTML()));
  return shared;
}

function settingsState(config) {
  return {
    advanced: advancedSettingsState(config),
    pollMinutes: normalizedPollMinutes(config.pollMinutes),
    pollChoices: POLL_CHOICES,
    mainSource: config.mainSource ?? '',
    mainSources: [...TOGGLEABLE_SOURCES, ...(config.sources?.custom ?? [])].map(({ id, title }) => ({ id, title: title ?? id })),
    loginEnabled: isLoginEnabled(app),
    sources: TOGGLEABLE_SOURCES.map(({ id, title }) => ({
      id, title,
      enabled: isSourceEnabled(config, id),
    })),
    keys: KEY_FIELDS.map(({ id, title, tooltip }) => {
      const stored = keyValue(config, id);
      return { id, title, tooltip, stored: stored !== '', value: maskedKey(stored) };
    }),
  };
}

function settingsHTML() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: light dark; --bg: #fafafa; --surface: #fff; --text: #202020; --muted: #686868; --line: #e3e3e3; --control: #fff; --accent: #0067c0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #202020; --surface: #282828; --text: #f2f2f2; --muted: #aaa; --line: #3b3b3b; --control: #303030; --accent: #8fc9ff; } }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { font: 13px/1.5 "Segoe UI", system-ui, sans-serif; margin: 0; color: var(--text); background: var(--bg); user-select: none; height: 100vh; display: flex; flex-direction: column; }
  header { padding: 22px 28px 0; flex-shrink: 0; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 18px; }
  nav { display: flex; gap: 24px; border-bottom: 1px solid var(--line); }
  button, input, select { font: inherit; color: inherit; }
  button { cursor: pointer; background: var(--control); border: 1px solid var(--line); border-radius: 4px; padding: 6px 14px; }
  button:hover { filter: brightness(1.1); }
  button:disabled { opacity: .45; cursor: default; }
  nav button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: none; color: var(--muted); padding: 0 0 10px; }
  nav button[aria-selected=true] { color: var(--text); border-bottom-color: var(--accent); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  main { flex: 1; min-height: 0; overflow: auto; padding: 20px 28px; scrollbar-gutter: stable; }
  h2, h3 { font-size: 13px; font-weight: 600; margin: 0 0 12px; }
  .section + .section { margin-top: 20px; }
  .settings-list { border: 1px solid var(--line); border-radius: 5px; background: var(--surface); }
  .setting-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 48px; padding: 10px 14px; }
  .setting-row + .setting-row { border-top: 1px solid var(--line); }
  .setting-row select { max-width: 55%; }
  .source-row { min-height: 34px; padding: 6px 14px; }
  input:not([type=checkbox]), select { min-width: 0; border: 1px solid var(--line); border-bottom-color: var(--muted); border-radius: 4px; background: var(--control); padding: 6px 9px; }
  input[type=checkbox] { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); flex-shrink: 0; cursor: pointer; }
  .keyrow { display: grid; grid-template-columns: 90px minmax(0, 1fr) 28px; gap: 10px; align-items: center; margin-bottom: 6px; }
  .clearbtn { padding: 2px; border: 0; background: none; color: var(--muted); font-size: 18px; }
  .clearbtn:disabled { visibility: hidden; }
  .advanced-grid { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 10px 16px; align-items: center; }
  .advanced-grid input:not([type=checkbox]) { width: 100%; }
  .clear-option { grid-column: 2; display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--muted); }
  details { border-bottom: 1px solid var(--line); }
  summary { padding: 12px 0; cursor: pointer; }
  details .advanced-grid { padding: 2px 0 18px; }
  fieldset { min-width: 0; }
  #advancedEditor { border: 0; margin: 0; padding: 0; }
  .custom-source { border: 1px solid var(--line); border-radius: 5px; padding: 16px; margin: 0 0 16px; }
  .custom-source legend { padding: 0 6px; }
  .remove-custom { margin-top: 16px; }
  .hint { color: var(--muted); font-size: 12px; margin: 0 0 14px; }
  .hint.help { margin: 12px 0 0; }
  footer { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; min-height: 62px; padding: 12px 28px; border-top: 1px solid var(--line); }
  #openConfig { background: none; border: 0; padding: 4px 0; color: var(--muted); font-size: 12px; }
  #advancedActions { display: flex; align-items: center; gap: 8px; }
  #advancedStatus { margin: 16px 0 0; min-height: 1.5em; font-size: 12px; color: var(--muted); }
  #saveAdvanced { background: var(--accent); border-color: var(--accent); color: var(--bg); }
  @media (max-width: 520px) { header { padding: 18px 20px 0; } main { padding: 20px; } footer { padding: 12px 20px; } .advanced-grid { grid-template-columns: 1fr; gap: 6px; } .advanced-grid input { margin-bottom: 6px; } .clear-option { grid-column: 1; } }
</style>
</head>
<body>
  <header>
    <h1>Settings</h1>
    <nav role="tablist" aria-label="Settings categories">
      <button id="tab-general" role="tab" aria-selected="true" aria-controls="general" tabindex="0">General</button>
      <button id="tab-sources" role="tab" aria-selected="false" aria-controls="sourceSettings" tabindex="-1">Sources</button>
      <button id="tab-advanced" role="tab" aria-selected="false" aria-controls="advanced" tabindex="-1">Advanced</button>
    </nav>
  </header>
  <main>
    <section id="general" role="tabpanel" aria-labelledby="tab-general">
      <div class="settings-list">
        <label class="setting-row" for="login"><span>Start at login</span><input type="checkbox" id="login"></label>
        <label class="setting-row" for="poll"><span>Refresh interval</span><select id="poll"></select></label>
        <label class="setting-row" for="mainSource"><span>Tray source</span><select id="mainSource"></select></label>
      </div>
      <p id="loginStatus" role="status" aria-live="polite"></p>
    </section>
    <section id="sourceSettings" role="tabpanel" aria-labelledby="tab-sources" hidden>
      <div class="section"><h2>Providers</h2><div class="settings-list" id="sources"></div></div>
      <div class="section"><h2>API keys</h2><div id="keys"></div></div>
    </section>
    <section id="advanced" role="tabpanel" aria-labelledby="tab-advanced" hidden>
      <fieldset id="advancedEditor" aria-label="Advanced configuration"></fieldset>
      <p id="advancedStatus" role="status" aria-live="polite"></p>
    </section>
  </main>
  <footer>
    <button id="openConfig">Open configuration file</button>
    <div id="advancedActions" hidden><button id="reloadAdvanced">Discard</button><button id="saveAdvanced">Save changes</button></div>
  </footer>
  <script>
    const escapeHTML = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    (${setupAdvancedSettings.toString()})(window.quotabar, escapeHTML);
    window.quotabar.onLoginError((message) => { document.getElementById('loginStatus').textContent = message; });
    const tabs = [...document.querySelectorAll('[role=tab]')];
    function selectTab(tab) {
      for (const item of tabs) {
        const selected = item === tab;
        item.setAttribute('aria-selected', selected);
        item.tabIndex = selected ? 0 : -1;
        document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
      }
      document.getElementById('advancedActions').hidden = tab.id !== 'tab-advanced';
      document.querySelector('main').scrollTop = 0;
    }
    for (const [index, tab] of tabs.entries()) {
      tab.onclick = () => selectTab(tab);
      tab.onkeydown = (event) => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next === undefined) return;
        event.preventDefault(); selectTab(tabs[next]); tabs[next].focus();
      };
    }
    window.quotabar.onInit((state) => {
      const poll = document.getElementById('poll');
      const choices = state.pollChoices.includes(state.pollMinutes)
        ? state.pollChoices : [...state.pollChoices, state.pollMinutes].sort((a, b) => a - b);
      poll.innerHTML = choices.map((m) =>
        '<option value="' + m + '"' + (m === state.pollMinutes ? ' selected' : '') + '>' + m + (m === 1 ? ' minute' : ' minutes') + '</option>').join('');
      poll.onchange = () => window.quotabar.setPoll(Number(poll.value));
      const main = document.getElementById('mainSource');
      main.innerHTML = '<option value="">Automatic</option>' + state.mainSources.map((s) =>
        '<option value="' + escapeHTML(s.id) + '">' + escapeHTML(s.title) + '</option>').join('');
      main.value = state.mainSource;
      main.onchange = () => window.quotabar.setMain(main.value);
      const login = document.getElementById('login');
      login.checked = Boolean(state.loginEnabled);
      login.onchange = () => window.quotabar.setLogin(login.checked);
      const sources = document.getElementById('sources');
      if (!sources.children.length) sources.innerHTML = state.sources.map((s) =>
        '<label class="setting-row source-row"><span>' + escapeHTML(s.title) + '</span><input type="checkbox" data-id="' + s.id + '"></label>').join('');
      for (const s of state.sources) {
        const box = sources.querySelector('input[data-id="' + s.id + '"]');
        box.checked = s.enabled;
        box.onchange = () => window.quotabar.setSource(s.id, box.checked);
      }
      // Key fields hold the masked value until focused; focusing clears the
      // field for a fresh paste, blurring empty restores the old mask. The ×
      // button (stored keys only) removes the credential outright.
      document.getElementById('keys').innerHTML = state.keys.map((k) =>
        '<div class="keyrow"><label for="key-' + k.id + '">' + k.title + '</label>'
        + '<input id="key-' + k.id + '" data-id="' + k.id + '" data-masked="1" spellcheck="false" '
        + 'value="' + escapeHTML(k.value) + '" title="' + escapeHTML(k.tooltip) + '">'
        + '<button class="clearbtn" data-id="' + k.id + '" title="Remove stored key" aria-label="Remove stored ' + escapeHTML(k.title) + ' key"' + (k.stored ? '' : ' disabled') + '>×</button>'
        + '</div>').join('');
      for (const input of document.querySelectorAll('.keyrow input')) {
        input.dataset.mask = input.value;
        input.onfocus = () => {
          if (input.dataset.masked === '1') { input.value = ''; input.dataset.masked = '0'; }
        };
        input.onblur = () => {
          if (input.dataset.masked !== '0') return;
          const candidate = input.value.trim();
          if (candidate === '') { input.value = input.dataset.mask; input.dataset.masked = '1'; }
          else { window.quotabar.setKey(input.dataset.id, candidate); }
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      }
      for (const btn of document.querySelectorAll('.clearbtn')) {
        btn.onclick = () => window.quotabar.clearKey(btn.dataset.id);
      }
    });
    document.getElementById('openConfig').onclick = () => window.quotabar.openConfig();
    window.quotabar.settingsInitRequest();
  </script>
</body>
</html>`;
}
