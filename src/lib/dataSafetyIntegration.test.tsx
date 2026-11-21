import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, act, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StorageLike } from './storage'
import {
  SESSIONS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  loadSessionsChecked,
  loadSessionsForStartup,
  saveSessions,
  saveSettings,
  DEFAULT_SETTINGS,
} from './storage'
import { runStartupMigration } from './startupMigration'
import { createMemoryUpgradeArchiveStore, type UpgradeArchiveStore } from './upgradeArchive'
import { createRecoveryPackage, verifyRecoveryPackage } from './recoveryPackage'
import { inspectRecoveryStatus } from './recoveryStatus'
import { TRAINING_STORAGE_KEY, createEmptyTrainingData, serializeTrainingData } from './training/storage'
import { useSessions } from '../hooks/useSessions'

const FIXTURES = join(process.cwd(), 'tests/fixtures/storage')
const now = 1_700_000_000_000

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  writes = 0
  failSet = false
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error('quota exceeded')
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

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('full-system data-safety flows', () => {
  it('A: first installation persists the first accepted solve across a reload', async () => {
    const first = renderHook(() => useSessions())
    let id = ''
    act(() => {
      id = first.result.current.addSolve({
        rawMs: 9_876,
        penalty: 'none',
        scramble: "R U R' U'",
      }).id
    })
    await waitFor(() => {
      expect(localStorage.getItem(SESSIONS_STORAGE_KEY)).toContain(id)
    })
    first.unmount()
    const reloaded = loadSessionsForStartup(localStorage)
    expect(reloaded.data.sessions[0]?.solves[0]).toMatchObject({
      id,
      rawMs: 9_876,
      penalty: 'none',
      scramble: "R U R' U'",
    })
  })

  it('B/C: archives old schemas and refuses a corrupt settings record without touching sessions', async () => {
    const storage = new MemoryStorage()
    const sessionsRaw = fixture('sessions-v6.json')
    storage.seed(SESSIONS_STORAGE_KEY, sessionsRaw)
    storage.seed(SETTINGS_STORAGE_KEY, fixture('settings-v2.json'))
    const archiveStore = createMemoryUpgradeArchiveStore()
    const result = await runStartupMigration({ storage, archiveStore, now })
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    const archive = await archiveStore.get(result.archiveId)
    expect(archive?.entries[SESSIONS_STORAGE_KEY]?.raw).toBe(sessionsRaw)
    expect((await loadSessionsChecked(storage)).ok).toBe(true)

    const corruptStorage = new MemoryStorage()
    corruptStorage.seed(SESSIONS_STORAGE_KEY, fixture('sessions-v7.json'))
    corruptStorage.seed(SETTINGS_STORAGE_KEY, '{broken settings')
    const blocked = await runStartupMigration({
      storage: corruptStorage,
      archiveStore: createMemoryUpgradeArchiveStore(),
      now,
    })
    expect(blocked).toMatchObject({ status: 'blocked', reason: 'read' })
    expect(corruptStorage.writes).toBe(0)
    expect((await loadSessionsChecked(corruptStorage)).ok).toBe(true)
    expect(corruptStorage.getItem(SETTINGS_STORAGE_KEY)).toBe('{broken settings')
    const pkg = createRecoveryPackage(corruptStorage)
    expect(verifyRecoveryPackage(pkg)).toBe(true)
    expect(
      pkg.records.find((record) => record.key === SETTINGS_STORAGE_KEY)?.raw,
    ).toBe('{broken settings')
  })

  it('D: future-version records block editing, preserve bytes and remain exportable', async () => {
    const storage = new MemoryStorage()
    const futureSessions = fixture('sessions-future.json')
    storage.seed(SESSIONS_STORAGE_KEY, futureSessions)
    storage.seed(SETTINGS_STORAGE_KEY, fixture('settings-v13.json'))
    const result = await runStartupMigration({
      storage,
      archiveStore: createMemoryUpgradeArchiveStore(),
      now,
    })
    expect(result).toMatchObject({ status: 'blocked', reason: 'read' })
    expect(storage.writes).toBe(0)
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe(futureSessions)
    expect(() => loadSessionsForStartup(storage)).toThrow(/kept/)
    const pkg = createRecoveryPackage(storage, {
      failureKind: 'sessions',
      failureMessage: 'future schema',
    })
    expect(verifyRecoveryPackage(pkg)).toBe(true)
    expect(
      pkg.records.find((record) => record.key === SESSIONS_STORAGE_KEY)?.sourceVersion,
    ).toBe(99)
  })

  it('H: Training and solve stores coexist without cross-contamination', async () => {
    const storage = new MemoryStorage()
    const sessionsRaw = fixture('sessions-v7.json')
    const trainingRaw = serializeTrainingData(createEmptyTrainingData())
    storage.seed(SESSIONS_STORAGE_KEY, sessionsRaw)
    storage.seed(SETTINGS_STORAGE_KEY, fixture('settings-v13.json'))
    storage.seed(TRAINING_STORAGE_KEY, trainingRaw)
    const inspection = await inspectRecoveryStatus(storage)
    expect(
      inspection.stores.find((store) => store.key === SESSIONS_STORAGE_KEY)?.state,
    ).toBe('ok')
    expect(
      inspection.stores.find((store) => store.key === TRAINING_STORAGE_KEY)?.state,
    ).toBe('ok')
    const pkg = createRecoveryPackage(storage)
    expect(
      pkg.records.find((record) => record.key === SESSIONS_STORAGE_KEY)?.raw,
    ).toBe(sessionsRaw)
    expect(
      pkg.records.find((record) => record.key === TRAINING_STORAGE_KEY)?.raw,
    ).toBe(trainingRaw)
  })

  it('I: archive quota failure leaves source bytes and an exportable package', async () => {
    const storage = new MemoryStorage()
    const sessionsRaw = fixture('settings-v13.json')
    storage.seed(SESSIONS_STORAGE_KEY, fixture('sessions-v6.json'))
    storage.seed(SETTINGS_STORAGE_KEY, sessionsRaw)
    const failingArchive: UpgradeArchiveStore = {
      backend: 'memory',
      async put() {
        throw new Error('quota exceeded while archiving')
      },
      async get() {
        return null
      },
      async list() {
        return []
      },
      async delete() {},
    }
    const result = await runStartupMigration({
      storage,
      archiveStore: failingArchive,
      now,
    })
    expect(result).toMatchObject({ status: 'blocked', reason: 'archive' })
    expect(storage.writes).toBe(0)
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe(fixture('sessions-v6.json'))
    expect(verifyRecoveryPackage(createRecoveryPackage(storage))).toBe(true)

    const full = new MemoryStorage()
    saveSessions(
      {
        activeSessionId: 'session-1',
        sessions: [
          {
            id: 'session-1',
            name: 'Last durable',
            createdAt: now,
            updatedAt: now,
            solves: [],
          },
        ],
      },
      full,
    )
    const before = full.getItem(SESSIONS_STORAGE_KEY)
    full.failSet = true
    expect(saveSettings(DEFAULT_SETTINGS, full)).toBe(false)
    expect(full.getItem(SESSIONS_STORAGE_KEY)).toBe(before)
  })
})
