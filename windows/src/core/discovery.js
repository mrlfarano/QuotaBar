// Port of Discovery.swift — credential auto-discovery.
//
// Rules (unchanged):
//   • A source with `enabled == false` is never touched (explicit opt-out).
//   • A user-set token is never overwritten.
//   • Discovered entries store no secret when the source can read the CLI's
//     own auth file live (Claude, Codex) — the file stays the fresher copy.
//   • `discovered` marks entries the scan created.
// Windows adaptation: candidate paths include the Windows locations of
// opencode / VS Code Copilot / Antigravity alongside the literal
// home-relative ones; first existing candidate wins.

import { readJSONCandidates, fileExists } from './credfiles.js';
import { defaultConfig } from './config.js';
import { hasStoredCredential } from './sources/copilot.js';
import * as ZaiToken from './zaitoken.js';

const CLAUDE_FILE = ['~/.claude/.credentials.json'];
const CODEX_FILE = ['~/.codex/auth.json'];
const ANTIGRAVITY_DIRS = [
  '~/Library/Application Support/Antigravity',
  '%APPDATA%/Antigravity',
  '%LOCALAPPDATA%/Antigravity',
];

export function runDiscovery(inputConfig, env = process.env, deps = {}) {
  // Scanners are injectable so tests can pin the zai branch deterministically.
  const findZaiToken = deps.findZaiToken ?? (() => ZaiToken.findToken());
  const bridgeToken = deps.bridgeToken ?? (() => ZaiToken.claudeBridgeToken());
  const config = { ...defaultConfig(), ...inputConfig, sources: { ...inputConfig?.sources } };
  const outcome = { changed: false, lines: [] };

  // Z.AI — first-class: the dashboard token lives in browser localStorage
  // (see zaitoken.js). Only fills an empty slot; a user-set token is never
  // overwritten (the on/off toggle gates fetching, not discovery).
  if ((config.zaiToken ?? '') !== '') {
    outcome.lines.push('zai: token already set');
  } else {
    const found = findZaiToken();
    if (found) {
      config.zaiToken = found.token;
      outcome.lines.push(`zai: token discovered in ${found.browser} localStorage`);
      outcome.changed = true;
    } else {
      const bridged = bridgeToken();
      if (bridged) {
        config.zaiToken = bridged;
        outcome.lines.push("zai: token picked up from Claude Code's z.ai base URL");
        outcome.changed = true;
      } else {
        outcome.lines.push('zai: no token found (Chrome/Chromium-family + Firefox scanned; Safari is TCC-protected and skipped) — paste it in Settings');
      }
    }
  }

  // Claude — Claude Code credential file (keychain is out of scope).
  if (claudeReadable(CLAUDE_FILE)) {
    if (ensureEntry(config, 'claude')) {
      outcome.lines.push('claude: enabled (token read live from ~/.claude/.credentials.json)');
      outcome.changed = true;
    } else {
      outcome.lines.push('claude: already configured');
    }
  } else {
    outcome.lines.push('claude: no ~/.claude/.credentials.json found');
  }

  // Codex — Codex CLI auth file.
  if (codexReadable(CODEX_FILE)) {
    if (ensureEntry(config, 'codex')) {
      outcome.lines.push('codex: enabled (token read live from ~/.codex/auth.json)');
      outcome.changed = true;
    } else {
      outcome.lines.push('codex: already configured');
    }
  } else {
    outcome.lines.push('codex: no ~/.codex/auth.json found');
  }

  // GitHub — token from environment for the existing rate-limit source.
  const envToken = [env.GH_TOKEN, env.GITHUB_TOKEN].find((t) => t !== undefined && t !== '');
  if (envToken !== undefined) {
    if (config.sources.github?.enabled === false || (config.sources.github?.token ?? '') !== '') {
      outcome.lines.push('github: already configured');
    } else {
      config.sources.github = { enabled: true, token: envToken, discovered: true };
      outcome.lines.push('github: token picked up from environment');
      outcome.changed = true;
    }
  } else {
    outcome.lines.push('github: no GH_TOKEN/GITHUB_TOKEN in environment (60/hr unauthenticated is fine)');
  }

  // Copilot — tokens other tools drop on disk (opencode, VS Code plugin).
  if (hasStoredCredential()) {
    if (ensureEntry(config, 'copilot')) {
      outcome.lines.push('copilot: enabled (token read live from opencode/VS Code auth files)');
      outcome.changed = true;
    } else {
      outcome.lines.push('copilot: already configured');
    }
  } else {
    outcome.lines.push('copilot: no Copilot sign-in found (opencode/VS Code auth files)');
  }

  // OpenRouter — key from environment.
  const openrouterKey = env.OPENROUTER_API_KEY;
  if (openrouterKey !== undefined && openrouterKey !== '') {
    if (config.sources.openrouter?.enabled === false || (config.sources.openrouter?.token ?? '') !== '') {
      outcome.lines.push('openrouter: already configured');
    } else {
      config.sources.openrouter = { enabled: true, token: openrouterKey, discovered: true };
      outcome.lines.push('openrouter: key picked up from OPENROUTER_API_KEY');
      outcome.changed = true;
    }
  } else {
    outcome.lines.push('openrouter: no OPENROUTER_API_KEY in environment');
  }

  // Antigravity — the IDE's app data dir; the source is local-only, so
  // existence is all we need.
  if (fileExists(ANTIGRAVITY_DIRS)) {
    if (ensureEntry(config, 'antigravity')) {
      outcome.lines.push("antigravity: enabled (reads the app's local endpoint — open Antigravity to see quota)");
      outcome.changed = true;
    } else {
      outcome.lines.push('antigravity: already configured');
    }
  } else {
    outcome.lines.push('antigravity: app not installed');
  }

  return { config, outcome };
}

// MARK: per-source entry rules

/// Creates the entry when absent; re-arms a previously discovered entry
/// that lost its credential. Returns true when config changed.
function ensureEntry(config, key) {
  const existing = config.sources[key];
  if (existing) {
    if (!existing.enabled) return false;          // explicit opt-out wins
    if (existing.token) return false;             // user-managed token wins
    if (existing.discovered) return false;        // already set up by us
    config.sources[key] = { ...existing, discovered: true };
    return true;
  }
  config.sources[key] = {
    enabled: true,
    token: '',
    refreshToken: undefined,
    accountId: undefined,
    discovered: true,
  };
  return true;
}

function claudeReadable(candidates) {
  const root = readJSONCandidates(candidates);
  const token = root?.claudeAiOauth?.accessToken;
  return typeof token === 'string' && token !== '';
}

function codexReadable(candidates) {
  const root = readJSONCandidates(candidates);
  const token = root?.tokens?.access_token;
  return typeof token === 'string' && token !== '';
}
