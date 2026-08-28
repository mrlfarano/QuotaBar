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
import { BrowserWindow, ipcMain, shell } from 'electron';
import {
  POLL_CHOICES, TOGGLEABLE_SOURCES, KEY_FIELDS,
  isSourceEnabled, setSourceEnabled, maskedKey, keyValue, setKey,
} from './core/settings.js';
import { normalizedPollMinutes } from './core/format.js';
import { saveConfig, configFileURL } from './core/config.js';

let shared = null; // shared instance so reopening re-syncs to the live config

/// Opens (or re-syncs) the settings window. `getConfig` must return the
/// controller's current config (it mutates outside this window); `onApply`
/// receives the updated config after every change.
export function openSettingsWindow({ getConfig, onApply }) {
  if (shared && !shared.isDestroyed()) {
    shared.webContents.send('settings:init', settingsState(getConfig()));
    shared.show();
    shared.focus();
    return shared;
  }

  shared = new BrowserWindow({
    width: 380,
    height: 372,
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
  shared.on('closed', () => { shared = null; });

  // Every apply re-pushes the full state so the key masks reflect what was
  // actually stored (and edits in one control don't desync the others).
  const pushState = () => {
    if (shared && !shared.isDestroyed()) shared.webContents.send('settings:init', settingsState(getConfig()));
  };

  ipcMain.on('settings:init-request', () => pushState());
  ipcMain.on('settings:set-poll', (_event, minutes) => {
    const updated = { ...getConfig(), pollMinutes: normalizedPollMinutes(Number(minutes)) };
    saveConfig(updated);
    onApply(updated);
    pushState();
  });
  ipcMain.on('settings:set-source', (_event, id, enabled) => {
    const updated = setSourceEnabled(getConfig(), String(id), Boolean(enabled));
    saveConfig(updated);
    onApply(updated);
    pushState();
  });
  ipcMain.on('settings:set-key', (_event, id, key) => {
    const candidate = String(key ?? '').trim();
    if (candidate === '') return;
    const updated = setKey(getConfig(), String(id), candidate);
    saveConfig(updated);
    onApply(updated);
    pushState();
  });
  ipcMain.on('settings:open-config', () => { shell.openPath(configFileURL()); });

  shared.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(settingsHTML()));
  return shared;
}

function settingsState(config) {
  return {
    pollMinutes: normalizedPollMinutes(config.pollMinutes),
    pollChoices: POLL_CHOICES,
    sources: TOGGLEABLE_SOURCES.map(({ id, title }) => ({ id, title, enabled: isSourceEnabled(config, id) })),
    keys: KEY_FIELDS.map(({ id, title, tooltip }) => ({
      id, title, tooltip, value: maskedKey(keyValue(config, id)),
    })),
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
      const poll = document.getElementById('poll');
      const choices = state.pollChoices.includes(state.pollMinutes)
        ? state.pollChoices : [...state.pollChoices, state.pollMinutes].sort((a, b) => a - b);
      poll.innerHTML = choices.map((m) =>
        '<option value="' + m + '"' + (m === state.pollMinutes ? ' selected' : '') + '>' + m + '</option>').join('');
      poll.onchange = () => window.quotabar.setPoll(Number(poll.value));
      document.getElementById('sources').innerHTML = state.sources.map((s) =>
        '<label><input type="checkbox" data-id="' + s.id + '"' + (s.enabled ? ' checked' : '') + '> ' + s.title + '</label>').join('');
      for (const box of document.querySelectorAll('input[type=checkbox]')) {
        box.onchange = () => window.quotabar.setSource(box.dataset.id, box.checked);
      }
      // Key fields hold the masked value until focused; focusing clears the
      // field for a fresh paste, blurring empty restores the old mask.
      document.getElementById('keys').innerHTML = state.keys.map((k) =>
        '<div class="keyrow"><label for="key-' + k.id + '">' + k.title + '</label>' +
        '<input id="key-' + k.id + '" data-id="' + k.id + '" data-masked="1" spellcheck="false" ' +
        'value="' + escapeHTML(k.value) + '" title="' + escapeHTML(k.tooltip) + '"></div>').join('');
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
    });
    document.getElementById('openConfig').onclick = () => window.quotabar.openConfig();
  </script>
</body>
</html>`;
}
