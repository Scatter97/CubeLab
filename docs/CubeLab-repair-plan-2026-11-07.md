# CubeLab deletion-safety repair plan

**Prepared:** November 7, 2026\
**Checkout:** `/home/joshua/cube-lab`\
**Baseline:** `master` at `28f38d76fa052010d9f13d1a44495ab90026fac3`, plus the existing uncommitted B1–B8 repairs.

## Objective and scope

Repair the four independently reproduced findings from the follow-up review while preserving the successful B1–B8 work. Complete the implementation and verification; do not stop after producing another plan.

Read `AGENTS.md`, `STATUS.md`, `KNOWN_LIMITATIONS.md` and the applicable project skills before editing. In particular, use `.opencode/skills/cubelab-sync-safety/SKILL.md` and its sync contracts. Source paths/line numbers below describe the reviewed working tree and may move during implementation.

This document authorizes work on F1–F4 and the directly related regression coverage and documentation. Preserve all existing uncommitted work. Do not clear real data, install dependencies, contact live Drive, commit, or push. Use isolated synthetic histories and memory/mock Drive.

Do not implement the separately deferred midnight-refresh, readiness-tick, oversized-export, huge-date-span or replacement-persistence work. Keep broader storage-engine changes and product features out of this batch.

## Findings and repair order

| Order | Finding | Reproduction / consequence | Main owners |
|---|---|---|---|
| 1 | **F1 / P1 — Blocked bulk reset leaves live deletion intent** | A failed sync-key write returns false, but `recordDeletions` / `recordAllSessionDeletions` have already published tombstones into memory. A later real sync through a memory transport deletes the supposedly protected solve. | `src/hooks/useSync.ts:499–572`; reset/delete-all handlers in `src/App.tsx` |
| 2 | **F2 / P1 — Clear Session ignores failed deletion intent** | Fail sync-key writes, clear a one-solve session, reload: count is zero without durable tombstones. | `src/App.tsx:687–695`; `src/hooks/useSessions.ts`; checked batch intent API |
| 3 | **F4 / P2 — Undo failure notification is dismissed** | Delete, fail sync-key writes, click Undo: solve remains absent and no error toast survives. | `src/App.tsx:1612–1615`; `src/hooks/useToast.ts` |
| 4 | **F3 / P2 — Undo rollback failure leaves a durable restoration** | Allow Undo's revocation write, fail collection restore, then fail deletion rollback: disk has `restoredAt > deletedAt` while the solve is absent. | `src/App.tsx:654–665`; session/sync persistence and any narrowly required recovery metadata |

F4 is implemented before F3 so recovery outcomes can be displayed reliably. Findings are independent; keep patches reviewable by root cause. F1/F2 are adjacent gaps that predate the latest repairs. F3/F4 expose incomplete behavior around the repaired Undo path.

## Non-negotiable outcomes

1. **Blocked means no intent change.** If an intent write fails, neither persisted state nor React state/ref may contain a newly active operation. A future scheduled/manual sync must not execute the rejected action.
2. **A successful deletion is durable.** Keep deletion provenance and collection state consistent through reload and stale snapshots. Never report completion before required writes succeed.
3. **Partial failure is recoverable and honestly described.** A failed rollback cannot silently leave opposite durable intent, and “remains deleted” cannot be claimed if a persisted revocation allows restoration.
4. **Recovery survives reload.** An in-memory retry flag or disabled button alone cannot protect against reopening the app.
5. **Undo provenance remains monotonic and mergeable.** Preserve tombstones and durable revocations; do not erase provenance. Re-deletion must supersede the earlier restoration, including timestamp ties/clock behavior covered by existing contracts.
6. **Sync remains guarded.** Timer-active, in-flight changes, cross-tab adoption, local write locks, immutable snapshots and retention guarantees remain intact.
7. **Notifications describe the actual outcome.** The original action toast may disappear; a new failure/recovery notification must remain visible.

## Step 0 — Establish the current baseline

- Inspect `git status` and the current diff. The existing source/test/doc modifications and untracked `useSessions.test.ts` belong to the previous repair work; preserve them.
- Read the current handlers rather than assuming line numbers still match.
- Reproduce each current failure with an owning regression before editing production code.
- Record the initial command/result. Prior independent evidence: 837 existing unit tests and 20 selected Chromium cases passed, while the new failure probes were red.
- Check whether any finding has already been fixed by newer local work. If so, retain a passing regression and explain that outcome instead of reapplying a patch.

## Step 1 — F1: Make batch intent writes publish only after persistence

### Implementation

- In `recordDeletions` and `recordAllSessionDeletions`, construct detached candidate state without changing the current runtime.
- Check storage availability and persist the candidate **before** `setSync`, assigning `syncRef.current`, or changing retention/publication bookkeeping.
- On failure, return false and keep current state/ref, fingerprints and retention flags unchanged.
- On success, publish exactly the saved candidate and apply the intended retention behavior.
- Follow the repaired single-deletion method's write-before-publish pattern. Factor a small helper only if it clarifies the same correctness boundary; avoid a broad sync rewrite.
- Check all callers of the changed APIs and preserve their existing success/failure semantics.

### Owning regressions

Add cases in `src/hooks/useSync.test.ts` for both batch APIs:

1. Establish a successful initial mock sync with a known solve ID.
2. Fail the sync-key write and invoke the operation.
3. Assert false, unchanged durable runtime and unchanged visible collection.
4. Restore writes and invoke actual `syncNow`.
5. Assert exact local and uploaded solve IDs remain present, with no newly active tombstones.
6. Reload/remount using disk state and repeat reconciliation.

Include unavailable storage (`storageOk=false`) and thrown writes. An immediate UI-count check without a subsequent sync is insufficient.

## Step 2 — F2: Route Clear Session through checked, durable operations

### Implementation

- Replace the per-solve, unchecked `recordDeletion` loop with a checked batch intent operation, after F1 is fixed.
- If intent persistence fails, do not clear anything; keep/reopen a useful UI and show a failure message.
- Make clearing the session return a persistence result and publish the empty collection only after the collection write succeeds.
- Handle a collection-write failure after intent persistence explicitly. Choose a recoverable outcome; do not claim “nothing changed” while durable deletion intent will later remove data.
- Preserve the source session, event, settings, stable IDs and unrelated sessions.
- Review other unchecked `recordDeletion` callers, particularly custom-event deletion. If the same failure contract is demonstrably violated, add a focused regression and repair that caller within this shared safety boundary. Do not count an untested similar shape as another confirmed bug.
- Avoid writing the growing tombstone collection once per solve; one batch intent write is the intended path.

### Owning regressions

Add browser cases in `e2e/session-management.spec.ts` and the relevant session hook tests:

- Sync-key failure: clear is blocked, IDs unchanged, no active deletion intent.
- Session-key failure after successful intent: asserted recovery behavior, including failed recovery writes.
- Successful clear: source session/settings remain and no old solve is resurrected after reload/stale snapshot merge.
- Multiple solves, empty collection and unrelated sessions.
- Storage recovery followed by sync; test exact records, not only counts.

Reuse the existing typed confirmation and synthetic failure helpers.

## Step 3 — F4: Preserve notifications created by toast actions

### Implementation

Either:

- dismiss the original action toast before invoking its callback, allowing the callback to create a replacement; or
- dismiss only the original toast ID if it is still current.

Choose the smaller solution that preserves other toast actions. Avoid a delayed unconditional dismissal, which only moves the race.

### Regression

Exercise the actual Undo button after a successful deletion with a failed revocation write. Assert the solve remains absent and the “Undo blocked” error is visible after the event completes. Also cover a replacement recovery notification and the successful action path.

## Step 4 — F3: Make failed Undo recoverable across both persistence keys

This step needs an explicit protocol, not another unchecked rollback call. Two `localStorage` writes are not an atomic transaction, and simply reversing their order moves the crash window.

### First define the outcome

Before implementation, write a short code/design note describing the authoritative durable state for these cases:

- Undo's initial intent cannot be saved.
- Intent saves but restoring the solve collection fails.
- Restoration/rollback writes fail in sequence.
- The tab closes between writes.
- Storage later recovers, or another tab/sync observes the intermediate state.

Distinguish **deleted**, **restored**, and **pending recovery**. A pending operation must not be reported as either completed or safely rolled back.

### Implementation requirements

- Check and handle every persistence result, including re-establishing deletion intent.
- If the existing metadata cannot encode a reload-safe intermediate state, add the smallest necessary durable local recovery record with the operation ID, solve/session identity, required solve data and chosen recovery intent. Do not introduce a general storage-engine migration merely to solve this case.
- If persisted fields are added, extend the parser/defaults/validation and compatibility tests. Existing version-1 records must remain readable without losing unrelated sync history; never casually bump a version that makes old runtime state fall back to defaults.
- Run recovery before an intermediate state can be automatically published/adopted incorrectly. Cover manual backup, startup/manual/scheduled/exit sync and cross-tab behavior as relevant to the chosen protocol.
- Keep local recovery bookkeeping out of remote envelopes unless the protocol explicitly requires it and it is validated. Ensure exports/manual backup cannot silently discard the only recovery copy of a solve.
- Recovery must be idempotent after repeated attempts/remounts. Preserve solve fields and IDs; do not duplicate or restamp unrelated history.
- Surface actionable pending/failed outcomes without claiming the solve “remains deleted” when the durable journal says otherwise.

A smaller approach is acceptable if its tests establish these same invariants. An unchecked retry, in-memory-only marker, or notification-only change is not sufficient.

### Required failure matrix

| Scenario | Expected invariant |
|---|---|
| First Undo intent write fails | Original durable deletion and collection stay unchanged; visible error |
| Intent succeeds, collection restoration fails | Explicit recoverable state; no false success or opposite-intent publication |
| Rollback also fails | Durable recovery remains discoverable; truthful user message; no unguarded stale-snapshot restoration |
| Reload after each write boundary | Same intended outcome is recovered without relying on prior in-memory state |
| Storage recovers then sync runs | Local collection, intent and remote publication converge on the declared outcome |
| Original session was removed or solve transferred | Defined fallback/error; no silent loss or duplication |
| Later deliberate re-deletion | New deletion supersedes older revocation/recovery intent deterministically |

Use hook tests for persistence/recovery transitions and Chromium for the complete toast/Undo flow. Retain normal delete/Undo regressions.

## Step 5 — Verify the batch and update documentation

Use the tiered workflow in `AGENTS.md`, sequentially. Do not run browser suites concurrently.

### Focused logic checks

```bash
npm run typecheck
npm run lint
npm test -- src/hooks/useSync.test.ts src/hooks/useSessions.test.ts src/lib/syncStorage.test.ts src/lib/sync.test.ts src/lib/sessions.test.ts
```

Add backup, Drive hook and cross-tab coverage if the recovery protocol affects those boundaries. Run the full unit suite once after the focused checks pass.

### Browser checks

```bash
npm run test:e2e -- e2e/session-management.spec.ts e2e/cross-tab-timing.spec.ts --project=chromium --workers=4
npm run test:e2e -- e2e/timer.spec.ts --project=chromium --workers=4 --grep 'solve menu handles|backup export and import|csTimer|google drive backup and restore|active-session Drive review'
```

Include the newly added failure scenarios in those specs; keep them clearly discoverable by test title. If selecting tests by grep during development, finish with all owning failure/recovery cases. A passing normal Undo test does not establish failed Undo correctness.

After mock-based browser checks:

```bash
npm run build
git diff --check
```

Restore normal non-mock production output. Keep existing lint/build warnings visible. Do not run live Drive validation or change dependencies in this batch. A full cross-engine matrix is not required for this scoped repair; add engine coverage when the implementation has an engine-sensitive reason and report it accurately.

### Documentation

- Update `STATUS.md` with the implemented protocol and actual dated checks.
- Correct deletion/Undo guarantees in `KNOWN_LIMITATIONS.md`; document any unavoidable pending-recovery boundary without claiming atomicity.
- Update `README.md` only where user-visible behavior changes.
- Keep the original audit as a dated historical baseline. Mark this plan complete only when its acceptance criteria are met; do not overwrite old evidence with unsupported “all fixed” claims.

## Completion criteria

- F1–F4 reproduced against the baseline or shown already fixed by current code.
- Owning regressions fail before their corresponding fixes and pass afterward.
- Rejected bulk/reset operations cannot later delete data through sync.
- Clear Session cannot claim a safe clear after rejected intent/collection persistence.
- Undo's partial outcomes survive reload and cannot silently publish opposite intent.
- Failure notifications survive action-toast dismissal.
- Original B1–B8 fixes and unrelated working changes remain intact.
- Required focused/unit/browser checks pass; normal build restored.
- No real data, live provider, dependency changes, commit or push.
- Final report lists changed files, tested scenarios, exact commands/results, skipped validation and any remaining limitations.

## Supporting review and reproducible probes

The detailed follow-up review and harnesses are at:

`/home/joshua/Documents/Codex/2026-11-07/referenced-chatgpt-conversation-this-is-an/outputs/`

Relevant files:

- `CubeLab-repair-review-2026-11-07.md` — detailed findings and source evidence.
- `reaudit-bulk-failure.test.ts` / `reaudit-bulk.config.mts` — R4 cases for F1.
- `reaudit-repair-review.spec.ts` / `reaudit-playwright.config.ts` — R2 for F2, R3 for F3, R1 for F4.
- `reaudit-bulk.log`, `reaudit-new-browser-initial.log`, `reaudit-new-browser-followup.log` — observed red assertions.
- `reaudit-unit.log`, `reaudit-existing-e2e.log` — passing baseline checks.

Port the probes into the owning repository suites, adapting them to the final public operation/recovery API. Do not retain obsolete call ordering as a fake regression after the application API changes; verify the actual UI and sync path. Test correctness outcomes rather than mirroring implementation details.
