import type {
  FieldUpdate,
  PuzzleEvent,
  Session,
  SessionFieldUpdates,
  SessionPreferenceKey,
  SessionPreferences,
} from '../types'
import type { SyncConflict } from './syncStorage'
import { normalizeSessionName } from './sessions'
import { SESSION_PREFERENCE_KEYS } from './sessionPreferenceKeys'

export type SessionMetadataField =
  | 'name'
  | 'event'
  | 'inspectionEnabled'
  | `preferences.${SessionPreferenceKey}`

export interface MergedSessionMetadata {
  name: string
  event: PuzzleEvent | undefined
  inspectionEnabled: boolean | undefined
  preferences: SessionPreferences | undefined
  fieldUpdates: SessionFieldUpdates | undefined
}

function isValidFieldUpdate(value: FieldUpdate | undefined): value is FieldUpdate {
  return Boolean(
    value &&
      Number.isFinite(value.updatedAt) &&
      value.updatedAt >= 0 &&
      typeof value.editorId === 'string' &&
      value.editorId.length > 0,
  )
}

function fallbackFieldUpdate(session: Session): FieldUpdate {
  // This is a merge-time fallback, not a fabricated persisted timestamp.
  return {
    updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : 0,
    editorId: 'legacy',
  }
}

export function getSessionFieldUpdate(
  session: Session,
  field: 'name' | 'event' | 'inspectionEnabled',
): FieldUpdate {
  const explicit = session.fieldUpdates?.[field]
  return isValidFieldUpdate(explicit) ? explicit : fallbackFieldUpdate(session)
}

export function getSessionPreferenceUpdate(
  session: Session,
  key: SessionPreferenceKey,
): FieldUpdate {
  const explicit = session.fieldUpdates?.preferences?.[key]
  return isValidFieldUpdate(explicit) ? explicit : fallbackFieldUpdate(session)
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right)
  }
  return false
}

function pickWinner(
  localUpdate: FieldUpdate,
  remoteUpdate: FieldUpdate,
  localValue: unknown,
  remoteValue: unknown,
): 'local' | 'remote' {
  if (localUpdate.updatedAt !== remoteUpdate.updatedAt) {
    return localUpdate.updatedAt > remoteUpdate.updatedAt ? 'local' : 'remote'
  }
  if (localUpdate.editorId !== remoteUpdate.editorId) {
    // The smaller editor ID is chosen consistently by both devices.
    return localUpdate.editorId < remoteUpdate.editorId ? 'local' : 'remote'
  }
  return String(localValue) <= String(remoteValue) ? 'local' : 'remote'
}

function newestUpdate(left: FieldUpdate, right: FieldUpdate): FieldUpdate {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt ? left : right
  }
  return left.editorId <= right.editorId ? left : right
}

/** Newest timestamp carried by any session field, including explicit deletions. */
export function maxSessionFieldUpdateTime(
  session: Pick<Session, 'fieldUpdates'>,
): number {
  let latest = 0
  const updates = session.fieldUpdates
  if (!updates) return latest
  for (const update of [updates.name, updates.event, updates.inspectionEnabled]) {
    if (update) latest = Math.max(latest, update.updatedAt)
  }
  for (const update of Object.values(updates.preferences ?? {})) {
    if (update) latest = Math.max(latest, update.updatedAt)
  }
  return latest
}

function hasPreferenceUpdate(session: Session, key: SessionPreferenceKey): boolean {
  return isValidFieldUpdate(session.fieldUpdates?.preferences?.[key])
}

function hasExplicitFieldUpdate(
  session: Session,
  field: SessionMetadataField,
): boolean {
  if (field.startsWith('preferences.')) {
    return hasPreferenceUpdate(
      session,
      field.slice('preferences.'.length) as SessionPreferenceKey,
    )
  }
  return isValidFieldUpdate(
    session.fieldUpdates?.[field as 'name' | 'event' | 'inspectionEnabled'],
  )
}

function findResolvedConflict(
  session: Session,
  field: SessionMetadataField,
  localValue: unknown,
  remoteValue: unknown,
  localUpdatedAt: number,
  remoteUpdatedAt: number,
  resolvedConflicts: readonly SyncConflict[],
): SyncConflict | undefined {
  return resolvedConflicts
    .filter(
      (conflict) =>
        conflict.kind === 'session' &&
        conflict.id === session.id &&
        conflict.field === field &&
        conflict.resolution !== 'manual-pending' &&
        // Applying a resolution stamps the winning field at
        // `conflict.updatedAt`; accept that post-approval timestamp while still
        // rejecting genuine edits made after the review timestamp.
        localUpdatedAt <= conflict.updatedAt &&
        remoteUpdatedAt <= conflict.updatedAt &&
        // The reviewed pair can arrive in either orientation because remote
        // snapshots are merged one at a time. Match unordered and translate the
        // stored side when choosing the winner.
        ((valuesEqual(conflict.localValue, localValue) &&
          valuesEqual(conflict.remoteValue, remoteValue)) ||
          (valuesEqual(conflict.localValue, remoteValue) &&
            valuesEqual(conflict.remoteValue, localValue))),
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
    valuesEqual(localValue, conflict.localValue) &&
    valuesEqual(remoteValue, conflict.remoteValue)
  if (sameOrientation) return conflict.resolution as 'local' | 'remote'
  return conflict.resolution === 'local' ? 'remote' : 'local'
}

function mergeField(options: {
  local: Session
  remote: Session
  field: SessionMetadataField
  localValue: unknown
  remoteValue: unknown
  localUpdate: FieldUpdate
  remoteUpdate: FieldUpdate
  manualConflictReview: boolean
  conflicts: SyncConflict[]
  resolvedConflicts: readonly SyncConflict[]
}): {
  value: unknown
  update: FieldUpdate | undefined
  resolvedAt: number
} {
  const {
    local,
    remote,
    field,
    localValue,
    remoteValue,
    localUpdate,
    remoteUpdate,
    manualConflictReview,
    conflicts,
    resolvedConflicts,
  } = options

  if (valuesEqual(localValue, remoteValue)) {
    // Equal legacy values need no provenance: persisting the merge-time
    // `updatedAt` fallback would manufacture history and make a no-op sync look
    // dirty. Carry explicit metadata from either side when it exists.
    const localExplicit = hasExplicitFieldUpdate(local, field)
    const remoteExplicit = hasExplicitFieldUpdate(remote, field)
    return {
      value: localValue,
      update: localExplicit
        ? remoteExplicit
          ? newestUpdate(localUpdate, remoteUpdate)
          : localUpdate
        : remoteExplicit
          ? remoteUpdate
          : undefined,
      resolvedAt: 0,
    }
  }

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
    : pickWinner(localUpdate, remoteUpdate, localValue, remoteValue)

  if (!resolved) {
    conflicts.push({
      id: local.id,
      kind: 'session',
      sessionId: local.id,
      field,
      localValue,
      remoteValue,
      localUpdatedAt: localUpdate.updatedAt,
      remoteUpdatedAt: remoteUpdate.updatedAt,
      resolution: manualConflictReview ? 'manual-pending' : winner,
      updatedAt: Math.max(localUpdate.updatedAt, remoteUpdate.updatedAt, Date.now()),
    })
  }

  if (resolved) {
    return {
      value: winner === 'local' ? localValue : remoteValue,
      update: {
        updatedAt: Math.max(
          resolved.updatedAt,
          localUpdate.updatedAt,
          remoteUpdate.updatedAt,
        ),
        editorId: winner === 'local' ? localUpdate.editorId : remoteUpdate.editorId,
      },
      resolvedAt: resolved.updatedAt,
    }
  }

  return {
    value: winner === 'local' ? localValue : remoteValue,
    update: winner === 'local' ? localUpdate : remoteUpdate,
    resolvedAt: 0,
  }
}

/**
 * Merges session names, the inspection override, and every session preference
 * field independently. Equal values only advance metadata; differing values use
 * the newest field timestamp with an editor-ID tiebreak. Manual review can pause
 * publication for an exact reviewed conflict, and a later edit invalidates the
 * approval.
 */
export function mergeSessionMetadata(input: {
  local: Session
  remote: Session
  manualConflictReview: boolean
  conflicts: SyncConflict[]
  resolvedConflicts: readonly SyncConflict[]
}): MergedSessionMetadata {
  const { local, remote, manualConflictReview, conflicts, resolvedConflicts } = input
  const localName = normalizeSessionName(local.name)
  const remoteName = normalizeSessionName(remote.name)
  const nameResult = mergeField({
    local,
    remote,
    field: 'name',
    localValue: localName,
    remoteValue: remoteName,
    localUpdate: getSessionFieldUpdate(local, 'name'),
    remoteUpdate: getSessionFieldUpdate(remote, 'name'),
    manualConflictReview,
    conflicts,
    resolvedConflicts,
  })

  let event: PuzzleEvent | undefined
  let eventUpdate: FieldUpdate | undefined
  if (local.event === undefined && remote.event === undefined) {
    event = undefined
  } else if (local.event === undefined) {
    event = remote.event
    eventUpdate = getSessionFieldUpdate(remote, 'event')
  } else if (remote.event === undefined) {
    event = local.event
    eventUpdate = getSessionFieldUpdate(local, 'event')
  } else {
    const result = mergeField({
      local,
      remote,
      field: 'event',
      localValue: local.event,
      remoteValue: remote.event,
      localUpdate: getSessionFieldUpdate(local, 'event'),
      remoteUpdate: getSessionFieldUpdate(remote, 'event'),
      manualConflictReview,
      conflicts,
      resolvedConflicts,
    })
    event = result.value as PuzzleEvent
    eventUpdate = result.update
  }

  let inspectionEnabled: boolean | undefined
  let inspectionUpdate: FieldUpdate | undefined
  if (local.inspectionEnabled === undefined && remote.inspectionEnabled === undefined) {
    // Equal absent values may still carry an explicit "use global" timestamp
    // from one side. Keep it so the removal continues to win later merges.
    const localExplicit = hasExplicitFieldUpdate(local, 'inspectionEnabled')
    const remoteExplicit = hasExplicitFieldUpdate(remote, 'inspectionEnabled')
    inspectionUpdate = localExplicit
      ? remoteExplicit
        ? newestUpdate(
            getSessionFieldUpdate(local, 'inspectionEnabled'),
            getSessionFieldUpdate(remote, 'inspectionEnabled'),
          )
        : getSessionFieldUpdate(local, 'inspectionEnabled')
      : remoteExplicit
        ? getSessionFieldUpdate(remote, 'inspectionEnabled')
        : undefined
  } else if (
    (local.inspectionEnabled === undefined || remote.inspectionEnabled === undefined) &&
    !hasExplicitFieldUpdate(local, 'inspectionEnabled') &&
    !hasExplicitFieldUpdate(remote, 'inspectionEnabled')
  ) {
    // Legacy records have no "cleared" provenance: a present value wins over an
    // absent one so old overrides are not silently lost.
    inspectionEnabled = local.inspectionEnabled ?? remote.inspectionEnabled
    inspectionUpdate =
      local.inspectionEnabled !== undefined
        ? getSessionFieldUpdate(local, 'inspectionEnabled')
        : getSessionFieldUpdate(remote, 'inspectionEnabled')
  } else {
    const result = mergeField({
      local,
      remote,
      field: 'inspectionEnabled',
      localValue: local.inspectionEnabled,
      remoteValue: remote.inspectionEnabled,
      localUpdate: getSessionFieldUpdate(local, 'inspectionEnabled'),
      remoteUpdate: getSessionFieldUpdate(remote, 'inspectionEnabled'),
      manualConflictReview,
      conflicts,
      resolvedConflicts,
    })
    inspectionEnabled = result.value as boolean | undefined
    inspectionUpdate = result.update
  }

  const preferences: SessionPreferences = { ...(local.preferences ?? {}) }
  const preferenceUpdates: Partial<Record<SessionPreferenceKey, FieldUpdate>> = {
    ...(local.fieldUpdates?.preferences ?? {}),
  }
  for (const key of SESSION_PREFERENCE_KEYS) {
    const localValue = local.preferences?.[key]
    const remoteValue = remote.preferences?.[key]
    if (localValue === undefined && remoteValue === undefined) continue

    // A removed preference is an explicit edit: the key is absent but its
    // per-field timestamp remains. Use that metadata instead of resurrecting
    // the other device's older value. Legacy records without metadata keep the
    // conservative "a present value wins over an absent one" behavior.
    const localHasUpdate = hasPreferenceUpdate(local, key)
    const remoteHasUpdate = hasPreferenceUpdate(remote, key)
    if (
      (localValue === undefined || remoteValue === undefined) &&
      !localHasUpdate &&
      !remoteHasUpdate
    ) {
      const value = localValue ?? remoteValue
      preferences[key] = value as never
      preferenceUpdates[key] = getSessionPreferenceUpdate(
        localValue !== undefined ? local : remote,
        key,
      )
      continue
    }
    const result = mergeField({
      local,
      remote,
      field: `preferences.${key}` as SessionMetadataField,
      localValue,
      remoteValue,
      localUpdate: getSessionPreferenceUpdate(local, key),
      remoteUpdate: getSessionPreferenceUpdate(remote, key),
      manualConflictReview,
      conflicts,
      resolvedConflicts,
    })
    if (result.value === undefined) {
      delete preferences[key]
    } else {
      preferences[key] = result.value as never
    }
    if (result.update) {
      preferenceUpdates[key] = result.update
    } else {
      delete preferenceUpdates[key]
    }
  }

  const fieldUpdates: SessionFieldUpdates = {}
  const nameUpdate = nameResult.update
  if (nameUpdate) fieldUpdates.name = nameUpdate
  if (inspectionUpdate) fieldUpdates.inspectionEnabled = inspectionUpdate
  if (Object.keys(preferenceUpdates).length > 0) {
    fieldUpdates.preferences = preferenceUpdates
  }
  if (eventUpdate) fieldUpdates.event = eventUpdate

  return {
    name: nameResult.value as string,
    event,
    inspectionEnabled,
    preferences: Object.keys(preferences).length > 0 ? preferences : undefined,
    fieldUpdates: Object.keys(fieldUpdates).length > 0 ? fieldUpdates : undefined,
  }
}
