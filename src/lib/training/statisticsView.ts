import { compareTrainingHistory, type TrainingMetric } from './stats'
import type { TrainingAttempt, TrainingCategoryId, TrainingVisit } from './types'

export function trainingCategoryLabel(category: TrainingCategoryId): string {
  const [setId, mode] = category.split(':')
  return `${setId!.toUpperCase()} ${mode === 'recognition' ? 'recognition + execution' : 'execution'}`
}

export function trainingPercentage(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`
}

export function latestCategoryVisit(visits: readonly TrainingVisit[], category: TrainingCategoryId) {
  return visits.findLast(visit => visit.categoryIds.includes(category))
}

export function compareTrainingVisit(
  attempts: readonly TrainingAttempt[],
  visit: TrainingVisit | undefined,
  category: TrainingCategoryId,
  metric: TrainingMetric,
) {
  if (!visit?.lifecycle) return null
  const ids = new Set(visit.attemptIds)
  const current = attempts.filter(attempt => ids.has(attempt.id) && attempt.visitId === visit.id && (visit.endedAt === null || attempt.createdAt <= visit.endedAt))
  return compareTrainingHistory(attempts, current, { categoryId: category }, visit.startedAt, visit.lifecycle.baseline, metric)
}
