import {
  loadSessionsChecked,
  loadSettingsChecked,
  serializeSessionsData,
  serializeSettingsData,
  SESSIONS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SOLVES_STORAGE_KEY,
  SESSIONS_VERSION,
  SETTINGS_STORAGE_VERSION,
  type StorageLike,
} from './storage'
import {
  beginArchivedReplacement,
  clearReplacementJournal,
  loadReplacementJournal,
  markReplacementCommitted,
} from './replacement'
import {
  createUpgradeArchive,
  markUpgradeArchiveStatus,
  openDefaultUpgradeArchiveStore,
  retainUpgradeArchives,
  UpgradeArchiveError,
  type UpgradeArchiveReason,
  type UpgradeArchiveRecord,
  type UpgradeArchiveSource,
  type UpgradeArchiveStore,
} from './upgradeArchive'
import { isSiteResetInProgress } from './siteReset'

export type StartupMigrationPhase =
  | 'before-archive-write'
  | 'after-archive-write'
  | 'before-candidate-write'
  | 'after-candidate-write'
  | 'during-verification'
  | 'before-commit-marker'
  | 'after-commit-marker'
  | 'before-cleanup'
  | 'after-cleanup'

export interface StartupMigrationOptions {
  storage?: StorageLike | null
  archiveStore?: UpgradeArchiveStore
  /** Deterministic failure injection used by the safety regressions. */
  onPhase?: (phase: StartupMigrationPhase) => void | Promise<void>
  now?: number
}

export type StartupMigrationResult =
  | { status: 'none' }
  | {
      status: 'completed'
      archiveId: string
      updatedKeys: string[]
      cleanupPending: boolean
    }
  | {
      status: 'blocked'
      message: string
      archiveId?: string
      retryable: boolean
      reason:
        | 'read'
        | 'archive'
        | 'journal'
        | 'write'
        | 'verification'
        | 'in-progress'
    }

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function memoryStorage(values: Readonly<Record<string, string>>): StorageLike {
  return {
    getItem: (key) => values[key] ?? null,
    setItem: () => undefined,
  }
}

async function runPhase(
  options: StartupMigrationOptions,
  phase: StartupMigrationPhase,
): Promise<void> {
  await options.onPhase?.(phase)
}

function blocked(
  message: string,
  reason: Extract<StartupMigrationResult, { status: 'blocked' }>['reason'],
  retryable = true,
  archiveId?: string,
): StartupMigrationResult {
  return {
    status: 'blocked',
    message,
    reason,
    retryable,
    ...(archiveId ? { archiveId } : {}),
  }
}

/**
 * Deliberately small, recoverable upgrade coordinator for the whole-collection
 * schema. It runs only after the lifetime active-tab lock and replacement
 * recovery have succeeded.
 *
 * The exact original bytes are archived and re-read before any candidate write.
 * Existing replacement journal semantics make a crash before the commit marker
 * roll back and a crash after it roll forward. Already-current canonical bytes
 * are not rewritten.
 */
export async function runStartupMigration(
  options: StartupMigrationOptions = {},
): Promise<StartupMigrationResult> {
  const storage =
    options.storage === undefined ? getDefaultStorage() : options.storage
  if (!storage) return { status: 'none' }
  if (isSiteResetInProgress()) {
    return blocked(
      'CubeLab is resetting local site data. The upgrade was not started.',
      'in-progress',
      false,
    )
  }

  const pending = loadReplacementJournal(storage)
  if (pending.status === 'invalid') {
    return blocked(pending.message, 'journal')
  }
  const pendingCommitted =
    pending.status === 'ok' && pending.journal.phase === 'committed'
  if (pending.status === 'ok' && !pendingCommitted) {
    return blocked(
      'An interrupted replacement is still being resolved. Reload before upgrading saved data.',
      'journal',
    )
  }

  const sessions = loadSessionsChecked(storage)
  if (!sessions.ok && sessions.reason !== 'absent') {
    return blocked(sessions.message, 'read')
  }
  const settings = loadSettingsChecked(storage)
  if (!settings.ok) {
    return blocked(settings.message, 'read')
  }

  const updatedKeys: string[] = []
  const candidates = new Map<string, string>()
  let sessionsReason: UpgradeArchiveReason | null = null
  let settingsReason: UpgradeArchiveReason | null = null

  if (sessions.ok) {
    const candidate = serializeSessionsData(sessions.data)
    const needsMigration =
      sessions.legacyRaw !== null ||
      (sessions.sourceVersion !== null &&
        sessions.sourceVersion < SESSIONS_VERSION)
    if (needsMigration && candidate !== sessions.raw) {
      candidates.set(SESSIONS_STORAGE_KEY, candidate)
      updatedKeys.push(SESSIONS_STORAGE_KEY)
      sessionsReason =
        sessions.legacyRaw !== null ? 'legacy-migration' : 'schema-migration'
    }
  }

  const settingsCandidate = serializeSettingsData(settings.settings)
  if (
    settings.raw !== null &&
    settings.sourceVersion !== null &&
    settings.sourceVersion < SETTINGS_STORAGE_VERSION &&
    settingsCandidate !== settings.raw
  ) {
    candidates.set(SETTINGS_STORAGE_KEY, settingsCandidate)
    updatedKeys.push(SETTINGS_STORAGE_KEY)
    settingsReason = 'schema-migration'
  }

  if (candidates.size === 0) return { status: 'none' }

  const reason: UpgradeArchiveReason =
    sessionsReason === 'legacy-migration'
      ? 'legacy-migration'
      : sessionsReason === 'schema-migration' ||
          settingsReason === 'schema-migration'
        ? 'schema-migration'
        : 'normalization'

  const sources: UpgradeArchiveSource[] = []
  if (sessions.ok) {
    sources.push({
      key: SESSIONS_STORAGE_KEY,
      raw: sessions.raw,
      sourceVersion: sessions.sourceVersion,
    })
    if (sessions.legacyRaw !== null) {
      sources.push({
        key: SOLVES_STORAGE_KEY,
        raw: sessions.legacyRaw,
        sourceVersion: 1,
      })
    }
  }
  sources.push({
    key: SETTINGS_STORAGE_KEY,
    raw: settings.raw ?? null,
    sourceVersion: settings.sourceVersion,
  })

  let archive: UpgradeArchiveRecord
  try {
    const store =
      options.archiveStore ??
      (await openDefaultUpgradeArchiveStore(storage))
    await runPhase(options, 'before-archive-write')
    archive = await createUpgradeArchive(
      {
        reason,
        sources,
        ...(options.now !== undefined ? { now: options.now } : {}),
      },
      store,
    )
    await runPhase(options, 'after-archive-write')
  } catch (error) {
    return blocked(
      error instanceof UpgradeArchiveError
        ? error.message
        : 'A verified recovery archive could not be created. Saved data was not upgraded or changed.',
      'archive',
      !(error instanceof UpgradeArchiveError) || error.retryable,
    )
  }

  // Validate the complete candidate before the first write.
  if (candidates.has(SESSIONS_STORAGE_KEY)) {
    const checked = loadSessionsChecked(
      memoryStorage({
        [SESSIONS_STORAGE_KEY]: candidates.get(SESSIONS_STORAGE_KEY)!,
      }),
    )
    if (!checked.ok) {
      return blocked(
        'The upgraded session candidate could not be validated. Saved data was not changed.',
        'verification',
        true,
        archive.id,
      )
    }
  }
  if (candidates.has(SETTINGS_STORAGE_KEY)) {
    const checked = loadSettingsChecked(
      memoryStorage({
        [SETTINGS_STORAGE_KEY]: candidates.get(SETTINGS_STORAGE_KEY)!,
      }),
    )
    if (!checked.ok) {
      return blocked(
        'The upgraded settings candidate could not be validated. Saved data was not changed.',
        'verification',
        true,
        archive.id,
      )
    }
  }

  const restoreSources = (): boolean => {
    let restored = true
    for (const source of sources) {
      try {
        if (storage.getItem(source.key) === source.raw) continue
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

  const begun = pendingCommitted
    ? null
    : beginArchivedReplacement('upgrade', archive.id, storage)
  if (begun && !begun.ok) {
    return blocked(
      `The upgrade recovery record could not be saved. ${begun.error}`,
      'journal',
      true,
      archive.id,
    )
  }
  const journal = begun?.journal ?? null

  const fail = (message: string, reason: 'write' | 'verification'): StartupMigrationResult => {
    const rolledBack = restoreSources()
    if (rolledBack && journal) clearReplacementJournal(storage)
    return blocked(
      rolledBack
        ? `${message} The previous data was restored; the verified archive is still available.`
        : `${message} The previous state could not be fully restored. A recovery record and verified archive were kept.`,
      reason,
      true,
      archive.id,
    )
  }

  try {
    await runPhase(options, 'before-candidate-write')
    for (const [key, value] of candidates) {
      storage.setItem(key, value)
    }
    await runPhase(options, 'after-candidate-write')
    await runPhase(options, 'during-verification')
    for (const [key, value] of candidates) {
      if (storage.getItem(key) !== value) {
        return fail(
          'The upgraded data did not read back exactly as written.',
          'verification',
        )
      }
    }
    await runPhase(options, 'before-commit-marker')
    if (journal && !markReplacementCommitted(journal, storage)) {
      return fail(
        'The upgrade commit marker could not be saved.',
        'write',
      )
    }
    await runPhase(options, 'after-commit-marker')

    // A committed journal (or an already committed cleanup-pending journal)
    // means startup recovery would keep these bytes. Verify them once more; if
    // they do not validate, explicitly restore the archived source.
    for (const [key, value] of candidates) {
      if (storage.getItem(key) !== value) {
        return fail(
          'The committed upgrade could not be verified.',
          'verification',
        )
      }
    }
    if (candidates.has(SESSIONS_STORAGE_KEY)) {
      const checked = loadSessionsChecked(storage)
      if (!checked.ok || checked.raw !== candidates.get(SESSIONS_STORAGE_KEY)) {
        return fail(
          'The committed session collection could not be revalidated.',
          'verification',
        )
      }
    }
    if (candidates.has(SETTINGS_STORAGE_KEY)) {
      const checked = loadSettingsChecked(storage)
      if (!checked.ok || checked.raw !== candidates.get(SETTINGS_STORAGE_KEY)) {
        return fail(
          'The committed settings could not be revalidated.',
          'verification',
        )
      }
    }

    await runPhase(options, 'before-cleanup')
    const cleaned = journal ? clearReplacementJournal(storage) : false
    await runPhase(options, 'after-cleanup')

    // Archive status and retention are nonessential once the commit is verified.
    try {
      const store =
        options.archiveStore ??
        (await openDefaultUpgradeArchiveStore(storage))
      await markUpgradeArchiveStatus(archive.id, 'complete', store)
      await retainUpgradeArchives(store)
    } catch {
      // The verified archive remains; retention/status will be retried later.
    }

    return {
      status: 'completed',
      archiveId: archive.id,
      updatedKeys,
      cleanupPending: pendingCommitted || !cleaned,
    }
  } catch (error) {
    return fail(
      error instanceof Error
        ? `The upgrade was interrupted: ${error.message}`
        : 'The upgrade was interrupted before it completed.',
      'write',
    )
  }
}
