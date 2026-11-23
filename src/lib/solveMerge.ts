import type { FieldUpdate, Solve } from '../types'
import { isContestedRoundId, isValidRoundId, isValidRoundIndex } from './competition'
import type { SyncConflict } from './syncStorage'

export function recordTime(item: { updatedAt?: number; createdAt?: number }): number {
  return item.updatedAt ?? item.createdAt ?? 0
}

export function solvesEqual(left: Solve, right: Solve): boolean {
  return (
    left.event === right.event &&
    left.rawMs === right.rawMs &&
    left.penalty === right.penalty &&
    left.scramble === right.scramble &&
    left.comment === right.comment &&
    (left.updatedAt ?? left.createdAt) === (right.updatedAt ?? right.createdAt)
  )
}

type SolveMergeField = 'event' | 'rawMs' | 'penalty' | 'scramble' | 'comment'

function getFieldUpdate(
  solve: Solve,
  field: SolveMergeField,
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

function fieldValue(solve: Solve, field: SolveMergeField): string | number {
  return solve[field]
}

function pickFieldWinner(
  local: Solve,
  remote: Solve,
  field: SolveMergeField,
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
  return String(fieldValue(local, field)) <= String(fieldValue(remote, field))
    ? 'local'
    : 'remote'
}

function findResolvedConflict(
  local: Solve,
  field: SolveMergeField,
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
            Object.is(remoteValue, conflict.localValue))) &&
        // Approval applies only to the exact reviewed value/timestamp pair, or
        // to a side already stamped at the approval time (the already-applied
        // winning version). A field that changed away and back with a new
        // timestamp is not covered by an older review.
        (((localUpdatedAt === conflict.localUpdatedAt &&
           remoteUpdatedAt === conflict.remoteUpdatedAt) ||
          (localUpdatedAt === conflict.remoteUpdatedAt &&
           remoteUpdatedAt === conflict.localUpdatedAt)) ||
         localUpdatedAt === conflict.updatedAt ||
         remoteUpdatedAt === conflict.updatedAt ||
         localUpdatedAt === conflict.priorUpdatedAt ||
         remoteUpdatedAt === conflict.priorUpdatedAt),
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

export interface ResolvedSolveEvent {
  event: Solve['event']
  update?: FieldUpdate
  resolvedAt: number
}

/**
 * Puzzle event is normally immutable, so legacy disagreement still stops sync.
 * A deliberate reclassification carries explicit per-field metadata; that
 * provenance lets the newer event win and lets two devices converge without
 * guessing from time or scramble text.
 */
export function resolveSolveEvent(
  local: Solve,
  remote: Solve,
  manualConflictReview: boolean,
  conflicts: SyncConflict[],
  resolvedConflicts: readonly SyncConflict[] = [],
): ResolvedSolveEvent {
  if (local.event === remote.event) {
    const localExplicit = local.fieldUpdates?.event
    const remoteExplicit = remote.fieldUpdates?.event
    return {
      event: local.event,
      update:
        localExplicit && remoteExplicit
          ? localExplicit.updatedAt > remoteExplicit.updatedAt ||
            (localExplicit.updatedAt === remoteExplicit.updatedAt &&
              localExplicit.editorId <= remoteExplicit.editorId)
            ? localExplicit
            : remoteExplicit
          : localExplicit ?? remoteExplicit,
      resolvedAt: 0,
    }
  }

  const localExplicit = local.fieldUpdates?.event
  const remoteExplicit = remote.fieldUpdates?.event
  if (!localExplicit && !remoteExplicit) {
    throw new Error(`Conflicting events for solve ${local.id}. Synchronization was stopped to protect data.`)
  }
  if (localExplicit && !remoteExplicit) {
    return { event: local.event, update: localExplicit, resolvedAt: 0 }
  }
  if (remoteExplicit && !localExplicit) {
    return { event: remote.event, update: remoteExplicit, resolvedAt: 0 }
  }

  const localUpdate = localExplicit!
  const remoteUpdate = remoteExplicit!
  const resolved = findResolvedConflict(
    local,
    'event',
    local.event,
    remote.event,
    localUpdate.updatedAt,
    remoteUpdate.updatedAt,
    resolvedConflicts,
  )
  const winner = resolved
    ? resolvedWinner(resolved, local.event, remote.event)
    : pickFieldWinner(local, remote, 'event')

  if (!resolved) {
    conflicts.push({
      id: local.id,
      kind: 'solve',
      sessionId: undefined,
      field: 'event',
      localValue: local.event,
      remoteValue: remote.event,
      localUpdatedAt: localUpdate.updatedAt,
      remoteUpdatedAt: remoteUpdate.updatedAt,
      resolution: manualConflictReview ? 'manual-pending' : winner,
      updatedAt: Math.max(localUpdate.updatedAt, remoteUpdate.updatedAt, Date.now()),
    })
  }

  return {
    event: winner === 'local' ? local.event : remote.event,
    update: resolved
      ? {
          updatedAt: Math.max(
            resolved.updatedAt,
            localUpdate.updatedAt,
            remoteUpdate.updatedAt,
          ),
          editorId: winner === 'local' ? localUpdate.editorId : remoteUpdate.editorId,
        }
      : winner === 'local'
        ? localUpdate
        : remoteUpdate,
    resolvedAt: resolved?.updatedAt ?? 0,
  }
}

export interface MergedRoundMembership {
  roundId?: string
  roundIndex?: number
}

type RoundMembershipSource = Pick<Solve, 'roundId' | 'roundIndex'>

/**
 * Round membership is immutable session structure, not a user-edited field.
 * A stale assignment to the original round must not undo a contest that has
 * already been resolved into a deterministic `contested:` round, regardless of
 * which snapshot is the merge accumulator. Two unresolved ordinary assignments
 * keep the existing local-first policy; two resolved contests choose the
 * lexicographically earlier round ID so either merge direction converges.
 */
export function mergeRoundMembership(
  local: RoundMembershipSource | undefined,
  remote: RoundMembershipSource | undefined,
): MergedRoundMembership {
  const localRoundId = isValidRoundId(local?.roundId) ? local.roundId : undefined
  const remoteRoundId = isValidRoundId(remote?.roundId) ? remote.roundId : undefined
  if (!localRoundId) {
    return remoteRoundId
      ? {
          roundId: remoteRoundId,
          ...(isValidRoundIndex(remote!.roundIndex)
            ? { roundIndex: remote!.roundIndex }
            : {}),
        }
      : {}
  }
  if (!remoteRoundId) {
    return {
      roundId: localRoundId,
      ...(isValidRoundIndex(local!.roundIndex)
        ? { roundIndex: local!.roundIndex }
        : {}),
    }
  }
  if (localRoundId === remoteRoundId) {
    return {
      roundId: localRoundId,
      ...(isValidRoundIndex(local!.roundIndex)
        ? { roundIndex: local!.roundIndex }
        : isValidRoundIndex(remote!.roundIndex)
          ? { roundIndex: remote!.roundIndex }
          : {}),
    }
  }

  const localContested = isContestedRoundId(localRoundId)
  const remoteContested = isContestedRoundId(remoteRoundId)
  const useLocal =
    localContested !== remoteContested
      ? localContested
      : localContested && remoteContested
        ? localRoundId <= remoteRoundId
        : true
  const source = useLocal ? local! : remote!
  return {
    roundId: source.roundId!,
    ...(isValidRoundIndex(source.roundIndex)
      ? { roundIndex: source.roundIndex }
      : {}),
  }
}

/**
 * Applies a resolved round assignment after a durable transfer has decided the
 * destination session. An empty assignment removes stale source-round fields so
 * the destination session can assign its own slots.
 */
export function applyRoundMembership(
  solve: Solve,
  round: MergedRoundMembership,
): Solve {
  const { roundId: _roundId, roundIndex: _roundIndex, ...rest } = solve
  if (!isValidRoundId(round.roundId)) return rest
  return {
    ...rest,
    roundId: round.roundId,
    ...(isValidRoundIndex(round.roundIndex)
      ? { roundIndex: round.roundIndex }
      : {}),
  }
}

export function mergeSolveFields(
  local: Solve,
  remote: Solve,
  manualConflictReview: boolean,
  conflicts: SyncConflict[],
  resolvedConflicts: readonly SyncConflict[] = [],
): Solve {
  const values = {
    rawMs: local.rawMs,
    penalty: local.penalty as 'none' | '+2' | 'dnf',
    scramble: local.scramble,
    comment: local.comment,
  }
  const fieldUpdates: NonNullable<Solve['fieldUpdates']> = { ...(local.fieldUpdates ?? {}) }
  let latestResolvedUpdate = 0

  const resolvedEvent = resolveSolveEvent(
    local,
    remote,
    manualConflictReview,
    conflicts,
    resolvedConflicts,
  )
  if (resolvedEvent.update) fieldUpdates.event = resolvedEvent.update
  else delete fieldUpdates.event
  latestResolvedUpdate = Math.max(latestResolvedUpdate, resolvedEvent.resolvedAt)

  const fields: Array<'rawMs' | 'penalty' | 'scramble' | 'comment'> = [
    'rawMs',
    'penalty',
    'scramble',
    'comment',
  ]

  for (const field of fields) {
    const localValue = local[field]
    const remoteValue = remote[field]
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

  const importSource = local.importSource ?? remote.importSource
  const round = mergeRoundMembership(local, remote)

  return {
    id: local.id,
    event: resolvedEvent.event,
    rawMs: values.rawMs,
    penalty: values.penalty,
    scramble: values.scramble,
    comment: values.comment,
    createdAt: Math.min(local.createdAt, remote.createdAt),
    updatedAt: Math.max(recordTime(local), recordTime(remote), latestResolvedUpdate),
    ...(Object.keys(fieldUpdates).length > 0 ? { fieldUpdates } : {}),
    ...(importSource ? { importSource } : {}),
    ...(round.roundId ? { roundId: round.roundId } : {}),
    ...(round.roundIndex !== undefined ? { roundIndex: round.roundIndex } : {}),
  }
}


