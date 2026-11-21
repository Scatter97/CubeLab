# Training Drive sync implementation plan

**Status:** Implemented 2026-11-20 (Phase 1 manual replace-only backup/restore and Phase 2 merge-based sync). See [STATUS.md](../../STATUS.md#training-drive-backup-and-sync--2026-11-20) for verification and measurements.
**Last reviewed:** 2026-11-20
**Depends on:** [TRAINING_HISTORY_BACKUP_DESIGN.md](TRAINING_HISTORY_BACKUP_DESIGN.md)
**Owners:** `src/lib/driveTransport.ts`, `src/lib/training/`, `src/hooks/`,
`src/components/DriveBackupDialog.tsx`, `src/App.tsx`

## 1. Decision

Training sync must use a **separate Google Drive file family**, not the existing
solve/session snapshot.

Planned phases:

1. **Phase 1 — separate Training cloud backup/restore.** Manual upload and
   restore of a complete Training snapshot, replace-only. No automatic sync and
   no merge.
2. **Phase 2 — true Training synchronization.** Merge immutable snapshots from
   multiple devices, with durable deletion/Undo metadata, field updates,
   conflict review, automatic triggers and separate retention.

Do not put `training` in the solve `SyncEnvelope`, `cubelab-backup-*` files, or
`cubelab:sync:v1`. Do not change any solve/session Drive behavior.

The existing solve reader filters files through `isDriveBackupFileName`
(`src/lib/driveTransport.ts:293-296`). A new `cubelab-training-*` prefix is
therefore ignored by older clients, which is the compatibility boundary this
plan relies on.

## 2. Current facts to preserve

- `DriveTransport` already exposes immutable per-device solve snapshots through
  `listBackups?()` and `uploadDeviceBackup?()`.
- `downloadBackup(fileId)` and `deleteBackup(fileId)` are generic by file ID and
  can be reused for Training files.
- `useDriveBackup` owns the manual solve backup/restore UI and remote snapshot
  list.
- `useSync` owns automatic solve synchronization and its retention.
- `beginReplacement`/`rollbackReplacement`/`markReplacementCommitted` support
  `sessions`, `settings`, `sync`, `drive`, `training` and `trainingSync`.
- `TrainingController` exposes `getBackupSnapshot()`, `stageTrainingSnapshot()`
  and `adoptSavedTraining()` from the native-backup work.
- `src/lib/trainingSync.ts` owns the pure merge, `src/lib/trainingSyncStorage.ts`
  owns the separate ledger and Training device ID, and
  `src/lib/trainingDeletion.ts` owns deletion intent.
- Training data has no Drive merge in Phase 1. Phase 2 adds it without touching
  solve protocols; see the implementation record in section 11.

## 3. Non-goals

- Do not add Training to the solve snapshot.
- Do not modify `SyncEnvelope`, solve file names, solve cleanup or the solve
  10 MB cap.
- Do not change Training schema v1 at `cubelab:training:v1`.
- Do not enable automatic Training sync in Phase 1.
- Do not add retention/pruning of local Training history.
- Do not add dependencies.
- Do not run live Google Drive validation.

## 4. File family and transport

Use a distinct immutable file family:

```text
cubelab-training-<sanitizedDeviceId>-<uuid>.json
```

Add to `driveTransport.ts`:

```ts
export const DRIVE_TRAINING_FILE_PREFIX = 'cubelab-training'

export function isDriveTrainingFileName(name: string): boolean
export function trainingSnapshotFileName(deviceId: string): string
```

File app properties:

```ts
{
  app: 'CubeLab',
  format: 'cubelab-training-backup',
  trainingVersion: '1',
  deviceId
}
```

Extend the transport contract with optional methods:

```ts
listTrainingBackups?(): Promise<DriveFile[]>
uploadTrainingBackup?(content: string, deviceId: string): Promise<DriveFile>
```

Defaults when absent: Training cloud features are unavailable in that transport.
Do not fall back to `findBackup`/`uploadBackup`; those are the legacy solve path.

The real transport must list `spaces: 'appDataFolder'` with the same pagination
and error handling as `listBackupFiles`, filtered by
`isDriveTrainingFileName`. Do not read solve ETags for Training files. The
memory transport must implement the same methods and naming so tests are
representative.

## 5. Phase 1 — separate Training cloud backup/restore

### 5.1 Format

```ts
interface TrainingDriveBackup {
  app: 'CubeLab'
  format: 'cubelab-training-backup'
  version: 1
  deviceId: string
  exportedAt: string
  training: TrainingBackupSection
}
```

Use compact JSON and a separate cap:

```ts
export const MAX_TRAINING_DRIVE_BYTES = 16 * 1024 * 1024
```

If the compact payload exceeds the cap, block the Training backup with an
accurate size message. Do not affect solve sync. Compression for Training Drive
files is deferred; native `.json.gz` remains a separate path.

Validation must:

- require the exact `app` and `format`;
- accept only supported Training backup/version values;
- validate the complete Training store through `parseTrainingBackupSection`;
- reject active/open visits;
- reject oversized files before parsing;
- reject malformed JSON and unknown envelope versions without mutation.

The Phase 1 parser must **ignore an optional `sync` field** so files written by
Phase 2 remain readable for replace-only restore.

### 5.2 Upload

Manual action only:

1. Require a connected transport and support for the Training methods.
2. Require the timer to be idle.
3. Require `TrainingController.getBackupSnapshot()` to be `ready`. Block on
   unreadable Training, pending save, continuity decision or active visit.
4. Do not require solve sync to be enabled.
5. Serialize the envelope, validate it, check the cap, and upload a new immutable
   file. Never overwrite an existing Training snapshot.
6. After success, best-effort delete older own Training snapshots, keeping the
   newest 5. Cleanup failure must not change the upload result.
7. Show the uploaded time and snapshot identity in the UI.

Do not upload empty/default Training data unless the local key exists and
contains history or preferences worth restoring. An absent Training key should
disable the action with “No Training history to back up.”

Use `runWithDriveWriteLock` around upload/cleanup. Do not block a solve sync
merely because a Training upload could be offered.

### 5.3 Restore

Manual action only:

1. List Training files, newest first. The UI may offer the newest or a selected
   snapshot; a full snapshot list is acceptable.
2. Download and validate the envelope and complete Training store.
3. Show a preview with attempts, saved sessions, calibrations, custom
   algorithms, presets and date range.
4. Require typed confirmation. State that local Training will be replaced and
   that no Training visit will be resumed.
5. Block if the timer is active, solve sync is running, a replacement journal is
   pending, Training has a pending save, continuity decision or active visit.
6. Use the existing durable replacement primitives with a new
   `ReplacementKind = 'training-restore'`, capturing the `training` and
   `trainingSync` keys. Stage the checked Training bytes and the cleared ledger,
   record the commit marker, adopt the restored store in the controller, then
   clear the journal. Do not import sessions or settings.
7. A Phase 1 restore must be blocked while Phase 2 Training sync is enabled
   unless the user disables it first. This avoids a replace-only restore racing
   an automatic merge.
8. Do not auto-resume an imported visit. Reject a snapshot containing one.
9. Clear stale Training sync provenance while preserving the Training device ID
   and sync preferences. Old tombstones, conflicts and approvals must not delete
   or suppress restored records, and rollback must restore the previous ledger
   bytes.

Reuse `TrainingController.adoptSavedTraining()` rather than writing a second
copy. Startup recovery must handle a prepared or committed Training-only journal
through the existing `recoverPendingReplacement()` path.

### 5.4 Phase 1 UI

Add a **Training history backup** section to `DriveBackupDialog`:

- connected/disconnected state;
- local Training counts and date range;
- “Back up Training to Drive”;
- latest remote Training snapshot summary;
- “Restore latest Training backup…” or a compact snapshot list;
- progress, error and success notices;
- explicit wording that this is manual cloud backup, not multi-device sync;
- no automatic-sync toggle in Phase 1.

Keep the existing solve “Google Drive backup” section and its wording intact.
Do not imply that solve sync includes Training.

### 5.5 Phase 1 tests and gate

Unit:

- Training filename filter excludes solve files and accepts only Training files.
- Envelope round trip, invalid app/format/version, invalid Training store and
  open visit rejection.
- 16 MB cap and compact serialization boundary.
- Upload creates a new immutable file; repeated uploads do not overwrite.
- Cleanup retains the newest five own files and tolerates delete failures.
- Restore preview counts and exact Training-only replacement.
- Restore clears stale sync tombstones/conflicts/approvals while preserving the
  Training device ID and preferences; rollback restores the prior ledger bytes.
- Failed Training write rolls back only Training and its sync ledger;
  sessions/settings/journals are untouched.
- Startup recovery for a prepared Training-only replacement.
- Solve sync tests prove no Training file is listed, uploaded or merged.

Focused Chromium:

- Upload a Training snapshot from a synthetic device.
- Restore it into a cleared Training store; verify Hub, Practice history, report
  and Algorithms.
- Confirm a solve backup/restore is unaffected.
- Confirm active Training, pending save and continuity states block both actions
  with clear messages.
- Confirm no Training appears in the solve snapshot list.

Do not start Phase 2 until Phase 1 typecheck, lint, focused tests, focused
Chromium and build pass.

## 6. Phase 2 — true Training synchronization

### 6.1 Format extension

Keep the Phase 1 file format and add an optional sync envelope:

```ts
interface TrainingDriveSnapshot extends TrainingDriveBackup {
  sync?: TrainingSyncEnvelope
}

interface TrainingSyncEnvelope {
  version: 1
  deviceId: string
  revision: number
  updatedAt: number
  tombstones: TrainingTombstone[]
  fieldUpdates: TrainingFieldUpdates
  conflicts: TrainingConflict[]
}
```

Phase 2 writes `sync`; Phase 1 readers ignore it for replace-only restore. A
Phase 2 reader must accept a Phase 1 file as a base snapshot with no tombstones,
field metadata or conflicts. Never reject an otherwise valid Phase 1 file solely
because `sync` is absent.

### 6.2 Local sync state

Add a separate key:

```text
cubelab:training-sync:v1
```

It must contain:

- protocol version;
- one Training device ID shared by manual backup and merge sync;
- enabled/automatic/manual-conflict preferences;
- last remote revision and last synced fingerprint;
- tombstones and restored/revocation metadata;
- field updates;
- Training conflicts and approvals;
- retention settings and last sync result.

Never store this state in `cubelab:sync:v1`. Do not include it in the solve
snapshot. Native Training backup should not include the sync ledger; a native
restore clears stale provenance while preserving the device ID and preferences.
An unreadable or partial ledger must reject the whole ledger, preserve its
original bytes and block writes until repaired.

### 6.3 Merge model

Add a pure merge module, e.g. `src/lib/trainingSync.ts`, and test it independently.

| Training data | Merge rule |
| --- | --- |
| Attempts | Union by stable ID. Identical rows deduplicate. Conflicting rows need timestamped correction handling or manual review. |
| Attempt deletion | Durable tombstone with ID, visit ID, deletedAt and device. deleted wins. Undo records an explicit restored/revocation timestamp. |
| Visits/sessions | Union by ID. Only ended visits may sync. A visit tombstone removes the visit and its known attempt IDs. |
| Visit acknowledgement | `reportPending` is monotonic true→false; an acknowledged report on either device stays acknowledged. |
| Calibrations | Append-only immutable union by ID; same ID with different content is a conflict. |
| Presets | Per-ID `updatedAt`; newer wins, equal different values need manual review. Preset deletion needs a tombstone. |
| Custom algorithms | Immutable by ID; same ID with different notation/version is a conflict, never silently replaced. |
| Preferences | Coarse whole-`preferences` field update initially, with editor/timestamp and manual review when both changed. Document the coarse granularity. |
| recognitionCounts | High-water `max`; never sum or decrease below retained completions. |
| activeVisitId | Must be null in every sync snapshot. Never merge an open live visit. |
| Unknown additive JSON | Preserve and validate; do not silently strip. |

After merge, run the complete `assertTrainingData` validation. If the merged
store is invalid, keep local data unchanged, surface a conflict/error and do not
publish.

A genuinely fresh device with no local Training store adopts the remote
preferences even when an older Phase 1 snapshot has no field-stamp metadata.
Remote files that are malformed or exceed the Training cap are skipped with a
warning; the UI can delete the unreadable file without touching local history.

### 6.4 Deletion and Undo integration

Add a Training sync ledger so deletions are durable before local records vanish:

- Record an attempt tombstone in `handleDeleteTrainingAttempt` before the
  destructive local change, and revoke it if that local delete fails. The Undo
  path must revoke it again with an explicit restoration timestamp.
- When an archived session is deleted, write its visit tombstone and every known
  attempt tombstone in one ledger write before removing the local records, then
  revoke the whole set if the local delete fails or Undo restores the session.
- Record a preset tombstone before preset deletion. Preset deletion offers Undo,
  which revokes the tombstone and restores the exact preset.
- Never let a stale remote snapshot resurrect deleted records.
- Keep recognition high-water counts unchanged by deletion.

Use the solve tombstone/revocation lessons, but keep Training metadata separate.
Do not overload solve tombstones.

### 6.5 Automatic synchronization

Add a separate `useTrainingSync` hook. It must not reuse `useSync` state.

Triggers:

- explicit user enable;
- manual “Sync Training now”;
- app startup when enabled, timer idle and Training idle;
- after a Training session ends;
- optionally after an idle debounce if a completed history changed outside a
  session.

Never sync:

- during inspection, holding, running or a Training attempt;
- while a Training save is pending or continuity is unresolved;
- while an active/open Training visit exists;
- while a replacement journal, pending solve recovery or solve-native import is
  unresolved;
- while the user is in the middle of a Training calibration draft.

Automatic Training sync must upload at most once after a session ends, not after
every attempt. This keeps a large snapshot from being uploaded repeatedly.

A run must abort before publication or adoption if local Training or the
ledger's tombstones, field updates or conflicts changed during download, merge,
adoption or upload. Surface a retryable pending state and schedule at most one
deferred retry; never overwrite the newer state with the stale merged result.
A crash-left `syncing` status is not a resting state and normalizes to pending
when enabled or disabled when sync is off.

Use the existing active-tab Web Lock and `runWithDriveWriteLock` for uploads.
Separate files may be read independently, but serialize Drive operations enough
to avoid confusing concurrent UI states. Do not change the solve sync schedule.

### 6.6 Conflict review

Add a Training conflict section to `DriveBackupDialog`, separate from solve
conflicts:

- show field, local and remote values, timestamps and devices;
- allow exact local/remote approval;
- persist approvals in `cubelab:training-sync:v1`;
- if manual review is enabled, do not publish or adopt a partially resolved
  merged store;
- if automatic resolution is selected, use deterministic last-writer rules and
  expose the decision in history;
- never claim multi-device consensus.

The existing solve conflict UI and `cubelab:sync:v1` records must remain
unchanged.

### 6.7 Cleanup and retention

Add separate Training snapshot listing and cleanup:

- always keep the newest Training snapshot for every device;
- remove older snapshots beyond the configurable count/age policy (default keep
  10 / 30 days); manual upload cleanup keeps the newest five own snapshots;
- never touch `cubelab-backup-*` files from Training cleanup;
- never touch Training files from solve cleanup;
- best-effort cleanup after a successful Training publish;
- preserve the newest snapshot for every device.

Manual deletion in the Training remote-snapshot list deletes only the selected
Training file, including an unreadable file. Do not add Training files to
“Delete all solve backups”.

### 6.8 Native backup interaction

Phase 2 must define and enforce:

- Native Training restore and Phase 1 replace-only restore clear stale
  Training sync tombstones, conflicts and approvals while preserving the
  Training device ID and sync preferences. They are blocked while Training sync
  is enabled; ask the user to disable sync first so a replace-only restore cannot
  race an automatic merge.
- Disabling Training sync stops all automatic Training network work but keeps
  local history and remote files.
- An unreadable or partial `cubelab:training-sync:v1` ledger blocks writes and
  preserves its bytes. Surface the warning rather than creating a fresh ledger.
- Clearing `cubelab:training-sync:v1` falls back conservatively: local history
  remains, but deletion provenance/conflicts are lost. Surface this warning.
- Reset All Site Data clears local Training sync state but does not delete
  remote Training files. State that clearly.

### 6.9 Phase 2 tests and gate

Unit merge tests:

- additions on two devices;
- same attempt with identical content;
- correction conflict and equal-timestamp tie;
- attempt deletion and Undo revocation;
- session deletion with known attempt IDs, including atomic visit/attempt
  tombstones for archived-session deletion;
- preset deletion, Undo and tombstone revocation;
- visit acknowledgement;
- calibration duplicate/conflict;
- preset update/delete;
- custom algorithm conflict;
- preferences conflict and automatic/manual resolution;
- recognition count max and high-water invariants;
- open-visit rejection;
- Phase 1 file without sync metadata;
- invalid merged store leaves local unchanged;
- malformed/partial ledger preserves bytes and blocks writes;
- stale `syncing` normalizes to pending/disabled;
- local Training or ledger changes during upload abort and retry without
  overwriting the newer state;
- fresh device adopts remote preferences;
- invalid/oversized remote files are skipped and remain deletable;
- no solve snapshot or solve sync state is touched.

Hook/transport tests:

- Training files filtered separately from solve files;
- immutable uploads, revision increments, no-change skip;
- offline/error/retry;
- cleanup isolation;
- independent enable/disable;
- active timer/Training/pending save guards.

Two-context mock-Drive Chromium:

- Device A records two Training sessions, syncs, Device B adopts;
- Device B records an attempt and syncs back;
- deletion/Undo propagates;
- conflict review approves local/remote;
- solve sync can run independently in both contexts;
- disabling Training sync stops uploads;
- remote Training snapshots never appear in solve remote snapshots;
- native restore is blocked while Training sync is enabled;
- large synthetic history remains within the 16 MB Training cap and does not
  affect solve sync.

Performance:

- measure upload, download, merge and controller adoption for 8,000 synthetic
  attempts;
- measure no-change fingerprint cost;
- record median/range in `STATUS.md`;
- do not claim a physical-device threshold from Node/jsdom.

Do not claim live Drive, multi-device physical browser or provider concurrency
coverage without explicit authorization.

## 7. Verification commands

Phase 1:

```bash
npm run typecheck
npm run lint
npm test -- src/lib/driveTransport.test.ts src/lib/backup.test.ts \
  src/lib/portableBackup.test.ts src/lib/training/storage.test.ts \
  src/lib/replacement.test.ts src/lib/startupRecovery.test.ts \
  src/hooks/useDurableReplacement.test.ts src/hooks/useTraining.test.tsx \
  src/lib/trainingDrive.test.ts src/hooks/useTrainingDriveBackup.test.tsx \
  src/hooks/useDriveBackup.test.ts
CI=1 npm run test:e2e -- e2e/training-drive-backup.spec.ts --project=chromium \
  --workers=4 --retries=0
npm run build
git diff --check
```

Phase 2:

```bash
npm run typecheck
npm run lint
npm test -- src/lib/trainingSync.test.ts src/lib/trainingSyncStorage.test.ts \
  src/lib/trainingDeletion.test.ts src/lib/trainingSync.performance.test.ts \
  src/hooks/useTrainingSync.test.tsx src/hooks/useTrainingDriveBackup.test.tsx \
  src/lib/trainingDrive.test.ts src/hooks/useDriveBackup.test.ts \
  src/hooks/useSync.test.ts src/lib/sync.test.ts
CI=1 npm run test:e2e -- e2e/training-drive-sync.spec.ts e2e/training-drive-backup.spec.ts \
  --project=chromium --workers=4 --retries=0
npm run build
git diff --check
```

Use the actual test names created by the implementation. Run focused files, not
the entire suite, unless explicitly requested. Do not run `validate:drive` or use
live Google Drive.

## 8. Delivery order and stop gates

1. Implement Phase 1 only.
2. Run the Phase 1 gate.
3. If Phase 1 fails, stop and report; do not start Phase 2.
4. If Phase 1 passes, continue to Phase 2 in the same task.
5. Run the Phase 2 gate.
6. If Phase 2 merge or deletion semantics cannot be made safe, stop before
   enabling automatic sync and report the unresolved cases.
7. Update documentation only after the corresponding phase passes.
8. Report exact tests, measurements, skipped coverage, remaining limits and
   commit/push state (must be no commit or push).

## 9. Required documentation updates

- `README.md`: separate Training cloud backup (Phase 1), then Training sync
  (Phase 2); Drive solve sync still excludes Training.
- `KNOWN_LIMITATIONS.md`: Training Drive is manual backup in Phase 1 and
  merge-based sync in Phase 2; native restore/Drive sync interaction; no live
  Drive claim.
- `STATUS.md`: one dated implementation entry after each phase, including tests
  and measurements.
- `docs/training/CURRENT_STATUS.md` and `PROJECT_MEMORY.md`: update F5/F10 and
  record the delivered phase and unresolved retention/conflict boundaries.
- `TRAINING_HISTORY_BACKUP_DESIGN.md`: link this plan from its Drive deferral
  section.
- `.opencode/skills/cubelab-sync-safety/SKILL.md`: add the separate Training
  file family and its ownership/deletion/cleanup boundaries before Phase 2.

## 10. Acceptance criteria

Phase 1:

- Manual Training upload and restore work through separate Drive files.
- Restore is Training-only and replace-only.
- No solve file, solve sync state or solve cap changes.
- Old clients ignore Training files.
- Active/pending/unreadable Training states block safely.

Phase 2:

- Two devices converge on Training attempts, visits, calibrations, presets,
  custom algorithms and preferences without losing history.
- Deletions and Undo have durable provenance and cannot be resurrected by stale
  snapshots.
- Conflicts are visible and require exact approval when manual review is on.
- Automatic sync runs only in safe idle states and not per attempt.
- Training cleanup and solve cleanup cannot delete each other’s files.
- Native restore and Drive sync cannot race.
- Existing solve sync, native backup and Training schema behavior remain intact.

## 11. Implementation record — 2026-11-20

Both phases are implemented. Phase 1 is the manual replace-only
`cubelab-training-*` path; Phase 2 adds the optional merge envelope, separate
`cubelab:training-sync:v1` ledger, tombstones/Undo, conflict review, automatic
guards and separate retention. Manual upload and merge sync share one Training
device ID. Training cleanup always keeps the newest snapshot per device and
supports configurable count/age cleanup (default keep 10 / 30 days); manual
upload cleanup keeps the newest five own snapshots.

The 2026-11-20 follow-ups (Training memory E19) add restore clearing of stale
tombstones/conflicts/approvals while preserving device ID and preferences; the
`trainingSync` replacement-journal key; abort/retry when local Training or the
ledger changes mid-run; malformed-ledger write blocking with byte preservation;
`syncing` normalization; invalid/oversized remote-file skipping with UI deletion;
fresh-device preference adoption; atomic archived-session tombstones; preset
deletion Undo; and historical-attribution correction after tracking is disabled.
Verification, measurements and remaining limits are recorded in
[STATUS.md](../../STATUS.md#training-drive-backup-and-sync--2026-11-20) and
Training memory E18/E19. Live Google Drive, `validate:drive`, physical devices and
Firefox/WebKit Training Drive flows remain unverified; the follow-ups are part of
the uncommitted working tree and are not each separately covered by that dated
entry.
