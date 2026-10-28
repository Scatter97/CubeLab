import { describe, expect, it } from 'vitest'
import {
  createDefaultSyncStorage,
  getSyncDeviceId,
  loadSyncStorage,
  parseSyncStorageData,
  resetDeviceIdCacheForTests,
  saveSyncStorage,
  SYNC_STORAGE_KEY,
  type SyncStorageData,
} from './syncStorage'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem(key: string): string | null {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      values.set(key, value)
    },
  }
}

describe('stable device identity', () => {
  it('persists one identity on a clean install and reuses it after reload', () => {
    resetDeviceIdCacheForTests()
    const storage = memoryStorage()

    const first = loadSyncStorage(storage)
    expect(storage.values.has(SYNC_STORAGE_KEY)).toBe(true)

    resetDeviceIdCacheForTests()
    const reloaded = loadSyncStorage(storage)
    expect(reloaded.runtime.deviceId).toBe(first.runtime.deviceId)

    resetDeviceIdCacheForTests()
    expect(getSyncDeviceId(storage)).toBe(first.runtime.deviceId)
  })

  it('preserves an identity from an existing upgraded installation', () => {
    resetDeviceIdCacheForTests()
    const existing = createDefaultSyncStorage('existing-device')
    const storage = memoryStorage({
      [SYNC_STORAGE_KEY]: JSON.stringify(existing),
    })

    expect(loadSyncStorage(storage).runtime.deviceId).toBe('existing-device')
    resetDeviceIdCacheForTests()
    expect(getSyncDeviceId(storage)).toBe('existing-device')
  })

  it('does not read localStorage on repeated identity lookups', () => {
    resetDeviceIdCacheForTests()
    let reads = 0
    const storage = memoryStorage()
    const counted = {
      getItem(key: string): string | null {
        reads += 1
        return storage.getItem(key)
      },
      setItem: storage.setItem.bind(storage),
    }

    const first = getSyncDeviceId(counted)
    const firstReads = reads
    for (let index = 0; index < 20; index += 1) {
      expect(getSyncDeviceId(counted)).toBe(first)
    }
    expect(reads).toBe(firstReads)
  })

  it('keeps identities in legacy preferences without a sync mode field', () => {
    const legacy = createDefaultSyncStorage('legacy-device') as SyncStorageData & {
      preferences: SyncStorageData['preferences'] & { mode?: string }
    }
    legacy.preferences.mode = 'solve'

    const parsed = parseSyncStorageData(legacy)
    expect(parsed?.runtime.deviceId).toBe('legacy-device')
    expect(parsed?.preferences).not.toHaveProperty('mode')
  })

  it('reuses the cached fallback when storage is unavailable', () => {
    resetDeviceIdCacheForTests()
    const first = getSyncDeviceId(null)
    expect(getSyncDeviceId(null)).toBe(first)
  })

  it('round-trips restored tombstones', () => {
    const storage = memoryStorage()
    const data = createDefaultSyncStorage('device-a')
    data.runtime.tombstones = [
      {
        kind: 'solve',
        id: 'solve-1',
        deletedAt: 10,
        deletedByDeviceId: 'device-a',
        restoredAt: 20,
      },
    ]
    saveSyncStorage(data, storage)

    expect(loadSyncStorage(storage).runtime.tombstones).toEqual(
      data.runtime.tombstones,
    )
  })
})

describe('snapshot retention preferences', () => {
  it('applies the documented defaults to records that predate the policy', () => {
    const legacy = createDefaultSyncStorage('device-a')
    const preferences = legacy.preferences as unknown as Record<string, unknown>
    delete preferences.snapshotCleanupEnabled
    delete preferences.snapshotKeepPerDevice
    delete preferences.snapshotMaxAgeDays

    expect(parseSyncStorageData(legacy)?.preferences).toMatchObject({
      snapshotCleanupEnabled: true,
      snapshotKeepPerDevice: 10,
      snapshotMaxAgeDays: 30,
    })
  })

  it('preserves valid policy choices', () => {
    const data = createDefaultSyncStorage('device-a')
    data.preferences.snapshotCleanupEnabled = false
    data.preferences.snapshotKeepPerDevice = 50
    data.preferences.snapshotMaxAgeDays = 365

    expect(parseSyncStorageData(data)?.preferences).toMatchObject({
      snapshotCleanupEnabled: false,
      snapshotKeepPerDevice: 50,
      snapshotMaxAgeDays: 365,
    })
  })

  it('rejects out-of-range or malformed policy values field by field', () => {
    const data = createDefaultSyncStorage('device-a')
    const preferences = data.preferences as unknown as Record<string, unknown>
    preferences.snapshotCleanupEnabled = 'yes'
    preferences.snapshotKeepPerDevice = 4
    preferences.snapshotMaxAgeDays = 14

    expect(parseSyncStorageData(data)?.preferences).toMatchObject({
      snapshotCleanupEnabled: true,
      snapshotKeepPerDevice: 10,
      snapshotMaxAgeDays: 30,
    })
  })
})

describe('conflict audit history', () => {
  const entry = {
    auditId: 'audit-1',
    kind: 'settings' as const,
    id: 'settings',
    field: 'accentColor',
    localValue: 'green',
    remoteValue: 'blue',
    localUpdatedAt: 10,
    remoteUpdatedAt: 20,
    resolution: 'local' as const,
    resolvedAt: 30,
    byDeviceId: 'device-a',
    remoteOnly: false,
  }

  it('round-trips valid audit entries and keeps them out of envelopes', () => {
    const storage = memoryStorage()
    const data = createDefaultSyncStorage('device-a')
    data.runtime.conflictAudit = [entry]
    saveSyncStorage(data, storage)

    expect(loadSyncStorage(storage).runtime.conflictAudit).toEqual([entry])
  })

  it('drops malformed entries and caps only the displayed history', () => {
    const data = createDefaultSyncStorage('device-a')
    data.runtime.conflictAudit = [
      entry,
      { ...entry, auditId: '', resolution: 'manual-pending' },
      { ...entry, auditId: 'audit-2', byDeviceId: '' },
      ...Array.from({ length: 60 }, (_, index) => ({
        ...entry,
        auditId: `audit-${index + 3}`,
      })),
    ] as never

    const parsed = parseSyncStorageData(data)
    expect(parsed?.runtime.conflictAudit).toHaveLength(50)
    expect(parsed?.runtime.conflictAudit[0]?.auditId).toBe('audit-1')
    expect(
      parsed?.runtime.conflictAudit.some(
        (candidate) => candidate.auditId === 'audit-2',
      ),
    ).toBe(false)
  })

  it('recovers an audit entry whose cleared value serialized as null', () => {
    const data = createDefaultSyncStorage('device-a')
    data.runtime.conflictAudit = [
      {
        ...entry,
        kind: 'session',
        id: 'session-1',
        field: 'inspectionEnabled',
        localValue: null,
        remoteValue: true,
      },
    ] as never

    expect(
      parseSyncStorageData(data)?.runtime.conflictAudit[0],
    ).toMatchObject({
      field: 'inspectionEnabled',
      localValue: null,
      remoteValue: true,
    })
  })
})
