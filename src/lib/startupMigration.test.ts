import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SESSIONS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SOLVES_STORAGE_KEY,
  loadSessionsChecked,
  loadSettingsChecked,
  parseSessionsData,
  saveSessions,
  saveSettings,
  serializeSessionsData,
  type StorageLike,
} from './storage'
import {
  runStartupMigration,
  type StartupMigrationPhase,
} from './startupMigration'
import {
  createMemoryUpgradeArchiveStore,
  verifyUpgradeArchiveRecord,
  type UpgradeArchiveStore,
} from './upgradeArchive'
import {
  beginReplacement,
  markReplacementCommitted,
  loadReplacementJournal,
} from './replacement'
import { recoverReplacementAtStartup } from './startupRecovery'

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  failGetKeys = new Set<string>()
  failSetKeys = new Set<string>()
  getItem(key: string): string | null {
    if (this.failGetKeys.has(key)) throw new Error('read failed')
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    if (this.failSetKeys.has(key)) throw new Error('quota exceeded')
    this.values.set(key, value)
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
  seed(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const now = 1_700_000_000_000
const solve = {
  id: 'solve-1',
  event: '333',
  rawMs: 12_340,
  penalty: 'none',
  scramble: "R U R' U'",
  comment: 'keep me',
  createdAt: now,
}

function v6Sessions(): string {
  return JSON.stringify({
    version: 6,
    activeSessionId: 'session-1',
    sessionOrder: { ids: ['session-1'], updatedAt: now, editorId: 'device-a' },
    sessions: [
      {
        id: 'session-1',
        name: 'Evening',
        event: '333',
        createdAt: now,
        updatedAt: now,
        solves: [solve],
      },
    ],
  })
}

function v2Settings(): string {
  return JSON.stringify({
    version: 2,
    settings: {
      inspectionEnabled: false,
      theme: 'dark',
      accentColor: 'blue',
      holdDurationMs: 450,
      statVisibility: { ao5: false },
    },
  })
}

function seeded(): MemoryStorage {
  const storage = new MemoryStorage()
  storage.seed(SESSIONS_STORAGE_KEY, v6Sessions())
  storage.seed(SETTINGS_STORAGE_KEY, v2Settings())
  return storage
}

describe('recoverable startup migration', () => {
  it('does no work or writes when the stored bytes are already current', async () => {
    const storage = new MemoryStorage()
    saveSessions(
      parseSessionsData({
        version: 7,
        activeSessionId: 'session-1',
        sessions: [
          {
            id: 'session-1',
            name: 'Session 1',
            createdAt: now,
            updatedAt: now,
            solves: [solve],
          },
        ],
      })!,
      storage,
    )
    saveSettings(DEFAULT_SETTINGS, storage)
    const sessionsBefore = storage.getItem(SESSIONS_STORAGE_KEY)
    const settingsBefore = storage.getItem(SETTINGS_STORAGE_KEY)
    const archiveStore = createMemoryUpgradeArchiveStore()
    await expect(
      runStartupMigration({ storage, archiveStore }),
    ).resolves.toEqual({ status: 'none' })
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe(sessionsBefore)
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe(settingsBefore)
    expect(await archiveStore.list()).toEqual([])
  })

  it('archives exact pre-upgrade bytes, then commits a validated v7/v13 candidate', async () => {
    const storage = seeded()
    const archiveStore = createMemoryUpgradeArchiveStore()
    const result = await runStartupMigration({
      storage,
      archiveStore,
      now,
    })
    expect(result).toMatchObject({
      status: 'completed',
      updatedKeys: [SESSIONS_STORAGE_KEY, SETTINGS_STORAGE_KEY],
      cleanupPending: false,
    })
    if (result.status !== 'completed') return

    const archive = await archiveStore.get(result.archiveId)
    expect(archive).not.toBeNull()
    expect(verifyUpgradeArchiveRecord(archive)).toBe(true)
    expect(archive).toMatchObject({
      reason: 'schema-migration',
      status: 'complete',
      sourceVersions: {
        [SESSIONS_STORAGE_KEY]: 6,
        [SETTINGS_STORAGE_KEY]: 2,
      },
    })
    expect(archive?.entries[SESSIONS_STORAGE_KEY]?.raw).toBe(v6Sessions())
    expect(archive?.entries[SETTINGS_STORAGE_KEY]?.raw).toBe(v2Settings())

    const sessions = loadSessionsChecked(storage)
    expect(sessions.ok).toBe(true)
    if (sessions.ok) {
      expect(sessions.sourceVersion).toBe(7)
      expect(sessions.data.sessions[0]?.solves[0]).toMatchObject({
        id: 'solve-1',
        rawMs: 12_340,
        scramble: "R U R' U'",
        comment: 'keep me',
      })
    }
    const settings = loadSettingsChecked(storage)
    expect(settings.ok).toBe(true)
    if (settings.ok) {
      expect(settings.sourceVersion).toBe(13)
      expect(settings.settings).toMatchObject({
        inspectionEnabled: false,
        theme: 'dark',
        accentColor: 'blue',
        holdDurationMs: 450,
      })
    }
    expect(loadReplacementJournal(storage).status).toBe('none')
  })

  it('archives and migrates a legacy solve history without losing the legacy bytes', async () => {
    const storage = new MemoryStorage()
    const legacy = JSON.stringify({ version: 1, solves: [solve] })
    storage.seed(SOLVES_STORAGE_KEY, legacy)
    const archiveStore = createMemoryUpgradeArchiveStore()
    const result = await runStartupMigration({ storage, archiveStore, now })
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    const archive = await archiveStore.get(result.archiveId)
    expect(archive?.reason).toBe('legacy-migration')
    expect(archive?.entries[SOLVES_STORAGE_KEY]?.raw).toBe(legacy)
    expect(archive?.entries[SESSIONS_STORAGE_KEY]).toMatchObject({
      present: false,
      raw: null,
    })
    const sessions = loadSessionsChecked(storage)
    expect(sessions.ok).toBe(true)
    if (sessions.ok) {
      expect(sessions.data.sessions[0]?.solves[0]?.id).toBe('solve-1')
    }
    expect(storage.getItem(SOLVES_STORAGE_KEY)).toBe(legacy)
  })

  it('blocks before any write when the verified archive cannot be created', async () => {
    const storage = seeded()
    const sessionsBefore = storage.getItem(SESSIONS_STORAGE_KEY)
    const settingsBefore = storage.getItem(SETTINGS_STORAGE_KEY)
    const failing: UpgradeArchiveStore = {
      backend: 'memory',
      async put() {
        throw new Error('quota exceeded')
      },
      async get() {
        return null
      },
      async list() {
        return []
      },
      async delete() {},
    }
    const result = await runStartupMigration({ storage, archiveStore: failing })
    expect(result).toMatchObject({ status: 'blocked', reason: 'archive' })
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe(sessionsBefore)
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe(settingsBefore)
    expect(loadReplacementJournal(storage).status).toBe('none')
  })

  it.each<StartupMigrationPhase>([
    'before-archive-write',
    'after-archive-write',
    'before-candidate-write',
    'after-candidate-write',
    'during-verification',
    'before-commit-marker',
    'after-commit-marker',
    'before-cleanup',
    'after-cleanup',
  ])('preserves a recoverable state when interrupted at %s', async (phase) => {
    const storage = seeded()
    const sessionsBefore = storage.getItem(SESSIONS_STORAGE_KEY)
    const settingsBefore = storage.getItem(SETTINGS_STORAGE_KEY)
    const archiveStore = createMemoryUpgradeArchiveStore()
    const result = await runStartupMigration({
      storage,
      archiveStore,
      now,
      onPhase: (current) => {
        if (current === phase) throw new Error(`injected failure at ${phase}`)
      },
    })
    expect(result.status).toBe('blocked')
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe(sessionsBefore)
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe(settingsBefore)
    expect(loadReplacementJournal(storage).status).toBe('none')
    if (phase !== 'before-archive-write') {
      expect(await archiveStore.list()).toHaveLength(1)
    }
  })

  it('rolls back both keys when a candidate write fails part-way', async () => {
    const storage = seeded()
    const sessionsBefore = storage.getItem(SESSIONS_STORAGE_KEY)
    const settingsBefore = storage.getItem(SETTINGS_STORAGE_KEY)
    storage.failSetKeys.add(SETTINGS_STORAGE_KEY)
    const result = await runStartupMigration({
      storage,
      archiveStore: createMemoryUpgradeArchiveStore(),
    })
    expect(result).toMatchObject({ status: 'blocked', reason: 'write' })
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe(sessionsBefore)
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe(settingsBefore)
    expect(loadReplacementJournal(storage).status).toBe('none')
  })

  it('recovers a crash before the commit marker by rolling back the candidate', async () => {
    const storage = seeded()
    const sessionsBefore = storage.getItem(SESSIONS_STORAGE_KEY)
    const begun = beginReplacement('upgrade', ['sessions'], storage)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    storage.setItem(SESSIONS_STORAGE_KEY, serializeSessionsData(
      parseSessionsData({ version: 7, activeSessionId: 'session-1', sessions: [{
        id: 'session-1', name: 'Candidate', createdAt: now, updatedAt: now, solves: [],
      }] })!,
    ))
    await expect(
      recoverReplacementAtStartup({ storage, lockManager: { request: (_n, _o, cb) => cb(null) } }),
    ).resolves.toMatchObject({ status: 'ready', recovery: { status: 'rolled-back' } })
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe(sessionsBefore)
  })

  it('recovers a crash after the commit marker by keeping the committed candidate', async () => {
    const storage = seeded()
    const begun = beginReplacement('upgrade', ['sessions'], storage)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const candidate = serializeSessionsData(
      parseSessionsData({ version: 7, activeSessionId: 'session-1', sessions: [{
        id: 'session-1', name: 'Committed', createdAt: now, updatedAt: now, solves: [],
      }] })!,
    )
    storage.setItem(SESSIONS_STORAGE_KEY, candidate)
    expect(markReplacementCommitted(begun.journal, storage)).toBe(true)
    await expect(
      recoverReplacementAtStartup({ storage, lockManager: { request: (_n, _o, cb) => cb(null) } }),
    ).resolves.toMatchObject({ status: 'ready', recovery: { status: 'committed' } })
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe(candidate)
    expect(loadReplacementJournal(storage).status).toBe('none')
  })
})
