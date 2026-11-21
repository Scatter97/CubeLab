# CubeLab Training — Current Status

**Last updated:** 2026-11-21 (algorithm-tracking retirement, main Settings
merge, and Begin training; earlier scope: native Training history backup/restore, the
checked portable gzip native-file path, manual replace-only Training Drive
backup/restore, merge-based Training Drive sync, and the same-day restore,
sync-safety, deletion and workspace follow-ups recorded in E19)
**Phase:** Phases 0–3B, the explicitly expanded **Phase 4A/4B/4C**, and the
owner-authorized **built-in default OLL/PLL catalog** are complete. The
owner-approved Training UI redesign is implemented in E15. Overhaul O1 adds
the checked session foundation, O2a adds shared naming, O2b adds the Hub,
O3 activates named practice, O4 adds session end, idle and recovery, and
O5–O6b add reports, the archive, and Algorithms analytics. O7 added optional
prospective tracking by algorithm revision (retired 2026-11-21). O8 completed integrated synthetic
verification and documentation. Native Training history backup/restore and the
portable large-file path are implemented by the 2026-11-20 design. Manual
replace-only Training Drive backup/restore and merge-based Training Drive sync
are implemented by the 2026-11-20 plan. The 2026-11-21 pass retires algorithm
revision tracking, merges Training settings into the main Settings dialog and
renames **Begin practice** to **Begin training**.

**Current repository:** branch `master`, HEAD `b77f7a0` (`feat: add competition
sessions with derived rounds`). The Training backup/Drive implementation and
the 2026-11-20 follow-ups are uncommitted working-tree changes. `562b4f7` is a
historical committed baseline, not the current repository. The verified primary
local environment is Arch Linux/KDE Plasma/Wayland; see
[the Arch Linux guide](../development/ARCH_LINUX.md). Training continues to use
schema v1 at `cubelab:training:v1`; ordinary sessions use schema v7.

[PROJECT_MEMORY.md](./PROJECT_MEMORY.md) is authoritative.
[E17](./PROJECT_MEMORY.md#e17-native-training-history-backup-and-portable-gzip--2026-11-20)
records native backup/restore, portable gzip and the durable replacement key.
[E18](./PROJECT_MEMORY.md#e18-training-drive-backup-and-merge-synchronization--2026-11-20)
records manual Training Drive backup/restore and merge-based sync.
[E19](./PROJECT_MEMORY.md#e19-training-backup-and-sync-follow-ups--2026-11-20)
records the restore-provenance, sync-safety, deletion, workspace and legacy-visit
decisions summarized here. [E20](./PROJECT_MEMORY.md#e20-algorithm-tracking-retirement-and-settings-merge--2026-11-21)
records the 2026-11-21 tracking retirement and Settings merge.
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
  the shared name suggestion. Applying case edits changes the local draft;
  difficult-case and preset changes save immediately. Controls disable while the
  Hub is locked. **Begin training** resolves the name, checks usable cases, and
  captures the verified built-in algorithm for each case before starting the
  timer workspace.
- **O3 practice:** the checked session write precedes setup generation. The
  clock, Last Result, attempts and statistics use the active session ID.
  Execution retry stays in that session. Recognition calibration gates Begin
  for the selected set and saves its seven-sample median with the new session.
  Cancelling returns to the Hub draft. Reaching a renewal limit during practice
  leaves that session usable. The next Begin checks the limit again.
- **Reports and archive:** reports show measured time, signed comparisons,
  estimated Recognition components with coverage, and an inspectable attempt
  chart. The Hub shows five recent sessions. Practice history supports filters,
  read-only review and typed deletion of acknowledged named sessions. Archived
  session deletion records the visit and its attempt tombstones in one ledger
  write before local removal, and preset deletion offers Undo.
- **Algorithms:** Analytics separates ordinary solves from Training. Execution
  and Recognition have OLL/PLL filters, progression, volume, DNF rate, case
  performance and filtered practice history.
- **Revision tracking is retired (2026-11-21):** attempts are always case-only.
  Stored custom algorithms, preferred revisions, `algorithmTracking` flags and
  attribution are stripped by a shared sanitizer at local load, native backup
  import, Drive backup and Training sync. Timing, setups, visits, calibrations
  and case statistics are preserved. The algorithm editor, revision charts and
  attribution controls are absent rather than disabled.
- **Native history backup:** the complete checked store is an optional top-level
  `training` section in native backup v1. Export includes it only when the key
  exists and Training has no active visit, pending save or continuity decision.
  Import is replace-only after the existing confirmation, states local and
  backup counts, and leaves local Training untouched when the section is absent.
  Imperfect local Training can be repaired through the durable replacement
  journal; imported sessions stay ended. A Training restore also clears stale
  tombstones, conflicts and approvals from `cubelab:training-sync:v1` while
  preserving the Training device ID and preferences; the replacement journal now
  covers that ledger key as well. Restore updates the controller in memory so the
  Hub, Practice history, reports and Analytics recalculate without reload. Drive
  snapshots and csTimer imports never include Training.
- **Portable large native files:** native backups above the compact 10 MB form
  are written as checked gzip (`.json.gz`) within 16 MB encoded and 64 MB decoded
  limits. Import detects gzip by magic bytes, enforces both caps, validates
  UTF-8/JSON/backup/Training before mutation, and keeps legacy `.json` files
  readable. Older builds cannot read `.json.gz`.
- **Training Drive backup and sync:** separate immutable
  `cubelab-training-*` files. **Training history backup** in the Drive dialog is
  manual and replace-only, previews counts/date range, requires typed
  confirmation, blocks active/pending/continuity/replacement states, and never
  resumes a visit. Manual and merge sync use one Training device ID from
  `cubelab:training-sync:v1`; fresh devices adopt remote preferences. Optional
  **Training synchronization** merges attempts, ended visits, calibrations,
  presets, coarse preferences and high-water recognition counts using durable
  attempt/visit/preset tombstones and explicit Undo
  revocations. Manual conflict review requires exact local/remote approval, and
  Training conflicts are separate from solve conflicts. Automatic sync waits for
  idle/closed Training and blocks during active timing, pending saves, continuity
  decisions, calibration drafts, replacement journals, pending solve recovery or
  native imports; it uploads after session end, not per attempt. It aborts with a
  retryable pending state when local Training or the ledger changes during an
  upload. A malformed partial ledger blocks writes and keeps its original bytes;
  a stale `syncing` status normalizes to pending or disabled. Invalid or oversized
  remote Training files are skipped with a warning and can be deleted in the
  Drive dialog. Retention always keeps the newest snapshot for every device and
  may remove superseded ones beyond the configurable count/age limits (default
  keep 10 / 30 days); manual upload cleanup keeps the newest five own snapshots.
  Training cleanup never selects solve files. Native Training restore and
  replace-only Drive restore are blocked while Training sync is enabled. Solve
  snapshots and solve sync never include or list Training.
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
  `algorithmSelection.ts` retains the historical preference/default resolution,
  but the tracking UI is retired and the 2026-11-21 sanitizer clears stored
  custom algorithms, preferred revisions and attribution. Built-ins are never
  copied into `customAlgorithms` or duplicated on startup. Training storage
  stays schema **v1** at `cubelab:training:v1`.
- **Provenance limitation:** the owner removed CubeLab's internal F12 restriction,
  but third-party redistribution permission is not established. Heroor has a
  README-only MIT claim and no `LICENSE` file; Tao's MIT software licence credits
  AlgDb for other algorithms. E13 uses an independently assembled catalog of only
  the 78 owner-approved functional sequences, not a copied compilation, and
  asserts no third-party redistribution licence. Legal review/permission remains
  advisable; this is not a grant of rights.
- **Case visibility:** the execution preview shows the name and diagram by
  default and one device-local main Settings toggle disables it for both
  OLL and PLL execution. It has no effect on recognition.
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
- **Historical 4C calibration (pre-named-session; not a current interactive
  path):** the old opening/selection-driven calibration workflow, sample review,
  renewal recommendation and report-dismissal UI are retained only as history.
  Current named-session recognition calibration is the O3 Begin gate: seven
  accepted positive repetitions with sample review/retry/cancel and a committed
  median, plus the configured age/attempt renewal limits. Opening Training never
  starts calibration, and a forced renewal gates the next Begin rather than an
  active timer.
- **Statistics/results:** Four independent categories with configurable row
  order, visibility and Current/Best columns. Recognition offers Raw and
  Estimated views of the stored series. Single/mo3/ao5/ao12 are the defaults.
  Additional averages, success/DNF rates, case counts, difficult-case mean and
  historical improvement are optional. Named-session Visit improvement compares
  against the full category history while counts and other session statistics
  remain scoped to that session. Detailed Statistics has a searchable,
  sortable case view. Clicking an Attempts row or pressing Enter on it opens
  Timer’s shared action menu for result correction, clipboard actions, full
  details and deletion with Undo. The compact Attempt details dialog groups the
  case, result and setup. Undo restores the exact saved attempt and its visit
  membership.
  Training keeps its timing, calibration, visit and high-water rules.
- **Legacy visits:** pre-named-session visits are **end-only** in current builds.
  An unfinished legacy visit is finalized through the continuity notice or the
  confirmed-closure path; it is not resumed, and the old interactive legacy
  Training Setup, calibration and Timer report-notice flows are historical.
  Ended legacy history remains readable where stored attempts exist.
  Named-session reports use the E16 flow.

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
- For legacy visits, current builds only finalize the old visit. A legacy active
  visit shows the continuity notice and an **End visit** action; ambiguous
  restored tabs still require an explicit decision before Training writes. End
  uses last known activity when there is no reliable close time. Pagehide/unload
  alone does not prove closure. There is no current legacy Resume flow or Timer
  report notice.
- A partial calibration draft is not persisted across reload; prior completed
  calibrations remain. Failed write candidates stay in memory; browsers can
  suppress exit prompts and forced termination can still lose unsaved changes.
  Recovery-copy download is manual preservation, not an import/merge feature.
- Training stays schema **v1**, key **`cubelab:training:v1`**. Ordinary sessions
  v7/settings v12/native backup v1/solve Drive formats, the ordinary solve/session
  resets and the solve Drive 10 MB cap are unchanged. Native backup and restore
  include the checked Training store replace-only. Training has a separate
  16 MB Drive file family, manual replace-only backup/restore, and optional
  merge-based Drive sync with its own `cubelab:training-sync:v1` state,
  tombstones, conflicts, device ID and retention. A replace-only restore clears
  stale tombstones, conflicts and approvals while preserving that device ID and
  the Training sync preferences, and its replacement journal covers the ledger
  key. A malformed partial ledger blocks writes and keeps its bytes; automatic
  sync aborts and retries when Training or the ledger changes mid-upload; stale
  `syncing` normalizes to pending or disabled; unreadable remote Training files
  are skipped with a warning and can be deleted. Solve sync, csTimer imports and
  onboarding import still exclude or ignore Training. **Reset All Site Data**
  clears local Training and its Training sync ledger with the rest of CubeLab's
  browser-owned data but does not delete remote Training files. Training merge
  is eventual, not consensus; preferences use coarse whole-field review, and
  clearing the ledger loses deletion provenance/conflicts. Local Training history
  is not pruned or aggregated. Remote Training retention always keeps the newest
  snapshot per device; configurable count/age cleanup defaults to keep 10 / 30
  days, and manual upload cleanup keeps the newest five own snapshots. A Drive
  snapshot protocol above 10 MB for solve files and deeper large-history profiling
  still require separate work.
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

Overhaul O1 through O8 are complete. Native Training backup/restore, portable
gzip, manual replace-only Training Drive backup/restore and merge-based Training
Drive sync are also implemented. Algorithm revision tracking is retired as of
2026-11-21; Training settings now live in the main Settings dialog and the
workspace starts with **Begin training**. Integrated synthetic verification covers legacy
and named sessions,
the required report, archive deletion, Algorithms recalculation, realistic chart
sizes, both themes, keyboard and synthetic touch. Owner review and any release,
publication, live Drive, Firefox/WebKit, physical-device or larger-history
profiling work require separate authorization. See the
[implementation plan](overhaul/IMPLEMENTATION_PLAN.md) and
[overhaul progress](overhaul/CURRENT_PROGRESS.md).

What remains under separate decisions:

- automatic local Training retention/aggregation and its size policy;
- live Google Drive and physical multi-device validation of Training backup and
  sync (mock-drive Chromium coverage does not establish either);
- a solve Drive snapshot protocol above 10 MB and deeper large-history profiling;
- release, publication and legal/provenance review.

Training backup/restore, the checked portable gzip path, manual replace-only
Drive backup/restore, and merge-based Training Drive sync are implemented:
[TRAINING_HISTORY_BACKUP_DESIGN.md](../development/TRAINING_HISTORY_BACKUP_DESIGN.md)
and [TRAINING_DRIVE_SYNC_PLAN.md](../development/TRAINING_DRIVE_SYNC_PLAN.md).
Native backups can include the complete checked store and restore it
replace-only; the Drive dialog can upload/restore separate Training files and
optionally merge them across devices. Solve Drive snapshots remain unchanged and
exclude Training. Exact verification and measurements are in
[STATUS.md](../../STATUS.md#training-drive-backup-and-sync--2026-11-20) and
[STATUS.md](../../STATUS.md#training-history-backup--2026-11-20). The
2026-11-20 follow-ups in E19 are part of the current uncommitted working tree;
they are not separately covered by those dated verification entries.
