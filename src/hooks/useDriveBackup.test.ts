import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Settings, Solve } from '../types'
import { createBackup } from '../lib/backup'
import { DEFAULT_SETTINGS } from '../lib/storage'
import {
  createMemoryDriveTransport,
  deviceBackupFileName,
  type DriveTransport,
} from '../lib/driveTransport'
import { DEFAULT_SESSION_NAME } from '../lib/sessions'
import { createSyncEnvelope } from '../lib/sync'
import {
  createDefaultSyncStorage,
  saveSyncStorage,
} from '../lib/syncStorage'
import { useDriveBackup } from './useDriveBackup'

function emptySessions() {
  const now = 1_700_000_000_000
  return {
    activeSessionId: 'session-1',
    sessions: [
      {
        id: 'session-1',
        name: DEFAULT_SESSION_NAME,
        createdAt: now,
        updatedAt: now,
        solves: [] as Solve[],
      },
    ],
  }
}

function settings(): Settings {
  return { ...DEFAULT_SETTINGS }
}

function sessionsWithSolve(id: string) {
  const sessions = emptySessions()
  sessions.sessions[0]!.solves.push({
    id,
    event: '333',
    rawMs: 10_000,
    penalty: 'none',
    scramble: "R U R' U'",
    comment: '',
    createdAt: 1_700_000_000_000,
  } as Solve)
  return sessions
}

describe('useDriveBackup', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('connects with the mock transport', async () => {
    const transport = createMemoryDriveTransport()
    const onPendingRestore = vi.fn()
    const onNotify = vi.fn()
    const { result } = renderHook(() =>
      useDriveBackup({
        transport,
        sessions: emptySessions(),
        settings: settings(),
        storageOk: true,
        onPendingRestore,
        onNotify,
      }),
    )

    expect(result.current.configured).toBe(true)
    expect(result.current.phase).toBe('disconnected')

    await act(async () => {
      await result.current.connect()
    })

    expect(result.current.connected).toBe(true)
    expect(result.current.phase).toBe('connected')
    expect(result.current.metadata.connectedAccountLabel).toBe('Google Drive (mock)')
  })

  it('uploads a backup and records remote metadata', async () => {
    const transport = createMemoryDriveTransport()
    const onPendingRestore = vi.fn()
    const onNotify = vi.fn()
    const { result } = renderHook(() =>
      useDriveBackup({
        transport,
        sessions: emptySessions(),
        settings: settings(),
        storageOk: true,
        onPendingRestore,
        onNotify,
      }),
    )

    await act(async () => {
      await result.current.connect()
      await result.current.backupNow()
    })

    expect(result.current.metadata.remoteFileId).toBe('drive-file-1')
    expect(result.current.metadata.lastBackupAt).not.toBeNull()
    expect(onNotify).toHaveBeenCalledWith('Google Drive backup saved')
  })

  it('replaces only its own snapshot and preserves another device backup', async () => {
    saveSyncStorage(createDefaultSyncStorage('device-hook'))
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const foreignContent = JSON.stringify(
      createBackup(
        sessionsWithSolve('foreign'),
        DEFAULT_SETTINGS,
        new Date('2026-01-01T00:00:00.000Z'),
        {
          ...createSyncEnvelope('other-device', 1, [], []),
          updatedAt: 100,
        },
      ),
    )
    await transport.uploadDeviceBackup!(foreignContent, 'other-device')

    const onPendingRestore = vi.fn()
    const onNotify = vi.fn()
    const { result } = renderHook(() =>
      useDriveBackup({
        transport,
        sessions: sessionsWithSolve('local'),
        settings: settings(),
        storageOk: true,
        onPendingRestore,
        onNotify,
      }),
    )

    await act(async () => {
      await result.current.connect()
      await result.current.backupNow()
    })

    const files = await transport.listBackups!()
    expect(files.map((file) => file.name).sort()).toEqual(
      [
        deviceBackupFileName('device-hook'),
        deviceBackupFileName('other-device'),
      ].sort(),
    )
    const own = files.find(
      (file) => file.name === deviceBackupFileName('device-hook'),
    )
    const foreign = files.find(
      (file) => file.name === deviceBackupFileName('other-device'),
    )
    expect(own).toBeDefined()
    expect(foreign).toBeDefined()
    expect(result.current.metadata.remoteFileId).toBe(own!.id)
    expect(await transport.downloadBackup(own!.id)).toContain('"local"')
    expect(await transport.downloadBackup(foreign!.id)).toBe(foreignContent)
  })

  it('restores one merged view from every device snapshot', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    await transport.uploadDeviceBackup!(
      JSON.stringify(
        createBackup(
          sessionsWithSolve('A'),
          { ...DEFAULT_SETTINGS, accentColor: 'green' },
          new Date('2026-01-01T00:00:00.000Z'),
          {
            ...createSyncEnvelope('device-a', 1, [], [], [], {
              accentColor: { updatedAt: 100, editorId: 'device-a' },
            }),
            updatedAt: 100,
          },
        ),
      ),
      'device-a',
    )
    await transport.uploadDeviceBackup!(
      JSON.stringify(
        createBackup(
          sessionsWithSolve('B'),
          { ...DEFAULT_SETTINGS, accentColor: 'blue' },
          new Date('2026-01-02T00:00:00.000Z'),
          {
            ...createSyncEnvelope('device-b', 1, [], [], [], {
              accentColor: { updatedAt: 200, editorId: 'device-b' },
            }),
            updatedAt: 200,
          },
        ),
      ),
      'device-b',
    )

    const onPendingRestore = vi.fn()
    const { result } = renderHook(() =>
      useDriveBackup({
        transport,
        sessions: emptySessions(),
        settings: settings(),
        storageOk: true,
        onPendingRestore,
        onNotify: vi.fn(),
      }),
    )

    await act(async () => {
      await result.current.connect()
      await result.current.restoreFromDrive()
    })

    expect(onPendingRestore).toHaveBeenCalledTimes(1)
    const restored = onPendingRestore.mock.calls[0]![0] as ReturnType<typeof createBackup>
    expect(
      restored.sessions.sessions
        .flatMap((session) => session.solves.map((solve) => solve.id))
        .sort(),
    ).toEqual(['A', 'B'])
    expect(restored.settings.accentColor).toBe('blue')
  })

  it('deletes every device snapshot and the legacy file', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    await transport.uploadDeviceBackup!(
      JSON.stringify(createBackup(sessionsWithSolve('A'), DEFAULT_SETTINGS)),
      'device-a',
    )
    await transport.uploadDeviceBackup!(
      JSON.stringify(createBackup(sessionsWithSolve('B'), DEFAULT_SETTINGS)),
      'device-b',
    )
    await transport.uploadBackup(
      JSON.stringify(createBackup(sessionsWithSolve('legacy'), DEFAULT_SETTINGS)),
      null,
    )

    const onNotify = vi.fn()
    const { result } = renderHook(() =>
      useDriveBackup({
        transport,
        sessions: emptySessions(),
        settings: settings(),
        storageOk: true,
        onPendingRestore: vi.fn(),
        onNotify,
      }),
    )

    await act(async () => {
      await result.current.connect()
      await result.current.deleteRemoteBackup()
    })

    await expect(transport.listBackups!()).resolves.toHaveLength(0)
    expect(result.current.metadata.remoteFileId).toBeNull()
    expect(result.current.phase).toBe('connected')
    expect(onNotify).toHaveBeenCalledWith('Google Drive backup deleted')
  })

  it('reports partial deletion failures instead of claiming success', async () => {
    const memory = createMemoryDriveTransport()
    await memory.connect()
    await memory.uploadDeviceBackup!(
      JSON.stringify(createBackup(sessionsWithSolve('A'), DEFAULT_SETTINGS)),
      'device-a',
    )
    await memory.uploadDeviceBackup!(
      JSON.stringify(createBackup(sessionsWithSolve('B'), DEFAULT_SETTINGS)),
      'device-b',
    )
    const files = await memory.listBackups!()
    const refused = files[0]!
    const transport: DriveTransport = {
      ...memory,
      deleteBackup: async (fileId) => {
        if (fileId === refused.id) throw new Error('permission denied')
        return memory.deleteBackup(fileId)
      },
    }

    const onNotify = vi.fn()
    const { result } = renderHook(() =>
      useDriveBackup({
        transport,
        sessions: emptySessions(),
        settings: settings(),
        storageOk: true,
        onPendingRestore: vi.fn(),
        onNotify,
      }),
    )

    await act(async () => {
      await result.current.connect()
      await result.current.deleteRemoteBackup()
    })

    expect(result.current.phase).toBe('error')
    expect(result.current.error).toContain('could not be removed')
    expect(onNotify).not.toHaveBeenCalledWith('Google Drive backup deleted')
  })

  it('rejects an invalid remote backup', async () => {
    const transport = createMemoryDriveTransport()
    const onPendingRestore = vi.fn()
    const onNotify = vi.fn()
    const { result } = renderHook(() =>
      useDriveBackup({
        transport,
        sessions: emptySessions(),
        settings: settings(),
        storageOk: true,
        onPendingRestore,
        onNotify,
      }),
    )

    await act(async () => {
      await result.current.connect()
      await result.current.backupNow()
    })

    ;(transport as { __corruptRemote?: () => void }).__corruptRemote?.()

    await act(async () => {
      await result.current.restoreFromDrive()
    })

    expect(result.current.error).toContain('valid JSON')
    expect(onPendingRestore).not.toHaveBeenCalled()
  })

  it('aborts a backup when its own snapshot changed after discovery', async () => {
    saveSyncStorage(createDefaultSyncStorage('device-hook'))
    const memory = createMemoryDriveTransport()
    await memory.connect()
    await memory.uploadDeviceBackup!(
      JSON.stringify(
        createBackup(
          sessionsWithSolve('local'),
          DEFAULT_SETTINGS,
          new Date('2026-01-01T00:00:00.000Z'),
          { ...createSyncEnvelope('device-hook', 1, [], []), updatedAt: 100 },
        ),
      ),
      'device-hook',
    )
    const foreignContent = JSON.stringify(
      createBackup(
        sessionsWithSolve('foreign'),
        DEFAULT_SETTINGS,
        new Date('2026-01-02T00:00:00.000Z'),
        { ...createSyncEnvelope('device-hook', 2, [], []), updatedAt: 200 },
      ),
    )
    let listCalls = 0
    let uploads = 0
    const transport: DriveTransport = {
      ...memory,
      listBackups: async () => {
        const files = await memory.listBackups!()
        listCalls += 1
        if (listCalls === 2) {
          // Another writer replaces this device's snapshot after backupNow's
          // discovery read but before the locked pre-write recheck.
          await memory.uploadDeviceBackup!(foreignContent, 'device-hook')
        }
        return files
      },
      uploadDeviceBackup: async (content, deviceId, existingFileId) => {
        uploads += 1
        return memory.uploadDeviceBackup!(content, deviceId, existingFileId)
      },
    }
    const onNotify = vi.fn()
    const { result } = renderHook(() =>
      useDriveBackup({
        transport,
        sessions: sessionsWithSolve('local'),
        settings: settings(),
        storageOk: true,
        onPendingRestore: vi.fn(),
        onNotify,
      }),
    )

    await act(async () => {
      await result.current.connect()
    })
    await act(async () => {
      await result.current.backupNow()
    })

    expect(uploads).toBe(0)
    expect(result.current.phase).toBe('error')
    expect(result.current.error).toContain(
      "Another CubeLab tab changed this device's Google Drive snapshot",
    )
    expect(onNotify).not.toHaveBeenCalledWith('Google Drive backup saved')
    const files = await memory.listBackups!()
    const own = files.find(
      (file) => file.name === deviceBackupFileName('device-hook'),
    )
    expect(await memory.downloadBackup(own!.id)).toBe(foreignContent)
  })

  it('restores through confirmation after a remote change', async () => {
    const transport = createMemoryDriveTransport()
    const onPendingRestore = vi.fn()
    const onNotify = vi.fn()
    const initial = emptySessions()
    const changed = emptySessions()
    const changedSession = changed.sessions[0]
    if (!changedSession) throw new Error('missing session')
    changedSession.solves.push({
      id: 'solve-1',
      event: '333',
      rawMs: 10_000,
      penalty: 'none',
      scramble: "R U R' U'",
      comment: '',
      createdAt: 1_700_000_000_000,
    } as Solve)

    const { result, rerender } = renderHook(
      ({ sessions }: { sessions: ReturnType<typeof emptySessions> }) =>
        useDriveBackup({
          transport,
          sessions,
          settings: settings(),
          storageOk: true,
          onPendingRestore,
          onNotify,
        }),
      { initialProps: { sessions: initial } },
    )

    await act(async () => {
      await result.current.connect()
      await result.current.backupNow()
    })

    rerender({ sessions: changed })

    await act(async () => {
      await result.current.restoreFromDrive()
    })

    expect(onPendingRestore).toHaveBeenCalledTimes(1)
  })
})
