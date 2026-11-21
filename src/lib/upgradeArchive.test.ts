import { describe, expect, it } from 'vitest'
import {
  archiveChecksum,
  createLocalStorageUpgradeArchiveStore,
  createMemoryUpgradeArchiveStore,
  createUpgradeArchive,
  lastKnownGoodArchive,
  markUpgradeArchiveStatus,
  retainUpgradeArchives,
  verifyUpgradeArchiveRecord,
  type UpgradeArchiveRecord,
} from './upgradeArchive'
import type { StorageLike } from './storage'

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  failSet = false
  failGet = false
  getItem(key: string): string | null {
    if (this.failGet) throw new Error('read failed')
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error('quota exceeded')
    this.values.set(key, value)
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const sessionsRaw = JSON.stringify({ version: 6, sessions: [{ raw: 'exact bytes' }] })
const settingsRaw = '{"version":2,"settings":{"inspectionEnabled":true}}'

describe('verified upgrade archives', () => {
  it('stores exact raw values and distinguishes absent keys', async () => {
    const store = createMemoryUpgradeArchiveStore()
    const archive = await createUpgradeArchive(
      {
        reason: 'schema-migration',
        sources: [
          { key: 'cubelab:sessions:v1', raw: sessionsRaw, sourceVersion: 6 },
          { key: 'cubelab:solves:v1', raw: null, sourceVersion: null },
          { key: 'cubelab:settings:v1', raw: settingsRaw, sourceVersion: 2 },
        ],
        now: 1_700_000_000_000,
        appVersion: '0.01.261121:3',
      },
      store,
    )
    expect(archive.entries['cubelab:sessions:v1']).toMatchObject({
      present: true,
      raw: sessionsRaw,
      checksum: archiveChecksum(sessionsRaw),
      byteLength: sessionsRaw.length,
      sourceVersion: 6,
    })
    expect(archive.entries['cubelab:solves:v1']).toMatchObject({
      present: false,
      raw: null,
      sourceVersion: null,
    })
    expect(archive.includedKeys).toHaveLength(3)
    expect(verifyUpgradeArchiveRecord(archive)).toBe(true)
    expect((await store.list())[0]).toEqual(archive)
  })

  it('rejects an archive whose bytes no longer match its manifest', async () => {
    const store = createMemoryUpgradeArchiveStore()
    const archive = await createUpgradeArchive(
      {
        reason: 'normalization',
        sources: [{ key: 'cubelab:sessions:v1', raw: sessionsRaw, sourceVersion: 7 }],
      },
      store,
    )
    const corrupted: UpgradeArchiveRecord = {
      ...archive,
      entries: {
        ...archive.entries,
        'cubelab:sessions:v1': {
          ...archive.entries['cubelab:sessions:v1']!,
          raw: `${sessionsRaw}!`,
        },
      },
    }
    expect(verifyUpgradeArchiveRecord(corrupted)).toBe(false)
  })

  it('fails when the backend cannot re-read the exact archive', async () => {
    const store = createMemoryUpgradeArchiveStore()
    let reads = 0
    const flaky = {
      ...store,
      async get(id: string) {
        reads += 1
        if (reads === 1) return null
        return store.get(id)
      },
    }
    await expect(
      createUpgradeArchive(
        { reason: 'normalization', sources: [{ key: 'cubelab:settings:v1', raw: settingsRaw }] },
        flaky,
      ),
    ).rejects.toThrow(/verified/)
  })

  it('retains two recent archives plus the newest completed checkpoint', async () => {
    const store = createMemoryUpgradeArchiveStore()
    const ids: string[] = []
    for (let index = 0; index < 5; index += 1) {
      const archive = await createUpgradeArchive(
        {
          reason: 'schema-migration',
          sources: [{ key: 'cubelab:sessions:v1', raw: `${sessionsRaw}:${index}` }],
          now: 1_700_000_000_000 + index,
        },
        store,
      )
      ids.push(archive.id)
      if (index === 2) await markUpgradeArchiveStatus(archive.id, 'complete', store)
    }
    const result = await retainUpgradeArchives(store)
    expect(result.kept).toEqual(expect.arrayContaining([ids[4], ids[3], ids[2]]))
    expect(result.deleted).toHaveLength(2)
    const remaining = await store.list()
    expect(remaining.map((record) => record.id).sort()).toEqual(
      [ids[2], ids[3], ids[4]].sort(),
    )
    expect((await lastKnownGoodArchive(store))?.id).toBe(ids[2])
  })

  it('falls back to exact localStorage bytes when IndexedDB is unavailable', async () => {
    const storage = new MemoryStorage()
    const store = createLocalStorageUpgradeArchiveStore(storage)
    const archive = await createUpgradeArchive(
      {
        reason: 'legacy-migration',
        sources: [{ key: 'cubelab:solves:v1', raw: sessionsRaw, sourceVersion: 1 }],
      },
      store,
    )
    expect(store.backend).toBe('localstorage')
    expect(verifyUpgradeArchiveRecord(await store.get(archive.id))).toBe(true)
    const stored = JSON.parse(
      storage.getItem(`cubelab:upgrade-archive:v1:${archive.id}`)!,
    )
    expect(stored.entries['cubelab:solves:v1'].raw).toBe(sessionsRaw)
  })

  it('reports a quota failure instead of claiming an archive exists', async () => {
    const storage = new MemoryStorage()
    storage.failSet = true
    const store = createLocalStorageUpgradeArchiveStore(storage)
    await expect(
      createUpgradeArchive(
        { reason: 'normalization', sources: [{ key: 'cubelab:settings:v1', raw: settingsRaw }] },
        store,
      ),
    ).rejects.toThrow(/quota/)
  })
})
