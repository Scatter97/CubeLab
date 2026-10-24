import type { FieldUpdate, Session, SessionsData, Settings, Solve } from '../types'
import { DEFAULT_SESSION_NAME, normalizeSessionName } from './sessions'
import { applySessionRedirects, normalizeSessionRedirects } from './sessionRedirects'
import type { SyncConflict, Tombstone, SessionRedirect } from './syncStorage'


export const SYNC_PROTOCOL_VERSION = 1

export interface SyncEnvelope {
  protocolVersion: typeof SYNC_PROTOCOL_VERSION
  revision: number
  deviceId: string
  updatedAt: number
  tombstones: Tombstone[]
  conflicts: SyncConflict[]
  sessionRedirects: SessionRedirect[]
}

function isUntouchedDefaultSession(session: Session): boolean {
  return (
    normalizeSessionName(session.name) === DEFAULT_SESSION_NAME &&
    session.solves.length === 0 &&
    session.inspectionEnabled === undefined &&
    session.createdAt === session.updatedAt
  )
}

export interface SyncMergeResult {
  merged: SessionsData
  adoptedLocalDefault: boolean
  duplicateSessionNames: string[]
  sessionRedirects: SessionRedirect[]
  addedSolves: number
  updatedSolves: number
  removedSolves: number
  addedSessions: number
  remoteWins: number
  conflicts: SyncConflict[]
  mergedTombstones: Tombstone[]
}

function recordTime(item: { updatedAt?: number; createdAt?: number }): number {
  return item.updatedAt ?? item.createdAt ?? 0
}

function normalizeSolve(solve: Solve, now: number): Solve {
  return {
    ...solve,
    updatedAt: solve.updatedAt ?? solve.createdAt ?? now,
  }
}

function solvesEqual(left: Solve, right: Solve): boolean {
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
  const fallbackTime = solve.updatedAt ?? solve.createdAt ?? 0
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

function mergeSolveFields(
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
      const updates = local.fieldUpdates?.[field] ? [getFieldUpdate(local, field)] : []
      const remoteUpdate = getFieldUpdate(remote, field)
      const latest =
        updates.length > 0
          ? updates.reduce((best, current) =>
              current.updatedAt > best.updatedAt ||
              (current.updatedAt === best.updatedAt && current.editorId < best.editorId)
                ? current
                : best,
            )
          : remoteUpdate
      fieldUpdates[field] = latest ?? remoteUpdate
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

  return {
    id: local.id,
    event: local.event === '333' ? local.event : remote.event,
    rawMs: values.rawMs,
    penalty: values.penalty,
    scramble: values.scramble,
    comment: values.comment,
    createdAt: Math.min(local.createdAt, remote.createdAt),
    updatedAt: Math.max(recordTime(local), recordTime(remote)),
    fieldUpdates,
  }
}


export function mergeSessionsData(input: {
  local: SessionsData
  remote: SessionsData | null
  tombstones: Tombstone[]
  sessionRedirects?: SessionRedirect[]
  deviceId: string
  manualConflictReview: boolean
}): SyncMergeResult {
  const redirects = input.sessionRedirects ?? []
  const local = redirects.length > 0 ? applySessionRedirects(input.local, redirects) : input.local
  const remote = input.remote && redirects.length > 0 ? applySessionRedirects(input.remote, redirects) : input.remote
  const { tombstones, manualConflictReview } = input
  const conflicts: SyncConflict[] = []

  const localSession = local.sessions[0]
  const isFreshLocalDefault = local.sessions.length === 1 && localSession && isUntouchedDefaultSession(localSession)

  const deletedSolveIds = new Set((tombstones ?? []).filter((t) => t.kind === 'solve').map((t) => t.id))
  const deletedSessionIds = new Set((tombstones ?? []).filter((t) => t.kind === 'session').map((t) => t.id))

  const hasRelevantCloudContent =
    !!remote &&
    remote.sessions.length > 0 &&
    remote.sessions.some((session) => {
      if (deletedSessionIds.has(session.id)) return false
      return session.solves.length > 0 && session.solves.some((solve) => !deletedSolveIds.has(solve.id))
    })

  // Phase 2C safety: if the local device has only an untouched, generated
  // default session, adopt the cloud session collection instead of keeping an
  // unnecessary duplicate placeholder. Tombstoned cloud records are retained in
  // the tombstone set, but they are never resurrected through adoption.
  if (remote && hasRelevantCloudContent && isFreshLocalDefault) {
    const adoptedSessions = remote.sessions
      .filter((session) => !deletedSessionIds.has(session.id))
      .map((session) => ({
        ...session,
        solves: session.solves.filter((solve) => !deletedSolveIds.has(solve.id)).map((solve) => ({ ...solve })),
      }))

    if (adoptedSessions.length > 0) {
      return {
      merged: {
        activeSessionId:
          remote.activeSessionId && adoptedSessions.some((session) => session.id === remote.activeSessionId)
            ? remote.activeSessionId
            : adoptedSessions[0]?.id ?? local.activeSessionId,
        sessions: adoptedSessions,
      },
      adoptedLocalDefault: true,
      duplicateSessionNames: [],
      sessionRedirects: normalizeSessionRedirects(input.sessionRedirects ?? []),
      addedSolves: remote.sessions.reduce((total, session) => total + session.solves.length, 0),
      updatedSolves: 0,
      removedSolves: 0,
      addedSessions: adoptedSessions.length,
      remoteWins: 0,
      conflicts: [],
      mergedTombstones: [...tombstones],
    }
    }
  }

  const localSessions = new Map(local.sessions.map((session) => [session.id, session]))
  const remoteSessions = new Map(
    (remote?.sessions ?? []).map((session) => [session.id, session]),
  )
  const sessionIds = new Set([...localSessions.keys(), ...remoteSessions.keys()])

  // Determine which session each solve should live in by newest solve edit time.
  const solveToSession = new Map<string, string>()
  const solveById = new Map<string, { local?: Solve; remote?: Solve; sessionId: string }>()
  for (const sessionId of sessionIds) {
    if (deletedSessionIds.has(sessionId)) continue
    const localSession = localSessions.get(sessionId)
    const remoteSession = remoteSessions.get(sessionId)
    const localSolves = localSession?.solves ?? []
    const remoteSolves = remoteSession?.solves ?? []
    for (const solve of localSolves) {
      if (deletedSolveIds.has(solve.id)) continue
      solveById.set(solve.id, { ...(solveById.get(solve.id) ?? {}), local: solve, sessionId })
      if (!solveToSession.has(solve.id)) solveToSession.set(solve.id, sessionId)
    }
    for (const solve of remoteSolves) {
      if (deletedSolveIds.has(solve.id)) continue
      const existing = solveById.get(solve.id)
      solveById.set(solve.id, { ...(existing ?? {}), remote: solve, sessionId: existing?.sessionId ?? sessionId })
      const currentTarget = solveToSession.get(solve.id)
      if (
        !currentTarget ||
        recordTime(solve) > recordTime(existing?.local ?? existing?.remote ?? solve)
      ) {
        solveToSession.set(solve.id, sessionId)
      }
    }
  }

  // Solve creation/movement conflict logging.
  for (const [solveId, occurrence] of solveById.entries()) {
    const localSessionId = local.sessions.find((session) =>
      session.solves.some((solve) => solve.id === solveId),
    )?.id
    const remoteSessionId = remote?.sessions.find((session) =>
      session.solves.some((solve) => solve.id === solveId),
    )?.id
    if (localSessionId && remoteSessionId && localSessionId !== remoteSessionId) {
      conflicts.push({
        id: solveId,
        kind: 'solve',
        sessionId: solveToSession.get(solveId),
        field: 'sessionId',
        localValue: localSessionId,
        remoteValue: remoteSessionId,
        localUpdatedAt: recordTime(occurrence.local ?? occurrence.remote!),
        remoteUpdatedAt: recordTime(occurrence.remote ?? occurrence.local!),
        resolution: 'local',
        updatedAt: Date.now(),
      })
    }
  }

  const mergedSessions: Session[] = []
  let addedSessions = 0
  let addedSolves = 0
  let updatedSolves = 0
  let removedSolves = 0

  for (const sessionId of sessionIds) {
    if (deletedSessionIds.has(sessionId)) {
      removedSolves += (localSessions.get(sessionId)?.solves.length ?? 0) +
        (remoteSessions.get(sessionId)?.solves.length ?? 0)
      continue
    }

    const localSession = localSessions.get(sessionId)
    const remoteSession = remoteSessions.get(sessionId)
    if (!localSession && !remoteSession) continue
    if (!localSession) addedSessions += 1
    if (!remoteSession) {
      // Still include local-only session.
    }

    const createdAt = Math.min(
      localSession?.createdAt ?? remoteSession!.createdAt,
      remoteSession?.createdAt ?? localSession!.createdAt,
    )
    const updatedAt = Math.max(
      localSession?.updatedAt ?? 0,
      remoteSession?.updatedAt ?? 0,
      0,
    )

    const name =
      remoteSession && localSession
        ? recordTime(remoteSession) > recordTime(localSession)
          ? remoteSession.name
          : localSession.name
        : (localSession ?? remoteSession)!.name

    const inspectionEnabled =
      remoteSession && localSession
        ? recordTime(remoteSession) > recordTime(localSession)
          ? remoteSession.inspectionEnabled
          : localSession.inspectionEnabled
        : (localSession ?? remoteSession)!.inspectionEnabled

    // Build solve list for this session.
    const localSolveMap = new Map(
      (localSession?.solves ?? [])
        .filter((solve) => !deletedSolveIds.has(solve.id))
        .map((solve) => [solve.id, normalizeSolve(solve, Date.now())]),
    )
    const remoteSolveMap = new Map(
      (remoteSession?.solves ?? [])
        .filter((solve) => !deletedSolveIds.has(solve.id))
        .map((solve) => [solve.id, normalizeSolve(solve, Date.now())]),
    )
    const solveIds = new Set([...localSolveMap.keys(), ...remoteSolveMap.keys()])
    const sessionSolves: Solve[] = []

    for (const solveId of solveIds) {
      if (solveToSession.get(solveId) !== sessionId) continue
      const localSolve = localSolveMap.get(solveId)
      const remoteSolve = remoteSolveMap.get(solveId)
      if (!localSolve && !remoteSolve) continue

      if (!localSolve) {
        sessionSolves.push(remoteSolve!)
        addedSolves += 1
        continue
      }
      if (!remoteSolve) {
        sessionSolves.push(localSolve)
        continue
      }

      if (solvesEqual(localSolve, remoteSolve)) {
        sessionSolves.push(localSolve)
        continue
      }

      updatedSolves += 1
      sessionSolves.push(
        mergeSolveFields(localSolve, remoteSolve, manualConflictReview, conflicts),
      )
    }

    const mergedSession: Session = {
      id: sessionId,
      name,
      createdAt,
      updatedAt,
      solves: sessionSolves.sort((a, b) => b.createdAt - a.createdAt),
      ...(typeof inspectionEnabled === 'boolean' ? { inspectionEnabled } : {}),
    }
    mergedSessions.push(mergedSession)
  }

  // Count removed solves from tombstones.
  for (const tombstone of tombstones) {
    if (tombstone.kind === 'solve') removedSolves += 1
  }

  const duplicates = new Map<string, Set<string>>()
  for (const session of mergedSessions) {
    const normalized = normalizeSessionName(session.name).toLowerCase()
    if (!duplicates.has(normalized)) duplicates.set(normalized, new Set())
    duplicates.get(normalized)?.add(session.id)
  }
  const duplicateSessionNames = [...duplicates.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([name]) => name)

  const result: SyncMergeResult = {
    adoptedLocalDefault: false,
    duplicateSessionNames,
    sessionRedirects: normalizeSessionRedirects(input.sessionRedirects ?? []),
    merged: {
      activeSessionId:
        mergedSessions.some((session) => session.id === local.activeSessionId)
          ? local.activeSessionId
          : mergedSessions.some((session) => session.id === remote?.activeSessionId)
            ? remote!.activeSessionId
            : mergedSessions[0]?.id ?? local.activeSessionId,
      sessions: mergedSessions,
    },
    addedSolves,
    updatedSolves,
    removedSolves,
    addedSessions,
    remoteWins: conflicts.filter((conflict) => conflict.resolution === 'remote').length,
    conflicts,
    mergedTombstones: [...tombstones],
  }

  return result
}

export function mergeSettings(
  local: Settings,
  remote: Settings | null,
  remoteUpdatedAt: number,
  lastSyncAt: number | null,
): Settings {
  if (!remote) return local
  // Remote settings are applied only when they represent a newer remote revision;
  // otherwise local settings are preserved and will be pushed outward.
  if (lastSyncAt !== null && remoteUpdatedAt > lastSyncAt) return { ...remote }
  return { ...local }
}

export function createSyncEnvelope(
  deviceId: string,
  revision: number,
  tombstones: Tombstone[],
  conflicts: SyncConflict[],
  sessionRedirects: SessionRedirect[] = [],
): SyncEnvelope {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    revision,
    deviceId,
    updatedAt: Date.now(),
    tombstones: [...tombstones],
    conflicts: [...conflicts],
    sessionRedirects: normalizeSessionRedirects(sessionRedirects),
  }
}

export function parseRemoteSyncEnvelope(value: unknown): SyncEnvelope | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (record.protocolVersion !== SYNC_PROTOCOL_VERSION) return null
  if (typeof record.revision !== 'number' || !Number.isFinite(record.revision)) return null
  if (typeof record.deviceId !== 'string' || record.deviceId.length === 0) return null
  if (typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)) return null
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    revision: record.revision,
    deviceId: record.deviceId,
    updatedAt: record.updatedAt,
    tombstones: Array.isArray(record.tombstones) ? (record.tombstones as Tombstone[]) : [],
    conflicts: Array.isArray(record.conflicts) ? (record.conflicts as SyncConflict[]) : [],
    sessionRedirects: Array.isArray(record.sessionRedirects)
      ? normalizeSessionRedirects(record.sessionRedirects as SessionRedirect[])
      : [],
  }
}

export function createTombstone(
  kind: 'solve' | 'session',
  id: string,
  sessionId: string | undefined,
  deviceId: string,
  revision?: number,
): Tombstone {
  return {
    kind,
    id,
    sessionId,
    deletedAt: Date.now(),
    deletedByDeviceId: deviceId,
    revision,
  }
}
