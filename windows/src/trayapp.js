// Port of the AppDelegate / status-item controller in main.swift, on the
// Windows tray (Electron Tray + native context menu).
//
// Platform adaptation, stated honestly: Windows tray icons are icon-only —
// there is no text slot next to the glyph like NSStatusItem's attributed
// title. The dual-ring glyph (colors escalate green→yellow→red exactly like
// macOS) carries the state, and the escalating numbers ("41% · 43m", warning
// glyph) live in the tray tooltip, which Windows updates live.

import { app, Tray, Menu, nativeImage, clipboard } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { loadConfig, saveConfig, configFileURL, cacheFileURL } from './core/config.js';
import { runDiscovery } from './core/discovery.js';
import { serializeSnapshot, deserializeSnapshot } from './core/model.js';
import { compactCount, resetText, padToWidth, blockBar, normalizedPollMinutes, bandOf, remainingPct, menuClamp, gaugeLabelWidth, tooltipText } from './core/format.js';
import { resolve, RefreshCoordinator } from './core/statusdisplay.js';
import { dualRingPNG, gaugeRingPNG } from './ringicon.js';
import { fetchSnapshot as fetchZai } from './core/sources/zai.js';
import * as GitHubSource from './core/sources/github.js';
import * as CopilotSource from './core/sources/copilot.js';
import * as ClaudeSource from './core/sources/claude.js';
import * as CodexSource from './core/sources/codex.js';
import * as OpenRouterSource from './core/sources/openrouter.js';
import * as AntigravitySource from './core/sources/antigravity.js';
import { fetchCustom } from './core/sources/custom.js';
import { openSettingsWindow } from './settingswindow.js';
import { isSourceEnabled } from './core/settings.js';
import { isLoginEnabled, setLoginEnabled } from './loginitem.js';
import { openUsagePanel } from './usagewindow.js';
import { applyReading, cachedReadings, defaultPreferences, loadPreferences, paused, quotaAlert, readWindowsFile, validatePreferences, writeWindowsFile } from './core/windowsstate.js';

const TOOLTIP_MAX = 128;     // Windows tray tooltip limit
const BUILTIN_IDS = ['zai', 'github', 'copilot', 'claude', 'codex', 'openrouter', 'antigravity'];
const customId = source => BUILTIN_IDS.includes(source.id.toLowerCase()) ? `custom:${source.id.toLowerCase()}` : source.id.toLowerCase();

export class QuotaBarApp {
  constructor({ demoMode }) {
    this.demoMode = demoMode;
    this.config = loadConfig();
    this.snapshot = null;
    this.sections = [];
    this.refreshGate = new RefreshCoordinator();
    this.tray = null;
    this.preferences = demoMode ? defaultPreferences() : loadPreferences();
    if (demoMode) this.config.mainSource = 'codex';
    this.readings = new Map();
    this.lastRefreshAt = 0;
    this.pendingRefresh = new Set();
    this.lastAlertReading = null;
    this.panel = null;
    this.stateVersion = 0;
    app.quotabarInstance = this; // exposed for the --settings dev flag
    this.demoGauges = [
      { id: 'fiveHour', label: '5-hour window', pct: 24, used: 28_800, total: 120_000,
        resetAt: new Date(Date.now() + (2 * 3600 + 47 * 60) * 1000), details: undefined },
      { id: 'week', label: 'Weekly limit', pct: 58, used: 34_800, total: 60_000,
        resetAt: new Date(Date.now() + (4 * 86400 + 3 * 3600) * 1000), details: undefined },
      { id: 'mcp', label: 'MCP monthly', pct: 3, used: 139, total: 4_000,
        resetAt: new Date(Date.now() + 9 * 86400 * 1000), details: undefined },
    ];
  }

  start() {
    // Created after app ready — mirrors the macOS comment about accessory
    // activation policy needing to be applied first.
    this.tray = new Tray(stateIcon(null));
    this.loadCachedSnapshot();
    if (!this.demoMode) this.readings = new Map(cachedReadings(readWindowsFile('windows-readings.json')).map(p => [p.id, p]));
    this.tray.on('click', () => this.openPanel());
    this.tray.on('right-click', () => this.tray.popUpContextMenu(this.buildMenu()));
    this.rebuild('launch');
    if (!this.demoMode) this.runLaunchDiscovery();
    if (!paused(this.preferences) && !this.preferences.manual) this.refreshNow();
    this.schedulePoll();
  }

  // MARK: discovery

  /// Enable sources whose CLI credentials exist on disk, before first fetch.
  runLaunchDiscovery() {
    const { config, outcome } = runDiscovery(this.config);
    if (!outcome.changed) return;
    this.config = config;
    saveConfig(this.config);
  }

  // MARK: polling

  pollTick() {
    if (this.demoMode || paused(this.preferences) || this.preferences.manual) return;
    const age = (Date.now() - this.lastRefreshAt) / 1000;
    if (age >= normalizedPollMinutes(this.config.pollMinutes) * 60) {
      this.refreshNow();
    }
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (this.demoMode || this.refreshGate.running || this.preferences.pauseUntil === -1 || this.preferences.manual) return;
    const due = Math.max(this.lastRefreshAt + normalizedPollMinutes(this.config.pollMinutes) * 60_000, this.preferences.pauseUntil);
    this.pollTimer = setTimeout(() => { this.pollTick(); this.schedulePoll(); }, Math.max(1000, due - Date.now()));
    this.pollTimer.unref();
  }

  async refreshNow(target = null) {
    // Coalesce like the macOS RefreshCoordinator: a request landing
    // mid-flight re-runs once when the flight ends, instead of being
    // silently dropped until the next poll.
    if (!this.refreshGate.begin()) {
      for (const id of target == null ? ['*'] : Array.isArray(target) ? target : [target]) this.pendingRefresh.add(id);
      return;
    }
    const targets = target == null ? null : new Set(Array.isArray(target) ? target : [target]);
    try {
      if (this.demoMode) {
        this.sections = [
          { id: 'zai', title: 'Demo data (--demo)', gauges: this.demoGauges.map((g) => ({ ...g })), errorMessage: undefined, notice: undefined },
          { id: 'github', title: 'GitHub API · rate limit (demo)', errorMessage: undefined, notice: undefined,
            gauges: [{ id: 'gh-core', label: 'Core requests', pct: 8, used: 5, total: 60,
                       resetAt: new Date(Date.now() + 40 * 60_000), details: undefined }] },
        ];
        this.sections.push(
          { id: 'codex', title: 'Codex', gauges: [{ id: 'codex-weekly', label: 'Weekly', pct: 58, resetAt: new Date(Date.now() + 76 * 3600000) }] },
          { id: 'claude', title: 'Claude', gauges: [{ id: 'claude-5h', label: '5-hour', pct: 24, resetAt: new Date(Date.now() + 167 * 60000) }, { id: 'claude-weekly', label: 'Weekly', pct: 12, resetAt: new Date(Date.now() + 99 * 3600000) }] },
        );
        for (const section of this.sections) this.readings.set(section.id, applyReading(this.readings.get(section.id), section));
        this.applySnapshot({
          fetchedAt: new Date(), rawJSON: '', gauges: this.demoGauges.map((g) => ({ ...g })),
          errorMessage: undefined, usedScheme: '', planLevel: undefined,
        });
        return;
      }

      // Z.AI leads when enabled (parity with main.swift's refresh); disabled
      // means no zai section and no snapshot write — the cache, the Updated
      // row, and the healthy-fallback resolution keep working.
      const enabled = this.enabledIds();
      this.sections = this.sections.filter(s => enabled.includes(s.id));
      for (const id of enabled) {
        if (targets && !targets.has(id)) continue;
        let section;
        try { section = await this.fetchProvider(id); }
        catch { section = { id, title: id, gauges: [], errorMessage: 'Provider request failed' }; }
        if (!this.enabledIds().includes(id)) continue;
        this.sections = [...this.sections.filter(s => s.id !== id), section];
        this.sections.sort((a, b) => enabled.indexOf(a.id) - enabled.indexOf(b.id));
        this.readings.set(id, applyReading(this.readings.get(id), section));
        this.checkAlerts(id);
        this.rebuild('provider');
      }
    } finally {
      if (!targets) this.lastRefreshAt = Date.now();
      if (!this.demoMode) {
        try { writeWindowsFile('windows-readings.json', { version: 1, providers: [...this.readings.values()] }); } catch { /* Cache is optional. */ }
      }
      const rerun = this.refreshGate.end();
      this.rebuild('applied');
      this.schedulePoll();
      if (rerun) {
        const pending = [...this.pendingRefresh];
        this.pendingRefresh.clear();
        this.refreshNow(pending.includes('*') || !pending.length ? null : pending);
      }
    }
  }

  enabledIds() {
    return BUILTIN_IDS.filter(id => isSourceEnabled(this.config, id))
      .concat((this.config.sources?.custom ?? []).map(customId));
  }

  async fetchProvider(id) {
    const custom = this.config.sources?.custom?.find(s => customId(s) === id);
    if (custom) return { ...await fetchCustom(custom), id };
    const source = this.config.sources?.[id];
    if (id === 'zai') {
      const snap = await fetchZai(this.config);
      this.snapshot = snap;
      this.saveCachedSnapshot(snap);
      if (!snap.errorMessage && snap.gauges.length && snap.usedScheme !== this.config.authScheme) {
        this.config.authScheme = snap.usedScheme;
        saveConfig(this.config);
      }
      return { id, title: 'Z.AI Coding Plan', gauges: snap.gauges, errorMessage: snap.errorMessage };
    }
    if (id === 'github') return GitHubSource.fetch(source?.token);
    if (id === 'copilot') return CopilotSource.fetch(source);
    if (id === 'openrouter') return OpenRouterSource.fetch(source);
    if (id === 'antigravity') return AntigravitySource.fetch();
    if (id === 'claude' || id === 'codex') {
      const { section, tokenUpdate } = await (id === 'claude' ? ClaudeSource : CodexSource).fetch(source);
      if (tokenUpdate && this.config.sources?.[id] === source) { this.config.sources[id] = tokenUpdate; saveConfig(this.config); }
      return section;
    }
    throw new Error('Unknown provider');
  }

  checkAlerts(id) {
    if (id !== (this.config.mainSource ?? 'zai') || this.demoMode) return;
    const reading = this.readings.get(id);
    if (reading.status !== 'Connected') return;
    const gauge = reading.gauges.find(g => g.id === this.preferences.watched[id]) ?? reading.gauges[0];
    if (!gauge) return;
    const current = { key: `${id}:${gauge.id}`, left: 100 - gauge.pct, resetAt: gauge.resetAt };
    const previous = this.lastAlertReading;
    const events = quotaAlert(previous, current, this.preferences);
    current.alertedReset = events.includes('low') ? current.resetAt : previous?.key === current.key ? previous.alertedReset : undefined;
    this.lastAlertReading = current;
    for (const event of events) this.tray?.displayBalloon({ title: `${reading.name} · ${gauge.label}`, content: event === 'low' ? `${Math.round(current.left)}% quota remaining.` : 'Quota is available again.', iconType: 'info', respectQuietTime: true });
  }

  applySnapshot(snap) {
    this.snapshot = snap;
    this.saveCachedSnapshot(snap);
    // Remember whichever Authorization style the server accepted.
    if (snap.errorMessage == null && snap.gauges.length > 0 && this.config.authScheme !== snap.usedScheme) {
      this.config.authScheme = snap.usedScheme;
      saveConfig(this.config);
    }
    this.rebuild('applied');
  }

  // MARK: cache

  saveCachedSnapshot(snap) {
    if (this.demoMode) return;
    try {
      fs.mkdirSync(path.dirname(cacheFileURL()), { recursive: true });
      fs.writeFileSync(cacheFileURL(), serializeSnapshot(snap), 'utf8');
    } catch {
      // cache write failures are non-fatal
    }
  }

  loadCachedSnapshot() {
    if (this.demoMode) return;
    try {
      this.snapshot = deserializeSnapshot(fs.readFileSync(cacheFileURL(), 'utf8'));
    } catch {
      this.snapshot = null;
    }
  }

  // MARK: tray rendering

  /// Paint the tray: concentric dual-ring glyph + tooltip (green = countdown
  /// only; yellow/red escalate — numbers land in the tooltip on Windows).
  /// What shows is decided by resolve(): the selected source, falling
  /// through to a healthy provider, a short error when nothing is healthy,
  /// or idle text at startup (the macOS StatusDisplayResolver rules).
  updateTray() {
    const display = resolve(this.sections, isSourceEnabled(this.config, 'zai') ? this.snapshot : null, this.config.mainSource);
    if (display.kind === 'gauges') {
      const section = this.sections.find(s => s.gauges === display.gauges);
      const watched = this.preferences.watched[section?.id];
      const gauges = [...display.gauges].sort((a, b) => Number(b.id === watched) - Number(a.id === watched));
      this.applyGlyph(gauges, display.title);
    } else {
      this.setTransient(display.text);
    }
  }

  applyGlyph(gauges, title = undefined) {
    if (gauges.length === 0) { this.setTransient('⚠︎ no data'); return; }
    const primary = gauges[0];
    const secondary = gauges.length > 1 ? gauges[1] : null;

    // Outer = first available window, inner = second (when present).
    const imageKey = JSON.stringify([primary.pct, secondary?.pct]);
    if (this.imageKey !== imageKey) {
      const icon = nativeImage.createEmpty();
      icon.addRepresentation({ scaleFactor: 1, buffer: dualRingPNG({
        size: 16,
        fiveRemaining: remainingPct(primary.pct), fiveBand: bandOf(remainingPct(primary.pct)),
        weekRemaining: secondary != null ? remainingPct(secondary.pct) : null,
        weekBand: secondary != null ? bandOf(remainingPct(secondary.pct)) : null,
      }) });
      icon.addRepresentation({ scaleFactor: 2, buffer: dualRingPNG({
        size: 32,
        fiveRemaining: remainingPct(primary.pct), fiveBand: bandOf(remainingPct(primary.pct)),
        weekRemaining: secondary != null ? remainingPct(secondary.pct) : null,
        weekBand: secondary != null ? bandOf(remainingPct(secondary.pct)) : null,
      }) });
      this.tray.setImage(icon);
      this.imageKey = imageKey;
    }

    // The driving source names the tooltip (warm-start cache has no title;
    // it is always z.ai's snapshot), then legend, escalation, per-gauge
    // lines — truncated to Windows' 128-char tooltip budget.
    const fullTip = (paused(this.preferences) ? 'Paused · ' : this.preferences.manual ? 'Manual · ' : '') + tooltipText({ title: title ?? 'Z.AI Coding Plan', gauges });
    this.tray.setToolTip(fullTip.length > TOOLTIP_MAX ? fullTip.slice(0, TOOLTIP_MAX - 1) + '…' : fullTip);
  }

  /// Full-strength state for transient/error states (macOS swaps the text;
  /// Windows swaps in a muted empty glyph and explains in the tooltip).
  setTransient(text) {
    if (this.imageKey !== 'empty') this.tray.setImage(stateIcon());
    this.imageKey = 'empty';
    this.tray.setToolTip(text);
  }

  // MARK: menu

  /// Update visible state. Build the native menu only when requested.
  rebuild(reason) {
    if (this.tray) this.updateTray();
    if (this.panel && !this.panel.isDestroyed()) this.panel.webContents.send('usage:state', this.panelState());
  }

  buildMenu() {
    const items = [];
    const disabled = (label) => ({ label, enabled: false });
    const templateAdd = (item) => items.push(item);

    if (this.sections.length === 0) {
      templateAdd(disabled('No data yet'));
    }
    // Longest gauge label across sections, so every bar row aligns even
    // with verbose custom-source labels (floor: the original 13).
    const labelWidth = gaugeLabelWidth(this.sections);
    for (const section of this.sections) {
      templateAdd(disabled(menuClamp(section.title)));
      if (section.errorMessage) {
        templateAdd(disabled(`⚠︎ ${menuClamp(section.errorMessage)}`));
      } else if (section.gauges.length === 0) {
        templateAdd(disabled('Waiting for data'));
      }
      if (section.notice) {
        templateAdd(disabled(menuClamp(section.notice)));
      }
      for (const gauge of section.gauges) {
        const band = bandOf(remainingPct(gauge.pct));
        const icon = nativeImage.createEmpty();
        icon.addRepresentation({ scaleFactor: 1, buffer: gaugeRingPNG({ size: 16, pct: gauge.pct, band }) });
        icon.addRepresentation({ scaleFactor: 2, buffer: gaugeRingPNG({ size: 32, pct: gauge.pct, band }) });
        templateAdd({
          icon,
          label: `${padToWidth(gauge.label, labelWidth)}  ${blockBar(gauge.pct)}  ${Math.round(gauge.pct)}% used · ${Math.round(remainingPct(gauge.pct))}% left`,
          enabled: false,
        });

        let detail = '';
        if (gauge.used != null && gauge.total != null && gauge.total > 0) {
          const unit = gauge.id.startsWith('gh') ? 'requests' : 'tokens';
          detail = `${compactCount(gauge.used)} / ${compactCount(gauge.total)} ${unit}`;
        }
        const reset = resetText(gauge.resetAt);
        if (reset) detail += detail === '' ? reset : ' · ' + reset;
        if (detail !== '') templateAdd(disabled(`    ${detail}`));
      }
      templateAdd({ type: 'separator' });
    }
    if (this.snapshot) {
      templateAdd(disabled(this.updatedRowText()));
    }

    // Status-bar source picker: every section that currently has data.
    const healthyIds = this.sections.filter((s) => s.gauges.length > 0).map((s) => s.id);
    if (healthyIds.length > 1) {
      templateAdd(disabled('Status Bar Source:'));
      const active = (this.config.mainSource ?? 'zai').toLowerCase();
      for (const id of healthyIds) {
        const name = menuClamp(this.sections.find((s) => s.id === id)?.title ?? id, 36);
        templateAdd({
          label: name,
          type: 'checkbox',
          checked: id === active,
          click: () => this.selectMainSource(id),
        });
      }
      templateAdd({ type: 'separator' });
    }

    templateAdd({ label: 'Refresh Now', accelerator: 'CmdOrCtrl+R', click: () => this.refreshNow() });

    if (!this.demoMode && this.snapshot && this.snapshot.rawJSON !== '') {
      templateAdd({ label: 'Copy Raw Response', click: () => this.copyRaw() });
    }

    if (!this.demoMode) {
      templateAdd({ label: 'Discover Sources', accelerator: 'CmdOrCtrl+D', click: () => this.discoverSources() });
      templateAdd({ label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => this.openSettings() });
    }

    templateAdd({ type: 'separator' });
    templateAdd(disabled(versionRow()));
    templateAdd({ label: 'Quit QuotaBar', accelerator: 'CmdOrCtrl+Q', role: 'quit' });
    return Menu.buildFromTemplate(items);
  }

  updatedRowText() {
    if (!this.snapshot) return 'No data yet';
    const time = this.snapshot.fetchedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const age = Math.trunc((Date.now() - this.snapshot.fetchedAt.getTime()) / 60_000);
    const ageText = age <= 0 ? 'just now' : `${age}m ago`;
    return `Updated ${time} (${ageText}), poll ${normalizedPollMinutes(this.config.pollMinutes)}m`;
  }

  // MARK: actions

  selectMainSource(id) {
    const updated = { ...this.config, mainSource: id };
    if (!this.demoMode && !saveConfig(updated)) throw new Error('Could not save tray selection.');
    this.config = updated;
    this.lastAlertReading = null;
    this.rebuild('main-source');
  }

  panelState() {
    const enabled = this.demoMode ? this.sections.map(s => s.id) : this.enabledIds();
    const providers = enabled.map(id => this.readings.get(id) ?? { id, name: id, gauges: [], status: 'Waiting', lastSuccess: null });
    const now = Date.now();
    const staleAfter = normalizedPollMinutes(this.config.pollMinutes) * 120000;
    return {
      revision: ++this.stateVersion,
      providers: providers.map(p => ({ ...p, stale: p.status !== 'Connected' || paused(this.preferences, now) || now - p.lastSuccess > staleAfter })),
      pinned: this.config.mainSource ?? (this.demoMode ? 'codex' : 'zai'), preferences: this.preferences,
      pollMinutes: normalizedPollMinutes(this.config.pollMinutes), refreshing: this.refreshGate.running, demo: this.demoMode, login: isLoginEnabled(app),
    };
  }

  openPanel() {
    if (this.panel && !this.panel.isDestroyed()) { this.panel.close(); return; }
    this.panel = openUsagePanel({ tray: this.tray, getState: () => this.panelState(), command: command => this.panelCommand(command) });
    this.panel.on('closed', () => { this.panel = null; });
    return this.panel;
  }

  async panelCommand(command) {
    if (!command || typeof command !== 'object') throw new Error('Invalid command');
    const { action, id } = command;
    const provider = this.panelState().providers.find(p => p.id === id);
    if (['pin', 'watch', 'refresh-provider'].includes(action) && !provider) throw new Error('Provider is not enabled');
    if (action === 'refresh' || action === 'refresh-provider') {
      this.refreshNow(action === 'refresh' ? null : id);
    } else if (action === 'pin') {
      this.selectMainSource(id);
    } else if (action === 'watch') {
      if (!provider.gauges.some(g => g.id === command.gauge)) throw new Error('Unknown quota');
      const preferences = validatePreferences({ ...this.preferences, watched: { ...this.preferences.watched, [id]: command.gauge } });
      if (!this.demoMode) writeWindowsFile('windows-preferences.json', preferences);
      this.preferences = preferences;
      this.selectMainSource(id);
    } else if (action === 'preferences') {
      const patch = command.patch;
      if (!patch || typeof patch !== 'object' || Object.keys(patch).some(key => !['lowAlert', 'recoveryAlert', 'threshold', 'manual'].includes(key))) throw new Error('Invalid preferences');
      const preferences = validatePreferences({ ...this.preferences, ...patch });
      if (!this.demoMode) writeWindowsFile('windows-preferences.json', preferences);
      this.preferences = preferences;
      this.lastAlertReading = null;
    } else if (action === 'pause') {
      if (!['hour', 'until-resume', 'resume'].includes(command.mode)) throw new Error('Invalid pause');
      const preferences = { ...this.preferences, pauseUntil: command.mode === 'hour' ? Date.now() + 3600000 : command.mode === 'until-resume' ? -1 : 0 };
      if (!this.demoMode) writeWindowsFile('windows-preferences.json', preferences);
      this.preferences = preferences;
    } else if (action === 'poll') {
      if (![1, 2, 5, 10, 15, 30, 60].includes(command.minutes)) throw new Error('Invalid refresh interval');
      const updated = { ...this.config, pollMinutes: command.minutes };
      if (!this.demoMode && !saveConfig(updated)) throw new Error('Could not save update frequency');
      this.config = updated;
    } else if (action === 'login') {
      if (typeof command.enabled !== 'boolean') throw new Error('Invalid login preference');
      if (this.demoMode) throw new Error('Start at login is unavailable in demo mode.');
      setLoginEnabled(app, command.enabled);
    } else if (action === 'settings') {
      if (this.demoMode) throw new Error('Credential settings are unavailable in demo mode.');
      this.panel?.close();
      this.openSettings();
    } else if (action === 'discover') {
      if (!this.demoMode) await this.discoverSources();
    } else throw new Error('Unknown action');
    this.schedulePoll();
    this.rebuild('panel');
    return this.panelState();
  }

  copyRaw() {
    const text = this.snapshot && this.snapshot.rawJSON !== ''
      ? this.snapshot.rawJSON
      : this.snapshot?.errorMessage ?? '';
    clipboard.writeText(text);
  }

  async discoverSources() {
    const { config, outcome } = runDiscovery(this.config);
    if (outcome.changed) {
      this.config = config;
      saveConfig(this.config);
      this.rebuild('discovered');
    }
    await this.refreshNow();
  }

  openSettings() {
    openSettingsWindow({
      getConfig: () => this.config,
      getSections: () => this.sections,
      onApply: (config) => {
        this.config = config;
        this.rebuild('settings');
        this.refreshNow();
      },
    });
  }
}

function versionRow() {
  return versionLabelOf(app.getVersion());
}

function versionLabelOf(version) {
  return typeof version === 'string' && version !== '' ? `QuotaBar v${version}` : 'QuotaBar (dev build)';
}

/// Muted empty glyph for transient states (macOS shows text instead; Windows
/// has no tray text slot).
function stateIcon() {
  const icon = nativeImage.createEmpty();
  icon.addRepresentation({ scaleFactor: 1, buffer: dualRingPNG({ size: 16, fiveRemaining: 0, fiveBand: 'green', weekRemaining: null, weekBand: null }) });
  icon.addRepresentation({ scaleFactor: 2, buffer: dualRingPNG({ size: 32, fiveRemaining: 0, fiveBand: 'green', weekRemaining: null, weekBand: null }) });
  return icon;
}
