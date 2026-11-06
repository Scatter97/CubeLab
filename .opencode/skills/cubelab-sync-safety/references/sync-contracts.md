# CubeLab sync contracts

Read for merge/recovery/review or snapshot-lifecycle changes. These existing
contracts were moved out of the shared contributor instructions during the
November 1 documentation consolidation. Paths use the repository root.

Implementation owners: `src/lib/sync.ts`, `src/lib/solveMerge.ts`,
`src/lib/sessionMetadata.ts`, `src/lib/settingsMerge.ts`,
`src/lib/sessionRedirects.ts`, `src/lib/sessionTransfers.ts`,
`src/lib/remoteBackups.ts`, `src/lib/snapshotRetention.ts`,
`src/lib/driveTransport.ts`, `src/lib/driveCoordination.ts` and
`src/hooks/useSync.ts`. The regression groups and transport workflow are in the
parent `SKILL.md`.

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
- **Partial splits use durable solve ownership.** A whole-session merge is
  represented by the existing redirect. A split keeps the source session, so its
  `sessionTransfers` records live in the session collection and name the exact
  moved solve IDs, operation time and device. Merges union those records, resolve
  later operations deterministically, follow redirects for the destination, and
  force compatible solve ownership even when a stale snapshot still holds the
  source copy. They never create or resurrect a solve. Deleting a split
  destination records solve tombstones for its current solves so stale source
  copies cannot return. There is no Undo for merge or split; do not imply that a
  published redirect/transfer can be reversed safely.
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

Active-session review also follows exact value/timestamp approvals: preserve the
chosen ID's metadata through `parseRemoteSyncEnvelope` and hook adoption, rather
than restamping it as a local edit. Keep both-choice, reversed/repeated-merge,
stale-decision, Undo and envelope/publication regressions in `src/lib/sync.test.ts`
and `src/hooks/useSync.test.ts`. See `KNOWN_LIMITATIONS.md` for provider boundaries.
