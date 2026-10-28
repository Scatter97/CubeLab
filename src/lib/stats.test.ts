import { describe, expect, it } from 'vitest'
import type { Penalty, Solve } from '../types'
import { CUBELAB_EVENTS } from './events'
import {
  calculateAverage,
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
