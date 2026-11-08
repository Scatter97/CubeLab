# CubeLab: implementation plan for the five outstanding issues

**Prepared:** November 7, 2026\
**Repository:** `/home/joshua/cube-lab`\
**Starting point:** Current uncommitted B1–B8, F1–F4 and J1–J3 repairs. The most recent independent scoped verification passed 861 unit tests, 12 selected Chromium cases and the original journal/bulk probes. These are dated results, not a substitute for testing new changes.

## This is the next implementation task

The earlier OpenCode instruction was context preparation only: no modifications, expensive tests, commit or push, then stop. That context-loading task is complete. The new user task explicitly authorizes implementing and testing all five issues below. It supersedes the earlier context-only stop, no-edit and no-expensive-test restrictions for this implementation work.

Read `AGENTS.md`, current `STATUS.md`, `KNOWN_LIMITATIONS.md`, and the applicable project architecture, timer-testing, chart-performance and sync-safety skills. Reuse the context already loaded; do not reread the entire repository or stop with another readiness summary.

**Implement all five issues.** Do not leave them deferred merely because earlier plans excluded them. Preserve unrelated changes and all existing repair work. Use synthetic data, isolated browser contexts and mock/memory Drive. Do not install dependencies, use live Drive, commit or push. No unrelated features or storage-engine rewrite are included.

## Scope, owners and completion behavior

| ID | Issue | Required behavior | Primary owners |
|---|---|---|---|
| D1 | Relative Analytics dates/streaks remain stale across midnight | Refresh time-dependent calculations at local-day changes and after returning to the app, even without solve/filter changes | `src/components/AnalyticsPage.tsx`, `src/lib/analytics.ts`, a focused clock hook if useful |
| D2 | Hold readiness depends on an animation tick | A matching release at/after the configured elapsed threshold starts timing even if no readiness tick arrived | `src/timer/machine.ts`, `src/hooks/useTimer.ts`, input/browser regressions |
| D3 | Exports/uploads can exceed the readers' 10 MB cap | Successful output is readable under existing limits; oversized output is rejected before download/upload with an accurate message | `src/lib/backup.ts`, `DataDialog`, App export, Drive backup/sync upload paths |
| D4 | Activity heatmap allocates every day across huge spans | Sparse full-history calculations and a bounded calendar window; earlier/later dates remain reachable | `src/lib/analytics.ts`, `ActivitySection`, `ActivityHeatmap` |
| D5 | Import/restore publishes and announces success before persistence | Durable, validated replacement before success; deterministic recovery after partial writes/reload; cross-tab/sync guards | `src/App.tsx`, session/settings hooks, storage, sync and recovery coordination |

Recommended implementation order: **D1 → D2 → D3 → D4 → D5**, with separate reviewable changes/regressions. D5 may be designed alongside D3 but must not be reduced to a notification-only patch. Finish the complete batch and its checks.

## Shared constraints

- Preserve solve IDs, raw readings, penalties, comments, scramble text, event, timestamps, field provenance, session order/transfers, custom events and active-selection provenance.
- Keep monotonic event capture and exactly-once recording. Do not move persistence behind a debounce or weaken sync fingerprints/timer locks for responsiveness.
- Keep native replacement and additive csTimer import semantics distinct. Additive import must preserve unrelated metadata and settings.
- Keep the current 10 MB reader cap (`MAX_BACKUP_BYTES`). This task fixes invalid output/success behavior, not unlimited backup size.
- Keep existing worker chunk isolation, offline configuration and `modulePreload: false` intact unless a separately justified change requires the owning offline checks.
- Do not reintroduce notification/recovery render loops. Retries, listeners and timers must be bounded, cleaned up and independent of unrelated renders.
- Treat localStorage keys as separate writes, never an atomic transaction. Retain the explicit Undo commit policy and compatible recovery sessions.

## Step 0 — Establish current state and reproduce

1. Inspect Git status/current changes. Existing untracked recovery modules/tests and audit/plan documents are intentional work; preserve them.
2. Inspect only the owners/tests relevant to the next issue.
3. Reproduce each issue in its owning test before changing production behavior. Use the earlier evidence as a starting point, not an excuse to skip a current regression.
4. If newer local work already fixes a case, demonstrate it with a passing regression and record the reason.
5. Maintain a D1–D5 completion checklist with actual evidence. Do not call an item fixed when only its normal path was exercised.

## D1 — Refresh relative dates and activity streaks

### Design and implementation

- Introduce one shared local-day/time invalidation source for the mounted Analytics page rather than separate timers for every chart.
- Schedule the next refresh using the next **local calendar midnight**, not a fixed 24-hour interval. Recompute the next deadline after each wakeup.
- Recheck on visibility/focus return so suspended/background tabs and clock/time-zone changes catch up. Recompute from the current wall clock, not from a count of elapsed timer ticks.
- Feed the same effective `now`/local-day token into relative-date filtering and `buildActivity`/current-streak calculations. Include the token in the relevant memo dependencies; a rerender alone does not invalidate a memo.
- Keep custom absolute date bounds stable. Do not change saved filters, solve timestamps or historical aggregates just to refresh today's membership.
- Clean up timers/listeners on unmount and preserve the rule that expensive Analytics work does not run while timing.

### Acceptance

- Today, last-7/30/90/365-day presets update while data/filter references remain unchanged.
- Current streak updates when yesterday becomes two days ago, without recording another solve.
- Local midnight across spring/fall DST, month/year changes and a non-DST zone.
- Background/sleep past midnight then visibility/focus return; changed local day/time zone where applicable.
- No unnecessary repeated recomputation before the day changes; StrictMode/unmount cleanup is correct.
- Browser clock tests verify the displayed matching solves and streak, not merely that a hook timer fires.

## D2 — Decide readiness from elapsed hold time on release

### Design and implementation

- In the pure state machine, a `holding` release from the matching input checks `event.at - holdStartedAt >= holdDurationMs`.
- If satisfied, transition directly to `running` using the release timestamp as `startedAt`. Preserve the originating input and inspection start.
- A release before the threshold retains current behavior: return to idle or continuing inspection as appropriate.
- Existing `ready` releases remain valid. A presentation tick may change the visual state but is no longer required for an eligible release.
- Use the configured zero threshold correctly. Preserve source mismatch, repeats, blur/cancel, pointer cancellation and exactly-once completion.
- Derive inspection penalties from the actual solve start/release timestamp. Do not use the last animation timestamp or display rounding.

### Acceptance

- Threshold −1 ms, exact threshold, threshold +1 ms; zero-duration hold; no animation ticks at all.
- Keyboard and pointer; wrong-source release; repeated events; later tick after starting is harmless.
- Inspection crossings at 15,000/17,000 ms, including a long hold crossing either boundary.
- Hook tests deliberately withhold rAF readiness callbacks and still start on an eligible release.
- Browser regression verifies eventual saved duration, one record, scramble association, reload and session ownership. Do not use host-specific latency thresholds as correctness assertions.

## D3 — Ensure every successful output fits its reader

### Scope decision

Keep the 10 MB cap. Prefer a valid compact full backup when formatting expansion would otherwise make a readable collection too large. If the actual complete serialized payload is still above the cap, **block the operation truthfully before output** and preserve all local/remote state.

This resolves the bug of creating an unreadable backup. It does not promise that arbitrarily large collections can be backed up under an unchanged size limit. Document that product limit explicitly; do not silently omit solves, prune metadata, split a full replacement into unrelated partial files, or claim success for partial output. Multipart/compressed formats are not required for this batch.

### Design and implementation

- Share a checked serializer/preflight around the actual complete backup/envelope payload. Measure **UTF-8 encoded bytes**, including formatting/newline and sync metadata, against `MAX_BACKUP_BYTES`.
- For native export, keep readable formatting when it fits; fall back to compact JSON if it makes the complete payload fit. Validate the exact string that will be downloaded.
- Native export, manual Drive backup and automatic sync upload must all check before their output side effect. Do not upload an oversized snapshot that every future all-snapshot read will reject.
- For sync, perform the check after building the merged/enveloped snapshot but before publishing a success/adopting state contrary to existing upload-before-adoption guards.
- Classify oversize as a persistent data-limit outcome, not a transient network error to retry in an immediate loop. Preserve dirty/pending state and show actionable status.
- Report size and limit clearly. If output is blocked, say no usable full backup/upload was created; do not show “Backup exported/saved” or update successful-backup metadata.
- Materialize pending Undo recovery safely before measuring. Preserve the journal-only copy when output is blocked.
- Reuse existing libraries/browser capabilities. No dependency installation or reader-cap increase.

### Acceptance

- Exactly-at-limit and over-limit UTF-8 fixtures, including non-ASCII comments and envelope metadata.
- Pretty output exceeds cap but compact output fits: emitted full backup round-trips through the actual reader path.
- Compact payload exceeds cap: no download/upload, no false-success toast/metadata, no local data/journal mutation.
- Empty, normal, large, custom-event and pending-recovery backups retain all fields.
- Manual and automatic mock Drive uploads respect the same limit and do not poison the snapshot set.
- Repeated automatic triggers do not create retry/notification churn for unchanged oversized data.

## D4 — Bound calendar work independently of date span

### Design and implementation

- Keep full-history aggregates sparse: group existing solves/active dates, count elapsed span mathematically, and compute totals/streaks/frequency without generating every empty date.
- Separate sparse reports/full extent from the materialized calendar window. The report API should not allocate an all-span daily array as a hidden preliminary step.
- Render a bounded window, such as roughly one year, with previous/next and date-jump navigation. Preserve access to the complete filtered history and clearly display the current window/full extent.
- Generate empty cells only for the current bounded window. Do not silently truncate history to “latest year” with no access to older dates.
- Avoid a single spacer/scroll width proportional to millions of days; browser layout dimensions are bounded too. Paging or bounded-range navigation is preferable to an enormous invisible canvas.
- Keep weekly/monthly volume and best/worst-day calculations correct across the complete filtered range. A viewport change must not change totals or make older solves disappear from drill-down.
- Use local-calendar arithmetic through DST/leap boundaries and validate finite representable dates. Handle empty data, reversed/out-of-range navigation and filters that shrink the extent.
- No worker/storage-engine rewrite is required to fix allocation proportional to elapsed days.

### Acceptance

- Two solves separated by 100,000 days: correct aggregates with a bounded materialized day count, not 100,001 rows.
- An extreme valid representable date range: inspect data-structure sizes and rendered cell counts without allocating the full span.
- Normal multi-year data: navigate to earliest/latest days and drill down to the correct solves.
- Window boundaries, leap day, DST, month/year labels, empty filters and filter changes.
- Browser DOM/cell counts remain bounded and controls are keyboard-accessible at narrow widths.
- Keep old correctness totals and counts; revise tests that assumed all days must be eagerly materialized to assert equivalent accessible behavior.

## D5 — Make import/restore completion durable and recoverable

### Required scope

Cover native JSON replacement and manual Drive restore, including sessions, settings and sync metadata changed by their commit path. Use a checked persistence path for additive csTimer import too so “imported” is not announced before its required session write; keep its additive metadata semantics intact.

A late boolean check after overwriting one key is insufficient. A best-effort rollback whose failure loses the recovery copy is insufficient. Suppressing a success message alone does not resolve the data-safety problem.

### Design before implementation

Write a short design note in the owning code/documentation defining:

- all keys/metadata affected by the operation;
- the last committed state, staged candidate and commit point;
- recovery after interruption between each write;
- cross-tab behavior while the replacement is staged;
- behavior when storage cannot hold a staging/recovery record;
- how existing pending Undo recovery is completed/preserved before replacement.

Use a focused replacement coordinator/recovery record or an equivalently proven protocol. A local durable staging record holding required before/after values, operation identity and commit phase is an acceptable approach. Do not replace all persistence with IndexedDB as part of this repair.

### Commit invariants

1. Parse and validate the full candidate before any mutation; retain existing preview/confirmation.
2. Recheck timer/session/current-state guards at confirmation and before committing.
3. Prepare durable recovery information **before** overwriting any committed key. If preparation fails, block with the old collection/settings/metadata unchanged.
4. Serialize same-origin replacement commits with an appropriate shared coordination boundary. Prevent cross-tab followers and sync from adopting/publishing an intermediate staged collection.
5. Persist all required candidate values and an explicit durable commit decision before publishing replacement React state, refs and success metadata.
6. Before the commit point, interruption must recover the previous complete state. After it, interruption must recover the new complete state. Choose and document equivalent deterministic semantics if using a different protocol.
7. If rollback/roll-forward or journal cleanup fails, retain the recovery information, surface an actionable pending state, and block unsafe publication. No render/retry loop, false success or deletion of the only recovery copy.
8. Apply sync provenance/reset bookkeeping as a detached candidate where needed; do not call mutating `resetBase` early and discard the previous metadata if the replacement cannot commit.
9. Never clear unresolved Undo recovery as a side effect of importing unrelated data. Complete/materialize it safely or block with a clear explanation before staging replacement.
10. Report success only when the intended committed collection/settings survive reload. Correct `lastRestoreAt`/backup/import status only at that point.

If staging needs more quota than is available, an honest no-change failure is acceptable. Do not bypass recovery to force a large import through. Keep last committed data exportable when safely possible, subject to D3's unchanged output limit.

### Acceptance matrix

- Native replacement, manual Drive restore, additive csTimer import; normal and empty-session backups.
- Fail preparation, each affected key write, durable commit marker, rollback/roll-forward and final cleanup independently.
- Reload/remount after every write boundary. Validate exact session/solve IDs, fields, settings, selection and sync metadata—not just counts.
- No success notification or successful-restore timestamp before commitment.
- A second tab and an in-flight sync cannot consume/publish half of a replacement; no in-flight solve is redirected.
- Existing deletion tombstones, approvals, redirects, transfers and pending Undo semantics survive the chosen outcome.
- Legacy payloads and ordinary backups remain readable. Validate new recovery records and malformed/unsupported versions conservatively; do not silently convert unreadable pending transaction state into “no transaction.”
- Repeated recovery is idempotent and bounded, including sync disabled and storage still failing.

## Verification workflow

Run focused checks after each logical change; do not run suites concurrently. Use Node 22+ and the existing dependency set. Add owning regressions before fixes.

### Logic groups

D1/D4: Analytics pure calculations, page/component tests and the new day-refresh/range-window helpers.\
D2: machine, timer hook, timer surface and input-boundary regressions.\
D3/D5: backup, storage, settings/session hooks, Drive backup/sync, replacement/recovery, and cross-tab ownership tests affected by the design.

```bash
npm run typecheck
npm run lint
npm test -- src/lib/analytics.test.ts src/components/AnalyticsPage.test.tsx
npm test -- src/timer/machine.test.ts src/hooks/useTimer.test.ts src/components/TimerStage.test.tsx
npm test -- src/lib/backup.test.ts src/lib/storage.test.ts src/hooks/useSettings.test.ts src/hooks/useSessions.test.ts src/hooks/useSync.test.ts src/hooks/useDriveBackup.test.ts src/lib/remoteBackups.test.ts src/lib/solveRecovery.test.ts
```

Add every newly created owning test file and any changed metadata parser/merge tests. Once focused tests pass, run the full unit suite once.

### Browser groups

```bash
npm run test:e2e -- e2e/analytics.spec.ts --project=chromium --workers=4
npm run test:e2e -- e2e/timer.spec.ts e2e/timer-response.spec.ts e2e/cross-tab-timing.spec.ts --project=chromium --workers=4
npm run test:e2e -- e2e/session-management.spec.ts e2e/custom-events.spec.ts --project=chromium --workers=4
```

Add targeted cases for midnight without data changes, withheld animation ticks, huge date-range navigation, output-size rejection, and replacement failures/reload/cross-tab staging. Keep expensive synthetic allocations bounded. Do not omit destructive/import/restore checks because normal timer tests pass.

After the final mock browser run:

```bash
npm run build
git diff --check
```

Restore normal non-mock production output. Run the supported production offline case if worker/PWA/build behavior changes. Do not claim a full browser matrix, real-provider or physical-device validation unless actually performed.

## Documentation and delivery

- Update `STATUS.md` with actual D1–D5 implementation and dated checks.
- Update `KNOWN_LIMITATIONS.md`: remove resolved defect descriptions, retain genuine product limits such as the unchanged 10 MB cap, and explain replacement/recovery semantics accurately.
- Update README behavior affected by hold readiness, Analytics navigation, output rejection and import/restore success/recovery.
- Preserve the dated audit documents and previous repair work.
- Final report must include a D1–D5 table: status, changed owners, regression evidence and remaining limits. Distinguish a deliberately retained size limit from an unfixed invalid-output bug.
- Report commands/results, skipped checks and any genuine blocker precisely. Do not declare all five complete if a failure/recovery path remains unresolved.
- Do not commit or push.

## Completion checklist

- [ ] D1 updates relative filters/streaks across midnight and visibility return without changing data.
- [ ] D2 starts eligible holds on release without requiring an animation tick and preserves timing/inspection invariants.
- [ ] D3 never announces/emits a successful output that its capped readers reject; unchanged oversize payloads fail safely and visibly.
- [ ] D4 calculations and DOM are bounded independently of elapsed date span, with older history still accessible.
- [ ] D5 imports/restores have a documented durable commit/recovery protocol, honest status, and tested partial-write/reload/cross-tab outcomes.
- [ ] Earlier B/F/J repairs and all unrelated changes remain intact.
- [ ] Required focused/full unit/browser checks pass; normal production build restored; working diff checked.
- [ ] Documentation accurately states fixed defects, supported limits and unverified platforms.

Older evidence is in `/home/joshua/Documents/Codex/2026-11-07/referenced-chatgpt-conversation-this-is-an/outputs/`, including the follow-up reviews and `CubeLab-journal-final-verification-2026-11-07.md`. The baseline audit was moved into `docs/CubeLab-audit-2026-11-07.md`. Reproduce the five current paths rather than copying superseded fixtures for already repaired B/F/J bugs.
