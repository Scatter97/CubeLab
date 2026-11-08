import { useCallback, useMemo, useState } from 'react'
import type { SessionsData, Settings } from '../types'
import { createBackup, serializeBackupChecked } from '../lib/backup'
import type { DriveFile, DriveTransport } from '../lib/driveTransport'
import { isDrivePreconditionError } from '../lib/driveTransport'
import { countSolves } from '../lib/sessions'
import {
  loadDriveBackupState,
  saveDriveBackupState,
  type DriveBackupState,
} from '../lib/driveStorage'
import { getSyncDeviceId, loadSyncStorage } from '../lib/syncStorage'
import { createSyncEnvelope } from '../lib/sync'
import {
  applyPendingSolveRestores,
  loadSolveRecovery,
} from '../lib/solveRecovery'
import {
  deleteAllRemoteBackups,
  findOwnSnapshots,
  listRemoteBackups,
  mergeRemoteBackupSnapshots,
  readRemoteBackups,
} from '../lib/remoteBackups'
import {
  cleanupRemoteSnapshots,
  newestSnapshotModifiedAt,
  type SnapshotCleanupResult,
  type SnapshotKeepPerDevice,
  type SnapshotMaxAgeDays,
} from '../lib/snapshotRetention'

import {
  ownSnapshotChanged,
  runWithDriveWriteLock,
} from '../lib/driveCoordination'

export type DriveBackupPhase =
  | 'unconfigured'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'backing-up'
  | 'restoring'
  | 'deleting'
  | 'error'

export interface UseDriveBackupOptions {
  transport: DriveTransport | null
  sessions: SessionsData
  settings: Settings
  storageOk: boolean
  onPendingRestore: (backup: ReturnType<typeof createBackup>) => void
  onNotify: (message: string) => void
  onConnected?: () => void
}

function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Google Drive backup failed.'
}

export function useDriveBackup({
  transport,
  sessions,
  settings,
  storageOk,
  onPendingRestore,
  onNotify,
  onConnected,
}: UseDriveBackupOptions) {
  const configured = Boolean(transport?.configured)
  const [phaseState, setPhase] = useState<DriveBackupPhase>(() =>
    configured ? (transport?.isConnected() ? 'connected' : 'disconnected') : 'unconfigured',
  )
  const [error, setError] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<DriveBackupState>(() => loadDriveBackupState())
  const [snapshots, setSnapshots] = useState<DriveFile[] | null>(null)
  const [snapshotsLoading, setSnapshotsLoading] = useState(false)
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null)

  // The transport is the source of truth for authorization. A sync can acquire
  // a token itself (startup, automatic, or **Sync now**), so derive both the
  // connection flag and the idle phase instead of leaving the dialog on
  // "Offline" after a successful synchronization. Active phases (connecting,
  // backing up, restoring, deleting) and errors are preserved.
  const connected = transport?.isConnected() ?? false
  const phase: DriveBackupPhase =
    connected && phaseState === 'disconnected'
      ? 'connected'
      : !connected && phaseState === 'connected'
        ? 'disconnected'
        : phaseState

  const persistMetadata = useCallback((next: DriveBackupState) => {
    setMetadata(next)
    if (storageOk) saveDriveBackupState(next)
  }, [storageOk])

  const countBackup = useMemo(
    () => ({
      sessions: sessions.sessions.length,
      solves: countSolves(sessions.sessions),
    }),
    [sessions],
  )

  const connect = useCallback(async () => {
    if (!transport) return
    setPhase('connecting')
    setError(null)
    try {
      await transport.connect()
      const files = await listRemoteBackups(transport)
      // Only legacy single-file transports have one stable own file to report.
      // Per-device snapshots are immutable and uniquely named, so this
      // browser's file is identified by the envelope of what it writes, not by
      // picking a file from the list; another device's snapshot is never
      // adopted as this browser's remote file.
      const file = transport.uploadDeviceBackup ? null : files[0] ?? null
      persistMetadata({
        ...metadata,
        remoteFileId: file?.id ?? null,
        remoteModifiedTime: file?.modifiedTime ?? null,
        connectedAccountLabel: transport.accountLabel,
      })
      setPhase('connected')
      onConnected?.()
    } catch (caught) {
      setError(toMessage(caught))
      setPhase('error')
    }
  }, [metadata, onConnected, persistMetadata, transport])

  const disconnect = useCallback(() => {
    if (transport) transport.disconnect()
    setPhase('disconnected')
    setError(null)
  }, [transport])

  const backupNow = useCallback(async () => {
    if (!transport) return
    if (!connected) {
      await connect()
      if (!transport.isConnected()) return
    }

    setPhase('backing-up')
    setError(null)
    try {
      const syncStorage = loadSyncStorage()
      const deviceId = syncStorage.runtime.deviceId
      const pendingRecovery = loadSolveRecovery()
      let backupSessions = sessions
      if (pendingRecovery.operations.length > 0) {
        const materialized = applyPendingSolveRestores({
          data: sessions,
          tombstones: syncStorage.runtime.tombstones,
          operations: pendingRecovery.operations,
        })
        if (materialized.remaining.length > 0) {
          throw new Error(
            'Google Drive backup blocked: a pending Undo could not be materialized safely.',
          )
        }
        backupSessions = materialized.data
      }
      const envelope = createSyncEnvelope(
        deviceId,
        Math.max(syncStorage.runtime.lastRemoteRevision ?? 0, 0) + 1,
        syncStorage.runtime.tombstones,
        syncStorage.runtime.conflicts,
        syncStorage.runtime.sessionRedirects,
        syncStorage.runtime.settingsFieldUpdates,
        syncStorage.runtime.activeSessionFieldUpdate,
      )
      const backup = createBackup(backupSessions, settings, new Date(), envelope)
      const serialized = serializeBackupChecked(backup, {
        preferCompact: true,
      })
      if (!serialized.ok) {
        throw new Error(`Google Drive backup blocked: ${serialized.error}`)
      }
      const content = serialized.raw
      // Legacy transports discover the mutable fixed-name file before the lock
      // so the locked re-list can detect a same-origin change.
      const discoveredLegacyFile = transport.uploadDeviceBackup
        ? null
        : (await listRemoteBackups(transport))[0] ?? null
      const result = await runWithDriveWriteLock(async () => {
        if (transport.uploadDeviceBackup) {
          // Immutable, uniquely named snapshot: this write adds a new file and
          // can never overwrite another writer's data, even one sharing this
          // device ID. Manual and automatic writes stay serialized by the same
          // Web Lock so same-origin writers do not interleave.
          return transport.uploadDeviceBackup(content, deviceId)
        }
        // Legacy single-file transport: the fixed-name file is still mutable,
        // so keep the optimistic recheck and replace only that file.
        const currentFiles = await listRemoteBackups(transport)
        if (ownSnapshotChanged(discoveredLegacyFile, currentFiles[0] ?? null)) {
          throw new Error(
            'Another CubeLab tab changed the Google Drive backup. Try the backup again.',
          )
        }
        const existingId = currentFiles[0]?.id ?? metadata.remoteFileId
        try {
          return await transport.uploadBackup(content, existingId, {
            expectedEtag: currentFiles[0]?.etag ?? null,
          })
        } catch (caught) {
          if (isDrivePreconditionError(caught)) {
            throw new Error(
              'Another CubeLab tab changed the Google Drive backup. Try the backup again.',
            )
          }
          throw caught
        }
      })
      const next = {
        ...metadata,
        remoteFileId: result.id,
        remoteModifiedTime: result.modifiedTime,
        lastBackupAt: Date.now(),
        connectedAccountLabel: transport.accountLabel || metadata.connectedAccountLabel,
      }
      persistMetadata(next)
      setPhase('connected')
      onNotify('Google Drive backup saved')
    } catch (caught) {
      setError(toMessage(caught))
      setPhase('error')
    }
  }, [connect, connected, metadata, onNotify, persistMetadata, sessions, settings, transport])

  const restoreFromDrive = useCallback(async () => {
    if (!transport) return
    if (!connected) {
      await connect()
      if (!transport.isConnected()) return
    }

    setPhase('restoring')
    setError(null)
    try {
      const snapshots = await readRemoteBackups(transport)
      if (snapshots.length === 0) throw new Error('No Google Drive backup was found.')
      const merged = mergeRemoteBackupSnapshots(snapshots)
      // Keep this browser's own snapshot identity (envelope device ID, with the
      // legacy fixed name as fallback). Picking `newest` would associate
      // another device's file with this browser.
      const deviceId = getSyncDeviceId()
      const ownFile = transport.uploadDeviceBackup
        ? findOwnSnapshots(snapshots, deviceId).at(-1)?.file ?? null
        : snapshots[0]?.file ?? null
      persistMetadata({
        ...metadata,
        remoteFileId: ownFile?.id ?? null,
        remoteModifiedTime: ownFile?.modifiedTime ?? null,
        lastRestoreAt: metadata.lastRestoreAt,
        connectedAccountLabel: transport.accountLabel || metadata.connectedAccountLabel,
      })
      onPendingRestore(createBackup(merged.sessions, merged.settings))
      setPhase('connected')
    } catch (caught) {
      setError(toMessage(caught))
      setPhase('error')
    }
  }, [connect, connected, metadata, onPendingRestore, persistMetadata, transport])

  const deleteRemoteBackup = useCallback(async () => {
    if (!transport) return
    if (!connected) {
      await connect()
      if (!transport.isConnected()) return
    }
    const remoteFileId = metadata.remoteFileId ?? loadDriveBackupState().remoteFileId
    setPhase('deleting')
    setError(null)
    try {
      // Share the write lock so a same-browser sync cannot recreate the file in
      // the middle of delete-all. Cross-profile writers remain outside this
      // lock; Drive has no transactional delete-all.
      const deleted = await runWithDriveWriteLock(() =>
        deleteAllRemoteBackups(transport, remoteFileId),
      )
      persistMetadata({
        ...loadDriveBackupState(),
        ...metadata,
        remoteFileId: null,
        remoteModifiedTime: null,
      })
      setPhase('connected')
      onNotify(
        deleted === 0
          ? 'No Google Drive backups were found'
          : 'Google Drive backup deleted',
      )
    } catch (caught) {
      setError(toMessage(caught))
      setPhase('error')
    }
  }, [connect, connected, metadata, onNotify, persistMetadata, transport])

  const refreshSnapshots = useCallback(async (): Promise<DriveFile[]> => {
    if (!transport) return []
    setSnapshotsLoading(true)
    setSnapshotsError(null)
    try {
      if (!connected) {
        await connect()
        if (!transport.isConnected()) return []
      }
      const files = await listRemoteBackups(transport)
      setSnapshots(files)
      return files
    } catch (caught) {
      setSnapshotsError(toMessage(caught))
      return []
    } finally {
      setSnapshotsLoading(false)
    }
  }, [connect, connected, transport])

  const deleteSnapshot = useCallback(
    async (fileId: string): Promise<boolean> => {
      if (!transport) return false
      setPhase('deleting')
      setError(null)
      setSnapshotsError(null)
      try {
        if (!connected) {
          await connect()
          if (!transport.isConnected()) return false
        }
        await runWithDriveWriteLock(() => transport.deleteBackup(fileId))
        if (metadata.remoteFileId === fileId) {
          persistMetadata({
            ...metadata,
            remoteFileId: null,
            remoteModifiedTime: null,
          })
        }
        setSnapshots((current) =>
          current ? current.filter((file) => file.id !== fileId) : current,
        )
        setPhase('connected')
        onNotify('Remote snapshot deleted')
        return true
      } catch (caught) {
        setError(toMessage(caught))
        setPhase('error')
        return false
      }
    },
    [connect, connected, metadata, onNotify, persistMetadata, transport],
  )

  /**
   * Manual cleanup prunes only this device's superseded snapshots. Other
   * devices clean up their own after a successful all-snapshot merge, so a
   * manual action never removes a foreign snapshot that may not have been
   * merged into this browser yet.
   */
  const cleanupSnapshots = useCallback(
    async (options: {
      keepPerDevice: SnapshotKeepPerDevice
      maxAgeDays: SnapshotMaxAgeDays
    }): Promise<SnapshotCleanupResult | null> => {
      if (!transport) return null
      setPhase('deleting')
      setError(null)
      setSnapshotsError(null)
      try {
        if (!connected) {
          await connect()
          if (!transport.isConnected()) return null
        }
        const files = await listRemoteBackups(transport)
        const result = await runWithDriveWriteLock(() =>
          cleanupRemoteSnapshots(transport, files, {
            keepPerDevice: options.keepPerDevice,
            maxAgeDays: options.maxAgeDays,
            localDeviceId: getSyncDeviceId(),
            publishedAt: newestSnapshotModifiedAt(files),
            ownOnly: true,
          }),
        )
        setSnapshots(await listRemoteBackups(transport))
        setPhase('connected')
        if (result.failures.length > 0) {
          setError(
            `Removed ${result.deleted} snapshot${
              result.deleted === 1 ? '' : 's'
            }, but ${result.failures.length} could not be removed: ${
              result.failures[0]
            }`,
          )
          setPhase('error')
        } else {
          onNotify(
            result.deleted === 0
              ? 'No old snapshots needed cleanup'
              : `${result.deleted} old snapshot${
                  result.deleted === 1 ? '' : 's'
                } removed`,
          )
        }
        return result
      } catch (caught) {
        setError(toMessage(caught))
        setPhase('error')
        return null
      }
    },
    [connect, connected, onNotify, transport],
  )

  return {
    configured,
    phase,
    connected,
    error,
    metadata,
    countBackup,
    connect,
    disconnect,
    backupNow,
    restoreFromDrive,
    deleteRemoteBackup,
    snapshots,
    snapshotsLoading,
    snapshotsError,
    refreshSnapshots,
    deleteSnapshot,
    cleanupSnapshots,
  }
}
