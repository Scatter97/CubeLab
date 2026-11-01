---
name: cubelab-chart-performance
description: Profile or optimize CubeLab Time Trend, rolling statistics, PB details, large solve histories, or delayed insight rendering. Use for chart/statistics regressions and timer responsiveness affected by analytics; skip generic React or visual styling work.
---

# CubeLab chart performance

Read the presentation/durability and statistics rules in `AGENTS.md`, then the measured limits in `NEXT_SESSION_HANDOFF.md`. All paths and commands use the repository root.

## Follow the existing data path

- `src/App.tsx` sends current solves to the final timer readout and sync, while `src/hooks/usePostPaintValue.ts` schedules expensive insight presentation after a rendering opportunity. Its session-ID guard prevents another session's delayed solves from appearing. `src/hooks/useRunningElapsed.ts` animates the readout locally. Inspect this boundary before moving any work.
- `src/lib/stats.ts` provides recorded effective times, latest/best statistics, and the shared count/sum Fenwick rolling kernel. `src/lib/averageTrimming.ts` owns trim counts; `src/lib/statDefinitions.ts` owns valid sizes. `src/lib/timeTrend.ts` reverses a copy of newest-first solves for chronological points, computes rolling series, marks strict lifetime PBs and builds historical PB windows ending at the selected solve.
- `src/components/TimeTrend.tsx` renders SVG paths and independent viewport axes. `trendPath` in `src/lib/timeTrend.ts` reduces dense paths using ordered extrema, retaining endpoints, spikes and DNF gaps. Sampling must not change source solves, statistics, PB identity or tooltip data.
- `src/components/ToolPanel.tsx` hosts the compact chart; `src/components/PBStatsDialog.tsx` displays historical results. `src/components/SolveHistory.tsx` uses measured row windowing from `src/lib/historyWindow.ts`; chart sampling and history windowing are separate mechanisms.

## Measure, then change

1. Reproduce with synthetic 7,000- and 10,000-solve histories. Compare chart closed/open, enabled/custom large averages, sync off/on, keyboard/pointer, development/production. Use isolated mock Drive for enabled-sync measurements. Separate input capture, first stopped-result render, chart completion, serialization/write cost and long tasks. Record samples and median/range; do not infer enabled-sync results from sync-off measurements.
2. Identify the expensive function from the profile. Reuse the rolling kernel instead of sorting every window. Compute requested sizes only. If adding caching/incremental results, prove invalidation after append, penalty/time edits, deletion/undo, import/restore, session switch and either trimming-side change. Array length alone cannot identify unchanged data.
3. Compare optimized windows with the direct `calculateAverage` path, as in `src/lib/stats.test.ts`. Include duplicates, zeroes, +2, DNFs, asymmetric/percentage/median trimming and the ten-minute precision boundary. Keep missing windows distinct from DNF results; do not recalculate PB details using future solves or the visible zoom range.
4. Exercise compact/expanded charts, 320px layout, resize, independent wheel axes, pinch, pan/reset, PB activation/focus, date axis and timing-disabled gestures. Read the known narrow-layout limitation in `PATCH_LIMITATIONS.md`; existing tests are not proof that overlap is fixed.

## Verify the affected behavior

```bash
npm test -- src/lib/stats.test.ts src/lib/statDefinitions.test.ts src/lib/averageTrimming.test.ts src/lib/format.test.ts src/lib/timeTrend.test.ts src/components/TimeTrend.test.tsx src/lib/historyWindow.test.ts src/hooks/usePostPaintValue.test.ts
npm run test:e2e -- e2e/time-trend.spec.ts e2e/average-trimming.spec.ts e2e/timer-response.spec.ts
```

For history changes also run the large-history scenarios in `e2e/timer.spec.ts`. Follow production/mock-preview handling in `NEXT_SESSION_HANDOFF.md` and finish behavior changes with `AGENTS.md` checks. If optimization touches persistence, sync refs/fingerprints or scheduling, use `cubelab-sync-safety` and its in-flight tests too. Report speed evidence separately from correctness; do not delay saves to improve the chart benchmark.
