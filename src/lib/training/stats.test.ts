import { describe, expect, it } from 'vitest'
import { trainingStatistics, perCaseStatistics, perAlgorithmStatistics, historicalAttempts, compareTrainingHistory, trainingRollingAverage, trainingTimingWindows } from './stats'
import { createTrainingAttempt, correctTrainingAttribution } from './records'
import { NOW, setup, calibration } from './persistenceFixtures.test-support'
import type { TrainingAttempt, TrainingCategoryId } from './types'

const filter = { categoryId: 'oll:execution' as const }
function a(id: string, rawMs: number, dnf = false, at = NOW, category: TrainingCategoryId = 'oll:execution'): TrainingAttempt {
  const setId = category.startsWith('oll') ? 'oll' : 'pll'
  const mode = category.endsWith('recognition') ? 'recognition' : 'execution'
  return createTrainingAttempt({ id, rawMs, setup: { ...setup(setId, mode), generatedAt: Math.min(NOW, at) }, calibration: mode === 'recognition' ? calibration(setId) : null, visitId: 'v', createdAt: at, result: { status: 'valid', penalty: dnf ? 'dnf' : 'none' } })
}

describe('Training statistics', () => {
  it('separates all four categories and raw/estimated series, with successful-only mean/PB', () => {
    const records = [a('a', 1000), a('b', 3000), a('c', 1, true), a('d', 99999, false, NOW, 'pll:execution'), a('e', 2000, false, NOW, 'oll:recognition'), a('f', 3000, false, NOW, 'pll:recognition')]
    expect(trainingStatistics(records, filter)).toMatchObject({ totalAttempts: 3, successfulAttempts: 2, dnfAttempts: 1, raw: { meanMs: 2000, bestMs: 1000 } })
    expect(trainingStatistics(records, filter).dnfPercentage).toBeCloseTo(100 / 3)
    for (const categoryId of ['oll:recognition', 'pll:execution', 'pll:recognition'] as const) expect(trainingStatistics(records, { categoryId }).totalAttempts).toBe(1)
    expect(trainingStatistics(records, { categoryId: 'oll:recognition' }).estimated).toMatchObject({ count: 1, meanMs: 1100, bestMs: 1100 })
    expect(trainingStatistics(records, filter, 2).recentAttempts.map((v) => v.id)).toEqual(['c', 'b'])
  })
  it('preserves unknown attribution at case level and separates algorithm IDs/revisions', () => {
    const records = [a('a', 1000), correctTrainingAttribution(a('b', 2000), { id: 'alg', revision: 1, notation: null }), correctTrainingAttribution(a('c', 3000), { id: 'alg', revision: 2, notation: null })]
    expect(perCaseStatistics(records, filter)[0]!.statistics.totalAttempts).toBe(3)
    const algorithms = perAlgorithmStatistics(records, filter)
    expect(algorithms.map((v) => [v.algorithm.id, v.algorithm.revision, v.statistics.totalAttempts])).toEqual([['alg', 1, 1], ['alg', 2, 1]])
  })
  it('explicitly excludes unsupported legacy +2/invalid records instead of converting them', () => {
    const records: TrainingAttempt[] = [a('a', 1000), { ...a('b', 2000), rulesVersion: undefined, result: { status: 'valid', penalty: '+2' } }, { ...a('c', 1), rulesVersion: undefined, result: { status: 'invalid', reason: 'legacy' } }]
    expect(trainingStatistics(records, filter)).toMatchObject({ recordedAttempts: 3, totalAttempts: 1, unsupportedAttempts: 2, raw: { meanMs: 1000 } })
  })
})

describe('historical case-matched baselines', () => {
  it('uses half-open day boundaries and deterministic latest X attempts including DNFs', () => {
    const cutoff = NOW + 2 * 86400000
    const records = [a('old', 100, false, NOW - 1), a('a', 2000), a('b', 1, true), a('c', 3000, false, NOW + 1), a('cutoff', 900, false, cutoff), a('future', 800, false, cutoff + 1), a('other', 10, false, NOW + 1, 'pll:execution')]
    expect(historicalAttempts(records, filter, cutoff, { kind: 'days', count: 2 }).map((v) => v.id)).toEqual(['a', 'b', 'c'])
    expect(historicalAttempts(records, filter, cutoff, { kind: 'attempts', count: 2 }).map((v) => v.id)).toEqual(['b', 'c'])
    expect(trainingStatistics(historicalAttempts(records, filter, cutoff, { kind: 'attempts', count: 2 }), filter)).toMatchObject({ dnfPercentage: 50, raw: { meanMs: 3000 } })
    expect(historicalAttempts([...records].reverse(), filter, cutoff, { kind: 'attempts', count: 2 }).map((v) => v.id)).toEqual(['b', 'c'])
  })
  it('compares matching cases only and returns insufficient history for absent/DNF/zero baselines', () => {
    const current = [a('new', 1000, false, NOW + 100)]
    expect(compareTrainingHistory([a('old', 2000, false, NOW - 1), ...current], current, filter, NOW, { kind: 'days', count: 90 })).toMatchObject({ status: 'value', improvementPercent: 50, matchedCases: 1 })
    for (const old of [[], [a('other', 20, false, NOW - 1, 'pll:execution')], [a('dnf', 1, true, NOW - 1)], [a('zero', 0, false, NOW - 1)]]) {
      expect(compareTrainingHistory(old, current, filter, NOW, { kind: 'days', count: 90 }).status).toBe('insufficient-history')
    }
  })
})

describe('configurable trimmed rolling averages', () => {
  it('trims ceil(N*p/100) on each side, DNFs worst, never rounds raw measurements', () => {
    const values = [a('1', 1000.25), a('2', 2000.25), a('3', 3000.25), a('4', 4000.25), a('5', 100, true)]
    expect(trainingRollingAverage(values, filter, 5, 5)).toMatchObject({ status: 'value', ms: 3000.25, trimCount: 1 })
    expect(trainingRollingAverage([...values.slice(0, 3), a('4', 1, true), a('5', 1, true)], filter, 5, 5).status).toBe('dnf')
    expect(trainingRollingAverage(values, filter, 5, 0).status).toBe('dnf')
    expect(trainingRollingAverage(values, filter, 6, 5).status).toBe('insufficient-history')
  })
  it('defines small-window/invalid-trim states and stable duplicate handling', () => {
    for (const n of [1, 2]) expect(trainingRollingAverage([a('1', 1000), a('2', 2000)], filter, n, 5).status).toBe('insufficient-window')
    expect(trainingRollingAverage([a('1', 1000)], filter, 1, 0)).toMatchObject({ status: 'value', ms: 1000 })
    expect(() => trainingRollingAverage([], filter, 5, 50)).toThrow()
    expect(() => trainingRollingAverage([], filter, 5, -1)).toThrow()
    const duplicate = [a('a', 1000), a('b', 1000), a('c', 1000), a('d', 1000), a('e', 1000)]
    expect(trainingRollingAverage(duplicate.reverse(), filter, 5, 20)).toMatchObject({ status: 'value', ms: 1000 })
  })
  it('keeps missing estimates explicit and never substitutes raw times or zero', () => {
    const records = [a('a', 800, false, NOW, 'oll:recognition'), a('b', 900, false, NOW, 'oll:recognition'), a('c', 2000, false, NOW, 'oll:recognition')]
    const recognition = { categoryId: 'oll:recognition' as const }
    expect(trainingRollingAverage(records, recognition, 3, 5, 'estimated').status).toBe('unavailable-estimate')
    expect(trainingStatistics(records, recognition).estimated).toMatchObject({ count: 2, missing: 1, bestMs: 0, meanMs: 550 })
    expect(() => trainingRollingAverage(records, filter, 3, 5, 'estimated')).toThrow()
  })
})

it('uses equal case weighting for improvement, with no unrelated-case or algorithm-revision fallback', () => {
  const case26 = (attempt: TrainingAttempt): TrainingAttempt => ({ ...attempt, caseId: 'oll:26' })
  const history = [a('old27', 1000, false, NOW - 1), case26(a('old26', 2000, false, NOW - 1))]
  const current = [a('new27', 500, false, NOW + 1), ...Array.from({ length: 9 }, (_, i) => case26(a(`new26-${i}`, 3000, false, NOW + 1)))]
  const result = compareTrainingHistory(history, current, filter, NOW, { kind: 'attempts', count: 1 })
  expect(result).toMatchObject({ status: 'value', improvementPercent: 0, matchedCases: 2 })
  const revision = { id: 'algorithm', revision: 2 }
  expect(compareTrainingHistory(history, current, { ...filter, algorithm: revision }, NOW, { kind: 'days', count: 90 }).status).toBe('insufficient-history')
  expect(historicalAttempts(history, { ...filter, caseId: 'oll:27' }, NOW, { kind: 'attempts', count: 1 }).map((v) => v.id)).toEqual(['old27'])
})

it('uses exact ceiling counts for larger windows and preserves duplicate/DNF determinism', () => {
  const values = Array.from({ length: 12 }, (_, i) => a(String(i).padStart(2, '0'), (i + 1) * 1000, i >= 10))
  expect(trainingRollingAverage(values, filter, 12, 5).status).toBe('dnf')
  expect(trainingRollingAverage(values, filter, 12, 10)).toMatchObject({ status: 'value', trimCount: 2, ms: 6500 })
  expect(trainingRollingAverage(values, filter, 12, 25)).toMatchObject({ status: 'value', trimCount: 3, ms: 6500 })
  expect(trainingRollingAverage(values, filter, 12, 10)).toEqual(trainingRollingAverage([...values].reverse(), filter, 12, 10))
  expect(trainingRollingAverage(values, filter, 4, 49).status).toBe('insufficient-window')
})

it('does not backfill legacy missing estimates or recalculate stored estimates from new calibrations', () => {
  const measured = a('a', 2000, false, NOW, 'oll:recognition')
  const missing = { ...measured, id: 'legacy', estimatedRecognitionExecutionMs: null }
  const recognition = { categoryId: 'oll:recognition' as const }
  expect(trainingStatistics([measured, missing], recognition).estimated).toMatchObject({ count: 1, missing: 1, meanMs: 1100 })
  expect(measured.calibration!.medianMs).toBe(900)
  expect(trainingStatistics([measured], recognition).estimated!.meanMs).toBe(1100)
  expect(trainingRollingAverage([a('e', 1000)], filter, 1, 0)).toEqual({ status: 'value', ms: 1000, trimCount: 0 })
})

describe('Training timing rows', () => {
  it('uses latest and fastest finite windows without reinterpreting DNFs or changing trim', () => {
    const records = [a('a', 1000), a('b', 2000), a('c', 3000), a('d', 4000), a('e', 5000), a('f', 200, true), a('g', 200, true)]
    const average = trainingTimingWindows(records, 5, 5, 'raw')
    expect(average.current.result).toEqual(trainingRollingAverage(records, filter, 5, 5))
    expect(average.current.result.status).toBe('dnf')
    expect(average.best).toMatchObject({ end: 5, result: { status: 'value', ms: 3000 } })
    expect(trainingTimingWindows(records, 3, 0, 'raw').best).toMatchObject({ end: 3, result: { ms: 2000, trimCount: 0 } })
    expect(trainingTimingWindows(records, 1, 0, 'raw').best).toMatchObject({ end: 1, result: { ms: 1000 } })
    expect(trainingTimingWindows(records, 5, 5, 'raw', false).best).toBeNull()
  })

  it('keeps an unavailable current estimate and recognizes a stored zero best', () => {
    const available = a('a', 900, false, NOW, 'oll:recognition')
    const missing = { ...a('b', 2000, false, NOW, 'oll:recognition'), estimatedRecognitionExecutionMs: null }
    const records = [available, missing]
    expect(trainingTimingWindows(records, 1, 0, 'estimated')).toMatchObject({
      current: { result: { status: 'unavailable-estimate' } },
      best: { end: 1, result: { status: 'value', ms: 0 } },
    })
    expect(trainingTimingWindows(records, 1, 0, 'raw').current.result).toMatchObject({ ms: 2000 })
  })
})
