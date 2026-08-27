# 005 — Claude Max + Codex quota rings with auto-discovery (v0.8)

## Goal

Two new built-in sources showing 5-hour + weekly utilization rings like the
z.ai source, enabled automatically when the corresponding CLI credentials
exist on disk. Chosen over official cost APIs (Anthropic Admin `cost_report`,
OpenAI `/v1/organization/costs`, OpenRouter credits) which are deferred to a
later version — rings match the app's metaphor; cost APIs show $ spend.

## Endpoints (reverse-engineered, pinned live 2026-08-27)

### Codex — verified live (HTTP 200)

- `GET https://chatgpt.com/backend-api/wham/usage`
- Headers: `Authorization: Bearer <access_token>`, `ChatGPT-Account-Id: <account_id>`
- Credential: `~/.codex/auth.json` → `tokens.access_token`, `tokens.account_id`
- Response: `plan_type`, `rate_limit.primary_window` (5h, 18000s) /
  `secondary_window` (weekly, 604800s) with `used_percent`, `reset_at`
  (epoch s), `reset_after_seconds`. Fixture: `testdata/codex-usage.json`
  (live payload, identity fields redacted).

### Claude — endpoint confirmed; local token expired

- `GET https://api.anthropic.com/api/oauth/usage`
- Headers: `Authorization: Bearer <oauth token>`, `anthropic-beta: oauth-2025-04-20`,
  `anthropic-version: 2023-06-01`
- Response buckets: `five_hour` / `seven_day` / `seven_day_sonnet`, each
  `{ utilization: 0-100, resets_at: ISO8601|null }` (shape per the
  `claude_quota` crate's wire-format documentation; fixture reconstructed:
  `testdata/claude-usage.json`).
- Live probe with the stored token returned 401 "OAuth access token has
  expired" — the machine's `~/.claude/.credentials.json` is from Jul 20.
- Refresh: `POST https://api.anthropic.com/v1/oauth/token`,
  `{grant_type: refresh_token, client_id: 9d1c250a-e61b-44d9-88ed-5944d1962f5e}`.
  Verified endpoint semantics live (returns proper OAuth
  `invalid_grant: Refresh token expired` — the stored refresh token is dead
  too, so a Claude Code re-login is required once). `claude.ai/api/oauth/refresh`
  is Cloudflare-gated for non-browser clients (403 HTML) — not usable.
- Error UX when unrefreshable: section error "run `claude` once to
  re-authenticate, then Discover Sources"; the CLI rewrites the credential
  file on re-auth and QuotaBar re-reads it live on the next poll.

## Token-chain design (both sources)

1. config `token` (set only by refresh results or manual edit) →
2. CLI auth file read live at fetch time (stays fresh when the CLI is used) →
3. refresh on 401/403 (persist rotated tokens into `~/.quotabar/config.json`;
   never write back to the CLI's own auth file — Codex's refresh token may
   rotate, and the CLI's copy must stay authoritative for the CLI).

## Discovery (`SourceDiscovery`)

Scan at launch (before first fetch) + "Discover Sources" (⌘D) menu item.

| Source | Location | Action |
|--------|----------|--------|
| claude | `~/.claude/.credentials.json` | create `sources.claude = {discovered: true}` (token stays empty ⇒ live file reads) |
| codex  | `~/.codex/auth.json` | create `sources.codex = {discovered: true}` |
| github | `GH_TOKEN` / `GITHUB_TOKEN` env | fill empty `sources.github.token` |

Rules: `enabled: false` never touched; user-set tokens never overwritten;
no Keychain access (explicit scope choice).

## Config schema

`SourcesConfig` gains optional `claude` / `codex: OAuthSourceConfig?`
(`{enabled=true, token="", refreshToken?, accountId?, discovered=false}`) —
absent keys decode to defaults, old configs unaffected.
`GitHubSourceConfig.discovered` is `Bool?` specifically because synthesized
Codable requires non-optional keys to be present.

## Wiring

Section order zai → github → claude → codex → customs. Sections appear only
when configured (default `?? false` for the new sources vs github's `?? true`
legacy default). `mainSource` radio list is generic over healthy sections, so
"claude"/"codex" are status-bar selectable with no extra code.

## Verification evidence (2026-08-27)

- `swift build -c release` — clean, zero warnings.
- `--parse-claude testdata/claude-usage.json` → `claude-5h=41% claude-weekly=18%`,
  exit 0; `--parse-codex testdata/codex-usage.json` → `codex-5h=0%
  codex-weekly=36%`, exit 0 (ISO8601 and epoch reset parsing both correct).
- `--probe codex` → live `codex-5h=0% codex-weekly=36%`, section
  "Codex (plus) · usage", exit 0.
- `--probe claude` → designed actionable error (token expired), exit 1.
- `--probe` (zai) → live gauges — old config still decodes, token intact.

## Out of scope / deferred

- Official cost APIs (Anthropic Admin cost_report, OpenAI org costs,
  OpenRouter credits) as budget-style gauges.
- Keychain credential reading.
- Codex refresh flow is implemented but not live-tested (testing would
  rotate the CLI's refresh token and risk breaking `codex login` state).
