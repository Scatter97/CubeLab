# CubeLab synchronization hardening — limitations

**Last updated:** 2026-10-28

This patch substantially hardens Phase 2C, but it is deliberately **not** a claim
that every distributed-systems problem is solved. Google Drive is still an
eventually consistent remote store, not a transaction coordinator.

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
  files, and reports partial failures instead of claiming success. Snapshots
  accumulate until then; there is no automatic cleanup policy.

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
- Global settings keep field metadata in `cubelab:sync:v1` rather than changing
  the settings schema. First-sync merging preserves a device's customized
  settings and establishes a baseline so another device cannot replace them just
  because it has metadata first.
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
  each other's unique solves; every snapshot stays discoverable and is merged by
  the next run. Web Locks still serialize same-origin writes; failures do not
  replace newer local state.
- Discovery, merge, restore, and delete-all continue to cover every snapshot,
  legacy per-device names, and `cubelab-backup.json`; removed tombstone removal
  is unchanged.
- Redundant-upload skipping still triggers on unchanged merged fingerprints and
  recent remote revisions; immutable names eliminate the avoidable overwrite race
  and make the pre-write optimistic recheck unnecessary for per-device
  transports.
- Residual limits: snapshots accumulate over time (one per change round per
  device). There is no automatic cleanup policy, no per-device management UI,
  and no server-side ordering. Real-provider multi-device behavior remains
  unvalidated. Growth is documented.

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
  ETag, in-memory conditional writes) and hook/UI tests. **Not validated against
  a real Google Drive account.**

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
- **No real multi-device provider validation.** Automated coverage uses the
  deterministic in-memory transport. Real Google Identity Services and Drive
  backup/restore were validated earlier; concurrent multi-device sync against
  real Drive and the new v2 ETag/`If-Match` path against the live provider were
  not. The Stage 1 gate is therefore only partially met.
- **Eventual convergence, not synchronous consistency.** Each device must run a
  later merge before it sees another device's newest snapshot. There is no
  server-side ordering, push notification, or read-after-write guarantee.
- **Delete-all is all-or-nothing.** There is no selective snapshot management,
  stale-snapshot cleanup policy, or UI showing which device owns each file.
  Because every write adds an immutable snapshot, remote files accumulate until
  delete-all.
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
- **Active-session selection is not field-merged.** The active session is kept
  when it still exists locally; concurrent selection changes are not reviewed.
- **In-flight identity checks assume immutable React state.** An accidental
  in-place mutation of sessions or settings could bypass the fingerprint guard.
- **Settings provenance depends on sync metadata.** If `cubelab:sync:v1` is
  cleared, settings fall back to the conservative first-sync/whole-field policy
  rather than recovering historical per-field timestamps.
- **Local JSON import remains replace-only.** Drive sync does not turn file
  import into a merge operation.

## Verification

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and
`npm run test:e2e` with Node 20 or newer. Use an isolated mock cloud for
concurrency scenarios. Do not treat this patch as a data-loss-proof
synchronization protocol.

Stage 0 on 2026-10-28 ran `npm run check` as one command with Node v22.23.2.
Typecheck and lint passed, **287/287 unit tests** passed in 21 files, the
production build passed (95 modules; PWA 22 entries, 2,286.77 KiB), **29/29
Playwright tests** passed, and `git diff --check` was clean.

Stage 1 on 2026-10-28 passed `npm run check` as one command after sync
hardening: typecheck and lint passed, **308/308 unit tests** passed in 21 files,
the production build passed (95 modules; PWA 22 entries, 2,296.43 KiB), **29/29
Playwright tests** passed, and `git diff --check` was clean. The manual-conflict
E2E covers review history, Undo, and Repair. No real Google Drive multi-device or
live-provider ETag test was run; the Stage 1 gate is partially unmet and real
provider validation remains Stage 3 work.
