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
import { loadSyncStorage } from '../lib/syncStorage'
import { createSyncEnvelope } from '../lib/sync'
import {
  deleteAllRemoteBackups,
  listRemoteBackups,
  mergeRemoteBackupSnapshots,
  readRemoteBackups,
} from '../lib/remoteBackups'

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
  const [connected, setConnected] = useState(false)
  const [phase, setPhase] = useState<DriveBackupPhase>(() =>
    configured ? 'disconnected' : 'unconfigured',
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
      const file = files[0]
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
      // A device may only replace its own snapshot. Falling back to
      // `metadata.remoteFileId` could point at another device's file and
      // overwrite it; that fallback is safe only for legacy single-file
      // transports.
      const existingId = ownFile?.id ?? null
      const result = transport.uploadDeviceBackup
        ? await transport.uploadDeviceBackup(JSON.stringify(backup), deviceId, existingId)
        : await transport.uploadBackup(
            JSON.stringify(backup),
            existingId ?? metadata.remoteFileId,
          )
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
      const newest = snapshots[snapshots.length - 1]!
      persistMetadata({
        ...metadata,
        remoteFileId: newest.file.id,
        remoteModifiedTime: newest.file.modifiedTime,
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
    const remoteFileId = metadata.remoteFileId ?? loadDriveBackupState().remoteFileId
    setPhase('deleting')
    setError(null)
    try {
      const deleted = await deleteAllRemoteBackups(transport, remoteFileId)
      if (deleted === 0 && !remoteFileId) {
        setPhase('connected')
        return
      }
      persistMetadata({
        ...loadDriveBackupState(),
        ...metadata,
        remoteFileId: null,
        remoteModifiedTime: null,
      })
      setPhase('connected')
      onNotify('Google Drive backup deleted')
    } catch (caught) {
      setError(toMessage(caught))
      setPhase('error')
    }
  }, [metadata, onNotify, persistMetadata, transport])

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
