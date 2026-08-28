// Port of AntigravitySource.swift — Google Antigravity quota from the IDE's
// own local Connect-RPC endpoint while it runs:
//   POST https://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetUserStatus
//   X-Codeium-Csrf-Token: <token from the process args>, body {"metadata":{}}
// No network leaves the machine. On macOS the Swift original shells out to
// ps/lsof; the Windows port uses Get-CimInstance (command lines) and
// Get-NetTCPConnection (listening ports) with a netstat fallback.

import { execFile } from 'node:child_process';
import { localRequest } from '../http.js';
import { objectFrom, leafNumber, leafDate } from '../jsonutil.js';
import { gauge } from '../parser.js';

export const id = 'antigravity';
export const title = 'Antigravity · usage';
export const getUserStatusPath = '/exa.language_server_pb.LanguageServerService/GetUserStatus';

export function section(error) {
  return { id, title, gauges: [], errorMessage: error, notice: undefined };
}

export async function fetch() {
  const process_ = await detectProcess();
  if (!process_) {
    return section('Antigravity not running — open the app to see quota');
  }
  const ports = await listeningPorts(process_.pid);
  const attempts = [];
  if (process_.csrfToken != null) {
    for (const port of ports) {
      attempts.push({ url: `https://127.0.0.1:${port}${getUserStatusPath}`, csrf: process_.csrfToken });
    }
  }
  if (process_.extensionPort != null) {
    for (const token of [process_.extensionCsrfToken, process_.csrfToken].filter((t) => t != null)) {
      attempts.push({ url: `http://127.0.0.1:${process_.extensionPort}${getUserStatusPath}`, csrf: token });
    }
  }
  if (attempts.length === 0) {
    return section('Antigravity is running but exposes no local endpoint (try restarting the app)');
  }

  for (const attempt of attempts) {
    const response = await localRequest(attempt.url, {
      method: 'POST',
      timeoutMs: 5000,
      headers: {
        'Content-Type': 'application/json',
        ...(attempt.csrf ? { 'X-Codeium-Csrf-Token': attempt.csrf } : {}),
      },
      body: '{"metadata":{}}',
    });
    if (!response || response.status !== 200) continue;
    const root = objectFrom(response.text);
    if (!root) continue;
    return sectionFrom(root);
  }
  return section("Antigravity's local endpoint answered but rejected the probe (app update?)");
}

/// Wire-format parser, exposed for `--parse-antigravity <fixture>`.
export function sectionFrom(root) {
  const code = typeof root.code === 'number' ? root.code : 0;
  if (code !== 0) return section(`Local API error code ${root.code ?? '?'}`);
  const userStatus = root.userStatus;
  if (!userStatus || typeof userStatus !== 'object' || Array.isArray(userStatus)) {
    return section('No userStatus in response');
  }
  const tier = planTier(userStatus);
  const sectionTitle = tier ? `Antigravity (${tier}) · usage` : title;

  const configs = userStatus.cascadeModelConfigData?.clientModelConfigs;
  const rows = { gemini: [], claudeGPT: [] };
  for (const configEntry of Array.isArray(configs) ? configs : []) {
    const label = configEntry?.label;
    const remaining = leafNumber(configEntry?.quotaInfo?.remainingFraction);
    if (typeof label !== 'string' || remaining === null) continue;
    const row = { label, remaining, resetAt: leafDate(configEntry.quotaInfo.resetTime) };
    const lower = label.toLowerCase();
    if (lower.includes('gemini') && !['lite', 'image', 'tab'].some((word) => lower.includes(word))) {
      rows.gemini.push(row);
    } else if (lower.includes('claude') || lower.includes('gpt')) {
      rows.claudeGPT.push(row);
    }
  }

  // Each pool reports its most-constrained member; agents share the pool.
  const gauges = [];
  for (const [pool, gaugeID, label] of [
    [rows.gemini, 'antigravity-gemini', 'Gemini quota'],
    [rows.claudeGPT, 'antigravity-claude-gpt', 'Claude + GPT quota'],
  ]) {
    if (pool.length === 0) continue;
    const worst = pool.toSorted((a, b) => a.remaining - b.remaining)[0];
    gauges.push(gauge(gaugeID, label, (1 - worst.remaining) * 100, { resetAt: worst.resetAt }));
  }
  if (gauges.length === 0) {
    return { id, title: sectionTitle, gauges: [], errorMessage: undefined, notice: 'Connected, but no usage fractions reported yet' };
  }
  return { id, title: sectionTitle, gauges, errorMessage: undefined, notice: undefined };
}

function planTier(userStatus) {
  const tier = userStatus.userTier?.name;
  if (typeof tier === 'string' && tier !== '') return tier;
  const plan = userStatus.planStatus?.planInfo?.planName;
  if (typeof plan === 'string' && plan !== '') return plan;
  return null;
}

// MARK: process discovery

let processMatch = null;

/// Antigravity's language_server (or the `agy` CLI). Matched on the binary
/// name plus the app-data marker so other Codeium-lineage tools are not
/// picked up.
async function detectProcess() {
  processMatch = null;
  if (process.platform === 'win32') {
    const output = await runCommand('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '$ps = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "language_server|language-server" };' +
      '@($ps) | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress',
    ]);
    if (output !== null) scanProcessLines(output);
  } else {
    const output = await runCommand('/bin/ps', ['-axo', 'pid=,command=']);
    if (output !== null) scanProcessLines(output);
  }
  return processMatch;
}

function scanProcessLines(output) {
  let entries = [];
  try {
    const parsed = JSON.parse(output);
    entries = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    entries = output.split('\n').map((line) => {
      const trimmed = line.trim();
      const space = trimmed.indexOf(' ');
      return space > 0 ? { ProcessId: trimmed.slice(0, space), CommandLine: trimmed.slice(space + 1) } : null;
    }).filter(Boolean);
  }
  for (const entry of entries) {
    const pid = Number(entry.ProcessId);
    const command = String(entry.CommandLine ?? '');
    if (!Number.isInteger(pid) || pid <= 0 || command === '') continue;
    const isLanguageServer = command.includes('language_server') || command.includes('language-server');
    const isMarked = command.toLowerCase().includes('antigravity') || command.includes('--app_data_dir antigravity');
    const isCLI = /(^|[ /])agy( |$)/.test(command);
    if (!((isLanguageServer && isMarked) || isCLI)) continue;
    processMatch = {
      pid,
      csrfToken: flagValue('csrf_token', command),
      extensionPort: flagValue('extension_server_port', command),
      extensionCsrfToken: flagValue('extension_server_csrf_token', command),
    };
    return;
  }
}

function flagValue(flag, command) {
  const match = new RegExp(`--${flag}[= ]([^ ]+)`).exec(command);
  return match ? match[1] : null;
}

async function listeningPorts(pid) {
  if (process.platform === 'win32') {
    const output = await runCommand('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$c = @(Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort);` +
      'ConvertTo-Json -Compress -InputObject $c',
    ]);
    if (output !== null) {
      try {
        const parsed = JSON.parse(output);
        if (Array.isArray(parsed)) return [...new Set(parsed.filter(Number.isInteger))];
      } catch {
        // fall through to netstat
      }
    }
    return await netstatPorts(pid);
  }
  const output = await runCommand('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(pid)]);
  const ports = [];
  for (const line of (output ?? '').split('\n')) {
    const last = line.trim().split(/\s+/).pop();
    const colon = last?.lastIndexOf(':');
    if (colon === undefined || colon === -1) continue;
    const port = Number(last.slice(colon + 1));
    if (Number.isInteger(port) && !ports.includes(port)) ports.push(port);
  }
  return ports;
}

// Get-NetTCPConnection fallback: netstat -ano, "TCP 127.0.0.1:45971 ... LISTENING <pid>".
async function netstatPorts(pid) {
  const output = await runCommand('netstat', ['-ano', '-p', 'tcp']);
  const ports = [];
  for (const line of (output ?? '').split('\n')) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || columns[3] !== 'LISTENING' || columns[4] !== String(pid)) continue;
    const colon = columns[1].lastIndexOf(':');
    if (colon === -1) continue;
    const port = Number(columns[1].slice(colon + 1));
    if (Number.isInteger(port) && !ports.includes(port)) ports.push(port);
  }
  return ports;
}

function runCommand(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 8000, windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      resolve(error && !stdout ? null : stdout ?? null);
    });
  });
}
