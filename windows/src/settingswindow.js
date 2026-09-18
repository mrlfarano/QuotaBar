// Port of SettingsWindowController.swift — UI for the config fields people
// otherwise hand-edit: poll cadence, per-source on/off, and the directly
// pasted keys (Z.AI, GitHub, OpenRouter). Every change applies live (saved
// through the same config store and pushed via onApply, which rebuilds the
// tray menu and refreshes sources). Key fields show stars + the last 5
// characters; focusing clears the field for a fresh paste, leaving it empty
// keeps the old value. Custom sources and the OAuth-managed tokens stay
// JSON-first via "Open config.json…".

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import {
  POLL_CHOICES, TOGGLEABLE_SOURCES, KEY_FIELDS,
  isSourceEnabled, setSourceEnabled, sourceStatus, maskedKey, keyValue, setKey,
} from './core/settings.js';
import { normalizedPollMinutes } from './core/format.js';
import { saveConfig, configFileURL } from './core/config.js';

let shared = null; // shared instance so reopening re-syncs to the live config

/// Opens (or re-syncs) the settings window. `getConfig` must return the
/// controller's current config (it mutates outside this window);
/// `getSections` the latest fetched sections (for the per-source status
/// lines — optional, defaults to none); `onApply` receives the updated
/// config after every change.
export function openSettingsWindow({ getConfig, getSections, onApply }) {
  const sections = getSections ?? (() => []);
  if (shared && !shared.isDestroyed()) {
    shared.webContents.send('settings:init', settingsState(getConfig(), sections()));
    shared.show();
    shared.focus();
    return shared;
  }

  shared = new BrowserWindow({
    width: 380,
    height: 480,
    resizable: false,
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
    shared = null;
  });

  // Every apply re-pushes the full state so the key masks and per-source
  // statuses reflect what was actually stored (and edits in one control
  // don't desync the others).
  const pushState = () => {
    if (shared && !shared.isDestroyed()) shared.webContents.send('settings:init', settingsState(getConfig(), sections()));
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
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
    pushState();
  });
  on('settings:open-config', () => { shell.openPath(configFileURL()); });

  shared.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(settingsHTML()));
  return shared;
}

function settingsState(config, sections) {
  return {
    pollMinutes: normalizedPollMinutes(config.pollMinutes),
    pollChoices: POLL_CHOICES,
    loginEnabled: app.getLoginItemSettings().openAtLogin,
    sources: TOGGLEABLE_SOURCES.map(({ id, title }) => ({
      id, title,
      enabled: isSourceEnabled(config, id),
      status: sourceStatus(id, config, sections ?? []),
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
  :root { color-scheme: light dark; }
  body { font: 13px/1.5 "Segoe UI", system-ui, sans-serif; margin: 0; padding: 16px; user-select: none; }
  .row { display: flex; align-items: center; gap: 6px; }
  h2 { font-size: 11px; font-weight: 600; opacity: .7; margin: 14px 0 6px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 24px; row-gap: 6px; }
  .keyrow { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .keyrow label { width: 72px; }
  .keyrow input { flex: 1; padding: 3px 6px; font-family: Consolas, monospace; }
  .keyrow .clearbtn { margin: 0; padding: 0 7px; font-size: 13px; line-height: 18px; }
  .status { font-size: 11px; opacity: .75; justify-self: start; }
  select { padding: 2px 4px; }
  button { margin-top: 14px; padding: 4px 12px; }
</style>
</head>
<body>
  <div class="row">
    <label for="poll">Poll menu data every</label>
    <select id="poll"></select>
    <span>minutes</span>
  </div>
  <div class="row" style="margin-top: 6px">
    <label><input type="checkbox" id="login"> Start at login</label>
  </div>
  <h2>Sources</h2>
  <div class="grid" id="sources"></div>
  <h2>Keys</h2>
  <div id="keys"></div>
  <button id="openConfig">Open config.json…</button>
  <script>
    const escapeHTML = (s) => String(s).replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.quotabar.settingsInitRequest();
    window.quotabar.onInit((state) => {
      const focusedSource = document.activeElement.matches('#sources input')
        ? document.activeElement.dataset.id : null;
      const poll = document.getElementById('poll');
      const choices = state.pollChoices.includes(state.pollMinutes)
        ? state.pollChoices : [...state.pollChoices, state.pollMinutes].sort((a, b) => a - b);
      poll.innerHTML = choices.map((m) =>
        '<option value="' + m + '"' + (m === state.pollMinutes ? ' selected' : '') + '>' + m + '</option>').join('');
      poll.onchange = () => window.quotabar.setPoll(Number(poll.value));
      // Registry-backed (not config.json): re-read on every state push so
      // external changes to the login item are reflected.
      const login = document.getElementById('login');
      login.checked = Boolean(state.loginEnabled);
      login.onchange = () => window.quotabar.setLogin(login.checked);
      document.getElementById('sources').innerHTML = state.sources.map((s) =>
        '<label><input type="checkbox" data-id="' + s.id + '"' + (s.enabled ? ' checked' : '') + '> ' + s.title + '</label>'
        + (s.status ? '<span class="status">' + escapeHTML(s.status) + '</span>' : '')).join('');
      for (const box of document.querySelectorAll('#sources input[type=checkbox]')) {
        box.onchange = () => window.quotabar.setSource(box.dataset.id, box.checked);
      }
      if (focusedSource) document.querySelector('#sources input[data-id="' + focusedSource + '"]')?.focus();
      // Key fields hold the masked value until focused; focusing clears the
      // field for a fresh paste, blurring empty restores the old mask. The ×
      // button (stored keys only) removes the credential outright.
      document.getElementById('keys').innerHTML = state.keys.map((k) =>
        '<div class="keyrow"><label for="key-' + k.id + '">' + k.title + '</label>'
        + '<input id="key-' + k.id + '" data-id="' + k.id + '" data-masked="1" spellcheck="false" '
        + 'value="' + escapeHTML(k.value) + '" title="' + escapeHTML(k.tooltip) + '">'
        + (k.stored ? '<button class="clearbtn" data-id="' + k.id + '" title="Remove stored key" aria-label="Remove stored ' + escapeHTML(k.title) + ' key">×</button>' : '')
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
  </script>
</body>
</html>`;
}
