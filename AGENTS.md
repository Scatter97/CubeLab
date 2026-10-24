# AGENTS.md

Instructions for any future coding agent, contributor, or reviewer working in
this repository.

## Read first

Before changing code, read:

1. `PROJECT_PROGRESS.md` — current milestone status, verification evidence, and
   handoff notes.
2. `README.md` — product behavior, controls, statistics rules, and architecture.
3. The relevant source and tests for the area you are changing.

Update both documents when behavior, commands, architecture, or milestone status
changes. Never report a milestone complete without recording fresh verification
evidence in `PROJECT_PROGRESS.md`.

## Scope

This repository contains **CubeLab Milestone 1** plus the authorized **Phase 2A**
local-data work:

- 3×3 speedcubing timer
- WCA random-state scrambles via `cubing.js`
- optional 15-second inspection with count-down/count-up display, independent
  8-second/12-second warnings, and `+2` / DNF
- single, mo3, ao5, ao12, ao25, ao100, ao200, ao500, ao1000, ao5000, and
  ao10000 statistics plus up to five custom averages
- local solve history with persisted comments and a floating action menu
- multiple named local sessions with create/switch/rename/delete and per-session
  inspection, clear, and delete settings
- typed destructive confirmations for clearing or deleting a session
- JSON export/import of all sessions, comments, and settings
- automatic migration from the original single-session storage key
- a Settings dialog centralizing inspection direction and warnings, alerts,
  accent color, statistics display and custom averages, scramble presentation,
  controls reference, local data, and backup/restore access
- offline-capable PWA
- responsive, accessible UI

Phase 2A, the Phase 2A.1 Settings design update, Phase 2A.2 settings groups, and
Phase 2A.3 timer/history/session refinements are complete. Do **not** begin
Phase 2B (Google Drive backup), Phase 2C (multi-device sync), or any other
cloud/account feature without an explicit user instruction. Do not broaden to
other puzzle events or social features as drive-by additions.

## Commands

```bash
npm run dev         # Vite development server
npm run typecheck   # strict TypeScript
npm run lint        # Oxlint
npm test            # Vitest; currently runs all unit/component tests
npm run build       # production build + PWA
npm run test:e2e    # Playwright against the production preview
npm run check       # typecheck + lint + unit + build + production e2e
```

`npm run test:e2e` builds the app and starts `vite preview` on
`http://127.0.0.1:4173` unless an existing server is reused. The suite requires
the production build because it tests the service worker and offline reload.

## Engineering invariants

- **Timer logic stays pure.** Timing transitions and inspection penalties live in
  `src/timer/machine.ts` as timestamped events. Do not move timing calculations
  into presentation components.
- **One solve, one record.** `useTimer` keeps an authoritative state ref so
  repeated or same-frame events cannot record twice. Preserve this guarantee.
- **Monotonic time only.** Use `performance.now()` for elapsed time. Never derive
  solve duration from wall-clock `Date` values.
- **Space belongs to the timer.** Global Space must remain reserved for
  arm/start/stop and suppressed from page scrolling. It may be left to
  text-entry fields only. Focused buttons, switches, and the session select must
  remain usable with Enter and arrow keys. Do not let a focused session select
  swallow Space.
- **Settings are centralized.** The header Settings button opens the Settings
  dialog. Inspection direction and warnings, alerts, accent color, statistics
  display and custom averages, scramble presentation, the controls reference,
  local-data status, and backup/restore access live there. Per-session
  inspection overrides, clear, and delete live in the session-settings gear, not
  in the header or History panel. Settings opens only while the timer is idle and
  blocks timing while open. Do not reintroduce a header inspection toggle or an
  inline History clear/delete control.
- **Settings persistence is versioned.** `v1`–`v5` settings records migrate to
  `v6` with documented defaults and field-level corruption recovery.
  `parseSettingsData` accepts only valid fields, rejects records without
  `inspectionEnabled`, and upgrades older backups during import. Alerts,
  appearance, and statistics preferences must not alter raw times or WCA
  calculations. Enabled inspection warnings always show their visual text;
  sound and haptic follow the configured feedback channel. Settings may also
  enable `stopWithAnyKey` for stopping a running timer with any non-modifier key.
- **Do not hand-roll scrambles.** Use `cubing.js` `randomScrambleForEvent('333')`.
  Unit tests verify real random-state generation.
- **Statistics follow WCA semantics.** Averages are newest-first; every trimmed
  average removes one best and one worst; one DNF is trimmed as worst; two or
  more DNFs make the average a DNF. mo3 contains no trimmed result and any DNF
  makes it a DNF. Effective `+2` adds 2 seconds. Built-in sizes and custom
  averages share the same calculation and validation rules. Update
  `src/lib/stats.test.ts` and `src/lib/statDefinitions.test.ts` for any change.
- **Sessions are local and explicit.** Session names are trimmed, limited to 40
  characters, and unique case-insensitively. At least one session must always
  exist. Session controls, the session gear, and Settings are disabled while the
  timer is armed, running, or in inspection. Clearing requires typing
  `CLEAR THIS SESSION`; deleting requires `DELETE THIS SESSION`. A per-session
  inspection override takes precedence over the global setting; sessions without
  one follow the global value.
- **Solve history actions.** Each row has inline `+2` and `DNF` controls and opens
  a floating menu for delete/undo, copy actions, and comments. Do not reintroduce
  inline delete or a History clear action. Comments are plain text, limited to
  500 characters, persist on the solve, and never affect timing or statistics.
  Space remains timer input even while a row or menu action is focused; only
  text-entry fields may consume it.
- **Inspection warnings** follow the displayed direction. Count-up labels use 8
  and 12 seconds elapsed; count-down labels use 12 and 8 seconds remaining.
- **Persistence is versioned.** Keys are `cubelab:sessions:v1` (active session
  plus all named sessions, optional inspection overrides, solves, and comments)
  and `cubelab:settings:v1`. Sessions use schema `v2`; settings use schema `v6`.
  The original `cubelab:solves:v1` key is read only for migration into
  **Session 1**. Validate and recover from corrupt records; never silently
  discard a valid session. Any schema change needs a migration and tests.
- **Backups replace only after confirmation.** Export every session, solve, and
  setting as a versioned JSON file. Import must validate the app marker, format
  version, sessions, solves, and settings, then show current/incoming counts and
  require explicit confirmation. Invalid files must not mutate local data.
  Backup/import stays entirely local; do not add upload or Drive code without an
  explicit Phase 2B instruction. Keep the 10 MB import cap unless large-backup
  behavior is deliberately designed and tested.
- **Raw data is immutable by default.** Store raw milliseconds plus a penalty
  value. Do not overwrite raw time when applying `+2`.
- **Keep the production worker isolation.** `vite.config.ts` isolates cubing
  modules into a dedicated chunk and disables module preloading. Removing either
  setting can make the cubing search worker import the React browser entry and
  fail with `document is not defined`. The offline Playwright test guards this.
- **PWA changes need offline verification.** Re-run the offline E2E test after
  changing build, asset, or service-worker configuration.
- **No backend or telemetry.** All user data stays in local storage.

## Testing expectations

For a behavior change:

- Add or update focused unit tests for pure logic. Session/name/comment/
  inspection mutations belong in `src/lib/sessions.test.ts`; storage, settings
  migration, and validation in `src/lib/storage.test.ts`; backup validation in
  `src/lib/backup.test.ts`; statistic definitions and custom-average validation
  in `src/lib/statDefinitions.test.ts`; WCA statistics in
  `src/lib/stats.test.ts`; statistic display precision in
  `src/lib/format.test.ts`.
- Add or update a Playwright test for user-visible flows, including settings
  open/close and focus restoration, inspection direction/warnings and
  persistence, per-session inspection overrides, session
  create/switch/rename/delete, typed clear/delete confirmations, timer locking,
  solve-menu penalties/comments/copy/undo, export, invalid import, import
  cancellation, confirmed replacement, alert feedback and volume persistence,
  accent persistence, expanded/custom statistic visibility and precision, and the
  Controls reference.
- Test failure paths, not only the happy path.
- Keep tests deterministic. Avoid asserting exact wall-clock durations from live
  timing; use ranges or state-machine timestamps.
- Do not delete or weaken a failing test to make a run pass. Fix the behavior or
  correct an honestly wrong expectation.

Before claiming a milestone is complete, run all of:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Also inspect the interface at desktop and mobile widths. Update the screenshots
in `docs/` if the visible design changes materially.

## Documentation and Git

- Keep `README.md` user-facing and accurate.
- Keep `PROJECT_PROGRESS.md` factual: milestone percentage, scope, verification
  evidence, known limitations, and next steps.
- Use a focused commit message that describes the milestone or change.
- Do not commit `dist/`, `node_modules/`, Playwright output, or local secrets.
- Check `git status` before and after committing and report the real state.

When handing off, state exactly what passed, what was not tested, and what the
next milestone requires.
