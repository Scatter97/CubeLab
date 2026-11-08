# CubeLab C1–C3 repair plan

Date: 2026-11-07. Repository: `/home/joshua/cube-lab`.
Status: implemented and verified; see the C1–C3 section in [STATUS.md](../STATUS.md).

## Scope and evidence

Repair the three findings from the independent review of the current V1/V2 implementation. Preserve the earlier B/F/J/D/V repairs and unrelated working changes. Current code and new reproductions take precedence over earlier completion summaries. This plan is explicitly requested by the user despite the general instruction against additional session handoff documents.

The independent review passed 917 unit tests, 37 session-management/cross-tab Chromium cases, and three selected backup/offline Chromium cases. Two additional buffer probes and three empty-scope layout probes failed. These new failures establish the scope below; the review does not establish that these are the only bugs in the application.

Detailed evidence is at `/home/joshua/Documents/Codex/2026-11-07/referenced-chatgpt-conversation-this-is-an/outputs/CubeLab-independent-V1-V2-review-2026-11-07.md`. External probe sources are useful starting points, but acceptance regressions must live in the repository and exercise current production paths.

## Preparation and constraints

1. Read `AGENTS.md`, the relevant current sections of `STATUS.md`, `README.md`, and `KNOWN_LIMITATIONS.md`; load architecture, sync-safety and timer-testing skills as applicable. Inspect Git status before editing.
2. Trace `src/lib/pendingCompletion.ts`, `src/hooks/useSessions.ts`, `src/hooks/useDurableReplacement.ts`, `src/hooks/useSync.ts`, `src/lib/startupRecovery.ts`, `src/bootstrap.tsx`, and their owning tests. Follow shared reconciliation and deletion provenance only as needed.
3. Add owning regressions and observe the relevant failures before production edits. Preserve solve IDs, events, timestamps, penalties, comments, scramble and provenance. Validate full records and backup round trips, not counts alone.
4. Use synthetic fixtures, isolated browser contexts and mock Drive. Do not clear real user storage, install dependencies, contact live Drive, commit or push. Do not weaken active-timer adoption, startup gating, deletion/Undo provenance, backup limits or confirmation flows.
5. Keep changes focused on C1–C3. Do not redesign unrelated storage or sync behavior. If resolving cross-tab races requires an API change, trace every caller and retain honest failure reporting.

## C1 — event-compatible completion replay (P1)

Evidence: `src/lib/pendingCompletion.ts:266` resolves an existing destination by ID only, then appends solves at line 277. Reconciliation at line 304 does not prevent the resulting mixed-event data. Line numbers are review-time anchors; locate the current symbols if they move.

Reproduce:

1. Original collection has empty 3×3 session `a`.
2. Buffer accepted 3×3 solve `buffered-A` for `a` using `recordPendingCompletion`.
3. Replay onto a replacement where the same session ID `a` now declares event `222`.
4. Assert event compatibility and serialize/parse the resulting native backup.

Current result: the 3×3 solve is inserted into the 2×2 session; the real backup parser rejects it.

Repair requirements:

- Reuse the original destination only when event-compatible. Preserve the original solve event; do not convert it merely to fit a replacement.
- Route incompatible or missing destinations into a stable, labelled compatible recovery session. Replaying the same buffer must not duplicate solves or recovery sessions.
- Ensure later reconciliation does not undo the routing. Reuse existing event/recovery helpers when their semantics fit; avoid a broad rewrite of shared merges.
- Preserve custom-event definitions needed by recovered entries without discarding replacement definitions. Cover a custom-event case and any definition collision touched by the implementation.
- Keep deliberate later-deletion handling intact; replay must not become a way to resurrect a superseded solve.

Required regression outcomes: compatible owner reused; missing/reclassified owner recovered safely; repeat replay idempotent; full solve fields intact; resulting native backup accepted by the real parser. Cover startup replay and idle cross-tab adoption through their owning tests.

## C2 — acknowledge buffered completions only after durable incorporation (P1)

Evidence: `src/hooks/useSessions.ts:151` clears the entire shared buffer after any ordinary successful session save. The committing coordinator calls `replaceSessions(plan.sessionsData)` at `src/hooks/useDurableReplacement.ts:159`; that candidate need not contain another tab's buffered completion.

Reproduce with the current hook/coordinator sequence:

1. Mount `useSessions` on an original collection.
2. Begin a replacement and stage candidate sessions.
3. Record another tab's accepted solve into the shared buffer.
4. Mark the replacement committed and publish its candidate through `replaceSessions`.
5. Inspect both disk sessions and the buffer, then reload.

Current result: the accepted solve is absent from both durable locations. This was reproduced with a controlled hook-level interleaving; add an actual coordinator/browser regression as well.

Repair requirements:

- Remove unconditional buffer erasure from generic persistence. An unrelated successful save does not acknowledge buffered entries.
- Incorporate the applicable buffer into the durable replacement outcome before acknowledging it. Retain a durable copy until collection persistence succeeds; failed collection writes must preserve pending entries and report failure accurately.
- Acknowledge only the exact entries/versions incorporated. Preserve newer appends, including an append between taking a replay snapshot and cleanup. A read/check/remove sequence alone is not a cross-tab transaction.
- Protect buffer read/modify/write and acknowledgement against competing same-origin writers. Evaluate the existing shared Web Lock contract and synchronous timer-completion constraints before choosing coordination. Do not introduce nested-lock deadlocks or defer authoritative solve recording to a presentation tick. If safe acknowledgement cannot be established, retain entries for idempotent replay instead of deleting them speculatively.
- Trace all record/replay/cleanup callers, including the committing tab, idle follower adoption and startup recovery. Define failure and no-Web-Locks behavior explicitly. Do not claim atomicity across localStorage keys.
- Repeated replay or failed cleanup must not duplicate solves, create retry/render loops, roll back later accepted work, or revive a causally later deletion.

Required regressions: real coordinator commit with follower completion; two competing appends; append between snapshot and acknowledgement; failed collection save; failed buffer cleanup; reload before/after commit; idempotent replay; event-compatible replay from C1; active/prepared/rolled-back ownership cases remain passing. Test precisely controlled interleavings rather than timing-only sleeps.

## C3 — stable Analytics menu position (P3)

Evidence: `src/index.css:6311` gives the menu `position: sticky; top: 4px`. The desktop empty-scope rule near line 8114 uses `align-items: start`. Switching from the shorter Practice activity panel to Advanced analytics changes the sticky constraint.

Reproduce with an empty session: open Analytics, select Practice activity, then Advanced analytics. At 1440×900, 1920×900 and 2880×1800, the heading moves Y=283→287 and the first tab Y=304→308; the content panel remains Y=283 and scroll offsets stay zero. A browser-only `position: static` override eliminates the shift.

Repair requirements:

- Neutralize the inappropriate sticky offset in the affected bounded desktop layout. Choose the smallest CSS change that preserves intended scrolling in other layouts.
- Extend `e2e/analytics-layout.spec.ts` with empty-scope geometry assertions; its existing desktop fixture has 60 solves and misses this bug. Test both no history and an empty filtered result from populated history.
- Switching repeatedly between Practice activity and Advanced analytics must preserve menu heading/tab coordinates and focus. Different content-card heights are allowed.
- Retain populated-scope, short-height desktop, keyboard navigation and mobile-selector behavior. Do not patch this by forced scrolling, arbitrary panel heights, or disabling focus access.

## Implementation order and verification

Write the failing regressions first, then repair C1, repair C2 across its callers, and apply C3. C1 provides safe replay for the C2 integration. Run focused tests during work; finish with the following checks once the final source is ready. Keep separate browser suites sequential.

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
npm run typecheck
npm run lint
npm test
npm run test:e2e -- e2e/session-management.spec.ts e2e/cross-tab-timing.spec.ts e2e/analytics-layout.spec.ts --project=chromium --workers=4
```

Also run selected native backup/import, mock Drive restore and offline bootstrap cases in `e2e/timer.spec.ts`. Select by the current test titles; run the full timer/response specs only if timing/input source changes or the new implementation creates an unresolved timing concern. Restore normal output with `npm run build` after all mock-Drive browser runs, then run `git diff --check`.

Relevant unit owners include `pendingCompletion.test.ts`, `useSessions.test.ts`, `useDurableReplacement.test.ts`, `useSync.test.ts`, `startupRecovery.test.ts`, `replacement.test.ts`, `sessions.test.ts`, and `backup.test.ts`. Add tests to the owning existing file rather than relying on external probes. The final full unit run covers previous repair regressions.

## Completion criteria and delivery

- C1 and C2 owning regressions fail on the pre-fix implementation and pass after repair; include the real committing coordinator and a controlled cross-tab browser scenario.
- Every accepted completion remains durable and event-compatible through tested commit, rollback, failure and reload paths. No global buffer cleanup silently discards unrelated/new entries.
- C3 empty and populated rail geometry is stable, with keyboard/mobile behavior preserved.
- Required checks pass or any actual blocker is clearly reported. Distinguish unit/hook evidence, browser evidence and untested hypotheses; never replace a correctness assertion just to obtain green tests.
- Update `STATUS.md` with the current verification, and adjust `KNOWN_LIMITATIONS.md`/`README.md` where behavior or recovery boundaries changed. Do not mark this plan completed until evidence supports each item.
- Report changed files, per-finding results, exact commands/counts, remaining limits and skipped checks. Retain the local-only/non-atomic storage boundaries and explicitly state that Firefox/WebKit, live Drive, physical-device and assistive-technology checks were not performed unless actually run.
- Preserve unrelated changes. No dependency installation, live Drive calls, commits or pushes.
