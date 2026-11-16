import { describe, expect, it } from 'vitest'
import { createEmptyTrainingData, deserializeTrainingData, serializeTrainingData, loadTraining, saveTraining, TRAINING_STORAGE_KEY } from './storage'
import { createTrainingAttempt, createTrainingVisit, appendTrainingAttempt, correctTrainingResult, finishTrainingVisit } from './records'
import { completeCalibration, beginCalibration, addCalibrationSample, recognitionCount, calibrationState } from './calibration'
import { getTrainingDomainSettings } from './settings'
import { calculateTrainingReport } from './reports'
import { acknowledgeTrainingReport, beginTrainingSession, pendingTrainingReports, transitionTrainingVisit } from './visits'
import { NOW, setup, calibration } from './persistenceFixtures.test-support'
import type { TrainingData } from './types'

function memory() {
  const values = new Map<string, string>()
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, raw: string) => { values.set(key, raw) } }
}
function populated() {
  const visit = createTrainingVisit('oll:recognition', NOW, 'v')
  return appendTrainingAttempt({ ...createEmptyTrainingData(), visits: [visit], activeVisitId: 'v', calibrations: [calibration()] }, createTrainingAttempt({ id: 'a', setup: setup('oll', 'recognition'), calibration: calibration(), visitId: 'v', rawMs: 2500, createdAt: NOW + 10 }))
}
function saveInitial(data = populated()) {
  const storage = memory()
  const result = saveTraining(data, null, storage)
  if (!result.ok) throw Error(result.error)
  return { data, raw: result.raw, storage }
}

function namedSession() {
  const generatedSetup = setup()
  const algorithm = { ...generatedSetup.generatorAlgorithm, notation: generatedSetup.generated.targetAlgorithmNotation }
  const active = beginTrainingSession(createEmptyTrainingData(), {
    id: 'named', at: NOW, categoryId: 'oll:execution',
    session: { version: 1, name: 'OLL drill', cases: [{ caseId: 'oll:27', algorithm }] },
  })
  const attempt = createTrainingAttempt({
    id: 'dnf', setup: { ...generatedSetup, generatorAlgorithm: algorithm }, visitId: 'named',
    createdAt: NOW + 10, rawMs: 2500, result: { status: 'valid', penalty: 'dnf' },
  })
  return { active, attempt }
}

describe('checked named Training sessions', () => {
  it('retries the exact end after a failed write and recovers the pending all-DNF report after reload', () => {
    const { active, attempt } = namedSession()
    const { raw, storage } = saveInitial(active)
    const practiced = appendTrainingAttempt(active, attempt)
    const saved = saveTraining(practiced, raw, storage)
    if (!saved.ok) throw Error(saved.error)
    const ended = finishTrainingVisit(practiced, 'named', NOW + 20, 'manual')
    const blocked = { ...storage, setItem() { throw Error('quota') } }
    expect(saveTraining(ended, saved.raw, blocked)).toMatchObject({ ok: false, reason: 'write' })
    expect(loadTraining(storage)).toEqual({ ok: true, raw: saved.raw, data: practiced })
    expect(saveTraining(ended, raw, storage)).toMatchObject({ ok: false, reason: 'changed' })
    const retry = saveTraining(ended, saved.raw, storage)
    if (!retry.ok) throw Error(retry.error)
    const loaded = loadTraining(storage)
    if (!loaded.ok) throw Error(loaded.error)
    expect(loaded.data.attempts).toEqual([attempt])
    expect(pendingTrainingReports(loaded.data, 'session')).toEqual(['named'])
    const delivered = acknowledgeTrainingReport(loaded.data, 'named', 'session')
    const acknowledged = saveTraining(delivered, loaded.raw, storage)
    if (!acknowledged.ok) throw Error(acknowledged.error)
    expect(saveTraining(ended, acknowledged.raw, storage)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(loadTraining(storage)).toEqual({ ok: true, raw: acknowledged.raw, data: delivered })
  })

  it('allows exact active Undo and rejects bypasses of the end and archive protections', () => {
    const { active, attempt } = namedSession()
    const { raw, storage } = saveInitial(active)
    const visit = active.visits[0]!
    const renamed = { ...active, visits: [{ ...visit, session: { ...visit.session!, name: 'Replacement' } }] }
    expect(saveTraining(renamed, raw, storage)).toMatchObject({ ok: false, reason: 'invalid' })
    const practiced = appendTrainingAttempt(active, attempt)
    const saved = saveTraining(practiced, raw, storage)
    if (!saved.ok) throw Error(saved.error)
    const withoutAttempt = { ...practiced, attempts: [], visits: [{ ...practiced.visits[0]!, attemptIds: [] }] }
    const deleted = saveTraining(withoutAttempt, saved.raw, storage)
    if (!deleted.ok) throw Error(deleted.error)
    const restored = saveTraining(practiced, deleted.raw, storage, attempt)
    if (!restored.ok) throw Error(restored.error)

    const ended = finishTrainingVisit(practiced, 'named', NOW + 20, 'manual')
    expect(saveTraining(acknowledgeTrainingReport(ended, 'named', 'session'), restored.raw, storage))
      .toMatchObject({ ok: false, reason: 'invalid' })
    const archived = saveTraining(ended, restored.raw, storage)
    if (!archived.ok) throw Error(archived.error)
    expect(saveTraining({ ...ended, attempts: [correctTrainingResult(attempt, 'success', NOW + 30)] }, archived.raw, storage))
      .toMatchObject({ ok: false, reason: 'invalid' })
    const emptyEnd = finishTrainingVisit(withoutAttempt, 'named', NOW + 20, 'manual')
    expect(saveTraining(emptyEnd, archived.raw, storage)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(storage.getItem(TRAINING_STORAGE_KEY)).toBe(archived.raw)

    // A deletion committed just before ending must not be undone into an archive.
    storage.setItem(TRAINING_STORAGE_KEY, deleted.raw)
    const emptyArchive = saveTraining(emptyEnd, deleted.raw, storage)
    if (!emptyArchive.ok) throw Error(emptyArchive.error)
    const staleUndo = { ...emptyEnd, visits: [{ ...emptyEnd.visits[0]!, attemptIds: [attempt.id] }], attempts: [attempt] }
    expect(saveTraining(staleUndo, emptyArchive.raw, storage, attempt)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(storage.getItem(TRAINING_STORAGE_KEY)).toBe(emptyArchive.raw)
  })
})

describe('compatible domain persistence extensions', () => {
  it('reads unchanged v1 history, defaults without writes, and reports unsupported legacy states explicitly', () => {
    const old = JSON.parse(serializeTrainingData(populated()))
    delete old.preferences.domain
    delete old.recognitionCounts
    delete old.visits[0].lifecycle
    delete old.attempts[0].rulesVersion
    delete old.attempts[0].calibration.protocol
    delete old.calibrations[0].protocol
    old.calibrations[0].samplesMs[0] = 0
    old.calibrations[0].medianMs = 700
    old.attempts[0].calibration = old.calibrations[0]
    old.attempts[0].result.penalty = '+2'
    const raw = JSON.stringify(old)
    const storage = memory()
    storage.setItem(TRAINING_STORAGE_KEY, raw)
    const loaded = loadTraining(storage)
    if (!loaded.ok) throw Error(loaded.error)
    expect(serializeTrainingData(loaded.data)).toBe(raw)
    expect(getTrainingDomainSettings(loaded.data.preferences)).toEqual({ version: 1, requireRecalibrationWhenDue: false, baseline: { kind: 'days', count: 90 }, trimPercent: 5, inactivityMinutes: 15 })
    expect(calibrationState(loaded.data.calibrations[0]!, 'oll', NOW, 0).status).toBe('invalid-calibration')
    expect(calculateTrainingReport(loaded.data, 'v').status).toBe('baseline-policy-unavailable')
    expect(storage.getItem(TRAINING_STORAGE_KEY)).toBe(raw)
    expect(saveTraining(loaded.data, raw, storage).ok).toBe(true)
  })
  it.each([
    { requireRecalibrationWhenDue: 'yes' }, { baseline: { kind: 'days', count: 0 } },
    { baseline: { kind: 'attempts', count: 1.5 } }, { baseline: { kind: 'all', count: 1 } },
    { trimPercent: 50 }, { trimPercent: -1 }, { inactivityMinutes: 0 }, { version: 2 },
  ])('rejects malformed settings without salvaging or overwriting bytes: %j', (change) => {
    const d = createEmptyTrainingData()
    const raw = JSON.stringify({ ...d, preferences: { ...d.preferences, domain: { ...d.preferences.domain, ...change } } })
    const s = memory()
    s.setItem(TRAINING_STORAGE_KEY, raw)
    expect(loadTraining(s)).toMatchObject({ ok: false, raw })
    expect(saveTraining(d, raw, s).ok).toBe(false)
    expect(s.getItem(TRAINING_STORAGE_KEY)).toBe(raw)
  })
  it('keeps renewal counters monotonic through deletion, reload and new attempts', () => {
    const { data, raw, storage } = saveInitial()
    const deleted = { ...data, attempts: [], visits: data.visits.map((v) => ({ ...v, attemptIds: [] })) }
    const saved = saveTraining(deleted, raw, storage)
    expect(saved.ok).toBe(true)
    if (!saved.ok) throw Error(saved.error)
    expect(recognitionCount(deserializeTrainingData(saved.raw), 'oll')).toBe(1)
    const smaller = { ...deleted, recognitionCounts: { oll: 0, pll: 0 } }
    expect(saveTraining(smaller, saved.raw, storage)).toMatchObject({ ok: false, reason: 'invalid' })
    const { recognitionCounts: _counts, ...removed } = deleted
    expect(saveTraining(removed, saved.raw, storage)).toMatchObject({ ok: false, reason: 'invalid' })
    const next = appendTrainingAttempt(deleted, createTrainingAttempt({ id: 'b', setup: setup('oll', 'recognition'), calibration: calibration(), visitId: 'v', rawMs: 2500, createdAt: NOW + 20, result: { status: 'valid', penalty: 'dnf' } }))
    expect(next.recognitionCounts).toEqual({ oll: 2, pll: 0 })
    expect(saveTraining({ ...next, recognitionCounts: deleted.recognitionCounts }, saved.raw, storage).ok).toBe(false)
    expect(saveTraining(next, saved.raw, storage).ok).toBe(true)
  })
  it('exempts only the exact deleted attempt from the new completion checks during Undo', () => {
    const { data, raw, storage } = saveInitial()
    const original = data.attempts[0]!
    const deleted = { ...data, attempts: [], visits: data.visits.map(v => ({ ...v, attemptIds: [] })) }
    const saved = saveTraining(deleted, raw, storage)
    if (!saved.ok) throw Error(saved.error)
    expect(saveTraining(data, saved.raw, storage)).toMatchObject({ ok: false, reason: 'invalid' })
    const altered = correctTrainingResult(original, 'dnf', NOW + 20)
    expect(saveTraining({ ...data, attempts: [altered] }, saved.raw, storage, original))
      .toMatchObject({ ok: false, reason: 'invalid' })
    expect(storage.getItem(TRAINING_STORAGE_KEY)).toBe(saved.raw)
    expect(saveTraining(data, saved.raw, storage, original).ok).toBe(true)
  })
  it('freezes captured calibration samples/thresholds and visit policies, without blocking explicit result corrections', () => {
    const { data, raw, storage } = saveInitial()
    const rewritten = { ...data, calibrations: [{ ...data.calibrations[0]!, renewal: { days: 1, recognitionAttempts: 1 } }] }
    expect(saveTraining(rewritten, raw, storage).ok).toBe(false)
    const changedVisit = { ...data, visits: [{ ...data.visits[0]!, lifecycle: { ...data.visits[0]!.lifecycle!, baseline: { kind: 'attempts' as const, count: 1 } } }] }
    expect(saveTraining(changedVisit, raw, storage).ok).toBe(false)
    const corrected = correctTrainingResult(data.attempts[0]!, 'dnf', NOW + 50)
    const next = { ...data, attempts: [corrected] }
    const saved = saveTraining(next, raw, storage)
    expect(saved.ok).toBe(true)
    if (!saved.ok) throw Error(saved.error)
    expect(corrected.rawMs).toBe(2500)
    expect(corrected.calibration).toEqual(data.attempts[0]!.calibration)
    expect(corrected.estimatedRecognitionExecutionMs).toBeNull()
    expect(calculateTrainingReport(next, 'v', NOW + 60).categories![0]!.statistics.dnfPercentage).toBe(100)
    const restored = { ...next, attempts: [correctTrainingResult(corrected, 'success', NOW + 70)] }
    expect(saveTraining(restored, saved.raw, storage).ok).toBe(true)
    expect(restored.attempts[0]!.estimatedRecognitionExecutionMs).toBeNull()
    expect(restored.attempts[0]!.estimateUnavailableReason).toBe('not-recorded')
  })
  it('rejects silent DNF/timing/estimate changes and unsupported new writes', () => {
    const { data, raw, storage } = saveInitial()
    for (const change of [{ result: { status: 'valid', penalty: 'dnf' }, estimatedRecognitionExecutionMs: null }, { rawMs: 2600, estimatedRecognitionExecutionMs: 1700 }, { estimatedRecognitionExecutionMs: 1500 }, { rulesVersion: undefined }]) {
      expect(saveTraining({ ...data, attempts: [{ ...data.attempts[0], ...change }] } as TrainingData, raw, storage).ok).toBe(false)
    }
    const { rulesVersion: _rules, ...legacy } = data.attempts[0]!
    const candidate = { ...data, attempts: [{ ...legacy, id: 'unsupported', result: { status: 'valid' as const, penalty: '+2' as const } }], visits: [{ ...data.visits[0]!, attemptIds: ['unsupported'] }] }
    expect(saveTraining(candidate, raw, storage).ok).toBe(false)
    expect(() => createTrainingAttempt({ setup: setup(), visitId: 'v', rawMs: 1, inspectionMs: 0 } as Parameters<typeof createTrainingAttempt>[0])).toThrow('no inspection')
  })
  it('captures custom renewal thresholds without changing previous calibrations or losing completions at equal timestamps', () => {
    const data = populated()
    const settings = { ...data, preferences: { ...data.preferences, sets: { ...data.preferences.sets, oll: { ...data.preferences.sets.oll, recognition: { renewalDays: 2, renewalAttempts: 3 } } } } }
    const draft = [7, 6, 5, 4, 3, 2, 1].reduce((d, ms) => addCalibrationSample(d, ms), beginCalibration('oll'))
    const next = completeCalibration(settings, draft, { id: 'new', at: NOW + 10 })
    expect(next.calibrations[0]!.renewal).toEqual({ days: 7, recognitionAttempts: 100 })
    expect(next.calibrations[1]!.renewal).toEqual({ days: 2, recognitionAttempts: 3 })
    expect(recognitionCount(next, 'oll')).toBe(1)
    const renewed = appendTrainingAttempt(next, createTrainingAttempt({ setup: setup('oll', 'recognition'), calibration: next.calibrations[1], visitId: 'v', rawMs: 2000, createdAt: NOW + 10 }))
    expect(recognitionCount(renewed, 'oll')).toBe(2)
  })
  it('round-trips category-switch endings and pending report acknowledgement without altering ordinary data', () => {
    const { data, raw, storage } = saveInitial()
    const next = transitionTrainingVisit(data, { type: 'select-category', categoryId: 'pll:execution', at: NOW + 20, newVisitId: 'pll' }).data
    expect(saveTraining(next, raw, storage).ok).toBe(true)
    expect([...storage.values.keys()]).toEqual([TRAINING_STORAGE_KEY])
    expect(deserializeTrainingData(serializeTrainingData(next))).toEqual(next)
  })
})

it('rejects historical calibration removal and returns safe failures for uncountable legacy offsets', () => {
  const { data, raw, storage } = saveInitial()
  expect(saveTraining({ ...data, calibrations: [] }, raw, storage).ok).toBe(false)
  const brokenCounter = JSON.parse(raw)
  delete brokenCounter.recognitionCounts
  brokenCounter.calibrations[0].recognitionAttemptsAtMeasurement = Number.MAX_SAFE_INTEGER
  brokenCounter.attempts[0].calibration.recognitionAttemptsAtMeasurement = Number.MAX_SAFE_INTEGER
  const legacyRaw = JSON.stringify(brokenCounter)
  storage.setItem(TRAINING_STORAGE_KEY, legacyRaw)
  expect(loadTraining(storage).ok).toBe(true)
  expect(saveTraining(deserializeTrainingData(legacyRaw), legacyRaw, storage)).toMatchObject({ ok: false, reason: 'invalid' })
  expect(storage.getItem(TRAINING_STORAGE_KEY)).toBe(legacyRaw)
})

it('preserves calibration completion order and rejects counters below retained history', () => {
  const { data, raw, storage } = saveInitial()
  const draft = [1, 2, 3, 4, 5, 6, 7].reduce((d, ms) => addCalibrationSample(d, ms), beginCalibration('pll'))
  const next = completeCalibration(data, draft, { id: 'pll', at: NOW + 20 })
  const saved = saveTraining(next, raw, storage)
  if (!saved.ok) throw Error(saved.error)
  expect(saveTraining({ ...next, calibrations: [...next.calibrations].reverse() }, saved.raw, storage).ok).toBe(false)
  expect(next.attempts[0]!.estimatedRecognitionExecutionMs).toBe(1600)
  expect(next.attempts[0]!.calibration).toEqual(data.attempts[0]!.calibration)
  const tooSmall = JSON.stringify({ ...data, recognitionCounts: { oll: 0, pll: 0 } })
  storage.setItem(TRAINING_STORAGE_KEY, tooSmall)
  expect(loadTraining(storage)).toMatchObject({ ok: false, raw: tooSmall })
})
