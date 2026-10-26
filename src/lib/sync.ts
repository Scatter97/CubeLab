import type { Session, SessionsData, Solve } from '../types'
import { DEFAULT_SESSION_NAME, MAX_SESSION_NAME_LENGTH, normalizeSessionName } from './sessions'
import { applySessionRedirects, findSessionRedirectDivergences, normalizeSessionRedirects } from './sessionRedirects'
import { maxSessionFieldUpdateTime, mergeSessionMetadata } from './sessionMetadata'
import {
  isActiveTombstone,
  isConflict,
  isFieldUpdate,
  isSessionRedirect,
  isTombstone,
  parseSettingsFieldUpdates,
} from './syncStorage'
import { mergeSolveFields, recordTime, solvesEqual } from './solveMerge'
import type {
  SettingsFieldUpdates,
  SyncConflict,
  Tombstone,
  SessionRedirect,
} from './syncStorage'



export const SYNC_PROTOCOL_VERSION = 1

export interface SyncEnvelope {
  protocolVersion: typeof SYNC_PROTOCOL_VERSION
  revision: number
  deviceId: string
  updatedAt: number
  tombstones: Tombstone[]
  conflicts: SyncConflict[]
  sessionRedirects: SessionRedirect[]
  /** Field metadata for the settings snapshot carried by this envelope. */
  settingsFieldUpdates?: SettingsFieldUpdates
}

export function mergeTombstones(...groups: ReadonlyArray<ReadonlyArray<Tombstone>>): Tombstone[] {
  const merged = new Map<string, Tombstone>()
  for (const tombstone of groups.flat()) {
    const key = `${tombstone.kind}:${tombstone.id}`
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, {
        ...tombstone,
        ...(tombstone.knownSolveIds
          ? { knownSolveIds: [...new Set(tombstone.knownSolveIds)] }
          : {}),
      })
      continue
    }

    // A tombstone has two possible latest events: the deletion and an optional
    // restoration. The later event wins. Equal event times are resolved
    // deterministically in favour of an active deletion, so a restoration can
    // never resurrect deliberately deleted data through a clock tie.
    const existingEvent = Math.max(existing.deletedAt, existing.restoredAt ?? 0)
    const candidateEvent = Math.max(tombstone.deletedAt, tombstone.restoredAt ?? 0)
    let winner: Tombstone
    if (candidateEvent > existingEvent) {
      winner = tombstone
    } else if (candidateEvent < existingEvent) {
      winner = existing
    } else if (isActiveTombstone(tombstone) !== isActiveTombstone(existing)) {
      winner = isActiveTombstone(tombstone) ? tombstone : existing
    } else if (tombstone.deletedByDeviceId !== existing.deletedByDeviceId) {
      winner = tombstone.deletedByDeviceId < existing.deletedByDeviceId ? tombstone : existing
    } else {
      winner = tombstone.id <= existing.id ? tombstone : existing
    }

    const knownSolveIds = [
      ...new Set([
        ...(existing.knownSolveIds ?? []),
        ...(tombstone.knownSolveIds ?? []),
      ]),
    ]
    const revision = Math.max(existing.revision ?? 0, tombstone.revision ?? 0)
    merged.set(key, {
      ...winner,
      ...(knownSolveIds.length > 0 ? { knownSolveIds } : {}),
      ...(revision > 0 ? { revision } : {}),
    })
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id) ||
      left.deletedAt - right.deletedAt,
  )
}


export function resolveRedirectConflicts(input: {
  local: ReadonlyArray<SessionRedirect>
  remote: ReadonlyArray<SessionRedirect>
  manualConflictReview: boolean
  resolvedConflicts: readonly SyncConflict[]
}): { sessionRedirects: SessionRedirect[]; conflicts: SyncConflict[] } {
  const { local, remote, manualConflictReview, resolvedConflicts } = input
  const combined = [...local, ...remote]
  const conflicts: SyncConflict[] = []
  const divergences = findSessionRedirectDivergences(local, remote)
  for (const divergence of divergences) {
    const localValue = divergence.local!.toId
    const remoteValue = divergence.remote!.toId
    const localUpdatedAt = divergence.local!.approvedAt
    const remoteUpdatedAt = divergence.remote!.approvedAt
    // Redirect approvals are rewritten whenever sync materializes a winner, so
    // their timestamps are not stable review identities. The exact pair of
    // destinations is: a later approval of a different destination changes the
    // pair and raises a fresh conflict. Re-approving the same pair keeps the
    // existing decision instead of prompting on every merge.
    const resolved = resolvedConflicts
      .filter(
        (conflict) =>
          conflict.kind === 'redirect' &&
          conflict.id === divergence.fromId &&
          conflict.field === 'redirect' &&
          conflict.resolution !== 'manual-pending' &&
          Object.is(conflict.localValue, localValue) &&
          Object.is(conflict.remoteValue, remoteValue),
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]

    let winner: 'local' | 'remote'
    if (resolved) {
      winner = resolved.resolution === 'remote' ? 'remote' : 'local'
    } else if (localUpdatedAt !== remoteUpdatedAt) {
      winner = localUpdatedAt > remoteUpdatedAt ? 'local' : 'remote'
    } else if ((divergence.local!.byDeviceId ?? '') !== (divergence.remote!.byDeviceId ?? '')) {
      winner =
        (divergence.local!.byDeviceId ?? '') < (divergence.remote!.byDeviceId ?? '')
          ? 'local'
          : 'remote'
    } else {
      winner = localValue <= remoteValue ? 'local' : 'remote'
    }

    if (!resolved) {
      conflicts.push({
        id: divergence.fromId,
        kind: 'redirect',
        sessionId: divergence.fromId,
        field: 'redirect',
        localValue,
        remoteValue,
        localUpdatedAt,
        remoteUpdatedAt,
        resolution: manualConflictReview ? 'manual-pending' : winner,
        updatedAt: Math.max(localUpdatedAt, remoteUpdatedAt, Date.now()),
      })
    }

    const chosen = winner === 'local' ? localValue : remoteValue
    // Only materialize a tiebreak redirect when the normalizer would otherwise
    // publish the losing destination (for example equal approval timestamps
    // ordered by destination ID). Repeated syncs must not invent a new
    // timestamp every run.
    const normalizedTarget = normalizeSessionRedirects(combined).find(
      (redirect) => redirect.fromId === divergence.fromId,
    )?.toId
    if (normalizedTarget !== chosen) {
      combined.push({
        fromId: divergence.fromId,
        toId: chosen,
        approvedAt:
          Math.max(
            resolved?.updatedAt ?? 0,
            localUpdatedAt,
            remoteUpdatedAt,
            Date.now(),
          ) + 1,
        byDeviceId: resolved ? 'manual-approval' : 'sync-tiebreak',
      })
    }
  }
  return {
    sessionRedirects: normalizeSessionRedirects(combined),
    conflicts,
  }
}

function hasPreferences(session: Session): boolean {
  return Boolean(session.preferences && Object.keys(session.preferences).length > 0)
}

/**
 * Finds visible session-name collisions in the final collection. Callers must
 * run this after every snapshot has been folded in; a per-snapshot warning can
 * be lost when a later snapshot contains no collision of its own.
 */
export function findDuplicateSessionNames(
  sessions: ReadonlyArray<Session>,
): string[] {
  const idsByName = new Map<string, Set<string>>()
  const displayName = new Map<string, string>()
  for (const session of sessions) {
    const normalized = normalizeSessionName(session.name)
    const key = normalized.toLowerCase()
    const ids = idsByName.get(key) ?? new Set<string>()
    ids.add(session.id)
    idsByName.set(key, ids)
    if (!displayName.has(key)) displayName.set(key, normalized)
  }
  return [...idsByName.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([key]) => displayName.get(key) ?? key)
    .sort((left, right) => left.localeCompare(right))
}

function isUntouchedDefaultSession(session: Session): boolean {
  // Older generated placeholders did not persist `isAutoCreatedDefault`.
  // Treat the missing marker as generated only when every other signal agrees;
  // an explicit `false` always means the session was deliberately created.
  if (session.isAutoCreatedDefault === false) return false

  return (
    normalizeSessionName(session.name) === DEFAULT_SESSION_NAME &&
    (session.event === undefined || session.event === '333') &&
    session.solves.length === 0 &&
    session.inspectionEnabled === undefined &&
    !hasPreferences(session) &&
    session.createdAt === session.updatedAt
  )
}

function hasUserSessionContent(session: Session): boolean {
  return (
    normalizeSessionName(session.name) !== DEFAULT_SESSION_NAME ||
    (session.event !== undefined && session.event !== '333') ||
    session.inspectionEnabled !== undefined ||
    hasPreferences(session)
  )
}

function recoveredSessionName(baseName: string, usedNames: Set<string>): string {
  const suffix = ' (recovered)'
  let root = normalizeSessionName(baseName) || 'Session'
  if (root.length + suffix.length > MAX_SESSION_NAME_LENGTH) {
    root = root.slice(0, MAX_SESSION_NAME_LENGTH - suffix.length).trim()
  }
  let candidate = `${root}${suffix}`
  let counter = 2
  while (usedNames.has(candidate.toLowerCase())) {
    const numbered = ` ${counter}`
    const maxRoot = MAX_SESSION_NAME_LENGTH - suffix.length - numbered.length
    candidate = `${root.slice(0, maxRoot).trim()}${suffix}${numbered}`
    counter += 1
  }
  usedNames.add(candidate.toLowerCase())
  return candidate
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
  recoveredSolves: number
}

export function mergeSessionsData(input: {
  local: SessionsData
  remote: SessionsData | null
  tombstones: Tombstone[]
  sessionRedirects?: SessionRedirect[]
  deviceId: string
  manualConflictReview: boolean
  resolvedConflicts?: SyncConflict[]
}): SyncMergeResult {
  const redirects = input.sessionRedirects ?? []
  const local = redirects.length > 0 ? applySessionRedirects(input.local, redirects) : input.local
  const remote = input.remote && redirects.length > 0 ? applySessionRedirects(input.remote, redirects) : input.remote
  // Local and remote envelopes routinely carry the same tombstones. Collapse
  // them before deriving deletion sets or reporting removal counts.
  const tombstones = mergeTombstones(input.tombstones ?? [])
  // Restored tombstones are retained for propagation but no longer remove data.
  const activeTombstones = tombstones.filter(isActiveTombstone)
  const { manualConflictReview } = input
  const resolvedConflicts = input.resolvedConflicts ?? []
  const conflicts: SyncConflict[] = []

  const localSession = local.sessions[0]
  const isFreshLocalDefault = local.sessions.length === 1 && localSession && isUntouchedDefaultSession(localSession)

  const deletedSolveIds = new Set(activeTombstones.filter((t) => t.kind === 'solve').map((t) => t.id))
  const deletedSessionIds = new Set(activeTombstones.filter((t) => t.kind === 'session').map((t) => t.id))

  const hasRelevantCloudContent = !!remote && remote.sessions.some((session) => {
    if (deletedSessionIds.has(session.id)) return false
    // A live solve or any customized session metadata represents real cloud
    // content. A bare default-named session whose only solves are tombstoned
    // does not justify replacing the local placeholder.
    return (
      session.solves.some((solve) => !deletedSolveIds.has(solve.id)) ||
      hasUserSessionContent(session)
    )
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
      duplicateSessionNames: findDuplicateSessionNames(adoptedSessions),
      sessionRedirects: normalizeSessionRedirects(input.sessionRedirects ?? []),
      addedSolves: adoptedSessions.reduce((total, session) => total + session.solves.length, 0),
      updatedSolves: 0,
      removedSolves: 0,
      addedSessions: adoptedSessions.length,
      remoteWins: 0,
      conflicts: [],
      mergedTombstones: tombstones,
      recoveredSolves: 0,
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
  // A session tombstone deliberately removes its session, but solves created on
  // an offline device after that deletion must not vanish silently. Keep those
  // candidates aside and move them into a clearly labelled recovered session.
  const deletedSessionSnapshots = new Map<string, Session>()
  const orphanSolvesBySession = new Map<string, Map<string, Solve>>()
  for (const [side, data] of [['local', local], ['remote', remote]] as const) {
    if (!data) continue
    for (const session of data.sessions) {
      if (deletedSessionIds.has(session.id)) {
        if (!deletedSessionSnapshots.has(session.id)) deletedSessionSnapshots.set(session.id, session)
        const orphans = orphanSolvesBySession.get(session.id) ?? new Map<string, Solve>()
        for (const solve of session.solves) {
          if (deletedSolveIds.has(solve.id)) continue
          const existing = orphans.get(solve.id)
          orphans.set(solve.id, existing ? mergeSolveFields(existing, solve, false, []) : solve)
        }
        orphanSolvesBySession.set(session.id, orphans)
        continue
      }
      for (const solve of session.solves) {
        if (deletedSolveIds.has(solve.id)) continue
        if (solve.event !== (session.event ?? '333')) {
          throw new Error(`Solve ${solve.id} does not match its session event; sync stopped to preserve data.`)
        }
        const pair = solveById.get(solve.id) ?? {}
        const existing = pair[side]
        pair[side] = existing
          ? mergeSolveFields(existing, solve, manualConflictReview, conflicts, resolvedConflicts)
          : solve
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
      // The chosen owner must be compatible with the solve's puzzle event.
      // A newer edit timestamp does not authorize moving a 3x3 solve into a
      // 4x4 session. Prefer the compatible owner; reject only if neither fits.
      const solveEvent = l.event
      const localOwnerEvent = localSessions.get(localOwner)?.event ?? '333'
      const remoteOwnerEvent = remoteSessions.get(remoteOwner)?.event ?? '333'
      const localCompatible = localOwnerEvent === solveEvent
      const remoteCompatible = remoteOwnerEvent === solveEvent
      if (!localCompatible && !remoteCompatible) {
        throw new Error(`Solve ${solveId} has no compatible session owner; sync stopped to protect data.`)
      }
      winner = localCompatible && !remoteCompatible
        ? localOwner
        : remoteCompatible && !localCompatible
          ? remoteOwner
          : recordTime(r) > recordTime(l) ? remoteOwner : localOwner
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

    const metadata =
      localSession && remoteSession
        ? mergeSessionMetadata({
            local: localSession,
            remote: remoteSession,
            manualConflictReview,
            conflicts,
            resolvedConflicts,
          })
        : (() => {
            const source = (localSession ?? remoteSession)!
            return {
              name: normalizeSessionName(source.name),
              event: source.event,
              inspectionEnabled: source.inspectionEnabled,
              preferences: source.preferences,
              fieldUpdates: source.fieldUpdates,
            }
          })()
    // Event edits merge by field timestamp like other metadata. A chosen event
    // that cannot own every solve in the session still stops synchronization
    // below rather than mixing puzzle statistics.
    const event = metadata.event ?? '333'
    const updatedAt = Math.max(
      localSession?.updatedAt ?? 0,
      remoteSession?.updatedAt ?? 0,
      maxSessionFieldUpdateTime({ fieldUpdates: metadata.fieldUpdates }),
      0,
    )

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
        sessionSolves.push(mergeSolveFields(localSolve, remoteSolve, false, [], resolvedConflicts))
      } else {
        updatedSolves += 1
        sessionSolves.push(mergeSolveFields(localSolve, remoteSolve, manualConflictReview, conflicts, resolvedConflicts))
      }
    }

    if (sessionSolves.some((solve) => solve.event !== event)) {
      throw new Error(`Merging solves into session ${sessionId} would mix puzzle events.`)
    }
    const mergedSession: Session = {
      id: sessionId,
      name: metadata.name,
      event,
      createdAt,
      updatedAt,
      solves: sessionSolves.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)),
      ...(typeof metadata.inspectionEnabled === 'boolean'
        ? { inspectionEnabled: metadata.inspectionEnabled }
        : {}),
      ...(metadata.preferences && Object.keys(metadata.preferences).length
        ? { preferences: metadata.preferences }
        : {}),
      ...(metadata.fieldUpdates ? { fieldUpdates: metadata.fieldUpdates } : {}),
    }
    mergedSessions.push(mergedSession)
  }

  // Restore offline edits associated with a deleted session. Tombstones created
  // by current builds carry a known-solve snapshot, which distinguishes solves
  // the deleting device already had (intentionally deleted) from unknown solves
  // that arrived from another device (preserve). Legacy tombstones fall back to
  // wall-clock comparison. Existing recovered sessions are extended in place so
  // successive offline devices cannot lose later arrivals.
  const sessionTombstonesById = new Map<string, Tombstone[]>()
  for (const tombstone of activeTombstones) {
    if (tombstone.kind !== 'session') continue
    const list = sessionTombstonesById.get(tombstone.id) ?? []
    list.push(tombstone)
    sessionTombstonesById.set(tombstone.id, list)
  }
  const usedSessionNames = new Set(
    mergedSessions.map((session) => normalizeSessionName(session.name).toLowerCase()),
  )
  const recoveredSolveIds = new Set<string>()
  let recoveredSolves = 0
  for (const [deletedSessionId, orphans] of orphanSolvesBySession) {
    const snapshot = deletedSessionSnapshots.get(deletedSessionId)
    if (!snapshot) continue
    const deletionTombstones = sessionTombstonesById.get(deletedSessionId) ?? []
    const deletedAt = Math.max(0, ...deletionTombstones.map((tombstone) => tombstone.deletedAt))
    const knownSolveIdsAvailable = deletionTombstones.some(
      (tombstone) => Array.isArray(tombstone.knownSolveIds),
    )
    const knownSolveIds = new Set(
      deletionTombstones.flatMap((tombstone) =>
        Array.isArray(tombstone.knownSolveIds)
          ? tombstone.knownSolveIds.filter(
              (id): id is string => typeof id === 'string' && id.length > 0,
            )
          : [],
      ),
    )
    const candidates = [...orphans.values()].filter((solve) => {
      if (solveById.has(solve.id) || deletedSolveIds.has(solve.id)) return false
      if (knownSolveIdsAvailable) return !knownSolveIds.has(solve.id)
      return solve.createdAt > deletedAt || (solve.updatedAt ?? 0) > deletedAt
    })
    if (candidates.length === 0) continue

    const recoveredId = `recovered:${deletedSessionId}`
    // A tombstone for the recovered session itself is an explicit later
    // deletion. Do not resurrect it through another recovery pass.
    if (deletedSessionIds.has(recoveredId)) continue
    const existingRecovered = mergedSessions.find((session) => session.id === recoveredId)
    if (existingRecovered) {
      if (candidates.some((solve) => solve.event !== existingRecovered.event)) {
        throw new Error(
          `Offline edits in deleted session ${deletedSessionId} mix puzzle events; sync stopped to preserve data.`,
        )
      }
      const solvesById = new Map(existingRecovered.solves.map((solve) => [solve.id, solve]))
      let added = 0
      for (const candidate of candidates) {
        if (solvesById.has(candidate.id)) continue
        solvesById.set(candidate.id, candidate)
        recoveredSolveIds.add(candidate.id)
        added += 1
      }
      if (added === 0) continue
      const updatedRecovered: Session = {
        ...existingRecovered,
        updatedAt: Math.max(
          existingRecovered.updatedAt,
          snapshot.updatedAt,
          ...candidates.map((solve) => recordTime(solve)),
        ),
        solves: [...solvesById.values()].sort(
          (left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id),
        ),
      }
      // Preserve preferences already attached to the recovered session. Only
      // fill missing metadata from the deleted session snapshot.
      if (
        updatedRecovered.inspectionEnabled === undefined &&
        typeof snapshot.inspectionEnabled === 'boolean'
      ) {
        updatedRecovered.inspectionEnabled = snapshot.inspectionEnabled
      }
      if (
        (updatedRecovered.preferences === undefined ||
          Object.keys(updatedRecovered.preferences).length === 0) &&
        snapshot.preferences &&
        Object.keys(snapshot.preferences).length > 0
      ) {
        updatedRecovered.preferences = { ...snapshot.preferences }
      }
      const recoveredIndex = mergedSessions.findIndex(
        (session) => session.id === recoveredId,
      )
      mergedSessions[recoveredIndex] = updatedRecovered
      recoveredSolves += added
      continue
    }

    const event = snapshot.event ?? candidates[0]!.event ?? '333'
    if (candidates.some((solve) => solve.event !== event)) {
      throw new Error(
        `Offline edits in deleted session ${deletedSessionId} mix puzzle events; sync stopped to preserve data.`,
      )
    }

    const recovered: Session = {
      id: recoveredId,
      name: recoveredSessionName(snapshot.name, usedSessionNames),
      event,
      createdAt: snapshot.createdAt,
      updatedAt: Math.max(snapshot.updatedAt, ...candidates.map((solve) => recordTime(solve))),
      solves: [...candidates].sort(
        (left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id),
      ),
      ...(typeof snapshot.inspectionEnabled === 'boolean'
        ? { inspectionEnabled: snapshot.inspectionEnabled }
        : {}),
      ...(snapshot.preferences && Object.keys(snapshot.preferences).length > 0
        ? { preferences: { ...snapshot.preferences } }
        : {}),
    }
    mergedSessions.push(recovered)
    for (const candidate of candidates) recoveredSolveIds.add(candidate.id)
    recoveredSolves += candidates.length
  }

  // Count unique solves removed by tombstones. A session tombstone accounts for
  // every solve that either side still held for that session; explicit solve
  // tombstones are then added once, even when both envelopes carried them.
  const tombstonedSolveIds = new Set<string>()
  for (const tombstone of activeTombstones) {
    if (tombstone.kind === 'solve') {
      tombstonedSolveIds.add(tombstone.id)
      continue
    }
    for (const session of [localSessions.get(tombstone.id), remoteSessions.get(tombstone.id)]) {
      for (const solve of session?.solves ?? []) tombstonedSolveIds.add(solve.id)
    }
  }
  // Solves recovered from a deleted session were not removed; counting them as
  // removals overstates deletion in status and tests.
  removedSolves = [...tombstonedSolveIds].filter(
    (id) => !recoveredSolveIds.has(id),
  ).length

  // Attach the owning session so conflict review can name it. solveMerge does
  // not know the final owner while it is still resolving field values.
  for (const conflict of conflicts) {
    if (conflict.kind === 'solve' && conflict.sessionId === undefined) {
      const owner = solveToSession.get(conflict.id)
      if (owner) conflict.sessionId = owner
    }
  }

  const duplicateSessionNames = findDuplicateSessionNames(mergedSessions)

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
    recoveredSolves,
  }

  return result
}

export function createSyncEnvelope(
  deviceId: string,
  revision: number,
  tombstones: Tombstone[],
  conflicts: SyncConflict[],
  sessionRedirects: SessionRedirect[] = [],
  settingsFieldUpdates: SettingsFieldUpdates = {},
): SyncEnvelope {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    revision,
    deviceId,
    updatedAt: Date.now(),
    tombstones: mergeTombstones(tombstones),
    conflicts: [...conflicts],
    sessionRedirects: normalizeSessionRedirects(sessionRedirects),
    ...(Object.keys(settingsFieldUpdates).length > 0
      ? { settingsFieldUpdates: { ...settingsFieldUpdates } }
      : {}),
  }
}

export function parseRemoteSyncEnvelope(value: unknown): SyncEnvelope | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.protocolVersion !== SYNC_PROTOCOL_VERSION) return null
  if (typeof record.revision !== 'number' || !Number.isFinite(record.revision)) return null
  if (typeof record.deviceId !== 'string' || record.deviceId.length === 0) return null
  if (typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)) return null

  const tombstones = record.tombstones ?? []
  if (!Array.isArray(tombstones) || !tombstones.every(isTombstone)) return null

  const conflicts = record.conflicts ?? []
  if (!Array.isArray(conflicts) || !conflicts.every(isConflict)) return null

  const redirects = record.sessionRedirects ?? []
  if (!Array.isArray(redirects) || !redirects.every(isSessionRedirect)) return null

  if (record.settingsFieldUpdates !== undefined) {
    if (
      typeof record.settingsFieldUpdates !== 'object' ||
      record.settingsFieldUpdates === null ||
      Array.isArray(record.settingsFieldUpdates) ||
      !Object.values(record.settingsFieldUpdates).every(isFieldUpdate)
    ) {
      return null
    }
  }

  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    revision: record.revision,
    deviceId: record.deviceId,
    updatedAt: record.updatedAt,
    tombstones,
    conflicts,
    sessionRedirects: normalizeSessionRedirects(redirects),
    settingsFieldUpdates: parseSettingsFieldUpdates(record.settingsFieldUpdates),
  }
}

export function createTombstone(
  kind: 'solve' | 'session',
  id: string,
  sessionId: string | undefined,
  deviceId: string,
  revision?: number,
  knownSolveIds?: readonly string[],
): Tombstone {
  return {
    kind,
    id,
    sessionId,
    deletedAt: Date.now(),
    deletedByDeviceId: deviceId,
    revision,
    ...(knownSolveIds
      ? { knownSolveIds: [...new Set(knownSolveIds)] }
      : {}),
  }
}
