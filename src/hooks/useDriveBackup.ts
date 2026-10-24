import { useCallback, useMemo, useState } from 'react'
import type { SessionsData, Settings } from '../types'
import { createBackup, parseBackup } from '../lib/backup'
import type { DriveTransport } from '../lib/driveTransport'
import { countSolves } from '../lib/sessions'
import {
  loadDriveBackupState,
  saveDriveBackupState,
  type DriveBackupState,
} from '../lib/driveStorage'

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
      const file = await transport.findBackup()
      setConnected(true)
      persistMetadata({
        ...metadata,
        remoteFileId: file?.id ?? null,
        remoteModifiedTime: file?.modifiedTime ?? null,
        connectedAccountLabel: transport.accountLabel,
      })
      setPhase('connected')
    } catch (caught) {
      setConnected(false)
      setError(toMessage(caught))
      setPhase('error')
    }
  }, [metadata, persistMetadata, transport])

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
      const backup = createBackup(sessions, settings)
      const remote = await transport.findBackup()
      const existingId = remote?.id ?? metadata.remoteFileId
      const result = await transport.uploadBackup(JSON.stringify(backup), existingId)
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
      const remote = await transport.findBackup()
      if (!remote) throw new Error('No Google Drive backup was found.')
      const raw = await transport.downloadBackup(remote.id)
      if (raw.length > 10 * 1024 * 1024) throw new Error('That backup is too large to restore.')
      const parsed = parseBackup(raw)
      if (!parsed.ok) throw new Error(parsed.error)
      persistMetadata({
        ...metadata,
        remoteFileId: remote.id,
        remoteModifiedTime: remote.modifiedTime,
        lastRestoreAt: metadata.lastRestoreAt,
        connectedAccountLabel: transport.accountLabel || metadata.connectedAccountLabel,
      })
      onPendingRestore(parsed.backup)
      setPhase('connected')
    } catch (caught) {
      setError(toMessage(caught))
      setPhase('error')
    }
  }, [connect, connected, metadata, onPendingRestore, persistMetadata, transport])

  const deleteRemoteBackup = useCallback(async () => {
    if (!transport || !metadata.remoteFileId) return
    setPhase('deleting')
    setError(null)
    try {
      await transport.deleteBackup(metadata.remoteFileId)
      persistMetadata({
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
