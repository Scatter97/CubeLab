import { describe, expect, it } from 'vitest'
import { TrainingController } from './controller'
import { createEmptyTrainingData, TRAINING_STORAGE_KEY } from './storage'
import { NOW, calibration, setup } from './persistenceFixtures.test-support'
import { STANDARD_CASE_BY_ID } from './catalog/standardCases'
import { trainingVisitElapsed } from './records'
import { algorithmSnapshotFor } from './algorithmSelection'
import { builtInAlgorithmForCase } from './catalog/defaultAlgorithms'
import { getTrainingDomainSettings } from './settings'
import { buildTrainingAnalytics } from './analytics'
import { verifyCustomAlgorithm } from './runtime'
import type { StorageLike } from '../storage'

function fixture(data = createEmptyTrainingData(), generate?: NonNullable<ConstructorParameters<typeof TrainingController>[0]>['generate']) {
  let raw = JSON.stringify(data), fail = false
  const storage: StorageLike = { getItem: () => raw, setItem: (_key, value) => { if (fail) throw Error('quota'); raw = value } }
  let now = NOW
  const controller = new TrainingController({ storage, now: () => now, generate: generate ?? (async (data, category, previous) => {
    const s = setup(category.startsWith('oll') ? 'oll' : 'pll', category.endsWith('recognition') ? 'recognition' : 'execution')
    const choices = data.visits.find(visit => visit.id === data.activeVisitId)?.session?.cases
    const choice = choices?.find(candidate => candidate.caseId !== previous) ?? choices?.[0]
    const caseId = choice?.caseId ?? (previous === 'oll:27' && category.startsWith('oll') ? 'oll:26' : s.generated.caseId)
    return { ...s, generatorAlgorithm: choice?.algorithm ?? s.generatorAlgorithm, generated: { ...s.generated, caseId,
      targetAlgorithmId: choice?.algorithm.id ?? s.generated.targetAlgorithmId,
      targetAlgorithmNotation: choice?.algorithm.notation ?? s.generated.targetAlgorithmNotation,
      verification: { ...s.generated.verification, identity: caseId, canonicalSignature: STANDARD_CASE_BY_ID.get(caseId)!.canonicalSignature } } }
  }) })
  return { controller, storage, read: () => JSON.parse(raw), setRaw: (value: string) => { raw = value }, fail: (value: boolean) => { fail = value }, time: (value: number) => { now = value } }
}

describe('Training controller ownership and durability', () => {
  it('tracks prospectively across on, off and on without changing the captured session override', async () => {
    const f = fixture(), c = f.controller
    const custom = await verifyCustomAlgorithm('oll:27', "R U R' U R U2 R'")
    const builtIn = algorithmSnapshotFor(builtInAlgorithmForCase('oll:27')!)
    const tracking = (enabled: boolean) => {
      const prefs = c.getSnapshot().data!.preferences
      return c.updateSettings(getTrainingDomainSettings(prefs), prefs.sets.oll.recognition, 'oll', enabled)
    }
    await c.saveAlgorithm(custom)
    expect(f.read().customAlgorithms).toEqual([])
    tracking(true)
    await c.saveAlgorithm(custom)
    await c.beginSession({ name: 'Override', categoryId: 'oll:execution', caseIds: ['oll:27'], algorithmOverrides: { 'oll:27': builtIn } })
    const id = f.read().activeVisitId
    expect(f.read().visits[0].session.cases[0].algorithm).toEqual(builtIn)
    expect(f.read().preferences.preferredAlgorithms[0].algorithm.id).toBe(custom.id)
    const nextRevision = await verifyCustomAlgorithm('oll:27', "R U R' U R U2 R'", custom)
    await c.saveAlgorithm(nextRevision)
    expect(f.read().preferences.preferredAlgorithms[0].algorithm.id).toBe(nextRevision.id)
    expect(f.read().visits[0].session.cases[0].algorithm).toEqual(builtIn)

    for (const enabled of [true, false, true]) {
      tracking(enabled)
      expect(c.beginAttempt()).toBe(true)
      expect(tracking(!enabled)).toBeUndefined()
      expect(c.completeAttempt(1200)).toBe('saved')
      await Promise.resolve()
    }
    const before = f.read().attempts
    expect(before.map((item: { algorithmTracking: boolean }) => item.algorithmTracking)).toEqual([true, false, true])
    expect(before[1]).toMatchObject({ attribution: { kind: 'unknown' }, preferredAlgorithmAtStart: null })
    c.correctAttribution(before[1].id, builtIn)
    expect(f.read().attempts).toEqual(before)
    let undo: Parameters<typeof c.undoDeleteAttempt>[0] | undefined
    expect(c.deleteAttempt(before[1].id, token => { undo = token })).toBe(true)
    expect(c.undoDeleteAttempt(undo!)).toBe(true)
    expect(f.read().attempts).toEqual(before)
    expect(before.every((item: { visitId: string }) => item.visitId === id)).toBe(true)
    const analytics = buildTrainingAnalytics(fixture(f.read()).controller.getSavedData()!.attempts, 'oll:execution')
    const row = analytics.cases.find(item => item.caseId === 'oll:27')!
    expect(row.statistics.recordedAttempts).toBe(3)
    expect(row.revisions).toMatchObject([{ algorithm: builtIn, statistics: { recordedAttempts: 2 } }])
    expect(c.endSession()).toBe(true)
    expect(c.closeSessionReport(id)).toBe(true)
    tracking(false)
    await c.beginSession({ name: 'Off', categoryId: 'oll:execution', caseIds: ['oll:27'], algorithmOverrides: { 'oll:27': builtIn } })
    expect(f.read().visits[1].session.cases[0].algorithm.id).toBe(nextRevision.id)
  })
  it('deletes only an acknowledged archived session after retry and never restores its stale Undo', async () => {
    const f = fixture(), c = f.controller
    const draft = { name: 'Archived drill', categoryId: 'oll:execution' as const, caseIds: ['oll:27'] as const }
    await c.beginSession(draft)
    const first = f.read().activeVisitId
    expect(c.beginAttempt()).toBe(true)
    c.completeAttempt(1200)
    await Promise.resolve()
    expect(c.beginAttempt()).toBe(true)
    c.completeAttempt(1300)
    let undo: Parameters<typeof c.undoDeleteAttempt>[0] | undefined
    c.deleteAttempt(f.read().attempts[1].id, token => { undo = token })
    expect(c.endSession()).toBe(true)
    expect(c.deleteArchivedSession(first)).toBe(false)
    expect(c.closeSessionReport(first)).toBe(true)
    await c.beginSession({ ...draft, name: 'Retained drill' })
    expect(c.beginAttempt()).toBe(true)
    c.completeAttempt(2000)
    const before = f.read()
    f.fail(true)
    expect(c.deleteArchivedSession(first)).toBe(false)
    expect(f.read()).toEqual(before)
    f.fail(false)
    c.retrySave()
    expect(f.read().visits).toEqual(before.visits.slice(1))
    expect(f.read().attempts).toEqual(before.attempts.slice(1))
    expect(f.read().recognitionCounts).toEqual(before.recognitionCounts)
    expect(c.undoDeleteAttempt(undo!)).toBeUndefined()
  })
  it('queues the exact all-DNF report and its destination only after a successful end', async () => {
    const f = fixture(), c = f.controller
    await c.beginSession({ name: 'Drill', categoryId: 'oll:execution', caseIds: ['oll:27'] })
    expect(c.beginAttempt()).toBe(true)
    c.completeAttempt(1200)
    const attempt = f.read().attempts[0]
    c.correctResult(attempt.id, 'dnf')
    const id = f.read().activeVisitId
    f.fail(true)
    expect(c.endSession({ destination: 'analytics' })).toBe(false)
    expect(c.getSavedData()?.activeVisitId).toBe(id)
    expect(c.getSavedData()?.visits[0]?.lifecycle?.reportPending).toBe(false)
    f.fail(false)
    c.retrySave()
    const reopened = fixture(f.read()).controller
    expect(reopened.getSavedData()?.visits[0]?.lifecycle).toMatchObject({ reportPending: true, reportDestination: 'analytics' })
    await reopened.beginSession({ name: 'Later', categoryId: 'oll:execution', caseIds: ['oll:27'] })
    expect(reopened.getSavedData()?.activeVisitId).toBeNull()
    expect(reopened.closeSessionReport(id)).toBe(true)
    expect(reopened.getSavedData()?.visits[0]?.lifecycle?.reportPending).toBe(false)
  })

  it('defers a named idle prompt while timing and keeps the prompt until a decision', async () => {
    const f = fixture(), c = f.controller
    await c.beginSession({ name: 'Drill', categoryId: 'oll:execution', caseIds: ['oll:27'] })
    c.setTimerActive(true)
    f.time(NOW + 15 * 60_000)
    c.tick()
    expect(c.getSnapshot().idlePrompt).toBeNull()
    c.setTimerActive(false)
    c.tick()
    expect(c.getSnapshot().idlePrompt).toBe(NOW + 15 * 60_000)
    f.time(NOW + 30 * 60_000)
    c.tick()
    expect(c.getSnapshot().idlePrompt).toBe(NOW + 15 * 60_000)
    c.keepPracticing()
    c.tick()
    expect(c.getSnapshot().idlePrompt).toBeNull()
    expect(f.read().activeVisitId).not.toBeNull()
  })
  it('preserves an ambiguous visit until a choice and excludes an overnight gap on resume', async () => {
    const initial = fixture()
    await initial.controller.beginSession({ name: 'Overnight', categoryId: 'oll:execution', caseIds: ['oll:27'] })
    initial.time(NOW + 5000)
    initial.controller.notePracticeInput()
    initial.controller.checkpointPractice()
    const saved = initial.read()
    const reopened = fixture(saved), c = reopened.controller
    const nextMorning = NOW + 8 * 3600_000
    reopened.time(nextMorning)
    c.recover('unknown')
    expect(reopened.read()).toEqual(saved)
    expect(c.getSnapshot().needsContinuity).toBe(true)
    expect(c.resumeSession()).toBe(true)
    reopened.time(nextMorning + 2000)
    expect(c.endSession()).toBe(true)
    expect(trainingVisitElapsed(c.getSavedData()!.visits[0]!)).toBe(7000)

    const confirmed = fixture(saved)
    confirmed.time(nextMorning)
    confirmed.controller.recover('closed')
    expect(confirmed.read().visits[0]).toMatchObject({ endedAt: NOW + 5000, lifecycle: { endReason: 'tab-closed', reportPending: false } })
    expect(confirmed.controller.getSnapshot().closedSessionName).toBe('Overnight')
  })

  it('saves explicit Begin before preparing and binds attempts to the captured case revision', async () => {
    const data = createEmptyTrainingData()
    const f = fixture({ ...data, preferences: { ...data.preferences, algorithmTracking: true } })
    const c = f.controller
    f.fail(true)
    await c.beginSession({ name: 'Focused OLL', categoryId: 'oll:execution', caseIds: ['oll:27'] })
    expect(c.getSnapshot().setup).toBeNull()
    expect(f.read().visits).toHaveLength(0)
    f.fail(false)
    c.retrySave()
    await Promise.resolve()
    const visit = f.read().visits[0]
    expect(visit.session).toMatchObject({ name: 'Focused OLL', cases: [{ caseId: 'oll:27' }] })
    expect(c.beginAttempt()).toBe(true)
    expect(c.completeAttempt(1200)).toBe('saved')
    expect(c.completeAttempt(1200)).toBeUndefined()
    expect(f.read().attempts).toHaveLength(1)
    expect(f.read().attempts[0]).toMatchObject({ visitId: visit.id, preferredAlgorithmAtStart: visit.session.cases[0].algorithm })
  })

  it('keeps calibration out of history and defers named-session renewal until the next Begin', async () => {
    const f = fixture(), c = f.controller
    const draft = { name: '', categoryId: 'oll:recognition' as const, caseIds: ['oll:26', 'oll:27'] as const }
    await c.beginSession(draft)
    expect(f.read().visits).toHaveLength(0)
    expect(c.getSnapshot().calibration?.setId).toBe('oll')
    c.cancelCalibration()
    expect(f.read().calibrations).toHaveLength(0)
    await c.beginSession(draft)
    for (let sample = 1; sample <= 7; sample++) {
      expect(c.beginAttempt()).toBe(true)
      expect(c.completeAttempt(sample * 100)).toBe('sample')
      c.acceptSample()
    }
    await Promise.resolve()
    expect(f.read().attempts).toHaveLength(0)
    expect(f.read().calibrations[0].medianMs).toBe(400)
    expect(f.read().visits[0].session.name).toBe('OLL Recognition')
    f.time(NOW + 8 * 86400000)
    expect(c.beginAttempt()).toBe(true)
    expect(c.completeAttempt(1500)).toBe('saved')
    expect(c.endSession()).toBe(true)
    expect(c.closeSessionReport(f.read().visits[0].id)).toBe(true)
    await c.beginSession(draft)
    expect(c.getSnapshot().calibration?.setId).toBe('oll')
    expect(f.read().visits).toHaveLength(1)
  })

  it('opening does not start a visit or calibration; completion is routed once with captured context', async () => {
    const f = fixture(), c = f.controller
    c.recover('refresh')
    expect(c.getSnapshot().data!.visits).toHaveLength(0)
    expect(c.getSnapshot().calibration).toBeNull()
    await c.selectCategory('oll:execution')
    expect(c.beginAttempt()).toBe(true)
    expect(c.completeAttempt(1234)).toBe('saved')
    expect(c.completeAttempt(1234)).toBeUndefined()
    expect(f.read().attempts).toHaveLength(1)
    expect(f.read().attempts[0]).toMatchObject({ rawMs: 1234, categoryId: 'oll:execution', result: { penalty: 'none' } })
    expect(f.read().sessions).toBeUndefined()
  })
  it('preserves corrupt and future-version bytes without an empty fallback', async () => {
    for (const raw of ['{broken', '{"version":99}']) {
      const storage = { getItem: () => raw, setItem: () => { throw Error('must not write') } }
      const c = new TrainingController({ storage })
      await c.selectCategory('oll:execution')
      expect(c.getSnapshot().data).toBeNull()
      expect(c.beginAttempt()).toBe(false)
    }
  })
  it('retains a failed completion in memory and retries the same ID exactly once', async () => {
    const f = fixture(), c = f.controller
    await c.selectCategory('oll:execution')
    c.beginAttempt()
    f.fail(true)
    expect(c.completeAttempt(1500)).toBe('unsaved')
    const id = c.getSnapshot().data!.attempts[0]!.id
    expect(c.getSnapshot().pendingSave).toBe(true)
    expect(c.beginAttempt()).toBe(false)
    f.fail(false)
    c.retrySave()
    c.retrySave()
    expect(f.read().attempts.map((a: {id: string}) => a.id)).toEqual([id])
  })
  it('refuses stale writes and preserves both stored bytes and the unsaved result', async () => {
    const f = fixture(), c = f.controller
    await c.selectCategory('oll:execution')
    c.beginAttempt()
    const changed = f.read(); changed.preferences.reportSettings.external = true
    f.setRaw(JSON.stringify(changed))
    c.completeAttempt(1000)
    expect(c.getSnapshot().pendingSave).toBe(true)
    expect(c.getSnapshot().error).toMatch(/changed/)
    expect(c.getSnapshot().data!.attempts).toHaveLength(1)
    expect(f.read().preferences.reportSettings.external).toBe(true)
  })
  it('requires two cases, calibrates only on explicit selection, and cancellation returns to selection', async () => {
    const f = fixture(), c = f.controller
    await c.selectCategory('oll:recognition')
    expect(c.getSnapshot().calibration?.samplesMs).toEqual([])
    c.cancelCalibration()
    expect(c.getSnapshot().category).toBeNull()
    await c.setEnabledCases('oll', ['oll:27'])
    await c.selectCategory('oll:recognition')
    expect(c.getSnapshot().calibration).toBeNull()
    expect(c.getSnapshot().error).toMatch(/two/i)
  })
  it('captures independent calibration and renews only before a new attempt', async () => {
    const data = createEmptyTrainingData()
    const f = fixture({ ...data, calibrations: [calibration()] }), c = f.controller
    await c.selectCategory('oll:recognition')
    expect(c.beginAttempt()).toBe(true)
    f.time(NOW + 8 * 86400000)
    c.tick()
    expect(c.getSnapshot().data!.activeVisitId).not.toBeNull()
    c.completeAttempt(3000)
    expect(c.getSnapshot().data!.attempts[0]!.calibration?.medianMs).toBe(900)
    expect(c.getSnapshot().data!.attempts[0]!.estimatedRecognitionExecutionMs).toBe(2100)
  })
  it('resumes refresh, finalizes navigation/category changes and inactivity once', async () => {
    const f = fixture(), c = f.controller
    await c.selectCategory('oll:execution')
    c.beginAttempt(); c.completeAttempt(1234)
    const id = c.getSnapshot().data!.activeVisitId
    c.recover('refresh')
    expect(c.getSnapshot().data!.activeVisitId).toBe(id)
    await c.selectCategory('pll:execution')
    expect(c.getSnapshot().data!.visits[0]!.lifecycle?.endReason).toBe('category-switch')
    c.navigate('timer')
    expect(c.getSnapshot().data!.activeVisitId).toBeNull()
    await c.selectCategory('oll:execution')
    c.beginAttempt(); c.completeAttempt(2000)
    f.time(NOW + 15 * 60000); c.tick(); c.tick()
    expect(c.getSnapshot().data!.visits.filter(v => v.lifecycle?.reportPending)).toHaveLength(2)
  })
  it('requires a continuity choice when restored-tab evidence is ambiguous', async () => {
    const f = fixture(), c = f.controller
    await c.selectCategory('oll:execution'); c.beginAttempt(); c.completeAttempt(1000)
    const restored = new TrainingController({ storage: f.storage, now: () => NOW })
    restored.recover('unknown')
    expect(restored.getSnapshot().needsContinuity).toBe(true)
    restored.recover('closed')
    expect(restored.getSnapshot().data!.visits[0]!.lifecycle?.endReason).toBe('tab-closed')
    expect(restored.getSnapshot().data!.visits[0]!.lifecycle?.reportPending).toBe(true)
    expect(TRAINING_STORAGE_KEY).toBe('cubelab:training:v1')
  })
})

describe('Training calibration, correction and settings coordination', () => {
  it('collects exactly seven accepted calibration samples, retries invalids, and preserves the other set', async () => {
    const f = fixture(), c = f.controller
    await c.selectCategory('oll:recognition')
    c.beginAttempt(); expect(c.completeAttempt(700)).toBe('sample'); c.acceptSample(false)
    expect(c.getSnapshot().calibration!.invalidSampleCount).toBe(1)
    for (const ms of [1200,600,1100,700,1000,800,900]) {
      expect(c.beginAttempt()).toBe(true)
      c.completeAttempt(ms); c.acceptSample()
    }
    expect(f.read().calibrations[0].medianMs).toBe(900)
    expect(f.read().calibrations[0].samplesMs).toEqual([1200,600,1100,700,1000,800,900])
    expect(f.read().attempts).toHaveLength(0)
    expect(f.read().calibrations.some((x: {setId:string}) => x.setId === 'pll')).toBe(false)
  })
  it('keeps calibration commits recoverable if the seventh-sample save fails', async () => {
    const f = fixture(), c = f.controller
    await c.selectCategory('oll:recognition')
    for (let i = 0; i < 7; i++) {
      c.beginAttempt(); c.completeAttempt(1000 + i)
      if (i === 6) f.fail(true)
      c.acceptSample()
    }
    expect(c.getSnapshot().pendingSave).toBe(true)
    expect(c.getSnapshot().calibration!.status).toBe('complete')
    f.fail(false); c.retrySave()
    expect(c.getSnapshot().calibration).toBeNull()
    expect(f.read().calibrations).toHaveLength(1)
    c.retrySave()
    expect(f.read().calibrations).toHaveLength(1)
  })
  it('locks mode and settings changes while timing and retains category/calibration snapshots', async () => {
    const data = { ...createEmptyTrainingData(), calibrations: [calibration()] }
    const f = fixture(data), c = f.controller
    await c.selectCategory('oll:recognition'); c.beginAttempt()
    await c.selectCategory('pll:execution')
    await c.setEnabledCases('oll', [])
    expect(c.getSnapshot().category).toBe('oll:recognition')
    expect(c.getSnapshot().data!.preferences.sets.oll.enabledCaseIds.length).toBe(57)
    c.completeAttempt(2000)
    c.correctAttribution(c.getSnapshot().data!.attempts[0]!.id, null)
    expect(f.read().attempts[0].rawMs).toBe(2000)
    expect(f.read().attempts[0].calibration.medianMs).toBe(900)
  })
  it('recalculates ended reports after corrections, deletion and Undo without recounting completions', async () => {
    const { calculateTrainingReport } = await import('./reports')
    const f = fixture({ ...createEmptyTrainingData(), calibrations: [calibration()] }), c = f.controller
    await c.selectCategory('oll:recognition'); c.beginAttempt(); c.completeAttempt(2000)
    const a = c.getSnapshot().data!.attempts[0]!, visitId = a.visitId
    c.navigate('analytics')
    expect(calculateTrainingReport(c.getSnapshot().data!,visitId).categories![0]!.statistics.successfulAttempts).toBe(1)
    c.correctResult(a.id, 'dnf')
    expect(calculateTrainingReport(c.getSnapshot().data!,visitId).categories![0]!.statistics.dnfPercentage).toBe(100)
    const corrected = f.read().attempts[0]
    let undo: (() => boolean | undefined) | undefined
    expect(c.deleteAttempt(a.id, deleted => { undo = () => c.undoDeleteAttempt(deleted) })).toBe(true)
    expect(calculateTrainingReport(c.getSnapshot().data!,visitId).status).toBe('empty')
    expect(f.read().recognitionCounts.oll).toBe(1)
    expect(f.read().visits[0].attemptIds).toEqual([])
    expect(undo?.()).toBe(true)
    expect(f.read().attempts).toEqual([corrected])
    expect(f.read().visits[0].attemptIds).toEqual([a.id])
    expect(f.read().recognitionCounts.oll).toBe(1)
    expect(calculateTrainingReport(c.getSnapshot().data!, visitId).categories![0]!.statistics.dnfPercentage).toBe(100)
    expect(undo?.()).toBeFalsy()
    expect(f.read().attempts).toEqual([corrected])
  })
  it('restores a legacy attempt in its original position without reverting later edits', async () => {
    const f = fixture({ ...createEmptyTrainingData(), calibrations: [calibration()] }), c = f.controller
    await c.selectCategory('oll:recognition')
    for (const ms of [1100, 1200, 1300]) {
      await c.prepare()
      c.beginAttempt()
      c.completeAttempt(ms)
    }
    const data = f.read()
    delete data.attempts[1].rulesVersion
    delete data.recognitionCounts
    const restored = fixture(data), owner = restored.controller
    let undo: (() => boolean | undefined) | undefined
    owner.deleteAttempt(data.attempts[1].id, deleted => { undo = () => owner.undoDeleteAttempt(deleted) })
    owner.toggleDifficult('oll:27')
    owner.setTimerActive(true)
    expect(undo?.()).toBeFalsy()
    expect(restored.read().attempts).toHaveLength(2)
    owner.setTimerActive(false)
    expect(undo?.()).toBe(true)
    expect(restored.read().attempts).toEqual(data.attempts)
    expect(restored.read().visits).toEqual(data.visits)
    expect(restored.read().recognitionCounts).toEqual({ oll: 3, pll: 0 })
    expect(restored.read().preferences.sets.oll.difficultCaseIds).toEqual(['oll:27'])
  })
  it('retains failed delete and Undo candidates and notifies only after checked Retry saves', async () => {
    const f = fixture({ ...createEmptyTrainingData(), calibrations: [calibration()] }), c = f.controller
    await c.selectCategory('oll:recognition')
    c.beginAttempt(); c.completeAttempt(2300)
    const original = f.read()
    let deletedCount = 0, restoredCount = 0
    let undo: (() => boolean | undefined) | undefined
    f.fail(true)
    expect(c.deleteAttempt(original.attempts[0].id, deleted => {
      deletedCount++
      undo = () => c.undoDeleteAttempt(deleted, () => { restoredCount++ })
    })).toBe(false)
    expect(c.getSnapshot().pendingSave).toBe(true)
    expect(c.getSavedData()!.attempts).toEqual(original.attempts)
    expect(deletedCount).toBe(0)
    expect(f.read()).toEqual(original)
    c.navigate('timer')
    f.fail(false); c.retrySave(); c.retrySave()
    expect(deletedCount).toBe(1)
    expect(f.read().attempts).toEqual([])
    expect(f.read().visits[0].lifecycle.endReason).toBe('navigation')
    f.fail(true)
    expect(undo?.()).toBe(false)
    expect(c.getSnapshot().pendingSave).toBe(true)
    expect(c.getSavedData()!.attempts).toEqual([])
    expect(f.read().attempts).toEqual([])
    expect(restoredCount).toBe(0)
    f.fail(false); c.retrySave(); c.retrySave()
    expect(restoredCount).toBe(1)
    expect(f.read().attempts).toEqual(original.attempts)
    expect(f.read().visits[0].attemptIds).toEqual([original.attempts[0].id])
    expect(f.read().visits[0].lifecycle.endReason).toBe('navigation')
    expect(f.read().recognitionCounts).toEqual(original.recognitionCounts)
  })
  it('keeps changed external bytes when an Undo cannot be committed', async () => {
    const f = fixture(), c = f.controller
    await c.selectCategory('oll:execution')
    c.beginAttempt(); c.completeAttempt(2300)
    const attempt = f.read().attempts[0]
    let undo: (() => boolean | undefined) | undefined
    c.deleteAttempt(attempt.id, deleted => { undo = () => c.undoDeleteAttempt(deleted) })
    const external = f.read()
    external.preferences.reportSettings.external = true
    f.setRaw(JSON.stringify(external))
    expect(undo?.()).toBe(false)
    c.retrySave()
    expect(c.getSnapshot()).toMatchObject({ pendingSave: true, data: { attempts: [attempt] } })
    expect(c.getSnapshot().error).toMatch(/changed/)
    expect(f.read()).toEqual(external)
  })
  it('captures new settings only for the affected set and subsequent visits/calibrations', async () => {
    const f = fixture(), c = f.controller
    await c.selectCategory('oll:execution')
    const settings = { ...c.getSnapshot().data!.preferences.domain!, inactivityMinutes: 20, baseline: {kind:'attempts' as const,count:40} }
    c.updateSettings(settings,{renewalDays:10,renewalAttempts:200},'oll')
    expect(f.read().preferences.sets.pll.recognition).toEqual({renewalDays:7,renewalAttempts:100})
    expect(f.read().visits[0].lifecycle.inactivityMinutes).toBe(15)
    await c.selectCategory('pll:execution')
    expect(f.read().visits[1].lifecycle.inactivityMinutes).toBe(20)
    expect(f.read().visits[1].lifecycle.baseline).toEqual({kind:'attempts',count:40})
  })
})

it('retains navigation finalization with a failed completion until the whole candidate can be saved', async () => {
  const f = fixture(), c = f.controller
  await c.selectCategory('oll:execution')
  c.beginAttempt(); f.fail(true); c.completeAttempt(1000)
  c.navigate('timer')
  expect(c.getSnapshot().data!.activeVisitId).toBeNull()
  expect(c.getSnapshot().data!.visits[0]!.lifecycle!.endReason).toBe('navigation')
  expect(f.read().attempts).toHaveLength(0)
  f.fail(false); c.retrySave()
  expect(f.read().activeVisitId).toBeNull()
  expect(f.read().attempts).toHaveLength(1)
  expect(f.read().visits[0].lifecycle.reportPending).toBe(true)
})

it('recovers a failed category selection with one coherent visit and setup', async () => {
  const f = fixture(), c = f.controller
  await c.selectCategory('oll:execution')
  f.fail(true)
  await c.selectCategory('pll:execution')
  expect(c.beginAttempt()).toBe(false)
  expect(f.read().preferences.selectedSetId).toBe('oll')
  f.fail(false)
  c.retrySave()
  await Promise.resolve()
  const state = c.getSnapshot()
  expect(state.category).toBe('pll:execution')
  expect(state.setup?.generated.setId).toBe('pll')
  expect(f.read().visits.at(-1).startedCategoryId).toBe('pll:execution')
})

function deferredSetup() {
  let resolve!: (setup: ReturnType<typeof import('./persistenceFixtures.test-support').setup>) => void
  const promise = new Promise<ReturnType<typeof setup>>(done => { resolve = done })
  return { promise, resolve }
}

it('ignores a superseded setup even when the new category cannot generate', async () => {
  const deferred = deferredSetup()
  const f = fixture(undefined, () => deferred.promise), c = f.controller
  await c.setEnabledCases('pll', [])
  const first = c.selectCategory('oll:execution')
  expect(c.getSnapshot().preparing).toBe(true)
  await c.selectCategory('pll:execution')
  deferred.resolve(setup())
  await first
  expect(c.getSnapshot()).toMatchObject({ category: 'pll:execution', preparing: false, setup: null })
})

it('does not restore a setup when generation finishes after inactivity', async () => {
  const deferred = deferredSetup()
  const f = fixture(undefined, () => deferred.promise), c = f.controller
  const first = c.selectCategory('oll:execution')
  f.time(NOW + 16 * 60_000)
  c.tick()
  deferred.resolve(setup())
  await first
  expect(c.getSnapshot()).toMatchObject({ data: { activeVisitId: null }, preparing: false, setup: null })
  expect(c.beginAttempt()).toBe(false)
})

it('retries a revealed case directly in its execution category', async () => {
  const calls: { category: string; target?: string }[] = []
  const f = fixture({ ...createEmptyTrainingData(), calibrations: [calibration()] }, async (_data, category, _previous, target) => {
    calls.push({ category, target })
    return setup(category.startsWith('pll') ? 'pll' : 'oll', category.endsWith('recognition') ? 'recognition' : 'execution')
  })
  await f.controller.selectCategory('oll:recognition')
  await f.controller.retryCase('pll:ua')
  expect(calls).toEqual([
    { category: 'oll:recognition' },
    { category: 'pll:execution', target: 'pll:ua' },
  ])
  expect(f.controller.getSnapshot()).toMatchObject({ category: 'pll:execution', preparing: false })
})

it('allows a failed recognition setup to be retried without exposing its target or restarting the visit', async () => {
  let fail = true
  const { controller } = fixture({ ...createEmptyTrainingData(), calibrations: [calibration()] }, async () => {
    if (fail) throw new Error('Could not generate target oll:27')
    return setup('oll', 'recognition')
  })
  await controller.selectCategory('oll:recognition')
  const visitId = controller.getSnapshot().data!.activeVisitId
  expect(controller.getSnapshot()).toMatchObject({
    preparing: false,
    setup: null,
    error: 'Could not prepare a setup. Try again or check your cases.',
  })
  expect(controller.beginAttempt()).toBe(false)
  fail = false
  await controller.prepare()
  expect(controller.getSnapshot()).toMatchObject({
    data: { activeVisitId: visitId },
    setup: { generated: { targetHidden: true } },
    preparing: false,
    error: null,
  })
})
