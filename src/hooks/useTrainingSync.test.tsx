import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import type { TimerState } from '../timer/machine'
import { TrainingController } from '../lib/training/controller'
import {
  TRAINING_STORAGE_KEY,
  createEmptyTrainingData,
} from '../lib/training/storage'
import {
  closedTrainingHistory,
  NOW,
  setup,
} from '../lib/training/persistenceFixtures.test-support'
import {
  appendTrainingAttempt,
  createTrainingAttempt,
  createTrainingVisit,
  finishTrainingVisit,
} from '../lib/training/records'
import type { TrainingData } from '../lib/training/types'
import {
  createMemoryDriveTransport,
  type DriveTransport,
} from '../lib/driveTransport'
import {
  createTrainingDriveBackup,
  serializeTrainingDriveBackup,
} from '../lib/trainingDrive'
import { createTrainingSyncEnvelope } from '../lib/trainingSync'
import {
  TRAINING_SYNC_STORAGE_KEY,
  loadTrainingSyncStorage,
  resetTrainingDeviceIdCacheForTests,
} from '../lib/trainingSyncStorage'
import { useTrainingSync } from './useTrainingSync'
import { SYNC_STORAGE_KEY } from '../lib/syncStorage'
import { beginReplacement } from '../lib/replacement'

function idleTimer(): MutableRefObject<TimerState['status']> {
  return { current: 'idle' }
}

function renderTrainingSync(
  transport: DriveTransport | null,
  options: {
    controller?: TrainingController
    timer?: MutableRefObject<TimerState['status']>
    blockedReason?: () => string | null
  } = {},
) {
  const controller = options.controller ?? new TrainingController()
  const rendered = renderHook(
    (props: { state: ReturnType<TrainingController['getSnapshot']> }) =>
      useTrainingSync({
        transport,
        controller,
        trainingState: props.state,
        timerStatusRef: options.timer ?? idleTimer(),
        blockedReason: options.blockedReason,
        onNotify: () => undefined,
      }),
    { initialProps: { state: controller.getSnapshot() } },
  )
  return {
    controller,
    ...rendered,
    refresh: () => rendered.rerender({ state: controller.getSnapshot() }),
  }
}

async function seedRemote(
  transport: DriveTransport,
  data: TrainingData,
  options: {
    deviceId?: string
    revision?: number
    tombstones?: Parameters<typeof createTrainingSyncEnvelope>[0]['tombstones']
    fieldUpdates?: Parameters<typeof createTrainingSyncEnvelope>[0]['fieldUpdates']
    conflicts?: Parameters<typeof createTrainingSyncEnvelope>[0]['conflicts']
  } = {},
) {
  const deviceId = options.deviceId ?? 'remote-device'
  const envelope = createTrainingSyncEnvelope({
    deviceId,
    revision: options.revision ?? 1,
    tombstones: options.tombstones ?? [],
    fieldUpdates: options.fieldUpdates ?? {},
    conflicts: options.conflicts ?? [],
    updatedAt: NOW,
  })
  const backup = {
    ...createTrainingDriveBackup(data, deviceId, NOW),
    sync: envelope,
  }
  const serialized = serializeTrainingDriveBackup(backup)
  if (!serialized.ok) throw new Error(serialized.error)
  const file = await transport.uploadTrainingBackup!(serialized.raw, deviceId)
  return { file, raw: serialized.raw }
}

function clearRemote(transport: DriveTransport) {
  return transport.__peekRemote?.() ?? []
}

async function latestTrainingContent(transport: DriveTransport): Promise<string> {
  const files = await transport.listTrainingBackups!()
  return transport.downloadBackup(files[0]!.id)
}

function deletableHistory(): TrainingData {
  const visit = createTrainingVisit('oll:execution', NOW, 'legacy-visit')
  let data: TrainingData = {
    ...createEmptyTrainingData(),
    visits: [visit],
    activeVisitId: visit.id,
  }
  data = appendTrainingAttempt(
    data,
    createTrainingAttempt({
      id: 'deletable-attempt',
      setup: setup('oll', 'execution'),
      visitId: visit.id,
      rawMs: 1_000,
      createdAt: NOW + 1_000,
    }),
  )
  return finishTrainingVisit(data, visit.id, NOW + 2_000, 'navigation')
}

describe('useTrainingSync', () => {
  beforeEach(() => {
    localStorage.clear()
    resetTrainingDeviceIdCacheForTests()
  })

  it('is independently disabled and never calls Drive until enabled', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(closedTrainingHistory()))
    const { result } = renderTrainingSync(transport)

    expect(result.current.enabled).toBe(false)
    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(false)
    })
    expect(await transport.listTrainingBackups!()).toHaveLength(0)

    act(() => {
      result.current.updatePreferences({ enabled: true, syncOnStartup: false })
    })
    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(true)
    })
    expect(await transport.listTrainingBackups!()).toHaveLength(1)

    act(() => {
      result.current.updatePreferences({ enabled: false })
    })
    expect(result.current.enabled).toBe(false)
    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(false)
    })
    expect(await transport.listTrainingBackups!()).toHaveLength(1)
  })

  it('uploads immutable revisions and skips an unchanged publish', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(closedTrainingHistory()))
    const { result, controller, refresh } = renderTrainingSync(transport)
    act(() => {
      result.current.updatePreferences({ enabled: true, syncOnStartup: false })
    })
    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(true)
    })
    const first = await transport.listTrainingBackups!()
    expect(first).toHaveLength(1)

    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(true)
    })
    expect(await transport.listTrainingBackups!()).toHaveLength(1)

    controller.savePreset('Saved preset')
    refresh()
    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(true)
    })
    const files = await transport.listTrainingBackups!()
    expect(files).toHaveLength(2)
    const parsed = JSON.parse(await transport.downloadBackup(files[0]!.id)) as {
      sync: { revision: number; deviceId: string }
    }
    expect(parsed.sync.revision).toBe(2)
    expect(parsed.sync.deviceId).toBe(loadTrainingSyncStorage().runtime.deviceId)
  })

  it('retries after a failed upload without changing local Training', async () => {
    const memory = createMemoryDriveTransport()
    await memory.connect()
    let fail = true
    const transport: DriveTransport = {
      ...memory,
      uploadTrainingBackup: async (content, deviceId) => {
        if (fail) throw new Error('network down')
        return memory.uploadTrainingBackup!(content, deviceId)
      },
    }
    const local = closedTrainingHistory()
    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(local))
    const { result } = renderTrainingSync(transport)
    act(() => {
      result.current.updatePreferences({ enabled: true, syncOnStartup: false })
    })
    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(false)
    })
    expect(localStorage.getItem(TRAINING_STORAGE_KEY)).toBe(JSON.stringify(local))
    expect(result.current.status).toBe('failed')
    fail = false
    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(true)
    })
    expect(await memory.listTrainingBackups!()).toHaveLength(1)
    expect(result.current.status).toBe('synced')
  })

  it('does not show enabled when the preference write fails', () => {
    const transport = createMemoryDriveTransport()
    const { result } = renderTrainingSync(transport)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setItem.mockImplementation(function (this: Storage, key, value) {
      if (key === TRAINING_SYNC_STORAGE_KEY) throw new Error('quota')
      return Storage.prototype.setItem.call(this, key, value)
    })
    act(() => {
      expect(result.current.updatePreferences({ enabled: true })).toBe(false)
    })
    setItem.mockRestore()
    expect(result.current.enabled).toBe(false)
  })

  it('does not overwrite a deletion made while an upload is in flight', async () => {
    const memory = createMemoryDriveTransport()
    await memory.connect()
    let releaseUpload: (() => void) | null = null
    let markStarted: (() => void) | null = null
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve
    })
    const uploadStarted = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const transport: DriveTransport = {
      ...memory,
      uploadTrainingBackup: async (content, deviceId) => {
        markStarted?.()
        await uploadGate
        return memory.uploadTrainingBackup!(content, deviceId)
      },
    }
    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(deletableHistory()))
    const { result, controller } = renderTrainingSync(transport)
    act(() => {
      result.current.updatePreferences({ enabled: true, syncOnStartup: false })
    })

    let sync: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      sync = result.current.syncNow('manual')
      await uploadStarted
    })
    expect(controller.deleteAttempt('deletable-attempt')).toBe(true)
    releaseUpload!()
    await act(async () => {
      expect(await sync).toBe(false)
    })

    const tombstones = loadTrainingSyncStorage().runtime.tombstones
    expect(tombstones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'attempt', id: 'deletable-attempt' }),
      ]),
    )
    expect(result.current.status).toBe('pending')
    // Let the single automatic retry finish so it cannot leak into the next test.
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  it('blocks active Training, a pending save and a running timer', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()

    const open = createEmptyTrainingData()
    localStorage.setItem(
      TRAINING_STORAGE_KEY,
      JSON.stringify({
        ...open,
        activeVisitId: 'open',
        visits: [
          {
            version: 1,
            id: 'open',
            startedAt: NOW,
            endedAt: null,
            startedCategoryId: 'oll:execution',
            categoryIds: ['oll:execution'],
            attemptIds: [],
            summaryId: null,
          },
        ],
      }),
    )
    const active = renderTrainingSync(transport)
    act(() => {
      active.result.current.updatePreferences({ enabled: true, syncOnStartup: false })
    })
    await act(async () => {
      expect(await active.result.current.syncNow('manual')).toBe(false)
    })
    expect(await transport.listTrainingBackups!()).toHaveLength(0)

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
    const pending = renderTrainingSync(transport, { controller: pendingController })
    act(() => {
      pending.result.current.updatePreferences({ enabled: true, syncOnStartup: false })
    })
    await act(async () => {
      expect(await pending.result.current.syncNow('manual')).toBe(false)
    })
    expect(await transport.listTrainingBackups!()).toHaveLength(0)

    const timer = { current: 'running' as const }
    const running = renderTrainingSync(transport, { timer })
    act(() => {
      running.result.current.updatePreferences({ enabled: true, syncOnStartup: false })
    })
    await act(async () => {
      expect(await running.result.current.syncNow('manual')).toBe(false)
    })
    expect(await transport.listTrainingBackups!()).toHaveLength(0)
  })

  it('records Training deletions and Undo so stale snapshots cannot resurrect rows', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(deletableHistory()))
    const { result, controller, refresh } = renderTrainingSync(transport)
    act(() => {
      result.current.updatePreferences({ enabled: true, syncOnStartup: false })
    })
    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(true)
    })
    let token: Parameters<NonNullable<TrainingController['undoDeleteAttempt']>>[0] | null = null
    expect(
      controller.deleteAttempt('deletable-attempt', (deleted) => {
        token = deleted
      }),
    ).toBe(true)
    refresh()
    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(true)
    })
    const afterDelete = JSON.parse(
      await latestTrainingContent(transport),
    ) as { training: { data: TrainingData }; sync: ReturnType<typeof createTrainingSyncEnvelope> }
    expect(afterDelete.training.data.attempts).toHaveLength(0)
    expect(
      afterDelete.sync.tombstones.some(
        (tombstone) => tombstone.kind === 'attempt' && tombstone.restoredAt === undefined,
      ),
    ).toBe(true)

    expect(token).not.toBeNull()
    expect(controller.undoDeleteAttempt(token!)).toBe(true)
    refresh()
    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(true)
    })
    const afterUndo = JSON.parse(
      await latestTrainingContent(transport),
    ) as { training: { data: TrainingData }; sync: ReturnType<typeof createTrainingSyncEnvelope> }
    expect(afterUndo.training.data.attempts).toHaveLength(1)
    expect(
      afterUndo.sync.tombstones.find(
        (tombstone) => tombstone.kind === 'attempt',
      )?.restoredAt,
    ).toBeGreaterThan(0)
  })

  it('requires exact conflict approval and adopts the chosen remote record', async () => {
    const remoteTransport = createMemoryDriveTransport()
    await remoteTransport.connect()
    const local = deletableHistory()
    const remote: TrainingData = {
      ...local,
      attempts: local.attempts.map((attempt) => ({
        ...attempt,
        result: { status: 'valid', penalty: 'dnf' },
        resultCorrectedAt: NOW + 5_000,
      })),
    }
    await seedRemote(remoteTransport, remote, { revision: 1 })
    const remoteFiles = await remoteTransport.listTrainingBackups!()
    const remoteRaw = await remoteTransport.downloadBackup(remoteFiles[0]!.id)

    const transport = createMemoryDriveTransport()
    await transport.connect()
    // Move only the Training file into this device's transport.
    await transport.uploadTrainingBackup!(remoteRaw, 'remote-device')

    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(local))
    const localRaw = localStorage.getItem(TRAINING_STORAGE_KEY)
    const { result } = renderTrainingSync(transport)
    act(() => {
      result.current.updatePreferences({
        enabled: true,
        syncOnStartup: false,
        manualConflictReview: true,
      })
    })
    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(false)
    })
    expect(result.current.pendingConflicts).toHaveLength(1)
    expect(localStorage.getItem(TRAINING_STORAGE_KEY)).toBe(localRaw)

    const conflict = result.current.pendingConflicts[0]!
    act(() => {
      expect(
        result.current.resolveConflict(
          conflict.id,
          conflict.field,
          conflict.kind,
          'remote',
        ),
      ).toEqual({ ok: true })
    })
    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(true)
    })
    const stored = JSON.parse(
      localStorage.getItem(TRAINING_STORAGE_KEY)!,
    ) as TrainingData
    expect(stored.attempts[0]!.result).toMatchObject({ penalty: 'dnf' })
  })

  it('accepts a Phase 1 file without sync metadata as a base snapshot', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const phase1 = serializeTrainingDriveBackup(
      createTrainingDriveBackup(closedTrainingHistory(), 'phase1-device', NOW),
    )
    if (!phase1.ok) throw new Error(phase1.error)
    await transport.uploadTrainingBackup!(phase1.raw, 'phase1-device')
    const { result } = renderTrainingSync(transport)
    act(() => {
      result.current.updatePreferences({ enabled: true, syncOnStartup: false })
    })
    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(true)
    })
    const stored = JSON.parse(
      localStorage.getItem(TRAINING_STORAGE_KEY)!,
    ) as TrainingData
    expect(stored.attempts).toHaveLength(1)
    expect(loadTrainingSyncStorage().runtime.lastRemoteRevision).toBe(0)
  })

  it('skips an invalid remote snapshot, keeps local Training and warns', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const invalid = JSON.stringify({
      app: 'CubeLab',
      format: 'cubelab-training-backup',
      version: 1,
      deviceId: 'remote-device',
      exportedAt: new Date(NOW).toISOString(),
      training: { version: 1, data: { version: 1 } },
    })
    await transport.uploadTrainingBackup!(invalid, 'remote-device')
    const local = closedTrainingHistory()
    const raw = JSON.stringify(local)
    localStorage.setItem(TRAINING_STORAGE_KEY, raw)
    const { result } = renderTrainingSync(transport)
    act(() => {
      result.current.updatePreferences({ enabled: true, syncOnStartup: false })
    })
    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(true)
    })
    expect(localStorage.getItem(TRAINING_STORAGE_KEY)).toBe(raw)
    expect(result.current.status).toBe('synced')
    expect(result.current.snapshotsError).toContain('skipped')
    expect(await transport.listTrainingBackups!()).toHaveLength(2)
  })

  it('cleans only Training files and preserves solve snapshots', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    await transport.uploadDeviceBackup!('{"solve":true}', 'solve-device')
    for (let index = 0; index < 5; index += 1) {
      await transport.uploadTrainingBackup!(
        JSON.stringify({ app: 'CubeLab', index }),
        'training-device',
      )
    }
    const { result } = renderTrainingSync(transport)
    act(() => {
      result.current.updatePreferences({
        enabled: false,
        snapshotKeepPerDevice: 3,
        snapshotMaxAgeDays: 365,
      })
    })
    await act(async () => {
      expect(await result.current.cleanupSnapshots()).toBe(true)
    })
    expect(await transport.listTrainingBackups!()).toHaveLength(3)
    expect(await transport.listBackups!()).toHaveLength(1)
  })


  it('blocks while a replacement journal is prepared or the app reports a native import', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(closedTrainingHistory()))
    const begun = beginReplacement('native-import', ['sessions'])
    expect(begun.ok).toBe(true)
    const journalBlocked = renderTrainingSync(transport)
    act(() => {
      journalBlocked.result.current.updatePreferences({
        enabled: true,
        syncOnStartup: false,
      })
    })
    await act(async () => {
      expect(await journalBlocked.result.current.syncNow('manual')).toBe(false)
    })
    expect(await transport.listTrainingBackups!()).toHaveLength(0)

    localStorage.removeItem('cubelab:replacement:v1')
    const appBlocked = renderTrainingSync(transport, {
      blockedReason: () => 'A native import is pending.',
    })
    act(() => {
      appBlocked.result.current.updatePreferences({
        enabled: true,
        syncOnStartup: false,
      })
    })
    await act(async () => {
      expect(await appBlocked.result.current.syncNow('manual')).toBe(false)
    })
    expect(await transport.listTrainingBackups!()).toHaveLength(0)
  })

  it('never touches solve sync storage', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const solveRaw = '{"solve":"state"}'
    localStorage.setItem(SYNC_STORAGE_KEY, solveRaw)
    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(closedTrainingHistory()))
    const { result } = renderTrainingSync(transport)
    act(() => {
      result.current.updatePreferences({ enabled: true, syncOnStartup: false })
    })
    await act(async () => {
      expect(await result.current.syncNow('manual')).toBe(true)
    })
    expect(localStorage.getItem(SYNC_STORAGE_KEY)).toBe(solveRaw)
    expect(localStorage.getItem(TRAINING_SYNC_STORAGE_KEY)).not.toBeNull()
    expect(clearRemote(transport).some((file) => file.name.startsWith('cubelab-backup'))).toBe(false)
  })
})
