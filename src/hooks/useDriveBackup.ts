import { useCallback, useMemo, useState } from 'react'
import type { SessionsData, Settings } from '../types'
import { createBackup } from '../lib/backup'
import type { DriveTransport } from '../lib/driveTransport'
import { countSolves } from '../lib/sessions'
import {
  loadDriveBackupState,
  saveDriveBackupState,
  type DriveBackupState,
} from '../lib/driveStorage'
import { getSyncDeviceId, loadSyncStorage } from '../lib/syncStorage'
import { createSyncEnvelope } from '../lib/sync'
import {
  deleteAllRemoteBackups,
  findOwnSnapshots,
  listRemoteBackups,
  mergeRemoteBackupSnapshots,
  readRemoteBackups,
} from '../lib/remoteBackups'

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
  const [connected, setConnected] = useState(() => transport?.isConnected() ?? false)
  const [phase, setPhase] = useState<DriveBackupPhase>(() =>
    configured ? (transport?.isConnected() ? 'connected' : 'disconnected') : 'unconfigured',
  )
  const [error, setError] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<DriveBackupState>(() => loadDriveBackupState())

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
      setConnected(true)
      persistMetadata({
        ...metadata,
        remoteFileId: file?.id ?? null,
        remoteModifiedTime: file?.modifiedTime ?? null,
        connectedAccountLabel: transport.accountLabel,
      })
      setPhase('connected')
      onConnected?.()
    } catch (caught) {
      setConnected(false)
      setError(toMessage(caught))
      setPhase('error')
    }
  }, [metadata, onConnected, persistMetadata, transport])

  const disconnect = useCallback(() => {
    if (transport) transport.disconnect()
    setConnected(false)
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
      const envelope = createSyncEnvelope(
        deviceId,
        Math.max(syncStorage.runtime.lastRemoteRevision ?? 0, 0) + 1,
        syncStorage.runtime.tombstones,
        syncStorage.runtime.conflicts,
        syncStorage.runtime.sessionRedirects,
        syncStorage.runtime.settingsFieldUpdates,
      )
      const backup = createBackup(sessions, settings, new Date(), envelope)
      const content = JSON.stringify(backup)
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
        return transport.uploadBackup(content, existingId)
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
  }
}
