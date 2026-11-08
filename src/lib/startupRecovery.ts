import {
  DRIVE_WRITE_LOCK_NAME,
  getDriveLockManager,
  type DriveLockManager,
} from './driveCoordination'
import {
  getDefaultReplacementStorage,
  loadReplacementJournal,
  recoverPendingReplacement,
  type ReplacementRecovery,
} from './replacement'
import type { StorageLike } from './storage'

export type StartupReplacementResult =
  | { status: 'ready'; recovery: ReplacementRecovery }
  | { status: 'blocked'; message: string }

export interface StartupReplacementOptions {
  storage?: StorageLike | null
  lockManager?: DriveLockManager | null
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

async function recoverPreparedUnderLock(
  storage: StorageLike,
  lockManager: DriveLockManager,
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
  return recoverPreparedUnderLock(storage, lockManager)
}
