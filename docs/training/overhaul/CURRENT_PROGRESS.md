# Training overhaul current progress

> **Historical handoff (2026-11-11).** O1–O8 are complete and committed in the
> current baseline. The “working tree” statement below describes the state at
> that checkpoint, not the current checkout. Current status is in
> [CURRENT_STATUS.md](../CURRENT_STATUS.md).

**Last updated:** 2026-11-11  
**State:** O1 through O8 complete.  
**Current feature:** None; integrated verification and documentation are complete.  
**In progress:** None.

Read the [implementation plan](IMPLEMENTATION_PLAN.md), the baseline
[Training status](../CURRENT_STATUS.md), and the [project memory](../PROJECT_MEMORY.md)
before resuming. The plan contains the agreed flows, phase boundaries and
decisions to resolve in their owning phase.

| Phase | Feature | Status |
| --- | --- | --- |
| O0 | Implementation plan and handoff | Complete |
| O1 | Compatible session data, lifecycle and persistence foundation | Complete |
| O2a | Shared session naming and Timer creation | Complete |
| O2b | Training Hub shell | Complete |
| O3 | Explicit Begin, calibration and session-scoped practice | Complete |
| O4 | End, idle prompts, recovery and mandatory report delivery | Complete |
| O5 | Report calculations and review UI | Complete |
| O6a | Archive and whole-session deletion | Complete |
| O6b | Analytics → Algorithms | Complete |
| O7 | Optional per-algorithm tracking and historical substats | Complete |
| O8 | Integrated verification and documentation | Complete |

## Handoff

- **Completed.** `types.ts`, `schema.ts`, `records.ts`, `visits.ts`, `storage.ts`,
  and `controller.ts` under `src/lib/training` now support explicit named visits
  with captured cases and algorithm revisions. Checked saves preserve legacy v1
  history, protect ended named attempts, and queue the report in the same save
  that ends a nonempty session. O3 activated these named sessions in the UI.
  See the [O1 persistence decision](../PROJECT_MEMORY.md#e161-o1-persistence-decision--2026-11-11).
- **Verification.** Added `sessionFoundation.test.ts` and checked-save cases in
  `domainStorage.test.ts`. Typecheck and lint passed. Focused Vitest passed 173
  tests across 13 files. Focused Chromium passed 11 tests with four workers and
  mock Drive. The normal production build and PWA generation passed. See
  [exact commands and retries](../../../STATUS.md#training-overhaul-o1--2026-11-11).
- **O2a.** `sessionNames.ts` and Timer's `SessionSetupDialog` now share an
  allocator that suggests the event display name, including custom events, and
  the lowest available suffix. Typed names survive event changes. Blank input
  uses the suggestion. Imported and synced names participate in collision
  checks, and deleted names are available again. See the
  [allocation decision](../PROJECT_MEMORY.md#e162-o2a-session-name-allocation--2026-11-11).
- **O2a verification.** Typecheck, lint, 211 Vitest tests, four Chromium cases
  with four workers and mock Drive, and the normal production/PWA build passed.
  The first Chromium launch hit a local server access restriction. The retry
  passed. See [exact commands](../../../STATUS.md#training-overhaul-o2a--2026-11-11).
- **O2b.** `App.tsx` routes ordinary Training entry to `TrainingHub.tsx`. The
  Hub restores the saved set, per-set practice type and cases, uses the shared
  suggestion, and shows category statistics. Shared controls from
  `TrainingSetup.tsx` and the draft mode in `CaseSelectionDialog.tsx` keep case
  edits local. Apply updates the draft and Cancel or Escape discards dialog
  edits. The transitional **Open practice workspace** button preserves the
  E15 workspace with its saved selections. The Hub creates no session or setup.
- **O2b verification.** Typecheck, lint, 91 Vitest tests, 16 Chromium cases
  with four workers and mock Drive, and the normal production/PWA build passed.
  `training-hub.spec.ts` covers a fresh Hub and draft editing at 1440 px and
  320 px. Practice regressions include offline use, save recovery, deletion
  and Undo. See [exact commands](../../../STATUS.md#training-overhaul-o2b--2026-11-11).
- **O3.** `TrainingHub`, `TrainingController`, the setup runtime and
  `TrainingPage` now start named practice from **Begin practice**. The checked
  write captures the chosen name, category, cases and revisions before the
  first setup. Recognition gates Begin with its own set's calibration, and
  cancellation keeps the draft. Practice shows only the active session's
  attempts, statistics and Last Result. See the
  [O3 decisions](../PROJECT_MEMORY.md#e164-o3-explicit-begin-and-session-scoped-practice--2026-11-11).
- **O3 verification.** Typecheck, lint, 142 focused Vitest tests and all 29
  Training Chromium cases passed with four workers and mock Drive. Production
  build and offline practice passed. See [exact commands and retries](../../../STATUS.md#training-overhaul-o3--2026-11-11).
- **O4.** `App.tsx` and `TrainingPage.tsx` share anchored End/Leave
  confirmation. `useTraining` and `TrainingController` track input and expose
  the configurable idle choice. Checked lifecycle records retain elapsed
  pauses, the pending report and its destination. `TrainingReportsDialog`
  opens the exact saved report and returns after checked acknowledgement.
  Empty sessions skip reports. Ambiguous reopening requires an explicit
  choice. Ordinary browser events supply no reliable closure confirmation.
  See the [O4 decisions](../PROJECT_MEMORY.md#e165-o4-lifecycle-decisions--2026-11-11).
- **O4 verification.** Typecheck, lint, 155 focused Vitest tests and all 31
  Training Chromium cases passed with four workers and mock Drive. A final
  focused rerun covered Analytics recovery and the related end/idle/report
  flows. See [exact commands](../../../STATUS.md#training-overhaul-o4--2026-11-11).
- **O5.** `reports.ts` derives measured summaries, signed historical change
  and available Recognition components with coverage. Required and historical
  reports use `TrainingSessionReport` and the existing keyboard chart. The
  phase passed 32 Vitest tests, three Chromium cases and a production build.
- **O6a.** The Hub lists five recent named sessions. The archive filters by
  set, practice type and date, with read-only review. A typed DELETE uses an
  exact checked projection of the selected session and attempts. The phase
  passed 65 Vitest tests, eight Chromium cases and a production build.
- **O6b.** Algorithms uses Training data for category-specific case results,
  progression, volume and DNF rate. It passes filters into the archive and
  starts a draft in the Hub. Solve Analytics retains its own filters. The
  phase passed 68 Vitest tests and seven Chromium cases. Final verification
  passed 139 Vitest tests, 14 Chromium cases and a normal production build.
  See [exact commands](../../../STATUS.md#training-overhaul-o5-o6a-and-o6b--2026-11-11).
- **O7.** Tracking is off by default. `TrainingController` captures the
  setting at timing start and saves off-period attempts as case-only.
  `CaseSelectionDialog` gates the algorithm manager and supports a verified
  per-session override. `AlgorithmsAnalytics` expands case rows into exact
  revision statistics and charts from saved attribution. The checked store
  preserves legacy data and the original tracking flag on Undo. See the
  [O7 decisions](../PROJECT_MEMORY.md#e169-o7-tracking-decisions--2026-11-11).
- **O7 verification.** Typecheck, lint, 141 Vitest tests and production build
  passed. The Training Chromium run passed 33 of 36 cases. Three locator
  failures passed on focused reruns. The final tracking case covered on → off
  → on, case totals and revision charts at 320 px. See
  [exact commands](../../../STATUS.md#training-overhaul-o7--2026-11-11).
- **O8.** `e2e/training-integrated.spec.ts` verifies a synthetic legacy and
  named history through capture, End, the required report, reload, read-only
  archive review, typed deletion and Algorithms recalculation. A second case
  covers 285 seeded attempts across 75 days at 1440, 1024, 390 and 320 px in
  light and dark, keyboard chart inspection, test-dispatched touch selection,
  axe serious/critical checks and unchanged saved `rawMs`/`createdAt`. The audit
  exposed an incomplete revision-toggle name in `AlgorithmsAnalytics.tsx`; it
  now includes the visible revision count. See
  [exact commands and measurements](../../../STATUS.md#training-overhaul-o8--2026-11-11).
- **O8 verification.** Typecheck and lint passed (seven existing warnings). The
  integrated spec passed 2/2 and four focused existing Training cases passed 4/4
  in Chromium with mock Drive. The normal production/PWA build passed with the
  existing chunk-size warning. Seeded history was 285 attempts (337,771 bytes);
  archive review open sampled 27.2, 35.8 and 44.3 ms, and Algorithms open with
  charts measured 347.6 ms. These are single-run synthetic observations, not
  thresholds.
- **Next action.** No overhaul phase remains. Owner review and any release,
  publication, live Drive, Firefox/WebKit, physical-device or larger-history
  profiling work need separate authorization. See
  [remaining limits](../../../KNOWN_LIMITATIONS.md#training).
- **Remaining decisions.** No O8 decision remains. Legal/provenance,
  backup/export integration and release work remain outside the overhaul. See
  the [decision register](IMPLEMENTATION_PLAN.md#decisions-to-record-before-their-affected-phase).
- **Working tree at this checkpoint.** The checkout contained existing unrelated
  changes; no commit or push was made then. The implementation is committed in
  the current baseline.

When handing off, replace the current-feature line and update the phase table.
Record the files and behavior changed, exact verification and failures,
remaining decisions, and the next specific task. Keep longer technical
decisions in project memory and avoid duplicating verification logs here.
