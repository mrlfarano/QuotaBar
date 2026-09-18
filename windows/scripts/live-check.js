// Opt-in check against the user's existing provider sessions. Never print
// responses, tokens, account data, or provider-supplied error messages.
import { loadConfig, saveConfig } from '../src/core/config.js';
import { runDiscovery } from '../src/core/discovery.js';
import { fetchSnapshot } from '../src/core/sources/zai.js';
import * as Claude from '../src/core/sources/claude.js';
import * as Codex from '../src/core/sources/codex.js';
import * as GitHub from '../src/core/sources/github.js';
import * as Copilot from '../src/core/sources/copilot.js';
import * as OpenRouter from '../src/core/sources/openrouter.js';
import * as Antigravity from '../src/core/sources/antigravity.js';
import { fetchCustom } from '../src/core/sources/custom.js';

const stored = loadConfig();
const { config } = runDiscovery(stored);
const results = [];
function report(source, section, refreshed = false) {
  const error = section.errorMessage ?? '';
  const status = !error ? (section.gauges.length ? 'pass' : 'connected-without-quota')
    : /^Connected, but no /.test(error) ? 'connected-without-quota'
    : /No (OAuth token|API key|Copilot token|token configured)|not running/.test(error) ? 'unavailable'
    : /Network error/.test(error) ? 'network-error'
    : /[Uu]nauthorized|[Tt]oken expired|[Tt]oken.*reject|[Kk]ey rejected|HTTP 40[13]/.test(error) ? 'auth-error' : 'api-error';
  results.push({ source, status, gauges: section.gauges.length, refreshed });
}

for (const source of ['zai', 'github', 'claude', 'codex', 'copilot', 'openrouter', 'antigravity']) {
  if (config.sources?.[source]?.enabled === false) {
    results.push({ source, status: 'disabled' });
    continue;
  }
  if (source === 'zai') report(source, await fetchSnapshot(config));
  else if (source === 'github') report(source, await GitHub.fetch(config.sources?.github?.token));
  else if (source === 'claude' || source === 'codex') {
    const result = await (source === 'claude' ? Claude : Codex).fetch(config.sources?.[source]);
    if (result.tokenUpdate) {
      // Retain successful rotations in QuotaBar's config only; CLI stores
      // remain untouched. Re-read to preserve concurrent UI edits.
      const latest = loadConfig();
      latest.sources = { ...latest.sources, [source]: result.tokenUpdate };
      saveConfig(latest);
    }
    report(source, result.section, Boolean(result.tokenUpdate));
  } else if (source === 'copilot') report(source, await Copilot.fetch(config.sources?.copilot));
  else if (source === 'openrouter') report(source, await OpenRouter.fetch(config.sources?.openrouter));
  else report(source, await Antigravity.fetch());
}
for (const [index, custom] of (config.sources?.custom ?? []).entries()) {
  report(`custom-${index + 1}`, await fetchCustom(custom));
}
console.log(JSON.stringify(results, null, 2));
process.exitCode = results.some((result) => ['auth-error', 'network-error', 'api-error'].includes(result.status)) ? 1 : 0;
