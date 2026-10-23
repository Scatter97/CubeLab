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

This repository currently contains **CubeLab Milestone 1**:

- 3×3 speedcubing timer
- WCA random-state scrambles via `cubing.js`
- optional 15-second inspection with `+2` / DNF
- single, mo3, ao5, and ao12 statistics
- local solve history and settings
- offline-capable PWA
- responsive, accessible UI

Do **not** begin Milestone 2 features without an explicit user instruction. Do
not broaden to other puzzle events, accounts, cloud sync, multiple named
sessions, exports, or social features as drive-by additions.

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
  text-entry fields only. Focused buttons and switches must remain usable with
  Enter.
- **Do not hand-roll scrambles.** Use `cubing.js` `randomScrambleForEvent('333')`.
  Unit tests verify real random-state generation.
- **Statistics follow WCA semantics.** Averages are newest-first; ao5/ao12 remove
  one best and one worst; one DNF is trimmed as worst; two or more DNFs make the
  average a DNF. mo3 contains no trimmed result and any DNF makes it a DNF.
  Effective `+2` adds 2 seconds. Update `src/lib/stats.test.ts` for any change.
- **Persistence is versioned.** Keys are `cubelab:solves:v1` and
  `cubelab:settings:v1`. Validate and recover from corrupt records; never silently
  discard a valid session. Any schema change needs a migration and tests.
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

- Add or update focused unit tests for pure logic.
- Add or update a Playwright test for user-visible flows.
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
