# CubeLab Roadmap

**Status:** Active planning document  
**Last updated:** 2026-10-23  
**Current release line:** Phase 2A.3 complete; Phase 2B next, not started

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
- Phase 2B (Google Drive backup) and Phase 2C (multi-device sync) are not
  started. Neither may begin without an explicit user instruction.

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
   - Adjustable 0–100% alert volume with a louder 70% default.
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

## Phase 2B — Google Drive backup

**Goal:** Add optional manual backup/restore to Google Drive without introducing
background sync or account requirements for existing users.

**Prerequisites:** Explicit approval of authentication, Drive file layout,
privacy language, and conflict behavior.

**Scope:**

- Google OAuth with the narrowest usable scope.
- Drive `appDataFolder` storage or an equivalent private app folder.
- Versioned remote backup envelope derived from the existing local backup.
- Manual **Backup now** and **Restore from Drive** actions.
- Explicit conflict preview before replacing local data.
- Clear offline, expired-token, revoked-permission, and quota failure states.
- No automatic upload, background sync, or telemetry.

**Acceptance gate:**

- Local-only behavior remains fully functional when Drive is unavailable.
- Invalid or incompatible remote files never mutate local data.
- OAuth, upload, download, cancellation, conflict, and failure paths have tests;
  Drive API calls are mocked in automated tests.
- Privacy and data-retention behavior is documented.
- Offline E2E remains green.

## Phase 2C — Multi-device sync

**Goal:** Synchronize sessions and solves across devices after the backup path is
proven.

**Prerequisites:** Phase 2B complete and an explicit sync design approval.

**Scope:**

- Define the sync record model, including session/solve identity and deletions.
- Conflict detection and a user-visible resolution policy.
- Merge behavior that preserves valid sessions and never silently drops solves.
- Explicit handling of offline edits, concurrent updates, and active-session
  selection.
- No social, sharing, or public-profile features.

**Acceptance gate:**

- Deterministic conflict tests cover add/add, edit/edit, delete/edit, and
  session-selection conflicts.
- Sync failures leave local data intact and recoverable.
- The user can understand and reverse the result of a merge.
- A documented recovery path exists for corrupted or partially applied syncs.

## Phase 3 — More WCA events

**Goal:** Extend CubeLab beyond 3×3 without duplicating timer or statistics logic.

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
