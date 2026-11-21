/** Detached Training records and explicit corrections; no application side effects. */
import { createId } from '../id'
import { estimateRecognitionTime, isUsableTrainingCalibration, recognitionCount } from './calibration'
import { DEFAULT_TRAINING_DOMAIN_SETTINGS, assertTrainingDomainSettings } from './settings'
import { trainingOutcome } from './results'
import type { TrainingDomainSettings } from './types'
import { assertTrainingData, assertTrainingJson, validateTrainingAttempt, validateTrainingVisit } from './schema'
import { TRAINING_CATEGORIES, TRAINING_PRECURSORS, type TrainingAlgorithmSnapshot, type TrainingAttempt, type TrainingCompletedResult, type TrainingCalibrationSnapshot, type TrainingCategoryId, type TrainingData, type TrainingReportDestination, type TrainingSetupSnapshot, type TrainingVisit, type TrainingVisitEndReason } from './types'

function detached<T>(value: T): T {
  assertTrainingJson(value)
  return JSON.parse(JSON.stringify(value)) as T
}

export interface CreateTrainingAttemptInput {
  readonly id?: string
  readonly setup: TrainingSetupSnapshot
  readonly visitId: string
  /** Duration captured by the authoritative monotonic timer, never the display. */
  readonly rawMs: number
  readonly createdAt?: number
  readonly result?: TrainingCompletedResult
  readonly preferredAlgorithm?: TrainingAlgorithmSnapshot | null
  readonly algorithmTracking?: boolean
  readonly calibration?: TrainingCalibrationSnapshot | null
  readonly estimatedRecognitionExecutionMs?: number | null
}

/** OLL stops manually after orientation (PLL may remain); PLL stops after PLL/AUF. */
export function createTrainingAttempt(input: CreateTrainingAttemptInput): TrainingAttempt {
  const g = input.setup.generated
  if (g.setId !== 'oll' && g.setId !== 'pll') throw new Error('Unknown Training set')
  const preferred = input.algorithmTracking === false ? null : input.preferredAlgorithm ?? null
  const result = input.result ?? { status: 'valid', penalty: 'none' } as const
  if (trainingOutcome(result) === 'unsupported') throw new Error('Training supports only success or DNF; no +2 or invalid attempts')
  if ('inspection' in input || 'inspectionMs' in input) throw new Error('Training has no inspection')
  const createdAt = input.createdAt ?? Date.now()
  const c = input.calibration ?? null
  if (g.mode === 'recognition' && !isUsableTrainingCalibration(c, g.setId, createdAt)) throw new Error('Recognition needs valid calibration')
  const estimate = g.mode === 'recognition' ? estimateRecognitionTime(input.rawMs, result, c, g.setId, createdAt, c!.recognitionAttemptsAtMeasurement) : null
  if (input.estimatedRecognitionExecutionMs !== undefined && input.estimatedRecognitionExecutionMs !== estimate?.estimateMs && !(estimate === null && input.estimatedRecognitionExecutionMs === null)) throw new Error('Estimate must match the captured calibration calculation')
  const record = {
    version: 1, rulesVersion: 1, id: input.id ?? createId(), setId: g.setId, mode: g.mode,
    categoryId: `${g.setId}:${g.mode}`, caseId: g.caseId,
    createdAt, visitId: input.visitId, rawMs: input.rawMs, result,
    preferredAlgorithmAtStart: preferred,
    ...(input.algorithmTracking === undefined ? {} : { algorithmTracking: input.algorithmTracking }),
    attribution: preferred ? { kind: 'assumed-preferred', algorithm: preferred } : { kind: 'unknown', markedAt: null },
    setup: input.setup,
    precursorId: g.mode === 'recognition' ? TRAINING_PRECURSORS[g.setId].id : null,
    calibration: input.calibration ?? null,
    estimatedRecognitionExecutionMs: estimate?.estimateMs ?? null,
    ...(estimate?.status === 'below-calibration' || estimate?.status === 'dnf' ? { estimateUnavailableReason: estimate.status } : {}),
  }
  validateTrainingAttempt(record)
  return detached(record) as TrainingAttempt
}

/** Explicit correction only; the original preferred assumption remains captured. */
export function correctTrainingAttribution(attempt: TrainingAttempt, algorithm: TrainingAlgorithmSnapshot | null, at = Date.now()): TrainingAttempt {
  // Algorithm tracking is retired. Case-only attempts never gain attribution.
  if (attempt.algorithmTracking === false) return attempt
  const record = {
    ...attempt,
    attribution: algorithm ? { kind: 'user-corrected', algorithm, correctedAt: at } : { kind: 'unknown', markedAt: at },
  }
  validateTrainingAttempt(record)
  return detached(record) as TrainingAttempt
}

export function createTrainingVisit(categoryId: TrainingCategoryId, at = Date.now(), id = createId(), settings: TrainingDomainSettings = DEFAULT_TRAINING_DOMAIN_SETTINGS): TrainingVisit {
  assertTrainingDomainSettings(settings)
  const visit: TrainingVisit = {
    version: 1, id, startedAt: at, endedAt: null, startedCategoryId: categoryId,
    categoryIds: [categoryId], attemptIds: [], summaryId: null,
    lifecycle: { version: 1, lastActivityAt: at, baseline: { ...settings.baseline }, inactivityMinutes: settings.inactivityMinutes, endReason: null, reportPending: false },
  }
  validateTrainingVisit(visit)
  return visit
}

/** Update both directions of the relationship in one candidate storage record. */
export function appendTrainingAttempt(data: TrainingData, attempt: TrainingAttempt): TrainingData {
  assertTrainingData(data)
  validateTrainingAttempt(attempt)
  if (data.attempts.some((a) => a.id === attempt.id)) throw new Error('Duplicate Training attempt ID')
  const visit = data.visits.find((v) => v.id === attempt.visitId)
  if (!visit || visit.endedAt !== null || data.activeVisitId !== visit.id) throw new Error('Attempt needs the current open practice visit')
  if (visit.lifecycle && visit.startedCategoryId !== attempt.categoryId) throw new Error('Category switch needs a new practice visit')
  if (attempt.rulesVersion !== 1) throw new Error('New attempts must use current Training rules')
  const counts = { oll: recognitionCount(data, 'oll'), pll: recognitionCount(data, 'pll') }
  if (attempt.mode === 'recognition' && trainingOutcome(attempt.result) !== 'unsupported') counts[attempt.setId]++
  const next: TrainingData = {
    ...data, recognitionCounts: counts, attempts: [...data.attempts, detached(attempt)],
    visits: data.visits.map((v) => v.id === visit.id ? {
      ...v, attemptIds: [...v.attemptIds, attempt.id],
      ...(v.lifecycle ? { lifecycle: { ...v.lifecycle, lastActivityAt: Math.max(v.lifecycle.lastActivityAt, attempt.createdAt) } } : {}),
      categoryIds: v.categoryIds.includes(attempt.categoryId) ? v.categoryIds : [...v.categoryIds, attempt.categoryId],
    } : v),
  }
  assertTrainingData(next)
  return next
}

export function finishTrainingVisit(data: TrainingData, visitId: string, at = Date.now(), reason: TrainingVisitEndReason = 'navigation', reportDestination?: TrainingReportDestination): TrainingData {
  assertTrainingData(data)
  if (data.activeVisitId !== visitId) throw new Error('Only the active practice visit can finish')
  const next: TrainingData = {
    ...data, activeVisitId: null,
    visits: data.visits.map((v) => {
      if (v.id !== visitId) return v
      if (!v.lifecycle) return { ...v, endedAt: at }
      const reportPending = v.session ? v.attemptIds.length > 0 : data.attempts.some((a) => a.visitId === v.id && trainingOutcome(a.result) !== 'unsupported')
      return { ...v, endedAt: at, lifecycle: { ...v.lifecycle, endReason: reason, reportPending,
        ...(v.session && reportPending && reportDestination ? { reportDestination } : {}),
      } }
    }),
  }
  assertTrainingData(next)
  return next
}

export function trainingVisitElapsed(visit: TrainingVisit): number {
  return (visit.endedAt ?? visit.lifecycle?.lastActivityAt ?? visit.startedAt) - visit.startedAt - (visit.lifecycle?.pausedMs ?? 0)
}

export function removeArchivedTrainingSession(data: TrainingData, id: string): TrainingData | null {
  const visit = data.visits.find(item => item.id === id)
  if (!visit?.session || visit.endedAt === null || visit.lifecycle?.reportPending || !visit.attemptIds.length) return null
  return {
    ...data,
    recognitionCounts: { ...data.recognitionCounts, oll: recognitionCount(data, 'oll'), pll: recognitionCount(data, 'pll') },
    visits: data.visits.filter(item => item.id !== id),
    attempts: data.attempts.filter(attempt => attempt.visitId !== id),
  }
}

export interface TrainingAttemptFilter {
  /** Required so callers cannot accidentally mix the four statistics categories. */
  readonly categoryId: TrainingCategoryId
  readonly caseId?: string
  readonly visitId?: string
  readonly algorithm?: Pick<TrainingAlgorithmSnapshot, 'id' | 'revision'>
}

export function selectTrainingAttempts(data: Pick<TrainingData, 'attempts'>, filter: TrainingAttemptFilter): readonly TrainingAttempt[] {
  if (!(TRAINING_CATEGORIES as readonly string[]).includes(filter.categoryId)) throw new Error('Training queries require one known category')
  return data.attempts.filter((a) =>
    a.categoryId === filter.categoryId &&
    (filter.caseId === undefined || a.caseId === filter.caseId) &&
    (filter.visitId === undefined || a.visitId === filter.visitId) &&
    (filter.algorithm === undefined || (a.attribution.kind !== 'unknown' && a.attribution.algorithm.id === filter.algorithm.id && a.attribution.algorithm.revision === filter.algorithm.revision)),
  )
}

/** Explicit user result correction. A DNF made successful has no backfilled estimate. */
export function correctTrainingResult(attempt: TrainingAttempt, outcome: 'success' | 'dnf', at: number): TrainingAttempt {
  if (trainingOutcome(attempt.result) === 'unsupported') throw new Error('Unsupported legacy results need a separate explicit migration')
  if (at < (attempt.resultCorrectedAt ?? attempt.createdAt)) throw new Error('Result correction predates the recorded result')
  if (outcome !== 'success' && outcome !== 'dnf') throw new Error('Training has no penalties')
  if (trainingOutcome(attempt.result) === outcome) return detached(attempt)
  const record: TrainingAttempt = {
    ...attempt, result: { status: 'valid', penalty: outcome === 'success' ? 'none' : 'dnf' }, resultCorrectedAt: at,
    estimatedRecognitionExecutionMs: null,
  }
  const { estimateUnavailableReason: _reason, ...base } = record
  const next = attempt.mode === 'recognition' ? { ...base, estimateUnavailableReason: outcome === 'dnf' ? 'dnf' as const : 'not-recorded' as const } : base
  validateTrainingAttempt(next)
  return detached(next)
}
