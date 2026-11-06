import { describe, expect, it } from 'vitest'
import type { AverageTrimming, Penalty, Solve } from '../types'
import { calculateAverage, calculateMeanOf3 } from './stats'
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

describe('stat insights', () => {
  it('calculates BPA, WPA and the exact next-solve target boundary for ao5', () => {
    const solves = newestFirst(12_000, 13_000, 14_000, 20_000)
    const insights = calculateStatInsights({
      solves,
      kind: 'average',
      size: 5,
      targetMs: 14_000,
    })

    expect(insights.bpa).toEqual({ status: 'value', ms: 13_000 })
    expect(insights.wpa).toEqual({ status: 'value', ms: 15_670 })
    expect(insights.nextSolve).toEqual({ status: 'value', ms: 15_010 })

    const atBoundary = calculateAverage(
      [solve(15_010, 'none', 'next'), ...solves],
      5,
    )
    const pastBoundary = calculateAverage(
      [solve(15_020, 'none', 'next'), ...solves],
      5,
    )
    expect(atBoundary).toEqual({ status: 'value', ms: 14_000 })
    expect(pastBoundary).toEqual({ status: 'value', ms: 14_010 })
  })

  it('uses untrimmed mo3 rules and does not subtract the hold from the result', () => {
    const insights = calculateStatInsights({
      solves: newestFirst(10_000, 20_000),
      kind: 'mo3',
      size: 3,
      targetMs: 12_000,
    })
    expect(insights.bpa).toEqual({ status: 'value', ms: 10_000 })
    expect(insights.wpa).toEqual({ status: 'dnf' })
    expect(insights.nextSolve).toEqual({ status: 'value', ms: 6_010 })
    expect(calculateMeanOf3([solve(6_010, 'none', 'next'), solve(10_000), solve(20_000)]))
      .toEqual({ status: 'value', ms: 12_000 })
  })

  it('reports an impossible target below the best possible average', () => {
    const insights = calculateStatInsights({
      solves: newestFirst(12_000, 13_000, 14_000, 20_000),
      kind: 'average',
      size: 5,
      targetMs: 12_000,
    })
    expect(insights.bpa).toEqual({ status: 'value', ms: 13_000 })
    expect(insights.nextSolve).toEqual({ status: 'impossible', ms: null })
  })

  it('reports targets already met by any next result', () => {
    const insights = calculateStatInsights({
      solves: newestFirst(12_000, 13_000, 14_000, 20_000),
      kind: 'average',
      size: 5,
      targetMs: 16_000,
    })
    expect(insights.wpa).toEqual({ status: 'value', ms: 15_670 })
    expect(insights.nextSolve).toEqual({ status: 'any', ms: null })
  })

  it('requires the full retained window before calculating next-solve insights', () => {
    const insights = calculateStatInsights({
      solves: newestFirst(12_000, 13_000, 14_000),
      kind: 'average',
      size: 5,
      targetMs: 15_000,
    })
    expect(insights.bpa).toBeNull()
    expect(insights.wpa).toBeNull()
    expect(insights.nextSolve).toEqual({ status: 'insufficient', ms: null })
  })

  it('includes +2 penalties in the retained window', () => {
    const withPenalty = calculateStatInsights({
      solves: newestFirst([12_000, '+2'], 13_000, 14_000, 20_000),
      kind: 'average',
      size: 5,
      targetMs: 14_000,
    })
    const withoutPenalty = calculateStatInsights({
      solves: newestFirst(12_000, 13_000, 14_000, 20_000),
      kind: 'average',
      size: 5,
      targetMs: 14_000,
    })
    expect(withPenalty.bpa).not.toEqual(withoutPenalty.bpa)
    expect(withPenalty.nextSolve).not.toEqual(withoutPenalty.nextSolve)
  })

  it('keeps DNF semantics in the retained window', () => {
    const insights = calculateStatInsights({
      solves: newestFirst(12_000, 13_000, 14_000, [20_000, 'dnf']),
      kind: 'average',
      size: 5,
      targetMs: 14_000,
    })
    expect(insights.bpa).toEqual({ status: 'value', ms: 13_000 })
    expect(insights.wpa).toEqual({ status: 'dnf' })
    expect(insights.nextSolve.status).toBe('value')

    const tooManyDnfs = calculateStatInsights({
      solves: newestFirst(
        12_000,
        13_000,
        [14_000, 'dnf'],
        [20_000, 'dnf'],
      ),
      kind: 'average',
      size: 5,
      targetMs: 14_000,
    })
    expect(tooManyDnfs.bpa).toEqual({ status: 'dnf' })
    expect(tooManyDnfs.wpa).toEqual({ status: 'dnf' })
    expect(tooManyDnfs.nextSolve).toEqual({
      status: 'impossible',
      ms: null,
    })
  })

  it.each([
    [7, { better: 'p5', worse: 'auto' }],
    [12, { better: '1', worse: 'auto' }],
    [25, { better: 'p10', worse: 'p10' }],
    [100, { better: '0', worse: '0' }],
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
      const insights = calculateStatInsights({
        solves,
        kind: 'average',
        size,
        trimming,
        targetMs: 16_000,
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

      if (insights.nextSolve.status === 'value' && insights.nextSolve.ms !== null) {
        const atBoundary = calculateAverage(
          [solve(insights.nextSolve.ms, 'none', 'next'), ...solves.slice(0, size - 1)],
          size,
          trimming,
        )
        expect(atBoundary?.status).toBe('value')
        if (atBoundary?.status === 'value') {
          expect(atBoundary.ms).toBeLessThanOrEqual(16_000)
        }
      }
    },
  )

  it('handles a single target as the next result boundary', () => {
    expect(
      calculateStatInsights({
        solves: newestFirst(12_000),
        kind: 'single',
        size: null,
        targetMs: 15_000,
      }),
    ).toEqual({
      bpa: null,
      wpa: null,
      nextSolve: { status: 'value', ms: 15_000 },
    })
  })

  it('does not fabricate a next-solve value without enough history', () => {
    const insights = calculateStatInsights({
      solves: [],
      kind: 'average',
      size: 100,
      targetMs: 20_000,
    })
    expect(insights.nextSolve).toEqual({ status: 'insufficient', ms: null })
  })

  it('updates when a solve penalty changes', () => {
    const before = calculateStatInsights({
      solves: newestFirst(12_000, 13_000, 14_000, 20_000),
      kind: 'average',
      size: 5,
      targetMs: 14_000,
    })
    const after = calculateStatInsights({
      solves: newestFirst([12_000, '+2'], 13_000, 14_000, 20_000),
      kind: 'average',
      size: 5,
      targetMs: 14_000,
    })
    expect(after.bpa).not.toEqual(before.bpa)
  })

  it('uses the newest retained window when older solves exist', () => {
    const recent = newestFirst(9_000, 10_000, 11_000, 12_000)
    const insights = calculateStatInsights({
      solves: [...recent, ...newestFirst(50_000, 60_000, 70_000, 80_000)],
      kind: 'average',
      size: 5,
      targetMs: 11_000,
    })
    const expected = calculateStatInsights({
      solves: recent,
      kind: 'average',
      size: 5,
      targetMs: 11_000,
    })
    expect(insights).toEqual(expected)
  })
})
