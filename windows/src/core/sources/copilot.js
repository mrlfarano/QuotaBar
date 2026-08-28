// Port of CopilotSource.swift — GitHub Copilot premium-request quota via the
// Copilot Chat extension's own internal endpoints:
//   1. GET api.github.com/copilot_internal/v2/token  (GitHub OAuth token)
//   2. GET api.github.com/copilot_internal/user       (session token)
// Token chain: config token → opencode auth.json → VS Code hosts/apps.json.
// Windows gets extra candidate paths (%LOCALAPPDATA%, %APPDATA%) on top of
// the literal home-relative ones every platform shares.

import { request } from '../http.js';
import { networkMessage } from './zai.js';
import { objectFrom, leafNumber, leafDate } from '../jsonutil.js';
import { readJSONCandidates } from '../credfiles.js';
import { gauge } from '../parser.js';

export const id = 'copilot';
export const title = 'Copilot · premium requests';
const tokenURL = 'https://api.github.com/copilot_internal/v2/token';
const userURL = 'https://api.github.com/copilot_internal/user';

const OPENCODE_AUTH = [
  '~/.local/share/opencode/auth.json',
  '%LOCALAPPDATA%/opencode/auth.json',
];
const HOSTS_OR_APPS = [
  '~/.config/github-copilot/hosts.json',
  '~/.config/github-copilot/apps.json',
  '%APPDATA%/github-copilot/hosts.json',
  '%APPDATA%/github-copilot/apps.json',
];

export function section(error) {
  return { id, title, gauges: [], errorMessage: error, notice: undefined };
}

export async function fetch(config) {
  const oauthToken = candidateToken(config);
  if (!oauthToken) {
    return section('No Copilot token — sign in to Copilot in an editor/opencode, or set sources.copilot.token');
  }

  const sessionToken = await exchangeToken(oauthToken);
  // Session token preferred; raw `token <oauth>` as fallback.
  const attempts = sessionToken
    ? [['Bearer', sessionToken], ['token', oauthToken]]
    : [['token', oauthToken]];
  for (const [scheme, token] of attempts) {
    let status;
    let text;
    try {
      ({ status, text } = await request(userURL, {
        timeoutMs: 15000,
        headers: {
          Authorization: `${scheme} ${token}`,
          ...editorHeaders(),
        },
      }));
    } catch (error) {
      return section(`Network error: ${networkMessage(error)}`);
    }
    if (status !== 200) continue;
    const root = objectFrom(text);
    if (!root) return section('Response was not JSON');
    return sectionFrom(root);
  }
  return section('Copilot API rejected the token (run an editor sign-in, then Discover Sources)');
}

/// Wire-format parser, exposed for `--parse-copilot <fixture>`.
export function sectionFrom(root) {
  const snapshots = root.quota_snapshots && typeof root.quota_snapshots === 'object' ? root.quota_snapshots : {};
  const premium = snapshots.premium_interactions;
  if (!premium || typeof premium !== 'object' || Array.isArray(premium)) {
    return section('No premium_interactions quota in response');
  }
  if (premium.unlimited === true) {
    return { id, title, gauges: [], errorMessage: undefined, notice: 'Unlimited plan — no premium-request cap' };
  }
  const entitlement = leafNumber(premium.entitlement);
  const remaining = leafNumber(premium.remaining);
  if (entitlement === null || entitlement <= 0 || remaining === null) {
    return section('Quota fields missing from response');
  }
  const used = Math.max(0, entitlement - remaining);
  const premiumGauge = gauge('copilot-premium', 'Premium requests', (used / entitlement) * 100, {
    used,
    total: entitlement,
    resetAt: resetDate(root.quota_reset_date),
  });
  return { id, title, gauges: [premiumGauge], errorMessage: undefined, notice: undefined };
}

// MARK: internals

async function exchangeToken(oauth) {
  let status;
  let text;
  try {
    ({ status, text } = await request(tokenURL, {
      timeoutMs: 15000,
      headers: { Authorization: 'Bearer ' + oauth, ...editorHeaders() },
    }));
  } catch {
    return null;
  }
  if (status !== 200) return null;
  const object = objectFrom(text);
  const token = object?.token;
  return typeof token === 'string' && token !== '' ? token : null;
}

/// Header set the extension sends; the internal API sniffs these.
function editorHeaders() {
  return {
    Accept: 'application/json',
    'User-Agent': 'GitHubCopilotChat/0.35.0',
    'Editor-Version': 'vscode/1.107.0',
    'Editor-Plugin-Version': 'copilot-chat/0.35.0',
    'Copilot-Integration-Id': 'vscode-chat',
  };
}

/// quota_reset_date is a bare ISO date ("2026-09-01"); the shared ISO8601
/// parser wants full timestamps, so add a date-only fallback.
export function resetDate(any) {
  const full = leafDate(any);
  if (full) return full;
  if (typeof any !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(any);
  if (!match) return null;
  return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
}

/// Whether any on-disk auth store actually holds a Copilot token — used by
/// discovery so a login file for other providers doesn't enable this source
/// with no usable credential.
export function hasStoredCredential() {
  return candidateToken(undefined) !== null;
}

function candidateToken(config) {
  if (config?.token) return config.token;
  return readOpenCodeAuth() ?? readHostsOrApps() ?? null;
}

/// opencode: auth.json → github-copilot.refresh|access
function readOpenCodeAuth() {
  const root = readJSONCandidates(OPENCODE_AUTH);
  const copilot = root?.['github-copilot'];
  if (!copilot || typeof copilot !== 'object') return null;
  const token = typeof copilot.refresh === 'string' ? copilot.refresh : copilot.access;
  return typeof token === 'string' && token !== '' ? token : null;
}

/// VS Code/Copilot plugin: hosts.json / apps.json → github.com.oauth_token
function readHostsOrApps() {
  const root = readJSONCandidates(HOSTS_OR_APPS);
  const github = root?.['github.com'];
  if (!github || typeof github !== 'object') return null;
  const token = github.oauth_token;
  return typeof token === 'string' && token !== '' ? token : null;
}
