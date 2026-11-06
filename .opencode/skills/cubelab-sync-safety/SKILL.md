---
name: cubelab-sync-safety
description: Safely change or review CubeLab Google Drive synchronization, backup/import/restore, storage migrations, tombstones, conflict approvals, snapshot retention, or cross-tab data reconciliation. Use whenever code may replace, merge, recover, or publish solve/session data.
---

# CubeLab sync safety

Read `AGENTS.md` data-safety invariants first. All paths and commands below use the repository root. Use synthetic data and memory/mock transports for this workflow.

For changes to merging, recovery, conflict review or snapshot lifecycle, read
[references/sync-contracts.md](references/sync-contracts.md) for the existing
protocol contracts, then the affected implementation and tests.

## Trace the operation

1. Identify whether the operation is a local mutation, native backup replacement, csTimer addition, automatic merge, manual Drive restore, or cloud cleanup. Read `src/App.tsx` confirmation handlers and `src/components/DataDialog.tsx` for import semantics: native backups replace after confirmation; csTimer imports add sessions and retain existing settings. Do not generalize them into one replacement path.
2. Trace validation through `src/lib/storage.ts`, `src/lib/backup.ts`, `src/lib/csTimerImport.ts`, and `src/lib/syncStorage.ts`. Check migration and malformed-input tests before changing a schema. Settings field timestamps belong to sync runtime, not the settings record.
3. For merging, read `src/lib/sync.ts`, `src/lib/solveMerge.ts`, `src/lib/sessionMetadata.ts`, `src/lib/settingsMerge.ts`, and `src/lib/sessionRedirects.ts` as relevant. Trace stable IDs, field timestamps, exact reviewed pairs, tombstone revocations and recovered-session IDs. Compare the full result, not only counts. Equal-time deletion, stale approvals, delayed snapshots and repeated merges need explicit assertions.
4. For orchestration, follow `src/hooks/useSync.ts` and `src/hooks/useDriveBackup.ts` across every asynchronous boundary. Check timer activity, current refs/fingerprints, enabled/connection state and the shared write lock in `src/lib/driveCoordination.ts` before applying data or publishing. A solve or settings edit during upload must remain pending and intact. Track deletions even when sync is disabled.
5. For transport/retention, follow `src/lib/remoteBackups.ts`, `src/lib/driveTransport.ts`, and `src/lib/snapshotRetention.ts`. Test complete pagination and invalid/oversized downloads before merging. Immutable uploads create unique snapshots; legacy fixed-name updates require ETag/If-Match. Check cleanup only selects superseded files under the existing ownership rules and reports partial failures. Never present this as a cross-file transaction.

Keep the active-session regressions: exact reviewed choices, reversed merges, metadata round trips and no restamping on cloud adoption. Session ordering is an ID-based record with deterministic timestamp/editor-ID convergence; missing IDs are appended, never dropped. Destructive delete-all records session tombstones with `knownSolveIds` plus solve tombstones before replacing the collection. csTimer preview/import must reject malformed supported rows and nonfinite/negative times or invalid dates before confirmation; valid rows must survive storage reload.

## Select regression coverage

Run the groups affected by the change; extend the existing test that best reproduces the risk.

```bash
# Merge identities, approvals, recovery and field provenance
npm test -- src/lib/sync.test.ts src/lib/sessionTransfers.test.ts src/lib/sessionMetadata.test.ts src/lib/settingsMerge.test.ts src/lib/sessionRedirects.test.ts
# Scheduling, in-flight edits, disabled tracking, repair, manual restore
npm test -- src/hooks/useSync.test.ts src/hooks/useDriveBackup.test.ts
# Pagination, transport preconditions, locking, ownership and cleanup failures
npm test -- src/lib/driveTransport.test.ts src/lib/driveCoordination.test.ts src/lib/remoteBackups.test.ts src/lib/snapshotRetention.test.ts
# Migration, validation and import round trips
npm test -- src/lib/storage.test.ts src/lib/syncStorage.test.ts src/lib/driveStorage.test.ts src/lib/backup.test.ts src/lib/csTimerImport.test.ts src/hooks/useSettings.test.ts
# Multi-device convergence, shared-device writers and delayed undo
npm test -- src/lib/sync.stress.test.ts
```

For user-visible changes, exercise mock Drive/backup/conflict flows in `e2e/timer.spec.ts`, `e2e/session-management.spec.ts` for ordering/delete-all/session summaries, trimming conflicts in `e2e/average-trimming.spec.ts`, or `e2e/cross-tab-timing.spec.ts` as appropriate. Run only the affected spec with `--project=chromium --workers=1` during development; do not omit these destructive-path checks, and reserve the full matrix for a significant release or explicit request. Then follow the tiered checks in `AGENTS.md` and report what ran or was skipped.

Do not run `npm run validate:drive` as routine verification: `src/validation/realProvider.validation.ts` creates and deletes remote test files. It needs separate explicit live-test authorization and a supplied short-lived credential. Never test repair by clearing real browser storage. Report mock evidence separately from live-provider evidence and retain the limitations in `KNOWN_LIMITATIONS.md`.
