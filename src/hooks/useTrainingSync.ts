import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { TimerState } from '../timer/machine'
import type { DriveFile, DriveTransport } from '../lib/driveTransport'
import { isDriveTrainingFileName } from '../lib/driveTransport'
import type { TrainingController, TrainingControllerState } from '../lib/training/controller'
import { stageTrainingSnapshot, createEmptyTrainingData } from '../lib/training/storage'
import type { TrainingData } from '../lib/training/types'
import { sameTrainingJson, mergeTrainingData, parseTrainingSyncEnvelope, trainingSyncFingerprint, createTrainingSyncEnvelope } from '../lib/trainingSync'
import {
  cleanupTrainingRemoteSnapshots,
  createTrainingDriveBackup,
  listTrainingRemoteBackups,
  parseTrainingDriveBackup,
  serializeTrainingDriveBackup,
  type TrainingRemoteSnapshot,
} from '../lib/trainingDrive'
import {
  loadTrainingSyncStorage,
  saveTrainingSyncStorage,
  trainingSyncStorageWarning,
  type TrainingSyncConflict,
  type TrainingSyncPreferences,
  type TrainingSyncStorageData,
  type TrainingTombstone,
  type TrainingFieldUpdates,
} from '../lib/trainingSyncStorage'
import { loadReplacementJournal } from '../lib/replacement'
import { loadSolveRecovery } from '../lib/solveRecovery'
import { loadPendingCompletion } from '../lib/pendingCompletion'
import { runWithDriveWriteLock } from '../lib/driveCoordination'

export interface UseTrainingSyncOptions {
  transport: DriveTransport | null
  controller: TrainingController
  trainingState: TrainingControllerState
  timerStatusRef: MutableRefObject<TimerState['status']>
  /** App-level blockers such as a pending native import or restore. */
  blockedReason?: () => string | null
  onNotify: (message: string) => void
}

class ConcurrentTrainingSyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConcurrentTrainingSyncError'
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Training synchronization failed.'
}

function concurrentChangeReason(
  controller: TrainingController,
  timerStatusRef: MutableRefObject<TimerState['status']>,
  blockedReason: (() => string | null) | undefined,
  data: TrainingData,
  startedLedger: TrainingSyncStorageData,
): string | null {
  const guard = guardReason(controller, timerStatusRef, blockedReason)
  if (guard) return guard
  if (!sameTrainingJson(controller.getSavedData(), data)) {
    return 'Local Training changed during synchronization. Run Training sync again to merge the newest state.'
  }
  const latest = loadTrainingSyncStorage()
  if (
    !sameTrainingJson(
      latest.runtime.tombstones,
      startedLedger.runtime.tombstones,
    ) ||
    !sameTrainingJson(
      latest.runtime.fieldUpdates,
      startedLedger.runtime.fieldUpdates,
    ) ||
    !sameTrainingJson(latest.runtime.conflicts, startedLedger.runtime.conflicts)
  ) {
    return 'Training deletion or conflict metadata changed during synchronization. Run it again to merge the newest state.'
  }
  return null
}

function guardReason(
  controller: TrainingController,
  timerStatusRef: MutableRefObject<TimerState['status']>,
  blockedReason?: () => string | null,
): string | null {
  if (timerStatusRef.current !== 'idle') {
    return 'Wait for the timer to return to idle.'
  }
  const state = controller.getSnapshot()
  if (state.data === null) return 'Training history is unreadable. Repair it first.'
  if (state.pendingSave)
    return 'A Training save is pending. Retry the save first.'
  if (state.needsContinuity)
    return 'Training is waiting for a resume or end decision. Resolve it first.'
  if (state.data.activeVisitId !== null)
    return 'An active Training visit is open. Finish or end it first.'
  if (state.calibration)
    return 'Finish or cancel the Training calibration draft first.'
  const journal = loadReplacementJournal()
  if (journal.status === 'invalid') return journal.message
  if (journal.status === 'ok' && journal.journal.phase === 'prepared') {
    return 'A replacement recovery record is pending.'
  }
  if (loadSolveRecovery().operations.length > 0) {
    return 'Finish the pending solve Undo recovery first.'
  }
  const completion = loadPendingCompletion()
  if (completion.status === 'invalid') return completion.message
  return blockedReason?.() ?? null
}

export function useTrainingSync({
  transport,
  controller,
  trainingState,
  timerStatusRef,
  blockedReason,
  onNotify,
}: UseTrainingSyncOptions) {
  const [storage, setStorage] = useState<TrainingSyncStorageData>(() =>
    loadTrainingSyncStorage(),
  )
  const storageRef = useRef(storage)
  const runningRef = useRef<Promise<boolean> | null>(null)
  const syncNowRef = useRef<(trigger?: string) => Promise<boolean>>(async () => false)
  const [snapshots, setSnapshots] = useState<TrainingRemoteSnapshot[]>([])
  const [snapshotsLoading, setSnapshotsLoading] = useState(false)
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null)
  const [storageWarning, setStorageWarning] = useState(() =>
    trainingSyncStorageWarning(),
  )
  const concurrentRetryRef = useRef(false)
  const adoptedPreferencesRef = useRef<string | null>(null)
  const previousPreferencesRef = useRef<string | null>(
    trainingState.data ? JSON.stringify(trainingState.data.preferences) : null,
  )
  const previousActiveVisitRef = useRef<string | null>(
    trainingState.data?.activeVisitId ?? null,
  )
  const observedDataRef = useRef(trainingState.data)

  useLayoutEffect(() => {
    storageRef.current = storage
  }, [storage])

  const persist = useCallback((next: TrainingSyncStorageData): boolean => {
    if (!saveTrainingSyncStorage(next)) {
      setStorageWarning(trainingSyncStorageWarning())
      return false
    }
    setStorage(next)
    storageRef.current = next
    setStorageWarning(trainingSyncStorageWarning())
    return true
  }, [])

  const reload = useCallback(() => {
    const next = loadTrainingSyncStorage()
    storageRef.current = next
    setStorage(next)
    setStorageWarning(trainingSyncStorageWarning())
    return next
  }, [])

  const updatePreferences = useCallback(
    (patch: Partial<TrainingSyncPreferences>): boolean => {
      const current = loadTrainingSyncStorage()
      const enabled = patch.enabled ?? current.preferences.enabled
      const next: TrainingSyncStorageData = {
        ...current,
        preferences: { ...current.preferences, ...patch },
        runtime: {
          ...current.runtime,
          lastSyncStatus: enabled
            ? current.runtime.lastSyncStatus === 'disabled'
              ? 'pending'
              : current.runtime.lastSyncStatus
            : 'disabled',
          ...(enabled ? {} : { lastError: null }),
        },
      }
      const saved = persist(next)
      if (!saved) {
        onNotify(
          'Training synchronization preferences could not be saved. The original records were kept.',
        )
      }
      return saved
    },
    [onNotify, persist],
  )

  const markStatus = useCallback(
    (
      status: TrainingSyncStorageData['runtime']['lastSyncStatus'],
      error: string | null = null,
      extra: Partial<TrainingSyncStorageData['runtime']> = {},
    ) => {
      const current = loadTrainingSyncStorage()
      persist({
        ...current,
        runtime: {
          ...current.runtime,
          lastSyncStatus: status,
          lastError: error,
          ...extra,
        },
      })
    },
    [persist],
  )

  const refreshSnapshots = useCallback(async (): Promise<TrainingRemoteSnapshot[]> => {
    if (!transport?.listTrainingBackups || !transport.uploadTrainingBackup) {
      setSnapshotsError('Training cloud synchronization is unavailable for this transport.')
      return []
    }
    setSnapshotsLoading(true)
    setSnapshotsError(null)
    try {
      if (!transport.isConnected()) await transport.connect()
      const files = await listTrainingRemoteBackups(transport)
      const loaded: TrainingRemoteSnapshot[] = []
      const skipped: string[] = []
      for (const file of files) {
        try {
          const raw = await transport.downloadBackup(file.id)
          const parsed = parseTrainingDriveBackup(raw)
          if (!parsed.ok) throw new Error(parsed.error)
          const exported = Date.parse(parsed.backup.exportedAt)
          loaded.push({
            file,
            backup: parsed.backup,
            updatedAt: Number.isFinite(exported) ? exported : 0,
          })
        } catch (error) {
          skipped.push(`${file.name}: ${toMessage(error)}`)
        }
      }
      loaded.sort(
        (left, right) =>
          right.updatedAt - left.updatedAt ||
          left.file.name.localeCompare(right.file.name) ||
          left.file.id.localeCompare(right.file.id),
      )
      setSnapshots(loaded)
      setSnapshotsError(
        skipped.length > 0
          ? `${skipped.length} Training snapshot${
              skipped.length === 1 ? ' was' : 's were'
            } skipped because it could not be read. ${skipped[0]}`
          : null,
      )
      return loaded
    } catch (caught) {
      setSnapshotsError(toMessage(caught))
      return []
    } finally {
      setSnapshotsLoading(false)
    }
  }, [transport])

  const syncNow = useCallback(
    async (trigger = 'manual'): Promise<boolean> => {
      if (runningRef.current) return runningRef.current
      const current = loadTrainingSyncStorage()
      if (!current.preferences.enabled) {
        onNotify('Enable Training Drive sync first.')
        return false
      }
      if (!transport?.listTrainingBackups || !transport.uploadTrainingBackup) {
        onNotify('Training Drive sync is unavailable for this transport.')
        return false
      }
      const reason = guardReason(controller, timerStatusRef, blockedReason)
      if (reason) {
        onNotify(`Training sync paused: ${reason}`)
        markStatus('pending', reason)
        return false
      }
      const task = (async (): Promise<boolean> => {
        const localSnapshot = controller.getBackupSnapshot()
        if (localSnapshot.status === 'blocked') {
          markStatus('pending', localSnapshot.reason)
          onNotify(`Training sync paused: ${localSnapshot.reason}`)
          return false
        }
        const localData =
          localSnapshot.status === 'ready'
            ? localSnapshot.data
            : createEmptyTrainingData()
        markStatus('syncing')
        try {
          if (!transport.isConnected()) {
            if (trigger !== 'manual') {
              markStatus('pending', 'Connect Google Drive to resume Training sync.')
              return false
            }
            await transport.connect()
          }
          const files = await listTrainingRemoteBackups(transport)
          const remoteSnapshots: Array<{
            file: DriveFile
            data: TrainingData
            tombstones: TrainingTombstone[]
            fieldUpdates: TrainingFieldUpdates
            revision: number
            fingerprint: string
          }> = []
          const skipped: string[] = []
          for (const file of files) {
            try {
              const raw = await transport.downloadBackup(file.id)
              const parsed = parseTrainingDriveBackup(raw)
              if (!parsed.ok) throw new Error(parsed.error)
              let envelope = null
              if (parsed.backup.sync !== undefined) {
                envelope = parseTrainingSyncEnvelope(parsed.backup.sync)
                if (!envelope) {
                  throw new Error('unsupported sync envelope')
                }
              }
              const tombstones = envelope?.tombstones ?? []
              const fieldUpdates = envelope?.fieldUpdates ?? {}
              remoteSnapshots.push({
                file,
                data: parsed.backup.training.data,
                tombstones,
                fieldUpdates,
                revision: envelope?.revision ?? 0,
                fingerprint: trainingSyncFingerprint(
                  parsed.backup.training.data,
                  tombstones,
                  fieldUpdates,
                ),
              })
            } catch (error) {
              skipped.push(`${file.name}: ${toMessage(error)}`)
            }
          }
          if (skipped.length > 0) {
            onNotify(
              `Training sync skipped ${skipped.length} unreadable cloud snapshot${
                skipped.length === 1 ? '' : 's'
              }. ${skipped[0]}`,
            )
          }

          let merged = localData
          let tombstones = current.runtime.tombstones
          let fieldUpdates = current.runtime.fieldUpdates
          let conflicts = current.runtime.conflicts
          const pending = new Map<string, TrainingSyncConflict>()
          let remoteRevision = current.runtime.lastRemoteRevision ?? 0
          const now = Date.now()
          for (const remote of [...remoteSnapshots].sort(
            (left, right) =>
              (left.file.modifiedTime ?? '').localeCompare(
                right.file.modifiedTime ?? '',
              ) || left.file.id.localeCompare(right.file.id),
          )) {
            const result = mergeTrainingData({
              local: merged,
              remote: remote.data,
              localTombstones: tombstones,
              remoteTombstones: remote.tombstones,
              localFieldUpdates: fieldUpdates,
              remoteFieldUpdates: remote.fieldUpdates,
              resolvedConflicts: conflicts,
              deviceId: current.runtime.deviceId,
              now,
              manualConflictReview: current.preferences.manualConflictReview,
              localStoreAbsent: localSnapshot.status === 'absent',
            })
            if (!result.ok) throw new Error(result.error)
            merged = result.merged
            tombstones = result.tombstones
            fieldUpdates = result.fieldUpdates
            conflicts = result.conflicts
            remoteRevision = Math.max(remoteRevision, remote.revision)
            for (const conflict of result.pendingConflicts) {
              pending.set(`${conflict.kind}:${conflict.id}:${conflict.field}`, conflict)
            }
          }

          const mergedFingerprint = trainingSyncFingerprint(
            merged,
            tombstones,
            fieldUpdates,
          )
          const beforePublish = concurrentChangeReason(
            controller,
            timerStatusRef,
            blockedReason,
            localData,
            current,
          )
          if (beforePublish) throw new ConcurrentTrainingSyncError(beforePublish)

          if (pending.size > 0) {
            const latest = loadTrainingSyncStorage()
            const next: TrainingSyncStorageData = {
              ...latest,
              runtime: {
                ...latest.runtime,
                tombstones,
                fieldUpdates,
                conflicts,
                lastSyncStatus: 'conflict',
                lastError: `${pending.size} Training conflict${
                  pending.size === 1 ? '' : 's'
                } need review.`,
                lastRemoteRevision: remoteRevision,
              },
            }
            if (!persist(next)) {
              throw new Error(
                'The Training conflict records could not be saved. The original records were kept.',
              )
            }
            onNotify(
              `Training sync paused for ${pending.size} conflict${
                pending.size === 1 ? '' : 's'
              }. Review them in the Drive dialog.`,
            )
            return false
          }

          if (!sameTrainingJson(merged, localData)) {
            const written = stageTrainingSnapshot(merged)
            if (!written.ok) throw new Error(written.error)
            adoptedPreferencesRef.current = JSON.stringify(merged.preferences)
            if (!controller.adoptSavedTraining(merged, written.raw)) {
              throw new Error('The merged Training history could not be adopted.')
            }
          }
          // Adoption is our own change. Compare later edits against the data
          // the run actually published, never against the pre-merge snapshot.
          const publishedData = merged
          const afterAdoption = concurrentChangeReason(
            controller,
            timerStatusRef,
            blockedReason,
            publishedData,
            current,
          )
          if (afterAdoption) throw new ConcurrentTrainingSyncError(afterAdoption)

          const alreadyRemote =
            (localSnapshot.status === 'absent' && remoteSnapshots.length === 0) ||
            remoteSnapshots.some(
              (remote) => remote.fingerprint === mergedFingerprint,
            )
          if (!alreadyRemote) {
            const revision = remoteRevision + 1
            const envelope = createTrainingSyncEnvelope({
              deviceId: current.runtime.deviceId,
              revision,
              tombstones,
              fieldUpdates,
              conflicts,
              updatedAt: now,
            })
            const snapshot = {
              ...createTrainingDriveBackup(merged, current.runtime.deviceId, now),
              sync: envelope,
            }
            const serialized = serializeTrainingDriveBackup(snapshot)
            if (!serialized.ok) throw new Error(serialized.error)
            const uploaded = await runWithDriveWriteLock(async () => {
              const recheck = guardReason(controller, timerStatusRef, blockedReason)
              if (recheck) throw new Error(recheck)
              if (!loadTrainingSyncStorage().preferences.enabled) {
                throw new Error('Training Drive sync was disabled before publication.')
              }
              return transport.uploadTrainingBackup!(
                serialized.raw,
                current.runtime.deviceId,
              )
            })
            remoteRevision = revision
            const afterUpload = concurrentChangeReason(
              controller,
              timerStatusRef,
              blockedReason,
              publishedData,
              current,
            )
            if (afterUpload) {
              throw new ConcurrentTrainingSyncError(afterUpload)
            }
            const latest = loadTrainingSyncStorage()
            const next: TrainingSyncStorageData = {
              ...latest,
              runtime: {
                ...latest.runtime,
                tombstones,
                fieldUpdates,
                conflicts: conflicts.filter(
                  (conflict) => conflict.resolution !== 'manual-pending',
                ),
                lastRemoteRevision: revision,
                lastSyncAt: Date.now(),
                lastSyncStatus: 'synced',
                lastError: null,
                lastSyncedFingerprint: mergedFingerprint,
              },
            }
            if (!persist(next)) {
              throw new Error(
                'The Training synchronization result could not be saved. The original records were kept.',
              )
            }
            if (next.preferences.snapshotCleanupEnabled) {
              try {
                const allFiles = await listTrainingRemoteBackups(transport)
                await runWithDriveWriteLock(() =>
                  cleanupTrainingRemoteSnapshots(transport, allFiles, {
                    keepPerDevice: next.preferences.snapshotKeepPerDevice,
                    maxAgeDays: next.preferences.snapshotMaxAgeDays,
                    publishedFileId: uploaded.id,
                  }),
                )
              } catch {
                // Retention is best effort and never changes the publish result.
              }
            }
          } else {
            const afterMerge = concurrentChangeReason(
              controller,
              timerStatusRef,
              blockedReason,
              publishedData,
              current,
            )
            if (afterMerge) throw new ConcurrentTrainingSyncError(afterMerge)
            const latest = loadTrainingSyncStorage()
            const next: TrainingSyncStorageData = {
              ...latest,
              runtime: {
                ...latest.runtime,
                tombstones,
                fieldUpdates,
                conflicts: conflicts.filter(
                  (conflict) => conflict.resolution !== 'manual-pending',
                ),
                lastRemoteRevision: remoteRevision,
                lastSyncAt: Date.now(),
                lastSyncStatus: 'synced',
                lastError: null,
                lastSyncedFingerprint: mergedFingerprint,
              },
            }
            if (!persist(next)) {
              throw new Error(
                'The Training synchronization result could not be saved. The original records were kept.',
              )
            }
          }
          concurrentRetryRef.current = false
          onNotify(
            trigger === 'manual'
              ? 'Training sync complete'
              : 'Training history synchronized',
          )
          await refreshSnapshots()
          return true
        } catch (caught) {
          const message = toMessage(caught)
          if (!loadTrainingSyncStorage().preferences.enabled) {
            markStatus('disabled', null)
            return false
          }
          if (caught instanceof ConcurrentTrainingSyncError) {
            markStatus('pending', message)
            onNotify(`Training sync paused and will retry: ${message}`)
            if (!concurrentRetryRef.current) {
              concurrentRetryRef.current = true
              window.setTimeout(() => {
                void syncNowRef.current('retry')
              }, 50)
            }
            return false
          }
          markStatus('failed', message)
          onNotify(`Training sync failed: ${message}`)
          return false
        }
      })()
      runningRef.current = task
      try {
        return await task
      } finally {
        runningRef.current = null
      }
    },
    [
      blockedReason,
      controller,
      markStatus,
      onNotify,
      persist,
      refreshSnapshots,
      timerStatusRef,
      transport,
    ],
  )

  useLayoutEffect(() => {
    syncNowRef.current = syncNow
  }, [syncNow])

  // Stamp a coarse preferences edit for deterministic field merging. Adopted
  // merge results are explicitly skipped so they are not re-stamped as a new
  // local edit.
  useEffect(() => {
    const data = trainingState.data
    if (!data) return
    const serialized = JSON.stringify(data.preferences)
    const previous = previousPreferencesRef.current
    previousPreferencesRef.current = serialized
    if (previous === null || previous === serialized) return
    if (adoptedPreferencesRef.current === serialized) {
      adoptedPreferencesRef.current = null
      return
    }
    const current = loadTrainingSyncStorage()
    persist({
      ...current,
      runtime: {
        ...current.runtime,
        fieldUpdates: {
          ...current.runtime.fieldUpdates,
          preferences: {
            updatedAt: Date.now(),
            editorId: current.runtime.deviceId,
          },
        },
      },
    })
  }, [persist, trainingState.data])

  // Startup after idle, only when the user enabled Training sync.
  useEffect(() => {
    if (!storage.preferences.enabled || !storage.preferences.syncOnStartup) return
    const timer = window.setTimeout(() => {
      void syncNowRef.current('startup')
    }, 1_500)
    return () => window.clearTimeout(timer)
  }, [storage.preferences.enabled, storage.preferences.syncOnStartup])

  // Exactly one upload opportunity after a session ends, never per attempt.
  useEffect(() => {
    const current = trainingState.data?.activeVisitId ?? null
    const previous = previousActiveVisitRef.current
    previousActiveVisitRef.current = current
    if (!previous || current) return
    if (!storageRef.current.preferences.enabled) return
    const timer = window.setTimeout(() => {
      void syncNowRef.current('session-end')
    }, 1_000)
    return () => window.clearTimeout(timer)
  }, [storage.preferences.enabled, trainingState.data?.activeVisitId])

  // Idle debounce for history edits outside a session. The active-visit guard
  // prevents this from uploading after every attempt.
  useEffect(() => {
    const data = trainingState.data
    if (!data || observedDataRef.current === data) return
    observedDataRef.current = data
    if (!storageRef.current.preferences.enabled) return
    if (data.activeVisitId !== null) return
    const timer = window.setTimeout(() => {
      void syncNowRef.current('idle')
    }, 5_000)
    return () => window.clearTimeout(timer)
  }, [storage.preferences.enabled, trainingState.data])

  const resolveConflict = useCallback(
    (
      id: string,
      field: string,
      kind: TrainingSyncConflict['kind'],
      resolution: 'local' | 'remote',
    ): { ok: true } | { ok: false; error: string } => {
      const current = loadTrainingSyncStorage()
      const conflict = current.runtime.conflicts.find(
        (candidate) =>
          candidate.id === id &&
          candidate.field === field &&
          candidate.kind === kind,
      )
      if (!conflict) return { ok: false, error: 'This conflict is no longer current.' }
      const conflicts = current.runtime.conflicts.map((candidate) =>
        candidate === conflict
          ? { ...candidate, resolution, updatedAt: Date.now() }
          : candidate,
      )
      const saved = persist({
        ...current,
        runtime: {
          ...current.runtime,
          conflicts,
          lastSyncStatus: 'pending',
          lastError: null,
        },
      })
      if (!saved) {
        return {
          ok: false,
          error: 'The conflict approval could not be saved. Nothing changed.',
        }
      }
      return { ok: true }
    },
    [persist],
  )

  const deleteSnapshot = useCallback(
    async (fileId: string): Promise<boolean> => {
      if (!transport) return false
      const known = snapshots.find((snapshot) => snapshot.file.id === fileId)
      if (!known || !isDriveTrainingFileName(known.file.name)) {
        onNotify('Only Training snapshots can be deleted here.')
        return false
      }
      try {
        await runWithDriveWriteLock(() => transport.deleteBackup(fileId))
        setSnapshots((current) =>
          current.filter((snapshot) => snapshot.file.id !== fileId),
        )
        onNotify('Training snapshot deleted')
        return true
      } catch (caught) {
        setSnapshotsError(toMessage(caught))
        return false
      }
    },
    [onNotify, snapshots, transport],
  )

  const cleanupSnapshots = useCallback(async (): Promise<boolean> => {
    if (!transport) return false
    try {
      const files = await listTrainingRemoteBackups(transport)
      await runWithDriveWriteLock(() =>
        cleanupTrainingRemoteSnapshots(transport, files, {
          keepPerDevice: storageRef.current.preferences.snapshotKeepPerDevice,
          maxAgeDays: storageRef.current.preferences.snapshotMaxAgeDays,
        }),
      )
      await refreshSnapshots()
      onNotify('Training snapshot cleanup finished')
      return true
    } catch (caught) {
      setSnapshotsError(toMessage(caught))
      return false
    }
  }, [onNotify, refreshSnapshots, transport])

  const pendingConflicts = storage.runtime.conflicts.filter(
    (conflict) => conflict.resolution === 'manual-pending',
  )

  return {
    enabled: storage.preferences.enabled,    status: storage.runtime.lastSyncStatus,
    error: storage.runtime.lastError,
    storageWarning,
    preferences: storage.preferences,
    deviceId: storage.runtime.deviceId,
    lastSyncAt: storage.runtime.lastSyncAt,
    lastRemoteRevision: storage.runtime.lastRemoteRevision,
    tombstones: storage.runtime.tombstones,
    fieldUpdates: storage.runtime.fieldUpdates,
    conflicts: storage.runtime.conflicts,
    pendingConflicts,
    snapshots,
    snapshotsLoading,
    snapshotsError,
    updatePreferences,
    reload,
    syncNow,
    refreshSnapshots,
    resolveConflict,
    deleteSnapshot,
    cleanupSnapshots,
  }
}

export type UseTrainingSyncResult = ReturnType<typeof useTrainingSync>
