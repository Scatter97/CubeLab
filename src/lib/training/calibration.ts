/** Fixed reference-state calibration, activation decisions and immutable estimates. No UI. */
import { OLL_INSERTION_INVERSE, PLL_PRECURSOR_INVERSE } from './cube3'
import { STANDARD_CASE_BY_ID } from './catalog/standardCases'
import { assertTrainingData, validateTrainingCalibration } from './schema'
import { assertTrainingDomainSettings, assertTrainingTimestamp, TRAINING_DAY_MS } from './settings'
import { trainingOutcome } from './results'
import { TRAINING_CATEGORIES, TRAINING_PRECURSORS, type TrainingAttemptResult, type TrainingCalibration, type TrainingCalibrationSnapshot, type TrainingCategoryId, type TrainingData, type TrainingDomainSettings, type TrainingSetId } from './types'

export const CALIBRATION_PROTOCOLS = Object.freeze({
  oll: Object.freeze({ version: 'fixed-inverse-precursor:v1', scramble: OLL_INSERTION_INVERSE, precursor: TRAINING_PRECURSORS.oll.notation }),
  pll: Object.freeze({ version: 'fixed-inverse-precursor:v1', scramble: PLL_PRECURSOR_INVERSE, precursor: TRAINING_PRECURSORS.pll.notation }),
})
export interface CalibrationDraft {
  readonly setId: TrainingSetId
  readonly status: 'collecting' | 'complete' | 'cancelled'
  readonly samplesMs: readonly number[]
  readonly invalidSampleCount: number
}
export function beginCalibration(setId: TrainingSetId): CalibrationDraft {
  if (setId !== 'oll' && setId !== 'pll') throw new Error('Unknown Training set')
  return { setId, status: 'collecting', samplesMs: [], invalidSampleCount: 0 }
}
export function addCalibrationSample(draft: CalibrationDraft, ms: number, successful = true): CalibrationDraft {
  if (draft.status !== 'collecting' || draft.samplesMs.length >= 7) throw new Error('Calibration is not collecting samples')
  if (!successful || !Number.isFinite(ms) || ms <= 0) return { ...draft, invalidSampleCount: draft.invalidSampleCount + 1 }
  const samplesMs = [...draft.samplesMs, ms]
  return { ...draft, samplesMs, status: samplesMs.length === 7 ? 'complete' : 'collecting' }
}
export function cancelCalibration(draft: CalibrationDraft): CalibrationDraft {
  return { ...draft, samplesMs: [...draft.samplesMs], status: 'cancelled' }
}

export function isUsableTrainingCalibration(value: TrainingCalibrationSnapshot | null, setId: TrainingSetId, at: number): value is TrainingCalibrationSnapshot {
  if (value === null) return false
  try {
    validateTrainingCalibration(value)
    return value.protocol === 'fixed-inverse-precursor:v1' && value.setId === setId && value.measuredAt <= at && value.samplesMs.every((ms) => ms > 0) &&
      value.medianMs === [...value.samplesMs].sort((a, b) => a - b)[3]
  } catch { return false }
}

/** Seed legacy totals conservatively, including captured offsets. Deletion never lowers a persisted total. */
export function recognitionCount(data: TrainingData, setId: TrainingSetId): number {
  const attempts = data.attempts.filter((a) => a.setId === setId && a.mode === 'recognition' && trainingOutcome(a.result) !== 'unsupported')
  let total = Math.max(data.recognitionCounts?.[setId] ?? 0, attempts.length)
  const timestamps = attempts.map((a) => a.createdAt).sort((a, b) => a - b)
  const atCalibrationTime = new Map<string, number>()
  for (const a of attempts) if (a.calibration && a.createdAt === a.calibration.measuredAt) {
    const key = JSON.stringify([a.calibration.id, a.createdAt])
    atCalibrationTime.set(key, (atCalibrationTime.get(key) ?? 0) + 1)
  }
  const snapshots = new Map([...data.calibrations, ...attempts.flatMap((a) => a.calibration ? [a.calibration] : [])]
    .filter((c) => c.setId === setId).map((c) => [JSON.stringify([c.id, c.measuredAt, c.recognitionAttemptsAtMeasurement]), c]))
  for (const c of snapshots.values()) {
    let low = 0, high = timestamps.length
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      if (timestamps[mid]! <= c.measuredAt) low = mid + 1
      else high = mid
    }
    total = Math.max(total, c.recognitionAttemptsAtMeasurement + timestamps.length - low + (atCalibrationTime.get(JSON.stringify([c.id, c.measuredAt])) ?? 0))
  }
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Recognition counter exceeds safe range')
  return total
}

export function completeCalibration(data: TrainingData, draft: CalibrationDraft, input: { readonly id: string; readonly at: number; readonly source?: TrainingCalibration['source'] }): TrainingData {
  assertTrainingData(data)
  assertTrainingTimestamp(input.at)
  if (draft.status !== 'complete' || draft.samplesMs.length !== 7 || !draft.samplesMs.every((n) => Number.isFinite(n) && n > 0)) throw new Error('Exactly seven valid samples required')
  if (data.calibrations.some((c) => c.id === input.id)) throw new Error('Calibration ID already recorded')
  const setId = draft.setId
  if (data.calibrations.some((c) => c.setId === setId && c.measuredAt > input.at) || data.attempts.some((a) => a.setId === setId && a.createdAt > input.at)) throw new Error('Calibration cannot predate recorded set activity')
  const preferences = data.preferences.sets[setId].recognition
  const c: TrainingCalibration = {
    version: 1, protocol: 'fixed-inverse-precursor:v1', id: input.id, setId,
    precursorId: TRAINING_PRECURSORS[setId].id, precursorNotation: TRAINING_PRECURSORS[setId].notation,
    samplesMs: [...draft.samplesMs] as unknown as TrainingCalibration['samplesMs'], medianMs: [...draft.samplesMs].sort((a, b) => a - b)[3]!,
    measuredAt: input.at, recognitionAttemptsAtMeasurement: recognitionCount(data, setId),
    renewal: { days: preferences.renewalDays, recognitionAttempts: preferences.renewalAttempts },
    source: input.source ?? (data.calibrations.some((c) => c.setId === setId) ? 'manual' : 'initial'), invalidSampleCount: draft.invalidSampleCount,
  }
  const next = { ...data, calibrations: [...data.calibrations, c], recognitionCounts: { oll: recognitionCount(data, 'oll'), pll: recognitionCount(data, 'pll') } }
  assertTrainingData(next)
  return next
}

export type CalibrationState =
  | { readonly status: 'missing-calibration' | 'invalid-calibration' }
  | { readonly status: 'valid' | 'renewal-due'; readonly daysDue: boolean; readonly attemptsDue: boolean }
export function calibrationState(calibration: TrainingCalibrationSnapshot | null, setId: TrainingSetId, now: number, count: number): CalibrationState {
  assertTrainingTimestamp(now)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid recognition count')
  if (calibration === null) return { status: 'missing-calibration' }
  if (!isUsableTrainingCalibration(calibration, setId, now) || count < calibration.recognitionAttemptsAtMeasurement) return { status: 'invalid-calibration' }
  const daysDue = (now - calibration.measuredAt) / TRAINING_DAY_MS >= calibration.renewal.days
  const attemptsDue = count - calibration.recognitionAttemptsAtMeasurement >= calibration.renewal.recognitionAttempts
  return { status: daysDue || attemptsDue ? 'renewal-due' : 'valid', daysDue, attemptsDue }
}

export type TrainingActivationDecision =
  | { readonly state: 'mode-selection' | 'continue-running' }
  | { readonly state: 'invalid-selection'; readonly reason: 'unknown-category' | 'wrong-or-disabled-case' | 'recognition-needs-two-cases' | 'execution-needs-one-case' }
  | { readonly state: 'calibration-required'; readonly reason: 'missing-calibration' | 'invalid-calibration' | 'renewal-due' }
  | { readonly state: 'ready'; readonly renewalRecommended: boolean }

type ModeSelectionInput = {
  readonly event: 'select-mode' | 'begin-attempt' | 'cancel-calibration'
  readonly categoryId: TrainingCategoryId
  readonly caseIds: readonly string[]
  readonly enabledCaseIds?: readonly string[]
  readonly calibration: TrainingCalibrationSnapshot | null
  readonly now: number
  readonly recognitionCount: number
  readonly settings: TrainingDomainSettings
  readonly attemptRunning?: boolean
}
/** Mode selection/next-attempt gates only. Navigation/opening cannot trigger calibration. */
export function decideTrainingActivation(input: { readonly event: 'open-training' } | ModeSelectionInput): TrainingActivationDecision {
  if (input.event === 'open-training') return { state: 'mode-selection' }
  if (input.attemptRunning) return { state: 'continue-running' }
  if (input.event === 'cancel-calibration') return { state: 'mode-selection' }
  assertTrainingDomainSettings(input.settings)
  if (!(TRAINING_CATEGORIES as readonly string[]).includes(input.categoryId)) return { state: 'invalid-selection', reason: 'unknown-category' }
  const setId = input.categoryId.startsWith('oll:') ? 'oll' : 'pll'
  const recognition = input.categoryId.endsWith(':recognition')
  if (input.caseIds.some((id) => STANDARD_CASE_BY_ID.get(id)?.setId !== setId || (input.enabledCaseIds && !input.enabledCaseIds.includes(id)))) return { state: 'invalid-selection', reason: 'wrong-or-disabled-case' }
  if (new Set(input.caseIds).size < (recognition ? 2 : 1)) return { state: 'invalid-selection', reason: recognition ? 'recognition-needs-two-cases' : 'execution-needs-one-case' }
  if (!recognition) return { state: 'ready', renewalRecommended: false }
  const state = calibrationState(input.calibration, setId, input.now, input.recognitionCount)
  if (state.status === 'missing-calibration' || state.status === 'invalid-calibration') return { state: 'calibration-required', reason: state.status }
  if (state.status === 'renewal-due' && input.settings.requireRecalibrationWhenDue) return { state: 'calibration-required', reason: state.status }
  return { state: 'ready', renewalRecommended: state.status === 'renewal-due' }
}

export type RecognitionEstimate = { readonly status: 'valid' | 'renewal-due' | 'missing-calibration' | 'invalid-calibration' | 'below-calibration' | 'dnf' | 'unsupported-result'; readonly estimateMs: number | null }
export function estimateRecognitionTime(rawMs: number, result: TrainingAttemptResult, calibration: TrainingCalibrationSnapshot | null, setId: TrainingSetId, at: number, count: number): RecognitionEstimate {
  if (!Number.isFinite(rawMs) || rawMs < 0) throw new Error('Invalid raw Training duration')
  const outcome = trainingOutcome(result)
  if (outcome !== 'success') return { status: outcome === 'dnf' ? 'dnf' : 'unsupported-result', estimateMs: null }
  const state = calibrationState(calibration, setId, at, count)
  if (state.status === 'missing-calibration' || state.status === 'invalid-calibration') return { status: state.status, estimateMs: null }
  if (rawMs < calibration!.medianMs) return { status: 'below-calibration', estimateMs: null }
  return { status: state.status, estimateMs: rawMs - calibration!.medianMs }
}

/** Select the latest recorded calibration deterministically; do not hide invalid current records. */
export function latestTrainingCalibration(data: TrainingData, setId: TrainingSetId): TrainingCalibration | null {
  return data.calibrations.reduce<TrainingCalibration | null>((latest, c) => c.setId === setId && (!latest || c.measuredAt >= latest.measuredAt) ? c : latest, null)
}
