import type { Solve } from '../types'

export type StatValue =
  | { readonly status: 'value'; readonly ms: number }
  | { readonly status: 'dnf' }

export type StatResult = StatValue | null

export interface SessionStats {
  readonly count: number
  readonly bestSingleMs: number | null
  readonly latestSingle: StatResult
  readonly bestMean3Ms: number | null
  readonly latestMean3: StatResult
  readonly bestAverage5Ms: number | null
  readonly latestAverage5: StatResult
  readonly bestAverage12Ms: number | null
  readonly latestAverage12: StatResult
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
 * Trimmed average (Ao5, Ao12): remove the best and worst times. One DNF is
 * treated as the worst time and trimmed; two or more DNFs make the average a
 * DNF. `solves` is newest-first and only the first `size` solves are used.
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

function isValue(result: StatResult): result is Extract<StatValue, { status: 'value' }> {
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
 * Best valid average across every contiguous window. If no valid window
 * exists, returns null rather than claiming a DNF as a personal best.
 */
export function calculateBestAverage(
  solves: readonly Solve[],
  size: number,
): number | null {
  if (solves.length < size) return null
  let best: number | null = null

  for (let start = 0; start <= solves.length - size; start += 1) {
    const result = calculateAverage(solves.slice(start, start + size), size)
    if (isValue(result) && (best === null || result.ms < best)) {
      best = result.ms
    }
  }

  return best
}

export function calculateBestMeanOf3(solves: readonly Solve[]): number | null {
  if (solves.length < 3) return null
  let best: number | null = null

  for (let start = 0; start <= solves.length - 3; start += 1) {
    const result = calculateMeanOf3(solves.slice(start, start + 3))
    if (isValue(result) && (best === null || result.ms < best)) {
      best = result.ms
    }
  }

  return best
}

export function getSessionStats(solves: readonly Solve[]): SessionStats {
  return {
    count: solves.length,
    bestSingleMs: calculateBestSingle(solves),
    latestSingle: calculateLatestSingle(solves),
    bestMean3Ms: calculateBestMeanOf3(solves),
    latestMean3: calculateMeanOf3(solves),
    bestAverage5Ms: calculateBestAverage(solves, 5),
    latestAverage5: calculateAverage(solves, 5),
    bestAverage12Ms: calculateBestAverage(solves, 12),
    latestAverage12: calculateAverage(solves, 12),
  }
}
