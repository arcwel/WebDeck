# Performance

Baselines for the built fork, measured with the repeatable harness
[`app/scripts/perf.mjs`](../app/scripts/perf.mjs) (TASKS.md 10.4).

```bash
npm --prefix app run perf                       # human report, 5 tabs
npm --prefix app run perf -- --tabs 10 --agents 3 --json
npm --prefix app run perf -- --max-startup-ms 2000 --max-rss-mb 800 --max-tab-mb 60
```

Exit `0` measured (and within thresholds) · `1` a `--max-*` threshold was
exceeded (use it as a regression gate) · `2` could not measure.

## What it measures, and why that way

- **Startup** — spawn → CDP answers → the `chrome://webdeck` target exists →
  the `webdeck-core` child appears. Wall-clock from launch, on the real binary.
- **Memory** — the _whole process tree_ (browser, every renderer, GPU,
  network/storage services, `webdeck-core`), because Chromium is many processes
  and a tab's memory lives in its own renderer. Summing one PID would hide the
  number 10.4 asks for.
- **Physical footprint, not RSS.** RSS is the wrong headline for Chromium: the
  ~100 MB framework is mapped into _every_ renderer and `ps` counts those
  shared resident pages once per process. RSS therefore reports a blank tab at
  ~120 MB when its unique memory is ~30 MB. The harness uses macOS `footprint`
  (what the OS actually charges the process) and shows RSS beside it.
- **Per-tab cost = the tab's own renderer delta.** The whole-tree delta is
  reported too but is noisy: the GPU process sheds and reclaims compositing
  memory as surfaces come and go (swings of ±40–90 MB), which is not a per-tab
  cost.
- **Agents** (`--agents M`) start mock sessions on the core (`AGWEB_AGENT_MOCK=1`,
  inherited by the spawned core) and report the core's delta.

## Baseline — 2026-09-01, Apple M4 Pro (14 cores, 24 GB), release build

| Metric                                                      | Value                                          |
| ----------------------------------------------------------- | ---------------------------------------------- |
| Startup → CDP                                               | 250–340 ms (first cold run 730 ms)             |
| Startup → shell target                                      | 260–345 ms (first cold run 755 ms)             |
| Startup → core spawned                                      | 290–375 ms (first cold run 920 ms)             |
| Settled footprint, 10 processes                             | **520–545 MB** (RSS 1,133 MB — double-counted) |
| … GPU process                                               | 216–238 MB                                     |
| … shell renderer (`chrome://webdeck`: React + Monaco + IDE) | 158–160 MB                                     |
| … browser process                                           | 74 MB                                          |
| … webdeck-core                                              | 28 MB                                          |
| … network / storage services                                | 25 / 19 MB                                     |
| **Per tab** (own renderer)                                  | **≈ 30 MB** (29.6–29.7, flat across 5 tabs)    |
| Browser-process growth per tab                              | ≈ 0.8 MB                                       |
| 3 mock agents → core delta                                  | +0.1 MB (≈ 0 per agent)                        |
| Standalone core, ready                                      | 33–38 ms                                       |
| Standalone core, RSS                                        | 60 MB                                          |

## Findings

1. **Startup is fast** — the shell is reachable in well under half a second
   warm, under a second cold.
2. **Per-tab cost is healthy** (~30 MB). The ~120 MB/tab figure RSS gives is
   an artefact of shared-page double counting, not a leak: the shell renderer
   and the browser process do not grow meaningfully per tab, so there is no
   per-tab state leaking in WebDeck's own code.
3. **Agents are essentially free** on the core; their real cost is provider I/O,
   not resident memory.
4. **The GPU process is the largest single consumer** (~220–240 MB, larger than
   the whole IDE shell). That is compositing for the glass UI and the staged
   page. It is not a defect, but it is the first place to look for a memory win
   (blur/backdrop-filter layers and offscreen surfaces).
5. **The shell renderer at ~160 MB** is the cost of shipping a full IDE
   (Monaco/VS Code service layer) in a WebUI; its unique memory is a fraction
   of its ~515 MB RSS.

## Re-run — 2026-09-14, v0.1.6, same machine (RSS basis)

`footprint` did not answer on this machine that day — process inspection was
blocked at the OS level (the same block stopped every lldb-based debugger from
launching a program) — so the harness fell back to RSS, which double-counts the
shared framework pages. These numbers are therefore not comparable to the
footprint baseline above; the startup and per-process-type _deltas_ are.

| Metric                         | Value                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Startup → CDP / shell / core   | 424 / 426 / 632 ms (one cold run)                                                       |
| Settled RSS, 13 processes      | 1,935 MB (renderers 1,205 · browser 236 · GPU 190 · core 140 · network 92 · storage 72) |
| Per tab, own renderer (RSS)    | ≈ 103 MB — the shared-page artefact the baseline explains; ~30 MB unique                |
| Browser-process growth per tab | ≈ 2.8 MB RSS                                                                            |
| 3 mock agents → core delta     | +0.2 MB (0.1 per agent)                                                                 |
| Standalone core, ready / RSS   | 1,342 ms (cold, first launch after install) / 62 MB                                     |

Reading: nothing in WebDeck's own processes grows per tab beyond noise (browser
+2.8 MB, core +0.1 MB), and agents stay free. The shell renderer's share is
inside the 1,205 MB renderer figure with five page renderers; a footprint
re-run on a machine where `footprint` answers is the number to compare with
the baseline.

The harness now bounds each `footprint` call (3 s) and falls back to RSS with a
note (`--rss` forces it), so a blocked machine produces a report instead of a
hang; the JSON carries `memory.basis`.

## Follow-ups (not blockers)

- Profile the GPU process's compositing layers under the glass theme (4).
- Extend the harness with a `--baseline <json>` diff so CI can gate on a
  committed baseline rather than fixed `--max-*` numbers.
- The harness runs headless with `--use-mock-keychain`; a real-display run may
  differ slightly in GPU memory.
