import { beforeEach, describe, expect, it } from 'vitest'
import type { StorageLike } from './storage'
import {
  SESSIONS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from './storage'
import { SYNC_STORAGE_KEY } from './syncStorage'
import {
  beginReplacement,
  loadReplacementJournal,
  markReplacementCommitted,
  REPLACEMENT_STORAGE_KEY,
} from './replacement'
import type { DriveLockManager } from './driveCoordination'
import { recoverReplacementAtStartup } from './startupRecovery'

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  failSet = new Set<string>()
  failRemove = new Set<string>()
  failGet = false

  getItem(key: string): string | null {
    if (this.failGet) throw new Error('read failed')
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failSet.has(key)) throw new Error(`set failed: ${key}`)
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    if (this.failRemove.has(key)) throw new Error(`remove failed: ${key}`)
    this.values.delete(key)
  }
}

function seeded(): MemoryStorage {
  const storage = new MemoryStorage()
  storage.setItem(SESSIONS_STORAGE_KEY, 'old-sessions')
  storage.setItem(SETTINGS_STORAGE_KEY, 'old-settings')
  storage.setItem(SYNC_STORAGE_KEY, 'old-sync')
  return storage
}

const immediateLocks: DriveLockManager = {
  request: (_name, _options, callback) => callback(null),
}

function deferredLocks() {
  let release: (() => void) | null = null
  let requested = false
  const manager: DriveLockManager = {
    request<T>(
      _name: string,
      _options: { mode?: 'exclusive' | 'shared'; ifAvailable?: boolean },
      callback: (lock: unknown) => Promise<T>,
    ): Promise<T> {
      requested = true
      return new Promise<T>((resolve, reject) => {
        release = () => {
          Promise.resolve(callback(null)).then(resolve, reject)
        }
      })
    },
  }
  return {
    manager,
    isRequested: () => requested,
    release: () => release?.(),
  }
}

describe('startup replacement recovery gate', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = seeded()
  })

  it('opens normally when no replacement record exists', async () => {
    await expect(recoverReplacementAtStartup({ storage })).resolves.toEqual({
      status: 'ready',
      recovery: { status: 'none' },
    })
  })

  it('preserves memory-only startup when no storage API exists', async () => {
    await expect(
      recoverReplacementAtStartup({ storage: null }),
    ).resolves.toEqual({
      status: 'ready',
      recovery: { status: 'none' },
    })
  })

  it('rolls a prepared transaction back only while holding the write boundary', async () => {
    const begun = beginReplacement(
      'native-import',
      ['sessions', 'settings', 'sync'],
      storage,
    )
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    storage.setItem(SESSIONS_STORAGE_KEY, 'candidate-sessions')
    storage.setItem(SETTINGS_STORAGE_KEY, 'candidate-settings')
    storage.setItem(SYNC_STORAGE_KEY, 'candidate-sync')
    const locks = deferredLocks()

    const pending = recoverReplacementAtStartup({
      storage,
      lockManager: locks.manager,
    })
    expect(locks.isRequested()).toBe(true)
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('candidate-sessions')
    expect(loadReplacementJournal(storage)).toMatchObject({
      status: 'ok',
      journal: { phase: 'prepared' },
    })

    locks.release()
    await expect(pending).resolves.toEqual({
      status: 'ready',
      recovery: { status: 'rolled-back' },
    })
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('old-sessions')
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe('old-settings')
    expect(storage.getItem(SYNC_STORAGE_KEY)).toBe('old-sync')
    expect(storage.getItem(REPLACEMENT_STORAGE_KEY)).toBeNull()
  })

  it('re-reads the record after waiting and adopts a writer that committed', async () => {
    const begun = beginReplacement('native-import', ['sessions'], storage)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    storage.setItem(SESSIONS_STORAGE_KEY, 'writer-candidate')
    const locks = deferredLocks()

    const pending = recoverReplacementAtStartup({
      storage,
      lockManager: locks.manager,
    })
    expect(loadReplacementJournal(storage)).toMatchObject({
      status: 'ok',
      journal: { phase: 'prepared' },
    })
    expect(markReplacementCommitted(begun.journal, storage)).toBe(true)
    locks.release()

    await expect(pending).resolves.toEqual({
      status: 'ready',
      recovery: { status: 'committed' },
    })
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('writer-candidate')
    expect(storage.getItem(REPLACEMENT_STORAGE_KEY)).toBeNull()
  })

  it('stays blocked and keeps the journal when prepared rollback cannot write', async () => {
    const begun = beginReplacement('native-import', ['sessions'], storage)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    storage.setItem(SESSIONS_STORAGE_KEY, 'staged-candidate')
    storage.failSet.add(SESSIONS_STORAGE_KEY)

    const result = await recoverReplacementAtStartup({
      storage,
      lockManager: immediateLocks,
    })
    expect(result.status).toBe('blocked')
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('staged-candidate')
    expect(loadReplacementJournal(storage)).toMatchObject({
      status: 'ok',
      journal: { phase: 'prepared' },
    })

    storage.failSet.clear()
    await expect(
      recoverReplacementAtStartup({ storage, lockManager: immediateLocks }),
    ).resolves.toEqual({
      status: 'ready',
      recovery: { status: 'rolled-back' },
    })
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('old-sessions')
  })

  it('stays blocked when rollback succeeds but the journal cannot be removed', async () => {
    const begun = beginReplacement('native-import', ['sessions'], storage)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    storage.setItem(SESSIONS_STORAGE_KEY, 'staged-candidate')
    storage.failRemove.add(REPLACEMENT_STORAGE_KEY)

    const result = await recoverReplacementAtStartup({
      storage,
      lockManager: immediateLocks,
    })
    expect(result.status).toBe('blocked')
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('old-sessions')
    expect(storage.getItem(REPLACEMENT_STORAGE_KEY)).not.toBeNull()

    storage.failRemove.clear()
    await expect(
      recoverReplacementAtStartup({ storage, lockManager: immediateLocks }),
    ).resolves.toEqual({
      status: 'ready',
      recovery: { status: 'rolled-back' },
    })
    expect(storage.getItem(REPLACEMENT_STORAGE_KEY)).toBeNull()
  })

  it('opens a committed outcome even when only journal cleanup fails', async () => {
    const begun = beginReplacement('native-import', ['sessions'], storage)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    storage.setItem(SESSIONS_STORAGE_KEY, 'committed-candidate')
    expect(markReplacementCommitted(begun.journal, storage)).toBe(true)
    storage.failRemove.add(REPLACEMENT_STORAGE_KEY)

    const result = await recoverReplacementAtStartup({ storage })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.recovery.status).toBe('cleanup-pending')
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('committed-candidate')
    expect(storage.getItem(REPLACEMENT_STORAGE_KEY)).not.toBeNull()
  })

  it('keeps a prepared record pending when Web Locks are unavailable', async () => {
    const begun = beginReplacement('native-import', ['sessions'], storage)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    storage.setItem(SESSIONS_STORAGE_KEY, 'staged-candidate')

    const result = await recoverReplacementAtStartup({
      storage,
      lockManager: null,
    })
    expect(result.status).toBe('blocked')
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('staged-candidate')
    expect(loadReplacementJournal(storage)).toMatchObject({
      status: 'ok',
      journal: { phase: 'prepared' },
    })
  })

  it('retains a malformed record and never invents an editable collection', async () => {
    storage.setItem(REPLACEMENT_STORAGE_KEY, '{broken')
    const result = await recoverReplacementAtStartup({
      storage,
      lockManager: immediateLocks,
    })
    expect(result.status).toBe('blocked')
    expect(storage.getItem(REPLACEMENT_STORAGE_KEY)).toBe('{broken')
  })

  it('fails safely when the recovery record cannot be read', async () => {
    storage.failGet = true
    const result = await recoverReplacementAtStartup({
      storage,
      lockManager: immediateLocks,
    })
    expect(result.status).toBe('blocked')
  })
})
