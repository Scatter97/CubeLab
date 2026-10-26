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
| H1 | Confirmed | FIXED | Tombstones gain optional `restoredAt`; Undo now updates the tombstone instead of deleting it. `mergeTombstones` compares the later deletion/restoration event deterministically, keeps the restoration record for propagation, and treats ties as deletions. A later delete wins, so intentional deletion is not resurrected. | `src/lib/sync.test.ts` durable-undo suite; multi-device stress test still to add. |
| H2 | Confirmed | FIXED | Device identity is cached module-wide and persisted on first load. `useSessions` resolves it once with `useState` instead of re-parsing `cubelab:sync:v1` in the render body. Legacy IDs are preserved. | `src/lib/syncStorage.test.ts`; timer-frame render behavior not directly measured. |
| H3 | Confirmed | FIXED | Merge dialog body is mounted only while open; target/source/phrase state cannot survive close/reopen. Changing either selection clears the typed phrase. | Playwright coverage still to add. |

## Medium priority

| ID | Verdict | Status | Change | Evidence |
| --- | --- | --- | --- | --- |
| M1 | Confirmed | FIXED | Delete remote backups is gated on configured/not-busy, not on owning a `remoteFileId`. Delete connects first when needed; zero snapshots reports a clear message. | Hook/E2E coverage still to add. |
| M2 | Confirmed | FIXED | Google token requests only `drive.appdata`; the userinfo/email call is removed. The UI keeps a generic connection label. | Transport test still to add. |
| M3 | Confirmed | FIXED | `isTombstone`, `isConflict`, `isSessionRedirect`, `isFieldUpdate` are exported and reused by `parseRemoteSyncEnvelope`. Invalid array entries reject the whole envelope. `parseBackup` now rejects a present-but-invalid sync envelope instead of silently dropping it. | `src/lib/backup.test.ts` malformed-envelope table. |
| M4 | Confirmed | FIXED | Settings/Data copy distinguishes local JSON backups from opt-in Drive upload. Drive description no longer promises manual backup/restore. Dead manual hook functions remain internal/tested but are no longer advertised. | Copy review; docs update pending. |
| M5 | Confirmed | FIXED | Event-driven default session rename is committed immediately instead of waiting for the name field to blur. | E2E still to add. |
| M6 | Confirmed | FIXED | `setSessionInspection` accepts `undefined`, removes both top-level and legacy preference overrides, stamps removal metadata, and merge now honors an explicit "use global" removal. UI exposes a `Use global setting` action. | Session metadata/UI tests still to add. |
| M7 | Confirmed | FIXED | `findSessionEventMismatches` rejects mixed-event imports with an actionable message before any confirmation or mutation. Legacy backups without a session event still default to 333 and import. | `src/lib/backup.test.ts`. |
| M8 | Confirmed | FIXED | Equal solve values now carry only explicit field metadata; equal legacy values leave `fieldUpdates` absent. | Focused merge test still to add. |
| M9 | Confirmed | FIXED | Custom average rows keep a draft string, validate on blur/Enter, and commit whole values without per-keystroke clamping. | Playwright typing test still to add. |

## Low priority

| ID | Verdict | Status | Change | Evidence |
| --- | --- | --- | --- | --- |
| L1 | Confirmed | FIXED | `createBackup` deep-copies nested settings, session preferences/field metadata, and solve field metadata. | `src/lib/backup.test.ts` mutation test. |
| L2 | Confirmed | FIXED | Inspection warnings now force the visual pulse regardless of the sound/haptic channel, matching `AGENTS.md` and the Settings copy. | E2E non-visual channel test still to add. |
| L3 | Confirmed | FIXED | Disconnect also disables automatic synchronization and shows an explicit toast; reconnect re-enables it through the existing connect flow. | E2E still to add. |
| L4 | Confirmed | FIXED | Settings body remounts per open, so stale custom-average errors do not survive close/reopen; removing/changing rows clears errors. | Covered by the Settings/M9 E2E to add. |
| L5 | Confirmed | FIXED | Obsolete `mode` was removed from `SyncPreferences` and parsing; legacy records with an extra `mode` remain readable and the value is ignored. | `src/lib/syncStorage.test.ts` legacy-preferences test. |
| L6 | Confirmed | FIXED | Countdown warning labels now read 7/3 seconds remaining; count-up reads 8/12 seconds elapsed. Comments and settings note updated. | E2E label assertions need updating/adding. |
| L7 | Confirmed | FIXED | Legacy session timestamps use a single reduce instead of spreading the whole solve array into `Math.min/max`. | Large-array regression test still to add. |
| L8 | Confirmed | FIXED | `connect()` and `restoreFromDrive()` associate only this device's snapshot (matched by sanitized device filename), never `files[0]` from another device. | Hook test still to add. |

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

## Remaining work

1. Add missing regression tests listed above (merge metadata, inspection merge,
   legacy timestamp reduction, multi-device undo).
2. Update Playwright coverage for H3, M1, M5, M6, M9, L2, L3, L6.
3. Update README/AGENTS/PATCH_LIMITATIONS where behavior or permissions changed.
4. Run the full required suite including E2E and `npm run check`.
5. Refresh `NEXT_SESSION_HANDOFF.md` with final results.
