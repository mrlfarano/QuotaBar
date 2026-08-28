// Credential-file helpers shared by discovery and the OAuth sources.
// Paths arrive as "~/.claude/.credentials.json"-style (tilde = home, like
// NSString.expandingTildeInPath); candidates are tried in order and the
// first readable JSON object wins.

import fs from 'node:fs';
import os from 'node:os';
import { join as pathJoin } from 'node:path';
import { objectFrom } from './jsonutil.js';

export function expandTilde(p) {
  // Windows-style %VAR% expansion first (LOCALAPPDATA, APPDATA, …).
  const expanded = p.replace(/%([^%]+)%/g, (whole, name) => process.env[name] ?? whole);
  if (expanded === '~') return os.homedir();
  if (expanded.startsWith('~/')) return pathJoin(os.homedir(), expanded.slice(2));
  return expanded;
}

// path.join normalizes Windows separators for cross-platform candidates.

export function readJSONCandidates(pathCandidates) {
  for (const candidate of pathCandidates) {
    try {
      const text = fs.readFileSync(expandTilde(candidate), 'utf8');
      const parsed = objectFrom(text);
      if (parsed) return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function fileExists(pathCandidates) {
  for (const candidate of pathCandidates) {
    try {
      fs.statSync(expandTilde(candidate));
      return true;
    } catch {
      // try the next candidate
    }
  }
  return false;
}
