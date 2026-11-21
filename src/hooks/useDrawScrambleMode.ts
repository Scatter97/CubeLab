import { useCallback, useState } from 'react'

import { isSiteResetInProgress } from '../lib/siteReset'

const STORAGE_KEY = 'cubelab:drawScrambleMode:v1'
const CHOSEN_KEY = 'cubelab:drawScrambleModeChosen:v1'

export type DrawScrambleMode = 'net' | '3d'

export function hasChosenDrawScrambleMode(): boolean {
  try {
    return localStorage.getItem(CHOSEN_KEY) === '1'
  } catch {
    return true
  }
}

export function markDrawScrambleModeChosen(): void {
  try {
    if (!isSiteResetInProgress()) localStorage.setItem(CHOSEN_KEY, '1')
  } catch {
    // ignore
  }
}

export function loadDrawScrambleMode(): DrawScrambleMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === '3d' || raw === 'net') return raw
  } catch {
    // ignore
  }
  return 'net'
}

export function useDrawScrambleMode(): [DrawScrambleMode, (mode: DrawScrambleMode) => void] {
  const [mode, setMode] = useState<DrawScrambleMode>(() => loadDrawScrambleMode())
  const update = useCallback((next: DrawScrambleMode) => {
    setMode(next)
    markDrawScrambleModeChosen()
    try {
      if (!isSiteResetInProgress()) localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }, [])
  return [mode, update]
}
