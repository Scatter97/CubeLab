---
name: cubelab-chart-performance
description: Profile or optimize CubeLab Time Trend, rolling statistics, PB details, large solve histories, or delayed insight rendering. Use for chart/statistics regressions and timer responsiveness affected by analytics; skip generic React or visual styling work.
---

# CubeLab chart performance

Read the presentation/durability and statistics rules in `AGENTS.md`, then the measured limits in `STATUS.md`. All paths and commands use the repository root.

## Follow the existing data path

- `src/App.tsx` sends current solves to the final timer readout and sync, while `src/hooks/usePostPaintValue.ts` schedules expensive insight presentation after a rendering opportunity. Its session-ID guard prevents another session's delayed solves from appearing. `src/hooks/useRunningElapsed.ts` animates the readout locally. Inspect this boundary before moving any work.
- `src/lib/stats.ts` provides recorded effective times, latest/best statistics, and the shared count/sum Fenwick rolling kernel. `src/lib/averageTrimming.ts` owns trim counts; `src/lib/statDefinitions.ts` owns valid sizes. `src/lib/timeTrend.ts` reverses a copy of newest-first solves for chronological points, computes rolling series, marks strict lifetime PBs and builds historical PB windows ending at the selected solve.
- `src/lib/timeTrend.ts` keeps `trendAxis` as the full-range scale used by Analytics. Time Trend's Auto Y scale calls `trendOutlierLimit` with the Settings cutoff preset (`gentle`/`balanced`/`strong`) to cap extreme slow singles without clipping enabled rolling averages. Auto omits clipped points without a separate marker, and Full range must always restore them. Both scale modes must leave stored solves, statistics and PB identity unchanged. `latestPersonalBest` identifies the current PB (latest chronological PB, not necessarily the newest solve).
- `src/components/TimeTrend.tsx` is compact-only: fixed time/ao5/ao12/PB series, a top legend, a bordered plot card, PB-only pointer hover/click, a compact PB card positioned beside its marker, and five viewport buttons. Generic solve details use keyboard inspection. There is no expanded dialog, PB modal, wheel/pinch listener, pointer-capture pan or `touch-action: none`. `trendPath` in `src/lib/timeTrend.ts` reduces dense paths using ordered extrema, retaining endpoints, spikes and DNF gaps. Sampling must not change source solves, statistics, PB identity or card data. `trendAxis` starts just below the lowest result rather than forcing a zero baseline; Analytics still consumes the same nonnegative full-range contract.
- The chart is keyboard-focusable (Left/Right, Home/End, Escape) and must not capture Space. PB markers are not separate tab stops. Only the current PB renders a static outer ring; there is no PB pulse. Pointer clicks target PB markers only, and chart clicks must not focus into a visible outline. Settings (`timeTrendScale`, `timeTrendCutoff`) arrive through App → ToolPanel → TimeTrend.
- `src/components/ToolPanel.tsx` hosts the compact chart. `src/components/SolveHistory.tsx` uses measured row windowing from `src/lib/historyWindow.ts`; chart sampling and history windowing are separate mechanisms.

## Measure, then change

1. Reproduce with synthetic 7,000- and 10,000-solve histories. Compare chart closed/open, enabled/custom large averages, sync off/on, keyboard/pointer, development/production. Use isolated mock Drive for enabled-sync measurements. Separate input capture, first stopped-result render, chart completion, serialization/write cost and long tasks. Record samples and median/range; do not infer enabled-sync results from sync-off measurements.
2. Identify the expensive function from the profile. Reuse the rolling kernel instead of sorting every window. Compute requested sizes only. If adding caching/incremental results, prove invalidation after append, penalty/time edits, deletion/undo, import/restore, session switch and either trimming-side change. Array length alone cannot identify unchanged data.
3. Compare optimized windows with the direct `calculateAverage` path, as in `src/lib/stats.test.ts`. Include duplicates, zeroes, +2, DNFs, asymmetric/percentage/median trimming and the ten-minute precision boundary. Keep missing windows distinct from DNF results; do not recalculate PB details using future solves or the visible zoom range.
4. Exercise the compact chart at the 220 px default, 150×170 minimum and 320 px viewport. Cover PB-only hover, current-PB static ring, pointer cursor/focus behavior, touch pin, keyboard inspection, the five button bounds, absence of wheel/drag viewport changes, timer lock and Settings scale/cutoff persistence. Read the known narrow-layout limitation in `KNOWN_LIMITATIONS.md`; existing tests are not proof that overlap is fixed.

## Verify the affected behavior

```bash
npm test -- src/lib/stats.test.ts src/lib/statDefinitions.test.ts src/lib/averageTrimming.test.ts src/lib/format.test.ts src/lib/timeTrend.test.ts src/components/TimeTrend.test.tsx src/components/SettingsDialog.test.tsx src/lib/storage.test.ts src/lib/settingsMerge.test.ts src/hooks/useSettings.test.ts src/lib/historyWindow.test.ts src/hooks/usePostPaintValue.test.ts src/lib/analytics.test.ts src/lib/analyticsSettings.test.ts src/components/AnalyticsPage.test.tsx
npm run test:e2e -- e2e/time-trend.spec.ts e2e/average-trimming.spec.ts e2e/analytics.spec.ts e2e/timer-response.spec.ts e2e/tools.spec.ts --project=chromium --workers=4
```

For history changes also run the large-history scenarios in `e2e/timer.spec.ts`.
Use one browser and `--workers=4` for normal targeted runs; reserve the full
browser matrix for a significant release or explicit request. Follow
production/mock-preview handling in `STATUS.md` and finish behavior changes with
the tiered `AGENTS.md` checks. If optimization touches persistence, sync
refs/fingerprints or scheduling, use `cubelab-sync-safety` and its in-flight tests
too. Do not omit required import/restore/Drive cases or rerun passing tests
without a relevant change. Report speed evidence separately from correctness,
and list tests run or intentionally skipped.
