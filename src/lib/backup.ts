import type { SessionsData, Settings } from '../types'
import {
  findSessionEventMismatches,
  findSessionDateErrors,
  parseSessionsData,
  parseSettingsData,
} from './storage'
import { cloneAnalyticsSettings } from './analyticsSettings'
import type { SyncEnvelope } from './sync'
import { parseRemoteSyncEnvelope } from './sync'


export const BACKUP_APP = 'CubeLab'
export const BACKUP_FORMAT = 'cubelab-backup'
export const BACKUP_VERSION = 1
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024

export interface Backup {
  app: typeof BACKUP_APP
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  sessions: SessionsData
  settings: Settings
  /**
   * How imported sessions should be applied: 'replace' overwrites local
   * sessions (native CubeLab backups), 'add' appends them as new sessions
   * (csTimer imports). Defaults to 'replace'.
   */
  importMode?: 'replace' | 'add'
  /**
   * Optional synchronization envelope used by Phase 2C. Manual backups created
   * by older versions omit this and remain fully compatible.
   */
  sync?: SyncEnvelope
}

export type BackupParseResult =
  | { ok: true; backup: Backup }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Creates a detached snapshot so later local mutations cannot alter a backup. */
export function createBackup(
  sessions: SessionsData,
  settings: Settings,
  exportedAt = new Date(),
  sync?: SyncEnvelope,
): Backup {
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    sessions: {
      activeSessionId: sessions.activeSessionId,
      sessions: sessions.sessions.map((session) => ({
        ...session,
        ...(session.preferences ? { preferences: { ...session.preferences } } : {}),
        ...(session.fieldUpdates
          ? {
              fieldUpdates: {
                ...session.fieldUpdates,
                ...(session.fieldUpdates.preferences
                  ? { preferences: { ...session.fieldUpdates.preferences } }
                  : {}),
              },
            }
          : {}),
        solves: session.solves.map((solve) => ({
          ...solve,
          ...(solve.fieldUpdates
            ? { fieldUpdates: { ...solve.fieldUpdates } }
            : {}),
          ...(solve.importSource
            ? { importSource: { ...solve.importSource } }
            : {}),
        })),
      })),
      ...(sessions.customEvents
        ? {
            customEvents: sessions.customEvents.map((definition) => ({
              ...definition,
              ...(definition.fieldUpdates
                ? { fieldUpdates: { ...definition.fieldUpdates } }
                : {}),
              ...(definition.source
                ? {
                    source: {
                      ...definition.source,
                      identifiers: [...definition.source.identifiers],
                    },
                  }
                : {}),
            })),
          }
        : {}),
      ...(sessions.sessionOrder
        ? {
            sessionOrder: {
              ...sessions.sessionOrder,
              ids: [...sessions.sessionOrder.ids],
            },
          }
        : {}),
      ...(sessions.sessionTransfers
        ? {
            sessionTransfers: sessions.sessionTransfers.map((transfer) => ({
              ...transfer,
              solveIds: [...transfer.solveIds],
            })),
          }
        : {}),
    },
    settings: {
      ...settings,
      statVisibility: { ...settings.statVisibility },
      customAverages: settings.customAverages.map((average) => ({ ...average })),
      statMetricVisibility: { ...settings.statMetricVisibility },
      statTargetsMs: Object.fromEntries(
        Object.entries(settings.statTargetsMs).map(([event, targets]) => [
          event,
          { ...targets },
        ]),
      ),
      analytics: cloneAnalyticsSettings(settings.analytics),
    },
    ...(sync ? { sync } : {}),
  }
}

export function serializeBackup(backup: Backup): string {
  return `${JSON.stringify(backup, null, 2)}\n`
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function formatByteSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024)
  if (megabytes >= 10) return `${megabytes.toFixed(1)} MB`
  return `${megabytes.toFixed(2)} MB`
}

export type CheckedBackupSerialization =
  | {
      ok: true
      raw: string
      bytes: number
      compact: boolean
    }
  | {
      ok: false
      bytes: number
      limit: number
      error: string
    }

/**
 * Serializes a complete backup and proves that the exact payload fits the
 * reader cap. Readable formatting is preferred when it fits; otherwise the
 * compact form is used. If neither form fits, no output is produced so callers
 * cannot create a file or remote snapshot that CubeLab's own readers reject.
 */
export function serializeBackupChecked(
  backup: Backup,
  options: { limit?: number; validate?: boolean; preferCompact?: boolean } = {},
): CheckedBackupSerialization {
  const limit = options.limit ?? MAX_BACKUP_BYTES
  const pretty = options.preferCompact ? '' : serializeBackup(backup)
  const prettyBytes = utf8ByteLength(pretty)
  let raw = pretty
  let bytes = prettyBytes
  let compact = options.preferCompact ?? false

  if (prettyBytes > limit || options.preferCompact) {
    raw = JSON.stringify(backup)
    bytes = utf8ByteLength(raw)
    compact = true
  }

  if (bytes > limit) {
    return {
      ok: false,
      bytes,
      limit,
      error: `The complete backup is ${formatByteSize(bytes)}; CubeLab's ${formatByteSize(limit)} backup limit was exceeded.`,
    }
  }

  if (options.validate && !parseBackup(raw).ok) {
    return {
      ok: false,
      bytes,
      limit,
      error: 'The serialized backup could not be read back safely.',
    }
  }

  return { ok: true, raw, bytes, compact }
}

export function backupFileName(date = new Date()): string {
  return `cubelab-backup-${date.toISOString().slice(0, 10)}.json`
}

/**
 * Parses and validates a user-selected backup. Invalid solves and sessions are
 * skipped individually. Invalid markers/versions, mixed-event sessions and
 * malformed sync envelopes also reject the whole backup. File-size caps are
 * enforced by the local-file and remote-download callers, not this parser.
 */
export function parseBackup(raw: string): BackupParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' }
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: 'That file is not a CubeLab backup.' }
  }
  if (parsed.app !== BACKUP_APP || parsed.format !== BACKUP_FORMAT) {
    return { ok: false, error: 'That file is not a CubeLab backup.' }
  }
  if (parsed.version !== BACKUP_VERSION) {
    return { ok: false, error: 'This backup version is not supported.' }
  }
  if (typeof parsed.exportedAt !== 'string' || parsed.exportedAt.length === 0) {
    return { ok: false, error: 'The backup is missing its export date.' }
  }

  const dateErrors = findSessionDateErrors(parsed.sessions)
  if (dateErrors.length > 0) {
    return { ok: false, error: `${dateErrors[0]} CubeLab did not change your local data.` }
  }

  const mismatches = findSessionEventMismatches(parsed.sessions)
  if (mismatches.length > 0) {
    return {
      ok: false,
      error: `${mismatches[0]} CubeLab did not change your local data.`,
    }
  }

  const sessions = parseSessionsData(parsed.sessions)
  if (!sessions) {
    return { ok: false, error: 'The backup contains no valid sessions.' }
  }

  const settings = parseSettingsData(parsed.settings)
  if (!settings) {
    return { ok: false, error: 'The backup is missing valid settings.' }
  }

  let sync: SyncEnvelope | undefined
  if (parsed.sync !== undefined) {
    const parsedSync = parseRemoteSyncEnvelope(parsed.sync)
    if (!parsedSync) {
      return {
        ok: false,
        error:
          'The backup contains a malformed synchronization envelope. It was rejected before any local data changed.',
      }
    }
    sync = parsedSync
  }

  return {
    ok: true,
    backup: {
      app: BACKUP_APP,
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: parsed.exportedAt,
      sessions,
      settings,
      ...(sync ? { sync } : {}),
    },
  }
}
