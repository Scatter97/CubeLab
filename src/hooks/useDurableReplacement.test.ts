import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type { SessionsData, Settings } from '../types'
import type { UseSyncResult } from './useSync'
import { useDurableReplacement } from './useDurableReplacement'
import {
  DEFAULT_SETTINGS,
  loadSessions,
  loadSettings,
  saveSessions,
  saveSettings,
} from '../lib/storage'
import {
  DEFAULT_DRIVE_STATE,
  loadDriveBackupState,
  saveDriveBackupState,
} from '../lib/driveStorage'
import {
  createDefaultSyncStorage,
  loadSyncStorage,
  saveSyncStorage,
} from '../lib/syncStorage'
import { createResetBaseSyncStorage } from '../lib/syncBase'
import { addPendingSolveRestore, createPendingSolveRestore } from '../lib/solveRecovery'
import {
  applyPendingCompletionAtStartup,
  loadPendingCompletion,
  recordPendingCompletion,
} from '../lib/pendingCompletion'
import type { TimerState } from '../timer/machine'

function sessions(name: string): SessionsData {
  return {
    activeSessionId: 'session-1',
    sessions: [
      {
        id: 'session-1',
        name,
        event: '333',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        solves: [],
      },
    ],
  }
}

function followerSessions(name: string): SessionsData {
  const base = sessions(name)
  return {
    ...base,
    sessions: [
      {
        ...base.sessions[0]!,
        solves: [
          {
            id: 'buffered-A',
            event: '333',
            rawMs: 12_345,
            penalty: 'none',
            scramble: "R U R' U'",
            comment: 'Follower completion',
            createdAt: 1_700_000_000_001,
          },
        ],
      },
    ],
  }
}

function setup(options: {
  onNotify?: (message: string) => void
  onSuccess?: () => void
  onAdopt?: UseSyncResult['adoptCommittedReplacement']
  stageSessions?: (data: SessionsData) => boolean
  replaceSessions?: (data: SessionsData) => void
} = {}) {
  const onNotify = options.onNotify ?? vi.fn()
  const sync = {
    isSyncRunning: () => false,
    adoptCommittedReplacement:
      options.onAdopt ?? (vi.fn() as UseSyncResult['adoptCommittedReplacement']),
  } as unknown as UseSyncResult
  const timerStatusRef = { current: 'idle' } as MutableRefObject<
    TimerState['status']
  >
  const hook = renderHook(() =>
    useDurableReplacement({
      sync,
      timerStatusRef,
      settings: DEFAULT_SETTINGS,
      stageSessions: options.stageSessions ?? ((data) => saveSessions(data)),
      stageSettings: (settings) => saveSettings(settings),
      replaceSessions: options.replaceSessions ?? vi.fn(),
      replaceSettings: vi.fn(),
      onNotify,
    }),
  )
  return { ...hook, onNotify, onSuccess: options.onSuccess, sync }
}

describe('useDurableReplacement', () => {
  beforeEach(() => {
    localStorage.clear()
    saveSessions(sessions('Previous'))
    saveSettings(DEFAULT_SETTINGS)
    saveSyncStorage(createDefaultSyncStorage('device-test'))
    saveDriveBackupState({ ...DEFAULT_DRIVE_STATE })
  })

  it('stages a Drive restore and commits its drive status before publishing', async () => {
    const onSuccess = vi.fn()
    const { result, onNotify, sync } = setup({ onSuccess })
    const nextSettings: Settings = { ...DEFAULT_SETTINGS, theme: 'dark' }
    const nextData = sessions('Restored')
    const nextDrive = { ...DEFAULT_DRIVE_STATE, lastRestoreAt: 123_456 }
    const nextSync = createResetBaseSyncStorage(
      loadSyncStorage(),
      nextData,
      200_000,
    )

    let committed = false
    await act(async () => {
      committed = await result.current({
        kind: 'drive-restore',
        sessionsData: nextData,
        settingsData: nextSettings,
        syncStorage: nextSync,
        driveState: nextDrive,
        successMessage: 'Restored',
        failurePrefix: 'Restore blocked',
        onSuccess,
      })
    })

    expect(committed).toBe(true)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onNotify).toHaveBeenCalledWith('Restored')
    expect(sync.adoptCommittedReplacement).toHaveBeenCalledWith(
      nextSync,
      nextData,
      nextSettings,
    )
    expect(loadSessions().sessions[0]?.name).toBe('Restored')
    expect(loadSettings().theme).toBe('dark')
    expect(loadDriveBackupState().lastRestoreAt).toBe(123_456)
    expect(localStorage.getItem('cubelab:replacement:v1')).toBeNull()
  })

  it('merges and acknowledges a follower completion in the committed replacement', async () => {
    const previous = sessions('Previous')
    saveSessions(previous)
    expect(
      recordPendingCompletion(previous, followerSessions('Previous')),
    ).toBe(true)
    const candidate = sessions('Imported')
    const nextSync = createResetBaseSyncStorage(
      loadSyncStorage(),
      candidate,
      200_000,
    )
    const replaceSessions = vi.fn()
    const { result, onNotify, sync } = setup({ replaceSessions })

    let committed = false
    await act(async () => {
      committed = await result.current({
        kind: 'native-import',
        sessionsData: candidate,
        settingsData: DEFAULT_SETTINGS,
        syncStorage: nextSync,
        successMessage: 'Imported',
        failurePrefix: 'Import blocked',
        onSuccess: vi.fn(),
      })
    })

    expect(committed).toBe(true)
    expect(onNotify).toHaveBeenCalledWith('Imported')
    const durable = loadSessions()
    expect(durable.sessions[0]?.name).toBe('Imported')
    expect(durable.sessions[0]?.solves).toEqual([
      expect.objectContaining({
        id: 'buffered-A',
        event: '333',
        rawMs: 12_345,
        comment: 'Follower completion',
      }),
    ])
    expect(loadPendingCompletion().status).toBe('none')
    expect(loadSyncStorage().runtime.solveCountAtLastSync).toBe(1)
    expect(sync.adoptCommittedReplacement).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({ solveCountAtLastSync: 1 }),
      }),
      expect.objectContaining({
        sessions: [
          expect.objectContaining({
            solves: [expect.objectContaining({ id: 'buffered-A' })],
          }),
        ],
      }),
      DEFAULT_SETTINGS,
    )
    expect(replaceSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: [
          expect.objectContaining({
            solves: [expect.objectContaining({ id: 'buffered-A' })],
          }),
        ],
      }),
    )
  })

  it('preserves a completion appended after the replacement snapshot for reload replay', async () => {
    const previous = sessions('Previous')
    saveSessions(previous)
    let appended = false
    const { result } = setup({
      stageSessions: (data) => {
        const saved = saveSessions(data)
        if (!appended) {
          appended = true
          recordPendingCompletion(previous, followerSessions('Previous'))
        }
        return saved
      },
    })
    const candidate = sessions('Imported')
    const nextSync = createResetBaseSyncStorage(
      loadSyncStorage(),
      candidate,
      200_000,
    )

    let committed = false
    await act(async () => {
      committed = await result.current({
        kind: 'native-import',
        sessionsData: candidate,
        settingsData: DEFAULT_SETTINGS,
        syncStorage: nextSync,
        successMessage: 'Imported',
        failurePrefix: 'Import blocked',
        onSuccess: vi.fn(),
      })
    })

    expect(committed).toBe(true)
    expect(loadSessions().sessions[0]?.solves).toEqual([])
    const pending = loadPendingCompletion()
    expect(pending.status).toBe('ok')
    if (pending.status !== 'ok') return
    expect(
      pending.completion.entries.flatMap((entry) =>
        entry.solves.map((solve) => solve.id),
      ),
    ).toEqual(['buffered-A'])

    expect(applyPendingCompletionAtStartup()).toEqual({ ok: true })
    expect(loadSessions().sessions[0]?.solves).toEqual([
      expect.objectContaining({ id: 'buffered-A', event: '333' }),
    ])
    expect(loadPendingCompletion().status).toBe('none')
  })

  it('keeps the buffer when the replacement collection cannot be saved', async () => {
    const previous = sessions('Previous')
    saveSessions(previous)
    expect(
      recordPendingCompletion(previous, followerSessions('Previous')),
    ).toBe(true)
    const { result, onNotify } = setup({
      stageSessions: () => false,
    })

    let committed = true
    await act(async () => {
      committed = await result.current({
        kind: 'native-import',
        sessionsData: sessions('Imported'),
        settingsData: DEFAULT_SETTINGS,
        syncStorage: createDefaultSyncStorage('device-test'),
        successMessage: 'Imported',
        failurePrefix: 'Import blocked',
        onSuccess: vi.fn(),
      })
    })

    expect(committed).toBe(false)
    expect(onNotify).toHaveBeenCalledWith(
      expect.stringContaining('sessions could not be saved'),
    )
    expect(loadSessions().sessions[0]?.name).toBe('Previous')
    expect(loadPendingCompletion().status).toBe('ok')
  })

  it('blocks replacement while Undo recovery is still pending', async () => {
    const pending = createPendingSolveRestore(
      {
        id: 'pending-solve',
        event: '333',
        rawMs: 10_000,
        penalty: 'none',
        scramble: "R U R' U'",
        comment: '',
        createdAt: 1_700_000_000_000,
      },
      0,
      'missing-session',
    )
    expect(addPendingSolveRestore(pending)).toBe(true)
    const { result, onNotify } = setup()

    let committed = true
    await act(async () => {
      committed = await result.current({
        kind: 'native-import',
        sessionsData: sessions('Blocked'),
        settingsData: DEFAULT_SETTINGS,
        syncStorage: createDefaultSyncStorage('device-test'),
        successMessage: 'Imported',
        failurePrefix: 'Import blocked',
        onSuccess: vi.fn(),
      })
    })

    expect(committed).toBe(false)
    expect(onNotify).toHaveBeenCalledWith(
      expect.stringContaining('pending Undo recovery'),
    )
    expect(loadSessions().sessions[0]?.name).toBe('Previous')
    expect(localStorage.getItem('cubelab:replacement:v1')).toBeNull()
  })
})
