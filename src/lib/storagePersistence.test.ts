import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PERSISTENCE_REQUEST_KEY,
  readStorageHealth,
  requestStoragePersistence,
} from './storagePersistence'
import type { StorageLike } from './storage'

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('storage health', () => {
  it('reports granted persistence and estimates', async () => {
    const health = await readStorageHealth({
      storage: {
        persisted: async () => true,
        estimate: async () => ({ usage: 1024, quota: 4096 }),
      },
    })
    expect(health).toEqual({
      supported: true,
      persisted: true,
      usage: 1024,
      quota: 4096,
      error: null,
    })
  })

  it('treats unsupported APIs as unsupported, not as granted', async () => {
    expect(await readStorageHealth(null)).toMatchObject({
      supported: false,
      persisted: null,
      usage: null,
      quota: null,
    })
    expect(
      await readStorageHealth({ storage: {} }),
    ).toMatchObject({ supported: false, persisted: null })
  })

  it('keeps a read failure distinct from a denial', async () => {
    const health = await readStorageHealth({
      storage: {
        persisted: async () => {
          throw new Error('denied')
        },
        estimate: async () => {
          throw new Error('unavailable')
        },
      },
    })
    expect(health.persisted).toBeNull()
    expect(health.usage).toBeNull()
    expect(health.quota).toBeNull()
    expect(health.error).toMatch(/could not/)
  })
})

describe('persistence requests', () => {
  it('retries nothing when a request marker already exists', async () => {
    const storage = new MemoryStorage()
    storage.setItem(PERSISTENCE_REQUEST_KEY, '{"version":1}')
    const persist = vi.fn(async () => true)
    const result = await requestStoragePersistence({
      navigatorLike: { storage: { persisted: async () => false, persist } },
      storage,
    })
    expect(result.requested).toBe(false)
    expect(persist).not.toHaveBeenCalled()
  })

  it('requests once and reports a grant or denial truthfully', async () => {
    const storage = new MemoryStorage()
    const persist = vi.fn(async () => false)
    const denied = await requestStoragePersistence({
      navigatorLike: { storage: { persisted: async () => false, persist } },
      storage,
      now: 10,
    })
    expect(denied).toMatchObject({
      requested: true,
      granted: false,
      persisted: false,
    })
    expect(persist).toHaveBeenCalledTimes(1)
    const again = await requestStoragePersistence({
      navigatorLike: { storage: { persisted: async () => false, persist } },
      storage,
    })
    expect(again.requested).toBe(false)
    expect(persist).toHaveBeenCalledTimes(1)

    const forced = await requestStoragePersistence({
      navigatorLike: { storage: { persisted: async () => true, persist: async () => true } },
      storage,
      force: true,
    })
    expect(forced).toMatchObject({ requested: true, granted: true, persisted: true })
  })

  it('does not claim a grant when persist throws', async () => {
    const result = await requestStoragePersistence({
      navigatorLike: {
        storage: {
          persisted: async () => false,
          persist: async () => {
            throw new Error('SecurityError')
          },
        },
      },
      storage: new MemoryStorage(),
    })
    expect(result.requested).toBe(true)
    expect(result.granted).toBeNull()
    expect(result.persisted).toBe(false)
    expect(result.error).toMatch(/rejected/)
  })

  it('reports unsupported persist without writing a false grant', async () => {
    const storage = new MemoryStorage()
    const result = await requestStoragePersistence({
      navigatorLike: { storage: { persisted: async () => false } },
      storage,
    })
    expect(result).toMatchObject({
      requested: false,
      granted: null,
      persisted: false,
    })
    expect(storage.getItem(PERSISTENCE_REQUEST_KEY)).toBeNull()
  })
})
