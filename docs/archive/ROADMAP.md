> **Historical snapshot — archived 2026-11-01.** This record may contain
> superseded behavior, approval milestones and verification results. For current
> work read [STATUS.md](../../STATUS.md), [AGENTS.md](../../AGENTS.md) and
> [KNOWN_LIMITATIONS.md](../../KNOWN_LIMITATIONS.md). Paths in code spans
> and command blocks retain their original repository-root context.

# CubeLab Roadmap

**Status:** Current checkpoint reconciled 2026-11-01; implementation verified
2026-11-01. Phases 2A–5, Phase 6a and Stage 6 polish delivered, with approved import/tools,
Time Trend/PB, trimming and timer-response follow-ups. Broader phases remain
proposals unless explicitly approved.
This roadmap is the forward-looking companion to `PROJECT_PROGRESS.md`. It
describes the intended sequence, scope, and acceptance gates for future work.
`PROJECT_PROGRESS.md` remains the source of truth for completed work and current
verification evidence.

## Current baseline

- The core product is complete: 3×3 timer, WCA random-state scrambles, inspection,
  statistics, local history, PWA, and responsive/accessibility work.
- Phase 2A is complete: named local sessions, validated JSON backup/restore,
  migration, and local persistence.
- Phase 2A.1 is complete: centralized Settings dialog, modal focus handling, and
  inspection/backup entry points.
- Phase 2A.2 is complete: settings schema v4, custom Space hold time, timer
  update modes, interface zoom, small decimals, scramble presentation, alerts
  with adjustable volume, accent colors, statistics display controls, the
  Controls reference, and dedicated production E2E coverage are in place.
- Phase 2A.3 is complete: settings schema v5, sessions schema v2, count-down/
  count-up inspection with independent warnings, expanded built-in and custom
  statistics, per-session settings, typed destructive confirmations, persisted
  solve comments, and the floating solve action menu are in place.
- Phase 2B (Google Drive backup) is complete: manual backup/restore, typed
  restore confirmation, remote deletion, mock E2E coverage, and final
  verification are in place.
- Phase 2C (multi-device sync) is complete with documented concurrency
  limitations: local-first optional Google Drive synchronization with time,
  solve-count, and combined schedules; startup/exit/reconnect sync; ID-based
  merging; tombstones; empty-default adoption; session redirects; conflict
  review; status UI; and mock-based coverage.
- Phase 3 (More WCA events) is complete: 3×3, 2×2, 4×4, 3×3 OH, 5×5, 6×6, and
  7×7 session events with official `cubing.js` event scrambles, event-compatible
  storage/sync/backup validation, per-event desktop and mobile production E2E
  coverage, and documented shared WCA inspection and penalty rules.
- Phase 6a (remaining easy WCA puzzles) is complete: Pyraminx, Skewb,
  Square-1, Clock, and Megaminx use their official `cubing.js` scramble IDs,
  the shared event registry, event-compatible storage/backup/import/sync
  validation, per-event desktop/mobile E2E, correct 3D puzzles, and an honest
  2D-unavailable state for non-cube puzzles.
- Phase 4 (Performance, accessibility, and platform) is complete: history
  windowing, Chromium/Firefox/WebKit coverage, the accessibility/keyboard audit,
  and PWA/bundle review are verified. Physical iOS/Android review remains
  unavailable in this environment.
- Stage 6 polish is complete: an audited light/dark/system theme, tokenized
  palettes for both backgrounds across all four accents, WCAG AA contrast tests,
  a dark-theme axe scan, settings schema v7, and a pre-paint theme bootstrap.
- Device-owned Drive snapshots (`cubelab-backup-<device-id>-<uuid>.json`) and all-snapshot
  merging remove cross-device file-overwrite races. Sessions schema v4 stores
  field-level metadata for names, events, inspection, and preferences; global
  settings metadata lives in the sync runtime. Field conflicts are reviewable for
  solve fields, session metadata, session preferences, global settings, and
  redirects. Sync deferral while timing, bounded retries, and pending-change
  status are implemented.
- The 2026-10-25 hardening patch fixed legacy 3×3-only migration, empty-default
  adoption, solve-owner/event compatibility, directional sync counts,
  duplicate-name validation, in-flight local-edit protection, and two React lint
  warnings. The audit follow-ups added manual solve-field conflict resolution,
  deletion/offline-edit recovery, honest solve-count semantics, deterministic
  redirect tests, repeated recovered-session extension, stale-approval protection,
  known-solve snapshots on new session tombstones, per-device snapshots, full
  field-level conflict review, and multi-device convergence stress tests. The
  2026-10-27 remediation replaced mutable per-device files with unique immutable
  snapshots, removed the conflict-queue correctness cap (rendering stays
  paginated), and surfaced remote-snapshot disagreements for review. Google Drive
  has no cross-file snapshot transaction; only the legacy mutable file has the
  recorded ETag/If-Match conditional-write path. See `PATCH_LIMITATIONS.md` for
  what remains open. The November 1 follow-up fixes active-session approvals,
  selection provenance and csTimer validation with focused regressions.

## Current delivery and recommended next steps

Delivered follow-ups include csTimer import, the persisted 2D/PG3D panel,
Time Trend with independent trackpad axes/pinch/pan and historical PB dialogs,
settings-v8 trimming shared everywhere, and prioritized timer-stop feedback.
Latest checks: **553 tests / 39 files; 258 browser passes / 9 existing skips**,
with typecheck, lint, build and supported offline checks passing November 1
with Phase 6a. Normal production output was restored after mock-Drive tests.

1. **Narrow layout:** repair the 320-pixel compact-panel overlap; preserve digit
   visibility, controls, pointer isolation and persisted gestures. Inspect
   desktop, mobile/landscape and both timing states, then refresh screenshots.
2. **Targeted profiling:** test Zen and production at 7,000 and 10,000 solves,
   sync enabled/disabled, both inputs and expanded/custom chart combinations.
   Record dispatch, captured time, first rendering, chart completion and saving.
3. **Measured optimization:** evaluate enabled-sync fingerprint scheduling and
   incremental chart/statistics updates. Preserve exact approvals, current refs,
   timer guards, redundant-upload detection and complete cache invalidation.
4. **Persistence design:** assess incremental durable storage only with a
   migration/recovery/failure/cross-tab plan; no debounce of the latest solve.
5. **External gates:** arrange owner-dependent OAuth, authorized live-provider
   tests, physical device/trackpad and assistive-technology validation; recheck
   the dated dependency advisory before any compatible toolchain update.

These are next-step proposals, not a claim they are implemented. Detailed entry
steps and acceptance checks live in [NEXT_SESSION_HANDOFF.md](NEXT_SESSION_HANDOFF.md).
Only the follow-ups in the current root roadmap remain planned. The October 31
sync-off 7,000-solve performance evidence
must not be relabeled as a 10,000-solve or enabled-sync stop benchmark.

## Product principles

1. **Timer correctness first.** Timing transitions stay in the pure timer
   machine. Use monotonic time only; never derive solve duration from wall-clock
   timestamps.
2. **WCA semantics are fixed.** Statistics, inspection penalties, and effective
   times must not change to accommodate a display preference.
3. **Local-first by default.** No backend, account, telemetry, or remote storage
   is added implicitly.
4. **Every phase has a gate.** A phase is complete only when its tests,
   documentation, screenshots, and verification evidence are updated.
5. **No drive-by scope.** Cloud sync, new puzzle events, and social features each
   require an explicit brief and approval.

## Phase 2A.2 — Finish settings — Complete

**Goal:** Finish the csTimer-inspired settings surface without weakening timer or
statistics correctness.

**Delivered groups:**

1. **Alerts**
   - Optional inspection warning at 8/12 seconds.
   - Optional solve-complete and DNF feedback.
   - Visual, sound, haptic, and sound+haptic preferences.
   - Adjustable 50–150% alert volume with a louder 70% default.
   - Visual feedback respects reduced-motion through the global motion query.
2. **Appearance**
   - Green, blue, violet, and amber accent choices with WCAG AA contrast checks.
   - Accent-tinted timer surface and ready/holding states.
3. **Statistics**
   - Show/hide individual statistic cards.
   - Hundredths/tenths display precision that does not alter stored raw times or
     WCA calculations.
4. **Controls**
   - Expanded keyboard reference in Settings.
   - Focus and Space-reservation behavior covered by production E2E tests.

**Acceptance gate — met:**

- [x] New preferences have typed defaults and validation.
- [x] Settings schema v4 includes documented v1–v3 migration and unit tests.
- [x] Every new control has focused Playwright coverage, including persistence
      and failure paths.
- [x] `npm run check` passes.
- [x] `README.md`, `PROJECT_PROGRESS.md`, and the Settings screenshot are refreshed.

## Phase 2A.3 — Timer, statistics, and history refinements — Complete

**Goal:** Refine the timer, session, statistics, and history surfaces without
changing WCA timing or calculation semantics.

**Delivered:**

1. **Inspection**
   - Count-down or count-up display.
   - Independent optional **8 seconds** and **12 seconds** visual warnings that
     follow the displayed direction.
   - A 50% louder DNF/danger tone at the same volume setting, capped safely.
2. **Statistics**
   - Built-in single, mo3, ao5, ao12, ao25, ao100, ao200, ao500, ao1000,
     ao5000, and ao10000.
   - Up to five custom trimmed averages from ao3 to ao10000, excluding built-in
     sizes.
   - A Fenwick-tree fast path for large averages.
3. **Sessions**
   - Session-settings gear replacing the inline delete button.
   - Per-session inspection override, clear session, and delete session.
   - Typed `CLEAR THIS SESSION` / `DELETE THIS SESSION` confirmation phrases.
4. **History**
   - Floating row menu for `+2`, DNF, delete/undo, copy scramble/time/text, and
     comments.
   - Persisted 500-character solve comments.
   - Inline penalty/delete buttons and the History clear action removed.
5. **Chrome and storage**
   - Green “Saved locally” header indicator removed.
   - Settings schema v5 and sessions schema v2 with migrations and validation.

**Acceptance gate — met:**

- [x] WCA penalties and statistics remain unchanged by display preferences.
- [x] Typed confirmations protect destructive session actions.
- [x] Comments and per-session inspection persist through reload and backup.
- [x] Settings/session migrations and custom-average validation have unit tests.
- [x] Production E2E covers the new flows and failure paths.
- [x] `npm run check` passes.
- [x] `README.md`, `PROJECT_PROGRESS.md`, `AGENTS.md`, and screenshots are updated.

## Phase 2B — Google Drive backup — Complete, superseded by Phase 2C

**Goal:** Add optional manual backup/restore to Google Drive without introducing
background sync or account requirements for existing users.

**Prerequisites:** Explicit approval of authentication, Drive file layout,
privacy language, and conflict behavior.

**Scope delivered in Phase 2B (historical):**

- Google OAuth with the narrowest usable scope.
- Drive `appDataFolder` storage or an equivalent private app folder.
- Versioned remote backup envelope derived from the existing local backup.
- Manual **Backup now** and **Restore from Drive** actions.
- Explicit conflict preview before replacing local data.
- Clear offline, expired-token, revoked-permission, and quota failure states.
- No automatic upload, background sync, or telemetry.

**Superseded by Phase 2C:** The current Settings dialog exposes automatic
synchronization and **Sync now** rather than separate manual backup/restore
buttons. The legacy fixed-name remote file remains readable for compatibility.

**Acceptance gate:**

- Local-only behavior remains fully functional when Drive is unavailable.
- Invalid or incompatible remote files never mutate local data.
- OAuth, upload, download, cancellation, conflict, and failure paths have tests;
  Drive API calls are mocked in automated tests.
- Privacy and data-retention behavior is documented.
- Offline E2E remains green.

## Phase 2C — Multi-device sync — Complete with caveats

**Goal:** Synchronize sessions and solves across devices after the backup path is
proven.

**Delivered:**

- ID-based session and solve merging with tombstones and session redirects.
- Empty-default cloud adoption, duplicate-name detection, and manual session
  merges. Duplicate names are recomputed against the final merged collection,
  surfaced once per actionable toast with the full sync summary, and kept
  reviewable in the Drive dialog until merged.
- Device-owned Drive snapshots, all-snapshot merging, legacy fixed-name-file
  compatibility, per-device manual backup isolation, and delete-all with partial
  failure reporting. File discovery follows every pagination token and rejects
  incomplete or malformed listings rather than silently missing a device.
- Every write creates a new immutable snapshot with a unique name
  (`cubelab-backup-<device-id>-<uuid>.json`) instead of replacing a device's
  previous file. Writers sharing a device identity cannot overwrite each other's
  snapshot. Every snapshot returned by the complete listing is merged;
  Drive listings can lag, so convergence may require later runs. Snapshot growth is
  bounded by a configurable retention policy (10 per device and 30 days by
  default); automatic cleanup runs after a successful merge and publication,
  keeps the newest snapshot of every device, and never removes the just-published
  snapshot or the legacy mutable file.
- Same-origin automatic/manual writes share a Web Lock. Per-device transports do
  not re-list or recheck because their snapshots are immutable; the optimistic
  changed-file recheck remains only for the legacy fixed-name transport, which is
  additionally replaced through a Drive v2 ETag/`If-Match` conditional update.
  The lock is best effort, and there is still no transaction across the snapshot
  set.
- Sessions schema v4 field metadata plus global settings metadata in the sync
  runtime. Session names, events, inspection overrides, individual preferences,
  and global settings merge independently by timestamp with deterministic
  tiebreaks and no fabricated history for equal legacy values.
- Conflict review for solve fields, session metadata, preferences, global
  settings, and redirects. Pending conflicts pause publication and offer **Use
  this device** / **Use cloud** before synchronization resumes. An approval
  applies only to the exact reviewed values and timestamps; a later edit raises a
  new conflict. The correctness queue is not capped at 100 records; it is
  deduplicated by field key and rendered 5 at a time with **Show all**.
- Disagreements between two remote snapshots are surfaced for review even when the
  local value already matches the automatic winner. These `remoteOnly` conflicts
  use **Use newest cloud** / **Use other cloud**, and redirect approvals match by
  unordered destination pair.
- Solves belonging to a deleted session are moved into a deterministic
  `(recovered)` session rather than disappearing. Existing recovered sessions are
  extended by solve ID when later offline devices reconnect.
- New session tombstones record the deleting device's known solve IDs, so unknown
  offline solves can be recovered even when clocks disagree; legacy tombstones use
  the timestamp fallback.
- Time-based, solve-count-based, and combined schedules plus startup, exit, and
  reconnect triggers. Sync is deferred while the timer is active and resumes once
  on idle; automatic retries are bounded.
- Sync settings/status UI and deterministic mock-transport unit, stress, and E2E
  tests.
- 2026-10-25 hardening for legacy migration, adoption, event-compatible ownership,
  directional counts, duplicate-name validation, in-flight local edits, honest
  solve-count semantics, deterministic redirect normalization, repeated
  recovered-session extension, stale-approval protection, and multi-device
  convergence.
- 2026-10-27 remediation for unique immutable snapshots, an uncapped conflict
  queue with paginated rendering, remote-snapshot disagreement review, and
  envelope-based own-snapshot identity.
- 2026-10-28 Stage 1 hardening: conditional Drive v2 ETag/`If-Match` updates for
  the legacy mutable fixed-name file, failing closed on HTTP 412 or a missing
  ETag; local-only resolution audit history with exact-match Undo; approval
  matching that survives local/remote orientation changes; mandatory
  `legacyRecovery` review for ambiguous old deletions; remote-only redirect
  disagreement review; deduplicated visibility/`pagehide`/`freeze` exit sync;
  and a non-destructive **Repair sync state** recovery action.
- 2026-10-28 Stage 2 snapshot lifecycle: per-device ownership metadata, a
  configurable count/age retention policy, automatic post-publication cleanup,
  and a **Remote snapshots** management section with ownership groups, file
  sizes and dates, selective deletion, pagination, refresh, and own-only manual
  cleanup. The newest snapshot per device and the legacy mutable file are always
  protected; partial delete failures are reported.
- 2026-10-28 Stage 3 real-provider validation: an opt-in harness exercised
  concurrent immutable publishes, all-snapshot convergence, same-device writers,
  a live Drive v2 ETag/`If-Match` conditional write, retention selection, and
  selective deletion against a real test account. The final run passed 7/7 with
  complete cleanup. OAuth used only `drive.appdata`; the app remains in Testing
  under another owner account, so non-test sign-in is still pending.

**Acceptance gate — partially met (OAuth publishing and a cross-file transaction
remain):**

- [x] Deterministic conflict tests cover add/add, edit/edit, delete/edit, and
      session-selection conflicts.
- [x] Sync failures leave local data intact and recoverable in the tested paths.
- [x] Solve, session-metadata, preference, global-settings, and redirect
      conflicts can be reviewed and resolved before publication.
- [x] Stale approvals cannot silently override edits made after review.
- [x] Offline solves belonging to a deleted session are preserved across
      successive devices without duplication.
- [x] New session tombstones recover unknown solves independently of clock skew.
- [x] Concurrent device uploads cannot overwrite another device's snapshot, and
      a three-device stress scenario converges after a follow-up sync. Every write
      is a uniquely named immutable snapshot, so even writers sharing one device
      identity cannot replace each other's file.
- [x] Covered field decisions are recorded in local review history and can be
      reversed while the exact approval remains current. Applied redirects and
      legacy recovery that already restored solves are not automatically reversible.
      Active-session choices are covered by the November 1 regression follow-up.
- [x] A documented, non-destructive recovery action re-reads every cloud snapshot
      while preserving sessions, tombstones, approvals, pending conflicts, and
      review history.
- [x] The legacy mutable fixed-name file is replaced only through a verified
      Drive v2 ETag/`If-Match` conditional update; stale or unverifiable writes
      fail closed.
- [x] Snapshot growth is bounded by a documented count/age policy. Cleanup keeps
      the newest snapshot of every device, protects the just-published snapshot
      and legacy file, and reports partial failures.
- [x] The Drive dialog shows per-device snapshot ownership and supports selective
      deletion plus own-only manual cleanup.
- [x] Real-provider multi-device concurrency, the live ETag/`If-Match` path, and
      retention/cleanup were validated end to end on 2026-10-28 against a Google
      Drive test account. The run used two independent transports in one process,
      not two physical devices.
- [ ] OAuth publishing/non-test access: the October 28 record reported Testing
      under another owner account. Current console state and non-test sign-in
      have not been freshly verified; the owner must confirm publishing and any
      Google verification requirements.
- [ ] Provider-level compare-and-swap or a transaction across immutable snapshots
      exists.

**Remaining work:** OAuth publishing and non-test sign-in validation (owner
action), plus a conditional-write/transaction strategy beyond the legacy mutable
file. The legacy file is now protected by a provider-enforced `If-Match` update,
but immutable snapshots are create-only and there is no transaction across the
snapshot set. Conflict review now has local audit/undo, but applied redirect
merges are not automatically reversible and redirect handling remains
deterministic rather than consensus-based. Exit sync is hardened but still best
effort. Snapshot retention was validated against real Drive on 2026-10-28, but
cleanup remains a best-effort sequence of deletes rather than a transaction.
Active-session metadata and reviewed choices now merge with deterministic provenance
and exact approval matching, including reversed inputs and subsequent syncs. The Web Lock serializes
same-origin writes but is not a remote transaction. Until those are addressed, do
not describe synchronization as data-loss-proof.

## Phase 3 — More WCA events — Complete

**Goal:** Extend CubeLab beyond 3×3 without duplicating timer or statistics logic.

**Approval status:** Approved 2026-10-28 (Stage 4) and delivered the same day.

**Delivered:**

- Session events for 3×3, 2×2, 4×4, 3×3 OH, 5×5, 6×6, and 7×7, with the
  `cubing.js` event IDs `333`, `222`, `444`, `333oh`, `555`, `666`, and `777`.
- Event metadata in sessions and solves, event-aware scramble prefetch with
  loading, failure, and retry states, and per-event statistics and history.
- Event validation in local storage, backup import, and synchronization, so
  unknown events and mixed-event sessions are rejected rather than silently
  rewritten. Existing 3×3 sessions and legacy single-session data keep loading.
- Random-state scrambles for every event, including big-cube depth notation such
  as `3Rw2`; no scramble algorithm is hand-rolled.
- Per-event production Playwright coverage at desktop and mobile widths:
  switch/create the event session, generate scrambles, record solves, apply
  `+2` and DNF, verify statistics, and confirm persistence across reload.
- Multi-event backup export/import coverage and a WCA rule audit. The
  15-second inspection, `+2` at 15–17 seconds, DNF past 17 seconds, and
  effective-time calculation are shared by all seven events. CubeLab does not
  implement competition-specific time limits or cutoffs, and the timer machine
  remains event-independent.

**Acceptance gate — met:**

- [x] Existing 3×3 data migrates without loss, including the legacy
      single-session key.
- [x] Statistics tests cover each event’s shared WCA rules and verify that event
      does not change effective times, mo3, or DNF handling.
- [x] Scrambles are generated by `cubing.js`; no hand-rolled scramble generator.
- [x] Timer behavior remains event-independent; documented WCA rules are shared.
- [x] Desktop and mobile E2E cover switching events and recording solves for
      3×3, 2×2, 4×4, 3×3 OH, 5×5, 6×6, and 7×7.
- [x] Multi-event storage, mixed-event rejection, and backup/import round trips
      are covered.
- [x] `npm run check` passes and the active documentation is updated.

## Phase 4 — Performance, accessibility, and platform

**Approval status:** Approved 2026-10-28 (Stage 5).

**Goal:** Make large histories and non-Chromium environments first-class.
**Scope:**

- Virtualize or window the solve history for very large sessions.
- Profile penalty toggles, deletion, import, and session switching.
- Add WebKit and Firefox browser coverage where the environment supports it.
- Complete a formal screen-reader and keyboard audit.
- Test a physical iOS/Android device.
- Review PWA update behavior and bundle splitting for the `cubing.js` chunk.
- Keep offline reload and worker isolation regression tests mandatory.

**Acceptance gate — met:**

- [x] Seeded 2,000+ solve sessions remain responsive (history windowing).
- [x] No horizontal overflow at supported widths.
- [x] Keyboard/focus and screen-reader-oriented DOM semantics have automated
      coverage; physical screen-reader/assistive-device validation remains open.
- [x] Cross-browser limitations are recorded honestly (Firefox and WebKit skip
      offline and touch hold-to-time tests).

## Stage 6 — Polish — Complete 2026-10-29

**Goal:** Close the remaining low-priority polish items without changing timer,
statistics, or synchronization semantics.

**Delivered:**

- **Audited theme.** Light, dark, and system preferences in **Settings →
  Appearance**, with a light default for existing users. Dark palettes cover
  every surface token and all four accents; no colors are hard-coded outside the
  token blocks in `src/index.css`.
- **Contrast coverage.** `src/lib/theme.test.ts` parses the CSS tokens and
  verifies 36 text/surface and accent pairs at WCAG AA in both themes and all
  four accents. The production accessibility suite also runs axe against the dark
  main view and Settings dialog.
- **Pre-paint application.** A small `index.html` bootstrap applies the stored
  preference before the app bundle loads, and `useTheme` tracks
  `prefers-color-scheme` changes while `system` is selected. The browser
  `theme-color` meta and PWA manifest use the light defaults.
- **Versioned persistence.** Settings schema `v7` adds `theme`; `v1`–`v6`
  records migrate with `light` as the default, and the field participates in
  Drive field-level merging.
- **Inspection reset verification.** **Use global default** in the
  per-session settings gear clears the override and follows the global
  inspection preference, as documented.

**Acceptance gate — met:**

- [x] The predefined palette text/surface and accent pairs pass WCAG AA
      contrast tests; rendered-page coverage is limited to the tested views.
- [x] Light, dark, and system modes apply, persist, and update when the OS
      preference changes.
- [x] Dark-theme axe scans pass in Chromium, Firefox, and WebKit.
- [x] `npm run check` passes and the active documentation and screenshots are
      updated.
- [x] The 10 MB import cap is unchanged; no larger-cap design was approved.


## Phase 5 — Audit remediation (timer-safe synchronization and correctness)

**Status:** Audit remediation implemented and closed 2026-10-30; regression
coverage included in the October 31 full check. Delivered timer-safe in-flight
sync, idle reconciliation, exact approvals, restore normalization, recorded
precision, active-session field metadata, cleanup retries and the two-page test.
The findings below describe the original audit and its remediation scope, not
an open defect list. The dependency issue was explicitly deferred with a dated
reason; external/provider limits remain in `PATCH_LIMITATIONS.md`.

**November 1 follow-up:** the re-audit's active-session approval/equal-time
provenance and csTimer validation gaps are fixed with pure, hook and production
browser regressions. See `PATCH_LIMITATIONS.md` for the dated repair record and
remaining provider/performance limitations.

**Goal:** Close the timer-safe synchronization gaps and correctness defects
identified by the audit so cloud sync, cross-tab reconciliation, conflict
approvals, restore normalization, and WCA statistical precision are safe during
timing and exact to the documented contract.

**Baseline (audit, 2026-10-29):** TypeScript, Oxlint, 360 unit tests across 24
files, production build, and 149/153 Playwright tests passed; 4 low-severity
dependency advisories; Node 24.22.1 required by locked jsdom/Vitest deps. All
110 archived source files were byte-identical after inspection. No fixes were
applied by the audit.

### P1 — state replacement during timing

1. **In-flight sync can upload and replace state after timing begins.**
   - References: `src/hooks/useSync.ts` (timer check before first network
     operation; guards compare only session/settings fingerprints).
   - Problem: arming, inspecting, or running changes the timer without changing
     the fingerprint, so a download started while idle can finish after a solve
     starts, issue an upload, and call both replacement callbacks while the
     timer is active. Waiting on the shared write lock reintroduces the race.
   - Impact: remote state may switch the active session/event or inspection
     configuration mid-solve; `App.tsx` records against the current
     session/event and scramble reference, so completion can attach to the
     wrong context; inspection may be cancelled by a changed setting.
   - Fix direction: recheck timer activity immediately before initiating
     writes and before applying state, including the redundant-upload branch;
     defer application until idle and rerun the merge against current local
     state; revalidate enabled/connection state after asynchronous boundaries;
     test timing transitions during list, download, lock wait, and upload
     completion.

2. **Cross-tab storage changes bypass the timer lock entirely.**
   - References: `src/hooks/useSync.ts` storage listener; `src/App.tsx`.
   - Problem: the storage listener immediately loads and replaces the entire
     session collection with no timer-active check, is installed even when
     automatic sync is disabled, and runs in the leader tab despite its
     "Followers" comment. A second tab selecting a different session writes
     the shared active-session ID and changes the first tab's active session
     during a solve.
   - Impact: ordinary local multi-tab use can violate the session controls'
     lock and redirect a solve into a different session/event, independent of
     Google Drive connectivity.
   - Fix direction: defer external collection reconciliation until idle; retain
     the timing session/event/scramble as explicit solve-start context;
     reconcile any locally completed solve with the external collection rather
     than replacing either blindly; consider making active-session selection
     tab-local; add a real two-page browser test.

### P2 — correctness and performance

3. **Settings changes from another tab are silently overwritten.**
   - References: `src/hooks/useSettings.ts`; `src/hooks/useSync.ts`.
   - Problem: settings load once on mount and every later edit saves the whole
     in-memory settings object; the cross-tab listener handles sessions and sync
     metadata but never `cubelab:settings:v1`.
   - Impact: a tab receiving a settings storage event and then changing an
     unrelated preference resets the other tab's work; potential disagreement
     between current values and field timestamps mirrored through sync storage.
   - Fix direction: reconcile external settings values and their metadata
     together; distinguish imported changes from local edits to avoid inventing
     new timestamps; preserve independent field edits; defer timer-affecting
     changes until idle.

4. **Full-history hashing and deletion scans run on every timer frame.**
   - References: `src/App.tsx`; `src/hooks/useTimer.ts`; `src/hooks/useSync.ts`;
     `src/lib/syncFingerprint.ts`.
   - Problem: `useTimer` updates React state each animation frame; each `App`
     render constructs a fresh `{ activeSessionId, sessions }` wrapper for
     `useSync`, invalidating its fingerprint memo and session-change effect even
     though the collection did not change. The fingerprint recursively
     copies/sorts and serializes the entire history; the deletion effect walks all
     solve IDs. Fingerprinting runs even with sync disabled. Measured ~18.9 ms
     per fingerprint on a synthetic 10,000-solve history (function benchmark, not
     a browser frame measurement).
   - Impact: large histories can cause timer display/input latency despite
     history virtualization.
   - Fix direction: memoize the session-data wrapper by actual collection/
     selection changes; stabilize sync callbacks; isolate high-frequency timer
     presentation updates; add a production timing profile with 10,000 solves
     with sync disabled/enabled.

5. **Conflict approvals do not require the reviewed field timestamps.**
   - References: `src/lib/solveMerge.ts`; `src/lib/sessionMetadata.ts`;
     `src/lib/settingsMerge.ts`.
   - Problem: approval matching checks the pair of values and requires only that
     current timestamps be `<=` the resolution timestamp; it does not compare
     them with the stored `localUpdatedAt`/`remoteUpdatedAt` from review.
   - Impact: an approval can override a changed field version without renewed
     review when a field changes away and back while approval is pending.
   - Fix direction: match reviewed value/timestamp pairs in either orientation,
     with a narrow exception for the already-applied winning version stamped at
     the approval time; avoid accepting every timestamp before approval; add
     tests for changes between review and approval, including a value changed
     away and back.

6. **Restoring exactly one remote snapshot skips tombstones and redirects.**
   - References: `src/lib/remoteBackups.ts`; `src/hooks/useDriveBackup.ts`;
     `src/App.tsx`.
   - Problem: the restore helper initializes from the first snapshot's sessions
     and only invokes `mergeSessionsData` for subsequent snapshots; with one
     snapshot, collected tombstones and redirects are never applied.
   - Impact: restore can resurrect data that its envelope deletes, or leave
     redirected sessions separate; the restore path then returns a new backup
     without that envelope, and confirmation resets sync bookkeeping.
   - Fix direction: normalize even the first/single snapshot through the same
     merge/recovery pipeline; test singleton solve and session tombstones,
     redirect application, and recovery.

7. **Averages use hidden milliseconds rather than recorded centiseconds.**
   - References: `src/hooks/useSessions.ts`; `src/lib/stats.ts`; `src/lib/format.ts`.
   - Problem: recorded raw times retain whole milliseconds; singles display by
     truncating to centiseconds, while averages sum hidden milliseconds and round
     only at the end. Comment claiming times are stored to the hundredth and the
     README centisecond calculation claim are inaccurate. WCA regulation 9f1
     requires individual timed results under ten minutes to be truncated to
     hundredths and averages/means to be rounded to hundredths.
   - Impact: five `10009 ms` solves each display `10.00` but their ao5 is
     `10.01`; recorded centisecond results should average to `10.00`.
   - Fix direction: preserve raw timing precision if desired, but derive recorded
     result precision before statistical aggregation and share that conversion
     across latest/best/fast-window calculations; add an explicit policy for
     results at or above ten minutes under regulation 9f2; add
     fractional-centisecond tests for mean, trimmed average, and personal best.

### P3 — security, runtime, and build observations

8. **Dependency advisory (low).** `npm audit` reports four low-severity entries in
   one chain: `vite-plugin-pwa → workbox-build → @rollup/plugin-node-resolve →
   deepmerge` (GHSA-gcqx-w48m-w2h4, prototype poisoning in `deepmerge`). These
   are build-tool dependencies; no exploitable route from a CubeLab backup was
   established. Do not blindly apply the audit's proposed downgrade to
   `vite-plugin-pwa@0.2.1`; evaluate a compatible upstream fix or override and
   revalidate PWA behavior.

9. **Runtime requirement undocumented.** README says Node 20+, but locked Vitest
   and jsdom dependencies require newer versions (jsdom tree includes
   `^22.22.2 || ^24.15.0 || >=26.0.0`); `package.json` has no `engines`
   declaration. Pin/document a supported runtime (Node 24.22.1 worked). The
   first installation under Node 18 omitted the native lint binding.

10. **Remote file resource limits.** Remote files are downloaded to text before
    checking length, and the remote limit uses JavaScript character length rather
    than encoded bytes (`src/lib/remoteBackups.ts`). Robustness opportunity for
    malformed/very large cloud files; no hostile input exploit demonstrated.

11. **Unresolved browser diagnostic.** Two `BROWSER_PAGEERROR: Unexpected token
    '<'` messages appeared in the otherwise-passing browser log; the listener
    does not fail on them (`e2e/timer.spec.ts`). Strengthen error assertions
    before claiming a clean browser console.

12. **Coverage gaps.** No two-page browser test; singleton restore normalization
    untested; exact reviewed timestamp changes untested; fractional-centisecond
    averages untested; sustained timing with large persisted histories untested.
    Real Google Drive validation was not run (no token); mock flows validate
    application behavior, not live OAuth consent, provider permissions, or
    real-account concurrency. Firefox and WebKit skip touch hold-to-time and
    offline service-worker tests.

### Recommended order (from audit)

1. Fix both state-replacement paths during timing and pin the solve-start
   context (findings 1, 2).
2. Reconcile cross-tab settings and stabilize the data passed into sync
   (findings 3, 4).
3. Tighten approval matching and normalize singleton restores (findings 5, 6).
4. Correct statistical precision, then address runtime documentation and the
   build dependency advisory (finding 7, observations 8, 9).

### Architecture note

`src/hooks/useSync.ts` combines scheduling, leader election, storage mirroring,
network orchestration, conflict decisions, audit history, and publication in
over 1,600 lines; `DriveBackupDialog.tsx` is another large orchestration
surface. Extracting an explicit sync-operation lifecycle would make cancellation
and timer guards easier to enforce and test. This is a refactor recommendation,
not a separate defect.

### Acceptance gate — remediation delivered; ongoing limits recorded

- [x] No sync upload or state replacement occurs while the timer is armed,
      running, or inspecting, including across list/download/lock-wait/upload
      completion and storage events; deferred work resumes once when idle.
- [x] Cross-tab reconciliation defers during timing and preserves in-flight
      solves; active-session selection is reconciled without redirecting a solve.
- [x] Cross-tab settings edits are merged by field with metadata preserved.
- [x] History-dependent sync calculations are not repeated on running animation
      frames. Disabled sync skips the unused UI fingerprint. Deletion tracking
      remains active for future synchronization correctness. The later stop
      patch measured 7,000 solves with sync off; enabled-sync/10,000-solve stop
      profiling remains in the current next-step plan.
- [x] Covered solve/session-field/settings/redirect approvals match reviewed
      values and timestamps, including active-session selection. The paths retain
      the documented narrow exception for an already-applied
      winning version stamped at approval time; a value changed away and back
      raises a new conflict.
- [x] Single-snapshot restore applies tombstones and redirects.
- [x] Statistics use recorded (truncated/rounded) individual results for
      aggregation; fractional-centisecond and personal-best tests pass; policy
      for results at or above ten minutes is documented and tested.
- [x] Two-page browser test covers cross-tab timing and reconciliation.
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and
      `npm run test:e2e` pass; documentation and screenshots refreshed if
      visible design changes.



## Phase 6a — delivered WCA events

Delivered 2026-11-01: Pyraminx, Skewb, Square-1, Clock and Megaminx, extending
the existing seven events through the shared registry and official cubing.js
scramble pipeline. Timer, inspection, penalty and statistics rules remain shared.

**Acceptance gate met:** `src/lib/events.ts` registry, `PuzzleEvent`,
storage/backup/csTimer-import/sync validation, desktop and 390 px per-event
browser tests, correct 3D puzzle IDs and an honest non-cube 2D fallback.

Further feature-phase proposals were removed at the user's request. Existing
Time Trend, historical PB details, trimming and additive csTimer import remain
delivered functionality, documented in the current README and status.

## Cross-cutting backlog

- Keep `PROJECT_PROGRESS.md` factual and update it with fresh evidence after every
  phase.
- Refresh screenshots when the visible design changes materially.
- Add tests for failure paths, not only happy paths.
- Maintain the 10 MB import cap unless a larger-backup design is explicitly
  approved and tested.
- Preserve the production worker isolation in `vite.config.ts`.
- Do not add analytics, telemetry, or remote storage without explicit approval.

## Delivery checklist for every phase

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

A phase is not complete until all commands pass, documentation is current, and
the working tree is clean.
