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
- The lock is best effort, not a remote transaction. Google Drive still exposes
  no verified conditional write/compare-and-swap; local state remains
  replaceable and convergence is eventual.

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
- Startup resumes a sync that was persisted as `syncing`, and sync-on-exit is
  attempted on visibility loss, `pagehide`, and `beforeunload`.
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

## Still unresolved

- **No verified provider compare-and-swap.** Unique immutable snapshot names
  prevent a write from replacing another writer's file, including two tabs or
  profiles that share a device identity. Google Drive still has no conditional
  write in this transport, and local state remains replaceable, so product copy
  must describe eventual convergence rather than atomic writes. Web Locks
  serialize same-origin writes but are not a remote transaction. Do not claim
  atomic remote writes.
- **Duplicate review is advisory.** Collisions are detected and surfaced, but
  CubeLab never merges same-named sessions automatically. A user who dismisses
  the toast and closes the Drive dialog still has to reopen the merge action
  before the duplicate is resolved; the condition persists in sync runtime until
  then.
- **No real multi-device provider validation.** Automated coverage uses the
  deterministic in-memory transport. Real Google Identity Services and Drive
  backup/restore were validated earlier; concurrent multi-device sync against
  real Drive was not.
- **Eventual convergence, not synchronous consistency.** Each device must run a
  later merge before it sees another device's newest snapshot. There is no
  server-side ordering, push notification, or read-after-write guarantee.
- **Delete-all is all-or-nothing.** There is no selective snapshot management,
  stale-snapshot cleanup policy, or UI showing which device owns each file.
  Because every write adds an immutable snapshot, remote files accumulate until
  delete-all.
- **Legacy tombstones still use wall-clock comparison.** Tombstones without
  `knownSolveIds` cannot distinguish an unknown offline edit from an intentional
  deletion, so ambiguous old edits can still be lost.
- **Redirect handling is deterministic, not consensus-based.** Devices with
  different approval sets can resolve differently until they exchange the same
  set. Divergent approved destinations have no separate recovery flow.
- **Conflict review has no audit history or undo.** Resolutions are stored as
  current runtime records. Pending conflicts and approvals needed to complete
  an active merge are never evicted by a display or history cap; the stored
  queue is deduplicated by field key, and its rendering is paginated. Past
  choices cannot be inspected or reversed from the UI.
- **Sync-on-exit is best effort.** Browsers may terminate async OAuth and network
  work while closing. Local storage remains the durability boundary.
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
Playwright tests** passed, and `git diff --check` was clean. No real Google Drive
multi-device test was run.
