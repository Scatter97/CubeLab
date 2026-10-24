import type { Session, SessionsData, Settings, Solve } from '../types'
import type { SyncConflict, Tombstone } from './syncStorage'


export const SYNC_PROTOCOL_VERSION = 1

export interface SyncEnvelope {
  protocolVersion: typeof SYNC_PROTOCOL_VERSION
  revision: number
  deviceId: string
  updatedAt: number
  tombstones: Tombstone[]
  conflicts: SyncConflict[]
}

export interface SyncMergeResult {
  merged: SessionsData
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

function mergeSolveFields(
  local: Solve,
  remote: Solve,
  manualConflictReview: boolean,
  conflicts: SyncConflict[],
): Solve {
  const localTime = recordTime(local)
  const remoteTime = recordTime(remote)
  const fieldValues: Pick<Solve, 'rawMs' | 'penalty' | 'scramble' | 'comment'> = {
    rawMs: local.rawMs,
    penalty: local.penalty,
    scramble: local.scramble,
    comment: local.comment,
  }

  const conflicted: string[] = []
  if (local.rawMs !== remote.rawMs) {
    conflicted.push('rawMs')
    fieldValues.rawMs = remoteTime > localTime ? remote.rawMs : local.rawMs
  }
  if (local.penalty !== remote.penalty) {
    conflicted.push('penalty')
    fieldValues.penalty =
      remoteTime > localTime ? remote.penalty : local.penalty
  }
  if (local.scramble !== remote.scramble) {
    conflicted.push('scramble')
    fieldValues.scramble =
      remoteTime > localTime ? remote.scramble : local.scramble
  }
  if (local.comment !== remote.comment) {
    conflicted.push('comment')
    fieldValues.comment =
      remoteTime > localTime ? remote.comment : local.comment
  }

  // Field-level preservation for non-conflicting edits. When both records
  // changed different fields, keep each field from the side that can be safely
  // attributed to that change. This prevents a newer remote record from
  // overwriting a local penalty edit or vice versa.
  if (local.penalty !== remote.penalty && local.comment !== remote.comment) {
    fieldValues.penalty = local.penalty
    fieldValues.comment = remote.comment
  }

  if (conflicted.length > 0) {
    for (const field of conflicted) {
      const conflict: SyncConflict = {
        id: local.id,
        kind: 'solve',
        sessionId: undefined,
        field,
        localValue:
          field === 'rawMs'
            ? local.rawMs
            : field === 'penalty'
              ? local.penalty
              : field === 'scramble'
                ? local.scramble
                : local.comment,
        remoteValue:
          field === 'rawMs'
            ? remote.rawMs
            : field === 'penalty'
              ? remote.penalty
              : field === 'scramble'
                ? remote.scramble
                : remote.comment,
        localUpdatedAt: localTime,
        remoteUpdatedAt: remoteTime,
        resolution:
          manualConflictReview && (field === 'comment' || field === 'penalty')
            ? 'manual-pending'
            : remoteTime > localTime
              ? 'remote'
              : 'local',
        updatedAt: Math.max(localTime, remoteTime, Date.now()),
      }
      conflicts.push(conflict)
    }
  }

  return {
    id: local.id,
    event: local.event === '333' ? local.event : remote.event,
    rawMs: fieldValues.rawMs,
    penalty: fieldValues.penalty,
    scramble: fieldValues.scramble,
    comment: fieldValues.comment,
    createdAt: Math.min(local.createdAt, remote.createdAt),
    updatedAt: Math.max(localTime, remoteTime),
  }
}

export function mergeSessionsData(input: {
  local: SessionsData
  remote: SessionsData | null
  tombstones: Tombstone[]
  deviceId: string
  manualConflictReview: boolean
}): SyncMergeResult {
  const { local, remote, tombstones, manualConflictReview } = input
  const conflicts: SyncConflict[] = []

  const deletedSolveIds = new Set(
    tombstones.filter((t) => t.kind === 'solve').map((t) => t.id),
  )
  const deletedSessionIds = new Set(
    tombstones.filter((t) => t.kind === 'session').map((t) => t.id),
  )

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

  const result: SyncMergeResult = {
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
): SyncEnvelope {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    revision,
    deviceId,
    updatedAt: Date.now(),
    tombstones: [...tombstones],
    conflicts: [...conflicts],
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
