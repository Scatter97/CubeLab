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
