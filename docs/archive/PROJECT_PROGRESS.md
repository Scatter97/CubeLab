> **Historical snapshot — archived 2026-11-01.** This record may contain
> superseded behavior, approval milestones and verification results. For current
> work read [STATUS.md](../../STATUS.md), [AGENTS.md](../../AGENTS.md) and
> [KNOWN_LIMITATIONS.md](../../KNOWN_LIMITATIONS.md). Paths in code spans
> and command blocks retain their original repository-root context.

# CubeLab — Project Progress

**Documentation updated:** 2026-11-01. **Implementation last verified:** 2026-11-01.
**Current checkpoint:** Core product, Phases 2A–4, Stage 6 theme polish, Phase 5
audit remediation, and Phase 6a (Pyraminx, Skewb, Square-1, Clock, and Megaminx)
are implemented. Approved follow-ups include csTimer import, 2D/PG3D tools,
Time Trend and trackpad navigation, historical PB dialogs, configurable
trimming and the first large-session stop-response patch.
Settings are schema v8; sessions are schema v4. Future feature-phase proposals
were subsequently removed at the user's request; use the current root roadmap
for the retained work queue.

## Current implementation and verification

1. Timer-safe sync, exact approvals, restore normalization, cross-tab reconciliation,
   active-session metadata and cleanup retries are implemented. The November 1
   regression follow-up fixes selection approvals/provenance through pure merges,
   envelope parsing, hook adoption and production conflict review.
2. csTimer imports reject malformed supported rows before preview/confirmation,
   then add valid sessions without replacing history or settings. Scramble tools
   are scramble-derived, pointer-isolated and persist their final position/size.
3. Time Trend supports compact/expanded views, independent axes, pinch/pan,
   date/range views, DNF gaps, extrema preservation and accessible PB details.
4. Trimming is global and shared by cards, charts, custom averages, PB windows,
   backups and synchronization. Defaults are 5% / Auto; stored raw solves stay
   unchanged. Legacy settings migrate to v8.
5. Stopping captures time before focus/audio work. The live readout animates
   locally; expensive presentation refreshes after a rendering opportunity.
   Saving, final readout and sync continue using current, non-deferred data.
   Disabled sync skips unused UI hashing; enabled safety checks remain exact.
6. Phase 6a extends the shared event registry to Pyraminx, Skewb, Square-1,
   Clock, and Megaminx with official `cubing.js` scramble IDs, event-aware
   scramble validation, csTimer `scrType` mapping, correct 3D puzzles, and an
   honest 2D-unavailable state for non-cube puzzles. Storage, backup, csTimer
   import, and sync validate the new events; existing records stay compatible.

Latest `VITE_DRIVE_MOCK=true npm run check`: **passed as one command, exit 0**
on November 1 after the regression fixes. Typecheck/lint/build passed;
**553 unit/component tests in 39 files** and **258 browser tests passed /
9 existing skips / 267 total**
across Chromium, Firefox and WebKit, including per-event coverage for all 12
events at desktop and 390 px mobile widths. The 7,000-solve keyboard/pointer
regression passed in all engines. Offline coverage passed in the supported
Chromium project. The normal non-mock production build was restored. Historical
results below remain dated records and do not replace this baseline.

With 7,000 synthetic solves and Time Trend open, Firefox median stopped-DOM
response improved **382 → 75 ms** in development and **75 → 22 ms** in production
(eight measured stops per condition, warm-up discarded, sync/audio off). These
are not physical-display, Zen or enabled-sync timing guarantees. Full details
and remaining costs appear in the timer-stop section at the end of this file.
Live Drive was not rerun; its last recorded provider harness passed 7/7 on
2026-10-28. No new external OAuth-state verification is implied.

## Current next steps

1. Fix the observed 320-pixel compact-panel/readout overlap while retaining
   pointer isolation and persisted drag/resize behavior; inspect desktop,
   mobile and landscape and refresh affected screenshots.
2. Profile Zen and production at 7,000/10,000 solves with sync on/off, both stop
   inputs and expanded/custom charts. Distinguish dispatch, captured duration,
   first rendering, chart completion, storage and long tasks.
3. Optimize remaining enabled-sync hashing and chart/statistics work only from
   measurements; preserve exact guards and complete invalidation after edits.
4. Design incremental durable persistence separately before replacing whole-
   collection writes. Include migration, recovery, failure and cross-tab tests.
5. Arrange owner-dependent OAuth, explicitly authorized live Drive and physical
   device/assistive-technology validation. Recheck dated dependency advisories
   before choosing a compatible build-tool change.

[NEXT_SESSION_HANDOFF.md](NEXT_SESSION_HANDOFF.md) provides execution steps and
acceptance checks. [ROADMAP.md](ROADMAP.md) distinguishes delivered slices from
proposed phases. [PATCH_LIMITATIONS.md](PATCH_LIMITATIONS.md) records current
limits. [README.md](../../README.md) documents use, storage and commands; [AGENTS.md](../../AGENTS.md)
contains invariants. The October 28 plan is historical; the October 30 checklist
has been consolidated into a closure record. The Phase 6a commit records its own
implementation and verification; inspect Git rather than assuming a clean tree
or push.

## Documentation-to-code audit — 2026-11-01

Compared current product claims, contributor guidance, roadmap/limitations,
handoff, dated closure records and project skills with source and regression
coverage. Historical test/provider/performance records remain dated claims;
they are not substitutes for a current run or tracked raw measurement artifacts.

The audit originally reproduced two active-session gaps with synthetic pure-merge
inputs (subsequently fixed in the follow-up below):

- A reviewed `activeSessionId` choice in `resolvedConflicts` is ignored: selecting
  this device still returns the newer cloud choice and another pending conflict.
- Equal-time selection values use an editor-ID tiebreak, but the returned field
  metadata always favors the local stamp. Swapping input orientation preserves
  the selected ID while changing its editor provenance.

A third reproduction shows incomplete csTimer numeric validation: a valid
JSON numeric literal `1e400` is accepted as an infinite raw duration, but the
imported row disappears after JSON storage/reload validation. Existing valid rows
survived in the fixture. The subsequent follow-up rejects malformed supported rows
and validates provided dates before preview/confirmation.

These were implementation gaps outside the then-existing suite's passing
active-session/cross-tab scenarios. They are now covered and repaired by the
follow-up below. The audit itself
corrects stale tab/import/schema/warning/precision claims and narrows offline,
layout, accessibility and external-validation statements. Application behavior
is unchanged; inline comments are reconciled where they contradicted code.

Fresh audit verification on November 1, using Node v22.23.2 and source baseline
`2df7f2c`: `VITE_DRIVE_MOCK=true npm run check` passed as one command, exit 0.
Typecheck, lint and production build passed; **518 unit/component tests in 39
files** and **252 browser tests with 9 existing skips** passed across Chromium,
Firefox and WebKit (browser run: 9.0 minutes). The isolated reproductions above
exercise gaps outside those existing tests; no assertions or skips were changed.
No live Drive, OAuth console, physical-device, actual screen-reader or new
performance-profile validation was performed. Documentation/comment changes do
not change emitted application behavior.
A normal non-mock `npm run build` passed after the mock suite, restoring
production output. Relative documentation links and skill discovery were checked
separately; full findings are recorded in the audit deliverable.

## Audit regression follow-up — 2026-11-01

User-authorized fixes address all three reproduced gaps without changing schemas
or rewriting existing solve history:

- Reviewed `activeSessionId` choices match exact value/timestamp pairs in either
  orientation. Applied approval/Undo stamps are handled narrowly; a later edit
  raises new review. Equal-time ties use editor ID then value, and the selected
  value carries the same winning metadata. Legacy metadata-free selection and
  invalid-ID fallback remain conservative.
- The sync-envelope parser now retains validated selection provenance, which it
  previously checked but dropped. Sync adoption preserves that provenance instead
  of stamping a cloud selection as a fresh local edit. Tests cover both reviewed
  choices, subsequent publication and redundant-upload skipping.
- Preview/import share csTimer row/date validation. Malformed supported rows,
  missing/negative/nonfinite times, empty scrambles and invalid provided dates
  reject the whole file before confirmation with a session/solve error. Valid
  zero/fractional times, penalties/comments, missing-date fallback and unknown-
  puzzle skipping remain covered. Imported sessions are still additive; existing
  solves/settings remain unchanged through cancel, confirm and reload.
- Added **35 unit/hook cases** across `src/lib/sync.test.ts`,
  `src/lib/csTimerImport.test.ts` and `src/hooks/useSync.test.ts`, plus two new
  browser scenarios in `e2e/timer.spec.ts` (six engine cases). The initial run
  exposed 25 failing test cases against the prior implementation; focused
  regressions pass after the fixes.
- Fresh `VITE_DRIVE_MOCK=true npm run check`: exit 0, typecheck/lint/build passed,
  **553 tests in 39 files**, **258 browser passes / 9 existing skips /
  267 total** across Chromium/Firefox/WebKit. A normal non-mock production build
  passed afterward. No dependencies, real user storage, live Drive or physical
  devices were used. Earlier audit/provider/performance figures remain dated.

## Scope delivered

CubeLab is a flat, csTimer-inspired, offline-first speedcubing timer for twelve
WCA events built with React, TypeScript, Vite, `cubing.js`, and custom
responsive CSS. It ships audited light and dark palettes plus a system-following
theme.
Phase 2A adds named local sessions and validated JSON backup/restore without
changing the timer or statistics rules. Phase 2A.1 adds a centralized Settings
dialog without adding a new persisted preference or changing timing behavior.
Phase 2A.2 adds typed alert, appearance, and statistics preferences plus a
Controls reference. Phase 2A.3 adds configurable inspection direction and
warnings, expanded built-in and custom statistics, per-session settings, typed
destructive confirmations, persisted solve comments, and a floating solve action
menu. None of those display preferences changes raw times, penalties, or WCA
calculations.

### Product

- Flat light/dark interface organized like a familiar speedcubing timer: a
  session switcher, session statistics, and solve history in the left rail;
  scramble across the timer area; and an oversized central clock with quick
  ao5/ao12 values beneath it.
- Monotonic timer using `performance.now()`, launched by a configurable hold
  (300 ms default) and stopped by a single press or tap.
- Global <kbd>Space</kbd> control with OS key-repeat suppression and page-scroll
  prevention. Focused buttons and switches remain keyboard-operable with Enter.
- Pointer controls on the timer surface for mouse, pen, and touch input.
- Official WCA scrambles for 3×3, 2×2, 4×4, 3×3 OH, 5×5, 6×6, 7×7, Pyraminx,
  Skewb, Square-1, Clock, and Megaminx generated by `cubing.js`, with a
  prefetched next scramble and explicit loading, failure, and retry states.
  Non-cube puzzles use their official `cubing.js` event IDs.
- Optional WCA inspection with 15-second / 17-second boundaries and automatic
  `+2` or DNF penalty at solve start. The display can count down or count up,
  with independent warnings at **8 and 12 seconds elapsed**: count-down labels
  announce 7 and 3 seconds remaining; count-up labels announce 8 and 12 seconds.
- Optional visual, sound, haptic, or combined feedback for completed solves and
  DNFs, with adjustable alert volume (70% default). The DNF/danger tone uses a
  1.5× gain capped at 0.75, so it is louder than solve feedback without changing
  the volume control.
- Light, dark, and system theme preferences with a pre-paint bootstrap, plus
  four accent colors in both palettes. The predefined text/surface and accent pairs
  are checked against WCAG AA thresholds by `src/lib/theme.test.ts`; this is not
  exhaustive rendered-page or physical assistive-technology certification.
- csTimer-inspired Settings dialog with Timer, Alerts, Display, Appearance,
  Statistics, Scramble, Controls, Data, and About sections. It centralizes
  inspection direction and warnings, feedback, theme, accent, statistic
  visibility, custom averages, precision, scramble presentation, keyboard
  reference, local-storage status, and backup/restore access.
- Floating solve action menu opened by clicking a history row or pressing
  <kbd>Enter</kbd> on it. It supports add/remove `+2`, mark/clear DNF, delete
  with undo, copy scramble/time/solve text, and add/edit a persisted comment.
- Per-session settings gear with an inspection override, clear session, and
  delete session. Clear and delete require typing `CLEAR THIS SESSION` or
  `DELETE THIS SESSION`.
- Best and latest single, mo3, ao5, ao12, ao25, ao100, ao200, ao500, ao1000,
  ao5000, and ao10000, plus up to five custom trimmed averages from ao3 to
  ao10000. Cards can be hidden and displayed at hundredths or tenths precision
  without changing the underlying centisecond calculations.
- Named local sessions with create, switch, rename, per-session settings, and
  confirmed delete. Each session owns independent solves, statistics, history,
  and an optional inspection override.
- The header no longer shows a green "Saved locally" indicator; storage problems
  still surface as an explicit error.
- Versioned JSON backup/restore covering every session, solve, active session,
  and setting, reached through **Settings → Data → Backup & restore**. Import
  validates the file and requires explicit confirmation before replacing local
  data.
- Automatic migration from the original single-session storage key into
  **Session 1**.
- Versioned local persistence for sessions and settings, with corruption
  recovery.
- Installable PWA with local timing and scramble generation offline after the
  service worker and production assets finish caching. Drive still needs network;
  the service-worker regression is Chromium-only in this harness.
- No CubeLab backend, account, analytics, or telemetry. Optional Google Drive
  synchronization stores a device-owned versioned snapshot in the user's own
  Drive app-data folder (`cubelab-backup-<device-id>-<uuid>.json`), merges every
  CubeLab snapshot on each run, and starts only after an explicit connection.
  The legacy `cubelab-backup.json` file remains readable and is removed by
  **Delete remote backups**.

### Engineering

- Pure timer state machine separated from the React adapter.
- Input events are timestamped; the machine owns all timing transitions.
- The timer hook keeps an authoritative state ref to guard against duplicate
  recording across repeated or same-frame events, with focused regression coverage.
- Pure session/name/comment/inspection mutation logic in `src/lib/sessions.ts`,
  backed by focused unit tests.
- Built-in statistic definitions and custom-average validation live in
  `src/lib/statDefinitions.ts`. `src/lib/stats.ts` calculates any validated
  average size; a Fenwick-tree sliding-window pass keeps ao1000–ao10000
  responsive without sorting every window.
- Pure backup creation/validation in `src/lib/backup.ts`, with file-size limits
  and record-by-record recovery.
- Pure synchronization merge modules: `src/lib/sync.ts` merges solves,
  tombstones, redirects, and sessions; `src/lib/sessionMetadata.ts` merges
  session fields; `src/lib/settingsMerge.ts` merges global fields and first-sync
  provenance; `src/lib/remoteBackups.ts` reads, merges, and deletes device-owned
  snapshots. Hook orchestration and network I/O stay in `useSync.ts` and
  `useDriveBackup.ts`.
- Sessions schema `v4` stores optional per-field metadata without rewriting raw
  solve values. Settings are schema `v8`; v8 adds average trimming after v7 added the `theme` preference and
  the v6 any-key-stop record. Settings field metadata lives in the sync runtime
  rather than the settings record.
- Shared native modal lifecycle and Tab/Shift+Tab focus containment in
  `useModalDialog`, used by the Settings, confirmation, and backup dialogs.
- Settings opens only while the timer is idle, blocks timing while open, and
  returns focus to the header Settings button on close. The header no longer
  contains a separate inspection switch.
- Strict TypeScript, Oxlint, Vitest, and Playwright.
- Unit, session, storage, backup, statistics, formatting, and real
  scramble-generation coverage.
- Production browser tests, including a cold offline reload with service-worker
  interception.
- Flat visual system with solid colors only: no decorative gradients, glows, or
  ambient background effects. Desktop and 320–1920 px layouts are checked.
- Phase 1 added a modal focus trap, 28 px minimum touch targets, visible
  inspection labeling at narrow widths, coherent scramble-failure/disabled
  states, WCAG AA secondary-text contrast, and a bounded desktop history rail.
- Phase 2A added a compact session panel, inline validated naming, locked session
  controls during timing, migration tests, and confirmed replace-only import.
- Phase 2A.1 moved inspection and backup entry points into the Settings dialog,
  added a responsive grouped-sections layout, and covered focus restoration and
  narrow-width touch targets in production E2E tests.
- Phase 2A.2 introduced settings schema v4 with v1–v3 migration and typed
  defaults. Implemented controls cover timer-update mode, custom Space-hold
  timing, interface zoom, small-decimal display, scramble alignment/height
  limit/click action, visual/sound/haptic solve and DNF feedback with adjustable
  alert volume, inspection warnings at 8 or 12 seconds, accent color,
  statistic-card visibility, and tenths/hundredths display precision.
  Interface zoom scales the app shell with `zoom` plus viewport-relative
  dimensions instead of leaving blank layout space,
  dialogs compensate for the scale, history effective-time labels wrap instead
  of ellipsizing, and the scramble click action is keyboard-activatable with
  Enter. Web Audio is primed during a user gesture so inspection warnings remain
  reliable, and visual alert overlays use the accent/danger/warning tokens.
- Phase 2A.3 upgrades settings to schema v5 and sessions to schema v2. It adds
  count-down/count-up inspection, independent warning toggles, expanded built-in
  averages, up to five custom averages, per-session inspection overrides,
  typed destructive confirmations, persisted solve comments, and the floating
  solve menu. The History panel no longer contains a clear-session action; penalty
  and DNF controls are available inline on each solve row while the floating menu
  retains the remaining actions. A later refinement increases the settings schema
  to v6 for an optional any-key stop toggle, makes header Settings an icon-only
  gear, makes the whole scramble body clickable for copy/advance, removes the
  separate scramble copy button, and replaces Settings checkboxes with custom
  toggle controls.

## Verification evidence

Run on 2026-10-29 after Stage 6 polish. Node v22.23.2:

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | Passed |
| Lint | `npm run lint` | Passed with no warnings |
| Unit tests | `npm test` | **360/360 passed**, 24 test files |
| Production build | `npm run build` | Passed; 99 modules transformed |
| PWA generation | included in build | 22 precache entries, **2,322.06 KiB** |
| Production E2E | `npm run test:e2e` | **149/153 passed**, 4 skipped; Chromium, Firefox, and WebKit |
| Combined chain | `npm run check` | **Passed as one command**, exit 0 |
| Real-provider harness | `npm run validate:drive` (opt-in, real account) | **7/7 passed** in the final Stage 3 run; not part of `npm run check` |
| Whitespace | `git diff --check` | Passed with no errors |
| Layout coverage | production E2E at 320, 390, and desktop widths | Every event at desktop and 390 px mobile records, penalizes, and reloads solves; 320 px Settings/session/solve-menu targets, Drive copy, remote snapshot ownership/cleanup, review history/Undo, Repair, paginated conflicts, session dialogs, duplicate-name review, and focus handling remain covered. Light/dark/system theme, pre-paint bootstrap, and dark-theme axe scans are covered in all three engines. |

Run at 2026-10-25 18:40 (local), after the v4 audit follow-up (Drive
pagination, same-device write coordination, and duplicate-name review) —
historical baseline superseded by the 2026-10-28 run above:

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | Passed |
| Lint | `npm run lint` | Passed with no warnings |
| Unit tests | `npm test` | **254/254 passed**, 20 test files |
| Production build | `npm run build` | Passed; 95 modules transformed |
| PWA generation | included in build | 22 precache entries, **2,279.75 KiB** |
| Production E2E | `npm run test:e2e` | **25/25 passed**, Chromium |
| Whitespace | `git diff --check` | Passed with no errors |
| Layout coverage | production E2E at 320, 390, and desktop widths | Drive copy, conflict labels, session dialogs, duplicate-name review, and focus handling verified automatically; no manual visual audit or screenshot refresh was performed |
| Performance | seeded 2,000-solve production session | Not re-measured; the Phase 2A profile below remains the latest. Large-average calculation still has a Fenwick-tree fast path and brute-force comparison coverage. |

The Playwright suite runs against the production preview and covers:

1. Keyboard hold/start/stop, exactly one recorded solve, and scramble advancement.
2. Solve-menu `+2`, comment save, clipboard scramble copy, delete/undo, and typed
   clear confirmation.
3. Settings dialog focus containment and focus restoration to the header button.
4. Count-down and count-up inspection, independent 8-second/12-second warnings,
   alert text, and persistence of direction/warning preferences.
5. Custom Space-hold timing changing the arm threshold and persisting.
6. Interface zoom filling the viewport at 70% and 150% without horizontal
   overflow, with the Settings footer remaining usable.
7. Small-decimal rendering, scramble alignment/height, keyboard activation of
   the scramble click action, and Space remaining reserved for the timer.
8. Effective `+2` history labels remaining fully visible instead of clipping.
9. Visual solve feedback, alert volume, inspection direction/warnings, accent
   application, the Controls reference, and persistence across reload.
10. DNF feedback using the danger visual alert after an inspection overrun.
11. Expanded built-in statistics, a custom ao7, tenths precision, persistence,
    and the all-hidden empty state without changing stored values.
12. Mobile layout plus pointer hold-to-time behavior.
13. The 320 px Settings, session-settings, and floating solve-menu layouts,
    including 28 px touch targets and viewport containment.
14. A long desktop session scrolling inside the history rail, including automatic
    migration from the legacy single-session key.
15. Named-session create/switch/rename/delete with typed `DELETE THIS SESSION`
    confirmation, an inline duplicate-name error with icon and `aria-invalid`,
    fresh form state on every open, and persistence of the active session.
16. Per-session inspection overrides, inheritance for new sessions, global-default
    isolation, and persistence across reload.
17. Session controls and Settings locking while the timer is active.
18. Backup export through Settings → Data, invalid-file handling, import
    cancellation with focus restoration, and confirmed restoration of sessions,
    comments, and settings.
19. Scramble failure disabling timing and offering a retry.
20. Full offline reload with service-worker precache and offline `cubing.js`
    scramble generation.
21. Google Drive backup/restore through the mock transport, including connection,
    per-device synchronization, and restore confirmation.
22. Invalid Google Drive backup rejection without local mutation.
23. Manual conflict review pausing publication, resuming after the user chooses
    the local solve-field version, recording that choice in review history,
    applying the cloud version after **Undo**, and **Repair sync state** clearing
    only derived bookkeeping while preserving history.
24. Delete-all remote backup confirmation and removal of every CubeLab snapshot.
25. Remote snapshot management: per-device ownership groups, sizes and dates,
    selective deletion with its own confirmation, own-only **Clean up now**, the
    cleanup count confirmation, and retention-policy persistence.
26. Duplicate session names from separate snapshots: the actionable toast and the
    persistent Drive-dialog review action open the merge dialog, and the duplicate
    notice clears after the typed merge.
27. Per-event coverage for 3×3, 2×2, 4×4, 3×3 OH, 5×5, 6×6, and 7×7 at desktop
    and 390 px mobile widths: switch the session event, generate three fresh
    scrambles, record solves, apply `+2` then DNF, verify best-single and mo3
    stats, confirm no horizontal overflow, and reload to verify the event,
    scrambles, and penalty persisted.
28. Multi-event backup export/import: a 3×3 session and a 5×5 session export with
    their events intact and restore through confirmed import.

Session-name, session-preference, global-settings, and redirect conflict review
is covered by deterministic unit and hook tests rather than a separate production
E2E scenario.

Visual artifacts are checked in at `docs/cubelab-desktop.png`,
`docs/cubelab-mobile.png`, and `docs/cubelab-settings.png`.

### Sync hardening patch — 2026-10-25

This patch addresses the concrete regressions found during the post-Phase-2C
stress pass. It is deliberately **not** a complete data-loss-proof sync design;
the unresolved items are listed in [`PATCH_LIMITATIONS.md`](PATCH_LIMITATIONS.md).

**Fixed**

1. **TypeScript build error.** Removed the unused `total` variable in
   `src/hooks/useSync.ts`; the replacement count is now computed from solve IDs.
2. **Legacy migration scope.** `cubelab:solves:v1` is a pre-multi-event record
   that only ever held 3×3 solves. `loadSolves` now migrates only `event: '333'`
   records into the legacy **Session 1** path, while `cubelab:sessions:v1` still
   preserves every event. Regression tests cover both directions.
3. **Empty-default cloud adoption.** Adoption now requires at least one live
   remote solve or customized session metadata. A remote session containing only
   tombstoned solves no longer replaces a local placeholder. An untouched default
   is accepted when `isAutoCreatedDefault` is missing, but an explicit `false`,
   a non-3×3 event, preferences, an inspection override, solves, or modified
   timestamps always block adoption.
4. **Cloud merge ownership.** When the same solve ID appears under different
   session owners, the merge now prefers an owner whose event matches the solve's
   event and refuses to move a solve into an incompatible session. Adopted cloud
   session IDs and solves are retained, and repeated merges remain idempotent.
5. **Upload/local-edit race.** The hook snapshots the local sessions and settings
   before the merge, re-checks after the download and again before upload, and
   schedules a follow-up sync instead of publishing an adopted snapshot when a
   local edit lands during a request. This protects local solves from being
   silently replaced; it does not add server-side atomicity.
6. **Pending conflicts block publication.** If manual conflict review produces a
   `manual-pending` resolution, the sync pauses before upload, preserves both
   sides, records the conflict, and reports that neither local nor cloud data was
   replaced.
7. **Directional counts.** Imported and uploaded solve counts are derived from
   local, remote, and merged ID sets, so "new local solves uploaded" and "cloud
   solves imported" no longer share a misleading total.
8. **Duplicate-name validation.** Shared validation and the session-settings
   dialog now report `Session name already exists. Please choose a different
   name.` The create and settings dialogs render the same inline red message,
   alert icon, and `aria-invalid` field state. The Playwright assertion was
   updated to the current message.
9. **React lint warnings.** `SessionSetupDialog` and `SessionSettingsDialog` now
   use an always-mounted native `<dialog>` shell with keyed, conditionally
   mounted content, so each opening starts with fresh local state without
   resetting state inside an effect. `useSync` uses a render-commit-timed
   `useLayoutEffect` to keep its latest props available to in-flight guards.
   `npm run lint` is clean without rule suppression.

**Changed files**

`src/lib/sync.ts`, `src/hooks/useSync.ts`, `src/lib/storage.ts`,
`src/components/SessionSetupDialog.tsx`,
`src/components/SessionSettingsDialog.tsx`, `src/components/DriveBackupDialog.tsx`,
`src/components/Icons.tsx`, `src/lib/sessions.ts`, `src/App.tsx`, `src/index.css`,
`e2e/timer.spec.ts`, and the focused unit tests in `src/lib/sync.test.ts`,
`src/lib/storage.test.ts`, `src/lib/backup.test.ts`,
`src/lib/sessions.test.ts`, `src/hooks/useSync.test.ts`, and
`src/lib/sessionRedirects.test.ts`.

**Verification**

The v2 snapshot passed the full chain on 2026-10-25 with 171/171 unit tests at
that time; the current verification table records 217/217 after the v3 additions.
Concurrency, conflict-resolution, repeated-recovery, and adoption coverage uses
the deterministic in-memory Drive transport; no real Google Drive data was
modified.

**Remaining sync limitations**

- At that point the Drive transport had no verified atomic compare-and-swap, so
  two devices could overwrite a remote backup in a write race. Stage 1 later
  replaced per-device file overwrites with immutable snapshots and added a
  conditional update for the legacy mutable file.
- Manual conflict review blocks publication. The audit follow-up adds solve-field
  approve-and-resume, but session, preference, redirect, and global-settings
  conflicts still have no queue.
- Sync-on-exit, pre-deletion offline edits under clock skew, field-level session
  preference conflicts, concurrent redirect approvals, and global settings
  provenance still need design and tests. The audit follow-up recovers solves
  created after a tombstone.
- Real multi-device behavior has not been revalidated after this patch.

**Superseded by v3:** device-owned snapshots eliminate cross-device file
overwrites; field-level session/settings merging, conflict review for every
metadata kind, timer deferral, bounded retries, and settings provenance are now
implemented and tested. A provider-level CAS for one device file remains open.

### Audit follow-up — 2026-10-25

A static audit of the uploaded archive identified additional synchronization
gaps. This follow-up addresses the findings that can be fixed safely without a
verified remote concurrency protocol:

1. **Manual conflict resolution workflow.** Pending solve-field conflicts now
   render in the Drive dialog with **Use this device** and **Use cloud** actions.
   The chosen resolution is persisted, applied by the next merge, stamped newer
   than both reviewed versions (including clock-skewed remote timestamps), and
   synchronization resumes automatically once no conflicts remain. A new
   conflict is raised if either side changes after the approval.
2. **Deletion versus offline edits.** Solves created after a session tombstone
   are copied into a deterministic, clearly named `(recovered)` session. This is
   idempotent, preserves the puzzle event and session preferences, and does not
   duplicate solves that already exist in a live session.
3. **Honest pending semantics.** `pendingCount` is now
   `newSolvesSinceLastSync`, matching its actual meaning. Session renames,
   penalty edits, deletions, and preference changes are not presented as counted
   pending operations.
4. **Status message clarity.** Manual completion now reports that no new solves
   were exchanged rather than implying every metadata edit was synchronized.
5. **Redirect determinism.** Tests now cover shuffled approval input and
   divergent approvals for the same source. This is deterministic normalization,
   not a consensus protocol.
6. **User-visible concurrency warning.** The Drive dialog stated that Google
   Drive had no verified atomic compare-and-swap at the time, so simultaneous
   uploads could overwrite another device. Stage 1 later added a conditional
   update for the legacy mutable file without providing cross-file atomicity.

**At the time, still unresolved:** atomic remote CAS, session/preference/redirect
conflict queues, pre-deletion offline edits under clock skew for legacy
tombstones, per-preference timestamps, redirect consensus/recovery, guaranteed
sync-on-exit, and detection of in-place state mutation. The v3 hardening
resolved the conflict queues, per-field timestamps, cross-device upload isolation,
bounded retry/status behavior, and settings provenance; legacy tombstones,
redirect consensus, exit durability, and provider CAS remained open at that
point. Stage 1 later added legacy-tombstone review, hardened exit sync, and a
conditional write for the legacy mutable file, while redirect consensus and
cross-file atomicity remain unresolved. See
[`PATCH_LIMITATIONS.md`](PATCH_LIMITATIONS.md).

### Audit follow-up v2 — 2026-10-25

A second static audit identified a repeated-recovery bug and a stale-approval
path. Both are reproducible in the current source and are fixed:

1. **Successive recovered-session arrivals.** Recovery now finds an existing
   `recovered:<sessionId>` session and merges eligible orphan solves into it by
   stable solve ID. A second or third offline device no longer loses its solves
   because the recovered session already exists. Existing recovered-session
   preferences and inspection overrides are preserved, and event mismatches stop
   synchronization instead of mixing statistics.
2. **Stale conflict approval.** An approval is now matched against the exact
   local/remote field values and modification timestamps shown for review, not
   merely against a newer timestamp. A third edit made between prompt display
   and approval raises a fresh pending conflict; it cannot be silently decided by
   the abandoned choice.
3. **Clock-skew-safe new tombstones.** Session deletion now records the solve IDs
   known to the deleting device. For tombstones created by this version, an
   unknown solve from an offline device is recovered regardless of wall-clock
   comparison. Legacy tombstones retain the time-based fallback.

Regression coverage includes two sequential offline devices, reversed device
roles, repeated synchronization, multiple solves in different arrival orders,
known-snapshot clock skew, event incompatibility, preserved preferences, and a
third edit between conflict review and approval.

**Resolved by v3:** session/preference/redirect/global-settings conflict review,
per-preference timestamps, field-level settings provenance, and cross-device
upload isolation. **Still unresolved at that point:** provider-level CAS for a
single device file, redirect consensus/recovery, guaranteed sync-on-exit,
ambiguous legacy-tombstone edits under clock skew, conflict-resolution
audit/undo, and detection of in-place state mutation. Stage 1 later addressed
the legacy-file conditional write, exit hardening, legacy-tombstone review, and
audit/undo; redirect consensus and in-place mutation detection remain open. See
[`PATCH_LIMITATIONS.md`](PATCH_LIMITATIONS.md).

### Hardening v3 — device-owned snapshots and field-level review — 2026-10-25

This pass removes the cross-device Drive overwrite race and completes the
field-level merge/review work that earlier passes had scoped but not implemented.

**Architecture**

1. **Device-owned snapshots.** Every sync writes only
   `cubelab-backup-<sanitized-device-id>.json`. Each run lists, validates, and
   merges every CubeLab snapshot, including the legacy `cubelab-backup.json`.
   Different devices can upload concurrently without replacing each other; the
   next run reconciles their snapshots. (The 2026-10-27 remediation replaced this
   mutable per-device name with unique immutable
   `cubelab-backup-<device-id>-<uuid>.json` snapshots; the historical text below
   records the v3 state.)
2. **Sessions schema v4.** Session name, event, inspection override, and each
   session preference carry optional per-field modification metadata. Existing
   `v1`–`v3` records still load, and malformed metadata is dropped without losing
   the session. Equal legacy fields do not receive fabricated persisted stamps.
3. **Settings provenance without a schema change.** Global field timestamps live
   in the sync runtime (`settingsFieldUpdates`). First-sync merging preserves a
   customized device's settings and establishes a baseline; later edits win by
   field timestamp with a deterministic editor-ID tiebreak.
4. **Full conflict review.** Manual review now covers solve fields, session
   name/event/inspection/preferences, global settings, and redirect destinations.
   Approvals match the exact reviewed values and timestamps. Redirect approvals
   match by source/destination pair, avoiding approval churn after application.
5. **Scheduling and status.** An active timer defers synchronization and resumes
   it once on idle. Automatic retries are bounded and reset only by external
   triggers. Startup resumes an interrupted `syncing` state, exit triggers are
   best effort, and status distinguishes pending local changes and conflicts.
   Redundant uploads are skipped when the confirmed remote and local fingerprints
   are unchanged.

**Bugs fixed**

- Manual backup could select and replace another device's file through
  `remoteFileId`; per-device transports now replace only the current device's
  file.
- Remote delete reported success even when a transport deletion failed.
- Remove counts counted the same tombstoned solve once per snapshot.
- Session event changes did not merge by field, and settings had no per-field
  provenance beyond whole-record first-sync behavior.
- Redirect resolution could re-prompt for the same destination pair after
  applying an approval.
- A first merge with equal legacy session values fabricated field metadata and
  immediately dirtied an otherwise unchanged sync.
- Timer-active sync could replace data or start network work mid-solve;
  retries could continue unbounded.

**Coverage added**

- `sessionMetadata.test.ts`, `settingsMerge.test.ts`, and
  `remoteBackups.test.ts`.
- Hook tests for settings and session-name conflicts, redundant-upload skipping,
  timer deferral, bounded retry exhaustion, exit-page sync, and in-flight edits.
- `sync.stress.test.ts` exercises concurrent device uploads and a three-device
  convergence scenario with simultaneous solves, a solve deletion racing a
  penalty edit, session-name edits, and independent global-settings edits.
- Storage tests for v4 field metadata round-trip and malformed-entry recovery.
- Drive backup tests for per-device isolation, multi-snapshot restore, delete-all,
  and partial-deletion failure reporting.

**Verification:** `npm run typecheck`, `npm run lint`, **217/217 unit tests** in 18
files, production build, **24/24 Playwright tests**, and `git diff --check` all
passed. No real Google Drive multi-device test was run; provider CAS remains
unavailable. See [`PATCH_LIMITATIONS.md`](PATCH_LIMITATIONS.md).

**Primary changed files:** `src/hooks/useSync.ts`,
`src/hooks/useDriveBackup.ts`, `src/lib/sync.ts`,
`src/lib/sessionMetadata.ts`, `src/lib/settingsMerge.ts`,
`src/lib/remoteBackups.ts`, `src/lib/driveTransport.ts`,
`src/lib/sessions.ts`, `src/lib/storage.ts`, `src/lib/syncStorage.ts`,
`src/types.ts`, `src/components/DriveBackupDialog.tsx`, and the associated unit,
hook, stress, and Playwright tests.

### Audit follow-up v4 — pagination, same-device writes, duplicate review — 2026-10-25

A fourth audit identified three concrete gaps. All three are fixed, with the
remote-write limitation documented rather than overstated.

1. **Google Drive pagination.** The file list requested only `files(...)` in
   `fields`, so `nextPageToken` was absent and only the first page was ever read.
   `fetchDriveBackupFiles` now requests `nextPageToken,incompleteSearch`, follows
   every page, rejects malformed or repeated tokens, and aborts on
   `incompleteSearch` or any failed page instead of returning a partial list that
   could miss another device's snapshot. Delete-all and restore therefore see
   every snapshot.
2. **Same-device snapshot races.** Automatic sync and manual backup now run their
   pre-write recheck and upload under a shared Web Lock
   (`cubelab-drive-write`). Inside the lock they re-list this device's snapshot
   and abort if its ID, name, or modification time changed since discovery. The
   sync records a pending/retry status; manual backup surfaces an explicit
   retry message. This removes the avoidable same-origin tab race. Google Drive
   had no verified compare-and-swap at that point, so a copied profile sharing
   the device ID could still race between the recheck and the request; the
   2026-10-27 remediation removed per-device overwrites and Stage 1 added a
   conditional update for the legacy mutable file.
3. **Duplicate-session notification loss.** Duplicate names were judged per
   snapshot, so a later snapshot without its own collision could erase the
   warning; the duplicate toast was also followed by a plain status toast that
   replaced the **Review Merge** action. Duplicates are now recomputed against
   the final merged collection (including adopted sessions), the actionable toast
   carries the full summary in one message, unchanged duplicates are suppressed
   on later syncs, and the Drive dialog keeps a persistent review action.

**Additional fixes found while testing**

- Recovered solves are no longer counted as removed solves in merge counts.
- Imported-solve notifications name the session that received the cloud solves.
- The memory Drive transport advances `modifiedTime` monotonically so two writes
  in one millisecond are distinguishable by the optimistic check.

**Coverage added:** `driveTransport.test.ts` (pagination, malformed/repeated
tokens, incomplete search, network failure, delete-all), `driveCoordination.test.ts`
(lock serialization/release/fallback and own-snapshot comparison), duplicate and
recovery-count cases in `sync.test.ts`, duplicate-toast/imported-session/stale-writer/reset-base cases in
`useSync.test.ts`, a manual-backup stale-writer case in
`useDriveBackup.test.ts`, and the production duplicate-review merge flow in
`e2e/timer.spec.ts`.

**Verification:** `npm run typecheck`, `npm run lint`, **254/254 unit tests** in 20
files, production build, **25/25 Playwright tests**, and `git diff --check` all
passed. No real Google Drive multi-device test was run; provider CAS remains
unavailable. See [`PATCH_LIMITATIONS.md`](PATCH_LIMITATIONS.md).

**Primary changed files:** `src/lib/driveTransport.ts`,
`src/lib/driveCoordination.ts`, `src/lib/sync.ts`, `src/hooks/useSync.ts`,
`src/hooks/useDriveBackup.ts`, `src/App.tsx`,
`src/components/DriveBackupDialog.tsx`, `src/index.css`, and the associated unit,
hook, and Playwright tests.

### 2026-10-27 synchronization remediation — immutable snapshots and review fixes

A post-Phase-2C review found that the mutable per-device snapshot name still
allowed writers sharing a device identity to replace one another's file, that the
conflict queue silently truncated correctness state, and that disagreements
between two remote snapshots could be hidden when this device's value already
matched the automatic winner. All three are fixed.

1. **Immutable unique snapshots.** Each write now creates a fresh file named
   `cubelab-backup-<device-id>-<uuid>.json` and never overwrites by ID or name.
   `uploadDeviceBackup` no longer accepts an `existingFileId`. Two writers that
   share a device ID, including copied browser profiles, therefore cannot destroy
   each other's unique solves; every snapshot remains discoverable and is merged
   by the next run. Discovery, restore, and delete-all continue to cover every
   snapshot, legacy per-device names, and `cubelab-backup.json`. Snapshot growth
   was unbounded at this point; Stage 2 later added the retention policy described
   below.
2. **Optimistic recheck narrowed to the legacy transport.** Per-device writes are
   immutable and need no pre-write re-list. The Web Lock still serializes
   same-origin automatic and manual writes, and the changed-file recheck remains
   only for the legacy fixed-name `cubelab-backup.json` transport, which is still
   mutable.
3. **Uncapped, deduplicated conflict queue.** `mergeConflictRecords` no longer
   slices to the last 100 records, and the final publish persists the complete
   queue. Records are deduplicated by `kind:id:field`, so stored growth is bounded
   by the number of distinct fields that ever diverged rather than by sync runs.
   The Drive dialog renders 5 conflicts at a time with a **Show all** action;
   pagination never decides which conflicts block publication.
4. **Remote-snapshot disagreement review.** Settings aggregation now folds remote
   snapshots with manual review enabled and the local conflict set, so a
   disagreement between two remote devices is raised even when the local value
   already matches the automatic winner. These records carry `remoteOnly` and the
   UI labels them **Use newest cloud** / **Use other cloud**. Redirects with no
   local approval surface pairwise remote disagreements through
   `findRemoteRedirectDisagreements`; same-destination superseded history does not
   manufacture a conflict.
5. **Order-independent redirect approvals.** Redirect approvals are matched by
   their unordered destination pair and anchored to the reviewed values, so
   repeated merges are idempotent and a later distinct destination raises a fresh
   conflict.
6. **Own-snapshot identity.** `isOwnSnapshot` identifies this device's files by
   the envelope `deviceId`, with the legacy fixed filename as fallback for
   pre-envelope snapshots. `findOwnSnapshots` returns every file this device owns,
   and manual restore/delete metadata no longer adopts another device's file.
7. **Deferred-sync cancellation.** A `cancelledRef` guards the zero-delay
   follow-up syncs scheduled after a merge or conflict resolution, so unmounting
   cannot start a stale run.
8. **Honest caveat.** When a device already holds an approval for one side of a
   multi-remote disagreement, the normalizer's newest-approval rule can hide an
   older independent cloud approval until that device's newer approval is absent.

**Verification:** the 2026-10-27 baseline was typecheck, lint, **287/287 unit
tests** in 21 files, production build (95 modules; PWA 22 entries, 2,286.77 KiB),
**29/29 Playwright tests**, and `git diff --check`, all passing. Stage 0 re-ran
the whole chain as a single `npm run check` on 2026-10-28 and it passed. No real
Google Drive multi-device test was run, and provider CAS was unavailable at that
point; Stage 1 later added a conditional update for the legacy mutable file only.
See [`PATCH_LIMITATIONS.md`](PATCH_LIMITATIONS.md).

### 2026-10-28 Stage 1 synchronization hardening

Stage 1 of `Oct_28_AM_Plan.md` targeted the remaining highest-value sync gaps.

1. **Legacy mutable-file conditional write.** Google Drive v3 lists files but
   does not expose ETags. The transport enriches the legacy
   `cubelab-backup.json` entry with Drive v2 metadata and replaces it with a v2
   media `PUT` carrying `If-Match`. A pre-write ETag mismatch and an HTTP 412 map
   to `DrivePreconditionError`; automatic sync treats that as `remote-changed`
   and re-merges, while manual backup reports a retryable conflict. A missing
   ETag fails closed. Immutable per-device snapshots remain create-only and need
   no precondition. This is a conditional update for one file, not a transaction
   across snapshots.
2. **Conflict-resolution audit and Undo.** `ConflictAuditEntry` is stored in
   `cubelab:sync:v1`, newest first and capped at 50 entries. It is local-only and
   is never placed in sync envelopes, remote snapshots, or JSON backups. The
   Drive dialog pages history five at a time and offers **Undo** while the stored
   conflict still carries the exact recorded resolution and `updatedAt`.
   Superseded decisions, applied redirect merges, and a legacy recovery that
   already restored solves are refused; a **Keep deleted** legacy decision can
   still be changed to **Recover solves**. Approvals now
   match the reviewed pair in either local/remote orientation, fixing a
   re-prompt when a second snapshot presented the pair reversed.
3. **Exit-sync hardening.** `beforeunload` was removed. Visibility loss,
   `pagehide`, and `freeze` requests are deduplicated over a 2-second window.
   Local storage remains the durability boundary, and startup still resumes a
   persisted `syncing` state. Exit sync remains best effort.
4. **Legacy-tombstone recovery review.** Ambiguous orphan solves behind a
   pre-`knownSolveIds` session tombstone raise a mandatory
   `session`/`legacyRecovery` conflict even when manual review is off. **Keep
   deleted** drops only the ambiguous candidates; **Recover solves** restores
   them. The approval records the exact candidate IDs, so a later arrival raises
   a fresh conflict. Clearly newer solves still use the wall-clock fallback.
5. **Redirect disagreement review.** A local approval no longer hides a
   disagreement between two cloud destinations: when the local approval matches
   the automatic winner, the losing cloud destination is still surfaced as
   `remoteOnly`. Redirect handling remains deterministic, not consensus-based.
6. **Repair sync state.** A non-destructive advanced action clears only
   `lastSyncedFingerprint`, `lastRemoteRevision`, status, and error, then re-reads
   every snapshot when automatic synchronization is enabled. Sessions, tombstones,
   redirects, pending conflicts, audit history, and settings metadata are kept.
7. **Recovery documentation.** README and `PATCH_LIMITATIONS.md` now describe the
   repair/undo path and its limits, including local-only history, best-effort
   exit sync, and the absence of cross-file atomicity.

**Verification:** `npm run check` passed as one command on 2026-10-28:
typecheck, lint, **308/308 unit tests** in 21 files, production build (95
modules; PWA 22 entries, 2,296.43 KiB), and **29/29 Playwright tests**; `git
diff --check` was clean. Playwright extends the manual conflict scenario through
review history, Undo, and Repair. The Drive dialog was inspected at desktop and
320 px with seeded review history (no horizontal overflow); the seeded rows were
removed after inspection.

**Gate status:** this was partially unmet when Stage 1 closed because no real
Google Drive account was available. Stage 3 later ran the real-provider
multi-device, conditional-write, and retention scenarios successfully on
2026-10-28. See [`PATCH_LIMITATIONS.md`](PATCH_LIMITATIONS.md).

### Performance evidence

A production session seeded with 2,000 solves was measured in Chromium at
1440×1000 and 390×844 after Phase 2A. Phase 2A.1–2A.3 did not change the timer or
history rendering path, so this profile was not re-measured. Phase 2A.3 adds a
Fenwick-tree fast path for large averages; unit tests compare it with a
brute-force window search:

- Desktop: ~1.35 s to queue-ready with all rows present, 28,206 DOM nodes,
  ~20.5 MB JS heap, 86,006 px of history content in a 456 px scroll viewport,
  and a 1,001 px page height. Penalty toggle ~282 ms. Programmatic scrolling
  produced no long tasks.
- Mobile: ~1.23 s to queue-ready, a 333 px history viewport, no horizontal
  overflow, and a 1,305 px page height. Penalty toggle ~233 ms. Programmatic
  scrolling produced no long tasks.

The added session panel reduces the desktop history viewport from the Phase 1
measurement (about 561 px) to about 456 px while preserving the bounded,
internally scrolling rail. These are fresh-context measurements including
service-worker startup, so they are not directly comparable to the earlier
warm-load Phase 1 figures. Offscreen history rows use `content-visibility: auto`,
and rows are memoized. The remaining interaction cost is dominated by reconciling
and persisting all 2,000 solves; virtualization is the next step if sessions grow
substantially beyond this size.

### Production bundle

- Main application bundle: ~426.07 kB (~122.13 kB gzip)
- CSS: ~49.31 kB (~11.98 kB gzip)
- Cubing.js chunk: ~1,207.02 kB (~335.13 kB gzip)
- Precache total: ~2.26 MiB (2,311.53 KiB)
- PWA: generated Workbox service worker and web manifest

The 2026-10-25 through 2026-10-28 hardening, conflict-review, and multi-event
work adds field-level merge helpers, recovery logic, validation UI, dialog
content, the event registry, and per-event presentation; the main bundle is
about 426 KiB before gzip. Vite reports the expected informational warning about
the large cubing.js chunk. It is a single cached dependency chunk, not duplicated
application code.

## Key decisions and invariants

### Interface and visual system

- The post-Milestone-1 redesign follows csTimer's familiar information hierarchy:
  session rail on the left, scramble above the clock, timer as the dominant
  element, and quick ao5/ao12 values directly beneath it.
- Phase 2A adds a compact session panel at the top of the rail with a native
  session select and new/rename actions. Phase 2A.3 replaces the inline delete
  button with a session-settings gear; clear and delete now live in that dialog.
  Phase 2A.1 moves the Backup entry point into **Settings → Data** so the session
  panel stays focused on sessions.
- The header has one Settings button instead of an inspection switch. Its small
  secondary label and accessible name expose the current inspection state; the
  desktop header context also reads “Inspection on/off”. The green “Saved
  locally” indicator was removed; only storage failures remain visible.
- The Settings dialog follows csTimer's grouped-options approach with Timer,
  Alerts, Display, Appearance, Statistics, Scramble, Controls, Data, and About
  sections. It uses the shared native modal, a fixed footer, and an
  independently scrolling body on short screens.
- The v8 settings schema stores presentation, interaction and average-trimming preferences as
  typed fields with documented defaults. Unknown or corrupt values fall back
  field-by-field, while v1–v7 records upgrade automatically. Sessions use schema
  v4 with optional per-session preferences, inspection overrides, solve comments,
  and field-level merge metadata. Global settings field timestamps live in
  `cubelab:sync:v1`, so field provenance adds no settings-record fields.
- Interface zoom uses CSS `zoom` with a reciprocal viewport width/height and a
  scale-adjusted dialog cap. This keeps the app filling the viewport at reduced
  zoom without introducing blank scroll space or horizontal overflow.
- Effective-time annotations in history wrap onto a second metadata line when
  the rail is narrow; they must never be ellipsized or clipped.
- Timer interaction and display settings do not rewrite raw solve duration or
  inspection penalties. The separate global trimming preferences deliberately
  recalculate training averages through the shared statistics helpers.
- Solve/DNF feedback is opt-in and uses the configured channel. Inspection
  warnings, when enabled, always pulse visually and announce a direction-aware
  live-region label (7/3 seconds remaining when counting down, 8/12 seconds
  elapsed when counting up). No warning-text overlay is rendered; sound and haptic
  still follow the selected channel. Web Audio is
  primed on timer press so a timer-driven warning is not blocked by autoplay
  policy. The DNF/danger tone applies a 1.5× gain capped at 0.75; solve and
  warning tones keep the normal volume gain. Statistics precision changes only
  formatting, never the stored raw time or calculated result.
- History rows are buttons with `aria-haspopup="menu"` and `aria-expanded`. The
  floating menu is rendered in a portal, positioned near the row and clamped to
  the viewport. It supports keyboard focus, Escape dismissal, and outside-click
  dismissal. Inline +2 and DNF buttons remain on each row; delete stays in the floating menu.
- Solve comments are plain text, limited to 500 characters, and stored on the
  solve record. They never affect timing or statistics.
- The palette has flat light and dark variants with a pale or deep accent-tinted
  timer surface. The accent can be green, blue, violet, or amber in both themes;
  every text/surface and accent pair meets WCAG AA contrast. Penalties use amber
  and red, with theme-specific warning and danger tokens.
- Decorative gradients, glows, grid/ambient backgrounds, and oversized rounded
  cards were removed. The interface uses 3 px panel radii, 1 px borders, and
  solid fills.
- UI text uses the system sans-serif stack; timer and scramble text use the
  bundled JetBrains Mono variable font. Space Grotesk was removed.
- On screens up to 900 px the timer moves first and the session controls,
  statistics, and history stack below it. Touch action buttons remain at least
  28 px.
- The desktop history rail is bounded to the viewport and scrolls internally
  instead of stretching the page. The shell max-width is 1920 px.
- At 320 px the Settings dialog keeps the inspection label and switch touch
  target visible; the switch is not collapsed to an unlabeled control. The
  dialog body scrolls independently so the Done button remains reachable.

### Sessions and backup

- The active session is persisted by ID. Session order is creation order; new
  sessions are appended and become active.
- Names are trimmed, whitespace-collapsed, limited to 40 characters, and unique
  case-insensitively. The next default name is the smallest unused `Session N`.
- Deleting a session is confirmed with the typed phrase `DELETE THIS SESSION`
  and always leaves one session. Deleting the active session selects its
  neighbor. Clearing a session requires `CLEAR THIS SESSION` and removes only its
  solves.
- Each session can override the global inspection default. Sessions without an
  override follow the global value; new sessions inherit the active session's
  effective value. The global default is unchanged by per-session overrides.
- Session controls, the session-settings gear, and the header Settings button are
  disabled while the timer is armed, running, or in inspection.
- Export includes every session, every solve, the active session ID, and all
  settings. The backup is a detached snapshot.
- Native CubeLab backup import replaces sessions and settings only after
  validation and current/incoming-count confirmation. csTimer import instead
  previews and adds supported sessions while retaining existing sessions and
  settings. Cancelling either flow leaves local data untouched. Drive uses its
  separate ID/field merge path.
- The backup file format is versioned (`cubelab-backup`, version 1) and capped at
  10 MB. Invalid JSON, wrong markers, unsupported versions, empty sessions, and
  invalid settings are rejected before confirmation.

### Timer and inspection

- Hold threshold: 300 ms by default; configurable from 0–10,000 ms in Settings.
- Inspection penalty thresholds: `> 15,000 ms` gives `+2`;
  `> 17,000 ms` gives DNF. The penalty is captured when the solve starts.
- Inspection counts down from 15 by default or counts up from 0; the readout
  changes to +2 strictly after 15 seconds and DNF strictly after 17 seconds. The 8-second and 12-second warnings are independent; count-up warns at
  8 and 12 seconds elapsed, while count-down now warns at 7 and 3 seconds
  remaining, matching the same elapsed points. The count-down warning can pulse
  the timer surface or entire screen based on **Settings → Alerts → Inspection
  warning display**, and the visual warning no longer shows overlapping text.
- Inspection must be started with one press, then armed/started with a second
  hold.
- Losing window focus cancels an incomplete hold, but never stops an actively
  running solve.
- Escape cancels inspection or an armed hold. It does not cancel a running solve.

### Statistics

- Solves are stored newest-first.
- A single uses the effective time; `+2` adds 2 seconds; DNF is not a valid record.
- mo3 has no trimming and becomes DNF if any of its three solves is DNF.
- Built-in averages cover ao5, ao12, ao25, ao100, ao200, ao500, ao1000,
  ao5000, and ao10000. Up to five custom trimmed averages are allowed from ao3
  to ao10000; built-in sizes are excluded from the custom list.
- Trim counts follow the global better/worse policy (default 5% / Auto,
  percentages rounded up). Even medians retain two middle results. DNFs occupy
  worst-side trim slots first; only remaining DNFs make the result DNF. Default
  ao5/ao12 drop one at each end, while ao1000 drops 50 at each end.
- Best values scan every valid window and never report a DNF as a personal best.
  Large averages use a Fenwick-tree sliding-window pass rather than sorting each
  window.
- Aggregate results below ten minutes are rounded to the nearest hundredth
  (10 ms); results at or above ten minutes are rounded to whole seconds.

### Persistence

Keys:

- `cubelab:sessions:v1` — active session ID plus every named session, solves,
  comments, preferences, and optional field metadata.
- `cubelab:settings:v1` — local preferences.
- `cubelab:solves:v1` — original single-session key, read only for migration into
  **Session 1**; only `event: '333'` records are migrated because that key
  predates multi-event sessions.
- `cubelab:drive:v1` — optional Google Drive connection metadata; OAuth tokens
  stay in memory.
- `cubelab:sync:v1` — optional sync preferences and runtime state (device ID,
  tombstones, redirects, conflicts, settings field timestamps, and the last
  published fingerprint).

Each session stores `id`, `name`, optional `event`, `preferences`, and
`inspectionEnabled`, `createdAt`, `updatedAt`, `solves`, and optional
`fieldUpdates` for the name, event, inspection override, and individual
preference fields. Each solve stores `id`, `event`, `rawMs`, `penalty`,
`scramble`, `comment`, `createdAt`, and optional per-field merge metadata. Raw
time is always preserved; penalties are applied for display and statistics.
Record-by-record validation skips corrupt sessions, solves, and metadata,
duplicate IDs are ignored, and invalid JSON or unsupported schema versions fall
back to the legacy record and then to a fresh empty session. The active session
is normalized to an existing session. A valid session collection is never
silently discarded. Sessions are stored at schema version 4; versions 1–3 load
with defaults for newer fields. Missing field metadata falls back only at merge
time, not as fabricated persisted history. The legacy `cubelab:solves:v1`
migration is restricted to 3×3 records, while the modern session key keeps every
supported event.

Settings are stored at schema version 8. Loading accepts versions 1–8, upgrades
older records with defaults, and validates each field independently. v8 adds
independent better/worse trimming with p5/auto defaults. A
record without `inspectionEnabled` is rejected as invalid, matching the original
settings contract. The v7 records add the light/dark/system theme preference
with a `light` default; v6 added the optional any-key stop preference. Global
settings field timestamps are stored in `cubelab:sync:v1` so the settings schema
stays backward compatible.

Backups are versioned separately as `cubelab-backup` version 1. They are
validated before the confirmation dialog; import replaces local data only after
explicit confirmation. The sync envelope carries tombstone, redirect, conflict,
and settings-field metadata.

### Production worker workaround

`cubing.js` instantiates its search worker from a chunk URL rather than through
Vite's worker pipeline. In the Vite 8 / Rolldown production build, the worker was
initially importing the React browser entry and failing with:

```text
ReferenceError: document is not defined
```

The fix in `vite.config.ts`:

1. Groups cubing modules into a dedicated `cubing` chunk, excluding the worker
   entry and its `inside` payload.
2. Disables module preloading, which otherwise injects a browser-only
   dependency-preload helper into the worker.

The worker graph now contains only worker-safe modules. This is verified by the
offline Playwright test and must not be undone casually.

### Input and accessibility

- Space is reserved globally for timer control. Text-entry targets are the only
  exception. This avoids focus-dependent timing failures after clicking a
  control, including when the session select is focused.
- Focused buttons, switches, and the session select remain keyboard-operable with
  Enter and arrow keys.
- Timer state changes, solve recording, and inspection warnings are announced
  through a live region.
- Visual solve/DNF/inspection feedback uses a non-interactive timer overlay, and
  the selected accent colors meet WCAG AA contrast.
- Controls have visible focus styles, accessible names, and disabled states.
- The Settings, session-settings, confirmation, and backup dialogs trap
  Tab/Shift+Tab focus, close on Escape or backdrop click, and return focus to
  their trigger. The Settings trigger is the header Settings button; the session
  dialog trigger is the session gear.
- The header Settings button and session gear are disabled while the timer is
  armed, running, or in inspection. Opening a dialog blocks timer input.
- The inline session-name editor focuses and selects its input, reports
  validation with `role="alert"`, and returns focus to the session select.
- The solve menu is keyboard-openable with Enter, focuses its first action, and
  closes on Escape. Space remains reserved for the timer, including while a solve
  row or menu action has focus. The comment editor is a text-entry target, so
  Space is available for typing there.
- Destructive clear/delete confirmations autofocus the typed-confirmation input
  and keep the destructive button disabled until the exact phrase is entered.
- Touch targets are at least 28 px; the narrow layout, session controls, and
  Settings dialog inspection control were checked at 320, 360, 390, 768, 1024,
  1440, and 1920 px across the Phase 1, Phase 2A, and Phase 2A.1 passes.
- Key secondary text was darkened to meet WCAG AA contrast (at least 4.5:1 on
  its actual background).

## Known limitations

- Sessions support 3×3, 2×2, 4×4, 3×3 OH, 5×5, 6×6, 7×7, Pyraminx, Skewb,
  Square-1, Clock, and Megaminx and generate scrambles through `cubing.js`.
  The 15-second inspection, `+2`, DNF, and effective-time rules are shared by
  every event; competition-specific time limits and cutoffs are deliberately not
  implemented because they are set per competition. Dedicated desktop/mobile
  production E2E coverage exists for all 12 events, including the 3D puzzle and
  honest 2D fallback for non-cube puzzles.
- The theme preference is local and synchronized like other display settings.
  The light palette remains the default for existing users and first launch;
  the PWA manifest uses fixed light-theme colors because installed shortcuts
  cannot vary their splash colors by preference.
- Sound and haptic alerts depend on browser/device support. The visual feedback
  and live-region announcement remain available when those channels are absent.
- Native CubeLab JSON import remains replace-only. csTimer files add new sessions
  after preview/confirmation. Neither is a general-purpose local-file merge by
  solve ID; that reconciliation belongs to Drive synchronization.
- Google Drive has no transaction across the snapshot set. Every automatic write
  adds a new, uniquely named, immutable snapshot, so no writer can overwrite
  another writer's file — including two tabs or profiles sharing a device
  identity. The legacy mutable fixed-name file is replaced only through a Drive
  v2 ETag/`If-Match` conditional update; a 412 or missing ETag fails closed.
  Same-origin writes still share a Web Lock, and the optimistic changed-file
  recheck remains only for that legacy transport. Local state is still
  replaceable and convergence is eventual; the remote store is not transactional.
- Manual conflict review pauses publication and offers **Use this device** /
  **Use cloud** for solve fields, session metadata, session preferences, global
  settings, and redirects. Remote-only disagreements are labelled **Use newest
  cloud** / **Use other cloud**. An approval only applies to the exact reviewed
  values and timestamps; a later edit raises a fresh conflict. A local-only
  review history records up to 50 decisions and supports Undo while the exact
  stored decision is still current; applied redirect merges and superseded
  decisions are not reversible. The conflict queue is not capped at 100 records;
  it is deduplicated by `kind:id:field` and paginated in the UI (5 per page, with
  a "Show all" action). When a device already holds an approval for one side of a
  multi-remote disagreement, the newest-approval rule can hide an older
  independent cloud approval until that device's newer approval is absent.
- Deletion recovery extends an existing `(recovered)` session by solve ID. New
  session tombstones record the deleting device's known solve IDs, so unknown
  solves are recovered even under clock skew (conservatively, including old
  solves the deleting device never saw). Legacy tombstones still use wall-clock
  comparison for clearly newer edits, but the remaining ambiguous candidates now
  require an explicit `legacyRecovery` review instead of being silently dropped.
- Snapshot cleanup bounds growth but is best effort and not transactional.
  Automatic cleanup keeps the newest snapshot of every device group, never
  removes the just-published snapshot or the legacy mutable file, and prunes
  files beyond the configured count or age threshold after a successful merge and
  publication. Manual cleanup is limited to this device's superseded snapshots.
  Older snapshots without `appProperties.deviceId` group by sanitized file-name
  prefix, so an unusually renamed file can appear as a separate device group. A
  partial delete failure is reported and leaves the file in place.
- Active-session selection has field metadata and merging, with manual-review
  disagreements and timer-active deferral. Cross-tab changes reconcile when idle;
  this does not provide distributed consensus.
- Settings provenance depends on `cubelab:sync:v1`. Clearing sync metadata falls
  back to the conservative first-sync policy rather than recovering historical
  field timestamps.
- Redirect normalization is deterministic for a shared approval set but is not a
  consensus protocol. Devices holding different approval sets can resolve
  differently until they exchange the same set. A local approval no longer hides
  a remote-only destination disagreement, but applied redirect merges cannot be
  undone automatically.
- Sync-on-exit is best effort. Visibility loss, `pagehide`, and `freeze` are
  deduplicated before requesting a sync, but browsers may terminate async OAuth
  and network work during close; local persistence remains the durability boundary.
- In-flight guards recompute content fingerprints across asynchronous boundaries.
  Render-time pending detection memoizes on immutable React state references, so
  in-place mutation can leave that display stale. The fingerprint is 32-bit FNV-1a,
  not an object-identity comparison or a collision-free equality proof.
- Same-origin tabs listen for session/settings storage changes. Session adoption
  is deferred during timing and in-flight solves are merged by ID when idle;
  settings reconcile per field with pending local edits retained. Idle collection
  replacement is not transactional concurrent editing. Use one tab for destructive
  changes and imports.
- Backup files are unencrypted JSON. They contain solve history and settings and
  are the user's responsibility once downloaded.
- Import is capped at 10 MB. Export has no cap, so an extremely large local
  history could produce a backup file that the importer rejects. A 2,000-solve
  backup is far below the limit.
- Session deletion is confirmed but has no undo. Clearing a session also has no
  undo beyond re-importing a backup.
- A per-session inspection toggle is stored as an override. It can be cleared
  back to “use global default” (with removal provenance retained for merging);
  a session that has never been overridden follows the global value.
- Solve comments are plain text, limited to 500 characters. They are included in
  local persistence and JSON backups but are not searchable or editable in bulk.
- Up to five custom averages are supported. Built-in average sizes cannot be
  added again as custom averages, and a high built-in average stays empty until
  the session has enough solves.
- Solve history now windows sessions above 200 solves: only the rows near the
  visible area are rendered, with spacers preserving total scroll height and
  `aria-setsize`/`aria-posinset` exposing the full count to assistive technology.
  A **Show all solves** control restores every row for find-in-page and full
  keyboard traversal. Windowed mode keeps only the rendered rows in the Tab order;
  use **Show all solves** when every row must be reachable. A 2,000-solve session
  now renders about 18 rows, 423 DOM nodes, 7.6 MB JS heap, and loads in about
  0.8 s in Chromium.
- Automated browser testing runs Chromium, Firefox and WebKit with nine skips:
  the offline, touch hold-to-time and two CDP canvas/PG3D checks are Chromium-only
  (eight skipped cases across Firefox/WebKit); WebKit also skips cross-tab timing.
  Non-cube player initialization checks assert puzzle IDs/status, not rendered
  pixel correctness. Physical iOS/Android devices were not tested.
- The mobile E2E flow exercises pointer events in a mobile viewport. It does not
  emulate platform-specific touch scrolling/pinch behavior.
- Phase 4 added keyboard/focus and screen-reader-oriented DOM checks. Current
  axe assertions reject serious/critical findings in the tested main and Settings
  views; they do not assert zero findings of every impact level. The main-view
  scans disable `label-content-name-mismatch` for the composite timer surface.
  Physical screen-reader/assistive-device validation has not been performed.
- First launch requires network access. Local timing and scramble generation
  are offline-capable after service-worker installation and asset caching finish;
  Drive operations are not offline-capable.
- The production bundle intentionally includes a large `cubing.js` chunk; no
  attempt was made to reimplement or trim its random-state solver.

None of these limitations block the core product, Phase 2A, or Phase 2A.3
acceptance criteria.

## Milestone status

### Core product — Complete

All requested core product functionality is implemented and verified:

- [x] Flat csTimer-inspired responsive UI
- [x] Central monotonic timer
- [x] Scramble display and queue
- [x] Keyboard hold/release/stop behavior
- [x] Repeat and scroll suppression
- [x] Optional WCA inspection with penalties
- [x] `cubing.js` random-state scrambles
- [x] Raw solve persistence with stable IDs
- [x] Single/mo3/ao5/ao12 with DNF handling
- [x] Penalties, deletion, and confirmed clearing
- [x] Touch-friendly responsive layout
- [x] Strict TypeScript and modular separation
- [x] Unit and production browser tests
- [x] Offline-first PWA
- [x] Documentation and agent handoff


### Phase 2A — Complete

- [x] Multiple named local sessions
- [x] Create, switch, rename, and confirmed delete
- [x] Case-insensitive unique names, 40-character limit, whitespace cleanup
- [x] Session controls locked during timing
- [x] Automatic migration from `cubelab:solves:v1` into **Session 1**
- [x] Versioned sessions schema with corruption recovery
- [x] JSON export of all sessions, solves, active session, and settings
- [x] Validated import with explicit replacement confirmation
- [x] Invalid-file and cancelled-import paths leave local data untouched
- [x] Unit coverage for session mutations, migration, and backup validation
- [x] Production E2E coverage for session lifecycle, locking, export, and import
- [x] Refreshed desktop/mobile screenshots and documentation

**Completion estimate: 100% of authorized Phase 2A scope.**

### Phase 2A.1 — Complete

- [x] Header Settings button replaces the header inspection switch
- [x] csTimer-inspired Settings dialog with Timer, Controls, Data, and About
- [x] Inspection on/off preference moved into Settings
- [x] Backup & restore entry moved from the session panel into Settings → Data
- [x] Settings locked while the timer is armed, running, or in inspection
- [x] Native modal focus containment, Escape/backdrop close, and focus restoration
- [x] Responsive layout with independently scrolling body at 320 px
- [x] Production E2E coverage for Settings focus, inspection persistence, backup
  access, timer locking, and narrow-width touch targets
- [x] Refreshed desktop/mobile screenshots plus a Settings dialog screenshot
- [x] Full verification chain rerun

**Completion estimate: 100% of authorized Phase 2A.1 scope.**

### Phase 2A.2 — Complete

- [x] Settings schema v4 with v1–v3 migration and field-level validation
- [x] Storage and backup validation for upgraded settings records
- [x] Timer-update and custom Space-hold (0–10 s) controls
- [x] Display scaling, small-decimal controls, and scramble click/alignment/height controls
- [x] Visual, sound, haptic, and combined solve/DNF feedback
- [x] Inspection warning at 8 or 12 seconds with audio priming
- [x] Green, blue, violet, and amber accent colors with WCAG AA contrast
- [x] Statistic-card visibility and hundredths/tenths display precision
- [x] Expanded Controls reference in Settings
- [x] Interface zoom fills the viewport without blank scroll or horizontal overflow
- [x] Effective-time history labels wrap instead of clipping
- [x] Scramble click action supports Enter while Space remains reserved for timing
- [x] Dedicated Playwright coverage for every new settings group
- [x] Accessibility, docs, visual QA, and full verification rerun

**Completion estimate: 100% of authorized Phase 2A.2 scope.**

### Phase 2A.3 — Complete

- [x] Count-down and count-up inspection display
- [x] Independent optional 8-second and 12-second visual warnings
- [x] DNF/danger tone about 50% louder, capped independently of the volume slider
- [x] Green “Saved locally” header indicator removed
- [x] Built-in ao25, ao100, ao200, ao500, ao1000, ao5000, and ao10000
- [x] Up to five custom trimmed averages from ao3 to ao10000
- [x] Fenwick-tree fast path for large averages with brute-force test comparison
- [x] History clear-session action removed
- [x] Session-settings gear replacing the inline delete button
- [x] Per-session inspection override, clear session, and delete session
- [x] Typed `CLEAR THIS SESSION` / `DELETE THIS SESSION` confirmations
- [x] Inline history penalty/delete buttons replaced by the floating row menu
- [x] Solve menu with `+2`, DNF, delete/undo, copy scramble/time/text, and comments
- [x] Persisted 500-character solve comments
- [x] Settings schema v5 and sessions schema v2 with migrations and validation
- [x] Dedicated production E2E coverage for the new flows and failure paths
- [x] Refreshed desktop, mobile, and Settings screenshots
- [x] Full verification chain rerun

**Completion estimate: 100% of authorized Phase 2A.3 scope.**

### Phase 2B — Complete, superseded by Phase 2C

Phase 2B introduced manual Google Drive backup/restore without background sync or
telemetry. Phase 2C replaced the manual-only fixed-file path with device-owned
snapshots, automatic reconciliation, field-level merging, and conflict review;
the legacy `cubelab-backup.json` remains readable.

- Google Identity Services OAuth and Google Drive app data are used for
  app-private remote backups.
- The legacy fixed-name file can still be read and is removed by delete-all.
  Current writes use `cubelab-backup-<device-id>-<uuid>.json`.
- Remote metadata is stored under `cubelab:drive:v1` with field-level fallback.
- Drive controls are disabled while timing and when no client ID is configured.
- Remote deletion and offline/failure paths are covered by unit and mock E2E
  tests.
- Automated tests use a deterministic in-memory Drive transport. Real Google
  Identity Services authentication and Google Drive app-data backup/restore were
  also validated on 2026-10-24 with a configured test OAuth client (Google Cloud
  project `cubelab-978`) while the OAuth app remained in Testing mode; CI still
  uses the mock transport. Production correctness depends on deploying with a
  valid `VITE_GOOGLE_CLIENT_ID` and completing Google publishing/brand work before
  non-test users can sign in.

### Phase 2C — Complete with documented provider-CAS limitations

Phase 2C implements optional local-first Google Drive synchronization on top of
the Phase 2B manual backup path.

- Device-owned remote snapshots named `cubelab-backup-<device-id>-<uuid>.json`; every
  sync lists, validates, and merges all CubeLab snapshots, including the legacy
  `cubelab-backup.json`.
- Sessions schema v4 field metadata for name, event, inspection override, and
  individual preferences; global settings field metadata lives in the sync
  runtime. Newest field timestamp wins with a deterministic tiebreak, and equal
  legacy values do not gain fabricated history.
- Time-based, solve-count-based, and combined schedules, with 1 minute / 1 solve
  minimums and startup, exit, and reconnect triggers. Sync is deferred while the
  timer is active and resumes once when idle; automatic retries are bounded.
- ID-based session and solve merging with tombstones, session redirects, and
  duplicate-session-name detection.
- Empty-default cloud adoption that preserves deliberately created local
  sessions and tombstoned solves.
- Conflict review for solve fields, session metadata, session preferences,
  global settings, and redirects. Manual review pauses publication, shows **Use
  this device** / **Use cloud** choices, and resumes after the last pending
  conflict is resolved. A stale approval cannot override an edit made after the
  prompt was displayed.
- Solves belonging to a deleted session are moved into a deterministic
  `(recovered)` session instead of being silently dropped. Existing recovered
  sessions are extended by solve ID across successive offline devices.
- New session tombstones include the deleting device's known solve IDs so
  clock-skewed unknown solves are recoverable; legacy tombstones use the
  time-based fallback.
- Delete-all remote snapshot cleanup with partial-failure reporting. Every write
  creates a new immutable snapshot. Stage 2 adds a configurable retention policy
  (10 snapshots per device and 30 days by default), automatic cleanup after a
  successful publication, a per-device ownership list with selective deletion,
  and a manual **Clean up now** action limited to this device's superseded files.
- Sync settings and status UI, plus deterministic mock-transport unit, stress,
  and E2E coverage.
- The 2026-10-25 hardening patch fixed legacy migration scope, adoption
  semantics, solve-owner event compatibility, directional counts, duplicate-name
  validation, and in-flight local-edit protection. The follow-ups added the
  broad conflict workflow, deletion recovery, repeated-device recovery,
  stale-approval protection, honest solve-count semantics, device-owned
  snapshots, field-level settings/session merging, timer-safe scheduling, and
  redirect determinism tests.
- The 2026-10-27 remediation replaced mutable per-device files with unique
  immutable snapshots, removed the conflict-queue correctness cap while keeping
  paginated rendering, and surfaced disagreements between remote snapshots for
  manual review.
- Stage 1 on 2026-10-28 added the Drive v2 ETag/`If-Match` conditional update for
  the legacy mutable file, a local-only review history with exact-match Undo,
  mandatory review for ambiguous legacy tombstones, remote-only redirect
  disagreement review, visibility/`pagehide`/`freeze` exit sync with deduplication,
  and non-destructive **Repair sync state**.

**Not proven:** the real-provider multi-device and retention scenarios were run
successfully on 2026-10-28 with two independent transports, but not with two
physical browsers or machines. A Google Drive v2 ETag/`If-Match` conditional
update protects the legacy mutable fixed-name file; immutable snapshots are
create-only and there is no transaction across the snapshot set. Local state
remains replaceable and convergence is eventual. Redirect consensus, applied
redirect rollback remain unimplemented. Active-session field metadata and merging were added by the October 30 audit remediation. The
OAuth app is still in Testing under another owner account, so non-test sign-in
is unverified. Snapshot cleanup is best effort; a repeat delete of an
already-removed file hit one transient `ECONNRESET` that did not reproduce. The
remaining gaps are listed in [`PATCH_LIMITATIONS.md`](PATCH_LIMITATIONS.md); do
not describe Phase 2C as data-loss-proof.

## Phase 5 — Audit remediation — historical implementation record (closed 2026-10-30)

Implementation progress on the 2026-10-29 audit findings plus roadmap items 6
and 8:
- Stage 1 (P1): in-flight sync timer rechecks after remote read, before upload,
  after write-lock acquisition, and before applying state; deferred application
  until idle; cross-tab session-collection replacement deferred until idle.
- Stage 3 (P2 #5/#6): approval matching now requires the exact reviewed
  value/timestamp pair or an already-applied version stamped at approval time
  (with Undo preservation via priorUpdatedAt); singleton restore now normalizes
  the first snapshot through mergeSessionsData so tombstones/redirects apply.
- Stage 4 (P2 #7): effectiveTimeMs now truncates individual results to
  centiseconds (and rounds >=10 min results to the second per WCA 9f2).
- Item 6: field-level active-session selection merging with metadata tracking,
  sync-runtime persistence, envelope transport, and conflict surfacing.
- Item 8: snapshot cleanup now retries failed deletes with backoff; already-gone
  files are not counted as performed deletes.

Remaining: two-page browser test, perf profiling, P3 browser-error assertions.
Completed this pass: cross-tab settings reconciliation, fractional-centisecond
stats tests, P3 housekeeping (Node engines, README).

Verification on Node v22.23.2: typecheck passed, lint passed, 360/360 unit
tests passed (24 files), production build passed (PWA 22 entries). E2E not
re-run for this partial change.

## Stage 2 — Snapshot lifecycle management — 2026-10-28

**Status:** Complete; full verification recorded below.

### Delivered

- `src/lib/snapshotRetention.ts` groups remote files by
  `appProperties.deviceId`, falling back to the sanitized file-name prefix after
  stripping the UUID or fallback write token. It selects superseded snapshots
  only when they exceed the per-device count or age threshold, always keeping the
  newest file in each device group.
- Cleanup never removes the just-published snapshot or the legacy mutable
  `cubelab-backup.json`. Files without a parseable modification time are bounded
  by count only.
- `cubelab:sync:v1` stores `snapshotCleanupEnabled` (default on),
  `snapshotKeepPerDevice` (default 10; options 3/5/10/20/50), and
  `snapshotMaxAgeDays` (default 30; options 7/30/90/180/365). Older records and
  invalid fields fall back field by field.
- New snapshots record the owning device in Drive `appProperties.deviceId`.
  Listings request `size` and `appProperties`; the memory transport mirrors the
  real metadata.
- Automatic cleanup runs in `useSync` only after a successful upload, using the
  pre-write listing plus the published file ID and publication time as deletion
  boundaries. A cleanup failure is reported without turning the completed sync
  into a failure.
- `useDriveBackup` exposes `refreshSnapshots`, `deleteSnapshot`, and
  `cleanupSnapshots`. Manual cleanup re-lists, uses the newest modification time
  as its boundary, and passes `ownOnly: true`.
- **Settings → Data → Google Drive backup → Remote snapshots** shows this
  device's group first, each file's size and modification time, five files per
  device with **Show all**, selective deletion with confirmation, **Refresh**,
  and **Clean up now** with a count confirmation. Advanced settings retains
  delete-all.
- Delete-all still removes every CubeLab snapshot, including legacy files, and
  reports partial failures.

### Verification

- `src/lib/snapshotRetention.test.ts` covers newest-per-device retention, count
  and age thresholds, the published-file and publication-time boundaries, legacy
  file protection, name-based grouping, ownership labels, undated files, and
  partial delete failures.
- `src/lib/syncStorage.test.ts` covers policy defaults, valid choices, and
  invalid-field recovery.
- `src/hooks/useDriveBackup.test.ts` covers listing metadata, selective delete,
  and own-only manual cleanup.
- `src/hooks/useSync.test.ts` covers automatic cleanup after publication,
  disabled cleanup, and a non-fatal partial failure.
- The production Playwright suite covers ownership groups, selective deletion,
  manual cleanup, and policy persistence with the mock transport.

**Fresh run (2026-10-28, Node v22.23.2):** `npm run check` passed as one command:
typecheck and lint passed, **332/332 unit tests** in 22 files, production build
(96 modules; PWA 22 entries, 2,309.44 KiB), **30/30 Playwright tests**, and
`git diff --check` passed. The new production E2E flow covers ownership groups,
selective deletion, own-only manual cleanup, and policy persistence.

## Stage 3 — Real-provider validation — 2026-10-28

**Status:** Real-provider validation complete; OAuth publishing/branding is
partially met. The multi-device provider gate is met. The non-test sign-in
requirement is not met because the OAuth app is still in **Testing** and its
Google Cloud project is owned by another account.

### Delivered

- `src/validation/realProvider.validation.ts` and `vitest.real.config.ts` add an
  opt-in `npm run validate:drive` harness. It is excluded from `npm test`,
  `npm run build`, and `npm run check`; it requires an explicit
  `CUBELAB_DRIVE_ACCESS_TOKEN` and uses only `drive.appdata`.
- `describeGoogleAuthError` maps `origin_mismatch`, `access_denied`,
  `popup_closed`, `popup_failed_to_open`, `idpiframe_initialization_failed`,
  invalid clients, and disallowed user agents to actionable guidance. The origin
  message names the exact scheme/host/port that must be authorized. Unit coverage
  is in `src/lib/driveTransport.test.ts`.
- **README → Google OAuth setup** documents authorized JavaScript origins,
  Testing-mode test users, publishing, and the `origin_mismatch` failure.
- `useDriveBackup` now derives `connected` from `transport.isConnected()` and
  derives its idle phase, so a sync that acquires a token outside the dialog no
  longer leaves the dialog on **Offline** with a **Connect Google Drive** button.
  `useDriveBackup.test.ts` covers that external-connection path.

### Real-provider evidence

- **Origin configuration.** Sign-in initially failed with `origin_mismatch` for
  `http://127.0.0.1:5173` and `http://localhost:5173`. After the project owner
  added `http://localhost:5173`, Google showed the normal CubeLab consent screen.
  The consent screen requested only “See, create, and delete its own
  configuration data in your Google Drive” (`drive.appdata`); CubeLab requested
  no email, profile, or identity scopes.
- **Real app sync.** On 2026-10-28 the app published
  `cubelab-backup-b150465e-7eb4-4242-a6c0-a383f68272a1-a598ab57-938b-4df7-878e-764a86615380.json`
  at `2026-10-28T17:13:19.868Z` (1,140 bytes,
  `appProperties.deviceId=b150465e-7eb4-4242-a6c0-a383f68272a1`). The earlier
  snapshot
  `cubelab-backup-b150465e-7eb4-4242-a6c0-a383f68272a1-8e7a64a4-0964-4b3e-93eb-131440f9df71.json`
  remained at `2026-10-28T17:10:01.083Z` (1,168 bytes). The dialog showed
  **Online**, **Status: synced**, **2 files · 2.3 KB**, and a **Disconnect**
  action, confirming the derived-connection fix. The account label remains the
  generic “Google Drive connected” because no identity scope is requested.
- **Harness scenarios (real Drive).** Two independent transport instances with
  distinct device IDs published concurrently; both snapshots were discoverable
  with the correct `appProperties.deviceId`; all snapshots downloaded and merged
  to the same solve set from either transport; a second concurrent round
  converged; two writers sharing one device ID kept both files; a real ETag was
  discovered and a stale `If-Match` failed while the correct ETag replaced the
  legacy mutable file; retention selected with own-only cleanup against real
  modification times and ownership; selective delete removed one file and a
  repeated delete resolved.
- **Final run.** `2026-10-28T17:14:23.018Z`: 2 baseline app snapshots left
  untouched, 7 files created, 7 deleted, 0 cleanup failures, 0 remaining created
  files, **7/7 scenarios in 24.86 s**. Timings: concurrent publish 2,005 ms,
  round-one read 812 ms, concurrent round two 2,460 ms, converged read 1,569 ms,
  legacy conditional write 1,471 ms, retention cleanup 1,031 ms. Real ETag:
  `"MTc5MzIwNzY1MTM0Ng"` (earlier runs observed
  `"MTc5MzIwNjc5NjI2Mw"` and `"MTc5MzIwNzAzOTMyNw"`).
- **Clean-account runs.** A 7/7 run completed in 29.94 s; a later run passed six
  scenarios and hit a transient `TypeError: fetch failed` / `ECONNRESET` after
  about 62 s on the repeated `DELETE` of an already-deleted file. Its cleanup had
  already deleted all seven created files, and an immediate rerun passed 7/7 in
  26.14 s. Recorded as a transient network/provider edge case, not a reproducible
  product defect.
- **OAuth publishing.** The consent screen is branded **CubeLab** and shows only
  the Drive app-data permission. The app is still in **Testing**. The Google
  Cloud project is owned by another account, and the signed-in test account lacks
  permission to inspect or publish it. A non-test account therefore was not
  validated and may be blocked until the owner publishes the app and completes
  any verification Google requires.

### Verification

- `npm run typecheck` and `npm run lint` passed after the connection fix.
- Focused unit coverage: **40/40** tests in
  `src/hooks/useDriveBackup.test.ts` and `src/lib/driveTransport.test.ts`.
- Real-provider harness: **7/7** in the final run; no harness files left behind.
- **Fresh full check (2026-10-28, Node v22.23.2):** `npm run check` passed as
  one command: typecheck and lint passed, **337/337 unit tests** in 22 files,
  production build (96 modules; PWA 22 entries, 2,311.30 KiB), **30/30
  Playwright tests**, exit 0. The opt-in real-provider harness is not part of
  `npm run check`.

## Stage 4 — Phase 3 completion — 2026-10-28

### Delivered

1. **Events.** `PuzzleEvent` now includes `555`, `666`, and `777`; the shared
   `CUBELAB_EVENTS` registry defines the labels, `cubing.js` scramble IDs, and
   the runtime validator for all seven events. Storage, backup, session metadata,
   and sync therefore accept the new events instead of defaulting them to 3×3.
2. **Scrambles.** `generateScramble` resolves its `cubing.js` event ID from the
   registry. The plausibility check accepts WCA big-cube notation such as
   `3Rw2`, `3Dw`, and `3Bw'`. A unit test generates a random-state scramble for
   every event. The existing prefetch queue, loading skeleton, failure message,
   retry action, and timer gating are event-agnostic.
3. **Interface.** Session create/settings selects already consume the registry,
   so 5×5, 6×6, and 7×7 appear automatically. The header and timer-stage event
   labels now come from the same registry, and duplicate-session suffixes show
   the human-readable event label. The timer stage no longer hard-codes 3×3.
4. **Per-event E2E.** Fourteen production tests (seven events × desktop and
   390 px mobile) switch the event, wait for a fresh event scramble, record
   three solves, apply `+2` then DNF to the newest solve, verify best-single and
   mo3 handling, reload, and verify persisted event/scrambles/penalty. The
   backup E2E now exports and restores a 3×3 + 5×5 collection.
5. **Storage and backup.** Tests round-trip every event in modern sessions,
   reject legacy single-session records tagged with any non-3×3 event, and
   round-trip all seven events through a versioned backup. Mixed-event session
   rejection continues to run before import confirmation or mutation.

### WCA rule audit

- All seven events share the WCA 15-second inspection window, `+2` from
  15–17 seconds, DNF after 17 seconds, and the same effective-time statistics.
  A focused unit test constructs the same penalized solves for every event and
  verifies identical effective single, mo3, and DNF behavior.
- The timer machine receives no puzzle event, so timing cannot diverge by event.
  No event-specific branch was added.
- Competition time limits and cutoffs are not implemented because they are set
  per competition rather than by the WCA solve regulations. Multi-blind and
  non-cube WCA events remain outside scope.

### Verification

- `npm run check` passed as one command: typecheck, lint, **339/339 unit tests**
  in 22 files, production build (96 modules; PWA 22 entries, 2,311.53 KiB),
  **44/44 Playwright tests**, exit 0.
- `git diff --check` passed. Fresh evidence is recorded in the verification
  table above.

**Gate status: met.** The Phase 3 acceptance criteria in `ROADMAP.md` are
checked off, and README, AGENTS, ROADMAP, the stage plan, and this file describe
the completed event support.

## Stage 5 — Phase 4 platform hardening — 2026-10-29

### Delivered
1. **History virtualization.** `SolveHistory` now windows sessions above 200
   solves, rendering only the rows near the visible area plus top/bottom spacers
   that preserve total scroll height. Measured row heights correct the offset
   table before paint, and `aria-setsize`/`aria-posinset` expose the full count.
   A **Show all solves** control restores every row for find-in-page and full
   keyboard traversal; the windowed-mode tradeoff is documented. Anchor
   restoration keeps scrolling, penalty toggles, deletion, comments, and menu
   actions from jumping.
2. **Performance profile.** A seeded 2,000-solve session was measured before and
   after virtualization in Chromium at 1440×1000:
   - Rendered rows: 2,000 → 18.
   - DOM nodes: 24,291 → 423.
   - JS heap: 16.1 MB → 7.6 MB.
   - Load to queue ready: 1,170 ms → 814 ms.
   - Penalty toggle: ~49 ms → ~44 ms.
   - Scroll to oldest row: 18 ms → 64 ms.
   - Delete with menu: 416 ms → 74 ms.
   - Session switch: 207 ms → 42 ms.
   - Backup validation: 374 ms → 109 ms.
   - Backup apply: 595 ms → 315 ms.
   - No horizontal overflow at 1440 or 390 px.
   The remaining interaction cost is now dominated by React state updates on the
   visible window rather than reconciling 2,000 rows.
3. **Cross-browser coverage.** Playwright now runs Chromium, Firefox, and WebKit.
   Firefox and WebKit skip the service-worker offline test and the touch
   hold-to-time test, which remain Chromium-only. All three engines pass the rest
   of the suite. Clipboard permission grants are limited to Chromium.
4. **Accessibility audit.** A keyboard and screen-reader-oriented audit covered
   the timer, Settings, session dialogs, solve history/menu, Drive review, and
   destructive confirmations. Axe scans of the main view and Settings dialog are
   now automated. The only remaining serious axe finding is
   `label-content-name-mismatch` on the composite timer surface; its inner content
   is marked `aria-hidden` and the control exposes a descriptive `aria-label`.
   Focus order, focus restoration, dialog focus trapping, accessible names, live
   regions, and Space ownership were verified. Space remains timer input except in
   text fields.
5. **PWA and bundle review.** `cubing.js` is now loaded with a dynamic import in
   `src/lib/scramble.ts`, deferring the 1.2 MB solver chunk off the initial shell
   while keeping the dedicated chunk and disabled module preloading. Service-worker
   registration, cache versioning, and offline reload were re-verified with the
   offline Playwright test. The production build remains 96 modules, PWA 22
   entries, 2,317.00 KiB.
6. **Physical device review.** Not performed; no iOS or Android device was
   available in this environment.

### Verification
- `npm run check` passed as one command: typecheck, lint, **346/346 unit tests**
  in 23 files, production build (96 modules; PWA 22 entries, 2,317.00 KiB),
  **140/144 Playwright tests passed** with 4 honestly skipped (offline in
  Firefox/WebKit, touch hold-to-time in Firefox/WebKit), exit 0.
- `git diff --check` passed.
- Layout coverage at 320, 390, 1440, and desktop widths; no horizontal overflow.

**Gate status: met.** The Phase 4 acceptance criteria in `ROADMAP.md` are
checked off.

## Stage 6 — Polish — 2026-10-29

### Delivered

1. **Audited theme.** `ThemePreference` is `light`, `dark`, or `system` and
   defaults to `light`, preserving existing users' appearance. Settings schema
   `v7` adds the field; `v1`–`v6` records and older backups upgrade with the
   default. The field is part of Drive field-level settings merging.
2. **Palette audit.** `src/index.css` now owns complete light and dark token
   sets, including dark variants for green, blue, violet, and amber. Previously
   hard-coded switch, scrollbar, selection, timer-display, marker, track, dot,
   shadow, backdrop, and select-arrow colors are tokens. No literal color
   remains outside the token blocks.
3. **Contrast tests.** `src/lib/theme.test.ts` parses the CSS through a Vite
   `?raw` import with CSS processing enabled and checks 36 text/surface and
   accent pairs at WCAG AA (4.5:1 text, 3:1 focus outlines) in both themes and
   all four accents. It also verifies that the dark token set
   covers every light token and that `resolveTheme` handles explicit and system
   preferences.
4. **Application.** `useTheme` resolves the preference with
   `prefers-color-scheme`, tracks OS changes through `useSyncExternalStore`, and
   updates `documentElement.dataset.theme`, `colorScheme`, and the
   `theme-color` meta. A small `index.html` bootstrap applies the stored theme
   before the app bundle loads, avoiding a light flash for dark users. The PWA
   manifest now uses the light default colors (`#ffffff` / `#e9edf1`).
5. **Verification.** Production E2E covers light → dark → reload persistence,
   system-theme following under emulated media changes, and the pre-paint
   bootstrap with the app bundle blocked. Axe scans the dark main view and
   Settings dialog in Chromium, Firefox, and WebKit. The inspection
   **Use global default** reset was re-verified against its E2E coverage.
6. **Import cap review.** The 10 MB cap is unchanged; no deliberate larger-cap
   design was approved.

### Verification

- `npm run check` passed as one command: typecheck, lint, **360/360 unit tests**
  in 24 files, production build (99 modules; PWA 22 entries, 2,322.06 KiB),
  **149/153 Playwright tests passed** with 4 honestly skipped (offline in
  Firefox/WebKit, touch hold-to-time in Firefox/WebKit), exit 0.
- `git diff --check` passed.
- Desktop and 390 px dark layouts were inspected; light and dark screenshots
  are recorded in `docs/`.

**Gate status: met.** Contrast tests pass in both themes and all accents,
dark-theme axe scans pass in all three engines, and the documentation and
screenshots are updated.

## Handoff

The current execution plan is [NEXT_SESSION_HANDOFF.md](NEXT_SESSION_HANDOFF.md).
Its first steps are narrow-layout repair and targeted Zen/enabled-sync profiles.
Future cloud protocols, more events and a larger import cap need separate scope.
Do not use the historical stage plans below as the current approval boundary.

## Git checkpoint

The local checkpoint includes the accumulated audit remediation, import/tools,
analytics and trimming work, timer-stop response patch, tests, documentation and
referenced UI screenshots, followed by Phase 6a on November 1, the default-panel
right-gutter mitigation, and tracked OpenCode skills. Documentation-only passes
do not establish fresh behavioral or provider verification. No generated
build, browser output or credentials belong in the commit. Inspect `git log -1`
and `git status --short` for the actual commit and current working-tree state;
a local commit does not imply a remote push.

## Phase 5 — Audit remediation (complete) — 2026-10-30

Completed all checklist items in `Oct_30_PM_plan.md`:

- Focused regression tests: approval timestamps, singleton restore, centisecond
  statistics, cross-tab settings, and timer-active guards.
- Two-page Playwright test (`e2e/cross-tab-timing.spec.ts`) verifies no
  mid-timing redirect and idle reconciliation.
- Performance evidence: `syncStateFingerprint` ≈ 21.9 ms, `addSolve` ≈ 1.0 ms,
  `reconcileExternalSessions` ≈ 4.3 ms for a 10,000-solve session; fingerprint
  is memoized on `sessions`/`settings`.
- P3 items: `deepmerge` advisory documented as a build-time deferral; remote
  byte limit uses encoded bytes; browser page-error assertions strengthened in
  `e2e/timer.spec.ts`.
- Cross-tab settings now merge per field with metadata preservation and defer
  adoption while the timer is active.

Verification (Node v22.23.2):
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed (400+ unit/component tests across 25+ files).
- `npm run build`: passed (PWA production build).
- `npm run test:e2e`: passed (Chromium/Firefox/WebKit projects).

## Approved csTimer import and scramble diagram follow-up — complete 2026-10-30

- csTimer JSON import: detects csTimer exports in the existing import flow,
  maps all 7 CubeLab events, previews via the standard confirmation dialog.
- Draw Scramble: the scramble panel's **Current tool** button (wrench icon)
  toggles a compact bottom-right panel inside the timer area. The panel can be
  dragged by its header handle and resized from its bottom-right handle; its
  stage-relative position and size persist in `cubelab:toolPanelLayout:v1`
  (written only when a gesture ends, clamped to the timer stage on restore and
  viewport changes, not synchronized). The panel follows the live scramble and
  event and offers a pure N×N 2D net (standard U / L F R B / D layout, WCA
  colours, wide-move support for 2×2–7×7) or the `cubing.js` PG3D render. Both
  views use the standard cube colour scheme from `src/lib/cubeColors.ts`
  (`U #FFFFFF`, `D #FFFF00`, `F #00FF00`, `B #0000FF`, `R #FF0000`,
  `L #FF8000`); the 3D view forces `visualization="PG3D"` because the Cube3D
  renderer hard-codes its palette. The panel is pointer-isolated from the timer.
  The 2D/3D choice lives only in **Settings → Scramble**.
- The footer **Function** dropdown selects the tool without closing the panel;
  only functional tools are listed (no placeholders).
- The 3D host keeps cubing.js's `display: grid` contract. An earlier
  `display: block` override collapsed the shadow-DOM visualization wrapper and
  its canvas to zero height; the panel now renders the cube at full size.
- Graceful degradation: empty, malformed, or unsupported scrambles show a
  message instead of a diagram, and a failed 3D import shows an alert.

Verification (Node v22.23.2, 2026-10-30):
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed — 409 tests in 28 files, including `cubeNet`,
  `ScrambleNet`, `ToolPanel`, and `ScramblePanel` coverage.
- `npm run build`: passed (PWA production build).
- `npm run test:e2e`: passed — 155 passed, 7 skipped across
  Chromium/Firefox/WebKit, including `e2e/draw-scramble.spec.ts`. A
  Chromium-only CDP assertion verifies the 3D canvas has non-zero width/height.
- Manual visual checks: desktop light/dark, 390 px, 320 px, and mobile landscape.
  The panel stayed inside the timer stage and did not overlap the timer digits
  in 2D or 3D.


## Time Trend follow-up — 2026-10-31

Scope: repair the compact chart, smaller PB markers, nonnegative time scale,
button styling, and expanded view requested on 2026-10-31. The surrounding
Phase 6 work and pre-existing uncommitted changes are preserved.

- The chart uses the panel's measured size, and the expanded view gets its own
  responsive plotting surface instead of reusing compact dimensions. Both views
  clip series and hover indicators to the plot rectangle.
- All selected series share a full-range, nonnegative time scale. Slow outliers
  and lifetime PBs remain visible; disabling a series removes it from the scale.
  PBs use 1.6 px compact / 2.5 px expanded markers. Dense paths retain bucket
  extrema and split at DNFs; solve results use the existing precision/penalty
  rules. Memoized chart components avoid redraws from timer-frame updates.
- Buttons, series chips, grid, labels, and legend use light/dark palette tokens;
  the palette test now checks every trend color against the chart surface.
- The native expanded dialog contains focus, closes with Escape, restores focus
  to Expand, and isolates keyboard events from the timer. Expansion is disabled
  during timing. Zoom, earlier/later navigation, range slider, Fit all, date-axis
  positions, custom averages, solve details, and range summaries work in the
  expanded view. Summary statistics retain best ao5/ao12 and improvement.
- Diagnosed the previously logged WebKit `Unexpected token '<'`: cubing.js first
  tried `/assets/search-worker-entry.js`, which received the SPA HTML fallback.
  Browser scramble initialization now prioritizes the library's bundler-aware
  worker entry. Dedicated worker chunks and disabled module preloading remain.
- New unit/component coverage exercises PBs, DNF gaps, precision, dense-line
  extrema, nonnegative axes, range navigation, custom series, empty states, and
  timing locks. New production E2E uses a 7,061-solve fixture and covers desktop,
  320 px, resize, date axis, hover, focus restoration, modal Space isolation,
  expansion while armed, and an axe scan in all three browser engines.

Fresh verification (Node v22.23.2, 2026-10-31):

- `VITE_DRIVE_MOCK=true npm run check` passed as one command (exit 0):
  typecheck, lint, **454/454 unit tests across 34 files**, production build,
  and **189 passed / 9 skipped / 198 total** production browser tests across
  Chromium, Firefox, and WebKit. The offline service-worker test passed.
- All six new Time Trend browser tests passed, including the modal axe scan,
  dense-session fixture, timing lock, and 320 px/resize checks. No page errors
  were reported by the new dense-session checks in any engine.
- An earlier full-suite attempt was stopped after Drive tests revealed that the
  existing preview server was serving a build without `VITE_DRIVE_MOCK=true`.
  The final run rebuilt with the expected test configuration and passed; no
  assertions or skips were weakened. A normal non-mock production build was
  restored afterward.
- Desktop light/dark, compact, and 320 px expanded screenshots were visually
  reviewed. Updated previews: `docs/cubelab-time-trend.png`,
  `docs/cubelab-time-trend-compact.png`, `docs/cubelab-time-trend-light.png`, and
  `docs/cubelab-time-trend-mobile.png`.
- `git diff --check` passed. Work remains uncommitted alongside the pre-existing
  changes. Real Google Drive and physical mobile-device validation were not run.


## Time Trend trackpad navigation — 2026-10-31

User-requested follow-up: independent vertical and horizontal zoom from the
mouse/trackpad in both the compact and expanded charts.

- Up/down wheel/trackpad deltas zoom the time axis; left/right deltas zoom the
  solve axis. Shift + wheel supports horizontal zoom with a conventional mouse.
  Pinch zoom affects both axes, with ctrl+wheel handling and a separate Safari
  gesture-event path. Non-passive listeners cancel page scrolling/browser zoom
  only over the enabled chart. Zoom stays anchored to the pointer.
- Pointer-captured dragging pans both axes and cannot arm the timer or move the
  tool panel. Zoom/pan is clamped to the full session/time range, with at least
  two solves and a bounded vertical magnification. Time bounds stay nonnegative.
- Horizontal navigation retains the vertical scale. Fit all resets both axes;
  a compact Fit action appears after zooming. The view carries across compact /
  expanded transitions. The Zoom axes selector supplies button access to
  horizontal, vertical, or both-axis zoom. An in-dialog gesture hint documents
  the controls. Subsecond time ticks remain distinct above one minute.
- Pure tests verify anchored zoom, inverse zoom, bounds, and pan clamping.
  Component tests cover independent wheel axes, cancellation, both pinch paths,
  compact reset, and timer locks. Production tests exercise wheel events, pinch
  event handling, pointer dragging, independent scales, page-scroll isolation,
  button axis selection, reset, and compact/expanded continuity in all engines.

Fresh verification (Node v22.23.2, 2026-10-31):

- `VITE_DRIVE_MOCK=true npm run check` passed as one command, exit 0:
  typecheck, lint, **459/459 unit tests in 34 files**, production build, and
  **195 passed / 9 skipped / 204 total** production browser tests across
  Chromium, Firefox, and WebKit. The offline service-worker test passed.
- All **12/12 Time Trend browser tests** passed, including the new gesture
  flows and existing responsive/modal/axe checks. No skips were added.
- Desktop dark/light and 320 px previews were reviewed and refreshed in `docs/`.
  `git diff --check` passed. The normal non-mock production build was restored
  after the suite. Changes remain uncommitted alongside the existing work.
- Physical trackpad hardware was not available; automated browser wheel/pointer
  and synthetic pinch inputs exercise the corresponding handlers. Real Google
  Drive validation was not run.


## Clickable Time Trend PB statistics — 2026-10-31

User-requested follow-up: clicking a PB marker opens its statistics.

- PB markers retain their small visible circles and have 28 px invisible hit
  targets. Pointer selection uses the nearest PB when targets overlap. Visible
  marker buttons support Enter in both views and Space inside the expanded
  modal; Space in the compact view remains reserved for timing.
- The read-only native stats dialog works from compact and expanded charts,
  contains focus/keyboard input, and restores focus to the exact marker on
  close. It shows the recorded effective PB, previous PB, improvement in time
  and percent, raw time, penalty, date/event, scramble, notes, mo3, standard
  chart averages, and the active custom average.
- Rolling results end at the selected PB, independently of zoom and later
  solves. All calculations reuse existing WCA precision/penalty/DNF helpers;
  missing windows show —, while DNF results remain DNF. The first valid solve
  explains that it is the starting PB. Selection follows the stable solve ID;
  switching to data without that PB closes stale details.
- Chart dragging has a 4 px threshold and suppresses marker activation after a
  pan, including a drag starting on a marker. Zoom/pan behavior is preserved.
  PB stats are blocked while timing and do not write or mutate stored solves.
  Disabled markers pass keys to the timer, preserving Stop with any key when
  Enter is pressed on a focused marker.
- Focused tests cover historical windows versus later PBs, improvement and +2,
  first-PB/missing data, DNF averages, compact mouse and Enter activation,
  persistence after hover, session replacement, and the timer lock. Browser
  coverage exercises both chart sizes, nested dialog focus/escape/Space,
  drag-versus-click, date/zoomed views, hidden markers, 320 px layout, and axe.

Fresh verification (Node v22.23.2, 2026-10-31):

- `VITE_DRIVE_MOCK=true npm run check` passed as one command, exit 0:
  typecheck, lint, **465/465 unit tests in 34 files**, production build, and
  **204 passed / 9 skipped / 213 total** production browser tests across
  Chromium, Firefox, and WebKit. The offline service-worker test passed.
- All **21/21 Time Trend browser tests** passed, including the updated focused-PB
  any-key-stop check, historical result assertions, nested modal/focus handling,
  new dialog axe scan, and 320 px overflow checks. No skips were added.
- Desktop dark/light and 320 px PB stats previews were visually reviewed and
  saved to `docs/cubelab-pb-stats.png`, `docs/cubelab-pb-stats-light.png`, and
  `docs/cubelab-pb-stats-mobile.png`.
- `git diff --check` passed. The normal non-mock production build was restored
  after testing. Changes remain uncommitted alongside the pre-existing work.
  Real Drive and physical mobile/assistive-device testing were not performed.


## Configurable average trimming — 2026-10-31

User-approved scope: csTimer-style better/worse trimming preferences, defaulting
to 5% / Auto, applied everywhere averages are computed.

- Settings → Statistics has independent better/worse selectors with 0/1-result,
  1%, 5%, 10%, 20%, and median choices; Auto matches the better side. Percentages
  round up, and an even median retains the two middle results. An ao1000 preview
  states the removed/counting results and DNF threshold. The UI explains that
  averages and average PBs recalculate; raw solves and single PBs do not change.
- Settings schema v8 migrates v1–v7 records and older backups to 5% / Auto,
  recovering invalid fields independently. The optional arguments on the pure
  statistics APIs use the same default. mo3 and effective-time/penalty precision
  are unchanged. DNFs fill the worst-side trim first; any remaining DNF makes
  an average DNF. 50 DNFs are allowed in a default ao1000; the 51st makes it DNF.
- A shared count/sum Fenwick kernel computes best and rolling averages in
  O(n log n), including large percentage trims. Trend generation now uses that
  kernel instead of sorting every individual window. Latest/best cards, quick
  averages, built-in/custom chart lines, and PB detail windows share one policy.
- Both preferences participate in cross-tab reconciliation, backup/import,
  synchronization metadata, independent field merges, and manual conflict review.
  No solve/session data schema or raw timing data is changed.
- Tests cover percentage rounding, all preset combinations, zero/asymmetric and
  median trims, DNF boundaries, direct-versus-fast parity across every side
  combination, 10,000-solve windows, old settings/backups, corruption recovery,
  separate-side merge conflicts and multi-device convergence. Production browser
  flows compare main stats, custom averages, chart lines, PB details, immutable
  solves, migration/reload persistence, backup restoration, 320 px layout and axe.

Fresh verification (Node v22.23.2, 2026-10-31):

- Final `VITE_DRIVE_MOCK=true npm run check` passed as one command, exit 0:
  typecheck, lint, **493/493 unit tests in 35 files**, production build, and
  **213 passed / 9 skipped / 222 total** production browser tests across
  Chromium, Firefox, and WebKit. The offline service-worker test passed.
- All **9/9 trimming browser checks** passed, covering policy propagation,
  historical PB results, custom/latest/best values, chart gaps, immutable solves,
  migration/reload, readable Drive conflict choices/application, median and
  independent sides, 320 px layout, and axe. The existing backup flow now
  explicitly verifies trimming export and confirmed restore in all engines.
- The Drive fixture creates a real local preference edit before introducing a
  conflicting cloud edit. An untouched default is correctly adopted without
  conflict; both edited sides trigger manual review. No assertion or skip was
  weakened.
- Production Chromium profile with a seeded **10,000-solve** history: compact
  Time Trend open **321 ms**, enabling ao1000 through the next paint **144 ms**.
  These are UI action latencies including Playwright overhead on this host,
  measured while checks ran; they are not pure-function or frame-rate claims.
- Desktop dark/light and 320 px settings layouts were visually inspected;
  `docs/cubelab-average-trimming.png`, `docs/cubelab-average-trimming-light.png`,
  and `docs/cubelab-average-trimming-mobile.png` record the new controls.
- `git diff --check` passed. The normal non-mock production build was restored
  after testing. Changes remain uncommitted alongside the existing work.
  Real Drive and physical mobile-device validation were not run.


## Timer stop response follow-up — 2026-10-31

User-approved first performance patch following the read-only 7,000-solve
investigation. Timing accuracy, immediate local saving, and sync consistency
remain required; no persistence/schema migration is included.

- Running display animation now lives in `useRunningElapsed` inside TimerStage.
  It no longer re-renders the root app every running frame. `useTimer` retains
  the authoritative ref, pure machine, monotonic input timestamps, inspection
  ticks/warnings and arming transitions. Display precision never affects raw
  time. Press timestamps are captured before audio priming and pointer focus.
- `usePostPaintValue` refreshes expensive solve presentation in a transition
  scheduled by a task after an animation-frame rendering opportunity. Statistics,
  history and Time Trend can catch up after the final readout. Replaced/queued
  tasks are cancelled; session-ID guards prevent presenting a different session's
  solves. Chart actions remain locked until the presentation catches up.
- The latest readout, useSessions persistence, sync inputs/ref guards, tombstone
  detection and sync scheduling all continue using current, non-deferred data.
  No debounce or delayed persistence was added. Enabled sync retains exact
  fingerprints, in-flight rechecks, pending detection and upload guards.
- Disabled sync no longer computes the unused full-history UI fingerprint.
  Re-enabling recomputes against current data. Memoized history/statistics and
  stable history callbacks avoid redundant presentation work. Closed backup and
  confirmation dialog contents no longer render; native shells stay mounted for
  close/focus restoration.
- New deterministic tests cover local display animation without owner renders,
  all display precisions/new runs, exact stop timestamps despite later focus/
  audio work, +2/DNF inspection, stale scheduled presentation cancellation,
  disabled/re-enabled hashing and exact enabled pending detection after reverts.
  A new 7,000-solve browser regression verifies keyboard/pointer down (before
  release), repeat suppression, one record, exact displayed/saved results,
  unchanged historical data, reload recovery and session switching.

Fresh verification (Node v22.23.2, 2026-10-31):

- `VITE_DRIVE_MOCK=true npm run check` passed as one command, exit 0:
  typecheck, lint, **503/503 unit/component tests in 38 files**, production build,
  and **216 passed / 9 existing skipped / 225 total** browser tests across
  Chromium, Firefox and WebKit (4.9 min). No assertions/skips were weakened.
- All three new dense-session browser checks passed, along with existing
  in-flight upload/edit, timer-active sync, cross-tab reconciliation, conflict,
  backup/restore, inspection and offline service-worker coverage.
- A normal non-mock production build was restored successfully afterward.
- Quiet, isolated Firefox 157 measurements: eight stops per condition after a
  discarded warm-up, four Space/four pointer, 7,000 realistic solves with field
  metadata (about 3.49 million saved characters), sync/alerts off. Median
  capture-listener-to-observable-stopped-DOM response:
  - Development, chart closed: **223 → 74 ms** (new range 59–83 ms).
  - Development, Time Trend open: **382 → 75 ms** (new range 55–80 ms).
  - Production, chart closed: **66 → 25 ms** (new range 22–29 ms).
  - Production, Time Trend open: **75 → 22 ms** (new range 16–26 ms).
  These are response measurements, not physical-display latency guarantees.
  Chart completion can still take longer, particularly in the development build.
- Chromium Event Timing corroborated an earlier next-paint response with the
  development chart open: available stop-event durations had a median
  **356 → 56 ms** (six original/four new entries, rounded by the browser).
  CPU sampling was off for this comparison. Final Firefox recorded-time versus
  browser input-interval differences were within ±1 ms for Space and +1–7 ms
  for pointer in the development cases; hardware contact latency was not measured.
- Desktop 1440×900 and 320×740 stopped-state previews were inspected. Mobile
  content width stayed at 320 px. The compact chart can overlap part of the
  readout at that narrow width; this patch does not change chart positioning.
  No screenshot refresh in docs is needed for these behavior-only changes.
- `git diff --check` passed. Changes remain uncommitted alongside the pre-existing
  work. Measurements used isolated synthetic-data contexts, not the user's
  real browser storage. Zen itself, live Google Drive and physical mobile
  hardware were not exercised. Enabled sync's full fingerprint and whole-session
  synchronous storage costs remain possible targets for later measured work.

## Phase 6a — remaining easy WCA puzzles — complete 2026-11-01

Registry-driven extension of the event set with official `cubing.js` scrambles.
No timer, statistics, trimming, persistence, or synchronization rules changed;
the new events reuse the shared WCA inspection, `+2`/DNF, and effective-time,
trimming, and PB logic. Further feature-phase proposals were subsequently
removed at the user's request.

Delivered:

- **Registry.** `src/lib/events.ts` now carries, per event, the official
  `cubing.js` `scrambleEventId` (`333`, `222`, `444`, `333oh`, `555`, `666`,
  `777`, `pyram`, `skewb`, `sq1`, `clock`, `minx`), the `twisty-player`
  `puzzleId` (`3x3x3`, `2x2x2`, `4x4x4`, `5x5x5`, `6x6x6`, `7x7x7`, `pyraminx`,
  `skewb`, `square1`, `clock`, `megaminx`), the N×N `cubeSize` for the 2D net,
  and a per-event `scrambleFormat`. `PuzzleEvent` gained `pyram`, `skewb`,
  `sq1`, `clock`, and `minx`. No schema version changed; registry-driven
  validation accepts the new events while old records keep loading.
- **Scrambles.** `generateScramble` uses the registry event ID; generated
  scrambles are whitespace-normalized to one line so the displayed scramble
  always matches the persisted one (Megaminx output is normally wrapped).
  `isPlausibleScramble` validates each notation family separately (N×N faces
  and wide moves, Pyraminx tips, Skewb, Square-1 tuples/slashes, Clock pins and
  dials, Megaminx `R++`/`D--`/`U'`), and an all-events unit test generates a
  real library-generated scramble for every event; notation tests do not prove
  the generator's random-state distribution.
- **Data safety.** Storage, backup, csTimer import, and sync validation accept
  the five new events; solves with unknown events are dropped while valid
  records survive, backups mixing events in one session are rejected before
  confirmation or mutation, and sync stops rather than merging a session whose
  solves mix puzzle events. Existing records, legacy data, and old preserved
  sessions remain compatible.
- **csTimer import.** Official `scrType` IDs `pyrso`, `skbso`, `sqrs`,
  `clkwca`, and `mgmp` map to the new events with common aliases, so imported
  sessions keep their puzzle event instead of being skipped.
- **Visualization.** The registry supplies each puzzle's 3D `puzzleId`, so
  Pyraminx, Skewb, Square-1, Clock, and Megaminx render their correct twisty
  puzzle in 3D mode. Standard cube colours are applied only to N×N events.
  In 2D mode non-cube puzzles show an honest "2D net is not available" state
  instead of an unrelated cube; the panel stays visible and interactive.
- **Copy.** Settings text, interface labels, footer, page title/description,
  and PWA manifest say "12 events"; app store text no longer claims 3×3 only.

New tests: `src/lib/events.test.ts` (registry IDs, labels, cube-only 2D nets,
validator), all-event generation/plausibility in `src/lib/scramble.test.ts`,
new-event round-trips and unknown-event rejection in `src/lib/storage.test.ts`,
backup acceptance and mixed-session rejection in `src/lib/backup.test.ts`,
csTimer mapping in `src/lib/csTimerImport.test.ts`, new-event merge plus
mixed-event stop in `src/lib/sync.test.ts`, the 2D fallback in
`src/components/ToolPanel.test.tsx`, per-event desktop/mobile E2E for all 12
events in `e2e/timer.spec.ts` (including notation checks against
`isPlausibleScramble`), and 3D/2D-fallback coverage for the five new puzzles in
`e2e/draw-scramble.spec.ts`.

Verification (Node v22.23.2, 2026-11-01): `VITE_DRIVE_MOCK=true npm run check`
passed as one command, exit 0 — typecheck, lint, **518/518 unit/component tests
in 39 files**, production build, and **252 passed / 9 existing skipped / 261
total** browser tests across Chromium, Firefox, and WebKit, including per-event
coverage for all 12 events at desktop and 390 px mobile widths, the non-cube 3D
renders and 2D fallback, and the offline service-worker flow. The normal
non-mock production build was restored afterward, and `git diff --check` was
clean. No assertion or skip was weakened.

Post-Phase 4 status: Phase 4 itself remains complete. The committed
320-pixel right-gutter mitigation is an interim step only; it does not finish
the narrow-layout, profiling, performance, persistence-design or external
validation follow-ups listed above.
