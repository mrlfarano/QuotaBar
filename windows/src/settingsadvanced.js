// Runs in the sandboxed settings renderer; communicates only through preload.
export function setupAdvancedSettings(api, escapeHTML) {
  const editor = document.getElementById('advancedEditor');
  const status = document.getElementById('advancedStatus');
  let latest;
  let dirty = false;
  let nextId = 0;
  const input = (label, name, value = '', type = 'text', placeholder = '') => {
    const id = 'advanced-field-' + nextId++;
    return '<label for="' + id + '">' + escapeHTML(label) + '</label><input id="' + id
      + '" data-field="' + name + '" type="' + type + '" value="' + escapeHTML(value)
      + '" placeholder="' + escapeHTML(placeholder) + '" autocomplete="off" spellcheck="false">';
  };
  const credential = (label, name, mask) => input(label, name, '', 'password', mask ? 'Stored: ' + mask : 'Not set')
    + '<label class="clear-option"><input type="checkbox" data-field="clear' + name + '"> Clear ' + escapeHTML(label.toLowerCase()) + '</label>';
  const fields = (element) => Object.fromEntries([...element.querySelectorAll('[data-field]')]
    .map((node) => [node.dataset.field, node.type === 'checkbox' ? node.checked : node.value]));

  function addCustom(source = {}) {
    const card = document.createElement('fieldset');
    card.className = 'custom-source';
    card.dataset.originalId = source.originalId ?? '';
    card.innerHTML = '<legend>Custom source</legend><div class="advanced-grid">'
      + input('Source ID', 'id', source.id) + input('Display name', 'title', source.title)
      + input('Endpoint URL', 'url', source.url, 'url', 'https://example.com/usage')
      + credential('Bearer token', 'token', source.token)
      + input('Used path', 'usedPath', source.usedPath, 'text', 'data.used')
      + input('Limit path', 'limitPath', source.limitPath, 'text', 'data.limit')
      + input('Reset field (optional)', 'resetPath', source.resetPath, 'text', 'reset_at')
      + input('Replace headers (JSON)', 'headers', '', 'password', source.headerCount ? source.headerCount + ' stored; blank keeps them' : '{"X-API-Key":"…"}')
      + '</div><p class="hint">Paths use dots for nested values. Reset uses a top-level field. Blank headers keep existing values; {} clears them.</p>'
      + '<button type="button" class="remove-custom">Remove source</button>';
    card.querySelector('.remove-custom').onclick = () => { card.remove(); markDirty(); };
    document.getElementById('customSources').append(card);
  }

  function render(state) {
    editor.innerHTML = '<div class="advanced-grid" id="advancedGeneral">'
      + input('Tray source ID', 'mainSource', state.mainSource, 'text', 'Automatic (default: zai)')
      + input('Z.AI base URL', 'baseURL', state.baseURL, 'url')
      + input('Authorization prefix', 'authScheme', state.authScheme, 'text', 'Automatic')
      + '</div><p class="hint">Tray source: zai, github, claude, codex, openrouter, copilot, antigravity, or a custom ID. Authorization prefix includes any trailing space (for example, “Bearer ”).</p>'
      + '<h3>Provider credentials</h3><p class="hint">CLI sign-ins are discovered automatically. Manual credentials override them. Blank secret fields keep stored values; check Clear to remove one.</p>'
      + '<div id="advancedProviders"></div><h3>Custom sources</h3><div id="customSources"></div>'
      + '<button id="addCustom" type="button">Add custom source</button>';
    for (const provider of state.providers) {
      const card = document.createElement('details');
      card.className = 'advanced-provider';
      card.dataset.id = provider.id;
      card.innerHTML = '<summary>' + escapeHTML(provider.title) + '</summary><div class="advanced-grid">'
        + credential('Access token', 'token', provider.token)
        + (provider.id === 'github' ? '' : credential('Refresh token', 'refreshToken', provider.refreshToken)
          + input('Account ID', 'accountId', provider.accountId)) + '</div>';
      document.getElementById('advancedProviders').append(card);
    }
    for (const source of state.custom) addCustom(source);
    document.getElementById('addCustom').onclick = () => { addCustom(); markDirty(); document.querySelector('.custom-source:last-child input').focus(); };
  }

  function markDirty() { dirty = true; status.textContent = 'Unsaved advanced changes'; }
  editor.addEventListener('input', markDirty);
  api.onInit((state) => {
    latest = state.advanced;
    if (!dirty) render(latest);
  });
  document.getElementById('reloadAdvanced').onclick = () => {
    dirty = false;
    render(latest);
    status.textContent = 'Advanced changes discarded.';
  };
  document.getElementById('saveAdvanced').onclick = async () => {
    const button = document.getElementById('saveAdvanced');
    button.disabled = true;
    editor.disabled = true;
    try {
      const result = await api.saveAdvanced({
        ...fields(document.getElementById('advancedGeneral')),
        providers: [...document.querySelectorAll('.advanced-provider')].map((card) => ({
          refreshToken: '', clearrefreshToken: false, accountId: '', ...fields(card), id: card.dataset.id,
        })),
        custom: [...document.querySelectorAll('.custom-source')].map((card) => ({ ...fields(card), originalId: card.dataset.originalId })),
      });
      status.textContent = result.error ?? 'Advanced settings saved.';
      if (!result.error) { dirty = false; latest = result.state; render(latest); }
    } catch {
      status.textContent = 'Could not save settings. Your edits are still here; try again.';
    } finally { button.disabled = false; editor.disabled = false; }
  };
}
