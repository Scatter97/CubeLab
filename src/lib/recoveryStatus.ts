import {
  loadSessionsChecked,
  loadSettingsChecked,
  type CheckedSettingsFailureReason,
  type CheckedSessionsFailureReason,
} from './storage'
import { loadTraining } from './training/storage'
import { loadSyncStorageChecked, type CheckedSyncStorageFailureReason } from './syncStorage'
import { loadReplacementJournal } from './replacement'
import {
  listUpgradeArchives,
  openDefaultUpgradeArchiveStore,
  type UpgradeArchiveRecord,
  type UpgradeArchiveStore,
} from './upgradeArchive'
import type { RecoveryStorage } from './recoveryPackage'

export type RecoveryStoreState =
  | 'ok'
  | 'absent'
  | 'blocked'
  | 'unavailable'

export interface RecoveryStoreStatus {
  key: string
  label: string
  state: RecoveryStoreState
  version: number | null
  message: string
}

export interface RecoveryInspection {
  storageAvailable: boolean
  stores: RecoveryStoreStatus[]
  archives: UpgradeArchiveRecord[]
  archiveStore: UpgradeArchiveStore | null
  archiveError: string | null
}

function reasonLabel(
  reason:
    | CheckedSessionsFailureReason
    | CheckedSettingsFailureReason
    | CheckedSyncStorageFailureReason
    | 'read'
    | 'invalid'
    | 'unavailable',
): string {
  switch (reason) {
    case 'invalid-json':
      return 'Invalid JSON'
    case 'invalid-schema':
      return 'Invalid schema'
    case 'unsupported-version':
      return 'Unsupported version'
    case 'read-error':
    case 'read':
      return 'Storage read failed'
    case 'unavailable':
      return 'Storage unavailable'
    case 'absent':
      return 'Not present'
    default:
      return 'Unreadable'
  }
}

function defaultStorage(): RecoveryStorage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Read-only recovery inspection. It deliberately uses the strict readers and
 * never repairs, migrates or writes anything.
 */
export async function inspectRecoveryStatus(
  storage: RecoveryStorage | null = defaultStorage(),
): Promise<RecoveryInspection> {
  if (!storage) {
    return {
      storageAvailable: false,
      stores: [],
      archives: [],
      archiveStore: null,
      archiveError: 'Browser storage is unavailable in this context.',
    }
  }

  const stores: RecoveryStoreStatus[] = []
  const sessions = loadSessionsChecked(storage)
  stores.push(
    sessions.ok
      ? {
          key: 'cubelab:sessions:v1',
          label: 'Sessions',
          state: 'ok',
          version: sessions.sourceVersion,
          message: `${sessions.data.sessions.length} session(s) validated.`,
        }
      : {
          key: 'cubelab:sessions:v1',
          label: 'Sessions',
          state: sessions.reason === 'absent' ? 'absent' : 'blocked',
          version: null,
          message:
            sessions.reason === 'absent'
              ? 'No saved session collection is present.'
              : `${reasonLabel(sessions.reason)}: ${sessions.message}`,
        },
  )

  const settings = loadSettingsChecked(storage)
  stores.push(
    settings.ok
      ? {
          key: 'cubelab:settings:v1',
          label: 'Settings',
          state: settings.sourceVersion === null ? 'absent' : 'ok',
          version: settings.sourceVersion,
          message:
            settings.sourceVersion === null
              ? 'No saved settings record is present.'
              : 'Settings validated.',
        }
      : {
          key: 'cubelab:settings:v1',
          label: 'Settings',
          state: settings.reason === 'unavailable' ? 'unavailable' : 'blocked',
          version: null,
          message: `${reasonLabel(settings.reason)}: ${settings.message}`,
        },
  )

  const training = loadTraining(storage)
  stores.push(
    training.ok
      ? {
          key: 'cubelab:training:v1',
          label: 'Training',
          state: training.raw === null ? 'absent' : 'ok',
          version: training.raw === null ? null : 1,
          message:
            training.raw === null
              ? 'No saved Training history is present.'
              : 'Training history validated.',
        }
      : {
          key: 'cubelab:training:v1',
          label: 'Training',
          state: training.reason === 'unavailable' ? 'unavailable' : 'blocked',
          version: null,
          message: `${reasonLabel(training.reason)}: ${training.error}`,
        },
  )

  const sync = loadSyncStorageChecked(storage)
  stores.push(
    sync.ok
      ? {
          key: 'cubelab:sync:v1',
          label: 'Synchronization provenance',
          state: sync.raw === null ? 'absent' : 'ok',
          version: sync.raw === null ? null : 1,
          message:
            sync.raw === null
              ? 'No synchronization record is present.'
              : 'Deletion and conflict provenance validated.',
        }
      : {
          key: 'cubelab:sync:v1',
          label: 'Synchronization provenance',
          state: sync.reason === 'unavailable' ? 'unavailable' : 'blocked',
          version: null,
          message: `${reasonLabel(sync.reason)}: ${sync.message}`,
        },
  )

  const replacement = loadReplacementJournal(storage)
  stores.push(
    replacement.status === 'none'
      ? {
          key: 'cubelab:replacement:v1',
          label: 'Replacement recovery',
          state: 'absent',
          version: null,
          message: 'No interrupted replacement is recorded.',
        }
      : replacement.status === 'ok'
        ? {
            key: 'cubelab:replacement:v1',
            label: 'Replacement recovery',
            state: 'ok',
            version: replacement.journal.version,
            message: `A ${replacement.journal.phase} ${replacement.journal.kind} replacement is recorded.`,
          }
        : {
            key: 'cubelab:replacement:v1',
            label: 'Replacement recovery',
            state: 'blocked',
            version: null,
            message: replacement.message,
          },
  )

  let archiveStore: UpgradeArchiveStore | null = null
  let archives: UpgradeArchiveRecord[] = []
  let archiveError: string | null = null
  try {
    archiveStore = await openDefaultUpgradeArchiveStore(storage)
    archives = await listUpgradeArchives(archiveStore)
  } catch (error) {
    archiveError =
      error instanceof Error
        ? error.message
        : 'Verified local archives could not be opened.'
  }

  return {
    storageAvailable: true,
    stores,
    archives,
    archiveStore,
    archiveError,
  }
}
