# QuotaBar

A native macOS menu-bar app (no dependencies) that visualizes quota/usage
information from external sources. First source: **Z.AI GLM Coding Plan**
usage against the rolling **5-hour window** and the **weekly limit**.

```
Status bar:  [◎ dual ring: outer = 5h, inner = weekly] 9h24m
             green state shows only the reset countdown;
             yellow/red add the colored percent (41% · 43m, 18% · 12m ⚠︎)

Menu (click):
  Z.AI Coding Plan (max) · api.z.ai
  5-hour window   █████░░░░░░░  24% used · 76% left
      28.8k / 120k tokens · Resets in 2h 47m
  Weekly limit    ███████░░░░░  58% used · 42% left
      34.8k / 60k tokens · Resets in 4d 3h
  MCP monthly     █░░░░░░░░░░░   3% used · 97% left
      139 / 4.0k tokens · Resets in 9d
  ─────────────────────────────
  GitHub API · rate limit
  Core requests   █░░░░░░░░░░░   8% used · 92% left
      5 / 60 requests · Resets in 40m
  ─────────────────────────────
  Claude (Pro/Max) · usage
  5-hour window   ██████░░░░░░  41% used · 59% left
      Resets in 2h 13m
  Weekly limit    ██░░░░░░░░░░  18% used · 82% left
      Resets in 4d 12h
  ─────────────────────────────
  Codex (plus) · usage
  5-hour window   ░░░░░░░░░░░░   0% used · 100% left
  Weekly limit    ████░░░░░░░░  36% used · 64% left
      Resets in 4d 22h
  ─────────────────────────────
  Updated 18:02 (just now), poll 5m
  ─────────────────────────────
  Refresh Now           ⌘R
  Copy Raw Response
  Set Token…
  Discover Sources      ⌘D
  ─────────────────────────────
  Quit QuotaBar         ⌘Q
```

## Color bands

Applied to quota **remaining** (battery metaphor — red means you're about to
run out):

| Remaining | Used | Color |
|-----------|------|-------|
| ≥ 76% | ≤ 24% | 🟢 green |
| 26–75% | 25–74% | 🟡 yellow |
| ≤ 25% | ≥ 75% | 🔴 red |

The status item is one 20×20 glyph: an outer ring for the 5-hour quota and
an inner ring for the weekly quota, both filling clockwise in their band
color. The text escalates with severity — countdown only when green, colored
percent from yellow, warning glyph on red. Design previews live in
`docs/design/`. Thresholds live in `UsageBand.of(remainingPct:)` in
`Sources/quotabar/Visualization.swift`.

## Build & run

```sh
scripts/make-app.sh                 # swift build -c release + build/QuotaBar.app
open build/QuotaBar.app             # menu bar app (accessory, no Dock icon)

.build/release/quotabar --demo      # synthetic gauges, no network/token needed
.build/release/quotabar --probe     # fetch once (z.ai), print parsed gauges + raw JSON
.build/release/quotabar --probe claude   # one-shot Claude usage check
.build/release/quotabar --probe codex    # one-shot Codex usage check
.build/release/quotabar --parse payload.json        # z.ai parser on a saved payload
.build/release/quotabar --parse-claude payload.json # Claude parser on a fixture
.build/release/quotabar --parse-codex payload.json  # Codex parser on a fixture
```

## Launch at login

```sh
scripts/install-login.sh     # build, copy app to ~/Applications, install LaunchAgent
scripts/uninstall-login.sh   # remove the agent (app stays in ~/Applications)
```

The agent (`com.la.quotabar`) starts the app at login with `RunAtLoad`;
quitting the app keeps it quit until the next login.

## Providers

Each provider renders as its own menu section. The **status bar** shows the
provider selected under "Status Bar Source:" in the menu (stored as
`mainSource`), falling back to z.ai if it fails.

Built-ins:

- **Z.AI Coding Plan** (`zai`) — primary coding-plan usage; token via Set
  Token… (see below).
- **GitHub API rate limit** (`github`) — on by default, no credentials
  (60/hr core budget); add a token for 5000/hr:
- **Claude Pro/Max** (`claude`) — 5-hour + weekly utilization via Claude
  Code's own OAuth session (unofficial endpoint, see below).
- **Codex / ChatGPT plan** (`codex`) — 5-hour + weekly windows via the
  Codex CLI's stored ChatGPT OAuth token (unofficial endpoint, see below).

  ```json
  { "sources": { "github": { "enabled": true, "token": "ghp_…" } } }
  ```

**Any other JSON provider** can be added without recompiling via `custom`:

```json
{
  "mainSource": "openrouter",
  "sources": {
    "custom": [
      {
        "id": "openrouter",
        "title": "OpenRouter credits",
        "url": "https://openrouter.ai/api/v1/credits",
        "token": "sk-or-…",
        "headers": { "X-Title": "quotabar" },
        "usedPath":  "data.usage",
        "limitPath": "data.limit",
        "resetPath": "data.reset_at"
      }
    ]
  }
}
```

Paths are dot-separated into the response JSON (`data.usage`, `items.0.left`);
arrays use integer indices. `token` is sent as `Authorization: Bearer …`;
extra headers via `headers`. `resetPath` accepts epoch seconds/milliseconds
or ISO8601 and feeds the countdown.

## Auto-discovery (Claude, Codex, GitHub)

At launch — and any time via **Discover Sources** (⌘D) — QuotaBar scans
well-known CLI credential locations and enables the matching sources:

| Source | Looks at | Stores in config |
|--------|----------|------------------|
| `claude` | `~/.claude/.credentials.json` (`claudeAiOauth.accessToken`) | nothing — reads the file live |
| `codex`  | `~/.codex/auth.json` (`tokens.access_token`, `tokens.account_id`) | nothing — reads the file live |
| `github` | `GH_TOKEN` / `GITHUB_TOKEN` env vars | the token |

Rules: an `enabled: false` entry is never touched; a user-set token is never
overwritten; discovered entries are marked `"discovered": true`. Deleting an
entry re-enables discovery for that source on the next scan. The macOS
Keychain is deliberately not scanned.

**Claude**: uses the same OAuth session Claude Code uses
(`api.anthropic.com/api/oauth/usage`, beta `oauth-2025-04-20`). If the
stored access token expires, QuotaBar refreshes it via
`api.anthropic.com/v1/oauth/token`; when that fails (Claude Code hasn't run
recently) the menu shows
"run `claude` once to re-authenticate" — opening Claude Code refreshes the
credential file and QuotaBar picks it up on the next poll.

**Codex**: mirrors the Codex CLI (`chatgpt.com/backend-api/wham/usage`,
`ChatGPT-Account-Id` header). On 401 it refreshes via
`auth.openai.com/oauth/token` and keeps the rotated tokens in
`~/.quotabar/config.json`; `~/.codex/auth.json` is never written. Refresh
tokens can rotate — if Codex CLI later re-auths, its copy wins again
automatically (the file is re-read live unless a refresh result is stored).

Both endpoints are reverse-engineered from the CLIs' own traffic and can
change without notice. They expose percentage utilization only, so gauge
detail rows show the reset countdown (no used/total token counts).

The source layer is generic (`SourceSection` = id + title + gauges + error);
a compiled-in third built-in is a fetch function plus a config flag.

## Credential setup

The app needs the same credential the z.ai dashboard itself uses:

1. Sign in at [z.ai](https://z.ai) and open the usage page
   (`z.ai/manage-apikey/coding-plan/personal/usage`)
2. DevTools → Application → Local Storage → `https://z.ai`
3. Copy the value of **`z-ai-open-platform-token-production`**

Then use **Set Token…** in the app menu (it tests the token against the
endpoint before saving), or write it manually:

```sh
mkdir -p ~/.quotabar
printf '{"zaiToken":"YOUR_TOKEN"}\n' > ~/.quotabar/config.json
chmod 600 ~/.quotabar/config.json
```

Upgrading from **barstats**? The config file moved — carry your token over:

```sh
mkdir -p ~/.quotabar && mv ~/.barstats/config.json ~/.quotabar/
```

or export `QUOTABAR_ZAI_TOKEN` before launching. The client tries
`Authorization: Bearer <token>` first (what the dashboard sends) and falls
back to the raw header, remembering whichever style the server accepted.

## The API contract (reverse-engineered from the official dashboard bundle)

The usage page (`/_next/static/chunks/9851-*.js`, module 45268 + axios module
89857 in `9857-*.js`) calls:

```
GET https://api.z.ai/api/monitor/usage/quota/limit?type=2
Authorization: Bearer <localStorage token>
Accept-Language: en-US,en
refer: https://z.ai/manage-apikey/coding-plan/personal/usage
```

Response:

```json
{ "code": 200, "success": true,
  "data": { "limits": [
    { "type": "TOKENS_LIMIT", "unit": 3,          // 5-hour token window
      "percentage": 34.5, "currentValue": 41400, "usage": 120000,
      "nextResetTime": 1787891200000,             // epoch ms
      "usageDetails": [ { "modelCode": "glm-5.3", "usage": 30000 } ] },
    { "type": "TOKENS_LIMIT", "unit": 6,          // weekly token window
      "percentage": 17, "currentValue": 10200, "usage": 60000,
      "nextResetTime": 1788105600000, "usageDetails": [] } ] } }
```

`unit` 3 → 5-hour window, 6 → weekly, 5 → MCP monthly (ignored). The parser
uses this pinned shape and falls back to keyword-based adaptive parsing if
the shape ever changes. Sibling endpoints in the same module (not yet used):
`/monitor/usage/model-usage`, `/monitor/usage/tool-usage`,
`/monitor/credit-usage/activity`.

- Poll every `pollMinutes` (default 5); last snapshot cached in
  `~/.quotabar/last-snapshot.json` so relaunches show data immediately.
- The 5-hour quota refreshes dynamically ~5h after consumption; weekly resets
  on a fixed day based on subscription start (docs.z.ai devpack overview/FAQ).

## Roadmap

- Official cost/credit APIs as additional sources: Anthropic Admin
  `cost_report` + OpenAI `/v1/organization/costs` month-to-date spend vs a
  configurable monthly limit, and OpenRouter `/api/v1/credits`.
- In-app OAuth sign-in (chat.z.ai authorize → zcode.z.ai token exchange →
  api.z.ai business login) to remove the copy-from-browser step.
- More sources behind the same menu (the source layer is generic: fetch raw +
  gauges).
