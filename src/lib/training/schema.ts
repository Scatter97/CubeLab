/** Strict, all-record validation. Never discard a bad attempt and autosave the rest. */
import { isDateTimestamp } from '../dates'
import { trainingOutcome } from './results'
import { assertBaselinePolicy, assertTrainingDomainSettings } from './settings'
import type { TrainingBaselinePolicy, TrainingDomainSettings } from './types'
import { STANDARD_CASE_BY_ID } from './catalog/standardCases'
import { BUILT_IN_ALGORITHM_BY_ID } from './catalog/defaultAlgorithms'
import { normalizeCatalogAlgorithm } from './notation'
import { TRAINING_CATEGORIES, TRAINING_PRECURSORS, type TrainingAlgorithmSnapshot, type TrainingCategoryId, type TrainingData, type TrainingSetId } from './types'

export class TrainingValidationError extends Error {
  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'TrainingValidationError'
  }
}

function check(condition: unknown, path: string, detail = 'invalid or missing value'): asserts condition {
  if (!condition) throw new TrainingValidationError(path, detail)
}

function object(value: unknown, path: string): Record<string, unknown> {
  check(typeof value === 'object' && value !== null && !Array.isArray(value), path)
  return value as Record<string, unknown>
}

function list(value: unknown, path: string): unknown[] {
  check(Array.isArray(value), path)
  return value
}

function text(value: unknown, path: string): string {
  check(typeof value === 'string' && value.trim().length > 0, path)
  return value
}

function number(value: unknown, path: string): number {
  check(typeof value === 'number' && Number.isFinite(value) && value >= 0, path)
  return value
}

function integer(value: unknown, path: string, minimum = 0): number {
  const result = number(value, path)
  check(Number.isSafeInteger(result) && result >= minimum, path)
  return result
}

function date(value: unknown, path: string): number {
  check(isDateTimestamp(value) && value >= 0, path)
  return value
}

function boolean(value: unknown, path: string): void {
  check(typeof value === 'boolean', path)
}

function version(value: unknown, path: string): void {
  check(value === 1, path, 'unsupported schema version; original data must be kept')
}

function set(value: unknown, path: string): TrainingSetId {
  check(value === 'oll' || value === 'pll', path)
  return value
}

function category(value: unknown, path: string): asserts value is TrainingCategoryId {
  check((TRAINING_CATEGORIES as readonly unknown[]).includes(value), path)
}

function caseId(value: unknown, path: string, setId?: TrainingSetId): string {
  const id = text(value, path)
  const definition = STANDARD_CASE_BY_ID.get(id)
  check(definition && (!setId || definition.setId === setId), path, 'unknown, skip or wrong-set case')
  return id
}

function unique(values: readonly unknown[], path: string): void {
  check(new Set(values).size === values.length, path, 'duplicate identifiers')
}

function caseIds(value: unknown, path: string, setId: TrainingSetId): void {
  const values = list(value, path)
  values.forEach((id, i) => caseId(id, `${path}[${i}]`, setId))
  unique(values, path)
}

/** Also protects unknown additive fields: JSON must not drop/alter their values. */
export function assertTrainingJson(value: unknown, path = 'training', ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    check(Number.isFinite(value), path, 'non-finite JSON number')
    return
  }
  check(typeof value === 'object' && value !== null, path, 'not lossless JSON')
  check(!ancestors.has(value), path, 'cyclic JSON')
  check(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, path, 'not a plain JSON object')
  check(Object.getOwnPropertySymbols(value).length === 0, path, 'symbol properties are not JSON')
  ancestors.add(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertTrainingJson(value[i], `${path}[${i}]`, ancestors)
  } else {
    for (const [key, child] of Object.entries(value)) assertTrainingJson(child, `${path}.${key}`, ancestors)
  }
  ancestors.delete(value)
}

function algorithmSnapshot(value: unknown, path: string): Record<string, unknown> {
  const a = object(value, path)
  text(a.id, `${path}.id`)
  integer(a.revision, `${path}.revision`, 1)
  if (a.notation !== null) notation(a.notation, `${path}.notation`)
  return a
}

function notation(value: unknown, path: string): string {
  const result = text(value, path)
  try { normalizeCatalogAlgorithm(result) } catch { throw new TrainingValidationError(path, 'invalid algorithm notation') }
  return result
}

function precursor(setId: TrainingSetId, id: unknown, alg: unknown, path: string): void {
  check(id === TRAINING_PRECURSORS[setId].id && alg === TRAINING_PRECURSORS[setId].notation, path, 'wrong fixed precursor')
}

export function validateTrainingCalibration(value: unknown, path = 'calibration'): void {
  const c = object(value, path)
  version(c.version, `${path}.version`)
  text(c.id, `${path}.id`)
  const setId = set(c.setId, `${path}.setId`)
  precursor(setId, c.precursorId, c.precursorNotation, path)
  const samples = list(c.samplesMs, `${path}.samplesMs`)
  check(samples.length === 7, `${path}.samplesMs`, 'exactly seven valid samples required')
  samples.forEach((sample, i) => number(sample, `${path}.samplesMs[${i}]`))
  number(c.medianMs, `${path}.medianMs`)
  check(samples.includes(c.medianMs), `${path}.medianMs`, 'median must be a recorded sample')
  if (c.protocol !== undefined) {
    check(c.protocol === 'fixed-inverse-precursor:v1', `${path}.protocol`, 'unsupported calibration protocol')
    check(samples.every((n) => (n as number) > 0) && [...samples as number[]].sort((a, b) => a - b)[3] === c.medianMs, path, 'fixed calibration requires positive samples and the exact numeric median')
  }
  date(c.measuredAt, `${path}.measuredAt`)
  integer(c.recognitionAttemptsAtMeasurement, `${path}.recognitionAttemptsAtMeasurement`)
  const renewal = object(c.renewal, `${path}.renewal`)
  integer(renewal.days, `${path}.renewal.days`, 1)
  integer(renewal.recognitionAttempts, `${path}.renewal.recognitionAttempts`, 1)
}

export function validateTrainingSetup(value: unknown, path = 'setup'): void {
  const s = object(value, path)
  version(s.version, `${path}.version`)
  date(s.generatedAt, `${path}.generatedAt`)
  text(s.generatorVersion, `${path}.generatorVersion`)
  const generator = algorithmSnapshot(s.generatorAlgorithm, `${path}.generatorAlgorithm`)
  const g = object(s.generated, `${path}.generated`)
  const setId = set(g.setId, `${path}.generated.setId`)
  const id = caseId(g.caseId, `${path}.generated.caseId`, setId)
  check(g.mode === 'execution' || g.mode === 'recognition', `${path}.generated.mode`)
  check(['', 'U', 'U2', "U'"].includes(g.auf as string), `${path}.generated.auf`)
  notation(g.scramble, `${path}.generated.scramble`)
  notation(g.targetAlgorithmNotation, `${path}.generated.targetAlgorithmNotation`)
  check(g.targetAlgorithmId === generator.id, `${path}.generatorAlgorithm`, 'generator ID mismatch')
  check(g.targetHidden === (g.mode === 'recognition'), `${path}.generated.targetHidden`)
  const v = object(g.verification, `${path}.generated.verification`)
  check(v.identity === id && v.canonicalSignature === STANDARD_CASE_BY_ID.get(id)!.canonicalSignature, `${path}.verification`, 'case verification identity mismatch')
  for (const key of ['targetF2lSolved', 'targetIsStandardFrame', 'targetMatchesCase', 'exactTargetReached', 'algorithmSolvesTargetUpToAuf']) {
    check(v[key] === true, `${path}.verification.${key}`, 'setup verification failed')
  }
  if (g.mode === 'execution') {
    check(g.precursor === null && v.recognition === null, path, 'execution cannot have a precursor')
  } else {
    check(g.precursor === TRAINING_PRECURSORS[setId].notation, `${path}.precursor`)
    const r = object(v.recognition, `${path}.verification.recognition`)
    check(r.precursor === g.precursor, path, 'recognition precursor mismatch')
    for (const key of ['preStateThreeSlotsSolved', 'preStateMatchesRequiredConfiguration', 'precursorReturnsTargetExactly']) {
      check(r[key] === true, `${path}.recognition.${key}`)
    }
    check(r.preStateF2lSolved === (setId === 'pll'), `${path}.recognition.preStateF2lSolved`)
    check(r.preStateIsNotPllOriented === (setId === 'pll' ? true : null), `${path}.recognition.preStateIsNotPllOriented`)
  }
}

export function validateTrainingAttempt(value: unknown, path = 'attempt'): void {
  const a = object(value, path)
  version(a.version, `${path}.version`)
  text(a.id, `${path}.id`)
  const setId = set(a.setId, `${path}.setId`)
  check(a.mode === 'execution' || a.mode === 'recognition', `${path}.mode`)
  check(a.categoryId === `${setId}:${a.mode}`, `${path}.categoryId`, 'category is permanent and must match set/mode')
  caseId(a.caseId, `${path}.caseId`, setId)
  const at = date(a.createdAt, `${path}.createdAt`)
  text(a.visitId, `${path}.visitId`)
  const rawMs = number(a.rawMs, `${path}.rawMs`)
  if (a.rulesVersion !== undefined) version(a.rulesVersion, `${path}.rulesVersion`)
  if (a.resultCorrectedAt !== undefined) check(date(a.resultCorrectedAt, `${path}.resultCorrectedAt`) >= at, path)
  if (a.estimateUnavailableReason !== undefined) check(['below-calibration', 'dnf', 'not-recorded'].includes(a.estimateUnavailableReason as string), `${path}.estimateUnavailableReason`)
  const result = object(a.result, `${path}.result`)
  check(result.status === 'valid' || result.status === 'invalid', `${path}.result.status`)
  if (result.status === 'valid') check(['none', '+2', 'dnf'].includes(result.penalty as string), `${path}.result.penalty`)
  else text(result.reason, `${path}.result.reason`)
  if (a.rulesVersion === 1) {
    check(result.status === 'valid' && (result.penalty === 'none' || result.penalty === 'dnf'), path, 'Training supports only success or DNF, without +2')
    check(!('inspection' in a) && !('inspectionMs' in a), path, 'Training has no inspection')
  }
  if (a.preferredAlgorithmAtStart !== null) algorithmSnapshot(a.preferredAlgorithmAtStart, `${path}.preferredAlgorithmAtStart`)
  const attr = object(a.attribution, `${path}.attribution`)
  if (a.algorithmTracking !== undefined) boolean(a.algorithmTracking, `${path}.algorithmTracking`)
  if (a.algorithmTracking === false) {
    check(a.preferredAlgorithmAtStart === null && attr.kind === 'unknown' && attr.markedAt === null,
      `${path}.attribution`, 'case-only attempts cannot have algorithm attribution')
  }
  if (a.algorithmTracking === true) check(a.preferredAlgorithmAtStart !== null, path, 'tracked attempts require a captured algorithm revision')
  check(['assumed-preferred', 'user-corrected', 'unknown'].includes(attr.kind as string), `${path}.attribution.kind`)
  if (attr.kind === 'unknown') {
    check(!('algorithm' in attr), `${path}.attribution`, 'Unknown must not identify an executed algorithm')
    if (attr.markedAt !== null) check(date(attr.markedAt, `${path}.markedAt`) >= at, path)
  } else {
    const algorithm = algorithmSnapshot(attr.algorithm, `${path}.attribution.algorithm`)
    if (attr.kind === 'user-corrected') check(date(attr.correctedAt, `${path}.correctedAt`) >= at, path)
    else {
      const preferred = object(a.preferredAlgorithmAtStart, `${path}.preferredAlgorithmAtStart`)
      check(['id', 'revision', 'notation'].every((key) => preferred[key] === algorithm[key]), `${path}.attribution`, 'assumed attribution must match the captured preference')
    }
  }
  validateTrainingSetup(a.setup, `${path}.setup`)
  const s = object(a.setup, `${path}.setup`)
  const g = object(s.generated, `${path}.setup.generated`)
  check(g.caseId === a.caseId && g.setId === setId && g.mode === a.mode && (s.generatedAt as number) <= at, `${path}.setup`, 'attempt/setup context mismatch')
  if (a.mode === 'execution') {
    check(a.precursorId === null && a.calibration === null && a.estimatedRecognitionExecutionMs === null, path, 'execution cannot contain calibration or estimated recognition time')
  } else {
    check(a.precursorId === TRAINING_PRECURSORS[setId].id, `${path}.precursorId`)
    if (a.calibration !== null) {
      validateTrainingCalibration(a.calibration, `${path}.calibration`)
      const c = object(a.calibration, path)
      check(c.setId === setId && (c.measuredAt as number) <= at, `${path}.calibration`, 'wrong-set or future calibration')
    }
    if (a.estimatedRecognitionExecutionMs !== null) {
      check(a.calibration !== null && result.status === 'valid' && result.penalty !== 'dnf', `${path}.estimatedRecognitionExecutionMs`, 'estimate needs calibration and a valid non-DNF result')
      check(number(a.estimatedRecognitionExecutionMs, `${path}.estimatedRecognitionExecutionMs`) <= rawMs, path, 'estimate exceeds raw duration')
    }
  }
  if (a.rulesVersion === 1) validateCurrentTrainingAttempt(a, path)
}

/** Strong new-write rules are separate from the unchanged legacy v1 read contract. */
function validateCurrentTrainingAttempt(a: Record<string, unknown>, path: string): void {
  const result = a.result as Record<string, unknown>
  if (a.mode === 'execution') {
    check(a.estimateUnavailableReason === undefined, path)
    return
  }
  const c = object(a.calibration, `${path}.calibration`)
  const samples = c.samplesMs as number[]
  check(c.protocol === 'fixed-inverse-precursor:v1' && samples.every((ms) => ms > 0) && [...samples].sort((a, b) => a - b)[3] === c.medianMs, path, 'recognition needs valid calibration')
  const expected = (a.rawMs as number) - (c.medianMs as number)
  if (result.penalty === 'dnf') check(a.estimatedRecognitionExecutionMs === null && a.estimateUnavailableReason === 'dnf', path)
  else if (a.estimateUnavailableReason === 'not-recorded') check(a.estimatedRecognitionExecutionMs === null && a.resultCorrectedAt !== undefined, path)
  else if (expected < 0) check(a.estimatedRecognitionExecutionMs === null && a.estimateUnavailableReason === 'below-calibration', path)
  else check(a.estimatedRecognitionExecutionMs === expected && a.estimateUnavailableReason === undefined, path, 'estimate must use captured calibration')
}

export function validateTrainingVisit(value: unknown, path = 'visit'): void {
  const v = object(value, path)
  version(v.version, `${path}.version`)
  text(v.id, `${path}.id`)
  const start = date(v.startedAt, `${path}.startedAt`)
  if (v.endedAt !== null) check(date(v.endedAt, `${path}.endedAt`) >= start, path, 'visit ends before it starts')
  category(v.startedCategoryId, `${path}.startedCategoryId`)
  const categories = list(v.categoryIds, `${path}.categoryIds`)
  categories.forEach((id) => category(id, `${path}.categoryIds`))
  unique(categories, `${path}.categoryIds`)
  check(categories.includes(v.startedCategoryId), path, 'missing starting category')
  const ids = list(v.attemptIds, `${path}.attemptIds`)
  ids.forEach((id) => text(id, `${path}.attemptIds`))
  unique(ids, `${path}.attemptIds`)
  if (v.summaryId !== null) text(v.summaryId, `${path}.summaryId`)
  if (v.lifecycle !== undefined) {
    const l = object(v.lifecycle, `${path}.lifecycle`)
    version(l.version, `${path}.lifecycle.version`)
    check(date(l.lastActivityAt, `${path}.lastActivityAt`) >= start && (v.endedAt === null || (l.lastActivityAt as number) <= (v.endedAt as number)), path, 'activity outside visit')
    assertBaselinePolicy(l.baseline as TrainingBaselinePolicy)
    integer(l.inactivityMinutes, `${path}.inactivityMinutes`, 1)
    boolean(l.reportPending, `${path}.reportPending`)
    check(l.endReason === null || ['navigation', 'tab-closed', 'inactivity'].includes(l.endReason as string) ||
      l.endReason === (v.session === undefined ? 'category-switch' : 'manual'), `${path}.endReason`)
    check((v.endedAt === null) === (l.endReason === null), path, 'end reason must match visit state')
    check(v.endedAt !== null || l.reportPending === false, path, 'active visit cannot have a pending report')
    if (l.reportDestination !== undefined) check(v.session !== undefined && v.endedAt !== null && ids.length > 0 &&
      ['training', 'timer', 'analytics'].includes(l.reportDestination as string), `${path}.lifecycle.reportDestination`)
    if (l.pausedMs !== undefined) {
      const paused = integer(l.pausedMs, `${path}.lifecycle.pausedMs`, 0)
      check(v.session !== undefined && paused <= (l.lastActivityAt as number) - start, `${path}.lifecycle.pausedMs`)
    }
    check(categories.length === 1, path, 'new visits have exactly one category')
  }
  if (v.session !== undefined) {
    const sessionPath = `${path}.session`
    const session = object(v.session, sessionPath)
    version(session.version, `${sessionPath}.version`)
    text(session.name, `${sessionPath}.name`)
    const lifecycle = object(v.lifecycle, `${path}.lifecycle`)
    check(!lifecycle.reportPending || ids.length > 0, `${path}.lifecycle.reportPending`, 'empty session has no report')
    const setId = v.startedCategoryId.startsWith('oll:') ? 'oll' : 'pll'
    const cases = list(session.cases, `${sessionPath}.cases`)
    check(cases.length >= (v.startedCategoryId.endsWith(':recognition') ? 2 : 1), `${sessionPath}.cases`, 'insufficient captured cases')
    unique(cases.map((value, index) => {
      const casePath = `${sessionPath}.cases[${index}]`
      const entry = object(value, casePath)
      const id = caseId(entry.caseId, `${casePath}.caseId`, setId)
      const algorithm = algorithmSnapshot(entry.algorithm, `${casePath}.algorithm`)
      check(algorithm.notation !== null, `${casePath}.algorithm.notation`, 'captured revision requires notation')
      return id
    }), `${sessionPath}.cases`)
  }
}

function matchesAlgorithm(actual: TrainingAlgorithmSnapshot, captured: TrainingAlgorithmSnapshot): boolean {
  return actual.id === captured.id && actual.revision === captured.revision && actual.notation === captured.notation
}

function validatePreferences(value: unknown): void {
  const p = object(value, 'preferences')
  if (p.algorithmTracking !== undefined) boolean(p.algorithmTracking, 'preferences.algorithmTracking')
  version(p.version, 'preferences.version')
  set(p.selectedSetId, 'preferences.selectedSetId')
  const sets = object(p.sets, 'preferences.sets')
  for (const setId of ['oll', 'pll'] as const) {
    const s = object(sets[setId], `preferences.sets.${setId}`)
    caseIds(s.enabledCaseIds, 'enabledCaseIds', setId)
    caseIds(s.difficultCaseIds, 'difficultCaseIds', setId)
    boolean(s.includeSetupMoves, 'includeSetupMoves')
    if (s.selectedPresetId !== null) text(s.selectedPresetId, 'selectedPresetId')
    const r = object(s.recognition, 'recognition')
    integer(r.renewalDays, 'recognition.renewalDays', 1)
    integer(r.renewalAttempts, 'recognition.renewalAttempts', 1)
  }
  const preferred = list(p.preferredAlgorithms, 'preferredAlgorithms')
  const cases = preferred.map((value) => {
    const pref = object(value, 'preferredAlgorithms[]')
    algorithmSnapshot(pref.algorithm, 'preferredAlgorithm')
    return caseId(pref.caseId, 'preferredAlgorithm.caseId')
  })
  unique(cases, 'preferredAlgorithms')
  const categories = object(p.categories, 'preferences.categories')
  check(Object.keys(categories).length === 4, 'preferences.categories', 'exactly four categories required')
  for (const id of TRAINING_CATEGORIES) {
    const settings = object(categories[id], `preferences.categories.${id}`)
    check(settings.recognitionMetric === 'raw' || settings.recognitionMetric === 'estimated', `preferences.categories.${id}.recognitionMetric`)
    check(!id.endsWith(':execution') || settings.recognitionMetric === 'raw', `preferences.categories.${id}`, 'execution uses raw time')
  }
  object(p.reportSettings, 'preferences.reportSettings')
  if (p.domain !== undefined) assertTrainingDomainSettings(p.domain as TrainingDomainSettings)
}

function validateCustomAlgorithm(value: unknown, path: string): void {
  const a = object(value, path)
  text(a.id, `${path}.id`)
  integer(a.version, `${path}.version`, 1)
  const setId = set(a.setId, `${path}.setId`)
  caseId(a.caseId, `${path}.caseId`, setId)
  check(a.source === 'user', `${path}.source`, 'only user-defined algorithms belong in local custom algorithms')
  const alg = notation(a.notation, `${path}.notation`)
  check(a.normalizedNotation === normalizeCatalogAlgorithm(alg), `${path}.normalizedNotation`)
  check(typeof a.label === 'string', `${path}.label`)
  date(a.createdAt, `${path}.createdAt`)
  if (a.replacesAlgorithmId !== undefined) text(a.replacesAlgorithmId, `${path}.replacesAlgorithmId`)
  if (a.verification !== null) {
    const v = object(a.verification, `${path}.verification`)
    check(v.status === 'verified' || v.status === 'unverified', `${path}.verification.status`)
    check(v.method === 'cube-state' || v.method === 'case-identity', `${path}.verification.method`)
    text(v.verifiedAt, `${path}.verification.verifiedAt`)
    boolean(v.frameNormalized, `${path}.verification.frameNormalized`)
    boolean(v.solvesCase, `${path}.verification.solvesCase`)
    check(v.status !== 'verified' || v.solvesCase, path, 'verified algorithm must solve the case')
    const aufs = list(v.checkedAufs, `${path}.verification.checkedAufs`)
    check(aufs.length > 0 && aufs.every((auf) => ['', 'U', 'U2', "U'"].includes(auf as string)), path)
    for (const key of ['frameCorrection', 'frameNormalizedNotation', 'notes']) {
      if (v[key] !== undefined) check(typeof v[key] === 'string', `${path}.verification.${key}`)
    }
  }
}

/** Validation only: persisted verification metadata is not fresh cube-state proof. */
export function assertTrainingData(value: unknown): asserts value is TrainingData {
  assertTrainingJson(value)
  const d = object(value, 'training')
  version(d.version, 'training.version')
  validatePreferences(d.preferences)
  if (d.recognitionCounts !== undefined) {
    const counts = object(d.recognitionCounts, 'recognitionCounts')
    integer(counts.oll, 'recognitionCounts.oll')
    integer(counts.pll, 'recognitionCounts.pll')
  }
  const arrays = ['attempts', 'visits', 'calibrations', 'customAlgorithms', 'presets'] as const
  for (const key of arrays) {
    const values = list(d[key], key)
    unique(values.map((v) => text(object(v, key).id, `${key}.id`)), key)
  }
  const data = value as TrainingData
  data.attempts.forEach((a, i) => validateTrainingAttempt(a, `attempts[${i}]`))
  data.visits.forEach((v, i) => validateTrainingVisit(v, `visits[${i}]`))
  data.calibrations.forEach((c, i) => {
    validateTrainingCalibration(c, `calibrations[${i}]`)
    check(['initial', 'manual', 'due'].includes(c.source), `calibrations[${i}].source`)
    integer(c.invalidSampleCount, `calibrations[${i}].invalidSampleCount`)
  })
  if (data.recognitionCounts) for (const setId of ['oll', 'pll'] as const) {
    check(data.recognitionCounts[setId] >= data.attempts.filter((a) => a.setId === setId && a.mode === 'recognition' && trainingOutcome(a.result) !== 'unsupported').length, 'recognitionCounts', 'counter is below retained completions')
    for (const c of [...data.calibrations, ...data.attempts.flatMap((a) => a.calibration ? [a.calibration] : [])]) {
      if (c.setId === setId) check(data.recognitionCounts[setId] >= c.recognitionAttemptsAtMeasurement, 'recognitionCounts', 'counter is below captured calibration offset')
    }
  }
  data.customAlgorithms.forEach((a, i) => validateCustomAlgorithm(a, `customAlgorithms[${i}]`))
  data.presets.forEach((p, i) => {
    const path = `presets[${i}]`
    version(p.version, `${path}.version`)
    text(p.name, `${path}.name`)
    const setId = set(p.setId, `${path}.setId`)
    caseIds(p.caseIds, `${path}.caseIds`, setId)
    boolean(p.includeSetupMoves, `${path}.includeSetupMoves`)
    check(['built-in', 'user', 'difficult'].includes(p.kind), `${path}.kind`)
    check(date(p.updatedAt, `${path}.updatedAt`) >= date(p.createdAt, `${path}.createdAt`), path)
  })
  const presets = new Map(data.presets.map((p) => [p.id, p]))
  for (const setId of ['oll', 'pll'] as const) {
    const id = data.preferences.sets[setId].selectedPresetId
    check(id === null || presets.get(id)?.setId === setId, 'selectedPresetId', 'missing or wrong-set preset')
  }
  const algorithms = new Map(data.customAlgorithms.map((a) => [a.id, a]))
  for (const a of data.customAlgorithms) {
    if (a.replacesAlgorithmId !== undefined) {
      const previous = algorithms.get(a.replacesAlgorithmId)
      if (previous) {
        check(previous.caseId === a.caseId && previous.version < a.version, 'customAlgorithms.replacesAlgorithmId', 'invalid revision link; retain previous revisions')
      } else {
        const builtIn = BUILT_IN_ALGORITHM_BY_ID.get(a.replacesAlgorithmId)
        check(builtIn && builtIn.caseId === a.caseId && builtIn.version < a.version, 'customAlgorithms.replacesAlgorithmId', 'invalid built-in replacement link')
      }
    }
  }
  for (const p of data.preferences.preferredAlgorithms) {
    const a = algorithms.get(p.algorithm.id)
    if (a) {
      check(a.caseId === p.caseId && a.version === p.algorithm.revision && (p.algorithm.notation === null || p.algorithm.notation === a.notation), 'preferredAlgorithms', 'custom algorithm reference mismatch')
    } else {
      const builtIn = BUILT_IN_ALGORITHM_BY_ID.get(p.algorithm.id)
      if (builtIn) {
        check(builtIn.caseId === p.caseId && builtIn.version === p.algorithm.revision && (p.algorithm.notation === null || p.algorithm.notation === builtIn.notation), 'preferredAlgorithms', 'built-in algorithm reference mismatch')
      }
    }
  }
  const visits = new Map(data.visits.map((v) => [v.id, v]))
  const visitAttemptIds = new Map(data.visits.map((v) => [v.id, new Set(v.attemptIds)]))
  const attempts = new Map(data.attempts.map((a) => [a.id, a]))
  check(data.activeVisitId === null || (typeof data.activeVisitId === 'string' && visits.get(data.activeVisitId)?.endedAt === null), 'activeVisitId', 'missing or ended active visit')
  for (const v of data.visits) {
    check(v.endedAt !== null || data.activeVisitId === v.id, 'visits', 'open visit must be the active visit')
    const capturedCases = v.session && new Map(v.session.cases.map(({ caseId, algorithm }) => [caseId, algorithm]))
    for (const id of v.attemptIds) {
      const attempt = attempts.get(id)
      check(attempt?.visitId === v.id, 'visits.attemptIds', 'missing or wrong-visit attempt')
      if (capturedCases) {
        const captured = capturedCases.get(attempt.caseId)
        check(attempt.rulesVersion === 1 && captured && matchesAlgorithm(attempt.setup.generatorAlgorithm, captured) &&
          (attempt.preferredAlgorithmAtStart === null || matchesAlgorithm(attempt.preferredAlgorithmAtStart, captured)),
        'visits.attemptIds', 'attempt must use the session case and captured algorithm revision')
      }
    }
  }
  for (const a of data.attempts) {
    const v = visits.get(a.visitId)
    check(v && visitAttemptIds.get(v.id)!.has(a.id) && v.categoryIds.includes(a.categoryId), 'attempt.visitId', 'visit reference/category mismatch')
    if (v.lifecycle) check(a.createdAt <= v.lifecycle.lastActivityAt, 'attempt.createdAt', 'attempt exceeds last visit activity')
    check(a.createdAt >= v.startedAt && (v.endedAt === null || a.createdAt <= v.endedAt), 'attempt.createdAt', 'attempt outside visit')
  }
}
