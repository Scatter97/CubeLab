import {
  DRIVE_BACKUP_FILE_NAME,
  DRIVE_BACKUP_FILE_PREFIX,
  sanitizeDeviceId,
  type DriveFile,
  type DriveTransport,
} from './driveTransport'

/**
 * Snapshot lifecycle policy.
 *
 * Every synchronization writes a new immutable snapshot, so the remote
 * collection grows unless old files are pruned. Cleanup only ever runs after a
 * successful full-merge publication (or on explicit user request for this
 * device's own files), and it always keeps the newest snapshot of every device
 * group. That makes an older snapshot redundant: each device's newest snapshot
 * is a full state, and an automatic run has just merged every snapshot into the
 * file it published.
 */

export const SNAPSHOT_KEEP_OPTIONS = [3, 5, 10, 20, 50] as const
export type SnapshotKeepPerDevice = (typeof SNAPSHOT_KEEP_OPTIONS)[number]
export const SNAPSHOT_MAX_AGE_OPTIONS = [7, 30, 90, 180, 365] as const
export type SnapshotMaxAgeDays = (typeof SNAPSHOT_MAX_AGE_OPTIONS)[number]
export const DEFAULT_SNAPSHOT_KEEP_PER_DEVICE: SnapshotKeepPerDevice = 10
export const DEFAULT_SNAPSHOT_MAX_AGE_DAYS: SnapshotMaxAgeDays = 30
export const SNAPSHOT_DAY_MS = 86_400_000

export function isSnapshotKeepPerDevice(
  value: unknown,
): value is SnapshotKeepPerDevice {
  return SNAPSHOT_KEEP_OPTIONS.includes(value as SnapshotKeepPerDevice)
}

export function isSnapshotMaxAgeDays(value: unknown): value is SnapshotMaxAgeDays {
  return SNAPSHOT_MAX_AGE_OPTIONS.includes(value as SnapshotMaxAgeDays)
}

/** A snapshot's modification time in epoch milliseconds, when parseable. */
export function snapshotModifiedMs(file: DriveFile): number | null {
  if (!file.modifiedTime) return null
  const parsed = Date.parse(file.modifiedTime)
  return Number.isFinite(parsed) ? parsed : null
}

const UUID_SUFFIX =
  /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FALLBACK_TOKEN_SUFFIX = /-\d{10,}-[a-z0-9]+$/i

/**
 * The name without its unique write token. Older snapshots predate the
 * `appProperties.deviceId` marker, so their sanitized device name is the only
 * stable grouping hint available.
 */
function snapshotNameBase(name: string): string {
  const withoutExtension = name.endsWith('.json') ? name.slice(0, -5) : name
  return withoutExtension
    .replace(UUID_SUFFIX, '')
    .replace(FALLBACK_TOKEN_SUFFIX, '')
}

/** The sanitized device hint embedded in a snapshot name, when present. */
function snapshotNameDeviceHint(name: string): string | null {
  const base = snapshotNameBase(name)
  if (!base.startsWith(`${DRIVE_BACKUP_FILE_PREFIX}-`)) return null
  const hint = base.slice(DRIVE_BACKUP_FILE_PREFIX.length + 1)
  return hint.length > 0 ? hint : null
}

/**
 * Stable grouping key for one device's snapshots. New files carry the owning
 * device ID in app-private metadata; older files fall back to the sanitized
 * name prefix, which groups both the legacy per-device name and the unique
 * names written by earlier immutable-snapshot builds.
 */
export function snapshotGroupKey(file: DriveFile): string {
  const deviceId = file.appProperties?.deviceId
  if (typeof deviceId === 'string' && deviceId.trim().length > 0) {
    return `device:${deviceId}`
  }
  if (file.name === DRIVE_BACKUP_FILE_NAME) return 'legacy:fixed'
  return `name:${snapshotNameBase(file.name)}`
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`
}

export interface SnapshotOwner {
  /** Human-readable owner label for the management UI. */
  label: string
  own: boolean
  /** True only for the mutable legacy `cubelab-backup.json` file. */
  legacy: boolean
  deviceId: string | null
  key: string
}

/**
 * Ownership without downloading the snapshot. The envelope device ID is not
 * available from a file listing, so this uses the app-private metadata written
 * by current builds and falls back to the file name for older snapshots.
 */
export function describeSnapshotOwner(
  file: DriveFile,
  localDeviceId: string | null,
): SnapshotOwner {
  const key = snapshotGroupKey(file)
  if (file.name === DRIVE_BACKUP_FILE_NAME) {
    return {
      label: 'Legacy shared backup',
      own: false,
      legacy: true,
      deviceId: null,
      key,
    }
  }

  const metadataDeviceId = file.appProperties?.deviceId?.trim() || null
  if (metadataDeviceId) {
    const own = Boolean(localDeviceId && metadataDeviceId === localDeviceId)
    return {
      label: own ? 'This device' : `Device ${shortId(metadataDeviceId)}`,
      own,
      legacy: false,
      deviceId: metadataDeviceId,
      key,
    }
  }

  const hint = snapshotNameDeviceHint(file.name)
  if (localDeviceId && hint === sanitizeDeviceId(localDeviceId)) {
    return {
      label: 'This device',
      own: true,
      legacy: false,
      deviceId: localDeviceId,
      key,
    }
  }
  return {
    label: hint ? `Device ${shortId(hint)}` : 'Older device snapshot',
    own: false,
    legacy: false,
    deviceId: null,
    key,
  }
}

export function isOwnSnapshotFile(
  file: DriveFile,
  localDeviceId: string | null,
): boolean {
  return describeSnapshotOwner(file, localDeviceId).own
}

export interface SnapshotGroup {
  key: string
  owner: SnapshotOwner
  /** Newest first. */
  files: DriveFile[]
}

function newestFirst(left: DriveFile, right: DriveFile): number {
  return (
    (snapshotModifiedMs(right) ?? 0) - (snapshotModifiedMs(left) ?? 0) ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  )
}

/** Groups every remote snapshot by owning device, own group first. */
export function groupRemoteSnapshots(
  files: ReadonlyArray<DriveFile>,
  localDeviceId: string | null,
): SnapshotGroup[] {
  const grouped = new Map<string, DriveFile[]>()
  for (const file of files) {
    const key = snapshotGroupKey(file)
    const group = grouped.get(key)
    if (group) group.push(file)
    else grouped.set(key, [file])
  }

  return [...grouped.entries()]
    .map(([key, groupFiles]) => {
      const sorted = [...groupFiles].sort(newestFirst)
      return {
        key,
        owner: describeSnapshotOwner(sorted[0]!, localDeviceId),
        files: sorted,
      }
    })
    .sort(
      (left, right) =>
        Number(right.owner.own) - Number(left.owner.own) ||
        left.owner.label.localeCompare(right.owner.label) ||
        left.key.localeCompare(right.key),
    )
}

export interface SnapshotCleanupOptions {
  keepPerDevice: number
  maxAgeDays: number
  now?: number
  localDeviceId?: string | null
  /** Snapshot just published by the current run; never deleted. */
  publishedFileId?: string | null
  /**
   * Only consider files modified at or before this time. A concurrent write
   * after the merge must never be deleted by this run.
   */
  publishedAt?: number | null
  /**
   * Restrict cleanup to this device's files. Used by the manual action, which
   * may run without a fresh all-snapshot merge. Automatic cleanup runs only
   * after publication and may prune every superseded device group.
   */
  ownOnly?: boolean
}

/**
 * Chooses superseded snapshots. The newest file in each device group is always
 * kept, as is the legacy mutable file and the just-published snapshot. Older
 * files are removed when they exceed either the per-device count or the age
 * threshold, so the collection stays bounded even at short sync intervals.
 */
export function selectSnapshotsForCleanup(
  files: ReadonlyArray<DriveFile>,
  options: SnapshotCleanupOptions,
): DriveFile[] {
  const now = options.now ?? Date.now()
  const keep = Math.max(1, Math.floor(options.keepPerDevice))
  const maxAgeMs = Math.max(0, options.maxAgeDays) * SNAPSHOT_DAY_MS
  // A malformed provider timestamp must not disable the publication boundary.
  const publishedAt =
    typeof options.publishedAt === 'number' &&
    Number.isFinite(options.publishedAt)
      ? options.publishedAt
      : null
  const selected: DriveFile[] = []

  for (const group of groupRemoteSnapshots(files, options.localDeviceId ?? null)) {
    if (group.owner.legacy) continue
    if (options.ownOnly && !group.owner.own) continue

    group.files.forEach((file, index) => {
      if (file.id === options.publishedFileId) return
      if (index === 0) return

      const modified = snapshotModifiedMs(file)
      if (publishedAt !== null && modified !== null && modified > publishedAt) {
        return
      }

      const withinCount = index < keep
      // A file without a parseable date cannot be judged by age; the count
      // threshold still bounds the group.
      const withinAge = modified === null ? true : now - modified <= maxAgeMs
      if (!withinCount || !withinAge) selected.push(file)
    })
  }

  return selected
}

/** Newest modification time across the listing, used as a manual boundary. */
export function newestSnapshotModifiedAt(
  files: ReadonlyArray<DriveFile>,
): number | null {
  let newest: number | null = null
  for (const file of files) {
    const modified = snapshotModifiedMs(file)
    if (modified !== null && (newest === null || modified > newest)) {
      newest = modified
    }
  }
  return newest
}

export interface SnapshotCleanupResult {
  candidates: DriveFile[]
  deleted: number
  failures: string[]
}

/**
 * Deletes selected snapshots and reports partial failures instead of claiming
 * a complete cleanup. A file already removed by another device is not a
 * failure; a real transport error is.
 */
export async function cleanupRemoteSnapshots(
  transport: DriveTransport,
  files: ReadonlyArray<DriveFile>,
  options: SnapshotCleanupOptions,
): Promise<SnapshotCleanupResult> {
  const candidates = selectSnapshotsForCleanup(files, options)
  let deleted = 0
  const failures: string[] = []

  for (const file of candidates) {
    let alreadyGone = false
    let lastError: unknown = null
    let succeeded = false
    // Retry a failed delete a few times with backoff; "not found" is treated
    // as success because the file is already gone.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await transport.deleteBackup(file.id)
        succeeded = true
        break
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.toLowerCase().includes('not found')) {
          // Already gone: treat as success for failure-reporting purposes,
          // but do not count it as a delete performed by this run.
          succeeded = true
          alreadyGone = true
          break
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt))
        }
      }
    }
    if (succeeded && !alreadyGone) {
      deleted += 1
    } else if (succeeded && alreadyGone) {
      // no-op: already removed by another device
    } else {
      const message = lastError instanceof Error ? lastError.message : 'Unknown error'
      failures.push(`${file.name}: ${message}`)
    }
  }

  return { candidates, deleted, failures }
}
