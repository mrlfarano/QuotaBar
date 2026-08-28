// Port of the AppDelegate / status-item controller in main.swift, on the
// Windows tray (Electron Tray + native context menu).
//
// Platform adaptation, stated honestly: Windows tray icons are icon-only —
// there is no text slot next to the glyph like NSStatusItem's attributed
// title. The dual-ring glyph (colors escalate green→yellow→red exactly like
// macOS) carries the state, and the escalating numbers ("41% · 43m", warning
// glyph) live in the tray tooltip, which Windows updates live.

import { app, Tray, Menu, nativeImage, clipboard, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { loadConfig, saveConfig, configFileURL, cacheFileURL } from './core/config.js';
import { runDiscovery } from './core/discovery.js';
import { serializeSnapshot, deserializeSnapshot } from './core/model.js';
import { compactCount, shortReset, resetText, padToWidth, blockBar, normalizedPollMinutes, bandOf, remainingPct } from './core/format.js';
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

const POLL_TICK_MS = 20_000; // macOS: Timer.scheduledTimer(withTimeInterval: 20)
const TOOLTIP_MAX = 128;     // Windows tray tooltip limit

export class QuotaBarApp {
  constructor({ demoMode }) {
    this.demoMode = demoMode;
    this.config = loadConfig();
    this.snapshot = null;
    this.sections = [];
    this.refreshing = false;
    this.tray = null;
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
    this.runLaunchDiscovery();
    this.loadCachedSnapshot();
    this.rebuild('launch');
    this.refreshNow();
    setInterval(() => this.pollTick(), POLL_TICK_MS);
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
    if (this.demoMode) {
      this.demoAdvance();
      this.rebuild('demo-tick');
      return;
    }
    if (!this.snapshot) {
      this.refreshNow();
      return;
    }
    const age = (Date.now() - this.snapshot.fetchedAt.getTime()) / 1000;
    if (age >= normalizedPollMinutes(this.config.pollMinutes) * 60) {
      this.refreshNow();
    }
  }

  demoAdvance() {
    // Sweep upward so all color bands appear over time.
    for (const gauge of this.demoGauges) {
      gauge.pct = gauge.pct >= 100 ? 0 : gauge.pct + 1.5;
      if (gauge.total != null) gauge.used = (gauge.total * gauge.pct) / 100;
      if (gauge.resetAt && gauge.resetAt.getTime() - Date.now() < 120_000) {
        gauge.resetAt = new Date(Date.now() + (gauge.id === 'fiveHour' ? 5 * 3600 : 7 * 86400) * 1000);
      }
    }
    this.snapshot = {
      fetchedAt: new Date(),
      rawJSON: '',
      gauges: this.demoGauges.map((g) => ({ ...g })),
      errorMessage: undefined,
      usedScheme: '',
      planLevel: undefined,
    };
  }

  async refreshNow() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      if (!this.demoMode) this.setTransient('…sync');
      if (this.demoMode) {
        this.sections = [
          { id: 'zai', title: 'Demo data (--demo)', gauges: this.demoGauges.map((g) => ({ ...g })), errorMessage: undefined, notice: undefined },
          { id: 'github', title: 'GitHub API · rate limit (demo)', errorMessage: undefined, notice: undefined,
            gauges: [{ id: 'gh-core', label: 'Core requests', pct: 8, used: 5, total: 60,
                       resetAt: new Date(Date.now() + 40 * 60_000), details: undefined }] },
        ];
        this.applySnapshot({
          fetchedAt: new Date(), rawJSON: '', gauges: this.demoGauges.map((g) => ({ ...g })),
          errorMessage: undefined, usedScheme: '', planLevel: undefined,
        });
        return;
      }

      // async let zaiSnap: started first, the rest run sequentially after it.
      const zaiPromise = fetchZai(this.config);
      const built = [];
      const zai = await zaiPromise;
      let host = this.config.baseURL;
      try { host = new URL(this.config.baseURL).host; } catch { /* keep raw baseURL */ }
      const level = zai.planLevel ? ` (${zai.planLevel})` : '';
      built.push({
        id: 'zai', title: `Z.AI Coding Plan${level} · ${host}`,
        gauges: zai.gauges, errorMessage: zai.errorMessage, notice: undefined,
      });
      const sources = this.config.sources ?? {};
      if (sources.github?.enabled ?? true) {
        built.push(await GitHubSource.fetch(sources.github?.token));
      }
      if (sources.copilot?.enabled ?? false) {
        built.push(await CopilotSource.fetch(sources.copilot));
      }
      if (sources.claude?.enabled ?? false) {
        const { section, tokenUpdate } = await ClaudeSource.fetch(sources.claude);
        if (tokenUpdate) { this.config.sources.claude = tokenUpdate; saveConfig(this.config); }
        built.push(section);
      }
      if (sources.codex?.enabled ?? false) {
        const { section, tokenUpdate } = await CodexSource.fetch(sources.codex);
        if (tokenUpdate) { this.config.sources.codex = tokenUpdate; saveConfig(this.config); }
        built.push(section);
      }
      if (sources.openrouter?.enabled ?? false) {
        built.push(await OpenRouterSource.fetch(sources.openrouter));
      }
      if (sources.antigravity?.enabled ?? false) {
        built.push(await AntigravitySource.fetch());
      }
      for (const custom of sources.custom ?? []) {
        built.push(await fetchCustom(custom));
      }
      this.sections = built;
      this.applySnapshot(zai);
    } finally {
      this.refreshing = false;
    }
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
  updateTray() {
    if (this.demoMode) {
      if (this.snapshot?.gauges.some((g) => g.id === 'fiveHour')) {
        this.applyGlyph(true);
      } else {
        this.setTransient('Z·demo');
      }
      return;
    }
    if (!this.snapshot) { this.setTransient('quotabar…'); return; }
    const message = this.snapshot.errorMessage;
    if (message) {
      const auth = message.includes('token') || message.includes('Unauthorized');
      this.setTransient(auth ? '⚠︎ z.ai auth' : '⚠︎ z.ai');
      return;
    }
    if (!this.snapshot.gauges.some((g) => g.id === 'fiveHour' || g.id === 'week')) {
      this.setTransient('z.ai');
      return;
    }
    this.applyGlyph(false);
  }

  /// Gauges driving the tray: the source selected by config.mainSource
  /// (or "zai" default), falling back to z.ai, then any healthy section.
  statusGauges() {
    const wanted = (this.config.mainSource ?? 'zai').toLowerCase();
    const match = this.sections.find((s) => s.id === wanted && s.gauges.length > 0);
    if (match) return match.gauges;
    const zai = this.sections.find((s) => s.id === 'zai' && s.gauges.length > 0);
    if (zai) return zai.gauges;
    return this.sections.find((s) => s.gauges.length > 0)?.gauges;
  }

  applyGlyph(demo) {
    const gauges = demo ? this.snapshot.gauges : this.statusGauges() ?? this.snapshot.gauges;
    if (gauges.length === 0) { this.setTransient('⚠︎ no data'); return; }
    const primary = gauges[0];
    const secondary = gauges.length > 1 ? gauges[1] : null;

    // Dual-ring glyph: outer = primary (5h), inner = weekly, colors escalate.
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

    let tip = 'Z.AI Coding Plan';
    for (const gauge of gauges) {
      tip += `\n${gauge.label}: ${Math.round(gauge.pct)}% used`;
      if (gauge.used != null && gauge.total != null) {
        tip += ` (${compactCount(gauge.used)}/${compactCount(gauge.total)} tokens)`;
      }
      const reset = resetText(gauge.resetAt);
      if (reset) tip += ` · ${reset}`;
    }
    this.tray.setToolTip(tip.length > TOOLTIP_MAX ? tip.slice(0, TOOLTIP_MAX - 1) + '…' : tip);
  }

  /// Full-strength state for transient/error states (macOS swaps the text;
  /// Windows swaps in a muted empty glyph and explains in the tooltip).
  setTransient(text) {
    this.tray.setImage(stateIcon());
    this.tray.setToolTip(text);
  }

  // MARK: menu

  /// Recompute every menu row from current state. Called on updates; the
  /// tray's context menu is replaced wholesale (safe while closed).
  rebuild(reason) {
    this.updateTray();
    this.tray.setContextMenu(this.buildMenu());
  }

  buildMenu() {
    const items = [];
    const disabled = (label) => ({ label, enabled: false });
    const templateAdd = (item) => items.push(item);

    if (this.sections.length === 0) {
      templateAdd(disabled('No data yet'));
    }
    for (const section of this.sections) {
      templateAdd(disabled(section.title));
      if (section.errorMessage) {
        templateAdd(disabled(`⚠︎ ${section.errorMessage}`));
      } else if (section.gauges.length === 0) {
        templateAdd(disabled('Waiting for data'));
      }
      if (section.notice) {
        templateAdd(disabled(section.notice));
      }
      for (const gauge of section.gauges) {
        const band = bandOf(remainingPct(gauge.pct));
        const icon = nativeImage.createEmpty();
        icon.addRepresentation({ scaleFactor: 1, buffer: gaugeRingPNG({ size: 16, pct: gauge.pct, band }) });
        icon.addRepresentation({ scaleFactor: 2, buffer: gaugeRingPNG({ size: 32, pct: gauge.pct, band }) });
        templateAdd({
          icon,
          label: `${padToWidth(gauge.label, 13)}  ${blockBar(gauge.pct)}  ${Math.round(gauge.pct)}% used · ${Math.round(remainingPct(gauge.pct))}% left`,
          enabled: false,
        });

        let detail = '';
        if (gauge.used != null && gauge.total != null && gauge.total > 0) {
          const unit = gauge.id.startsWith('gh') ? 'requests' : 'tokens';
          detail = `${compactCount(gauge.used)} / ${compactCount(gauge.total)} ${unit}`;
        }
        const reset = resetText(gauge.resetAt);
        if (reset) detail += detail === '' ? '' : ' · ' + reset;
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
        const name = this.sections.find((s) => s.id === id)?.title ?? id;
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
    this.config.mainSource = id;
    saveConfig(this.config);
    this.rebuild('main-source');
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
    await dialog.showMessageBox({
      type: 'info',
      title: 'Source discovery',
      message: 'Source discovery',
      detail: outcome.lines.join('\n'),
    });
  }

  openSettings() {
    openSettingsWindow({
      config: this.config,
      onRefresh: (config) => { this.config = config; },
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
