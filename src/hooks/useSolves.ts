import { useCallback, useEffect, useRef, useState } from 'react'
import type { NewSolve, Penalty, Solve } from '../types'
import { createId } from '../lib/id'
import { loadSolves, saveSolves } from '../lib/storage'

export interface UseSolvesResult {
  solves: Solve[]
  storageOk: boolean
  addSolve: (input: NewSolve) => Solve
  setPenalty: (id: string, penalty: Penalty) => void
  deleteSolve: (id: string) => void
  restoreSolve: (solve: Solve, index: number) => void
  clearSolves: () => void
}

export function useSolves(): UseSolvesResult {
  const [solves, setSolves] = useState<Solve[]>(() => loadSolves())
  const [storageOk, setStorageOk] = useState(true)
  const initialWrite = useRef(true)

  useEffect(() => {
    // Do not report a storage failure before the first user action: some
    // browsers block storage until a gesture, while the session still works in
    // memory. Subsequent writes surface the real status.
    const success = saveSolves(solves)
    if (initialWrite.current) {
      initialWrite.current = false
      // Recovery of a previously-saved session is also worth surfacing.
      // oxlint-disable-next-line react/set-state-in-effect
      if (solves.length > 0) setStorageOk(success)
      return
    }
    // Persistence status is derived from the write and only updates after a
    // session change, so this cannot create a render loop.
    // oxlint-disable-next-line react/set-state-in-effect
    setStorageOk(success)
  }, [solves])

  const addSolve = useCallback((input: NewSolve): Solve => {
    const solve: Solve = {
      id: createId(),
      event: '333',
      rawMs: Math.max(0, Math.floor(input.rawMs)),
      penalty: input.penalty,
      scramble: input.scramble,
      createdAt: Date.now(),
    }
    setSolves((current) => [solve, ...current])
    return solve
  }, [])

  const setPenalty = useCallback((id: string, penalty: Penalty) => {
    setSolves((current) =>
      current.map((solve) => (solve.id === id ? { ...solve, penalty } : solve)),
    )
  }, [])

  const deleteSolve = useCallback((id: string) => {
    setSolves((current) => current.filter((solve) => solve.id !== id))
  }, [])

  const restoreSolve = useCallback((solve: Solve, index: number) => {
    setSolves((current) => {
      if (current.some((existing) => existing.id === solve.id)) return current
      const next = [...current]
      next.splice(Math.max(0, Math.min(index, next.length)), 0, solve)
      return next
    })
  }, [])

  const clearSolves = useCallback(() => {
    setSolves([])
  }, [])

  return {
    solves,
    storageOk,
    addSolve,
    setPenalty,
    deleteSolve,
    restoreSolve,
    clearSolves,
  }
}
