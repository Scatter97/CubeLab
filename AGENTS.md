# CubeLab contributor instructions

## Start here

1. Read [STATUS.md](STATUS.md) for the latest verified state and immediate work.
2. Read the relevant behavior in [README.md](README.md), then its source and tests.
3. Load the matching project skill below. Read [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)
   when changing data handling, performance, platform support or related claims.

Current code and tests establish implementation; dated verification establishes
what was exercised. [ROADMAP.md](ROADMAP.md) lists the retained layout, performance,
storage-design and external-validation follow-ups. Future feature-phase proposals
have been removed. Existing user authorization persists; follow the current request. `docs/archive/` holds historical records, not current instructions.

## Project and ownership

CubeLab is a React 19 / TypeScript / Vite browser application using `cubing.js`,
custom CSS, Vitest and Playwright. Use **Node 22+** as required by `package.json`.
It has no application backend or telemetry. Data stays in browser storage unless
the user exports a file or explicitly connects Google Drive.

The implemented product includes 12 built-in events plus user-defined custom events,
inspection, named sessions, solve comments/actions, configurable trimmed statistics,
Time Trend/PB details, the lazy Analytics dashboard, floating scramble/chart tools,
native JSON backup, additive csTimer import, optional Drive sync, light/dark/system
themes and an offline-capable PWA. Sessions use schema **v6**; settings use **v11**. Storage-key
suffixes remain `v1`; do not confuse key names with payload schema versions.

| Area | Owner |
| --- | --- |
| Application wiring, single-tab ownership, startup, input and modals | `src/App.tsx`, `src/components/SingleTabGate.tsx`, `src/bootstrap.tsx`, `src/main.tsx` |
| Timer transitions and inspection penalties | `src/timer/machine.ts`, `src/hooks/useTimer.ts` |
| Live readout and delayed insight presentation | `src/hooks/useRunningElapsed.ts`, `src/hooks/usePostPaintValue.ts` |
| Sessions, merge/split transfers, ordering, summaries, settings and storage validation | `src/lib/sessions.ts`, `src/lib/sessionTransfers.ts`, `src/hooks/useSessions.ts`, `src/hooks/useSettings.ts`, `src/lib/storage.ts`, `src/lib/dates.ts` |
| Custom events, csTimer event mapping and reassignment | `src/lib/events.ts`, `src/lib/customEvents.ts`, `src/components/CustomEventsDialog.tsx` |
| Backup and csTimer parsing | `src/lib/backup.ts`, `src/lib/csTimerImport.ts` |
| Sync orchestration, replacement recovery and pure merges | `src/hooks/useSync.ts`, `src/hooks/useDriveBackup.ts`, `src/lib/sync.ts`, `src/lib/replacement.ts`, `src/lib/startupRecovery.ts`, `src/lib/pendingCompletion.ts` |
| Display release version and release commands | `src/release.json`, `src/lib/version.ts`, `scripts/release.mjs` |
| Statistics, trimming, session summaries and trend data | `src/lib/stats.ts`, `src/lib/averageTrimming.ts`, `src/lib/timeTrend.ts`, `src/lib/sessions.ts` |
| Analytics dashboard, filters and reporting | `src/lib/analytics.ts`, `src/lib/analyticsSettings.ts`, `src/components/AnalyticsPage.tsx`, `src/components/AnalyticsCharts.tsx` |
| Events, official scrambles and visualizations | `src/lib/events.ts`, `src/lib/scramble.ts`, `src/components/ToolPanel.tsx` |
| Theme tokens/bootstrap and PWA/worker build | `src/index.css`, `index.html`, `vite.config.ts` |

Keep calculations/transitions in pure modules, side effects in hooks, and input
adaptation/rendering in components. The architecture skill gives the fuller map.

## Shared project rules

- **Preserve user history.** Never clear or overwrite real solve/session data to
  develop, debug, profile or validate. Use synthetic fixtures, isolated browser
  contexts and memory/mock Drive transports. Preserve unrelated working changes.
  Do not add dependencies without approval.
- **One solve, one record.** Use monotonic `performance.now()` timestamps and the
  timer's authoritative ref. Capture the input time before audio/focus work.
  Display animation or rounding must never determine saved duration.
- **Only presentation may wait.** The final result, persistence, sync refs,
  deletion metadata and scheduling receive current data. Keep the session-ID
  guard on delayed insights. Do not debounce saves or weaken sync guards to
  improve responsiveness; track deletions even while sync is disabled.
- **Preserve single-tab ownership.** Acquire the dedicated `cubelab-active-tab` Web Lock before startup recovery or application hooks mount. Waiting tabs must not edit, autosave, recover or sync. Never steal ownership on focus or a heartbeat timeout. Keep this lifetime lock separate from the short-lived Drive/replacement lock. Production has no bypass; explicit legacy-client simulations retain lower-level protocol coverage.
- **Respect input boundaries.** Reserve global Space for timing outside text
  entry; preserve Enter/arrow access to focused controls, repeat suppression,
  optional any-key stop, modal locks and tool pointer isolation. Settings/session
  controls stay locked while armed, inspecting or running; cross-tab/cloud
  adoption must not redirect an in-flight solve.
- **Keep raw results intact.** Store raw milliseconds plus a separate penalty.
  Reuse shared effective-time, recorded-result precision and trimming helpers
  across cards, charts and historical PB windows. mo3 is untrimmed. Inspection
  is penalty-free through 15,000 ms, +2 through 17,000 ms, then DNF; warnings
  occur at 8/12 seconds elapsed, with direction-aware labels.
- **Maintain persistence compatibility.** Validate before mutation. Editable startup must use the checked session snapshot; never autosave a fallback after a failed read. Preserve unreadable bytes and use the recovery gate. Native session/solve dates must fit JavaScript Date before import/restore. Schema changes
  need migrations and tests; older settings migrate with documented defaults.
  Native backup imports replace only after confirmation; csTimer imports add
  sessions and preserve existing settings. Invalid supported csTimer rows fail
  before preview/confirmation. Retain the 10 MB import cap unless separately
  authorized and tested.
- **Keep sync conservative.** Preserve immutable device snapshots, all-snapshot
  validation, shared write locking, timer-active/in-flight guards, exact reviewed
  value/timestamp approvals and durable deletion/Undo provenance. Selection
  metadata must follow the chosen ID through envelope parsing and cloud adoption.
  Never describe the protocol as atomic or guaranteed against all data loss.
  Use the sync skill for the detailed contracts and regression workflow.
- **Use the event registry.** `src/lib/events.ts` owns event IDs and scramble/3D
  mappings; use official `cubing.js` scrambles. N×N puzzles use scramble-derived
  2D nets and the standard palette in `src/lib/cubeColors.ts`; non-cube puzzles
  show the honest 2D-unavailable state and their correct 3D puzzle. Preserve PG3D,
  panel interception and end-of-gesture layout persistence.
- **Preserve established UI behavior.** Global preferences live in Settings;
  per-session override/clear/delete live in the session gear. Keep typed destructive
  confirmations and explicit import preview/confirmation. Keep focus containment
  and restoration, tokenized themes and the pre-paint theme bootstrap.
- **Protect production workers/offline use.** Retain cubing worker chunk isolation
  and `modulePreload: false` in `vite.config.ts`. Build/PWA changes require
  production offline verification; a dev-server check cannot establish it.

## Skills

Load the relevant workflow from `.opencode/skills/` when its task applies:

| Skill | Activate for |
| --- | --- |
| `cubelab-architecture` | Ownership questions, cross-layer features and refactors |
| `cubelab-sync-safety` | Sync, storage migration, import/restore, recovery, cleanup and reconciliation |
| `cubelab-timer-testing` | Timing/input behavior, exact-once recording and stop-response regressions |
| `cubelab-chart-performance` | Statistics, Time Trend, PB details and large-history profiling |

Combine skills when boundaries overlap. The installed `vercel-react-best-practices`,
`web-design-guidelines` and `frontend-design` skills in `.agents/skills/` cover
shared frontend guidance; do not duplicate their manuals here. Playwright
conventions are in `playwright.config.ts` and `e2e/`; no separate Playwright skill
is tracked in this repository.

## Verification

Commands are run from the repository root with existing dependencies. Initialize
the existing Node 22.23.2 runtime for this checkout first. Playwright runs use
**four workers** by default in agent commands; this user preference supersedes
older one-worker examples in dated documents. Keep separate suites sequential:

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
npm run dev              # Vite development server
npm run typecheck        # TypeScript
npm run lint             # Oxlint
npm test -- <test-file>  # focused Vitest coverage; npm test runs all
npm run build            # production build and PWA
npm run test:e2e -- <spec-file> --project=chromium --workers=4
```

Use a tiered workflow so routine work does not saturate the CPU:

| Change | Required verification |
| --- | --- |
| Documentation, copy, or minor CSS/visual-only UI | Inspect the affected view manually. Run a focused Vitest/Playwright case only when the change can affect behavior. |
| Logic, storage, statistics, import, sync, or another non-visual behavior | `npm run typecheck`, `npm run lint`, and the affected Vitest files. Add the owning regression before editing. |
| Major cross-layer feature or refactor | Focused Vitest plus the Playwright specs covering the affected flow, normally Chromium and `--workers=4`. Add other engines only when the change is engine-sensitive. |
| Significant release or explicitly requested full browser pass | `PLAYWRIGHT_WORKERS=4 VITE_DRIVE_MOCK=true npm run check` once, after the focused checks pass. |

Do not run the entire Playwright suite after every change. Reserve the full
suite for significant releases, broad refactors, or an explicit request. During
normal development, target the relevant specs in one browser with `--workers=4`; never
run multiple browsers or test suites concurrently. Do not rerun a passing test
unless relevant code or configuration changed.

Never omit the focused tests required for destructive paths: saves, solve/session
deletion and Undo, native import/replacement, csTimer import, backup restore,
storage migration, or Google Drive merge/conflict/restore behavior. Run the
affected unit and browser cases even when a full suite is otherwise unnecessary.

After a focused browser run, `npm run build` restores normal production output if
the run used mock Drive. Playwright uses Chromium, Firefox and WebKit on
`127.0.0.1:4173`. Its server command builds with mock Drive; a reused preview
skips that command, so build with `VITE_DRIVE_MOCK=true` first when reusing a
server. Keep existing skips visible.

Documentation-only edits need link/path/command checks, skill validation when
changed, and `git diff --check`; a full application rebuild is unnecessary.
`npm run validate:drive` creates/deletes remote test files and is **not** routine
verification: use it only with explicit live-test authorization and a supplied
short-lived `drive.appdata` credential. Never print/commit credentials or add
that harness to ordinary checks/CI.

Always report exactly which commands/tests ran, which were intentionally skipped,
and why.

## Documentation and delivery

- `README.md`: product behavior, setup, controls and architecture.
- `STATUS.md`: current implementation checkpoint, latest dated verification,
  immediate tasks and profiling matrix. Record new results here once.
- `KNOWN_LIMITATIONS.md`: current risks, boundaries and unverified areas.
- `ROADMAP.md`: retained follow-ups and delivery expectations.
- `AGENTS.md`: shared rules; skills: specialized workflows and source/test maps.

Update the documents affected by a change; avoid copying status/test counts into
every file. Consult archived records only for historical decisions or evidence.
Do not keep new per-session handoff files or append repetitive milestone logs.
Do not commit dependencies, build/browser output, scratch files or secrets.
Before delivery, inspect the diff/status and state what changed, what passed,
what was not tested, remaining limits and whether changes were committed/pushed.
