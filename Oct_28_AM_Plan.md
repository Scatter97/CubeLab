# CubeLab — Oct 28 AM Plan (Stages 0–6)

**Created:** 2026-10-28
**Scope:** Close out the uncommitted 2026-10-27 remediation, align documentation, then execute the prioritized roadmap through Stage 6.
**Execution status:** Stage 0 and Stage 1 are complete. Work is paused before Stage 2 by user instruction on 2026-10-28; Stage 2 needs explicit approval.
**Source of truth:** `AGENTS.md`, `README.md`, `ROADMAP.md`, `PROJECT_PROGRESS.md`, `PATCH_LIMITATIONS.md`, `NEXT_SESSION_HANDOFF.md`.

---

## 0. Baseline status (recorded at plan creation; see stage sections for completion)

- All of Milestone 1, Phase 2A, 2A.1, 2A.2, 2A.3, 2B, 2C implemented and verified.
- Phase 3 (multi-event) partially implemented at session/setup level (3×3, 2×2, 4×4, 3×3 OH) but not declared complete.
- Uncommitted 2026-10-27 remediation pass: immutable device snapshots with unique names, uncapped/deduped conflict queue with paginated rendering, remote-snapshot disagreement detection.
- Fresh verification (Node v22.23.2): typecheck pass, lint pass (no warnings), **287/287 unit tests** (21 files), build pass (95 modules, PWA 22 entries, 2286.77 KiB), **29/29 Playwright**, `git diff --check` pass.
- `npm run check` had **not** been run as a single command since the audit remediation; Stage 0 later ran and passed it.

### Known limitations at plan creation (items resolved by Stage 1 are marked there; do not claim unresolved items solved)
Provider CAS unavailable; duplicate review advisory; no real multi-device provider validation; eventual consistency; delete-all all-or-nothing; snapshot accumulation with no cleanup policy; legacy tombstones use wall-clock comparison; redirect handling deterministic not consensus; conflict review has no audit history/undo (queue now uncapped/paginated, but past choices not inspectable/reversible); new 2026-10-27 caveat about hidden older cloud approvals; sync-on-exit best effort; active-session selection not field-merged; in-flight guards assume immutable React state; settings provenance depends on sync metadata; local JSON import replace-only; Phase 3 incomplete (no per-event E2E, no event-specific WCA rules); no dark theme; sound/haptic browser-dependent; multiple tabs not synchronized; backups unencrypted JSON; 10 MB import cap; session delete/clear no undo; history renders every row (no virtualization); Chromium-only automated tests; first launch needs network; large `cubing.js` chunk (~1.2 MB).

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

## Stage 1 — Highest-value sync work (approved 2026-10-28; delivered except real-provider gate)

**Goal:** move from "eventual convergence" to something defensible.

1. **Verified CAS/ETag for one device file** — **delivered for the legacy mutable
   file.** Drive v3 exposes no ETag, so `cubelab-backup.json` is read through
   Drive v2 metadata and replaced with a v2 media `PUT` carrying `If-Match`.
   HTTP 412 or a missing ETag fails closed. Immutable per-device snapshots remain
   create-only. Deterministic transport tests cover success, stale ETag, 412, and
   missing ETag; a real-provider stale-writer test remains deferred to Stage 3.
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

**Gate (Stage 1):** **partially unmet.** The required real-provider multi-device
scenario was not run because no Google Drive test account/OAuth credentials were
available. Failure paths are tested against the deterministic transport, and
honest limitations are recorded in `PATCH_LIMITATIONS.md`. Real-provider
validation remains Stage 3 work.

---

## Stage 2 — Snapshot lifecycle management

1. Cleanup policy for accumulated immutable snapshots (age/count thresholds).
2. Per-device management UI: list which device owns which snapshot, selective delete, ownership display.
3. Document growth expectations and a manual cleanup procedure in the interim.

**Gate (Stage 2):** no unbounded growth without a documented policy; UI shows ownership; tests cover cleanup.

---

## Stage 3 — Real-provider validation

1. Run concurrent multi-device sync against a real Google Drive test account (not mock transport); record results in `PROJECT_PROGRESS.md`.
2. Validate OAuth publishing/branding so non-test users can sign in.

**Gate (Stage 3):** real-provider evidence recorded; any new limitations documented.

---

## Stage 4 — Phase 3 completion (APPROVED 2026-10-28)

1. Dedicated per-event production E2E coverage (switch events, record solves, verify stats/scrambles).
2. Event-specific WCA timing/inspection rules where they differ.
3. Broader event validation and storage migration verification for existing 3×3 data.

**Gate (Stage 4):** `ROADMAP.md` Phase 3 acceptance criteria all met; docs/screenshots updated.

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

Goal: reduce perceived 4×4 cold-start latency (~3.3 s) while staying WCA-correct and using `cubing.js`.

1. Warm up the solver on app mount and on session/event selection (earlier than current `useScramble` fill on render).
2. Optionally enlarge prefetch queue for slow events.
3. Show explicit "Generating 4×4 scramble… (first one may take a few seconds)" loading state; keep timer gated on `scramble !== null`.
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
- Stage 1 (CAS/audit/undo) was approved on 2026-10-28 and delivered except for the real-provider validation gate.
- Stage 0 was completed and committed on 2026-10-28.
- Stage 2 is the next stage that requires explicit approval.