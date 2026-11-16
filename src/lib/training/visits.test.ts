import { describe, expect, it } from 'vitest'
import { transitionTrainingVisit, pendingTrainingReports, acknowledgeTrainingReport } from './visits'
import { calculateTrainingReport } from './reports'
import { createEmptyTrainingData, deserializeTrainingData, serializeTrainingData } from './storage'
import { appendTrainingAttempt, createTrainingAttempt, createTrainingVisit, correctTrainingAttribution } from './records'
import { NOW, setup, calibration } from './persistenceFixtures.test-support'
import type { TrainingData, TrainingCategoryId } from './types'

function start(categoryId: TrainingCategoryId = 'oll:execution') {
  return transitionTrainingVisit(createEmptyTrainingData(), { type: 'select-category', categoryId, at: NOW, newVisitId: 'v' }).data
}
function record(data: TrainingData, at = NOW + 10) {
  return appendTrainingAttempt(data, createTrainingAttempt({ setup: setup(), visitId: data.activeVisitId!, rawMs: 2000, createdAt: at }))
}

describe('pure practice-visit lifecycle', () => {
  it('opening does not start a visit/calibration; selecting a category starts one and refresh resumes', () => {
    const empty = createEmptyTrainingData()
    expect(transitionTrainingVisit(empty, { type: 'open-training', at: NOW }).data).toEqual(empty)
    const data = record(start())
    const refreshed = transitionTrainingVisit(deserializeTrainingData(serializeTrainingData(data)), { type: 'startup', continuity: 'refresh', at: NOW + 20 })
    expect(refreshed.decision).toBe('resumed')
    expect(refreshed.data.activeVisitId).toBe('v')
    expect(refreshed.data.visits).toHaveLength(1)
    expect(transitionTrainingVisit(data, { type: 'startup', continuity: 'unknown', at: NOW + 20 }).decision).toBe('needs-continuity-signal')
  })
  it('case/algorithm activity continues the visit, each mode/set switch ends it, navigation ends it', () => {
    let data = record(start())
    data = transitionTrainingVisit(data, { type: 'activity', at: NOW + 20 }).data
    expect(data.visits).toHaveLength(1)
    for (const [i, categoryId] of (['oll:recognition', 'pll:recognition', 'pll:execution'] as const).entries()) {
      data = transitionTrainingVisit(data, { type: 'select-category', categoryId, at: NOW + 30 + i, newVisitId: `v${i}` }).data
    }
    expect(data.visits).toHaveLength(4)
    expect(data.visits.every((v) => v.categoryIds.length === 1)).toBe(true)
    expect(pendingTrainingReports(data)).toEqual(['v'])
    for (const destination of ['timer', 'analytics'] as const) {
      const ended = transitionTrainingVisit(data, { type: 'navigate', destination, at: NOW + 50 }).data
      expect(ended.activeVisitId).toBeNull()
    }
  })
  it('ends at inactivity threshold, defers running attempts, and completion activity renews the deadline', () => {
    const data = record(start())
    expect(transitionTrainingVisit(data, { type: 'tick', at: NOW + 10 + 15 * 60000 - 1 }).decision).toBe('unchanged')
    const due = NOW + 10 + 15 * 60000
    expect(transitionTrainingVisit(data, { type: 'tick', at: due, attemptRunning: true }).decision).toBe('deferred-running')
    const continued = record(data, due + 10)
    expect(transitionTrainingVisit(continued, { type: 'tick', at: due + 11 }).decision).toBe('unchanged')
    const ended = transitionTrainingVisit(data, { type: 'tick', at: due }).data
    expect(ended.visits[0]).toMatchObject({ endedAt: due, lifecycle: { endReason: 'inactivity', reportPending: true } })
    expect(transitionTrainingVisit(data, { type: 'navigate', destination: 'timer', at: due, attemptRunning: true }).decision).toBe('deferred-running')
  })
  it('finalizes known closure on startup and retains pending non-blocking reports until acknowledged', () => {
    const data = record(start())
    const recovered = transitionTrainingVisit(data, { type: 'startup', continuity: 'closed', closedAt: NOW + 30, at: NOW + 100 }).data
    expect(recovered.activeVisitId).toBeNull()
    expect(recovered.visits[0]!.endedAt).toBe(NOW + 30)
    expect(pendingTrainingReports(recovered)).toEqual(['v'])
    const returned = transitionTrainingVisit(recovered, { type: 'select-category', categoryId: 'oll:execution', at: NOW + 100, newVisitId: 'next' }).data
    expect(returned.activeVisitId).toBe('next')
    expect(pendingTrainingReports(returned)).toEqual(['v'])
    expect(pendingTrainingReports(acknowledgeTrainingReport(returned, 'v'))).toEqual([])
    const logical = transitionTrainingVisit(data, { type: 'startup', continuity: 'closed', at: NOW + 100 }).data
    expect(logical.visits[0]!.endedAt).toBe(NOW + 10)
    expect(() => transitionTrainingVisit(data, { type: 'startup', continuity: 'closed', closedAt: NOW - 1, at: NOW + 100 })).toThrow()
  })
  it('preserves captured policies and handles legacy visits without inventing a historical policy', () => {
    const data = start()
    const changed = { ...data, preferences: { ...data.preferences, domain: { ...data.preferences.domain!, baseline: { kind: 'attempts' as const, count: 2 }, inactivityMinutes: 1 } } }
    expect(changed.visits[0]!.lifecycle!.baseline).toEqual({ kind: 'days', count: 90 })
    expect(transitionTrainingVisit(changed, { type: 'tick', at: NOW + 60000 }).decision).toBe('unchanged')
    const { lifecycle: _lifecycle, ...legacy } = createTrainingVisit('oll:execution', NOW, 'legacy')
    const old = { ...createEmptyTrainingData(), visits: [legacy], activeVisitId: 'legacy' }
    expect(transitionTrainingVisit(old, { type: 'startup', continuity: 'refresh', at: NOW + 10 }).decision).toBe('legacy-visit-needs-finalization')
    expect(calculateTrainingReport(old, 'legacy').status).toBe('baseline-policy-unavailable')
  })
})

describe('recalculated reports', () => {
  it('uses exact associated attempts, excludes future records and recalculates after deletion/attribution correction', () => {
    let historical = record(start(), NOW + 10)
    historical = transitionTrainingVisit(historical, { type: 'navigate', destination: 'timer', at: NOW + 20 }).data
    let data = transitionTrainingVisit(historical, { type: 'select-category', categoryId: 'oll:execution', at: NOW + 100, newVisitId: 'new' }).data
    const current = createTrainingAttempt({ id: 'current', setup: setup(), visitId: 'new', rawMs: 1000, createdAt: NOW + 110 })
    data = appendTrainingAttempt(data, current)
    data = transitionTrainingVisit(data, { type: 'navigate', destination: 'analytics', at: NOW + 120 }).data
    const report = calculateTrainingReport(data, 'new')
    expect(report).toMatchObject({ status: 'value', categories: [{ statistics: { totalAttempts: 1, raw: { meanMs: 1000 } }, comparison: { changePercent: null, minimum: 5 } }] })
    const corrected = { ...data, attempts: data.attempts.map((a) => a.id === 'current' ? correctTrainingAttribution(a, { id: 'corrected', revision: 2, notation: null }, NOW + 130) : a) }
    const recalculated = calculateTrainingReport(corrected, 'new')
    expect(recalculated.categories![0]!.algorithms[0]!.algorithm.id).toBe('corrected')
    expect(calculateTrainingReport({ ...data, attempts: data.attempts.filter((a) => a.id !== 'current') }, 'new').status).toBe('empty')
    const injected = { ...data, attempts: [...data.attempts, { ...current, id: 'future', createdAt: NOW + 500 }], visits: data.visits.map((v) => v.id === 'new' ? { ...v, attemptIds: [...v.attemptIds, 'future'] } : v) }
    expect(calculateTrainingReport(injected, 'new').categories![0]!.statistics.totalAttempts).toBe(1)
    expect(calculateTrainingReport(data, 'missing').status).toBe('missing-visit')
  })
  it('reports DNFs and empty/insufficient histories meaningfully with separate recognition estimates', () => {
    const visit = createTrainingVisit('oll:recognition', NOW, 'r')
    let data: TrainingData = { ...createEmptyTrainingData(), visits: [visit], activeVisitId: 'r' }
    for (const penalty of ['none', 'dnf'] as const) data = appendTrainingAttempt(data, createTrainingAttempt({ setup: setup('oll', 'recognition'), visitId: 'r', rawMs: 2000, calibration: calibration(), createdAt: NOW + 10, result: { status: 'valid', penalty } }))
    data = transitionTrainingVisit(data, { type: 'tab-closed', at: NOW + 20 }).data
    expect(calculateTrainingReport(data, 'r')).toMatchObject({ status: 'value', categories: [{ statistics: { totalAttempts: 2, dnfAttempts: 1, dnfPercentage: 50, estimated: { count: 1, meanMs: 1100 } }, comparison: { changePercent: null } }] })
    expect(pendingTrainingReports(start())).toEqual([])
  })
})

it('captures customized inactivity and baseline policies and resumes only before inactivity is due', () => {
  const empty = createEmptyTrainingData()
  const configured = { ...empty, preferences: { ...empty.preferences, domain: { ...empty.preferences.domain!, inactivityMinutes: 1, baseline: { kind: 'attempts' as const, count: 5 } } } }
  const data = transitionTrainingVisit(configured, { type: 'select-category', categoryId: 'oll:execution', at: NOW, newVisitId: 'custom' }).data
  expect(data.visits[0]!.lifecycle).toMatchObject({ inactivityMinutes: 1, baseline: { kind: 'attempts', count: 5 } })
  expect(transitionTrainingVisit(data, { type: 'startup', continuity: 'refresh', at: NOW + 60000 }).decision).toBe('ended')
  expect(pendingTrainingReports(transitionTrainingVisit(data, { type: 'tick', at: NOW + 60000 }).data)).toEqual([])
  expect(calculateTrainingReport(data, 'custom').status).toBe('cutoff-required')
})
