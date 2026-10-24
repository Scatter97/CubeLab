import type { Solve } from '../types'
import {
  BUILT_IN_AVERAGE_SIZES,
  isValidAverageSize,
} from './statDefinitions'

export type StatValue =
  | { readonly status: 'value'; readonly ms: number }
  | { readonly status: 'dnf' }

export type StatResult = StatValue | null

export interface StatPair {
  readonly best: number | null
  readonly latest: StatResult
}

export interface SessionStats {
  readonly count: number
  readonly single: StatPair
  readonly mo3: StatPair
  readonly averages: ReadonlyMap<number, StatPair>
}

/** Converts a solve to its post-penalty time in milliseconds. */
export function effectiveTimeMs(solve: Solve): number | null {
  if (solve.penalty === 'dnf') return null
  if (solve.penalty === '+2') return solve.rawMs + 2_000
  return solve.rawMs
}

/** Times are stored to the hundredth; averages are rounded to match. */
function roundToCentisecond(ms: number): number {
  return Math.round(ms / 10) * 10
}

function meanValue(times: readonly number[]): StatValue {
  const sum = times.reduce((total, time) => total + time, 0)
  return { status: 'value', ms: roundToCentisecond(sum / times.length) }
}

/**
 * Mean of 3 follows WCA rules: all three solves count and any DNF makes the
 * mean a DNF.
 *
 * `solves` is expected to be newest-first. Returns null when fewer than three
 * solves exist.
 */
export function calculateMeanOf3(solves: readonly Solve[]): StatResult {
  if (solves.length < 3) return null
  const window = solves.slice(0, 3)
  const times = window.map(effectiveTimeMs)
  if (times.some((time) => time === null)) return { status: 'dnf' }
  return meanValue(times as number[])
}

/**
 * Trimmed average (Ao5, Ao12, and custom sizes): remove the best and worst
 * times. One DNF is treated as the worst time and trimmed; two or more DNFs
 * make the average a DNF. `solves` is newest-first and only the first `size`
 * solves are used.
 */
export function calculateAverage(
  solves: readonly Solve[],
  size: number,
): StatResult {
  if (!Number.isInteger(size) || size < 3) {
    throw new Error('Average size must be an integer of at least 3')
  }
  if (solves.length < size) return null

  const window = solves.slice(0, size)
  const times: number[] = []
  let dnfCount = 0

  for (const solve of window) {
    const time = effectiveTimeMs(solve)
    if (time === null) dnfCount += 1
    else times.push(time)
  }

  if (dnfCount > 1) return { status: 'dnf' }

  times.sort((a, b) => a - b)

  let counted: number[]
  if (dnfCount === 1) {
    // The DNF is the (trimmed) worst result. Remove the best valid time too.
    counted = times.slice(1)
  } else {
    counted = times.slice(1, -1)
  }

  if (counted.length !== size - 2) return { status: 'dnf' }
  return meanValue(counted)
}

function isValue(
  result: StatResult,
): result is Extract<StatValue, { status: 'value' }> {
  return result?.status === 'value'
}

/** Best valid single, ignoring DNFs. +2 penalties are included. */
export function calculateBestSingle(solves: readonly Solve[]): number | null {
  let best: number | null = null
  for (const solve of solves) {
    const time = effectiveTimeMs(solve)
    if (time !== null && (best === null || time < best)) best = time
  }
  return best
}

/** Latest completed single, including DNF and +2 outcomes. */
export function calculateLatestSingle(solves: readonly Solve[]): StatResult {
  const latest = solves[0]
  if (!latest) return null
  const time = effectiveTimeMs(latest)
  return time === null ? { status: 'dnf' } : { status: 'value', ms: time }
}

/**
 * Fenwick tree over compressed time values. It stores counts only; the
 * sliding window keeps the running valid-time sum separately.
 */
class CountFenwick {
  private readonly counts: number[]

  constructor(
    private readonly values: readonly number[],
    private readonly valueIndex: ReadonlyMap<number, number>,
  ) {
    this.counts = new Array(values.length + 1).fill(0)
  }

  add(value: number, delta: number): void {
    const index = this.valueIndex.get(value)
    if (!index) return
    for (
      let cursor = index;
      cursor < this.counts.length;
      cursor += cursor & -cursor
    ) {
      this.counts[cursor] = (this.counts[cursor] ?? 0) + delta
    }
  }

  /** Returns the value at the 1-based order statistic `order`. */
  kth(order: number): number {
    let index = 0
    let remaining = order
    let bit = 1
    while (bit * 2 < this.counts.length) bit *= 2

    for (; bit > 0; bit >>= 1) {
      const next = index + bit
      const count = this.counts[next]
      if (next < this.counts.length && count !== undefined && count < remaining) {
        index = next
        remaining -= count
      }
    }

    return this.values[index] ?? 0
  }
}

/**
 * Finds the best trimmed average across every contiguous window without
 * sorting each window. This keeps ao1000–ao10000 responsive.
 */
function calculateBestAverageFast(
  solves: readonly Solve[],
  size: number,
): number | null {
  if (solves.length < size) return null

  const validTimes = solves
    .map(effectiveTimeMs)
    .filter((time): time is number => time !== null)
  if (validTimes.length < size - 1) return null

  const values = [...new Set(validTimes)].sort((a, b) => a - b)
  const valueIndex = new Map(values.map((value, index) => [value, index + 1]))
  const fenwick = new CountFenwick(values, valueIndex)

  let dnfCount = 0
  let validSum = 0

  const changeWindow = (solve: Solve, delta: number) => {
    const time = effectiveTimeMs(solve)
    if (time === null) {
      dnfCount += delta
      return
    }
    fenwick.add(time, delta)
    validSum += time * delta
  }

  for (let index = 0; index < size; index += 1) {
    const solve = solves[index]
    if (solve) changeWindow(solve, 1)
  }

  let best: number | null = null

  for (let start = 0; start <= solves.length - size; start += 1) {
    if (dnfCount <= 1) {
      const validCount = size - dnfCount
      const minimum = fenwick.kth(1)
      let countedSum = validSum - minimum
      let countedCount = validCount - 1

      if (dnfCount === 0) {
        countedSum -= fenwick.kth(validCount)
        countedCount -= 1
      }

      if (countedCount > 0) {
        const average = roundToCentisecond(countedSum / countedCount)
        if (best === null || average < best) best = average
      }
    }

    if (start + size >= solves.length) break
    const outgoing = solves[start]
    const incoming = solves[start + size]
    if (outgoing) changeWindow(outgoing, -1)
    if (incoming) changeWindow(incoming, 1)
  }

  return best
}

/**
 * Best valid average across every contiguous window. If no valid window
 * exists, returns null rather than claiming a DNF as a personal best.
 */
export function calculateBestAverage(
  solves: readonly Solve[],
  size: number,
): number | null {
  if (!Number.isInteger(size) || size < 3) {
    throw new Error('Average size must be an integer of at least 3')
  }
  return calculateBestAverageFast(solves, size)
}

export function calculateBestMeanOf3(solves: readonly Solve[]): number | null {
  if (solves.length < 3) return null

  let sum = 0
  let dnfCount = 0
  for (let index = 0; index < 3; index += 1) {
    const solve = solves[index]
    const time = solve ? effectiveTimeMs(solve) : null
    if (time === null) dnfCount += 1
    else sum += time
  }

  let best: number | null = null
  const consider = () => {
    if (dnfCount > 0) return
    const value = roundToCentisecond(sum / 3)
    if (best === null || value < best) best = value
  }

  consider()
  for (let start = 1; start <= solves.length - 3; start += 1) {
    const outgoing = solves[start - 1]
    const incoming = solves[start + 2]
    if (outgoing) {
      const time = effectiveTimeMs(outgoing)
      if (time === null) dnfCount -= 1
      else sum -= time
    }
    if (incoming) {
      const time = effectiveTimeMs(incoming)
      if (time === null) dnfCount += 1
      else sum += time
    }
    consider()
  }

  return best
}

function getAveragePair(
  solves: readonly Solve[],
  size: number,
): StatPair {
  return {
    best: calculateBestAverage(solves, size),
    latest: calculateAverage(solves, size),
  }
}

export function getSessionStats(
  solves: readonly Solve[],
  averageSizes: readonly number[] = BUILT_IN_AVERAGE_SIZES,
): SessionStats {
  const sizes = new Set<number>()
  for (const size of averageSizes) {
    if (isValidAverageSize(size)) sizes.add(size)
  }

  const averages = new Map<number, StatPair>()
  for (const size of sizes) {
    averages.set(size, getAveragePair(solves, size))
  }

  return {
    count: solves.length,
    single: {
      best: calculateBestSingle(solves),
      latest: calculateLatestSingle(solves),
    },
    mo3: {
      best: calculateBestMeanOf3(solves),
      latest: calculateMeanOf3(solves),
    },
    averages,
  }
}

export { isValue }
