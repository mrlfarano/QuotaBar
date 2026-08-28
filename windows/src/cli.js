// Port of the CLI flags in main.swift — offline parser checks against the
// same fixtures in ../testdata. Run with plain Node (no Electron needed):
//   node src/cli.js --parse payload_real.json
//   node src/cli.js --parse-claude claude-usage.json
//   node src/cli.js --parse-custom config.json payload.json
// Output strings and exit codes mirror the Swift binary byte-for-byte so
// the two implementations can be diffed directly.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { objectFrom } from './core/jsonutil.js';
import { gaugesFrom, planLevel } from './core/parser.js';
import { swiftDouble } from './core/format.js';
import { validateCustomSource } from './core/config.js';
import { valueAt, fetchCustom } from './core/sources/custom.js';
import * as ClaudeSource from './core/sources/claude.js';
import * as CodexSource from './core/sources/codex.js';
import * as OpenRouterSource from './core/sources/openrouter.js';
import * as CopilotSource from './core/sources/copilot.js';
import * as AntigravitySource from './core/sources/antigravity.js';
import * as ZaiSource from './core/sources/zai.js';

const SECTION_FLAGS = [
  ['--parse-openrouter', OpenRouterSource.sectionFrom],
  ['--parse-copilot', CopilotSource.sectionFrom],
  ['--parse-antigravity', AntigravitySource.sectionFrom],
];

function parseNum(value) {
  return value === Math.round(value) ? String(Math.round(value)) : String(value);
}

function gaugeLines(gauges, withCounts) {
  return gauges.map((gauge) => {
    let text = `${gauge.id}=${Math.round(gauge.pct)}%`;
    if (withCounts && gauge.used != null && gauge.total != null) {
      text += ` [${parseNum(gauge.used)}/${parseNum(gauge.total)}]`;
    }
    if (gauge.resetAt) text += ` resets@${Math.trunc(gauge.resetAt.getTime() / 1000)}`;
    return text;
  });
}

function readFileObject(file, io) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  return objectFrom(text);
}

/// Runs the CLI once. Returns the process exit code (does not exit).
export function runCli(argv, io = process) {
  const has = (flag) => argv.includes(flag);

  // quotabar --parse payload.json -> "fiveHour=42% [49.2k/120k] resets@…"
  if (has('--parse')) {
    const file = argv[argv.length - 1];
    const root = readFileObject(file, io);
    if (!root) {
      io.stderr.write(`quotabar --parse: could not read ${file}\n`);
      return 2;
    }
    const gauges = gaugesFrom(root);
    io.stdout.write(gaugeLines(gauges, true).join(' ') + '\n');
    return gauges.length === 0 ? 1 : 0;
  }

  const gaugeFlag = [['--parse-claude', ClaudeSource.gaugesFromRoot], ['--parse-codex', CodexSource.gaugesFromRoot]]
    .find(([flag]) => has(flag));
  const sectionFlag = SECTION_FLAGS.find(([flag]) => has(flag));
  if (gaugeFlag || sectionFlag) {
    const flag = gaugeFlag ? gaugeFlag[0] : sectionFlag[0];
    const file = argv[argv.length - 1];
    const root = readFileObject(file, io);
    if (!root) {
      io.stderr.write(`quotabar ${flag}: could not read ${file}\n`);
      return 2;
    }
    let gauges;
    if (gaugeFlag) {
      gauges = gaugeFlag[1](root);
    } else {
      const section = sectionFlag[1](root);
      if (section.notice) io.stderr.write(`notice: ${section.notice}\n`);
      if (section.errorMessage) io.stderr.write(`error: ${section.errorMessage}\n`);
      gauges = section.gauges;
    }
    io.stdout.write(gaugeLines(gauges, false).join(' ') + '\n');
    return gauges.length === 0 ? 1 : 0;
  }

  // quotabar --parse-custom config.json payload.json
  if (has('--parse-custom') && argv.length >= 4) {
    const configPath = argv[2];
    const payloadPath = argv[3];
    const sourceDict = readFileObject(configPath, io);
    const payload = readFileObject(payloadPath, io);
    if (!sourceDict || !payload || typeof sourceDict.id !== 'string') {
      io.stderr.write('quotabar --parse-custom: bad inputs\n');
      return 2;
    }
    if (typeof sourceDict.title !== 'string') sourceDict.title = undefined;
    sourceDict.usedPath = typeof sourceDict.usedPath === 'string' ? sourceDict.usedPath : '';
    sourceDict.limitPath = typeof sourceDict.limitPath === 'string' ? sourceDict.limitPath : '';
    const source = validateCustomSource(sourceDict);
    if (!source) {
      io.stderr.write('quotabar --parse-custom: cannot decode\n');
      return 2;
    }
    const total = valueAt(source.limitPath, payload);
    if (total === null || total <= 0) {
      io.stdout.write(`error: limitPath '${source.limitPath}' not found or zero\n`);
      return 1;
    }
    const used = valueAt(source.usedPath, payload) ?? 0;
    io.stdout.write(`${source.id}=${Math.trunc((used / total) * 100)}% [${swiftDouble(used)}/${swiftDouble(total)}]\n`);
    return 0;
  }

  return null; // no CLI flag — the caller should run the app
}

/// quotabar --probe [zai|claude|codex|openrouter|copilot|antigravity] —
/// live fetch of one source (async; resolves with an exit code).
export async function runProbe(argv, io = process, config) {
  const probeIndex = argv.indexOf('--probe');
  const next = probeIndex + 1 < argv.length ? argv[probeIndex + 1] : 'zai';
  const target = ['claude', 'codex', 'openrouter', 'copilot', 'antigravity'].includes(next) ? next : 'zai';

  if (target === 'zai') {
    const { resolvedToken } = await import('./core/config.js');
    if (resolvedToken(config) === '') {
      io.stderr.write('quotabar --probe: no token. Set QUOTABAR_ZAI_TOKEN or ~/.quotabar/config.json\n');
      return 2;
    }
    const snap = await ZaiSource.fetchSnapshot(config);
    io.stdout.write('gauges: ' + snap.gauges.map((g) => `${g.id}=${Math.trunc(g.pct)}%`).join(' ') + '\n');
    io.stdout.write('authScheme: ' + (snap.usedScheme.trim() === '' ? '(raw)' : snap.usedScheme.trim()) + '\n');
    if (snap.errorMessage) io.stdout.write(`error: ${snap.errorMessage}\n`);
    io.stdout.write('--- raw ---\n');
    io.stdout.write((snap.rawJSON === '' ? '(none)' : snap.rawJSON) + '\n');
    return snap.errorMessage == null && snap.gauges.length > 0 ? 0 : 1;
  }

  let section;
  switch (target) {
    case 'claude': {
      const result = await ClaudeSource.fetch(config.sources?.claude);
      section = result.section;
      break;
    }
    case 'codex': {
      const result = await CodexSource.fetch(config.sources?.codex);
      section = result.section;
      break;
    }
    case 'openrouter': section = await OpenRouterSource.fetch(config.sources?.openrouter); break;
    case 'copilot': section = await CopilotSource.fetch(config.sources?.copilot); break;
    case 'antigravity': section = await AntigravitySource.fetch(); break;
    default: section = { id: target, title: target, gauges: [], errorMessage: 'unknown source', notice: undefined };
  }
  io.stdout.write(`section: ${section.title}\n`);
  io.stdout.write('gauges: ' + section.gauges.map((g) => `${g.id}=${Math.trunc(g.pct)}%`).join(' ') + '\n');
  if (section.notice) io.stdout.write(`notice: ${section.notice}\n`);
  if (section.gauges[0]?.resetAt) io.stdout.write(`resets: ${Math.trunc(section.gauges[0].resetAt.getTime() / 1000)}\n`);
  if (section.errorMessage) io.stdout.write(`error: ${section.errorMessage}\n`);
  return section.errorMessage == null && section.gauges.length > 0 ? 0 : 1;
}

// Direct invocation: node src/cli.js [flags]
if (process.argv[1] && process.argv[1].endsWith('cli.js')) {
  const code = runCli(process.argv.slice(1));
  if (code !== null) {
    process.exit(code);
  }
  if (process.argv.includes('--probe')) {
    const { loadConfig } = await import('./core/config.js');
    process.exit(await runProbe(process.argv.slice(1), process, loadConfig()));
  }
  process.stdout.write('usage: quotabar --parse <file> | --parse-claude|--parse-codex|--parse-openrouter|--parse-copilot|--parse-antigravity <file> | --parse-custom <config> <payload> | --probe [source]\n');
  process.exit(2);
}
