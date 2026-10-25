import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Session, SessionsData, Solve } from '../types'
import type { DriveFile, DriveTransport } from '../lib/driveTransport'
import { createMemoryDriveTransport } from '../lib/driveTransport'
import { DEFAULT_SETTINGS } from '../lib/storage'
import { DEFAULT_SESSION_NAME } from '../lib/sessions'
import {
  createDefaultSyncStorage,
  saveSyncStorage,
  SYNC_STORAGE_KEY,
  type SyncPreferences,
} from '../lib/syncStorage'
import { createBackup } from '../lib/backup'
import { createSyncEnvelope } from '../lib/sync'
import { useSync } from './useSync'

function solve(overrides: Partial<Solve> = {}): Solve {
  return {
    id: 'solve-1',
    event: '333',
    rawMs: 12_340,
    penalty: 'none',
    scramble: "R U R' U'",
    comment: '',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: DEFAULT_SESSION_NAME,
    event: '333',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    solves: [],
    ...overrides,
  }
}

function sessionsData(overrides: Partial<SessionsData> = {}): SessionsData {
  return {
    activeSessionId: 'session-1',
    sessions: [session()],
    ...overrides,
  }
}

function createDeferredTransport() {
  const memory = createMemoryDriveTransport()
  const uploads: string[] = []
  let releaseFirstUpload: (() => void) | null = null
  let firstUploadPending = true

  const transport: DriveTransport = {
    configured: true,
    accountLabel: 'Google Drive (mock)',
    connect: () => memory.connect(),
    disconnect: () => memory.disconnect(),
    isConnected: () => memory.isConnected(),
    findBackup: () => memory.findBackup(),
    downloadBackup: (fileId) => memory.downloadBackup(fileId),
    deleteBackup: (fileId) => memory.deleteBackup(fileId),
    uploadBackup: (content, existingFileId): Promise<DriveFile> => {
      uploads.push(content)
      if (firstUploadPending) {
        firstUploadPending = false
        return new Promise<DriveFile>((resolve) => {
          releaseFirstUpload = () =>
            resolve({
              id: 'drive-file-1',
              name: 'cubelab-backup.json',
              modifiedTime: null,
            })
        })
      }
      return memory.uploadBackup(content, existingFileId)
    },
  }

  return {
    transport,
    uploads,
    releaseFirstUpload: () => releaseFirstUpload?.(),
  }
}

function enableSync(preferences: Partial<SyncPreferences> = {}) {
  const sync = createDefaultSyncStorage('device-test')
  saveSyncStorage({
    ...sync,
    preferences: {
      ...sync.preferences,
      enabled: true,
      syncOnStartup: false,
      syncOnExit: false,
      syncOnReconnect: false,
      mode: 'combined',
      ...preferences,
    },
    runtime: { ...sync.runtime, lastSyncStatus: 'pending' },
  })
}

describe('useSync in-flight safety', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps local data intact when a solve is recorded during an upload', async () => {
    enableSync()
    expect(localStorage.getItem(SYNC_STORAGE_KEY)).not.toBeNull()

    const deferred = createDeferredTransport()
    const initial = sessionsData()
    const edited = sessionsData({
      sessions: [session({ solves: [solve({ id: 'recorded-during-upload' })] })],
    })
    const onReplaceSessions = vi.fn()
    const onReplaceSettings = vi.fn()
    const onNotify = vi.fn()

    const { result, rerender } = renderHook(
      ({ sessions }: { sessions: SessionsData }) =>
        useSync({
          transport: deferred.transport,
          sessions,
          settings: DEFAULT_SETTINGS,
          storageOk: true,
          timerActive: false,
          onReplaceSessions,
          onReplaceSettings,
          onNotify,
        }),
      { initialProps: { sessions: initial } },
    )

    let firstSync: Promise<void> | null = null
    await act(async () => {
      firstSync = result.current.syncNow('manual')
      await vi.waitFor(() => expect(deferred.uploads).toHaveLength(1))
    })

    // React commits the new local solve before the upload response arrives.
    await act(async () => {
      rerender({ sessions: edited })
    })

    await act(async () => {
      deferred.releaseFirstUpload()
      await firstSync
    })

    // The first upload was based on the pre-edit snapshot and must not be
    // treated as the new local base.
    expect(deferred.uploads[0]).not.toContain('recorded-during-upload')

    // A follow-up sync publishes the new solve. Every replacement passed to
    // React contains the solve that was recorded during the upload.
    await vi.waitFor(() => expect(deferred.uploads.length).toBeGreaterThanOrEqual(2))
    expect(deferred.uploads.at(-1)).toContain('recorded-during-upload')
    expect(onReplaceSessions).toHaveBeenCalled()
    for (const call of onReplaceSessions.mock.calls) {
      const data = call[0] as SessionsData
      expect(data.sessions.flatMap((item) => item.solves.map((item) => item.id))).toContain(
        'recorded-during-upload',
      )
    }
  })
})

describe('useSync manual conflict resolution', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('pauses on a conflicting solve field and resumes with the chosen side', async () => {
    enableSync({ manualConflictReview: true })
    const transport = createMemoryDriveTransport()
    await transport.connect()

    const remoteSessions = sessionsData({
      sessions: [
        session({
          solves: [
            solve({
              penalty: '+2',
              fieldUpdates: {
                penalty: { updatedAt: Date.now() + 60_000, editorId: 'remote-device' },
              },
            }),
          ],
        }),
      ],
    })
    await transport.uploadBackup(
      JSON.stringify(
        createBackup(
          remoteSessions,
          DEFAULT_SETTINGS,
          new Date(),
          createSyncEnvelope('remote-device', 1, [], []),
        ),
      ),
      null,
    )

    const localSessions = sessionsData({
      sessions: [
        session({
          solves: [
            solve({
              penalty: 'none',
              fieldUpdates: { penalty: { updatedAt: 100, editorId: 'local-device' } },
            }),
          ],
        }),
      ],
    })
    const onReplaceSessions = vi.fn()
    const onNotify = vi.fn()

    const { result } = renderHook(() =>
      useSync({
        transport,
        sessions: localSessions,
        settings: DEFAULT_SETTINGS,
        storageOk: true,
        timerActive: false,
        onReplaceSessions,
        onReplaceSettings: vi.fn(),
        onNotify,
      }),
    )

    await act(async () => {
      await result.current.syncNow('manual')
    })

    expect(result.current.phase).toBe('conflict')
    expect(result.current.pendingConflicts).toHaveLength(1)
    expect(result.current.pendingConflicts[0]).toMatchObject({
      id: 'solve-1',
      field: 'penalty',
      localValue: 'none',
      remoteValue: '+2',
    })
    expect(result.current.newSolvesSinceLastSync).toBe(1)

    await act(async () => {
      result.current.resolveConflict('solve-1', 'penalty', 'local')
      await result.current.syncNow('manual')
    })

    await vi.waitFor(() => expect(result.current.phase).toBe('synced'))
    expect(result.current.pendingConflicts).toHaveLength(0)

    const remoteFile = await transport.findBackup()
    const uploaded = await transport.downloadBackup(remoteFile!.id)
    expect(uploaded).toContain('"penalty":"none"')
    expect(onReplaceSessions).toHaveBeenCalled()
    const replacement = onReplaceSessions.mock.calls.at(-1)?.[0] as SessionsData | undefined
    expect(replacement?.sessions[0]?.solves[0]?.penalty).toBe('none')
  })
})
