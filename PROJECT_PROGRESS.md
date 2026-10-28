# CubeLab — Project Progress

**Last verified:** 2026-10-28 (Stage 4 / Phase 3 completion; full `npm run check`)
**Milestone 1:** Complete — 100% of the defined milestone scope
**Phase 1 stabilization:** Complete — QA, accessibility, and performance pass
**Phase 2A:** Complete — local named sessions plus JSON backup/restore
**Phase 2A.1:** Complete — csTimer-inspired Settings dialog
**Phase 2A.2:** Complete — alerts, appearance, statistics, controls, and schema v4
**Phase 2A.3:** Complete — inspection direction/warnings, expanded statistics, per-session settings, solve menu, comments, schema v5, and a schema-v6 refinement with optional any-key stop.
**Phase 2B:** Complete — optional manual Google Drive backup and restore
**Phase 2C:** Complete with documented limitations — local-first Google Drive synchronization with unique immutable device snapshots, field-level session/settings merging, automatic startup/exit/reconnect/combined scheduling, ID-based merging, tombstones, recovery, redirects, empty-default adoption, duplicate-name detection, manual session merges, and conflict review across solve fields, session metadata, settings, and redirects. Stage 1 additionally adds a conditional Drive v2 ETag/`If-Match` update for the legacy mutable file, local review history with exact-match Undo, mandatory legacy-recovery review, hardened exit sync, and a non-destructive repair action. Stage 2 adds bounded snapshot retention, per-device ownership display, selective deletion, and manual cleanup. Stage 3 validated concurrent immutable publishing, all-snapshot convergence, the legacy ETag conditional write, and retention cleanup against a real Google Drive test account; the OAuth app remains in Testing under another owner account, so non-test sign-in is still unverified.
**2026-10-25 sync hardening patch:** Complete — fixed legacy migration scope, empty-default adoption, duplicate-name validation, in-flight local-edit protection, owner/event compatibility, directional sync counts, and the two React lint warnings. The first audit follow-up added manual solve-field conflict resolution, deletion/offline-edit recovery, clearer pending-count semantics, and redirect determinism tests. The v2 follow-up fixed repeated recovered-session arrivals and stale conflict approvals. The v3 follow-up adds device-owned Drive snapshots, sessions schema v4 field metadata, field-level session/settings review, settings provenance, timer-deferred sync, bounded retries, deletion hardening, and multi-device stress tests. The v4 follow-up adds complete Drive pagination, same-device write locking/revalidation, final-collection duplicate review, and recovered-solve count fixes. See [Sync hardening](#sync-hardening-patch--2026-10-25), [Audit follow-up v2](#audit-follow-up-v2--2026-10-25), [Hardening v3](#hardening-v3--device-owned-snapshots-and-field-level-review--2026-10-25), [Audit follow-up v4](#audit-follow-up-v4--pagination-same-device-writes-duplicate-review--2026-10-25), and [`PATCH_LIMITATIONS.md`](PATCH_LIMITATIONS.md).
**Phase 3/4:** Phase 3 is complete — SessionSetupDialog and SessionSettingsDialog support per-session event, inspection, scramble, and timer preferences; effective session settings apply during solve/timing; AppHeader and the timer stage display the active event; session-specific setup preserves the active-session event. Supported events are 3×3, 2×2, 4×4, 3×3 OH, 5×5, 6×6, and 7×7. Stage 4 added 5×5, 6×6, and 7×7 with per-event desktop/mobile E2E and a shared WCA rule audit.
**Repository state:** Phase 2B/2C synchronization, Phase 3 multi-event support (all seven events), and the 2026-10-25 through 2026-10-28 hardening/remediation passes are implemented, verified with deterministic tests plus the Stage 3 real-provider harness, and documented. Stage 4 added 5×5, 6×6, and 7×7, per-event E2E coverage, event validation in storage/backup/sync, and WCA rule verification. The 2026-10-27 remediation removed the 100-entry conflict cap loss, surfaced remote-snapshot disagreements for manual review, and replaced per-device file overwrites with unique immutable snapshots. Stage 0 aligned the documentation; Stage 1 added a legacy-file conditional write, review audit/undo, legacy-tombstone recovery review, exit-sync hardening, and repair. Stage 2 added a configurable snapshot retention policy, per-device ownership metadata and management UI, selective deletion, and manual cleanup. Stage 3 ran the real-provider multi-device gate against a Google Drive test account on 2026-10-28. The OAuth publishing/branding item is the remaining Stage 3 gap: the project is owned by another account and the app is still in Testing, so non-test sign-in was not validated. Convergence remains eventual and there is no cross-file transaction.
**2026-10-26 audit remediation:** Complete and verified — all high, medium, and low findings from the retired 2026-10-26 audit are fixed. Durable Undo now uses synchronized `restoredAt` tombstone revocations; device identity is stable and cached; remote envelopes/imports reject malformed or mixed-event data; OAuth requests only `drive.appdata`; session inspection overrides can be cleared; custom-average typing is draft-based; disconnecting Drive disables automatic sync; and inspection warnings remain visual on every channel. Regression and Playwright coverage was added. Verification on Node v22.23.2: typecheck, lint, **283/283 unit tests** in 21 files, production build (95 modules; PWA 22 entries, 2284.38 KiB), **29/29 Playwright tests**, and `git diff --check` all passed. This is the 2026-10-26 record; the current verified state is 337/337 unit tests after the 2026-10-28 Stage 3 real-provider validation. `npm run check` passed as one command at Stage 0, after Stage 1, after Stage 2, and after Stage 3. The completed per-finding tracker and original audit report were retired during the 2026-10-28 documentation cleanup; this paragraph and the sync-hardening sections below retain the outcome. See [`NEXT_SESSION_HANDOFF.md`](NEXT_SESSION_HANDOFF.md).

**Roadmap:** See [`ROADMAP.md`](ROADMAP.md) for planned phases and acceptance gates.

**Active documentation:** [`README.md`](README.md) for product behavior,
[`ROADMAP.md`](ROADMAP.md) for phase gates, [`PATCH_LIMITATIONS.md`](PATCH_LIMITATIONS.md)
for known sync limits, [`Oct_28_AM_Plan.md`](Oct_28_AM_Plan.md) for the staged
plan, [`NEXT_SESSION_HANDOFF.md`](NEXT_SESSION_HANDOFF.md) for the current
handoff, and [`AGENTS.md`](AGENTS.md) for engineering rules. Completed audit
trackers and superseded design briefs are intentionally not retained.

## Scope delivered

CubeLab Milestone 1 is a flat, csTimer-inspired, offline-first 3×3 speedcubing
timer built with React, TypeScript, Vite, `cubing.js`, and custom responsive CSS.
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

- Flat light interface organized like a familiar speedcubing timer: a session
  switcher, session statistics, and solve history in the left rail; scramble
  across the timer area; and an oversized central clock with quick ao5/ao12
  values beneath it.
- Monotonic timer using `performance.now()`, launched by a configurable hold
  (300 ms default) and stopped by a single press or tap.
- Global <kbd>Space</kbd> control with OS key-repeat suppression and page-scroll
  prevention. Focused buttons and switches remain keyboard-operable with Enter.
- Pointer controls on the timer surface for mouse, pen, and touch input.
- Official WCA random-state scrambles for 3×3, 2×2, 4×4, 3×3 OH, 5×5, 6×6,
  and 7×7 generated by `cubing.js`, with a prefetched next scramble and explicit
  loading, failure, and retry states.
- Optional WCA inspection with 15-second / 17-second boundaries and automatic
  `+2` or DNF penalty at solve start. The display can count down or count up,
  with independent optional **8 seconds** and **12 seconds** warnings that follow
  the displayed direction.
- Optional visual, sound, haptic, or combined feedback for completed solves and
  DNFs, with adjustable alert volume (70% default). The DNF/danger tone uses a
  1.5× gain capped at 0.75, so it is louder than solve feedback without changing
  the volume control.
- Four accent colors with WCAG AA contrast, applied to controls and the timer
  surface.
- csTimer-inspired Settings dialog with Timer, Alerts, Display, Appearance,
  Statistics, Scramble, Controls, Data, and About sections. It centralizes
  inspection direction and warnings, feedback, accent, statistic visibility,
  custom averages, precision, scramble presentation, keyboard reference,
  local-storage status, and backup/restore access.
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
- Installable PWA that works fully offline after the first visit, including
  scramble generation.
- No CubeLab backend, account, analytics, or telemetry. Optional Google Drive
  synchronization stores a device-owned versioned snapshot in the user's own
  Drive app-data folder (`cubelab-backup-<device-id>-<uuid>.json`), merges every
  CubeLab snapshot on each run, and starts only after an explicit connection.
  The legacy `cubelab-backup.json` file remains readable and is removed by
  **Delete remote backups**.

### Engineering

- Pure timer state machine separated from the React adapter.
- Input events are timestamped; the machine owns all timing transitions.
- The timer hook keeps an authoritative state ref to make double-recording
  impossible across repeated or same-frame events.
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
  solve values. Settings field metadata lives in the sync runtime so the settings
  schema remains `v6`.
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

Run on 2026-10-28 after Stage 4 / Phase 3 completion. Node v22.23.2:

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | Passed |
| Lint | `npm run lint` | Passed with no warnings |
| Unit tests | `npm test` | **339/339 passed**, 22 test files |
| Production build | `npm run build` | Passed; 96 modules transformed |
| PWA generation | included in build | 22 precache entries, **2,311.53 KiB** |
| Production E2E | `npm run test:e2e` | **44/44 passed**, Chromium |
| Combined chain | `npm run check` | **Passed as one command**, exit 0 |
| Real-provider harness | `npm run validate:drive` (opt-in, real account) | **7/7 passed** in the final Stage 3 run; not part of `npm run check` |
| Whitespace | `git diff --check` | Passed with no errors |
| Layout coverage | production E2E at 320, 390, and desktop widths | Every event at desktop and 390 px mobile now records, penalizes, and reloads solves; 320 px Settings/session/solve-menu targets, Drive copy, remote snapshot ownership/cleanup, review history/Undo, Repair, paginated conflicts, session dialogs, duplicate-name review, and focus handling remain covered |

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
- The v6 settings schema stores presentation and interaction preferences as
  typed fields with documented defaults. Unknown or corrupt values fall back
  field-by-field, while v1–v5 records upgrade automatically. Sessions use schema
  v4 with optional per-session preferences, inspection overrides, solve comments,
  and field-level merge metadata. Global settings field timestamps live in
  `cubelab:sync:v1`, keeping the settings schema unchanged.
- Interface zoom uses CSS `zoom` with a reciprocal viewport width/height and a
  scale-adjusted dialog cap. This keeps the app filling the viewport at reduced
  zoom without introducing blank scroll space or horizontal overflow.
- Effective-time annotations in history wrap onto a second metadata line when
  the rail is narrow; they must never be ellipsized or clipped.
- New timer settings can only affect interaction behavior. WCA timing and
  statistics rules remain fixed.
- Solve/DNF feedback is opt-in and uses the configured channel. Inspection
  warnings, when enabled, always show their direction-aware text (12/8 seconds
  remaining when counting down, 8/12 seconds when counting up) regardless of that
  channel; sound and haptic still follow it. Web Audio is
  primed on timer press so a timer-driven warning is not blocked by autoplay
  policy. The DNF/danger tone applies a 1.5× gain capped at 0.75; solve and
  warning tones keep the normal volume gain. Statistics precision changes only
  formatting, never the stored raw time or calculated result.
- History rows are buttons with `aria-haspopup="menu"` and `aria-expanded`. The
  floating menu is rendered in a portal, positioned near the row and clamped to
  the viewport. It supports keyboard focus, Escape dismissal, and outside-click
  dismissal. Inline penalty/delete buttons were removed from history rows.
- Solve comments are plain text, limited to 500 characters, and stored on the
  solve record. They never affect timing or statistics.
- The palette is flat light gray and white with a pale accent-tinted timer
  surface. The accent can be green, blue, violet, or amber; each choice meets
  WCAG AA contrast against white and its soft background. Penalties use amber and
  red.
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
- Import is replace-only. It validates the file, then shows current and incoming
  session/solve counts before applying anything. Cancelling leaves local data
  untouched. Merging lives in the separate Google Drive synchronization path and
  never changes the replace-only local-file import contract.
- The backup file format is versioned (`cubelab-backup`, version 1) and capped at
  10 MB. Invalid JSON, wrong markers, unsupported versions, empty sessions, and
  invalid settings are rejected before confirmation.

### Timer and inspection

- Hold threshold: 300 ms by default; configurable from 0–10,000 ms in Settings.
- Inspection penalty thresholds: `> 15,000 ms` gives `+2`;
  `> 17,000 ms` gives DNF. The penalty is captured when the solve starts.
- Inspection displays a countdown from 15 to 0 by default, or a count-up from 0
  to 17. The 8-second and 12-second warnings are independent; count-up warns at
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
- Every trimmed average removes exactly one best and one worst effective result.
- One DNF in a trimmed average is treated as the worst result and removed; two or
  more DNFs make the average a DNF.
- Best values scan every valid window and never report a DNF as a personal best.
  Large averages use a Fenwick-tree sliding-window pass rather than sorting each
  window.
- Means are rounded to the nearest hundredth (10 ms).

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

Settings are stored at schema version 6. Loading accepts versions 1–6, upgrades
older records with defaults, and validates each new field independently. A
record without `inspectionEnabled` is rejected as invalid, matching the original
settings contract. The v6 records add the optional any-key stop preference.
Global settings field timestamps are stored in `cubelab:sync:v1` so the settings
schema stays backward compatible.

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

- Sessions support 3×3, 2×2, 4×4, 3×3 OH, 5×5, 6×6, and 7×7 and generate
  scrambles through `cubing.js`. The 15-second inspection, `+2`, DNF, and
  effective-time rules are shared by every event; competition-specific time
  limits and cutoffs are deliberately not implemented because they are set per
  competition. Dedicated desktop/mobile production E2E coverage exists for all
  seven events.
- Appearance currently offers accent colors rather than a full dark theme.
  Adding a theme would require a broader palette audit and contrast tests.
- Sound and haptic alerts depend on browser/device support. The visual feedback
  and live-region announcement remain available when those channels are absent.
- JSON import remains replace-only. Google Drive synchronization adds merge,
  tombstones, redirects, and conflict handling, but there is no general-purpose
  local-file merge path.
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
- Active-session selection is not field-merged. A device keeps its local active
  session when it still exists; concurrent selection changes are not reviewed.
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
- In-flight local-edit guards compare React object identity. The application
  state is treated as immutable; an accidental in-place mutation would bypass the
  guard.
- Multiple open tabs are not synchronized with each other. Each tab holds its own
  in-memory state and writes it independently, so the last write wins. Google
  Drive sync does not change this; use one tab when changing sessions or
  importing a backup.
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
- The history list still renders every row. A 2,000-solve session loads and
  scrolls smoothly, but the Phase 1 profile showed penalty toggles at roughly
  0.2–0.3 s and delete/undo in the same range. The Phase 2A.3 row menu was not
  separately profiled. Virtualization should be added if sessions grow
  substantially beyond that size.
- Automated browser testing uses Chromium only. WebKit and Firefox were not
  available in this environment; a physical iOS/Android device was not tested.
- The mobile E2E flow exercises pointer events in a mobile viewport. It does not
  emulate platform-specific touch scrolling/pinch behavior.
- No formal screen-reader audit has been completed, though semantic labels, live
  regions, dialog focus handling, and keyboard controls are implemented.
- First launch requires network access to install the service worker. Later
  launches are offline-capable.
- The production bundle intentionally includes a large `cubing.js` chunk; no
  attempt was made to reimplement or trim its random-state solver.

None of these limitations block the Milestone 1, Phase 2A, or Phase 2A.3
acceptance criteria.

## Milestone status

### Milestone 1 — Complete

All requested Milestone 1 functionality is implemented and verified:

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

**Completion estimate: 100% of Milestone 1 scope.**

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
redirect rollback, and active-session field merging remain unimplemented. The
OAuth app is still in Testing under another owner account, so non-test sign-in
is unverified. Snapshot cleanup is best effort; a repeat delete of an
already-removed file hit one transient `ECONNRESET` that did not reproduce. The
remaining gaps are listed in [`PATCH_LIMITATIONS.md`](PATCH_LIMITATIONS.md); do
not describe Phase 2C as data-loss-proof.

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

## Handoff

### Safe next work

- Phase 2B and Phase 2C are implemented. Do not add telemetry, non-Google cloud
  providers, or a different sync protocol without an explicit brief.
- Stage 3 real-provider validation is complete for concurrency, convergence,
  conditional write, and retention. The remaining Stage 3 item is owned by the
  Google Cloud project owner: publish the OAuth app out of Testing (and complete
  any Google verification), then validate sign-in with a non-test account. The
  legacy file has a provider conditional write, but there is no cross-file
  transaction. Next, address redirect consensus and field-level active-session
  merging. Preserve the known-solve snapshot on new session tombstones and extend
  the Drive transport, metadata store, and failure-path tests together.
- If more timer preferences are requested, extend the Settings dialog and the
  versioned settings schema together, with migration and E2E coverage. Do not
  duplicate the inspection control back into the header.
- If a full dark theme is requested, audit every surface/text pair and add
  contrast tests before extending the accent-only appearance setting.
- **Approval note (2026-10-28):** Stage 4 (Phase 3 completion) is complete and
  Stage 5 (Phase 4 platform work) is explicitly approved and not started. See
  `ROADMAP.md` for the acceptance gates and `Oct_28_AM_Plan.md` for the stage
  breakdown. Stage 5 includes virtualization, cross-browser coverage, and the
  accessibility audit.
- Phase 3 is complete: all seven events have `cubing.js` random-state scrambles,
  event-compatible storage/backup/sync validation, desktop/mobile production E2E,
  and shared WCA inspection/penalty rules. Do not add further WCA events without
  an explicit scope change.
- Add WebKit/Firefox browser coverage if those engines become available.
- Profile and virtualize history for extremely large local sessions.
- Run a formal accessibility and physical-device touch audit.

### Before changing anything

1. Read `README.md` and `AGENTS.md`.
2. Preserve the pure timer machine and WCA statistics semantics.
3. Preserve the session and backup invariants: at least one session, unique
   names, locked controls during timing, typed clear/delete confirmations, and
   validated replace-only import.
4. Keep Settings as the single home for global inspection, statistics, and data
   controls; per-session inspection/clear/delete stay in the session gear. Do not
   reintroduce a header inspection toggle or an inline History clear/delete
   control.
5. Preserve the floating solve menu, persisted comments, and Space reservation
   for the timer.
6. Re-run `npm run check` after logic or build changes.
7. Re-run the offline E2E test after any Vite, PWA, dependency, or asset change.
8. Update this file with fresh evidence whenever status changes.

## Git status

Milestone 1 through Phase 3, the 2026-10-25 hardening follow-ups, the
2026-10-27 immutable-snapshot remediation, and the 2026-10-28 Stage 1–4 work
are implemented and verified. Stage 0 aligned the documentation and
committed the remediation; Stage 1 added the legacy-file conditional write,
review audit/undo, legacy-tombstone review, exit-sync hardening, and repair.
Stage 2 added bounded snapshot retention, ownership display, selective deletion,
and manual cleanup. Stage 3 validated the real Google Drive provider and closed
all but OAuth publishing. Stage 4 completed Phase 3 with 5×5, 6×6, and 7×7,
per-event desktop/mobile E2E, and the shared WCA rule audit.
The documentation set was consolidated at the same time: completed audit
trackers, the original audit report, and the superseded Phase 2B design brief
were removed. The work includes unique immutable Drive snapshots, sessions
schema v4 field metadata, field-level session/settings merging, broad conflict
review with an uncapped paginated queue, timer-safe scheduling, recovery
hardening, and sync stress coverage. The roadmap is tracked separately in
`ROADMAP.md`. Inspect the real repository state with:

```bash
git status --short
git log --oneline -2
```
