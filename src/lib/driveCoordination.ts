import type { DriveFile } from './driveTransport'

/**
 * Same-origin writes (automatic sync and manual backup) share this lock. It
 * serializes the local-change re-check and the Drive request so two tabs in one
 * browser do not interleave their writes. It is **not** a remote transaction.
 *
 * Per-device snapshots are now immutable and uniquely named, so a write can no
 * longer overwrite another writer's data and the lock no longer pretends to
 * make overwriting safe. The optimistic re-check in `ownSnapshotChanged` remains
 * only for legacy single-file transports whose fixed-name file is still
 * mutable. Those writes also carry a Google Drive v2 ETag through `If-Match`,
 * which the provider enforces with HTTP 412 when the file changed; that is a
 * verified conditional update for one file, not a transaction across files.
 */
export const DRIVE_WRITE_LOCK_NAME = 'cubelab-drive-write'

export interface DriveLockManager {
  request<T>(
    name: string,
    options: { mode?: 'exclusive' | 'shared'; ifAvailable?: boolean },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T>
}

export function getDriveLockManager(): DriveLockManager | null {
  if (typeof navigator === 'undefined') return null
  const locks = (navigator as Navigator & { locks?: DriveLockManager }).locks
  return locks ?? null
}

/**
 * Runs a remote write under the shared Web Lock when the browser supports it.
 * Without Web Locks the task still runs; callers must treat that as best effort
 * and keep their own optimistic re-check.
 */
export async function runWithDriveWriteLock<T>(
  task: () => Promise<T>,
  lockManager: DriveLockManager | null = getDriveLockManager(),
): Promise<T> {
  if (!lockManager) return task()
  return lockManager.request(
    DRIVE_WRITE_LOCK_NAME,
    { mode: 'exclusive' },
    async () => task(),
  )
}

/**
 * Best-effort optimistic check for a legacy transport's single mutable file. A
 * changed ID, name, or modification time means another writer touched the file
 * after we read it. The comparison is deliberately conservative: any doubt
 * aborts the write and lets the next merge run again. Per-device transports do
 * not need this: their uniquely named snapshots are immutable, so a concurrent
 * writer (including one sharing this device ID) cannot be overwritten.
 */
export function ownSnapshotChanged(
  expected: DriveFile | undefined | null,
  current: DriveFile | undefined | null,
): boolean {
  if (!expected && !current) return false
  if (!expected || !current) return true
  return (
    expected.id !== current.id ||
    expected.name !== current.name ||
    expected.modifiedTime !== current.modifiedTime
  )
}
