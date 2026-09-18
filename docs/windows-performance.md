# Windows 0.12.0 resource check

Measured September 18, 2026 on Windows 11 build 26200, 16 logical processors,
Electron 44.0.0. Three fresh runs each: baseline `08a0c07` and the Instrument
implementation. Synthetic demo data, isolated profiles, no provider networking.
Memory is the sum of Electron process private bytes, reported in MiB.

| Median | Previous build | Instrument |
| --- | ---: | ---: |
| Tray idle, before opening UI | 109.7 MiB | 107.2 MiB |
| UI open | 163.6 MiB | 166.5 MiB |
| Six seconds after closing UI | 134.4 MiB | 135.4 MiB |
| Renderer processes after closing | 0 | 0 |
| Window load time | 104 ms | 110 ms |

All three idle samples, baseline: 112.4, 109.7, 108.5 MiB. Instrument:
108.1, 107.2, 106.3 MiB. After closing: baseline 138.6, 134.4, 133.5 MiB;
Instrument 136.8, 135.4, 135.0 MiB. These small differences do **not** demonstrate
a substantial memory improvement. Electron retains browser/GPU allocations after
a window closes even though the renderer exits.

The previous UI sample opens Settings; the new sample opens the usage panel.
They are different workloads. Windows are hidden for automation, with hardware
acceleration enabled. Load time ends at `did-finish-load`, not first visible paint.
Each idle sample is five seconds. These are lifecycle checks, not long-duration,
live-provider, animation smoothness, or battery benchmarks. Aggregate Electron
CPU counters were non-monotonic in some startup samples and were discarded;
**no measured CPU reduction is claimed**.

Verified implementation changes: no hidden usage renderer, no recurring demo
animation, no 20-second polling tick, no rebuilding the full native menu after
every provider response, and no regenerating unchanged tray ring images. One
timeout schedules normal refreshes; pause/manual modes stop automatic fetches.
Provider parsers and existing authentication flows are retained.

## Reproduce

From the repository root, after installing Windows dependencies:

```powershell
$env:QUOTABAR_MEASURE_HOME = Join-Path $PWD 'build/footprint/current'
New-Item -ItemType Directory -Force $env:QUOTABAR_MEASURE_HOME
& windows/node_modules/electron/dist/electron.exe windows/scripts/measure-footprint.mjs
```

Results are written to `result.json` in that isolated directory. Set
`QUOTABAR_MEASURE_ENTRY` to an absolute path to another checkout's
`windows/src/trayapp.js` to compare it using the same Electron binary.
The script creates synthetic settings only, blocks fetch, and never launches
credential discovery. Repeat using fresh directories. It measures memory and
renderer lifecycle; CPU requires a separate stable process-level trace.

Next foundation decision needs a like-for-like native prototype and longer
visible-window, live-polling traces. This release evolves the approved interface;
it does not settle the Electron-versus-native decision.
