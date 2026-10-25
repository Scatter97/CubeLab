import type { FieldUpdate, Solve } from '../types'
import type { SyncConflict } from './syncStorage'

export function recordTime(item: { updatedAt?: number; createdAt?: number }): number {
  return item.updatedAt ?? item.createdAt ?? 0
}

export function solvesEqual(left: Solve, right: Solve): boolean {
  return (
    left.rawMs === right.rawMs &&
    left.penalty === right.penalty &&
    left.scramble === right.scramble &&
    left.comment === right.comment &&
    (left.updatedAt ?? left.createdAt) === (right.updatedAt ?? right.createdAt)
  )
}

function getFieldUpdate(
  solve: Solve,
  field: 'rawMs' | 'penalty' | 'scramble' | 'comment',
): FieldUpdate {
  const existing = solve.fieldUpdates?.[field]
  if (existing && Number.isFinite(existing.updatedAt) && typeof existing.editorId === 'string') {
    return existing
  }
  // Modern records track fields independently: a comment edit must not make
  // an unchanged penalty look newer. Truly legacy records fall back to updatedAt.
  const fallbackTime = solve.fieldUpdates && Object.keys(solve.fieldUpdates).length > 0
    ? solve.createdAt : (solve.updatedAt ?? solve.createdAt ?? 0)
  return { updatedAt: fallbackTime, editorId: 'legacy' }
}

function pickFieldWinner(
  local: Solve,
  remote: Solve,
  field: 'rawMs' | 'penalty' | 'scramble' | 'comment',
): 'local' | 'remote' {
  const localUpdate = getFieldUpdate(local, field)
  const remoteUpdate = getFieldUpdate(remote, field)
  if (localUpdate.updatedAt !== remoteUpdate.updatedAt) {
    return localUpdate.updatedAt > remoteUpdate.updatedAt ? 'local' : 'remote'
  }
  if (localUpdate.editorId !== remoteUpdate.editorId) {
    return localUpdate.editorId < remoteUpdate.editorId ? 'local' : 'remote'
  }
  // Equal modification metadata: remain deterministic in either merge order.
  const localValue =
    field === 'rawMs' ? local.rawMs :
    field === 'penalty' ? local.penalty :
    field === 'scramble' ? local.scramble : local.comment
  const remoteValue =
    field === 'rawMs' ? remote.rawMs :
    field === 'penalty' ? remote.penalty :
    field === 'scramble' ? remote.scramble : remote.comment
  return String(localValue) <= String(remoteValue) ? 'local' : 'remote'
}

export function mergeSolveFields(
  local: Solve,
  remote: Solve,
  manualConflictReview: boolean,
  conflicts: SyncConflict[],
): Solve {
  const fields: Array<'rawMs' | 'penalty' | 'scramble' | 'comment'> = [
    'rawMs',
    'penalty',
    'scramble',
    'comment',
  ]
  const values = {
    rawMs: local.rawMs,
    penalty: local.penalty as 'none' | '+2' | 'dnf',
    scramble: local.scramble,
    comment: local.comment,
  }
  const fieldUpdates: NonNullable<Solve['fieldUpdates']> = { ...(local.fieldUpdates ?? {}) }

  for (const field of fields) {
    const winner = pickFieldWinner(local, remote, field)
    const localValue =
      field === 'rawMs' ? local.rawMs :
      field === 'penalty' ? local.penalty :
      field === 'scramble' ? local.scramble : local.comment
    const remoteValue =
      field === 'rawMs' ? remote.rawMs :
      field === 'penalty' ? remote.penalty :
      field === 'scramble' ? remote.scramble : remote.comment
    if (localValue === remoteValue) {
      // Two identical values can still carry different modification metadata.
      const localMeta = getFieldUpdate(local, field)
      const remoteMeta = getFieldUpdate(remote, field)
      fieldUpdates[field] =
        localMeta.updatedAt > remoteMeta.updatedAt ||
        (localMeta.updatedAt === remoteMeta.updatedAt && localMeta.editorId <= remoteMeta.editorId)
          ? localMeta : remoteMeta
      continue
    }

    const winningUpdate =
      winner === 'local'
        ? getFieldUpdate(local, field)
        : getFieldUpdate(remote, field)
    if (field === 'rawMs') values.rawMs = winner === 'local' ? local.rawMs : remote.rawMs
    if (field === 'penalty') values.penalty = winner === 'local' ? local.penalty : remote.penalty
    if (field === 'scramble') values.scramble = winner === 'local' ? local.scramble : remote.scramble
    if (field === 'comment') values.comment = winner === 'local' ? local.comment : remote.comment
    fieldUpdates[field] = winningUpdate

    const localUpdate = getFieldUpdate(local, field)
    const remoteUpdate = getFieldUpdate(remote, field)
    const resolutionWinner =
      manualConflictReview && winner !== undefined ? 'manual-pending' : winner === 'local' ? 'local' : 'remote'
    conflicts.push({
      id: local.id,
      kind: 'solve',
      sessionId: undefined,
      field,
      localValue,
      remoteValue,
      localUpdatedAt: localUpdate.updatedAt,
      remoteUpdatedAt: remoteUpdate.updatedAt,
      resolution: resolutionWinner,
      updatedAt: Math.max(localUpdate.updatedAt, remoteUpdate.updatedAt, Date.now()),
    })
  }

  if (local.event !== remote.event) {
    throw new Error(`Conflicting events for solve ${local.id}. Synchronization was stopped to protect data.`)
  }
  return {
    id: local.id,
    event: local.event,
    rawMs: values.rawMs,
    penalty: values.penalty,
    scramble: values.scramble,
    comment: values.comment,
    createdAt: Math.min(local.createdAt, remote.createdAt),
    updatedAt: Math.max(recordTime(local), recordTime(remote)),
    fieldUpdates,
  }
}


