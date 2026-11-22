import {
  DRIVE_WRITE_LOCK_NAME,
  getDriveLockManager,
  type DriveLockManager,
} from './driveCoordination'
import {
  getDefaultReplacementStorage,
  clearReplacementJournal,
  loadReplacementJournal,
  recoverPendingReplacement,
  type ReplacementJournal,
  type ReplacementRecovery,
} from './replacement'
import {
  openDefaultUpgradeArchiveStore,
  verifyUpgradeArchiveRecord,
  type UpgradeArchiveStore,
} from './upgradeArchive'
import type { StorageLike } from './storage'

export type StartupReplacementResult =
  | { status: 'ready'; recovery: ReplacementRecovery }
  | { status: 'blocked'; message: string }

export interface StartupReplacementOptions {
  storage?: StorageLike | null
  lockManager?: DriveLockManager | null
  archiveStore?: UpgradeArchiveStore
}

const PREPARED_PENDING_MESSAGE =
  'CubeLab could not finish rolling back an interrupted replacement. The previous data has not been opened for editing. Free browser storage, then retry.'

const NO_LOCK_MESSAGE =
  'A replacement recovery record is pending and this browser cannot coordinate recovery with other CubeLab tabs. The editable application stays closed. Close other CubeLab tabs, then retry.'

function blockedFromLoad(
  loaded: Exclude<
    ReturnType<typeof loadReplacementJournal>,
    { status: 'none' | 'ok' }
  >,
): StartupReplacementResult {
  return { status: 'blocked', message: loaded.message }
}

function recoveryResult(
  recovery: ReplacementRecovery,
  wasPrepared: boolean,
): StartupReplacementResult {
  if (recovery.status === 'invalid') {
    return { status: 'blocked', message: recovery.message }
  }
  if (recovery.status === 'cleanup-pending' && wasPrepared) {
    return { status: 'blocked', message: PREPARED_PENDING_MESSAGE }
  }
  return { status: 'ready', recovery }
}

async function rollbackArchivedReplacement(
  journal: ReplacementJournal,
  storage: StorageLike,
  archiveStore: UpgradeArchiveStore | undefined,
): Promise<{ ok: boolean; message?: string }> {
  if (!journal.archiveId) return { ok: false, message: 'The upgrade archive ID is missing.' }
  let store = archiveStore
  if (!store) {
    try {
      store = await openDefaultUpgradeArchiveStore(storage)
    } catch {
      return {
        ok: false,
        message:
          'The pre-upgrade archive could not be opened, so the interrupted upgrade was not rolled back.',
      }
    }
  }
  let archive = await store.get(journal.archiveId)
  if (!archive || !verifyUpgradeArchiveRecord(archive)) {
    return {
      ok: false,
      message:
        'The verified pre-upgrade archive is missing or damaged. Editing stays blocked to protect the original data.',
    }
  }
  for (const [key, entry] of Object.entries(archive.entries)) {
    try {
      if (entry.present) {
        storage.setItem(key, entry.raw!)
      } else {
        if (!storage.removeItem) {
          return {
            ok: false,
            message: 'This browser cannot remove an upgraded record during rollback.',
          }
        }
        storage.removeItem(key)
      }
    } catch {
      return {
        ok: false,
        message:
          'The pre-upgrade archive could not be written back. Free browser storage, then retry.',
      }
    }
  }
  for (const [key, entry] of Object.entries(archive.entries)) {
    let actual: string | null
    try {
      actual = storage.getItem(key)
    } catch {
      actual = null
    }
    if (actual !== (entry.present ? entry.raw : null)) {
      return {
        ok: false,
        message:
          'The pre-upgrade archive did not read back exactly. Editing stays blocked.',
      }
    }
  }
  return { ok: true }
}

async function recoverPreparedUnderLock(
  storage: StorageLike,
  lockManager: DriveLockManager,
  archiveStore: UpgradeArchiveStore | undefined,
): Promise<StartupReplacementResult> {
  try {
    return await lockManager.request(
      DRIVE_WRITE_LOCK_NAME,
      { mode: 'exclusive' },
      async () => {
        // The writer may have committed or removed its record while this tab
        // waited for the same write boundary. Re-read before deciding.
        const loaded = loadReplacementJournal(storage)
        if (loaded.status === 'none') {
          return { status: 'ready', recovery: { status: 'none' } }
        }
        if (loaded.status === 'invalid') return blockedFromLoad(loaded)
        if (loaded.journal.phase === 'committed') {
          return recoveryResult(
            recoverPendingReplacement(storage),
            false,
          )
        }
        if (loaded.journal.archiveId) {
          const rolledBack = await rollbackArchivedReplacement(
            loaded.journal,
            storage,
            archiveStore,
          )
          if (!rolledBack.ok) {
            return {
              status: 'blocked',
              message:
                rolledBack.message ??
                'The interrupted upgrade could not be rolled back.',
            }
          }
          if (!clearReplacementJournal(storage)) {
            return {
              status: 'blocked',
              message:
                'The previous data was restored, but the upgrade recovery record could not be cleared. Free browser storage, then retry.',
            }
          }
          return { status: 'ready', recovery: { status: 'rolled-back' } }
        }
        return recoveryResult(
          recoverPendingReplacement(storage),
          true,
        )
      },
    )
  } catch {
    return {
      status: 'blocked',
      message:
        'CubeLab could not acquire the shared replacement write boundary. The editable application stays closed until recovery can be retried safely.',
    }
  }
}

/**
 * Resolves a durable replacement before the normal application mounts.
 *
 * A committed journal only needs cleanup and can open normally. A prepared
 * journal is never rolled back until this tab holds the same origin-wide write
 * lock used by the replacement coordinator. Without Web Locks a prepared record
 * stays pending conservatively rather than assuming another writer is gone.
 */
export async function recoverReplacementAtStartup(
  options: StartupReplacementOptions = {},
): Promise<StartupReplacementResult> {
  const storage =
    options.storage === undefined
      ? getDefaultReplacementStorage()
      : options.storage
  if (!storage) {
    // No storage API means no staged replacement can be observed. Keep the
    // documented memory-only behavior instead of disabling the whole app.
    return { status: 'ready', recovery: { status: 'none' } }
  }

  const loaded = loadReplacementJournal(storage)
  if (loaded.status === 'none') {
    return { status: 'ready', recovery: { status: 'none' } }
  }
  if (loaded.status === 'invalid') return blockedFromLoad(loaded)
  if (loaded.journal.phase === 'committed') {
    return recoveryResult(recoverPendingReplacement(storage), false)
  }

  const lockManager =
    options.lockManager === undefined
      ? getDriveLockManager()
      : options.lockManager
  if (!lockManager) {
    return { status: 'blocked', message: NO_LOCK_MESSAGE }
  }
  return recoverPreparedUnderLock(
    storage,
    lockManager,
    options.archiveStore,
  )
}
