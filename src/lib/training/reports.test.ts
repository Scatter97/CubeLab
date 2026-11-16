import { describe, expect, it } from 'vitest'
import { calibration, NOW, setup } from './persistenceFixtures.test-support'
import { calculateTrainingReport } from './reports'
import { createTrainingAttempt, createTrainingVisit, removeArchivedTrainingSession } from './records'
import { createEmptyTrainingData } from './storage'
import type { TrainingAttempt } from './types'

function attempt(id: string, rawMs: number, changes: Partial<TrainingAttempt> = {}): TrainingAttempt {
  return {
    ...createTrainingAttempt({ id, visitId: 'report', setup: setup(), createdAt: NOW, rawMs }),
    ...changes,
  }
}

function report(current: TrainingAttempt[], historical: TrainingAttempt[], legacy = false) {
  const visit = createTrainingVisit(current[0]!.categoryId, NOW, 'report')
  return calculateTrainingReport({
    ...createEmptyTrainingData(), attempts: [...historical, ...current],
    visits: [{ ...visit, lifecycle: legacy ? undefined : visit.lifecycle, endedAt: NOW + 100,
      attemptIds: current.map(item => item.id) }],
  }, visit.id)
}

describe('session reports', () => {
  it('estimates components from captured calibration and an exact pre-session execution median', () => {
    const algorithm = { id: 'preferred', revision: 1, notation: null }
    const attribution = { kind: 'assumed-preferred', algorithm } as const
    const recognition = (id: string, rawMs: number, changes: Partial<TrainingAttempt> = {}) => attempt(id, rawMs, {
      mode: 'recognition', categoryId: 'oll:recognition', calibration: calibration(), attribution, ...changes,
    })
    const history = [600, 800, 1000].map((ms, i) => attempt(`before-${i}`, ms, { createdAt: NOW - 10, attribution }))
    history.push(
      attempt('future', 1, { attribution, createdAt: NOW }),
      attempt('different-revision', 2, { createdAt: NOW - 1, attribution: { ...attribution, algorithm: { ...algorithm, revision: 2 } } }),
      attempt('different-case', 1, { createdAt: NOW - 1, attribution, caseId: 'oll:26' }),
      attempt('dnf', 1, { createdAt: NOW - 1, attribution, result: { status: 'valid', penalty: 'dnf' } }),
    )
    const current = [recognition('a', 2000), recognition('b', 1400), recognition('c', 600),
      recognition('d', 2200, { attribution: { kind: 'unknown', markedAt: null } })]
    const result = report(current, history).categories![0]!
    expect(result.points.map(p => [p.combinedMs, p.executionMs, p.recognitionMs])).toEqual([
      [1100, 800, 300], [500, null, null], [null, null, null], [1300, null, null],
    ])
    expect(result.timing).toMatchObject({ combined: { count: 3 }, execution: { count: 1 }, recognition: { meanMs: 300 } })
    expect(report([current[0]!], history.slice(0, 2)).categories![0]!.points[0]!.executionMs).toBeNull()
  })

  it('requires five samples per side for a single case and three cases with three samples each overall', () => {
    const rows = (prefix: string, n: number, caseId: TrainingAttempt['caseId'], raw: number, createdAt: number) =>
      Array.from({ length: n }, (_, i) => attempt(`${prefix}-${caseId}-${i}`, raw, { caseId, createdAt }))
    const cases = ['oll:26', 'oll:27', 'oll:28'] as const
    const prior = cases.flatMap(caseId => rows('prior', 5, caseId, 1000, NOW - 1))
    expect(report(rows('now', 4, 'oll:27', 950, NOW), prior).categories![0]!.comparison?.changePercent).toBeNull()
    expect(report(rows('now', 5, 'oll:27', 950, NOW), prior).categories![0]!.comparison?.changePercent).toBe(-5)
    const current = cases.flatMap(caseId => rows('now', 3, caseId, 1080, NOW))
    expect(report(current.slice(0, 6), prior).categories![0]!.comparison?.changePercent).toBeNull()
    expect(report(current, prior).categories![0]!.comparison).toMatchObject({ matchedCases: 3, changePercent: 8 })
  })

  it('keeps legacy measured results visible without inventing a comparison', () => {
    const result = report([attempt('saved', 2200)], [], true)
    expect(result.status).toBe('baseline-policy-unavailable')
    expect(result.categories![0]).toMatchObject({ comparison: null, statistics: { raw: { meanMs: 2200 } } })
  })

  it('recalculates a later report against retained history after archive deletion', () => {
    const earlier = createTrainingVisit('oll:execution', NOW - 10, 'baseline')
    const later = createTrainingVisit('oll:execution', NOW, 'report')
    const before = Array.from({ length: 5 }, (_, index) => attempt(`earlier-${index}`, 1000, { visitId: earlier.id, createdAt: NOW - 1 }))
    const after = Array.from({ length: 5 }, (_, index) => attempt(`later-${index}`, 950))
    const data = {
      ...createEmptyTrainingData(), attempts: [...before, ...after], visits: [
        { ...earlier, endedAt: NOW - 1, attemptIds: before.map(item => item.id),
          session: { version: 1 as const, name: 'Earlier', cases: [{ caseId: 'oll:27' as const, algorithm: setup().generatorAlgorithm }] } },
        { ...later, endedAt: NOW + 1, attemptIds: after.map(item => item.id) },
      ],
    }
    expect(calculateTrainingReport(data, later.id).categories![0]!.comparison?.changePercent).toBe(-5)
    const retained = removeArchivedTrainingSession(data, earlier.id)!
    expect(retained.attempts).toEqual(after)
    expect(calculateTrainingReport(retained, later.id).categories![0]).toMatchObject({
      comparison: { changePercent: null }, statistics: { recordedAttempts: 5, raw: { meanMs: 950 } },
    })
  })
})
