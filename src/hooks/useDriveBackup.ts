import { useCallback, useMemo, useState } from 'react'
import type { SessionsData, Settings } from '../types'
import { createBackup } from '../lib/backup'
import {
  deviceBackupFileName,
  type DriveTransport,
} from '../lib/driveTransport'
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
  findDeviceBackup,
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
      // Only this browser's own snapshot may be reported as its remote file.
      // Another device's snapshot is still listed and merged, but it is not an
      // upload target and must not drive this device's delete metadata.
      const ownName = deviceBackupFileName(getSyncDeviceId())
      const file = transport.uploadDeviceBackup
        ? findDeviceBackup(files, ownName)
        : files[0]
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
      const remoteFiles = await listRemoteBackups(transport)
      const ownName = deviceBackupFileName(deviceId)
      const ownFile = remoteFiles.find((file) => file.name === ownName)
      const expectedOwnFile = transport.uploadDeviceBackup
        ? ownFile
        : remoteFiles[0]
      // A device may only replace its own snapshot. Falling back to
      // `metadata.remoteFileId` could point at another device's file and
      // overwrite it; that fallback is safe only for legacy single-file
      // transports.
      const content = JSON.stringify(backup)
      const result = await runWithDriveWriteLock(async () => {
        // Serialize same-browser writes and re-check the own snapshot inside the
        // lock. If another tab already replaced it, abort rather than overwrite
        // its newer content with this tab's starting view.
        const currentFiles = await listRemoteBackups(transport)
        const currentOwnFile = transport.uploadDeviceBackup
          ? currentFiles.find((file) => file.name === ownName)
          : currentFiles[0]
        if (ownSnapshotChanged(expectedOwnFile, currentOwnFile)) {
          throw new Error(
            "Another CubeLab tab changed this device's Google Drive snapshot. Try the backup again.",
          )
        }
        const existingId = transport.uploadDeviceBackup
          ? currentOwnFile?.id ?? null
          : currentOwnFile?.id ?? metadata.remoteFileId
        return transport.uploadDeviceBackup
          ? transport.uploadDeviceBackup(content, deviceId, existingId)
          : transport.uploadBackup(content, existingId)
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
      // Keep this browser's own snapshot identity. Picking `newest` would
      // associate another device's file with this browser.
      const ownName = deviceBackupFileName(getSyncDeviceId())
      const ownFile = transport.uploadDeviceBackup
        ? snapshots
            .map((snapshot) => snapshot.file)
            .find((file) => file.name === ownName)
        : snapshots[0]?.file
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
