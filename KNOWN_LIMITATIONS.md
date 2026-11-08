# CubeLab known limitations

**Reviewed:** 2026-11-07 against the implementation and the latest recorded
regression run. See [STATUS.md](STATUS.md) for test results and immediate work.
These are current boundaries; dated repair details are in the
[archived limitations record](docs/archive/PATCH_LIMITATIONS.md).

## Layout and performance

- **Floating tools overlay the timer.** Tool panels no longer participate in the
  readout's layout, so opening, dragging, resizing, or switching tools cannot move
  the timer. A panel deliberately dragged over the digits can still cover them;
  the layout tests verify position stability, not every possible occlusion.
- **3D viewer lifecycle is fixed for the shared-renderer path.** The player is
  retained across navigation, tool switching and event changes, so repeated
  Timer/Analytics round trips no longer create additional vantages or enter the
  shared renderer path. A red/blue channel swap in that path was reported on Zen,
  but was not reproduced on Playwright Chromium 152 or Firefox 157; the new
  regression compares rendered sticker colors across five round trips in both
  engines.
- **Stop performance evidence is limited.** Historical measurements used 7,000
  synthetic solves, sync/audio off and isolated Firefox/Chromium. Actual Zen,
  enabled sync, 10,000 solves and physical display latency were not established.
  Chart/statistics completion can lag the first stopped result.
- **Session total time is a rounded hour display.** Completed sessions show
  hours to two decimals in the timer footer; a short session can therefore read
  `0.00 h` even when it contains valid solves. The underlying millisecond sum
  remains precise and the completed/total count stays exact.
- **Statistics predictions are training aids.** Target compares the next rolling
  average with the current session PB using strictly faster-than semantics; BPA
  and WPA assume a 0.00 or DNF next result. They follow the current event,
  trimming, penalty and recorded-precision rules, but they are not WCA results
  or probabilities. A target can be `—`, `N/A`, a numerical ceiling, or `∞` when
  every finite result qualifies. Metric visibility is synchronized; legacy
  `statTargetsMs` values remain stored as inert compatibility data.
- **Divider minimum depends on rendered content.** The intrinsic sample includes
  the active fonts, panel width, enabled rows and wrapped metrics, so browser
  font fallback, extreme text scaling or an unusually narrow sidebar can change
  the stopping height. If the viewport cannot fit that minimum and the Solves
  floor, Statistics scrolls internally rather than hiding an average.
- **Saving still writes the full collection.** Browser storage serialization and
  writes are synchronous. Enabled sync still calculates full fingerprints;
  statistics/chart data rebuild after changes. Future caching or incremental
  persistence needs exact invalidation and durability/recovery tests.
- **Analytics runs on the main thread.** The page is lazy loaded, calculation
  results are memoized, dense chart lines are downsampled and the filtered
  solve-list dialog is virtualized. A synthetic 100,000-solve correctness case
  passes, but no Web Worker offload, physical-device profiling, memory ceiling or
  100,000-solve browser workflow has been established. Very large histories can
  still make the first Analytics calculation block noticeably. Practice activity
  keeps full-range aggregates sparse, but the heatmap is a bounded calendar
  window (about one year) with earlier/later and earliest/latest navigation; it
  does not display every elapsed day in one view. Relative date filters and the
  current streak refresh at the next local midnight and after the page becomes
  visible or focused again. A tab whose timers are fully suspended by the
  platform catches up when it returns; no background execution is claimed.
- **Analytics is read-only and tag-free.** There is no solve-tag schema, so tag
  filters are not offered. Session comparison uses each included session's
  matching history rather than the latest-count limit. Statistical target
  estimates are labeled approximations, not predictions or WCA probabilities.
  The one-analysis layout ignores the legacy `wide` section preference (it is
  still stored and synchronized). Retired Solve explorer entries in older saved
  layouts are ignored; solve drill-down now uses the filterable details dialog.
  Distribution edge intervals group values beyond the central 98%, so the
  first/last x-axis ranges can be wider than the selected interval; all values
  remain counted and drillable. Sub-X presets are offered for built-in events
  only; custom events keep free-form entry. The Sub-X chart/table split is
  session-local presentation state and resets to its default on reload. Practice
  activity shows the complete filtered range and scrolls horizontally when it is
  very long; it no longer silently limits itself to 52 weeks. Desktop Analytics
  keeps the page itself fixed and scrolls the overview, analysis navigation or
  selected analysis internally; at high interface zoom or short viewports users
  may need to scroll those regions rather than seeing every card or table row at
  once.
- **Custom dropdowns replace native menus.** The shared combobox/listbox supports
  keyboard selection, type-ahead, Escape/outside dismissal, viewport-aware
  positioning and focus restoration, and menus opened inside dialogs remain in
  the dialog's focus containment. Browser automation and axe scans do not replace
  a physical screen-reader, switch-control or touch validation pass. Native date
  inputs remain platform controls.
- **Fingerprints have limits.** Render-time pending detection relies on immutable
  React state references; in-place mutations can leave the display stale.
  In-flight guards recompute content fingerprints, but 32-bit FNV-1a is not a
  collision-free equality proof.

## Synchronization and recovery

- **One editable tab per origin/profile.** A document-lifetime Web Lock is
  acquired before startup recovery. Additional current-build tabs wait without
  mounting the editable app and open automatically when the owner closes.
  Background tabs keep ownership; focus and elapsed time never steal it.
  Coordination failure or missing Web Locks blocks editing rather than using
  a racy storage lease. Separate browsers/profiles/devices/origins and pages
  already running an older build do not participate in this exclusion. Retain
  the underlying sync/recovery safeguards; this does not repair ordinary
  storage-read failures or invalid imported dates. Refresh older tabs after
  deploying this policy. Legacy-client protocol tests explicitly simulate
  pre-gate clients; production has no bypass.

- **Drive convergence is eventual.** Each device must merge again to see another
  device's newest snapshot. Unique immutable files prevent overwriting a writer's
  snapshot; they do not provide ordering, push delivery, read-after-write
  guarantees or a transaction across files. Web Locks serialize same-origin
  writes only. ETag/`If-Match` protects the legacy mutable file only.
- **Review is not consensus.** Different approval sets can yield different
  results until exchanged. A newer local approval can hide an older independent
  cloud approval in a multi-remote disagreement. Redirect merging is deterministic
  but an applied redirect cannot be automatically undone.
- **Duplicate names require user action.** Same-named sessions are never merged
  automatically. Dismissing a warning leaves the collision unresolved until the
  user reopens the Drive review action.
- **Merge and split operations are not undoable.** Whole-session merges use
  redirect records and partial splits use durable solve-ownership records; both
  converge eventually with other devices. CubeLab does not offer Undo because
  reversing an already-published redirect or transfer safely would require a
  separate conflict/approval design. Use a backup before reorganizing data.
  Simultaneous splits of the same solve use the newest transfer record with a
  deterministic device/ID tiebreak, so one destination may remain empty; solve
  fields and identities are still preserved rather than duplicated or discarded.
- **Split ownership depends on current clients.** Older clients do not
  understand partial-split transfer records. Keep every syncing browser on a
  current build; an older client can publish a stale source copy, which a current
  device will place back in the recorded destination on its next merge.
- **Cleanup is best effort.** Listing can lag uploads; independent deletes can
  partially succeed. Automatic cleanup runs after merge/publication, preserves
  each group's newest snapshot and can prune superseded device groups. Manual
  cleanup is own-device only. Legacy ownership falls back to sanitized filenames;
  unusually renamed files may group separately. No server-side cleanup job exists.
- **Legacy deletions remain ambiguous.** Tombstones without `knownSolveIds` use
  wall-clock comparison for clearly newer solves and explicit review for the
  ambiguous set. A user can choose incorrectly; older clients may not understand
  recovery review or durable `restoredAt` revocations. Keep sharing clients current.
- **Resolution history is local and bounded.** It retains 50 entries, is neither
  synced nor exported, and is lost if sync storage is cleared. Undo requires the
  exact decision to remain current; redirect merges, completed legacy recovery
  and superseded decisions are not automatically reversible.
- **Exit sync is best effort.** A browser may terminate OAuth/network work on
  close despite lifecycle requests. Local storage remains the durability boundary.
- **Provenance depends on sync metadata.** Clearing `cubelab:sync:v1` loses
  settings timestamps and local review history. First-sync settings then use the
  conservative fallback. Cross-tab adopted settings can lack external timestamps
  if the other tab has not yet published metadata. Selection metadata/review is
  implemented and regression-tested; it does not establish multi-device consensus.
- **Single-solve deletion requires durable sync metadata.** If the sync record
  cannot be written, CubeLab blocks the deletion instead of hiding the solve. If
  the solve collection cannot be written after the deletion record is saved, the
  revocation is persisted so the solve stays visible and its stale copies are not
  deleted on another device. The deletion still publishes only on a later
  successful synchronization.
- **A partial Undo uses a local recovery journal.** Undo first saves a durable
  local record containing the solve, its session and its position, then records
  the revocation and restores the collection. If the collection write fails, the
  journal survives reload and is applied before synchronization; sync stays
  paused while it remains pending. Recovery retries only on mount, storage-health
  changes, timer-idle transitions or explicit sync. The journal is local-only, is
  not included in remote envelopes, and is not an atomic transaction across the
  two storage keys. A journal whose original deletion is still active is treated
  as an Undo interrupted before its commit point: it aborts conservatively and
  the solve stays deleted. Once revocation is committed, recovery completes.
  A causally later deliberate deletion supersedes the journal, while older
  records without original-deletion metadata also use the conservative abort.
  If the recorded session was deleted or its event changed, recovery uses a
  labelled same-event recovery session instead of mixing events. Native and
  manual backups include that materialized solve, but clearing this browser's
  local recovery/sync storage can still discard the only pending copy.
- **Custom event definitions use the same eventual-merge boundary.** Stable IDs
  and event tombstones prevent duplicates and keep deletion intent, but an older
  client that does not understand `custom:` events or event tombstones may still
  publish without them. Keep every syncing browser on a current build.
- **Session order is last-writer-wins, not review-gated.** Concurrent reorders
  converge deterministically and never remove sessions, but the losing order is
  not surfaced as a manual conflict. Equal-timestamp ties use editor-ID and
  serialized-ID order, so an unusual mix of both orders can result until a user
  reorders again. Reordering lives inside the session selector and supports
  pointer drag handles, arrow-key reordering, and accessible Up/Down controls.
- **Delete all sessions preserves recovery semantics.** Session and solve
  tombstones prevent every solve known to the deleting device from returning.
  A solve created only on another offline device and never merged can still
  arrive later and is recovered into a clearly labelled recovered session, as
  with the existing solve reset. Google Drive snapshots are not deleted.
- **A full reset only tombstones solves this device knows about.** A solve created
  solely on another offline device and never merged can arrive later. The
  reset-triggered publication skips snapshot cleanup so existing historical
  snapshots are not pruned by that operation; later routine synchronization still
  follows the configured retention policy. Keep devices synchronized when a
  cross-device wipe is required.

## Import and supported scope

- **Failed startup reads never authorize an empty autosave.** Startup validates
  current sessions (or legacy history only when the current key is absent) and
  passes that checked snapshot to the editable hooks. Failed reads, malformed or
  unsupported records and unrepresentable stored dates keep the app behind the
  recovery screen with the original bytes intact. Retry handles recovered
  storage access; it does not automatically repair malformed records. A damaged
  record still requires correction or recovery from a valid backup before the
  editable app can open. The gate deliberately does not expose import/editing
  hooks over an unvalidated collection. Missing storage retains memory-only
  behavior. Completion-buffer replay uses the same checked read.
- **Native dates must be representable.** Provided session/solve creation or
  update timestamps outside JavaScript Date's range reject a native file or
  downloaded backup before mutation. History rows have a defensive Unknown date
  display, but this is not a policy of silently dropping invalid stored solves.

- Native CubeLab JSON imports replace local data after confirmation; csTimer
  imports add sessions and retain existing settings. Neither implements a general
  local-file merge by solve ID. The import cap remains 10 MB. Export prefers
  readable JSON and falls back to compact JSON; if the complete payload still
  exceeds the cap, the export is blocked with the measured size and no file is
  created. Manual and automatic Drive uploads apply the same check. A collection
  that cannot fit the unchanged cap has no full-backup path until it is reduced
  or a future format is designed; solves and metadata are never silently
  omitted.
- **Replacement recovery uses separate local-storage keys, not a transaction.**
  Native import, additive csTimer import and Drive restore capture previous
  sessions/settings/sync/drive values in a local journal, write every candidate,
  then record a commit marker before showing success. A prepared journal is
  rolled back at startup only while this tab owns the same origin-wide Web Lock
  used by the writer; a browser without Web Locks keeps the editable app closed
  rather than guessing that the other writer is dead. A committed journal only
  needs journal cleanup and
  can open normally. Failed prepared rollback/cleanup, or a malformed or
  unreadable record, keeps the editable application closed behind an explicit
  retry state; no session hooks, autosave, timing controls or imports run in that
  state. A cross-tab replacement committed during a solve is deferred until idle,
  then reconciled by stable solve ID so the completion keeps its original
  session/event/scramble. Replay never appends an event-incompatible solve to the
  replacement owner; a removed or reclassified owner is recovered into a labelled
  same-event session, with active solve tombstones preventing resurrection.
  Solves accepted while a candidate is still staged use a local-only completion
  buffer, which is applied before hooks mount on reload. New buffers write one
  local key per solve so competing appends are not overwritten, and cleanup
  acknowledges only exact durable solve versions; the older single-record buffer
  remains readable and its cleanup is still a read/check/write sequence. The
  journal and completion buffer are local-only and are not part of remote
  envelopes, and the separate keys are not a cross-key transaction. Clearing this
  browser’s local recovery/sync storage can discard the only pending copy.
  Cross-tab followers ignore a prepared replacement, but this remains eventual
  coordination rather than an atomic multi-tab commit.
- **An oversized unchanged sync payload remains blocked.** Automatic triggers
  skip the same known-oversized local fingerprint instead of repeatedly
  downloading and rejecting it. Editing the collection, resetting sync state,
  or using **Sync now** retries. Reducing the data or exporting after it fits the
  10 MB limit is the recovery path.
- Invalid rows, durations, or provided dates in csTimer sessions that contain
  solves reject the file before preview. Valid session metadata that omits
  `opt.scrType` uses csTimer’s `333` default; explicitly supplied unsupported
  identifiers become stable custom events, and missing or malformed metadata is
  imported as unavailable rather than converted to 3×3. Empty sessions are
  imported, with import time as the fallback when their dates are missing or
  unusable. Missing solve dates retain the established
  session-date/current-time fallback.
- **Legacy csTimer corrections need manual reassignment.** Automatic correction
  requires retained `importSource` metadata on solves. Imports made before that
  provenance existed have no stored puzzle type, so CubeLab offers explicit bulk
  session reassignment rather than inferring a puzzle from duration or scramble
  text. Reassignment changes the event only and is confirmed before applying;
  sessions with solves now use the same explicit confirmation from Session
  settings. Previously imported sessions are not automatically reclassified when
  csTimer default handling or mappings change; repairs remain a separately
  reviewed operation. The whole session moves together, so intentionally mixed
  events are not supported.
- **Custom events have no scramble generator or 3D/2D visualization.** They show
  the configured placeholder for new solves. Imported csTimer solves keep their
  original scramble text. Solve duration is never used to infer an event, and
  deleting a referenced custom event is blocked until its sessions are reassigned.

## External validation and build tooling

- **Live Drive evidence is dated.** The October 28 harness used independent
  transports in one process, not two physical browsers/machines. It exercised
  immutable concurrency, convergence, legacy conditional writes and cleanup.
  The latest repair suite used mock Drive; no new live-provider claim follows.
- **OAuth publishing is owner-dependent.** The last record reported Testing under
  another owner account. Repository code cannot establish today's console state;
  production branding and non-test sign-in need owner action and verification.
- **Hardware/accessibility coverage is partial.** Browser automation and axe scans
  do not replace physical mobile/trackpad or assistive-technology testing.
  Offline coverage is scoped to the supported Chromium project. Non-cube player
  checks establish puzzle IDs/initialization, not every rendered pixel. README
  describes existing engine-specific skips.
- **Build advisory needs rechecking before action.** The October 30 record found
  `GHSA-gcqx-w48m-w2h4` through `vite-plugin-pwa → workbox-build →
  @rollup/plugin-node-resolve → deepmerge@4.3.1`. It concerned build tooling;
  the proposed forced downgrade broke the offline pipeline. This is a dated
  dependency observation, not a current upstream-status claim. Recheck before
  selecting a compatible fix; do not force-install a breaking downgrade.
