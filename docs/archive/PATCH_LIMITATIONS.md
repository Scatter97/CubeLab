> **Historical snapshot — archived 2026-11-01.** This record may contain
> superseded behavior, approval milestones and verification results. For current
> work read [STATUS.md](../../STATUS.md), [AGENTS.md](../../AGENTS.md) and
> [KNOWN_LIMITATIONS.md](../../KNOWN_LIMITATIONS.md). Paths in code spans
> and command blocks retain their original repository-root context.

# CubeLab — current limitations and historical sync evidence

**Documentation updated:** 2026-11-01. Latest implementation check: 2026-11-01.

This patch substantially hardens Phase 2C, but it is deliberately **not** a claim
that every distributed-systems problem is solved. Google Drive is still an
eventually consistent remote store, not a transaction coordinator. Phase 3 and
Phase 6a event coverage is complete for 3×3, 2×2, 4×4, 3×3 OH, 5×5, 6×6, 7×7,
Pyraminx, Skewb, Square-1, Clock, and Megaminx. Further feature-phase proposals
were subsequently removed at the user's request.

## Current limits and concrete follow-up

| Area | Current boundary | Next action |
| --- | --- | --- |
| Narrow layout | Right gutter reserved only while the default panel is open; moved/resized panels and all timing/chart cases still need verification | Continue verification/adjustment; do not claim completed |
| Stop performance | First patch measured 7,000 solves, sync/audio off, isolated Firefox/Chromium | Profile actual Zen and 10,000 solves with sync on/off |
| Enabled sync | Full fingerprints and safety guards remain | Optimize only with exact pending/in-flight tests |
| Local persistence | Entire collection is serialized/written synchronously | Design incremental durability, migration, recovery and cross-tab behavior first |
| Chart/statistics | First result gets priority; refresh can still take longer | Profile completion and incremental invalidation after edits/imports |
| Provider protocol | Immutable snapshots converge eventually; no cross-file transaction | Preserve current guards; any protocol redesign needs separate scope |
| External validation | Latest patch used mock Drive; physical devices were unavailable | Arrange explicitly authorized provider tests and real hardware |
| OAuth | Non-test publishing/sign-in not verified by the latest work | Google Cloud owner action and subsequent verification |
| Imports/events | 10 MB import cap remains; 12 events are supported | Preserve the current supported scope |

Latest full check passed on November 1 after the audit regression fixes: 553 unit/component tests
in 39 files; 258 browser passes, 9 existing skips; typecheck, lint, build and
supported offline checks. Normal production output was restored. The historical
provider harness passed 7/7 on October 28; do not represent it as validation of
every subsequent patch.
The “still unresolved” protocol details below remain applicable except where
an explicitly dated later remediation says otherwise.

The stop patch delays presentation only: storage, the final readout, sync refs,
tombstone detection and scheduling use current data. Disabled-sync deletion
tracking is deliberately retained. Input-event comparisons are not physical
contact measurements; Zen extensions/privacy settings and device latency were
not characterized. See [NEXT_SESSION_HANDOFF.md](NEXT_SESSION_HANDOFF.md) for
step-by-step entry points and acceptance checks.

## 2026-11-01 audit regression fixes

- Active-session approvals now match the reviewed value/timestamp pairs in either
  merge orientation, accept the narrow already-applied/Undo stamps, and reject
  stale decisions after later edits. The chosen value and metadata use one stable
  timestamp/editor-ID/value order. Invalid selected IDs fall back without borrowing
  provenance from a missing session; metadata-free legacy selection stays local-first.
- Sync-envelope parsing retains validated selection metadata. Applying the merged
  cloud choice does not restamp it as a new local edit. Pure and hook tests cover
  both choices, repeated sync, stale decisions, Undo, reversed inputs and publication;
  production browser coverage verifies review completes and stays resolved.
- Preview and import share csTimer validation. Malformed rows, missing/negative/
  nonfinite durations, empty scrambles and invalid provided dates in supported
  sessions reject the file before confirmation, naming the session/solve. Missing
  dates retain the established fallback. Unknown-puzzle sessions are still skipped
  with a warning. Valid zero/fractional values, penalties, comments and dates survive
  storage/export/reload; imports remain additive and retain settings and existing history.
- Fresh full verification: 553 unit/component tests in 39 files; 258 browser
  passes and 9 unchanged skips (267 total); typecheck/lint/build passed.
  Normal production output was restored. No live Drive or physical-device run was
  performed; the provider and performance limitations below remain.

## 2026-10-26 audit remediation

- Solve Undo is durable: tombstones keep a synchronized `restoredAt` revocation.
  Older clients that do not understand `restoredAt` may still hide a restored
  solve, so update every CubeLab build sharing a Drive account together.
- Device identity is persisted on first sync-storage load and cached in memory.
- Remote sync envelopes and local imports reject malformed entries, malformed
  metadata, and mixed-event sessions as a whole before mutation.
- OAuth requests only `drive.appdata` and makes no userinfo request.
- Disconnecting Drive disables automatic synchronization; reconnecting enables
  it again through the explicit connection flow.
- Inspection overrides can be cleared back to the global setting with removal
  provenance retained for merging. Custom-average inputs commit drafts on
  blur/Enter, and inspection warnings remain visual on every feedback channel.

## Addressed

### Device-owned remote snapshots

- Each browser writes a **new immutable snapshot** named
  `cubelab-backup-<device-id>-<uuid>.json` to its app-data folder. A write never
  overwrites an existing file, so simultaneous writers — including two devices or
  two profiles sharing a device identity — cannot replace one another's snapshot.
  `uploadDeviceBackup` no longer accepts an `existingFileId`.
- Every sync lists, validates, downloads, and merges **all** CubeLab snapshots.
  The legacy fixed-name `cubelab-backup.json` and legacy per-device file names
  remain readable for upgrades and are included in manual restore and delete-all
  operations.
- File discovery now follows every `nextPageToken` page and requests the token
  fields explicitly. A failed page, malformed/repeated token, or
  `incompleteSearch` stops synchronization instead of returning a partial list
  that could miss another device's snapshot.
- Manual backup creates another immutable snapshot owned by this device; it never
  overwrites or adopts another device's file.
- **Delete remote backups** removes every CubeLab snapshot, including legacy
  files, and reports partial failures instead of claiming success. Superseded
  snapshots are bounded by the retention policy described under Stage 2 below.

### Same-device write coordination

- Automatic sync and manual backup share a Web Lock so same-origin writes do not
  interleave.
- Per-device transports no longer re-list or recheck before writing: their
  uniquely named snapshots are immutable, so a concurrent writer cannot be
  overwritten. The optimistic changed-file recheck remains only for the legacy
  fixed-name transport, whose single file is still mutable.
- The lock is best effort, not a remote transaction. The legacy mutable file
  additionally uses a Drive v2 ETag/`If-Match` conditional update; immutable
  snapshots are create-only. There is still no transaction across the snapshot
  set, local state remains replaceable, and convergence is eventual.

### Duplicate-name review

- Duplicate session names are recomputed against the final merged collection
  after every snapshot, not only against one snapshot. A collision found in an
  adopted or later snapshot is therefore not lost.
- The actionable toast carries the full sync summary in one message, so a second
  plain status toast cannot replace the **Review Merge** action. Repeated syncs
  suppress an unchanged duplicate notification.
- The Drive dialog also keeps a persistent duplicate-name notice and **Review
  merge** action while the collision remains.

### Field-level session and settings merging

- Sessions schema `v4` adds optional per-field metadata for name, event,
  inspection override, and each session preference. Sessions `v1`–`v4` load
  with field-level recovery.
- Global settings keep field metadata in `cubelab:sync:v1`; the settings schema
  (`v7` after the theme addition) stays a plain preference record. First-sync
  merging preserves a device's customized settings and establishes a baseline so
  another device cannot replace them just because it has metadata first.
- Independent edits to a solve's time, penalty, scramble, or comment; a session's
  name, event, inspection, or preferences; or a global setting merge by field.
  Newest timestamp wins, with a stable editor-ID/value tiebreak.
- Equal legacy fields do not acquire fabricated persisted field timestamps.
  Explicit metadata is carried forward when one side already has it.

### Broader conflict review

- Manual conflict review now covers solve fields, session name/event/inspection/
  preferences, global settings, and redirect destination conflicts.
- Pending conflicts pause publication. The Drive dialog labels the conflict kind
  and fields, shows both reviewed values, and offers **Use this device** /
  **Use cloud**.
- An approval applies only while both sides still hold the exact reviewed values
  and timestamps. A later edit raises a fresh conflict.
- Redirect approvals are matched by source/destination pair so applying the
  winner does not immediately manufacture a duplicate approval.

### Scheduling and status

- Synchronization is deferred while the timer is armed, running, or inspecting
  and resumes once when the timer becomes idle.
- Automatic retries have a bounded budget. External triggers reset the budget;
  exhausted retries surface an explicit paused status instead of spinning.
- Startup resumes a sync that was persisted as `syncing`. Exit sync is attempted
  on visibility loss, `pagehide`, and `freeze`, with duplicate lifecycle events
  collapsed over a 2-second window. `beforeunload` is not used because it does
  not reliably await asynchronous network work.
- Fingerprints detect local edits during download and upload, skip redundant
  uploads when the confirmed remote and local state are unchanged, and report
  unsynchronized changes and pending conflicts in the status line.

### Recovery and deletion

- Session tombstones record the deleting device's known solve IDs. Unknown
  offline solves are recovered into `recovered:<sessionId>` even under clock
  skew; repeated devices extend that session by stable solve ID.
- Event compatibility, existing recovered preferences, and inspection overrides
  are preserved. Explicit later deletion of the recovered session wins.
- Removal counts count unique tombstoned solves, regardless of how many
  snapshots carried the tombstone.

## 2026-10-27 synchronization remediation (review fixes)

### Conflict queue correctness
- The `mergeConflictRecords` correctness state is no longer truncated to the
  last 100 records. Pending conflicts and the approvals needed to finish an
  active merge cannot be evicted by a display or history cap; records are
  deduplicated by `kind:id:field`, so stored growth is bounded by the number of
  distinct fields that have ever diverged (not by the number of sync runs).
- Rendering in `DriveBackupDialog` pages its conflict list (5 per page, with a
  "Show all" action) so DOM stays bounded without losing correctness state.
- Fixes: `src/hooks/useSync.ts::mergeConflictRecords`, the final publish
  persist, and `src/components/DriveBackupDialog.tsx`.
- Mixed pending/resolved persistence across reload and later edits that
  invalidate an approval remain covered by deterministic unit and hook tests.
- Residual growth: all historical resolved conflict records remain stored
  (storage is bounded by distinct diverged fields; see below).

### Manual review of disagreements between remote snapshots
- Settings aggregation now folds remote snapshots with review enabled and the
  local conflict set, so a disagreement between two remote devices is raised
  even when this device's value already matches the automatic winner.
  Aggregation conflicts are marked `remoteOnly` so the UI labels them as
  cloud-version choices.
- Redirects with no local approval also surface pairwise remote disagreements
  (`findRemoteRedirectDisagreements`) while same-destination superseded history
  does not manufacture a conflict.
- Approvals are matched by unordered destination pair and anchored to the
  reviewed values, so repeated runs stay idempotent and a later distinct
  destination raises a fresh conflict.
- Fix: `src/lib/sessionRedirects.ts::findRemoteRedirectDisagreements`,
  `src/lib/sync.ts::resolveRedirectConflicts`, and `src/hooks/useSync.ts`
  settings aggregation.
- Honest limitation: when a device already has an approval for one side of a
  multi-remote disagreement, the normalizer's newest-approval rule can hide an
  older independent cloud approval until that device's newer approval is absent.

### Shared-device-ID writers
- Each write now creates a fresh immutable snapshot with a unique name
  (`cubelab-backup-<device-id>-<uuid>.json`) instead of overwriting a device's
  previous file. `uploadDeviceBackup` never overwrites by ID or name, so two
  writers sharing a device ID (including copied browser profiles) cannot destroy
  each other's snapshot. Every file returned by the complete listing is
  merged; Drive listings may lag, so convergence can require later runs. Web Locks still serialize same-origin writes; failures do not
  replace newer local state.
- Discovery, merge, restore, and delete-all continue to cover every snapshot,
  legacy per-device names, and `cubelab-backup.json`; removed tombstone removal
  is unchanged.
- Redundant-upload skipping still triggers on unchanged merged fingerprints and
  recent remote revisions; immutable names eliminate the avoidable overwrite race
  and make the pre-write optimistic recheck unnecessary for per-device
  transports.
- Residual limits: each change round still adds one snapshot per device until
  cleanup runs. Cleanup is best effort, has no cross-file transaction, and can
  leave files behind after a partial failure. There is no server-side ordering.
  Real-provider concurrent publishing and convergence were validated on
  2026-10-28 with two independent transports, not two physical browsers or
  machines.

## 2026-10-28 Stage 1 hardening

### Legacy mutable-file conditional write

- Google Drive v3 does not expose ETags. The legacy mutable
  `cubelab-backup.json` is listed through v3 and its ETag is read through Drive
  v2 metadata. Replacement uses a v2 media `PUT` with `If-Match`.
- A pre-write ETag mismatch and a provider HTTP 412 raise
  `DrivePreconditionError`; automatic sync treats the write as `remote-changed`
  and re-merges, while manual backup reports a retryable conflict. A missing ETag
  fails closed instead of falling back to an unconditional overwrite.
- Immutable per-device snapshots are create-only and do not need a precondition.
  There is still no conditional write across the snapshot set.
- Covered by `driveTransport.test.ts` (success, stale ETag, HTTP 412, missing
  ETag, in-memory conditional writes) and hook/UI tests. **Validated against a
  real Google Drive account on 2026-10-28:** a stale ETag failed, the current
  ETag replaced the legacy file, and the test file was removed. The harness run
  and its transient `ECONNRESET` caveat are recorded in `PROJECT_PROGRESS.md`.

### Conflict-resolution audit and undo

- `ConflictAuditEntry` records each manual decision in `cubelab:sync:v1`, newest
  first, capped at 50 display/history entries. The audit is local-only and is
  never included in sync envelopes, remote snapshots, or JSON backups.
- The Drive dialog renders the history five at a time with **Show all** and an
  **Undo** action. Undo requires the stored conflict to still carry the exact
  recorded resolution and `updatedAt`; it flips the approval with a newer
  timestamp. Superseded decisions and applied redirect merges are refused with
  an explanatory error. A legacy recovery that restored solves cannot be
  reversed automatically because recovery adds a `(recovered)` session; a
  **Keep deleted** decision can still be changed to **Recover solves**.
- Approvals now match the reviewed local/remote pair in either orientation,
  because snapshots are merged one at a time. This prevents an approved choice
  from re-prompting when a second snapshot presents the pair reversed.

### Exit sync and recovery

- `beforeunload` was removed. Exit sync now listens for visibility loss,
  `pagehide`, and `freeze`, and collapses duplicate triggers within 2 seconds.
- Exit sync remains best effort: the browser may terminate OAuth/network work.
  Local storage is the durability boundary and a persisted `syncing` status is
  resumed on startup.
- **Repair sync state** clears only `lastSyncedFingerprint`,
  `lastRemoteRevision`, `lastSyncStatus`, and `lastError`, then triggers a fresh
  all-snapshot read when automatic synchronization is enabled. Sessions,
  tombstones, redirects, pending conflicts, audit history, and settings metadata
  are preserved. This is the documented recovery path for suspected stuck or
  partially applied syncs; it cannot repair corrupted local storage.

### Legacy tombstone and redirect review

- Ambiguous orphan solves behind a pre-`knownSolveIds` session tombstone now
  raise a mandatory `session`/`legacyRecovery` conflict even when manual review is
  disabled. **Keep deleted** drops only the ambiguous candidate set; **Recover
  solves** restores it. The review records the exact candidate IDs, so a later
  arrival raises a fresh conflict.
- The wall-clock heuristic still recovers solves that are clearly newer than the
  legacy deletion; only the remaining ambiguous set requires review.
- A local redirect approval no longer hides a disagreement between two cloud
  destinations. When the local approval matches the automatic winner, the losing
  cloud destination is still surfaced as `remoteOnly`. Redirect handling remains
  deterministic, not consensus-based, and an applied redirect merge cannot be
  undone automatically.

## 2026-10-28 Stage 2 snapshot lifecycle

### Retention policy

- Automatic cleanup runs after a successful all-snapshot merge and publication,
  never while the timer is armed, running, or inspecting. It evaluates the
  listing read before the write, so a concurrent newer write is never a deletion
  candidate.
- A snapshot is superseded when it is beyond the per-device count threshold
  (default 10; options 3/5/10/20/50) **or** older than the age threshold
  (default 30 days; options 7/30/90/180/365). The newest snapshot in every device
  group is always kept, even when it is older than the age threshold.
- Cleanup never removes the just-published snapshot or the legacy mutable
  `cubelab-backup.json`. Files without a parseable modification time are judged
  only by the count threshold.
- Manual **Clean up now** is restricted to this device's superseded snapshots.
  It does not require a fresh all-snapshot merge and therefore must not remove a
  foreign snapshot that this browser may not have merged yet.
- Deleting a snapshot removes only its cloud copy. Local sessions, solves,
  settings, tombstones, and conflict state are unchanged. A failed delete is
  reported as a partial failure; the completed sync remains successful.
- Preferences live in `cubelab:sync:v1` and default to enabled, 10 snapshots per
  device, and 30 days for records created before the policy existed. Invalid
  values fall back field by field.

### Ownership and management UI

- New snapshots write the owning device ID to `appProperties.deviceId`. The
  listing requests `size` and `appProperties` alongside the existing metadata.
  Older snapshots fall back to the sanitized `cubelab-backup-<device>-…` name
  prefix after stripping the UUID or fallback write token.
- **Settings → Data → Google Drive backup → Remote snapshots** groups files by
  device, puts this device first, and shows each file's size, modification time,
  and newest status. Each device shows five files at a time with **Show all**.
- Selective deletion asks for confirmation and names the owning device. Manual
  cleanup shows how many of this device's snapshots will be removed before
  deleting. **Refresh** re-lists the remote files.
- Delete-all remains available under Advanced settings and still removes every
  CubeLab snapshot, including the legacy file.

### Residual limits

- Cleanup is a best-effort sequence of independent deletes, not a transaction.
  A failure after some deletes leaves a partially pruned collection and is
  surfaced instead of being retried automatically.
- Drive file listings can lag recently written files. Automatic cleanup uses the
  pre-write listing and only files at or before the publication time, so a
  delayed listing entry is left for a later run rather than deleted.
- There is no server-side retention policy, background job, or cleanup across
  devices at the same time. Each device prunes its own files on its next
  successful sync; automatic cleanup may also prune other devices' superseded
  groups after merging every snapshot.
- Real Google Drive retention selection and own-only deletion were validated on
  2026-10-28 against a test account with real modification times and ownership
  metadata. Cleanup remains a best-effort sequence, not a transaction; a
  transient `ECONNRESET` on a repeated delete of an already-removed file did not
  reproduce.

## Still unresolved

- **Provider conditional writes are limited to the legacy mutable file.**
  Unique immutable snapshot names prevent a write from replacing another
  writer's file, including two tabs or profiles that share a device identity. The
  legacy fixed-name file now uses a verified Drive v2 ETag/`If-Match` update, but
  there is no transaction across the immutable snapshot set, and local state
  remains replaceable. Product copy must describe eventual convergence rather
  than atomic writes. Web Locks serialize same-origin writes but are not a remote
  transaction.
- **Duplicate review is advisory.** Collisions are detected and surfaced, but
  CubeLab never merges same-named sessions automatically. A user who dismisses
  the toast and closes the Drive dialog still has to reopen the merge action
  before the duplicate is resolved; the condition persists in sync runtime until
  then.
- **Real-provider validation is scoped.** On 2026-10-28, two independent
  transports with distinct device IDs validated concurrent immutable publishing,
  all-snapshot convergence, same-device concurrent writers, the live v2
  ETag/`If-Match` path, retention/selective deletion, and cleanup against a real
  Google Drive test account. This was one process, not two physical browsers or
  machines, and it does not create a cross-file transaction. The final run left
  the two app-created snapshots untouched and removed all seven harness files.
- **OAuth publishing is not freshly verified.** The last recorded provider run
  on October 28 reported Testing under another owner account. The current console
  state cannot be established from this repository; non-test sign-in and
  production branding have not been freshly validated. The project owner must publish the app and complete any
  verification Google requires, then retest with a non-test account.
- **Eventual convergence, not synchronous consistency.** Each device must run a
  later merge before it sees another device's newest snapshot. There is no
  server-side ordering, push notification, or read-after-write guarantee.
- **Snapshot cleanup is bounded but not transactional.** The retention policy
  keeps the newest snapshot of every device and prunes beyond the configured
  count or age thresholds. Automatic cleanup runs only after a successful
  all-snapshot merge and publication; manual cleanup is limited to this device's
  own superseded snapshots. A failed delete leaves that file in place and is
  reported. Files written by an older CubeLab build without
  `appProperties.deviceId` group by sanitized file-name prefix, so an unusual
  renamed file may appear as a separate device group rather than being pruned
  with its owner.
- **Legacy tombstone ambiguity is reviewed, not eliminated.** Tombstones without
  `knownSolveIds` still fall back to wall-clock comparison for obviously newer
  solves. The remaining ambiguous set now requires explicit review, but a user
  can still choose the wrong side, and old builds that do not know the
  `legacyRecovery` field cannot participate in that review.
- **Redirect handling is deterministic, not consensus-based.** Devices with
  different approval sets can resolve differently until they exchange the same
  set. Remote-snapshot destination disagreements are surfaced for review, but
  there is no consensus protocol, and an applied redirect merge cannot be undone
  automatically.
- **Resolution history is local, bounded, and not always reversible.** Review
  history is capped at 50 entries, is never synchronized or exported, and is lost
  if `cubelab:sync:v1` is cleared. Undo requires the exact stored conflict to
  still be current; a later edit or a cleared conflict makes the decision
  irreversible. Applied redirect merges and a legacy recovery that already
  restored solves are never automatically reversible.
- **Sync-on-exit is best effort.** Visibility loss, `pagehide`, and `freeze` are
  deduplicated before requesting a sync, but browsers may still terminate async
  OAuth and network work while closing. Local storage remains the durability
  boundary.
- **Active-session selection now has field metadata and merging.** The October
  30 remediation transports selection timestamps/editor IDs and surfaces
  disagreements under manual review. Timer-active guards still defer adoption
  so an in-flight solve is not redirected. This does not establish consensus.
- **Fingerprint callers still require immutable React state.** In-flight guards
  recompute content fingerprints, while render-time pending detection is memoized
  on state references. In-place mutation can leave that display stale. The
  32-bit FNV-1a fingerprint is not a collision-free equality proof.
- **Settings provenance depends on sync metadata.** If `cubelab:sync:v1` is
  cleared, settings fall back to the conservative first-sync/whole-field policy
  rather than recovering historical per-field timestamps.
- **Native CubeLab JSON import remains replace-only.** csTimer import adds
  sessions after preview/confirmation and retains existing settings. Neither is
  a general-purpose local-file merge by solve ID.

## Verification

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and
`npm run test:e2e` with Node 22 or newer. Use an isolated mock cloud for
concurrency scenarios. To reproduce the real-provider run, set a short-lived
`CUBELAB_DRIVE_ACCESS_TOKEN` with the `drive.appdata` scope and run
`npm run validate:drive`; set `CUBELAB_DRIVE_ALLOW_EXISTING=true` only when the
account already contains CubeLab snapshots that must be left untouched. Do not
treat this patch as a data-loss-proof synchronization protocol.

Stage 0 on 2026-10-28 ran `npm run check` as one command with Node v22.23.2.
Typecheck and lint passed, **287/287 unit tests** passed in 21 files, the
production build passed (95 modules; PWA 22 entries, 2,286.77 KiB), **29/29
Playwright tests** passed, and `git diff --check` was clean.

Stage 1 on 2026-10-28 passed `npm run check` as one command after sync
hardening: typecheck and lint passed, **308/308 unit tests** passed in 21 files,
the production build passed (95 modules; PWA 22 entries, 2,296.43 KiB), **29/29
Playwright tests** passed, and `git diff --check` was clean. The manual-conflict
E2E covers review history, Undo, and Repair. No real Google Drive multi-device or
live-provider ETag test was run at Stage 1, so that gate was partially unmet then.
Stage 3 later ran the live-provider ETag and multi-device harness on 2026-10-28;
see below.

Stage 2 on 2026-10-28 passed `npm run check` as one command after snapshot
lifecycle work: typecheck and lint passed, **332/332 unit tests** passed in 22
files, the production build passed (96 modules; PWA 22 entries, 2,309.44 KiB),
**30/30 Playwright tests** passed, and `git diff --check` was clean. New coverage
includes retention selection and partial-delete failures, policy defaults and
invalid values, hook listing/deletion/manual cleanup, automatic cleanup after
publication with disabled and failing paths, and a production E2E flow for
ownership, selective deletion, cleanup, and policy persistence. No real-provider
retention test was run at Stage 2.

Stage 3 on 2026-10-28 ran the opt-in `npm run validate:drive` harness against a
real Google Drive test account. The final run passed **7/7** scenarios in 24.86 s
with 2 baseline app snapshots, 7 files created, 7 deleted, 0 cleanup failures, and
0 remaining created files. It exercised concurrent immutable publishing,
all-snapshot convergence, same-device concurrent writers, a live ETag/`If-Match`
conditional write, retention selection, and selective deletion. A clean-account
run also passed 7/7; one earlier run passed six scenarios and hit a transient
`TypeError: fetch failed` / `ECONNRESET` after about 62 s on the repeated delete of
an already-removed file. Cleanup had already deleted all seven files and an
immediate rerun passed. OAuth used only `drive.appdata`; the consent screen was
branded **CubeLab**. The app remains in Testing under another owner account, so
non-test sign-in and production publishing were not validated.

The fresh `npm run check` after Stage 3 passed as one command: typecheck and lint
passed, **337/337 unit tests** in 22 files, production build (96 modules; PWA 22
entries, 2,311.30 KiB), **30/30 Playwright tests**, exit 0. The real-provider
harness is opt-in, needs an explicit short-lived token, and is not part of
`npm run check`.

## 2026-10-30 Phase 5 audit remediation

- **Dependency advisory (GHSA-gcqx-w48m-w2h4):** `vite-plugin-pwa@2.0.0` pulls
  `workbox-build → @rollup/plugin-node-resolve → deepmerge@4.3.1`, where
  `mergeObject()` is vulnerable to prototype poisoning of returned objects. The
  advisory is build-time only (no runtime app path uses `deepmerge`), and the
  only upstream fix is `npm audit fix --force`, which downgrades
  `vite-plugin-pwa` to `0.2.1` and breaks the production service-worker/offline
  pipeline. That inspection did not identify a compatible patched release. This is a dated
  observation, not a current upstream-version assertion; recheck before changing
  dependencies. Decision at the time:
  defer the downgrade, keep the PWA/offline build intact, and re-evaluate when a
  compatible patched release is available. Owner: build tooling maintainer.
- **Cross-tab settings reconciliation:** fields are merged per field, and local
  pending edits win over a stale external snapshot for the same field until the
  other tab's value agrees. Adopted external fields keep the other tab's field
  timestamps rather than receiving a new local stamp. External settings
  adoption is deferred while the timer is armed, running, or inspecting and is
  applied once when idle. Metadata preservation depends on the shared
  `cubelab:sync:v1` record; if another tab has not yet published metadata for
  an adopted field, the field may merge by value without an external timestamp.
- **Performance evidence:** `syncStateFingerprint` costs about 21.9 ms for a
  10,000-solve session in the unit environment; `addSolve` costs about 1.0 ms
  and `reconcileExternalSessions` about 4.3 ms. The fingerprint is memoized on
  `sessions`/`settings` and is not recomputed on animation frames; history
  windowing bounds rendered history rows. The later October 31 stop profile is
  the relevant UI evidence; these older unit timings do not prove end-to-end
  stop latency or the cost of enabled synchronization.
