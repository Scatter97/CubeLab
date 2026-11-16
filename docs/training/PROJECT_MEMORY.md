# CubeLab Training — Persistent Project Memory

**Status:** Active source of truth for the CubeLab Training feature
**Last updated:** 2026-11-11
**Current phase:** Phases 0–3B, the explicitly expanded **Phase 4A/4B/4C**, and
the owner-authorized **built-in default OLL/PLL catalog** are implemented. The
approved Training UI redesign is implemented in E15. Overhaul O1 adds the
compatible named-session persistence foundation in E16.1. O2a and O2b add
shared naming and the Training Hub in E16.2–E16.3. O3 activates named practice
in E16.4. O4 completes the lifecycle and report delivery in E16.5. O8 completes
integrated synthetic verification in E16.10.
Phase 4 includes the requested full UI, shared timer, calibration, category
statistics, visit recovery and reports. **E12 controls the Phase 4 application
behavior, E13 controls the default-algorithm catalog/preference behavior and
E15 controls the current Training UI**,
superseding earlier statements that Training is unmounted, that practice requires
user-provided algorithms, or that this scope must wait for historical Phases 5–7.
The 78 approved SVGs and earlier domain mathematics are unchanged. The owner
removed the internal F12 bundling restriction on 2026-11-10; all 78 approved
defaults are bundled using an independently assembled functional-sequence
catalog. Third-party redistribution permission remains unestablished and is
documented in E13/F12. Training remains local-only and excluded from ordinary
backup/Drive.
**Immediate next task:** No overhaul phase remains. O1 through O8 are complete.
See [overhaul progress](overhaul/CURRENT_PROGRESS.md) for the handoff. Owner
review and any release, publication, live Drive, Firefox/WebKit, physical-device
or larger-history profiling work need separate authorization. The legal,
persistence/export and release prerequisites remain open.
Preserve unrelated onboarding work.
**Working entry point:** [CURRENT_STATUS.md](./CURRENT_STATUS.md) — read it first;
this file is the authoritative full specification.

Earlier E6/E7 completion checkpoints are retained as history. E8 is the
independent repair audit; E9 is the final online verification and controls the
current OLL 56 decision and Phase 2C status. Where they conflict, E9 wins.

This file is the persistent memory for future OpenCode sessions working on
CubeLab Training. Read `CURRENT_STATUS.md` first, then consult this file for the
current task and read it completely for a major phase or architectural decision.
It records the confirmed product requirements, the Phase 0 repository audit and
feasibility investigation, the completed Pre-Phase 1 recognition-setup
verification, the proposed architecture, unresolved decisions, the phased
implementation plan, and the current repository state.

Do not treat Phase 0 proposals or recommendations as owner-approved decisions.
The decision labels in this document are intentional:

- **CONFIRMED** — agreed product requirement or owner correction.
- **VALIDATED** — investigated against the repository or mathematically/probed.
- **PROPOSED** — Phase 0 recommendation; not yet approved.
- **UNRESOLVED** — still needs an owner or technical decision.
- **NOT VERIFIED** — not yet tested in practice.

---

## A. Project overview

CubeLab Training is an algorithm-training feature for CubeLab. It should
feel like a natural extension of the existing Timer page, not a separate
application. It combines csTimer-style algorithm practice with recognition
training, case presets, per-algorithm performance tracking, calibration, and
automatic practice reports.

V1 supports two algorithm sets:

- **OLL** — 57 standard cases.
- **PLL** — 21 standard cases.

The architecture must be modular and extensible so future sessions can add:

- VLS
- ZBLS
- ZBLL
- COLL
- CMLL
- F2L
- Other advanced training methods

Those future sets are extensibility targets only. They are not V1 deliverables.

Training must not be implemented as ordinary puzzle events. OLL and PLL must
not be added to `PuzzleEvent`, must not create solve/session records, and must
not contaminate ordinary cube solves or WCA-style statistics.

Training operates as one continuous workspace with:

- global attempt history;
- selectable algorithm sets;
- case presets and individual case selection;
- automatically recorded practice visits;
- no manually managed Training Sessions.

---

## B. Confirmed product decisions

The following are agreed requirements. They must not be silently changed.

### B1. Navigation and relationship to Timer

- Training is a dedicated **third main page** alongside **Timer** and
  **Analytics**.
- Training reuses the existing Timer interface and timing functionality wherever
  appropriate.
- Training should preserve the existing overall layout philosophy, central
  timer, scramble display, timer interaction behavior, visual design, and
  floating-window architecture.
- The left sidebar is redesigned specifically for Training.
- Training must not look or behave like a separate application.

### B2. No Training Sessions

- Do **not** create manually managed Training Sessions.
- Training is one continuous workspace with global attempt history.
- There must be no Training Sessions panel.
- Practice visits are automatic; they are not user-managed sessions.

### B3. Algorithm sets and mode selection

- V1 exposes OLL and PLL selection.
- V1 uses one simple **Include setup moves** toggle.
- Do not create four separate user-facing mode selectors.
- The Include setup moves preference is remembered separately for OLL and PLL.

### B4. Setup moves OFF — execution-only training

This is csTimer-style algorithm execution training.

1. User selects an algorithm set and desired cases.
2. CubeLab generates a valid setup for the selected case.
3. User scrambles the physical cube and can inspect the resulting case.
4. User starts the timer.
5. User executes the algorithm and stops the timer.
6. CubeLab records the execution time and reveals the previous case in the
   result panel.

No calibration is needed for execution-only training.

### B5. Setup moves ON — recognition + execution training

This trains the transition into OLL or PLL.

1. CubeLab selects a case from the user's selected cases.
2. CubeLab generates a setup with the required precursor sequence.
3. The target case identifier and diagram remain hidden.
4. The user starts the timer.
5. The user executes the specified precursor.
6. The user recognizes the resulting case and executes their algorithm.
7. CubeLab records total elapsed time and calculates an estimated adjusted
   recognition + execution time.

### B5a. Confirmed attempt-completion and timing requirement (2026-11-09)

- **OLL training ends when the user finishes OLL, even when PLL remains
  unsolved.** This applies to both OLL execution-only and OLL
  recognition + execution modes.
- The timer is stopped manually by the user.
- **PLL training ends after PLL completion, allowing for AUF.**
- OLL recognition timing includes the fixed FR insertion `U R U' R'` before
  recognition/execution; PLL recognition timing includes fixed Sune
  `R U R' U R U2 R'`. OLL stops after orientation, not PLL. No automatic
  cube-solved detection is introduced. Phase 3A records these semantics only;
  it does not implement timer UI. E11 now confirms no inspection or +2 in Training.
- Do not implement timer behavior as part of Phase 2C. Record this requirement
  for the later Training timer/domain phases.

### B6. OLL recognition generator requirements

- Three F2L slots are solved.
- The final F2L pair is in the intended final-insertion configuration.
- The required insertion is exactly:

  `U R U' R'`

- The insertion and final F2L slot are fixed for V1. Do not randomize them.
- Executing that insertion must produce the selected OLL case with F2L
  completely solved.
- Clearly display the mandatory insertion.
- Inform the user that alternative insertions, such as a sledgehammer, should
  not be substituted because they may produce a different OLL case.
- The selected target case must remain hidden until the attempt is completed.
- Every generated scramble and resulting cube state must be mathematically
  verified.
- Investigate and document any constraints or limitations rather than silently
  producing an incorrect setup.
- All **57** standard OLL cases must support both execution and recognition
  training. See the corrections in Section E.

### B7. PLL recognition generator requirements

- Generate a setup that requires the user to complete a standardized precursor
  before recognizing and executing the resulting PLL.
- The precursor must be clearly displayed.
- Generate valid cube states.
- Verify that executing the precursor produces the selected PLL case.
- Avoid exposing the target case identifier before the attempt.
- Minimize opportunities to recognize the PLL before completing the precursor.
- Evaluate whether the fixed-precursor approach provides meaningful PLL
  recognition practice.
- The confirmed V1 PLL precursor is Sune:

  `R U R' U R U2 R'`

- The precursor is fixed and explicitly prescribed. It must not depend on the
  user's preferred OLL or PLL algorithm.
- All **21** PLL cases must support both execution and recognition training.

### B8. Case selection, presets, and difficult cases

- Users can select individual cases and groups of cases.
- Built-in presets are based on recognized OLL and PLL case families.
- Users can create, rename, edit, delete, and select custom presets.
- Presets store case selections and relevant training configuration.
- Presets are **not** statistical sessions.
- Changing presets must never reset or divide cumulative statistics.
- The selected-case count is visible in Training Setup.
- Users can mark cases as difficult so they can quickly train weaker cases.
- A difficult-cases filter/preset should be available.
- The case preset used must not determine which statistical history owns an
  attempt.

### B9. Statistics separation — fundamental requirement

Training has four independent statistical categories:

1. **OLL Execution**
2. **OLL Recognition + Execution**
3. **PLL Execution**
4. **PLL Recognition + Execution**

Even though the user interacts only with an algorithm-set selector and the
Include setup moves toggle, the underlying records must preserve these four
categories.

Execution times and recognition + execution times must never be mixed. This
applies to:

- overall means and best times;
- ao5, ao12, and other averages;
- attempt counts;
- per-case statistics;
- per-algorithm statistics;
- PB tracking;
- trends and performance graphs;
- automatic practice reports;
- historical comparisons;
- future Analytics integration.

Attempts permanently retain their category even when the user changes training
settings. The case preset used must not determine the category.

### B10. Per-algorithm performance tracking

- Every case can support multiple algorithms.
- Users can choose a preferred algorithm and view alternatives in a dedicated
  case-details interface.
- V1 tracks at least:
  - attempt count;
  - best time;
  - mean time;
  - recent attempts.
- Performance is tracked independently for individual algorithms and training
  categories.
- For example, OLL case execution using Algorithm A is statistically separate
  from OLL recognition using Algorithm A.
- Without Bluetooth smart-cube data, CubeLab cannot directly determine which
  algorithm was executed.
- By default, an attempt is attributed to the currently preferred algorithm as
  an **assumption**, not a verified observation.
- Users can correct the attribution after an attempt or mark it as Unknown.
- Unknown-attribution attempts contribute to case-level statistics but not to
  specific algorithm-performance comparisons.
- Changing preferred algorithms must never rewrite historical attribution.

### B11. Algorithm database requirements

- Use CubeSkills' OLL and PLL algorithm lists as the intended reference.
- Verify appropriate reuse permissions before copying or bundling curated
  content. Do not assume the entire CubeSkills database can be redistributed.
- The project owner retains final control over the algorithm catalog and may
  review or replace individual algorithms.
- The database must support:
  - stable algorithm-set identifiers;
  - stable case identifiers;
  - one default algorithm per case;
  - optional alternative algorithms;
  - user-selected preferred algorithms;
  - user-defined custom algorithms;
  - algorithm notation validation;
  - algorithm correctness verification;
  - AUF and cube-orientation conventions;
  - future expansion to other algorithm sets.
- Do not invent missing algorithms or silently replace owner-approved algorithms.
- Separate the official bundled algorithm catalog from user preferences and
  custom algorithms.

### B12. Static case diagrams

- V1 requires 78 accurate 2D case diagrams:
  - 57 OLL;
  - 21 PLL.
- Generate the SVG assets during development, validate them, and store them in
  the repository.
- Do **not** dynamically generate these SVG diagrams in the browser at runtime.
- At runtime, load the already-generated asset using the stable case identifier.
- OLL diagrams must clearly communicate sticker orientation.
- PLL diagrams must communicate piece permutation through appropriate colors,
  arrows, or conventional case illustrations.
- **CONFIRMED visual convention (2026-11-08 owner review):** use the traditional
  compact 3×3 last-layer diagram, not the original 5×5 cross layout. OLL shows a
  nine-cell top face plus thin yellow bars only for sideways-facing U stickers.
  PLL shows a yellow 3×3 top face, thin side bars in the actual permuted side
  colours (front green, right red, back blue, left orange), and black
  permutation arrows. The internal design references are
  `references/cubeskills-oll-style.png` and
  `references/cubeskills-pll-style.png`; they are not application assets and
  must not be copied, embedded or redistributed.
- The same static SVG should be reusable in:
  - case selection;
  - algorithm details;
  - post-attempt result panel;
  - future training reports.
- Cube-state simulation remains necessary for generating and verifying
  scrambles.

### B13. Training page interface

E15 specifies the current shared sidebar, category customization and full history.

The Training page should look and behave similarly to the existing Timer page.
Keep:

- overall layout philosophy;
- central timer;
- scramble display;
- timer interaction behavior;
- general visual design;
- floating-window architecture.

Redesign the left sidebar for Training:

**Training Setup**

- OLL / PLL selection
- Case preset selector
- Edit Cases control
- Selected-case count
- Include setup moves toggle
- Calibration status when applicable

**Statistics**

- Cumulative statistics for the selected training category
- Statistics remain independent of presets
- Raw and estimated adjusted measurements are distinguished

**Attempt History**

- Recent attempts for the selected training category
- Case identifiers, times, and relevant actions
- No manually managed Training Sessions panel

### B14. Tools and result-panel placement

E14 supersedes the two-panel arrangement for Training. Last Result remains
bottom-right and uses the existing floating frame. This section records the
original Phase 4 placement decision.

The existing floating Tools panel and the new floating Last Result panel must
coexist.

Preferred default desktop arrangement:

- **Bottom-left:** existing Tools panel
- **Bottom-right:** Last Result panel

Both panels should support, where appropriate:

- dragging;
- resizing;
- minimizing;
- closing;
- position persistence.

Prevent accidental overlap where practical. Neither panel may move or resize the
central timer. The timer must remain centered relative to the full timer
workspace regardless of floating-panel state. The panels must not interfere with
keyboard controls, inspection, timer arming, or active timing. Responsive
behavior for narrow screens must be planned.

### B15. Last Result panel

After every valid completed attempt, automatically display a compact floating
result panel in the bottom-right corner. It must not be a full-screen modal.

Show:

- previous case identifier;
- pre-generated 2D case diagram;
- preferred algorithm or attributed algorithm;
- actual raw time;
- estimated adjusted time when applicable;
- **Retry This Case**;
- **Mark Hard**;
- **View Case Details / Other Algorithms**.

Keep alternative algorithms and advanced statistics out of the compact panel.
Provide those details in a dedicated case-details interface.

Panel lifecycle:

- Appears after an attempt finishes.
- Remains available while the user prepares the next physical scramble.
- Continues showing the previous case, never the upcoming hidden recognition
  case.
- Automatically minimizes when the next timed attempt starts.
- Automatically restores with the new result when the next attempt ends.
- Does not require the user to dismiss it before continuing.

### B16. Automatic practice visits and reports

**CONFIRMED owner revision, 2026-11-09 (E11):** this supersedes the former
mode/set-spanning visit policy. Legacy multi-category v1 visits remain readable.

- Visits are automatic Training records, never ordinary CubeLab sessions.
- Opening the page alone does not create a visit or calibration. Selecting a
  category starts a visit; changing cases/algorithms in it continues the visit.
- Switching OLL/PLL or execution/recognition closes the previous visit and starts
  a new visit for the selected category. Navigation to Timer/Analytics ends it.
- Refresh resumes an active visit before inactivity is due. Default inactivity
  is 15 minutes, configurable; running attempts defer lifecycle transitions.
- Tab closure ends the visit logically; a later startup can finalize it from an
  explicit confirmed-closure signal and show the pending report. Persisted
  timestamps alone do not distinguish refresh from closure. E11 specifies the
  required future application signal; no browser behavior is wired in Phase 3B.
- Reports are non-blocking and recalculated from current referenced attempts,
  including explicit corrections/deletions. Stable visit identity, attempt
  references and the captured baseline policy persist; aggregate reports do not.
- Report cutoff excludes later attempts. Zero supported attempts do not enqueue
  reports. Empty, missing-policy and insufficient-history states are explicit.
- Categories stay independent. Improvements match cases (and algorithm
  ID/revision when scoped), with equal matched-case weighting and explicit
  unmatched coverage. No fabricated unrelated-case baseline or fallback.

### B17. Calibration requirements

**CONFIRMED F6/F8/F11 decisions, 2026-11-09 (E11):**

- Calibration starts only on explicit recognition selection or a due next-attempt
  gate, never by opening Training. Execution needs no calibration. Initial
  recognition needs a usable calibration for its own set; cancellation returns
  to mode selection. Recognition requires two distinct selected enabled cases;
  execution requires one. No automatic additional case selection.
- From solved, apply the fixed inverse scramble without timing it; time only the
  prescribed precursor, stopping at solved. OLL scramble `R U R' U'`, precursor
  `U R U' R'`; PLL scramble `R U2 R' U' R U' R'`, precursor
  `R U R' U R U2 R'`. No random AUF, seven-case protocol or outlier rejection.
- Exactly seven successful finite positive repetitions; discard/retry invalid
  ones. Use the fourth numerically sorted value. Calibration repetitions never
  become attempts. Preserve prior calibrations until completion and append the
  replacement with `fixed-inverse-precursor:v1` protocol metadata.
- Separate OLL/PLL timestamps/counts/snapshots. Default renewal is at or beyond
  seven elapsed days or 100 completed recognition attempts, whichever first.
  Thresholds are configurable per set and captured in each calibration; later
  setting changes affect subsequent calibrations. Recognition DNFs count;
  execution/calibration repetitions do not. Durable high-water totals survive
  deletion. Shared **Require recalibration when due** defaults OFF: recommend
  while allowing prior calibration; ON blocks the next recognition attempt
  until seven new valid samples. Cancellation retains the prior calibration and
  does not bypass forced renewal. Never interrupt an already-running attempt.
- Raw milliseconds stay intact. Estimate = raw minus captured calibration
  median, never a direct recognition measurement. Below median yields null with
  a reason; equal yields a valid zero estimate. DNFs have no successful estimate.
  Missing/invalid/untagged calibration cannot authorize new recognition. Legacy
  calibration history remains readable; unknown protocol fidelity is not assumed.
- Historical null estimates are never backfilled, and newer calibrations never
  recalculate historical estimates. Explicit result correction can remove an
  estimate; correcting a DNF to success leaves it `not-recorded`.
- No inspection, including optional inspection, and no +2. Successful completion
  or DNF only. Raw DNF durations remain stored; future manual DNF marking is
  necessary because no smart-cube state detection exists. OLL completion means
  orientation solved even if PLL remains; PLL completion allows AUF; recognition
  also requires the prescribed precursor. Timing is stopped manually.

### B18. Persistence, backups, and synchronization

The following data must survive reloads:

- training preferences;
- case presets;
- preferred algorithms;
- custom algorithms;
- difficult-case markers;
- training attempts;
- calibration records;
- automatic practice visits;
- performance reports.

Preserve compatibility with current settings, existing sessions, solve records,
and custom puzzle events. Design safe schema migrations. Consider:

- local storage;
- backup and restore;
- cloud synchronization;
- cross-tab synchronization;
- conflict handling;
- existing reset behavior;
- data recovery.

Training records must never accidentally contaminate ordinary cube solves or
WCA-style statistics.

### B19. Performance and testing requirements

- Keep the feature maintainable, responsive, and efficient.
- Avoid unnecessary timer re-renders.
- Do not duplicate working timer or cube-state functionality without
  justification.
- Use static SVG assets at runtime.
- Plan tests for:
  - all 78 case definitions;
  - algorithm correctness;
  - cube-state transformations;
  - generated scramble validity;
  - OLL fixed insertion correctness;
  - PLL precursor correctness;
  - case selection and presets;
  - statistical separation;
  - per-algorithm attribution;
  - calibration calculations;
  - recalibration thresholds;
  - automatic practice visit lifecycle;
  - performance report comparisons;
  - data persistence and synchronization;
  - floating panel interactions;
  - timer accuracy and keyboard behavior;
  - responsive layouts.
- Tests must detect incorrect case generation, not merely check that a scramble
  string was returned.
- Include regression coverage for the existing Timer page.

### B20. Existing application safety

- Existing CubeLab data, backup/recovery behavior, and functionality must not be
  broken.
- Preserve user history.
- Do not add dependencies without approval.
- Do not commit, push, deploy, or publish without explicit authorization.
- Do not implement OLL or PLL as ordinary puzzle events.
- Do not create training sessions.

---

## C. Finalized recognition precursors

### C1. OLL Recognition — fixed insertion

**CONFIRMED sequence:**

```text
U R U' R'
```

The owner’s reference groups it as:

```text
U (R U' R')
```

These are the same prescribed moves. Do not change the sequence.

The starting state should represent the intended final F2L insertion case, with
three F2L slots solved. The final F2L slot is fixed for V1. Do not randomize the
required insertion or the final F2L slot.

**Owner reference image:** `docs/training/references/f2l-oll-recognition-reference.png`

This is the owner’s reference for the intended final F2L insertion configuration.
It illustrates the case using `U (R U' R')`. It is a valid 586×166 PNG RGBA
image. Treat it as an internal development asset; do not publish or redistribute
it without confirming appropriate rights.

The generated pre-insertion cube state must be compared against this saved
reference during Pre-Phase 1 Recognition Setup Validation.

**Status: VALIDATED 2026-11-08.** The inverse-generated pre-state is a split FR
pair: the DFR corner is at UFR with orientation 2 and the FR edge is at UR with
orientation 0. All other F2L pieces are home; three F2L slots are solved. This
matches the saved reference image's colored F2L cells exactly under a consistent
face/colour mapping. Applying exactly `U R U' R'` returns the selected OLL state
with F2L solved. See Section E4 for evidence, the corrected edge position (UR,
not the Phase 0 UB claim), and the image's nonstandard face-colour labelling.

The prescribed moves remain unchanged. Do not change them based on the image's
colour labels or the earlier UB description.

### C2. PLL Recognition — fixed Sune precursor

**CONFIRMED V1 sequence:**

```text
R U R' U R U2 R'
```

This is Sune. It is the confirmed fixed V1 PLL precursor.

It must be explicitly prescribed and displayed. It must not depend on the user’s
preferred OLL or PLL algorithm.

The target PLL case identifier and diagram remain hidden before the attempt.
The precursor must be completed exactly as displayed. Minimize opportunities to
recognize the PLL before completing the precursor.

**Status: VALIDATED 2026-11-08.** All 288 possible PLL permutation states were
tested with `P = L · Q⁻¹`; `Q(P) = L` exactly, F2L stays solved, and the pre-state
is the Sune OLL orientation case rather than an exposed PLL. All 21 named
representative algorithms also passed. Exact catalog name/licensing mapping
remains a Phase 2 task. See Section E4.

### C3. Precursor invariants

- Both precursors are fixed, explicitly prescribed sequences.
- Neither precursor depends on a user’s preferred algorithm.
- Calibration measures the prescribed precursor, not the user’s solve algorithm.
- The same precursor is used for all cases in its set for V1.
- Do not substitute an alternative insertion or precursor because it is easier
  or produces the same case under a different AUF.
- The OLL precursor’s final F2L slot is fixed.
- The PLL precursor is Sune for V1.
- Any future change to a prescribed precursor is a product decision requiring
  explicit owner approval and a memory update.

---

## D. Phase 0 technical findings

This section preserves the important repository audit and feasibility work.
Architecture proposals here are **PROPOSED** unless marked otherwise.

### D1. Repository architecture and integration points

| Area | Current implementation | Training implication |
| --- | --- | --- |
| Entry | `src/main.tsx` → `src/components/SingleTabGate.tsx` → `src/bootstrap.tsx` → `src/App.tsx` | Training mounts inside the same single-tab, recovery-gated application |
| Navigation | `src/components/AppHeader.tsx` has `AppView = 'timer' \| 'analytics'`; `src/App.tsx` holds `view` and conditionally renders Timer or a lazy `AnalyticsPage` | Add a third `'training'` view and lazy Training page; block view changes during active timing |
| Timer page | `.workspace` grid with `.side-column` (Sessions, Statistics, Solves) and `.primary-column` (Scramble, Timer, footer) | Reuse workspace/primary-column language; replace the sidebar for Training |
| Timer state | `src/timer/machine.ts` is pure; completion returns `{ rawMs, penalty }` | Reuse; route completion by active view |
| Timer hook | `src/hooks/useTimer.ts` owns the authoritative ref, exactly-once completion, hold progress, inspection elapsed | One shared `useTimer` instance in `App`; no second timer |
| Timer UI | `src/components/TimerStage.tsx` renders readout, inspection, pointer input, reset, and an `overlay: ReactNode` inside the stage | Reuse; add training last-result display and two overlay panels |
| Global input | `App.tsx` keyboard handlers currently return unless `view === 'timer'`; Space is reserved for timing outside text entry/combobox boundaries; modals block input | Extend to Training; add Training dialogs to `modalOpen`; preserve input boundaries |
| Navigation lock | `handleNavigate` blocks Analytics during an active timer | Generalize to block any view change while holding/ready/inspecting/running |
| Solve recording | `handleSolve` records a session solve via `useSessions.addSolve`, then advances the scramble | Training completion must not call `addSolve`; route to a training attempt/calibration handler |
| Inspection | WCA 15/17-second penalties and warnings | Training inspection behavior is unresolved; Phase 0 recommended bypassing inspection for V1 |

### D2. Timer and input findings

- `src/hooks/useTimer.ts` wraps the pure timer machine and keeps an authoritative
  state ref so duplicate events cannot record twice.
- Timer completions use monotonic `performance.now()` timestamps captured at
  input time. Training must use the same timing path.
- `src/components/TimerStage.tsx` uses `useRunningElapsed` for the live readout;
  expensive work should not run on every timer tick.
- The global keyboard handler in `App.tsx` is the single timing input path for
  Space and optional any-key stop. Training must join this path rather than add a
  second global key controller.
- Controls lock while armed, inspecting, or running. Training must enforce the
  same lock for setup, preset, mode, calibration, and navigation controls.
- `handleNavigate` currently blocks Analytics only during active timing; it must
  be generalized for Training.
- `useScramble` always generates WCA scrambles for the active session event.
  Training needs an `enabled` flag or equivalent so it does not perform
  unnecessary background generation.
- `useTimer` returns a `TimerCompletion`; Training needs to capture the attempt
  context in a ref before audio/focus/state work and record exactly once.

### D3. Scrambling, cube state, and rendering findings

- `src/hooks/useScramble.ts` keeps one current and one prefetched scramble.
- `src/lib/scramble.ts` generates official WCA scrambles with `cubing.js`
  `randomScrambleForEvent`; it is not used for case-derived training setups.
- `src/lib/events.ts` owns built-in/custom puzzle events. OLL/PLL must not be
  added as puzzle events.
- `src/lib/cubeNet.ts` is a sticker model for N×N face turns. It tracks sticker
  colors, normals, and positions, but not cubie identity, corner/edge
  orientation, permutation signatures, cube rotations, or F2L slot state.
- `src/components/ScrambleNet.tsx` renders a runtime SVG net from the cube model.
- `src/lib/cubeColors.ts` owns the standard six-face palette.
- `ToolPanel.tsx` uses `cubing/twisty` PG3D for Draw Scramble and the existing
  Time Trend tool.
- The existing cube utilities are useful for visual language and the Draw
  Scramble tool, but insufficient for OLL/PLL case signatures and verification.
- Phase 0 proposed a specialized pure 3×3 cubie model with `cubing.js` KPattern
  as a test oracle. Phase 1 resolved this in favor of a thin CubeLab module over
  `cubing.js`'s 3x3x3 KPuzzle/KPattern; no second simulator was added. See E5
  and the resolved F7 entry.

### D4. Floating-panel findings

- `src/components/ToolPanel.tsx` is absolutely positioned inside the
  `TimerStage` overlay.
- It supports drag by header, resize from the corner, pointer capture, a resize
  ghost, and end-of-gesture geometry persistence.
- `src/lib/toolPanelLayout.ts` clamps layouts to the timer stage and provides a
  bottom-right default.
- `src/hooks/useToolPanelLayout.ts` persists geometry in
  `cubelab:toolPanelLayout:v1`.
- `src/hooks/useToolPanelOpen.ts` persists open state in
  `cubelab:toolPanelOpen:v1`.
- The existing panel has no minimize/close controls and only one layout key.
- ToolPanel is layout-independent from the timer readout; existing
  `e2e/timer-stability.spec.ts` asserts the readout does not move.
- Known limitation: a deliberately moved/resized panel can cover the timer
  digits. The existing tests verify position stability, not every occlusion.
- Training needs a second floating panel, per-panel keys, bottom-left/bottom-right
  defaults, minimize/close, lifecycle control, and responsive docking. A shared
  frame/layout hook is **PROPOSED**; it must not regress the existing ToolPanel.

### D5. Sessions, statistics, custom events, and Analytics findings

- `SessionsData` uses schema v6 in `cubelab:sessions:v1`.
- Sessions own an event, solves, preferences, custom events, ordering, and
  transfer records.
- `src/hooks/useSessions.ts` autosaves sessions and handles custom events.
- `src/lib/stats.ts` and `src/lib/averageTrimming.ts` provide effective time,
  recorded precision, trimmed averages, best single/mean, and rolling averages.
- `src/components/StatsPanel.tsx` renders solve statistics.
- `src/components/SolveHistory.tsx` supports penalties, comments,
  deletion/Undo, and large-history windowing.
- Training attempts are not `Solve` records and must not be stored in sessions.
- `src/components/AnalyticsPage.tsx` is a lazy solve-based dashboard. Training
  attempts must not feed solve Analytics. Future Training reporting must remain
  separate.
- Training statistics should reuse pure math/format helpers but have their own
  category-keyed raw/adjusted aggregation and per-case/per-algorithm stats.

### D6. Settings, persistence, backup, and sync findings

- `Settings` uses schema v11 in `cubelab:settings:v1`.
- `SETTINGS_FIELD_KEYS` in `src/lib/settingsMerge.ts` defines synchronized
  settings fields.
- `src/hooks/useSettings.ts` handles field-level cross-tab adoption and defers
  adoption while the timer is active.
- `src/lib/storage.ts` contains checked session startup loading, validation,
  serialization, and defaults.
- `src/lib/backup.ts` defines native backup v1, app/format markers, sessions,
  settings, an optional sync envelope, and the 10 MB cap.
- `src/hooks/useSync.ts`, `src/hooks/useDriveBackup.ts`, `src/lib/sync.ts`,
  `src/lib/syncStorage.ts`, `src/lib/replacement.ts`, and
  `src/lib/startupRecovery.ts` implement immutable Drive snapshots, tombstones,
  field metadata, conflict review, durable replacement, and recovery.
- `SingleTabGate` acquires `cubelab-active-tab` before startup recovery or
  application hooks; only one current-build editable tab is allowed.
- Phase 0 recommended a separate `cubelab:training:v1` schema instead of adding
  training fields to `Settings`. This is **PROPOSED**, not final.
- Native backup can likely add an optional `training` section without bumping
  the backup version; older readers ignore unknown fields. This is **PROPOSED**
  and needs validation.
- Drive sync for Training is a protocol extension with retention, size,
  tombstone, and conflict implications. V1 inclusion is **UNRESOLVED**; Phase 0
  recommended local + native backup and deferring Drive sync.

### D7. Proposed cube-state construction

Let `I = U R U' R'` and `I⁻¹ = R U R' U'`.

#### OLL construction

For any OLL state `O` with F2L solved:

```text
P = O · I⁻¹
P · I = O
```

- `I⁻¹` affects only the U layer and the FR pair.
- Starting from `O`, the other three F2L pairs remain solved.
- The FR pair is removed into the fixed pre-insertion configuration of `I`.
- Applying `I` returns the cube to `O`, with F2L solved and the selected OLL
  case visible.
- A setup scramble is any verified scramble to `O`, followed by `I⁻¹`.
- This construction does not mathematically exclude any of the 57 OLL cases,
  conditional on a verified generator algorithm for each case.
- The Phase 0 KPattern probe described a split FR pair but placed the FR edge
  at UB. The verified Pre-Phase 1 result is: FR edge at **UR**, orientation 0;
  DFR corner at **UFR**, orientation 2. All other F2L pieces are home. The
  leading `U` of the insertion is part of the prescribed drill.
- **The visual match with the saved owner reference image is confirmed**
  (2026-11-08). The image is registered at
  `docs/training/references/f2l-oll-recognition-reference.png`. Under the
  reference's face/colour mapping, all 14 coloured F2L cells match the generated
  pre-state; the last-layer stickers are partly gray and are not a complete OLL
  pattern. See Section E4.

#### PLL construction

For any PLL state `L` and a fixed non-trivial OLL precursor `Q`:

```text
P = L · Q⁻¹
Q(P) = L
```

- `Q⁻¹` preserves F2L, and `L` has F2L solved, so `P` has F2L solved.
- `P` is an OLL case that `Q` solves up to AUF.
- For a non-trivial `Q`, `P` is not OLL-oriented; the PLL pattern is not visible
  in its normal oriented form.
- All 21 PLL cases are mathematically reachable.
- For V1, `Q` is the confirmed Sune sequence
  `R U R' U R U2 R'`.
- A setup scramble is a verified scramble to `L`, followed by `Q⁻¹`.
- Phase 0 representative probes with a Sune-like precursor returned the original
  PLL state, kept F2L solved, and left the pre-state not OLL-oriented.
- Full all-21-case setup math is validated (see E4). Exact catalog naming,
  algorithm identity, and licensing remain the Phase 2 catalog/setup gate.

### D8. Proposed algorithm/case catalog design

**PROPOSED** data shape:

```ts
interface AlgorithmCase {
  id: string                    // stable, e.g. 'oll:27', 'pll:aa'
  setId: 'oll' | 'pll'
  number: number | null
  name: string
  groupId: string
  diagramAsset: string
  signature: string             // canonical OLL/PLL signature
  defaultAlgorithmId: string
  alternativeAlgorithmIds: string[]
  generatorAlgorithmId: string  // verified rotation-free generator
}

interface AlgorithmVariant {
  id: string
  caseId: string
  notation: string
  normalizedNotation: string
  source: 'bundled' | 'user'
  verification: {
    kind: 'oll-orient' | 'pll-solve'
    startAuf: 0 | 1 | 2 | 3
    verifiedAt: number
  }
  immutable: true
}
```

Rules:

- Stable case and algorithm IDs.
- One default algorithm per case; optional alternatives.
- User-selected preferred algorithm stored separately.
- User custom algorithms stored separately from the bundled catalog.
- Bundled algorithms are immutable records. Changing an algorithm creates a new
  ID/version so historical attribution is not silently rewritten.
- Validate notation and correctness against the canonical case state, trying
  AUF variants.
- Generator algorithms should be rotation-free face-turn sequences for V1 so the
  standard cube orientation and fixed F2L slot remain valid.
- Do not invent missing algorithms or silently replace owner-approved algorithms.
- Catalog version stored in training data; migrations validate references and
  prune invalid selections without deleting historical attempts.

### D9. Proposed module structure

**PROPOSED**; nothing in this tree exists yet.

```text
src/lib/training/
  types.ts
  cube3.ts
  notation.ts
  caseSignature.ts
  algorithms.ts
  scramble.ts
  calibration.ts
  stats.ts
  presets.ts
  visits.ts
  reports.ts
  storage.ts
  merge.ts
  catalog/
    index.ts
    oll.ts
    pll.ts
    groups.ts
    precursors.ts
    catalogVersion.ts

src/hooks/
  useTraining.ts
  useTrainingVisit.ts
  useFloatingPanelLayout.ts

src/components/
  TrainingPage.tsx
  training/
    TrainingSetupPanel.tsx
    TrainingScramblePanel.tsx
    TrainingStatsPanel.tsx
    TrainingAttemptHistory.tsx
    TrainingResultPanel.tsx
    CalibrationPanel.tsx
    CaseSelectionDialog.tsx
    CaseDetailsDialog.tsx
    PresetManagerDialog.tsx
    TrainingReportDialog.tsx
    TrainingReportsList.tsx
    FloatingPanelFrame.tsx

src/assets/training/
  oll/oll-01.svg … oll-57.svg
  pll/pll-aa.svg … pll-z.svg
  cases.ts

scripts/training/
  generate-cases.ts
  validate-cases.ts
```

Modify only where integration requires it: `App.tsx`, `AppHeader.tsx`,
`TimerStage.tsx`, `ScramblePanel.tsx` or a training variant, `ToolPanel.tsx` and
layout hooks, `SettingsDialog.tsx`, `backup.ts`, `DataDialog.tsx`,
`onboarding.ts`, `index.css`, and affected docs/tests.

### D10. Proposed training data model

**PROPOSED** storage key and schema; not yet owner-approved.

```ts
type TrainingMode = 'execution' | 'recognition'
type TrainingCategoryId = `${string}:${TrainingMode}`
// V1: 'oll:execution' | 'oll:recognition' |
//     'pll:execution' | 'pll:recognition'

interface TrainingAttempt {
  id: string
  setId: string
  caseId: string
  mode: TrainingMode
  categoryId: TrainingCategoryId
  rawMs: number
  adjustedMs: number | null
  belowCalibration?: boolean
  calibration: CalibrationSnapshot | null
  algorithmId: string | null
  attribution: 'assumed' | 'user' | 'unknown'
  algorithmNotationSnapshot: string | null
  createdAt: number
  visitId: string | null
  scramble: string
  precursorAlg: string | null
  caseNameSnapshot: string
  caseNumberSnapshot: number | null
}

interface CalibrationSnapshot {
  id: string
  precursorId: string
  precursorAlg: string
  medianMs: number
  measuredAt: number
  stale: boolean
}

interface TrainingCalibration {
  id: string
  setId: string
  precursorId: string
  precursorAlg: string
  samplesMs: number[]        // exactly 7 valid samples
  medianMs: number
  createdAt: number
  source: 'initial' | 'manual' | 'due'
  invalidCount: number
  catalogVersion: string
}

interface TrainingPreset {
  id: string
  name: string
  setId: string
  caseIds: string[]
  includeSetupMoves: boolean
  builtIn: boolean
  kind?: 'static' | 'hard-cases'
  createdAt: number
  updatedAt: number
  fieldUpdates?: Record<string, FieldUpdate>
}

interface TrainingVisit {
  id: string
  startedAt: number
  lastActivityAt: number
  endedAt: number | null
  attemptIds: string[]
  status: 'active' | 'completed' | 'discarded'
  reportId: string | null
}

interface TrainingReport {
  id: string
  visitId: string
  version: 1
  createdAt: number
  startedAt: number
  endedAt: number
  totalAttempts: number
  distinctCases: number
  categories: ReportCategorySummary[]
  cases: ReportCaseSummary[]
  algorithms: ReportAlgorithmSummary[]
  mostImprovedCaseIds: string[]
  needsPracticeCaseIds: string[]
  notes: string[]
}

interface TrainingData {
  version: 1
  catalogVersion: string
  preferences: TrainingPreferences
  presets: TrainingPreset[]
  customAlgorithms: TrainingAlgorithm[]
  hardCaseIds: string[]
  attempts: TrainingAttempt[]
  calibrations: TrainingCalibration[]
  visits: TrainingVisit[]
  reports: TrainingReport[]
  activeVisitId?: string
}
```

Training-specific preferences are proposed to live in the training schema, not
`Settings`, to avoid a `Settings` v12 migration and sync-field noise. Calibration
thresholds would be edited through a Settings → Training entry point but stored
with Training data.

### D11. Proposed scramble-generation flow

```text
selected case
  -> verified generator algorithm
  -> base scramble S0 (inverse generator)
  -> mode-specific setup
       execution:              S0 (+ randomized AUF)
       OLL recognition:        S0 + U^k + R U R' U'
       PLL recognition:        S0 + U^k + Q^-1
  -> simplify moves (optional, verified)
  -> apply to cube model
  -> verify F2L / pre-state / insertion or precursor / case signature
  -> serve, or retry with different generator/AUF, or fail with a catalog error
```

- No runtime solver is proposed.
- Randomized AUF gives four variants per generator; alternative algorithms add
  variety.
- Every displayed setup must be verified. A failed verification must never
  become an attempt.
- OLL recognition verification must assert three F2L slots solved and the FR pair
  in the prescribed pre-insertion configuration.
- PLL recognition verification must assert F2L solved, the pre-state not
  OLL-oriented, and Sune produces the selected PLL case.
- Execution-only verification must assert the setup state is the selected case
  with F2L solved.
- Negative tests must corrupt a scramble/insertion and assert rejection.

### D12. Proposed UI architecture

```text
App
├─ AppHeader (Timer | Training | Analytics, training context)
├─ TrainingPage (lazy)
│  ├─ primary column
│  │  ├─ TrainingScramblePanel (setup, precursor, hidden case)
│  │  ├─ TimerStage (shared controller)
│  │  │  ├─ ToolPanel (Draw Scramble; bottom-left default)
│  │  │  └─ TrainingResultPanel (bottom-right default)
│  │  └─ TrainingFooter
│  └─ side column
│     ├─ TrainingSetupPanel
│     ├─ TrainingStatsPanel
│     └─ TrainingAttemptHistory
├─ CaseSelectionDialog
├─ PresetManagerDialog
├─ CaseDetailsDialog
├─ CalibrationPanel (page mode, not a modal)
├─ TrainingReportsList / TrainingReportDialog
└─ global Toast (practice report ready)
```

Design rules:

- Reuse Timer visual language and tokens; no new gradient/glow/status-dot
  vocabulary.
- Training Setup replaces the Sessions panel; no session selector.
- Statistics/history follow the selected category, not the preset.
- Recognition mode hides the target case identifier, diagram, and target
  algorithm; it shows only the setup scramble and mandatory precursor.
- Whether execution-only mode shows the target algorithm is **UNRESOLVED**.
  Phase 0 recommended showing it (csTimer-style) while hiding the case diagram;
  this is not final.
- Last Result is compact; no alternative list or advanced stats.
- Responsive: desktop floating panels; narrow screens dock panels below the
  timer so the readout is never covered.
- Keyboard: preserve Space-for-timing; use Enter for panel buttons; contain focus
  in dialogs; do not auto-focus the result panel; announce completion politely.

### D13. Proposed statistics and reports

- Filter attempts by `categoryId`; raw and adjusted are separate series.
- Reuse `roundAggregateMs`, `calculateAverageFromTimes`, trimming, and
  `src/lib/format.ts`.
- Do not use WCA DNF/+2 semantics for Training.
- Show attempt count, best, mean, current/best ao5/ao12, per-case and
  per-algorithm stats.
- Recognition offers Raw / Est. adjusted metric views; execution is raw only.
- Reports group by category; use case-matched baselines; equal-case weighting;
  same-algorithm comparisons; explicit insufficient-data states; estimated
  labels; never combine execution and recognition means.

Phase 0 baseline proposal (not final):

- Prior attempts before the visit start.
- Prefer the last 90 days; fall back to recent prior history if fewer than 3
  attempts; cap per-case baseline at about 20 attempts.
- Category-level change = mean of per-case changes, equal case weight.
- Descriptive category means remain attempt-based.
- Require about 3 baseline attempts per case for comparison, 3 matched cases for
  a category percentage, and about 3 visit attempts per case for ranking.
- Otherwise show descriptive stats and “not enough matched history.”
- Algorithm comparisons require the same algorithm ID; assumed attribution is
  labeled; unknown is excluded from algorithm comparisons.

These thresholds/rules must be reviewed and tested before implementation.

### D14. Proposed persistence, backup, and sync integration

**PROPOSED**:

- Separate `cubelab:training:v1` key and schema version 1; key suffix remains v1.
- Checked startup read; preserve raw bytes on failure; no fallback-empty
  autosave.
- Separate “Reset Training Data” action; solve/session resets leave Training
  untouched. (The newer full **Reset All Site Data** action clears the local
  Training store with the rest of CubeLab's browser-owned data; ordinary
  solve/session resets still leave it untouched. Training-specific reset,
  backup and Drive integration remains proposed.)
- Native backup optional `training` section; older backups preserve local
  Training; malformed training rejects before mutation.
- Use the durable replacement coordinator if native restore replaces Training.
- Cross-tab `storage` listener with idle adoption; immutable records merge by ID.
- Drive sync deferred until retention/tombstone/size rules are approved.

### D15. Feasibility evidence and confidence

| Finding | Status | Evidence/notes |
| --- | --- | --- |
| Existing Timer can be shared | **VALIDATED** | `useTimer` is a hook around a pure machine; one instance can route completion by view |
| Timer has exactly-once input protection | **VALIDATED** | Authoritative state ref in `useTimer`; existing tests |
| Floating ToolPanel geometry is reusable | **VALIDATED** | `toolPanelLayout`/pointer implementation; existing stability tests |
| ToolPanel lacks minimize/close and multiple keys | **VALIDATED** | Source audit |
| OLL construction `P = O · I⁻¹` works algebraically | **VALIDATED** | Move support and inverse construction; exhaustive 216-state KPattern verification in E4 |
| OLL pre-state is a split FR pair | **VALIDATED** | FR edge at UR orientation 0; DFR corner at UFR orientation 2; all 14 coloured reference-image cells match; see E4 |
| All 57 OLL cases producible | **PROVEN (orientation states)** | 216 valid orientation states form 58 AUF orbits (57 OLL + solved); catalog algorithms remain Phase 2 |
| PLL construction `P = L · Q⁻¹` works | **VALIDATED** | All 288 PLL permutation states exact-return; E4 |
| Sune is fixed PLL precursor | **CONFIRMED** | Owner decision |
| Fixed precursor hides PLL pattern | **VALIDATED** | Pre-state orientation signature `2220\|0000` (Sune OLL case) for all 288 states; see E4 |
| CubeSkills content cannot be bundled without permission | **VALIDATED** | Live Terms of Use on 2026-11-08 |
| Separate Training schema is safer than Settings v12 | **PROPOSED** | Avoids settings/sync coupling; not owner-approved |
| Static SVG generation at development time | **REQUIRED** | Confirmed product requirement |
| Runtime verification of every setup | **REQUIRED** | Confirmed product requirement |

**Assumptions:**

- A complete, verified OLL/PLL catalog with one generator algorithm per case will
  be available.
- Users hold a physical 3×3 in standard orientation with a standard color scheme.
- Training can use the timer without WCA inspection/penalties; unresolved.
- A fixed PLL precursor’s deterministic inverse mapping is acceptable for V1.
- V1 Training can be local + native backup; Drive sync may be deferred.
- The saved F2L reference image and owner-approved catalog content are
  available/approved for use.

**Requires verification:**

- All 57 OLL and 21 PLL catalog/setup definitions in both training modes; the
  underlying setup math is verified in E4, but catalog algorithms and exact named
  case identity remain to be validated.
- Algorithm catalog correctness and licensing.
- Static diagram correctness/visual quality.
- Training data size/performance and backup impact.
- UI keyboard/accessibility/responsive behavior.
- Production offline PWA behavior.

### D16. Proposed test strategy

| Area | Coverage |
| --- | --- |
| Cube model | Move composition/inverses, notation, rotations/wide/slice, random-sequence oracle vs `cubing.js` KPattern, AUF canonicalization |
| Cases | 57 OLL + 21 PLL definitions, unique IDs/signatures, groups, assets, defaults/alternatives/generators; independent case-space coverage test |
| Algorithms | Every bundled algorithm solves its case up to AUF; alternatives; custom accept/reject; negative mutations |
| Scrambles | Every case × both modes; final state, F2L, OLL insertion pre-state, PLL Sune precursor result; corrupted setup rejected |
| Stats | Four categories never mixed; raw/adjusted separation; best/mean/averages; per-case/per-algorithm; unknown attribution |
| Attribution | Assumed default; correction; unknown exclusion; preferred changes do not rewrite history |
| Calibration | Exactly 7 samples, median, discard/retry, due thresholds, manual, missing/expired/invalid, snapshots, below-calibration |
| Visits | Start/resume/leave/stale; zero attempts no report; short-refresh resume; report grouping |
| Reports | Case-matched baselines, equal-case weighting, same-algorithm comparisons, insufficient data, estimated labels |
| Presets | Built-in immutability, user CRUD, selection, hard-cases dynamic, no stats reset |
| Persistence | Training schema validation/migration/recovery; separate key; write failure; native backup round trip; old backup preserves training; resets isolated |
| Cross-tab/sync | Idle adoption, active-timer deferral, immutable record merge; optional sync design |
| UI | Setup, hidden case, result panel lifecycle, dialogs, calibration, report toast/dialog, attribution correction, history |
| Floating panels | Drag/resize/clamp/default corners/persistence/minimize/close/overlap avoidance/docking/pointer isolation |
| Timer | Training start/stop exact-once, keyboard/inspection boundaries, no session contamination, Timer regressions |
| Responsive/a11y | 1440/1024/390/320, short landscape, light/dark, axe, keyboard, reduced motion, diagram alt text |
| Offline/PWA | Training lazy chunk + static SVGs precached; production offline scenario |

Important negative tests:

- a scramble missing one move must fail verification;
- a wrong insertion must fail;
- a wrong precursor must fail;
- duplicate/missing case signatures must fail;
- a wrong algorithm must fail;
- a recognition case exposed in the setup UI must fail;
- Training attempts must not appear in session solves, solve history, or Analytics.

### D17. Licensing finding

The CubeSkills Terms of Use state:

> “Any reproduction, distribution or storage of part or all of the contents on
> this site is only permitted with our prior written approval.”

All text, video, software, and other materials are owned by CubeSkills or
included with permission.

Implications:

- Do not copy or bundle CubeSkills OLL/PLL PDFs, lists, descriptions, or curated
  presentation without prior written approval.
- Using CubeSkills as an internal reference for owner review is different from
  redistributing its data in the repository.
- The catalog must be owner-supplied/owner-approved, alternative licensed
  content, or CubeSkills content used after written permission with required
  attribution.
- Case diagrams generated from cube mathematics are not copied CubeSkills
  diagrams, but case names/family groupings and explanatory text should be
  generic/owner-reviewed.
- Record the licensing decision and attribution near the catalog.

---

## E. Corrections to Phase 0

These corrections override any contradictory Phase 0 text.

### E1. OLL 57 is a valid OLL case, not an OLL skip

**CONFIRMED correction:** OLL 57 is a valid OLL case, not an “OLL skip.”

All **57** standard OLL cases and all **21** PLL cases must support both
execution and recognition training.

Do **not** implement the erroneous Phase 0 recommendation to disable OLL 57
execution training. Do not treat OLL 57 as an exception, skip, or trivial case.
The Phase 0 note that suggested disabling it was incorrect and is superseded by
this correction.

### E2. OLL starting visual configuration — RESOLVED 2026-11-08

Phase 0 investigated the inverse-generated state for the fixed OLL insertion and
described it as a split FR pair. The exact match between that generated state and
the saved owner reference image is **not confirmed**.

The reference is now saved at
`docs/training/references/f2l-oll-recognition-reference.png` and must be used
during Pre-Phase 1. Registering the image does not complete the visual
verification.

This remains an unresolved verification task. It is not permission to change the
prescribed `U R U' R'` moves, the final F2L slot, or the requirement that three
F2L slots are solved.

**Resolution (2026-11-08):** The Pre-Phase 1 visual/state comparison was
completed. The generated split FR pair matches the saved reference image's
coloured F2L cells, and the Phase 0 edge-position claim was corrected from UB to
UR. See Section E4. This resolution does not change the prescribed moves.

### E3. Prescribed moves are fixed

Do not substitute a different insertion, precursor, or final slot because it is
easier or appears equivalent under a different AUF. Any change requires explicit
owner approval and a dated memory update.

### E4. Pre-Phase 1 recognition setup verification — COMPLETE (2026-11-08)

**Status:** Pre-Phase 1 acceptance criteria are satisfied. Phase 1 has **not**
started. No Training application code, application dependency, or unrelated
application file was changed.

**Method:** Temporary Node scripts outside the repository used the installed
`cubing.js` 0.66.1 `3x3x3` KPuzzle as the state oracle. The reference image was
sampled with temporary Python/PIL/OpenCV scripts. Scripts were not committed and
are not application code. Principal commands:

```bash
node /tmp/opencode/training_verify_final.mjs
node /tmp/opencode/oll_perm_test.mjs
node /tmp/opencode/examples.mjs
```

The final script checked exact `KPattern` equality, not only visual similarity.
The image was analysed by colour-segment centroids rather than assumed from the
thumbnail.

#### E4.1 OLL fixed insertion

`I = U R U' R'`; `I⁻¹ = R U R' U'`.

From solved, `P = I⁻¹` has these F2L piece positions/orientations:

| Piece | Position | Orientation |
| --- | --- | --- |
| DFR corner (FR pair corner) | **UFR** | 2 |
| FR edge (FR pair edge) | **UR** | 0 |
| DFL corner / FL edge | home | 0 / 0 |
| DBL corner / BL edge | home | 0 / 0 |
| DBR corner / BR edge | home | 0 / 0 |
| Cross DF, DR, DB, DL | home | 0 |

The FR slot is occupied by the UFR corner at DFR (orientation 2) and the UB edge
at FR (orientation 0) because the pair has been removed. Three F2L slots are
solved; the FR pair is split between UFR (corner) and UR (edge). Applying exactly
`U R U' R'` returns to solved. Orientation values above are `cubing.js` KPattern
indices; Section E4.2 gives the concrete sticker placement.

**Correction:** Phase 0's “FR edge at UB” is wrong. The verified position is
**UR** orientation 0. The corner at UFR orientation 2 was correct. The
qualitative “split FR pair” description is accurate.

**Exhaustive OLL check:** All 216 valid last-layer orientation patterns
(corner-twist sum 0 mod 3, edge-flip sum 0 mod 2) were constructed with the
last-layer permutation identity. They form 58 AUF orbits: 57 non-solved OLL cases
plus solved. All 216 produced the same fixed FR pre-state, all returned exactly
to `O` under `P · I`, and all had F2L solved in `O`. A second run using a fixed
non-identity even U-layer permutation passed 216/216. There was exactly one
distinct F2L pre-state signature.

**Representative Sune OLL case:** `O = Q⁻¹` where
`Q = R U R' U R U2 R'`. `P = O · I⁻¹` is reached from solved by the concise
sequence:

```text
R U2 R' U2
```

Then the prescribed insertion:

```text
U R U' R'
```

returns exactly `O` (the Sune OLL case) with F2L completely solved. Verified.

#### E4.2 OLL visual comparison

The reference image is 586×166. Its cube view has a yellow U centre, a red centre
on the left visible face, and a green centre on the right visible face. Gray
stickers are filler/unspecified, not a claim about the last-layer pattern. Pixel
segmentation found the visible 3×3 sticker grids:

```text
U face (image):          left face (image):      right face (image):
x x x                    x x W                   G G x
x Y R                    R R x                   x G G
x x R                    R R x                   x G G
```

The generated pre-state `P` was compared by treating the reference's left visible
face as F (its centre is red in the image), its right visible face as R (green
centre), U as yellow, and D as white, then remapping the cubing.js sticker colours
to that palette (U→yellow, D→white, F→red, R→green; B/L are gray/unspecified).
All **14** non-gray reference cells matched; there were **0** mismatches. The
coloured cells are the F/R face centres, the U centre, the DFR corner at UFR
(three stickers), the FR edge at UR (two stickers), and the solved F2L side
stickers. Concretely, under that mapping the DFR corner shows D/white on F, R/red
on U, and F/green on R; the FR edge shows F/red on U and R/green on R. The
last-layer stickers are intentionally incomplete and must not be matched to a
specific OLL case.

The reference's face-colour labelling is not the standard Western
F=green/R=red assignment; it is consistent with the generated state under a
consistent relabelling (or a mirrored rendering). The authoritative comparison is
piece position/orientation, not the colour names. Do not alter the prescribed
moves because of this labelling.

#### E4.3 PLL fixed Sune precursor

`Q = R U R' U R U2 R'`; exact inverse `Q⁻¹ = R U2 R' U' R U' R'`.

All **288** possible last-layer permutation states with F2L solved and the last
layer oriented (4! × 4! / 2 = 288, including the solved/PLL-skip state) were
enumerated. This covers every one of the 21 standard non-solved PLL cases. For
every `L`:

- `P = L · Q⁻¹` and `P · Q = L` exactly;
- F2L is solved in `P`;
- `P` is not PLL-oriented: its U face has 3 non-U stickers and its orientation
  signature is `2220|0000`, the Sune OLL case (`Q⁻¹`), for all 288 states;
- 1152 post-AUF variants (4 per state) returned exactly to their target, with 0
  failures.

No complete validated 21-case PLL fixture catalog exists in the repository.
Representative verification used 21 common named PLL algorithms. One algorithm
with an internal whole-cube `y` rotation was returned to the standard frame with
a final `y'` for the check. All 21 generated valid PLL states (F2L solved, U face
oriented) and passed exact Sune return, F2L preservation, and the non-PLL
pre-state check. Raw cycle types were recorded in the run output; some show an AUF
offset, so exact name-to-catalog-case identity and licensing remain Phase 2 work.
The exhaustive 288-state result is the authoritative mathematical coverage of all
21 PLL cases.

**AUF handling:** the construction uses the exact group inverse, with no assumed
free AUF. A catalog generator must select the exact `L` variant that the
prescribed Sune precursor returns; case identity up to AUF belongs to the
catalog/setup layer, not to a silent post-hoc adjustment.

#### E4.4 Representative setup sequences (verification only)

These are verified examples, not approved application catalog content.

| Algorithm label | Setup from solved to `P` | Prescribed precursor | Result |
| --- | --- | --- | --- |
| Sune OLL case (`Q⁻¹`) | `R U2 R' U2` | `U R U' R'` | exact `Q⁻¹`, F2L solved |
| PLL T algorithm | `R U R' U' R' F R2 U' R' U' R U R' F'` then `R U2 R' U' R U' R'` | Sune `Q` | exact state produced by that algorithm, F2L solved |
| PLL Ua algorithm | `M2 U M U2 M' U M2` then `R U2 R' U' R U' R'` | Sune `Q` | exact state produced by that algorithm, F2L solved |
| PLL Y algorithm | `F R U' R' U' R U R' F' R U R' U' R' F R F'` then `R U2 R' U' R U' R'` | Sune `Q` | exact state produced by that algorithm, F2L solved |

The PLL setup strings are the named algorithm followed by `Q⁻¹`; they were not
claimed to be minimal. For non-involutive cases, applying the algorithm to a
solved cube can produce the inverse case family (for example, a Ua-labelled
algorithm can produce a Ub-family state). These examples identify the generated
state by the algorithm used, not by an independently validated catalog label.

#### E4.5 Limits and non-claims

- Named OLL/PLL catalog identity, algorithm sourcing, and redistribution rights
  remain Phase 2 decisions (see F2/F3). The reference image remains an internal
  asset; do not publish or redistribute it.
- The 21 named PLL algorithms are representative evidence, not a licensed
  catalog validation. Some raw cycle types include an AUF offset.
- The image's nonstandard/mirrored face-colour labelling should be treated as a
  presentation convention; the verified piece configuration is the FR pair split
  between UFR and UR.
- No application typecheck/lint/Vitest/Playwright run was required or performed:
  this task changed documentation only. The temporary verification scripts are
  outside the repository and are not part of the product.
- The prescribed insertion and Sune precursor were not modified.

### E5. Phase 1 implementation and verification — COMPLETE (2026-11-08)

**Status:** Phase 1 acceptance criteria passed. Only pure cube/notation/case
mathematics was added. There is no Training UI, catalog, diagram generation,
training persistence, calibration, statistics, Timer change, or new dependency.

#### E5.1 Technical decision — reuse cubing.js KPattern

**RESOLVED (replaces F7's unresolved state):** use the installed `cubing.js`
0.66.1 `3x3x3` KPuzzle/KPattern as the cube-state engine. CubeLab wraps it with a
small training-specific module instead of maintaining a second full simulator.

Why this is sufficient:

- `KPattern.applyAlg` / `applyMove` already provide proven move application,
  wide/slice/rotation moves, exact inverses, and immutable states.
- The KPattern corner/edge permutation and orientation indices are the same
  values used by the Pre-Phase 1 oracle, including DFR at UFR orientation 2 and
  FR at UR orientation 0.
- The additional training needs are selectors and signatures over that state:
  piece names, F2L slot checks, OLL/PLL signatures, AUF canonicalization, and
  precursor validation. These are implemented as modest pure functions.

Costs and boundaries:

- Loading the 3x3x3 puzzle definition is asynchronous and loads cubing.js's
  puzzle chunk. The model uses a cached dynamic import so unrelated application
  chunks do not load it.
- `invertState` uses cubing.js's `experimentalToTransformation()` API. It is
  pinned to the tested 0.66.1 definition and protected by mapping/invariant
  checks and tests; a future cubing.js update must re-run Phase 1 coverage.
- CubeLab's notation parser is deliberately stricter than cubing.js's
  multi-puzzle parser. It accepts whitespace-separated face, wide, slice, and
  rotation moves with `'`, `2`, `2'`, or `'2`; it rejects other puzzle notation,
  grouping, commutators, repetitions, and malformed tokens before cubing.js sees
  them.
- The final named PLL catalog grouping is still Phase 2. The Phase 1 PLL
  signature is AUF-canonical and intentionally finer than the eventual named
  case catalog.

#### E5.2 Implemented modules

Created under `src/lib/training/`:

- `notation.ts` — strict move/algorithm parser, normalization, move and
  algorithm inversion, composition, validation errors.
- `cube3.ts` — cached cubing.js model loader; validated cubie-state construction;
  piece/position naming; move/AUF application; state inversion; F2L slot and
  solved checks; standard-frame, last-layer, OLL/PLL state checks; U-face
  orientation count; fixed OLL pre-insertion analysis; fixed Sune PLL precursor
  analysis; raw OLL orientation signature.
- `caseSignature.ts` — raw and AUF-canonical OLL orientation signatures and PLL
  permutation signatures.
- `caseSpace.ts` — deterministic enumeration of all 216 OLL orientation states
  and all 288 PLL permutation states for coverage tests.
- Focused tests: `notation.test.ts`, `cube3.test.ts`, `caseSignature.test.ts`.

Important invariants enforced by `createState`/`validateCube3State`:

- corner and edge piece arrays are complete permutations;
- corner orientations are 0–2 and sum to 0 mod 3;
- edge orientations are 0–1 and sum to 0 mod 2;
- the combined corner/edge/center permutation parity is even (with centers home
  this reduces to equal corner/edge parity);
- the piece-index mapping is checked at load time against known R-move
  transformations;
- OLL/PLL signature functions reject states without the required solved F2L,
  last-layer placement, or orientation.

The prescribed sequences are exported constants and are not configurable:
`OLL_INSERTION = U R U' R'`, `PLL_PRECURSOR = R U R' U R U2 R'`. Analyses also
record whether the supplied sequence is the exact prescribed normalized
sequence; a mathematically returning but non-prescribed insertion/precursor is
rejected by `ok`.

#### E5.3 Verification evidence

Commands run from the repository root with Node 22.23.2:

```bash
npm run typecheck
npm run lint
npm test -- src/lib/training/notation.test.ts src/lib/training/cube3.test.ts src/lib/training/caseSignature.test.ts
node /tmp/opencode/training_verify_final.mjs
node /tmp/opencode/oll_perm_test.mjs
node /tmp/opencode/phase1_verify_impl.mjs
```

Results:

- `npm run typecheck`: passed.
- `npm run lint`: passed; one pre-existing warning remains at
  `src/components/SessionPanel.tsx:566` (`Date.now` during render). No new
  training warning.
- Focused Vitest: **28/28 tests passed** across the three files.
- Original Pre-Phase 1 oracle script was re-run unchanged. Its output was
  byte-identical to the preserved `/tmp/opencode/training-verify-output.txt`
  (`diff` empty): 216/216 OLL orientation states, 58 AUF orbits, 57 non-solved
  OLL cases, 0 fixed-pre-state/return/F2L failures; 288/288 PLL states, 0
  return/F2L/pre-oriented/signature failures, `2220|0000` as the only pre-state
  signature; 1152/1152 AUF checks; 21/21 named PLL representatives; reference
  image comparison 14 coloured cells / 0 mismatches. The separate non-identity
  even U-layer permutation probe also passed 216/216 with 0 failures.
- Independent implementation verification: `/tmp/opencode/phase1_verify_impl.mjs`
  loaded the actual TypeScript modules through Vite SSR and checked them against
  hardcoded E4 expectations (not against the implementation's own enumeration
  assumptions). **28/28 checks passed**: fixed DFR/FR positions, three solved
  F2L slots, 216 OLL states/58 orbits/57 cases plus the non-identity U-layer
  permutation run, 288 PLL states, 1152 AUF variants, `2220|0000`
  pre-signature, 21 named PLL algorithms, and PLL canonical AUF stability.
- No differences from the documented Pre-Phase 1 results were found. The
  original evidence under `/tmp/opencode/` was left untouched.

No Playwright/E2E, production build, manual UI inspection, or live Drive test was
run. This phase changed no application UI, Timer behavior, persistence, or
network code; E2E would not exercise the new pure modules.

#### E5.4 Limits and non-claims

- Named OLL/PLL catalog identity, algorithm sourcing, generator algorithms, and
  licensing remain Phase 2. The 21 named PLL algorithms are representative
  mathematical fixtures, not an approved catalog.
- `canonicalPllSignature` canonicalizes AUF only. It distinguishes the 21 named
  representatives used here, but final named-case grouping may be coarser and
  belongs to the catalog layer. No claim is made that Phase 1 has already
  produced the final 21 named PLL signatures.
- `0000|0000` is the solved OLL orientation signature (OLL skip in orientation
  space), not one of the 57 non-solved OLL cases. OLL 57 remains a valid
  non-solved case per E1.
- Static diagram generation, runtime setup generation, performance/bundle
  measurement, and production offline verification remain later phases.
- The reference image was re-checked only through the preserved Pre-Phase 1
  script/oracle data; no new image analysis was performed in Phase 1.

### E6. Phase 2A — Approved algorithm catalog audit — COMPLETE (2026-11-08)

> **Emergency audit supersession (E8):** the following is retained history.
> The OLL 56 expansion/reporting claim is incorrect; A fails, B passes, and C
> is OLL 54. Approval was under renewed review at this checkpoint. A separate
> omitted-cross validator defect was fixed. Phase 2C was stopped.
>
> **Final resolution (E9):** the owner approved candidate B,
> `r U r' (U R U' R')2 r U' r'`, as the OLL 56 default. F13 is resolved. The
> earlier A/C/D strings and their explanations remain preserved below.

**Status:** Audit complete. No Training UI, storage, statistics, diagrams,
catalog files, dependencies, or application code were added. Source datasets
were not copied into the repository. Full Phase 2 implementation had not
started at the time of this audit; Phase 2B later added pure catalog/setup
foundations (E7).

#### E6.1 Owner approvals and source references

**CONFIRMED owner decisions (2026-11-08):**

- **OLL:** source `https://github.com/Heroor/cfop`, local clone
  `~/heroor-cfop`, data `src/data/cube.json`, field `.oll[].f`. All 57 OLL
  records are approved as default candidates.
- **PLL:** source `https://github.com/tao-yu/Alg-Trainer`, local clone
  `~/tao-alg-trainer`, data `js/alg_list.js`, object `PLL`. The **first**
  slash-separated algorithm for each of the 21 cases is approved as the default
  candidate. Additional slash-separated variants are not approved defaults.
- These approvals select content candidates. They do not grant redistribution
  rights; see E6.5.

**Source snapshots inspected:**

- `Heroor/cfop` commit `e1cba6995f3ff27732ac18c767e7e9ca1343f13a` (single-commit
  snapshot), 57 OLL records.
- `tao-yu/Alg-Trainer` commit `cb95945c3e4839ee1e4b058d4a79bc022615b220`
  (single-commit snapshot), 21 PLL cases and 58 slash-separated variants.

#### E6.2 Extraction and normalization

- OLL `.f` is **one displayed algorithm**. Newlines are visual breaks, not
  alternative-algorithm delimiters. Evidence: for every multi-line OLL field
  that passes (37 of 38), the complete field matches the source `.c` diagram and
  the independent case reference; individual display lines often solve different
  OLL cases. For example, OLL 2's two display lines are OLL 45 and OLL 44
  algorithms, while the complete field is OLL 2. OLL 56 is the one multi-line
  exception: its full field fails due to a one-token typo, and the corrected full
  field matches (E6.4).
- PLL: split the `PLL` arrays on `/`; the first segment is the approved
  default. Remaining segments were audited as unapproved alternatives only.
- Expand parenthesized `(...)2` group repetition before parsing. It occurs only
  in OLL 47, 48, 51 and 56. Naive parenthesis removal changes semantics:
  `(U'R'UR)2` must become `U' R' U R U' R' U R`, not `U' R' U R2`.
- Normalize lowercase wide moves `r/l/f/b/u/d` to `Rw/Lw/Fw/Bw/Uw/Dw`; keep
  slices `M/E/S` and rotations `x/y/z`; normalize `'2`, `2'` and prime-before-2
  spellings to half turns. The sources use `R'2`, `M'2` and `r'2`; the Phase 1
  parser accepts these, but cubing.js's permissive parser does not reliably
  accept the prime-before-2 spelling, so normalize before applying.
- Preserve raw source notation and normalized notation separately. The complete
  audit artifact is outside the repository at
  `/tmp/opencode/phase2a-audit.json` (not committed) and records raw strings,
  hashes, normalized notation, per-case signatures and failures.
- Regrip to the standard frame after applying an algorithm (undo its net
  whole-cube rotation) before computing case identity. Wide/slice/rotation
  algorithms require this; without it, valid reference algorithms such as Aa,
  Ab and E appear invalid.

#### E6.3 Verification method and conventions

- Used the Phase 1 `cube3.ts`, `notation.ts`, `caseSignature.ts` and
  `caseSpace.ts` foundations with the cubing.js KPattern engine.
- **OLL identity is orientation-only up to AUF.** Built 57 unique non-solved
  canonical signatures from an independent public J Perm OLL reference
  (fetched transiently, not stored). The source `.c` oriented/non-oriented
  U-face pattern matches that reference for all 57 cases under some AUF,
  independently confirming the source numbering and diagrams. The comparison
  used oriented/non-oriented status, not the source's 1/2 side-label digits,
  which are a presentation convention.
- **PLL identity is permutation up to pre- and post-AUF** (double coset under
  U·S·U), not left-AUF only. The 288 PLL states collapse to exactly 22
  double-coset classes: 21 named cases plus solved/PLL skip. Left-AUF-only
  canonicalization yields 72 classes and is too fine; `canonicalPllSignature`
  remains a Phase 1 signature and must not be used as the named PLL case key.
- Applied each source algorithm to the independent reference representative
  under all relevant AUFs and checked the claimed result: OLL all U stickers
  oriented with F2L solved; PLL solved up to post-AUF with F2L solved.
- Also checked inverse round trips, exact signatures, F2L/last-layer state,
  notation families, token validity and source `.c` consistency.

#### E6.4 Results and case-by-case report

**OLL: 55/57 approved defaults pass.** All 55 passing defaults produce a valid
OLL state, match the independent case signature, and solve the independent
reference representative under some AUF. The source `.c` diagram matches the
independent reference for all 57 cases. No valid-but-mislabeled OLL algorithm
was found.

| Case | Result | Note |
| ---: | --- | --- |
| 1 | Pass |  |
| 2 | Pass |  |
| 3 | Pass |  |
| 4 | Pass |  |
| 5 | Pass |  |
| 6 | Pass |  |
| 7 | Pass |  |
| 8 | Pass |  |
| 9 | Pass |  |
| 10 | Pass |  |
| 11 | Pass |  |
| 12 | Pass |  |
| 13 | Pass |  |
| 14 | Pass |  |
| 15 | Pass |  |
| 16 | Pass |  |
| 17 | Pass |  |
| 18 | Pass |  |
| 19 | Pass |  |
| 20 | Pass |  |
| 21 | Pass |  |
| 22 | Pass |  |
| 23 | Pass |  |
| 24 | Pass |  |
| 25 | Pass |  |
| 26 | Pass |  |
| 27 | Pass |  |
| 28 | Pass |  |
| 29 | Pass |  |
| 30 | Pass |  |
| 31 | Pass |  |
| 32 | Pass |  |
| 33 | Pass |  |
| 34 | Pass |  |
| 35 | Pass |  |
| 36 | Pass |  |
| 37 | Pass |  |
| 38 | Pass |  |
| 39 | Pass |  |
| 40 | Pass |  |
| 41 | Pass |  |
| 42 | Pass |  |
| 43 | Pass |  |
| 44 | Pass |  |
| 45 | **Fail** | Invalid algorithm; recommended correction below |
| 46 | Pass |  |
| 47 | Pass | Group repetition expanded |
| 48 | Pass | Group repetition expanded |
| 49 | Pass |  |
| 50 | Pass |  |
| 51 | Pass | Group repetition expanded |
| 52 | Pass |  |
| 53 | Pass |  |
| 54 | Pass |  |
| 55 | Pass |  |
| 56 | **Fail** | Invalid algorithm; recommended correction below |
| 57 | Pass |  |

**OLL failures and recommended replacements (not applied):**

- **OLL 45:** source `F(RUR'U')f'` (normalized `F R U R' U' Fw'`) does not
  reach a valid OLL state. The source appears to use wide `f'` where `F'` is
  intended. Verified correction: `F(RUR'U')F'` → signature `0012|1010`.
- **OLL 56:** source `(rUr')(URU'R')2\n(r'U'r')` (normalized
  `Rw U Rw' U R U' R' U R U' R' Rw' U' Rw'`) does not reach a valid OLL state.
  Verified correction: `(rUr')(URU'R')2(rU'r')` (normalized
  `Rw U Rw' U R U' R' U R U' R' Rw U' Rw`) → signature `1212|1010`. This is a
  one-token correction in the final group.

These are recommendations only. Do not silently replace the owner-approved
source strings; owner approval is required.

**PLL: 21/21 approved defaults pass; 58/58 slash variants pass.** Every first
variant matches its named double-coset signature and solves the independent
reference representative under some pre/post AUF. Every additional variant also
passed; they remain unapproved defaults.

| Case | Default | Variants | Note |
| --- | --- | ---: | --- |
| Ua | Pass | 6/6 |  |
| Ub | Pass | 3/3 |  |
| H | Pass | 2/2 | Uses slice; regrip-sensitive |
| Z | Pass | 4/4 | Uses slice; regrip-sensitive |
| Aa | Pass | 2/2 | Uses wide, rotation; regrip-sensitive |
| Ab | Pass | 2/2 | Uses rotation; regrip-sensitive |
| E | Pass | 1/1 | Uses rotation; regrip-sensitive |
| Ga | Pass | 2/2 | Uses wide, rotation; regrip-sensitive |
| Gb | Pass | 3/3 | Uses wide; regrip-sensitive |
| Gc | Pass | 4/4 | Uses wide, rotation; regrip-sensitive |
| Gd | Pass | 2/2 | Uses wide, rotation; regrip-sensitive |
| Ra | Pass | 3/3 |  |
| Rb | Pass | 2/2 |  |
| Ja | Pass | 4/4 |  |
| Jb | Pass | 1/1 |  |
| Na | Pass | 3/3 |  |
| Nb | Pass | 4/4 | Uses rotation; regrip-sensitive |
| Y | Pass | 2/2 |  |
| F | Pass | 2/2 |  |
| T | Pass | 1/1 |  |
| V | Pass | 5/5 | Uses wide; regrip-sensitive |

Some approved defaults use rotations, wide moves or slices; they are valid under
the regrip convention but require careful catalog validation. They are not
failures.

**Notation:** 46 distinct source tokens; 0 unsupported after group expansion.
Across all audited source strings there were 1,179 face, 94 wide, 52 slice and
30 rotation move occurrences. Group repetition occurs only in OLL 47/48/51/56.
Prime-before-2 tokens `R'2` (6), `M'2` (1) and `r'2` (1) normalize to half
turns. All inverse round trips passed. The current strict Phase 1 parser cannot
ingest the raw OLL strings directly because it rejects grouping/repetition, so
catalog ingestion must pre-expand or extend the parser deliberately.

#### E6.5 Licensing and provenance — UNRESOLVED

- **Heroor/cfop:** the README states “This project is licensed under the MIT
  License” and “©2026-present, Bener”, but the repository has no `LICENSE` file
  and GitHub's license API returns 404. The inspected clone is a single commit.
  The README thanks “the cubing community for sharing algorithm collections and
  resources” without identifying sources. The code-license claim does not
  clearly establish redistribution rights for the algorithm data.
- **tao-yu/Alg-Trainer:** `LICENSE` is MIT (Copyright 2017–2021 Tao Yu).
  `js/README.md` records MIT origins for borrowed code files. `index.html`
  credits ZBLL/ZBLS/Ribbon/One Look Wednesday sources and says “Other algorithms
  from algdb unless stated otherwise.” The PLL section has no separate
  license/attribution. AlgDb.net has no clear current license/terms. MIT covers
  the software; it does not clearly grant rights to the algorithm compilation.
- Owner approval is not a redistribution license. **Do not copy either dataset
  into the application, repository catalog files, backups or distributable
  assets, and do not commit them, until redistribution rights are resolved in
  writing or an independently authored/licensed catalog replaces them.**
- This audit used the sources as references only; no source algorithm data was
  added to the repository.

#### E6.6 Unresolved concerns and follow-ups

> **Historical note (2026-11-08, Phase 2B):** owner approval for the two OLL
> corrections was subsequently recorded in E6.7. The original audit evidence
> above is preserved unchanged. Redistribution rights and the OLL 56 notation
> conflict remain unresolved.

- Obtain written permission or owner-authored/licensed replacement data; record
  attribution.
- Owner decision on the two OLL corrections (45 and 56). Do not apply them
  silently.
- Owner confirmation of the extraction interpretation: each OLL `.f` field is one
  displayed algorithm, with newlines as visual breaks. This is the only
  interpretation that consistently matches the source `.c` diagrams and the
  independent reference.
- Implement a named PLL case signature under pre/post AUF in the catalog layer;
  do not use `canonicalPllSignature` alone.
- Catalog ingestion must expand group repetition, normalize prime-before-2
  spellings, and frame-normalize wide/slice/rotation algorithms.
- Decide whether additional PLL variants may be stored as alternatives after
  licensing; currently only the first variants are approved defaults.
- No SVG catalog, Training UI, storage, statistics, calibration or
  setup-generation implementation was started.

#### E6.7 Final owner approval of algorithm corrections and defaults (Phase 2B, 2026-11-08)

> **Emergency audit supersession (E8):** the following is retained history.
> The OLL 56 expansion/reporting claim is incorrect; A fails, B passes, and C
> is OLL 54. Approval was under renewed review at this checkpoint. A separate
> omitted-cross validator defect was fixed. Phase 2C was stopped.
>
> **Final resolution (E9):** the owner approved candidate B,
> `r U r' (U R U' R')2 r U' r'`, as the OLL 56 default. F13 is resolved. The
> earlier A/C/D strings and their explanations remain preserved below.

**CONFIRMED owner decisions.** These are approval decisions for content
selection. They are not redistribution licenses (see F12).

- **All 57 Heroor/cfop OLL `.f` records are owner-approved as defaults**, using
  the two corrected algorithms below.
- **All 21 first-listed Tao Yu Alg Trainer PLL variants are owner-approved as
  defaults.**
- The **37 additional PLL slash-separated variants** remain verified potential
  alternatives, not approved defaults.
- No other algorithm changes have been authorized.

**OLL 45 — approved correction**

```text
Original Heroor source:  F(RUR'U')f'
Approved correction:     F R U R' U' F'
Normalized:              F R U R' U' F'
```

The trailing `f'` incorrectly denotes a wide F move. The approved `F'` is a
face turn. Phase 2B verification confirms the corrected algorithm's case
signature is the OLL 45 reference signature `0012|1010`.

**OLL 56 — approved correction as stated**

```text
Original Heroor source:  (rUr')(URU'R')2
                         (r'U'r')
Approved correction:     r U r' (R U R' U')2 r U' r'
```

The original first `r'` in the final group is corrected to `r`. Group
repetition semantics are preserved; `(R U R' U')2` must expand to
`R U R' U' R U R' U'`, not be flattened or parsed as a half-turn.

**OLL 56 — verification conflict (UNRESOLVED)**

Phase 2B independently verified the exact approved string above against the
Phase 2A reference signature `1212|1010`. As written, the approved string
produces the canonical signature **`1212|0110`**, not `1212|1010`. The
difference is the second group: the source has `(URU'R')2`, while the approved
compact string uses `(R U R' U')2`.

The Phase 2A normalized correction
`Rw U Rw' U R U' R' U R U' R' Rw U' Rw` — equivalently
`r U r' (U R U' R')2 r U' r` — does match the OLL 56 reference
`1212|1010`. The owner-approved compact string above therefore conflicts with
the verified OLL 56 case identity.

Do **not** silently substitute the Phase 2A variant. The OLL 56 default remains
content-blocked pending owner clarification of the intended exact notation.
OLL 45 and the other 55 OLL defaults verify; OLL 56 is the one exception.

See F13 and E7 for the implementation evidence.

### E7. Phase 2B — Catalog foundations and verified setup generation — COMPLETE (2026-11-08)

> **Emergency audit supersession (E8):** the following is retained history.
> The OLL 56 expansion/reporting claim is incorrect; A fails, B passes, and C
> is OLL 54. Approval was under renewed review at this checkpoint. A separate
> omitted-cross validator defect was fixed. Phase 2C was stopped.
>
> **Final resolution (E9):** the owner approved candidate B,
> `r U r' (U R U' R')2 r U' r'`, as the OLL 56 default. F13 is resolved. The
> earlier A/C/D strings and their explanations remain preserved below.

**Status:** Phase 2B infrastructure is complete and verified. Full Phase 2
content and diagrams (Phase 2C) are **not** complete. No Training UI, storage,
training persistence, static SVG catalog, or third-party algorithm data was
added. The approved catalog content remains gated by F12 (F13 is resolved by
E9).

#### E7.1 Implemented modules

All modules are pure TypeScript under `src/lib/training/` and reuse the Phase 1
`cubing.js` 3×3×3 KPuzzle/KPattern model.

| Module | Responsibility |
| --- | --- |
| `notation.ts` | Phase 1 strict parser unchanged. Adds `parseCatalogAlgorithm`/`normalizeCatalogAlgorithm`/`expandAlgorithmGroups`: nested `(...)n` expansion (1–9), compact source runs, lowercase wide moves, prime-before-2 spellings, explicit rejection of malformed/unsupported notation. |
| `frame.ts` | Deterministic 24-member whole-cube rotation group; `normalizeStateFrame` and `normalizeAlgorithmFrame`; exact equivalence check between the original effect plus regrip and the frame-normalized notation. Rotations are never silently discarded. |
| `pllIdentity.ts` | Raw PLL signature versus Phase 1 post-AUF canonical signature versus the pre-AUF × permutation × post-AUF named identity. `identifyPllCase` maps to the 22 standard named classes and rejects invalid states. |
| `caseState.ts` | Constructs representative cube states from OLL orientation/PLL permutation signatures; asserts case identity without serialized cubie data. |
| `catalog/types.ts` | Stable case/algorithm IDs, algorithm versions/replacement links, defaults/alternatives/generators, provenance/correction/approval metadata, verification metadata, diagram asset references, catalog version and explicit content status. |
| `catalog/pllCases.ts` | The 21 standard PLL identities plus PLL skip, with canonical double-coset signatures and family groups. No algorithms. |
| `catalog/ollCases.ts` | Stable `oll:1`–`oll:57`/`oll:skip` ID helpers and a case-definition builder. The complete 57-case named table is intentionally not bundled. |
| `catalog/validation.ts` | Duplicate/referential-integrity checks, algorithm revision invariants, provenance/correction checks, PLL identity checks, bundled-vs-user separation, and the bundled-content redistribution gate. Reports all issues rather than concealing them. |
| `catalog/stateValidation.ts` | Reconstructs OLL/PLL case representatives and re-verifies catalog algorithms against the cube model, catching non-canonical signatures or stale/false verification metadata after structural validation. |
| `algorithms.ts` | `trainingAlgorithmId`, exact case verification, up-to-AUF checks, and stable algorithm revision helpers. |
| `setupGeneration.ts` | Execution-only and recognition setup generation with exact cube-state verification, fixed precursors, pre-AUF variants, bounded candidate retries, and no fallback case. |

#### E7.2 PLL identity findings and resolution

- `pllPermutationSignature` remains the raw position→piece signature.
- `canonicalPllSignature` remains the Phase 1 post-AUF-only signature: all 288
  valid permutation states still form **72** classes. Its meaning was not
  changed.
- `pllDoubleCosetSignature`/`identifyPllCase` implement the standard named
  identity under pre-AUF × permutation × post-AUF:
  **288 states → exactly 22 classes** — 21 named PLL cases plus PLL skip.
- The skip class contains 4 states (solved plus three U AUFs). All 21 named
  non-skip IDs occur.
- Named identity is stable under all pre-AUF and post-AUF variants. The tests
  exercise all eight single pre/post variants for every one of the 288 states and
  all 16 combinations for one representative of each class.
- All 21 independently constructed named PLL algorithms in the Phase 1 test
  fixture map to their intended names after frame normalization, including Aa,
  Ab, E, H, Z and other rotation/slice-sensitive algorithms.
- Invalid F2L/orientation/frame states are rejected; they are not assigned a
  misleading name.

#### E7.3 Cube-frame decisions

- Frame normalization is state-based: find the unique whole-cube rotation that
  restores the centers, then append its inverse to the notation. This is not a
  string heuristic and does not delete rotations.
- The 24 whole-cube rotations are generated deterministically from `x`/`y`/`z`
  and cached per cube model.
- `normalizeAlgorithmFrame` verifies that the original normalized algorithm plus
  the regrip correction produces exactly the same state as the normalized
  result. Ambiguous or impossible frames are rejected.
- Wide, slice, rotation, group, compact, and prime-before-2 source notation is
  supported. Malformed/unsupported notation fails before cube application.
- PLL identity is evaluated only after frame normalization; a changed frame is
  not treated as a different PLL case.

#### E7.4 Setup-generation logic

- A catalog algorithm is interpreted as an algorithm that **solves** its case.
  The setup to that case is the inverse of its frame-normalized notation.
- `target = pre-AUF(caseState, U^k)`; execution-only returns that setup.
- OLL recognition appends exactly `I⁻¹ = R U R' U'` to the setup. Verification
  asserts the fixed split-FR pre-state (DFR at UFR orientation 2, FR at UR
  orientation 0), exactly three solved F2L slots, prescribed insertion return,
  and F2L solved in the target.
- PLL recognition appends exactly `Q⁻¹ = R U2 R' U' R U' R'` for the fixed Sune
  precursor. Verification asserts F2L solved in the pre-state, the Sune OLL
  pre-state, non-PLL orientation, and exact Sune return to the target.
- Every setup is reapplied to the cube model. The selected case identity,
  standard frame, exact target, F2L status, and algorithm-solves-target-up-to-AUF
  checks must pass. Candidate failure is bounded; no unverified scramble and no
  different-case fallback is returned.
- Recognition output identifies `targetHidden: true` for the future UI. No UI
  was implemented.

#### E7.5 Test evidence

Commands run from the repository root with Node 22.23.2:

```bash
npm run typecheck
npm run lint
npm test -- src/lib/training/notation.test.ts \
  src/lib/training/cube3.test.ts \
  src/lib/training/caseSignature.test.ts \
  src/lib/training/frame.test.ts \
  src/lib/training/pllIdentity.test.ts \
  src/lib/training/catalog/catalog.test.ts \
  src/lib/training/setupGeneration.test.ts
```

Results:

- `npm run typecheck`: passed.
- `npm run lint`: passed; the pre-existing
  `src/components/SessionPanel.tsx:566` `Date.now` purity warning remains. No new
  warning.
- Focused Vitest: **77/77 tests passed across 7 files** (the 28 Phase 1 tests
  plus 49 Phase 2B tests).
- No Playwright/E2E, production build, or manual UI inspection was run. Phase 2B
  changed only pure training modules and tests; no application UI, Timer,
  persistence, network, or dependency code changed.

**External source verification (temporary, outside the repository):**
`/tmp/opencode/phase2b_verify_external.mjs` loaded the implemented modules with
Vite SSR and read the approved local sources only as references. It copied no
algorithm data into the repository.

- **OLL: 56/57 approved defaults verify.** OLL 45's approved correction matches
  reference `0012|1010`. The other 55 source defaults match their reference
  signatures. **OLL 56 as approved in E6.7 does not match** the reference
  `1212|1010`; it produces `1212|0110`. The Phase 2A/source-group variant
  `r U r' (U R U' R')2 r U' r` matches `1212|1010`. See F13.
- **PLL: 21/21 approved defaults verify** against the standard named identity.
  **All 37 additional slash variants also verify** and remain unapproved
  alternatives.
- The original OLL 45 and OLL 56 source strings are rejected by the cube-state
  check, confirming the need for corrections.

#### E7.6 Limits and non-claims

- No complete production 78-case catalog exists. The 22 PLL identity records are
  mathematical case definitions only; no OLL named table or algorithm records are
  bundled.
- No static SVG diagrams, Training page/sidebar, result panel, algorithm
  selection UI, presets, attempts, persistence, calibration, statistics,
  practice visits, reports, cloud sync, or backup changes were implemented.
- Phase 2B does not resolve F12. Bundled records with unresolved redistribution
  are rejected by catalog validation.
- OLL 56 was blocked by F13 at this checkpoint; E9 records the owner's final
  approval of B and 57/57 OLL verification. Do not claim a complete Phase 2
  catalog from this historical checkpoint alone.
- Passing representative fixtures is not production catalog validation.

---

### E8. Emergency independent algorithm verification audit — 2026-11-08

**Checkpoint finding (superseded by E9):** Phase 2C was stopped at this audit.
Earlier approvals and E6/E7 verification claims below are historical records, not
current assurance. OLL 56 approval and mathematical verification were under
renewed review at that time. No algorithm was replaced, no alternative promoted,
and no Phase 2C work was performed by the audit itself.

#### E8.1 Confirmed OLL 56 results and root cause

The latest owner-stated approval in this emergency request is candidate A. E6.7
historically records candidate C. Preserve both; neither establishes a correct
OLL 56 default. Exact repetitions and primes matter:

| Candidate | Exact normalized expansion | Finding |
| --- | --- | --- |
| A (latest stated approval) | `Rw U Rw' U R U' R' U R U' R' Rw U' Rw` | **INCORRECT**: net x2 frame; F2L broken even after frame restoration |
| B (independent references) | `Rw U Rw' U R U' R' U R U' R' Rw U' Rw'` | **VERIFIED** as OLL 56; no net frame; canonical `1212\|1010` |
| C (historical E6.7 approval) | `Rw U Rw' R U R' U' R U R' U' Rw U' Rw'` | **INCORRECT for OLL 56**: valid OLL 54, canonical `1212\|0110` |
| D (literal Heroor source) | `Rw U Rw' U R U' R' U R U' R' Rw' U' Rw'` | **INCORRECT**: net x2 frame; breaks F2L |

**Confirmed reporting error:** preserved `/tmp/opencode/generate_report.py:38`
writes a compact correction ending `r'` but drops that prime in its expanded
`Rw` sequence. E6.4 copied the inconsistent expansion; E6.7 later calls that
expansion a verified equivalent. The preserved Phase 2B external script actually
tests **B** as `OLL_56_E6_VARIANT`; its saved output says B passes. It tests C
as the prompt approval and correctly records a mismatch. There is no preserved
executed evidence that A passed the guarded OLL signature API. The earlier
narrative incorrectly attached B's evidence to A's notation. This does not
justify claiming the production parser lost a prime: both independent parsers
preserve it correctly.

A's first-four twist/flip diagnostics happen to read `1212|1010`, even with
lower-layer pieces displaced. Those digits alone are **not a valid OLL state
signature**. `canonicalOllSignature` rejects A because F2L is broken. The full
raw, frame-normalized, AUF-min diagnostic digits, cubie arrays and all four
reference-AUF outcomes for A/B/C/D are in the local report/results below. No
permissive canonicalization was added. Candidate B correctly orients the
independent OLL 56 state with F2L preserved; any remaining PLL is permissible
for OLL. A/D cannot be repaired by PLL/AUF; C fails orientation at every AUF.

**Recommendation, not adoption:** `r U r' (U R U' R')2 r U' r'` (B). It is
independently listed as OLL 56 by [Speedsolving Wiki](https://www.speedsolving.com/wiki/index.php/OLL)
and [SpeedCubeDB](https://www.speedcubedb.com/a/3x3/OLL/OLL_56), and agrees with
the independently numbered J Perm case. Renewed owner approval is still needed;
do not silently change the default.

#### E8.2 Independent paths and complete collection results

1. Existing CubeLab/cubing.js: production parser, KPuzzle, guarded OLL/PLL
   identity, frame normalization and `verifyAlgorithmForCase`.
2. New **audit-only** `src/lib/training/audit/stickerCube.ts`: own recursive
   notation scanner, 54 labeled stickers, right-handed integer coordinates,
   explicit -90-degree clockwise rotations seen from outside each face,
   geometrically specified wide/slice/whole-cube moves, inverse sequences,
   24 proper center frames, all F2L stickers including cross, and color-based
   orientation/solved checks. This path imports neither cubing.js nor production
   Training helpers. Cubie extraction is only a cross-engine diagnostic; the
   physical solve checks inspect sticker colors directly.

Fresh independent numbered references came from [J Perm OLL](https://jperm.net/algs/oll)
and [PLL](https://jperm.net/algs/pll) public definition scripts, downloaded only
to `/tmp`. Their algorithms establish known reference states in the geometric
engine; they are not Heroor/Tao source diagrams or source algorithms used to
validate themselves. Candidates are physically applied to independent reference
states under all four starting AUFs; PLL also tests all four final AUFs and four
y color-frame conjugations. A fixed OLL 56 regression additionally constructs
stickers directly from twists `1212`/flips `1010`, without candidate inversion.

- **77/78 stated defaults pass:** **56/57 OLL**, including the approved OLL 45
  correction; **21/21 PLL**. OLL 56 A is the sole incorrect current default.
- **37/37 additional PLL variants pass separately**; none becomes a default.
- No additional wrong names, inverse cases, or hidden setup failures were found.
- OLL 36 needs an explicit x frame correction. PLL Ga/Gc/Gd/V need explicit y
  corrections. These five passing defaults are **VALID BUT DIFFERENT
  CONVENTION**; the other 72 passing defaults are **VERIFIED**. Raw net frames
  and corrections are recorded per row. OLL 56 A is **INCORRECT**, not a frame
  convention. No current default is classified INCONCLUSIVE by these tests.
- All **54 primitive move variants** match both engines, including wide moves,
  M/E/S directions and x/y/z. A mixed noncommuting composition and inverse
  checks agree. Every audited full corner/edge state agrees (zero mismatches).
- Independent exhaustive enumeration gives **216 OLL orientations / 58 AUF
  classes including skip** and **288 PLL permutations / 22 named classes
  including skip**. The independent numerical PLL equivalence and current
  classifier are one-to-one across all 288 states: no extra inverse merging.
- The fresh reference has **57 distinct non-skip OLL identities**, numbered
  1–57. With B considered separately, every identity is represented exactly
  once. With A retained, OLL 56 is missing; do not claim 57/57 approved defaults.
- Source revisions confirmed unchanged: Heroor
  `e1cba6995f3ff27732ac18c767e7e9ca1343f13a`, Tao
  `cb95945c3e4839ee1e4b058d4a79bc022615b220`. Input SHA-256 hashes are in the
  generated report and results. Original source and approved strings remain
  separate; original OLL 45's wide `f'` still fails.

The complete **78-row default table**, **37-row alternative table**, and detailed
A/B/C/D findings are deliberately outside the repository:

- `/tmp/cubelab-training-audit/REPORT.md`
- `/tmp/cubelab-training-audit/results.json`

These are private local audit artifacts, not a bundled/published dataset; `/tmp`
is transient. `scripts/audit-training.mjs` is retained for reproducibility and
contains no full source/reference dataset. It reads local clones and transient
reference scripts, retains original/normalized notation, records exact-listed
versus independently valid alternative agreement for each row, and writes only
to the chosen audit output directory (default above). Source data must not be
copied into the repository. Existing `/tmp/opencode/` evidence was untouched.

#### E8.3 Separate confirmed validator false positive and minimal fix

`cube3.ts:isF2lSolved` previously used only `f2lSlotStatuses`, checking four
corner/edge pairs but omitting DF/DR/DB/DL. A legal isolated bottom-edge
three-cycle leaves all pairs home. B followed by
`x2 M2 U M U2 M' U M2 x2` was reproduced obtaining `status: verified` from
`verifyAlgorithmForCase`, despite breaking the cross. This is distinct from
A's reporting error: the current guarded API already rejected A before editing.

The new regression failed before the fix. The minimal fix checks every
`F2L_CORNER_PIECES` and `F2L_EDGE_PIECES` entry. This tightens the verification
utility only; no application UI, storage, algorithms/defaults or onboarding
behavior was changed.

Existing round-trip/setup tests establish return to an algorithm's own inverse,
which is algebraically true for any sequence. Several OLL fixture definitions
in `setupGeneration.test.ts:ollCaseFromAlgorithm` derive expected identity from
the same algorithm; they cannot independently establish numbering. Existing
77-test coverage also had no isolated cross-corruption fixture. New tests use
fixed external identity, directly specified sticker states and independent
permutation enumeration. Invalid twists, physically impossible center frames,
move order, prime preservation and cross corruption are explicitly rejected.
Structural `validateCube3State` remains a structural-invariant check, not a full
supercube reachability proof; downstream frame/case gates reject impossible
center arrangements. Ordinary 3x3 center markings are not modeled as visible
supercube markings.

#### E8.4 Verification, limits and next action

Node 22.23.2, suites sequential:

- `npm test -- src/lib/training/audit/emergencyAudit.test.ts`: initial **8/9**
  passed, exposing the cross defect; **9/9** after the minimal fix. One further
  OLL 45 regression was then added.
- `node scripts/audit-training.mjs`: complete external-source audit passed its
  independent consistency checks; 77 defaults pass, A fails, B passes, C/D fail
  for OLL 56; all 37 alternatives pass; no parser/state disagreements.
- `npm test -- src/lib/training`: **87/87 passed across 8 files**, including
  all 77 existing tests and 10 new emergency regressions. An earlier run after
  the cross fix and before the OLL 45 regression passed 86/86.
- `npm run typecheck`: passed. `npm run lint`: passed with only the pre-existing
  `SessionPanel.tsx:566` purity warning. A newly introduced audit-script unused
  binding warning was fixed and lint rerun successfully.
- `git diff --check`: passed; new audit source/report paths checked.
- Intentionally skipped Playwright/E2E, production build, full app suite and live
  Drive tests: only pure Training math, audit scripts/tests and Training docs
  changed; no UI, storage, destructive path, worker or runtime wiring changed.

No physical hand-execution of all algorithms was performed. This audit supports
the verified move conventions and the passing named cases computationally; it
is not an unconditional proof of every future Training operation. Licensing
remains unresolved (F12): owner approval is not redistribution permission;
reference files/full algorithm tables remain outside the repository. No
additional dependencies, full datasets, UI/storage, commits, pushes, deployments
or publication were added. Existing uncommitted work was preserved.

**Immediate next action at this checkpoint:** owner review of this report and
renewed OLL 56 approval; resolve rights separately. Mathematical foundation
needed the cross fix and independent evidence above. Phase 2C remained stopped
at that checkpoint; E9 records the later owner approval and preview authorization.

---

### E9. Final independent verification and Phase 2C preview checkpoint — 2026-11-08

**Status:** Final OLL 56 decision recorded; F13 resolved. Phase 2C case
definitions and the ten-diagram preview checkpoint are complete. The remaining
68 diagrams are intentionally not generated until owner visual approval. F12
(redistribution rights for third-party algorithm data) remains unresolved.

#### E9.1 Final OLL 56 owner approval and preserved decision history

**CONFIRMED owner decision (2026-11-08):** the final OLL 56 default is

```text
r U r' (U R U' R')2 r U' r'
```

Expanded normalized notation:
`Rw U Rw' U R U' R' U R U' R' Rw U' Rw'`. It preserves F2L, has no net frame
correction, and has canonical orientation signature `1212|1010`. J Perm and the
Speedsolving Wiki publish the same complete sequence. Owner approval of this
string resolves F13.

The earlier approvals and rejected strings remain part of the decision history:

| Version | Exact normalized expansion | Verified result |
| --- | --- | --- |
| **B — final approved default** | `Rw U Rw' U R U' R' U R U' R' Rw U' Rw'` | **VALID OLL 56**; F2L preserved; no net frame; `1212\|1010` |
| A — latest earlier approval | `Rw U Rw' U R U' R' U R U' R' Rw U' Rw` | **INCORRECT**; net x2 frame; F2L broken even after frame restoration |
| C — historical E6.7 approval | `Rw U Rw' R U R' U' R U R' U' Rw U' Rw'` | **INCORRECT for OLL 56**; valid OLL 54; `1212\|0110` |
| D — literal Heroor source | `Rw U Rw' U R U' R' U R U' R' Rw' U' Rw'` | **INCORRECT**; net x2 frame; F2L broken after frame restoration |

The root cause of the earlier false approval is preserved: a report-generation
transcription converted B's final `Rw'` into `Rw`, then attached B's successful
evidence to the mistyped A expansion. Candidate A's partial top-layer digits can
look like `1212|1010` while lower layers are broken; those diagnostic digits are
not a valid OLL identity. Candidate C changes both repeated triggers from
`U R U' R'` to `R U R' U'`, producing OLL 54. Do not rewrite this history to
make earlier approvals appear correct.

The approved OLL 45 correction remains `F R U R' U' F'` and verifies as
`0012|1010`.

#### E9.2 Final independent verification evidence

**Evidence inspected by this session:**

- Final report, read in full:
  `/home/joshua/.codex/visualizations/2026/11/08/01a1bd50-880d-7ce3-b6ab-2641e4a99706/CubeLab-algorithm-verification.md`.
- Machine-readable evidence from the same review:
  `/home/joshua/.codex/visualizations/2026/11/08/01a1bd50-880d-7ce3-b6ab-2641e4a99706/CubeLab-algorithm-evidence.json`.
- Earlier independent audit report structure and complete result rows:
  `/tmp/cubelab-training-audit/REPORT.md` and
  `/tmp/cubelab-training-audit/results.json` were accessible and consulted.
  The final report was the controlling source for the approved OLL 56 choice;
  the earlier results supplied the 57 independently established canonical OLL
  signatures used to build the Phase 2C table.

**Independent methodology reported by the final review:**

1. Production path: CubeLab notation, `cubing.js` KPuzzle, frame normalization,
   guarded OLL/PLL identity and `verifyAlgorithmForCase`.
2. Independent path: the existing audit-only 54-sticker Euclidean model
   (`src/lib/training/audit/stickerCube.ts`) with its own notation scanner,
   right-handed coordinates, explicit wide/slice/whole-cube rotations, inverse
   sequences, 24 proper center frames, and F2L checks including the D cross. It
   imports neither `cubing.js` nor production Training helpers.
3. Fresh public references: J Perm OLL/PLL definition scripts downloaded over
   HTTPS, plus current Speedsolving Wiki OLL/PLL case content via browser
   retrieval. The Wiki's direct HTTP response was 403; the readable browser
   representation was used. Every numbered OLL and named PLL case had at least
   one independently case-matching Wiki algorithm.
4. Selected algorithms were applied to independently constructed reference
   states under all four starting AUFs. PLL additionally checked four `y`
   color-frame conjugations and all four final AUFs. OLL allowed residual PLL;
   PLL had to solve completely after AUF. Frame corrections were physical
   rotations, not recoloring.
5. The independent set contains 57 distinct non-skip OLL identities with B and
   21 distinct named PLL identities. The 37 additional PLL variants were checked
   separately and remain excluded from default counts.

**Final reported results:**

- **78/78 selected defaults mathematically valid:** 57 OLL (with B) and 21 PLL.
- Online comparison: **35 exact matches, 29 equivalent notation/AUF matches,
  14 different but valid algorithms, 0 conflicting/not found, 0 incorrect,
  0 unverified.**
- Two independent cube-state approaches agreed on all 54 primitive move variants
  and full corner/edge arrays, with zero full-state disagreements.
- The independent review additionally reported **59/59 focused tests in six
  files**.
- SpeedCubeDB timed out repeatedly and was not counted as evidence. A
  SpeedcubeQuest URL probe was inaccessible. CubeSkills was not used as an
  additional source. No publication-origin independence or redistribution
  permission is inferred from mathematical correctness.

The final review was research-only and did not install B or change repository
code. This session did not re-run the external 78/78 online comparison; it
consumed the independent report and result tables, then locally re-derived the
complete 216-state/58-class OLL space and 288-state/22-class PLL space and
validated every Phase 2C representative against them.

#### E9.3 Phase 2C standard case definitions

**Added:** `src/lib/training/catalog/standardCases.ts`.

- **57 OLL cases** with stable `oll:1`–`oll:57` IDs, canonical orientation
  signatures, deterministic representative states, and no algorithm content.
  The 57 signatures exactly cover the 57 non-skip classes of the 216 legal
  orientation states. OLL 45/56/57 are pinned to `0012|1010`, `1212|1010`, and
  `0000|0101`.
- **21 PLL named cases** (`Aa`, `Ab`, `E`, `F`, `Ga`, `Gb`, `Gc`, `Gd`, `H`,
  `Ja`, `Jb`, `Na`, `Nb`, `Ra`, `Rb`, `T`, `Ua`, `Ub`, `V`, `Y`, `Z`) with the
  existing double-coset identity as `canonicalSignature`.
- **Separate PLL diagram representatives.** The named double-coset identity is
  not changed. A conventional raw representative is stored per case so the
  diagram shows the standard cycle shape (edge-only, corner-only, 2+2 swap, or
  3+3 cycle) rather than an arbitrary double-coset member. For example, T is
  rendered as UFR↔UBR corners plus UR↔UL edges, not the lexicographic
  double-coset 3-cycle.
- **AUF metadata:** OLL records orientation identity up to AUF; PLL records
  explicit pre-AUF × permutation × post-AUF classification. All 78 use the same
  top-down standard-frame viewing orientation.
- **Families:** PLL reuses the independently established named groups. OLL uses
  a deterministic edge-orientation grouping (`edge-pattern-cross`,
  `edge-pattern-line`, `edge-pattern-l`, `edge-pattern-dot`), not a copied
  presentation taxonomy.
- **No bundled algorithms and no third-party diagrams.** The table contains only
  standard names/numbers, mathematical signatures, representative states, AUF
  metadata and static-asset references. The bundling gate remains closed.

The table validator rejects duplicate IDs/signatures/assets/representatives,
invalid paths, missing representatives, wrong OLL anchors, PLL representative
mismatches, wrong AUF metadata, skip/selectable errors, and any bundled algorithm
IDs.

#### E9.4 Diagram architecture and static previews

The development-time pipeline is:

| File | Role |
| --- | --- |
| `src/lib/training/diagrams/facelets.ts` | Derives all 54 facelets and the 21 last-layer stickers (nine U-face cells plus twelve side stickers) from the existing `cubing.js` pattern data. Presentation mapping only; no second simulator. |
| `src/lib/training/diagrams/arrows.ts` | Derives each moving U-layer corner/edge arrow from position→piece data and exposes deterministic cycles. |
| `src/lib/training/diagrams/buildDiagramSpec.ts` | Builds the representative, re-verifies case identity, validates facelets/arrows, and rejects malformed or ambiguous specs. |
| `scripts/training/renderDiagram.mjs` | Deterministic 128×128 SVG serializer, safety checks, and contact-sheet renderer. |
| `scripts/training/generate-diagrams.mjs` | Vite-SSR CLI: `--preview`, `--all`, `--check`, `--dry-run`. Writes only after all selected specs build and validate. |

**Static design system (redesigned after owner review; awaiting final approval):**

- 128×128 viewBox, compact 3×3 last-layer diagram; no gradients, glows, shadows,
  filters, scripts, external links or runtime generation.
- The 3×3 top face uses 24 px square cells, a 4 px black grid/outer border and
  sharp corners. The black grid is a single background rectangle, not rounded
  per-sticker tiles.
- OLL: yellow = U sticker facing up; neutral gray = other top-face sticker. Only
  sideways-facing U stickers produce thin yellow bars outside the grid at their
  adjacent corner/edge positions. No gray side stickers and no full outer
  sticker grid are drawn.
- PLL: all nine top-face cells are yellow. Thin side bars show the actual
  permuted side stickers in green (front), red (right), blue (back) and orange
  (left); the bars are not filled with each side's solved colour.
- PLL arrows are black. Two-cycles use one double-headed arrow between the two
  pieces. Three-cycles use directed arrows, with corner arrows drawn bolder in an
  outer lane and edge arrows thinner in the inner lane. A yellow casing separates
  arrow paths from the black grid. No purple/teal arrow palette remains.
- The back strip is displayed left-to-right as **UBL, UB, UBR** above the U face,
  matching the physical top-down adjacent positions. The earlier UBR/UB/UBL
  presentation order was corrected; it is presentation-only and does not change
  any case signature.
- Accessible `<title>`/`<desc>`, `role="img"`, `aria-labelledby`, case ID,
  canonical signature, representative signature, viewing orientation and
  `data-diagram-style="compact-3x3"` as SVG metadata.
- Palette contrast: black grid/arrows on yellow ≥4.5:1; black on neutral
  ≥4.5:1; black against the side colours ≥3:1.
- The G permutations remain the densest diagrams by nature: two interleaved
  three-cycles. The bolder corner/outer lane and thinner edge/inner lane keep
  every arrow individually traceable at 128 px. Gc remains busy at 64 px; no
  arrow was omitted. A future per-case arrow-layout override is the proposed
  remedy if the owner wants a cleaner 64 px G diagram.

**Generated previews (10 of 78):**

- OLL 1, 27, 45, 56, 57.
- PLL Ua, T, Gc, H, Z.
- SVG assets: `src/assets/training/diagrams/oll/` and
  `src/assets/training/diagrams/pll/`.
- Contact sheet: `docs/training/previews/phase-2c-diagrams.html` (light and dark
  surfaces; every case shown at 128×128 and 64×64).
- The generator's `--all --dry-run` path rendered all 78 in memory; the
  remaining 68 files were deliberately not written.

**Phase 2C test evidence at the original 5×5 checkpoint (historical; the
redesigned compact 3×3 evidence is in E9.6):**

- `npm run typecheck`: passed.
- `npm run lint`: passed with only the pre-existing
  `src/components/SessionPanel.tsx:566` `Date.now` purity warning.
- `npm test -- src/lib/training`: **118/118 tests across 11 files**, including
  the Phase 1/2B regressions and the new case/diagram tests.
- `npm test -- src/lib/training/diagrams/svgAssets.test.ts scripts/training/renderDiagram.test.mjs`:
  **9/9 tests**.
- `node scripts/training/generate-diagrams.mjs --preview --check`: passed.
- `node scripts/training/generate-diagrams.mjs --all --dry-run`: rendered 78.
- SVG tests verify content, not merely existence: 54-facelet round-trip against
  the independent audit model for all 78 cases, OLL yellow masks and side-facing
  counts, PLL named identity and 16 pre/post-AUF variants, exact arrow
  start/end mapping, conventional PLL cycle shapes, 21 sticker cells per SVG,
  dimensions/viewBox, accessible metadata, absence of executable/external
  content, contrast thresholds, asset-to-case mapping, and deterministic
  regeneration.
- Negative tests deliberately corrupt stickers, arrows, signatures, kinds,
  duplicate mappings, unsafe SVG markup, and representative identities; each is
  rejected.
- Playwright/E2E, production build and live Drive validation were intentionally
  skipped: no runtime application behavior, Timer, persistence, worker or
  network path changed.

#### E9.5 Licensing separation and exact remaining work

F12 is **still unresolved**. The approved OLL/PLL default algorithm strings were
not copied into the repository or bundled. The Phase 2C case table stores only
mathematical identities and standard identifiers; diagrams are generated from
states, not from third-party artwork. Passing verification does not grant
redistribution rights.

Remaining Phase 2C work after owner visual approval:

1. Run `node scripts/training/generate-diagrams.mjs --all` to write the remaining
   68 assets.
2. Run `--all --check` and extend SVG integrity/content tests from the 10
   previews to all 78 committed assets.
3. Visually review all 78 at desktop/narrow and light/dark surfaces.
4. Keep algorithm records and any additional PLL alternatives unbundled until
   F12 is resolved. The 37 additional PLL variants remain verified but not
   approved defaults.
5. Do not begin Phase 3 or Training UI/persistence work.

#### E9.6 Phase 2C compact 3×3 diagram redesign after owner review — 2026-11-08

**Owner decision:** the original Phase 2C 5×5 cross-shaped previews were
reviewed and **rejected**. The owner selected the traditional compact 3×3
CubeSkills-style presentation for OLL and PLL. The verified case definitions,
cube mathematics, signatures and approved algorithms were not changed. The
OLL-only follow-up refinement is recorded in E9.7 and corrected in E9.8; PLL
remains at this checkpoint.

**Internal design references (not application assets):**

- OLL: `docs/training/references/cubeskills-oll-style.png`
- PLL: `docs/training/references/cubeskills-pll-style.png`

The reference images are local design references only. They are not copied,
embedded, moved, renamed, recreated, modified or redistributed. The SVG assets
are independently generated from verified CubeLab cube states; no third-party
artwork or algorithm dataset is bundled.

**Redesigned renderer:**

- `scripts/training/renderDiagram.mjs` now emits the compact 3×3 layout:
  a 24 px cell grid with a 4 px black grid/outer border, sharp corners, thin
  side bars, actual PLL side colours and black permutation arrows.
- OLL side bars are derived only from side facelets whose colour is `U`. PLL side
  bars are derived from all 12 side facelets and use the actual permuted colours.
- `src/lib/training/diagrams/facelets.ts` now presents the back strip
  left-to-right as **UBL, UB, UBR**, which is the physical top-down order. The
  previous UBR/UB/UBL display order was corrected. No case signature changed.
- PLL 2-cycles use a single double-headed arrow. 3-cycles use directed arrows;
  corner arrows use a bolder outer lane and edge arrows a thinner inner lane.
  All movement/destination data still comes from `lastLayerPermutationArrows`.
- The Gc preview is intentionally retained as the hard representative. Its two
  interleaved 3-cycles remain dense at 64 px, but no arrow is omitted or
  inverted. If the owner requires a cleaner G diagram, the proposed next step is
  a per-case arrow-layout override, not a change to the permutation data.

**Verification at this redesign checkpoint:**

- `npm test -- src/lib/training`: **120/120 tests across 11 files** passed.
- `npm test -- src/lib/training/diagrams/diagrams.test.ts src/lib/training/diagrams/svgAssets.test.ts scripts/training/renderDiagram.test.mjs`: **28/28 tests across 3 files** passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with only the pre-existing `SessionPanel.tsx:566`
  `Date.now` purity warning.
- `node scripts/training/generate-diagrams.mjs --preview --check`: passed.
- `node scripts/training/generate-diagrams.mjs --all --dry-run`: rendered 78 in
  memory; no remaining files were written.
- `git diff --check`: passed.
- No Playwright/E2E, production build or live Drive validation was run because no
  runtime application behavior, Timer, persistence, worker or network path
  changed.

**Current approval state at the E9.6 checkpoint:** the redesigned ten-preview
checkpoint required final owner visual approval. The remaining 68 SVGs must not
be generated until that approval is explicit. F12 remains unresolved and is
unaffected by the visual redesign.

#### E9.7 OLL-only visual refinement pass — 2026-11-08

**Status:** Superseded by E9.8 (2026-11-09). This pass thinned only the internal
dividers and kept the outer border bold, which still misinterpreted the owner's
request. It is retained as history. PLL is unchanged, and **PLL review is
deferred until the OLL style is approved**.

**Owner-requested OLL-only changes:**

- Make the internal divider lines between the nine stickers thinner while
  keeping the outer cube border bold.
- Use a brighter, more vivid yellow for U stickers and sideways-facing U bars.
- Keep non-yellow stickers neutral gray; do not use gradients or glossy effects.
- Keep the compact 3×3 structure, side-bar representation and sharp square
  geometry.
- Preserve every mathematically derived sticker/bar position. This is a
  style/proportion/colour refinement only.
- Do not change case identities, signatures, representative states, algorithm
  approvals, case mathematics, preview case selection, Training logic, SVG
  safety/accessibility rules or generator determinism.
- Do not change PLL.

**OLL rendering changes:**

- OLL face: 96 px square at `(16, 16)`, 28 px cells, 30 px cell step, 4 px outer
  border and **2 px internal dividers**. The previous OLL layout used an 88 px
  face, 24 px cells and a 4 px divider.
- OLL side bars: 5.5 px thick, 28 px long, 1.5 px black outline, 4 px
  rectangle-edge gap from the cube (about 3.25 px visible gap).
- OLL yellow changed from `#F2C230` to **`#FFF200`** for both stickers and side
  bars. Neutral gray remains `#C3CBD3`; the grid remains `#111418`. No gradients
  or gloss.
- PLL is unchanged: 88 px face at `(20, 20)`, 24 px cells, 4 px grid, 6.5 px
  bars with a 2 px outline, and U yellow `#F2C230`. Its renderer geometry and
  palette values are unchanged, and the committed PLL preview assets retain their
  previous content.

**Scope and output:**

- Regenerated only `oll-01.svg`, `oll-27.svg`, `oll-45.svg`, `oll-56.svg` and
  `oll-57.svg`, plus the preview contact sheet.
- The other 68 static SVGs were not generated.
- No Training UI, storage, algorithm catalog or PLL asset was changed.

**Verification (2026-11-08):**

- `npm test -- src/lib/training`: **120/120 tests across 11 files** passed.
- `npm test -- src/lib/training/diagrams/diagrams.test.ts src/lib/training/diagrams/svgAssets.test.ts scripts/training/renderDiagram.test.mjs`:
  **29/29 tests across 3 files** passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with only the pre-existing `SessionPanel.tsx:566`
  `Date.now` purity warning.
- `node scripts/training/generate-diagrams.mjs --preview --check`: passed
  (10 previews and the contact sheet).
- `git diff --check`: passed.
- No Playwright/E2E, production build or live Drive validation was run because
  no runtime application behavior, Timer, persistence, worker or network path
  changed. Mathematical case identities and generator determinism are unchanged.

**Correction (2026-11-09):** the owner clarified that this interpretation was
still wrong. The requested lighter weight applies to the **whole central 3×3
face**, not only the internal dividers; the outer border must match the internal
grid. The E9.7 96 px/4 px/2 px OLL geometry is superseded by E9.8.

#### E9.8 OLL stroke-weight correction — 2026-11-09

**Status:** In progress; awaiting owner review of the corrected OLL previews.
PLL is unchanged, and **PLL review is deferred until the OLL style is approved**.

**Owner correction:**

- The prior E9.7 refinement still misunderstood the request. The owner wants the
  entire central 3×3 face, including its **outer border and internal grid lines**,
  to use the lighter/thinner line weight.
- The outer border and internal dividers should match each other in that lighter
  style; the face must remain clear and readable, just less bold overall.
- The outside yellow bars should move **slightly closer** to the 3×3 face and
  have **slightly thinner outlines**.
- Keep the brighter `#FFF200` yellow unless a tiny further adjustment is needed.
- Do not change case identities, signatures, representative states, bar
  positions, algorithm approvals, case mathematics, preview case selection,
  Training logic, deterministic generation or SVG safety/accessibility rules.
- Do not change PLL.

**Corrected OLL rendering:**

- OLL face: **92 px square at `(18, 18)`**, 28 px cells, 30 px cell step,
  **2 px outer border and 2 px internal grid**. The sticker cells remain 28 px at
  the same `(20, 20)`, `(50, ...)`, `(80, ...)` origins; the thinner outer border
  reduces only the surrounding face bounds from 96 px to 92 px.
- OLL side bars: **5 px thick**, 28 px long, **1.25 px black outline**, **3 px
  rectangle-edge gap**. Bars start at 10 px on the top/left and 113 px on the
  bottom/right, remaining symmetric around the 128 px canvas.
- OLL yellow remains **`#FFF200`** for both stickers and side bars. Neutral gray
  remains `#C3CBD3`; the grid remains `#111418`. No gradients or gloss.
- PLL is unchanged: 88 px face at `(20, 20)`, 24 px cells, 4 px grid, 6.5 px bars
  with a 2 px outline, and U yellow `#F2C230`. Its renderer geometry, palette and
  committed SVG assets are unchanged.

**Scope and output:**

- Regenerated only `oll-01.svg`, `oll-27.svg`, `oll-45.svg`, `oll-56.svg` and
  `oll-57.svg`, plus the preview contact sheet.
- The other 68 static SVGs were not generated.
- No Training UI, storage, algorithm catalog or PLL asset was changed. PLL SVG
  SHA-256 hashes matched before and after regeneration.

**Verification (2026-11-09):**

- `npm test -- src/lib/training/diagrams/diagrams.test.ts src/lib/training/diagrams/svgAssets.test.ts scripts/training/renderDiagram.test.mjs`:
  **29/29 tests across 3 files** passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with only the pre-existing `SessionPanel.tsx:566`
  `Date.now` purity warning.
- `node scripts/training/generate-diagrams.mjs --preview --check`: passed
  (10 previews and the contact sheet).
- `git diff --check`: passed.
- No Playwright/E2E, production build or live Drive validation was run because
  no runtime application behavior, Timer, persistence, worker or network path
  changed. Mathematical case identities and generator determinism are unchanged.

**Checkpoint note:** the PLL-unchanged statements above describe only the E9.8
OLL-only checkpoint. The owner subsequently resumed PLL review; E9.9 records the
resulting arrow correction and supersedes the temporary PLL deferral.

#### E9.9 PLL arrow length and alignment correction — 2026-11-09

**Status:** Complete; awaiting owner visual review. This follows the E9.8 OLL
stroke-weight checkpoint. The owner reviewed the PLL previews and clarified that
the **T-perm vertical corner-swap arrow is already correct and must not change**;
the horizontal edge-swap arrow is too short, and some PLL arrows are not properly
centred relative to their cubie positions.

**Owner requirements:**

- Preserve the T-perm vertical corner arrow exactly.
- Lengthen the T-perm horizontal double-headed edge-swap arrow and keep it
  vertically centred in its row, with tips closer to the two edge-position
  centres and appropriate clearance.
- Audit Ua, T, Gc, H and Z against the actual U-layer cubie centres:
  edges UB `(64,36)`, UR `(92,64)`, UF `(64,92)`, UL `(36,64)`; corners UBL
  `(36,36)`, UBR `(92,36)`, UFR `(92,92)`, UFL `(36,92)`.
- Keep horizontal arrows on their intended rows, vertical arrows on their
  intended columns, and diagonals on the appropriate centre-to-centre lines.
- Do not shorten arrows unnecessarily or introduce off-centre routing merely to
  avoid overlaps. Preserve the approved Ua/Gc layouts and the T vertical arrow.
- Do not change sticker colours, sticker positions, case signatures, cube
  mathematics, OLL diagrams, case mappings or the 68 ungenerated assets.

**Geometry audit and exact changes:**

- Logical arrow endpoints use the cubie centres above. Visible tips are trimmed
  inward along the arrow direction for clearance. Directed arrows keep the
  established 8 px start trim and 9 px end-tip trim. Corner arrows keep the 5 px
  outward lane. Double-headed corner arrows keep the approved 7 px trim; only
  double-headed edge arrows changed from 7 px to 4 px.
- **Ua:** edge 3-cycle `UF→UR→UL→UF`. The horizontal `UR→UL` arrow is on row
  `y=64`; the diagonals are on the exact centre-to-centre lines. Tips remain at
  `(85.64,70.36)`, `(45,64)` and `(57.64,85.64)`. **Unchanged.**
- **T:** edge 2-cycle `UR↔UL` and corner 2-cycle `UFR↔UBR`. The horizontal edge
  path changed from `M 78 64 L 50 64` to `M 81 64 L 47 64`; its tips moved from
  `(85,64)`/`(43,64)` to `(88,64)`/`(40,64)`, leaving 4 px clearance from the UR
  and UL centres while remaining on row `y=64`. The vertical corner path remains
  exactly `M 97 77 L 97 51` with tips `(97,85)`/`(97,43)`, preserving the
  approved 5 px right lane and 7 px corner trim.
- **Gc:** edge 3-cycle `UR→UB→UL→UR` and corner 3-cycle
  `UFR→UFL→UBL→UFR`. Edge diagonals remain on their centre lines, the horizontal
  `UL→UR` edge arrow remains on row `y=64`, the bottom corner arrow remains in
  the `y=97` outward lane, the left corner arrow remains in the `x=31` outward
  lane, and the diagonal corner arrow remains on the corner centre line. That
  diagonal chord passes through the face centre, so it stays exactly on the
  corner-centre line rather than receiving an arbitrary offset. The overall
  layout is preserved; no Gc arrow changed.
- **H:** edge 2-cycles `UF↔UB` and `UR↔UL`. The vertical path changed from
  `M 64 78 L 64 50` to `M 64 81 L 64 47`; tips moved from `(64,85)`/`(64,43)` to
  `(64,88)`/`(64,40)` on column `x=64`. The horizontal path changed from
  `M 78 64 L 50 64` to `M 81 64 L 47 64`; tips moved from `(85,64)`/`(43,64)` to
  `(88,64)`/`(40,64)` on row `y=64`.
- **Z:** edge 2-cycles `UF↔UR` and `UB↔UL`. The `UF↔UR` path changed from
  `M 73.9 82.1 L 82.1 73.9` to `M 71.78 84.22 L 84.22 71.78`; tips moved from
  `(68.95,87.05)`/`(87.05,68.95)` to `(66.83,89.17)`/`(89.17,66.83)`. The
  `UB↔UL` path changed from `M 54.1 45.9 L 45.9 54.1` to
  `M 56.22 43.78 L 43.78 56.22`; tips moved from
  `(59.05,40.95)`/`(40.95,59.05)` to `(61.17,38.83)`/`(38.83,61.17)`. Both
  remain on their exact diagonal centre lines with 4 px tip clearance.

**Tests added:**

- A renderer regression asserts the exact T edge and corner paths/tips, including
  the unchanged `M 97 77 L 97 51` corner arrow.
- Committed-asset geometry assertions verify that every preview arrow is parallel
  to its logical cubie-centre line, edge arrows stay on the centre line, corner
  arrows use only the approved 0/5 px lanes with any nonzero lane pointing
  outward from the face centre, directed arrows keep 8/9 px trims, double edge
  arrows use 4 px tip clearance, and double corner arrows keep 7 px.
- A 64 px readability assertion checks that every preview arrow shaft is at least
  2 px wide and 6 px long after scaling, and every arrowhead is at least 2 px wide
  and 3 px long after scaling. Manual raster inspection at 128 px and 64 px was
  also performed; the contact sheet renders both light and dark surfaces.

**Verification (2026-11-09):**

- `npm test -- src/lib/training/diagrams/diagrams.test.ts src/lib/training/diagrams/svgAssets.test.ts scripts/training/renderDiagram.test.mjs`:
  **32/32 tests across 3 files** passed.
- `npm test -- src/lib/training`: **122/122 tests across 11 files** passed. This
  includes the two new E9.9 asset assertions added to the previous 120-test set.
- `npm run typecheck`: passed.
- `npm run lint`: passed with only the pre-existing `SessionPanel.tsx:566`
  `Date.now` purity warning.
- `node scripts/training/generate-diagrams.mjs --preview --check`: passed
  (10 previews and the contact sheet).
- `node scripts/training/generate-diagrams.mjs --all --dry-run`: rendered all 78
  in memory; no remaining asset was written.
- `git diff --check`: passed.
- Only `pll-t.svg`, `pll-h.svg` and `pll-z.svg` changed bytes. `pll-ua.svg` and
  `pll-gc.svg` remained byte-identical, as did all five OLL SVGs. The contact
  sheet was regenerated with updated PLL copy. No other diagram, algorithm,
  signature, palette, OLL asset, Training UI, persistence, dependency or
  application file changed.
- No Playwright/E2E, production build or live Drive validation was run because no
  runtime application behavior, Timer, persistence, worker or network path
  changed.

#### E9.10 PLL visual refinement — 2026-11-09

**Status:** Implemented and visually inspected; PLL awaits owner visual approval.
The owner's current request explicitly approves OLL. E9.9 remains historical;
its statement that Ua/Gc needed no changes is superseded by this refinement.
Scope is PLL presentation, the five previews, tests, contact/comparison sheets
and the two Training memory files only. No remaining 68 assets or Phase 3 work.

**Diagnosis:** E9.9 reduced edge-swap tip trim from 7 to 4 SVG units: each tip
moved only 3 px at 128 px, or 1.5 px at 64 px. It changed neither Ua nor Gc,
head sizes, shaft widths nor the muted PLL palette. Shaft endpoints are head
bases, not tips: the old edge head consumed 7 units at each headed end.
Corner-lane offsets do not cancel the length changes; all edge offsets are zero.
The pre-edit `--preview --check` passed. Fresh Chromium rendered the actual
SVGs and decoded all 40 contact-sheet images. There is no evidence of stale
assets or a caching fault. Head dimensions were already path-length-independent;
the inconsistent sizes came from separate edge/corner styles.

**Palette (PLL only; OLL unchanged):**

| Use | Before | After |
| --- | --- | --- |
| U yellow and crossing halos | `#F2C230` | `#FFF200` (approved OLL yellow) |
| F green | `#2E9E4F` | `#00C853` |
| R red | `#D64545` | `#FF3030` |
| B blue | `#3B6FD8` | `#2962FF` |
| L orange | `#E07B1A` | `#FF8A00` |
| Grid/borders/arrows | `#111418` | unchanged |

D remains `#F7F9FB`; neutral remains `#C3CBD3`. Actual facelet colour assignments
and permuted sticker positions are unchanged. No effects, external artwork or
algorithms were added. Existing contrast checks pass for the new palette.

**Shared geometry:** Every arrowhead is now 8 units long × 11 units wide,
independent of direction and path length. Edge heads were 7×9; corner heads
remain 8×11. Shafts are 5.5 units, formerly 4.2 for edges. Only mixed corner/edge
3-cycles retain 4.2-unit inner edge shafts for overlap separation (Gc in this
preview set). Halos remain 3 units wider, using the new top-face yellow.
Double-edge tips have 1-unit clearance instead of 4; double-corner tips retain
7. Directed open-cycle edges use 8-unit tail/2-unit tip clearance instead of
8/9 (Ua); crowded mixed cycles keep 8/9 (Gc). Mathematical cubie centres remain
UB `(64,36)`, UR `(92,64)`, UF `(64,92)`, UL `(36,64)`, UBL `(36,36)`, UBR
`(92,36)`, UFR `(92,92)`, UFL `(36,92)`. All edge lines still connect these
centres. The corner lane remains 5 units outward.

**Exact shaft paths (head bases, not tip coordinates):**

| Case / mapping | Before | After |
| --- | --- | --- |
| UA UF→UR | `M 69.66 86.34 L 80.69 75.31` | `M 69.66 86.34 L 84.93 71.07` |
| UA UR→UL | `M 84 64 L 52 64` | `M 84 64 L 46 64` |
| UA UL→UF | `M 41.66 69.66 L 52.69 80.69` | `M 41.66 69.66 L 56.93 84.93` |
| T UR→UL | `M 81 64 L 47 64` | `M 83 64 L 45 64` |
| T UFR→UBR | `M 97 77 L 97 51` | `M 97 77 L 97 51` |
| GC UR→UB | `M 86.34 58.34 L 75.31 47.31` | `M 86.34 58.34 L 76.02 48.02` |
| GC UB→UL | `M 58.34 41.66 L 47.31 52.69` | `M 58.34 41.66 L 48.02 51.98` |
| GC UL→UR | `M 44 64 L 76 64` | `M 44 64 L 75 64` |
| GC UFR→UFL | `M 84 97 L 53 97` | `M 84 97 L 48 97` |
| GC UFL→UBL | `M 31 84 L 31 53` | `M 31 89 L 31 53` |
| GC UBL→UFR | `M 41.66 41.66 L 79.98 79.98` | `M 41.66 41.66 L 79.98 79.98` |
| H UF→UB | `M 64 81 L 64 47` | `M 64 83 L 64 45` |
| H UR→UL | `M 81 64 L 47 64` | `M 83 64 L 45 64` |
| Z UF→UR | `M 71.78 84.22 L 84.22 71.78` | `M 70.36 85.64 L 85.64 70.36` |
| Z UB→UL | `M 56.22 43.78 L 43.78 56.22` | `M 57.64 42.36 L 42.36 57.64` |

**Tips and intentional routing:**

- Ua destination tips: `(85.64,70.36)` → `(90.59,65.41)`, `(45,64)` → `(38,64)`,
  `(57.64,85.64)` → `(62.59,90.59)`. Each directed span gains 7 units; tails
  stay in place to separate the arrows at each cycle vertex. The cycle remains
  UF→UR→UL→UF; no new crossings.
- T edge tips: `(88,64)`/`(40,64)` → `(91,64)`/`(37,64)`, span 48→54.
  Corner shaft and triangles are geometrically identical, including tips
  `(97,85)`/`(97,43)`, 5-unit right lane and 7-unit clearance.
- H: tips `(64,88)`/`(64,40)` → `(64,91)`/`(64,37)` and
  `(88,64)`/`(40,64)` → `(91,64)`/`(37,64)`. Both spans 48→54, symmetric
  about `(64,64)`. The intentional central crossing remains.
- Z: UF↔UR tips `(66.83,89.17)`/`(89.17,66.83)` →
  `(64.71,91.29)`/`(91.29,64.71)`; UB↔UL tips
  `(61.17,38.83)`/`(38.83,61.17)` → `(63.29,36.71)`/`(36.71,63.29)`.
  Both spans gain 6 units (31.60→37.60); centre lines and mappings unchanged.
- Gc: the bottom `y=97` lane implied UFL at `(36,97)`, while the left `x=31`
  lane implied UFL at `(31,92)`. Those adjoining presentation anchors now share
  their lane intersection `(31,97)`. Incoming tip `(45,97)` → `(40,97)`;
  outgoing tail `(31,84)` → `(31,89)`. Only these two corner segments change;
  the diagonal corner segment is exact, and all edge tips/tails are exact.
  Gc edge head bases move 1 unit to accommodate the shared 8-unit heads.
  The inner edge and outer corner lanes, cycle directions, required movements
  and existing crossings remain. This is presentation only, not a new cubie
  position or modified permutation.

**Visual evidence and limits:** Frozen original/refined SVGs are embedded in
[the comparison page](./previews/pll-refinement-comparison.html), with 128/64 px
on both surfaces, 256 px renderings and a geometry-only magenta/blue overlay.
Chromium screenshots were inspected for all four size/surface combinations,
the overlay and Gc at 2×. Palette, head/shaft weight and Ua expansion are clearly
perceptible at normal size; T/H/Z length improvements are bounded by accurate
endpoints. T/H now span 54 of 56 units between cubie centres: lengthening much
further would remove clearance or overshoot the intended positions. Gc remains
dense at 64 px because its mathematically required cycles interleave; all heads
remain separate and inside the face. No new intersections or clipping observed. A final segment-intersection check
confirmed unchanged shaft-crossing pairs: Ua/T/Z zero, H one, Gc two. All five
refined SVGs match the embedded after-comparison bytes.
Dark-surface borders retain the established near-black ink; the bright sticker
fills distinguish the diagram. Mathematical/visual checks are not owner approval.

**Verification:**

- New palette/T/style expectations failed against the original renderer/assets
  before implementation. The initial restricted test process also prevented the
  existing subprocess regeneration check (`EPERM`); it passed with subprocess
  access. No test or safety check was weakened.
- `npm test -- src/lib/training`: **124/124 in 11 files** passed.
- `npm test -- scripts/training/renderDiagram.test.mjs`: **12/12** passed.
- New asset checks independently measure every 8×11 head, test actual triangle
  intersections (no head collisions), enforce face bounds including halos,
  shaft widths, endpoint clearance and Gc's shared junction. Existing tests
  retain independent mappings, facelets, SVG safety/accessibility, exact T
  corner geometry, centre lines, determinism and 64 px readability.
- `npm run typecheck`: passed. `npm run lint`: passed with only the existing
  `SessionPanel.tsx:566` purity warning.
- `node scripts/training/generate-diagrams.mjs --preview --check`: passed.
- `node scripts/training/generate-diagrams.mjs --all --dry-run`: 78 rendered in
  memory, no files written. Only ten static assets exist.
- SHA-256 comparison: all five approved OLL SVGs byte-identical.
- `git diff --check`: passed. Unrelated onboarding work preserved.
- No full app/browser test suite, production build or live Drive validation:
  application UI, timing, storage, sync, dependencies and build paths unchanged.
  Local Chromium rendering was used for visual QA; Firefox/WebKit, physical
  devices and assistive technology were not exercised.
- No commit, push, deploy or publication. **F12 remains unresolved.**


#### E9.11 T-perm corner column centring — 2026-11-09

The owner identified the vertical T corner swap as too far right and explicitly
requested centring. This supersedes E9.9/E9.10's instruction to preserve its
5-unit right lane. A T-only presentation override moves the entire corner arrow
5 units left: shaft `M 97 77 L 97 51` → `M 92 77 L 92 51`, tips
`(97,85)`/`(97,43)` → `(92,85)`/`(92,43)`. The corner sticker centres are
UBR `(92,36)` and UFR `(92,92)`. Length, 7-unit tip clearance, 8×11 heads,
5.5-unit shaft, vertical centring, mappings and the horizontal arrow stay intact.
All other PLL routing and every OLL asset remain unchanged. The current contact
sheet shows the centred T. The frozen E9.10 comparison intentionally remains
historical and retains the earlier offset.

Two updated renderer regressions failed against the prior offset. After the
change, `npm test -- scripts/training/renderDiagram.test.mjs
src/lib/training/diagrams/svgAssets.test.ts` passed 20/20, including
regeneration, mappings, head bounds/collisions and exact new T coordinates.
`npm run typecheck`, `npm run lint` (existing SessionPanel purity warning),
preview `--check`, all-case `--dry-run` and `git diff --check` passed.
SHA-256 verified all nine other preview assets unchanged. Actual Chromium
before/after renderings at 2× plus 128 px light and 64 px dark were visually
inspected. No full application E2E, build or live Drive check was needed for
this isolated SVG presentation edit. No other assets generated; no Phase 3,
commit, push, deploy or publication. PLL still awaits visual approval; OLL is
approved and F12 remains unresolved.

#### E9.12 PLL side stickers flush with the face — 2026-11-09

The owner requested no gaps between PLL side stickers and the face, OLL-matching
yellow and coordinated side colours, while preserving the current arrow format.
PLL `barGap` changes from 4 to 0; top/left coloured bars move from 9.5 to 13.5,
bottom/right from 112 to 108. Strip backgrounds move from 8.5/111 to 12.5/107.
Their 2-unit outlines join the existing face border with no exposed background
gap. Face geometry, sticker lengths/thicknesses and colour assignments remain.
PLL already has approved OLL yellow `#FFF200` and saturated green `#00C853`,
red `#FF3030`, blue `#2962FF`, orange `#FF8A00`; these values are retained, as is
black `#111418`. No arbitrary palette change was introduced. OLL styling/assets
are unchanged, including its own approved 3-unit bar gap.

All five PLL arrow groups compare identically before/after, including paths,
heads, halos, widths, directions and the centred T corner swap. All five OLL
SHA-256 hashes match. Only five PLL SVGs plus the current contact sheet were
regenerated; the frozen E9.10 comparison remains historical.

The new flush-boundary renderer test failed before the change.
`npm test -- scripts/training/renderDiagram.test.mjs src/lib/training/diagrams/svgAssets.test.ts`
passed 21/21. Typecheck and lint passed (only the existing SessionPanel purity
warning), as did preview `--check`, all-78 `--dry-run` and `git diff --check`.
Actual Chromium renderings of all five cases at 128/64 px on light/dark were
inspected: borders join without gaps, clipping or changes to arrow readability.
Full application E2E/build and live Drive were skipped for isolated static SVG
presentation. PLL awaits owner visual approval; OLL is approved, F12 unresolved.
No remaining 68 diagrams, Phase 3, dependencies, commit, push or publication.

#### E9.13 PLL line-weight hierarchy — 2026-11-09

The owner requested thin matching inner grid and side-sticker outlines, with
only the main 3×3 outline slightly bolder. PLL inner grid 4→2 px, main border
4→3 px; side outlines render as a single 2 px boundary. The face remains 88 px
at `(20,20)`. Top cells expand 24→26 px at origin 23 instead of 24, preserving
the 28 px step and exact 36/64/92 cubie centres. Arrows and colours are unchanged.

PLL side rectangles extend 1 px beyond the top-cell fill at each long end,
sharing their 2 px strokes rather than leaving a gap between doubled outlines.
Strip backgrounds inset 1 px from the face's long bounds (21..107) so side end
outlines also render at 2 px. The short-axis outline overlaps the main border
by 1 px (`barGap=-1`) to keep the visible coloured fills flush with its 3 px
edge. Top/left rectangle coordinate 14.5, bottom/right 107. OLL is untouched.

New geometry regressions failed against the old weights. Focused renderer/SVG
tests pass **22/22**, including actual grid gaps, border thickness, shared side
boundaries, mapping, safety, arrow geometry and regeneration. Typecheck, lint
(existing SessionPanel purity warning), preview `--check`, all-78 `--dry-run`
and `git diff --check` pass. All five PLL arrow groups and all five OLL asset
SHA-256 hashes match their pre-edit values. Actual Chromium renders of all five
at 128/64 px on light/dark were inspected: the lighter hierarchy is visible and
side outlines remain joined. Full application E2E/build and live Drive checks
were skipped for isolated SVG styling. No other 68 assets, Phase 3, dependency,
commit, push or publication. PLL awaits owner approval; F12 remains unresolved.

#### E9.14 Clean PLL corner joins — 2026-11-09

The owner identified stepped/notched main-face corners and requested a fix. The
E9.13 strip backing inset was 1 px: its long bounds 21..107 stopped inside the
main face bounds 20..108. Remove that inset on all four sides; backings now span
88 px instead of 86. Side sticker geometry, colours, line weights and complete
arrow groups are identical before/after. OLL hashes remain identical. The prior
E9.13 inset choice is superseded, while its 2 px inner/side and 3 px main border
weights remain current. Side ends now merge into the main border cleanly.

New corner alignment regression failed before implementation; focused
renderer/SVG tests passed 23/23. Typecheck, lint (existing SessionPanel warning),
preview `--check`, all-78 `--dry-run` and `git diff --check` passed. Actual
Chromium before/after at 2×, plus 128 px light and 64 px dark, were inspected.
Full application E2E/build and live Drive were skipped for isolated SVG styling.
Only the five PLL preview SVGs were regenerated; no other assets, Phase 3,
dependencies, commit, push or publication. PLL awaits owner approval; F12 stays
unresolved.

#### E9.15 Phase 2C completion — all 78 diagrams generated, verified and approved — 2026-11-09

**Status:** COMPLETE. The owner explicitly approved **both** finalized OLL and
PLL diagram designs. The complete standard collection was generated with the
existing deterministic pipeline; no manual SVGs or duplicated cube-state logic
were added.

**Generation:**

- `node scripts/training/generate-diagrams.mjs --all` wrote **57 OLL** SVGs
  (`oll:1`–`oll:57`, `oll-01.svg`–`oll-57.svg`) and **21 PLL** SVGs
  (`Aa`, `Ab`, `E`, `F`, `Ga`, `Gb`, `Gc`, `Gd`, `H`, `Ja`, `Jb`, `Na`, `Nb`,
  `Ra`, `Rb`, `T`, `Ua`, `Ub`, `V`, `Y`, `Z`). Total: **78**.
- OLL skip and PLL skip are not counted or generated.
- Every asset is derived from the verified case definition and representative
  state in `standardCases.ts`; no third-party algorithm or artwork was copied.
- The generator now also writes the internal complete-collection contact sheet
  `docs/training/previews/phase-2c-all-diagrams.html` (light and dark surfaces,
  128 px and 64 px for every case). The earlier ten-case
  `phase-2c-diagrams.html` remains as the historical approved-preview checkpoint.
- SHA-256 comparison before/after full generation confirmed all ten approved
  preview SVGs (five OLL, five PLL) remained **byte-for-byte identical**.

**Verification (2026-11-09):**

- `node scripts/training/generate-diagrams.mjs --all --check`: passed, including
  78 assets and the complete contact sheet.
- `node scripts/training/generate-diagrams.mjs --preview --check`: passed; the
  approved preview sheet and ten preview assets are unchanged.
- `npm test -- src/lib/training`: **125/125 tests in 11 files** passed.
- `npm test -- src/lib/training/diagrams/svgAssets.test.ts scripts/training/renderDiagram.test.mjs`:
  **25/25 tests in 2 files** passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with only the pre-existing
  `SessionPanel.tsx:566` purity warning.
- Extended SVG asset tests now cover all 78 files: exact 57/21 file counts and
  stable filenames, unique IDs/signatures, case-to-asset references, actual
  sticker/bar colours and positions, OLL top/bar masks, PLL side-strip
  permutation colours, permutation cycles and tips, XML/viewBox/accessibility,
  absence of scripts/external content, fixed 8×11 heads, clipping bounds,
  64 px readability, deterministic regeneration and the complete contact sheet.
- Existing negative tests for tampered stickers, bars, arrows, signatures,
  cycles, unsafe SVG output and malformed specs remain in force.
- `git diff --check`: passed.
- Chromium loaded the complete contact sheet with **312/312 images** (78 cases ×
  128/64 px × light/dark), no broken images and no horizontal overflow. All 78
  SVGs were also inspected at 128 px and 64 px on both surfaces.

**Visual exceptions:** Gb and Gd each contain one known head-overlap pair at the
crowded G-perm centre: the exact diagonal `UBL→UFR` corner arrow passes through
the `UF→UR` edge head. They remain traceable at 128 px but are the most crowded
G cases at 64 px. No geometry change was made because moving the diagonal arrow
would misstate its corner-to-corner mapping; the collision is explicitly
recorded and tested as the only allowed overlap. Gc remains dense but
collision-free. No clipping, missing side bars, sticker misalignment, incorrect
arrow mapping or new intersections were found.

**Confirmed timing requirement for future phases (not implemented here):** OLL
training ends when the user finishes OLL, even when PLL remains unsolved. This
applies to both OLL execution-only and OLL recognition+execution modes. The timer
is manually stopped by the user. PLL training ends after PLL completion, allowing
for AUF.

**Files:** generated `src/assets/training/diagrams/oll/*.svg` and
`.../pll/*.svg` (78 total), added the complete contact sheet, extended
`scripts/training/renderDiagram.mjs`, `scripts/training/generate-diagrams.mjs`,
`scripts/training/renderDiagram.test.mjs` and
`src/lib/training/diagrams/svgAssets.test.ts`, and updated
`docs/training/PROJECT_MEMORY.md` and `docs/training/CURRENT_STATUS.md`.

**Not run:** full application E2E, production build and live Drive validation,
because runtime UI, timing, persistence, sync, worker and build paths were not
changed. Firefox/WebKit, physical devices and assistive technology were not
exercised. **F12 remains unresolved;** no algorithm dataset or additional PLL
variants were bundled. No commit, push, deploy or publication occurred. Phase 3
was not started.

---

#### E9.16 Longer PLL corner arrows — 2026-11-09

**Owner request:** all corner-swap arrows are too short; edge swaps are fine.
This supersedes E9.10/E9.11 corner-length preservation across the completed
collection. Double-corner tip clearance changes 7→2 px, extending both ends by
5 px (10 px total). Directed corner tip clearance changes 9→3 px, extending
all corner-cycle segments by 6 px; tail clearance stays 8 px to preserve cycle
junction spacing. Edge geometry is unchanged, including mixed G-perm lanes.
Head dimensions remain 8×11, shaft weights and routing are unchanged, T stays
on x=92, and Gc retains its shared (31,97) junction. T's shaft is now
`M 92 82 L 92 46`, with tips (92,90)/(92,38).

Regenerated all/preview output. Exactly 17 PLL SVGs changed; all edge-cycle
groups, the four edge-only PLLs and all 57 OLL SVGs are byte-identical to the
pre-edit snapshots. Longer diagonal corner arrows remove the historical Gb/Gd
head overlaps without shifting their lanes. Updated collision checks require
zero head overlaps for all 21 PLLs. G-perms remain dense at 64 px.

**Verification:** updated T regression failed before implementation;
`npm test -- src/lib/training/diagrams/svgAssets.test.ts scripts/training/renderDiagram.test.mjs`
passed **25/25**, including generator `--preview --check`, `--all --check` and
`--all --dry-run`. Initial restricted subprocess launches failed with EPERM;
the rerun with process access passed. `npm run typecheck`, `npm run lint`
(existing SessionPanel purity warning only) and `git diff --check` passed.
`node scripts/training/generate-diagrams.mjs --all` and `--preview` regenerated
the current collection. Temporary `node /tmp/cubelab-pll-qa.cjs` compared prior
bytes and rendered 42/42 PLL images using isolated Chromium; all 21 were visually
inspected at 128/64 px on light/dark backgrounds. No clipping or new arrowhead
overlaps observed.

Full Training/application suites, application E2E, production build, live Drive,
Firefox/WebKit and physical-device checks were intentionally skipped for this
isolated static presentation change. F12 and Phase 3 status are unchanged.
No dependency, algorithm, runtime, persistence, commit, push or publication.

---

#### E9.17 Centre every PLL corner arrow — 2026-11-09

**Owner request:** corner arrows appear closer to the outside than the inside.
Removed `CORNER_LANE_OFFSET` (5 px) and the Gc (31,97) junction override.
Every arrow now follows its actual cubie-centre line. E's swaps move from
x=31/97 to x=36/92. Gc's junction is now the actual UFL centre (36,92); its two
adjoining spans lose the extra 5 px from the previous offset intersection.
E9.16's tip/tail clearances, head dimensions, shaft weights and sticker geometry
are retained. This supersedes all earlier outer-lane preservation decisions.
T and diagonals already centred remain unchanged. Exactly 12 PLL files changed;
all edge-cycle groups and 57 OLL SVGs are byte-identical to pre-edit snapshots.

**Verification:** `npm test -- scripts/training/renderDiagram.test.mjs` failed
the new E centring regression before the fix. After regeneration with
`node scripts/training/generate-diagrams.mjs --all` and `--preview`,
`npm test -- src/lib/training/diagrams/svgAssets.test.ts scripts/training/renderDiagram.test.mjs`
passed **26/26** (including preview/all `--check` and all `--dry-run`). Every
arrow now has zero perpendicular displacement from its cubie-centre line;
all PLLs pass head-collision and clipping checks. `npm run typecheck`,
`npm run lint` (existing SessionPanel purity warning only) and
`git diff --check` passed. Temporary `node /tmp/cubelab-pll-centering-qa.cjs`
confirmed unchanged edge/OLL bytes and 42/42 loaded Chromium images; all 21 PLLs
were visually inspected at 128/64 px on light/dark.

Full Training/application suites, app E2E, production build, live Drive,
Firefox/WebKit and physical devices were skipped for isolated static SVG
presentation. G-perms remain dense at 64 px. Phase 3/F12 unchanged. No commit,
push, deploy, publication, dependencies or runtime behavior changes.

---

### E10. Phase 3A — Training data model and persistence — COMPLETE (2026-11-09)

**Authorization:** The owner explicitly authorized Phase 3A only: types,
attempts, preferences, calibration storage, practice visits and safe persistence.
This supersedes the earlier Phase 2C instruction to await Phase 3 authorization
for this scope only. Phase 3B calculations and Phase 4 UI remain unstarted and
require a later request. The owner explicitly approved **all 78 final SVGs**;
no approved diagram, renderer/generator, case definition/signature, algorithm
approval, setup-generation code or mathematical utility was changed.
E9.15's Gb/Gd visual exceptions remain historical; E9.16 removed the head
overlaps and E9.17 centred the corner lines. G-perms remain dense at 64 px.

**Architecture inspected before implementation:** `storage.ts` uses browser
localStorage, stable `v1` key suffixes, sessions payload v6 and settings v11.
Checked session startup blocks editing on failed/invalid reads; legacy solve
migration is allowed only when the current session key is absent. Native backup
v1 and sync envelopes contain ordinary sessions/settings and protocol metadata;
replacement recovery journals coordinate their existing keys under the shared
write lock. Settings fields have sync merge ownership. A separate Training key
extends these conventions without altering ordinary data or making a premature
backup/sync protocol change. Reuses `StorageLike`, `createId`, Date bounds, catalog
case/algorithm IDs and revisions, existing fixed precursor constants and
`GeneratedTrainingSetup`; no new dependency or unrelated persistence technology.

**Implemented files:**

| File under `src/lib/training/` | Responsibility |
| --- | --- |
| `types.ts` | Versioned attempts, algorithm snapshots/attribution, preferences, presets, custom algorithms, calibration records/snapshots, visits and store |
| `schema.ts` | Complete structural/JSON validation, date bounds, four categories, case/precursor/setup metadata and bidirectional visit references |
| `storage.ts` | Fresh defaults, first-schema migration boundary, lossless JSON round trip, checked load and expected-raw guarded save |
| `records.ts` | Detached attempt creation/correction, visit creation/append/end and category-required case/algorithm/visit selection; no aggregations |
| `records.test.ts`, `storage.test.ts`, `persistenceIntegration.test.ts` | Domain/persistence regressions and actual verified setup round trips for all four categories |
| `persistenceFixtures.test-support.ts` | Synthetic structural fixtures, explicitly not mathematical verification evidence |

**Data decisions:**

- Training schema **v1**, dedicated **`cubelab:training:v1`**. Attempts,
  preferences, presets, setup snapshots, calibrations and visits carry v1
  record/schema versions. Algorithm `version` remains its content revision,
  consistent with the existing catalog. No ordinary schema/version changed.
- Attempts permanently capture `oll:execution`, `oll:recognition`,
  `pll:execution` or `pll:recognition`. Case/category/algorithm/visit selection
  requires a category. There is no addition to `PuzzleEvent`, `Solve`,
  `Session`, solve Analytics or regular settings.
- A record preserves raw monotonic measured duration, valid penalty or invalid
  reason, creation time/visit, generated setup/AUF, generator ID/revision,
  verification metadata, applicable fixed precursor and optional detached
  calibration snapshot/estimated recognition+execution duration. No automatic
  solved detection or timer UI. B5a timing semantics remain mandatory.
- Attribution is `assumed-preferred`, `user-corrected` or `unknown`.
  Preferred-at-start and algorithm revision/notation snapshots remain historical,
  independently of the generator and subsequent preferred/custom algorithms.
  Unknown is excluded from algorithm selection, retained in case selection.
  Save guards reject rewrites of existing attempt timing/category/setup/snapshots;
  only explicit attribution correction is allowed. Changed custom notation uses
  a new ID/incremented version/replacement link; previous revisions are retained
  when referenced by that link. No smart-cube inference is claimed.
- Preferences include per-set enabled/difficult cases, setup toggles and
  recognition renewal thresholds; presets, preferred revisions/custom notation,
  separate four-category metric preferences and reserved JSON report settings.
  Defaults select all 57/21 mathematical cases, execution mode and raw metrics,
  with no preferred/bundled algorithms, presets or reports pre-populated.
- Visits are automatic domain records, with stable IDs/start/end, starting and
  visited categories, exact attempt references and a future summary ID. B16
  permits a visit to span sets/modes without mixing results. Helpers create,
  append and finish explicitly; UI entry/exit, refresh/resume/stale rules and
  report generation remain later work. No manual Training Sessions are created.
- Separate OLL FR-insertion and PLL Sune calibrations store seven finite
  nonnegative samples, supplied median/measurement/counter/renewal metadata and
  source/invalid-sample count. Attempts detach the full calibration snapshot.
  Default renewal is seven days or 100 recognition attempts, whichever comes
  first. Phase 3A stores these values only; median/due/adjustment calculations,
  negative-estimate policy and calibration UI are not implemented. Estimates
  must have a calibration and valid non-DNF recognition context, be finite,
  nonnegative and no greater than raw; missing calibration/estimate is explicit
  null. This does not decide whether future UI blocks stale/missing calibration.

**Persistence/migration safety:** Loads never write. Only an absent key produces
defaults; malformed/incomplete/unsupported/current unreadable data returns a
failure without writable fallback and preserves original bytes. Every record is
validated together: bad attempts are not silently dropped, nor are duplicates,
wrong-set cases or dangling visit references salvaged. Saves revalidate current
bytes/candidate, require the exact previously checked raw value, report read/quota
failures and never clear a key. First schema v1 validates/detaches through
`migrateTrainingData`; there is no historical Training v0 to invent a conversion
for. Unknown schema versions block writes. Additive JSON fields round-trip
unchanged; lossy/nonfinite/cyclic values reject. No production migration or app
startup write is activated. Future UI must hold the existing lifetime
`cubelab-active-tab` Web Lock; the raw comparison is not an atomic cross-tab
transaction. Invalid-byte repair/export UI remains future work.

**Verification:** Exact commands/results and skips are recorded once in
[STATUS.md](../../STATUS.md#training-phase-3a--2026-11-09). New tests initially
failed for missing implementation; the historical-category regression also failed
before its save guard. Actual setup-generation integration fixtures initially
needed the existing verified-record precondition; fixed without weakening the
generator. Restricted subprocess checks failed with EPERM and passed with the
required process access. Existing persistence regression suites passed. A hash
comparison verifies all pre-existing Training source/assets/scripts are unchanged;
only new Phase 3A files and documentation were written. Unrelated onboarding and
other working changes are preserved. No commit, push, deploy or publication.

**Remaining integration and limits:** Native backup/export/import and Drive
payloads intentionally exclude Training. They neither export it nor restore it;
no backup-round-trip claim is made for Training. Future work must define preview,
older-backup preservation, checked import, durable replacement recovery and
10 MB size behavior before adding a Training section. Drive/cross-tab adoption,
tombstones/conflicts, resets, onboarding detection, recovery UI, retention and
large-history size/performance remain outstanding. Full-record synchronous
validation/serialization is a foundation, not a scalability claim. Loaded setup
verification and supplied calibration summaries are metadata validation, not a
fresh cube simulation/median calculation. No production UI/hook is mounted.

**F12 remains unresolved.** No Heroor OLL/Tao PLL dataset, additional 37 PLL
variants or third-party artwork is bundled. Mathematical correctness and owner
approval do not establish redistribution rights. Default ID references can be
populated later after rights are resolved; user-defined notation is allowed.

**Exact Phase 3B entry task:** After explicit authorization, implement pure
calibration calculation/due helpers and owning tests: seven valid samples,
median, seven-day/100-recognition-attempt renewal and detached snapshot/estimated
timing. Resolve F6/F8 fidelity and missing/expired/below-calibration policy before
those behavior branches. Continue with category-keyed statistics and automatic
visit/report logic only under approved F9 baseline rules. F11 inspection/penalty
policy remains open for timer integration. Preserve all four categories and
historical attribution. No UI, bundled default content or automatic Phase 4.

---

### E11. Phase 3B — Pure calibration, statistics and practice visits — COMPLETE (2026-11-09)

**Authorization and precedence:** the owner finalized F6/F8/F9/F11, recognition
selection and practice-visit policies and authorized pure domain implementation
and necessary compatible persistence extensions only. This entry supersedes
conflicting Phase 0 proposals and Phase 3A future-work statements. B16/B17 now
record the confirmed policies. No UI, app-mounted Training store/hook, listeners,
navigation/timer wiring, dependency, bundled dataset, backup or Drive integration.
All 78 approved SVGs, mathematics/setup generation and unrelated work are intact.

**Implemented architecture (under `src/lib/training/`):**

| File | Responsibility |
| --- | --- |
| `settings.ts` | Validated Training-only settings/defaults and read-only legacy default resolution |
| `results.ts` | Success/DNF classification; explicit exclusion of unsupported legacy +2/invalid results |
| `calibration.ts` | Fixed protocol definitions, seven-sample drafts/discard/cancel/complete, numeric median, independent calibration lookup, eligibility/renewal/estimate decisions and high-water count resolution |
| `stats.ts` | Category-required successful raw/estimated summaries, recent/case/algorithm selectors, historical windows, matched-case improvements and exact-ceiling trimmed rolling averages |
| `visits.ts` | Explicit-timestamp lifecycle events/decisions, pending-report references and acknowledgement; no browser side effects |
| `reports.ts` | Recalculation by stable visit/attempt references and captured baseline policy with an explicit cutoff |
| `types.ts`, `schema.ts`, `records.ts`, `storage.ts` | Optional validated v1 extensions, strict new attempts, detached snapshots, explicit result corrections and guarded persistence |

**Statistics/F9:** totals, successful/DNF counts, DNF percentage, successful raw
mean/PB, recent history and case/algorithm summaries are separate for all four
categories. Unknown attribution remains in case statistics without assignment
to a preferred algorithm. Algorithm ID and revision are respected. Raw measured
milliseconds are used without ordinary Timer penalty/recorded-precision rules.
Estimated series use only saved eligible successful estimates, including zero;
nulls remain missing. Unsupported legacy +2/invalid records are retained and
exposed as `unsupportedAttempts`/`recordedAttempts`, excluded from completed
counts, means/PB and the supported-attempt DNF denominator; rolling windows flag
them explicitly rather than converting them.

Default baseline is previous **90 days**; typed settings support `days` or
`attempts` with any positive safe-integer count. Days use the half-open window
`[cutoff - X * 86,400,000, cutoff)`; attempts select latest X recorded attempts
strictly before cutoff, including DNFs, returned chronologically. Equal timestamp
ordering uses binary ID order, independent of locale or input array order.
Comparisons require matching category and case (and matching ID/revision when
algorithm-scoped). At least one eligible success on both sides and a positive
historical mean permit a descriptive percent change. There is no unapproved
three-sample minimum, 20-attempt cap, 90-day fallback or unrelated-case baseline.
Category improvement is the mean of eligible per-case percentages with equal
case weight; matched/unmatched coverage is explicit. These are descriptive
comparisons, not claims of statistical significance. DNFs contribute to window
selection and DNF rates, not successful means.

Default trimming is **5% per side**, configurable from 0 up to (excluding) 50%.
For N attempts each side trims `ceil(N * percent / 100)`. DNFs occupy worst
slots; exceeding the allowance returns DNF. If symmetric ceiling trims would
remove all observations, return `insufficient-window`, without silently changing
the trim formula. Thus default N=1/2 has no trimmed average; percent=0 permits
those windows. Missing successful estimates return `unavailable-estimate`, never
raw/zero substitution, even if their rank could have been trimmed. Raw and
estimated rolling series remain separate; duplicate values/DNFs are deterministic.

**Visit/report decisions:** new visits capture one category, baseline policy,
inactivity timeout and last activity. Case/algorithm activity continues them;
category switches end/start visits. Refresh before timeout resumes the same ID;
Timer/Analytics navigation ends it. At or beyond inactivity, finalize at last
activity + captured timeout. Running attempts defer transitions, and completion
activity renews the deadline. Confirmed closure finalizes at a reliable supplied
close timestamp or the last known activity if the close time is unavailable.
Ended visits with supported attempts retain a pending-report flag until
acknowledged; this does not block a subsequent visit/navigation. Reports
recalculate raw/estimated summaries, cases, algorithms and matched-history
improvements from current referenced attempts, through visit end/as-of cutoff.
Deletion/correction updates results. Active-visit reports require an as-of cutoff.

**Exact future continuity requirement:** application orchestration must supply
`startup` continuity as `refresh`, confirmed `closed`, or `unknown`. A future
per-tab browsing-context token in `sessionStorage` (survives reload) matched to a
persisted active-visit owner token can support refresh detection; reliable
closure evidence must account for restored tabs/session restoration. Browser
pagehide/unload alone is insufficient. A bfcache/restore-aware policy or another
explicit lifecycle signal is still required for that ambiguity. Unknown
continuity returns `needs-continuity-signal` without inventing an end/resume.
No token, listener, close detection or application marker is implemented in this
phase. Older visits lacking lifecycle policy return
`legacy-visit-needs-finalization`; old report baseline policy is explicitly
unavailable rather than invented. Existing low-level `finishTrainingVisit` can
close a legacy record deliberately; retroactive baseline assignment is not done.

**Compatibility audit/decision:** keep payload schema **v1**, key
**`cubelab:training:v1`**. Phase 3A canonical records remain readable, including
zero/nonmedian calibration metadata, +2/invalid results and multi-category visits.
No destructive migration, read-time mutation or production startup upgrade.
Optional extensions are `preferences.domain` (version 1), calibration `protocol`,
attempt `rulesVersion`/unavailable reason/result-correction timestamp, per-set
`recognitionCounts` and visit `lifecycle` (version 1). New fixed-protocol
calibrations require seven positive samples and the exact median. New recognition
attempts require a usable fixed-protocol snapshot; old untagged calibrations do
not establish reference-state fidelity. Existing stored estimates remain intact.
New successful estimates validate against their own snapshot; new attempts
reject +2/invalid results and inspection. No historical estimate backfill.

Checked loads never write; absent legacy extensions resolve defaults only when
requested. Corrupt/unsupported bytes block writes. Saves retain original
expected-raw checks, immutable timing/setup/calibration/preferred-at-start
snapshots and explicit attribution correction. Explicit success/DNF correction
also requires a timestamp, retains raw/snapshots and cannot backfill an estimate;
unsupported legacy results require a separate migration and cannot be silently
converted. Calibrations retain immutable completion order and history (ties use
later completion); visits retain identity, captured policy and ended boundaries.
Recognition totals cannot be removed/lowered or omit new recognition completions,
including DNFs. Deleted attempts must not lower renewal counts. No new reset or
attempt-deletion UI/path was added. Ordinary sessions v6, settings v11, backup v1,
sync envelopes and browser data remain untouched.

**Verification:** exact commands, final results and development regressions are
recorded once in [STATUS.md](../../STATUS.md#training-phase-3b--2026-11-09).
Focused tests preceded implementation, including a failing equal-timestamp
calibration replacement regression. Tests include fixed cube-state inverse
checks, eligibility and exact renewal boundaries, snapshot estimates, DNF/category
statistics, baseline/trim rules, lifecycle recovery decisions, recalculated
reports, v1 compatibility and storage guards. Existing persistence regressions
passed. SVG/source/unrelated-work hashes were compared with the starting
manifest. No browser suite, build/PWA, live Drive or physical-cube validation was
run: no application integration was authorized. No commit/push/deploy/publication.

**Remaining Phase 4 prerequisites:** explicitly authorize Phase 4 first; design
`useTraining` checked-storage orchestration under the existing active-tab lock,
resolve continuity signals/legacy visit finalization, call eligibility before
recognition selection and each next attempt (never mid-attempt), capture timing
and calibration at start, and route exact-once manual completion with inspection
bypassed and manual DNF correction. Review execution algorithm visibility (F4)
and storage-health UX. F12 still blocks default algorithm records/37 extra PLL
variants. Native backup/recovery/reset/onboarding/cross-tab/Drive integration,
retention/size/performance, UI accessibility and production offline verification
remain future work; no production-readiness claim follows from this phase.

---

### E12. Expanded Phase 4 — Complete Training UI and shared timer — 2026-11-10

> **Default-catalog update (E13, 2026-11-10):** the owner later removed the
> internal F12 restriction. E13 now supplies all 78 read-only built-in defaults
> and controls current preference behavior. The Phase 4 statements below that say
> practice requires user algorithms or that defaults are pending permission are
> retained as the historical Phase 4 checkpoint.

**Authorization and precedence:** the owner's attached request explicitly
combined 4A, 4B and 4C in one implementation, including selection/algorithms,
floating results, calibration, statistics and reports previously distributed
across the proposed Phases 4–7. Those older headings are historical planning,
not separate approvals needed for this task. No Phase 5 was begun automatically.
No dependency, third-party collection, native/Drive format or approved SVG changed.
Exact verification commands/results are recorded once in
[STATUS.md](../../STATUS.md#training-phase-4--2026-11-10).

**4A controller and timer:** `TrainingController` is a synchronous event
coordinator exposed by `useTraining`/`useSyncExternalStore`. Construction only
performs checked reads. App mounts it inside the existing active-tab ownership
and ordinary startup recovery gates. Every mutation uses `saveTraining` with
its exact checked raw snapshot; failed writes retain the candidate, block more
attempts and offer Retry/recovery-copy download. Navigation while a result save
is pending retains the visit end in the same candidate, so retry persists both. Navigation during a failed save retains
the visit end alongside the result, so Retry saves the complete candidate.
Changed external bytes are never replaced. An unsaved banner survives navigation and beforeunload requests an exit
prompt solely for a real unsaved candidate; it is not a closure detector or a
durability guarantee. The recovery copy contains draft and checked external
snapshot and has no automatic importer/merger. Ordinary data formats are intact.

One existing App `useTimer` instance routes completions to ordinary `handleSolve`
or the Training destination. Its optional `onStart` gate runs exactly at the
arming-to-running transition, captures a detached setup/preferred assumption/
calibration/visit and stable attempt ID, and can veto an ineligible start.
The machine, monotonic timestamps, input/repeat guards, keyboard/touch adapters,
global hold/any-key/update preferences and TimerStage presentation are shared.
Completion consumes the context before save/notification/preparation, preventing
duplicate attempts. Training passes inspection OFF and writes success or DNF
only to its dedicated store; calibration repetitions use another destination.
TimerStage accepts a presentation-only result without fabricating Solve records.
Normal event-scramble generation suspends outside Timer and resumes its queue.

**4B UI:** header navigation has Timer, Analytics, Training; navigation locks
while any timer gesture is active. The Training page uses the existing workspace,
sidebar, fonts, accent/theme tokens and TimerStage. Separate set/toggle controls,
case families/search, select all/clear, difficult practice and persistent user
preset create/rename/update/delete/select operate independently from cumulative
history. Native configuration lists preserve platform keyboard/touch behavior;
dialogs reuse existing modal focus containment/restoration. CaseDiagram imports
the 78 approved SVG URLs/data URLs without runtime SVG generation. Recognition
renders only scramble/precursor/instructions, never its upcoming target identity,
image, algorithm or target-bearing metadata. Last Result shows only a completed
attempt; errors also avoid leaking a failed recognition target. Retry of a
revealed known case is labelled **Retry case (execution)** and switches category
explicitly. No automatic cube-state success detection is claimed.

The existing ToolPanel frame accepts optional content, title, per-panel layout
key, side and minimization while retaining regular-tool defaults. Training Tools
anchor bottom-left, Last Result bottom-right, with independent end-of-gesture
geometry persistence; Tools minimization persists locally. Last Result minimizes
during running and restores for a new result, without taking focus. Narrow/short
layouts dock both panels below a fixed readout area; panel content scrolls, mobile
dragging is disabled and saved desktop positions are retained. Default panels do
not overlap; deliberate desktop dragging can still cover the digits.

**Lawful algorithm path / F12 at the Phase 4 checkpoint (superseded by E13):** the existing generator actually requires a
verified solving algorithm. No source dataset, substitute default catalog or new
runtime solver was introduced. `runtime.ts` accepts user notation, verifies exact
case identity/correctness using the existing cube engine, creates immutable
revisions/replacement links and sends that verified algorithm through Phase 2B's
existing setup generator. All 78 identities remain selectable. Execution needs
one enabled usable generator and recognition two; missing default content is
clearly labelled pending permission. The usable pool is explicitly counted and
is a subset of enabled cases; immediate repeats are excluded when possible.
An absent preferred assumption can use an available verified user generator,
with Unknown attribution. Generator failure does not substitute another case.
Preferred/revised/Unknown/corrected attribution and raw snapshots remain separate.

**4C calibration/statistics/reports:** opening Training never calibrates. Explicit
recognition selection checks its own set and minimum selection. Seven fixed
inverse-precursor repetitions use the shared timer with sample review/keep/retry,
progress and median; cancel returns to mode selection and preserves previous
calibration. Only seven accepted positive samples commit a new immutable record.
A partial draft is intentionally not durable across refresh. Failed final saves
retain the completed candidate and retry the same calibration ID. Per-set renewal
settings affect the next calibration; captured thresholds remain historical.
Default due status recommends and permits the old median; forced renewal vetoes
the next running transition. Nothing interrupts an active attempt.

The UI calls the Phase 3B engine for four independent categories, raw/estimated
means/PBs, success/DNF totals/rates, ao5/ao12, case and algorithm revision summaries.
Trim percentage, inactivity, baseline kind/count, independent renewal thresholds
and shared forced-renewal flag are stored only in Training preferences. Last
Result and attempt details support DNF/success and attribution corrections plus
Unknown; typed DELETE removes an attempt and its visit reference without lowering
recognition high-water totals. Recent history displays 30 attempts; older attempts
are accessible through visit reports. Raw/setup/calibration/preferred-at-start
snapshots remain immutable; corrections do not backfill estimates.

Visits begin on explicit category selection, continue case/algorithm/settings
activity, finalize on category/navigation changes or captured inactivity, and
retain last activity/baseline/timeout. A periodic and visibility/pageshow check
handles elapsed inactivity, but active timing defers it and completion renews
activity. Reload navigation is a positive refresh signal. Other openings with an
active visit (including restored-tab ambiguity) show an explicit Resume/End choice
before Training can write. End uses the last known activity when no reliable
close timestamp exists; pagehide/unload alone is not evidence. Legacy visits are
ended deliberately without inventing a baseline. A bfcache return retains live
state and rechecks elapsed inactivity. Neither crashes nor restored tabs can be
automatically classified with unconditional reliability.

Pending visit reports are non-blocking, visible from Timer/Analytics and retained
until acknowledged; history remains available afterwards. Reports recalculate
current associated attempts, corrections/deletions, raw/estimated statistics,
per-case results, duration and matched-case historical improvement using the
captured policy and visit cutoff. Insufficient history/legacy policy are explicit.
There are no manually managed Training Sessions or ordinary solve reports.

**File inventory for Phase 4:**

Created:
- `src/lib/training/{controller,runtime,format}.ts`, `controller.test.ts`, `runtime.test.ts`.
- `src/hooks/useTraining.ts`, `useTraining.test.tsx`, `useScramble.test.ts`.
- `src/components/TrainingPage.tsx`, `TrainingPage.test.tsx`.
- `src/components/training/{TrainingDialog,CaseDiagram,CaseSelectionDialog,TrainingStatistics,TrainingSettingsDialog,TrainingReportsDialog,AttemptDetailsDialog}.tsx`.
- `e2e/training.spec.ts`.

Modified:
- `src/App.tsx`, `src/components/{AppHeader,TimerStage,ToolPanel}.tsx`.
- `src/hooks/{useTimer,useToolPanelLayout,useScramble}.ts`, `useTimer.test.ts`, `src/index.css`.
- `README.md`, `FEATURES.md`, `KNOWN_LIMITATIONS.md`, `STATUS.md` and the two Training memory files.

Unrelated pre-existing onboarding/application edits remain. Starting hashes
verify all 78 SVGs, the generator and existing Training domain modules unchanged.
No files were committed, pushed, deployed or published.

**Remaining limits / next prerequisites:** third-party redistribution permission
(the internal gate is removed by E13), Training backup/import/Drive/replacement/reset/onboarding protocols, retention,
full-store size and large-history profiling remain separate work. Recovery-copy
export is manual preservation, not an ordinary native backup. Forced termination
can lose an unsaved candidate; reload discards a partial calibration draft. Fresh
non-reload openings with an active visit need a continuity choice. Firefox/WebKit,
physical devices and assistive technology remain unverified for this change.
Production offline Training was exercised in Chromium. Do not begin another phase
without authorization or describe this as the complete V1 release gate.

---

### E13. Built-in default OLL/PLL catalog — 2026-11-10

**Authorization and outcome:** the owner explicitly removed CubeLab's internal
F12 restriction that withheld the approved default algorithms. All **57 OLL** and
**21 PLL** standard cases now resolve to a read-only, mathematically verified
built-in default. The 37 additional PLL slash variants remain excluded.

#### E13.1 Content and exact provenance

- **OLL (57):** `Heroor/cfop` commit
  `e1cba6995f3ff27732ac18c767e7e9ca1343f13a`, `src/data/cube.json`, the complete
  `oll[].f` record for each numbered case. OLL 45 and OLL 56 use the owner-approved
  corrections from E9, not the rejected source strings:

  ```text
  OLL 45: F R U R' U' F'
  OLL 56: r U r' (U R U' R')2 r U' r'
  ```

  OLL 56 expands to
  `Rw U Rw' U R U' R' U R U' R' Rw U' Rw'`, preserves F2L, has no net frame
  correction and verifies as canonical signature `1212|1010`. The historical A,
  C and D variants remain rejected and are not present in the catalog.
- **PLL (21):** `tao-yu/Alg-Trainer` commit
  `cb95945c3e4839ee1e4b058d4a79bc022615b220`, `js/alg_list.js`, only the
  **first** slash-separated algorithm for each standard named case: Aa, Ab, E, F,
  Ga, Gb, Gc, Gd, H, Ja, Jb, Na, Nb, Ra, Rb, T, Ua, Ub, V, Y and Z. The remaining
  variants are not stored.
- Every default was rechecked against the Phase 2C case identity, an independent
  54-sticker model and the final E9 evidence. Frame-normalized defaults are
  OLL 36 (`x`) and PLL Ga/Gc/Gd/V (`y`/`y'`); the existing frame normalizer
  applies and verifies those corrections rather than discarding rotations.

#### E13.2 Legal and provenance status — permission not established

The owner removed CubeLab's internal gate; that is an authorization decision, not
a third-party redistribution licence. No new permission was obtained.

- **Heroor/cfop:** README states MIT and has a copyright line, but the inspected
  snapshot has no `LICENSE` file. This is not treated here as an established
  permission for the curated algorithm data.
- **tao-yu/Alg-Trainer:** the repository has an MIT `LICENSE` (Tao Yu), but its
  index credits AlgDb for algorithms not otherwise attributed. The software
  licence is not treated here as clearly covering the curated PLL compilation.

**Lawful implementation choice:** the repository bundles only the 78 individual,
short functional move sequences selected by the owner. It does not copy either
source repository's compilation structure, presentation taxonomy, diagrams,
comments, formatting, or additional variants. The catalog metadata, normalization,
case associations, validation and UI are independently authored; source paths and
commits remain recorded for traceability. Records therefore use
`redistribution: 'not-applicable'` with an explicit note that **no third-party
redistribution licence is asserted**. This is a risk-reduction decision, not a
claim that third-party rights were granted or that legal review is complete.
Written permission, a lawyer's review, or replacement with independently licensed
content remains advisable before relying on broader redistribution.

#### E13.3 Catalog architecture

| Module | Responsibility |
| --- | --- |
| `src/lib/training/catalog/defaultAlgorithms.ts` | Read-only 78-record catalog, stable IDs (`<caseId>:alg:default-v1`), version 1, immutable records, approved default/generator links, provenance, corrections, frame metadata, complete catalog definition. No user data. |
| `src/lib/training/algorithmSelection.ts` | Preference resolution, snapshots, custom-record conversion and the list of valid alternatives. |
| `src/lib/training/runtime.ts` | Resolves the preferred built-in/custom record, passes it through the unchanged Phase 2B setup verifier, and never writes a default to user storage. |
| `src/lib/training/schema.ts` | Accepts built-in preference references and custom revisions that replace a built-in record, while retaining strict history validation. |

Every built-in case sets both `defaultAlgorithmId` and `generatorAlgorithmId` to
its stable record and keeps `alternativeAlgorithmIds` empty. The catalog
`contentStatus` is `complete`; structural and cube-state validation require one
verified default per standard case. A future notation change must create a new ID
and version with a replacement link, leaving historical snapshots untouched.

#### E13.4 Preference and migration behavior

- A stored `preferredAlgorithms` entry wins. If it references a verified custom
  algorithm, that record is used; if it references the built-in record, the
  read-only default is used.
- With **no stored preference**, resolution chooses the built-in default, not an
  arbitrary older custom algorithm. This is the new-user default and does not
  rewrite `preferences.preferredAlgorithms`.
- Users can switch the preferred algorithm between the built-in default and any
  verified custom algorithm. A new custom algorithm saved against a built-in
  preference becomes a new version (version 2) with `replacesAlgorithmId` pointing
  at the built-in ID, preserving the replacement chain.
- Built-ins are never inserted into `customAlgorithms`, never duplicated on
  startup/reload, and are not written unless the user explicitly selects one as a
  preference. Existing custom algorithms, preferences, attempts, calibrations,
  visits and attribution snapshots remain unchanged.
- Training storage stays schema **v1**, key `cubelab:training:v1`. No migration is
  required. Corrupt/unsupported Training bytes still fail closed without writable
  defaults. Ordinary sessions, settings, backups and Drive behavior are unchanged.
- Attempts capture the resolved built-in/custom snapshot at start, so later
  preference changes or catalog revisions cannot rewrite historical attribution.

#### E13.5 UI integration

Training now reports **57 enabled · 57 with verified algorithms** for OLL and
**21 enabled · 21 with verified algorithms** for PLL for a new user. Edit Cases
shows the built-in default with its notation and verification status, the current
preferred algorithm, and any custom algorithms/revisions. The preferred selector
switches between the built-in and verified custom records; unverified custom
records cannot be selected. The existing 78 SVG designs, case selection, presets,
calibration, statistics and timer flows are unchanged except for this integration.

#### E13.6 Verification

Node 22.23.2, synthetic data, isolated browser contexts:

```bash
npm test -- src/lib/training/catalog/defaultAlgorithms.test.ts \
  src/lib/training/algorithmSelection.test.ts \
  src/lib/training/runtime.test.ts --maxWorkers=2
# 19 passed across 3 files

npm test -- src/lib/training src/components/TrainingPage.test.tsx --maxWorkers=2
# 272 passed across 23 files

npm run typecheck
npm run lint
npm run build
git diff --check
```

- Catalog tests validate all 78 records structurally and against cube states,
  exercise **624** setup combinations (78 cases × execution/recognition × all four
  AUFs), verify OLL 45/56 exact corrections, verify PLL has no extra variants, and
  verify stable IDs/provenance.
- Runtime tests cover built-in execution/recognition for both sets, explicit
  custom preference, custom revision replacement of a built-in, disabled/empty
  pools, recognition's two-case minimum, repeat avoidance and no storage copying.
- Persistence tests round-trip stored built-in preferences, custom replacement
  links and historical attribution snapshots without adding defaults to storage.
- Chromium `e2e/training.spec.ts`: **15/15 passed**, including new-user built-in
  defaults, refresh, PLL count, Edit Cases display, existing custom algorithm
  preservation and the unchanged timer/calibration/recovery/offline workflows.
- `node scripts/training/generate-diagrams.mjs --all --check` verified all 78 SVGs
  and the contact sheet. Aggregate SHA-256 of the 78 SVG files:
  `f8674bbb3337ec07ce7c2ee09440314762c052d59c706a5cb460367967433825`.
  No SVG or diagram generator source changed.
- No ordinary CubeLab solve/session is read or modified by these paths. Browser
  tests assert ordinary session bytes remain unchanged.

#### E13.7 Remaining limits

- Third-party redistribution permission remains unestablished; the functional
  sequence approach is the current mitigation. Legal review/permission is still
  advisable, and this record is not legal advice.
- The 37 additional PLL variants remain excluded. Future alternatives need a
  separate authorization/curation decision.
- Training remains local-only and excluded from ordinary backup/Drive. Built-in
  definitions are application assets, not user records.
- Firefox/WebKit, physical hardware, assistive technology and live Drive were not
  re-exercised for this change; Chromium covered the affected workflows.
- No commit, push, deployment or publication was performed.

---

### E14. Training UI consistency and statistics — 2026-11-10

This owner-authorized UI refinement preserves E11 timing and statistics rules,
E12 checked storage and shared input, and E13's 78 built-in defaults. The
sidebar now consists of Training Setup, Statistics and Attempts. Training
Tools was removed from the Training page. Last Result retains the existing
floating ToolPanel, including its stored drag/resize geometry, run-time
minimization, new-result restoration and narrow-screen docking. Timer's tool
switcher and Draw Scramble continue through their existing paths. Obsolete
Training Tools layout keys are ignored on read.

| Timer system investigated | Previous Training equivalent | Reuse and remaining ownership | Regression risk |
| --- | --- | --- | --- |
| StatsPanel builds memoized Current/Best rows and Timer-only BPA/WPA/targets from delayed session insights | Fixed Training summary and inline expandable case/algorithm tables | StatisticsPanel and StatColumns share the measured layout and theme styles. Each adapter owns its calculations and detail behavior. | Medium |
| SettingsDialog uses row/metric checkboxes and custom average controls in regular settings | Trim and baseline settings only | Training reuses settings fieldsets and checkboxes with category-specific row movement, column toggles and defaults. Training Settings still owns trim and baseline policies. | Low |
| SolveHistory renders compact rows, action menus and measured windowing above 200 entries | 30-item recent list | HistoryPanel, HistoryRow and useHistoryList share counts, scrolling, empty state and windowing. Timer keeps penalties, copy/comments and deletion/Undo. Training opens Attempt Details and retains corrections and attribution. | Medium |
| App owned a 901 px breakpoint, pointer capture, keyboard resize, measured bounds and settings persistence | Sidebar with page-level scrolling | SidebarSplit owns the common grip, content measurement, bounds and pointer/touch/keyboard interaction. Each caller persists its own proportion. Mobile keeps the panels mounted in a stack. | Medium |
| ScramblePanel, TimerStage, ToolPanel, caption and native dialogs | Shared TimerStage and floating frame with separate markup | Training uses the existing scramble classes and loading treatment, timer, caption and dialog patterns. Setup secrecy, calibration and result actions stay Training-specific. | Low |

**Statistics.** The four categories each persist visible row order, Current/Best
column visibility and the recognition series in
`cubelab:training-statistics:v1`. Raw is the default for recognition, with an
explicit saved legacy series used until a new UI preference is written.
Defaults show Single, untrimmed mo3, ao5 and ao12. ao25 and ao100 can be enabled.
Single and rolling rows show the most recent window and fastest eligible finite
window within the selected category. Training Settings retains the default 5%
symmetric ceiling trim and user-configured percentage. Timing rows open their
window details. Counts, success/DNF rates, means, distinct cases, difficult-case
mean and visit improvement use single values. The estimated-only mean is
available in recognition. Missing estimates stay absent, recorded zero remains
valid, DNFs stay DNFs and unsupported history stays out of supported totals.

**Detailed statistics.** Search, sorting and filters are available for all
cases in the active set and for recorded algorithm attributions. Algorithm
rows group by case, ID and revision, with catalog-backed built-in/custom
status, a historical fallback and an assumed-attribution count. Unknown
attribution remains visible in case totals. Recognition tables show both
raw and eligible stored estimates. Improvement compares the latest category
visit with its captured baseline using the Phase 3B matched-case policy.
Detailed rows are built only when their dialog and tab are open.

**Attempts and split.** Newest-first Attempts use the same layout, count and
windowing as Solves, with raw time, DNF, case and an optional stored estimate.
Opening details resolves the live attempt by ID. DNF correction updates the
list and sidebar, and removal drops the row. The sidebar percentage uses
`cubelab:training-sidebar-split:v1` with the shared 36% default. Resize persists
on pointer release or keyboard action. Resizing the window or changing
statistics content clamps the rendered size while preserving the preference.
UI preferences live outside the guarded Training v1 payload.

**Audit fixes.** Removed duplicate controls, long always-visible instructions,
the attempt cap and inline table computation. Statistics display a dash for an
empty DNF denominator. Attempt Details selects attribution by exact ID/revision.
Dialogs close and restore the opener where it remains mounted. The shared
history measures CSS-pixel row heights and observes width as well as height.
The shared split keeps panel identity across the responsive breakpoint and
discards cancelled drags. Calibration uses the shared scramble layout and a
neutral readout until a calibration sample is available. The recognition
preparation component renders setup and fixed precursor; target identity and
diagram render only for execution or a completed attempt.

**Implementation inventory.** New shared files are `StatisticsPanel.tsx`,
`HistoryPanel.tsx`, `SidebarSplit.tsx` and `hooks/useHistoryList.ts`. Training
adds `TrainingSetup.tsx`, `TrainingPreparation.tsx`, `TrainingAttempts.tsx`,
`TrainingStatisticsSettings.tsx`, `TrainingDetailedStatistics.tsx`,
`TrainingTimingDetails.tsx` and `TrainingReportSummary.tsx` under
`components/training/`, plus `statisticsPreferences.ts`,
`statisticsPreferences.test.ts` and `statisticsView.ts` in `lib/training/`.
Updates include `App.tsx`, `index.css`, `StatsPanel.tsx`, `SolveHistory.tsx`,
`TrainingPage.tsx` and its test, `TrainingStatistics.tsx`,
`TrainingDialog.tsx`, `TrainingReportsDialog.tsx`, `CaseDiagram.tsx`,
`AttemptDetailsDialog.tsx`, Training `stats.ts`, `stats.test.ts` and
`format.ts`, and the Training and Timer-stability browser specs.

The remaining UI limits are narrow table scrolling and deliberate desktop
placement of Last Result over the timer. Windowed rendering has functional
coverage. Full-store write costs and long-history stop latency still need
profiling. See [STATUS.md](../../STATUS.md#training-ui-consistency-and-statistics--2026-11-10)
for current verification. No further phase was started.

### E15. Approved Training workspace redesign — 2026-11-11

The owner approved the [redesign blueprint](ui-audit/REDESIGN_PLAN.md) and its
six concepts. Training uses Timer's workspace, Scramble styles, TimerStage,
Statistics rows, history and floating frame. Training Setup and Statistics put
secondary controls in keyboard-accessible heading popovers. The shared splitter
reserves the divider and its margins in addition to 120 px for history. The
sidebar can scroll when the viewport cannot fit both panels.

Training Preparation owns the stable notation track and one progression action
(Begin, Next, Retry, or Resume). Calibration review keeps its seven-sample
controls out of the clock's sizing track. The preview preference is an
independent JSON boolean at `cubelab:training-show-upcoming-case:v1`, on by default.
Failed writes preserve the previous value. Upcoming diagrams and names mount
only for ready execution setups with a matching category and the preference
enabled. The original diagrams, verified algorithms, Training v1 schema,
calibration protocol and calculation rules are preserved.

TrainingController checks category preferences and visit transition in one
candidate. Recovery retries that candidate with its activation intent. Stale
generations cannot restore a setup after a superseding selection or inactivity.
A known-case retry generates the requested case directly. Completion reports
sample review, saved attempt or unsaved attempt. While a correction or delete
is pending, Attempt Details shows the last saved record and exposes recovery
inside the dialog. The report notice opens Practice History directly, and
Attempt Details closes back to the opener inside a report.

The shared ToolPanel projects preferred geometry against current bounds without
rewriting it. Pointer cancellation restores the pre-gesture state. Last Result
docks below a separately sized timing surface at constrained widths and
heights, including interface zoom. The case editor moves focus to the selected
algorithm and returns focus to its case action.

[Verification](../../STATUS.md#approved-training-workspace-redesign--2026-11-11) ·
[Rendered comparisons](ui-redesign/index.html)

#### E15.1. Training attempt action menu — 2026-11-11

Clicking an Attempts row or pressing Enter on it opens the same anchored
menu used by Timer’s Solves history. Right-click uses the browser’s context
menu. The menu offers DNF/success correction, copying the setup,
time or attempt text, full Attempt Details, and typed deletion. The dialog
continues to expose the saved result, algorithm attribution and failed-save
recovery. The menu uses the existing checked controller operations. Timer
and Training share the popup, row anchoring and keyboard navigation.

[Verification](../../STATUS.md#training-attempt-action-menu--2026-11-11)

#### E15.2. Compact Attempt details and deletion with Undo — 2026-11-11

The owner approved the compact dialog preview and requested Timer-style
deletion. The shared dialog shell presents the case and recorded result
together, with a copyable setup, inline attribution editor, and separated
result and delete actions. Recognition retains the estimate, captured median,
and fixed precursor. The menu and dialog delete through the same checked
controller path. On a successful write, the shared notification offers Undo,
including inside an open Practice History dialog. Undo restores the exact
attempt and its original visit membership without increasing renewal counts.
Failed writes retain their candidate and only report success after Retry
save commits it.

[Verification](../../STATUS.md#compact-attempt-details-and-undo--2026-11-11)

### E16. Training Hub and session overhaul plan — 2026-11-11

The owner approved a Training Hub, explicitly started named sessions,
session-scoped practice, mandatory end reports, a read-only archive, and
Algorithms analytics with optional prospective per-algorithm tracking.
This design supersedes the earlier no-named-sessions and automatic-visit
decisions for the overhaul. E15 remains the implemented baseline.

The [implementation plan](overhaul/IMPLEMENTATION_PLAN.md) records the
accepted behavior and remaining design details. The
[progress tracker](overhaul/CURRENT_PROGRESS.md) records the current feature
and handoff.

#### E16.1. O1 persistence decision — 2026-11-11

Keep Training schema v1 and `cubelab:training:v1`. An explicit session is a
visit with an optional versioned `session` configuration containing its name
and one detached algorithm snapshot per selected case. The visit ID owns its
attempts and its starting category identifies the set and practice type. Reuse
the checked active ID, activity and end timestamps, captured baseline policy,
and pending-report flag. Legacy visits, including multi-category ones, keep
their stored attribution, settings and unknown JSON fields. Loading performs
no migration, assigns no names, and writes no bytes.

Attempt snapshots remain authoritative for measured time and calibration.
Recognition calibration can change at a later resume without rewriting earlier
attempts. A session's chosen revisions stay fixed. Capturing a setup revision
does not assign an executed algorithm when attribution is unknown. The named
session's pending flag is set in the same checked save as a nonempty end,
including an all-DNF session. Session report delivery uses the saved visit ID.

O1 implements this in `types.ts`, `schema.ts`, `records.ts`, `visits.ts`,
`storage.ts` and `controller.ts` under `src/lib/training/`. The checked store
requires a saved Begin before attempts or end, preserves the captured
configuration, and protects ended named attempts from edits, deletion and
stale Undo. Legacy automatic transitions and report dismissal act on automatic
visits. For future delivery, `pendingTrainingReports` and
`acknowledgeTrainingReport` accept `'session'` to address named reports.
The previous build's visit validator does not accept the new `manual` end
reason. Compatibility covers reading earlier v1 history in the new build.

Session creation and report delivery through the UI are later phases. Empty
ends retain their visit identity with zero attempt IDs and no pending report.
O6a will omit those visits from the archive and add scoped whole-session
deletion. See the [O1 verification](../../STATUS.md#training-overhaul-o1--2026-11-11).

#### E16.2. O2a session name allocation — 2026-11-11

Use the event display name (including a custom event's label) for Timer and
the set plus practice type for Training. Try the base, then ` (2)`, ` (3)` and
upward. Pick the first available spelling in the current collection. Collapse
whitespace and compare case-insensitively. Reserve room for the suffix within
the 40-character limit. The empty field shows the suggestion, and a blank or
whitespace-only draft resolves to it. Event and category changes preserve a
typed name. Opening or cancelling a draft never reserves a number.

Timer checks the entire current collection, including names brought in by
imports and adopted from sync. Only an actual normalized spelling collision
occupies a slot, so `Practice(2)` and `Practice (2)` are distinct. Typed Timer
duplicates still fail validation. Existing names and session IDs are preserved,
including duplicates already present after sync. The existing creation check
validates against the authoritative collection at save time. A deletion or
rename frees the name for reuse. Training checks its own named visits, including
archived ones. Unnamed legacy visits and Timer sessions do not occupy Training
slots. O3 will resolve and validate the final name when practice begins.

#### E16.3. O2b Training Hub draft — 2026-11-11

Normal Training navigation opens the Hub. It reads the checked Training
preferences and holds its name, set, per-set practice types and case selections
in component state. The case dialog applies to that draft, and cancelling
discards the dialog edits. The Hub reads category statistics from Training
history. Draft edits are discarded on leaving or reloading the Hub. The Hub
has no timer input or setup generation and does not persist its edits.

Until O3, **Open practice workspace** gives explicit access to the E15 flow
with its saved settings. Its same-tab reload behavior is preserved with a
session-storage presentation marker. Existing pending-report and save-recovery
links retain direct access. O3 replaces that transitional entry with Begin,
capturing the draft and one revision per usable selected case before preparing
the first setup. Archive and Algorithms remain in O6a/O6b.

#### E16.4. O3 explicit Begin and session-scoped practice — 2026-11-11

Begin resolves the name against current named visits and captures the usable
pool and its exact preferred revisions. The chosen set, practice type and case
IDs become the saved Hub defaults with the session write. No setup is generated
until that write succeeds. A rejected write retains the same candidate and ID
for Retry save. Generation resolves only the captured revision and verifies the
resulting setup before making the timer ready. If a captured revision is
unavailable, generation fails instead of changing the session's algorithm.

Only Recognition checks calibration at Begin, for its own set. Missing,
invalid or due calibration requires seven accepted samples. O3 retains the
stored calibration's captured renewal thresholds. Renewal threshold settings
apply to the next calibration record. The median and new visit are saved in
one checked update when the seventh sample is accepted. Cancellation discards
the calibration draft and restores the Hub draft. Resume and subsequent
attempts use the valid saved calibration, even when its renewal limit is due.

Practice shows only saved attempts in the active visit, and the clock and
Last Result start empty. Execution retry targets a captured case in the same
visit. Recognition has no cross-category retry. Corrections, deletion and Undo
use the checked writes. Manual End returns to the Hub and queues a pending
report for a nonempty visit. Practice history can review it while O4 owns
delivery. A saved active named session requires a resume/end choice. While
practicing, navigation to Timer or Analytics requires ending first. O4 replaces
this interim behavior with confirmation, queued destinations, inactivity and
continuity handling.

#### E16.5. O4 lifecycle decisions — 2026-11-11

Named practice counts intentional keyboard and pointer input and saved
attempts as activity. Checkpoint input periodically while idle and when the
page is hidden. The Training Settings interval applies to the active named
session and defaults to 15 minutes. Keep practicing restarts the interval and
excludes time after the prompt deadline. An unresolved idle prompt waits for
a choice. Ending from it uses the idle deadline. An explicit
recovery end uses the last durable activity unless a reliable close timestamp
is available. Browser pagehide, unload and restoration do not establish
closure. On explicit resume after a gap at least as long as the idle interval,
exclude the gap since the last durable activity from elapsed practice time.

Keep Training v1 and add optional lifecycle fields for accumulated paused
time and the ended session's report destination. Missing fields retain their
old meanings. Store the destination in the same checked write as the report
flag. Acknowledge the exact report only when Done or Escape succeeds in the
checked store. The required dialog presents one exact named session and no
history list. Legacy reports remain in Practice history, and previously queued
named reports without a destination return to the view they opened over. The
Timer notice is retired. Empty sessions produce neither a report nor a row.

#### E16.6. O5 session report calculations — 2026-11-11

Use successful measured time for the attempt-order chart and signed historical
comparison. The comparison equally weights eligible case-level mean changes,
with three successes on each side across at least three matched cases. A
captured one-case drill uses five successes on each side. Legacy visits without
a saved policy show their measured results and unavailable comparison.

Recognition combined estimates subtract the attempt's captured setup median.
Use the median of at least three successful Execution attempts with the same
case and saved attributed algorithm revision. The historical window is the
session's saved pre-start window. An attempt-count policy selects the prior
case window before identity and outcome filtering. A missing identity or
negative subtraction leaves the split unavailable. Means use only available
values and display their coverage among successful attempts. Reports do not
write or change timing records.

#### E16.7. O6a archive and checked deletion — 2026-11-11

The Hub shows the latest five nonempty named sessions. Practice history starts
with all dates and filters by set, practice type and date. Review and attempt
details are read-only and return to the originating row and filters. Legacy
visits remain readable. Deletion requires typed DELETE and an acknowledged,
ended named session. The checked store accepts only the exact projection of
the selected session and owned attempts. Preserve all other records,
calibrations and renewal high-water counts. Recompute reports against retained
history. A failed write keeps the previous saved archive visible until retry.

#### E16.8. O6b Algorithms analytics — 2026-11-11

Analytics opens to ordinary Solves. The Algorithms view reads only checked
Training history. Execution and Recognition are filtered separately by OLL/PLL
and date. The default is Execution for the saved set and the last 90 local
days. Time progression shows the mean of successful measured attempts by
practice day. Volume counts recorded attempts. Practice history opens with the
current filters, and Start new session opens the Hub without writing. Switching
between Solves and Algorithms keeps each mounted view's filters.

#### E16.9. O7 tracking decisions — 2026-11-11

Training v1 adds an optional tracking preference and an optional flag on each
new attempt. A missing preference means off. A missing attempt flag denotes
historical data and preserves its recorded attribution. Read and migration
perform no backfill. Capture the preference at timing start. Off attempts keep
their verified setup snapshot, carry unknown attribution, and remain case-only
after re-enabling. Recognition reports use saved attribution for any split.

Keep verified preferences for setup generation. With tracking enabled, the
case dialog can choose an exact verified revision for the next session without
changing the preferred revision. Begin captures the choice for the session.
The setting affects subsequent attempts, including within an existing session,
while the captured generation pool remains fixed. The checked store rejects a
new flagged attempt that disagrees with the saved tracking setting and retains
its original flag during correction or Undo. Algorithms groups only saved
attribution by case, algorithm ID and revision. Expand the case row to inspect
revision totals and daily measured progression, even when tracking is off.

#### E16.10. O8 integrated verification — 2026-11-11

`e2e/training-integrated.spec.ts` is the integrated verification entry point.
Its first case seeds structural legacy and named visits, then exercises Begin
and capture, End, the required report, reload, read-only archive review, typed
whole-session deletion and Algorithms recalculation. Its second case seeds 285
attempts over 75 days and checks reports and Algorithms at 1440/1024/390/320 px
in light and dark, keyboard chart inspection, test-dispatched touch selection
and axe serious/critical results. Test-dispatched touch stubs pointer capture
for the synthetic event and does not establish physical-device behavior.

Measurements are single-run observations on that synthetic fixture, not
correctness thresholds: archive review open sampled 27.2/35.8/44.3 ms and
Algorithms open with charts measured 347.6 ms. Report/chart rendering left saved
raw durations and creation times unchanged. The audit found and fixed an
incomplete accessible name on the Algorithms revision toggle. Firefox/WebKit,
physical hardware, assistive technology, live Drive and the 7,000–10,000-solve
profiling matrix were not exercised.

## F. Important unresolved decisions

These matters were unresolved at Phase 0. **F1 is resolved (2026-11-08; see
Section E4), F7 is resolved (2026-11-08; see Section E5), F13 is resolved
(2026-11-08; see Section E9), the approval part of F3 is resolved by the
Phase 2A/2B owner decisions and final E9 verification (see E6, E6.7 and E9), and
F12's internal gate was removed by the owner on 2026-11-10 (E13).** F6/F8/F9/F11
are resolved by the Phase 3B owner decisions in E11. Third-party redistribution
permission in F12 remains a documented legal risk, not a granted licence. Other
remaining rows are unresolved; do not present them as finalized.

| # | Decision | Current state | What is needed |
| --- | --- | --- | --- |
| F1 | Exact OLL starting F2L visual configuration | **RESOLVED 2026-11-08** — verified FR edge at UR orientation 0 and DFR corner at UFR orientation 2; reference image coloured cells match (see E4) | None for setup math. Prescribed moves unchanged. Catalog identity remains F3 |
| F2 | CubeSkills algorithm redistribution permission | Not pursued for algorithm data — the owner selected the Heroor/Tao sources in Phase 2A. In the Phase 2C redesign the owner selected CubeSkills-style OLL/PLL diagrams only as **internal visual references**; no CubeSkills artwork or algorithm data is bundled | Retain historical record. Do not copy CubeSkills artwork or content; E13 records the separate algorithm-data provenance limitation |
| F3 | Algorithm catalog sourcing and approval process | Historical approvals retained (E6/E6.7). Final independent review (E9) mathematically verifies all **78/78** selected defaults using B for OLL 56: 57 OLL and 21 PLL, plus 37/37 additional PLL variants separately. Phase 2C case identities and all 78 static diagrams are complete. The owner removed the internal restriction and E13 now bundles the 78 defaults as an independently assembled functional-sequence catalog. The 37 additional PLL variants remain excluded | Keep the E13 provenance/legal limitation visible; do not add the extra variants without separate authorization |
| F4 | Algorithm visibility during execution-only training | Phase 0 recommended showing target algorithm and hiding case diagram; not approved | Owner decision; recognition mode must still hide target |
| F5 | Training cloud-sync inclusion in V1 | Phase 0 recommended local + native backup and deferring Drive sync | Owner decision; if included, design retention/tombstones/size/sync protocol |
| F6 | Calibration reference-state fidelity | **RESOLVED 2026-11-09 (E11)** — fixed inverse precursor setup from solved, time precursor only, exactly seven positive valid samples/median; no random AUF/cases | Future UI must preserve this protocol |
| F7 | Reuse `cubing.js` directly vs specialized cubie model | **RESOLVED 2026-11-08** — thin CubeLab wrapper over the `cubing.js` 3x3x3 KPuzzle/KPattern; no second simulator (E5) | None for Phase 1. Re-run Phase 1 coverage if the cubing.js definition/API changes |
| F8 | Calibration activation and renewal | **RESOLVED 2026-11-09 (E11)** — mandatory initial recognition calibration per set, optional due renewal by default, shared forced-renewal toggle OFF, captured thresholds, deletion-safe counters; explicit missing/invalid/below/DNF states | Application/timer integration remains future work |
| F9 | Report baselines and trimming | **RESOLVED 2026-11-09 (E11)** — configurable previous X days/attempts (90 days default); case/category matching, explicit insufficient history, 5% symmetric ceiling trimming; recalculated reports with captured policy | Descriptive comparisons with explicit matched coverage; no significance claim |
| F10 | Training data retention/size policy | Raw attempts can pressure localStorage/10 MB backup cap | Decide retention/aggregation/separate export before cloud sync |
| F11 | Training inspection/penalties | **RESOLVED 2026-11-09 (E11)** — no inspection or +2; successful raw duration or DNF; exclude DNFs from successful metrics | Future manual DNF UI and shared timer bypass must be implemented/tested |
| F12 | Redistribution rights for the approved Heroor OLL and Tao PLL algorithm data | **OWNER GATE REMOVED 2026-11-10; THIRD-PARTY PERMISSION STILL UNESTABLISHED.** Heroor has a README-only MIT claim and no LICENSE file; Tao has an MIT software license but credits AlgDb for other algorithms. E13 bundles only the 78 owner-approved functional sequences as an independently assembled catalog, records source provenance, and asserts no third-party redistribution licence. This is a risk-reduction approach, not a grant of rights (see E13.2) | Obtain written permission or legal review if broader redistribution is required; retain provenance/attribution and do not add the 37 extra variants without separate authorization |
| F13 | Exact OLL 56 default and renewed verification | **RESOLVED 2026-11-08 (E9)** — owner explicitly approved B, `r U r' (U R U' R')2 r U' r'`; it verifies as OLL 56 `1212\|1010` with F2L preserved. Earlier A/D break F2L; historical C solves OLL 54. Earlier approvals and the transcription error remain preserved in E8/E9 | None for the OLL 56 default. Keep the superseded strings only as history; do not reintroduce them |

Unresolved items must stay visibly separate from confirmed requirements. A future
session must not silently choose one and present it as owner-approved.

---

## G. Phased development plan

**Current override (E12):** the owner expanded Phase 4 to include the complete
UI, algorithms, calibration and reports described in the older Phases 5–7 below.
That authorized scope is complete; those older phase splits remain historical.
No subsequent phase or release gate is authorized automatically.

**Phase 0 is complete.** It was planning/audit only. **Pre-Phase 1 is complete
(2026-11-08; see Section E4). Phase 1 is complete (2026-11-08; see Section E5).
Phase 2A, the approved algorithm/licensing audit, is complete (2026-11-08; see
Section E6). Phase 2B, the catalog/setup-generation foundation, is complete
(2026-11-08; see Section E7). Phase 2C, the complete case-definition and static
diagram collection, is complete (2026-11-09; see Section E9.15). The original
5×5 previews were rejected and replaced by compact 3×3 diagrams (Section E9.6).
The first OLL-only refinement (E9.7) misinterpreted the request and was corrected
in Section E9.8: the whole 3×3 face, including its outer border, now uses the
lighter line weight. The owner requested E9.9 and the PLL visual refinement in
E9.10, then the T-centring, flush-sticker, line-weight and corner-join
refinements in E9.11–E9.14. **Both OLL and PLL styles are now owner-approved,
and all 78 static diagrams are generated, verified and visually reviewed.** The
owner removed the internal F12 bundling restriction on 2026-11-10; E13 now
supplies the 78 read-only built-in defaults, while explicit third-party
redistribution permission remains unestablished. Phases 3A/3B, Phase 4 and E13
are complete (E10/E11/E12/E13). The phases below are historical unless explicitly
marked; no subsequent release gate is authorized.

### Pre-Phase 1 — Recognition Setup Validation — COMPLETE (2026-11-08)

**Status: COMPLETE.** Actual OLL visual/state verification and exhaustive Sune
coverage were performed and recorded in Section E4. The prescribed moves are
unchanged. Phase 1 was not started automatically by that task.

**Purpose**

Before implementing the training engine, verify the recognition setup math and
visual configuration against the owner’s reference.

**Scope**

- Use the saved owner reference image at
  `docs/training/references/f2l-oll-recognition-reference.png`; it is the
  reference for the intended final F2L insertion configuration using
  `U (R U' R')`.
- Construct the prescribed OLL pre-insertion state using temporary verification
  tooling, not application code.
- Compare the generated F2L configuration to the saved reference image.
- Do not publish or redistribute the reference image without confirming
  appropriate rights.
- Verify three F2L slots are solved and the final pair is in the intended fixed
  insertion configuration.
- Verify executing exactly `U R U' R'` produces the selected OLL case with F2L
  solved.
- Validate the fixed Sune precursor `R U R' U R U2 R'` for PLL:
  - construct `P = L · Q⁻¹`;
  - verify `Q(P) = L`;
  - verify F2L solved;
  - verify the pre-state does not expose the PLL in normal oriented form;
  - cover all 21 PLL cases (or a documented representative set followed by all
    21 before completion).
- Record evidence, commands, and results in this memory.

**Dependencies:** None; Phase 0 is complete.

**Relevant files:** Temporary scripts/tests outside application code; then update
this memory. Do not modify application code for this validation.

**Acceptance criteria**

- Actual visual/state verification has occurred.
- The OLL generated state either matches the saved reference image or the
  mismatch is clearly documented and escalated.
- The fixed Sune precursor is validated for all 21 PLL cases.
- Prescribed moves are unchanged.
- Evidence is recorded in this memory.

**Verification/tests**

- Temporary deterministic cube-state probes using the same move convention as
  the planned model.
- Record exact sequences, piece positions/orientations, signatures, and results.
- Do not run full application suites for this documentation/probe task.

**Completion condition**

Actual verification completed and recorded. **Completed 2026-11-08; evidence in
Section E4.**

**Next after completion:** Phase 1 was subsequently authorized and completed
2026-11-08; see E5. The next phase is Phase 2, only after explicit authorization.

### Phase 1 — Cube model, notation, and case mathematics — COMPLETE (2026-11-08)

**Status: COMPLETE.** Pure foundations implemented in `src/lib/training/` with
focused Vitest coverage and independent regression verification against E4. No
Training UI, catalog content, training storage, or existing Timer behavior was
added or changed. Details and evidence are in E5.

**Purpose/scope**

- Pure 3×3 cubie model: corners/edges, positions/orientations, face turns,
  wide/slice/rotation support or explicit restrictions.
- Notation parser/normalizer and AUF/cube-orientation helpers.
- OLL/PLL signature functions, F2L checks, fixed FR-slot/pre-insertion checks.
- Prove/test `P = O · I⁻¹` and `P = L · Q⁻¹` with representative fixtures and the
  Pre-Phase 1 evidence.
- Build the case-space coverage test harness.
- No catalog content, no UI, no training storage.

**Dependencies:** Pre-Phase 1.

**Relevant files:** `src/lib/training/cube3.ts`, `notation.ts`,
`caseSignature.ts`, `caseSpace.ts`, and their focused tests.

**Acceptance criteria**

- Random move sequences match `cubing.js` KPattern as an oracle.
- OLL insertion test shows three F2L slots solved, fixed pre-insertion FR pair,
  and exact return to the OLL state.
- PLL Sune test shows F2L solved, pre-state not OLL-oriented, and exact return to
  the PLL state.
- Case signature canonicalization is stable under U rotations and rejects
  malformed states.

**Verification/tests:** focused Vitest for cube model, notation, signatures,
OLL/PLL construction; typecheck/lint.

**Completion condition:** Pure model and math tests pass; no application behavior
changed.

**Completion evidence (2026-11-08):** `npm run typecheck` and `npm run lint`
passed (lint retained one pre-existing `SessionPanel.tsx` purity warning);
28 focused training tests passed; the original Pre-Phase 1 script reproduced its
saved output exactly; an independent Vite-SSR script loaded the implementation and
passed 28/28 hardcoded E4 checks. See E5 for commands and limitations.

### Phase 2 — Owner-approved catalog, algorithms, and static diagrams — PHASE 2A + 2B + 2C COMPLETE; F12 GATE SUPERSEDED BY E13 (2026-11-10)

**Status: PHASE 2A AUDIT, PHASE 2B FOUNDATIONS, AND PHASE 2C CASE/DIAGRAM
COLLECTION ARE COMPLETE (PHASE 2C 2026-11-09).** The owner approved the Heroor
OLL and Tao PLL source candidates, the OLL 45 correction, the final OLL 56
string B (E9), and both finalized OLL/PLL diagram designs. The complete 57 OLL +
21 PLL mathematical case table, conventional PLL representatives, deterministic
diagram generator, and all **78 static SVGs** are implemented. The ten approved
preview assets are byte-identical after full generation. Algorithm-data
redistribution rights remain unresolved (F12), so algorithm records stay
unbundled. Phases 3A/3B are complete (E10/E11); Phase 4 has not started.

**Phase 2A completed scope**

- Extracted the 57 OLL and 21 PLL records, preserved raw source notation,
  normalized notation without changing move semantics, and verified every
  approved default against independent case definitions.
- Audited wide moves, slices, rotations, group repetition, prime-before-2 tokens,
  AUF/orientation conventions, and source `.c` diagrams.
- Reviewed code licenses and algorithm-data provenance separately.
- Produced the case-by-case results in E6.4. No catalog, diagram or UI files were
  added.

**Phase 2B completed scope**

- Implemented stable case/algorithm types, versions/replacement links, defaults,
  alternatives, generators, provenance/correction/approval metadata, verification
  metadata, catalog version and explicit content status.
- Implemented the 22-class standard PLL named identity and preserved the Phase 1
  72-class post-AUF-only signature unchanged.
- Implemented group-repetition expansion, compact source normalization,
  prime-before-2 normalization, and state-based frame normalization.
- Implemented catalog validation, referential-integrity and revision invariants,
  provenance checks, and the unresolved-redistribution gate.
- Implemented verified execution-only and recognition setup generation for OLL
  and PLL with exact case/F2L/precursor checks and bounded retries.
- Verified all 288 PLL states → 22 classes, all 216 OLL orientation states, the
  fixed OLL insertion and Sune precursor, 21 named PLL algorithms through frame
  normalization, 21/21 PLL defaults, 37/37 additional PLL variants, and 56/57
  OLL defaults at that checkpoint. Full evidence is in E7.

**Phase 2C completed scope**

- Added `src/lib/training/catalog/standardCases.ts`: 57 OLL signatures,
  21 named PLL cases, conventional PLL diagram representatives, AUF metadata,
  deterministic families and static-asset references. No algorithm strings.
- Added the presentation-only facelet and permutation-arrow layers, the
  diagram-spec builder/validator, and the development-time renderer/generator.
- Generated and committed all **78** static SVGs: 57 OLL and 21 PLL. OLL skip
  and PLL skip are excluded.
- Preserved the ten approved preview assets byte-for-byte and retained their
  historical contact sheet. Added the complete light/dark, 128/64 px contact
  sheet `docs/training/previews/phase-2c-all-diagrams.html`.
- Extended asset-content tests from the ten previews to all 78 committed files
  and visually reviewed the full collection at both sizes and surfaces.

**Remaining Phase 2C scope**

- None for case definitions or static diagrams. **F12 remains unresolved** and
  blocks adding the owner-approved OLL/PLL algorithm records or any additional
  PLL alternatives to a distributable catalog.
- Both OLL and PLL visual styles are owner-approved. The only visual exceptions
  are the documented Gb/Gd head-overlap pair at the crowded G-perm centre; no
  SVG redesign is authorized by the completion task.

**Dependencies:** Phase 1, Phase 2A, Phase 2B and Phase 2C (all complete); F13
resolved by E9; owner visual approval of both OLL and PLL styles (complete);
F12 for algorithm records. Phase 3A was separately authorized and is complete;
Phase 3B is now complete (E11); Phase 4 requires a subsequent request.

**Relevant files:** completed foundation in `src/lib/training/{frame,pllIdentity,
caseState,algorithms,setupGeneration}.ts` and `src/lib/training/catalog/*`;
Phase 2C adds `src/lib/training/catalog/standardCases.ts`,
`src/lib/training/diagrams/*`, `scripts/training/*`,
`src/assets/training/diagrams/*`, and `docs/training/previews/*`. Algorithm
content records remain absent by design.

**Acceptance criteria (full Phase 2)**

- 57 OLL + 21 PLL cases with unique stable IDs/signatures, groups, diagrams.
- Every bundled algorithm validated up to AUF; every case has a verified
  generator.
- Every case × execution/recognition generates a verified setup.
- All 78 SVG assets exist, parse, have correct dimensions/sticker data, and
  contain no scripts/external references.
- Licensing approval/attribution recorded, or missing content is explicitly
  disabled with an honest state.

**Verification/tests:** Phase 2B foundation evidence is in E7. Phase 2C
completion evidence is in E9.15: all 78 assets and the complete contact sheet
pass `--all --check`; 125/125 Training tests and 25/25 renderer/SVG tests pass;
typecheck and lint pass; all 78 diagrams were visually reviewed at 128/64 px on
light/dark.

**Completion condition:** Phase 2C case definitions and diagrams are complete.
The Phase 2 content gate still requires F12 resolution before algorithm records
are bundled; no missing/incorrect case may silently ship.

### Phase 3 — Training data model, persistence, and pure domain logic

**Phase 3A is COMPLETE (E10); Phase 3B is COMPLETE (E11).** Records,
checked local persistence and pure calibration/statistics/visit/report decisions
are implemented. No app-mounted `useTraining` or browser orchestration exists;
those portions of the original scope below remain future work. Stop after 3B;
Phase 4 needs a subsequent explicit request.

**Purpose/scope**

- Training schema/types, checked storage parser/migrations/recovery.
- Preferences, presets, custom algorithms, hard cases.
- Category-keyed stats, calibration calculations/due logic, visit lifecycle,
  report generation.
- `useTraining` hook with local persistence and storage-health handling.
- No training UI yet.

**Dependencies:** Phase 2 for stable case/algorithm IDs; Phase 1.

**Relevant files:** `src/lib/training/types.ts`, `storage.ts`, `stats.ts`,
`calibration.ts`, `presets.ts`, `visits.ts`, `reports.ts`,
`src/hooks/useTraining.ts`, tests.

**Acceptance criteria**

- Four categories remain structurally separate; attempts retain category
  permanently.
- Calibration exactly 7 samples/median/due rules/snapshot behavior passes unit
  tests.
- Visit lifecycle and report baselines are deterministic and testable.
- Storage round trip/migration/recovery preserves invalid raw bytes and never
  autosaves an empty fallback.
- Training key is isolated from sessions/settings.

**Verification/tests:** focused Vitest for all domain modules; typecheck/lint.

**Completion condition:** Domain/hook behavior reviewed and stable; no UI
required.

### Phase 4 — Training page shell and shared timer integration

**Purpose/scope**

- Add `Training` to `AppView`, header nav, header context, and App view handling.
- Lazy-load `TrainingPage`; add `useTraining` at App level.
- Route timer completion by view; add training `latestResult` to `TimerStage`.
- Build Training Setup shell (set, preset selector placeholder, selected count,
  setup toggle, calibration status placeholder), Training scramble panel, footer,
  responsive workspace.
- Basic attempt recording and hidden-case behavior.
- Add `useScramble` enabled flag or equivalent.
- Extend global keyboard/modal/navigation guards.

**Dependencies:** Phases 1–3.

**Relevant files:** `App.tsx`, `AppHeader.tsx`, `TimerStage.tsx`,
`useScramble.ts`, `TrainingPage.tsx`, `TrainingSetupPanel.tsx`,
`TrainingScramblePanel.tsx`, `useTraining.ts`, CSS, tests.

**Acceptance criteria**

- Navigate Timer ↔ Training ↔ Analytics; timer cannot change view while active.
- Space/hold/release/stop works in Training and records a training attempt, not a
  session solve.
- Recognition mode hides case/target and shows the mandatory precursor;
  execution mode behaves as configured.
- Changing set/preset/mode regenerates a verified setup; no session/event
  changes.
- Existing Timer behavior remains intact.

**Verification/tests:** typecheck/lint; component tests; Playwright training
navigation/start/stop/hidden case; focused `timer`, `timer-response`,
`responsive-timer`, `accessibility` regressions.

**Completion condition:** Basic training loop works with no session data
contamination.

### Phase 5 — Case selection, presets, case details, and attribution

**Purpose/scope**

- Case selection dialog for all 78 cases, group selection, select all/none,
  count, disabled/missing-catalog states.
- Built-in family presets, user preset create/rename/edit/delete/select,
  hard-cases virtual preset.
- Case details dialog: diagram, preferred algorithm, alternatives, custom
  algorithms, validation, per-case stats, recent attempts, hard marker,
  train-this-case.
- Attempt history with case/time/attribution/actions; attribution correction and
  Unknown.
- Per-case/per-algorithm stats panel.
- Verify changing preset/cases never resets global stats.

**Dependencies:** Phases 2–4.

**Relevant files:** `CaseSelectionDialog.tsx`, `PresetManagerDialog.tsx`,
`CaseDetailsDialog.tsx`, `TrainingStatsPanel.tsx`,
`TrainingAttemptHistory.tsx`, `presets.ts`, `algorithms.ts`, tests.

**Acceptance criteria**

- All 78 cases selectable/trainable; missing cases explicit, not silently wrong.
- User presets persist and CRUD works; built-ins immutable.
- Hard cases update dynamically.
- Preferred algorithm is an assumption; historical attribution never changes
  except explicit correction.
- Unknown attempts count in case stats but not algorithm comparisons.
- Preset changes do not alter cumulative stats.

**Verification/tests:** unit/component/Playwright for presets, selection,
attribution, algorithm validation, stats non-reset.

**Completion condition:** Complete selection/preset/algorithm management with
correct stats separation.

### Phase 6 — Calibration UI, Last Result panel, and floating panels

**Purpose/scope**

- Calibration page mode using the shared timer: exactly 7 valid reps, median,
  discard/retry, progress, cancel, due thresholds, manual recalibration.
- Generalize floating panel frame/layout from ToolPanel; add Training Tools
  bottom-left and Result bottom-right defaults; separate local keys.
- Training Result panel: compact content, minimize/close, auto-minimize on next
  start, restore on completion, Retry/Mark Hard/Details.
- Responsive docking on narrow screens; no timer movement.
- Ensure panels do not interfere with pointer/keyboard/timer.

**Dependencies:** Phases 3–5.

**Relevant files:** `CalibrationPanel.tsx`, `TrainingResultPanel.tsx`,
`FloatingPanelFrame.tsx`, `useFloatingPanelLayout.ts`, `ToolPanel.tsx`,
`TimerStage.tsx`, CSS, tests.

**Acceptance criteria**

- Calibration exactly 7 valid samples, median, invalid rep discard, no training
  attempt/report entries for calibration reps.
- Missing/invalid calibration blocks recognition; due renewal follows the shared
  forced-renewal setting (OFF by default). Manual recalibration commits only
  after seven valid samples, preserving prior calibration history (E11).
- Result panel shows the previous case, never the upcoming one; auto-minimize/
  restore; close hides until next result.
- Panel drag/resize/clamp/persistence works; defaults do not overlap; timer
  coordinates unchanged through panel actions.
- Narrow layout keeps the readout unobstructed.

**Verification/tests:** unit/component/Playwright; `draw-scramble`,
`timer-stability`, responsive, accessibility regressions.

**Completion condition:** Full V1 training loop works with calibration and result
panel.

### Phase 7 — Automatic visits and practice reports

**Purpose/scope**

- Active visit start/resume/finalize; short-refresh resume; stale finalization;
  zero-attempt discard.
- Visit ID on attempts; report generation with category/case/algorithm sections,
  case-matched baselines, equal-case weighting, insufficient-data states,
  estimated-adjusted labels.
- Compact “Practice report ready” toast with View report; report dialog/list;
  historical reports from Training.
- Navigation is never blocked by a mandatory report.

**Dependencies:** Phases 3–6.

**Relevant files:** `visits.ts`, `reports.ts`, `useTrainingVisit.ts`,
`TrainingReportDialog.tsx`, `TrainingReportsList.tsx`, App toast wiring, tests.

**Acceptance criteria**

- Entering Training starts/resumes a visit; leaving ends it; zero valid attempts
  creates no report.
- Refresh before inactivity is due resumes the same visit; inactivity ends at
  last activity plus the captured timeout. Confirmed closure finalization follows
  E11, with explicit continuity signals and running-attempt deferral.
- Reports never combine execution and recognition; comparisons are
  case-matched/same-algorithm; insufficient data is explicit.
- Toast/report access works without blocking navigation; historical reports
  remain available.

**Verification/tests:** unit/component/Playwright; synthetic attempt histories;
refresh/resume/stale scenarios.

**Completion condition:** Automatic reports are reliable and honest.

### Phase 8 — Persistence integration, recovery, performance, and release gate

**Purpose/scope**

- Native backup optional training section; preview/restore; older backups
  preserve local training; replacement coordinator integration.
- Training reset action isolated from solve resets; storage recovery; onboarding
  detection.
- Cross-tab training adoption; optional Drive sync only if authorized (otherwise
  document deferral and design).
- Size/performance profiling; retention/aggregation decision before cloud sync.
- Production offline verification; docs; full release verification.

**Dependencies:** Phases 1–7; explicit authorization for Drive sync/live testing.

**Relevant files:** `backup.ts`, `DataDialog.tsx`, `storage.ts`,
`replacement.ts`, `onboarding.ts`, optional `sync.ts`/`useSync.ts`, docs, tests.

**Acceptance criteria**

- Training survives reload; native backup round trip preserves
  attempts/calibrations/visits/reports/presets/algorithms.
- Older backups do not erase local training; malformed training rejects before
  mutation.
- Solve/session resets never touch training; training reset never touches
  solves/settings.
- Corrupt training data has a recovery state and is not silently cleared.
- Cross-tab adoption does not occur during active timing.
- Training assets/chunk work offline in the production PWA.
- 10k/50k attempt size/performance is measured; any retention/sync limit is
  explicit.
- Docs updated; focused tests and final full verification pass.

**Verification/tests:** backup/storage/cross-tab/onboarding/Playwright;
production offline; full `npm run check` once at the release gate.

**Completion condition:** V1 release gate passes with no mixed statistics, no
unlicensed content, and no silent data loss.

### Dependency order

```text
Phase 0 (complete)
  -> Pre-Phase 1 (complete)
  -> Phase 1 (complete)
  -> Phase 2A audit (complete)
  -> Phase 2B foundations (complete)
  -> Phase 2C case definitions + all 78 owner-approved diagrams (complete)
  -> Phase 3A data/persistence foundation (complete; no bundled content needed)
  -> Phase 3B pure calculations/domain logic (complete; no app orchestration)
  -> Phase 4
  -> Phase 5
  -> Phase 6
  -> Phase 7
  -> Phase 8 (release gate)
```

The separate Phase 2 algorithm-record content gate (F12) blocked shipping
bundled algorithm data until the owner removed the internal restriction on
2026-11-10; E13 now supplies the read-only defaults. It did
not block the explicitly authorized Phase 3A local domain foundation. Third-party
redistribution permission remains a separate, unestablished legal question. V1
cannot ship until the approved catalog and all 78 static assets pass validation
and data integration/recovery gates are complete.

---

## H. Current repository status

**As inspected on 2026-11-08:**

- **Branch:** `master`
- **HEAD:** `0167bb04b26a67d27c9810d7c589465b62d13b73`
  (`fix: harden persistence recovery and enforce single-tab ownership`)
- **origin/master:** same commit, `0 ahead / 0 behind`
- **Working tree:** dirty. Do not assume a clean checkout.

### Pre-existing uncommitted onboarding work

Before this documentation task, `git status --porcelain` reported:

**Modified:**

- `AGENTS.md`
- `FEATURES.md`
- `KNOWN_LIMITATIONS.md`
- `README.md`
- `STATUS.md`
- `e2e/cross-tab-timing.spec.ts`
- `e2e/timer.spec.ts`
- `playwright.config.ts`
- `src/App.tsx`
- `src/bootstrap.tsx`
- `src/components/SettingsDialog.test.tsx`
- `src/components/SettingsDialog.tsx`
- `src/index.css`
- `src/lib/backup.ts`
- `src/lib/sessions.ts`
- `src/lib/sync.ts`

**Untracked:**

- `e2e/onboarding.spec.ts`
- `e2e/storage-state.json`
- `src/components/Onboarding.test.tsx`
- `src/components/Onboarding.tsx`
- `src/lib/backupLimits.ts`
- `src/lib/onboarding.test.ts`
- `src/lib/onboarding.ts`
- `src/lib/onboardingCloud.ts`

The Training documentation set now includes:

- `docs/training/PROJECT_MEMORY.md` (authoritative complete memory);
- `docs/training/CURRENT_STATUS.md` (short working-context entry point);
- `docs/training/references/f2l-oll-recognition-reference.png` (owner reference
  image; internal development asset);
- the Training memory workflow in `AGENTS.md` (documentation-only edit).

**Pre-Phase 1 verification task (2026-11-08):** modified only
`docs/training/PROJECT_MEMORY.md` and `docs/training/CURRENT_STATUS.md`. It did
not modify application code, dependencies, the onboarding work, or any other
tracked file. Temporary verification scripts were kept outside the repository.

**Phase 1 implementation task (2026-11-08):** created the pure Training
foundation modules and tests under `src/lib/training/`:

- `notation.ts`, `cube3.ts`, `caseSignature.ts`, `caseSpace.ts`;
- `notation.test.ts`, `cube3.test.ts`, `caseSignature.test.ts`.

It also updated `docs/training/PROJECT_MEMORY.md` and
`docs/training/CURRENT_STATUS.md`. It did not modify application wiring, Timer
behavior, sessions/settings/backup/sync, dependencies, UI, onboarding files, or
the reference image. The new training files are untracked in the current dirty
working tree.

**Phase 2A audit task (2026-11-08):** modified only
`docs/training/PROJECT_MEMORY.md` and `docs/training/CURRENT_STATUS.md`. It did
not create catalog/diagram/UI/storage files, add dependencies, or copy the
third-party algorithm datasets into the repository. Audit scripts and the
full raw/normalized report were kept outside the repository under
`/tmp/opencode/` and are not application content. The pre-existing onboarding
work and all unrelated changes were preserved.

**Phase 2B implementation task (2026-11-08):** added only pure Training modules
and tests under `src/lib/training/`:

- `frame.ts`, `pllIdentity.ts`, `caseState.ts`, `algorithms.ts`,
  `setupGeneration.ts`;
- `catalog/types.ts`, `catalog/pllCases.ts`, `catalog/ollCases.ts`,
  `catalog/validation.ts`, `catalog/stateValidation.ts`, `catalog/index.ts`;
- `frame.test.ts`, `pllIdentity.test.ts`, `catalog/catalog.test.ts`,
  `setupGeneration.test.ts`, plus catalog-notation and pre-AUF coverage in
  `notation.test.ts`/`caseSignature.test.ts`.

It also updated the two Training memory documents. It did not modify application
wiring, Timer behavior, sessions/settings/backup/sync, dependencies, UI,
onboarding files, or the reference image. No third-party algorithm data, static
diagrams, catalog content records, or training persistence were added. The
approved OLL/PLL sources were read only through a temporary Vite-SSR verification
script outside the repository (`/tmp/opencode/phase2b_verify_external.mjs`).

**Phase 2C case/preview checkpoint (2026-11-08):** added only pure Training
case/diagram modules, tests, development scripts, static assets and docs:

- `src/lib/training/catalog/standardCases.ts` (+ test);
- `src/lib/training/diagrams/{facelets,arrows,buildDiagramSpec}.ts` (+ tests);
- `src/lib/training/catalog/types.ts` and `caseState.ts` gained an optional
  conventional `representativeSignature` for display while preserving the named
  identity;
- `scripts/training/{renderDiagram.mjs,generate-diagrams.mjs,renderDiagram.test.mjs}`;
- ten static SVGs under `src/assets/training/diagrams/{oll,pll}/`;
- `docs/training/previews/phase-2c-diagrams.html`;
- `src/lib/training/catalog/index.ts` re-export and
  `catalog/stateValidation.ts` wording only.

No application wiring, Timer behavior, sessions/settings/backup/sync,
dependencies, Training UI, persistence, calibration or statistics were changed.
No third-party algorithm strings or diagrams were copied. The remaining 68 SVG
assets were not generated. Pre-existing onboarding work was preserved.

**OLL-only visual refinement (2026-11-08, superseded by E9.8):** changed only
the OLL rendering path in `scripts/training/renderDiagram.mjs`, the five OLL
preview SVGs (`oll-01`, `oll-27`, `oll-45`, `oll-56`, `oll-57`), the focused
renderer/asset tests and the two Training memory documents. That pass used a
96 px face, 28 px cells, 4 px outer border, 2 px internal dividers, 5.5 px side
bars with a 1.5 px outline, and `#FFF200` yellow; it misinterpreted the owner's
request by keeping the outer border bold.

**OLL stroke-weight correction (2026-11-09):** the five OLL previews and contact
sheet were regenerated with a 92 px face at `(18, 18)`, a matching 2 px outer
border and 2 px internal grid, 5 px side bars with a 1.25 px outline and 3 px
gap, and the same `#FFF200` yellow. PLL geometry, palette and SVG assets are
unchanged (SHA-256 hashes matched). The remaining 68 SVGs were not generated and
no application wiring, Timer, persistence, UI, dependency or third-party content
was changed.

**PLL arrow length/alignment correction (2026-11-09):** changed only the PLL
double-headed edge-arrow clearance in `scripts/training/renderDiagram.mjs`, the
T/H/Z PLL preview SVGs, the contact-sheet PLL wording, the focused
renderer/asset tests and the two Training memory documents. `pll-ua.svg` and
`pll-gc.svg` remained byte-identical, as did all five OLL SVGs. The T-perm
vertical corner arrow remains exactly `M 97 77 L 97 51`; only its horizontal
edge swap and the H/Z double edge swaps were lengthened. No case signature,
algorithm, palette, sticker position, Gc/Ua routing, OLL asset, other diagram,
Training UI, persistence, dependency or runtime application file changed. The
remaining 68 SVGs were not generated.

**Phase 2C completion (2026-11-09):** generated the remaining 68 SVGs, bringing
the committed set to 57 OLL + 21 PLL (78 total), extended asset tests to all 78,
added the complete contact sheet, and preserved the ten approved preview assets
byte-identically. Both visual designs are owner-approved. See E9.15. F12 remains
unresolved; no algorithm records, Phase 3, commit, push, deploy or publication.

### Risks associated with ongoing onboarding development

- The onboarding implementation is **uncommitted**. It touches core application
  wiring (`App.tsx`, `bootstrap.tsx`), settings, backup, sync, CSS, tests, and
  docs. Do not revert, overwrite, or assume the `origin/master` versions of these
  files.
- Training integration must inspect the current working-tree files, not just the
  committed baseline.
- `e2e/storage-state.json` is an untracked test artifact. Preserve it unless the
  owner explicitly authorizes cleanup.
- Existing unrelated changes must remain intact throughout Training work.
- `STATUS.md` records onboarding verification; that record is not re-run by this
  training task. Do not claim full-suite verification for Training or onboarding
  based on this memory alone.
- Phases 1, 2B and the Phase 2C preview checkpoint added pure modules, tests and
  static preview assets. Later Phase 2C completed all 78 assets, Phase 3A added
  local data/persistence foundations (E10), Phase 4 added the mounted UI (E12),
  and E13 added the built-in default catalog. Do not infer anything beyond those
  dated checkpoints from these modules or assets.

---

## I. Immediate next task

**Overhaul O1 through O8 are complete.** Integrated verification and
documentation are complete; no overhaul phase remains. There is no next
implementation task without owner authorization. Start from the
[progress tracker](overhaul/CURRENT_PROGRESS.md) if a follow-up is requested.
E15 records the existing practice workspace. E12 records the Phase 4 UI/timer/persistence boundaries.
E13 records the 78 default algorithms, preference resolution, provenance and
legal limitation. E16.10 records the integrated verification scope and limits.
Review STATUS.md for exact verification. The owner removed the
internal F12 restriction, but third-party redistribution permission remains
unestablished; obtain legal review/permission before broader redistribution. The
remaining backup/recovery/retention/performance/release prerequisites still need
separate authorization. Do not begin Phase 5, commit, push, deploy or publish
automatically. Preserve unrelated working changes.

### Phase 1 — COMPLETE (2026-11-08)

The pure cube-state, notation, AUF/case-signature, F2L, OLL insertion, and Sune
PLL precursor foundations are implemented in `src/lib/training/` and verified
against Section E4. The implementation reuses the `cubing.js` 3x3x3
KPuzzle/KPattern rather than adding a second simulator. Details, commands,
28-test Vitest result, byte-identical Pre-Phase 1 rerun, and independent 28/28
E4 checks are in E5.

No Training UI, catalog, static diagrams, training storage, calibration, or
statistics were added. No Timer behavior or existing application data path was
changed.

### Phase 2A — Approved algorithm catalog audit — COMPLETE (2026-11-08)

The owner approved the Heroor OLL (all 57 records) and Tao PLL (first
slash-separated variant for all 21 cases) source candidates. The audit extracted
and normalized the original notation, preserved raw source strings outside the
repository, verified case identity against independent OLL/PLL references, and
checked wide/slice/rotation/group-repetition notation. Results: **55/57 OLL
defaults pass; 21/21 PLL defaults pass; 58/58 PLL slash variants pass.** OLL 45
and 56 were invalid; owner approval of the corrections was recorded later in
E6.7. Source `.c` diagrams match the independent OLL reference for all 57
cases. Full evidence, case tables and licensing findings are in E6.

No catalog, SVG, Training UI, storage, statistics, calibration or setup
generation was implemented. No third-party dataset was copied into the
repository.

### Phase 2B — Catalog foundations and verified setup generation — COMPLETE (2026-11-08)

Implemented and verified the reusable Phase 2 foundation described in E7:
stable case/algorithm catalog types and validation, the 22-class standard PLL
named identity, preserved Phase 1 72-class AUF signature, state-based frame
normalization, group/compact notation ingestion, exact algorithm verification,
and execution-only/recognition setup generation for OLL and PLL with the fixed
`U R U' R'` insertion and Sune precursor.

Focused Vitest passed **77/77** across seven training test files; typecheck and
lint passed (one pre-existing `SessionPanel.tsx` purity warning). External
source verification found **21/21 PLL defaults and 37/37 additional PLL variants
passing**, **OLL 45 and 55 other OLL defaults passing**, and **OLL 56 blocked by
the approved-notation conflict in F13 at that checkpoint** (F13 is now resolved
by E9; final verification is 57/57 OLL). No third-party data, diagrams, UI,
storage, or application wiring was added.

### Phase 2C — Case definitions and complete static diagrams — COMPLETE (2026-11-09)

Implemented the complete 57 OLL + 21 PLL mathematical case table, conventional
PLL diagram representatives, presentation-only facelet/arrow derivation,
diagram-spec validation, deterministic SVG renderer and generator, and all **78**
static diagrams. The owner approved both OLL and PLL visual designs. Typecheck
and lint passed; **125/125 Training tests** and **25/25 focused SVG/renderer
tests** passed; `--all --check` and `--preview --check` passed; all ten approved
preview assets remained byte-identical; the full collection was visually reviewed
at 128/64 px on light and dark. No third-party algorithms or diagrams were
copied. Full evidence is in E9.15. E9.16 subsequently lengthens corner arrows and removes the prior
Gb/Gd head-overlap exception; edge geometry and OLL stay unchanged. F12 still blocks algorithm
records and alternatives. Phases 3A/3B are complete (E10/E11); Phase 4 has not started.

### Phases 3A and 3B — COMPLETE (2026-11-09)

Phase 3A records/storage are in E10. Phase 3B pure calculations, compatible
extensions, approved policies, verification and remaining integration are in E11.
Expanded Phase 4 is complete (E12) and the 78 built-in defaults are complete
(E13). F4/F5/F10 retain their documented boundaries; F12's internal gate was
removed but third-party permission remains unestablished. Existing ordinary data
and all approved diagrams are preserved.

---

## J. Memory maintenance rules

Future OpenCode sessions must follow these rules:

1. **Read `CURRENT_STATUS.md` first.** Then consult the relevant sections of this
   file for the current task. Read the complete file when beginning a major
   development phase or making architectural decisions. This file is
   authoritative if the two documents conflict.
2. **Keep the two files distinct.** `CURRENT_STATUS.md` is short, frequently
   updated working context. This file is the complete requirements, architecture,
   findings, decision history, phased plan, and verification evidence.
3. **Update `CURRENT_STATUS.md` after meaningful completed tasks.** Update this
   file after each approved implementation phase, important verified finding, or
   approved design change. Record what was implemented, what was tested, and what
   remains.
4. **Record newly confirmed decisions.** Keep them in Section B or a dated
   decision entry. Do not bury them in chat or temporary notes.
5. **Record important technical findings.** Include evidence, file paths, tests,
   and limitations.
6. **Record completed phases and tests.** Include exact commands, browser
   engines, worker counts, and any skipped/untested areas.
7. **Keep unresolved questions separate from confirmed requirements.** Use
   Section F for unresolved matters. Never present a Phase 0 proposal as
   owner-approved.
8. **Never silently overwrite previously approved product decisions.** If a
   decision changes, record the old decision, the new decision, the reason, and
   the date.
9. **Preserve corrections.** Section E corrections override earlier Phase 0 text.
   Do not delete a correction to make the document look consistent.
10. **Avoid temporary debugging logs and irrelevant details.** Preserve
    reproducible findings and decisions, not console noise.
11. **Keep the current next action accurate.** Update Section I and the status
    header wherever the next task changes.
12. **Keep repository status current.** Note uncommitted work and do not assume a
    clean branch. Preserve unrelated changes.
13. **Do not use this file as authorization to change prescribed moves, skip
    verification, add dependencies, or implement phases out of order.**
14. **Link, do not duplicate.** Point to source/tests/docs where possible; avoid
    copying large code blocks that can drift.
15. **If the catalog/licensing decision changes, record the source and any
    required attribution.** Do not bundle unlicensed content.

---

## K. Change log

| Date | Change |
| --- | --- |
| 2026-11-11 | Completed overhaul O8 integrated verification and documentation. Added `e2e/training-integrated.spec.ts` covering legacy and named history through Begin, End, required report, reload, archive review, typed deletion and Algorithms, plus 285-attempt chart rendering at desktop/narrow widths, both themes, keyboard, synthetic touch and axe. Fixed the Algorithms revision-toggle accessible name. Recorded measurements, gaps and release state in [STATUS.md](../../STATUS.md#training-overhaul-o8--2026-11-11) and E16.10. No commit/push/publication. |
| 2026-11-11 | Completed overhaul O1. Recorded the compatible session representation and checked lifecycle in [E16.1](#e161-o1-persistence-decision--2026-11-11). O2a is queued. |
| 2026-11-10 | Implemented the owner-authorized built-in default OLL/PLL catalog (E13): 57 Heroor-based OLL defaults with the E9 OLL 45/56 corrections and 21 first-listed Tao PLL defaults, excluding the 37 extra variants. Added read-only stable-ID/versioned records, provenance/correction/frame metadata, preference resolution (stored choice first, then built-in, then verified custom), custom revision links, Edit Cases visibility/switch controls, and no storage copying. Existing Training v1 data/history is unchanged. All 78 defaults pass structural/cube-state validation and 624 setup combinations; Chromium Training 15/15; all 78 SVGs remain byte-identical. Third-party redistribution permission remains unestablished; the catalog uses an independently assembled functional-sequence approach with explicit provenance. No commit/push/publication. |
| 2026-11-10 | Completed the explicitly expanded Phase 4A/4B/4C controller, shared manual timer, full Training UI, verified user-algorithm path, calibration/renewal, category statistics and visit reports/recovery. Default datasets remain unbundled (F12); ordinary schemas and all 78 SVGs unchanged. Verification in STATUS.md; architecture/limits/file inventory in E12. Stop after Phase 4; no commit/push/publication. |
| 2026-11-09 | Completed explicitly authorized Phase 3B pure calibration/activation/renewal/estimates, category statistics, historical baselines/trimming, visit lifecycle decisions and recalculated reports. F6/F8/F9/F11 resolved; two-case recognition minimum and 15-minute inactivity confirmed. Optional v1 extensions preserve legacy history/bytes; no UI or browser lifecycle wiring. F12 unresolved; stop before Phase 4. Architecture/policies in E11; verification in STATUS.md. |
| 2026-11-09 | Completed explicitly authorized Phase 3A only: v1 Training domain records, checked dedicated local storage, validation/migration boundary, attribution history, practice-visit references, calibration snapshots and focused persistence tests. All 78 final diagrams explicitly owner-approved and unchanged. No UI, calculations, backup/sync integration, dependencies or publication. F12 unresolved; Phase 3B requires later authorization. Evidence and next task in E10. |
| 2026-11-08 | Created persistent project memory from the completed Phase 0 audit, feasibility report, architecture proposal, and phased plan. Recorded the OLL 57 correction, fixed Sune PLL precursor, fixed OLL insertion, unresolved OLL visual verification, and Pre-Phase 1 as the immediate next task. |
| 2026-11-08 | Registered the owner F2L reference image at `docs/training/references/f2l-oll-recognition-reference.png`; added `docs/training/CURRENT_STATUS.md`; added the two-file Training memory workflow to `AGENTS.md`. Visual verification was pending at that time; it was completed later the same day (see the next row). |
| 2026-11-08 | Completed Pre-Phase 1 Recognition Setup Validation. Verified the split FR pre-state as DFR at UFR orientation 2 and FR at UR orientation 0 (correcting Phase 0's UB claim); matched all 14 coloured reference-image cells under a consistent face/colour mapping; verified all 216 OLL orientation states (58 AUF orbits = 57 OLL + solved) and 288 PLL permutation states with exact Sune return, F2L preservation, and non-PLL pre-state; exercised 21 representative named PLL algorithms. Prescribed moves unchanged. Phase 1 not started. Evidence in Section E4. |
| 2026-11-08 | Completed Phase 1 cube model, notation, and case mathematics. Created `src/lib/training/{notation,cube3,caseSignature,caseSpace}.ts` and focused tests; reused the cubing.js 3x3x3 KPuzzle/KPattern instead of a second simulator (resolving F7); implemented strict notation validation/inversion, AUF-canonical OLL/PLL signatures, F2L checks, fixed `U R U' R'` insertion analysis, and fixed Sune precursor analysis. Typecheck/lint and 28 focused Vitest tests passed; Pre-Phase 1 oracle rerun matched its saved output exactly; independent 28/28 E4 checks passed. No UI/catalog/storage/dependency/Timer changes. Phase 2 not started. Evidence in E5. |
| 2026-11-08 | Completed Phase 2A approved algorithm catalog audit. Recorded owner approval of all 57 Heroor OLL `.f` records and the first Tao PLL slash variant for 21 cases; verified 55/57 OLL defaults and 21/21 PLL defaults against independent case definitions (58/58 PLL variants passed); identified OLL 45 and 56 as invalid with verified one-token corrections; established that OLL `.f` newlines are display breaks, PLL identity needs a pre/post-AUF double coset (22 classes, not 72 left-AUF classes), group `(...)2` expansion is required, prime-before-2 notation must be normalized, and wide/slice/rotation algorithms need frame normalization. Licensing/provenance remains unresolved (F12). No catalog/UI/storage/SVG/dependency/data copy. Evidence in E6. |
| 2026-11-08 | Recorded final owner approval of all 57 OLL and 21 PLL defaults with the OLL 45/56 corrections (E6.7). Completed Phase 2B: catalog types/validation, 22-class named PLL identity, 72-class Phase 1 signature preserved, state-based frame normalization, group/compact notation ingestion, exact algorithm verification, and verified execution/recognition setup generation. Added pure modules and 49 new tests; focused Vitest 77/77, typecheck/lint passed. External verification: 21/21 PLL defaults + 37/37 variants pass; OLL 45 and 55 other defaults pass; OLL 56 approved string conflicts with reference (`1212|0110` vs `1212|1010`, F13). No third-party data, diagrams, UI, storage, or dependencies added; F12 unresolved. Evidence in E7. |
| 2026-11-08 | Completed the emergency independent audit (E8): reproduced A's F2L break, B's valid OLL 56, C as OLL 54 and D's F2L break; fixed the `isF2lSolved` missing-cross defect with a failing-then-passing regression; cross-checked the independent 54-sticker model; confirmed 77/78 then-current defaults (56/57 OLL, 21/21 PLL) and 37/37 alternatives. No default adopted; OLL 56 remained under review. Phase 2C remained stopped at that checkpoint. |
| 2026-11-08 | Recorded final OLL 56 owner approval of B, `r U r' (U R U' R')2 r U' r'`, resolving F13 (E9). Imported the final independent online verification: 78/78 mathematically valid defaults (57 OLL with B + 21 PLL), 35 exact / 29 equivalent / 14 different-valid / 0 incorrect / 0 unverified; two engines agreed; 59/59 focused tests reported by the review. Completed the Phase 2C case-definition and ten-diagram preview checkpoint: 57 OLL + 21 PLL identities, conventional PLL representatives, facelet/arrow derivation, deterministic generator, ten static SVGs and contact sheet. Typecheck/lint passed; 118/118 Training tests and 9/9 SVG/renderer tests passed; all-78 dry-run passed. F12 remains unresolved; remaining 68 diagrams await owner visual approval. No Phase 3 work started. |
| 2026-11-08 | The owner rejected the original Phase 2C 5×5 cross diagram style and selected traditional compact 3×3 CubeSkills-style OLL/PLL diagrams. Redesigned the ten previews using independently generated geometry from verified cube states: 3×3 top face, black grid, OLL sideways-U bars only, PLL actual permuted side colours, black double-headed 2-cycles and directed 3-cycles, bolder corner/outer-lane arrows and thinner edge arrows. Corrected the back-strip display order to UBL/UB/UBR (left-to-right) without changing signatures. Updated tests and the light/dark 128/64 contact sheet. Typecheck/lint passed; 120/120 Training tests and 28/28 focused diagram/SVG/renderer tests passed; preview `--check` and all-78 dry-run passed. The internal reference images are not application assets. Final owner visual approval of the redesigned previews is still required; F12 remains unresolved. Evidence in E9.6. |
| 2026-11-08 | Owner requested an OLL-only refinement before reviewing PLL: thinner internal grid lines (outer border stays bold), brighter more vivid yellow, and no change to case identities, placements, Training logic or PLL. Regenerated only the five OLL previews and contact sheet. OLL used a 96 px face, 28 px cells, 4 px outer border, 2 px internal dividers, 5.5 px bars with 1.5 px outline, and `#FFF200`; PLL retained its 88 px/24 px/4 px/6.5 px geometry and `#F2C230` palette. This interpretation was later corrected; PLL review was temporarily deferred and later resumed in E9.9. Evidence in E9.7. |
| 2026-11-09 | Corrected the OLL stroke-weight interpretation after owner clarification. The entire central 3×3 face, including its outer border, must use the lighter line weight; the prior pass had thinned only the internal dividers. Regenerated only the five OLL previews and contact sheet with a 92 px face at `(18, 18)`, matching 2 px outer border and 2 px internal grid, 5 px side bars with a 1.25 px outline and 3 px gap, and unchanged `#FFF200`. PLL SVG hashes, geometry and palette are unchanged. Focused diagram/SVG/renderer tests 29/29 passed; typecheck/lint, preview `--check`, all-78 `--dry-run` and `git diff --check` passed. No other SVGs, Training UI, PLL or Phase 3 work. Evidence in E9.8. |
| 2026-11-09 | Corrected PLL arrow length and alignment after owner review. Preserved the approved T-perm vertical corner arrow exactly (`M 97 77 L 97 51`, tips `(97,85)`/`(97,43)`), lengthened the T horizontal edge swap from tips `(85,64)`/`(43,64)` to `(88,64)`/`(40,64)` on row `y=64`, and applied the same 4 px edge-tip clearance to the H and Z double swaps. Audited Ua/T/Gc/H/Z against actual cubie centres; Ua and Gc remained byte-identical because their directed arrows were already correct. Added exact T preservation, centre-line/lane, outward-routing, endpoint-clearance and 64 px readability regressions; 32/32 focused diagram/SVG/renderer tests and 122/122 full Training tests passed. Typecheck/lint, preview `--check`, all-78 `--dry-run` and `git diff --check` passed. Only T/H/Z PLL SVGs changed; no OLL asset, other diagram, algorithm, signature, palette, Training UI, dependency or Phase 3 work. Evidence in E9.9. |
| 2026-11-09 | Completed Phase 2C after explicit owner approval of both OLL and PLL visual designs. Generated and committed all 78 static SVGs (57 OLL + 21 PLL; skips excluded) with the deterministic generator, extended integrity tests to all 78 files, and preserved the ten approved preview assets SHA-256 byte-identical. Added the complete light/dark 128/64 contact sheet. `--all --check` and `--preview --check` passed; 125/125 Training tests and 25/25 focused renderer/SVG tests passed; typecheck/lint and `git diff --check` passed. All 78 cases were visually reviewed; Gb/Gd are the only documented head-overlap/crowding exceptions. Recorded the confirmed OLL/PLL attempt-completion timing requirement (B5a). F12 remains unresolved; no algorithm records, variants, Phase 3, commit, push or publication. Evidence in E9.15. |

---

## L. Stop conditions for future sessions

**E12 and E13 supersede earlier unmounted/stop-before-Phase-4 statements. The
expanded Phase 4 and the built-in default catalog are complete; stop before
additional phases.** Earlier phase checkpoints below are historical and do not
undo that implementation.

- Phase 0, Pre-Phase 1, Phase 1, Phase 2A, Phase 2B, the independent algorithm
  audit, Phase 2C and Phases 3A/3B are complete. Implementation includes pure
  Training foundations, all 78 approved diagrams, v1 persistence and calculations,
  the expanded Phase 4 UI/timer, and the E13 built-in default catalog. Stop before
  any new phase unless separately authorized.
- Both OLL and PLL visual designs are owner-approved, and all 78 static assets
  are generated and verified. Do not regenerate, redesign or re-approve the ten
  preview cases without a specific request. E9.16 lengthens corner arrows and removes the prior Gb/Gd
  head-overlap exception; E9.17 centres all corner arrows on actual cubie lines.
  Edge arrows and OLL remain unchanged. Phase 4 (E12) and the built-in defaults
  (E13) are complete. The owner removed the internal F12 gate, but third-party
  redistribution permission remains unestablished; do not add the 37 extra PLL
  variants or claim a licence.
- Confirm the B5a/E9.15 timing requirement in later timer work: OLL training ends
  when the user finishes OLL even if PLL remains unsolved (execution-only and
  recognition+execution), the timer is manually stopped, and PLL training ends
  after PLL completion allowing for AUF.
- OLL 45 remains owner-approved and independently verified. OLL 56 is resolved:
  the final default is B, `r U r' (U R U' R')2 r U' r'`, signature `1212|1010`.
  A/D break F2L and historical C is OLL 54; keep them only as superseded history.
- Do not copy or bundle either approved source dataset (Heroor OLL or Tao PLL)
  into the application or repository until redistribution rights are resolved.
- Do not change the prescribed `U R U' R'` OLL insertion or Sune PLL precursor
  without explicit owner approval.
- Do not disable OLL 57 execution training.
- Do not copy or bundle CubeSkills content without permission.
- Do not mix execution and recognition statistics.
- E16 defines named Training sessions for the overhaul. Keep ordinary Timer
  sessions separate from Training history.
- Do not break existing sessions, solves, backups, recovery, sync, or Timer
  behavior.
- Do not commit, push, deploy, or publish without explicit authorization.
