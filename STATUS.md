# CubeLab status

**Updated:** 2026-11-05. This is the current implementation/verification record
and immediate work queue. [README.md](README.md) describes the product;
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) records current boundaries;
[ROADMAP.md](ROADMAP.md) lists the retained follow-ups alongside delivered work.

## Implemented checkpoint

- React/TypeScript/Vite local-first timer with 12 built-in events: 3×3, 2×2, 4×4,
  3×3 OH, 5×5, 6×6, 7×7, Pyraminx, Skewb, Square-1, Clock and Megaminx.
  Official `cubing.js` scrambles and registry-driven visualizations are shipped.
- Custom events add stable `custom:` IDs, optional scramble placeholders,
  creation/rename/deletion, isolated statistics and Analytics filters, and
  csTimer type mapping. Valid omitted `opt.scrType` uses csTimer’s `333` default;
  explicit unsupported identifiers stay on stable custom events, and missing or
  malformed metadata never falls back to 3×3. Definitions merge and tombstone
  with selected-session reassignment plus metadata-based correction of previously
  imported solves.
- Developer options are collapsed by default. Their Danger Zone retains the
  typed-confirmation solve reset and adds **Delete All Sessions**, which records
  session and solve tombstones, removes every session, creates one empty active
  **Session 1**, and preserves settings and custom-event definitions. Both
  actions block unsafe storage/sync states and skip snapshot cleanup for their
  publication.
- Inspection/penalties/warnings, named sessions, comments/actions, configurable
  average trimming, compact/expanded Time Trend, wheel/pinch/pan and historical
  PB statistics are implemented. Sessions use schema v5; settings use v10.
  Sessions can be reordered with drag handles, arrow-key reordering, and
  accessible Up/Down controls inside the session selector; order is backed up
  and synchronized as an ID-based record. Session
  settings can correct a session's event (with confirmation when solves exist)
  while preserving every solve field and import provenance. Optional completed/
  total solve and total-time summaries live in the slim timer footer, follow
  csTimer's DNF/+2 semantics, show counts without a suffix and total time in
  hours. A maintained display version appears in the bottom-right footer.
- A lazy Analytics dashboard adds global event/session/date/count/penalty
  filters, overview cards, progression and average charts, PB history,
  clickable distributions, consistency and Sub-X analysis, session comparison,
  practice activity, advanced percentiles/rankings, and a virtualized filtered
  solve-list dialog. The Statistics overview stays at the top; a left analysis
  list (or a narrow-screen dropdown) shows one remaining analysis at a time.
  Section visibility and order persist in synchronized settings; retired Solve
  explorer entries are ignored safely. Charts support hover, keyboard
  inspection, zoom, pan, reset and solve drill-down through the shared details
  dialog. The compact icon zoom group replaces text buttons. Distribution
  auto-ranges from the central 98% and groups extremes into drillable edge
  intervals; Sub-X accepts precise seconds, event-specific presets, and keeps a
  resizable chart/session-table split with sticky headings. Practice activity
  covers the complete filtered range with year-aware labels. On desktop the page
  fits the viewport with bounded internal scrolling and chart resizing; the
  session selector supports all/none/partial states and an explicit empty
  selection. Native dropdowns were replaced throughout by a shared accessible
  CubeLab combobox/listbox with type-ahead, outside-click/Escape dismissal,
  viewport positioning and focus restoration.
- Local backups, additive csTimer import, optional immutable-snapshot Drive sync,
  conflict review/Undo, recovery, retention and cross-tab reconciliation exist.
- Floating 2D/PG3D tools, persisted drag/resize, light/dark/system themes and an
  offline-capable PWA are implemented.
- The first large-history stop patch captures input before audio/focus, animates
  the readout locally and delays expensive presentation. Saving and sync still
  receive current data. Enabled-sync guards remain in place. Optional session
  summaries are memoized from stored solves, so the stop path does no extra
  aggregation work.
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
retained work is the five follow-ups below; the retired Solve explorer was
replaced by the filtered solve-list details dialog.

## UI debloat and responsive verification — 2026-11-05

The timer/sidebar workspace now sizes to content and scrolls below the timer on
narrow screens, with a compact short-height layout, so the readout cannot paint
under Sessions or Statistics at 320×568, 360×640, 568×320 or 844×390. Settings,
Solve History and Analytics moved to a four-step type scale; redundant dialog
eyebrows and the Settings intro were removed; the Drive status row is now one
human-readable state with technical sync details behind a disclosure; narrow
Solve History rows use the row menu instead of cramped inline penalty buttons;
and narrow Analytics filters collapse behind a Filters control with an active
count. The repeated Latest DNF indicators and the Analytics averages Size column
were intentionally left unchanged.

TypeScript and Oxlint passed (the pre-existing `SessionPanel` purity warning
remains). Full Vitest: **743 passed in 54 files**. Production build and PWA
generation passed. Chromium focused checks: responsive timer **5/5**, Analytics
**12/12**, accessibility **3/3**, and timer/session-management/average-trimming
**82/82**. WebKit responsive timer, Analytics and accessibility: **20/20**.
Firefox responsive timer, Analytics and accessibility passed; clean reruns of
the previously failing Drive split/delete and trimming cases passed **3/3**.

The full `npm run check` did not produce a clean matrix. Its first browser run
reused a stale preview for the Drive cases; clean targeted reruns passed. Eleven
Firefox mobile per-event cases still fail before the changed UI paths because
the custom event selector ignores Playwright Firefox `isMobile` pointer clicks;
keyboard selection reaches the same events. No full-matrix pass is claimed.

Visual inspection used isolated synthetic history at 1440×900 and 390×844 in
light and dark themes, plus timer layouts at 320×568, 360×640, 568×320 and
844×390. Settings, Solve History, Analytics, the filter disclosure and the Drive
sync details were included. No real history or live Drive account was used.

## Latest application verification — 2026-11-04

Node v22.23.2. Current checks on the working tree:

| Check | Result |
| --- | --- |
| TypeScript, Oxlint | Passed |
| Full Vitest run | 708 passed in 51 files |
| Production build + PWA | Passed |
| Focused csTimer Chromium flows | 3/3 passed (unknown custom types; invalid/valid additive import; ranked names, empty sessions and omitted defaults) |
| Example fixture visual/axe check | Passed; 49 sessions, 8,591 solves and nine empty sessions represented |

### Analytics debloat verification — 2026-11-04

The Analytics dashboard received a focused design pass: removed the eyebrow,
subtitle, scope-status and section dots, nav markers, metric descriptions and
read-only footer; flattened the statistics overview into a primary metrics row
and a compact secondary grid; turned the analysis rail into a flat index with an
accent selection rule; compacted the filters, empty states and Sub-X controls;
and paired the activity heatmap with the volume chart on wide screens. The green
accent remains reserved for the fastest single, selection, links and primary
actions. Calculations, filters, persistence, chart interactions and the nine
sections are unchanged.

Chart measurement now reattaches its `ResizeObserver` when an empty analysis
becomes populated, covered by a focused AnalyticsPage regression test.
TypeScript and Oxlint passed (one unrelated pre-existing `SessionPanel` purity
warning remains). Full Vitest: **708 passed in 51 files**. Focused Chromium
coverage passed `e2e/analytics.spec.ts` **12/12**. The production build and PWA
generation passed without mock Drive. A one-off axe scan of the Analytics page
reported no violations in desktop light, desktop dark, or 390 px layouts.

Manual inspection used isolated synthetic histories with 140–266 solves, seven
sessions and empty data. Light and dark themes were checked at 1440×900,
1280×720, 1024×768, 768 px tablet, 390 px and 320 px; filters, Customize, the
session menu, the Sub-X split, the solve list, histogram tooltips and 150%
interface zoom were included. Automated Chromium coverage also exercised long
session names, multi-year ranges, 10,000-solve histories and empty session
selections. No real history or live Drive account was used. Firefox/WebKit, live
Drive and assistive-technology sessions were not run for this visual change.

### Analytics layout, dropdown and footer verification — 2026-11-04

TypeScript and Oxlint passed. Full Vitest: **691 passed in 50 files**.
Focused Chromium coverage passed `e2e/analytics.spec.ts` **12/12**,
`e2e/session-management.spec.ts` **9/9** and `e2e/timer.spec.ts` **62/62**
(83/83 in the final combined run). The affected accessibility, draw-scramble,
custom-events, average-trimming, time-trend, cross-tab-timing and timer-response
suites also passed **32/32** after their custom-selector expectations were
updated. Four initial failures were test selectors still targeting removed
native `<select>` elements; no product behavior failed. The mock-Drive
delete-all/non-resurrection and session-order persistence cases passed.

Visual inspection used isolated synthetic history spanning 2025–2026, 20–26
long-named sessions, 420-solve active histories, empty data and multi-year date
ranges. Light and dark themes were checked at 1440×900 and 1280×720; narrow
390 px views covered the heatmap, scrolled Sub-X table, session menu and timer
footer; 150% interface zoom covered the Sub-X layout, menus and analysis
scrolling. The Sub-X table headers remained sticky, the session menu stayed
inside the narrow viewport, the footer summary read `415 / 420 · 1.88 h`, and
the version label read `0.01.261104:1`. No real history or live Drive account was
used.

### Single-screen Analytics and session-summary verification — 2026-11-04

TypeScript and Oxlint passed. Full Vitest: **677 passed in 47 files**. Focused
Chromium Analytics/session coverage passed **18/18**, including all/none/partial
and individual session selection, the no-sessions empty state, desktop fit at
1280x720 and 1440x900, internal personal-best scrolling, 150% interface zoom,
summary hours/formatting and independent summary settings. The timer,
accessibility and timer-response suites passed **66/66**. Light/dark desktop,
narrow 390 px, long sessions, 250-solve histories, empty sessions, disabled
summary states and the increased-zoom layout were visually inspected. The
desktop page did not scroll as a whole; longer tables and the analysis list
scrolled internally. No real history or live Drive account was used.

### Session management, Analytics and dropdown verification — 2026-11-04

TypeScript and Oxlint passed. Full Vitest: **676 passed in 47 files**. New
focused Chromium coverage passed: `e2e/session-management.spec.ts` 8/8
(session event correction and field preservation, reload and backup, keyboard
reordering and persistence, delete-all confirmation/cancellation/tombstones,
storage failure, optional summaries with DNF/+2/edits/Undo/session switches,
timer locks, and mock-Drive non-resurrection) and `e2e/analytics.spec.ts` 7/7
(session filter row alignment, keyboard multiselect, drill-down reset,
one-analysis navigation, narrow selector, precise Sub-X/presets/persistence,
and extreme-solve histogram scaling). The affected existing Chromium suites
(`timer`, `accessibility`, `draw-scramble`, `custom-events`,
`cross-tab-timing`, `sidebar-resizable`, `average-trimming`, `time-trend`,
`timer-response`) then passed **102/102**; the accessibility audit was re-run
after the final UI changes and passed 3/3. Production build and PWA generation
passed without mock Drive, restoring normal output after the browser runs.

Visual inspection used isolated synthetic histories with 163–199 solves, long
session names, custom events, empty sessions and 600-second outliers. Light and
dark themes, desktop and 390 px widths, collapsed/expanded Developer options,
Session settings confirmation, session reordering, the Analytics overview and
one-analysis nav, the session multi-select, distribution and Sub-X panels were
inspected. No real browser history or live Drive credentials were used. The full
Firefox/WebKit matrix, live-provider validation, physical touch/keyboard-only
hardware and assistive-technology sessions were not run for this change.

Earlier the same day, the full custom-event browser flow, an Analytics
customization persistence check in WebKit, and a full Playwright run were
completed before this import/preview work. The full browser matrix was not rerun
after the focused csTimer changes, following the resource-conscious verification
policy in [AGENTS.md](AGENTS.md). No real user data or live Drive account was
used.

The nine existing skips remain unchanged and are described in README's
verification section. No physical-device, assistive-technology, live Drive or
production OAuth validation is implied. Analytics runs on the main thread: the
100,000-solve case establishes correctness, not a browser performance or memory
ceiling. Normal production output was restored with a non-mock build after the
mock-based browser runs.

Routine development uses the tiered workflow in [AGENTS.md](AGENTS.md): manual
inspection for trivial visual work, affected Vitest plus TypeScript/lint for
logic, one-browser Playwright with `--workers=1` for major flows, and the full
browser matrix only for significant releases or explicit requests. Destructive
save/import/restore/Drive paths keep their focused browser coverage.

### Developer reset verification — 2026-11-03

TypeScript and Oxlint passed. Focused Vitest coverage for the Developer reset
(`ConfirmDialog`, `SettingsDialog`, `sessions`, `sync`, and `useSync`) passed with
159 tests. The cases cover typed confirmation, multiple sessions, empty sessions,
custom events, preserved session configuration, bulk tombstones, merge
non-resurrection, durable reset records, and skipping snapshot cleanup for the
reset publication. Playwright was intentionally not run for this task, so the
rendered browser layout and live Drive transport remain unverified.

### csTimer import and preview verification — 2026-11-03

The additive csTimer flow now previews a single session/count table and applies
the same final names shown there. `Example Cstimer Import.txt` contains 49
sessions and 8,591 solves; all 49 rows appeared, including its nine empty
sessions, with `3x3` at 7,061 solves and `8x8` at 0. Valid metadata that omits
`opt.scrType` resolves to csTimer’s `333` default. Explicit unsupported
identifiers remain stable custom events, while missing or malformed metadata is
not converted to 3×3. Numeric names, case-insensitive collision numbering,
already-numbered names, name-length limits, rank ordering with session-number
fallback, empty-session date fallback, persistence and native backup round trips
are covered by unit tests.

Verification at that checkpoint: TypeScript and Oxlint passed. Full Vitest: 635 passed in 46 files.
Focused Chromium csTimer coverage passed 3/3: the custom-event unknown-type flow,
the invalid/valid additive import flow, and the ranked-name/empty-session/default
flow. A one-off isolated Playwright check against `Example Cstimer Import.txt`
passed with no serious or critical axe violations; light, dark, 390 px narrow and
150% interface-zoom screenshots were inspected, including long names, empty
counts and reachable actions. Production build + PWA passed and was rerun without
mock Drive to restore normal output. The full browser matrix, live Drive and
offline re-verification were intentionally skipped. No real user history was
used. Existing imports were not automatically repaired or reclassified.

## Immediate work

1. **Verify and fix tool-panel/readout overlap.** The base timer and sidebar
   workspace now stacks and scrolls without overlap at short viewports. A gutter
   mitigation remains for the default open Draw Scramble panel; inspect desktop,
   320/390 px, landscape and timing states with the panel open, moved, resized
   and restored after reload. Preserve pointer isolation and refresh affected
   screenshots after UI changes.
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
