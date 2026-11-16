/** Local-only foundation. No app mount, backup/sync integration or automatic writes. */
import type { StorageLike } from '../storage'
import { DEFAULT_TRAINING_DOMAIN_SETTINGS } from './settings'
import { isUsableTrainingCalibration, recognitionCount } from './calibration'
import { trainingOutcome } from './results'
import { removeArchivedTrainingSession } from './records'
import { OLL_STANDARD_CASES, PLL_NAMED_CASES } from './catalog/standardCases'
import { assertTrainingData } from './schema'
import { isSiteResetInProgress } from '../siteReset'
import type { TrainingCaseId, TrainingData, TrainingPreferences, TrainingSetPreferences } from './types'

export const TRAINING_STORAGE_KEY = 'cubelab:training:v1'
export const TRAINING_SCHEMA_VERSION = 1

function setDefaults(caseIds: readonly string[]): TrainingSetPreferences {
  return {
    enabledCaseIds: [...caseIds] as TrainingCaseId[], difficultCaseIds: [],
    includeSetupMoves: false, selectedPresetId: null,
    recognition: { renewalDays: 7, renewalAttempts: 100 },
  }
}

export function createTrainingPreferences(): TrainingPreferences {
  return {
    version: 1, selectedSetId: 'oll', domain: { ...DEFAULT_TRAINING_DOMAIN_SETTINGS, baseline: { ...DEFAULT_TRAINING_DOMAIN_SETTINGS.baseline } },
    sets: {
      oll: setDefaults(OLL_STANDARD_CASES.map((c) => c.id)),
      pll: setDefaults(PLL_NAMED_CASES.map((c) => c.id)),
    },
    preferredAlgorithms: [],
    categories: {
      'oll:execution': { recognitionMetric: 'raw' },
      'oll:recognition': { recognitionMetric: 'raw' },
      'pll:execution': { recognitionMetric: 'raw' },
      'pll:recognition': { recognitionMetric: 'raw' },
    },
    reportSettings: {},
  }
}

export function createEmptyTrainingData(): TrainingData {
  return {
    version: TRAINING_SCHEMA_VERSION, preferences: createTrainingPreferences(),
    recognitionCounts: { oll: 0, pll: 0 }, attempts: [], visits: [], presets: [], customAlgorithms: [], calibrations: [], activeVisitId: null,
  }
}

/**
 * First shipped Training schema: v1 validates and detaches without transformation.
 * There is no historical Training v0 to guess at. Named sessions add an optional
 * visit configuration, with no backfill or write while reading older visits.
 * Unknown additive JSON fields are retained; unknown schema versions fail closed.
 */
export function migrateTrainingData(value: unknown): TrainingData {
  assertTrainingData(value)
  return JSON.parse(JSON.stringify(value)) as TrainingData
}

export function deserializeTrainingData(raw: string): TrainingData {
  const value: unknown = JSON.parse(raw)
  return migrateTrainingData(value)
}

export function serializeTrainingData(data: TrainingData): string {
  assertTrainingData(data)
  return JSON.stringify(data)
}

function browserStorage(): StorageLike | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

export type TrainingLoadResult =
  | { readonly ok: true; readonly data: TrainingData; readonly raw: string | null }
  | { readonly ok: false; readonly reason: 'unavailable' | 'read' | 'invalid'; readonly error: string; readonly raw: string | null | undefined }

/** Only a genuinely absent key produces defaults; errors never return writable empty data. */
export function loadTraining(storage: StorageLike | null = browserStorage()): TrainingLoadResult {
  if (!storage) return { ok: false, reason: 'unavailable', raw: undefined, error: 'Training storage is unavailable.' }
  let raw: string | null
  try { raw = storage.getItem(TRAINING_STORAGE_KEY) } catch {
    return { ok: false, reason: 'read', raw: undefined, error: 'Training data could not be read. Original data has been kept; retry when storage recovers.' }
  }
  if (raw === null) return { ok: true, data: createEmptyTrainingData(), raw }
  try { return { ok: true, data: deserializeTrainingData(raw), raw } } catch (error) {
    return { ok: false, reason: 'invalid', raw, error: `Training data could not be validated. Original data has been kept. ${error instanceof Error ? error.message : ''}` }
  }
}

export type TrainingSaveResult =
  | { readonly ok: true; readonly raw: string }
  | { readonly ok: false; readonly reason: 'unavailable' | 'read' | 'invalid' | 'changed' | 'write'; readonly error: string }

/**
 * Call only under the existing lifetime active-tab Web Lock. This raw comparison
 * detects a changed snapshot, but is not cross-tab compare-and-swap or a lock.
 * The current bytes must still validate; supplying corrupt bytes cannot authorize
 * overwriting them. No clear/reset/repair path is exposed by this foundation.
 * Undo supplies the exact attempt captured by the controller before deletion.
 */
export function saveTraining(
  data: TrainingData,
  expectedRaw: string | null,
  storage: StorageLike | null = browserStorage(),
  restoredAttempt?: TrainingData['attempts'][number],
  archiveDeleteId?: string,
): TrainingSaveResult {
  if (isSiteResetInProgress()) {
    return {
      ok: false,
      reason: 'write',
      error: 'CubeLab is resetting local site data. Training changes were not saved.',
    }
  }
  const current = loadTraining(storage)
  if (!current.ok) return { ok: false, reason: current.reason, error: current.error }
  if (current.raw !== expectedRaw) return { ok: false, reason: 'changed', error: 'Training data changed since it was read. Reload the checked snapshot before saving.' }
  let raw: string
  try { raw = serializeTrainingData(data) } catch (error) {
    return { ok: false, reason: 'invalid', error: error instanceof Error ? error.message : 'Invalid Training data.' }
  }
  try {
    if (archiveDeleteId !== undefined) {
      const expected = removeArchivedTrainingSession(current.data, archiveDeleteId)
      if (restoredAttempt || !expected || !sameJson(data, expected)) {
        return { ok: false, reason: 'invalid', error: 'Delete only the selected archived session and its attempts.' }
      }
      return writeTrainingSnapshot(storage!, raw)
    }
    const previousAttempts = new Map(current.data.attempts.map((a) => [a.id, a]))
    const previousVisits = new Map(current.data.visits.map((v) => [v.id, v]))
    const nextVisits = new Map(data.visits.map((v) => [v.id, v]))
    const restoredId = restoredAttempt?.id
    if (restoredAttempt && (previousAttempts.has(restoredAttempt.id) ||
      !sameJson(data.attempts.find(a => a.id === restoredAttempt.id), restoredAttempt))) {
      return { ok: false, reason: 'invalid', error: 'Undo must restore the exact deleted Training attempt.' }
    }
    for (const attempt of data.attempts) {
      const previous = previousAttempts.get(attempt.id)
      if (!previous) {
        if (attempt.id !== restoredId && attempt.rulesVersion !== 1) return { ok: false, reason: 'invalid', error: 'New attempts must use current Training rules.' }
        if (attempt.id !== restoredId && attempt.algorithmTracking !== undefined &&
          attempt.algorithmTracking !== (current.data.preferences.algorithmTracking === true)) {
          return { ok: false, reason: 'invalid', error: 'New attempts must use the saved algorithm tracking setting.' }
        }
        continue
      }
      const visit = nextVisits.get(previous.visitId)
      if (visit?.session && visit.endedAt !== null) {
        if (!sameJson(previous, attempt)) return { ok: false, reason: 'invalid', error: 'Ended Training session attempts are read-only.' }
        continue
      }
      // Attribution and success/DNF have explicit corrections. Keep captured timing,
      // category, setup, preferred assumption and calibration history immutable.
      const { attribution: previousAttribution, result: previousResult, resultCorrectedAt: previousCorrection, estimatedRecognitionExecutionMs: previousEstimate, estimateUnavailableReason: previousReason, ...before } = previous
      const { attribution: nextAttribution, result: nextResult, resultCorrectedAt: nextCorrection, estimatedRecognitionExecutionMs: nextEstimate, estimateUnavailableReason: nextReason, ...after } = attempt
      const attributionChanged = !sameJson(previousAttribution, nextAttribution)
      const resultChanged = !sameJson([previousResult, previousCorrection ?? null, previousEstimate, previousReason ?? null], [nextResult, nextCorrection ?? null, nextEstimate, nextReason ?? null])
      const explicitResult = nextCorrection !== undefined && nextCorrection >= Math.max(previous.createdAt, previousCorrection ?? 0) &&
        trainingOutcome(previousResult) !== 'unsupported' && nextResult.status === 'valid' && (nextResult.penalty === 'none' || nextResult.penalty === 'dnf') && nextEstimate === null &&
        (attempt.mode === 'execution' ? nextReason === undefined : nextReason === (nextResult.penalty === 'dnf' ? 'dnf' : 'not-recorded'))
      if (!sameJson(before, after) || (attributionChanged &&
        !(nextAttribution.kind === 'user-corrected' || (nextAttribution.kind === 'unknown' && nextAttribution.markedAt !== null))) ||
        (resultChanged && !explicitResult)) return { ok: false, reason: 'invalid', error: 'An existing attempt needs an explicit attribution/result correction; captured timing and snapshots are immutable.' }
    }
    for (const setId of ['oll', 'pll'] as const) {
      const added = data.attempts.filter((a) => a.id !== restoredId && !previousAttempts.has(a.id) && a.setId === setId && a.mode === 'recognition' && trainingOutcome(a.result) !== 'unsupported').length
      const required = recognitionCount(current.data, setId) + added
      if ((data.recognitionCounts?.[setId] ?? recognitionCount(data, setId)) < required) return { ok: false, reason: 'invalid', error: 'Recognition high-water counts cannot decrease or omit new completions.' }
      if (current.data.recognitionCounts && !data.recognitionCounts) return { ok: false, reason: 'invalid', error: 'Persisted recognition counts must be retained.' }
    }
    const previousCalibrations = new Map(current.data.calibrations.map((c) => [c.id, c]))
    for (const [index, c] of current.data.calibrations.entries()) {
      if (data.calibrations[index]?.id !== c.id) return { ok: false, reason: 'invalid', error: 'Retain historical calibrations in completion order when recording replacements.' }
    }
    for (const c of data.calibrations) {
      const previous = previousCalibrations.get(c.id)
      if (!previous && !isUsableTrainingCalibration(c, c.setId, c.measuredAt)) return { ok: false, reason: 'invalid', error: 'New calibrations need the verified fixed protocol and exact positive-sample median.' }
      if (previous && !sameJson(previous, c)) return { ok: false, reason: 'invalid', error: 'Historical calibrations are immutable; record a new calibration.' }
    }
    for (const next of data.visits) {
      if (next.session && !previousVisits.has(next.id) && (next.endedAt !== null || next.attemptIds.length > 0)) {
        return { ok: false, reason: 'invalid', error: 'Save a new Training session before recording attempts or ending it.' }
      }
    }
    for (const visit of current.data.visits) {
      const next = nextVisits.get(visit.id)
      if (!next) return { ok: false, reason: 'invalid', error: 'Retain visit identities when correcting or deleting attempts.' }
      if (visit.startedAt !== next.startedAt || visit.startedCategoryId !== next.startedCategoryId || !sameJson(visit.lifecycle?.baseline ?? null, next.lifecycle?.baseline ?? null) || visit.lifecycle?.inactivityMinutes !== next.lifecycle?.inactivityMinutes ||
        (visit.lifecycle && (!next.lifecycle || next.lifecycle.lastActivityAt < visit.lifecycle.lastActivityAt)) ||
        (visit.endedAt !== null && (next.endedAt !== visit.endedAt || next.lifecycle?.endReason !== visit.lifecycle?.endReason))) {
        return { ok: false, reason: 'invalid', error: 'Visit identity, captured policies and completed boundaries must be retained.' }
      }
      if (!sameJson(visit.session, next.session)) return { ok: false, reason: 'invalid', error: 'Captured Training session configuration is immutable.' }
      if (visit.session && next.endedAt !== null) {
        if (!sameJson(visit.attemptIds, next.attemptIds)) return { ok: false, reason: 'invalid', error: 'Ending a Training session must keep its saved attempts intact.' }
        const pending = next.lifecycle!.reportPending
        if (visit.endedAt === null ? pending !== (visit.attemptIds.length > 0) : pending && !visit.lifecycle!.reportPending) {
          return { ok: false, reason: 'invalid', error: 'A nonempty Training session must queue its report once when it ends.' }
        }
        if (visit.endedAt !== null && next.lifecycle!.lastActivityAt !== visit.lifecycle!.lastActivityAt) {
          return { ok: false, reason: 'invalid', error: 'Ended Training session activity is immutable.' }
        }
      }
      if (visit.session && ((next.lifecycle!.pausedMs ?? 0) < (visit.lifecycle!.pausedMs ?? 0) ||
        (next.lifecycle!.pausedMs ?? 0) - (visit.lifecycle!.pausedMs ?? 0) > next.lifecycle!.lastActivityAt - visit.lifecycle!.lastActivityAt ||
        (next.endedAt !== null && next.lifecycle!.pausedMs !== visit.lifecycle!.pausedMs) ||
        (visit.endedAt !== null && next.lifecycle!.reportDestination !== visit.lifecycle!.reportDestination))) {
        return { ok: false, reason: 'invalid', error: 'Keep saved pause time and the completed session’s report destination.' }
      }
    }
    const previousAlgorithms = new Map(current.data.customAlgorithms.map((a) => [a.id, a]))
    for (const algorithm of data.customAlgorithms) {
      const previous = previousAlgorithms.get(algorithm.id)
      if (previous && (previous.version !== algorithm.version || previous.caseId !== algorithm.caseId || previous.setId !== algorithm.setId || previous.notation !== algorithm.notation)) {
        return { ok: false, reason: 'invalid', error: 'Changed custom algorithms need a new ID, incremented version and replacement reference.' }
      }
    }
  } catch (error) {
    return { ok: false, reason: 'invalid', error: error instanceof Error ? error.message : 'Invalid Training history transition.' }
  }
  return writeTrainingSnapshot(storage!, raw)
}

function writeTrainingSnapshot(storage: StorageLike, raw: string): TrainingSaveResult {
  try {
    storage.setItem(TRAINING_STORAGE_KEY, raw)
    return { ok: true, raw }
  } catch {
    return { ok: false, reason: 'write', error: 'Training data could not be saved. Keep the current in-memory data and retry.' }
  }
}

/** Property order is not a historical mutation. Unknown JSON fields participate. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => sameJson(value, b[i]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]))
}
