import { useCallback, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { TimerState } from '../timer/machine'
import type { DriveFile, DriveTransport } from '../lib/driveTransport'
import type { UseSyncResult } from './useSync'
import type { TrainingController, TrainingControllerState } from '../lib/training/controller'
import { stageTrainingSnapshot } from '../lib/training/storage'
import { summarizeTrainingData } from '../lib/training/backupSection'
import {
  cleanupOwnTrainingRemoteBackups,
  createTrainingDriveBackup,
  isDriveTrainingFileName,
  listTrainingRemoteBackups,
  parseTrainingDriveBackup,
  serializeTrainingDriveBackup,
  summarizeTrainingDriveBackup,
  uploadTrainingRemoteBackup,
  type TrainingDriveBackup,
  type TrainingRemoteSnapshot,
} from '../lib/trainingDrive'
import {
  beginReplacement,
  clearReplacementJournal,
  loadReplacementJournal,
  markReplacementCommitted,
  pendingReplacementMessage,
  recoverPendingReplacement,
  rollbackReplacement,
} from '../lib/replacement'
import { loadSolveRecoveryChecked } from '../lib/solveRecovery'
import { loadPendingCompletion } from '../lib/pendingCompletion'
import { runWithDriveWriteLock } from '../lib/driveCoordination'
import {
  clearTrainingSyncProvenance,
  getTrainingDeviceId,
  loadTrainingSyncStorage,
  saveTrainingSyncStorage,
} from '../lib/trainingSyncStorage'

export type TrainingDrivePhase =
  | 'disconnected'
  | 'connecting'
  | 'idle'
  | 'uploading'
  | 'restoring'
  | 'deleting'
  | 'error'

export interface InvalidTrainingRemoteSnapshot {
  readonly file: DriveFile
  readonly error: string
}

export interface UseTrainingDriveBackupOptions {
  transport: DriveTransport | null
  controller: TrainingController
  trainingState: TrainingControllerState
  sync: UseSyncResult
  timerStatusRef: MutableRefObject<TimerState['status']>
  onNotify: (message: string) => void
  /** Allows App to close the dialog and restore focus after a commit. */
  onRestored?: () => void
}

function message(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Training cloud backup failed.'
}

function trainingLocalBlockedReason(
  state: TrainingControllerState,
): string | null {
  if (state.pendingSave)
    return 'A Training save is pending. Retry the save before changing cloud Training history.'
  if (state.needsContinuity)
    return 'Training is waiting for a resume or end decision. Resolve it first.'
  if (state.data?.activeVisitId)
    return 'An active Training session is open. Finish or end it first.'
  return null
}

function unresolvedWriteBlockedReason(): string | null {
  const journal = loadReplacementJournal()
  if (journal.status === 'invalid') return journal.message
  if (journal.status === 'ok' && journal.journal.phase === 'prepared') {
    return 'Another replacement is still being committed. Reload or retry after it finishes.'
  }
  const pendingUndo = loadSolveRecoveryChecked()
  if (!pendingUndo.ok) return pendingUndo.message
  if (pendingUndo.data.operations.length > 0) {
    return 'Finish the pending solve Undo recovery first.'
  }
  const completion = loadPendingCompletion()
  if (completion.status === 'invalid') return completion.message
  return null
}

export function useTrainingDriveBackup({
  transport,
  controller,
  trainingState,
  sync,
  timerStatusRef,
  onNotify,
  onRestored,
}: UseTrainingDriveBackupOptions) {
  const supported = Boolean(
    transport?.listTrainingBackups && transport?.uploadTrainingBackup,
  )
  const configured = Boolean(transport?.configured) && supported
  const [phaseState, setPhase] = useState<TrainingDrivePhase>(() =>
    configured ? (transport?.isConnected() ? 'idle' : 'disconnected') : 'disconnected',
  )
  const [error, setError] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<TrainingRemoteSnapshot[]>([])
  const [invalidSnapshots, setInvalidSnapshots] = useState<
    InvalidTrainingRemoteSnapshot[]
  >([])
  const [snapshotsLoading, setSnapshotsLoading] = useState(false)
  const [lastUpload, setLastUpload] = useState<DriveFile | null>(null)

  const connected = transport?.isConnected() ?? false
  const phase: TrainingDrivePhase =
    !configured
      ? 'disconnected'
      : connected && phaseState === 'disconnected'
        ? 'idle'
        : !connected && phaseState === 'idle'
          ? 'disconnected'
          : phaseState
  const busy =
    phase === 'connecting' ||
    phase === 'uploading' ||
    phase === 'restoring' ||
    phase === 'deleting'

  const ensureConnected = useCallback(async (): Promise<boolean> => {
    if (!transport || !configured) return false
    if (transport.isConnected()) return true
    setPhase('connecting')
    setError(null)
    try {
      await transport.connect()
      setPhase('idle')
      return transport.isConnected()
    } catch (caught) {
      setError(message(caught))
      setPhase('error')
      return false
    }
  }, [configured, transport])

  const refreshSnapshots = useCallback(async (): Promise<TrainingRemoteSnapshot[]> => {
    if (!transport || !configured) return []
    setSnapshotsLoading(true)
    setError(null)
    try {
      if (!(await ensureConnected())) return []
      if (!transport.listTrainingBackups) return []
      const files = await listTrainingRemoteBackups(transport)
      const loaded: TrainingRemoteSnapshot[] = []
      const invalid: InvalidTrainingRemoteSnapshot[] = []
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
        } catch (caught) {
          invalid.push({ file, error: message(caught) })
        }
      }
      loaded.sort(
        (left, right) =>
          right.updatedAt - left.updatedAt ||
          left.file.name.localeCompare(right.file.name) ||
          left.file.id.localeCompare(right.file.id),
      )
      setSnapshots(loaded)
      setInvalidSnapshots(invalid)
      if (loaded[0]) setLastUpload(loaded[0].file)
      setPhase('idle')
      return loaded
    } catch (caught) {
      setError(message(caught))
      setPhase('error')
      return []
    } finally {
      setSnapshotsLoading(false)
    }
  }, [configured, ensureConnected, transport])

  const upload = useCallback(async (): Promise<boolean> => {
    if (!transport || !configured) {
      onNotify('Training cloud backup is unavailable in this build.')
      return false
    }
    if (timerStatusRef.current !== 'idle') {
      onNotify('Training backup blocked: wait for the timer to return to idle.')
      return false
    }
    const localReason = trainingLocalBlockedReason(trainingState)
    if (localReason) {
      onNotify(`Training backup blocked: ${localReason}`)
      return false
    }
    const snapshot = controller.getBackupSnapshot()
    if (snapshot.status === 'absent') {
      onNotify('No Training history to back up.')
      return false
    }
    if (snapshot.status === 'blocked') {
      onNotify(`Training backup blocked: ${snapshot.reason}`)
      return false
    }
    const writeReason = unresolvedWriteBlockedReason()
    if (writeReason) {
      onNotify(`Training backup blocked: ${writeReason}`)
      return false
    }
    const envelope = createTrainingDriveBackup(
      snapshot.data,
      getTrainingDeviceId(),
    )
    const serialized = serializeTrainingDriveBackup(envelope)
    if (!serialized.ok) {
      onNotify(`Training backup blocked: ${serialized.error}`)
      return false
    }
    if (!(await ensureConnected())) {
      onNotify('Training backup blocked: connect Google Drive first.')
      return false
    }
    setPhase('uploading')
    setError(null)
    try {
      const result = await runWithDriveWriteLock(async () => {
        if (timerStatusRef.current !== 'idle' || sync.isSyncRunning()) {
          throw new Error('Timing or synchronization started before the upload.')
        }
        return uploadTrainingRemoteBackup(
          transport,
          serialized.raw,
          envelope.deviceId,
        )
      })
      setLastUpload(result)
      // Cleanup is strictly best effort and only after the upload committed.
      try {
        const files = await listTrainingRemoteBackups(transport)
        await runWithDriveWriteLock(() =>
          cleanupOwnTrainingRemoteBackups(
            transport,
            files,
            envelope.deviceId,
          ),
        )
      } catch {
        // A cleanup failure never changes the successful upload result.
      }
      await refreshSnapshots()
      onNotify('Training history backed up to Google Drive')
      return true
    } catch (caught) {
      setError(message(caught))
      setPhase('error')
      onNotify(`Training backup failed: ${message(caught)}`)
      return false
    }
  }, [
    configured,
    controller,
    ensureConnected,
    onNotify,
    refreshSnapshots,
    sync,
    timerStatusRef,
    trainingState,
    transport,
  ])

  const restore = useCallback(
    async (snapshot: TrainingRemoteSnapshot): Promise<boolean> => {
      if (loadTrainingSyncStorage().preferences.enabled) {
        onNotify(
          'Training restore blocked: disable Training Drive sync before using replace-only restore. Nothing was replaced.',
        )
        return false
      }
      if (timerStatusRef.current !== 'idle') {
        onNotify('Training restore blocked: wait for the timer to return to idle.')
        return false
      }
      if (sync.isSyncRunning()) {
        onNotify(
          'Training restore blocked: wait for the current synchronization to finish.',
        )
        return false
      }
      const localReason = trainingLocalBlockedReason(trainingState)
      if (localReason) {
        onNotify(`Training restore blocked: ${localReason} Nothing was replaced.`)
        return false
      }
      const writeReason = unresolvedWriteBlockedReason()
      if (writeReason) {
        onNotify(`Training restore blocked: ${writeReason} Nothing was replaced.`)
        return false
      }
      const existing = loadReplacementJournal()
      if (existing.status === 'ok') {
        const blocked = pendingReplacementMessage(recoverPendingReplacement())
        if (blocked) {
          onNotify(`Training restore blocked: ${blocked} Nothing was replaced.`)
          return false
        }
      }
      if (
        snapshot.backup.training.data.activeVisitId !== null ||
        snapshot.backup.training.data.visits.some((visit) => visit.endedAt === null)
      ) {
        onNotify(
          'Training restore blocked: the snapshot contains an unfinished session. Nothing was replaced.',
        )
        return false
      }
      const data = snapshot.backup.training.data
      const begun = beginReplacement('training-restore', [
        'training',
        'trainingSync',
      ])
      if (!begun.ok) {
        onNotify(`Training restore blocked: ${begun.error}`)
        return false
      }
      const journal = begun.journal
      const fail = (detail: string): false => {
        const rolledBack = rollbackReplacement(journal)
        if (rolledBack) clearReplacementJournal()
        onNotify(
          rolledBack
            ? `Training restore blocked: ${detail} Nothing was replaced.`
            : `Training restore blocked: ${detail} The previous Training state could not be fully restored. A recovery record was kept; reload before retrying.`,
        )
        setPhase('error')
        return false
      }
      setPhase('restoring')
      setError(null)
      try {
        const staged = stageTrainingSnapshot(data)
        if (!staged.ok) return fail('the Training history could not be saved.')
        const cleared = clearTrainingSyncProvenance()
        if (!saveTrainingSyncStorage(cleared)) {
          return fail('the Training synchronization records could not be cleared.')
        }
        if (!markReplacementCommitted(journal)) {
          return fail('the durable commit marker could not be saved.')
        }
        const adopted = controller.adoptSavedTraining(data, staged.raw)
        if (!adopted) {
          return fail('the restored Training history could not be adopted.')
        }
        const cleaned = clearReplacementJournal()
        setPhase('idle')
        onNotify(
          cleaned
            ? 'Training history restored from Google Drive'
            : 'Training history restored. Recovery cleanup is pending and will finish on reload.',
        )
        onRestored?.()
        return true
      } catch (caught) {
        return fail(message(caught))
      }
    },
    [
      controller,
      onNotify,
      onRestored,
      sync,
      timerStatusRef,
      trainingState,
    ],
  )

  const recoverPending = useCallback(() => {
    const journal = loadReplacementJournal()
    if (journal.status === 'ok' && journal.journal.phase === 'committed') {
      const recovery = recoverPendingReplacement()
      const blocked = pendingReplacementMessage(recovery)
      if (blocked) setError(blocked)
    }
  }, [])

  const deleteSnapshot = useCallback(
    async (fileId: string): Promise<boolean> => {
      if (!transport || !configured) return false
      const known =
        snapshots.find((snapshot) => snapshot.file.id === fileId)?.file ??
        invalidSnapshots.find((snapshot) => snapshot.file.id === fileId)?.file
      if (!known || !isDriveTrainingFileName(known.name)) {
        onNotify('Only Training snapshots can be deleted here.')
        return false
      }
      setPhase('deleting')
      setError(null)
      try {
        await runWithDriveWriteLock(() => transport.deleteBackup(fileId))
        await refreshSnapshots()
        onNotify('Training snapshot deleted')
        return true
      } catch (caught) {
        setError(message(caught))
        setPhase('error')
        return false
      }
    },
    [
      configured,
      invalidSnapshots,
      onNotify,
      refreshSnapshots,
      snapshots,
      transport,
    ],
  )

  return {
    configured,
    supported,
    connected,
    phase,
    busy,
    error,
    snapshots,
    invalidSnapshots,
    snapshotsLoading,
    lastUpload,
    uploadBlockedReason: !configured
      ? 'Training cloud backup is unavailable for this build or transport.'
      : trainingState.data === null
        ? 'Training history is unreadable. Repair or restore it before uploading.'
        : trainingLocalBlockedReason(trainingState) ?? null,
    localSummary:
      trainingState.data === null
        ? null
        : summarizeTrainingData(trainingState.data),
    localData: trainingState.data,
    summaryOf: summarizeTrainingDriveBackup,
    canUpload:
      configured &&
      !busy &&
      trainingState.data !== null &&
      !trainingState.pendingSave &&
      !trainingState.needsContinuity &&
      trainingState.data.activeVisitId === null,
    canRestore: configured && !busy,
    upload,
    restore,
    refreshSnapshots,
    deleteSnapshot,
    recoverPending,
    snapshotData: (snapshot: TrainingRemoteSnapshot): TrainingDriveBackup =>
      snapshot.backup,
  }
}
