import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SESSIONS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SOLVES_STORAGE_KEY,
  loadSessionsChecked,
  loadSettingsChecked,
  loadSolves,
  serializeSessionsData,
  type StorageLike,
} from './storage'
import { parseBackup, createBackup } from './backup'
import {
  SYNC_STORAGE_KEY,
  loadSyncStorageChecked,
  loadSyncStorage,
  saveSyncStorage,
  type SyncStorageData,
} from './syncStorage'
import {
  TRAINING_STORAGE_KEY,
  deserializeTrainingData,
  loadTraining,
  serializeTrainingData,
} from './training/storage'
import {
  REPLACEMENT_STORAGE_KEY,
  loadReplacementJournal,
  recoverPendingReplacement,
} from './replacement'

const FIXTURES = join(process.cwd(), 'tests/fixtures/storage')

function readText(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  writes = 0
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.writes += 1
    this.values.set(key, value)
  }
  removeItem(key: string): void {
    this.writes += 1
    this.values.delete(key)
  }
  seed(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('frozen sessions fixtures v1–v7', () => {
  for (let version = 1; version <= 7; version += 1) {
    it(`round-trips v${version} without losing identities or solve fields`, () => {
      const raw = readText(`sessions-v${version}.json`)
      const fixture = JSON.parse(raw) as {
        activeSessionId: string
        sessions: Array<{
          id: string
          solves: Array<Record<string, unknown>>
          competitionFormat?: unknown
          fieldUpdates?: unknown
          preferences?: unknown
        }>
        sessionOrder?: { ids: string[] }
        sessionTransfers?: unknown[]
      }
      const storage = new MemoryStorage()
      storage.seed(SESSIONS_STORAGE_KEY, raw)
      const first = loadSessionsChecked(storage)
      expect(first.ok, `v${version}`).toBe(true)
      if (!first.ok) throw new Error(`sessions v${version} was rejected`)
      expect(first.sourceVersion).toBe(version)
      expect(first.raw).toBe(raw)
      expect(first.data.activeSessionId).toBe(fixture.activeSessionId)
      expect(first.data.sessions.map((session) => session.id)).toEqual(
        fixture.sessions.map((session) => session.id),
      )
      for (const [index, fixtureSession] of fixture.sessions.entries()) {
        const session = first.data.sessions[index]!
        expect(session.id).toBe(fixtureSession.id)
        expect(session.solves.map((solve) => solve.id)).toEqual(
          fixtureSession.solves.map((solve) => solve.id),
        )
        for (const [solveIndex, fixtureSolve] of fixtureSession.solves.entries()) {
          const solve = session.solves[solveIndex]!
          expect(solve.id).toBe(fixtureSolve.id)
          expect(solve.rawMs).toBe(fixtureSolve.rawMs)
          expect(solve.penalty).toBe(fixtureSolve.penalty)
          expect(solve.scramble).toBe(fixtureSolve.scramble)
          expect(solve.comment).toBe(fixtureSolve.comment)
          expect(solve.createdAt).toBe(fixtureSolve.createdAt)
          expect(solve.event).toBe(fixtureSolve.event)
          expect(solve.roundId).toBe(fixtureSolve.roundId)
          expect(solve.roundIndex).toBe(fixtureSolve.roundIndex)
        }
      }
      if (fixture.sessionOrder) {
        expect(first.data.sessionOrder?.ids).toEqual(fixture.sessionOrder.ids)
      }
      if (fixture.sessionTransfers) {
        expect(first.data.sessionTransfers).toHaveLength(fixture.sessionTransfers.length)
      }

      // Migrate in memory, serialize and reload. Semantically significant
      // fields must survive the current-schema round trip.
      const candidate = serializeSessionsData(first.data)
      const reloadStorage = new MemoryStorage()
      reloadStorage.seed(SESSIONS_STORAGE_KEY, candidate)
      const second = loadSessionsChecked(reloadStorage)
      expect(second.ok).toBe(true)
      if (!second.ok) throw new Error(`sessions v${version} did not reload`)
      expect(second.data).toEqual(first.data)
      expect(serializeSessionsData(second.data)).toBe(candidate)
    })
  }
})

describe('frozen settings fixtures v1–v13', () => {
  for (let version = 1; version <= 13; version += 1) {
    it(`round-trips v${version} with documented defaults`, () => {
      const raw = readText(`settings-v${version}.json`)
      const storage = new MemoryStorage()
      storage.seed(SETTINGS_STORAGE_KEY, raw)
      const first = loadSettingsChecked(storage)
      expect(first.ok, `v${version}`).toBe(true)
      if (!first.ok) throw new Error(`sessions v${version} was rejected`)
      expect(first.sourceVersion).toBe(version)
      expect(first.raw).toBe(raw)
      const fixture = JSON.parse(raw) as { settings: Record<string, unknown> }
      for (const [key, value] of Object.entries(fixture.settings)) {
        expect(first.settings).toHaveProperty(key)
        if (typeof value !== 'object' || value === null) {
          expect((first.settings as unknown as Record<string, unknown>)[key]).toEqual(value)
        }
      }
      const candidate = JSON.stringify({
        version: 13,
        settings: first.settings,
      })
      const reload = new MemoryStorage()
      reload.seed(SETTINGS_STORAGE_KEY, candidate)
      const second = loadSettingsChecked(reload)
      expect(second.ok).toBe(true)
      if (!second.ok) throw new Error(`settings v${version} did not reload`)
      expect(second.settings).toEqual(first.settings)
    })
  }
})

describe('Training, native backup, sync and journal fixtures', () => {
  it('round-trips Training v1 and preserves permitted unknown additive fields', () => {
    const raw = readText('training-v1.json')
    const data = deserializeTrainingData(raw)
    const serialized = serializeTrainingData(data)
    expect(deserializeTrainingData(serialized)).toEqual(data)

    const withExtension = {
      ...data,
      futureAdditiveField: { retained: true },
    }
    const extensionRaw = JSON.stringify(withExtension)
    const extended = deserializeTrainingData(extensionRaw)
    expect(serializeTrainingData(extended)).toContain('"futureAdditiveField"')
  })

  it('reloads a native backup v1 through its checked parser', () => {
    const result = parseBackup(readText('native-backup-v1.json'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const backup = result.backup
    expect(backup.version).toBe(1)
    expect(backup.sessions.sessions[0]?.solves[0]).toMatchObject({
      id: 'solve-fixture',
      rawMs: 12_340,
    })
    const second = parseBackup(
      JSON.stringify(
        createBackup(
          backup.sessions,
          backup.settings,
          new Date(backup.exportedAt),
        ),
      ),
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.backup.sessions).toEqual(backup.sessions)
    expect(second.backup.settings).toEqual(backup.settings)
  })

  it('round-trips sync v1 provenance with tombstones and device identity', () => {
    const raw = readText('sync-v1.json')
    const storage = new MemoryStorage()
    storage.seed(SYNC_STORAGE_KEY, raw)
    const first = loadSyncStorageChecked(storage)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.data.runtime.deviceId).toBe('fixture-device')
    expect(saveSyncStorage(first.data, storage)).toBe(true)
    expect(loadSyncStorage(storage)).toEqual(first.data)
  })

  it('round-trips legacy solves and replacement journals', () => {
    const legacyStorage = new MemoryStorage()
    legacyStorage.seed(SOLVES_STORAGE_KEY, readText('legacy-solves-v1.json'))
    expect(loadSolves(legacyStorage)).toHaveLength(1)
    expect(loadSolves(legacyStorage)[0]?.id).toBe('solve-fixture')

    for (const [file, phase] of [
      ['replacement-prepared-v1.json', 'prepared'],
      ['replacement-committed-v1.json', 'committed'],
    ] as const) {
      const storage = new MemoryStorage()
      storage.seed(REPLACEMENT_STORAGE_KEY, readText(file))
      const loaded = loadReplacementJournal(storage)
      expect(loaded.status).toBe('ok')
      if (loaded.status === 'ok') expect(loaded.journal.phase).toBe(phase)
    }
  })
})

describe('corrupt and future fixtures never authorize destructive writes', () => {
  const cases = [
    ['sessions', SESSIONS_STORAGE_KEY, 'sessions-malformed.json', 'sessions-truncated.json', 'sessions-future.json'],
    ['settings', SETTINGS_STORAGE_KEY, 'settings-malformed.json', null, 'settings-future.json'],
    ['training', TRAINING_STORAGE_KEY, 'training-malformed.json', null, 'training-future.json'],
    ['sync', SYNC_STORAGE_KEY, 'sync-malformed.json', null, 'sync-future.json'],
  ] as const

  for (const [name, key, malformed, truncated, future] of cases) {
    it(`${name} rejects malformed, truncated and future bytes with zero writes`, () => {
      for (const file of [malformed, truncated, future]) {
        if (!file) continue
        const raw = readText(file)
        const storage = new MemoryStorage()
        storage.seed(key, raw)
        if (name === 'sessions') expect(loadSessionsChecked(storage).ok).toBe(false)
        if (name === 'settings') expect(loadSettingsChecked(storage).ok).toBe(false)
        if (name === 'training') expect(loadTraining(storage).ok).toBe(false)
        if (name === 'sync') {
          expect(loadSyncStorageChecked(storage).ok).toBe(false)
          expect(
            saveSyncStorage(JSON.parse(readText('sync-v1.json')) as SyncStorageData, storage),
          ).toBe(false)
        }
        expect(storage.writes).toBe(0)
        expect(storage.getItem(key)).toBe(raw)
      }
    })
  }

  it('rejects malformed and future native backups before any data change', () => {
    for (const file of ['native-backup-malformed.json', 'native-backup-future.json']) {
      expect(parseBackup(readText(file)).ok).toBe(false)
    }
  })

  it('retains malformed replacement records and reports them', () => {
    for (const file of ['replacement-malformed.json', 'replacement-future.json']) {
      const raw = readText(file)
      const storage = new MemoryStorage()
      storage.seed(REPLACEMENT_STORAGE_KEY, raw)
      expect(loadReplacementJournal(storage).status).toBe('invalid')
      expect(recoverPendingReplacement(storage).status).toBe('invalid')
      expect(storage.writes).toBe(0)
      expect(storage.getItem(REPLACEMENT_STORAGE_KEY)).toBe(raw)
    }
  })
})
