/**
 * Resolves the preferred Training algorithm without copying built-in defaults
 * into user storage. A missing stored preference means the read-only built-in
 * default, while an explicit stored choice is preserved across reloads.
 */

import {
  BUILT_IN_ALGORITHM_BY_ID,
  builtInAlgorithmForCase,
} from './catalog/defaultAlgorithms'
import type { TrainingAlgorithmRecord } from './catalog/types'
import type {
  TrainingAlgorithmSnapshot,
  TrainingCustomAlgorithm,
  TrainingData,
} from './types'

export type TrainingAlgorithmSource = 'built-in' | 'custom'

export interface ResolvedTrainingAlgorithm {
  readonly record: TrainingAlgorithmRecord
  readonly source: TrainingAlgorithmSource
  readonly snapshot: TrainingAlgorithmSnapshot
}

export function trainingAlgorithmKey(algorithm: Pick<TrainingAlgorithmSnapshot, 'id' | 'revision'>) {
  return JSON.stringify([algorithm.id, algorithm.revision])
}

export function algorithmSnapshotFor(
  algorithm: Pick<TrainingAlgorithmRecord, 'id' | 'version' | 'notation'>,
): TrainingAlgorithmSnapshot {
  return {
    id: algorithm.id,
    revision: algorithm.version,
    notation: algorithm.notation,
  }
}

export function customAlgorithmRecord(
  algorithm: TrainingCustomAlgorithm,
): TrainingAlgorithmRecord {
  if (
    !algorithm.verification ||
    algorithm.verification.status !== 'verified'
  ) {
    throw new Error('Add and verify an algorithm for this case first.')
  }
  return {
    id: algorithm.id,
    version: algorithm.version,
    caseId: algorithm.caseId,
    setId: algorithm.setId,
    source: 'user',
    label: algorithm.label,
    notation: algorithm.notation,
    normalizedNotation: algorithm.normalizedNotation,
    immutable: true,
    ...(algorithm.replacesAlgorithmId
      ? { replacesAlgorithmId: algorithm.replacesAlgorithmId }
      : {}),
    provenance: {
      sourceKind: 'user',
      normalizedNotation: algorithm.normalizedNotation,
      redistribution: 'not-applicable',
      redistributionNotes:
        'User-authored algorithm stored only in local Training data.',
    },
    verification: algorithm.verification,
  }
}

function resolved(
  record: TrainingAlgorithmRecord,
  source: TrainingAlgorithmSource,
): ResolvedTrainingAlgorithm {
  return { record, source, snapshot: algorithmSnapshotFor(record) }
}

function verifiedCustomAlgorithm(
  data: TrainingData,
  caseId: string,
  id: string,
  revision: number,
): TrainingCustomAlgorithm | undefined {
  return data.customAlgorithms.find(
    (algorithm) =>
      algorithm.id === id &&
      algorithm.version === revision &&
      algorithm.caseId === caseId &&
      algorithm.verification?.status === 'verified',
  )
}

export function resolveCapturedAlgorithm(
  data: TrainingData,
  caseId: string,
  capture: TrainingAlgorithmSnapshot,
): ResolvedTrainingAlgorithm | null {
  const builtIn = BUILT_IN_ALGORITHM_BY_ID.get(capture.id)
  if (builtIn?.caseId === caseId && builtIn.version === capture.revision) {
    return capture.notation === null || capture.notation === builtIn.notation ? resolved(builtIn, 'built-in') : null
  }
  const custom = verifiedCustomAlgorithm(data, caseId, capture.id, capture.revision)
  return custom && (capture.notation === null || capture.notation === custom.notation)
    ? resolved(customAlgorithmRecord(custom), 'custom') : null
}

/**
 * The stored preference wins. A stale/unknown stored reference falls back to
 * the built-in default rather than silently selecting another custom algorithm.
 */
export function resolvePreferredAlgorithm(
  data: TrainingData,
  caseId: string,
): ResolvedTrainingAlgorithm | null {
  const stored = data.preferences.preferredAlgorithms.find(
    (preference) => preference.caseId === caseId,
  )?.algorithm

  if (stored) {
    const builtIn = BUILT_IN_ALGORITHM_BY_ID.get(stored.id)
    if (
      builtIn &&
      builtIn.caseId === caseId &&
      builtIn.version === stored.revision
    ) {
      return resolved(builtIn, 'built-in')
    }
    const custom = verifiedCustomAlgorithm(
      data,
      caseId,
      stored.id,
      stored.revision,
    )
    if (custom) return resolved(customAlgorithmRecord(custom), 'custom')
  }

  const defaultAlgorithm = builtInAlgorithmForCase(caseId)
  if (defaultAlgorithm) return resolved(defaultAlgorithm, 'built-in')

  const custom = [...data.customAlgorithms]
    .reverse()
    .find(
      (algorithm) =>
        algorithm.caseId === caseId &&
        algorithm.verification?.status === 'verified',
    )
  return custom ? resolved(customAlgorithmRecord(custom), 'custom') : null
}

/** The preferred record when it is usable, otherwise the built-in fallback. */
export function availableAlgorithm(
  data: TrainingData,
  caseId: string,
): TrainingAlgorithmRecord | undefined {
  return resolvePreferredAlgorithm(data, caseId)?.record
}

/**
 * Every valid choice for a case: the built-in default plus verified custom
 * revisions, newest first. The preferred record is first when it is usable.
 */
export function availableAlgorithms(
  data: TrainingData,
  caseId: string,
): readonly ResolvedTrainingAlgorithm[] {
  const choices: ResolvedTrainingAlgorithm[] = []
  const seen = new Set<string>()
  const preferred = resolvePreferredAlgorithm(data, caseId)

  const add = (value: ResolvedTrainingAlgorithm) => {
    const key = `${value.record.id}\u0000${value.record.version}`
    if (seen.has(key)) return
    seen.add(key)
    choices.push(value)
  }

  if (preferred) add(preferred)
  const builtIn = builtInAlgorithmForCase(caseId)
  if (builtIn) add(resolved(builtIn, 'built-in'))
  for (const algorithm of [...data.customAlgorithms].reverse()) {
    if (
      algorithm.caseId === caseId &&
      algorithm.verification?.status === 'verified'
    ) {
      add(resolved(customAlgorithmRecord(algorithm), 'custom'))
    }
  }
  return choices
}

export function preferredAlgorithmSnapshot(
  data: TrainingData,
  caseId: string,
): TrainingAlgorithmSnapshot | null {
  return resolvePreferredAlgorithm(data, caseId)?.snapshot ?? null
}
