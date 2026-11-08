# CubeLab status

**Updated:** 2026-11-07. This is the current implementation/verification record
and immediate work queue. [README.md](README.md) describes the product;
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) records current boundaries;
[ROADMAP.md](ROADMAP.md) lists the retained follow-ups alongside delivered work.

## N1/N3 startup read and native-date safety — 2026-11-07

The remaining two scoped single-tab findings are repaired:

- **N1:** Bootstrap obtains a checked session snapshot before mounting editable
  hooks. Current and legacy read failures, malformed/unsupported records and
  invalid stored dates retain their original bytes behind the retry gate.
  Only an absent current key permits legacy migration. The same snapshot and
  raw value feed `useSessions`, so normal startup reads the collection once;
  the single-read invariant is tested. Completion-buffer startup replay uses
  the checked loader too and retains its buffer on read failure. No fallback
  empty collection is autosaved after a failed read.
- **N3:** Shared date bounds reject unrepresentable provided creation/update
  timestamps in native session/solve records before local mutation. The remote
  backup reader uses that validation too. Existing invalid stored dates are
  preserved behind recovery rather than silently discarded; Retry does not
  automatically correct malformed data. History ISO attributes, full labels and
  relative labels have a defensive Unknown date path for invalid in-memory data.

Node 22.23.2 verification, with separate suites sequential and Chromium
`--workers=4`:

- Before implementation, six owning unit regressions and all four new browser
  regressions failed; the exact representable-date boundary test already passed.
- `npm run typecheck`: passed. `npm run lint`: passed with only the pre-existing
  SessionPanel purity warning.
- Focused storage/backup/format/session/completion group: **133 passed**.
- Final `npm test -- --maxWorkers=2`: **952 passed in 68 files**.
- `e2e/storage-safety.spec.ts`, `e2e/single-tab.spec.ts`, and
  `e2e/session-management.spec.ts`: **42/42 passed**. Includes failed current and
  legacy reads with successful retry, native invalid-date file rejection,
  invalid stored-record preservation, single-tab ownership and replacement/
  deletion/Undo/session regressions.
- Selected native backup round trip, mock Drive backup/restore and production
  offline bootstrap in `e2e/timer.spec.ts`: **3/3 passed**.
- Final normal `npm run build`: passed, including PWA generation; non-mock output
  restored. Existing chunk-size advisory remains. `git diff --check`: passed.

No dependencies installed, live Drive calls, commits or pushes. Firefox/WebKit,
physical devices and assistive technology were not run. Existing unrelated
changes remain intact. These changes do not claim to repair the separate N2
legacy-client deferred-adoption path; the single-tab policy prevents normal
current-build same-profile concurrent editing.

## Single-tab ownership — 2026-11-07

A dedicated `cubelab-active-tab` Web Lock now gates `Bootstrap` in `main.tsx`.
Only its owner mounts recovery and application hooks. Other current-build tabs
show a waiting screen and queue automatically until the owner closes; focus and
background suspension do not steal ownership. The lifetime lock is separate
from the existing Drive/replacement write lock. Missing or rejected coordination
keeps editing closed, with retry after request failure. Scope and older-client
boundaries are documented in `README.md` and `KNOWN_LIMITATIONS.md`.

Verification used Node 22.23.2 and sequential Chromium suites with
`--workers=4`:

- Five new browser cases failed against the pre-feature implementation.
- `npm run typecheck` and `npm run lint` passed; lint retains only the existing
  SessionPanel purity warning.
- `npm test -- --maxWorkers=2`: **938 passed in 67 files**. Focused ownership,
  startup and replacement coverage passed **21/21**, including StrictMode,
  pending request cancellation, release, blocked children and retry.
- `e2e/single-tab.spec.ts`: all **5** cases passed. Covers simultaneous opens,
  reload, saved-history takeover, running-timer focus safety, unsupported
  coordination and retry after rejection. Waiting-screen visual review passed.
- Session management, cross-tab timing and timer response: **39 passed and one
  failed** on the first corrected-gate regression run. The failure exposed a
  test-only shim dropping the native two-argument lock-request overload; the
  shim was corrected. The affected original case plus two session protocol
  cases and the five strengthened ownership cases then passed **8/8**.
- Selected native backup/import, mock Drive backup/restore and production
  offline bootstrap: **3/3 passed**. Across runs, **48 distinct Chromium cases**
  reached a passing result. The old protocol cases explicitly simulate older
  concurrent clients; production has no gate bypass.
- An earlier integration run was stopped after identifying an invalid browser
  lock-option combination; this was corrected before the passing runs above.
- Final `npm run build` passed, including PWA generation, and restored normal
  non-mock output; the existing chunk-size advisory remains. `git diff --check`
  passed. No dependencies, live Drive requests, commits or pushes.

Firefox/WebKit, crash/BFCache-specific scenarios, physical devices and assistive
technology were not tested in this batch. Existing storage-read and malformed
native-date findings are not repaired by tab exclusion. Existing sync/recovery
safeguards remain in place for older clients and other browsers/devices.

## Implemented checkpoint

- React/TypeScript/Vite local-first timer with 12 built-in events: 3×3, 2×2, 4×4,
  3×3 OH, 5×5, 6×6, 7×7, Pyraminx, Skewb, Square-1, Clock and Megaminx.
  Official `cubing.js` scrambles and registry-driven visualizations are shipped.
- Custom events add stable `custom:` IDs, optional scramble placeholders,
  creation/rename/deletion, isolated statistics and Analytics filters, and
  csTimer type mapping. Valid omitted `opt.scrType` uses csTimer’s `333` default;
  explicit unsupported identifiers stay on stable custom events, and missing or
  malformed metadata never falls back to 3×3. Definitions merge and tombstone
  with selected-session reassignment plus metadata-based correction of previously
  imported solves.
- Developer options are collapsed by default. Their Danger Zone retains the
  typed-confirmation solve reset and adds **Delete All Sessions**, which records
  session and solve tombstones, removes every session, creates one empty active
  **Session 1**, and preserves settings and custom-event definitions. Both
  actions block unsafe storage/sync states and skip snapshot cleanup for their
  publication.
- Inspection/penalties/warnings, named sessions, comments/actions, configurable
  average trimming, compact/expanded Time Trend, wheel/pinch/pan and historical
  PB statistics are implemented. Sessions use schema v6; settings use v11.
  Sessions can be reordered with drag handles, arrow-key reordering, and
  accessible Up/Down controls inside the session selector; order is backed up
  and synchronized as an ID-based record. Session
  settings can correct a session's event (with confirmation when solves exist)
  while preserving every solve field and import provenance. **Session settings**
  also merges one or more same-event sources into a destination and splits
  individual/range-selected solves into a new session. Merge previews names,
  counts and totals and removes sources only after transfer; split copies the
  source event/settings, inserts the new session next to the source, keeps the
  source even when emptied, and selects the new session. Both require typed
  confirmation and provide no Undo. Partial splits persist durable transfer
  records so stale cloud or cross-tab copies cannot duplicate or reclaim moved
  solves. Optional completed/
  total solve and total-time summaries live in the slim timer footer, follow
  csTimer's DNF/+2 semantics, show counts without a suffix and total time in
  hours. A release-record display version appears in the bottom-right footer.
- A lazy Analytics dashboard adds global event/session/date/count/penalty
  filters, overview cards, progression and average charts, PB history,
  clickable distributions, consistency and Sub-X analysis, session comparison,
  practice activity, advanced percentiles/rankings, and a virtualized filtered
  solve-list dialog. The Statistics overview stays at the top; a left analysis
  list (or a narrow-screen dropdown) shows one remaining analysis at a time.
  Section visibility and order persist in synchronized settings; retired Solve
  explorer entries are ignored safely. Charts support hover, keyboard
  inspection, zoom, pan, reset and solve drill-down through the shared details
  dialog. The compact icon zoom group replaces text buttons. Distribution
  auto-ranges from the central 98% and groups extremes into drillable edge
  intervals; Sub-X accepts precise seconds, event-specific presets, and keeps a
  resizable chart/session-table split with sticky headings. Practice activity
  covers the complete filtered range with year-aware labels. On desktop the page
  fits the viewport with bounded internal scrolling and chart resizing; the
  session selector supports all/none/partial states and an explicit empty
  selection. Native dropdowns were replaced throughout by a shared accessible
  CubeLab combobox/listbox with type-ahead, outside-click/Escape dismissal,
  viewport positioning and focus restoration.
- Local backups, additive csTimer import, optional immutable-snapshot Drive sync,
  conflict review/Undo, recovery, retention and cross-tab reconciliation exist.
- Floating 2D/PG3D tools, persisted drag/resize, light/dark/system themes and an
  offline-capable PWA are implemented.
- The first large-history stop patch captures input before audio/focus, animates
  the readout locally and delays expensive presentation. Saving and sync still
  receive current data. Enabled-sync guards remain in place. Optional session
  summaries are memoized from stored solves, so the stop path does no extra
  aggregation work.
- Statistics rows render Current, Best and any enabled Target/BPA/WPA inline
  with independently configurable metric visibility. Target is calculated from
  the session PB (strictly faster), not a manual goal; BPA/WPA reuse the shared
  trimming and recorded-result rules. The desktop Statistics/Solves divider uses
  an intrinsic content measurement, keeps every enabled average mounted,
  shares spare row space and falls back to internal Statistics scrolling only
  when the viewport cannot fit both panel minimums.
- The November 1 regression follow-up fixes active-session approval application,
  deterministic selection metadata (including envelope parsing/adoption), and
  csTimer malformed numeric/date validation before preview/confirmation.

Core phases 2A–4, theme polish, Phase 5 remediation and Phase 6a are delivered.
Future feature-phase proposals have been removed at the user's request. The
retained work is the five follow-ups below; the retired Solve explorer was
replaced by the filtered solve-list details dialog.

## D1–D5 outstanding fixes — 2026-11-07

The five deferred findings in
[docs/CubeLab-outstanding-five-fix-plan-2026-11-07.md](docs/CubeLab-outstanding-five-fix-plan-2026-11-07.md)
are implemented.

- **D1:** Analytics now uses one local-calendar-day invalidation source. It
  schedules the next local midnight from wall-clock date arithmetic, recomputes
  after visibility/focus return, and feeds the same day token into relative-date
  filtering, session comparison and activity/streak calculations. DST, month and
  year boundaries use local calendar arithmetic rather than fixed 24-hour
  periods.
- **D2:** A matching release from `holding` starts directly when
  `release.at - holdStartedAt >= holdDurationMs`, using the release timestamp as
  `startedAt`. A readiness tick is presentation-only and no longer required.
  Early releases, wrong input sources, repeats, inspection penalties, cancel and
  exactly-once recording retain their previous behavior; zero-duration holds are
  handled explicitly.
- **D3:** Native export, manual Drive backup and automatic upload share a checked
  serializer. It measures the UTF-8 payload including formatting, prefers
  readable JSON, falls back to compact JSON, and blocks output whose complete
  form still exceeds `MAX_BACKUP_BYTES` (10 MB). Oversized automatic syncs store a
  blocked fingerprint to avoid repeated download/serialization loops; manual
  retry and local edits re-evaluate. No oversized file or snapshot is emitted.
- **D4:** Practice activity aggregates remain sparse across the full filtered
  range, while the heatmap materializes only a 371-day window with
  Earliest/Earlier/Later/Latest navigation. Totals, streaks, weekly/monthly
  volume, best/worst days and drill-down cover the complete range; a 100,000-day
  span creates two active-day records and a bounded cell set rather than 100,001
  daily rows.
- **D5:** Native import, additive csTimer import and Drive restore use a durable
  replacement coordinator. It captures every affected committed key in a local
  journal, stages sessions/settings/sync/drive values, writes a commit marker,
  then publishes React state and success metadata. A pre-marker failure rolls
  back; a post-marker failure rolls forward; failed rollback/cleanup keeps the
  journal and pauses sync/new imports. Startup recovery runs before React reads
  storage. Other tabs ignore prepared intermediate keys and adopt the committed
  result. Pending Undo recovery blocks replacement rather than being discarded.
  The replacement record is local-only and the separate storage keys are not an
  atomic transaction.

Verification: TypeScript passed. Oxlint passed with only the pre-existing
`SessionPanel` purity warning. Full Vitest **897 passed in 64 files**, including
new local-day, hold-release, checked-serialization, sparse-calendar,
replacement-journal, durable-replacement hook, staged hook, sync-base and
cross-tab/reload regressions.
Chromium passed Analytics **15/15**, session management **27/27**, custom events
**4/4**, and timer/timer-response/cross-tab timing **67/67**. The normal
production build and PWA generation passed after the mock-Drive browser runs.
Firefox/WebKit, live Drive, physical devices and assistive technology were not
run for this batch. No release version changed.

## D5 replacement-safety V1/V2 — 2026-11-07

The two remaining confirmed D5 defects are repaired without changing the
D1–D4 or earlier B/F/J work.

- **V1:** Committed/removed replacement notifications now use the same
  timer-safe adoption boundary as ordinary cross-tab session changes. The first
  prepared event records a pre-deferral collection baseline; the latest complete
  sessions/settings/sync outcome is retained until the timer is idle. Idle
  adoption reconciles solves added after the baseline by stable ID, creates a
  labelled same-event recovery session when the original owner disappeared, and
  carries the external selection with its sync provenance. Completions accepted
  while a candidate is prepared or not yet adopted go to the local-only
  `cubelab:replacement-completion:v1` buffer instead of overwriting the staged
  collection; the buffer is replayed and cleared after the outcome is adopted or
  before normal hooks mount on reload.
- **V2:** The normal application no longer mounts after an unresolved replacement
  recovery. Startup recovery runs before the session/settings hooks, and a
  prepared journal is rolled back only while holding the same
  `cubelab-drive-write` Web Lock used by the replacement coordinator. A committed
  journal is cleanup-only and may open normally. Failed prepared rollback/cleanup
  and malformed or unreadable records render a minimal retry-only recovery state
  with no editable collection, autosave, timing controls, imports or timing
  listeners. Without Web Locks a prepared record stays pending conservatively.
  Buffered completions are applied and saved before the application mounts.

Verification: TypeScript passed. Oxlint passed with only the pre-existing
`SessionPanel` purity warning. The V1/V2 probes failed before the repair (active
session changed to the committed replacement; prepared-phase completion
overwrote its candidate; failed startup rollback exposed the candidate and
accepted later work was lost). After the repair, full Vitest **917 passed in 66
files**; the focused replacement/session/sync/recovery group passed **163/163**.
Chromium passed `cross-tab-timing` **5/5** and `session-management` **32/32**
together **37/37**, including active/prepared/rolled-back ownership plus reload,
failed rollback, rollback-cleanup failure, committed-cleanup failure, malformed
journal and live-writer lock coordination. `timer` plus `timer-response` passed
**65/65**, including native import/export, delete/Undo, mock-Drive restore,
csTimer import and the production offline case. The normal production build and
PWA generation passed after the mock-Drive browser runs. Firefox/WebKit, live
Drive, physical-device and assistive-technology checks were not run for this
batch. No release version changed.

## C1–C3 completion replay and Analytics rail — 2026-11-07

The three findings in
[docs/CubeLab-C1-C3-repair-plan-2026-11-07.md](docs/CubeLab-C1-C3-repair-plan-2026-11-07.md)
are repaired without changing the earlier B/F/J/D/V work.

- **C1:** Completion replay now routes through event-aware cross-tab
  reconciliation. The original owner is reused only when its event matches the
  buffered solve; a missing or reclassified owner receives a stable labelled
  same-event recovery session. Replacement and buffered custom-event definitions
  are unioned rather than one side discarding the other. Active solve tombstones
  suppress replay, so a deliberate later deletion cannot be resurrected.
  Replaying the same buffer is idempotent, and the resulting collection passes
  the real native-backup parser.
- **C2:** Generic collection persistence no longer erases the completion buffer.
  New buffers write one local key per solve, so two competing appends survive and
  an append between a replay snapshot and acknowledgement is preserved.
  Acknowledgement removes only exact solve versions now present in the durable
  collection or superseded by an active deletion tombstone; failed removal keeps
  the durable buffer for an idempotent retry. The replacement coordinator applies
  the pending buffer before staging its candidate, updates the sync solve count,
  and acknowledges only after the commit marker succeeds. A failed collection
  stage leaves the buffer untouched. The older single-record buffer is still
  readable; its cleanup remains a non-atomic read/check/write sequence.
- **C3:** The bounded desktop Analytics rail is `position: static`; the sticky
  offset that moved the heading/tabs by four pixels between empty Practice
  activity and Advanced analytics is gone. Empty sessions, empty filtered
  results, populated history, short desktop viewports, keyboard focus and the
  mobile selector keep stable geometry.

Verification: TypeScript passed. Oxlint passed with only the pre-existing
`SessionPanel` purity warning. Full Vitest **933 passed in 66 files**, including
new event-compatible replay, custom-event union, tombstone suppression,
per-solve competing append, exact acknowledgement, failed cleanup/stage,
coordinator commit, startup replay and idle cross-tab adoption regressions.
Before the repairs, the focused C1/C2 regressions failed **7/7** and the four new
empty-scope Analytics geometry cases failed with the reported 283→287 px shift.
After the repairs, Chromium passed `session-management`, `cross-tab-timing` and
`analytics-layout` **47/47** together, including the new prepared-phase
reclassification/reload browser case and the native-import coordinator case with
a buffered follower completion. Selected `timer` native backup/import,
mock-Drive backup/restore and production offline cases passed **3/3**. The normal
production build and PWA generation passed after the mock-Drive browser runs.
Firefox/WebKit, live Drive, physical-device and assistive-technology checks were
not run for this batch. No release version changed.

## November 7 audit repairs — 2026-11-07

The eight confirmed findings in
[docs/CubeLab-audit-2026-11-07.md](docs/CubeLab-audit-2026-11-07.md) are
repaired. The five hypotheses investigated separately with temporary synthetic
fixtures were subsequently repaired in the D1–D5 batch above. The earlier
confirmed-defect patches remain independently reviewable in the working history.

- Additive csTimer imports now use a dedicated sync update instead of
  `resetBase`. Existing solve/session/event tombstones, session redirects,
  pending conflicts, exact approvals, settings field timestamps and
  active-session selection metadata survive the import; only the published
  fingerprint/count and pending status are refreshed. An unpublished deletion
  is therefore not erased by adding sessions.
- Individual solve deletion records its tombstone before removing the solve and
  blocks with no mutation if that sync write fails. Session persistence now also
  completes before the solve disappears; a failed session write revokes the
  just-written deletion intent so the visible collection and journal agree.
  Undo persists the revocation and restored solve before reporting success.
- Analytics now computes best averages as a forward prefix minimum, so a later
  slowdown or DNF window cannot replace an earlier best. The advanced moving
  median sorts each valid attempt window.
- Rolling Analytics date presets subtract local calendar dates instead of fixed
  24-hour periods, preserving inclusive day counts across DST. Equal timestamps
  inside one stored (newest-first) session are reversed back to their original
  chronology, so latest-N selection keeps the newest attempts.
- Manual Drive restore passes each snapshot's active-session metadata through
  the accumulator, and manual backup creation publishes the local selection
  metadata. The restore result now follows the same provenance as automatic
  synchronization.
- Closing the lazy Backup/Drive dialogs restores focus to the visible header
  Settings button, including after failed-file, Escape, export, cancel-import
  and completed-import paths.

Verification: TypeScript passed. Oxlint passed with the pre-existing
`SessionPanel` purity warning. Full Vitest **837 passed in 59 files**, including
new durable-deletion, additive-import metadata, Analytics chronology/calendar,
manual-restore provenance and focus regressions. Focused Chromium passed the
completed native backup round trip with focus checks, solve-menu delete/Undo,
the new sync/session-write failure cases, both csTimer import cases, mock-Drive
restore plus active-session review, and Analytics **13/13**. The mock build was
followed by a normal production/PWA build. Firefox/WebKit, live Drive and
physical accessibility checks were not run for this repair batch; the external
audit's A6/A7 fixtures still call the superseded additive/reset and
delete-then-record sequences directly and are not used as current-path tests.

## Deletion-safety follow-up — 2026-11-07

The four follow-up findings in
[docs/CubeLab-repair-plan-2026-11-07.md](docs/CubeLab-repair-plan-2026-11-07.md)
are repaired without changing the B1–B8 work.

- **F1:** `recordDeletions` and `recordAllSessionDeletions` now persist a
  detached candidate before publishing React state/refs or retention flags. A
  rejected bulk reset/delete-all leaves no active intent for a later sync.
- **F2:** Clear Session uses one checked batch tombstone write and publishes the
  empty collection only after the session write succeeds. Intent failure keeps
  every solve; collection failure leaves durable intent and a truthful retry
  message. Custom-event deletion now validates first, records its event
  tombstone first, and rolls that intent back if the collection cannot be saved.
- **F4:** Toast actions dismiss the original action toast before invoking the
  callback, so replacement failure/recovery notifications remain visible.
- **F3:** Undo now writes a local-only recovery journal before changing deletion
  intent. If revocation succeeds but the collection restore fails, the journal
  survives reload and is applied before synchronization; sync pauses while it
  remains pending. Native and manual backups include the pending solve, and a
  later deliberate deletion supersedes the journal. No unchecked rollback is
  used after the revocation has been accepted.

Verification: TypeScript passed. Oxlint passed with the pre-existing
`SessionPanel` purity warning. Full Vitest **849 passed in 60 files**; the
focused deletion/session/sync/recovery group **239 passed**. Chromium passed
`session-management` plus `cross-tab-timing` **25/25**, `custom-events` **4/4**,
the selected timer/solve/backup/csTimer/Drive cases **6/6**, and the new
failure-path probes for blocked bulk reset, Clear Session, Undo notification and
cross-reload Undo recovery. The external bulk probe now passes **2/2**. Firefox/WebKit, live
Drive, physical-device and assistive-technology checks were not run.

## Recovery-journal follow-up — 2026-11-07

The two confirmed journal defects in
[docs/CubeLab-journal-fix-plan-2026-11-07.md](docs/CubeLab-journal-fix-plan-2026-11-07.md)
are repaired, and the interrupted-Undo checkpoint is now explicit.

- **J3:** Recovery scheduling no longer depends on a notification callback that
  changes every render. The hook keeps the latest notifier in a ref, retries only
  on mount, storage-health changes, timer-idle transitions or explicit sync, and
  deduplicates unchanged journal outcomes. Recovery is deferred while the timer
  is active. A failed collection or journal-cleanup write leaves one pending
  notice, preserves the journal, and does not start a render/notification loop.
- **J2:** Recovery and backup materialization compare the normalized destination
  session event with the solve event. Incompatible or missing targets use a
  stable labelled recovery session with the original event, while the source
  session remains unchanged. Shared `restoreSolve` now rejects mismatched events,
  so direct Undo cannot bypass the same invariant. Native export and manual Drive
  backup use the same materialization and fail explicitly if a pending solve
  cannot be resolved.
- **J1 commit point:** A journal is written before the tombstone revocation. If
  the original deletion remains active, the interrupted Undo is treated as
  prepared-but-not-committed and aborts conservatively; the solve stays deleted.
  Once the revocation is durably committed, incomplete collection restoration is
  finished after reload/storage recovery. A causally later deliberate deletion
  supersedes the prepared restoration and is reported separately. Older journal
  records without original-deletion metadata use the conservative abort when an
  active tombstone is present.

Verification: TypeScript passed. Oxlint passed with the pre-existing
`SessionPanel` purity warning. Full Vitest **861 passed in 60 files**; the focused
recovery/session/sync/backup group **168 passed**. Chromium
`session-management` + `custom-events` + `cross-tab-timing` passed **30/30**,
including the cleanup-failure loop regression, which observed 13,227 toast
replacements before the fix and passed the bounded-notification assertion after
it. The selected timer/backup/csTimer/Drive cases passed **6/6**; the external
bulk probes passed **2/2**. Firefox/WebKit, live Drive, physical-device and
assistive-technology checks were not run.

## Statistics metrics and content-aware split — 2026-11-06

The Statistics panel now shows Current and Best as primary values with optional
Target, BPA and WPA inline. Settings → Statistics adds independent Row metrics
controls (Current/Best on, Target/BPA/WPA off by default), stored as
`statMetricVisibility` in settings schema v11, field-merged, backed up and
cross-tab adopted. Average-row visibility is unchanged and separate. Editable
targets and expandable rows are gone; legacy `statTargetsMs` values are retained
as validated inert data for settings/backup/sync compatibility.

Target is the maximum recorded next result that makes the next rolling average
strictly faster than the session's historical Best. It uses the already-computed
PB, examines only the newest N−1 retained solves, and accounts for the candidate
being trimmed as fastest, retained, or trimmed as slowest. BPA uses a 0.00 next
result and WPA a DNF; both use the same trimming, +2/DNF and recorded-precision
path as Current/Best. The panel shows `—` without enough history or a PB, `N/A`
when no result can beat the PB, `∞` when every finite result qualifies, and a
numerical threshold otherwise. A PB tie is not a new best.

The desktop divider now measures intrinsic content from an isolated sample
including the header, padding, every enabled row and wrapped secondary metrics.
Its dynamic minimum is passed to the sidebar clamp, so dragging upward stops
when all rows reach their compact height. The saved percentage is never
rewritten by automatic clamping. If the viewport cannot fit the Statistics
minimum and the approximately 120 px Solves floor, Statistics scrolls internally;
rows remain mounted and the panels do not overlap. Keyboard Home/End and ARIA
minimum/maximum values use the effective constraints.

A spacing follow-up keeps each secondary metric label and value together as one
inline-flex group. The flex parent distributes only complete BPA/WPA/Target
groups, wraps them at narrow widths, and never inserts placeholder columns.
Statistic names use the stronger 0.875rem/600 desktop treatment and 0.8125rem
on narrow layouts without changing the divider architecture. Playwright geometry
asserts the actual label/value gaps, same-line placement, group containment,
order, and left/edge distribution for every metric combination, plus wrapped
long-value groups and the ao9999 custom-average label at desktop, narrow desktop,
390 px and 320 px. The wrapped layout remains included in the intrinsic divider
measurement.

Verification: TypeScript passed. Oxlint passed with the pre-existing
`SessionPanel` purity warning. Full Vitest **823 passed in 58 files**. Production
build and PWA generation passed. Focused Chromium coverage passed: statistics
**11/11**, resizable sidebar **9/9**, average trimming **3/3**, timer statistics
**1/1**, accessibility **3/3**, and responsive timer **5/5**. Large synthetic
correctness/profiling used 100,000 solves: six visible average sizes built in
about 295 ms, an ao10000 prediction in about 4–6 ms, and an appended-solve
rebuild in about 258 ms in the Vitest environment. Light/dark desktop, narrow
desktop, 390 px and 320 px layouts were inspected with all metrics enabled; no
horizontal overflow was observed. Firefox/WebKit, live Drive and
assistive-technology checks were not run for this change. No release version
changed.

### Timer workspace indicators removed — 2026-11-06

The decorative phase pill, dot, `Ready`/`Inspecting`/`Arming`/`Armed`/`Solving`
labels, and the top-right event/mode group (`3×3`, `Inspection on`, `Timing`,
`15s + 2s · WCA`) were removed from the timer workspace. No replacement label,
icon, tooltip, or layout spacer was added. The timer section keeps a stable
`Timer` region label and the readout stays centered. Phase background/border
transitions, the bottom arm meter, inspection thresholds, penalties,
keyboard/pointer input, event selection, and timing calculations are unchanged.
Unit coverage asserts every timer state renders no phase or workspace status
labels; Chromium checks assert absence during idle/holding/ready, unchanged
readiness feedback and colors, centered readout geometry, and no timer-stage
event text while the selected event still drives the session and timer.

Verification: TypeScript and Oxlint passed (pre-existing `SessionPanel` purity
warning only). Full Vitest **823 passed in 58 files**. Focused Chromium:
timer stability **8/8**, timer response **1/1**, responsive timer **5/5**, and
accessibility **3/3**. Production build and PWA generation passed. Firefox/
WebKit, live Drive and assistive-technology checks were not run for this change.
No release version changed.

## Timer stability, inspection, statistics and Analytics rail — 2026-11-05

The timer readout no longer reserves the Draw Scramble gutter, so floating tools
are layout-independent and the timer's coordinates stay fixed through open,
close, drag, resize, tool switching and multiple viewports. The visible timer
captions were removed while the phase pill, colors, arm meter and accessible
timer label retain state feedback. Inspection now uses the preserved
`inspectionStartedAt` through holding and armed states, so its display keeps
updating while Space is held; release still starts the solve and penalties are
still evaluated from the actual solve start.

The Statistics panel keeps its Sessions → Statistics → Solves position. Rows show
current and best values, expand independently, and reveal an editable per-event
target, BPA, WPA and target-aware next solve. BPA/WPA and next-solve calculations
reuse the shared recorded-time, trimming and DNF helpers. Targets persist in the
existing Settings v10 record through `statTargetsMs`, backups and field-by-field
sync; expanded-row state is local. Expanded rows scroll inside the resizable
statistics panel, preserving Solves usability. The Analytics rail now keeps its
heading outside the bounded tab scroller and prevents section switches from
focus-scrolling it.

Verification: TypeScript and Oxlint passed (the pre-existing `SessionPanel`
purity warning remains). Full Vitest **805 passed in 58 files**. Production build
and PWA generation passed. Chromium focused coverage: timer stability/inspection
**8/8**, expandable statistics **5/5**, Analytics rail layout **4/4**, existing
Analytics **13/13**, resizable sidebar **8/8**, average trimming **3/3**,
Draw Scramble **15/15**, accessibility **3/3** and responsive timer **5/5**.
`e2e/timer.spec.ts` passed **61/62**; its backup-dialog focus assertion fails in a
baseline copy with this work reverted as well, so it is pre-existing and was not
changed. Firefox/WebKit, live Drive and assistive-technology checks were not run
for this change. No release version changed.

## Settings debloat, Analytics order and release versioning — 2026-11-05

Analytics now orders filters **Event → Sessions → Date range → Last solves →
Penalty** with filtering logic and persisted values unchanged. Session Settings
removes its permanent name/uniqueness explanation and transfer preamble, states
inspection as `Global default · Off` or `Session override · On`, removes nested
surface containers, and keeps its Done action visible while the body scrolls on
short screens.

The main Settings dialog keeps only short functional descriptions visible.
Explanatory disclosure sections were removed after review; detailed inspection,
warning, summary, trimming and keyboard behavior remains documented in the
README. Statistics retain every visibility and custom-average control;
destructive Developer actions keep their typed-confirmation handoffs; and About
includes the release version. Light/dark, focus containment, keyboard activation
and narrow layouts remain intact.

`src/release.json` is now the single release record. `src/lib/version.ts` formats
the footer and About labels, while `scripts/release.mjs` updates patch, feature or
major releases using the current `America/Toronto` date. Dry runs and a guard
against uncommitted duplicate release edits are included. The current released
version remains `0.01.261104:1`; no release was declared by this implementation
work and ordinary builds do not change the record.

Verification: TypeScript passed; Oxlint passed with the pre-existing
`SessionPanel` purity warning. Full Vitest **759 passed in 55 files**, including
release-date boundary tests. Production build and PWA generation passed before
and after mock-Drive browser runs. Chromium Playwright: Analytics **13/13**,
focused Settings/session flows **8/8**, Session Settings transfer flows
**5/5**, average trimming **2/2**, and accessibility/axe **3/3**. Mobile checks
covered 320×568 and 390×844 light/dark layouts, the Settings controls, and
horizontal-overflow bounds. Visual inspection used synthetic/empty local data
only. No full browser matrix or release publication is claimed.

### Explanatory Settings disclosures removed — 2026-11-05

The explanatory Settings disclosures were removed after review: inspection
penalties, warning behavior, footer DNF/+2 summaries, average calculations and
keyboard shortcuts no longer expand inside Settings. Their component, test IDs,
chevrons, styles and exclusive helper code are gone. Short inline descriptions,
controls, validation, destructive warnings and Developer actions remain; detailed
rules stay in the README. Desktop and 320px mobile visual checks showed no empty
gaps, leftover disclosure styles or horizontal overflow. TypeScript and Oxlint
passed with the existing `SessionPanel` warning; focused Vitest **43/43** passed,
the production build/PWA passed, and focused Chromium accessibility, Settings and
trimming checks passed **9/9**. No release version changed.

## UI debloat and responsive verification — 2026-11-05

The timer/sidebar workspace now sizes to content and scrolls below the timer on
narrow screens, with a compact short-height layout, so the readout cannot paint
under Sessions or Statistics at 320×568, 360×640, 568×320 or 844×390. Settings,
Solve History and Analytics moved to a four-step type scale; redundant dialog
eyebrows and the Settings intro were removed; the Drive status row is now one
human-readable state with technical sync details behind a disclosure; narrow
Solve History rows use the row menu instead of cramped inline penalty buttons;
and narrow Analytics filters collapse behind a Filters control with an active
count. The repeated Latest DNF indicators and the Analytics averages Size column
were intentionally left unchanged.

TypeScript and Oxlint passed (the pre-existing `SessionPanel` purity warning
remains). Full Vitest: **743 passed in 54 files**. Production build and PWA
generation passed. Chromium focused checks: responsive timer **5/5**, Analytics
**12/12**, accessibility **3/3**, and timer/session-management/average-trimming
**82/82**. WebKit responsive timer, Analytics and accessibility: **20/20**.
Firefox responsive timer, Analytics and accessibility passed; clean reruns of
the previously failing Drive split/delete and trimming cases passed **3/3**.

The full `npm run check` did not produce a clean matrix. Its first browser run
reused a stale preview for the Drive cases; clean targeted reruns passed. Eleven
Firefox mobile per-event cases still fail before the changed UI paths because
the custom event selector ignores Playwright Firefox `isMobile` pointer clicks;
keyboard selection reaches the same events. No full-matrix pass is claimed.

Visual inspection used isolated synthetic history at 1440×900 and 390×844 in
light and dark themes, plus timer layouts at 320×568, 360×640, 568×320 and
844×390. Settings, Solve History, Analytics, the filter disclosure and the Drive
sync details were included. No real history or live Drive account was used.

## Previous application verification — 2026-11-04

Node v22.23.2. Previous checks on the working tree:

| Check | Result |
| --- | --- |
| TypeScript, Oxlint | Passed; one pre-existing `SessionPanel` purity warning remains |
| Full Vitest run | 743 passed in 54 files |
| Production build + PWA | Passed; normal non-mock output restored after browser runs |
| Focused Chromium merge/split/sync flows | 19/19 passed (`session-management`, `cross-tab-timing`) plus duplicate-name merge 1/1 in `timer` |
| Visual merge/split inspection | Passed in light/dark at 1440×900 and 390×844 with long names and a 420-solve session |
| Focused csTimer Chromium flows | 3/3 passed (unknown custom types; invalid/valid additive import; ranked names, empty sessions and omitted defaults) |
| Example fixture visual/axe check | Passed; 49 sessions, 8,591 solves and nine empty sessions represented |

### Merge and split sessions verification — 2026-11-04

The session transfer path was exercised with stale-device ownership, concurrent
offline additions, cancellation, failed session/sync writes, reload, native
backup export, cross-tab adoption and mock-Drive publication. Focused Chromium
coverage verified merging multiple sources into an active destination, preserving
solve IDs/fields and destination settings, splitting a custom-event range with
copied settings and a new ordered/active session, storage-failure rollback,
cross-tab transfer adoption, and a stale cloud source snapshot that must not
duplicate or reclaim moved solves. Unit coverage adds empty and 10,000-solve
sessions, duplicate names, incompatible events, equal timestamps, backups,
schema-v5 load compatibility, transfer normalization and sync merge behavior. No
Undo is offered for either operation.

### Analytics debloat verification — 2026-11-04

The Analytics dashboard received a focused design pass: removed the eyebrow,
subtitle, scope-status and section dots, nav markers, metric descriptions and
read-only footer; flattened the statistics overview into a primary metrics row
and a compact secondary grid; turned the analysis rail into a flat index with an
accent selection rule; compacted the filters, empty states and Sub-X controls;
and paired the activity heatmap with the volume chart on wide screens. The green
accent remains reserved for the fastest single, selection, links and primary
actions. Calculations, filters, persistence, chart interactions and the nine
sections are unchanged.

Chart measurement now reattaches its `ResizeObserver` when an empty analysis
becomes populated, covered by a focused AnalyticsPage regression test.
TypeScript and Oxlint passed (one unrelated pre-existing `SessionPanel` purity
warning remains). Full Vitest: **708 passed in 51 files**. Focused Chromium
coverage passed `e2e/analytics.spec.ts` **12/12**. The production build and PWA
generation passed without mock Drive. A one-off axe scan of the Analytics page
reported no violations in desktop light, desktop dark, or 390 px layouts.

Manual inspection used isolated synthetic histories with 140–266 solves, seven
sessions and empty data. Light and dark themes were checked at 1440×900,
1280×720, 1024×768, 768 px tablet, 390 px and 320 px; filters, Customize, the
session menu, the Sub-X split, the solve list, histogram tooltips and 150%
interface zoom were included. Automated Chromium coverage also exercised long
session names, multi-year ranges, 10,000-solve histories and empty session
selections. No real history or live Drive account was used. Firefox/WebKit, live
Drive and assistive-technology sessions were not run for this visual change.

### Analytics layout, dropdown and footer verification — 2026-11-04

TypeScript and Oxlint passed. Full Vitest: **691 passed in 50 files**.
Focused Chromium coverage passed `e2e/analytics.spec.ts` **12/12**,
`e2e/session-management.spec.ts` **9/9** and `e2e/timer.spec.ts` **62/62**
(83/83 in the final combined run). The affected accessibility, draw-scramble,
custom-events, average-trimming, time-trend, cross-tab-timing and timer-response
suites also passed **32/32** after their custom-selector expectations were
updated. Four initial failures were test selectors still targeting removed
native `<select>` elements; no product behavior failed. The mock-Drive
delete-all/non-resurrection and session-order persistence cases passed.

Visual inspection used isolated synthetic history spanning 2025–2026, 20–26
long-named sessions, 420-solve active histories, empty data and multi-year date
ranges. Light and dark themes were checked at 1440×900 and 1280×720; narrow
390 px views covered the heatmap, scrolled Sub-X table, session menu and timer
footer; 150% interface zoom covered the Sub-X layout, menus and analysis
scrolling. The Sub-X table headers remained sticky, the session menu stayed
inside the narrow viewport, the footer summary read `415 / 420 · 1.88 h`, and
the version label read `0.01.261104:1`. No real history or live Drive account was
used.

### Single-screen Analytics and session-summary verification — 2026-11-04

TypeScript and Oxlint passed. Full Vitest: **677 passed in 47 files**. Focused
Chromium Analytics/session coverage passed **18/18**, including all/none/partial
and individual session selection, the no-sessions empty state, desktop fit at
1280x720 and 1440x900, internal personal-best scrolling, 150% interface zoom,
summary hours/formatting and independent summary settings. The timer,
accessibility and timer-response suites passed **66/66**. Light/dark desktop,
narrow 390 px, long sessions, 250-solve histories, empty sessions, disabled
summary states and the increased-zoom layout were visually inspected. The
desktop page did not scroll as a whole; longer tables and the analysis list
scrolled internally. No real history or live Drive account was used.

### Session management, Analytics and dropdown verification — 2026-11-04

TypeScript and Oxlint passed. Full Vitest: **676 passed in 47 files**. New
focused Chromium coverage passed: `e2e/session-management.spec.ts` 8/8
(session event correction and field preservation, reload and backup, keyboard
reordering and persistence, delete-all confirmation/cancellation/tombstones,
storage failure, optional summaries with DNF/+2/edits/Undo/session switches,
timer locks, and mock-Drive non-resurrection) and `e2e/analytics.spec.ts` 7/7
(session filter row alignment, keyboard multiselect, drill-down reset,
one-analysis navigation, narrow selector, precise Sub-X/presets/persistence,
and extreme-solve histogram scaling). The affected existing Chromium suites
(`timer`, `accessibility`, `draw-scramble`, `custom-events`,
`cross-tab-timing`, `sidebar-resizable`, `average-trimming`, `time-trend`,
`timer-response`) then passed **102/102**; the accessibility audit was re-run
after the final UI changes and passed 3/3. Production build and PWA generation
passed without mock Drive, restoring normal output after the browser runs.

Visual inspection used isolated synthetic histories with 163–199 solves, long
session names, custom events, empty sessions and 600-second outliers. Light and
dark themes, desktop and 390 px widths, collapsed/expanded Developer options,
Session settings confirmation, session reordering, the Analytics overview and
one-analysis nav, the session multi-select, distribution and Sub-X panels were
inspected. No real browser history or live Drive credentials were used. The full
Firefox/WebKit matrix, live-provider validation, physical touch/keyboard-only
hardware and assistive-technology sessions were not run for this change.

Earlier the same day, the full custom-event browser flow, an Analytics
customization persistence check in WebKit, and a full Playwright run were
completed before this import/preview work. The full browser matrix was not rerun
after the focused csTimer changes, following the resource-conscious verification
policy in [AGENTS.md](AGENTS.md). No real user data or live Drive account was
used.

The nine existing skips remain unchanged and are described in README's
verification section. No physical-device, assistive-technology, live Drive or
production OAuth validation is implied. Analytics runs on the main thread: the
100,000-solve case establishes correctness, not a browser performance or memory
ceiling. Normal production output was restored with a non-mock build after the
mock-based browser runs.

Routine development uses the tiered workflow in [AGENTS.md](AGENTS.md): manual
inspection for trivial visual work, affected Vitest plus TypeScript/lint for
logic, one-browser Playwright with `--workers=4` for major flows, and the full
browser matrix only for significant releases or explicit requests. Destructive
save/import/restore/Drive paths keep their focused browser coverage.

### Developer reset verification — 2026-11-03

TypeScript and Oxlint passed. Focused Vitest coverage for the Developer reset
(`ConfirmDialog`, `SettingsDialog`, `sessions`, `sync`, and `useSync`) passed with
159 tests. The cases cover typed confirmation, multiple sessions, empty sessions,
custom events, preserved session configuration, bulk tombstones, merge
non-resurrection, durable reset records, and skipping snapshot cleanup for the
reset publication. Playwright was intentionally not run for this task, so the
rendered browser layout and live Drive transport remain unverified.

### csTimer import and preview verification — 2026-11-03

The additive csTimer flow now previews a single session/count table and applies
the same final names shown there. `Example Cstimer Import.txt` contains 49
sessions and 8,591 solves; all 49 rows appeared, including its nine empty
sessions, with `3x3` at 7,061 solves and `8x8` at 0. Valid metadata that omits
`opt.scrType` resolves to csTimer’s `333` default. Explicit unsupported
identifiers remain stable custom events, while missing or malformed metadata is
not converted to 3×3. Numeric names, case-insensitive collision numbering,
already-numbered names, name-length limits, rank ordering with session-number
fallback, empty-session date fallback, persistence and native backup round trips
are covered by unit tests.

Verification at that checkpoint: TypeScript and Oxlint passed. Full Vitest: 635 passed in 46 files.
Focused Chromium csTimer coverage passed 3/3: the custom-event unknown-type flow,
the invalid/valid additive import flow, and the ranked-name/empty-session/default
flow. A one-off isolated Playwright check against `Example Cstimer Import.txt`
passed with no serious or critical axe violations; light, dark, 390 px narrow and
150% interface-zoom screenshots were inspected, including long names, empty
counts and reachable actions. Production build + PWA passed and was rerun without
mock Drive to restore normal output. The full browser matrix, live Drive and
offline re-verification were intentionally skipped. No real user history was
used. Existing imports were not automatically repaired or reclassified.

## Performance optimization and 3D viewer lifecycle — 2026-11-05

Analytics now computes section-specific reports only when their analysis is selected,
while the overview keeps its own calculations. Shared valid/effective-time views and
rolling-series builders reduce repeated filtering/sorting, and the fastest/slowest
five solves use bounded selection. The 2D net is generated only for the visible
2D view and reused while its scramble and size are unchanged. Infrequently opened
dialogs are lazy-loaded and mounted only when open. The 3D Draw Scramble player is
kept connected to a persistent offscreen host across Timer/Analytics navigation,
tool switching, and event changes, avoiding cubing.js' shared-renderer path and
unbounded graphics-context allocation.

Verification: TypeScript and Oxlint passed (pre-existing `SessionPanel` warning
only). Vitest focused files passed: `src/lib/analytics.test.ts`,
`src/components/AnalyticsPage.test.tsx`, `src/components/ToolPanel.test.tsx`,
plus Data/Merge/Split dialog tests. Production build and PWA generation passed.
Chromium Playwright: `e2e/draw-scramble.spec.ts` 15/15 and
`e2e/analytics.spec.ts` 13/13. Firefox Chromium-equivalent color regression:
1/1. No live Drive validation was run.

Baseline/after measurements on isolated synthetic 10k-solve histories:
- Analytics open: 405.5 ms -> section-specific calculations are now deferred;
  distribution 151.5 ms, consistency 78.3 ms, advanced 91.9 ms, progression
  111.8 ms when selected.
- Stop to displayed result: 89.4–106.3 ms with a 158–315 ms long-task total;
  storage write 22.3–23.3 ms for 5.19 MB; sync fingerprint 55.7–63.6 ms.
- Main bundle: 578,390 -> 484,690 bytes raw (162,806 -> 141,120 bytes gzip).

## Immediate work

1. **Verify floating-panel occlusion.** Floating tools no longer influence timer
   layout and the readout no longer reserves a gutter. Inspect the default,
   moved and restored panel placements at desktop, 320/390 px and landscape to
   confirm a deliberately overlapping panel does not hide the digits; preserve
   pointer isolation and refresh affected screenshots after UI changes.
2. **Profile large-history performance.** Use the 7,000–10,000-solve matrix
   below, with sync on/off and charts open/closed. Include the Analytics page and
   separate first-result response from chart completion and durability before
   optimizing. Establish whether any expensive analytics pass needs worker
   offload or incremental caching.
3. **Optimize the measured bottlenecks in hashing, statistics and charts.**
   Enabled-sync hash caching must preserve exact pending/in-flight detection;
   chart/statistics/analytics caches must invalidate after edits, deletion/Undo,
   imports, session changes and trimming changes.
4. **Design incremental storage separately.** Include migration, recovery,
   failure and cross-tab safety before replacing whole-collection writes.
   Do not debounce saves to improve a benchmark.
5. **Complete external validation within its authorization.** Live Drive requires
   explicit test authorization and a short-lived credential. OAuth publishing
   needs the Google Cloud owner. Physical mobile/trackpad and assistive-technology
   checks remain open. Recheck the dated build-tool advisory before choosing a
   compatible dependency change; preserve offline behavior.

## Profiling matrix

Use isolated synthetic histories and memory/mock Drive; never real solve history.

| Dimension | Cases |
| --- | --- |
| History | 7,000 and 10,000 solves, including field metadata |
| Runtime | Development (`localhost:5173`) and production preview (`127.0.0.1:4173`) |
| Browser | Actual Zen when available; record exact browser/version for comparisons |
| Input | Keyboard and pointer |
| Insights | Chart closed/open; expanded/custom large averages |
| Synchronization | Disabled/enabled with mock Drive |
| Measurements | Input dispatch, captured timestamp, first stopped-result render, chart completion, serialization/write cost, long tasks |

Discard/identify warm-up, record sample counts and median/range, and distinguish
DOM observation from physical contact/display latency. Do not use host-specific
performance thresholds as correctness assertions. Historical sync-off Firefox/
Chromium numbers are in the [archived handoff](docs/archive/NEXT_SESSION_HANDOFF.md#performance-evidence-and-remaining-costs);
raw traces are not tracked and those numbers were not independently remeasured.

## Documentation consolidation — 2026-11-01

Current instructions/status/limits now live in the five root documents. Detailed
milestone evidence, completed plans, the former handoff and pre-consolidation
roadmap are preserved in [docs/archive/](docs/archive/README.md). Archive snapshots
may contain superseded statements and approval boundaries; use current guidance
for new work. This consolidation changes documentation and skill references only.

Documentation checks passed: local links/fragments, active source/test paths and
npm scripts, all four project skill validators, seven-skill OpenCode runtime
discovery and `git diff --check`. Archived bodies were initially compared with
originals, allowing only relative-link rebasing; future feature-phase proposals
were subsequently removed from both current and archived plans at the user's
request. Application source, tests,
dependencies and prior working changes were preserved; the application suite
was not rerun for this documentation-only consolidation.
