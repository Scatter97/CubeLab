# CubeLab Audit Fix Progress

**Audit source:** `docs/audit-bug-report.md` (2026-10-26)
**Remediation started:** 2026-10-26
**Branch:** `master`
**Baseline commit:** `b454029` — Harden Drive pagination, same-device writes, and duplicate review
**Baseline checks (Node v22.23.2):** `typecheck` pass, `lint` pass, `test` 254/254 pass, `build` pass. E2E not run at baseline.

Statuses: `NOT STARTED`, `IN PROGRESS`, `FIXED`, `TESTED`, `BLOCKED`, `NOT A BUG`.
`FIXED` means source changed and focused unit tests pass. `TESTED` means all
required unit/E2E evidence for that finding has passed.

## High priority

| ID | Verdict | Status | Change | Evidence |
| --- | --- | --- | --- | --- |
| H1 | Confirmed | TESTED | Tombstones gain optional `restoredAt`; Undo now updates the tombstone instead of deleting it. `mergeTombstones` compares the later deletion/restoration event deterministically, keeps the restoration record for propagation, and treats ties as deletions. A later delete wins, so intentional deletion is not resurrected. | `src/lib/sync.test.ts` durable-undo suite; multi-device stress test still to add. |
| H2 | Confirmed | TESTED | Device identity is cached module-wide and persisted on first load. `useSessions` resolves it once with `useState` instead of re-parsing `cubelab:sync:v1` in the render body. Legacy IDs are preserved. | `src/lib/syncStorage.test.ts`; timer-frame render behavior not directly measured. |
| H3 | Confirmed | TESTED | Merge dialog body is mounted only while open; target/source/phrase state cannot survive close/reopen. Changing either selection clears the typed phrase. | Playwright coverage still to add. |

## Medium priority

| ID | Verdict | Status | Change | Evidence |
| --- | --- | --- | --- | --- |
| M1 | Confirmed | TESTED | Delete remote backups is gated on configured/not-busy, not on owning a `remoteFileId`. Delete connects first when needed; zero snapshots reports a clear message. | Hook/E2E coverage still to add. |
| M2 | Confirmed | TESTED | Google token requests only `drive.appdata`; the userinfo/email call is removed. The UI keeps a generic connection label. | Transport test still to add. |
| M3 | Confirmed | TESTED | `isTombstone`, `isConflict`, `isSessionRedirect`, `isFieldUpdate` are exported and reused by `parseRemoteSyncEnvelope`. Invalid array entries reject the whole envelope. `parseBackup` now rejects a present-but-invalid sync envelope instead of silently dropping it. | `src/lib/backup.test.ts` malformed-envelope table. |
| M4 | Confirmed | TESTED | Settings/Data copy distinguishes local JSON backups from opt-in Drive upload. Drive description no longer promises manual backup/restore. Dead manual hook functions remain internal/tested but are no longer advertised. | Copy review; docs update pending. |
| M5 | Confirmed | TESTED | Event-driven default session rename is committed immediately instead of waiting for the name field to blur. | E2E still to add. |
| M6 | Confirmed | TESTED | `setSessionInspection` accepts `undefined`, removes both top-level and legacy preference overrides, stamps removal metadata, and merge now honors an explicit "use global" removal. UI exposes a `Use global setting` action. | Session metadata/UI tests still to add. |
| M7 | Confirmed | TESTED | `findSessionEventMismatches` rejects mixed-event imports with an actionable message before any confirmation or mutation. Legacy backups without a session event still default to 333 and import. | `src/lib/backup.test.ts`. |
| M8 | Confirmed | TESTED | Equal solve values now carry only explicit field metadata; equal legacy values leave `fieldUpdates` absent. | Focused merge test still to add. |
| M9 | Confirmed | TESTED | Custom average rows keep a draft string, validate on blur/Enter, and commit whole values without per-keystroke clamping. | Playwright typing test still to add. |

## Low priority

| ID | Verdict | Status | Change | Evidence |
| --- | --- | --- | --- | --- |
| L1 | Confirmed | TESTED | `createBackup` deep-copies nested settings, session preferences/field metadata, and solve field metadata. | `src/lib/backup.test.ts` mutation test. |
| L2 | Confirmed | TESTED | Inspection warnings now force the visual pulse regardless of the sound/haptic channel, matching `AGENTS.md` and the Settings copy. | E2E non-visual channel test still to add. |
| L3 | Confirmed | TESTED | Disconnect also disables automatic synchronization and shows an explicit toast; reconnect re-enables it through the existing connect flow. | E2E still to add. |
| L4 | Confirmed | TESTED | Settings body remounts per open, so stale custom-average errors do not survive close/reopen; removing/changing rows clears errors. | Covered by the Settings/M9 E2E to add. |
| L5 | Confirmed | TESTED | Obsolete `mode` was removed from `SyncPreferences` and parsing; legacy records with an extra `mode` remain readable and the value is ignored. | `src/lib/syncStorage.test.ts` legacy-preferences test. |
| L6 | Confirmed | TESTED | Countdown warning labels now read 7/3 seconds remaining; count-up reads 8/12 seconds elapsed. Comments and settings note updated. | E2E label assertions need updating/adding. |
| L7 | Confirmed | TESTED | Legacy session timestamps use a single reduce instead of spreading the whole solve array into `Math.min/max`. | Large-array regression test still to add. |
| L8 | Confirmed | TESTED | `connect()` and `restoreFromDrive()` associate only this device's snapshot (matched by sanitized device filename), never `files[0]` from another device. | Hook test still to add. |

## Compatibility and migrations

- Snapshot format is unchanged. `Tombstone.restoredAt` is an additive optional
  field; older snapshots remain readable. Old clients that do not understand
  `restoredAt` would still hide a restored solve, so all CubeLab builds sharing
  a Drive account should be updated together.
- `SyncPreferences.mode` is removed from new records. Existing records carrying
  `mode` are accepted and the field is ignored.
- No session/settings schema version bump was required: the changes are
  additive and validated by the existing field-level recovery paths.
- Device identity persistence now happens on the first `loadSyncStorage()` call
  when the sync key is absent. Existing installations keep their stored ID.

## Regression coverage added 2026-10-26

- M8: equal legacy solve values keep no fabricated field metadata; explicit
  metadata is carried forward when one side has it (`src/lib/sync.test.ts`).
- M6: clearing an inspection override removes both representations and stamps
  removal provenance (`src/lib/sessions.test.ts`,
  `src/lib/sessionMetadata.test.ts`).
- L7: a 130,000-solve legacy history migrates without argument-spread errors
  (`src/lib/storage.test.ts`).
- H1: a delayed third device receives a durable undo and a later deletion still
  wins (`src/lib/sync.stress.test.ts`).
- M2: OAuth requests only `drive.appdata` and makes no userinfo call
  (`src/lib/driveTransport.test.ts`).
- M1/L8: delete-all works without a local snapshot; connect/restore never
  associate another device's file (`src/hooks/useDriveBackup.test.ts`).
- Playwright now covers H3, M1, M5, M6, M9, L2, L3, L4, and L6
  (`e2e/timer.spec.ts`).

## Verification evidence

Run 2026-10-26 with Node v22.23.2: `npm run typecheck` passed, `npm run lint`
passed, `npm test` **283/283 passed** in 21 files, `npm run build` passed
(95 modules; PWA 22 entries, 2284.38 KiB), `npm run test:e2e` **29/29 passed**,
and `git diff --check` passed. `npm run check` was not rerun as one command.

## Remaining work

1. Update README/AGENTS/PATCH_LIMITATIONS and PROJECT_PROGRESS.
2. Run `npm run check` for one final recorded result.
3. Commit the verified changes and finalize `NEXT_SESSION_HANDOFF.md`.
