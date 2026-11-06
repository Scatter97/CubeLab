import { describe, expect, it } from 'vitest'
import type { AverageTrimming, Penalty, Solve } from '../types'
import {
  calculateAverage,
  calculateBestAverage,
  calculateBestMeanOf3,
  calculateBestSingle,
  getSessionStats,
} from './stats'
import { calculateStatInsights } from './statInsights'

function solve(rawMs: number, penalty: Penalty = 'none', id?: string): Solve {
  return {
    id: id ?? `solve-${rawMs}-${penalty}`,
    event: '333',
    rawMs,
    penalty,
    scramble: "R U R' U'",
    comment: '',
    createdAt: 1_700_000_000_000 + rawMs,
  }
}

/** Newest first, matching the session store. */
function newestFirst(...values: Array<number | [number, Penalty]>): Solve[] {
  return values.map((value, index) =>
    Array.isArray(value)
      ? solve(value[0], value[1], `id-${index}`)
      : solve(value, 'none', `id-${index}`),
  )
}

function nextRecorded(ms: number): number {
  return ms >= 600_000 ? ms + 1_000 : ms + 10
}

function expectMaximumBoundary(
  target: { status: string; ms: number | null },
  solves: readonly Solve[],
  size: number,
  best: number,
  trimming?: AverageTrimming,
) {
  expect(target.status).toBe('value')
  expect(target.ms).not.toBeNull()
  const at = calculateAverage(
    [solve(target.ms!, 'none', 'target-at'), ...solves.slice(0, size - 1)],
    size,
    trimming,
  )
  expect(at?.status).toBe('value')
  if (at?.status === 'value') expect(at.ms).toBeLessThan(best)

  const past = calculateAverage(
    [
      solve(nextRecorded(target.ms!), 'none', 'target-past'),
      ...solves.slice(0, size - 1),
    ],
    size,
    trimming,
  )
  expect(past?.status).toBe('value')
  if (past?.status === 'value') expect(past.ms).toBeGreaterThanOrEqual(best)
}

describe('stat insights', () => {
  it('calculates BPA, WPA and the PB-based ao5 target threshold', () => {
    const solves = newestFirst(12_000, 13_000, 14_000, 20_000)
    const insights = calculateStatInsights({
      solves,
      kind: 'average',
      size: 5,
      bestMs: 14_000,
    })

    expect(insights.bpa).toEqual({ status: 'value', ms: 13_000 })
    expect(insights.wpa).toEqual({ status: 'value', ms: 15_670 })
    expect(insights.target).toEqual({ status: 'value', ms: 14_980 })
    expectMaximumBoundary(insights.target, solves, 5, 14_000)

    const atBoundary = calculateAverage(
      [solve(14_980, 'none', 'next'), ...solves],
      5,
    )
    const tiesBest = calculateAverage(
      [solve(14_990, 'none', 'next'), ...solves],
      5,
    )
    expect(atBoundary).toEqual({ status: 'value', ms: 13_990 })
    expect(tiesBest).toEqual({ status: 'value', ms: 14_000 })
  })

  it('uses untrimmed mo3 rules and reports the DNF worst case', () => {
    const insights = calculateStatInsights({
      solves: newestFirst(10_000, 20_000),
      kind: 'mo3',
      size: 3,
      bestMs: 12_000,
    })
    expect(insights.bpa).toEqual({ status: 'value', ms: 10_000 })
    expect(insights.wpa).toEqual({ status: 'dnf' })
    expect(insights.target).toEqual({ status: 'value', ms: 5_980 })
    expect(
      calculateAverage(
        [solve(5980, 'none', 'next'), solve(10_000), solve(20_000)],
        3,
        { better: '0', worse: '0' },
      ),
    ).toEqual({ status: 'value', ms: 11_990 })

    // The result must stay strictly below the 12.00 PB.
    expect(
      calculateAverage(
        [solve(5990, 'none', 'next'), solve(10_000), solve(20_000)],
        3,
        { better: '0', worse: '0' },
      ),
    ).toEqual({ status: 'value', ms: 12_000 })
  })

  it('reports N/A below the best possible average', () => {
    const insights = calculateStatInsights({
      solves: newestFirst(12_000, 13_000, 14_000, 20_000),
      kind: 'average',
      size: 5,
      bestMs: 12_000,
    })
    expect(insights.bpa).toEqual({ status: 'value', ms: 13_000 })
    expect(insights.target).toEqual({ status: 'impossible', ms: null })
  })

  it('reports an unbounded target when a slow candidate is trimmed out', () => {
    const solves = newestFirst(5_000, 5_000, 5_000, 9_000)
    const insights = calculateStatInsights({
      solves,
      kind: 'average',
      size: 5,
      bestMs: 7_000,
    })
    expect(insights.bpa).toEqual({ status: 'value', ms: 5_000 })
    expect(insights.wpa).toEqual({ status: 'value', ms: 6_330 })
    expect(insights.target).toEqual({ status: 'any', ms: null })
  })

  it('finds a finite target when only the old window best is reachable', () => {
    const solves = newestFirst(12_000, 13_000, 14_000, 20_000)
    // Historical best comes from an older, faster window.
    const insights = calculateStatInsights({
      solves,
      kind: 'average',
      size: 5,
      bestMs: 13_500,
    })
    expectMaximumBoundary(insights.target, solves, 5, 13_500)
  })

  it('requires the full retained window before calculating next-solve insights', () => {
    const insights = calculateStatInsights({
      solves: newestFirst(12_000, 13_000, 14_000),
      kind: 'average',
      size: 5,
      bestMs: null,
    })
    expect(insights.bpa).toBeNull()
    expect(insights.wpa).toBeNull()
    expect(insights.target).toEqual({ status: 'insufficient', ms: null })

    const retained = calculateStatInsights({
      solves: newestFirst(12_000, 13_000, 14_000, 20_000),
      kind: 'average',
      size: 5,
      bestMs: null,
    })
    expect(retained.bpa).not.toBeNull()
    expect(retained.target).toEqual({ status: 'insufficient', ms: null })
  })

  it('includes +2 penalties in the retained window and target', () => {
    const plain = newestFirst(12_000, 13_000, 14_000, 20_000)
    const penalized = newestFirst([12_000, '+2'], 13_000, 14_000, 20_000)
    const withPenalty = calculateStatInsights({
      solves: penalized,
      kind: 'average',
      size: 5,
      bestMs: 14_000,
    })
    const withoutPenalty = calculateStatInsights({
      solves: plain,
      kind: 'average',
      size: 5,
      bestMs: 14_000,
    })
    expect(withPenalty.bpa).not.toEqual(withoutPenalty.bpa)
    expect(withPenalty.target).not.toEqual(withoutPenalty.target)
    expectMaximumBoundary(withPenalty.target, penalized, 5, 14_000)
  })

  it('keeps DNF semantics in the retained window and target', () => {
    const solves = newestFirst(12_000, 13_000, 14_000, [20_000, 'dnf'])
    const insights = calculateStatInsights({
      solves,
      kind: 'average',
      size: 5,
      bestMs: 14_000,
    })
    expect(insights.bpa).toEqual({ status: 'value', ms: 13_000 })
    expect(insights.wpa).toEqual({ status: 'dnf' })
    expectMaximumBoundary(insights.target, solves, 5, 14_000)

    const tooManyDnfs = calculateStatInsights({
      solves: newestFirst(
        12_000,
        13_000,
        [14_000, 'dnf'],
        [20_000, 'dnf'],
      ),
      kind: 'average',
      size: 5,
      bestMs: 14_000,
    })
    expect(tooManyDnfs.bpa).toEqual({ status: 'dnf' })
    expect(tooManyDnfs.wpa).toEqual({ status: 'dnf' })
    expect(tooManyDnfs.target).toEqual({ status: 'impossible', ms: null })
  })

  it('trims the hypothetical fastest solve and still uses the shared engine', () => {
    const solves = newestFirst(10_000, 11_000, 12_000, 13_000)
    const mode: AverageTrimming = { better: '1', worse: 'auto' }
    const insights = calculateStatInsights({
      solves,
      kind: 'average',
      size: 5,
      trimming: mode,
      bestMs: 12_000,
    })
    const bpaWindow = [solve(0, 'none', 'next'), ...solves]
    const wpaWindow = [solve(0, 'dnf', 'next'), ...solves]
    expect(insights.bpa).toEqual(calculateAverage(bpaWindow, 5, mode))
    expect(insights.wpa).toEqual(calculateAverage(wpaWindow, 5, mode))
    expectMaximumBoundary(insights.target, solves, 5, 12_000, mode)
  })

  it('handles a slow hypothetical solve that the worse trim removes', () => {
    const solves = newestFirst(9_000, 10_000, 10_000, 11_000)
    const mode: AverageTrimming = { better: '1', worse: '1' }
    const insights = calculateStatInsights({
      solves,
      kind: 'average',
      size: 5,
      trimming: mode,
      bestMs: 10_000,
    })
    expect(insights.wpa).toEqual({ status: 'value', ms: 10_330 })
    expectMaximumBoundary(insights.target, solves, 5, 10_000, mode)
  })

  it.each([
    [7, { better: 'p5', worse: 'auto' }],
    [12, { better: '1', worse: 'auto' }],
    [25, { better: 'p10', worse: 'p10' }],
    [25, { better: 'p1', worse: 'p20' }],
    [5, { better: 'median', worse: 'auto' }],
    [100, { better: '0', worse: '0' }],
    [100, { better: 'median', worse: 'auto' }],
    [101, { better: 'p1', worse: 'auto' }],
  ] as const)(
    'matches the shared average engine for ao%i next windows',
    (size, trimming: AverageTrimming) => {
      const solves = newestFirst(
        ...Array.from({ length: size - 1 }, (_, index) => {
          const raw = 9_000 + ((index * 733) % 5_000)
          return index % 17 === 0
            ? ([raw, 'dnf'] as [number, Penalty])
            : index % 11 === 0
              ? ([raw, '+2'] as [number, Penalty])
              : raw
        }),
      )
      const best = calculateBestAverage(
        [...solves, ...newestFirst(...Array.from({ length: size }, () => 20_000))],
        size,
        trimming,
      )!
      const insights = calculateStatInsights({
        solves,
        kind: 'average',
        size,
        trimming,
        bestMs: best,
      })

      const bpaWindow = [
        solve(0, 'none', 'next'),
        ...solves.slice(0, size - 1),
      ]
      const wpaWindow = [
        solve(0, 'dnf', 'next'),
        ...solves.slice(0, size - 1),
      ]
      expect(insights.bpa).toEqual(calculateAverage(bpaWindow, size, trimming))
      expect(insights.wpa).toEqual(calculateAverage(wpaWindow, size, trimming))

      if (insights.target.status === 'value') {
        expectMaximumBoundary(insights.target, solves, size, best, trimming)
      }
    },
  )

  it('handles duplicate times, PB ties and missing valid results', () => {
    const duplicates = newestFirst(10_000, 10_000, 10_000, 10_000)
    const tied = calculateStatInsights({
      solves: duplicates,
      kind: 'average',
      size: 5,
      bestMs: 10_000,
    })
    expect(tied.bpa).toEqual({ status: 'value', ms: 10_000 })
    expect(tied.target).toEqual({ status: 'impossible', ms: null })

    const noBest = getSessionStats(duplicates, [5]).averages.get(5)
    expect(noBest?.best).toBeNull()
    expect(
      calculateStatInsights({
        solves: duplicates,
        kind: 'average',
        size: 5,
        bestMs: noBest?.best ?? null,
      }).target,
    ).toEqual({ status: 'insufficient', ms: null })
  })

  it('respects recorded-precision boundaries at ten minutes', () => {
    const solves = newestFirst(599_000, 599_500, 600_000, 600_500)
    const best = calculateBestAverage(
      [...solves, solve(601_000, 'none', 'older')],
      5,
    )!
    const insights = calculateStatInsights({
      solves,
      kind: 'average',
      size: 5,
      bestMs: best,
    })
    expectMaximumBoundary(insights.target, solves, 5, best)
  })

  it('calculates a single target strictly below the single PB', () => {
    expect(
      calculateStatInsights({
        solves: newestFirst(12_000),
        kind: 'single',
        size: null,
        bestMs: 12_000,
      }),
    ).toEqual({
      bpa: null,
      wpa: null,
      target: { status: 'value', ms: 11_990 },
    })
    expect(
      calculateStatInsights({
        solves: newestFirst(600_000),
        kind: 'single',
        size: null,
        bestMs: 600_000,
      }).target,
    ).toEqual({ status: 'value', ms: 599_990 })
    expect(
      calculateStatInsights({
        solves: newestFirst(10),
        kind: 'single',
        size: null,
        bestMs: 10,
      }).target,
    ).toEqual({ status: 'value', ms: 0 })
    expect(
      calculateStatInsights({
        solves: newestFirst(10),
        kind: 'single',
        size: null,
        bestMs: 0,
      }).target,
    ).toEqual({ status: 'impossible', ms: null })
  })

  it('updates when a penalty, deletion or trimming choice changes the PB', () => {
    const beforeSolves = newestFirst(10_000, 11_000, 12_000, 13_000, 50_000)
    const before = calculateStatInsights({
      solves: beforeSolves,
      kind: 'average',
      size: 5,
      bestMs: calculateBestAverage(beforeSolves, 5),
    })
    expect(before.target.status).toBe('value')

    const afterSolves = newestFirst([10_000, 'dnf'], 11_000, 12_000, 13_000, 50_000)
    const after = calculateStatInsights({
      solves: afterSolves,
      kind: 'average',
      size: 5,
      bestMs: calculateBestAverage(afterSolves, 5),
      trimming: { better: '1', worse: '1' },
    })
    expect(after.bpa).not.toEqual(before.bpa)
    expect(after.target).not.toEqual(before.target)

    const deleted = newestFirst(10_000, 12_000, 13_000, 50_000)
    expect(
      calculateStatInsights({
        solves: deleted,
        kind: 'average',
        size: 5,
        bestMs: calculateBestAverage(deleted, 5),
      }).target,
    ).toEqual({ status: 'insufficient', ms: null })
  })

  it('uses the newest retained window when older solves exist', () => {
    const recent = newestFirst(9_000, 10_000, 11_000, 12_000)
    const insights = calculateStatInsights({
      solves: [...recent, ...newestFirst(50_000, 60_000, 70_000, 80_000)],
      kind: 'average',
      size: 5,
      bestMs: 10_000,
    })
    const expected = calculateStatInsights({
      solves: recent,
      kind: 'average',
      size: 5,
      bestMs: 10_000,
    })
    expect(insights).toEqual(expected)
  })

  it('computes the PB from the shared session engine when not supplied', () => {
    const solves = newestFirst(12_000, 13_000, 14_000, 20_000, 11_000)
    const insights = calculateStatInsights({
      solves,
      kind: 'average',
      size: 5,
    })
    const expectedBest = calculateBestAverage(solves, 5)
    expect(insights.target).toEqual(
      calculateStatInsights({
        solves,
        kind: 'average',
        size: 5,
        bestMs: expectedBest,
      }).target,
    )
    expect(
      calculateStatInsights({
        solves,
        kind: 'mo3',
        size: 3,
      }).target,
    ).toEqual(
      calculateStatInsights({
        solves,
        kind: 'mo3',
        size: 3,
        bestMs: calculateBestMeanOf3(solves),
      }).target,
    )
    expect(
      calculateStatInsights({
        solves,
        kind: 'single',
        size: null,
      }).target,
    ).toEqual(
      calculateStatInsights({
        solves,
        kind: 'single',
        size: null,
        bestMs: calculateBestSingle(solves),
      }).target,
    )
  })

  it('skips unrequested metrics for large retained windows', () => {
    const solves = newestFirst(
      ...Array.from({ length: 100_000 }, (_, index) => 8_000 + (index % 2_000)),
    )
    const started = performance.now()
    const insights = calculateStatInsights({
      solves,
      kind: 'average',
      size: 10_000,
      bestMs: 8_000,
      metrics: { bpa: false, wpa: false, target: false },
    })
    expect(insights.bpa).toBeNull()
    expect(insights.wpa).toBeNull()
    expect(insights.target).toEqual({ status: 'insufficient', ms: null })
    expect(performance.now() - started).toBeLessThan(1_500)

    const target = calculateStatInsights({
      solves,
      kind: 'average',
      size: 10_000,
      bestMs: 9_500,
      metrics: { bpa: false, wpa: false, target: true },
    })
    expect(target.bpa).toBeNull()
    expect(target.wpa).toBeNull()
    expect(target.target.status).toBe('any')
  })
})
