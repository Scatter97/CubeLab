
export type SyncMode = 'time' | 'solve' | 'combined'
export type SyncIntervalMinutes = 1 | 2 | 3 | 5 | 10 | 15 | 30 | 60
export type SyncSolveThreshold = 1 | 2 | 3 | 5 | 10 | 20 | 25 | 50 | 100
export type SyncStatus =
  | 'disabled'
  | 'synced'
  | 'pending'
  | 'syncing'
  | 'offline'
  | 'auth-required'
  | 'failed'
  | 'conflict'

export interface SyncPreferences {
  enabled: boolean
  mode: SyncMode
  intervalMinutes: SyncIntervalMinutes
  solveThreshold: SyncSolveThreshold
  syncOnStartup: boolean
  syncOnExit: boolean
  syncOnReconnect: boolean
  manualConflictReview: boolean
}

export interface Tombstone {
  kind: 'solve' | 'session'
  id: string
  sessionId?: string
  deletedAt: number
  deletedByDeviceId: string
  revision?: number
  /**
   * Session tombstones: solve IDs known to the deleting device at deletion time.
   * Unknown solve IDs from another offline device are recoverable even when
   * clock skew would otherwise make them look older than the deletion.
   */
  knownSolveIds?: string[]
}

export interface SyncConflict {
  id: string
  kind: 'solve' | 'session'
  sessionId?: string
  field: string
  localValue: unknown
  remoteValue: unknown
  localUpdatedAt: number
  remoteUpdatedAt: number
  resolution: 'local' | 'remote' | 'manual-pending'
  updatedAt: number
}

export interface SessionRedirect {
  fromId: string
  toId: string
  approvedAt: number
  byDeviceId?: string
}

export interface SyncStorageData {
  version: 1
  preferences: SyncPreferences
  runtime: {
    deviceId: string
    lastSyncAt: number | null
    lastSyncStatus: SyncStatus
    lastError: string | null
    solveCountAtLastSync: number
    lastRemoteRevision: number | null
    tombstones: Tombstone[]
    conflicts: SyncConflict[]
    sessionRedirects: SessionRedirect[]
    pendingDuplicateNames: string[]
  }
}

export const SYNC_STORAGE_KEY = 'cubelab:sync:v1'
export const SYNC_STORAGE_VERSION = 1

export const SYNC_INTERVAL_OPTIONS: SyncIntervalMinutes[] = [1, 2, 3, 5, 10, 15, 30, 60]
export const SYNC_THRESHOLD_OPTIONS: SyncSolveThreshold[] = [1, 2, 3, 5, 10, 20, 25, 50, 100]

export const DEFAULT_SYNC_PREFERENCES: SyncPreferences = {
  enabled: false,
  mode: 'combined',
  intervalMinutes: 5,
  solveThreshold: 10,
  syncOnStartup: true,
  syncOnExit: true,
  syncOnReconnect: true,
  manualConflictReview: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidInterval(value: unknown): value is SyncIntervalMinutes {
  return SYNC_INTERVAL_OPTIONS.includes(value as SyncIntervalMinutes)
}

function isValidThreshold(value: unknown): value is SyncSolveThreshold {
  return SYNC_THRESHOLD_OPTIONS.includes(value as SyncSolveThreshold)
}

function isTombstone(value: unknown): value is Tombstone {
  if (!isRecord(value)) return false
  if (value.kind !== 'solve' && value.kind !== 'session') return false
  if (typeof value.id !== 'string' || value.id.length === 0) return false
  if (typeof value.deletedAt !== 'number' || !Number.isFinite(value.deletedAt)) return false
  if (typeof value.deletedByDeviceId !== 'string' || value.deletedByDeviceId.length === 0) return false
  if (
    value.knownSolveIds !== undefined &&
    (!Array.isArray(value.knownSolveIds) ||
      !value.knownSolveIds.every((id) => typeof id === 'string' && id.length > 0))
  ) {
    return false
  }
  return true
}

function isConflict(value: unknown): value is SyncConflict {
  if (!isRecord(value)) return false
  if (value.kind !== 'solve' && value.kind !== 'session') return false
  if (typeof value.id !== 'string' || value.id.length === 0) return false
  if (typeof value.field !== 'string' || value.field.length === 0) return false
  if (typeof value.localUpdatedAt !== 'number' || !Number.isFinite(value.localUpdatedAt)) return false
  if (typeof value.remoteUpdatedAt !== 'number' || !Number.isFinite(value.remoteUpdatedAt)) return false
  if (value.resolution !== 'local' && value.resolution !== 'remote' && value.resolution !== 'manual-pending') return false
  return true
}

function normalizePreferences(value: unknown): SyncPreferences {
  const fallback = { ...DEFAULT_SYNC_PREFERENCES }
  if (!isRecord(value)) return fallback
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
    mode: 'combined',
    intervalMinutes: isValidInterval(value.intervalMinutes) ? value.intervalMinutes : fallback.intervalMinutes,
    solveThreshold: isValidThreshold(value.solveThreshold) ? value.solveThreshold : fallback.solveThreshold,
    syncOnStartup: typeof value.syncOnStartup === 'boolean' ? value.syncOnStartup : fallback.syncOnStartup,
    syncOnExit: typeof value.syncOnExit === 'boolean' ? value.syncOnExit : fallback.syncOnExit,
    syncOnReconnect: typeof value.syncOnReconnect === 'boolean' ? value.syncOnReconnect : fallback.syncOnReconnect,
    manualConflictReview: typeof value.manualConflictReview === 'boolean' ? value.manualConflictReview : fallback.manualConflictReview,
  }
}

export function createDeviceId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

export function createDefaultSyncStorage(deviceId = createDeviceId()): SyncStorageData {
  return {
    version: SYNC_STORAGE_VERSION,
    preferences: { ...DEFAULT_SYNC_PREFERENCES },
    runtime: {
      deviceId,
      lastSyncAt: null,
      lastSyncStatus: 'disabled',
      lastError: null,
      solveCountAtLastSync: 0,
      lastRemoteRevision: null,
      tombstones: [],
      conflicts: [],
      sessionRedirects: [],
      pendingDuplicateNames: [],
    },
  }
}

export function parseSyncStorageData(value: unknown): SyncStorageData | null {
  if (!isRecord(value)) return null
  if (value.version !== SYNC_STORAGE_VERSION) return null
  const preferences = normalizePreferences(value.preferences)
  const sourceRuntime = isRecord(value.runtime) ? value.runtime : {}
  const deviceId =
    typeof sourceRuntime.deviceId === 'string' && sourceRuntime.deviceId.length > 0
      ? sourceRuntime.deviceId
      : createDeviceId()
  const tombstones = Array.isArray(sourceRuntime.tombstones)
    ? sourceRuntime.tombstones.filter(isTombstone)
    : []
  const conflicts = Array.isArray(sourceRuntime.conflicts)
    ? sourceRuntime.conflicts.filter(isConflict)
    : []
  const isRedirect = (value: unknown): value is SessionRedirect =>
    isRecord(value) &&
    typeof value.fromId === 'string' &&
    value.fromId.length > 0 &&
    typeof value.toId === 'string' &&
    value.toId.length > 0 &&
    value.fromId !== value.toId &&
    typeof value.approvedAt === 'number' &&
    Number.isFinite(value.approvedAt)
  const sessionRedirects = Array.isArray(sourceRuntime.sessionRedirects)
    ? sourceRuntime.sessionRedirects.filter(isRedirect)
    : []
  const pendingDuplicateNames = Array.isArray(sourceRuntime.pendingDuplicateNames)
    ? sourceRuntime.pendingDuplicateNames.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const lastSyncStatus =
    sourceRuntime.lastSyncStatus === 'disabled' ||
    sourceRuntime.lastSyncStatus === 'synced' ||
    sourceRuntime.lastSyncStatus === 'pending' ||
    sourceRuntime.lastSyncStatus === 'syncing' ||
    sourceRuntime.lastSyncStatus === 'offline' ||
    sourceRuntime.lastSyncStatus === 'auth-required' ||
    sourceRuntime.lastSyncStatus === 'failed' ||
    sourceRuntime.lastSyncStatus === 'conflict'
      ? sourceRuntime.lastSyncStatus
      : preferences.enabled
        ? 'pending'
        : 'disabled'

  return {
    version: SYNC_STORAGE_VERSION,
    preferences,
    runtime: {
      deviceId,
      lastSyncAt:
        typeof sourceRuntime.lastSyncAt === 'number' && Number.isFinite(sourceRuntime.lastSyncAt)
          ? sourceRuntime.lastSyncAt
          : null,
      lastSyncStatus,
      lastError: typeof sourceRuntime.lastError === 'string' ? sourceRuntime.lastError : null,
      solveCountAtLastSync:
        typeof sourceRuntime.solveCountAtLastSync === 'number' &&
        Number.isFinite(sourceRuntime.solveCountAtLastSync) &&
        sourceRuntime.solveCountAtLastSync >= 0
          ? sourceRuntime.solveCountAtLastSync
          : 0,
      lastRemoteRevision:
        typeof sourceRuntime.lastRemoteRevision === 'number' &&
        Number.isFinite(sourceRuntime.lastRemoteRevision)
          ? sourceRuntime.lastRemoteRevision
          : null,
      tombstones,
      conflicts,
      sessionRedirects,
      pendingDuplicateNames,
    },
  }
}

export function loadSyncStorage(storage: { getItem(key: string): string | null } | null = getDefaultStorage()): SyncStorageData {
  if (!storage) return createDefaultSyncStorage()
  const raw = storage.getItem(SYNC_STORAGE_KEY)
  if (!raw) return createDefaultSyncStorage()
  try {
    return parseSyncStorageData(JSON.parse(raw)) ?? createDefaultSyncStorage()
  } catch {
    return createDefaultSyncStorage()
  }
}

export function saveSyncStorage(
  data: SyncStorageData,
  storage: { setItem(key: string, value: string): void } | null = getDefaultStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(SYNC_STORAGE_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

function getDefaultStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}
