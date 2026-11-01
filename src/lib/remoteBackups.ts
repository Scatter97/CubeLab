import type { SessionsData, Settings } from '../types'
import { MAX_BACKUP_BYTES, parseBackup, type Backup } from './backup'
import { deviceBackupFileName, type DriveFile, type DriveTransport } from './driveTransport'
import { mergeTombstones, mergeSessionsData } from './sync'
import { mergeSettingsData } from './settingsMerge'
import type { SettingsFieldUpdates } from './syncStorage'
import { normalizeSessionRedirects } from './sessionRedirects'
import { createSession, DEFAULT_SESSION_NAME } from './sessions'

export interface RemoteBackupSnapshot {
  file: DriveFile
  backup: Backup
  /** Envelope update time, falling back to the export timestamp. */
  updatedAt: number
}

function exportTime(backup: Backup): number {
  const parsed = Date.parse(backup.exportedAt)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Returns every CubeLab app-data snapshot. Older transports without
 * `listBackups` degrade to their single `findBackup` result.
 */
export async function listRemoteBackups(
  transport: DriveTransport,
): Promise<DriveFile[]> {
  if (transport.listBackups) return transport.listBackups()
  const file = await transport.findBackup()
  return file ? [file] : []
}

/**
 * Downloads and validates all remote snapshots. A single invalid or oversized
 * file aborts the read before any local mutation can occur.
 */
export async function readRemoteBackups(
  transport: DriveTransport,
  files?: DriveFile[],
): Promise<RemoteBackupSnapshot[]> {
  const remoteFiles = files ?? (await listRemoteBackups(transport))
  const snapshots: RemoteBackupSnapshot[] = []
  for (const file of remoteFiles) {
    // A provider-reported size lets us reject an oversized file before paying
    // for the download. It is advisory; the encoded byte check below is
    // authoritative.
    if (
      typeof file.size === 'number' &&
      Number.isFinite(file.size) &&
      file.size > MAX_BACKUP_BYTES
    ) {
      throw new Error('Remote backup is too large to synchronize.')
    }
    const raw = await transport.downloadBackup(file.id)
    if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) {
      throw new Error('Remote backup is too large to synchronize.')
    }
    const parsed = parseBackup(raw)
    if (!parsed.ok) throw new Error(parsed.error)
    snapshots.push({
      file,
      backup: parsed.backup,
      updatedAt: parsed.backup.sync?.updatedAt ?? exportTime(parsed.backup),
    })
  }
  return snapshots.sort(
    (left, right) =>
      left.updatedAt - right.updatedAt ||
      left.file.name.localeCompare(right.file.name) ||
      left.file.id.localeCompare(right.file.id),
  )
}

/**
 * Rebuilds one coherent snapshot from all device files for a manual restore.
 * Sessions are merged by ID using the same tombstones/redirects as sync;
 * settings keep the newest value for each field using envelope metadata.
 */
export function mergeRemoteBackupSnapshots(
  snapshots: ReadonlyArray<RemoteBackupSnapshot>,
): { sessions: SessionsData; settings: Settings } {
  const first = snapshots[0]
  if (!first) throw new Error('No Google Drive backup was found.')

  const tombstones = mergeTombstones(
    ...snapshots.map((snapshot) => snapshot.backup.sync?.tombstones ?? []),
  )
  const redirects = normalizeSessionRedirects(
    snapshots.flatMap((snapshot) => snapshot.backup.sync?.sessionRedirects ?? []),
  )

  // Normalize even the first/single snapshot through the same merge/recovery
  // pipeline so its tombstones and redirects are applied. Apply the shared
  // tombstones/redirects to the first snapshot before folding in the rest.
  let sessions: SessionsData = snapshots[0]!.backup.sessions
  const firstNormalized = mergeSessionsData({
    local: sessions,
    remote: null,
    tombstones,
    sessionRedirects: redirects,
    deviceId: 'manual-restore',
    manualConflictReview: false,
  })
  sessions = firstNormalized.merged
  if (sessions.sessions.length === 0) {
    // A snapshot may legitimately delete every session it contained. Keep the
    // at-least-one-session invariant with a fresh default instead of restoring
    // the tombstoned collection.
    const fresh = createSession(
      { activeSessionId: '', sessions: [] },
      DEFAULT_SESSION_NAME,
    )
    if (fresh) sessions = fresh.data
  }
  for (const snapshot of snapshots.slice(1)) {
    const merged = mergeSessionsData({
      local: sessions,
      remote: snapshot.backup.sessions,
      tombstones,
      sessionRedirects: redirects,
      deviceId: 'manual-restore',
      manualConflictReview: false,
    })
    sessions = merged.merged
  }

  let settings = { ...first.backup.settings }
  let fieldUpdates: SettingsFieldUpdates = {
    ...(first.backup.sync?.settingsFieldUpdates ?? {}),
  }
  for (const snapshot of snapshots.slice(1)) {
    const merged = mergeSettingsData({
      local: settings,
      remote: snapshot.backup.settings,
      localFieldUpdates: fieldUpdates,
      remoteFieldUpdates: snapshot.backup.sync?.settingsFieldUpdates ?? {},
      remoteUpdatedAt: snapshot.updatedAt,
      lastSyncAt: 1,
      manualConflictReview: false,
    })
    settings = merged.settings
    fieldUpdates = merged.fieldUpdates
  }

  return { sessions, settings }
}

/** Deletes every CubeLab snapshot, including the legacy fixed-name file. */
export async function deleteAllRemoteBackups(
  transport: DriveTransport,
  knownFileId?: string | null,
): Promise<number> {
  const files = await listRemoteBackups(transport)
  const ids = new Set(files.map((file) => file.id))
  if (knownFileId) ids.add(knownFileId)
  let deleted = 0
  const failures: string[] = []
  for (const id of ids) {
    try {
      await transport.deleteBackup(id)
      deleted += 1
    } catch (error) {
      // A file already removed by another device is not an error, but a real
      // transport failure must not be reported as a completed deletion.
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (!message.toLowerCase().includes('not found')) failures.push(message)
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Deleted ${deleted} remote snapshot${deleted === 1 ? '' : 's'}, but ${failures.length} could not be removed: ${failures[0]}`,
    )
  }
  return deleted
}

/** The local device's own mutable snapshot file, if it already exists. */
export function findDeviceBackup(
  files: ReadonlyArray<DriveFile>,
  expectedName: string,
): DriveFile | undefined {
  return files.find((file) => file.name === expectedName)
}

/**
 * True when a downloaded snapshot was written by this device. The envelope's
 * `deviceId` is authoritative; the legacy per-device file name is the fallback
 * for snapshots that predate envelopes.
 */
export function isOwnSnapshot(
  snapshot: RemoteBackupSnapshot,
  deviceId: string,
): boolean {
  if (snapshot.backup.sync?.deviceId === deviceId) return true
  return snapshot.file.name === deviceBackupFileName(deviceId)
}

/**
 * Every downloaded snapshot written by this device. Unique immutable snapshot
 * names mean a device can own several remote files at once; all of them stay
 * readable, and none is overwritten by a new write.
 */
export function findOwnSnapshots(
  snapshots: ReadonlyArray<RemoteBackupSnapshot>,
  deviceId: string,
): RemoteBackupSnapshot[] {
  return snapshots.filter((snapshot) => isOwnSnapshot(snapshot, deviceId))
}
