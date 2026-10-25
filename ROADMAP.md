# CubeLab Roadmap

**Status:** Active planning document · **Last updated:** 2026-10-25 · **Current release line:** Phase 2B manual Google Drive backup complete; Phase 2C local-first sync complete with device-owned snapshots, field-level merging, and documented provider-CAS limitations
This roadmap is the forward-looking companion to `PROJECT_PROGRESS.md`. It
describes the intended sequence, scope, and acceptance gates for future work.
`PROJECT_PROGRESS.md` remains the source of truth for completed work and current
verification evidence.

## Current baseline

- Milestone 1 is complete: 3×3 timer, WCA random-state scrambles, inspection,
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
- Device-owned Drive snapshots (`cubelab-backup-<deviceId>.json`) and all-snapshot
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
  field-level conflict review, and multi-device convergence stress tests. Google
  Drive still lacks a verified atomic compare-and-swap for one device file. See
  `PATCH_LIMITATIONS.md` for what remains open.

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
  merges.
- Device-owned Drive snapshots, all-snapshot merging, legacy fixed-name-file
  compatibility, per-device manual backup isolation, and delete-all with partial
  failure reporting.
- Sessions schema v4 field metadata plus global settings metadata in the sync
  runtime. Session names, events, inspection overrides, individual preferences,
  and global settings merge independently by timestamp with deterministic
  tiebreaks and no fabricated history for equal legacy values.
- Conflict review for solve fields, session metadata, preferences, global
  settings, and redirects. Pending conflicts pause publication and offer **Use
  this device** / **Use cloud** before synchronization resumes. An approval
  applies only to the exact reviewed values and timestamps; a later edit raises a
  new conflict.
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

**Acceptance gate — partially met:**

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
      a three-device stress scenario converges after a follow-up sync.
- [ ] The user can understand and reverse the result of every merge.
- [ ] A documented recovery path exists for corrupted or partially applied syncs.
- [ ] Remote writes have verified atomic compare-and-swap protection.

**Remaining work:** A verified CAS/ETag update path for the device snapshot, a
stale-writer test against the real provider, conflict-resolution audit/undo, a
documented recovery path for corrupted or partially applied syncs, guaranteed
sync-on-exit, explicit recovery for ambiguous legacy-tombstone edits, redirect
consensus/recovery, and selective/device-visible remote snapshot management.
Until those are addressed, do not describe synchronization as data-loss-proof.

## Phase 3 — More WCA events

**Goal:** Extend CubeLab beyond 3×3 without duplicating timer or statistics logic.

**Current partial state:** Session setup already offers 3×3, 2×2, 4×4, and 3×3 OH
with `cubing.js` scrambles and event-compatible sync merging. This is not a
completed Phase 3: dedicated per-event E2E coverage, event-specific WCA timing
rules, and broader event validation are still required before the phase can be
declared complete.

**Suggested sequence:**

1. Event-selection architecture and per-event session/statistics storage.
2. 2×2.
3. 4×4.
4. One-handed 3×3.
5. Further events only after the event architecture is stable.

**Scope:**

- Event-aware scramble generation through `cubing.js`.
- Per-event statistics, histories, and session filtering.
- Event-specific inspection and timing behavior where WCA rules differ.
- Storage migration that preserves existing 3×3 sessions and solves.

**Acceptance gate:**

- Existing 3×3 data migrates without loss.
- Statistics tests cover each event’s WCA rules.
- Scrambles are generated by `cubing.js`; no hand-rolled scramble generator.
- Timer behavior remains event-independent unless a documented WCA rule requires
  otherwise.
- Desktop and mobile E2E cover switching events and recording solves.

## Phase 4 — Performance, accessibility, and platform

**Goal:** Make large histories and non-Chromium environments first-class.

**Scope:**

- Virtualize or window the solve history for very large sessions.
- Profile penalty toggles, deletion, import, and session switching.
- Add WebKit and Firefox browser coverage where the environment supports it.
- Complete a formal screen-reader and keyboard audit.
- Test a physical iOS/Android device.
- Review PWA update behavior and bundle splitting for the `cubing.js` chunk.
- Keep offline reload and worker isolation regression tests mandatory.

**Acceptance gate:**

- Seeded 2,000+ solve sessions remain responsive.
- No horizontal overflow at supported widths.
- Keyboard-only and screen-reader flows are documented and tested.
- Cross-browser limitations are recorded honestly if an engine is unavailable.

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
