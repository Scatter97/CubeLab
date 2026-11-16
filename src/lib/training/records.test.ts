import { describe, expect, it } from 'vitest'
import { createTrainingAttempt, createTrainingVisit, appendTrainingAttempt, finishTrainingVisit, correctTrainingAttribution, selectTrainingAttempts } from './records'
import { createEmptyTrainingData, deserializeTrainingData, serializeTrainingData } from './storage'
import { TRAINING_CATEGORIES, type TrainingAttempt } from './types'
import { NOW, setup, calibration } from './persistenceFixtures.test-support'

function attempt(overrides: Partial<Parameters<typeof createTrainingAttempt>[0]> = {}) {
  return createTrainingAttempt({ setup: setup(), visitId: 'visit-1', rawMs: 2500, createdAt: NOW + 100, ...overrides })
}

describe('Training attempt records and visits', () => {
  it('creates stable distinct IDs and never infers the executed generator algorithm', () => {
    const a = attempt()
    expect(a.id).not.toBe(attempt().id)
    expect(a.attribution).toEqual({ kind: 'unknown', markedAt: null })
    expect(a.rawMs).toBe(2500)
    expect(a.result).toEqual({ status: 'valid', penalty: 'none' })
    expect(a.estimatedRecognitionExecutionMs).toBeNull()
  })

  it('captures preferred assumption and explicit corrections without rewriting the original', () => {
    const preferred = { id: 'my-algorithm', revision: 3, notation: "R U R'" }
    const original = attempt({ preferredAlgorithm: preferred })
    preferred.revision = 4
    expect(original.attribution).toEqual({ kind: 'assumed-preferred', algorithm: { ...preferred, revision: 3 } })
    const corrected = correctTrainingAttribution(original, { id: 'other', revision: 1, notation: null }, NOW + 200)
    const unknown = correctTrainingAttribution(corrected, null, NOW + 300)
    expect(corrected.attribution.kind).toBe('user-corrected')
    expect(unknown.attribution).toEqual({ kind: 'unknown', markedAt: NOW + 300 })
    expect(unknown.preferredAlgorithmAtStart).toEqual({ ...preferred, revision: 3 })
    expect(original.attribution.kind).toBe('assumed-preferred')
  })

  it('keeps all four categories separate in a readable legacy multi-category visit', () => {
    let data = createEmptyTrainingData()
    const { lifecycle: _lifecycle, ...visit } = createTrainingVisit('oll:execution', NOW, 'visit-1')
    data = { ...data, visits: [visit], activeVisitId: visit.id }
    const records: TrainingAttempt[] = []
    for (const category of TRAINING_CATEGORIES) {
      const setId = category.startsWith('oll:') ? 'oll' : 'pll'
      const mode = category.endsWith(':recognition') ? 'recognition' : 'execution'
      const a = attempt({ setup: setup(setId, mode), calibration: mode === 'recognition' ? calibration(setId) : null })
      records.push(a)
      data = appendTrainingAttempt(data, a)
    }
    for (const categoryId of TRAINING_CATEGORIES) {
      expect(selectTrainingAttempts(data, { categoryId })).toHaveLength(1)
    }
    expect(data.visits[0]!.categoryIds).toEqual(TRAINING_CATEGORIES)
    expect(data.visits[0]!.attemptIds).toEqual(records.map((a) => a.id))
    expect(deserializeTrainingData(serializeTrainingData(data))).toEqual(data)
    const finished = finishTrainingVisit(data, visit.id, NOW + 500)
    expect(finished.activeVisitId).toBeNull()
    expect(finished.visits[0]!.endedAt).toBe(NOW + 500)
    expect(finished.attempts).toEqual(data.attempts)
    expect(() => appendTrainingAttempt(finished, attempt())).toThrow()
    expect(() => appendTrainingAttempt(data, records[0]!)).toThrow()
  })

  it('filters by case, algorithm revision and visit within a required category; Unknown is excluded from algorithm filters', () => {
    const a = attempt({ preferredAlgorithm: { id: 'preferred', revision: 1, notation: null } })
    const b = attempt({ preferredAlgorithm: { id: 'preferred', revision: 2, notation: null } })
    const data = { ...createEmptyTrainingData(), attempts: [a, b, attempt()] }
    expect(selectTrainingAttempts(data, { categoryId: 'oll:execution', caseId: 'oll:27', visitId: 'visit-1' })).toHaveLength(3)
    expect(selectTrainingAttempts(data, { categoryId: 'oll:execution', algorithm: { id: 'preferred', revision: 2 } })).toEqual([b])
    expect(selectTrainingAttempts(data, { categoryId: 'pll:execution' })).toEqual([])
  })

  it('detaches calibration/setup snapshots and retains raw time', () => {
    const c = calibration()
    const generated = setup('oll', 'recognition')
    const a = attempt({ setup: generated, calibration: c, estimatedRecognitionExecutionMs: 1600 })
    expect(a.calibration).toEqual(c)
    expect(a.calibration).not.toBe(c)
    expect(a.setup).not.toBe(generated)
    expect(a.rawMs).toBe(2500)
    expect(a.estimatedRecognitionExecutionMs).toBe(1600)
    expect(() => attempt({ setup: generated })).toThrow('Recognition needs valid calibration')
  })

  it.each([
    { rawMs: -1 }, { rawMs: NaN }, { createdAt: Infinity },
    { calibration: calibration() }, { estimatedRecognitionExecutionMs: 1000 },
    { setup: setup('pll', 'recognition'), calibration: calibration('oll') },
    { setup: setup('oll', 'recognition'), calibration: calibration(), estimatedRecognitionExecutionMs: -1 },
    { setup: setup('oll', 'recognition'), calibration: calibration(), estimatedRecognitionExecutionMs: 1600, result: { status: 'invalid', reason: 'wrong case' } as const },
  ])('rejects invalid new attempt %j', (overrides) => {
    expect(() => attempt(overrides as unknown as Partial<Parameters<typeof createTrainingAttempt>[0]>)).toThrow()
  })
})
