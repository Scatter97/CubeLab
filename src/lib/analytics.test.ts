import { describe, expect, it, vi } from 'vitest'
import {
  ACTIVITY_CALENDAR_WINDOW_DAYS,
  addLocalDays,
  analyticsDateBounds,
  buildActivity,
  buildActivityCalendar,
  buildAnalyticsTrend,
  buildHistogram,
  buildPBHistory,
  clampActivityCalendarStart,
  compareSessions,
  computeAdvanced,
  computeAnalyticsOverview,
  computeConsistency,
  computeSubX,
  createAnalyticsFilters,
  filterAnalyticsSolves,
  formatAnalyticsAxisDate,
  analyticsSpansMultipleYears,
  standardDeviation,
  type AnalyticsDatePreset,
  type AnalyticsFilters,
} from './analytics'
import { DEFAULT_AVERAGE_TRIMMING } from './averageTrimming'
import { calculateAverage } from './stats'
import type { Penalty, PuzzleEvent, Session, Solve } from '../types'

const NOW = new Date(2026, 10, 3, 12, 0, 0).getTime()
const DAY = 86_400_000

function makeSolve(
  id: string,
  rawMs: number,
  createdAt: number,
  options: {
    event?: PuzzleEvent
    penalty?: Penalty
    comment?: string
  } = {},
): Solve {
  return {
    id,
    event: options.event ?? '333',
    rawMs,
    penalty: options.penalty ?? 'none',
    scramble: `Scramble ${id}`,
    comment: options.comment ?? '',
    createdAt,
  }
}

function makeSession(
  id: string,
  name: string,
  solves: Solve[],
  event: PuzzleEvent = '333',
): Session {
  return {
    id,
    name,
    event,
    createdAt: solves[0]?.createdAt ?? NOW,
    updatedAt: solves[solves.length - 1]?.createdAt ?? NOW,
    solves,
  }
}

function trendFor(times: number[], sizes: number[] = [5]) {
  const session = makeSession(
    's1',
    'Main',
    times.map((time, index) =>
      makeSolve(`s${index}`, time, NOW - (times.length - index) * 1_000),
    ),
  )
  return buildAnalyticsTrend(
    filterAnalyticsSolves([session], createAnalyticsFilters('333'), NOW),
    sizes,
    DEFAULT_AVERAGE_TRIMMING,
  )
}

describe('analytics filtering', () => {
  const sessions = [
    makeSession('a', 'Three', [
      makeSolve('a1', 10_000, NOW),
      makeSolve('a2', 11_000, NOW - 8 * DAY),
      makeSolve('a3', 12_000, NOW - 2 * DAY, { penalty: '+2' }),
      makeSolve('a4', 13_000, NOW - 1 * DAY, { penalty: 'dnf' }),
    ]),
    makeSession(
      'b',
      'Two',
      [makeSolve('b1', 4_000, NOW, { event: '222' })],
      '222',
    ),
  ]

  it('filters by event, session, date, penalty and latest count', () => {
    const byEvent = filterAnalyticsSolves(
      sessions,
      createAnalyticsFilters('333'),
      NOW,
    )
    expect(byEvent.map((solve) => solve.id)).toEqual(['a2', 'a3', 'a4', 'a1'])

    const allEvents = filterAnalyticsSolves(
      sessions,
      { ...createAnalyticsFilters('all') },
      NOW,
    )
    expect(allEvents).toHaveLength(5)

    const oneSession = filterAnalyticsSolves(
      sessions,
      { ...createAnalyticsFilters('all'), sessionIds: ['b'] },
      NOW,
    )
    expect(oneSession.map((solve) => solve.id)).toEqual(['b1'])

    const recent = filterAnalyticsSolves(
      sessions,
      { ...createAnalyticsFilters('333'), datePreset: '7d' },
      NOW,
    )
    expect(recent.map((solve) => solve.id)).toEqual(['a3', 'a4', 'a1'])

    const penalties = filterAnalyticsSolves(
      sessions,
      { ...createAnalyticsFilters('333'), penalty: '+2' },
      NOW,
    )
    expect(penalties.map((solve) => solve.id)).toEqual(['a3'])

    const latestTwo = filterAnalyticsSolves(
      sessions,
      { ...createAnalyticsFilters('333'), solveLimit: 2 },
      NOW,
    )
    expect(latestTwo.map((solve) => solve.id)).toEqual(['a4', 'a1'])
  })

  it('restores within-session chronology for tied imported timestamps', () => {
    const chronological = [
      makeSolve('oldest', 10_000, NOW),
      makeSolve('middle', 20_000, NOW),
      makeSolve('newest', 30_000, NOW),
    ]
    const stored = makeSession('tied', 'Tied', [...chronological].reverse())

    const filtered = filterAnalyticsSolves(
      [stored],
      createAnalyticsFilters('333'),
      NOW,
    )
    expect(filtered.map((solve) => solve.id)).toEqual([
      'oldest',
      'middle',
      'newest',
    ])

    const latestTwo = filterAnalyticsSolves(
      [stored],
      { ...createAnalyticsFilters('333'), solveLimit: 2 },
      NOW,
    )
    expect(latestTwo.map((solve) => solve.id)).toEqual(['middle', 'newest'])
  })

  it('handles custom dates, empty session selections and invalid ranges safely', () => {
    const custom: AnalyticsFilters = {
      ...createAnalyticsFilters('333'),
      datePreset: 'custom',
      customStart: '2026-10-26',
      customEnd: '2026-10-27',
    }
    expect(
      filterAnalyticsSolves(sessions, custom, NOW).map((solve) => solve.id),
    ).toEqual(['a2'])

    expect(
      filterAnalyticsSolves(
        sessions,
        { ...createAnalyticsFilters('333'), sessionIds: [] },
        NOW,
      ),
    ).toEqual([])

    expect(
      filterAnalyticsSolves(
        sessions,
        {
          ...createAnalyticsFilters('333'),
          datePreset: 'custom',
          customStart: 'not-a-date',
          customEnd: '',
        },
        NOW,
      ),
    ).toHaveLength(4)
  })
})

describe('calendar date bounds', () => {
  function withTimeZone(zone: string, run: () => void) {
    vi.stubEnv('TZ', zone)
    try {
      run()
    } finally {
      vi.unstubAllEnvs()
    }
  }

  it('uses inclusive local calendar days across daylight-saving changes', () => {
    withTimeZone('America/Toronto', () => {
      const springNow = new Date(2026, 2, 10, 12).getTime()
      const springCases: [AnalyticsDatePreset, Date][] = [
        ['7d', new Date(2026, 2, 4)],
        ['30d', new Date(2026, 1, 9)],
        ['90d', new Date(2025, 11, 11)],
        ['year', new Date(2025, 2, 11)],
      ]
      for (const [datePreset, expected] of springCases) {
        expect(
          analyticsDateBounds(
            { ...createAnalyticsFilters('333'), datePreset },
            springNow,
          ).start,
        ).toBe(expected.getTime())
      }

      const fallNow = new Date(2026, 10, 3, 12).getTime()
      expect(
        analyticsDateBounds(
          { ...createAnalyticsFilters('333'), datePreset: '7d' },
          fallNow,
        ).start,
      ).toBe(new Date(2026, 9, 28).getTime())
    })
  })

  it('keeps the same local-calendar semantics in UTC and a non-DST zone', () => {
    for (const zone of ['UTC', 'Asia/Kolkata']) {
      withTimeZone(zone, () => {
        const now = new Date(2026, 2, 10, 12).getTime()
        expect(
          analyticsDateBounds(
            { ...createAnalyticsFilters('333'), datePreset: '7d' },
            now,
          ).start,
        ).toBe(new Date(2026, 2, 4).getTime())
      })
    }
  })
})

describe('overview and rolling averages', () => {
  it('uses effective +2 times, excludes DNFs from valid statistics, and keeps DNFs in the count', () => {
    const session = makeSession('s', 'Main', [
      makeSolve('1', 10_000, NOW - 5_000),
      makeSolve('2', 11_000, NOW - 4_000, { penalty: '+2' }),
      makeSolve('3', 12_000, NOW - 3_000),
      makeSolve('4', 13_000, NOW - 2_000),
      makeSolve('5', 14_000, NOW - 1_000, { penalty: 'dnf' }),
    ])
    const solves = filterAnalyticsSolves(
      [session],
      createAnalyticsFilters('333'),
      NOW,
    )
    const trend = buildAnalyticsTrend(
      solves,
      [5],
      DEFAULT_AVERAGE_TRIMMING,
    )
    const overview = computeAnalyticsOverview(
      trend,
      [5],
      DEFAULT_AVERAGE_TRIMMING,
    )

    expect(overview.count).toBe(5)
    expect(overview.validCount).toBe(4)
    expect(overview.dnfCount).toBe(1)
    expect(overview.dnfPercent).toBe(20)
    expect(overview.best).toBe(10_000)
    expect(overview.worst).toBe(13_000)
    expect(overview.meanMs).toBe(12_000)
    expect(overview.medianMs).toBe(12_500)
    expect(overview.totalTimeMs).toBe(48_000)
    expect(overview.activeDays).toBe(1)
    expect(overview.solvesPerDay).toBe(5)
    expect(overview.averages[0]?.best).toBe(12_670)
    expect(overview.averages[0]?.current).toEqual({
      status: 'value',
      ms: 12_670,
    })
    expect(trend.personalBests).toEqual([true, false, false, false, false])
    expect(trend.averages.get(5)).toEqual([null, null, null, null, 12_670])
  })

  it('keeps the historical best average when later windows slow down', () => {
    const trend = trendFor([
      ...Array<number>(5).fill(10_000),
      ...Array<number>(5).fill(20_000),
    ])
    const overview = computeAnalyticsOverview(
      trend,
      [5],
      DEFAULT_AVERAGE_TRIMMING,
    )

    expect(overview.averages[0]?.current).toEqual({
      status: 'value',
      ms: 20_000,
    })
    expect(overview.averages[0]?.best).toBe(10_000)
    expect(trend.bestAverages.get(5)).toEqual([
      null,
      null,
      null,
      null,
      10_000,
      10_000,
      10_000,
      10_000,
      10_000,
      10_000,
    ])
  })

  it('does not borrow a faster future window into an earlier running best', () => {
    const trend = trendFor([
      ...Array<number>(5).fill(20_000),
      ...Array<number>(5).fill(10_000),
    ])

    const best = trend.bestAverages.get(5)
    expect(best?.[4]).toBe(20_000)
    expect(best?.at(-1)).toBe(10_000)
    expect(best?.[5]).toBe(20_000)
  })

  it('carries the earlier best through trailing DNF windows', () => {
    const session = makeSession('s', 'Main', [
      ...Array.from({ length: 5 }, (_, index) =>
        makeSolve(`fast-${index}`, 10_000, NOW - (9 - index) * 1_000),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        makeSolve(`dnf-${index}`, 20_000, NOW - (4 - index) * 1_000, {
          penalty: 'dnf',
        }),
      ),
    ])
    const trend = buildAnalyticsTrend(
      filterAnalyticsSolves([session], createAnalyticsFilters('333'), NOW),
      [5],
      DEFAULT_AVERAGE_TRIMMING,
    )
    const overview = computeAnalyticsOverview(
      trend,
      [5],
      DEFAULT_AVERAGE_TRIMMING,
    )

    expect(overview.averages[0]?.current).toEqual({ status: 'dnf' })
    expect(overview.averages[0]?.best).toBe(10_000)
  })

  it('matches a direct chronological best-average oracle with custom trimming', () => {
    const times = [12_000, 15_000, 11_000, 20_000, 14_000, 13_000, 18_000, 10_000, 16_000, 17_000]
    const trimming = { better: '1' as const, worse: '1' as const }
    const trend = trendFor(times, [3])
    let expectedBest: number | null = null
    for (let end = 3; end <= trend.solves.length; end += 1) {
      const window = calculateAverage(
        [...trend.solves.slice(0, end)].reverse(),
        3,
        trimming,
      )
      if (
        window?.status === 'value' &&
        (expectedBest === null || window.ms < expectedBest)
      ) {
        expectedBest = window.ms
      }
    }

    expect(
      computeAnalyticsOverview(trend, [3], trimming).averages[0]?.best,
    ).toBe(expectedBest)
  })

  it('returns safe empty values and supports small custom averages', () => {
    const trend = buildAnalyticsTrend([], [5], DEFAULT_AVERAGE_TRIMMING)
    const overview = computeAnalyticsOverview(
      trend,
      [5],
      DEFAULT_AVERAGE_TRIMMING,
    )
    expect(overview).toMatchObject({
      count: 0,
      validCount: 0,
      dnfCount: 0,
      best: null,
      worst: null,
      meanMs: null,
      medianMs: null,
      standardDeviationMs: null,
      totalTimeMs: 0,
      solvesPerDay: null,
      improvementPercent: null,
    })
    expect(overview.averages[0]?.current).toBeNull()
    expect(overview.averages[0]?.best).toBeNull()
  })

  it('computes sample standard deviation without spread arguments', () => {
    expect(standardDeviation([10, 12, 14])).toBeCloseTo(2)
    expect(standardDeviation([])).toBe(0)
  })
})

describe('personal best history', () => {
  it('records PB events, gains and gaps between improvements', () => {
    const session = makeSession('s', 'Main', [
      makeSolve('1', 12_000, NOW - 4 * DAY),
      makeSolve('2', 11_000, NOW - 3 * DAY),
      makeSolve('3', 11_500, NOW - 2 * DAY),
      makeSolve('4', 10_000, NOW - DAY),
    ])
    const trend = buildAnalyticsTrend(
      filterAnalyticsSolves([session], createAnalyticsFilters('333'), NOW),
      [3],
      DEFAULT_AVERAGE_TRIMMING,
    )
    const pb = buildPBHistory(trend)
    expect(pb.single.map((event) => event.ms)).toEqual([
      12_000, 11_000, 10_000,
    ])
    expect(pb.single[1]?.improvementMs).toBe(1_000)
    expect(pb.single[2]?.gapMs).toBe(2 * DAY)
    expect(pb.singleStep).toEqual([12_000, 11_000, 11_000, 10_000])
    expect(pb.averageSteps.get(3)?.at(-1)).toBe(11_000)
  })
})

describe('distribution', () => {
  it('builds percentages, markers and IQR outliers', () => {
    const histogram = buildHistogram([
      10_000,
      10_500,
      11_000,
      11_500,
      20_000,
      null,
    ])
    expect(histogram.validCount).toBe(5)
    expect(
      histogram.bins.reduce((sum, bin) => sum + bin.count, 0),
    ).toBe(5)
    expect(
      histogram.bins.reduce((sum, bin) => sum + bin.percent, 0),
    ).toBeCloseTo(100)
    expect(histogram.meanMs).toBeCloseTo(12_600)
    expect(histogram.medianMs).toBe(11_000)
    expect(histogram.outlierCount).toBe(1)
    expect(histogram.outlierHighMs).toBeLessThan(20_000)
    expect(buildHistogram([]).bins).toEqual([])
  })
})

describe('consistency', () => {
  it('separates spread from speed and computes rolling windows', () => {
    const report = computeConsistency(trendFor([10_000, 10_000, 10_000, 20_000]), [3])
    expect(report.standardDeviationMs).toBeCloseTo(5_000)
    expect(report.meanMs).toBe(12_500)
    expect(report.coefficientOfVariation).toBeCloseTo(0.4)
    expect(report.spreadMs).toBe(10_000)
    expect(report.rolling[0]?.values[2]).toBe(0)
    expect(report.rolling[0]?.values[3]).toBeCloseTo(5_773.502691896256)
    expect(report.rolling[0]?.bestMs).toBe(0)
  })
})

describe('sub-X analysis', () => {
  it('counts successes, streaks, progress and per-session rates', () => {
    const session = makeSession('s', 'Main', [
      makeSolve('1', 11_000, NOW - 5_000),
      makeSolve('2', 13_000, NOW - 4_000),
      makeSolve('3', 11_500, NOW - 3_000),
      makeSolve('4', 9_000, NOW - 2_000),
      makeSolve('5', 12_000, NOW - 1_000, { penalty: 'dnf' }),
    ])
    const trend = buildAnalyticsTrend(
      filterAnalyticsSolves([session], createAnalyticsFilters('333'), NOW),
      [5],
      DEFAULT_AVERAGE_TRIMMING,
    )
    const report = computeSubX(trend, 12_000, 2)
    expect(report.successes).toBe(3)
    expect(report.percent).toBe(60)
    expect(report.validPercent).toBe(75)
    expect(report.currentStreak).toBe(0)
    expect(report.longestStreak).toBe(2)
    expect(report.progress).toHaveLength(5)
    expect(report.progress.at(-1)).toBe(50)
    expect(report.bySession[0]?.percent).toBe(60)
    expect(report.estimatedProbability).not.toBeNull()
  })
})

describe('practice activity', () => {
  it('builds a heatmap, streaks, frequency and best/worst days', () => {
    const session = makeSession('s', 'Main', [
      makeSolve('1', 10_000, new Date(2026, 10, 1, 12).getTime()),
      makeSolve('2', 11_000, new Date(2026, 10, 1, 13).getTime()),
      makeSolve('3', 12_000, new Date(2026, 10, 1, 14).getTime()),
      makeSolve('4', 14_000, new Date(2026, 10, 2, 12).getTime()),
      makeSolve('5', 15_000, new Date(2026, 10, 2, 13).getTime()),
      makeSolve('6', 16_000, new Date(2026, 10, 2, 14).getTime()),
      makeSolve('7', 20_000, new Date(2026, 10, 3, 12).getTime()),
      makeSolve('8', 21_000, new Date(2026, 10, 3, 13).getTime()),
      makeSolve('9', 22_000, new Date(2026, 10, 3, 14).getTime()),
    ])
    const trend = buildAnalyticsTrend(
      filterAnalyticsSolves([session], createAnalyticsFilters('333'), NOW),
      [5],
      DEFAULT_AVERAGE_TRIMMING,
    )
    const activity = buildActivity(trend, NOW)
    expect(activity.activeDays).toBe(3)
    expect(activity.currentStreak).toBe(3)
    expect(activity.longestStreak).toBe(3)
    expect(activity.frequency).toBe(100)
    const calendar = buildActivityCalendar(
      activity.allDays,
      activity.heatmapStartMs!,
      3,
    )
    expect(calendar).toHaveLength(3)
    expect(calendar[0]?.key).toBe('2026-11-01')
    expect(calendar.at(-1)?.count).toBe(3)
    expect(activity.heatmapStartMs).toBe(new Date(2026, 10, 1).getTime())
    expect(activity.heatmapEndMs).toBe(new Date(2026, 10, 3).getTime())
    expect(activity.mostActive[0]?.count).toBe(3)
    expect(activity.bestPerformanceDay?.meanMs).toBe(11_000)
    expect(activity.worstPerformanceDay?.meanMs).toBe(21_000)
    expect(activity.monthly).toHaveLength(1)
  })

  it('keeps the complete filtered activity range across calendar years', () => {
    const session = makeSession('multi-year', 'Long history', [
      makeSolve('old', 10_000, new Date(2025, 8, 18, 12).getTime()),
      makeSolve('middle', 11_000, new Date(2026, 0, 5, 12).getTime()),
      makeSolve('new', 12_000, new Date(2026, 10, 3, 12).getTime()),
    ])
    const trend = buildAnalyticsTrend(
      filterAnalyticsSolves([session], createAnalyticsFilters('333'), NOW),
      [5],
      DEFAULT_AVERAGE_TRIMMING,
    )
    const activity = buildActivity(trend, NOW)
    expect(activity.allDays).toHaveLength(3)
    expect(activity.allDays[0]?.key).toBe('2025-09-18')
    expect(activity.allDays.at(-1)?.key).toBe('2026-11-03')
    const earliestWindow = buildActivityCalendar(
      activity.allDays,
      activity.heatmapStartMs!,
    )
    const latestWindow = buildActivityCalendar(
      activity.allDays,
      addLocalDays(activity.heatmapEndMs!, -370),
    )
    expect(earliestWindow).toHaveLength(371)
    expect(latestWindow).toHaveLength(371)
    expect(earliestWindow.filter((day) => day.count > 0).length).toBeGreaterThan(0)
    expect(latestWindow.filter((day) => day.count > 0).length).toBeGreaterThan(0)
    expect(activity.heatmapStartMs).toBe(new Date(2025, 8, 18).getTime())
    expect(activity.heatmapEndMs).toBe(new Date(2026, 10, 3).getTime())
    expect(
      analyticsSpansMultipleYears(
        trend.solves.map((solve) => solve.createdAt),
      ),
    ).toBe(true)
    expect(
      formatAnalyticsAxisDate(new Date(2025, 8, 15).getTime(), true),
    ).toMatch(/2025/)
    expect(
      formatAnalyticsAxisDate(new Date(2026, 10, 3).getTime(), false),
    ).not.toMatch(/2026/)
  })

  it('keeps a 100,000-day span sparse and materializes only bounded windows', () => {
    const latest = new Date(2026, 0, 1, 12).getTime()
    const earliest = addLocalDays(latest, -100_000)
    const session = makeSession('huge-span', 'Huge span', [
      makeSolve('new', 10_000, latest),
      makeSolve('old', 11_000, earliest),
    ])
    const trend = buildAnalyticsTrend(
      filterAnalyticsSolves([session], createAnalyticsFilters('333'), NOW),
      [5],
      DEFAULT_AVERAGE_TRIMMING,
    )
    const activity = buildActivity(trend, NOW)

    expect(activity.allDays).toHaveLength(2)
    expect(activity.activeDays).toBe(2)
    expect(activity.heatmapStartMs).toBe(new Date(2026, 0, 1 - 100_000).getTime())
    expect(activity.heatmapEndMs).toBe(new Date(2026, 0, 1).getTime())
    expect(activity.frequency).toBeCloseTo((2 / 100_001) * 100, 6)

    const earliestWindow = buildActivityCalendar(
      activity.allDays,
      clampActivityCalendarStart(activity, activity.heatmapStartMs!),
    )
    const latestWindow = buildActivityCalendar(
      activity.allDays,
      clampActivityCalendarStart(activity, activity.heatmapEndMs!),
    )
    expect(earliestWindow).toHaveLength(ACTIVITY_CALENDAR_WINDOW_DAYS)
    expect(latestWindow).toHaveLength(ACTIVITY_CALENDAR_WINDOW_DAYS)
    expect(earliestWindow.filter((day) => day.count > 0)).toHaveLength(1)
    expect(latestWindow.filter((day) => day.count > 0)).toHaveLength(1)
    expect(clampActivityCalendarStart(activity, activity.heatmapStartMs! - 100)).toBe(
      activity.heatmapStartMs,
    )
    expect(
      clampActivityCalendarStart(activity, activity.heatmapEndMs!),
    ).toBe(
      addLocalDays(
        activity.heatmapEndMs!,
        -(ACTIVITY_CALENDAR_WINDOW_DAYS - 1),
      ),
    )
  })
})

describe('advanced analytics', () => {
  it('computes percentiles, rankings, moving median and PB frequency', () => {
    const trend = trendFor([10_000, 12_000, 14_000, 16_000, 18_000])
    const advanced = computeAdvanced(trend, 11_000, 3)
    expect(advanced.p5Ms).toBe(10_400)
    expect(advanced.p50Ms).toBe(14_000)
    expect(advanced.p95Ms).toBe(17_600)
    expect(advanced.pbCount).toBe(1)
    expect(advanced.fastest[0]?.ms).toBe(10_000)
    expect(advanced.slowest[0]?.ms).toBe(18_000)
    expect(advanced.movingMedian).toHaveLength(5)
    expect(advanced.estimatedTargetProbability).toBeGreaterThan(0)
  })

  it('uses the last N attempts, including DNFs, for the moving median', () => {
    const session = makeSession('s1', 'Main', [
      makeSolve('s0', 10_000, NOW - 4_000),
      makeSolve('s1', 9_000, NOW - 3_000, { penalty: 'dnf' }),
      makeSolve('s2', 20_000, NOW - 2_000),
      makeSolve('s3', 30_000, NOW - 1_000),
    ])
    const trend = buildAnalyticsTrend(
      filterAnalyticsSolves([session], createAnalyticsFilters('333'), NOW),
      [5],
      DEFAULT_AVERAGE_TRIMMING,
    )
    const advanced = computeAdvanced(trend, 11_000, 3)
    expect(advanced.movingMedian).toEqual([10_000, 10_000, 15_000, 25_000])
  })

  it('sorts each moving-median window instead of using the middle attempt', () => {
    const unsorted = trendFor([10_000, 30_000, 20_000])
    expect(computeAdvanced(unsorted, 25_000, 3).movingMedian).toEqual([
      10_000,
      20_000,
      20_000,
    ])

    const session = makeSession('s1', 'Main', [
      makeSolve('s0', 30_000, NOW - 3_000),
      makeSolve('s1', 10_000, NOW - 2_000, { penalty: 'dnf' }),
      makeSolve('s2', 20_000, NOW - 1_000),
      makeSolve('s3', 20_000, NOW),
    ])
    const trend = buildAnalyticsTrend(
      filterAnalyticsSolves([session], createAnalyticsFilters('333'), NOW),
      [5],
      DEFAULT_AVERAGE_TRIMMING,
    )
    expect(computeAdvanced(trend, 25_000, 3).movingMedian).toEqual([
      30_000,
      30_000,
      25_000,
      20_000,
    ])
    expect(computeAdvanced(trend, 25_000, 25).movingMedian).toEqual([
      30_000,
      30_000,
      25_000,
      20_000,
    ])
  })

  it('keeps chronological order for tied fastest and slowest solves', () => {
    const session = makeSession('s', 'Main', [
      makeSolve('first-fast', 9_000, NOW - 8_000),
      makeSolve('first-slow', 20_000, NOW - 7_000),
      makeSolve('second-fast', 9_000, NOW - 6_000),
      makeSolve('second-slow', 20_000, NOW - 5_000),
      makeSolve('third-fast', 9_000, NOW - 4_000),
      makeSolve('third-slow', 20_000, NOW - 3_000),
      makeSolve('fourth-fast', 9_000, NOW - 2_000),
      makeSolve('fourth-slow', 20_000, NOW - 1_000),
    ])
    const trend = buildAnalyticsTrend(
      filterAnalyticsSolves([session], createAnalyticsFilters('333'), NOW),
      [5],
      DEFAULT_AVERAGE_TRIMMING,
    )
    const advanced = computeAdvanced(trend, 11_000)
    expect(advanced.fastest.map((entry) => entry.solve.id)).toEqual([
      'first-fast',
      'second-fast',
      'third-fast',
      'fourth-fast',
      'first-slow',
    ])
    expect(advanced.slowest.map((entry) => entry.solve.id)).toEqual([
      'first-slow',
      'second-slow',
      'third-slow',
      'fourth-slow',
      'first-fast',
    ])
  })
})

describe('session comparisons', () => {
  it('compares multiple sessions with their own sample sizes and averages', () => {
    const sessions = [
      makeSession('a', 'Morning', [
        makeSolve('a1', 10_000, NOW - 3_000),
        makeSolve('a2', 11_000, NOW - 2_000),
        makeSolve('a3', 12_000, NOW - 1_000),
      ]),
      makeSession(
        'b',
        'Evening',
        [
          makeSolve('b1', 20_000, NOW - 3_000),
          makeSolve('b2', 21_000, NOW - 2_000),
        ],
        '333',
      ),
    ]
    const comparison = compareSessions(
      sessions,
      createAnalyticsFilters('333'),
      DEFAULT_AVERAGE_TRIMMING,
      15_000,
      NOW,
    )
    expect(comparison).toHaveLength(2)
    expect(comparison[0]?.name).toBe('Morning')
    expect(comparison[0]?.count).toBe(3)
    expect(comparison[1]?.count).toBe(2)
    expect(comparison[0]?.overview.meanMs).toBe(11_000)
    expect(comparison[1]?.overview.meanMs).toBe(20_500)
  })
})

describe('large histories', () => {
  it('filters and analyses a 100,000-solve history without mutating it', () => {
    const solves: Solve[] = []
    const start = NOW - 100_000 * 1_000
    for (let index = 0; index < 100_000; index += 1) {
      solves.push(
        makeSolve(
          `large-${index}`,
          10_000 + (index % 5_000),
          start + index * 1_000,
          { penalty: index % 1_000 === 0 ? 'dnf' : 'none' },
        ),
      )
    }
    const session = makeSession('large', 'Large', solves)
    const filtered = filterAnalyticsSolves(
      [session],
      createAnalyticsFilters('333'),
      NOW,
    )
    expect(filtered).toHaveLength(100_000)
    const trend = buildAnalyticsTrend(
      filtered,
      [5, 12, 50, 100],
      DEFAULT_AVERAGE_TRIMMING,
    )
    const overview = computeAnalyticsOverview(
      trend,
      [5, 12, 50, 100],
      DEFAULT_AVERAGE_TRIMMING,
    )
    expect(overview.count).toBe(100_000)
    expect(overview.dnfCount).toBe(100)
    expect(overview.best).toBe(10_000)
    expect(overview.averages.every((average) => average.best !== null)).toBe(true)
    expect(solves).toHaveLength(100_000)
  }, 30_000)
})

describe('histogram rescaling', () => {
  const typical = Array.from({ length: 100 }, (_, index) => 10_000 + index * 50)
  const withExtreme = [...typical, 600_000]

  it('keeps a few long solves from compressing the main distribution', () => {
    const histogram = buildHistogram(withExtreme)
    expect(histogram.validCount).toBe(101)
    expect(histogram.intervalMs).toBeLessThanOrEqual(1_000)
    expect(histogram.bins.length).toBeLessThanOrEqual(20)
    expect(histogram.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(101)
    const extremeBin = histogram.bins.find((bin) =>
      bin.startMs <= 600_000 && 600_000 < bin.endMs,
    )
    expect(extremeBin?.count).toBeGreaterThanOrEqual(1)
    expect(extremeBin?.groupedExtreme).toBe(true)
    expect(histogram.groupedExtremes).toBe(true)
  })

  it('recomputes an automatic interval when data switches ranges', () => {
    const long = buildHistogram(
      Array.from({ length: 60 }, (_, index) => 90_000 + index * 1_000),
    )
    const short = buildHistogram(
      Array.from({ length: 60 }, (_, index) => 9_000 + index * 100),
    )
    expect(long.autoInterval).toBe(true)
    expect(short.autoInterval).toBe(true)
    expect(short.intervalMs).toBeLessThan(long.intervalMs)
    expect(short.bins.at(-1)!.endMs).toBeLessThanOrEqual(15_000)
    expect(long.bins[0]!.startMs).toBeGreaterThanOrEqual(80_000)
    const longAgain = buildHistogram(
      Array.from({ length: 60 }, (_, index) => 90_000 + index * 1_000),
    )
    expect(longAgain.intervalMs).toBe(long.intervalMs)
    expect(longAgain.bins).toEqual(long.bins)
    expect(buildHistogram([12_345]).intervalMs).not.toBe(
      buildHistogram([90_000, 90_500]).intervalMs,
    )
  })

  it('preserves an explicit interval across different histories', () => {
    const long = buildHistogram([60_000, 90_000, 1_000_000], 2_000)
    const short = buildHistogram([10_000, 12_000, 14_000], 2_000)
    expect(long.intervalMs).toBe(2_000)
    expect(short.intervalMs).toBe(2_000)
    expect(long.autoInterval).toBe(false)
    expect(short.autoInterval).toBe(false)
  })

  it('handles empty and single-solve histories', () => {
    const empty = buildHistogram([])
    expect(empty.bins).toEqual([])
    expect(empty.autoInterval).toBe(true)
    expect(empty.groupedExtremes).toBe(false)

    const one = buildHistogram([12_345])
    expect(one.validCount).toBe(1)
    expect(one.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(1)
    expect(one.bins[0]!.startMs).toBeLessThanOrEqual(12_345)
    expect(one.bins[0]!.endMs).toBeGreaterThan(12_345)
  })
})
