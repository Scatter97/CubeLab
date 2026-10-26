# CubeLab audit — bug report

**Date:** 2026-10-26
**Scope:** Full repository (`src/`, `e2e/`, build and storage configuration). No source changes were made.
**Auditor stance:** the existing green suite is the baseline, not proof of correctness. Pure logic, hooks, components, sync, Drive, persistence, and UI flows were read and, for the statistics engine, fuzzed against a naive reference.

## Verification baseline

Run with Node **v22.23.2** (the machine default Node 18 cannot run Vite 8 / rolldown).

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm test` | pass — 20 files, 254 tests |
| `npm run build` | pass |
| `npm run test:e2e` | **not run** in this audit |

Additional check performed: a temporary fuzz test compared `calculateBestAverage` and `calculateBestMeanOf3` against a naive all-window reference (400 randomized trials each, sizes 3/5/12/25, duplicate times, `+2`, and DNFs). No mismatch. The temporary test file was removed; `git status` is clean.

Severity counts: **3 high, 9 medium, 8 low, 0 critical.**

---

## High

### H1. Undo after a deletion has synced is not durable — the solve disappears again

**Where:** `src/App.tsx:462-477`, `src/hooks/useSync.ts:312-326`, `src/lib/sync.ts:261-262`, `src/lib/sync.ts:342`

**What happens:** deleting a solve records a tombstone (`sync.recordDeletion`). The Undo toast calls `sync.clearDeletion`, which removes the tombstone only from local `cubelab:sync:v1`, then restores the solve locally. If the deletion was already published (or another device already downloaded it), the next synchronization merges the remote tombstone back in (`mergeTombstones`, then `deletedSolveIds` filtering). The restored solve is removed again, and the merged envelope re-uploads the tombstone, so it can never be undone through the current protocol.

**Repro:**
1. Enable sync, delete a solve, let a sync complete.
2. Click **Undo** in the toast.
3. Trigger **Sync now**.
4. The solve vanishes again, with no error or warning.

**Impact:** user-visible data loss after a recovery action that appears to succeed.

**Fix direction:** either suppress Undo once the tombstone may have been published, or add a tombstone-revocation/resurrection record (`restoredAt` or a new solve ID that wins against the tombstone) that is itself merged across devices. A local-only `clearDeletion` is not sufficient.

---

### H2. `useSessions` reads and re-parses `cubelab:sync:v1` on every render; the device ID is unstable until sync is first persisted

**Where:** `src/hooks/useSessions.ts:63`, `src/hooks/useSync.ts:141`, `src/lib/syncStorage.ts:198-217`, `src/hooks/useTimer.ts:102-115`

**What happens:**
- `const syncDeviceId = loadSyncStorage().runtime.deviceId` is executed during every render. `loadSyncStorage` calls `localStorage.getItem` and `JSON.parse` plus full validation (`src/lib/syncStorage.ts:299-308`).
- `useTimer` calls `setClock(at)` from `requestAnimationFrame` while inspection, holding, ready, or running (`src/hooks/useTimer.ts:106-111`). That re-renders `App` and therefore `useSessions` at display refresh rate — roughly 60 storage reads and parses per second during timing.
- If `cubelab:sync:v1` has never been written, `loadSyncStorage()` falls back to `createDefaultSyncStorage()`, which calls `createDeviceId()` (`src/lib/syncStorage.ts:198-203`). A **new random device ID is generated on every call**. `useSync` does not persist its default record on mount, so the key can remain absent until a setting changes, a deletion is recorded, or sync is enabled.

**Impact:**
- Avoidable main-thread work during the most latency-sensitive part of the app.
- Solve `fieldUpdates.editorId` and tombstones can be stamped with different random device IDs across renders. Editor ID is the deterministic tiebreak for equal timestamps (`src/lib/solveMerge.ts:43-45`, `src/lib/sessionMetadata.ts:78-81`), so this weakens conflict determinism and makes provenance unreliable.

**Fix direction:** load the sync device ID once (`useState`/`useRef`) or pass it down from `useSync`; persist the default sync record once on mount. Do not call storage loaders from render bodies.

---

### H3. The destructive Merge Sessions confirmation survives close and reopen

**Where:** `src/components/MergeSessionsDialog.tsx:37-43`, `67-68`, `222-227`

**What happens:** the dialog keeps `targetId`, `sourceId`, and `phrase` in component state. When closed, it returns `null` but stays mounted (`if (!open) return null` after the hooks). Reopening restores the previous phrase. If the user previously typed `MERGE SESSIONS`, the next open can show the confirmation already filled and **Merge sessions** already enabled.

**Repro:**
1. Open **Review Merge**, type `MERGE SESSIONS`, close without merging.
2. Reopen the dialog.
3. The phrase is still present and the destructive action is immediately available.

**Impact:** the typed-confirmation safeguard is bypassed for a destructive, irreversible action (the source session is removed).

**Fix direction:** reset `targetId`, `sourceId`, and `phrase` when `open` transitions to true, or key the dialog body by open state the way `SessionSettingsDialog` and `SessionSetupDialog` do.

---

## Medium

### M1. "Delete remote backup" is disabled when this browser has no local `remoteFileId`, even though deletion is designed to remove every device's snapshot

**Where:** `src/components/DriveBackupDialog.tsx:134-135`, `590-597`; `src/lib/remoteBackups.ts:121-147`; `src/hooks/useDriveBackup.ts:210-238`

**What happens:** `deleteAllRemoteBackups` lists every app-data snapshot and deletes all of them; `knownFileId` is only an extra ID to include. But the button is disabled with `!remoteFileId || ... || !remoteFileId`. A browser that has never uploaded (fresh install, `remoteFileId` null) cannot delete snapshots created by its other devices, even though it can list them after connecting.

**Impact:** users cannot perform the documented "delete every CubeLab snapshot" recovery from a browser that has no own file.

**Fix direction:** gate deletion on being connected/configured and not busy, not on owning a file. Keep the confirmation.

---

### M2. Google OAuth requests identity scopes beyond the documented app-data scope

**Where:** `src/lib/driveTransport.ts:241`; `src/lib/driveTransport.ts:359-374`; `src/lib/driveTransport.ts:32`

**What happens:** the token request asks for:

```
drive.appdata openid email https://www.googleapis.com/auth/userinfo.email
```

and `connect()` calls `https://www.googleapis.com/oauth2/v3/userinfo` to obtain a display label. The README describes an access token "for the app-data scope", and `DRIVE_BACKUP_SCOPE` is only `drive.appdata`.

**Impact:** broader consent than the product documents, and an avoidable identity-network call. Users are asked to grant email/profile access for a local-first, no-account app.

**Fix direction:** request only `drive.appdata`; drop the userinfo call and the stored email label, or document the identity scopes explicitly and justify them.

---

### M3. Remote sync envelopes are shallow-cast, so malformed tombstones/conflicts can abort synchronization

**Where:** `src/lib/sync.ts:692-711`; `src/lib/sync.ts:29-61`; `src/lib/sync.ts:510-523`; `src/lib/syncStorage.ts:119-173`

**What happens:** `parseRemoteSyncEnvelope` validates only `protocolVersion`, `revision`, `deviceId`, and `updatedAt`. It then casts `record.tombstones`, `record.conflicts`, and `record.sessionRedirects` directly. A snapshot containing `tombstones: [null]`, `deletedAt: "x"`, or a conflict without values passes parsing. Later, `mergeTombstones` reads `tombstone.kind` (throws on `null`), `Math.max(0, ...deletedAt)` coerces bad values, and the sync catch block records a failure. Well-formed but stale entries are not the issue; **untrusted, structurally invalid entries are**.

`syncStorage.ts` already has robust `isTombstone` / `isConflict` / redirect guards, but they are private and not used here. `parseBackup` also accepts the envelope via this function.

**Impact:** a corrupt or malicious app-data snapshot can wedge synchronization instead of being rejected with a clear "invalid snapshot" error. This conflicts with the stated "invalid snapshots are rejected before local mutation".

**Fix direction:** export and reuse the per-entry validators; reject or filter invalid entries and report the snapshot as invalid rather than letting a cast reach merge code.

---

### M4. Settings Drive copy promises features the UI does not have, and the Data note says backups are never uploaded

**Where:** `src/components/SettingsDialog.tsx:645-661`; `src/hooks/useDriveBackup.ts:113-208`; `README.md:180-182`

**What happens:**
- The Drive button description says "Manually back up or restore with Google Drive app data", but `DriveBackupDialog` only exposes Connect, Sync now, automatic settings, and Delete. `backupNow` and `restoreFromDrive` are dead code used only by `useDriveBackup.test.ts`.
- The README explicitly states: "There is no separate manual **Backup now** button and no **Restore from Drive** button."
- Directly below both buttons, a note reads "Backups stay on this device. CubeLab never uploads them." That is false for the Drive path directly above it.

**Impact:** misleading data-handling copy in the most privacy-sensitive part of the UI, plus a promise of a recovery path that does not exist.

**Fix direction:** reword the Drive description to "Synchronize with Google Drive app data"; scope the "never uploads" note to the local JSON backup only; remove or wire the dead manual functions.

---

### M5. Changing a session's event updates the name field but does not save the rename unless the name input later loses focus

**Where:** `src/components/SessionSettingsDialog.tsx:167-190`; name `onBlur` at `109-125`

**What happens:** changing the Event select calls `setName(eventLabel(next))` when the current name is default-like, but only the name input's `onBlur` calls `onRenameSession`. If the name input never had focus, no blur occurs, so the session keeps its old name. The dialog displays the new label until it is closed; the next open shows the old name again. Escape/backdrop close makes this easy to hit.

**Impact:** confusing state divergence and a rename the user believes happened but did not.

**Fix direction:** call `onRenameSession` immediately when the event-driven default name is chosen, or rename on submit/close, not only on blur.

---

### M6. A per-session inspection override can be created but never cleared back to "use global"

**Where:** `src/components/SessionSettingsDialog.tsx:220-241`; `src/lib/sessions.ts:281-307`; `src/App.tsx:257-290`

**What happens:** the switch calls `onSetInspection(!effectiveInspectionEnabled)`, which always writes a boolean override. The data model supports `inspectionEnabled: undefined` (meaning "follow global") and `setSessionPreferences` explicitly supports deleting a key, but no UI path produces it. Once toggled, a session permanently overrides the global default.

**Impact:** the global inspection setting silently stops applying to that session, and the described "sessions without one follow the global value" state is unreachable through the UI.

**Fix direction:** add a "Use global setting" action/three-state control that calls `setInspection` with `undefined`, or make the switch's off state clear the override.

---

### M7. Import validation accepts solve/session event mismatches that later make synchronization throw

**Where:** `src/lib/storage.ts:222-260`, `243-250`; `src/lib/sync.ts:341-345`, `468-470`; `src/lib/sessions.ts:507-517`

**What happens:** `parseSession` defaults a missing/invalid session `event` to `'333'` and never checks that each solve's `event` matches the session. A backup can therefore import a session labelled 3×3 that contains 2×2 solves. `mergeSessionsData` explicitly throws on the first mismatch (`Solve ... does not match its session event; sync stopped to preserve data`). Because the mismatch is persisted, every later sync fails the same way until the user manually repairs or deletes the data.

**Impact:** a formally "valid" import can permanently wedge cloud sync with no in-app repair path.

**Fix direction:** reject or drop mismatched solves at parse time, or normalize the session event from its solves; validate the same invariant in `parseBackup` and `parseSessionsData`.

---

### M8. `mergeSolveFields` fabricates persisted field metadata for equal legacy values

**Where:** `src/lib/solveMerge.ts:18-31`, `119-127`; contrast `src/lib/sessionMetadata.ts:183-199`

**What happens:** when both sides have the same value, `mergeSolveFields` always assigns `fieldUpdates[field]` from `getFieldUpdate`. For a legacy solve with no `fieldUpdates`, that helper fabricates `{ updatedAt: createdAt, editorId: 'legacy' }`. The merged solve is then persisted with synthetic history. `mergeSessionMetadata` deliberately avoids this for equal legacy fields ("Equal legacy values must not acquire fabricated persisted metadata").

**Impact:** violates the documented merge invariant. The fabricated timestamps can later participate in conflict comparison and make a no-op merge look like an edit, degrading deterministic convergence.

**Fix direction:** in the equal-value branch, only carry explicit metadata (as `sessionMetadata.mergeField` does); leave `fieldUpdates` absent when neither side had one.

---

### M9. Custom average size input clamps and rejects on every keystroke, so normal typing cannot reach many values

**Where:** `src/components/SettingsDialog.tsx:65-79`, `462-477`; `src/lib/statDefinitions.ts:29-49`

**What happens:** the input is controlled by `average.size` and every `onChange` rounds, clamps to `[3, 10000]`, and rejects built-in sizes immediately. Clearing the field yields `Number('' || MIN) = 3`; typing `1` then becomes `3`; typing `100` therefore becomes `300`, and intermediate built-in values (5, 12, 25, 100, …) are rejected with an error instead of allowing the user to finish typing. The value can only be changed reliably with the spinner or by editing around the existing digits.

**Impact:** custom averages are difficult or impossible to configure for many intended sizes.

**Fix direction:** keep a draft string per row, validate on blur/Enter, and commit only a complete valid value. Don't clamp mid-edit.

---

## Low

### L1. `createBackup` is not actually a detached snapshot

**Where:** `src/lib/backup.ts:33-54`

`settings: { ...settings }` shallow-copies. `statVisibility` and `customAverages` remain shared references with live state. Current mutation code replaces these immutably, so this is latent rather than an active corruption, but the function's contract and comment are wrong.

**Fix:** deep-copy nested settings, or state explicitly that callers must not mutate nested objects.

### L2. The inspection-warning visual pulse depends on the alert channel

**Where:** `src/App.tsx:187-200`, `354-361`

Inspection warnings call `triggerAlert(..., forceVisual = false, ...)`, so the `timer-alert` element is rendered only when `alertChannel` includes `visual`. With **Sound only** or **Haptic**, the only warning is the `sr-only` live-region announcement (`src/App.tsx:966-967`). `AGENTS.md` says enabled warnings always show a direction-aware visual pulse. Either the invariant or the implementation should change; currently sound-only users get no visible warning.

### L3. Disconnecting Google Drive leaves automatic synchronization enabled

**Where:** `src/hooks/useDriveBackup.ts:106-111`; `src/hooks/useSync.ts:507-573`

`disconnect()` clears the token and local phase but does not clear `sync.preferences.enabled`. The next scheduled sync then sets `auth-required` and stops. The UI shows "Disconnected" while the app still advertises automatic sync as on.

**Fix:** disable automatic sync (or prompt) on disconnect, and make the state coherent.

### L4. `customAverageError` survives dialog close/reopen

**Where:** `src/components/SettingsDialog.tsx:40-52`

The error is only cleared by a successful custom-average update. Closing and reopening Settings can show a stale error for a row that was removed or a value that is no longer present.

### L5. Stored sync `mode` is silently overwritten with `'combined'`

**Where:** `src/lib/syncStorage.ts:175-188` (`mode: 'combined'`)

`SyncMode` declares `'time' | 'solve' | 'combined'`, and `useSync` reads `preferences.mode`, but the parser discards every value except `combined`. No UI exposes mode, so this is currently dead configuration; if a future UI offers it, the selection will not survive reload.

### L6. Countdown warning labels and comments are internally inconsistent

**Where:** `src/components/SettingsDialog.tsx:296-321`, `342-350`; `src/lib/alerts.ts:123-150`

Both directions render the same checkbox labels ("8 seconds elapsed" / "12 seconds elapsed"); only the paragraph below explains the countdown's 7/3 seconds remaining. The `alerts.ts` JSDoc says "8s and 3s remaining" while the code uses 7s remaining for the first warning. Behavior matches the README (7/3); the labels/comments are the problem. Minor UX/documentation confusion, not a calculation bug.

### L7. Legacy migration uses spread `Math.min/max` over the entire solve history

**Where:** `src/lib/storage.ts:490-507`

`Math.min(...timestamps)` and `Math.max(...timestamps)` are used for the migrated session's timestamps. A legacy history large enough to exceed the argument limit throws a `RangeError` during migration, which the surrounding `loadSessions` try/catch does not cover (the call is outside the `try`). This requires an unusually large legacy array, but the failure mode is a hard load error rather than a fallback.

**Fix:** reduce over the array instead of spreading it.

### L8. Drive `connect()` stores the first listed snapshot as this browser's `remoteFileId`

**Where:** `src/hooks/useDriveBackup.ts:82-104`; `src/components/DriveBackupDialog.tsx:134-135`

`files[0]` may be another device's snapshot. The value is then shown as "remote backup" metadata and feeds the delete gating in M1. The upload path correctly targets the per-device filename, so this is display/state accuracy rather than overwrite risk.

---

## Areas checked with no new defect found

- **Timer state machine** (`src/timer/machine.ts`): phase transitions, inspection penalty boundaries, hold timing, and same-frame duplicate protection in `useTimer` are coherent.
- **WCA statistics** (`src/lib/stats.ts`): trimmed averages, DNF trimming, `+2`, mo3, and the Fenwick best-average implementation matched the naive reference under randomized fuzzing.
- **Storage recovery** (`src/lib/storage.ts`): corrupt records are field-recovered, versions 1–4 are accepted, and the legacy `cubelab:solves:v1` migration is limited to 3×3.
- **Session name/comment validation**, duplicate-name detection, and session deletion invariants.
- **Settings merge**: field timestamps, exact-value conflict approvals, and deterministic tiebreaks are implemented consistently.
- **Redirect normalization** and session-tombstone recovery by stable solve ID.
- **Drive pagination** (`fetchDriveBackupFiles`): failed pages, `incompleteSearch`, malformed/repeated tokens, and duplicate file IDs are rejected rather than silently truncated.
- **Backup import safety**: invalid JSON/app marker/version/settings are rejected before mutation; the 10 MB cap is enforced for remote reads.
- **Modal focus handling** and Space/Enter separation (aside from the issues above).

## Documented limitations (not counted as new bugs)

`PATCH_LIMITATIONS.md` and `README.md` already disclose: no verified Drive compare-and-swap, same-device copied-profile races, eventual consistency, the lack of a separate manual Backup/Restore button, and that Drive is not a substitute for local JSON backups. Those were not re-reported except where the code or UI contradicts the documentation (M2, M4).

## Suggested fix order

1. H1 (data loss) and H3 (confirmation bypass).
2. H2 (timer-time storage churn + unstable device ID).
3. M1/M3 (remote delete reachability and malformed-snapshot handling) because both affect recovery from bad cloud state.
4. M5–M9 (session/import/merge/input correctness).
5. Copy, scope, and dead-code cleanup (M2, M4, L1–L8).
