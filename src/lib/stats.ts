import type { AverageTrimming, Solve } from '../types'
import { DEFAULT_AVERAGE_TRIMMING, getAverageTrimCounts } from './averageTrimming'
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

/**
 * Converts a raw millisecond reading into the recorded result used by
 * statistics. WCA 9f1: individual results under 10 minutes are recorded to the
 * hundredth of a second (truncated). WCA 9f2: results at or above 10 minutes
 * are rounded to the nearest second.
 */
export function recordedTimeMs(rawMs: number): number {
  if (rawMs >= 10 * 60 * 1000) {
    return Math.round(rawMs / 1000) * 1000
  }
  return Math.floor(rawMs / 10) * 10
}

/** Converts a solve to its post-penalty time in milliseconds. */
export function effectiveTimeMs(solve: Solve): number | null {
  if (solve.penalty === 'dnf') return null
  return recordedTimeMs(solve.rawMs + (solve.penalty === '+2' ? 2_000 : 0))
}

/**
 * Aggregates are rounded to the recorded precision: hundredths below ten
 * minutes, whole seconds at or above ten minutes (WCA 9f2).
 */
function roundResultMs(ms: number): number {
  if (ms >= 10 * 60 * 1000) return Math.round(ms / 1000) * 1000
  return Math.round(ms / 10) * 10
}

function meanValue(times: readonly number[]): StatValue {
  const sum = times.reduce((total, time) => total + time, 0)
  return { status: 'value', ms: roundResultMs(sum / times.length) }
}

/**
 * Mean of 3 follows WCA rules: all three solves count and any DNF makes the
 * mean a DNF. The first three entries are used; null represents a DNF.
 */
export function calculateMeanFromTimes(
  times: readonly (number | null)[],
): StatResult {
  if (times.length < 3) return null
  const window = times.slice(0, 3)
  if (window.some((time) => time === null)) return { status: 'dnf' }
  return meanValue(window as number[])
}

/**
 * Mean of 3 from solves. `solves` is expected to be newest-first. Returns null
 * when fewer than three solves exist.
 */
export function calculateMeanOf3(solves: readonly Solve[]): StatResult {
  return calculateMeanFromTimes(solves.slice(0, 3).map(effectiveTimeMs))
}

/**
 * Configurable trimmed average from already-recorded result times. Null
 * represents a DNF; DNFs occupy worst-side slots first.
 */
export function calculateAverageFromTimes(
  times: readonly (number | null)[],
  size: number,
  trimming: AverageTrimming = DEFAULT_AVERAGE_TRIMMING,
): StatResult {
  const { better, worse, counted } = getAverageTrimCounts(size, trimming)
  if (times.length < size) return null
  const window = times.slice(0, size)
  const valid = window.filter((time): time is number => time !== null).sort((a, b) => a - b)
  const dnfs = size - valid.length
  if (dnfs > worse) return { status: 'dnf' }
  const end = valid.length - (worse - dnfs)
  const values = valid.slice(better, end)
  if (values.length !== counted || counted < 1) return { status: 'dnf' }
  return meanValue(values)
}

/** Configurable trimmed average from solves. */
export function calculateAverage(
  solves: readonly Solve[],
  size: number,
  trimming: AverageTrimming = DEFAULT_AVERAGE_TRIMMING,
): StatResult {
  return calculateAverageFromTimes(
    solves.slice(0, size).map(effectiveTimeMs),
    size,
    trimming,
  )
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

/** Count/sum Fenwick tree over compressed recorded results. */
class TimeFenwick {
  private readonly counts: number[]
  private readonly sums: number[]
  constructor(private readonly values: readonly number[], private readonly valueIndex: ReadonlyMap<number, number>) {
    this.counts = new Array(values.length + 1).fill(0)
    this.sums = new Array(values.length + 1).fill(0)
  }
  add(value: number, delta: number): void {
    const index = this.valueIndex.get(value)
    if (!index) return
    for (let cursor = index; cursor < this.counts.length; cursor += cursor & -cursor) {
      this.counts[cursor] = (this.counts[cursor] ?? 0) + delta
      this.sums[cursor] = (this.sums[cursor] ?? 0) + value * delta
    }
  }
  sumSmallest(order: number): number {
    if (order <= 0) return 0
    let index = 0, remaining = order, sum = 0, bit = 1
    while (bit * 2 < this.counts.length) bit *= 2
    for (; bit > 0; bit >>= 1) {
      const next = index + bit
      const count = this.counts[next]
      if (next < this.counts.length && count !== undefined && count < remaining) {
        index = next; remaining -= count; sum += this.sums[next] ?? 0
      }
    }
    return sum + remaining * (this.values[index] ?? 0)
  }
}

/** O(n log n) for every window, including percentage trims on long histories. */
function visitAverageWindows(solves: readonly Solve[], size: number, trimming: AverageTrimming, visit: (result: StatValue) => void) {
  const { better, worse, counted } = getAverageTrimCounts(size, trimming)
  if (solves.length < size) return
  const times = solves.map(effectiveTimeMs)
  const values = [...new Set(times.filter((time): time is number => time !== null))].sort((a, b) => a - b)
  const tree = new TimeFenwick(values, new Map(values.map((value, index) => [value, index + 1])))
  let dnfs = 0
  const change = (index: number, delta: number) => {
    const time = times[index]
    if (time === null) dnfs += delta
    else if (time !== undefined) tree.add(time, delta)
  }
  for (let index = 0; index < size; index++) change(index, 1)
  for (let start = 0; start <= times.length - size; start++) {
    if (dnfs > worse || counted < 1) visit({ status: 'dnf' })
    else {
      const sum = tree.sumSmallest(size - worse) - tree.sumSmallest(better)
      visit({ status: 'value', ms: roundResultMs(sum / counted) })
    }
    if (start + size < times.length) { change(start, -1); change(start + size, 1) }
  }
}

/** Complete-window results, ordered like the input; no data is mutated. */
export function calculateRollingAverages(solves: readonly Solve[], size: number, trimming: AverageTrimming = DEFAULT_AVERAGE_TRIMMING): StatValue[] {
  const results: StatValue[] = []
  visitAverageWindows(solves, size, trimming, (result) => results.push(result))
  return results
}

export function calculateBestAverage(solves: readonly Solve[], size: number, trimming: AverageTrimming = DEFAULT_AVERAGE_TRIMMING): number | null {
  let best: number | null = null
  visitAverageWindows(solves, size, trimming, (result) => {
    if (result.status === 'value' && (best === null || result.ms < best)) best = result.ms
  })
  return best
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
    const value = roundResultMs(sum / 3)
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
  trimming: AverageTrimming,
): StatPair {
  return {
    best: calculateBestAverage(solves, size, trimming),
    latest: calculateAverage(solves, size, trimming),
  }
}

export function getSessionStats(
  solves: readonly Solve[],
  averageSizes: readonly number[] = BUILT_IN_AVERAGE_SIZES,
  trimming: AverageTrimming = DEFAULT_AVERAGE_TRIMMING,
): SessionStats {
  const sizes = new Set<number>()
  for (const size of averageSizes) {
    if (isValidAverageSize(size)) sizes.add(size)
  }

  const averages = new Map<number, StatPair>()
  for (const size of sizes) {
    averages.set(size, getAveragePair(solves, size, trimming))
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
