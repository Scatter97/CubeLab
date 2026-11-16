/** Training statistics use measured milliseconds, without WCA penalties or precision rules. */
import { selectTrainingAttempts, type TrainingAttemptFilter } from './records'
import { assertBaselinePolicy, assertPositiveInteger, assertTrainingTimestamp, assertTrimPercent, TRAINING_DAY_MS } from './settings'
import { trainingOutcome } from './results'
import { TRAINING_CATEGORIES, type TrainingAlgorithmSnapshot, type TrainingAttempt, type TrainingBaselinePolicy } from './types'

export type TrainingMetric = 'raw' | 'estimated'
export interface TrainingTimeStatistics {
  readonly count: number
  readonly missing: number
  readonly meanMs: number | null
  readonly bestMs: number | null
}
export interface TrainingStatistics {
  readonly recordedAttempts: number
  readonly unsupportedAttempts: number
  readonly totalAttempts: number
  readonly successfulAttempts: number
  readonly dnfAttempts: number
  readonly dnfPercentage: number | null
  readonly raw: TrainingTimeStatistics
  readonly estimated: TrainingTimeStatistics | null
  readonly recentAttempts: readonly TrainingAttempt[]
}

/** Equal timestamp boundaries use binary ID ordering, independent of locale/array order. */
export function compareTrainingAttempts(a: TrainingAttempt, b: TrainingAttempt): number {
  return a.createdAt - b.createdAt || compareIds(a.id, b.id)
}
function compareIds(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0 }
function scoped(attempts: readonly TrainingAttempt[], filter: TrainingAttemptFilter): TrainingAttempt[] {
  if (!(TRAINING_CATEGORIES as readonly string[]).includes(filter.categoryId)) throw new Error('Training queries require one known category')
  return [...selectTrainingAttempts({ attempts }, filter)].sort(compareTrainingAttempts)
}
function timeStatistics(times: readonly (number | null)[]): TrainingTimeStatistics {
  const values = times.filter((v): v is number => v !== null)
  // Sum divided terms to avoid overflowing the sum of individually finite durations.
  return { count: values.length, missing: times.length - values.length,
    meanMs: values.length ? values.reduce((sum, v) => sum + v / values.length, 0) : null,
    bestMs: values.length ? values.reduce((best, v) => Math.min(best, v), Infinity) : null }
}
/** Stored estimates only: never backfill nulls or subtract a newer calibration. */
export function storedTrainingEstimate(attempt: TrainingAttempt): number | null {
  if (attempt.mode !== 'recognition' || trainingOutcome(attempt.result) !== 'success') return null
  return attempt.estimatedRecognitionExecutionMs
}
export function trainingStatistics(attempts: readonly TrainingAttempt[], filter: TrainingAttemptFilter, recentCount = 10): TrainingStatistics {
  if (!Number.isSafeInteger(recentCount) || recentCount < 0) throw new Error('Invalid recent-attempt count')
  const selected = scoped(attempts, filter)
  const supported = selected.filter((a) => trainingOutcome(a.result) !== 'unsupported')
  const successes = supported.filter((a) => trainingOutcome(a.result) === 'success')
  const dnfAttempts = supported.length - successes.length
  return {
    recordedAttempts: selected.length, unsupportedAttempts: selected.length - supported.length,
    totalAttempts: supported.length, successfulAttempts: successes.length, dnfAttempts,
    dnfPercentage: supported.length ? dnfAttempts / supported.length * 100 : null,
    raw: timeStatistics(successes.map((a) => a.rawMs)),
    estimated: filter.categoryId.endsWith(':recognition') ? timeStatistics(successes.map(storedTrainingEstimate)) : null,
    recentAttempts: recentCount ? selected.slice(-recentCount).reverse() : [],
  }
}
export function perCaseStatistics(attempts: readonly TrainingAttempt[], filter: TrainingAttemptFilter) {
  const cases = [...new Set(scoped(attempts, filter).map((a) => a.caseId))].sort(compareIds)
  return cases.map((caseId) => ({ caseId, statistics: trainingStatistics(attempts, { ...filter, caseId }) }))
}
export function perAlgorithmStatistics(attempts: readonly TrainingAttempt[], filter: TrainingAttemptFilter) {
  const algorithms = new Map<string, TrainingAlgorithmSnapshot>()
  for (const a of scoped(attempts, filter)) if (a.attribution.kind !== 'unknown') {
    const alg = a.attribution.algorithm
    algorithms.set(JSON.stringify([alg.id, alg.revision]), alg)
  }
  return [...algorithms.values()].sort((a, b) => compareIds(a.id, b.id) || a.revision - b.revision)
    .map((algorithm) => ({ algorithm: { ...algorithm }, statistics: trainingStatistics(attempts, { ...filter, algorithm }) }))
}

/** [cutoff-X days, cutoff), or the latest X recorded attempts strictly before cutoff. */
export function historicalAttempts(attempts: readonly TrainingAttempt[], filter: TrainingAttemptFilter, cutoff: number, policy: TrainingBaselinePolicy): readonly TrainingAttempt[] {
  assertTrainingTimestamp(cutoff)
  assertBaselinePolicy(policy)
  const prior = scoped(attempts, filter).filter((a) => a.createdAt < cutoff)
  return policy.kind === 'attempts' ? prior.slice(-policy.count) : prior.filter((a) => a.createdAt >= cutoff - policy.count * TRAINING_DAY_MS)
}

export interface TrainingCaseComparison {
  readonly caseId: string
  readonly status: 'value' | 'insufficient-history'
  readonly reason?: 'no-current-success' | 'no-historical-success' | 'zero-historical-mean'
  readonly currentMeanMs: number | null
  readonly historicalMeanMs: number | null
  readonly improvementPercent: number | null
}
export interface TrainingHistoryComparison {
  readonly status: 'value' | 'insufficient-history'
  readonly metric: TrainingMetric
  readonly improvementPercent: number | null
  readonly matchedCases: number
  readonly unmatchedCases: number
  readonly cases: readonly TrainingCaseComparison[]
}
/** At least one eligible successful observation on each side; no invented fallback/minimum. */
export function compareTrainingHistory(history: readonly TrainingAttempt[], current: readonly TrainingAttempt[], filter: TrainingAttemptFilter, cutoff: number, policy: TrainingBaselinePolicy, metric: TrainingMetric = 'raw'): TrainingHistoryComparison {
  if (metric === 'estimated' && !filter.categoryId.endsWith(':recognition')) throw new Error('Execution has no estimated series')
  assertTrainingTimestamp(cutoff)
  assertBaselinePolicy(policy)
  const currentScope = scoped(current, filter).filter((a) => a.createdAt >= cutoff)
  const cases = [...new Set(currentScope.map((a) => a.caseId))].sort(compareIds).map((caseId): TrainingCaseComparison => {
    const query = { ...filter, caseId }
    const now = trainingStatistics(currentScope, query)
    const before = trainingStatistics(historicalAttempts(history, query, cutoff, policy), query)
    const currentMeanMs = (metric === 'raw' ? now.raw : now.estimated)?.meanMs ?? null
    const historicalMeanMs = (metric === 'raw' ? before.raw : before.estimated)?.meanMs ?? null
    const reason = currentMeanMs === null ? 'no-current-success' : historicalMeanMs === null ? 'no-historical-success' : historicalMeanMs === 0 ? 'zero-historical-mean' : undefined
    return { caseId, status: reason ? 'insufficient-history' : 'value', ...(reason ? { reason } : {}), currentMeanMs, historicalMeanMs,
      improvementPercent: reason ? null : (historicalMeanMs! - currentMeanMs!) / historicalMeanMs! * 100 }
  })
  const values = cases.flatMap((c) => c.improvementPercent === null ? [] : [c.improvementPercent])
  return { status: values.length ? 'value' : 'insufficient-history', metric,
    improvementPercent: values.length ? values.reduce((s, v) => s + v / values.length, 0) : null,
    matchedCases: values.length, unmatchedCases: cases.length - values.length, cases }
}

export type TrainingRollingAverage =
  | { readonly status: 'value'; readonly ms: number; readonly trimCount: number }
  | { readonly status: 'dnf' | 'insufficient-history' | 'insufficient-window' | 'unavailable-estimate' | 'unsupported-result' }
/** Small windows whose exact symmetric ceiling trim empties them have no average. */
export function trainingRollingAverage(attempts: readonly TrainingAttempt[], filter: TrainingAttemptFilter, size: number, trimPercent = 5, metric: TrainingMetric = 'raw'): TrainingRollingAverage {
  assertPositiveInteger(size)
  assertTrimPercent(trimPercent)
  if (metric === 'estimated' && !filter.categoryId.endsWith(':recognition')) throw new Error('Execution has no estimated series')
  return evaluateTrainingWindow(scoped(attempts, filter).slice(-size), size, trimPercent, metric)
}

function evaluateTrainingWindow(selected: readonly TrainingAttempt[], size: number, trimPercent: number, metric: TrainingMetric): TrainingRollingAverage {
  const trimCount = Math.ceil(size * trimPercent / 100)
  if (selected.length < size) return { status: 'insufficient-history' }
  if (trimCount * 2 >= size) return { status: 'insufficient-window' }
  if (selected.some((a) => trainingOutcome(a.result) === 'unsupported')) return { status: 'unsupported-result' }
  const dnfs = selected.filter((a) => trainingOutcome(a.result) === 'dnf').length
  if (dnfs > trimCount) return { status: 'dnf' }
  const successes = selected.filter((a) => trainingOutcome(a.result) === 'success')
  const times = successes.map((a) => metric === 'raw' ? a.rawMs : storedTrainingEstimate(a))
  if (times.some((ms) => ms === null)) return { status: 'unavailable-estimate' }
  const sorted = (times as number[]).sort((a, b) => a - b)
  const counted = sorted.slice(trimCount, sorted.length - (trimCount - dnfs))
  return { status: 'value', ms: counted.reduce((sum, v) => sum + v / counted.length, 0), trimCount }
}

export interface TrainingTimingWindow {
  readonly result: TrainingRollingAverage
  /** End-exclusive index in the supplied chronological category series. */
  readonly end: number
}

/**
 * Current and fastest finite windows use the same rules as the Phase 3B rolling
 * average. Single and mo3 are untrimmed. The earliest equal best stays selected.
 */
export function trainingTimingWindows(
  sorted: readonly TrainingAttempt[], size: number, trimPercent: number, metric: TrainingMetric,
  includeBest = true,
): { current: TrainingTimingWindow; best: TrainingTimingWindow | null } {
  const current = { result: evaluateTrainingWindow(sorted.slice(-size), size, trimPercent, metric), end: sorted.length }
  let best: TrainingTimingWindow | null = null
  if (includeBest) {
    for (let end = size; end <= sorted.length; end++) {
      const result = end === sorted.length ? current.result : evaluateTrainingWindow(sorted.slice(end - size, end), size, trimPercent, metric)
      if (result.status === 'value' && (best === null || (best.result.status === 'value' && result.ms < best.result.ms))) {
        best = { result, end }
      }
    }
  }
  return { current, best }
}
