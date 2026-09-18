const root = document.getElementById('qb-next');
const content = document.getElementById('qb-content');
const message = document.getElementById('qb-message');
let state = { providers: [], preferences: { watched: {} } };
let page = 'overview';
let expanded = null;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = { codex: 'codex-color', claude: 'claude-color', zai: 'zai', github: 'github', copilot: 'githubcopilot', openrouter: 'openrouter', antigravity: 'antigravity-color' };

function logo(p) {
  const icon = icons[p.id];
  return icon ? `<img class="qb-logo${icon.endsWith('-color') ? '' : ' qb-logo-mono'}" src="assets/providers/${icon}.svg" width="22" height="22" alt="">`
    : `<span class="qb-logo qb-logo-fallback" aria-hidden="true">${escape(p.name.slice(0, 2).toUpperCase())}</span>`;
}
function left(g) { return Math.round(100 - g.pct); }
function color(p, g) { return p.stale ? 'muted' : left(g) >= 76 ? 'good' : left(g) >= 26 ? 'medium' : 'low'; }
function label(p, g) { return p.stale ? 'Last known' : left(g) >= 76 ? 'Plenty left' : left(g) >= 26 ? 'Moderate' : 'Low quota'; }
function chosen(p) { return p.gauges.find(g => g.id === state.preferences.watched[p.id]) ?? p.gauges[0]; }
function age(time) { return !time ? 'Not checked yet' : Date.now() - time < 60000 ? 'Checked just now' : `Checked ${Math.floor((Date.now() - time) / 60000)}m ago`; }
function reset(g) {
  if (!g.resetAt) return { short: 'Reset time unavailable', exact: 'The provider has not reported a reset time.' };
  const date = new Date(g.resetAt);
  const minutes = Math.ceil((date - Date.now()) / 60000);
  const exact = date.toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  if (minutes <= 0) return { short: 'Reset expected; awaiting update', exact };
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
  return { short: `Resets in ${days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`}`, exact };
}
function bar(p, g) { return `<div class="qb-track" role="meter" aria-label="${escape(g.label)} remaining${p.stale ? ', last known' : ''}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${left(g)}"><div class="qb-fill" style="width:${left(g)}%"></div></div>`; }
function gauge(p, g) {
  const r = reset(g);
  return `<div class="qb-gauge" style="--qb-status:var(--qb-${color(p, g)})"><div class="qb-row"><span>${escape(g.label)}</span><span class="qb-value">${left(g)}% left</span></div>${bar(p, g)}<div class="qb-row qb-sub"><span>${label(p, g)}</span><button type="button" class="qb-reset" data-reset="${escape(r.exact)}" data-tooltip="${escape(r.exact)}">${r.short}</button></div></div>`;
}
function details(p) {
  const open = expanded === p.id;
  const error = ['Sign-in required', 'Unavailable'].includes(p.status);
  return `<div class="qb-reveal" data-reveal="${escape(p.id)}" data-open="${open}" aria-hidden="${!open}" ${open ? '' : 'inert'}><div class="qb-reveal-inner"><section class="qb-expanded" aria-label="${escape(p.name)} quota details"><div class="qb-sub">${escape(p.status)} · ${age(p.lastSuccess)}</div>${p.gauges.map(g => gauge(p, g)).join('')}${!p.gauges.length ? '<p class="qb-settings-caption">No quota values available yet.</p>' : ''}${p.gauges.length > 1 ? `<div class="qb-sub">Quota shown in tray</div><div class="qb-quota-choice" role="group" aria-label="Tray quota">${p.gauges.map(g => `<button type="button" data-action="watch" data-id="${escape(p.id)}" data-gauge="${escape(g.id)}" data-key="watch:${escape(p.id)}:${escape(g.id)}" aria-pressed="${chosen(p).id === g.id}">${escape(g.label)}</button>`).join('')}</div>` : ''}<div class="qb-actions"><button type="button" data-action="refresh-provider" data-id="${escape(p.id)}">Refresh ${escape(p.name)}</button>${error ? '<button type="button" data-action="credentials">Connection settings…</button>' : ''}</div></section></div></div>`;
}
function hero(p) {
  const g = chosen(p);
  if (!g) return provider(p);
  const r = reset(g);
  const ticks = Array.from({ length: 40 }, (_, i) => `<line x1="64" y1="3" x2="64" y2="7" transform="rotate(${i * 9} 64 64)" stroke="var(--qb-track)" stroke-width="1.5"/>`).join('');
  const dial = `<span class="qb-dial"><svg viewBox="0 0 128 128" aria-hidden="true">${ticks}<circle cx="64" cy="64" r="48" fill="none" stroke="var(--qb-track)" stroke-width="7"/><circle cx="64" cy="64" r="48" fill="none" stroke="var(--qb-status)" stroke-width="7" stroke-linecap="round" pathLength="100" stroke-dasharray="${left(g)} 100" transform="rotate(-90 64 64)"/></svg><span class="qb-dial-copy"><span class="qb-dial-number">${left(g)}%<span class="qb-dial-caption"> left</span></span></span></span>`;
  return `<button type="button" class="qb-hero" data-provider="${escape(p.id)}" data-key="provider:${escape(p.id)}" aria-expanded="${expanded === p.id}" style="--qb-status:var(--qb-${color(p, g)})"><span class="qb-eyebrow">Watching in tray</span><span class="qb-hero-layout">${dial}<span><span class="qb-hero-name">${logo(p)}${escape(p.name)}</span><span class="qb-hero-window">${escape(g.label)}</span><span class="qb-status-label">${label(p, g)}</span></span></span><span class="qb-hero-bottom"><span title="${escape(r.exact)}">${r.short}</span><span data-toggle-label>${expanded === p.id ? 'Less ↑' : 'Details ↓'}</span></span></button>${details(p)}`;
}
function provider(p) {
  const g = p.id === state.pinned ? chosen(p) : p.gauges.reduce((a, b) => !a || b.pct > a.pct ? b : a, null);
  return `<div class="qb-provider-wrap"><button type="button" class="qb-provider" data-provider="${escape(p.id)}" data-key="provider:${escape(p.id)}" aria-expanded="${expanded === p.id}" style="--qb-status:var(--qb-${g ? color(p, g) : 'muted'})"><span class="qb-row"><span class="qb-label">${logo(p)}${escape(p.name)}</span>${g ? `<span class="qb-value">${left(g)}% left</span>` : ''}</span>${g ? `${bar(p, g)}<div class="qb-row qb-sub"><span>${escape(g.label)} · ${label(p, g)}</span><span title="${escape(reset(g).exact)}">${reset(g).short}</span></div>` : `<div class="qb-sub">${escape(p.status)}</div>`}</button>${p.id !== state.pinned ? `<button type="button" class="qb-pin" data-action="pin" data-id="${escape(p.id)}" aria-label="Show ${escape(p.name)} in tray">Pin</button>` : ''}</div>${details(p)}`;
}
function overview() {
  if (!state.providers.length) return '<div class="qb-detail"><h3>Your quotas, one glance away.</h3><p>Connect the tools you already use.</p><button type="button" class="qb-primary" data-action="discover">Find existing connections</button><button type="button" data-action="credentials">Connect manually…</button></div>';
  const pinned = state.providers.find(p => p.id === state.pinned) ?? state.providers[0];
  return `${pinned.id !== state.pinned ? '<div class="qb-note">Pinned provider unavailable. Showing another enabled provider.</div>' : ''}${hero(pinned)}<div class="qb-section-label"><span class="qb-eyebrow">Other providers</span><span class="qb-meta">Remaining</span></div>${state.providers.filter(p => p !== pinned).map(provider).join('')}<div class="qb-separator"></div><button type="button" data-action="connections">Manage connections…</button>`;
}
function settings() {
  const prefs = state.preferences;
  const pause = prefs.pauseUntil === -1 ? 'until-resume' : prefs.pauseUntil > Date.now() ? 'hour' : 'resume';
  return `<button type="button" data-action="back">‹ Usage</button><div class="qb-detail"><h3>Settings</h3><label class="qb-control">Usage updates<select data-setting="poll" data-key="setting:poll">${[1, 2, 5, 10, 15, 30, 60].map(n => `<option value="${n}"${!prefs.manual && state.pollMinutes === n ? ' selected' : ''}>Every ${n} minute${n === 1 ? '' : 's'}</option>`).join('')}<option value="manual"${prefs.manual ? ' selected' : ''}>Manually</option></select></label><label class="qb-control">Pause updates<select data-setting="pause" data-key="setting:pause">${[['resume', 'Running'], ['hour', 'For one hour'], ['until-resume', 'Until I resume']].map(([value, text]) => `<option value="${value}"${value === pause ? ' selected' : ''}>${text}</option>`).join('')}</select></label><label class="qb-control">Start at login<input type="checkbox" data-setting="login" data-key="setting:login" ${state.login ? 'checked' : ''}></label><h3>Alerts</h3><label class="qb-control">Low quota alert<input type="checkbox" data-preference="lowAlert" data-key="pref:lowAlert" ${prefs.lowAlert ? 'checked' : ''}></label><label class="qb-control">Notify below<select data-preference="threshold" data-key="pref:threshold" ${prefs.lowAlert ? '' : 'disabled'}>${[10, 25, 50].map(n => `<option value="${n}"${prefs.threshold === n ? ' selected' : ''}>${n}% left</option>`).join('')}</select></label><label class="qb-control">Quota available again<input type="checkbox" data-preference="recoveryAlert" data-key="pref:recoveryAlert" ${prefs.recoveryAlert ? 'checked' : ''}></label><p class="qb-settings-caption">Alerts follow the quota shown in tray. Recovery requires a fresh reading. Windows notification settings apply.</p><button type="button" data-action="credentials">Provider credentials and advanced settings…</button></div>`;
}
function connections() {
  return `<button type="button" data-action="back">‹ Usage</button><div class="qb-detail"><h3>Connections</h3>${state.providers.map(p => `<div class="qb-control"><div><span class="qb-label">${logo(p)}${escape(p.name)}</span><div class="qb-sub">${escape(p.status)}</div></div><button type="button" data-action="${p.status === 'Sign-in required' ? 'credentials' : 'refresh-provider'}" data-id="${escape(p.id)}">${p.status === 'Sign-in required' ? 'Repair…' : 'Retry'}</button></div>`).join('')}<button type="button" data-action="discover">Find existing connections</button><button type="button" data-action="credentials">Add or configure providers…</button></div>`;
}
function render() {
  const focus = document.activeElement?.dataset.key;
  const scroll = content.scrollTop;
  const prefs = state.preferences;
  const paused = prefs.pauseUntil === -1 || prefs.pauseUntil > Date.now();
  const pinned = state.providers.find(p => p.id === state.pinned) ?? state.providers[0];
  document.getElementById('qb-subtitle').textContent = state.demo ? 'Demo readings' : 'Usage at a glance';
  document.getElementById('qb-fresh').textContent = paused ? 'Updates paused' : age(pinned?.lastSuccess);
  document.getElementById('qb-refresh').textContent = state.refreshing ? 'Refreshing…' : 'Refresh';
  content.innerHTML = `${paused ? `<div class="qb-paused"><span>${prefs.pauseUntil === -1 ? 'Paused until you resume' : `Paused until ${new Date(prefs.pauseUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`} · Last known readings</span><button type="button" data-action="resume">Resume</button></div>` : ''}${page === 'settings' ? settings() : page === 'connections' ? connections() : overview()}`;
  content.scrollTop = scroll;
  if (focus) content.querySelector(`[data-key="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
}
async function send(request) {
  try {
    const result = await window.usage.command(request);
    if (result.error) { message.textContent = result.error; return false; }
    if (result.state) accept(result.state);
    return true;
  } catch { message.textContent = 'Could not complete the action. Please try again.'; return false; }
}
function toggle(id) {
  expanded = expanded === id ? null : id;
  for (const panel of content.querySelectorAll('.qb-reveal')) {
    const open = panel.dataset.reveal === expanded;
    panel.dataset.open = String(open);
    panel.inert = !open;
    panel.setAttribute('aria-hidden', String(!open));
  }
  for (const button of content.querySelectorAll('[data-provider]')) {
    const open = button.dataset.provider === expanded;
    button.setAttribute('aria-expanded', String(open));
    const text = button.querySelector('[data-toggle-label]');
    if (text) text.textContent = open ? 'Less ↑' : 'Details ↓';
  }
  content.querySelector(`[data-provider="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}
root.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.provider) { toggle(button.dataset.provider); return; }
  if (button.dataset.reset) { message.textContent = `Reset: ${button.dataset.reset}`; return; }
  const action = button.dataset.action;
  message.textContent = '';
  if (['settings', 'connections', 'back'].includes(action)) {
    page = action === 'back' ? 'overview' : action;
    render();
    content.scrollTop = 0;
    content.querySelector('button, select')?.focus();
  } else if (action === 'credentials') await send({ action: 'settings' });
  else if (action === 'resume') await send({ action: 'pause', mode: 'resume' });
  else await send({ action, id: button.dataset.id, gauge: button.dataset.gauge });
});
root.addEventListener('change', async event => {
  const element = event.target;
  if (element.dataset.preference) await send({ action: 'preferences', patch: { [element.dataset.preference]: element.type === 'checkbox' ? element.checked : Number(element.value) } });
  if (element.dataset.setting === 'pause') await send({ action: 'pause', mode: element.value });
  if (element.dataset.setting === 'login') await send({ action: 'login', enabled: element.checked });
  if (element.dataset.setting === 'poll') {
    if (element.value !== 'manual' && !await send({ action: 'poll', minutes: Number(element.value) })) return;
    await send({ action: 'preferences', patch: { manual: element.value === 'manual' } });
  }
});
root.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  if (page !== 'overview') { page = 'overview'; render(); }
  else if (expanded) toggle(expanded);
  else send({ action: 'close' });
});
function accept(value) {
  if (value.revision < (state.revision ?? 0)) return;
  state = value;
  render();
}
window.usage.onState(accept);
send({ action: 'init' });
