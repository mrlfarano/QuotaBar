import { validateConfig } from './config.js';
import { TOGGLEABLE_SOURCES, maskedKey } from './settings.js';

// Secrets never leave the main process. Empty edits retain the latest value,
// including credentials refreshed while the settings window was open.
export function advancedSettingsState(config) {
  return {
    baseURL: config.baseURL,
    authScheme: config.authScheme ?? '',
    mainSource: config.mainSource ?? '',
    providers: TOGGLEABLE_SOURCES.filter(({ id }) => id !== 'zai').map(({ id, title }) => {
      const source = config.sources?.[id] ?? {};
      return { id, title, token: maskedKey(source.token), refreshToken: maskedKey(source.refreshToken), accountId: source.accountId ?? '' };
    }),
    custom: (config.sources?.custom ?? []).map((source) => ({
      ...source, originalId: source.id, token: maskedKey(source.token),
      headers: undefined, headerCount: Object.keys(source.headers ?? {}).length,
    })),
  };
}

function string(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  return value;
}

function httpURL(value, label) {
  const text = string(value, label).trim();
  let url;
  try { url = new URL(text); } catch { throw new Error(`${label} must be a valid HTTP or HTTPS URL.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${label} must use HTTP or HTTPS without embedded credentials.`);
  }
  return text;
}

function secret(edit, key, current) {
  const value = string(edit[key], key).trim();
  if (typeof edit[`clear${key}`] !== 'boolean') throw new Error(`Invalid ${key} clear option.`);
  return edit[`clear${key}`] ? '' : value || current || '';
}

export function applyAdvancedSettings(config, edit) {
  if (!edit || !Array.isArray(edit.providers) || !Array.isArray(edit.custom)) throw new Error('Invalid settings.');
  const result = { ...config, sources: { ...config.sources } };
  result.baseURL = httpURL(edit.baseURL, 'Z.AI base URL');
  result.authScheme = string(edit.authScheme, 'Authorization prefix') || undefined;
  if (/[\r\n]/.test(result.authScheme ?? '')) throw new Error('Authorization prefix must be one line.');
  result.mainSource = string(edit.mainSource, 'Tray source').trim() || undefined;
  const providerIds = new Set();
  for (const provider of edit.providers) {
    if (!provider || provider.id === 'zai' || !TOGGLEABLE_SOURCES.some(({ id }) => id === provider.id) || providerIds.has(provider.id)) {
      throw new Error('Invalid or duplicate provider.');
    }
    providerIds.add(provider.id);
    const current = result.sources[provider.id];
    const token = secret(provider, 'token', current?.token);
    const refreshToken = secret(provider, 'refreshToken', current?.refreshToken);
    const accountId = string(provider.accountId, 'Account ID').trim();
    if (!current && !token && !refreshToken && !accountId) continue;
    result.sources[provider.id] = {
      ...current, enabled: current?.enabled ?? true, discovered: current?.discovered ?? false, token,
      ...(provider.id === 'github' ? {} : { refreshToken, accountId }),
    };
  }
  const ids = new Set(TOGGLEABLE_SOURCES.map(({ id }) => id));
  const originals = new Set();
  result.sources.custom = edit.custom.map((source, index) => {
    if (!source || typeof source !== 'object') throw new Error('Invalid custom source.');
    const id = string(source.id, 'Source ID').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id.toLowerCase())) {
      throw new Error(`Custom source ${index + 1}: use a unique ID with letters, numbers, hyphens or underscores.`);
    }
    ids.add(id.toLowerCase());
    const originalId = string(source.originalId, 'Original source ID');
    const current = (config.sources?.custom ?? []).find((item) => item.id === originalId);
    if (originalId && (!current || originals.has(originalId))) throw new Error('Custom sources changed. Reload advanced settings before saving.');
    if (originalId) originals.add(originalId);
    const headerText = string(source.headers, 'Headers').trim();
    let headers = current?.headers;
    if (headerText) {
      try { headers = JSON.parse(headerText); } catch { throw new Error(`${id}: headers must be a JSON object.`); }
      if (!headers || typeof headers !== 'object' || Array.isArray(headers)
        || Object.entries(headers).some(([key, value]) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)
          || typeof value !== 'string' || /[\r\n]/.test(value))) {
        throw new Error(`${id}: headers must contain valid header names and single-line text values.`);
      }
    }
    const usedPath = string(source.usedPath, 'Used path').trim();
    const limitPath = string(source.limitPath, 'Limit path').trim();
    if (!usedPath || !limitPath) throw new Error(`${id}: used and limit paths are required.`);
    return {
      id, title: string(source.title, 'Title').trim() || undefined,
      url: httpURL(source.url, `${id} URL`), token: secret(source, 'token', current?.token), headers,
      usedPath, limitPath, resetPath: string(source.resetPath, 'Reset path').trim() || undefined,
    };
  });
  if (result.mainSource && !ids.has(result.mainSource.toLowerCase())) throw new Error('Tray source must match a built-in or custom source ID.');
  const validated = validateConfig(result);
  if (!validated) throw new Error('Invalid configuration. Existing settings were kept.');
  return validated;
}
