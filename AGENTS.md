# AGENTS.md

Instructions for any future coding agent, contributor, or reviewer working in
this repository.

## Read first

Before changing code, read:

1. `PROJECT_PROGRESS.md` — current milestone status, verification evidence, and
   handoff notes.
2. `README.md` — product behavior, controls, statistics rules, and architecture.
3. The relevant source and tests for the area you are changing.

Update both documents when behavior, commands, architecture, or milestone status
changes. Never report a milestone complete without recording fresh verification
evidence in `PROJECT_PROGRESS.md`.

## Scope

This repository contains **CubeLab Milestone 1** plus the authorized **Phase 2A**
local-data work:

- 3×3 speedcubing timer
- WCA random-state scrambles via `cubing.js`
- optional 15-second inspection with count-down/count-up display, independent
  8-second/12-second warnings, and `+2` / DNF
- single, mo3, ao5, ao12, ao25, ao100, ao200, ao500, ao1000, ao5000, and
  ao10000 statistics plus up to five custom averages
- local solve history with persisted comments and a floating action menu
- multiple named local sessions with create/switch/rename/delete and per-session
  inspection, clear, and delete settings
- typed destructive confirmations for clearing or deleting a session
- JSON export/import of all sessions, comments, and settings
- automatic migration from the original single-session storage key
- optional local-first Google Drive synchronization with unique immutable
  snapshots, field-level session/settings merging, conflict review, tombstones,
  and recovery
- a Settings dialog centralizing inspection direction and warnings, alerts,
  accent color, statistics display and custom averages, scramble presentation,
  controls reference, local data, Drive synchronization, and backup/restore access
- offline-capable PWA
- responsive, accessible UI

Phase 2A, the Phase 2A.1 Settings design update, Phase 2A.2 settings groups,
Phase 2A.3 timer/history/session refinements, Phase 2B optional manual Google
Drive backup, and Phase 2C local-first Google Drive synchronization are
complete. Phase 3 (More WCA events) and Phase 4 (Performance, accessibility,
and platform) are explicitly approved as of 2026-10-28 (Stage 4 and Stage 5 in
`Oct_28_AM_Plan.md`); their scope and acceptance gates are defined in
`ROADMAP.md`. Do not begin any other cloud/account feature or broaden to
social features as drive-by additions without an explicit user instruction.

## Commands

```bash
npm run dev         # Vite development server
npm run typecheck   # strict TypeScript
npm run lint        # Oxlint
npm test            # Vitest; currently runs all unit/component tests
npm run build       # production build + PWA
npm run test:e2e    # Playwright against the production preview
npm run check       # typecheck + lint + unit + build + production e2e
```

`npm run test:e2e` builds the app and starts `vite preview` on
`http://127.0.0.1:4173` unless an existing server is reused. The suite requires
the production build because it tests the service worker and offline reload.

## Engineering invariants

- **Timer logic stays pure.** Timing transitions and inspection penalties live in
  `src/timer/machine.ts` as timestamped events. Do not move timing calculations
  into presentation components.
- **One solve, one record.** `useTimer` keeps an authoritative state ref so
  repeated or same-frame events cannot record twice. Preserve this guarantee.
- **Monotonic time only.** Use `performance.now()` for elapsed time. Never derive
  solve duration from wall-clock `Date` values.
- **Space belongs to the timer.** Global Space must remain reserved for
  arm/start/stop and suppressed from page scrolling. It may be left to
  text-entry fields only. Focused buttons, switches, and the session select must
  remain usable with Enter and arrow keys. Do not let a focused session select
  swallow Space.
- **Settings are centralized.** The header Settings button opens the Settings
  dialog. Inspection direction and warnings, alerts, accent color, statistics
  display and custom averages, scramble presentation, the controls reference,
  local-data status, and backup/restore access live there. Per-session
  inspection overrides, clear, and delete live in the session-settings gear, not
  in the header or History panel. Settings opens only while the timer is idle and
  blocks timing while open. Do not reintroduce a header inspection toggle or an
  inline History clear/delete control.
- **Settings persistence is versioned.** `v1`–`v5` settings records migrate to
  `v6` with documented defaults and field-level corruption recovery.
  `parseSettingsData` accepts only valid fields, rejects records without
  `inspectionEnabled`, and upgrades older backups during import. Alerts,
  appearance, and statistics preferences must not alter raw times or WCA
  calculations. Enabled inspection warnings always show their direction-aware
  visual pulse and live-region announcement; sound and haptic follow the
  configured feedback channel. Settings may also
  enable `stopWithAnyKey` for stopping a running timer with any non-modifier key.
  Settings may also choose whether inspection-warning color pulses use the timer
  surface or the entire screen.
- **Do not hand-roll scrambles.** Use `cubing.js` `randomScrambleForEvent('333')`.
  Unit tests verify real random-state generation.
- **Statistics follow WCA semantics.** Averages are newest-first; every trimmed
  average removes one best and one worst; one DNF is trimmed as worst; two or
  more DNFs make the average a DNF. mo3 contains no trimmed result and any DNF
  makes it a DNF. Effective `+2` adds 2 seconds. Built-in sizes and custom
  averages share the same calculation and validation rules. Update
  `src/lib/stats.test.ts` and `src/lib/statDefinitions.test.ts` for any change.
- **Sessions are local and explicit.** Session names are trimmed, limited to 40
  characters, and unique case-insensitively. At least one session must always
  exist. Session controls, the session gear, and Settings are disabled while the
  timer is armed, running, or in inspection. Clearing requires typing
  `CLEAR THIS SESSION`; deleting requires `DELETE THIS SESSION`. A per-session
  inspection override takes precedence over the global setting; sessions without
  one follow the global value.
- **Solve history actions.** Each row has inline `+2` and `DNF` controls and opens
  a floating menu for delete/undo, copy actions, and comments. Do not reintroduce
  inline delete or a History clear action. Comments are plain text, limited to
  500 characters, persist on the solve, and never affect timing or statistics.
  Space remains timer input even while a row or menu action is focused; only
  text-entry fields may consume it.
- **Inspection warnings** follow the displayed direction. Count-up labels use 8
  and 12 seconds elapsed; count-down now warns at 7 and 3 seconds remaining,
  matching 8 and 12 seconds elapsed. Visual, sound, haptic, and visual-plus-sound
  channels remain configurable. The warning can pulse the timer surface or the
  entire screen per the Alerts setting, and visual alert text no longer overlaps
  the timer.
- **Persistence is versioned.** Keys are `cubelab:sessions:v1` (active session,
  all named sessions, solves, comments, and optional field metadata),
  `cubelab:settings:v1`, `cubelab:drive:v1` (optional connection metadata), and
  `cubelab:sync:v1` (synchronization preferences/runtime metadata). Sessions use
  schema `v4`; settings use schema `v6`. Session field metadata lives in
  `Session.fieldUpdates`; global settings metadata lives in
  `cubelab:sync:v1`. The original `cubelab:solves:v1` key is read only for
  migration into **Session 1**. Validate and recover from corrupt records; never
  silently discard a valid session. Any schema change needs a migration and
  tests.
- **Backups replace only after confirmation.** Export every session, solve, and
  setting as a versioned JSON file. Import must validate the app marker, format
  version, sessions, solves, and settings, then show current/incoming counts and
  require explicit confirmation. Invalid files must not mutate local data.
  Reject mixed-event sessions and malformed sync envelopes as a whole before
  confirmation. Local backup/import stays entirely local. Keep the 10 MB import
  cap unless large-backup behavior is deliberately designed and tested.
- **Undo is durable and synchronized.** Solve undo retains the tombstone and
  records `restoredAt`; do not delete the tombstone locally. A later deletion
  with a newer timestamp wins, and equal times favour deletion. Every device
  must merge the revocation record so an already-published deletion cannot
  remove the solve again.
- **Drive sync is device-owned and all-snapshot.** Google Identity Services OAuth
  and the `drive.appdata` scope are allowed only after explicit connection. Do
  not request email, profile, `openid`, or userinfo scopes. Disconnecting Drive
  disables automatic synchronization; reconnecting re-enables it explicitly.
  Each browser writes a new immutable snapshot named
  `cubelab-backup-<sanitized-deviceId>-<uuid>.json`; `uploadDeviceBackup` never
  accepts an existing file ID and never overwrites a file. Every sync follows
  every file-list page, validates, and merges all CubeLab snapshots. A failed
  page, malformed/repeated token, or `incompleteSearch` must stop synchronization
  instead of returning a partial list. The legacy `cubelab-backup.json` file
  remains readable and is included in delete-all, as are legacy per-device names.
  Never fall back to another device's `remoteFileId`. Deleting remote backups
  removes every CubeLab snapshot and must surface partial failures. Same-origin
  automatic and manual writes must share the Web Lock. Per-device transports do
  not re-list or recheck before writing because their snapshots are immutable;
  the optimistic changed-file recheck remains only for the legacy fixed-name
  transport, whose file is still mutable. Because Drive v3 does not expose an
  ETag, the legacy file is read through Drive v2 metadata and replaced only with
  a v2 media `PUT` carrying `If-Match`. A 412 or a missing ETag must fail the
  write instead of overwriting. That is a conditional update for one file, not a
  transaction across files. Do not claim atomic remote writes.
- **Snapshot cleanup is bounded and non-destructive.** New snapshots record the
  owning device in `appProperties.deviceId`; older files group by their sanitized
  name prefix. Automatic cleanup runs only after a successful all-snapshot merge
  and publication. It keeps the newest snapshot of every device group, never
  removes the just-published snapshot, and never removes the legacy mutable
  `cubelab-backup.json`. Files beyond the per-device count (default 10) or age
  (default 30 days) thresholds are superseded; one threshold is enough to select
  them. Manual cleanup is restricted to this device's own superseded snapshots.
  Deleting a snapshot removes only its cloud copy and must report partial
  failures instead of claiming complete success. Cleanup policy lives in
  `cubelab:sync:v1`; the Drive dialog lists per-device ownership, supports
  selective deletion, and paginates each device's files.
- **Duplicate names are review-only.** Recompute duplicate session names against
  the final merged collection after every snapshot. Never merge same-named
  sessions automatically. Keep one actionable notification carrying the sync
  summary, suppress an unchanged duplicate warning on later syncs, and keep the
  persistent Drive-dialog review action while the collision remains.
- **Sync merging is field-level and exact-approval.** Session name, event,
  inspection override, each preference field, and each global setting merge by
  field timestamp with a deterministic editor-ID/value tiebreak. Equal legacy
  values must not acquire fabricated persisted metadata. Setting timestamps live
  in the sync runtime, not the settings schema. A manual conflict approval
  applies only to the exact reviewed values and field timestamps; a later edit
  must raise a new conflict. Approvals match the reviewed pair in either
  local/remote orientation because remote snapshots merge one at a time.
  Redirect approvals match by unordered source/destination pair.
- **Conflict review is complete and uncapped.** Keep pending conflicts and the
  approvals needed to finish an active merge as correctness state. Never evict
  them with a display or history cap. The queue is not capped at 100 records; it
  is deduplicated by `kind:id:field`, and the Drive dialog paginates rendering
  (5 per page plus **Show all**). Surface disagreements between remote snapshots
  even when the local value matches the automatic winner, label them `remoteOnly`,
  and present them as **Use newest cloud** / **Use other cloud**. A device that
  already holds an approval for one side of a multi-remote disagreement can still
  hide an older independent cloud approval; document that caveat rather than
  claiming consensus. Keep a local-only resolution history in `cubelab:sync:v1`
  (newest first, display cap 50, never in envelopes, backups, or remote data).
  Undo is allowed only while the stored conflict carries the exact resolution and
  `updatedAt` recorded in the audit entry; it flips the approval with a newer
  timestamp. Applied redirect merges, a legacy recovery that already restored
  solves, and superseded decisions are not reversible. **Repair sync state**
  clears only derived bookkeeping
  (`lastSyncedFingerprint`, `lastRemoteRevision`, status, error) and must preserve
  sessions, tombstones, redirects, pending conflicts, audit history, and settings
  metadata.
- **Sync recovery is ID-based.** Session tombstones record the deleting device's
  `knownSolveIds`; recovery extends an existing `recovered:<sessionId>` session
  by stable solve ID, preserves event and preferences, and uses wall-clock
  comparison only for legacy tombstones. When a pre-`knownSolveIds` tombstone has
  ambiguous orphan solves, always raise a `session`/`legacyRecovery` review, even
  when manual review is off. **Keep deleted** drops the ambiguous candidates;
  **Recover solves** restores them. New candidate IDs must raise a fresh review.
- **Sync scheduling is timer-safe and bounded.** Defer synchronization while the
  timer is armed, running, or inspecting; resume once when idle. Automatic
  retries are bounded and external triggers reset the budget. Do not start a
  download that can replace state or a network write while timing. Preserve
  in-flight fingerprint guards, redundant-upload skipping, pending-change
  status, and best-effort exit sync. Exit sync is attempted on visibility loss,
  `pagehide`, and `freeze`, deduplicated within 2 seconds; do not rely on
  `beforeunload`. Local storage remains the durability boundary. Provider CAS
  exists only for the legacy fixed-name file; there is still no cross-file
  transaction.
- **Raw data is immutable by default.** Store raw milliseconds plus a penalty
  value. Do not overwrite raw time when applying `+2`.
- **Keep the production worker isolation.** `vite.config.ts` isolates cubing
  modules into a dedicated chunk and disables module preloading. Removing either
  setting can make the cubing search worker import the React browser entry and
  fail with `document is not defined`. The offline Playwright test guards this.
- **PWA changes need offline verification.** Re-run the offline E2E test after
  changing build, asset, or service-worker configuration.
- **No backend or telemetry.** All user data stays in local storage.

## Testing expectations

For a behavior change:

- Add or update focused unit tests for pure logic. Session/name/comment/
  inspection mutations belong in `src/lib/sessions.test.ts`; storage, settings
  migration, and validation in `src/lib/storage.test.ts`; backup validation in
  `src/lib/backup.test.ts`; statistic definitions and custom-average validation
  in `src/lib/statDefinitions.test.ts`; WCA statistics in
  `src/lib/stats.test.ts`; statistic display precision in
  `src/lib/format.test.ts`.
- Synchronization changes need focused coverage in `src/lib/sync.test.ts`,
  `src/lib/sessionMetadata.test.ts`, `src/lib/settingsMerge.test.ts`,
  `src/lib/remoteBackups.test.ts`, `src/lib/snapshotRetention.test.ts`,
  `src/lib/driveTransport.test.ts`, `src/lib/driveCoordination.test.ts`,
  `src/lib/sessionRedirects.test.ts`, `src/hooks/useSync.test.ts`, and
  `src/hooks/useDriveBackup.test.ts`. Extend
  `src/lib/sync.stress.test.ts` when changing concurrency, convergence,
  per-device upload isolation, or cross-field merge behavior.
- Add or update a Playwright test for user-visible flows, including settings
  open/close and focus restoration, inspection direction/warnings and
  persistence, per-session inspection overrides, session
  create/switch/rename/delete, typed clear/delete confirmations, timer locking,
  solve-menu penalties/comments/copy/undo, export, invalid import, import
  cancellation, confirmed replacement, alert feedback and volume persistence,
  accent persistence, expanded/custom statistic visibility and precision, the
  Controls reference, and Drive connection/delete copy. Add production coverage
  when a conflict workflow becomes visible without requiring mock-only hooks.
- Test failure paths, not only the happy path.
- Keep tests deterministic. Avoid asserting exact wall-clock durations from live
  timing; use ranges or state-machine timestamps.
- Do not delete or weaken a failing test to make a run pass. Fix the behavior or
  correct an honestly wrong expectation.

Before claiming a milestone is complete, run all of:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Also inspect the interface at desktop and mobile widths. Update the screenshots
in `docs/` if the visible design changes materially.

## Documentation and Git

- Keep `README.md` user-facing and accurate.
- Keep `PROJECT_PROGRESS.md` factual: milestone percentage, scope, verification
  evidence, known limitations, and next steps.
- Keep the active documentation set small: `AGENTS.md`, `README.md`,
  `ROADMAP.md`, `PROJECT_PROGRESS.md`, `PATCH_LIMITATIONS.md`,
  `NEXT_SESSION_HANDOFF.md`, `Oct_28_AM_Plan.md`, and the screenshots referenced
  by `README.md`. Remove completed audit trackers, one-off remediation logs, and
  superseded design briefs instead of accumulating historical documentation.
- Use a focused commit message that describes the milestone or change.
- Do not commit `dist/`, `node_modules/`, Playwright output, or local secrets.
- Check `git status` before and after committing and report the real state.

When handing off, state exactly what passed, what was not tested, and what the
next milestone requires.
