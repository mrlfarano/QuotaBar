# barstats

A native macOS menu-bar app (no dependencies) that visualizes quota/usage
information from external sources. First source: **Z.AI GLM Coding Plan**
usage against the rolling **5-hour window** and the **weekly limit**.

```
Status bar:  [◉] 5h 76% left · 2h47m · wk 42% left
             ring fill + % colored by band; ⚠︎ states on errors

Menu (click):
  Z.AI Coding Plan (max) · api.z.ai
  5-hour window   █████░░░░░░░  24% used · 76% left
      28.8k / 120k tokens · Resets in 2h 47m
  Weekly limit    ███████░░░░░  58% used · 42% left
      34.8k / 60k tokens · Resets in 4d 3h
  MCP monthly     █░░░░░░░░░░░   3% used · 97% left
      139 / 4.0k tokens · Resets in 9d
  Updated 18:02 (just now), poll 5m
  ─────────────────────────────
  Refresh Now           ⌘R
  Copy Raw Response
  Set Token…
  ─────────────────────────────
  Quit barstats         ⌘Q
```

## Color bands

Applied to quota **remaining** (battery metaphor — red means you're about to
run out):

| Remaining | Used | Color |
|-----------|------|-------|
| ≥ 76% | ≤ 24% | 🟢 green |
| 26–75% | 25–74% | 🟡 yellow |
| ≤ 25% | ≥ 75% | 🔴 red |

The status-bar ring shows the 5-hour window's remaining fraction in its band
color, followed by multi-color text (remaining %, reset countdown, weekly).
Menu bars use the same banding. Thresholds live in
`UsageBand.of(remainingPct:)` in `Sources/barstats/Visualization.swift`.

## Build & run

```sh
scripts/make-app.sh                 # swift build -c release + build/BarStats.app
open build/BarStats.app             # menu bar app (accessory, no Dock icon)

.build/release/barstats --demo      # synthetic gauges, no network/token needed
.build/release/barstats --probe     # fetch once, print parsed gauges + raw JSON
.build/release/barstats --parse payload.json   # run the parser on a saved payload
```

## Credential setup

The app needs the same credential the z.ai dashboard itself uses:

1. Sign in at [z.ai](https://z.ai) and open the usage page
   (`z.ai/manage-apikey/coding-plan/personal/usage`)
2. DevTools → Application → Local Storage → `https://z.ai`
3. Copy the value of **`z-ai-open-platform-token-production`**

Then use **Set Token…** in the app menu (it tests the token against the
endpoint before saving), or write it manually:

```sh
mkdir -p ~/.barstats
printf '{"zaiToken":"YOUR_TOKEN"}\n' > ~/.barstats/config.json
chmod 600 ~/.barstats/config.json
```

or export `BARSTATS_ZAI_TOKEN` before launching. The client tries
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
  `~/.barstats/last-snapshot.json` so relaunches show data immediately.
- The 5-hour quota refreshes dynamically ~5h after consumption; weekly resets
  on a fixed day based on subscription start (docs.z.ai devpack overview/FAQ).

## Roadmap

- In-app OAuth sign-in (chat.z.ai authorize → zcode.z.ai token exchange →
  api.z.ai business login) to remove the copy-from-browser step.
- More sources behind the same menu (the source layer is generic: fetch raw +
  gauges).
