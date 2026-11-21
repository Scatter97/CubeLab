import { describe, expect, it } from 'vitest'
import type { SessionsData } from '../../types'
import { createBackup, parseBackup, serializeBackup } from '../backup'
import { DEFAULT_SETTINGS, SESSIONS_STORAGE_KEY, SETTINGS_STORAGE_KEY, SOLVES_STORAGE_KEY, saveSessions, saveSettings, loadSessionsForStartup, type StorageLike } from '../storage'
import { TRAINING_STORAGE_KEY, createEmptyTrainingData, deserializeTrainingData, serializeTrainingData, migrateTrainingData, loadTraining, saveTraining } from './storage'
import { createTrainingAttempt, createTrainingVisit, appendTrainingAttempt } from './records'
import { NOW, setup, calibration } from './persistenceFixtures.test-support'
import { stripRetiredAlgorithmTracking } from './retiredAlgorithmTracking'

class MemoryStorage implements StorageLike {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, raw: string) { this.values.set(key, raw) }
}

function populated() {
  const visit = createTrainingVisit('oll:recognition', NOW, 'visit-1')
  const c = calibration()
  return appendTrainingAttempt({ ...createEmptyTrainingData(), visits: [visit], activeVisitId: visit.id, calibrations: [c] }, createTrainingAttempt({
    setup: setup('oll', 'recognition'), visitId: visit.id, rawMs: 2500,
    createdAt: NOW + 100, calibration: c, estimatedRecognitionExecutionMs: 1600,
  }))
}

describe('checked Training persistence', () => {
  it('initializes absent data without writing or migrating ordinary history', () => {
    const s = new MemoryStorage()
    s.setItem(SOLVES_STORAGE_KEY, 'legacy history bytes')
    const before = new Map(s.values)
    const loaded = loadTraining(s)
    expect(loaded).toEqual({ ok: true, data: createEmptyTrainingData(), raw: null })
    expect(s.values).toEqual(before)
    expect(createEmptyTrainingData()).not.toBe(createEmptyTrainingData())
  })

  it('round-trips attempts, preferences, visits and complete calibration snapshots', () => {
    const s = new MemoryStorage()
    const data = populated()
    expect(saveTraining(data, null, s)).toMatchObject({ ok: true })
    expect(loadTraining(s)).toEqual({ ok: true, data, raw: serializeTrainingData(data) })
    expect(data.preferences.sets.oll.recognition).toEqual({ renewalDays: 7, renewalAttempts: 100 })
  })

  it('persists per-set selections, custom algorithms, preferred revisions, presets, difficult cases and category/report settings', () => {
    const base = createEmptyTrainingData()
    const data = { ...base, preferences: {
      ...base.preferences, sets: { ...base.preferences.sets,
        oll: { ...base.preferences.sets.oll, enabledCaseIds: ['oll:27'] as const, difficultCaseIds: ['oll:27'] as const, includeSetupMoves: true, selectedPresetId: 'mine', recognition: { renewalDays: 3, renewalAttempts: 50 } },
      }, preferredAlgorithms: [{ caseId: 'oll:27' as const, algorithm: { id: 'user:oll:27:1', revision: 1, notation: "R U R' U R U2 R'" } }],
      categories: { ...base.preferences.categories, 'oll:recognition': { recognitionMetric: 'estimated' as const } },
      reportSettings: { future: { enabled: true, labels: ['example'] } },
    }, presets: [{ version: 1 as const, id: 'mine', name: 'My selection', setId: 'oll' as const, caseIds: ['oll:27'] as const, includeSetupMoves: true, kind: 'user' as const, createdAt: NOW, updatedAt: NOW }],
    customAlgorithms: [{ id: 'user:oll:27:1', version: 1, setId: 'oll', caseId: 'oll:27', source: 'user' as const, notation: "R U R' U R U2 R'", normalizedNotation: "R U R' U R U2 R'", label: 'Mine', createdAt: NOW, verification: null }],
    }
    const s = new MemoryStorage()
    expect(saveTraining(data, null, s).ok).toBe(true)
    const loaded = loadTraining(s)
    expect(loaded.ok && loaded.data).toEqual(stripRetiredAlgorithmTracking(data))
    expect(loaded.ok && loaded.data.customAlgorithms).toEqual([])
    expect(loaded.ok && loaded.data.preferences.preferredAlgorithms).toEqual([])
    expect(loaded.ok && loaded.data.preferences.sets.pll.includeSetupMoves).toBe(false)
  })

  it('retains historical algorithm/calibration snapshots without live catalog references', () => {
    const data = populated()
    const a = data.attempts[0]!
    const changed = { ...data, calibrations: [], preferences: { ...data.preferences, preferredAlgorithms: [{ caseId: a.caseId, algorithm: { id: 'new', revision: 2, notation: null } }] } }
    expect(deserializeTrainingData(serializeTrainingData(changed)).attempts[0]).toEqual({ ...a, algorithmTracking: false })
  })

  it.each(['{broken', '', 'null', '{}', '{"version":0}', '{"version":2}'])('preserves malformed/unsupported bytes %s and blocks writes', (raw) => {
    const s = new MemoryStorage()
    s.setItem(TRAINING_STORAGE_KEY, raw)
    expect(loadTraining(s)).toMatchObject({ ok: false, raw })
    expect(saveTraining(createEmptyTrainingData(), raw, s).ok).toBe(false)
    expect(s.getItem(TRAINING_STORAGE_KEY)).toBe(raw)
  })

  it.each([
    (d: any) => { delete d.preferences },
    (d: any) => { delete d.attempts[0].rawMs },
    (d: any) => { d.attempts[0].rawMs = -1 },
    (d: any) => { d.attempts[0].createdAt = 8_640_000_000_000_001 },
    (d: any) => { d.attempts[0].categoryId = 'pll:recognition' },
    (d: any) => { d.attempts[0].caseId = 'oll:skip' },
    (d: any) => { d.attempts[0].version = 2 },
    (d: any) => { d.attempts[0].setup.generated.verification.exactTargetReached = false },
    (d: any) => { d.attempts[0].setup.generated.precursor = 'R' },
    (d: any) => { d.attempts[0].calibration.samplesMs.pop() },
    (d: any) => { d.attempts[0].calibration.samplesMs[0] = -1 },
    (d: any) => { d.attempts[0].calibration.setId = 'pll' },
    (d: any) => { d.attempts[0].estimatedRecognitionExecutionMs = 3000 },
    (d: any) => { d.attempts.push(d.attempts[0]) },
    (d: any) => { d.visits[0].attemptIds = [] },
    (d: any) => { d.visits[0].categoryIds = ['pll:execution'] },
    (d: any) => { d.visits[0].endedAt = NOW - 1 },
    (d: any) => { d.activeVisitId = 'missing' },
    (d: any) => { d.preferences.sets.oll.enabledCaseIds = ['pll:ua'] },
    (d: any) => { d.preferences.sets.oll.enabledCaseIds = ['oll:27', 'oll:27'] },
    (d: any) => { d.preferences.sets.oll.selectedPresetId = 'missing' },
    (d: any) => { d.preferences.sets.oll.recognition.renewalDays = 0 },
  ])('rejects an incomplete/inconsistent record without partial salvage (%#)', (mutate) => {
    const d = JSON.parse(JSON.stringify(populated()))
    mutate(d)
    const raw = JSON.stringify(d)
    const s = new MemoryStorage()
    s.setItem(TRAINING_STORAGE_KEY, raw)
    expect(loadTraining(s)).toMatchObject({ ok: false, raw })
    expect(s.getItem(TRAINING_STORAGE_KEY)).toBe(raw)
  })

  it('handles blocked storage, read failures, stale snapshots and quota failures without replacing data', () => {
    expect(loadTraining(null)).toMatchObject({ ok: false, reason: 'unavailable' })
    const s = new MemoryStorage()
    const raw = serializeTrainingData(populated())
    s.setItem(TRAINING_STORAGE_KEY, raw)
    expect(saveTraining(createEmptyTrainingData(), null, s)).toMatchObject({ ok: false, reason: 'changed' })
    const failingRead = { getItem() { throw Error('read') }, setItem() { throw Error('must not write') } }
    expect(loadTraining(failingRead)).toMatchObject({ ok: false, reason: 'read' })
    expect(saveTraining(createEmptyTrainingData(), raw, failingRead).ok).toBe(false)
    const quota = { getItem: s.getItem.bind(s), setItem() { throw Error('quota') } }
    expect(saveTraining(deserializeTrainingData(raw), raw, quota)).toMatchObject({ ok: false, reason: 'write' })
    expect(s.getItem(TRAINING_STORAGE_KEY)).toBe(raw)
    expect(saveTraining(createEmptyTrainingData(), null, null).ok).toBe(false)
  })

  it('has an explicit v1 migration boundary; never guesses older/future formats or strips extensions', () => {
    const original = { ...populated(), extension: { futureField: [1, 2] } }
    const migrated = migrateTrainingData(original)
    expect(migrated).toEqual(original)
    expect(migrated).not.toBe(original)
    expect(deserializeTrainingData(serializeTrainingData(migrated))).toEqual(original)
    for (const version of [undefined, 0, 2, '1']) expect(() => migrateTrainingData({ ...original, version })).toThrow()
  })

  it('rejects a validly reclassified historical attempt and reused custom algorithm revisions on save', () => {
    const s = new MemoryStorage()
    const data = populated()
    const saved = saveTraining(data, null, s)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    const original = data.attempts[0]!
    const rewritten = createTrainingAttempt({ setup: setup(), id: original.id, createdAt: original.createdAt, visitId: original.visitId, rawMs: original.rawMs })
    const candidate = { ...data, attempts: [rewritten], visits: [{ ...data.visits[0]!, categoryIds: ['oll:recognition', 'oll:execution'] as const }] }
    expect(saveTraining(candidate, saved.raw, s)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(s.getItem(TRAINING_STORAGE_KEY)).toBe(saved.raw)

    const custom = { id: 'user:27', version: 1, setId: 'oll', caseId: 'oll:27', source: 'user' as const, notation: 'R', normalizedNotation: 'R', label: 'Draft', createdAt: NOW, verification: null }
    const first = { ...data, customAlgorithms: [custom] }
    const firstSave = saveTraining(first, saved.raw, s)
    if (!firstSave.ok) throw Error(firstSave.error)
    const changed = { ...first, customAlgorithms: [{ ...custom, notation: 'U', normalizedNotation: 'U' }] }
    expect(saveTraining(changed, firstSave.raw, s)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(s.getItem(TRAINING_STORAGE_KEY)).toBe(firstSave.raw)
  })

  it('reads legacy penalties and invalid attempts unchanged without permitting new unsupported results', () => {
    const base = populated()
    const raw = JSON.parse(serializeTrainingData(base))
    delete raw.recognitionCounts
    delete raw.preferences.domain
    delete raw.visits[0].lifecycle
    delete raw.attempts[0].rulesVersion
    raw.calibrations.push(calibration('pll'))
    for (const [i, result] of [{ status: 'valid', penalty: '+2' }, { status: 'valid', penalty: 'dnf' }, { status: 'invalid', reason: 'wrong case' }].entries()) {
      const a = { ...raw.attempts[0], id: `legacy-${i}`, result, estimatedRecognitionExecutionMs: null }
      raw.attempts.push(a)
      raw.visits[0].attemptIds.push(a.id)
    }
    const serialized = JSON.stringify(raw)
    expect(serializeTrainingData(deserializeTrainingData(serialized))).toBe(serialized)
    expect(deserializeTrainingData(serialized).attempts.every((a) => a.rawMs === 2500)).toBe(true)
    const s = new MemoryStorage()
    s.setItem(TRAINING_STORAGE_KEY, serialized)
    expect(loadTraining(s)).toMatchObject({ ok: true })
    expect(saveTraining(deserializeTrainingData(serialized), serialized, s).ok).toBe(true)
  })

  it('rejects malformed custom algorithms, presets, attribution and cyclic JSON', () => {
    const base = populated()
    for (const custom of [
      { id: 'a', version: 1, setId: 'oll', caseId: 'oll:27', source: 'bundled', notation: 'R', normalizedNotation: 'R', label: '', createdAt: NOW, verification: null },
      { id: 'a', version: 0, setId: 'oll', caseId: 'oll:27', source: 'user', notation: 'bad', normalizedNotation: 'bad', label: '', createdAt: NOW, verification: null },
    ]) expect(() => migrateTrainingData({ ...base, customAlgorithms: [custom] })).toThrow()
    expect(() => migrateTrainingData({ ...base, presets: [{ version: 1, id: 'a', name: 'Mixed', setId: 'oll', caseIds: ['pll:ua'], includeSetupMoves: false, kind: 'user', createdAt: NOW, updatedAt: NOW }] })).toThrow()
    for (const attribution of [
      { kind: 'smart-cube', algorithm: { id: 'a', revision: 1, notation: null } },
      { kind: 'unknown', markedAt: null, algorithm: { id: 'a', revision: 1, notation: null } },
      { kind: 'assumed-preferred', algorithm: { id: 'a', revision: 0, notation: null } },
    ]) expect(() => migrateTrainingData({ ...base, attempts: [{ ...base.attempts[0], attribution }] })).toThrow()
    const cycle: any = { ...base }
    cycle.extension = cycle
    expect(() => serializeTrainingData(cycle)).toThrow()
  })

  it.each([NaN, Infinity, undefined, 1n, () => 1])('rejects lossy JSON before writing: %s', (value) => {
    const s = new MemoryStorage()
    const data = { ...createEmptyTrainingData(), extension: value }
    expect(() => serializeTrainingData(data)).toThrow()
    expect(saveTraining(data, null, s).ok).toBe(false)
    expect(s.values.size).toBe(0)
  })

  it('preserves ordinary sessions, settings, custom events and backup payloads byte-for-byte', () => {
    const s = new MemoryStorage()
    const sessions: SessionsData = { activeSessionId: 'normal', sessions: [{ id: 'normal', name: 'Regular', event: '333', createdAt: NOW, updatedAt: NOW, solves: [{ id: 'solve', event: '333', rawMs: 12345, penalty: 'none', createdAt: NOW, scramble: 'R', comment: '' }] }], customEvents: [{ id: 'custom:example', name: 'Example', placeholder: '', createdAt: NOW, updatedAt: NOW }] }
    saveSessions(sessions, s)
    saveSettings(DEFAULT_SETTINGS, s)
    s.setItem(SOLVES_STORAGE_KEY, 'preserved legacy bytes')
    const before = new Map(s.values)
    const backupBefore = serializeBackup(createBackup(sessions, DEFAULT_SETTINGS, new Date(NOW)))
    expect(saveTraining(populated(), null, s).ok).toBe(true)
    for (const [key, raw] of before) expect(s.getItem(key)).toBe(raw)
    expect(loadSessionsForStartup(s).data.sessions[0]!.solves).toEqual(sessions.sessions[0]!.solves)
    expect(loadSessionsForStartup(s).data.customEvents).toBeUndefined()
    expect(serializeBackup(createBackup(sessions, DEFAULT_SETTINGS, new Date(NOW)))).toBe(backupBefore)
    expect(parseBackup(backupBefore).ok).toBe(true)
    const trainingRaw = s.getItem(TRAINING_STORAGE_KEY)
    saveSessions({ ...sessions, sessions: [{ ...sessions.sessions[0]!, solves: [] }] }, s)
    saveSettings(DEFAULT_SETTINGS, s)
    expect(s.getItem(TRAINING_STORAGE_KEY)).toBe(trainingRaw)
    expect(s.values.has(SESSIONS_STORAGE_KEY)).toBe(true)
    expect(s.values.has(SETTINGS_STORAGE_KEY)).toBe(true)
  })
})
