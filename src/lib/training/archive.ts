import { trainingReportComparison } from './reports'
import type { TrainingData, TrainingMode, TrainingSetId, TrainingVisit } from './types'

export interface TrainingArchiveFilters {
  set: TrainingSetId | 'all'
  mode: TrainingMode | 'all'
  since?: number
}

export function trainingArchiveVisits(data: TrainingData, filters?: TrainingArchiveFilters): TrainingVisit[] {
  return data.visits.filter(visit => visit.endedAt !== null && (!visit.session || visit.attemptIds.length > 0) &&
    (!filters || ((filters.since === undefined || visit.startedAt >= filters.since) && visit.categoryIds.some(category =>
      (filters.set === 'all' || category.startsWith(`${filters.set}:`)) &&
      (filters.mode === 'all' || category.endsWith(`:${filters.mode}`)),
    ))),
  ).sort((a, b) => b.startedAt - a.startedAt || (a.id < b.id ? -1 : a.id === b.id ? 0 : 1))
}

export function archivedTrainingChange(data: TrainingData, visit: TrainingVisit): number | null {
  if (!visit.session || !visit.lifecycle) return null
  const attempts = data.attempts.filter(attempt => attempt.visitId === visit.id)
  return trainingReportComparison(attempts, data.attempts, visit.startedCategoryId, visit.session.cases.map(choice => choice.caseId),
    visit.startedAt, visit.lifecycle.baseline).changePercent
}
