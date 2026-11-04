---
name: cubelab-timer-testing
description: Test CubeLab timing transitions, inspection penalties/warnings, Space or pointer controls, any-key stop, modal/tool input isolation, exact-once recording, and stop-response regressions. Use when changing timer behavior or code on its input-to-save path.
---

# CubeLab timer testing

Read timer/input invariants in `AGENTS.md`. Paths and commands are relative to the repository root. Use isolated browser contexts with synthetic histories.

## Choose the lowest useful layer

1. **Transition/penalty:** `src/timer/machine.ts` and `src/timer/machine.test.ts`. Send explicit timestamped press/tick/release/cancel events. Cover the configured hold threshold just below/at readiness, early release, input-source mismatch, repeats, start on release and stop on press. Inspection boundaries are precise: 15,000 ms is penalty-free; 15,001 through 17,000 ms is +2; 17,001 ms is DNF. Penalty depends on solve start, not stop time.
2. **Hook/animation:** `src/hooks/useTimer.ts` and `src/hooks/useTimer.test.ts` inject `now` and control animation frames. Preserve the authoritative ref and assert one completion across same-frame inputs. `src/components/TimerStage.test.tsx` checks local readout animation and capture before focus; `src/hooks/usePostPaintValue.test.ts` checks superseded presentation updates. Display frames must not become the recorded clock.
3. **Application input:** `src/App.tsx` owns global keyboard rules and completion/session wiring; `src/components/TimerStage.tsx` owns pointer capture; `src/lib/alerts.ts` owns warning events. Read `src/lib/alerts.test.ts` and production scenarios in `e2e/timer.spec.ts`. Wait for the real scramble queue to be ready, then assert `data-phase` on `timer-surface` rather than guessing an elapsed delay.
4. **Input boundaries:** Cover focused buttons/session select versus text fields, key repeat, any-key stopping, Escape/blur behavior, modal locks, and pointer release/cancel. `e2e/draw-scramble.spec.ts` covers tool interception, drag and resize; `e2e/time-trend.spec.ts` covers chart/modal keyboard containment. `e2e/cross-tab-timing.spec.ts` verifies another tab cannot redirect an in-flight solve.
5. **Durability/stop response:** `e2e/timer-response.spec.ts` seeds 7,000 solves and checks keyboard and pointer stops, the exact displayed saved result, repeat suppression, unchanged older solves, reload, and session switching. Extend this pattern for regressions; do not replace correctness checks with a host-specific latency threshold. Use the profiling matrix in `STATUS.md` for measured performance work.

## Run focused checks

Use Node 22+ and existing dependencies:

```bash
npm test -- src/timer/machine.test.ts src/hooks/useTimer.test.ts src/components/TimerStage.test.tsx src/hooks/usePostPaintValue.test.ts src/lib/alerts.test.ts
npm run test:e2e -- e2e/timer.spec.ts e2e/timer-response.spec.ts e2e/cross-tab-timing.spec.ts --project=chromium --workers=1
```

Add the tool/chart suites when that boundary changes. Targeted Playwright runs
should normally use one browser and `--workers=1`; reserve the full matrix for a
significant release or explicit request. Playwright uses `playwright.config.ts`
with Chromium, Firefox and WebKit against production preview. Its server command
builds with mock Drive; a reused preview skips that command, so ensure the reused
output was built with `VITE_DRIVE_MOCK=true`. Restore normal output with
`npm run build` afterward. Keep documented browser skips visible in the result.

Finish behavior changes with the tiered checks in `AGENTS.md`. Do not omit the
timer, durability, import or sync cases that cover a destructive path. Report
state/recording correctness separately from measured stop latency, chart
completion and physical-device validation, and state which tests were run or
intentionally skipped.
