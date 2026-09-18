// Pure logic behind the Settings window (port of the unit-tested statics in
// SettingsWindowController.swift). Functions are copy-on-write: the passed
// config is never mutated, matching Swift value semantics.

import { defaultConfig } from './config.js';
import { normalizedPollMinutes } from './format.js';

export const POLL_CHOICES = [1, 2, 5, 10, 15, 30];

export const TOGGLEABLE_SOURCES = [
  { id: 'zai', title: 'Z.AI Coding Plan' },
  { id: 'github', title: 'GitHub API' },
  { id: 'claude', title: 'Claude Pro/Max' },
  { id: 'codex', title: 'Codex / ChatGPT' },
  { id: 'openrouter', title: 'OpenRouter' },
  { id: 'copilot', title: 'GitHub Copilot' },
  { id: 'antigravity', title: 'Antigravity' },
];

/// Common keys shown at the top of Settings; OAuth credentials and custom
/// sources are also editable in the advanced section.
export const KEY_FIELDS = [
  { id: 'zai', title: 'Z.AI',
    tooltip: 'Discover Sources scans browser localStorage for the z.ai token '
      + 'first — pasting here is the fallback: z.ai → usage page → DevTools → '
      + 'Application → Local Storage → "z-ai-open-platform-token-production". '
      + 'Stored in ~/.quotabar/config.json (owner-only).' },
  { id: 'github', title: 'GitHub',
    tooltip: 'Optional personal-access token; raises the core rate limit from 60/hr to 5,000/hr.' },
  { id: 'openrouter', title: 'OpenRouter',
    tooltip: 'OpenRouter API key (sk-or-…).' },
  { id: 'copilot', title: 'Copilot',
    tooltip: 'GitHub Copilot OAuth token (ghu_…). Usually auto-discovered from '
      + 'editor/opencode sign-ins — a pasted token takes priority.' },
];

/// Stars for everything but the last 5 characters, so a stored key is
/// recognizable without being readable. The star count is fixed — the mask
/// must not leak the key's length.
export function maskedKey(key) {
  const trimmed = String(key ?? '').trim();
  if (trimmed.length <= 5) return '*'.repeat(trimmed.length);
  return '*'.repeat(8) + trimmed.slice(-5);
}

/// Stored value behind a key field ('' when unset).
export function keyValue(config, id) {
  switch (id) {
    case 'zai': return config.zaiToken ?? '';
    case 'github': return config.sources?.github?.token ?? '';
    case 'openrouter': return config.sources?.openrouter?.token ?? '';
    case 'copilot': return config.sources?.copilot?.token ?? '';
    default: return '';
  }
}

/// Store one key. Z.AI also drops the remembered auth scheme so the next
/// fetch re-probes header styles. Source objects are created on demand —
/// pasting a key reads as intent to use the source, so a fresh object
/// carries the enabled-by-default state; an existing one keeps its `enabled`
/// flag and other credentials untouched.
export function setKey(config, id, key) {
  const result = { ...defaultConfig(), ...config, sources: { ...(config?.sources ?? {}) } };
  switch (id) {
    case 'zai':
      result.zaiToken = key;
      result.authScheme = undefined;
      // Pasting a key reads as intent to use the source (parity with the
      // macOS key entry): create the enabled entry when absent, but never
      // disturb an explicit opt-out.
      if (!result.sources.zai) {
        result.sources.zai = { enabled: true, token: '', refreshToken: undefined, accountId: undefined, discovered: false };
      }
      break;
    case 'github':
      result.sources.github = {
        enabled: result.sources.github?.enabled ?? true,
        token: key,
        discovered: result.sources.github?.discovered,
      };
      break;
    case 'openrouter':
      result.sources.openrouter = {
        enabled: result.sources.openrouter?.enabled ?? true,
        token: key,
        refreshToken: result.sources.openrouter?.refreshToken,
        accountId: result.sources.openrouter?.accountId,
        discovered: result.sources.openrouter?.discovered ?? false,
      };
      break;
    case 'copilot':
      result.sources.copilot = {
        enabled: result.sources.copilot?.enabled ?? true,
        token: key,
        refreshToken: result.sources.copilot?.refreshToken,
        accountId: result.sources.copilot?.accountId,
        discovered: result.sources.copilot?.discovered ?? false,
      };
      break;
    default: break;
  }
  return result;
}

/// One-line status beside a source's checkbox (port of
/// SettingsLogic.sourceStatus). Calm by design: disabled and healthy
/// sources show nothing; only problems and pending first fetches speak up.
export function sourceStatus(id, config, sections) {
  if (!isSourceEnabled(config, id)) return undefined;
  const section = sections.find((s) => s.id === id);
  if (!section) return 'waiting for first fetch';
  if (section.errorMessage) return `⚠︎ ${shortStatus(section.errorMessage)}`;
  if (section.gauges.length === 0) {
    if (section.notice) return shortStatus(section.notice);
    return 'waiting for data';
  }
  return undefined;
}

/// First line of a message, capped with an ellipsis — long errors must not
/// widen the settings block (port of SettingsLogic.shortStatus).
export function shortStatus(message, max = 40) {
  const first = String(message ?? '').split(/\r\n|\n|\r/)[0] ?? '';
  const trimmed = first.trim();
  if ([...trimmed].length <= max) return trimmed;
  return [...trimmed].slice(0, max - 1).join('').trim() + '…';
}

/// Mirrors the fetch gates in the app controller: Z.AI and GitHub poll unless
/// explicitly disabled; OAuth-backed sources only poll when explicitly enabled.
export function isSourceEnabled(config, id) {
  const sources = config?.sources ?? {};
  switch (id) {
    case 'zai': return sources.zai?.enabled ?? true;
    case 'github': return sources.github?.enabled ?? true;
    case 'claude': return sources.claude?.enabled ?? false;
    case 'codex': return sources.codex?.enabled ?? false;
    case 'openrouter': return sources.openrouter?.enabled ?? false;
    case 'copilot': return sources.copilot?.enabled ?? false;
    case 'antigravity': return sources.antigravity?.enabled ?? false;
    default: return false;
  }
}

/// Toggle one source without disturbing its stored credentials or discovery
/// state (mutates only `enabled`, creating the object if needed).
export function setSourceEnabled(config, id, enabled) {
  const result = { ...defaultConfig(), ...config, sources: { ...(config?.sources ?? {}) } };
  const oauth = (current) => ({
    enabled,
    token: current?.token ?? '',
    refreshToken: current?.refreshToken,
    accountId: current?.accountId,
    discovered: current?.discovered ?? false,
  });
  switch (id) {
    case 'zai': result.sources.zai = oauth(result.sources.zai); break;
    case 'github':
      result.sources.github = {
        enabled,
        token: result.sources.github?.token ?? '',
        discovered: result.sources.github?.discovered,
      };
      break;
    case 'claude': result.sources.claude = oauth(result.sources.claude); break;
    case 'codex': result.sources.codex = oauth(result.sources.codex); break;
    case 'openrouter': result.sources.openrouter = oauth(result.sources.openrouter); break;
    case 'copilot': result.sources.copilot = oauth(result.sources.copilot); break;
    case 'antigravity': result.sources.antigravity = oauth(result.sources.antigravity); break;
    default: break;
  }
  return result;
}

export { normalizedPollMinutes };
