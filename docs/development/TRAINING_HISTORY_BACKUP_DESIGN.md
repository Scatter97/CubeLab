# Training history backup and portable large-backup design

**Status:** Implemented 2026-11-20. Native Training history backup/restore and
the checked portable gzip path are delivered. The separate
[TRAINING_DRIVE_SYNC_PLAN.md](TRAINING_DRIVE_SYNC_PLAN.md) also delivered manual
replace-only Training Drive backup/restore and merge-based Training sync.
Automatic local Training retention/aggregation remains deferred.
**Last reviewed:** 2026-11-20
**Owners:** `src/lib/backup.ts`, `src/lib/backupLimits.ts`, `src/lib/portableBackup.ts`
(new), `src/lib/replacement.ts`, `src/lib/trainingSyncStorage.ts`,
`src/hooks/useDurableReplacement.ts`, `src/hooks/useTraining.ts`,
`src/lib/training/storage.ts`, `src/lib/training/controller.ts`,
`src/components/DataDialog.tsx`, `src/App.tsx`

## 1. Problem

CubeLab backs up ordinary sessions, solves and settings, but Training history is
intentionally local-only. A user who clears browser data, changes devices or
loses a profile loses every Training attempt, calibration, saved session,
preset and custom algorithm. Training history can also make a complete native
backup exceed the current 10 MB reader limit, so the backup can be blocked even
when the Training history itself is still small enough to be valuable.

This design adds Training history to the **native portable backup** and replaces
the single hard 10 MB path for native files with a checked, compressed portable
format. It does not add Training to solve Drive snapshots. A separate
[Training Drive plan](TRAINING_DRIVE_SYNC_PLAN.md) subsequently added manual
Training cloud backup/restore and merge-based Training sync without changing this
native format or the solve Drive protocol.

## 2. Decision summary

| Decision | Choice |
| --- | --- |
| Training included in native backup | Yes, as an optional top-level `training` section |
| Training included in solve Drive snapshots | No; separate Training file family and sync ledger |
| Training Drive backup/sync | Delivered by the separate-file plan |
| Training restore semantics | Replace-only, after typed confirmation; never merge |
| Backup with no Training section | Leave local Training untouched |
| Active/open Training session in backup | Prohibited; export and restore block until history is closed |
| Training schema | Unchanged v1 at `cubelab:training:v1` |
| Large native backup | Pretty/compact JSON up to 10 MB; above that, compact JSON gzip (`.json.gz`) |
| Legacy import | Existing `.json` backups remain readable |
| Drive backup cap | Unchanged at 10 MB |
| csTimer import cap | Unchanged at 10 MB |
| Automatic retention/pruning | Not introduced for local Training history by this design; remote Training snapshots have separate bounded cleanup |
| Dependencies | None; use browser `CompressionStream`/`DecompressionStream` |

## 3. Current contracts that must survive

1. `loadSessionsForStartup` and the recovery gate must continue to prevent an
   autosave over unreadable session bytes.
2. `loadTraining` returns defaults only when the key is genuinely absent. Any
   read, version or validation failure keeps the original bytes and must not
   produce writable empty data.
3. `saveTraining` protects Training transitions with exact-raw comparison and
   rejects invalid history mutations. The backup restore path must not weaken
   those rules for ordinary Training edits.
4. Native import, Drive restore and additive import continue to use
   `commitDurableReplacement`; a prepared journal must roll back every candidate
   key, and a committed journal must roll forward.
5. `pendingCompletion`, solve Recovery/Undo, replacement journals and the
   single-tab lifetime Web Lock remain in force. Training import must not run
   during an unresolved replacement, pending Undo, active timer or in-flight
   sync.
6. The Training controller is mounted inside the same active-tab ownership and
   must be updated in memory after a committed restore without creating a
   second unsaved candidate.
7. Native backup import replaces sessions and settings only after confirmation.
   The new Training section follows the same confirmation boundary.
8. Google Drive and csTimer limits and wire formats are not silently changed.

## 4. Training data included in a backup

The complete checked Training store is included, not just attempts:

```ts
interface TrainingBackupSection {
  version: 1
  data: TrainingData
}
```

`TrainingData` already contains:

- `preferences` (including algorithm tracking and domain settings);
- `recognitionCounts` high-water totals;
- `presets`;
- `customAlgorithms`;
- `attempts`;
- `calibrations`;
- `visits` and `activeVisitId`.

No separate derived statistics, chart series or report HTML are stored. Reports
and Algorithms analytics must recalculate from the restored records exactly as
they do from the local store.

### 4.1 Backup schema

Add an optional field to the existing native backup:

```ts
interface Backup {
  // existing app, format, version, exportedAt, sessions, settings, sync
  training?: TrainingBackupSection
}
```

Keep `BACKUP_VERSION = 1`. The field is additive: current readers already ignore
unknown fields, and an older build importing a file with `training` will restore
sessions/settings but leave its own Training data untouched.

Do not put Training in `SyncEnvelope` or in `createBackup` calls used by Drive.
Native export passes Training as a separate optional argument; Drive calls omit
it.

### 4.2 Validation

On parse, if `training` is present:

1. Require `training.version === 1`.
2. Validate the whole `TrainingData` through the existing all-record
   `assertTrainingData` rules; never skip a bad attempt and restore the rest.
3. Require `activeVisitId === null` and every visit to have `endedAt !== null`.
4. Reject the entire backup if the section is invalid, a future schema version,
   contains an unfinished visit, or contains a dangling attempt/visit reference.
5. Deep-clone the parsed section so later rendering cannot mutate it.

The native backup parser must not import the browser-storage side of
`training/storage.ts` unnecessarily. A small pure `training/backupSection.ts`
helper may own parsing/validation/cloning; it can use `assertTrainingData` from
`training/schema.ts`.

## 5. Export eligibility and contents

Native export already requires the timer to be idle and no unresolved solve
recovery materialization. Add these Training gates:

- Training data has loaded successfully (`state.data !== null`).
- `pendingSave` is false. A failed Training write blocks export; otherwise the
  exported history would omit the only copy of the newest attempt.
- `needsContinuity` is false.
- `data.activeVisitId === null`.
- No partial calibration draft needs to be exported; drafts are ephemeral and
  are not durable Training history.
- If Training storage is unreadable, block the full backup with an explicit
  error instead of silently exporting a partial backup. The user can use the
  existing Training recovery copy, retry storage, or restore a known-good
  Training backup when the restore path is available.

Use the controller’s last committed snapshot (`savedData`) for export, not an
uncommitted failed candidate. Add a small controller method such as
`getBackupData(): TrainingData | null` that returns `savedData` only when the
controller is in a writable, non-pending state; do not expose `expectedRaw`
publicly.

If the Training key is genuinely absent, omit `training` and keep the backup
small. If the key exists, include it even when it contains only preferences or
other non-attempt history.

The confirmation/export summary should report:

- attempts;
- saved Training sessions (visits with a session configuration);
- calibrations;
- custom algorithms;
- presets;
- date range, if any attempts exist;
- whether Training is included or why it is not.

## 6. Restore semantics

### 6.1 Backup with a Training section

Treat native restore as a full replacement of the records represented by the
file:

- Sessions and settings: existing replace behavior.
- Training: replace the local Training key with the backup’s checked section.
- No merge, no ID deduplication against local Training, no attempt
  resurrection.
- Typed confirmation remains required. The confirmation must state that local
  Training history will be replaced and show both local and backup counts.
- If the local Training store has an active visit, `needsContinuity`, or a
  pending save, block the entire import before any sessions/settings/Training
  key is written. The user must finish, resume/end or retry Training first.
- If local Training is unreadable/invalid, a valid backup may still restore it;
  the replacement journal captures the raw previous value for rollback. This is
  a recovery path, not a merge.
- On success, clear the Training error/continuity state and adopt the restored
  data in memory. Do not automatically resume an imported visit; the backup
  cannot contain one after the export gate.
- Clear stale Training sync provenance in `cubelab:training-sync:v1` while
  preserving the Training device ID and sync preferences. Old tombstones,
  conflicts, approvals and last-revision/fingerprint state must not be allowed
  to delete or suppress restored records. The replacement journal must capture
  the ledger key so a failed restore can roll its prior bytes back.
- After restore, the Training Hub, Practice History, reports and Analytics →
  Algorithms must read the restored store. No stale in-memory controller state
  may remain.

### 6.2 Backup without a Training section

- Leave local Training exactly as it is.
- The confirmation must say so explicitly.
- Do not create a default Training store or clear an existing one.

### 6.3 Additive csTimer import and Drive restore

- csTimer import never touches Training.
- Solve Drive restore uses solve snapshots, which continue to omit `training`;
  local Training is left untouched.
- Training Drive backup, restore and merge use the separate file family and
  ledger in [TRAINING_DRIVE_SYNC_PLAN.md](TRAINING_DRIVE_SYNC_PLAN.md). Do not
  overload the solve envelope with Training data.

## 7. Durable replacement integration

Extend the existing replacement journal rather than creating a second
transaction mechanism:

- Add `'training'` to `ReplacementKey`.
- Map `'training'` to `TRAINING_STORAGE_KEY` in `REPLACEMENT_STORAGE_KEYS`.
- Add `'trainingSync'` for a Training restore that must clear stale sync
  provenance. Map it to `TRAINING_SYNC_STORAGE_KEY` in
  `REPLACEMENT_STORAGE_KEYS`.
- Old journals without a `training` or `trainingSync` entry remain valid;
  rollback only touches captured keys.
- Extend `DurableReplacementPlan` with optional `trainingData?: TrainingData`
  and `trainingSyncStorage?: TrainingSyncStorageData`.
- Extend `useDurableReplacement` options with:
  - `stageTraining(data: TrainingData): boolean`
  - `replaceTraining(data: TrainingData): void`
  - a Training guard/blocked-reason callback
  - possibly `trainingRaw` for the post-commit controller adoption
- Stage order: sessions, settings, sync, drive, Training, Training sync ledger.
  Any failure invokes the existing rollback and reports that nothing was
  replaced.
- Record the commit marker only after every key, including Training and the
  Training sync ledger, is written.
- After the commit marker, publish journals/state and call the Training
  controller adoption method. `replaceTraining` also reloads the Training sync
  hook so in-memory provenance matches the cleared ledger.
- Startup `recoverPendingReplacement` must roll back or clean up the Training and
  Training sync keys through the same map; do not add a separate recovery path.

The Training controller needs a new method, for example:

```ts
adoptSavedTraining(data: TrainingData, raw: string): void
```

It must validate the data and raw bytes, update `savedData`/`expectedRaw` and the
public state, clear `pendingSave`, `error` and `needsContinuity`, reset
category/setup/calibration/sample/last-result presentation values, and emit one
store notification. It must not call `saveTraining` or write a second time; the
durable replacement already wrote the key.

Use a dedicated checked full-snapshot writer for replacement, for example
`stageTrainingSnapshot(data, expectedRaw?)`, that validates the complete data
and writes the serialized bytes. Do not use the ordinary `saveTraining`
transition guard for a wholesale replacement, but do not bypass serialization
validation or the journal.

## 8. Portable large native backups (the 10 MB fix)

### 8.1 Scope

The existing `MAX_BACKUP_BYTES = 10 MB` remains the cap for:

- Google Drive snapshots;
- csTimer imports;
- legacy uncompressed native JSON files.

Add native portable limits:

```ts
export const MAX_PORTABLE_BACKUP_BYTES = 16 * 1024 * 1024   // encoded file
export const MAX_PORTABLE_JSON_BYTES = 64 * 1024 * 1024     // decoded JSON
```

These are safety bounds, not product claims. They are large enough for the
measured 8.1 MB / 8,000-attempt Training fixture and a large solve collection
while keeping one file bounded. Re-evaluate only with measured export/import
evidence.

### 8.2 Export format

1. Build the complete backup, including Training if eligible.
2. Serialize and validate the JSON exactly as today.
3. If the readable or compact JSON is at most 10 MB, export the existing `.json`
   format. This preserves compatibility with older builds.
4. If the compact JSON is above 10 MB:
   - require `CompressionStream('gzip')`;
   - gzip the compact JSON;
   - verify the gzip output is at most 16 MB;
   - verify the decoded JSON is at most 64 MB;
   - download `cubelab-backup-YYYY-MM-DD.json.gz`.
5. If compression is unavailable, the compressed file exceeds 16 MB, or the JSON
   exceeds 64 MB, create no file and report the measured sizes and limit.
6. Never silently omit Training, truncate a collection or claim success for a
   file the reader cannot consume.

Compression must be asynchronous so the export button can show a busy state and
the UI remains responsive. Do not base64-encode the compressed data into JSON;
write the gzip bytes directly as a Blob.

### 8.3 Import format

The native file reader detects gzip by the first two bytes (`0x1f 0x8b`) rather
than trusting the extension.

1. Reject a file whose encoded size exceeds 16 MB.
2. For an uncompressed file, reject over 10 MB and decode as UTF-8.
3. For gzip, decompress with a streaming byte counter; reject as soon as the
   decoded size exceeds 64 MB. Cap compressed and decoded sizes independently.
4. Reject truncated/corrupt gzip, invalid UTF-8 and non-JSON content with a
   useful inline error.
5. Run the existing `parseBackup` validation, including the optional Training
   section, before showing the import preview or mutating anything.
6. Keep the existing csTimer fallback for uncompressed text; do not treat a
   gzip file containing a csTimer payload as a native backup.

`DecompressionStream` is required for `.json.gz` imports. If unavailable, report
that this browser cannot read compressed backups; do not attempt a risky manual
decompressor.

### 8.4 File naming and UI

- Uncompressed: existing `cubelab-backup-YYYY-MM-DD.json`.
- Compressed: `cubelab-backup-YYYY-MM-DD.json.gz`.
- File input accepts `.json`, `.json.gz` and the corresponding MIME types.
- Data dialog explains: “Large backups are compressed automatically. The file
  can be restored by a current CubeLab build.”
- Onboarding csTimer import keeps its 10 MB message and does not become a
  compressed native restore path.
- Drive UI continues to state its own 10 MB limit and does not claim Training
  inclusion.

### 8.5 Drive boundary

Do not change `SyncEnvelope`, Drive file naming/content, `createBackup` calls
from sync/Drive, `MAX_BACKUP_BYTES` for Drive, or `readRemoteBackups`.

A compressed native file is not a Drive snapshot. A larger Drive snapshot needs
a protocol-versioned design that old clients can safely ignore; that is outside
this work.

## 9. UI and accessibility

- `DataDialog` summary adds Training attempts/sessions/calibrations and a
  “Training history included” note.
- Export handler becomes async; add `isExporting` state, a busy label, disabled
  actions while working, and a final success/error status.
- Import confirmation adds Training counts and the replace/no-change statement.
- If a restore is blocked by an active Training session, pending save or
  continuity decision, explain exactly what to finish.
- Preserve focus restoration, typed confirmation, error announcements and the
  existing modal focus containment.
- Do not put a second confirmation inside the Training workspace for a Settings
  import; use the existing native import confirmation.

## 10. Tests and verification

### Unit

- Backup with Training round trips attempts, visits, calibrations, presets,
  custom algorithms, preferences and recognition counts.
- A backup without Training leaves local Training untouched.
- Invalid/future Training section rejects the entire backup.
- An open visit in a backup is rejected.
- Export omits Training only when the key is absent; blocks when Training is
  pending or invalid.
- Native import replaces Training only when present.
- Durable replacement: Training write failure rolls back sessions, settings,
  sync, drive and Training; old journals without Training still parse.
- Startup rollback/cleanup handles a journal containing Training.
- Controller adoption updates Hub/history/report reads and clears error/pending/
  continuity state.
- Portable export at 9.9 MB, 10 MB, 10.1 MB, 16 MB compressed and 64 MB decoded;
  no file above limits.
- Gzip detection, truncated gzip, corrupt gzip, invalid UTF-8, decompression
  bomb, non-backup JSON, missing `CompressionStream`/`DecompressionStream`.
- Legacy `.json` round trip remains unchanged.
- Drive and csTimer tests confirm unchanged caps and no Training in snapshots.

### Browser/E2E (focused Chromium)

- Export a Training history, clear/replace local Training, import, and verify
  attempts, session names, calibrations, reports and Algorithms analytics.
- Confirm a backup without Training leaves local Training unchanged.
- Confirm an active Training session blocks import with a clear message.
- Export/import a synthetic >10 MB backup through the compressed path.
- Failed Training write during import leaves sessions/settings/Training unchanged.
- Offline production preview can export and restore a compressed backup.

### Performance

Use synthetic histories, never real user data. Measure:

- serialization and validation at 8,000 Training attempts and 10,000 solves;
- gzip compression/decompression duration and encoded/decoded sizes;
- import preview and confirmation latency;
- first Training screen render and Analytics → Algorithms after restore.

Record median/range in `STATUS.md` once. Do not claim a browser threshold from
Node-only observations.

## 11. Compatibility and rollback

- Training schema remains v1; no migration of the Training key.
- Native backup stays version 1 with an optional field.
- Older builds ignore the new `training` field when reading a plain JSON file.
- Older builds cannot read `.json.gz`; large compressed files require a current
  build. Document this in the limitations and export copy.
- A rollback build can still read an existing `.json` backup and leaves Training
  untouched.
- Replacement journal compatibility: an old journal has no `training` entry;
  rollback must not clear Training when it was not captured.
- If a build with Training backup is rolled back after importing Training, the
  old build leaves the restored Training key in place; it does not delete it.

## 12. Acceptance criteria

1. A native backup can include the complete, checked Training store.
2. A native restore replaces Training only when the file contains a valid
   Training section and the user confirms; otherwise local Training is unchanged.
3. No active/unfinished Training session can be exported or restored.
4. Training is not written to Drive snapshots or csTimer imports.
5. A failure at any replacement step rolls back every captured key, including
   Training, or leaves the existing recovery journal for startup recovery.
6. Training Hub, Practice History, reports and Algorithms reflect restored data
   without reload-only stale state.
7. A complete native backup above 10 MB can be exported as a checked `.json.gz`
   file and read back on a current browser, within the documented caps.
8. Corrupt, oversized, truncated or bomb-like files fail before mutation.
9. Existing JSON backups, Drive sync, csTimer import, onboarding and recovery
   flows keep their current behavior and caps.
10. Focused unit and Chromium tests, typecheck, lint and production build pass;
    the full suite is run only when explicitly requested.

## 13. Implementation order

1. Add pure Training backup-section validation/cloning and optional `Backup`
   field; add round-trip tests.
2. Add portable limits, gzip export/import helpers and tests that do not touch
   the app yet.
3. Wire native export eligibility, Training inclusion and async UI.
4. Wire native import preview and confirmation.
5. Extend the replacement journal/durable replacement with Training and add
   failure/startup tests.
6. Add controller adoption and update Training UI after restore.
7. Update README, `KNOWN_LIMITATIONS.md`, Training status/memory and `STATUS.md`
   with the delivered behavior and measured limits.
8. Run focused Vitest, Chromium E2E, production build and offline verification.

## 14. Deferred or delivered separately

- Training Google Drive synchronization, conflict review, tombstones, retention
  and multi-device merging (F5) were outside this design and are delivered by the
  separate-file implementation plan
  [TRAINING_DRIVE_SYNC_PLAN.md](TRAINING_DRIVE_SYNC_PLAN.md): manual
  replace-only backup/restore plus merge-based sync with its own state and
  retention. Solve snapshots still exclude Training.
- Automatic local Training retention or aggregation (F10). No local history is
  deleted or pruned by this work. Remote Training snapshots always keep the
  newest snapshot per device and use separate configurable count/age cleanup
  (default keep 10 / 30 days); manual upload cleanup keeps the newest five own
  snapshots.
- A Drive snapshot protocol v2 for files above 10 MB.
- Encryption of native backups.
- A multi-part archive for payloads above the 64 MB decoded / 16 MB compressed
  portable caps.
- Training import through onboarding.

---

## 15. Implementation record — 2026-11-20

Implemented as specified, with the 2026-11-20 follow-up recorded in Training
memory E19. The pure section helper is
`src/lib/training/backupSection.ts`; portable gzip transport and caps are in
`src/lib/portableBackup.ts`; the replacement journal and controller adoption
cover the Training key and, for a Training restore, the
`cubelab:training-sync:v1` ledger key. Restore clears stale training-sync
tombstones/conflicts/approvals while preserving the Training device ID and
preferences. Focused Vitest, Chromium E2E, typecheck, lint and the production
build passed for the delivered backup/Drive work. Measurements, exact commands
and remaining limits are recorded in
[STATUS.md](../../STATUS.md#training-history-backup--2026-11-20) and the Training
memory entries E17/E19.
