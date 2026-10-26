# Next Session Handoff

**Updated:** 2026-10-26 (context checkpoint)
**Objective:** Independently verify and remediate the 2026-10-26 DeepSeek audit in `/home/joshua/cube-lab`.
**Branch:** `master`
**Latest commit:** `b454029f4f7b51b6817e06a1a4f51664590ba126`
**Working tree:** uncommitted remediation changes; `docs/audit-bug-report.md` and `src/lib/syncStorage.test.ts` are untracked.
**Node:** use `~/.nvm/versions/node/v22.23.2/bin/node` (system Node 18 cannot run Vite 8).

## Current status

> **CONTEXT CHECKPOINT:** the session hit ~193k/200k tokens. No further development
> was started. The working tree contains the remediation described below. Targeted
> typecheck/lint/unit tests pass, but the full build and E2E suites were not run
> after the last edits. Resume from this file, not from conversation memory.


The audit was reproduced and all findings were judged valid except none were
rejected. Core fixes for H1–H3, M1–M9, and L1–L8 are implemented. Focused unit
tests currently pass for the sync, backup, session, and device-identity areas.
Full `npm test`, `npm run build`, and `npm run test:e2e` have not yet been run
after all changes, so do not report the remediation complete.

Detailed issue-by-issue status and evidence live in `AUDIT_FIX_PROGRESS.md`.

## Files modified so far

- `src/lib/syncStorage.ts` — tombstone `restoredAt`, active-tombstone helper,
  shared validators, stable/persisted device ID, removal of obsolete `mode`.
- `src/lib/sync.ts` — restoration-aware tombstone merge and deletion filtering,
  strict remote envelope validation.
- `src/hooks/useSync.ts` — durable `restoreDeletion`, re-delete handling,
  stable provenance, obsolete mode dependencies removed.
- `src/hooks/useSessions.ts` — one-time device ID lookup.
- `src/lib/sessions.ts` — `setSessionInspection(..., boolean | undefined)`.
- `src/lib/sessionMetadata.ts` — explicit inspection-removal merge semantics.
- `src/lib/solveMerge.ts` — no synthetic metadata for equal legacy values.
- `src/lib/storage.ts` — mixed-event import detector, safe legacy timestamp
  reduction.
- `src/lib/backup.ts` — strict event/envelope import validation, deep settings
  snapshot.
- `src/lib/driveTransport.ts` — app-data-only OAuth scope, no userinfo call.
- `src/hooks/useDriveBackup.ts` — own-snapshot association, delete without a
  local file ID, connected-state initialization.
- `src/components/{MergeSessionsDialog,SessionSettingsDialog,SettingsDialog,DriveBackupDialog,DataDialog}.tsx`.
- `src/App.tsx` — durable Undo call, forced visual inspection warnings.
- `src/lib/alerts.ts` — corrected warning documentation.
- Tests: `src/lib/sync.test.ts`, `src/lib/backup.test.ts`,
  `src/hooks/useSync.test.ts`, new `src/lib/syncStorage.test.ts`.

## Key decisions

- **Undo model:** do not delete tombstones. Keep a `restoredAt` revocation record.
  Later event wins; equal timestamps favour deletion. This converges across
  offline devices and delayed snapshots without last-write-wins shortcuts.
- **Import model:** mixed-event sessions are rejected whole, not trimmed or
  converted. Local persistence remains lenient for recovery, but imports and
  remote snapshots are strict.
- **Device identity:** persisted on first sync-storage load and cached in
  module memory, so render paths never re-parse localStorage.
- **Inspection clearing:** removal is timestamped at both the top-level and
  legacy preference field so a remote older boolean cannot resurrect it.
- **OAuth:** only `drive.appdata`; identity/email scopes removed rather than
  documented and retained.

## Tests run so far

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
npm run typecheck   # pass
npm run lint        # pass
npx vitest run src/lib/syncStorage.test.ts src/lib/sync.test.ts src/lib/backup.test.ts src/lib/sessions.test.ts
# 4 files, 102 tests passed
```

## Still open

1. Add focused tests for M8 (equal legacy solve merge), M6 session metadata
   merge, L7 large legacy history, and H1 three-device delayed propagation.
2. Add/update Playwright tests for H3, M1, M5, M6, M9, L2, L3, L6.
3. Update README/AGENTS/PATCH_LIMITATIONS for OAuth scope, import strictness,
   durable Undo, and disconnect behavior.
4. Run `npm test`, `npm run build`, `npm run test:e2e`, and `npm run check`.
5. Commit coherently (do not push).

## Pitfalls for the next agent

- Do not "fix" Undo by deleting the tombstone; that is the original H1 bug.
- Do not filter invalid remote entries and continue; a malformed snapshot must
  reject the whole envelope before mutation.
- Do not drop mixed-event solves silently. Reject the import with a reason.
- Keep `src/lib/sync.stress.test.ts` green; it exercises cross-device
  convergence and idempotency.
- Use Node 22 for every command.
- E2E expects the countdown warning labels to have changed to 7/3 seconds
  remaining; update the old assertions in `e2e/timer.spec.ts`.
