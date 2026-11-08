import { describe, expect, it } from 'vitest'
import type { SessionsData } from '../types'
import { DEFAULT_SETTINGS } from './storage'
import {
  createDefaultSyncStorage,
  type SyncStorageData,
} from './syncStorage'
import {
  createAdditiveImportSyncStorage,
  createResetBaseSyncStorage,
} from './syncBase'

function sessions(): SessionsData {
  return {
    activeSessionId: 'session-1',
    sessions: [
      {
        id: 'session-1',
        name: 'Main',
        event: '333',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        solves: [
          {
            id: 'solve-1',
            event: '333',
            rawMs: 12_000,
            penalty: 'none',
            scramble: "R U R' U'",
            comment: '',
            createdAt: 1_700_000_000_000,
          },
        ],
      },
    ],
  }
}

function current(): SyncStorageData {
  const data = createDefaultSyncStorage('device-test')
  return {
    ...data,
    runtime: {
      ...data.runtime,
      lastSyncStatus: 'conflict',
      lastSyncedFingerprint: 'old',
      blockedOutputFingerprint: 'oversized',
      tombstones: [
        {
          kind: 'solve',
          id: 'deleted',
          deletedAt: 1,
          deletedByDeviceId: 'device-test',
        },
      ],
      sessionRedirects: [
        {
          fromId: 'a',
          toId: 'b',
          approvedAt: 2,
          byDeviceId: 'device-test',
        },
      ],
    },
  }
}

describe('sync replacement bases', () => {
  it('builds a detached native-import base that clears replacement review state', () => {
    const before = current()
    before.preferences = { ...before.preferences, enabled: true }
    const next = createResetBaseSyncStorage(before, sessions(), 1_800_000_000_000)
    expect(next.runtime.tombstones).toEqual([])
    expect(next.runtime.sessionRedirects).toEqual([])
    expect(next.runtime.lastSyncedFingerprint).toBeNull()
    expect(next.runtime.blockedOutputFingerprint).toBeNull()
    expect(next.runtime.solveCountAtLastSync).toBe(1)
    expect(next.runtime.settingsFieldUpdates.analytics).toEqual({
      updatedAt: 1_800_000_000_000,
      editorId: 'device-test',
    })
    expect(next.runtime.lastSyncStatus).toBe('pending')
  })

  it('preserves additive-import deletion and review metadata', () => {
    const before = current()
    const next = createAdditiveImportSyncStorage(before, sessions())
    expect(next.runtime.tombstones).toEqual(before.runtime.tombstones)
    expect(next.runtime.sessionRedirects).toEqual(before.runtime.sessionRedirects)
    expect(next.runtime.lastSyncedFingerprint).toBeNull()
    expect(next.runtime.solveCountAtLastSync).toBe(1)
    expect(next.runtime.lastSyncStatus).toBe('conflict')
    expect(next.runtime.blockedOutputFingerprint).toBeNull()
    expect(next.preferences).toEqual(before.preferences)
    expect(DEFAULT_SETTINGS.theme).toBeDefined()
  })
})
