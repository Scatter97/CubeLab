import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type { TimerState } from '../timer/machine'
import type { UseSyncResult } from './useSync'
import { TrainingController } from '../lib/training/controller'
import {
  TRAINING_STORAGE_KEY,
  createEmptyTrainingData,
} from '../lib/training/storage'
import { closedTrainingHistory } from '../lib/training/persistenceFixtures.test-support'
import {
  createMemoryDriveTransport,
  type DriveTransport,
} from '../lib/driveTransport'
import {
  createTrainingDriveBackup,
  serializeTrainingDriveBackup,
  type TrainingRemoteSnapshot,
} from '../lib/trainingDrive'
import { useTrainingDriveBackup } from './useTrainingDriveBackup'
import { resetDeviceIdCacheForTests } from '../lib/syncStorage'
import { REPLACEMENT_STORAGE_KEY } from '../lib/replacement'
import {
  TRAINING_SYNC_STORAGE_KEY,
  createDefaultTrainingSyncStorage,
  loadTrainingSyncStorage,
  resetTrainingDeviceIdCacheForTests,
} from '../lib/trainingSyncStorage'

function idleTimer(): MutableRefObject<TimerState['status']> {
  return { current: 'idle' }
}

function syncStub(running = false): UseSyncResult {
  return {
    isSyncRunning: () => running,
  } as unknown as UseSyncResult
}

function renderTrainingDrive(
  transport: DriveTransport | null,
  options: {
    controller?: TrainingController
    running?: boolean
    timer?: MutableRefObject<TimerState['status']>
    onNotify?: (message: string) => void
  } = {},
) {
  const controller = options.controller ?? new TrainingController()
  return {
    controller,
    ...renderHook(() =>
      useTrainingDriveBackup({
        transport,
        controller,
        trainingState: controller.getSnapshot(),
        sync: syncStub(options.running),
        timerStatusRef: options.timer ?? idleTimer(),
        onNotify: options.onNotify ?? vi.fn(),
      }),
    ),
  }
}

function remoteSnapshot(
  data = closedTrainingHistory(),
): TrainingRemoteSnapshot {
  const backup = createTrainingDriveBackup(data, 'remote-device', 1_800_000_000_000)
  return {
    file: {
      id: 'training-file',
      name: 'cubelab-training-remote-device-12345678.json',
      modifiedTime: '2026-11-20T00:00:00.000Z',
      size: 1_000,
      appProperties: { deviceId: 'remote-device' },
    },
    backup,
    updatedAt: Date.parse(backup.exportedAt),
  }
}

describe('useTrainingDriveBackup', () => {
  beforeEach(() => {
    localStorage.clear()
    resetDeviceIdCacheForTests()
  })

  it('uploads immutable Training-only snapshots and never lists them as solves', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const onNotify = vi.fn()
    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(closedTrainingHistory()))
    const controller = new TrainingController()
    const { result } = renderTrainingDrive(transport, { controller, onNotify })

    await act(async () => {
      expect(await result.current.upload()).toBe(true)
    })
    await act(async () => {
      expect(await result.current.upload()).toBe(true)
    })

    const trainingFiles = await transport.listTrainingBackups!()
    expect(trainingFiles).toHaveLength(2)
    expect(trainingFiles[0]!.id).not.toBe(trainingFiles[1]!.id)
    expect(await transport.listBackups!()).toHaveLength(0)
    expect(onNotify).toHaveBeenCalledWith(
      'Training history backed up to Google Drive',
    )
  })

  it('blocks an absent Training key with the no-history message', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const onNotify = vi.fn()
    const { result } = renderTrainingDrive(transport, { onNotify })
    await act(async () => {
      expect(await result.current.upload()).toBe(false)
    })
    expect(onNotify).toHaveBeenCalledWith('No Training history to back up.')
    expect(await transport.listTrainingBackups!()).toHaveLength(0)
  })

  it('blocks an active visit, a pending save, a running sync and a busy timer', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()

    const open = createEmptyTrainingData()
    localStorage.setItem(
      TRAINING_STORAGE_KEY,
      JSON.stringify({
        ...open,
        activeVisitId: 'open-visit',
        visits: [
          {
            version: 1,
            id: 'open-visit',
            startedAt: 1_800_000_000_000,
            endedAt: null,
            startedCategoryId: 'oll:execution',
            categoryIds: ['oll:execution'],
            attemptIds: [],
            summaryId: null,
          },
        ],
      }),
    )
    const activeController = new TrainingController()
    const activeNotify = vi.fn()
    const active = renderTrainingDrive(transport, {
      controller: activeController,
      onNotify: activeNotify,
    })
    await act(async () => {
      expect(await active.result.current.upload()).toBe(false)
    })
    expect(activeNotify.mock.calls[0]?.[0]).toContain('active Training session')

    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(closedTrainingHistory()))
    const pendingController = new TrainingController()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setItem.mockImplementation(function (this: Storage, key, value) {
      if (key === TRAINING_STORAGE_KEY) throw new Error('quota')
      return Storage.prototype.setItem.call(this, key, value)
    })
    pendingController.updateSettings(
      pendingController.getSnapshot().data!.preferences.domain!,
      { renewalDays: 7, renewalAttempts: 100 },
      'oll',
    )
    setItem.mockRestore()
    expect(pendingController.getSnapshot().pendingSave).toBe(true)
    const pendingNotify = vi.fn()
    const pending = renderTrainingDrive(transport, {
      controller: pendingController,
      onNotify: pendingNotify,
    })
    await act(async () => {
      expect(await pending.result.current.upload()).toBe(false)
    })
    expect(pendingNotify.mock.calls.at(-1)?.[0]).toContain('save is pending')

    const runningNotify = vi.fn()
    localStorage.clear()
    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(closedTrainingHistory()))
    const running = renderTrainingDrive(transport, {
      running: true,
      onNotify: runningNotify,
    })
    await act(async () => {
      expect(await running.result.current.upload()).toBe(false)
    })
    expect(runningNotify.mock.calls.at(-1)?.[0]).toContain('synchronization')

    const timerNotify = vi.fn()
    const timer = { current: 'running' as const }
    const timerBlocked = renderTrainingDrive(transport, {
      timer,
      onNotify: timerNotify,
    })
    await act(async () => {
      expect(await timerBlocked.result.current.upload()).toBe(false)
    })
    expect(timerNotify.mock.calls.at(-1)?.[0]).toContain('idle')
  })

  it('restores exactly the Training key and adopts the snapshot without sessions or settings', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    localStorage.setItem('cubelab:sessions:v1', '{"sentinel":"sessions"}')
    localStorage.setItem('cubelab:settings:v1', '{"sentinel":"settings"}')
    const remote = remoteSnapshot()
    const onNotify = vi.fn()
    const controller = new TrainingController()
    expect(controller.getSnapshot().data).not.toBeNull()
    const { result } = renderTrainingDrive(transport, { controller, onNotify })

    await act(async () => {
      expect(await result.current.restore(remote)).toBe(true)
    })

    const stored = localStorage.getItem(TRAINING_STORAGE_KEY)
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored!) as { attempts: unknown[] }
    expect(parsed.attempts).toHaveLength(1)
    expect(controller.getSnapshot().data?.attempts).toHaveLength(1)
    expect(localStorage.getItem('cubelab:sessions:v1')).toBe(
      '{"sentinel":"sessions"}',
    )
    expect(localStorage.getItem('cubelab:settings:v1')).toBe(
      '{"sentinel":"settings"}',
    )
    expect(localStorage.getItem(REPLACEMENT_STORAGE_KEY)).toBeNull()
    expect(onNotify).toHaveBeenCalledWith(
      'Training history restored from Google Drive',
    )
  })

  it('clears stale deletion provenance on restore but keeps the Training identity', async () => {
    resetTrainingDeviceIdCacheForTests()
    const transport = createMemoryDriveTransport()
    await transport.connect()
    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(closedTrainingHistory()))
    const ledger = createDefaultTrainingSyncStorage('training-device')
    localStorage.setItem(
      TRAINING_SYNC_STORAGE_KEY,
      JSON.stringify({
        ...ledger,
        runtime: {
          ...ledger.runtime,
          tombstones: [
            {
              kind: 'attempt',
              id: 'stale-attempt',
              visitId: 'stale-visit',
              deletedAt: 1,
              deletedByDeviceId: 'training-device',
            },
          ],
        },
      }),
    )
    const { result } = renderTrainingDrive(transport, {
      controller: new TrainingController(),
    })
    await act(async () => {
      expect(await result.current.restore(remoteSnapshot())).toBe(true)
    })
    const cleared = loadTrainingSyncStorage()
    expect(cleared.runtime.deviceId).toBe('training-device')
    expect(cleared.runtime.tombstones).toEqual([])
    expect(cleared.runtime.lastSyncedFingerprint).toBeNull()
  })

  it('blocks restore instead of overwriting a partially malformed ledger', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(closedTrainingHistory()))
    const raw = JSON.stringify({
      version: 1,
      preferences: { enabled: false },
      runtime: {
        tombstones: [
          {
            kind: 'attempt',
            id: 'valid',
            deletedAt: 1,
            deletedByDeviceId: 'device',
          },
          { kind: 'attempt', id: '' },
        ],
      },
    })
    localStorage.setItem(TRAINING_SYNC_STORAGE_KEY, raw)
    const onNotify = vi.fn()
    const { result } = renderTrainingDrive(transport, { onNotify })
    await act(async () => {
      expect(await result.current.restore(remoteSnapshot())).toBe(false)
    })
    expect(localStorage.getItem(TRAINING_SYNC_STORAGE_KEY)).toBe(raw)
    expect(onNotify.mock.calls.at(-1)?.[0]).toContain('could not be cleared')
  })

  it('rolls back only Training when the replacement write fails', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const local = closedTrainingHistory()
    const localRaw = JSON.stringify(local)
    localStorage.setItem(TRAINING_STORAGE_KEY, localRaw)
    localStorage.setItem('cubelab:sessions:v1', '{"sentinel":"sessions"}')
    const remote = remoteSnapshot({
      ...local,
      attempts: local.attempts.map((attempt) => ({
        ...attempt,
        id: 'remote-attempt',
      })),
      visits: local.visits.map((visit) => ({
        ...visit,
        attemptIds: visit.attemptIds.map(() => 'remote-attempt'),
      })),
    })
    const controller = new TrainingController()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setItem.mockImplementation(function (this: Storage, key, value) {
      if (key === TRAINING_STORAGE_KEY) throw new Error('quota')
      return Storage.prototype.setItem.call(this, key, value)
    })
    const onNotify = vi.fn()
    const { result } = renderTrainingDrive(transport, { controller, onNotify })
    await act(async () => {
      expect(await result.current.restore(remote)).toBe(false)
    })
    setItem.mockRestore()

    expect(localStorage.getItem(TRAINING_STORAGE_KEY)).toBe(localRaw)
    expect(localStorage.getItem('cubelab:sessions:v1')).toBe(
      '{"sentinel":"sessions"}',
    )
    expect(localStorage.getItem(REPLACEMENT_STORAGE_KEY)).toBeNull()
    expect(onNotify.mock.calls.at(-1)?.[0]).toContain('Nothing was replaced')
  })

  it('lists remote snapshots without downloading solve files', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const content = serializeTrainingDriveBackup(remoteSnapshot().backup)
    if (!content.ok) throw new Error(content.error)
    await transport.uploadTrainingBackup!(content.raw, 'remote-device')
    await transport.uploadDeviceBackup!(
      JSON.stringify({ app: 'CubeLab', format: 'cubelab-backup' }),
      'remote-device',
    )
    const { result } = renderTrainingDrive(transport)
    await act(async () => {
      const files = await result.current.refreshSnapshots()
      expect(files).toHaveLength(1)
    })
    expect(result.current.snapshots).toHaveLength(1)
    expect(result.current.snapshots[0]!.file.name).toContain('cubelab-training-')
  })

  it('blocks replace-only restore while Training Drive sync is enabled', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(closedTrainingHistory()))
    const syncRaw = {
      version: 1,
      preferences: { enabled: true },
      runtime: { deviceId: 'training-device' },
    }
    localStorage.setItem('cubelab:training-sync:v1', JSON.stringify(syncRaw))
    const onNotify = vi.fn()
    const { result } = renderTrainingDrive(transport, { onNotify })
    await act(async () => {
      expect(await result.current.restore(remoteSnapshot())).toBe(false)
    })
    expect(onNotify).toHaveBeenCalledWith(
      'Training restore blocked: disable Training Drive sync before using replace-only restore. Nothing was replaced.',
    )
    expect(localStorage.getItem(REPLACEMENT_STORAGE_KEY)).toBeNull()
  })
})
