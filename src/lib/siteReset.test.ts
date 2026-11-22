import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginSiteResetGate,
  deleteIndexedDbDatabase,
  isCubeLabCacheName,
  isCubeLabDatabaseName,
  isCubeLabServiceWorkerScript,
  isCubeLabStorageKey,
  parseSiteResetSignal,
  publishSiteResetSignal,
  resetSiteResetGateForTests,
  resetSiteStorage,
  subscribeToSiteReset,
  waitForSyncIdle,
  type IndexedDbLike,
  type ResettableStorage,
  type SiteResetChannelLike,
} from './siteReset'
import { DEFAULT_SETTINGS, saveSessions, saveSettings } from './storage'
import { loadSyncStorage, saveSyncStorage } from './syncStorage'
import { createDefaultSyncStorage } from './syncStorage'
import type { SessionsData } from '../types'

afterEach(() => {
  resetSiteResetGateForTests()
  vi.restoreAllMocks()
})

function memoryStorage(initial: Record<string, string> = {}): ResettableStorage & {
  entries: Map<string, string>
} {
  const entries = new Map(Object.entries(initial))
  return {
    entries,
    get length() {
      return entries.size
    },
    key(index) {
      return [...entries.keys()][index] ?? null
    },
    getItem(key) {
      return entries.get(key) ?? null
    },
    setItem(key, value) {
      entries.set(key, value)
    },
    removeItem(key) {
      entries.delete(key)
    },
  }
}

function sessionData(): SessionsData {
  return {
    activeSessionId: 'session-1',
    sessions: [
      {
        id: 'session-1',
        name: 'Session 1',
        createdAt: 1,
        updatedAt: 1,
        solves: [],
      },
    ],
  }
}

function fakeIndexedDb(
  names: string[],
  mode: 'success' | 'blocked' | 'error' = 'success',
) {
  const deleted: string[] = []
  const factory: IndexedDbLike = {
    databases: async () => names.map((name) => ({ name })),
    deleteDatabase(name) {
      deleted.push(name)
      const request = {
        onsuccess: null,
        onerror: null,
        onblocked: null,
      } as unknown as IDBOpenDBRequest
      queueMicrotask(() => {
        if (mode === 'blocked') {
          request.onblocked?.(new Event('blocked') as IDBVersionChangeEvent)
        } else if (mode === 'error') {
          request.onerror?.(new Event('error'))
        } else {
          request.onsuccess?.(new Event('success'))
        }
      })
      return request
    },
  }
  return { factory, deleted }
}

function fakeCaches(names: string[]) {
  const entries = new Set(names)
  return {
    entries,
    cacheStorage: {
      keys: async () => [...entries],
      delete: vi.fn(async (name: string) => entries.delete(name)),
    },
  }
}

describe('CubeLab ownership checks', () => {
  it('recognizes only CubeLab-prefixed storage and databases', () => {
    expect(isCubeLabStorageKey('cubelab:sessions:v1')).toBe(true)
    expect(isCubeLabStorageKey('cubelab-active-tab')).toBe(false)
    expect(isCubeLabStorageKey('other:cubelab:sessions')).toBe(false)

    expect(isCubeLabDatabaseName('cubelab-solves')).toBe(true)
    expect(isCubeLabDatabaseName('cubelab_training')).toBe(true)
    expect(isCubeLabDatabaseName('mycubelab')).toBe(false)
    expect(isCubeLabDatabaseName('other')).toBe(false)
  })

  it('matches CubeLab and scoped Workbox caches without touching unrelated caches', () => {
    const scope = 'https://example.test/'
    expect(isCubeLabCacheName('cubelab-precache-v2', scope)).toBe(true)
    expect(
      isCubeLabCacheName('workbox-precache-v2-https://example.test/', scope),
    ).toBe(true)
    expect(
      isCubeLabCacheName('workbox-runtime-https://example.test/', scope),
    ).toBe(true)
    expect(
      isCubeLabCacheName('workbox-precache-v2-https://other.test/', scope),
    ).toBe(false)
    expect(isCubeLabCacheName('my-app-cache', scope)).toBe(false)
  })

  it('matches only the application service worker URL', () => {
    const scope = 'https://example.test/'
    expect(
      isCubeLabServiceWorkerScript('https://example.test/sw.js', scope),
    ).toBe(true)
    expect(
      isCubeLabServiceWorkerScript('https://example.test/other/sw.js', scope),
    ).toBe(false)
    expect(
      isCubeLabServiceWorkerScript('https://other.test/sw.js', scope),
    ).toBe(false)
  })
})

describe('resetSiteStorage', () => {
  it('clears CubeLab local/session keys, IndexedDB, caches, workers, and cookies', async () => {
    const local = memoryStorage({
      'cubelab:sessions:v1': '{}',
      'cubelab:settings:v1': '{}',
      'other-app:data': 'keep',
    })
    const session = memoryStorage({
      'cubelab:view:v1': 'training',
      'other-app:view': 'keep',
    })
    const { factory, deleted } = fakeIndexedDb(['cubelab-solves', 'other-db'])
    const { cacheStorage, entries } = fakeCaches([
      'cubelab-precache-v2',
      'workbox-precache-v2-https://example.test/',
      'other-cache',
    ])
    const cubeLabWorker = {
      active: { scriptURL: 'https://example.test/sw.js' },
      unregister: vi.fn(async () => true),
    }
    const otherWorker = {
      active: { scriptURL: 'https://other.test/sw.js' },
      unregister: vi.fn(async () => true),
    }
    const documentLike = {
      cookie: 'cubelab-theme=dark; other=1',
    }

    const result = await resetSiteStorage({
      localStorage: local,
      sessionStorage: session,
      indexedDb: factory,
      cacheStorage,
      serviceWorker: {
        getRegistrations: async () => [cubeLabWorker, otherWorker],
      },
      document: documentLike,
      scope: 'https://example.test/',
      databaseBlockedTimeoutMs: 10,
    })

    expect(result.ok).toBe(true)
    expect(result.localStorageKeysRemoved).toEqual([
      'cubelab:settings:v1',
      'cubelab:sessions:v1',
    ])
    expect(result.sessionStorageKeysRemoved).toEqual(['cubelab:view:v1'])
    expect(local.entries.get('other-app:data')).toBe('keep')
    expect(session.entries.get('other-app:view')).toBe('keep')

    expect(deleted).toContain('cubelab-solves')
    expect(deleted).toContain('cubelab')
    expect(deleted).toContain('cubelab-upgrade-archive')
    expect(deleted).not.toContain('other-db')
    expect(result.databasesDeleted).toEqual(
      expect.arrayContaining([
        'cubelab-solves',
        'cubelab',
        'cubelab-upgrade-archive',
      ]),
    )

    expect(entries.has('cubelab-precache-v2')).toBe(false)
    expect(
      entries.has('workbox-precache-v2-https://example.test/'),
    ).toBe(false)
    expect(entries.has('other-cache')).toBe(true)
    expect(cubeLabWorker.unregister).toHaveBeenCalledOnce()
    expect(otherWorker.unregister).not.toHaveBeenCalled()
    expect(result.workersUnregistered).toBe(1)
    expect(documentLike.cookie).toContain('cubelab-theme=; Max-Age=0')
  })

  it('reports a blocked IndexedDB deletion as a partial failure', async () => {
    const { factory } = fakeIndexedDb(['cubelab-training'], 'blocked')
    const result = await resetSiteStorage({
      localStorage: memoryStorage(),
      sessionStorage: memoryStorage(),
      indexedDb: factory,
      cacheStorage: null,
      serviceWorker: null,
      document: null,
      databaseBlockedTimeoutMs: 5,
    })

    expect(result.ok).toBe(false)
    expect(result.databasesBlocked).toContain('cubelab-training')
    expect(result.errors.join(' ')).toContain('still open in another CubeLab tab')
  })

  it('reports storage that cannot be verified as cleared', async () => {
    const stubborn = memoryStorage({ 'cubelab:sessions:v1': '{}' })
    stubborn.removeItem = () => {
      // Simulate a browser storage implementation that silently refuses writes.
    }
    const result = await resetSiteStorage({
      localStorage: stubborn,
      sessionStorage: memoryStorage(),
      indexedDb: null,
      cacheStorage: null,
      serviceWorker: null,
      document: null,
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('could not be removed')
  })

  it('is safe to run twice', async () => {
    const local = memoryStorage({ 'cubelab:sessions:v1': '{}' })
    const first = await resetSiteStorage({
      localStorage: local,
      sessionStorage: memoryStorage(),
      indexedDb: fakeIndexedDb([]).factory,
      cacheStorage: fakeCaches([]).cacheStorage,
      serviceWorker: {
        getRegistrations: async () => [],
      },
      document: null,
      databaseBlockedTimeoutMs: 5,
    })
    const second = await resetSiteStorage({
      localStorage: local,
      sessionStorage: memoryStorage(),
      indexedDb: fakeIndexedDb([]).factory,
      cacheStorage: fakeCaches([]).cacheStorage,
      serviceWorker: {
        getRegistrations: async () => [],
      },
      document: null,
      databaseBlockedTimeoutMs: 5,
    })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(local.entries.size).toBe(0)
  })
})

describe('reset write gate', () => {
  it('blocks session, settings, and sync writes until the page reloads', () => {
    const storage = memoryStorage()
    expect(saveSessions(sessionData(), storage)).toBe(true)
    expect(saveSettings(DEFAULT_SETTINGS, storage)).toBe(true)
    expect(saveSyncStorage(createDefaultSyncStorage(), storage)).toBe(true)
    const before = new Map(storage.entries)

    beginSiteResetGate()

    expect(saveSessions(sessionData(), storage)).toBe(false)
    expect(saveSettings(DEFAULT_SETTINGS, storage)).toBe(false)
    expect(saveSyncStorage(createDefaultSyncStorage(), storage)).toBe(false)
    expect(storage.entries).toEqual(before)
  })

  it('does not recreate a sync identity from an empty read during reset', () => {
    const storage = memoryStorage()
    beginSiteResetGate()

    const data = loadSyncStorage(storage)

    expect(data.runtime.deviceId).toBeTruthy()
    expect(storage.entries.size).toBe(0)
  })
})

describe('IndexedDB deletion', () => {
  it('turns a permanently blocked request into an explicit status', async () => {
    const { factory } = fakeIndexedDb(['cubelab'], 'blocked')
    await expect(
      deleteIndexedDbDatabase(factory, 'cubelab', 5),
    ).resolves.toBe('blocked')
  })
})

describe('cross-tab reset signalling', () => {
  function channelPair() {
    const posted: unknown[] = []
    const channel: SiteResetChannelLike = {
      onmessage: null,
      postMessage: vi.fn((message) => posted.push(message)),
    }
    return { channel, posted }
  }

  it('writes a begin marker and removes it on completion', () => {
    const storage = memoryStorage()
    const { channel, posted } = channelPair()
    const signal = {
      type: 'cubelab-site-reset' as const,
      phase: 'begin' as const,
      runId: 'run-1',
      at: 10,
    }

    publishSiteResetSignal(signal, {
      channelFactory: () => channel,
      storage,
    })
    expect(posted).toEqual([signal])
    expect(
      JSON.parse(
        storage.getItem('cubelab:site-reset-signal:v1') ?? '{}',
      ),
    ).toEqual(signal)

    publishSiteResetSignal(
      { ...signal, phase: 'complete', at: 11 },
      { channelFactory: () => channel, storage },
    )
    expect(storage.getItem('cubelab:site-reset-signal:v1')).toBeNull()
  })

  it('delivers valid channel and storage signals and ignores malformed ones', () => {
    const { channel } = channelPair()
    const handler = vi.fn()
    const listeners = new Set<EventListener>()
    const target = {
      addEventListener: (_type: string, listener: EventListener) => {
        listeners.add(listener)
      },
      removeEventListener: (_type: string, listener: EventListener) => {
        listeners.delete(listener)
      },
    }
    const unsubscribe = subscribeToSiteReset(handler, {
      channelFactory: () => channel,
      target,
    })
    const signal = {
      type: 'cubelab-site-reset',
      phase: 'begin',
      runId: 'run-2',
      at: 12,
    }

    channel.onmessage?.({ data: signal })
    expect(handler).toHaveBeenCalledWith(signal)

    for (const listener of listeners) {
      listener({
        key: 'cubelab:site-reset-signal:v1',
        newValue: JSON.stringify(signal),
      } as unknown as Event)
      listener({
        key: 'cubelab:site-reset-signal:v1',
        newValue: '{not json',
      } as unknown as Event)
    }
    expect(handler).toHaveBeenCalledTimes(2)
    expect(
      parseSiteResetSignal({
        type: 'cubelab-site-reset',
        phase: 'abandoned',
        runId: 'run-3',
        at: 13,
      }),
    ).not.toBeNull()
    expect(parseSiteResetSignal({ type: 'cubelab-site-reset' })).toBeNull()

    unsubscribe()
    expect(channel.onmessage).toBeNull()
    expect(listeners.size).toBe(0)
  })
})

describe('sync shutdown wait', () => {
  it('resolves as soon as the current synchronization run ends', async () => {
    let calls = 0
    const stopped = await waitForSyncIdle(() => {
      calls += 1
      return calls < 3
    }, 100, 1)
    expect(stopped).toBe(true)
  })

  it('times out instead of waiting forever', async () => {
    const stopped = await waitForSyncIdle(() => true, 10, 1)
    expect(stopped).toBe(false)
  })
})
