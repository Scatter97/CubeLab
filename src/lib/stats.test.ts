import { describe, expect, it } from 'vitest'
import type { Penalty, Solve } from '../types'
import { AVERAGE_TRIM_OPTIONS } from './averageTrimming'
import { CUBELAB_EVENTS } from './events'
import {
  calculateAverage,
  calculateRollingAverages,
  calculateBestAverage,
  calculateBestMeanOf3,
  calculateBestSingle,
  calculateLatestSingle,
  calculateMeanOf3,
  effectiveTimeMs,
  getSessionStats,
} from './stats'

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

/** Solves are always supplied newest-first by the session store. */
function solves(...values: Array<number | [number, Penalty]>): Solve[] {
  return values
    .map((value, index) =>
      Array.isArray(value)
        ? solve(value[0], value[1], `id-${index}`)
        : solve(value, 'none', `id-${index}`),
    )
    .reverse()
}

describe('effective times', () => {
  it('adds two seconds for +2 and excludes DNF', () => {
    expect(effectiveTimeMs(solve(10_000))).toBe(10_000)
    expect(effectiveTimeMs(solve(10_000, '+2'))).toBe(12_000)
    expect(effectiveTimeMs(solve(10_000, 'dnf'))).toBeNull()
  })

  it('truncates individual results to centiseconds before aggregation', () => {
    // 10009 ms displays as 10.00; the recorded result is 10000 ms.
    expect(effectiveTimeMs(solve(10_009))).toBe(10_000)
    expect(effectiveTimeMs(solve(10_009, '+2'))).toBe(12_000)
  })

  it('averages recorded centiseconds, not hidden milliseconds', () => {
    const solves = [
      solve(10_009),
      solve(10_009),
      solve(10_009),
      solve(10_009),
      solve(10_009),
    ].reverse()
    const result = calculateAverage(solves, 5)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('value')
    if (result!.status === 'value') expect(result!.ms).toBe(10_000)
  })

  it('rounds results at or above ten minutes to the nearest second (WCA 9f2)', () => {
    expect(effectiveTimeMs(solve(600_499))).toBe(600_000)
    expect(effectiveTimeMs(solve(600_500))).toBe(601_000)
    // Below the threshold the individual result stays truncated to hundredths.
    expect(effectiveTimeMs(solve(599_999))).toBe(599_990)
  })

  it('applies identical WCA penalties and mo3 rules to every event', () => {
    for (const event of CUBELAB_EVENTS) {
      const withEvent = (ms: number, penalty: Penalty, id: string): Solve => ({
        ...solve(ms, penalty, `${event.id}-${id}`),
        event: event.id,
      })

      // Newest first, as the session store supplies solves.
      const trio: Solve[] = [
        withEvent(30_000, '+2', 'newest'),
        withEvent(20_000, 'none', 'middle'),
        withEvent(10_000, 'none', 'oldest'),
      ]

      expect(effectiveTimeMs(trio[0]!)).toBe(32_000)
      expect(calculateMeanOf3(trio)).toEqual({ status: 'value', ms: 20_670 })
      expect(
        calculateMeanOf3([
          { ...trio[0]!, penalty: 'dnf' },
          trio[1]!,
          trio[2]!,
        ]),
      ).toEqual({ status: 'dnf' })
      expect(getSessionStats(trio).count).toBe(3)
    }
  })
})

describe('mean of 3', () => {
  it('requires three solves', () => {
    expect(calculateMeanOf3(solves(10_000, 20_000))).toBeNull()
  })

  it('averages three valid solves', () => {
    expect(calculateMeanOf3(solves(10_000, 20_000, 30_000))).toEqual({
      status: 'value',
      ms: 20_000,
    })
  })

  it('is DNF if any solve is DNF', () => {
    expect(calculateMeanOf3(solves(10_000, 20_000, [30_000, 'dnf']))).toEqual({
      status: 'dnf',
    })
  })

  it('includes +2 in the mean', () => {
    expect(calculateMeanOf3(solves(10_000, 20_000, [30_000, '+2']))).toEqual({
      status: 'value',
      ms: 20_670,
    })
  })

  it('uses recorded centiseconds rather than hidden milliseconds', () => {
    expect(
      calculateMeanOf3(solves(10_009, 10_019, 10_029)),
    ).toEqual({ status: 'value', ms: 10_010 })
  })

  it('rounds a mean at or above ten minutes to the nearest second', () => {
    expect(
      calculateMeanOf3(solves(601_400, 601_400, 602_400)),
    ).toEqual({ status: 'value', ms: 601_000 })
  })

  it('uses only the three most recent solves', () => {
    expect(calculateMeanOf3(solves(9_000, 10_000, 20_000, 30_000))).toEqual({
      status: 'value',
      ms: 20_000,
    })
  })
})

describe('trimmed averages', () => {
  it('removes exactly one best and one worst solve for ao5', () => {
    expect(
      calculateAverage(solves(10_000, 11_000, 12_000, 13_000, 14_000), 5),
    ).toEqual({ status: 'value', ms: 12_000 })
  })

  it('removes high and low outliers', () => {
    expect(
      calculateAverage(solves(5_000, 10_000, 10_000, 10_000, 30_000), 5),
    ).toEqual({ status: 'value', ms: 10_000 })
  })

  it('trims one DNF as the worst result', () => {
    expect(
      calculateAverage(
        solves(10_000, 11_000, 12_000, 13_000, [14_000, 'dnf']),
        5,
      ),
    ).toEqual({ status: 'value', ms: 12_000 })
  })

  it('is DNF when two solves are DNF', () => {
    expect(
      calculateAverage(
        solves(10_000, 11_000, 12_000, [13_000, 'dnf'], [14_000, 'dnf']),
        5,
      ),
    ).toEqual({ status: 'dnf' })
  })

  it('requires a full window', () => {
    expect(calculateAverage(solves(1, 2, 3, 4), 5)).toBeNull()
  })

  it('uses +2 penalties in the trimmed average', () => {
    expect(
      calculateAverage(
        solves(
          [10_000, '+2'],
          [11_000, '+2'],
          12_000,
          13_000,
          [14_000, '+2'],
        ),
        5,
      ),
    ).toEqual({ status: 'value', ms: 12_670 })
  })

  it('rounds a trimmed average at or above ten minutes to the nearest second', () => {
    expect(
      calculateAverage(
        solves(599_400, 601_400, 601_400, 602_400, 602_400),
        5,
      ),
    ).toEqual({ status: 'value', ms: 601_000 })
  })

  it('calculates ao12 and requires twelve solves', () => {
    const times = Array.from({ length: 12 }, (_, index) => 10_000 + index * 1_000)
    expect(calculateAverage(solves(...times), 12)).toEqual({
      status: 'value',
      ms: 15_500,
    })
    expect(calculateAverage(solves(...times.slice(0, 11)), 12)).toBeNull()
  })

  it('uses only the most recent window', () => {
    const all = solves(
      1_000,
      2_000,
      3_000,
      4_000,
      5_000,
      10_000,
      10_000,
      10_000,
      10_000,
      10_000,
    )
    expect(calculateAverage(all, 5)).toEqual({ status: 'value', ms: 10_000 })
  })
})

describe('personal bests', () => {
  it('finds the best effective single and ignores DNF', () => {
    expect(
      calculateBestSingle(
        solves([9_000, '+2'], [8_000, 'dnf'], 12_000, 10_000),
      ),
    ).toBe(10_000)
  })

  it('uses recorded centiseconds for the best single', () => {
    expect(calculateBestSingle(solves(10_009, 9_999))).toBe(9_990)
    expect(calculateBestSingle(solves(600_400, 599_999))).toBe(599_990)
  })

  it('returns the latest single including penalties', () => {
    expect(calculateLatestSingle(solves(12_000, [8_000, '+2']))).toEqual({
      status: 'value',
      ms: 10_000,
    })
    expect(calculateLatestSingle(solves(12_000, [10_000, 'dnf']))).toEqual({
      status: 'dnf',
    })
    expect(calculateLatestSingle([])).toBeNull()
  })

  it('finds the best valid mean of 3 across the session', () => {
    const all = solves(
      30_000,
      30_000,
      30_000,
      10_000,
      10_000,
      10_000,
      1_000,
      9_000,
      9_000,
    )
    expect(calculateBestMeanOf3(all)).toBe(6_330)
  })

  it('uses recorded centiseconds when finding the best mean of 3', () => {
    expect(calculateBestMeanOf3(solves(10_009, 10_019, 10_029))).toBe(10_010)
  })

  it('ignores DNF windows when finding a best average', () => {
    const all = solves(
      9_000,
      10_000,
      10_000,
      10_000,
      [8_000, 'dnf'],
      [7_000, 'dnf'],
      11_000,
    )
    expect(calculateBestAverage(all, 5)).toBe(10_000)
  })

  it('does not treat an all-DNF session as a personal best', () => {
    const all = solves(
      [9_000, 'dnf'],
      [10_000, 'dnf'],
      11_000,
      12_000,
      13_000,
    )
    expect(calculateBestAverage(all, 5)).toBeNull()
  })
})

describe('large averages', () => {
  it('matches a brute-force search for larger windows', () => {
    const all = solves(
      ...Array.from({ length: 140 }, (_, index) => {
        const raw = 9_000 + ((index * 137) % 3_000)
        return index % 29 === 0 ? ([raw, 'dnf'] as [number, Penalty]) : raw
      }),
    )

    for (const size of [5, 12, 25, 100]) {
      let expected: number | null = null
      for (let start = 0; start <= all.length - size; start += 1) {
        const result = calculateAverage(all.slice(start), size)
        if (
          result?.status === 'value' &&
          (expected === null || result.ms < expected)
        ) {
          expected = result.ms
        }
      }
      expect(calculateBestAverage(all, size)).toBe(expected)
    }
  })

  it('supports custom average sizes without computing unrelated built-ins', () => {
    const all = solves(...Array.from({ length: 30 }, (_, index) => 10_000 + index))
    const stats = getSessionStats(all, [7, 25])

    expect(stats.averages.get(7)).toBeDefined()
    expect(stats.averages.get(25)).toBeDefined()
    expect(stats.averages.has(12)).toBe(false)
  })
})

describe('session summary', () => {
  it('exposes current and best values with DNF awareness', () => {
    const stats = getSessionStats(
      solves(
        10_000,
        11_000,
        12_000,
        13_000,
        [14_000, 'dnf'],
        [15_000, 'dnf'],
      ),
    )

    expect(stats.count).toBe(6)
    expect(stats.single.best).toBe(10_000)
    expect(stats.single.latest).toEqual({ status: 'dnf' })
    expect(stats.mo3.latest).toEqual({ status: 'dnf' })
    expect(stats.averages.get(5)?.latest).toEqual({ status: 'dnf' })
  })
})


describe('configurable trimming', () => {
  it('allows 50 DNFs in ao1000 with the default 5% but rejects the 51st', () => {
    const all = Array.from({ length: 1000 }, (_, i) => solve(10000, i < 50 ? 'dnf' : 'none', String(i)))
    expect(calculateAverage(all, 1000)).toEqual({ status: 'value', ms: 10000 })
    expect(calculateBestAverage(all, 1000)).toBe(10000)
    expect(calculateAverage(all, 1000, { better: '1', worse: 'auto' })).toEqual({ status: 'dnf' })
    all[50] = { ...all[50]!, penalty: 'dnf' }
    expect(calculateAverage(all, 1000)).toEqual({ status: 'dnf' })
    expect(calculateBestAverage(all, 1000)).toBeNull()
  })
  it('supports zero, asymmetric and median trims and leaves mo3 untrimmed', () => {
    const all = solves(1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000)
    expect(calculateAverage(all, 10, { better: 'p20', worse: '1' })).toEqual({ status: 'value', ms: 6000 })
    expect(calculateAverage(all, 10, { better: '0', worse: '0' })).toEqual({ status: 'value', ms: 5500 })
    expect(calculateAverage(all, 10, { better: 'median', worse: 'auto' })).toEqual({ status: 'value', ms: 5500 })
    const dnfs = solves(1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, [9000, 'dnf'], [10000, 'dnf'])
    expect(calculateAverage(dnfs, 10, { better: 'p20', worse: 'p20' })).toEqual({ status: 'value', ms: 5500 })
    expect(calculateAverage(dnfs, 10, { better: 'p20', worse: '1' })).toEqual({ status: 'dnf' })
    expect(calculateMeanOf3(dnfs)).toEqual({ status: 'dnf' })
    expect(getSessionStats(dnfs, [10], { better: 'p20', worse: 'p20' }).mo3.latest).toEqual({ status: 'dnf' })
  })
  it('matches direct windows for every rule pair, including duplicates, penalties, zeroes and DNFs', () => {
    const all = Array.from({ length: 135 }, (_, i) => solve(i % 31 === 0 ? 0 : i % 17 === 0 ? 601500 : 10000 + (i * 137 % 230) * 10, i % 19 === 0 ? 'dnf' : i % 11 === 0 ? '+2' : 'none', String(i)))
    for (const left of AVERAGE_TRIM_OPTIONS) for (const right of AVERAGE_TRIM_OPTIONS) for (const size of [3, 4, 5, 12, 25, 100]) {
      const trimming = { better: left.value, worse: right.value }
      const expected = Array.from({ length: all.length - size + 1 }, (_, start) => calculateAverage(all.slice(start), size, trimming))
      expect(calculateRollingAverages(all, size, trimming)).toEqual(expected)
      const valid = expected.flatMap((v) => v?.status === 'value' ? [v.ms] : [])
      expect(calculateBestAverage(all, size, trimming)).toBe(valid.length ? Math.min(...valid) : null)
    }
  })
  it('handles 10,000 solves and long percentage-trimmed windows without per-window sorting', () => {
    const all = Array.from({ length: 10000 }, (_, i) => solve(10000, i % 50 === 0 ? 'dnf' : 'none', String(i)))
    const stats = getSessionStats(all, [1000, 5000, 10000])
    for (const size of [1000, 5000, 10000]) expect(stats.averages.get(size)).toEqual({ best: 10000, latest: { status: 'value', ms: 10000 } })
  })
})
