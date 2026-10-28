# CubeLab — Oct 28 AM Plan (Stages 0–6)

**Created:** 2026-10-28
**Scope:** Close out the uncommitted 2026-10-27 remediation, align documentation, then execute the prioritized roadmap through Stage 6.
**Execution status:** Stages 0, 1, and 2 are complete. Stage 3 real-provider validation is complete except OAuth publishing, which is blocked on the Google Cloud project owner; Stages 4 and 5 are approved.
**Source of truth:** `AGENTS.md`, `README.md`, `ROADMAP.md`, `PROJECT_PROGRESS.md`, `PATCH_LIMITATIONS.md`, `NEXT_SESSION_HANDOFF.md`.

---

## 0. Baseline status (recorded at plan creation; see stage sections for completion)

- All of Milestone 1, Phase 2A, 2A.1, 2A.2, 2A.3, 2B, 2C implemented and verified.
- Phase 3 (multi-event) partially implemented at session/setup level (3×3, 2×2, 4×4, 3×3 OH); 5×5, 6×6, and 7×7 are Stage 4 implementation scope.
- Uncommitted 2026-10-27 remediation pass: immutable device snapshots with unique names, uncapped/deduped conflict queue with paginated rendering, remote-snapshot disagreement detection.
- Fresh verification (Node v22.23.2): typecheck pass, lint pass (no warnings), **287/287 unit tests** (21 files), build pass (95 modules, PWA 22 entries, 2286.77 KiB), **29/29 Playwright**, `git diff --check` pass.
- `npm run check` had **not** been run as a single command since the audit remediation; Stage 0 later ran and passed it.

### Known limitations at plan creation (items resolved by Stage 1 are marked there; do not claim unresolved items solved)
Provider CAS unavailable; duplicate review advisory; real multi-device provider validation completed at Stage 3 but OAuth publishing is still pending; eventual consistency; delete-all all-or-nothing; snapshot cleanup is best effort and not transactional; legacy tombstones use wall-clock comparison; redirect handling deterministic not consensus; conflict review has no audit history/undo (queue now uncapped/paginated, but past choices not inspectable/reversible); new 2026-10-27 caveat about hidden older cloud approvals; sync-on-exit best effort; active-session selection not field-merged; in-flight guards assume immutable React state; settings provenance depends on sync metadata; local JSON import replace-only; Phase 3 incomplete (5×5/6×6/7×7 not implemented, no per-event E2E, no event-specific WCA rules); no dark theme; sound/haptic browser-dependent; multiple tabs not synchronized; backups unencrypted JSON; 10 MB import cap; session delete/clear no undo; history renders every row (no virtualization); Chromium-only automated tests; first launch needs network; large `cubing.js` chunk (~1.2 MB).

---

## Stage 0 — Close out the current remediation (no new scope)

### 0.1 Documentation alignment
Apply these edits so docs match current code:

1. **Filename references (old → new):** replace `cubelab-backup-<deviceId>.json` / `cubelab-backup-<sanitized-deviceId>.json` with `cubelab-backup-<device-id>-<uuid>.json` in `PROJECT_PROGRESS.md` (~lines 88, 963, 981), `ROADMAP.md` (~line 33), `AGENTS.md` (~line 154). In `AGENTS.md`, also clarify that per-device transports no longer re-list/recheck; the optimistic recheck remains only for the legacy fixed-name transport.
2. **Conflict-queue cap language:** `PROJECT_PROGRESS.md` ~line 794 replace "the queue is capped at 100 records" with "the queue is not capped at 100 records (deduped by field key; rendering paginated)". `PATCH_LIMITATIONS.md` update the "Conflict review has no audit history or undo" bullet accordingly.
3. **Verification evidence refresh:** add a 2026-10-27 evidence block to `PROJECT_PROGRESS.md`: typecheck/lint pass, 287/287 unit tests (21 files), build pass (95 modules, PWA 22 entries, 2286.77 KiB), 29/29 Playwright, `git diff --check` pass; note immutable snapshots, remote-disagreement review, uncapped conflict queue.
4. **New 2026-10-27 subsection in `PROJECT_PROGRESS.md`** mirroring the `PATCH_LIMITATIONS.md` block: immutable snapshots with unique names; `uploadDeviceBackup` no longer takes `existingFileId`; per-device transports no longer do optimistic recheck (legacy still does); conflict queue uncapped, deduped by `kind:id:field`, rendering paginated (5 per page + "Show all"); remote-snapshot disagreement detection (`remoteOnly` conflicts, `findRemoteRedirectDisagreements`, unordered destination-pair approval matching); `isOwnSnapshot`/`findOwnSnapshots` identity by envelope `deviceId` with legacy filename fallback; `cancelledRef` guarding deferred sync timeouts; honest caveat about hidden older cloud approvals.
5. **Stale "no reset" note:** `PROJECT_PROGRESS.md` Known limitations bullet about "UI does not yet provide a 'use global default' reset" is outdated (M6 added it). Replace with "Per-session inspection overrides can be cleared back to the global setting; a session that has never been overridden follows the global value."
6. **`AGENTS.md` invariant updates:** Drive sync bullet filename → `cubelab-backup-<sanitized-deviceId>-<uuid>.json`; clarify Web Lock + re-list now applies only to legacy fixed-name transport; note snapshot accumulation and absence of cleanup policy. Add conflict-review bullet: queue not capped at 100; remote disagreements surfaced; approvals matched by unordered destination pair; `remoteOnly` labeling. Settings-persistence bullet: mention immutable snapshots and that `uploadDeviceBackup` no longer accepts an existing file ID.
7. **`ROADMAP.md`:** update Phase 2C delivered bullets (immutable unique snapshots, uncapped conflict queue, remote disagreement review); update "Remaining work" to drop completed items (conflict queue cap, remote disagreement surfacing) and keep provider CAS, real-provider validation, audit/undo, exit durability, legacy-tombstone ambiguity, redirect consensus, cleanup policy, per-device management UI.
8. **`README.md`:** verify consistency (already updated for immutable snapshots and uncapped queue). No further change expected beyond confirmation.
9. **`PATCH_LIMITATIONS.md`:** fix the garbled/duplicated first "Still unresolved" bullet (the provider-CAS paragraph currently contains two overlapping versions). Collapse to a single clean paragraph.
10. **`docs/` cleanup:** the completed audit report, the completed per-finding tracker, and the superseded Phase 2B design brief were removed during the 2026-10-28 cleanup. Only current reference docs and UI screenshots remain.
11. **Test-count consistency:** all active docs use the current Stage 1 result (307 unit tests, 29 E2E, `npm run check` passed).
12. **`NEXT_SESSION_HANDOFF.md`:** records the Stage 1 handoff, the documentation cleanup, and the Stage 2 entry point.

### 0.2 Verification
- Run `npm run check` once as a single recorded result (constituent commands all passed previously; record the combined result).

### 0.3 Commit
- Commit code + docs with a focused message, e.g. `Finalize immutable-snapshot sync remediation and docs`.
- Verify `git status` is clean afterward.

**Gate (Stage 0):** docs match code, `npm run check` recorded, working tree clean.

---

## Stage 1 — Highest-value sync work (approved 2026-10-28; delivered; real-provider gate closed at Stage 3)

**Goal:** move from "eventual convergence" to something defensible.

1. **Verified CAS/ETag for one device file** — **delivered for the legacy mutable
   file.** Drive v3 exposes no ETag, so `cubelab-backup.json` is read through
   Drive v2 metadata and replaced with a v2 media `PUT` carrying `If-Match`.
   HTTP 412 or a missing ETag fails closed. Immutable per-device snapshots remain
   create-only. Deterministic transport tests cover success, stale ETag, 412, and
   missing ETag; the real-provider stale-writer test was deferred to and completed in Stage 3.
2. **Conflict resolution audit + undo** — **delivered.** Decisions are recorded
   in a local-only `cubelab:sync:v1` history (newest first, display cap 50) and
   can be undone while the exact resolution and `updatedAt` remain current.
   **Repair sync state** provides the documented non-destructive recovery path;
   it clears only derived bookkeeping and preserves correctness state.
3. **Guaranteed sync-on-exit** — **delivered as far as the platform allows.**
   `beforeunload` was removed; visibility loss, `pagehide`, and `freeze` are
   deduplicated over 2 seconds. Local storage remains the durability boundary and
   startup resumes a persisted `syncing` state. Residual limits are documented.
4. **Legacy tombstone ambiguity + redirect consensus** — **partially delivered.**
   Ambiguous pre-`knownSolveIds` deletions now always raise a
   `session`/`legacyRecovery` review with an explicit candidate set. Remote-only
   redirect destination disagreements are surfaced for review, but redirect
   handling remains deterministic rather than consensus-based, and applied
   redirect merges cannot be undone automatically.

**Evidence (2026-10-28, Node v22.23.2):** `npm run check` passed as one command:
typecheck and lint passed, **308/308 unit tests** in 21 files, production build
(95 modules; PWA 22 entries, 2,296.43 KiB), **29/29 Playwright tests**, and `git
diff --check` passed. The manual-conflict E2E covers review history, Undo, and
Repair.

**Gate (Stage 1):** **met after the Stage 3 follow-up.** The required
real-provider multi-device scenario was not run at Stage 1 because no Google Drive
test account was available. Failure paths are tested against the deterministic
transport, and honest limitations are recorded in `PATCH_LIMITATIONS.md`. Stage 3
later ran the real-provider multi-device, conditional-write, and retention
validation successfully.

---

## Stage 2 — Snapshot lifecycle management (approved and delivered 2026-10-28)

1. **Cleanup policy — delivered.** Automatic cleanup runs after a successful
   all-snapshot merge and publication. It keeps the newest snapshot of every
   device group and removes files beyond the per-device count (default 10;
   options 3/5/10/20/50) or age (default 30 days; options 7/30/90/180/365)
   threshold. It never removes the just-published snapshot or the legacy mutable
   `cubelab-backup.json`. Manual cleanup is limited to this device's superseded
   files.
2. **Per-device management UI — delivered.** New snapshots record
   `appProperties.deviceId`; older files fall back to the sanitized name prefix.
   **Settings → Data → Google Drive backup → Remote snapshots** groups files by
   device, puts this device first, and shows size, modification time, newest
   status, five files per device with **Show all**, selective deletion with
   confirmation, **Refresh**, and **Clean up now**.
3. **Growth documentation — delivered.** `README.md`, `PATCH_LIMITATIONS.md`,
   `AGENTS.md`, `ROADMAP.md`, and `PROJECT_PROGRESS.md` describe the policy,
   ownership model, safety boundaries, and residual non-transactional limits.

**Evidence (2026-10-28, Node v22.23.2):** `npm run check` passed as one command:
typecheck and lint passed, **332/332 unit tests** in 22 files, production build
(96 modules; PWA 22 entries, 2,309.44 KiB), **30/30 Playwright tests**, and `git
diff --check` passed. New coverage includes `snapshotRetention.test.ts`, policy
migration/invalid-value tests, hook cleanup and failure-path tests, and a
production E2E flow for ownership display, selective deletion, manual cleanup,
and policy persistence. `ConfirmDialog` now generates unique title/description
IDs so multiple mounted confirmations announce their own names.

**Gate (Stage 2): met.** Snapshot growth has a documented, configurable policy;
the UI shows ownership and supports selective deletion; unit, hook, and E2E tests
cover cleanup and failure paths. Real-provider retention remains part of the
Stage 3 validation gate.

---

## Stage 3 — Real-provider validation

1. Run concurrent multi-device sync against a real Google Drive test account (not mock transport); record results in `PROJECT_PROGRESS.md`.
2. Validate OAuth publishing/branding so non-test users can sign in.

**Gate (Stage 3):** partially met. Real-provider concurrency, convergence,
conditional write, and retention evidence is recorded in `PROJECT_PROGRESS.md`;
the opt-in harness passes 7/7 with complete cleanup. OAuth branding was exercised
with only `drive.appdata`, but the app remains in Testing under another owner
account, so non-test sign-in and published production branding are not validated.

---

## Stage 4 — Phase 3 completion (APPROVED 2026-10-28)

1. Implement 5×5, 6×6, and 7×7 session events through `cubing.js` (`555`, `666`, `777`), including event metadata, scramble loading/failure states, and per-event statistics.
2. Dedicated per-event production E2E coverage for 3×3, 2×2, 4×4, 3×3 OH, 5×5, 6×6, and 7×7 (switch events, record solves, verify stats/scrambles).
3. Event-specific WCA timing/inspection rules where they differ; document where the standard 15-second inspection and `+2`/DNF rules are shared.
4. Broader event validation and storage migration verification for existing 3×3 data, including multi-event backup/import coverage.

**Gate (Stage 4):** `ROADMAP.md` Phase 3 acceptance criteria for all seven events are met; docs/screenshots updated.

---

## Stage 5 — Phase 4 platform work (APPROVED 2026-10-28)

1. Virtualize/window the solve history for very large sessions (2,000+ solves responsive).
2. WebKit/Firefox coverage where available; physical iOS/Android touch audit.
3. Formal screen-reader/keyboard audit.
4. PWA update-behavior review and `cubing.js` bundle-splitting improvements.

**Gate (Stage 5):** seeded 2,000+ solve sessions responsive; no horizontal overflow; cross-browser limitations recorded honestly.

---

## Stage 6 — Polish (low priority; no approval needed beyond normal)

1. Dark theme — only after full palette/contrast audit and tests.
2. Verify "use global default" inspection reset matches docs (already implemented via M6).
3. Larger import cap only if a deliberate, tested design is approved.

**Gate (Stage 6):** contrast tests pass; docs updated.

---

## Cross-cutting: scramble warm-up / UX (can run alongside Stage 0)

Goal: reduce perceived large-cube (4×4–7×7) cold-start latency while staying WCA-correct and using `cubing.js`.

1. Warm up the solver on app mount and on session/event selection (earlier than current `useScramble` fill on render).
2. Optionally enlarge prefetch queue for slow events.
3. Show explicit "Generating large-cube scramble… (first one may take a few seconds)" loading state; keep timer gated on `scramble !== null`.
4. Optional: cache one prefetched scramble in `localStorage` (trade-off: not freshly generated at load, but still a valid `cubing.js` random-state scramble).

**Constraints:** do not hand-roll scrambles; do not switch to random-move/fast scrambles without an approved design brief; do not remove the `isLoading` gate that prevents solves without a scramble.

---

## Verification commands (run after each stage)

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Plus `git diff --check` and a clean `git status`.

## Approval notes

- `AGENTS.md` forbids starting Phase 3, Phase 4, or any new cloud/account feature without explicit user instruction. Stages 4 and 5 therefore require explicit approval before execution.
- Stage 1 (CAS/audit/undo) was approved on 2026-10-28 and delivered; Stage 3 later
  closed its real-provider validation gate, except for OAuth publishing.
- Stage 0 was completed and committed on 2026-10-28.
- Stage 2 was approved and delivered on 2026-10-28.
- Stage 3 was approved and run on 2026-10-28. Real-provider validation is complete;
  OAuth publishing and non-test sign-in remain owner actions.
- Stage 4 is the next approved stage. It includes 5×5, 6×6, and 7×7 implementation, per-event E2E for all seven events, WCA rule verification, and multi-event storage verification.