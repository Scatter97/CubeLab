/**
 * Durable Training deletion intent. Records are written before local history
 * vanishes and revoked on Undo or a failed local write.
 */
import type { TrainingAttempt, TrainingPreset, TrainingVisit } from './training/types'
import {
  loadTrainingSyncStorage,
  saveTrainingSyncStorage,
  type TrainingTombstone,
} from './trainingSyncStorage'
import type { StorageLike } from './storage'

export interface TrainingDeletionLedger {
  recordAttemptDeletion(attempt: TrainingAttempt, at?: number): boolean
  revokeAttemptDeletion(attemptId: string, at?: number): boolean
  recordVisitDeletion(visit: TrainingVisit, at?: number): boolean
  revokeVisitDeletion(visitId: string, at?: number): boolean
  recordPresetDeletion(preset: TrainingPreset, at?: number): boolean
  revokePresetDeletion(presetId: string, at?: number): boolean
  /** Writes the visit and every attempt tombstone in one storage write. */
  recordArchivedSessionDeletion(
    visit: TrainingVisit,
    attempts: readonly TrainingAttempt[],
    at?: number,
  ): boolean
  /** Revokes the visit and every attempt tombstone in one storage write. */
  revokeArchivedSessionDeletion(
    visitId: string,
    attemptIds: readonly string[],
    at?: number,
  ): boolean
}

function isActiveTombstone(tombstone: TrainingTombstone): boolean {
  return (
    tombstone.restoredAt === undefined ||
    tombstone.restoredAt <= tombstone.deletedAt
  )
}

function upsertTombstones(
  current: readonly TrainingTombstone[],
  additions: readonly TrainingTombstone[],
): TrainingTombstone[] {
  const next = [...current]
  for (const addition of additions) {
    const index = next.findIndex(
      (candidate) =>
        candidate.kind === addition.kind && candidate.id === addition.id,
    )
    // An already-active deletion is already durable. Do not move its
    // timestamp; a later remote row must not win by looking newer.
    if (index !== -1 && isActiveTombstone(next[index]!)) continue
    if (index !== -1) next.splice(index, 1)
    next.push(addition)
  }
  return next
}

function replaceTombstones(
  storage: StorageLike | null | undefined,
  additions: readonly TrainingTombstone[],
): boolean {
  const current = loadTrainingSyncStorage(storage)
  return saveTrainingSyncStorage(
    {
      ...current,
      runtime: {
        ...current.runtime,
        tombstones: upsertTombstones(current.runtime.tombstones, additions),
      },
    },
    storage,
  )
}

function revokeTombstones(
  storage: StorageLike | null | undefined,
  keys: readonly Pick<TrainingTombstone, 'kind' | 'id'>[],
  at: number,
): boolean {
  const current = loadTrainingSyncStorage(storage)
  const next = current.runtime.tombstones.map((tombstone) => {
    if (
      !keys.some(
        (key) => key.kind === tombstone.kind && key.id === tombstone.id,
      )
    ) {
      return tombstone
    }
    if (!isActiveTombstone(tombstone)) return tombstone
    return {
      ...tombstone,
      restoredAt: Math.max(at, tombstone.deletedAt + 1),
    }
  })
  return saveTrainingSyncStorage(
    {
      ...current,
      runtime: { ...current.runtime, tombstones: next },
    },
    storage,
  )
}

function recordDeletion(
  kind: TrainingTombstone['kind'],
  id: string,
  storage: StorageLike | null | undefined,
  at: number,
  extra: Pick<TrainingTombstone, 'visitId' | 'attemptIds'> = {},
): boolean {
  const current = loadTrainingSyncStorage(storage)
  return replaceTombstones(storage, [
    {
      kind,
      id,
      ...extra,
      deletedAt: at,
      deletedByDeviceId: current.runtime.deviceId,
    },
  ])
}

function revokeDeletion(
  kind: TrainingTombstone['kind'],
  id: string,
  storage: StorageLike | null | undefined,
  at: number,
): boolean {
  return revokeTombstones(storage, [{ kind, id }], at)
}

export function createTrainingDeletionLedger(
  storage?: StorageLike | null,
): TrainingDeletionLedger {
  const target = storage
  return {
    recordAttemptDeletion(attempt, at = Date.now()) {
      return recordDeletion('attempt', attempt.id, target, at, {
        visitId: attempt.visitId,
      })
    },
    revokeAttemptDeletion(attemptId, at = Date.now()) {
      return revokeDeletion('attempt', attemptId, target, at)
    },
    recordVisitDeletion(visit, at = Date.now()) {
      return recordDeletion('visit', visit.id, target, at, {
        attemptIds: [...visit.attemptIds],
      })
    },
    revokeVisitDeletion(visitId, at = Date.now()) {
      return revokeDeletion('visit', visitId, target, at)
    },
    recordPresetDeletion(preset, at = Date.now()) {
      return recordDeletion('preset', preset.id, target, at)
    },
    revokePresetDeletion(presetId, at = Date.now()) {
      return revokeDeletion('preset', presetId, target, at)
    },
    recordArchivedSessionDeletion(visit, attempts, at = Date.now()) {
      const current = loadTrainingSyncStorage(target)
      return replaceTombstones(target, [
        {
          kind: 'visit',
          id: visit.id,
          attemptIds: [...visit.attemptIds],
          deletedAt: at,
          deletedByDeviceId: current.runtime.deviceId,
        },
        ...attempts.map((attempt) => ({
          kind: 'attempt' as const,
          id: attempt.id,
          visitId: attempt.visitId,
          deletedAt: at,
          deletedByDeviceId: current.runtime.deviceId,
        })),
      ])
    },
    revokeArchivedSessionDeletion(visitId, attemptIds, at = Date.now()) {
      return revokeTombstones(
        target,
        [
          { kind: 'visit', id: visitId },
          ...attemptIds.map((id) => ({ kind: 'attempt' as const, id })),
        ],
        at,
      )
    },
  }
}

/** The browser-backed ledger used by the Training controller. */
export const browserTrainingDeletionLedger = createTrainingDeletionLedger()
