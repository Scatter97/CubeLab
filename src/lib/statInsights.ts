import type { AverageTrimming, Solve } from '../types'
import {
  calculateMeanFromTimes,
  calculateBestAverage,
  calculateBestMeanOf3,
  calculateBestSingle,
  effectiveTimeMs,
  recordedTimeMs,
  roundAggregateMs,
  type StatResult,
} from './stats'
import {
  DEFAULT_AVERAGE_TRIMMING,
  getAverageTrimCounts,
} from './averageTrimming'

export type StatInsightKind = 'single' | 'mo3' | 'average'

export type TargetStatus =
  /** No session best or retained next window exists yet. Displayed as "—". */
  | 'insufficient'
  /** No achievable next result can be strictly faster than the session best. */
  | 'impossible'
  /** Even a DNF next result produces a new best. */
  | 'any'
  /** Every finite next result produces a new best, but a DNF does not. */
  | 'any-valid'
  /** A maximum recorded next result exists. */
  | 'value'

export interface NextSolveTarget {
  status: TargetStatus
  /** Maximum recorded next-solve result in milliseconds for a value target. */
  ms: number | null
}

export interface StatInsights {
  /** Null when the next window cannot be formed, is not an average, or was not requested. */
  bpa: StatResult
  /** Null when the next window cannot be formed, is not an average, or was not requested. */
  wpa: StatResult
  target: NextSolveTarget
}

interface InsightOptions {
  solves: readonly Solve[]
  kind: StatInsightKind
  size: number | null
  trimming?: AverageTrimming
  /**
   * Historical session best for this statistic. Callers should pass the value
   * already produced by the session statistics engine so predictions do not
   * rescan every historical window.
   */
  bestMs?: number | null
  /** Skip calculations for metrics the panel does not display. */
  metrics?: {
    bpa?: boolean
    wpa?: boolean
    target?: boolean
  }
}

type NextWindowEvaluator = (candidateRawMs: number | null) => StatResult

function existingWindowSize(kind: StatInsightKind, size: number | null): number {
  if (kind === 'mo3') return 2
  if (kind === 'average') return Math.max(0, (size ?? 0) - 1)
  return 0
}

function upperBound(values: readonly number[], target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (values[middle]! <= target) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * Builds one evaluator for the retained next window. The existing results are
 * sorted once and prefix-summed, so searching for a target threshold does not
 * resort the window for every candidate. Average construction still uses the
 * same trim counts, DNF slots and recorded-result rounding as the session
 * statistics.
 */
function createNextWindowEvaluator(
  existingTimes: readonly (number | null)[],
  kind: StatInsightKind,
  size: number | null,
  trimming: AverageTrimming,
): NextWindowEvaluator {
  if (kind === 'mo3') {
    return (candidateRawMs) =>
      calculateMeanFromTimes([
        candidateRawMs === null ? null : recordedTimeMs(candidateRawMs),
        ...existingTimes.slice(0, 2),
      ])
  }

  const countedSize = size ?? 3
  const { better, worse, counted } = getAverageTrimCounts(countedSize, trimming)
  const valid = existingTimes
    .filter((time): time is number => time !== null)
    .sort((left, right) => left - right)
  const dnfs = existingTimes.length - valid.length
  const prefix = new Float64Array(valid.length + 1)
  for (let index = 0; index < valid.length; index += 1) {
    prefix[index + 1] = prefix[index]! + valid[index]!
  }

  return (candidateRawMs) => {
    if (dnfs > worse || counted < 1) return { status: 'dnf' }

    if (candidateRawMs === null) {
      const remainingWorst = worse - dnfs - 1
      if (remainingWorst < 0) return { status: 'dnf' }
      const end = valid.length - remainingWorst
      const sum = prefix[end]! - prefix[better]!
      return { status: 'value', ms: roundAggregateMs(sum / counted) }
    }

    const candidate = recordedTimeMs(candidateRawMs)
    const remainingWorst = worse - dnfs
    const end = valid.length + 1 - remainingWorst
    const position = upperBound(valid, candidate)
    let sum: number
    if (position < better) {
      // The candidate itself is trimmed as a fastest result.
      sum = prefix[end - 1]! - prefix[better - 1]!
    } else if (position >= end) {
      // The candidate is trimmed as a slowest result.
      sum = prefix[end]! - prefix[better]!
    } else {
      sum =
        prefix[position]! -
        prefix[better]! +
        candidate +
        (prefix[end - 1]! - prefix[position]!)
    }
    return { status: 'value', ms: roundAggregateMs(sum / counted) }
  }
}

function sessionBest(
  solves: readonly Solve[],
  kind: StatInsightKind,
  size: number | null,
): number | null {
  if (kind === 'single') return calculateBestSingle(solves)
  if (kind === 'mo3') return calculateBestMeanOf3(solves)
  return size === null ? null : calculateBestAverage(solves, size)
}

/** Cutoffs for an unsolvable single: the next result must stay below the PB. */
function singleTarget(bestMs: number | null): NextSolveTarget {
  if (bestMs === null || !Number.isFinite(bestMs) || bestMs <= 0) {
    return { status: 'impossible', ms: null }
  }

  // Search raw readings so the ceiling accounts for hundredth/second
  // recording precision at the ten-minute boundary.
  let low = 0
  let high = Math.floor(bestMs) - 1
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (recordedTimeMs(middle) < bestMs) low = middle
    else high = middle
  }
  return { status: 'value', ms: recordedTimeMs(low) }
}

function maximumNextResult(
  evaluator: NextWindowEvaluator,
  bestMs: number,
  upperRawMs: number,
): NextSolveTarget {
  const first = evaluator(0)
  if (first?.status !== 'value' || first.ms >= bestMs) {
    return { status: 'impossible', ms: null }
  }

  let high = Math.max(1, Math.ceil(upperRawMs))
  let highResult = evaluator(high)
  // Counted values cannot all be faster than best when the candidate alone is
  // far beyond it; this guard also handles unusual non-finite input safely.
  for (let attempt = 0; attempt < 64; attempt += 1) {
    if (highResult?.status !== 'value' || highResult.ms >= bestMs) break
    if (!Number.isSafeInteger(high * 2)) {
      return { status: 'any-valid', ms: null }
    }
    high *= 2
    highResult = evaluator(high)
  }
  if (highResult?.status !== 'value' || highResult.ms < bestMs) {
    return { status: 'any-valid', ms: null }
  }

  let low = 0
  let highBound = high
  while (highBound - low > 1) {
    const middle = Math.floor((low + highBound) / 2)
    const result = evaluator(middle)
    if (result?.status === 'value' && result.ms < bestMs) low = middle
    else highBound = middle
  }
  return { status: 'value', ms: recordedTimeMs(low) }
}

/** Finds the largest finite next result that is strictly faster than the PB. */
function calculateTarget(
  evaluator: NextWindowEvaluator,
  kind: StatInsightKind,
  size: number | null,
  trimming: AverageTrimming,
  bestMs: number | null,
  largestExistingMs: number,
): NextSolveTarget {
  if (bestMs === null || !Number.isFinite(bestMs) || bestMs <= 0) {
    return { status: 'insufficient', ms: null }
  }
  if (kind === 'single') return singleTarget(bestMs)

  const totalSize = kind === 'mo3' ? 3 : (size ?? 0)
  const { counted } = getAverageTrimCounts(totalSize, trimming)
  const dnfProbe = evaluator(null)
  const bpa = evaluator(0)
  if (bpa?.status !== 'value' || bpa.ms >= bestMs) {
    return { status: 'impossible', ms: null }
  }

  if (kind === 'mo3') {
    // Untrimmed mean: the candidate is always retained and no plateau exists.
    return maximumNextResult(
      evaluator,
      bestMs,
      Math.max(
        1_000_000,
        bestMs * counted + 1_000,
        largestExistingMs + 1_000,
      ),
    )
  }

  // A finite large candidate is trimmed from the worst side when at least one
  // valid worst-side slot remains. Its result is the plateau reached by a DNF
  // next solve as well, so this distinguishes an unbounded target.
  const plateauCandidateRaw = Math.max(1_000_000, largestExistingMs + 1_000)
  const plateau = evaluator(plateauCandidateRaw)
  if (
    plateau?.status === 'value' &&
    dnfProbe?.status === 'value' &&
    plateau.ms === dnfProbe.ms
  ) {
    if (plateau.ms < bestMs) {
      return { status: 'any', ms: null }
    }
    return maximumNextResult(
      evaluator,
      bestMs,
      Math.max(
        1_000_000,
        bestMs * counted + 1_000,
        plateauCandidateRaw,
      ),
    )
  }

  return maximumNextResult(
    evaluator,
    bestMs,
    Math.max(
      1_000_000,
      bestMs * counted + 1_000,
      largestExistingMs + 1_000,
    ),
  )
}

/**
 * Computes BPA/WPA for the next rolling window and the maximum next result
 * that would establish a new session best. Every result reuses the shared WCA
 * penalty, recorded-precision and configurable trimming helpers.
 */
export function calculateStatInsights({
  solves,
  kind,
  size,
  trimming = DEFAULT_AVERAGE_TRIMMING,
  bestMs,
  metrics,
}: InsightOptions): StatInsights {
  const wantsBpa = metrics?.bpa ?? true
  const wantsWpa = metrics?.wpa ?? true
  const wantsTarget = metrics?.target ?? true
  const best =
    bestMs === undefined ? sessionBest(solves, kind, size) : bestMs

  if (kind === 'single') {
    return {
      bpa: null,
      wpa: null,
      target:
        wantsTarget && best !== null
          ? singleTarget(best)
          : { status: 'insufficient', ms: null },
    }
  }

  const required = existingWindowSize(kind, size)
  if (solves.length < required) {
    return {
      bpa: null,
      wpa: null,
      target: { status: 'insufficient', ms: null },
    }
  }

  // The next solve is newest, so the retained window is the newest solves
  // after dropping the oldest one that would leave the rolling window.
  const existingTimes = solves
    .slice(0, required)
    .map((solve) => effectiveTimeMs(solve))
  const evaluator = createNextWindowEvaluator(
    existingTimes,
    kind,
    size,
    trimming,
  )

  const bpa = wantsBpa ? evaluator(0) : null
  const wpa = wantsWpa ? evaluator(null) : null
  const largestExistingMs = existingTimes.reduce<number>(
    (largest, time) => (time === null ? largest : Math.max(largest, time)),
    0,
  )
  const target =
    wantsTarget && best !== null
      ? calculateTarget(
          evaluator,
          kind,
          size,
          trimming,
          best,
          largestExistingMs,
        )
      : { status: 'insufficient' as const, ms: null }

  return { bpa, wpa, target }
}
