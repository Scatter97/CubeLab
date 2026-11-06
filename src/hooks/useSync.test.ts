import { useCallback, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Session, SessionsData, Settings, Solve } from '../types'
import type { DriveFile, DriveTransport } from '../lib/driveTransport'
import { createMemoryDriveTransport } from '../lib/driveTransport'
import { DEFAULT_SETTINGS, saveSessions, saveSettings, SETTINGS_STORAGE_KEY } from '../lib/storage'
import { DEFAULT_SESSION_NAME } from '../lib/sessions'
import {
  createDefaultSyncStorage,
  loadSyncStorage,
  saveSyncStorage,
  SYNC_STORAGE_KEY,
  type ConflictAuditEntry,
  type SyncConflict,
  type SyncPreferences,
} from '../lib/syncStorage'
import { createBackup } from '../lib/backup'
import { createSyncEnvelope } from '../lib/sync'
import * as syncFingerprint from '../lib/syncFingerprint'
import { useSync } from './useSync'
import { useSettings } from './useSettings'

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
      uploadDeviceBackup: async (content, deviceId) => {
        syncUploads += 1
        return memory.uploadDeviceBackup!(content, deviceId)
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
      uploadDeviceBackup: async (content, deviceId) => {
        uploads += 1
        return memory.uploadDeviceBackup!(content, deviceId)
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

  it('collapses duplicate exit events into one upload', async () => {
    enableSync({ syncOnExit: true })
    const memory = createMemoryDriveTransport()
    await memory.connect()
    let uploads = 0
    const transport: DriveTransport = {
      ...memory,
      uploadDeviceBackup: async (content, deviceId) => {
        uploads += 1
        return memory.uploadDeviceBackup!(content, deviceId)
      },
    }
    renderStatefulSync({
      transport,
      sessions: sessionsData(),
      settings: DEFAULT_SETTINGS,
    })

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
      window.dispatchEvent(new Event('pagehide'))
      window.dispatchEvent(new Event('pagehide'))
    })

    await vi.waitFor(() => expect(uploads).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(uploads).toBe(1)
  })

  it('does not rely on beforeunload for the exit sync', async () => {
    enableSync({ syncOnExit: true })
    const memory = createMemoryDriveTransport()
    await memory.connect()
    let uploads = 0
    const transport: DriveTransport = {
      ...memory,
      uploadDeviceBackup: async (content, deviceId) => {
        uploads += 1
        return memory.uploadDeviceBackup!(content, deviceId)
      },
    }
    renderStatefulSync({
      transport,
      sessions: sessionsData(),
      settings: DEFAULT_SETTINGS,
    })

    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'))
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(uploads).toBe(0)
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

  it('records a manual resolution and reverses it from history', async () => {
    enableSync({ manualConflictReview: true })
    const transport = createMemoryDriveTransport()
    await transport.connect()

    await transport.uploadBackup(
      JSON.stringify(
        createBackup(
          sessionsData({
            sessions: [
              session({
                solves: [
                  solve({
                    penalty: '+2',
                    fieldUpdates: {
                      penalty: {
                        updatedAt: Date.now() + 60_000,
                        editorId: 'remote-device',
                      },
                    },
                  }),
                ],
              }),
            ],
          }),
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
              fieldUpdates: {
                penalty: { updatedAt: 100, editorId: 'local-device' },
              },
            }),
          ],
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
    expect(result.current.pendingConflicts).toHaveLength(1)

    await act(async () => {
      result.current.resolveConflict('solve-1', 'penalty', 'local')
      await result.current.syncNow('manual')
    })
    await vi.waitFor(() => expect(result.current.phase).toBe('synced'))

    expect(result.current.conflictAudit).toHaveLength(1)
    const audit = result.current.conflictAudit[0]!
    expect(audit).toMatchObject({
      kind: 'solve',
      id: 'solve-1',
      field: 'penalty',
      localValue: 'none',
      remoteValue: '+2',
      resolution: 'local',
    })

    await act(async () => {
      expect(result.current.undoConflictResolution(audit.auditId)).toEqual({
        ok: true,
      })
      await result.current.syncNow('manual')
    })

    await vi.waitFor(() => expect(result.current.phase).toBe('synced'))
    const replacement = onReplaceSessions.mock.calls.at(-1)?.[0] as
      | SessionsData
      | undefined
    expect(replacement?.sessions[0]?.solves[0]?.penalty).toBe('+2')
    expect(result.current.conflictAudit[0]).toMatchObject({
      undoOf: audit.auditId,
      resolution: 'remote',
    })
    expect(result.current.conflictAudit[1]).toMatchObject({
      auditId: audit.auditId,
      undoneAt: expect.any(Number),
    })
  })

  it('refuses to reverse a legacy recovery after solves were restored', () => {
    const base = createDefaultSyncStorage('device-test')
    const conflict: SyncConflict = {
      id: 'session-deleted',
      kind: 'session',
      sessionId: 'session-deleted',
      field: 'legacyRecovery',
      localValue: 'keep-deleted',
      remoteValue: 'recover:solve-old',
      localUpdatedAt: 100,
      remoteUpdatedAt: 200,
      resolution: 'remote',
      updatedAt: 300,
    }
    const audit: ConflictAuditEntry = {
      auditId: 'audit-legacy',
      kind: 'session',
      id: 'session-deleted',
      sessionId: 'session-deleted',
      field: 'legacyRecovery',
      localValue: 'keep-deleted',
      remoteValue: 'recover:solve-old',
      localUpdatedAt: 100,
      remoteUpdatedAt: 200,
      resolution: 'remote',
      resolvedAt: 300,
      byDeviceId: 'device-test',
    }
    saveSyncStorage({
      ...base,
      preferences: { ...base.preferences, enabled: false },
      runtime: {
        ...base.runtime,
        conflicts: [conflict],
        conflictAudit: [audit],
      },
    })

    const { result } = renderStatefulSync({
      transport: createMemoryDriveTransport(),
      sessions: sessionsData(),
      settings: DEFAULT_SETTINGS,
    })
    expect(result.current.undoConflictResolution('audit-legacy')).toEqual({
      ok: false,
      error:
        'Legacy recovery cannot be reversed automatically after solves were restored.',
    })
    expect(loadSyncStorage().runtime.conflicts[0]?.resolution).toBe('remote')
    expect(result.current.conflictAudit).toHaveLength(1)
  })

  it('refuses to reverse a decision that is no longer current', async () => {
    enableSync({ manualConflictReview: true })
    const transport = createMemoryDriveTransport()
    await transport.connect()
    await transport.uploadBackup(
      JSON.stringify(
        createBackup(
          sessionsData({
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
          }),
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
              fieldUpdates: {
                penalty: { updatedAt: 100, editorId: 'local-device' },
              },
            }),
          ],
        }),
      ],
    })
    const { result } = renderStatefulSync({
      transport,
      sessions: localSessions,
      settings: DEFAULT_SETTINGS,
    })

    await act(async () => {
      await result.current.syncNow('manual')
    })
    await act(async () => {
      result.current.resolveConflict('solve-1', 'penalty', 'local')
      await result.current.syncNow('manual')
    })
    await vi.waitFor(() => expect(result.current.phase).toBe('synced'))
    const audit = result.current.conflictAudit[0]!

    // An explicit replacement clears the reviewed conflict record. The audit
    // entry stays visible but can no longer be applied safely.
    await act(async () => {
      result.current.resetBase(localSessions)
    })
    const outcome = result.current.undoConflictResolution(audit.auditId)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain('changed')
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
      uploadDeviceBackup: async (content, deviceId) => {
        uploads += 1
        return memory.uploadDeviceBackup!(content, deviceId)
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

  it('records an event tombstone when a custom definition disappears', async () => {
    enableSync()
    const transport = createMemoryDriveTransport()
    const initial = sessionsData({
      customEvents: [
        {
          id: 'custom:fto',
          name: 'FTO',
          placeholder: '',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        },
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
      rerender({ sessions: sessionsData() })
    })

    await vi.waitFor(() => {
      const stored = loadSyncStorage()
      expect(stored.runtime.tombstones).toEqual([
        expect.objectContaining({
          kind: 'event',
          id: 'custom:fto',
          deletedByDeviceId: 'device-test',
        }),
      ])
    })
  })

  it('records multiple solve tombstones in one durable call', async () => {
    enableSync()
    const transport = createMemoryDriveTransport()
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

    let saved = false
    act(() => {
      saved = result.current.recordDeletions([
        { id: 'reset-a', sessionId: 'session-1' },
        { id: 'reset-b', sessionId: 'session-2' },
      ])
    })

    expect(saved).toBe(true)
    expect(loadSyncStorage().runtime.tombstones).toEqual([
      expect.objectContaining({
        kind: 'solve',
        id: 'reset-a',
        sessionId: 'session-1',
        deletedByDeviceId: 'device-test',
      }),
      expect.objectContaining({
        kind: 'solve',
        id: 'reset-b',
        sessionId: 'session-2',
        deletedByDeviceId: 'device-test',
      }),
    ])
  })

  it('records session and solve tombstones for a delete-all action in one call', async () => {
    enableSync()
    const transport = createMemoryDriveTransport()
    const target = sessionsData({
      sessions: [
        session({
          id: 'session-1',
          name: 'Morning',
          solves: [solve({ id: 'solve-1' }), solve({ id: 'solve-2' })],
        }),
        session({ id: 'session-2', name: 'Evening', solves: [solve({ id: 'solve-3' })] }),
      ],
    })
    const { result } = renderHook(() =>
      useSync({
        transport,
        sessions: target,
        settings: DEFAULT_SETTINGS,
        storageOk: true,
        timerActive: false,
        onReplaceSessions: vi.fn(),
        onReplaceSettings: vi.fn(),
        onNotify: vi.fn(),
      }),
    )

    let saved = false
    act(() => {
      saved = result.current.recordAllSessionDeletions(target.sessions)
    })

    expect(saved).toBe(true)
    const tombstones = loadSyncStorage().runtime.tombstones
    expect(tombstones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'session',
          id: 'session-1',
          knownSolveIds: ['solve-1', 'solve-2'],
        }),
        expect.objectContaining({
          kind: 'session',
          id: 'session-2',
          knownSolveIds: ['solve-3'],
        }),
        expect.objectContaining({ kind: 'solve', id: 'solve-1' }),
        expect.objectContaining({ kind: 'solve', id: 'solve-2' }),
        expect.objectContaining({ kind: 'solve', id: 'solve-3' }),
      ]),
    )
    expect(tombstones).toHaveLength(5)
  })

  it('records solve tombstones with a single-session deletion so stale split copies cannot return', () => {
    enableSync()
    const target = session({
      id: 'session-split-destination',
      name: 'Split target',
      solves: [solve({ id: 'moved-a' }), solve({ id: 'moved-b' })],
    })
    const { result } = renderHook(() =>
      useSync({
        transport: createMemoryDriveTransport(),
        sessions: sessionsData({ sessions: [target] }),
        settings: DEFAULT_SETTINGS,
        storageOk: true,
        timerActive: false,
        onReplaceSessions: vi.fn(),
        onReplaceSettings: vi.fn(),
        onNotify: vi.fn(),
      }),
    )

    act(() => {
      expect(result.current.recordSessionDeletion(target)).toBe(true)
    })

    expect(loadSyncStorage().runtime.tombstones).toEqual([
      expect.objectContaining({
        kind: 'session',
        id: 'session-split-destination',
        knownSolveIds: ['moved-a', 'moved-b'],
      }),
      expect.objectContaining({
        kind: 'solve',
        id: 'moved-a',
        sessionId: 'session-split-destination',
      }),
      expect.objectContaining({
        kind: 'solve',
        id: 'moved-b',
        sessionId: 'session-split-destination',
      }),
    ])
  })

  it('reports a delete-all tombstone failure when storage is unavailable', async () => {
    enableSync()
    const transport = createMemoryDriveTransport()
    const target = sessionsData({
      sessions: [session({ id: 'session-1', solves: [solve()] })],
    })
    const { result, unmount } = renderHook(() =>
      useSync({
        transport,
        sessions: target,
        settings: DEFAULT_SETTINGS,
        storageOk: false,
        timerActive: false,
        onReplaceSessions: vi.fn(),
        onReplaceSettings: vi.fn(),
        onNotify: vi.fn(),
      }),
    )
    act(() => {
      expect(result.current.recordAllSessionDeletions(target.sessions)).toBe(false)
    })
    unmount()
  })
})

describe('useSync session merge records', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persists redirects before a local merge without replacing sessions', () => {
    const sessions = sessionsData({
      sessions: [
        session({ id: 'session-1', name: 'Destination' }),
        session({ id: 'session-2', name: 'Source' }),
      ],
    })
    const onReplaceSessions = vi.fn()
    const { result } = renderHook(() =>
      useSync({
        transport: createMemoryDriveTransport(),
        sessions,
        settings: DEFAULT_SETTINGS,
        storageOk: true,
        timerActive: false,
        onReplaceSessions,
        onReplaceSettings: vi.fn(),
        onNotify: vi.fn(),
      }),
    )

    act(() => {
      expect(
        result.current.recordSessionMerges('session-1', ['session-2']),
      ).toBe(true)
    })

    expect(loadSyncStorage().runtime.sessionRedirects).toEqual([
      expect.objectContaining({
        fromId: 'session-2',
        toId: 'session-1',
      }),
    ])
    expect(onReplaceSessions).not.toHaveBeenCalled()
  })

  it('rolls back redirects when the local collection could not be saved', () => {
    const sessions = sessionsData({
      sessions: [
        session({ id: 'session-1', name: 'Destination' }),
        session({ id: 'session-2', name: 'Source' }),
      ],
    })
    const { result } = renderHook(() =>
      useSync({
        transport: createMemoryDriveTransport(),
        sessions,
        settings: DEFAULT_SETTINGS,
        storageOk: true,
        timerActive: false,
        onReplaceSessions: vi.fn(),
        onReplaceSettings: vi.fn(),
        onNotify: vi.fn(),
      }),
    )

    act(() => {
      expect(
        result.current.recordSessionMerges('session-1', ['session-2']),
      ).toBe(true)
      expect(
        result.current.removeSessionMerges('session-1', ['session-2']),
      ).toBe(true)
    })

    expect(loadSyncStorage().runtime.sessionRedirects).toEqual([])
  })

  it('does not write a merge record when storage is unavailable', () => {
    const sessions = sessionsData({
      sessions: [
        session({ id: 'session-1', name: 'Destination' }),
        session({ id: 'session-2', name: 'Source' }),
      ],
    })
    const { result } = renderHook(() =>
      useSync({
        transport: createMemoryDriveTransport(),
        sessions,
        settings: DEFAULT_SETTINGS,
        storageOk: false,
        timerActive: false,
        onReplaceSessions: vi.fn(),
        onReplaceSettings: vi.fn(),
        onNotify: vi.fn(),
      }),
    )

    act(() => {
      expect(
        result.current.recordSessionMerges('session-1', ['session-2']),
      ).toBe(false)
    })

    expect(loadSyncStorage().runtime.sessionRedirects).toEqual([])
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

describe('useSync conflict queue integrity', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  /**
   * Reproduces the original bug: with more than 100 conflicting solve fields,
   * the stored queue was truncated before the pending filter ran, so pending
   * conflicts and the approvals needed to finish the merge were evicted by a
   * display/history cap. Fields silently auto-resolved, and approvals kept
   * being requested again.
   */
  function bulkConflictingSessions(count: number, prefix: string): SessionsData {
    const solves: Solve[] = []
    for (let index = 0; index < count; index += 1) {
      solves.push(
        solve({
          id: `${prefix}-${index}`,
          comment: `${prefix} comment ${index}`,
          fieldUpdates: {
            comment: {
              updatedAt: index % 2 === 0 ? 100 + index : 200 + index,
              editorId: index % 2 === 0 ? 'device-test' : 'remote-device',
            },
          },
        }),
      )
    }
    return sessionsData({
      sessions: [
        session({
          id: 'session-bulk',
          name: 'Bulk',
          solves: [...solves].sort((left, right) => right.createdAt - left.createdAt),
        }),
      ],
      activeSessionId: 'session-bulk',
    })
  }

  it('keeps every pending conflict above the old 100-record cap and converges', async () => {
    const CONFLICTS = 101
    enableSync({ manualConflictReview: true })
    const transport = createMemoryDriveTransport()
    await transport.connect()

    // Two remote devices disagree with this device on 101 solve comments.
    const remoteA = bulkConflictingSessions(CONFLICTS, 'remote-a')
    const remoteB = bulkConflictingSessions(CONFLICTS, 'remote-b')
    await transport.uploadDeviceBackup!(
      JSON.stringify(
        createBackup(
          remoteA,
          DEFAULT_SETTINGS,
          new Date('2026-01-01T00:00:00.000Z'),
          {
            ...createSyncEnvelope('remote-a', 1, [], []),
            updatedAt: 100,
          },
        ),
      ),
      'remote-a',
    )
    await transport.uploadDeviceBackup!(
      JSON.stringify(
        createBackup(
          remoteB,
          DEFAULT_SETTINGS,
          new Date('2026-01-02T00:00:00.000Z'),
          {
            ...createSyncEnvelope('remote-b', 1, [], []),
            updatedAt: 200,
          },
        ),
      ),
      'remote-b',
    )

    const localSolves: Solve[] = []
    for (let index = 0; index < CONFLICTS; index += 1) {
      localSolves.push(
        solve({
          id: `remote-a-${index}`,
          comment: `local comment ${index}`,
          fieldUpdates: {
            comment: {
              updatedAt: 300 + index,
              editorId: 'device-test',
            },
          },
        }),
      )
    }
    const local = sessionsData({
      sessions: [
        session({
          id: 'session-bulk',
          name: 'Bulk',
          solves: [...localSolves].sort(
            (left, right) => right.createdAt - left.createdAt,
          ),
        }),
      ],
      activeSessionId: 'session-bulk',
    })

    const { result, unmount } = renderStatefulSync({
      transport,
      sessions: local,
      settings: DEFAULT_SETTINGS,
    })

    await act(async () => {
      await result.current.syncNow('manual')
    })

    // Every conflicting field stays pending. The old cap silently auto-resolved
    // and dropped records past the first 100.
    expect(result.current.pendingConflicts).toHaveLength(CONFLICTS)
    expect(result.current.conflictsCount).toBe(CONFLICTS)
    expect(result.current.phase).toBe('conflict')
    expect(result.current.hasPendingChanges).toBe(true)

    // Resolve every conflict through the normal workflow, choosing this
    // device's value each time.
    await act(async () => {
      for (const conflict of result.current.pendingConflicts) {
        result.current.resolveConflict(
          conflict.id,
          conflict.field,
          'local',
          conflict.kind,
        )
      }
    })
    expect(result.current.pendingConflicts).toHaveLength(0)

    await act(async () => {
      await result.current.syncNow('manual')
    })
    await vi.waitFor(() => expect(result.current.phase).toBe('synced'))

    // The published snapshot preserves every chosen local value.
    const files = await transport.listBackups!()
    // Find the published envelope's resolved conflict set + sessions together.
    const publishedContents = await Promise.all(
      files.map(async (file) => transport.downloadBackup(file.id)),
    )
    // Resolve conflicts live on the last (newest) snapshot's sessions/solves.
    const sessionSolutions = publishedContents.map((content) => {
      const parsed = JSON.parse(content) as {
        sessions?: { sessions?: Array<{ solves?: Array<{ id?: string; comment?: string }> }> }
        sync?: { revision?: number }
      }
      const solves =
        parsed.sessions?.sessions?.flatMap((entry) => entry.solves ?? []) ?? []
      return { solves, revision: parsed.sync?.revision ?? 0 }
    })
    const newest = sessionSolutions.reduce((winner, candidate) =>
      candidate.revision > winner.revision ? candidate : winner,
    )
    for (let index = 0; index < CONFLICTS; index += 1) {
      const solve = newest.solves.find(
        (item) => item.id === `remote-a-${index}`,
      )
      expect(solve?.comment).toBe(`local comment ${index}`)
    }

    // Repeated syncs do not request the discarded approvals again.
    const conflictCountBefore = loadSyncStorage().runtime.conflicts.length
    await act(async () => {
      await result.current.syncNow('manual')
    })
    await vi.waitFor(() => expect(result.current.phase).toBe('synced'))
    expect(result.current.pendingConflicts).toHaveLength(0)
    expect(loadSyncStorage().runtime.conflicts.length).toBe(conflictCountBefore)

    unmount()
  })

  it('persists mixed pending and resolved records across a reload', async () => {
    const CONFLICTS = 101
    enableSync({ manualConflictReview: true })
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const remote = bulkConflictingSessions(CONFLICTS, 'remote-a')
    await transport.uploadDeviceBackup!(
      JSON.stringify(
        createBackup(
          remote,
          DEFAULT_SETTINGS,
          new Date('2026-01-01T00:00:00.000Z'),
          { ...createSyncEnvelope('remote-a', 1, [], []), updatedAt: 100 },
        ),
      ),
      'remote-a',
    )
    const localSolves: Solve[] = []
    for (let index = 0; index < CONFLICTS; index += 1) {
      localSolves.push(
        solve({
          id: `remote-a-${index}`,
          comment: `local comment ${index}`,
          fieldUpdates: {
            comment: { updatedAt: 300 + index, editorId: 'device-test' },
          },
        }),
      )
    }
    const local = sessionsData({
      sessions: [
        session({
          id: 'session-bulk',
          name: 'Bulk',
          solves: [...localSolves].sort(
            (left, right) => right.createdAt - left.createdAt,
          ),
        }),
      ],
      activeSessionId: 'session-bulk',
    })
    const { result, unmount } = renderStatefulSync({
      transport,
      sessions: local,
      settings: DEFAULT_SETTINGS,
    })

    await act(async () => {
      await result.current.syncNow('manual')
    })
    expect(result.current.pendingConflicts).toHaveLength(CONFLICTS)

    // Approve one field before the reload.
    await act(async () => {
      const first = result.current.pendingConflicts[0]!
      result.current.resolveConflict(first.id, first.field, 'local', first.kind)
    })
    expect(result.current.pendingConflicts).toHaveLength(CONFLICTS - 1)

    // A reload re-reads the persisted queue: resolved and pending records
    // alike survive storage, above and below the old 100 cap.
    const stored = JSON.parse(
      localStorage.getItem(SYNC_STORAGE_KEY) ?? '{}',
    ) as { runtime?: { conflicts?: unknown[] } }
    expect(stored.runtime?.conflicts?.length).toBe(CONFLICTS)
    const persisted = loadSyncStorage()
    expect(
      persisted.runtime.conflicts.filter(
        (conflict) => conflict.resolution === 'manual-pending',
      ).length,
    ).toBe(CONFLICTS - 1)
    expect(
      persisted.runtime.conflicts.filter(
        (conflict) => conflict.resolution !== 'manual-pending',
      ).length,
    ).toBe(1)

    unmount()
  })

  it('raises a fresh conflict when a reviewed value is edited after approval', async () => {
    const CONFLICTS = 101
    enableSync({ manualConflictReview: true })
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const remote = bulkConflictingSessions(CONFLICTS, 'remote-a')
    await transport.uploadDeviceBackup!(
      JSON.stringify(
        createBackup(
          remote,
          DEFAULT_SETTINGS,
          new Date('2026-01-01T00:00:00.000Z'),
          { ...createSyncEnvelope('remote-a', 1, [], []), updatedAt: 100 },
        ),
      ),
      'remote-a',
    )
    const localSolves: Solve[] = []
    for (let index = 0; index < CONFLICTS; index += 1) {
      localSolves.push(
        solve({
          id: `remote-a-${index}`,
          comment: `local comment ${index}`,
          fieldUpdates: {
            comment: { updatedAt: 300 + index, editorId: 'device-test' },
          },
        }),
      )
    }
    const local = sessionsData({
      sessions: [
        session({
          id: 'session-bulk',
          name: 'Bulk',
          solves: [...localSolves].sort(
            (left, right) => right.createdAt - left.createdAt,
          ),
        }),
      ],
      activeSessionId: 'session-bulk',
    })
    const { result, rerender, unmount } = renderHook(
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
      { initialProps: { sessions: local } },
    )

    await act(async () => {
      await result.current.syncNow('manual')
    })
    expect(result.current.pendingConflicts).toHaveLength(CONFLICTS)

    // Approve the exact reviewed value of one field.
    const target = result.current.pendingConflicts[0]!
    await act(async () => {
      result.current.resolveConflict(target.id, target.field, 'local', target.kind)
    })

    // A distinct later edit to the same field must invalidate the approval and
    // raise a fresh conflict instead of being decided by the old choice.
    const edited = local.sessions[0]!.solves.map((item) =>
      item.id === target.id
        ? {
            ...item,
            comment: 'edited after approval',
            fieldUpdates: {
              ...item.fieldUpdates,
              comment: { updatedAt: 9_000, editorId: 'device-test' },
            },
          }
        : item,
    )
    const editedSessions: SessionsData = {
      ...local,
      sessions: [{ ...local.sessions[0]!, solves: edited }],
    }
    await act(async () => {
      rerender({ sessions: editedSessions })
      await result.current.syncNow('manual')
    })

    await vi.waitFor(() => expect(result.current.phase).toBe('conflict'))
    const fresh = result.current.pendingConflicts.find(
      (conflict) => conflict.id === target.id && conflict.field === 'comment',
    )
    expect(fresh).toMatchObject({
      resolution: 'manual-pending',
      localValue: 'edited after approval',
      remoteValue: 'remote-a comment 0',
    })
    // The other 100 fields keep their existing decisions.
    expect(result.current.pendingConflicts).toHaveLength(CONFLICTS)

    unmount()
  })
})

describe('useSync snapshot retention', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  async function seedSnapshots(
    transport: ReturnType<typeof createMemoryDriveTransport>,
    deviceId: string,
    count: number,
  ): Promise<DriveFile[]> {
    const files: DriveFile[] = []
    for (let index = 0; index < count; index += 1) {
      files.push(
        await transport.uploadDeviceBackup!(
          JSON.stringify(
            createBackup(
              sessionsData(),
              DEFAULT_SETTINGS,
              new Date(),
              {
                ...createSyncEnvelope(deviceId, index + 1, [], []),
                updatedAt: 100 + index,
              },
            ),
          ),
          deviceId,
        ),
      )
    }
    return files
  }

  it('prunes superseded snapshots after publishing the merged state', async () => {
    enableSync()
    const memory = createMemoryDriveTransport()
    await memory.connect()
    const own = await seedSnapshots(memory, 'device-test', 12)
    const foreign = await seedSnapshots(memory, 'other-device', 2)
    const { result, onNotify, unmount } = renderStatefulSync({
      transport: memory,
      sessions: sessionsData(),
      settings: DEFAULT_SETTINGS,
    })

    await act(async () => {
      await result.current.syncNow('manual')
    })

    expect(result.current.phase).toBe('synced')
    const files = await memory.listBackups!()
    // Twelve own snapshots prune to the newest ten; the new published snapshot
    // and both foreign snapshots remain.
    expect(files).toHaveLength(13)
    expect(files.some((file) => file.id === own[0]!.id)).toBe(false)
    expect(files.some((file) => file.id === own[1]!.id)).toBe(false)
    expect(files.some((file) => file.id === own[2]!.id)).toBe(true)
    expect(foreign.every((file) => files.some((entry) => entry.id === file.id))).toBe(
      true,
    )
    expect(onNotify.mock.calls.flat().join(' ')).toContain(
      '2 old snapshots removed',
    )
    unmount()
  })

  it('leaves every snapshot in place when automatic cleanup is off', async () => {
    enableSync({ snapshotCleanupEnabled: false })
    const memory = createMemoryDriveTransport()
    await memory.connect()
    const own = await seedSnapshots(memory, 'device-test', 12)
    const foreign = await seedSnapshots(memory, 'other-device', 2)
    const { result, onNotify, unmount } = renderStatefulSync({
      transport: memory,
      sessions: sessionsData(),
      settings: DEFAULT_SETTINGS,
    })

    await act(async () => {
      await result.current.syncNow('manual')
    })

    expect(result.current.phase).toBe('synced')
    const files = await memory.listBackups!()
    expect(files).toHaveLength(15)
    expect(own.every((file) => files.some((entry) => entry.id === file.id))).toBe(
      true,
    )
    expect(foreign.every((file) => files.some((entry) => entry.id === file.id))).toBe(
      true,
    )
    expect(onNotify.mock.calls.flat().join(' ')).not.toContain('snapshot')
    unmount()
  })

  it('preserves historical snapshots during a solve-reset synchronization', async () => {
    enableSync()
    const memory = createMemoryDriveTransport()
    await memory.connect()
    const own = await seedSnapshots(memory, 'device-test', 12)
    const foreign = await seedSnapshots(memory, 'other-device', 2)
    const { result, unmount } = renderStatefulSync({
      transport: memory,
      sessions: sessionsData(),
      settings: DEFAULT_SETTINGS,
    })

    await act(async () => {
      expect(result.current.recordDeletions([{ id: 'reset-solve' }])).toBe(true)
      await result.current.syncNow('reset')
    })

    expect(result.current.phase).toBe('synced')
    const files = await memory.listBackups!()
    expect(files).toHaveLength(15)
    expect(
      [...own, ...foreign].every((file) =>
        files.some((entry) => entry.id === file.id),
      ),
    ).toBe(true)
    unmount()
  })

  it('keeps the completed sync successful when cleanup partially fails', async () => {
    enableSync()
    const memory = createMemoryDriveTransport()
    await memory.connect()
    const own = await seedSnapshots(memory, 'device-test', 12)
    const transport: DriveTransport = {
      ...memory,
      deleteBackup: async (fileId) => {
        if (fileId === own[0]!.id) throw new Error('permission denied')
        return memory.deleteBackup(fileId)
      },
    }
    const { result, onNotify, unmount } = renderStatefulSync({
      transport,
      sessions: sessionsData(),
      settings: DEFAULT_SETTINGS,
    })

    await act(async () => {
      await result.current.syncNow('manual')
    })

    expect(result.current.phase).toBe('synced')
    expect(result.current.error).toBeNull()
    const files = await memory.listBackups!()
    // The refused snapshot stays; the other candidate is removed and the new
    // snapshot is published.
    expect(files.some((file) => file.id === own[0]!.id)).toBe(true)
    expect(files.some((file) => file.id === own[1]!.id)).toBe(false)
    expect(files).toHaveLength(12)
    const message = onNotify.mock.calls.flat().join(' ')
    expect(message).toContain('1 old snapshot removed')
    expect(message).toContain('could not be removed')
    unmount()
  })
})

describe('useSync same-device write safety', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('adds an immutable snapshot instead of overwriting a concurrent shared-device writer', async () => {
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
    // This browser's earlier snapshot, written by a build that predates unique
    // snapshot names. It stays readable; nothing overwrites it.
    await memory.uploadBackup(
      JSON.stringify(
        createBackup(
          local,
          DEFAULT_SETTINGS,
          new Date('2026-01-01T00:00:00.000Z'),
          { ...createSyncEnvelope('device-test', 1, [], []), updatedAt: 100 },
        ),
      ),
      null,
    )

    // A second browser profile copied from this one shares the device ID and
    // holds a different new solve. It finishes its upload while ours is in
    // flight — after every pre-write check, the exact race the old optimistic
    // recheck could not make atomic.
    const foreign = sessionsData({
      sessions: [
        session({
          id: 'session-test',
          solves: [
            solve({ id: 'local-1' }),
            solve({ id: 'foreign-1' }),
          ],
        }),
      ],
      activeSessionId: 'session-test',
    })
    const foreignContent = JSON.stringify(
      createBackup(
        foreign,
        DEFAULT_SETTINGS,
        new Date('2026-01-02T00:00:00.000Z'),
        { ...createSyncEnvelope('device-test', 2, [], []), updatedAt: 200 },
      ),
    )
    let uploads = 0
    const transport: DriveTransport = {
      ...memory,
      uploadDeviceBackup: async (content: string, deviceId: string) => {
        uploads += 1
        if (uploads === 1) {
          // The shared-ID writer lands while this device's request is delayed.
          await memory.uploadDeviceBackup!(foreignContent, 'device-test')
        }
        return memory.uploadDeviceBackup!(content, deviceId)
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

    // Immutable snapshots: this sync publishes instead of aborting, and the
    // concurrent writer's unique data is not overwritten.
    expect(uploads).toBe(1)
    expect(result.current.phase).toBe('synced')
    const files = await memory.listBackups!()
    expect(files.length).toBeGreaterThanOrEqual(2)
    const contents = await Promise.all(
      files.map(async (file) => memory.downloadBackup(file.id)),
    )
    // Both writers' solves remain discoverable remotely.
    expect(contents.some((content) => content.includes('"local-1"'))).toBe(true)
    expect(contents.some((content) => content.includes('"foreign-1"'))).toBe(
      true,
    )
    // The concurrent writer's snapshot is intact, byte for byte.
    expect(contents).toContain(foreignContent)

    // A subsequent sync converges on both solves without losing either.
    await act(async () => {
      await result.current.syncNow('manual')
    })
    await vi.waitFor(() => expect(result.current.phase).toBe('synced'))
    const published = await (async () => {
      const currentFiles = await memory.listBackups!()
      const currentContents = await Promise.all(
        currentFiles.map(async (file) => memory.downloadBackup(file.id)),
      )
      const newest = currentContents
        .map((content) => JSON.parse(content) as { sync?: { updatedAt?: number } })
        .sort((left, right) => (right.sync?.updatedAt ?? 0) - (left.sync?.updatedAt ?? 0))[0]
      return JSON.stringify(newest)
    })()
    expect(published).toContain('"local-1"')
    expect(published).toContain('"foreign-1"')
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

describe('useSync repair', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('clears derived bookkeeping while preserving correctness state', () => {
    const sync = createDefaultSyncStorage('device-test')
    saveSyncStorage({
      ...sync,
      preferences: { ...sync.preferences, enabled: false },
      runtime: {
        ...sync.runtime,
        lastSyncedFingerprint: 'stale-fingerprint',
        lastRemoteRevision: 42,
        lastSyncStatus: 'failed',
        lastError: 'stale error',
        tombstones: [
          {
            kind: 'solve',
            id: 'deleted-solve',
            deletedAt: 10,
            deletedByDeviceId: 'device-test',
          },
        ],
        conflicts: [
          {
            id: 'settings',
            kind: 'settings',
            field: 'accentColor',
            localValue: 'green',
            remoteValue: 'blue',
            localUpdatedAt: 10,
            remoteUpdatedAt: 20,
            resolution: 'local',
            updatedAt: 30,
          },
        ],
        conflictAudit: [
          {
            auditId: 'audit-1',
            kind: 'settings',
            id: 'settings',
            field: 'accentColor',
            localValue: 'green',
            remoteValue: 'blue',
            localUpdatedAt: 10,
            remoteUpdatedAt: 20,
            resolution: 'local',
            resolvedAt: 30,
            byDeviceId: 'device-test',
          },
        ],
        sessionRedirects: [
          {
            fromId: 'source',
            toId: 'target',
            approvedAt: 20,
            byDeviceId: 'device-test',
          },
        ],
      },
    })

    const { result } = renderHook(() =>
      useSync({
        transport: null,
        sessions: sessionsData(),
        settings: DEFAULT_SETTINGS,
        storageOk: true,
        timerActive: false,
        onReplaceSessions: vi.fn(),
        onReplaceSettings: vi.fn(),
        onNotify: vi.fn(),
      }),
    )

    act(() => {
      result.current.repairSyncState()
    })

    const repaired = loadSyncStorage()
    expect(repaired.runtime.lastSyncedFingerprint).toBeNull()
    expect(repaired.runtime.lastRemoteRevision).toBeNull()
    expect(repaired.runtime.lastSyncStatus).toBe('disabled')
    expect(repaired.runtime.lastError).toBeNull()
    expect(repaired.runtime.tombstones).toEqual([
      {
        kind: 'solve',
        id: 'deleted-solve',
        deletedAt: 10,
        deletedByDeviceId: 'device-test',
      },
    ])
    expect(repaired.runtime.conflicts).toHaveLength(1)
    expect(repaired.runtime.conflictAudit).toHaveLength(1)
    expect(repaired.runtime.sessionRedirects).toHaveLength(1)
  })
})

describe('useSync timer-active in-flight guards', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stops after a list/download when timing begins and publishes nothing', async () => {
    enableSync()
    const memory = createMemoryDriveTransport()
    await memory.connect()
    let releaseList: (() => void) | null = null
    let listStarted = false
    let deferList = true
    let uploads = 0
    const transport: DriveTransport = {
      ...memory,
      listBackups: () => {
        if (!deferList) return memory.listBackups!()
        return new Promise<DriveFile[]>((resolve) => {
          listStarted = true
          releaseList = () => {
            deferList = false
            resolve([])
          }
        })
      },
      uploadDeviceBackup: async (content, deviceId) => {
        uploads += 1
        return memory.uploadDeviceBackup!(content, deviceId)
      },
    }
    const onReplaceSessions = vi.fn()
    const onReplaceSettings = vi.fn()
    const rendered = renderHook(
      ({ timerActive }: { timerActive: boolean }) =>
        useSync({
          transport,
          sessions: sessionsData(),
          settings: DEFAULT_SETTINGS,
          storageOk: true,
          timerActive,
          onReplaceSessions,
          onReplaceSettings,
          onNotify: vi.fn(),
        }),
      { initialProps: { timerActive: false } },
    )

    let firstSync: Promise<void> | null = null
    await act(async () => {
      firstSync = rendered.result.current.syncNow('manual')
      await vi.waitFor(() => expect(listStarted).toBe(true))
    })

    await act(async () => {
      rendered.rerender({ timerActive: true })
    })
    await act(async () => {
      releaseList!()
      await firstSync
    })

    expect(uploads).toBe(0)
    expect(onReplaceSessions).not.toHaveBeenCalled()
    expect(onReplaceSettings).not.toHaveBeenCalled()
    expect(rendered.result.current.phase).toBe('pending')
    expect(rendered.result.current.error).toContain('timer is idle')

    await act(async () => {
      rendered.rerender({ timerActive: false })
    })
    await vi.waitFor(() => expect(uploads).toBe(1), { timeout: 4_000 })
    await vi.waitFor(() => expect(rendered.result.current.phase).toBe('synced'))
  })

  it('cancels while waiting for the write lock and retries once idle', async () => {
    enableSync()
    const memory = createMemoryDriveTransport()
    await memory.connect()
    let uploads = 0
    const transport: DriveTransport = {
      ...memory,
      uploadDeviceBackup: async (content, deviceId) => {
        uploads += 1
        return memory.uploadDeviceBackup!(content, deviceId)
      },
    }

    const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')
    let releaseWriteLock: (() => void) | null = null
    let writeLockRequested = false
    let deferWriteLock = true
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (
          name: string,
          optionsOrCallback:
            | unknown
            | ((lock: unknown) => Promise<unknown>),
          maybeCallback?: (lock: unknown) => Promise<unknown>,
        ) => {
          const callback =
            typeof optionsOrCallback === 'function'
              ? optionsOrCallback
              : maybeCallback!
          if (name === 'cubelab-sync-leader') {
            void callback({})
            // Keep leadership for the life of the test.
            return new Promise(() => {})
          }
          if (deferWriteLock) {
            writeLockRequested = true
            return new Promise((resolve) => {
              releaseWriteLock = () => resolve(callback({}))
            })
          }
          return callback({})
        },
      },
    })

    let rendered: any = null
    try {
      rendered = renderHook(
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
        { initialProps: { timerActive: false } },
      )

      await vi.waitFor(() => expect((rendered!.result.current as any).phase).not.toBe('disabled'))

      let firstSync: Promise<void> | null = null
      await act(async () => {
        firstSync = (rendered!.result.current as any).syncNow('manual')
        await vi.waitFor(() => expect(writeLockRequested).toBe(true))
      })

      await act(async () => {
        rendered!.rerender({ timerActive: true })
      })
      await act(async () => {
        releaseWriteLock!()
        await firstSync
      })

      expect(uploads).toBe(0)
      expect((rendered!.result.current as { phase: string }).phase).toBe('pending')
      expect((rendered!.result.current as { error: string | null }).error).toContain('timer is idle')

      deferWriteLock = false
      await act(async () => {
        rendered!.rerender({ timerActive: false })
      })
      await vi.waitFor(() => expect(uploads).toBe(1), { timeout: 4_000 })
      await vi.waitFor(() => expect((rendered!.result.current as any).phase).toBe('synced'))
    } finally {
      rendered?.unmount()
      if (originalLocks) {
        Object.defineProperty(navigator, 'locks', originalLocks)
      } else {
        Reflect.deleteProperty(navigator, 'locks')
      }
    }
  })

  it('defers an external active-session storage event until idle', async () => {
    enableSync()
    const initial = sessionsData({
      sessions: [
        session({ solves: [solve({ id: 'existing' })] }),
        session({ id: 'session-2', name: 'Evening' }),
      ],
    })
    const external = {
      ...initial,
      activeSessionId: 'session-2',
    }
    const onReplaceSessions = vi.fn()
    const rendered = renderHook(
      ({ timerActive }: { timerActive: boolean }) =>
        useSync({
          transport: createMemoryDriveTransport(),
          sessions: initial,
          settings: DEFAULT_SETTINGS,
          storageOk: true,
          timerActive,
          onReplaceSessions,
          onReplaceSettings: vi.fn(),
          onNotify: vi.fn(),
        }),
      { initialProps: { timerActive: true } },
    )

    await act(async () => {
      saveSessions(external)
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'cubelab:sessions:v1',
          newValue: JSON.stringify(external),
        }),
      )
    })
    expect(onReplaceSessions).not.toHaveBeenCalled()

    await act(async () => {
      rendered.rerender({ timerActive: false })
    })
    await vi.waitFor(() => expect(onReplaceSessions).toHaveBeenCalledTimes(1))
    expect(onReplaceSessions.mock.calls[0]?.[0]).toMatchObject({
      activeSessionId: 'session-2',
    })
  })
})

describe('cross-tab settings metadata', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('does not stamp adopted external settings as new local edits', () => {
    const { result } = renderHook(() => {
      const settingsApi = useSettings()
      const sync = useSync({
        transport: createMemoryDriveTransport(),
        sessions: sessionsData(),
        settings: settingsApi.settings,
        storageOk: true,
        timerActive: false,
        onReplaceSessions: vi.fn(),
        onReplaceSettings: settingsApi.replaceSettings,
        adoptedSettingsFieldsRef: settingsApi.adoptedFieldsRef,
        onNotify: vi.fn(),
      })
      return { settingsApi, sync }
    })

    act(() => {
      saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: SETTINGS_STORAGE_KEY,
          newValue: localStorage.getItem(SETTINGS_STORAGE_KEY),
        }),
      )
    })

    expect(result.current.settingsApi.settings.theme).toBe('dark')
    // The external write owns the theme timestamp; this tab must not replace
    // it with a fresh local edit.
    expect(
      loadSyncStorage().runtime.settingsFieldUpdates.theme,
    ).toBeUndefined()

    act(() => {
      result.current.settingsApi.updateSettings({ accentColor: 'blue' })
    })

    const updates = loadSyncStorage().runtime.settingsFieldUpdates
    expect(updates.accentColor).toBeDefined()
    expect(updates.theme).toBeUndefined()
    expect(result.current.sync.phase).toBe('disabled')
  })
})


describe('useSync pending-state fingerprint cost', () => {
  beforeEach(() => localStorage.clear())

  it('does not traverse history while disabled and detects edits when re-enabled', () => {
    const fingerprint = vi.spyOn(syncFingerprint, 'syncStateFingerprint')
    try {
      const initial = sessionsData()
      const edited = sessionsData({ sessions: [session({ solves: [solve()] })] })
      const callbacks = { onReplaceSessions: vi.fn(), onReplaceSettings: vi.fn(), onNotify: vi.fn() }
      const { result, rerender, unmount } = renderHook(
        ({ sessions }) => useSync({ transport: null, sessions, settings: DEFAULT_SETTINGS,
          storageOk: true, timerActive: false, ...callbacks }),
        { initialProps: { sessions: initial } },
      )
      expect(result.current.hasPendingChanges).toBe(false)
      rerender({ sessions: edited })
      expect(fingerprint).not.toHaveBeenCalled()
      act(() => result.current.updatePreferences({ enabled: true }))
      expect(fingerprint).toHaveBeenCalledWith(edited, DEFAULT_SETTINGS)
      expect(result.current.hasPendingChanges).toBe(true)
      act(() => result.current.updatePreferences({ enabled: false }))
      fingerprint.mockClear()
      rerender({ sessions: initial })
      expect(result.current.hasPendingChanges).toBe(false)
      expect(fingerprint).not.toHaveBeenCalled()
      unmount()
    } finally { fingerprint.mockRestore() }
  })

  it('keeps enabled pending detection exact across edits and a revert', () => {
    const initial = sessionsData()
    const sync = createDefaultSyncStorage('device-test')
    saveSyncStorage({ ...sync, preferences: { ...sync.preferences, enabled: true, syncOnStartup: false },
      runtime: { ...sync.runtime, lastSyncStatus: 'synced',
        lastSyncedFingerprint: syncFingerprint.syncStateFingerprint(initial, DEFAULT_SETTINGS) } })
    const callbacks = { onReplaceSessions: vi.fn(), onReplaceSettings: vi.fn(), onNotify: vi.fn() }
    const { result, rerender, unmount } = renderHook(
      ({ sessions }) => useSync({ transport: null, sessions, settings: DEFAULT_SETTINGS,
        storageOk: true, timerActive: false, ...callbacks }),
      { initialProps: { sessions: initial } },
    )
    expect(result.current.hasPendingChanges).toBe(false)
    rerender({ sessions: sessionsData({ sessions: [session({ solves: [solve()] })] }) })
    expect(result.current.hasPendingChanges).toBe(true)
    rerender({ sessions: initial })
    expect(result.current.hasPendingChanges).toBe(false)
    unmount()
  })
})

describe('useSync active-session conflict publication', () => {
  beforeEach(() => localStorage.clear())

  it.each(['local', 'remote'] as const)('publishes the reviewed %s selection once and preserves its provenance and solves', async (resolution) => {
    enableSync({ manualConflictReview: true })
    const stored = loadSyncStorage()
    saveSyncStorage({ ...stored, runtime: { ...stored.runtime,
      activeSessionFieldUpdate: { updatedAt: 100, editorId: 'device-test' } } })
    const collection = [
      session({ id: 'a', name: 'Morning', solves: [solve({ id: 'morning' })] }),
      session({ id: 'b', name: 'Evening', solves: [solve({ id: 'evening' })] }),
    ]
    const transport = createMemoryDriveTransport()
    await transport.connect()
    await transport.uploadDeviceBackup!(JSON.stringify(createBackup(
      { activeSessionId: 'b', sessions: collection }, DEFAULT_SETTINGS, new Date(),
      createSyncEnvelope('remote-device', 1, [], [], [], {}, { updatedAt: 200, editorId: 'remote-device' }),
    )), 'remote-device')
    const upload = vi.spyOn(transport, 'uploadDeviceBackup')
    const { result, onReplaceSessions } = renderStatefulSync({ transport,
      sessions: { activeSessionId: 'a', sessions: collection }, settings: DEFAULT_SETTINGS })

    await act(async () => { await result.current.syncNow('manual') })
    expect(result.current.phase).toBe('conflict')
    expect(result.current.pendingConflicts).toHaveLength(1)
    expect(upload).not.toHaveBeenCalled()
    await act(async () => {
      result.current.resolveConflict('active-session', 'activeSessionId', resolution, 'session')
      await result.current.syncNow('manual')
    })
    await vi.waitFor(() => expect(result.current.phase).toBe('synced'))
    const expectedId = resolution === 'local' ? 'a' : 'b'
    const approved = loadSyncStorage().runtime.conflicts.find((c) => c.field === 'activeSessionId')!
    expect(result.current.pendingConflicts).toHaveLength(0)
    expect(onReplaceSessions.mock.calls.at(-1)?.[0].activeSessionId).toBe(expectedId)
    expect(loadSyncStorage().runtime.activeSessionFieldUpdate).toEqual({ updatedAt: approved.updatedAt,
      editorId: resolution === 'local' ? 'device-test' : 'remote-device' })
    const published = JSON.parse(upload.mock.calls[0]![0])
    expect(published.sessions.activeSessionId).toBe(expectedId)
    expect(published.sessions.sessions.flatMap((s: Session) => s.solves).map((s: Solve) => s.id).sort()).toEqual(['evening', 'morning'])
    expect(published.sync.activeSessionFieldUpdate).toEqual(loadSyncStorage().runtime.activeSessionFieldUpdate)

    await act(async () => { await result.current.syncNow('manual') })
    expect(result.current.phase).toBe('synced')
    expect(result.current.pendingConflicts).toHaveLength(0)
    expect(upload).toHaveBeenCalledTimes(1)
  })
})
