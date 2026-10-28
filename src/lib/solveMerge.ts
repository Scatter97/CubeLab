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

function findResolvedConflict(
  local: Solve,
  field: 'rawMs' | 'penalty' | 'scramble' | 'comment',
  localValue: unknown,
  remoteValue: unknown,
  localUpdatedAt: number,
  remoteUpdatedAt: number,
  resolvedConflicts: readonly SyncConflict[],
): SyncConflict | undefined {
  // A user resolution applies only while both sides still hold the exact
  // values that were shown for review. An applied resolution stamps the winning
  // field at `conflict.updatedAt`, so later merges must accept that approval
  // timestamp as well as the originally reviewed timestamp. A third distinct
  // edit made between review and approval changes a value and raises a fresh
  // conflict instead of being silently overridden by a stale approval.
  //
  // Snapshots are merged one at a time, so the reviewed pair can arrive in
  // either orientation: the accumulator may already hold the remote value when
  // another snapshot carries the old local one. Match the pair unordered and
  // let the caller translate the stored side back to the current orientation.
  return resolvedConflicts
    .filter(
      (conflict) =>
        conflict.kind === 'solve' &&
        conflict.id === local.id &&
        conflict.field === field &&
        conflict.resolution !== 'manual-pending' &&
        localUpdatedAt <= conflict.updatedAt &&
        remoteUpdatedAt <= conflict.updatedAt &&
        ((Object.is(localValue, conflict.localValue) &&
          Object.is(remoteValue, conflict.remoteValue)) ||
          (Object.is(localValue, conflict.remoteValue) &&
            Object.is(remoteValue, conflict.localValue))),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]
}

/** Translate a stored approval side into the current merge orientation. */
function resolvedWinner(
  conflict: SyncConflict,
  localValue: unknown,
  remoteValue: unknown,
): 'local' | 'remote' {
  const sameOrientation =
    Object.is(localValue, conflict.localValue) &&
    Object.is(remoteValue, conflict.remoteValue)
  if (sameOrientation) return conflict.resolution as 'local' | 'remote'
  return conflict.resolution === 'local' ? 'remote' : 'local'
}

export function mergeSolveFields(
  local: Solve,
  remote: Solve,
  manualConflictReview: boolean,
  conflicts: SyncConflict[],
  resolvedConflicts: readonly SyncConflict[] = [],
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
  let latestResolvedUpdate = 0

  for (const field of fields) {
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
      // Never invent provenance for equal legacy values: persisting a merge-time
      // fallback would make a no-op sync look like an edit and weaken the
      // deterministic editor-ID tiebreak.
      const localMeta = local.fieldUpdates?.[field]
      const remoteMeta = remote.fieldUpdates?.[field]
      if (localMeta && remoteMeta) {
        fieldUpdates[field] =
          localMeta.updatedAt > remoteMeta.updatedAt ||
          (localMeta.updatedAt === remoteMeta.updatedAt && localMeta.editorId <= remoteMeta.editorId)
            ? localMeta : remoteMeta
      } else if (localMeta) {
        fieldUpdates[field] = localMeta
      } else if (remoteMeta) {
        fieldUpdates[field] = remoteMeta
      } else {
        delete fieldUpdates[field]
      }
      continue
    }

    const localUpdate = getFieldUpdate(local, field)
    const remoteUpdate = getFieldUpdate(remote, field)
    const resolved = findResolvedConflict(
      local,
      field,
      localValue,
      remoteValue,
      localUpdate.updatedAt,
      remoteUpdate.updatedAt,
      resolvedConflicts,
    )
    const winner = resolved
      ? resolvedWinner(resolved, localValue, remoteValue)
      : pickFieldWinner(local, remote, field)
    if (field === 'rawMs') values.rawMs = winner === 'local' ? local.rawMs : remote.rawMs
    if (field === 'penalty') values.penalty = winner === 'local' ? local.penalty : remote.penalty
    if (field === 'scramble') values.scramble = winner === 'local' ? local.scramble : remote.scramble
    if (field === 'comment') values.comment = winner === 'local' ? local.comment : remote.comment

    if (resolved) {
      // Stamp the approved value as newer so a third device that receives the
      // uploaded result also converges on the user's choice.
      latestResolvedUpdate = Math.max(latestResolvedUpdate, resolved.updatedAt)
      fieldUpdates[field] = {
        updatedAt: resolved.updatedAt,
        editorId: winner === 'local' ? localUpdate.editorId : remoteUpdate.editorId,
      }
      continue
    }

    fieldUpdates[field] =
      winner === 'local' ? localUpdate : remoteUpdate

    const resolutionWinner =
      manualConflictReview ? 'manual-pending' : winner === 'local' ? 'local' : 'remote'
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
    updatedAt: Math.max(recordTime(local), recordTime(remote), latestResolvedUpdate),
    ...(Object.keys(fieldUpdates).length > 0 ? { fieldUpdates } : {}),
  }
}


