# CubeLab known limitations

**Reviewed:** 2026-11-21 against the implementation and the latest recorded
regression run. See [STATUS.md](STATUS.md) for test results and immediate work.
These are current boundaries; dated repair details are in the
[archived limitations record](docs/archive/PATCH_LIMITATIONS.md).

## Data safety and recovery

- **No absolute data-loss immunity.** The checked readers, verified archives and
  replacement journal prevent the specific silent-fallback paths covered by
  `npm run check:data`, but browser storage can still be cleared by the user,
  privacy software, profile deletion, catastrophic quota/filesystem failure or
  browser defects. Persistence is advisory and does not protect against clearing
  site data.
- **Migration recovery is local.** The pre-upgrade archive is not uploaded
  automatically. A user who clears all browser storage loses the local archive
  unless they downloaded an emergency recovery package or native/Drive backup.
- **Recovery export cannot prove a file reached disk.** `RESET CUBELAB` requires
  a prepared download and an explicit acknowledgement, but browsers do not expose
  a durable-save confirmation. The reset keeps caches, the service worker and
  remote Drive files; it is not a complete site reset.
- **Already-deployed legacy clients remain a downgrade risk.** Older builds that
  predate these checks can still rewrite a newer schema if loaded from an old PWA
  cache. This build fails closed on future versions, but it cannot retroactively
  harden historical clients. Clear old caches or update before moving a profile
  between builds.
- **Local data remains whole-collection.** Ordinary saves still serialize and
  write the complete collection synchronously; incremental session storage is a
  separate design-only milestone in
  [INCREMENTAL_STORAGE_DESIGN.md](docs/development/INCREMENTAL_STORAGE_DESIGN.md).
  Safety does not remove the 10k/100k/250k scaling limits described below.
- **Emergency export size is unbounded by design.** Recovery packages preserve
  exact raw bytes and may exceed the native backup/Drive caps. The 250k-solve
  synthetic package measured about 47 MiB; extremely large histories can exceed
  browser Blob/download memory or the destination filesystem.
- **Training has its own recovery boundary.** Training v1 is included in the
  emergency package and native backup, but a verified pre-upgrade archive restore
  only replaces sessions/legacy solves/settings. Training Drive cleanup and sync
  retain their separate provenance and are never selected by solve cleanup.

## Layout and performance

- **Floating tools avoid the readout when dragged.** Tool panels do not
  participate in the readout's layout, so opening, dragging, resizing, or
  switching tools cannot move the timer. A panel dragged and released over the
  timer display is moved to the nearest clear side. Resizing is different: the
  top-left moves while the bottom-right stays fixed, and a resized panel may
  deliberately cover the readout. On a stage too small to fit the panel beside
  the readout, overlap can still occur; the tests cover the normal desktop and
  compact layouts. The 3D Draw Scramble renderer is intentionally frozen during
  a resize gesture and adopts the new size when the handle is released, avoiding
  repeated renderer resizing.
- **3D viewer lifecycle is fixed for the shared-renderer path.** The player is
  retained across navigation, tool switching and event changes, so repeated
  Timer/Analytics round trips no longer create additional vantages or enter the
  shared renderer path. A red/blue channel swap in that path was reported on
  Zen Browser, but was not reproduced on Playwright Chromium 152 or Firefox 157; the new
  regression compares rendered sticker colors across five round trips in both
  engines.
- **Stop performance evidence is limited.** Production Chromium preview
  observations on 2026-11-21 measured keydown-to-idle phase at 4.5–9.5 ms with no
  solves, 12.4–13.5 ms at 1,000 and 70–196 ms at 10,000 across runs. The 10k
  fixture intentionally carries per-field sync metadata (4.6 MB): median ~89 ms
  phase, ~45 ms `JSON.stringify`, ~38 ms `localStorage.setItem`, with the rest
  React render/other. The same history without sync metadata is 1.44 MB and
  measured ~44 ms median. Variance comes from serialization, storage IO,
  compaction and GC. Persistence still writes the complete collection
  synchronously; enabled sync, audio, physical display latency, 100,000 solves in
  a browser and Zen/Firefox/WebKit were not established. Chart/statistics
  completion can lag the first stopped result.
- **Time Trend is compact-only and PB-hover-first.** There is no expanded
  in-panel chart or PB statistics modal; **Analytics** is the large-chart
  destination. The fixed time/ao5/ao12/PB series cannot be customized in the
  panel, and viewport changes come only from the five buttons (no wheel, pinch
  or drag). Pointer hover and clicks are limited to PB markers; generic solve
  details use keyboard inspection. The compact PB card is positioned beside the
  marker and clamped inside the panel. Touch users tap a PB to pin, and keyboard
  users can inspect solves with arrows and Home/End. Screen-reader users receive
  the polite selection summary, but the visual card layout and chart shape are
  not a substitute for the Analytics tables. Pinned cards can be dismissed with
  Escape or an outside tap; they are not modal and do not trap focus.
- **Time Trend's Auto Y scaling is a display aid.** It caps extreme slow singles
  at a robust upper fence chosen by the **Settings → Statistics → Time Trend**
  cutoff preset so one choke cannot flatten the rest of the chart. Auto does not
  draw a separate marker or count for clipped singles; **Full range** shows every
  time and ignores the cutoff. Enabled rolling averages and PBs remain on scale,
  and sessions with fewer than 10 valid singles stay full-range. The lower axis
  bound starts just below the lowest result rather than at zero, so a normal
  session is not compressed into the bottom of the plot. The fence is not a
  statistical outlier classification.
- **Current PB is the latest chronological lifetime PB, not necessarily the
  newest solve.** Only that marker gets the static outer ring; older PB markers
  are static. There is no PB pulse. The hover/pin PB card is the only in-panel
  PB history view; other averages remain in Statistics and Analytics.
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
  writes are synchronous. Sync fingerprints memoize the latest immutable
  `(sessions, settings)` identity pair, so repeated boundary checks in one run
  reuse the traversal; a changed reference still recomputes. Statistics/chart
  data rebuild after changes. Destructive session mutations
  persist once before publishing and skip the follow-up autosave, and an absent
  custom-event collection uses a shared stable empty reference. Future caching or
  incremental persistence needs exact invalidation and durability/recovery tests.
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
  only; MISC keep free-form entry. The Sub-X chart/table split is
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
  a physical screen-reader, switch-control or touch validation pass. Native color
  inputs remain platform controls; Analytics custom dates use the themed range
  calendar.
- **Fingerprints have limits.** Render-time pending detection relies on immutable
  React state references; in-place mutations can leave the display stale.
  In-flight guards recompute content fingerprints, but 32-bit FNV-1a is not a
  collision-free equality proof.

## Competition sessions

- **Rounds are derived from solve fields.** There is no separate round entity,
  round history export, cutoff/combined-round simulation, or competition-day
  standings. Deleting all attempts removes the derived round; deleting one leaves
  an incomplete round that reports no average. If Undo restores an attempt after a
  replacement solve, the round can temporarily exceed the format size; it is
  shown as incomplete and produces no result rather than dropping an attempt.
- **The post-round summary is for the newest round only.** It opens once after
  the timer becomes idle and a previously observed open round completes. Reload,
  switching to a session, or returning to an older completed round does not
  reopen it. The round list remains available in the Statistics rail.
- **Formats are immutable and conversion is one-way.** There is no format editor,
  round reseeding, or practice-to-competition conversion, including through
  split. Changing the session event preserves round membership but does not
  revalidate it against a different puzzle's defaults.
- **Sync convergence favors flattening.** Competition kind, format and round
  fields ride the existing solve/session merge. If one snapshot has already
  converted a session to practice, that flattened shape wins over a stale
  competition copy; no new conflict kind is created. Round IDs are random stable
  strings, so independent devices cannot create the same round by collision in
  normal use, but this is not a cryptographic guarantee.
- **Browser evidence is focused.** Chromium covers creation, inspected timing,
  reload, deletion/Undo, merge/split, conversion, Analytics filtering and an
  offline installed-app round. Live Drive, physical devices, multi-engine
  competition flows and large-history competition stop latency were not
  separately measured.

## Training

- **Local-first persistence with separate cloud paths.** Training is mounted
  under the existing active-tab Web Lock and uses checked v1 reads/guarded
  writes. Native JSON backups include the complete checked Training store when
  the key exists, and restore it replace-only after confirmation. Export blocks
  rather than omitting Training while its store is unreadable, a save is pending,
  a continuity decision is unresolved or a visit is active. The Drive
  dialog also offers manual Training cloud backup and replace-only restore using
  separate immutable `cubelab-training-*` files (16 MB compact JSON) and an
  optional merge-based Training Drive sync. Solve snapshots, solve filenames,
  `cubelab:sync:v1` and the solve 10 MB cap never include Training. Training
  merge covers attempts, ended visits, calibrations, presets, coarse preferences
  and high-water recognition counts, with durable
  attempt/session/preset tombstones and Undo revocation. Automatic Training
  cleanup keeps each device's newest snapshot plus files within the configured
  count/age limits (default 10 snapshots and 30 days); manual Training upload
  cleanup keeps the newest five own files. Local Training history is not pruned
  or aggregated. A replace-only Training restore from native or manual Drive
  clears stale Training tombstones, conflicts and approvals while keeping the
  Training device ID and preferences. The full **Reset All Site Data** action clears the local
  Training store and `cubelab:training-sync:v1` along with other CubeLab-owned
  data, but does not delete remote Training files; ordinary solve/session resets
  leave Training untouched. Clearing browser storage loses Training; its
  recovery-copy download preserves both the in-memory candidate and checked
  external snapshot but is not a native backup importer or an automatic conflict
  merge. Native Training restore is blocked while Training Drive sync is enabled,
  and phase-one replace-only cloud restore is blocked in the same state. Native
  restore is also blocked while Training has an active session, pending save or
  continuity decision. A valid backup can replace unreadable local Training
  bytes through the replacement journal; imported sessions are never resumed
  automatically. An exported session that ended with an undelivered report can
  reopen that report after restore through the existing Training rules, but its
  visit is not resumed.
- **Training convergence is eventual and field-granularity is coarse.**
  Devices must run again to see each other's latest Training file. Preferences
  merge as one whole `preferences` field with editor/timestamp metadata, so two
  devices editing different preferences at the same time produce one reviewable
  conflict rather than independent field merges. Equal-timestamp equal-value
  rows deduplicate, but a same-ID custom algorithm or calibration with different
  content requires exact approval when manual review is on; with automatic
  resolution the deterministic local/newer rule is recorded, not claimed as
  consensus. Deletion provenance lives only in `cubelab:training-sync:v1`;
  clearing it cannot reconstruct old deletions, and an older client can still
  reintroduce a record it never saw deleted. There is no push delivery,
  read-after-write guarantee, or cross-file transaction. Live Drive, physical
  devices, provider concurrency, Firefox/WebKit Training Drive flows and the
  full test suite are not verified.
- **Training publish and ledger recovery are conservative.** A local Training or
  ledger change during an upload aborts the stale publish and retries; it is not
  merged into the in-flight file. A malformed partial ledger blocks writes and
  preserves its bytes rather than repairing itself, and a persisted `syncing`
  status is normalized to pending or disabled on load. Unreadable or oversized
  remote Training snapshots are skipped with a warning and must be deleted
  individually; no automatic repair is claimed.
- **Failed writes cannot promise durability.** The exact candidate stays in
  memory, additional attempts are blocked, navigation retains a visible warning,
  and an unsaved-exit prompt is requested until retry succeeds. Browsers can
  suppress exit prompts, and crashes/forced termination can still discard an
  unsaved candidate. No corrupt bytes or changed external snapshot is overwritten.
- **Portable backup limits.** Native backups stay readable or compact JSON up to
  10 MB and otherwise use checked gzip with a 16 MB encoded and 64 MB decoded
  cap. Files above those bounds, corrupt/truncated gzip,
  invalid UTF-8 and invalid backup or Training records are rejected before
  mutation. Older CubeLab builds cannot read `.json.gz`; restore them with a
  current build. Drive snapshots and csTimer imports keep their separate 10 MB
  cap and never include Training.
- **Deletion Undo is temporary.** Training offers Undo for the latest saved
  attempt deletion through the same six-second notification used by Timer.
  A reload, dismissal, or replacement notification can end that opportunity.
  Preset deletion offers Undo inside the case dialog; closing that dialog ends
  the opportunity. Typed deletion of an archived session writes the visit and
  attempt tombstones in one ledger write and is permanent.
- **Recognition timing splits are estimates.** An estimate needs the attempt's
  captured calibration, a saved algorithm identity and enough matching
  Execution history in the session's saved window. Reports show coverage and
  leave unavailable values blank. Legacy visits without a saved comparison
  policy retain their measured results.
- **Algorithm revision tracking is retired.** Every loaded attempt is rewritten
  to case-only: custom algorithms, preferred revisions, `algorithmTracking` flags
  and attribution are removed at local load, native backup import, Drive adoption
  and Training sync. Timing, setups, visits, calibrations and case statistics are
  preserved. The feature is intentionally absent rather than greyed out and may
  be reintroduced later.
- **Browser continuity has limits.** Named sessions offer an explicit
  resume/end choice after reload or ambiguous reopening. Browser lifecycle
  events do not reliably establish site closure. When ending a recovered
  session without a reliable close time, CubeLab uses the last saved activity.
  The required report and its destination survive reload after a successful
  end write. A previously saved report remains available in Practice history.
  A pre-named-session legacy visit is end-only: CubeLab offers **End visit**
  rather than reopening it as interactive named practice.
- **Persisted verification is metadata.** Loading validates structure/history,
  not physical execution. Runtime built-in and user algorithms and every new setup
  are mathematically reverified. Success is manually reported by stopping; DNF can
  be corrected afterwards. Calibration drafts commit only after seven accepted
  positive repetitions; refreshing a partial calibration discards its draft and
  preserves the previous committed median.
- **Recognition and result visibility.** Upcoming names/diagrams/algorithms stay
  out of the rendered recognition UI. Retrying a revealed known case explicitly
  switches to execution. The fixed physical precursor cannot prevent an expert
  inferring its target from the setup itself. No smart-cube observation is made.
- **Comparisons and large histories.** Visit improvement requires eligible
  successes for matching cases or algorithm revisions in the latest visit and
  its saved baseline. Improvement compares against the full category history,
  while displayed attempt counts and listed statistics remain session-scoped.
  Missing estimates and empty trim windows show a dash.
  The Attempts list windows histories above 200 rows, with Show all available
  for browser search and sequential navigation. Best rolling averages scan
  category history when attempts change. The isolated 8,000-attempt production
  profile measured several hundred milliseconds before the stopped frame,
  including synchronous validation and serialization. It used a memory-backed
  key for the 8.1 MB fixture. Device quota and a pre-redesign timing baseline
  remain unverified. [Profile data](docs/training/ui-redesign/performance.json)
- **Responsive input.** Detailed statistics tables scroll horizontally on
  narrow screens. Physical-device and screen-reader validation remains open.
  The default Last Result docks below the clock in constrained layouts. A
  deliberately positioned floating desktop panel can still cover digits.
- **Built-in defaults and provenance.** All 57 OLL and 21 PLL cases have a
  verified default, available without user entry. The 37 additional PLL variants
  are not included. Defaults are read-only. Algorithm revision tracking is
  temporarily retired, so custom algorithm storage is not part of the current
  workflow. The owner removed CubeLab's internal bundling restriction,
  but no explicit third-party redistribution permission was established. The
  catalog contains only the 78 owner-approved short functional move sequences,
  independently normalized/verified and assembled with source provenance, not a
  copied compilation or artwork. Written permission or legal review remains
  advisable before broader redistribution. See
  [Training memory E13](docs/training/PROJECT_MEMORY.md#e13-built-in-default-ollpll-catalog--2026-11-10).

## Onboarding

- **Onboarding is new in this build.** Its first-run detection deliberately uses
  stored settings, sync identity and Drive metadata as evidence of an existing
  browser. A browser with only an untouched placeholder is treated as new. This
  protects existing users from an unexpected setup screen but cannot distinguish
  a deliberately cleared settings record from a genuinely new browser.
- **Live Google OAuth is not part of routine verification.** Browser automation
  uses the existing mock Drive transport. Popup blocking, account switching,
  cancellation, real redirects and provider outages were exercised through mocked
  states and error paths, not a live Google account. The existing app-data scope
  does not expose the account email, so "Try another Google account" relies on
  Google's account chooser rather than displaying the current address.
- **Returning-user restore uses the normal sync merge.** A clean device adopts
  cloud data through the established merge, tombstones and conflict rules; it is
  not a byte-for-byte replacement. Existing local data is merged rather than
  discarded. If sync reports a conflict that automatic resolution cannot settle,
  onboarding stops and leaves cloud data unchanged.
- **Only the Draw Scramble 2D/3D choice is device-local onboarding configuration.**
  Tool-panel visibility and geometry remain local persisted UI state but are not
  requested during setup. Other global and session preferences are synchronized.
- **Completion summaries use current local counts.** They are not a historical
  audit. A reload during the completion summary opens the timer directly because
  the completed decision is already durable. The summary advances after about two
  seconds and also offers **Skip to timer**.
- **The full site reset is bounded by browser storage APIs.** It removes only
  CubeLab-prefixed localStorage/sessionStorage keys, CubeLab-named IndexedDB
  databases, CubeLab/scoped Workbox caches, this application's exact `sw.js`
  registration and readable CubeLab-prefixed cookies. Browser-managed HTTP cache
  entries and cookies set by Google Identity Services are not fully erasable by
  page JavaScript; locally held Google authorization is revoked/cleared and the
  transport is blocked for the rest of the document. A reset whose IndexedDB
  deletion stays blocked reports a partial failure and must be retried after the
  holding tab or connection closes. The cross-tab reset broadcast is understood
  only by this build, so refresh or close older CubeLab tabs before resetting.
  Google Drive files are never deleted, replaced, or emptied by this action, and
  reconnecting requires an explicit new authorization.

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
- **MISC replaces custom events.** Unknown or `custom:` event IDs normalize to
  `misc` at every ingress, and stored custom definitions are dropped. An older
  client can still publish `custom:` IDs; a current client folds them into MISC.
  Keep every syncing browser on a current build for consistent labels.
- **Session order is last-writer-wins, not review-gated.** Concurrent reorders
  converge deterministically and never remove sessions, but the losing order is
  not surfaced as a manual conflict. Equal-timestamp ties use editor-ID and
  serialized-ID order, so an unusual mix of both orders can result until a user
  reorders again. Reordering lives inside the session selector and supports
  pointer drag handles and arrow-key reordering on the handle; separate Up/Down
  buttons are retired.
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
  local-file merge by solve ID. Uncompressed imports remain capped at 10 MB;
  native files above the compact 10 MB form use checked gzip with 16 MB encoded
  and 64 MB decoded limits. Legacy `.json` backups remain readable, and a native
  file without a Training section leaves local Training untouched. Solve Drive
  uploads (manual and automatic) apply the unchanged 10 MB check and never include
  Training; Training uses its separate 16 MB file family. Onboarding's additive
  import remains sessions-only and ignores a Training section. A collection that
  cannot fit the relevant cap has no
  full-backup path until it is reduced; solves, settings and Training records are
  never silently omitted.
- **Replacement recovery uses separate local-storage keys, not a transaction.**
  Native import, additive csTimer import and Drive restore capture previous
  sessions/settings/sync/drive values in a local journal; a native import that
  contains Training also captures and stages that key. CubeLab records a commit
  marker before showing success. A prepared journal is rolled back at startup
  only while this tab owns the same origin-wide Web Lock used by the writer; a
  browser without Web Locks keeps the editable app closed rather than guessing
  that the other writer is dead. A committed journal only needs journal cleanup
  and can open normally. Rollback skips a key whose failed write already left the
  captured bytes in place, so a still-failing quota does not falsely report an
  incomplete rollback. Failed prepared rollback/cleanup, or a malformed or
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
- **Solve Drive snapshots never include Training.** The 10 MB solve Drive cap,
  solve wire format, solve filenames, solve merge rules and solve restore behavior
  are unchanged. Training has a separate file family and independent sync state;
  Training cleanup cannot select solve files and solve cleanup cannot select
  Training files. A compressed native backup is a local file, not a Drive
  snapshot. See the Training limitations for its merge, tombstone, conflict and
  retention boundaries.
- Invalid rows, durations, or provided dates in csTimer sessions that contain
  solves reject the file before preview. Valid session metadata that omits
  `opt.scrType` uses csTimer’s `333` default; explicitly supplied unsupported
  identifiers import into MISC, and missing or malformed metadata is imported as
  unavailable rather than converted to 3×3. Empty sessions are
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
- **MISC has no scramble generator or 3D/2D visualization.** It shows a neutral
  placeholder when no scramble is stored. Imported csTimer solves and migrated
  custom-event solves keep their original scramble text. Solve duration is never
  used to infer an event.

## Tools and appearance

- **Confirm Time targets only the latest solve.** Older solves are edited through
  the solve history action menu. CubeLab does not store phase splits or
  reconstructions, so those csTimer fields are not available. Changes use the
  normal solve persistence and deletion/Undo paths.
- **Online Battle is serverless and manual.** Peers exchange one invitation code
  and one answer code, then connect over WebRTC with a public STUN server used
  only for NAT discovery. Room ID/password are shared secrets checked by both
  peers, not authenticated encryption. Strict NATs, firewalls or blocked STUN may
  prevent a connection; there is no TURN relay, matchmaking, ranked result,
  backend persistence or reconnect protocol. Codes should be shared only with the
  opponent.
- **Custom colors are user-supplied.** The color pickers accept six-digit hex
  values; CubeLab does not audit contrast for arbitrary custom combinations.
  Hold-to-preview shows the timer states, but low-contrast color choices remain
  the user's responsibility.
- **Metronome timing is browser-scheduled.** It uses Web Audio oscillators with a
  browser interval and is intended for practice feel, not laboratory timing.

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
  Checked-in offline coverage is scoped to the supported Chromium project; the
  final audit also passed the manually unskipped offline case in WebKit. Non-cube
  player checks establish puzzle IDs/initialization, not every rendered pixel.
  README describes existing engine-specific skips.
- **Arch browser coverage is focused, not a full official matrix.** Playwright
  reports Arch as unsupported and uses Ubuntu 24.04 fallback builds. The
  2026-11-21 final audit ran the full WebKit suite in an isolated Ubuntu 24.04
  userland (`bwrap`) with the official Playwright dependency set: 258 passed, 8
  pre-existing layout/accessibility failures reproduced on base `3dd5aea`, one
  load-sensitive Training sync case that passed alone and at two workers, and 5
  deliberate skips.
  Chromium passed 272/272. Firefox passed 252 with the same 15 pre-existing
  layout/touch failures reproduced on the base commit. No host-validation bypass
  or production code workaround is used. `npm run test:e2e` and `npm run check`
  select all three projects by default; use focused `--project=...` commands.
  This is not official Playwright support for Arch or a full three-engine
  physical-device matrix.
- **Build advisory needs rechecking before action.** The October 30 record found
  `GHSA-gcqx-w48m-w2h4` through `vite-plugin-pwa → workbox-build →
  @rollup/plugin-node-resolve → deepmerge@4.3.1`. It concerned build tooling;
  the proposed forced downgrade broke the offline pipeline. This is a dated
  dependency observation, not a current upstream-status claim. Recheck before
  selecting a compatible fix; do not force-install a breaking downgrade.
- **Development dependency advisories remain.** The 2026-11-18 `npm ci` audit
  reported four development-only moderate advisories and zero production
  advisories. The existing lockfile was used and no dependency version changed
  in the environment audit. Recheck the advisories before choosing a compatible
  update.
