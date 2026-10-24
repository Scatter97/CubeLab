import { useCallback, useEffect, useRef, useState } from 'react'
import type { NewSolve, Penalty, Session, SessionsData, Solve } from '../types'
import { createId } from '../lib/id'
import {
  addSolve as addSolveToData,
  clearActiveSolves,
  createSession as createSessionInData,
  deleteSession as deleteSessionFromData,
  getActiveSession,
  removeSolve as removeSolveFromData,
  renameSession as renameSessionInData,
  restoreSolve as restoreSolveInData,
  setActiveSession as setActiveSessionInData,
  setSessionInspection as setSessionInspectionInData,
  setSolveComment as setSolveCommentInData,
  setSolvePenalty,
  type RemovedSolve,
} from '../lib/sessions'
import { loadSessions, saveSessions } from '../lib/storage'
import { loadSyncStorage } from '../lib/syncStorage'

export interface UseSessionsResult {
  sessions: Session[]
  activeSession: Session
  activeSessionId: string
  storageOk: boolean
  addSolve: (input: NewSolve) => Solve
  setPenalty: (id: string, penalty: Penalty) => void
  setComment: (id: string, comment: string) => void
  setInspection: (id: string, enabled: boolean) => void
  deleteSolve: (id: string) => RemovedSolve | null
  restoreSolve: (solve: Solve, index: number, sessionId: string) => void
  clearSolves: () => void
  createSession: (name: string, inspectionEnabled?: boolean) => string | null
  renameSession: (id: string, name: string) => boolean
  deleteSession: (id: string) => boolean
  selectSession: (id: string) => void
  replaceSessions: (data: SessionsData) => void
}

function requireActiveSession(data: SessionsData): Session {
  const active = getActiveSession(data)
  if (!active) {
    throw new Error('CubeLab requires at least one local session')
  }
  return active
}

export function useSessions(): UseSessionsResult {
  const [data, setData] = useState<SessionsData>(() => loadSessions())
  const dataRef = useRef(data)
  const [storageOk, setStorageOk] = useState(true)
  const initialWrite = useRef(true)
  const syncDeviceId = loadSyncStorage().runtime.deviceId

  const commit = useCallback(
    (update: (current: SessionsData) => SessionsData): boolean => {
      const current = dataRef.current
      const next = update(current)
      if (next === current) return false
      dataRef.current = next
      setData(next)
      return true
    },
    [],
  )

  useEffect(() => {
    // Do not report a storage failure before the first user action: some
    // browsers block storage until a gesture, while the session still works in
    // memory. Subsequent writes surface the real status.
    const success = saveSessions(data)
    if (initialWrite.current) {
      initialWrite.current = false
      // Recovery of a previously-saved collection is also worth surfacing.
      if (
        data.sessions.length > 1 ||
        data.sessions.some((session) => session.solves.length > 0)
      ) {
        // oxlint-disable-next-line react/set-state-in-effect
        setStorageOk(success)
      }
      return
    }
    // Persistence status is derived from the write and only updates after a
    // collection change, so this cannot create a render loop.
    // oxlint-disable-next-line react/set-state-in-effect
    setStorageOk(success)
  }, [data])

  const activeSession = requireActiveSession(data)

  const addSolve = useCallback(
    (input: NewSolve): Solve => {
      const solve: Solve = {
        id: createId(),
        event: '333',
        rawMs: Math.max(0, Math.floor(input.rawMs)),
        penalty: input.penalty,
        scramble: input.scramble,
        comment: '',
        createdAt: Date.now(),
      }
      commit((current) => addSolveToData(current, solve, undefined, syncDeviceId))
      return solve
    },
    [commit, syncDeviceId],
  )

    const setPenalty = useCallback(
    (id: string, penalty: Penalty) => {
      commit((current) => setSolvePenalty(current, id, penalty, undefined, syncDeviceId))
    },
    [commit, syncDeviceId],
  )

  const setComment = useCallback(
    (id: string, comment: string) => {
      commit((current) => setSolveCommentInData(current, id, comment, undefined, syncDeviceId))
    },
    [commit, syncDeviceId],
  )

  const setInspection = useCallback(
    (id: string, enabled: boolean) => {
      commit((current) => setSessionInspectionInData(current, id, enabled))
    },
    [commit],
  )

  const deleteSolve = useCallback(
    (id: string): RemovedSolve | null => {
      const result = removeSolveFromData(dataRef.current, id)
      if (!result) return null

      dataRef.current = result.data
      setData(result.data)
      return result.removed
    },
    [],
  )

  const restoreSolve = useCallback(
    (solve: Solve, index: number, sessionId: string) => {
      commit(
        (current) =>
          restoreSolveInData(current, sessionId, solve, index) ?? current,
      )
    },
    [commit],
  )

  const clearSolves = useCallback(() => {
    commit((current) => clearActiveSolves(current))
  }, [commit])

  const createSession = useCallback(
    (name: string, inspectionEnabled?: boolean): string | null => {
      const result = createSessionInData(dataRef.current, name, {
        inspectionEnabled,
      })
      if (!result) return null

      dataRef.current = result.data
      setData(result.data)
      return result.sessionId
    },
    [],
  )

  const renameSession = useCallback((id: string, name: string): boolean => {
    const current = dataRef.current
    const next = renameSessionInData(current, id, name)
    if (!next) return false
    if (next !== current) {
      dataRef.current = next
      setData(next)
    }
    return true
  }, [])

  const deleteSession = useCallback((id: string): boolean => {
    const next = deleteSessionFromData(dataRef.current, id)
    if (!next) return false

    dataRef.current = next
    setData(next)
    return true
  }, [])

  const selectSession = useCallback((id: string) => {
    commit((current) => setActiveSessionInData(current, id))
  }, [commit])

  const replaceSessions = useCallback((next: SessionsData) => {
    const activeSessionId = next.sessions.some(
      (session) => session.id === next.activeSessionId,
    )
      ? next.activeSessionId
      : next.sessions[0]?.id
    if (!activeSessionId) return

    const normalized = { ...next, activeSessionId }
    dataRef.current = normalized
    setData(normalized)
  }, [])

  return {
    sessions: data.sessions,
    activeSession,
    activeSessionId: activeSession.id,
    storageOk,
    addSolve,
    setPenalty,
    setComment,
    setInspection,
    deleteSolve,
    restoreSolve,
    clearSolves,
    createSession,
    renameSession,
    deleteSession,
    selectSession,
    replaceSessions,
  }
}
