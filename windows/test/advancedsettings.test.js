import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../src/core/config.js';
import { advancedSettingsState, applyAdvancedSettings } from '../src/core/advancedsettings.js';

const custom = {
  id: 'example', title: 'Example', url: 'https://example.com/usage', token: 'REDACTED-custom-secret',
  headers: { 'X-Key': 'REDACTED-header-secret' }, usedPath: 'data.used', limitPath: 'data.limit',
};
function config() {
  return { ...defaultConfig(), zaiToken: 'REDACTED-zai-secret', sources: {
    codex: { enabled: false, discovered: true, token: 'REDACTED-access-secret', refreshToken: 'REDACTED-refresh-secret', accountId: 'test-account' },
    custom: [{ ...custom }],
  } };
}
function edit(current = config()) {
  const state = advancedSettingsState(current);
  return { ...state,
    providers: state.providers.map((provider) => ({ ...provider, token: '', cleartoken: false, refreshToken: '', clearrefreshToken: false })),
    custom: state.custom.map((source) => ({ ...source, title: source.title ?? '', token: '', cleartoken: false, headers: '', resetPath: source.resetPath ?? '' })),
  };
}

test('advanced state never includes stored access tokens, refresh tokens or header values', () => {
  const state = advancedSettingsState(config());
  const text = JSON.stringify(state);
  for (const secret of ['REDACTED-zai-secret', 'REDACTED-access-secret', 'REDACTED-refresh-secret', 'REDACTED-custom-secret', 'REDACTED-header-secret']) {
    assert.equal(text.includes(secret), false);
  }
  assert.equal(state.custom[0].headerCount, 1);
});

test('blank edits retain latest credentials and existing source flags without mutating config', () => {
  const current = config();
  const draft = edit(current);
  current.sources.codex.token = 'REDACTED-new-access';
  current.sources.codex.refreshToken = 'REDACTED-new-refresh';
  const before = structuredClone(current);
  const result = applyAdvancedSettings(current, draft);
  assert.deepEqual(current, before);
  assert.deepEqual(result.sources.codex, current.sources.codex);
  assert.deepEqual(result.sources.custom[0].headers, custom.headers);
  assert.equal(result.sources.custom[0].token, custom.token);
  assert.equal(result.zaiToken, current.zaiToken);
  assert.equal(result.sources.claude, undefined);
});

test('advanced edits save URLs, prefixes, tray selection and new provider credentials', () => {
  const draft = edit();
  Object.assign(draft, { baseURL: 'http://localhost:8000', authScheme: 'Bearer ', mainSource: 'example' });
  Object.assign(draft.providers.find(({ id }) => id === 'claude'), { token: 'REDACTED-claude', refreshToken: 'REDACTED-refresh' });
  const result = applyAdvancedSettings(config(), draft);
  assert.equal(result.baseURL, draft.baseURL);
  assert.equal(result.authScheme, 'Bearer ');
  assert.equal(result.mainSource, 'example');
  assert.equal(result.sources.claude.enabled, true);
  assert.equal(result.sources.claude.refreshToken, 'REDACTED-refresh');
});

test('explicit clear removes secrets; custom rename retains secrets and headers can be replaced', () => {
  const draft = edit();
  Object.assign(draft.providers.find(({ id }) => id === 'codex'), { cleartoken: true, clearrefreshToken: true });
  Object.assign(draft.custom[0], { id: 'renamed', headers: '{"Accept":"application/json"}' });
  const result = applyAdvancedSettings(config(), draft);
  assert.equal(result.sources.codex.token, '');
  assert.equal(result.sources.codex.refreshToken, '');
  assert.equal(result.sources.codex.enabled, false);
  assert.equal(result.sources.custom[0].id, 'renamed');
  assert.equal(result.sources.custom[0].token, custom.token);
  assert.deepEqual(result.sources.custom[0].headers, { Accept: 'application/json' });
  draft.custom[0].headers = '{}';
  draft.custom[0].cleartoken = true;
  const cleared = applyAdvancedSettings(config(), draft);
  assert.deepEqual(cleared.sources.custom[0].headers, {});
  assert.equal(cleared.sources.custom[0].token, '');
});

test('custom sources can be added and removed', () => {
  const draft = edit();
  draft.custom[0].originalId = '';
  draft.custom[0].id = 'new-source';
  assert.equal(applyAdvancedSettings(config(), draft).sources.custom[0].id, 'new-source');
  draft.custom = [];
  assert.deepEqual(applyAdvancedSettings(config(), draft).sources.custom, []);
});

for (const [name, change] of [
  ['non-HTTP URL', (draft) => { draft.baseURL = 'file:///secret'; }],
  ['URL credentials', (draft) => { draft.custom[0].url = 'https://name:secret@example.com'; }],
  ['invalid URL', (draft) => { draft.custom[0].url = 'not a URL'; }],
  ['unknown tray ID', (draft) => { draft.mainSource = 'missing'; }],
  ['reserved source ID', (draft) => { draft.custom[0].id = 'CODEX'; }],
  ['duplicate ID', (draft) => { draft.custom.push({ ...draft.custom[0], id: 'EXAMPLE' }); }],
  ['invalid source ID', (draft) => { draft.custom[0].id = '<script>'; }],
  ['missing path', (draft) => { draft.custom[0].limitPath = ''; }],
  ['stale custom source', (draft) => { draft.custom[0].originalId = 'removed'; }],
  ['invalid headers JSON', (draft) => { draft.custom[0].headers = '{'; }],
  ['array headers', (draft) => { draft.custom[0].headers = '[]'; }],
  ['non-string header', (draft) => { draft.custom[0].headers = '{"X-Test":2}'; }],
  ['header injection', (draft) => { draft.custom[0].headers = JSON.stringify({ 'X-Test': 'a\r\nb' }); }],
  ['invalid header name', (draft) => { draft.custom[0].headers = '{"Bad Header":"x"}'; }],
  ['prefix injection', (draft) => { draft.authScheme = 'Bearer\r\n'; }],
  ['unknown provider', (draft) => { draft.providers[0].id = '__proto__'; }],
  ['duplicate provider', (draft) => { draft.providers.push(draft.providers[0]); }],
  ['invalid secret', (draft) => { draft.providers[0].token = 123; }],
  ['invalid clear flag', (draft) => { draft.providers[0].cleartoken = 'true'; }],
]) {
  test(`advanced settings reject ${name} without changing config`, () => {
    const current = config();
    const before = structuredClone(current);
    const draft = edit(current);
    change(draft);
    assert.throws(() => applyAdvancedSettings(current, draft));
    assert.deepEqual(current, before);
  });
}
