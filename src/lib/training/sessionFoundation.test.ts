import { describe, expect, it } from 'vitest'
import { algorithmSnapshotFor } from './algorithmSelection'
import { builtInAlgorithmForCase } from './catalog/defaultAlgorithms'
import { STANDARD_CASE_BY_ID } from './catalog/standardCases'
import { calibration, NOW, setup } from './persistenceFixtures.test-support'
import { stripRetiredAlgorithmTracking } from './retiredAlgorithmTracking'
import { appendTrainingAttempt, correctTrainingAttribution, createTrainingAttempt, finishTrainingVisit, removeArchivedTrainingSession } from './records'
import { createEmptyTrainingData, deserializeTrainingData, saveTraining, serializeTrainingData } from './storage'
import type { TrainingCaseId, TrainingCategoryId, TrainingMode } from './types'
import { acknowledgeTrainingReport, beginTrainingSession, pendingTrainingReports, transitionTrainingVisit, type TrainingVisitEvent } from './visits'

function chooseCase(caseId: TrainingCaseId) {
  return { caseId, algorithm: { ...algorithmSnapshotFor(builtInAlgorithmForCase(caseId)!) } }
}

function executionSession() {
  return {
    id: 'named-visit', at: NOW, categoryId: 'oll:execution' as const,
    session: { version: 1 as const, name: 'OLL execution drill', cases: [chooseCase('oll:27')] },
  }
}

function namedAttempt(mode: TrainingMode, changes: Partial<Parameters<typeof createTrainingAttempt>[0]> = {}) {
  const algorithm = chooseCase('oll:27').algorithm
  const generated = setup('oll', mode)
  return createTrainingAttempt({
    id: 'attempt', visitId: 'named-visit', createdAt: NOW + 10, rawMs: 2400,
    setup: {
      ...generated, generatorAlgorithm: algorithm,
      generated: { ...generated.generated, targetAlgorithmId: algorithm.id, targetAlgorithmNotation: algorithm.notation! },
    },
    preferredAlgorithm: algorithm,
    calibration: mode === 'recognition' ? calibration() : null,
    ...changes,
  })
}

describe('visit-backed Training session foundation', () => {
  it('authorizes an exact archive projection and rejects collateral edits', () => {
    const input = executionSession()
    const active = beginTrainingSession(createEmptyTrainingData(), {
      ...input, categoryId: 'oll:recognition', session: { ...input.session, cases: [chooseCase('oll:26'), chooseCase('oll:27')] },
    })
    const recorded = appendTrainingAttempt(active, namedAttempt('recognition'))
    const ended = finishTrainingVisit(recorded, input.id, NOW + 20, 'manual')
    expect(removeArchivedTrainingSession(ended, input.id)).toBeNull()
    const archived = stripRetiredAlgorithmTracking(acknowledgeTrainingReport(ended, input.id, 'session'))
    let raw = serializeTrainingData(archived)
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value } }
    const next = removeArchivedTrainingSession(archived, input.id)!
    expect(saveTraining(next, raw, storage).ok).toBe(false)
    expect(saveTraining({ ...next, recognitionCounts: { oll: 0, pll: 0 } }, raw, storage, undefined, input.id).ok).toBe(false)
    expect(saveTraining(next, raw, storage, undefined, input.id).ok).toBe(true)
    expect(deserializeTrainingData(raw)).toMatchObject({ visits: [], attempts: [], recognitionCounts: { oll: 1, pll: 0 } })
  })
  it('retains old multi-category history and unknown JSON alongside a new session', () => {
    const oldAttempts = [
      createTrainingAttempt({ id: 'old-execution', visitId: 'old', setup: setup(), rawMs: 1400, createdAt: NOW }),
      createTrainingAttempt({ id: 'old-recognition', visitId: 'old', setup: setup('pll', 'recognition'), calibration: calibration('pll'), rawMs: 2300, createdAt: NOW }),
    ].map(({ rulesVersion: _rules, ...attempt }) => ({ ...attempt, historyExtension: { value: null } }))
    const legacy = {
      ...createEmptyTrainingData(), recognitionCounts: { oll: 0, pll: 1 }, historyExtension: ['kept'],
      attempts: oldAttempts,
      visits: [{
        version: 1, id: 'old', startedAt: NOW - 100, endedAt: NOW + 1,
        startedCategoryId: 'oll:execution', categoryIds: ['oll:execution', 'pll:recognition'],
        attemptIds: oldAttempts.map((attempt) => attempt.id), summaryId: null, historyExtension: [false, 2],
      }],
    }
    const raw = JSON.stringify(legacy)
    const loaded = deserializeTrainingData(raw)
    expect(serializeTrainingData(loaded)).toBe(raw)

    const mixed = beginTrainingSession(loaded, { ...executionSession(), at: NOW + 2 })
    const reloaded = deserializeTrainingData(serializeTrainingData(mixed))
    expect(reloaded).toEqual(mixed)
    expect(reloaded.attempts).toEqual(legacy.attempts)
    expect(reloaded.visits[0]).toEqual(legacy.visits[0])
    expect(reloaded).toMatchObject({ historyExtension: ['kept'], activeVisitId: 'named-visit' })
  })

  it('detaches the configuration and preserves captured policies and additive fields through reload', () => {
    const empty = createEmptyTrainingData()
    const data = { ...empty, preferences: { ...empty.preferences, domain: {
      ...empty.preferences.domain!, inactivityMinutes: 3, baseline: { kind: 'attempts' as const, count: 5 },
    } } }
    const input = executionSession()
    const configuration = { ...input.session, extension: { value: ['original'] } }
    const captured = structuredClone(configuration)
    const opened = beginTrainingSession(data, { ...input, session: configuration })
    configuration.name = 'Changed draft'
    configuration.cases[0]!.algorithm.revision++
    configuration.extension.value.push('Changed draft')
    expect(data.visits).toEqual([])

    const reloaded = deserializeTrainingData(serializeTrainingData({ ...opened, preferences: empty.preferences }))
    expect(reloaded.visits[0]).toMatchObject({
      id: input.id, startedAt: NOW, endedAt: null, attemptIds: [], categoryIds: ['oll:execution'], session: captured,
      lifecycle: { lastActivityAt: NOW, baseline: { kind: 'attempts', count: 5 }, inactivityMinutes: 3, endReason: null, reportPending: false },
    })
  })

  it('requires a valid category pool and a new visit identity', () => {
    const data = createEmptyTrainingData()
    const input = executionSession()
    const chosen = input.session.cases[0]!
    const invalid = [
      { ...input, session: { ...input.session, name: '  ' } },
      { ...input, session: { ...input.session, cases: [] } },
      { ...input, session: { ...input.session, cases: [chosen, chosen] } },
      { ...input, session: { ...input.session, cases: [chooseCase('pll:ua')] } },
      { ...input, session: { ...input.session, cases: [{ ...chosen, algorithm: { ...chosen.algorithm, notation: null } }] } },
      { ...input, categoryId: 'oll:recognition' as const },
    ]
    for (const candidate of invalid) expect(() => beginTrainingSession(data, candidate)).toThrow()

    const active = beginTrainingSession(data, input)
    expect(() => beginTrainingSession(active, { ...input, id: 'different' })).toThrow()
    const ended = finishTrainingVisit(active, input.id, NOW + 1, 'manual')
    expect(() => beginTrainingSession(ended, { ...input, at: NOW + 2 })).toThrow()
  })

  it('only accepts attempts prepared with the captured case and revision', () => {
    const active = beginTrainingSession(createEmptyTrainingData(), executionSession())
    const attempt = namedAttempt('execution')
    const differentCase = chooseCase('oll:26')
    const wrongCase = { ...attempt.setup, generatorAlgorithm: differentCase.algorithm, generated: {
      ...attempt.setup.generated, caseId: differentCase.caseId, targetAlgorithmId: differentCase.algorithm.id,
      targetAlgorithmNotation: differentCase.algorithm.notation!, verification: {
        ...attempt.setup.generated.verification, identity: differentCase.caseId,
        canonicalSignature: STANDARD_CASE_BY_ID.get(differentCase.caseId)!.canonicalSignature,
      },
    } }
    const wrongGenerator = { ...attempt.setup, generatorAlgorithm: { ...attempt.setup.generatorAlgorithm, revision: 2 } }
    const wrongNotation = { ...attempt.setup, generatorAlgorithm: { ...attempt.setup.generatorAlgorithm, notation: 'R U' } }
    expect(() => appendTrainingAttempt(active, namedAttempt('execution', { setup: setup('pll') }))).toThrow()
    expect(() => appendTrainingAttempt(active, namedAttempt('execution', { setup: wrongCase, preferredAlgorithm: differentCase.algorithm }))).toThrow()
    expect(() => appendTrainingAttempt(active, namedAttempt('execution', { setup: wrongGenerator }))).toThrow()
    expect(() => appendTrainingAttempt(active, namedAttempt('execution', { setup: wrongNotation }))).toThrow()
    expect(() => appendTrainingAttempt(active, namedAttempt('execution', { preferredAlgorithm: chooseCase('oll:26').algorithm }))).toThrow()

    const populated = appendTrainingAttempt(active, attempt)
    const corrected = correctTrainingAttribution(attempt, { id: 'oll:27:other-revision', revision: 2, notation: null }, NOW + 20)
    const unattributed = namedAttempt('execution', { id: 'unattributed', preferredAlgorithm: null })
    const withCorrection = appendTrainingAttempt({ ...populated, attempts: [corrected] }, unattributed)
    const reloaded = deserializeTrainingData(serializeTrainingData(withCorrection))
    expect(reloaded.attempts[0]).toMatchObject({ id: corrected.id, rawMs: corrected.rawMs, algorithmTracking: false, preferredAlgorithmAtStart: null, attribution: { kind: 'unknown', markedAt: null } })
    expect(reloaded.attempts[1]!.attribution).toEqual({ kind: 'unknown', markedAt: null })
    expect(reloaded.visits[0]!.attemptIds).toEqual([attempt.id, unattributed.id])
  })

  it('round-trips recovery for all-DNF sessions and leaves empty sessions without reports', () => {
    const input = executionSession()
    const categoryId: TrainingCategoryId = 'oll:recognition'
    const active = beginTrainingSession(createEmptyTrainingData(), {
      ...input, categoryId, session: { ...input.session, cases: [chooseCase('oll:26'), chooseCase('oll:27')] },
    })
    const emptyEnd = finishTrainingVisit(active, input.id, NOW + 20, 'manual')
    expect(emptyEnd.visits[0]!.lifecycle!.reportPending).toBe(false)

    const attempt = namedAttempt('recognition', { result: { status: 'valid', penalty: 'dnf' } })
    const populated = appendTrainingAttempt(active, attempt)
    const finished = finishTrainingVisit(populated, input.id, NOW + 20, 'manual')
    const reloaded = deserializeTrainingData(serializeTrainingData(finished))
    expect(reloaded.activeVisitId).toBeNull()
    expect(reloaded.attempts).toEqual([{ ...attempt, algorithmTracking: false, preferredAlgorithmAtStart: null, attribution: { kind: 'unknown', markedAt: null } }])
    expect(reloaded.visits[0]).toMatchObject({
      id: input.id, endedAt: NOW + 20, attemptIds: [attempt.id],
      lifecycle: { lastActivityAt: NOW + 10, endReason: 'manual', reportPending: true },
    })
    expect(pendingTrainingReports(reloaded)).toEqual([])
    expect(pendingTrainingReports(reloaded, 'session')).toEqual([input.id])
    expect(acknowledgeTrainingReport(reloaded, input.id)).toEqual(reloaded)
    const acknowledged = acknowledgeTrainingReport(reloaded, input.id, 'session')
    expect(pendingTrainingReports(deserializeTrainingData(serializeTrainingData(acknowledged)), 'session')).toEqual([])
    expect(() => appendTrainingAttempt(reloaded, { ...attempt, id: 'late' })).toThrow()
  })

  it('leaves named sessions intact on legacy automatic visit events', () => {
    const active = beginTrainingSession(createEmptyTrainingData(), executionSession())
    const at = NOW + 60 * 60_000
    const events: TrainingVisitEvent[] = [
      { type: 'open-training', at }, { type: 'activity', at }, { type: 'tick', at },
      { type: 'select-category', at, categoryId: 'pll:execution', newVisitId: 'legacy' },
      { type: 'navigate', at, destination: 'timer' }, { type: 'tab-closed', at },
      { type: 'startup', at, continuity: 'refresh' }, { type: 'startup', at, continuity: 'closed' },
      { type: 'startup', at, continuity: 'unknown' },
    ]
    for (const event of events) {
      const transition = transitionTrainingVisit(active, event)
      expect(transition.decision).toBe('session-needs-explicit-transition')
      expect(transition.data).toBe(active)
    }
    expect(transitionTrainingVisit(active, { type: 'tick', at, attemptRunning: true }))
      .toEqual({ decision: 'deferred-running', data: active })
  })
})
