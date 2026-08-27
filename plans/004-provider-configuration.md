# Plan 004 — Provider configuration: custom sources + main-source selection

- **Planned by:** GLM-5.3 · **Executor:** GLM-5.3 (session precedent)
- **Goal:** users add arbitrary providers via config (no recompile) and pick
  which provider drives the status bar.

## Config schema (v2, fully backward-compatible)

```jsonc
// ~/.barstats/config.json
{
  "zaiToken": "…",                  // unchanged
  "mainSource": "zai",              // NEW: id shown on the status bar; default "zai"
  "sources": {                      // all optional; absent ⇒ current behavior
    "zai":    { "enabled": true },
    "github": { "enabled": true, "token": "" },   // unchanged shape
    "custom": [                                    // NEW: user-defined providers
      {
        "id": "openrouter",
        "title": "OpenRouter credits",             // optional; defaults to id
        "url": "https://openrouter.ai/api/v1/credits",
        "token": "",                               // optional; sent as Bearer
        "headers": { "X-Key": "v" },               // optional extra headers
        "usedPath":  "data.usage",                 // dot paths into the JSON;
        "limitPath": "data.limit",                 // array indices allowed (a.0.b)
        "resetPath": "data.reset_at"               // optional: epoch s/ms or ISO8601
      }
    ]
  }
}
```

Rules: unknown source id in `mainSource`, or one that errors/yields no
gauges → fall back to zai → then first healthy section → else transient
"⚠︎ no data". Menu sections keep order zai, github, customs.

## Implementation

1. `QuotaProvider.swift`:
   - `CustomSourceConfig` struct per schema (+`SourcesConfig.custom: [CustomSourceConfig]?`,
     `BarStatsConfig.mainSource: String? = nil`).
   - `value(at path:)` dot-path resolver over `[String: Any]` (dict keys +
     integer indices; numeric strings accepted; epoch/ISO handled by the
     existing date helper, made internal).
   - `CustomSource.fetch(_:) async -> SourceSection` (section.id = custom id).
2. `GitHubSource`: add `id = "github"` to its section; zai section gets
   `id = "zai"` in main.swift.
3. `main.swift`:
   - Keep `snapshot` = zai (cache semantics unchanged). Fetch customs in the
     same parallel refresh; store `sections` (now includes ids).
   - `statusGauges()` resolves main→fallback chain.
   - Status bar glyph: outer ring = first gauge of the resolved section,
     inner = second gauge if any (already how dualRingImage works).
     Escalation text/headline + tooltip use the resolved gauges.
   - Menu footer adds "Status Bar Source:" radio list (NSMenuItem state .on)
     over known ids; selecting writes `config.mainSource`, saves, rebuilds.
4. Debug gate: `--parse-custom <configFile> <payloadFile>` prints
   `id=pct% [used/limit] resets@epoch` without network.
5. README: providers chapter with copy-paste example.

## Acceptance gates

1. Build 0 err/0 warn; four z.ai fixtures byte-identical.
2. `--parse-custom testdata/custom-config.json testdata/custom-payload.json`
   → exact expected string (covers nested dict + array-index paths).
3. Old-config compatibility: agent relaunch with existing live config keeps
   token + healthy snapshot (`gauges=3 err=none`).
4. Live custom-source harness: fetch github rate_limit through
   CustomSource with realistic dot paths → gauge matches direct curl values.
5. Screenshots demo+live; radio list verified present in rebuilt menu code
   path (demo run) via screenshot showing unchanged bar; commit+tag v0.6+push.

## Out of scope

Per-source icons in menu UI; tokens for customs entered via GUI dialog
(file only for now); auth schemes other than Bearer/no-auth for customs.
