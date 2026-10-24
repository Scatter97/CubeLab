import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Settings, Solve } from '../types'
import { DEFAULT_SETTINGS } from '../lib/storage'
import { createMemoryDriveTransport } from '../lib/driveTransport'
import { DEFAULT_SESSION_NAME } from '../lib/sessions'
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
