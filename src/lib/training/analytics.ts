import { STANDARD_CASES } from './catalog/standardCases'
import { trainingAlgorithmKey } from './algorithmSelection'
import { trainingStatistics } from './stats'
import type { TrainingAlgorithmSnapshot, TrainingAttempt, TrainingCategoryId } from './types'

export function trainingPracticeDays(attempts: readonly TrainingAttempt[], categoryId: TrainingCategoryId) {
  const byDay = new Map<number, TrainingAttempt[]>()
  for (const attempt of attempts) {
    const date = new Date(attempt.createdAt)
    date.setHours(0, 0, 0, 0)
    const key = date.getTime()
    const day = byDay.get(key)
    if (day) day.push(attempt)
    else byDay.set(key, [attempt])
  }
  return Array.from(byDay.entries()).sort(([left], [right]) => left - right).map(([date, day]) => ({
    date, count: day.length, meanMs: trainingStatistics(day, { categoryId }, 0).raw.meanMs,
  }))
}

function revisionStatistics(attempts: readonly TrainingAttempt[], categoryId: TrainingCategoryId) {
  const revisions = new Map<string, { algorithm: TrainingAlgorithmSnapshot; attempts: TrainingAttempt[] }>()
  for (const attempt of attempts) {
    if (attempt.algorithmTracking === false || attempt.attribution.kind === 'unknown') continue
    const algorithm = attempt.attribution.algorithm
    const key = trainingAlgorithmKey(algorithm)
    const group = revisions.get(key)
    if (!group) {
      revisions.set(key, { algorithm, attempts: [attempt] })
    } else {
      group.attempts.push(attempt)
      if (group.algorithm.notation === null && algorithm.notation !== null) group.algorithm = algorithm
    }
  }
  return Array.from(revisions, ([key, group]) => ({
    key, ...group, statistics: trainingStatistics(group.attempts, { categoryId }, 0),
  }))
}

export function buildTrainingAnalytics(attempts: readonly TrainingAttempt[], categoryId: TrainingCategoryId, since?: number) {
  const filter = { categoryId }
  const selected = attempts.filter(attempt => attempt.categoryId === categoryId && (since === undefined || attempt.createdAt >= since))
  const byCase = new Map<string, TrainingAttempt[]>()
  for (const attempt of selected) {
    const group = byCase.get(attempt.caseId)
    if (group) group.push(attempt)
    else byCase.set(attempt.caseId, [attempt])
  }
  const set = categoryId.startsWith('oll:') ? 'oll' : 'pll'
  return {
    statistics: trainingStatistics(selected, filter, 0),
    cases: STANDARD_CASES.filter(item => item.setId === set).map(item => {
      const attempts = byCase.get(item.id) ?? []
      return { caseId: item.id, name: item.name, statistics: trainingStatistics(attempts, filter, 0), revisions: revisionStatistics(attempts, categoryId) }
    }),
    days: trainingPracticeDays(selected, categoryId),
  }
}
