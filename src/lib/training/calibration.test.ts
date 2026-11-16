// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { applyAlgorithm, isIdentical, loadCube3Model, type Cube3Model } from './cube3'
import { addCalibrationSample, beginCalibration, cancelCalibration, completeCalibration, calibrationState, decideTrainingActivation, estimateRecognitionTime, recognitionCount, latestTrainingCalibration, CALIBRATION_PROTOCOLS } from './calibration'
import { getTrainingDomainSettings } from './settings'
import { createEmptyTrainingData } from './storage'
import { appendTrainingAttempt, createTrainingAttempt, createTrainingVisit } from './records'
import { NOW, calibration, setup } from './persistenceFixtures.test-support'
import type { TrainingData } from './types'

let model: Cube3Model
beforeAll(async () => { model = await loadCube3Model() })
const success = { status: 'valid', penalty: 'none' } as const
const dnf = { status: 'valid', penalty: 'dnf' } as const
const settings = getTrainingDomainSettings(createEmptyTrainingData().preferences)
function seven(setId: 'oll' | 'pll' = 'oll') {
  return [700, 200, 900, 400, 100, 800, 600].reduce((draft, ms) => addCalibrationSample(draft, ms), beginCalibration(setId))
}

describe('fixed seven-sample calibration', () => {
  it.each(['oll', 'pll'] as const)('uses only the fixed solved-state inverse setup for %s', (setId) => {
    const p = CALIBRATION_PROTOCOLS[setId]
    expect(p.scramble).toBe(setId === 'oll' ? "R U R' U'" : "R U2 R' U' R U' R'")
    expect(isIdentical(applyAlgorithm(applyAlgorithm(model.solved, p.scramble), p.precursor), model.solved)).toBe(true)
  })
  it('discards invalid samples, keeps outliers, requires exactly seven, and replaces only on completion', () => {
    const data = { ...createEmptyTrainingData(), calibrations: [calibration()] }
    let draft = beginCalibration('oll')
    for (const ms of [0, -1, NaN, Infinity]) draft = addCalibrationSample(draft, ms)
    expect(draft.samplesMs).toEqual([])
    expect(draft.invalidSampleCount).toBe(4)
    expect(() => completeCalibration(data, draft, { id: 'new', at: NOW })).toThrow()
    for (const ms of [5, 2, 3, 4, 1, 1000000, 6]) draft = addCalibrationSample(draft, ms)
    const next = completeCalibration(data, draft, { id: 'new', at: NOW })
    expect(next.calibrations[1]).toMatchObject({ medianMs: 4, protocol: 'fixed-inverse-precursor:v1', invalidSampleCount: 4 })
    expect(next.calibrations[1]!.samplesMs).toEqual([5, 2, 3, 4, 1, 1000000, 6])
    expect(data.calibrations).toEqual([calibration()])
    expect(next.attempts).toEqual([])
    expect(() => addCalibrationSample(draft, 7)).toThrow()
    expect(() => completeCalibration(data, cancelCalibration(draft), { id: 'new', at: NOW })).toThrow()
    expect(() => completeCalibration(next, seven(), { id: 'new', at: NOW + 1 })).toThrow()
  })
  it('keeps OLL/PLL records and captured thresholds independent', () => {
    let data = completeCalibration(createEmptyTrainingData(), seven(), { id: 'oll', at: NOW })
    data = completeCalibration(data, seven('pll'), { id: 'pll', at: NOW + 1 })
    expect(data.calibrations.map((c) => c.setId)).toEqual(['oll', 'pll'])
    expect(data.calibrations[0]!.renewal).toEqual({ days: 7, recognitionAttempts: 100 })
    expect(data.recognitionCounts).toEqual({ oll: 0, pll: 0 })
  })
})

describe('activation and renewal', () => {
  it('never calibrates on page opening, and execution needs only one case', () => {
    expect(decideTrainingActivation({ event: 'open-training' })).toEqual({ state: 'mode-selection' })
    expect(decideTrainingActivation({ event: 'select-mode', categoryId: 'oll:execution', caseIds: ['oll:27'], calibration: null, now: NOW, recognitionCount: 0, settings })).toMatchObject({ state: 'ready' })
  })
  it('requires two distinct, enabled, same-set recognition cases and valid initial calibration', () => {
    const input = { event: 'select-mode', categoryId: 'oll:recognition', caseIds: ['oll:26', 'oll:27'], calibration: null, now: NOW, recognitionCount: 0, settings } as const
    expect(decideTrainingActivation(input)).toMatchObject({ state: 'calibration-required', reason: 'missing-calibration' })
    for (const ids of [[], ['oll:27'], ['oll:27', 'oll:27'], ['oll:27', 'pll:ua'], ['oll:999', 'oll:27']]) {
      expect(decideTrainingActivation({ ...input, caseIds: ids })).toMatchObject({ state: 'invalid-selection' })
    }
    expect(decideTrainingActivation({ ...input, enabledCaseIds: ['oll:27'] })).toMatchObject({ state: 'invalid-selection' })
    expect(decideTrainingActivation({ ...input, calibration: calibration('pll') })).toMatchObject({ state: 'calibration-required', reason: 'invalid-calibration' })
    expect(decideTrainingActivation({ ...input, event: 'cancel-calibration' })).toEqual({ state: 'mode-selection' })
  })
  it('uses exact day/count boundaries, recommends by default, and defers all gates while running', () => {
    const c = calibration()
    const at = c.measuredAt
    expect(calibrationState(c, 'oll', at + 7 * 86400000 - 1, 99).status).toBe('valid')
    expect(calibrationState(c, 'oll', at + 7 * 86400000, 99)).toMatchObject({ status: 'renewal-due', daysDue: true, attemptsDue: false })
    expect(calibrationState(c, 'oll', at, 100)).toMatchObject({ status: 'renewal-due', attemptsDue: true })
    const input = { event: 'select-mode', categoryId: 'oll:recognition', caseIds: ['oll:26', 'oll:27'], calibration: c, now: NOW, recognitionCount: 100, settings } as const
    expect(decideTrainingActivation(input)).toMatchObject({ state: 'ready', renewalRecommended: true })
    const forced = { ...input, settings: { ...settings, requireRecalibrationWhenDue: true } }
    expect(decideTrainingActivation(forced)).toMatchObject({ state: 'calibration-required', reason: 'renewal-due' })
    expect(decideTrainingActivation({ ...forced, event: 'cancel-calibration' })).toEqual({ state: 'mode-selection' })
    expect(decideTrainingActivation(forced)).toMatchObject({ state: 'calibration-required' })
    expect(decideTrainingActivation({ ...forced, attemptRunning: true })).toEqual({ state: 'continue-running' })
    expect(calibrationState({ ...c, medianMs: 600 }, 'oll', NOW, 0).status).toBe('invalid-calibration')
    expect(calibrationState({ ...c, samplesMs: [0, 700, 800, 900, 1000, 1100, 1200] }, 'oll', NOW, 0).status).toBe('invalid-calibration')
  })
  it('counts recognition DNFs, excludes execution, and retains a high-water count after deletion', () => {
    const visit = createTrainingVisit('oll:recognition', NOW, 'v')
    let data: TrainingData = { ...createEmptyTrainingData(), visits: [visit], activeVisitId: 'v' }
    for (const result of [success, dnf]) data = appendTrainingAttempt(data, createTrainingAttempt({ setup: setup('oll', 'recognition'), visitId: 'v', rawMs: 2000, createdAt: NOW + 10, calibration: calibration(), result }))
    expect(recognitionCount(data, 'oll')).toBe(2)
    expect(recognitionCount(data, 'pll')).toBe(0)
    const deleted = { ...data, attempts: [], visits: [{ ...data.visits[0]!, attemptIds: [] }] }
    expect(recognitionCount(deleted, 'oll')).toBe(2)
    expect(recognitionCount({ ...createEmptyTrainingData(), calibrations: [{ ...calibration(), recognitionAttemptsAtMeasurement: 500 }] }, 'oll')).toBe(500)
  })
})

it('estimates retain raw time, accept zero, reject DNFs/missing/invalid/below-calibration, and allow optional due calibration', () => {
  const c = calibration()
  expect(estimateRecognitionTime(899, success, c, 'oll', NOW, 0)).toEqual({ status: 'below-calibration', estimateMs: null })
  expect(estimateRecognitionTime(900, success, c, 'oll', NOW, 0)).toEqual({ status: 'valid', estimateMs: 0 })
  expect(estimateRecognitionTime(1000, success, c, 'oll', NOW, 100)).toEqual({ status: 'renewal-due', estimateMs: 100 })
  expect(estimateRecognitionTime(1000, dnf, c, 'oll', NOW, 0)).toEqual({ status: 'dnf', estimateMs: null })
  expect(estimateRecognitionTime(1000, success, null, 'oll', NOW, 0).status).toBe('missing-calibration')
  expect(estimateRecognitionTime(1000, success, { ...c, medianMs: 700 }, 'oll', NOW, 0).status).toBe('invalid-calibration')
  const a = createTrainingAttempt({ setup: setup('oll', 'recognition'), visitId: 'v', rawMs: 1000, createdAt: NOW, calibration: c })
  expect(a.estimatedRecognitionExecutionMs).toBe(100)
  expect(a.rawMs).toBe(1000)
  expect(a.calibration!.medianMs).toBe(900)
  expect(() => createTrainingAttempt({ setup: setup('oll', 'recognition'), visitId: 'v', rawMs: 1000, createdAt: NOW })).toThrow()
  expect(() => createTrainingAttempt({ setup: setup(), visitId: 'v', rawMs: 1000, createdAt: NOW, result: { status: 'valid', penalty: '+2' } } as unknown as Parameters<typeof createTrainingAttempt>[0])).toThrow()
})

it('requires known protocol fidelity for new eligibility without rewriting untagged history', () => {
  const { protocol: _protocol, ...legacy } = calibration()
  expect(calibrationState(legacy, 'oll', NOW, 0).status).toBe('invalid-calibration')
  const forced = { ...settings, requireRecalibrationWhenDue: true }
  const input = { event: 'begin-attempt' as const, categoryId: 'oll:recognition' as const, caseIds: ['oll:26', 'oll:27'], calibration: calibration(), now: NOW, recognitionCount: 100, settings: forced }
  expect(decideTrainingActivation(input)).toMatchObject({ state: 'calibration-required', reason: 'renewal-due' })
  expect(decideTrainingActivation({ ...input, recognitionCount: 99 })).toMatchObject({ state: 'ready' })
})

it('retries explicitly unsuccessful repetitions and preserves the prior calibration on cancellation', () => {
  const data = { ...createEmptyTrainingData(), calibrations: [calibration()] }
  const before = JSON.stringify(data)
  const draft = addCalibrationSample(beginCalibration('oll'), 1000, false)
  expect(draft.samplesMs).toHaveLength(0)
  expect(draft.invalidSampleCount).toBe(1)
  expect(() => completeCalibration(data, cancelCalibration(seven()), { id: 'cancelled', at: NOW })).toThrow()
  expect(JSON.stringify(data)).toBe(before)
  expect(() => completeCalibration(data, seven(), { id: 'earlier', at: NOW - 1001 })).toThrow()
})

it('activates the most recently completed calibration even when timestamps tie and IDs sort backwards', () => {
  const first = completeCalibration(createEmptyTrainingData(), seven(), { id: 'zz-old', at: NOW })
  const second = completeCalibration(first, seven(), { id: 'aa-new', at: NOW })
  expect(latestTrainingCalibration(second, 'oll')!.id).toBe('aa-new')
})
