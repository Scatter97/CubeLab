# CubeLab status

**Updated:** 2026-11-03. This is the current implementation/verification record
and immediate work queue. [README.md](README.md) describes the product;
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) records current boundaries;
[ROADMAP.md](ROADMAP.md) lists the retained follow-ups alongside delivered work.

## Implemented checkpoint

- React/TypeScript/Vite local-first timer with 12 events: 3×3, 2×2, 4×4,
  3×3 OH, 5×5, 6×6, 7×7, Pyraminx, Skewb, Square-1, Clock and Megaminx.
  Official `cubing.js` scrambles and registry-driven visualizations are shipped.
- Inspection/penalties/warnings, named sessions, comments/actions, configurable
  average trimming, compact/expanded Time Trend, wheel/pinch/pan and historical
  PB statistics are implemented. Sessions use schema v4; settings use v9.
- A lazy Analytics dashboard adds global event/session/date/count/penalty
  filters, overview cards, progression and average charts, PB history,
  clickable distributions, consistency and Sub-X analysis, session comparison,
  practice activity, advanced percentiles/rankings, and a virtualized solve
  explorer. Section visibility, width, order and per-event Sub-X targets persist
  in synchronized settings. Charts support hover, keyboard inspection, zoom,
  pan, reset and solve drill-down.
- Local backups, additive csTimer import, optional immutable-snapshot Drive sync,
  conflict review/Undo, recovery, retention and cross-tab reconciliation exist.
- Floating 2D/PG3D tools, persisted drag/resize, light/dark/system themes and an
  offline-capable PWA are implemented.
- The first large-history stop patch captures input before audio/focus, animates
  the readout locally and delays expensive presentation. Saving and sync still
  receive current data. Enabled-sync guards remain in place.
- The desktop Statistics/Solves divider fits complete rows using independent
  normal/compact sizing samples, shares spare row space and accounts for display
  scaling. The split initializes again after mobile/desktop transitions; mobile
  retains every enabled statistic. This is separate from the floating-tool
  overlap follow-up below.
- The November 1 regression follow-up fixes active-session approval application,
  deterministic selection metadata (including envelope parsing/adoption), and
  csTimer malformed numeric/date validation before preview/confirmation.

Core phases 2A–4, theme polish, Phase 5 remediation and Phase 6a are delivered.
Future feature-phase proposals have been removed at the user's request. The
retained work is the five follow-ups below; no application features were removed.

## Latest application verification — 2026-11-03

Node v22.23.2; `VITE_DRIVE_MOCK=true npm run check` completed cleanly against
the current working tree. TypeScript, Oxlint, unit/component tests, the
production build and the full browser suite passed.

| Check | Result |
| --- | --- |
| TypeScript, Oxlint, production build | Passed |
| Unit/component tests | 575 passed in 42 files |
| Full production Playwright run | 297 passed, 9 existing skips; 306 total |
| Analytics browser suite | 12/12 passed across Chromium, Firefox and WebKit |
| Analytics responsive/interaction checks | 390 px no horizontal overflow; large-history virtualization and chart drill-down passed |
| Statistics panel regressions | Passed across Chromium, Firefox and WebKit |
| Event flows | All 12 events exercised at desktop and 390 px mobile |
| Large-history stop regression | 7,000 solves; keyboard/pointer; all engines passed |
| Offline flow | Passed in the supported Chromium project |

The Analytics suite added 12 Playwright cases (filtering, penalty and session
selection, chart hover/drill-down, distribution-to-explorer filtering,
customization/reload persistence, timer-key isolation, 10,000-solve history and
390 px responsive layout) and three focused Vitest files. The 100,000-solve
filtering/rolling/PB/distribution path is covered by a synthetic unit test.
Desktop timer, mobile timer and Analytics screenshots were refreshed after the
final build. No real user data or live Drive account was used.

The nine existing skips remain unchanged and are described in README's
verification section. No physical-device, assistive-technology, live Drive or
production OAuth validation is implied. Analytics runs on the main thread: the
100,000-solve case establishes correctness, not a browser performance or memory
ceiling. Normal production output is restored with a non-mock build after the
mock-based browser run.

## Immediate work

1. **Verify and fix panel/readout overlap.** A gutter mitigation exists for
   the default open panel; inspect desktop, 320/390 px, landscape and timing
   states with the panel open, moved, resized and restored after reload.
   Preserve pointer isolation and refresh affected screenshots after UI changes.
2. **Profile large-history performance.** Use the 7,000–10,000-solve matrix
   below, with sync on/off and charts open/closed. Include the Analytics page and
   separate first-result response from chart completion and durability before
   optimizing. Establish whether any expensive analytics pass needs worker
   offload or incremental caching.
3. **Optimize the measured bottlenecks in hashing, statistics and charts.**
   Enabled-sync hash caching must preserve exact pending/in-flight detection;
   chart/statistics/analytics caches must invalidate after edits, deletion/Undo,
   imports, session changes and trimming changes.
4. **Design incremental storage separately.** Include migration, recovery,
   failure and cross-tab safety before replacing whole-collection writes.
   Do not debounce saves to improve a benchmark.
5. **Complete external validation within its authorization.** Live Drive requires
   explicit test authorization and a short-lived credential. OAuth publishing
   needs the Google Cloud owner. Physical mobile/trackpad and assistive-technology
   checks remain open. Recheck the dated build-tool advisory before choosing a
   compatible dependency change; preserve offline behavior.

## Profiling matrix

Use isolated synthetic histories and memory/mock Drive; never real solve history.

| Dimension | Cases |
| --- | --- |
| History | 7,000 and 10,000 solves, including field metadata |
| Runtime | Development (`localhost:5173`) and production preview (`127.0.0.1:4173`) |
| Browser | Actual Zen when available; record exact browser/version for comparisons |
| Input | Keyboard and pointer |
| Insights | Chart closed/open; expanded/custom large averages |
| Synchronization | Disabled/enabled with mock Drive |
| Measurements | Input dispatch, captured timestamp, first stopped-result render, chart completion, serialization/write cost, long tasks |

Discard/identify warm-up, record sample counts and median/range, and distinguish
DOM observation from physical contact/display latency. Do not use host-specific
performance thresholds as correctness assertions. Historical sync-off Firefox/
Chromium numbers are in the [archived handoff](docs/archive/NEXT_SESSION_HANDOFF.md#performance-evidence-and-remaining-costs);
raw traces are not tracked and those numbers were not independently remeasured.

## Documentation consolidation — 2026-11-01

Current instructions/status/limits now live in the five root documents. Detailed
milestone evidence, completed plans, the former handoff and pre-consolidation
roadmap are preserved in [docs/archive/](docs/archive/README.md). Archive snapshots
may contain superseded statements and approval boundaries; use current guidance
for new work. This consolidation changes documentation and skill references only.

Documentation checks passed: local links/fragments, active source/test paths and
npm scripts, all four project skill validators, seven-skill OpenCode runtime
discovery and `git diff --check`. Archived bodies were initially compared with
originals, allowing only relative-link rebasing; future feature-phase proposals
were subsequently removed from both current and archived plans at the user's
request. Application source, tests,
dependencies and prior working changes were preserved; the application suite
was not rerun for this documentation-only consolidation.
