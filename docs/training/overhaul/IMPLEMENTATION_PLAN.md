# Training overhaul implementation plan

**Prepared:** 2026-11-11  
**Delivery state:** O1 through O8 implemented. Integrated verification and
documentation are complete; no overhaul phase remains.

[Current progress](CURRENT_PROGRESS.md) is the handoff entry point.
[Training status](../CURRENT_STATUS.md) describes the shipped behavior.
[Project memory](../PROJECT_MEMORY.md) records the existing contracts and
which approved decisions this overhaul changes.

## Product contract

### Training Hub and naming

- Opening Training lands on the **Training Hub**, with no timer, previous
  result, generated setup, or new session behind it. Restore the last selected
  set, practice type, and cases. Keep case selection as a draft until **Begin
  practice**; algorithm, difficult-case and preset changes save immediately, and
  controls disable while the Hub is locked. Execution requires one usable case.
  Recognition requires two.
- Put the session name, OLL/PLL, Execution/Recognition, case count, **Edit
  cases**, and one primary **Begin practice** button together. Explain that
  Recognition includes setup moves. Place category-scoped basic stats and a
  link to Algorithms alongside the form. Stack the layout at narrow widths.
- Below the form, show recent sessions as compact, newest-first history rows,
  following the reference's visible **Review** action. Show name, set and type,
  attempts, comparison when available, and date. **View all** opens the archive.
  Each **Review** opens the same report used when ending a live session.
- Use a muted suggested name in an empty editable field. Changes to category
  update the suggestion while the field is empty. Typing a name overrides it.
  Clearing or entering only whitespace uses the suggestion again. The first
  generated name has no suffix, for example `OLL Recognition`, followed by
  `OLL Recognition (2)`. Apply the same interaction to Timer's Create session
  dialog with the selected event's display name, including custom events.

### Begin, calibration, and practice

- **Begin practice** validates and captures the session name, set, practice
  type, cases and one chosen algorithm revision per case. Preserve that
  configuration for the session and on resume. No rotation of algorithms
  within a case. When tracking is enabled, default to the preferred algorithm
  and allow a per-session override. When disabled, use the existing preferred
  resolution internally to prepare valid setups.
- Recognition checks only the selected set's calibration at Begin. A missing
  calibration or either the configured age or attempt limit triggers required
  calibration. Use the median of seven accepted samples. Finish calibration
  before opening the session and keep samples outside practice history.
  Cancelling returns to the Hub with the draft intact. A limit reached during
  practice takes effect at the next session start, including after a resume.
  Execution does not require calibration.
- Use the existing timer, setup area, and sidebar. Replace Training Setup with
  **Current session**, showing the name, category, case count, and **End
  session**. Keep display settings and **Mark difficult** accessible. Changes to
  global preferences cannot redirect a running attempt or alter the captured
  pool. Keep a same-session Execution retry and omit Recognition's
  cross-category retry shortcut.
- Scope Attempts, Statistics, the readout result, and Last Result by the active
  session ID. Start with an empty history and neutral clock. In-session
  corrections, deletion and Undo continue to use the existing checked
  operations. Saved attempt timing and session membership stay exact.

### End, navigation, and recovery

| Situation | Required outcome |
| --- | --- |
| **End session** | Open a small anchored submenu with a second **End session** action and **Keep practicing**. A confirmed end with saved attempts opens the report after the end write succeeds. |
| Click Timer or Analytics during practice | Offer **End session and leave** in the same pattern. Present the report first, then continue to the selected destination when the report closes. Cancelling leaves the user in practice. |
| Idle threshold | After 15 minutes by default, show **Are you still there?** with **Keep practicing** and **End session**. The interval is adjustable in Training Settings. Defer prompting during an armed or running attempt. The proposed prompt waits for a decision. |
| Refresh with a saved active session | Show **Resume session** and **End session**. Resume restores the captured configuration and saved attempts and prepares the next setup. |
| Confirmed site closure and reopening directly into Training | End the old session, explain why, and open its report if it contains attempts. |
| Reopening on Timer or another destination with an unfinished session | Offer **Continue session** or **End session**. Continue returns to practice. Ending with attempts opens the report, then returns to the original destination. |
| Ambiguous browser restore | Require an explicit continue/end choice before mutating history. Pagehide and unload alone do not prove closure. |
| Zero saved attempts | Return to the Hub or requested destination with no report and no archive row. An all-DNF session with a saved attempt qualifies for the archive. |

A nonempty ending always opens the exact session report. There is no
skip-report action. After it opens, **Done** and Escape go to the Hub or
the queued destination. Historical review closes back to its originating list
and filters. Remove the old **New practice report** notice from Timer as the
new end/recovery flow takes over. Preserve access to previously saved reports.

Checked persistence, single-tab ownership, and timer input guards apply to
every transition. Failed writes retain the prior saved view and expose
recovery. Never open a success report before the end write succeeds. Persist
enough state to recover an interrupted required report. Once archived,
attempts are read-only through all entry points and stale Undo actions cannot
reopen or change the archive.

### Reports, archive, and Algorithms

- **Session report.** Reuse the Training dialog and chart styles. Show name,
  category, elapsed session time, attempts, successes, DNF rate, best, mean
  successful time, an attempt-order chart, case breakdown, and attempt details.
  DNFs and missing values stay distinguishable from numeric timings. Support
  keyboard chart inspection, sensible focus return and narrow layouts.
- **Time measures.** Show elapsed session duration separately from measured
  attempt time. Execution attempts supply measured execution time. For
  Recognition, compute combined estimate as measured attempt time minus the
  captured setup calibration median. Estimate execution from the median of
  at least three successful matching Execution attempts for the same case and
  algorithm revision. Subtract that estimate from the combined estimate for
  Recognition. Leave the split unavailable when matches are insufficient,
  identity is unavailable, or the subtraction would be negative. Show coverage
  of the estimated components and keep raw results unchanged. The seven
  setup calibration samples and the execution baseline serve different roles.
- **Improvement.** Preserve the existing configurable historical window,
  with 90 days by default and a cutoff before the session starts. Compare
  successful attempts in the same category and case against the full category
  history; session counts and other statistics remain session-scoped. Require
  three matched cases with at least three successful samples on each side for
  the overall headline. A one-case drill gets a case-specific comparison with at
  least five successes on each side. Show coverage and insufficient history
  explicitly. Use signed time change and text, for example **−5% faster** or
  **+8% slower**, with green/red as secondary cues. Report DNF separately.
- **Archive deletion.** Reuse the existing typed `DELETE` confirmation.
  Remove the exact session and its owned attempts in one checked Training
  update. Use a scoped deletion operation so other historical visits remain
  protected. Preserve calibration and recognition renewal high-water counts.
  Recalculate Hub/Algorithms totals and affected reports from retained
  history when viewed. Keep later sessions' own records intact. Respect
  each session's saved comparison policy and cutoff. Legacy reports with
  unavailable policy show their recorded stats with an unavailable comparison.
- **Analytics → Algorithms.** Add Execution and Recognition views with OLL/PLL
  filters, case performance, longer-term progression, practice volume,
  DNF rate and access to session history. **Start new session** routes to the
  Hub. Ordinary solve analytics retains its existing data source and entry.
- **Algorithms tracking.** Off by default. Every attempt contributes to its
  case. With tracking on, future attempts also contribute to the exact
  selected algorithm revision as a substat under that case. With tracking
  off, new attempts contribute only to the case and past per-algorithm
  charts remain visible. Re-enabling is prospective. Do not backfill
  attribution from current preferences. Gate custom algorithm management,
  preferred choices and session overrides through the feature. Reuse existing
  verification and immutable revision handling.

## Implementation slices

Keep each phase reviewable and independently verified. Internal additions may
land ahead of their UI while existing entry points retain working behavior.
Do not switch the public flow until the required parts of that slice work
together. Update [Current progress](CURRENT_PROGRESS.md) after each meaningful
checkpoint.

| Phase | Deliverable and source starting points | Exit check |
| --- | --- | --- |
| **O1 · Session foundation** | Map current visit, attempt, calibration, and save contracts in `src/lib/training/{types,schema,storage,records,visits,controller}.ts`. Choose a compatible visit-backed representation for captured session settings, lifecycle state and report recovery. Document migration behavior before editing schema. Add synthetic legacy and new session round trips. | Legacy records, unknown fields, immutable attempt snapshots, and failed writes survive. Existing Training flows still work. |
| **O2a · Session names** | Add shared suggestion behavior and wire Timer's `SessionSetupDialog`. | Event changes, blank/custom names, duplicate handling and cancellation are covered. |
| **O2b · Hub shell** | Build the Hub with saved selections, the shared naming behavior, case editing and a draft. Reuse `TrainingSetup` and `CaseSelectionDialog`. | Opening the Hub creates no session. The draft and layout work at desktop and narrow widths. |
| **O3 · Explicit Begin and practice workspace** | Move calibration gating to Begin and capture the session configuration. Wire `TrainingPage`, `TrainingPreparation`, `useTraining`, and `TrainingController` to the active session. Scope history, stats, last result and next setup. | No setup before Begin. Per-set calibration at the start only. Old and wrong-category results never appear in a new session. Saved attempts record exactly once. |
| **O4 · End, idle and recovery** | Add explicit lifecycle transitions, anchored confirmation, configurable idle prompt, delivery through the existing report dialog, and the resume/reopen/navigation decision flows. Integrate with `App.tsx` and checked saves. | Refresh and reopen scenarios, idle while timing, end/leave, all-DNF and empty sessions, pending report delivery, and save failure all follow the contract. |
| **O5 · Report calculations and review UI** | Extend `reports.ts`, Training stats, and `TrainingReportsDialog` with timing breakdowns, comparison eligibility and the report chart. Reuse chart primitives via a Training adapter. | Fixed fixtures verify median, signed change, thresholds, cutoffs, missing matches, historical differences and DNF treatment. Report charts and focus work at desktop and mobile widths. |
| **O6a · Archive and deletion** | Ship Hub history rows, archive filters, read-only review and whole-session deletion. Retire the old Timer report notice once the required report delivery covers prior pending reports. | Archive edits and stale Undo are blocked. Deletion preserves unrelated history and recalculates eligible reports against retained data. |
| **O6b · Algorithms analytics** | Add Analytics → Algorithms with case stats, charts, archive links and the Hub entry. | Category filters keep OLL/PLL and Recognition/Execution separate. Solve Analytics retains its current behavior. |
| **O7 · Algorithms tracking** | Gate the existing algorithm manager, add per-session overrides and prospective tracking, and show historical revision charts beneath case stats. Use the session and report foundations from earlier phases. | On → off → on keeps case totals complete, old revision charts visible, and off-period attempts case-only. Changing a preferred algorithm or revision leaves existing sessions intact. |
| **O8 · Integrated verification** | Verify complete flows with legacy and new synthetic histories, desktop/mobile, keyboard/touch, both themes and realistic chart sizes. Update current docs and record measurements. | Focused regressions and build pass. Report and chart work stay outside the live timing path. Record exact commands, gaps and release state. |

## Decisions to record before their affected phase

These defaults can be confirmed during implementation planning. They do not
block writing this plan or starting the foundation once requested.

- **Persistence and legacy mapping (O1).** Choose compatible fields or a
  migration after auditing current data and validators. Preserve legacy
  multi-category visits and genuine historical attribution. Avoid inventing
  names, configurations, timing splits or tracking opt-ins for old records.
- **Number allocation (O2a, resolved).** Try the event or category name, then
  the lowest available suffix starting at ` (2)`. Each collection includes its
  current stored names, and a deletion frees the spelling for reuse. See
  [the allocation decision](../PROJECT_MEMORY.md#e162-o2a-session-name-allocation--2026-11-11)
  for import, sync and typed-name handling.
- **Idle and continuity (O4, resolved).** **Keep practicing** restarts the idle
  interval. Named session recovery requires a choice when closure is ambiguous.
  See [the lifecycle decisions](../PROJECT_MEMORY.md#e165-o4-lifecycle-decisions--2026-11-11)
  for activity, close-time fallback, pause accounting and report recovery.
- **Timing coverage (O5, resolved).** Show measured time and means of the
  available estimated components, each with its successful-attempt coverage.
  Compare measured means using the captured pre-session window. Match
  Execution baselines by saved attribution and leave missing splits blank.
  O7 stores new attempts with case-only attribution while tracking is off.
- **Stats and archive presentation (O5/O6a/O6b, resolved).** Use measured time
  for the attempt-order chart. Show five recent named sessions. Standalone
  history opens with all dates. Algorithms defaults to the last 90 local days
  and carries its filters into history. Recovered required reports keep the
  O4 destination rules. See [project memory](../PROJECT_MEMORY.md#e166-o5-session-report-calculations--2026-11-11).

## Verification and handoff

- Use a supported Node release (22.22.2+ in the 22.x line, 24.15+, or 26+)
  and the repository's existing dependencies. Use synthetic
  fixtures, isolated browser contexts and mock Drive for browser verification.
  Run typecheck, lint and affected Vitest tests after behavior changes.
- Start with focused tests beside `visits`, `controller`, `storage`,
  `calibration`, `stats`, and `algorithmSelection`. Use focused Chromium
  cases from `e2e/training.spec.ts`, `e2e/session-management.spec.ts`,
  `e2e/timer.spec.ts`, or `e2e/analytics.spec.ts` as appropriate with
  `--project=chromium --workers=4`. Run browser suites sequentially.
- Add owning regressions before editing destructive paths. Cover active
  deletion and Undo, archived deletion, partial or failed saves, and old
  stored bytes. Verify the normal production build after mock browser runs.
  Follow the tiered checks in [AGENTS.md](../../../AGENTS.md).
- Keep Training storage separate from solve/session records and the solve
  `SyncEnvelope`. Native backup and separate Training Drive backup/merge sync are
  implemented; solve snapshots still exclude Training. Existing Timer storage
  and sync semantics, single-tab ownership, worker isolation, and immutable
  timing remain constraints. Release and publication are separate.
- At every stop, update Current progress with the active phase, feature,
  files touched, checks run and results, unresolved decisions, and the
  smallest concrete next task. Keep durable design changes in project memory
  and dated verification in [STATUS.md](../../../STATUS.md).
