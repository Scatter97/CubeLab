import type { StorageLike } from './storage'
import {
  SESSIONS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SOLVES_STORAGE_KEY,
} from './storage'
import { DRIVE_STORAGE_KEY } from './driveStorage'
import { ONBOARDING_STORAGE_KEY } from './onboarding'
import {
  PENDING_COMPLETION_ENTRY_PREFIX,
  PENDING_COMPLETION_STORAGE_KEY,
} from './pendingCompletion'
import {
  REPLACEMENT_STORAGE_KEY,
  beginArchivedReplacement,
  clearReplacementJournal,
  markReplacementCommitted,
} from './replacement'
import { SOLVE_RECOVERY_STORAGE_KEY } from './solveRecovery'
import { SYNC_STORAGE_KEY } from './syncStorage'
import { TRAINING_STORAGE_KEY } from './training/storage'
import { TRAINING_SYNC_STORAGE_KEY } from './trainingSyncStorage'
import {
  UPGRADE_ARCHIVE_FALLBACK_PREFIX,
  UPGRADE_ARCHIVE_INDEX_KEY,
  archiveChecksum,
  createUpgradeArchive,
  verifyUpgradeArchiveRecord,
  type UpgradeArchiveRecord,
  type UpgradeArchiveStore,
} from './upgradeArchive'
import { CUBELAB_VERSION } from './version'

/**
 * Emergency recovery package.
 *
 * This is intentionally separate from the native backup format: it preserves
 * exact local bytes (including unreadable records), not a semantic snapshot.
 * The explicit allowlist omits UI-only preferences and never includes OAuth
 * tokens, which are memory-only in the Drive transport.
 */
export const RECOVERY_PACKAGE_FORMAT = 'cubelab-recovery'
export const RECOVERY_PACKAGE_VERSION = 1

export const RECOVERY_STORAGE_KEYS = [
  SESSIONS_STORAGE_KEY,
  SOLVES_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  TRAINING_STORAGE_KEY,
  SYNC_STORAGE_KEY,
  DRIVE_STORAGE_KEY,
  TRAINING_SYNC_STORAGE_KEY,
  REPLACEMENT_STORAGE_KEY,
  SOLVE_RECOVERY_STORAGE_KEY,
  PENDING_COMPLETION_STORAGE_KEY,
  ONBOARDING_STORAGE_KEY,
  UPGRADE_ARCHIVE_INDEX_KEY,
] as const

export const RECOVERY_DYNAMIC_KEY_PREFIXES = [
  PENDING_COMPLETION_ENTRY_PREFIX,
  UPGRADE_ARCHIVE_FALLBACK_PREFIX,
] as const

const RESTORABLE_ARCHIVE_KEYS = new Set<string>([
  SESSIONS_STORAGE_KEY,
  SOLVES_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
])

export interface RecoveryPackageRecord {
  key: string
  present: boolean
  raw: string | null
  byteLength: number
  checksum: string
  sourceVersion: number | null
  /** The key exists but its bytes could not be read during export. */
  readError?: boolean
}

export interface RecoveryPackage {
  app: 'CubeLab'
  format: typeof RECOVERY_PACKAGE_FORMAT
  version: typeof RECOVERY_PACKAGE_VERSION
  exportedAt: string
  appVersion: string
  failureKind?: string
  failureMessage?: string
  records: RecoveryPackageRecord[]
  archives: UpgradeArchiveRecord[]
  excludedKeys: string[]
  /**
   * Data-bearing keys whose exact bytes could not be read. A package with any
   * unreadable key is downloadable but must never authorize a local reset.
   */
  unreadableKeys?: string[]
  integrity: {
    algorithm: 'fnv1a32'
    overall: string
  }
}

export interface RecoveryStorage extends StorageLike {
  readonly length?: number
  key?(index: number): string | null
  removeItem?(key: string): void
}

export interface CreateRecoveryPackageOptions {
  now?: Date
  failureKind?: string
  failureMessage?: string
  archives?: readonly UpgradeArchiveRecord[]
  appVersion?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function detectSourceVersion(raw: string): number | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || typeof parsed.version !== 'number') return null
    if (!Number.isFinite(parsed.version)) return null
    return parsed.version
  } catch {
    return null
  }
}

export function isRecoveryKey(key: string): boolean {
  return (
    (RECOVERY_STORAGE_KEYS as readonly string[]).includes(key) ||
    RECOVERY_DYNAMIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  )
}

function enumerateKeys(storage: RecoveryStorage): string[] {
  const keys = new Set<string>(RECOVERY_STORAGE_KEYS)
  if (
    typeof storage.length === 'number' &&
    typeof storage.key === 'function'
  ) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key && isRecoveryKey(key)) keys.add(key)
    }
  }
  return [...keys].sort()
}

export function createRecoveryPackage(
  storage: RecoveryStorage,
  options: CreateRecoveryPackageOptions = {},
): RecoveryPackage {
  const records: RecoveryPackageRecord[] = []
  const unreadableKeys: string[] = []
  for (const key of enumerateKeys(storage)) {
    let raw: string | null
    try {
      raw = storage.getItem(key)
    } catch {
      unreadableKeys.push(key)
      records.push({
        key,
        present: false,
        raw: null,
        byteLength: 0,
        checksum: archiveChecksum(''),
        sourceVersion: null,
        readError: true,
      })
      continue
    }
    records.push({
      key,
      present: raw !== null,
      raw,
      byteLength: raw?.length ?? 0,
      checksum: archiveChecksum(raw ?? ''),
      sourceVersion:
        raw === null
          ? null
          : isRecoveryKey(key)
            ? detectSourceVersion(raw)
            : null,
    })
  }
  const overall = archiveChecksum(
    records
      .map((record) => `${record.key}\u0000${record.checksum}`)
      .join('\u0001'),
  )
  return {
    app: 'CubeLab',
    format: RECOVERY_PACKAGE_FORMAT,
    version: RECOVERY_PACKAGE_VERSION,
    exportedAt: (options.now ?? new Date()).toISOString(),
    appVersion: options.appVersion ?? CUBELAB_VERSION,
    ...(options.failureKind ? { failureKind: options.failureKind } : {}),
    ...(options.failureMessage ? { failureMessage: options.failureMessage } : {}),
    records,
    archives: (options.archives ?? []).map((archive) => ({
      ...archive,
      entries: Object.fromEntries(
        Object.entries(archive.entries).map(([key, entry]) => [key, { ...entry }]),
      ),
      includedKeys: [...archive.includedKeys],
      sourceVersions: { ...archive.sourceVersions },
    })),
    excludedKeys: [
      'UI-only tool and panel preferences',
      'In-memory Google OAuth access tokens (never persisted)',
      'Unrelated browser-origin storage',
    ],
    ...(unreadableKeys.length > 0 ? { unreadableKeys } : {}),
    integrity: {
      algorithm: 'fnv1a32',
      overall,
    },
  }
}

export function verifyRecoveryPackage(value: unknown): value is RecoveryPackage {
  if (!isRecord(value)) return false
  if (
    value.app !== 'CubeLab' ||
    value.format !== RECOVERY_PACKAGE_FORMAT ||
    value.version !== RECOVERY_PACKAGE_VERSION ||
    typeof value.exportedAt !== 'string' ||
    typeof value.appVersion !== 'string' ||
    !Array.isArray(value.records) ||
    !Array.isArray(value.archives) ||
    !isRecord(value.integrity) ||
    value.integrity.algorithm !== 'fnv1a32' ||
    typeof value.integrity.overall !== 'string'
  ) {
    return false
  }
  for (const record of value.records) {
    if (!isRecord(record)) return false
    if (
      typeof record.key !== 'string' ||
      typeof record.present !== 'boolean' ||
      (record.raw !== null && typeof record.raw !== 'string') ||
      (record.present !== (record.raw !== null)) ||
      (record.raw !== null && record.checksum !== archiveChecksum(record.raw)) ||
      (record.readError !== undefined && typeof record.readError !== 'boolean') ||
      (record.readError === true &&
        (record.raw !== null || record.present !== false)) ||
      typeof record.checksum !== 'string'
    ) {
      return false
    }
  }
  if (value.unreadableKeys !== undefined) {
    if (
      !Array.isArray(value.unreadableKeys) ||
      !value.unreadableKeys.every((key) => typeof key === 'string')
    ) {
      return false
    }
    const marked = new Set(
      value.records
        .filter((record) => (record as RecoveryPackageRecord).readError === true)
        .map((record) => (record as RecoveryPackageRecord).key),
    )
    if (
      marked.size !== value.unreadableKeys.length ||
      value.unreadableKeys.some((key) => !marked.has(key))
    ) {
      return false
    }
  }
  const overall = archiveChecksum(
    value.records
      .map((record) => `${record.key}\u0000${record.checksum}`)
      .join('\u0001'),
  )
  return overall === value.integrity.overall
}

export function recoveryPackageFileName(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return `cubelab-recovery-${stamp}.json`
}

export interface RestoreArchiveResult {
  ok: boolean
  message: string
}

/**
 * Restores only sessions/legacy solves/settings from a verified archive. The
 * current values are archived again first, then the exact archived bytes are
 * written under the existing replacement journal. No remote data is touched.
 */
export async function restoreVerifiedUpgradeArchive(input: {
  archive: UpgradeArchiveRecord
  storage: RecoveryStorage
  archiveStore: UpgradeArchiveStore
  now?: number
}): Promise<RestoreArchiveResult> {
  const { archive, storage, archiveStore } = input
  if (!verifyUpgradeArchiveRecord(archive)) {
    return {
      ok: false,
      message: 'The selected local archive failed its integrity check. Nothing was restored.',
    }
  }
  if (archive.status !== 'complete' && archive.status !== 'verified') {
    return {
      ok: false,
      message: 'The selected local archive is not a verified recovery checkpoint.',
    }
  }
  const keys = Object.keys(archive.entries)
  if (keys.length === 0) {
    return { ok: false, message: 'The selected archive contains no restorable records.' }
  }
  for (const key of keys) {
    if (!RESTORABLE_ARCHIVE_KEYS.has(key)) {
      return {
        ok: false,
        message: `The selected archive contains an unsupported record (${key}). Nothing was restored.`,
      }
    }
  }
  if (!storage.removeItem) {
    return {
      ok: false,
      message: 'This browser cannot safely remove conflicting records during restore. Nothing was restored.',
    }
  }

  const currentSources: { key: string; raw: string | null }[] = []
  for (const key of keys) {
    try {
      currentSources.push({ key, raw: storage.getItem(key) })
    } catch {
      return {
        ok: false,
        message:
          'A current record could not be read safely, so the archive was not restored. Nothing was changed.',
      }
    }
  }
  let safetyArchiveId: string
  try {
    const safetyArchive = await createUpgradeArchive(
      {
        reason: 'pre-restore',
        sources: currentSources,
        ...(input.now !== undefined ? { now: input.now } : {}),
      },
      archiveStore,
    )
    // Do not restore if the pre-restore safety archive could not be verified.
    if (!verifyUpgradeArchiveRecord(safetyArchive)) {
      return { ok: false, message: 'A pre-restore safety archive could not be verified.' }
    }
    safetyArchiveId = safetyArchive.id
  } catch (error) {
    return {
      ok: false,
      message: `A pre-restore safety archive could not be created. ${
        error instanceof Error ? error.message : 'Nothing was restored.'
      }`,
    }
  }

  const restoreCurrentSources = (): boolean => {
    let restored = true
    for (const source of currentSources) {
      try {
        if (source.raw === null) {
          if (!storage.removeItem) {
            restored = false
            continue
          }
          storage.removeItem(source.key)
        } else {
          storage.setItem(source.key, source.raw)
        }
        if (storage.getItem(source.key) !== source.raw) restored = false
      } catch {
        restored = false
      }
    }
    return restored
  }

  const begun = beginArchivedReplacement('upgrade', safetyArchiveId, storage)
  if (!begun.ok) {
    return { ok: false, message: begun.error }
  }
  const journal = begun.journal
  try {
    for (const key of keys) {
      const entry = archive.entries[key]!
      if (entry.present) storage.setItem(key, entry.raw!)
      else storage.removeItem(key)
    }
    for (const key of keys) {
      const entry = archive.entries[key]!
      const actual = storage.getItem(key)
      if (actual !== (entry.present ? entry.raw : null)) {
        const rolledBack = restoreCurrentSources()
        if (rolledBack) clearReplacementJournal(storage)
        return {
          ok: false,
          message: rolledBack
            ? 'The archive did not read back exactly. The previous data was restored.'
            : 'The archive did not read back exactly and the previous state could not be fully restored. The recovery journal was kept.',
        }
      }
    }
    if (!markReplacementCommitted(journal, storage)) {
      const rolledBack = restoreCurrentSources()
      if (rolledBack) clearReplacementJournal(storage)
      return {
        ok: false,
        message: rolledBack
          ? 'The restore commit marker could not be saved. The previous data was restored.'
          : 'The restore commit marker could not be saved and the previous state could not be fully restored. The recovery journal was kept.',
      }
    }
    clearReplacementJournal(storage)
    return {
      ok: true,
      message: 'The verified local archive was restored. Reload CubeLab to open it.',
    }
  } catch (error) {
    const rolledBack = restoreCurrentSources()
    if (rolledBack) clearReplacementJournal(storage)
    return {
      ok: false,
      message: rolledBack
        ? `The restore was interrupted. The previous data was restored. ${
            error instanceof Error ? error.message : ''
          }`
        : 'The restore was interrupted and the previous state could not be fully restored. The recovery journal was kept.',
    }
  }
}

export interface ResetLocalDataResult {
  ok: boolean
  removed: string[]
  failed: string[]
  reason?: 'unavailable' | 'unreadable' | 'changed' | 'remove-failed'
  /** Keys whose current bytes changed or could not be compared after export. */
  changed?: string[]
}

function removableRecoveryKeys(storage: RecoveryStorage): string[] {
  return enumerateKeys(storage).filter(
    (key) =>
      !key.startsWith(UPGRADE_ARCHIVE_FALLBACK_PREFIX) &&
      key !== UPGRADE_ARCHIVE_INDEX_KEY,
  )
}

/**
 * Deliberately destructive "export and start fresh" local cleanup. Verified
 * upgrade archives, the service worker, caches and Google Drive files are kept.
 * Callers must have already prepared a recovery package and obtained explicit
 * typed confirmation.
 *
 * When the acknowledged package is supplied, the current bytes must still
 * match it exactly. A read failure blocks the entire reset before anything is
 * removed: a missing package record must never be guessed to mean "absent".
 */
export function resetLocalDataAfterRecoveryExport(
  storage: RecoveryStorage,
  acknowledgedPackage?: RecoveryPackage,
): ResetLocalDataResult {
  if (!storage.removeItem) {
    return {
      ok: false,
      removed: [],
      failed: ['Browser storage removal is unavailable.'],
      reason: 'unavailable',
    }
  }
  const keys = removableRecoveryKeys(storage)
  const current = new Map<string, string | null>()
  const unreadable: string[] = []
  for (const key of keys) {
    try {
      current.set(key, storage.getItem(key))
    } catch {
      unreadable.push(key)
    }
  }
  if (unreadable.length > 0) {
    return {
      ok: false,
      removed: [],
      failed: unreadable,
      reason: 'unreadable',
    }
  }

  if (acknowledgedPackage) {
    if (!verifyRecoveryPackage(acknowledgedPackage)) {
      return {
        ok: false,
        removed: [],
        failed: ['The acknowledged recovery copy failed its integrity check.'],
        reason: 'changed',
      }
    }
    if ((acknowledgedPackage.unreadableKeys?.length ?? 0) > 0) {
      return {
        ok: false,
        removed: [],
        failed: [...acknowledgedPackage.unreadableKeys!],
        reason: 'unreadable',
      }
    }
    const expected = new Map(
      acknowledgedPackage.records.map((record) => [record.key, record]),
    )
    const changed = new Set<string>()
    for (const key of keys) {
      const record = expected.get(key)
      if (!record || record.readError) {
        // A key that appeared after export is new data the package does not
        // contain. A missing expected record means the package is incomplete.
        changed.add(key)
        continue
      }
      const actual = current.get(key) ?? null
      const wanted = record.present ? record.raw : null
      if (actual !== wanted) changed.add(key)
    }
    for (const key of expected.keys()) {
      if (
        key.startsWith(UPGRADE_ARCHIVE_FALLBACK_PREFIX) ||
        key === UPGRADE_ARCHIVE_INDEX_KEY
      ) {
        continue
      }
      if (!keys.includes(key)) changed.add(key)
    }
    if (changed.size > 0) {
      return {
        ok: false,
        removed: [],
        failed: [...changed],
        changed: [...changed],
        reason: 'changed',
      }
    }
  }

  const failed: string[] = []
  const removed: string[] = []
  for (const key of keys) {
    try {
      storage.removeItem(key)
      removed.push(key)
    } catch {
      failed.push(key)
    }
  }
  return {
    ok: failed.length === 0,
    removed,
    failed,
    ...(failed.length > 0 ? { reason: 'remove-failed' as const } : {}),
  }
}
