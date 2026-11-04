import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CustomEventDefinition, NewSolve, Penalty, PuzzleEvent, Session, SessionOrdering, SessionPreferences, SessionsData, Solve } from '../types'
import { createId } from '../lib/id'
import { setCustomEventDefinitions } from '../lib/events'
import {
  correctImportedSolveEvents,
  createCustomEvent as createCustomEventInData,
  deleteCustomEvent as deleteCustomEventInData,
  reassignSessionsEvent as reassignSessionsEventInData,
  renameCustomEvent as renameCustomEventInData,
  setCustomEventPlaceholder as setCustomEventPlaceholderInData,
} from '../lib/customEvents'
import {
  addSolve as addSolveToData,
  clearActiveSolves,
  clearAllSolves as clearAllSolvesInData,
  createSession as createSessionInData,
  deleteAllSessions as deleteAllSessionsInData,
  deleteSession as deleteSessionFromData,
  ensureSessionOrdering,
  getActiveSession,
  getOrderedSessions,
  moveSession as moveSessionInData,
  removeSolve as removeSolveFromData,
  renameSession as renameSessionInData,
  restoreSolve as restoreSolveInData,
  setActiveSession as setActiveSessionInData,
  setSessionInspection as setSessionInspectionInData,
  setSessionPreferences as setSessionPreferencesInData,
  setSolveComment as setSolveCommentInData,
  setSolvePenalty,
  type RemovedSolve,
} from '../lib/sessions'
import { loadSessions, saveSessions } from '../lib/storage'
import { getSyncDeviceId } from '../lib/syncStorage'


export interface UseSessionsResult {
  sessions: Session[]
  customEvents: CustomEventDefinition[]
  sessionOrder?: SessionOrdering
  activeSession: Session
  activeSessionId: string
  storageOk: boolean
  addSolve: (input: NewSolve, event?: PuzzleEvent) => Solve
  setPenalty: (id: string, penalty: Penalty) => void
  setComment: (id: string, comment: string) => void
  setInspection: (id: string, enabled: boolean | undefined) => void
  setPreferences: (id: string, changes: Partial<SessionPreferences>) => void
  deleteSolve: (id: string) => RemovedSolve | null
  restoreSolve: (solve: Solve, index: number, sessionId: string) => void
  clearSolves: () => void
  resetAllSolveData: () => { ok: boolean; removed: RemovedSolve[] }
  createSession: (
    name: string,
    inspectionEnabled?: boolean,
    event?: PuzzleEvent,
    preferences?: SessionPreferences,
  ) => string | null
  renameSession: (id: string, name: string) => boolean
  setSessionEvent: (id: string, event: PuzzleEvent) => boolean
  moveSession: (id: string, direction: -1 | 1) => void
  deleteSession: (id: string) => boolean
  deleteAllSessions: () => boolean
  selectSession: (id: string) => void
  replaceSessions: (data: SessionsData) => void
  createCustomEvent: (name: string, placeholder?: string) => string | null
  renameCustomEvent: (id: string, name: string) => boolean
  setCustomEventPlaceholder: (id: string, placeholder: string) => boolean
  deleteCustomEvent: (id: string) => { ok: true } | { ok: false; error: string }
  reassignSessionsEvent: (sessionIds: readonly string[], event: PuzzleEvent) => boolean
  correctImportedEvents: () => number
}

function requireActiveSession(data: SessionsData): Session {
  const active = getActiveSession(data)
  if (!active) {
    throw new Error('CubeLab requires at least one local session')
  }
  return active
}

export function useSessions(): UseSessionsResult {
  const [data, setData] = useState<SessionsData>(() => {
    const loaded = loadSessions()
    // Labels are consumed by deeply nested presentation components. Publish the
    // persisted definitions before the first render that can observe them.
    setCustomEventDefinitions(loaded.customEvents)
    return loaded
  })
  const dataRef = useRef(data)
  const [storageOk, setStorageOk] = useState(true)
  const initialWrite = useRef(true)
  // Resolved once per mount. Reading sync storage from the render body would
  // re-parse localStorage on every timer frame.
  const [syncDeviceId] = useState(() => getSyncDeviceId())

  const applyData = useCallback((next: SessionsData) => {
    setCustomEventDefinitions(next.customEvents)
    dataRef.current = next
    setData(next)
  }, [])

  const commit = useCallback(
    (update: (current: SessionsData) => SessionsData): boolean => {
      const current = dataRef.current
      const next = update(current)
      if (next === current) return false
      applyData(next)
      return true
    },
    [applyData],
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
  const orderedSessions = useMemo(() => getOrderedSessions(data), [data])

  const addSolve = useCallback(
    (input: NewSolve, event?: PuzzleEvent): Solve => {
      const resolvedEvent = event ?? '333'
      const solve: Solve = {
        id: createId(),
        event: resolvedEvent,
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
    (id: string, enabled: boolean | undefined) => {
      commit((current) =>
        setSessionInspectionInData(current, id, enabled, undefined, syncDeviceId),
      )
    },
    [commit, syncDeviceId],
  )

  const setPreferences = useCallback(
    (id: string, changes: Partial<SessionPreferences>) => {
      commit((current) =>
        setSessionPreferencesInData(current, id, changes, undefined, syncDeviceId),
      )
    },
    [commit, syncDeviceId],
  )

  const deleteSolve = useCallback(
    (id: string): RemovedSolve | null => {
      const result = removeSolveFromData(dataRef.current, id)
      if (!result) return null

      applyData(result.data)
      return result.removed
    },
    [applyData],
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

  const resetAllSolveData = useCallback((): {
    ok: boolean
    removed: RemovedSolve[]
  } => {
    const result = clearAllSolvesInData(dataRef.current)
    if (result.removed.length === 0) return { ok: true, removed: [] }
    // Persist the cleared collection before publishing it so a failed write
    // cannot make the UI claim that every solve was removed.
    if (!saveSessions(result.data)) {
      setStorageOk(false)
      return { ok: false, removed: [] }
    }
    applyData(result.data)
    return { ok: true, removed: result.removed }
  }, [applyData])

  const createSession = useCallback(
    (
      name: string,
      inspectionEnabled?: boolean,
      event?: PuzzleEvent,
      preferences?: SessionPreferences,
    ): string | null => {
      const result = createSessionInData(dataRef.current, name, {
        inspectionEnabled,
        event,
        preferences,
        editorId: syncDeviceId,
      })
      if (!result) return null

      applyData(result.data)
      return result.sessionId
    },
    [applyData, syncDeviceId],
  )

  const renameSession = useCallback((id: string, name: string): boolean => {
    const current = dataRef.current
    const next = renameSessionInData(current, id, name, undefined, syncDeviceId)
    if (!next) return false
    if (next !== current) applyData(next)
    return true
  }, [applyData, syncDeviceId])

  const setSessionEvent = useCallback(
    (id: string, value: PuzzleEvent): boolean => {
      const next = reassignSessionsEventInData(
        dataRef.current,
        [id],
        value,
        undefined,
        syncDeviceId,
      )
      if (!next) return false
      if (next !== dataRef.current) applyData(next)
      return true
    },
    [applyData, syncDeviceId],
  )

  const moveSession = useCallback(
    (id: string, direction: -1 | 1) => {
      commit((current) =>
        moveSessionInData(current, id, direction, undefined, syncDeviceId),
      )
    },
    [commit, syncDeviceId],
  )

  const deleteSession = useCallback((id: string): boolean => {
    const next = deleteSessionFromData(dataRef.current, id)
    if (!next) return false

    applyData(next)
    return true
  }, [applyData])

  const deleteAllSessions = useCallback((): boolean => {
    const next = deleteAllSessionsInData(
      dataRef.current,
      undefined,
      syncDeviceId,
    )
    // Persist before publishing: a failed write must not make the interface
    // claim that every session was removed.
    if (!saveSessions(next)) {
      setStorageOk(false)
      return false
    }
    applyData(next)
    return true
  }, [applyData, syncDeviceId])

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

    const normalized = ensureSessionOrdering({ ...next, activeSessionId })
    applyData(normalized)
  }, [applyData])

  const createCustomEvent = useCallback(
    (name: string, placeholder?: string): string | null => {
      const result = createCustomEventInData(dataRef.current, { name, placeholder })
      if (!result) return null
      applyData(result.data)
      return result.eventId
    },
    [applyData],
  )

  const renameCustomEvent = useCallback((id: string, name: string): boolean => {
    const next = renameCustomEventInData(
      dataRef.current,
      id,
      name,
      undefined,
      syncDeviceId,
    )
    if (!next) return false
    if (next !== dataRef.current) applyData(next)
    return true
  }, [applyData, syncDeviceId])

  const setCustomEventPlaceholder = useCallback(
    (id: string, placeholder: string): boolean => {
      const next = setCustomEventPlaceholderInData(
        dataRef.current,
        id,
        placeholder,
        undefined,
        syncDeviceId,
      )
      if (!next) return false
      if (next !== dataRef.current) applyData(next)
      return true
    },
    [applyData, syncDeviceId],
  )

  const deleteCustomEvent = useCallback(
    (id: string): { ok: true } | { ok: false; error: string } => {
      const result = deleteCustomEventInData(dataRef.current, id)
      if ('error' in result) return { ok: false, error: result.error }
      applyData(result.data)
      return { ok: true }
    },
    [applyData],
  )

  const reassignSessionsEvent = useCallback(
    (sessionIds: readonly string[], event: PuzzleEvent): boolean => {
      const next = reassignSessionsEventInData(
        dataRef.current,
        sessionIds,
        event,
        undefined,
        syncDeviceId,
      )
      if (!next) return false
      if (next !== dataRef.current) applyData(next)
      return true
    },
    [applyData, syncDeviceId],
  )

  const correctImportedEvents = useCallback((): number => {
    const result = correctImportedSolveEvents(
      dataRef.current,
      undefined,
      syncDeviceId,
    )
    if (result.movedCount > 0) applyData(result.data)
    return result.movedCount
  }, [applyData, syncDeviceId])

  return {
    sessions: orderedSessions,
    customEvents: data.customEvents ?? [],
    ...(data.sessionOrder ? { sessionOrder: data.sessionOrder } : {}),
    activeSession,
    activeSessionId: activeSession.id,
    storageOk,
    addSolve,
    setPenalty,
    setComment,
    setInspection,
    setPreferences,
    deleteSolve,
    restoreSolve,
    clearSolves,
    resetAllSolveData,
    createSession,
    renameSession,
    setSessionEvent,
    moveSession,
    deleteSession,
    deleteAllSessions,
    selectSession,
    replaceSessions,
    createCustomEvent,
    renameCustomEvent,
    setCustomEventPlaceholder,
    deleteCustomEvent,
    reassignSessionsEvent,
    correctImportedEvents,
  }
}
