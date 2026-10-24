import type { StorageLike } from './storage'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const DRIVE_STORAGE_KEY = 'cubelab:drive:v1'
export const DRIVE_STORAGE_VERSION = 1

export interface DriveBackupState {
  version: typeof DRIVE_STORAGE_VERSION
  remoteFileId: string | null
  remoteModifiedTime: string | null
  lastBackupAt: number | null
  lastRestoreAt: number | null
  connectedAccountLabel: string | null
}

export const DEFAULT_DRIVE_STATE: DriveBackupState = {
  version: DRIVE_STORAGE_VERSION,
  remoteFileId: null,
  remoteModifiedTime: null,
  lastBackupAt: null,
  lastRestoreAt: null,
  connectedAccountLabel: null,
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableTimestamp(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isFinite(value) && value > 0)
  )
}

export function parseDriveBackupState(value: unknown): DriveBackupState | null {
  if (!isRecord(value)) return null
  if (typeof value.version !== 'number' || value.version !== DRIVE_STORAGE_VERSION) {
    return null
  }

  return {
    version: DRIVE_STORAGE_VERSION,
    remoteFileId: isNullableString(value.remoteFileId)
      ? value.remoteFileId
      : null,
    remoteModifiedTime: isNullableString(value.remoteModifiedTime)
      ? value.remoteModifiedTime
      : null,
    lastBackupAt: isNullableTimestamp(value.lastBackupAt)
      ? value.lastBackupAt
      : null,
    lastRestoreAt: isNullableTimestamp(value.lastRestoreAt)
      ? value.lastRestoreAt
      : null,
    connectedAccountLabel: isNullableString(value.connectedAccountLabel)
      ? value.connectedAccountLabel
      : null,
  }
}

export function loadDriveBackupState(storage: StorageLike | null = getDefaultStorage()): DriveBackupState {
  if (!storage) return { ...DEFAULT_DRIVE_STATE }
  const raw = storage.getItem(DRIVE_STORAGE_KEY)
  if (!raw) return { ...DEFAULT_DRIVE_STATE }
  try {
    const parsed = parseDriveBackupState(JSON.parse(raw))
    return parsed ? { ...parsed } : { ...DEFAULT_DRIVE_STATE }
  } catch {
    return { ...DEFAULT_DRIVE_STATE }
  }
}

export function saveDriveBackupState(
  state: DriveBackupState,
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(DRIVE_STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}