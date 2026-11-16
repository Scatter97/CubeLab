# CubeLab Training — Current Status

**Last updated:** 2026-11-11
**Phase:** Phases 0–3B, the explicitly expanded **Phase 4A/4B/4C**, and the
owner-authorized **built-in default OLL/PLL catalog** are complete. The
owner-approved Training UI redesign is implemented in E15. Overhaul O1 adds
the checked session foundation, O2a adds shared naming, O2b adds the Hub,
O3 activates named practice, O4 adds session end, idle and recovery, and
O5–O6b add reports, the archive, and Algorithms analytics. O7 adds optional
prospective tracking by algorithm revision. O8 completes integrated synthetic
verification and documentation.

[PROJECT_MEMORY.md](./PROJECT_MEMORY.md) is authoritative.
[E15](./PROJECT_MEMORY.md#e15-approved-training-workspace-redesign--2026-11-11)
describes the current workspace, display preference and save recovery.
[E13](./PROJECT_MEMORY.md#e13-built-in-default-ollpll-catalog--2026-11-10) controls
the default catalog, preference resolution and provenance limitation. [E12](./PROJECT_MEMORY.md#e12-expanded-phase-4--complete-training-ui-and-shared-timer--2026-11-10)
retains the Phase 4 architecture; E11 retains the pure-domain rules. Earlier
statements that practice requires user-provided algorithms or that F12 blocks all
default content are superseded.

## Implemented Phase 4 and built-in defaults

- **Overhaul Hub:** Training opens a draft with the saved algorithm set,
  practice type and case selection. The Hub shows category statistics and uses
  the shared name suggestion. Applying case edits changes the local draft.
  **Begin practice** resolves the name, checks usable cases, and captures one
  revision per case before starting the timer workspace.
- **O3 practice:** the checked session write precedes setup generation. The
  clock, Last Result, attempts and statistics use the active session ID.
  Execution retry stays in that session. Recognition calibration gates Begin
  for the selected set and saves its seven-sample median with the new session.
  Cancelling returns to the Hub draft. Reaching a renewal limit during practice
  leaves that session usable. The next Begin checks the limit again.
- **Reports and archive:** reports show measured time, signed comparisons,
  estimated Recognition components with coverage, and an inspectable attempt
  chart. The Hub shows five recent sessions. Practice history supports filters,
  read-only review and typed deletion of acknowledged named sessions.
- **Algorithms:** Analytics separates ordinary solves from Training. Execution
  and Recognition have OLL/PLL filters, progression, volume, DNF rate, case
  performance and filtered practice history.
- **Revision tracking:** off by default in Training Settings. Opt in to
  manage preferred algorithms and choose verified overrides in the session
  draft. New attempts always count toward their case. The tracking choice
  at timing start determines whether the attempt also contributes to a
  revision. Historical attribution and revision charts stay available when
  tracking is off.
- **4A:** checked `TrainingController`/`useTraining` mounted only inside existing
  active-tab ownership/startup gates. Guarded exact-raw saves, retained unsaved
  candidates, conflict feedback, retry and manual recovery-copy download.
  Corrupt/unsupported bytes cannot produce writable defaults. Unsaved warnings
  survive navigation and request an exit prompt until retry succeeds.
- **Shared timer:** one existing App `useTimer` instance; optional start-time
  gate captures immutable setup/preferred/calibration/visit and one attempt ID.
  Training completion consumes it once and writes only Training. Keyboard/touch,
  monotonic time, hold/repeat/input guards and readout are shared. No inspection,
  +2, WCA warnings or inferred cube completion. OLL stops after orientation even
  with PLL remaining; PLL permits AUF. Normal scramble generation pauses off Timer.
- **4B:** Training is the third header destination. Existing workspace/sidebar,
  themes and all 78 approved static diagrams are reused. Independent OLL/PLL
  selections/toggles, search/families, select all/clear, difficult practice and
  custom preset CRUD persist without dividing cumulative statistics.
- **Built-in defaults (E13):** all **57 OLL** and **21 PLL** standard cases now
  resolve to read-only, verified defaults. OLL uses the owner-approved Heroor
  `oll[].f` records with the E9 OLL 45 (`F R U R' U' F'`) and OLL 56
  (`r U r' (U R U' R')2 r U' r'`) corrections. PLL uses only the first-listed
  Tao Yu algorithm per case; the 37 additional variants remain excluded.
- **Catalog/preferences:** `catalog/defaultAlgorithms.ts` owns stable
  `<caseId>:alg:default-v1` version-1 records with provenance, corrections/frame
  metadata, default/generator links and no `alternativeAlgorithmIds`.
  `algorithmSelection.ts` resolves a stored preference first, then the built-in
  default, then the latest verified custom algorithm. Built-ins are never copied
  into `customAlgorithms` or duplicated on startup. A new custom algorithm can
  replace a built-in as a new revision with `replacesAlgorithmId`. Existing
  custom algorithms, preferences, attempts, calibrations, visits and historical
  attribution remain intact. Training storage stays schema **v1** at
  `cubelab:training:v1`; no migration is required.
- **Provenance limitation:** the owner removed CubeLab's internal F12 restriction,
  but third-party redistribution permission is not established. Heroor has a
  README-only MIT claim and no `LICENSE` file; Tao's MIT software licence credits
  AlgDb for other algorithms. E13 uses an independently assembled catalog of only
  the 78 owner-approved functional sequences, not a copied compilation, and
  asserts no third-party redistribution licence. Legal review/permission remains
  advisable; this is not a grant of rights.
- **Case visibility:** the execution preview shows the name and diagram by
  default and can be disabled for OLL and PLL in Training Settings.
  In recognition, only setup and precursor render before completion. No upcoming case name/image/algorithm/target metadata, including
  failed-target errors. Last Result reveals the previous attempt. A known-case
  retry names the destination when switching to execution and generates that
  case directly.
- **Shared sidebar:** Training Setup uses compact panel controls, Statistics uses
  Timer's measured rows, and Attempts uses Solves' list and windowing above 200
  entries. The Statistics/Attempts divider shares Timer's pointer, touch and
  keyboard behavior and stores a separate Training proportion. Panels stack on
  narrow layouts. The options menu keeps Statistics controls in the heading.
  The split reserves the grip separately from the history floor. Last Result
  floats bottom-right when there is room and docks below the clock at narrow
  effective widths, including increased interface zoom. A cancelled gesture
  leaves the saved desktop geometry intact.
- **Setup and review:** the clock has a stable setup track through mode, loading
  and preview changes. One toolbar action starts, advances, retries or resumes
  practice. Calibration reviews samples in the timer area. Failed corrections
  keep the saved result visible and put recovery controls inside the dialog.
- **Legacy 4C calibration (superseded for named sessions by O3):** opening Training never starts it. Explicit recognition
  selection and next-start gates enforce independent fixed-protocol calibrations.
  Seven accepted positive repetitions, sample review/retry/cancel, progress and
  median; only completed drafts commit. Default seven-day/100-completion renewal
  recommends; optional forced renewal gates the next start, never an active timer.
- **Statistics/results:** Four independent categories with configurable row
  order, visibility and Current/Best columns. Recognition offers Raw and
  Estimated views of the stored series. Single/mo3/ao5/ao12 are the defaults.
  Additional averages, success/DNF rates, case counts, difficult-case mean and
  historical improvement are optional. Detailed Statistics has searchable,
  sortable By Case and By Algorithm tabs. Clicking an Attempts row or
  pressing Enter on it opens Timer’s shared action menu for result correction,
  clipboard actions, full details with attribution, and deletion with Undo.
  The compact Attempt details dialog groups the case, result, setup and
  algorithm. Undo restores the exact saved attempt and its visit membership.
  Training keeps its timing, calibration, visit and high-water rules.
- **Legacy visits/reports:** explicit category selection starts/resumes; changing cases,
  algorithms or settings continues; category/navigation changes and inactivity
  end visits. Running timing defers endings. Reports recalculate corrections and
  deletions using captured baseline policies and current attempt references.
  Pending reports remain available in Training history.

## Browser recovery and remaining limits

- Named practice confirms End and departure to Timer or Analytics. The idle
  prompt waits for a decision after 15 minutes by default and defers during
  timing. A nonempty checked end opens the exact report, including all-DNF
  sessions. Done or Escape acknowledges it before going to the Hub or queued
  destination. A failed write retains the prior saved view.
- Reload and ambiguous reopening show Resume or Continue and End. Pending
  reports reopen with their saved destination. The confirmed-closure path
  uses reliable evidence supplied by a caller. Ordinary browser lifecycle
  events are ambiguous and use the explicit choice.
- For legacy visits, reload navigation is a positive continuity signal. Other openings with an
  active visit, including ambiguous restored tabs, require an explicit Resume/End
  choice before Training writes. End uses last known activity when there is no
  reliable close time. Pagehide/unload alone does not prove closure.
- A partial calibration draft is not persisted across reload; prior completed
  calibrations remain. Failed write candidates stay in memory; browsers can
  suppress exit prompts and forced termination can still lose unsaved changes.
  Recovery-copy download is manual preservation, not an import/merge feature.
- Training stays schema **v1**, key **`cubelab:training:v1`**. Ordinary sessions
  v6/settings v11/native backup v1/Drive formats, the ordinary solve/session
  resets and Training's local-only backup status are unchanged. The newer
  **Reset All Site Data** action clears local Training with the rest of
  CubeLab's browser-owned data; it still does not include Training in native
  backups, Drive, or replacement formats. Future Training backup/import
  integration, retention, size and large-history profiling require separate
  work.
- All **78 SVGs remain byte-identical**. The generator, mathematics and catalog
  remain as approved. Aggregate SHA-256 of the 78 files
  is `f8674bbb3337ec07ce7c2ee09440314762c052d59c706a5cb460367967433825`.
- The new defaults are application assets, not user records. The 37 additional
  PLL variants remain excluded. Third-party redistribution permission remains
  unestablished; legal review is still advisable.
- Verified scope includes Chromium keyboard/synthetic touch, real light/dark,
  desktop/mobile screenshots, axe, persistence/lifecycle, the 286-attempt
  integrated report/Algorithms case and production offline use. Firefox/WebKit,
  physical hardware, assistive technology, live Drive and the 7,000–10,000-solve
  profiling matrix were not exercised. Deliberately moved desktop panels can
  cover digits; defaults and mobile docking were checked.

Exact verification is recorded in
[STATUS.md](../../STATUS.md#approved-training-workspace-redesign--2026-11-11),
with separate checks for the [attempt menu](../../STATUS.md#training-attempt-action-menu--2026-11-11)
and [compact details and Undo](../../STATUS.md#compact-attempt-details-and-undo--2026-11-11).

## Immediate next task

Overhaul O1 through O8 are complete; no overhaul phase remains. Integrated
synthetic verification covers legacy and named sessions, the required report,
archive deletion, Algorithms recalculation, realistic chart sizes, both themes,
keyboard and synthetic touch. Owner review and any release, publication, live
Drive, Firefox/WebKit, physical-device or larger-history profiling work require
separate authorization. See the
[implementation plan](overhaul/IMPLEMENTATION_PLAN.md) and
[overhaul progress](overhaul/CURRENT_PROGRESS.md). Legal/provenance, backup
integration and release work remain outside the overhaul.
