import type { DriveFile } from './driveTransport'

/**
 * Same-origin writes (automatic sync and manual backup) share this lock. It
 * serializes the re-check and the Drive write, which removes the avoidable
 * same-browser-tab race. It is not a remote transaction: Google Drive does not
 * provide a verified compare-and-swap for media uploads, so a copied browser
 * profile that shares a device ID can still write between the re-check and the
 * request.
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
 * Best-effort optimistic check for the current device's own snapshot. A changed
 * ID, name, or modification time means another writer touched the file after we
 * read it. The comparison is deliberately conservative: any doubt aborts the
 * write and lets the next merge run again.
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
