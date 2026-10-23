import type { SessionsData, Settings } from '../types'
import { parseSessionsData, parseSettingsData } from './storage'

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
        solves: session.solves.map((solve) => ({ ...solve })),
      })),
    },
    settings: { ...settings },
  }
}

export function serializeBackup(backup: Backup): string {
  return `${JSON.stringify(backup, null, 2)}\n`
}

export function backupFileName(date = new Date()): string {
  return `cubelab-backup-${date.toISOString().slice(0, 10)}.json`
}

/**
 * Parses and validates a user-selected backup. Invalid solves and sessions are
 * skipped individually; the backup is rejected only when no usable session or
 * settings remain.
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

  const sessions = parseSessionsData(parsed.sessions)
  if (!sessions) {
    return { ok: false, error: 'The backup contains no valid sessions.' }
  }

  const settings = parseSettingsData(parsed.settings)
  if (!settings) {
    return { ok: false, error: 'The backup is missing valid settings.' }
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
    },
  }
}
