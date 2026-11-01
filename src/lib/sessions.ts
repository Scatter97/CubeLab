import type {
  Penalty,
  PuzzleEvent,
  Session,
  SessionFieldUpdates,
  SessionPreferenceKey,
  SessionPreferences,
  SessionsData,
  Solve,
} from '../types'
import { createId } from './id'
import { mergeSolveFields } from './solveMerge'
import { SESSION_PREFERENCE_KEYS } from './sessionPreferenceKeys'

export const MAX_SESSION_NAME_LENGTH = 40
export const MAX_SOLVE_COMMENT_LENGTH = 500
export const DEFAULT_SESSION_NAME = 'Session 1'

export interface SessionNameCandidate {
  id: string
  name: string
}

export interface CreatedSession {
  data: SessionsData
  sessionId: string
}

export interface RemovedSolve {
  solve: Solve
  index: number
  sessionId: string
}

/** Trims and collapses whitespace so names compare predictably. */
export function normalizeSessionName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/**
 * Returns a user-facing validation message, or null when the name can be used.
 * Names are unique case-insensitively within the local collection.
 */
export function getSessionNameError(
  value: string,
  sessions: readonly SessionNameCandidate[],
  currentSessionId?: string,
): string | null {
  const name = normalizeSessionName(value)
  if (!name) return 'Enter a session name.'
  if (name.length > MAX_SESSION_NAME_LENGTH) {
    return `Use ${MAX_SESSION_NAME_LENGTH} characters or fewer.`
  }

  const normalized = name.toLowerCase()
  const duplicate = sessions.some(
    (session) =>
      session.id !== currentSessionId &&
      normalizeSessionName(session.name).toLowerCase() === normalized,
  )
  return duplicate ? 'Session name already exists. Please choose a different name.' : null
}

/** Finds the smallest unused "Session N" name. */
export function nextSessionName(
  sessions: readonly SessionNameCandidate[],
): string {
  const used = new Set(
    sessions.map((session) =>
      normalizeSessionName(session.name).toLowerCase(),
    ),
  )

  let index = 1
  while (used.has(`session ${index}`)) index += 1
  return `Session ${index}`
}

export function getActiveSession(data: SessionsData): Session | null {
  return (
    data.sessions.find((session) => session.id === data.activeSessionId) ??
    data.sessions[0] ??
    null
  )
}

export function countSolves(sessions: readonly Session[]): number {
  return sessions.reduce((total, session) => total + session.solves.length, 0)
}

function updateActiveSession(
  data: SessionsData,
  update: (session: Session) => Session,
): SessionsData {
  const active = getActiveSession(data)
  if (!active) return data

  const next = update(active)
  if (next === active && data.activeSessionId === active.id) return data

  return {
    activeSessionId: active.id,
    sessions: data.sessions.map((session) =>
      session.id === active.id ? next : session,
    ),
  }
}

export function createSession(
  data: SessionsData,
  name: string,
  options: {
    id?: string
    now?: number
    event?: PuzzleEvent
    inspectionEnabled?: boolean
    preferences?: SessionPreferences
  } = {},
): CreatedSession | null {
  const normalized = normalizeSessionName(name)
  if (getSessionNameError(normalized, data.sessions)) return null

  const id = options.id ?? createId()
  if (data.sessions.some((session) => session.id === id)) return null

  const now = options.now ?? Date.now()
  const session: Session = {
    id,
    name: normalized,
    event: options.event ?? '333',
    createdAt: now,
    updatedAt: now,
    solves: [],
    ...(typeof options.inspectionEnabled === 'boolean'
      ? { inspectionEnabled: options.inspectionEnabled }
      : {}),
    ...(options.preferences ? { preferences: options.preferences } : {}),
  }

  return {
    data: {
      activeSessionId: id,
      sessions: [...data.sessions, session],
    },
    sessionId: id,
  }
}

export function renameSession(
  data: SessionsData,
  sessionId: string,
  name: string,
  now = Date.now(),
  editorId = 'legacy',
): SessionsData | null {
  const session = data.sessions.find((candidate) => candidate.id === sessionId)
  if (!session) return null

  const normalized = normalizeSessionName(name)
  if (getSessionNameError(normalized, data.sessions, sessionId)) return null
  if (session.name === normalized) return data

  return {
    ...data,
    sessions: data.sessions.map((candidate) =>
      candidate.id === sessionId
        ? {
            ...candidate,
            name: normalized,
            updatedAt: now,
            fieldUpdates: {
              ...candidate.fieldUpdates,
              name: { updatedAt: now, editorId },
            },
          }
        : candidate,
    ),
  }
}

export function deleteSession(
  data: SessionsData,
  sessionId: string,
): SessionsData | null {
  if (data.sessions.length <= 1) return null

  const index = data.sessions.findIndex((session) => session.id === sessionId)
  if (index < 0) return null

  const sessions = data.sessions.filter((session) => session.id !== sessionId)
  const fallback = sessions[Math.min(index, sessions.length - 1)]
  if (!fallback) return null

  const activeSessionId =
    data.activeSessionId === sessionId
      ? fallback.id
      : sessions.some((session) => session.id === data.activeSessionId)
        ? data.activeSessionId
        : fallback.id

  return { activeSessionId, sessions }
}

export function setActiveSession(
  data: SessionsData,
  sessionId: string,
): SessionsData {
  if (data.activeSessionId === sessionId) return data
  if (!data.sessions.some((session) => session.id === sessionId)) return data
  return { ...data, activeSessionId: sessionId }
}

export function addSolve(
  data: SessionsData,
  solve: Solve,
  now = Date.now(),
  editorId = 'legacy',
): SessionsData {
  return updateActiveSession(data, (session) => {
    if (session.solves.some((candidate) => candidate.id === solve.id)) {
      return session
    }
    const fieldUpdates = solve.fieldUpdates ?? {
      rawMs: { updatedAt: solve.createdAt ?? now, editorId },
      penalty: { updatedAt: solve.createdAt ?? now, editorId },
      scramble: { updatedAt: solve.createdAt ?? now, editorId },
      comment: { updatedAt: now, editorId },
    }
    return {
      ...session,
      solves: [
        {
          ...solve,
          updatedAt: solve.updatedAt ?? now,
          fieldUpdates: {
            rawMs: fieldUpdates.rawMs ?? { updatedAt: solve.createdAt ?? now, editorId },
            penalty: fieldUpdates.penalty ?? { updatedAt: solve.createdAt ?? now, editorId },
            scramble: fieldUpdates.scramble ?? { updatedAt: solve.createdAt ?? now, editorId },
            comment: fieldUpdates.comment ?? { updatedAt: now, editorId },
          },
        },
        ...session.solves,
      ],
      updatedAt: now,
    }
  })
}

function recoveredExternalSessionName(
  baseName: string,
  usedNames: Set<string>,
): string {
  const suffix = ' (recovered)'
  let root = normalizeSessionName(baseName) || 'Session'
  if (root.length + suffix.length > MAX_SESSION_NAME_LENGTH) {
    root = root.slice(0, MAX_SESSION_NAME_LENGTH - suffix.length).trim()
  }
  let candidate = `${root}${suffix}`
  let counter = 2
  while (usedNames.has(candidate.toLowerCase())) {
    const numbered = ` ${counter}`
    candidate = `${root.slice(0, MAX_SESSION_NAME_LENGTH - suffix.length - numbered.length).trim()}${suffix}${numbered}`
    counter += 1
  }
  usedNames.add(candidate.toLowerCase())
  return candidate
}

/**
 * Reconciles a deferred external session collection with local solves that
 * were recorded while the timer was active. The external collection remains
 * authoritative for session structure, names, and the active selection; local
 * solves that did not exist in the pre-deferral baseline are merged back by
 * stable solve ID so a cross-tab session switch cannot drop a completed solve.
 * Older solves absent from the external collection are not resurrected.
 */
export function reconcileExternalSessions(input: {
  external: SessionsData
  local: SessionsData
  baseline: SessionsData
}): SessionsData {
  const baselineSolveIds = new Set<string>()
  for (const session of input.baseline.sessions) {
    for (const solve of session.solves) baselineSolveIds.add(solve.id)
  }

  const addedBySession = new Map<string, Solve[]>()
  for (const session of input.local.sessions) {
    const added = session.solves.filter(
      (solve) => !baselineSolveIds.has(solve.id),
    )
    if (added.length > 0) addedBySession.set(session.id, added)
  }

  if (addedBySession.size === 0) return input.external

  const sessions = input.external.sessions.map((session) => ({
    ...session,
    solves: [...session.solves],
  }))
  const byId = new Map(sessions.map((session) => [session.id, session]))
  const usedNames = new Set(
    sessions.map((session) => normalizeSessionName(session.name).toLowerCase()),
  )

  for (const [sessionId, added] of addedBySession) {
    const source = input.local.sessions.find((session) => session.id === sessionId)
    let target =
      byId.get(sessionId) ?? byId.get(`recovered:${sessionId}`)
    if (!target) {
      if (!source) continue
      const recoveredId = `recovered:${sessionId}`
      target = {
        ...source,
        id: recoveredId,
        name: recoveredExternalSessionName(source.name, usedNames),
        solves: [],
      }
      sessions.push(target)
      byId.set(recoveredId, target)
    }

    const existingIds = new Set(target.solves.map((solve) => solve.id))
    const newSolves = added.filter((solve) => !existingIds.has(solve.id))
    if (newSolves.length === 0) continue
    target.solves = [...target.solves, ...newSolves].sort(
      (left, right) =>
        right.createdAt - left.createdAt || left.id.localeCompare(right.id),
    )
    target.updatedAt = Math.max(
      target.updatedAt,
      ...newSolves.map((solve) => solve.updatedAt ?? solve.createdAt),
    )
  }

  const activeSessionId = sessions.some(
    (session) => session.id === input.external.activeSessionId,
  )
    ? input.external.activeSessionId
    : sessions[0]?.id ?? input.external.activeSessionId
  return { activeSessionId, sessions }
}

export function setSolveComment(
  data: SessionsData,
  solveId: string,
  comment: string,
  now = Date.now(),
  editorId = 'legacy',
): SessionsData {
  const normalized = comment.slice(0, MAX_SOLVE_COMMENT_LENGTH)
  return updateActiveSession(data, (session) => {
    const solve = session.solves.find((candidate) => candidate.id === solveId)
    if (!solve || solve.comment === normalized) return session

    return {
      ...session,
      solves: session.solves.map((candidate) =>
        candidate.id === solveId
          ? {
              ...candidate,
              comment: normalized,
              updatedAt: now,
              fieldUpdates: {
                ...(candidate.fieldUpdates ?? {}),
                comment: { updatedAt: now, editorId },
              },
            }
          : candidate,
      ),
      updatedAt: now,
    }
  })
}

export function setSessionInspection(
  data: SessionsData,
  sessionId: string,
  inspectionEnabled: boolean | undefined,
  now = Date.now(),
  editorId = 'legacy',
): SessionsData {
  const session = data.sessions.find((candidate) => candidate.id === sessionId)
  if (!session) return data

  const currentPreference = session.preferences?.inspectionEnabled
  const currentTopLevel = session.inspectionEnabled
  if (inspectionEnabled === undefined) {
    if (currentTopLevel === undefined && currentPreference === undefined) return data
  } else if (currentTopLevel === inspectionEnabled && currentPreference === undefined) {
    return data
  }

  const fieldUpdates: SessionFieldUpdates = {
    ...session.fieldUpdates,
    // `inspectionEnabled` metadata deliberately survives a cleared override so
    // synchronization treats "use global" as a newer edit instead of
    // resurrecting an older boolean from another device.
    inspectionEnabled: { updatedAt: now, editorId },
    ...(session.fieldUpdates?.preferences
      ? { preferences: { ...session.fieldUpdates.preferences } }
      : {}),
  }
  if (inspectionEnabled === undefined || currentPreference !== undefined) {
    // Clearing must also stamp the legacy preference form so an older remote
    // override cannot silently win over an explicit "use global" action.
    fieldUpdates.preferences = {
      ...(fieldUpdates.preferences ?? {}),
      inspectionEnabled: { updatedAt: now, editorId },
    }
  }

  return {
    ...data,
    sessions: data.sessions.map((candidate) => {
      if (candidate.id !== sessionId) return candidate
      const next: Session = {
        ...candidate,
        updatedAt: now,
        fieldUpdates,
      }
      if (inspectionEnabled === undefined) {
        delete next.inspectionEnabled
      } else {
        next.inspectionEnabled = inspectionEnabled
      }
      if (next.preferences) {
        const preferences: SessionPreferences = { ...next.preferences }
        delete preferences.inspectionEnabled
        if (Object.keys(preferences).length > 0) next.preferences = preferences
        else delete next.preferences
      }
      return next
    }),
  }
}

/**
 * Updates only the supplied session preference fields. Undefined values remove
 * an override and are still timestamped so a merge does not silently resurrect
 * the old value from another device.
 */
export function setSessionPreferences(
  data: SessionsData,
  sessionId: string,
  changes: Partial<SessionPreferences>,
  now = Date.now(),
  editorId = 'legacy',
): SessionsData {
  const session = data.sessions.find((candidate) => candidate.id === sessionId)
  if (!session) return data

  const preferences: SessionPreferences = { ...(session.preferences ?? {}) }
  const preferenceUpdates: Partial<Record<SessionPreferenceKey, { updatedAt: number; editorId: string }>> = {
    ...(session.fieldUpdates?.preferences ?? {}),
  }
  let changed = false

  for (const key of SESSION_PREFERENCE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) continue
    const next = changes[key]
    if (next === undefined) {
      if (!Object.prototype.hasOwnProperty.call(preferences, key)) continue
      delete preferences[key]
    } else if (preferences[key] !== next) {
      preferences[key] = next as never
    } else {
      continue
    }
    changed = true
    preferenceUpdates[key] = { updatedAt: now, editorId }
  }

  if (!changed) return data

  const fieldUpdates: SessionFieldUpdates = {
    ...session.fieldUpdates,
    ...(Object.keys(preferenceUpdates).length > 0
      ? { preferences: preferenceUpdates }
      : { preferences: undefined }),
  }
  if (Object.keys(preferenceUpdates).length === 0) delete fieldUpdates.preferences

  return {
    ...data,
    sessions: data.sessions.map((candidate) => {
      if (candidate.id !== sessionId) return candidate
      const next: Session = {
        ...candidate,
        updatedAt: now,
        fieldUpdates,
      }
      if (Object.keys(preferences).length > 0) next.preferences = preferences
      else delete next.preferences
      return next
    }),
  }
}

export function setSolvePenalty(
  data: SessionsData,
  solveId: string,
  penalty: Penalty,
  now = Date.now(),
  editorId = 'legacy',
): SessionsData {
  return updateActiveSession(data, (session) => {
    const solve = session.solves.find((candidate) => candidate.id === solveId)
    if (!solve || solve.penalty === penalty) return session

    return {
      ...session,
      solves: session.solves.map((candidate) =>
        candidate.id === solveId
          ? {
              ...candidate,
              penalty,
              updatedAt: now,
              fieldUpdates: {
                ...(candidate.fieldUpdates ?? {}),
                penalty: { updatedAt: now, editorId },
              },
            }
          : candidate,
      ),
      updatedAt: now,
    }
  })
}

export function removeSolve(
  data: SessionsData,
  solveId: string,
  now = Date.now(),
): { data: SessionsData; removed: RemovedSolve } | null {
  const active = getActiveSession(data)
  if (!active) return null

  const index = active.solves.findIndex((solve) => solve.id === solveId)
  const solve = active.solves[index]
  if (!solve) return null

  return {
    data: {
      activeSessionId: active.id,
      sessions: data.sessions.map((session) =>
        session.id === active.id
          ? {
              ...session,
              solves: session.solves.filter(
                (candidate) => candidate.id !== solveId,
              ),
              updatedAt: now,
            }
          : session,
      ),
    },
    removed: { solve, index, sessionId: active.id },
  }
}

export function restoreSolve(
  data: SessionsData,
  sessionId: string,
  solve: Solve,
  index: number,
  now = Date.now(),
): SessionsData | null {
  const session = data.sessions.find((candidate) => candidate.id === sessionId)
  if (!session) return null
  if (session.solves.some((candidate) => candidate.id === solve.id)) return null

  const solves = [...session.solves]
  solves.splice(Math.max(0, Math.min(index, solves.length)), 0, solve)

  return {
    ...data,
    sessions: data.sessions.map((candidate) =>
      candidate.id === sessionId
        ? { ...candidate, solves, updatedAt: now }
        : candidate,
    ),
  }
}

export function clearActiveSolves(
  data: SessionsData,
  now = Date.now(),
): SessionsData {
  return updateActiveSession(data, (session) =>
    session.solves.length === 0
      ? session
      : { ...session, solves: [], updatedAt: now },
  )
}

export function mergeSessionsById(
  data: SessionsData,
  targetId: string,
  sourceId: string,
  now = Date.now(),
): SessionsData | null {
  if (targetId === sourceId) return null
  const target = data.sessions.find((session) => session.id === targetId)
  const source = data.sessions.find((session) => session.id === sourceId)
  if (!target || !source) return null
  if ((target.event ?? '333') !== (source.event ?? '333')) return null
  if ([...target.solves, ...source.solves].some((solve) => solve.event !== (target.event ?? '333'))) return null

  const solvesById = new Map<string, Solve>()
  for (const solve of target.solves) solvesById.set(solve.id, solve)
  for (const solve of source.solves) {
    const existing = solvesById.get(solve.id)
    solvesById.set(solve.id, existing ? mergeSolveFields(existing, solve, false, []) : solve)
  }

  const mergedSolves = [...solvesById.values()].sort((a, b) => {
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt
    return b.id.localeCompare(a.id)
  })

  return {
    activeSessionId: targetId,
    sessions: data.sessions
      .map((session) =>
        session.id === targetId
          ? { ...session, solves: mergedSolves, updatedAt: now }
          : session,
      )
      .filter((session) => session.id !== sourceId),
  }
}



export function setSessionEvent(
  data: SessionsData,
  sessionId: string,
  event: PuzzleEvent,
  now = Date.now(),
  editorId = 'legacy',
): SessionsData | null {
  const session = data.sessions.find((candidate) => candidate.id === sessionId)
  if (!session) return null
  if (session.solves.length > 0) return null
  if (session.event === event) return data

  return {
    ...data,
    sessions: data.sessions.map((candidate) =>
      candidate.id === sessionId
        ? {
            ...candidate,
            event,
            updatedAt: now,
            fieldUpdates: {
              ...candidate.fieldUpdates,
              event: { updatedAt: now, editorId },
            },
          }
        : candidate,
    ),
  }
}
