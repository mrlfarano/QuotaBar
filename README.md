# barstats

A native macOS menu-bar app (no dependencies) that visualizes quota/usage
information from external sources. First source: **Z.AI GLM Coding Plan**
usage against the rolling **5-hour window** and the **weekly limit**.

```
Status bar:  ▐█████████░░▌ 9h44m      ← battery bars floating in the bar:
                ↑ 5h battery (fill=left, band color) + headline countdown
                ▐████░░░▌ thinner weekly bar beneath (no text)
              calm when green — percent appears in yellow/red

Click → popover panel (vibrancy):
  Z.AI Coding Plan (max) · api.z.ai
  ◔ 5-hour window   98% left · Resets in 9h 44m
  ◔ Weekly limit    100% left · Resets Aug 31
  ◔ MCP monthly     97% left · 139 / 4.0k times used
      search-prime · 134   web-reader · 5
  Updated just now · poll 5m    [Refresh] [Raw JSON] [Token…] [Quit]

Right-click → utility menu (Refresh ⌘R · Copy Raw · Set Token… · Quit ⌘Q)
```

## Color bands

Applied to quota **remaining** (battery metaphor — red means you're about to
run out):

| Remaining | Used | Color | Chip |
|-----------|------|-------|------|
| ≥ 76% | ≤ 24% | 🟢 green | 🟢 |
| 26–75% | 25–74% | 🟡 yellow | 🟡 |
| ≤ 25% | ≥ 75% | 🔴 red | 🔴 |

The status item is two stacked battery-style meters (5h with a nub, weekly
thinner beneath) drawn as one image, with an escalating text label: green
shows only the reset countdown, yellow/red add the remaining percent in the
band color. Click opens a popover with progress rings, per-second countdowns,
per-model usage and footer actions; right-click opens the utility menu.

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
