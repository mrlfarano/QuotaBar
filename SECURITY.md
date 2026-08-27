# Security Policy

## Supported versions

Only the latest [release](https://github.com/mrlfarano/QuotaBar/releases/latest)
receives security fixes.

## Reporting a vulnerability

**Please don't open a public issue for security problems.**

Use GitHub's private vulnerability reporting instead:
**Security → "Report a vulnerability"** on
[github.com/mrlfarano/QuotaBar/security/advisories](https://github.com/mrlfarano/QuotaBar/security/advisories).
Include what you found, how to reproduce it, and its impact. You'll get a
response within a few days.

## What QuotaBar handles — high-value areas

This app's whole domain is third-party credentials, so reports in these
areas are especially relevant:

- Reads Claude Code (`~/.claude/.credentials.json`) and Codex
  (`~/.codex/auth.json`) credential files; it must never write to them.
- Stores tokens in `~/.quotabar/config.json` (owner-only, 0600).
- Sends each provider's token **only to that provider's own usage endpoint**
  (see `plans/` for the pinned endpoints).

Anything that exfiltrates credentials off the machine, leaks them into
logs/screenshots/crash reports, or sends a token to a party other than its
matching provider is exactly what we want to hear about.

## Out of scope

- The z.ai / Claude / Codex usage endpoints being unofficial or
  reverse-engineered — that's documented openly in the README and `plans/`,
  and sources degrade to error states rather than stale numbers.
- Vulnerabilities in the providers' own APIs or CLIs — report those upstream.
