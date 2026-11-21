---
name: cubelab-sync-safety
description: Safely change or review CubeLab Google Drive synchronization, Training Drive backup/merge, backup/import/restore, storage migrations, tombstones, conflict approvals, snapshot retention, or cross-tab data reconciliation. Use whenever code may replace, merge, recover, or publish solve/session or Training data.
---

# CubeLab sync safety

Read `AGENTS.md` data-safety invariants first. All paths and commands below use the repository root. Use synthetic data and memory/mock transports for this workflow.

For changes to merging, recovery, conflict review or snapshot lifecycle, read
[references/sync-contracts.md](references/sync-contracts.md) for the existing
protocol contracts, then the affected implementation and tests.

## Trace the operation

1. Identify whether the operation is a local mutation, native backup replacement, csTimer addition, automatic merge, manual Drive restore, or cloud cleanup. Read `src/App.tsx` confirmation handlers and `src/components/DataDialog.tsx` for import semantics: native backups replace after confirmation; csTimer imports add sessions and retain existing settings. Do not generalize them into one replacement path.
2. Trace validation through `src/lib/storage.ts`, `src/lib/backup.ts`, `src/lib/portableBackup.ts`, `src/lib/csTimerImport.ts`, and `src/lib/syncStorage.ts`. Native backup v1 may carry an optional checked Training section from `src/lib/training/backupSection.ts`; restore it replace-only after the native confirmation. A Training restore must clear stale `cubelab:training-sync:v1` tombstones, conflicts and approvals through `clearTrainingSyncProvenance` while preserving the Training device ID and sync preferences; the replacement journal must capture the `trainingSync` key. Training has a **separate** Drive family: `src/lib/trainingDrive.ts` owns `cubelab-training-*` envelopes, manual replace-only restore and Training-only retention; `src/lib/trainingSync.ts` owns the pure merge; `src/lib/trainingSyncStorage.ts` owns `cubelab:training-sync:v1` and the one Training device ID shared by manual backup and sync. Never put Training in `SyncEnvelope`, solve snapshots or `cubelab:sync:v1`, and never use the solve 10 MB cap for Training. Check migration and malformed-input tests before changing a schema. Settings field timestamps belong to sync runtime, not the settings record.
3. For merging, read `src/lib/sync.ts`, `src/lib/solveMerge.ts`, `src/lib/sessionMetadata.ts`, `src/lib/settingsMerge.ts`, and `src/lib/sessionRedirects.ts` as relevant. For Training read `src/lib/trainingSync.ts`: only ended visits merge, attempt corrections use timestamp/manual review, calibration/custom-algorithm same-ID differences are conflicts, preferences are one coarse field, recognition counts are a high-water `max`, deletions use Training attempt/visit/preset tombstones with `restoredAt` Undo revocation, and the complete store must pass `assertTrainingData` before adoption or publication. Trace stable IDs, field timestamps, exact reviewed pairs, tombstone revocations and recovered-session IDs. Compare the full result, not only counts. Equal-time deletion, stale approvals, delayed snapshots and repeated merges need explicit assertions.
4. For orchestration, follow `src/hooks/useSync.ts`, `src/hooks/useDriveBackup.ts`, `src/hooks/useTrainingDriveBackup.ts`, and `src/hooks/useTrainingSync.ts` across every asynchronous boundary. Check timer activity, current refs/fingerprints, enabled/connection state and the shared write lock in `src/lib/driveCoordination.ts` before applying data or publishing. Training sync must not run during an active timer/Training attempt, pending Training save, continuity decision, calibration draft, replacement journal, pending solve recovery or native import, and must not upload per attempt. It must abort before adoption/publication if local Training or the ledger's tombstones, field updates or conflicts change during the run, report a retryable pending state and schedule at most one deferred retry. A crash-left `syncing` status normalizes to pending when enabled or disabled when sync is off. A solve or settings edit during upload must remain pending and intact.
5. For transport/retention, follow `src/lib/remoteBackups.ts`, `src/lib/driveTransport.ts`, and `src/lib/snapshotRetention.ts`; Training listing/cleanup lives in `src/lib/trainingDrive.ts`. Test complete pagination and invalid/oversized downloads before merging: unreadable or oversized remote Training files are skipped with a warning and must remain deletable in the UI without touching local history. Immutable uploads create unique snapshots; legacy fixed-name updates require ETag/If-Match. Solve cleanup must only select `cubelab-backup-*`; Training cleanup must only select `cubelab-training-*`, always keep the newest snapshot per device and apply the configurable count/age limits (default keep 10 / 30 days). Manual upload cleanup keeps the newest five own snapshots. Check cleanup reports partial failures. Never present this as a cross-file transaction.

Keep the active-session regressions: exact reviewed choices, reversed merges, metadata round trips and no restamping on cloud adoption. Session ordering is an ID-based record with deterministic timestamp/editor-ID convergence; missing IDs are appended, never dropped. Destructive delete-all records session tombstones with `knownSolveIds` plus solve tombstones before replacing the collection. csTimer preview/import must reject malformed supported rows and nonfinite/negative times or invalid dates before confirmation; valid rows must survive storage reload.

## Training-specific invariants

- Replace-only Training restore clears stale tombstones, conflicts, approvals and last-run/fingerprint state while preserving the Training device ID and sync preferences. Rollback must restore the prior ledger bytes through the `trainingSync` replacement key.
- A malformed or partial `cubelab:training-sync:v1` ledger rejects the whole ledger, blocks writes and keeps its original bytes. Never create a fresh ledger over unreadable provenance.
- Training sync aborts before adoption/publication when local Training or ledger tombstones/field updates/conflicts change mid-run; it reports a retryable pending state and retries at most once. Do not overwrite newer state with a stale merged result.
- Invalid or oversized remote Training files are skipped with a warning and can be deleted in the Drive UI; they must not block other snapshots or mutate local history.
- Manual Training backup and merge sync share one Training device ID from the ledger. A genuinely fresh device with no local Training store adopts remote preferences even when an older snapshot lacks field stamps.
- Archived-session deletion writes the visit and every known attempt tombstone in one ledger write; failed local deletion and Undo revoke the set. Preset deletion has Undo and revokes its tombstone. Recognition high-water counts are unchanged by deletion.
- Pre-named-session visits are end-only in current builds; do not restore an interactive legacy Setup/calibration/Timer report-notice path. Historical attribution recorded while tracking was on remains correctable after tracking is disabled, while attempts recorded off stay case-only.
- Retention always keeps the newest Training snapshot per device. Automatic cleanup uses configurable count/age limits (default keep 10 / 30 days); manual upload cleanup keeps the newest five own snapshots. Never let solve and Training cleanup select each other's files.

## Select regression coverage

Run the groups affected by the change; extend the existing test that best reproduces the risk.

```bash
# Merge identities, approvals, recovery and field provenance
npm test -- src/lib/sync.test.ts src/lib/sessionTransfers.test.ts src/lib/sessionMetadata.test.ts src/lib/settingsMerge.test.ts src/lib/sessionRedirects.test.ts
# Scheduling, in-flight edits, disabled tracking, repair, manual restore
npm test -- src/hooks/useSync.test.ts src/hooks/useDriveBackup.test.ts
# Training Drive envelope, merge, ledger recovery, tombstones, conflicts, manual restore and guards
npm test -- src/lib/trainingDrive.test.ts src/lib/trainingSync.test.ts src/lib/trainingSyncStorage.test.ts src/lib/trainingDeletion.test.ts src/lib/trainingSync.performance.test.ts src/hooks/useTrainingDriveBackup.test.tsx src/hooks/useTrainingSync.test.tsx
# Pagination, transport preconditions, locking, ownership and cleanup failures
npm test -- src/lib/driveTransport.test.ts src/lib/driveCoordination.test.ts src/lib/remoteBackups.test.ts src/lib/snapshotRetention.test.ts
# Migration, validation and import round trips
npm test -- src/lib/storage.test.ts src/lib/syncStorage.test.ts src/lib/driveStorage.test.ts src/lib/csTimerImport.test.ts src/hooks/useSettings.test.ts
# Training native backup, portable gzip, journal/adoption and restore provenance
npm test -- src/lib/backup.test.ts src/lib/portableBackup.test.ts src/lib/replacement.test.ts src/lib/startupRecovery.test.ts src/hooks/useDurableReplacement.test.ts src/hooks/useTraining.test.tsx src/lib/training/storage.test.ts src/components/DataDialog.test.tsx
# Multi-device convergence, shared-device writers and delayed undo
npm test -- src/lib/sync.stress.test.ts
```

For user-visible changes, exercise mock Drive/backup/conflict flows in `e2e/timer.spec.ts`, `e2e/training-backup.spec.ts` for Training native backup/restore and compressed large files, `e2e/training-drive-backup.spec.ts` for manual Training cloud backup/restore and guards, `e2e/training-drive-sync.spec.ts` for two-device Training merge/deletion/conflict/large history, `e2e/session-management.spec.ts` for ordering/delete-all/session summaries, trimming conflicts in `e2e/average-trimming.spec.ts`, or `e2e/cross-tab-timing.spec.ts` as appropriate. Run only the affected spec with `--project=chromium --workers=4` during development; do not omit these destructive-path checks, and reserve the full matrix for a significant release or explicit request. Then follow the tiered checks in `AGENTS.md` and report what ran or was skipped.

Do not run `npm run validate:drive` as routine verification: `src/validation/realProvider.validation.ts` creates and deletes remote test files. It needs separate explicit live-test authorization and a supplied short-lived credential. Never test repair by clearing real browser storage. Report mock evidence separately from live-provider evidence and retain the limitations in `KNOWN_LIMITATIONS.md`.
