/**
 * Separate, immutable Training cloud snapshots.
 *
 * This module owns the Phase 1 envelope and remote-file helpers. It never
 * imports or mutates solve backup/sync data. Phase 2 adds an optional `sync`
 * field; Phase 1 readers deliberately ignore it so replace-only restore stays
 * available.
 */
import {
  createTrainingBackupSection,
  parseTrainingBackupSection,
  summarizeTrainingData,
  type TrainingBackupSection,
  type TrainingBackupSummary,
} from './training/backupSection'
import type { TrainingData } from './training/types'
import {
  isDriveTrainingFileName,
  sanitizeDeviceId,
  trainingSnapshotFileName,
  type DriveFile,
  type DriveTransport,
} from './driveTransport'

export const TRAINING_DRIVE_APP = 'CubeLab'
export const TRAINING_DRIVE_FORMAT = 'cubelab-training-backup'
export const TRAINING_DRIVE_VERSION = 1
export const MAX_TRAINING_DRIVE_BYTES = 16 * 1024 * 1024
export const TRAINING_DRIVE_KEEP_OWN_SNAPSHOTS = 5

export interface TrainingDriveBackup {
  readonly app: typeof TRAINING_DRIVE_APP
  readonly format: typeof TRAINING_DRIVE_FORMAT
  readonly version: typeof TRAINING_DRIVE_VERSION
  readonly deviceId: string
  readonly exportedAt: string
  readonly training: TrainingBackupSection
  /** Phase 2 extension. Phase 1 readers ignore it for replace-only restore. */
  readonly sync?: unknown
}

export interface TrainingRemoteSnapshot {
  readonly file: DriveFile
  readonly backup: TrainingDriveBackup
  /** Sync-envelope update time, falling back to the export timestamp. */
  readonly updatedAt: number
}

export type TrainingDriveParseResult =
  | { readonly ok: true; readonly backup: TrainingDriveBackup }
  | { readonly ok: false; readonly error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function trainingDriveBytes(raw: string): number {
  return new TextEncoder().encode(raw).byteLength
}

export function formatTrainingDriveBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function createTrainingDriveBackup(
  data: TrainingData,
  deviceId: string,
  now = Date.now(),
): TrainingDriveBackup {
  if (!deviceId.trim()) throw new Error('A Training device ID is required.')
  return {
    app: TRAINING_DRIVE_APP,
    format: TRAINING_DRIVE_FORMAT,
    version: TRAINING_DRIVE_VERSION,
    deviceId,
    exportedAt: new Date(now).toISOString(),
    training: createTrainingBackupSection(data),
  }
}

/** Compact JSON is the Training wire format; native `.json.gz` is separate. */
export function serializeTrainingDriveBackup(
  backup: TrainingDriveBackup,
): { readonly ok: true; readonly raw: string } | { readonly ok: false; readonly error: string } {
  let raw: string
  try {
    raw = JSON.stringify(backup)
  } catch {
    return { ok: false, error: 'The Training backup could not be serialized.' }
  }
  const bytes = trainingDriveBytes(raw)
  if (bytes > MAX_TRAINING_DRIVE_BYTES) {
    return {
      ok: false,
      error: `The Training cloud backup is ${formatTrainingDriveBytes(
        bytes,
      )}, above the ${formatTrainingDriveBytes(
        MAX_TRAINING_DRIVE_BYTES,
      )} limit. Reduce Training history before uploading.`,
    }
  }
  return { ok: true, raw }
}

export function parseTrainingDriveBackup(
  raw: string,
): TrainingDriveParseResult {
  // Reject oversized input before paying for JSON parsing. The provider size
  // is advisory; this encoded-byte check is authoritative.
  if (trainingDriveBytes(raw) > MAX_TRAINING_DRIVE_BYTES) {
    return {
      ok: false,
      error: `The Training cloud backup exceeds the ${formatTrainingDriveBytes(
        MAX_TRAINING_DRIVE_BYTES,
      )} limit.`,
    }
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'The Training cloud backup is not valid JSON.' }
  }
  if (!isRecord(value)) {
    return { ok: false, error: 'The Training cloud backup is malformed.' }
  }
  if (value.app !== TRAINING_DRIVE_APP || value.format !== TRAINING_DRIVE_FORMAT) {
    return {
      ok: false,
      error: 'This file is not a CubeLab Training cloud backup.',
    }
  }
  if (value.version !== TRAINING_DRIVE_VERSION) {
    return {
      ok: false,
      error: 'This Training cloud backup uses an unsupported envelope version.',
    }
  }
  if (typeof value.deviceId !== 'string' || value.deviceId.trim().length === 0) {
    return { ok: false, error: 'The Training cloud backup has no device identity.' }
  }
  if (typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))) {
    return { ok: false, error: 'The Training cloud backup has an invalid export time.' }
  }
  const training = parseTrainingBackupSection(value.training)
  if (!training.ok) return { ok: false, error: training.error }
  return {
    ok: true,
    backup: {
      app: TRAINING_DRIVE_APP,
      format: TRAINING_DRIVE_FORMAT,
      version: TRAINING_DRIVE_VERSION,
      deviceId: value.deviceId,
      exportedAt: value.exportedAt,
      training: training.section,
      // Preserve an optional Phase 2 sync envelope without interpreting it.
      ...(value.sync !== undefined ? { sync: value.sync } : {}),
    },
  }
}

export function summarizeTrainingDriveBackup(
  backup: TrainingDriveBackup,
): TrainingBackupSummary {
  return summarizeTrainingData(backup.training.data)
}

function requireTrainingTransport(transport: DriveTransport): asserts transport is DriveTransport & {
  listTrainingBackups: () => Promise<DriveFile[]>
  uploadTrainingBackup: (content: string, deviceId: string) => Promise<DriveFile>
} {
  if (!transport.listTrainingBackups || !transport.uploadTrainingBackup) {
    throw new Error(
      'Training cloud backup is unavailable for this Google Drive transport.',
    )
  }
}

export async function listTrainingRemoteBackups(
  transport: DriveTransport,
): Promise<DriveFile[]> {
  requireTrainingTransport(transport)
  return transport.listTrainingBackups()
}

export async function readTrainingRemoteBackups(
  transport: DriveTransport,
  files?: DriveFile[],
): Promise<TrainingRemoteSnapshot[]> {
  const remoteFiles = files ?? (await listTrainingRemoteBackups(transport))
  const snapshots: TrainingRemoteSnapshot[] = []
  for (const file of remoteFiles) {
    if (
      typeof file.size === 'number' &&
      Number.isFinite(file.size) &&
      file.size > MAX_TRAINING_DRIVE_BYTES
    ) {
      throw new Error(
        `Training snapshot ${file.name} is too large to restore.`,
      )
    }
    const raw = await transport.downloadBackup(file.id)
    const parsed = parseTrainingDriveBackup(raw)
    if (!parsed.ok) throw new Error(parsed.error)
    const exported = Date.parse(parsed.backup.exportedAt)
    const syncUpdatedAt = isRecord(parsed.backup.sync)
      ? parsed.backup.sync.updatedAt
      : undefined
    snapshots.push({
      file,
      backup: parsed.backup,
      updatedAt:
        typeof syncUpdatedAt === 'number' && Number.isFinite(syncUpdatedAt)
          ? syncUpdatedAt
          : exported,
    })
  }
  return snapshots.sort(
    (left, right) =>
      right.updatedAt - left.updatedAt ||
      (right.file.modifiedTime ?? '').localeCompare(left.file.modifiedTime ?? '') ||
      left.file.name.localeCompare(right.file.name) ||
      left.file.id.localeCompare(right.file.id),
  )
}

export async function uploadTrainingRemoteBackup(
  transport: DriveTransport,
  content: string,
  deviceId: string,
): Promise<DriveFile> {
  requireTrainingTransport(transport)
  return transport.uploadTrainingBackup(content, deviceId)
}

function isOwnTrainingFile(file: DriveFile, deviceId: string): boolean {
  return (
    file.appProperties?.deviceId === deviceId ||
    file.name.startsWith(`${'cubelab-training'}-${sanitizeDeviceId(deviceId)}-`)
  )
}

export interface TrainingCleanupResult {
  readonly deleted: number
  readonly failures: string[]
}

function trainingSnapshotModifiedMs(file: DriveFile): number | null {
  if (!file.modifiedTime) return null
  const value = Date.parse(file.modifiedTime)
  return Number.isFinite(value) ? value : null
}

function trainingSnapshotDeviceKey(file: DriveFile): string {
  const deviceId = file.appProperties?.deviceId
  if (typeof deviceId === 'string' && deviceId.trim()) return `device:${deviceId}`
  const base = file.name.endsWith('.json') ? file.name.slice(0, -5) : file.name
  return `name:${base.replace(/[0-9a-f]{8}-[0-9a-f-]{20,}$/i, '').replace(/-\d{10,}-[a-z0-9]+$/i, '')}`
}

/**
 * Select superseded Training snapshots. The newest file of every device is
 * always retained; only Training names can ever be selected.
 */
export function selectTrainingSnapshotsForCleanup(
  files: ReadonlyArray<DriveFile>,
  options: {
    keepPerDevice: number
    maxAgeDays: number
    publishedFileId?: string
    now?: number
  },
): DriveFile[] {
  const now = options.now ?? Date.now()
  const keep = Math.max(1, Math.floor(options.keepPerDevice))
  const maxAgeMs = Math.max(0, options.maxAgeDays) * 86_400_000
  const groups = new Map<string, DriveFile[]>()
  for (const file of files) {
    if (!isDriveTrainingFileName(file.name)) continue
    const key = trainingSnapshotDeviceKey(file)
    const group = groups.get(key)
    if (group) group.push(file)
    else groups.set(key, [file])
  }
  const selected: DriveFile[] = []
  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        (trainingSnapshotModifiedMs(right) ?? 0) -
          (trainingSnapshotModifiedMs(left) ?? 0) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    )
    group.forEach((file, index) => {
      if (file.id === options.publishedFileId) return
      if (index === 0) return
      const modified = trainingSnapshotModifiedMs(file)
      const withinCount = index < keep
      const withinAge = modified === null ? true : now - modified <= maxAgeMs
      if (!withinCount || !withinAge) selected.push(file)
    })
  }
  return selected
}

/** Best-effort separate Training retention. Solve ids are never in the list. */
export async function cleanupTrainingRemoteSnapshots(
  transport: DriveTransport,
  files: ReadonlyArray<DriveFile>,
  options: {
    keepPerDevice: number
    maxAgeDays: number
    publishedFileId?: string
  },
): Promise<TrainingCleanupResult> {
  const candidates = selectTrainingSnapshotsForCleanup(files, options)
  let deleted = 0
  const failures: string[] = []
  for (const file of candidates) {
    try {
      await transport.deleteBackup(file.id)
      deleted += 1
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Unknown error'
      if (!text.toLowerCase().includes('not found')) {
        failures.push(`${file.name}: ${text}`)
      }
    }
  }
  return { deleted, failures }
}

/**
 * Best-effort cleanup of this device's superseded Training snapshots. Only
 * `cubelab-training-*` ids are ever passed to deleteBackup; solve snapshots
 * and other devices' newest Training files are never selected.
 */
export async function cleanupOwnTrainingRemoteBackups(
  transport: DriveTransport,
  files: ReadonlyArray<DriveFile>,
  deviceId: string,
  keep = TRAINING_DRIVE_KEEP_OWN_SNAPSHOTS,
): Promise<TrainingCleanupResult> {
  const own = files
    .filter((file) => isDriveTrainingFileName(file.name) && isOwnTrainingFile(file, deviceId))
    .sort(
      (left, right) =>
        (right.modifiedTime ?? '').localeCompare(left.modifiedTime ?? '') ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    )
  const superseded = own.slice(Math.max(1, keep))
  const failures: string[] = []
  let deleted = 0
  for (const file of superseded) {
    try {
      await transport.deleteBackup(file.id)
      deleted += 1
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'Unknown error')
    }
  }
  return { deleted, failures }
}

export {
  isDriveTrainingFileName,
  trainingSnapshotFileName,
}
