# CubeLab D5 replacement-safety repair plan

**Prepared:** November 7, 2026\
**Repository:** `/home/joshua/cube-lab`\
**Scope:** The two confirmed P1 gaps remaining in D5. Preserve the current D1–D4 and earlier B/F/J repairs.

## Objective

Repair V1 (cross-tab replacement redirects a running solve) and V2 (failed startup rollback exposes staged data and later discards newly accepted work). Complete implementation and verification, not another context-only summary or plan.

Read `AGENTS.md`, current `STATUS.md`, `KNOWN_LIMITATIONS.md`, and the project architecture, sync-safety and timer-testing skills. Inspect current Git status and the relevant implementations before editing. All existing modified/untracked implementation files belong to the prior work and must be preserved.

Use the existing Node runtime and **four Playwright workers**:

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
```

Keep separate suites sequential. Use synthetic data and isolated browser contexts with memory/mock Drive. Do not install dependencies, use live Drive, commit or push. Do not reopen D1–D4 or add unrelated features/storage-engine changes.

## Independent baseline

The latest verification independently passed **897 unit tests in 64 files** and **113 Chromium cases** across the reported D1–D5 suites. The additional replacement-safety probes then reproduced both defects below. Passing normal replacement cases do not establish active-timer or failed-startup safety.

### V1 — P1: Committed replacement bypasses timer-safe adoption

**Owners:** `src/hooks/useSync.ts:2033–2058`, application completion/session ownership, deferred external-session reconciliation, settings adoption.

The replacement storage-key listener immediately calls `setSync`, `onReplaceSessions` and `onReplaceSettings` after a commit/removal. Unlike the ordinary sessions listener, it does not defer while armed, inspecting or running.

**Observed:** A synthetic solve starts in session A (333). Another page commits a replacement selecting B (222). The original page remains running but selects B. On stopping, original session A has zero saved solves instead of the expected one.

### V2 — P1: Failed startup rollback mounts editable staged data

**Owners:** `src/main.tsx:11–16`, `src/lib/replacement.ts`, session/settings initialization/autosave, recovery UI/coordination.

Startup calls `recoverPendingReplacement()` but ignores `cleanup-pending` and mounts the normal application. Hooks then read and write the staged candidate as though it were committed.

**Observed:** A prepared journal contains the old state while the sessions key contains an uncommitted candidate. Session writes fail during startup rollback. The app exposes the candidate, accepts a new solve after writes recover, then loses that solve when reload successfully rolls the journal back. Visible count goes **1 → 0**.

## Required outcomes

1. An external replacement must not redirect or cancel an in-flight solve, alter its event/scramble or lose its completion record.
2. Collection, settings, sync metadata and active-selection provenance must be adopted as a coherent outcome, deferred until safe.
3. A failed startup rollback must not expose candidate state through normal editable hooks, autosave or timing controls.
4. Recovery must never overwrite work that the application accepted after declaring itself ready for normal use.
5. Pending recovery stays durable, bounded and actionable across repeated failure, retry and reload. No notification/render loop.
6. A newly opened tab must not roll back a still-active writer's prepared transaction. Coordinate recovery with the same origin-wide write boundary used by the replacement coordinator.
7. Preserve existing commit semantics: prepared means rollback-capable; committed means candidate keys were durably written. Do not discard the only before-image while outcome remains unresolved.
8. Keep ordinary local-storage-unavailable behavior distinct from a known unresolved prepared transaction. Do not casually disable the whole app whenever no storage exists; the unsafe case here is mounting a staged or indeterminate replacement as ordinary committed data.

## Implementation design note

V1 uses one adoption boundary for every external collection change. A replacement
event records the pre-deferral collection baseline, then retains the latest
committed sessions/settings/sync outcome until the timer is idle. Idle adoption
merges solves added after that baseline by stable ID (including a compatible
recovery session when the original owner disappeared), publishes the external
selection with its sync provenance, and only then releases the replacement
journal. While a prepared or committed replacement has not been adopted, local
completion writes go to a small local-only completion buffer instead of
overwriting the staged/committed candidate; the normal collection write happens
after reconciliation. The buffer is applied before normal hooks mount on reload,
so a solve accepted while the replacement was unresolved survives either outcome.

V2 moves recovery ahead of the application mount. A committed journal only needs
cleanup and may open normally. A prepared journal is re-read while holding the
same origin-wide write lock used by the replacement coordinator; only after that
lock is acquired may an abandoned transaction be rolled back. If rollback or
journal removal fails, the bootstrap renders a minimal retry-only recovery state
with no session/settings hooks, autosave, timing controls or cross-tab adoption.
Without Web Locks a prepared journal stays pending rather than assuming the other
writer is dead. A malformed journal is retained and likewise blocks the editable
application. A pending completion buffer is applied, and must be saved
successfully, before the normal application is mounted.

## Step 0 — Preserve and reproduce

- Inspect the current diff and the owners/tests above. Avoid reading the entire codebase again.
- Port the independent V1/V2 probes into the owning repository suites before changing production code.
- Reproduce the active session/event change and the V2 recorded-solve loss, not just a generic failed-write message.
- Preserve the passing ordinary cross-tab timing, replacement, Undo-journal, bulk failure and backup round-trip cases.
- Record a short design note explaining the deferral/reconciliation boundary and the startup recovery gate before implementation.

## Step 1 — V1: Defer coherent replacement adoption and preserve completion ownership

### Implementation requirements

- Route replacement commit/rollback/removal notifications through the same timer-safe adoption contract as ordinary external session changes.
- While holding, ready, inspecting or running, retain the original solve's session/event/scramble and authoritative timer state. Defer replacement settings as well as collection/selection adoption.
- Keep a baseline from the start of deferral and retain the latest coherent external replacement outcome. Do not overwrite the baseline on each storage event.
- On idle, reconcile local additions by stable ID against the deferred replacement. If the original session was removed/reclassified, use an explicitly compatible recovery destination, preserving the completed solve's original fields and event.
- Carry the selected ID's sync provenance with the adopted state. Do not restamp an external selection as a fresh local choice or let settings/sync adoption happen independently halfway through timing.
- Avoid publishing old collection snapshots over an in-progress replacement. Coordinate completion persistence with the replacement/write barrier or a narrowly scoped durable buffer as needed. The final saved solve must survive reload even if its completion overlaps the prepared phase.
- Recheck current state at asynchronous boundaries; do not apply a stale deferred snapshot after another local edit/import/recovery has superseded it.
- Preserve exactly-once recording, deferred insight guards and the existing monotonic input timestamps.

### Owning regressions

Use `e2e/cross-tab-timing.spec.ts`, focused `useSync` tests and the relevant session/reconciliation tests:

- Commit external replacement while holding, ready, inspecting and running; assert collection/selection/settings remain protected until idle.
- Start in A/333; commit B/222; stop: original solve has the correct event, scramble, raw duration and owner/recovery destination exactly once.
- Replacement removes or reclassifies A; incoming tombstones/ownership records follow the established recovery/deletion rules without discarding a locally new solve.
- Stop before the other writer commits, after commit and after journal removal. Reload after each accepted completion.
- Two external outcomes during one active solve: retain the correct baseline and adopt the latest valid result.
- Rollback/removal notification while timing: do not bypass deferral because the marker disappeared.
- Idle follower still adopts a completed replacement normally.

## Step 2 — V2: Gate startup and mutation until replacement recovery is safe

### Bootstrap design

- Handle the result of startup recovery before mounting the normal session/settings hooks or enabling their effects.
- Mount the normal app only when a coherent committed/rolled-back state is established.
- For unresolved prepared rollback or malformed/unreadable transaction state, show a minimal recovery state that does not initialize normal autosave or expose staged collection controls as editable data.
- Where useful, display/export a validated last-committed view reconstructed from the before-images, but keep it read-only until recovery resolves. Output must still obey the checked serializer/size cap and pending Undo rules.
- A failed rollback retry must retain the journal. A successful rollback must complete cleanup or remain in a clearly safe cleanup-pending mode; do not return to editable state that a later replay can overwrite.
- Committed-marker cleanup failure is a different state from failed prepared rollback. Decide whether normal use is safe under the committed outcome, and prove that later cleanup cannot revert newer work.

### Coordination and recovery requirements

- Acquire the same origin-wide write lock/coordination boundary before deciding a prepared transaction is abandoned and rolling it back. Opening another tab while a writer is staging must wait or show a pending state, not undo the live writer.
- Use bounded, explicit retry triggers and a stable notifier. Do not retry on every render or hide persistence errors by dropping the journal.
- Recovery must work locally without connecting/enabling Drive.
- With Web Locks unavailable, define a conservative pending/read-only fallback. Do not treat an age threshold alone as proof another writer is dead or claim atomicity across independent processes/devices.
- Guard mutation/persistence boundaries, not only visible buttons. Autosave, keyboard timing, settings changes, cross-tab listeners and background sync must not write into an unresolved staged collection.
- Prevent a second import/restore from bypassing the recovery barrier. Repeated bootstrap/recovery must be idempotent.

### Owning regressions

Use replacement/bootstrap tests, `useDurableReplacement` tests and Chromium session-management/cross-tab cases:

1. Prepared journal, partially staged keys, rollback write failure on startup.
2. Verify no editable candidate, no normal autosave and no accepted timing mutation while unresolved.
3. Restore storage and explicitly retry: old coherent state returns without losing any work the app claimed to accept.
4. Fail each rollback key and journal cleanup separately; repeat reload/retry.
5. Committed journal with failed cleanup: keep the coherent new state, and ensure later cleanup cannot erase subsequent accepted edits.
6. Open a new tab while another tab holds the replacement write boundary; the new tab cannot roll back that writer's transaction.
7. Unsupported/malformed/unreadable journal: retain evidence and fail safely rather than inventing an empty collection or assuming no transaction.
8. Storage unavailable without an existing transaction: preserve the documented memory-only behavior/limitations as appropriate.

Use both the actual application bootstrap and pure journal fixtures. A unit assertion that `recoverPendingReplacement()` returns `cleanup-pending` does not establish that the app honors that result.

## Step 3 — Integration checks and documentation

Run focused checks after each root cause, then the full unit suite once. Keep browser invocations sequential with `--workers=4`.

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
npm run typecheck
npm run lint
npm test -- src/lib/replacement.test.ts src/hooks/useDurableReplacement.test.ts src/hooks/useSync.test.ts src/hooks/useSettings.test.ts src/hooks/useSessions.test.ts src/lib/sessions.test.ts src/lib/solveRecovery.test.ts
```

Include any new bootstrap/coordinator test files and affected sync/ownership/backup cases. Then run `npm test` once after the focused checks pass.

```bash
npm run test:e2e -- e2e/session-management.spec.ts e2e/cross-tab-timing.spec.ts --project=chromium --workers=4
npm run test:e2e -- e2e/timer.spec.ts e2e/timer-response.spec.ts --project=chromium --workers=4
```

Include all new V1/V2 failure/reload cases in the owning specs. Verify native import, additive import, normal delete/Undo, journal recovery, cross-tab ownership, mock Drive operations and offline bootstrap. Add the supported production offline case if it is not included in the selected timer run.

After the final mock browser run:

```bash
npm run build
git diff --check
```

Restore normal non-mock output. Keep the existing lint/build warnings visible. Do not claim Firefox/WebKit, live-provider, physical-device or assistive-technology validation unless actually performed.

Update `STATUS.md`, `KNOWN_LIMITATIONS.md` and relevant README behavior with the verified recovery/adoption semantics. Retain the dated audit records. Do not state D5 is fully complete unless both new probes and the owning acceptance cases pass.

## Completion criteria

- V1/V2 reproduced before their fixes, then green in owning regressions and the equivalent independent probes.
- No mid-solve adoption of replacement sessions/settings/provenance; completion ownership survives reload.
- No editing/autosave into unresolved staged startup data and no accepted solve erased by later rollback.
- Startup cannot recover another live writer's transaction underneath it.
- Recovery remains durable, idempotent and bounded under sustained failure.
- D1–D4, earlier B/F/J repairs and unrelated work remain intact.
- Required checks pass, normal build restored, and docs report actual tested behavior/remaining limits.
- No dependency installation, live Drive access, commit or push.

## Independent evidence

The detailed review and probes are in:

`/home/joshua/Documents/Codex/2026-11-07/referenced-chatgpt-conversation-this-is-an/outputs/`

- `CubeLab-D1-D5-verification-2026-11-07.md`
- `D1-D5-replacement-probes.spec.ts`
- `D1-D5-replacement-playwright.config.ts`
- `D1-D5-replacement-probes.log` — original V1/V2 failures and V2's lost solve after reload
- `D1-D5-ownership-confirmation.log` — V1's changed active session and failed original-owner assertion after stop
- `D1-D5-timer-replacement-trace.zip`
- `D1-D5-verification-unit.log` / `D1-D5-verification-browser.log` — independently passing 897/113 baseline

The probes synthesize the valid replacement storage sequence to isolate the actual listener/bootstrap. Port their correctness assertions into real import/restore flows too; do not “fix” them by changing the fixture into a path that avoids the missing guard.
