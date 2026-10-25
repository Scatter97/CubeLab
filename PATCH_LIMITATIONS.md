# CubeLab synchronization hardening — limitations

**Last updated:** 2026-10-25

This patch substantially hardens Phase 2C, but it is deliberately **not** a claim
that every distributed-systems problem is solved. Google Drive is still an
eventually consistent remote store, not a transaction coordinator.

## Addressed

### Device-owned remote snapshots

- Each browser writes only its own
  `cubelab-backup-<sanitized-device-id>.json` app-data snapshot. Simultaneous
  uploads from different devices therefore cannot overwrite one another.
- Every sync lists, validates, downloads, and merges **all** CubeLab snapshots.
  The legacy fixed-name `cubelab-backup.json` remains readable for upgrades and
  is included in manual restore and delete-all operations.
- File discovery now follows every `nextPageToken` page and requests the token
  fields explicitly. A failed page, malformed/repeated token, or
  `incompleteSearch` stops synchronization instead of returning a partial list
  that could miss another device's snapshot.
- Manual backup (`useDriveBackup`) also replaces only the current device's file.
  It never falls back to overwriting another device's file on a per-device
  transport.
- **Delete remote backups** now removes every CubeLab snapshot, including the
  legacy file, and reports partial failures instead of claiming success.

### Same-device write coordination

- Automatic sync and manual backup share a Web Lock and re-list this device's
  snapshot immediately before writing. A changed file ID, name, or modification
  time aborts the write with a pending/retry status instead of overwriting a
  newer snapshot with an older starting view.
- The lock and recheck remove the avoidable same-origin tab race. They are best
  effort, not a remote transaction; a copied browser profile that shares the
  device ID can still write between the recheck and the request.

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

## Still unresolved

- **No verified provider compare-and-swap.** Device-owned files prevent
  cross-device file overwrites, but Google Drive still has no conditional write
  in this transport. Two tabs or profiles sharing the same device ID can race on
  the same file. Web Locks plus a pre-write re-list reduce same-origin tab
  concurrency but are not a remote transaction. Do not claim atomic remote
  writes.
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
- **Legacy tombstones still use wall-clock comparison.** Tombstones without
  `knownSolveIds` cannot distinguish an unknown offline edit from an intentional
  deletion, so ambiguous old edits can still be lost.
- **Redirect handling is deterministic, not consensus-based.** Devices with
  different approval sets can resolve differently until they exchange the same
  set. Divergent approved destinations have no separate recovery flow.
- **Conflict review has no audit history or undo.** Resolutions are stored only
  as current runtime records; the queue is capped at 100 entries, and past
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
