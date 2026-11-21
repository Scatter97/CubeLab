/**
 * Separate local ledger for Training synchronization.
 *
 * This key is deliberately independent from `cubelab:sync:v1`. It never enters
 * solve envelopes, solve snapshots or solve cleanup. Clearing it loses Training
 * deletion provenance and conflict approvals but leaves local history intact.
 */
import type { StorageLike } from './storage'
import { isSiteResetInProgress } from './siteReset'
import {
  DEFAULT_SNAPSHOT_KEEP_PER_DEVICE,
  DEFAULT_SNAPSHOT_MAX_AGE_DAYS,
  isSnapshotKeepPerDevice,
  isSnapshotMaxAgeDays,
  type SnapshotKeepPerDevice,
  type SnapshotMaxAgeDays,
} from './snapshotRetention'

export const TRAINING_SYNC_STORAGE_KEY = 'cubelab:training-sync:v1'
export const TRAINING_SYNC_STORAGE_VERSION = 1

export type TrainingTombstoneKind = 'attempt' | 'visit' | 'preset'

export interface TrainingTombstone {
  kind: TrainingTombstoneKind
  id: string
  /** Attempt deletions carry their visit for diagnostics. */
  visitId?: string
  /** Visit deletions carry the attempt IDs known to the deleting device. */
  attemptIds?: string[]
  deletedAt: number
  deletedByDeviceId: string
  /** A later Undo revokes the deletion without removing its provenance. */
  restoredAt?: number
}

export interface TrainingFieldUpdate {
  updatedAt: number
  editorId: string
}

export interface TrainingFieldUpdates {
  preferences?: TrainingFieldUpdate
  recognitionCounts?: TrainingFieldUpdate
}

export type TrainingSyncConflictKind =
  | 'attempt'
  | 'visit'
  | 'calibration'
  | 'preset'
  | 'algorithm'
  | 'preferences'
  | 'recognitionCounts'

export interface TrainingSyncConflict {
  id: string
  kind: TrainingSyncConflictKind
  field: string
  localValue: unknown
  remoteValue: unknown
  localUpdatedAt: number
  remoteUpdatedAt: number
  resolution: 'local' | 'remote' | 'manual-pending'
  updatedAt: number
}

export interface TrainingSyncPreferences {
  enabled: boolean
  syncOnStartup: boolean
  manualConflictReview: boolean
  snapshotCleanupEnabled: boolean
  snapshotKeepPerDevice: SnapshotKeepPerDevice
  snapshotMaxAgeDays: SnapshotMaxAgeDays
}

export type TrainingSyncStatus =
  | 'disabled'
  | 'synced'
  | 'pending'
  | 'syncing'
  | 'offline'
  | 'failed'
  | 'conflict'

export interface TrainingSyncStorageData {
  version: typeof TRAINING_SYNC_STORAGE_VERSION
  preferences: TrainingSyncPreferences
  runtime: {
    deviceId: string
    lastSyncAt: number | null
    lastSyncStatus: TrainingSyncStatus
    lastError: string | null
    lastRemoteRevision: number | null
    lastSyncedFingerprint: string | null
    tombstones: TrainingTombstone[]
    fieldUpdates: TrainingFieldUpdates
    conflicts: TrainingSyncConflict[]
  }
}

export const DEFAULT_TRAINING_SYNC_PREFERENCES: TrainingSyncPreferences = {
  enabled: false,
  syncOnStartup: true,
  manualConflictReview: true,
  snapshotCleanupEnabled: true,
  snapshotKeepPerDevice: DEFAULT_SNAPSHOT_KEEP_PER_DEVICE,
  snapshotMaxAgeDays: DEFAULT_SNAPSHOT_MAX_AGE_DAYS,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function isTrainingTombstone(value: unknown): value is TrainingTombstone {
  if (!isRecord(value)) return false
  if (
    value.kind !== 'attempt' &&
    value.kind !== 'visit' &&
    value.kind !== 'preset'
  )
    return false
  if (typeof value.id !== 'string' || value.id.length === 0) return false
  if (!isFiniteTimestamp(value.deletedAt)) return false
  if (
    typeof value.deletedByDeviceId !== 'string' ||
    value.deletedByDeviceId.length === 0
  )
    return false
  if (value.visitId !== undefined && typeof value.visitId !== 'string') return false
  if (
    value.attemptIds !== undefined &&
    (!Array.isArray(value.attemptIds) ||
      !value.attemptIds.every((id) => typeof id === 'string' && id.length > 0))
  )
    return false
  if (value.restoredAt !== undefined && !isFiniteTimestamp(value.restoredAt))
    return false
  return true
}

export function isActiveTrainingTombstone(tombstone: TrainingTombstone): boolean {
  return (
    tombstone.restoredAt === undefined ||
    tombstone.restoredAt <= tombstone.deletedAt
  )
}

export function isTrainingSyncConflict(
  value: unknown,
): value is TrainingSyncConflict {
  if (!isRecord(value)) return false
  if (
    value.kind !== 'attempt' &&
    value.kind !== 'visit' &&
    value.kind !== 'calibration' &&
    value.kind !== 'preset' &&
    value.kind !== 'algorithm' &&
    value.kind !== 'preferences' &&
    value.kind !== 'recognitionCounts'
  )
    return false
  if (typeof value.id !== 'string' || value.id.length === 0) return false
  if (typeof value.field !== 'string' || value.field.length === 0) return false
  if (!('localValue' in value) || !('remoteValue' in value)) return false
  if (!isFiniteTimestamp(value.localUpdatedAt)) return false
  if (!isFiniteTimestamp(value.remoteUpdatedAt)) return false
  if (!isFiniteTimestamp(value.updatedAt)) return false
  return (
    value.resolution === 'local' ||
    value.resolution === 'remote' ||
    value.resolution === 'manual-pending'
  )
}

function isFieldUpdate(value: unknown): value is TrainingFieldUpdate {
  return (
    isRecord(value) &&
    isFiniteTimestamp(value.updatedAt) &&
    typeof value.editorId === 'string' &&
    value.editorId.length > 0
  )
}

export function parseTrainingFieldUpdates(value: unknown): TrainingFieldUpdates {
  if (!isRecord(value)) return {}
  const updates: TrainingFieldUpdates = {}
  if (isFieldUpdate(value.preferences)) {
    updates.preferences = {
      updatedAt: value.preferences.updatedAt,
      editorId: value.preferences.editorId,
    }
  }
  if (isFieldUpdate(value.recognitionCounts)) {
    updates.recognitionCounts = {
      updatedAt: value.recognitionCounts.updatedAt,
      editorId: value.recognitionCounts.editorId,
    }
  }
  return updates
}

export function createTrainingDeviceId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `training-device-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

let cachedTrainingDeviceId: string | null = null

export function resetTrainingDeviceIdCacheForTests(): void {
  cachedTrainingDeviceId = null
}

function fallbackDeviceId(): string {
  cachedTrainingDeviceId ??= createTrainingDeviceId()
  return cachedTrainingDeviceId
}

function normalizePreferences(value: unknown): TrainingSyncPreferences {
  const fallback = { ...DEFAULT_TRAINING_SYNC_PREFERENCES }
  if (!isRecord(value)) return fallback
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
    syncOnStartup:
      typeof value.syncOnStartup === 'boolean'
        ? value.syncOnStartup
        : fallback.syncOnStartup,
    manualConflictReview:
      typeof value.manualConflictReview === 'boolean'
        ? value.manualConflictReview
        : fallback.manualConflictReview,
    snapshotCleanupEnabled:
      typeof value.snapshotCleanupEnabled === 'boolean'
        ? value.snapshotCleanupEnabled
        : fallback.snapshotCleanupEnabled,
    snapshotKeepPerDevice: isSnapshotKeepPerDevice(value.snapshotKeepPerDevice)
      ? value.snapshotKeepPerDevice
      : fallback.snapshotKeepPerDevice,
    snapshotMaxAgeDays: isSnapshotMaxAgeDays(value.snapshotMaxAgeDays)
      ? value.snapshotMaxAgeDays
      : fallback.snapshotMaxAgeDays,
  }
}

export function createDefaultTrainingSyncStorage(
  deviceId = fallbackDeviceId(),
): TrainingSyncStorageData {
  return {
    version: TRAINING_SYNC_STORAGE_VERSION,
    preferences: { ...DEFAULT_TRAINING_SYNC_PREFERENCES },
    runtime: {
      deviceId,
      lastSyncAt: null,
      lastSyncStatus: 'disabled',
      lastError: null,
      lastRemoteRevision: null,
      lastSyncedFingerprint: null,
      tombstones: [],
      fieldUpdates: {},
      conflicts: [],
    },
  }
}

function parseStrictFieldUpdates(value: unknown): TrainingFieldUpdates | null {
  if (value === undefined) return {}
  if (!isRecord(value)) return null
  if (
    value.preferences !== undefined &&
    !isFieldUpdate(value.preferences)
  ) {
    return null
  }
  if (
    value.recognitionCounts !== undefined &&
    !isFieldUpdate(value.recognitionCounts)
  ) {
    return null
  }
  return parseTrainingFieldUpdates(value)
}

function normalizedSyncStatus(
  value: unknown,
  enabled: boolean,
): TrainingSyncStatus {
  // A crash during a run can leave 'syncing' behind. It is never a durable
  // resting state; treat it as pending (or disabled) so the manual action is
  // available after reload.
  if (value === 'syncing') return enabled ? 'pending' : 'disabled'
  if (
    value === 'disabled' ||
    value === 'synced' ||
    value === 'pending' ||
    value === 'offline' ||
    value === 'failed' ||
    value === 'conflict'
  ) {
    return value
  }
  return enabled ? 'pending' : 'disabled'
}

export function parseTrainingSyncStorage(
  value: unknown,
): TrainingSyncStorageData | null {
  if (!isRecord(value) || value.version !== TRAINING_SYNC_STORAGE_VERSION) {
    return null
  }
  const sourceRuntime = isRecord(value.runtime) ? value.runtime : {}
  const deviceId =
    typeof sourceRuntime.deviceId === 'string' &&
    sourceRuntime.deviceId.length > 0
      ? sourceRuntime.deviceId
      : fallbackDeviceId()
  cachedTrainingDeviceId = deviceId
  // Deletion provenance and conflict approvals are data. If any entry is
  // malformed, reject the whole ledger rather than silently dropping an entry
  // that may represent a deletion. Callers preserve the original bytes.
  if (
    sourceRuntime.tombstones !== undefined &&
    (!Array.isArray(sourceRuntime.tombstones) ||
      !sourceRuntime.tombstones.every(isTrainingTombstone))
  ) {
    return null
  }
  if (
    sourceRuntime.conflicts !== undefined &&
    (!Array.isArray(sourceRuntime.conflicts) ||
      !sourceRuntime.conflicts.every(isTrainingSyncConflict))
  ) {
    return null
  }
  const fieldUpdates = parseStrictFieldUpdates(sourceRuntime.fieldUpdates)
  if (fieldUpdates === null) return null
  const preferences = normalizePreferences(value.preferences)
  return {
    version: TRAINING_SYNC_STORAGE_VERSION,
    preferences,
    runtime: {
      deviceId,
      lastSyncAt: isFiniteTimestamp(sourceRuntime.lastSyncAt)
        ? sourceRuntime.lastSyncAt
        : null,
      lastSyncStatus: normalizedSyncStatus(
        sourceRuntime.lastSyncStatus,
        preferences.enabled,
      ),
      lastError:
        typeof sourceRuntime.lastError === 'string'
          ? sourceRuntime.lastError
          : null,
      lastRemoteRevision: isFiniteTimestamp(sourceRuntime.lastRemoteRevision)
        ? sourceRuntime.lastRemoteRevision
        : null,
      lastSyncedFingerprint:
        typeof sourceRuntime.lastSyncedFingerprint === 'string' &&
        sourceRuntime.lastSyncedFingerprint.length > 0
          ? sourceRuntime.lastSyncedFingerprint
          : null,
      tombstones: Array.isArray(sourceRuntime.tombstones)
        ? sourceRuntime.tombstones
        : [],
      fieldUpdates,
      conflicts: Array.isArray(sourceRuntime.conflicts)
        ? sourceRuntime.conflicts
        : [],
    },
  }
}

/**
 * Keeps the device identity and preferences but forgets every deletion,
 * approval and last-run fingerprint. Used after a replace-only Training
 * restore so an older tombstone cannot delete a restored record.
 */
export function clearTrainingSyncProvenance(
  data: TrainingSyncStorageData = loadTrainingSyncStorage(),
): TrainingSyncStorageData {
  return {
    ...data,
    runtime: {
      ...data.runtime,
      lastSyncAt: null,
      lastSyncStatus: data.preferences.enabled ? 'pending' : 'disabled',
      lastError: null,
      lastRemoteRevision: null,
      lastSyncedFingerprint: null,
      tombstones: [],
      fieldUpdates: {},
      conflicts: [],
    },
  }
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

export function loadTrainingSyncStorage(
  storage: StorageLike | null = getDefaultStorage(),
): TrainingSyncStorageData {
  if (!storage) return createDefaultTrainingSyncStorage()
  let raw: string | null
  try {
    raw = storage.getItem(TRAINING_SYNC_STORAGE_KEY)
  } catch {
    return createDefaultTrainingSyncStorage()
  }
  if (!raw) {
    const data = createDefaultTrainingSyncStorage()
    if (!isSiteResetInProgress()) {
      try {
        storage.setItem(TRAINING_SYNC_STORAGE_KEY, JSON.stringify(data))
      } catch {
        // The ledger is derived; a failed first write is reported by mutations.
      }
    }
    return data
  }
  try {
    const parsed = parseTrainingSyncStorage(JSON.parse(raw))
    if (parsed) return parsed
  } catch {
    // Fall through to the conservative default without overwriting the bytes.
  }
  const fallback = createDefaultTrainingSyncStorage()
  fallback.runtime.lastError =
    'The Training synchronization record is unreadable. Deletion provenance and conflict approvals were not loaded; local Training history is unchanged.'
  return fallback
}

export function trainingSyncStorageWarning(
  storage: StorageLike | null = getDefaultStorage(),
): string | null {
  if (!storage) return null
  let raw: string | null
  try {
    raw = storage.getItem(TRAINING_SYNC_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    return parseTrainingSyncStorage(JSON.parse(raw)) ? null : loadTrainingSyncStorage(storage).runtime.lastError
  } catch {
    return loadTrainingSyncStorage(storage).runtime.lastError
  }
}

export function saveTrainingSyncStorage(
  data: TrainingSyncStorageData,
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  if (!storage || isSiteResetInProgress()) return false
  try {
    const existing = storage.getItem(TRAINING_SYNC_STORAGE_KEY)
    if (existing) {
      // Never overwrite unreadable provenance bytes with a fresh ledger. The
      // caller must surface the warning and leave local Training untouched.
      const parsed = parseTrainingSyncStorage(JSON.parse(existing))
      if (!parsed) return false
    }
  } catch {
    return false
  }
  try {
    storage.setItem(TRAINING_SYNC_STORAGE_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export function getTrainingDeviceId(
  storage: StorageLike | null = getDefaultStorage(),
): string {
  return loadTrainingSyncStorage(storage).runtime.deviceId
}
