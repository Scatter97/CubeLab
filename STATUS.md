# CubeLab status

**Updated:** 2026-11-19. This is the current implementation/verification record
and immediate work queue. [README.md](README.md) describes the product;
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) records current boundaries;
[ROADMAP.md](ROADMAP.md) lists the retained follow-ups alongside delivered work.

## Persistence and Analytics performance pass — 2026-11-19

Two focused simplifications landed, plus a measured follow-up map for Drive
sync and startup. All figures below use deterministic synthetic histories of
7,000 and 10,000 solves across 20 sessions (same fixture and runtime for the
before/after paths, 21 samples, median reported; jsdom/Node observations, not
browser thresholds).

- **Single session serialization per save.** `persistSessions` previously
  serialized twice (once inside `saveSessions`, once to track the written
  bytes). `saveSessionsSerialized` now serializes once and returns the exact
  bytes storage holds; the persist path tracks that string. The boolean
  `saveSessions` contract, storage format, write count (one per save), save
  timing, replacement-journal checks, pending-completion buffering and
  write-failure handling are unchanged.
  Measurements: at 10,000 solves (1.48 MB payload) the persist path dropped
  from 5.5 ms to 2.8 ms median; a single serialization is 4.0 ms; 7,000 solves
  (1.03 MB) dropped from 3.1 ms to 1.2 ms. Storage writes stay at exactly one
  `setItem` per save in both paths. The audit's 16.7→8.3 ms reference is the
  same shape on a different fixture.
- **One prepared rolling-series build for Analytics.** The page-level trend
  now carries the ao5/ao12/ao50/ao100/ao1000 series; the overview and the
  Progression/Averages/Personal-bests views consume the prepared result
  instead of rebuilding subsets. Overview preparation cost is unchanged
  (16.1→15.8 ms at 10,000), while per-view extra work dropped from
  12.7 ms to ~0.0 ms (Averages), 5.7 ms to 0.3 ms (Progression) and 6.2 ms to
  0.3 ms (Personal bests). Current/best values, DNF handling and chart output
  are byte-identical (equivalence is asserted by the new regressions and the
  existing Chromium suites). Edits, deletion/Undo, imports, filter changes and
  either trimming change still invalidate through the shared
  `filtered`→`trend` memos; a trimming change rebuilds exactly once.
- **Drive sync fingerprint trace (measurement only).** After one solve with
  sync enabled, the pending-state memo fingerprints the changed collection
  exactly once (0 on unchanged re-renders). One sync run then performs six
  full traversals of the same 10,000-solve state: `startFingerprint`, four
  `isLocalUnchanged` boundary checks (after the remote read, before upload,
  immediately before the remote write, after it) and `mergedFingerprint` —
  five of the six repeat an input already fingerprinted that tick. At
  10,000 solves each traversal is ~14.7 ms median (10.1 ms at 7,000), so a
  no-change run spends ~74 ms of redundant main-thread work; a repeat run
  measured 11 calls. Next step if approved: an identity-checked memo inside
  the run (WeakMap on the sessions/settings references) without changing any
  boundary semantics.
- **Startup cubing chunk (measurement only).** The production entry
  (612 kB) statically imports the 1,829 kB cubing chunk (gzip 500 kB) —
  verified in `dist/assets`: `import{…KPattern…}from"./cubing-*.js"`, with
  exactly one `new KPattern(…)` use, reached from `App.tsx → useTraining →
  TrainingController → runtime → training/cube3`. A fresh-context Chromium
  load of the production preview requests the chunk at +172 ms with no
  interaction and finishes at +462 ms; domContentLoaded lands at +559 ms and
  the timer surface at ~607 ms median (n=5). The first official scramble
  already loads the same chunk lazily via `scramble.ts`, and the PWA
  precaches it, so deferring Training's module-level `KPattern` (its only
  value uses sit inside already-async `loadCube3Model` flows, which already
  dynamically import `cubing/puzzles`) would move ~500 KB off the startup
  critical path without delaying the first scramble. Worker chunking,
  fingerprint semantics and storage architecture were deliberately left
  unchanged in this pass.

Verification (final tree, after the temporary benchmark harness was removed):

```bash
npm run typecheck        # passed
npm run lint             # passed; only the pre-existing App.tsx ref warnings
npm run build            # passed; restored normal output after mock-Drive runs
npx vitest run src/lib/storage.test.ts src/hooks/useSessions.test.ts src/lib/pendingCompletion.test.ts \
  src/lib/startupDataSafety.test.tsx src/hooks/useSync.test.ts src/hooks/useDurableReplacement.test.ts \
  src/lib/training/storage.test.ts src/lib/analytics.test.ts src/lib/analyticsSettings.test.ts \
  src/components/AnalyticsPage.test.tsx src/lib/stats.test.ts src/lib/timeTrend.test.ts \
  src/lib/sessionTransfers.test.ts    # 317 passed
CI=1 npm run test:e2e -- e2e/timer-response.spec.ts e2e/analytics.spec.ts e2e/average-trimming.spec.ts \
  --project=chromium --workers=4 --retries=0    # 19 passed (7,000-solve stop regression, 10,000-solve Analytics)
CI=1 npm run test:e2e -- e2e/session-management.spec.ts e2e/timer.spec.ts --project=chromium --workers=4 \
  --retries=0 --grep "final storage write fails|deletion record or collection cannot be saved|Clear Session when deletion intent|clear intent when the empty collection|blocks Undo before changing deletion intent|merge or split storage writes fail|solve menu handles penalties|named sessions create, switch, rename, delete, and persist|backup export and import restore"
# 9 passed (save failures, recovery, deletion/Undo, import/restore)
git diff --check       # passed
```

New regressions: `saveSessionsSerialized` returns the exact stored bytes and
writes nothing on failure; a successful save tracks its own bytes so the next
save is not buffered as an external candidate; Analytics sections must consume
one prepared five-series build and a trimming change must invalidate it
exactly once. Not measured here: browser stop-response with enabled sync,
live Drive, physical devices, and multi-engine (Firefox/WebKit) runs; the
full Playwright suite was not rerun. No commit or push was made.

## Audit follow-ups — 2026-11-19

Applied the retained follow-ups from the migration audit:

- Floating Draw Scramble/Time Trend panels now move to the nearest clear side
  when a saved or released position would cover the timer display, with pure
  geometry and browser regressions.
- Firefox 157 and WebKit 27.2 passed the focused onboarding/accessibility suites.
  WebKit required isolated ICU 74, legacy libxml2 and Flite compatibility
  libraries plus host-validation skipping; this is recorded as a compatibility
  path, not official Arch support.
- Headed Chromium 156 loaded the real timer on a nested KWin Wayland virtual
  display at 1360×860.
- The misleading Web Lock retry was removed when Web Locks are unavailable, and
  the duplicate unused `setSessionEvent` helper was removed.
- Added [incremental storage design](docs/development/INCREMENTAL_STORAGE_DESIGN.md).
- Re-downloaded the pinned Heroor/Tao audit sources and J Perm references; the
  audit reproduced 77/78 passing defaults with only the known OLL 56 exception.
- Historical records now use the current checkout path; stale nvm PATH commands
  were replaced with dated notes.
- A 10,000-solve pure analytics benchmark measured 61.7 ms total; no new cache was
  justified. Browser/chart/sync profiling remains open.

Verification: typecheck, lint (existing warnings), 103 Vitest files / 1,341
executed tests, production/PWA build, Chromium draw-scramble 15/15, single-tab
5/5, Firefox onboarding/accessibility 15/15, WebKit 15/15, and the headed nested
Wayland timer smoke. The audit did not commit or push; the delivery commit is
recorded in Git history.

## Arch Linux environment audit — 2026-11-18

Primary local development moved from Ubuntu/Zorin OS to Arch Linux rolling. The
verified desktop is KDE Plasma 6.8.3 with KWin on Wayland and systemd 262. The
verified toolchain is the official `nodejs` 26.13.1 and `npm` 12.2.2 from
`/usr/bin`; the previously documented
`~/.nvm/versions/node/v22.23.2` path does not exist on this machine. Current
instructions use the toolchain-supported Node range (22.22.2+ in the 22.x line,
24.15+, or 26+) with no nvm prefix, and `package.json` now records that
intersection instead of the old `>=22.0.0` floor. Historical entries below retain
their dated Node 22.23.2 commands and results as evidence.

Added [the Arch Linux development guide](docs/development/ARCH_LINUX.md) with
official repository packages, Playwright Chromium installation and Arch system
libraries, KDE Plasma/Wayland behavior, troubleshooting, and the verified
Chromium test path. README, AGENTS, FEATURES, ROADMAP and KNOWN_LIMITATIONS now
link to or reflect that environment. Training status/memory and dated repair
records were labeled historical or superseded where they conflicted with the
committed O1–O8 implementation; no Training code changed. Remaining current
claims were reconciled with source (Settings sections, heatmap window, split
range, reset cookie scope and release example). No application runtime source,
dependency version, production behavior, storage schema or user data changed. The only manifest change is the `engines.node` range, which now
records the locked toolchain's actual support instead of `>=22.0.0`; the one-off
Training audit script's reproduction note now uses a supported Node release.

Verification:

```bash
npm ci
npx playwright install chromium
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e -- e2e/onboarding.spec.ts e2e/accessibility.spec.ts --project=chromium --workers=4
npm run test:e2e -- e2e/onboarding.spec.ts e2e/accessibility.spec.ts --project=firefox --workers=4
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 npm run test:e2e -- e2e/onboarding.spec.ts e2e/accessibility.spec.ts --project=webkit --workers=4
npm run test:e2e -- e2e/timer.spec.ts --project=chromium --workers=4 --grep "installed app loads scrambles while completely offline"
npm run build
```

`npm ci` installed 445 packages from the lockfile; `npm audit --omit=dev`
reported zero production advisories (the final full audit reported four
development-only moderate advisories). Typecheck passed. Lint passed with the
existing archived-evidence and React ref/purity warnings. Vitest passed 103
files with 1,341 executed tests (1,216 named definitions; parameterized cases
expand). The production/PWA build passed with the existing
chunk-size warning and 78 precache entries. The focused Chromium run passed
15/15, including axe and onboarding flows; the installed-app offline scramble
case also passed after the production service worker was installed. Firefox 157
passed the same 15 cases. WebKit 27.2 passed 15/15 using isolated ICU 74,
legacy libxml2 and Flite compatibility libraries with host validation skipped.
Chromium 156 and its headless shell launched successfully; Playwright reported
Arch as an unsupported OS and used its Ubuntu 24.04 fallback builds. The initial
FFmpeg download hit a transient DNS failure; a retry completed it, and the
ordinary trace/screenshot configuration does not require video capture. Headed
Chromium 156 also loaded the real timer on a nested KWin Wayland virtual display
at 1360×860. The Training diagram generator verified all 78 SVGs and the
complete contact sheet. The external Training audit sources were re-downloaded
at their pinned commits; the audit reproduced 57/21 reference sets, 77/78
passing defaults and only the known OLL 56 candidate-A failure. All local links
and anchors across 110 Markdown files resolve, and `git diff --check` passed.

A synthetic pure-calculation benchmark used 10,000 solves across 20 sessions:
filter 4.7 ms, trend 28.5 ms, rolling averages 13.7 ms, overview 4.7 ms,
histogram 2.0 ms, consistency 3.1 ms, Sub-X 2.2 ms, activity 2.8 ms and total
61.7 ms; `buildTrendData` took 23.1 ms. These are single-run Node observations,
not browser or physical-device thresholds. They do not justify a new cache in
the pure analytics path; chart rendering, enabled sync and stop latency still
need browser profiling.

The complete three-engine Playwright matrix, live Google Drive, physical
touch/keyboard/audio hardware, screen readers and the full 7,000–10,000-solve
browser profiling matrix were not exercised. WebKit required isolated
compatibility libraries and a host-validation skip; this is not official
Playwright support for Arch. No commit, push or deployment was made.

## Local site reset — 2026-11-11

Settings → Developer options → Danger Zone now includes **Reset All Site Data**.
The entry uses the typed confirmation **RESET** and states that Google Drive
cloud data is not deleted. The reset disables synchronization and blocks the
Drive transport before clearing app-owned state, waits up to 10 seconds for an
in-flight sync run to stop, clears CubeLab localStorage/sessionStorage keys,
CubeLab-named IndexedDB databases, CubeLab/scoped Workbox caches, the exact
application service-worker registration and readable CubeLab cookies,
revokes/clears locally held Google authorization, signals other tabs, and
reloads into first-visit onboarding. It never uploads an empty state or
deletes/replaces Drive files.

A blocked IndexedDB deletion or storage that cannot be verified as cleared
reports partial failure and offers retry; a sync that does not settle within
10 seconds clears nothing.
Other current-build tabs receive the begin/complete/failed/abandoned signals,
gate their own writes first, and either reload after completion/abandonment or
stay locked after failure so a stale in-memory collection cannot write back.
`loadSyncStorage` no longer recreates a fresh sync identity during the reset
gate (found by the cross-tab regression).

Node 22.23.2 verification:

```bash
npm run typecheck
npm run lint
npm test -- src/lib/siteReset.test.ts src/lib/driveTransport.test.ts src/components/ConfirmDialog.test.tsx src/components/SettingsDialog.test.tsx
npm run test:e2e -- e2e/site-reset.spec.ts --project=chromium --workers=4
npm run build
git diff --check
```

Typecheck passed. Lint passed and retained existing warnings in archived evidence
scripts plus the pre-existing React Compiler ref/purity warnings in `App.tsx`
and `SessionPanel.tsx`. Focused Vitest passed 54/54. Chromium Playwright passed
4/4 with mock Drive: exact/cancel confirmation, full storage/IDB/cache cleanup
with unrelated data preserved, Drive content captured unchanged at completion
with no upload/delete/connect operations, first-visit and refresh onboarding, a
second reset, blocked-IDB failure/retry and cross-tab stale-tab gating. The
confirmation dialog was also inspected at 1360×900 in light and dark themes and
at 390×844 in light, and the Developer zone at 1360×900 in light; the disabled
confirmation, scrollable details list and focus ring rendered correctly. The
normal production/PWA build passed with the existing chunk-size warning, and
`git diff --check` passed. Firefox, WebKit, live Google OAuth, physical devices
and browser-managed HTTP-cache erasure were not exercised. No commit, push or
deployment was made.

## Training overhaul O8 — 2026-11-11

Integrated verification now covers a synthetic legacy and named history and a
285-attempt, 75-day chart history. The first flow exercises Begin and capture,
End, the required report, reload, read-only archive review, typed whole-session
deletion and Algorithms recalculation. The chart case checks reports and
Algorithms at 1440, 1024, 390 and 320 px in light and dark, keyboard chart
inspection, test-dispatched touch selection and axe serious/critical results.
Saved `rawMs` and `createdAt` values were unchanged by report/chart rendering.
The audit exposed one accessibility defect in the revision toggle in
`AlgorithmsAnalytics.tsx`; the toggle name now includes its visible revision count.

Node 22.23.2 verification:

```bash
npm run typecheck
npm run lint
CI=1 npm run test:e2e -- e2e/training-integrated.spec.ts --project=chromium --workers=4 --retries=0
CI=1 npm run test:e2e -- e2e/training.spec.ts --project=chromium --workers=4 --retries=0 --grep 'algorithm tracking stays prospective|Algorithms analytics|session report supports|archive filters'
CI=1 npx playwright test e2e/training-integrated.spec.ts --project=chromium --workers=1 --retries=0 --grep 'chart-heavy' --reporter=json
npm run build
git diff --check
```

Typecheck and lint passed; lint retained seven existing warnings. The integrated
spec passed 2/2 and the four existing Training regression cases passed 4/4 in
Chromium with mock Drive. The normal production/PWA build passed with the
existing chunk-size warning. The measurement run seeded **285 attempts
(337,771 bytes)**; archive review open sampled **27.2, 35.8 and 44.3 ms**, and
Algorithms open with charts measured **347.6 ms**. These are single-run synthetic
observations, not performance thresholds. No axe serious or critical violations
remained in the report or Algorithms views.

Firefox, WebKit, physical touch/keyboard hardware, assistive technology, live
Drive and the 7,000–10,000-solve profiling matrix were outside this pass. The
integrated history establishes flow and rendering behavior at 286 attempts, not
a production scale ceiling. No commit, push, deployment or publication was made.

## Training overhaul O7 — 2026-11-11

Optional tracking is off by default. New attempts always count by case.
Tracking captures an exact verified revision at timing start and unlocks
management and session overrides. Off-period attempts stay case-only.
Historical revision statistics remain visible in Analytics → Algorithms.

Node 22.23.2 verification:

```bash
npm run typecheck
npm run lint
npm test -- src/lib/training/controller.test.ts src/lib/training/analytics.test.ts src/lib/training/reports.test.ts src/lib/training/sessionFoundation.test.ts src/lib/training/domainStorage.test.ts src/lib/training/algorithmSelection.test.ts src/lib/training/storage.test.ts src/lib/training/persistenceIntegration.test.ts src/lib/training/stats.test.ts src/components/TrainingPage.test.tsx src/hooks/useTraining.test.tsx
npm test -- src/lib/training/controller.test.ts
CI=1 npm run test:e2e -- e2e/training-hub.spec.ts e2e/training.spec.ts --project=chromium --workers=4 --retries=0
CI=1 npm run test:e2e -- e2e/training.spec.ts --project=chromium --workers=4 --retries=0 --grep 'algorithm tracking stays prospective|case selection, user algorithm|built-in defaults work'
CI=1 npm run test:e2e -- e2e/training.spec.ts --project=chromium --workers=4 --retries=0 --grep 'algorithm tracking stays prospective'
npm run build
git diff --check
```

Typecheck, lint, 141 focused Vitest tests and the normal production/PWA build
passed. The controller follow-up passed all 29 tests, including exact Undo
for a case-only attempt after re-enabling tracking. Initial unit fixtures
that exercised attribution and the manager needed explicit opt-in. The
Training Chromium run passed 33 of 36 cases with mock Drive. Two management
cases passed after scoping their dialog locators. The tracking case passed
after scoping the revision picker. Browser coverage includes on → off → on,
fixed session overrides, preserved historic charts, 320 px and offline
practice. Lint retained seven existing warnings. Vite emitted its existing
chunk-size warning. Full application suites, Firefox, WebKit, live Drive and
large-history profiling were outside this pass.

## Training overhaul O5, O6a and O6b — 2026-11-11

Reports show measured time and signed comparison, estimated Recognition
components with coverage, and an inspectable chart. The Hub and archive
support recent sessions, filtered review and scoped typed deletion. Algorithms
analytics reads Training history and keeps ordinary Solve Analytics separate.

Node 22.23.2 verification:

```bash
npm run typecheck
npm run lint
# O5
npm test -- src/lib/training/reports.test.ts src/lib/training/visits.test.ts src/lib/training/stats.test.ts src/components/TrainingPage.test.tsx
CI=1 npm run test:e2e -- e2e/training.spec.ts --project=chromium --workers=4 --retries=0 --grep 'session report supports|all-DNF report|refresh resumes'
npm run build
# O6a
npm test -- src/lib/training/controller.test.ts src/lib/training/domainStorage.test.ts src/lib/training/reports.test.ts src/lib/training/sessionFoundation.test.ts src/components/TrainingPage.test.tsx
CI=1 npm run test:e2e -- e2e/training-hub.spec.ts e2e/training.spec.ts --project=chromium --workers=4 --retries=0 --grep 'Training Hub|archive filters|refresh resumes|all-DNF report|failed Training deletion|anchored confirmation'
npm run build
# O6b
npm test -- src/lib/training/analytics.test.ts src/lib/training/reports.test.ts src/lib/training/stats.test.ts src/lib/analytics.test.ts src/components/AnalyticsPage.test.tsx
CI=1 npm run test:e2e -- e2e/training.spec.ts e2e/analytics.spec.ts --project=chromium --workers=4 --retries=0 --grep 'Algorithms analytics|filters, compares|does not route timer keys|horizontal overflow on mobile|fits the page|increased interface zoom|production Training code'
# Final focused verification
npm test -- src/lib/training/analytics.test.ts src/lib/training/reports.test.ts src/lib/training/controller.test.ts src/lib/training/domainStorage.test.ts src/lib/training/sessionFoundation.test.ts src/lib/training/stats.test.ts src/lib/training/visits.test.ts src/lib/analytics.test.ts src/components/AnalyticsPage.test.tsx src/components/TrainingPage.test.tsx
CI=1 npm run test:e2e -- e2e/training-hub.spec.ts e2e/training.spec.ts e2e/analytics.spec.ts --project=chromium --workers=4 --retries=0 --grep 'Algorithms analytics|archive filters|session report supports|all-DNF report|refresh resumes|Training Hub|filters, compares|does not route timer keys|horizontal overflow on mobile|fits the page|increased interface zoom|production Training code'
npm run build
git diff --check
```

O5 passed 32 Vitest and three Chromium cases. O6a passed 65 Vitest and eight
Chromium cases. O6b passed 68 Vitest and seven Chromium cases. The final pass
passed 139 Vitest tests, 14 Chromium cases with mock Drive, typecheck, lint and
the normal production/PWA build. Final lint retained seven existing warnings.
Vite emitted its existing chunk-size warning. Verification covered offline
practice, narrow chart inspection, failed deletion retry, history recalculation
and separation of the four Algorithms categories. Full application suites,
Firefox, WebKit, live Drive and large-history profiling were outside this pass.

## Training overhaul O4 — 2026-11-11

End and Leave share an anchored confirmation. The idle prompt is configurable
and defers while armed or running. A checked nonempty end opens the exact
report and preserves its destination through reload. Recovery offers a choice
when closure is ambiguous. Empty ends skip the report and archive row.

Node 22.23.2 verification:

```bash
npm run typecheck
npm run lint
npm test -- src/lib/training/controller.test.ts src/lib/training/visits.test.ts src/lib/training/domainStorage.test.ts src/lib/training/sessionFoundation.test.ts src/lib/training/storage.test.ts src/lib/training/persistenceIntegration.test.ts src/lib/training/stats.test.ts src/hooks/useTraining.test.tsx src/hooks/useTimer.test.ts src/components/TrainingPage.test.tsx src/lib/startupDataSafety.test.tsx
CI=1 npm run test:e2e -- e2e/training-hub.spec.ts e2e/training.spec.ts --project=chromium --workers=4 --retries=0
CI=1 npm run test:e2e -- e2e/training.spec.ts --project=chromium --workers=4 --retries=0 --grep 'recovery returns to Analytics|a new tab on Timer|all-DNF report|anchored confirmation|idle waits'
npm run build
git diff --check
```

Typecheck, lint and 155 focused Vitest tests passed. Both full Training
Chromium runs passed 31 cases with mock Drive, including offline practice,
deletion and Undo, failed end writes and interrupted report delivery. A
five-case rerun included Analytics recovery. The normal production/PWA build
passed. Lint retained seven existing warnings, and Vite emitted its existing
chunk-size warning. The confirmed-closure path was exercised with a supplied
signal in a controller test. Browsers' ambiguous reopening path was exercised
in Chromium. Full application suites, Firefox, WebKit, physical devices and
live Drive were outside the focused pass.

## Training overhaul O3 — 2026-11-11

**Begin practice** captures a named session and its case revisions before
setup generation. Recognition collects any required calibration for its own
set at Begin. The readout, Last Result, Attempts and Statistics use the active
session. Manual End and resume/end recovery are available while O4 owns
confirmation, idle handling and mandatory report delivery.

Node 22.23.2 verification:

```bash
npm run typecheck
npm run lint
npm test -- src/lib/training/controller.test.ts src/lib/training/sessionFoundation.test.ts src/lib/training/domainStorage.test.ts src/lib/training/calibration.test.ts src/lib/training/algorithmSelection.test.ts src/lib/training/storage.test.ts src/lib/training/persistenceIntegration.test.ts src/components/TrainingPage.test.tsx src/hooks/useTraining.test.tsx src/lib/startupDataSafety.test.tsx
CI=1 npm run test:e2e -- e2e/training-hub.spec.ts e2e/training.spec.ts --project=chromium --workers=4 --retries=0
npm test -- src/components/TrainingPage.test.tsx
npm run build
git diff --check
```

Typecheck, lint, 142 focused Vitest tests and 29 Chromium cases passed. The
first Training browser pass caught four seeded setups dated after their
attempts and two tests that had not resumed after reload. After correcting
those cases, both full Training Chromium runs passed, including offline
practice, calibration, save failure, deletion/Undo and session scoping. The
final component check covered an equivalent memoization cleanup. Lint retained
seven existing warnings. The normal production/PWA build emitted the existing
chunk-size warning. Full application suites, Firefox/WebKit, physical devices
and live Drive were outside this phase's focused verification.

## Training overhaul O2b — 2026-11-11

Training opens the Hub with saved selections, category statistics and a local
case draft. The transitional **Open practice workspace** action preserves the
existing practice and recovery flows until O3.

Node 22.23.2 verification:

```bash
npm run typecheck
npm run lint
npm test -- src/components/TrainingPage.test.tsx src/hooks/useTraining.test.tsx src/lib/startupDataSafety.test.tsx src/lib/training/sessionFoundation.test.ts src/lib/training/controller.test.ts src/lib/training/stats.test.ts src/lib/training/algorithmSelection.test.ts src/lib/training/domainStorage.test.ts
CI=1 npm run test:e2e -- e2e/training-hub.spec.ts e2e/training.spec.ts --project=chromium --workers=4 --retries=0 --grep 'Training Hub|keyboard and touch use the shared timer|initial calibration is explicit|refresh resumes|storage conflicts preserve|invalid Training store|inactivity ends|restored-tab ambiguity|failed writes retain|Training split|saved outcome|failed Training deletion|production Training code'
npm run build
git diff --check
```

Typecheck, lint (seven existing warnings), 91 Vitest tests, 16 Chromium cases
with mock Drive, and the normal production/PWA build passed. Browser coverage
includes a fresh Hub with no Training storage writes, draft edits at 1440 px
and 320 px with unchanged stored history, and production offline practice.
The build emitted the existing chunk size warning. Full suites and
Firefox/WebKit were outside the focused change. Live Drive was not exercised.

## Training overhaul O2a — 2026-11-11

Timer's Create session dialog uses the shared session-name allocator and the
selected event label. The [allocation decision](docs/training/PROJECT_MEMORY.md#e162-o2a-session-name-allocation--2026-11-11)
records suffix reuse and how imported and synced names occupy slots.

Node 22.23.2 verification:

```bash
npm run typecheck
npm run lint
npm test -- src/lib/sessionNames.test.ts src/lib/sessions.test.ts src/lib/sessionTransfers.test.ts src/lib/csTimerImport.test.ts src/lib/sync.test.ts
npm test -- src/components/SessionSetupDialog.test.tsx
CI=1 npm run test:e2e -- e2e/session-management.spec.ts e2e/timer.spec.ts --project=chromium --workers=4 --retries=0 --grep 'suggests Timer session names|named sessions create, switch, rename, delete, and persist|csTimer preview keeps ranked names|duplicate session names from Drive'
npm run build
```

Typecheck, lint (seven existing warnings), 211 Vitest tests, four Chromium
cases with mock Drive, and the normal production/PWA build passed. The first
Chromium launch could not start the local preview server under restricted
access. The local-access retry passed. The build emitted the existing chunk
size warning.

## Training overhaul O1 — 2026-11-11

O1 adds optional named-session configuration to Training's v1 visit records.
Existing visit IDs retain ownership of saved attempts. The checked store
protects captured revisions and ended named attempts and saves a pending report
with every nonempty end. Legacy records are read without migration. The
[progress tracker](docs/training/overhaul/CURRENT_PROGRESS.md) holds the current handoff.

Verification used Node 22.23.2 and synthetic data:

```bash
npm run typecheck
npm run lint
npm test -- src/lib/training/sessionFoundation.test.ts src/lib/training/domainStorage.test.ts \
  src/lib/training/storage.test.ts src/lib/training/records.test.ts src/lib/training/visits.test.ts \
  src/lib/training/controller.test.ts src/lib/training/calibration.test.ts src/lib/training/stats.test.ts \
  src/lib/training/algorithmSelection.test.ts src/lib/training/persistenceIntegration.test.ts \
  src/hooks/useTraining.test.tsx src/components/TrainingPage.test.tsx src/lib/startupDataSafety.test.tsx
# 173 passed across 13 files
CI=1 npm run test:e2e -- e2e/training.spec.ts --project=chromium --workers=4 --retries=0 \
  --grep 'keyboard and touch use the shared timer|initial calibration is explicit|refresh resumes|storage conflicts preserve|invalid Training store|inactivity ends|restored-tab ambiguity|failed writes retain|saved outcome|failed Training deletion'
# 11 passed with mock Drive
npm run build
# Production build and PWA generation passed with mock Drive disabled
git diff --check
```

The initial `npm test -- src/lib/training/domainStorage.test.ts` run failed at
the two new cases before implementation. The first combined run caught a
deletion fixture that rolled back visit activity. The corrected fixture retains
the saved timestamp. Chromium's first launch and a `DEBUG=pw:webserver` retry
hit a local access restriction before any browser cases ran. The run with local
browser access passed. Lint reported seven pre-existing warnings in the
Training audit scripts and `SessionPanel`. Vite emitted its chunk-size warning.
The O1 documentation paths, anchors and changed-file whitespace passed.

The full unit and browser suites, Firefox, WebKit, the offline browser case and
live Drive validation were outside this local persistence slice. Whole-session
deletion and the named-session UI are covered by later phases.

## Compact Attempt details and Undo — 2026-11-11

Implemented the approved compact Training dialog with a combined case and
result summary, copyable setup, inline attribution editor, and separate
correction and deletion actions. Deletion from the menu or dialog uses
Timer’s notification with Undo. Practice History stays open and the
notification remains usable inside it. Checked restoration preserves the
original record, visit membership and renewal totals. Failed saves show
recovery controls and report success only after a committed retry.

Verification used Node 22.23.2 and isolated contexts:

```bash
npm run typecheck
npm run lint
npm test -- src/components/TrainingPage.test.tsx src/lib/training/controller.test.ts \
  src/lib/training/domainStorage.test.ts src/lib/training/storage.test.ts \
  src/lib/training/persistenceIntegration.test.ts src/lib/training/visits.test.ts \
  src/lib/startupDataSafety.test.tsx
# 118 passed
npm run test:e2e -- e2e/training.spec.ts e2e/timer.spec.ts --project=chromium --workers=4 \
  --grep 'refresh resumes|long Attempts|saved outcome|failed Training deletion|desktop/mobile light/dark|solve menu handles|window boundary'
# 8 passed with mock Drive
npm run build
git diff --check
```

A separate Chromium dev-server check inspected the dialog at 1440 and 320 px,
verified the exact setup text on the clipboard, and exercised the bottom-right
Undo notification. The full browser suite, Firefox, WebKit and live Drive were
outside this focused Training and Timer check.

## Training attempt action menu — 2026-11-11

Clicking a Training attempt or pressing Enter opens the same row-anchored
action menu as a Timer solve. Right-click uses the browser’s context menu.
The attempt menu offers result correction, clipboard actions, Attempt Details
and typed deletion. Both histories share popup positioning and keyboard
navigation. Moving keyboard focus to a distant row keeps the popup anchored
while the list settles. Existing Training details expose attribution and
recovery when a save fails.

Verification used Node 22.23.2 and isolated Chromium contexts. Commands:

```bash
npm run typecheck
npm run lint
npm test -- src/components/TrainingPage.test.tsx src/lib/historyWindow.test.ts \
  src/lib/training/records.test.ts src/lib/training/domainStorage.test.ts src/lib/training/visits.test.ts
# 52 passed
npm run test:e2e -- e2e/training.spec.ts e2e/timer.spec.ts e2e/responsive-timer.spec.ts \
  --project=chromium --workers=4 \
  --grep 'refresh resumes|long Attempts|window boundary|menu correction fails|solve menu handles|solve menu on touch|desktop/mobile light/dark'
# 8 passed with mock Drive
# Right-click follow-up:
npm test -- src/components/TrainingPage.test.tsx
# 8 passed
npm run test:e2e -- e2e/training.spec.ts --project=chromium --workers=4 --grep 'refresh resumes'
# 1 passed with mock Drive
npm run build
git diff --check
```

The menu was visually checked in Chromium at 1440 px and 320 px. An isolated
quota-failure check verified that a rejected menu deletion kept the saved
attempt visible until Retry save succeeded. The full suite, Firefox, WebKit
and live Drive were outside this focused UI check.

## Approved Training workspace redesign — 2026-11-11

Implemented the five redesign stages in the
[approved blueprint](docs/training/ui-audit/REDESIGN_PLAN.md). Training shares
Timer's Statistics and Attempts presentation, reserves usable history space
alongside the resize grip and uses compact Setup and Statistics options.
Begin, Next, Retry and Resume share the Setup toolbar. The stable notation
track keeps the clock in place across modes and preview changes. The local
execution preview is on by default. Recognition still renders only the
setup and fixed precursor. Last Result keeps its preferred floating geometry
and docks below the clock in constrained layouts.

Checked category and visit changes now use a single candidate. Superseded and
expired setup generation cannot restore a ready timer. Calibration review,
saved attempts and failed writes receive distinct feedback. Attempt Details
displays the saved record while recovery is pending and exposes retry and
recovery export inside the dialog. Reports open directly from their notice.
The approved SVGs, algorithms, Training schema and calculation rules are
unchanged.

[Delivery report](docs/training/ui-redesign/DELIVERY.md) ·
[Rendered before/after comparisons](docs/training/ui-redesign/index.html) ·
[Geometry and computed styles](docs/training/ui-redesign/measurements.json) ·
[Training memory E15](docs/training/PROJECT_MEMORY.md#e15-approved-training-workspace-redesign--2026-11-11)

At 1440×900, both rails are 296 px. Training's first timing row changed from
40.34 px to 51.59 px at its default allocation. Timer is 53.84 px at its
default. Both measure 53.84 px when given the same 267 px Statistics allocation.
Ordinary Attempts and Solves rows are 46.94 px. The Training clock centre was
at (872, 501.5) CSS px across inactive, execution, recognition, preview on/off
and calibration review captures. The frame-sampled browser test also asserts
an unchanged anchor during ordinary transitions.

Verification used Node 22.23.2, isolated fixtures, mock Drive for Playwright
and four workers per browser. Focused command groups and results:

```bash
npm run typecheck
npm run lint
npm test -- src/components/StatsPanel.test.tsx src/components/SessionPanel.test.tsx \
  src/lib/historyWindow.test.ts src/components/TrainingPage.test.tsx \
  src/lib/training/statisticsPreferences.test.ts src/lib/training/stats.test.ts
# 53 passed

npm test -- src/lib/training/controller.test.ts src/lib/training/storage.test.ts \
  src/lib/training/runtime.test.ts src/lib/training/calibration.test.ts \
  src/lib/training/visits.test.ts src/hooks/useTraining.test.tsx
# 91 passed

npm test -- src/timer/machine.test.ts src/hooks/useTimer.test.ts \
  src/components/TimerStage.test.tsx src/components/ScramblePanel.test.tsx \
  src/components/ToolPanel.test.tsx src/lib/toolPanelLayout.test.ts
# 60 passed

npm run test:e2e -- e2e/training.spec.ts e2e/sidebar-resizable.spec.ts \
  e2e/timer-stability.spec.ts e2e/accessibility.spec.ts --project=chromium --workers=4
# 41 passed on the first green pass, 44 passed with final coverage

npm run test:e2e -- e2e/timer.spec.ts e2e/cross-tab-timing.spec.ts \
  e2e/draw-scramble.spec.ts e2e/timer-response.spec.ts --project=chromium --workers=4
# 85 passed and one failed while a Clock scramble was pending

npm run test:e2e -- e2e/training.spec.ts e2e/draw-scramble.spec.ts e2e/timer.spec.ts \
  --grep 'refresh resumes|window boundary|long Attempts|large histories|Last Result|unavailable state for non-cube puzzles|desktop/mobile light/dark' \
  --project=chromium --workers=4
# 10 passed, including the corrected Clock state and the 200/201 threshold

npm run test:e2e -- e2e/training.spec.ts e2e/sidebar-resizable.spec.ts \
  --grep 'keeps the timing surface|keeps the saved outcome|Last Result drag|keyboard resizing' \
  --project=firefox --workers=4
# 4 passed

npm run test:e2e -- e2e/training.spec.ts e2e/sidebar-resizable.spec.ts \
  --grep 'keeps the timing surface|keeps the saved outcome|Last Result drag|keyboard resizing' \
  --project=webkit --workers=4
# 4 passed

npm run test:e2e -- e2e/training.spec.ts \
  --grep 'docks Last Result when a wide zoomed viewport|keeps the timing surface|Last Result drag' \
  --project=firefox --workers=4
# 3 passed with the final height-aware docking

npm run test:e2e -- e2e/training.spec.ts \
  --grep 'docks Last Result when a wide zoomed viewport|keeps the timing surface|Last Result drag' \
  --project=webkit --workers=4
# 3 passed with the final height-aware docking

npm run build
node scripts/training/generate-diagrams.mjs --all --check
git diff --check
```

The visual matrix includes 1440×900, 1280×720, 1024×768, the 1100/1101
and 720/721 dock thresholds, 900/901 and 680/681 stack thresholds, 390×844,
320×740, short landscape and short desktop. Actual 150% Chromium browser
zoom was tested separately from CubeLab's 125% and 150% interface zoom.
Long times fit clear of the default Last Result at the two zoomed desktop
sizes that reproduced overlap. Keyboard focus was checked in report,
case editor, calibration and settings transitions. Long notation scrolled by
keyboard within Setup while the clock stayed anchored. At 320×740, Keep
sample was focused and visible after stopping calibration.
[Browser zoom evidence](docs/training/ui-redesign/browser-zoom.json)

Production Chromium profiling used 250 and 8,000 synthetic attempts,
two warm-up cycles and seven samples per configuration at 1440×900.
With default Statistics, median stop-to-first-frame was 29.9 ms
(22.2–37.0 ms) and 366.5 ms (356.5–416.6 ms), respectively. Median checked
save cost was 9.2 ms and 222.8 ms. With ao25 and ao100 also enabled,
stop-to-first-frame medians were 34.9 ms and 471.1 ms. Each sample stored
one attempt, with the measured input interval agreeing within 0.1 ms.
The 8,000-attempt fixture serialized to about 8.1 MB. Both runs used the
same memory-backed Training key while exercising production validation and
serialization. The pre-redesign captures are visual and provide no paired
production timing baseline. [Profile data](docs/training/ui-redesign/performance.json)

The initial Chromium Training pass had four failures from outdated copy and
accessible-name assertions. They passed after the assertions and case-action
name were updated. Lint reports existing SessionPanel and audit-script warnings.
The build retains the chunk-size warning. Mock Drive coverage includes backup,
restore and conflict review. Full suites, physical devices, real screen readers
and live Drive remain outside this verification. Existing working changes were
preserved. At that checkpoint, the redesign was local and uncommitted; it is
committed in the current baseline.

## Training UI consistency and statistics — 2026-11-10

Training uses Timer's measured Statistics presentation, history rows and
windowing, and responsive split. Each category keeps its own visible rows,
order, Current/Best options and recognition series. Detailed statistics opens
By Case and By Algorithm views. Attempts opens existing result actions across
the full category history. Training Tools was removed. Last Result retains
its geometry and run-time behavior. The setup uses the Scramble layout, the
footer shows category and visit count, and recognition still conceals its
upcoming target. [Training memory E14](docs/training/PROJECT_MEMORY.md#e14-training-ui-consistency-and-statistics--2026-11-10)
records the reuse decisions, file inventory and domain boundaries.

Verification used Node 22.23.2, synthetic records, isolated browser contexts
and sequential suites. Commands and results:

```bash
npm test -- src/lib/training src/components/TrainingPage.test.tsx --maxWorkers=2
# 278 passed in 24 files

npm test -- src/components/StatsPanel.test.tsx src/lib/stats.test.ts \
  src/lib/statInsights.test.ts src/lib/averageTrimming.test.ts \
  src/lib/historyWindow.test.ts src/lib/toolPanelLayout.test.ts \
  src/components/ToolPanel.test.tsx src/components/TimerStage.test.tsx \
  src/hooks/useTimer.test.ts src/hooks/useTraining.test.tsx \
  src/hooks/usePostPaintValue.test.ts --maxWorkers=2
# 130 passed in 11 files

npm run typecheck
npm run lint
npm run build
git diff --check
node scripts/training/generate-diagrams.mjs --all --check
# Lint retains the existing SessionPanel Date.now warning. Build retains the
# chunk-size warning. Generator verifies all 78 approved SVGs and contact sheet.
```

Chromium used production preview and mock Drive, with `--workers=4`:

```bash
npm run test:e2e -- e2e/training.spec.ts e2e/sidebar-resizable.spec.ts \
  e2e/statistics.spec.ts --project=chromium --workers=4
# Initial 35/37. Restored mobile statistics measurement and used the visible
# Attempts row text as its accessible name.

npm run test:e2e -- e2e/training.spec.ts e2e/sidebar-resizable.spec.ts \
  e2e/statistics.spec.ts e2e/average-trimming.spec.ts e2e/timer.spec.ts \
  e2e/timer-response.spec.ts e2e/cross-tab-timing.spec.ts \
  e2e/draw-scramble.spec.ts e2e/timer-stability.spec.ts \
  e2e/responsive-timer.spec.ts e2e/accessibility.spec.ts \
  --project=chromium --workers=4
# 141/142 on the broad pass. The remaining assertion raced the intentionally
# delayed Solves count. The test now waits for the same expected count.

npm run test:e2e -- e2e/training.spec.ts --project=chromium --workers=4
# 16/17 on the final Training sweep. The new customization locator matched
# reorder buttons as well as the checkbox; the checkbox locator is now exact.

npm run test:e2e -- e2e/training.spec.ts e2e/timer.spec.ts \
  e2e/timer-stability.spec.ts \
  --grep 'Detailed statistics supports|large histories window rows|removes instructional captions' \
  --project=chromium --workers=4
# 3/3 passed, including both corrected assertions and Timer windowed history.

npm run test:e2e -- e2e/training.spec.ts --grep 'Last Result drag' \
  --project=chromium --workers=4
# 1/1 passed, including fit of the default actions after docking.
```

The browser coverage includes keyboard and synthetic touch timing, exact-once
recording, recognition secrecy and calibration, DNF correction/deletion,
independent persisted sidebar layouts, history windowing/show-all and scroll,
dialog focus, responsive stacking and production offline behavior. Timer
coverage includes resize bounds, statistics settings and trimming, solve
actions and Undo, backup/import and mock Drive, and Draw Scramble. Axe reported
zero serious or critical violations in the tested Training light/dark views
and settings and detailed-statistics dialogs.

Inspected before/after screenshots at 1440×900 and final views at 390×844 and
320×740. The screenshot set includes both Timer and Training themes, the
sidebars, detailed tabs, and recognition. Visual review restored the existing
dialog border/backdrop and adjusted Last Result dimensions to fit its default
actions. The before/after SVG manifest matched all 78 assets. Aggregate
SHA-256 is `f8674bbb3337ec07ce7c2ee09440314762c052d59c706a5cb460367967433825`.
The initial regression run, `npm test -- src/components/TrainingPage.test.tsx
--maxWorkers=2`, failed on the new shared-panel assertion before implementation.
The first restricted Training unit run blocked two SVG verification
subprocesses. Both passed with process access.

Full Vitest, full Playwright, Firefox, WebKit, physical hardware, screen
readers, live Drive and long-history stop-latency profiling were outside this
focused verification. At that checkpoint, the working changes remained local
and uncommitted; the implementation is committed in the current baseline.
Stop after this refinement.

## Training built-in default algorithms — 2026-11-10

The owner removed CubeLab's internal F12 bundling restriction. All **57 OLL** and
**21 PLL** standard cases now resolve to a read-only, mathematically verified
built-in default without user entry. OLL uses the owner-approved Heroor records
with the E9 OLL 45 (`F R U R' U' F'`) and OLL 56
(`r U r' (U R U' R')2 r U' r'`) corrections. PLL uses only the first-listed Tao
Yu algorithm per case; the 37 additional variants remain excluded.

The catalog lives in `src/lib/training/catalog/defaultAlgorithms.ts` with stable
`<caseId>:alg:default-v1`, version-1 immutable records, provenance/correction/frame
metadata, and default/generator links. `algorithmSelection.ts` resolves a stored
preference first, then the built-in default, then the latest verified custom
algorithm. Built-ins are never copied into `customAlgorithms` or duplicated on
startup; users can switch to custom algorithms and revisions without losing
history. Training storage remains schema **v1** with no migration. Edit Cases now
shows the built-in default, the preferred choice, custom algorithms and
verification status. A new user sees **57 enabled · 57 with verified algorithms**
for OLL and **21 enabled · 21 with verified algorithms** for PLL.

**Provenance/legal limitation:** the owner removed the internal gate, but this is
not a third-party redistribution licence. Heroor has a README-only MIT claim and
no `LICENSE` file; Tao's MIT software licence credits AlgDb for other algorithms.
The implementation bundles only the 78 owner-approved short functional sequences,
independently normalized/verified and assembled with source provenance, not a
copied compilation, diagrams, presentation structure or extra variants. It
asserts no third-party redistribution licence. Written permission or legal review
remains advisable; see [Training memory E13](docs/training/PROJECT_MEMORY.md#e13-built-in-default-ollpll-catalog--2026-11-10).

Verification used Node **22.23.2**, synthetic data and isolated browser contexts:

```bash
npm test -- src/lib/training --maxWorkers=2
# 267 passed across 22 files

npm test -- src/lib/training src/components/TrainingPage.test.tsx --maxWorkers=2
# 272 passed across 23 files

npm run typecheck
npm run lint
npm run build
# All passed. Lint retains only the pre-existing SessionPanel Date.now warning.
# Build retains the existing >500 kB chunk warning; no ineffective-dynamic-import warning.

git diff --check
# Passed

node scripts/training/generate-diagrams.mjs --all --check
# Verified 78 diagrams and the complete contact sheet

npm run test:e2e -- e2e/training.spec.ts --project=chromium --workers=4
# 15/15 passed
```

Catalog tests validate all 78 records structurally and against cube states,
exercise **624** setup combinations (78 cases × execution/recognition × all four
AUFs), verify the exact OLL 45/56 corrections, exclude extra PLL variants, and
check stable IDs/provenance. Runtime tests cover built-in and custom preference
resolution, custom revision replacement of a built-in, disabled/empty pools,
recognition's two-case minimum and repeat avoidance. Persistence tests round-trip
stored built-in preferences and historical attribution snapshots without adding
defaults to storage. Chromium covers new-user defaults, refresh, PLL counts, Edit
Cases display, custom history preservation, timer/calibration and offline use.
Aggregate SHA-256 of the 78 SVG files:
`f8674bbb3337ec07ce7c2ee09440314762c052d59c706a5cb460367967433825`;
no SVG or diagram-generator source changed. Ordinary session bytes remain
unchanged in the browser regression.

Intentionally not run: full Vitest/full multi-engine Playwright or `npm run check`
(no release requested), Firefox/WebKit, physical hardware, assistive technology,
live Drive/OAuth, or large-history Training profiling. No dependency, commit,
push, deployment or publication was performed. Unrelated onboarding and working
changes are preserved.

## Training Phase 4 — 2026-11-10

> **Superseded in part by the built-in default section above (E13):** Phase 4
> originally shipped the complete UI with user-provided algorithms only. The
> defaults are now available; the Phase 4 architecture, timer, calibration,
> statistics and recovery behavior below remain current.

The explicitly expanded 4A/4B/4C implementation is complete: checked Training
controller/runtime and hook, one shared manual timer with a start-time eligibility
and immutable-context gate, third navigation destination, approved static case
assets/selection/presets/user algorithms, shared floating Tools/Last Result frames,
seven-repetition calibration and renewal, category statistics, corrections/typed
attempt deletion, visit recovery and recalculated reports. Training remains
local-only and excluded from ordinary backups/Drive. Architecture, exact file
inventory and remaining limits are in
[Training memory E12](docs/training/PROJECT_MEMORY.md#e12-expanded-phase-4--complete-training-ui-and-shared-timer--2026-11-10);
[current Training status](docs/training/CURRENT_STATUS.md) is the short entry point.

Verification used Node **22.23.2**, synthetic data and isolated browser contexts.
Separate suites ran sequentially. Final/relevant commands and results:

```bash
npm test -- src/lib/training --maxWorkers=2
# 250 passed across 20 files

npm test -- src/hooks/useTraining.test.tsx src/hooks/useScramble.test.ts src/components/TrainingPage.test.tsx src/components/ToolPanel.test.tsx src/components/TimerStage.test.tsx src/hooks/useTimer.test.ts src/timer/machine.test.ts src/hooks/usePostPaintValue.test.ts src/lib/alerts.test.ts src/lib/storage.test.ts src/lib/backup.test.ts src/lib/sessions.test.ts src/lib/sync.test.ts src/hooks/useSettings.test.ts src/hooks/useSync.test.ts --maxWorkers=2
# 370 passed across 15 files

npm test -- src/hooks/useTraining.test.tsx src/components/TrainingPage.test.tsx --maxWorkers=2
# 6 passed across 2 files after the final unsaved-exit regression; overlaps above

npm run typecheck
npm run lint
npm run build
# All passed. Final build restores ordinary output without mock Drive.

git diff --check
```

Focused milestone runs also passed: initial controller 8/8; controller/shared
machine/hook 34/34; runtime/component 7/7; shared timer/readout/tools/component
49/49. Initial missing-controller tests established the new regression boundary.
A jsdom dialog stub and a native-selector locator were corrected during test
setup. Restricted localhost/child-process launches prevented browser startup and
two SVG subprocess checks; they passed with process access. One later permission-review timeout succeeded on its permitted retry. No test assertions,
storage guards or verification rules were weakened. Final review added a failing-then-passing regression for navigation while a completion save was pending; the retained candidate now includes the visit end before Retry. Lint retains only the existing
SessionPanel Date.now purity warning. Vite reports the >500 kB main/cubing chunk
warning; this is not a large-history or bundle-performance clearance.

Production-preview Chromium commands (mock Drive, **four workers**):

```bash
npm run test:e2e -- e2e/training.spec.ts --project=chromium --workers=4
# Final full Training file: 14/14 passed
npm run test:e2e -- e2e/training.spec.ts --grep 'floating Training|production Training' --project=chromium --workers=4
# Earlier added panel/offline checks: 2/2 passed

npm run test:e2e -- e2e/timer.spec.ts e2e/timer-response.spec.ts e2e/cross-tab-timing.spec.ts e2e/draw-scramble.spec.ts e2e/timer-stability.spec.ts e2e/responsive-timer.spec.ts e2e/accessibility.spec.ts --project=chromium --workers=4
# 102/102 passed

npm run test:e2e -- e2e/analytics.spec.ts e2e/onboarding.spec.ts --project=chromium --workers=4
# 27/27 passed
```

**143 distinct targeted Chromium workflows passed.** Training coverage includes
keyboard and synthetic touch, exact-once recording/no ordinary-solve mutation,
input/navigation locks, explicit initial calibration/invalid retry/independent sets,
renewal recommendation versus forced start veto, recognition DOM/accessible
metadata hiding, case/user-algorithm/difficult/preset persistence, refresh resume,
navigation/category endings, inactivity deferred through running, restored-tab
Resume/End, non-blocking pending reports, result correction/deletion, corrupt and
future-version bytes, external-write conflict preservation/recovery download,
quota failure/navigation/retry/reload (result and visit end retained together), floating drag/resize/geometry and readout stability,
mobile docking and production service-worker offline setup generation plus all
78 image decodes. Pure domain tests retain exact count/day boundaries, baseline,
DNF/trimming, immutable snapshots and recalculated correction/deletion coverage.
The existing Timer suites also exercise ordinary deletion/Undo, backup restore,
csTimer import, mock Drive restore/conflicts, event timing, inspection/warnings,
large-session stop response and normal offline use. Analytics and pre-existing
onboarding flows passed without altering their work.

Visual review inspected real light/dark 1440×900, 390×844 and 320×740 captures,
including scrolled mobile controls. Serious/critical axe violations were zero for
these Training views and the Training settings dialog. Panels stayed below digits
when docked, defaults did not overlap, and desktop drag/resize/minimization left
the readout coordinates unchanged. Small-panel content scrolls. Native Training
configuration selectors retain platform behavior; modal focus uses the existing
containment/restoration helper. Reduced-motion emulation was included. Existing
ordinary responsive coverage also exercised short landscape viewports.

Starting SHA-256 comparison confirms **78/78 approved SVGs byte-identical** and
unchanged diagram generator, math, pure Training domain, ordinary schemas,
dependencies and unrelated onboarding source/tests. This phase adds 18 source/test
files and modifies nine existing source/test/style files plus six current docs;
E12 lists every file. Final documentation links/paths and diff whitespace were
checked. Build/browser/screenshot/scratch output is untracked/ignored or outside
the repository and is not part of delivery.

Intentionally not run: full Vitest/full multi-engine Playwright or npm run check
(no release requested; affected suites were targeted), Firefox/WebKit, physical
mobile/keyboard hardware, screen readers, live Drive/OAuth, Training large-history
profiling/retention or unauthorized backup/sync/reset format extensions. Existing
skips outside these selected Chromium suites remain unchanged. Fresh non-reload
openings with active visits still require a continuity choice; partial calibration
drafts are not durable, and forced termination can lose a failed-write candidate.
Recovery-copy export is not an automatic importer/merger. No dependency, commit,
push, deployment, publication or automatic Phase 5 work.

## Training Phase 3B — 2026-11-09

Phase 3B pure domain logic and compatible v1 extensions are implemented and
verified. No Training UI, app-mounted hook/store, browser listeners, navigation
or timer integration. Added `src/lib/training/{settings,results,calibration,stats,
visits,reports}.ts`, four owning test files, and extended types/schema/records/
storage plus their existing tests/fixtures. Updated README/known limits and both
Training memory files. See [current Training status](docs/training/CURRENT_STATUS.md)
and [E11 architecture/policies](docs/training/PROJECT_MEMORY.md#e11-phase-3b--pure-calibration-statistics-and-practice-visits--complete-2026-11-09).

File inventory for this task: created six domain modules above plus
`calibration.test.ts`, `stats.test.ts`, `visits.test.ts` and
`domainStorage.test.ts` (10 files). Modified Training `types.ts`, `schema.ts`,
`records.ts`, `storage.ts`, `records.test.ts`, `storage.test.ts`,
`persistenceIntegration.test.ts`, `persistenceFixtures.test-support.ts`, and
`README.md`, `KNOWN_LIMITATIONS.md`, `STATUS.md`,
`docs/training/CURRENT_STATUS.md`, `docs/training/PROJECT_MEMORY.md` (13 files).
All other captured existing files remain unchanged.

- Fixed inverse-precursor calibration, seven positive valid samples/exact median,
  independent OLL/PLL activation/renewal, optional vs forced renewal, durable
  deletion-safe recognition counts and immutable captured estimates. Page opening
  never calibrates. Recognition requires two distinct enabled cases.
- Success/DNF only for new attempts; no inspection/+2. Four-category raw and
  estimated summaries, case/algorithm revision attribution, 90-day default or
  configurable days/attempt-count baselines, case-matched improvements and exact
  symmetric ceiling-trim rolling averages. Empty trim windows and missing
  estimates have explicit unavailable states.
- Pure visit events cover category switching, activity, refresh, navigation,
  inactivity and confirmed closure; running attempts defer transitions. Reports
  recalculate by stable visit/attempt references with captured baseline policy
  and end/as-of cutoff. No frozen aggregates or ordinary CubeLab sessions.
- Payload/key stay v1. Optional validated extensions preserve legacy +2/invalid
  records, untagged/zero/nonmedian calibration metadata and multi-category visits
  without rewriting reads. Unsupported results are explicit in statistics;
  untagged calibration cannot authorize new recognition. Saves preserve checked
  raw-value guards, historical timing/snapshots, calibration completion order,
  visit identity/policy/end boundaries and monotonic recognition counts.
- Browser refresh vs closure requires future explicit continuity evidence;
  unknown startup returns a signal requirement. No detection is claimed. Legacy
  visit baseline policy is not invented. Native backups/Drive/reset/recovery/
  onboarding/cross-tab integration, retention/size/performance and UI remain
  future work. At the Phase 3B checkpoint, F12 blocked algorithm datasets and
  additional PLL variants; E13 later removed the internal gate for the 78 defaults.

Verification used Node **22.23.2**, with suites sequential. The dated record
prefixed npm commands with the historical nvm PATH; current setup is in
[AGENTS.md](AGENTS.md).

- `npm test -- src/lib/training/calibration.test.ts src/lib/training/stats.test.ts src/lib/training/visits.test.ts --maxWorkers=2`:
  initial three missing-module suites failed before implementation (no tests ran).
- `npm test -- src/lib/training/calibration.test.ts src/lib/training/stats.test.ts src/lib/training/visits.test.ts src/lib/training/records.test.ts src/lib/training/storage.test.ts src/lib/training/persistenceIntegration.test.ts --maxWorkers=2`:
  initially 75 passed/9 failed (new-vs-legacy fixture expectations, setup date and
  floating-point assertion); after corrections **84/84 passed**. Legacy history
  now loads through explicit legacy fixtures; new builders enforce current rules.
- `npm test -- src/lib/training/domainStorage.test.ts --maxWorkers=2`: initially
  13 passed/1 failed because the legacy fixture median was no longer one of its
  samples; fixed the fixture without weakening validation.
- `npm test -- src/lib/training/calibration.test.ts src/lib/training/stats.test.ts src/lib/training/visits.test.ts src/lib/training/domainStorage.test.ts --maxWorkers=2`:
  **44/44 passed** before additional final guard regressions.
- `npm test -- src/lib/training/calibration.test.ts --maxWorkers=2`: the added
  equal-timestamp/backward-ID replacement regression failed (11 passed/1 failed)
  before selecting the later completion and guarding persisted completion order.
- `npm test -- src/lib/training --maxWorkers=2`: restricted run had 228 passed/
  2 SVG subprocess EPERM failures; rerun with process access passed 230/230.
  After the final replacement-order/counter regressions, **232/232 in 18 files
  passed**. Existing SVG checks ran read-only with process access; none skipped.
- `npm test -- src/lib/storage.test.ts src/lib/backup.test.ts src/lib/syncStorage.test.ts src/lib/driveStorage.test.ts src/hooks/useSettings.test.ts --maxWorkers=2`:
  **111/111 in five existing persistence files passed**.
- `npm run typecheck`: final pass after resolving parameter narrowing/unused
  import and intentional invalid-input fixture typing during development.
- `npm run lint`: passed; only the existing `SessionPanel.tsx:566` purity warning.
- `git diff --check` and whitespace checks of changed untracked Training files:
  passed. Relative documentation links/new anchors and referenced source paths
  were checked. SHA-256 comparison against the pre-task manifest confirms all
  **78 approved SVGs**, existing math/setup/catalog/diagram/generator/reference
  files and captured unrelated application files are unchanged.

Intentionally skipped: application/full-browser E2E, full application Vitest,
production build/PWA/offline verification, manual UI/browser/physical-device/
physical-cube checks and live Drive. This phase has no application/UI/worker/
network integration, and the owner specifically excluded broad browser suites.
No dependencies, third-party algorithm records, production migration, commit,
push, deployment or publication. Existing unrelated work is preserved.

**Immediate Training task:** stop after Phase 3B. A separately authorized Phase 4
should review E11 continuity/storage-health/start-time snapshot prerequisites
before implementing checked-storage orchestration and the shared manual timer.
Do not start it automatically; at that checkpoint F12 remained unresolved and was
later superseded by E13.

## Training Phase 3A — 2026-11-09

Phase 3A is implemented and verified: separate versioned Training attempts,
preferences/presets/custom algorithms, practice visits and calibration snapshots,
with checked local persistence. `src/lib/training/{types,schema,records,storage}.ts`
uses schema **v1** at `cubelab:training:v1`; sessions v6/settings v11/native
backup v1/sync envelopes are unchanged. Loads never write, corrupt/unsupported
bytes block writes, saves require the checked raw value and validate the entire
candidate. First-schema migration validates/detaches v1; no invented legacy
Training migration or production startup migration is activated.

Attempts keep permanent category/raw timing/setup/calibration/preferred-at-start
snapshots. Only explicit attribution correction changes a saved attempt; no
executed algorithm is inferred. Four-category case/algorithm/visit selection is
separate from ordinary solve statistics. One automatic practice visit may span
categories while retaining exact category/attempt references. No Training UI,
app-mounted hook, calibration/statistics/report calculation, automatic visit
resume logic, dependency or bundled algorithm content was added.

The owner explicitly approved all **78 final SVGs**; hash comparison confirms
all **112 pre-existing Training source/asset/generator files** unchanged.
Gb/Gd historical visual exceptions and E9.16/E9.17 supersession remain recorded.
Unrelated onboarding/other changes are preserved; nine additionally captured
unrelated file hashes also match. No commit, push, deploy or publication.

Node 22.23.2, suites sequential. The dated record used the historical nvm
environment first; current setup is in [AGENTS.md](AGENTS.md).

- `npm test -- src/lib/training/records.test.ts src/lib/training/storage.test.ts`:
  initially failed to resolve the not-yet-created implementation; then passed
  **53/53**, and **56/56** after added guard coverage.
- `npm test -- src/lib/training/storage.test.ts`: the new immutable-history
  regression failed before the save guard (**42 passed, 1 failed**); fixed
  without relaxing validation.
- `npm test -- src/lib/training`: initial **179 passed, 6 failed**. Four new
  integration fixtures missed the existing verified-algorithm precondition;
  corrected the fixtures, preserving generator checks. Two existing SVG tests
  could not launch read-only generator subprocesses (EPERM).
- `npm test -- src/lib/training/persistenceIntegration.test.ts`: **4/4 passed**
  with real mathematically verified setup output for all four categories.
- Final `npm test -- src/lib/training --maxWorkers=2`: **185/185 passed in
  14 files**, including the existing read-only generator checks, run with the
  subprocess access they require. Includes **60 new Phase 3A tests** for
  corruption/versions/lossless serialization, failed reads/quota/stale writes,
  record creation, permanent category/attribution, preferences, custom revisions,
  visits, separate calibration snapshots, penalties/invalid attempts and ordinary
  history/custom-event/backup preservation.
- `npm test -- src/lib/storage.test.ts src/lib/backup.test.ts src/lib/syncStorage.test.ts src/lib/replacement.test.ts src/lib/startupRecovery.test.ts src/lib/onboarding.test.ts src/hooks/useSettings.test.ts --maxWorkers=2`:
  **139/139 passed in 7 files**.
- `npm run typecheck`: final pass; an initial synthetic custom-event fixture
  used the wrong placeholder field and was corrected. `npm run lint`: passed
  with only the pre-existing `SessionPanel.tsx:566` purity warning.
- `git diff --check`: passed. Local documentation link/path checks and the
  protected-file SHA-256 comparison passed.

Intentionally skipped full application Vitest, Playwright/all browser engines,
manual UI, production build/offline and live Drive: the new isolated modules
are not mounted, and no UI, existing destructive path, worker/build, backup or
sync behavior changed. No live credentials or real browser history were used.
Large-history performance/size was not profiled.

Training remains excluded from native backup/export/import and Drive sync.
Cross-tab adoption, replacement/recovery UI, reset/onboarding integration,
retention and size policy remain later work. At the Phase 3A checkpoint, F12
blocked third-party algorithm records and the 37 PLL alternatives; E13 later
implemented the 78 defaults. After a new Phase 3B request,
the exact first task is pure seven-sample calibration/median/renewal/snapshot
logic with tests, resolving F6/F8 fidelity and missing/expired/below-calibration
policy before those branches; category statistics/visit/report logic follows
with approved F9 baselines. No Phase 3B or Phase 4 started. Architecture and
prerequisites: [Training memory E10](docs/training/PROJECT_MEMORY.md#e10-phase-3a--training-data-model-and-persistence--complete-2026-11-09).

## Training PLL corner arrows — 2026-11-09

Corner arrows are lengthened (E9.16) and now centred on actual cubie-centre
lines (E9.17), removing the prior 5 px outward bias. All edge-arrow groups and
57 OLL SVGs are byte-identical. Latest focused renderer/SVG tests passed 26/26
(including deterministic generator checks), typecheck and lint passed (existing
SessionPanel warning), and all 21 PLLs were inspected in Chromium at 128/64 px
on light/dark. No head collisions or clipping; G-perms remain dense at 64 px.
Full app/browser suites and build skipped for static SVG presentation only.
See [Training current status](docs/training/CURRENT_STATUS.md) E9.17 for commands
and limits. No commit or push; unrelated working changes preserved.

## First-run onboarding — 2026-11-08

The first-run setup system is implemented as a lazy full-screen flow before the
editable timer. It reuses the existing session, settings, csTimer parser,
durable replacement, Drive transport and synchronization merge systems.

- **Detection and durability:** `cubelab:onboarding:v1` stores a completed or
  skipped decision plus a non-sensitive in-progress draft. A saved draft resumes;
  no OAuth token is persisted. Meaningful sessions, solves, custom events,
  ordering/transfers, stored settings, sync identity or Drive metadata suppress
  onboarding for existing users. An untouched auto-created placeholder does not.
  A welcome draft is written before the app hooks mount so a reload cannot be
  mistaken for an existing installation after default settings/Sync identity are
  written.
- **Start Fresh:** staged event cards (3×3 default, at least one required),
  common settings and Main Event. Commit is idempotent and durable: one empty
  session per event, untouched 3×3 placeholder reused where possible, meaningful
  sessions preserved, no duplicate sessions on retry/reopen. The Main Event
  activates its session and stamps selection metadata so a first cloud merge
  cannot silently replace it.
- **csTimer:** reuses `analyzeCsTimerBackup`/`parseCsTimerBackup`, preview,
  validation, custom-event mapping/deduplication and additive durable import.
  No event-selection step and no extra empty event sessions. A durable import
  checkpoint reconciles interrupted commits by preview signatures, preventing
  duplicate imports. Main Event choices are limited to imported events.
- **Returning user:** uses the existing Google transport, all-snapshot reader and
  sync merge; reports real found/restored counts, preserves custom events,
  ordering, settings, tombstones and selection metadata, and does not treat
  sign-in as restoration. No data found offers another account, Start Fresh,
  csTimer import or Skip. A failed restore has no completion success state.
- **Optional sync:** shown only for Start Fresh/csTimer. Existing cloud data is
  disclosed before merge; local setup is not uploaded before a choice. Maybe
  Later leaves sync disabled and local setup commits normally. Connection/sync
  failures can be skipped without losing local data. A clean-device restore
  verifies the expected solve count before advancing.
- **Device settings:** only the device-local Draw Scramble 2D/3D preference is
  requested after restoration. Synchronized inspection, timer input, theme,
  scaling, statistics and analytics settings are not re-asked.
- **Completion:** actual counts, Main Event and real Drive status display for
  about three seconds, then fade to the timer with the chosen session active. No
  Start Cubing button or tutorial. Required failures never show success.
- **Reopen:** Settings → Data → Setup assistant reopens the flow non-destructively;
  existing solves are preserved and empty event sessions are reused. Closing a
  reopened flow keeps the prior completed decision and clears only its draft.

Settings classification confirmed from the implementation: every top-level
`Settings` field in `SETTINGS_FIELD_KEYS` is synchronized; Draw Scramble mode and
tool-panel visibility/geometry are local. Only Draw Scramble mode is relevant
onboarding configuration, so the returning-user device step shows just that.

Node 22.23.2 verification, separate suites sequential unless noted:

- `npm run typecheck`: passed. `npm run lint`: passed with only the pre-existing
  `SessionPanel` purity warning. `git diff --check`: passed.
- Full Vitest: **976 passed in 70 files**. New owner coverage: onboarding
  detection/draft serialization, placeholder reuse/removal, retry idempotency,
  import reconciliation, Main Event import choice, lockstep component flows,
  save failure, csTimer preview, already-connected state, OAuth failure,
  no-cloud returning state and Settings reopen.
- `e2e/onboarding.spec.ts`: **12/12 passed** on Chromium `--workers=4`. Covers
  all three paths, three-second automatic completion, actual summaries, optional
  sync, detected cloud data with Keep local, successful returning restore with
  custom events/settings, failed optional Google read, skip persistence, upgrade
  suppression, interrupted resume, non-destructive reopen, keyboard-only event
  selection, reduced motion, mobile overflow bounds and light/dark axe checks
  with no serious/critical violations. The csTimer path asserts preserved
  custom-event definitions and three imported sessions with no extra empty event
  sessions.
- Chromium `--workers=4`: `session-management`, `storage-safety`, `single-tab`
  and `accessibility` **45/45 passed**, and `cross-tab-timing` **6/6 passed**.
  `timer.spec.ts` passed **63/64**; the one Pyraminx mobile scramble wait exceeded
  its timeout under parallel load and passed alone immediately afterward. All
  product behavior paths, native backup, csTimer, mock Drive and production
  offline cases passed.
- A user-authorized `timer.spec.ts` trial at `--workers=16` produced **55/64**
  with resource-contention timeouts in inspection clock fast-forward, large
  histories, 4×4/Square-1 scramble generation, named sessions and one backup
  flow. All **9** failed cases passed together on a normal `--workers=4` rerun.
  The 16-worker run is not treated as a product failure.
- `npm run build`: passed with normal (non-mock) output and PWA generation;
  Onboarding is a separate 37.04 kB lazy chunk, and the csTimer parser plus cloud
  reader are deferred until their paths request them. Existing large-chunk
  advisory remains.
- Visual inspection: desktop light welcome/events/settings/sync and mobile
  390×844 light/dark welcome, events, settings, sync and completion. No clipping,
  horizontal overflow or missing actions observed; completion was inspected after
  entry animation settled.

Not tested: live Google OAuth/Drive, Firefox/WebKit for onboarding, physical
devices and assistive technology. No dependencies installed, no release version
changed, no commit or push. Existing unrelated changes remain intact.

## N1/N3 startup read and native-date safety — 2026-11-07

The remaining two scoped single-tab findings are repaired:

- **N1:** Bootstrap obtains a checked session snapshot before mounting editable
  hooks. Current and legacy read failures, malformed/unsupported records and
  invalid stored dates retain their original bytes behind the retry gate.
  Only an absent current key permits legacy migration. The same snapshot and
  raw value feed `useSessions`, so normal startup reads the collection once;
  the single-read invariant is tested. Completion-buffer startup replay uses
  the checked loader too and retains its buffer on read failure. No fallback
  empty collection is autosaved after a failed read.
- **N3:** Shared date bounds reject unrepresentable provided creation/update
  timestamps in native session/solve records before local mutation. The remote
  backup reader uses that validation too. Existing invalid stored dates are
  preserved behind recovery rather than silently discarded; Retry does not
  automatically correct malformed data. History ISO attributes, full labels and
  relative labels have a defensive Unknown date path for invalid in-memory data.

Node 22.23.2 verification, with separate suites sequential and Chromium
`--workers=4`:

- Before implementation, six owning unit regressions and all four new browser
  regressions failed; the exact representable-date boundary test already passed.
- `npm run typecheck`: passed. `npm run lint`: passed with only the pre-existing
  SessionPanel purity warning.
- Focused storage/backup/format/session/completion group: **133 passed**.
- Final `npm test -- --maxWorkers=2`: **952 passed in 68 files**.
- `e2e/storage-safety.spec.ts`, `e2e/single-tab.spec.ts`, and
  `e2e/session-management.spec.ts`: **42/42 passed**. Includes failed current and
  legacy reads with successful retry, native invalid-date file rejection,
  invalid stored-record preservation, single-tab ownership and replacement/
  deletion/Undo/session regressions.
- Selected native backup round trip, mock Drive backup/restore and production
  offline bootstrap in `e2e/timer.spec.ts`: **3/3 passed**.
- Final normal `npm run build`: passed, including PWA generation; non-mock output
  restored. Existing chunk-size advisory remains. `git diff --check`: passed.

No dependencies installed, live Drive calls, commits or pushes. Firefox/WebKit,
physical devices and assistive technology were not run. Existing unrelated
changes remain intact. These changes do not claim to repair the separate N2
legacy-client deferred-adoption path; the single-tab policy prevents normal
current-build same-profile concurrent editing.

## Single-tab ownership — 2026-11-07

A dedicated `cubelab-active-tab` Web Lock now gates `Bootstrap` in `main.tsx`.
Only its owner mounts recovery and application hooks. Other current-build tabs
show a waiting screen and queue automatically until the owner closes; focus and
background suspension do not steal ownership. The lifetime lock is separate
from the existing Drive/replacement write lock. Missing or rejected coordination
keeps editing closed, with retry after request failure. Scope and older-client
boundaries are documented in `README.md` and `KNOWN_LIMITATIONS.md`.

Verification used Node 22.23.2 and sequential Chromium suites with
`--workers=4`:

- Five new browser cases failed against the pre-feature implementation.
- `npm run typecheck` and `npm run lint` passed; lint retains only the existing
  SessionPanel purity warning.
- `npm test -- --maxWorkers=2`: **938 passed in 67 files**. Focused ownership,
  startup and replacement coverage passed **21/21**, including StrictMode,
  pending request cancellation, release, blocked children and retry.
- `e2e/single-tab.spec.ts`: all **5** cases passed. Covers simultaneous opens,
  reload, saved-history takeover, running-timer focus safety, unsupported
  coordination and retry after rejection. Waiting-screen visual review passed.
- Session management, cross-tab timing and timer response: **39 passed and one
  failed** on the first corrected-gate regression run. The failure exposed a
  test-only shim dropping the native two-argument lock-request overload; the
  shim was corrected. The affected original case plus two session protocol
  cases and the five strengthened ownership cases then passed **8/8**.
- Selected native backup/import, mock Drive backup/restore and production
  offline bootstrap: **3/3 passed**. Across runs, **48 distinct Chromium cases**
  reached a passing result. The old protocol cases explicitly simulate older
  concurrent clients; production has no gate bypass.
- An earlier integration run was stopped after identifying an invalid browser
  lock-option combination; this was corrected before the passing runs above.
- Final `npm run build` passed, including PWA generation, and restored normal
  non-mock output; the existing chunk-size advisory remains. `git diff --check`
  passed. No dependencies, live Drive requests, commits or pushes.

Firefox/WebKit, crash/BFCache-specific scenarios, physical devices and assistive
technology were not tested in this batch. Existing storage-read and malformed
native-date findings are not repaired by tab exclusion. Existing sync/recovery
safeguards remain in place for older clients and other browsers/devices.

## Implemented checkpoint

This consolidated checkpoint predates the Training overhaul. The newest entries
above and [Training status](docs/training/CURRENT_STATUS.md) add the current
OLL/PLL workspace; where they differ, the newest dated record and current
code/tests win.

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
  typed-confirmation solve reset and **Delete All Sessions**, which record
  session and solve tombstones, block unsafe storage/sync states and skip
  snapshot cleanup for their publication. **Reset All Site Data** is the full
  local restart: it disables sync, blocks Drive, clears CubeLab-owned storage,
  indexed databases, caches, the scoped service worker and local Google
  authorization, then reloads into onboarding. It never uploads an empty state
  or deletes Drive files; partial failures report the blocking item and offer
  retry.
- Inspection/penalties/warnings, named sessions, comments/actions, configurable
  average trimming, compact/expanded Time Trend, wheel/pinch/pan and historical
  PB statistics are implemented. Sessions use schema v6; settings use v11.
  Sessions can be reordered with drag handles, arrow-key reordering, and
  accessible Up/Down controls inside the session selector; order is backed up
  and synchronized as an ID-based record. Session
  settings can correct a session's event (with confirmation when solves exist)
  while preserving every solve field and import provenance. **Session settings**
  also merges one or more same-event sources into a destination and splits
  individual/range-selected solves into a new session. Merge previews names,
  counts and totals and removes sources only after transfer; split copies the
  source event/settings, inserts the new session next to the source, keeps the
  source even when emptied, and selects the new session. Both require typed
  confirmation and provide no Undo. Partial splits persist durable transfer
  records so stale cloud or cross-tab copies cannot duplicate or reclaim moved
  solves. Optional completed/
  total solve and total-time summaries live in the slim timer footer, follow
  csTimer's DNF/+2 semantics, show counts without a suffix and total time in
  hours. A release-record display version appears in the bottom-right footer.
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
- Statistics rows render Current, Best and any enabled Target/BPA/WPA inline
  with independently configurable metric visibility. Target is calculated from
  the session PB (strictly faster), not a manual goal; BPA/WPA reuse the shared
  trimming and recorded-result rules. The desktop Statistics/Solves divider uses
  an intrinsic content measurement, keeps every enabled average mounted,
  shares spare row space and falls back to internal Statistics scrolling only
  when the viewport cannot fit both panel minimums.
- The November 1 regression follow-up fixes active-session approval application,
  deterministic selection metadata (including envelope parsing/adoption), and
  csTimer malformed numeric/date validation before preview/confirmation.

Core phases 2A–4, theme polish, Phase 5 remediation and Phase 6a are delivered.
Future feature-phase proposals have been removed at the user's request. The
retained work is the five follow-ups below; the retired Solve explorer was
replaced by the filtered solve-list details dialog.

## D1–D5 outstanding fixes — 2026-11-07

The five deferred findings in
[docs/CubeLab-outstanding-five-fix-plan-2026-11-07.md](docs/CubeLab-outstanding-five-fix-plan-2026-11-07.md)
are implemented.

- **D1:** Analytics now uses one local-calendar-day invalidation source. It
  schedules the next local midnight from wall-clock date arithmetic, recomputes
  after visibility/focus return, and feeds the same day token into relative-date
  filtering, session comparison and activity/streak calculations. DST, month and
  year boundaries use local calendar arithmetic rather than fixed 24-hour
  periods.
- **D2:** A matching release from `holding` starts directly when
  `release.at - holdStartedAt >= holdDurationMs`, using the release timestamp as
  `startedAt`. A readiness tick is presentation-only and no longer required.
  Early releases, wrong input sources, repeats, inspection penalties, cancel and
  exactly-once recording retain their previous behavior; zero-duration holds are
  handled explicitly.
- **D3:** Native export, manual Drive backup and automatic upload share a checked
  serializer. It measures the UTF-8 payload including formatting, prefers
  readable JSON, falls back to compact JSON, and blocks output whose complete
  form still exceeds `MAX_BACKUP_BYTES` (10 MB). Oversized automatic syncs store a
  blocked fingerprint to avoid repeated download/serialization loops; manual
  retry and local edits re-evaluate. No oversized file or snapshot is emitted.
- **D4:** Practice activity aggregates remain sparse across the full filtered
  range, while the heatmap materializes only a 371-day window with
  Earliest/Earlier/Later/Latest navigation. Totals, streaks, weekly/monthly
  volume, best/worst days and drill-down cover the complete range; a 100,000-day
  span creates two active-day records and a bounded cell set rather than 100,001
  daily rows.
- **D5:** Native import, additive csTimer import and Drive restore use a durable
  replacement coordinator. It captures every affected committed key in a local
  journal, stages sessions/settings/sync/drive values, writes a commit marker,
  then publishes React state and success metadata. A pre-marker failure rolls
  back; a post-marker failure rolls forward; failed rollback/cleanup keeps the
  journal and pauses sync/new imports. Startup recovery runs before React reads
  storage. Other tabs ignore prepared intermediate keys and adopt the committed
  result. Pending Undo recovery blocks replacement rather than being discarded.
  The replacement record is local-only and the separate storage keys are not an
  atomic transaction.

Verification: TypeScript passed. Oxlint passed with only the pre-existing
`SessionPanel` purity warning. Full Vitest **897 passed in 64 files**, including
new local-day, hold-release, checked-serialization, sparse-calendar,
replacement-journal, durable-replacement hook, staged hook, sync-base and
cross-tab/reload regressions.
Chromium passed Analytics **15/15**, session management **27/27**, custom events
**4/4**, and timer/timer-response/cross-tab timing **67/67**. The normal
production build and PWA generation passed after the mock-Drive browser runs.
Firefox/WebKit, live Drive, physical devices and assistive technology were not
run for this batch. No release version changed.

## D5 replacement-safety V1/V2 — 2026-11-07

The two remaining confirmed D5 defects are repaired without changing the
D1–D4 or earlier B/F/J work.

- **V1:** Committed/removed replacement notifications now use the same
  timer-safe adoption boundary as ordinary cross-tab session changes. The first
  prepared event records a pre-deferral collection baseline; the latest complete
  sessions/settings/sync outcome is retained until the timer is idle. Idle
  adoption reconciles solves added after the baseline by stable ID, creates a
  labelled same-event recovery session when the original owner disappeared, and
  carries the external selection with its sync provenance. Completions accepted
  while a candidate is prepared or not yet adopted go to the local-only
  `cubelab:replacement-completion:v1` buffer instead of overwriting the staged
  collection; the buffer is replayed and cleared after the outcome is adopted or
  before normal hooks mount on reload.
- **V2:** The normal application no longer mounts after an unresolved replacement
  recovery. Startup recovery runs before the session/settings hooks, and a
  prepared journal is rolled back only while holding the same
  `cubelab-drive-write` Web Lock used by the replacement coordinator. A committed
  journal is cleanup-only and may open normally. Failed prepared rollback/cleanup
  and malformed or unreadable records render a minimal retry-only recovery state
  with no editable collection, autosave, timing controls, imports or timing
  listeners. Without Web Locks a prepared record stays pending conservatively.
  Buffered completions are applied and saved before the application mounts.

Verification: TypeScript passed. Oxlint passed with only the pre-existing
`SessionPanel` purity warning. The V1/V2 probes failed before the repair (active
session changed to the committed replacement; prepared-phase completion
overwrote its candidate; failed startup rollback exposed the candidate and
accepted later work was lost). After the repair, full Vitest **917 passed in 66
files**; the focused replacement/session/sync/recovery group passed **163/163**.
Chromium passed `cross-tab-timing` **5/5** and `session-management` **32/32**
together **37/37**, including active/prepared/rolled-back ownership plus reload,
failed rollback, rollback-cleanup failure, committed-cleanup failure, malformed
journal and live-writer lock coordination. `timer` plus `timer-response` passed
**65/65**, including native import/export, delete/Undo, mock-Drive restore,
csTimer import and the production offline case. The normal production build and
PWA generation passed after the mock-Drive browser runs. Firefox/WebKit, live
Drive, physical-device and assistive-technology checks were not run for this
batch. No release version changed.

## C1–C3 completion replay and Analytics rail — 2026-11-07

The three findings in
[docs/CubeLab-C1-C3-repair-plan-2026-11-07.md](docs/CubeLab-C1-C3-repair-plan-2026-11-07.md)
are repaired without changing the earlier B/F/J/D/V work.

- **C1:** Completion replay now routes through event-aware cross-tab
  reconciliation. The original owner is reused only when its event matches the
  buffered solve; a missing or reclassified owner receives a stable labelled
  same-event recovery session. Replacement and buffered custom-event definitions
  are unioned rather than one side discarding the other. Active solve tombstones
  suppress replay, so a deliberate later deletion cannot be resurrected.
  Replaying the same buffer is idempotent, and the resulting collection passes
  the real native-backup parser.
- **C2:** Generic collection persistence no longer erases the completion buffer.
  New buffers write one local key per solve, so two competing appends survive and
  an append between a replay snapshot and acknowledgement is preserved.
  Acknowledgement removes only exact solve versions now present in the durable
  collection or superseded by an active deletion tombstone; failed removal keeps
  the durable buffer for an idempotent retry. The replacement coordinator applies
  the pending buffer before staging its candidate, updates the sync solve count,
  and acknowledges only after the commit marker succeeds. A failed collection
  stage leaves the buffer untouched. The older single-record buffer is still
  readable; its cleanup remains a non-atomic read/check/write sequence.
- **C3:** The bounded desktop Analytics rail is `position: static`; the sticky
  offset that moved the heading/tabs by four pixels between empty Practice
  activity and Advanced analytics is gone. Empty sessions, empty filtered
  results, populated history, short desktop viewports, keyboard focus and the
  mobile selector keep stable geometry.

Verification: TypeScript passed. Oxlint passed with only the pre-existing
`SessionPanel` purity warning. Full Vitest **933 passed in 66 files**, including
new event-compatible replay, custom-event union, tombstone suppression,
per-solve competing append, exact acknowledgement, failed cleanup/stage,
coordinator commit, startup replay and idle cross-tab adoption regressions.
Before the repairs, the focused C1/C2 regressions failed **7/7** and the four new
empty-scope Analytics geometry cases failed with the reported 283→287 px shift.
After the repairs, Chromium passed `session-management`, `cross-tab-timing` and
`analytics-layout` **47/47** together, including the new prepared-phase
reclassification/reload browser case and the native-import coordinator case with
a buffered follower completion. Selected `timer` native backup/import,
mock-Drive backup/restore and production offline cases passed **3/3**. The normal
production build and PWA generation passed after the mock-Drive browser runs.
Firefox/WebKit, live Drive, physical-device and assistive-technology checks were
not run for this batch. No release version changed.

## November 7 audit repairs — 2026-11-07

The eight confirmed findings in
[docs/CubeLab-audit-2026-11-07.md](docs/CubeLab-audit-2026-11-07.md) are
repaired. The five hypotheses investigated separately with temporary synthetic
fixtures were subsequently repaired in the D1–D5 batch above. The earlier
confirmed-defect patches remain independently reviewable in the working history.

- Additive csTimer imports now use a dedicated sync update instead of
  `resetBase`. Existing solve/session/event tombstones, session redirects,
  pending conflicts, exact approvals, settings field timestamps and
  active-session selection metadata survive the import; only the published
  fingerprint/count and pending status are refreshed. An unpublished deletion
  is therefore not erased by adding sessions.
- Individual solve deletion records its tombstone before removing the solve and
  blocks with no mutation if that sync write fails. Session persistence now also
  completes before the solve disappears; a failed session write revokes the
  just-written deletion intent so the visible collection and journal agree.
  Undo persists the revocation and restored solve before reporting success.
- Analytics now computes best averages as a forward prefix minimum, so a later
  slowdown or DNF window cannot replace an earlier best. The advanced moving
  median sorts each valid attempt window.
- Rolling Analytics date presets subtract local calendar dates instead of fixed
  24-hour periods, preserving inclusive day counts across DST. Equal timestamps
  inside one stored (newest-first) session are reversed back to their original
  chronology, so latest-N selection keeps the newest attempts.
- Manual Drive restore passes each snapshot's active-session metadata through
  the accumulator, and manual backup creation publishes the local selection
  metadata. The restore result now follows the same provenance as automatic
  synchronization.
- Closing the lazy Backup/Drive dialogs restores focus to the visible header
  Settings button, including after failed-file, Escape, export, cancel-import
  and completed-import paths.

Verification: TypeScript passed. Oxlint passed with the pre-existing
`SessionPanel` purity warning. Full Vitest **837 passed in 59 files**, including
new durable-deletion, additive-import metadata, Analytics chronology/calendar,
manual-restore provenance and focus regressions. Focused Chromium passed the
completed native backup round trip with focus checks, solve-menu delete/Undo,
the new sync/session-write failure cases, both csTimer import cases, mock-Drive
restore plus active-session review, and Analytics **13/13**. The mock build was
followed by a normal production/PWA build. Firefox/WebKit, live Drive and
physical accessibility checks were not run for this repair batch; the external
audit's A6/A7 fixtures still call the superseded additive/reset and
delete-then-record sequences directly and are not used as current-path tests.

## Deletion-safety follow-up — 2026-11-07

The four follow-up findings in
[docs/CubeLab-repair-plan-2026-11-07.md](docs/CubeLab-repair-plan-2026-11-07.md)
are repaired without changing the B1–B8 work.

- **F1:** `recordDeletions` and `recordAllSessionDeletions` now persist a
  detached candidate before publishing React state/refs or retention flags. A
  rejected bulk reset/delete-all leaves no active intent for a later sync.
- **F2:** Clear Session uses one checked batch tombstone write and publishes the
  empty collection only after the session write succeeds. Intent failure keeps
  every solve; collection failure leaves durable intent and a truthful retry
  message. Custom-event deletion now validates first, records its event
  tombstone first, and rolls that intent back if the collection cannot be saved.
- **F4:** Toast actions dismiss the original action toast before invoking the
  callback, so replacement failure/recovery notifications remain visible.
- **F3:** Undo now writes a local-only recovery journal before changing deletion
  intent. If revocation succeeds but the collection restore fails, the journal
  survives reload and is applied before synchronization; sync pauses while it
  remains pending. Native and manual backups include the pending solve, and a
  later deliberate deletion supersedes the journal. No unchecked rollback is
  used after the revocation has been accepted.

Verification: TypeScript passed. Oxlint passed with the pre-existing
`SessionPanel` purity warning. Full Vitest **849 passed in 60 files**; the
focused deletion/session/sync/recovery group **239 passed**. Chromium passed
`session-management` plus `cross-tab-timing` **25/25**, `custom-events` **4/4**,
the selected timer/solve/backup/csTimer/Drive cases **6/6**, and the new
failure-path probes for blocked bulk reset, Clear Session, Undo notification and
cross-reload Undo recovery. The external bulk probe now passes **2/2**. Firefox/WebKit, live
Drive, physical-device and assistive-technology checks were not run.

## Recovery-journal follow-up — 2026-11-07

The two confirmed journal defects in
[docs/CubeLab-journal-fix-plan-2026-11-07.md](docs/CubeLab-journal-fix-plan-2026-11-07.md)
are repaired, and the interrupted-Undo checkpoint is now explicit.

- **J3:** Recovery scheduling no longer depends on a notification callback that
  changes every render. The hook keeps the latest notifier in a ref, retries only
  on mount, storage-health changes, timer-idle transitions or explicit sync, and
  deduplicates unchanged journal outcomes. Recovery is deferred while the timer
  is active. A failed collection or journal-cleanup write leaves one pending
  notice, preserves the journal, and does not start a render/notification loop.
- **J2:** Recovery and backup materialization compare the normalized destination
  session event with the solve event. Incompatible or missing targets use a
  stable labelled recovery session with the original event, while the source
  session remains unchanged. Shared `restoreSolve` now rejects mismatched events,
  so direct Undo cannot bypass the same invariant. Native export and manual Drive
  backup use the same materialization and fail explicitly if a pending solve
  cannot be resolved.
- **J1 commit point:** A journal is written before the tombstone revocation. If
  the original deletion remains active, the interrupted Undo is treated as
  prepared-but-not-committed and aborts conservatively; the solve stays deleted.
  Once the revocation is durably committed, incomplete collection restoration is
  finished after reload/storage recovery. A causally later deliberate deletion
  supersedes the prepared restoration and is reported separately. Older journal
  records without original-deletion metadata use the conservative abort when an
  active tombstone is present.

Verification: TypeScript passed. Oxlint passed with the pre-existing
`SessionPanel` purity warning. Full Vitest **861 passed in 60 files**; the focused
recovery/session/sync/backup group **168 passed**. Chromium
`session-management` + `custom-events` + `cross-tab-timing` passed **30/30**,
including the cleanup-failure loop regression, which observed 13,227 toast
replacements before the fix and passed the bounded-notification assertion after
it. The selected timer/backup/csTimer/Drive cases passed **6/6**; the external
bulk probes passed **2/2**. Firefox/WebKit, live Drive, physical-device and
assistive-technology checks were not run.

## Statistics metrics and content-aware split — 2026-11-06

The Statistics panel now shows Current and Best as primary values with optional
Target, BPA and WPA inline. Settings → Statistics adds independent Row metrics
controls (Current/Best on, Target/BPA/WPA off by default), stored as
`statMetricVisibility` in settings schema v11, field-merged, backed up and
cross-tab adopted. Average-row visibility is unchanged and separate. Editable
targets and expandable rows are gone; legacy `statTargetsMs` values are retained
as validated inert data for settings/backup/sync compatibility.

Target is the maximum recorded next result that makes the next rolling average
strictly faster than the session's historical Best. It uses the already-computed
PB, examines only the newest N−1 retained solves, and accounts for the candidate
being trimmed as fastest, retained, or trimmed as slowest. BPA uses a 0.00 next
result and WPA a DNF; both use the same trimming, +2/DNF and recorded-precision
path as Current/Best. The panel shows `—` without enough history or a PB, `N/A`
when no result can beat the PB, `∞` when every finite result qualifies, and a
numerical threshold otherwise. A PB tie is not a new best.

The desktop divider now measures intrinsic content from an isolated sample
including the header, padding, every enabled row and wrapped secondary metrics.
Its dynamic minimum is passed to the sidebar clamp, so dragging upward stops
when all rows reach their compact height. The saved percentage is never
rewritten by automatic clamping. If the viewport cannot fit the Statistics
minimum and the approximately 120 px Solves floor, Statistics scrolls internally;
rows remain mounted and the panels do not overlap. Keyboard Home/End and ARIA
minimum/maximum values use the effective constraints.

A spacing follow-up keeps each secondary metric label and value together as one
inline-flex group. The flex parent distributes only complete BPA/WPA/Target
groups, wraps them at narrow widths, and never inserts placeholder columns.
Statistic names use the stronger 0.875rem/600 desktop treatment and 0.8125rem
on narrow layouts without changing the divider architecture. Playwright geometry
asserts the actual label/value gaps, same-line placement, group containment,
order, and left/edge distribution for every metric combination, plus wrapped
long-value groups and the ao9999 custom-average label at desktop, narrow desktop,
390 px and 320 px. The wrapped layout remains included in the intrinsic divider
measurement.

Verification: TypeScript passed. Oxlint passed with the pre-existing
`SessionPanel` purity warning. Full Vitest **823 passed in 58 files**. Production
build and PWA generation passed. Focused Chromium coverage passed: statistics
**11/11**, resizable sidebar **9/9**, average trimming **3/3**, timer statistics
**1/1**, accessibility **3/3**, and responsive timer **5/5**. Large synthetic
correctness/profiling used 100,000 solves: six visible average sizes built in
about 295 ms, an ao10000 prediction in about 4–6 ms, and an appended-solve
rebuild in about 258 ms in the Vitest environment. Light/dark desktop, narrow
desktop, 390 px and 320 px layouts were inspected with all metrics enabled; no
horizontal overflow was observed. Firefox/WebKit, live Drive and
assistive-technology checks were not run for this change. No release version
changed.

### Timer workspace indicators removed — 2026-11-06

The decorative phase pill, dot, `Ready`/`Inspecting`/`Arming`/`Armed`/`Solving`
labels, and the top-right event/mode group (`3×3`, `Inspection on`, `Timing`,
`15s + 2s · WCA`) were removed from the timer workspace. No replacement label,
icon, tooltip, or layout spacer was added. The timer section keeps a stable
`Timer` region label and the readout stays centered. Phase background/border
transitions, the bottom arm meter, inspection thresholds, penalties,
keyboard/pointer input, event selection, and timing calculations are unchanged.
Unit coverage asserts every timer state renders no phase or workspace status
labels; Chromium checks assert absence during idle/holding/ready, unchanged
readiness feedback and colors, centered readout geometry, and no timer-stage
event text while the selected event still drives the session and timer.

Verification: TypeScript and Oxlint passed (pre-existing `SessionPanel` purity
warning only). Full Vitest **823 passed in 58 files**. Focused Chromium:
timer stability **8/8**, timer response **1/1**, responsive timer **5/5**, and
accessibility **3/3**. Production build and PWA generation passed. Firefox/
WebKit, live Drive and assistive-technology checks were not run for this change.
No release version changed.

## Timer stability, inspection, statistics and Analytics rail — 2026-11-05

The timer readout no longer reserves the Draw Scramble gutter, so floating tools
are layout-independent and the timer's coordinates stay fixed through open,
close, drag, resize, tool switching and multiple viewports. The visible timer
captions were removed while the phase pill, colors, arm meter and accessible
timer label retain state feedback. Inspection now uses the preserved
`inspectionStartedAt` through holding and armed states, so its display keeps
updating while Space is held; release still starts the solve and penalties are
still evaluated from the actual solve start.

The Statistics panel keeps its Sessions → Statistics → Solves position. Rows show
current and best values, expand independently, and reveal an editable per-event
target, BPA, WPA and target-aware next solve. BPA/WPA and next-solve calculations
reuse the shared recorded-time, trimming and DNF helpers. Targets persist in the
existing Settings v10 record through `statTargetsMs`, backups and field-by-field
sync; expanded-row state is local. Expanded rows scroll inside the resizable
statistics panel, preserving Solves usability. The Analytics rail now keeps its
heading outside the bounded tab scroller and prevents section switches from
focus-scrolling it.

Verification: TypeScript and Oxlint passed (the pre-existing `SessionPanel`
purity warning remains). Full Vitest **805 passed in 58 files**. Production build
and PWA generation passed. Chromium focused coverage: timer stability/inspection
**8/8**, expandable statistics **5/5**, Analytics rail layout **4/4**, existing
Analytics **13/13**, resizable sidebar **8/8**, average trimming **3/3**,
Draw Scramble **15/15**, accessibility **3/3** and responsive timer **5/5**.
`e2e/timer.spec.ts` passed **61/62**; its backup-dialog focus assertion fails in a
baseline copy with this work reverted as well, so it is pre-existing and was not
changed. Firefox/WebKit, live Drive and assistive-technology checks were not run
for this change. No release version changed.

## Settings debloat, Analytics order and release versioning — 2026-11-05

Analytics now orders filters **Event → Sessions → Date range → Last solves →
Penalty** with filtering logic and persisted values unchanged. Session Settings
removes its permanent name/uniqueness explanation and transfer preamble, states
inspection as `Global default · Off` or `Session override · On`, removes nested
surface containers, and keeps its Done action visible while the body scrolls on
short screens.

The main Settings dialog keeps only short functional descriptions visible.
Explanatory disclosure sections were removed after review; detailed inspection,
warning, summary, trimming and keyboard behavior remains documented in the
README. Statistics retain every visibility and custom-average control;
destructive Developer actions keep their typed-confirmation handoffs; and About
includes the release version. Light/dark, focus containment, keyboard activation
and narrow layouts remain intact.

`src/release.json` is now the single release record. `src/lib/version.ts` formats
the footer and About labels, while `scripts/release.mjs` updates patch, feature or
major releases using the current `America/Toronto` date. Dry runs and a guard
against uncommitted duplicate release edits are included. The current released
version remains `0.01.261104:1`; no release was declared by this implementation
work and ordinary builds do not change the record.

Verification: TypeScript passed; Oxlint passed with the pre-existing
`SessionPanel` purity warning. Full Vitest **759 passed in 55 files**, including
release-date boundary tests. Production build and PWA generation passed before
and after mock-Drive browser runs. Chromium Playwright: Analytics **13/13**,
focused Settings/session flows **8/8**, Session Settings transfer flows
**5/5**, average trimming **2/2**, and accessibility/axe **3/3**. Mobile checks
covered 320×568 and 390×844 light/dark layouts, the Settings controls, and
horizontal-overflow bounds. Visual inspection used synthetic/empty local data
only. No full browser matrix or release publication is claimed.

### Explanatory Settings disclosures removed — 2026-11-05

The explanatory Settings disclosures were removed after review: inspection
penalties, warning behavior, footer DNF/+2 summaries, average calculations and
keyboard shortcuts no longer expand inside Settings. Their component, test IDs,
chevrons, styles and exclusive helper code are gone. Short inline descriptions,
controls, validation, destructive warnings and Developer actions remain; detailed
rules stay in the README. Desktop and 320px mobile visual checks showed no empty
gaps, leftover disclosure styles or horizontal overflow. TypeScript and Oxlint
passed with the existing `SessionPanel` warning; focused Vitest **43/43** passed,
the production build/PWA passed, and focused Chromium accessibility, Settings and
trimming checks passed **9/9**. No release version changed.

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

## Previous application verification — 2026-11-04

Node v22.23.2. Previous checks on the working tree:

| Check | Result |
| --- | --- |
| TypeScript, Oxlint | Passed; one pre-existing `SessionPanel` purity warning remains |
| Full Vitest run | 743 passed in 54 files |
| Production build + PWA | Passed; normal non-mock output restored after browser runs |
| Focused Chromium merge/split/sync flows | 19/19 passed (`session-management`, `cross-tab-timing`) plus duplicate-name merge 1/1 in `timer` |
| Visual merge/split inspection | Passed in light/dark at 1440×900 and 390×844 with long names and a 420-solve session |
| Focused csTimer Chromium flows | 3/3 passed (unknown custom types; invalid/valid additive import; ranked names, empty sessions and omitted defaults) |
| Example fixture visual/axe check | Passed; 49 sessions, 8,591 solves and nine empty sessions represented |

### Merge and split sessions verification — 2026-11-04

The session transfer path was exercised with stale-device ownership, concurrent
offline additions, cancellation, failed session/sync writes, reload, native
backup export, cross-tab adoption and mock-Drive publication. Focused Chromium
coverage verified merging multiple sources into an active destination, preserving
solve IDs/fields and destination settings, splitting a custom-event range with
copied settings and a new ordered/active session, storage-failure rollback,
cross-tab transfer adoption, and a stale cloud source snapshot that must not
duplicate or reclaim moved solves. Unit coverage adds empty and 10,000-solve
sessions, duplicate names, incompatible events, equal timestamps, backups,
schema-v5 load compatibility, transfer normalization and sync merge behavior. No
Undo is offered for either operation.

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
logic, one-browser Playwright with `--workers=4` for major flows, and the full
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

## Performance optimization and 3D viewer lifecycle — 2026-11-05

Analytics now computes section-specific reports only when their analysis is selected,
while the overview keeps its own calculations. Shared valid/effective-time views and
rolling-series builders reduce repeated filtering/sorting, and the fastest/slowest
five solves use bounded selection. The 2D net is generated only for the visible
2D view and reused while its scramble and size are unchanged. Infrequently opened
dialogs are lazy-loaded and mounted only when open. The 3D Draw Scramble player is
kept connected to a persistent offscreen host across Timer/Analytics navigation,
tool switching, and event changes, avoiding cubing.js' shared-renderer path and
unbounded graphics-context allocation.

Verification: TypeScript and Oxlint passed (pre-existing `SessionPanel` warning
only). Vitest focused files passed: `src/lib/analytics.test.ts`,
`src/components/AnalyticsPage.test.tsx`, `src/components/ToolPanel.test.tsx`,
plus Data/Merge/Split dialog tests. Production build and PWA generation passed.
Chromium Playwright: `e2e/draw-scramble.spec.ts` 15/15 and
`e2e/analytics.spec.ts` 13/13. Firefox Chromium-equivalent color regression:
1/1. No live Drive validation was run.

Baseline/after measurements on isolated synthetic 10k-solve histories:
- Analytics open: 405.5 ms -> section-specific calculations are now deferred;
  distribution 151.5 ms, consistency 78.3 ms, advanced 91.9 ms, progression
  111.8 ms when selected.
- Stop to displayed result: 89.4–106.3 ms with a 158–315 ms long-task total;
  storage write 22.3–23.3 ms for 5.19 MB; sync fingerprint 55.7–63.6 ms.
- Main bundle: 578,390 -> 484,690 bytes raw (162,806 -> 141,120 bytes gzip).

## Immediate work

1. **Confirm floating-panel occlusion at edge sizes.** Auto-avoid now moves a
   saved or released panel clear of the timer display; pure and browser tests
   cover normal desktop and compact layouts. Manually inspect 320/390 px and
   short landscape cases where the stage may be too small to find a clear side.
2. **Profile large-history performance.** Use the 7,000–10,000-solve matrix
   below, with sync on/off and charts open/closed. Include the Analytics page and
   separate first-result response from chart completion and durability before
   optimizing. Establish whether any expensive analytics pass needs worker
   offload or incremental caching.
3. **Optimize the measured bottlenecks in hashing, statistics and charts.**
   Enabled-sync hash caching must preserve exact pending/in-flight detection;
   chart/statistics/analytics caches must invalidate after edits, deletion/Undo,
   imports, session changes and trimming changes.
4. **Design incremental storage separately.** The reviewable design is
   [docs/development/INCREMENTAL_STORAGE_DESIGN.md](docs/development/INCREMENTAL_STORAGE_DESIGN.md);
   implementation still requires separate approval. Preserve migration, recovery,
   failure and cross-tab safety, and do not debounce saves to improve a benchmark.
5. **Complete external validation within its authorization.** Live Drive requires
   explicit test authorization and a short-lived credential. OAuth publishing
   needs the Google Cloud owner. The full three-engine browser matrix, physical
   mobile/trackpad and assistive-technology checks remain open. Recheck the dated
   build-tool advisory before choosing a compatible dependency change; preserve
   offline behavior.

## Profiling matrix

Use isolated synthetic histories and memory/mock Drive; never real solve history.

| Dimension | Cases |
| --- | --- |
| History | 7,000 and 10,000 solves, including field metadata |
| Runtime | Development (`localhost:5173`) and production preview (`127.0.0.1:4173`) |
| Browser | Zen Browser when available; record exact browser/version for comparisons |
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
