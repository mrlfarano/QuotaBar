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
    card.innerHTML = '<legend>' + escapeHTML(source.title || source.id || 'New source') + '</legend><div class="advanced-grid">'
      + input('Source ID', 'id', source.id) + input('Display name', 'title', source.title)
      + input('Endpoint URL', 'url', source.url, 'url', 'https://example.com/usage')
      + credential('Bearer token', 'token', source.token)
      + input('Used path', 'usedPath', source.usedPath, 'text', 'data.used')
      + input('Limit path', 'limitPath', source.limitPath, 'text', 'data.limit')
      + input('Reset field (optional)', 'resetPath', source.resetPath, 'text', 'reset_at')
      + input('Replace headers (JSON)', 'headers', '', 'password', source.headerCount ? source.headerCount + ' stored; blank keeps them' : '{"X-API-Key":"…"}')
      + '</div><p class="hint help">Blank headers keep existing values. Enter {} to clear them.</p>'
      + '<button type="button" class="remove-custom">Remove source</button>';
    card.querySelector('.remove-custom').onclick = () => { card.remove(); markDirty(); };
    document.getElementById('customSources').append(card);
  }

  function render(state) {
    editor.innerHTML = '<div class="section"><h2>Z.AI connection</h2><div class="advanced-grid" id="advancedGeneral">'
      + input('Z.AI base URL', 'baseURL', state.baseURL, 'url')
      + input('Authorization prefix', 'authScheme', state.authScheme, 'text', 'Automatic')
      + '</div></div><div class="section"><h2>Provider credentials</h2><p class="hint">Leave tokens blank to keep existing sign-ins.</p>'
      + '<div id="advancedProviders"></div></div><div class="section"><h2>Custom sources</h2><div id="customSources"></div>'
      + '<button id="addCustom" type="button">Add source</button></div>';
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

  function markDirty() { dirty = true; status.textContent = ''; }
  editor.addEventListener('input', markDirty);
  api.onInit((state) => {
    latest = state.advanced;
    if (!dirty) render(latest);
  });
  document.getElementById('reloadAdvanced').onclick = () => {
    dirty = false;
    render(latest);
    status.textContent = '';
  };
  document.getElementById('saveAdvanced').onclick = async () => {
    const button = document.getElementById('saveAdvanced');
    button.disabled = true;
    editor.disabled = true;
    try {
      const result = await api.saveAdvanced({
        mainSource: latest.mainSource,
        ...fields(document.getElementById('advancedGeneral')),
        providers: [...document.querySelectorAll('.advanced-provider')].map((card) => ({
          refreshToken: '', clearrefreshToken: false, accountId: '', ...fields(card), id: card.dataset.id,
        })),
        custom: [...document.querySelectorAll('.custom-source')].map((card) => ({ ...fields(card), originalId: card.dataset.originalId })),
      });
      status.textContent = result.error ?? 'Saved';
      if (!result.error) { dirty = false; latest = result.state; render(latest); }
    } catch {
      status.textContent = 'Could not save settings. Your edits are still here; try again.';
    } finally { button.disabled = false; editor.disabled = false; }
  };
}
