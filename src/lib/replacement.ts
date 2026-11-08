import { createId } from './id'
import { DRIVE_STORAGE_KEY } from './driveStorage'
import {
  SESSIONS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  type StorageLike,
} from './storage'
import { SYNC_STORAGE_KEY } from './syncStorage'

export const REPLACEMENT_STORAGE_KEY = 'cubelab:replacement:v1'
export const REPLACEMENT_VERSION = 1

export type ReplacementKind =
  | 'native-import'
  | 'drive-restore'
  | 'additive-import'

export type ReplacementKey = 'sessions' | 'settings' | 'sync' | 'drive'

export interface ReplacementJournal {
  version: typeof REPLACEMENT_VERSION
  operationId: string
  kind: ReplacementKind
  /** `prepared` can still roll back; `committed` must roll forward. */
  phase: 'prepared' | 'committed'
  createdAt: number
  /** Raw local-storage values captured before the first candidate write. */
  before: Partial<Record<ReplacementKey, string | null>>
}

export type ReplacementJournalLoad =
  | { status: 'none' }
  | { status: 'ok'; journal: ReplacementJournal }
  | { status: 'invalid'; message: string }

export type ReplacementRecovery =
  | { status: 'none' }
  | { status: 'rolled-back' | 'committed' }
  | { status: 'cleanup-pending'; journal: ReplacementJournal }
  | { status: 'invalid'; message: string }

export type BeginReplacementResult =
  | { ok: true; journal: ReplacementJournal }
  | { ok: false; error: string }

const REPLACEMENT_STORAGE_KEYS: Record<ReplacementKey, string> = {
  sessions: SESSIONS_STORAGE_KEY,
  settings: SETTINGS_STORAGE_KEY,
  sync: SYNC_STORAGE_KEY,
  drive: DRIVE_STORAGE_KEY,
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

/** Distinguishes an absent storage API from a known recovery transaction. */
export function getDefaultReplacementStorage(): StorageLike | null {
  return getDefaultStorage()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJournal(value: unknown): ReplacementJournal | null {
  if (!isRecord(value)) return null
  if (
    value.version !== REPLACEMENT_VERSION ||
    typeof value.operationId !== 'string' ||
    value.operationId.length === 0 ||
    (value.kind !== 'native-import' &&
      value.kind !== 'drive-restore' &&
      value.kind !== 'additive-import') ||
    (value.phase !== 'prepared' && value.phase !== 'committed') ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt < 0 ||
    !isRecord(value.before)
  ) {
    return null
  }

  const before: Partial<Record<ReplacementKey, string | null>> = {}
  for (const key of Object.keys(REPLACEMENT_STORAGE_KEYS) as ReplacementKey[]) {
    const candidate = value.before[key]
    if (candidate === undefined) continue
    if (candidate !== null && typeof candidate !== 'string') return null
    before[key] = candidate
  }

  return {
    version: REPLACEMENT_VERSION,
    operationId: value.operationId,
    kind: value.kind,
    phase: value.phase,
    createdAt: value.createdAt,
    before,
  }
}

export function loadReplacementJournal(
  storage: StorageLike | null = getDefaultStorage(),
): ReplacementJournalLoad {
  if (!storage) {
    return {
      status: 'invalid',
      message: 'Browser storage is unavailable, so a replacement cannot be verified.',
    }
  }
  let raw: string | null
  try {
    raw = storage.getItem(REPLACEMENT_STORAGE_KEY)
  } catch {
    return {
      status: 'invalid',
      message: 'The replacement recovery record could not be read.',
    }
  }
  if (!raw) return { status: 'none' }
  try {
    const journal = parseJournal(JSON.parse(raw))
    if (!journal) {
      return {
        status: 'invalid',
        message:
          'An unsupported or malformed replacement recovery record is present. Synchronization and imports are paused until it is resolved.',
      }
    }
    return { status: 'ok', journal }
  } catch {
    return {
      status: 'invalid',
      message:
        'A malformed replacement recovery record is present. Synchronization and imports are paused until it is resolved.',
    }
  }
}

function saveJournal(
  journal: ReplacementJournal,
  storage: StorageLike | null,
): boolean {
  if (!storage) return false
  try {
    storage.setItem(REPLACEMENT_STORAGE_KEY, JSON.stringify(journal))
    return true
  } catch {
    return false
  }
}

export function beginReplacement(
  kind: ReplacementKind,
  keys: readonly ReplacementKey[],
  storage: StorageLike | null = getDefaultStorage(),
): BeginReplacementResult {
  const existing = loadReplacementJournal(storage)
  if (existing.status !== 'none') {
    return {
      ok: false,
      error:
        existing.status === 'invalid'
          ? existing.message
          : 'Another replacement recovery record is still pending.',
    }
  }
  if (!storage) {
    return {
      ok: false,
      error: 'Browser storage is unavailable; nothing was replaced.',
    }
  }

  const before: Partial<Record<ReplacementKey, string | null>> = {}
  try {
    for (const key of new Set(keys)) {
      before[key] = storage.getItem(REPLACEMENT_STORAGE_KEYS[key])
    }
  } catch {
    return {
      ok: false,
      error:
        'The previous sessions, settings or sync records could not be captured. Nothing was replaced.',
    }
  }

  const journal: ReplacementJournal = {
    version: REPLACEMENT_VERSION,
    operationId: createId(),
    kind,
    phase: 'prepared',
    createdAt: Date.now(),
    before,
  }
  if (!saveJournal(journal, storage)) {
    // A storage implementation can fail after partially accepting the write.
    // No candidate key has changed yet, so remove any partial record rather
    // than leaving a block that would only roll back to the current state.
    clearReplacementJournal(storage)
    return {
      ok: false,
      error:
        'The replacement recovery record could not be saved. Nothing was replaced.',
    }
  }
  return { ok: true, journal }
}

/** Durably records the commit point. After this succeeds, recovery rolls forward. */
export function markReplacementCommitted(
  journal: ReplacementJournal,
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  return saveJournal(
    {
      ...journal,
      phase: 'committed',
      before: {},
    },
    storage,
  )
}

/** Restores every captured key. Idempotent; keeps the journal on any failure. */
export function rollbackReplacement(
  journal: ReplacementJournal,
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  if (!storage) return false
  let ok = true
  for (const [key, value] of Object.entries(journal.before) as [
    ReplacementKey,
    string | null,
  ][]) {
    const storageKey = REPLACEMENT_STORAGE_KEYS[key]
    try {
      if (value === null) {
        if (!storage.removeItem) {
          ok = false
          continue
        }
        storage.removeItem(storageKey)
      } else {
        storage.setItem(storageKey, value)
      }
    } catch {
      ok = false
    }
  }
  return ok
}

export function clearReplacementJournal(
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  if (!storage?.removeItem) return false
  try {
    storage.removeItem(REPLACEMENT_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

/**
 * Applies the durable commit decision before React reads storage.
 *
 * - A prepared transaction never reached its commit marker, so the previous
 *   complete state is restored.
 * - A committed transaction already wrote every candidate key; only cleanup is
 *   needed.
 * - Malformed/unsupported records are retained and reported instead of being
 *   silently treated as "no transaction".
 */
export function recoverPendingReplacement(
  storage: StorageLike | null = getDefaultStorage(),
): ReplacementRecovery {
  const loaded = loadReplacementJournal(storage)
  if (loaded.status === 'none') return { status: 'none' }
  if (loaded.status === 'invalid') {
    return { status: 'invalid', message: loaded.message }
  }

  const journal = loaded.journal
  if (journal.phase === 'prepared') {
    if (!rollbackReplacement(journal, storage)) {
      return { status: 'cleanup-pending', journal }
    }
    if (!clearReplacementJournal(storage)) {
      return { status: 'cleanup-pending', journal }
    }
    return { status: 'rolled-back' }
  }

  if (!clearReplacementJournal(storage)) {
    return { status: 'cleanup-pending', journal }
  }
  return { status: 'committed' }
}

/** True while a rollback-capable transaction may still be in flight. */
export function replacementBlocksSync(
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  const loaded = loadReplacementJournal(storage)
  if (loaded.status === 'invalid') return true
  if (loaded.status === 'ok') return loaded.journal.phase === 'prepared'
  return false
}

export function pendingReplacementMessage(
  recovery: ReplacementRecovery,
): string | null {
  if (recovery.status === 'invalid') return recovery.message
  if (recovery.status === 'cleanup-pending') {
    return 'A replacement recovery record is still being completed. Synchronization and new imports are paused until browser storage accepts the cleanup.'
  }
  return null
}
