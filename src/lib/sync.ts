import type { Session, SessionsData, Settings, Solve } from '../types'
import { DEFAULT_SESSION_NAME, normalizeSessionName } from './sessions'
import { DEFAULT_SETTINGS } from './storage'
import { applySessionRedirects, normalizeSessionRedirects } from './sessionRedirects'
import { mergeSolveFields, recordTime, solvesEqual } from './solveMerge'
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
    session.isAutoCreatedDefault === true &&
    normalizeSessionName(session.name) === DEFAULT_SESSION_NAME &&
    session.solves.length === 0 &&
    session.inspectionEnabled === undefined &&
    !session.preferences &&
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

  const hasRelevantCloudContent = !!remote && remote.sessions.some(
    (session) => !deletedSessionIds.has(session.id),
  )

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

  // Merge every solve ID globally BEFORE deciding its owning session. A solve
  // can move across session identities while independent field edits are made.
  const solveToSession = new Map<string, string>()
  const solveById = new Map<string, { local?: Solve; remote?: Solve }>()
  const ownership = new Map<string, {local?: string;remote?: string}>()
  for (const [side, data] of [['local', local], ['remote', remote]] as const) {
    if (!data) continue
    for (const session of data.sessions) {
      if (deletedSessionIds.has(session.id)) continue
      for (const solve of session.solves) {
        if (deletedSolveIds.has(solve.id)) continue
        if (solve.event !== (session.event ?? '333')) {
          throw new Error(`Solve ${solve.id} does not match its session event; sync stopped to preserve data.`)
        }
        const pair = solveById.get(solve.id) ?? {}
        const existing = pair[side]
        pair[side] = existing ? mergeSolveFields(existing, solve, manualConflictReview, conflicts) : solve
        solveById.set(solve.id, pair)
        const owners = ownership.get(solve.id) ?? {}
        owners[side] = session.id
        ownership.set(solve.id, owners)
      }
    }
  }
  for (const [solveId, pair] of solveById) {
    const owners = ownership.get(solveId)!
    if (pair.local && pair.remote && pair.local.event !== pair.remote.event) {
      throw new Error(`Conflicting puzzle events for solve ${solveId}; sync stopped.`)
    }
    const localOwner = owners.local
    const remoteOwner = owners.remote
    let winner = localOwner ?? remoteOwner!
    if (localOwner && remoteOwner && localOwner !== remoteOwner) {
      const l = pair.local!
      const r = pair.remote!
      winner = recordTime(r) > recordTime(l) ? remoteOwner : localOwner
      conflicts.push({
        id: solveId, kind: 'solve', sessionId: winner, field: 'sessionId',
        localValue: localOwner, remoteValue: remoteOwner,
        localUpdatedAt: recordTime(l), remoteUpdatedAt: recordTime(r),
        resolution: winner === remoteOwner ? 'remote' : 'local', updatedAt: Date.now(),
      })
    }
    solveToSession.set(solveId, winner)
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

    const sessionSolves: Solve[] = []
    for (const [solveId, pair] of solveById) {
      if (solveToSession.get(solveId) !== sessionId) continue
      const localSolve = pair.local
      const remoteSolve = pair.remote
      if (!localSolve && !remoteSolve) continue
      if (!localSolve) {
        sessionSolves.push(remoteSolve!)
        addedSolves += 1
      } else if (!remoteSolve) {
        sessionSolves.push(localSolve)
      } else if (solvesEqual(localSolve, remoteSolve)) {
        sessionSolves.push(mergeSolveFields(localSolve, remoteSolve, false, []))
      } else {
        updatedSolves += 1
        sessionSolves.push(mergeSolveFields(localSolve, remoteSolve, manualConflictReview, conflicts))
      }
    }

    if (localSession?.event && remoteSession?.event && localSession.event !== remoteSession.event) {
      throw new Error(`Session ${sessionId} has incompatible puzzle events. Sync stopped to preserve solves.`)
    }
    const chosenPreferences =
      localSession && remoteSession
        ? (recordTime(remoteSession) > recordTime(localSession)
            ? { ...localSession.preferences, ...remoteSession.preferences }
            : { ...remoteSession.preferences, ...localSession.preferences })
        : (localSession ?? remoteSession)?.preferences
    if (sessionSolves.some((solve) => solve.event !== ((localSession ?? remoteSession)?.event ?? '333'))) {
      throw new Error(`Merging solves into session ${sessionId} would mix puzzle events.`)
    }
    const mergedSession: Session = {
      id: sessionId,
      name,
      event: (localSession ?? remoteSession)?.event ?? '333',
      createdAt,
      updatedAt,
      solves: sessionSolves.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)),
      ...(typeof inspectionEnabled === 'boolean' ? { inspectionEnabled } : {}),
      ...(chosenPreferences && Object.keys(chosenPreferences).length ? { preferences: chosenPreferences } : {}),
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
  if (lastSyncAt === null) {
    // Adopt the cloud on first sync only when the local settings are defaults.
    // An already configured local device retains its edits.
    return JSON.stringify(local) === JSON.stringify(DEFAULT_SETTINGS) ? { ...remote } : { ...local }
  }
  if (remoteUpdatedAt > lastSyncAt) return { ...remote }
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
