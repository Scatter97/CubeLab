import type { SessionsData } from '../types'
import { countSolves } from './sessions'
import { SETTINGS_FIELD_KEYS } from './settingsMerge'
import type {
  SettingsFieldUpdates,
  SyncStatus,
  SyncStorageData,
} from './syncStorage'

/**
 * Detached sync base for a native import or Drive restore. The candidate is
 * computed before any committed key is overwritten so the previous metadata can
 * be captured by the replacement journal.
 */
export function createResetBaseSyncStorage(
  current: SyncStorageData,
  data: SessionsData,
  now = Date.now(),
): SyncStorageData {
  const editorId = current.runtime.deviceId
  const settingsFieldUpdates: SettingsFieldUpdates = {}
  for (const key of SETTINGS_FIELD_KEYS) {
    settingsFieldUpdates[key] = { updatedAt: now, editorId }
  }
  return {
    ...current,
    runtime: {
      ...current.runtime,
      tombstones: [],
      conflicts: [],
      sessionRedirects: [],
      pendingDuplicateNames: [],
      settingsFieldUpdates,
      // Force the next run to publish the explicit replacement instead of
      // treating it as already confirmed.
      lastSyncedFingerprint: null,
      solveCountAtLastSync: countSolves(data.sessions),
      lastSyncStatus: current.preferences.enabled
        ? ('pending' as SyncStatus)
        : current.runtime.lastSyncStatus,
      blockedOutputFingerprint: null,
    },
  }
}

/**
 * Additive imports expand the collection. Preserve tombstones, redirects,
 * approvals, field metadata and unrelated review state; only the published
 * fingerprint/count and pending status are refreshed.
 */
export function createAdditiveImportSyncStorage(
  current: SyncStorageData,
  data: SessionsData,
): SyncStorageData {
  const keepConflict = current.runtime.lastSyncStatus === 'conflict'
  return {
    ...current,
    runtime: {
      ...current.runtime,
      lastSyncedFingerprint: null,
      solveCountAtLastSync: countSolves(data.sessions),
      lastSyncStatus: current.preferences.enabled
        ? keepConflict
          ? ('conflict' as SyncStatus)
          : ('pending' as SyncStatus)
        : current.runtime.lastSyncStatus,
      blockedOutputFingerprint: null,
    },
  }
}
