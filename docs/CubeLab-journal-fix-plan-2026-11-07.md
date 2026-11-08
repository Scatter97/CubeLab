# CubeLab recovery-journal fix plan

**Prepared:** November 7, 2026\
**Repository:** `/home/joshua/cube-lab`\
**Baseline:** Current uncommitted B1–B8 and F1–F4 repairs on `master`.

## Objective

Fix the two confirmed recovery-journal defects, and explicitly define the interrupted-Undo checkpoint. Preserve the earlier repairs and all unrelated work. Complete implementation and verification; do not stop after making another plan.

Read `AGENTS.md`, current `STATUS.md`, `KNOWN_LIMITATIONS.md`, and `.opencode/skills/cubelab-sync-safety/SKILL.md` with its contracts before editing. The earlier `docs/CubeLab-repair-plan-2026-11-07.md` supplies background; this plan scopes the next batch.

Use synthetic data, isolated contexts and memory/mock Drive only. Do not install dependencies, contact live Drive, commit or push. Do not implement the separately deferred midnight refresh, timer readiness, export-size, huge-date-span or replacement-persistence work. Do not replace the storage engine or rewrite the sync protocol.

## Findings and order

| Order | Item | Verified behavior | Owners |
|---|---|---|---|
| 1 | **J3 / P1: Cleanup-failure render loop** | Blocking journal cleanup writes causes repeated recovery notifications and root renders. A production-preview Chromium fixture observed 10,762 toast replacements during 1.5 seconds. | `src/hooks/useSync.ts:1826–1843`, recovery helper around 984–1021; inline callback at `src/App.tsx:457` |
| 2 | **J2 / P1: Mixed-event recovery** | A pending 333 solve is inserted into its surviving session after that session became 222. The resulting native backup is rejected by CubeLab's validator. | `src/lib/solveRecovery.ts:217–232`, `restoreSolve` in `src/lib/sessions.ts`, direct Undo and backup consumers |
| 3 | **J1: Define interrupted Undo semantics** | A journal entry beside its older original active tombstone is discarded. This is not automatically a bug: an Undo interrupted before commitment may legitimately abort. Current comments/messages incorrectly assume every active tombstone is a later deletion. | Journal record/phase interpretation; Undo handler in `src/App.tsx`; recovery classifier/tests |

Line numbers are from the reviewed tree; inspect the current code before editing. J2 and J3 are confirmed defects. J1 is a tested protocol boundary requiring a documented outcome, not a third confirmed data-loss finding.

## Required invariants

- A storage failure must not create unbounded rendering, repeated notifications or uncontrolled writes.
- Recovery must respect timer-active, in-flight and cross-tab boundaries. A retry cannot redirect or replace an active solve's session.
- Pending recovery must remain durable and discoverable until completed or intentionally aborted/superseded.
- Every restored solve retains its ID, raw time, penalty, scramble, comment, timestamps, field updates, import provenance and event.
- A session must contain only compatible solve events. Changing a destination's event must not silently reclassify an older solve.
- Native/manual backups must either contain a valid recoverable copy or explicitly fail. They must not report success while omitting the only recovery copy or exporting a collection their own reader rejects.
- Ordinary Undo, F1/F2/F4, bulk deletion, additive imports, stable session ordering, tombstone revocations, and existing safeguards must continue to work.
- No new claim of atomic cross-key storage or global multi-device consensus.

## Step 0 — Preserve and reproduce

1. Inspect `git status` and the existing diff. The modified files and untracked recovery module/tests belong to the previous repair work; preserve them.
2. Read the current recovery module, hook, application callback and backup integration.
3. Port the J3 browser fixture and J2 domain/backup fixture into their owning suites. Reproduce red assertions before changing production code.
4. Retain the passing external bulk probes. They verify the earlier rejected-reset issue through a subsequent real sync using a memory transport.
5. If newer work has already fixed a finding, demonstrate the owning regression passing and explain the difference instead of reapplying a patch.

## Step 1 — J3: Make recovery scheduling and notifications bounded

### Implementation

- Remove the dependency cycle: the effect calls `onNotify`, toast state rerenders App, a fresh inline callback changes the effect dependency, and the effect repeats.
- Stabilize the callback at the owner, or read its latest implementation through an appropriate ref. Follow existing hook conventions and avoid hiding dependencies with lint suppression.
- Make recovery retries respond to meaningful events: initial recovery, explicit retry, storage-health transition, or another narrowly defined recovery trigger. An unrelated render is not a retry trigger.
- Deduplicate unchanged pending/recovered notifications. Preserve a new outcome notification when the state genuinely changes.
- Keep retries bounded. If a timer/backoff is used, cancel it on unmount and prevent overlapping attempts. Do not merely silence messages while repeatedly doing storage work.
- Guard collection application with timer activity and current-state checks. Retry against current refs when idle rather than publishing a snapshot captured before later edits.
- Preserve the pending entry if journal cleanup fails, including when the solve was already restored. Repeated recovery must be idempotent.
- Keep automatic publication paused when the chosen protocol cannot safely proceed. Do not bypass the pending-recovery guard to make the test pass.
- Local recovery must not require enabling or connecting Google Drive. Document the available local retry/reload behavior without adding a broad new settings feature.

### Acceptance tests

Use both hook-level controlled scheduling and the actual application callback wiring in Chromium:

- Collection restoration succeeds, but writing the cleared journal fails.
- Collection restoration itself fails.
- Solve is already present, but journal cleanup still fails.
- Journal remains unreadable/unwritable as applicable to the implemented error handling; do not silently turn a known pending operation into completed recovery.
- Repeated unrelated renders/notifications do not create repeated attempts or messages.
- Storage recovers: recovery completes once, preserves the solve, clears the journal, and normal sync can resume.
- Recovery stays local with Drive disabled.
- Timer active: no collection/session replacement until idle.

Use deterministic assertions on attempt counts/state transitions where possible. The original 1.5-second browser observation demonstrates a loop; do not turn its machine-specific count into a performance requirement. Assert a bounded number of attempts/notifications after controlled triggers.

## Step 2 — J2: Preserve event/session compatibility in every restoration path

### Implementation

- Before restoring into the recorded session ID, compare its current normalized event with the solve's original event, using shared event semantics.
- If the target still exists and is compatible, restore into it.
- If it is missing or incompatible, find/create a stable, clearly labelled compatible recovery session. Preserve the original active selection where appropriate and keep recovery idempotent.
- Do not change the solve's event to fit the current target. Do not put incompatible rows into a session and defer the problem to import/sync validation.
- Add a defensive invariant to the shared restoration boundary if needed so direct Undo cannot bypass the same safety rule. Route the user-facing Undo flow through a compatible fallback or an honest pending/error result.
- Preserve custom-event definitions when needed. If the journal lacks information required to reconstruct a valid custom event, retain the recovery copy and surface the unresolved state; do not silently discard it or fabricate puzzle classification.
- Native export and manual Drive backup use recovery materialization too. Make them share the same compatible result or fail explicitly when materialization is unresolved. A successful export must round-trip through the real backup parser.
- If the protocol genuinely needs an additional persisted field, extend validation/defaults and backward-compatibility tests. Do not bump a version in a way that causes existing recovery/sync state to fall back to empty defaults.

### Acceptance tests

Add domain tests in `src/lib/solveRecovery.test.ts`, relevant shared session tests, and backup/hook/browser tests:

1. Prepare a pending 333 solve; reassign its existing source session to 222; recover.
2. Assert the original 222 session is unchanged and a compatible target contains the exact original 333 solve once.
3. Repeat recovery and remount/reload; assert no duplicate recovery session or solve.
4. Create, serialize, parse and restore the native backup successfully.
5. Exercise the manual backup materialization through the hook/memory transport.
6. Cover missing original session, custom events/definitions, normalized legacy event defaults, a solve already present elsewhere, transfers, and genuine later deletion.
7. Confirm direct Undo restoration cannot produce mixed-event data either.

Keep independent validation: asserting the shared backup parser accepts the actual materialized output catches errors that a count-only test misses.

## Step 3 — J1: Define the pre-revocation checkpoint without forcing the wrong oracle

### Default outcome for this batch

Use a conservative, explicit commit point unless current documented behavior establishes a stronger promise:

- **Journal saved, original deletion still active, no revocation committed:** the Undo was prepared but not completed. Recovery may safely abort it and keep the solve deleted.
- **Revocation durably committed, collection restoration incomplete:** preserve the pending solve and finish recovery.
- **A genuine later deliberate deletion supersedes the restoration:** preserve the newer deletion and discard the superseded recovery operation.

Document this choice in code and user-facing limitations. If choosing a different outcome, justify it and prove every write-boundary transition before implementing it. Do not simply change J1 to restore all journaled solves: that could override a deliberate deletion.

### Implementation/testing

- Stop describing the unchanged original active tombstone as a later deletion. Distinguish a pre-commit abort from supersession in classification/messages where they differ.
- Preserve enough causal metadata or explicit phase information if the chosen protocol needs that distinction. Do not rely on wall-clock ordering alone when the original deletion identity is available.
- Validate cleanup failure for both aborted and completed operations: failed cleanup must leave recoverable bookkeeping without causing J3's loop.
- Test interruption after journal persistence, after revocation persistence, after collection persistence, and before journal cleanup.
- Explicitly control the test clock/provenance. A test named “later deletion” must actually create a causally later deletion than the prepared restoration.
- Keep old recovery records readable and choose a conservative, documented interpretation for records lacking newer metadata.

The external exploratory J1 assertion currently requires retention/recovery before revocation. It is **not** the mandatory acceptance oracle for the conservative abort policy. Adapt it into separate checkpoint cases and record the intended semantics; do not call an intentional safe pre-commit abort another confirmed production defect.

## Step 4 — Verification and documentation

Use Node 22+ and the repository's tiered verification workflow. Run browser suites sequentially with four workers per Playwright invocation.

### Focused logic checks

```bash
npm run typecheck
npm run lint
npm test -- src/lib/solveRecovery.test.ts src/hooks/useSync.test.ts src/hooks/useSessions.test.ts src/hooks/useDriveBackup.test.ts src/lib/backup.test.ts src/lib/sessions.test.ts
```

Include sync-storage parser/merge/transfer tests if persisted fields or ownership handling changes. After focused checks pass, run the full unit suite once.

### Browser checks

```bash
npm run test:e2e -- e2e/session-management.spec.ts e2e/custom-events.spec.ts e2e/cross-tab-timing.spec.ts --project=chromium --workers=4
npm run test:e2e -- e2e/timer.spec.ts --project=chromium --workers=4 --grep 'solve menu handles|backup export and import|csTimer|google drive backup and restore|active-session Drive review'
```

Add the new application-level cleanup-failure regression to an owning spec so it runs in the repository, not only the external harness. Add/reach the native/manual backup event-compatibility cases.

Restore normal production output after mock browser tests:

```bash
npm run build
git diff --check
```

Keep existing lint/build warnings visible. Do not claim Firefox/WebKit, real-provider, physical-device, assistive-technology or offline validation unless those checks were actually run. Extend platform coverage when the implementation gives an engine-sensitive reason; a full browser matrix is not required for this batch.

### Documentation

Update `STATUS.md` with actual implementation/check results. Update `KNOWN_LIMITATIONS.md` and relevant README behavior with the commit point, pending-recovery behavior and any remaining boundaries. Preserve older audits as dated evidence. Do not replace previous evidence with an unsupported “all fixed” statement.

## Completion criteria

- J3 and J2 reproduced before their fixes, then passing in owning regressions.
- No unbounded recovery work or notification churn under sustained storage failure.
- Every restored/materialized solve has a compatible session, preserved data and a valid native backup round trip.
- Pre-revocation interruption, committed recovery and later deletion have explicit, tested outcomes.
- Reload and repeated recovery are idempotent; pending copies survive failed writes.
- Earlier B1–B8 and F1/F2/F4 behavior remains intact, including both external bulk probes.
- Required focused/unit/browser checks pass, normal build restored, unrelated working changes preserved.
- No dependency installation, live Drive access, commit or push.
- Final report lists changes, exact tests/results, skipped validation, remaining limitations and any deliberately chosen protocol semantics.

## Supporting evidence

The detailed review and reproducible fixtures remain in:

`/home/joshua/Documents/Codex/2026-11-07/referenced-chatgpt-conversation-this-is-an/outputs/`

Relevant files:

- `CubeLab-journal-review-2026-11-07.md` — confirmed findings, checkpoint interpretation and source evidence.
- `journal-review.test.ts` / `journal-review.config.mts` — J2 domain/backup probe and exploratory J1 checkpoint case.
- `journal-review.spec.ts` / `journal-review-playwright.config.ts` — J3 application cleanup-failure fixture.
- `journal-review-backup-probe.log`, `journal-review-browser-confirmation.log` — rejected recovered backup and reproduced render loop.
- `reaudit-bulk-failure.test.ts` / `reaudit-bulk.config.mts` — passing protection against rejected-reset intent.

Port/adapt these fixtures into the repository suites and test the final application path. The old F3/R3 “tombstone must remain deleted” oracle is superseded by explicit journal-backed pending recovery and should not be used to reject the accepted new protocol.
