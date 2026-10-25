import { useCallback, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Session, SessionsData, Settings, Solve } from '../types'
import type { DriveFile, DriveTransport } from '../lib/driveTransport'
import { createMemoryDriveTransport } from '../lib/driveTransport'
import { DEFAULT_SETTINGS } from '../lib/storage'
import { DEFAULT_SESSION_NAME } from '../lib/sessions'
import {
  createDefaultSyncStorage,
  loadSyncStorage,
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

function renderStatefulSync(options: {
  transport: DriveTransport
  sessions: SessionsData
  settings: Settings
  onDuplicateSessionDetected?: (names: string[], summary?: string) => void
}) {
  const onReplaceSessions = vi.fn()
  const onReplaceSettings = vi.fn()
  const onNotify = vi.fn()
  const onDuplicateSessionDetected =
    options.onDuplicateSessionDetected ?? vi.fn()
  const rendered = renderHook(() => {
    const [sessionsState, setSessionsState] = useState(options.sessions)
    const [settingsState, setSettingsState] = useState(options.settings)
    const replaceSessions = useCallback((next: SessionsData) => {
      onReplaceSessions(next)
      setSessionsState(next)
    }, [])
    const replaceSettings = useCallback((next: Settings) => {
      onReplaceSettings(next)
      setSettingsState(next)
    }, [])
    return useSync({
      transport: options.transport,
      sessions: sessionsState,
      settings: settingsState,
      storageOk: true,
      timerActive: false,
      onReplaceSessions: replaceSessions,
      onReplaceSettings: replaceSettings,
      onNotify,
      onDuplicateSessionDetected,
    })
  })
  return {
    ...rendered,
    onReplaceSessions,
    onReplaceSettings,
    onNotify,
    onDuplicateSessionDetected,
  }
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

describe('useSync scheduling and retries', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defers synchronization while the timer is active and resumes when idle', async () => {
    enableSync()
    const memory = createMemoryDriveTransport()
    await memory.connect()
    let syncUploads = 0
    const transport: DriveTransport = {
      ...memory,
      uploadDeviceBackup: async (content, deviceId, existingFileId) => {
        syncUploads += 1
        return memory.uploadDeviceBackup!(content, deviceId, existingFileId)
      },
    }
    const { result, rerender } = renderHook(
      ({ timerActive }: { timerActive: boolean }) =>
        useSync({
          transport,
          sessions: sessionsData(),
          settings: DEFAULT_SETTINGS,
          storageOk: true,
          timerActive,
          onReplaceSessions: vi.fn(),
          onReplaceSettings: vi.fn(),
          onNotify: vi.fn(),
        }),
      { initialProps: { timerActive: true } },
    )

    await act(async () => {
      await result.current.syncNow('manual')
    })
    expect(result.current.phase).toBe('pending')
    expect(result.current.error).toContain('timer is idle')
    expect(syncUploads).toBe(0)

    await act(async () => {
      rerender({ timerActive: false })
    })
    await vi.waitFor(() => expect(syncUploads).toBe(1))
    await vi.waitFor(() => expect(result.current.phase).toBe('synced'))
  })

  it('stops automatic retries after the bounded budget', async () => {
    vi.useFakeTimers()
    try {
      enableSync()
      const memory = createMemoryDriveTransport()
      await memory.connect()
      let attempts = 0
      const transport: DriveTransport = {
        ...memory,
        listBackups: async () => {
          attempts += 1
          throw new Error('Network down.')
        },
      }
      const { result } = renderHook(() =>
        useSync({
          transport,
          sessions: sessionsData(),
          settings: DEFAULT_SETTINGS,
          storageOk: true,
          timerActive: false,
          onReplaceSessions: vi.fn(),
          onReplaceSettings: vi.fn(),
          onNotify: vi.fn(),
        }),
      )

      await act(async () => {
        await result.current.syncNow('manual')
      })
      expect(result.current.phase).toBe('failed')
      expect(attempts).toBe(1)

      for (const delay of [2_000, 4_000, 8_000, 16_000, 30_000]) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(delay)
        })
      }

      expect(attempts).toBe(6)
      expect(result.current.phase).toBe('failed')
      expect(result.current.error).toContain('Automatic retries paused')
    } finally {
      vi.useRealTimers()
    }
  })

  it('publishes a final snapshot when the page is hidden', async () => {
    enableSync({ syncOnExit: true })
    const memory = createMemoryDriveTransport()
    await memory.connect()
    let uploads = 0
    const transport: DriveTransport = {
      ...memory,
      uploadDeviceBackup: async (content, deviceId, existingFileId) => {
        uploads += 1
        return memory.uploadDeviceBackup!(content, deviceId, existingFileId)
      },
    }
    const { result } = renderStatefulSync({
      transport,
      sessions: sessionsData(),
      settings: DEFAULT_SETTINGS,
    })

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })

    await vi.waitFor(() => expect(uploads).toBe(1))
    await vi.waitFor(() => expect(result.current.phase).toBe('synced'))
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

    const { result } = renderHook(() => {
      const [sessionsState, setSessionsState] = useState(localSessions)
      const [settingsState, setSettingsState] = useState(DEFAULT_SETTINGS)
      const replaceSessions = useCallback((next: SessionsData) => {
        onReplaceSessions(next)
        setSessionsState(next)
      }, [])
      const replaceSettings = useCallback((next: typeof DEFAULT_SETTINGS) => {
        setSettingsState(next)
      }, [])
      return useSync({
        transport,
        sessions: sessionsState,
        settings: settingsState,
        storageOk: true,
        timerActive: false,
        onReplaceSessions: replaceSessions,
        onReplaceSettings: replaceSettings,
        onNotify,
      })
    })

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

  it('re-raises review when local data changes before approval', async () => {
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
                penalty: { updatedAt: 200, editorId: 'remote-device' },
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

    const initialSessions = sessionsData({
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
    const editedSessions = sessionsData({
      sessions: [
        session({
          solves: [
            solve({
              penalty: 'dnf',
              fieldUpdates: { penalty: { updatedAt: 400, editorId: 'local-device' } },
            }),
          ],
        }),
      ],
    })

    const { result, rerender } = renderHook(
      ({ sessions }: { sessions: SessionsData }) =>
        useSync({
          transport,
          sessions,
          settings: DEFAULT_SETTINGS,
          storageOk: true,
          timerActive: false,
          onReplaceSessions: vi.fn(),
          onReplaceSettings: vi.fn(),
          onNotify: vi.fn(),
        }),
      { initialProps: { sessions: initialSessions } },
    )

    await act(async () => {
      await result.current.syncNow('manual')
    })
    expect(result.current.pendingConflicts).toHaveLength(1)

    // The user edits the local penalty after the conflict was displayed but
    // before choosing a side.
    await act(async () => {
      rerender({ sessions: editedSessions })
    })
    await act(async () => {
      result.current.resolveConflict('solve-1', 'penalty', 'local')
      await result.current.syncNow('manual')
    })

    await vi.waitFor(() => {
      expect(result.current.phase).toBe('conflict')
      expect(result.current.pendingConflicts[0]).toMatchObject({
        resolution: 'manual-pending',
        localValue: 'dnf',
        remoteValue: '+2',
        localUpdatedAt: 400,
      })
    })

    const remoteFile = await transport.findBackup()
    const stillCloud = await transport.downloadBackup(remoteFile!.id)
    expect(stillCloud).toContain('"penalty":"+2"')
    expect(stillCloud).not.toContain('"penalty":"dnf"')
  })
})

describe('useSync field-level conflict resolution', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('applies a reviewed cloud value for an independent settings field', async () => {
    enableSync({ manualConflictReview: true })
    const localSync = loadSyncStorage()
    saveSyncStorage({
      ...localSync,
      runtime: {
        ...localSync.runtime,
        settingsFieldUpdates: {
          accentColor: { updatedAt: 100, editorId: 'device-test' },
        },
      },
    })

    const transport = createMemoryDriveTransport()
    await transport.connect()
    const remoteSettings: Settings = { ...DEFAULT_SETTINGS, accentColor: 'blue' }
    const remoteUpdatedAt = Date.now() + 60_000
    await transport.uploadBackup(
      JSON.stringify(
        createBackup(
          sessionsData(),
          remoteSettings,
          new Date(),
          createSyncEnvelope(
            'remote-device',
            1,
            [],
            [],
            [],
            {
              accentColor: {
                updatedAt: remoteUpdatedAt,
                editorId: 'remote-device',
              },
            },
          ),
        ),
      ),
      null,
    )

    const { result, onReplaceSettings } = renderStatefulSync({
      transport,
      sessions: sessionsData(),
      settings: { ...DEFAULT_SETTINGS, accentColor: 'green' },
    })

    await act(async () => {
      await result.current.syncNow('manual')
    })
    expect(result.current.phase).toBe('conflict')
    expect(result.current.pendingConflicts).toHaveLength(1)
    expect(result.current.pendingConflicts[0]).toMatchObject({
      id: 'settings',
      kind: 'settings',
      field: 'accentColor',
      localValue: 'green',
      remoteValue: 'blue',
    })

    await act(async () => {
      result.current.resolveConflict('settings', 'accentColor', 'remote', 'settings')
      await result.current.syncNow('manual')
    })

    await vi.waitFor(() => expect(result.current.phase).toBe('synced'))
    expect(result.current.pendingConflicts).toHaveLength(0)
    expect(onReplaceSettings.mock.calls.at(-1)?.[0]).toMatchObject({
      accentColor: 'blue',
    })
  })

  it('applies a reviewed cloud value for a session name', async () => {
    enableSync({ manualConflictReview: true })
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const remoteUpdatedAt = Date.now() + 60_000
    const remoteSessions = sessionsData({
      sessions: [
        session({
          name: 'Cloud Session',
          fieldUpdates: {
            name: {
              updatedAt: remoteUpdatedAt,
              editorId: 'remote-device',
            },
          },
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
          name: 'Local Session',
          fieldUpdates: {
            name: { updatedAt: 100, editorId: 'device-test' },
          },
        }),
      ],
    })
    const { result, onReplaceSessions } = renderStatefulSync({
      transport,
      sessions: localSessions,
      settings: DEFAULT_SETTINGS,
    })

    await act(async () => {
      await result.current.syncNow('manual')
    })
    expect(result.current.phase).toBe('conflict')
    expect(result.current.pendingConflicts).toHaveLength(1)
    expect(result.current.pendingConflicts[0]).toMatchObject({
      id: 'session-1',
      kind: 'session',
      field: 'name',
      localValue: 'Local Session',
      remoteValue: 'Cloud Session',
    })

    await act(async () => {
      result.current.resolveConflict('session-1', 'name', 'remote', 'session')
      await result.current.syncNow('manual')
    })

    await vi.waitFor(() => expect(result.current.phase).toBe('synced'))
    expect(result.current.pendingConflicts).toHaveLength(0)
    expect(
      (onReplaceSessions.mock.calls.at(-1)?.[0] as SessionsData | undefined)?.sessions[0]
        ?.name,
    ).toBe('Cloud Session')
  })

  it('skips a redundant upload when both local and remote state are unchanged', async () => {
    enableSync()
    const memory = createMemoryDriveTransport()
    await memory.connect()
    let uploads = 0
    const transport: DriveTransport = {
      ...memory,
      uploadDeviceBackup: async (content, deviceId, existingFileId) => {
        uploads += 1
        return memory.uploadDeviceBackup!(content, deviceId, existingFileId)
      },
    }
    const { result } = renderStatefulSync({
      transport,
      sessions: sessionsData(),
      settings: DEFAULT_SETTINGS,
    })

    await act(async () => {
      await result.current.syncNow('manual')
    })
    expect(result.current.phase).toBe('synced')
    expect(uploads).toBe(1)

    await act(async () => {
      await result.current.syncNow('manual')
    })
    expect(result.current.phase).toBe('synced')
    expect(result.current.hasPendingChanges).toBe(false)
    expect(uploads).toBe(1)
  })
})

describe('useSync deletion tombstones', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('records the deleted session solve snapshot for clock-skew-safe recovery', async () => {
    enableSync()
    const transport = createMemoryDriveTransport()
    const initial = sessionsData({
      sessions: [
        session({
          solves: [
            solve({ id: 'known-a' }),
            solve({ id: 'known-b' }),
          ],
        }),
      ],
    })
    const { rerender } = renderHook(
      ({ sessions }: { sessions: SessionsData }) =>
        useSync({
          transport,
          sessions,
          settings: DEFAULT_SETTINGS,
          storageOk: true,
          timerActive: false,
          onReplaceSessions: vi.fn(),
          onReplaceSettings: vi.fn(),
          onNotify: vi.fn(),
        }),
      { initialProps: { sessions: initial } },
    )

    await act(async () => {
      rerender({ sessions: sessionsData({ sessions: [] }) })
    })

    await vi.waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(SYNC_STORAGE_KEY) ?? '{}') as {
        runtime?: {
          tombstones?: Array<{
            kind: string
            id: string
            knownSolveIds?: string[]
          }>
        }
      }
      const sessionTombstone = stored.runtime?.tombstones?.find(
        (tombstone) => tombstone.kind === 'session' && tombstone.id === 'session-1',
      )
      expect(sessionTombstone?.knownSolveIds?.sort()).toEqual([
        'known-a',
        'known-b',
      ])
    })
  })
})

describe('useSync duplicate session notifications', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  async function seedDuplicateSnapshots() {
    const memory = createMemoryDriveTransport()
    await memory.connect()
    const first = sessionsData({
      activeSessionId: 'shared-a',
      sessions: [
        session({
          id: 'shared-a',
          name: 'Shared',
          solves: [solve({ id: 'a-1' })],
        }),
      ],
    })
    const second = sessionsData({
      activeSessionId: 'shared-b',
      sessions: [
        session({
          id: 'shared-b',
          name: 'shared',
          solves: [solve({ id: 'b-1' })],
        }),
      ],
    })
    await memory.uploadDeviceBackup!(
      JSON.stringify(
        createBackup(
          first,
          DEFAULT_SETTINGS,
          new Date('2026-01-01T00:00:00.000Z'),
          { ...createSyncEnvelope('device-a', 1, [], []), updatedAt: 100 },
        ),
      ),
      'device-a',
    )
    await memory.uploadDeviceBackup!(
      JSON.stringify(
        createBackup(
          second,
          DEFAULT_SETTINGS,
          new Date('2026-01-02T00:00:00.000Z'),
          { ...createSyncEnvelope('device-b', 1, [], []), updatedAt: 200 },
        ),
      ),
      'device-b',
    )
    return memory
  }

  it('reports a duplicate found across separate snapshots once with one actionable summary', async () => {
    enableSync()
    const transport = await seedDuplicateSnapshots()
    const onDuplicateSessionDetected = vi.fn()
    const { result, onNotify } = renderStatefulSync({
      transport,
      sessions: sessionsData(),
      settings: DEFAULT_SETTINGS,
      onDuplicateSessionDetected,
    })

    await act(async () => {
      await result.current.syncNow('manual')
    })

    expect(result.current.phase).toBe('synced')
    expect(result.current.duplicateNames).toEqual(['Shared'])
    expect(onDuplicateSessionDetected).toHaveBeenCalledTimes(1)
    const [names, summary] = onDuplicateSessionDetected.mock.calls[0]!
    expect(names).toEqual(['Shared'])
    expect(summary).toContain("separate sessions named 'Shared'")
    expect(summary).toContain('Cloud sessions imported')
    expect(summary).toContain('cloud solves merged')
    // The actionable callback carries the status summary; a second plain toast
    // must not replace the Review Merge action.
    expect(onNotify).not.toHaveBeenCalled()
  })

  it('does not repeat the duplicate notification on later syncs', async () => {
    enableSync()
    const transport = await seedDuplicateSnapshots()
    const onDuplicateSessionDetected = vi.fn()
    const { result, onNotify } = renderStatefulSync({
      transport,
      sessions: sessionsData(),
      settings: DEFAULT_SETTINGS,
      onDuplicateSessionDetected,
    })

    await act(async () => {
      await result.current.syncNow('manual')
    })
    await act(async () => {
      await result.current.syncNow('manual')
    })

    expect(result.current.phase).toBe('synced')
    expect(result.current.duplicateNames).toEqual(['Shared'])
    expect(onDuplicateSessionDetected).toHaveBeenCalledTimes(1)
    expect(onNotify).toHaveBeenCalledWith(
      'Synchronization complete. No new solves were exchanged.',
    )
  })
})

describe('useSync imported solve summaries', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('names the session that received cloud solves', async () => {
    enableSync()
    const memory = createMemoryDriveTransport()
    await memory.connect()
    const remote = sessionsData({
      activeSessionId: 'remote-session',
      sessions: [
        session({
          id: 'remote-session',
          name: 'Cloud',
          solves: [solve({ id: 'cloud-1' })],
        }),
      ],
    })
    await memory.uploadDeviceBackup!(
      JSON.stringify(
        createBackup(
          remote,
          DEFAULT_SETTINGS,
          new Date(),
          createSyncEnvelope('device-a', 1, [], []),
        ),
      ),
      'device-a',
    )
    const local = sessionsData({
      sessions: [
        session({
          id: 'local-session',
          name: 'Local',
          solves: [solve({ id: 'local-1' })],
        }),
      ],
      activeSessionId: 'local-session',
    })
    const { result, onNotify } = renderStatefulSync({
      transport: memory,
      sessions: local,
      settings: DEFAULT_SETTINGS,
    })

    await act(async () => {
      await result.current.syncNow('manual')
    })

    expect(onNotify).toHaveBeenCalledTimes(1)
    const message = String(onNotify.mock.calls[0]?.[0] ?? '')
    expect(message).toContain("1 cloud solve merged into 'Cloud'")
    expect(message).toContain('1 new local solve uploaded')
  })
})

describe('useSync same-device write safety', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('aborts an upload when its own snapshot changed after discovery', async () => {
    enableSync()
    const memory = createMemoryDriveTransport()
    await memory.connect()
    const local = sessionsData({
      sessions: [
        session({
          id: 'session-test',
          solves: [solve({ id: 'local-1' })],
        }),
      ],
      activeSessionId: 'session-test',
    })
    await memory.uploadDeviceBackup!(
      JSON.stringify(
        createBackup(
          local,
          DEFAULT_SETTINGS,
          new Date('2026-01-01T00:00:00.000Z'),
          { ...createSyncEnvelope('device-test', 1, [], []), updatedAt: 100 },
        ),
      ),
      'device-test',
    )

    const foreign = sessionsData({
      sessions: [
        session({
          id: 'session-test',
          solves: [solve({ id: 'foreign-1' })],
        }),
      ],
      activeSessionId: 'session-test',
    })
    let listCalls = 0
    let uploads = 0
    const transport: DriveTransport = {
      ...memory,
      listBackups: async () => {
        const files = await memory.listBackups!()
        listCalls += 1
        if (listCalls === 1) {
          // Simulate a copied profile sharing this device ID writing between
          // discovery and the locked pre-write recheck.
          await memory.uploadDeviceBackup!(
            JSON.stringify(
              createBackup(
                foreign,
                DEFAULT_SETTINGS,
                new Date('2026-01-02T00:00:00.000Z'),
                { ...createSyncEnvelope('device-test', 2, [], []), updatedAt: 200 },
              ),
            ),
            'device-test',
          )
        }
        return files
      },
      uploadDeviceBackup: async (content, deviceId, existingFileId) => {
        uploads += 1
        return memory.uploadDeviceBackup!(content, deviceId, existingFileId)
      },
    }
    const { result, unmount } = renderStatefulSync({
      transport,
      sessions: local,
      settings: DEFAULT_SETTINGS,
    })

    await act(async () => {
      await result.current.syncNow('manual')
    })

    expect(uploads).toBe(0)
    expect(result.current.phase).toBe('pending')
    expect(result.current.error).toContain(
      "changed this device's cloud snapshot",
    )
    unmount()
  })

  it('preserves the device ID and preferences when resetting the sync base', async () => {
    enableSync({ solveThreshold: 3 })
    const transport = createMemoryDriveTransport()
    const before = loadSyncStorage()
    const { result } = renderStatefulSync({
      transport,
      sessions: sessionsData(),
      settings: DEFAULT_SETTINGS,
    })

    await act(async () => {
      result.current.resetBase(
        sessionsData({
          sessions: [session({ id: 'imported', name: 'Imported' })],
          activeSessionId: 'imported',
        }),
      )
    })

    const after = loadSyncStorage()
    expect(after.runtime.deviceId).toBe(before.runtime.deviceId)
    expect(after.preferences.solveThreshold).toBe(3)
    expect(after.runtime.tombstones).toEqual([])
    expect(after.runtime.lastSyncedFingerprint).toBeNull()
  })
})
