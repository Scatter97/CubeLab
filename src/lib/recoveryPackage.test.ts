import { describe, expect, it } from 'vitest'
import {
  RECOVERY_PACKAGE_FORMAT,
  createRecoveryPackage,
  resetLocalDataAfterRecoveryExport,
  restoreVerifiedUpgradeArchive,
  verifyRecoveryPackage,
  type RecoveryStorage,
} from './recoveryPackage'
import {
  createMemoryUpgradeArchiveStore,
  createUpgradeArchive,
  markUpgradeArchiveStatus,
} from './upgradeArchive'
import {
  SESSIONS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  DEFAULT_SETTINGS,
  parseSessionsData,
  serializeSessionsData,
} from './storage'

class MemoryStorage implements RecoveryStorage {
  readonly values = new Map<string, string>()
  readonly failGetKeys = new Set<string>()
  readonly removedKeys: string[] = []
  failRemove = false
  get length() {
    return this.values.size
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }
  getItem(key: string): string | null {
    if (this.failGetKeys.has(key)) throw new Error('synthetic read failure')
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
  removeItem(key: string): void {
    if (this.failRemove) throw new Error('remove failed')
    this.removedKeys.push(key)
    this.values.delete(key)
  }
  seed(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const now = 1_700_000_000_000
const validSessions = serializeSessionsData(
  parseSessionsData({
    version: 7,
    activeSessionId: 'session-1',
    sessions: [
      {
        id: 'session-1',
        name: 'Recovery',
        createdAt: now,
        updatedAt: now,
        solves: [
          {
            id: 'solve-1',
            event: '333',
            rawMs: 12_340,
            penalty: 'none',
            scramble: "R U R' U'",
            comment: 'keep',
            createdAt: now,
          },
        ],
      },
    ],
  })!,
)

function seeded(): MemoryStorage {
  const storage = new MemoryStorage()
  storage.seed(SESSIONS_STORAGE_KEY, validSessions)
  storage.seed(SETTINGS_STORAGE_KEY, '{"version":14,"settings":{"future":true}}')
  storage.seed('cubelab:recovery:v1', JSON.stringify({ version: 1, operations: [] }))
  storage.seed('cubelab:oauth-access-token', 'secret')
  storage.seed('unrelated:key', 'leave me')
  return storage
}

describe('emergency recovery package', () => {
  it('preserves exact bytes, distinguishes absent keys and excludes secrets', () => {
    const storage = seeded()
    const pkg = createRecoveryPackage(storage, {
      now: new Date('2026-11-21T12:00:00.000Z'),
      failureKind: 'settings',
      failureMessage: 'future schema',
      appVersion: '0.01.261121:3',
    })
    expect(pkg.app).toBe('CubeLab')
    expect(pkg.format).toBe(RECOVERY_PACKAGE_FORMAT)
    expect(pkg.failureKind).toBe('settings')
    const sessions = pkg.records.find((record) => record.key === SESSIONS_STORAGE_KEY)
    expect(sessions).toMatchObject({
      present: true,
      raw: validSessions,
      sourceVersion: 7,
    })
    const settings = pkg.records.find((record) => record.key === SETTINGS_STORAGE_KEY)
    expect(settings).toMatchObject({
      present: true,
      raw: '{"version":14,"settings":{"future":true}}',
      sourceVersion: 14,
    })
    const legacy = pkg.records.find((record) => record.key === 'cubelab:solves:v1')
    expect(legacy).toMatchObject({ present: false, raw: null })
    expect(JSON.stringify(pkg)).not.toContain('secret')
    expect(JSON.stringify(pkg)).not.toContain('leave me')
    expect(verifyRecoveryPackage(pkg)).toBe(true)
  })

  it('does not truncate a large synthetic history', () => {
    const storage = new MemoryStorage()
    const large = 'x'.repeat(6 * 1024 * 1024)
    storage.seed(SESSIONS_STORAGE_KEY, large)
    const pkg = createRecoveryPackage(storage)
    const record = pkg.records.find((entry) => entry.key === SESSIONS_STORAGE_KEY)
    expect(record?.raw).toHaveLength(large.length)
    expect(record?.byteLength).toBe(large.length)
    expect(verifyRecoveryPackage(pkg)).toBe(true)
  })

  it('detects a changed record after export', () => {
    const pkg = createRecoveryPackage(seeded())
    const tampered = {
      ...pkg,
      records: pkg.records.map((record) =>
        record.key === SESSIONS_STORAGE_KEY
          ? { ...record, raw: `${record.raw}!`, checksum: record.checksum }
          : record,
      ),
    }
    expect(verifyRecoveryPackage(tampered)).toBe(false)
  })

  it('marks a failed read as unreadable instead of treating it as absent', () => {
    const storage = seeded()
    storage.failGetKeys.add(SESSIONS_STORAGE_KEY)
    const pkg = createRecoveryPackage(storage)

    expect(pkg.unreadableKeys).toEqual([SESSIONS_STORAGE_KEY])
    expect(
      pkg.records.find((record) => record.key === SESSIONS_STORAGE_KEY),
    ).toMatchObject({ present: false, raw: null, readError: true })
    expect(verifyRecoveryPackage(pkg)).toBe(true)
  })
})

describe('verified local archive restore', () => {
  it('archives the current state first and restores the exact archived bytes', async () => {
    const storage = new MemoryStorage()
    const archiveStore = createMemoryUpgradeArchiveStore()
    const archive = await createUpgradeArchive(
      {
        reason: 'schema-migration',
        sources: [
          { key: SESSIONS_STORAGE_KEY, raw: validSessions, sourceVersion: 7 },
          {
            key: SETTINGS_STORAGE_KEY,
            raw: JSON.stringify({ version: 13, settings: DEFAULT_SETTINGS }),
            sourceVersion: 13,
          },
        ],
      },
      archiveStore,
    )
    await markUpgradeArchiveStatus(archive.id, 'complete', archiveStore)
    storage.seed(SESSIONS_STORAGE_KEY, '{"broken":true}')
    storage.seed(SETTINGS_STORAGE_KEY, '{broken')

    const result = await restoreVerifiedUpgradeArchive({
      archive,
      storage,
      archiveStore,
      now,
    })
    expect(result.ok).toBe(true)
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe(validSessions)
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toContain('"version":13')
    const records = await archiveStore.list()
    expect(records.some((record) => record.reason === 'pre-restore')).toBe(true)
    expect(records.find((record) => record.id === archive.id)).toBeTruthy()
  })

  it('refuses to restore when a current record cannot be read safely', async () => {
    const storage = seeded()
    storage.failGetKeys.add(SETTINGS_STORAGE_KEY)
    const archiveStore = createMemoryUpgradeArchiveStore()
    const archive = await createUpgradeArchive(
      {
        reason: 'schema-migration',
        sources: [
          { key: SESSIONS_STORAGE_KEY, raw: validSessions, sourceVersion: 7 },
          {
            key: SETTINGS_STORAGE_KEY,
            raw: JSON.stringify({ version: 13, settings: DEFAULT_SETTINGS }),
            sourceVersion: 13,
          },
        ],
      },
      archiveStore,
    )
    await markUpgradeArchiveStatus(archive.id, 'complete', archiveStore)
    const before = storage.getItem(SESSIONS_STORAGE_KEY)

    const result = await restoreVerifiedUpgradeArchive({
      archive,
      storage,
      archiveStore,
      now,
    })

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/could not be read safely/i)
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe(before)
  })

  it('rejects a tampered archive without changing any bytes', async () => {
    const storage = seeded()
    const archiveStore = createMemoryUpgradeArchiveStore()
    const archive = await createUpgradeArchive(
      {
        reason: 'schema-migration',
        sources: [{ key: SESSIONS_STORAGE_KEY, raw: 'old', sourceVersion: 6 }],
      },
      archiveStore,
    )
    const tampered = {
      ...archive,
      entries: {
        ...archive.entries,
        [SESSIONS_STORAGE_KEY]: {
          ...archive.entries[SESSIONS_STORAGE_KEY]!,
          raw: 'forged',
        },
      },
    }
    const before = storage.getItem(SESSIONS_STORAGE_KEY)
    const result = await restoreVerifiedUpgradeArchive({
      archive: tampered,
      storage,
      archiveStore,
    })
    expect(result.ok).toBe(false)
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe(before)
  })

  it('rejects an archive with a non-restorable key', async () => {
    const storage = seeded()
    const archiveStore = createMemoryUpgradeArchiveStore()
    const archive = await createUpgradeArchive(
      {
        reason: 'schema-migration',
        sources: [{ key: 'cubelab:training:v1', raw: '{}', sourceVersion: 1 }],
      },
      archiveStore,
    )
    const before = storage.getItem(SESSIONS_STORAGE_KEY)
    const result = await restoreVerifiedUpgradeArchive({
      archive,
      storage,
      archiveStore,
    })
    expect(result.ok).toBe(false)
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe(before)
  })
})

describe('export and start fresh', () => {
  it('removes recovery data but keeps verified upgrade archives', async () => {
    const storage = seeded()
    const archiveStore = createMemoryUpgradeArchiveStore()
    const archive = await createUpgradeArchive(
      {
        reason: 'schema-migration',
        sources: [{ key: SESSIONS_STORAGE_KEY, raw: validSessions, sourceVersion: 7 }],
      },
      archiveStore,
    )
    storage.seed(`cubelab:upgrade-archive:v1:${archive.id}`, JSON.stringify(archive))
    const result = resetLocalDataAfterRecoveryExport(storage)
    expect(result.ok).toBe(true)
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBeNull()
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBeNull()
    expect(storage.getItem('cubelab:recovery:v1')).toBeNull()
    expect(storage.getItem(`cubelab:upgrade-archive:v1:${archive.id}`)).not.toBeNull()
    expect(storage.getItem('unrelated:key')).toBe('leave me')
  })

  it('reports a failed removal instead of claiming a clean reset', () => {
    const storage = seeded()
    storage.failRemove = true
    const result = resetLocalDataAfterRecoveryExport(storage)
    expect(result.ok).toBe(false)
    expect(result.failed.length).toBeGreaterThan(0)
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).not.toBeNull()
  })

  it('leaves history intact when its only copy cannot be read', () => {
    const storage = seeded()
    storage.failGetKeys.add(SESSIONS_STORAGE_KEY)
    const pkg = createRecoveryPackage(storage)

    const result = resetLocalDataAfterRecoveryExport(storage, pkg)

    expect(result).toMatchObject({
      ok: false,
      reason: 'unreadable',
      failed: [SESSIONS_STORAGE_KEY],
    })
    expect(result.removed).toEqual([])
    expect(storage.removedKeys).toEqual([])
    expect(storage.values.get(SESSIONS_STORAGE_KEY)).toBe(validSessions)
  })

  it('blocks reset when local data changed after the acknowledged export', () => {
    const storage = seeded()
    const pkg = createRecoveryPackage(storage)
    storage.seed(SESSIONS_STORAGE_KEY, `${validSessions} `)

    const result = resetLocalDataAfterRecoveryExport(storage, pkg)

    expect(result).toMatchObject({
      ok: false,
      reason: 'changed',
      failed: [SESSIONS_STORAGE_KEY],
    })
    expect(result.removed).toEqual([])
    expect(storage.values.get(SESSIONS_STORAGE_KEY)).toBe(`${validSessions} `)
  })
})
