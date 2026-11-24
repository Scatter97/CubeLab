# CubeLab Competition Sessions — Design Specification

**Status:** Approved design implemented on 2026-11-19. This document remains the
feature source of truth; implementation decisions are recorded in §10.
**Baseline:** clean `master` at `9f38d3d` (perf pass: shared serialization + Analytics rolling series).
**Repository location:** `docs/development/COMPETITION_SESSIONS_DESIGN.md`.
Follow repository documentation conventions (README behavior notes, STATUS
checkpoint, KNOWN_LIMITATIONS entries at delivery).

---

## 1. Summary

A new session kind — **Competition** — turns a session into an endless series of
WCA-style rounds. When creating the session the user picks a format (ao5, ao12,
ao50, mo3 or bo3). Every solve recorded in that session is assigned to a round
automatically; a round is complete when it holds `size` attempts, and the next
solve opens the next round. Rounds and solves are both presented in the UI.
The session can be used indefinitely; rounds accumulate.

Competition solves are ordinary solves: they persist, sync, merge, import,
count in Analytics/PBs and support deletion/Undo through the existing machinery.
Rounds are **derived from solve data** (grouping by an optional `roundId`), never
stored as separate entities. This is what keeps sync, deletion and recovery
simple: there is no second data domain, no new conflict types, and no separate
storage key.

## 2. Data model — sessions schema v6 → v7

```ts
Session {
  ...existing v6 fields
  kind?: 'practice' | 'competition'     // absent = practice (backward compatible)
  competitionFormat?: {
    type: 'ao' | 'mo' | 'bo'
    size: 3 | 5 | 12 | 50               // resolved from the chosen format
  }
}

Solve {
  ...existing v6 fields
  roundId?: string                      // groups attempts into one round
  roundIndex?: number                   // 0..999, attempt number within the round
}
```

Rules:

- **Additive and optional.** Every stored v6 payload, older Drive snapshot and
  backup must parse unchanged. `SESSIONS_VERSION` becomes 7; payloads save back
  at v7 on the next write. No destructive migration; no rewrite of stored bytes
  at load.
- **Validation** (`parseSolve`/`parseSession` in `src/lib/storage.ts`):
  `roundId` is a non-empty string (bounded like other ids), `roundIndex` an
  integer 0..999; invalid values are dropped like other tolerant-parse fields,
  never fatal. An absent `kind` (or explicit `'practice'`) means practice;
  `competitionFormat` is required (and validated against the format registry)
  when `kind === 'competition'`. Invalid competition metadata is read as
  practice while the session and its solves are retained.
- **Rounds are derived:** a round = all solves in a session sharing one
  `roundId`. Round order and numbering in the UI derive from chronology, not a
  stored counter. A `roundId` with no remaining solves ceases to exist.
- A competition session's format is **immutable** for the life of the session.
- **No separate storage key.** Nothing joins `siteReset` beyond the existing
  sessions key. csTimer/native imports create practice sessions; imported
  solves are simply ungrouped.

### Format registry (defaults confirmed)

| Format | Meaning | Default for |
| --- | --- | --- |
| ao5 | average of 5, best/worst trimmed, 2+ DNF ⇒ DNF | every event except 6×6, 7×7 |
| ao12 / ao50 | same WCA-style trimming at larger windows | user-selectable |
| mo3 | mean of 3, untrimmed (project rule: mo3 is untrimmed) | 6×6, 7×7 |
| bo3 | best of 3 attempts | user-selectable |

## 3. Round behavior

- **Auto-fill only.** There is no "start new round" control — like a real
  competition, the open round must fill before the next opens. A partially
  filled round stays open indefinitely (next solve continues it).
- **The only way a round disappears** is deleting all of its attempts (rounds
  are derived). Deleting one attempt leaves the round visibly **incomplete** —
  the UI must never present an ao4 as if it were an ao5.
- **Undo restores** a deleted attempt with its `roundId`/`roundIndex` intact,
  completing the round again.
- **Round results** come exclusively from the existing shared kernel
  (`calculateAverage` + `getAverageTrimCounts` in `src/lib/stats.ts` /
  `src/lib/averageTrimming.ts`) — no new statistics code. bo3 = best attempt
  by effective time.
- **Entry rule (the single grouping rule, applies everywhere):** whatever
  enters a competition session is round-assigned at entry via one pure
  function. Merge, split and solve recording all funnel through it:

```ts
// src/lib/competition.ts (new, pure)
assignRoundMembership(incomingSolves, session, format): Solve[]
```

  - Freshly timed attempts join the newest open round; spill into new rounds
    when full.
  - Merged-in solves have any previous round fields discarded, then are
    assigned the same way — the destination session's format is the single
    source of truth.
  - Merge into a practice session drops round fields (existing behavior shape).
  - Split: the split dialog gains a kind (and format) choice for the new
    session, default practice. Extracted solves get the entry treatment
    (stripped for practice, assigned for competition). The source round may
    become incomplete, which it honestly is.
  - **No merge or split is blocked.** Every solve in a competition session
    always belongs to a well-formed round of that session's format.

- **Conversion is one-way:** competition → practice flattens in place (strip
  round fields from its solves, remove `kind`/`competitionFormat`); practice →
  competition is never offered anywhere (it would require inventing rounds for
  solves that never happened as rounds).

## 4. UI

- **Session creation dialog** (`src/components/SessionSetupDialog.tsx`):
  type toggle Practice/Competition; a format picker appears for Competition,
  with the per-event default preselected. The dialog keeps the existing name
  allocator and focus behavior.
- **Timer sidebar (rails only — clock geometry is a hard invariant and must
  stay untouched):**
  - *Attempts panel:* solves grouped under round headers, e.g.
    "Round 14 · ao5 · 12.34", each header expandable to its attempts;
    incomplete rounds marked. Reuse the existing row windowing.
  - *Statistics panel:* per-session round list (latest, best, DNF rounds)
    reusing the detailed-statistics presentation patterns; the round summary
    after a round completes shows the attempt table with each solve's comment,
    best/worst marked trimmed, the result, and a comparison against the
    session's best round.
  - Round cumulative displays must update through the existing post-paint
    scheduling pattern so stop latency is unaffected.
- **Session switcher/list:** competition sessions carry a small format badge.
- **Input boundaries:** all existing rules apply unchanged — settings/session
    controls locked while armed/inspecting/running, global Space reserved,
    modal locks and focus containment for the round summary, exact-once
    recording, and the timer's authoritative ref for duration.
- **Analytics:** competition solves count normally in Analytics, PBs and Time
  Trend. The Analytics filter panel gains a **session-type control**
  (All / Practice / Competition) flowing through `filterAnalyticsSolves`
  (it already receives the session objects) and the session-comparison
  section; it participates in the active-filter count and reset behavior.

## 5. Ownership map

| Concern | File(s) |
| --- | --- |
| Types | `src/types.ts` |
| Format registry, assignment, grouping, round results (pure) | `src/lib/competition.ts` (new) + tests |
| Kind-aware creation, merge/split entry assignment, conversion op | `src/lib/sessions.ts` |
| Schema v7 validation, `SESSIONS_VERSION` | `src/lib/storage.ts` |
| Sync field passthrough / merge / restore | `src/lib/sync.ts` (verify; expect no semantic change), sync-safety regressions |
| Backup round-trip | `src/lib/backup.ts`, `src/lib/csTimerImport.ts` (no rounds — stays practice) |
| Session ops, creation/conversion API | `src/hooks/useSessions.ts` |
| Wire assignment at the authoritative solve-completion point | `src/App.tsx` |
| Creation UI | `src/components/SessionSetupDialog.tsx` |
| Round presentation | Timer sidebar panels + `src/components/competition/` (new) |
| Session-kind Analytics filter | `src/lib/analytics.ts`, `src/lib/analyticsSettings.ts` (if persisted), `src/components/AnalyticsPage.tsx` |
| Docs | README behavior, STATUS, KNOWN_LIMITATIONS, ROADMAP |

## 6. Guarded-path requirements

- **Schema change:** additive optional fields, migrations + tests required per
  project rules. Load `cubelab-sync-safety` before touching
  storage/sync/backup, and `cubelab-timer-testing` before touching the
  solve-completion path; `cubelab-architecture` for the cross-layer map.
- **One solve, one record:** round assignment happens at the existing
  authoritative completion point (`App.tsx` → `addSolve`), never on display
  timing; assignment is O(1) per solve and must not add work to the save path.
- **Preserve user history:** never clear/overwrite real data; use synthetic
  fixtures and isolated browser contexts.
- **Merge semantics:** fields ride the existing per-solve merge; no new
  conflict kinds; cross-device round creation cannot collide (fresh
  `createId()` per round).
- **No new dependencies.**

## 7. Verification plan (tiered per AGENTS.md)

Focused, sequential suites; four Playwright workers; report exactly what ran,
what was skipped and why.

1. **Pure library tests (write first, red where applicable):** format defaults
   (mo3 for 666/777, ao5 otherwise); `assignRoundMembership` determinism
   (fills open round, spills to new rounds, discards foreign round fields,
   merge/import ordering); round grouping/numbering; round results through the
   shared kernel (DNF-as-worst, 2-DNF ao ⇒ DNF, mo3 untrimmed, bo3 best);
   incomplete rounds after single-attempt deletion; conversion flatten.
2. **Schema/migration tests:** v6 payloads parse unchanged at v7 reader; new
   field validation bounds; backup export/import round-trips round fields;
   csTimer import unaffected; sync merge/restore/adoption with round fields
   (sync-safety regressions, in-flight cases included).
3. **Hook tests:** competition session creation (dialog-driven where
   practical), solve assignment, conversion, storage-failure behavior.
4. **Component tests:** session dialog type/format pickers; round headers and
   summary; controls locked while armed/inspecting/running.
5. **Chromium e2e (`e2e/competition.spec.ts` + existing specs):** create an
   ao5 session (and an mo3 default on 6×6); complete a full round with keyboard
   timing and inspection; DNF attempt then correct penalty mid-round and see
   the result update; delete one attempt → incomplete; delete all attempts of
   a round → round gone; Undo restores a round; merge practice→competition and
   competition→competition (assignment visible); split with kind choice;
   conversion flatten; Analytics session-type filter; reload persistence;
   offline PWA round. Rerun the large-history stop-response regression and
   `e2e/session-management.spec.ts` merge/split cases.
6. `npm run typecheck`, `npm run lint`, focused Vitest files, `npm run build`;
   production offline scenario for the timer workspace; `git diff --check`.

## 8. Phasing

- **Phase 1 — foundation:** types, schema v7 validation + version bump,
  `src/lib/competition.ts` (registry/assignment/grouping/results), pure lib
  and migration tests. No UI.
- **Phase 2 — solving UX:** creation dialog type/format pickers, auto-assignment
  wired at solve completion, Timer sidebar round presentation (headers,
  incomplete marks), round summary. Component + focused Chromium coverage.
- **Phase 3 — structure movers + polish:** merge/split/conversion rules,
  Analytics session-type filter, sync/backup regressions, full focused
  Chromium pass including offline and large-history regressions, docs
  (README/STATUS/KNOWN_LIMITATIONS/ROADMAP).

## 9. Explicitly out of scope (future follow-ups)

Round-history log and text export; cutoff/combined-round simulation;
multi-round "competition day" standings; stackmat/smart-cube input; any
round provenance beyond field passthrough in sync; changing practice
sessions.

## 10. Implementation decisions (2026-11-19)

These details resolve cases that the approved high-level design intentionally
left to implementation. They do not change the feature contract.

- **Round numbering and attempt order.** Rounds are grouped by `roundId` and
  sorted by their earliest `createdAt` (stable ID tiebreak). Round numbers are
  one-based positions in that chronology. Attempts inside a round sort by
  `roundIndex`, then `createdAt`, then ID.
- **Entry index.** A freshly timed solve fills the newest round while that round
  has fewer than `size` attempts and its next index is still below `size`. The
  next index is `max(roundIndex) + 1`, so a deleted middle attempt remains an
  honest gap. If the newest round is full (or its next index would exceed the
  format), the solve opens a new round with index 0. The scan is bounded by the
  format size, not total history, so assignment stays O(1) with respect to the
  session.
- **Incomplete and overfull rounds.** A round is complete only when its derived
  attempt count equals the format size. Fewer attempts show `Incomplete · n/size`
  and never produce an average. An Undo after a replacement attempt can
  temporarily leave more than `size` attempts in one round; that round also
  shows incomplete and produces no result rather than silently dropping an
  attempt.
- **Split kind choice.** The new-session kind is selectable only when the source
  is a competition session. A practice source can only split into practice,
  preserving the one-way conversion rule everywhere. The split defaults to
  practice as specified.
- **Sync convergence.** Round fields pass through the existing per-solve merge.
  A session whose merged metadata resolves to practice strips stray round
  fields; a competition session keeps valid memberships and assigns any missing
  ones through `assignRoundMembership`. If one snapshot says practice and the
  other says competition, the flattened practice form wins, consistent with the
  one-way conversion rule. No new conflict kind is introduced.
- **Round completion presentation.** The summary detection compares the
  current newest round's completion state only after the timer returns to idle.
  It is initialized from existing history, so reload or switching to an
  already-completed round does not open the dialog. The Attempts and Statistics
  rails consume the post-paint solve value, preserving stop latency.
- **Immutability boundary.** `competitionFormat` is accepted only when it
  matches the five-entry registry. An invalid stored competition format is
  read as practice metadata while the session and its solves are retained, and
  session kinds are never inferred from solve round fields.
