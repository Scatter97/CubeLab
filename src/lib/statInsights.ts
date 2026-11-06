import type { AverageTrimming, Solve } from '../types'
import { DEFAULT_AVERAGE_TRIMMING } from './averageTrimming'
import {
  calculateAverageFromTimes,
  calculateMeanFromTimes,
  effectiveTimeMs,
  recordedTimeMs,
  type StatResult,
} from './stats'

export type StatInsightKind = 'single' | 'mo3' | 'average'

export type NextSolveStatus =
  | 'no-target'
  | 'insufficient'
  | 'impossible'
  | 'any'
  | 'any-valid'
  | 'value'

export interface NextSolveNeeded {
  status: NextSolveStatus
  /** Maximum recorded next-solve time in milliseconds for a value result. */
  ms: number | null
}

export interface StatInsights {
  /** Null when the next window cannot be formed or is not an average. */
  bpa: StatResult
  /** Null when the next window cannot be formed or is not an average. */
  wpa: StatResult
  nextSolve: NextSolveNeeded
}

interface InsightOptions {
  solves: readonly Solve[]
  kind: StatInsightKind
  size: number | null
  trimming?: AverageTrimming
  targetMs?: number | null
}

function existingWindowSize(kind: StatInsightKind, size: number | null): number {
  if (kind === 'mo3') return 2
  if (kind === 'average') return Math.max(0, (size ?? 0) - 1)
  return 0
}

function evaluateNextWindow(
  existingTimes: readonly (number | null)[],
  kind: StatInsightKind,
  size: number | null,
  trimming: AverageTrimming,
  candidate: number | null,
): StatResult {
  const times = [
    candidate === null ? null : recordedTimeMs(candidate),
    ...existingTimes,
  ]
  if (kind === 'mo3') return calculateMeanFromTimes(times)
  if (kind === 'average' && size !== null) {
    return calculateAverageFromTimes(times, size, trimming)
  }
  return null
}

/**
 * Upper bound for the binary search. Doubling continues until either the
 * candidate is trimmed out (the average plateaus) or the average exceeds the
 * target. Real solve times never approach this guard.
 */
function findMaximumNextSolve(
  existingTimes: readonly (number | null)[],
  kind: StatInsightKind,
  size: number | null,
  trimming: AverageTrimming,
  targetMs: number,
  bpa: StatResult,
  wpa: StatResult,
): NextSolveNeeded {
  if (!bpa) return { status: 'insufficient', ms: null }
  if (bpa.status === 'dnf') return { status: 'impossible', ms: null }
  if (bpa.ms > targetMs) return { status: 'impossible', ms: null }
  // If even a DNF next solve still meets the target, every result does.
  if (wpa?.status === 'value' && wpa.ms <= targetMs) {
    return { status: 'any', ms: null }
  }

  const existingMaximum = existingTimes.reduce<number>(
    (maximum, time) => (time === null ? maximum : Math.max(maximum, time)),
    0,
  )
  const count = Math.max(1, size ?? 3)
  let high = Math.max(3_600_000, targetMs * count, existingMaximum * 2)
  let highResult = evaluateNextWindow(
    existingTimes,
    kind,
    size,
    trimming,
    high,
  )

  let plateau = false
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (highResult?.status === 'value' && highResult.ms > targetMs) break
    if (highResult?.status === 'dnf') {
      return { status: 'impossible', ms: null }
    }

    const nextHigh = high * 2
    if (!Number.isFinite(nextHigh) || nextHigh > Number.MAX_SAFE_INTEGER) {
      return { status: 'any-valid', ms: null }
    }
    const nextResult = evaluateNextWindow(
      existingTimes,
      kind,
      size,
      trimming,
      nextHigh,
    )
    if (
      highResult?.status === 'value' &&
      nextResult?.status === 'value' &&
      nextResult.ms <= targetMs &&
      nextResult.ms === highResult.ms
    ) {
      // The next solve is trimmed out; any finite result now meets the target.
      plateau = true
      break
    }
    high = nextHigh
    highResult = nextResult
  }

  if (plateau) return { status: 'any-valid', ms: null }
  if (!(highResult?.status === 'value' && highResult.ms > targetMs)) {
    return { status: 'any-valid', ms: null }
  }

  let low = 0
  let highBound = high
  while (highBound - low > 1) {
    const middle = Math.floor((low + highBound) / 2)
    const result = evaluateNextWindow(
      existingTimes,
      kind,
      size,
      trimming,
      middle,
    )
    if (result?.status === 'value' && result.ms <= targetMs) low = middle
    else highBound = middle
  }

  return { status: 'value', ms: recordedTimeMs(low) }
}

/**
 * Computes the best/worst possible next average and the maximum next solve
 * that still reaches a configured target. All average construction reuses the
 * shared WCA trimming helpers, including DNF and +2 semantics.
 */
export function calculateStatInsights({
  solves,
  kind,
  size,
  trimming = DEFAULT_AVERAGE_TRIMMING,
  targetMs = null,
}: InsightOptions): StatInsights {
  const target =
    targetMs !== null && Number.isFinite(targetMs) && targetMs > 0
      ? targetMs
      : null

  if (kind === 'single') {
    return {
      bpa: null,
      wpa: null,
      nextSolve:
        target === null
          ? { status: 'no-target', ms: null }
          : { status: 'value', ms: target },
    }
  }

  const required = existingWindowSize(kind, size)
  if (solves.length < required) {
    return {
      bpa: null,
      wpa: null,
      nextSolve: { status: 'insufficient', ms: null },
    }
  }

  // The next solve is newest, so the retained window is the newest solves
  // after dropping the oldest one that would leave the rolling window.
  const existingTimes = solves
    .slice(0, required)
    .map((solve) => effectiveTimeMs(solve))

  const bpa = evaluateNextWindow(existingTimes, kind, size, trimming, 0)
  const wpa = evaluateNextWindow(existingTimes, kind, size, trimming, null)
  const nextSolve =
    target === null
      ? ({ status: 'no-target', ms: null } as const)
      : findMaximumNextSolve(
          existingTimes,
          kind,
          size,
          trimming,
          target,
          bpa,
          wpa,
        )

  return { bpa, wpa, nextSolve }
}
