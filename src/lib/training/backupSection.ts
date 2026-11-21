/** Pure native-backup section for the complete checked Training store. */
import { assertTrainingData } from './schema'
import { stripRetiredAlgorithmTracking } from './retiredAlgorithmTracking'
import type { TrainingData } from './types'

export const TRAINING_BACKUP_SECTION_VERSION = 1

export interface TrainingBackupSection {
  readonly version: typeof TRAINING_BACKUP_SECTION_VERSION
  readonly data: TrainingData
}

export interface TrainingBackupSummary {
  readonly attempts: number
  readonly sessions: number
  readonly calibrations: number
  readonly customAlgorithms: number
  readonly presets: number
  readonly firstAttemptAt: number | null
  readonly lastAttemptAt: number | null
}

export type TrainingBackupSectionParseResult =
  | { readonly ok: true; readonly section: TrainingBackupSection }
  | { readonly ok: false; readonly error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Detaches a validated store so later edits cannot change an exported backup. */
export function cloneTrainingData(data: TrainingData): TrainingData {
  assertTrainingData(data)
  return JSON.parse(JSON.stringify(data)) as TrainingData
}

/**
 * A backup stores the exact checked store, without derived reports or charts.
 * The schema version is the Training schema version, not the backup version.
 */
export function createTrainingBackupSection(
  data: TrainingData,
): TrainingBackupSection {
  return {
    version: TRAINING_BACKUP_SECTION_VERSION,
    data: stripRetiredAlgorithmTracking(cloneTrainingData(data)),
  }
}

/**
 * Rejects the whole section instead of skipping a bad record. An exported
 * section can never contain a live visit; restore must not resume one.
 */
export function parseTrainingBackupSection(
  value: unknown,
): TrainingBackupSectionParseResult {
  if (!isRecord(value)) {
    return { ok: false, error: 'The backup Training section is malformed.' }
  }
  if (value.version !== TRAINING_BACKUP_SECTION_VERSION) {
    return {
      ok: false,
      error: 'This backup uses an unsupported Training schema version.',
    }
  }
  try {
    assertTrainingData(value.data)
  } catch (error) {
    return {
      ok: false,
      error: `The backup Training history is invalid: ${
        error instanceof Error ? error.message : 'unknown validation error'
      }`,
    }
  }
  const data = value.data
  if (
    data.activeVisitId !== null ||
    data.visits.some((visit) => visit.endedAt === null)
  ) {
    return {
      ok: false,
      error:
        'The backup contains an unfinished Training session. It was rejected instead of resuming that visit.',
    }
  }
  // JSON cloning is intentional: the parsed value may still be referenced by
  // the caller and rendering must never mutate the checked backup.
  return {
    ok: true,
    section: {
      version: TRAINING_BACKUP_SECTION_VERSION,
      data: stripRetiredAlgorithmTracking(cloneTrainingData(data)),
    },
  }
}

export function summarizeTrainingData(data: TrainingData): TrainingBackupSummary {
  let firstAttemptAt: number | null = null
  let lastAttemptAt: number | null = null
  for (const attempt of data.attempts) {
    firstAttemptAt =
      firstAttemptAt === null ? attempt.createdAt : Math.min(firstAttemptAt, attempt.createdAt)
    lastAttemptAt =
      lastAttemptAt === null ? attempt.createdAt : Math.max(lastAttemptAt, attempt.createdAt)
  }
  return {
    attempts: data.attempts.length,
    sessions: data.visits.filter((visit) => visit.session !== undefined).length,
    calibrations: data.calibrations.length,
    customAlgorithms: data.customAlgorithms.length,
    presets: data.presets.length,
    firstAttemptAt,
    lastAttemptAt,
  }
}
