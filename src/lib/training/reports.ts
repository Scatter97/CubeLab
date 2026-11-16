/** Reports are derived from retained history. No frozen aggregates are persisted. */
import { isUsableTrainingCalibration } from './calibration'
import { trainingOutcome } from './results'
import { compareTrainingAttempts, historicalAttempts, perAlgorithmStatistics, perCaseStatistics, trainingStatistics } from './stats'
import { assertTrainingTimestamp } from './settings'
import type { TrainingAttempt, TrainingBaselinePolicy, TrainingCaseId, TrainingCategoryId, TrainingData } from './types'

function measuredSuccess(attempt: TrainingAttempt) {
  return trainingOutcome(attempt.result) === 'success'
}

export function trainingReportComparison(
  current: readonly TrainingAttempt[], history: readonly TrainingAttempt[], categoryId: TrainingCategoryId,
  caseIds: readonly TrainingCaseId[], cutoff: number, policy: TrainingBaselinePolicy,
) {
  const minimum = caseIds.length === 1 ? 5 : 3
  const requiredCases = caseIds.length === 1 ? 1 : 3
  const previousByCase = new Map<TrainingCaseId, TrainingAttempt[]>()
  const currentByCase = new Map<TrainingCaseId, TrainingAttempt[]>()
  for (const attempt of history) {
    if (attempt.categoryId !== categoryId || attempt.createdAt >= cutoff) continue
    const group = previousByCase.get(attempt.caseId)
    if (group) group.push(attempt)
    else previousByCase.set(attempt.caseId, [attempt])
  }
  for (const attempt of current) {
    if (attempt.categoryId !== categoryId || !measuredSuccess(attempt)) continue
    const group = currentByCase.get(attempt.caseId)
    if (group) group.push(attempt)
    else currentByCase.set(attempt.caseId, [attempt])
  }
  const cases = caseIds.map(caseId => {
    const before = historicalAttempts(previousByCase.get(caseId) ?? [], { categoryId, caseId }, cutoff, policy).filter(measuredSuccess)
    const after = currentByCase.get(caseId) ?? []
    const priorMean = mean(before.map(attempt => attempt.rawMs))
    const currentMean = mean(after.map(attempt => attempt.rawMs))
    const changePercent = before.length >= minimum && after.length >= minimum && priorMean !== null && priorMean > 0 && currentMean !== null
      ? (currentMean - priorMean) / priorMean * 100 : null
    return { caseId, historicalSuccesses: before.length, currentSuccesses: after.length, changePercent }
  })
  const eligible = cases.flatMap(row => row.changePercent === null ? [] : [row.changePercent])
  return {
    cases, minimum, requiredCases, matchedCases: eligible.length,
    changePercent: eligible.length >= requiredCases ? mean(eligible) : null,
  }
}

function mean(values: readonly number[]) {
  return values.length ? values.reduce((sum, value) => sum + value / values.length, 0) : null
}

function executionMedian(values: number[]) {
  if (values.length < 3) return null
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return values.length % 2 ? values[middle]! : values[middle - 1]! / 2 + values[middle]! / 2
}

function reportPoints(attempts: readonly TrainingAttempt[], history: readonly TrainingAttempt[], cutoff: number, policy?: TrainingBaselinePolicy) {
  const executionByCase = new Map<TrainingCaseId, readonly TrainingAttempt[]>()
  const medians = new Map<string, number | null>()
  return attempts.map(attempt => {
    const outcome = trainingOutcome(attempt.result)
    const measuredMs = outcome === 'success' ? attempt.rawMs : null
    let combinedMs: number | null = null
    let executionMs: number | null = attempt.mode === 'execution' ? measuredMs : null
    let recognitionMs: number | null = null
    if (attempt.mode === 'recognition' && measuredMs !== null &&
      isUsableTrainingCalibration(attempt.calibration, attempt.setId, attempt.createdAt) && measuredMs >= attempt.calibration.medianMs) {
      combinedMs = measuredMs - attempt.calibration.medianMs
      if (policy && attempt.attribution.kind !== 'unknown') {
        const { id, revision } = attempt.attribution.algorithm
        const key = JSON.stringify([attempt.caseId, id, revision])
        if (!medians.has(key)) {
          let prior = executionByCase.get(attempt.caseId)
          if (!prior) {
            prior = historicalAttempts(history, { categoryId: `${attempt.setId}:execution`, caseId: attempt.caseId }, cutoff, policy)
            executionByCase.set(attempt.caseId, prior)
          }
          medians.set(key, executionMedian(prior.flatMap(row =>
            measuredSuccess(row) && row.attribution.kind !== 'unknown' &&
            row.attribution.algorithm.id === id && row.attribution.algorithm.revision === revision ? [row.rawMs] : [],
          )))
        }
        const estimate = medians.get(key)
        if (estimate != null && estimate <= combinedMs) {
          executionMs = estimate
          recognitionMs = combinedMs - estimate
        }
      }
    }
    return { id: attempt.id, caseId: attempt.caseId, outcome, measuredMs, combinedMs, executionMs, recognitionMs }
  })
}

export function calculateTrainingReport(data: TrainingData, visitId: string, cutoff?: number) {
  const visit = data.visits.find(v => v.id === visitId)
  if (!visit) return { status: 'missing-visit' as const, visitId, categories: null }
  const end = visit.endedAt === null ? cutoff : Math.min(visit.endedAt, cutoff ?? visit.endedAt)
  if (end === undefined) return { status: visit.lifecycle ? 'cutoff-required' as const : 'baseline-policy-unavailable' as const, visitId, categories: null }
  assertTrainingTimestamp(end)
  if (end < visit.startedAt) throw new Error('Report cutoff predates visit')
  const ids = new Set(visit.attemptIds)
  const attempts = data.attempts.filter(a => ids.has(a.id) && a.visitId === visit.id && a.createdAt >= visit.startedAt && a.createdAt <= end)
    .sort(compareTrainingAttempts)
  const baseline = visit.lifecycle?.baseline
  const categories = visit.categoryIds.map(categoryId => {
    const filter = { categoryId }
    const current = attempts.filter(attempt => attempt.categoryId === categoryId)
    const caseIds = visit.session?.cases.map(choice => choice.caseId) ?? [...new Set(current.map(attempt => attempt.caseId))]
    const points = reportPoints(current, data.attempts, visit.startedAt, baseline)
    const timing = (key: 'combinedMs' | 'executionMs' | 'recognitionMs') => {
      const values = points.flatMap(point => point[key] === null ? [] : [point[key]])
      return { count: values.length, meanMs: mean(values) }
    }
    return {
      categoryId, statistics: trainingStatistics(current, filter),
      cases: perCaseStatistics(current, filter), algorithms: perAlgorithmStatistics(current, filter),
      comparison: baseline ? trainingReportComparison(current, data.attempts, categoryId, caseIds, visit.startedAt, baseline) : null,
      points, timing: { combined: timing('combinedMs'), execution: timing('executionMs'), recognition: timing('recognitionMs') },
    }
  })
  const status = !baseline ? 'baseline-policy-unavailable' : attempts.length ? 'value' : 'empty'
  return { status, visitId, cutoff: end, baseline, categories }
}
