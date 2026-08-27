# 006 — OpenRouter + Copilot + Antigravity providers (v0.9)

## Goal

Grow the roster by the three highest-value additions. Originally scoped as
"OpenRouter → Copilot → Gemini"; research pivoted the Google slot: Google
**stopped Gemini CLI for individuals on 2026-06-18** (community + CodexBar
issue #1178), and the remote `cloudcode-pa.googleapis.com` quota endpoints
403 for personal accounts. The Google surface that still exists is
**Antigravity**, so that's what v0.9 ships.

## Endpoints (pinned 2026-08-27)

### OpenRouter — official

- `GET https://openrouter.ai/api/v1/credits`, `Authorization: Bearer <key>`
- `data {label, usage, usage_bonus, limit, limit_remaining, is_free_tier}`
  (USD). `limit: null` = no per-key cap → notice row, no ring (honest
  display over a fake gauge). `is_free_tier` → title suffix.

### GitHub Copilot — internal (community-pinned, m0wer/joeskeen gists)

1. `GET api.github.com/copilot_internal/v2/token` (Bearer GitHub OAuth) →
   short-lived session `token`.
2. `GET api.github.com/copilot_internal/user` (Bearer session, fallback
   `token <oauth>`) with editor headers: `User-Agent: GitHubCopilotChat/…`,
   `Editor-Version`, `Editor-Plugin-Version`, `Copilot-Integration-Id:
   vscode-chat`.
- Gauge from `quota_snapshots.premium_interactions {entitlement, remaining,
  unlimited}` (used = entitlement − remaining); reset from top-level
  `quota_reset_date` — a bare `yyyy-MM-dd` date (monthly), needing a
  date-only parser fallback. `unlimited` → notice row.
- Token chain: config → opencode `~/.local/share/opencode/auth.json`
  (`github-copilot.refresh`|`.access`) → VS Code
  `~/.config/github-copilot/{hosts,apps}.json` (`github.com.oauth_token`).

### Antigravity — local-only (pinned from CodexBar OSS + local spike)

- The IDE's persisted `state.vscdb` quota blob (`userStatus` field 38) is
  **encrypted** (Antigravity Safe Storage) — DB route dead. `modelCredits`
  key exists but is empty (length 0).
- Live probe: find `language_server` / `agy` process (binary name +
  antigravity marker), read `--csrf_token` / `--extension_server_port` /
  `--extension_server_csrf_token` from its command line, get listening
  ports via `lsof -nP -iTCP -sTCP:LISTEN -a -p PID`.
- `POST https://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetUserStatus`
  body `{"metadata":{}}`, header `X-Codeium-Csrf-Token`; self-signed cert
  accepted for 127.0.0.1/localhost/::1 only (ephemeral URLSession +
  delegate). HTTP fallback on the extension-server port.
- Response: `userStatus {email, userTier.name ?? planStatus.planInfo.planName,
  cascadeModelConfigData.clientModelConfigs[] {label, quotaInfo
  {remainingFraction, resetTime}}}`. Pool collapse: Gemini family (minus
  lite/image/tab) and Claude+GPT family, each reporting its
  most-constrained member (min remainingFraction). No network leaves the
  machine; app closed → explicit "open the app" error.

## Config + wiring

- `SourcesConfig` += `openrouter` / `copilot` / `antigravity`
  (`OAuthSourceConfig?`, unused fields nil; old configs decode).
- `SourceSection.notice` added — non-error info rows render without ⚠︎.
- Discovery: OPENROUTER_API_KEY fills empty token; copilot auth-file
  presence enables live-read entry; Antigravity app-data dir enables the
  local source. Same never-overwrite/never-touch-disabled rules.
- Probe/parse dispatch generalized to a registry; `--parse-copilot`,
  `--parse-openrouter`, `--parse-antigravity` (section-style parses also
  surface notices/errors on stderr).

## Verification evidence (2026-08-27)

- `swift build -c release` clean, zero warnings.
- Fixtures: `--parse-openrouter` → `openrouter-credits=33%` (3.27/10);
  `--parse-copilot` → `copilot-premium=20% resets@1788220800`
  (2026-09-01 date-only reset); `--parse-antigravity` →
  `antigravity-gemini=69% antigravity-claude-gpt=55%` (pool mins 0.31/0.45,
  image model correctly excluded).
- Regressions: claude/codex/zai fixture parses byte-identical; live
  `--probe codex` (`5h=8% weekly=1%`), `--probe zai` healthy.
- Live error states (designed): antigravity "not running", openrouter "no
  API key", copilot "no token".
- Live positive for Antigravity impossible: IDE uninstalled on this machine
  (`~/.antigravity/.../bin/agy` is a dangling symlink); fixture is CodexBar's
  real captured payload. Source activates via discovery when the app returns
  (app-data dir still present).

## Out of scope / deferred

- Antigravity `RetrieveUserQuotaSummary` (Antigravity 2.0 grouped weekly/
  session windows) and the `agy` CLI PTY-spawn fallback for app-closed
  readings (CodexBar-style).
- Official cost APIs (Anthropic Admin, OpenAI org costs).
- Gemini CLI source: dead for individuals since 2026-06-18.
