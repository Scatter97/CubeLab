import { useCallback, useState } from 'react'

const STORAGE_KEY = 'cubelab:drawScrambleMode:v1'

export type DrawScrambleMode = 'net' | '3d'

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
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }, [])
  return [mode, update]
}
