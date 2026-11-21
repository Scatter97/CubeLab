import { beforeEach, describe, expect, it } from 'vitest'
import type { StorageLike } from './storage'
import {
  TRAINING_SYNC_STORAGE_KEY,
  clearTrainingSyncProvenance,
  createDefaultTrainingSyncStorage,
  loadTrainingSyncStorage,
  parseTrainingSyncStorage,
  resetTrainingDeviceIdCacheForTests,
  saveTrainingSyncStorage,
  trainingSyncStorageWarning,
} from './trainingSyncStorage'
import { SYNC_STORAGE_KEY } from './syncStorage'
import { closedTrainingHistory } from './training/persistenceFixtures.test-support'

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  failSet = false

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error('set failed')
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

describe('Training sync storage', () => {
  beforeEach(() => {
    localStorage.clear()
    resetTrainingDeviceIdCacheForTests()
  })

  it('uses a separate key and never reads or writes solve sync state', () => {
    const storage = new MemoryStorage()
    storage.setItem(SYNC_STORAGE_KEY, '{"solve":"state"}')
    const loaded = loadTrainingSyncStorage(storage)
    expect(loaded.preferences.enabled).toBe(false)
    expect(storage.getItem(TRAINING_SYNC_STORAGE_KEY)).not.toBeNull()
    expect(storage.getItem(SYNC_STORAGE_KEY)).toBe('{"solve":"state"}')
    expect(
      saveTrainingSyncStorage(
        {
          ...loaded,
          preferences: { ...loaded.preferences, enabled: true },
        },
        storage,
      ),
    ).toBe(true)
    expect(storage.getItem(SYNC_STORAGE_KEY)).toBe('{"solve":"state"}')
    expect(
      parseTrainingSyncStorage(
        JSON.parse(storage.getItem(TRAINING_SYNC_STORAGE_KEY)!),
      )?.preferences.enabled,
    ).toBe(true)
  })

  it('round trips tombstones, revocations, updates and conflicts', () => {
    const storage = new MemoryStorage()
    const data = createDefaultTrainingSyncStorage('training-device')
    const next = {
      ...data,
      runtime: {
        ...data.runtime,
        tombstones: [
          {
            kind: 'attempt' as const,
            id: 'attempt-1',
            visitId: 'visit-1',
            deletedAt: 100,
            deletedByDeviceId: 'training-device',
          },
          {
            kind: 'visit' as const,
            id: 'visit-1',
            attemptIds: ['attempt-1'],
            deletedAt: 90,
            deletedByDeviceId: 'training-device',
            restoredAt: 110,
          },
        ],
        fieldUpdates: {
          preferences: { updatedAt: 120, editorId: 'training-device' },
        },
        conflicts: [
          {
            id: 'attempt-1',
            kind: 'attempt' as const,
            field: 'correction',
            localValue: { result: 'dnf' },
            remoteValue: { result: 'none' },
            localUpdatedAt: 1,
            remoteUpdatedAt: 2,
            updatedAt: 3,
            resolution: 'remote' as const,
          },
        ],
      },
    }
    expect(saveTrainingSyncStorage(next, storage)).toBe(true)
    const loaded = loadTrainingSyncStorage(storage)
    expect(loaded.runtime.tombstones).toEqual(next.runtime.tombstones)
    expect(loaded.runtime.fieldUpdates).toEqual(next.runtime.fieldUpdates)
    expect(loaded.runtime.conflicts).toEqual(next.runtime.conflicts)
  })

  it('keeps local Training history when the sync record is malformed', () => {
    const storage = new MemoryStorage()
    storage.setItem(TRAINING_SYNC_STORAGE_KEY, '{broken')
    storage.setItem('cubelab:training:v1', JSON.stringify(closedTrainingHistory()))
    const loaded = loadTrainingSyncStorage(storage)
    expect(loaded.runtime.lastError).toMatch(/unreadable/)
    expect(storage.getItem('cubelab:training:v1')).not.toBeNull()
    expect(trainingSyncStorageWarning(storage)).toMatch(/unreadable/)
    expect(
      saveTrainingSyncStorage(
        createDefaultTrainingSyncStorage('device'),
        storage,
      ),
    ).toBe(false)
    expect(storage.getItem(TRAINING_SYNC_STORAGE_KEY)).toBe('{broken')
  })

  it('treats a partially invalid tombstone or conflict list as unreadable', () => {
    const storage = new MemoryStorage()
    const base = createDefaultTrainingSyncStorage('training-device')
    const invalidTombstone = {
      ...base,
      runtime: {
        ...base.runtime,
        tombstones: [
          {
            kind: 'attempt',
            id: 'valid',
            deletedAt: 1,
            deletedByDeviceId: 'device',
          },
          { kind: 'attempt', id: '', deletedAt: 1, deletedByDeviceId: 'device' },
        ],
      },
    }
    storage.setItem(TRAINING_SYNC_STORAGE_KEY, JSON.stringify(invalidTombstone))
    expect(parseTrainingSyncStorage(invalidTombstone)).toBeNull()
    expect(trainingSyncStorageWarning(storage)).toMatch(/unreadable/)
    expect(saveTrainingSyncStorage(base, storage)).toBe(false)
    expect(storage.getItem(TRAINING_SYNC_STORAGE_KEY)).toBe(
      JSON.stringify(invalidTombstone),
    )

    const invalidConflict = {
      ...base,
      runtime: {
        ...base.runtime,
        conflicts: [{ id: 'conflict', kind: 'attempt' }],
      },
    }
    expect(parseTrainingSyncStorage(invalidConflict)).toBeNull()
  })

  it('normalizes a stale syncing status after reload', () => {
    const base = createDefaultTrainingSyncStorage('training-device')
    const enabled = {
      ...base,
      preferences: { ...base.preferences, enabled: true },
      runtime: { ...base.runtime, lastSyncStatus: 'syncing' as const },
    }
    expect(parseTrainingSyncStorage(enabled)?.runtime.lastSyncStatus).toBe(
      'pending',
    )
    const disabled = {
      ...base,
      runtime: { ...base.runtime, lastSyncStatus: 'syncing' as const },
    }
    expect(parseTrainingSyncStorage(disabled)?.runtime.lastSyncStatus).toBe(
      'disabled',
    )
  })

  it('clears provenance without changing identity or preferences', () => {
    const base = createDefaultTrainingSyncStorage('training-device')
    const cleared = clearTrainingSyncProvenance({
      ...base,
      preferences: { ...base.preferences, enabled: true },
      runtime: {
        ...base.runtime,
        lastSyncStatus: 'synced',
        lastRemoteRevision: 4,
        lastSyncedFingerprint: 'fingerprint',
        tombstones: [
          {
            kind: 'attempt',
            id: 'deleted',
            deletedAt: 1,
            deletedByDeviceId: 'training-device',
          },
        ],
        fieldUpdates: {
          preferences: { updatedAt: 1, editorId: 'training-device' },
        },
        conflicts: [],
      },
    })
    expect(cleared.runtime.deviceId).toBe('training-device')
    expect(cleared.preferences.enabled).toBe(true)
    expect(cleared.runtime.tombstones).toEqual([])
    expect(cleared.runtime.fieldUpdates).toEqual({})
    expect(cleared.runtime.lastRemoteRevision).toBeNull()
    expect(cleared.runtime.lastSyncedFingerprint).toBeNull()
    expect(cleared.runtime.lastSyncStatus).toBe('pending')
  })

  it('reports a failed ledger write instead of claiming deletion provenance', () => {
    const storage = new MemoryStorage()
    storage.failSet = true
    expect(
      saveTrainingSyncStorage(createDefaultTrainingSyncStorage('device'), storage),
    ).toBe(false)
  })
})
