import type { Penalty, Session, SessionsData, Solve } from '../types'
import { createId } from './id'

export const MAX_SESSION_NAME_LENGTH = 40
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
  return duplicate ? 'Session names must be unique.' : null
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
  options: { id?: string; now?: number } = {},
): CreatedSession | null {
  const normalized = normalizeSessionName(name)
  if (getSessionNameError(normalized, data.sessions)) return null

  const id = options.id ?? createId()
  if (data.sessions.some((session) => session.id === id)) return null

  const now = options.now ?? Date.now()
  const session: Session = {
    id,
    name: normalized,
    createdAt: now,
    updatedAt: now,
    solves: [],
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
        ? { ...candidate, name: normalized, updatedAt: now }
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
): SessionsData {
  return updateActiveSession(data, (session) => {
    if (session.solves.some((candidate) => candidate.id === solve.id)) {
      return session
    }
    return {
      ...session,
      solves: [solve, ...session.solves],
      updatedAt: now,
    }
  })
}

export function setSolvePenalty(
  data: SessionsData,
  solveId: string,
  penalty: Penalty,
  now = Date.now(),
): SessionsData {
  return updateActiveSession(data, (session) => {
    const solve = session.solves.find((candidate) => candidate.id === solveId)
    if (!solve || solve.penalty === penalty) return session

    return {
      ...session,
      solves: session.solves.map((candidate) =>
        candidate.id === solveId ? { ...candidate, penalty } : candidate,
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
